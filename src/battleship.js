import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { state, damageEnemy, eachEnemy, burst, log, aimY, railStrike } from './game.js';
import { heightAt, worldToCell, cellKey, isScenery, canyonDist } from './terrain.js';
import { FLAT, MAP } from './config.js';
import { makeTracer, makeProjectile, makeMissile } from './entities.js';
import { explode, railBeam } from './effects.js';
import { puff } from './particles.js';
import { flashes } from './flashes.js';
import { audio } from './audio.js';
import { spawnScorch } from './decals.js';
import { bevelBox, worn } from './surface.js';
import { bakeStatic } from './bake.js';
import { makeHpBar, setHpBar } from './hpbars.js';
import { makeEscort, newEscort, updateEscort, loseEscort } from './heli.js';
import { makeSentry, updateSentry } from './troopers.js';

// Airdrop Land Battleship (support ability, unlocked by the Strategic Uplink Tower like the Strategic Nuclear Strike).
// A destroyer-hulled land battleship on tracks comes down from orbit in a drop harness whose four retro-thrusters brake
// it to a soft landing; the harness then lets go and boosts back up. On the ground it is a player unit like the shock
// troopers (drag a box over it or click it, then click to move) and the first thing every bug on the field goes for
// (game.js, boss.js). Driving forward, its ram bow kills whatever it runs into. Its weapons fight on their own, each
// within its own firing arc (none of them ever swings through the superstructure): a railgun main gun on the foredeck
// with the Railgun Battery's priorities (Colossus, then brutes and spitters), CIWS gatlings fore and aft, an eight-cell
// vertical launch missile battery (the missiles fly with the Missile Silo's, game.js) and four autocannon sponsons
// (their shells fly with the Autocannon's). A shock trooper posted on the helipad adds his machine gun. It keeps its own
// kill count.
export const SHIP = {
  kind: 'battleship', silo: false, hp: 15000, speed: 2.4, turn: 0.5, deploy: 120,   // deploy: s on station before it is lifted out
  wall: 0.3,                                                // canyon map: how far onto the foot of a wall (canyonDist) the hull may go
  rail: { range: 40, damage: 500, charge: 5, turn: 0.9 },
  ciws: { range: 14, damage: 5, rate: 25, turn: 5 },
  vls: { range: 30, damage: 40, splash: 2.5, cells: 8, interval: 7 },
  gun: { range: 13, damage: 25, rate: 2.2, turn: 3.2 },    // dual autocannons: a shell from each barrel per shot
  // the trooper on the helipad: its two aft corners (starboard first), each with its arc off that side and the stern
  sentry: { posts: [{ x: 1.3, z: -8.7, arc: 2.4 }, { x: -1.3, z: -8.7, arc: -2.4 }], half: 1.5, range: 16, damage: 3 },   // damage: per MG round (a field trooper's do 2.5)
};

// The hull's plan: half-beam along its length, stern to bow tip (it faces +z). The outline round it is the footprint
// everything else sees: bugs bite it, buildings, troopers and the drop zone keep clear of it.
const RIGHT = [[-9.2, 1.95], [-8.5, 2.1], [2.4, 2.1], [3.8, 1.95], [5.0, 1.6], [6.2, 0.95], [7.2, 0]];
const HULL = [...RIGHT.map(([z, w]) => [w, z]), ...RIGHT.slice(0, -1).reverse().map(([z, w]) => [-w, z])];
const EDGES = HULL.map(([ax, az], i) => {
  const [bx, bz] = HULL[(i + 1) % HULL.length], len = Math.hypot(bx - ax, bz - az);
  let nx = (bz - az) / len, nz = -(bx - ax) / len;
  if (nx * (ax + bx) + nz * (az + bz) < 0) { nx = -nx; nz = -nz; }   // outward, away from the middle
  return { ax, az, bx, bz, nx, nz, len, bow: nz > 0.25, stern: nz < -0.5 };
});
const HW = 2.1, BOW = 7.2, STERN = -9.2, DECK = 2.7, PAD_Z = -6.9, ESCORT_SCALE = 0.47;
const beamAt = (z) => {
  for (let i = 0; i < RIGHT.length - 1; i++) {
    const [z0, w0] = RIGHT[i], [z1, w1] = RIGHT[i + 1];
    if (z <= z1) return w0 + (w1 - w0) * clamp((z - z0) / (z1 - z0), 0, 1);
  }
  return 0;
};
const TX = 1.25, TW = 0.95, TZ = -1.7;                      // tracks: centre line, width, and how far aft their middle sits
const YC = 0.6, TR = 0.55, TA = 4.7;                        // track loop: wheel-line height, end radius, half-length of the runs
const PER = 4 * TA + 2 * Math.PI * TR, LINKS = 57;
const DROP = { start: 150, v0: 40, ignite: 58, land: 2.2 }; // falls at v0 until the retros light at `ignite` m, touches down at `land` m/s
const RIG = { start: 90, v0: 30, ignite: 40, land: 1.2 };   // the pickup rig coming down for it, the same way
const PODS = [[-2.6, 5.2], [2.6, 5.2], [-2.6, -8.6], [2.6, -8.6]];
const STACKS = [[0, 5.2, -1.6], [0, 5.2, -2.85]];
const _v = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

const mat = {
  skin: new THREE.MeshStandardMaterial({ color: 0x67707a, roughness: 0.6, metalness: 0.4, flatShading: true }),   // faceted stealth hull
  hull: new THREE.MeshStandardMaterial({ color: 0x5f6872, roughness: 0.6, metalness: 0.45 }),
  hullDark: new THREE.MeshStandardMaterial({ color: 0x3b424a, roughness: 0.65, metalness: 0.45 }),
  deck: new THREE.MeshStandardMaterial({ color: 0x30353b, roughness: 0.85, metalness: 0.25 }),
  paint: new THREE.MeshStandardMaterial({ color: 0xe8e4d8, roughness: 0.7 }),
  trim: new THREE.MeshStandardMaterial({ color: 0xd9a633, roughness: 0.4, metalness: 0.7 }),
  track: new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.65, metalness: 0.7 }),
  wheel: new THREE.MeshStandardMaterial({ color: 0x3d434b, roughness: 0.55, metalness: 0.6 }),
  metal: new THREE.MeshStandardMaterial({ color: 0x8d949c, roughness: 0.45, metalness: 0.8 }),
  gunmetal: new THREE.MeshStandardMaterial({ color: 0x2c2f36, roughness: 0.35, metalness: 0.85 }),
  black: new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.6, metalness: 0.5 }),
  white: new THREE.MeshStandardMaterial({ color: 0xdfe4e8, roughness: 0.45, metalness: 0.15 }),
  window: new THREE.MeshStandardMaterial({ color: 0x8fd8ff, emissive: 0x4fb8ff, emissiveIntensity: 1.5, roughness: 0.15, metalness: 0.3 }),
  panel: new THREE.MeshStandardMaterial({ color: 0x1c232b, roughness: 0.35, metalness: 0.6 }),
  lamp: new THREE.MeshStandardMaterial({ color: 0xfff2c8, emissive: 0xffe2a0, emissiveIntensity: 2.2 }),
  lens: new THREE.MeshStandardMaterial({ color: 0xff5030, emissive: 0xff3010, emissiveIntensity: 1.8 }),
  navRed: new THREE.MeshStandardMaterial({ color: 0xff2020, emissive: 0xff2020, emissiveIntensity: 3 }),
  navGreen: new THREE.MeshStandardMaterial({ color: 0x20ff40, emissive: 0x20ff40, emissiveIntensity: 3 }),
  caps: new THREE.MeshStandardMaterial({ color: 0x4fd1ff, emissive: 0x2aa8dd, emissiveIntensity: 0.3, roughness: 0.3 }),
  harness: new THREE.MeshStandardMaterial({ color: 0xc8782a, roughness: 0.55, metalness: 0.5 }),   // safety-orange drop rig
  nozzle: new THREE.MeshStandardMaterial({ color: 0x1d1f23, roughness: 0.5, metalness: 0.8, side: THREE.DoubleSide }),
  flame: new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
  core: new THREE.MeshBasicMaterial({ color: 0xfff0c8, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
  flash: new THREE.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  ring: new THREE.MeshBasicMaterial({ color: 0x5dff8a, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }),
  wreck: new THREE.MeshStandardMaterial({ color: 0x1b1918, roughness: 0.95, metalness: 0.2, flatShading: true }),
};
for (const k of ['skin', 'hull', 'hullDark', 'harness']) worn(mat[k], { grime: 0.28, chips: 0.4, scale: 0.8 });
for (const k of ['deck', 'wheel', 'gunmetal']) worn(mat[k], { grime: 0.2, chips: 0.15, rough: 0.35, scale: 0.8 });

const mk = (geo, m, x, y, z, parent) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; parent.add(o); return o; };
const rnd = (a, b) => a + Math.random() * (b - a);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

// A box from point a to point b (local coordinates), w wide and h tall: trim strips, ram edges.
function bar(a, b, w, h, m, parent) {
  const o = mk(bevelBox(w, h, a.distanceTo(b)), m, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2, parent);
  o.lookAt(_v.copy(b).applyMatrix4(parent.matrixWorld));
  return o;
}
// Stealth deckhouse: a rectangular frustum, w x d at the base, k of that at the top, with flat faceted walls.
const deckhouse = (w, d, h, k) => new THREE.CylinderGeometry(k, 1, h, 4, 1).rotateY(Math.PI / 4).scale(w / Math.SQRT2, 1, d / Math.SQRT2);

function flashMesh(size) {
  const f = new THREE.Group();
  for (const r of [0, Math.PI / 2]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat.flash); p.rotation.set(0, Math.PI / 2, 0); p.rotateX(r); f.add(p); }
  f.visible = false;
  return f;
}

function label(text) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = '#e8e2cf';
  g.font = 'bold 76px "Arial Narrow", Arial, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 256, 52);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
}
let hullLabel = null;

// ---------------------------------------------------------------- the hull's shape
// Cross-section at z: deck centre, deck edge, chine, bottom edge, keel (and the mirror). The sides lean in above the
// chine (tumblehome). Toward the bow the beam narrows to a point, the keel line dips toward the ground into a ram and the
// deck rakes down to meet it: a wave-piercing bow, its lowest point furthest forward.
function section(z) {
  const w = beamAt(z), u = clamp((z - 5.0) / 2.2, 0, 1), s = clamp((z - 6.0) / 1.2, 0, 1);
  const yb = 1.15 - 0.4 * u, yc = 1.7 - 0.5 * u, yd = DECK - (DECK - 1.55) * s, wd = Math.max(0, w - 0.28) * (1 - s);
  return [[0, yd], [wd, yd], [w, yc], [w * 0.72, yb], [0, yb], [-w * 0.72, yb], [-w, yc], [-wd, yd]];
}
const STATIONS = [STERN, -8.85, -8.5, -6.5, -5.0, -2.5, 0, 1.5, 2.4, 3.1, 3.8, 4.4, 5.0, 5.5, 6.0, 6.3, 6.6, 6.9, BOW];
function hullGeometry() {
  const pos = [], _n = new THREE.Vector3(), _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3();
  const tri = (a, b, c) => {
    _e1.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]); _e2.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    _n.crossVectors(_e1, _e2);
    if (_n.lengthSq() < 1e-10) return;                     // collapsed at the bow tip
    const mx = (a[0] + b[0] + c[0]) / 3, my = (a[1] + b[1] + c[1]) / 3, mz = (a[2] + b[2] + c[2]) / 3;
    if (_n.x * mx + _n.y * (my - 1.9) + _n.z * (mz - clamp(mz, -6, 6)) < 0) [b, c] = [c, b];   // face outward
    pos.push(...a, ...b, ...c);
  };
  for (let i = 0; i < STATIONS.length - 1; i++) {
    const za = STATIONS[i], zb = STATIONS[i + 1], A = section(za), B = section(zb);
    for (let k = 0; k < 8; k++) {
      const k2 = (k + 1) % 8;
      const a0 = [A[k][0], A[k][1], za], a1 = [A[k2][0], A[k2][1], za], b0 = [B[k][0], B[k][1], zb], b1 = [B[k2][0], B[k2][1], zb];
      tri(a0, a1, b1); tri(a0, b1, b0);
    }
  }
  const S = section(STERN), cy = (S[0][1] + S[4][1]) / 2;   // the transom
  for (let k = 0; k < 8; k++) tri([0, cy, STERN], [S[k][0], S[k][1], STERN], [S[(k + 1) % 8][0], S[(k + 1) % 8][1], STERN]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}
