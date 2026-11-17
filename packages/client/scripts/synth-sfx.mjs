// Arcane Academies sound effects, synthesized from scratch (no samples).
// One palette: D-major/pentatonic tuning, glass + bell timbres, paper/air noise, one shared "hall" reverb.
// Usage: node packages/client/scripts/synth-sfx.mjs <outDir>  -> writes <cue>.wav (mono 44.1 kHz 16-bit).
// Then encode: ffmpeg -i <cue>.wav -ac 1 -c:a libmp3lame -b:a 80k packages/client/public/sounds/<cue>.mp3
// sell.mp3 = Kenney "RPG Audio" handleCoins (CC0, -4 dB) + sellGlint.wav delayed 120 ms (+3 dB), limited to -1.5 dBFS.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SR = 44100;
const out = process.argv[2] ?? './out';
mkdirSync(out, { recursive: true });

// deterministic noise so every build of the files is identical
let seed = 0x9e3779b9;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const noise = () => rnd() * 2 - 1;

const N = (sec) => Math.round(sec * SR);
const buf = (sec) => new Float32Array(N(sec));
const hz = (note) => 440 * Math.pow(2, (note - 69) / 12); // MIDI note -> Hz
const D3 = 50, A3 = 57, D4 = 62, Fs4 = 66, G4 = 67, A4 = 69, B4 = 71, D5 = 74, E5 = 76, Fs5 = 78, A5 = 81, B5 = 83, D6 = 86, E6 = 88, Fs6 = 90, A6 = 93, D7 = 98;

function add(dst, src, at = 0, gain = 1) {
  const o = N(at);
  for (let i = 0; i < src.length && o + i < dst.length; i++) dst[o + i] += src[i] * gain;
  return dst;
}

/** Struck tone from partials [ratio, amp, decayScale]; decay = seconds to -60 dB for the fundamental. */
function strike(freq, dur, partials, decay, attack = 0.002) {
  const b = buf(dur);
  for (const [ratio, amp, dScale = 1] of partials) {
    const f = freq * ratio;
    if (f > SR / 2.2) continue;
    const tau = (decay * dScale) / 6.9;
    const ph = rnd() * Math.PI * 2;
    for (let i = 0; i < b.length; i++) {
      const t = i / SR;
      const env = Math.min(1, t / attack) * Math.exp(-t / tau);
      b[i] += amp * env * Math.sin(2 * Math.PI * f * t + ph);
    }
  }
  return b;
}
const GLASS = [[1, 1], [2.0, 0.35, 0.6], [3.01, 0.18, 0.4], [4.17, 0.08, 0.3], [5.43, 0.04, 0.2]];
const BELL = [[0.5, 0.35, 1.3], [1, 1], [1.19, 0.4, 0.8], [1.5, 0.3, 0.7], [2.0, 0.45, 0.6], [2.74, 0.25, 0.45], [3.76, 0.12, 0.3], [5.4, 0.06, 0.2]];
const glass = (note, dur, decay = dur * 0.8) => strike(hz(note), dur, GLASS, decay);
const bell = (note, dur, decay = dur * 0.8) => strike(hz(note), dur, BELL, decay, 0.004);

/** Soft sustained pad: additive harmonics, slight detune, slow attack/release. */
function pad(notes, dur, attack = 0.15, release = 0.6) {
  const b = buf(dur);
  for (const note of notes) {
    for (const det of [-0.06, 0.06]) {
      const f0 = hz(note + det);
      for (let h = 1; h <= 6; h++) {
        const f = f0 * h;
        const amp = 1 / (h * h * 0.7 + 0.3);
        const ph = rnd() * Math.PI * 2;
        for (let i = 0; i < b.length; i++) {
          const t = i / SR;
          const env = Math.min(1, t / attack) * Math.min(1, Math.max(0, (dur - t) / release));
          b[i] += 0.12 * amp * env * Math.sin(2 * Math.PI * f * t + ph);
        }
      }
    }
  }
  return b;
}

/** RBJ band-pass on white noise with per-sample centre frequency fc(t). */
function bandNoise(dur, fc, q, env) {
  const b = buf(dur);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < b.length; i++) {
    const t = i / SR;
    const w = (2 * Math.PI * Math.min(fc(t), SR * 0.45)) / SR;
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    const x = noise();
    const y = (alpha * x - alpha * x2 + 2 * Math.cos(w) * y1 - (1 - alpha) * y2) / a0;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    b[i] = y * env(t);
  }
  return b;
}

/** Tone with a frequency glide f(t) and envelope. */
function glide(dur, f, env, harmonics = [[1, 1]]) {
  const b = buf(dur);
  let ph = 0;
  for (let i = 0; i < b.length; i++) {
    const t = i / SR;
    ph += (2 * Math.PI * f(t)) / SR;
    let s = 0;
    for (const [h, a] of harmonics) s += a * Math.sin(ph * h);
    b[i] = s * env(t);
  }
  return b;
}

