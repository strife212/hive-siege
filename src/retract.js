import * as THREE from 'three';
import { BUILDINGS } from './config.js';
import { heightAt, cutHole } from './terrain.js';
import { bevelBox, worn } from './surface.js';
import { hazardMaterial } from './entities.js';
import { puff } from './particles.js';
import { audio } from './audio.js';
import { state, burst } from './game.js';

// Retractable buildings. Every structure stands on an elevator in its own armoured silo: on command the collar locks
// release, the weapons stow pointing straight up, the platform sinks down a lit shaft and two blast doors swing shut
// and lock over it. Deploying is the same cycle run backwards, and that is also how a new building arrives and how a
// sold one leaves.
//
// It is one reversible timeline: s.silo.t runs 0 (deployed) .. T (locked down) and every moving part is a pure
// function of t, so the cycle can be reversed at any point. None of the hardware exists while a building is simply
// standing there: the silo is built when a cycle starts and taken away again when it ends, so the normal look of a
// base is untouched. The shaft is a real hole: terrain.js masks the ground out inside the collar (cutHole).
//
//   phase A  collar locks spin free              phase D  blast doors swing up and slam (hub leaf first)
//   phase B  weapons stow (STOW table)           phase E  hub lock turns, door and collar bolts screw home
//   phase C  platform descends

const COLLAR = 0.1;                        // collar / door height above the building's ground level
const DROP_RATE = 1, BUILD_RATE = 1.6;     // a new building comes up faster than the full drill

// Hole half-size (multiples of the 0.25 hole mask) per type; the shaft is `inset` smaller, the collar `outset` bigger.
// Walls use a thin lip that exactly fills their tile so a run of them reads as one segmented trench.
const OPEN = {
  wall: [1, 1, 0.03, 0.03], hmg: [1.25, 1.25], turret: [1.5, 1.5], dual: [1.5, 1.5], flame: [1.5, 1.5], laser: [1.5, 1.5],
  refinery: [1.25, 1.25], lab: [1.25, 1.25], mortar: [2.5, 2.5], missile: [2.25, 2.25], rail: [2.25, 2.25], heli: [2.25, 2.25], uplink: [2.25, 2.25],
  airship: [2.25, 3.25], core: [3, 3],
};
function opening(type) {
  const [w, d] = BUILDINGS[type]?.size || [1, 1];
  const [Hx, Hz, inset = 0.2, outset = 0.05] = OPEN[type] || [w + 0.25, d + 0.25];
  return { Hx, Hz, ix: Hx - inset, iz: Hz - inset, ox: Hx + outset, oz: Hz + outset, lite: type === 'wall' };
}

// ---------------------------------------------------------------- materials / shared geometry
const M = {
  collar: worn(new THREE.MeshStandardMaterial({ color: 0x70767e, roughness: 0.55, metalness: 0.6 }), { grime: 0.3, chips: 0.3 }),
  shaft: worn(new THREE.MeshStandardMaterial({ color: 0x23272d, roughness: 0.8, metalness: 0.4 }), { grime: 0.3, chips: 0.1, scale: 0.4 }),
  door: worn(new THREE.MeshStandardMaterial({ color: 0x565c65, roughness: 0.5, metalness: 0.7 }), { grime: 0.3, chips: 0.35 }),
  dark: worn(new THREE.MeshStandardMaterial({ color: 0x1b1e23, roughness: 0.6, metalness: 0.6 }), { grime: 0.14, chips: 0.2 }),
  amber: worn(new THREE.MeshStandardMaterial({ color: 0xd9a441, roughness: 0.5, metalness: 0.3 }), { grime: 0.2, chips: 0.5 }),
  strip: new THREE.MeshStandardMaterial({ color: 0xffb040, emissive: 0xff8a18, emissiveIntensity: 2.2, roughness: 0.4 }),
  beacon: new THREE.MeshStandardMaterial({ color: 0xff9a30, emissive: 0xff6a10, emissiveIntensity: 4.5, roughness: 0.3 }),
};
const geoCache = new Map();
const cached = (key, make) => { let g = geoCache.get(key); if (!g) { g = make(); geoCache.set(key, g); } return g; };
const boltGeo = () => cached('bolt', () => new THREE.CylinderGeometry(0.1, 0.1, 0.12, 6));
const slotGeo = () => cached('slot', () => new THREE.BoxGeometry(0.17, 0.025, 0.045));
const washerGeo = () => cached('washer', () => new THREE.CylinderGeometry(0.15, 0.16, 0.03, 12));