// The flat deck, from the stern to where the bow starts to rake down.
function deckGeometry() {
  const pts = STATIONS.filter((z) => z <= 6.0).map((z) => [Math.max(0, beamAt(z) - 0.3), z]);
  const shape = new THREE.Shape([...pts.map(([w, z]) => new THREE.Vector2(w, -z)), ...pts.slice().reverse().map(([w, z]) => new THREE.Vector2(-w, -z))]);
  return new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
}

// The footprint outline pushed out by dist (mitred at the corners), as [x, z] points.
const offsetHull = (dist) => HULL.map(([x, z], i) => {
  const e0 = EDGES[(i - 1 + HULL.length) % HULL.length], e1 = EDGES[i], k = dist / (1 + e0.nx * e1.nx + e0.nz * e1.nz);
  return [x + (e0.nx + e1.nx) * k, z + (e0.nz + e1.nz) * k];
});
// The selection outline: a band 0.53-0.75 m out round the hull, cut every ~0.6 m so it can be draped over the ground.
let ringGeo = null;
const selRingGeo = () => {
  if (ringGeo) return ringGeo;
  const outer = offsetHull(0.75), inner = offsetHull(0.53), n = HULL.length, pos = [], idx = [];
  for (let i = 0; i < n; i++) {
    const a0 = outer[i], a1 = outer[(i + 1) % n], b0 = inner[i], b1 = inner[(i + 1) % n];
    const steps = Math.max(1, Math.ceil(Math.hypot(a1[0] - a0[0], a1[1] - a0[1]) / 0.6));
    for (let k = 0; k < steps; k++) {
      const u = k / steps;
      pos.push(a0[0] + (a1[0] - a0[0]) * u, 0, a0[1] + (a1[1] - a0[1]) * u, b0[0] + (b1[0] - b0[0]) * u, 0, b0[1] + (b1[1] - b0[1]) * u);
    }
  }
  const m = pos.length / 6;
  for (let j = 0; j < m; j++) { const o = 2 * j, q = 2 * ((j + 1) % m); idx.push(o, o + 1, q, o + 1, q + 1, q); }
  ringGeo = new THREE.BufferGeometry();
  ringGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  ringGeo.setIndex(idx);
  return ringGeo;
};

// Retro-thruster flame: an outer cone and a hot core, apex down, base at the nozzle. scale.y is its length.
const flameGeo = new THREE.ConeGeometry(0.46, 1, 14, 1, true).rotateX(Math.PI).translate(0, -0.5, 0);
const coreGeo = new THREE.ConeGeometry(0.24, 1, 10, 1, true).rotateX(Math.PI).translate(0, -0.5, 0);

// The drop rig: two side beams and two arches over the deck that clamp to the hull, a retro-thruster pod at each corner.
// Built in the ship's own coordinates, so at the ship's origin it is latched on. One brings the ship down and boosts
// away; another comes back for it at the end of its time on station.
function makeHarness() {
  const harness = new THREE.Group();
  for (const sd of [-1, 1]) {
    mk(bevelBox(0.3, 0.3, 14.2), mat.harness, sd * 2.6, 3.0, -1.7, harness);
    mk(bevelBox(0.32, 0.06, 13.6), mat.trim, sd * 2.6, 3.18, -1.7, harness);
    for (const z of [3.0, -7.4]) {
      mk(bevelBox(0.26, 3.2, 0.26), mat.harness, sd * 2.6, 4.6, z, harness);
      mk(bevelBox(0.5, 0.2, 0.45), mat.black, sd * 2.3, 2.85, z, harness);                     // clamp arm and jaw on the hull side
      mk(bevelBox(0.16, 0.5, 0.4), mat.black, sd * 2.08, 2.55, z, harness);
    }
  }
  for (const z of [3.0, -7.4]) mk(bevelBox(5.5, 0.28, 0.32), mat.harness, 0, 6.2, z, harness);
  const flames = [];
  for (const [x, z] of PODS) {
    mk(new THREE.CylinderGeometry(0.48, 0.48, 1.5, 16), mat.harness, x, 3.35, z, harness);
    mk(new THREE.ConeGeometry(0.48, 0.5, 16), mat.black, x, 4.35, z, harness);
    mk(new THREE.CylinderGeometry(0.5, 0.5, 0.1, 16), mat.trim, x, 3.9, z, harness);
    mk(new THREE.CylinderGeometry(0.3, 0.3, 0.12, 12), mat.black, x, 2.62, z, harness);
    mk(new THREE.CylinderGeometry(0.3, 0.52, 0.55, 16, 1, true), mat.nozzle, x, 2.3, z, harness);
    const fl = new THREE.Group();
    fl.position.set(x, 2.04, z);
    fl.visible = false;
    harness.add(fl);
    const outer = new THREE.Mesh(flameGeo, mat.flame), inner = new THREE.Mesh(coreGeo, mat.core);
    outer.renderOrder = inner.renderOrder = 5;
    fl.add(outer, inner);
    flames.push(fl);
  }
  harness.userData.flames = flames;
  return bakeStatic(harness);
}

