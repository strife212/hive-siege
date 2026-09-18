import * as THREE from 'three';
import { BUILDINGS, ENEMIES, RESEARCH, START_CREDITS, CELLS, MAX_SLOPE, SPAWN_RADIUS, CELL, HALF, FLAT } from './config.js';
import { heightAt, cellToWorld, worldToCell, cellKey, inBounds, cellSlope } from './terrain.js';
import {
  makeBuildingMesh, makeHpBar, setHpBar,
  makeProjectile, makeBeam, makeTracer, makeGib, makeSpawnMarker, makeCasing, makeMortarShell, makeMissile,
} from './entities.js';
import { explode, railBeam } from './effects.js';
import { spawnSplatter, updateDecals } from './decals.js';
import { audio } from './audio.js';
import { flow } from './flowfield.js';
import { spatial } from './spatial.js';
import { swarm } from './swarm.js';
import { puff } from './particles.js';

export const state = {
  scene: null,
  intro: true,
  credits: START_CREDITS,
  wave: 0,
  waveActive: false,
  kills: 0,
  gameOver: false,
  time: 0,
  structures: [],
  enemies: [],
  projectiles: [],
  shells: [],
  missiles: [],
  beams: [],
  gibs: [],
  casings: [],
  shake: 0,
  corpses: [],
  markers: [],
  occ: new Map(),          // "i,j" -> structure
  research: {},
  core: null,
  spawnQueue: [],
  spawnTimer: 0,
  spawnAngles: [],
  hpMul: 1,
  flowDirty: true,
  flowBuilt: -99,
  deadCount: 0,
  gibCount: 0,
};

const listeners = { log: [], gameover: [] };
export function on(evt, fn) { listeners[evt].push(fn); }
export function log(msg, bad = false) { listeners.log.forEach((f) => f(msg, bad)); }

let nextId = 1;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _q = new THREE.Quaternion();

// ---------------------------------------------------------------- setup
export function init(scene) {
  state.scene = scene;
  swarm.init(scene);
  const core = {
    id: nextId++, type: 'core', name: 'Core', hp: 1000, maxHp: 1000,
    x: 0, z: 0, y: heightAt(0, 0), cells: [], cooldown: 0,
  };
  const c = CELLS / 2;
  for (const [i, j] of [[c - 1, c - 1], [c, c - 1], [c - 1, c], [c, c]]) {
    state.occ.set(cellKey(i, j), core);
    core.cells.push([i, j]);
  }
  core.mesh = makeBuildingMesh('core');
  core.mesh.position.set(0, core.y - 0.2, 0);
  scene.add(core.mesh);
  core.bar = makeHpBar(4);
  core.bar.position.set(0, core.y + 4.6, 0);
  core.bar.visible = false;
  scene.add(core.bar);
  state.core = core;
  state.structures.push(core);
}

export const hasBuilding = (type) => state.structures.some((s) => s.type === type);

// ---------------------------------------------------------------- building
// Footprints: BUILDINGS[type].size = [w, h] cells (default 1x1). (i, j) is the anchor (min corner) cell.
export const footprint = (type) => BUILDINGS[type].size || [1, 1];
export function anchorFor(type, x, z) {
  const [w, h] = footprint(type);
  return { i: Math.floor((x + HALF) / CELL - (w - 1) / 2), j: Math.floor((z + HALF) / CELL - (h - 1) / 2) };
}
export function footprintCenter(type, i, j) {
  const [w, h] = footprint(type);
  return { x: (i + w / 2) * CELL - HALF, z: (j + h / 2) * CELL - HALF };
}
function footprintCells(type, i, j) {
  const [w, h] = footprint(type);
  const cells = [];
  for (let a = 0; a < w; a++) for (let b = 0; b < h; b++) cells.push([i + a, j + b]);
  return cells;
}

export function canPlace(type, i, j) {
  const def = BUILDINGS[type];
  const cells = footprintCells(type, i, j);
  const [w, h] = footprint(type);
  for (const [ci, cj] of cells) {
    if (!inBounds(ci, cj)) return { ok: false, reason: 'Out of bounds' };
    if (state.occ.has(cellKey(ci, cj))) return { ok: false, reason: 'Cell occupied' };
  }
  let lo = Infinity, hi = -Infinity;
  for (const [ci, cj] of cells) {
    const x0 = ci * CELL - HALF, z0 = cj * CELL - HALF;
    for (const hh of [heightAt(x0, z0), heightAt(x0 + CELL, z0), heightAt(x0, z0 + CELL), heightAt(x0 + CELL, z0 + CELL)]) { lo = Math.min(lo, hh); hi = Math.max(hi, hh); }
  }
  if (hi - lo > MAX_SLOPE * (w > 1 || h > 1 ? 1.6 : 1)) return { ok: false, reason: 'Ground too steep' };
  if (def.requires && !hasBuilding(def.requires)) return { ok: false, reason: `Requires ${BUILDINGS[def.requires].name}` };
  const { x, z } = footprintCenter(type, i, j);
  const clear = 0.7 + Math.max(w, h) * CELL * 0.45;
  let blocked = false;
  spatial.each(x, z, clear, () => (blocked = true));
  if (blocked) return { ok: false, reason: 'A bug is in the way' };
  if (state.credits < def.cost) return { ok: false, reason: 'Not enough credits' };
  return { ok: true };
}

