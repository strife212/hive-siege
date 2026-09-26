import * as THREE from 'three';
import { heightAt } from './terrain.js';

// Ground splatter decals. Each is a small subdivided patch draped over the heightfield so it hugs slopes, cut out by
// a canvas-drawn splat shape. Holds for HOLD seconds, fades over FADE seconds, then is removed.
//
// All of them are one mesh and one draw call. The mesh is a fixed pool of slots, SMALL ones for ordinary marks (the
// default 6 x 6 drape) and BIG ones for the finely draped burn scars, all in one set of buffers: a decal's patch is
// written into its slot once, when it lands, and its triangles are blanked when it goes. What changes from frame to
// frame (the fade, the dying ember glow) and its shine sit in a small float texture, one texel per slot, that the
// shader reads, so a frame uploads a couple of kilobytes. The three splat shapes share one texture. Scars are drawn
// under the marks (their slots come first); within each kind, slot order.
const HOLD = 10, FADE = 2, MAX_DECALS = 120, PER_FRAME = 6;
const SMALL = 128, SMALL_SEGS = 6, BIG = 32, BIG_SEGS = 28;
const SV = (SMALL_SEGS + 1) ** 2, SI = SMALL_SEGS * SMALL_SEGS * 6;     // vertices / indices per small slot
const BV = (BIG_SEGS + 1) ** 2, BI = BIG_SEGS * BIG_SEGS * 6;           // ... per big slot
const SLOTS = SMALL + BIG;
const decals = [];
let frameBudget = PER_FRAME;
let atlas = null, batch = null;
const GLOW = new THREE.Color(0xff5a18);                  // the ember colour (linear), times each scar's glow

