import * as THREE from 'three';
import { MAPS, BOSS_EVERY, BUILDINGS, ENEMIES, SPECIALS, ANTS, CORNERS, RESEARCH, START_CREDITS, CELLS, MAX_SLOPE, SPAWN_RADIUS, CELL, HALF, FLAT, MAP } from './config.js';
import { heightAt, cellToWorld, cellKey, inBounds, cellSlope, nestPosition, confine, walkInPoint, approachDir, isScenery } from './terrain.js';
import {
  makeBuildingMesh, setWallLinks,
  makeProjectile, makeBeam, makeTracer, makeGibs, makeCasings, makeMortarShell, makeMissile,
} from './entities.js';
import { explode, railBeam } from './effects.js';
import { spawnSplatter, updateDecals } from './decals.js';
import { audio } from './audio.js';
import { flow } from './flowfield.js';
import { updateHeli, updateHeliRockets, removeHeli } from './heli.js';
import { boss } from './boss.js';
import { retract } from './retract.js';
import { updateAirship, updateAirshipOrdnance, removeAirship, airshipArrive } from './airship.js';
import { updateApocalypse, updateApocalypseOrdnance } from './apocalypse.js';
import { spatial } from './spatial.js';
import { swarm } from './swarm.js';
import { gore } from './gore.js';
import { flame } from './flame.js';
import { puff } from './particles.js';
import { acid } from './acid.js';
import { flashes } from './flashes.js';
import { wallBatch } from './walls.js';
import { mineBatch, dropField, updateDrop, clearDrop } from './mines.js';
import { burrows, PIT_R, PIT_DEPTH } from './burrows.js';
import { hpBars, makeHpBar, setHpBar } from './hpbars.js';
import { uploadUsed } from './instancing.js';

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
  demo: false,
  troopers: [],                  // player infantry (troopers.js); bugs hunt them when they get close                   // title-screen attract mode (see demo.js)
  corpses: [],
  occ: new Map(),          // "i,j" -> structure
  research: {},
  core: null,
  spawnQueue: [],
  walkQueue: [],                 // canyon: extra bugs that march in from beyond the mouth
  cornerQueue: [],               // plains, late waves: extra bugs from the corner holes (CORNERS)
  corners: [],
  spawnTimer: 0,
  waveHold: false,               // a strategic strike is holding the attack (strategic.js): nothing spawns, no new wave
  waveResumeAt: 0,               // ...and after it, a breather: the attack resumes at this time
  nextWave: false,               // a wave was cleared during a hold: the next one starts when the hold lifts
  hiveBuff: 1,                   // enemy HP and speed multiplier: x1.1 for every Colossus killed (HIVE_BUFF)
  nests: [],
  flowDirty: true,
  flowBuilt: -99,
  deadCount: 0,
  gibCount: 0,
};

const listeners = { log: [], gameover: [], wave: [], research: [] };
export function on(evt, fn) { listeners[evt].push(fn); }
export function log(msg, bad = false) { listeners.log.forEach((f) => f(msg, bad)); }

let nextId = 1;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _q = new THREE.Quaternion();

// ---------------------------------------------------------------- setup
// state.occ mirrored into a flat grid indexed by cell: the per-bug, per-frame blocker checks read this and skip
// building "i,j" string keys. Always written through occSet / occDelete so the two never disagree.
const occGrid = new Array(CELLS * CELLS).fill(null);
function occSet(i, j, s) {
  state.occ.set(cellKey(i, j), s);
  if (inBounds(i, j)) occGrid[j * CELLS + i] = s;
}
function occDelete(i, j) {
  state.occ.delete(cellKey(i, j));
  if (inBounds(i, j)) occGrid[j * CELLS + i] = null;
}

export function init(scene) {
  state.scene = scene;
  swarm.init(scene);
  gore.init(scene);
  acid.init(scene);
  flame.init(scene);
  wallBatch.init(scene);
  mineBatch.init(scene);
  hpBars.init(scene);
  casingMesh = makeCasings(MAX_CASINGS);
  scene.add(casingMesh);
  const core = {
    id: nextId++, type: 'core', name: 'Core', hp: 1000, maxHp: 1000,
    x: 0, z: 0, y: heightAt(0, 0), cells: [], cooldown: 0,
  };
  const c = CELLS / 2;
  for (const [i, j] of [[c - 1, c - 1], [c, c - 1], [c - 1, c], [c, c]]) {
    occSet(i, j, core);
    core.cells.push([i, j]);
  }
  core.mesh = makeBuildingMesh('core');
  core.baseY = core.y - 0.2;
  core.mesh.position.set(0, core.baseY, 0);
  scene.add(core.mesh);
  core.bar = makeHpBar(4);
  core.bar.position.set(0, core.y + 10.2, 0);
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

export const countBuildings = (type) => state.structures.reduce((n, s) => n + (s.type === type ? 1 : 0), 0);

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
  if (def.limit && countBuildings(type) >= def.limit) return { ok: false, reason: `Only ${def.limit} ${def.name} allowed` };
  const { x, z } = footprintCenter(type, i, j);
  if (isScenery(x, z)) return { ok: false, reason: 'Out of reach' };       // e.g. flat spots on top of the canyon mesa
  const clear = 0.7 + Math.max(w, h) * CELL * 0.45;
  let blocked = false;
  spatial.each(x, z, clear, () => (blocked = true));
  if (blocked) return { ok: false, reason: 'A bug is in the way' };
  if (state.credits < def.cost) return { ok: false, reason: 'Not enough credits' };
  return { ok: true };
}

// Which of the four neighbouring tiles hold a wall (used for wall joins and the placement ghost).
export function wallLinks(i, j) {
  const at = (di, dj) => state.occ.get(cellKey(i + di, j + dj))?.type === 'wall';
  return { e: at(1, 0), w: at(-1, 0), s: at(0, 1), n: at(0, -1) };
}
function refreshWalls(i, j) {
  for (const [di, dj] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const s = state.occ.get(cellKey(i + di, j + dj));
    if (s && s.type === 'wall') setWallLinks(s.mesh, wallLinks(s.i, s.j));
  }
}

// opts.instant: the building is simply there, fully deployed (title demo set dressing): no silo cycle, no dirt burst.
export function placeStructure(type, i, j, opts = {}) {
  const def = DEFS[type];
  const { x, z } = footprintCenter(type, i, j);
  const y = heightAt(x, z);
  const maxHp = def.hp;
  const s = { id: nextId++, type, def, name: def.name, i, j, x, y, z, hp: maxHp, maxHp, cooldown: 0, target: null, cells: footprintCells(type, i, j) };
  s.mesh = makeBuildingMesh(type);
  s.baseY = y - 0.15;
  s.mesh.position.set(x, s.baseY, z);
  if (def.mines) for (const m of s.mesh.userData.mines) m.position.y = heightAt(x + m.position.x, z + m.position.z) - s.baseY - 0.02;   // each mine on the ground under it
  state.scene.add(s.mesh);
  s.bar = makeHpBar(1.2 + 0.4 * s.cells.length);
  s.bar.position.set(x, y + new THREE.Box3().setFromObject(s.mesh).max.y - s.baseY + 0.5, z);
  s.bar.visible = false;
  state.scene.add(s.bar);
  if (opts.instant) { /* simply there */ }
  else if (def.silo === false) dropField(s);                     // minefields are fired down from orbit (mines.js)
  else {
    if (def.kind === 'airship') airshipArrive(s);                // the pad comes up empty; its ship flies in
    retract.install(s);                                          // arrives locked down in its silo and deploys (retract.js)
    burst(x, y + 0.2, z, 'soil', 8 * s.cells.length, 3 + s.cells.length);
  }
  for (const [ci, cj] of s.cells) occSet(ci, cj, s);
  state.flowDirty = true;
  state.structures.push(s);
  if (type === 'wall') { refreshWalls(i, j); wallBatch.add(s.mesh); }     // walls are drawn instanced (walls.js)
  if (def.mines) mineBatch.add(s.mesh);                                    // so are mines (mines.js)
  state.credits -= def.cost;
  return s;
}

