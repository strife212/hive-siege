import * as THREE from 'three';
import { simplex, fbm, ridged } from './noise.js';
import { HALF, CELL, CELLS, FLAT, MAP } from './config.js';
import { generateTerrainTextures } from './textures.js';
import { WEATHER_U } from './surface.js';

export const EXTENT = FLAT + 60;    // half-size of the rendered world (basin is FLAT, build area is HALF)
const SPACING = 0.5;

export function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// ---- canyon map: a box canyon with the Core at the closed end, a choke point in front of it and a mouth that
// flares open to the north (-z), the only way in. Everything outside the canyon is a high mesa.
const CANYON_BACK = 17;
export function canyonCenter(z) { return 6 * Math.sin(z * 0.055 + 0.6) * smoothstep(-10, -34, z); }
function canyonHalfWidth(z) {
  return 12 + 5 * smoothstep(-14, 0, z) + 18 * smoothstep(-24, -56, z) + 70 * smoothstep(-58, -110, z) + 1.6 * simplex(z * 0.09 + 3.1, 1.7);
}
// Signed distance to the canyon wall: negative on the floor, positive inside the rock.
export function canyonDist(x, z) {
  const R = 10;
  const ax = Math.abs(x - canyonCenter(z)) - canyonHalfWidth(z) + R, az = z - CANYON_BACK + R;
  const d = Math.hypot(Math.max(ax, 0), Math.max(az, 0)) + Math.min(Math.max(ax, az), 0) - R;
  return d + 2.0 * fbm(x * 0.08 + 11, z * 0.08 - 7, 3);
}
function canyonHeight(x, z) {
  const r = Math.hypot(x, z);
  const wx = x + 7 * simplex(x * 0.03 + 5.2, z * 0.03 + 1.3);
  const wz = z + 7 * simplex(x * 0.03 - 3.1, z * 0.03 + 7.7);
  let h = fbm(wx * 0.045, wz * 0.045, 5) * 2.4;
  h += fbm(x * 0.35, z * 0.35, 2) * 0.2;
  h *= 0.2 + 0.8 * smoothstep(8, 26, r);
  const d = canyonDist(x, z);
  h += 0.9 * smoothstep(-6, 0, d);                              // scree banked against the walls
  const cliff = smoothstep(0, 3.6, d);
  if (cliff > 0) {
    const bench = smoothstep(8, 14, d);                         // second tier set back from the rim
    h += cliff * (11 + ridged(x * 0.03, z * 0.03, 4) * 7 + fbm(x * 0.13, z * 0.13, 3) * 1.3) + bench * 5;
  }
  return h;
}

// True where the ground is scenery rather than somewhere bugs or buildings can be.
export function isScenery(x, z) {
  if (Math.max(Math.abs(x), Math.abs(z)) > FLAT + 3) return true;
  return MAP === 'canyon' && canyonDist(x, z) > 1;
}

// Keep a walker off the cliffs (canyon only): slide it back toward the canyon centre line.
export function confine(e) {
  if (MAP !== 'canyon') return;
  const d = canyonDist(e.x, e.z) + 1;
  if (d <= 0) return;
  const back = e.z - CANYON_BACK + 1;
  if (back > 0) e.z -= Math.min(back, d);
  e.x += Math.sign(canyonCenter(e.z) - e.x) * d;
}

// Canyon only: the open ground beyond the mouth that the walk-in horde crosses. Returns a random start point on a
// line well outside the basin, spread over the full width of the opening (null on maps without an open side).
export const WALK_IN_Z = -(FLAT + 34);
export function walkInPoint() {
  if (MAP !== 'canyon') return null;
  const z = WALK_IN_Z - Math.random() * 10, w = Math.min(canyonHalfWidth(z) - 5, EXTENT - 14);
  return { x: canyonCenter(z) + (Math.random() * 2 - 1) * w, z };
}
// Heading for a bug still outside the flow field: straight up the approach, slanting in if it is wide of the mouth.
export function approachDir(x, z, out) {
  const tz = -FLAT + 8, c = canyonCenter(tz), w = canyonHalfWidth(tz) - 5;
  const dx = Math.max(c - w, Math.min(c + w, x)) - x, dz = tz - z, l = Math.hypot(dx, dz) || 1;
  out.x = dx / l; out.z = dz / l;
  return out;
}