export function placeStructure(type, i, j) {
  const def = BUILDINGS[type];
  const { x, z } = footprintCenter(type, i, j);
  const y = heightAt(x, z);
  const maxHp = def.hp * (type === 'wall' && state.research.plating ? 2 : 1);
  const s = { id: nextId++, type, def, name: def.name, i, j, x, y, z, hp: maxHp, maxHp, cooldown: 0, target: null, rise: 0, cells: footprintCells(type, i, j) };
  s.mesh = makeBuildingMesh(type);
  s.baseY = y - 0.15;
  s.sink = new THREE.Box3().setFromObject(s.mesh).max.y + 0.3;   // start fully buried, rise into place
  s.mesh.position.set(x, s.baseY - s.sink, z);
  state.scene.add(s.mesh);
  burst(x, y + 0.2, z, 'soil', 8 * s.cells.length, 3 + s.cells.length);
  s.bar = makeHpBar(1.2 + 0.4 * s.cells.length);
  s.bar.position.set(x, y + s.sink + 0.2, z);
  s.bar.visible = false;
  state.scene.add(s.bar);
  for (const [ci, cj] of s.cells) state.occ.set(cellKey(ci, cj), s);
  state.flowDirty = true;
  state.structures.push(s);
  state.credits -= def.cost;
  return s;
}

export function sellStructure(s) {
  if (s.type === 'core' || s.hp <= 0) return;
  const refund = Math.floor(s.def.cost * 0.5);
  state.credits += refund;
  log(`Sold ${s.name} for ${refund} credits`);
  removeStructure(s);
}

function removeStructure(s) {
  state.flowDirty = true;
  if (s.snd) { s.snd.stop(); s.snd = null; }
  state.scene.remove(s.mesh, s.bar);
  if (s.cells) for (const [i, j] of s.cells) state.occ.delete(cellKey(i, j));
  else state.occ.delete(cellKey(s.i, s.j));
  const k = state.structures.indexOf(s);
  if (k >= 0) state.structures.splice(k, 1);
  s.hp = 0;
}

function damageStructure(s, dmg) {
  if (s.hp <= 0) return;
  s.hp -= dmg;
  s.bar.visible = true;
  setHpBar(s.bar, s.hp / s.maxHp);
  if (s.hp <= 0) {
    burst(s.x, s.y + 1, s.z, 'debris', 10);
    if (s.type === 'core') {
      state.gameOver = true;
      log('The Core has been destroyed!', true);
      listeners.gameover.forEach((f) => f());
    } else {
      log(`${s.name} destroyed!`, true);
      removeStructure(s);
    }
  }
}

export function doResearch(key) {
  const r = RESEARCH[key];
  if (state.research[key]) return;
  if (!hasBuilding('lab')) return log('Research requires a Research Lab', true);
  if (state.credits < r.cost) return log('Not enough credits', true);
  state.credits -= r.cost;
  state.research[key] = true;
  if (key === 'plating') {
    for (const s of state.structures) if (s.type === 'wall') { s.maxHp *= 2; s.hp *= 2; setHpBar(s.bar, s.hp / s.maxHp); }
  }
  log(`Research complete: ${r.name}`);
}

// ---------------------------------------------------------------- enemies
function spawnEnemy(type, x, z) {
  const def = ENEMIES[type];
  const maxHp = Math.round(def.hp * state.hpMul);
  const e = {
    id: nextId++, type, def, x, z, hp: maxHp, maxHp, dead: false,
    speed: def.speed * (0.9 + Math.random() * 0.2),
    attackCd: Math.random() * 0.5, target: null, lunge: 0,
    aimX: (Math.random() - 0.5) * 3, aimZ: (Math.random() - 0.5) * 3,
    fx: 0, fz: 1, phase: Math.random() * Math.PI * 2, walk: 0, emerge: 0,
    jit: (Math.random() - 0.5) * 0.35, burn: null, deadT: 0,
  };
  e.fx = -x; e.fz = -z;                                  // face the Core as it burrows out
  burst(x, heightAt(x, z) + 0.2, z, 'soil', 4, 4);
  state.enemies.push(e);
  return e;
}

// Test helper: drop n bugs around the basin edge at once.
export function spawnMany(n, type = 'skitter') {
  for (let k = 0; k < n; k++) {
    const a = Math.random() * Math.PI * 2, r = SPAWN_RADIUS - Math.random() * 12;
    spawnEnemy(k % 6 === 5 ? 'brute' : type, Math.cos(a) * r, Math.sin(a) * r);
  }
}

// Visit every live enemy within r of (x, z): fn(e, distSquared). Return true to stop.
export function eachEnemy(x, z, r, fn) { spatial.each(x, z, r, fn); }

export function damageEnemy(e, dmg) {
  if (e.dead) return;
  e.hp -= dmg;
  if (e.hp <= 0) killEnemy(e);
}

function killEnemy(e) {
  e.dead = true;
  state.credits += e.def.reward;
  state.kills++;
  burst(e.x, heightAt(e.x, e.z) + 0.5 * e.def.scale, e.z, 'ichor', 5);
  spawnSplatter(state.scene, e.x, e.z, e.def.scale);
  e.deadT = 0;
  e.target = null;
  state.corpses.push(e);
  state.deadCount++;                                     // compacted out of state.enemies at end of frame
}

