import * as THREE from 'three';
import { state, damageEnemy, eachEnemy, burst, aimY } from './game.js';
import { heightAt } from './terrain.js';
import { makeTracer } from './entities.js';
import { explode } from './effects.js';
import { puff } from './particles.js';
import { audio } from './audio.js';

// Gunship Pad: a 2x2 pad with a heavy VTOL gunship parked on it. The aircraft lifts off, hunts the nearest bugs,
// empties its gatling and rocket pods, then flies home and spends def.rearm seconds on the pad before going again.
const mats = {
  pad: new THREE.MeshStandardMaterial({ color: 0x3b4048, roughness: 0.85, metalness: 0.2 }),
  padEdge: new THREE.MeshStandardMaterial({ color: 0x1d2026, roughness: 0.7, metalness: 0.4 }),
  paint: new THREE.MeshStandardMaterial({ color: 0xe8e4d8, roughness: 0.7 }),
  hazard: new THREE.MeshStandardMaterial({ color: 0xe0a020, roughness: 0.6 }),
  lamp: new THREE.MeshStandardMaterial({ color: 0x60ff90, emissive: 0x30ff70, emissiveIntensity: 2.5 }),
  lampBusy: new THREE.MeshStandardMaterial({ color: 0xffb040, emissive: 0xff8a20, emissiveIntensity: 2.5 }),
  skin: new THREE.MeshStandardMaterial({ color: 0xcdd0cc, roughness: 0.55, metalness: 0.3 }),
  skinDark: new THREE.MeshStandardMaterial({ color: 0xb4b8b5, roughness: 0.6, metalness: 0.3 }),
  panel: new THREE.MeshStandardMaterial({ color: 0x8f9594, roughness: 0.5, metalness: 0.5 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.6, metalness: 0.4 }),
  blue: new THREE.MeshStandardMaterial({ color: 0x2c4a94, roughness: 0.5, metalness: 0.3 }),
  orange: new THREE.MeshStandardMaterial({ color: 0xe2572a, roughness: 0.55, metalness: 0.2 }),
  amber: new THREE.MeshStandardMaterial({ color: 0xf08a2a, emissive: 0xd8600c, emissiveIntensity: 0.9, roughness: 0.2, metalness: 0.5 }),
  pod: new THREE.MeshStandardMaterial({ color: 0x566a82, roughness: 0.5, metalness: 0.45 }),
  podDark: new THREE.MeshStandardMaterial({ color: 0x3a4a5e, roughness: 0.5, metalness: 0.5 }),
  jetGlow: new THREE.MeshStandardMaterial({ color: 0xffc080, emissive: 0xff7a20, emissiveIntensity: 0.4 }),
  jetFlame: new THREE.MeshBasicMaterial({ color: 0x7ab8ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  jetCore: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  hull: new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.38, metalness: 0.65, flatShading: true }),
  hullTrim: new THREE.MeshStandardMaterial({ color: 0x23272e, roughness: 0.45, metalness: 0.7, flatShading: true }),
  glass: new THREE.MeshStandardMaterial({ color: 0x0a1418, emissive: 0x0c3a48, emissiveIntensity: 0.5, roughness: 0.08, metalness: 0.95 }),
  metal: new THREE.MeshStandardMaterial({ color: 0x4a4f57, roughness: 0.4, metalness: 0.85 }),
  sensor: new THREE.MeshStandardMaterial({ color: 0xff4030, emissive: 0xff2010, emissiveIntensity: 2.6 }),
  blade: new THREE.MeshStandardMaterial({ color: 0x0c0d0f, roughness: 0.6, metalness: 0.3 }),
  disc: new THREE.MeshBasicMaterial({ color: 0x0a0a0c, transparent: true, opacity: 0.0, depthWrite: false, side: THREE.DoubleSide }),
  navRed: new THREE.MeshStandardMaterial({ color: 0xff2020, emissive: 0xff2020, emissiveIntensity: 3 }),
  navGreen: new THREE.MeshStandardMaterial({ color: 0x20ff40, emissive: 0x20ff40, emissiveIntensity: 3 }),
  rocket: new THREE.MeshStandardMaterial({ color: 0xd8dadd, roughness: 0.4, metalness: 0.5 }),
  rocketTip: new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.5 }),
  flash: new THREE.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
};
const mk = (geo, mat, x, y, z, parent) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };

