// Noise toolkit: seeded 2D simplex (terrain), periodic Perlin (tileable textures), fbm helpers.

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- 2D simplex noise (Gustavson), seeded permutation ----
const perm = new Uint8Array(512);
{
  const rnd = mulberry32(1337);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
}
const GRAD = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;

export function simplex(xin, yin) {
  const s = (xin + yin) * F2;
  const i = Math.floor(xin + s), j = Math.floor(yin + s);
  const t = (i + j) * G2;
  const x0 = xin - (i - t), y0 = yin - (j - t);
  const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
  const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
  const ii = i & 255, jj = j & 255;
  let n = 0;
  let t0 = 0.5 - x0 * x0 - y0 * y0;
  if (t0 > 0) { const g = GRAD[perm[ii + perm[jj]] & 7]; t0 *= t0; n += t0 * t0 * (g[0] * x0 + g[1] * y0); }
  let t1 = 0.5 - x1 * x1 - y1 * y1;
  if (t1 > 0) { const g = GRAD[perm[ii + i1 + perm[jj + j1]] & 7]; t1 *= t1; n += t1 * t1 * (g[0] * x1 + g[1] * y1); }
  let t2 = 0.5 - x2 * x2 - y2 * y2;
  if (t2 > 0) { const g = GRAD[perm[ii + 1 + perm[jj + 1]] & 7]; t2 *= t2; n += t2 * t2 * (g[0] * x2 + g[1] * y2); }
  return 70 * n; // roughly [-1, 1]
}

export function fbm(x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * simplex(x * freq + i * 19.7, y * freq - i * 7.3);
    norm += amp; amp *= gain; freq *= lacunarity;
  }
  return sum / norm;
}

// Ridged multifractal: sharp crests, good for mountains. Returns [0, 1].
export function ridged(x, y, octaves = 4) {
  let amp = 0.5, freq = 1, sum = 0, weight = 1;
  for (let i = 0; i < octaves; i++) {
    let n = 1 - Math.abs(simplex(x * freq + i * 3.1, y * freq + i * 5.7));
    n *= n * weight;
    weight = Math.min(1, n * 2);
    sum += n * amp;
    amp *= 0.5; freq *= 2.1;
  }
  return sum;
}

// ---- Periodic Perlin noise for seamless tiling textures ----
function hashInt(ix, iy, seed) {
  let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed + 1, 1103515245);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return (n ^ (n >>> 16)) >>> 0;
}
const GTAB = Array.from({ length: 32 }, (_, i) => [Math.cos(i / 32 * Math.PI * 2), Math.sin(i / 32 * Math.PI * 2)]);
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

export function perlinP(x, y, period, seed = 0) {
  const X = Math.floor(x), Y = Math.floor(y);
  const fx = x - X, fy = y - Y;
  const u = fade(fx), v = fade(fy);
  const wrap = (a) => ((a % period) + period) % period;
  const g = (ix, iy, dx, dy) => { const gv = GTAB[hashInt(wrap(ix), wrap(iy), seed) & 31]; return gv[0] * dx + gv[1] * dy; };
  const n00 = g(X, Y, fx, fy), n10 = g(X + 1, Y, fx - 1, fy);
  const n01 = g(X, Y + 1, fx, fy - 1), n11 = g(X + 1, Y + 1, fx - 1, fy - 1);
  const a = n00 + (n10 - n00) * u, b = n01 + (n11 - n01) * u;
  return (a + (b - a) * v) * 1.4142;
}

export function fbmP(x, y, period, octaves = 4, seed = 0) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * perlinP(x * freq, y * freq, period * freq, seed + i * 31);
    norm += amp; amp *= 0.5; freq *= 2;
  }
  return sum / norm;
}
