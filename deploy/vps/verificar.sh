#!/usr/bin/env bash
#
# Diz em qual camada o Activity Manager parou.
#
# Roda NA VPS, não muda nada e pode ser rodado quantas vezes quiser. Cada passo
# depende do anterior, então ele para no primeiro que falhar — seguir adiante só
# produziria erros em cascata que escondem a causa.
#
#     bash ~/verificar.sh
set -uo pipefail

RAIZ="${AM_RAIZ:-$HOME/activity-manager}"
IMAGEM="ghcr.io/matheuszem12/activity-manager-backend"
PORTA=8091

ok()    { printf '  \033[1;32m✓\033[0m %s\n' "$*"; }
falha() { printf '  \033[1;31m✗\033[0m %s\n' "$*"; }
dica()  { printf '\n    \033[1;33m→\033[0m %s\n\n' "$*"; }
passo() { printf '\033[1;34m%s\033[0m\n' "$*"; }

# --------------------------------------------------------------------- 1. rede
passo "1. Rede"
if docker network inspect activity-net >/dev/null 2>&1; then
  ok "activity-net existe"
else
  falha "activity-net não existe"
  dica "rode o instalador: bash ~/instalar.sh"
  exit 1
fi

# -------------------------------------------------------------------- 2. banco
passo "2. Banco"
estado="$(docker inspect -f '{{.State.Health.Status}}' postgres_activity 2>/dev/null || echo ausente)"
case "${estado}" in
  healthy)  ok "postgres_activity saudável" ;;
  ausente)  falha "postgres_activity não existe"
            dica "cd ${RAIZ}/postgres && docker compose up -d"; exit 1 ;;
  *)        falha "postgres_activity está '${estado}'"
            dica "docker logs postgres_activity"; exit 1 ;;
esac

# ------------------------------------------------------------------- 3. imagem
passo "3. Imagem no GHCR"
if docker pull -q "${IMAGEM}:hmg" >/dev/null 2>&1; then
  ok "${IMAGEM}:hmg disponível"
else
  falha "não consegui puxar ${IMAGEM}:hmg"
  cat <<'DICA'

    Duas causas possíveis, nesta ordem:

    1) A imagem ainda não foi publicada. NO SEU PC:
           git checkout hmg && git merge dev && git push
       e acompanhe em github.com/MatheusZem12/activity-manager/actions
       até o job `backend` ficar verde (leva ~3 min na primeira vez).

       Push em `dev` NÃO publica nada: quem sobe para a VPS é `hmg`.

    2) A VPS não está autenticada no GHCR. O pacote nasce privado:
           echo "SEU_TOKEN" | docker login ghcr.io -u matheuszem12 --password-stdin
       (token clássico do GitHub com APENAS `read:packages` —
        o mesmo que o lingua usa já serve)

DICA
  exit 1
fi

# ------------------------------------------------------------------ 4. serviço
passo "4. Serviço"
estado="$(docker inspect -f '{{.State.Health.Status}}' activity-backend 2>/dev/null || echo ausente)"
if [[ "${estado}" == "ausente" ]]; then
  falha "activity-backend não existe"
  dica "cd ${RAIZ}/service && docker compose up -d"
  exit 1
fi
if [[ "${estado}" != "healthy" ]]; then
  falha "activity-backend está '${estado}'"
  echo
  echo "    Últimas linhas do log:"
  docker logs --tail 15 activity-backend 2>&1 | sed 's/^/      /'
  dica "erro comum: senha do banco diferente entre os dois .env"
  exit 1
fi
ok "activity-backend saudável"

# ---------------------------------------------------------------------- 5. API
passo "5. API"
if resposta="$(curl -fsS --max-time 10 "http://127.0.0.1:${PORTA}/api/saude" 2>/dev/null)"; then
  ok "responde em 127.0.0.1:${PORTA} — ${resposta}"
else
  falha "não responde em 127.0.0.1:${PORTA}"
  dica "docker logs activity-backend"
  exit 1
fi

# -------------------------------------------------------------------- 6. túnel
passo "6. Túnel"
token="$(grep -oP '^AM_TUNEL_TOKEN=\K.+' "${RAIZ}/service/.env" 2>/dev/null || true)"
if [[ -z "${token}" ]]; then
  printf '  \033[1;33m-\033[0m %s\n' "AM_TUNEL_TOKEN vazio — nada exposto na internet (ainda)"
  dica "veja o passo do subdomínio no README de deploy"
elif docker ps --filter name=activity-tunel --format '{{.Names}}' | grep -q .; then
  if docker logs activity-tunel 2>&1 | grep -q "Registered tunnel connection"; then
    ok "activity-tunel conectado à Cloudflare"
  else
    falha "activity-tunel subiu mas não registrou conexão"
    docker logs --tail 10 activity-tunel 2>&1 | sed 's/^/      /'
  fi
else
  falha "token preenchido mas o túnel não está rodando"
  dica "cd ${RAIZ}/service && docker compose --profile tunel up -d"
fi

# ------------------------------------------------------------------- 7. função
passo "7. Teste funcional"
convite="$(grep -oP '^AM_CONVITE=\K.+' "${RAIZ}/service/.env" 2>/dev/null || true)"
printf '  Convite desta instalação: \033[1m%s\033[0m\n' "${convite:-<não encontrado>}"
contas="$(docker exec postgres_activity psql -U activity -d activity_manager -tAc \
  'select count(*) from usuario' 2>/dev/null || echo '?')"
ok "${contas} conta(s) criada(s)"

echo
if [[ "${contas}" == "0" ]]; then
  cat <<DICA
  Tudo de pé. Crie a primeira conta pelo app (aba Rastro > Conta) ou daqui:

      curl -s -X POST http://127.0.0.1:${PORTA}/api/sessao \\
        -H 'content-type: application/json' \\
        -d '{"email":"voce@exemplo.com","senha":"escolha-uma","convite":"${convite}"}'

DICA
else
  printf '  \033[1;32mTudo de pé.\033[0m\n\n'
fi
