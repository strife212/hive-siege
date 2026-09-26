import * as THREE from 'three';
import { state, eachEnemy } from './game.js';
import { heightAt } from './terrain.js';
import { explode } from './effects.js';
import { puff } from './particles.js';
import { flashes } from './flashes.js';
import { audio } from './audio.js';
import { bevelBox, worn } from './surface.js';
import { discGeo, ringGeo } from './abilities.js';

// Apocalypse Heavy Artillery (3x3, limit 1): a huge sci-fi howitzer with cross-map range. One shell every def.interval s,
// always at the biggest clump of bugs on the field. After each shot the cycle below plays out in full: the barrel slams
// back and runs out again, drops level to the loading angle, the breech opens and throws out the spent casing, a hoist
// lifts a fresh shell out of the magazine, a rammer drives it home, the breech shuts and the gun lays onto the next
// target. Every moving part is a pure function of the time since the last shot (s.apoc.t), except the gun laying,
// which slews at a fixed rate.
const mats = {
  armour: worn(new THREE.MeshStandardMaterial({ color: 0x4d5561, roughness: 0.5, metalness: 0.55 }), { grime: 0.22, chips: 0.35 }),
  plate: worn(new THREE.MeshStandardMaterial({ color: 0xc9ced3, roughness: 0.45, metalness: 0.2 }), { grime: 0.24, chips: 0.5 }),
  dark: worn(new THREE.MeshStandardMaterial({ color: 0x1b1e24, roughness: 0.55, metalness: 0.6 }), { grime: 0.14, chips: 0.18 }),
  tube: worn(new THREE.MeshStandardMaterial({ color: 0x2a2e35, roughness: 0.32, metalness: 0.85 }), { grime: 0.12, chips: 0.15, rough: 0.35 }),
  concrete: worn(new THREE.MeshStandardMaterial({ color: 0x80858b, roughness: 0.9, metalness: 0.05 }), { grime: 0.34, chips: 0, rough: 0.15, bump: 1.2, scale: 1.0 }),
  red: worn(new THREE.MeshStandardMaterial({ color: 0xa3261e, roughness: 0.45, metalness: 0.35 }), { grime: 0.26, chips: 0.6 }),
  brass: new THREE.MeshStandardMaterial({ color: 0xc9a24a, roughness: 0.3, metalness: 0.9 }),
  shellBody: new THREE.MeshStandardMaterial({ color: 0x3b4230, roughness: 0.5, metalness: 0.4 }),
  shellBand: new THREE.MeshStandardMaterial({ color: 0xe0b020, roughness: 0.5, metalness: 0.3 }),
  // The coil rings and vent slits glow harder while the gun is charged and ready, and flare when it fires.
  glow: new THREE.MeshStandardMaterial({ color: 0xff8a3a, emissive: 0xff5a10, emissiveIntensity: 1.2, roughness: 0.3 }),
  lamp: new THREE.MeshStandardMaterial({ color: 0xff3020, emissive: 0xff2010, emissiveIntensity: 3, roughness: 0.3 }),
  hot: new THREE.MeshBasicMaterial({ color: 0xffd8a0, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }),
};

function box(w, h, d, mat, x, y, z, parent) {
  const m = new THREE.Mesh(bevelBox(w, h, d), mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
function cyl(rt, rb, len, segs, mat, x, y, z, parent, axis = 'y') {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, len, segs), mat);
  m.position.set(x, y, z);
  if (axis === 'z') m.rotation.x = Math.PI / 2;
  if (axis === 'x') m.rotation.z = Math.PI / 2;
  parent.add(m);
  return m;
}

