import * as THREE from 'three';
import { state, damageEnemy, eachEnemy, burst, aimY } from './game.js';
import { heightAt } from './terrain.js';
import { makeTracer } from './entities.js';
import { explode } from './effects.js';
import { puff } from './particles.js';
import { audio } from './audio.js';

// Titan Support Airship: a 2x3 mooring pad and one big rigid airship. Same cycle as the gunship pad (lift off, fight
// until the magazines are empty or nothing is left, come home, rearm), but slow, high, and carrying four weapon
// systems: twin gatling cannons, twin HMGs, a belly artillery piece and a bomb bay it empties straight down.
const mats = {
  deck: new THREE.MeshStandardMaterial({ color: 0x353a42, roughness: 0.85, metalness: 0.2 }),
  edge: new THREE.MeshStandardMaterial({ color: 0x1c1f25, roughness: 0.7, metalness: 0.4 }),
  paint: new THREE.MeshStandardMaterial({ color: 0xe8e4d8, roughness: 0.7 }),
  hazard: new THREE.MeshStandardMaterial({ color: 0xe0a020, roughness: 0.6 }),
  lamp: new THREE.MeshStandardMaterial({ color: 0x60ff90, emissive: 0x30ff70, emissiveIntensity: 2.5 }),
  lampBusy: new THREE.MeshStandardMaterial({ color: 0xffb040, emissive: 0xff8a20, emissiveIntensity: 2.5 }),
  cable: new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.6, metalness: 0.5 }),
  envelope: new THREE.MeshStandardMaterial({ color: 0xb4bac0, roughness: 0.55, metalness: 0.45, flatShading: true }),
  envelopeDark: new THREE.MeshStandardMaterial({ color: 0x7c848d, roughness: 0.55, metalness: 0.5, flatShading: true }),
  rib: new THREE.MeshStandardMaterial({ color: 0x59616b, roughness: 0.5, metalness: 0.6 }),
  nose: new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.5, metalness: 0.6, flatShading: true }),
  stripe: new THREE.MeshStandardMaterial({ color: 0xb8322a, roughness: 0.6, metalness: 0.2, side: THREE.DoubleSide }),
  fin: new THREE.MeshStandardMaterial({ color: 0x9aa1a9, roughness: 0.55, metalness: 0.45, side: THREE.DoubleSide }),
  gondola: new THREE.MeshStandardMaterial({ color: 0x3c434c, roughness: 0.45, metalness: 0.6 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.6, metalness: 0.5 }),
  metal: new THREE.MeshStandardMaterial({ color: 0x565c65, roughness: 0.4, metalness: 0.85 }),
  window: new THREE.MeshStandardMaterial({ color: 0xffd9a0, emissive: 0xffa040, emissiveIntensity: 1.4, roughness: 0.2 }),
  solar: new THREE.MeshStandardMaterial({ color: 0x14233f, roughness: 0.2, metalness: 0.8 }),
  sensor: new THREE.MeshStandardMaterial({ color: 0x60d0ff, emissive: 0x30a0ff, emissiveIntensity: 2.4 }),
  navRed: new THREE.MeshStandardMaterial({ color: 0xff2020, emissive: 0xff2020, emissiveIntensity: 3 }),
  navGreen: new THREE.MeshStandardMaterial({ color: 0x20ff40, emissive: 0x20ff40, emissiveIntensity: 3 }),
  propDisc: new THREE.MeshBasicMaterial({ color: 0x0c0d10, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
  flash: new THREE.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  shell: new THREE.MeshStandardMaterial({ color: 0x2b2f26, roughness: 0.5, metalness: 0.5 }),
  bomb: new THREE.MeshStandardMaterial({ color: 0x3d4a2a, roughness: 0.55, metalness: 0.3 }),
  bombBand: new THREE.MeshStandardMaterial({ color: 0xe0b020, roughness: 0.5 }),
};
const mk = (geo, mat, x, y, z, parent) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };
const MOOR = 1.1;                                                  // gondola keel height above the deck when moored

