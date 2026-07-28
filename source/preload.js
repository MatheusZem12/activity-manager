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
