import * as THREE from 'three';
import { heightAt } from './terrain.js';
import { iconImg } from './icons.js';
import { state, damageEnemy, eachEnemy, burst, log } from './game.js';
import { flame } from './flame.js';
import { spawnScorch, spawnScar } from './decals.js';
import { puff, killPuff, updateParticles } from './particles.js';
import { explode, impactRing, damageCircle } from './effects.js';
import { audio } from './audio.js';
import { troopers } from './troopers.js';
import { bombingRun, lineSpan } from './bomber.js';
import { EXTENT } from './terrain.js';
import { strategicStrike } from './strategic.js';
import { blackHoleBomb } from './blackhole.js';

// ---------------------------------------------------------------- definitions
export const ABILITIES = {
  laser:     { name: 'Orbital Laser',    key: '1', cooldown: 20, radius: 1.65, desc: 'Sustained beam that follows your cursor for 6 s.' },
  lance:     { name: 'Orbital Lance',    key: '2', cooldown: 25, radius: 5.5, desc: 'Orbital beams converge into one devastating strike.' },
  strafe:    { name: 'Strafing Run',     key: '3', cooldown: 25, length: 24, width: 6.6, desc: 'Three jets rake a long strip with rockets and cannon fire.' },
  artillery: { name: 'Artillery Strike', key: '4', cooldown: 25, radius: 7.6, desc: 'Two dozen HE shells rain across the area.' },
  troopers:  { name: 'Shock Troopers',   key: '5', cooldown: 60, radius: 7,  desc: 'Five drop pods slam down and unload three troopers each. Drag to select them, click to move.' },
  bomber:    { name: 'Strategic Bomber', key: '6', cooldown: 90, width: 9.9, line: true, desc: 'Click a point, then a direction: a heavy bomber carpets that line across the entire map.' },
  nuke:      { name: 'Tactical Nuke',    key: '7', cooldown: 60, radius: 13.2, desc: '10 s countdown, then an ICBM levels the whole area. Bugs in the outer ring are set ablaze for 5 s.' },
  archangel: { name: 'Archangel Lance',  key: '8', cooldown: 60, radius: 13.2, desc: 'The ultimate orbital strike: a dozen beams spiral inward and merge into one colossal lance that swells until it detonates.' },
  // global: nothing to aim (ground zero is the centre of the map). It arms like the rest and any click on the map
  // launches it; `hint` is the prompt that rides above the cursor while it is armed.
  blackhole: { name: 'Micro-Singularity Gravity Bomb', key: '9', cooldown: 45, radius: 9, desc: 'A bomb opens a singularity that drags every bug in the area in, crushing the small ones and holding the rest in orbit, then collapses and spits the survivors back out.' },
  strategic: { name: 'Strategic Nuclear Strike', key: '0', cooldown: 300, global: true, hint: 'INITIATE STRATEGIC LAUNCH', desc: 'Last resort. Click anywhere on the map to launch. Every structure retracts into its silo, then a 10 s countdown and a giant ICBM hits the centre of the map: everything on the surface dies. The base redeploys once the cloud clears.' },
};

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3(), _w = new THREE.Vector3();
const rnd = (a = 0, b = 1) => a + Math.random() * (b - a);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const easeOut = (p) => 1 - Math.pow(1 - clamp01(p), 3);

const ab = { scene: null, ui: null, camera: null, controls: null, cine: null, armed: null, anchor: null, cooldowns: {}, effects: [], reticle: null, hover: null, laser: null, buttons: {} };

// ---------------------------------------------------------------- terrain-draped shapes
function gridGeo(nu, nv, fn, lift = 0.12) {
  const pos = new Float32Array((nu + 1) * (nv + 1) * 3);
  const idx = [];
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const [x, z] = fn(i / nu, j / nv);
      const k = (j * (nu + 1) + i) * 3;
      pos[k] = x; pos[k + 1] = heightAt(x, z) + lift; pos[k + 2] = z;
    }
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  return geo;
}
const discGeo = (cx, cz, r) => gridGeo(48, 4, (u, v) => [cx + Math.cos(u * Math.PI * 2) * v * r, cz + Math.sin(u * Math.PI * 2) * v * r]);
const ringGeo = (cx, cz, r, w) => gridGeo(64, 1, (u, v) => { const rr = r - w + v * w; return [cx + Math.cos(u * Math.PI * 2) * rr, cz + Math.sin(u * Math.PI * 2) * rr]; });
function rectGeo(cx, cz, dx, dz, len, wid) {
  const px = -dz, pz = dx;
  return gridGeo(16, 4, (u, v) => [cx + dx * (u - 0.5) * len + px * (v - 0.5) * wid, cz + dz * (u - 0.5) * len + pz * (v - 0.5) * wid]);
}
function rectBandGeo(cx, cz, dx, dz, len, wid, w) {
  const px = -dz, pz = dx;
  const hl = len / 2, hw = wid / 2, per = 2 * (len + wid);
  return gridGeo(80, 1, (u, v) => {
    let d = u * per, a, b, nx, nz;
    if (d < len) { a = -hl + d; b = -hw; nx = 0; nz = -1; }
    else if (d < len + wid) { a = hl; b = -hw + (d - len); nx = 1; nz = 0; }
    else if (d < 2 * len + wid) { a = hl - (d - len - wid); b = hw; nx = 0; nz = 1; }
    else { a = -hl; b = hw - (d - 2 * len - wid); nx = -1; nz = 0; }
    const off = -w + v * w;
    a += nx * off; b += nz * off;
    return [cx + dx * a + px * b, cz + dz * a + pz * b];
  });
}
const fillMat = (color) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide, fog: false });
const bandMat = (color) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, fog: false });

// ---------------------------------------------------------------- effect building blocks
function makeBeam(color, r) {
  const g = new THREE.Group();
  const inner = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.35, r * 0.35, 1, 8, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  const outer = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1, 12, 1, true),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide }));
  g.add(inner, outer);
  g.userData.w = 1;
  return g;
}
function setBeam(g, from, to, w = 1) {
  _v.subVectors(to, from);
  const len = _v.length();
  g.position.copy(from).addScaledVector(_v, 0.5);
  g.quaternion.setFromUnitVectors(UP, _v.normalize());
  g.scale.set(w, len, w);
}
function disposeGroup(g) {
  ab.scene.remove(g);
  g.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } if (o.isSprite) o.material.dispose(); });
}

function textSprite(size = 6) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const tex = new THREE.CanvasTexture(c);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, fog: false }));
  s.scale.set(size, size / 2, 1);
  s.userData.set = (text, color) => {
    const g = c.getContext('2d');
    g.clearRect(0, 0, 256, 128);
    g.font = 'bold 96px "Segoe UI", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 8; g.strokeStyle = 'rgba(0,0,0,0.8)'; g.strokeText(text, 128, 64);
    g.fillStyle = color; g.fillText(text, 128, 64);
    tex.needsUpdate = true;
  };
  return s;
}

// ---------------------------------------------------------------- Orbital Lance
function orbitalLance(x, z, R) {
  const y = heightAt(x, z);
  const beams = [];
  const N = 5;
  for (let k = 0; k < N; k++) {
    const b = makeBeam(0x66d8ff, 0.14);
    ab.scene.add(b);
    const g = puff(x, y + 0.2, z, { color: 0x9fe8ff, size: 1.2, life: 99, opacity: 0.9, additive: true, priority: true });
    beams.push({ b, g, a: (k / N) * Math.PI * 2 });
  }
  const ring = new THREE.Mesh(ringGeo(x, z, R, 0.25), bandMat(0x7fe0ff));
  const fill = new THREE.Mesh(discGeo(x, z, R), fillMat(0x7fe0ff));
  ab.scene.add(ring, fill);
  const main = makeBeam(0xaee8ff, 1.5);
  main.visible = false;
  ab.scene.add(main);
  const T_HIT = 1.7;
  let t = 0, fired = false;
  const from = new THREE.Vector3(), to = new THREE.Vector3();
  log('Orbital Lance charging...');
  audio.play('lance_charge', { x, z });
  return {
    update(dt) {
      t += dt;
      const p = clamp01(t / T_HIT);
      const r = R * (1 - easeOut(p));
      for (const bm of beams) {
        const ang = bm.a + t * 2.2;
        to.set(x + Math.cos(ang) * r, heightAt(x + Math.cos(ang) * r, z + Math.sin(ang) * r) + 0.1, z + Math.sin(ang) * r);
        from.set(x + Math.cos(ang) * (r + 6), 150, z + Math.sin(ang) * (r + 6));
        setBeam(bm.b, from, to, t < T_HIT ? 1 : Math.max(0, 1 - (t - T_HIT) * 4));
        bm.g.position.copy(to);
        bm.g.scale.setScalar(1.2 + Math.random() * 0.4);
        if (t < T_HIT && Math.random() < 0.5) puff(to.x, to.y + 0.2, to.z, { color: 0x9fe8ff, size: 0.5, life: 0.4, opacity: 0.8, additive: true, vy: rnd(1, 3), vx: rnd(-1, 1), vz: rnd(-1, 1) });
      }
      fill.material.opacity = 0.16 + 0.25 * p * (0.6 + 0.4 * Math.sin(t * 25));
      if (t >= T_HIT && !fired) {
        fired = true;
        main.visible = true;
        audio.play('lance_impact', { x, z });
        explode(x, z, 3.2, 572, R * 1.1, { color: 0x7fd0ff, shake: 1.3, smoke: 14 });
        for (let k = 0; k < 24; k++) {
          const a = rnd(0, Math.PI * 2), sp = rnd(8, 14);
          puff(x, y + 0.4, z, { color: 0xc9a070, size: 1.5, grow: 2.5, life: 1.3, opacity: 0.6, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: rnd(1, 2), drag: 2 });
        }
        log('Orbital Lance impact!', true);
      }
      if (fired) {
        const k = clamp01((t - T_HIT) / 1.0);
        from.set(x + 2, 160, z - 1.5); to.set(x, y, z);
        setBeam(main, from, to, (1 - k) * (0.85 + Math.random() * 0.3));
        ring.material.opacity = 0.9 * (1 - k);
        fill.material.opacity = 0.35 * (1 - k);
        for (const bm of beams) bm.g.material.opacity = 0.9 * (1 - k);
      }
      if (t >= T_HIT + 1.05) {
        for (const bm of beams) { disposeGroup(bm.b); killPuff(bm.g); }
        disposeGroup(main);
        ab.scene.remove(ring, fill); ring.geometry.dispose(); fill.geometry.dispose(); ring.material.dispose(); fill.material.dispose();
        return false;
      }
      return true;
    },
  };
}