export function makeAirshipPad(g) {
  mk(new THREE.BoxGeometry(3.9, 0.3, 5.9), mats.edge, 0, 0.15, 0, g);
  mk(new THREE.BoxGeometry(3.5, 0.06, 5.5), mats.deck, 0, 0.33, 0, g).receiveShadow = true;
  mk(new THREE.TorusGeometry(1.35, 0.06, 6, 48).rotateX(Math.PI / 2), mats.paint, 0, 0.37, 0, g);
  mk(new THREE.BoxGeometry(0.14, 0.02, 1.5), mats.paint, -0.45, 0.38, 0, g).rotation.y = 0.32;                  // a big "A"
  mk(new THREE.BoxGeometry(0.14, 0.02, 1.5), mats.paint, 0.45, 0.38, 0, g).rotation.y = -0.32;
  mk(new THREE.BoxGeometry(0.7, 0.02, 0.13), mats.paint, 0, 0.38, 0.2, g);
  for (const z of [-2.3, 2.3]) mk(new THREE.BoxGeometry(3.2, 0.02, 0.18), mats.hazard, 0, 0.37, z, g);
  const lamps = [], cables = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 0, 1]) {
    mk(new THREE.CylinderGeometry(0.06, 0.08, 0.22, 8), mats.edge, sx * 1.8, 0.41, sz * 2.75, g);
    lamps.push(mk(new THREE.SphereGeometry(0.08, 8, 6), mats.lamp, sx * 1.8, 0.55, sz * 2.75, g));
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {            // mooring winches and their tethers
    mk(new THREE.CylinderGeometry(0.22, 0.26, 0.3, 10), mats.edge, sx * 1.45, 0.5, sz * 2.2, g);
    const len = Math.hypot(0.75, 2.7, 0.6);
    const c = mk(new THREE.CylinderGeometry(0.02, 0.02, len, 5), mats.cable, sx * 1.07, 0.5 + 1.35, sz * 1.9, g);
    c.lookAt(new THREE.Vector3(sx * 0.7, 3.4, sz * 1.6)); c.rotateX(Math.PI / 2);
    cables.push(c);
  }
  mk(new THREE.BoxGeometry(0.8, 0.55, 1.0), mats.edge, -1.4, 0.6, 0, g);                                        // magazine lockers
  mk(new THREE.BoxGeometry(0.6, 0.06, 0.8), mats.hazard, -1.4, 0.9, 0, g);
  const ship = makeAirship();
  ship.position.y = 0.36 + MOOR;
  g.add(ship);
  Object.assign(g.userData, { ship, lamps, cables });
}

function label(text) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#23272d';
  g.font = 'bold 96px "Arial Narrow", Arial, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 256, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
}
let titanLabel = null;