export function sellStructure(s) {
  if (s.type === 'core' || s.hp <= 0 || s.selling) return;
  const refund = Math.floor(s.def.cost * 0.5);
  state.credits += refund;
  log(`Sold ${s.name} for ${refund} credits`);
  s.selling = true;
  if (s.def.silo === false) {                                    // no silo to sink into: dug up on the spot
    burst(s.x, s.y + 0.2, s.z, 'soil', 8, 3);
    puff(s.x, s.y + 0.3, s.z, { color: 0x9a7a55, size: 1.6, grow: 1.5, life: 0.9, opacity: 0.45 });
    removeStructure(s);
    return;
  }
  retract.sell(s, () => removeStructure(s));                     // it retracts into its silo, then the site is cleared
}

function removeStructure(s) {
  state.flowDirty = true;
  if (s.def?.kind === 'heli') removeHeli(s);
  if (s.def?.kind === 'airship') removeAirship(s);
  if (s.snd) { s.snd.stop(); s.snd = null; }
  clearDrop(s);
  retract.drop(s);
  state.scene.remove(s.mesh, s.bar);
  if (s.cells) for (const [i, j] of s.cells) occDelete(i, j);
  else occDelete(s.i, s.j);
  const k = state.structures.indexOf(s);
  if (k >= 0) state.structures.splice(k, 1);
  if (s.type === 'wall') refreshWalls(s.i, s.j);
  s.hp = 0;
}

export function damageStructure(s, dmg) {
  if (s.hp <= 0 || s.buried) return;                        // nothing reaches a building under its blast doors
  if (s === state.core && MAPS[MAP].invincibleCore) return;
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

// ---------------------------------------------------------------- research
// Live stats per building type: BUILDINGS with the completed research applied. Every structure points at the entry for
// its type (s.def), so the turrets, the gunship, the airship and the info panel all pick an upgrade up the moment it
// completes. Behavioural research (overpenetration, napalm, prism...) is checked where the weapon fires instead.
const DEFS = {};
const r2 = (v) => Math.round(v * 100) / 100;
function buildDefs() {
  const R = state.research;
  for (const [type, base] of Object.entries(BUILDINGS)) {
    const d = { ...base };
    if (type === 'wall' && R.plating) d.hp *= 2;
    if (R.composite) d.hp = Math.round(d.hp * 1.25);
    if (type === 'hmg' && R.hmgFeed) d.rate = r2(d.rate * 1.3);
    if (type === 'turret' && R.autoloader) d.rate = r2(d.rate * 1.3);
    if (type === 'dual' && R.du) { d.damage *= 1.25; d.range += 2; }
    if (type === 'flame' && R.tanks) { d.range = 10; d.cone = 32; }
    if (type === 'laser' && R.optics) d.damage *= 1.5;
    if (type === 'mortar' && R.crew) d.rate = r2(d.rate * 1.5);
    if (type === 'missile' && R.reload) d.interval = 4;
    if (type === 'heli' && R.heliMags) { d.rounds = 160; d.rockets = 16; }
    if (type === 'airship' && R.deepMags) for (const k of ['gatRounds', 'hmgRounds', 'shells', 'bombs']) d[k] = Math.round(d[k] * 1.5);
    if (type === 'rail' && R.supercap) d.charge = 3;
    if (d.range && R.fireControl) d.range = Math.round(d.range * 1.1 * 10) / 10;
    DEFS[type] = d;
  }
  for (const s of state.structures) if (DEFS[s.type]) s.def = DEFS[s.type];
}
buildDefs();

// Scale a building's HP (both current and max) and redraw its bar.
function scaleHp(s, k) {
  const max = Math.round(s.maxHp * k);
  s.hp *= max / s.maxHp;
  s.maxHp = max;
  if (s.bar) setHpBar(s.bar, s.hp / s.maxHp);
}

export function doResearch(key) {
  const r = RESEARCH[key];
  if (state.research[key]) return;
  if (!hasBuilding('lab')) return log('Research requires a Research Lab', true);
  if (state.credits < r.cost) return log('Not enough credits', true);
  state.credits -= r.cost;
  state.research[key] = true;
  if (key === 'plating') for (const s of state.structures) if (s.type === 'wall') scaleHp(s, 2);
  if (key === 'composite') for (const s of state.structures) scaleHp(s, 1.25);
  buildDefs();
  log(`Research complete: ${r.name}`);
  listeners.research.forEach((f) => f(key));
}

// Fire Control Relay: while the Titan is in the air, towers within RELAY_R of the ground beneath it fire faster. The
// covered circle is traced on the terrain under the ship.
const RELAY_R = 15, RELAY_BOOST = 1.2;
const relayPts = [];
let relayRing = null;
function updateRelay() {
  relayPts.length = 0;
  if (state.research.relay) {
    for (const s of state.structures) {
      const ship = s.def?.kind === 'airship' && s.air && s.air.mode !== 'rearm' ? s.mesh.userData.ship : null;
      if (ship?.parent === state.scene) relayPts.push(ship.position);   // aloft (moored, it hangs off the pad)
    }
  }
  if (!relayPts.length) { if (relayRing) relayRing.visible = false; return; }
  relayRing ??= makeRelayRing();
  const p = relayPts[0], pos = relayRing.geometry.attributes.position, n = pos.count / 2;
  for (let k = 0; k < n; k++) {
    const a = (k / (n - 1)) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
    for (const [v, r] of [[2 * k, RELAY_R - 0.25], [2 * k + 1, RELAY_R + 0.25]]) {
      const x = p.x + c * r, z = p.z + sn * r;
      pos.setXYZ(v, x, heightAt(x, z) + 0.2, z);
    }
  }
  pos.needsUpdate = true;
  relayRing.geometry.computeBoundingSphere();
  relayRing.material.opacity = 0.32 + 0.12 * Math.sin(state.time * 3);
  relayRing.visible = true;
}
function makeRelayRing() {
  const N = 97, geo = new THREE.BufferGeometry(), idx = [];
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3));
  for (let k = 0; k < N - 1; k++) { const a = 2 * k; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  geo.setIndex(idx);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x7fe0ff, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  m.frustumCulled = false;
  state.scene.add(m);
  return m;
}
// Fire-rate multiplier for a tower from the relay.
const relayBoost = (s) => {
  for (const p of relayPts) if ((s.x - p.x) ** 2 + (s.z - p.z) ** 2 < RELAY_R * RELAY_R) return RELAY_BOOST;
  return 1;
};

// Set a bug alight, keeping whichever burn is hotter and longer. flame: a Flamethrower burn (Clinging Napalm spreads it).
function ignite(e, dps, t, flameBurn = false) {
  const b = e.burn;
  e.burn = { dps: Math.max(dps, b?.dps ?? 0), t: Math.max(t, b?.t ?? 0), flame: flameBurn || !!b?.flame };
}

// Clinging Napalm: a bug that dies in Flamethrower fire splashes it onto its neighbours.
function spreadNapalm(e) {
  const burn = e.burn;
  eachEnemy(e.x, e.z, 2, (n) => { if (n !== e) ignite(n, burn.dps, BUILDINGS.flame.burn, true); });
  const y = heightAt(e.x, e.z) + 0.3 * e.def.scale;
  for (let k = 0; k < 5; k++) {
    const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 2.5;
    flame.emit(e.x, y, e.z, { vx: Math.cos(a) * sp, vy: 1.5 + Math.random() * 2, vz: Math.sin(a) * sp, life: 0.35 + Math.random() * 0.2, size: 0.4, grow: 1.4, grav: 6, drag: 1.5, heat: 1 });
  }
}

