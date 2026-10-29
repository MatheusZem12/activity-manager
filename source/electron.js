const {
  app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, Notification, screen, clipboard
} = require('electron');
const path = require('path');

const activityStore = require('./src/main/storage/activity-store');
const entryStore = require('./src/main/storage/entry-store');
const configStore = require('./src/main/storage/config-store');
const parser = require('./src/shared/activity-parser');
const entryParser = require('./src/shared/entry-parser');
const scheduler = require('./src/main/scheduler');
const shortcutManager = require('./src/main/shortcut-manager');
const triggerServer = require('./src/main/trigger-server');
const hypr = require('./src/main/hypr');
const sound = require('./src/main/sound');
const {
  WM_CLASS, QUICK_WINDOW_TITLE, CLIP_WINDOW_TITLE, PANEL_WINDOW_TITLE
} = require('./src/main/window-identity');

const APP_ICON_PATH = path.join(__dirname, 'assets', 'icon.png');
const TRAY_ICON_PATH = path.join(__dirname, 'assets', 'tray-icon.png');

const SHOULD_OPEN_QUICK = process.argv.includes('--quick');
const SHOULD_OPEN_CLIP = process.argv.includes('--clip');

// The window class for the compositor. Hyprland window rules match by
// class + title (see src/main/window-identity.js).
app.setName(WM_CLASS);

let panelWindow = null;
let quickWindow = null;
let clipWindow = null;
let quickHasDraft = false;
let clipHasDraft = false;
let tray = null;
let isQuitting = false;

function ensurePanelWindow() {
  if (panelWindow && !panelWindow.isDestroyed()) {
    panelWindow.show();
    panelWindow.focus();
    return panelWindow;
  }
  createPanelWindow();
  return panelWindow;
}

/**
 * The app window. A normal window, and nothing more.
 *
 * It used to be a panel against the edge, always on top, frameless and with a
 * position forced on the compositor. It cost a lot: window rules failing silently,
 * a dispatch to move what was already on screen, and a strip covering the edge
 * of the editor. All that to save one alt-tab.
 *
 * As a regular window, Hyprland handles position, size, focus and workspace —
 * which it does better than any rule we could write.
 */
function createPanelWindow() {
  panelWindow = new BrowserWindow({
    title: PANEL_WINDOW_TITLE,
    width: 1100,
    height: 720,
    minWidth: 720,
    minHeight: 480,
    resizable: true,
    minimizable: true,
    maximizable: true,
    icon: APP_ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Without this the HTML <title> would overwrite the title the window rules match.
  panelWindow.on('page-title-updated', (event) => event.preventDefault());

  panelWindow.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'), { query: { mode: 'panel' } });
  panelWindow.setMenu(null);

  if (process.argv.includes('--dev')) {
    panelWindow.webContents.openDevTools();
  }

  panelWindow.once('ready-to-show', () => {
    panelWindow.show();
    panelWindow.focus();
  });

  // Closes "to the tray" instead of destroying — the same idea as the old main
  // window. The panel stays alive and reopens at once on the next call.
  panelWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      panelWindow.hide();
    }
  });

  panelWindow.on('closed', () => {
    panelWindow = null;
  });
}