// Where wave nests sit. k of n nests; basin = anywhere on the rim, canyon = spread across the mouth.
export function nestPosition(k, n, base, radius) {
  if (MAP === 'canyon') {
    const z = -radius + 2, w = canyonHalfWidth(z) - 6;
    return { x: canyonCenter(z) + ((k + 0.5) / n * 2 - 1) * w + (Math.random() - 0.5) * 3, z };
  }
  const a = base + (k / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.8;
  return { x: Math.cos(a) * radius, z: Math.sin(a) * radius };
}

// Analytic height so entities never need to raycast the mesh.
export function heightAt(x, z) {
  if (MAP === 'canyon') return canyonHeight(x, z);
  const d = Math.max(Math.abs(x), Math.abs(z));
  const r = Math.hypot(x, z);
  // Domain-warped rolling hills
  const wx = x + 7 * simplex(x * 0.03 + 5.2, z * 0.03 + 1.3);
  const wz = z + 7 * simplex(x * 0.03 - 3.1, z * 0.03 + 7.7);
  let h = fbm(wx * 0.045, wz * 0.045, 5) * 4.5;
  h += fbm(x * 0.35, z * 0.35, 2) * 0.22;                     // micro relief
  h *= 0.2 + 0.8 * smoothstep(8, 26, r);                        // flatter plateau around the Core
  h -= 0.8 * (1 - smoothstep(FLAT - 10, FLAT + 4, d));          // basin sits slightly lower
  // Mountains beyond the basin
  const m = smoothstep(FLAT + 2, FLAT + 32, d);
  if (m > 0) h += m * (6 + ridged(x * 0.025, z * 0.025, 4) * 26);
  return h;
}

export const cellToWorld = (i, j) => ({ x: (i + 0.5) * CELL - HALF, z: (j + 0.5) * CELL - HALF });
export const worldToCell = (x, z) => ({ i: Math.floor((x + HALF) / CELL), j: Math.floor((z + HALF) / CELL) });
export const cellKey = (i, j) => `${i},${j}`;
export const inBounds = (i, j) => i >= 0 && j >= 0 && i < CELLS && j < CELLS;

export function cellSlope(i, j) {
  const x0 = i * CELL - HALF, z0 = j * CELL - HALF;
  const hs = [heightAt(x0, z0), heightAt(x0 + CELL, z0), heightAt(x0, z0 + CELL), heightAt(x0 + CELL, z0 + CELL)];
  return Math.max(...hs) - Math.min(...hs);
}

// Surface material weights (soil, rock, moss) from height, slope and a patch noise.
function splatWeights(x, z, h, slope) {
  let rock = Math.min(1, smoothstep(0.45, 1.0, slope) + smoothstep(5, 12, h));
  const patch = fbm(x * 0.06 + 9, z * 0.06 - 4, 3);
  let moss = smoothstep(0.15, 0.5, patch) * (1 - smoothstep(0.3, 0.7, slope)) * (1 - smoothstep(3, 6, h)) * (1 - rock);
  const soil = Math.max(0, 1 - rock - moss);
  return [soil, rock, moss];
}

export function sampleTerrain(x, z) {
  const e = 0.5;
  const h = heightAt(x, z);
  const slope = Math.hypot((heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e), (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e));
  const [soil, rock, moss] = splatWeights(x, z, h, slope);
  return { h, slope, soil, rock, moss };
}

// Ray-march the analytic heightfield instead of raycasting 300k triangles.
const _p = new THREE.Vector3();
export function pickTerrain(ray) {
  const o = ray.origin, d = ray.direction;
  let prev = 0;
  for (let t = 0; t < 700; t += 0.6) {
    _p.copy(o).addScaledVector(d, t);
    if (_p.y > 60 && d.y > 0) return null;
    if (Math.abs(_p.x) <= EXTENT && Math.abs(_p.z) <= EXTENT && _p.y <= heightAt(_p.x, _p.z)) {
      let lo = prev, hi = t;
      for (let k = 0; k < 10; k++) {
        const mid = (lo + hi) / 2;
        _p.copy(o).addScaledVector(d, mid);
        if (_p.y <= heightAt(_p.x, _p.z)) hi = mid; else lo = mid;
      }
      return _p.copy(o).addScaledVector(d, hi).clone();
    }
    prev = t;
  }
  return null;
}

// Shaft openings for retracting buildings (retract.js): a coarse mask over the build area that the terrain shader
// discards against, so a silo is a real hole in the ground. Counted, so overlapping openings can come and go freely.
const HOLE_RES = 0.25, HOLE_HALF = HALF + 6, HOLE_N = Math.round((HOLE_HALF * 2) / HOLE_RES);
const holeCount = new Uint8Array(HOLE_N * HOLE_N);
const holeTex = new THREE.DataTexture(new Uint8Array(HOLE_N * HOLE_N), HOLE_N, HOLE_N, THREE.RedFormat);
holeTex.magFilter = holeTex.minFilter = THREE.NearestFilter;
holeTex.needsUpdate = true;
export function cutHole(x0, z0, x1, z1, open) {
  const i0 = Math.max(0, Math.round((x0 + HOLE_HALF) / HOLE_RES)), i1 = Math.min(HOLE_N, Math.round((x1 + HOLE_HALF) / HOLE_RES));
  const j0 = Math.max(0, Math.round((z0 + HOLE_HALF) / HOLE_RES)), j1 = Math.min(HOLE_N, Math.round((z1 + HOLE_HALF) / HOLE_RES));
  for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
    const k = j * HOLE_N + i;
    holeCount[k] = Math.max(0, holeCount[k] + (open ? 1 : -1));
    holeTex.image.data[k] = holeCount[k] ? 255 : 0;
  }
  holeTex.needsUpdate = true;
}

