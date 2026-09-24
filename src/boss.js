import * as THREE from 'three';
import { state, damageStructure, burst, log } from './game.js';
import { heightAt, confine } from './terrain.js';
import { spawnSplatter } from './decals.js';
import { explode } from './effects.js';
import { puff } from './particles.js';
import { audio } from './audio.js';

// The Colossus: a boss bug on eight very long, spindly legs. Its body rides far above the ground, so it simply steps
// over walls and towers on its way to the Core. Legs are procedural: every foot stays planted until the body has
// moved far enough, then swings to a new spot ahead (two-bone IK with the knee held high, spider style).
const BODY_H = 7.6, FEMUR = 8.6, TIBIA = 11.2, STEP_AT = 3.0, STEP_TIME = 0.5, REACH = 6.2;
const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Quaternion();
const rnd = (a, b) => a + Math.random() * (b - a);
const ease = (u) => u * u * (3 - 2 * u);

const geo = {
  unit: new THREE.SphereGeometry(1, 20, 14),
  femur: new THREE.CylinderGeometry(0.15, 0.24, 1, 8).translate(0, 0.5, 0),
  tibia: new THREE.CylinderGeometry(0.035, 0.17, 1, 8).translate(0, 0.5, 0),
  knee: new THREE.SphereGeometry(0.3, 10, 8),
  kneeSpike: new THREE.ConeGeometry(0.13, 0.9, 6).translate(0, 0.45, 0),
  spike: new THREE.ConeGeometry(0.22, 1.5, 6).translate(0, 0.75, 0),
  mandible: new THREE.ConeGeometry(0.2, 1.9, 6).translate(0, 0.95, 0).rotateX(Math.PI / 2),
  plate: new THREE.SphereGeometry(1, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2),
};

function materials() {
  return {
    chitin: new THREE.MeshPhysicalMaterial({ color: 0x3b1a2c, roughness: 0.45, metalness: 0.15, clearcoat: 0.6, clearcoatRoughness: 0.3, emissive: 0xff5a20, emissiveIntensity: 0 }),
    plate: new THREE.MeshPhysicalMaterial({ color: 0x160a12, roughness: 0.35, metalness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.25, emissive: 0xff5a20, emissiveIntensity: 0 }),
    leg: new THREE.MeshPhysicalMaterial({ color: 0x1c0d18, roughness: 0.4, metalness: 0.25, clearcoat: 0.7, clearcoatRoughness: 0.3 }),
    glow: new THREE.MeshStandardMaterial({ color: 0xffa050, emissive: 0xff6a1a, emissiveIntensity: 2.2 }),
    eye: new THREE.MeshStandardMaterial({ color: 0xff5040, emissive: 0xff2a10, emissiveIntensity: 3.2 }),
    bone: new THREE.MeshStandardMaterial({ color: 0xd9c9a8, roughness: 0.5 }),
  };
}

