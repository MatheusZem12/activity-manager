const API = window.activityAPI;
const Parser = window.ActivityParser;

const params = new URLSearchParams(window.location.search);
const mode = params.get('mode') || 'main';

const appEl = document.getElementById('app');

let state = { activities: [], config: {} };

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

function allTags() {
  const counts = {};
  for (const a of state.activities) {
    for (const t of a.tags) counts[t] = (counts[t] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

function findActivity(id) {
  return state.activities.find((a) => a.id === id) || null;
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

// ---------- Modo principal ----------

function renderMainMode() {
  appEl.innerHTML = `
    <div class="main-layout">
      <header class="topbar">
        <div class="logo"><span>Activity</span> Manager</div>
        <nav class="nav">
          <button data-screen="dashboard" class="${currentScreen === 'dashboard' ? 'active' : ''}">Atividades</button>
          <button data-screen="reports" class="${currentScreen === 'reports' ? 'active' : ''}">Relatórios</button>
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
      renderMainMode();
    });
  });

  renderScreen();
}

function renderScreen() {
  const content = document.getElementById('main-content');
  if (!content) return;
  if (currentScreen === 'dashboard') renderDashboard(content);
  else if (currentScreen === 'reports') renderReports(content);
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

function refreshMain() {
  if (mode !== 'main') return;
  if (!document.getElementById('main-content')) {
    renderMainMode();
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

// ---------- Relatórios ----------

function renderReports(container) {
  const completed = state.activities.filter((a) => a.completedAt);
  const pending = state.activities.filter((a) => !a.completedAt);

  const totalTime = completed.reduce((sum, a) => sum + (a.completedAt - a.createdAt), 0);
  const avgTime = completed.length > 0 ? totalTime / completed.length : 0;

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const todayStart = startOfDay.getTime();
  const completedToday = completed.filter((a) => a.completedAt >= todayStart).length;
  const overdueCount = pending.filter((a) => a.dueAt < Date.now()).length;

  const tagCounts = {};
  state.activities.forEach((a) => {
    a.tags.forEach((t) => {
      tagCounts[t] = (tagCounts[t] || 0) + 1;
    });
  });
  const sortedTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]);
  const maxTag = sortedTags.length > 0 ? sortedTags[0][1] : 1;

  container.innerHTML = `
    <h2 class="section-title">Visão geral</h2>
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-value">${state.activities.length}</div><div class="stat-label">Total de atividades</div></div>
      <div class="stat-card"><div class="stat-value">${pending.length}</div><div class="stat-label">Pendentes</div></div>
      <div class="stat-card"><div class="stat-value ${overdueCount > 0 ? 'danger' : ''}">${overdueCount}</div><div class="stat-label">Atrasadas</div></div>
      <div class="stat-card"><div class="stat-value">${completed.length}</div><div class="stat-label">Concluídas</div></div>
      <div class="stat-card"><div class="stat-value">${completedToday}</div><div class="stat-label">Concluídas hoje</div></div>
      <div class="stat-card"><div class="stat-value">${formatDuration(avgTime)}</div><div class="stat-label">Tempo médio de resolução</div></div>
    </div>

    ${sortedTags.length > 0 ? `
      <div class="reports-section">
        <h3>Atividades por categoria</h3>
        <div class="tag-ranking">
          ${sortedTags.map(([tag, count]) => `
            <div class="tag-row">
              <div class="tag-name">#${escapeHtml(tag)}</div>
              <div class="tag-bar-bg"><div class="tag-bar" style="width:${(count / maxTag) * 100}%"></div></div>
              <div class="tag-count">${count}</div>
            </div>
          `).join('')}
        </div>
      </div>
    ` : `<div class="empty-state">Nenhuma categoria registrada ainda. Use #tag ao criar atividades.</div>`}
  `;
}

// ---------- Configurações ----------

function renderSettings(container) {
  container.innerHTML = `
    <h2 class="section-title">Configurações</h2>
    <div class="settings-form">
      <div class="form-group">
        <label>Tempo padrão do alerta (minutos)</label>
        <input type="number" id="cfg-default-minutes" min="1" value="${state.config.defaultReminderMinutes}">
        <div class="form-hint">Usado quando você não digitar !N na atividade.</div>
      </div>

      <div class="form-group">
        <label>Limite máximo de caracteres</label>
        <input type="number" id="cfg-max-length" min="10" value="${state.config.maxTextLength}">
        <div class="form-hint">Tamanho máximo do texto de uma atividade.</div>
      </div>

      <div class="form-group">
        <label>Atalho global</label>
        <input type="text" id="cfg-shortcut" class="shortcut-input" value="${escapeHtml(state.config.globalShortcut)}" placeholder="Clique aqui e pressione as teclas" readonly>
        <div class="form-hint">
          Clique no campo e pressione a combinação desejada (ex: Ctrl+Alt+A). Ao salvar,
          o serviço registra o atalho no seu ambiente sozinho — você não precisa editar
          nenhum arquivo de configuração.
        </div>
        <div id="shortcut-conflict" class="shortcut-status"></div>
        <div id="shortcut-status" class="shortcut-status"></div>
        <button class="btn btn-secondary btn-inline" id="btn-test-quick">Testar janela rápida</button>
      </div>

      <div class="form-group checkbox-row">
        <input type="checkbox" id="cfg-autostart" ${state.config.startOnLogin ? 'checked' : ''}>
        <label for="cfg-autostart">Iniciar junto com o sistema</label>
      </div>

      <div class="settings-actions">
        <button class="btn btn-secondary" id="btn-export">Exportar backup</button>
        <button class="btn btn-secondary" id="btn-import">Importar backup</button>
        <button class="btn btn-primary" id="btn-save-cfg">Salvar configurações</button>
      </div>
    </div>
  `;

  setupShortcutCapture(document.getElementById('cfg-shortcut'));
  renderShortcutStatus();
  renderShortcutConflict(state.config.globalShortcut);

  document.getElementById('btn-test-quick').addEventListener('click', () => API.openQuickWindow());

  document.getElementById('btn-save-cfg').addEventListener('click', async () => {
    const saveBtn = document.getElementById('btn-save-cfg');
    const patch = {
      defaultReminderMinutes: parseInt(document.getElementById('cfg-default-minutes').value, 10) || 15,
      maxTextLength: parseInt(document.getElementById('cfg-max-length').value, 10) || 120,
      globalShortcut: document.getElementById('cfg-shortcut').value.trim() || 'Ctrl+Alt+A',
      startOnLogin: document.getElementById('cfg-autostart').checked
    };

    // Registrar o atalho recarrega o compositor: pode levar um instante.
    saveBtn.disabled = true;
    saveBtn.textContent = 'Salvando...';
    try {
      await API.saveConfig(patch);
      await renderShortcutStatus();
      toast('Configurações salvas');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Salvar configurações';
    }
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
      el.textContent =
        status.environment === 'hyprland'
          ? `Atalho ativo — registrado no Hyprland pelo serviço (${status.shortcut}).`
          : `Atalho global ativo (${status.shortcut}).`;
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
async function renderShortcutConflict(accelerator) {
  const el = document.getElementById('shortcut-conflict');
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

function setupShortcutCapture(input) {
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
      input.blur();
      renderShortcutConflict(shortcut);
    }
  });

  input.addEventListener('blur', () => {
    if (recording) {
      stopRecording(state.config.globalShortcut || '');
    }
  });
}

// ---------- Atalhos de teclado da janela principal ----------

function setupMainKeyboard() {
  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement && document.activeElement.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA';

    if ((e.key === '/' && !typing) || (e.ctrlKey && e.key.toLowerCase() === 'f')) {
      e.preventDefault();
      if (currentScreen !== 'dashboard') {
        currentScreen = 'dashboard';
        renderMainMode();
      }
      const search = document.getElementById('search-input');
      if (search) search.focus();
      return;
    }

    if (e.key.toLowerCase() === 'n' && !typing && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      if (currentScreen !== 'dashboard') {
        currentScreen = 'dashboard';
        renderMainMode();
      }
      const input = document.getElementById('dash-input');
      if (input) input.focus();
      return;
    }

    if (e.key === 'Escape' && document.activeElement && document.activeElement.id === 'search-input') {
      searchQuery = '';
      rerenderPreservingFocus();
    }
  });
}

// ---------- Inicialização ----------

async function init() {
  state = await API.getState();

  if (mode === 'quick') {
    renderQuickMode();
  } else {
    renderMainMode();
    setupMainKeyboard();

    // Mantém os tempos relativos ("alerta em X min") atualizados.
    setInterval(() => {
      if (currentScreen === 'dashboard') rerenderPreservingFocus();
    }, 60000);
  }

  // Eventos do main.
  API.on('state:reload', (newState) => {
    state = newState;
    refreshMain();
  });

  API.on('activity:created', (activity) => {
    state.activities = [activity, ...state.activities];
    refreshMain();
  });

  API.on('activity:updated', (activity) => {
    const idx = state.activities.findIndex((a) => a.id === activity.id);
    if (idx !== -1) state.activities[idx] = activity;
    refreshMain();
  });

  API.on('activity:deleted', ({ id }) => {
    state.activities = state.activities.filter((a) => a.id !== id);
    refreshMain();
  });

  API.on('config:updated', (config) => {
    state.config = config;
    if (mode === 'quick') renderQuickMode();
    else refreshMain();
  });

  API.on('shortcut:status', () => {
    if (mode === 'main' && currentScreen === 'settings') renderShortcutStatus();
  });

  API.on('activity:focus', ({ id }) => {
    currentScreen = 'dashboard';
    renderMainMode();
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
