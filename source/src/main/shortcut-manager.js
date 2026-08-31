/**
 * Registro dos atalhos globais — feito pelo próprio serviço.
 *
 * São três atalhos: um abre a janela rápida de atividade, outro a janela rápida
 * de texto do clipboard, e o terceiro abre/foca o painel lateral. Todos são
 * definidos na tela de Configurações do app; daqui são aplicados no ambiente
 * gráfico. O usuário nunca precisa editar config de compositor.
 *
 *   Hyprland/Wayland: escrevemos um arquivo de config gerenciado por nós
 *     (~/.config/hypr/activity-manager.conf), garantimos um `source =` para ele
 *     no hyprland.conf e pedimos `hyprctl reload`. Cada bind chama
 *     bin/am-trigger.sh com o argumento (quick|clip), que acorda o serviço que
 *     já está rodando.
 *
 *   X11: o Electron consegue registrar os atalhos sozinho (globalShortcut).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { globalShortcut } = require('electron');

const hypr = require('./hypr');
const { WM_CLASS, QUICK_WINDOW_TITLE, CLIP_WINDOW_TITLE, PANEL_WINDOW_TITLE } = require('./window-identity');

const MANAGED_FILE = path.join(os.homedir(), '.config', 'hypr', 'activity-manager.conf');
const HYPRLAND_CONF = path.join(os.homedir(), '.config', 'hypr', 'hyprland.conf');
const SOURCE_LINE = 'source = ~/.config/hypr/activity-manager.conf';

// Precisam bater com o que o Electron reporta ao compositor (veja electron.js).
const QUICK_MATCH = `match:class ^(${WM_CLASS})$, match:title ^(${QUICK_WINDOW_TITLE})$`;
const CLIP_MATCH = `match:class ^(${WM_CLASS})$, match:title ^(${CLIP_WINDOW_TITLE})$`;
const PANEL_MATCH = `match:class ^(${WM_CLASS})$, match:title ^(${PANEL_WINDOW_TITLE})$`;

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

/**
 * Regras do painel de atividades (a janela que substituiu a antiga janela
 * principal). A geometria depende do lado escolhido: à direita, a janela
 * encosta na borda direita; à esquerda, na borda esquerda. O `size` reserva
 * 420px de largura e 90% da altura — mesma geometria calculada em electron.js.
 *
 * Atenção à sintaxe do `move`: no Hyprland 0.55 ele espera **expressões entre
 * parênteses** com as variáveis monitor_w/monitor_h/window_w/window_h. A forma
 * com percentuais ("move 100%-w-8 5%") não é aceita e — o pior — falha em
 * *silêncio*: `hyprctl configerrors` não acusa nada, a regra simplesmente não
 * se aplica e o compositor centraliza a janela float. Verificado na 0.55.2.
 */
function panelWindowRules(config) {
  // O painel é uma janela NORMAL: sem float, sem pin, sem posição imposta.
  //
  // Ele já teve regra de float + size + move + pin, para viver encostado na
  // borda e sempre por cima. Saiu inteira: window rule de posição falha em
  // silêncio (o hyprctl responde `ok` e nada se move), e uma janela sempre por
  // cima cobre a borda do editor o dia todo. O compositor cuida disso melhor
  // que qualquer regra que a gente escrevesse.
  //
  // As janelas de CAPTURA continuam com regra — elas são overlay de verdade,
  // aparecem por um instante e somem.
  return '';}

function bindBlock(combo, arg) {
  const mods = combo.modifiers.join(' ');
  return `# Sobrescreve qualquer bind anterior nesta combinação.
unbind = ${mods}, ${combo.key}
bind = ${mods}, ${combo.key}, exec, ${TRIGGER_SCRIPT} ${arg}`;
}

/**
 * Regras das duas janelas de captura (atividade e texto). São iguais: flutuam
 * centralizadas sobre o layout e seguram o foco.
 */
function captureWindowRules(match) {
  return `windowrule = float on, ${match}
windowrule = center on, ${match}
windowrule = pin on, ${match}
windowrule = stay_focused on, ${match}`;
}