// ---------------------------------------------------------------- enemies
const HIVE_BUFF = 1.1;
// from: a bug hole (burrows.js) the bug climbs out of: it starts deep in the shaft near the middle and comes up the
// wall and over the lip on the side it faces.
export function spawnEnemy(type, x, z, walkIn = false, from = null) {
  const def = ENEMIES[type];
  // +12% health per wave, up to the wave each species stops toughening at (hpCapWave; none = keeps scaling), times the
  // hive's adaptation to every Colossus killed so far
  const maxHp = Math.round(def.hp * (1 + 0.12 * (Math.max(1, Math.min(state.wave, def.hpCapWave ?? Infinity)) - 1))) * state.hiveBuff;
  const e = {
    id: nextId++, type, def, x, z, hp: maxHp, maxHp, dead: false,
    speed: def.speed * (def.boss ? 1 : 0.9 + Math.random() * 0.2) * state.hiveBuff,
    attackCd: Math.random() * 0.5, target: null, lunge: 0,
    aimX: (Math.random() - 0.5) * 3, aimZ: (Math.random() - 0.5) * 3,
    fx: 0, fz: 1, phase: Math.random() * Math.PI * 2, walk: 0, emerge: 0,
    jit: (Math.random() - 0.5) * 0.35, burn: null, deadT: 0,
  };
  e.fx = -x; e.fz = -z;                                  // face the Core as it burrows out
  if (def.acid) Object.assign(e, { aimYaw: 0, recoil: 0, charge: 0, spitCd: 0.5 + Math.random(), scanT: Math.random() * 0.4, aim: null });
  if (def.boss) boss.init(e);
  else if (walkIn) { e.emerge = 1; e.fx = 0; e.fz = 1; }       // already above ground, marching in
  else if (from) {
    const dx = x - from.x, dz = z - from.z, l = Math.hypot(dx, dz) || 1, r1 = PIT_R + 0.35;
    e.climb = { x0: x, z0: z, x1: from.x + dx / l * r1, z1: from.z + dz / l * r1 };
    e.depth = PIT_DEPTH;
    e.fx = dx; e.fz = dz;
  }
  else burst(x, heightAt(x, z) + 0.2, z, 'soil', 4, 4);
  state.enemies.push(e);
  return e;
}

// Test helper: drop n bugs around the basin edge at once.
export function spawnMany(n, type = 'skitter') {
  for (let k = 0; k < n; k++) {
    const p = nestPosition(Math.random() * 8, 8, 0, SPAWN_RADIUS - Math.random() * 12);
    spawnEnemy(k % 6 === 5 ? 'brute' : type, p.x, p.z);
  }
}

// Visit every live enemy within r of (x, z): fn(e, distSquared). Return true to stop.
export function eachEnemy(x, z, r, fn) { spatial.each(x, z, r, fn); }

// World height to shoot at: a bug's body. Ground bugs sit low; the Colossus reports how high its hull is (e.aimH).
export const aimY = (e) => heightAt(e.x, e.z) + (e.aimH ?? 0.5 * e.def.scale);

export function damageEnemy(e, dmg) {
  if (e.dead) return;
  e.hp -= dmg;
  if (e.hp <= 0) killEnemy(e);
}

// quiet: no splatter, gibs or pop (something else ate it: the black hole)
function killEnemy(e, quiet = false) {
  e.dead = true;
  state.credits += e.def.reward;
  state.kills++;
  if (e.burn?.flame && state.research.napalm) spreadNapalm(e);
  if (e.boss) { boss.die(e); adaptHive(); }
  else if (!quiet) { spawnSplatter(state.scene, e.x, e.z, e.def.scale); gore.spawnDeath(e); audio.play('bug_pop', { x: e.x, z: e.z, vol: 0.4, size: e.def.scale }); }
  e.target = null;
  e.held = null;
  state.deadCount++;                                     // compacted out of state.enemies at end of frame
}
export const consumeEnemy = (e) => { if (!e.dead) killEnemy(e, true); };

// Every Colossus that falls makes the hive adapt: bugs that spawn from then on get 10% more HP and 10% more speed,
// compounding with each kill. Bugs already on the field keep their stats.
function adaptHive() {
  state.hiveBuff *= HIVE_BUFF;
  log(`The hive adapts: new bugs are now ${Math.round((state.hiveBuff - 1) * 100)}% tougher and faster.`, true);
}

// Gibs: flung bits of debris, soil and ichor. Plain records; each kind is drawn by one instanced mesh (updateEffects).
const MAX_GIBS = 400;
const gibPools = {};
const gibPool = (kind) => gibPools[kind] ??= (() => { const im = makeGibs(kind, MAX_GIBS); state.scene.add(im); return im; })();
export function burst(x, y, z, kind, n, spread = 8) {
  if (state.gibs.length >= MAX_GIBS) return;
  n = Math.min(n, MAX_GIBS - state.gibs.length);
  const pool = gibPool(kind);
  for (let k = 0; k < n; k++) {
    state.gibs.push({
      pool, x, y, z, life: 0.6 + Math.random() * 0.4,
      vx: (Math.random() - 0.5) * spread, vy: 2 + Math.random() * 5, vz: (Math.random() - 0.5) * spread,
    });
  }
}

// ---------------------------------------------------------------- waves
// force (debug): pile the next wave on top of whatever is still coming.
export function startWave(force = false) {
  if ((state.waveActive && force !== true) || state.gameOver) return;
  const carry = state.waveActive ? { q: state.spawnQueue, w: state.walkQueue, c: state.cornerQueue } : null;
  burrows.closeAll();                                      // a forced wave: the old holes give way to the new ones
  state.wave++;
  const n = state.wave;
  state.waveActive = true;
  const q = [];
  const count = 6 + n * 3 + Math.floor(n * n * 0.6);       // 9, 14, 20 ... wave 10: 96, wave 20: 306, wave 30: 666
  for (let k = 0; k < count; k++) q.push('skitter');
  if (n >= 3) for (let k = 0; k < Math.floor((n - 2) * 1.5 + n * n * 0.08); k++) q.push('brute');
  if (n >= SPECIALS.from) {                                // specials stand in for skitterers, alternating Darter / Spitter
    const sp = Math.max(2, Math.round(q.length * SPECIALS.share));
    for (let k = 0; k < sp; k++) q[k] = k % 2 ? 'spitter' : 'darter';
  }
  // Canyon: on top of the nests, a horde walks in across the whole width of the open end.
  state.walkQueue = [];
  if (MAP === 'canyon') {
    const extra = Math.ceil(q.length * 0.6);
    const special = n >= SPECIALS.from ? Math.round(1 / SPECIALS.share) : 0;    // every tenth walker is a special
    for (let k = 0; k < extra; k++) {
      state.walkQueue.push(special && k % special === 4 ? (k % (special * 2) === 4 ? 'darter' : 'spitter') : n >= 3 && k % 9 === 8 ? 'brute' : 'skitter');
    }
  }
  // Ants on top of both: the wave grows by ANTS.share, all of it fodder
  const shuffle = (a) => { for (let k = a.length - 1; k > 0; k--) { const r = Math.floor(Math.random() * (k + 1)); [a[k], a[r]] = [a[r], a[k]]; } };
  for (const list of [q, state.walkQueue]) {
    for (let k = Math.round(list.length * ANTS.share); k > 0; k--) list.push('ant');
    shuffle(list);
  }
  state.spawnQueue = q;
  state.spawnTimer = 1.5;
  state.nests = [];
  const nests = Math.min(4, 1 + Math.floor(n / 3));
  const base = Math.random() * Math.PI * 2;
  for (let k = 0; k < nests; k++) {
    const { x, z } = nestPosition(k, nests, base, SPAWN_RADIUS);
    state.nests.push({ x, z });
    burrows.open(x, z);                                    // the nest erupts out of the ground (burrows.js)
  }
  // Plains, late waves: four smaller contributions from holes in the diagonal corners, the same mix as the rest
  state.cornerQueue = [];
  state.corners = [];
  if (MAP !== 'canyon' && n >= CORNERS.from) {
    for (let k = Math.round(q.length * CORNERS.share); k > 0; k--) state.cornerQueue.push(q[Math.floor(Math.random() * q.length)]);
    const c = FLAT - CORNERS.inset;
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const x = sx * c + (Math.random() - 0.5) * 3, z = sz * c + (Math.random() - 0.5) * 3;
      state.corners.push({ x, z });
      burrows.open(x, z);
    }
  }
  if (n % BOSS_EVERY === 0) { const at = state.nests[0]; spawnEnemy('colossus', at.x, at.z); }
  listeners.wave.forEach((f) => f(n, n % BOSS_EVERY === 0));
  if (carry) {                                             // a forced wave on top: what was still to come comes too
    state.spawnQueue = carry.q.concat(state.spawnQueue);
    state.walkQueue = carry.w.concat(state.walkQueue);
    if (state.corners.length) state.cornerQueue = carry.c.concat(state.cornerQueue);
    else state.spawnQueue = state.spawnQueue.concat(carry.c);
  }
  const extra = state.walkQueue.length ? `, ${state.walkQueue.length} more marching up the canyon`
    : state.cornerQueue.length ? `, ${state.cornerQueue.length} more from the corners` : '';
  log(`Wave ${n}: ${q.length} bugs incoming from ${nests} nest${nests > 1 ? 's' : ''}${extra}!`, true);
}