const MAX_GIBS = 400;
export function burst(x, y, z, kind, n, spread = 8) {
  if (state.gibs.length >= MAX_GIBS) return;
  n = Math.min(n, MAX_GIBS - state.gibs.length);
  for (let k = 0; k < n; k++) {
    const m = makeGib(kind);
    m.position.set(x, y, z);
    state.scene.add(m);
    state.gibs.push({
      mesh: m, life: 0.6 + Math.random() * 0.4,
      vx: (Math.random() - 0.5) * spread, vy: 2 + Math.random() * 5, vz: (Math.random() - 0.5) * spread,
    });
  }
}

// ---------------------------------------------------------------- waves
export function startWave() {
  if (state.waveActive || state.gameOver) return;
  state.wave++;
  const n = state.wave;
  state.waveActive = true;
  state.hpMul = 1 + 0.12 * (n - 1);
  const q = [];
  const count = 6 + n * 3 + Math.floor(n * n * 0.6);       // 9, 14, 20 ... wave 10: 96, wave 20: 306, wave 30: 666
  for (let k = 0; k < count; k++) q.push('skitter');
  if (n >= 3) for (let k = 0; k < Math.floor((n - 2) * 1.5 + n * n * 0.08); k++) q.push('brute');
  for (let k = q.length - 1; k > 0; k--) { const r = Math.floor(Math.random() * (k + 1)); [q[k], q[r]] = [q[r], q[k]]; }
  state.spawnQueue = q;
  state.spawnTimer = 1.5;
  state.spawnAngles = [];
  const nests = Math.min(4, 1 + Math.floor(n / 3));
  const base = Math.random() * Math.PI * 2;
  for (let k = 0; k < nests; k++) {
    const a = base + (k / nests) * Math.PI * 2 + (Math.random() - 0.5) * 0.8;
    state.spawnAngles.push(a);
    const m = makeSpawnMarker();
    const x = Math.cos(a) * SPAWN_RADIUS, z = Math.sin(a) * SPAWN_RADIUS;
    m.position.set(x, heightAt(x, z) + 0.15, z);
    state.scene.add(m);
    state.markers.push(m);
  }
  log(`Wave ${n}: ${q.length} bugs incoming from ${nests} nest${nests > 1 ? 's' : ''}!`, true);
}

function updateWave(dt) {
  if (!state.waveActive) return;
  if (state.spawnQueue.length) {
    state.spawnTimer -= dt;
    if (state.spawnTimer <= 0) {
      state.spawnTimer = 0.3;
      const batch = Math.min(state.spawnQueue.length, Math.ceil(state.spawnQueue.length / 60));   // big waves pour out faster
      for (let k = 0; k < batch; k++) {
        const a = state.spawnAngles[Math.floor(Math.random() * state.spawnAngles.length)] + (Math.random() - 0.5) * 0.25;
        const r = SPAWN_RADIUS - Math.random() * 3;
        spawnEnemy(state.spawnQueue.pop(), Math.cos(a) * r, Math.sin(a) * r);
      }
    }
  } else if (state.enemies.length === 0) {
    state.waveActive = false;
    const bonus = 50 + state.wave * 25;
    state.credits += bonus;
    for (const m of state.markers) state.scene.remove(m);
    state.markers.length = 0;
    log(`Wave ${state.wave} cleared! +${bonus} credit bonus`);
  }
  for (const m of state.markers) m.scale.setScalar(1 + 0.15 * Math.sin(state.time * 6));
}

// ---------------------------------------------------------------- towers
function nearestEnemy(x, z, range, minRange = 0) {
  let best = null, bd = range * range;
  const mn = minRange * minRange;
  spatial.each(x, z, range, (e, d) => { if (d < bd && d >= mn) { bd = d; best = e; } });
  return best;
}

// The bug with the most neighbours within 4 units: where a salvo pays off most.
function clusterTarget(x, z, range) {
  let best = null, bestScore = -1;
  spatial.each(x, z, range, (e) => {
    let score = 0;
    spatial.each(e.x, e.z, 4, () => { score++; });
    if (score > bestScore) { bestScore = score; best = e; }
  });
  return best;
}