/** Sparkle: many tiny random high glass pings. */
function sparkle(dur, count, lo, hi, gain = 0.25, decay = 0.12) {
  const b = buf(dur);
  for (let k = 0; k < count; k++) {
    const at = rnd() * dur * 0.7;
    const f = lo * Math.pow(hi / lo, rnd());
    const p = strike(f, decay * 1.5, [[1, 1], [2.0, 0.2, 0.5]], decay, 0.001);
    add(b, p, at, gain * (0.4 + 0.6 * rnd()));
  }
  return b;
}

const ar = (a, d) => (t) => Math.min(1, t / a) * Math.exp(-Math.max(0, t - a) / d);
const hump = (dur, peak = 0.35) => (t) => {
  const x = t / dur;
  if (x <= 0 || x >= 1) return 0;
  return x < peak ? Math.sin((Math.PI / 2) * (x / peak)) ** 2 : Math.cos((Math.PI / 2) * ((x - peak) / (1 - peak))) ** 2;
};

/** Shared small "stone hall" reverb (Schroeder: 4 damped combs + 2 allpasses). */
function hall(dry, mix = 0.25, size = 1, tail = 0.8) {
  const len = dry.length + N(tail);
  const inp = new Float32Array(len); inp.set(dry);
  const wet = new Float32Array(len);
  const combs = [1557, 1617, 1491, 1422].map((d) => Math.round(d * size));
  for (const d of combs) {
    const line = new Float32Array(d); let idx = 0, lp = 0;
    for (let i = 0; i < len; i++) {
      const y = line[idx];
      lp = y * 0.75 + lp * 0.25;
      line[idx] = inp[i] + lp * 0.8;
      idx = (idx + 1) % d;
      wet[i] += y / combs.length;
    }
  }
  let sig = wet;
  for (const d of [225, 556]) {
    const line = new Float32Array(d); let idx = 0; const o = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const delayed = line[idx];
      const v = sig[i] + delayed * 0.5;
      line[idx] = v; o[i] = delayed - v * 0.5;
      idx = (idx + 1) % d;
    }
    sig = o;
  }
  const res = new Float32Array(len);
  for (let i = 0; i < len; i++) res[i] = inp[i] * (1 - mix * 0.5) + sig[i] * mix;
  return res;
}

function highpass(b, fc) { // one-pole
  const a = Math.exp((-2 * Math.PI * fc) / SR); let y = 0, xp = 0;
  for (let i = 0; i < b.length; i++) { const x = b[i]; y = a * (y + x - xp); xp = x; b[i] = y; }
  return b;
}

/** Loudest 100 ms RMS -> target dBFS, soft-limit under -1 dBFS, trim silence, short fades. */
function finish(b, targetDb) {
  const w = N(0.1);
  let best = 0, acc = 0;
  for (let i = 0; i < b.length; i++) {
    acc += b[i] * b[i];
    if (i >= w) acc -= b[i - w] * b[i - w];
    best = Math.max(best, acc / Math.min(w, i + 1));
  }
  let peak = 0; for (let i = 0; i < b.length; i++) peak = Math.max(peak, Math.abs(b[i]));
  // RMS target, but never push the peak past -1.5 dBFS (keeps glass clean, no limiter distortion)
  const g = Math.min(Math.pow(10, targetDb / 20) / Math.sqrt(best || 1e-12), Math.pow(10, -1.5 / 20) / (peak || 1e-12));
  const ceil = Math.pow(10, -1 / 20);
  for (let i = 0; i < b.length; i++) b[i] = Math.max(-ceil, Math.min(ceil, b[i] * g));
  const floor = Math.pow(10, -60 / 20);
  let end = b.length;
  while (end > 1 && Math.abs(b[end - 1]) < floor) end--;
  let start = 0;
  while (start < end && Math.abs(b[start]) < floor) start++;
  const r = b.slice(start, Math.min(b.length, end + N(0.01)));
  const fi = Math.min(N(0.002), r.length), fo = Math.min(N(0.03), r.length);
  for (let i = 0; i < fi; i++) r[i] *= i / fi;
  for (let i = 0; i < fo; i++) r[r.length - 1 - i] *= i / fo;
  return r;
}

function wav(name, b) {
  const data = Buffer.alloc(b.length * 2);
  for (let i = 0; i < b.length; i++) data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(b[i] * 32767))), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  writeFileSync(join(out, `${name}.wav`), Buffer.concat([h, data]));
  console.log(name, (b.length / SR).toFixed(2) + 's');
}

const cues = {};

