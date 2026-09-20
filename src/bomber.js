import * as THREE from 'three';
import { heightAt, EXTENT } from './terrain.js';
import { FLAT } from './config.js';
import { log } from './game.js';
import { explode } from './effects.js';
import { puff } from './particles.js';
import { audio } from './audio.js';
import { bevelBox, worn } from './surface.js';

// Strategic bomber: a big white six-engined delta (long forward fuselage with canards, drooped wingtips, twin fins,
// boxy engine nacelle) that crosses the whole map along a player-chosen line, laying a stick of heavy bombs.
const mats = {
  skin: new THREE.MeshStandardMaterial({ color: 0xe8ebee, roughness: 0.32, metalness: 0.35, side: THREE.DoubleSide }),
  panel: new THREE.MeshStandardMaterial({ color: 0xc3c9cf, roughness: 0.4, metalness: 0.4, side: THREE.DoubleSide }),
  dark: new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: 0.55, metalness: 0.5, side: THREE.DoubleSide }),
  glass: new THREE.MeshStandardMaterial({ color: 0x0c1720, roughness: 0.1, metalness: 0.9 }),
  metal: new THREE.MeshStandardMaterial({ color: 0x5a5f66, roughness: 0.4, metalness: 0.85 }),
  stripe: new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.5, metalness: 0.2, side: THREE.DoubleSide }),
  glow: new THREE.MeshStandardMaterial({ color: 0xffb060, emissive: 0xff7a20, emissiveIntensity: 3.5 }),
  flame: new THREE.MeshBasicMaterial({ color: 0xff9a3a, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false }),
  flameCore: new THREE.MeshBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }),
  navRed: new THREE.MeshStandardMaterial({ color: 0xff2020, emissive: 0xff2020, emissiveIntensity: 3 }),
  navGreen: new THREE.MeshStandardMaterial({ color: 0x20ff40, emissive: 0x20ff40, emissiveIntensity: 3 }),
  bomb: new THREE.MeshStandardMaterial({ color: 0x3d4a2a, roughness: 0.55, metalness: 0.3 }),
  bombBand: new THREE.MeshStandardMaterial({ color: 0xe0b020, roughness: 0.5, metalness: 0.2 }),
  bombFin: new THREE.MeshStandardMaterial({ color: 0x23271c, roughness: 0.6, metalness: 0.4, side: THREE.DoubleSide }),
};
for (const k of ['skin', 'panel', 'stripe']) worn(mats[k], { grime: 0.2, chips: 0.12, scale: 0.3 });
for (const k of ['dark', 'metal', 'bomb']) worn(mats[k], { grime: 0.12, chips: 0.15, rough: 0.35 });

const flat = (pts, depth, bevel = 0.03) => {                  // shape in (x, z-forward), extruded downward
  const s = new THREE.Shape();
  pts.forEach(([x, z], k) => (k ? s.lineTo(x, z) : s.moveTo(x, z)));
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: bevel * 0.6, bevelSize: bevel, bevelSegments: 1 });
  g.rotateX(Math.PI / 2);
  return g;
};
const upright = (pts, depth) => {                             // shape in (z-forward, y-up), extruded sideways
  const s = new THREE.Shape();
  pts.forEach(([z, y], k) => (k ? s.lineTo(z, y) : s.moveTo(z, y)));
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.03, bevelSegments: 1 });
  g.rotateY(-Math.PI / 2);
  g.translate(depth / 2, 0, 0);
  return g;
};

