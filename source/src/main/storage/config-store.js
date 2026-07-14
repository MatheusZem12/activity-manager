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
  startOnLogin: true
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
  config.startOnLogin = !!config.startOnLogin;
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
