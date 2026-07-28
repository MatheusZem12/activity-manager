const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const STATE_FILE = 'entries.json';

function statePath() {
  return path.join(app.getPath('userData'), STATE_FILE);
}

function genId() {
  return `entry_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function defaultState() {
  return { version: 1, entries: [] };
}

function dedupeTags(raw) {
  const out = [];
  for (const t of raw) {
    const tag = String(t).trim().toLowerCase();
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out;
}

/**
 * Normaliza uma entrada. As regras aqui são o invariante do arquivo:
 *
 * - title: string trimmed (o parser já removeu os #tags antes de chegar aqui);
 *   pode ficar vazio — a exibição deriva o título da 1ª linha do conteúdo;
 * - content: string preservada **literalmente** (nunca trim, nunca parse) —
 *   é exatamente o que será colado no clipboard;
 * - tags: lowercase, sem duplicatas;
 * - lastCopiedAt: epoch ms da última cópia via app, null até a primeira;
 * - copyCount: contador de cópias.
 */
function normalizeEntry(raw = {}) {
  const now = Date.now();
  return {
    id: raw.id || genId(),
    title: (raw.title || '').trim(),
    content: typeof raw.content === 'string' ? raw.content : String(raw.content || ''),
    tags: Array.isArray(raw.tags) ? dedupeTags(raw.tags) : [],
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : now,
    lastCopiedAt: typeof raw.lastCopiedAt === 'number' ? raw.lastCopiedAt : null,
    copyCount: typeof raw.copyCount === 'number' ? raw.copyCount : 0
  };
}

// O arquivo só é tocado por este processo, então dá para ler uma vez e
// trabalhar em memória; o disco é atualizado a cada gravação.
let cache = null;

function loadState() {
  if (cache) return cache;
  try {
    const data = JSON.parse(fs.readFileSync(statePath(), 'utf-8'));
    cache = {
      version: data.version || 1,
      entries: Array.isArray(data.entries) ? data.entries.map(normalizeEntry) : []
    };
  } catch {
    cache = defaultState();
  }
  return cache;
}

function saveState(state) {
  cache = state;
  fs.writeFileSync(statePath(), JSON.stringify(state, null, 2), 'utf-8');
  return state;
}

function getAll() {
  return loadState().entries;
}

function getEntry(id) {
  return loadState().entries.find((e) => e.id === id) || null;
}

/**
 * Cria (unshift, mais novas primeiro) ou atualiza uma entrada. Numa atualização
 * o updatedAt é reescrito; createdAt/lastCopiedAt/copyCount são preservados a
 * menos que o patch os traga.
 */
function saveEntry(patch) {
  const state = loadState();
  const index = patch.id ? state.entries.findIndex((e) => e.id === patch.id) : -1;

  let saved;
  if (index === -1) {
    saved = normalizeEntry(patch);
    state.entries.unshift(saved);
  } else {
    const current = state.entries[index];
    saved = normalizeEntry({ ...current, ...patch, id: current.id, updatedAt: Date.now() });
    state.entries[index] = saved;
  }

  saveState(state);
  return saved;
}

/**
 * Marca uma entrada como copiada agora: atualiza lastCopiedAt e incrementa
 * copyCount. Devolve a entrada atualizada (ou null se não existir).
 */
function markCopied(id) {
  const state = loadState();
  const index = state.entries.findIndex((e) => e.id === id);
  if (index === -1) return null;
  state.entries[index].lastCopiedAt = Date.now();
  state.entries[index].copyCount = (state.entries[index].copyCount || 0) + 1;
  saveState(state);
  return state.entries[index];
}

function deleteEntry(id) {
  const state = loadState();
  state.entries = state.entries.filter((e) => e.id !== id);
  saveState(state);
  return true;
}

function exportAll() {
  return loadState();
}

function importAll(data) {
  if (!data || !Array.isArray(data.entries)) {
    throw new Error('Arquivo de backup inválido.');
  }
  const state = {
    version: data.version || 1,
    entries: data.entries.map(normalizeEntry)
  };
  saveState(state);
  return { count: state.entries.length };
}

module.exports = {
  getAll,
  getEntry,
  saveEntry,
  markCopied,
  deleteEntry,
  exportAll,
  importAll
};
