import * as THREE from 'three';
import { heightAt } from './terrain.js';
import { state, damageEnemy, burst, log } from './game.js';
import { spawnScorch } from './decals.js';
import { puff, killPuff, updateParticles } from './particles.js';
import { explode, impactRing, damageCircle } from './effects.js';
import { audio } from './audio.js';

// ---------------------------------------------------------------- definitions
export const ABILITIES = {
  lance:     { name: 'Orbital Lance',    icon: '🔆', key: '1', cooldown: 25, radius: 5,  desc: 'Orbital beams converge into one devastating strike.' },
  laser:     { name: 'Orbital Laser',    icon: '🔦', key: '2', cooldown: 20, radius: 1.5, desc: 'Sustained beam that follows your cursor for 6 s.' },
  strafe:    { name: 'Strafing Run',     icon: '✈️', key: '3', cooldown: 25, length: 24, width: 6, desc: 'Three jets rake a long strip with rockets and cannon fire.' },
  artillery: { name: 'Artillery Strike', icon: '💣', key: '4', cooldown: 25, radius: 6,  desc: 'A dozen HE shells rain across the area.' },
  nuke:      { name: 'Nuclear Strike',   icon: '☢️', key: '5', cooldown: 60, radius: 12, desc: '10 s countdown, then an ICBM levels the whole area.' },
};

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3(), _w = new THREE.Vector3();
const rnd = (a = 0, b = 1) => a + Math.random() * (b - a);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const easeOut = (p) => 1 - Math.pow(1 - clamp01(p), 3);

