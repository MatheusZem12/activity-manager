const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const STATE_FILE = 'activities.json';

function statePath() {
  return path.join(app.getPath('userData'), STATE_FILE);
}

function genId() {
  return `act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function defaultState() {
  return { version: 1, activities: [] };
}

function normalizeActivity(raw = {}) {
  return {
    id: raw.id || genId(),
    text: (raw.text || '').trim(),
    tags: Array.isArray(raw.tags) ? raw.tags.map((t) => String(t).trim().toLowerCase()) : [],
    reminderMinutes: Math.max(1, parseInt(raw.reminderMinutes, 10) || 1),
    dueAt: typeof raw.dueAt === 'number' ? raw.dueAt : Date.now(),
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    completedAt: raw.completedAt || null
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
      activities: Array.isArray(data.activities) ? data.activities.map(normalizeActivity) : []
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
  return loadState().activities;
}

function getPending() {
  return getAll().filter((a) => !a.completedAt);
}

function getCompleted() {
  return getAll().filter((a) => a.completedAt);
}

function getActivity(id) {
  return loadState().activities.find((a) => a.id === id) || null;
}

function saveActivity(patch) {
  const state = loadState();
  const index = patch.id ? state.activities.findIndex((a) => a.id === patch.id) : -1;

  let saved;
  if (index === -1) {
    saved = normalizeActivity(patch);
    state.activities.unshift(saved);
  } else {
    saved = normalizeActivity({ ...state.activities[index], ...patch, id: state.activities[index].id });
    state.activities[index] = saved;
  }

  saveState(state);
  return saved;
}

function completeActivity(id) {
  const state = loadState();
  const index = state.activities.findIndex((a) => a.id === id);
  if (index === -1) return null;
  state.activities[index].completedAt = Date.now();
  saveState(state);
  return state.activities[index];
}

/** Snoozing only moves the due time; the `!N` interval stays the same. */
function snoozeActivity(id, minutes) {
  if (!getActivity(id)) return null;
  return saveActivity({ id, dueAt: Date.now() + minutes * 60 * 1000 });
}

/** Reopening goes back to pending and restarts the alert countdown from now. */
function reopenActivity(id) {
  const current = getActivity(id);
  if (!current) return null;
  return saveActivity({ id, completedAt: null, dueAt: Date.now() + current.reminderMinutes * 60 * 1000 });
}

function deleteActivity(id) {
  const state = loadState();
  state.activities = state.activities.filter((a) => a.id !== id);
  saveState(state);
  return true;
}

function exportAll() {
  return loadState();
}

function importAll(data) {
  if (!data || !Array.isArray(data.activities)) {
    throw new Error('Invalid backup file.');
  }
  const state = {
    version: data.version || 1,
    activities: data.activities.map(normalizeActivity)
  };
  saveState(state);
  return { count: state.activities.length };
}

module.exports = {
  getAll,
  getPending,
  getCompleted,
  getActivity,
  saveActivity,
  completeActivity,
  snoozeActivity,
  reopenActivity,
  deleteActivity,
  exportAll,
  importAll
};