function mesh(geo, mat, x, y, z, parent, shadow = false) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = shadow; m.receiveShadow = true;
  parent.add(m);
  return m;
}

// A lock bolt: washer, hex head and a painted slot so the spin reads. Returns the turning part.
function lockBolt(parent, x, y, z, scale = 1) {
  const seat = new THREE.Group();
  seat.position.set(x, y, z);
  seat.scale.setScalar(scale);
  parent.add(seat);
  mesh(washerGeo(), M.dark, 0, 0.015, 0, seat);
  const head = new THREE.Group();
  seat.add(head);
  mesh(boltGeo(), M.collar, 0, 0.06, 0, head);
  mesh(slotGeo(), M.amber, 0, 0.13, 0, head);
  return head;
}

// ---------------------------------------------------------------- the silo
function quad(out, a, b, c, d, want) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  if (nx * want[0] + ny * want[1] + nz * want[2] < 0) [b, d] = [d, b];
  out.push(...a, ...b, ...c, ...a, ...c, ...d);
}
const toGeo = (arr) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3)); g.computeVertexNormals(); return g; };

// Shaft lining and collar. The collar's top follows the ground wherever the ground stands higher than the collar, so
// on a slope the uphill side becomes a retaining wall and the cut edge of the terrain is never left open.
function shaftGeometry(s, o, depth, topAt) {
  const lining = [], cap = [];
  const cin = [[-o.ix, -o.iz], [o.ix, -o.iz], [o.ix, o.iz], [-o.ix, o.iz]], cout = [[-o.ox, -o.oz], [o.ox, -o.oz], [o.ox, o.oz], [-o.ox, o.oz]];
  const at = (p, q, u) => [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u];
  for (let k = 0; k < 4; k++) {
    const a = cin[k], b = cin[(k + 1) % 4], A = cout[k], B = cout[(k + 1) % 4];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.5));
    const nx = Math.sign(a[0] + b[0]), nz = Math.sign(a[1] + b[1]);              // outward normal of this side
    for (let q = 0; q < n; q++) {
      const p0 = at(a, b, q / n), p1 = at(a, b, (q + 1) / n), P0 = at(A, B, q / n), P1 = at(A, B, (q + 1) / n);
      const t0 = Math.max(topAt(p0[0], p0[1]), topAt(P0[0], P0[1])), t1 = Math.max(topAt(p1[0], p1[1]), topAt(P1[0], P1[1]));
      quad(lining, [p0[0], -depth, p0[1]], [p1[0], -depth, p1[1]], [p1[0], t1, p1[1]], [p0[0], t0, p0[1]], [-nx, 0, -nz]);
      quad(cap, [p0[0], t0, p0[1]], [p1[0], t1, p1[1]], [P1[0], t1, P1[1]], [P0[0], t0, P0[1]], [0, 1, 0]);
      quad(cap, [P0[0], t0, P0[1]], [P1[0], t1, P1[1]], [P1[0], -1.9, P1[1]], [P0[0], -1.9, P0[1]], [nx, 0, nz]);
    }
  }
  return { lining: toGeo(lining), cap: toGeo(cap) };
}