// ---------------------------------------------------------------- Orbital Laser (cursor guided)
function orbitalLaser(x, z) {
  const P = new THREE.Vector3(x, heightAt(x, z), z);
  const T = new THREE.Vector3(x, 0, z);
  const beam = makeBeam(0x5fd6ff, 0.32);
  ab.scene.add(beam);
  const glow = puff(x, P.y + 0.3, z, { color: 0xbff4ff, size: 2.2, life: 99, opacity: 0.95, additive: true, priority: true });
  const DUR = 6;
  let t = 0, scorchT = 0, sndT = 0;
  const snd = audio.loop('orbital_laser', { x, z });
  const from = new THREE.Vector3();
  const fx = { update(dt) {
    t += dt;
    _w.set(T.x - P.x, 0, T.z - P.z);
    const d = _w.length();
    const step = Math.min(d, 10 * dt);
    if (d > 1e-3) { P.x += _w.x / d * step; P.z += _w.z / d * step; }
    P.y = heightAt(P.x, P.z);
    const w = t < 0.3 ? t / 0.3 : t > DUR - 0.4 ? clamp01((DUR - t) / 0.4) : 1;
    from.set(P.x + 4, 150, P.z - 3);
    setBeam(beam, from, P, w * (0.9 + Math.random() * 0.25));
    glow.position.set(P.x, P.y + 0.3, P.z);
    glow.scale.setScalar((2 + Math.random() * 0.6) * w);
    for (let k = 0; k < 2; k++) puff(P.x, P.y + 0.2, P.z, { color: 0xffb060, size: 0.35, life: rnd(0.3, 0.6), opacity: 0.9, additive: true, vx: rnd(-4, 4), vz: rnd(-4, 4), vy: rnd(2, 6), grav: 12, drag: 0.5 });
    if (Math.random() < 0.5) puff(P.x, P.y + 0.4, P.z, { color: 0x3a342e, size: 0.8, grow: 1.5, life: 1.2, opacity: 0.4, vy: rnd(1.5, 3), drag: 1 });
    scorchT += dt;
    if (scorchT > 0.2) { scorchT = 0; spawnScorch(ab.scene, P.x, P.z, 1.3); }
    sndT += dt;
    if (snd && sndT > 0.25) { sndT = 0; snd.setPos(P.x, P.z); }
    damageCircle(P.x, P.z, 1.76, 82.5 * dt * w, 0.6);
    if (t >= DUR) { disposeGroup(beam); killPuff(glow); if (snd) snd.stop(); ab.laser = null; return false; }
    return true;
  }, guide(p) { T.set(p.x, 0, p.z); } };
  ab.laser = fx;
  log('Orbital Laser online. Guide it with the cursor.');
  return fx;
}

// ---------------------------------------------------------------- Strafing Run
const jetMats = {
  hull: new THREE.MeshStandardMaterial({ color: 0x7d8590, roughness: 0.42, metalness: 0.55 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x353b44, roughness: 0.55, metalness: 0.5 }),
  radome: new THREE.MeshStandardMaterial({ color: 0x4b515a, roughness: 0.6, metalness: 0.2 }),
  black: new THREE.MeshStandardMaterial({ color: 0x0e1013, roughness: 0.7, metalness: 0.3 }),
  missile: new THREE.MeshStandardMaterial({ color: 0xd8dde2, roughness: 0.45, metalness: 0.3 }),
  canopy: new THREE.MeshPhysicalMaterial({ color: 0x142c38, roughness: 0.08, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05, emissive: 0x0b1f2a, emissiveIntensity: 0.5 }),
  flame: new THREE.MeshBasicMaterial({ color: 0xff8a30, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
  flameCore: new THREE.MeshBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
  navRed: new THREE.MeshStandardMaterial({ color: 0xff2020, emissive: 0xff2020, emissiveIntensity: 3 }),
  navGreen: new THREE.MeshStandardMaterial({ color: 0x20ff40, emissive: 0x20ff40, emissiveIntensity: 3 }),
};

// Geometry is built once and shared by every jet.
let jetGeo = null;
function jetGeometry() {
  if (jetGeo) return jetGeo;
  const profile = [[0, 3.3], [0.11, 3.0], [0.24, 2.4], [0.36, 1.6], [0.44, 0.7], [0.46, -0.3], [0.43, -1.3], [0.37, -2.2], [0.3, -2.8], [0.26, -3.05], [0, -3.05]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  const fuselage = new THREE.LatheGeometry(profile, 22);
  fuselage.scale(1.15, 1, 0.82);
  fuselage.rotateX(Math.PI / 2);
  const wing = new THREE.Shape();
  wing.moveTo(0.3, 2.1); wing.lineTo(0.95, 0.85); wing.lineTo(2.75, -0.75); wing.lineTo(2.75, -1.3); wing.lineTo(0.3, -1.55); wing.lineTo(0.3, 2.1);
  const wingGeo = new THREE.ExtrudeGeometry(wing, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.03, bevelSegments: 1 });
  wingGeo.rotateX(Math.PI / 2);
  const tail = new THREE.Shape();
  tail.moveTo(0.28, -1.75); tail.lineTo(1.45, -2.55); tail.lineTo(1.45, -2.95); tail.lineTo(0.28, -2.95); tail.lineTo(0.28, -1.75);
  const tailGeo = new THREE.ExtrudeGeometry(tail, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.02, bevelSegments: 1 });
  tailGeo.rotateX(Math.PI / 2);
  const fin = new THREE.Shape();
  fin.moveTo(-1.5, 0.3); fin.lineTo(-2.05, 1.5); fin.lineTo(-2.65, 1.5); fin.lineTo(-2.95, 0.3); fin.lineTo(-1.5, 0.3);
  const finGeo = new THREE.ExtrudeGeometry(fin, { depth: 0.06, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.02, bevelSegments: 1 });
  finGeo.rotateY(-Math.PI / 2);
  jetGeo = {
    fuselage, wingGeo, tailGeo, finGeo,
    canopy: new THREE.SphereGeometry(0.34, 16, 12),
    intake: new THREE.BoxGeometry(0.5, 0.4, 1.7),
    intakeMouth: new THREE.BoxGeometry(0.4, 0.3, 0.1),
    nozzle: new THREE.CylinderGeometry(0.25, 0.22, 0.7, 12, 1, true),
    nozzleInner: new THREE.CylinderGeometry(0.18, 0.18, 0.05, 12),
    flame: new THREE.ConeGeometry(0.22, 2.4, 10, 1, true),
    flameCore: new THREE.ConeGeometry(0.1, 1.5, 8, 1, true),
    pod: new THREE.CylinderGeometry(0.19, 0.19, 1.1, 12),
    podCap: new THREE.CylinderGeometry(0.19, 0.19, 0.08, 12),
    pylon: new THREE.BoxGeometry(0.08, 0.28, 0.6),
    missile: new THREE.CylinderGeometry(0.065, 0.065, 1.6, 8),
    missileNose: new THREE.ConeGeometry(0.065, 0.3, 8),
    missileFin: new THREE.BoxGeometry(0.02, 0.22, 0.25),
    pitot: new THREE.CylinderGeometry(0.02, 0.02, 0.7, 6),
    navLight: new THREE.SphereGeometry(0.06, 8, 6),
  };
  return jetGeo;
}
function makeJet() {
  const G = jetGeometry();
  const g = new THREE.Group();
  const add = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m; };
  add(G.fuselage, jetMats.hull);
  const radome = add(new THREE.SphereGeometry(0.12, 10, 8), jetMats.radome, 0, 0, 3.22);
  radome.scale.set(1, 1, 2.2);
  const pitot = add(G.pitot, jetMats.dark, 0, 0, 3.75);
  pitot.rotation.x = Math.PI / 2;
  const canopy = add(G.canopy, jetMats.canopy, 0, 0.3, 1.05);
  canopy.scale.set(0.9, 0.7, 2.1);
  const spine = add(new THREE.SphereGeometry(0.3, 12, 8), jetMats.hull, 0, 0.2, -0.9);   // dorsal fairing
  spine.scale.set(0.9, 0.75, 4.6);
  for (const sx of [-1, 1]) {
    const wing = add(G.wingGeo, jetMats.hull, 0, -0.02, 0);
    wing.scale.x = sx; wing.rotation.z = sx * 0.04;
    const tail = add(G.tailGeo, jetMats.dark, 0, 0.05, 0);
    tail.scale.x = sx;
    const finPivot = new THREE.Group();
    finPivot.position.set(sx * 0.32, 0.1, 0);
    finPivot.rotation.z = -sx * 0.32;
    finPivot.add(new THREE.Mesh(G.finGeo, jetMats.dark));
    g.add(finPivot);
    add(G.intake, jetMats.hull, sx * 0.6, -0.18, 0.2);
    add(G.intakeMouth, jetMats.black, sx * 0.6, -0.18, 1.06);
    const nozzle = add(G.nozzle, jetMats.dark, sx * 0.3, -0.05, -3.2);
    nozzle.rotation.x = Math.PI / 2;
    const inner = add(G.nozzleInner, jetMats.black, sx * 0.3, -0.05, -3.5);
    inner.rotation.x = Math.PI / 2;
    const flame = add(G.flame, jetMats.flame, sx * 0.3, -0.05, -4.6);
    flame.rotation.x = -Math.PI / 2;
    const core = add(G.flameCore, jetMats.flameCore, sx * 0.3, -0.05, -4.2);
    core.rotation.x = -Math.PI / 2;
    (g.userData.flames ||= []).push(flame, core);
    add(G.pylon, jetMats.dark, sx * 1.6, -0.22, -0.5);
    const pod = add(G.pod, jetMats.dark, sx * 1.6, -0.42, -0.5);
    pod.rotation.x = Math.PI / 2;
    add(G.podCap, jetMats.radome, sx * 1.6, -0.42, 0.06).rotation.x = Math.PI / 2;
    const missile = add(G.missile, jetMats.missile, sx * 2.8, -0.06, -0.9);
    missile.rotation.x = Math.PI / 2;
    add(G.missileNose, jetMats.dark, sx * 2.8, -0.06, 0.05).rotation.x = Math.PI / 2;
    for (const [fx, fy] of [[0.12, 0], [-0.12, 0], [0, 0.12], [0, -0.12]]) add(G.missileFin, jetMats.dark, sx * 2.8 + fx, -0.06 + fy, -1.55).rotation.z = fy ? Math.PI / 2 : 0;
    const nav = add(G.navLight, sx < 0 ? jetMats.navRed : jetMats.navGreen, sx * 2.78, 0.02, -1.0);
    (g.userData.nav ||= []).push(nav);
  }
  add(new THREE.SphereGeometry(0.05, 8, 6), jetMats.navRed, 0, 0.6, -0.9);   // anti-collision beacon
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

let rocketGeo = null;
function makeRocket() {
  rocketGeo ||= {
    body: new THREE.CylinderGeometry(0.08, 0.08, 0.7, 8),
    nose: new THREE.ConeGeometry(0.08, 0.26, 8),
    fin: new THREE.BoxGeometry(0.02, 0.2, 0.16),
    flame: new THREE.ConeGeometry(0.1, 0.9, 8, 1, true),
  };
  const g = new THREE.Group();
  const add = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m; };
  add(rocketGeo.body, jetMats.missile);
  add(rocketGeo.nose, jetMats.dark, 0, 0.48, 0);
  for (let k = 0; k < 4; k++) { const f = add(rocketGeo.fin, jetMats.dark, Math.cos(k * Math.PI / 2) * 0.1, -0.28, Math.sin(k * Math.PI / 2) * 0.1); f.rotation.y = -k * Math.PI / 2; }
  const flame = add(rocketGeo.flame, jetMats.flame, 0, -0.8, 0);
  flame.rotation.x = Math.PI;
  g.userData.flame = flame;
  return g;
}

