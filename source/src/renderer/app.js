const API = window.activityAPI;
const Parser = window.ActivityParser;
const EntryParser = window.EntryParser;

const params = new URLSearchParams(window.location.search);
const mode = params.get('mode') || 'panel';

const appEl = document.getElementById('app');

let state = { activities: [], entries: [], config: {} };

// UI state — it survives the re-renders triggered by events from main, so
// what is being typed is never wiped.
let currentScreen = 'dashboard';
let searchQuery = '';
let activeTag = null;
let completedLimit = 20;
let editingId = null;
let editDraft = '';
let dashDraft = '';
let quickDraft = '';

// Clipboard tab (inside the panel)
let clipSearchQuery = '';
let clipActiveTag = null;
let clipSort = 'recent'; // 'recent' | 'copied'
let editingEntryId = null;
let editEntryTitleDraft = '';
let editEntryContentDraft = '';
let addEntryTitleDraft = '';
let addEntryContentDraft = '';

// Settings tab — sub-tabs (general/shortcuts/alerts) and the draft of the
// edits, see renderSettings().
let settingsTab = 'general';
let settingsDraft = null;

// Quick text capture window
let clipTitleDraft = '';
let clipContentDraft = '';

// ---------- Utilities ----------

function formatDuration(ms) {
  if (!ms || ms < 0) return '—';
  const totalMinutes = Math.round(ms / 60000);
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) return minutes > 0 ? `${hours}h ${minutes}min` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}

function formatTime(timestamp) {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

function timeUntil(timestamp) {
  const diff = timestamp - Date.now();
  if (diff <= 0) return 'now';
  return `in ${formatDuration(diff)}`;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function maxLen() {
  return state.config.maxTextLength || 120;
}

function defaultMinutes() {
  return state.config.defaultReminderMinutes || 15;
}

function maxTitleLen() {
  return state.config.maxTitleLength || 120;
}

function allTags() {
  const counts = {};
  for (const a of state.activities) {
    for (const t of a.tags) counts[t] = (counts[t] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

/** Tags of the clipboard texts — counted apart from the activity ones. */
function allEntryTags() {
  const counts = {};
  for (const e of state.entries) {
    for (const t of e.tags) counts[t] = (counts[t] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

function findActivity(id) {
  return state.activities.find((a) => a.id === id) || null;
}

function findEntry(id) {
  return state.entries.find((e) => e.id === id) || null;
}

/** Displayed title: the stored one or, if empty, the content's 1st line (60 chars). */
function displayTitle(entry) {
  if (entry.title && entry.title.trim()) return entry.title;
  const firstLine = (entry.content || '').split('\n')[0].trim();
  if (!firstLine) return '(untitled)';
  return firstLine.length > 60 ? firstLine.slice(0, 60) + '…' : firstLine;
}

/** Rebuilds the editable title from the clean title + tags. */
function rawTitleFor(entry) {
  const tags = entry.tags.map((t) => ` #${t}`).join('');
  return `${entry.title}${tags}`.trim();
}

let toastTimer = null;
function toast(message) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('visible'), 2600);
}

// ---------- Smart input (preview + tag autocomplete) ----------

function renderParsePreview(el, raw) {
  const value = (raw || '').trim();
  if (!value) {
    el.innerHTML = '';
    return;
  }
  const parsed = Parser.parse(value, defaultMinutes());
  const parts = [
    parsed.text
      ? `<span class="preview-text">${escapeHtml(parsed.text)}</span>`
      : '<span class="preview-text empty">no text</span>'
  ];
  parsed.tags.forEach((t) => parts.push(`<span class="preview-chip">#${escapeHtml(t)}</span>`));
  parts.push(
    `<span class="preview-chip time">⏰ ${formatDuration(parsed.reminderMinutes * 60000)}${parsed.explicitReminder ? '' : ' (default)'}</span>`
  );
  el.innerHTML = parts.join('');
}

function currentTagPrefix(value, caret) {
  const upto = value.slice(0, caret);
  const m = upto.match(/#([a-zA-Z0-9_À-ÿ]*)$/);
  return m ? { prefix: m[1].toLowerCase(), start: caret - m[1].length } : null;
}

/**
 * Wires a live preview, a counter and #tag autocomplete to an input.
 * Tab accepts the first suggestion; Enter submits.
 */
function setupSmartInput(input, { previewEl, suggestEl, counterEl, onSubmit, onChange }) {
  function completeTag(ctx, tag) {
    const caret = input.selectionStart;
    input.value = input.value.slice(0, ctx.start) + tag + ' ' + input.value.slice(caret);
    const pos = ctx.start + tag.length + 1;
    input.focus();
    input.setSelectionRange(pos, pos);
    update();
  }

  function renderSuggestions() {
    if (!suggestEl) return;
    const ctx = currentTagPrefix(input.value, input.selectionStart ?? input.value.length);
    if (!ctx) {
      suggestEl.innerHTML = '';
      return;
    }
    const matches = allTags()
      .map(([t]) => t)
      .filter((t) => t.startsWith(ctx.prefix) && t !== ctx.prefix)
      .slice(0, 6);
    if (matches.length === 0) {
      suggestEl.innerHTML = '';
      return;
    }
    suggestEl.innerHTML = matches
      .map((t) => `<button type="button" class="suggest-chip" data-tag="${escapeHtml(t)}">#${escapeHtml(t)}</button>`)
      .join('');
    suggestEl.querySelectorAll('.suggest-chip').forEach((btn) => {
      // mousedown: completes before the input loses focus.
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const liveCtx = currentTagPrefix(input.value, input.selectionStart ?? input.value.length);
        if (liveCtx) completeTag(liveCtx, btn.dataset.tag);
      });
    });
  }

  function update() {
    if (counterEl) {
      const len = input.value.length;
      counterEl.textContent = `${len} / ${maxLen()}`;
      counterEl.classList.toggle('over', len >= maxLen());
    }
    if (previewEl) renderParsePreview(previewEl, input.value);
    renderSuggestions();
    if (onChange) onChange(input.value);
  }

  input.addEventListener('input', update);
  input.addEventListener('click', renderSuggestions);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && suggestEl) {
      const first = suggestEl.querySelector('.suggest-chip');
      const ctx = currentTagPrefix(input.value, input.selectionStart ?? input.value.length);
      if (first && ctx) {
        e.preventDefault();
        completeTag(ctx, first.dataset.tag);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
  });

  update();
}

/**
 * A setupSmartInput version for the **title of a clipboard text**: it only
 * extracts #tags (there's no !time here) and doesn't handle Enter — the caller
 * decides whether it saves or jumps to the content field.
 */
function setupTitleInput(input, { previewEl, suggestEl, counterEl, onChange }) {
  function completeTag(ctx, tag) {
    const caret = input.selectionStart;
    input.value = input.value.slice(0, ctx.start) + tag + ' ' + input.value.slice(caret);
    const pos = ctx.start + tag.length + 1;
    input.focus();
    input.setSelectionRange(pos, pos);
    update();
  }

  function renderSuggestions() {
    if (!suggestEl) return;
    const ctx = currentTagPrefix(input.value, input.selectionStart ?? input.value.length);
    if (!ctx) {
      suggestEl.innerHTML = '';
      return;
    }
    const matches = allEntryTags()
      .map(([t]) => t)
      .filter((t) => t.startsWith(ctx.prefix) && t !== ctx.prefix)
      .slice(0, 6);
    if (matches.length === 0) {
      suggestEl.innerHTML = '';
      return;
    }
    suggestEl.innerHTML = matches
      .map((t) => `<button type="button" class="suggest-chip" data-tag="${escapeHtml(t)}">#${escapeHtml(t)}</button>`)
      .join('');
    suggestEl.querySelectorAll('.suggest-chip').forEach((btn) => {
      // mousedown: completes before the input loses focus.
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const liveCtx = currentTagPrefix(input.value, input.selectionStart ?? input.value.length);
        if (liveCtx) completeTag(liveCtx, btn.dataset.tag);
      });
    });
  }

  function update() {
    if (counterEl) {
      const len = input.value.length;
      counterEl.textContent = `${len} / ${maxTitleLen()}`;
      counterEl.classList.toggle('over', len >= maxTitleLen());
    }
    if (previewEl) {
      const value = input.value.trim();
      if (!value) {
        previewEl.innerHTML = '';
      } else {
        const parsed = EntryParser.parseTitle(value);
        const parts = [
          parsed.title
            ? `<span class="preview-text">${escapeHtml(parsed.title)}</span>`
            : '<span class="preview-text empty">empty title (uses the content\'s 1st line)</span>'
        ];
        parsed.tags.forEach((t) => parts.push(`<span class="preview-chip">#${escapeHtml(t)}</span>`));
        previewEl.innerHTML = parts.join('');
      }
    }
    renderSuggestions();
    if (onChange) onChange(input.value);
  }

  input.addEventListener('input', update);
  input.addEventListener('click', renderSuggestions);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && suggestEl) {
      const first = suggestEl.querySelector('.suggest-chip');
      const ctx = currentTagPrefix(input.value, input.selectionStart ?? input.value.length);
      if (first && ctx) {
        e.preventDefault();
        completeTag(ctx, first.dataset.tag);
      }
    }
  });

  update();
}

