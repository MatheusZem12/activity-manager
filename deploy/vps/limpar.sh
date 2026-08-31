#!/usr/bin/env bash
#
# Apaga TUDO do Activity Manager nesta VPS: contêineres, volumes, rede e a
# pasta ~/activity-manager inteira — inclusive os `.env` com os segredos.
#
#     bash ~/limpar.sh
#
# Depois disto o `instalar.sh` recomeça do zero e gera outro convite e outro
# segredo de JWT. As sessões dos seus aparelhos morrem junto: você entra de novo
# em cada um, com o convite novo.
#
# NÃO toca em nada do lingua nem do finance. Cada nome aqui é literal e do
# activity-manager; não há `prune`, nem filtro por padrão, nem `-a`. Um `docker
# system prune` levaria junto imagem e volume dos outros projetos desta máquina.
set -uo pipefail

RAIZ="${AM_RAIZ:-$HOME/activity-manager}"

ok()    { printf '  \033[1;32m✓\033[0m %s\n' "$*"; }
pulou() { printf '  \033[1;90m·\033[0m %s\n' "$*"; }
passo() { printf '\033[1;34m%s\033[0m\n' "$*"; }

# ------------------------------------------------------------------ confirmação
cat <<AVISO

  Isto vai apagar, DESTA VPS:

    contêineres  activity-backend, activity-tunel, postgres_activity
    volumes      postgres_postgres_data  (o BANCO INTEIRO — sem volta)
    rede         activity-net
    pasta        ${RAIZ}  (inclusive os .env e os segredos)

  O lingua e o finance não são tocados.

AVISO
read -r -p "  Digite 'apagar' para confirmar: " resposta
[[ "${resposta}" == "apagar" ]] || { echo "  cancelado."; exit 1; }
echo

# ------------------------------------------------------------------ contêineres
passo "1. Contêineres"
# `down` antes de `rm` para o Compose remover também o que ele criou junto. Se a
# pasta já sumiu, o `rm` direto adiante resolve.
for parte in service postgres; do
  if [[ -f "${RAIZ}/${parte}/docker-compose.yml" ]]; then
    (cd "${RAIZ}/${parte}" && docker compose --profile tunel down --volumes --remove-orphans >/dev/null 2>&1) \
      && ok "compose down: ${parte}" || pulou "compose down: ${parte} (nada a derrubar)"
  fi
done
for nome in activity-backend activity-tunel postgres_activity; do
  if docker rm -f "${nome}" >/dev/null 2>&1; then ok "removido: ${nome}"; else pulou "não existia: ${nome}"; fi
done

# ---------------------------------------------------------------------- volumes
passo "2. Volumes"
# Os nomes levam o prefixo do diretório do compose (`postgres_`), que é como o
# Compose nomeia volume sem `name:` no arquivo.
for vol in postgres_postgres_data activity-manager_activity-manager-banco; do
  if docker volume rm "${vol}" >/dev/null 2>&1; then ok "removido: ${vol}"; else pulou "não existia: ${vol}"; fi
done

# ------------------------------------------------------------------------- rede
passo "3. Rede"
if docker network rm activity-net >/dev/null 2>&1; then ok "removida: activity-net"; else pulou "não existia: activity-net"; fi

# ----------------------------------------------------------------------- imagem
passo "4. Imagem"
# Só a do activity-manager. A do Postgres fica: é compartilhada com os outros
# projetos desta máquina, e baixar 400 MB de novo por nada não ajuda ninguém.
if docker rmi -f "$(docker images -q 'ghcr.io/matheuszem12/activity-manager-backend' 2>/dev/null)" >/dev/null 2>&1; then
  ok "removida: activity-manager-backend"
else
  pulou "nenhuma imagem do activity-manager baixada"
fi

# ------------------------------------------------------------------------ pasta
passo "5. Pasta"
if [[ -d "${RAIZ}" ]]; then
  rm -rf "${RAIZ}"
  ok "removida: ${RAIZ}"
else
  pulou "não existia: ${RAIZ}"
fi

# ----------------------------------------------------------------------- sobrou
passo "6. Conferindo"
sobrou=0
for nome in activity-backend activity-tunel postgres_activity; do
  docker ps -a --filter "name=^${nome}$" --format '{{.Names}}' | grep -q . && { echo "  ainda existe: ${nome}"; sobrou=1; }
done
[[ -d "${RAIZ}" ]] && { echo "  ainda existe: ${RAIZ}"; sobrou=1; }
[[ ${sobrou} -eq 0 ]] && ok "nada do activity-manager restou"

echo
echo "  O lingua continua de pé? (deve listar os contêineres dele)"
docker ps --filter name=lingua --format '    {{.Names}}  {{.Status}}' || true

cat <<'FIM'

  Para recomeçar:
      bash ~/instalar.sh

FIM