// ---------------------------------------------------------------- the model (faces +z, origin on the ground)
function makeShip() {
  hullLabel ??= label('LBB-01');
  const g = new THREE.Group();
  const body = new THREE.Group();                         // the hull and everything on it (dips as it touches down)
  g.add(body);
  g.updateMatrixWorld(true);

  // running gear under the hull: paired road wheels, a toothed drive sprocket aft and an idler forward. The track links
  // are one instanced mesh that moves with the hull's speed (setTracks).
  const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.34, 14).rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(0.13, 0.13, 0.38, 8).rotateZ(Math.PI / 2);
  const endGeo = new THREE.CylinderGeometry(0.47, 0.47, 0.42, 16).rotateZ(Math.PI / 2);
  for (const sd of [-1, 1]) {
    for (let k = 0; k < 7; k++) for (const o of [-0.22, 0.22]) {
      const z = TZ - 3.6 + k * 1.2;
      mk(wheelGeo, mat.wheel, sd * TX + o, YC - 0.14, z, body);
      mk(hubGeo, mat.metal, sd * TX + o, YC - 0.14, z, body);
    }
    for (const z of [TZ - TA, TZ + TA]) { mk(endGeo, mat.wheel, sd * TX, YC, z, body); mk(hubGeo, mat.metal, sd * TX, YC, z, body); }
    for (let k = 0; k < 10; k++) {                             // sprocket teeth
      const a = (k / 10) * Math.PI * 2;
      mk(bevelBox(0.42, 0.11, 0.13), mat.gunmetal, sd * TX, YC + Math.cos(a) * 0.49, TZ - TA + Math.sin(a) * 0.49, body).rotation.x = a;
    }
  }
  mk(bevelBox(1.4, 0.5, 9.4), mat.hullDark, 0, 0.95, TZ, body);   // belly between the tracks

  // hull: one lofted, faceted shell, the deck laid on top, a gold line round the deck edge, a ram along the bow's keel
  mk(hullGeometry(), mat.skin, 0, 0, 0, body);
  mk(deckGeometry(), mat.deck, 0, DECK + 0.012, 0, body);
  const edge = STATIONS.filter((z) => z <= 6.0).map((z) => new THREE.Vector3(Math.max(0, beamAt(z) - 0.29), DECK + 0.04, z));
  for (const sd of [-1, 1]) {
    for (let k = 0; k < edge.length - 1; k++) {
      const a = edge[k].clone(), b = edge[k + 1].clone();
      a.x *= sd; b.x *= sd;
      if (a.distanceTo(b) > 0.05) bar(a, b, 0.06, 0.06, mat.trim, body);
    }
    const keel = (z) => { const s = section(z); return new THREE.Vector3(sd * s[3][0], s[3][1] - 0.02, z); };
    for (const [z0, z1] of [[3.8, 5.0], [5.0, 6.2], [6.2, BOW - 0.05]]) bar(keel(z0), keel(z1), 0.16, 0.16, mat.gunmetal, body);   // ram edge
    const name = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.62), hullLabel);
    name.position.set(sd * 1.99, 2.2, -2.3); name.rotation.set(-0.27, sd * Math.PI / 2, 0, 'YXZ');
    body.add(name);
    mk(bevelBox(0.06, 0.32, 0.46), mat.black, sd * (beamAt(5.6) - 0.08), 2.05, 5.6, body).rotation.y = sd * 0.5;   // hawse pipe
    mk(bevelBox(0.26, 0.12, 0.08), mat.lamp, sd * 0.42, 1.15, 6.62, body).rotation.y = sd * 0.65;                  // headlights in the ram
    mk(new THREE.CylinderGeometry(0.08, 0.1, 0.2, 8), mat.black, sd * 1.55, DECK + 0.1, 4.0, body);   // bollards (the aft corners are the sentry's)
  }

  // main gun: a railgun turret like the Railgun Battery's, cut down to fit the foredeck
  const rm = new THREE.Group();
  rm.position.set(0, DECK, 4.55);
  rm.scale.setScalar(0.74);
  body.add(rm);
  mk(new THREE.CylinderGeometry(1.4, 1.5, 0.22, 24), mat.hullDark, 0, 0.11, 0, rm);
  mk(new THREE.TorusGeometry(1.36, 0.045, 6, 32).rotateX(Math.PI / 2), mat.trim, 0, 0.23, 0, rm);
  const railYaw = new THREE.Group();
  railYaw.position.set(0, 0.22, 0);
  rm.add(railYaw);
  mk(new THREE.CylinderGeometry(1.3, 1.36, 0.16, 22), mat.metal, 0, 0.08, 0, railYaw);
  mk(bevelBox(2.3, 0.85, 2.7), mat.hull, 0, 0.55, -0.35, railYaw);
  mk(bevelBox(0.9, 0.6, 0.35), mat.hullDark, 0, 0.55, 1.1, railYaw);
  for (const sd of [-1, 1]) {
    mk(bevelBox(0.5, 0.7, 0.6), mat.hull, sd * 0.85, 0.5, 1.05, railYaw);
    mk(bevelBox(0.1, 0.95, 2.8), mat.hullDark, sd * 1.2, 0.6, -0.35, railYaw).rotation.z = -sd * 0.18;
    for (let k = 0; k < 3; k++) mk(new THREE.CylinderGeometry(0.06, 0.06, 0.32, 8), mat.gunmetal, sd * 1.12, 0.95, 0.55 + k * 0.16, railYaw).rotation.set(0.5, 0, sd * 0.6);   // smoke dischargers
  }
  const caps = mat.caps.clone();                          // capacitor glow follows the charge (per ship)
  for (const sd of [-1, 1]) for (const z of [-1.25, -0.75, -0.25]) {
    mk(new THREE.CylinderGeometry(0.17, 0.17, 0.42, 12).rotateX(Math.PI / 2), caps, sd * 0.62, 1.1, z, railYaw);
    for (const dz of [-0.17, 0.17]) mk(new THREE.TorusGeometry(0.18, 0.03, 6, 14), mat.black, sd * 0.62, 1.1, z + dz, railYaw);
  }
  mk(bevelBox(0.62, 0.55, 0.9), mat.black, 0, 1.05, -1.45, railYaw);                            // breech and heat sinks
  for (let k = 0; k < 6; k++) mk(bevelBox(0.8, 0.5, 0.05), mat.gunmetal, 0, 1.0, -1.95 - k * 0.09, railYaw);
  mk(new THREE.CylinderGeometry(0.24, 0.27, 0.22, 12), mat.hullDark, 0.75, 1.08, 0.3, railYaw);   // sight cupola
  mk(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 10).rotateX(Math.PI / 2), mat.lens, 0.75, 1.1, 0.56, railYaw);
  const railPitch = new THREE.Group();
  railPitch.position.set(0, 0.8, 0.9);
  railYaw.add(railPitch);
  const railGun = new THREE.Group();                      // recoil sled
  railPitch.add(railGun);
  for (const sd of [-1, 1]) {
    mk(bevelBox(0.17, 0.28, 5.0), mat.gunmetal, sd * 0.26, 0, 2.5, railGun);
    mk(bevelBox(0.035, 0.11, 4.6), caps, sd * 0.16, 0, 2.6, railGun);
    mk(bevelBox(0.1, 0.16, 0.5), mat.black, sd * 0.26, 0, 5.15, railGun);
  }
  for (const z of [0.6, 1.7, 2.8, 3.9, 4.8]) for (const y of [-0.18, 0.18]) mk(bevelBox(0.85, 0.1, 0.16), mat.hullDark, 0, y, z, railGun);
  mk(bevelBox(0.2, 0.12, 4.0), mat.black, 0, -0.28, 2.1, railGun);
  const railMuzzle = new THREE.Object3D();
  railMuzzle.position.set(0, 0, 5.5);
  railGun.add(railMuzzle);
  const railFlash = flashMesh(2.2);
  railFlash.position.set(0, 0, 5.6);
  railGun.add(railFlash);

  // VLS: eight cells in two rows across the foredeck between the gun and the bridge, each under a hatch that swings up
  mk(bevelBox(2.5, 0.2, 1.35), mat.hullDark, 0, DECK + 0.08, 2.85, body);
  mk(bevelBox(2.56, 0.04, 1.41), mat.trim, 0, DECK + 0.02, 2.85, body);
  const hatches = [], cells = [];
  for (const z of [3.15, 2.55]) for (const x of [-0.84, -0.28, 0.28, 0.84]) {
    mk(bevelBox(0.44, 0.03, 0.44), mat.black, x, DECK + 0.19, z, body);
    const hinge = new THREE.Group();
    hinge.position.set(x, DECK + 0.2, z - 0.25);
    body.add(hinge);
    mk(bevelBox(0.48, 0.05, 0.5), mat.hull, 0, 0.025, 0.25, hinge);
    hatches.push(hinge);
    cells.push(new THREE.Vector3(x, DECK + 0.3, z));
  }

  // superstructure: a faceted bridge block and a smaller wheelhouse on it with lit glazing, an integrated pyramid mast
  // with its radar, then the aft deckhouse with two stealth stacks, and a helicopter pad on the stern
  mk(deckhouse(2.6, 3.4, 1.5, 0.82), mat.skin, 0, DECK + 0.75, 0.5, body);
  mk(deckhouse(2.0, 1.9, 1.0, 0.8), mat.skin, 0, DECK + 2.0, 0.25, body);
  mk(bevelBox(1.5, 0.2, 0.05), mat.window, 0, DECK + 2.15, 1.09, body).rotation.x = -0.19;
  for (const sd of [-1, 1]) {
    mk(bevelBox(0.05, 0.2, 1.2), mat.window, sd * 0.9, DECK + 2.15, 0.25, body).rotation.z = sd * 0.2;
    mk(new THREE.CylinderGeometry(0.42, 0.42, 0.04, 8).rotateZ(Math.PI / 2), mat.panel, sd * 1.17, DECK + 1.0, 1.1, body).rotation.z = sd * 0.15;   // radar arrays
    mk(new THREE.SphereGeometry(0.06, 6, 5), sd > 0 ? mat.navRed : mat.navGreen, sd * 1.0, DECK + 2.55, 0.9, body);
  }
  mk(new THREE.CylinderGeometry(0.42, 0.42, 0.04, 8).rotateX(Math.PI / 2), mat.panel, 0, DECK + 1.6, 1.24, body).rotation.x = -0.24;
  mk(deckhouse(1.1, 1.1, 1.8, 0.28), mat.skin, 0, DECK + 3.4, 0.15, body);
  mk(new THREE.CylinderGeometry(0.04, 0.06, 1.6, 6), mat.metal, 0, DECK + 5.1, 0.15, body);
  mk(bevelBox(1.6, 0.05, 0.05), mat.metal, 0, DECK + 4.6, 0.15, body);
  mk(bevelBox(1.0, 0.05, 0.05), mat.metal, 0, DECK + 5.15, 0.15, body);
  for (const sd of [-1, 1]) mk(new THREE.CylinderGeometry(0.01, 0.015, 0.8, 5), mat.black, sd * 0.78, DECK + 4.95, 0.15, body);
  mk(new THREE.SphereGeometry(0.07, 8, 6), mat.navRed, 0, DECK + 5.95, 0.15, body);
  const radar = new THREE.Group();
  radar.position.set(0, DECK + 5.55, 0.15);
  body.add(radar);
  mk(bevelBox(1.2, 0.2, 0.1), mat.hullDark, 0, 0, 0, radar);
  mk(bevelBox(1.1, 0.12, 0.03), mat.white, 0, 0, 0.06, radar);
  mk(bevelBox(0.95, 0.12, 0.95), mat.hull, 0, DECK + 1.5, 1.85, body);                         // fore CIWS platform
  mk(deckhouse(2.8, 3.6, 1.3, 0.82), mat.skin, 0, DECK + 0.65, -2.8, body);
  for (const [, , z] of STACKS) {
    mk(deckhouse(0.9, 1.3, 1.1, 0.75), mat.skin, 0, DECK + 1.85, z, body);
    mk(bevelBox(0.62, 0.06, 0.94), mat.black, 0, DECK + 2.42, z, body);
  }
  mk(new THREE.TorusGeometry(1.3, 0.05, 6, 40).rotateX(Math.PI / 2), mat.paint, 0, DECK + 0.03, PAD_Z, body);   // helipad
  for (const x of [-0.36, 0.36]) mk(bevelBox(0.12, 0.02, 1.0), mat.paint, x, DECK + 0.03, PAD_Z, body);
  mk(bevelBox(0.72, 0.02, 0.12), mat.paint, 0, DECK + 0.03, PAD_Z, body);
  // landing lights at the pad's corners (the aft pair outboard of the sentry's posts and his run across the stern)
  for (const [x, z] of [[-1.5, -4.9], [1.5, -4.9], [-1.6, -8.4], [1.6, -8.4]]) mk(new THREE.SphereGeometry(0.05, 6, 5), mat.navGreen, x, DECK + 0.05, z, body);
  const pad = new THREE.Object3D();                       // where the escort gunship parks (it is added after the bake)
  pad.position.set(0, DECK + 0.02, PAD_Z);
  body.add(pad);

  // CIWS fore (over the foredeck) and aft (behind the stacks): a white radome over a six-barrel gatling that spins up
  const ciws = [[DECK + 1.56, 1.85, 0], [DECK + 1.3, -3.85, Math.PI]].map(([y, z, rest]) => {
    const yaw = new THREE.Group();
    yaw.position.set(0, y, z);
    yaw.rotation.y = rest;
    body.add(yaw);
    mk(new THREE.CylinderGeometry(0.3, 0.36, 0.22, 14), mat.gunmetal, 0, 0.11, 0, yaw);
    for (const o of [-1, 1]) mk(bevelBox(0.08, 0.5, 0.28), mat.gunmetal, o * 0.33, 0.45, 0, yaw);
    const pitch = new THREE.Group();
    pitch.position.y = 0.55;
    yaw.add(pitch);
    mk(new THREE.CylinderGeometry(0.3, 0.3, 0.6, 16), mat.white, 0, 0.38, -0.12, pitch);
    mk(new THREE.SphereGeometry(0.3, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat.white, 0, 0.68, -0.12, pitch);
    mk(bevelBox(0.3, 0.3, 0.5), mat.gunmetal, 0, 0, 0.05, pitch);
    mk(new THREE.CylinderGeometry(0.17, 0.17, 0.32, 12).rotateZ(Math.PI / 2), mat.gunmetal, 0.3, -0.04, -0.15, pitch);
    const spin = new THREE.Group();
    spin.position.set(0, -0.02, 0.3);
    pitch.add(spin);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      mk(new THREE.CylinderGeometry(0.022, 0.022, 0.9, 6).rotateX(Math.PI / 2), mat.gunmetal, Math.cos(a) * 0.065, Math.sin(a) * 0.065, 0.45, spin);
    }
    for (const bz of [0.2, 0.78]) mk(new THREE.CylinderGeometry(0.11, 0.11, 0.06, 10).rotateX(Math.PI / 2), mat.black, 0, 0, bz, spin);
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, -0.02, 1.25);
    pitch.add(muzzle);
    const flash = flashMesh(0.6);
    flash.position.copy(muzzle.position);
    pitch.add(flash);
    return { yaw, pitch, spin, muzzle, flash, rest };
  });

  // dual autocannons: four twin-barrelled turrets on sponsons off the deck edge, beside the bridge and the aft deckhouse
  const guns = [[-1, 2.0], [1, 2.0], [-1, -4.25], [1, -4.25]].map(([sd, z]) => {
    mk(bevelBox(0.85, 0.3, 0.85), mat.hull, sd * 1.85, DECK - 0.12, z, body);
    mk(new THREE.CylinderGeometry(0.4, 0.44, 0.12, 16), mat.hullDark, sd * 1.82, DECK + 0.06, z, body);
    const yaw = new THREE.Group();
    yaw.position.set(sd * 1.82, DECK + 0.12, z);
    yaw.rotation.y = z > 0 ? 0 : Math.PI;                  // stowed fore and aft for the drop, clear of the harness
    body.add(yaw);
    mk(bevelBox(0.78, 0.38, 0.8), mat.hull, 0, 0.21, -0.06, yaw);
    mk(bevelBox(0.56, 0.12, 0.3), mat.hullDark, 0, 0.27, 0.36, yaw);                            // mantlet
    mk(bevelBox(0.46, 0.05, 0.42), mat.hullDark, 0, 0.42, -0.15, yaw);
    mk(bevelBox(0.14, 0.12, 0.17), mat.black, 0.27, 0.46, 0.12, yaw);
    for (const o of [-1, 1]) mk(bevelBox(0.05, 0.22, 0.5), mat.hullDark, o * 0.41, 0.2, -0.05, yaw);   // cheek plates
    const barrels = [-0.13, 0.13].map((x) => {
      const gun = new THREE.Group();                       // each barrel recoils on its own sled
      gun.position.set(x, 0.24, 0.36);
      yaw.add(gun);
      mk(new THREE.CylinderGeometry(0.042, 0.05, 0.85, 8).rotateX(Math.PI / 2), mat.gunmetal, 0, 0, 0.42, gun);
      mk(bevelBox(0.1, 0.1, 0.15), mat.black, 0, 0, 0.85, gun);
      const muzzle = new THREE.Object3D();
      muzzle.position.z = 0.95;
      gun.add(muzzle);
      const flash = flashMesh(0.45);
      flash.position.z = 1.02;
      gun.add(flash);
      return { gun, muzzle, flash };
    });
    return { yaw, barrels, side: sd, rest: sd * Math.PI / 2, start: yaw.rotation.y };
  });

  // track links: one instanced plate (shoe, grouser and guide horn) per link, both tracks
  const linkGeo = mergeGeometries([
    new THREE.BoxGeometry(TW, 0.1, 0.33),
    new THREE.BoxGeometry(TW * 0.92, 0.06, 0.08).translate(0, 0.075, 0),
    new THREE.BoxGeometry(0.16, 0.09, 0.2).translate(0, -0.09, 0),
  ]);
  const links = new THREE.InstancedMesh(linkGeo, mat.track, LINKS * 2);
  links.castShadow = links.receiveShadow = true;
  links.frustumCulled = false;
  body.add(links);

  // the selection outline: its own copy, draped over the ground round the hull (drapeRing). It lives in the scene, not on
  // the hull, so the hull's pitch and roll never tip it into the ground.
  const ring = new THREE.Mesh(selRingGeo().clone(), mat.ring);
  ring.userData.flat = ring.geometry.attributes.position.array.slice();
  ring.renderOrder = 3;
  ring.visible = false;
  const hp = makeHpBar(5);
  hp.position.y = 9.4;
  hp.visible = false;
  g.add(hp);

  Object.assign(g.userData, {
    body, links, caps, radar, ring, bar: hp, hatches, cells, ciws, guns, pad,
    rail: { yaw: railYaw, pitch: railPitch, gun: railGun, muzzle: railMuzzle, flash: railFlash },
  });
  bakeStatic(g);                                          // fixed parts merged per material, per moving frame
  const heli = makeEscort(ESCORT_SCALE);                  // the escort gunship (heli.js), parked on the helipad
  pad.add(heli);
  const harness = makeHarness();                          // the drop rig it comes down in
  g.add(harness);
  Object.assign(g.userData, { heli, harness, flames: harness.userData.flames });
  return g;
}

// Where link s (0..PER along the loop) sits: z, y and its tilt about the axle. The bottom run goes front to back, so a
// growing offset carries the links rearward under the hull as it drives forward.
const _pose = { z: 0, y: 0, a: 0 };
function trackPose(s) {
  if (s < 2 * TA) { _pose.z = TA - s; _pose.y = YC - TR; _pose.a = Math.PI; return _pose; }
  s -= 2 * TA;
  if (s < Math.PI * TR) { const b = s / TR; _pose.z = -TA - TR * Math.sin(b); _pose.y = YC - TR * Math.cos(b); _pose.a = Math.atan2(-Math.sin(b), -Math.cos(b)); return _pose; }
  s -= Math.PI * TR;
  if (s < 2 * TA) { _pose.z = -TA + s; _pose.y = YC + TR; _pose.a = 0; return _pose; }
  const b = (s - 2 * TA) / TR;
  _pose.z = TA + TR * Math.sin(b); _pose.y = YC + TR * Math.cos(b); _pose.a = b;
  return _pose;
}
const _m4 = new THREE.Matrix4(), _q4 = new THREE.Quaternion(), _p4 = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1), _ax = new THREE.Vector3(1, 0, 0);
function setTracks(s) {
  const im = s.mesh.userData.links;
  for (let k = 0; k < 2; k++) {
    const x = k ? TX : -TX;
    for (let i = 0; i < LINKS; i++) {
      const p = trackPose(((((i * PER) / LINKS + s.track[k]) % PER) + PER) % PER);
      im.setMatrixAt(k * LINKS + i, _m4.compose(_p4.set(x, p.y, TZ + p.z), _q4.setFromAxisAngle(_ax, p.a), _one));
    }
  }
  im.instanceMatrix.needsUpdate = true;
}