// ---------- Quick mode ----------

function renderQuickMode() {
  appEl.innerHTML = `
    <div class="quick-container">
      <div class="quick-header">
        <div class="quick-title">NEW ACTIVITY</div>
        <button class="quick-close" id="quick-close">&times;</button>
      </div>
      <textarea
        id="quick-input"
        class="quick-input"
        placeholder="E.g. math homework #college #exam !30"
        maxlength="${maxLen()}"
        autofocus
      ></textarea>
      <div class="input-preview" id="quick-preview"></div>
      <div class="tag-suggest" id="quick-suggest"></div>
      <div class="quick-meta">
        <div class="quick-hint">
          <span class="tag">#tag</span> categorizes · <span class="tag">!30</span> <span class="tag">!2h</span> <span class="tag">!1h30</span> alert · <span class="tag">Tab</span> completes a tag · <span class="tag">Enter</span> saves · <span class="tag">Esc</span> closes
        </div>
        <div class="quick-counter" id="quick-counter"></div>
      </div>
      <div class="quick-actions">
        <button class="btn btn-secondary" id="quick-cancel">Cancel</button>
        <button class="btn btn-primary" id="quick-save">Save</button>
      </div>
    </div>
  `;

  const input = document.getElementById('quick-input');
  const saveBtn = document.getElementById('quick-save');

  input.value = quickDraft;

  async function save() {
    const text = input.value.trim();
    if (!text) return;
    try {
      await API.createActivity(text);
      quickDraft = '';
      await API.closeQuickWindow();
    } catch (err) {
      console.error(err);
      toast('Error saving the activity.');
    }
  }

  setupSmartInput(input, {
    previewEl: document.getElementById('quick-preview'),
    suggestEl: document.getElementById('quick-suggest'),
    counterEl: document.getElementById('quick-counter'),
    onSubmit: save,
    onChange: (value) => {
      quickDraft = value;
      saveBtn.disabled = value.trim().length === 0;
      // While there's a draft, the window doesn't close when it loses focus.
      API.setQuickDraft(value.trim().length > 0);
    }
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      quickDraft = '';
      API.closeQuickWindow();
    }
  });

  saveBtn.addEventListener('click', save);
  document.getElementById('quick-cancel').addEventListener('click', () => API.closeQuickWindow());
  document.getElementById('quick-close').addEventListener('click', () => API.closeQuickWindow());

  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

// ---------- Text capture mode (clipboard) ----------

