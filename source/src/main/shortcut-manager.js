/**
 * Registro do atalho global — feito pelo próprio serviço.
 *
 * O atalho é definido na tela de Configurações do app; daqui ele é aplicado no
 * ambiente gráfico. O usuário nunca precisa editar config de compositor.
 *
 *   Hyprland/Wayland: escrevemos um arquivo de config gerenciado por nós
 *     (~/.config/hypr/activity-manager.conf), garantimos um `source =` para ele
 *     no hyprland.conf e pedimos `hyprctl reload`. O bind chama bin/am-trigger.sh,
 *     que acorda o serviço que já está rodando.
 *
 *   X11: o Electron consegue registrar o atalho sozinho (globalShortcut).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { globalShortcut } = require('electron');

const hypr = require('./hypr');

const MANAGED_FILE = path.join(os.homedir(), '.config', 'hypr', 'activity-manager.conf');
const HYPRLAND_CONF = path.join(os.homedir(), '.config', 'hypr', 'hyprland.conf');
const SOURCE_LINE = 'source = ~/.config/hypr/activity-manager.conf';

// Precisam bater com o que o Electron reporta ao compositor (veja electron.js).
const WM_CLASS = 'activity-manager';
const QUICK_WINDOW_TITLE = 'Nova atividade';
const QUICK_MATCH = `match:class ^(${WM_CLASS})$, match:title ^(${QUICK_WINDOW_TITLE})$`;

const TRIGGER_SCRIPT = path.join(__dirname, '..', '..', 'bin', 'am-trigger.sh');
const ELECTRON_BIN = path.join(__dirname, '..', '..', 'node_modules', 'electron', 'dist', 'electron');
const SOURCE_DIR = path.join(__dirname, '..', '..');

// Teclas cujo nome no Hyprland (keysym do xkb) difere do nome no Electron.
const KEY_TO_HYPR = {
  Up: 'up',
  Down: 'down',
  Left: 'left',
  Right: 'right',
  Space: 'space',
  Enter: 'return',
  Return: 'return',
  Tab: 'tab',
  Backspace: 'backspace',
  Delete: 'delete',
  Insert: 'insert',
  Home: 'home',
  End: 'end',
  PageUp: 'prior',
  PageDown: 'next',
  Escape: 'escape'
};

const MODIFIER_TO_HYPR = {
  Ctrl: 'CTRL',
  Control: 'CTRL',
  Alt: 'ALT',
  Shift: 'SHIFT',
  Super: 'SUPER',
  Meta: 'SUPER',
  Cmd: 'SUPER',
  CommandOrControl: 'CTRL',
  CmdOrCtrl: 'CTRL'
};

/**
 * "Ctrl+Alt+A" -> { modifiers: ['CTRL', 'ALT'], key: 'a' }
 */
function parseAccelerator(accelerator) {
  const parts = String(accelerator || '')
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length === 0) return null;

  const modifiers = [];
  let key = null;

  for (const part of parts) {
    const mod = MODIFIER_TO_HYPR[part];
    if (mod) {
      if (!modifiers.includes(mod)) modifiers.push(mod);
    } else {
      key = part;
    }
  }

  if (!key) return null;

  const hyprKey = KEY_TO_HYPR[key] || (key.length === 1 ? key.toLowerCase() : key);
  return { modifiers, key: hyprKey };
}

function managedConfigContents({ modifiers, key }, { startOnLogin }) {
  const mods = modifiers.join(' ');
  const autostart = startOnLogin
    ? `# O serviço sobe junto com a sessão e fica na bandeja.
exec-once = env -u ELECTRON_RUN_AS_NODE GTK_USE_PORTAL=0 ${ELECTRON_BIN} ${SOURCE_DIR} --hidden

`
    : '';

  return `# Gerado pelo Activity Manager — não edite à mão.
# Este arquivo é reescrito toda vez que você salva as configurações do app.
# Para desligar tudo, remova o "source" deste arquivo do hyprland.conf.

${autostart}# Sobrescreve qualquer bind anterior nesta combinação.
unbind = ${mods}, ${key}
bind = ${mods}, ${key}, exec, ${TRIGGER_SCRIPT}

# A janela rápida precisa flutuar sobre o layout, e não entrar no tiling.
# (sintaxe de window rules do Hyprland 0.53+; os booleanos exigem "on")
windowrule = float on, ${QUICK_MATCH}
windowrule = center on, ${QUICK_MATCH}
windowrule = pin on, ${QUICK_MATCH}

# Segura o foco na janela rápida enquanto ela estiver aberta. Sem isto, o
# "mouse_refocus" do Hyprland devolve o foco para a janela que está embaixo do
# cursor e a janela rápida se fecharia sozinha antes de você digitar. É o mesmo
# recurso que os lançadores (walker, rofi) usam. Fecha com Esc ou ao salvar.
windowrule = stay_focused on, ${QUICK_MATCH}
`;
}