function updateTower(s, dt) {
  if (s.rise < 1) return;                 // still rising out of the ground
  const def = s.def;
  if (def.kind === 'mortar') return updateMortar(s, dt);
  if (def.kind === 'missile') return updateSilo(s, dt);
  if (def.kind === 'rail') return updateRailgun(s, dt);
  s.cooldown -= dt;
  if (s.target && (s.target.dead || Math.hypot(s.target.x - s.x, s.target.z - s.z) > def.range)) s.target = null;
  if (!s.target) s.target = nearestEnemy(s.x, s.z, def.range);
  const t = s.target;
  if (def.kind === 'hitscan') {
    if (t && !s.snd) s.snd = audio.loop('laser_beam', { x: s.x, z: s.z });
    if (!t && s.snd) { s.snd.stop(); s.snd = null; }
  }
  if (def.kind === 'flame') {
    if (t && !s.snd) s.snd = audio.loop('flame_loop', { x: s.x, z: s.z });
    if (!t && s.snd) { s.snd.stop(); s.snd = null; }
    const ud = s.mesh.userData;
    ud.pilot.scale.setScalar(0.25 + Math.random() * 0.12);
    if (t) { ud.head.lookAt(t.x, s.mesh.position.y + ud.head.position.y, t.z); flameStream(s, dt); }
    return;
  }
  if (!t) return;

  const head = s.mesh.userData.head;
  if (head) head.lookAt(t.x, s.mesh.position.y + head.position.y, t.z);
  aimPitch(s, t, dt);
  if (s.cooldown > 0) return;
  s.cooldown = 1 / def.rate;

  const ud = s.mesh.userData;
  if (def.kind === 'projectile') {
    for (const gp of ud.guns) {
      gp.muzzle.getWorldPosition(_a);
      const m = makeProjectile();
      m.position.copy(_a);
      state.scene.add(m);
      state.projectiles.push({ mesh: m, target: t, speed: 30, damage: def.damage, life: 3 });
      ejectCasing(s, gp);
    }
    audio.play('autocannon_fire', { x: s.x, z: s.z, vol: 0.8 });
    if (ud.guns.length > 1) audio.play('autocannon_fire', { x: s.x, z: s.z, vol: 0.7, delay: 0.05 });
    s.recoilT = 0;
  } else if (def.kind === 'tracer') {
    for (const gp of ud.guns) {
      gp.muzzle.getWorldPosition(_a);
      _b.set(t.x + (Math.random() - 0.5) * 0.5, heightAt(t.x, t.z) + (0.3 + Math.random() * 0.4) * t.def.scale, t.z + (Math.random() - 0.5) * 0.5);
      const tr = makeTracer(_a, _b);
      state.scene.add(tr);
      state.beams.push({ mesh: tr, life: 0.05, max: 0.05 });
      damageEnemy(t, def.damage);
      if (Math.random() < 0.3) burst(_b.x, _b.y, _b.z, 'ichor', 1, 3);
      ejectCasing(s, gp);
    }
    audio.play('hmg_fire', { x: s.x, z: s.z, vol: 0.55 });
    s.recoilT = 0;
  } else {
    ud.muzzle.getWorldPosition(_a);
    _b.set(t.x, heightAt(t.x, t.z) + 0.5 * t.def.scale, t.z);
    const beam = makeBeam(_a, _b);
    state.scene.add(beam);
    state.beams.push({ mesh: beam, life: 0.12 });
    damageEnemy(t, def.damage * (state.research.optics ? 1.5 : 1));
  }
}

function updateProjectiles(dt) {
  const list = state.projectiles;
  for (let k = list.length - 1; k >= 0; k--) {
    const p = list[k];
    p.life -= dt;
    const t = p.target;
    if (t.dead || p.life <= 0) { state.scene.remove(p.mesh); list.splice(k, 1); continue; }
    _b.set(t.x, heightAt(t.x, t.z) + 0.5 * t.def.scale, t.z);
    _a.subVectors(_b, p.mesh.position);
    const dist = _a.length();
    const step = p.speed * dt;
    if (dist <= step + 0.3) {
      damageEnemy(t, p.damage);
      if (state.research.he) {
        spatial.each(t.x, t.z, 2.2, (e) => { if (e !== t) damageEnemy(e, p.damage * 0.6); });
        burst(t.x, _b.y, t.z, 'debris', 4);
      }
      state.scene.remove(p.mesh);
      list.splice(k, 1);
    } else {
      p.mesh.position.addScaledVector(_a, step / dist);
    }
  }
}

// Beam director pitch: track the target's elevation while engaged, drift back to the idle angle otherwise.
function aimPitch(s, t, dt) {
  const ud = s.mesh.userData;
  if (!ud.pitch) return;
  let goal = ud.idlePitch;
  if (t) {
    ud.pitch.getWorldPosition(_c);
    const dy = heightAt(t.x, t.z) + 0.5 * t.def.scale - _c.y;
    const dist = Math.hypot(t.x - _c.x, t.z - _c.z);
    goal = -Math.atan2(dy, dist);
  }
  ud.pitch.rotation.x += (goal - ud.pitch.rotation.x) * Math.min(1, dt * 6);
  if (ud.lens) {
    const firing = t && s.cooldown > 0 ? 1 : 0;
    const want = 0.9 + firing * 3.2;
    ud.lens.material.emissiveIntensity += (want - ud.lens.material.emissiveIntensity) * Math.min(1, dt * 10);
  }
}