function renderClipMode() {
  appEl.innerHTML = `
    <div class="quick-container">
      <div class="quick-header">
        <div class="quick-title">NEW TEXT</div>
        <button class="quick-close" id="clip-close">&times;</button>
      </div>
      <input
        type="text"
        id="clip-title"
        class="quick-title-input"
        placeholder="Title (optional) — use #tag to categorize"
        maxlength="${maxTitleLen()}"
      >
      <div class="input-preview" id="clip-preview"></div>
      <div class="tag-suggest" id="clip-suggest"></div>
      <textarea
        id="clip-content"
        class="quick-content"
        placeholder="Content to save (it will be pasted exactly as typed)"
      ></textarea>
      <div class="quick-meta">
        <div class="quick-hint">
          <span class="tag">#tag</span> in the title · <span class="tag">Tab</span> completes · <span class="tag">Enter</span> saves · <span class="tag">Shift+Enter</span> new line · <span class="tag">Esc</span> closes
        </div>
        <div class="quick-counter" id="clip-counter"></div>
      </div>
      <div class="quick-actions">
        <button class="btn btn-secondary" id="clip-cancel">Cancel</button>
        <button class="btn btn-primary" id="clip-save">Save</button>
      </div>
    </div>
  `;

  const titleInput = document.getElementById('clip-title');
  const contentInput = document.getElementById('clip-content');
  const saveBtn = document.getElementById('clip-save');

  titleInput.value = clipTitleDraft;
  contentInput.value = clipContentDraft;

  function hasDraft() {
    return titleInput.value.trim().length > 0 || contentInput.value.trim().length > 0;
  }

  function syncDraft() {
    clipTitleDraft = titleInput.value;
    clipContentDraft = contentInput.value;
    saveBtn.disabled = contentInput.value.trim().length === 0;
    // While there's a draft, the window doesn't close when it loses focus.
    API.setClipDraft(hasDraft());
  }

  function discardAndClose() {
    clipTitleDraft = '';
    clipContentDraft = '';
    API.setClipDraft(false);
    API.closeClipWindow();
  }

  async function save() {
    const content = contentInput.value;
    if (!content.trim()) {
      contentInput.focus();
      return;
    }
    try {
      await API.createEntry(titleInput.value, content);
      clipTitleDraft = '';
      clipContentDraft = '';
      API.setClipDraft(false);
      await API.closeClipWindow();
    } catch (err) {
      console.error(err);
      toast('Error saving.');
    }
  }

  setupTitleInput(titleInput, {
    previewEl: document.getElementById('clip-preview'),
    suggestEl: document.getElementById('clip-suggest'),
    counterEl: document.getElementById('clip-counter'),
    onChange: syncDraft
  });

  titleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      if (e.ctrlKey) {
        e.preventDefault();
        save();
      } else if (!e.shiftKey) {
        // Enter in the title → focuses the content.
        e.preventDefault();
        contentInput.focus();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      discardAndClose();
    }
  });

  contentInput.addEventListener('input', syncDraft);
  contentInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      // Enter saves; Shift+Enter adds a new line (the textarea's default).
      if (e.ctrlKey || !e.shiftKey) {
        e.preventDefault();
        save();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      discardAndClose();
    }
  });

  saveBtn.addEventListener('click', save);
  document.getElementById('clip-cancel').addEventListener('click', discardAndClose);
  document.getElementById('clip-close').addEventListener('click', discardAndClose);

  titleInput.focus();
  titleInput.setSelectionRange(titleInput.value.length, titleInput.value.length);
  syncDraft();
}

// ---------- Activity panel (overlay window) ----------

function renderPanelMode() {
  appEl.innerHTML = `
    <div class="main-layout">
      <header class="topbar">
        <div class="topbar-row">
          <div class="logo"><span>Activity</span> Manager</div>

        </div>
        <nav class="nav">
          <button data-screen="dashboard" class="${currentScreen === 'dashboard' ? 'active' : ''}">Activities</button>
          <button data-screen="clipboard" class="${currentScreen === 'clipboard' ? 'active' : ''}">Clipboard</button>
          <button data-screen="settings" class="${currentScreen === 'settings' ? 'active' : ''}">Settings</button>
        </nav>
      </header>
      <main class="content" id="main-content"></main>
    </div>
  `;

  document.querySelectorAll('.nav button').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentScreen = btn.dataset.screen;
      editingId = null;
      editingEntryId = null;
      settingsTab = 'general';
      settingsDraft = null;
      renderPanelMode();
    });
  });


  renderScreen();
}

function renderScreen() {
  const content = document.getElementById('main-content');
  if (!content) return;
  if (currentScreen === 'dashboard') renderDashboard(content);
  else if (currentScreen === 'clipboard') renderClipboardScreen(content);
  else if (currentScreen === 'settings') renderSettings(content);
}

/**
 * Re-renders the current screen without losing focus or the cursor position —
 * essential because events from main arrive while the user types.
 */
function rerenderPreservingFocus() {
  const active = document.activeElement;
  const activeId = active && active.id;
  const selStart = active && typeof active.selectionStart === 'number' ? active.selectionStart : null;
  const selEnd = active && typeof active.selectionEnd === 'number' ? active.selectionEnd : null;

  renderScreen();

  if (activeId) {
    const el = document.getElementById(activeId);
    if (el) {
      el.focus();
      if (selStart !== null && el.setSelectionRange) {
        try { el.setSelectionRange(selStart, selEnd); } catch { /* inputs without selection */ }
      }
    }
  }
}

function refreshPanel() {
  if (mode !== 'panel') return;
  if (!document.getElementById('main-content')) {
    renderPanelMode();
    return;
  }
  rerenderPreservingFocus();
}

// ---------- Dashboard ----------

function activityMatchesFilters(a) {
  const q = searchQuery.trim().toLowerCase();
  if (q && !a.text.toLowerCase().includes(q) && !a.tags.some((t) => t.includes(q))) return false;
  if (activeTag && !a.tags.includes(activeTag)) return false;
  return true;
}

function rawTextFor(activity) {
  const tags = activity.tags.map((t) => ` #${t}`).join('');
  return `${activity.text}${tags}`;
}

function activityMetaHtml(a, isCompleted) {
  if (isCompleted) {
    return `Done on ${formatTime(a.completedAt)} · Took ${formatDuration(a.completedAt - a.createdAt)}`;
  }
  const overdue = a.dueAt < Date.now();
  return `Alert ${timeUntil(a.dueAt)} · Created ${formatTime(a.createdAt)}${overdue ? ' · <span class="overdue-badge">overdue</span>' : ''}`;
}

function activityCardHtml(a, isCompleted) {
  if (a.id === editingId && !isCompleted) {
    return `
      <div class="activity-card editing" data-id="${a.id}">
        <input id="edit-input" class="edit-input" maxlength="${maxLen()}" value="${escapeHtml(editDraft)}">
        <div class="activity-actions">
          <button class="icon-btn complete" title="Save (Enter)" data-action="save-edit">✓</button>
          <button class="icon-btn" title="Cancel (Esc)" data-action="cancel-edit">✕</button>
        </div>
      </div>
    `;
  }

  const overdue = !isCompleted && a.dueAt < Date.now();
  return `
    <div class="activity-card ${overdue ? 'overdue' : ''} ${isCompleted ? 'completed' : ''}" data-id="${a.id}">
      <div class="activity-info">
        <div class="activity-text">${escapeHtml(a.text)}</div>
        ${a.tags.length > 0 ? `
          <div class="activity-tags">
            ${a.tags.map((t) => `<button class="tag-pill" data-tag-filter="${escapeHtml(t)}" title="Filter by #${escapeHtml(t)}">#${escapeHtml(t)}</button>`).join('')}
          </div>
        ` : ''}
        <div class="activity-meta">${activityMetaHtml(a, isCompleted)}</div>
      </div>
      <div class="activity-actions">
        ${!isCompleted ? `
          <button class="icon-btn complete" title="Done" data-action="complete">✓</button>
          <button class="icon-btn snooze" title="Snooze the alert by ${a.reminderMinutes} min" data-action="snooze">+${a.reminderMinutes}m</button>
          <button class="icon-btn" title="Edit" data-action="edit">✎</button>
        ` : `
          <button class="icon-btn" title="Reopen" data-action="reopen">↩</button>
        `}
        <button class="icon-btn delete" title="Delete" data-action="delete">🗑</button>
      </div>
    </div>
  `;
}

