// Sound effects: procedural Web Audio synthesis with drop-in asset overrides.
//
// Any sound can be replaced by an audio file: put it in public/sfx/ and list it in public/sfx/manifest.json
// as  { "<sound name>": "<file>" }.  Listed files are decoded at startup and used instead of the synth.
// Sound names: see SYNTH below (hmg_fire, autocannon_fire, laser_beam, lance_charge, lance_impact,
// orbital_laser, jet_flyby, rocket_launch, explosion, artillery_whistle, nuke_beep, nuke_launch, nuke_impact).

// Default mute: always on inside the Claude desktop app's browser pane (the automated test environment, detected by
// its user agent) and never remembered there; everywhere else the player's last choice is kept in localStorage.
const MUTE_KEY = 'hive-siege-muted';
const TEST_ENV = typeof navigator !== 'undefined' && /\bClaude\//.test(navigator.userAgent);
function initialMute() {
  if (TEST_ENV) return true;
  try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; }
}

const state = {
  ctx: null, master: null, muted: initialMute(), volume: 0.8, muteListeners: [],
  assets: {}, last: {}, playing: {}, listener: { x: 0, z: 0 },
  pending: [],
};

// ---------------------------------------------------------------- context / assets
function ensure() {
  if (state.ctx) return state.ctx;
  const ctx = state.offline ? new OfflineAudioContext(2, Math.ceil(48000 * state.offline), 48000) : new (window.AudioContext || window.webkitAudioContext)();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -12; comp.knee.value = 20; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.2;
  const master = ctx.createGain();
  master.gain.value = state.muted ? 0 : state.volume;
  master.connect(comp).connect(ctx.destination);
  state.ctx = ctx; state.master = master;
  state.assetsReady = loadAssets();
  return ctx;
}

// Strip leading silence (encoder padding and slack before the hit would make fast weapons sound late) and any
// dead air after the tail. Returns a new buffer with a 5 ms fade on the cut end.
function trimSilence(ctx, buf) {
  const n = buf.length, chs = buf.numberOfChannels;
  let peak = 0;
  for (let c = 0; c < chs; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; } }
  if (peak < 1e-4) return buf;
  let a = n, b = 0;
  for (let c = 0; c < chs; c++) {
    const d = buf.getChannelData(c);
    let i = 0; while (i < n && Math.abs(d[i]) < peak * 0.02) i++;
    let j = n - 1; while (j > i && Math.abs(d[j]) < peak * 0.004) j--;
    a = Math.min(a, i); b = Math.max(b, j);
  }
  a = Math.max(0, a - Math.round(buf.sampleRate * 0.002));
  b = Math.min(n, b + Math.round(buf.sampleRate * 0.02));
  if (a === 0 && b >= n) return buf;
  const out = ctx.createBuffer(chs, b - a, buf.sampleRate), fade = Math.min(b - a, Math.round(buf.sampleRate * 0.005));
  for (let c = 0; c < chs; c++) {
    const d = out.getChannelData(c);
    d.set(buf.getChannelData(c).subarray(a, b));
    for (let k = 0; k < fade; k++) d[d.length - 1 - k] *= k / fade;
  }
  return out;
}

async function loadAssets() {
  try {
    const base = (import.meta.env && import.meta.env.BASE_URL) || '/';
    const res = await fetch(`${base}sfx/manifest.json`);
    if (!res.ok) return;
    const manifest = await res.json();
    for (const [name, file] of Object.entries(manifest)) {
      try {
        const r = await fetch(`${base}sfx/${file}`);
        if (!r.ok) continue;
        state.assets[name] = trimSilence(state.ctx, await state.ctx.decodeAudioData(await r.arrayBuffer()));
        console.info(`[sfx] using asset for ${name}: ${file}`);
      } catch (e) { console.warn(`[sfx] could not load ${file}`, e); }
    }
  } catch { /* no manifest: all sounds synthesised */ }
}

function noiseBuffer(ctx) {
  if (state.noise) return state.noise;
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return (state.noise = buf);
}

// ---------------------------------------------------------------- synth primitives
// Every primitive schedules itself at t0 and returns the nodes so loops can stop them.
function env(ctx, node, t0, a, peak, d, hold = 0) {
  node.gain.setValueAtTime(0.0001, t0);
  node.gain.linearRampToValueAtTime(Math.max(0.0001, peak), t0 + a);
  if (hold > 0) node.gain.setValueAtTime(Math.max(0.0001, peak), t0 + a + hold);
  node.gain.exponentialRampToValueAtTime(0.0001, t0 + a + hold + d);
}
function osc(ctx, out, t0, { type = 'sine', f0 = 440, f1 = f0, dur = 0.2, gain = 0.3, a = 0.005, hold = 0, lp = 0 }) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + a + hold + dur);
  const g = ctx.createGain();
  env(ctx, g, t0, a, gain, dur, hold);
  let last = o;
  if (lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; o.connect(f); last = f; }
  last.connect(g).connect(out);
  o.start(t0); o.stop(t0 + a + hold + dur + 0.05);
  return { o, g };
}
function noise(ctx, out, t0, { dur = 0.2, type = null, f0 = 1000, f1 = f0, q = 1, gain = 0.3, a = 0.005, hold = 0 }) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx); src.loop = true;
  const g = ctx.createGain();
  env(ctx, g, t0, a, gain, dur, hold);
  let last = src;
  if (type) {
    const f = ctx.createBiquadFilter();
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t0 + a + hold + dur);
    src.connect(f); last = f;
  }
  last.connect(g).connect(out);
  src.start(t0); src.stop(t0 + a + hold + dur + 0.05);
  return { src, g };
}