// The selection outline follows the ground round the hull instead of cutting through the bumps.
function drapeRing(s) {
  const ring = s.mesh.userData.ring, pos = ring.geometry.attributes.position, flat = ring.userData.flat;
  const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
  ring.position.set(s.x, 0, s.z);
  ring.rotation.y = s.yaw;
  for (let i = 0; i < pos.count; i++) {
    const lx = flat[i * 3], lz = flat[i * 3 + 2];
    pos.setY(i, clamp(heightAt(s.x + lx * c + lz * sn, s.z - lx * sn + lz * c), s.y - 1.5, s.y + 1.5) + 0.15);   // never up a wall
  }
  pos.needsUpdate = true;
  s.ringAt = `${s.x}|${s.z}|${s.yaw}`;
}

// ---------------------------------------------------------------- footprint
// Local point (lx, lz) against the outline: d is its signed distance (negative inside), (cx, cz) the nearest point of
// the outline, (nx, nz) the way out, and bow / stern whether that bit of outline is the ram bow or the transom.
const _hq = { d: 0, cx: 0, cz: 0, nx: 0, nz: 0, bow: false, stern: false };
function hullQuery(lx, lz) {
  let maxD = -Infinity, mi = 0;
  for (let i = 0; i < EDGES.length; i++) {
    const e = EDGES[i], d = (lx - e.ax) * e.nx + (lz - e.az) * e.nz;
    if (d > maxD) { maxD = d; mi = i; }
  }
  if (maxD <= 0) {                                         // inside (it is convex): out through the nearest side
    const e = EDGES[mi];
    Object.assign(_hq, { d: maxD, cx: lx - maxD * e.nx, cz: lz - maxD * e.nz, nx: e.nx, nz: e.nz, bow: e.bow, stern: e.stern });
    return _hq;
  }
  let best = Infinity;
  for (const e of EDGES) {
    const ex = e.bx - e.ax, ez = e.bz - e.az, t = clamp(((lx - e.ax) * ex + (lz - e.az) * ez) / (e.len * e.len), 0, 1);
    const px = e.ax + ex * t, pz = e.az + ez * t, d2 = (lx - px) ** 2 + (lz - pz) ** 2;
    if (d2 < best) { best = d2; _hq.cx = px; _hq.cz = pz; _hq.bow = e.bow; _hq.stern = e.stern; }
  }
  const d = Math.sqrt(best) || 1e-6;
  _hq.d = d; _hq.nx = (lx - _hq.cx) / d; _hq.nz = (lz - _hq.cz) / d;
  return _hq;
}
// Distance from (x, z) to the hull's footprint (0 inside it). out, if given, gets the nearest point of its outline.
export function hullGap(s, x, z, out) {
  const c = Math.cos(s.yaw), sn = Math.sin(s.yaw), dx = x - s.x, dz = z - s.z;
  const q = hullQuery(dx * c - dz * sn, dx * sn + dz * c);
  if (out) { out.x = s.x + q.cx * c + q.cz * sn; out.z = s.z - q.cx * sn + q.cz * c; }
  return Math.max(0, q.d);
}
// The battleship every bug goes for: the nearest one that has landed.
export function nearestShip(x, z) {
  let best = null, bd = Infinity;
  for (const s of state.ships) {
    if (!s.live) continue;
    const d = (s.x - x) ** 2 + (s.z - z) ** 2;
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}
// Is (x, z) on (or within pad of) a battleship's hull? Troopers walk round it (troopers.js).
export const shipAt = (x, z, pad = 0.3) => state.ships.some((s) => s.alt < 3 && hullGap(s, x, z) < pad);

export function hurtShip(s, dmg) {
  if (s.hp <= 0) return;
  s.hp -= dmg;
  s.mesh.userData.bar.visible = true;
  setHpBar(s.mesh.userData.bar, s.hp / s.maxHp);
}

// Can the hull stand at (x, z) facing yaw? Clear of buildings (not closed blast doors or minefields), scenery, the
// basin's edge and other battleships. Tested on a grid of points over the footprint.
const SAMPLES = [];
for (let x = -1.9; x <= 1.95; x += 0.95) for (let z = STERN + 0.2; z <= BOW; z += 0.95) if (hullQuery(x, z).d < -0.15) SAMPLES.push([x, z]);
// ...and the outline itself, every metre or so along it, pulled in a touch: the bow tip and the long sides must not
// poke into a canyon wall between the grid points.
const RIM = [];
HULL.forEach(([x, z], i) => {
  const [bx, bz] = HULL[(i + 1) % HULL.length], n = Math.max(1, Math.ceil(Math.hypot(bx - x, bz - z)));
  for (let k = 0; k < n; k++) { const u = k / n; RIM.push([(x + (bx - x) * u) * 0.97, (z + (bz - z) * u) * 0.97]); }
});
// Canyon map: the floor ends where the walls start to rise (canyonDist 0); stay as far off them as the bugs do.
const offFloor = (x, z) => MAP === 'canyon' && canyonDist(x, z) > SHIP.wall;
// Where the hull may go at all. The plains: the basin, short of the mountains. The canyon: its floor (the walls are
// offFloor's business), out through the mouth into the open ground beyond as far as the bugs walk in from (game.js),
// but never into the mountains behind the base. pad: stay that far inside.
const BOUNDS = MAP === 'canyon' ? { x0: -(FLAT + 48), x1: FLAT + 48, z0: -(FLAT + 48), z1: FLAT - 1 } : { x0: -(FLAT - 1), x1: FLAT - 1, z0: -(FLAT - 1), z1: FLAT - 1 };
const outside = (x, z, pad = 0) => x < BOUNDS.x0 + pad || x > BOUNDS.x1 - pad || z < BOUNDS.z0 + pad || z > BOUNDS.z1 - pad;
const scenery = (x, z) => MAP !== 'canyon' && isScenery(x, z);   // on the plains only: the canyon's rock is its walls
function fits(x, z, yaw, self, why = null) {
  const c = Math.cos(yaw), sn = Math.sin(yaw);
  const no = (reason) => { if (why) why.reason = reason; return false; };
  for (const [lx, lz] of SAMPLES) {
    const wx = x + lx * c + lz * sn, wz = z - lx * sn + lz * c;
    if (outside(wx, wz)) return no('edge of the map');
    if (scenery(wx, wz)) return no('scenery');
    if (offFloor(wx, wz)) return no('canyon wall');
    const cell = worldToCell(wx, wz), st = state.occ.get(cellKey(cell.i, cell.j));
    if (st && !st.buried && !st.def?.walkable) return no(`building (${st.type})`);
    for (const o of state.ships) if (o !== self && o.alt < 3 && hullGap(o, wx, wz) < 0.2) return no('another battleship');
  }
  for (const [lx, lz] of RIM) if (offFloor(x + lx * c + lz * sn, z - lx * sn + lz * c)) return no('canyon wall (outline)');
  return true;
}
// It lands facing away from the Core, out toward the bugs.
const landingYaw = (x, z) => (x * x + z * z < 1 ? 0 : Math.atan2(x, z));

// ---------------------------------------------------------------- the drop
let scene = null;
const rigs = [], wrecks = [];                              // harnesses flying back up; destroyed ships burning out

function drop(x, z, credit = null) {
  const yaw = landingYaw(x, z);
  if (!fits(x, z, yaw, null)) return null;
  const mesh = makeShip();
  mesh.rotation.y = yaw;
  scene.add(mesh, mesh.userData.ring);
  const ud = mesh.userData;
  const s = {
    ship: true, type: 'battleship', name: 'Land Battleship', def: SHIP,
    x, z, y: heightAt(x, z), yaw, hp: SHIP.hp, maxHp: SHIP.hp, kills: 0, mesh,
    phase: 'drop', t: 0, alt: DROP.start, vel: DROP.v0, decel: 0, braking: false, live: false, bob: 0,
    v: 0, w: 0, moveTo: null, route: [], stuckT: 0, orderT: 0, steerT: 0, steer: null, shuffle: null, selected: false, track: [0, 0], smokeT: 0, stackT: 0,
    // mounts: yaw relative to the hull, and the arc each may traverse (centre, half-width), clear of the superstructure
    rail: { yaw: 0, arc: 0, half: 2.35, pitch: 0, charge: 0, target: null, scan: 0, recoil: 1 },
    ciws: ud.ciws.map((m) => ({ yaw: m.rest, arc: m.rest, half: 1.9, pitch: 0, target: null, scan: 0, cd: 0, spin: 0, flash: 0 })),
    guns: ud.guns.map((m) => ({ yaw: m.start, arc: m.rest, half: 1.75, side: m.side, target: null, scan: 0, cd: rnd(0, 0.5), recoil: 1 })),
    vls: { cd: 2, salvo: null, open: 0 },
    snd: null, thrust: null,
    escort: { heli: ud.heli, pad: ud.pad, h: newEscort() }, credit,
    sentry: makeSentry(ud.body, DECK, SHIP.sentry.posts),
  };
  // a moving target: acid globs (acid.js) land on the side of the hull facing the spitter
  s.aimPoint = (fx, fz) => { const p = { x: 0, y: s.y + rnd(1.6, 2.5), z: 0 }; hullGap(s, fx, fz, p); return p; };
  pose(s, 0);                                             // the height it will touch down at (the drop starts that far above it)
  mesh.position.y = s.y + DROP.start;
  setTracks(s);
  state.ships.push(s);
  audio.play('jet_flyby', { x, z, vol: 0.8 });
  log('Land battleship inbound: dropping from orbit!');
  return { update: () => false };                         // the ship is driven from battleships.update
}

function updateDrop(s, dt) {
  const ud = s.mesh.userData;
  if (!s.braking && s.alt <= DROP.ignite) {                // the retros light: constant braking down to a soft touchdown
    s.braking = true;
    s.decel = (s.vel ** 2 - DROP.land ** 2) / (2 * s.alt);
    audio.play('rocket_launch', { x: s.x, z: s.z, vol: 1 });
    s.thrust = audio.loop('hub_thruster', { x: s.x, z: s.z, vol: 1.2 });
    for (const [px, pz] of PODS) { _v.set(px, 2.0, pz); s.mesh.localToWorld(_v); flashes.add(_v.x, _v.y, _v.z, { color: 0xffa040, power: 30, range: 14, life: 0.5 }); }
  }
  if (s.braking) s.vel = Math.max(DROP.land, s.vel - s.decel * dt);
  s.alt = Math.max(0, s.alt - s.vel * dt);
  s.mesh.position.set(s.x, s.y + s.alt, s.z);
  s.mesh.rotation.set(0, s.yaw, s.braking ? Math.sin(s.t * 2.7) * 0.012 * Math.min(1, s.alt / 20) : 0, 'YXZ');
  s.thrust?.setPos(s.x, s.z);
  for (const fl of ud.flames) {
    fl.visible = s.braking;
    if (fl.visible) fl.scale.set(1 + rnd(-0.06, 0.06), 4.2 + rnd(-0.4, 0.6), 1 + rnd(-0.06, 0.06));
  }
  if (!s.braking) {                                       // falling: a smoke column left standing in the sky above it
    for (let k = 0; k < 2; k++) puff(s.x + rnd(-2, 2), s.y + s.alt + rnd(1, 6), s.z + rnd(-6, 6), { color: 0x6d6862, size: rnd(1.8, 3), grow: 2.2, life: rnd(1.6, 2.6), opacity: 0.45, drag: 1 });
  } else {
    for (const [px, pz] of PODS) {
      _v.set(px, 1.6, pz); s.mesh.localToWorld(_v);
      puff(_v.x, _v.y - rnd(0, 2), _v.z, { color: 0xffb060, size: rnd(0.8, 1.3), life: 0.18, opacity: 0.8, additive: true, vy: -12 });
      if (Math.random() < 0.6) puff(_v.x, _v.y - 3, _v.z, { color: 0x8a8580, size: 1.4, grow: 2.5, life: 1.4, opacity: 0.35, vy: -3, drag: 1.4 });
    }
    if (s.alt < 18) {                                     // the exhaust hits the ground: a dust storm spreads out from under it
      const k = 1 - s.alt / 18;
      for (let n = 0; n < 1 + k * 3; n++) {
        const a = rnd(0, Math.PI * 2), r = rnd(4, 7.5);
        puff(s.x + Math.cos(a) * r, s.y + 0.4, s.z + Math.sin(a) * r, { color: 0xb59468, size: rnd(1.6, 3), grow: 2.6, life: rnd(1, 1.8), opacity: 0.5 * k, vx: Math.cos(a) * rnd(6, 11), vz: Math.sin(a) * rnd(6, 11), vy: rnd(0.5, 2), drag: 2 });
      }
    }
  }
  if (s.alt <= 0) land(s);
}

function land(s) {
  s.phase = 'landed';
  s.t = 0;
  s.live = true;
  s.bob = 1;
  audio.play('hub_land', { x: s.x, z: s.z, vol: 1 });
  audio.play('explosion', { x: s.x, z: s.z, size: 2, vol: 0.6 });
  state.shake += 0.7;
  for (let n = 0; n < 34; n++) {
    const a = rnd(0, Math.PI * 2), r = rnd(5, 7.5);
    puff(s.x + Math.cos(a) * r, s.y + 0.4, s.z + Math.sin(a) * r, { color: 0xb59468, size: rnd(2, 3.4), grow: 2.8, life: rnd(1.3, 2.2), opacity: 0.55, vx: Math.cos(a) * rnd(5, 12), vz: Math.sin(a) * rnd(5, 12), vy: rnd(0.5, 2.5), drag: 2, priority: true });
  }
  for (const [px, pz] of PODS) { _v.set(px, 0, pz); s.mesh.localToWorld(_v); spawnScorch(scene, _v.x, _v.z, 2.4); }
  // whatever was underneath is crushed; a Colossus standing over the spot just takes a heavy blow
  eachEnemy(s.x, s.z, BOW + 1, (e) => {
    if (hullGap(s, e.x, e.z) > 0.3 * e.def.scale) return;
    damageEnemy(e, e.boss ? 1500 : 1e9, s);
  });
  s.snd = audio.loop('tank_engine', { x: s.x, z: s.z, vol: 0.8 });
  log('Land battleship down. Drag a box over it or click it to select it, then click to move.');
}

// The harness lets go and boosts back to orbit on its retros.
function release(s) {
  const h = s.mesh.userData.harness;
  scene.attach(h);
  rigs.push({ h, flames: s.mesh.userData.flames, vy: 0, t: 0, snd: s.thrust, drift: rnd(-0.15, 0.15) });
  s.thrust = null;
  audio.play('rocket_launch', { x: s.x, z: s.z, vol: 0.9 });
  for (const [px, pz] of PODS) { _v.set(px, 2.7, pz); s.mesh.localToWorld(_v); puff(_v.x, _v.y, _v.z, { color: 0xd8d0c8, size: 1.2, grow: 2, life: 0.8, opacity: 0.6, vy: 1.5 }); }
}
function updateRigs(dt) {
  for (let k = rigs.length - 1; k >= 0; k--) {
    const r = rigs[k];
    r.t += dt;
    r.vy += 16 * dt;
    r.h.position.y += r.vy * dt;
    r.h.rotation.z += r.drift * dt;
    r.snd?.setPos(r.h.position.x, r.h.position.z);
    for (const fl of r.flames) { fl.visible = true; fl.scale.set(1, 5 + rnd(-0.5, 0.8), 1); }
    if (Math.random() < dt * 30) for (const fl of r.flames) { fl.getWorldPosition(_v); puff(_v.x, _v.y - 1.5, _v.z, { color: 0x8a8580, size: 1.3, grow: 2.2, life: 1.2, opacity: 0.35, drag: 1.2 }); }
    if (r.t > 6) {
      r.snd?.stop();
      scene.remove(r.h);
      r.h.traverse((o) => { if (o.isMesh && o.name === 'baked') o.geometry.dispose(); });
      rigs.splice(k, 1);
    }
  }
}

// ---------------------------------------------------------------- driving
// ---------------------------------------------------------------- route planning
// An order is planned on a 2 m grid over the basin: A* through the points where the hull's beam fits (clear of canyon
// walls, scenery, the basin's edge and buildings by its half-width and a margin), cut down to its corners by line of
// sight. The ship drives the route corner to corner; the steering below copes with whatever the grid cannot see.
const SPAN = Math.max(-BOUNDS.x0, BOUNDS.x1, -BOUNDS.z0, BOUNDS.z1);   // a square grid over everywhere it may go
const NODE = 2, ORIGIN = -SPAN, NN = Math.floor(2 * SPAN / NODE) + 1, CLEARANCE = HW + 1.0;
const nodeAt = (k) => ORIGIN + k * NODE;
const nodeOf = (v) => clamp(Math.round((v - ORIGIN) / NODE), 0, NN - 1);
let terrainOpen = null;                                     // where the terrain lets a hull through (built once)
function openGrid() {
  if (terrainOpen) return terrainOpen;
  terrainOpen = new Uint8Array(NN * NN);
  for (let j = 0; j < NN; j++) for (let i = 0; i < NN; i++) {
    const x = nodeAt(i), z = nodeAt(j);
    let ok = !outside(x, z, CLEARANCE) && !scenery(x, z) && !offFloor(x, z);
    for (let a = 0; ok && a < 8; a++) {
      const px = x + Math.cos(a * Math.PI / 4) * CLEARANCE, pz = z + Math.sin(a * Math.PI / 4) * CLEARANCE;
      if (scenery(px, pz) || offFloor(px, pz)) ok = false;
    }
    terrainOpen[j * NN + i] = ok ? 1 : 0;
  }
  return terrainOpen;
}
function nearBuilding(x, z) {                               // a standing building within the clearance of (x, z)
  for (const dx of [-CLEARANCE, 0, CLEARANCE]) for (const dz of [-CLEARANCE, 0, CLEARANCE]) {
    const cell = worldToCell(x + dx, z + dz), st = state.occ.get(cellKey(cell.i, cell.j));
    if (st && !st.buried && !st.def?.walkable) return true;
  }
  return false;
}
function plan(s, gx, gz) {
  const open = openGrid(), cache = new Int8Array(NN * NN);
  const pass = (i, j) => {
    if (i < 0 || j < 0 || i >= NN || j >= NN) return false;
    const k = j * NN + i;
    if (!cache[k]) cache[k] = open[k] && !nearBuilding(nodeAt(i), nodeAt(j)) ? 1 : -1;
    return cache[k] > 0;
  };
  const nearestOpen = (x, z) => {                           // the passable node nearest a point, searching outward
    const ci = nodeOf(x), cj = nodeOf(z);
    for (let r = 0; r < 8; r++) {
      let best = null, bd = Infinity;
      for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
        if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r || !pass(i, j)) continue;
        const d = (nodeAt(i) - x) ** 2 + (nodeAt(j) - z) ** 2;
        if (d < bd) { bd = d; best = [i, j]; }
      }
      if (best) return best;
    }
    return null;
  };
  const a = nearestOpen(s.x, s.z), b = nearestOpen(gx, gz);
  if (!a || !b) return null;
  // A* (8 neighbours, octile distance) with a binary heap
  const N = NN * NN, gs = new Float32Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), done = new Uint8Array(N);
  const goal = b[1] * NN + b[0], hOf = (k) => { const dx = Math.abs(k % NN - b[0]), dz = Math.abs(((k / NN) | 0) - b[1]); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
  const heap = [], push = (k, f) => { heap.push([f, k]); let n = heap.length - 1; while (n > 0) { const p2 = (n - 1) >> 1; if (heap[p2][0] <= heap[n][0]) break; [heap[p2], heap[n]] = [heap[n], heap[p2]]; n = p2; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let n = 0; for (;;) { const l = 2 * n + 1, r = l + 1; let m = n; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === n) break; [heap[m], heap[n]] = [heap[n], heap[m]]; n = m; } } return top[1]; };
  const s0 = a[1] * NN + a[0];
  gs[s0] = 0; push(s0, hOf(s0));
  while (heap.length) {
    const k = pop();
    if (done[k]) continue;
    done[k] = 1;
    if (k === goal) break;
    const i = k % NN, j = (k / NN) | 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ni = i + di, nj = j + dj;
      if (!pass(ni, nj) || (di && dj && (!pass(i + di, j) || !pass(i, j + dj)))) continue;   // no corner cutting
      const nk = nj * NN + ni, g = gs[k] + (di && dj ? 1.414 : 1);
      if (g < gs[nk]) { gs[nk] = g; from[nk] = k; push(nk, g + hOf(nk)); }
    }
  }
  if (!done[goal]) return null;
  const nodes = [];
  for (let k = goal; k !== -1; k = from[k]) nodes.unshift([nodeAt(k % NN), nodeAt((k / NN) | 0)]);
  nodes[nodes.length - 1] = [gx, gz];                       // finish on the spot that was clicked
  // keep only the corners: from each kept point, the furthest one still in a clear straight line
  const clearLine = (x0, z0, x1, z1) => {
    const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0));
    for (let k = 1; k < n; k++) if (!pass(nodeOf(x0 + (x1 - x0) * k / n), nodeOf(z0 + (z1 - z0) * k / n))) return false;
    return true;
  };
  const route = [];
  let at = [s.x, s.z], k = 0;
  while (k < nodes.length - 1) {
    let far = k + 1;
    for (let m = nodes.length - 1; m > k + 1; m--) if (clearLine(at[0], at[1], nodes[m][0], nodes[m][1])) { far = m; break; }
    route.push({ x: nodes[far][0], z: nodes[far][1] });
    at = nodes[far]; k = far;
  }
  if (!route.length) route.push({ x: gx, z: gz });
  return route;
}

