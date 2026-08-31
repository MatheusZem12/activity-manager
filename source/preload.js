const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('activityAPI', {
  getState: () => ipcRenderer.invoke('app:state'),

  createActivity: (text) => ipcRenderer.invoke('activity:create', text),
  updateActivity: (id, text) => ipcRenderer.invoke('activity:update', { id, text }),
  snoozeActivity: (id, minutes) => ipcRenderer.invoke('activity:snooze', { id, minutes }),
  reopenActivity: (id) => ipcRenderer.invoke('activity:reopen', id),
  completeActivity: (id) => ipcRenderer.invoke('activity:complete', id),
  deleteActivity: (id) => ipcRenderer.invoke('activity:delete', id),

  listEntries: () => ipcRenderer.invoke('entries:list'),
  createEntry: (title, content) => ipcRenderer.invoke('entries:create', { title, content }),
  updateEntry: (id, title, content) => ipcRenderer.invoke('entries:update', { id, title, content }),
  deleteEntry: (id) => ipcRenderer.invoke('entries:delete', id),
  copyEntry: (id) => ipcRenderer.invoke('entries:copy', id),

  saveConfig: (patch) => ipcRenderer.invoke('config:save', patch),

  exportBackup: () => ipcRenderer.invoke('backup:export'),
  importBackup: () => ipcRenderer.invoke('backup:import'),

  closeQuickWindow: () => ipcRenderer.invoke('quick:close'),
  openQuickWindow: () => ipcRenderer.invoke('quick:open'),
  setQuickDraft: (hasDraft) => ipcRenderer.invoke('quick:draft', hasDraft),

  closeClipWindow: () => ipcRenderer.invoke('clip:close'),
  openClipWindow: () => ipcRenderer.invoke('clip:open'),
  setClipDraft: (hasDraft) => ipcRenderer.invoke('clip:draft', hasDraft),

  testSound: (volume) => ipcRenderer.invoke('sound:test', volume),
  showPanelWindow: () => ipcRenderer.invoke('window:showPanel'),
  closePanelWindow: () => ipcRenderer.invoke('panel:close'),
  getShortcutStatus: () => ipcRenderer.invoke('shortcut:status'),
  checkShortcutConflict: (accelerator) => ipcRenderer.invoke('shortcut:conflict', accelerator),

  on: (channel, callback) => {
    const allowed = [
      'activity:created',
      'activity:updated',
      'activity:deleted',
      'activity:alert',
      'activity:focus',
      'entries:changed',
      'config:updated',
      'shortcut:status',
      'state:reload'
    ];
    if (!allowed.includes(channel)) return () => {};
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  }
});

/**
 * O Rastro fala por um canal próprio.
 *
 * Separado de `activityAPI` porque é outro domínio — e porque quase tudo aqui é
 * repasse para o backend. A tela do Rastro não decide nada: pede e exibe.
 */
contextBridge.exposeInMainWorld('RastroAPI', {
  estado: () => ipcRenderer.invoke('rastro:estado'),
  local: (data) => ipcRenderer.invoke('rastro:local', data),
  relatorio: (de, ate) => ipcRenderer.invoke('rastro:relatorio', { de, ate }),
  categorias: () => ipcRenderer.invoke('rastro:categorias'),
  regras: () => ipcRenderer.invoke('rastro:regras'),
  salvarCategoria: (id, dados) => ipcRenderer.invoke('rastro:salvarCategoria', { id, dados }),
  salvarRegra: (id, dados) => ipcRenderer.invoke('rastro:salvarRegra', { id, dados }),
  apagarRegra: (id) => ipcRenderer.invoke('rastro:apagarRegra', id),
  entrar: (dados) => ipcRenderer.invoke('rastro:entrar', dados),
  sair: () => ipcRenderer.invoke('rastro:sair'),
  configurar: (patch) => ipcRenderer.invoke('rastro:configurar', patch),
  sincronizar: () => ipcRenderer.invoke('rastro:sincronizar')
});
