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
// Neighbour offsets and step weights as flat constant tables, so the inner loops allocate nothing. The weights stay
// plain (double precision) numbers: path costs must add up exactly as they always have.
const NI = [1, -1, 0, 0, 1, -1, 1, -1], NJ = [0, 0, 1, -1, 1, 1, -1, -1];
const NW = [1, 1, 1, 1, 1.4142, 1.4142, 1.4142, 1.4142];

for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
  const x0 = i * CELL - FLAT, z0 = j * CELL - FLAT;
  const hs = [heightAt(x0, z0), heightAt(x0 + CELL, z0), heightAt(x0, z0 + CELL), heightAt(x0 + CELL, z0 + CELL)];
  const slope = Math.max(...hs) - Math.min(...hs);
  baseCost[j * N + i] = slope > 3.2 ? 400 : 1 + Math.min(6, Math.max(0, (slope - 1.2) * 2.5));   // cliffs: effectively walls
}

// Binary min-heap of (dist, cell) pairs. Sift by moving a hole rather than swapping, and pop() leaves the popped
// distance in popD instead of returning an object: a rebuild pushes tens of thousands of entries.
const heapD = new Float32Array(CELLS * 8), heapC = new Int32Array(CELLS * 8);
let heapN = 0, popD = 0;
function push(d, c) {
  d = Math.fround(d);                                   // compare as stored (float32), exactly like the swap-based heap did
  let k = heapN++;
  while (k > 0) {
    const p = (k - 1) >> 1;
    if (heapD[p] <= d) break;
    heapD[k] = heapD[p]; heapC[k] = heapC[p]; k = p;
  }
  heapD[k] = d; heapC[k] = c;
}
function pop() {
  const c = heapC[0];
  popD = heapD[0];
  const n = --heapN;
  if (n > 0) {
    const d = heapD[n], cc = heapC[n];
    let k = 0;
    for (;;) {
      let l = 2 * k + 1;
      if (l >= n) break;
      if (l + 1 < n && heapD[l + 1] < heapD[l]) l++;
      if (heapD[l] >= d) break;
      heapD[k] = heapD[l]; heapC[k] = heapC[l]; k = l;
    }
    heapD[k] = d; heapC[k] = cc;
  }
  return c;
}

// The cost grid (and goals) of the last rebuild: when nothing has changed since, the field is already right.
const lastCost = new Float32Array(CELLS).fill(-1);
let lastGoals = '';

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
    const goalKey = goals.join(',');
    let same = goalKey === lastGoals;
    for (let c = 0; same && c < CELLS; c++) same = cost[c] === lastCost[c];
    if (same) return;
    lastCost.set(cost);
    lastGoals = goalKey;

    dist.fill(Infinity);
    heapN = 0;
    for (const c of goals) { dist[c] = 0; push(0, c); }
    while (heapN > 0) {
      const c = pop(), d = popD;
      if (d > dist[c]) continue;
      const ci = c % N, cj = (c - ci) / N;
      for (let q = 0; q < 8; q++) {
        const ni = ci + NI[q], nj = cj + NJ[q];
        if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
        const n = nj * N + ni;
        const nd = d + NW[q] * cost[n];
        if (nd < dist[n]) { dist[n] = nd; push(nd, n); }
      }
    }
    for (let c = 0; c < CELLS; c++) {
      const ci = c % N, cj = (c - ci) / N;
      let best = dist[c], bx = 0, bz = 0;
      for (let q = 0; q < 8; q++) {
        const ni = ci + NI[q], nj = cj + NJ[q];
        if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
        const nd = dist[nj * N + ni];
        if (nd < best) { best = nd; bx = NI[q]; bz = NJ[q]; }
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