function strafingRun(cx, cz, dx, dz, len, wid) {
  const px = -dz, pz = dx;
  const jets = [[0, 0], [-3.5, -4], [3.5, -4]].map(([side, back]) => {
    const j = makeJet();
    ab.scene.add(j);
    return { mesh: j, side, back, rockets: 0, tracerT: 0 };
  });
  const SPEED = 30, HIGH = 30, LOW = 6.5, START = -62, END = 190;   // END: keep flying until they are specks past the map edge
  // Attack profile: dive from altitude onto the strip, level out just past its middle, then climb away.
  const altAt = (a) => { const u = clamp01((Math.abs(a + 2) - 6) / 50); const e = Math.max(0, a - 25); return LOW + (HIGH - LOW) * u * u * (3 - 2 * u) + 0.32 * (e < 40 ? e * e / 80 : e - 20); };   // keeps climbing on the way out
  const base = heightAt(cx, cz);
  const muzzle = new THREE.Vector3();
  let t = 0;
  const along = () => START + SPEED * t;
  const inRect = (a) => a > -len / 2 - 4 && a < len / 2;
  const rockets = [];
  const tracers = [];
  const jetPos = new THREE.Vector3();
  log('Strafing run inbound!');
  audio.play('jet_flyby', { x: cx, z: cz });
  return {
    update(dt) {
      t += dt;
      const a0 = along();
      for (const j of jets) {
        const a = a0 + j.back;
        const gy = heightAt(cx + dx * a, cz + dz * a);
        const alt = altAt(a), climb = (altAt(a + 0.5) - altAt(a - 0.5));      // climb = dy per unit travelled
        jetPos.set(cx + dx * a + px * j.side, Math.max(gy + 5, base + alt), cz + dz * a + pz * j.side);
        j.mesh.position.copy(jetPos);
        j.mesh.lookAt(jetPos.x + dx, jetPos.y + climb, jetPos.z + dz);         // nose follows the flight path
        j.mesh.rotateZ(Math.sin(t * 1.5 + j.side) * 0.08 + j.side * 0.02 * climb * 4);
        for (const f of j.mesh.userData.flames) f.scale.set(1, 0.8 + Math.random() * 0.5, 1);
        const blink = Math.floor(t * 2.5) % 2 === 0;
        for (const n of j.mesh.userData.nav) n.material.emissiveIntensity = blink ? 3 : 0.4;
        j.trailT = (j.trailT || 0) + dt;
        if (j.trailT > 0.03) {
          j.trailT = 0;
          for (const sx of [-1, 1]) {
            _w.set(sx * 0.3, -0.05, -4.2).applyQuaternion(j.mesh.quaternion).add(jetPos);
            puff(_w.x, _w.y, _w.z, { color: 0xe8e4e0, size: 0.5, grow: 1.6, life: 1.4, opacity: 0.35, drag: 0.5 });
          }
        }
        if (inRect(a + 10)) {
          // rockets: four per jet, launched at staggered points along the strip
          const due = Math.floor(clamp01((a + 10 + len / 2 + 4) / (len + 4)) * 4);
          while (j.rockets < due && j.rockets < 4) {
            j.rockets++;
            const ta = a + 10 + rnd(2, 8), tb = rnd(-wid / 2, wid / 2);
            const tx = cx + dx * ta + px * tb, tz = cz + dz * ta + pz * tb;
            const m = makeRocket();
            _v.set(j.rockets % 2 ? 1.6 : -1.6, -0.5, 0).applyQuaternion(j.mesh.quaternion);
            m.position.copy(jetPos).add(_v);
            ab.scene.add(m);
            const target = new THREE.Vector3(tx, heightAt(tx, tz), tz);
            const dir = target.clone().sub(m.position).normalize();
            m.quaternion.setFromUnitVectors(UP, dir);
            rockets.push({ m, dir, target, speed: 40, trail: 0 });
            audio.play('rocket_launch', { x: jetPos.x, z: jetPos.z, vol: 0.7 });
          }
          // autocannon tracers: bursts of rounds into the strip ahead
          j.tracerT -= dt;
          if (j.tracerT <= 0) {
            j.tracerT = 0.045;
            // rounds leave the nose cannon and walk along the strip where the dive is pointing
            const reach = Math.max(9, Math.min(24, (jetPos.y - base) * 1.7));
            const ta = Math.max(-len / 2, Math.min(len / 2, a + reach + rnd(-2, 4))), tb = j.side * 0.6 + rnd(-wid / 2, wid / 2) * 0.8;
            const tx = cx + dx * ta + px * tb, tz = cz + dz * ta + pz * tb;
            const to = new THREE.Vector3(tx, heightAt(tx, tz), tz);
            const tr = makeBeam(0xffc060, 0.08);
            j.mesh.updateMatrixWorld();
            j.mesh.localToWorld(muzzle.set(0.22, -0.2, 2.7));              // cannon port under the nose
            setBeam(tr, muzzle, to, 1);
            ab.scene.add(tr);
            tracers.push({ tr, life: 0.07 });
            puff(muzzle.x, muzzle.y, muzzle.z, { color: 0xffd890, size: 0.9 + Math.random() * 0.5, life: 0.06, opacity: 0.95, additive: true, priority: true });
            puff(tx, to.y + 0.2, tz, { color: 0xc9a070, size: 0.9, grow: 2.2, life: 0.5, opacity: 0.6, vy: 1.5 });
            puff(tx, to.y + 0.3, tz, { color: 0xffd090, size: 0.7, life: 0.12, opacity: 0.9, additive: true });
            burst(tx, to.y + 0.2, tz, 'soil', 2, 5);
            impactRing(tx, to.y, tz, 1.98);
            damageCircle(tx, tz, 1.98, 9.9, 0.6);
            audio.play('autocannon_fire', { x: jetPos.x, z: jetPos.z, vol: 0.32, delay: Math.random() * 0.03, force: true });
          }
        }
      }
      for (let k = rockets.length - 1; k >= 0; k--) {
        const r = rockets[k];
        r.m.position.addScaledVector(r.dir, r.speed * dt);
        r.trail += dt;
        r.m.userData.flame.scale.set(1, 0.7 + Math.random() * 0.6, 1);
        if (r.trail > 0.025) {
          r.trail = 0;
          puff(r.m.position.x, r.m.position.y, r.m.position.z, { color: 0xd8d0c8, size: 0.45, grow: 1.0, life: 0.7, opacity: 0.5 });
          puff(r.m.position.x, r.m.position.y, r.m.position.z, { color: 0xffa040, size: 0.35, life: 0.15, opacity: 0.8, additive: true });
        }
        if (r.m.position.y <= r.target.y + 0.3 || r.m.position.distanceTo(r.target) < 0.6) {
          explode(r.target.x, r.target.z, 1.4, 53, 2.64, { shake: 0.12, smoke: 5 });
          ab.scene.remove(r.m); rockets.splice(k, 1);
        }
      }
      for (let k = tracers.length - 1; k >= 0; k--) {
        tracers[k].life -= dt;
        if (tracers[k].life <= 0) { disposeGroup(tracers[k].tr); tracers.splice(k, 1); }
      }
      if (a0 > END && rockets.length === 0) {
        for (const j of jets) disposeGroup(j.mesh);
        for (const tr of tracers) disposeGroup(tr.tr);
        return false;
      }
      return true;
    },
  };
}