// ---------------------------------------------------------------- one-shot definitions
const SYNTH = {
  hmg_fire: { min: 0.035, fn: (c, o, t) => {
    noise(c, o, t, { dur: 0.06, type: 'bandpass', f0: 2400, f1: 500, q: 0.8, gain: 0.45, a: 0.002 });
    osc(c, o, t, { type: 'square', f0: 240, f1: 70, dur: 0.04, gain: 0.22 });
  } },
  autocannon_fire: { min: 0.03, fn: (c, o, t) => {
    osc(c, o, t, { type: 'sine', f0: 170, f1: 45, dur: 0.22, gain: 0.9 });
    noise(c, o, t, { dur: 0.09, type: 'highpass', f0: 900, gain: 0.5, a: 0.002 });
    noise(c, o, t, { dur: 0.18, type: 'bandpass', f0: 380, f1: 180, q: 0.7, gain: 0.45 });
  } },
  laser_tick: { min: 0.05, fn: (c, o, t) => {
    osc(c, o, t, { type: 'sawtooth', f0: 1500, f1: 900, dur: 0.06, gain: 0.12, lp: 2500 });
  } },
  lance_charge: { fn: (c, o, t) => {
    const s = osc(c, o, t, { type: 'sine', f0: 160, f1: 1900, dur: 1.65, gain: 0.35, a: 0.2 });
    const lfo = c.createOscillator(); lfo.frequency.setValueAtTime(6, t); lfo.frequency.linearRampToValueAtTime(40, t + 1.65);
    const lg = c.createGain(); lg.gain.value = 0.5; lfo.connect(lg).connect(s.g.gain); lfo.start(t); lfo.stop(t + 1.8);
    noise(c, o, t, { dur: 1.65, type: 'bandpass', f0: 300, f1: 3500, q: 1.5, gain: 0.25, a: 0.4 });
    osc(c, o, t, { type: 'triangle', f0: 80, f1: 400, dur: 1.65, gain: 0.15, a: 0.3 });
  } },
  lance_impact: { fn: (c, o, t) => {
    osc(c, o, t, { type: 'sine', f0: 75, f1: 24, dur: 1.3, gain: 1.0 });
    noise(c, o, t, { dur: 1.7, type: 'lowpass', f0: 5000, f1: 100, gain: 0.9, a: 0.005 });
    osc(c, o, t, { type: 'triangle', f0: 1400, f1: 250, dur: 0.35, gain: 0.3 });
    osc(c, o, t, { type: 'sawtooth', f0: 52, f1: 38, dur: 0.9, gain: 0.3, lp: 160 });
    osc(c, o, t, { type: 'sine', f0: 2600, f1: 2500, dur: 1.2, gain: 0.05, a: 0.02 });
  } },
  jet_flyby: { fn: (c, o, t) => {
    noise(c, o, t, { dur: 0.3, type: 'bandpass', f0: 220, f1: 900, q: 0.6, gain: 0.65, a: 2.0 });          // approach: rising
    noise(c, o, t + 2.3, { dur: 2.4, type: 'bandpass', f0: 900, f1: 260, q: 0.6, gain: 0.65, a: 0.02 });    // pass: falling
    noise(c, o, t + 0.8, { dur: 3.2, type: 'highpass', f0: 1800, f1: 600, gain: 0.18, a: 1.2 });
    osc(c, o, t, { type: 'sawtooth', f0: 62, f1: 40, dur: 2.5, gain: 0.3, a: 1.8, lp: 220 });
    osc(c, o, t + 0.3, { type: 'sawtooth', f0: 900, f1: 380, dur: 2.6, gain: 0.05, a: 1.5, lp: 1200 });   // turbine whine with doppler drop
  } },
  rocket_launch: { min: 0.08, fn: (c, o, t) => {
    noise(c, o, t, { dur: 0.6, type: 'bandpass', f0: 1800, f1: 300, q: 0.9, gain: 0.4, a: 0.01 });
    osc(c, o, t, { type: 'sine', f0: 320, f1: 90, dur: 0.3, gain: 0.15 });
  } },
  boss_roar: { min: 0.5, fn: (c, o, t) => {                 // Colossus: guttural bellow with a shrieking overtone
    osc(c, o, t, { type: 'sawtooth', f0: 95, f1: 42, dur: 1.9, gain: 0.55, a: 0.12, lp: 420 });
    osc(c, o, t + 0.05, { type: 'square', f0: 61, f1: 33, dur: 1.8, gain: 0.3, a: 0.2, lp: 260 });
    osc(c, o, t + 0.15, { type: 'sawtooth', f0: 620, f1: 240, dur: 1.3, gain: 0.09, a: 0.3, lp: 1800 });
    noise(c, o, t, { dur: 1.8, type: 'bandpass', f0: 900, f1: 260, q: 1.2, gain: 0.35, a: 0.25 });
  } },
  boss_step: { min: 0.08, fn: (c, o, t) => {                // one spindly leg coming down
    osc(c, o, t, { type: 'sine', f0: 70, f1: 30, dur: 0.28, gain: 0.7 });
    noise(c, o, t, { dur: 0.22, type: 'lowpass', f0: 700, f1: 120, gain: 0.35 });
  } },
  hub_land: { fn: (c, o, t) => {                          // Core touchdown: ground thud, dust wash, hull clank
    osc(c, o, t, { type: 'sine', f0: 85, f1: 24, dur: 1.1, gain: 1.0 });
    noise(c, o, t, { dur: 1.6, type: 'lowpass', f0: 1400, f1: 90, gain: 0.7 });
    noise(c, o, t, { dur: 0.09, type: 'bandpass', f0: 2400, q: 2, gain: 0.3, a: 0.001 });
    osc(c, o, t + 0.02, { type: 'square', f0: 210, f1: 150, dur: 0.35, gain: 0.08, lp: 900 });
    osc(c, o, t + 0.22, { type: 'sine', f0: 60, f1: 30, dur: 0.5, gain: 0.35 });        // settle bounce
  } },
  thunder: { min: 0.4, fn: (c, o, t, p) => {               // size: 1 = right on top of you (a crack first), 0 = far off (just the roll)
    const near = p.size ?? 0.3;
    if (near > 0.5) {
      noise(c, o, t, { dur: 0.14, type: 'highpass', f0: 1200, gain: 0.55 * near, a: 0.001 });
      osc(c, o, t, { type: 'sawtooth', f0: 180, f1: 45, dur: 0.35, gain: 0.12 * near, a: 0.002, lp: 900 });
    }
    osc(c, o, t, { type: 'sine', f0: 62, f1: 28, dur: 2.4, gain: 0.34 + 0.3 * near, a: 0.04 + (1 - near) * 0.45 });
    noise(c, o, t, { dur: 3.4, type: 'lowpass', f0: 380 + near * 1600, f1: 80, gain: 0.5, a: 0.02 + (1 - near) * 0.5 });
    noise(c, o, t + 0.7 + Math.random() * 0.8, { dur: 2.6, type: 'lowpass', f0: 280, f1: 60, gain: 0.32, a: 0.25 });   // the second roll
  } },
  bh_open: { min: 0.3, fn: (c, o, t) => {                  // singularity opening: an implosive suck, then a deep settling boom
    noise(c, o, t, { dur: 0.08, type: 'bandpass', f0: 240, f1: 3200, q: 1.4, gain: 0.35, a: 0.55 });
    osc(c, o, t, { type: 'sine', f0: 140, f1: 900, dur: 0.05, gain: 0.12, a: 0.55 });
    osc(c, o, t + 0.6, { type: 'sine', f0: 120, f1: 30, dur: 0.9, gain: 0.7, a: 0.004 });
    noise(c, o, t + 0.6, { dur: 0.5, type: 'lowpass', f0: 900, f1: 120, gain: 0.35, a: 0.003 });
  } },
  bh_consume: { min: 0.05, fn: (c, o, t) => {              // a bug crushed at the horizon: a short zap and squelch
    osc(c, o, t, { type: 'square', f0: 700, f1: 160, dur: 0.07, gain: 0.08, a: 0.002, lp: 1600 });
    osc(c, o, t, { type: 'sine', f0: 320, f1: 50, dur: 0.11, gain: 0.22, a: 0.002 });
    noise(c, o, t, { dur: 0.06, type: 'lowpass', f0: 1200, f1: 300, gain: 0.12, a: 0.002 });
  } },
  bh_burst: { min: 0.3, fn: (c, o, t) => {                 // collapse: a crack, a deep boom and a ringing sweep outward
    noise(c, o, t, { dur: 0.05, type: 'highpass', f0: 1800, gain: 0.5, a: 0.001 });
    osc(c, o, t, { type: 'sine', f0: 95, f1: 30, dur: 0.75, gain: 0.85, a: 0.003 });
    noise(c, o, t, { dur: 0.6, type: 'lowpass', f0: 2600, f1: 160, gain: 0.55, a: 0.003 });
    osc(c, o, t + 0.02, { type: 'sawtooth', f0: 260, f1: 70, dur: 0.35, gain: 0.08, a: 0.01, lp: 900 });
    osc(c, o, t + 0.05, { type: 'sine', f0: 480, f1: 1900, dur: 0.5, gain: 0.05, a: 0.02 });
  } },
  acid_spit: { min: 0.06, fn: (c, o, t) => {              // the spitter's cannon: a soft, throaty gulp and thwop
    osc(c, o, t, { type: 'sine', f0: 150, f1: 62, dur: 0.14, gain: 0.4, a: 0.005 });
    osc(c, o, t, { type: 'triangle', f0: 340, f1: 140, dur: 0.07, gain: 0.07, a: 0.004, lp: 900 });
    noise(c, o, t + 0.01, { dur: 0.12, type: 'bandpass', f0: 520, f1: 240, q: 1.2, gain: 0.2, a: 0.005 });
  } },
  acid_hit: { min: 0.06, fn: (c, o, t) => {               // splat, then a short, low hiss as it eats in (kept dull: it repeats a lot)
    noise(c, o, t, { dur: 0.08, type: 'lowpass', f0: 1100, f1: 260, gain: 0.26, a: 0.003 });
    osc(c, o, t, { type: 'sine', f0: 190, f1: 90, dur: 0.06, gain: 0.12, a: 0.003 });
    noise(c, o, t + 0.04, { dur: 0.55, type: 'bandpass', f0: 1700, f1: 1300, q: 0.9, gain: 0.05, a: 0.06 });
  } },
  bug_pop: { min: 0.035, fn: (c, o, t, p) => {             // a bug bursting: a round, wet pop. Every one lands on a slightly
    // different note (so a stream of kills ripples like bubble wrap) and bigger bugs pop lower and fatter.
    const s = p.size ?? 1, f = (380 + Math.random() * 170) / Math.sqrt(s);
    osc(c, o, t, { type: 'sine', f0: f, f1: f * 0.27, dur: 0.075 * Math.sqrt(s), gain: 0.55, a: 0.002 });
    osc(c, o, t, { type: 'triangle', f0: f * 1.5, f1: f * 0.5, dur: 0.04, gain: 0.12, a: 0.002, lp: 1400 });   // the snap at the front
    noise(c, o, t + 0.008, { dur: 0.06 * s, type: 'lowpass', f0: 1000, f1: 280, gain: 0.13, a: 0.004 });        // the splat behind it
  } },
  explosion: { min: 0.04, fn: (c, o, t, p) => {
    const s = p.size ?? 1;
    osc(c, o, t, { type: 'sine', f0: 110 / Math.sqrt(s), f1: 28, dur: 0.5 * s, gain: 0.8 });
    noise(c, o, t, { dur: 0.9 * s, type: 'lowpass', f0: 3500, f1: 140, gain: 0.7 });
    noise(c, o, t, { dur: 0.06, type: 'highpass', f0: 2000, gain: 0.35, a: 0.001 });
  } },
  artillery_whistle: { min: 0.12, fn: (c, o, t) => {
    osc(c, o, t, { type: 'sine', f0: 2600, f1: 550, dur: 1.0, gain: 0.16, a: 0.15, hold: 0 });
    noise(c, o, t, { dur: 1.0, type: 'bandpass', f0: 2600, f1: 600, q: 6, gain: 0.12, a: 0.2 });
  } },
  apoc_fire: { min: 0.5, fn: (c, o, t) => {               // the Apocalypse gun: a sharp crack over a huge, slow-rolling boom
    noise(c, o, t, { dur: 0.07, type: 'highpass', f0: 1800, gain: 0.9, a: 0.001 });
    osc(c, o, t, { type: 'sine', f0: 70, f1: 22, dur: 1.6, gain: 1.0, a: 0.004 });
    osc(c, o, t, { type: 'triangle', f0: 140, f1: 40, dur: 0.6, gain: 0.35, a: 0.004, lp: 700 });
    noise(c, o, t, { dur: 2.2, type: 'lowpass', f0: 2400, f1: 90, gain: 0.8, a: 0.004 });
    noise(c, o, t + 0.25, { dur: 2.5, type: 'lowpass', f0: 500, f1: 80, gain: 0.3, a: 0.4 });   // echo off the mountains
  } },
  apoc_load: { min: 0.2, fn: (c, o, t) => {               // hoist / rammer: a hydraulic push ending in a heavy clank
    osc(c, o, t, { type: 'triangle', f0: 80, f1: 110, dur: 0.5, gain: 0.12, a: 0.15, lp: 500 });
    osc(c, o, t + 0.45, { type: 'square', f0: 150, f1: 90, dur: 0.12, gain: 0.14, a: 0.003, lp: 900 });
    noise(c, o, t + 0.45, { dur: 0.15, type: 'bandpass', f0: 900, q: 2, gain: 0.2, a: 0.002 });
  } },
  apoc_eject: { min: 0.1, fn: (c, o, t) => {              // the spent case hitting metal or dirt: a hollow brass clang
    osc(c, o, t, { type: 'triangle', f0: 620, f1: 560, dur: 0.35, gain: 0.12, a: 0.002 });
    osc(c, o, t, { type: 'sine', f0: 1480, f1: 1400, dur: 0.25, gain: 0.05, a: 0.002 });
    noise(c, o, t, { dur: 0.05, type: 'bandpass', f0: 2000, q: 1.5, gain: 0.18, a: 0.001 });
  } },
  mortar_fire: { min: 0.05, fn: (c, o, t) => {
    osc(c, o, t, { type: 'sine', f0: 95, f1: 38, dur: 0.35, gain: 0.9 });
    noise(c, o, t, { dur: 0.3, type: 'lowpass', f0: 900, f1: 200, gain: 0.6, a: 0.003 });
    osc(c, o, t, { type: 'triangle', f0: 400, f1: 120, dur: 0.08, gain: 0.25 });
  } },
  missile_launch: { min: 0.05, voices: 1, len: 0.9, fn: (c, o, t) => {      // a salvo overlaps six: only one at once
    noise(c, o, t, { dur: 0.9, type: 'bandpass', f0: 1400, f1: 240, q: 0.8, gain: 0.45, a: 0.02 });
    osc(c, o, t, { type: 'sawtooth', f0: 260, f1: 70, dur: 0.5, gain: 0.12, lp: 900 });
  } },
  air_raid: { min: 2, fn: (c, o, t) => {                   // strategic launch warning: two slow siren wails
    for (let k = 0; k < 2; k++) {
      const at = t + k * 3.2;
      for (const [f, g] of [[1, 0.13], [1.5, 0.05]]) {
        osc(c, o, at, { type: 'sawtooth', f0: 290 * f, f1: 640 * f, dur: 0.05, gain: g, a: 1.5, lp: 1800 });
        osc(c, o, at + 1.5, { type: 'sawtooth', f0: 640 * f, f1: 300 * f, dur: 1.6, gain: g, a: 0.03, lp: 1800 });
      }
    }
  } },
  silo_servo: { min: 0.12, fn: (c, o, t) => {                        // elevator drive, kept in the background: a soft mid-low motor hum that
    // eases in and out over some rumble, with a muffled release at the start and a gentle stop at the end. No whine, no grit.
    const run = { a: 0.5, hold: 0.8, dur: 0.8 };
    osc(c, o, t, { type: 'sine', f0: 62, f1: 56, gain: 0.16, ...run });
    osc(c, o, t, { type: 'triangle', f0: 84, f1: 92, gain: 0.12, lp: 420, ...run });
    osc(c, o, t, { type: 'sawtooth', f0: 126.5, f1: 138, gain: 0.025, lp: 480, ...run });          // a fifth up, slightly off: slow beating
    noise(c, o, t, { type: 'lowpass', f0: 420, f1: 300, gain: 0.09, ...run });
    osc(c, o, t, { type: 'sine', f0: 100, f1: 52, dur: 0.16, gain: 0.16, a: 0.01 });               // brakes off
    osc(c, o, t + 1.85, { type: 'sine', f0: 86, f1: 46, dur: 0.22, gain: 0.13, a: 0.01 });         // platform seats
  } },
  // Blast doors, in the same soft, low voice as the elevator: nothing buzzy or ringing, just weight.
  blast_door: { min: 0.12, fn: (c, o, t) => {                        // doors meeting: a muffled heavy thump
    osc(c, o, t, { type: 'sine', f0: 82, f1: 40, dur: 0.42, gain: 0.4, a: 0.004 });
    osc(c, o, t, { type: 'triangle', f0: 124, f1: 70, dur: 0.26, gain: 0.11, a: 0.004, lp: 400 });
    noise(c, o, t, { dur: 0.24, type: 'lowpass', f0: 480, f1: 160, gain: 0.18, a: 0.003 });
  } },
  silo_doors: { min: 0.12, fn: (c, o, t) => {                        // doors swinging open: a release thud, then a short hydraulic hum
    osc(c, o, t, { type: 'sine', f0: 92, f1: 50, dur: 0.16, gain: 0.14, a: 0.008 });
    osc(c, o, t + 0.05, { type: 'triangle', f0: 72, f1: 86, dur: 0.4, gain: 0.1, a: 0.22, hold: 0.25, lp: 380 });
    noise(c, o, t + 0.05, { dur: 0.4, type: 'lowpass', f0: 380, f1: 260, gain: 0.06, a: 0.22, hold: 0.25 });
  } },
  silo_hatch: { fn: (c, o, t) => {
    osc(c, o, t, { type: 'sawtooth', f0: 110, f1: 95, dur: 0.8, gain: 0.12, a: 0.05, lp: 600 });
    noise(c, o, t, { dur: 0.8, type: 'bandpass', f0: 700, q: 2, gain: 0.08, a: 0.1 });
    osc(c, o, t + 0.8, { type: 'square', f0: 180, dur: 0.05, gain: 0.1, lp: 800 });
  } },
  railgun_charge: { fn: (c, o, t, p) => {                  // p.charge: seconds to full (Supercapacitors shorten it)
    const k = (p.charge ?? 3) / 3;
    osc(c, o, t, { type: 'sawtooth', f0: 70, f1: 950, dur: 2.9 * k, gain: 0.22, a: 0.3 * k, lp: 1800 });
    osc(c, o, t, { type: 'sine', f0: 140, f1: 1900, dur: 2.9 * k, gain: 0.12, a: 0.5 * k });
    noise(c, o, t + 1.2 * k, { dur: 1.7 * k, type: 'bandpass', f0: 1200, f1: 5000, q: 3, gain: 0.12, a: 0.8 * k });
  } },
  railgun_fire: { fn: (c, o, t) => {
    noise(c, o, t, { dur: 0.05, type: 'highpass', f0: 2500, gain: 0.9, a: 0.001 });
    osc(c, o, t, { type: 'sine', f0: 130, f1: 30, dur: 0.7, gain: 0.9 });
    osc(c, o, t, { type: 'triangle', f0: 2200, f1: 700, dur: 0.45, gain: 0.25 });
    noise(c, o, t, { dur: 0.6, type: 'lowpass', f0: 3000, f1: 200, gain: 0.5 });
    osc(c, o, t, { type: 'sine', f0: 4200, f1: 4000, dur: 1.4, gain: 0.04, a: 0.01 });
  } },
  nuke_beep: { fn: (c, o, t, p) => {
    osc(c, o, t, { type: 'square', f0: p.hi ? 1600 : 1100, dur: 0.08, gain: 0.16, a: 0.003, lp: 3000 });
    if (p.hi) osc(c, o, t + 0.14, { type: 'square', f0: 1600, dur: 0.08, gain: 0.16, a: 0.003, lp: 3000 });
  } },
  nuke_launch: { fn: (c, o, t) => {
    noise(c, o, t, { dur: 1.6, type: 'lowpass', f0: 600, f1: 300, gain: 0.7, a: 1.0 });
    osc(c, o, t, { type: 'sawtooth', f0: 38, f1: 30, dur: 1.6, gain: 0.35, a: 0.8, lp: 140 });
  } },
  archangel_charge: { fn: (c, o, t) => {                   // ~9.5 s: a choir-like rising drone with a building hiss
    osc(c, o, t, { type: 'sawtooth', f0: 55, f1: 196, a: 9.3, dur: 0.3, gain: 0.4, lp: 900 });          // long attack = a swell
    osc(c, o, t, { type: 'sawtooth', f0: 82.5, f1: 294, a: 9.3, dur: 0.3, gain: 0.26, lp: 1200 });
    osc(c, o, t + 1, { type: 'sine', f0: 220, f1: 784, a: 8.3, dur: 0.3, gain: 0.2 });
    osc(c, o, t + 3, { type: 'sine', f0: 440, f1: 1568, a: 6.3, dur: 0.3, gain: 0.1 });
    noise(c, o, t, { a: 9.3, dur: 0.3, type: 'bandpass', f0: 500, f1: 5200, q: 1.4, gain: 0.4 });
  } },
  nuke_rumble: { fn: (c, o, t) => {                        // the long rolling boom after the crack, with two echoes off the hills
    osc(c, o, t + 0.05, { type: 'sine', f0: 44, f1: 19, dur: 6.5, gain: 1.0, a: 0.04 });
    osc(c, o, t + 0.1, { type: 'triangle', f0: 72, f1: 28, dur: 4.2, gain: 0.55, a: 0.05 });
    noise(c, o, t + 0.05, { dur: 7.5, type: 'lowpass', f0: 900, f1: 38, gain: 0.85, a: 0.08 });
    for (const [dl, gn] of [[1.1, 0.7], [2.3, 0.5], [3.8, 0.32]]) {
      osc(c, o, t + dl, { type: 'sine', f0: 58, f1: 22, dur: 1.6, gain: gn, a: 0.02 });
      noise(c, o, t + dl, { dur: 1.9, type: 'lowpass', f0: 1400, f1: 60, gain: gn * 0.7, a: 0.02 });
    }
  } },
  nuke_impact: { fn: (c, o, t) => {
    noise(c, o, t, { dur: 0.35, gain: 1.0, a: 0.002 });
    noise(c, o, t, { dur: 4.5, type: 'lowpass', f0: 7000, f1: 45, gain: 0.9, a: 0.01 });
    osc(c, o, t, { type: 'sine', f0: 50, f1: 16, dur: 3.8, gain: 1.0 });
    osc(c, o, t, { type: 'sine', f0: 3400, f1: 3300, dur: 3.2, gain: 0.07, a: 0.05 });       // ringing ears
    osc(c, o, t + 0.4, { type: 'sawtooth', f0: 30, f1: 22, dur: 5, gain: 0.3, a: 0.5, lp: 110 });
  } },
};

