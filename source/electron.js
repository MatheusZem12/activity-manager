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
const rastro = require('./src/main/rastro/ipc');
const {
  WM_CLASS, QUICK_WINDOW_TITLE, CLIP_WINDOW_TITLE, PANEL_WINDOW_TITLE
} = require('./src/main/window-identity');

const APP_ICON_PATH = path.join(__dirname, 'assets', 'icon.png');
const TRAY_ICON_PATH = path.join(__dirname, 'assets', 'tray-icon.png');

const SHOULD_OPEN_QUICK = process.argv.includes('--quick');
const SHOULD_OPEN_CLIP = process.argv.includes('--clip');

// A classe da janela para o compositor. As window rules do Hyprland casam por
// classe + título (veja src/main/window-identity.js).
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
 * A janela do app. Uma janela normal, e nada além disso.
 *
 * Foi um painel encostado na borda, sempre por cima, sem moldura e com posição
 * imposta ao compositor. Custava caro: window rules que falham em silêncio, um
 * dispatch para mover o que já estava na tela, e uma faixa cobrindo a borda do
 * editor. Tudo isso para economizar um alt-tab.
 *
 * Como janela comum, o Hyprland cuida de posição, tamanho, foco e workspace —
 * que é o que ele faz melhor que qualquer regra que a gente escrevesse. E a
 * largura maior é o que permite dois painéis lado a lado e gráficos de verdade
 * na aba Rastro.
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

  // Sem isso o <title> do HTML sobrescreveria o título que as window rules casam.
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

  // Fecha "para a bandeja" em vez de destruir — mesma ideia da antiga janela
  // principal. O painel continua vivo e reabre na hora na próxima chamada.
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

/**
 * Janela rápida de captura de texto do clipboard. Mesma mecânica da janela de
 * atividade (float centralizado, foco explícito, fecha no blur sem rascunho),
 * só que mais alta: aqui cabe um título e um bloco de conteúdo.
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
  lastShortcutStatus = await shortcutManager.sync(config, {
    onQuick: () => createQuickWindow(),
    onClip: () => createClipWindow(),
    onPanel: () => ensurePanelWindow()
  });
  if (!lastShortcutStatus.registered) {
    console.warn(`[atalho] não registrado (${lastShortcutStatus.environment}): ${lastShortcutStatus.error}`);
  }
  sendToPanel('shortcut:status', lastShortcutStatus);
}

function sendToPanel(channel, payload) {
  if (panelWindow && !panelWindow.isDestroyed()) {
    panelWindow.webContents.send(channel, payload);
  }
}

/**
 * Avisa as janelas abertas que a lista de textos mudou, para re-renderizarem em
 * sincronia quando outra janela salva/copia.
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
    title: 'Lembrete de atividade',
    body: activity.text,
    icon: APP_ICON_PATH,
    urgency: 'normal',
    // O som é nosso (src/main/sound.js). Deixar o daemon tocar o dele também
    // renderia dois bipes nos ambientes onde ele de fato toca algo.
    silent: true
  });

  notif.on('click', () => {
    ensurePanelWindow();
    sendToPanel('activity:focus', { id: activity.id });
  });

  notif.show();
}

/**
 * Dispara o alerta de uma atividade e já reagenda o próximo, no mesmo
 * intervalo (`reminderMinutes`) — o alerta repete sozinho até a atividade ser
 * concluída, em vez de avisar uma vez só.
 */
async function fireActivityAlert(activity) {
  showNotification(activity);
  sendToPanel('activity:alert', { id: activity.id });

  // O alerta repete no mesmo intervalo até a atividade ser concluída: quem
  // reagenda é o próprio disparo.
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
    ? `Activity Manager — ${pendingCount} atividade(s) pendente(s), ${entryCount} texto(s)`
    : `Activity Manager — sem atividades pendentes, ${entryCount} texto(s)`;

  const template = [
    { label: 'Nova atividade', click: createQuickWindow },
    { label: 'Novo texto', click: createClipWindow },
    { label: 'Abrir Activity Manager', click: ensurePanelWindow },
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

    // O coletor sobe junto com o app e não depende de o painel estar aberto —
    // ele registra o dia todo, com a janela fechada. Se falhar (fora do
    // Hyprland, por exemplo), o resto do app continua funcionando.
    rastro.registrar({
      aoMudar: () => { if (panelWindow) panelWindow.webContents.send('state:reload'); },
      aoEntrarNaConta: () => carregarDoServidor()
    });
    rastro.iniciar();

    // Atividades e textos vivem no banco. Sem sessão o app sobe do mesmo jeito
    // — a bandeja, o coletor e as janelas rápidas funcionam — mas as duas listas
    // ficam vazias até você entrar em Rastro → Conta.
    await carregarDoServidor();

    // O atalho do compositor fala com o serviço por aqui — sem isso, cada
    // acionamento teria que subir um Electron novo.
    try {
      await triggerServer.start((command) => {
        if (command === 'quick') createQuickWindow();
        else if (command === 'clip') createClipWindow();
        else ensurePanelWindow();
      });
    } catch (err) {
      console.error('[gatilho] não consegui abrir a porta local:', err.message);
    }

    await syncShortcut();

    // Reagenda notificações pendentes ao iniciar. As atrasadas disparam (e já
    // entram no ciclo de repetição) em vez de avisar só uma vez.
    for (const activity of activityStore.getPending()) {
      if (activity.dueAt > Date.now()) {
        scheduleActivityNotification(activity);
      } else {
        fireActivityAlert(activity);
      }
    }

    // Abre o painel no primeiro lançamento (não ao reiniciar por login item),
    // ou a janela de captura pedida na linha de comando.
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
    // Fecha o segmento aberto: sem isto, a última janela do dia — que costuma
    // ser a mais longa — não entraria no arquivo.
    rastro.parar();
  });

  app.on('window-all-closed', () => {
    // Mantém vivo na bandeja.
  });
}

