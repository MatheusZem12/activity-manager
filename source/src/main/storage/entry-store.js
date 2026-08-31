/**
 * Os textos do clipboard — agora no banco, não em arquivo.
 *
 * Mesmo desenho do `activity-store`: o backend é dono do dado, isto aqui é um
 * espelho em memória para as leituras seguirem síncronas.
 *
 * O invariante que não pode quebrar: `content` viaja e volta **literalmente**.
 * Nada de trim, nada de normalizar quebra de linha — é exatamente isso que vai
 * para o clipboard.
 */
const api = require('./api-client');

let espelho = [];
let carregado = false;

function daApi(t) {
  return {
    id: t.id,
    title: t.titulo || '',
    content: t.conteudo,
    tags: t.tags || [],
    createdAt: Date.parse(t.criadoEm),
    updatedAt: Date.parse(t.criadoEm),
    lastCopiedAt: t.copiadoEm ? Date.parse(t.copiadoEm) : null,
    copyCount: t.copias || 0
  };
}

async function carregar() {
  const { textos } = await api.pedir('/textos');
  espelho = textos.map(daApi);
  carregado = true;
  return espelho;
}

function pronto() {
  return carregado;
}

function getAll() {
  return espelho;
}

function getEntry(id) {
  return espelho.find((e) => e.id === id) || null;
}

function exportAll() {
  return { version: 2, entries: espelho };
}

async function saveEntry(patch) {
  const corpo = {};
  if (patch.title !== undefined) corpo.titulo = patch.title;
  if (patch.content !== undefined) corpo.conteudo = patch.content;
  if (patch.tags !== undefined) corpo.tags = patch.tags;

  const salvo = patch.id
    ? await api.pedir(`/textos/${patch.id}`, { metodo: 'PATCH', corpo })
    : await api.pedir('/textos', { metodo: 'POST', corpo });
  await carregar();
  return daApi(salvo);
}

async function markCopied(id) {
  const salvo = await api.pedir(`/textos/${id}/copiar`, { metodo: 'POST' });
  await carregar();
  return daApi(salvo);
}

async function deleteEntry(id) {
  await api.pedir(`/textos/${id}`, { metodo: 'DELETE' });
  await carregar();
  return true;
}

async function importAll(data) {
  if (!data || !Array.isArray(data.entries)) {
    throw new Error('Arquivo de backup inválido.');
  }
  const lote = data.entries.map((e) => ({
    titulo: e.title || '',
    conteudo: e.content,
    tags: e.tags || [],
    copias: e.copyCount || 0,
    copiadoEm: e.lastCopiedAt ? new Date(e.lastCopiedAt).toISOString() : null,
    criadoEm: new Date(e.createdAt || Date.now()).toISOString()
  }));
  const r = await api.pedir('/textos/importar', { metodo: 'POST', corpo: lote });
  await carregar();
  return { count: r.importados };
}

module.exports = {
  carregar,
  pronto,
  getAll,
  getEntry,
  saveEntry,
  markCopied,
  deleteEntry,
  exportAll,
  importAll
};