function buildSilo(s, stowTop) {
  const o = opening(s.type);
  const L = o.ix - 0.065;                                           // door leaf length, hinge to seam
  const hubR = o.lite ? 0.26 : Math.min(0.62, o.ix * 0.27);
  const depth = stowTop + L + hubR + 0.3;
  const topAt = (lx, lz) => Math.max(COLLAR, heightAt(s.x + lx, s.z + lz) - s.y + 0.05) + (s.id % 7) * 0.003;   // per-silo offset: neighbours never z-fight
  const group = new THREE.Group();
  group.position.set(s.x, s.y, s.z);
  const geo = shaftGeometry(s, o, depth + 0.45, topAt);
  const inner = new THREE.Group(), collar = new THREE.Group();
  group.add(inner, collar);
  mesh(geo.lining, M.shaft, 0, 0, 0, inner);
  mesh(geo.cap, M.collar, 0, 0, 0, collar, true);

  // elevator platform (rides with the building), guide lights and the spinning drive screws in the shaft corners
  const works = new THREE.Group(), platform = new THREE.Group();   // works: everything that only shows while the doors are open
  inner.add(works);
  works.add(platform);
  const pw = (o.ix - 0.2) * 2, pd = (o.iz - 0.1) * 2;
  mesh(cached(`plat${pw},${pd}`, () => bevelBox(pw, 0.14, pd)), M.dark, 0, -0.2, 0, platform);
  if (!o.lite) {
    for (const sz of [-1, 1]) mesh(cached(`edgeX${pw}`, () => new THREE.BoxGeometry(pw - 0.1, 0.02, 0.09)), M.amber, 0, -0.125, sz * (pd / 2 - 0.08), platform);
    for (const sx of [-1, 1]) mesh(cached(`edgeZ${pd}`, () => new THREE.BoxGeometry(0.09, 0.02, pd - 0.3)), M.amber, sx * (pw / 2 - 0.08), -0.125, 0, platform);
  }
  const lightGeo = cached(`light${depth.toFixed(1)}`, () => new THREE.BoxGeometry(0.07, depth - 0.5, 0.03));
  for (const sz of [-1, 1]) for (const fx of o.lite ? [0] : [-0.45, 0.45]) mesh(lightGeo, M.strip, fx * o.ix, -(depth + 0.3) / 2, sz * (o.iz - 0.016), works);
  const rods = [];
  if (!o.lite) {
    const rodGeo = cached(`rod${depth.toFixed(1)}`, () => new THREE.BoxGeometry(0.09, depth + 0.3, 0.09));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) rods.push(mesh(rodGeo, M.collar, sx * (o.ix - 0.2), -(depth + 0.3) / 2, sz * (o.iz - 0.07), works));
  }

  // blast doors: two leaves hinged on the long sides that hang inside the shaft while open. Leaf 0 carries the hub
  // lock, which overlaps the seam, so it closes first and the other leaf comes up underneath it.
  const doors = [], doorBolts = [];
  const W = o.iz * 2 - 0.05, hazard = hazardMaterial();
  let hub = null;
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * (o.ix - 0.06), COLLAR - 0.06, 0);
    collar.add(pivot);
    mesh(cached(`sill${W}`, () => new THREE.BoxGeometry(0.16, 0.05, W)), M.dark, side * (o.ix - 0.06), COLLAR - 0.085, 0, collar);   // closes the hinge gap
    const leaf = new THREE.Group();                                  // leaf frame: +x runs from the hinge to the seam
    leaf.rotation.y = side < 0 ? 0 : Math.PI;
    pivot.add(leaf);
    mesh(cached(`leaf${L},${W}`, () => bevelBox(L, 0.1, W, 0.025)), M.door, L / 2, 0, 0, leaf, true);
    const tape = mesh(cached(`tape${W}`, () => {
      const g = new THREE.PlaneGeometry(W - 0.12, 0.26).rotateX(-Math.PI / 2).rotateY(Math.PI / 2);
      const uv = g.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setX(k, uv.getX(k) * (W - 0.12) * 1.4);
      return g;
    }), hazard, L - 0.2, 0.052, 0, leaf);
    tape.receiveShadow = true;
    const ribs = o.lite ? [0] : W > 5 ? [-0.34, -0.12, 0.12, 0.34] : [-0.27, 0, 0.27];
    for (const f of ribs) mesh(cached(`rib${L}`, () => bevelBox(L * 0.5, 0.06, 0.13)), M.dark, L * 0.32, 0.07, f * W, leaf);
    mesh(cached(`hinge${W}`, () => new THREE.CylinderGeometry(0.055, 0.055, W - 0.1, 8).rotateX(Math.PI / 2)), M.dark, 0.02, 0.0, 0, leaf);
    for (const f of o.lite ? [] : [-1, 1]) doorBolts.push(lockBolt(leaf, L - 0.52, 0.05, f * (W / 2 - 0.34), 0.85));
    if (side < 0) {
      hub = new THREE.Group();
      hub.position.set(L + 0.005, 0.05, 0);
      leaf.add(hub);
      mesh(cached(`hub${hubR}`, () => new THREE.CylinderGeometry(hubR, hubR * 1.06, 0.07, 24)), M.dark, 0, 0.035, 0, hub, true);
      mesh(cached(`hubcap${hubR}`, () => new THREE.CylinderGeometry(hubR * 0.36, hubR * 0.42, 0.08, 6)), M.collar, 0, 0.1, 0, hub);
      for (let k = 0; k < 3; k++) {
        const lug = mesh(cached(`lug${hubR}`, () => bevelBox(hubR * 0.62, 0.05, hubR * 0.24).translate(hubR * 0.62, 0, 0)), M.amber, 0, 0.09, 0, hub);
        lug.rotation.y = (k / 3) * Math.PI * 2;
      }
    }
    doors.push({ pivot, side });
  }

  // collar hardware: lock bolts at the corners (and along long sides), two rotating warning beacons
  const bolts = [], beacons = [];
  if (!o.lite) {
    const cx = (o.ix + o.ox) / 2, cz = (o.iz + o.oz) / 2, spots = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) spots.push([sx * cx, sz * cz]);
    for (const sx of [-1, 1]) for (const f of o.iz > 2.8 ? [-1 / 3, 1 / 3] : o.iz > 1.8 ? [0] : []) spots.push([sx * cx, f * o.iz]);
    for (const [x, z] of spots) bolts.push({ head: lockBolt(collar, x, topAt(x, z), z, (o.ox - o.ix) / 0.25), x, z });
    for (const sz of [-1, 1]) {
      const y = topAt(0, sz * cz);
      mesh(cached('beaconBase', () => new THREE.CylinderGeometry(0.09, 0.11, 0.1, 10)), M.dark, 0, y + 0.05, sz * cz, collar);
      const lamp = new THREE.Group();
      lamp.position.set(0, y + 0.15, sz * cz);
      collar.add(lamp);
      mesh(cached('beaconLamp', () => new THREE.BoxGeometry(0.16, 0.09, 0.05).translate(0.04, 0, 0)), M.beacon, 0, 0, 0, lamp);
      mesh(cached('beaconCap', () => new THREE.CylinderGeometry(0.05, 0.05, 0.11, 8)), M.dark, 0, 0, 0, lamp);
      beacons.push(lamp);
    }
  }

  // timeline (seconds, in the retract direction)
  const c0 = 1.05, c1 = c0 + 0.9 + depth * 0.14, e0 = c1 + 0.9, T = e0 + 0.6;
  return {
    group, inner, works, collar, platform, doors, hub, bolts, doorBolts, beacons, rods, geo, o, depth, topAt,
    seg: { a: [0, 0.4], b: [0.15, c0], c: [c0, c1], d0: [c1, c1 + 0.72], d1: [c1 + 0.18, e0], e: [e0, T] },
    T, t: 0, target: 0, rate: DROP_RATE, holeOpen: false, from: null,
  };
}

