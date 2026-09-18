import * as THREE from 'three';
import { fbm } from './noise.js';
import { MAP_SIZE, HALF, CELL, CELLS } from './config.js';

export function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// Analytic height so entities never need to raycast the mesh.
export function heightAt(x, z) {
  const r = Math.hypot(x, z);
  const mask = 0.15 + 0.85 * smoothstep(7, 24, r);   // flatter plateau around the Core
  const n = fbm(x * 0.05 + 37.1, z * 0.05 + 11.7, 4, 3) - 0.5;
  const rim = smoothstep(30, 40, r) * 1.5;
  return n * 8 * mask + rim;
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

export function createTerrain() {
  const seg = 160;
  const verts = [], colors = [], idx = [];
  const low = new THREE.Color(0x2a2140), mid = new THREE.Color(0x6e5b3c);
  const high = new THREE.Color(0x8a8a8a), moss = new THREE.Color(0x4e6b3a);
  const c = new THREE.Color();

  for (let j = 0; j <= seg; j++) {
    for (let i = 0; i <= seg; i++) {
      const x = (i / seg) * MAP_SIZE - HALF;
      const z = (j / seg) * MAP_SIZE - HALF;
      const y = heightAt(x, z);
      verts.push(x, y, z);
      c.copy(low).lerp(mid, smoothstep(-2.5, 0, y)).lerp(high, smoothstep(1.5, 3.5, y));
      const m = fbm(x * 0.2, z * 0.2, 2, 9);
      if (m > 0.55 && y < 2) c.lerp(moss, Math.min(1, (m - 0.55) * 3));
      colors.push(c.r, c.g, c.b);
    }
  }
  for (let j = 0; j < seg; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * (seg + 1) + i, b = a + 1, cc = a + seg + 1, d = cc + 1;
      idx.push(a, cc, b, b, cc, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}