let G = null;
function geometry() {
  if (G) return G;
  const HINGE = 3.4, LE = (x) => 3.0 - (9.4 / 5.5) * x;        // leading edge sweep: apex z=3, tip x=5.5
  const neck = new THREE.LatheGeometry([[0, 10.2], [0.13, 9.8], [0.3, 9.0], [0.45, 7.8], [0.54, 6.2], [0.6, 3.0], [0.62, -1.5], [0.55, -4.5], [0.38, -6.4], [0.16, -7.4], [0, -7.5]]
    .map(([r, y]) => new THREE.Vector2(r, y)), 24);
  neck.rotateX(Math.PI / 2);
  neck.scale(1, 1.12, 1);
  G = {
    neck,
    wingInner: flat([[0, 3.0], [HINGE, LE(HINGE)], [HINGE, -7.0], [0, -7.0]], 0.2, 0.05),
    wingTip: flat([[0, LE(HINGE)], [2.1, LE(5.5)], [2.1, -7.0], [0, -7.0]], 0.13, 0.04),
    elevon: flat([[0.3, -6.35], [HINGE - 0.1, -6.35], [HINGE - 0.1, -7.05], [0.3, -7.05]], 0.06, 0.01),
    canard: flat([[0.35, 6.9], [2.0, 5.55], [2.0, 5.1], [0.35, 5.3]], 0.08, 0.025),
    fin: upright([[-3.6, 0], [-6.2, 2.3], [-7.1, 2.3], [-7.0, 0]], 0.1),
    finStripe: upright([[-6.0, 1.75], [-6.98, 1.75], [-7.04, 2.05], [-6.27, 2.05]], 0.125),
    nacelle: bevelBox(3.0, 0.95, 8.4),
    nacelleTaper: bevelBox(3.0, 0.5, 2.2),
    splitter: upright([[2.9, -0.95], [0.6, -0.95], [0.6, 0], [1.2, 0]], 0.16),
    ramp: flat([[-1.5, 1.2], [1.5, 1.2], [1.5, 2.9], [-1.5, 2.9]], 0.05, 0.01),
    intake: bevelBox(1.3, 0.78, 0.12),
    bay: bevelBox(1.5, 0.06, 3.4),
    nozzle: new THREE.CylinderGeometry(0.235, 0.2, 0.75, 14, 1, true).rotateX(Math.PI / 2),
    nozzleGlow: new THREE.CircleGeometry(0.19, 14),
    flame: new THREE.ConeGeometry(0.2, 3.2, 10, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -1.6),
    flameCore: new THREE.ConeGeometry(0.1, 1.9, 8, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -0.95),
    windscreen: new THREE.SphereGeometry(0.4, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    glare: flat([[-0.16, 9.7], [0.16, 9.7], [0.3, 8.2], [-0.3, 8.2]], 0.02, 0.005),
    spine: bevelBox(0.5, 0.18, 6.5),
    nav: new THREE.SphereGeometry(0.09, 8, 6),
    bombBody: new THREE.CapsuleGeometry(0.26, 0.9, 6, 12).rotateX(Math.PI / 2),
    bombBand: new THREE.CylinderGeometry(0.268, 0.268, 0.14, 12).rotateX(Math.PI / 2),
    bombFin: bevelBox(0.03, 0.62, 0.5),
    bombRing: new THREE.CylinderGeometry(0.3, 0.3, 0.22, 12, 1, true).rotateX(Math.PI / 2),
  };
  return G;
}

export function makeBomber() {
  const g = geometry();
  const root = new THREE.Group();
  const add = (geo, mat, x = 0, y = 0, z = 0, parent = root) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };

  add(g.neck, mats.skin, 0, 0.42, 0);
  add(g.spine, mats.panel, 0, 1.0, -2.5);
  add(g.glare, mats.dark, 0, 1.0, 0).rotation.x = 0.06;
  const ws = add(g.windscreen, mats.glass, 0, 0.66, 8.0);
  ws.scale.set(0.95, 0.75, 2.1);
  add(new THREE.ConeGeometry(0.13, 0.5, 12).rotateX(Math.PI / 2), mats.dark, 0, 0.42, 10.1);
  add(new THREE.CylinderGeometry(0.012, 0.02, 1.0, 5).rotateX(Math.PI / 2), mats.metal, 0, 0.42, 10.8);

  const flames = [];
  for (const s of [1, -1]) {                                   // each side is built once and mirrored
    const side = new THREE.Group();
    side.scale.x = s;
    root.add(side);
    add(g.wingInner, mats.skin, 0, 0.12, 0, side);
    add(g.elevon, mats.panel, 0, 0.135, 0, side);
    const tip = new THREE.Group();                             // outer panel droops about the hinge line
    tip.position.set(3.4, 0.1, 0);
    tip.rotation.z = -0.44;
    add(g.wingTip, mats.skin, 0, 0, 0, tip);
    add(g.nav, s > 0 ? mats.navGreen : mats.navRed, 2.1, -0.06, -6.6, tip);
    side.add(tip);
    add(g.canard, mats.skin, 0, 0.62, 0, side);
    add(g.fin, mats.skin, 1.2, 0.1, 0, side);
    add(g.finStripe, mats.stripe, 1.2, 0.1, 0, side);
  }

  // engine nacelle: twin intakes either side of a splitter, six afterburning engines in a row
  add(g.nacelle, mats.skin, 0, -0.52, -2.75);
  add(g.nacelleTaper, mats.panel, 0, -0.3, -6.0);
  add(g.splitter, mats.skin, 0, 0, 0);
  add(g.ramp, mats.panel, 0, -0.97, 0);
  for (const x of [-0.78, 0.78]) add(g.intake, mats.dark, x, -0.52, 1.46);
  add(g.bay, mats.dark, 0, -1.0, -2.6);
  for (let k = 0; k < 6; k++) {
    const x = (k - 2.5) * 0.47;
    add(g.nozzle, mats.metal, x, -0.5, -7.2);
    add(g.nozzleGlow, mats.glow, x, -0.5, -7.0).rotation.y = Math.PI;
    const f = new THREE.Group();
    f.position.set(x, -0.5, -7.5);
    f.add(new THREE.Mesh(g.flame, mats.flame), new THREE.Mesh(g.flameCore, mats.flameCore));
    root.add(f);
    flames.push(f);
  }
  root.scale.setScalar(1.15);
  root.name = 'bomber';
  root.userData = { flames };
  return root;
}