// ---------------------------------------------------------------- stow poses
const lerp = (a, b, k) => a + (b - a) * k;
const UP = -1.36;                                                   // head pitch that points a barrel at the sky
function capture(s, atRest) {
  const ud = s.mesh.userData, gun = ud.guns?.[0]?.gun;
  if (ud.head && ud.headY0 === undefined) ud.headY0 = ud.head.position.y;
  if (atRest) return { elev: 0, pitch: ud.idlePitch ?? 0, tube: Math.PI / 6, gun: 0, hatch: 0 };
  return { elev: ud.head?.rotation.x ?? 0, pitch: ud.pitch?.rotation.x ?? 0, tube: ud.tube?.rotation.x ?? 0, gun: gun?.rotation.x ?? 0, hatch: ud.hatch ?? 0 };
}
const headUp = (lift) => (s, f, k) => {
  const head = s.mesh.userData.head;
  if (head.rotation.order !== 'YXZ') head.rotation.order = 'YXZ';
  head.rotation.x = lerp(f.elev, UP, k);
  head.position.y = s.mesh.userData.headY0 + lift * Math.sin(Math.min(1, k * 1.4) * Math.PI / 2);   // the neck extends first so the breech clears the mount
};
const STOW = {
  hmg: headUp(0.3), turret: headUp(0.34), dual: headUp(0.34), flame: headUp(0.4),
  laser(s, f, k) { s.mesh.userData.pitch.rotation.x = lerp(f.pitch, -1.32, k); },
  mortar(s, f, k) { const ud = s.mesh.userData; ud.tube.rotation.x = lerp(f.tube, 0, k); ud.tube.position.y = 0; },
  rail(s, f, k) {                                                   // the mount levels and the rail sled stands up on end
    const ud = s.mesh.userData;
    ud.head.rotation.x = lerp(f.elev, 0, k);
    ud.guns[0].gun.rotation.x = lerp(f.gun, -1.47, k);
  },
  missile(s, f, k) {                                                // rack down, hatches shut (same curve as the launch cycle)
    const ud = s.mesh.userData, h = (ud.hatch = f.hatch * (1 - k));
    const e = h < 0.5 ? 2 * h * h : 1 - Math.pow(-2 * h + 2, 2) / 2;
    for (const d of ud.doors) d.pivot.rotation.z = d.side * -1.45 * Math.min(1, e * 1.6);
    ud.rack.position.y = ud.rackDown + (ud.rackUp - ud.rackDown) * Math.max(0, (e - 0.35) / 0.65);
  },
  core(s, f, k) { for (const p of s.mesh.userData.pylons) p.scale.y = 1 - 0.86 * k; },                       // landing pylons draw up off the ground
  wall(s, f, k) { for (const arm of Object.values(s.mesh.userData.arms)) arm.scale.x = 1 - 0.24 * k; },   // link arms pull in to clear the lip
};