// ---------------------------------------------------------------- loop definitions (return stop())
const LOOPS = {
  laser_beam: (c, out) => {
    const g = c.createGain(); g.gain.value = 0; g.connect(out);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1100; f.connect(g);
    const o1 = c.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 190; o1.connect(f);
    const o2 = c.createOscillator(); o2.type = 'sine'; o2.frequency.value = 380; const g2 = c.createGain(); g2.gain.value = 0.4; o2.connect(g2).connect(f);
    const lfo = c.createOscillator(); lfo.frequency.value = 7; const lg = c.createGain(); lg.gain.value = 9; lfo.connect(lg).connect(o1.frequency);
    const n = c.createBufferSource(); n.buffer = noiseBuffer(c); n.loop = true;
    const nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 4200; nf.Q.value = 3;
    const ng = c.createGain(); ng.gain.value = 0.15; n.connect(nf).connect(ng).connect(g);
    const nodes = [o1, o2, lfo, n];
    nodes.forEach((x) => x.start());
    return { gain: g, level: 0.22, nodes };
  },
  orbital_laser: (c, out) => {
    const g = c.createGain(); g.gain.value = 0; g.connect(out);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 750; f.connect(g);
    const o1 = c.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 95; o1.connect(f);
    const o2 = c.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = 97.5; o2.connect(f);
    const o3 = c.createOscillator(); o3.type = 'sine'; o3.frequency.value = 190; const g3 = c.createGain(); g3.gain.value = 0.3; o3.connect(g3).connect(f);
    const n = c.createBufferSource(); n.buffer = noiseBuffer(c); n.loop = true;
    const nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 2600; nf.Q.value = 2;
    const ng = c.createGain(); ng.gain.value = 0.12;
    const am = c.createOscillator(); am.frequency.value = 38; const amg = c.createGain(); amg.gain.value = 0.1; am.connect(amg).connect(ng.gain);
    n.connect(nf).connect(ng).connect(g);
    const nodes = [o1, o2, o3, n, am];
    nodes.forEach((x) => x.start());
    return { gain: g, level: 0.4, nodes };
  },
};

