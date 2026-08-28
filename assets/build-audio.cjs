// Run: node assets/build-audio.cjs
// Reproducible, original local cues: 16-bit mono PCM, no downloads or libraries.
const fs = require('node:fs');
const path = require('node:path');

const SAMPLE_RATE = 44100;
const DURATION = 1.2;
const LEAD_IN = .350;
const CONTACTS = [.045, .225, .405];
const PEAK = .58;

function buildCue(gentle = false) {
  const samples = new Float64Array(Math.round(SAMPLE_RATE * DURATION));
  let seed = 0x4d6f6d6f;
  function noise() {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x80000000 - 1;
  }
  const tau = 2 * Math.PI;
  CONTACTS.forEach((contact, index) => {
    const start = Math.round((LEAD_IN + contact) * SAMPLE_RATE);
    const note = [1046.50, 1318.51, 1567.98][index];
    let previousNoise = 0;
    for (let i = start; i < samples.length; i++) {
      const t = (i - start) / SAMPLE_RATE;
      if (t > .4) break;
      // Small-speaker-friendly wooden knocks: audible mids, a warm body, and
      // a very brief contact texture. Smooth attack/tails avoid digital clicks.
      if (t < .15) {
        const attack = 1 - Math.exp(-t / .0012);
        const tail = Math.min(1, (.15 - t) / .012);
        const n = noise();
        const contactNoise = (n - previousNoise * .55) * .16 * Math.exp(-t / .010);
        previousNoise = n;
        const wood = (.58 * Math.sin(tau * (730 - index * 32) * t) +
          .27 * Math.sin(tau * (1180 - index * 43) * t) +
          .15 * Math.sin(tau * (1820 - index * 52) * t)) * Math.exp(-t / .032);
        const body = .22 * Math.sin(tau * (330 - index * 12) * t) * Math.exp(-t / .044);
        samples[i] += .74 * attack * tail * (wood + body + contactNoise);
      }
      if (gentle) {
        // A tiny C-major mallet phrase shares the three paw-contact onsets.
        const envelope = (1 - Math.exp(-t / .003)) * Math.exp(-t / .14) * Math.min(1, (.4 - t) / .025);
        const bell = Math.sin(tau * note * t) + .18 * Math.sin(tau * note * 2.01 * t) * Math.exp(-t / .10);
        samples[i] += .24 * envelope * bell;
      }
    }
  });

  let peak = 0;
  for (const value of samples) peak = Math.max(peak, Math.abs(value));
  const gain = PEAK / peak;
  for (let i = 0; i < samples.length; i++) samples[i] *= gain;
  return samples;
}

function encodeWav(samples) {
  const dataLength = samples.length * 2;
  const file = Buffer.alloc(44 + dataLength);
  file.write('RIFF', 0);
  file.writeUInt32LE(36 + dataLength, 4);
  file.write('WAVE', 8);
  file.write('fmt ', 12);
  file.writeUInt32LE(16, 16);
  file.writeUInt16LE(1, 20); // PCM, not a compressed format requiring codecs.
  file.writeUInt16LE(1, 22);
  file.writeUInt32LE(SAMPLE_RATE, 24);
  file.writeUInt32LE(SAMPLE_RATE * 2, 28);
  file.writeUInt16LE(2, 32);
  file.writeUInt16LE(16, 34);
  file.write('data', 36);
  file.writeUInt32LE(dataLength, 40);
  for (let i = 0; i < samples.length; i++) {
    file.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  }
  return file;
}

if (require.main === module) {
  for (const [name, gentle] of [['taps.wav', false], ['gentle.wav', true]]) {
    const samples = buildCue(gentle);
    const file = encodeWav(samples);
    fs.writeFileSync(path.join(__dirname, name), file);
    const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
    console.log(name + ': ' + file.length + ' bytes, 1.2s, peak ' + PEAK.toFixed(2) + ', RMS ' + rms.toFixed(3));
  }
}

module.exports = { SAMPLE_RATE, DURATION, LEAD_IN, CONTACTS, buildCue, encodeWav };
