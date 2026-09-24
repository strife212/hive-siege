import * as THREE from 'three';
import { heightAt } from './terrain.js';
import { state, damageEnemy, burst, eachEnemy } from './game.js';
import { spawnScorch } from './decals.js';
import { puff } from './particles.js';
import { audio } from './audio.js';
import { flashes } from './flashes.js';

// Shared combat effects: explosions, impact rings, railgun beams. Used by turrets and abilities alike.
const fx = [];
let scene = null;
const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const rnd = (a = 0, b = 1) => a + Math.random() * (b - a);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const easeOut = (p) => 1 - Math.pow(1 - clamp01(p), 3);

export function initEffects(s) { scene = s; }
export function addEffect(e) { fx.push(e); }
export function updateEffects(dt) {
  for (let k = fx.length - 1; k >= 0; k--) if (!fx[k].update(dt)) fx.splice(k, 1);
}

export function damageCircle(x, z, r, dmg, falloff = 0.4) {
  eachEnemy(x, z, r, (e, d2) => {
    const d = Math.sqrt(d2);
    damageEnemy(e, dmg * (d < r * 0.6 ? 1 : 1 - (1 - falloff) * (d - r * 0.6) / (r * 0.4)));
  });
}

// Small ground shockwave ring for splash impacts.
const impactRingGeo = new THREE.RingGeometry(0.75, 1, 20);
export function impactRing(x, y, z, radius) {
  const ring = new THREE.Mesh(impactRingGeo, new THREE.MeshBasicMaterial({ color: 0xffc080, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, y + 0.15, z);
  scene.add(ring);
  let t = 0;
  fx.push({ update(dt) {
    t += dt;
    const p = clamp01(t / 0.25);
    ring.scale.setScalar(0.3 + radius * easeOut(p));
    ring.material.opacity = 0.7 * (1 - p);
    if (p >= 1) { scene.remove(ring); ring.material.dispose(); return false; }
    return true;
  } });
}

// Generic explosion: flash, fireball, smoke, shockwave, debris, scorch, damage, shake, sound. The fireball and ring
// shapes are shared (each blast scales its own mesh); only the materials, which fade separately, are per blast.
const ballGeo = new THREE.SphereGeometry(1, 16, 12), blastRingGeo = new THREE.RingGeometry(0.85, 1, 32);
export function explode(x, z, size, dmg, radius, o = {}) {
  const y = heightAt(x, z);
  puff(x, y + size * 0.4, z, { color: 0xfff2c0, size: size * 3, life: 0.16, opacity: 1, additive: true });
  flashes.add(x, y + 1 + size * 0.5, z, { color: o.color ?? 0xff9a48, power: 24 * size, range: 7 + 5 * size, life: 0.35 + size * 0.12 });   // lights up its surroundings
  const ball = new THREE.Mesh(ballGeo,
    new THREE.MeshBasicMaterial({ color: o.color ?? 0xff8a30, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  ball.position.set(x, y + size * 0.35, z);
  scene.add(ball);
  const ring = new THREE.Mesh(blastRingGeo,
    new THREE.MeshBasicMaterial({ color: 0xffc080, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, y + 0.2, z);
  scene.add(ring);
  for (let k = 0; k < (o.smoke ?? 8); k++) {
    const a = rnd(0, Math.PI * 2), sp = rnd(1, 3) * size;
    puff(x, y + 0.3, z, { color: 0x3a342e, size: size * 1.2, grow: size * 1.5, life: rnd(1.2, 2), opacity: 0.55, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: rnd(2, 5) * size * 0.6, drag: 1.8 });
  }
  for (let k = 0; k < 6; k++) {
    const a = rnd(0, Math.PI * 2), sp = rnd(2, 5) * size;
    puff(x, y + 0.3, z, { color: 0xc9a070, size: size * 0.9, grow: size * 1.2, life: rnd(0.6, 1), opacity: 0.5, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: rnd(0.5, 1.5), drag: 2.5 });
  }
  burst(x, y + 0.5, z, 'debris', Math.round(4 * size), 10 * size);
  burst(x, y + 0.5, z, 'soil', Math.round(4 * size), 8 * size);
  spawnScorch(scene, x, z, radius * 1.3);
  damageCircle(x, z, radius, dmg);
  audio.play('explosion', { x, z, size: Math.min(2.5, size * 0.9), vol: Math.min(1, 0.45 + size * 0.2) });
  state.shake += (o.shake ?? size * 0.12);
  let t = 0;
  fx.push({
    update(dt) {
      t += dt;
      const p = clamp01(t / 0.45);
      ball.scale.setScalar(size * (0.3 + 0.7 * easeOut(p)));
      ball.material.opacity = 0.9 * (1 - p);
      ball.material.color.setHex(p < 0.4 ? 0xffd070 : (o.color ?? 0xff7020));
      ring.scale.setScalar(0.5 + radius * 1.6 * easeOut(clamp01(t / 0.5)));
      ring.material.opacity = 0.8 * (1 - clamp01(t / 0.5));
      if (t >= 0.6) { scene.remove(ball, ring); ball.material.dispose(); ring.material.dispose(); return false; }
      return true;
    },
  });
}

// Railgun bolt: a thick white core with a cyan sheath along a line, sparks where it passes, fades in 0.4 s.
const boltCoreGeo = new THREE.CylinderGeometry(0.16, 0.16, 1, 8, 1, true), boltSheathGeo = new THREE.CylinderGeometry(0.55, 0.55, 1, 12, 1, true);
export function railBeam(from, to) {
  const g = new THREE.Group();
  flashes.add(from.x, from.y, from.z, { color: 0x8fdcff, power: 40, range: 12, life: 0.4 });
  const core = new THREE.Mesh(boltCoreGeo,
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  const sheath = new THREE.Mesh(boltSheathGeo,
    new THREE.MeshBasicMaterial({ color: 0x6fd8ff, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide }));
  g.add(core, sheath);
  _v.subVectors(to, from);
  const len = _v.length();
  g.position.copy(from).addScaledVector(_v, 0.5);
  g.quaternion.setFromUnitVectors(UP, _v.clone().normalize());
  g.scale.set(1, len, 1);
  scene.add(g);
  for (let k = 0; k < 14; k++) {
    const u = Math.random();
    const px = from.x + _v.x * u, py = from.y + _v.y * u, pz = from.z + _v.z * u;
    puff(px, py, pz, { color: 0xbfefff, size: 0.5, life: rnd(0.25, 0.5), opacity: 0.9, additive: true, vx: rnd(-3, 3), vy: rnd(-1, 3), vz: rnd(-3, 3), grav: 8, drag: 0.5 });
  }
  let t = 0;
  fx.push({ update(dt) {
    t += dt;
    const p = clamp01(t / 0.4);
    g.scale.x = g.scale.z = 1 - p;
    core.material.opacity = 1 - p;
    if (p >= 1) { scene.remove(g); core.material.dispose(); sheath.material.dispose(); return false; }
    return true;
  } });
}