// One round of ammunition, nose along +z: brass case at the back, olive projectile with a driving band and a red tip.
const CASE_LEN = 0.85, SHELL_R = 0.26;
function makeRound(withCase = true) {
  const g = new THREE.Group();
  if (withCase) {
    cyl(SHELL_R, SHELL_R, CASE_LEN, 14, mats.brass, 0, 0, CASE_LEN / 2, g, 'z');
    cyl(SHELL_R + 0.03, SHELL_R + 0.03, 0.06, 14, mats.brass, 0, 0, 0.03, g, 'z');     // rim
  }
  cyl(SHELL_R * 0.96, SHELL_R * 0.96, 0.7, 14, mats.shellBody, 0, 0, CASE_LEN + 0.35, g, 'z');
  cyl(SHELL_R * 1.0, SHELL_R * 1.0, 0.08, 14, mats.shellBand, 0, 0, CASE_LEN + 0.12, g, 'z');
  const nose = cyl(0, SHELL_R * 0.96, 0.55, 14, mats.shellBody, 0, 0, CASE_LEN + 0.975, g, 'z');
  nose.rotation.x = Math.PI / 2;
  cyl(0, 0.07, 0.14, 10, mats.red, 0, 0, CASE_LEN + 1.29, g, 'z').rotation.x = Math.PI / 2;
  return g;
}
// The projectile in flight: no case, a little bigger so it reads from the default camera, with a hot tracer glow at its base.
let flightRound = null;
function makeFlightRound() {
  const g = makeRound(false);
  g.scale.setScalar(1.2);
  const trail = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), mats.hot);
  trail.scale.set(1, 1, 3);
  trail.position.z = 0.4;
  g.add(trail);
  return g;
}
const casingGeo = new THREE.CylinderGeometry(SHELL_R, SHELL_R, CASE_LEN, 14);
casingGeo.rotateX(Math.PI / 2);

