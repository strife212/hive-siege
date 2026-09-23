import * as THREE from 'three';
import { puff } from './particles.js';
import { audio } from './audio.js';
import { heightAt } from './terrain.js';
import { spawnSplatter } from './decals.js';
import { flashes } from './flashes.js';

// Acid Spitter ordnance: a glowing glob lobbed on a ballistic arc at a building. It stretches along its flight, sheds
// a toxic trail and drips, bursts on impact, and leaves the hit spot sizzling for a moment. Buildings do not move,
// so the arc is solved once at launch and lands exactly where it was aimed. If the building is gone or has sunk
// under its blast doors by then, the glob carries on down and spatters the ground instead.
const G = 20;
const globs = [];
const sizzles = [];
let scene = null, geo = null, mat = null;
const _up = new THREE.Vector3(0, 1, 0), _v = new THREE.Vector3();
const rnd = (a, b) => a + Math.random() * (b - a);
const alive = (s) => s && s.hp > 0 && !s.buried;

function splash(x, y, z, k) {
  for (let i = 0; i < 12; i++) {
    const a = rnd(0, 6.3), sp = rnd(1.5, 4.5) * k;
    puff(x, y, z, { color: 0x9cf23a, size: rnd(0.18, 0.36) * k, life: rnd(0.35, 0.65), opacity: 0.9, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: rnd(1.5, 4.5), grav: 16, drag: 0.8 });
  }
  puff(x, y, z, { color: 0xd4ff7a, size: 1.5 * k, grow: 4, life: 0.22, opacity: 0.8, additive: true });
  flashes.add(x, y + 0.3, z, { color: 0x9dff3a, power: 6 * k, range: 4.5, life: 0.35 });
}

export const acid = {
  init(s) {
    scene = s;
    geo = new THREE.SphereGeometry(0.17, 10, 8);
    mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xa6ff2e).multiplyScalar(2.4) });   // over 1: blooms
  },

  // Lob a glob from (x, y, z) at building s.
  fire(x, y, z, s, damage) {
    const big = s.cells && s.cells.length > 1;
    // land on the face toward the spitter (a splash at the centre would be buried inside the model)
    const d = Math.hypot(s.x - x, s.z - z) || 1, back = s.type === 'core' ? 1.7 : big ? 1.3 : 0.62;
    const side = rnd(-0.3, 0.3) * (big ? 2 : 1);
    const tx = s.x - (s.x - x) / d * back - (s.z - z) / d * side, tz = s.z - (s.z - z) / d * back + (s.x - x) / d * side;
    const ty = s.y + (s.type === 'core' ? 2.2 : big ? 1.2 : 0.75) + rnd(-0.15, 0.15);
    const T = 0.45 + Math.hypot(tx - x, tz - z) * 0.05;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    scene.add(mesh);
    globs.push({ mesh, s, damage, t: 0, T, vx: (tx - x) / T, vy: (ty - y + 0.5 * G * T * T) / T, vz: (tz - z) / T, trail: 0 });
    puff(x, y, z, { color: 0xc8ff5a, size: 0.8, grow: 2.5, life: 0.14, opacity: 0.8, additive: true });
    audio.play('acid_spit', { x, z, vol: 0.45 });
  },

  update(dt, hit) {
    for (let k = globs.length - 1; k >= 0; k--) {
      const g = globs[k], m = g.mesh;
      const falling = g.t >= g.T;                             // past the aim point: the target went away
      g.t += dt;
      g.vy -= G * dt;
      m.position.x += g.vx * dt; m.position.y += g.vy * dt; m.position.z += g.vz * dt;
      m.quaternion.setFromUnitVectors(_up, _v.set(g.vx, g.vy, g.vz).normalize());
      const wob = 1 + 0.12 * Math.sin(g.t * 38);
      m.scale.set(wob, 1.55, 2 - wob);
      g.trail -= dt;
      if (g.trail <= 0) {
        g.trail = 0.025;
        puff(m.position.x, m.position.y, m.position.z, { color: 0x8fe33a, size: rnd(0.3, 0.45), grow: 0.8, life: 0.32, opacity: 0.45, additive: true });
        if (Math.random() < 0.3) puff(m.position.x, m.position.y, m.position.z, { color: 0x6aa81e, size: 0.12, life: 0.5, opacity: 0.9, grav: 18, vy: -0.5 });   // drips
      }
      const ground = heightAt(m.position.x, m.position.z);
      let landed = false;
      if (!falling && g.t >= g.T && alive(g.s)) {
        hit(g.s, g.damage);
        splash(m.position.x, m.position.y, m.position.z, 1);
        sizzles.push({ x: m.position.x, y: m.position.y, z: m.position.z, t: 1.6, next: 0 });
        audio.play('acid_hit', { x: m.position.x, z: m.position.z, vol: 0.35 });
        landed = true;
      } else if (m.position.y <= ground) {
        splash(m.position.x, ground + 0.1, m.position.z, 0.8);
        spawnSplatter(scene, m.position.x, m.position.z, 0.45);
        audio.play('acid_hit', { x: m.position.x, z: m.position.z, vol: 0.25 });
        landed = true;
      }
      if (landed) { scene.remove(m); globs.splice(k, 1); }
    }
    for (let k = sizzles.length - 1; k >= 0; k--) {           // corroding: fumes curl off the hit spot
      const f = sizzles[k];
      f.t -= dt; f.next -= dt;
      if (f.t <= 0) { sizzles.splice(k, 1); continue; }
      if (f.next <= 0) {
        f.next = 0.14;
        puff(f.x + rnd(-0.25, 0.25), f.y, f.z + rnd(-0.25, 0.25), { color: 0x94b85a, color2: 0x4a5040, size: 0.35, grow: 1.3, life: 1.1, opacity: 0.4 * Math.min(1, f.t), fadeIn: 0.15, vy: 1.1, drag: 1 });
      }
    }
  },

  count: () => globs.length,
};