// Core descent engines: sub rumble, broadband roar and a crackle riding on top.
LOOPS.hub_thruster = (c, out) => {
  const g = c.createGain(); g.gain.value = 0; g.connect(out);
  const n = c.createBufferSource(); n.buffer = noiseBuffer(c); n.loop = true;
  const low = c.createBiquadFilter(); low.type = 'lowpass'; low.frequency.value = 260;
  const lowG = c.createGain(); lowG.gain.value = 1.0; n.connect(low).connect(lowG).connect(g);
  const mid = c.createBiquadFilter(); mid.type = 'bandpass'; mid.frequency.value = 900; mid.Q.value = 0.6;
  const midG = c.createGain(); midG.gain.value = 0.35; n.connect(mid).connect(midG).connect(g);
  const hi = c.createBiquadFilter(); hi.type = 'highpass'; hi.frequency.value = 3200;
  const hiG = c.createGain(); hiG.gain.value = 0.06; n.connect(hi).connect(hiG).connect(g);
  const sub = c.createOscillator(); sub.type = 'sawtooth'; sub.frequency.value = 46;
  const subF = c.createBiquadFilter(); subF.type = 'lowpass'; subF.frequency.value = 120;
  const subG = c.createGain(); subG.gain.value = 0.35; sub.connect(subF).connect(subG).connect(g);
  const am1 = c.createOscillator(); am1.frequency.value = 23; const a1 = c.createGain(); a1.gain.value = 0.18; am1.connect(a1).connect(midG.gain);
  const am2 = c.createOscillator(); am2.frequency.value = 3.1; const a2 = c.createGain(); a2.gain.value = 0.2; am2.connect(a2).connect(lowG.gain);
  const nodes = [n, sub, am1, am2];
  nodes.forEach((x) => x.start());
  return { gain: g, level: 0.5, nodes };
};