function renderDashboard(container) {
  const pending = state.activities
    .filter((a) => !a.completedAt)
    .filter(activityMatchesFilters)
    .sort((a, b) => a.dueAt - b.dueAt);
  const completedAll = state.activities
    .filter((a) => a.completedAt)
    .filter(activityMatchesFilters)
    .sort((a, b) => b.completedAt - a.completedAt);
  const completed = completedAll.slice(0, completedLimit);
  const tags = allTags();
  const filtering = searchQuery.trim() || activeTag;

  container.innerHTML = `
    <div class="quick-add-card">
      <div class="quick-add-row">
        <input type="text" id="dash-input" placeholder="Add an activity... (N)" maxlength="${maxLen()}" value="${escapeHtml(dashDraft)}">
        <button class="btn btn-primary" id="dash-add">Add</button>
      </div>
      <div class="input-preview" id="dash-preview"></div>
      <div class="tag-suggest" id="dash-suggest"></div>
      <div class="quick-add-help">
        <strong>#tag</strong> categorizes · <strong>!30</strong>, <strong>!2h</strong> or <strong>!1h30</strong> sets the alert (default: ${defaultMinutes()} min) · <strong>Tab</strong> completes the tag
      </div>
    </div>

    <div class="toolbar">
      <input type="search" id="search-input" class="search-input" placeholder="Search activities... (/)" value="${escapeHtml(searchQuery)}">
      ${tags.length > 0 ? `
        <div class="tag-filter">
          ${tags.map(([t, count]) => `
            <button class="filter-chip ${activeTag === t ? 'active' : ''}" data-tag-filter="${escapeHtml(t)}">#${escapeHtml(t)} <span class="chip-count">${count}</span></button>
          `).join('')}
          ${activeTag ? `<button class="filter-chip clear" id="clear-filter">limpar ✕</button>` : ''}
        </div>
      ` : ''}
    </div>

    <h2 class="section-title">Pending (${pending.length})</h2>
    <div class="activities-list" id="pending-list">
      ${pending.length > 0
        ? pending.map((a) => activityCardHtml(a, false)).join('')
        : `<div class="empty-state">${filtering ? 'Nothing found with this filter.' : 'No pending activities. Use the field above or the global shortcut to jot one down.'}</div>`}
    </div>

    ${completedAll.length > 0 ? `
      <h2 class="section-title section-completed">Done (${completedAll.length})</h2>
      <div class="activities-list" id="completed-list">
        ${completed.map((a) => activityCardHtml(a, true)).join('')}
      </div>
      ${completedAll.length > completed.length ? `
        <button class="btn btn-secondary btn-inline" id="show-more">Show more (${completedAll.length - completed.length})</button>
      ` : ''}
    ` : ''}
  `;

  const input = document.getElementById('dash-input');

  async function addFromInput() {
    const text = input.value.trim();
    if (!text) return;
    dashDraft = '';
    input.value = '';
    await API.createActivity(text);
    toast('Activity added');
  }

  setupSmartInput(input, {
    previewEl: document.getElementById('dash-preview'),
    suggestEl: document.getElementById('dash-suggest'),
    onSubmit: addFromInput,
    onChange: (value) => { dashDraft = value; }
  });

  document.getElementById('dash-add').addEventListener('click', addFromInput);

  const searchInput = document.getElementById('search-input');
  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value;
    rerenderPreservingFocus();
  });

  const clearFilter = document.getElementById('clear-filter');
  if (clearFilter) {
    clearFilter.addEventListener('click', () => {
      activeTag = null;
      renderScreen();
    });
  }

  const showMore = document.getElementById('show-more');
  if (showMore) {
    showMore.addEventListener('click', () => {
      completedLimit += 20;
      renderScreen();
    });
  }

  wireActivityActions(container);
  wireEditInput();
}

function wireActivityActions(container) {
  container.querySelectorAll('.activities-list').forEach((list) => {
    list.addEventListener('click', async (e) => {
      const actionBtn = e.target.closest('[data-action]');
      if (actionBtn) {
        const card = actionBtn.closest('.activity-card');
        const id = card && card.dataset.id;
        if (!id) return;
        const action = actionBtn.dataset.action;

        if (action === 'complete') {
          const a = findActivity(id);
          await API.completeActivity(id);
          toast(`Done — took ${formatDuration(Date.now() - (a ? a.createdAt : Date.now()))}`);
        } else if (action === 'snooze') {
          const a = findActivity(id);
          const mins = a ? a.reminderMinutes : defaultMinutes();
          await API.snoozeActivity(id, mins);
          toast(`Alert snoozed ${mins} min`);
        } else if (action === 'delete') {
          if (confirm('Are you sure you want to delete this activity?')) {
            await API.deleteActivity(id);
          }
        } else if (action === 'edit') {
          const a = findActivity(id);
          if (!a) return;
          editingId = id;
          editDraft = rawTextFor(a);
          renderScreen();
          const editInput = document.getElementById('edit-input');
          if (editInput) {
            editInput.focus();
            editInput.setSelectionRange(editInput.value.length, editInput.value.length);
          }
        } else if (action === 'save-edit') {
          await saveEdit(id);
        } else if (action === 'cancel-edit') {
          editingId = null;
          renderScreen();
        } else if (action === 'reopen') {
          await API.reopenActivity(id);
          toast('Activity reopened');
        }
        return;
      }

      const tagPill = e.target.closest('[data-tag-filter]');
      if (tagPill) {
        const t = tagPill.dataset.tagFilter;
        activeTag = activeTag === t ? null : t;
        renderScreen();
      }
    });
  });

  const toolbar = container.querySelector('.tag-filter');
  if (toolbar) {
    toolbar.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-tag-filter]');
      if (!chip) return;
      const t = chip.dataset.tagFilter;
      activeTag = activeTag === t ? null : t;
      renderScreen();
    });
  }
}

async function saveEdit(id) {
  const input = document.getElementById('edit-input');
  const value = (input ? input.value : editDraft).trim();
  if (!value) return;
  editingId = null;
  await API.updateActivity(id, value);
  toast('Activity updated');
}