// ---------------------------------------------------------------- Mortar Pit
const _t = new THREE.Vector3();
function updateMortar(s, dt) {
  const def = s.def, ud = s.mesh.userData;
  s.cooldown -= dt;
  s.recoilT = (s.recoilT ?? 1) + dt;
  const k = s.recoilT < 0.06 ? s.recoilT / 0.06 : Math.max(0, 1 - (s.recoilT - 0.06) / 0.5);
  ud.tube.position.y = -0.35 * k;
  ud.flash.visible = s.recoilT < 0.07;
  if (s.target && (s.target.dead || Math.hypot(s.target.x - s.x, s.target.z - s.z) > def.range || Math.hypot(s.target.x - s.x, s.target.z - s.z) < def.minRange)) s.target = null;
  if (!s.target) s.target = nearestEnemy(s.x, s.z, def.range, def.minRange);
  const t = s.target;
  if (!t) return;
  ud.head.lookAt(t.x, s.mesh.position.y + ud.head.position.y, t.z);
  if (s.cooldown > 0) return;
  s.cooldown = 1 / def.rate;
  s.recoilT = 0;
  // lead the target along its heading for the flight time
  const dist = Math.hypot(t.x - s.x, t.z - s.z);
  const dur = 1.1 + dist * 0.035;
  const fl = Math.hypot(t.fx, t.fz) || 1;
  const lead = t.target ? 0 : t.speed * dur * 0.85;
  const ex = t.x + (t.fx / fl) * lead, ez = t.z + (t.fz / fl) * lead;
  ud.muzzle.getWorldPosition(_a);
  const shell = makeMortarShell();
  shell.position.copy(_a);
  state.scene.add(shell);
  state.shells.push({ mesh: shell, start: _a.clone(), end: new THREE.Vector3(ex, heightAt(ex, ez), ez), t: 0, dur, h: 9 + dist * 0.28, dmg: def.damage, splash: def.splash, whistled: false });
  for (let q = 0; q < 3; q++) puff(_a.x, _a.y, _a.z, { color: 0xd8d0c8, size: 0.8, grow: 2, life: 0.9, opacity: 0.5, vy: 2 + Math.random() * 2, vx: (Math.random() - 0.5) * 2, vz: (Math.random() - 0.5) * 2 });
  audio.play('mortar_fire', { x: s.x, z: s.z });
  state.shake += 0.08;
}

function updateShells(dt) {
  for (let k = state.shells.length - 1; k >= 0; k--) {
    const sh = state.shells[k];
    sh.t += dt;
    const u = Math.min(1, sh.t / sh.dur);
    const m = sh.mesh;
    _b.lerpVectors(sh.start, sh.end, u);
    _b.y += sh.h * 4 * u * (1 - u);
    _c.subVectors(_b, m.position);
    if (_c.lengthSq() > 1e-6) m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), _c.normalize());
    m.position.copy(_b);
    if (!sh.whistled && sh.dur - sh.t < 0.9) { sh.whistled = true; audio.play('artillery_whistle', { x: sh.end.x, z: sh.end.z, vol: 0.5 }); }
    if (u >= 1) {
      explode(sh.end.x, sh.end.z, 1.9, sh.dmg, sh.splash, { shake: 0.25, smoke: 8 });
      state.scene.remove(m);
      state.shells.splice(k, 1);
    }
  }
}

// ---------------------------------------------------------------- Missile Silo
function updateSilo(s, dt) {
  const def = s.def, ud = s.mesh.userData;
  s.cooldown -= dt;
  if (s.target && (s.target.dead || Math.hypot(s.target.x - s.x, s.target.z - s.z) > def.range)) s.target = null;
  if (!s.target && s.cooldown <= 1.5) s.target = clusterTarget(s.x, s.z, def.range);
  const wantOpen = !!s.target && s.cooldown <= 1.5 || (s.salvo && s.salvo.left > 0);
  const prev = ud.hatch;
  ud.hatch = Math.max(0, Math.min(1, ud.hatch + (wantOpen ? dt / 0.9 : -dt / 1.2)));
  if (prev === 0 && ud.hatch > 0) audio.play('silo_hatch', { x: s.x, z: s.z });
  if (prev > 0 && ud.hatch === 0) for (const n of ud.noses) n.visible = true;     // reloaded while closed
  const e = ud.hatch < 0.5 ? 2 * ud.hatch * ud.hatch : 1 - Math.pow(-2 * ud.hatch + 2, 2) / 2;
  for (const d of ud.doors) d.pivot.rotation.z = d.side * -1.45 * Math.min(1, e * 1.6);
  ud.rack.position.y = ud.rackDown + (ud.rackUp - ud.rackDown) * Math.max(0, (e - 0.35) / 0.65);
  if (s.salvo && s.salvo.left > 0) {
    s.salvo.timer -= dt;
    if (s.salvo.timer <= 0) {
      s.salvo.timer = 0.12;
      const idx = def.salvo - s.salvo.left;
      s.salvo.left--;
      ud.tubes[idx % ud.tubes.length].getWorldPosition(_a);
      ud.noses[idx % ud.noses.length].visible = false;
      const m = makeMissile();
      m.position.copy(_a);
      state.scene.add(m);
      const tgt = s.target && !s.target.dead ? s.target : clusterTarget(s.x, s.z, def.range);
      state.missiles.push({ mesh: m, pos: _a.clone(), vel: new THREE.Vector3((Math.random() - 0.5) * 3, 12, (Math.random() - 0.5) * 3), target: tgt, last: new THREE.Vector3(s.x, s.y, s.z + 5), t: 0, spin: Math.random() * 6.28, dmg: def.damage, splash: def.splash, trail: 0 });
      audio.play('missile_launch', { x: s.x, z: s.z, vol: 0.8 });
      puff(_a.x, _a.y, _a.z, { color: 0xffd090, size: 1.2, life: 0.15, opacity: 0.9, additive: true });
      puff(_a.x, _a.y - 0.3, _a.z, { color: 0xd8d0c8, size: 1.0, grow: 2.5, life: 1.2, opacity: 0.5, vy: 1.5 });
    }
    return;
  }
  if (!s.target || s.cooldown > 0 || ud.hatch < 0.98) return;
  s.cooldown = def.interval;
  s.salvo = { left: def.salvo, timer: 0 };
}