// Airship: slow, heavy propeller drone with a beating sub and a little wind.
LOOPS.airship_engine = (c, out) => {
  const g = c.createGain(); g.gain.value = 0; g.connect(out);
  const nodes = [];
  for (const [f, gn] of [[41, 0.5], [43.5, 0.4], [82, 0.16]]) {
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 240;
    const og = c.createGain(); og.gain.value = gn; o.connect(lp).connect(og).connect(g); nodes.push(o);
  }
  const n = c.createBufferSource(); n.buffer = noiseBuffer(c); n.loop = true;
  const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = 0.8;
  const ng = c.createGain(); ng.gain.value = 0.22;
  const lfo = c.createOscillator(); lfo.frequency.value = 11; const lg = c.createGain(); lg.gain.value = 0.12; lfo.connect(lg).connect(ng.gain);
  n.connect(bp).connect(ng).connect(g); nodes.push(n, lfo);
  nodes.forEach((x) => x.start());
  return { gain: g, level: 0.4, nodes };
};

// Rain: a wide hiss with a softer body under it and a slow swell, like a downpour on open ground.
LOOPS.rain = (c, out) => {
  const g = c.createGain(); g.gain.value = 0; g.connect(out);
  const nodes = [];
  const src = (rate) => { const n = c.createBufferSource(); n.buffer = noiseBuffer(c); n.loop = true; n.playbackRate.value = rate; nodes.push(n); return n; };
  const band = (input, type, f, q, gain) => { const b = c.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; const bg = c.createGain(); bg.gain.value = gain; input.connect(b).connect(bg).connect(g); return bg; };
  band(src(1), 'bandpass', 2600, 0.45, 0.55);                    // the hiss
  band(src(0.83), 'lowpass', 650, 0.7, 0.4);                     // the body
  const patter = band(src(1.17), 'bandpass', 5200, 1.2, 0.12);   // fine patter on top
  const lfo = c.createOscillator(); lfo.frequency.value = 0.11; const lg = c.createGain(); lg.gain.value = 0.1; lfo.connect(lg).connect(g.gain); nodes.push(lfo);
  const lfo2 = c.createOscillator(); lfo2.frequency.value = 7.3; const lg2 = c.createGain(); lg2.gain.value = 0.05; lfo2.connect(lg2).connect(patter.gain); nodes.push(lfo2);
  nodes.forEach((x) => x.start());
  return { gain: g, level: 0.4, nodes };
};

