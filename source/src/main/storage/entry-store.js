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
 * Normalizes an entry. The rules here are the invariant of the file:
 *
 * - title: a trimmed string (the parser already removed the #tags before this);
 *   it may be empty — the display derives the title from the content's 1st line;
 * - content: a string kept **literally** (never trimmed, never parsed) —
 *   it is exactly what gets pasted to the clipboard;
 * - tags: lowercase, no duplicates;
 * - lastCopiedAt: epoch ms of the last copy through the app, null until the first;
 * - copyCount: a copy counter.
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

// The file is only touched by this process, so it can be read once and
// worked on in memory; the disk is updated on every write.
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
 * Creates (unshift, newest first) or updates an entry. On an update the
 * updatedAt is rewritten; createdAt/lastCopiedAt/copyCount are kept unless
 * the patch brings them.
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
 * Marks an entry as copied now: updates lastCopiedAt and increments
 * copyCount. Returns the updated entry (or null if it doesn't exist).
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
    throw new Error('Invalid backup file.');
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
