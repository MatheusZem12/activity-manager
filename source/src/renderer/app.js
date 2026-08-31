const API = window.activityAPI;
const Parser = window.ActivityParser;
const EntryParser = window.EntryParser;

const params = new URLSearchParams(window.location.search);
const mode = params.get('mode') || 'panel';

const appEl = document.getElementById('app');

let state = { activities: [], entries: [], config: {} };

// Estado da interface — sobrevive às re-renderizações disparadas por eventos
// do main, para nunca apagar o que está sendo digitado.
let currentScreen = 'dashboard';
let searchQuery = '';
let activeTag = null;
let completedLimit = 20;
let editingId = null;
let editDraft = '';
let dashDraft = '';
let quickDraft = '';

// Aba de clipboard (dentro do painel)
let clipSearchQuery = '';
let clipActiveTag = null;
let clipSort = 'recent'; // 'recent' | 'copied'
let editingEntryId = null;
let editEntryTitleDraft = '';
let editEntryContentDraft = '';
let addEntryTitleDraft = '';
let addEntryContentDraft = '';

// Aba de configurações — sub-abas (geral/atalhos/notificações/volume) e o
// rascunho das edições, ver renderSettings().
let settingsTab = 'geral';
let settingsDraft = null;

// Janela rápida de captura de texto
let clipTitleDraft = '';
let clipContentDraft = '';

// ---------- Utilitários ----------

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
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function timeUntil(timestamp) {
  const diff = timestamp - Date.now();
  if (diff <= 0) return 'agora';
  return `em ${formatDuration(diff)}`;
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

/** Tags dos textos do clipboard — contadas separadas das de atividade. */
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

/** Título exibido: o armazenado ou, se vazio, a 1ª linha do conteúdo (60 chars). */
function displayTitle(entry) {
  if (entry.title && entry.title.trim()) return entry.title;
  const firstLine = (entry.content || '').split('\n')[0].trim();
  if (!firstLine) return '(sem título)';
  return firstLine.length > 60 ? firstLine.slice(0, 60) + '…' : firstLine;
}

/** Recompõe o título editável a partir do título limpo + tags. */
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

// ---------- Entrada inteligente (preview + autocomplete de tags) ----------

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
      : '<span class="preview-text empty">sem texto</span>'
  ];
  parsed.tags.forEach((t) => parts.push(`<span class="preview-chip">#${escapeHtml(t)}</span>`));
  parts.push(
    `<span class="preview-chip time">⏰ ${formatDuration(parsed.reminderMinutes * 60000)}${parsed.explicitReminder ? '' : ' (padrão)'}</span>`
  );
  el.innerHTML = parts.join('');
}

