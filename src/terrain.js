import * as THREE from 'three';
import { simplex, fbm, ridged } from './noise.js';
import { HALF, CELL, CELLS, FLAT } from './config.js';
import { generateTerrainTextures } from './textures.js';

export const EXTENT = FLAT + 60;    // half-size of the rendered world (basin is FLAT, build area is HALF)
const SPACING = 0.5;

export function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// Analytic height so entities never need to raycast the mesh.
export function heightAt(x, z) {
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
        uniform float uBound; uniform float uFlat; uniform float uGrid;
        varying vec3 vSplat; varying vec3 vWorldPos; varying vec3 vWNormal;
        vec3 sample2(sampler2D t, vec2 a, vec2 b) { return mix(texture2D(t, a).rgb, texture2D(t, b).rgb, 0.5); }`)
      .replace('#include <map_fragment>', `
        vec2 uvA = vWorldPos.xz * 0.22;
        vec2 uvB = vWorldPos.xz * 0.071 + vec2(0.37, 0.71);
        vec3 w = vSplat / max(0.001, vSplat.x + vSplat.y + vSplat.z);
        vec3 albedo = sample2(tSoil, uvA, uvB) * w.x + sample2(tRock, uvA, uvB) * w.y + sample2(tMoss, uvA, uvB) * w.z;
        float bd = max(abs(vWorldPos.x), abs(vWorldPos.z));
        albedo *= mix(1.0, 0.86, smoothstep(uBound, uBound + 6.0, bd));
        albedo *= mix(1.0, 0.6, smoothstep(uFlat, uFlat + 12.0, bd));
        diffuseColor.rgb *= albedo;`)
      .replace('#include <normal_fragment_maps>', `
        vec3 mapN = (sample2(tSoilN, uvA, uvB) * w.x + sample2(tRockN, uvA, uvB) * w.y + sample2(tMossN, uvA, uvB) * w.z) * 2.0 - 1.0;
        vec3 Nw = normalize(vWNormal);
        vec3 Bw = normalize(cross(vec3(1.0, 0.0, 0.0), Nw));
        vec3 Tw = normalize(cross(Nw, Bw));
        vec3 wn = normalize(Tw * mapN.x + Bw * mapN.y + Nw * mapN.z);
        normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float edge = smoothstep(0.35, 0.0, abs(bd - uBound));
        totalEmissiveRadiance += vec3(0.15, 0.55, 0.85) * edge * 0.7;
        vec2 gf = fract((vWorldPos.xz + uBound) * 0.5);
        float gd = min(min(gf.x, 1.0 - gf.x), min(gf.y, 1.0 - gf.y)) * 2.0;
        float aa = fwidth(gd);
        float gridLine = (1.0 - smoothstep(0.015, 0.015 + aa * 1.5, gd)) * min(1.0, 0.03 / max(aa, 1e-4));
        gridLine *= step(bd, uBound) * uGrid;
        totalEmissiveRadiance += vec3(0.2, 0.5, 0.7) * gridLine * 0.18;`);
  };
  return mat;
}