// Rigid airship, faces +z, origin at the gondola keel. Classic cigar hull with ring frames, cruciform tail and a long
// control car, brought up to date: ducted vectoring fans, a solar spine, sensor dome, LED strip lighting.
export function makeAirship() {
  titanLabel ??= label('TITAN');
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);
  const HULL_Y = 3.1, L = 5.6, R = 1.85;
  // envelope: faceted cigar, darker belly, dark nose cap, ring frames
  const prof = [];
  for (let k = 0; k <= 22; k++) { const u = k / 22, z = -L + 2 * L * u, r = R * Math.pow(Math.sin(Math.PI * Math.pow(u, 0.82)), 0.62); prof.push(new THREE.Vector2(Math.max(0.001, r), z)); }
  const hullGeo = new THREE.LatheGeometry(prof, 18).rotateX(Math.PI / 2);
  mk(hullGeo, mats.envelope, 0, HULL_Y, 0, body);
  const belly = mk(new THREE.LatheGeometry(prof, 18, Math.PI * 0.78, Math.PI * 0.44).rotateX(Math.PI / 2), mats.envelopeDark, 0, HULL_Y, 0, body);
  belly.scale.set(1.012, 1.012, 1.0);
  const radiusAt = (z) => { const u = (z + L) / (2 * L); return R * Math.pow(Math.sin(Math.PI * Math.pow(Math.min(1, Math.max(0, u)), 0.82)), 0.62); };
  for (const z of [-4.2, -3.0, -1.8, -0.6, 0.6, 1.8, 3.0, 4.2]) mk(new THREE.TorusGeometry(radiusAt(z) + 0.015, 0.035, 5, 18), mats.rib, 0, HULL_Y, z, body);
  mk(new THREE.ConeGeometry(radiusAt(L - 0.55) + 0.03, 0.75, 18).rotateX(Math.PI / 2), mats.nose, 0, HULL_Y, L - 0.25, body);
  mk(new THREE.CylinderGeometry(0.05, 0.08, 0.5, 8).rotateX(Math.PI / 2), mats.metal, 0, HULL_Y, L + 0.3, body);         // mooring probe
  // solar spine along the top, name on the flanks
  for (let k = 0; k < 6; k++) mk(new THREE.BoxGeometry(0.9, 0.04, 0.95), mats.solar, 0, HULL_Y + radiusAt(-2.7 + k * 1.08) - 0.02, -2.7 + k * 1.08, body);
  for (const sd of [-1, 1]) {
    const t = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.85), titanLabel);
    t.position.set(sd * (R + 0.02), HULL_Y + 0.25, 0.4); t.rotation.y = sd * Math.PI / 2; body.add(t);
    mk(new THREE.BoxGeometry(0.03, 0.12, 3.6), mats.stripe, sd * (R - 0.02), HULL_Y - 0.45, 0.4, body);
  }
  // cruciform tail: four fins with red rudder tips
  const finShape = new THREE.Shape();
  finShape.moveTo(-2.6, 0.6); finShape.lineTo(-4.4, 2.1); finShape.lineTo(-5.4, 2.1); finShape.lineTo(-5.3, 0.25); finShape.closePath();
  const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.1, bevelEnabled: false }).translate(0, 0, -0.05).rotateY(-Math.PI / 2);
  const tipShape = new THREE.Shape();
  tipShape.moveTo(-4.95, 1.2); tipShape.lineTo(-5.42, 1.2); tipShape.lineTo(-5.4, 2.12); tipShape.lineTo(-4.9, 2.12); tipShape.closePath();
  const tipGeo = new THREE.ExtrudeGeometry(tipShape, { depth: 0.13, bevelEnabled: false }).translate(0, 0, -0.065).rotateY(-Math.PI / 2);
  for (let k = 0; k < 4; k++) {
    const f = new THREE.Group();
    f.position.y = HULL_Y; f.rotation.z = k * Math.PI / 2 + Math.PI / 4;
    mk(finGeo, mats.fin, 0, 0, 0, f); mk(tipGeo, mats.stripe, 0, 0, 0, f);
    body.add(f);
  }
  mk(new THREE.SphereGeometry(0.07, 8, 6), mats.navRed, 0, HULL_Y, -L - 0.05, body);

  // control car: long gondola with a lit window band, bridge glazing, keel, sensor dome
  const car = new THREE.Group();
  car.position.set(0, 0, 0.9);
  body.add(car);
  mk(new THREE.BoxGeometry(1.25, 0.95, 4.6), mats.gondola, 0, 0.62, 0, car);
  mk(new THREE.BoxGeometry(1.05, 0.28, 4.2), mats.dark, 0, 0.12, 0, car);
  mk(new THREE.BoxGeometry(1.28, 0.24, 3.9), mats.window, 0, 0.78, -0.1, car);
  for (let k = 0; k < 9; k++) mk(new THREE.BoxGeometry(1.3, 0.26, 0.07), mats.gondola, 0, 0.78, -1.85 + k * 0.44, car);
  const bridge = mk(new THREE.BoxGeometry(1.1, 0.5, 0.06), mats.window, 0, 0.72, 2.32, car); bridge.rotation.x = -0.3;
  mk(new THREE.SphereGeometry(0.26, 12, 10), mats.dark, 0, 0.02, 1.7, car);
  mk(new THREE.SphereGeometry(0.1, 8, 6), mats.sensor, 0, -0.16, 1.82, car);
  for (const z of [-1.6, 0, 1.6]) for (const sd of [-1, 1]) mk(new THREE.CylinderGeometry(0.035, 0.035, 1.5, 5), mats.metal, sd * 0.5, 1.75, z, car).rotation.z = sd * 0.22;   // struts to the hull
  mk(new THREE.CylinderGeometry(0.012, 0.02, 1.1, 5), mats.dark, 0.4, -0.5, -1.9, car);                                  // trailing aerial
  mk(new THREE.BoxGeometry(0.7, 0.05, 1.7), mats.dark, 0, -0.03, -0.9, car);                                              // bomb bay doors
  for (const sd of [-1, 1]) mk(new THREE.SphereGeometry(0.06, 6, 5), sd > 0 ? mats.navGreen : mats.navRed, sd * 0.66, 0.62, 2.2, car);

  // four ducted vectoring fans on outriggers
  const props = [], discs = [];
  for (const sd of [-1, 1]) for (const z of [1.9, -2.3]) {
    mk(new THREE.BoxGeometry(1.5, 0.09, 0.3), mats.rib, sd * 1.75, HULL_Y - 1.15, z, body).rotation.z = sd * -0.35;
    const pod = new THREE.Group();
    pod.position.set(sd * 2.55, HULL_Y - 1.45, z);
    mk(new THREE.TorusGeometry(0.52, 0.09, 8, 20), mats.gondola, 0, 0, 0, pod);
    mk(new THREE.CylinderGeometry(0.13, 0.09, 0.6, 8).rotateX(Math.PI / 2), mats.metal, 0, 0, -0.05, pod);
    const prop = new THREE.Group();
    for (let b = 0; b < 3; b++) { const bl = mk(new THREE.BoxGeometry(0.1, 0.95, 0.02), mats.dark, 0, 0, 0.12, prop); bl.rotation.z = b * Math.PI / 3; }
    pod.add(prop);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.48, 20), mats.propDisc.clone());
    disc.position.z = 0.12; pod.add(disc);
    body.add(pod);
    props.push(prop); discs.push(disc);
  }

  // weapons. Each mount: { pivot (aims), muzzle, flash }
  const flashMesh = () => { const f = new THREE.Group(); for (const r of [0, Math.PI / 2]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), mats.flash); p.rotation.set(0, Math.PI / 2, 0); p.rotateX(r); f.add(p); } f.visible = false; return f; };
  const mount = (x, y, z, barrelLen, barrels, parent) => {
    const base = new THREE.Group(); base.position.set(x, y, z); parent.add(base);
    mk(new THREE.SphereGeometry(0.2, 10, 8), mats.dark, 0, 0, 0, base);
    const pivot = new THREE.Group(); base.add(pivot);
    for (let k = 0; k < barrels; k++) { const a = k * Math.PI * 2 / barrels, r = barrels > 1 ? 0.045 : 0; mk(new THREE.CylinderGeometry(0.024, 0.024, barrelLen, 6).rotateX(Math.PI / 2), mats.metal, Math.cos(a) * r, Math.sin(a) * r, barrelLen / 2 + 0.1, pivot); }
    const muzzle = new THREE.Object3D(); muzzle.position.z = barrelLen + 0.15; pivot.add(muzzle);
    const flash = flashMesh(); flash.position.copy(muzzle.position); pivot.add(flash);
    return { pivot, muzzle, flash };
  };
  const gatlings = [mount(0.72, 0.3, 1.6, 0.85, 3, car), mount(-0.72, 0.3, 1.6, 0.85, 3, car)];
  const hmgs = [mount(0.72, 0.35, -1.7, 0.6, 1, car), mount(-0.72, 0.35, -1.7, 0.6, 1, car)];
  // belly howitzer: turret ring under the car with a long recoiling barrel
  const artBase = new THREE.Group(); artBase.position.set(0, -0.05, 0.55); car.add(artBase);
  mk(new THREE.CylinderGeometry(0.42, 0.36, 0.24, 14), mats.dark, 0, -0.08, 0, artBase);
  const artPivot = new THREE.Group(); artPivot.position.y = -0.22; artBase.add(artPivot);
  mk(new THREE.BoxGeometry(0.4, 0.3, 0.6), mats.gondola, 0, 0, 0.1, artPivot);
  const artBarrel = mk(new THREE.CylinderGeometry(0.075, 0.095, 1.9, 10).rotateX(Math.PI / 2), mats.metal, 0, 0, 1.2, artPivot);
  mk(new THREE.CylinderGeometry(0.12, 0.12, 0.25, 10).rotateX(Math.PI / 2), mats.dark, 0, 0, 2.1, artPivot);
  const artMuzzle = new THREE.Object3D(); artMuzzle.position.z = 2.3; artPivot.add(artMuzzle);
  const artFlash = flashMesh(); artFlash.scale.setScalar(2.4); artFlash.position.copy(artMuzzle.position); artPivot.add(artFlash);

  // ammo readout
  const canvas = document.createElement('canvas');
  canvas.width = 220; canvas.height = 96;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const hud = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, fog: false }));
  hud.scale.set(3.6, 3.6 * (96 / 220), 1);
  hud.renderOrder = 6;
  hud.visible = false;
  g.add(hud);
  Object.assign(g.userData, { body, props, discs, gatlings, hmgs, art: { pivot: artPivot, base: artBase, barrel: artBarrel, muzzle: artMuzzle, flash: artFlash }, hud, hudCanvas: canvas, hudTex: tex, hudSig: '' });
  return g;
}