function wireEditInput() {
  const input = document.getElementById('edit-input');
  if (!input) return;
  input.addEventListener('input', () => { editDraft = input.value; });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveEdit(input.closest('.activity-card').dataset.id);
    } else if (e.key === 'Escape') {
      editingId = null;
      renderScreen();
    }
  });
}

// ---------- Clipboard tab ----------

function entryMatchesFilters(e) {
  const q = clipSearchQuery.trim().toLowerCase();
  if (q) {
    const hay = `${e.title}\n${e.content}\n${e.tags.join(' ')}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  if (clipActiveTag && !e.tags.includes(clipActiveTag)) return false;
  return true;
}

function entryCardHtml(e) {
  if (e.id === editingEntryId) {
    return `
      <div class="entry-card editing" data-id="${e.id}">
        <input id="edit-entry-title" class="edit-input" maxlength="${maxTitleLen()}" value="${escapeHtml(editEntryTitleDraft)}" placeholder="Title (use #tag)">
        <div class="tag-suggest" id="edit-entry-suggest"></div>
        <textarea id="edit-entry-content" class="edit-content" placeholder="Content">${escapeHtml(editEntryContentDraft)}</textarea>
        <div class="edit-actions">
          <button class="btn btn-primary btn-sm" data-entry-action="save-edit">Save</button>
          <button class="btn btn-secondary btn-sm" data-entry-action="cancel-edit">Cancel</button>
        </div>
      </div>
    `;
  }

  return `
    <div class="entry-card" data-id="${e.id}">
      <div class="entry-info">
        <div class="entry-title">${escapeHtml(displayTitle(e))}</div>
        <div class="entry-content">${escapeHtml(e.content)}</div>
        ${e.tags.length ? `
          <div class="entry-tags">
            ${e.tags.map((t) => `<button class="tag-pill" data-entry-tag="${escapeHtml(t)}" title="Filter by #${escapeHtml(t)}">#${escapeHtml(t)}</button>`).join('')}
          </div>
        ` : ''}
        <div class="entry-meta">Created ${formatTime(e.createdAt)}${e.copyCount ? ` · Copied ${e.copyCount}×` : ''}</div>
      </div>
      <div class="entry-actions">
        <button class="btn btn-primary btn-sm btn-copy" data-entry-action="copy">Copy</button>
        <button class="icon-btn" data-entry-action="edit" title="Edit">✎</button>
        <button class="icon-btn delete" data-entry-action="delete" title="Delete">🗑</button>
      </div>
    </div>
  `;
}

function renderClipboardScreen(container) {
  let entries = state.entries.filter(entryMatchesFilters);
  if (clipSort === 'copied') {
    entries = entries.slice().sort((a, b) => (b.lastCopiedAt || 0) - (a.lastCopiedAt || 0) || b.createdAt - a.createdAt);
  } else {
    entries = entries.slice().sort((a, b) => b.createdAt - a.createdAt);
  }
  const tags = allEntryTags();
  const filtering = clipSearchQuery.trim() || clipActiveTag;

  container.innerHTML = `
    <div class="add-card">
      <input type="text" id="add-entry-title" placeholder="Title (optional, use #tag)..." maxlength="${maxTitleLen()}" value="${escapeHtml(addEntryTitleDraft)}">
      <div class="input-preview" id="add-entry-preview"></div>
      <div class="tag-suggest" id="add-entry-suggest"></div>
      <textarea id="add-entry-content" placeholder="Content to save...">${escapeHtml(addEntryContentDraft)}</textarea>
      <div class="add-row">
        <div class="quick-add-help"><strong>#tag</strong> in the title categorizes · <strong>Ctrl+Enter</strong> adds · the content is saved exactly as typed</div>
        <button class="btn btn-primary" id="add-entry-btn">Add</button>
      </div>
    </div>

    <div class="toolbar">
      <input type="search" id="clip-search" class="search-input" placeholder="Search texts... (/)" value="${escapeHtml(clipSearchQuery)}">
      <div class="panel-sort" id="clip-sort">
        <button data-sort="recent" class="${clipSort === 'recent' ? 'active' : ''}">Recent</button>
        <button data-sort="copied" class="${clipSort === 'copied' ? 'active' : ''}">Most copied</button>
      </div>
      ${tags.length > 0 ? `
        <div class="tag-filter">
          ${tags.map(([t, count]) => `
            <button class="filter-chip ${clipActiveTag === t ? 'active' : ''}" data-entry-tag="${escapeHtml(t)}">#${escapeHtml(t)} <span class="chip-count">${count}</span></button>
          `).join('')}
          ${clipActiveTag ? `<button class="filter-chip clear" id="clip-clear-filter">limpar ✕</button>` : ''}
        </div>
      ` : ''}
    </div>

    <h2 class="section-title">Texts (${entries.length})</h2>
    <div class="entries-list" id="entries-list">
      ${entries.length > 0
        ? entries.map((e) => entryCardHtml(e)).join('')
        : `<div class="empty-state">${filtering ? 'Nothing found with this filter.' : 'No saved texts. Use the form above or the global shortcut.'}</div>`}
    </div>
  `;

  const titleInput = document.getElementById('add-entry-title');
  const contentInput = document.getElementById('add-entry-content');

  async function addEntry() {
    const content = contentInput.value;
    if (!content.trim()) {
      contentInput.focus();
      return;
    }
    const title = titleInput.value;
    addEntryTitleDraft = '';
    addEntryContentDraft = '';
    titleInput.value = '';
    contentInput.value = '';
    await API.createEntry(title, content);
    toast('Text saved');
  }

  setupTitleInput(titleInput, {
    previewEl: document.getElementById('add-entry-preview'),
    suggestEl: document.getElementById('add-entry-suggest'),
    onChange: (value) => { addEntryTitleDraft = value; }
  });

  titleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      if (e.ctrlKey) { e.preventDefault(); addEntry(); }
      else if (!e.shiftKey) { e.preventDefault(); contentInput.focus(); }
    }
  });

  contentInput.addEventListener('input', () => { addEntryContentDraft = contentInput.value; });
  contentInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault();
      addEntry();
    }
  });

  document.getElementById('add-entry-btn').addEventListener('click', addEntry);

  const searchInput = document.getElementById('clip-search');
  searchInput.addEventListener('input', () => {
    clipSearchQuery = searchInput.value;
    rerenderPreservingFocus();
  });

  document.getElementById('clip-sort').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-sort]');
    if (!btn) return;
    clipSort = btn.dataset.sort;
    renderScreen();
  });

  const clearFilter = document.getElementById('clip-clear-filter');
  if (clearFilter) {
    clearFilter.addEventListener('click', () => {
      clipActiveTag = null;
      renderScreen();
    });
  }

  wireEntryActions(container);
  wireEntryEditInputs();
}