function createQuickWindow() {
  if (quickWindow && !quickWindow.isDestroyed()) {
    quickWindow.show();
    quickWindow.focus();
    return;
  }

  const { width } = screen.getPrimaryDisplay().workAreaSize;

  quickWindow = new BrowserWindow({
    // The title identifies the window for the compositor's window rules.
    title: QUICK_WINDOW_TITLE,
    width: 520,
    height: 250,
    x: Math.round((width - 520) / 2),
    y: 80,
    resizable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    frame: false,
    transparent: false,
    icon: APP_ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Without this the HTML <title> would overwrite the title the window rules match.
  quickWindow.on('page-title-updated', (event) => event.preventDefault());

  // Asks for focus explicitly: the window is born from a background process.
  quickWindow.once('ready-to-show', () => {
    quickWindow.show();
    quickWindow.focus();
  });

  quickWindow.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'), { query: { mode: 'quick' } });
  quickWindow.setMenu(null);

  // Losing focus closes the window — unless you have already typed something,
  // then it stays open instead of throwing the text away. (This is the real
  // system blur; the DOM blur fires on internal focus changes and won't do.)
  quickWindow.on('blur', () => {
    if (quickHasDraft) return;
    if (quickWindow && !quickWindow.isDestroyed()) quickWindow.close();
  });

  quickWindow.on('closed', () => {
    quickWindow = null;
    quickHasDraft = false;
  });
}

/**
 * Quick window to capture clipboard text. The same mechanics as the activity
 * window (centered float, explicit focus, closes on blur without a draft),
 * only taller: a title and a content block fit here.
 */
function createClipWindow() {
  if (clipWindow && !clipWindow.isDestroyed()) {
    clipWindow.show();
    clipWindow.focus();
    return;
  }

  const { width } = screen.getPrimaryDisplay().workAreaSize;
  const winWidth = 560;

  clipWindow = new BrowserWindow({
    title: CLIP_WINDOW_TITLE,
    width: winWidth,
    height: 340,
    x: Math.round((width - winWidth) / 2),
    y: 80,
    resizable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    frame: false,
    transparent: false,
    icon: APP_ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  clipWindow.on('page-title-updated', (event) => event.preventDefault());

  clipWindow.once('ready-to-show', () => {
    clipWindow.show();
    clipWindow.focus();
  });

  clipWindow.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'), { query: { mode: 'clip' } });
  clipWindow.setMenu(null);

  clipWindow.on('blur', () => {
    if (clipHasDraft) return;
    if (clipWindow && !clipWindow.isDestroyed()) clipWindow.close();
  });

  clipWindow.on('closed', () => {
    clipWindow = null;
    clipHasDraft = false;
  });
}

let lastShortcutStatus = {
  registered: false,
  shortcut: '',
  shortcutClip: '',
  shortcutPanel: '',
  error: '',
  environment: ''
};

/**
 * On Hyprland autostart comes from the `exec-once` we write in the bind file
 * — the compositor doesn't read XDG autostart .desktop files. Registering both
 * would open two instances (the second dies on the lock, but it is pointless noise).
 */
function syncAutostart(config) {
  if (hypr.isHyprland()) return;
  app.setLoginItemSettings({ openAtLogin: config.startOnLogin });
}

async function syncShortcut() {
  const config = configStore.getConfig();
  lastShortcutStatus = await shortcutManager.sync(config, {
    onQuick: () => createQuickWindow(),
    onClip: () => createClipWindow(),
    onPanel: () => ensurePanelWindow()
  });
  if (!lastShortcutStatus.registered) {
    console.warn(`[shortcut] not registered (${lastShortcutStatus.environment}): ${lastShortcutStatus.error}`);
  }
  sendToPanel('shortcut:status', lastShortcutStatus);
}

function sendToPanel(channel, payload) {
  if (panelWindow && !panelWindow.isDestroyed()) {
    panelWindow.webContents.send(channel, payload);
  }
}

/**
 * Tells the open windows that the text list changed, so they re-render in
 * sync when another window saves/copies.
 */
function broadcastEntries() {
  const entries = entryStore.getAll();
  for (const w of [panelWindow, clipWindow]) {
    if (w && !w.isDestroyed()) w.webContents.send('entries:changed', entries);
  }
}

function showNotification(activity) {
  const config = configStore.getConfig();
  if (config.soundEnabled) {
    sound.play(config.soundVolume);
  }

  if (!Notification.isSupported()) return;

  const notif = new Notification({
    title: 'Activity reminder',
    body: activity.text,
    icon: APP_ICON_PATH,
    urgency: 'normal',
    // The sound is ours (src/main/sound.js). Letting the daemon play its own too
    // would mean two beeps where it actually plays something.
    silent: true
  });

  notif.on('click', () => {
    ensurePanelWindow();
    sendToPanel('activity:focus', { id: activity.id });
  });

  notif.show();
}

/**
 * Fires an activity's alert and reschedules the next one right away, at the
 * same interval (`reminderMinutes`) — the alert repeats on its own until the
 * activity is done, instead of warning only once.
 */
async function fireActivityAlert(activity) {
  showNotification(activity);
  sendToPanel('activity:alert', { id: activity.id });

  // The alert repeats at the same interval until the activity is done: the
  // firing itself reschedules it.
  const intervalMinutes = Math.max(1, activity.reminderMinutes || 15);
  const rescheduled = await activityStore.saveActivity({
    id: activity.id,
    dueAt: Date.now() + intervalMinutes * 60 * 1000
  });
  sendToPanel('activity:updated', rescheduled);
  scheduleActivityNotification(rescheduled);
}

function scheduleActivityNotification(activity) {
  scheduler.schedule(activity.id, activity.dueAt, () => {
    const current = activityStore.getActivity(activity.id);
    if (current && !current.completedAt) fireActivityAlert(current);
  });
}

function updateTrayMenu() {
  if (!tray) return;

  const pendingCount = activityStore.getPending().length;
  const entryCount = entryStore.getAll().length;
  const tooltip = pendingCount > 0
    ? `Activity Manager — ${pendingCount} pending activity(ies), ${entryCount} text(s)`
    : `Activity Manager — no pending activities, ${entryCount} text(s)`;

  const template = [
    { label: 'New activity', click: createQuickWindow },
    { label: 'New text', click: createClipWindow },
    { label: 'Open Activity Manager', click: ensurePanelWindow },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } }
  ];

  tray.setContextMenu(Menu.buildFromTemplate(template));
  tray.setToolTip(tooltip);
}

function createTray() {
  const icon = nativeImage.createFromPath(TRAY_ICON_PATH);
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.on('click', () => {
    ensurePanelWindow();
  });
  updateTrayMenu();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    if (argv && argv.includes('--quick')) {
      createQuickWindow();
    } else if (argv && argv.includes('--clip')) {
      createClipWindow();
    } else {
      ensurePanelWindow();
    }
  });

  app.whenReady().then(async () => {
    syncAutostart(configStore.getConfig());

    createTray();

    // The compositor shortcut talks to the service through here — without it, every
    // trigger would have to start a new Electron.
    try {
      await triggerServer.start((command) => {
        if (command === 'quick') createQuickWindow();
        else if (command === 'clip') createClipWindow();
        else ensurePanelWindow();
      });
    } catch (err) {
      console.error('[trigger] couldn\'t open the local port:', err.message);
    }

    await syncShortcut();

    // Reschedules pending notifications on startup. Overdue ones fire (and join
    // the repeat cycle right away) instead of warning only once.
    for (const activity of activityStore.getPending()) {
      if (activity.dueAt > Date.now()) {
        scheduleActivityNotification(activity);
      } else {
        fireActivityAlert(activity);
      }
    }

    // Opens the panel on the first launch (not on a login-item restart),
    // or the capture window asked for on the command line.
    if (SHOULD_OPEN_QUICK) {
      createQuickWindow();
    } else if (SHOULD_OPEN_CLIP) {
      createClipWindow();
    } else if (!process.argv.includes('--hidden')) {
      createPanelWindow();
    }

    app.on('activate', () => {
      ensurePanelWindow();
    });
  });

  app.on('before-quit', () => {
    isQuitting = true;
  });

  app.on('will-quit', () => {
    shortcutManager.unregisterAll();
    triggerServer.stop();
  });

  app.on('window-all-closed', () => {
    // Keeps it alive in the tray.
  });
}

