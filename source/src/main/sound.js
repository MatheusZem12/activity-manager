const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SOUND_PATH = path.join(__dirname, '..', '..', 'assets', 'notification.wav');
const SCALED_PATH = path.join(os.tmpdir(), 'activity-manager-chime.wav');
const WAV_HEADER_SIZE = 44; // PCM 16-bit mono, gerado por bin/make-notification-sound.js.

// O daemon de notificação do Wayland (mako, no Omarchy) não toca som nenhum —
// ignora o `silent: false` do Electron em silêncio. Então o som é por nossa
// conta: mandamos o .wav para o primeiro tocador de linha de comando que
// existir na máquina. A ordem segue do mais provável (PipeWire) ao mais
// genérico.
const PLAYERS = [
  { bin: 'pw-play', args: (file) => [file] },
  { bin: 'paplay', args: (file) => [file] },
  { bin: 'aplay', args: (file) => ['-q', file] },
  { bin: 'ffplay', args: (file) => ['-nodisp', '-autoexit', '-loglevel', 'quiet', file] }
];

let resolved;

function resolvePlayer() {
  if (resolved !== undefined) return resolved;

  resolved =
    PLAYERS.find((player) => {
      const found = spawnSync('which', [player.bin], { stdio: 'ignore' });
      return found.status === 0;
    }) || null;

  if (!resolved) {
    console.warn('[som] nenhum tocador encontrado (pw-play, paplay, aplay, ffplay); alerta ficará mudo');
  }

  return resolved;
}

// A maioria dos tocadores de linha de comando não trata volume da mesma forma
// (paplay usa 0-65536, pw-play uma flag própria, aplay nenhuma). Em vez de
// depender de cada um, escalamos as amostras do .wav aqui e tocamos o
// resultado — funciona igual em qualquer tocador. O arquivo escalado fica em
// cache no tmpdir e só é regravado quando o volume muda.
let cachedVolume = null;

function scaledFileFor(volume) {
  if (cachedVolume === volume && fs.existsSync(SCALED_PATH)) return SCALED_PATH;

  const source = fs.readFileSync(SOUND_PATH);
  const header = source.subarray(0, WAV_HEADER_SIZE);
  const pcm = Buffer.from(source.subarray(WAV_HEADER_SIZE));
  const factor = Math.max(0, Math.min(100, volume)) / 100;

  for (let i = 0; i + 1 < pcm.length; i += 2) {
    const sample = pcm.readInt16LE(i);
    pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(sample * factor))), i);
  }

  fs.writeFileSync(SCALED_PATH, Buffer.concat([header, pcm]));
  cachedVolume = volume;
  return SCALED_PATH;
}

/**
 * Toca o chime do alerta no volume configurado (0-100). Nunca lança nem
 * bloqueia: um alerta sem som ainda é um alerta, e não vale derrubar a
 * notificação por causa do áudio.
 */
function play(volume = 100) {
  const player = resolvePlayer();
  if (!player) return;
  if (volume <= 0) return;

  let file = SOUND_PATH;
  try {
    if (volume < 100) file = scaledFileFor(volume);
  } catch (err) {
    console.warn(`[som] não consegui ajustar o volume: ${err.message}`);
  }

  try {
    const child = spawn(player.bin, player.args(file), {
      stdio: 'ignore',
      detached: true
    });
    child.on('error', (err) => console.warn(`[som] ${player.bin} falhou: ${err.message}`));
    // Sem o unref o processo do tocador segura o event loop do Electron.
    child.unref();
  } catch (err) {
    console.warn(`[som] não consegui tocar: ${err.message}`);
  }
}

module.exports = { play, SOUND_PATH };