const _up = new THREE.Vector3(0, 1, 0), _perp = new THREE.Vector3(), _des = new THREE.Vector3();
function updateMissiles(dt) {
  for (let k = state.missiles.length - 1; k >= 0; k--) {
    const ms = state.missiles[k];
    ms.t += dt;
    const m = ms.mesh;
    if (ms.target && ms.target.dead) ms.target = nearestEnemy(ms.pos.x, ms.pos.z, 14);
    if (ms.target) ms.last.set(ms.target.x, heightAt(ms.target.x, ms.target.z) + 0.5 * ms.target.def.scale, ms.target.z);
    if (ms.t > 0.45) {
      _des.subVectors(ms.last, ms.pos).normalize();
      _perp.crossVectors(_des, _up).normalize();
      _des.addScaledVector(_perp, Math.sin(ms.t * 13 + ms.spin) * 0.5).addScaledVector(_up, Math.cos(ms.t * 13 + ms.spin) * 0.3 + (ms.t < 1 ? 0.5 : 0)).normalize().multiplyScalar(30);
      ms.vel.lerp(_des, Math.min(1, dt * 4));
    }
    ms.pos.addScaledVector(ms.vel, dt);
    m.position.copy(ms.pos);
    _c.copy(ms.vel).normalize();
    m.quaternion.setFromUnitVectors(_up, _c);
    m.userData.flame.scale.set(1, 0.7 + Math.random() * 0.6, 1);
    ms.trail += dt;
    if (ms.trail > 0.03) { ms.trail = 0; puff(ms.pos.x, ms.pos.y, ms.pos.z, { color: 0xe0d8d0, size: 0.45, grow: 1.4, life: 1.0, opacity: 0.45, drag: 0.5 }); }
    const ground = heightAt(ms.pos.x, ms.pos.z);
    if ((ms.t > 0.5 && ms.pos.distanceTo(ms.last) < 1.0) || ms.pos.y <= ground + 0.15 || ms.t > 8) {
      explode(ms.pos.x, ms.pos.z, 1.3, ms.dmg, ms.splash, { shake: 0.08, smoke: 5 });
      state.scene.remove(m);
      state.missiles.splice(k, 1);
    }
  }
}

// ---------------------------------------------------------------- Railgun Battery
function updateRailgun(s, dt) {
  const def = s.def, ud = s.mesh.userData;
  if (s.target && (s.target.dead || Math.hypot(s.target.x - s.x, s.target.z - s.z) > def.range)) s.target = null;
  if (!s.target) s.target = nearestEnemy(s.x, s.z, def.range);
  const t = s.target;
  s.charge = s.charge ?? 0;
  if (!t) {
    s.charge = Math.max(0, s.charge - dt * 2);
    ud.caps.emissiveIntensity = 0.3 + s.charge * 1.2;
    return;
  }
  ud.head.lookAt(t.x, s.mesh.position.y + ud.head.position.y, t.z);
  if (s.charge === 0) audio.play('railgun_charge', { x: s.x, z: s.z });
  s.charge += dt;
  ud.caps.emissiveIntensity = 0.3 + (s.charge / def.charge) * 3.5 + (s.charge > def.charge - 0.5 ? Math.random() * 1.5 : 0);
  if (s.charge < def.charge) return;
  s.charge = 0;
  ud.caps.emissiveIntensity = 0.3;
  ud.guns[0].muzzle.getWorldPosition(_a);
  ud.head.getWorldDirection(_c);
  _c.y = 0; _c.normalize();
  const reach = def.range * 1.5;
  _b.copy(_a).addScaledVector(_c, reach);
  _b.y = Math.max(_b.y, heightAt(_b.x, _b.z) + 1);
  railBeam(_a, _b);
  for (const e of state.enemies) {
    if (e.dead) continue;
    const ox = e.x - _a.x, oz = e.z - _a.z;
    const along = ox * _c.x + oz * _c.z;
    if (along < 0 || along > reach) continue;
    const perp = Math.abs(-ox * _c.z + oz * _c.x);
    if (perp < 0.9 + 0.4 * e.def.scale) damageEnemy(e, def.damage * (1 - 0.35 * along / reach));
  }
  s.recoilT = 0;
  audio.play('railgun_fire', { x: s.x, z: s.z });
  state.shake += 0.45;
}

