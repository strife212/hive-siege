import * as THREE from 'three';
import { state, damageEnemy, eachEnemy, burst, log, aimY } from './game.js';
import { heightAt, worldToCell, cellKey, isScenery } from './terrain.js';
import { FLAT } from './config.js';
import { makeTracer } from './entities.js';
import { explode } from './effects.js';
import { puff } from './particles.js';
import { audio } from './audio.js';

// Orbital Shock Troopers: drop pods slam in from orbit and each unloads a fire team. Troopers are player-controlled
// infantry (drag a box to select, click to move): a light machine gun, a grenade every few seconds, and almost no
// armour (2 HP: a skitter takes one per bite, a brute takes both).
const POD_COUNT = 5, TEAM = 3, POD_SCALE = 0.55, SCALE = 0.5;                 // troopers are about 0.75 units tall
const T = { hp: 2, speed: 5.2, range: 10, mgRate: 6, mgDamage: 2.5, nadeRange: 12, nadeDamage: 26, nadeRadius: 2.4 };   // HMG turret: 3.5 x 10/s

const mat = {
  armour: new THREE.MeshStandardMaterial({ color: 0x2f4f96, roughness: 0.45, metalness: 0.5 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x1b2230, roughness: 0.6, metalness: 0.5 }),
  trim: new THREE.MeshStandardMaterial({ color: 0xd9a633, roughness: 0.4, metalness: 0.7 }),
  gun: new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.5, metalness: 0.7 }),
  visor: new THREE.MeshStandardMaterial({ color: 0x9dffb0, emissive: 0x39ff6a, emissiveIntensity: 2.2 }),
  visorHurt: new THREE.MeshStandardMaterial({ color: 0xffb0a0, emissive: 0xff3a2a, emissiveIntensity: 2.4 }),
  pod: new THREE.MeshStandardMaterial({ color: 0x3a4b5e, roughness: 0.55, metalness: 0.6 }),
  podDark: new THREE.MeshStandardMaterial({ color: 0x1a1e25, roughness: 0.7, metalness: 0.5 }),
  podGlow: new THREE.MeshStandardMaterial({ color: 0x9fdcff, emissive: 0x3fb0ff, emissiveIntensity: 2.0 }),
  scorch: new THREE.MeshStandardMaterial({ color: 0x0d0e10, roughness: 0.9 }),
  ring: new THREE.MeshBasicMaterial({ color: 0x5dff8a, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }),
  order: new THREE.MeshBasicMaterial({ color: 0x5dff8a, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  nade: new THREE.MeshStandardMaterial({ color: 0x46c23c, emissive: 0x1d6a18, emissiveIntensity: 0.6, roughness: 0.5, metalness: 0.2 }),
  nadeCap: new THREE.MeshStandardMaterial({ color: 0x20251c, roughness: 0.6, metalness: 0.5 }),
  flash: new THREE.MeshBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
};
const geo = {
  thigh: new THREE.BoxGeometry(0.21, 0.3, 0.27).translate(0, -0.15, 0),
  shin: new THREE.BoxGeometry(0.19, 0.28, 0.24).translate(0, -0.14, 0),
  boot: new THREE.BoxGeometry(0.23, 0.1, 0.36).translate(0, -0.31, 0.05),
  kneePad: new THREE.BoxGeometry(0.2, 0.11, 0.08).translate(0, -0.02, 0.15),
  torso: new THREE.BoxGeometry(0.58, 0.46, 0.4),
  chest: new THREE.BoxGeometry(0.3, 0.08, 0.04),
  belt: new THREE.BoxGeometry(0.5, 0.12, 0.36),
  pack: new THREE.BoxGeometry(0.46, 0.5, 0.24),
  vent: new THREE.CylinderGeometry(0.07, 0.07, 0.16, 8),
  pauldron: new THREE.SphereGeometry(0.22, 10, 8),
  pauldronRim: new THREE.TorusGeometry(0.2, 0.025, 6, 14).rotateX(Math.PI / 2),
  upperArm: new THREE.BoxGeometry(0.16, 0.26, 0.18).translate(0, -0.13, 0),
  foreArm: new THREE.BoxGeometry(0.15, 0.24, 0.17).translate(0, -0.12, 0),
  glove: new THREE.BoxGeometry(0.14, 0.1, 0.16).translate(0, -0.28, 0),
  helmet: new THREE.SphereGeometry(0.19, 12, 10),
  visor: new THREE.BoxGeometry(0.22, 0.06, 0.08),
  crest: new THREE.BoxGeometry(0.05, 0.1, 0.3),
  gunBody: new THREE.BoxGeometry(0.12, 0.17, 0.5),
  gunStock: new THREE.BoxGeometry(0.09, 0.13, 0.22),
  gunBarrel: new THREE.CylinderGeometry(0.035, 0.035, 0.34, 8).rotateX(Math.PI / 2),
  gunMag: new THREE.BoxGeometry(0.08, 0.2, 0.12),
  flash: new THREE.PlaneGeometry(0.34, 0.34),
  ring: new THREE.RingGeometry(0.62, 0.74, 28).rotateX(-Math.PI / 2),
  order: new THREE.RingGeometry(0.5, 0.64, 24).rotateX(-Math.PI / 2),
  nade: new THREE.SphereGeometry(0.075, 10, 8),
  nadeCap: new THREE.CylinderGeometry(0.03, 0.04, 0.06, 8).translate(0, 0.095, 0),
  nadeLever: new THREE.BoxGeometry(0.02, 0.1, 0.025).translate(0.05, 0.065, 0),
};
const part = (g, m, x, y, z, parent) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = true; parent.add(o); return o; };