function drawAmmo(ud, a, def) {
  const sig = `${a.gat[0] + a.gat[1]}|${a.hmg[0] + a.hmg[1]}|${a.shells}|${a.bombs}`;
  if (ud.hudSig === sig) return;
  ud.hudSig = sig;
  const c = ud.hudCanvas.getContext('2d'), W = ud.hudCanvas.width, H = ud.hudCanvas.height;
  c.clearRect(0, 0, W, H);
  c.fillStyle = 'rgba(8,10,14,0.62)'; c.beginPath(); c.roundRect(1, 1, W - 2, H - 2, 8); c.fill();
  c.strokeStyle = 'rgba(255,255,255,0.18)'; c.lineWidth = 1.5; c.stroke();
  const bar = (y, frac, col, icon) => {
    icon(12, y);
    for (let k = 0; k < 12; k++) {
      const fill = Math.max(0, Math.min(1, frac * 12 - k));
      c.fillStyle = 'rgba(255,255,255,0.13)'; c.fillRect(44 + k * 14, y, 12, 10);
      if (fill > 0) { c.fillStyle = frac <= 0.2 ? '#ff5a3c' : col; c.fillRect(44 + k * 14, y, 12 * fill, 10); }
    }
  };
  bar(9, (a.gat[0] + a.gat[1]) / (def.gatRounds * 2), '#ffd541', (x, y) => { c.fillStyle = '#d9a633'; c.fillRect(x, y + 1, 14, 8); c.fillStyle = '#e8e2d0'; c.beginPath(); c.moveTo(x + 14, y + 1); c.lineTo(x + 24, y + 5); c.lineTo(x + 14, y + 9); c.fill(); });
  bar(25, (a.hmg[0] + a.hmg[1]) / (def.hmgRounds * 2), '#ffb04a', (x, y) => { c.fillStyle = '#c08a2a'; c.fillRect(x + 4, y + 2, 10, 6); c.fillStyle = '#e8e2d0'; c.beginPath(); c.moveTo(x + 14, y + 2); c.lineTo(x + 21, y + 5); c.lineTo(x + 14, y + 8); c.fill(); });
  for (let k = 0; k < def.shells; k++) {                          // artillery shells: slim upright rounds
    const x = 12 + k * 7.9, live = k < a.shells;
    c.fillStyle = live ? '#d8c08a' : 'rgba(255,255,255,0.13)'; c.fillRect(x, 47, 5, 13);
    c.beginPath(); c.moveTo(x, 47); c.lineTo(x + 2.5, 41); c.lineTo(x + 5, 47); c.closePath(); c.fillStyle = live ? '#e5493b' : 'rgba(255,255,255,0.13)'; c.fill();
  }
  for (let k = 0; k < def.bombs; k++) {                           // bombs: fat drops with a fin
    const x = 12 + k * 6.6 + 2.5, live = k < a.bombs;
    c.fillStyle = live ? '#7f9144' : 'rgba(255,255,255,0.13)';
    c.beginPath(); c.ellipse(x, 78, 2.6, 6.5, 0, 0, Math.PI * 2); c.fill();
    c.fillRect(x - 2.8, 68, 5.6, 2.5);
    if (live) { c.fillStyle = '#ffd541'; c.fillRect(x - 2.4, 79, 4.8, 1.8); }
  }
  ud.hudTex.needsUpdate = true;
}

