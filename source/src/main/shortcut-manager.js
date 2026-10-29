/**
 * Global shortcut registration — done by the service itself.
 *
 * There are three shortcuts: one opens the quick activity window, another the
 * quick clipboard text window, and the third opens/focuses the side panel. All
 * are set on the app's Settings screen; from here they are applied to the
 * graphical environment. The user never has to edit compositor config.
 *
 *   Hyprland/Wayland: we write a config file we manage
 *     (~/.config/hypr/activity-manager.conf), make sure hyprland.conf has a
 *     `source =` for it and ask for `hyprctl reload`. Each bind calls
 *     bin/am-trigger.sh with the argument (quick|clip), which wakes the service
 *     that is already running.
 *
 *   X11: Electron can register the shortcuts on its own (globalShortcut).
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

// They must match what Electron reports to the compositor (see electron.js).
const QUICK_MATCH = `match:class ^(${WM_CLASS})$, match:title ^(${QUICK_WINDOW_TITLE})$`;
const CLIP_MATCH = `match:class ^(${WM_CLASS})$, match:title ^(${CLIP_WINDOW_TITLE})$`;
const PANEL_MATCH = `match:class ^(${WM_CLASS})$, match:title ^(${PANEL_WINDOW_TITLE})$`;

const TRIGGER_SCRIPT = path.join(__dirname, '..', '..', 'bin', 'am-trigger.sh');
const ELECTRON_BIN = path.join(__dirname, '..', '..', 'node_modules', 'electron', 'dist', 'electron');
const SOURCE_DIR = path.join(__dirname, '..', '..');

// Keys whose Hyprland name (xkb keysym) differs from the Electron name.
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
 * Rules for the activity panel (the window that replaced the old main
 * window). The geometry depends on the chosen side: on the right, the window
 * hugs the right edge; on the left, the left edge. `size` reserves 420px of
 * width and 90% of the height — the same geometry computed in electron.js.
 *
 * Mind the `move` syntax: on Hyprland 0.55 it expects **parenthesized
 * expressions** with the monitor_w/monitor_h/window_w/window_h variables. The
 * percentage form ("move 100%-w-8 5%") is not accepted and — worse — it fails
 * *silently*: `hyprctl configerrors` reports nothing, the rule simply does not
 * apply and the compositor centers the floating window. Verified on 0.55.2.
 */
function panelWindowRules(config) {
  // The panel is a NORMAL window: no float, no pin, no forced position.
  //
  // It used to have a float + size + move + pin rule, to live against the edge
  // and always on top. It went away entirely: a position window rule fails
  // silently (hyprctl answers `ok` and nothing moves), and an always-on-top
  // window covers the editor's edge all day. The compositor handles this better
  // than any rule we could write.
  //
  // The CAPTURE windows keep their rules — they are real overlays, showing up
  // for a moment and going away.
  return '';}

function bindBlock(combo, arg) {
  const mods = combo.modifiers.join(' ');
  return `# Overrides any previous bind on this combination.
unbind = ${mods}, ${combo.key}
bind = ${mods}, ${combo.key}, exec, ${TRIGGER_SCRIPT} ${arg}`;
}

/**
 * Rules for the two capture windows (activity and text). They are the same:
 * they float centered over the layout and hold the focus.
 */
function captureWindowRules(match) {
  return `windowrule = float on, ${match}
windowrule = center on, ${match}
windowrule = pin on, ${match}
windowrule = stay_focused on, ${match}`;
}

function managedConfigContents({ quick, clip, panel }, config) {
  const autostart = config.startOnLogin
    ? `# The service starts with the session and stays in the tray.
exec-once = env -u ELECTRON_RUN_AS_NODE GTK_USE_PORTAL=0 ${ELECTRON_BIN} ${SOURCE_DIR} --hidden

`
    : '';

  return `# Generated by Activity Manager — do not edit by hand.
# This file is rewritten every time you save the app's settings.
# To turn everything off, remove this file's "source" from hyprland.conf.

${autostart}${bindBlock(quick, 'quick')}
${bindBlock(clip, 'clip')}
${bindBlock(panel, 'panel')}

# The capture windows must float over the layout, not join the tiling.
# (Hyprland 0.53+ window rule syntax; booleans require "on")
#
# stay_focused holds the focus while they are open. Without it, Hyprland's
# "mouse_refocus" hands focus back to the window under the cursor and the
# capture window would close on its own before you typed. It is the same
# feature launchers (walker, rofi) use.
# New activity:
${captureWindowRules(QUICK_MATCH)}

# New text (clipboard):
${captureWindowRules(CLIP_MATCH)}

${panelWindowRules(config)}
`;
}

/**
 * Makes sure hyprland.conf sources our file — only once.
 */
function ensureSourceLine() {
  let contents = '';
  try {
    contents = fs.readFileSync(HYPRLAND_CONF, 'utf-8');
  } catch {
    throw new Error(`Couldn't find ${HYPRLAND_CONF}. This environment doesn't look like Hyprland.`);
  }

  if (contents.includes('activity-manager.conf')) return false;

  const addition = `\n# Activity Manager shortcuts (managed by the app)\n${SOURCE_LINE}\n`;
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
      error: 'Invalid shortcut. Use a combination with at least one modifier (e.g. Ctrl+Alt+A).'
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
      error: `Hyprland rejected the configuration: ${errors}`
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
        : `This environment rejected the shortcut(s) ${failed.join(', ')} — probably already in use by another app.`
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
 * Applies the shortcuts in the current environment. Called when the service boots
 * and whenever the user saves the settings.
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
        'On this Wayland compositor the app cannot register the shortcuts on its own. ' +
        `Create shortcuts pointing to: ${TRIGGER_SCRIPT} quick  and  ${TRIGGER_SCRIPT} clip  and  ${TRIGGER_SCRIPT} panel`
    };
  }

  return applyOnX11(config, handlers);
}

/**
 * Finds out whether the chosen combination is already taken by another bind.
 */
async function checkConflict(accelerator) {
  if (!hypr.isHyprland()) return null;
  const combo = parseAccelerator(accelerator);
  if (!combo) return null;

  const conflict = await hypr.findConflict(combo);
  if (!conflict) return null;
  if (String(conflict.arg || '').includes('am-trigger.sh')) return null; // it's ours.

  return conflict.description || `${conflict.dispatcher} ${conflict.arg}`.trim();
}

function unregisterAll() {
  globalShortcut.unregisterAll();
}

module.exports = { sync, checkConflict, unregisterAll, parseAccelerator, TRIGGER_SCRIPT, MANAGED_FILE };