// Small green frag grenade (unit size ~0.1; scaled by the caller).
function makeGrenadeMesh() {
  const g = new THREE.Group();
  part(geo.nade, mat.nade, 0, 0, 0, g).scale.set(1, 1.15, 1);
  part(geo.nadeCap, mat.nadeCap, 0, 0, 0, g);
  part(geo.nadeLever, mat.nadeCap, 0, 0, 0, g);
  return g;
}

// Articulated rig (faces +z): hips and knees, a torso that twists at the waist so he can run one way and shoot
// another, shoulders and elbows, a gun group that pitches between low-ready and the shoulder, and a head that scans.
function makeTrooperMesh() {
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);
  const legs = [-1, 1].map((s) => {
    const hip = new THREE.Group();
    hip.position.set(s * 0.15, 0.66, 0);
    part(geo.thigh, mat.armour, 0, 0, 0, hip);
    const knee = new THREE.Group();
    knee.position.y = -0.3;
    part(geo.shin, mat.armour, 0, 0, 0, knee);
    part(geo.kneePad, mat.trim, 0, 0, 0, knee);
    part(geo.boot, mat.dark, 0, 0, 0, knee);
    hip.add(knee);
    body.add(hip);
    return { hip, knee };
  });
  const torso = new THREE.Group();
  torso.position.y = 0.7;
  body.add(torso);
  part(geo.belt, mat.dark, 0, 0, 0, torso);
  part(geo.torso, mat.armour, 0, 0.27, 0, torso);
  part(geo.chest, mat.trim, 0, 0.35, 0.21, torso);
  part(geo.pack, mat.dark, 0, 0.32, -0.3, torso);
  const arms = [-1, 1].map((s) => {
    part(geo.vent, mat.gun, s * 0.13, 0.62, -0.32, torso);
    part(geo.pauldron, mat.armour, s * 0.4, 0.46, 0, torso).scale.set(1, 0.85, 1.1);
    part(geo.pauldronRim, mat.trim, s * 0.4, 0.4, 0, torso);
    const shoulder = new THREE.Group();
    shoulder.position.set(s * 0.39, 0.42, 0.02);
    part(geo.upperArm, mat.armour, 0, 0, 0, shoulder);
    const elbow = new THREE.Group();
    elbow.position.y = -0.26;
    part(geo.foreArm, mat.armour, 0, 0, 0, elbow);
    part(geo.glove, mat.dark, 0, 0, 0, elbow);
    shoulder.add(elbow);
    torso.add(shoulder);
    return { shoulder, elbow };
  });
  const head = new THREE.Group();
  head.position.set(0, 0.66, 0.02);
  part(geo.helmet, mat.armour, 0, 0, 0, head);
  part(geo.crest, mat.trim, 0, 0.18, -0.02, head);
  const visor = part(geo.visor, mat.visor, 0, 0.01, 0.15, head);
  torso.add(head);

  const gun = new THREE.Group();                                // pivots at the right shoulder pocket
  gun.position.set(0.17, 0.36, 0.12);
  const gunBody = new THREE.Group();
  gun.add(gunBody);
  part(geo.gunBody, mat.gun, 0, -0.04, 0.3, gunBody);
  part(geo.gunStock, mat.gun, 0, -0.03, 0.02, gunBody);
  part(geo.gunBarrel, mat.gun, 0, -0.01, 0.7, gunBody);
  part(geo.gunMag, mat.dark, 0, -0.2, 0.34, gunBody);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, -0.01, 0.9);
  gunBody.add(muzzle);
  const flash = new THREE.Group();
  for (const r of [0, Math.PI / 2]) { const f = new THREE.Mesh(geo.flash, mat.flash); f.rotation.z = r; f.rotation.y = Math.PI / 2; flash.add(f); }
  flash.add(new THREE.Mesh(geo.flash, mat.flash));
  flash.position.copy(muzzle.position);
  flash.visible = false;
  gunBody.add(flash);
  torso.add(gun);

  const handNade = makeGrenadeMesh();                           // shown in the left hand during the wind-up
  handNade.position.set(0, -0.37, 0.03);
  handNade.visible = false;
  arms[0].elbow.add(handNade);

  const ring = new THREE.Mesh(geo.ring, mat.ring);
  ring.position.y = 0.08;
  ring.visible = false;
  ring.renderOrder = 3;
  g.add(ring);
  body.scale.setScalar(SCALE);
  ring.scale.setScalar(0.62);                                // stays readable from the RTS camera
  Object.assign(g.userData, { body, legs, torso, arms, head, gun, gunBody, muzzle, flash, handNade, ring, visor });
  return g;
}