// tap / reaction: a tiny glass "tink", very short so it never gets in the way of button presses
cues.tap = () => {
  const b = buf(0.25);
  add(b, glass(A6, 0.25, 0.12), 0, 0.8);
  add(b, glass(D7, 0.2, 0.08), 0.004, 0.25);
  return [hall(b, 0.12, 0.6, 0.15), -10];
};

// select: soft parchment brush (card picked up) with a faint glint on top
cues.select = () => {
  const d = 0.32;
  const b = buf(d + 0.2);
  add(b, bandNoise(d, (t) => 2600 + 2200 * (t / d), 1.1, hump(0.2, 0.3)), 0, 0.9);
  add(b, bandNoise(d, () => 900, 0.8, hump(0.12, 0.25)), 0.005, 0.35);
  add(b, glass(D7, 0.35, 0.2), 0.06, 0.07);
  return [hall(b, 0.15, 0.7, 0.2), -13];
};

// build: small crystal "ting": a bright glass pair (A6 over D6) with a short sparkle
cues.build = () => {
  const b = buf(0.9);
  add(b, bandNoise(0.05, () => 4000, 0.9, ar(0.002, 0.012)), 0, 0.35);
  add(b, glass(A6, 0.9, 0.6), 0.004, 0.75);
  add(b, glass(D6, 0.8, 0.5), 0.004, 0.4);
  add(b, sparkle(0.5, 6, 3000, 6000, 0.12, 0.08), 0.02);
  return [hall(b, 0.25, 0.9, 0.5), -11];
};

// tower: low academy bell, then a rising shimmer of glass notes and air
cues.tower = () => {
  const b = buf(2.0);
  add(b, bell(D4, 2.0, 1.6), 0, 0.9);
  [D5, Fs5, A5, D6, Fs6, A6].forEach((n, i) => add(b, glass(n, 0.7, 0.45), 0.18 + i * 0.065, 0.22 + i * 0.02));
  add(b, bandNoise(0.8, (t) => 1500 * Math.pow(6, t / 0.8), 2.5, hump(0.8, 0.7)), 0.15, 0.25);
  add(b, sparkle(0.9, 10, 3500, 8000, 0.1, 0.1), 0.45);
  return [hall(b, 0.3, 1.1, 0.9), -10];
};

// sell: recorded coins are mixed in by build.sh; this is only the glint layered on top of them
cues.sellGlint = () => {
  const b = buf(0.8);
  add(b, glass(B5, 0.6, 0.35), 0.0, 0.35);
  add(b, glass(E6, 0.6, 0.35), 0.07, 0.3);
  add(b, sparkle(0.6, 6, 3500, 7000, 0.12, 0.08), 0.02);
  return [hall(b, 0.25, 0.9, 0.4), -12];
};

// turn: a page turning (lift + settle) with one soft low chime
cues.turn = () => {
  const b = buf(0.9);
  add(b, bandNoise(0.22, (t) => 1800 + 3000 * (t / 0.22), 1.0, hump(0.22, 0.6)), 0, 0.7);
  add(b, bandNoise(0.2, (t) => 3500 - 2000 * (t / 0.2), 0.9, hump(0.2, 0.15)), 0.17, 0.9);
  add(b, bandNoise(0.06, () => 700, 0.7, ar(0.003, 0.02)), 0.2, 0.4);
  add(b, glass(D5, 0.7, 0.5), 0.16, 0.12);
  add(b, glass(A5, 0.6, 0.4), 0.16, 0.06);
  return [hall(b, 0.2, 0.8, 0.4), -17];
};

// tick: soft wooden clock tick (last seconds of the turn timer)
cues.tick = () => {
  const b = buf(0.12);
  add(b, strike(1250, 0.12, [[1, 1], [2.3, 0.4, 0.5], [3.9, 0.2, 0.3]], 0.05, 0.0005), 0, 0.8);
  add(b, bandNoise(0.03, () => 3000, 1.2, ar(0.0005, 0.005)), 0, 0.5);
  return [highpass(hall(b, 0.08, 0.5, 0.08), 200), -9];
};

// clash: arcane whoosh: resonant air sweep up with a whistling tone, then a soft sparking impact
cues.clash = () => {
  const d = 0.55;
  const b = buf(1.0);
  add(b, bandNoise(d, (t) => 300 * Math.pow(12, t / d), 3, hump(d, 0.8)), 0, 1.0);
  add(b, glide(d, (t) => 220 * Math.pow(4, t / d), hump(d, 0.85), [[1, 1], [2, 0.3], [3, 0.12]]), 0, 0.22);
  add(b, bandNoise(0.35, () => 1800, 0.6, ar(0.002, 0.07)), d - 0.04, 0.9);
  add(b, bell(A3, 0.6, 0.45), d - 0.04, 0.35);
  add(b, sparkle(0.4, 8, 2500, 6000, 0.12, 0.06), d - 0.02);
  return [hall(b, 0.3, 1.0, 0.6), -9];
};