// Things to settle before the machinery starts: aircraft home (gunship) or clear of the pad (airship), guns cold.
function ready(s) {
  const kind = s.def?.kind;
  if (kind === 'heli') return !s.heli || s.heli.mode === 'rearm' || (s.evac && s.mesh.userData.heli.parent !== s.mesh);   // home, or evacuated: the pad goes down empty
  if (kind === 'airship') { const ship = s.mesh.userData.ship; return !ship || (ship.parent !== s.mesh && ship.position.y > s.y + 6); }
  return true;
}
function quiet(s) {
  const ud = s.mesh.userData, kind = s.def?.kind;
  s.target = null;
  if (s.snd && kind !== 'airship' && !(kind === 'heli' && s.evac)) { s.snd.stop(); s.snd = null; }   // aircraft that are away keep their engines
  for (const g of ud.guns || []) if (g.flash) g.flash.visible = false;
  if (ud.flash) ud.flash.visible = false;
  if (kind === 'rail') { s.charge = 0; ud.gauge.scale.z = 0.001; ud.caps.emissiveIntensity = 0.3; }
  if (kind === 'heli' && ud.heli) ud.heli.userData.hud.visible = false;
  if (ud.lens) ud.lens.material.emissiveIntensity = 0.35;
}

// Height of the building in its stowed pose, measured from its own origin (the docked airship is not part of it).
const _box = new THREE.Box3(), _b = new THREE.Box3();
function stowedHeight(s) {
  const skip = s.mesh.userData.ship;
  STOW[s.type]?.(s, capture(s, true), 1);
  s.mesh.updateMatrixWorld(true);
  _box.makeEmpty();
  (function walk(o) {
    if (o === skip || !o.visible) return;
    if (o.isMesh) { o.geometry.computeBoundingBox(); _box.union(_b.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld)); }
    for (const c of o.children) walk(c);
  })(s.mesh);
  return _box.max.y - s.mesh.position.y;
}

