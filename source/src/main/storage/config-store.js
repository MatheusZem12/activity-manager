const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const CONFIG_FILE = 'config.json';

const DEFAULT_CONFIG = {
  version: 1,
  defaultReminderMinutes: 15,
  maxTextLength: 120,
  // Ctrl+Alt+A: os atalhos do Omarchy são quase todos SUPER, então esta faixa
  // costuma estar livre. O usuário pode trocar nas configurações.
  globalShortcut: 'Ctrl+Alt+A',
  // Captura de texto do clipboard. Fica na mesma faixa Ctrl+Alt do atalho de
  // atividade, para os dois recursos do app não brigarem com o Omarchy.
  globalShortcutClip: 'Ctrl+Alt+C',
  // Abre/foca o painel lateral (a "telinha" com a lista de atividades).
  globalShortcutPanel: 'Ctrl+Alt+P',
  maxTitleLength: 120, // título de um texto do clipboard (o conteúdo é livre)
  panelSide: 'right', // 'right' | 'left' — borda onde o painel encosta
  startOnLogin: true,
  soundEnabled: true,
  // Volume do chime de alerta, independente do volume do sistema (0-100).
  soundVolume: 60
};

function configPath() {
  return path.join(app.getPath('userData'), CONFIG_FILE);
}

function loadConfig() {
  try {
    const data = JSON.parse(fs.readFileSync(configPath(), 'utf-8'));
    return { ...DEFAULT_CONFIG, ...data };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(patch) {
  const config = { ...loadConfig(), ...patch };
  config.defaultReminderMinutes = Math.max(1, parseInt(config.defaultReminderMinutes, 10) || 15);
  config.maxTextLength = Math.max(10, parseInt(config.maxTextLength, 10) || 120);
  config.globalShortcut =
    (config.globalShortcut || DEFAULT_CONFIG.globalShortcut).trim() || DEFAULT_CONFIG.globalShortcut;
  config.globalShortcutClip =
    (config.globalShortcutClip || DEFAULT_CONFIG.globalShortcutClip).trim() || DEFAULT_CONFIG.globalShortcutClip;
  config.globalShortcutPanel =
    (config.globalShortcutPanel || DEFAULT_CONFIG.globalShortcutPanel).trim() || DEFAULT_CONFIG.globalShortcutPanel;
  config.maxTitleLength = Math.max(10, parseInt(config.maxTitleLength, 10) || 120);
  config.panelSide = config.panelSide === 'left' ? 'left' : 'right';
  config.startOnLogin = !!config.startOnLogin;
  config.soundEnabled = !!config.soundEnabled;
  const parsedVolume = parseInt(config.soundVolume, 10);
  config.soundVolume = Number.isNaN(parsedVolume)
    ? DEFAULT_CONFIG.soundVolume
    : Math.max(0, Math.min(100, parsedVolume));
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), 'utf-8');
  return config;
}

function getConfig() {
  return loadConfig();
}

module.exports = {
  getConfig,
  saveConfig,
  DEFAULT_CONFIG
};