function wireEntryActions(container) {
  const list = container.querySelector('#entries-list');
  if (list) {
    list.addEventListener('click', async (e) => {
      const actionBtn = e.target.closest('[data-entry-action]');
      if (actionBtn) {
        const card = actionBtn.closest('.entry-card');
        const id = card && card.dataset.id;
        if (!id) return;
        const action = actionBtn.dataset.entryAction;

        if (action === 'copy') {
          await API.copyEntry(id);
          toast('Copied!');
        } else if (action === 'edit') {
          const entry = findEntry(id);
          if (!entry) return;
          editingEntryId = id;
          editEntryTitleDraft = rawTitleFor(entry);
          editEntryContentDraft = entry.content;
          renderScreen();
          const t = document.getElementById('edit-entry-title');
          if (t) {
            t.focus();
            t.setSelectionRange(t.value.length, t.value.length);
          }
        } else if (action === 'delete') {
          if (confirm('Are you sure you want to delete this text?')) {
            await API.deleteEntry(id);
          }
        } else if (action === 'save-edit') {
          await saveEntryEdit(id);
        } else if (action === 'cancel-edit') {
          editingEntryId = null;
          renderScreen();
        }
        return;
      }

      const tagPill = e.target.closest('[data-entry-tag]');
      if (tagPill) {
        const t = tagPill.dataset.entryTag;
        clipActiveTag = clipActiveTag === t ? null : t;
        renderScreen();
      }
    });
  }

  const toolbar = container.querySelector('.tag-filter');
  if (toolbar) {
    toolbar.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-entry-tag]');
      if (!chip) return;
      const t = chip.dataset.entryTag;
      clipActiveTag = clipActiveTag === t ? null : t;
      renderScreen();
    });
  }
}

async function saveEntryEdit(id) {
  const titleInput = document.getElementById('edit-entry-title');
  const contentInput = document.getElementById('edit-entry-content');
  const content = contentInput ? contentInput.value : editEntryContentDraft;
  if (!content.trim()) {
    if (contentInput) contentInput.focus();
    return;
  }
  const title = titleInput ? titleInput.value : editEntryTitleDraft;
  editingEntryId = null;
  await API.updateEntry(id, title, content);
  toast('Text updated');
}

function wireEntryEditInputs() {
  const titleInput = document.getElementById('edit-entry-title');
  const contentInput = document.getElementById('edit-entry-content');
  if (!titleInput || !contentInput) return;

  const id = titleInput.closest('.entry-card').dataset.id;

  setupTitleInput(titleInput, {
    suggestEl: document.getElementById('edit-entry-suggest'),
    onChange: (value) => { editEntryTitleDraft = value; }
  });

  titleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      if (e.ctrlKey) { e.preventDefault(); saveEntryEdit(id); }
      else if (!e.shiftKey) { e.preventDefault(); contentInput.focus(); }
    } else if (e.key === 'Escape') {
      editingEntryId = null;
      renderScreen();
    }
  });

  contentInput.addEventListener('input', () => { editEntryContentDraft = contentInput.value; });
  contentInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault();
      saveEntryEdit(id);
    } else if (e.key === 'Escape') {
      editingEntryId = null;
      renderScreen();
    }
  });
}

// ---------- Settings ----------

// Notifications and Volume became one — both were about the same alert, and
// splitting them meant going back and forth to adjust one thing.
const SETTINGS_TABS = [
  { key: 'general', label: 'General' },
  { key: 'shortcuts', label: 'Shortcuts' },
  { key: 'alerts', label: 'Alerts' }
];

/**
 * Edits live in a draft apart from `state.config` — so switching tabs
 * (which re-renders only the active tab) doesn't lose what was typed in the
 * others. `null` means "just entered the screen", and it is rebuilt from the
 * saved config; it goes back to `null` after a successful save.
 */
function renderSettings(container) {
  if (!settingsDraft) settingsDraft = { ...state.config };

  container.innerHTML = `
    <h2 class="section-title">Settings</h2>
    <div class="settings-tabs">
      ${SETTINGS_TABS.map((t) => `<button data-tab="${t.key}" class="${settingsTab === t.key ? 'active' : ''}">${t.label}</button>`).join('')}
    </div>
    <div class="settings-form" id="settings-tab-body"></div>
    <div class="settings-actions settings-footer" id="settings-footer">
      <button class="btn btn-primary" id="btn-save-cfg">Save settings</button>
    </div>
  `;

  document.querySelectorAll('.settings-tabs button').forEach((btn) => {
    btn.addEventListener('click', () => {
      settingsTab = btn.dataset.tab;
      renderScreen();
    });
  });

  const body = document.getElementById('settings-tab-body');
  if (settingsTab === 'general') renderGeneralTab(body);
  else if (settingsTab === 'shortcuts') renderShortcutsTab(body);
  else if (settingsTab === 'alerts') renderAlertsTab(body);

  document.getElementById('btn-save-cfg').addEventListener('click', async () => {
    const saveBtn = document.getElementById('btn-save-cfg');
    const patch = {
      defaultReminderMinutes: parseInt(settingsDraft.defaultReminderMinutes, 10) || 15,
      maxTextLength: parseInt(settingsDraft.maxTextLength, 10) || 120,
      maxTitleLength: parseInt(settingsDraft.maxTitleLength, 10) || 120,
      globalShortcut: (settingsDraft.globalShortcut || '').trim() || 'Ctrl+Alt+A',
      globalShortcutClip: (settingsDraft.globalShortcutClip || '').trim() || 'Ctrl+Alt+C',
      globalShortcutPanel: (settingsDraft.globalShortcutPanel || '').trim() || 'Ctrl+Alt+P',
      startOnLogin: !!settingsDraft.startOnLogin,
      soundEnabled: !!settingsDraft.soundEnabled,
      soundVolume: parseInt(settingsDraft.soundVolume, 10)
    };

    // Registering the shortcut reloads the compositor: it can take a moment.
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    try {
      await API.saveConfig(patch);
      settingsDraft = null;
      await renderShortcutStatus();
      toast('Settings saved');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save settings';
    }
  });
}

/**
 * The General tab.
 *
 * Grouped by subject rather than by loose field: "Activities" and "Clipboard" are
 * the two things configured here, and each has its own numbers.
 */