// ---------------------------------------------------------------- model
// Layout (building-local, +z forward): a 5.8 x 5.8 slab with four outrigger jacks, a turret ring, and a turret whose
// two armoured cheeks leave an open slot for the gun and an open loading channel behind it. The cradle pivots on a
// trunnion high in the slot; the barrel (breech block, tube, coil rings, muzzle brake) recoils inside the cradle.
const PIVOT_Y = 2.0, PIVOT_Z = 0.5;          // trunnion, in head space
const TRAY_Z = -2.35, TRAY_DOWN = -0.6;      // loading tray: magazine well at the back of the turret
export function apocalypseGun(g) {
  box(5.8, 0.3, 5.8, mats.dark, 0, 0.15, 0, g);
  box(5.3, 0.35, 5.3, mats.concrete, 0, 0.47, 0, g);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {           // outrigger jacks, braced from the ring to a foot pad
    box(0.9, 0.14, 0.9, mats.dark, sx * 2.35, 0.7, sz * 2.35, g);
    const from = new THREE.Vector3(sx * 1.55, 1.05, sz * 1.55), to = new THREE.Vector3(sx * 2.35, 0.78, sz * 2.35);
    const dir = to.clone().sub(from);
    const jack = cyl(0.13, 0.13, dir.length() + 0.3, 8, mats.plate, 0, 0, 0, g);
    jack.position.copy(from).add(to).multiplyScalar(0.5);
    jack.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    cyl(0.2, 0.2, 0.4, 8, mats.red, to.x, 0.92, to.z, g);
    box(0.3, 0.06, 0.3, mats.lamp, sx * 2.35, 0.8, sz * 2.35, g);
  }
  cyl(2.35, 2.55, 0.55, 32, mats.armour, 0, 0.92, 0, g);           // turret ring
  const ringBand = new THREE.Mesh(new THREE.TorusGeometry(2.3, 0.06, 6, 40), mats.glow);
  ringBand.rotation.x = Math.PI / 2;
  ringBand.position.y = 1.2;
  g.add(ringBand);
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    cyl(0.07, 0.07, 0.08, 6, mats.dark, Math.cos(a) * 2.45, 1.22, Math.sin(a) * 2.45, g);
  }

  const head = new THREE.Group();
  head.position.y = 1.2;
  g.add(head);
  cyl(2.15, 2.2, 0.22, 32, mats.armour, 0, 0.11, 0, head);
  // Armoured cheeks either side of the gun slot, with sloped front plates, white upper panels and glowing vents.
  for (const sx of [-1, 1]) {
    box(1.0, 1.3, 3.6, mats.armour, sx * 1.2, 0.85, 0.0, head);
    box(0.9, 0.12, 3.4, mats.plate, sx * 1.2, 1.54, -0.05, head);
    const glacis = box(1.0, 0.9, 0.2, mats.armour, sx * 1.2, 0.95, 1.95, head);
    glacis.rotation.x = -0.5;
    box(0.06, 0.7, 2.6, mats.plate, sx * 1.72, 0.9, -0.1, head);
    for (let k = 0; k < 3; k++) box(0.04, 0.08, 0.9, mats.glow, sx * 1.76, 0.6 + k * 0.2, -0.6, head);
    box(0.3, 0.9, 0.9, mats.dark, sx * 0.78, 1.9, PIVOT_Z, head);      // trunnion brackets
    box(0.36, 0.12, 1.0, mats.red, sx * 0.78, 2.36, PIVOT_Z, head);
    box(0.95, 1.1, 1.7, mats.armour, sx * 1.2, 0.75, TRAY_Z, head);     // magazine blocks either side of the loading channel
    box(0.85, 0.1, 1.6, mats.plate, sx * 1.2, 1.35, TRAY_Z, head);
    for (let k = 0; k < 3; k++) cyl(0.2, 0.2, 0.6, 12, mats.brass, sx * 1.2, 1.5, TRAY_Z - 0.55 + k * 0.55, head, 'x');   // racked rounds on top
  }
  box(1.4, 0.5, 1.7, mats.dark, 0, 0.3, TRAY_Z, head);                 // channel floor (the tray sinks into it)
  box(3.4, 0.4, 0.3, mats.dark, 0, 0.4, -3.2, head);                   // rear bumper
  // Sensor mast with a red eye and a small dish on the right cheek.
  cyl(0.05, 0.05, 1.2, 6, mats.dark, 1.5, 2.2, -1.2, head);
  box(0.35, 0.28, 0.4, mats.plate, 1.5, 2.8, -1.2, head);
  cyl(0.08, 0.08, 0.05, 10, mats.lamp, 1.5, 2.8, -0.98, head, 'z');
  const dishGeo = new THREE.SphereGeometry(0.35, 14, 6, 0, Math.PI * 2, 0, Math.PI / 3);
  const dish = new THREE.Mesh(dishGeo, mats.plate);
  dish.position.set(-1.45, 1.95, -1.4);
  dish.rotation.x = -0.9;
  head.add(dish);

  // Cradle on its trunnion: sleeve, recuperator cylinders, mantlet. Rotation.x < 0 raises the gun.
  const cradle = new THREE.Group();
  cradle.position.set(0, PIVOT_Y, PIVOT_Z);
  cradle.rotation.x = -0.35;
  head.add(cradle);
  cyl(0.22, 0.22, 1.9, 12, mats.tube, 0, 0, 0, cradle, 'x');           // trunnion axle
  box(1.1, 1.0, 2.2, mats.armour, 0, 0, 0.6, cradle);
  box(1.3, 1.2, 0.35, mats.plate, 0, 0, 1.75, cradle);                 // mantlet
  for (const [x, y] of [[0, 0.62], [-0.38, -0.55], [0.38, -0.55]]) {   // recuperators
    cyl(0.15, 0.15, 2.6, 10, mats.plate, x, y, 0.9, cradle, 'z');
    cyl(0.18, 0.18, 0.12, 10, mats.dark, x, y, 2.2, cradle, 'z');
  }

  // Barrel assembly (recoils along -z): breech block with its sliding door, the long tube, glowing coil rings,
  // a heat shroud on top and a big slotted muzzle brake.
  const barrel = new THREE.Group();
  cradle.add(barrel);
  box(1.0, 1.0, 1.2, mats.armour, 0, 0, -0.9, barrel);                 // breech block
  box(1.05, 0.12, 1.1, mats.red, 0, 0.52, -0.9, barrel);
  const door = new THREE.Group();                                       // breech door on the back face, slides down
  door.position.set(0, 0, -1.52);
  barrel.add(door);
  box(0.8, 0.8, 0.12, mats.dark, 0, 0, 0, door);
  box(0.12, 0.5, 0.1, mats.plate, 0, 0, -0.08, door);                  // handle
  cyl(0.36, 0.4, 7.2, 20, mats.tube, 0, 0, 3.3, barrel, 'z');
  for (let k = 0; k < 7; k++) {
    const z = 1.6 + k * 0.62;
    const coil = new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.06, 6, 20), k % 2 ? mats.dark : mats.glow);
    coil.position.z = z;
    barrel.add(coil);
  }
  box(0.32, 0.18, 3.4, mats.plate, 0, 0.45, 3.4, barrel);             // heat shroud
  for (let k = 0; k < 8; k++) box(0.5, 0.06, 0.12, mats.dark, 0, 0.52, 1.95 + k * 0.42, barrel);
  box(0.95, 0.7, 1.1, mats.armour, 0, 0, 7.3, barrel);                 // muzzle brake
  for (const sx of [-1, 1]) for (const z of [7.0, 7.35, 7.7]) box(0.08, 0.5, 0.18, mats.dark, sx * 0.48, 0, z, barrel);
  cyl(0.3, 0.3, 0.05, 16, mats.dark, 0, 0, 7.86, barrel, 'z');         // bore
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0, 8.0);
  barrel.add(muzzle);
  const breech = new THREE.Object3D();
  breech.position.set(0, 0, -1.6);
  barrel.add(breech);
  const flash = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), mats.hot);
  flash.position.set(0, 0, 8.9);
  flash.scale.set(1.2, 1.2, 2.6);
  flash.visible = false;
  barrel.add(flash);

  // Loading tray: a cradle on a hoist in the channel behind the gun, carrying the next round.
  const tray = new THREE.Group();
  tray.position.set(0, TRAY_DOWN, TRAY_Z);
  head.add(tray);
  box(0.7, 0.1, 1.9, mats.dark, 0, -0.33, 0, tray);
  for (const sx of [-1, 1]) box(0.08, 0.3, 1.9, mats.plate, sx * 0.34, -0.2, 0, tray);
  cyl(0.08, 0.08, 1.4, 8, mats.tube, 0, -1.0, 0, tray);                // hoist ram
  const round = makeRound();
  round.position.set(0, 0, -0.9);
  round.visible = false;
  tray.add(round);

  Object.assign(g.userData, { head, cradle, barrel, door, tray, round, muzzle, breech, flash });
}

