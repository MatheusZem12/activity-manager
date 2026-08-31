#!/usr/bin/env bash
#
# Monta a estrutura do Activity Manager na VPS.
#
#     ~/activity-manager/
#     ├── postgres/   docker-compose.yml + .env   (o banco)
#     └── service/    docker-compose.yml + .env   (backend + túnel)
#
# Rode NA VPS. Ele não instala Docker, não abre porta e não cria conta: só
# monta os diretórios, gera os segredos e sobe o banco. O serviço espera a
# primeira imagem existir no GHCR.
#
# É idempotente: rodar de novo não sobrescreve `.env` que já tenha valor. Os
# segredos são gerados uma vez e mantidos — regenerar o JWT invalidaria todas
# as sessões dos seus aparelhos.
set -euo pipefail

RAIZ="${AM_RAIZ:-$HOME/activity-manager}"
REDE="activity-net"

azul()  { printf '\033[1;34m%s\033[0m\n' "$*"; }
ok()    { printf '  \033[1;32m✓\033[0m %s\n' "$*"; }
aviso() { printf '  \033[1;33m!\033[0m %s\n' "$*"; }

# ---------------------------------------------------------------- pré-requisitos
azul "1. Verificando o que já existe"
command -v docker >/dev/null || { echo "docker não encontrado. Instale antes."; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "'docker compose' (plugin v2) não encontrado."; exit 1; }
ok "docker $(docker --version | grep -oP '\d+\.\d+\.\d+' | head -1)"

# Porta ocupada é o jeito mais rápido de a subida falhar sem dizer por quê — e
# o erro que o Docker dá ("Bind for 0.0.0.0:5434 failed") não diz o que fazer.
# Então em vez de avisar e tentar assim mesmo, procuramos a próxima livre.
#
# Nesta VPS a 5432/8080 é do finance e a 5433/8090 é do lingua; 5434/8091 é o
# próximo par vago, mas isso muda conforme a máquina cresce.
porta_livre() {
  local porta="$1"
  while ss -lntH 2>/dev/null | grep -qE "[:.]${porta}[[:space:]]"; do
    porta=$((porta + 1))
  done
  printf '%s' "${porta}"
}

PORTA_DB="$(porta_livre 5434)"
PORTA_API="$(porta_livre 8091)"
[[ "${PORTA_DB}"  != 5434 ]] && aviso "5434 ocupada — usando ${PORTA_DB} para o banco"
[[ "${PORTA_API}" != 8091 ]] && aviso "8091 ocupada — usando ${PORTA_API} para a API"
ok "portas: banco ${PORTA_DB}, api ${PORTA_API}"

# ------------------------------------------------------------------- estrutura
azul "2. Criando ${RAIZ}"
mkdir -p "${RAIZ}/postgres" "${RAIZ}/service"
ok "postgres/ e service/"

# A rede é externa aos dois composes: criada aqui, uma vez, para que nenhum
# deles crie nem destrua a rede do outro ao subir e descer.
if docker network inspect "${REDE}" >/dev/null 2>&1; then
  ok "rede ${REDE} já existe"
else
  docker network create "${REDE}" >/dev/null
  ok "rede ${REDE} criada"
fi

# --------------------------------------------------------------------- segredos
azul "3. Segredos"

gerar() { openssl rand -base64 "${1:-36}" | tr -d '\n/+=' | cut -c1-"${2:-32}"; }

# Só gera o que ainda não existe. Trocar o JWT depois derruba a sessão de todos
# os aparelhos; trocar a senha do banco depois exige mexer no volume.
if [[ -f "${RAIZ}/postgres/.env" ]]; then
  ok "postgres/.env preservado"
  SENHA_DB="$(grep -oP '^AM_DB_SENHA=\K.*' "${RAIZ}/postgres/.env")"
else
  SENHA_DB="$(gerar 36 32)"
  cat > "${RAIZ}/postgres/.env" <<EOF
AM_DB_NOME=activity_manager
AM_DB_USER=activity
AM_DB_SENHA=${SENHA_DB}
# 127.0.0.1 apenas — veja o docker-compose.yml
AM_DB_PORTA=${PORTA_DB}
EOF
  chmod 600 "${RAIZ}/postgres/.env"
  ok "postgres/.env criado, senha gerada"
fi

if [[ -f "${RAIZ}/service/.env" ]]; then
  ok "service/.env preservado"
else
  cat > "${RAIZ}/service/.env" <<EOF
# --- banco (a senha tem que ser a MESMA do postgres/.env) ---
AM_DB_NOME=activity_manager
AM_DB_USER=activity
AM_DB_SENHA=${SENHA_DB}

# --- segurança ---
# Assina os tokens de sessão. Trocar isto derruba a sessão de todos os aparelhos.
AM_JWT_SEGREDO=$(openssl rand -base64 48 | tr -d '\n')
# Quem não tem este convite não cria conta. Guarde: você vai digitá-lo uma vez
# em cada dispositivo.
AM_CONVITE=$(gerar 24 16)
AM_JWT_DIAS=30
AM_MAX_CONTAS=5