function currentTagPrefix(value, caret) {
  const upto = value.slice(0, caret);
  const m = upto.match(/#([a-zA-Z0-9_À-ÿ]*)$/);
  return m ? { prefix: m[1].toLowerCase(), start: caret - m[1].length } : null;
}

/**
 * Liga preview ao vivo, contador e autocomplete de #tags a um input.
 * Tab aceita a primeira sugestão; Enter envia.
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
      // mousedown: completa antes de o input perder o foco.
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
 * Versão do setupSmartInput para o **título de um texto do clipboard**: só
 * extrai #tags (não há !tempo aqui) e não trata o Enter — quem chama decide se
 * ele salva ou pula para o campo de conteúdo.
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
      // mousedown: completa antes de o input perder o foco.
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
            : '<span class="preview-text empty">título vazio (usa a 1ª linha do conteúdo)</span>'
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

// ---------- Modo rápido ----------

function renderQuickMode() {
  appEl.innerHTML = `
    <div class="quick-container">
      <div class="quick-header">
        <div class="quick-title">NOVA ATIVIDADE</div>
        <button class="quick-close" id="quick-close">&times;</button>
      </div>
      <textarea
        id="quick-input"
        class="quick-input"
        placeholder="Ex: atividade de matemática #faculdade #prova !30"
        maxlength="${maxLen()}"
        autofocus
      ></textarea>
      <div class="input-preview" id="quick-preview"></div>
      <div class="tag-suggest" id="quick-suggest"></div>
      <div class="quick-meta">
        <div class="quick-hint">
          <span class="tag">#tag</span> categoriza · <span class="tag">!30</span> <span class="tag">!2h</span> <span class="tag">!1h30</span> alerta · <span class="tag">Tab</span> completa tag · <span class="tag">Enter</span> salva · <span class="tag">Esc</span> fecha
        </div>
        <div class="quick-counter" id="quick-counter"></div>
      </div>
      <div class="quick-actions">
        <button class="btn btn-secondary" id="quick-cancel">Cancelar</button>
        <button class="btn btn-primary" id="quick-save">Salvar</button>
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
      toast('Erro ao salvar atividade.');
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
      // Enquanto houver rascunho, a janela não se fecha ao perder o foco.
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

// ---------- Modo captura de texto (clipboard) ----------

function renderClipMode() {
  appEl.innerHTML = `
    <div class="quick-container">
      <div class="quick-header">
        <div class="quick-title">NOVO TEXTO</div>
        <button class="quick-close" id="clip-close">&times;</button>
      </div>
      <input
        type="text"
        id="clip-title"
        class="quick-title-input"
        placeholder="Título (opcional) — use #tag para categorizar"
        maxlength="${maxTitleLen()}"
      >
      <div class="input-preview" id="clip-preview"></div>
      <div class="tag-suggest" id="clip-suggest"></div>
      <textarea
        id="clip-content"
        class="quick-content"
        placeholder="Conteúdo a salvar (será colado exatamente como digitado)"
      ></textarea>
      <div class="quick-meta">
        <div class="quick-hint">
          <span class="tag">#tag</span> no título · <span class="tag">Tab</span> completa · <span class="tag">Enter</span> salva · <span class="tag">Shift+Enter</span> quebra linha · <span class="tag">Esc</span> fecha
        </div>
        <div class="quick-counter" id="clip-counter"></div>
      </div>
      <div class="quick-actions">
        <button class="btn btn-secondary" id="clip-cancel">Cancelar</button>
        <button class="btn btn-primary" id="clip-save">Salvar</button>
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
    // Enquanto houver rascunho, a janela não se fecha ao perder o foco.
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
      toast('Erro ao salvar.');
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
        // Enter no título → foca o conteúdo.
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
      // Enter salva; Shift+Enter quebra linha (padrão do textarea).
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

// ---------- Painel de atividades (janela overlay) ----------

function renderPanelMode() {
  appEl.innerHTML = `
    <div class="main-layout">
      <header class="topbar">
        <div class="topbar-row">
          <div class="logo"><span>Activity</span> Manager</div>
          <button class="panel-close" id="panel-close" title="Fechar">&times;</button>
        </div>
        <nav class="nav">
          <button data-screen="dashboard" class="${currentScreen === 'dashboard' ? 'active' : ''}">Atividades</button>
          <button data-screen="clipboard" class="${currentScreen === 'clipboard' ? 'active' : ''}">Clipboard</button>
          <button data-screen="rastro" class="${currentScreen === 'rastro' ? 'active' : ''}">Rastro</button>
          <button data-screen="settings" class="${currentScreen === 'settings' ? 'active' : ''}">Configurações</button>
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
      settingsTab = 'geral';
      settingsDraft = null;
      if (currentScreen === 'rastro') Rastro.invalidar();
      renderPanelMode();
    });
  });

  document.getElementById('panel-close').addEventListener('click', () => API.closePanelWindow());

  renderScreen();
}

function renderScreen() {
  const content = document.getElementById('main-content');
  if (!content) return;
  if (currentScreen === 'dashboard') renderDashboard(content);
  else if (currentScreen === 'clipboard') renderClipboardScreen(content);
  // A aba Rastro se desenha sozinha e é assíncrona: os dados vêm do backend.
  else if (currentScreen === 'rastro') Rastro.render(content, () => renderScreen());
  else if (currentScreen === 'settings') renderSettings(content);
}

/**
 * Re-renderiza a tela atual sem perder o foco nem a posição do cursor —
 * essencial porque os eventos do main chegam enquanto o usuário digita.
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
        try { el.setSelectionRange(selStart, selEnd); } catch { /* inputs sem seleção */ }
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
    return `Concluída em ${formatTime(a.completedAt)} · Levou ${formatDuration(a.completedAt - a.createdAt)}`;
  }
  const overdue = a.dueAt < Date.now();
  return `Alerta ${timeUntil(a.dueAt)} · Criada ${formatTime(a.createdAt)}${overdue ? ' · <span class="overdue-badge">atrasada</span>' : ''}`;
}