export function makeHelipad(g) {
  mk(new THREE.BoxGeometry(3.9, 0.3, 3.9), mats.padEdge, 0, 0.15, 0, g);
  mk(new THREE.CylinderGeometry(1.8, 1.8, 0.06, 40), mats.pad, 0, 0.33, 0, g).receiveShadow = true;
  mk(new THREE.TorusGeometry(1.55, 0.06, 6, 48).rotateX(Math.PI / 2), mats.paint, 0, 0.36, 0, g);
  for (const x of [-0.42, 0.42]) mk(new THREE.BoxGeometry(0.16, 0.02, 1.3), mats.paint, x, 0.37, 0, g);        // the H
  mk(new THREE.BoxGeometry(0.84, 0.02, 0.16), mats.paint, 0, 0.37, 0, g);
  const lamps = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    mk(new THREE.BoxGeometry(0.7, 0.04, 0.7), mats.hazard, sx * 1.55, 0.31, sz * 1.55, g);
    mk(new THREE.CylinderGeometry(0.06, 0.08, 0.22, 8), mats.padEdge, sx * 1.75, 0.41, sz * 1.75, g);
    lamps.push(mk(new THREE.SphereGeometry(0.08, 8, 6), mats.lamp, sx * 1.75, 0.55, sz * 1.75, g));
  }
  mk(new THREE.BoxGeometry(0.7, 0.5, 0.45), mats.padEdge, -1.45, 0.55, 0, g);                                   // ammo lockers
  mk(new THREE.BoxGeometry(0.5, 0.06, 0.3), mats.hazard, -1.45, 0.82, 0, g);
  const heli = makeHeli();
  heli.position.y = 0.36;
  g.add(heli);
  Object.assign(g.userData, { heli, lamps });
}

