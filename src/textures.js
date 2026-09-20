import * as THREE from 'three';
import { perlinP, fbmP } from './noise.js';

// Procedurally generated, seamlessly tileable albedo + normal map pairs. No image assets needed.
const S = 512;
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function soil(u, v, out) {
  const base = fbmP(u * 6, v * 6, 6, 5, 1);
  const grain = fbmP(u * 40, v * 40, 40, 2, 2);
  const pebble = sm(0.35, 0.6, perlinP(u * 28, v * 28, 28, 3));
  out.h = base * 0.5 + grain * 0.12 + pebble * 0.45;
  let c = mix([0.30, 0.21, 0.14], [0.58, 0.46, 0.30], base * 0.5 + 0.5);
  c = [c[0] + grain * 0.04, c[1] + grain * 0.04, c[2] + grain * 0.03];
  out.c = mix(c, [0.5, 0.48, 0.45], pebble * 0.8);
}

function rock(u, v, out) {
  const h1 = fbmP(u * 5, v * 5, 5, 4, 11);
  // Fractures: ridge lines of a domain-warped field (jagged, not the smooth loops a single octave gives), and only
  // where a broad mask allows, so the face reads as slabs split by a few breaks rather than an all-over squiggle.
  const wx = fbmP(u * 9, v * 9, 9, 3, 16) * 0.09, wy = fbmP(u * 9 + 3.3, v * 9 + 1.7, 9, 3, 17) * 0.09;
  const mask1 = sm(-0.15, 0.25, fbmP(u * 3, v * 3, 3, 2, 18));
  const crack1 = sm(0.9, 0.985, 1 - Math.abs(fbmP((u + wx) * 5, (v + wy) * 5, 5, 3, 12))) * mask1;
  const crack2 = sm(0.93, 0.99, 1 - Math.abs(fbmP((u - wy) * 11, (v + wx) * 11, 11, 2, 13))) * 0.5 * (1 - mask1 * 0.6);
  const cracks = Math.min(1, crack1 + crack2);
  const slab = fbmP(u * 2, v * 2, 2, 3, 19);                       // big tonal plates between the breaks
  const fine = fbmP(u * 30, v * 30, 30, 2, 14);
  const lichen = sm(0.5, 0.7, perlinP(u * 10, v * 10, 10, 15)) * 0.35;
  out.h = h1 * 0.5 + slab * 0.25 - cracks * 0.9 + fine * 0.08;
  let c = mix([0.33, 0.35, 0.40], [0.52, 0.52, 0.55], h1 * 0.35 + slab * 0.3 + 0.5);
  c = [c[0] + fine * 0.05, c[1] + fine * 0.05, c[2] + fine * 0.05];
  c = mix(c, [0.42, 0.48, 0.30], lichen);
  out.c = mix(c, [0.10, 0.10, 0.13], cracks * 0.85);
}

function moss(u, v, out) {
  const b = Math.abs(perlinP(u * 18, v * 18, 18, 21)) * 0.65 + Math.abs(perlinP(u * 36, v * 36, 36, 22)) * 0.35;
  const lump = 1 - b;
  const base = fbmP(u * 4, v * 4, 4, 3, 23);
  const speck = sm(0.55, 0.75, perlinP(u * 64, v * 64, 64, 25));
  out.h = lump * 0.8 + base * 0.25;
  let c = mix([0.11, 0.19, 0.17], [0.22, 0.38, 0.30], lump);
  c = mix(c, [0.32, 0.16, 0.38], sm(0.1, 0.6, base));
  out.c = mix(c, [0.35, 0.9, 0.7], speck * 0.9);
}

function build(fn, normalStrength, anisotropy) {
  const rgba = new Uint8ClampedArray(S * S * 4);
  const hgt = new Float32Array(S * S);
  const o = { h: 0, c: [0, 0, 0] };
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      fn(x / S, y / S, o);
      const k = y * S + x;
      hgt[k] = o.h;
      rgba[k * 4] = o.c[0] * 255; rgba[k * 4 + 1] = o.c[1] * 255; rgba[k * 4 + 2] = o.c[2] * 255; rgba[k * 4 + 3] = 255;
    }
  }
  const nrm = new Uint8ClampedArray(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const hl = hgt[y * S + ((x - 1 + S) % S)], hr = hgt[y * S + ((x + 1) % S)];
      const hu = hgt[((y - 1 + S) % S) * S + x], hd = hgt[((y + 1) % S) * S + x];
      let nx = -(hr - hl) * normalStrength, ny = -(hd - hu) * normalStrength, nz = 1;
      const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      const k = (y * S + x) * 4;
      nrm[k] = (nx * 0.5 + 0.5) * 255; nrm[k + 1] = (ny * 0.5 + 0.5) * 255; nrm[k + 2] = (nz * 0.5 + 0.5) * 255; nrm[k + 3] = 255;
    }
  }
  return { map: toTexture(rgba, true, anisotropy), normal: toTexture(nrm, false, anisotropy) };
}

function toTexture(data, srgb, anisotropy) {
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = anisotropy;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

let cache = null;
export const terrainTextures = () => cache;                      // available once the terrain has been built
export function generateTerrainTextures(renderer) {
  const aniso = renderer.capabilities.getMaxAnisotropy();
  return cache ||= {
    soil: build(soil, 9, aniso),
    rock: build(rock, 7, aniso),
    moss: build(moss, 6, aniso),
  };
}