function updateWave(dt) {
  const held = state.waveHold || state.time < state.waveResumeAt;
  if (!state.waveActive) {
    if (state.nextWave && !held) { state.nextWave = false; startWave(); }
    return;
  }
  if (state.spawnQueue.length || state.walkQueue.length || state.cornerQueue.length) {
    if (held) return;                                      // the rest of the wave waits at the nests
    state.spawnTimer -= dt;
    if (state.spawnTimer <= 0) {
      state.spawnTimer = 0.3;
      const walkers = Math.min(state.walkQueue.length, Math.ceil(state.walkQueue.length / 40));
      for (let k = 0; k < walkers; k++) { const p = walkInPoint(); spawnEnemy(state.walkQueue.pop(), p.x, p.z, true); }
      const fromHole = (list, holes) => {                  // deep in one of the holes, climbing out
        const nest = holes[Math.floor(Math.random() * holes.length)];
        const a = Math.random() * Math.PI * 2, r = 0.15 + Math.random() * 0.45;
        spawnEnemy(list.pop(), nest.x + Math.cos(a) * r, nest.z + Math.sin(a) * r, false, nest);
      };
      const batch = Math.min(state.spawnQueue.length, Math.ceil(state.spawnQueue.length / 60));   // big waves pour out faster
      for (let k = 0; k < batch; k++) fromHole(state.spawnQueue, state.nests);
      const side = Math.min(state.cornerQueue.length, Math.ceil(state.cornerQueue.length / 60));  // the corners: a steady trickle
      for (let k = 0; k < side; k++) fromHole(state.cornerQueue, state.corners);
    }
  } else if (state.enemies.length === 0) {
    state.waveActive = false;
    const bonus = 50 + state.wave * 25;
    state.credits += bonus;
    burrows.closeAll();
    log(`Wave ${state.wave} cleared! +${bonus} credit bonus`);
    if (held) state.nextWave = true;                       // not while the base is still sheltering from a strike
    else startWave();                                      // only the first wave waits for the button
  }
}

// ---------------------------------------------------------------- towers
function nearestEnemy(x, z, range, minRange = 0) {
  let best = null, bd = range * range;
  const mn = minRange * minRange;
  spatial.each(x, z, range, (e, d) => { if (d < bd && d >= mn) { bd = d; best = e; } });
  return best;
}

// The bug with the most neighbours within 4 units: where a salvo pays off most. avoid: bugs already aimed at; nothing
// within `sep` of one of them is considered (Distributed Targeting spreads a salvo over several clusters).
function clusterTarget(x, z, range, avoid = null, sep = 0) {
  let best = null, bestScore = -1;
  spatial.each(x, z, range, (e) => {
    if (avoid) for (const a of avoid) if ((e.x - a.x) ** 2 + (e.z - a.z) ** 2 < sep * sep) return;
    let score = 0;
    spatial.each(e.x, e.z, 4, () => { score++; });
    if (score > bestScore) { bestScore = score; best = e; }
  });
  return best;
}

// Turn a tower head toward its target at def.turn rad/s (no snapping). Returns true once it is on target.
function traverse(s, t, dt, tol = 0.07) {
  const head = s.mesh.userData.head;
  if (!head) return true;
  s.yaw = s.yaw ?? head.rotation.y;
  let diff = Math.atan2(t.x - s.x, t.z - s.z) - s.yaw;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  const step = (s.def.turn ?? 3) * dt;
  s.yaw += Math.max(-step, Math.min(step, diff));
  // elevation: level for ground bugs, tilting up when the target's body is well overhead (the Colossus)
  let pitch = 0;
  if (!s.mesh.userData.pitch && s.def.kind !== 'mortar') {
    const dy = aimY(t) - (s.mesh.position.y + head.position.y + 0.3);
    if (dy > 1.5) pitch = -Math.min(1.15, Math.atan2(dy, Math.hypot(t.x - s.x, t.z - s.z)));
  }
  s.elev = (s.elev ?? 0) + (pitch - (s.elev ?? 0)) * Math.min(1, dt * 5);
  if (head.rotation.order !== 'YXZ') head.rotation.order = 'YXZ';
  head.rotation.set(s.elev, s.yaw, 0);
  return Math.abs(diff) <= step + tol && Math.abs(pitch - s.elev) < 0.12;
}

function updateTower(s, dt) {
  const def = s.def;
  if (def.kind === 'mortar') return updateMortar(s, dt);
  if (def.kind === 'missile') return updateSilo(s, dt);
  if (def.kind === 'rail') return updateRailgun(s, dt);
  if (def.kind === 'heli') return updateHeli(s, dt);
  if (def.kind === 'airship') return updateAirship(s, dt);
  if (def.kind === 'apoc') return updateApocalypse(s, dt);
  s.cooldown -= dt;
  if (s.target && (s.target.dead || Math.hypot(s.target.x - s.x, s.target.z - s.z) > def.range)) s.target = null;
  if (!s.target) s.target = nearestEnemy(s.x, s.z, def.range);
  const t = s.target;
  const aligned = t ? traverse(s, t, dt, def.kind === 'flame' ? 0.16 : 0.07) : false;
  if (def.kind === 'hitscan') {
    if (t !== s.focusOn) { s.focusOn = t; s.focusT = 0; } else if (aligned) s.focusT += dt;   // Focusing Array
    if (aligned && !s.snd) s.snd = audio.loop('laser_beam', { x: s.x, z: s.z });
    if (!aligned && s.snd) { s.snd.stop(); s.snd = null; }
  }
  if (def.kind === 'flame') {
    if (aligned && !s.snd) s.snd = audio.loop('flame_loop', { x: s.x, z: s.z });
    if (!aligned && s.snd) { s.snd.stop(); s.snd = null; }
    const ud = s.mesh.userData;
    ud.pilot.scale.setScalar(0.16 + Math.random() * 0.08);
    if (aligned) flameStream(s, dt);
    return;
  }
  if (!t) return;

  aimPitch(s, t, dt);
  if (s.cooldown > 0 || !aligned) return;
  s.cooldown = 1 / (def.rate * relayBoost(s));

  const ud = s.mesh.userData;
  if (def.kind === 'projectile') {
    for (const gp of ud.guns) {
      gp.muzzle.getWorldPosition(_a);
      const m = makeProjectile();
      m.position.copy(_a);
      state.scene.add(m);
      state.projectiles.push({ mesh: m, target: t, speed: 30, damage: def.damage, life: 3, sabot: s.type === 'turret' && !!state.research.sabot });
      ejectCasing(s, gp);
    }
    flashes.add(_a.x, _a.y, _a.z, { color: 0xffc070, power: 9, range: 6, life: 0.1, key: s });
    audio.play('autocannon_fire', { x: s.x, z: s.z, vol: 0.4 });
    if (ud.guns.length > 1) audio.play('autocannon_fire', { x: s.x, z: s.z, vol: 0.35, delay: 0.05 });
    s.recoilT = 0;
  } else if (def.kind === 'tracer') {
    for (const gp of ud.guns) {
      gp.muzzle.getWorldPosition(_a);
      _b.set(t.x + (Math.random() - 0.5) * 0.5, aimY(t) + (Math.random() - 0.5) * 0.4 * t.def.scale, t.z + (Math.random() - 0.5) * 0.5);
      const tr = makeTracer(_a, _b);
      state.scene.add(tr);
      state.beams.push({ mesh: tr, life: 0.05, max: 0.05 });
      const alive = !t.dead, before = t.hp;
      damageEnemy(t, def.damage);
      if (alive && t.dead && state.research.overpen) overpenetrate(t, def.damage - before);
      if (Math.random() < 0.3) burst(_b.x, _b.y, _b.z, 'ichor', 1, 3);
      ejectCasing(s, gp);
    }
    flashes.add(_a.x, _a.y, _a.z, { color: 0xffc070, power: 5, range: 5, life: 0.08, flicker: 0.4, key: s });
    audio.play('hmg_fire', { x: s.x, z: s.z, vol: 0.55 });
    s.recoilT = 0;
  } else {
    ud.muzzle.getWorldPosition(_a);
    _b.set(t.x, aimY(t), t.z);
    const focus = state.research.focus ? 1 + Math.min(1, 0.2 * s.focusT) : 1;
    const beam = makeBeam(_a, _b);
    beam.scale.x = beam.scale.z = focus;                   // the beam fattens as it focuses
    state.scene.add(beam);
    flashes.add(_b.x, _b.y + 0.3, _b.z, { color: 0x7fb8ff, power: 5, range: 5, life: 0.14, key: s });
    state.beams.push({ mesh: beam, life: 0.12 });
    const dmg = def.damage * focus;
    damageEnemy(t, dmg);
    if (state.research.prism) prismArc(t, _b, dmg * 0.5);
  }
}

