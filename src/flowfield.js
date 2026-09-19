import { FLAT, CELL, HALF } from './config.js';
import { heightAt } from './terrain.js';

// Flow field over the walkable basin. One Dijkstra from the Core gives every cell a direction toward it;
// structures are passable at a cost that scales with their HP, so bugs route through gaps when there are
// any and chew through the cheapest wall when the base is sealed. Steep ground costs extra.
const N = Math.round((2 * FLAT) / CELL);          // cells per side
const CELLS = N * N;
const OFF = (FLAT - HALF) / CELL;                  // build-grid (i,j) -> flow-grid (i+OFF, j+OFF)
const baseCost = new Float32Array(CELLS);
const cost = new Float32Array(CELLS);
const dist = new Float32Array(CELLS);
const dirX = new Float32Array(CELLS);
const dirZ = new Float32Array(CELLS);
const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.4142], [-1, 1, 1.4142], [1, -1, 1.4142], [-1, -1, 1.4142]];

for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
  const x0 = i * CELL - FLAT, z0 = j * CELL - FLAT;
  const hs = [heightAt(x0, z0), heightAt(x0 + CELL, z0), heightAt(x0, z0 + CELL), heightAt(x0 + CELL, z0 + CELL)];
  const slope = Math.max(...hs) - Math.min(...hs);
  baseCost[j * N + i] = slope > 3.2 ? 400 : 1 + Math.min(6, Math.max(0, (slope - 1.2) * 2.5));   // cliffs: effectively walls
}

// Binary heap of (dist, cell) pairs.
const heapD = new Float32Array(CELLS * 4), heapC = new Int32Array(CELLS * 4);
let heapN = 0;
function push(d, c) {
  let k = heapN++;
  heapD[k] = d; heapC[k] = c;
  while (k > 0) { const p = (k - 1) >> 1; if (heapD[p] <= heapD[k]) break; [heapD[p], heapD[k]] = [heapD[k], heapD[p]]; [heapC[p], heapC[k]] = [heapC[k], heapC[p]]; k = p; }
}
function pop() {
  const d = heapD[0], c = heapC[0];
  heapN--;
  if (heapN > 0) {
    heapD[0] = heapD[heapN]; heapC[0] = heapC[heapN];
    let k = 0;
    for (;;) {
      const l = 2 * k + 1, r = l + 1;
      let s = k;
      if (l < heapN && heapD[l] < heapD[s]) s = l;
      if (r < heapN && heapD[r] < heapD[s]) s = r;
      if (s === k) break;
      [heapD[s], heapD[k]] = [heapD[k], heapD[s]]; [heapC[s], heapC[k]] = [heapC[k], heapC[s]]; k = s;
    }
  }
  return { d, c };
}

export const flow = {
  // structures: iterable of { cells: [[i,j],...] | i,j, hp, type }
  build(structures, core) {
    cost.set(baseCost);
    const goals = [];
    for (const s of structures) {
      const cells = s.cells || [[s.i, s.j]];
      for (const [i, j] of cells) {
        const gi = i + OFF, gj = j + OFF;
        if (gi < 0 || gj < 0 || gi >= N || gj >= N) continue;
        const c = gj * N + gi;
        if (s === core) goals.push(c);
        else cost[c] = 9 + s.hp / 40;
      }
    }
    dist.fill(Infinity);
    heapN = 0;
    for (const c of goals) { dist[c] = 0; push(0, c); }
    while (heapN > 0) {
      const { d, c } = pop();
      if (d > dist[c]) continue;
      const ci = c % N, cj = (c - ci) / N;
      for (const [di, dj, w] of NB) {
        const ni = ci + di, nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
        const n = nj * N + ni;
        const nd = d + w * cost[n];
        if (nd < dist[n]) { dist[n] = nd; push(nd, n); }
      }
    }
    for (let c = 0; c < CELLS; c++) {
      const ci = c % N, cj = (c - ci) / N;
      let best = dist[c], bx = 0, bz = 0;
      for (const [di, dj] of NB) {
        const ni = ci + di, nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
        const nd = dist[nj * N + ni];
        if (nd < best) { best = nd; bx = di; bz = dj; }
      }
      const l = Math.hypot(bx, bz) || 1;
      dirX[c] = bx / l; dirZ[c] = bz / l;
    }
  },

  // Bilinear blend of the four surrounding cell directions. Writes into out {x, z}; falls back to the Core.
  sample(x, z, out) {
    const u = (x + FLAT) / CELL - 0.5, v = (z + FLAT) / CELL - 0.5;
    const i0 = Math.max(0, Math.min(N - 2, Math.floor(u))), j0 = Math.max(0, Math.min(N - 2, Math.floor(v)));
    const fu = Math.max(0, Math.min(1, u - i0)), fv = Math.max(0, Math.min(1, v - j0));
    const c00 = j0 * N + i0, c10 = c00 + 1, c01 = c00 + N, c11 = c01 + 1;
    let dx = (dirX[c00] * (1 - fu) + dirX[c10] * fu) * (1 - fv) + (dirX[c01] * (1 - fu) + dirX[c11] * fu) * fv;
    let dz = (dirZ[c00] * (1 - fu) + dirZ[c10] * fu) * (1 - fv) + (dirZ[c01] * (1 - fu) + dirZ[c11] * fu) * fv;
    let l = Math.hypot(dx, dz);
    if (l < 0.05) { dx = -x; dz = -z; l = Math.hypot(dx, dz) || 1; }
    out.x = dx / l; out.z = dz / l;
    return out;
  },
  size: N,
};