function makeBomb() {
  const g = geometry();
  const b = new THREE.Group();
  const body = new THREE.Mesh(g.bombBody, mats.bomb);
  body.castShadow = true;
  b.add(body);
  const band = new THREE.Mesh(g.bombBand, mats.bombBand);
  band.position.z = 0.42;
  b.add(band);
  for (let k = 0; k < 4; k++) {
    const fin = new THREE.Mesh(g.bombFin, mats.bombFin);
    fin.position.z = -0.72;
    fin.rotation.z = k * Math.PI / 4;
    b.add(fin);
  }
  const ring = new THREE.Mesh(g.bombRing, mats.bombFin);
  ring.position.z = -0.84;
  b.add(ring);
  b.scale.setScalar(1.45);                                   // heavy ordnance: easy to follow all the way down
  return b;
}

// Where the line through (ax, az) along (dx, dz) leaves the square |x|,|z| <= lim, as [tMin, tMax].
export function lineSpan(ax, az, dx, dz, lim) {
  let lo = -Infinity, hi = Infinity;
  for (const [p, d] of [[ax, dx], [az, dz]]) {
    if (Math.abs(d) < 1e-6) continue;
    const t1 = (-lim - p) / d, t2 = (lim - p) / d;
    lo = Math.max(lo, Math.min(t1, t2)); hi = Math.min(hi, Math.max(t1, t2));
  }
  return [lo, hi];
}

const SPEED = 38, ALT = 44, GRAV = 26, SPACING = 4.6;
const _q = new THREE.Vector3();

