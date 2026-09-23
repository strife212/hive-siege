// Performance overlay, toggled from the debug menu. FPS and frame time with a rolling graph, plus what to blame when
// frames run long: CPU time split into simulation and render submission, GPU time (when the browser exposes a timer
// query; Chromium does, Firefox usually does not), and the load behind it (draw calls, triangles, bugs, particles).
// Text refreshes four times a second from averages so it stays readable; the graph shows every frame. Hidden, it
// costs nothing: every hook returns straight away.
const N = 160;                                 // frames kept for the graph and the worst-frame readout
const KEY = 'hive-siege-perf';
const LINES = [16.7, 33.3];                    // 60 and 30 fps guides

let on = false, renderer = null, stats = null;
let el = null, canvas = null, g = null, out = {};
const frameMs = new Float32Array(N), cpuMs = new Float32Array(N);
let head = 0, filled = 0;
let tFrame = 0, tLast = 0, tRender = 0, renderAcc = 0, counted = false;
const sum = { n: 0, frame: 0, cpu: 0, render: 0, gpu: 0, gpuN: 0 };
let nextText = 0;

// GPU timing: one TIME_ELAPSED query around each render, read back a few frames later when the result lands.
let gl = null, ext = null, active = null;
const inFlight = [];

const colorFor = (ms) => (ms <= 17.5 ? '#6fe08a' : ms <= 34 ? '#f2b144' : '#ff5a45');
const fmt = (v, d = 1) => (v == null || !isFinite(v) ? '–' : v.toFixed(d));
const big = (v) => (v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'k' : String(v));

function build() {
  el = document.createElement('div');
  el.id = 'perf';
  el.hidden = true;
  el.innerHTML = `
    <div class="top"><b data-k="fps">–</b><span>FPS</span><em data-k="ms">– ms</em></div>
    <canvas title="Each bar is one frame (green under 16.7 ms, amber under 33.3 ms). The bright part is the CPU time spent in the game's own code."></canvas>
    <dl>
      <dt>worst</dt><dd data-k="worst">–</dd>
      <dt>CPU</dt><dd data-k="cpu">–</dd>
      <dt>GPU</dt><dd data-k="gpu">–</dd>
      <dt>draws</dt><dd data-k="draws">–</dd>
      <dt>scene</dt><dd data-k="scene">–</dd>
    </dl>`;
  document.body.appendChild(el);
  for (const n of el.querySelectorAll('[data-k]')) out[n.dataset.k] = n;
  canvas = el.querySelector('canvas');
  g = canvas.getContext('2d');
}

function drawGraph() {
  const dpr = Math.min(2, devicePixelRatio || 1);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const top = 40, y = (ms) => h - Math.min(ms, top) / top * h;
  g.fillStyle = 'rgba(160, 190, 230, .18)';
  for (const l of LINES) g.fillRect(0, Math.round(y(l)), w, 1);
  const bw = w / N;
  for (let k = 0; k < filled; k++) {                     // oldest on the left
    const i = (head - filled + k + N) % N, x = (N - filled + k) * bw;
    const f = frameMs[i], c = cpuMs[i];
    g.fillStyle = colorFor(f);
    g.globalAlpha = 0.35;
    g.fillRect(x, y(f), Math.max(1, bw - 0.3), h - y(f));   // the whole frame, dim
    g.globalAlpha = 0.95;
    g.fillRect(x, y(c), Math.max(1, bw - 0.3), h - y(c));   // the part this page's own code kept the CPU busy
  }
  g.globalAlpha = 1;
}

function refreshText() {
  if (!sum.n) return;
  const frame = sum.frame / sum.n, cpu = sum.cpu / sum.n, render = sum.render / sum.n;
  let worst = 0;
  for (let k = 0; k < filled; k++) worst = Math.max(worst, frameMs[k]);
  out.fps.textContent = Math.round(1000 / frame);
  out.fps.style.color = colorFor(frame);
  out.ms.textContent = `${fmt(frame)} ms`;
  out.worst.textContent = `${fmt(worst)} ms`;
  out.worst.style.color = colorFor(worst);
  out.cpu.textContent = `${fmt(cpu)} ms  (sim ${fmt(cpu - render)} · render ${fmt(render)})`;
  out.gpu.textContent = ext ? (sum.gpuN ? `${fmt(sum.gpu / sum.gpuN)} ms` : '…') : 'no timer';
  const info = renderer.info.render;
  out.draws.textContent = `${info.calls} calls · ${big(info.triangles)} tris`;
  out.scene.textContent = stats ? stats() : '';
  Object.assign(sum, { n: 0, frame: 0, cpu: 0, render: 0, gpu: 0, gpuN: 0 });
}

function pollGpu() {
  while (inFlight.length && gl.getQueryParameter(inFlight[0], gl.QUERY_RESULT_AVAILABLE)) {
    const q = inFlight.shift();
    if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) { sum.gpu += gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6; sum.gpuN++; }
    gl.deleteQuery(q);
  }
}

export const perf = {
  // stats(): a short line describing the scene load (bug and particle counts)
  init(r, statsFn) {
    renderer = r;
    stats = statsFn;
    build();
    gl = renderer.getContext();
    ext = gl.getExtension?.('EXT_disjoint_timer_query_webgl2') ?? null;
    let saved = false;
    try { saved = localStorage.getItem(KEY) === '1'; } catch { /* storage blocked: starts off */ }
    this.set(saved);
  },
  get on() { return on; },
  set(v) {
    on = !!v;
    el.hidden = !on;
    renderer.info.autoReset = !on;                       // on: count a whole frame (shadows + every post pass), not the last pass
    head = filled = 0; tLast = 0;
    Object.assign(sum, { n: 0, frame: 0, cpu: 0, render: 0, gpu: 0, gpuN: 0 });
    try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* fine */ }
    return on;
  },
  toggle() { return this.set(!on); },

  frameStart() {
    if (!on) return;
    tFrame = performance.now();
    renderAcc = 0;
    renderer.info.reset();
    const dt = tFrame - tLast;
    counted = tLast > 0 && dt < 500;                     // a hidden tab pauses the loop: skip that gap
    if (counted) { frameMs[head] = dt; sum.frame += dt; sum.n++; }
    tLast = tFrame;
  },
  renderStart() {
    if (!on) return;
    tRender = performance.now();
    if (ext && !active && inFlight.length < 6) { active = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, active); }
  },
  renderEnd() {
    if (!on) return;
    renderAcc += performance.now() - tRender;
    if (active) { gl.endQuery(ext.TIME_ELAPSED_EXT); inFlight.push(active); active = null; }
  },
  frameEnd() {
    if (!on || !tFrame) return;
    const now = performance.now(), cpu = now - tFrame;
    if (counted) {
      cpuMs[head] = cpu;
      sum.cpu += cpu; sum.render += renderAcc;
      head = (head + 1) % N;
      filled = Math.min(N, filled + 1);
    }
    if (ext) pollGpu();
    drawGraph();
    if (now >= nextText) { nextText = now + 250; refreshText(); }
  },
};