function activityCardHtml(a, isCompleted) {
  if (a.id === editingId && !isCompleted) {
    return `
      <div class="activity-card editing" data-id="${a.id}">
        <input id="edit-input" class="edit-input" maxlength="${maxLen()}" value="${escapeHtml(editDraft)}">
        <div class="activity-actions">
          <button class="icon-btn complete" title="Salvar (Enter)" data-action="save-edit">✓</button>
          <button class="icon-btn" title="Cancelar (Esc)" data-action="cancel-edit">✕</button>
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
            ${a.tags.map((t) => `<button class="tag-pill" data-tag-filter="${escapeHtml(t)}" title="Filtrar por #${escapeHtml(t)}">#${escapeHtml(t)}</button>`).join('')}
          </div>
        ` : ''}
        <div class="activity-meta">${activityMetaHtml(a, isCompleted)}</div>
      </div>
      <div class="activity-actions">
        ${!isCompleted ? `
          <button class="icon-btn complete" title="Concluir" data-action="complete">✓</button>
          <button class="icon-btn snooze" title="Adiar alerta em ${a.reminderMinutes} min" data-action="snooze">+${a.reminderMinutes}m</button>
          <button class="icon-btn" title="Editar" data-action="edit">✎</button>
        ` : `
          <button class="icon-btn" title="Reabrir" data-action="reopen">↩</button>
        `}
        <button class="icon-btn delete" title="Excluir" data-action="delete">🗑</button>
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
        <input type="text" id="dash-input" placeholder="Adicionar atividade... (N)" maxlength="${maxLen()}" value="${escapeHtml(dashDraft)}">
        <button class="btn btn-primary" id="dash-add">Adicionar</button>
      </div>
      <div class="input-preview" id="dash-preview"></div>
      <div class="tag-suggest" id="dash-suggest"></div>
      <div class="quick-add-help">
        <strong>#tag</strong> categoriza · <strong>!30</strong>, <strong>!2h</strong> ou <strong>!1h30</strong> define o alerta (padrão: ${defaultMinutes()} min) · <strong>Tab</strong> completa a tag
      </div>
    </div>

    <div class="toolbar">
      <input type="search" id="search-input" class="search-input" placeholder="Buscar atividades... (/)" value="${escapeHtml(searchQuery)}">
      ${tags.length > 0 ? `
        <div class="tag-filter">
          ${tags.map(([t, count]) => `
            <button class="filter-chip ${activeTag === t ? 'active' : ''}" data-tag-filter="${escapeHtml(t)}">#${escapeHtml(t)} <span class="chip-count">${count}</span></button>
          `).join('')}
          ${activeTag ? `<button class="filter-chip clear" id="clear-filter">limpar ✕</button>` : ''}
        </div>
      ` : ''}
    </div>

    <h2 class="section-title">Pendentes (${pending.length})</h2>
    <div class="activities-list" id="pending-list">
      ${pending.length > 0
        ? pending.map((a) => activityCardHtml(a, false)).join('')
        : `<div class="empty-state">${filtering ? 'Nada encontrado com esse filtro.' : 'Nenhuma atividade pendente. Use o campo acima ou o atalho global para anotar.'}</div>`}
    </div>

    ${completedAll.length > 0 ? `
      <h2 class="section-title section-completed">Concluídas (${completedAll.length})</h2>
      <div class="activities-list" id="completed-list">
        ${completed.map((a) => activityCardHtml(a, true)).join('')}
      </div>
      ${completedAll.length > completed.length ? `
        <button class="btn btn-secondary btn-inline" id="show-more">Mostrar mais (${completedAll.length - completed.length})</button>
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
    toast('Atividade adicionada');
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
          toast(`Concluída — levou ${formatDuration(Date.now() - (a ? a.createdAt : Date.now()))}`);
        } else if (action === 'snooze') {
          const a = findActivity(id);
          const mins = a ? a.reminderMinutes : defaultMinutes();
          await API.snoozeActivity(id, mins);
          toast(`Alerta adiado ${mins} min`);
        } else if (action === 'delete') {
          if (confirm('Tem certeza que deseja excluir esta atividade?')) {
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
          toast('Atividade reaberta');
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
  toast('Atividade atualizada');
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

// ---------- Aba Clipboard ----------

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
        <input id="edit-entry-title" class="edit-input" maxlength="${maxTitleLen()}" value="${escapeHtml(editEntryTitleDraft)}" placeholder="Título (use #tag)">
        <div class="tag-suggest" id="edit-entry-suggest"></div>
        <textarea id="edit-entry-content" class="edit-content" placeholder="Conteúdo">${escapeHtml(editEntryContentDraft)}</textarea>
        <div class="edit-actions">
          <button class="btn btn-primary btn-sm" data-entry-action="save-edit">Salvar</button>
          <button class="btn btn-secondary btn-sm" data-entry-action="cancel-edit">Cancelar</button>
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
            ${e.tags.map((t) => `<button class="tag-pill" data-entry-tag="${escapeHtml(t)}" title="Filtrar por #${escapeHtml(t)}">#${escapeHtml(t)}</button>`).join('')}
          </div>
        ` : ''}
        <div class="entry-meta">Criado ${formatTime(e.createdAt)}${e.copyCount ? ` · Copiado ${e.copyCount}×` : ''}</div>
      </div>
      <div class="entry-actions">
        <button class="btn btn-primary btn-sm btn-copy" data-entry-action="copy">Copiar</button>
        <button class="icon-btn" data-entry-action="edit" title="Editar">✎</button>
        <button class="icon-btn delete" data-entry-action="delete" title="Excluir">🗑</button>
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
      <input type="text" id="add-entry-title" placeholder="Título (opcional, use #tag)..." maxlength="${maxTitleLen()}" value="${escapeHtml(addEntryTitleDraft)}">
      <div class="input-preview" id="add-entry-preview"></div>
      <div class="tag-suggest" id="add-entry-suggest"></div>
      <textarea id="add-entry-content" placeholder="Conteúdo a salvar...">${escapeHtml(addEntryContentDraft)}</textarea>
      <div class="add-row">
        <div class="quick-add-help"><strong>#tag</strong> no título categoriza · <strong>Ctrl+Enter</strong> adiciona · o conteúdo é salvo exatamente como digitado</div>
        <button class="btn btn-primary" id="add-entry-btn">Adicionar</button>
      </div>
    </div>

    <div class="toolbar">
      <input type="search" id="clip-search" class="search-input" placeholder="Buscar textos... (/)" value="${escapeHtml(clipSearchQuery)}">
      <div class="panel-sort" id="clip-sort">
        <button data-sort="recent" class="${clipSort === 'recent' ? 'active' : ''}">Recentes</button>
        <button data-sort="copied" class="${clipSort === 'copied' ? 'active' : ''}">Copiados</button>
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

    <h2 class="section-title">Textos (${entries.length})</h2>
    <div class="entries-list" id="entries-list">
      ${entries.length > 0
        ? entries.map((e) => entryCardHtml(e)).join('')
        : `<div class="empty-state">${filtering ? 'Nada encontrado com esse filtro.' : 'Nenhum texto salvo. Use o formulário acima ou o atalho global.'}</div>`}
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
    toast('Texto salvo');
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
          toast('Copiado!');
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
          if (confirm('Tem certeza que deseja excluir este texto?')) {
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
  toast('Texto atualizado');
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

// ---------- Configurações ----------

const SETTINGS_TABS = [
  { key: 'geral', label: 'Geral' },
  { key: 'atalhos', label: 'Atalhos' },
  { key: 'notificacoes', label: 'Notificações' },
  { key: 'volume', label: 'Volume' }
];

/**
 * As edições ficam num rascunho separado de `state.config` — assim trocar de
 * aba (o que re-renderiza só a aba ativa) não perde o que foi digitado nas
 * outras. `null` sinaliza "recém-entrou na tela", e é reconstruído a partir do
 * config salvo; fica `null` de novo depois de salvar com sucesso.
 */
function renderSettings(container) {
  if (!settingsDraft) settingsDraft = { ...state.config };

  container.innerHTML = `
    <h2 class="section-title">Configurações</h2>
    <div class="settings-tabs">
      ${SETTINGS_TABS.map((t) => `<button data-tab="${t.key}" class="${settingsTab === t.key ? 'active' : ''}">${t.label}</button>`).join('')}
    </div>
    <div class="settings-form" id="settings-tab-body"></div>
    <div class="settings-actions settings-footer">
      <button class="btn btn-primary" id="btn-save-cfg">Salvar configurações</button>
    </div>
  `;

  document.querySelectorAll('.settings-tabs button').forEach((btn) => {
    btn.addEventListener('click', () => {
      settingsTab = btn.dataset.tab;
      renderScreen();
    });
  });

  const body = document.getElementById('settings-tab-body');
  if (settingsTab === 'geral') renderGeneralTab(body);
  else if (settingsTab === 'atalhos') renderShortcutsTab(body);
  else if (settingsTab === 'notificacoes') renderNotificationsTab(body);
  else if (settingsTab === 'volume') renderVolumeTab(body);

  document.getElementById('btn-save-cfg').addEventListener('click', async () => {
    const saveBtn = document.getElementById('btn-save-cfg');
    const patch = {
      defaultReminderMinutes: parseInt(settingsDraft.defaultReminderMinutes, 10) || 15,
      maxTextLength: parseInt(settingsDraft.maxTextLength, 10) || 120,
      maxTitleLength: parseInt(settingsDraft.maxTitleLength, 10) || 120,
      globalShortcut: (settingsDraft.globalShortcut || '').trim() || 'Ctrl+Alt+A',
      globalShortcutClip: (settingsDraft.globalShortcutClip || '').trim() || 'Ctrl+Alt+C',
      globalShortcutPanel: (settingsDraft.globalShortcutPanel || '').trim() || 'Ctrl+Alt+P',
      panelSide: settingsDraft.panelSide,
      startOnLogin: !!settingsDraft.startOnLogin,
      soundEnabled: !!settingsDraft.soundEnabled,
      soundVolume: parseInt(settingsDraft.soundVolume, 10)
    };

    // Registrar o atalho recarrega o compositor: pode levar um instante.
    saveBtn.disabled = true;
    saveBtn.textContent = 'Salvando...';
    try {
      await API.saveConfig(patch);
      settingsDraft = null;
      await renderShortcutStatus();
      toast('Configurações salvas');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Salvar configurações';
    }
  });
}

function renderGeneralTab(body) {
  body.innerHTML = `
    <div class="form-group">
      <label>Tempo padrão do alerta (minutos)</label>
      <input type="number" id="cfg-default-minutes" min="1" value="${settingsDraft.defaultReminderMinutes}">
      <div class="form-hint">Usado quando você não digitar !N na atividade.</div>
    </div>

    <div class="form-group">
      <label>Limite máximo de caracteres</label>
      <input type="number" id="cfg-max-length" min="10" value="${settingsDraft.maxTextLength}">
      <div class="form-hint">Tamanho máximo do texto de uma atividade.</div>
    </div>

    <div class="form-group">
      <label>Limite de caracteres do título (clipboard)</label>
      <input type="number" id="cfg-max-title" min="10" value="${settingsDraft.maxTitleLength}">
      <div class="form-hint">O conteúdo de um texto não tem limite — só o título.</div>
    </div>

    <div class="form-group">
      <label>Lado do painel</label>
      <select id="cfg-panel-side">
        <option value="right" ${settingsDraft.panelSide !== 'left' ? 'selected' : ''}>Direita</option>
        <option value="left" ${settingsDraft.panelSide === 'left' ? 'selected' : ''}>Esquerda</option>
      </select>
      <div class="form-hint">Em qual borda da tela este painel encosta.</div>
    </div>

    <div class="form-group checkbox-row">
      <input type="checkbox" id="cfg-autostart" ${settingsDraft.startOnLogin ? 'checked' : ''}>
      <label for="cfg-autostart">Iniciar junto com o sistema</label>
    </div>

    <div class="form-group">
      <label>Backup</label>
      <div class="settings-actions">
        <button class="btn btn-secondary" id="btn-export">Exportar backup</button>
        <button class="btn btn-secondary" id="btn-import">Importar backup</button>
      </div>
      <div class="form-hint">Um único JSON com atividades e textos do clipboard.</div>
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
  document.getElementById('cfg-panel-side').addEventListener('change', (e) => {
    settingsDraft.panelSide = e.target.value;
  });
  document.getElementById('cfg-autostart').addEventListener('change', (e) => {
    settingsDraft.startOnLogin = e.target.checked;
  });

  document.getElementById('btn-export').addEventListener('click', async () => {
    const filePath = await API.exportBackup();
    if (filePath) toast(`Backup salvo em ${filePath}`);
  });

  document.getElementById('btn-import').addEventListener('click', async () => {
    try {
      const result = await API.importBackup();
      if (result) toast(`Backup importado: ${result.count} atividade(s).`);
    } catch (err) {
      toast('Erro ao importar backup.');
      console.error(err);
    }
  });
}

function renderShortcutsTab(body) {
  body.innerHTML = `
    <div class="form-group">
      <label>Atalho — Nova atividade</label>
      <input type="text" id="cfg-shortcut" class="shortcut-input" value="${escapeHtml(settingsDraft.globalShortcut || '')}" placeholder="Clique aqui e pressione as teclas" readonly>
      <div id="shortcut-conflict" class="shortcut-status"></div>
    </div>

    <div class="form-group">
      <label>Atalho — Novo texto (clipboard)</label>
      <input type="text" id="cfg-shortcut-clip" class="shortcut-input" value="${escapeHtml(settingsDraft.globalShortcutClip || '')}" placeholder="Clique aqui e pressione as teclas" readonly>
      <div id="shortcut-clip-conflict" class="shortcut-status"></div>
    </div>

    <div class="form-group">
      <label>Atalho — Abrir painel lateral</label>
      <input type="text" id="cfg-shortcut-panel" class="shortcut-input" value="${escapeHtml(settingsDraft.globalShortcutPanel || '')}" placeholder="Clique aqui e pressione as teclas" readonly>
      <div id="shortcut-panel-conflict" class="shortcut-status"></div>
      <div class="form-hint">
        Clique no campo e pressione a combinação desejada. Ao salvar, o serviço registra
        os três atalhos no seu ambiente sozinho — você não precisa editar nenhum arquivo
        de configuração.
      </div>
      <div id="shortcut-status" class="shortcut-status"></div>
      <div class="settings-actions">
        <button class="btn btn-secondary btn-inline" id="btn-test-quick">Testar nova atividade</button>
        <button class="btn btn-secondary btn-inline" id="btn-test-clip">Testar novo texto</button>
        <button class="btn btn-secondary btn-inline" id="btn-test-panel">Testar painel lateral</button>
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

function renderNotificationsTab(body) {
  body.innerHTML = `
    <div class="form-group">
      <div class="checkbox-row">
        <input type="checkbox" id="cfg-sound" ${settingsDraft.soundEnabled ? 'checked' : ''}>
        <label for="cfg-sound">Tocar som no alerta</label>
      </div>
      <div class="form-hint">Um chime curto toca junto com a notificação da atividade.</div>
    </div>

    <div class="form-group">
      <label>Repetição do alerta</label>
      <div class="form-hint">
        Enquanto uma atividade não for concluída, o alerta (notificação + som) repete
        sozinho no mesmo intervalo definido nela (!N) — não é preciso configurar nada aqui.
      </div>
    </div>
  `;

  document.getElementById('cfg-sound').addEventListener('change', (e) => {
    settingsDraft.soundEnabled = e.target.checked;
  });
}

function renderVolumeTab(body) {
  const volume = Number.isFinite(Number(settingsDraft.soundVolume)) ? Number(settingsDraft.soundVolume) : 60;
  body.innerHTML = `
    <div class="form-group">
      <label>Volume do chime</label>
      <div class="volume-row">
        <input type="range" id="cfg-sound-volume" min="0" max="100" step="5" value="${volume}">
        <span class="volume-value" id="cfg-sound-volume-value">${volume}%</span>
      </div>
      <div class="form-hint">Volume próprio do alerta — independente do volume geral do sistema.</div>
      <button class="btn btn-secondary btn-inline" id="btn-test-sound">Testar som</button>
    </div>
  `;

  const range = document.getElementById('cfg-sound-volume');
  const valueLabel = document.getElementById('cfg-sound-volume-value');
  range.addEventListener('input', () => {
    settingsDraft.soundVolume = Number(range.value);
    valueLabel.textContent = `${range.value}%`;
  });

  document.getElementById('btn-test-sound').addEventListener('click', () => API.testSound(Number(range.value)));
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
          ? `Atalhos ativos — registrados no Hyprland pelo serviço (${combos}).`
          : `Atalhos globais ativos (${combos}).`;
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
 * Avisa se a combinação escolhida já pertence a outro atalho do compositor —
 * salvar sobrescreve o bind antigo.
 */
async function renderShortcutConflict(accelerator, elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  try {
    const conflict = await API.checkShortcutConflict(accelerator);
    if (conflict) {
      el.textContent = `Atenção: ${accelerator} já é usado por "${conflict}". Salvar vai substituir esse atalho.`;
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
    input.value = 'Pressione as teclas...';
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

// ---------- Atalhos de teclado do painel ----------

function setupPanelKeyboard() {
  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement && document.activeElement.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA';

    // "/" foca a busca da aba atual — atividades ou clipboard.
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

// ---------- Inicialização ----------

async function init() {
  state = await API.getState();

  if (mode === 'quick') {
    renderQuickMode();
  } else if (mode === 'clip') {
    renderClipMode();
  } else {
    renderPanelMode();
    setupPanelKeyboard();

    // Mantém os tempos relativos ("alerta em X min") atualizados.
    setInterval(() => {
      if (currentScreen === 'dashboard') rerenderPreservingFocus();
    }, 60000);
  }

  // Eventos do main.
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