// ---------------------------------------------------------------- Artillery Strike
const shellGeo = new THREE.CylinderGeometry(0.11, 0.13, 0.7, 8);
const shellTip = new THREE.ConeGeometry(0.11, 0.3, 8);
function makeShell() {
  const g = new THREE.Group();
  const b = new THREE.Mesh(shellGeo, jetMats.dark);
  const tip = new THREE.Mesh(shellTip, jetMats.hull);
  tip.position.y = 0.5;
  g.add(b, tip);
  return g;
}
function artilleryStrike(cx, cz, R) {
  const shells = [];
  const count = 20 + Math.floor(Math.random() * 5);
  const times = Array.from({ length: count }, (_, i) => 0.3 + (i / count) * 6.0 + rnd(0, 0.2));
  let t = 0, next = 0;
  log(`Artillery strike: ${count} shells inbound!`);
  return {
    update(dt) {
      t += dt;
      while (next < count && t >= times[next]) {
        next++;
        const a = rnd(0, Math.PI * 2), r = R * Math.sqrt(Math.random());
        const tx = cx + Math.cos(a) * r, tz = cz + Math.sin(a) * r;
        const fa = rnd(0, Math.PI * 2);
        const m = makeShell();
        const start = new THREE.Vector3(tx + Math.cos(fa) * 28, heightAt(tx, tz) + 45, tz + Math.sin(fa) * 28);
        const target = new THREE.Vector3(tx, heightAt(tx, tz), tz);
        m.position.copy(start);
        const dir = target.clone().sub(start).normalize();
        m.quaternion.setFromUnitVectors(UP, dir);
        ab.scene.add(m);
        shells.push({ m, dir, target, speed: 58, trail: 0 });
        audio.play('artillery_whistle', { x: tx, z: tz, vol: 0.8 });
      }
      for (let k = shells.length - 1; k >= 0; k--) {
        const s = shells[k];
        s.m.position.addScaledVector(s.dir, s.speed * dt);
        s.trail += dt;
        if (s.trail > 0.04) { s.trail = 0; puff(s.m.position.x, s.m.position.y, s.m.position.z, { color: 0xe0d8d0, size: 0.5, grow: 0.6, life: 0.4, opacity: 0.35 }); }
        if (s.m.position.y <= s.target.y + 0.2) {
          explode(s.target.x, s.target.z, 1.7, 82.5, 3.08, { shake: 0.3, smoke: 7 });
          disposeGroup(s.m); shells.splice(k, 1);
        }
      }
      return !(next >= count && shells.length === 0);
    },
  };
}

// ---------------------------------------------------------------- Nuclear Strike
function makeICBM() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 5, 12), new THREE.MeshStandardMaterial({ color: 0xe6e8ea, roughness: 0.4, metalness: 0.3 }));
  g.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.4, 12), jetMats.dark);
  nose.position.y = 3.2;
  g.add(nose);
  for (let k = 0; k < 4; k++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.2, 0.9), jetMats.dark);
    fin.position.set(Math.cos(k * Math.PI / 2) * 0.5, -2.2, Math.sin(k * Math.PI / 2) * 0.5);
    fin.rotation.y = -k * Math.PI / 2;
    g.add(fin);
  }
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.4, 3, 10, 1, true), jetMats.flame);
  flame.rotation.x = Math.PI; flame.position.y = -4;
  g.add(flame);
  g.userData.flame = flame;
  return g;
}

// Mushroom cloud: a chunky, lit cloud made of billows (spheres) so it reads from any camera angle. The cap is a ring
// of billows that roll outward around the ring's core like a real vortex, over a domed crown; the stem is a stack
// that rises under it, with a skirt of ground smoke. It climbs, hangs for several seconds, then thins and drifts.
const billowGeo = new THREE.IcosahedronGeometry(1, 2);
// opts (for the strategic strike's far bigger cloud): top / hold / gone, smooth shading, a fatter stem, more billows.
export function makeMushroom(cx, gy, cz, R, { top: TOP = 30, hold: HOLD = 12, gone: GONE = CLOUD_GONE, smooth = false, stemK = 1, dense = 1 } = {}) {
  const group = new THREE.Group();
  group.position.set(cx, gy, cz);
  const mat = (color) => new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0, emissive: 0xff6a20, emissiveIntensity: 0, transparent: true, opacity: 1, flatShading: !smooth });
  const mats = { cap: mat(0x4a433e), crown: mat(0x5a524c), stem: mat(0x332e2a), skirt: mat(0x5a5048) };   // dark, sooty smoke
  const DENSITY = 0.9;                                          // never quite opaque
  const parts = [];
  const add = (m, o) => { const b = new THREE.Mesh(billowGeo, m); b.castShadow = false; b.rotation.set(rnd(0, 6), rnd(0, 6), rnd(0, 6)); group.add(b); parts.push({ b, ...o }); };
  const nRing = Math.round(18 * dense), nCrown = Math.round(9 * dense), nStem = Math.round(12 * dense);
  for (let k = 0; k < nRing; k++) add(mats.cap, { kind: 'ring', ang: k / nRing * Math.PI * 2 + rnd(-0.1, 0.1), ph: rnd(0, 6.28), size: rnd(0.85, 1.2) });
  for (let k = 0; k < nCrown; k++) add(mats.crown, { kind: 'crown', ang: k / nCrown * Math.PI * 2, ph: rnd(0, 6.28), size: rnd(0.9, 1.25), r: k === 0 ? 0 : k % 2 ? 0.5 : 0.28 });
  for (let k = 0; k < nStem; k++) add(mats.stem, { kind: 'stem', u: k / (nStem - 1), ang: rnd(0, 6.28), ph: rnd(0, 6.28), size: rnd(0.85, 1.15) });
  for (let k = 0; k < 12; k++) add(mats.skirt, { kind: 'skirt', ang: k / 12 * Math.PI * 2 + rnd(-0.15, 0.15), ph: rnd(0, 6.28), size: rnd(0.8, 1.2) });
  const K = TOP / 30;                                           // defaults: starts thinning 12 s after the blast, gone by 20 s
  return {
    group,
    // a = seconds since detonation. Returns false once the cloud has fully dissipated.
    update(a, dt) {
      const rise = easeOut(clamp01(a / 6.5));
      const top = 5 + (TOP - 5) * rise + Math.max(0, a - 6.5) * 0.35 * K;          // keeps creeping upward as it hangs
      const capR = 3 + (R * 0.95 - 3) * easeOut(clamp01(a / 8));
      const fade = clamp01((a - HOLD) / (GONE - HOLD));                          // 0 while it lingers, 1 when gone
      const thin = 1 - fade * fade * (3 - 2 * fade);
      const spread = 1 + fade * 0.55;
      const heat = Math.max(0, 1 - a / 5.5);
      const grow = easeOut(clamp01(a / 1.2));
      for (const q of parts) {
        const wob = Math.sin(a * 0.9 + q.ph);
        if (q.kind === 'ring') {
          const roll = a * 0.8 + q.ph;                                           // billows circulate around the vortex core
          const rr = (capR + Math.cos(roll) * capR * 0.18) * spread, yy = top + Math.sin(roll) * capR * 0.2;
          q.b.position.set(Math.cos(q.ang) * rr, yy, Math.sin(q.ang) * rr);
          q.b.scale.setScalar(capR * 0.42 * q.size * grow * (1 + fade * 0.3));
        } else if (q.kind === 'crown') {
          const rr = capR * q.r * spread;
          q.b.position.set(Math.cos(q.ang) * rr, top + capR * (q.r ? 0.22 : 0.42) + wob * 0.3, Math.sin(q.ang) * rr);
          q.b.scale.setScalar(capR * (q.r ? 0.5 : 0.62) * q.size * grow * (1 + fade * 0.3));
        } else if (q.kind === 'stem') {
          const yy = q.u * (top - capR * 0.15), w = (1.7 + (1 - q.u) * 1.1 + Math.abs(q.u - 0.5) * 1.2) * K * stemK;
          q.b.position.set(Math.cos(q.ang + a * 0.3) * 0.5 * K * stemK, yy, Math.sin(q.ang + a * 0.3) * 0.5 * K * stemK);
          q.b.scale.set(w * q.size * grow, (top / (nStem - 1)) * 1.25 * grow, w * q.size * grow);
        } else {
          const rr = (2 + (R * 0.75 - 2) * easeOut(clamp01(a / 3))) * spread;
          q.b.position.set(Math.cos(q.ang) * rr, 0.8 * K + wob * 0.2, Math.sin(q.ang) * rr);
          q.b.scale.set(R * 0.2 * q.size * grow, R * 0.11 * q.size * grow, R * 0.2 * q.size * grow);
        }
        q.b.rotation.y += dt * 0.25 * (q.kind === 'ring' ? 1 : 0.4);
      }
      group.position.x = cx + Math.max(0, a - HOLD) * 0.5;                        // drifts downwind as it breaks up
      mats.cap.emissiveIntensity = heat * 1.5; mats.crown.emissiveIntensity = heat * 0.9;
      mats.stem.emissiveIntensity = heat * 2.2; mats.skirt.emissiveIntensity = heat * 1.2;
      for (const m of Object.values(mats)) m.opacity = thin * DENSITY;
      mats.skirt.opacity = DENSITY * (1 - clamp01((a - 2.2) / 2.3));          // the ground billows clear within ~4.5 s
      return a < GONE;
    },
    dispose() { group.removeFromParent(); for (const m of Object.values(mats)) m.dispose(); },
  };
}