// ---------------------------------------------------------------- driving
// Tank steering: turn on the spot (about the middle of the hull) toward the next corner of its route, then drive at it,
// correcting as it goes. The last leg, if the spot is close behind, is driven in reverse. Round whatever is in the way:
//  - turning on the spot, if the short way round is blocked it goes the long way, and keeps going that way;
//  - if neither way is open it edges forward or back until it can turn (a three-point turn);
//  - driving, if the way ahead is blocked it steers for the clear heading nearest the corner, so it follows a wall.
// A watchdog checks every 3 s that it has really got somewhere (moved or turned); twice without, it gives up, as it does
// after a few seconds of being unable to move at all, or when an order has run far too long.
const PIVOT = -1.0;                                         // local z it turns about: the middle of the hull
function turned(s, yaw) {                                   // where the origin ends up when it turns on the spot to yaw
  const px = s.x + Math.sin(s.yaw) * PIVOT, pz = s.z + Math.cos(s.yaw) * PIVOT;
  return { x: px - Math.sin(yaw) * PIVOT, z: pz - Math.cos(yaw) * PIVOT };
}
const canTurn = (s, dyaw, self = s) => { const o = turned(s, s.yaw + dyaw); return fits(o.x, o.z, s.yaw + dyaw, self); };
const probe = (s, yaw, dist) => fits(s.x + Math.sin(yaw) * dist, s.z + Math.cos(yaw) * dist, yaw, s);
// Edging forward or back far enough that a turn becomes possible: the first of a few runs that both fits and lets it
// turn there (either way). null: no such room.
function makeRoom(s, preferBack) {
  for (const dist of [1.5, 3, 4.5, 6]) for (const dir of preferBack ? [-1, 1] : [1, -1]) {
    const x = s.x + Math.sin(s.yaw) * dir * dist, z = s.z + Math.cos(s.yaw) * dir * dist;
    if (!fits(x, z, s.yaw, s)) continue;
    const ghost = { x, z, yaw: s.yaw };
    if (canTurn(ghost, 0.3, s) || canTurn(ghost, -0.3, s)) return { dir, t: dist / (SHIP.speed * 0.7) };
  }
  return null;
}
function drive(s, dt) {
  let v = 0, w = 0;
  if (s.moveTo) {
    const last = !s.route.length, dx = s.moveTo.x - s.x, dz = s.moveTo.z - s.z, d = Math.hypot(dx, dz);
    s.orderT += dt;
    if (d < (last ? 0.6 : 1.5)) { s.moveTo = s.route.shift() ?? null; s.steer = null; s.steerT = 0; }   // a corner: close, so it does not cut it
    else if (s.shuffle) {                                   // edging forward or back to make room to turn
      s.shuffle.t -= dt;
      v = s.shuffle.dir * SHIP.speed * 0.7;
      if (s.shuffle.t <= 0 || !probe(s, s.yaw, s.shuffle.dir * 0.6)) s.shuffle = null;
    } else {
      let dir = 1, head = Math.atan2(dx, dz);
      if (last && Math.abs(wrap(head - s.yaw)) > 2.4 && d < 14) { dir = -1; head = wrap(head + Math.PI); }   // close behind: reverse
      s.steerT -= dt;
      if (s.steerT <= 0) {                                  // the way ahead blocked: the nearest clear heading instead
        s.steerT = 0.25;
        s.steer = null;
        if (Math.abs(wrap(head - s.yaw)) < 0.8 && !probe(s, head, dir * 2.5)) {
          for (let k = 1; k <= 6 && s.steer === null; k++) for (const sgn of [1, -1]) {
            const h = wrap(head + sgn * k * 0.3);
            if (probe(s, h, dir * 2.5)) { s.steer = h; break; }
          }
        }
      }
      if (s.steer !== null) head = s.steer;
      const diff = wrap(head - s.yaw);
      let turn = Math.sign(diff);
      if (Math.abs(diff) >= 0.5) {                                      // turning on the spot
        if (s.turnDir) turn = s.turnDir;                                // already committed to the long way round
        if (!canTurn(s, turn * 0.04)) {
          if (!s.turnDir && canTurn(s, -turn * 0.04)) turn = s.turnDir = -turn;   // the short way is blocked: the long way
          else { s.turnDir = 0; s.shuffle = makeRoom(s, Math.abs(diff) > Math.PI / 2); }   // that too: make room first
        }
      } else s.turnDir = 0;
      w = turn * Math.min(Math.abs(diff) * 2, SHIP.turn);
      if (Math.abs(diff) < 0.5) v = dir * SHIP.speed * (last ? Math.min(1, d / 2.5) : 1) * (1 - Math.abs(diff) * 1.2);
    }
    const wd = s.watch;                                     // the watchdog
    wd.t += dt;
    if (wd.t > 3) {
      const got = Math.hypot(s.x - wd.x, s.z - wd.z) > 0.4 || Math.abs(wrap(s.yaw - wd.yaw)) > 0.2;
      wd.trips = got ? 0 : wd.trips + 1;
      if (!got && !s.shuffle) { s.turnDir = 0; s.shuffle = makeRoom(s, true); }
      Object.assign(wd, { x: s.x, z: s.z, yaw: s.yaw, t: 0 });
    }
    if (s.moveTo && (s.stuckT > 2.5 || wd.trips >= 2 || s.orderT > 90)) { s.moveTo = null; s.route.length = 0; log('Land battleship: the way is blocked.', true); }
  }
  s.v += (v - s.v) * Math.min(1, dt * 1.6);
  s.w += (w - s.w) * Math.min(1, dt * 3);
  if (Math.abs(s.v) < 0.01 && Math.abs(s.w) < 0.002) { s.v = s.w = 0; if (s.moveTo) s.stuckT += dt; return; }
  const ny = s.yaw + s.w * dt, o = turned(s, ny), nx = o.x + Math.sin(ny) * s.v * dt, nz = o.z + Math.cos(ny) * s.v * dt;
  if (fits(nx, nz, ny, s)) { s.x = nx; s.z = nz; s.yaw = wrap(ny); s.stuckT = 0; }
  else if (fits(o.x, o.z, ny, s)) { s.x = o.x; s.z = o.z; s.yaw = wrap(ny); s.v = 0; s.stuckT = 0; }
  else { s.v = s.w = 0; s.stuckT += dt; }                  // nothing it tried this frame would go
  for (let k = 0; k < 2; k++) s.track[k] += (s.v - (k ? 1 : -1) * s.w * TX) * dt;
  setTracks(s);
}