// Overpenetration: an HMG round that kills its bug carries on into the nearest one within 2 m with what is left.
const _pa = new THREE.Vector3(), _pb = new THREE.Vector3();
function overpenetrate(t, left) {
  if (left <= 0) return;
  const n = nearestOther(t, 2);
  if (!n) return;
  _pa.set(t.x, aimY(t), t.z);
  _pb.set(n.x, aimY(n), n.z);
  const tr = makeTracer(_pa, _pb);
  state.scene.add(tr);
  state.beams.push({ mesh: tr, life: 0.05, max: 0.05 });
  damageEnemy(n, left);
}

// Prism Splitter: every pulse forks to the nearest other bug within 3 m.
function prismArc(t, from, dmg) {
  const n = nearestOther(t, 3);
  if (!n) return;
  _pb.set(n.x, aimY(n), n.z);
  const beam = makeBeam(from, _pb);
  beam.scale.x = beam.scale.z = 0.6;
  state.scene.add(beam);
  state.beams.push({ mesh: beam, life: 0.1 });
  damageEnemy(n, dmg);
}

function nearestOther(t, r) {
  let best = null, bd = r * r;
  spatial.each(t.x, t.z, r, (e, d) => { if (e !== t && d < bd) { bd = d; best = e; } });
  return best;
}

function updateProjectiles(dt) {
  const list = state.projectiles;
  for (let k = list.length - 1; k >= 0; k--) {
    const p = list[k];
    p.life -= dt;
    const t = p.target;
    if (t.dead || p.life <= 0) { state.scene.remove(p.mesh); list.splice(k, 1); continue; }
    _b.set(t.x, aimY(t), t.z);
    _a.subVectors(_b, p.mesh.position);
    const dist = _a.length();
    const step = p.speed * dt;
    if (dist <= step + 0.3) {
      damageEnemy(t, p.damage * (p.sabot && t.def.scale >= 1 ? 1.5 : 1));   // Sabot Shells: medium bugs and the Colossus
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
    const dy = aimY(t) - _c.y;
    const dist = Math.hypot(t.x - _c.x, t.z - _c.z);
    goal = -Math.atan2(dy, dist);
  }
  ud.pitch.rotation.x += (goal - ud.pitch.rotation.x) * Math.min(1, dt * 6);
  if (ud.lens) {
    const firing = t && s.cooldown > 0 ? 1 : 0;
    const want = 0.35 + firing * 3.6;                 // dark glass at rest, hot when lasing (it blooms)
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
  if (!traverse(s, t, dt) || s.cooldown > 0) return;
  s.cooldown = 1 / (def.rate * relayBoost(s));
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
  state.shells.push({ mesh: shell, start: _a.clone(), end: new THREE.Vector3(ex, heightAt(ex, ez), ez), t: 0, dur, h: 9 + dist * 0.28, dmg: def.damage, splash: def.splash, whistled: false, wp: !!state.research.phosphorus });
  flashes.add(_a.x, _a.y + 0.5, _a.z, { color: 0xffb060, power: 22, range: 8, life: 0.18 });
  for (let q = 0; q < 3; q++) puff(_a.x, _a.y, _a.z, { color: 0xd8d0c8, size: 0.8, grow: 2, life: 0.9, opacity: 0.5, vy: 2 + Math.random() * 2, vx: (Math.random() - 0.5) * 2, vz: (Math.random() - 0.5) * 2 });
  audio.play('mortar_fire', { x: s.x, z: s.z });
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
      explode(sh.end.x, sh.end.z, 1.9, sh.dmg, sh.splash, { shake: 0, smoke: 8 });
      if (sh.wp) phosphorus(sh.end.x, sh.end.z, sh.splash);
      state.scene.remove(m);
      state.shells.splice(k, 1);
    }
  }
}

// White Phosphorus: everything in the blast burns, under a burst of dense white smoke with burning streamers.
function phosphorus(x, z, r) {
  eachEnemy(x, z, r, (e) => ignite(e, 12, 4));
  const y = heightAt(x, z);
  for (let k = 0; k < 7; k++) {
    const a = Math.random() * Math.PI * 2, sp = 1.5 + Math.random() * 2.5;
    puff(x, y + 0.6, z, { color: 0xf2f2ec, size: 1.1, grow: 2.6, life: 1.6 + Math.random() * 0.8, opacity: 0.6, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: 1.5 + Math.random() * 2.5, drag: 1.3 });
  }
  for (let k = 0; k < 6; k++) {
    const a = Math.random() * Math.PI * 2, sp = 4 + Math.random() * 4;
    flame.emit(x, y + 0.5, z, { vx: Math.cos(a) * sp, vy: 4 + Math.random() * 4, vz: Math.sin(a) * sp, life: 0.6 + Math.random() * 0.3, size: 0.3, grow: 0.8, grav: 14, drag: 0.6, heat: 1 });
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
      const tgt = state.research.distrib ? salvoTarget(s) : s.target && !s.target.dead ? s.target : clusterTarget(s.x, s.z, def.range);
      state.missiles.push({ mesh: m, pos: _a.clone(), vel: new THREE.Vector3((Math.random() - 0.5) * 3, 12, (Math.random() - 0.5) * 3), target: tgt, last: new THREE.Vector3(s.x, s.y, s.z + 5), t: 0, spin: Math.random() * 6.28, dmg: def.damage, splash: def.splash, trail: 0 });
      audio.play('missile_launch', { x: s.x, z: s.z, vol: 0.4 });           // one at a time (voices in audio.js)
      puff(_a.x, _a.y, _a.z, { color: 0xffd090, size: 1.2, life: 0.15, opacity: 0.9, additive: true });
      puff(_a.x, _a.y - 0.3, _a.z, { color: 0xd8d0c8, size: 1.0, grow: 2.5, life: 1.2, opacity: 0.5, vy: 1.5 });
    }
    return;
  }
  if (!s.target || s.cooldown > 0 || ud.hatch < 0.98) return;
  s.cooldown = def.interval / relayBoost(s);
  s.salvo = { left: def.salvo, timer: 0, aims: [], n: 0 };
}