const CLOUD_GONE = 20;                                        // seconds after detonation when the mushroom cloud has cleared
function nuclearStrike(cx, cz, R) {
  const gy = heightAt(cx, cz);
  const ring = new THREE.Mesh(ringGeo(cx, cz, R, 0.35), bandMat(0xff4040));
  const fill = new THREE.Mesh(discGeo(cx, cz, R), fillMat(0xff4040));
  const inner = new THREE.Mesh(ringGeo(cx, cz, R * 0.4, 0.2), bandMat(0xff8060));
  ab.scene.add(ring, fill, inner);
  const label = textSprite(7);
  label.position.set(cx, gy + 7, cz);
  ab.scene.add(label);
  const flashEl = document.getElementById('flash');
  const T_LAUNCH = 8.2, T_HIT = 10, T_END = 31;
  const BLAST = R * 1.35, FIRE = BLAST * 1.25, FIRE_TIME = 5;      // lethal radius, and the ring beyond it that is set ablaze
  const fireRing = new THREE.Mesh(ringGeo(cx, cz, FIRE, 0.18), bandMat(0xff8a20));
  ab.scene.add(fireRing);
  let cloud = null, igniteT = 0, fireT = 0, shock = null, dome = null;
  const fires = [];
  let t = 0, shown = -1, icbm = null, hit = false, ball = null, wave = null, wave2 = null, stemT = 0, capT = 0;
  const start = new THREE.Vector3(cx - 45, gy + 140, cz - 30);
  const target = new THREE.Vector3(cx, gy, cz);
  log('TACTICAL NUKE AUTHORISED. Impact in 10 seconds.', true);
  return {
    update(dt) {
      t += dt;
      if (!hit) {
        const left = Math.ceil(T_HIT - t);
        if (left !== shown) { shown = left; label.userData.set(String(Math.max(0, left)), left <= 3 ? '#ff3030' : '#ffb040'); audio.play('nuke_beep', { hi: left <= 3, vol: 0.9, dur: left <= 3 ? 0.6 : 0.4, rate: left <= 3 ? 1.2 : 1 }); }
        const pulse = 1 + 0.03 * Math.sin(t * (4 + t));
        ring.scale.set(pulse, 1, pulse); ring.position.set(cx * (1 - pulse), 0, cz * (1 - pulse));
        fill.material.opacity = 0.12 + 0.1 * Math.abs(Math.sin(t * 3));
        inner.rotation.y += dt * 0.6;
        fireRing.material.opacity = 0.35 + 0.25 * Math.abs(Math.sin(t * 3));
        if (t >= T_LAUNCH && !icbm) { icbm = makeICBM(); ab.scene.add(icbm); log('ICBM launched!', true); audio.play('nuke_launch', { vol: 0.9 }); }
        if (icbm) {
          const p = clamp01((t - T_LAUNCH) / (T_HIT - T_LAUNCH));
          const q = p * p * 0.3 + p * 0.7;
          icbm.position.lerpVectors(start, target, q);
          _v.subVectors(target, start).normalize();
          icbm.quaternion.setFromUnitVectors(UP, _v);
          icbm.userData.flame.scale.set(1, 0.8 + Math.random() * 0.5, 1);
          puff(icbm.position.x - _v.x * 4, icbm.position.y - _v.y * 4, icbm.position.z - _v.z * 4, { color: 0xffffff, size: 1.4, grow: 2.5, life: 2.5, opacity: 0.5 });
        }
        if (t >= T_HIT) {
          hit = true;
          ab.scene.remove(icbm); disposeGroup(icbm);
          ab.scene.remove(label); label.material.map.dispose(); label.material.dispose();
          flashEl.style.opacity = '1';
          audio.play('nuke_impact', { vol: 1 });
          audio.play('nuke_rumble', { vol: 1 });
          cloud = makeMushroom(cx, gy, cz, R);
          ab.scene.add(cloud.group);
          ball = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 18), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
          ball.position.set(cx, gy + 2, cz);
          ab.scene.add(ball);
          const mkRing = (c) => { const m = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false })); m.rotation.x = -Math.PI / 2; m.position.set(cx, gy + 0.4, cz); ab.scene.add(m); return m; };
          wave = mkRing(0xffe0a0); wave2 = mkRing(0xffffff);
          // the pressure front: a thick bright ring tearing across the ground under a faint expanding dome
          shock = new THREE.Mesh(new THREE.TorusGeometry(1, 0.055, 10, 72).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xfff1da, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
          shock.position.set(cx, gy + 0.8, cz);
          dome = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffe6c4, transparent: true, opacity: 0.26, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
          dome.position.set(cx, gy, cz);
          ab.scene.add(shock, dome);
          for (let k = 0; k < 40; k++) {
            const a = rnd(0, Math.PI * 2), sp = rnd(14, 26);
            puff(cx, gy + 1, cz, { color: 0xb0987a, size: 3, grow: 6, life: rnd(2, 3.5), opacity: 0.7, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: rnd(1, 3), drag: 1.2 });
          }
          burst(cx, gy + 1, cz, 'debris', 30, 40);
          burst(cx, gy + 1, cz, 'soil', 30, 40);
          // ground scarring that outlasts the cloud: glassed crater, a broken ring of deep burns, streaks flung outward
          const SCAR = { hold: CLOUD_GONE + 2, fade: 6 };
          spawnScar(ab.scene, cx, cz, R * 2.5, { ...SCAR, glow: 9 });
          spawnScar(ab.scene, cx, cz, R * 1.5, { ...SCAR, color: 0x070605, glow: 14 });
          for (let k = 0; k < 11; k++) { const an = k / 11 * Math.PI * 2 + rnd(-0.2, 0.2), rr = R * rnd(0.55, 1.0); spawnScar(ab.scene, cx + Math.cos(an) * rr, cz + Math.sin(an) * rr, rnd(7, 11), { ...SCAR, glow: rnd(5, 10) }); }
          for (let k = 0; k < 18; k++) { const an = rnd(0, Math.PI * 2), rr = R * rnd(1.05, 1.7); spawnScar(ab.scene, cx + Math.cos(an) * rr, cz + Math.sin(an) * rr, rnd(3.5, 7), { ...SCAR, opacity: rnd(0.55, 0.85) }); }
          // fires that keep burning on the blasted ground until the cloud has gone
          for (let k = 0; k < 84; k++) {
            const an = rnd(0, Math.PI * 2), rr = Math.sqrt(rnd(0.04, 1)) * FIRE;
            const x = cx + Math.cos(an) * rr, z = cz + Math.sin(an) * rr;
            fires.push({ x, y: heightAt(x, z) + 0.15, z, size: rnd(1.6, 3.8) * (rr > BLAST ? 1.15 : 0.9), t: rnd(0, 0.2), out: CLOUD_GONE * rnd(0.72, 1) });
          }
          damageCircle(cx, cz, BLAST, 3300, 0.25);
          state.shake += 4.4;
          log('Nuclear detonation!', true);
        }
      } else {
        const a = t - T_HIT;
        if (a < 3.2) state.shake = Math.max(state.shake, 0.55 * (1 - a / 3.2));   // the ground keeps rolling after the first jolt
        if (cloud && !cloud.update(a, dt)) { cloud.dispose(); cloud = null; }
        // firestorm: for FIRE_TIME seconds anything in the band between the blast and the fire radius is set alight
        if (a < FIRE_TIME) {
          igniteT -= dt;
          if (igniteT <= 0) {
            igniteT = 0.25;
            eachEnemy(cx, cz, FIRE, (e, d2) => { if (d2 > BLAST * BLAST) e.burn = { dps: 33, t: Math.max(e.burn?.t ?? 0, 5) }; });
          }
          fireT += dt;
          while (fireT > 0.012) {
            fireT -= 0.012;
            const ang = rnd(0, Math.PI * 2), rr = Math.sqrt(rnd(BLAST * BLAST * 0.55, FIRE * FIRE));
            const fx = cx + Math.cos(ang) * rr, fz = cz + Math.sin(ang) * rr, left = 1 - a / FIRE_TIME;
            flame.emit(fx, heightAt(fx, fz) + 0.2, fz, { size: rnd(0.7, 1.5) * (0.5 + left * 0.5), grow: 1.4, life: rnd(0.5, 0.9), vy: rnd(2, 4.5), vx: Math.cos(ang) * 1.5, vz: Math.sin(ang) * 1.5, drag: 0.8, heat: 0.75 + left * 0.25 });
          }
        }
        for (const f of fires) {                                     // each fire gutters out on its own schedule, the last with the cloud
          if (a >= f.out) continue;
          f.t -= dt;
          if (f.t > 0) continue;
          const left = Math.min(1, (f.out - a) / 5), big = f.size * (0.45 + 0.55 * left);
          f.t = 0.07 + Math.random() * 0.05;
          flame.emit(f.x + rnd(-0.4, 0.4) * big, f.y, f.z + rnd(-0.4, 0.4) * big, { size: big * rnd(0.7, 1.1), grow: 1.3, life: rnd(0.6, 1.05), vy: rnd(2.4, 4.6) * (0.6 + 0.4 * left), vx: 0.5, vz: rnd(-0.3, 0.3), drag: 0.8, heat: 0.7 + 0.3 * left });
          if (Math.random() < 0.05) puff(f.x, f.y + 1.2, f.z, { color: 0x1f1b18, size: 1.2, grow: 1.8, life: 2.4, opacity: 0.35, vy: 2.6, vx: 0.6, drag: 0.6 });
        }
        flashEl.style.opacity = String(Math.max(0, 1 - a / 2.2));
        if (a < 3) {
          const p = clamp01(a / 1.4);
          ball.scale.setScalar(1 + R * 1.1 * easeOut(p));
          ball.material.color.setHex(a < 0.25 ? 0xffffff : a < 0.9 ? 0xffb050 : 0xff5a20);
          ball.material.opacity = 0.95 * (1 - clamp01((a - 0.8) / 2.0));
          ball.position.y = gy + 2 + a * 5;
          wave.scale.setScalar(1 + R * 3.2 * easeOut(clamp01(a / 1.8)));
          wave.material.opacity = 0.9 * (1 - clamp01(a / 1.8));
          wave2.scale.setScalar(1 + R * 2.0 * easeOut(clamp01(a / 1.0)));
          wave2.material.opacity = 0.9 * (1 - clamp01(a / 1.0));
          const sp = clamp01(a / 1.7), front = 1 + R * 3.4 * easeOut(sp);
          shock.scale.set(front, front * 0.55, front);
          shock.material.opacity = 0.95 * (1 - sp) ** 1.4;
          dome.scale.setScalar(1 + R * 2.7 * easeOut(clamp01(a / 1.3)));
          dome.material.opacity = 0.26 * (1 - clamp01(a / 1.3));
          if (sp < 1) for (let k = 0; k < 7; k++) {                 // dust torn up along the front
            const ang = rnd(0, Math.PI * 2), px = cx + Math.cos(ang) * front, pz = cz + Math.sin(ang) * front;
            puff(px, heightAt(px, pz) + 0.5, pz, { color: 0xcdb592, size: rnd(1.6, 3), grow: 3.2, life: rnd(0.7, 1.3), opacity: 0.55 * (1 - sp), vx: Math.cos(ang) * 9, vz: Math.sin(ang) * 9, vy: rnd(1, 3), drag: 2.4 });
          }
        } else if (ball) { ab.scene.remove(ball, wave, wave2, shock, dome); ball = null; }
        // mushroom cloud: rising stem and expanding cap
        // Stem: a narrow, fast-rising column of dark smoke lit orange while the fireball is hot.
        stemT += dt;
        if (a < 9 && stemT > 0.09) {
          stemT = 0;
          const heat = clamp01(1 - a / 3);
          const col = new THREE.Color(0x2e2924).lerp(new THREE.Color(0xff7030), heat * 0.75);
          const ang = rnd(0, Math.PI * 2), rr = rnd(0, 1.4);
          puff(cx + Math.cos(ang) * rr, gy + 1, cz + Math.sin(ang) * rr, { color: col.getHex(), size: 2.6, grow: 1.1, life: 9, opacity: 0.9, vy: rnd(12, 16), vx: Math.cos(ang) * 0.4, vz: Math.sin(ang) * 0.4, drag: 0.1, fadeIn: 0.3 });
        }
        // Cap: a broad ring of lighter cloud spreading outward at the top of the stem, with a fiery underside early on.
        capT += dt;
        if (a > 0.6 && a < 14 && capT > 0.07) {
          capT = 0;
          const ang = rnd(0, Math.PI * 2), sp = rnd(2, 5);
          const heat = clamp01(1 - a / 4);
          const col = new THREE.Color(0x8a8078).lerp(new THREE.Color(0xffa050), heat * 0.55);
          const top = gy + 2 + Math.min(30, 10 + a * 5);
          const r0 = 2.5 + Math.min(6, a * 1.2);
          puff(cx + Math.cos(ang) * r0, top + rnd(-2, 2), cz + Math.sin(ang) * r0, { color: col.getHex(), size: 6.5, grow: 2.0, life: 10, opacity: 0.5, vx: Math.cos(ang) * sp, vz: Math.sin(ang) * sp, vy: rnd(1.2, 2.6), drag: 0.3, fadeIn: 0.5 });
          if (a < 3 && Math.random() < 0.5) puff(cx + Math.cos(ang) * r0 * 0.6, top - 3, cz + Math.sin(ang) * r0 * 0.6, { color: 0xff9040, size: 6, grow: 1.5, life: 2.5, opacity: 0.4, additive: true, vy: 1.5, drag: 0.5 });
        }
        fireRing.material.opacity = Math.max(0, 0.9 * (1 - a / FIRE_TIME));
        ring.material.opacity = Math.max(0, 0.9 - a * 0.5); fill.material.opacity = Math.max(0, 0.2 - a * 0.1); inner.material.opacity = ring.material.opacity;
      }
      if (t >= T_END) {
        ab.scene.remove(ring, fill, inner, fireRing);
        if (cloud) cloud.dispose();
        for (const m of [ring, fill, inner, fireRing]) { m.geometry.dispose(); m.material.dispose(); }
        return false;
      }
      return true;
    },
  };
}