// One splat shape, drawn at (ox, oy) in a size S cell of the atlas canvas.
function drawSplat(g, ox, oy, S, seed) {
  let r = seed;
  const rnd = () => { r = (r * 1664525 + 1013904223) >>> 0; return r / 4294967296; };
  const k = S / 256;
  const blob = (x, y, rad, a) => {
    const grad = g.createRadialGradient(ox + x * k, oy + y * k, rad * k * 0.2, ox + x * k, oy + y * k, rad * k);
    grad.addColorStop(0, `rgba(255,255,255,${a})`);
    grad.addColorStop(0.75, `rgba(255,255,255,${a * 0.85})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath(); g.arc(ox + x * k, oy + y * k, rad * k, 0, Math.PI * 2); g.fill();
  };
  g.save();
  g.beginPath(); g.rect(ox, oy, S, S); g.clip();          // each shape keeps to its own cell, as it did on its own canvas
  const cx = 128, cy = 128;
  blob(cx, cy, 52 + rnd() * 20, 1);
  for (let n = 0; n < 9; n++) {
    const a = rnd() * Math.PI * 2, d = 30 + rnd() * 60;
    blob(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 10 + rnd() * 26, 0.9);
  }
  for (let n = 0; n < 5; n++) {                          // droplet trails
    const a = rnd() * Math.PI * 2;
    let d = 40 + rnd() * 30, rad = 8 + rnd() * 6;
    for (let s = 0; s < 5; s++) { blob(cx + Math.cos(a) * d, cy + Math.sin(a) * d, rad, 0.85); d += rad * 1.6; rad *= 0.72; }
  }
  g.restore();
}
// The three shapes in a 2 x 2 atlas, each at the size it had on its own canvas.
function makeAtlas() {
  const S = 256, c = document.createElement('canvas');
  c.width = c.height = S * 2;
  const g = c.getContext('2d');
  [11, 29, 47].forEach((seed, i) => drawSplat(g, (i % 2) * S, Math.floor(i / 2) * S, S, seed));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

function makeBatch(scene) {
  const nv = SMALL * SV + BIG * BV, ni = SMALL * SI + BIG * BI;
  const geo = new THREE.BufferGeometry();
  const attr = (n) => new THREE.BufferAttribute(new Float32Array(nv * n), n).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', attr(3));
  geo.setAttribute('normal', attr(3));
  geo.setAttribute('uv', attr(2));
  geo.setAttribute('color', attr(3));
  const slotOf = new Float32Array(nv);                    // which texel of the per-slot data each vertex reads
  const slots = [];
  // big slots first, so scars draw under the marks
  let v = 0, i = 0;
  for (let s = 0; s < BIG; s++) { slots.push({ big: true, tex: SMALL + s, v0: v, i0: i, d: null }); slotOf.fill(SMALL + s, v, v + BV); v += BV; i += BI; }
  for (let s = 0; s < SMALL; s++) { slots.push({ big: false, tex: s, v0: v, i0: i, d: null }); slotOf.fill(s, v, v + SV); v += SV; i += SI; }
  geo.setAttribute('slot', new THREE.BufferAttribute(slotOf, 1));
  geo.setIndex(new THREE.BufferAttribute(new Uint16Array(ni), 1).setUsage(THREE.DynamicDrawUsage));   // all blank to start
  const dyn = new THREE.DataTexture(new Float32Array(SLOTS * 4), SLOTS, 1, THREE.RGBAFormat, THREE.FloatType);   // opacity, glow, roughness
  dyn.minFilter = dyn.magFilter = THREE.NearestFilter;
  dyn.needsUpdate = true;

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, alphaMap: atlas, transparent: true, metalness: 0, roughness: 1,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  mat.customProgramCacheKey = () => 'decal-batch';
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.tDyn = { value: dyn };
    shader.uniforms.uGlow = { value: GLOW };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float slot;
        uniform sampler2D tDyn;
        varying vec3 vDyn;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vDyn = texelFetch(tDyn, ivec2(int(slot), 0), 0).rgb;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uGlow;
        varying vec3 vDyn;`)
      .replace('#include <alphamap_fragment>', `#include <alphamap_fragment>
        diffuseColor.a *= vDyn.x;`)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = vDyn.z;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += uGlow * vDyn.y;`);
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  scene.add(mesh);
  return { mesh, geo, dyn, slots };
}

// The draped patch, as before: a subdivided square turned to `angle`, every vertex set on the ground under it.
function patchGeometry(x, z, size, angle, segs) {
  const geo = new THREE.PlaneGeometry(size, size, segs, segs);
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

// Write a decal's patch into its slot and upload just that range.
function fill(slot, geo, x, z, color, shape) {
  const g = batch.geo, v0 = slot.v0, n = geo.attributes.position.count;
  const P = g.attributes.position.array, N = g.attributes.normal.array, U = g.attributes.uv.array, C = g.attributes.color.array;
  const sp = geo.attributes.position.array, sn = geo.attributes.normal.array, su = geo.attributes.uv.array;
  const cu = shape % 2, cv = 1 - Math.floor(shape / 2);  // atlas cell; the canvas is flipped into the texture
  for (let k = 0; k < n; k++) {
    const a = (v0 + k) * 3, b = k * 3;
    P[a] = sp[b] + x; P[a + 1] = sp[b + 1]; P[a + 2] = sp[b + 2] + z;
    N[a] = sn[b]; N[a + 1] = sn[b + 1]; N[a + 2] = sn[b + 2];
    C[a] = color.r; C[a + 1] = color.g; C[a + 2] = color.b;
    U[(v0 + k) * 2] = (cu + su[k * 2]) * 0.5; U[(v0 + k) * 2 + 1] = (cv + su[k * 2 + 1]) * 0.5;
  }
  const idx = g.index.array, si = geo.index.array, cap = slot.big ? BI : SI;
  for (let k = 0; k < cap; k++) idx[slot.i0 + k] = k < si.length ? si[k] + v0 : 0;
  for (const [name, w] of [['position', 3], ['normal', 3], ['color', 3], ['uv', 2]]) {
    const at = g.attributes[name];
    at.addUpdateRange(v0 * w, n * w);
    at.needsUpdate = true;
  }
  g.index.addUpdateRange(slot.i0, cap);
  g.index.needsUpdate = true;
}
function blank(slot) {
  const g = batch.geo, cap = slot.big ? BI : SI;
  g.index.array.fill(0, slot.i0, slot.i0 + cap);
  g.index.addUpdateRange(slot.i0, cap);
  g.index.needsUpdate = true;
}
function setDyn(d) {
  const D = batch.dyn.image.data, o = d.slot.tex * 4;
  D[o] = d.opacity; D[o + 1] = d.glowNow; D[o + 2] = d.rough;
  batch.dyn.needsUpdate = true;
}

// o: hold / fade (seconds), opacity, rough, segs (drape resolution for big marks), glow (ember light that dies away
// over `glow` seconds), force (skip the per-frame budget)
function addDecal(scene, x, z, size, color, o = {}) {
  if (frameBudget <= 0 && !o.force) return;
  frameBudget--;
  atlas ??= makeAtlas();
  batch ??= makeBatch(scene);
  const segs = o.segs ?? SMALL_SEGS, big = segs > SMALL_SEGS;
  let slot = batch.slots.find((s) => s.big === big && !s.d);
  if (!slot) {                                           // that kind is full: the oldest of it makes room
    const old = decals.find((d) => d.slot.big === big);
    removeDecal(old); decals.splice(decals.indexOf(old), 1);
    slot = old.slot;
  }
  const shape = Math.floor(Math.random() * 3);
  const geo = patchGeometry(x, z, size, Math.random() * Math.PI * 2, Math.min(segs, BIG_SEGS));
  fill(slot, geo, x, z, color, shape);
  geo.dispose();
  const d = { slot, t: 0, hold: o.hold ?? HOLD, fade: o.fade ?? FADE, op: o.opacity ?? 1, opacity: o.opacity ?? 1,
    glow: o.glow ?? 0, glowI: o.glowI ?? 1.6, glowNow: o.glow ? (o.glowI ?? 1.6) : 0, rough: o.rough ?? 0.25 };
  slot.d = d;
  setDyn(d);
  decals.push(d);
  if (decals.length > MAX_DECALS) removeDecal(decals.shift());
}

function removeDecal(d) {
  blank(d.slot);
  d.slot.d = null;
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

// Long-lived burn scar for the big stuff (nuke): matte, finely draped, optionally glowing like embers at first.
export function spawnScar(scene, x, z, size, o = {}) {
  addDecal(scene, x, z, size, new THREE.Color(o.color ?? 0x120e0c), { rough: 0.95, segs: Math.min(28, Math.max(6, Math.round(size / 1.2))), force: true, ...o });
}

export function updateDecals(scene, dt) {
  frameBudget = PER_FRAME;
  for (let k = decals.length - 1; k >= 0; k--) {
    const d = decals[k];
    d.t += dt;
    if (d.t >= d.hold + d.fade) { removeDecal(d); decals.splice(k, 1); continue; }
    let changed = false;
    if (d.t > d.hold) { d.opacity = d.op * (1 - (d.t - d.hold) / d.fade); changed = true; }
    if (d.glow) { d.glowNow = d.glowI * Math.max(0, 1 - d.t / d.glow) ** 2; changed = true; }
    if (changed) setDyn(d);
  }
}