// ---------------------------------------------------------------- timeline
// Seconds after a shot. The whole cycle is 8.2 s, so with the 10 s interval the gun waits loaded and laid for the rest.
const T = {
  kick: 0.09, runOut: 1.7,          // recoil: slam back, then run out again
  level: [1.8, 2.8],                // the barrel drops level to the loading angle
  open: [2.9, 3.3],                 // breech door slides down
  eject: 3.35,                      // spent case thrown out of the back
  hoist: [3.8, 4.8],                // tray rises with the next round
  ram: [5.0, 5.9],                  // rammer drives it into the chamber
  lower: [6.0, 6.7],                // empty tray drops back into the magazine
  close: [6.3, 6.8],                // breech shuts
  ready: 7.0,                       // free to lay onto a target
};
const RECOIL = 1.25, DOOR_DROP = 0.85, TRAY_UP = PIVOT_Y;
const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const span = (t, [a, b]) => ease((t - a) / (b - a));

// Gun laying: elevation grows with distance (a high lob out to the far side of the map).
const elevationFor = (dist, range) => 0.32 + 0.43 * Math.min(1, dist / range);

// ---------------------------------------------------------------- targeting
// The biggest clump: bugs are binned into BIN-unit cells, each weighted by how much a shell would do to it (fodder ants
// count for little, brutes, spitters and the Colossus for more), and every cell is scored with its neighbours so a clump
// straddling a cell line still counts. The best cell's bugs within the blast then give a weighted centroid and the
// average walking velocity, so the shell lands where the clump will be when it comes down.
const BIN = 4;
const weightOf = (e) => (e.def.boss ? 8 : e.type === 'ant' ? 0.35 : e.def.scale >= 1.4 ? 2 : 1);
const bins = new Map();
function clumpAim(s, def) {
  bins.clear();
  const min2 = def.minRange * def.minRange;
  eachEnemy(s.x, s.z, def.range, (e, d2) => {
    if (d2 < min2) return;
    const key = Math.floor(e.x / BIN) * 4096 + Math.floor(e.z / BIN);
    bins.set(key, (bins.get(key) || 0) + weightOf(e));
  });
  let best = null, bestScore = 0;
  for (const [key, w] of bins) {
    const bi = Math.round(key / 4096), bj = key - bi * 4096;
    let score = w;
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) if (di || dj) score += (bins.get((bi + di) * 4096 + bj + dj) || 0) * 0.6;
    if (score > bestScore) { bestScore = score; best = [(bi + 0.5) * BIN, (bj + 0.5) * BIN]; }
  }
  if (!best) return null;
  let sw = 0, cx = 0, cz = 0, vx = 0, vz = 0;
  eachEnemy(best[0], best[1], def.splash, (e) => {
    const w = weightOf(e);
    sw += w; cx += e.x * w; cz += e.z * w;
    if (!e.target) { const f = Math.hypot(e.fx, e.fz) || 1; vx += (e.fx / f) * e.speed * w; vz += (e.fz / f) * e.speed * w; }
  });
  if (!sw) return null;
  return { x: cx / sw, z: cz / sw, vx: vx / sw, vz: vz / sw, score: bestScore };
}