/**
 * Puxa atividades e textos do servidor para o espelho em memória.
 *
 * Na primeira vez com sessão, migra os JSON que o app usava antes — uma vez só,
 * e o servidor recusa duplicata, então rodar de novo é inofensivo. Sem isto, a
 * mudança para o banco custaria o histórico de quem já usava o app.
 */
async function carregarDoServidor() {
  const apiClient = require('./src/main/storage/api-client');
  if (!apiClient.configurado()) return;
  try {
    await migrarArquivosAntigos();
    await activityStore.carregar();
    await entryStore.carregar();
    scheduler.cancelAll();
    for (const activity of activityStore.getPending()) {
      if (activity.dueAt && activity.dueAt > Date.now()) scheduleActivityNotification(activity);
    }
    updateTrayMenu();
    sendToPanel('state:reload', buildState());
  } catch (e) {
    console.error('[dados] não consegui carregar do servidor:', e.message);
  }
}

/**
 * Move `activities.json` e `entries.json` para o banco e marca como migrados.
 *
 * A marca é **por servidor**, e isso não é preciosismo: a primeira versão
 * gravava uma marca global, escrita quando o app ainda apontava para o banco de
 * desenvolvimento. Ao trocar para a VPS, a migração não rodava — os dados
 * continuavam nos arquivos, e a tela mostrava "Pendentes (0)" como se tivessem
 * sumido. Cada banco precisa da sua própria migração.
 */
async function migrarArquivosAntigos() {
  const fs = require('fs');
  const servidor = require('./src/main/rastro/servidor');
  const apelido = servidor.endereco().replace(/^https?:\/\//, '').replace(/[^\w.-]/g, '_');
  const marca = path.join(app.getPath('userData'), `migrado-para-${apelido}.json`);
  if (fs.existsSync(marca)) return;

  const ler = (nome) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), nome), 'utf-8'));
    } catch {
      return null;
    }
  };

  const resultado = {};
  const atividades = ler('activities.json');
  if (atividades && Array.isArray(atividades.activities) && atividades.activities.length) {
    resultado.atividades = (await activityStore.importAll(atividades)).count;
  }
  const textos = ler('entries.json');
  if (textos && Array.isArray(textos.entries) && textos.entries.length) {
    resultado.textos = (await entryStore.importAll(textos)).count;
  }

  // Os arquivos NÃO são apagados: se algo der errado na primeira semana, o
  // original ainda está lá. A marca é o que impede reimportar toda subida.
  fs.writeFileSync(marca, JSON.stringify({
    servidor: servidor.endereco(),
    em: new Date().toISOString(),
    ...resultado
  }, null, 2));
  console.log(`[dados] migrado para ${servidor.endereco()}:`, JSON.stringify(resultado));
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
  // O parsing de `#tag` e `!30` fica aqui, não no servidor: o preview ao vivo
  // enquanto se digita exige que aconteça na máquina.
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
  // Só mexe no alerta se o usuário digitou !N na edição.
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
  // Adiar mexe só no vencimento; o intervalo do `!N` continua o mesmo.
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

// ---------- IPC: textos do clipboard ----------

ipcMain.handle('entries:list', () => entryStore.getAll());

ipcMain.handle('entries:create', async (_event, { title, content }) => {
  const text = typeof content === 'string' ? content : '';
  if (!text.trim()) return null; // conteúdo é obrigatório
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
  if (!text.trim()) return current; // não deixa esvaziar o conteúdo
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
  // O clipboard é do sistema: copiar acontece aqui, e o servidor só registra
  // que aconteceu — é o que alimenta a ordenação por "Copiados".
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

// ---------- IPC: configuração e backup ----------

ipcMain.handle('config:save', async (_event, patch) => {
  const saved = configStore.saveConfig(patch);
  syncAutostart(saved);
  await syncShortcut();
  // O Hyprland reposiciona via window rule no reload acima; em outros
  // ambientes (ou enquanto o reload não terminou), aplica na hora também.
  if (panelWindow && !panelWindow.isDestroyed()) {
    panelWindow.setBounds(panelBounds());
  }
  sendToPanel('config:updated', saved);
  return saved;
});

/**
 * Um único arquivo de backup cobre os dois recursos do app: as atividades e os
 * textos do clipboard. O formato antigo (só atividades, sem a chave `entries`)
 * continua sendo aceito na importação — nesse caso os textos ficam intactos.
 */
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

// O botão × no cabeçalho do painel: mesma ideia do close() nativo — some para
// a bandeja em vez de destruir a janela.
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

// Deixa o usuário conferir a janela rápida sem precisar acertar o atalho.
ipcMain.handle('quick:open', () => {
  createQuickWindow();
  return true;
});

// Mesma ideia para o som: dá para ouvir o chime sem esperar um alerta chegar.
// Aceita um volume explícito para o usuário ouvir o slider antes de salvar.
ipcMain.handle('sound:test', (_event, volume) => {
  const v = typeof volume === 'number' ? volume : configStore.getConfig().soundVolume;
  sound.play(v);
  return true;
});

ipcMain.handle('quick:draft', (_event, hasDraft) => {
  quickHasDraft = Boolean(hasDraft);
  return true;
});
