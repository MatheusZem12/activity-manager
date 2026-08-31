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

# Porta ocupada é o jeito mais rápido de a subida falhar sem dizer por quê.
for porta in 5434 8091; do
  if ss -lptn 2>/dev/null | grep -q ":${porta} "; then
    aviso "porta ${porta} já está em uso — ajuste AM_DB_PORTA/AM_PORTA_HOST no .env"
  fi
done

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
AM_DB_PORTA=5434
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
AM_PORTA_HOST=8091

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
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
for parte in postgres service; do
  if [[ -f "${AQUI}/${parte}/docker-compose.yml" ]]; then
    cp "${AQUI}/${parte}/docker-compose.yml" "${RAIZ}/${parte}/docker-compose.yml"
    ok "${parte}/docker-compose.yml"
  else
    aviso "${parte}/docker-compose.yml não encontrado ao lado deste script"
  fi
done

# ---------------------------------------------------------------------- banco
azul "5. Subindo o banco"
cd "${RAIZ}/postgres"
docker compose up -d
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
         git push        (o Actions constrói e publica)

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