// Black hole: a deep uneasy drone with a slow throb and a thin high whistle riding on top.
LOOPS.blackhole_hum = (c, out) => {
  const g = c.createGain(); g.gain.value = 0; g.connect(out);
  const nodes = [];
  for (const [f, gn, type] of [[38, 0.5, 'sine'], [57.5, 0.22, 'sawtooth'], [76, 0.12, 'sine']]) {
    const o = c.createOscillator(); o.type = type; o.frequency.value = f;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220;
    const og = c.createGain(); og.gain.value = gn; o.connect(lp).connect(og).connect(g); nodes.push(o);
  }
  const hi = c.createOscillator(); hi.type = 'sine'; hi.frequency.value = 1860;
  const hg = c.createGain(); hg.gain.value = 0.012; hi.connect(hg).connect(g); nodes.push(hi);
  const n = c.createBufferSource(); n.buffer = noiseBuffer(c); n.loop = true;
  const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 1.2;
  const ng = c.createGain(); ng.gain.value = 0.08; n.connect(bp).connect(ng).connect(g); nodes.push(n);
  const lfo = c.createOscillator(); lfo.frequency.value = 0.9; const lg = c.createGain(); lg.gain.value = 0.14; lfo.connect(lg).connect(g.gain); nodes.push(lfo);
  const lfo2 = c.createOscillator(); lfo2.frequency.value = 6; const lg2 = c.createGain(); lg2.gain.value = 300; lfo2.connect(lg2).connect(bp.frequency); nodes.push(lfo2);
  nodes.forEach((x) => x.start());
  return { gain: g, level: 0.5, nodes };
};