function managedConfigContents({ quick, clip, panel }, config) {
  const autostart = config.startOnLogin
    ? `# O serviço sobe junto com a sessão e fica na bandeja.
exec-once = env -u ELECTRON_RUN_AS_NODE GTK_USE_PORTAL=0 ${ELECTRON_BIN} ${SOURCE_DIR} --hidden

`
    : '';

  return `# Gerado pelo Activity Manager — não edite à mão.
# Este arquivo é reescrito toda vez que você salva as configurações do app.
# Para desligar tudo, remova o "source" deste arquivo do hyprland.conf.

${autostart}${bindBlock(quick, 'quick')}
${bindBlock(clip, 'clip')}
${bindBlock(panel, 'panel')}

# As janelas de captura precisam flutuar sobre o layout, e não entrar no tiling.
# (sintaxe de window rules do Hyprland 0.53+; os booleanos exigem "on")
#
# O stay_focused segura o foco enquanto elas estiverem abertas. Sem isto, o
# "mouse_refocus" do Hyprland devolve o foco para a janela que está embaixo do
# cursor e a janela de captura se fecharia sozinha antes de você digitar. É o
# mesmo recurso que os lançadores (walker, rofi) usam.
# Nova atividade:
${captureWindowRules(QUICK_MATCH)}

# Novo texto (clipboard):
${captureWindowRules(CLIP_MATCH)}

${panelWindowRules(config)}
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

  const addition = `\n# Atalhos do Activity Manager (gerenciado pelo app)\n${SOURCE_LINE}\n`;
  fs.writeFileSync(HYPRLAND_CONF, `${contents.trimEnd()}\n${addition}`, 'utf-8');
  return true;
}

async function applyOnHyprland(config) {
  const quick = parseAccelerator(config.globalShortcut);
  const clip = parseAccelerator(config.globalShortcutClip);
  const panel = parseAccelerator(config.globalShortcutPanel);
  if (!quick || !clip || !panel) {
    return {
      registered: false,
      environment: 'hyprland',
      shortcut: config.globalShortcut,
      shortcutClip: config.globalShortcutClip,
      shortcutPanel: config.globalShortcutPanel,
      error: 'Atalho inválido. Use uma combinação com pelo menos um modificador (ex: Ctrl+Alt+A).'
    };
  }

  fs.mkdirSync(path.dirname(MANAGED_FILE), { recursive: true });
  fs.writeFileSync(MANAGED_FILE, managedConfigContents({ quick, clip, panel }, config), 'utf-8');

  const addedSource = ensureSourceLine();
  await hypr.reload();

  const errors = await hypr.configErrors();
  if (errors) {
    return {
      registered: false,
      environment: 'hyprland',
      shortcut: config.globalShortcut,
      shortcutClip: config.globalShortcutClip,
      shortcutPanel: config.globalShortcutPanel,
      managedFile: MANAGED_FILE,
      error: `O Hyprland recusou a configuração: ${errors}`
    };
  }

  return {
    registered: true,
    environment: 'hyprland',
    shortcut: config.globalShortcut,
    shortcutClip: config.globalShortcutClip,
    shortcutPanel: config.globalShortcutPanel,
    managedFile: MANAGED_FILE,
    addedSource,
    error: ''
  };
}

function applyOnX11(config, handlers) {
  globalShortcut.unregisterAll();
  try {
    const quickOk = globalShortcut.register(config.globalShortcut, handlers.onQuick);
    const clipOk = globalShortcut.register(config.globalShortcutClip, handlers.onClip);
    const panelOk = globalShortcut.register(config.globalShortcutPanel, handlers.onPanel);
    const registered = quickOk && clipOk && panelOk;
    const failed = [];
    if (!quickOk) failed.push(config.globalShortcut);
    if (!clipOk) failed.push(config.globalShortcutClip);
    if (!panelOk) failed.push(config.globalShortcutPanel);
    return {
      registered,
      environment: 'x11',
      shortcut: config.globalShortcut,
      shortcutClip: config.globalShortcutClip,
      shortcutPanel: config.globalShortcutPanel,
      error: registered
        ? ''
        : `Este ambiente recusou o(s) atalho(s) ${failed.join(', ')} — provavelmente já em uso por outro app.`
    };
  } catch (err) {
    return {
      registered: false,
      environment: 'x11',
      shortcut: config.globalShortcut,
      shortcutClip: config.globalShortcutClip,
      shortcutPanel: config.globalShortcutPanel,
      error: err.message
    };
  }
}

/**
 * Aplica os atalhos no ambiente atual. Chamado no boot do serviço e sempre que
 * o usuário salva as configurações.
 *
 * @param {object} config
 * @param {{ onQuick: () => void, onClip: () => void, onPanel: () => void }} handlers
 */
async function sync(config, handlers) {
  if (hypr.isHyprland()) {
    try {
      return await applyOnHyprland(config);
    } catch (err) {
      return {
        registered: false,
        environment: 'hyprland',
        shortcut: config.globalShortcut,
        shortcutClip: config.globalShortcutClip,
        shortcutPanel: config.globalShortcutPanel,
        error: err.message
      };
    }
  }

  if (process.env.WAYLAND_DISPLAY) {
    return {
      registered: false,
      environment: 'wayland',
      shortcut: config.globalShortcut,
      shortcutClip: config.globalShortcutClip,
      shortcutPanel: config.globalShortcutPanel,
      error:
        'Neste compositor Wayland o app não consegue registrar os atalhos sozinho. ' +
        `Crie atalhos apontando para: ${TRIGGER_SCRIPT} quick  e  ${TRIGGER_SCRIPT} clip  e  ${TRIGGER_SCRIPT} panel`
    };
  }

  return applyOnX11(config, handlers);
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
