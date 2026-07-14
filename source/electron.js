const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, Notification } = require('electron');
const path = require('path');

const activityStore = require('./src/main/storage/activity-store');
const configStore = require('./src/main/storage/config-store');
const parser = require('./src/shared/activity-parser');
const scheduler = require('./src/main/scheduler');
const shortcutManager = require('./src/main/shortcut-manager');
const triggerServer = require('./src/main/trigger-server');
const hypr = require('./src/main/hypr');

const APP_ICON_PATH = path.join(__dirname, 'assets', 'icon.png');
const TRAY_ICON_PATH = path.join(__dirname, 'assets', 'tray-icon.png');

const SHOULD_OPEN_QUICK = process.argv.includes('--quick');

// Identidade da janela para o compositor. As window rules do Hyprland casam por
// esses dois valores — se mudar aqui, mude em src/main/shortcut-manager.js.
const QUICK_WINDOW_TITLE = 'Nova atividade';
app.setName('activity-manager');

let mainWindow = null;
let quickWindow = null;
let quickHasDraft = false;
let tray = null;
let isQuitting = false;

function ensureMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return mainWindow;
  }
  createMainWindow();
  return mainWindow;
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 760,
    minHeight: 520,
    icon: APP_ICON_PATH,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'));
  mainWindow.setMenu(null);

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createQuickWindow() {
  if (quickWindow && !quickWindow.isDestroyed()) {
    quickWindow.show();
    quickWindow.focus();
    return;
  }

  const { width, height } = require('electron').screen.getPrimaryDisplay().workAreaSize;

  quickWindow = new BrowserWindow({
    // O título identifica a janela para as window rules do compositor.
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

  // Sem isso o <title> do HTML sobrescreveria o título que as window rules casam.
  quickWindow.on('page-title-updated', (event) => event.preventDefault());

  // Pede o foco explicitamente: a janela nasce de um processo em segundo plano.
  quickWindow.once('ready-to-show', () => {
    quickWindow.show();
    quickWindow.focus();
  });

  quickWindow.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'), { query: { mode: 'quick' } });
  quickWindow.setMenu(null);

  // Perder o foco fecha a janela — a não ser que você já tenha digitado algo,
  // aí ela fica aberta em vez de jogar o texto fora. (Aqui é o blur real do
  // sistema; o blur do DOM dispara em trocas de foco internas e não serve.)
  quickWindow.on('blur', () => {
    if (quickHasDraft) return;
    if (quickWindow && !quickWindow.isDestroyed()) quickWindow.close();
  });

  quickWindow.on('closed', () => {
    quickWindow = null;
    quickHasDraft = false;
  });
}

let lastShortcutStatus = { registered: false, shortcut: '', error: '', environment: '' };

/**
 * Aplica o atalho definido nas configurações no ambiente gráfico. No Hyprland
 * isso reescreve o arquivo de bind gerenciado e recarrega o compositor; no X11
 * registra direto pelo Electron.
 */
/**
 * No Hyprland o autostart vem do `exec-once` que escrevemos no arquivo de bind
 * — o compositor não lê os .desktop de autostart do XDG. Registrar os dois
 * abriria duas instâncias (a segunda morre no lock, mas é lixo à toa).
 */
function syncAutostart(config) {
  if (hypr.isHyprland()) return;
  app.setLoginItemSettings({ openAtLogin: config.startOnLogin });
}

async function syncShortcut() {
  const config = configStore.getConfig();
  lastShortcutStatus = await shortcutManager.sync(config, () => createQuickWindow());
  if (!lastShortcutStatus.registered) {
    console.warn(`[atalho] não registrado (${lastShortcutStatus.environment}): ${lastShortcutStatus.error}`);
  }
  sendToMain('shortcut:status', lastShortcutStatus);
}

function sendToMain(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function showNotification(activity) {
  if (!Notification.isSupported()) return;

  const notif = new Notification({
    title: 'Lembrete de atividade',
    body: activity.text,
    icon: APP_ICON_PATH,
    urgency: 'normal',
    silent: false
  });

  notif.on('click', () => {
    ensureMainWindow();
    sendToMain('activity:focus', { id: activity.id });
  });

  notif.show();
}

function scheduleActivityNotification(activity) {
  scheduler.schedule(activity.id, activity.dueAt, () => {
    const current = activityStore.getActivity(activity.id);
    if (current && !current.completedAt) {
      showNotification(current);
      sendToMain('activity:alert', { id: current.id });
    }
  });
}

function updateTrayMenu() {
  if (!tray) return;

  const pendingCount = activityStore.getPending().length;
  const tooltip = pendingCount > 0
    ? `Activity Manager — ${pendingCount} atividade(s) pendente(s)`
    : 'Activity Manager — sem atividades pendentes';

  const template = [
    { label: 'Nova atividade', click: createQuickWindow },
    { label: 'Abrir Activity Manager', click: ensureMainWindow },
    { type: 'separator' },
    { label: 'Sair', click: () => { isQuitting = true; app.quit(); } }
  ];

  tray.setContextMenu(Menu.buildFromTemplate(template));
  tray.setToolTip(tooltip);
}

function createTray() {
  const icon = nativeImage.createFromPath(TRAY_ICON_PATH);
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.on('click', () => {
    ensureMainWindow();
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
    } else {
      ensureMainWindow();
    }
  });

  app.whenReady().then(async () => {
    syncAutostart(configStore.getConfig());

    createTray();

    // O atalho do compositor fala com o serviço por aqui — sem isso, cada
    // acionamento teria que subir um Electron novo.
    try {
      await triggerServer.start((command) => {
        if (command === 'quick') createQuickWindow();
        else ensureMainWindow();
      });
    } catch (err) {
      console.error('[gatilho] não consegui abrir a porta local:', err.message);
    }

    await syncShortcut();

    // Reagenda notificações pendentes ao iniciar.
    for (const activity of activityStore.getPending()) {
      if (activity.dueAt > Date.now()) {
        scheduleActivityNotification(activity);
      } else {
        showNotification(activity);
      }
    }

    // Abre a janela principal no primeiro lançamento (não ao reiniciar por login item),
    // ou abre a janela rápida quando chamado via --quick.
    if (SHOULD_OPEN_QUICK) {
      createQuickWindow();
    } else if (!process.argv.includes('--hidden')) {
      createMainWindow();
    }

    app.on('activate', () => {
      ensureMainWindow();
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
    // Mantém vivo na bandeja.
  });
}

// ---------- IPC ----------

function buildState() {
  return {
    activities: activityStore.getAll(),
    config: configStore.getConfig()
  };
}

ipcMain.handle('app:state', () => buildState());

ipcMain.handle('activity:create', (_event, rawText) => {
  const parsed = parser.parse(rawText, configStore.getConfig().defaultReminderMinutes);
  const activity = activityStore.saveActivity({
    text: parsed.text,
    tags: parsed.tags,
    reminderMinutes: parsed.reminderMinutes,
    dueAt: parsed.dueAt,
    createdAt: Date.now()
  });
  scheduleActivityNotification(activity);
  updateTrayMenu();
  sendToMain('activity:created', activity);
  return activity;
});

ipcMain.handle('activity:update', (_event, { id, text }) => {
  const current = activityStore.getActivity(id);
  if (!current) return null;

  const parsed = parser.parse(text, configStore.getConfig().defaultReminderMinutes);
  if (!parsed.text) return current;

  const patch = { id, text: parsed.text, tags: parsed.tags };
  // Só mexe no alerta se o usuário digitou !N na edição.
  if (parsed.explicitReminder) {
    patch.reminderMinutes = parsed.reminderMinutes;
    patch.dueAt = parsed.dueAt;
  }

  const updated = activityStore.saveActivity(patch);
  if (!updated.completedAt && parsed.explicitReminder) {
    scheduleActivityNotification(updated);
  }
  sendToMain('activity:updated', updated);
  return updated;
});

ipcMain.handle('activity:snooze', (_event, { id, minutes }) => {
  const current = activityStore.getActivity(id);
  if (!current || current.completedAt) return null;

  const mins = Math.max(1, parseInt(minutes, 10) || current.reminderMinutes || 15);
  const updated = activityStore.saveActivity({ id, dueAt: Date.now() + mins * 60 * 1000 });
  scheduleActivityNotification(updated);
  sendToMain('activity:updated', updated);
  return updated;
});

ipcMain.handle('activity:reopen', (_event, id) => {
  const current = activityStore.getActivity(id);
  if (!current || !current.completedAt) return null;

  const mins = current.reminderMinutes || 15;
  const updated = activityStore.saveActivity({
    id,
    completedAt: null,
    dueAt: Date.now() + mins * 60 * 1000
  });
  scheduleActivityNotification(updated);
  updateTrayMenu();
  sendToMain('activity:updated', updated);
  return updated;
});

ipcMain.handle('activity:complete', (_event, id) => {
  const updated = activityStore.completeActivity(id);
  if (updated) {
    scheduler.cancel(id);
    updateTrayMenu();
    sendToMain('activity:updated', updated);
  }
  return updated;
});

ipcMain.handle('activity:delete', (_event, id) => {
  activityStore.deleteActivity(id);
  scheduler.cancel(id);
  updateTrayMenu();
  sendToMain('activity:deleted', { id });
  return true;
});

ipcMain.handle('config:save', async (_event, patch) => {
  const saved = configStore.saveConfig(patch);
  syncAutostart(saved);
  await syncShortcut();
  sendToMain('config:updated', saved);
  return saved;
});

ipcMain.handle('backup:export', async () => {
  const { filePath } = await dialog.showSaveDialog({
    defaultPath: `activity-manager-backup-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (!filePath) return null;
  const exported = activityStore.exportAll();
  require('fs').writeFileSync(filePath, JSON.stringify(exported, null, 2), 'utf-8');
  return filePath;
});

ipcMain.handle('backup:import', async () => {
  const { filePaths, canceled } = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (canceled || filePaths.length === 0) return null;
  const content = require('fs').readFileSync(filePaths[0], 'utf-8');
  const imported = JSON.parse(content);
  const result = activityStore.importAll(imported);

  // Reagenda tudo.
  scheduler.cancelAll();
  for (const activity of activityStore.getPending()) {
    if (activity.dueAt > Date.now()) {
      scheduleActivityNotification(activity);
    }
  }
  updateTrayMenu();
  sendToMain('state:reload', buildState());
  return result;
});

ipcMain.handle('quick:close', () => {
  if (quickWindow && !quickWindow.isDestroyed()) {
    quickWindow.close();
  }
  return true;
});

ipcMain.handle('window:showMain', () => {
  ensureMainWindow();
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

// Deixa o usuário conferir a janela rápida sem precisar acertar o atalho.
ipcMain.handle('quick:open', () => {
  createQuickWindow();
  return true;
});

ipcMain.handle('quick:draft', (_event, hasDraft) => {
  quickHasDraft = Boolean(hasDraft);
  return true;
});