// ---------------------------------------------------------------- running the timeline
const seg = (t, [a, b]) => Math.max(0, Math.min(1, (t - a) / (b - a)));
const smooth = (u) => u * u * (3 - 2 * u);
function openHole(s, open) {
  const si = s.silo, o = si.o;
  if (si.holeOpen === open) return;
  si.holeOpen = open;
  cutHole(s.x - o.Hx, s.z - o.Hz, s.x + o.Hx, s.z + o.Hz, open);
  if (open) state.scene.add(si.group); else state.scene.remove(si.group);
}
function dust(s, n, size = 1) {
  const o = s.silo.o;
  for (let k = 0; k < n; k++) {
    const a = Math.random() * Math.PI * 2, x = s.x + Math.cos(a) * o.ox * 1.05, z = s.z + Math.sin(a) * o.oz * 1.05;
    puff(x, s.y + 0.25, z, { color: 0xb8a890, size: 0.7 * size, grow: 2.2, life: 0.9 + Math.random() * 0.5, opacity: 0.4, vy: 0.7, drag: 1.5 });
  }
}
function steam(s) {
  const o = s.silo.o;
  if (o.lite) return;                                               // a run of walls would fog the whole line
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) puff(s.x + sx * o.ix, s.y + 0.2, s.z + sz * o.iz, { color: 0xe6edf2, size: 0.5, grow: 2.6, life: 0.8, opacity: 0.5, vy: 2.2, drag: 1.2 });
}

function pose(s) {
  const si = s.silo, t = si.t, sg = si.seg;
  const a = smooth(seg(t, sg.a)), b = smooth(seg(t, sg.b)), c = smooth(seg(t, sg.c)), e = smooth(seg(t, sg.e));
  STOW[s.type]?.(s, si.from, b);
  const off = -si.depth * c;
  s.mesh.position.y = s.baseY + off;
  si.platform.position.y = off;
  for (const r of si.rods) r.rotation.y = c * si.depth * 5;
  si.doors.forEach((d, k) => {
    const u = seg(t, k === 0 ? sg.d0 : sg.d1), shut = u * u * (0.35 + 0.65 * u);      // swing accelerates into the slam
    d.pivot.rotation.z = d.side * (Math.PI / 2) * (1 - shut);
  });
  if (si.hub) si.hub.rotation.y = e * Math.PI * 2.5;
  for (const h of si.doorBolts) { h.rotation.y = e * 9; h.position.y = 0.05 * (1 - e); }
  for (const bt of si.bolts) { bt.head.rotation.y = (a - e) * 11; bt.head.position.y = 0.08 * (a - e); }
  const live = t > 0 && t < si.T;
  for (const l of si.beacons) { l.visible = live; if (live) l.rotation.y = state.time * 9; }
}

function begin(s, target, rate) {
  const live = capture(s, false);                                   // read the pose before measuring disturbs it
  if (!s.silo) s.silo = buildSilo(s, stowedHeight(s));
  const si = s.silo;
  si.target = target > 0 ? si.T : 0;
  si.rate = rate;
  si.from = target === 0 || si.t > si.seg.b[0] ? capture(s, true) : live;   // retract from wherever the guns point; deploy to rest
  return si;
}

function finishDeploy(s) {
  const si = s.silo;
  openHole(s, false);
  dust(s, si.o.lite ? 3 : 8);
  si.geo.lining.dispose(); si.geo.cap.dispose();
  s.silo = null;
  s.elev = 0; s.recall = s.castOff = false;
}

// Closed hatches left behind by sold buildings: they sink out of sight, then the ground closes over them.
const orphans = [];