// duelWin: short magical burst: quick rising arpeggio into a bright chord with sparkles
cues.duelWin = () => {
  const b = buf(1.4);
  [D5, Fs5, A5, D6].forEach((n, i) => add(b, glass(n, 0.9, 0.55), i * 0.055, 0.45));
  [A5, D6, Fs6].forEach((n) => add(b, glass(n, 1.1, 0.8), 0.24, 0.3));
  add(b, bandNoise(0.4, (t) => 4000 + 4000 * t, 1.5, ar(0.01, 0.12)), 0.22, 0.35);
  add(b, sparkle(0.8, 14, 3000, 9000, 0.12, 0.1), 0.24);
  return [hall(b, 0.3, 1.0, 0.7), -10];
};

// duelLoss: fizzling spell: a falling tone that sputters out over crackles and a low whoosh
cues.duelLoss = () => {
  const d = 0.75;
  const b = buf(1.0);
  const gates = []; for (let i = 0; i < 40; i++) gates.push(rnd() > 0.35 ? 1 : 0.15);
  const gate = (t) => (t < d * 0.45 ? 1 : gates[Math.floor(t * 60) % gates.length]);
  add(b, glide(d, (t) => 520 * Math.pow(0.3, t / d), (t) => hump(d, 0.12)(t) * gate(t), [[1, 1], [2, 0.25], [3, 0.1]]), 0, 0.35);
  add(b, bandNoise(d, (t) => 1400 * Math.pow(0.25, t / d), 1.2, hump(d, 0.15)), 0, 0.8);
  const c = buf(d);
  for (let k = 0; k < 28; k++) add(c, bandNoise(0.012, () => 2500 + 3000 * rnd(), 2, ar(0.0005, 0.003)), 0.1 + rnd() * (d - 0.2), 0.7 * (1 - k / 40));
  add(b, c, 0, 0.8);
  add(b, glass(A4, 0.6, 0.4), 0, 0.1);
  return [hall(b, 0.2, 0.9, 0.4), -11];
};

// join: two-note soft chime (A5 -> D6)
cues.join = () => {
  const b = buf(1.0);
  add(b, glass(A5, 0.8, 0.6), 0, 0.6);
  add(b, glass(D6, 0.9, 0.7), 0.11, 0.6);
  return [hall(b, 0.28, 1.0, 0.6), -12];
};

// start: low bell + soft pad swell under a rising four-note chime
cues.start = () => {
  const b = buf(2.2);
  add(b, pad([D4, A4], 1.6, 0.4, 0.8), 0, 0.5);
  [A4, D5, Fs5, A5].forEach((n, i) => add(b, glass(n, 1.0, 0.75), 0.1 + i * 0.12, 0.45));
  add(b, bell(D4, 1.8, 1.5), 0.46, 0.55);
  add(b, sparkle(1.0, 12, 3000, 8000, 0.09, 0.12), 0.5);
  return [hall(b, 0.32, 1.15, 1.0), -10];
};

// victory: rising flourish resolving to a bright D major chord (glass + bells + pad + sparkles)
cues.victory = () => {
  const b = buf(3.0);
  [A4, D5, Fs5, A5].forEach((n, i) => add(b, glass(n, 0.8, 0.5), i * 0.1, 0.4));
  const hit = 0.42;
  add(b, pad([D4, Fs4, A4, D5], 2.2, 0.05, 1.2), hit, 0.75);
  [D5, Fs5, A5, D6].forEach((n) => add(b, glass(n, 2.0, 1.6), hit, 0.3));
  add(b, bell(D5, 2.4, 2.0), hit, 0.45);
  add(b, bell(D4, 2.4, 2.0), hit, 0.35);
  add(b, sparkle(1.4, 22, 3000, 9000, 0.1, 0.14), hit);
  return [hall(b, 0.35, 1.2, 1.2), -9];
};

// gameOver: gentle closing stinger (not a "fail" sound): descending chime, then a soft G -> D cadence
cues.gameOver = () => {
  const b = buf(3.0);
  [A5, Fs5, D5].forEach((n, i) => add(b, glass(n, 0.9, 0.6), i * 0.13, 0.4));
  add(b, pad([G4, B4, D5], 0.9, 0.08, 0.35), 0.4, 0.65);
  add(b, pad([D4, Fs4, A4, D5], 1.7, 0.12, 1.0), 1.1, 0.7);
  add(b, bell(D4, 2.0, 1.7), 1.1, 0.4);
  return [hall(b, 0.35, 1.2, 1.2), -10];
};

for (const [name, fn] of Object.entries(cues)) {
  const [b, target] = fn();
  wav(name, finish(b, target));
}