const occupied = (x, z, r) => { let any = false; eachEnemy(x, z, r, () => { any = true; return true; }); return any; };

// ---------------------------------------------------------------- Priority Override
// s.override = { x, z } while the player has a spot marked; null is the automatic clump targeting. The spot is marked
// on the ground by a pulsing ring the size of the blast, with a small bullseye.
export function inRange(s, p) {
  const d = Math.hypot(p.x - s.x, p.z - s.z);
  return d >= s.def.minRange && d <= s.def.range;
}
export function setOverride(s, p) {
  clearOverride(s);
  s.override = { x: p.x, z: p.z };
  if (s.apoc) s.apoc.scanT = 0;                              // re-lay straight away
  const g = new THREE.Group();
  const fill = new THREE.Mesh(discGeo(p.x, p.z, s.def.splash), new THREE.MeshBasicMaterial({ color: 0xff5a30, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  const band = new THREE.MeshBasicMaterial({ color: 0xff5a30, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, fog: false });
  g.add(fill, new THREE.Mesh(ringGeo(p.x, p.z, s.def.splash, 0.28), band), new THREE.Mesh(ringGeo(p.x, p.z, 1.1, 0.25), band));
  state.scene.add(g);
  markers.push({ s, g, fill, band });
}
export function clearOverride(s) {
  s.override = null;
  if (s.apoc) s.apoc.scanT = 0;
  for (let k = markers.length - 1; k >= 0; k--) if (markers[k].s === s) dropMarker(k);
}
const markers = [];
function dropMarker(k) {
  const { g } = markers[k];
  state.scene.remove(g);
  g.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose?.(); } });
  markers.splice(k, 1);
}

// ---------------------------------------------------------------- update
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _q = new THREE.Quaternion(), _fwd = new THREE.Vector3();
const shells = [], casings = [];

export function updateApocalypse(s, dt) {
  const def = s.def, ud = s.mesh.userData;
  const A = (s.apoc ||= { t: 99, scanT: 0, aim: null, yaw: ud.head.rotation.y, elev: 0.35 });
  A.t += dt;
  const t = A.t;

  // recoil and run-out
  const rec = t < T.kick ? t / T.kick : t < T.runOut ? 1 - ease((t - T.kick) / (T.runOut - T.kick)) : 0;
  ud.barrel.position.z = -RECOIL * rec;
  ud.flash.visible = t < 0.12;
  if (ud.flash.visible) ud.flash.material.opacity = 0.95 * (1 - t / 0.12);

  // breech door, casing, tray, rammer
  const doorOpen = span(t, T.open) * (1 - span(t, T.close));
  ud.door.position.y = -DOOR_DROP * doorOpen;
  if (t - dt < T.eject && t >= T.eject) ejectCasing(s);
  const up = span(t, T.hoist) * (1 - span(t, T.lower));
  ud.tray.position.y = TRAY_DOWN + (TRAY_UP - TRAY_DOWN) * up;
  const rammed = span(t, T.ram);
  ud.round.visible = t >= T.hoist[0] && t < T.ram[1];
  ud.round.position.z = -0.9 + rammed * 2.0;
  if (t - dt < T.hoist[0] && t >= T.hoist[0]) audio.play('apoc_load', { x: s.x, z: s.z });
  if (t - dt < T.ram[1] && t >= T.ram[1]) audio.play('apoc_load', { x: s.x, z: s.z, vol: 1.2 });
  mats.glow.emissiveIntensity = t < 0.4 ? 6 - 10 * t : t < T.ready ? 1.2 : 2 + 0.6 * Math.sin(state.time * 3);

  // pick the clump to shell (rechecked twice a second while ready), or, under Priority Override, the marked spot: the
  // gun lays onto it at once and fires as soon as any bug is inside the blast area
  const ready = t >= T.ready;
  A.scanT -= dt;
  if (ready && A.scanT <= 0) {
    A.scanT = 0.5;
    const o = s.override;
    A.aim = o ? { x: o.x, z: o.z, vx: 0, vz: 0, manual: true, hot: occupied(o.x, o.z, def.splash) } : clumpAim(s, def);
  }
  const aim = ready ? A.aim : null;

  // lay the gun: level while loading, onto the aim point once ready
  let goalYaw = A.yaw, goalElev = t < T.level[0] ? A.elev : 0;
  let dist = 0;
  if (aim) {
    dist = Math.hypot(aim.x - s.x, aim.z - s.z);
    goalYaw = Math.atan2(aim.x - s.x, aim.z - s.z);
    goalElev = elevationFor(dist, def.range);
  } else if (ready) goalElev = 0.35;                       // idle: barrel up at a ready angle
  let dy = Math.atan2(Math.sin(goalYaw - A.yaw), Math.cos(goalYaw - A.yaw));
  const yawStep = def.turn * dt;
  if (aim) A.yaw += Math.max(-yawStep, Math.min(yawStep, dy));
  const elevStep = (t < T.ready ? 0.9 : 0.45) * dt;
  if (t >= T.level[0]) A.elev += Math.max(-elevStep, Math.min(elevStep, goalElev - A.elev));
  ud.head.rotation.y = A.yaw;
  ud.cradle.rotation.x = -A.elev;

  if (!aim || t < def.interval || (aim.manual && !aim.hot)) return;
  dy = Math.atan2(Math.sin(goalYaw - A.yaw), Math.cos(goalYaw - A.yaw));
  if (Math.abs(dy) > 0.02 || Math.abs(goalElev - A.elev) > 0.02) return;
  fire(s, aim, dist);
  A.t = 0;
  A.aim = null;
}

