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

# ~/activity-manager, e não junto do lingua em ~/sevices: são projetos
# independentes, com bancos, redes e ciclos de atualização separados. AM_RAIZ
# existe como escape, não como recomendação.
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

# As portas sao fixas no compose (5434 e 8091), como no lingua. Checar antes
# vale porque o erro do Docker -- "Bind for 0.0.0.0:5434 failed" -- nao diz o
# que fazer, e ai a instalacao morre no meio com o .env ja escrito.
ocupada=0
for porta in 5434 8091; do
  if ss -lntH 2>/dev/null | grep -qE "[:.]${porta}[[:space:]]"; then
    aviso "porta ${porta} ja esta em uso"
    ocupada=1
  fi
done
if [[ ${ocupada} -eq 1 ]]; then
  echo
  echo "  Nesta VPS a 5432/8080 e do finance e a 5433/8090 do lingua."
  echo "  Se outro servico pegou 5434 ou 8091, edite as portas em:"
  echo "      ${RAIZ}/postgres/docker-compose.yml   (linha ports:)"
  echo "      ${RAIZ}/service/.env                  (AM_PORTA_HOST)"
  echo "  e rode de novo."
  exit 1
fi
ok "portas 5434 e 8091 livres"

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
# A MESMA senha vai em ../service/.env como AM_DB_SENHA.
POSTGRES_PASSWORD=${SENHA_DB}
EOF
  chmod 600 "${RAIZ}/postgres/.env"
  ok "postgres/.env criado, senha gerada"
fi

if [[ -f "${RAIZ}/service/.env" ]]; then
  ok "service/.env preservado"
else
  cat > "${RAIZ}/service/.env" <<EOF
# --- banco (a MESMA senha de ../postgres/.env) ---
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
AM_PORTA_HOST=8091

# --- imagem ---
AM_TAG=hmg

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
AM_IA_RESERVA=10

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
services:
  db:
    image: postgres:16
    container_name: postgres_activity
    restart: always
    environment:
      POSTGRES_USER: activity
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: activity_manager
    ports:
      # Bloqueio de seguranca: o banco so ouve a propria VPS (127.0.0.1)
      # 5434 e nao 5432: a 5432 e do postgres_finance e a 5433 do postgres_lingua
      - "127.0.0.1:5434:5432"
    # Segmento de foco e linha curta e numerica -- um ano de uso nao chega perto
    # de encher isto. Serve para limitar crescimento, nao para apertar.
    mem_limit: 512m
    # Sem isto o log json-file cresce para sempre e enche o disco.
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
    # O passo a passo manda esperar o banco ficar `healthy` antes de subir o
    # app. Sem healthcheck, "esperar" vira "contar ate dez".
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U activity -d activity_manager"]
      interval: 10s
      timeout: 5s
      retries: 10
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - activity-net

volumes:
  postgres_data:

networks:
  activity-net:
    external: true
COMPOSE_POSTGRES
ok "postgres/docker-compose.yml"