// Distributed Targeting: each missile goes for a cluster no earlier missile in the salvo has claimed. When there are
// fewer clusters than missiles, the rest are dealt out over the claimed ones in turn.
function salvoTarget(s) {
  const { aims } = s.salvo;
  const t = clusterTarget(s.x, s.z, s.def.range, aims, 4.5);
  if (t) { aims.push(t); return t; }
  const live = aims.filter((a) => !a.dead);
  return live.length ? live[s.salvo.n++ % live.length] : clusterTarget(s.x, s.z, s.def.range);
}

const _up = new THREE.Vector3(0, 1, 0), _perp = new THREE.Vector3(), _des = new THREE.Vector3();
function updateMissiles(dt) {
  for (let k = state.missiles.length - 1; k >= 0; k--) {
    const ms = state.missiles[k];
    ms.t += dt;
    const m = ms.mesh;
    if (ms.target && ms.target.dead) ms.target = nearestEnemy(ms.pos.x, ms.pos.z, 14);
    if (ms.target) ms.last.set(ms.target.x, aimY(ms.target), ms.target.z);
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
      explode(ms.pos.x, ms.pos.z, 1.3, ms.dmg, ms.splash, { shake: 0, smoke: 5 });
      state.scene.remove(m);
      state.missiles.splice(k, 1);
    }
  }
}

// ---------------------------------------------------------------- Railgun Battery
// Railgun priority: the Colossus whenever it is in range, then medium bugs (brutes, spitters), then small ones, nearest
// first within a class. Rechecked four times a second, so a boss or a brute walking into range takes over the gun;
// a target is only dropped for a better class, never for another of the same one.
const railTier = (e) => (e.boss ? 2 : e.def.scale >= 1 ? 1 : 0);
function railTarget(x, z, range) {
  let best = null, bt = -1, bd = Infinity;
  spatial.each(x, z, range, (e, d) => {
    const t = railTier(e);
    if (t > bt || (t === bt && d < bd)) { bt = t; bd = d; best = e; }
  });
  return best;
}

function updateRailgun(s, dt) {
  const def = s.def, ud = s.mesh.userData;
  if (s.target && (s.target.dead || Math.hypot(s.target.x - s.x, s.target.z - s.z) > def.range)) s.target = null;
  s.scan = (s.scan ?? 0) - dt;
  if (!s.target || s.scan <= 0) {
    s.scan = 0.25;
    const best = railTarget(s.x, s.z, def.range);
    if (best && (!s.target || railTier(best) > railTier(s.target))) s.target = best;
  }
  const t = s.target;
  s.charge = s.charge ?? 0;
  s.yaw = s.yaw ?? ud.head.rotation.y;
  const showCharge = () => {
    const frac = Math.min(1, s.charge / def.charge);
    ud.gauge.scale.z = Math.max(0.001, frac);
    ud.gauge.material.emissiveIntensity = 1.8 + frac * 1.6 + (frac >= 1 ? Math.sin(state.time * 18) * 0.8 : 0);
    ud.caps.emissiveIntensity = 0.3 + frac * 3.5 + (frac > 0.85 ? Math.random() * 1.5 : 0);
  };
  if (!t) {
    s.charge = Math.max(0, s.charge - dt * 2);
    showCharge();
    return;
  }
  // Traverse toward the target at a fixed rate; the heavy mount cannot snap between targets.
  const aligned = traverse(s, t, dt, 0.015);
  const boost = relayBoost(s);
  if (s.charge === 0) audio.play('railgun_charge', { x: s.x, z: s.z, charge: def.charge / boost });
  s.charge = Math.min(def.charge, s.charge + dt * boost);
  showCharge();
  if (s.charge < def.charge || !aligned) return;          // holds a full charge until the rails are on target
  s.charge = 0;
  showCharge();
  ud.guns[0].muzzle.getWorldPosition(_a);
  ud.head.getWorldDirection(_c);
  const raised = (s.elev ?? 0) < -0.05;                   // elevated at a Colossus: the bolt follows the rails upward
  if (!raised) _c.y = 0;
  _c.normalize();
  const reach = def.range * 1.5;
  _b.copy(_a).addScaledVector(_c, reach);
  if (!raised) _b.y = Math.max(_b.y, heightAt(_b.x, _b.z) + 1);
  railBeam(_a, _b);
  for (const e of state.enemies) {
    if (e.dead) continue;
    const ox = e.x - _a.x, oz = e.z - _a.z;
    const along = ox * _c.x + oz * _c.z;
    if (along < 0 || along > reach) continue;
    const perp = Math.abs(-ox * _c.z + oz * _c.x);
    if (perp < 0.9 + 0.4 * e.def.scale) damageEnemy(e, def.damage * (1 - 0.35 * along / reach) * (e.boss && state.research.penetrator ? 3 : 1));
  }
  s.recoilT = 0;
  audio.play('railgun_fire', { x: s.x, z: s.z });
}

// Flamethrower: gravity-arced stream of fire from the nozzle; every bug inside the cone starts burning.
const _nz = new THREE.Vector3(), _fd = new THREE.Vector3();
function flameStream(s, dt) {
  const def = s.def, ud = s.mesh.userData;
  ud.nozzle.getWorldPosition(_nz);
  ud.head.getWorldDirection(_fd);
  const fx = _fd.x, fz = _fd.z;
  const cosCone = Math.cos((def.cone * Math.PI) / 180), dps = def.damage * relayBoost(s);
  const reach = def.range / 7.5, fan = def.cone / 24;            // Pressurised Tanks: a longer, wider stream
  spatial.each(s.x, s.z, def.range + 0.8, (e, d2) => {
    const dx = e.x - s.x, dz = e.z - s.z;
    const d = Math.sqrt(d2);
    if (d < 0.01 || (dx * fx + dz * fz) / d < cosCone) return;
    ignite(e, dps, def.burn, true);
  });
  flashes.add(_nz.x + fx * 3 * reach, _nz.y + 0.4, _nz.z + fz * 3 * reach, { color: 0xff7a2a, power: 22, range: 9, life: 0.15, flicker: 0.35, key: s });
  s.flameAcc = (s.flameAcc || 0) + dt * 64;
  while (s.flameAcc >= 1) {
    s.flameAcc--;
    const spread = 0.16 * fan, speed = (10 + Math.random() * 2.5) * reach;
    const ahead = Math.random() * 0.6;                           // stagger along the stream so it reads as continuous
    flame.emit(_nz.x + fx * ahead, _nz.y, _nz.z + fz * ahead, {
      vx: fx * speed + (Math.random() - 0.5) * spread * speed, vy: 1.6 + Math.random() * 1.8, vz: fz * speed + (Math.random() - 0.5) * spread * speed,
      life: 0.42 + Math.random() * 0.18, size: 0.55, grow: 2.1, grav: 10, drag: 1.1, heat: 1,
    });
  }
  if (Math.random() < dt * 10) {
    puff(_nz.x + fx * 5 * reach, _nz.y + 0.6, _nz.z + fz * 5 * reach, { color: 0x2a2622, size: 1.4, grow: 2.4, life: 1.4, opacity: 0.3, vy: 2.5, vx: fx * 3, vz: fz * 3, drag: 1.2 });
  }
}