// Flamethrower: gravity-arced stream of fire from the nozzle; every bug inside the cone starts burning.
const _nz = new THREE.Vector3(), _fd = new THREE.Vector3();
function flameStream(s, dt) {
  const def = s.def, ud = s.mesh.userData;
  ud.nozzle.getWorldPosition(_nz);
  ud.head.getWorldDirection(_fd);
  const fx = _fd.x, fz = _fd.z;
  const cosCone = Math.cos((def.cone * Math.PI) / 180);
  spatial.each(s.x, s.z, def.range + 0.8, (e, d2) => {
    const dx = e.x - s.x, dz = e.z - s.z;
    const d = Math.sqrt(d2);
    if (d < 0.01 || (dx * fx + dz * fz) / d < cosCone) return;
    e.burn = { dps: def.damage, t: def.burn };
  });
  s.flameAcc = (s.flameAcc || 0) + dt * 42;
  while (s.flameAcc >= 1) {
    s.flameAcc--;
    const spread = 0.12, speed = 13 + Math.random() * 3;
    puff(_nz.x, _nz.y, _nz.z, {
      color: 0xffe080, color2: 0xff3a10, size: 0.45, grow: 3.2, life: 0.5, opacity: 0.55, additive: true, fadeIn: 0.03,
      vx: fx * speed + (Math.random() - 0.5) * spread * speed, vy: 2.2 + Math.random() * 1.2, vz: fz * speed + (Math.random() - 0.5) * spread * speed,
      grav: 11, drag: 1.2,
    });
  }
  if (Math.random() < dt * 8) {
    puff(_nz.x + fx * 4.5, _nz.y + 0.5, _nz.z + fz * 4.5, { color: 0x2a2622, size: 1.2, grow: 2.2, life: 1.2, opacity: 0.35, vy: 2.5, vx: fx * 3, vz: fz * 3, drag: 1.2 });
  }
}

// Burning status: damage over time with flames licking off the bug.
function updateBurning(dt) {
  const en = state.enemies;
  let burning = 0;
  for (let i = 0; i < en.length; i++) if (en[i].burn && !en[i].dead) burning++;
  const fxScale = Math.min(1, 40 / Math.max(1, burning));       // keep fire particles bounded in a burning horde
  for (let i = 0; i < en.length; i++) {
    const e = en[i];
    if (!e.burn || e.dead) continue;
    e.burn.t -= dt;
    const y = heightAt(e.x, e.z);
    const sc = e.def.scale;
    if (Math.random() < dt * 14 * fxScale) {
      puff(e.x + (Math.random() - 0.5) * 0.9 * sc, y + (0.2 + Math.random() * 0.7) * sc, e.z + (Math.random() - 0.5) * 0.9 * sc,
        { color: 0xffd070, color2: 0xff3010, size: 0.4 * sc + 0.2, grow: 1.4, life: 0.4, opacity: 0.9, additive: true, vy: 2.5, drag: 1 });
    }
    if (Math.random() < dt * 4 * fxScale) puff(e.x, y + 0.8 * sc, e.z, { color: 0x2a2622, size: 0.5, grow: 1.4, life: 1.0, opacity: 0.35, vy: 2 });
    damageEnemy(e, e.burn.dps * dt);
    if (e.burn && e.burn.t <= 0) e.burn = null;
  }
}

// Recoil: the gun assembly kicks back in 50 ms and springs forward over 200 ms; muzzle flash on the kick.
function updateRecoil(s, dt) {
  const ud = s.mesh.userData;
  if (s.recoilT === undefined) return;
  s.recoilT += dt;
  const k = s.recoilT < 0.05 ? s.recoilT / 0.05 : Math.max(0, 1 - (s.recoilT - 0.05) / (ud.recoilReturn ?? 0.2));
  for (const gp of ud.guns) {
    gp.gun.position.z = ud.gunRest - (ud.recoilAmp ?? 0.32) * k;
    gp.flash.visible = s.recoilT < 0.06;
    if (gp.flash.visible) {
      const sc = 0.7 + Math.random() * 0.6;
      gp.flash.scale.set(sc, sc, 1);
      gp.flash.material.rotation = Math.random() * Math.PI;
    }
  }
}

// Spent casing flung out of the side port: tumbles, bounces once, rests, vanishes after 3 s.
function ejectCasing(s, gp) {
  const ud = s.mesh.userData;
  const m = makeCasing();
  gp.port.getWorldPosition(m.position);
  ud.head.getWorldQuaternion(_q);
  _c.set(gp.side, 0, 0).applyQuaternion(_q);                 // out of that gun's side port
  _b.set(0, 0, 1).applyQuaternion(_q);                       // forward
  m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
  state.scene.add(m);
  state.casings.push({
    mesh: m, t: 0, landed: false, bounced: false,
    vx: _c.x * (2 + Math.random() * 1.5) - _b.x * 0.6, vy: 2.5 + Math.random() * 1.5, vz: _c.z * (2 + Math.random() * 1.5) - _b.z * 0.6,
    ax: (Math.random() - 0.5) * 20, ay: (Math.random() - 0.5) * 20,
  });
}

function updateCasings(dt) {
  for (let k = state.casings.length - 1; k >= 0; k--) {
    const c = state.casings[k];
    c.t += dt;
    if (c.t >= 3) { state.scene.remove(c.mesh); state.casings.splice(k, 1); continue; }
    if (c.landed) { if (c.t > 2.7) c.mesh.scale.setScalar(Math.max(0.001, (3 - c.t) / 0.3)); continue; }
    const m = c.mesh;
    c.vy -= 20 * dt;
    m.position.x += c.vx * dt; m.position.y += c.vy * dt; m.position.z += c.vz * dt;
    m.rotation.x += c.ax * dt; m.rotation.y += c.ay * dt;
    const ground = heightAt(m.position.x, m.position.z) + 0.04;
    if (m.position.y <= ground) {
      m.position.y = ground;
      if (c.vy < -1.5 && !c.bounced) { c.bounced = true; c.vy = -c.vy * 0.35; c.vx *= 0.5; c.vz *= 0.5; }
      else { c.landed = true; m.rotation.set(0, Math.random() * Math.PI * 2, Math.PI / 2); }
    }
  }
}

