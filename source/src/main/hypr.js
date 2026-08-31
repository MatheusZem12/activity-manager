/**
 * Ponte com o Hyprland via `hyprctl`.
 *
 * No Wayland o compositor é o único que enxerga o teclado — nenhum app registra
 * atalho global por conta própria. Em vez de pedir para o usuário editar a
 * config do Hyprland na mão, o serviço fala com o compositor por aqui.
 */
const { execFile } = require('child_process');

// Bits de modificador do Hyprland (mesma tabela do xkb).
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
 * Binds já registrados no compositor, para avisar sobre conflitos antes de
 * sobrescrever um atalho que o usuário usa para outra coisa.
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
 * Procura um bind existente para a mesma combinação. Devolve a descrição do
 * bind (`bindd`) ou o comando, para mostrar ao usuário o que será sobrescrito.
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