const ab = { scene: null, ui: null, armed: null, cooldowns: {}, effects: [], reticle: null, hover: null, laser: null, buttons: {} };

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
        explode(x, z, 3.2, 520, R * 1.1, { color: 0x7fd0ff, shake: 1.3, smoke: 14 });
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
    damageCircle(P.x, P.z, 1.6, 75 * dt * w, 0.6);
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
  const SPEED = 30, ALT = 12, START = -62, END = 62;
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
        jetPos.set(cx + dx * a + px * j.side, Math.max(gy + 6, heightAt(cx, cz) + ALT), cz + dz * a + pz * j.side);
        j.mesh.position.copy(jetPos);
        j.mesh.lookAt(jetPos.x + dx, jetPos.y, jetPos.z + dz);
        j.mesh.rotation.z = Math.sin(t * 1.5 + j.side) * 0.08;
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
            const ta = Math.min(len / 2, a + 8 + rnd(0, 6)), tb = j.side * 0.6 + rnd(-wid / 2, wid / 2) * 0.8;
            const tx = cx + dx * ta + px * tb, tz = cz + dz * ta + pz * tb;
            const to = new THREE.Vector3(tx, heightAt(tx, tz), tz);
            const tr = makeBeam(0xffc060, 0.08);
            setBeam(tr, jetPos, to, 1);
            ab.scene.add(tr);
            tracers.push({ tr, life: 0.07 });
            puff(tx, to.y + 0.2, tz, { color: 0xc9a070, size: 0.9, grow: 2.2, life: 0.5, opacity: 0.6, vy: 1.5 });
            puff(tx, to.y + 0.3, tz, { color: 0xffd090, size: 0.7, life: 0.12, opacity: 0.9, additive: true });
            burst(tx, to.y + 0.2, tz, 'soil', 2, 5);
            impactRing(tx, to.y, tz, 1.8);
            damageCircle(tx, tz, 1.8, 9, 0.6);
            audio.play('hmg_fire', { x: tx, z: tz, vol: 0.35 });
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
          explode(r.target.x, r.target.z, 1.4, 48, 2.4, { shake: 0.12, smoke: 5 });
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
  const count = 10 + Math.floor(Math.random() * 3);
  const times = Array.from({ length: count }, (_, i) => 0.3 + (i / count) * 3.0 + rnd(0, 0.2));
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
          explode(s.target.x, s.target.z, 1.7, 75, 2.8, { shake: 0.3, smoke: 7 });
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
  const T_LAUNCH = 8.2, T_HIT = 10, T_END = 26;
  let t = 0, shown = -1, icbm = null, hit = false, ball = null, wave = null, wave2 = null, stemT = 0, capT = 0;
  const start = new THREE.Vector3(cx - 45, gy + 140, cz - 30);
  const target = new THREE.Vector3(cx, gy, cz);
  log('NUCLEAR STRIKE AUTHORISED. Impact in 10 seconds.', true);
  return {
    update(dt) {
      t += dt;
      if (!hit) {
        const left = Math.ceil(T_HIT - t);
        if (left !== shown) { shown = left; label.userData.set(String(Math.max(0, left)), left <= 3 ? '#ff3030' : '#ffb040'); audio.play('nuke_beep', { hi: left <= 3, vol: 0.9 }); }
        const pulse = 1 + 0.03 * Math.sin(t * (4 + t));
        ring.scale.set(pulse, 1, pulse); ring.position.set(cx * (1 - pulse), 0, cz * (1 - pulse));
        fill.material.opacity = 0.12 + 0.1 * Math.abs(Math.sin(t * 3));
        inner.rotation.y += dt * 0.6;
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
          ball = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 18), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
          ball.position.set(cx, gy + 2, cz);
          ab.scene.add(ball);
          const mkRing = (c) => { const m = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false })); m.rotation.x = -Math.PI / 2; m.position.set(cx, gy + 0.4, cz); ab.scene.add(m); return m; };
          wave = mkRing(0xffe0a0); wave2 = mkRing(0xffffff);
          for (let k = 0; k < 40; k++) {
            const a = rnd(0, Math.PI * 2), sp = rnd(14, 26);
            puff(cx, gy + 1, cz, { color: 0xb0987a, size: 3, grow: 6, life: rnd(2, 3.5), opacity: 0.7, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: rnd(1, 3), drag: 1.2 });
          }
          burst(cx, gy + 1, cz, 'debris', 30, 40);
          burst(cx, gy + 1, cz, 'soil', 30, 40);
          spawnScorch(ab.scene, cx, cz, R * 1.6);
          damageCircle(cx, cz, R * 1.35, 3000, 0.25);
          state.shake += 3.5;
          log('Nuclear detonation!', true);
        }
      } else {
        const a = t - T_HIT;
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
        } else if (ball) { ab.scene.remove(ball, wave, wave2); ball = null; }
        // mushroom cloud: rising stem and expanding cap
        // Stem: a narrow, fast-rising column of dark smoke lit orange while the fireball is hot.
        stemT += dt;
        if (a < 7 && stemT > 0.05) {
          stemT = 0;
          const heat = clamp01(1 - a / 3);
          const col = new THREE.Color(0x2e2924).lerp(new THREE.Color(0xff7030), heat * 0.75);
          const ang = rnd(0, Math.PI * 2), rr = rnd(0, 1.4);
          puff(cx + Math.cos(ang) * rr, gy + 1, cz + Math.sin(ang) * rr, { color: col.getHex(), size: 2.6, grow: 1.1, life: 9, opacity: 0.9, vy: rnd(12, 16), vx: Math.cos(ang) * 0.4, vz: Math.sin(ang) * 0.4, drag: 0.1, fadeIn: 0.3 });
        }
        // Cap: a broad ring of lighter cloud spreading outward at the top of the stem, with a fiery underside early on.
        capT += dt;
        if (a > 0.6 && a < 9 && capT > 0.035) {
          capT = 0;
          const ang = rnd(0, Math.PI * 2), sp = rnd(2, 5);
          const heat = clamp01(1 - a / 4);
          const col = new THREE.Color(0x8a8078).lerp(new THREE.Color(0xffa050), heat * 0.55);
          const top = gy + 2 + Math.min(30, 10 + a * 5);
          const r0 = 2.5 + Math.min(6, a * 1.2);
          puff(cx + Math.cos(ang) * r0, top + rnd(-2, 2), cz + Math.sin(ang) * r0, { color: col.getHex(), size: 6.5, grow: 2.0, life: 10, opacity: 0.5, vx: Math.cos(ang) * sp, vz: Math.sin(ang) * sp, vy: rnd(1.2, 2.6), drag: 0.3, fadeIn: 0.5 });
          if (a < 3 && Math.random() < 0.5) puff(cx + Math.cos(ang) * r0 * 0.6, top - 3, cz + Math.sin(ang) * r0 * 0.6, { color: 0xff9040, size: 6, grow: 1.5, life: 2.5, opacity: 0.4, additive: true, vy: 1.5, drag: 0.5 });
        }
        ring.material.opacity = Math.max(0, 0.9 - a * 0.5); fill.material.opacity = Math.max(0, 0.2 - a * 0.1); inner.material.opacity = ring.material.opacity;
      }
      if (t >= T_END) {
        ab.scene.remove(ring, fill, inner);
        for (const m of [ring, fill, inner]) { m.geometry.dispose(); m.material.dispose(); }
        return false;
      }
      return true;
    },
  };
}