export function createTerrain(renderer) {
  const n = Math.round((EXTENT * 2) / SPACING) + 1;
  const count = n * n;
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const splat = new Float32Array(count * 3);
  const hgt = new Float32Array(count);
  const xs = new Float32Array(n), zs = new Float32Array(n);
  for (let i = 0; i < n; i++) xs[i] = zs[i] = -EXTENT + i * SPACING;

  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) hgt[j * n + i] = heightAt(xs[i], zs[j]);
  const H = (i, j) => hgt[Math.min(n - 1, Math.max(0, j)) * n + Math.min(n - 1, Math.max(0, i))];

  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const x = xs[i], z = zs[j], h = hgt[k];
      pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;

      const slope = Math.hypot((H(i + 1, j) - H(i - 1, j)) / (2 * SPACING), (H(i, j + 1) - H(i, j - 1)) / (2 * SPACING));
      const w = splatWeights(x, z, h, slope);
      splat[k * 3] = w[0]; splat[k * 3 + 1] = w[1]; splat[k * 3 + 2] = w[2];

      // Baked cavity AO: compare height to neighbours at two radii.
      const near = (H(i + 3, j) + H(i - 3, j) + H(i, j + 3) + H(i, j - 3)) / 4;
      const far = (H(i + 10, j) + H(i - 10, j) + H(i, j + 10) + H(i, j - 10)) / 4;
      const cavity = (h - near) * 0.5 + (h - far) * 0.12;
      const ao = Math.min(1.15, Math.max(0.45, 1 + cavity * 0.6));
      const tint = fbm(x * 0.02 + 40, z * 0.02 - 40, 2) * 0.5 + 0.5;
      col[k * 3] = ao * (1.0 - 0.08 * tint);
      col[k * 3 + 1] = ao * (0.97 + 0.02 * tint);
      col[k * 3 + 2] = ao * (0.9 + 0.14 * tint);
    }
  }

  const idx = new Uint32Array((n - 1) * (n - 1) * 6);
  let q = 0;
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      idx[q++] = a; idx[q++] = c; idx[q++] = b;
      idx[q++] = b; idx[q++] = c; idx[q++] = d;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('splat', new THREE.BufferAttribute(splat, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, createTerrainMaterial(renderer));
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  // Drawn after every other solid object (only the sky comes later): its pixels are the most expensive in the scene,
  // and this way the depth test throws out the ground hidden under buildings and bugs before it is shaded.
  mesh.renderOrder = 999;
  return mesh;
}