// ---------------------------------------------------------------- Archangel Orbital Lance
// The ultimate orbital strike, on a par with the nuke. Twelve golden beams in two counter-rotating rings spiral in
// from the rim, scoring the ground as they come; they merge into one lance that swells to an enormous width,
// wreathed in lightning and growing brighter and louder until it detonates and throws out a train of shockwaves.
const segGeo = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true);
function archangelLance(cx, cz, R) {
  const gy = heightAt(cx, cz), SKY = 170;
  const T_MERGE = 4.6, T_BOOM = 9.6, T_END = 16.5, BLAST = R * 1.35;
  const GOLD = 0xffd98a, PALE = 0xfff4d6;
  const flashEl = document.getElementById('flash');
  const addMat = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide });
  const own = [];                                                // everything to dispose at the end
  const keep = (o) => { ab.scene.add(o); own.push(o); return o; };

  // ground sigil: rim, two counter-rotating inner rings, faint fill
  const rim = keep(new THREE.Mesh(ringGeo(cx, cz, R, 0.32), bandMat(GOLD)));
  const fill = keep(new THREE.Mesh(discGeo(cx, cz, R), fillMat(GOLD)));
  const sigil = (r, w, n) => {                                  // a flat ring of arc segments, so its rotation shows
    const g = keep(new THREE.Group());
    const m = bandMat(PALE);
    for (let k = 0; k < n; k++) g.add(new THREE.Mesh(new THREE.RingGeometry(r - w, r, 20, 1, k / n * Math.PI * 2, Math.PI * 2 / n * 0.68).rotateX(-Math.PI / 2), m));
    g.position.set(cx, gy + 0.45, cz);
    g.userData.mat = m;
    return g;
  };
  const sig1 = sigil(R * 0.66, 0.22, 8), sig2 = sigil(R * 0.33, 0.18, 5);
  // the aperture: a halo of light high overhead that the beams come from
  const halo = keep(new THREE.Mesh(new THREE.TorusGeometry(1, 0.035, 8, 64).rotateX(Math.PI / 2), addMat(PALE, 0.9)));
  halo.position.set(cx, gy + 95, cz);

  const beams = [];
  for (let k = 0; k < 12; k++) {
    const b = keep(makeBeam(k % 2 ? GOLD : PALE, 0.2));
    const glow = puff(cx, gy, cz, { color: PALE, size: 1.6, life: 99, opacity: 0.95, additive: true, priority: true });
    beams.push({ b, glow, a: (k / 12) * Math.PI * 2, dir: k % 2 ? 1 : -1, r0: k % 2 ? 1.55 : 1.15 });
  }
  // the lance itself: three nested shells so it reads as a solid shaft of light with a white-hot core
  const shells = [[0.34, 0xffffff, 0.95], [0.68, PALE, 0.55], [1.0, GOLD, 0.26]].map(([w, c, o]) => {
    const m = keep(new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 28, 1, true), addMat(c, o)));
    m.visible = false; m.userData = { w, o };
    return m;
  });
  const pool = keep(new THREE.Mesh(new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2), addMat(PALE, 0)));
  pool.position.set(cx, gy + 0.3, cz);
  // lightning: jagged arcs rebuilt many times a second, coiling round the lance and lashing out across the ground
  const arcs = [];
  for (let k = 0; k < 14; k++) {
    const segs = [];
    for (let j = 0; j < 9; j++) { const m = keep(new THREE.Mesh(segGeo, addMat(k % 3 ? 0xfff0c0 : 0xbfe6ff, 0.95))); m.visible = false; segs.push(m); }
    arcs.push({ segs, ground: k >= 9 });
  }
  const setSeg = (m, a, b, w) => { _v.subVectors(b, a); const len = _v.length() || 0.001; m.position.copy(a).addScaledVector(_v, 0.5); m.quaternion.setFromUnitVectors(UP, _v.multiplyScalar(1 / len)); m.scale.set(w, len, w); };

  const waves = [];
  let t = 0, merged = false, boomed = false, arcT = 0, scarT = 0, dustT = 0, hum = null, nextWave = 0;
  const from = new THREE.Vector3(), to = new THREE.Vector3(), pa = new THREE.Vector3(), pb = new THREE.Vector3();
  log('ARCHANGEL LANCE: firing solution locked.', true);
  audio.play('archangel_charge', { x: cx, z: cz, vol: 1 });

  return {
    update(dt) {
      t += dt;
      const conv = clamp01(t / T_MERGE), swell = clamp01((t - T_MERGE) / (T_BOOM - T_MERGE));
      sig1.rotation.y += dt * (0.5 + conv * 2); sig2.rotation.y -= dt * (0.8 + conv * 3);
      halo.scale.setScalar(R * (0.35 + 1.2 * easeOut(clamp01(t / 2))) * (boomed ? 1 + (t - T_BOOM) * 0.6 : 1));
      halo.rotation.y += dt * 0.7;

      // ---- phase 1: the spiral
      if (!boomed) {
        const spin = 0.9 + conv * conv * 7;                       // winds up as it closes
        for (const bm of beams) {
          bm.a += bm.dir * spin * dt;
          const r = Math.max(0, R * bm.r0 * (1 - Math.pow(conv, 1.7)) * (merged ? 0 : 1));       // drifts in, then plunges to the centre
          to.set(cx + Math.cos(bm.a) * r, 0, cz + Math.sin(bm.a) * r); to.y = heightAt(to.x, to.z) + 0.1;
          from.set(cx + Math.cos(bm.a - bm.dir * 1.1) * (r * 1.6 + 14), gy + SKY, cz + Math.sin(bm.a - bm.dir * 1.1) * (r * 1.6 + 14));   // fanned out across the sky
          setBeam(bm.b, from, to, merged ? Math.max(0, 1 - (t - T_MERGE) * 2.5) : 0.7 + conv * 1.1);
          bm.glow.position.copy(to); bm.glow.scale.setScalar((1.4 + Math.random() * 0.6) * (merged ? Math.max(0, 1 - (t - T_MERGE) * 2.5) : 1));
          if (!merged) {
            damageCircle(to.x, to.z, 1.3, 90 * dt, 0.5);
            if (Math.random() < 0.6) puff(to.x, to.y + 0.2, to.z, { color: GOLD, size: 0.6, life: 0.5, opacity: 0.85, additive: true, vy: rnd(1.5, 4), vx: rnd(-1, 1), vz: rnd(-1, 1) });
          }
        }
        scarT -= dt;
        if (!merged && scarT <= 0) { scarT = 0.12; const bm = beams[Math.floor(Math.random() * beams.length)]; spawnScorch(ab.scene, bm.glow.position.x, bm.glow.position.z, rnd(1.4, 2.2)); }
        fill.material.opacity = 0.12 + 0.22 * conv * (0.6 + 0.4 * Math.sin(t * 22));
      }

      // ---- phase 2: the lance swells
      if (t >= T_MERGE && !merged) {
        merged = true;
        for (const m of shells) m.visible = true;
        hum = audio.loop('orbital_laser', { x: cx, z: cz, vol: 0.5 });
        audio.play('lance_impact', { x: cx, z: cz, vol: 0.9 });
        state.shake += 0.8;
        log('Archangel Lance: beams converged.', true);
      }
      if (merged && !boomed) {
        const width = 1.2 + (R * 0.5 - 1.2) * (swell * swell * (3 - 2 * swell));       // up to half the target radius across
        const surge = 1 + 0.1 * Math.sin(t * 38) * (0.3 + swell) + Math.random() * 0.06 * swell;
        from.set(cx, gy + SKY, cz); to.set(cx, gy - 0.5, cz);
        for (const m of shells) { setSeg(m, from, to, width * m.userData.w * surge); m.material.opacity = Math.min(1, m.userData.o * (0.75 + 0.6 * swell)); }
        pool.scale.setScalar(width * 1.9 * surge); pool.material.opacity = 0.35 + 0.45 * swell;
        damageCircle(cx, cz, width + 1, (250 + 650 * swell) * dt, 0.3);
        state.shake = Math.max(state.shake, 0.2 + 1.1 * swell * swell);
        if (hum) hum.setVol(0.5 + 1.3 * swell);
        // crackle
        arcT -= dt;
        if (arcT <= 0) {
          arcT = 0.045;
          for (const arc of arcs) {
            const live = Math.random() < 0.35 + 0.6 * swell;
            let a0 = rnd(0, Math.PI * 2);
            if (arc.ground) {                                      // lashes out along the ground from the foot of the beam
              const reach = width + rnd(2, 4 + R * 0.7 * swell);
              pa.set(cx + Math.cos(a0) * width, gy + rnd(0.5, 3), cz + Math.sin(a0) * width);
              arc.segs.forEach((m, j) => {
                m.visible = live;
                if (!live) return;
                const u = (j + 1) / arc.segs.length, rr = width + (reach - width) * u;
                a0 += rnd(-0.22, 0.22);
                pb.set(cx + Math.cos(a0) * rr, 0, cz + Math.sin(a0) * rr); pb.y = heightAt(pb.x, pb.z) + rnd(0.2, 1.6) * (1 - u) + 0.15;
                setSeg(m, pa, pb, 0.05 + 0.07 * swell); pa.copy(pb);
              });
            } else {                                               // coils up the shaft
              const y0 = gy + rnd(0, 30), span = rnd(14, 34), turn = rnd(1.2, 3) * (Math.random() < 0.5 ? -1 : 1);
              pa.set(cx + Math.cos(a0) * width * 1.05, y0, cz + Math.sin(a0) * width * 1.05);
              arc.segs.forEach((m, j) => {
                m.visible = live;
                if (!live) return;
                const u = (j + 1) / arc.segs.length, aa = a0 + turn * u + rnd(-0.25, 0.25), rr = width * (1.05 + rnd(0, 0.35));
                pb.set(cx + Math.cos(aa) * rr, y0 + span * u, cz + Math.sin(aa) * rr);
                setSeg(m, pa, pb, 0.06 + 0.09 * swell); pa.copy(pb);
              });
            }
          }
        }
        // debris and light torn upward into the beam
        dustT -= dt;
        if (dustT <= 0) {
          dustT = 0.03;
          const a = rnd(0, Math.PI * 2), rr = width * rnd(0.9, 1.8);
          puff(cx + Math.cos(a) * rr, gy + 0.4, cz + Math.sin(a) * rr, { color: Math.random() < 0.5 ? PALE : 0xc9a070, size: rnd(0.6, 1.4), life: rnd(0.7, 1.3), opacity: 0.8, additive: Math.random() < 0.6, vy: rnd(8, 18) * (0.5 + swell), vx: -Math.cos(a) * 3, vz: -Math.sin(a) * 3, drag: 0.2 });
        }
        fill.material.opacity = 0.2 + 0.3 * swell;
      }

      // ---- phase 3: detonation
      if (t >= T_BOOM && !boomed) {
        boomed = true;
        if (hum) { hum.stop(); hum = null; }
        flashEl.style.opacity = '0.9';
        audio.play('nuke_impact', { vol: 1 });
        audio.play('nuke_rumble', { vol: 0.9 });
        audio.play('lance_impact', { x: cx, z: cz, vol: 1 });
        damageCircle(cx, cz, BLAST, 3300, 0.25);
        explode(cx, cz, 6.5, 0, 0, { color: 0xffe2a0, shake: 0, smoke: 22 });
        state.shake += 4.6;
        spawnScar(ab.scene, cx, cz, R * 2.4, { hold: 16, fade: 6, glow: 10, glowI: 0.12 });
        spawnScar(ab.scene, cx, cz, R * 1.3, { hold: 16, fade: 6, glow: 14, glowI: 0.38, color: 0x070605 });
        for (let k = 0; k < 14; k++) { const an = rnd(0, Math.PI * 2), rr = R * rnd(0.5, 1.5); spawnScar(ab.scene, cx + Math.cos(an) * rr, cz + Math.sin(an) * rr, rnd(4, 9), { hold: 15, fade: 6, glow: rnd(4, 9), glowI: 0.22, opacity: rnd(0.6, 1) }); }
        burst(cx, gy + 1, cz, 'debris', 40, 46);
        burst(cx, gy + 1, cz, 'soil', 40, 46);
        for (const arc of arcs) for (const m of arc.segs) m.visible = false;
        for (const bm of beams) { bm.b.visible = false; killPuff(bm.glow); }
        log('Archangel Lance detonation!', true);
      }
      if (boomed) {
        const a = t - T_BOOM;
        flashEl.style.opacity = String(Math.max(0, 0.9 - a / 1.8));
        if (a < 3) state.shake = Math.max(state.shake, 0.6 * (1 - a / 3));
        // the shaft collapses to a needle and rises away
        const k = clamp01(a / 0.9);
        from.set(cx, gy + SKY, cz); to.set(cx, gy - 0.5 + a * 22, cz);
        for (const m of shells) { setSeg(m, from, to, Math.max(0.001, R * 0.5 * m.userData.w * (1 - easeOut(k)))); m.material.opacity = m.userData.o * (1 - k); m.visible = k < 1; }
        pool.scale.setScalar(R * (0.9 + a * 0.8)); pool.material.opacity = Math.max(0, 0.8 - a * 0.55);
        // a train of shockwaves, one after another
        while (nextWave < 4 && a >= nextWave * 0.32) {
          const ring = keep(new THREE.Mesh(new THREE.TorusGeometry(1, 0.05 - nextWave * 0.008, 10, 80).rotateX(Math.PI / 2), addMat(nextWave % 2 ? PALE : 0xfff1da, 0.95)));
          ring.position.set(cx, gy + 0.8 + nextWave * 0.5, cz);
          waves.push({ ring, born: a, reach: R * (3.6 - nextWave * 0.35), dur: 1.9 + nextWave * 0.15 });
          nextWave++;
        }
        for (const w of waves) {
          const u = clamp01((a - w.born) / w.dur), front = 1 + w.reach * easeOut(u);
          w.ring.scale.set(front, front * 0.5, front);
          w.ring.material.opacity = 0.95 * (1 - u) ** 1.3;
          if (u < 1 && w === waves[0]) for (let n = 0; n < 6; n++) {
            const ang = rnd(0, Math.PI * 2), px = cx + Math.cos(ang) * front, pz = cz + Math.sin(ang) * front;
            puff(px, heightAt(px, pz) + 0.5, pz, { color: 0xcdb592, size: rnd(1.6, 3), grow: 3.2, life: rnd(0.7, 1.3), opacity: 0.55 * (1 - u), vx: Math.cos(ang) * 9, vz: Math.sin(ang) * 9, vy: rnd(1, 3), drag: 2.4 });
          }
        }
        // embers drifting up from the glassed crater
        if (a < 6 && Math.random() < dt * 40) { const ang = rnd(0, Math.PI * 2), rr = Math.sqrt(Math.random()) * R * 0.9; puff(cx + Math.cos(ang) * rr, gy + 0.3, cz + Math.sin(ang) * rr, { color: GOLD, size: rnd(0.3, 0.7), life: rnd(1.2, 2.4), opacity: 0.9, additive: true, vy: rnd(2, 6), vx: rnd(-1, 1), vz: rnd(-1, 1), drag: 0.4 }); }
        const gone = clamp01(a / 2.5);
        rim.material.opacity = 0.9 * (1 - gone); fill.material.opacity = 0.5 * (1 - gone); sig1.userData.mat.opacity = sig2.userData.mat.opacity = 0.9 * (1 - gone);
        halo.material.opacity = 0.9 * (1 - clamp01(a / 3.5));
      }
      if (t >= T_END) {
        flashEl.style.opacity = '0';
        for (const o of own) { ab.scene.remove(o); o.traverse?.((q) => { if (q.isMesh) { if (q.geometry !== segGeo) q.geometry.dispose(); q.material.dispose(); } }); }
        return false;
      }
      return true;
    },
  };
}

