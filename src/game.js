import * as THREE from 'three';
import { BUILDINGS, ENEMIES, RESEARCH, START_CREDITS, CELLS, MAX_SLOPE, HALF } from './config.js';
import { heightAt, cellToWorld, worldToCell, cellKey, inBounds, cellSlope } from './terrain.js';
import {
  makeBuildingMesh, makeBugMesh, makeHpBar, setHpBar,
  makeProjectile, makeBeam, makeGib, makeSpawnMarker,
} from './entities.js';

export const state = {
  scene: null,
  credits: START_CREDITS,
  wave: 0,
  waveActive: false,
  kills: 0,
  gameOver: false,
  time: 0,
  structures: [],
  enemies: [],
  projectiles: [],
  beams: [],
  gibs: [],
  markers: [],
  occ: new Map(),          // "i,j" -> structure
  research: {},
  core: null,
  spawnQueue: [],
  spawnTimer: 0,
  spawnAngles: [],
  hpMul: 1,
};

const listeners = { log: [], gameover: [] };
export function on(evt, fn) { listeners[evt].push(fn); }
export function log(msg, bad = false) { listeners.log.forEach((f) => f(msg, bad)); }

let nextId = 1;
const SPAWN_RADIUS = HALF - 3;
const _a = new THREE.Vector3(), _b = new THREE.Vector3();

// ---------------------------------------------------------------- setup
export function init(scene) {
  state.scene = scene;
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
export function canPlace(type, i, j) {
  const def = BUILDINGS[type];
  if (!inBounds(i, j)) return { ok: false, reason: 'Out of bounds' };
  if (state.occ.has(cellKey(i, j))) return { ok: false, reason: 'Cell occupied' };
  if (cellSlope(i, j) > MAX_SLOPE) return { ok: false, reason: 'Ground too steep' };
  if (def.requires && !hasBuilding(def.requires)) return { ok: false, reason: `Requires ${BUILDINGS[def.requires].name}` };
  const { x, z } = cellToWorld(i, j);
  if (state.enemies.some((e) => Math.hypot(e.x - x, e.z - z) < 1.4)) return { ok: false, reason: 'A bug is in the way' };
  if (state.credits < def.cost) return { ok: false, reason: 'Not enough credits' };
  return { ok: true };
}

export function placeStructure(type, i, j) {
  const def = BUILDINGS[type];
  const { x, z } = cellToWorld(i, j);
  const y = heightAt(x, z);
  const maxHp = def.hp * (type === 'wall' && state.research.plating ? 2 : 1);
  const s = { id: nextId++, type, def, name: def.name, i, j, x, y, z, hp: maxHp, maxHp, cooldown: 0, target: null };
  s.mesh = makeBuildingMesh(type);
  s.mesh.position.set(x, y - 0.15, z);
  state.scene.add(s.mesh);
  s.bar = makeHpBar(1.6);
  s.bar.position.set(x, y + (type === 'laser' ? 3.8 : 2.4), z);
  s.bar.visible = false;
  state.scene.add(s.bar);
  state.occ.set(cellKey(i, j), s);
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
    fx: 0, fz: 1, phase: Math.random() * Math.PI * 2, walk: 0,
  };
  e.mesh = makeBugMesh(def);
  state.scene.add(e.mesh);
  e.bar = makeHpBar(1.0 * def.scale);
  state.scene.add(e.bar);
  state.enemies.push(e);
}

export function damageEnemy(e, dmg) {
  if (e.dead) return;
  e.hp -= dmg;
  setHpBar(e.bar, e.hp / e.maxHp);
  if (e.hp <= 0) killEnemy(e);
}

function killEnemy(e) {
  e.dead = true;
  state.credits += e.def.reward;
  state.kills++;
  burst(e.x, heightAt(e.x, e.z) + 0.5 * e.def.scale, e.z, 'ichor', 6);
  state.scene.remove(e.mesh, e.bar);
  const k = state.enemies.indexOf(e);
  if (k >= 0) state.enemies.splice(k, 1);
}