function makeBoss() {
  const m = materials();
  const root = new THREE.Group();                                // stays at the world origin: legs are posed in world space
  const body = new THREE.Group();
  root.add(body);
  const add = (g, mat, x, y, z, sx, sy, sz, parent = body) => { const o = new THREE.Mesh(g, mat); o.position.set(x, y, z); o.scale.set(sx, sy, sz); o.castShadow = o.receiveShadow = true; parent.add(o); return o; };

  add(geo.unit, m.chitin, 0, 0, 0.4, 1.7, 1.25, 2.3);                                         // thorax
  add(geo.plate, m.plate, 0, 0.35, 0.5, 1.85, 1.2, 2.5);
  const abdomen = new THREE.Group();
  abdomen.position.set(0, 0.5, -1.4);
  abdomen.rotation.x = -0.22;
  body.add(abdomen);
  add(geo.unit, m.chitin, 0, 0, -2.6, 2.4, 2.0, 3.5, abdomen);
  for (let k = 0; k < 5; k++) add(geo.plate, m.plate, 0, 0.5 - k * 0.05, -0.4 - k * 1.15, 2.5 - k * 0.22, 1.9 - k * 0.12, 1.2, abdomen).rotation.x = -0.25;
  const sacs = [];
  for (let k = 0; k < 7; k++) sacs.push(add(geo.unit, m.glow, (k % 2 ? 1 : -1) * (0.7 + (k % 3) * 0.35), -1.35 + (k % 2) * 0.2, -1.0 - k * 0.62, 0.5, 0.42, 0.55, abdomen));
  for (let k = 0; k < 6; k++) {                                                                // dorsal spines
    const s = add(geo.spike, m.bone, 0, 1.2 + (k < 2 ? 0 : 0.7), 1.2 - k * 1.25, 1, 1 + (k % 2) * 0.4, 1, body);
    s.rotation.x = -0.5;
  }
  const head = new THREE.Group();
  head.position.set(0, -0.25, 2.7);
  body.add(head);
  add(geo.unit, m.chitin, 0, 0, 0.2, 1.15, 0.85, 1.25, head);
  add(geo.plate, m.plate, 0, 0.2, 0.1, 1.25, 0.8, 1.35, head);
  for (const s of [-1, 1]) for (let k = 0; k < 3; k++) add(geo.unit, m.eye, s * (0.45 + k * 0.22), 0.3 - k * 0.12, 1.15 - k * 0.3, 0.16, 0.16, 0.16, head);
  const mandibles = [-1, 1].map((s) => {
    const p = new THREE.Group();
    p.position.set(s * 0.55, -0.35, 1.1);
    const c = add(geo.mandible, m.bone, 0, 0, 0, 1, 1, 1, p);
    c.rotation.y = -s * 0.5;
    head.add(p);
    return p;
  });

  // legs: [side, row]. Hips on the thorax, feet fanned around the body.
  const legs = [];
  for (const side of [-1, 1]) for (let row = 0; row < 4; row++) {
    const femur = add(geo.femur, m.leg, 0, 0, 0, 1, 1, 1, root), tibia = add(geo.tibia, m.leg, 0, 0, 0, 1, 1, 1, root);
    const knee = add(geo.knee, m.plate, 0, 0, 0, 1, 1, 1, root), barb = add(geo.kneeSpike, m.bone, 0, 0, 0, 1, 1, 1, root);
    const ang = side * (0.42 + row * 0.66);                                                    // fan from front to back
    legs.push({ femur, tibia, knee, barb, side, row, hip: new THREE.Vector3(side * 1.25, -0.3, 1.9 - row * 1.0), ang, rad: row === 0 ? 8.6 : 7.4 + (row % 2) * 0.8,
      foot: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), stepT: -1, group: (row + (side > 0 ? 0 : 1)) % 2, strike: -1, slack: 0 });
  }
  return { root, body, abdomen, head, mandibles, sacs, legs, mats: m };
}

const segment = (mesh, from, to) => {
  _a.subVectors(to, from);
  const len = _a.length() || 1e-3;
  mesh.position.copy(from);
  mesh.scale.set(1, len, 1);
  mesh.quaternion.setFromUnitVectors(UP, _a.multiplyScalar(1 / len));
};

// Two-bone IK in the vertical plane through hip and foot; `slack` (0..1) lets the knee sag for the death sprawl.
function poseLeg(leg, hipW) {
  _b.subVectors(leg.foot, hipW);
  let d = _b.length();
  const max = FEMUR + TIBIA - 0.05;
  if (d > max) { _b.multiplyScalar(max / d); d = max; leg.foot.copy(hipW).add(_b); }
  const dir = _b.multiplyScalar(1 / d);
  const along = (FEMUR * FEMUR - TIBIA * TIBIA + d * d) / (2 * d);
  const rise = Math.sqrt(Math.max(0, FEMUR * FEMUR - along * along)) * (1 - leg.slack * 0.82);
  _c.copy(UP).addScaledVector(dir, -UP.dot(dir)).normalize();                                  // "up", perpendicular to the leg line
  _d.copy(hipW).addScaledVector(dir, along).addScaledVector(_c, rise);
  const floor = heightAt(_d.x, _d.z) + 0.3;
  if (_d.y < floor) _d.y = floor;
  segment(leg.femur, hipW, _d);
  segment(leg.tibia, _d, leg.foot);
  leg.knee.position.copy(_d);
  leg.barb.position.copy(_d);
  leg.barb.quaternion.copy(leg.femur.quaternion);
}