// Sit the hull on the ground: the best-fit plane (least squares) through the ground under seven points along each track,
// pitched and rolled to it and raised until no point of either track is buried more than SINK (heavy tracks dig in a
// little rather than perch on the one highest bump), nor the ram bow or the stern overhang (CLEAR: how high above the
// plane those sit; they may lift it at most 0.6 m more, so a bump under an overhang never leaves the tracks in the air).
const FOOT = [];
for (const lx of [-TX, TX]) for (let k = 0; k < 7; k++) FOOT.push([lx, TZ - TA + k * (2 * TA / 6)]);
const SXX = FOOT.reduce((a, [lx]) => a + lx * lx, 0), SZZ = FOOT.reduce((a, [, lz]) => a + (lz - TZ) ** 2, 0), _h = FOOT.map(() => 0);
const SINK = 0.3;
const CLEAR = [[0, 6.9, 0.75], [0, 5.6, 0.95], [-1.4, STERN + 0.3, 1.05], [1.4, STERN + 0.3, 1.05]];
function pose(s, dt) {
  const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
  let mean = 0, sx = 0, sz = 0;
  FOOT.forEach(([lx, lz], k) => {
    const h = (_h[k] = heightAt(s.x + lx * c + lz * sn, s.z - lx * sn + lz * c));
    mean += h / FOOT.length; sx += h * lx; sz += h * (lz - TZ);
  });
  const kx = sx / SXX, kz = sz / SZZ;                      // the points are symmetric about (0, TZ): the fit separates
  const plane = (lx, lz) => mean + kx * lx + kz * (lz - TZ);
  let lift = 0;
  FOOT.forEach(([lx, lz], k) => { lift = Math.max(lift, _h[k] - plane(lx, lz) - SINK); });
  let clear = lift;
  for (const [lx, lz, up] of CLEAR) clear = Math.max(clear, heightAt(s.x + lx * c + lz * sn, s.z - lx * sn + lz * c) - plane(lx, lz) - up);
  s.y = plane(0, 0) + lift + Math.min(0.6, clear - lift);   // the plane's height under the origin
  s.bob = Math.max(0, s.bob - dt * 2.2);
  s.mesh.position.set(s.x, s.y, s.z);
  s.mesh.rotation.set(Math.atan(-kz), s.yaw, Math.atan(kx), 'YXZ');
  s.mesh.userData.body.position.y = s.bob > 0 ? -0.2 * Math.sin((1 - s.bob) * Math.PI) : 0;
}

// Bugs (and troopers) are shoved out of the footprint. Driving forward, the ram bow kills any bug it runs into (all but
// a Colossus); backing up, the stern runs over small ones.
function shove(s) {
  const c = Math.cos(s.yaw), sn = Math.sin(s.yaw), fwd = s.v > 0.3, back = s.v < -0.3;
  const push = (o, r, bug) => {
    const dx = o.x - s.x, dz = o.z - s.z, lx = dx * c - dz * sn, lz = dx * sn + dz * c;
    if (Math.abs(lx) > HW + r || lz > BOW + r || lz < STERN - r) return;
    const q = hullQuery(lx, lz);
    if (q.d >= r) return;
    if (bug && ((fwd && q.bow) || (back && q.stern && o.def.scale < 1))) { damageEnemy(o, 1e9, s); return; }
    const ox = q.cx + q.nx * r, oz = q.cz + q.nz * r;
    o.x = s.x + ox * c + oz * sn; o.z = s.z - ox * sn + oz * c;
  };
  eachEnemy(s.x, s.z, BOW + 1.5, (e) => {
    if (!e.dead && !e.boss && !e.held && !e.climb) push(e, 0.5 * e.def.scale, true);
  });
  for (const t of state.troopers) if (t.hp > 0) push(t, 0.3, false);
}

// ---------------------------------------------------------------- weapons
const tier = (e) => (e.boss ? 2 : e.def.scale >= 1 ? 1 : 0);
// Is bug e inside mount m's arc, seen from (mx, mz) on a hull facing yaw?
const inArc = (m, mx, mz, e, yaw) => Math.abs(wrap(Math.atan2(e.x - mx, e.z - mz) - yaw - m.arc)) <= m.half;
function nearest(m, mx, mz, r, yaw, skip = null) {
  let best = null, bd = r * r, alt = null;
  eachEnemy(mx, mz, r, (e, d2) => {
    if (d2 >= bd || !inArc(m, mx, mz, e, yaw)) return;
    if (e === skip) alt = e; else { bd = d2; best = e; }
  });
  return best ?? alt;
}
// Turn a mount toward world point (tx, tz) from (mx, mz) at rate rad/s, never leaving its arc (it turns the long way
// round rather than through the bridge). Returns how far off it still is.
function swing(m, node, mx, mz, tx, tz, yaw, rate, dt) {
  const want = wrap(Math.atan2(tx - mx, tz - mz) - yaw);
  let r = wrap(m.yaw - m.arc);
  r += clamp(clamp(wrap(want - m.arc), -m.half, m.half) - r, -rate * dt, rate * dt);
  m.yaw = wrap(m.arc + r);
  node.rotation.y = m.yaw;
  return Math.abs(wrap(want - m.yaw));
}
// Ease a mount back to the middle of its arc while it has nothing to shoot at.
function rest(m, node, rate, dt) {
  const r = wrap(m.yaw - m.arc);
  m.yaw = wrap(m.arc + r - clamp(r, -rate * dt, rate * dt));
  node.rotation.y = m.yaw;
}

function updateRail(s, dt) {
  const R = SHIP.rail, r = s.rail, ud = s.mesh.userData.rail, caps = s.mesh.userData.caps;
  ud.yaw.getWorldPosition(_a);
  if (r.target && (r.target.dead || Math.hypot(r.target.x - _a.x, r.target.z - _a.z) > R.range || !inArc(r, _a.x, _a.z, r.target, s.yaw))) r.target = null;
  r.scan -= dt;
  if (!r.target || r.scan <= 0) {                         // Colossus first, then brutes and spitters, then the rest
    r.scan = 0.25;
    let best = null, bt = -1, bd = Infinity;
    eachEnemy(_a.x, _a.z, R.range, (e, d) => {
      if (!inArc(r, _a.x, _a.z, e, s.yaw)) return;
      const t = tier(e);
      if (t > bt || (t === bt && d < bd)) { bt = t; bd = d; best = e; }
    });
    if (best && (!r.target || tier(best) > tier(r.target))) r.target = best;
  }
  r.recoil = Math.min(1, r.recoil + dt / 0.7);
  ud.gun.position.z = -1.0 * (r.recoil < 0.07 ? r.recoil / 0.07 : 1 - (r.recoil - 0.07) / 0.93);
  ud.flash.visible = r.recoil < 0.06;
  const t = r.target;
  if (!t) {
    r.charge = Math.max(0, r.charge - dt * 2);
    r.pitch *= Math.exp(-3 * dt); ud.pitch.rotation.x = r.pitch;
    rest(r, ud.yaw, R.turn * 0.5, dt);
    caps.emissiveIntensity = 0.3 + (r.charge / R.charge) * 3.5;
    return;
  }
  const err = swing(r, ud.yaw, _a.x, _a.z, t.x, t.z, s.yaw, R.turn, dt);
  const dy = aimY(t) - (_a.y + 1.2);                       // elevate only for a target well overhead (the Colossus)
  const want = dy > 1.5 ? -Math.min(1.1, Math.atan2(dy, Math.hypot(t.x - _a.x, t.z - _a.z))) : 0;
  r.pitch += (want - r.pitch) * Math.min(1, dt * 5);
  ud.pitch.rotation.x = r.pitch;
  if (r.charge === 0) audio.play('railgun_charge', { x: s.x, z: s.z, charge: R.charge });
  r.charge = Math.min(R.charge, r.charge + dt);
  const frac = r.charge / R.charge;
  caps.emissiveIntensity = 0.3 + frac * 3.5 + (frac > 0.85 ? Math.random() * 1.5 : 0);
  if (r.charge < R.charge || err > 0.02 || Math.abs(want - r.pitch) > 0.1) return;
  r.charge = 0;
  r.recoil = 0;
  ud.muzzle.getWorldPosition(_a);
  ud.gun.getWorldDirection(_c);
  const raised = r.pitch < -0.05;
  if (!raised) _c.y = 0;
  _c.normalize();
  const reach = R.range * 1.5;
  _b.copy(_a).addScaledVector(_c, reach);
  if (!raised) _b.y = Math.max(_b.y, heightAt(_b.x, _b.z) + 1);
  railBeam(_a, _b);
  railStrike(_a, _c, reach, R.damage, s);                  // through everything along its line, weaker with each bug
  state.shake += 0.15;
  audio.play('railgun_fire', { x: s.x, z: s.z });
}