/**
 * Garante o `source =` do nosso arquivo no hyprland.conf — uma única vez.
 */
function ensureSourceLine() {
  let contents = '';
  try {
    contents = fs.readFileSync(HYPRLAND_CONF, 'utf-8');
  } catch {
    throw new Error(`Não encontrei ${HYPRLAND_CONF}. Este ambiente não parece ser Hyprland.`);
  }

  if (contents.includes('activity-manager.conf')) return false;

  const addition = `\n# Atalho do Activity Manager (gerenciado pelo app)\n${SOURCE_LINE}\n`;
  fs.writeFileSync(HYPRLAND_CONF, `${contents.trimEnd()}\n${addition}`, 'utf-8');
  return true;
}

async function applyOnHyprland(config) {
  const combo = parseAccelerator(config.globalShortcut);
  if (!combo) {
    return {
      registered: false,
      environment: 'hyprland',
      shortcut: config.globalShortcut,
      error: 'Atalho inválido. Use uma combinação com pelo menos um modificador (ex: Ctrl+Alt+A).'
    };
  }

  fs.mkdirSync(path.dirname(MANAGED_FILE), { recursive: true });
  fs.writeFileSync(MANAGED_FILE, managedConfigContents(combo, config), 'utf-8');

  const addedSource = ensureSourceLine();
  await hypr.reload();

  const errors = await hypr.configErrors();
  if (errors) {
    return {
      registered: false,
      environment: 'hyprland',
      shortcut: config.globalShortcut,
      managedFile: MANAGED_FILE,
      error: `O Hyprland recusou a configuração: ${errors}`
    };
  }

  return {
    registered: true,
    environment: 'hyprland',
    shortcut: config.globalShortcut,
    managedFile: MANAGED_FILE,
    addedSource,
    error: ''
  };
}

function applyOnX11(config, onTrigger) {
  globalShortcut.unregisterAll();
  try {
    const registered = globalShortcut.register(config.globalShortcut, onTrigger);
    return {
      registered,
      environment: 'x11',
      shortcut: config.globalShortcut,
      error: registered ? '' : 'Este ambiente recusou o atalho — provavelmente já está em uso por outro app.'
    };
  } catch (err) {
    return { registered: false, environment: 'x11', shortcut: config.globalShortcut, error: err.message };
  }
}

/**
 * Aplica o atalho no ambiente atual. Chamado no boot do serviço e sempre que o
 * usuário salva as configurações.
 */
async function sync(config, onTrigger) {
  if (hypr.isHyprland()) {
    try {
      return await applyOnHyprland(config);
    } catch (err) {
      return {
        registered: false,
        environment: 'hyprland',
        shortcut: config.globalShortcut,
        error: err.message
      };
    }
  }

  if (process.env.WAYLAND_DISPLAY) {
    return {
      registered: false,
      environment: 'wayland',
      shortcut: config.globalShortcut,
      error:
        'Neste compositor Wayland o app não consegue registrar o atalho sozinho. ' +
        `Crie um atalho no seu ambiente apontando para: ${TRIGGER_SCRIPT}`
    };
  }

  return applyOnX11(config, onTrigger);
}

/**
 * Descobre se a combinação escolhida já está tomada por outro bind.
 */
async function checkConflict(accelerator) {
  if (!hypr.isHyprland()) return null;
  const combo = parseAccelerator(accelerator);
  if (!combo) return null;

  const conflict = await hypr.findConflict(combo);
  if (!conflict) return null;
  if (String(conflict.arg || '').includes('am-trigger.sh')) return null; // é o nosso.

  return conflict.description || `${conflict.dispatcher} ${conflict.arg}`.trim();
}

function unregisterAll() {
  globalShortcut.unregisterAll();
}

module.exports = { sync, checkConflict, unregisterAll, parseAccelerator, TRIGGER_SCRIPT, MANAGED_FILE };
