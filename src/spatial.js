import { FLAT } from './config.js';

// Uniform spatial hash over the basin for enemies. Rebuilt every frame (counting sort into linked lists),
// then queried by circle for separation, tower targeting and area damage. No allocations after init.
const SIZE = 2, EXT = FLAT + 46;      // covers the canyon approach beyond the basin too
const N = Math.ceil((2 * EXT) / SIZE);
const head = new Int32Array(N * N).fill(-1);      // empty until the first build()
let next = new Int32Array(4096);
let items = [];

const cellOf = (x, z) => {
  const i = Math.max(0, Math.min(N - 1, Math.floor((x + EXT) / SIZE)));
  const j = Math.max(0, Math.min(N - 1, Math.floor((z + EXT) / SIZE)));
  return j * N + i;
};

export const spatial = {
  build(list) {
    items = list;
    if (next.length < list.length) next = new Int32Array(list.length * 2);
    head.fill(-1);
    for (let k = 0; k < list.length; k++) {
      const e = list[k];
      if (e.dead) continue;
      const c = cellOf(e.x, e.z);
      next[k] = head[c];
      head[c] = k;
    }
  },
  // Calls fn(e, d2) for every live enemy within r of (x, z). Return true from fn to stop early.
  each(x, z, r, fn) {
    const i0 = Math.max(0, Math.floor((x - r + EXT) / SIZE)), i1 = Math.min(N - 1, Math.floor((x + r + EXT) / SIZE));
    const j0 = Math.max(0, Math.floor((z - r + EXT) / SIZE)), j1 = Math.min(N - 1, Math.floor((z + r + EXT) / SIZE));
    const r2 = r * r;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      for (let k = head[j * N + i]; k !== -1; k = next[k]) {
        const e = items[k];
        if (e.dead) continue;
        const dx = e.x - x, dz = e.z - z, d2 = dx * dx + dz * dz;
        if (d2 <= r2 && fn(e, d2)) return;
      }
    }
  },
  // Pairwise visitor for separation: fn(a, b) once per pair within r.
  pairs(r, fn) {
    const r2 = r * r;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const c = j * N + i;
      for (let k = head[c]; k !== -1; k = next[k]) {
        const a = items[k];
        // same cell: only later entries in the list
        for (let q = next[k]; q !== -1; q = next[q]) { const b = items[q]; const dx = b.x - a.x, dz = b.z - a.z; if (dx * dx + dz * dz < r2) fn(a, b); }
        // forward neighbours: +x, +z row (three cells) so each pair is visited once
        for (const [di, dj] of [[1, 0], [-1, 1], [0, 1], [1, 1]]) {
          const ni = i + di, nj = j + dj;
          if (ni < 0 || ni >= N || nj >= N) continue;
          for (let q = head[nj * N + ni]; q !== -1; q = next[q]) { const b = items[q]; const dx = b.x - a.x, dz = b.z - a.z; if (dx * dx + dz * dz < r2) fn(a, b); }
        }
      }
    }
  },
};