// ---------------------------------------------------------------- behaviour
const ALT = 12.5, SPEED = 5.2, GUN_RANGE = 17, ART_MIN = 7, ART_RANGE = 30, BOMB_RADIUS = 3.4;
const _a = new THREE.Vector3(), _b = new THREE.Vector3();
const shells = [], bombs = [];
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const rnd = (a, b) => a + Math.random() * (b - a);

function densest(x, z, r, minD = 0) {
  let best = null, score = -1;
  eachEnemy(x, z, r, (e, d2) => { if (d2 < minD * minD) return; let n = 0; eachEnemy(e.x, e.z, 4.5, () => { n++; }); if (n > score) { score = n; best = e; } });
  return best;
}

function fireGun(mnt, e, dmg, sound, vol, pos) {
  mnt.pivot.parent.updateWorldMatrix(true, false);
  mnt.pivot.lookAt(_b.set(e.x, aimY(e), e.z));
  mnt.muzzle.getWorldPosition(_a);
  _b.set(e.x + rnd(-0.4, 0.4), aimY(e) - 0.15 * e.def.scale, e.z + rnd(-0.4, 0.4));
  const tr = makeTracer(_a, _b);
  state.scene.add(tr);
  state.beams.push({ mesh: tr, life: 0.05, max: 0.05 });
  mnt.flash.visible = true; mnt.flash.rotation.z = Math.random() * Math.PI;
  damageEnemy(e, dmg);
  if (Math.random() < 0.25) burst(_b.x, _b.y, _b.z, 'soil', 1, 3);
  audio.play(sound, { x: pos.x, z: pos.z, vol });
}