const hud = { el: null, fill: null, name: null };
function showBar(e) {
  if (!hud.el) { hud.el = document.getElementById('bossbar'); hud.fill = document.getElementById('bossfill'); hud.name = document.getElementById('bossname'); }
  if (!hud.el) return;
  hud.el.hidden = !e;
  if (e) { hud.name.textContent = e.def.name.toUpperCase(); hud.fill.style.width = `${Math.max(0, e.hp / e.maxHp) * 100}%`; }
}

const dying = [];

export const boss = {
  // Called by spawnEnemy for defs flagged boss: builds the rig and plants the feet around the burrow.
  init(e) {
    const rig = makeBoss();
    state.scene.add(rig.root);
    e.rig = rig;
    e.boss = true;
    e.emerge = 0;
    e.yaw = Math.atan2(-e.x, -e.z);
    e.aimH = 0.5;
    e.strikeLeg = 0;
    e.lastHp = e.hp;
    for (const leg of rig.legs) {
      const a = e.yaw + leg.ang;
      leg.foot.set(e.x + Math.sin(a) * leg.rad * 0.8, 0, e.z + Math.cos(a) * leg.rad * 0.8);
      leg.foot.y = heightAt(leg.foot.x, leg.foot.z);
    }
    audio.play('boss_roar', { x: e.x, z: e.z, vol: 1 });
    state.shake += 0.8;
    log(`A ${e.def.name} is clawing its way out of the ground!`, true);
  },

  update(e, dt) {
    const rig = e.rig, core = state.core;
    const ground = heightAt(e.x, e.z);
    // --- burrowing out: the body heaves up between its planted legs
    let height = BODY_H;
    if (e.emerge < 1) {
      e.emerge = Math.min(1, e.emerge + dt / 3.6);
      height = -2.5 + (BODY_H + 2.5) * ease(e.emerge);
      state.shake = Math.max(state.shake, 0.35 * (1 - e.emerge));
      if (Math.random() < dt * 30) {
        const a = rnd(0, Math.PI * 2), r = rnd(0.5, 4);
        puff(e.x + Math.cos(a) * r, ground + 0.4, e.z + Math.sin(a) * r, { color: 0x8a6a48, size: rnd(1.5, 3), grow: 2.5, life: rnd(0.8, 1.6), opacity: 0.55, vx: Math.cos(a) * 3, vz: Math.sin(a) * 3, vy: rnd(1, 4), drag: 1.5 });
        if (Math.random() < 0.3) burst(e.x + Math.cos(a) * r, ground + 0.3, e.z + Math.sin(a) * r, 'soil', 3, 7);
      }
    }

    // --- walk straight at the Core, over anything in the way; stop within striking distance
    const dx = core.x - e.x, dz = core.z - e.z, dist = Math.hypot(dx, dz) || 1;
    const attacking = dist < REACH && !e.held;
    let speed = 0;
    if (e.held) { height += e.held.lift; e.walk += dt * 6; }  // hauled across the ground by a black hole (blackhole.js moves it)
    else if (e.emerge >= 1 && !attacking) {
      speed = e.speed;                                      // its own speed: carries the hive's adaptation (game.js)
      e.x += dx / dist * speed * dt; e.z += dz / dist * speed * dt;
      confine(e);
      e.walk += speed * dt;
    }
    e.fx = dx; e.fz = dz;
    e.yaw += Math.atan2(Math.sin(Math.atan2(dx, dz) - e.yaw), Math.cos(Math.atan2(dx, dz) - e.yaw)) * Math.min(1, dt * 1.5);

    // --- body: breathing bob, sway with the gait, rear up to strike
    const t = state.time;
    const stepping = rig.legs.reduce((n, l) => n + (l.stepT >= 0 ? 1 : 0), 0);
    const bob = Math.sin(t * 1.6) * 0.18 + (speed ? Math.sin(e.walk * 1.4) * 0.22 : 0);
    e.rear = (e.rear ?? 0) + ((attacking ? 1 : 0) - (e.rear ?? 0)) * Math.min(1, dt * 2);
    rig.body.position.set(e.x, ground + height + bob + e.rear * 1.2, e.z);
    rig.body.rotation.set(-0.06 - e.rear * 0.38 + Math.sin(t * 1.1) * 0.02, e.yaw, Math.sin(e.walk * 0.7) * 0.05 * (speed ? 1 : 0.2), 'YXZ');
    rig.abdomen.rotation.x = -0.22 + Math.sin(t * 2.1) * 0.05;
    rig.abdomen.scale.setScalar(1 + Math.sin(t * 2.6) * 0.025);
    rig.head.rotation.set(Math.sin(t * 0.9) * 0.08 + e.rear * 0.3, Math.sin(t * 0.6) * (attacking ? 0.1 : 0.35), 0);
    const chomp = (attacking ? 0.5 : 0.25) + Math.sin(t * (attacking ? 9 : 3)) * (attacking ? 0.35 : 0.15);
    rig.mandibles[0].rotation.y = chomp; rig.mandibles[1].rotation.y = -chomp;
    const pulse = 1.6 + Math.sin(t * 3) * 0.7;
    rig.mats.glow.emissiveIntensity = pulse;
    e.aimH = rig.body.position.y - ground;

    // hit flash: the shell flares where rounds are landing
    if (e.lastHp - e.hp > 4) e.flash = Math.min(1, (e.flash ?? 0) + 0.35);   // real hits flash; damage-over-time (fire, black hole) does not
    e.lastHp = e.hp;
    e.flash = Math.max(0, (e.flash ?? 0) - dt * 4);
    rig.mats.chitin.emissiveIntensity = rig.mats.plate.emissiveIntensity = e.flash * 0.9 + (e.burn ? 0.25 : 0);

    // --- legs
    rig.body.updateMatrixWorld();
    const sinY = Math.sin(e.yaw), cosY = Math.cos(e.yaw);
    for (const leg of rig.legs) {
      const hipW = _a.copy(leg.hip).applyMatrix4(rig.body.matrixWorld).clone();
      const a = e.yaw + leg.ang, lead = speed ? 2.6 : 0;
      const hx = e.x + Math.sin(a) * leg.rad + sinY * lead, hz = e.z + Math.cos(a) * leg.rad + cosY * lead;
      if (leg.strike >= 0) {                                       // front leg stabbing the Core
        leg.strike += dt / 0.62;
        const u = leg.strike, top = _c.set(core.x + leg.side * 0.8, core.y + 6.5, core.z);
        if (u < 0.55) leg.foot.lerpVectors(leg.from, _d.set(hx * 0.4 + core.x * 0.6, ground + 13, hz * 0.4 + core.z * 0.6), ease(u / 0.55));
        else if (u < 0.75) { leg.foot.lerpVectors(_d.set(hx * 0.4 + core.x * 0.6, ground + 13, hz * 0.4 + core.z * 0.6), top, (u - 0.55) / 0.2); }
        else if (!leg.hit) {
          leg.hit = true;
          damageStructure(core, e.def.damage);
          burst(top.x, top.y, top.z, 'debris', 10, 8);
          puff(top.x, top.y, top.z, { color: 0xffc070, size: 2.4, life: 0.14, opacity: 0.9, additive: true });
          audio.play('hub_land', { x: core.x, z: core.z, vol: 0.55, rate: 1.5 });
          state.shake += 0.35;
        }
        if (u >= 1.25) { leg.strike = -1; leg.hit = false; leg.from.copy(leg.foot); leg.to.set(hx, heightAt(hx, hz), hz); leg.stepT = 0; }
      } else if (leg.stepT >= 0) {                                  // swinging to a new foothold
        leg.stepT += dt / STEP_TIME;
        const u = Math.min(1, leg.stepT);
        leg.foot.lerpVectors(leg.from, leg.to, ease(u));
        leg.foot.y += Math.sin(u * Math.PI) * 3.4;
        if (u >= 1) {
          leg.stepT = -1;
          leg.foot.copy(leg.to);
          audio.play('boss_step', { x: leg.foot.x, z: leg.foot.z, vol: 0.5 });
          state.shake += 0.05;
          for (let k = 0; k < 4; k++) { const pa = rnd(0, Math.PI * 2); puff(leg.foot.x, leg.foot.y + 0.3, leg.foot.z, { color: 0xb59468, size: rnd(1, 1.8), grow: 2, life: rnd(0.6, 1.1), opacity: 0.5, vx: Math.cos(pa) * 3, vz: Math.sin(pa) * 3, vy: 1, drag: 2 }); }
        }
      } else {
        const off = Math.hypot(leg.foot.x - hx, leg.foot.z - hz);
        const othersBusy = rig.legs.some((o) => o.group !== leg.group && o.stepT >= 0);
        if (off > STEP_AT * 1.9 || (off > STEP_AT && !othersBusy && stepping < 4)) {
          leg.from.copy(leg.foot);
          leg.to.set(hx, heightAt(hx, hz), hz);
          leg.stepT = 0;
        }
      }
      poseLeg(leg, hipW);
    }

    // --- the strike itself: alternate front legs on the attack timer
    if (attacking && e.emerge >= 1) {
      e.attackCd -= dt;
      if (e.attackCd <= 0) {
        e.attackCd = 1 / e.def.attackRate;
        const front = rig.legs.filter((l) => l.row === 0)[e.strikeLeg++ % 2];
        if (front.strike < 0) { front.strike = 0; front.stepT = -1; front.from.copy(front.foot); }
      }
    }
    showBar(e);
  },

  // Killed: hand the rig over to the death sequence (the enemy entry itself is compacted away by the game).
  die(e) {
    showBar(null);
    const rig = e.rig;
    dying.push({ rig, x: e.x, z: e.z, yaw: e.yaw, t: 0, y: rig.body.position.y, vy: 0, fell: false, burstDone: false, roll: rnd(-1, 1) > 0 ? 1 : -1, fx: 0 });
    audio.play('boss_roar', { x: e.x, z: e.z, vol: 1, rate: 0.8 });
    log(`${e.def.name} destroyed! +${e.def.reward} credits`);
  },

  // Death: convulsions and ruptures while the legs give out one by one, the fall, the abdomen swelling and
  // bursting, then the husk sinking away.
  updateDying(dt) {
    for (let k = dying.length - 1; k >= 0; k--) {
      const d = dying[k], rig = d.rig, ground = heightAt(d.x, d.z);
      d.t += dt;
      const t = d.t;
      if (t < 2.4) {                                               // death throes
        const weak = ease(t / 2.4);
        d.y += (ground + BODY_H * (1 - 0.45 * weak) - d.y) * Math.min(1, dt * 3);
        rig.body.position.set(d.x + rnd(-1, 1) * 0.12, d.y + rnd(-1, 1) * 0.1, d.z + rnd(-1, 1) * 0.12);
        rig.body.rotation.set(-0.06 + Math.sin(t * 17) * 0.06 + weak * 0.2, d.yaw + Math.sin(t * 11) * 0.05, d.roll * weak * 0.45 + Math.sin(t * 23) * 0.04, 'YXZ');
        rig.mandibles[0].rotation.y = 0.9 + Math.sin(t * 30) * 0.2; rig.mandibles[1].rotation.y = -0.9 - Math.sin(t * 30) * 0.2;
        rig.mats.glow.emissiveIntensity = 2 + Math.random() * 4;
        rig.mats.chitin.emissiveIntensity = rig.mats.plate.emissiveIntensity = 0.08 + Math.random() * 0.3 * weak;   // fires flickering under the shell
        d.fx -= dt;
        if (d.fx <= 0) {                                            // ruptures along the hull
          d.fx = rnd(0.12, 0.3);
          rig.body.localToWorld(_a.set(rnd(-1.8, 1.8), rnd(-0.5, 1.5), rnd(-5, 2.5)));
          puff(_a.x, _a.y, _a.z, { color: 0xffb060, size: rnd(1.5, 3), life: 0.16, opacity: 0.95, additive: true, priority: true });
          puff(_a.x, _a.y, _a.z, { color: 0x9be04a, size: rnd(1.2, 2.2), grow: 3, life: rnd(0.6, 1), opacity: 0.6, vy: 2 });
          burst(_a.x, _a.y, _a.z, 'ichor', 5, 9);
          audio.play('explosion', { x: d.x, z: d.z, vol: 0.4, size: 0.5 });
          state.shake += 0.12;
        }
        rig.legs.forEach((leg, i) => {                              // legs give way in turn, feet skidding outward
          const give = Math.max(0, Math.min(1, (t - 0.25 * i) / 0.9));
          leg.slack = give * 0.5;
          if (give > 0 && give < 1) { leg.foot.x += (leg.foot.x - d.x) * dt * 0.25; leg.foot.z += (leg.foot.z - d.z) * dt * 0.25; leg.foot.y = heightAt(leg.foot.x, leg.foot.z) + Math.abs(Math.sin(t * 25 + i)) * 0.35; }
        });
      } else if (!d.fell) {                                         // the fall
        d.vy -= 30 * dt;
        d.y += d.vy * dt;
        if (d.y <= ground + 1.5) {
          d.y = ground + 1.5; d.fell = true; d.fallT = t;
          explode(d.x, d.z, 3.2, 0, 0, { shake: 1.3, smoke: 12 });
          audio.play('hub_land', { x: d.x, z: d.z, vol: 1 });
          for (let n = 0; n < 40; n++) { const a = rnd(0, Math.PI * 2); puff(d.x + Math.cos(a) * 3, ground + 0.5, d.z + Math.sin(a) * 3, { color: 0xb59468, size: rnd(2, 4), grow: 3, life: rnd(1.2, 2.2), opacity: 0.55, vx: Math.cos(a) * rnd(6, 14), vz: Math.sin(a) * rnd(6, 14), vy: rnd(0.5, 2.5), drag: 2, priority: true }); }
          for (let n = 0; n < 5; n++) spawnSplatter(state.scene, d.x + rnd(-4, 4), d.z + rnd(-4, 4), rnd(2, 3.2));
          burst(d.x, ground + 1.5, d.z, 'ichor', 30, 14);
        }
        rig.body.position.set(d.x, d.y, d.z);
        rig.body.rotation.z += d.roll * dt * 0.6;
      } else {
        const since = t - d.fallT;
        for (const leg of rig.legs) { leg.slack = Math.min(1, leg.slack + dt * 1.6); leg.foot.x += (leg.foot.x - d.x) * dt * 0.5 * Math.max(0, 1 - since); leg.foot.z += (leg.foot.z - d.z) * dt * 0.5 * Math.max(0, 1 - since); leg.foot.y = heightAt(leg.foot.x, leg.foot.z); }
        if (!d.burstDone) {                                         // abdomen swells, glows, and goes
          const swell = Math.min(1, since / 1.3);
          rig.abdomen.scale.setScalar(1 + swell * swell * 0.45 + Math.sin(t * 40) * 0.02 * swell);
          rig.mats.glow.emissiveIntensity = 2 + swell * 9;
          rig.mats.chitin.emissiveIntensity = swell * 0.8;
          if (since >= 1.3) {
            d.burstDone = true;
            rig.abdomen.visible = false;
            rig.body.localToWorld(_a.set(0, 0.5, -4));
            explode(_a.x, _a.z, 4.2, 220, 8, { shake: 1.6, smoke: 16, color: 0xa8ff50 });
            for (let n = 0; n < 4; n++) burst(_a.x + rnd(-1.5, 1.5), _a.y + rnd(0, 1.5), _a.z + rnd(-1.5, 1.5), 'ichor', 24, 18);
            for (let n = 0; n < 26; n++) { const a = rnd(0, Math.PI * 2); puff(_a.x, _a.y, _a.z, { color: n % 2 ? 0x9be04a : 0x6b2f80, size: rnd(1.5, 3.5), grow: 3.5, life: rnd(1, 2.2), opacity: 0.65, vx: Math.cos(a) * rnd(3, 12), vz: Math.sin(a) * rnd(3, 12), vy: rnd(2, 9), grav: 8, drag: 1.2, priority: true }); }
            for (let n = 0; n < 6; n++) spawnSplatter(state.scene, _a.x + rnd(-6, 6), _a.z + rnd(-6, 6), rnd(2.5, 4));
          }
        } else {                                                    // husk cools and sinks into the ground
          const sink = Math.max(0, since - 3.2);
          rig.mats.chitin.emissiveIntensity = Math.max(0, 0.8 - (since - 1.3));
          rig.mats.glow.emissiveIntensity = Math.max(0, 3 - (since - 1.3) * 2);
          rig.root.position.y = -sink * sink * 0.9;
          if (sink > 2.6) {
            state.scene.remove(rig.root);
            for (const m of Object.values(rig.mats)) m.dispose();
            dying.splice(k, 1);
            continue;
          }
        }
        rig.body.position.set(d.x, d.y, d.z);
      }
      rig.body.updateMatrixWorld();
      for (const leg of rig.legs) poseLeg(leg, _b.copy(leg.hip).applyMatrix4(rig.body.matrixWorld).clone());
    }
  },
};