// VTOL gunship: twin lift jets, a broadband roar under a steady turbine whine with a slow beat between the engines.
LOOPS.vtol_jet = (c, out) => {
  const g = c.createGain(); g.gain.value = 0; g.connect(out);
  const n = c.createBufferSource(); n.buffer = noiseBuffer(c); n.loop = true;
  const low = c.createBiquadFilter(); low.type = 'lowpass'; low.frequency.value = 340; const lowG = c.createGain(); lowG.gain.value = 0.8; n.connect(low).connect(lowG).connect(g);
  const hiss = c.createBiquadFilter(); hiss.type = 'bandpass'; hiss.frequency.value = 2600; hiss.Q.value = 0.7; const hissG = c.createGain(); hissG.gain.value = 0.16; n.connect(hiss).connect(hissG).connect(g);
  const nodes = [n];
  for (const f of [880, 893]) {
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 8;
    const og = c.createGain(); og.gain.value = 0.03; o.connect(bp).connect(og).connect(g);
    nodes.push(o);
  }
  const lfo = c.createOscillator(); lfo.frequency.value = 5.5; const lg = c.createGain(); lg.gain.value = 0.12; lfo.connect(lg).connect(lowG.gain); nodes.push(lfo);
  nodes.forEach((x) => x.start());
  return { gain: g, level: 0.42, nodes };
};

// Helicopter: blade slap (noise gated at the blade-pass rate) over a turbine whine.
LOOPS.heli_rotor = (c, out) => {
  const g = c.createGain(); g.gain.value = 0; g.connect(out);
  const n = c.createBufferSource(); n.buffer = noiseBuffer(c); n.loop = true;
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520;
  const chop = c.createGain(); chop.gain.value = 0.5;
  const lfo = c.createOscillator(); lfo.type = 'sawtooth'; lfo.frequency.value = 19; const lg = c.createGain(); lg.gain.value = 0.5; lfo.connect(lg).connect(chop.gain);
  n.connect(lp).connect(chop).connect(g);
  const thump = c.createOscillator(); thump.type = 'sine'; thump.frequency.value = 57; const tg = c.createGain(); tg.gain.value = 0.0;
  const lg2 = c.createGain(); lg2.gain.value = 0.35; lfo.connect(lg2).connect(tg.gain); thump.connect(tg).connect(g);
  const whine = c.createOscillator(); whine.type = 'sawtooth'; whine.frequency.value = 1450;
  const wf = c.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 1500; wf.Q.value = 6;
  const wg = c.createGain(); wg.gain.value = 0.035; whine.connect(wf).connect(wg).connect(g);
  const nodes = [n, lfo, thump, whine];
  nodes.forEach((x) => x.start());
  return { gain: g, level: 0.45, nodes };
};

LOOPS.flame_loop = (c, out) => {
  const g = c.createGain(); g.gain.value = 0; g.connect(out);
  const n = c.createBufferSource(); n.buffer = noiseBuffer(c); n.loop = true;
  const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 520; bp.Q.value = 0.5;
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
  const flutter = c.createOscillator(); flutter.type = 'sine'; flutter.frequency.value = 11;
  const fg = c.createGain(); fg.gain.value = 180; flutter.connect(fg).connect(bp.frequency);
  const n2 = c.createBufferSource(); n2.buffer = noiseBuffer(c); n2.loop = true;
  const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3000;
  const hg = c.createGain(); hg.gain.value = 0.12;
  n.connect(bp).connect(lp).connect(g);
  n2.connect(hp).connect(hg).connect(g);
  const nodes = [n, n2, flutter];
  nodes.forEach((x) => x.start());
  return { gain: g, level: 0.5, nodes };
};

// ---------------------------------------------------------------- public API
function spatial(p) {
  if (!p || p.x === undefined) return 1;
  const d = Math.hypot(p.x - state.listener.x, p.z - state.listener.z);
  return 1 / (1 + (d / 38) ** 2);
}

