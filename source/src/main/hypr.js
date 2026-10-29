/**
 * A bridge to Hyprland through `hyprctl`.
 *
 * On Wayland the compositor is the only one that sees the keyboard — no app
 * registers a global shortcut on its own. Instead of asking the user to edit
 * the Hyprland config by hand, the service talks to the compositor here.
 */
const { execFile } = require('child_process');

// Hyprland modifier bits (the same table as xkb's).
const MOD_BITS = {
  SHIFT: 1,
  CAPS: 2,
  CTRL: 4,
  ALT: 8,
  MOD2: 16,
  MOD3: 32,
  SUPER: 64
};

function isHyprland() {
  return Boolean(process.env.HYPRLAND_INSTANCE_SIGNATURE);
}

function hyprctl(args) {
  return new Promise((resolve, reject) => {
    execFile('hyprctl', args, { timeout: 5000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr.trim() || err.message));
      resolve(stdout.trim());
    });
  });
}

async function reload() {
  return hyprctl(['reload']);
}

async function configErrors() {
  try {
    const out = await hyprctl(['configerrors']);
    return out && out !== 'no errors' ? out : '';
  } catch {
    return '';
  }
}

/**
 * Binds already registered in the compositor, to warn about conflicts before
 * overwriting a shortcut the user uses for something else.
 */
async function listBinds() {
  try {
    const out = await hyprctl(['binds', '-j']);
    return JSON.parse(out);
  } catch {
    return [];
  }
}

function modMask(modifiers) {
  return modifiers.reduce((mask, mod) => mask | (MOD_BITS[mod] || 0), 0);
}

/**
 * Looks for an existing bind on the same combination. Returns the bind
 * description (`bindd`) or the command, to show the user what will be overwritten.
 */
async function findConflict({ modifiers, key }) {
  const mask = modMask(modifiers);
  const target = key.toLowerCase();
  const binds = await listBinds();

  const hit = binds.find(
    (bind) => bind.modmask === mask && String(bind.key || '').toLowerCase() === target
  );
  if (!hit) return null;

  return {
    description: hit.description || '',
    dispatcher: hit.dispatcher || '',
    arg: hit.arg || ''
  };
}

module.exports = { isHyprland, hyprctl, reload, configErrors, listBinds, findConflict, modMask };