// ---------- IPC ----------

function buildState() {
  return {
    activities: activityStore.getAll(),
    entries: entryStore.getAll(),
    config: configStore.getConfig()
  };
}

ipcMain.handle('app:state', () => buildState());

ipcMain.handle('activity:create', async (_event, rawText) => {
  const parsed = parser.parse(rawText, configStore.getConfig().defaultReminderMinutes);
  const activity = await activityStore.saveActivity({
    text: parsed.text,
    tags: parsed.tags,
    reminderMinutes: parsed.reminderMinutes,
    dueAt: parsed.dueAt,
    createdAt: Date.now()
  });
  scheduleActivityNotification(activity);
  updateTrayMenu();
  sendToPanel('activity:created', activity);
  return activity;
});

ipcMain.handle('activity:update', async (_event, { id, text }) => {
  const current = activityStore.getActivity(id);
  if (!current) return null;

  const parsed = parser.parse(text, configStore.getConfig().defaultReminderMinutes);
  if (!parsed.text) return current;

  const patch = { id, text: parsed.text, tags: parsed.tags };
  // Only touches the alert if the user typed !N while editing.
  if (parsed.explicitReminder) {
    patch.reminderMinutes = parsed.reminderMinutes;
    patch.dueAt = parsed.dueAt;
  }

  const updated = await activityStore.saveActivity(patch);
  if (!updated.completedAt && parsed.explicitReminder) {
    scheduleActivityNotification(updated);
  }
  sendToPanel('activity:updated', updated);
  return updated;
});

ipcMain.handle('activity:snooze', async (_event, { id, minutes }) => {
  const current = activityStore.getActivity(id);
  if (!current || current.completedAt) return null;

  const mins = Math.max(1, parseInt(minutes, 10) || current.reminderMinutes || 15);
  // Snoozing only moves the due time; the `!N` interval stays the same.
  const updated = await activityStore.snoozeActivity(id, mins);
  scheduleActivityNotification(updated);
  sendToPanel('activity:updated', updated);
  return updated;
});

