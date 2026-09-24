// Adaptive render quality. If the frame rate sits below 45 fps for a sustained stretch, the renderer steps down one
// quality level at a time (resolution first, as it buys the most for the least visible loss, then anti-aliasing and
// shadow detail, and bloom only at the bottom). Every knob changes live, with no shader recompiles.
//
// Only sustained slowness counts: frames are judged in 2 s windows, frames over HITCH ms (a shader compile, a GC
// pause, a tab switch) are left out, and nothing is judged for WARMUP ms after loading or SETTLE ms after a change.
// Ten such frames in a row are not a hitch, though: that is the frame rate of a machine far below the target. If two steps in a row buy nothing, rendering was not the bottleneck (a slow CPU, or the browser capping the
// frame rate on battery): those two steps are handed back and the level is left alone from then on.
//
// The level is kept for the browser tab (sessionStorage), so the title screen's finding carries into the game.
// ?quality=0..4 forces a level and turns the automatic part off (for testing).
const TARGET_FPS = 45;
const WINDOW = 2000, WARMUP = 3000, SETTLE = 1500, HITCH = 150;
const MIN_GAIN = 1.05;                          // a step has to buy at least 5% more frames to count as helping
const KEY = 'hive-siege-quality';

// pr: cap on the device pixel ratio (null = the configured maximum), msaa: samples in the scene target,
// shadow: sun shadow map size, bloom: the bloom pass.
const LEVELS = [
  { pr: null, msaa: 4, shadow: 3072, bloom: true },
  { pr: 1.0, msaa: 4, shadow: 2048, bloom: true },
  { pr: 0.85, msaa: 2, shadow: 2048, bloom: true },
  { pr: 0.8, msaa: 0, shadow: 1536, bloom: true },      // from here the resolution holds up and AA / shadows give way
  { pr: 0.7, msaa: 0, shadow: 1024, bloom: false },
];

export function createQuality({ renderer, composer, bloom, sun, maxRatio }) {
  const forced = new URLSearchParams(location.search).get('quality');
  let level = 0, locked = false;
  try { const s = JSON.parse(sessionStorage.getItem(KEY)); if (s) ({ level, locked } = s); } catch { /* fresh start */ }
  if (forced !== null) { level = Math.max(0, Math.min(LEVELS.length - 1, Number(forced) || 0)); locked = true; }

  let last = 0, holdUntil = 0, winTime = 0, winFrames = 0, slowRun = 0, slowTime = 0;
  let before = null, idle = 0;                  // fps measured before the latest step; steps in a row that bought nothing
  const q = {
    onChange: null,
    get level() { return level; },
    short: () => `Q${level} · ${Math.round(renderer.getPixelRatio() * 100)}%`,     // for the perf overlay
    describe() {
      const L = LEVELS[level];
      return `${Math.round(renderer.getPixelRatio() * 100)}% res${composer ? ` · ${L.msaa}x MSAA${L.bloom ? '' : ' · no bloom'}` : ''}`;
    },
    // Called once per displayed frame with the rAF timestamp.
    sample(now) {
      if (locked || !last) { last = now; holdUntil = now + WARMUP; return; }
      const dt = now - last;
      last = now;
      if (now < holdUntil || document.hidden) { winTime = winFrames = slowRun = slowTime = 0; return; }
      if (dt > HITCH) {                         // a hitch, not a frame rate...
        slowRun++; slowTime += dt;
        if (slowRun >= 10) judge((slowRun * 1000) / slowTime, now);   // ...unless it keeps happening
        return;
      }
      slowRun = slowTime = 0;
      winTime += dt; winFrames++;
      if (winTime >= WINDOW) judge((winFrames * 1000) / winTime, now);
    },
  };

  // A verdict on one stretch of frames: step down if it was too slow, and check the previous step earned its keep.
  function judge(fps, now) {
    winTime = winFrames = slowRun = slowTime = 0;
    if (before !== null) {                      // how much did the last step buy?
      idle = fps < before * MIN_GAIN ? idle + 1 : 0;
      before = null;
      if (idle >= 2) {                          // two useless steps: rendering is not what holds the frame rate down
        set(level - 2, now);
        locked = true;
        save();
        return;
      }
    }
    if (fps >= TARGET_FPS || level >= LEVELS.length - 1) return;
    before = fps;
    set(level + 1, now);
  }

  function save() { try { sessionStorage.setItem(KEY, JSON.stringify({ level, locked })); } catch { /* fine */ } }

  function set(n, now = performance.now()) {
    level = Math.max(0, Math.min(LEVELS.length - 1, n));
    apply();
    holdUntil = now + SETTLE;
    save();
    q.onChange?.(level, q.describe());
  }

  function apply() {
    const L = LEVELS[level];
    renderer.setPixelRatio(Math.min(devicePixelRatio, L.pr ?? maxRatio, maxRatio));
    if (composer) {
      for (const t of [composer.renderTarget1, composer.renderTarget2]) {
        if (t.samples !== L.msaa) { t.samples = L.msaa; t.dispose(); }   // re-allocated at the next render
      }
      bloom.enabled = L.bloom;
    }
    if (sun.shadow.mapSize.x !== L.shadow) {
      sun.shadow.mapSize.set(L.shadow, L.shadow);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;                    // re-created at the new size on the next shadow pass
    }
  }

  if (level) apply();
  return q;
}