// Heavy VTOL gunship, faces +z: slab-sided off-white hull with an angular greenhouse cockpit and amber chin glazing,
// stub wings carrying multi-tube rocket pods, a big lift-jet nacelle on each wingtip (blue intake cowl, orange band,
// blue nozzle) that vectors with the flight, a tall fin, and belly sponsons to sit on. Origin at the bottom.
function decal(text, w = 256, h = 96) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#3a2f2a';
  g.font = `bold ${h * 0.78}px "Arial Narrow", Arial, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
}
let decals = null;

export function makeHeli() {
  decals ??= { big: decal('HS', 160, 96), id: decal('HS-07 B', 320, 80) };
  const g = new THREE.Group();
  const body = new THREE.Group();                               // pitches and rolls with the flight
  body.position.y = 1.32;
  g.add(body);
  const slab = (pts, depth, bevel = 0.14) => {                   // side profile (z forward, y up) extruded across the hull
    const sh = new THREE.Shape();
    pts.forEach(([z, y], k) => (k ? sh.lineTo(z, y) : sh.moveTo(z, y)));
    sh.closePath();
    const geo = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 2 });
    geo.translate(0, 0, -depth / 2);
    geo.rotateY(-Math.PI / 2);
    return geo;
  };
  const box = (w, h, d, mat, x, y, z, parent = body) => mk(new THREE.BoxGeometry(w, h, d), mat, x, y, z, parent);

  // hull: deep slab body, raised cockpit block, engine hump behind it, tail boom
  mk(slab([[2.45, -0.62], [2.62, -0.1], [2.3, 0.42], [1.25, 0.5], [-2.3, 0.5], [-3.3, 0.22], [-3.2, -0.3], [-1.2, -0.85], [1.7, -0.9]], 1.55), mats.skin, 0, 0, 0, body);
  mk(slab([[2.2, 0.4], [1.75, 0.98], [0.55, 1.05], [0.3, 0.45]], 1.3, 0.1), mats.skin, 0, 0, 0, body);                 // cockpit
  mk(slab([[0.35, 0.45], [0.2, 1.0], [-1.5, 0.95], [-2.2, 0.45]], 1.15, 0.12), mats.skinDark, 0, 0, 0, body);           // engine hump
  box(0.9, 0.12, 0.7, mats.panel, 0, 1.12, -0.5);
  for (const x of [-0.3, 0.3]) mk(new THREE.CylinderGeometry(0.16, 0.2, 0.3, 10), mats.panel, x, 1.15, -1.3, body);     // exhaust stacks
  // greenhouse: raked windscreen, side panes, and the amber chin windows
  const ws = box(1.18, 0.62, 0.05, mats.glass, 0, 0.72, 2.0); ws.rotation.x = -0.66;
  box(0.06, 0.66, 0.06, mats.skin, 0, 0.72, 2.02).rotation.x = -0.66;
  for (const sd of [-1, 1]) {
    box(0.05, 0.42, 0.55, mats.glass, sd * 0.74, 0.74, 1.55).rotation.z = sd * 0.08;
    box(0.05, 0.36, 0.42, mats.glass, sd * 0.74, 0.72, 0.95);
    box(0.05, 0.34, 0.5, mats.amber, sd * 0.86, -0.32, 2.0);
    box(0.05, 0.3, 0.42, mats.glass, sd * 0.86, -0.34, 1.45);
    const low = box(0.5, 0.3, 0.05, mats.amber, sd * 0.36, -0.4, 2.56); low.rotation.x = 0.3;
    // sensor blisters and the side intake scoop
    for (const [y, z] of [[0.12, 0.75], [0.12, 0.25]]) mk(new THREE.SphereGeometry(0.3, 12, 10), mats.skin, sd * 0.84, y, z, body).scale.set(0.45, 1.05, 0.8);
    box(0.34, 0.5, 0.95, mats.skin, sd * 0.95, -0.35, 0.1);
    box(0.24, 0.38, 0.06, mats.dark, sd * 0.97, -0.35, 0.6);
    for (let v = 0; v < 3; v++) box(0.03, 0.04, 0.34, mats.dark, sd * 0.92, 0.0 - v * 0.09, -1.2);                          // vents
    // stub wing, orange leading-edge flash, two rocket pods
    box(1.75, 0.14, 1.15, mats.skin, sd * 1.72, 0.2, -0.75).rotation.z = sd * -0.04;
    box(1.6, 0.04, 0.26, mats.orange, sd * 1.72, 0.12, -0.26);
    for (const px of [1.32, 1.98]) {
      box(0.1, 0.22, 0.4, mats.panel, sd * px, 0.02, -0.7);
      const pod = new THREE.Group();
      pod.position.set(sd * px, -0.32, -0.62);
      mk(new THREE.CylinderGeometry(0.27, 0.27, 1.05, 14).rotateX(Math.PI / 2), mats.pod, 0, 0, 0, pod);
      mk(new THREE.CylinderGeometry(0.275, 0.24, 0.12, 14).rotateX(Math.PI / 2), mats.podDark, 0, 0, -0.56, pod);
      for (let ring = 0; ring < 3; ring++) for (let k = 0; k < (ring ? ring * 6 : 1); k++) {
        const ang = k * Math.PI * 2 / (ring * 6 || 1), r = ring * 0.085;
        mk(new THREE.CircleGeometry(0.03, 6), mats.dark, Math.cos(ang) * r, Math.sin(ang) * r, 0.528, pod);
      }
      body.add(pod);
    }
    // belly sponson / skid with a blue toe
    mk(new THREE.CapsuleGeometry(0.2, 2.1, 4, 10).rotateX(Math.PI / 2), mats.skin, sd * 0.62, -1.1, 0.35, body).scale.set(1.5, 1, 1);
    mk(new THREE.SphereGeometry(0.21, 10, 8), mats.blue, sd * 0.62, -1.1, 1.45, body).scale.set(1.5, 1, 1.4);
    // tailplane with blue tip
    box(1.1, 0.08, 0.6, mats.skin, sd * 0.85, 0.3, -2.95);
    box(0.22, 0.09, 0.62, mats.blue, sd * 1.45, 0.3, -2.95);
    mk(new THREE.SphereGeometry(0.05, 6, 5), sd > 0 ? mats.navGreen : mats.navRed, sd * 2.62, 0.3, -0.75, body);
  }
  // tall fin, blue cap, whip aerial, markings
  mk(slab([[-1.7, 0.45], [-2.75, 2.7], [-3.25, 2.7], [-3.3, 0.3]], 0.16, 0.05), mats.skin, 0, 0, 0, body);
  mk(slab([[-2.62, 2.42], [-2.75, 2.72], [-3.25, 2.72], [-3.26, 2.42]], 0.19, 0.04), mats.blue, 0, 0, 0, body);
  mk(new THREE.CylinderGeometry(0.012, 0.02, 0.9, 5), mats.dark, 0, 1.5, -0.2, body).rotation.x = -0.5;
  mk(new THREE.SphereGeometry(0.07, 8, 6), mats.navRed, 0, 2.8, -3.0, body);
  for (const sd of [-1, 1]) {
    const big = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.54), decals.big);
    big.position.set(sd * 0.115, 1.45, -2.75); big.rotation.y = sd * Math.PI / 2; body.add(big);
    const id = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.32), decals.id);
    id.position.set(sd * 0.925, -0.02, -0.55); id.rotation.y = sd * Math.PI / 2; body.add(id);
  }
  // nose probe
  mk(new THREE.CylinderGeometry(0.02, 0.03, 1.1, 6).rotateX(Math.PI / 2), mats.panel, 0.55, 0.1, 3.0, body);
  mk(new THREE.ConeGeometry(0.07, 0.2, 4).rotateX(Math.PI / 2), mats.panel, 0.55, 0.1, 3.45, body);

  // wingtip lift-jet nacelles: vector fore/aft with the flight, exhaust glow and flame scale with throttle
  const glowMat = mats.jetGlow.clone();
  const nacelles = [], thrust = [];
  for (const sd of [-1, 1]) {
    const n = new THREE.Group();
    n.position.set(sd * 2.95, 0.15, -0.75);
    mk(slab([[0.62, -0.55], [0.7, 0.75], [0.35, 1.2], [-0.55, 1.2], [-0.7, 0.6], [-0.62, -0.55]], 0.62, 0.12), mats.skin, 0, 0, 0, n);
    mk(slab([[0.72, 0.78], [0.36, 1.26], [-0.57, 1.26], [-0.72, 0.62]], 0.66, 0.1), mats.blue, 0, 0.02, 0, n);             // intake cowl
    box(0.5, 0.06, 0.75, mats.dark, 0, 1.33, -0.1, n);                                                                    // intake mouth
    for (let v = 0; v < 4; v++) box(0.04, 0.05, 0.4, mats.dark, sd * 0.42, 0.45 - v * 0.12, 0.05, n);                       // louvres
    box(0.9, 0.2, 1.42, mats.orange, 0, -0.5, 0, n);
    mk(new THREE.CylinderGeometry(0.46, 0.36, 0.5, 14), mats.blue, 0, -0.85, 0, n).scale.set(0.95, 1, 1.35);
    mk(new THREE.CylinderGeometry(0.3, 0.3, 0.06, 14), glowMat, 0, -1.09, 0, n).scale.set(0.95, 1, 1.35);
    const flame = new THREE.Group();
    flame.position.y = -1.1;
    flame.add(new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.9, 10, 1, true).rotateX(Math.PI).translate(0, -0.95, 0), mats.jetFlame));
    flame.add(new THREE.Mesh(new THREE.ConeGeometry(0.15, 1.1, 8, 1, true).rotateX(Math.PI).translate(0, -0.55, 0), mats.jetCore));
    n.add(flame);
    box(0.5, 0.1, 0.5, mats.panel, sd * -0.5, 0.2, 0, n);                                                                  // pivot collar
    body.add(n);
    nacelles.push(n); thrust.push(flame);
  }
  g.userData.pods = [new THREE.Vector3(1.65, -0.32, 0.1), new THREE.Vector3(-1.65, -0.32, 0.1)];
  Object.assign(g.userData, { nacelles, thrust, glowMat });

  // chin gatling on a small turret under the nose
  const gun = new THREE.Group();
  gun.position.set(0, -0.98, 1.75);
  mk(new THREE.CylinderGeometry(0.2, 0.24, 0.22, 10), mats.panel, 0, 0.06, 0, gun);
  const barrels = new THREE.Group();
  barrels.position.set(0, -0.1, 0.1);
  for (let k = 0; k < 3; k++) { const an = k * Math.PI * 2 / 3; mk(new THREE.CylinderGeometry(0.028, 0.028, 0.95, 6).rotateX(Math.PI / 2), mats.metal, Math.cos(an) * 0.055, Math.sin(an) * 0.055, 0.47, barrels); }
  mk(new THREE.CylinderGeometry(0.085, 0.085, 0.1, 8).rotateX(Math.PI / 2), mats.metal, 0, 0, 0.75, barrels);
  gun.add(barrels);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, -0.1, 1.1);
  gun.add(muzzle);
  const flash = new THREE.Group();
  for (const r of [0, Math.PI / 2]) { const f = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), mats.flash); f.rotation.set(0, Math.PI / 2, 0); f.rotateX(r); flash.add(f); }
  flash.add(new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), mats.flash));
  flash.position.copy(muzzle.position);
  flash.visible = false;
  gun.add(flash);
  body.add(gun);
  // (the flight code still expects rotor handles from the helicopter it replaced: give it inert ones)
  const rotor = new THREE.Group(), tailRotor = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.BufferGeometry(), mats.disc.clone());
  disc.visible = false;

  // ammo readout that hangs under the aircraft: a gatling bar and one pip per rocket
  const canvas = document.createElement('canvas');
  canvas.width = 176; canvas.height = 60;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const hud = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, fog: false }));
  hud.scale.set(2.5 / 0.56, 2.5 * (60 / 176) / 0.56, 1);
  hud.position.y = -1.5;
  hud.renderOrder = 6;
  hud.visible = false;
  g.add(hud);
  g.scale.setScalar(0.56);                                       // wingtip to wingtip just fits the 4x4 pad
  Object.assign(g.userData, { body, rotor, tailRotor, disc, gun, barrels, muzzle, flash, hud, hudCanvas: canvas, hudTex: tex, hudSig: '' });
  return g;
}

// Redraw the ammo readout (only when the numbers change): bullet icon + segmented gatling bar, then a row of rockets.
function drawAmmo(ud, rounds, maxRounds, rocketsLeft, maxRockets) {
  const sig = `${rounds}|${rocketsLeft}`;
  if (ud.hudSig === sig) return;
  ud.hudSig = sig;
  const c = ud.hudCanvas.getContext('2d'), W = ud.hudCanvas.width, H = ud.hudCanvas.height;
  c.clearRect(0, 0, W, H);
  c.fillStyle = 'rgba(8,10,14,0.62)';
  c.beginPath(); c.roundRect(1, 1, W - 2, H - 2, 8); c.fill();
  c.strokeStyle = 'rgba(255,255,255,0.18)'; c.lineWidth = 1.5; c.stroke();
  // gatling: a cartridge icon and a bar in ten segments
  const frac = rounds / maxRounds, low = frac <= 0.2;
  c.fillStyle = '#d9a633'; c.fillRect(10, 11, 13, 9);
  c.beginPath(); c.moveTo(23, 11); c.lineTo(31, 15.5); c.lineTo(23, 20); c.closePath(); c.fillStyle = '#e8e2d0'; c.fill();
  c.fillStyle = '#8a6a1c'; c.fillRect(8, 10, 3, 11);
  for (let k = 0; k < 10; k++) {
    const fill = Math.max(0, Math.min(1, frac * 10 - k));
    c.fillStyle = 'rgba(255,255,255,0.13)'; c.fillRect(38 + k * 13, 10, 11, 11);
    if (fill > 0) { c.fillStyle = low ? '#ff5a3c' : '#ffd541'; c.fillRect(38 + k * 13, 10, 11 * fill, 11); }
  }
  // rockets: one little rocket each, spent ones left as dark outlines
  for (let k = 0; k < maxRockets; k++) {
    const x = 14 + k * (W - 28) / maxRockets + 2, live = k < rocketsLeft;
    c.fillStyle = live ? '#e9ecef' : 'rgba(255,255,255,0.14)'; c.fillRect(x, 35, 7, 13);
    c.beginPath(); c.moveTo(x, 35); c.lineTo(x + 3.5, 28); c.lineTo(x + 7, 35); c.closePath(); c.fillStyle = live ? '#e5493b' : 'rgba(255,255,255,0.14)'; c.fill();
    c.fillStyle = live ? '#8a9099' : 'rgba(255,255,255,0.1)';
    c.beginPath(); c.moveTo(x, 44); c.lineTo(x - 3, 51); c.lineTo(x, 49); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(x + 7, 44); c.lineTo(x + 10, 51); c.lineTo(x + 7, 49); c.closePath(); c.fill();
    if (live) { c.fillStyle = '#ffb040'; c.fillRect(x + 2, 49, 3, 3); }
  }
  ud.hudTex.needsUpdate = true;
}

// ---------------------------------------------------------------- behaviour
const ALT = 7.5, SPEED = 13, STANDOFF = 8.5, GUN_RANGE = 12.5;
const AVOID = 8.5, CLEAR = 4.4;                                  // start steering apart / minimum hull-to-hull spacing (craft span ~3.6)
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _q = new THREE.Vector3();
const rockets = [];
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

function nearestBug(x, z, r) {
  let best = null, bd = r * r;
  eachEnemy(x, z, r, (e, d2) => { if (d2 < bd) { bd = d2; best = e; } });
  return best;
}
// The bug with the most company within 3.5 units, among those the pods can reach.
function rocketTarget(x, z, r) {
  let best = null, score = -1;
  eachEnemy(x, z, r, (e) => { let n = 0; eachEnemy(e.x, e.z, 3.5, () => { n++; }); if (n > score) { score = n; best = e; } });
  return best;
}

function launchRocket(h, heli, e, def) {
  const pod = heli.userData.pods[h.rocketsLeft % 2];
  heli.userData.body.localToWorld(_q.copy(pod));
  const m = new THREE.Group();
  mk(new THREE.CylinderGeometry(0.06, 0.06, 0.6, 8).rotateX(Math.PI / 2), mats.rocket, 0, 0, 0, m);
  mk(new THREE.ConeGeometry(0.06, 0.18, 8).rotateX(Math.PI / 2), mats.rocketTip, 0, 0, 0.39, m);
  m.position.copy(_q);
  state.scene.add(m);
  const l = Math.hypot(e.fx, e.fz) || 1, lead = _q.distanceTo(_a.set(e.x, _q.y, e.z)) / 34;
  const tx = e.x + (e.fx / l) * e.speed * lead, tz = e.z + (e.fz / l) * e.speed * lead;
  rockets.push({ m, to: new THREE.Vector3(tx, heightAt(tx, tz), tz), trail: 0, dmg: def.rocketDamage, splash: def.splash });
  puff(_q.x, _q.y, _q.z, { color: 0xffc070, size: 0.8, life: 0.1, opacity: 0.9, additive: true });
  audio.play('rocket_launch', { x: heli.position.x, z: heli.position.z, vol: 0.6 });
}

export function updateHeliRockets(dt) {
  for (let k = rockets.length - 1; k >= 0; k--) {
    const r = rockets[k], p = r.m.position;
    _a.subVectors(r.to, p);
    const d = _a.length(), step = 34 * dt;
    if (d <= step + 0.3) {
      explode(r.to.x, r.to.z, 1.2, r.dmg, r.splash, { shake: 0, smoke: 4 });
      state.scene.remove(r.m);
      rockets.splice(k, 1);
      continue;
    }
    _a.multiplyScalar(1 / d);
    p.addScaledVector(_a, step);
    r.m.lookAt(r.to);
    r.trail += dt;
    if (r.trail > 0.03) {
      r.trail = 0;
      puff(p.x, p.y, p.z, { color: 0xd8d0c8, size: 0.4, grow: 0.9, life: 0.6, opacity: 0.5 });
      puff(p.x, p.y, p.z, { color: 0xffa040, size: 0.3, life: 0.12, opacity: 0.8, additive: true });
    }
  }
}

export function updateHeli(s, dt) {
  const def = s.def, pad = s.mesh, heli = pad.userData.heli, ud = heli.userData;
  const h = (s.heli ??= { mode: 'rearm', t: def.rearm * 0.4, rounds: def.rounds, rocketsLeft: def.rockets, rpm: 0, vx: 0, vz: 0, yaw: 0, pitch: 0, roll: 0, gunCd: 0, rocketCd: 1.2, idle: 0, scan: 0, target: null });
  const padY = s.y + 0.21;                                       // pad deck in world space (structure sits 0.15 low)
  const flying = heli.parent !== pad;
  const pos = heli.position;

  // rotors
  const wantRpm = h.mode === 'rearm' ? 0.18 : 1;
  h.rpm += (wantRpm - h.rpm) * Math.min(1, dt * (wantRpm > h.rpm ? 1.6 : 0.9));
  ud.glowMat.emissiveIntensity = 0.3 + h.rpm * 3.4;
  for (const f of ud.thrust) { f.visible = h.rpm > 0.3; f.scale.set(0.9 + Math.random() * 0.2, (h.rpm - 0.25) * (0.85 + Math.random() * 0.4), 0.9 + Math.random() * 0.2); }
  const lamp = h.mode === 'rearm' ? mats.lampBusy : mats.lamp;
  for (const l of pad.userData.lamps) if (l.material !== lamp) l.material = lamp;

  // ammo readout: live counts in the air, and a refill animation while rearming on the pad
  const prog = h.mode === 'rearm' ? 1 - Math.max(0, h.t) / def.rearm : 0;
  const showRounds = h.mode === 'rearm' ? Math.round(h.rounds + (def.rounds - h.rounds) * prog) : h.rounds;
  const showRockets = h.mode === 'rearm' ? Math.round(h.rocketsLeft + (def.rockets - h.rocketsLeft) * prog) : h.rocketsLeft;
  ud.hud.visible = h.mode !== 'rearm' || (h.t > 0 && (h.rounds < def.rounds || h.rocketsLeft < def.rockets));
  if (ud.hud.visible) drawAmmo(ud, showRounds, def.rounds, showRockets, def.rockets);
  ud.hud.position.y = h.mode === 'rearm' ? 3.6 : -1.5;           // under the aircraft in flight, above it while it sits on the pad

  if (h.mode === 'rearm') {
    h.t -= dt;
    if (h.t <= 0) {
      h.rounds = def.rounds; h.rocketsLeft = def.rockets;
      if (nearestBug(s.x, s.z, def.range)) {                     // only scramble when there is something to shoot
        h.mode = 'takeoff'; h.t = 0;
        state.scene.attach(heli);
        h.yaw = heli.rotation.y;
        if (!s.snd) s.snd = audio.loop('vtol_jet', { x: s.x, z: s.z, vol: 0.55 });
      }
    }
    return;
  }

  // pick where to be and what to face
  h.scan -= dt;
  if (h.mode === 'attack') {
    if (h.target && (h.target.dead || Math.hypot(h.target.x - s.x, h.target.z - s.z) > def.range + 6)) h.target = null;
    if (h.scan <= 0 || !h.target) {
      h.scan = 0.4;
      h.target = nearestBug(pos.x, pos.z, 30) || nearestBug(s.x, s.z, def.range);
    }
    if (h.rounds <= 0 && h.rocketsLeft <= 0) { h.mode = 'return'; h.target = null; }
    else if (!h.target) { h.idle += dt; if (h.idle > 2.5) h.mode = 'return'; }
    else h.idle = 0;
  }
  let gx = s.x, gz = s.z, gy = padY + ALT, faceX = null, faceZ = null;
  const e = h.mode === 'attack' ? h.target : null;
  if (h.mode === 'takeoff') { gy = padY + ALT * Math.min(1, h.t / 1.6); h.t += dt; if (h.t > 1.7) { h.mode = 'attack'; h.idle = 0; } }
  else if (e) {
    const dx = pos.x - e.x, dz = pos.z - e.z, d = Math.hypot(dx, dz) || 1;
    const orbit = (0.3 + (s.id % 4) * 0.22) * (s.id % 2 ? 1 : -1);   // each craft works its own arc around the target
    const ox = dx / d * Math.cos(orbit) - dz / d * Math.sin(orbit), oz = dx / d * Math.sin(orbit) + dz / d * Math.cos(orbit);
    gx = e.x + ox * STANDOFF; gz = e.z + oz * STANDOFF;
    gy = Math.max(heightAt(pos.x, pos.z), heightAt(e.x, e.z)) + ALT + ((s.id % 3) - 1) * 1.1;      // staggered flight levels
    faceX = e.x - pos.x; faceZ = e.z - pos.z;
  } else if (h.mode === 'attack') { gx = pos.x; gz = pos.z; gy = heightAt(pos.x, pos.z) + ALT; }
  else if (h.mode === 'land') { gy = padY; }

  // flight: accelerate toward the goal, tilt into the motion, bob in the hover
  const tx = gx - pos.x, tz = gz - pos.z, td = Math.hypot(tx, tz);
  const want = Math.min(SPEED, td * 1.6), wx = td > 0.01 ? tx / td * want : 0, wz = td > 0.01 ? tz / td * want : 0;
  // keep clear of the other gunships: steer away inside AVOID, and never let two hulls actually overlap.
  // A craft that is taking off, landing, or on final approach to its own pad holds its line (pads can be closer
  // together than the cruise spacing); everyone else gives way to it.
  let ax = 0, az = 0;
  // Right of way: 2 = pinned over its pad (landing / lifting off), 1 = on final approach, 0 = free flight. A craft
  // gives way to anything that outranks it; equals both give way, except on final where the lower id goes first.
  h.rank = h.mode === 'land' || h.mode === 'takeoff' ? 2 : h.mode === 'return' && Math.hypot(s.x - pos.x, s.z - pos.z) < 7 ? 1 : 0;
  for (const o of state.structures) {
    if (o === s || o.def?.kind !== 'heli' || !o.heli || o.heli.mode === 'rearm') continue;
    const op = o.mesh.userData.heli.position;
    let dx = pos.x - op.x, dz = pos.z - op.z, d = Math.hypot(dx, dz);
    if (d > AVOID) continue;
    if (d < 0.05) { const a = s.id * 2.4; dx = Math.sin(a); dz = Math.cos(a); d = 0.05; }   // dead on top of each other: pick a side
    const theirs = o.heli.rank ?? 0;
    if (theirs < h.rank || (theirs === h.rank && (h.rank === 2 || (h.rank === 1 && s.id < o.id)))) continue;
    const push = (1 - d / AVOID) ** 2 * (theirs > h.rank ? 1.8 : 1);
    ax += dx / d * push; az += dz / d * push;
    if (d < CLEAR) { const fix = (CLEAR - d) * (theirs > h.rank || h.rank === 1 ? 1 : 0.5); pos.x += dx / d * fix; pos.z += dz / d * fix; }
  }
  const acc = Math.min(1, dt * 1.8);
  h.vx += (wx + ax * SPEED * 1.3 - h.vx) * acc; h.vz += (wz + az * SPEED * 1.3 - h.vz) * acc;
  pos.x += h.vx * dt; pos.z += h.vz * dt;
  const floor = heightAt(pos.x, pos.z) + (h.mode === 'land' || h.mode === 'takeoff' ? 0 : 3.5);
  pos.y += (Math.max(gy, floor) - pos.y) * Math.min(1, dt * (h.mode === 'land' ? 1.5 : 1.3));
  if (h.mode !== 'land' && h.mode !== 'takeoff') pos.y += Math.sin(state.time * 1.7 + s.id) * 0.004;
  const speed = Math.hypot(h.vx, h.vz);
  if (faceX === null && speed > 1.5) { faceX = h.vx; faceZ = h.vz; }
  if (h.mode === 'land') { faceX = Math.sin(0); faceZ = 1; }
  if (faceX !== null) h.yaw += wrap(Math.atan2(faceX, faceZ) - h.yaw) * Math.min(1, dt * 2.6);
  heli.rotation.y = h.yaw;
  const fwd = h.vx * Math.sin(h.yaw) + h.vz * Math.cos(h.yaw), side = h.vx * Math.cos(h.yaw) - h.vz * Math.sin(h.yaw);
  h.pitch += (fwd * 0.03 - h.pitch) * Math.min(1, dt * 3);
  h.roll += (-side * 0.035 - h.roll) * Math.min(1, dt * 3);
  ud.body.rotation.set(h.pitch * 0.6 + (e ? 0.1 : 0), 0, h.roll);
  const vector = Math.max(-0.2, Math.min(0.75, fwd * 0.055));    // nacelles swing forward to drive the aircraft along
  for (const n of ud.nacelles) n.rotation.x += (vector - n.rotation.x) * Math.min(1, dt * 3);
  const agl = pos.y - heightAt(pos.x, pos.z);
  if (agl < 4.5 && Math.random() < dt * 22) {                    // jet wash kicking up dust near the ground
    const a = Math.random() * Math.PI * 2, r = 1 + Math.random() * 1.5;
    puff(pos.x + Math.cos(a) * r, pos.y - agl + 0.3, pos.z + Math.sin(a) * r, { color: 0xb59468, size: 0.9 + Math.random(), grow: 2.2, life: 0.7 + Math.random() * 0.5, opacity: 0.4, vx: Math.cos(a) * 5, vz: Math.sin(a) * 5, vy: 0.6, drag: 2 });
  }
  if (s.snd) s.snd.setPos(pos.x, pos.z);

  if (h.mode === 'return' && td < 0.6 && speed < 1.5) h.mode = 'land';
  if (h.mode === 'land' && pos.y - padY < 0.05) {
    pad.attach(heli);
    heli.position.set(0, 0.36, 0);
    heli.rotation.set(0, 0, 0);
    ud.body.rotation.set(0, 0, 0);
    for (const n of ud.nacelles) n.rotation.x = 0;
    h.vx = h.vz = 0; h.pitch = h.roll = 0;
    h.mode = 'rearm'; h.t = def.rearm;
    if (s.snd) { s.snd.stop(); s.snd = null; }
    return;
  }

  // weapons: chin gun tracks the target; gatling first, rockets into the thickest cluster
  ud.flash.visible = false;
  if (!e) return;
  const dist = Math.hypot(e.x - pos.x, e.z - pos.z);
  const aimYaw = wrap(Math.atan2(e.x - pos.x, e.z - pos.z) - h.yaw);
  ud.gun.rotation.y += (Math.max(-1.2, Math.min(1.2, aimYaw)) - ud.gun.rotation.y) * Math.min(1, dt * 10);
  ud.barrels.rotation.x = Math.atan2(pos.y - heightAt(e.x, e.z) - 0.5, Math.max(1, dist)) - h.pitch;
  h.gunCd -= dt; h.rocketCd -= dt;
  if (h.rounds > 0 && dist < GUN_RANGE && Math.abs(aimYaw) < 1.2 && h.gunCd <= 0) {
    h.gunCd = 1 / def.rate;
    h.rounds--;
    ud.barrels.rotation.z += 0.9;
    ud.muzzle.getWorldPosition(_a);
    _b.set(e.x + (Math.random() - 0.5) * 0.7, aimY(e) - 0.2 * e.def.scale, e.z + (Math.random() - 0.5) * 0.7);
    const tr = makeTracer(_a, _b);
    state.scene.add(tr);
    state.beams.push({ mesh: tr, life: 0.05, max: 0.05 });
    ud.flash.visible = true;
    ud.flash.rotation.z = Math.random() * Math.PI;
    damageEnemy(e, def.damage);
    if (Math.random() < 0.35) burst(_b.x, _b.y, _b.z, 'soil', 1, 3);
    audio.play('hmg_fire', { x: pos.x, z: pos.z, vol: 0.4 });
  }
  if (h.rocketsLeft > 0 && h.rocketCd <= 0 && dist < GUN_RANGE + 4 && Math.abs(aimYaw) < 0.5) {
    h.rocketCd = 0.55;
    launchRocket(h, heli, rocketTarget(pos.x, pos.z, GUN_RANGE + 3) || e, def);
    h.rocketsLeft--;
  }
}

// Pad destroyed or sold while the helicopter is out (or parked): it goes down with it.
export function removeHeli(s) {
  const heli = s.mesh.userData.heli;
  if (!heli) return;
  if (heli.parent && heli.parent !== s.mesh) {
    explode(heli.position.x, heli.position.z, 1.6, 0, 0, { shake: 0.2, smoke: 8 });
    burst(heli.position.x, heli.position.y, heli.position.z, 'debris', 14, 9);
    heli.parent.remove(heli);
  }
}
