const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('activityAPI', {
  getState: () => ipcRenderer.invoke('app:state'),

  createActivity: (text) => ipcRenderer.invoke('activity:create', text),
  updateActivity: (id, text) => ipcRenderer.invoke('activity:update', { id, text }),
  snoozeActivity: (id, minutes) => ipcRenderer.invoke('activity:snooze', { id, minutes }),
  reopenActivity: (id) => ipcRenderer.invoke('activity:reopen', id),
  completeActivity: (id) => ipcRenderer.invoke('activity:complete', id),
  deleteActivity: (id) => ipcRenderer.invoke('activity:delete', id),

  saveConfig: (patch) => ipcRenderer.invoke('config:save', patch),

  exportBackup: () => ipcRenderer.invoke('backup:export'),
  importBackup: () => ipcRenderer.invoke('backup:import'),

  closeQuickWindow: () => ipcRenderer.invoke('quick:close'),
  openQuickWindow: () => ipcRenderer.invoke('quick:open'),
  setQuickDraft: (hasDraft) => ipcRenderer.invoke('quick:draft', hasDraft),
  showMainWindow: () => ipcRenderer.invoke('window:showMain'),
  getShortcutStatus: () => ipcRenderer.invoke('shortcut:status'),
  checkShortcutConflict: (accelerator) => ipcRenderer.invoke('shortcut:conflict', accelerator),

  on: (channel, callback) => {
    const allowed = [
      'activity:created',
      'activity:updated',
      'activity:deleted',
      'activity:alert',
      'activity:focus',
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