function renderGeneralTab(body) {
  body.innerHTML = `
    <div class="cfg-section">
      <h4 class="cfg-heading">Activities</h4>

      <div class="form-group">
        <label>Default alert time</label>
        <div class="cfg-number">
          <input type="number" id="cfg-default-minutes" min="1" value="${settingsDraft.defaultReminderMinutes}">
          <span>minutes</span>
        </div>
        <div class="form-hint">Applies when you don't write <code>!N</code> in the activity.</div>
      </div>

      <div class="form-group">
        <label>Text limit</label>
        <div class="cfg-number">
          <input type="number" id="cfg-max-length" min="10" value="${settingsDraft.maxTextLength}">
          <span>characters</span>
        </div>
        <div class="form-hint">Keeps the activity short enough to fit in an alert.</div>
      </div>
    </div>

    <div class="cfg-section">
      <h4 class="cfg-heading">Clipboard</h4>

      <div class="form-group">
        <label>Title limit</label>
        <div class="cfg-number">
          <input type="number" id="cfg-max-title" min="10" value="${settingsDraft.maxTitleLength}">
          <span>characters</span>
        </div>
        <div class="form-hint">Only the title. The content has no limit — it is what gets pasted.</div>
      </div>
    </div>

    <div class="cfg-section">
      <h4 class="cfg-heading">System</h4>

      <label class="cfg-toggle">
        <input type="checkbox" id="cfg-autostart" ${settingsDraft.startOnLogin ? 'checked' : ''}>
        <span>
          Start with the system
          <em>Alerts only arrive while the app is running.</em>
        </span>
      </label>
    </div>
  `;

  document.getElementById('cfg-default-minutes').addEventListener('input', (e) => {
    settingsDraft.defaultReminderMinutes = e.target.value;
  });
  document.getElementById('cfg-max-length').addEventListener('input', (e) => {
    settingsDraft.maxTextLength = e.target.value;
  });
  document.getElementById('cfg-max-title').addEventListener('input', (e) => {
    settingsDraft.maxTitleLength = e.target.value;
  });
  document.getElementById('cfg-autostart').addEventListener('change', (e) => {
    settingsDraft.startOnLogin = e.target.checked;
  });

}

function renderShortcutsTab(body) {
  body.innerHTML = `
    <div class="form-group">
      <label>Shortcut — New activity</label>
      <input type="text" id="cfg-shortcut" class="shortcut-input" value="${escapeHtml(settingsDraft.globalShortcut || '')}" placeholder="Click here and press the keys" readonly>
      <div id="shortcut-conflict" class="shortcut-status"></div>
    </div>

    <div class="form-group">
      <label>Shortcut — New text (clipboard)</label>
      <input type="text" id="cfg-shortcut-clip" class="shortcut-input" value="${escapeHtml(settingsDraft.globalShortcutClip || '')}" placeholder="Click here and press the keys" readonly>
      <div id="shortcut-clip-conflict" class="shortcut-status"></div>
    </div>

    <div class="form-group">
      <label>Shortcut — Open the panel</label>
      <input type="text" id="cfg-shortcut-panel" class="shortcut-input" value="${escapeHtml(settingsDraft.globalShortcutPanel || '')}" placeholder="Click here and press the keys" readonly>
      <div id="shortcut-panel-conflict" class="shortcut-status"></div>
      <div class="form-hint">
        Click the field and press the combination you want. When you save, the service
        registers all three shortcuts in your environment on its own — you don't need to
        edit any config file.
      </div>
      <div id="shortcut-status" class="shortcut-status"></div>
      <div class="settings-actions">
        <button class="btn btn-secondary btn-inline" id="btn-test-quick">Test new activity</button>
        <button class="btn btn-secondary btn-inline" id="btn-test-clip">Test new text</button>
        <button class="btn btn-secondary btn-inline" id="btn-test-panel">Test panel</button>
      </div>
    </div>
  `;

  setupShortcutCapture(document.getElementById('cfg-shortcut'), 'globalShortcut', 'shortcut-conflict');
  setupShortcutCapture(document.getElementById('cfg-shortcut-clip'), 'globalShortcutClip', 'shortcut-clip-conflict');
  setupShortcutCapture(document.getElementById('cfg-shortcut-panel'), 'globalShortcutPanel', 'shortcut-panel-conflict');
  renderShortcutStatus();
  renderShortcutConflict(settingsDraft.globalShortcut, 'shortcut-conflict');
  renderShortcutConflict(settingsDraft.globalShortcutClip, 'shortcut-clip-conflict');
  renderShortcutConflict(settingsDraft.globalShortcutPanel, 'shortcut-panel-conflict');

  document.getElementById('btn-test-quick').addEventListener('click', () => API.openQuickWindow());
  document.getElementById('btn-test-clip').addEventListener('click', () => API.openClipWindow());
  document.getElementById('btn-test-panel').addEventListener('click', () => API.showPanelWindow());
}

/**
 * Alerts: the notification and its sound, on the same screen.
 *
 * They used to be two tabs, and the split meant going back and forth to adjust
 * one thing — turning the sound on in one tab and picking the volume in another.
 */
function renderAlertsTab(body) {
  const volume = Number.isFinite(Number(settingsDraft.soundVolume)) ? Number(settingsDraft.soundVolume) : 60;
  body.innerHTML = `
    <div class="cfg-section">
      <h4 class="cfg-heading">Alert sound</h4>

      <label class="cfg-toggle">
        <input type="checkbox" id="cfg-sound" ${settingsDraft.soundEnabled ? 'checked' : ''}>
        <span>
          Play a chime with the notification
          <em>Its own volume, independent of the system's overall volume.</em>
        </span>
      </label>

      <div class="form-group" id="cfg-volume-block" class="${settingsDraft.soundEnabled ? '' : 'is-hidden'}">
        <div class="volume-row">
          <input type="range" id="cfg-sound-volume" min="0" max="100" step="5" value="${volume}">
          <span class="volume-value" id="cfg-sound-volume-value">${volume}%</span>
          <button class="btn btn-secondary btn-inline" id="btn-test-sound">Test</button>
        </div>
      </div>
    </div>

    <div class="cfg-section">
      <h4 class="cfg-heading">Repetition</h4>
      <p class="cfg-note">
        The alert repeats on its own at the activity's own interval (the <code>!N</code>)
        until you mark it done. There's nothing to configure here — warning once and
        vanishing is how a reminder stops being useful.
      </p>
    </div>
  `;

  const chave = document.getElementById('cfg-sound');
  const bloco = document.getElementById('cfg-volume-block');
  const range = document.getElementById('cfg-sound-volume');
  const volumeLabel = document.getElementById('cfg-sound-volume-value');

  bloco.classList.toggle('is-hidden', !chave.checked);
  chave.addEventListener('change', (e) => {
    settingsDraft.soundEnabled = e.target.checked;
    bloco.classList.toggle('is-hidden', !e.target.checked);
  });
  range.addEventListener('input', () => {
    settingsDraft.soundVolume = Number(range.value);
    volumeLabel.textContent = `${range.value}%`;
  });
  document.getElementById('btn-test-sound')
    .addEventListener('click', () => API.testSound(Number(range.value)));
}