// MeshStandardMaterial extended with height/slope splatting of three procedural texture sets,
// world-space normal mapping, a glowing playable-area boundary and darkening outside it.
function createTerrainMaterial(renderer) {
  const tex = generateTerrainTextures(renderer);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.0 });
  mat.customProgramCacheKey = () => 'terrain-splat';
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      tSoil: { value: tex.soil.map }, tSoilN: { value: tex.soil.normal },
      tRock: { value: tex.rock.map }, tRockN: { value: tex.rock.normal },
      tMoss: { value: tex.moss.map }, tMossN: { value: tex.moss.normal },
      uBound: { value: HALF },
      uFlat: { value: FLAT },
      uGrid: { value: 0 },
      uCanyon: { value: MAP === 'canyon' ? 1 : 0 },
      tHoles: { value: holeTex }, uHoleHalf: { value: HOLE_HALF },
      uWet: WEATHER_U.wet, uRainAmt: WEATHER_U.rain, uRainT: WEATHER_U.time, uSkyRefl: WEATHER_U.sky,
    });
    mat.userData.setGrid = (v) => { shader.uniforms.uGrid.value = v; };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 splat;
        varying vec3 vSplat; varying vec3 vWorldPos; varying vec3 vWNormal;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vSplat = splat;
        vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWNormal = normalize(mat3(modelMatrix) * objectNormal);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D tSoil, tSoilN, tRock, tRockN, tMoss, tMossN;
        uniform float uBound; uniform float uFlat; uniform float uGrid; uniform float uCanyon;
        uniform sampler2D tHoles; uniform float uHoleHalf;
        uniform float uWet, uRainAmt, uRainT; uniform vec3 uSkyRefl;
        float gPuddle = 0.0; vec3 gPuddleN = vec3(0.0, 1.0, 0.0);
        float wHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
        float wNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), f.x), mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), f.x), f.y); }
        // Raindrop rings on standing water: each cell of two offset grids drops a ring on its own beat. Returns the
        // horizontal slope of the ripple field, used to tilt the puddle normal.
        vec2 ripples(vec2 p, float t) {
          vec2 acc = vec2(0.0);
          for (int k = 0; k < 2; k++) {
            vec2 q = p * 1.7 + float(k) * vec2(0.37, 0.61);
            vec2 cell = floor(q), f = fract(q);
            for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
              vec2 c = cell + vec2(float(i), float(j)) + float(k) * 17.0;
              float ph = fract(t * 1.25 + wHash(c));
              vec2 dd = f - (vec2(float(i), float(j)) + vec2(wHash(c + 3.1), wHash(c + 7.7)));
              float r = length(dd), R = ph * 0.85;
              float ring = sin((r - R) * 34.0) * exp(-pow((r - R) * 8.0, 2.0)) * (1.0 - ph) * (1.0 - ph);
              acc += dd / max(r, 1e-3) * ring;
            }
          }
          return acc;
        }
        varying vec3 vSplat; varying vec3 vWorldPos; varying vec3 vWNormal;
        vec3 sample2(sampler2D t, vec2 a, vec2 b) { return mix(texture2D(t, a).rgb, texture2D(t, b).rgb, 0.5); }
        // The same, with the mip level taken from gradients worked out before any branch (ga, gb = dFdx, dFdy of a, b),
        // so a lookup inside a per-pixel branch is as well defined as one outside it.
        vec3 sample2g(sampler2D t, vec2 a, vec2 b, vec4 ga, vec4 gb) {
          return mix(textureGrad(t, a, ga.xy, ga.zw).rgb, textureGrad(t, b, gb.xy, gb.zw).rgb, 0.5);
        }`)
      .replace('#include <map_fragment>', `
        vec2 holeUv = (vWorldPos.xz + uHoleHalf) / (2.0 * uHoleHalf);
        if (holeUv.x > 0.0 && holeUv.x < 1.0 && holeUv.y > 0.0 && holeUv.y < 1.0 && texture2D(tHoles, holeUv).r > 0.5) discard;
        vec2 uvA = vWorldPos.xz * 0.22;
        vec2 uvB = vWorldPos.xz * 0.071 + vec2(0.37, 0.71);
        vec4 gA = vec4(dFdx(uvA), dFdy(uvA)), gB = vec4(dFdx(uvB), dFdy(uvB));
        vec3 w = vSplat / max(0.001, vSplat.x + vSplat.y + vSplat.z);
        // A layer whose weight is exactly zero here would only add zero, so its lookups are skipped (most of the ground
        // has no moss, and half of it no rock). Exactly zero: at silhouettes MSAA can extrapolate a weight slightly
        // below zero, and that still counts, as it always did.
        vec3 tn = abs(normalize(vWNormal));
        vec3 rockC = vec3(0.0);
        if (w.y != 0.0) {
          // rock is triplanar so cliff faces don't smear the top-down projection
          vec3 tw = pow(tn, vec3(4.0)); tw /= (tw.x + tw.y + tw.z);
          rockC = sample2g(tRock, uvA, uvB, gA, gB) * tw.y;
          if (tw.x > 0.02) rockC += sample2(tRock, vWorldPos.zy * 0.22, vWorldPos.zy * 0.071 + 0.37) * tw.x;
          if (tw.z > 0.02) rockC += sample2(tRock, vWorldPos.xy * 0.22, vWorldPos.xy * 0.071 + 0.71) * tw.z;
          // canyon: sandstone tint with sedimentary banding up the walls
          float band = sin(vWorldPos.y * 2.6 + sin(vWorldPos.x * 0.11 + vWorldPos.z * 0.07) * 2.0) * 0.5 + 0.5;
          band = mix(band, sin(vWorldPos.y * 0.9 + 1.3) * 0.5 + 0.5, 0.45);
          vec3 strata = mix(vec3(1.18, 0.78, 0.55), vec3(1.5, 1.12, 0.82), band) * (0.8 + 0.2 * (1.0 - tn.y));
          rockC *= mix(vec3(1.0), strata, uCanyon);
        }
        vec3 albedo = vec3(0.0);
        if (w.x != 0.0) albedo += sample2g(tSoil, uvA, uvB, gA, gB) * w.x;
        albedo += rockC * w.y;
        if (w.z != 0.0) albedo += sample2g(tMoss, uvA, uvB, gA, gB) * w.z;
        float bd = max(abs(vWorldPos.x), abs(vWorldPos.z));
        albedo *= mix(1.0, 0.86, smoothstep(uBound, uBound + 6.0, bd));
        albedo *= mix(1.0, 0.6, smoothstep(uFlat, uFlat + 12.0, bd));
        // rain: soaked ground darkens, and standing water collects on flat ground in the hollows (not on bare rock)
        if (uWet > 0.001) {
          float flatG = smoothstep(0.9, 0.985, normalize(vWNormal).y);
          float pn = wNoise(vWorldPos.xz * 0.11) * 0.65 + wNoise(vWorldPos.xz * 0.37 + 5.3) * 0.35;
          float low = 1.0 - smoothstep(0.8, 1.02, (vColor.r + vColor.g) * 0.5);           // baked cavity AO: hollows are darker
          gPuddle = smoothstep(0.7, 0.78, pn + low * 0.4) * flatG * smoothstep(0.35, 1.0, uWet) * (1.0 - w.y);
          albedo *= mix(1.0, 0.6, uWet);
          albedo *= mix(1.0, 0.42, gPuddle);
        }
        diffuseColor.rgb *= albedo;`)
      .replace('#include <normal_fragment_maps>', `
        vec3 mapN = vec3(0.0);                                            // absent layers skipped, as for the albedo
        if (w.x != 0.0) mapN += sample2g(tSoilN, uvA, uvB, gA, gB) * w.x;
        if (w.y != 0.0) mapN += sample2g(tRockN, uvA, uvB, gA, gB) * w.y;
        if (w.z != 0.0) mapN += sample2g(tMossN, uvA, uvB, gA, gB) * w.z;
        mapN = mapN * 2.0 - 1.0;
        vec3 Nw = normalize(vWNormal);
        vec3 Bw = normalize(cross(vec3(1.0, 0.0, 0.0), Nw));
        vec3 Tw = normalize(cross(Nw, Bw));
        vec3 wn = normalize(Tw * mapN.x + Bw * mapN.y + Nw * mapN.z);
        if (gPuddle > 0.01) {                                             // standing water: flat, and pocked by raindrops
          vec2 rp = uRainAmt > 0.01 ? ripples(vWorldPos.xz, uRainT) * uRainAmt : vec2(0.0);
          gPuddleN = normalize(vec3(-rp.x * 0.3, 1.0, -rp.y * 0.3));
          wn = normalize(mix(wn, gPuddleN, gPuddle));
        }
        normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.42, uWet * 0.85);
        roughnessFactor = mix(roughnessFactor, 0.08, gPuddle);`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        reflectedLight.indirectSpecular *= 1.0 - 0.75 * gPuddle;   // the probe is a clear dusk sky: puddles reflect the overcast instead (emissive below)`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float edge = smoothstep(0.35, 0.0, abs(bd - uBound));
        edge *= 1.0 - uCanyon * smoothstep(2.5, 6.0, vWorldPos.y);      // no build-limit line up on the mesa
        totalEmissiveRadiance += vec3(0.15, 0.55, 0.85) * edge * 0.7;
        vec2 gf = fract((vWorldPos.xz + uBound) * 0.5);
        float gd = min(min(gf.x, 1.0 - gf.x), min(gf.y, 1.0 - gf.y)) * 2.0;
        float aa = fwidth(gd);
        float gridLine = (1.0 - smoothstep(0.015, 0.015 + aa * 1.5, gd)) * min(1.0, 0.03 / max(aa, 1e-4));
        gridLine *= step(bd, uBound) * uGrid;
        totalEmissiveRadiance += vec3(0.2, 0.5, 0.7) * gridLine * 0.18;
        if (gPuddle > 0.01) {                                             // standing water mirrors the sky
          vec3 V = normalize(cameraPosition - vWorldPos);
          float fres = 0.08 + 0.5 * pow(1.0 - max(dot(gPuddleN, V), 0.0), 5.0);
          totalEmissiveRadiance += uSkyRefl * fres * gPuddle * (0.8 + 0.8 * min(1.0, (1.0 - gPuddleN.y) * 40.0));
        }`);
  };
  return mat;
}