export function updateAirshipOrdnance(dt) {
  for (let k = shells.length - 1; k >= 0; k--) {
    const sh = shells[k];
    sh.t += dt;
    const u = Math.min(1, sh.t / sh.dur);
    sh.m.position.lerpVectors(sh.from, sh.to, u);
    sh.m.position.y += Math.sin(u * Math.PI) * sh.arc;
    if (u >= 1) { explode(sh.to.x, sh.to.z, 2.4, sh.dmg, sh.splash, { shake: 0.2, smoke: 8 }); state.scene.remove(sh.m); shells.splice(k, 1); }
  }
  for (let k = bombs.length - 1; k >= 0; k--) {
    const b = bombs[k], p = b.m.position;
    b.vy -= 24 * dt;
    p.y += b.vy * dt; p.x += b.vx * dt; p.z += b.vz * dt;
    b.m.rotation.z += dt * 2;
    if (p.y <= heightAt(p.x, p.z) + 0.3) { explode(p.x, p.z, 2.0, b.dmg, b.splash, { shake: 0.15, smoke: 7 }); state.scene.remove(b.m); bombs.splice(k, 1); }
  }
}

export function updateAirship(s, dt) {
  const def = s.def, pad = s.mesh, ship = pad.userData.ship, ud = ship.userData;
  const A = (s.air ??= { mode: 'rearm', t: def.rearm * 0.5, gat: [def.gatRounds, def.gatRounds], hmg: [def.hmgRounds, def.hmgRounds], shells: def.shells, bombs: def.bombs,
    rpm: 0, vx: 0, vz: 0, yaw: 0, idle: 0, scan: 0, focus: null, gatCd: [0, 0.03], hmgCd: [0, 0.06], gunT: [null, null, null, null], gunScan: 0, artCd: 1.5, bombCd: 0, recoil: 0 });
  const moorY = s.y + 0.21 + MOOR, pos = ship.position;
  const full = A.gat[0] === def.gatRounds && A.gat[1] === def.gatRounds && A.hmg[0] === def.hmgRounds && A.hmg[1] === def.hmgRounds && A.shells === def.shells && A.bombs === def.bombs;

  // props, pad lamps, tethers, readout
  const wantRpm = A.mode === 'rearm' ? 0.12 : 1;
  A.rpm += (wantRpm - A.rpm) * Math.min(1, dt * (wantRpm > A.rpm ? 0.9 : 0.6));
  for (const p of ud.props) p.rotation.z += A.rpm * 40 * dt;
  for (const d of ud.discs) d.material.opacity = Math.max(0, A.rpm - 0.4) * 0.5;
  const lamp = A.mode === 'rearm' ? mats.lampBusy : mats.lamp;
  for (const l of pad.userData.lamps) if (l.material !== lamp) l.material = lamp;
  for (const c of pad.userData.cables) c.visible = A.mode === 'rearm';
  const prog = A.mode === 'rearm' ? 1 - Math.max(0, A.t) / def.rearm : 0, fill = (now, max) => (A.mode === 'rearm' ? Math.round(now + (max - now) * prog) : now);
  ud.hud.visible = A.mode !== 'rearm' || (A.t > 0 && !full);
  ud.hud.position.y = A.mode === 'rearm' ? 6.2 : -1.6;
  if (ud.hud.visible) drawAmmo(ud, { gat: [fill(A.gat[0], def.gatRounds), fill(A.gat[1], def.gatRounds)], hmg: [fill(A.hmg[0], def.hmgRounds), fill(A.hmg[1], def.hmgRounds)], shells: fill(A.shells, def.shells), bombs: fill(A.bombs, def.bombs) }, def);
  for (const m of [...ud.gatlings, ...ud.hmgs]) m.flash.visible = false;
  ud.art.flash.visible = false;
  A.recoil = Math.max(0, A.recoil - dt * 2.5);
  ud.art.barrel.position.z = 1.2 - 0.45 * A.recoil;

  if (A.mode === 'rearm') {
    A.t -= dt;
    if (A.t <= 0) {
      A.gat = [def.gatRounds, def.gatRounds]; A.hmg = [def.hmgRounds, def.hmgRounds]; A.shells = def.shells; A.bombs = def.bombs;
      if (densest(s.x, s.z, def.range)) {
        A.mode = 'takeoff'; A.t = 0;
        state.scene.attach(ship);
        A.yaw = ship.rotation.y;
        if (!s.snd) s.snd = audio.loop('airship_engine', { x: s.x, z: s.z, vol: 0.6 });
      }
    }
    return;
  }

  // where to go: park over the thickest knot of bugs so the bomb bay can work, guns cover everything around
  const empty = A.gat[0] + A.gat[1] + A.hmg[0] + A.hmg[1] + A.shells + A.bombs === 0;
  if (A.mode === 'attack') {
    A.scan -= dt;
    if (A.focus && (A.focus.dead || Math.hypot(A.focus.x - s.x, A.focus.z - s.z) > def.range + 8)) A.focus = null;
    if (A.scan <= 0 || !A.focus) { A.scan = 1.0; A.focus = densest(pos.x, pos.z, 34) || densest(s.x, s.z, def.range); }
    if (empty) { A.mode = 'return'; A.focus = null; }
    else if (!A.focus) { A.idle += dt; if (A.idle > 3) A.mode = 'return'; } else A.idle = 0;
  }
  let gx = s.x, gz = s.z, gy = moorY + ALT;
  if (A.mode === 'takeoff') { A.t += dt; gy = moorY + ALT * Math.min(1, A.t / 4); if (A.t > 4.2) { A.mode = 'attack'; A.idle = 0; } }
  else if (A.mode === 'attack') {
    if (A.focus) { gx = A.focus.x; gz = A.focus.z; } else { gx = pos.x; gz = pos.z; }
    gy = Math.max(heightAt(pos.x, pos.z), heightAt(gx, gz)) + ALT;
  } else if (A.mode === 'land') gy = moorY;

  const tx = gx - pos.x, tz = gz - pos.z, td = Math.hypot(tx, tz);
  const want = Math.min(SPEED, td * 0.8), acc = Math.min(1, dt * 0.7);
  A.vx += ((td > 0.01 ? tx / td * want : 0) - A.vx) * acc; A.vz += ((td > 0.01 ? tz / td * want : 0) - A.vz) * acc;
  pos.x += A.vx * dt; pos.z += A.vz * dt;
  const floor = heightAt(pos.x, pos.z) + (A.mode === 'land' || A.mode === 'takeoff' ? 0 : 6);
  pos.y += (Math.max(gy, floor) - pos.y) * Math.min(1, dt * (A.mode === 'land' ? 0.9 : 0.7));
  const speed = Math.hypot(A.vx, A.vz);
  const faceYaw = A.mode === 'land' ? 0 : speed > 0.6 ? Math.atan2(A.vx, A.vz) : A.yaw;
  A.yaw += wrap(faceYaw - A.yaw) * Math.min(1, dt * 0.7);
  ship.rotation.y = A.yaw;
  ud.body.rotation.set(-speed * 0.012 + Math.sin(state.time * 0.6) * 0.012, 0, Math.sin(state.time * 0.45 + 1) * 0.02);
  ud.body.position.y = Math.sin(state.time * 0.8) * 0.08;
  if (s.snd) s.snd.setPos(pos.x, pos.z);

  if (A.mode === 'return' && td < 0.5 && speed < 0.8) A.mode = 'land';
  if (A.mode === 'land' && pos.y - moorY < 0.06 && Math.abs(wrap(A.yaw)) < 0.08) {
    pad.attach(ship);
    ship.position.set(0, 0.36 + MOOR, 0); ship.rotation.set(0, 0, 0);
    ud.body.rotation.set(0, 0, 0); ud.body.position.y = 0;
    A.vx = A.vz = 0; A.mode = 'rearm'; A.t = def.rearm;
    if (s.snd) { s.snd.stop(); s.snd = null; }
    return;
  }
  if (A.mode !== 'attack') return;

  // guns: every mount keeps its own target (gatlings forward pair, HMGs aft pair), re-picked a few times a second
  A.gunScan -= dt;
  if (A.gunScan <= 0) {
    A.gunScan = 0.3;
    const near = [];
    eachEnemy(pos.x, pos.z, GUN_RANGE, (e, d2) => { near.push([d2, e]); });
    near.sort((p, q) => p[0] - q[0]);
    for (let k = 0; k < 4; k++) A.gunT[k] = near.length ? near[Math.min(near.length - 1, k % Math.max(1, Math.min(4, near.length)))][1] : null;
  }
  const guns = [[ud.gatlings[0], A.gat, 0, A.gatCd, def.gatRate, def.damage, 0.34], [ud.gatlings[1], A.gat, 1, A.gatCd, def.gatRate, def.damage, 0.34],
    [ud.hmgs[0], A.hmg, 0, A.hmgCd, def.hmgRate, def.hmgDamage, 0.26], [ud.hmgs[1], A.hmg, 1, A.hmgCd, def.hmgRate, def.hmgDamage, 0.26]];
  guns.forEach(([mnt, mag, i, cds, rate, dmg, vol], k) => {
    cds[i] -= dt;
    const e = A.gunT[k];
    if (!e || e.dead || mag[i] <= 0 || cds[i] > 0) return;
    cds[i] = 1 / rate;
    mag[i]--;
    fireGun(mnt, e, dmg, 'hmg_fire', vol, pos);
  });

  // artillery: lobs a heavy shell into the densest group it can reach (not straight down: that is the bombs' job)
  A.artCd -= dt;
  if (A.shells > 0 && A.artCd <= 0) {
    const e = densest(pos.x, pos.z, ART_RANGE, ART_MIN);
    if (e) {
      A.artCd = 1 / def.artRate; A.shells--; A.recoil = 1;
      ud.art.base.parent.updateWorldMatrix(true, false);
      ud.art.pivot.lookAt(_b.set(e.x, heightAt(e.x, e.z), e.z));
      ud.art.muzzle.getWorldPosition(_a);
      const l = Math.hypot(e.fx, e.fz) || 1, dur = 0.9 + Math.hypot(e.x - _a.x, e.z - _a.z) * 0.03;
      const ex = e.x + (e.fx / l) * e.speed * dur * 0.8, ez = e.z + (e.fz / l) * e.speed * dur * 0.8;
      const m = mk(new THREE.CapsuleGeometry(0.09, 0.3, 4, 8), mats.shell, 0, 0, 0, state.scene);
      m.position.copy(_a);
      shells.push({ m, from: _a.clone(), to: new THREE.Vector3(ex, heightAt(ex, ez), ez), t: 0, dur, arc: 2.5, dmg: def.artDamage, splash: def.artSplash });
      ud.art.flash.visible = true;
      puff(_a.x, _a.y, _a.z, { color: 0xd8d0c4, size: 1.6, grow: 3, life: 0.9, opacity: 0.6 });
      audio.play('mortar_fire', { x: pos.x, z: pos.z, vol: 1 });
      state.shake += 0.08;
    } else A.artCd = 0.4;
  }

  // bombs: released whenever something is walking underneath
  A.bombCd -= dt;
  if (A.bombs > 0 && A.bombCd <= 0) {
    let under = false;
    eachEnemy(pos.x, pos.z, BOMB_RADIUS, () => { under = true; return true; });
    if (under) {
      A.bombCd = 1 / def.bombRate; A.bombs--;
      const m = new THREE.Group();
      mk(new THREE.CapsuleGeometry(0.17, 0.5, 4, 10), mats.bomb, 0, 0, 0, m);
      mk(new THREE.CylinderGeometry(0.178, 0.178, 0.09, 10), mats.bombBand, 0, -0.18, 0, m);
      for (let k = 0; k < 2; k++) mk(new THREE.BoxGeometry(0.42, 0.26, 0.02), mats.shell, 0, 0.42, 0, m).rotation.y = k * Math.PI / 2;
      ship.localToWorld(m.position.set(rnd(-0.2, 0.2), -0.1, rnd(-0.6, 0.3)));
      state.scene.add(m);
      bombs.push({ m, vx: A.vx + rnd(-0.6, 0.6), vy: -1, vz: A.vz + rnd(-0.6, 0.6), dmg: def.bombDamage, splash: def.bombSplash });
      if (Math.random() < 0.4) audio.play('artillery_whistle', { x: pos.x, z: pos.z, vol: 0.4 });
    } else A.bombCd = 0.15;
  }
}

// Pad destroyed or sold: a moored ship goes with the pad; one that is out comes down in flames where it is.
export function removeAirship(s) {
  const ship = s.mesh.userData.ship;
  if (!ship || !ship.parent || ship.parent === s.mesh) return;
  const p = ship.position;
  explode(p.x, p.z, 3.4, 0, 0, { shake: 0.8, smoke: 16 });
  for (let k = 0; k < 3; k++) burst(p.x + rnd(-3, 3), p.y + 3, p.z + rnd(-3, 3), 'debris', 14, 12);
  ship.parent.remove(ship);
}
