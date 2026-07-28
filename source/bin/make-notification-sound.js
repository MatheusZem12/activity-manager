#!/usr/bin/env node
/**
 * Gera assets/notification.wav — o chime tocado quando um alerta de atividade
 * dispara. O .wav vai versionado junto; este script existe só para que o som
 * possa ser ajustado sem precisar caçar um arquivo de áudio na internet.
 *
 *   node bin/make-notification-sound.js
 *
 * Duas senoides em intervalo de quinta (A5 -> E6), a segunda entrando um pouco
 * depois da primeira, cada uma com decaimento exponencial. É a forma clássica
 * de "ding-dong" de notificação: sobe, não assusta, e some rápido.
 */
const fs = require('fs');
const path = require('path');

const SAMPLE_RATE = 44100;
const DURATION = 0.9; // segundos, com o rabo do decaimento já incluso
const AMPLITUDE = 0.32; // longe do teto: alerta não precisa gritar

const TONES = [
  { freq: 880.0, start: 0.0, decay: 0.22 },  // A5
  { freq: 1318.5, start: 0.13, decay: 0.30 } // E6
];

// Rampa de subida curtíssima. Sem ela a onda começa num degrau e o alto-falante
// entrega um "clique" no ataque.
const ATTACK = 0.005;

function sampleAt(t) {
  let value = 0;

  for (const tone of TONES) {
    const age = t - tone.start;
    if (age < 0) continue;

    const envelope = Math.exp(-age / tone.decay) * Math.min(1, age / ATTACK);
    // A oitava acima entra baixinha só para dar brilho ao timbre — uma senoide
    // pura soa oca demais.
    const wave =
      Math.sin(2 * Math.PI * tone.freq * age) +
      0.18 * Math.sin(2 * Math.PI * tone.freq * 2 * age);

    value += envelope * wave;
  }

  return value / TONES.length;
}

function render() {
  const frames = Math.floor(SAMPLE_RATE * DURATION);
  const pcm = Buffer.alloc(frames * 2); // 16 bits mono

  for (let i = 0; i < frames; i++) {
    const raw = sampleAt(i / SAMPLE_RATE) * AMPLITUDE;
    const clamped = Math.max(-1, Math.min(1, raw));
    pcm.writeInt16LE(Math.round(clamped * 32767), i * 2);
  }

  return pcm;
}

function wrapInWav(pcm) {
  const header = Buffer.alloc(44);
  const byteRate = SAMPLE_RATE * 2;

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // tamanho do bloco fmt
  header.writeUInt16LE(1, 20); // PCM sem compressão
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits por amostra
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}

const target = path.join(__dirname, '..', 'assets', 'notification.wav');
fs.writeFileSync(target, wrapInWav(render()));
console.log(`gerado: ${target}`);