function burst(x, y, z, kind, n) {
  for (let k = 0; k < n; k++) {
    const m = makeGib(kind);
    m.position.set(x, y, z);
    state.scene.add(m);
    state.gibs.push({
      mesh: m, life: 0.6 + Math.random() * 0.4,
      vx: (Math.random() - 0.5) * 8, vy: 4 + Math.random() * 6, vz: (Math.random() - 0.5) * 8,
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
  for (let k = 0; k < 6 + n * 3; k++) q.push('skitter');
  if (n >= 3) for (let k = 0; k < Math.floor((n - 2) * 1.5); k++) q.push('brute');
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
      state.spawnTimer = 0.55;
      const a = state.spawnAngles[Math.floor(Math.random() * state.spawnAngles.length)] + (Math.random() - 0.5) * 0.15;
      spawnEnemy(state.spawnQueue.pop(), Math.cos(a) * SPAWN_RADIUS, Math.sin(a) * SPAWN_RADIUS);
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
function nearestEnemy(x, z, range) {
  let best = null, bd = range * range;
  for (const e of state.enemies) {
    const d = (e.x - x) ** 2 + (e.z - z) ** 2;
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

function updateTower(s, dt) {
  const def = s.def;
  s.cooldown -= dt;
  if (s.target && (s.target.dead || Math.hypot(s.target.x - s.x, s.target.z - s.z) > def.range)) s.target = null;
  if (!s.target) s.target = nearestEnemy(s.x, s.z, def.range);
  const t = s.target;
  if (!t) return;

  const head = s.mesh.userData.head;
  if (head) head.lookAt(t.x, s.mesh.position.y + head.position.y, t.z);
  if (s.cooldown > 0) return;
  s.cooldown = 1 / def.rate;

  s.mesh.userData.muzzle.getWorldPosition(_a);
  if (def.kind === 'projectile') {
    const m = makeProjectile();
    m.position.copy(_a);
    state.scene.add(m);
    state.projectiles.push({ mesh: m, target: t, speed: 30, damage: def.damage, life: 3 });
  } else {
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
        for (const e of [...state.enemies]) {
          if (e !== t && Math.hypot(e.x - t.x, e.z - t.z) < 2.2) damageEnemy(e, p.damage * 0.6);
        }
        burst(t.x, _b.y, t.z, 'debris', 4);
      }
      state.scene.remove(p.mesh);
      list.splice(k, 1);
    } else {
      p.mesh.position.addScaledVector(_a, step / dist);
    }
  }
}

// ---------------------------------------------------------------- enemy AI
function updateEnemies(dt) {
  const core = state.core;
  for (const e of state.enemies) {
    e.attackCd -= dt;
    e.lunge = Math.max(0, e.lunge - dt * 4);
    let dx = core.x + e.aimX - e.x, dz = core.z + e.aimZ - e.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;

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

    // Anything in the cell ahead (or the one we stand in) blocks us: chew through it.
    let c = worldToCell(e.x + dx * 0.9, e.z + dz * 0.9);
    let s = state.occ.get(cellKey(c.i, c.j));
    if (!s) { c = worldToCell(e.x, e.z); s = state.occ.get(cellKey(c.i, c.j)); }
    if (s) { e.target = s; continue; }

    e.x += dx * e.speed * dt;
    e.z += dz * e.speed * dt;
    e.walk += e.speed * dt;
    e.fx = dx; e.fz = dz;
  }

  // Soft separation so bugs swarm instead of stacking.
  const en = state.enemies;
  for (let i = 0; i < en.length; i++) {
    const a = en[i];
    for (let j = i + 1; j < en.length; j++) {
      const b = en[j];
      const r = 0.75 * (a.def.scale + b.def.scale);
      let dx = b.x - a.x, dz = b.z - a.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r && d2 > 1e-6) {
        const d = Math.sqrt(d2), push = (r - d) * 0.5;
        dx /= d; dz /= d;
        a.x -= dx * push; a.z -= dz * push;
        b.x += dx * push; b.z += dz * push;
      }
    }
  }

  for (const e of en) {
    const y = heightAt(e.x, e.z);
    const fl = Math.hypot(e.fx, e.fz) || 1;
    const lx = e.fx / fl * e.lunge * 0.35 * e.def.scale, lz = e.fz / fl * e.lunge * 0.35 * e.def.scale;
    e.mesh.position.set(e.x + lx, y, e.z + lz);
    e.mesh.lookAt(e.x + e.fx, y, e.z + e.fz);
    const t = e.walk * 3 + state.time * (e.target ? 10 : 0) + e.phase;
    for (const l of e.mesh.userData.legs) l.pivot.rotation.x = Math.sin(t + l.phase) * 0.45;
    e.bar.position.set(e.x, y + 1.3 * e.def.scale, e.z);
  }
}

// ---------------------------------------------------------------- effects
function updateEffects(dt) {
  for (let k = state.beams.length - 1; k >= 0; k--) {
    const b = state.beams[k];
    b.life -= dt;
    if (b.life <= 0) { state.scene.remove(b.mesh); state.beams.splice(k, 1); continue; }
    b.mesh.scale.x = b.mesh.scale.z = b.life / 0.12;
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
    if (s.def?.kind) updateTower(s, dt);
    if (s.def?.income) state.credits += s.def.income * dt;
    const spin = s.mesh.userData.spin;
    if (spin) spin.rotation.y += dt * (s.type === 'refinery' ? 6 : 1.2);
  }
  updateProjectiles(dt);
  updateEnemies(dt);
  updateEffects(dt);
}