function fire(s, aim, dist) {
  const def = s.def, ud = s.mesh.userData;
  s.mesh.updateMatrixWorld(true);
  ud.muzzle.getWorldPosition(_a);
  ud.barrel.getWorldQuaternion(_q);
  _fwd.set(0, 0, 1).applyQuaternion(_q);
  const dur = 1.0 + dist * 0.012;                          // ~2.2 s across 100 m: fast enough that the clump is still there
  const lead = dur;
  const ex = aim.x + aim.vx * lead, ez = aim.z + aim.vz * lead;
  const flat = Math.hypot(ex - _a.x, ez - _a.z);
  const round = (flightRound ||= makeFlightRound()).clone();
  round.position.copy(_a);
  state.scene.add(round);
  shells.push({
    mesh: round, start: _a.clone(), end: new THREE.Vector3(ex, heightAt(ex, ez), ez), t: 0, dur,
    h: Math.max(6, flat * Math.tan(s.apoc.elev) / 4), dmg: def.damage, splash: def.splash, whistled: false, puffT: 0,
  });

  // muzzle blast: flash, a jet of fire and smoke out of the brake, a dust ring kicked up around the mount
  flashes.add(_a.x, _a.y, _a.z, { color: 0xffb060, power: 80, range: 22, life: 0.3 });
  for (let k = 0; k < 10; k++) {
    const sp = 3 + Math.random() * 9;
    puff(_a.x, _a.y, _a.z, { color: 0x6a625a, size: 1.4, grow: 3.5, life: 1.8 + Math.random(), opacity: 0.55, vx: _fwd.x * sp + (Math.random() - 0.5) * 3, vy: _fwd.y * sp + 1, vz: _fwd.z * sp + (Math.random() - 0.5) * 3, drag: 1.4 });
  }
  for (const side of [-1, 1]) {                             // the brake throws gas out sideways
    _b.set(_fwd.z * side, 0, -_fwd.x * side);
    for (let k = 0; k < 3; k++) puff(_a.x, _a.y, _a.z, { color: 0xffc080, size: 1.1, grow: 1.5, life: 0.25, opacity: 0.9, additive: true, vx: _b.x * 10, vz: _b.z * 10, vy: 0.5 });
  }
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2, sp = 6 + Math.random() * 3;
    puff(s.x + Math.cos(a) * 3, s.y + 0.3, s.z + Math.sin(a) * 3, { color: 0xa88a64, size: 1.2, grow: 2.2, life: 1.4, opacity: 0.45, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: 0.6, drag: 2.2 });
  }
  state.shake += 0.45;
  audio.play('apoc_fire', { x: s.x, z: s.z });
}