export const audio = {
  // Renders every synth into an OfflineAudioContext; returns names that threw. Used by the dev checks.
  async selfTest() {
    const bad = [];
    for (const [name, def] of Object.entries(SYNTH)) {
      try {
        const oc = new OfflineAudioContext(1, 44100, 44100);
        state.noise = null;
        def.fn(oc, oc.destination, 0, { size: 1, hi: true });
        await oc.startRendering();
      } catch (e) { bad.push(`${name}: ${e.message}`); }
    }
    for (const [name, mk] of Object.entries(LOOPS)) {
      try { const oc = new OfflineAudioContext(1, 4410, 44100); state.noise = null; const h = mk(oc, oc.destination); h.nodes.forEach((n) => n.stop(0.05)); await oc.startRendering(); }
      catch (e) { bad.push(`${name}: ${e.message}`); }
    }
    state.noise = null;
    return { bad, sounds: Object.keys(SYNTH).length + Object.keys(LOOPS).length };
  },
  status() { return { ctx: state.ctx ? state.ctx.state : 'none', assets: Object.keys(state.assets), muted: state.muted }; },
  init({ getListener }) {
    state.getListener = getListener;
    const unlock = () => {
      const ctx = ensure();
      if (ctx.state === 'suspended') ctx.resume();
    };
    addEventListener('pointerdown', unlock);
    addEventListener('keydown', unlock);
    try { unlock(); } catch { /* stays locked until the first gesture */ }   // usually allowed right after the title-screen click
    addEventListener('keydown', (e) => { if (e.code === 'KeyM') audio.toggleMute(); });
  },
  update() {
    if (state.getListener) { const l = state.getListener(); state.listener.x = l.x; state.listener.z = l.z; }
  },
  toggleMute() {
    state.muted = !state.muted;
    if (state.master) state.master.gain.setTargetAtTime(state.muted ? 0 : state.volume, state.ctx.currentTime, 0.02);
    if (!TEST_ENV) { try { localStorage.setItem(MUTE_KEY, state.muted ? '1' : '0'); } catch { /* fine */ } }
    for (const f of state.muteListeners) f(state.muted);
    return state.muted;
  },
  isMuted: () => state.muted,
  onMute(f) { state.muteListeners.push(f); f(state.muted); },
  setVolume(v) {
    state.volume = Math.min(1, Math.max(0, v));
    if (state.master && !state.muted) state.master.gain.setTargetAtTime(state.volume, state.ctx.currentTime, 0.02);
  },
  // One-shot. p: { x, z, vol, delay, size, hi, force, rate, dur } (force skips the per-sound
  // rate limit; rate and dur only apply when an asset file replaces the synth). A sound with `voices` never has more
  // than that many copies playing: further calls are dropped until one ends (`len` is the synth's length).
  // Video capture (record.js): all sound goes into an OfflineAudioContext that is stepped in lockstep with the sim.
  async beginOffline(seconds, { skip = [], listener } = {}) {
    state.offline = seconds;
    state.muted = false;
    state.skip = new Set(skip);
    state.paused = true;                                   // silent until record.js starts the take
    if (listener) state.listener = listener;
    const ctx = ensure();
    await state.assetsReady;
    return ctx;
  },
  setPaused(v) { state.paused = v; },
  play(name, p = {}) {
    const ctx = state.ctx;
    if (!ctx || (!state.offline && ctx.state !== 'running')) return;
    if (state.paused || state.skip?.has(name)) return;
    const def = SYNTH[name];
    if (!def) return;
    const now = ctx.currentTime;
    if (!p.force && def.min && state.last[name] && now - state.last[name] < def.min) return;
    const asset = state.assets[name];
    const t0 = now + (p.delay ?? 0);
    if (def.voices) {
      const ends = (state.playing[name] ??= []).filter((t) => t > now);
      if (ends.length >= def.voices) return;
      ends.push(t0 + (asset ? p.dur ?? asset.duration / (p.rate ?? 1) : def.len ?? 1));
      state.playing[name] = ends;
    }
    state.last[name] = now;
    const g = ctx.createGain();
    g.gain.value = (p.vol ?? 1) * spatial(p);
    g.connect(state.master);
    if (asset) {
      const src = ctx.createBufferSource();
      src.buffer = asset;
      if (p.rate) src.playbackRate.value = p.rate;
      src.connect(g);
      src.start(t0);
      if (p.dur) {                                           // play only the first p.dur seconds, faded out
        g.gain.setValueAtTime(g.gain.value, t0 + Math.max(0, p.dur - 0.04));
        g.gain.linearRampToValueAtTime(0, t0 + p.dur);
        src.stop(t0 + p.dur + 0.01);
      }
    } else {
      def.fn(ctx, g, t0, p);
    }
  },
  // Sustained sound. Returns a handle with setPos() and stop().
  loop(name, p = {}) {
    const ctx = state.ctx;
    if (!ctx || (!state.offline && ctx.state !== 'running')) return null;
    if (state.paused || state.skip?.has(name)) return null;
    const asset = state.assets[name];
    let h;
    if (asset) {
      const g = ctx.createGain(); g.gain.value = 0; g.connect(state.master);
      const src = ctx.createBufferSource(); src.buffer = asset; src.loop = true; src.connect(g); src.start();
      h = { gain: g, level: 1, nodes: [src] };
    } else if (LOOPS[name]) {
      const out = ctx.createGain(); out.connect(state.master);
      h = LOOPS[name](ctx, out);
      h.out = out;
    } else return null;
    const base = (p.vol ?? 1) * h.level;
    h.gain.gain.setTargetAtTime(base * spatial(p), ctx.currentTime, 0.08);
    return {
      setVol(v) { h.gain.gain.setTargetAtTime(base * v, ctx.currentTime, 0.08); },
      setPos(x, z) { h.gain.gain.setTargetAtTime(base * spatial({ x, z }), ctx.currentTime, 0.1); },
      stop() {
        h.gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.06);
        const t = ctx.currentTime + 0.4;
        for (const n of h.nodes) { try { n.stop(t); } catch { /* already stopped */ } }
      },
    };
  },
};