function updateCiws(s, dt) {
  const C = SHIP.ciws;
  s.ciws.forEach((m, k) => {
    const ud = s.mesh.userData.ciws[k], other = s.ciws[1 - k].target;
    ud.yaw.getWorldPosition(_a);
    if (m.target && (m.target.dead || Math.hypot(m.target.x - _a.x, m.target.z - _a.z) > C.range || !inArc(m, _a.x, _a.z, m.target, s.yaw))) m.target = null;
    m.scan -= dt;
    if (!m.target || m.scan <= 0) { m.scan = 0.3; m.target = nearest(m, _a.x, _a.z, C.range, s.yaw, other); }   // fore and aft split their targets
    const t = m.target;
    let err = 9;
    if (t) {
      err = swing(m, ud.yaw, _a.x, _a.z, t.x, t.z, s.yaw, C.turn, dt);
      const want = -Math.atan2(aimY(t) - (_a.y + 0.55), Math.max(1, Math.hypot(t.x - _a.x, t.z - _a.z)));
      m.pitch += (want - m.pitch) * Math.min(1, dt * 10);
    } else {
      rest(m, ud.yaw, 1, dt);
      m.pitch *= Math.exp(-3 * dt);
    }
    ud.pitch.rotation.x = m.pitch;
    m.spin += ((t && err < 0.3 ? 32 : 0) - m.spin) * Math.min(1, dt * 4);   // the barrels spin up before it fires
    ud.spin.rotation.z += m.spin * dt;
    m.flash = Math.max(0, m.flash - dt);
    ud.flash.visible = m.flash > 0;
    if (ud.flash.visible) ud.flash.rotation.z = Math.random() * Math.PI;
    m.cd -= dt;
    if (!t || err > 0.1 || m.spin < 20) { m.cd = Math.max(m.cd, 0); return; }
    while (m.cd <= 0 && !t.dead) {
      m.cd += 1 / C.rate;
      ud.muzzle.getWorldPosition(_a);
      _b.set(t.x + rnd(-0.35, 0.35), aimY(t) + rnd(-0.25, 0.15) * t.def.scale, t.z + rnd(-0.35, 0.35));
      const tr = makeTracer(_a, _b);
      scene.add(tr);
      state.beams.push({ mesh: tr, life: 0.05, max: 0.05 });
      damageEnemy(t, C.damage, s);
      if (Math.random() < 0.2) burst(_b.x, _b.y, _b.z, 'ichor', 1, 3);
      m.flash = 0.04;
      audio.play('hmg_fire', { x: s.x, z: s.z, vol: 0.3 });
    }
  });
}

const MAX_CASINGS = 1400;                                  // game.js draws up to 1500; leave the towers some
function updateGuns(s, dt) {
  const G = SHIP.gun;
  s.guns.forEach((m, k) => {
    const ud = s.mesh.userData.guns[k];
    ud.yaw.getWorldPosition(_a);
    if (m.target && (m.target.dead || Math.hypot(m.target.x - _a.x, m.target.z - _a.z) > G.range || !inArc(m, _a.x, _a.z, m.target, s.yaw))) m.target = null;
    m.scan -= dt;
    if (!m.target || m.scan <= 0) { m.scan = 0.3; m.target = nearest(m, _a.x, _a.z, G.range, s.yaw); }
    m.recoil = Math.min(1, m.recoil + dt / 0.25);
    const kick = 0.22 * (m.recoil < 0.2 ? m.recoil / 0.2 : 1 - (m.recoil - 0.2) / 0.8);
    for (const b of ud.barrels) { b.gun.position.z = 0.36 - kick; b.flash.visible = m.recoil < 0.2; }
    m.cd -= dt;
    const t = m.target;
    if (!t) { rest(m, ud.yaw, 1, dt); return; }
    const err = swing(m, ud.yaw, _a.x, _a.z, t.x, t.z, s.yaw, G.turn, dt);
    if (m.cd > 0 || err > 0.07) return;
    m.cd = 1 / G.rate;
    m.recoil = 0;
    for (const b of ud.barrels) {                          // both barrels, a shell each
      b.flash.rotation.z = Math.random() * Math.PI;
      b.muzzle.getWorldPosition(_b);
      const shell = makeProjectile();
      shell.position.copy(_b);
      scene.add(shell);
      state.projectiles.push({ mesh: shell, src: s, target: t, speed: 30, damage: G.damage, life: 3, sabot: false });
      if (state.casings.length < MAX_CASINGS) {              // the cases go out over the side of the hull
        const ox = Math.cos(s.yaw) * m.side, oz = -Math.sin(s.yaw) * m.side, sp = rnd(2.4, 3.6);
        state.casings.push({ x: _a.x + ox * 0.4, y: _a.y + 0.3, z: _a.z + oz * 0.4, rx: rnd(0, 3), ry: rnd(0, 3), rz: rnd(0, 3), sc: 1, t: 0, landed: false, bounced: false,
          vx: ox * sp, vy: rnd(2.5, 4), vz: oz * sp, ax: rnd(-10, 10), ay: rnd(-10, 10) });
      }
    }
    flashes.add(_b.x, _b.y, _b.z, { color: 0xffc070, power: 10, range: 6, life: 0.1, key: ud });
    audio.play('autocannon_fire', { x: s.x, z: s.z, vol: 0.35 });
    audio.play('autocannon_fire', { x: s.x, z: s.z, vol: 0.3, delay: 0.05 });
  });
}

// Up to n cluster centres within r: the bug with the most neighbours within 4 m, each 5 m from the last, none too close.
function clusters(x, z, r, n) {
  const out = [];
  for (let k = 0; k < n; k++) {
    let best = null, score = -1;
    eachEnemy(x, z, r, (e, d2) => {
      if (d2 < 64) return;
      for (const a of out) if ((e.x - a.x) ** 2 + (e.z - a.z) ** 2 < 25) return;
      let cnt = 0;
      eachEnemy(e.x, e.z, 4, () => { cnt++; });
      if (cnt > score) { score = cnt; best = e; }
    });
    if (!best) break;
    out.push(best);
  }
  return out;
}

function updateVls(s, dt) {
  const V = SHIP.vls, vl = s.vls, ud = s.mesh.userData;
  vl.cd -= dt;
  if (!vl.salvo && vl.cd <= 0) {
    const aims = clusters(s.x, s.z, V.range, 3);
    if (aims.length) { vl.salvo = { aims, n: 0, timer: 0.45 }; vl.cd = V.interval; audio.play('silo_hatch', { x: s.x, z: s.z }); }
    else vl.cd = 0.5;
  }
  vl.open = clamp(vl.open + (vl.salvo ? dt / 0.4 : -dt / 0.6), 0, 1);
  ud.hatches.forEach((h, k) => { h.rotation.x = -1.95 * Math.min(1, Math.max(0, vl.open * 1.25 - k * 0.03)); });
  if (!vl.salvo) return;
  vl.salvo.timer -= dt;
  if (vl.salvo.timer > 0 || vl.open < 1) return;
  vl.salvo.timer = 0.14;
  const live = vl.salvo.aims.filter((e) => !e.dead), k = vl.salvo.n++;
  const tgt = live.length ? live[k % live.length] : nearest({ arc: 0, half: Math.PI }, s.x, s.z, V.range, s.yaw);
  if (!tgt) { vl.salvo = null; return; }                 // nothing left to shoot at: the rest stay in their cells
  _a.copy(ud.cells[k]);
  s.mesh.localToWorld(_a);
  const m = makeMissile();
  m.position.copy(_a);
  scene.add(m);
  state.missiles.push({ mesh: m, pos: _a.clone(), vel: new THREE.Vector3(rnd(-1, 1), 16, rnd(-1, 1)), target: tgt,
    last: new THREE.Vector3(tgt.x, aimY(tgt), tgt.z), t: 0, spin: rnd(0, 6.28), dmg: V.damage, splash: V.splash, trail: 0, src: s });
  puff(_a.x, _a.y, _a.z, { color: 0xffd090, size: 1.0, life: 0.15, opacity: 0.9, additive: true });
  puff(_a.x, _a.y, _a.z, { color: 0xd8d0c8, size: 1.1, grow: 2.4, life: 1.2, opacity: 0.5, vy: 1.2 });
  audio.play('missile_launch', { x: s.x, z: s.z, vol: 0.4 });
  if (vl.salvo.n >= V.cells) vl.salvo = null;
}

// ---------------------------------------------------------------- exhaust, wear and destruction
// The stacks smoke: a light haze at idle, thick black exhaust when it drives.
function updateExhaust(s, dt) {
  const moving = Math.abs(s.v) > 0.3 || Math.abs(s.w) > 0.05;
  s.stackT -= dt;
  if (s.stackT > 0) return;
  s.stackT = moving ? 0.07 : 0.35;
  for (const [x, y, z] of STACKS) {
    _a.set(x + rnd(-0.15, 0.15), y, z + rnd(-0.25, 0.25));
    s.mesh.localToWorld(_a);
    puff(_a.x, _a.y, _a.z, moving
      ? { color: 0x1e1c1b, size: rnd(0.6, 0.9), grow: 2.6, life: rnd(1.6, 2.4), opacity: 0.55, vy: rnd(2, 3), drag: 0.7 }
      : { color: 0x6a6662, size: 0.5, grow: 2, life: 1.4, opacity: 0.22, vy: 1.4, drag: 0.8 });
  }
}

function updateDamage(s, dt) {
  const f = s.hp / s.maxHp;
  if (f >= 0.5) return;
  s.smokeT -= dt;
  if (s.smokeT > 0) return;
  s.smokeT = 0.08 + f * 0.5;
  _a.set(rnd(-1.4, 1.4), rnd(2.8, 3.8), rnd(-5.5, 5));
  s.mesh.localToWorld(_a);
  puff(_a.x, _a.y, _a.z, { color: 0x2a2622, size: rnd(0.8, 1.4), grow: 2.4, life: rnd(1.4, 2.2), opacity: 0.45, vy: rnd(1.5, 3), drag: 0.8 });
  if (f < 0.25) puff(_a.x, _a.y, _a.z, { color: 0xff8a30, size: rnd(0.5, 0.9), grow: 1.2, life: 0.4, opacity: 0.85, additive: true, vy: 2 });
}

// Off the field, lifted out or destroyed: its kill count goes to the call-in's tally (abilities.js).
function report(s) { if (s.credit) { s.credit.kills = s.kills; s.credit.done?.(); s.credit = null; } }

function die(s) {
  s.live = false;
  s.selected = false;
  s.phase = 'dead';
  state.ships.splice(state.ships.indexOf(s), 1);
  report(s);
  const ud = s.mesh.userData;
  scene.remove(ud.ring);
  ud.ring.geometry.dispose();
  s.mesh.remove(ud.bar);
  for (const m of [...ud.ciws, ...ud.guns.flatMap((g) => g.barrels)]) m.flash.visible = false;
  ud.rail.flash.visible = false;
  s.snd?.stop(); s.snd = null;
  s.thrust?.stop(); s.thrust = null;
  s.sentry.mesh.parent?.remove(s.sentry.mesh);            // the trooper on the helipad is lost with her
  loseEscort(s);
  if (s.rig && s.rig.h.parent !== s.mesh) rigs.push({ h: s.rig.h, flames: s.rig.h.userData.flames, vy: 0, t: 0, snd: s.rig.snd, drift: rnd(-0.15, 0.15) });
  else s.rig?.snd?.stop();
  wrecks.push({ s, t: 0, next: 0, blown: false });
  log('The Land Battleship has been destroyed!', true);
}
function updateWrecks(dt) {
  for (let k = wrecks.length - 1; k >= 0; k--) {
    const w = wrecks[k], s = w.s, ud = s.mesh.userData;
    w.t += dt;
    w.next -= dt;
    if (!w.blown && w.next <= 0) {                        // explosions ripple along the hull...
      w.next = rnd(0.15, 0.3);
      _a.set(rnd(-HW, HW), rnd(1.5, 3.5), rnd(STERN, BOW - 1));
      s.mesh.localToWorld(_a);
      explode(_a.x, _a.z, rnd(0.9, 1.6), 0, 0, { shake: 0.15, smoke: 4 });
    }
    if (!w.blown && w.t > 2.6) {                          // ...then the magazines go up
      w.blown = true;
      explode(s.x, s.z, 4.5, 400, 7, { shake: 1.4, smoke: 22, src: s });
      spawnScorch(scene, s.x, s.z, 9);
      for (let n = 0; n < 4; n++) burst(s.x + rnd(-2, 2), s.y + 3, s.z + rnd(-5, 5), 'debris', 14, 14);
      s.mesh.traverse((o) => { if (o.isMesh) { if (o.material.transparent) o.visible = false; else o.material = mat.wreck; } });
      ud.rail.pitch.rotation.x = 0.22;
      ud.hatches.forEach((h) => { h.rotation.x = rnd(-2.6, -1.2); });
    }
    if (w.blown && Math.random() < dt * 14 * Math.max(0, 1 - w.t / 16)) {   // the wreck burns down
      _a.set(rnd(-1.5, 1.5), rnd(2.6, 3.8), rnd(-5.5, 5.5));
      s.mesh.localToWorld(_a);
      puff(_a.x, _a.y, _a.z, { color: 0xff8030, size: rnd(0.8, 1.6), grow: 1.4, life: 0.5, opacity: 0.85, additive: true, vy: 2.5 });
      puff(_a.x, _a.y + 0.5, _a.z, { color: 0x1e1b19, size: rnd(1.2, 2), grow: 2.6, life: rnd(2, 3), opacity: 0.5, vy: rnd(2, 3.5), drag: 0.6 });
    }
    if (w.t > 16) s.mesh.position.y = s.y - (w.t - 16) ** 2 * 0.35;   // and sinks into the ground
    if (w.t > 20) {
      scene.remove(s.mesh);
      s.mesh.traverse((o) => { if (o.isMesh && o.name === 'baked') o.geometry.dispose(); });
      wrecks.splice(k, 1);
    }
  }
}

