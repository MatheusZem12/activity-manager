/**
 * As atividades — agora no banco, não em arquivo.
 *
 * O dono do dado é o backend. Este arquivo é um **espelho**: guarda em memória
 * o que o servidor devolveu, para que as leituras continuem síncronas e o
 * renderer não precise saber que algo mudou. Escrita vai para a API e só então
 * atualiza o espelho — o banco decide, o espelho reflete.
 *
 * A tradução de nomes acontece aqui de propósito. A API fala `texto`,
 * `alertaMin`, `venceEm`; o renderer fala `text`, `reminderMinutes`, `dueAt`.
 * Trocar o vocabulário de 1600 linhas de tela para renomear cinco campos seria
 * um risco sem retorno.
 */
const api = require('./api-client');

let espelho = [];
let carregado = false;

/** Da forma da API para a forma que a tela conhece. */
function daApi(a) {
  return {
    id: a.id,
    text: a.texto,
    tags: a.tags || [],
    reminderMinutes: a.alertaMin || 30,
    dueAt: a.venceEm ? Date.parse(a.venceEm) : null,
    createdAt: Date.parse(a.criadaEm),
    completedAt: a.concluidaEm ? Date.parse(a.concluidaEm) : null
  };
}

function paraApi(patch) {
  const corpo = {};
  if (patch.text !== undefined) corpo.texto = patch.text;
  if (patch.tags !== undefined) corpo.tags = patch.tags;
  if (patch.reminderMinutes !== undefined) corpo.alertaMin = patch.reminderMinutes;
  if (patch.dueAt !== undefined && patch.dueAt !== null) corpo.venceEm = new Date(patch.dueAt).toISOString();
  if (patch.createdAt !== undefined) corpo.criadaEm = new Date(patch.createdAt).toISOString();
  return corpo;
}

/** Puxa tudo do servidor. Chamado na subida e depois de cada escrita. */
async function carregar() {
  const { atividades } = await api.pedir('/atividades');
  espelho = atividades.map(daApi);
  carregado = true;
  return espelho;
}

function pronto() {
  return carregado;
}

// ------------------------------------------------------- leituras (síncronas)

function getAll() {
  return espelho;
}

function getPending() {
  return espelho.filter((a) => !a.completedAt);
}

function getCompleted() {
  return espelho.filter((a) => a.completedAt);
}

function getActivity(id) {
  return espelho.find((a) => a.id === id) || null;
}

function exportAll() {
  return { version: 2, activities: espelho };
}

// ------------------------------------------------------- escritas (assíncronas)

async function saveActivity(patch) {
  const salva = patch.id
    ? await api.pedir(`/atividades/${patch.id}`, { metodo: 'PATCH', corpo: paraApi(patch) })
    : await api.pedir('/atividades', { metodo: 'POST', corpo: paraApi(patch) });
  await carregar();
  return daApi(salva);
}

async function snoozeActivity(id, minutos) {
  const salva = await api.pedir(`/atividades/${id}/adiar`, { metodo: 'POST', corpo: { minutos } });
  await carregar();
  return daApi(salva);
}

async function completeActivity(id) {
  const salva = await api.pedir(`/atividades/${id}/concluir`, { metodo: 'POST' });
  await carregar();
  return daApi(salva);
}

async function reopenActivity(id) {
  const salva = await api.pedir(`/atividades/${id}/reabrir`, { metodo: 'POST' });
  await carregar();
  return daApi(salva);
}

async function deleteActivity(id) {
  await api.pedir(`/atividades/${id}`, { metodo: 'DELETE' });
  await carregar();
  return true;
}

/**
 * Importa um backup — e é também o caminho do JSON antigo para o banco.
 *
 * O servidor recusa duplicata por (texto, instante de criação), então rodar duas
 * vezes não multiplica nada.
 */
async function importAll(data) {
  if (!data || !Array.isArray(data.activities)) {
    throw new Error('Arquivo de backup inválido.');
  }
  const lote = data.activities.map((a) => ({
    texto: a.text,
    tags: a.tags || [],
    alertaMin: a.reminderMinutes || 30,
    venceEm: a.dueAt ? new Date(a.dueAt).toISOString() : null,
    criadaEm: new Date(a.createdAt || Date.now()).toISOString()
  }));
  const r = await api.pedir('/atividades/importar', { metodo: 'POST', corpo: lote });
  await carregar();
  return { count: r.importadas };
}

module.exports = {
  carregar,
  pronto,
  getAll,
  getPending,
  getCompleted,
  getActivity,
  saveActivity,
  snoozeActivity,
  completeActivity,
  reopenActivity,
  deleteActivity,
  exportAll,
  importAll
};