function makePodMesh() {
  const g = new THREE.Group();
  const hull = new THREE.Group();
  g.add(hull);
  part(new THREE.CylinderGeometry(0.75, 1.25, 2.6, 6), mat.pod, 0, 1.5, 0, hull);
  part(new THREE.CylinderGeometry(1.3, 1.0, 0.35, 6), mat.podDark, 0, 0.2, 0, hull);
  part(new THREE.CylinderGeometry(0.35, 0.75, 0.6, 6), mat.podDark, 0, 3.1, 0, hull);
  part(new THREE.CylinderGeometry(0.2, 0.3, 0.4, 8), mat.scorch, 0, 3.55, 0, hull);
  part(new THREE.CylinderGeometry(0.5, 0.9, 1.6, 6), mat.podGlow, 0, 1.3, 0, hull).scale.set(0.92, 1, 0.92);
  for (let k = 0; k < 3; k++) {                                   // braking fins
    const fin = part(new THREE.BoxGeometry(0.08, 1.1, 0.7), mat.podDark, 0, 2.6, 0, hull);
    const a = k * Math.PI * 2 / 3 + Math.PI / 6;
    fin.position.set(Math.sin(a) * 0.95, 2.55, Math.cos(a) * 0.95);
    fin.rotation.y = a + Math.PI / 2;
  }
  const doors = [];
  for (let k = 0; k < 3; k++) {                                   // three ramp doors hinged at the base
    const a = k * Math.PI * 2 / 3;
    const hinge = new THREE.Group();
    hinge.position.set(Math.sin(a) * 1.05, 0.4, Math.cos(a) * 1.05);
    hinge.rotation.order = 'YXZ';                                 // swing about the hinge's own axis
    hinge.rotation.y = a;
    part(new THREE.BoxGeometry(1.05, 1.9, 0.1), mat.pod, 0, 0.95, 0.04, hinge);
    part(new THREE.BoxGeometry(0.8, 0.12, 0.12), mat.trim, 0, 1.5, 0.1, hinge);
    hinge.rotation.x = -0.17;                                     // closed: leaning in against the hull
    hull.add(hinge);
    doors.push(hinge);
  }
  hull.scale.setScalar(POD_SCALE);
  g.userData.doors = doors;
  return g;
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _p = new THREE.Vector3();
let scene = null;
const pods = [], nades = [], orders = [];
const rnd = (a, b) => a + Math.random() * (b - a);
const blocked = (x, z) => {
  if (Math.abs(x) > FLAT - 1 || Math.abs(z) > FLAT - 1 || isScenery(x, z)) return true;
  const c = worldToCell(x, z);
  return state.occ.has(cellKey(c.i, c.j));
};

function spawnTrooper(x, z, tx, tz) {
  const mesh = makeTrooperMesh();
  scene.add(mesh);
  const t = { x, z, hp: T.hp, mesh, fx: tx - x, fz: tz - z, moveTo: { x: tx, z: tz }, target: null, scan: Math.random() * 0.25,
    cd: rnd(0.2, 0.8), nade: rnd(3, 6), walk: Math.random() * 6, seed: Math.random() * 20, selected: false, hurt: false, flash: 0, recoil: 0, raise: 0, aimX: 0, aimZ: 1 };
  state.troopers.push(t);
  return t;
}

function killTrooper(t) {
  const y = heightAt(t.x, t.z);
  burst(t.x, y + 0.4, t.z, 'debris', 6, 4);
  puff(t.x, y + 0.4, t.z, { color: 0x9a1f18, size: 0.8, grow: 1.6, life: 0.5, opacity: 0.7 });
  scene.remove(t.mesh);
}

const THROW = 0.75, RELEASE = 0.56;                         // grenade throw: seconds, and the point in it where the hand lets go
const ease = (u) => u * u * (3 - 2 * u);
const mix = (a, b, u) => a + (b - a) * u;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

function releaseGrenade(t) {
  const ud = t.mesh.userData;
  ud.handNade.visible = false;
  const from = ud.handNade.getWorldPosition(new THREE.Vector3());
  const e = t.nadeAt.e;
  let ex = t.nadeAt.x, ez = t.nadeAt.z;
  if (e && !e.dead) { const l = Math.hypot(e.fx, e.fz) || 1; ex = e.x + (e.fx / l) * e.speed * 0.45; ez = e.z + (e.fz / l) * e.speed * 0.45; }
  const m = makeGrenadeMesh();
  m.scale.setScalar(1.0);                                    // about 0.08 units across in flight
  m.position.copy(from);
  scene.add(m);
  nades.push({ m, from, to: new THREE.Vector3(ex, heightAt(ex, ez), ez), t: 0, dur: 0.7 + Math.hypot(ex - from.x, ez - from.z) * 0.035,
    spin: new THREE.Vector3(rnd(-9, 9), rnd(-4, 4), rnd(-9, 9)) });
}

function updateTrooper(t, dt) {
  const ud = t.mesh.userData;
  // orders: walk to the waypoint, sliding along anything in the way
  let moving = false;
  if (t.moveTo) {
    const dx = t.moveTo.x - t.x, dz = t.moveTo.z - t.z, d = Math.hypot(dx, dz);
    t.moveLeft = (t.moveLeft ?? d / T.speed * 1.5 + 1.5) - dt;        // give up rather than jostle for a taken spot forever
    if (d < 0.35 || t.moveLeft <= 0) { t.moveTo = null; t.moveLeft = undefined; }
    else {
      const sx = (dx / d) * T.speed * dt, sz = (dz / d) * T.speed * dt;
      if (!blocked(t.x + sx, t.z + sz)) { t.x += sx; t.z += sz; moving = true; }
      else if (!blocked(t.x + sx, t.z)) { t.x += sx; moving = true; }
      else if (!blocked(t.x, t.z + sz)) { t.z += sz; moving = true; }
      else t.moveTo = null;
      if (moving) { t.fx = dx; t.fz = dz; t.walk += T.speed * dt * 3.3; }
    }
  }

  // targeting: nearest bug in range, re-checked a few times a second
  t.scan -= dt;
  if (t.target && (t.target.dead || Math.hypot(t.target.x - t.x, t.target.z - t.z) > T.range + 1)) t.target = null;
  if (t.scan <= 0) {
    t.scan = 0.25;
    let best = null, bd = T.range * T.range;
    eachEnemy(t.x, t.z, T.range, (e, d2) => { if (d2 < bd) { bd = d2; best = e; } });
    t.target = best;
  }
  const e = t.target;
  t.cd -= dt;
  t.nade -= dt;
  const throwing = t.throwT !== undefined;
  if (e) {
    t.aimX = e.x - t.x; t.aimZ = e.z - t.z;
    if (t.cd <= 0 && !throwing && t.raise > 0.8) {            // only fires once the gun is up at the shoulder
      t.cd = 1 / T.mgRate + rnd(0, 0.05);
      ud.muzzle.getWorldPosition(_a);
      _b.set(e.x + rnd(-0.2, 0.2), aimY(e) + rnd(-0.25, 0.1) * e.def.scale, e.z + rnd(-0.2, 0.2));
      const tr = makeTracer(_a, _b);
      scene.add(tr);
      state.beams.push({ mesh: tr, life: 0.05, max: 0.05 });
      damageEnemy(e, T.mgDamage);
      audio.play('hmg_fire', { x: t.x, z: t.z, vol: 0.22 });
      t.flash = 0.045;
      t.recoil = 1;
    }
    if (t.nade <= 0 && !throwing) { t.nade = rnd(3, 6) + THROW; t.throwT = 0; t.nadeAt = { e, x: e.x, z: e.z }; }
  } else if (t.nade < 1) t.nade = 1;                          // no free grenade the instant something walks into range
  if (t.throwT !== undefined) {
    const before = t.throwT;
    t.throwT += dt;
    if (before < RELEASE && t.throwT >= RELEASE) releaseGrenade(t);
    if (t.throwT >= THROW) t.throwT = undefined;
  }

  animateTrooper(t, dt, moving, !!e);
}

// Procedural animation. Legs follow the direction of travel; the torso twists toward the target, so a trooper can
// run one way while firing another. All joints ease toward their pose so state changes blend.
function animateTrooper(t, dt, moving, aiming) {
  const ud = t.mesh.userData, k = Math.min(1, dt * 14);
  const to = (obj, axis, v, rate = k) => { obj.rotation[axis] += (v - obj.rotation[axis]) * rate; };
  t.mesh.position.set(t.x, heightAt(t.x, t.z), t.z);

  // facing: legs toward travel (or the target when standing), torso the rest of the way to the target
  const aimYaw = aiming ? Math.atan2(t.aimX, t.aimZ) : null;
  const legYaw = moving ? Math.atan2(t.fx, t.fz) : aimYaw ?? t.mesh.rotation.y;
  t.mesh.rotation.y += wrap(legYaw - t.mesh.rotation.y) * Math.min(1, dt * 10);
  let twist = aimYaw === null ? 0 : wrap(aimYaw - t.mesh.rotation.y);
  twist = Math.max(-1.7, Math.min(1.7, twist));

  // grenade throw envelope: wind (0..1 back and up), whip (0..1 forward)
  let wind = 0, whip = 0;
  const throwing = t.throwT !== undefined;
  if (throwing) {
    const u = t.throwT / THROW;
    wind = u < 0.5 ? ease(u / 0.5) : 1 - ease(Math.min(1, (u - 0.5) / 0.22));
    whip = u < 0.5 ? 0 : u < 0.72 ? ease((u - 0.5) / 0.22) : 1 - ease((u - 0.72) / 0.28);
    ud.handNade.visible = t.throwT > 0.08 && t.throwT < RELEASE;
  }

  // legs: run cycle with knee lift on the recovery stroke, braced firing stance, or at ease
  const s = Math.sin(t.walk), c = Math.cos(t.walk);
  ud.legs.forEach((leg, i) => {
    const sg = i ? -1 : 1;
    let hip = 0, knee = 0.04;
    if (moving) { hip = sg * s * 0.85 - 0.12; knee = Math.max(0, -sg * c) * 1.25 + 0.18; }
    else if (aiming || throwing) { hip = i ? 0.42 : -0.46; knee = i ? 0.3 : 0.52; }
    to(leg.hip, 'x', hip, Math.min(1, dt * 20));
    to(leg.knee, 'x', knee, Math.min(1, dt * 20));
    to(leg.hip, 'z', !moving && (aiming || throwing) ? sg * -0.1 : 0);
  });
  const crouch = moving ? 0.03 + Math.abs(s) * 0.07 : aiming || throwing ? -0.07 : Math.sin(state.time * 1.8 + t.seed) * 0.008;
  ud.body.position.y += (crouch * SCALE - ud.body.position.y) * k;

  // firing: gun comes up to the shoulder, each round kicks the gun and rocks the torso
  t.raise = (t.raise ?? 0) + ((aiming && !throwing ? 1 : 0) - (t.raise ?? 0)) * Math.min(1, dt * 9);
  t.recoil = Math.max(0, (t.recoil ?? 0) - dt * 11);
  t.flash = Math.max(0, (t.flash ?? 0) - dt);
  const lowReady = moving ? 0.42 : 0.62, gunPitch = mix(lowReady, 0, t.raise) + wind * 0.5 - t.recoil * 0.07;
  to(ud.gun, 'x', gunPitch, Math.min(1, dt * 18));
  to(ud.gun, 'y', moving && !aiming ? -0.35 + s * 0.06 : 0);
  ud.gunBody.position.z = -0.07 * t.recoil;
  ud.flash.visible = t.flash > 0;
  if (ud.flash.visible) { ud.flash.rotation.z = Math.random() * Math.PI; ud.flash.scale.setScalar(0.7 + Math.random() * 0.7); }

  // torso: lean into the run, rock back with recoil, coil and uncoil through the throw
  to(ud.torso, 'y', twist + (moving ? -s * 0.12 : 0) + wind * 0.45 - whip * 0.35, Math.min(1, dt * 12));
  to(ud.torso, 'x', (moving ? 0.22 : aiming ? 0.1 : 0) - t.recoil * 0.05 - wind * 0.22 + whip * 0.38, Math.min(1, dt * 18));
  to(ud.torso, 'z', moving ? c * 0.05 : 0);

  // arms: right hand on the grip, left on the fore-end unless it is busy with a grenade
  const [left, right] = ud.arms;
  to(right.shoulder, 'x', -0.72 + gunPitch * 0.55 - t.recoil * 0.05, Math.min(1, dt * 18));
  to(right.elbow, 'x', -1.25 + gunPitch * 0.3);
  to(right.shoulder, 'z', -0.12);
  if (throwing) {                                              // overhand: back and up, then whip through and follow down
    left.shoulder.rotation.x = mix(mix(-1.15, -3.5, wind), -0.9, whip);
    left.elbow.rotation.x = mix(mix(-0.55, -1.7, wind), -0.15, whip);
    left.shoulder.rotation.z = mix(0.5, -0.25, Math.max(wind, whip));
  } else {
    to(left.shoulder, 'x', -1.12 + gunPitch * 0.6 - t.recoil * 0.04, Math.min(1, dt * 16));
    to(left.elbow, 'x', -0.55 + gunPitch * 0.2, Math.min(1, dt * 16));
    to(left.shoulder, 'z', 0.5, Math.min(1, dt * 16));
  }

  // head: tracks the target, otherwise scans the horizon
  to(ud.head, 'y', aiming ? 0 : Math.sin(state.time * 0.8 + t.seed) * 0.6 + (moving ? 0 : Math.sin(state.time * 0.23 + t.seed * 2) * 0.3), Math.min(1, dt * 6));
  to(ud.head, 'x', aiming ? 0.05 : moving ? -0.12 : 0);

  ud.ring.visible = t.selected;
  if (t.hp < T.hp && !t.hurt) { t.hurt = true; ud.visor.material = mat.visorHurt; }
}

function updatePod(p, dt) {
  p.t += dt;
  const m = p.mesh;
  if (p.t < p.fall) {                                           // screaming in
    if (p.t < 0) { m.visible = false; return true; }
    m.visible = true;
    const k = p.t / p.fall;
    m.position.lerpVectors(p.start, p.land, k * k * 0.35 + k * 0.65);
    if (!p.whistled) { p.whistled = true; audio.play('artillery_whistle', { x: p.land.x, z: p.land.z, vol: 0.5 }); }
    for (let n = 0; n < 2; n++) {
      puff(m.position.x + rnd(-0.3, 0.3), m.position.y + 2.0, m.position.z + rnd(-0.3, 0.3), { color: 0xffa040, size: 1.2, grow: 2, life: 0.35, opacity: 0.85, additive: true, priority: true });
      puff(m.position.x, m.position.y + 2.6, m.position.z, { color: 0x3a3632, size: 1.1, grow: 2.6, life: 1.3, opacity: 0.4 });
    }
    return true;
  }
  if (!p.landed) {                                              // impact: crush whatever is underneath
    p.landed = true;
    m.position.copy(p.land);
    explode(p.land.x, p.land.z, 1.3, 70, 2.8, { shake: 0.45, smoke: 6 });
    audio.play('hub_land', { x: p.land.x, z: p.land.z, vol: 0.8 });
    for (let n = 0; n < 14; n++) {
      const a = rnd(0, Math.PI * 2);
      puff(p.land.x + Math.cos(a) * 1.4, p.land.y + 0.4, p.land.z + Math.sin(a) * 1.4, { color: 0xb59468, size: rnd(1.6, 3), grow: 2.4, life: rnd(1, 1.8), opacity: 0.5, vx: Math.cos(a) * rnd(4, 9), vz: Math.sin(a) * rnd(4, 9), vy: rnd(0.5, 2), drag: 2.2 });
    }
  }
  const since = p.t - p.fall;
  const open = THREE.MathUtils.smoothstep(since, 0.35, 0.9);
  for (const d of m.userData.doors) d.rotation.x = -0.17 + open * 1.72;          // ramps drop flat on the ground
  if (!p.unloaded && since > 0.95) {
    p.unloaded = true;
    for (let k = 0; k < TEAM; k++) {
      const a = k * Math.PI * 2 / 3 + p.yaw;                                     // one trooper down each ramp
      spawnTrooper(p.land.x + Math.sin(a) * 0.3, p.land.z + Math.cos(a) * 0.3, p.land.x + Math.sin(a) * 2.3, p.land.z + Math.cos(a) * 2.3);
    }
  }
  if (since > 26) m.position.y = p.land.y - (since - 26) * 1.6;                  // spent pod sinks away
  if (since > 28.5) { scene.remove(m); return false; }
  return true;
}

export const troopers = {
  init(s) { scene = s; },

  // Ability effect: POD_COUNT pods scattered over the target circle, landing a beat apart.
  dropPods(cx, cz, radius) {
    const spots = [];
    for (let tries = 0; spots.length < POD_COUNT && tries < 200; tries++) {
      const a = rnd(0, Math.PI * 2), r = radius * Math.sqrt(Math.random()) * 0.9;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (blocked(x, z) || spots.some((q) => Math.hypot(q.x - x, q.z - z) < (tries < 120 ? 2.8 : 1.2))) continue;
      spots.push({ x, z });
    }
    if (!spots.length) spots.push({ x: cx, z: cz });
    const slant = rnd(0, Math.PI * 2);
    spots.forEach((q, k) => {
      const mesh = makePodMesh();
      const yaw = rnd(0, Math.PI * 2);
      mesh.rotation.y = yaw;
      mesh.visible = false;
      scene.add(mesh);
      const land = new THREE.Vector3(q.x, heightAt(q.x, q.z) - 0.15, q.z);
      const start = land.clone().add(new THREE.Vector3(Math.cos(slant) * 22, 110, Math.sin(slant) * 22));
      pods.push({ mesh, land, start, yaw, t: -(0.4 + k * 0.42 + rnd(0, 0.15)), fall: 1.15, landed: false, unloaded: false, whistled: false });
    });
    log(`Shock troopers inbound: ${spots.length} drop pods!`);
    if (!troopers.hinted) { troopers.hinted = true; setTimeout(() => log('Drag a box over troopers to select them, then click to move.'), 3500); }
    return { update: () => false };                             // pods are driven from troopers.update
  },

  update(dt) {
    for (let k = pods.length - 1; k >= 0; k--) if (!updatePod(pods[k], dt)) pods.splice(k, 1);

    const list = state.troopers;
    for (let k = list.length - 1; k >= 0; k--) {
      const t = list[k];
      if (t.hp <= 0) { killTrooper(t); list.splice(k, 1); continue; }
      updateTrooper(t, dt);
    }
    for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {          // keep the squad from stacking
      const A = list[a], B = list[b];
      let dx = B.x - A.x, dz = B.z - A.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.6 && d > 1e-4) {
        const push = (0.6 - d) * 0.5; dx /= d; dz /= d;
        if (!blocked(A.x - dx * push, A.z - dz * push)) { A.x -= dx * push; A.z -= dz * push; }
        if (!blocked(B.x + dx * push, B.z + dz * push)) { B.x += dx * push; B.z += dz * push; }
      }
    }

    for (let k = nades.length - 1; k >= 0; k--) {
      const n = nades[k];
      n.t += dt;
      const u = Math.min(1, n.t / n.dur);
      n.m.position.lerpVectors(n.from, n.to, u);
      n.m.position.y += Math.sin(u * Math.PI) * 2.6;
      n.m.rotation.x += n.spin.x * dt; n.m.rotation.y += n.spin.y * dt; n.m.rotation.z += n.spin.z * dt;
      if (u >= 1) {
        explode(n.to.x, n.to.z, 0.9, T.nadeDamage, T.nadeRadius, { shake: 0, smoke: 3 });
        scene.remove(n.m);
        nades.splice(k, 1);
      }
    }
    for (let k = orders.length - 1; k >= 0; k--) {
      const o = orders[k];
      o.life -= dt;
      if (o.life <= 0) { scene.remove(o.m); o.m.material.dispose(); orders.splice(k, 1); continue; }
      o.m.scale.setScalar(0.5 + (1 - o.life / 0.6) * 1.2);
      o.m.material.opacity = o.life / 0.6;
    }
  },

  // ---- selection and orders (driven by input.js)
  get selectedCount() { return state.troopers.reduce((n, t) => n + (t.selected ? 1 : 0), 0); },
  clearSelection() { for (const t of state.troopers) t.selected = false; },
  // Select every trooper whose screen position falls inside the box (client pixels). Returns how many.
  selectBox(x0, y0, x1, y1, camera, add = false) {
    const lx = Math.min(x0, x1), hx = Math.max(x0, x1), ly = Math.min(y0, y1), hy = Math.max(y0, y1);
    let n = 0;
    for (const t of state.troopers) {
      _p.set(t.x, heightAt(t.x, t.z) + 0.4, t.z).project(camera);
      const sx = (_p.x + 1) / 2 * innerWidth, sy = (1 - _p.y) / 2 * innerHeight;
      const inside = _p.z < 1 && sx >= lx - 8 && sx <= hx + 8 && sy >= ly - 8 && sy <= hy + 8;
      t.selected = inside || (add && t.selected);
      if (t.selected) n++;
    }
    return n;
  },
  // Click selection: the trooper nearest the picked ground point, if any is close enough.
  selectAt(p, add = false) {
    let best = null, bd = 1.3 * 1.3;
    for (const t of state.troopers) { const d = (t.x - p.x) ** 2 + (t.z - p.z) ** 2; if (d < bd) { bd = d; best = t; } }
    if (!best) return false;
    if (!add) troopers.clearSelection();
    best.selected = true;
    return true;
  },
  // Move order: the selection fans out into rings around the clicked point so nobody fights over one spot.
  order(p) {
    const sel = state.troopers.filter((t) => t.selected);
    sel.forEach((t, k) => {
      let x = p.x, z = p.z;
      if (k > 0) {
        const ringN = k <= 6 ? 1 : 2, idx = k <= 6 ? k - 1 : k - 7, per = ringN === 1 ? 6 : 12;
        const a = (idx / per) * Math.PI * 2;
        x += Math.cos(a) * 1.0 * ringN; z += Math.sin(a) * 1.0 * ringN;
      }
      t.moveTo = blocked(x, z) ? { x: p.x, z: p.z } : { x, z };
      t.moveLeft = undefined;
    });
    if (!sel.length) return;
    const m = new THREE.Mesh(geo.order, mat.order.clone());
    m.position.set(p.x, heightAt(p.x, p.z) + 0.12, p.z);
    m.renderOrder = 3;
    scene.add(m);
    orders.push({ m, life: 0.6 });
  },
};