// ---------------------------------------------------------------- extraction
// After SHIP.deploy s on station: it stops where it is and calls its gunship home; once that is on the deck a fresh rig
// comes down on its retros, clamps on, and lifts the whole ship back to orbit. It fights on until the moment it lifts.
const departing = [];
function recall(s) {
  s.phase = 'recall';
  s.moveTo = null;
  s.route.length = 0;
  log('Land battleship: time is up. It holds where it is and recovers its gunship for extraction.');
}

// Retro exhaust under a rig's four pods (root: the rig, alt: how high its pods are above where they will set down),
// and a dust storm thrown out from under it as it gets near the ground.
function retroFx(root, s, alt) {
  for (const [px, pz] of PODS) {
    _v.set(px, 1.6, pz); root.localToWorld(_v);
    puff(_v.x, _v.y - rnd(0, 2), _v.z, { color: 0xffb060, size: rnd(0.8, 1.3), life: 0.18, opacity: 0.8, additive: true, vy: -12 });
    if (Math.random() < 0.6) puff(_v.x, _v.y - 3, _v.z, { color: 0x8a8580, size: 1.4, grow: 2.5, life: 1.4, opacity: 0.35, vy: -3, drag: 1.4 });
  }
  if (alt < 18) {
    const k = 1 - alt / 18;
    for (let n = 0; n < 1 + k * 3; n++) {
      const a = rnd(0, Math.PI * 2), r = rnd(4, 7.5);
      puff(s.x + Math.cos(a) * r, s.y + 0.4, s.z + Math.sin(a) * r, { color: 0xb59468, size: rnd(1.6, 3), grow: 2.6, life: rnd(1, 1.8), opacity: 0.5 * k, vx: Math.cos(a) * rnd(6, 11), vz: Math.sin(a) * rnd(6, 11), vy: rnd(0.5, 2), drag: 2 });
    }
  }
}

function callRig(s) {
  const h = makeHarness();
  h.position.set(s.x, s.y + RIG.start, s.z);
  h.quaternion.copy(s.mesh.quaternion);
  scene.add(h);
  s.rig = { h, alt: RIG.start, vel: RIG.v0, braking: false, decel: 0, latchT: -1, snd: null };
  s.phase = 'rigging';
  audio.play('jet_flyby', { x: s.x, z: s.z, vol: 0.7 });
  log('Land battleship: the drop rig is coming down to lift it out.');
}

// The rig comes down and latches on; true once the ship has lifted off.
function updateRig(s, dt) {
  const r = s.rig, flames = r.h.userData.flames;
  if (r.latchT >= 0) {                                    // clamped on: a beat, then the lift
    r.latchT += dt;
    if (r.latchT < 0.9) return false;
    liftOff(s);
    return true;
  }
  if (!r.braking && r.alt <= RIG.ignite) {
    r.braking = true;
    r.decel = (r.vel ** 2 - RIG.land ** 2) / (2 * r.alt);
    audio.play('rocket_launch', { x: s.x, z: s.z, vol: 0.9 });
    r.snd = audio.loop('hub_thruster', { x: s.x, z: s.z, vol: 1.1 });
  }
  if (r.braking) r.vel = Math.max(RIG.land, r.vel - r.decel * dt);
  r.alt = Math.max(0, r.alt - r.vel * dt);
  r.h.position.set(s.x, s.y + r.alt, s.z);
  r.h.quaternion.copy(s.mesh.quaternion);
  r.snd?.setPos(s.x, s.z);
  for (const fl of flames) {
    fl.visible = r.braking;
    if (fl.visible) fl.scale.set(1, 3.6 + rnd(-0.4, 0.6), 1);
  }
  if (r.braking) retroFx(r.h, s, r.alt + 2);
  if (r.alt > 0) return false;
  r.latchT = 0;                                           // touchdown on the hull: the clamps bite
  s.mesh.attach(r.h);
  audio.play('blast_door', { x: s.x, z: s.z, vol: 0.9 });
  state.shake += 0.2;
  for (const [px, pz] of PODS) { _v.set(px * 0.85, 2.8, pz); s.mesh.localToWorld(_v); puff(_v.x, _v.y, _v.z, { color: 0xd8d0c8, size: 1.0, grow: 1.8, life: 0.7, opacity: 0.6, vy: 1 }); }
  return false;
}

function liftOff(s) {
  const ud = s.mesh.userData;
  s.phase = 'lift';
  s.live = false;
  s.selected = false;
  state.ships.splice(state.ships.indexOf(s), 1);
  report(s);
  scene.remove(ud.ring);
  ud.ring.geometry.dispose();
  s.mesh.remove(ud.bar);
  for (const m of [...ud.ciws, ...ud.guns.flatMap((g) => g.barrels)]) m.flash.visible = false;
  ud.rail.flash.visible = false;
  s.snd?.stop(); s.snd = null;
  audio.play('rocket_launch', { x: s.x, z: s.z, vol: 1 });
  state.shake += 0.4;
  departing.push({ s, vy: 0, t: 0 });
  log('Land battleship extracted.');
}
function updateDeparting(dt) {
  for (let k = departing.length - 1; k >= 0; k--) {
    const d = departing[k], s = d.s, r = s.rig, m = s.mesh;
    d.t += dt;
    d.vy += (d.t < 1.2 ? 2.5 : 11) * dt;                  // a heavy, slow heave off the ground, then it climbs away
    m.position.y += d.vy * dt;
    m.rotation.x *= Math.exp(-dt * 2); m.rotation.z *= Math.exp(-dt * 2);
    for (const fl of r.h.userData.flames) { fl.visible = true; fl.scale.set(1.15, 5 + rnd(-0.5, 0.8), 1.15); }
    retroFx(r.h, s, m.position.y - s.y);
    r.snd?.setPos(s.x, s.z);
    if (d.t > 9) {
      r.snd?.stop();
      scene.remove(m);
      m.traverse((o) => { if (o.isMesh && o.name === 'baked') o.geometry.dispose(); });
      departing.splice(k, 1);
    }
  }
}

// ---------------------------------------------------------------- per frame
function updateShip(s, dt) {
  const ud = s.mesh.userData;
  s.t += dt;
  if (s.phase === 'drop') return updateDrop(s, dt);
  if (s.phase === 'landed') {
    for (const fl of ud.flames) fl.visible = false;
    if (s.t > 0.9 && ud.harness.parent === s.mesh) release(s);
    if (s.t > 1.1) s.phase = 'active';
  }
  if (s.phase === 'active') {
    if (!s.warned && s.t >= SHIP.deploy - 10) { s.warned = true; log('Land battleship: extraction in 10 s.'); }
    if (s.t >= SHIP.deploy) recall(s);
  }
  const fighting = s.phase === 'active' || s.phase === 'recall' || s.phase === 'rigging';
  if (fighting) drive(s, dt);                             // recalled, it takes no orders and rolls to a stop where it is
  pose(s, dt);
  if (fighting) {
    updateRail(s, dt); updateCiws(s, dt); updateGuns(s, dt); updateVls(s, dt); updateEscort(s, dt);
    // he may only cross the helipad while the gunship is up and away from it (not parked, landing or lifting off)
    const pad = s.escort.h.mode, free = pad === 'defend' || pad === 'return';
    updateSentry(s.sentry, dt, { yaw: s.yaw, posts: SHIP.sentry.posts, half: SHIP.sentry.half, range: SHIP.sentry.range, damage: SHIP.sentry.damage, free, src: s });
  }
  if (s.phase === 'recall' && s.escort.heli.parent === s.escort.pad && s.v === 0 && s.w === 0) callRig(s);
  if (s.phase === 'rigging' && updateRig(s, dt)) return;   // lifted off: no longer on the field
  shove(s);
  updateExhaust(s, dt);
  updateDamage(s, dt);
  ud.radar.rotation.y += dt * 1.6;
  ud.ring.visible = s.selected;
  if (s.selected && s.ringAt !== `${s.x}|${s.z}|${s.yaw}`) drapeRing(s);
  s.snd?.setPos(s.x, s.z);
  if (s.hp <= 0) die(s);
}

const _p = new THREE.Vector3();
export const battleships = {
  init(sc) { scene = sc; },
  landingYaw,
  canLand: (x, z) => fits(x, z, landingYaw(x, z), null),
  // Why the hull will not stand at (x, z) facing yaw (null: it would): for debugging from the console.
  blockedBy(x, z, yaw, self = null) { const why = {}; return fits(x, z, yaw, self, why) ? null : why.reason; },
  // The footprint outline as it would land at (x, z): [x, z] world points round the hull (the call-in reticle).
  outline(x, z) {
    const yaw = landingYaw(x, z), c = Math.cos(yaw), sn = Math.sin(yaw);
    return HULL.map(([lx, lz]) => [x + lx * c + lz * sn, z - lx * sn + lz * c]);
  },
  // Ability effect. null: no room to land there (the strike stays armed).
  drop(x, z, credit = null) {
    const fx = drop(x, z, credit);
    if (!fx) log('No room for the battleship to land there: it needs open ground clear of buildings.', true);
    return fx;
  },
  update(dt) {
    for (let k = state.ships.length - 1; k >= 0; k--) updateShip(state.ships[k], dt);
    updateRigs(dt);
    updateWrecks(dt);
    updateDeparting(dt);
  },
  // Seconds of its time on station left, for the call-in button (null: none on station). It counts from touchdown;
  // while it is still coming down it shows the full time.
  deploy: SHIP.deploy,
  deployLeft() {
    const s = state.ships.find((o) => o.phase === 'drop' || o.phase === 'landed' || o.phase === 'active');
    return s ? (s.phase === 'drop' ? SHIP.deploy : Math.max(0, SHIP.deploy - s.t)) : null;
  },

  // ---- selection and orders (input.js; the same scheme as the troopers)
  get selectedCount() { return state.ships.reduce((n, s) => n + (s.selected ? 1 : 0), 0); },
  selected() { return state.ships.find((s) => s.selected) ?? null; },
  clearSelection() { for (const s of state.ships) s.selected = false; },
  selectBox(x0, y0, x1, y1, camera, add = false) {
    const lx = Math.min(x0, x1), hx = Math.max(x0, x1), ly = Math.min(y0, y1), hy = Math.max(y0, y1);
    let n = 0;
    for (const s of state.ships) {
      _p.set(s.x, s.y + 2, s.z).project(camera);
      const sx = (_p.x + 1) / 2 * innerWidth, sy = (1 - _p.y) / 2 * innerHeight;
      const inside = s.live && _p.z < 1 && sx >= lx - 30 && sx <= hx + 30 && sy >= ly - 30 && sy <= hy + 30;
      s.selected = inside || (add && s.selected);
      if (s.selected) n++;
    }
    return n;
  },
  selectAt(p, add = false) {
    const s = state.ships.find((o) => o.live && hullGap(o, p.x, p.z) < 0.4);
    if (!s) return false;
    if (!add) battleships.clearSelection();
    s.selected = true;
    return true;
  },
  order(p) {
    let n = 0;
    for (const s of state.ships) {
      if (!s.selected || s.phase !== 'active') continue;     // recalled: it holds where it is for the pickup
      const gx = clamp(p.x, BOUNDS.x0 + BOW, BOUNDS.x1 - BOW), gz = clamp(p.z, BOUNDS.z0 + BOW, BOUNDS.z1 - BOW);
      s.route = plan(s, gx, gz) ?? [{ x: gx, z: gz }];     // no way round found: straight at it, and see
      s.moveTo = s.route.shift();
      Object.assign(s, { stuckT: 0, orderT: 0, steerT: 0, steer: null, shuffle: null, turnDir: 0, watch: { x: s.x, z: s.z, yaw: s.yaw, t: 0, trips: 0 } });
      n++;
    }
    return n;
  },
};