export function bombingRun(scene, ax, az, dx, dz, width) {
  const px = -dz, pz = dx;
  const [m0, m1] = lineSpan(ax, az, dx, dz, EXTENT);             // whole map, for the flight
  const [b0, b1] = lineSpan(ax, az, dx, dz, FLAT + 4);           // where bombs are worth dropping
  const y0 = heightAt(0, 0) + ALT;
  const plane = makeBomber();
  scene.add(plane);
  const drops = [];
  for (let s = b0 + 2, k = 0; s <= b1 - 2; s += SPACING, k++) {
    const side = (k % 2 ? 1 : -1) * (width * 0.22 + Math.random() * width * 0.2);
    const tx = ax + dx * s + px * side, tz = az + dz * s + pz * side;
    const fall = Math.sqrt(Math.max(0.2, 2 * (y0 - 1.2 - heightAt(tx, tz)) / GRAV));
    drops.push({ at: s - SPEED * fall, side, fall });            // release early: the bomb keeps the aircraft's speed
  }
  drops.sort((a, b) => a.at - b.at);
  const bombs = [];
  let a = m0 - 70, next = 0, trail = 0, whistle = 0;
  const end = m1 + 120;
  const engine = audio.loop('hub_thruster', { x: ax, z: az, vol: 0.7 });
  audio.play('jet_flyby', { x: ax, z: az, vol: 0.9 });
  log(`Strategic bomber inbound: ${drops.length} bombs!`, true);

  return {
    update(dt) {
      a += SPEED * dt;
      const x = ax + dx * a, z = az + dz * a;
      const out = Math.max(0, a - b1 - 25), climb = Math.min(0.3, out * 0.004);        // bombs gone: ease into a climb-out
      plane.position.set(x, y0 + Math.sin(a * 0.05) * 0.6 + (out < 75 ? out * out * 0.002 : 11.25 + (out - 75) * 0.3), z);
      plane.lookAt(x + dx, plane.position.y + climb, z + dz);
      plane.rotateZ(Math.sin(a * 0.08) * 0.04);
      for (const f of plane.userData.flames) f.scale.set(1, 1, 0.8 + Math.random() * 0.45);
      if (engine) engine.setPos(x, z);
      trail += dt;
      if (trail > 0.035 && a < end - 20) {
        trail = 0;
        for (const sx of [-1.1, 1.1]) {
          plane.localToWorld(_q.set(sx, -0.5, -9.5));
          puff(_q.x, _q.y, _q.z, { color: 0xeeeae6, size: 1.2, grow: 2.6, life: 2.2, opacity: 0.3, drag: 0.4 });
        }
      }
      while (next < drops.length && a >= drops[next].at) {
        const d = drops[next++];
        const m = makeBomb();
        plane.localToWorld(_q.set(Math.sign(d.side) * 0.35, -1.4, -2.6 + Math.random()));      // out of the belly bay
        m.position.copy(_q);
        scene.add(m);
        const drift = d.side / d.fall;                                 // eased sideways so the stick covers the strip's width
        bombs.push({ m, vx: dx * SPEED + px * drift, vy: -1.5, vz: dz * SPEED + pz * drift, wob: Math.random() * 6 });
      }
      whistle -= dt;
      for (let k = bombs.length - 1; k >= 0; k--) {
        const b = bombs[k], p = b.m.position;
        b.vy -= GRAV * dt;
        p.x += b.vx * dt; p.y += b.vy * dt; p.z += b.vz * dt;
        b.wob += dt * 5;
        b.m.lookAt(p.x + b.vx, p.y + b.vy, p.z + b.vz);             // nose follows the fall
        b.m.rotateZ(b.wob * 0.6);
        b.m.rotateX(Math.sin(b.wob) * 0.05);
        const ground = heightAt(p.x, p.z);
        if (p.y - ground < 14 && !b.sang && whistle <= 0) { b.sang = true; whistle = 0.35; audio.play('artillery_whistle', { x: p.x, z: p.z, vol: 0.55 }); }
        if (p.y <= ground + 0.3) {
          explode(p.x, p.z, 2.5, 187, 5.72, { shake: 0.28, smoke: 9 });
          scene.remove(b.m);
          bombs.splice(k, 1);
        }
      }
      if (a > end && bombs.length === 0) {
        scene.remove(plane);
        if (engine) engine.stop();
        return false;
      }
      return true;
    },
  };
}