// ---------------------------------------------------------------- targeting / activation
function buildReticle(key, p) {
  const def = ABILITIES[key];
  const color = key === 'nuke' ? 0xff4040 : key === 'strafe' ? 0xffb040 : key === 'artillery' ? 0xff8040 : key === 'troopers' ? 0x5dff8a : key === 'bomber' ? 0xff5a30 : key === 'archangel' ? 0xffe08a : key === 'blackhole' ? 0xa878ff : 0x7fe0ff;
  const g = new THREE.Group();
  if (def.global) return g;                                    // nothing to aim and nothing drawn: the cursor prompt is the whole UI
  if (def.line) {
    // Two-step targeting: before the first click just mark the spot; after it, show the full run through the anchor.
    const a = ab.anchor || p, d = lineDir(a, p);
    const [t0, t1] = lineSpan(a.x, a.z, d.x, d.z, EXTENT - 1);
    const strip = (w, lift) => gridGeo(90, 1, (u, v) => { const t = t0 + (t1 - t0) * u, b = (v - 0.5) * w; return [a.x + d.x * t - d.z * b, a.z + d.z * t + d.x * b]; }, lift);
    g.add(new THREE.Mesh(strip(def.width, 0.12), fillMat(color)));
    for (const s of [-1, 1]) g.add(new THREE.Mesh(gridGeo(90, 1, (u, v) => { const t = t0 + (t1 - t0) * u, b = s * (def.width / 2 - 0.3 * v); return [a.x + d.x * t - d.z * b, a.z + d.z * t + d.x * b]; }, 0.16), bandMat(color)));
    g.add(new THREE.Mesh(ringGeo(a.x, a.z, 1.4, 0.3), bandMat(0xffffff)));
    for (let k = 0; k < 3; k++) {                                // chevrons: direction of flight
      const at = 6 + k * 5;
      g.add(new THREE.Mesh(gridGeo(2, 1, (u, v) => { const b = (u - 0.5) * 5, t = at - Math.abs(b) * 0.8 + v * 0.9; return [a.x + d.x * t - d.z * b, a.z + d.z * t + d.x * b]; }, 0.2), bandMat(0xffffff)));
    }
  } else if (def.length) {
    const d = dirFromCore(p);
    g.add(new THREE.Mesh(rectGeo(p.x, p.z, d.x, d.z, def.length, def.width), fillMat(color)));
    g.add(new THREE.Mesh(rectBandGeo(p.x, p.z, d.x, d.z, def.length, def.width, 0.25), bandMat(color)));
    // arrow showing the jets' direction of travel
    g.add(new THREE.Mesh(gridGeo(2, 1, (u, v) => {
      const a = -def.length / 2 - 1.5 - v * 2.2, b = (u - 0.5) * 2.5 * v;
      return [p.x + d.x * a - d.z * b, p.z + d.z * a + d.x * b];
    }), bandMat(color)));
  } else {
    g.add(new THREE.Mesh(discGeo(p.x, p.z, def.radius), fillMat(color)));
    g.add(new THREE.Mesh(ringGeo(p.x, p.z, def.radius, 0.22), bandMat(color)));
    if (key === 'nuke') g.add(new THREE.Mesh(ringGeo(p.x, p.z, def.radius * 1.35 * 1.25, 0.16), bandMat(0xff8a20)));   // firestorm limit
  }
  return g;
}
// Bomber heading: from the anchor toward the cursor; before there is an anchor (or on top of it) fall back to a
// run that crosses the clicked point on its way over the base.
function lineDir(a, p) {
  const d = new THREE.Vector3(p.x - a.x, 0, p.z - a.z);
  if (d.lengthSq() < 4) return dirFromCore(a);
  return d.normalize();
}
function dirFromCore(p) {
  const d = new THREE.Vector3(p.x, 0, p.z);
  if (d.lengthSq() < 1) d.set(0, 0, 1);
  return d.normalize().negate();          // jets fly from the map edge in toward the base
}