const KEY_ALIASES = {
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right'
};

function isModifierKey(key) {
  return ['Control', 'Alt', 'Shift', 'Meta', 'AltGraph'].includes(key);
}

function formatShortcut(event) {
  const parts = [];
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  if (event.metaKey) parts.push('Super');

  let key = event.key;
  if (key.length === 1) {
    key = key.toUpperCase();
  } else if (KEY_ALIASES[key]) {
    key = KEY_ALIASES[key];
  }

  if (isModifierKey(event.key) || parts.length === 0) return null;
  return [...parts, key].join('+');
}

async function renderShortcutStatus() {
  const el = document.getElementById('shortcut-status');
  if (!el) return;
  try {
    const status = await API.getShortcutStatus();
    if (status.registered) {
      const combos = `${status.shortcut} / ${status.shortcutClip} / ${status.shortcutPanel}`;
      el.textContent =
        status.environment === 'hyprland'
          ? `Shortcuts active — registered in Hyprland by the service (${combos}).`
          : `Global shortcuts active (${combos}).`;
      el.className = 'shortcut-status ok';
    } else if (status.error) {
      el.textContent = status.error;
      el.className = 'shortcut-status warn';
    } else {
      el.textContent = '';
      el.className = 'shortcut-status';
    }
  } catch {
    el.textContent = '';
  }
}

/**
 * Warns if the chosen combination already belongs to another compositor
 * shortcut — saving overwrites the old bind.
 */
async function renderShortcutConflict(accelerator, elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  try {
    const conflict = await API.checkShortcutConflict(accelerator);
    if (conflict) {
      el.textContent = `Heads up: ${accelerator} is already used by "${conflict}". Saving will replace that shortcut.`;
      el.className = 'shortcut-status warn';
    } else {
      el.textContent = '';
      el.className = 'shortcut-status';
    }
  } catch {
    el.textContent = '';
  }
}

function setupShortcutCapture(input, configKey, conflictElId) {
  let recording = false;

  function startRecording() {
    recording = true;
    input.classList.add('recording');
    input.value = 'Press the keys...';
    input.blur();
    input.focus();
  }

  function stopRecording(value) {
    recording = false;
    input.classList.remove('recording');
    input.value = value || '';
  }

  input.addEventListener('focus', () => {
    if (!recording) startRecording();
  });

  input.addEventListener('keydown', (e) => {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();

    const shortcut = formatShortcut(e);
    if (shortcut) {
      stopRecording(shortcut);
      settingsDraft[configKey] = shortcut;
      input.blur();
      renderShortcutConflict(shortcut, conflictElId);
    }
  });

  input.addEventListener('blur', () => {
    if (recording) {
      stopRecording(settingsDraft[configKey] || '');
    }
  });
}

// ---------- Panel keyboard shortcuts ----------

function setupPanelKeyboard() {
  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement && document.activeElement.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA';

    // "/" focuses the current tab's search — activities or clipboard.
    if ((e.key === '/' && !typing) || (e.ctrlKey && e.key.toLowerCase() === 'f')) {
      e.preventDefault();
      if (currentScreen !== 'dashboard' && currentScreen !== 'clipboard') {
        currentScreen = 'dashboard';
        renderPanelMode();
      }
      const search = document.getElementById(currentScreen === 'clipboard' ? 'clip-search' : 'search-input');
      if (search) search.focus();
      return;
    }

    if (e.key.toLowerCase() === 'n' && !typing && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      if (currentScreen === 'clipboard') {
        const input = document.getElementById('add-entry-content');
        if (input) input.focus();
        return;
      }
      if (currentScreen !== 'dashboard') {
        currentScreen = 'dashboard';
        renderPanelMode();
      }
      const input = document.getElementById('dash-input');
      if (input) input.focus();
      return;
    }

    if (e.key === 'Escape' && document.activeElement) {
      if (document.activeElement.id === 'search-input') {
        searchQuery = '';
        rerenderPreservingFocus();
      } else if (document.activeElement.id === 'clip-search') {
        clipSearchQuery = '';
        rerenderPreservingFocus();
      }
    }
  });
}

// ---------- Startup ----------

async function init() {
  state = await API.getState();

  if (mode === 'quick') {
    renderQuickMode();
  } else if (mode === 'clip') {
    renderClipMode();
  } else {
    renderPanelMode();
    setupPanelKeyboard();

    // Keeps the relative times ("alert in X min") up to date.
    setInterval(() => {
      if (currentScreen === 'dashboard') rerenderPreservingFocus();
    }, 60000);
  }

  // Events from main.
  API.on('state:reload', (newState) => {
    state = newState;
    refreshPanel();
  });

  API.on('entries:changed', (entries) => {
    state.entries = entries;
    refreshPanel();
  });

  API.on('activity:created', (activity) => {
    state.activities = [activity, ...state.activities];
    refreshPanel();
  });

  API.on('activity:updated', (activity) => {
    const idx = state.activities.findIndex((a) => a.id === activity.id);
    if (idx !== -1) state.activities[idx] = activity;
    refreshPanel();
  });

  API.on('activity:deleted', ({ id }) => {
    state.activities = state.activities.filter((a) => a.id !== id);
    refreshPanel();
  });

  API.on('config:updated', (config) => {
    state.config = config;
    if (mode === 'quick') renderQuickMode();
    else if (mode === 'clip') renderClipMode();
    else refreshPanel();
  });

  API.on('shortcut:status', () => {
    if (mode === 'panel' && currentScreen === 'settings') renderShortcutStatus();
  });

  API.on('activity:focus', ({ id }) => {
    currentScreen = 'dashboard';
    renderPanelMode();
    setTimeout(() => {
      const el = document.querySelector(`.activity-card[data-id="${id}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('highlight');
        setTimeout(() => el.classList.remove('highlight'), 2000);
      }
    }, 50);
  });
}

init().catch(console.error);