// The spent case: thrown out of the open breech, down and back out of the channel, tumbling end over end.
function ejectCasing(s) {
  const ud = s.mesh.userData;
  ud.breech.getWorldPosition(_a);
  ud.head.getWorldQuaternion(_q);
  _fwd.set(0, 0, 1).applyQuaternion(_q);
  const side = Math.random() < 0.5 ? -1 : 1;
  const m = new THREE.Mesh(casingGeo, mats.brass);
  m.castShadow = true;
  m.position.copy(_a);
  m.quaternion.copy(_q);
  state.scene.add(m);
  casings.push({
    mesh: m, t: 0, landed: false, bounces: 0,
    vx: -_fwd.x * 4.5 + _fwd.z * side * 0.8, vy: 4.5, vz: -_fwd.z * 4.5 - _fwd.x * side * 0.8,
    spin: new THREE.Vector3(6 + Math.random() * 3, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 2),
  });
  puff(_a.x, _a.y, _a.z, { color: 0x8a847c, size: 0.9, grow: 1.8, life: 1.6, opacity: 0.5, vy: 1.5, drag: 1 });
  audio.play('apoc_eject', { x: s.x, z: s.z });
  if (casings.length > 3) { const old = casings.shift(); state.scene.remove(old.mesh); }
}

const _e = new THREE.Euler();
export function updateApocalypseOrdnance(dt) {
  for (let k = markers.length - 1; k >= 0; k--) {             // override markers pulse; a lost or sold gun takes its marker away
    const mk = markers[k];
    if (mk.s.hp <= 0 || !state.structures.includes(mk.s)) { dropMarker(k); continue; }
    const p = 0.5 + 0.5 * Math.sin(state.time * 5);
    mk.band.opacity = 0.55 + 0.4 * p;
    mk.fill.material.opacity = 0.08 + 0.08 * p;
  }
  for (let k = shells.length - 1; k >= 0; k--) {
    const sh = shells[k];
    sh.t += dt;
    const u = Math.min(1, sh.t / sh.dur);
    const m = sh.mesh;
    _b.lerpVectors(sh.start, sh.end, u);
    _b.y += sh.h * 4 * u * (1 - u);
    _a.subVectors(_b, m.position);
    if (_a.lengthSq() > 1e-6) m.lookAt(_a.add(_b));
    m.position.copy(_b);
    sh.puffT -= dt;
    if (sh.puffT <= 0) { sh.puffT = 0.04; puff(_b.x, _b.y, _b.z, { color: 0xcfc8c0, size: 0.6, grow: 2, life: 1.3, opacity: 0.4, drag: 0.6 }); }
    if (!sh.whistled && sh.dur - sh.t < 1.0) { sh.whistled = true; audio.play('artillery_whistle', { x: sh.end.x, z: sh.end.z, vol: 0.9 }); }
    if (u >= 1) {
      explode(sh.end.x, sh.end.z, 4.2, sh.dmg, sh.splash, { shake: 1.1, smoke: 20 });
      explode(sh.end.x, sh.end.z, 2.4, 0, 0, { shake: 0, smoke: 6, color: 0xffd080 });
      state.scene.remove(m);
      shells.splice(k, 1);
    }
  }
  for (let k = casings.length - 1; k >= 0; k--) {
    const c = casings[k], m = c.mesh;
    c.t += dt;
    if (!c.landed) {
      c.vy -= 20 * dt;
      m.position.x += c.vx * dt; m.position.y += c.vy * dt; m.position.z += c.vz * dt;
      _e.set(c.spin.x * dt, c.spin.y * dt, c.spin.z * dt);
      m.quaternion.multiply(_q.setFromEuler(_e));
      const gy = heightAt(m.position.x, m.position.z) + SHELL_R;
      if (m.position.y <= gy) {
        m.position.y = gy;
        if (c.bounces++ < 2 && c.vy < -2) {
          c.vy *= -0.3; c.vx *= 0.5; c.vz *= 0.5; c.spin.multiplyScalar(0.4);
          audio.play('apoc_eject', { x: m.position.x, z: m.position.z, vol: 0.5 });
        } else {                                              // settle on its side
          c.landed = true;
          _e.setFromQuaternion(m.quaternion, 'YXZ');
          m.rotation.set(0, _e.y, 0, 'YXZ');                  // its axis is along local z: lying flat
        }
      }
    } else if (c.t > 6) {                                     // then sinks away into the dirt
      m.position.y -= dt * 0.4;
      if (c.t > 7.5) { state.scene.remove(m); casings.splice(k, 1); }
    }
  }
}

