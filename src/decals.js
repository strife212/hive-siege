import * as THREE from 'three';
import { heightAt } from './terrain.js';

// Ground splatter decals. Each is a small subdivided patch draped over the heightfield so it hugs slopes,
// with a canvas-drawn splat texture. Holds for HOLD seconds, fades over FADE seconds, then is removed.
const HOLD = 10, FADE = 2, MAX_DECALS = 120, PER_FRAME = 6;
const decals = [];
let frameBudget = PER_FRAME;
let textures = null;

function drawSplat(seed) {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  let r = seed;
  const rnd = () => { r = (r * 1664525 + 1013904223) >>> 0; return r / 4294967296; };
  const blob = (x, y, rad, a) => {
    const grad = g.createRadialGradient(x, y, rad * 0.2, x, y, rad);
    grad.addColorStop(0, `rgba(255,255,255,${a})`);
    grad.addColorStop(0.75, `rgba(255,255,255,${a * 0.85})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
  };
  const cx = S / 2, cy = S / 2;
  blob(cx, cy, 52 + rnd() * 20, 1);
  for (let k = 0; k < 9; k++) {
    const a = rnd() * Math.PI * 2, d = 30 + rnd() * 60;
    blob(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 10 + rnd() * 26, 0.9);
  }
  for (let k = 0; k < 5; k++) {                      // droplet trails
    const a = rnd() * Math.PI * 2;
    let d = 40 + rnd() * 30, rad = 8 + rnd() * 6;
    for (let s = 0; s < 5; s++) { blob(cx + Math.cos(a) * d, cy + Math.sin(a) * d, rad, 0.85); d += rad * 1.6; rad *= 0.72; }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

function ensureTextures() {
  if (!textures) textures = [drawSplat(11), drawSplat(29), drawSplat(47)];
  return textures;
}

function patchGeometry(x, z, size, angle) {
  const geo = new THREE.PlaneGeometry(size, size, 6, 6);
  geo.rotateX(-Math.PI / 2);
  geo.rotateY(angle);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const wx = x + p.getX(i), wz = z + p.getZ(i);
    p.setXYZ(i, p.getX(i), heightAt(wx, wz) + 0.05, p.getZ(i));
  }
  geo.computeVertexNormals();
  return geo;
}

function addDecal(scene, x, z, size, color) {
  if (frameBudget <= 0) return;
  frameBudget--;
  const tex = ensureTextures();
  const mat = new THREE.MeshStandardMaterial({
    color, alphaMap: tex[Math.floor(Math.random() * tex.length)], transparent: true, opacity: 1,
    roughness: 0.25, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(patchGeometry(x, z, size, Math.random() * Math.PI * 2), mat);
  mesh.position.set(x, 0, z);
  mesh.renderOrder = 1;
  scene.add(mesh);
  decals.push({ mesh, t: 0 });
  if (decals.length > MAX_DECALS) removeDecal(scene, decals.shift());
}

function removeDecal(scene, d) {
  scene.remove(d.mesh);
  d.mesh.geometry.dispose();
  d.mesh.material.dispose();
}

// One large splat under the kill plus a couple of smaller flung droplets.
export function spawnSplatter(scene, x, z, scale) {
  const color = new THREE.Color(0x8fe33a).offsetHSL((Math.random() - 0.5) * 0.04, 0, (Math.random() - 0.5) * 0.15);
  addDecal(scene, x, z, (1.8 + Math.random() * 0.8) * scale, color);
  const n = 1 + Math.floor(Math.random() * 2);
  for (let k = 0; k < n; k++) {
    const a = Math.random() * Math.PI * 2, d = (0.9 + Math.random() * 1.0) * scale;
    addDecal(scene, x + Math.cos(a) * d, z + Math.sin(a) * d, (0.5 + Math.random() * 0.5) * scale, color);
  }
}

// Dark scorch mark left by explosions and beam weapons.
export function spawnScorch(scene, x, z, size) {
  addDecal(scene, x, z, size, new THREE.Color(0x1a1512));
}

export function updateDecals(scene, dt) {
  frameBudget = PER_FRAME;
  for (let k = decals.length - 1; k >= 0; k--) {
    const d = decals[k];
    d.t += dt;
    if (d.t >= HOLD + FADE) { removeDecal(scene, d); decals.splice(k, 1); continue; }
    if (d.t > HOLD) d.mesh.material.opacity = 1 - (d.t - HOLD) / FADE;
  }
}
