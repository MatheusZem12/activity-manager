#!/usr/bin/env node
/**
 * Generates assets/notification.wav — the chime played when an activity alert
 * fires. The .wav is versioned along; this script only exists so the sound can
 * be tweaked without hunting for an audio file on the internet.
 *
 *   node bin/make-notification-sound.js
 *
 * Two sine waves a fifth apart (A5 -> E6), the second coming in a little
 * after the first, each with an exponential decay. It is the classic
 * notification "ding-dong": it rises, doesn't startle, and fades fast.
 */
const fs = require('fs');
const path = require('path');

const SAMPLE_RATE = 44100;
const DURATION = 0.9; // seconds, with the decay tail included
const AMPLITUDE = 0.32; // far from the ceiling: an alert doesn't need to shout

const TONES = [
  { freq: 880.0, start: 0.0, decay: 0.22 },  // A5
  { freq: 1318.5, start: 0.13, decay: 0.30 } // E6
];

// A very short attack ramp. Without it the wave starts on a step and the speaker
// gives a "click" on the attack.
const ATTACK = 0.005;

function sampleAt(t) {
  let value = 0;

  for (const tone of TONES) {
    const age = t - tone.start;
    if (age < 0) continue;

    const envelope = Math.exp(-age / tone.decay) * Math.min(1, age / ATTACK);
    // The octave above comes in softly just to brighten the timbre — a pure
    // sine sounds too hollow.
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
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // uncompressed PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}

const target = path.join(__dirname, '..', 'assets', 'notification.wav');
fs.writeFileSync(target, wrapInWav(render()));
console.log(`gerado: ${target}`);