# --- portas no host ---
AM_PORTA_HOST=${PORTA_API}

# --- imagem ---
AM_TAG=dev

# --- IA ---
# 'local' = o servidor NÃO chama modelo nenhum: ele monta a pergunta e um
# dispositivo seu executa no ollama ou no claude da máquina. É o padrão, e o
# único modo em que a VPS não precisa de chave.
#
# Para o servidor classificar sozinho, troque para anthropic/openai/gemini e
# preencha AM_IA_CHAVE.
AM_IA_PROVEDOR=local
AM_IA_CHAVE=
AM_IA_MODELO=claude-haiku-4-5

# --- túnel (Cloudflare) ---
# Cole aqui o token do painel: Zero Trust > Networks > Tunnels > seu túnel.
# Enquanto estiver vazio, o perfil 'tunel' não sobe e nada é exposto na internet.
AM_TUNEL_TOKEN=
EOF
  chmod 600 "${RAIZ}/service/.env"
  ok "service/.env criado, JWT e convite gerados"
fi

# ------------------------------------------------------------------- composes
azul "4. Composes"

# Embutidos, e não copiados de arquivos vizinhos: assim este script é UM arquivo
# só. Na VPS você não tem o repositório — levar uma árvore de diretórios por scp
# é justamente o passo em que dá errado.
#
# Os delimitadores estão entre aspas ('COMPOSE') para o shell NÃO expandir os
# ${...} — eles têm que chegar literais no YAML, senão o Compose recebe tudo
# vazio e o erro só aparece na hora de subir.

cat > "${RAIZ}/postgres/docker-compose.yml" <<'COMPOSE_POSTGRES'
# O banco, sozinho no seu compose.
#
# Separado do serviço de propósito: atualizar a imagem do backend não pode ter
# nada a ver com derrubar o Postgres. São ciclos de vida diferentes — um muda
# a cada push, o outro quase nunca.
services:
  db:
    image: postgres:16
    container_name: postgres_activity
    restart: always
    environment:
      POSTGRES_USER: ${AM_DB_USER:-activity}
      POSTGRES_PASSWORD: ${AM_DB_SENHA:?defina AM_DB_SENHA no .env}
      POSTGRES_DB: ${AM_DB_NOME:-activity_manager}
    ports:
      # 127.0.0.1 e não 0.0.0.0: o banco só ouve a própria VPS. Quem varre a
      # internet procurando Postgres exposto não tem o que achar aqui.
      #
      # 5434 porque a 5432 já é do finance e a 5433 do lingua nesta máquina.
      - "127.0.0.1:${AM_DB_PORTA:-5434}:5432"
    # Segmento de foco é linha curta e numérica: um ano de uso não chega perto
    # de encher isto. Serve para limitar crescimento, não para apertar.
    mem_limit: 512m
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${AM_DB_USER:-activity} -d ${AM_DB_NOME:-activity_manager}"]
      interval: 10s
      timeout: 5s
      retries: 10
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - activity-net

volumes:
  postgres_data:

# Externa: criada uma vez com `docker network create activity-net`, fora dos
# dois composes. Assim nenhum deles cria nem destrói a rede do outro.
networks:
  activity-net:
    external: true
COMPOSE_POSTGRES
ok "postgres/docker-compose.yml"