// Burning status: damage over time with flames licking off the bug.
const burnY = (e) => heightAt(e.x, e.z) + (e.boss ? e.aimH - 1 : 0);
function updateBurning(dt) {
  const en = state.enemies;
  let burning = 0;
  for (let i = 0; i < en.length; i++) if (en[i].burn && !en[i].dead) burning++;
  const fxScale = Math.min(1, 40 / Math.max(1, burning));       // keep fire particles bounded in a burning horde
  for (let i = 0; i < en.length; i++) {
    const e = en[i];
    if (!e.burn || e.dead) continue;
    e.burn.t -= dt;
    const sc = e.def.scale;
    if (Math.random() < dt * 7 * fxScale) {                       // ground height is looked up only when a particle goes out
      const y = burnY(e);
      flame.emit(e.x + (Math.random() - 0.5) * 0.9 * sc, y + (0.2 + Math.random() * 0.6) * sc, e.z + (Math.random() - 0.5) * 0.9 * sc,
        { size: 0.22 * sc + 0.14, grow: 0.7, life: 0.4 + Math.random() * 0.2, vy: 2.2 + Math.random(), vx: (Math.random() - 0.5), vz: (Math.random() - 0.5), drag: 1, heat: 0.7 });
    }
    if (Math.random() < dt * 4 * fxScale) puff(e.x, burnY(e) + 0.8 * sc, e.z, { color: 0x2a2622, size: 0.5, grow: 1.4, life: 1.0, opacity: 0.35, vy: 2 });
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
// Spent casings: plain records (position, rotation, scale), all drawn by one instanced mesh.
const MAX_CASINGS = 1500;
let casingMesh = null;
const _im = new THREE.Matrix4(), _ie = new THREE.Euler(), _iq = new THREE.Quaternion(), _ip = new THREE.Vector3(), _is = new THREE.Vector3();
function ejectCasing(s, gp) {
  if (state.casings.length >= MAX_CASINGS) return;
  const ud = s.mesh.userData;
  gp.port.getWorldPosition(_a);
  ud.head.getWorldQuaternion(_q);
  _c.set(gp.side, 0, 0).applyQuaternion(_q);                 // out of that gun's side port
  _b.set(0, 0, 1).applyQuaternion(_q);                       // forward
  state.casings.push({
    x: _a.x, y: _a.y, z: _a.z, rx: Math.random() * 3, ry: Math.random() * 3, rz: Math.random() * 3, sc: 1,
    t: 0, landed: false, bounced: false,
    vx: _c.x * (2 + Math.random() * 1.5) - _b.x * 0.6, vy: 2.5 + Math.random() * 1.5, vz: _c.z * (2 + Math.random() * 1.5) - _b.z * 0.6,
    ax: (Math.random() - 0.5) * 20, ay: (Math.random() - 0.5) * 20,
  });
}

function updateCasings(dt) {
  let n = 0;
  for (let k = state.casings.length - 1; k >= 0; k--) {
    const c = state.casings[k];
    c.t += dt;
    if (c.t >= 3) { state.casings.splice(k, 1); continue; }
    if (c.landed) { if (c.t > 2.7) c.sc = Math.max(0.001, (3 - c.t) / 0.3); }
    else {
      c.vy -= 20 * dt;
      c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt;
      c.rx += c.ax * dt; c.ry += c.ay * dt;
      const ground = heightAt(c.x, c.z) + 0.04;
      if (c.y <= ground) {
        c.y = ground;
        if (c.vy < -1.5 && !c.bounced) { c.bounced = true; c.vy = -c.vy * 0.35; c.vx *= 0.5; c.vz *= 0.5; }
        else { c.landed = true; c.rx = 0; c.ry = Math.random() * Math.PI * 2; c.rz = Math.PI / 2; }
      }
    }
    _iq.setFromEuler(_ie.set(c.rx, c.ry, c.rz));
    casingMesh.setMatrixAt(n++, _im.compose(_ip.set(c.x, c.y, c.z), _iq, _is.setScalar(c.sc)));
  }
  casingMesh.count = n;
  uploadUsed(casingMesh.instanceMatrix, n);
}

// ---------------------------------------------------------------- enemy AI
// Acid Spitter: the cannon on its back tracks the nearest building in reach and fires while the bug keeps walking (or
// chewing). Walls are beneath its notice: it lobs straight over them at whatever they protect.
function acidTarget(e, range) {
  let best = null, bd = range;
  for (const s of state.structures) {
    if (s.type === 'wall' || s.def?.walkable || s.buried || s.hp <= 0) continue;
    const d = Math.hypot(s.x - e.x, s.z - e.z) - (s.cells && s.cells.length > 1 ? 1.6 : 0.7);    // to its near side
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}
function updateSpitter(e, dt) {
  const A = e.def.acid, sc = e.def.scale;
  e.recoil = Math.max(0, e.recoil - dt * 3.5);
  e.scanT -= dt;
  if (e.scanT <= 0) { e.scanT = 0.4; e.aim = acidTarget(e, A.range); }
  if (e.aim && (e.aim.hp <= 0 || e.aim.buried)) e.aim = null;
  const body = Math.atan2(e.fx, e.fz);
  const want = e.aim ? Math.atan2(e.aim.x - e.x, e.aim.z - e.z) - body : 0;     // no target: face front
  let diff = want - e.aimYaw;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  const step = A.turn * dt;
  e.aimYaw += Math.max(-step, Math.min(step, diff));
  e.aimYaw = Math.atan2(Math.sin(e.aimYaw), Math.cos(e.aimYaw));
  e.spitCd -= dt;
  const charge = e.aim ? Math.min(1, Math.max(0, 1 - e.spitCd / 0.8)) : 0;   // the sac fills over the last 0.8 s
  e.charge += (charge - e.charge) * Math.min(1, dt * 8);
  if (e.aim && e.spitCd <= 0 && Math.abs(diff) < 0.15) {
    e.spitCd = (0.9 + Math.random() * 0.2) / A.rate;
    e.recoil = 1;
    e.charge = 0;
    const w = body + e.aimYaw;
    acid.fire(e.x + Math.sin(w) * 0.66 * sc, heightAt(e.x, e.z) + 1.18 * sc, e.z + Math.cos(w) * 0.66 * sc, e.aim, A.damage);
  }
}

const _dir = { x: 0, z: 0 };
// What stands in a bug's way (and gets chewed): not retracted buildings, and not minefields, which bugs walk over.
// The structure (if any) standing on the build cell under world point (x, z) that stops a bug: not buried, not walkable.
function blockerAt(x, z) {
  const i = Math.floor((x + HALF) / CELL), j = Math.floor((z + HALF) / CELL);
  if (i < 0 || j < 0 || i >= CELLS || j >= CELLS) return null;
  const st = occGrid[j * CELLS + i];
  return st && !st.buried && !st.def?.walkable ? st : null;
}
const PREY_RANGE = 16;                 // bugs this close to a trooper go for it before anything else
function updateEnemies(dt) {
  if (state.flowDirty || state.time - state.flowBuilt > 1.5) {
    flow.build(state.structures.filter((s) => (!s.buried || s === state.core) && !s.def?.walkable), state.core);   // bugs walk straight over closed blast doors and minefields
    state.flowDirty = false;
    state.flowBuilt = state.time;
  }
  const en = state.enemies;
  spatial.build(en);
  const lim = FLAT - 1, canyon = MAP === 'canyon', limX = canyon ? FLAT + 50 : lim, minZ = canyon ? -(FLAT + 50) : -lim;
  for (let idx = 0; idx < en.length; idx++) {
    const e = en[idx];
    if (e.dead) continue;
    if (e.boss) { boss.update(e, dt); continue; }
    if (e.held) continue;                                   // in a black hole's grip: blackhole.js moves it
    if (e.stun > 0) { e.stun -= dt; e.lunge = Math.max(0, e.lunge - dt * 4); continue; }   // just landed, getting its legs back
    if (e.emerge < 1) {
      e.emerge = Math.min(1, e.emerge + dt / (e.climb ? 1.1 : 0.6));
      if (e.climb) {                                        // up the middle of the shaft, then over the lip at the very end
        const c = e.climb, up = 1 - Math.pow(1 - e.emerge, 3), w = up ** 6;
        e.x = c.x0 + (c.x1 - c.x0) * w; e.z = c.z0 + (c.z1 - c.z0) * w;
        if (e.emerge >= 1) { e.climb = null; e.depth = undefined; }
      }
      continue;
    }
    e.attackCd -= dt;
    e.lunge = Math.max(0, e.lunge - dt * 4);
    if (e.def.acid) updateSpitter(e, dt);

    // Troopers are the bugs' top priority: anything within PREY_RANGE drops what it is doing and hunts the nearest
    // one (a small bug's bite costs 1 HP, a brute or spitter takes 2), only chewing a structure when it is actually in the way.
    let prey = null, pd = PREY_RANGE * PREY_RANGE;
    for (let k = 0; k < state.troopers.length; k++) {
      const tr = state.troopers[k];
      if (tr.hp <= 0) continue;
      const d = (tr.x - e.x) ** 2 + (tr.z - e.z) ** 2;
      if (d < pd) { pd = d; prey = tr; }
    }
    if (prey) {
      const reach = 0.55 + 0.5 * e.def.scale;
      if (pd < reach * reach) {
        e.target = null;
        e.fx = prey.x - e.x; e.fz = prey.z - e.z;
        if (e.attackCd <= 0) { e.attackCd = 1 / e.def.attackRate; e.lunge = 1; prey.hp -= e.def.scale >= 1 ? 2 : 1; }
        continue;
      }
      const l = Math.sqrt(pd) || 1;
      _dir.x = (prey.x - e.x) / l; _dir.z = (prey.z - e.z) / l;
      // Only charge straight at the trooper when the way is open. Behind a wall, keep following the normal route in
      // (or keep chewing) instead of piling up against the nearest structure.
      if (blockerAt(e.x + _dir.x * 0.9, e.z + _dir.z * 0.9) || blockerAt(e.x, e.z)) prey = null;
      else e.target = null;
    }

    if (e.target && e.target.hp > 0 && !e.target.buried) {
      e.fx = e.target.x - e.x; e.fz = e.target.z - e.z;
      if (e.attackCd <= 0) {
        e.attackCd = 1 / e.def.attackRate;
        e.lunge = 1;
        damageStructure(e.target, e.def.damage);
      }
      continue;
    }
    e.target = null;

    if (!prey) { if (canyon && e.z < -lim) approachDir(e.x, e.z, _dir); else flow.sample(e.x, e.z, _dir); }
    // per-bug lateral bias so a column fans out instead of walking a single line
    const cj = Math.cos(e.jit), sj = Math.sin(e.jit);
    const dx = _dir.x * cj - _dir.z * sj, dz = _dir.x * sj + _dir.z * cj;

    // Anything in the cell ahead (or the one we stand in) blocks us: chew through it.
    const st = blockerAt(e.x + dx * 0.9, e.z + dz * 0.9) || blockerAt(e.x, e.z);
    if (st) { e.target = st; continue; }

    e.x = Math.max(-limX, Math.min(limX, e.x + dx * e.speed * dt));
    e.z = Math.max(minZ, Math.min(lim, e.z + dz * e.speed * dt));
    e.walk += e.speed * dt;
    e.fx = dx; e.fz = dz;
    confine(e);
  }

  // Soft separation so bugs swarm instead of stacking (spatial hash: each nearby pair once).
  spatial.pairs(2.4, (a, b) => {
    if (a.boss || b.boss || a.held || b.held || a.climb || b.climb) return;   // the swarm runs between the Colossus's legs; held bugs are off the ground, climbing ones in the shaft
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

// ---------------------------------------------------------------- minefields
// The first bug on a field's tile sets off the armed mine nearest to it, and that bug alone takes the blast. The field
// then needs def.rearm s before the next mine can go off, and once all are spent def.reload s to lay a new set (the
// clock over the tile: mines.js). Nothing attacks a field (see blocker); in its silo it is idle and safe.
function updateMines(s, dt) {
  if (s.landing && updateDrop(s, dt)) return;              // still coming down from orbit
  const d = s.def, ud = s.mesh.userData;
  if (s.reload > 0) {
    s.reload -= dt;
    ud.reload = Math.max(0.001, s.reload / d.reload);
    if (s.reload <= 0) { s.reload = 0; ud.reload = 0; ud.spent.fill(false); s.arm = 0; }
    return;
  }
  if (s.arm > 0) { s.arm -= dt; return; }
  const h = CELL / 2;
  let hit = null;
  eachEnemy(s.x, s.z, CELL * 0.75, (e) => {
    if (e.dead || e.held || e.emerge < 1 || Math.abs(e.x - s.x) > h || Math.abs(e.z - s.z) > h) return false;
    hit = e;
    return true;
  });
  if (!hit) return;
  let k = -1, best = Infinity;
  ud.mines.forEach((m, n) => {
    const dd = (s.x + m.position.x - hit.x) ** 2 + (s.z + m.position.z - hit.z) ** 2;
    if (!ud.spent[n] && dd < best) { best = dd; k = n; }
  });
  const m = ud.mines[k];
  ud.spent[k] = true;
  damageEnemy(hit, d.damage);
  explode(s.x + m.position.x, s.z + m.position.z, 0.8, 0, 0.8, { shake: 0.04, smoke: 5 });   // the look only: the damage is the bug's
  s.arm = d.rearm;
  if (ud.spent.every(Boolean)) { s.reload = d.reload; ud.reload = 1; }
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
  for (const im of Object.values(gibPools)) im.count = 0;
  for (let k = state.gibs.length - 1; k >= 0; k--) {
    const g = state.gibs[k];
    g.life -= dt;
    if (g.life <= 0) { state.gibs.splice(k, 1); continue; }
    g.vy -= 22 * dt;
    g.x += g.vx * dt;
    g.y += g.vy * dt;
    g.z += g.vz * dt;
    g.pool.setMatrixAt(g.pool.count++, _im.makeTranslation(g.x, g.y, g.z));
  }
  for (const im of Object.values(gibPools)) uploadUsed(im.instanceMatrix, im.count);
}

// ---------------------------------------------------------------- main tick
let spareEnemies = [];
export function update(dt) {
  state.time += dt;
  updateWave(dt);
  updateRelay();
  for (const s of state.structures) {
    if (retract.update(s, dt)) {                             // stowed, moving or locked down: the building is offline
      s.padDown = true;
      if (s.def?.kind === 'airship') updateAirship(s, dt);    // its ship is aloft and carries on without the pad
      else if (s.def?.kind === 'heli' && s.heli && s.mesh.userData.heli.parent !== s.mesh) updateHeli(s, dt);   // so is an evacuated gunship
      continue;
    }
    s.padDown = false;
    if (s.def?.kind) updateTower(s, dt);
    if (s.def?.mines) updateMines(s, dt);
    if (s.mesh.userData.guns) updateRecoil(s, dt);
    if (s.mesh.userData.pitch && !s.target) aimPitch(s, null, dt);
    if (s.elev && !s.target) { s.elev *= Math.exp(-3 * dt); const hd = s.mesh.userData.head; if (hd) hd.rotation.x = s.elev; }   // guns settle back level
    const producing = state.wave > 0 || state.demo;                // refineries idle until wave 1 is called
    if (s.def?.income && producing) state.credits += s.def.income * dt;
    const spin = s.mesh.userData.spin;
    if (spin) spin.rotation.y += dt * (s.type === 'refinery' ? (producing ? 6 : 0.8) : 1.2);   // the drill ticks over slowly till then
    s.mesh.userData.tick?.(dt, state.time);                  // idle animation (the uplink's dish and aviation lights)
  }
  retract.tick(dt);
  burrows.update(dt, state.time);
  updateProjectiles(dt);
  updateHeliRockets(dt);
  updateAirshipOrdnance(dt);
  updateApocalypseOrdnance(dt);
  acid.update(dt, damageStructure);
  boss.updateDying(dt);
  updateShells(dt);
  updateMissiles(dt);
  updateEnemies(dt);
  updateBurning(dt);
  updateEffects(dt);
  updateCasings(dt);
  updateDecals(state.scene, dt);
  if (state.deadCount) {
    // Survivors go into the spare array, then the two swap. Not compacted in place: the spatial index still points
    // into this frame's array (by position) until updateEnemies rebuilds it, and troopers and abilities query it later
    // this frame. The spare is only written again at the next compaction, after that rebuild.
    const out = spareEnemies;
    out.length = 0;
    for (const e of state.enemies) if (!e.dead) out.push(e);
    spareEnemies = state.enemies;
    state.enemies = out;
    state.deadCount = 0;
  }
  gore.update(dt);
  flame.update(dt, state.time);
  swarm.update(state.enemies, state.corpses, state.time, heightAt);
}