// ---------------------------------------------------------------- targeting / activation
function buildReticle(key, p) {
  const def = ABILITIES[key];
  const color = key === 'nuke' ? 0xff4040 : key === 'strafe' ? 0xffb040 : key === 'artillery' ? 0xff8040 : 0x7fe0ff;
  const g = new THREE.Group();
  if (def.length) {
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
  }
  return g;
}
function dirFromCore(p) {
  const d = new THREE.Vector3(p.x, 0, p.z);
  if (d.lengthSq() < 1) d.set(0, 0, 1);
  return d.normalize().negate();          // jets fly from the map edge in toward the base
}

export const abilities = {
  init({ scene, ui }) {
    ab.scene = scene;
    ab.ui = ui;
    for (const k of Object.keys(ABILITIES)) ab.cooldowns[k] = 0;
    buildBar();
    addEventListener('keydown', (e) => {
      if (state.intro || state.gameOver) return;
      const hit = Object.entries(ABILITIES).find(([, d]) => d.key === e.key);
      if (hit) abilities.arm(hit[0]);
    });
  },
  get armed() { return ab.armed; },
  get laserActive() { return !!ab.laser; },
  arm(key) {
    if (ab.cooldowns[key] > 0) return log(`${ABILITIES[key].name} recharging (${Math.ceil(ab.cooldowns[key])} s)`, true);
    if (ab.armed === key) return abilities.cancel();
    abilities.cancel();
    ab.ui.cancel();
    ab.ui.showSelected(null);
    ab.armed = key;
    refreshBar();
  },
  cancel() {
    ab.armed = null;
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
  click(p) {
    if (p && ab.laser) ab.laser.guide(p);
    if (!ab.armed) return false;
    const key = ab.armed, def = ABILITIES[key];
    let fx;
    if (key === 'lance') fx = orbitalLance(p.x, p.z, def.radius);
    else if (key === 'laser') fx = orbitalLaser(p.x, p.z);
    else if (key === 'strafe') { const d = dirFromCore(p); fx = strafingRun(p.x, p.z, d.x, d.z, def.length, def.width); }
    else if (key === 'artillery') fx = artilleryStrike(p.x, p.z, def.radius);
    else if (key === 'nuke') fx = nuclearStrike(p.x, p.z, def.radius);
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

// ---------------------------------------------------------------- bottom bar UI
function buildBar() {
  const bar = document.getElementById('abilities');
  for (const [key, def] of Object.entries(ABILITIES)) {
    const b = document.createElement('button');
    b.className = 'ability';
    b.innerHTML = `<span class="key">${def.key}</span><span class="icon">${def.icon}</span><span class="name">${def.name}</span><span class="cd"></span><span class="cdtext"></span>`;
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