cat > "${RAIZ}/service/docker-compose.yml" <<'COMPOSE_SERVICE'
services:
  activity-backend:
    image: ghcr.io/matheuszem12/activity-manager-backend:${AM_TAG:-hmg}
    container_name: activity-backend
    restart: unless-stopped
    ports:
      # 8091 e nao 8090: a 8080 e do finance-backend e a 8090 do lingua-backend
      # nesta maquina. Loopback, como o resto -- o acesso de fora e pelo tunel.
      - "127.0.0.1:${AM_PORTA_HOST:-8091}:8090"
    env_file:
      - .env
    environment:
      # `postgres_activity` e o nome do CONTAINER do outro compose, e 5432 e a
      # porta de DENTRO dele -- a 5434 do host nao tem nada a ver com isto. Os
      # dois se encontram pela rede activity-net, externa aos dois.
      AM_DB_URL: jdbc:postgresql://postgres_activity:5432/activity_manager
      # Fixa, e DEPOIS do env_file para vencer qualquer valor que caia la. O
      # env_file despeja o .env INTEIRO no container, e a aplicacao le AM_PORTA
      # para escolher a porta do Tomcat: com o mesmo nome nos dois lados, por
      # 8091 no .env faria o servidor escutar em 8091 la dentro enquanto o
      # mapeamento aponta para a 8090. Nada responderia, e o log diria
      # "Started" -- a pior combinacao possivel.
      AM_PORTA: 8090
    # A JVM roda com -XX:MaxRAMPercentage=75 (Dockerfile), e esse percentual e
    # sobre a memoria que ela ENXERGA. Sem limite aqui ela enxerga o host
    # inteiro, numa maquina que tambem roda o finance e o lingua.
    #
    # 600m e menos que os 1200m do lingua porque aqui nao ha Whisper nem sintese
    # de voz: e CRUD e agregacao.
    #
    # memswap igual a mem_limit = este container nao usa swap. Nao e descuido: o
    # GC toca a heap inteira, entao uma JVM em swap para de responder por minutos
    # -- indistinguivel de uma queda, so que mais dificil de diagnosticar.
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

  # ------------------------------------------------------------------ tunel
  #
  # So sobe com `docker compose --profile tunel up -d`. Fica desligado por
  # padrao porque ele e a unica peca que EXPOE o servico na internet.
  #
  # Por que cloudflared e nao abrir a porta 443: a VPS nao precisa aceitar
  # conexao nenhuma de fora. O cloudflared abre uma conexao de SAIDA ate a
  # Cloudflare e o trafego volta por ela. Firewall fechado, TLS resolvido la, e
  # o IP da VPS nao aparece em lugar nenhum.
  cloudflared:
    image: cloudflare/cloudflared:latest
    container_name: activity-tunel
    restart: unless-stopped
    profiles: [tunel]
    command: tunnel --no-autoupdate run
    environment:
      # `:-` e nao `:?`. A forma com `:?` parece melhor -- ela recusa subir sem
      # token -- mas o Compose interpola o arquivo INTEIRO antes de filtrar por
      # profile, entao ela quebrava `docker compose up -d` sem o perfil `tunel`,
      # com o backend nem tendo relacao com isso.
      #
      # Sem token o cloudflared falha ao iniciar, e a falha fica contida nele.
      TUNNEL_TOKEN: ${AM_TUNEL_TOKEN:-}
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

# NAO ha watchtower aqui, e e de proposito -- o mesmo motivo do lingua: o que ja
# roda nesta VPS (no compose do finance-backend) esta com
# WATCHTOWER_LABEL_ENABLE: false, ou seja, vigia TODOS os containers da maquina,
# inclusive estes. Um segundo seria outro processo disputando o mesmo
# /var/run/docker.sock, e os dois usam `container_name: watchtower`.

# Rede compartilhada externa -- criada UMA vez fora deste compose
# (docker network create activity-net) e usada tambem pelo container do Postgres
# (postgres_activity). Por ser "external", este compose nao cria nem destroi a
# rede; so se conecta a ela.
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
  Banco:       127.0.0.1:5434  (só a própria VPS enxerga)
  Convite:     ${CONVITE}
               ↑ você vai digitar isto uma vez em cada dispositivo

  FALTA:

  1) A imagem do backend precisa existir no GHCR. No seu PC:
         git checkout hmg && git merge dev && git push
         (push em `dev` não publica nada — quem sobe é `hmg`)

  2) Subir o serviço:
         cd ${RAIZ}/service && docker compose up -d
         docker logs -f activity-backend       # espere "Started Aplicacao"
         curl -fsS localhost:8091/api/saude    # {"estado":"ok"}

  3) Expor pelo subdomínio — no painel da Cloudflare:
         Zero Trust > Networks > Tunnels > Create a tunnel > Cloudflared
         nome: activity-manager
         Public Hostname:
             Subdomain     rastro
             Domain        matheuszem.org
             Service Type  HTTP
             URL           activity-backend:8090

     'activity-backend:8090' e NÃO '127.0.0.1:8091': o conector roda DENTRO
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