export const retract = {
  // A freshly placed building starts locked down and deploys straight away.
  install(s) {
    const si = begin(s, 0, BUILD_RATE);
    si.t = si.T;
    si.works.visible = false;
    s.buried = true;
    s.mesh.visible = false;
    openHole(s, true);
    pose(s);
  },
  retract(s) { if (!s.selling && !(s.silo && s.silo.target > 0) && !s.pending) { s.pending = true; if (s.def?.kind === 'heli' && !s.evac) s.recall = true; if (s.def?.kind === 'airship') s.castOff = true; } },
  deploy(s) { if (s.selling) return; s.pending = false; if (s.silo) begin(s, 0, DROP_RATE); else s.recall = s.castOff = false; },
  toggle(s) { if (s.pending || (s.silo && s.silo.target > 0)) this.deploy(s); else this.retract(s); },
  sell(s, done) { s.onDown = done; s.pending = true; if (s.def?.kind === 'heli') s.recall = true; if (s.def?.kind === 'airship') s.castOff = true; },
  isDown: (s) => !!s.silo && s.silo.t >= s.silo.T,
  // Cinematics: put a building straight into either end state with no animation (then retract() / deploy() from there).
  snap(s, down) {
    if (!down) { if (s.silo) { s.silo.t = 0; s.silo.target = 0; pose(s); s.buried = false; s.mesh.visible = true; state.flowDirty = true; finishDeploy(s); } return; }
    const si = begin(s, 1, DROP_RATE);
    si.t = si.T;
    si.works.visible = false;
    s.buried = true; s.mesh.visible = false; s.pending = false; state.flowDirty = true;
    quiet(s);
    openHole(s, true);
    pose(s);
  },
  label(s) {
    if (s.pending) return s.def?.kind === 'heli' ? 'RECALLING…' : s.def?.kind === 'airship' ? 'CASTING OFF…' : 'STANDBY…';
    return s.silo && s.silo.target > 0 ? 'DEPLOY' : 'RETRACT';
  },

  // Per structure, every frame. Returns true while the building is anything other than fully deployed.
  update(s, dt) {
    if (s.pending && ready(s)) {
      s.pending = false;
      quiet(s);
      begin(s, 1, DROP_RATE);
      openHole(s, true);
      dust(s, s.silo.o.lite ? 2 : 6);
    }
    const si = s.silo;
    if (!si) return false;
    const prev = si.t, sg = si.seg;
    si.t = si.target > si.t ? Math.min(si.target, si.t + dt * si.rate) : Math.max(si.target, si.t - dt * si.rate);
    const t = si.t, crossed = (x) => (prev < x) !== (t < x), down = t > prev;
    if (crossed(sg.c[0])) { if (down) { steam(s); audio.play('silo_servo', { x: s.x, z: s.z, vol: 0.3 }); } else { dust(s, 4); audio.play('blast_door', { x: s.x, z: s.z, vol: 0.2 }); } }
    if (crossed(sg.c[1]) && !down) { steam(s); audio.play('silo_servo', { x: s.x, z: s.z, vol: 0.3 }); }
    if (crossed(sg.d1[1])) {                                        // doors meet / doors part
      s.buried = down;
      s.mesh.visible = !down;
      si.works.visible = !down;
      state.flowDirty = true;
      if (down) { dust(s, si.o.lite ? 4 : 12, 1.3); burst(s.x, s.y + 0.3, s.z, 'soil', si.o.lite ? 2 : 6, 5); audio.play('blast_door', { x: s.x, z: s.z, vol: 0.3 }); }
      else audio.play('silo_doors', { x: s.x, z: s.z, vol: 0.3 });
    }
    s.bar.visible = false;
    pose(s);
    if (t <= 0 && si.target === 0) { finishDeploy(s); return false; }
    if (t >= si.T && s.onDown) { const done = s.onDown; s.onDown = null; done(); }
    return true;
  },

  // Structure is gone (sold or destroyed): whatever is left of its silo sinks away and the ground closes.
  drop(s) {
    const si = s.silo;
    if (!si) return;
    s.silo = null;
    if (si.holeOpen) orphans.push({ si, s: { x: s.x, y: s.y, z: s.z, silo: si }, t: 0 });
  },
  tick(dt) {
    for (let k = orphans.length - 1; k >= 0; k--) {
      const o = orphans[k];
      o.t += dt;
      o.si.group.position.y = o.s.y - 0.7 * smooth(Math.min(1, o.t / 0.6));
      if (o.t >= 0.6) {
        openHole(o.s, false);
        dust(o.s, o.si.o.lite ? 3 : 8);
        o.si.geo.lining.dispose(); o.si.geo.cap.dispose();
        orphans.splice(k, 1);
      }
    }
  },
};