cat > "${RAIZ}/service/docker-compose.yml" <<'COMPOSE_SERVICE'
# O backend e o túnel.
services:
  activity-backend:
    image: ghcr.io/matheuszem12/activity-manager-backend:${AM_TAG:-dev}
    container_name: activity-backend
    restart: unless-stopped
    ports:
      # Loopback: nada daqui é alcançável de fora sem o túnel. 8091 porque a
      # 8080 é do finance e a 8090 do lingua nesta máquina.
      - "127.0.0.1:${AM_PORTA_HOST:-8091}:8090"
    env_file:
      - .env
    environment:
      # `postgres_activity` é o nome do CONTÊINER do outro compose, e 5432 é a
      # porta de DENTRO dele — a 5434 do host não tem nada a ver com isto. Os
      # dois se encontram pela rede activity-net.
      AM_DB_URL: jdbc:postgresql://postgres_activity:5432/${AM_DB_NOME:-activity_manager}
      # Fixa, e DEPOIS do env_file para vencer qualquer valor que caia lá. O
      # env_file despeja o .env inteiro no contêiner, e a aplicação lê AM_PORTA
      # para escolher a porta do Tomcat: com o mesmo nome nos dois lados, pôr
      # 8091 no .env faria o servidor escutar em 8091 lá dentro enquanto o
      # mapeamento aponta para a 8090. Nada responderia, e o log diria
      # "Started" — a pior combinação possível.
      AM_PORTA: 8090
    # A JVM roda com -XX:MaxRAMPercentage=75, e o percentual é sobre a memória
    # que ela ENXERGA. Sem limite ela enxerga o host inteiro, numa máquina que
    # também roda o finance e o lingua. Com o limite, os 75% valem sobre 600m.
    #
    # Este backend não faz nada pesado: sem Whisper, sem síntese de voz, sem
    # processamento de mídia. É CRUD e agregação.
    #
    # memswap igual ao mem_limit = sem swap. O GC toca a heap inteira, então
    # uma JVM em swap para de responder por minutos — indistinguível de queda.
    mem_limit: 600m
    memswap_limit: 600m
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://localhost:8090/api/saude"]
      interval: 30s
      timeout: 5s
      start_period: 60s
      retries: 3
    networks:
      - activity-net
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

  # ------------------------------------------------------------------ túnel
  #
  # Só sobe com `docker compose --profile tunel up -d`. Desligado por padrão
  # porque ele é a única peça que EXPÕE o serviço na internet.
  #
  # Por que cloudflared e não abrir a 443: a VPS não precisa aceitar conexão
  # nenhuma. O cloudflared abre uma conexão de SAÍDA até a Cloudflare e o
  # tráfego volta por ela. Firewall fechado, TLS resolvido lá, e o IP da VPS
  # não aparece em lugar nenhum.
  cloudflared:
    image: cloudflare/cloudflared:latest
    container_name: activity-tunel
    restart: unless-stopped
    profiles: [tunel]
    command: tunnel --no-autoupdate run
    environment:
      TUNNEL_TOKEN: ${AM_TUNEL_TOKEN:?defina AM_TUNEL_TOKEN no .env}
    mem_limit: 128m
    depends_on:
      - activity-backend
    networks:
      - activity-net
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

# NÃO há watchtower aqui, e é de propósito: o compose do finance nesta VPS já
# roda um com WATCHTOWER_LABEL_ENABLE=false, que vigia TODOS os contêineres da
# máquina — inclusive estes. Um segundo seria outro processo disputando o mesmo
# /var/run/docker.sock, e os dois usariam `container_name: watchtower`.

networks:
  activity-net:
    external: true
COMPOSE_SERVICE
ok "service/docker-compose.yml"

# ---------------------------------------------------------------------- banco
azul "5. Subindo o banco"
cd "${RAIZ}/postgres"
if ! docker compose up -d; then
  aviso "o banco não subiu. Veja o erro acima; o .env já está em ${RAIZ}/postgres/.env"
  exit 1
fi
printf '  aguardando ficar saudável'
for _ in $(seq 1 30); do
  if [[ "$(docker inspect -f '{{.State.Health.Status}}' postgres_activity 2>/dev/null)" == "healthy" ]]; then
    printf '\n'; ok "postgres_activity saudável"; break
  fi
  printf '.'; sleep 2
done

# --------------------------------------------------------------------- resumo
CONVITE="$(grep -oP '^AM_CONVITE=\K.*' "${RAIZ}/service/.env")"
azul "6. Pronto até aqui"
cat <<RESUMO

  Estrutura:   ${RAIZ}/{postgres,service}
               (para outro lugar: AM_RAIZ=~/sevices/activity-manager bash instalar.sh)
  Banco:       127.0.0.1:${PORTA_DB}  (só a própria VPS enxerga)
  Convite:     ${CONVITE}
               ↑ você vai digitar isto uma vez em cada dispositivo

  FALTA:

  1) A imagem do backend precisa existir no GHCR. No seu PC:
         git push        (o Actions constrói e publica)

  2) Subir o serviço:
         cd ${RAIZ}/service && docker compose up -d
         docker logs -f activity-backend       # espere "Started Aplicacao"
         curl -fsS localhost:${PORTA_API}/api/saude    # {"estado":"ok"}

  3) Expor pelo subdomínio — no painel da Cloudflare:
         Zero Trust > Networks > Tunnels > Create a tunnel > Cloudflared
         nome: activity-manager
         Public Hostname:
             Subdomain     rastro
             Domain        matheuszem.org
             Service Type  HTTP
             URL           activity-backend:8090

     'activity-backend:8090' e NÃO '127.0.0.1:${PORTA_API}': o conector roda DENTRO
     da rede activity-net, junto do backend, e ali valem o nome do contêiner e
     a porta de dentro.

     Copie o token e:
         sed -i "s|^AM_TUNEL_TOKEN=.*|AM_TUNEL_TOKEN=cole-aqui|" ${RAIZ}/service/.env
         cd ${RAIZ}/service && docker compose --profile tunel up -d
         docker logs -f activity-tunel        # espere "Registered tunnel connection"

  4) No app, aba Rastro > Conta:
         Servidor   https://rastro.matheuszem.org
         E-mail     o seu
         Senha      a que você escolher
         Convite    ${CONVITE}

RESUMO