export const abilities = {
  init({ scene, ui, camera, controls }) {
    ab.scene = scene;
    ab.ui = ui;
    ab.camera = camera; ab.controls = controls;
    for (const k of Object.keys(ABILITIES)) ab.cooldowns[k] = 0;
    buildBar();
    addEventListener('pointermove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; if (ab.armed) showHint(); });
    addEventListener('keydown', (e) => {
      if (state.intro || state.gameOver) return;
      const hit = Object.entries(ABILITIES).find(([, d]) => d.key === e.key);
      if (hit) abilities.arm(hit[0]);
    });
  },
  get armed() { return ab.armed; },
  get cinematic() { return ab.cine; },                          // camera driver while a cinematic strike owns the view (main.js)
  get laserActive() { return !!ab.laser; },
  arm(key) {
    if (ab.cooldowns[key] > 0) return log(`${ABILITIES[key].name} recharging (${Math.ceil(ab.cooldowns[key])} s)`, true);
    if (ab.armed === key) return abilities.cancel();
    abilities.cancel();
    ab.ui.cancel();
    ab.ui.showSelected(null);
    ab.armed = key;
    showHint();
    refreshBar();
  },
  cancel() {
    ab.armed = null;
    ab.anchor = null;
    showHint();
    if (ab.reticle) { disposeGroup(ab.reticle); ab.reticle = null; }
    refreshBar();
  },
  hover(p) {
    if (p && ab.laser) ab.laser.guide(p);
    if (!ab.armed) return;
    if (ab.reticle) disposeGroup(ab.reticle);
    ab.reticle = p ? buildReticle(ab.armed, p) : null;
    if (ab.reticle) ab.scene.add(ab.reticle);
  },
  // Attract mode: call an ability in directly, ignoring cooldowns.
  demoFire(key, p) {
    ab.armed = key;
    abilities.click(p);
    ab.cooldowns[key] = 0;
  },
  click(p) {
    if (p && ab.laser) ab.laser.guide(p);
    if (!ab.armed) return false;
    const key = ab.armed, def = ABILITIES[key];
    if (def.line && !ab.anchor) {                              // first click: pin the run, next click sets its heading
      ab.anchor = { x: p.x, z: p.z };
      log('Bomber: now click to set the direction of the run.');
      abilities.hover(p);
      return true;
    }
    let fx;
    if (key === 'lance') fx = orbitalLance(p.x, p.z, def.radius);
    else if (key === 'laser') fx = orbitalLaser(p.x, p.z);
    else if (key === 'strafe') { const d = dirFromCore(p); fx = strafingRun(p.x, p.z, d.x, d.z, def.length, def.width); }
    else if (key === 'artillery') fx = artilleryStrike(p.x, p.z, def.radius);
    else if (key === 'nuke') fx = nuclearStrike(p.x, p.z, def.radius);
    else if (key === 'troopers') fx = troopers.dropPods(p.x, p.z, def.radius);
    else if (key === 'archangel') fx = archangelLance(p.x, p.z, def.radius);
    else if (key === 'blackhole') fx = blackHoleBomb(ab.scene, p.x, p.z, def.radius);
    else if (key === 'strategic') fx = strategicStrike({ scene: ab.scene, camera: ab.camera, controls: ab.controls, setCinematic: (fn) => { ab.cine = fn; } });
    else if (key === 'bomber') { const d = lineDir(ab.anchor, p); fx = bombingRun(ab.scene, ab.anchor.x, ab.anchor.z, d.x, d.z, def.width); }
    ab.effects.push(fx);
    ab.cooldowns[key] = def.cooldown;
    abilities.cancel();
    return true;
  },
  update(dt) {
    for (const k of Object.keys(ab.cooldowns)) ab.cooldowns[k] = Math.max(0, ab.cooldowns[k] - dt);
    for (let k = ab.effects.length - 1; k >= 0; k--) if (!ab.effects[k].update(dt)) ab.effects.splice(k, 1);
    updateParticles(dt);
    refreshBar();
  },
};

// Prompt that rides just above the cursor while an ability with a `hint` is armed.
const mouse = { x: innerWidth / 2, y: innerHeight / 2 };
function showHint() {
  const el = document.getElementById('cursorhint'), text = ab.armed ? ABILITIES[ab.armed].hint : null;
  if (!text) { if (!el.hidden) el.hidden = true; return; }
  if (el.textContent !== text) el.textContent = text;
  el.hidden = false;
  el.style.left = `${mouse.x}px`;
  el.style.top = `${mouse.y}px`;
}

// ---------------------------------------------------------------- bottom bar UI
function buildBar() {
  const bar = document.getElementById('abilities');
  for (const [key, def] of Object.entries(ABILITIES)) {
    const b = document.createElement('button');
    b.className = 'ability';
    b.innerHTML = `<span class="key">${def.key}</span><span class="icon">${iconImg(`ab_${key}`)}</span><span class="name${def.name.length > 22 ? ' long' : ''}">${def.name}</span><span class="cd"></span><span class="cdtext"></span>`;
    b.title = def.desc;
    b.addEventListener('click', () => abilities.arm(key));
    bar.appendChild(b);
    ab.buttons[key] = b;
  }
}
const barCache = {};
function refreshBar() {
  for (const [key, b] of Object.entries(ab.buttons)) {
    const cd = ab.cooldowns[key], def = ABILITIES[key];
    const sig = `${ab.armed === key}|${Math.ceil(cd)}`;
    if (barCache[key] === sig) continue;
    barCache[key] = sig;
    b.classList.toggle('active', ab.armed === key);
    b.classList.toggle('cooling', cd > 0);
    b.querySelector('.cd').style.height = `${(cd / def.cooldown) * 100}%`;
    b.querySelector('.cdtext').textContent = cd > 0 ? Math.ceil(cd) : '';
  }
}