ipcMain.handle('activity:reopen', async (_event, id) => {
  const current = activityStore.getActivity(id);
  if (!current || !current.completedAt) return null;

  const updated = await activityStore.reopenActivity(id);
  scheduleActivityNotification(updated);
  updateTrayMenu();
  sendToPanel('activity:updated', updated);
  return updated;
});

ipcMain.handle('activity:complete', async (_event, id) => {
  const updated = await activityStore.completeActivity(id);
  if (updated) {
    scheduler.cancel(id);
    updateTrayMenu();
    sendToPanel('activity:updated', updated);
  }
  return updated;
});

ipcMain.handle('activity:delete', async (_event, id) => {
  await activityStore.deleteActivity(id);
  scheduler.cancel(id);
  updateTrayMenu();
  sendToPanel('activity:deleted', { id });
  return true;
});

// ---------- IPC: clipboard texts ----------

ipcMain.handle('entries:list', () => entryStore.getAll());

ipcMain.handle('entries:create', async (_event, { title, content }) => {
  const text = typeof content === 'string' ? content : '';
  if (!text.trim()) return null; // content is required
  const parsed = entryParser.parseTitle(title || '');
  const entry = await entryStore.saveEntry({
    title: parsed.title,
    tags: parsed.tags,
    content: text
  });
  updateTrayMenu();
  broadcastEntries();
  return entry;
});

ipcMain.handle('entries:update', async (_event, { id, title, content }) => {
  const current = entryStore.getEntry(id);
  if (!current) return null;
  const text = typeof content === 'string' ? content : '';
  if (!text.trim()) return current; // doesn't let the content be emptied
  const parsed = entryParser.parseTitle(title || '');
  const updated = await entryStore.saveEntry({
    id,
    title: parsed.title,
    tags: parsed.tags,
    content: text
  });
  broadcastEntries();
  return updated;
});

ipcMain.handle('entries:delete', async (_event, id) => {
  await entryStore.deleteEntry(id);
  updateTrayMenu();
  broadcastEntries();
  return true;
});

ipcMain.handle('entries:copy', async (_event, id) => {
  const entry = entryStore.getEntry(id);
  if (!entry) return null;
  // Counts the copies: it feeds the "Most copied" sort.
  clipboard.writeText(entry.content);
  const updated = await entryStore.markCopied(id);
  broadcastEntries();
  return updated;
});

ipcMain.handle('clip:close', () => {
  if (clipWindow && !clipWindow.isDestroyed()) clipWindow.close();
  return true;
});

ipcMain.handle('clip:open', () => {
  createClipWindow();
  return true;
});

ipcMain.handle('clip:draft', (_event, hasDraft) => {
  clipHasDraft = Boolean(hasDraft);
  return true;
});

// ---------- IPC: settings and backup ----------

ipcMain.handle('config:save', async (_event, patch) => {
  const saved = configStore.saveConfig(patch);
  syncAutostart(saved);
  await syncShortcut();
  sendToPanel('config:updated', saved);
  return saved;
});

ipcMain.handle('quick:close', () => {
  if (quickWindow && !quickWindow.isDestroyed()) {
    quickWindow.close();
  }
  return true;
});

ipcMain.handle('window:showPanel', () => {
  ensurePanelWindow();
  return true;
});

// The × button in the panel header: the same idea as the native close() — it
// goes to the tray instead of destroying the window.
ipcMain.handle('panel:close', () => {
  if (panelWindow && !panelWindow.isDestroyed()) {
    panelWindow.close();
  }
  return true;
});

ipcMain.handle('shortcut:status', () => lastShortcutStatus);

ipcMain.handle('shortcut:conflict', async (_event, accelerator) => {
  try {
    return await shortcutManager.checkConflict(accelerator);
  } catch {
    return null;
  }
});

// Lets the user check the quick window without having to hit the shortcut.
ipcMain.handle('quick:open', () => {
  createQuickWindow();
  return true;
});

// Same idea for the sound: you can hear the chime without waiting for an alert.
// Takes an explicit volume so the user can hear the slider before saving.
ipcMain.handle('sound:test', (_event, volume) => {
  const v = typeof volume === 'number' ? volume : configStore.getConfig().soundVolume;
  sound.play(v);
  return true;
});

ipcMain.handle('quick:draft', (_event, hasDraft) => {
  quickHasDraft = Boolean(hasDraft);
  return true;
});
