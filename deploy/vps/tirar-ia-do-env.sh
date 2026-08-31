#!/usr/bin/env bash
#
# Tira as variáveis de IA do .env do servidor.
#
#     bash ~/tirar-ia-do-env.sh
#
# O servidor não fala com modelo nenhum: ele monta a pergunta e o schema — que é
# regra de negócio — e enfileira. Quem executa é sempre uma máquina do usuário,
# com o que ela tiver: o `claude` logado, um modelo no ollama, ou uma chave de
# API guardada localmente.
#
# Então AM_IA_PROVEDOR, AM_IA_CHAVE, AM_IA_MODELO e AM_IA_TIMEOUT não têm o que
# fazer aqui. Chave de IA num servidor é uma credencial a mais para vazar, para
# rotacionar e para pagar sem saber por quem.
#
# AM_IA_RESERVA **fica**: ele não é sobre IA, é sobre a fila — quanto tempo uma
# tarefa fica reservada para um dispositivo antes de voltar para a fila sozinha.
set -euo pipefail

ENV="${1:-$HOME/activity-manager/service/.env}"

ok()    { printf '  \033[1;32m✓\033[0m %s\n' "$*"; }
aviso() { printf '  \033[1;33m!\033[0m %s\n' "$*"; }

[[ -f "${ENV}" ]] || { echo "não achei ${ENV}"; exit 1; }

# Cópia antes de mexer. É o .env de produção; um sed errado aqui custa o segredo
# do JWT e a senha do banco.
COPIA="${ENV}.antes-de-tirar-ia"
cp "${ENV}" "${COPIA}"
ok "cópia em ${COPIA}"

antes="$(grep -c '^AM_IA_' "${ENV}" || true)"

# Só as quatro que somem. AM_IA_RESERVA não entra na lista de propósito.
sed -i -E '/^AM_IA_(PROVEDOR|CHAVE|MODELO|TIMEOUT)=/d' "${ENV}"

# Os comentários órfãos saem linha a linha, NUNCA por intervalo.
#
# A primeira versão usava `sed '/inicio/,/^AM_IA_MODELO/d'` — e o fim do
# intervalo era uma linha que o comando anterior já tinha apagado. Sem encontrar
# o fim, o sed apaga da abertura até o FIM DO ARQUIVO: no teste, levou junto o
# AM_TUNEL_TOKEN e derrubaria o túnel em produção, em silêncio.
#
# Intervalo de sed cujo fim pode não existir é uma arma apontada para o resto do
# arquivo. Apagar por padrão exato, uma linha de cada vez, não tem esse modo de
# falha.
sed -i -E '/^# *.?local.? *= *o servidor N[AÃ]O chama/d' "${ENV}"
sed -i -E '/^# *dispositivo seu executa no ollama/d' "${ENV}"
sed -i -E '/^# *[úu]nico modo em que a VPS n[aã]o precisa de chave/d' "${ENV}"
sed -i -E '/^# *Para o servidor classificar sozinho/d' "${ENV}"
sed -i -E '/^# *preencha AM_IA_CHAVE/d' "${ENV}"

depois="$(grep -c '^AM_IA_' "${ENV}" || true)"
ok "removidas $((antes - depois)) variáveis de IA"

# Rede de segurança: confere que nada além das quatro sumiu. Um .env de produção
# perdendo uma linha em silêncio é o pior desfecho possível aqui.
for obrigatoria in AM_JWT_SEGREDO AM_CONVITE AM_DB_SENHA AM_TUNEL_TOKEN AM_TAG AM_PORTA_HOST; do
  if grep -q "^${obrigatoria}=" "${COPIA}" && ! grep -q "^${obrigatoria}=" "${ENV}"; then
    aviso "${obrigatoria} sumiu — restaurando a cópia e abortando"
    cp "${COPIA}" "${ENV}"
    exit 1
  fi
done
ok "nenhuma outra variável foi perdida"

if grep -q '^AM_IA_RESERVA=' "${ENV}"; then
  ok "AM_IA_RESERVA preservada (é da fila, não da IA)"
else
  # Sem ela o backend usa o padrão de 10 minutos, mas explícito é melhor.
  printf '\n# Prazo da reserva de uma tarefa por um dispositivo, em minutos.\n' >> "${ENV}"
  printf '# Máquina que desliga no meio devolve a tarefa sozinha quando isto vence.\n' >> "${ENV}"
  printf 'AM_IA_RESERVA=10\n' >> "${ENV}"
  ok "AM_IA_RESERVA=10 adicionada"
fi

echo
echo "  O .env agora:"
sed -E 's/(SENHA|SEGREDO|TOKEN|PASSWORD)=.+/\1=<oculto>/' "${ENV}" | grep -v '^#' | grep . | sed 's/^/    /'

cat <<'FIM'

  Para valer, recrie o contêiner:

      cd ~/activity-manager/service && docker compose up -d

  A configuração de IA agora fica no app: aba Rastro > Conta > "IA nesta
  máquina". A chave, se houver, nunca sai do dispositivo.

FIM