// ---------------------------------------------------------------- enemy AI
const _dir = { x: 0, z: 0 };
function updateEnemies(dt) {
  if (state.flowDirty || state.time - state.flowBuilt > 1.5) {
    flow.build(state.structures, state.core);
    state.flowDirty = false;
    state.flowBuilt = state.time;
  }
  const en = state.enemies;
  spatial.build(en);
  const lim = FLAT - 1;
  for (let idx = 0; idx < en.length; idx++) {
    const e = en[idx];
    if (e.dead) continue;
    if (e.emerge < 1) { e.emerge = Math.min(1, e.emerge + dt / 0.6); continue; }
    e.attackCd -= dt;
    e.lunge = Math.max(0, e.lunge - dt * 4);

    if (e.target && e.target.hp > 0) {
      e.fx = e.target.x - e.x; e.fz = e.target.z - e.z;
      if (e.attackCd <= 0) {
        e.attackCd = 1 / e.def.attackRate;
        e.lunge = 1;
        damageStructure(e.target, e.def.damage);
      }
      continue;
    }
    e.target = null;

    flow.sample(e.x, e.z, _dir);
    // per-bug lateral bias so a column fans out instead of walking a single line
    const cj = Math.cos(e.jit), sj = Math.sin(e.jit);
    const dx = _dir.x * cj - _dir.z * sj, dz = _dir.x * sj + _dir.z * cj;

    // Anything in the cell ahead (or the one we stand in) blocks us: chew through it.
    let c = worldToCell(e.x + dx * 0.9, e.z + dz * 0.9);
    let st = state.occ.get(cellKey(c.i, c.j));
    if (!st) { c = worldToCell(e.x, e.z); st = state.occ.get(cellKey(c.i, c.j)); }
    if (st) { e.target = st; continue; }

    e.x = Math.max(-lim, Math.min(lim, e.x + dx * e.speed * dt));
    e.z = Math.max(-lim, Math.min(lim, e.z + dz * e.speed * dt));
    e.walk += e.speed * dt;
    e.fx = dx; e.fz = dz;
  }

  // Soft separation so bugs swarm instead of stacking (spatial hash: each nearby pair once).
  spatial.pairs(2.4, (a, b) => {
    const r = 0.75 * (a.def.scale + b.def.scale);
    let dx = b.x - a.x, dz = b.z - a.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r && d2 > 1e-6) {
      const d = Math.sqrt(d2), push = (r - d) * 0.5;
      dx /= d; dz /= d;
      a.x -= dx * push; a.z -= dz * push;
      b.x += dx * push; b.z += dz * push;
    }
  });
}

// ---------------------------------------------------------------- effects
function updateEffects(dt) {
  let alive = 0;
  for (let k = 0; k < state.corpses.length; k++) {
    const c = state.corpses[k];
    c.deadT += dt;
    if (c.deadT < 1.5) state.corpses[alive++] = c;
  }
  state.corpses.length = alive;
  for (let k = state.beams.length - 1; k >= 0; k--) {
    const b = state.beams[k];
    b.life -= dt;
    if (b.life <= 0) { state.scene.remove(b.mesh); state.beams.splice(k, 1); continue; }
    b.mesh.scale.x = b.mesh.scale.z = b.life / (b.max || 0.12);
  }
  for (let k = state.gibs.length - 1; k >= 0; k--) {
    const g = state.gibs[k];
    g.life -= dt;
    if (g.life <= 0) { state.scene.remove(g.mesh); state.gibs.splice(k, 1); continue; }
    g.vy -= 22 * dt;
    g.mesh.position.x += g.vx * dt;
    g.mesh.position.y += g.vy * dt;
    g.mesh.position.z += g.vz * dt;
  }
}

// ---------------------------------------------------------------- main tick
export function update(dt) {
  state.time += dt;
  updateWave(dt);
  for (const s of state.structures) {
    if (s.rise < 1) {
      s.rise = Math.min(1, s.rise + dt / 0.75);
      const e = 1 - Math.pow(1 - s.rise, 3);
      s.mesh.position.y = s.baseY - s.sink * (1 - e);
      if (s.rise >= 1) burst(s.x, s.y + 0.3, s.z, 'soil', 6, 4);
    }
    if (s.def?.kind) updateTower(s, dt);
    if (s.mesh.userData.guns) updateRecoil(s, dt);
    if (s.mesh.userData.pitch && !s.target) aimPitch(s, null, dt);
    if (s.def?.income) state.credits += s.def.income * dt;
    const spin = s.mesh.userData.spin;
    if (spin) spin.rotation.y += dt * (s.type === 'refinery' ? 6 : 1.2);
  }
  updateProjectiles(dt);
  updateShells(dt);
  updateMissiles(dt);
  updateEnemies(dt);
  updateBurning(dt);
  updateEffects(dt);
  updateCasings(dt);
  updateDecals(state.scene, dt);
  if (state.deadCount) {
    state.enemies = state.enemies.filter((e) => !e.dead);
    state.deadCount = 0;
  }
  swarm.update(state.enemies, state.corpses, state.time, heightAt);
}
