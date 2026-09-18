// Sound effects: procedural Web Audio synthesis with drop-in asset overrides.
//
// Any sound can be replaced by an audio file: put it in public/sfx/ and list it in public/sfx/manifest.json
// as  { "<sound name>": "<file>" }.  Listed files are decoded at startup and used instead of the synth.
// Sound names: see SYNTH below (hmg_fire, autocannon_fire, laser_beam, lance_charge, lance_impact,
// orbital_laser, jet_flyby, rocket_launch, explosion, artillery_whistle, nuke_beep, nuke_launch, nuke_impact).

const state = {
  ctx: null, master: null, muted: false, volume: 0.8,
  assets: {}, last: {}, listener: { x: 0, z: 0 },
  pending: [],
};

// ---------------------------------------------------------------- context / assets
function ensure() {
  if (state.ctx) return state.ctx;
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -12; comp.knee.value = 20; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.2;
  const master = ctx.createGain();
  master.gain.value = state.muted ? 0 : state.volume;
  master.connect(comp).connect(ctx.destination);
  state.ctx = ctx; state.master = master;
  loadAssets();
  return ctx;
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
        state.assets[name] = await state.ctx.decodeAudioData(await r.arrayBuffer());
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
  mortar_fire: { min: 0.05, fn: (c, o, t) => {
    osc(c, o, t, { type: 'sine', f0: 95, f1: 38, dur: 0.35, gain: 0.9 });
    noise(c, o, t, { dur: 0.3, type: 'lowpass', f0: 900, f1: 200, gain: 0.6, a: 0.003 });
    osc(c, o, t, { type: 'triangle', f0: 400, f1: 120, dur: 0.08, gain: 0.25 });
  } },
  missile_launch: { min: 0.05, fn: (c, o, t) => {
    noise(c, o, t, { dur: 0.9, type: 'bandpass', f0: 1400, f1: 240, q: 0.8, gain: 0.45, a: 0.02 });
    osc(c, o, t, { type: 'sawtooth', f0: 260, f1: 70, dur: 0.5, gain: 0.12, lp: 900 });
  } },
  silo_hatch: { fn: (c, o, t) => {
    osc(c, o, t, { type: 'sawtooth', f0: 110, f1: 95, dur: 0.8, gain: 0.12, a: 0.05, lp: 600 });
    noise(c, o, t, { dur: 0.8, type: 'bandpass', f0: 700, q: 2, gain: 0.08, a: 0.1 });
    osc(c, o, t + 0.8, { type: 'square', f0: 180, dur: 0.05, gain: 0.1, lp: 800 });
  } },
  railgun_charge: { fn: (c, o, t) => {
    osc(c, o, t, { type: 'sawtooth', f0: 70, f1: 950, dur: 2.9, gain: 0.22, a: 0.3, lp: 1800 });
    osc(c, o, t, { type: 'sine', f0: 140, f1: 1900, dur: 2.9, gain: 0.12, a: 0.5 });
    noise(c, o, t + 1.2, { dur: 1.7, type: 'bandpass', f0: 1200, f1: 5000, q: 3, gain: 0.12, a: 0.8 });
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
    addEventListener('keydown', (e) => { if (e.code === 'KeyM') audio.toggleMute(); });
  },
  update() {
    if (state.getListener) { const l = state.getListener(); state.listener.x = l.x; state.listener.z = l.z; }
  },
  toggleMute() {
    state.muted = !state.muted;
    if (state.master) state.master.gain.setTargetAtTime(state.muted ? 0 : state.volume, state.ctx.currentTime, 0.02);
    return state.muted;
  },
  setVolume(v) {
    state.volume = Math.min(1, Math.max(0, v));
    if (state.master && !state.muted) state.master.gain.setTargetAtTime(state.volume, state.ctx.currentTime, 0.02);
  },
  // One-shot. p: { x, z, vol, delay, size, hi }
  play(name, p = {}) {
    const ctx = state.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const def = SYNTH[name];
    if (!def) return;
    const now = ctx.currentTime;
    if (def.min && state.last[name] && now - state.last[name] < def.min) return;
    state.last[name] = now;
    const t0 = now + (p.delay ?? 0);
    const g = ctx.createGain();
    g.gain.value = (p.vol ?? 1) * spatial(p);
    g.connect(state.master);
    const asset = state.assets[name];
    if (asset) {
      const src = ctx.createBufferSource();
      src.buffer = asset;
      if (p.rate) src.playbackRate.value = p.rate;
      src.connect(g);
      src.start(t0);
    } else {
      def.fn(ctx, g, t0, p);
    }
  },
  // Sustained sound. Returns a handle with setPos() and stop().
  loop(name, p = {}) {
    const ctx = state.ctx;
    if (!ctx || ctx.state !== 'running') return null;
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
      setPos(x, z) { h.gain.gain.setTargetAtTime(base * spatial({ x, z }), ctx.currentTime, 0.1); },
      stop() {
        h.gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.06);
        const t = ctx.currentTime + 0.4;
        for (const n of h.nodes) { try { n.stop(t); } catch { /* already stopped */ } }
      },
    };
  },
};
