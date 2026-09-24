import * as THREE from 'three';
import { makeHelipad } from './heli.js';
import { makeAirshipPad } from './airship.js';
import { bevelBox, softBox, worn } from './surface.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BUILDINGS } from './config.js';
import { bakeStatic } from './bake.js';
import { instancePool } from './instancing.js';

// Yellow / black chevron tape for pit edges and hatch surrounds.
function hazardTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = '#d9a028'; g.fillRect(0, 0, 128, 32);
  g.fillStyle = '#17181b';
  for (let x = -32; x < 160; x += 32) { g.beginPath(); g.moveTo(x, 32); g.lineTo(x + 16, 32); g.lineTo(x + 48, 0); g.lineTo(x + 32, 0); g.fill(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

// Shared materials
const M = {
  metal: new THREE.MeshStandardMaterial({ color: 0x8d949c, roughness: 0.6, metalness: 0.5 }),
  dark:  new THREE.MeshStandardMaterial({ color: 0x3a3f48, roughness: 0.7, metalness: 0.4 }),
  amber: new THREE.MeshStandardMaterial({ color: 0xd9a441, roughness: 0.5, metalness: 0.3 }),
  olive: new THREE.MeshStandardMaterial({ color: 0x6b6e4a, roughness: 0.7, metalness: 0.2 }),
  gunmetal: new THREE.MeshStandardMaterial({ color: 0x2c2f36, roughness: 0.35, metalness: 0.85 }),
  black: new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.6, metalness: 0.5 }),
  lens: new THREE.MeshStandardMaterial({ color: 0xff5030, emissive: 0xff3010, emissiveIntensity: 1.8 }),
  brass: new THREE.MeshStandardMaterial({ color: 0xc9a24a, roughness: 0.35, metalness: 0.9 }),
  red: new THREE.MeshStandardMaterial({ color: 0x9a2b22, roughness: 0.45, metalness: 0.4 }),
  sandbag: new THREE.MeshStandardMaterial({ color: 0x8a7a58, roughness: 0.95, metalness: 0 }),
  concrete: new THREE.MeshStandardMaterial({ color: 0x8b8f94, roughness: 0.9, metalness: 0.05 }),
  footing: new THREE.MeshStandardMaterial({ color: 0x4c4f55, roughness: 0.95, metalness: 0.05 }),
  capIdle: new THREE.MeshStandardMaterial({ color: 0x4fd1ff, emissive: 0x2aa8dd, emissiveIntensity: 0.3, roughness: 0.3 }),
  fairing: new THREE.MeshStandardMaterial({ color: 0xd9dcd6, roughness: 0.45, metalness: 0.35, side: THREE.DoubleSide }),
  fairingTip: new THREE.MeshStandardMaterial({ color: 0x23262a, roughness: 0.7, metalness: 0.4, side: THREE.DoubleSide }),
  fairingStripe: new THREE.MeshStandardMaterial({ color: 0xd98a1c, roughness: 0.5, metalness: 0.3, side: THREE.DoubleSide }),
  window: new THREE.MeshStandardMaterial({ color: 0x8fd8ff, emissive: 0x4fb8ff, emissiveIntensity: 1.5, roughness: 0.15, metalness: 0.3 }),
  gaugeBack: new THREE.MeshStandardMaterial({ color: 0x0c2238, emissive: 0x0a2a55, emissiveIntensity: 0.6, roughness: 0.4 }),
  gaugeFill: new THREE.MeshStandardMaterial({ color: 0x66ccff, emissive: 0x3aa8ff, emissiveIntensity: 2.4, roughness: 0.3 }),
  white: new THREE.MeshStandardMaterial({ color: 0xdfe4e8, roughness: 0.45, metalness: 0.15 }),
  trim: new THREE.MeshStandardMaterial({ color: 0x6d737b, roughness: 0.55, metalness: 0.5 }),
  cable: new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.8, metalness: 0.1 }),
  lensGlass: new THREE.MeshPhysicalMaterial({ color: 0x06202b, emissive: 0x1c8aa6, emissiveIntensity: 0.35, roughness: 0.1, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.05 }),
  cyan:  new THREE.MeshStandardMaterial({ color: 0x4fd1ff, emissive: 0x2aa8dd, emissiveIntensity: 1.2, roughness: 0.2 }),
  green: new THREE.MeshStandardMaterial({ color: 0x55804f, roughness: 0.65, metalness: 0.25 }),
  hazard: new THREE.MeshStandardMaterial({ map: hazardTexture(), roughness: 0.6, metalness: 0.2 }),
  glass: new THREE.MeshPhysicalMaterial({ color: 0x7f9dff, emissive: 0x2a3ccc, emissiveIntensity: 0.55, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.55, clearcoat: 1, clearcoatRoughness: 0.05, side: THREE.DoubleSide }),
  plasma: new THREE.MeshStandardMaterial({ color: 0x9fb4ff, emissive: 0x5a78ff, emissiveIntensity: 2.4, roughness: 0.3 }),
  blue:  new THREE.MeshStandardMaterial({ color: 0x6f7fff, emissive: 0x2233aa, emissiveIntensity: 0.8, roughness: 0.3 }),
  core:  new THREE.MeshStandardMaterial({ color: 0xffb347, emissive: 0xff7a00, emissiveIntensity: 1.5 }),
  ghostOk:  new THREE.MeshBasicMaterial({ color: 0x4fff7a, transparent: true, opacity: 0.45, depthWrite: false }),
  ghostBad: new THREE.MeshBasicMaterial({ color: 0xff4040, transparent: true, opacity: 0.45, depthWrite: false }),
  shell: new THREE.MeshBasicMaterial({ color: 0xffd76a }),
  beam:  new THREE.MeshBasicMaterial({ color: 0x7fe6ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
  tracer: new THREE.MeshBasicMaterial({ color: 0xffb040, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }),
  ichor: new THREE.MeshBasicMaterial({ color: 0x8fe33a }),
  debris: new THREE.MeshBasicMaterial({ color: 0x777777 }),
  soil: new THREE.MeshBasicMaterial({ color: 0x7a5a3a }),
  marker: new THREE.MeshBasicMaterial({ color: 0xff3a3a, transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
};

// Wear layer: painted armour chips and gets grimy, bare metal mostly just varies in sheen, fabric and concrete only stain.
for (const k of ['metal', 'trim', 'white', 'fairing']) worn(M[k], { grime: 0.2, chips: 0.35 });
for (const k of ['amber', 'olive', 'red', 'green', 'fairingStripe']) worn(M[k], { grime: 0.26, chips: 0.6 });
for (const k of ['dark', 'black', 'gunmetal', 'brass', 'fairingTip']) worn(M[k], { grime: 0.14, chips: 0.18, rough: 0.4 });
worn(M.footing, { grime: 0.4, chips: 0, rough: 0.1, bump: 1.2, scale: 1.0 });
worn(M.concrete, { grime: 0.34, chips: 0, rough: 0.15, bump: 1.2, scale: 1.0 });
worn(M.sandbag, { grime: 0.3, chips: 0, rough: 0.1, bump: 1.6, scale: 1.6 });

export const hazardMaterial = () => M.hazard;

function softDisc() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.3, 'rgba(255,255,255,0.7)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
let _glow = null;
export function glowTexture() { return (_glow ||= softDisc()); }
M.flash = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffc070, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });

function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

// Autocannon with one or two gun assemblies. Each assembly recoils independently and has its own
// muzzle, flash sprite and ejection port (single: right side; dual: one port per side).
function autocannon(g, dual) {
  const W = dual ? 1.3 : 0.9;
  // Plinth: skirt, bolted octagonal base, yaw ring with an amber accent.
  g.add(mesh(new THREE.CylinderGeometry(1.0, 1.15, 0.35, 8), M.dark, 0, 0.175, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.85, 0.95, 0.35, 8), M.metal, 0, 0.5, 0));
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    g.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 6), M.black, Math.cos(a) * 0.97, 0.37, Math.sin(a) * 0.97));
  }
  g.add(mesh(new THREE.CylinderGeometry(0.55, 0.62, 0.25, 12), M.dark, 0, 0.8, 0));
  const ring = mesh(new THREE.TorusGeometry(0.58, 0.04, 6, 24), M.amber, 0, 0.93, 0);
  ring.rotation.x = Math.PI / 2;
  g.add(ring);

  // Head: armoured cradle, top plate, rear block.
  const head = new THREE.Group();
  head.position.y = 1.05;
  head.add(mesh(bevelBox(W, 0.5, 1.0), M.amber, 0, 0.15, -0.05));
  head.add(mesh(bevelBox(W + 0.1, 0.16, 0.7), M.dark, 0, 0.42, -0.15));
  head.add(mesh(bevelBox(W + 0.08, 0.3, 0.5), M.dark, 0, 0.0, -0.5));

  const addOptic = (x, y, z) => {
    const optic = mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.3, 10), M.black, x, y, z);
    optic.rotation.x = Math.PI / 2;
    head.add(optic);
    const lens = mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.02, 10), M.lens, x, y, z + 0.16);
    lens.rotation.x = Math.PI / 2;
    head.add(lens);
  };
  const addPort = (side) => {
    head.add(mesh(bevelBox(0.1, 0.14, 0.24), M.black, side * (W / 2 + 0.05), 0.1, 0.05));
    const port = new THREE.Object3D();
    port.position.set(side * (W / 2 + 0.11), 0.12, 0.05);
    head.add(port);
    return port;
  };
  let ports;
  if (dual) {
    for (const sx of [-1, 1]) {
      head.add(mesh(bevelBox(0.3, 0.3, 0.5), M.olive, sx * 0.38, 0.65, -0.2));
      head.add(mesh(bevelBox(0.34, 0.04, 0.54), M.black, sx * 0.38, 0.82, -0.2));
    }
    addOptic(0, 0.62, 0.25);
    ports = [addPort(-1), addPort(1)];
  } else {
    head.add(mesh(bevelBox(0.3, 0.36, 0.55), M.olive, -0.62, 0.12, -0.1));
    head.add(mesh(bevelBox(0.34, 0.04, 0.5), M.black, -0.62, 0.32, -0.1));
    addOptic(0.42, 0.36, 0.25);
    ports = [addPort(1)];
  }

  // Gun assemblies slide back on recoil: shroud, barrel, cooling rings, muzzle brake, flash.
  const offsets = dual ? [-0.22, 0.22] : [0];
  const guns = offsets.map((x, i) => {
    const gun = new THREE.Group();
    gun.position.set(x, 0.12, 0.3);
    const shroud = mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.6, 10), M.dark, 0, 0, 0.2);
    shroud.rotation.x = Math.PI / 2;
    gun.add(shroud);
    const barrel = mesh(new THREE.CylinderGeometry(0.08, 0.09, 1.3, 10), M.gunmetal, 0, 0, 0.9);
    barrel.rotation.x = Math.PI / 2;
    gun.add(barrel);
    for (const z of [0.6, 0.75, 0.9]) gun.add(mesh(new THREE.TorusGeometry(0.11, 0.025, 5, 12), M.dark, 0, 0, z));
    const brake = mesh(new THREE.CylinderGeometry(0.13, 0.12, 0.28, 8), M.black, 0, 0, 1.5);
    brake.rotation.x = Math.PI / 2;
    gun.add(brake);
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0, 1.68);
    gun.add(muzzle);
    const flash = new THREE.Sprite(M.flash);
    flash.position.set(0, 0, 1.8);
    flash.scale.set(0.9, 0.9, 1);
    flash.visible = false;
    gun.add(flash);
    head.add(gun);
    const port = ports[Math.min(i, ports.length - 1)];
    return { gun, muzzle, flash, port, side: dual ? (i === 0 ? -1 : 1) : 1 };
  });
  if (dual) head.add(mesh(bevelBox(0.5, 0.08, 0.3), M.dark, 0, 0.12, 1.0));   // barrel clamp
  g.add(head);
  Object.assign(g.userData, { head, guns, gunRest: 0.3 });
}

// Heavy machine gun: light pedestal mount, receiver with belt box, long ringed barrel. Fast, small recoil.
function hmg(g) {
  g.add(mesh(new THREE.CylinderGeometry(0.75, 0.85, 0.25, 8), M.dark, 0, 0.125, 0));
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + Math.PI / 6;
    const leg = mesh(bevelBox(0.12, 0.12, 0.7), M.metal, Math.cos(a) * 0.45, 0.3, Math.sin(a) * 0.45);
    leg.rotation.y = -a + Math.PI / 2;
    leg.rotation.x = 0.35;
    g.add(leg);
  }
  g.add(mesh(new THREE.CylinderGeometry(0.22, 0.28, 0.8, 10), M.metal, 0, 0.6, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.12, 12), M.black, 0, 1.02, 0));

  const head = new THREE.Group();
  head.position.y = 1.08;
  head.add(mesh(bevelBox(0.46, 0.3, 0.6), M.dark, 0, 0.15, -0.1));            // cradle
  head.add(mesh(bevelBox(0.28, 0.3, 0.42), M.olive, -0.42, 0.22, -0.15));      // belt box
  head.add(mesh(bevelBox(0.3, 0.03, 0.44), M.black, -0.42, 0.38, -0.15));
  head.add(mesh(bevelBox(0.16, 0.06, 0.18), M.brass, -0.24, 0.3, 0.02));       // belt feed
  head.add(mesh(bevelBox(0.1, 0.12, 0.2), M.black, 0.3, 0.26, 0.05));          // ejection port
  const port = new THREE.Object3D();
  port.position.set(0.36, 0.28, 0.05);
  head.add(port);
  const sight = mesh(bevelBox(0.06, 0.1, 0.25), M.black, 0.08, 0.5, -0.05);
  head.add(sight);

  const gun = new THREE.Group();
  gun.position.set(0, 0.3, 0.2);
  head.add(gun);
  gun.add(mesh(bevelBox(0.2, 0.22, 0.7), M.gunmetal, 0, 0, -0.1));             // receiver
  const shroud = mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.7, 10), M.dark, 0, 0, 0.55);
  shroud.rotation.x = Math.PI / 2;
  gun.add(shroud);
  for (const z of [0.35, 0.5, 0.65, 0.8]) gun.add(mesh(new THREE.TorusGeometry(0.1, 0.018, 5, 12), M.black, 0, 0, z));
  const barrel = mesh(new THREE.CylinderGeometry(0.045, 0.05, 1.3, 8), M.gunmetal, 0, 0, 1.1);
  barrel.rotation.x = Math.PI / 2;
  gun.add(barrel);
  const hider = mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.18, 8), M.black, 0, 0, 1.78);
  hider.rotation.x = Math.PI / 2;
  gun.add(hider);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0, 1.9);
  gun.add(muzzle);
  const flash = new THREE.Sprite(M.flash);
  flash.position.set(0, 0, 1.98);
  flash.scale.set(0.55, 0.55, 1);
  flash.visible = false;
  gun.add(flash);
  g.add(head);
  Object.assign(g.userData, { head, guns: [{ gun, muzzle, flash, port, side: 1 }], gunRest: 0.2, recoilAmp: 0.09 });
}

// Flamethrower: squat armoured mount, twin fuel tanks, short heavy nozzle with a pilot light.
function flamethrower(g) {
  g.add(mesh(new THREE.CylinderGeometry(0.95, 1.1, 0.35, 8), M.dark, 0, 0.175, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.8, 0.9, 0.35, 8), M.metal, 0, 0.5, 0));
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    const tab = mesh(bevelBox(0.1, 0.08, 0.22), M.amber, Math.cos(a) * 0.86, 0.7, Math.sin(a) * 0.86);
    tab.rotation.y = -a;
    g.add(tab);
  }
  g.add(mesh(new THREE.CylinderGeometry(0.5, 0.58, 0.22, 12), M.dark, 0, 0.78, 0));

  const head = new THREE.Group();
  head.position.y = 1.0;
  head.add(mesh(bevelBox(0.9, 0.45, 0.8), M.metal, 0, 0.2, -0.1));                 // body
  head.add(mesh(bevelBox(1.0, 0.06, 0.5), M.black, 0, 0.45, -0.2));
  for (const sx of [-1, 1]) {                                                                     // fuel tanks
    const tank = mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.9, 12), M.red, sx * 0.32, 0.62, -0.35);
    tank.rotation.x = Math.PI / 2;
    head.add(tank);
    for (const z of [-0.6, -0.1]) {
      const band = mesh(new THREE.TorusGeometry(0.21, 0.025, 6, 16), M.black, sx * 0.32, 0.62, z);
      head.add(band);
    }
    const cap = mesh(new THREE.SphereGeometry(0.2, 10, 8), M.red, sx * 0.32, 0.62, -0.8);
    head.add(cap);
    const pipe = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.7, 6), M.black, sx * 0.2, 0.45, 0.1);
    pipe.rotation.x = Math.PI / 2;
    head.add(pipe);
  }
  const shield = mesh(bevelBox(1.1, 0.5, 0.06), M.dark, 0, 0.25, 0.34);              // blast shield
  head.add(shield);
  const barrel = mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.9, 10), M.gunmetal, 0, 0.22, 0.75);
  barrel.rotation.x = Math.PI / 2;
  head.add(barrel);
  const jacket = mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.4, 10), M.dark, 0, 0.22, 0.55);
  jacket.rotation.x = Math.PI / 2;
  head.add(jacket);
  const tip = mesh(new THREE.CylinderGeometry(0.16, 0.11, 0.18, 10), M.black, 0, 0.22, 1.25);
  tip.rotation.x = Math.PI / 2;
  head.add(tip);
  const nozzle = new THREE.Object3D();
  nozzle.position.set(0, 0.22, 1.35);
  head.add(nozzle);
  const pilot = new THREE.Sprite(M.flash);
  pilot.position.set(0, 0.22, 1.4);
  pilot.scale.set(0.3, 0.3, 1);
  head.add(pilot);
  g.add(head);
  Object.assign(g.userData, { head, nozzle, pilot });
}

const sandbagGeo = softBox(0.8, 0.36, 0.5, 0.16);

// Mortar Pit (2x2): sandbag ring, baseplate, tube on a yaw pivot fixed at 60 degrees, shell rack.
function mortarPit(g) {
  g.add(mesh(new THREE.CylinderGeometry(1.75, 1.85, 0.16, 20), M.dark, 0, 0.08, 0));
  for (let layer = 0; layer < 2; layer++) {
    for (let k = 0; k < 16; k++) {
      const a = ((k + layer * 0.5) / 16) * Math.PI * 2;
      const bag = mesh(sandbagGeo, M.sandbag, Math.cos(a) * 1.75, 0.2 + layer * 0.31, Math.sin(a) * 1.75);
      bag.rotation.y = -a + Math.PI / 2 + (Math.random() - 0.5) * 0.12;
      bag.rotation.z = (Math.random() - 0.5) * 0.1;
      bag.scale.set(0.94 + Math.random() * 0.12, 0.92 + Math.random() * 0.16, 0.94 + Math.random() * 0.12);
      g.add(bag);
    }
  }
  g.add(mesh(new THREE.CylinderGeometry(0.7, 0.8, 0.14, 12), M.metal, 0, 0.23, 0));
  const head = new THREE.Group();
  head.position.y = 0.3;
  g.add(head);
  const tube = new THREE.Group();
  tube.rotation.x = Math.PI / 6;                       // 60 degrees elevation, pointing up and forward (+z)
  head.add(tube);
  const barrel = mesh(new THREE.CylinderGeometry(0.2, 0.24, 1.9, 12), M.gunmetal, 0, 0.95, 0);
  tube.add(barrel);
  tube.add(mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.2, 12), M.black, 0, 1.85, 0));
  tube.add(mesh(new THREE.TorusGeometry(0.24, 0.03, 6, 14), M.dark, 0, 0.5, 0).rotateX(Math.PI / 2));
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 1.95, 0);
  tube.add(muzzle);
  const flash = new THREE.Sprite(M.flash);
  flash.position.set(0, 2.1, 0);
  flash.scale.set(1.3, 1.3, 1);
  flash.visible = false;
  tube.add(flash);
  for (const sx of [-1, 1]) {                           // bipod legs
    const leg = mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.1, 6), M.dark, sx * 0.45, 0.45, 0.5);
    leg.rotation.z = sx * 0.55; leg.rotation.x = 0.3;
    head.add(leg);
  }
  g.add(mesh(bevelBox(0.6, 0.45, 1.3), M.olive, -1.05, 0.38, -0.5));   // shell rack
  for (let k = 0; k < 4; k++) g.add(mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.55, 8), M.brass, -1.05, 0.85, -1.0 + k * 0.32));
  g.add(mesh(bevelBox(0.5, 0.35, 0.5), M.dark, 1.05, 0.33, -0.9));      // ammo crate
  Object.assign(g.userData, { head, tube, muzzle, flash, tubeRest: 0 });
}

// Missile Silo (2x2): concrete slab, clamshell hatches, a launch rack that rises out of the pit.
function missileSilo(g) {
  g.add(mesh(bevelBox(3.7, 0.5, 3.7), M.concrete, 0, 0.25, 0));
  g.add(mesh(bevelBox(3.9, 0.08, 3.9), M.dark, 0, 0.04, 0));
  g.add(mesh(bevelBox(2.3, 0.04, 2.3), M.black, 0, 0.51, 0));          // pit opening
  for (const [x, z, w, d, rot] of [[0, 1.32, 2.9, 0.3, 0], [0, -1.32, 2.9, 0.3, 0], [1.32, 0, 2.34, 0.3, Math.PI / 2], [-1.32, 0, 2.34, 0.3, Math.PI / 2]]) {
    const tape = mesh(new THREE.PlaneGeometry(w, d), M.hazard, x, 0.512, z);   // chevron tape framing the hatch
    tape.geometry.attributes.uv.array.forEach((v, k, arr) => { if (k % 2 === 0) arr[k] = v * w * 1.4; });
    tape.rotation.set(-Math.PI / 2, 0, rot);
    g.add(tape);
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.5, 8), M.amber, sx * 1.65, 0.75, sz * 1.65));
  }
  g.add(mesh(bevelBox(0.9, 0.7, 0.9), M.metal, 1.3, 0.85, 1.3));       // control shed
  g.add(mesh(bevelBox(1.0, 0.08, 1.0), M.dark, 1.3, 1.23, 1.3));
  g.add(mesh(bevelBox(0.34, 0.5, 0.04), M.gunmetal, 1.2, 0.78, 0.84));
  g.add(mesh(bevelBox(0.26, 0.14, 0.03), M.window, 1.52, 0.98, 0.845));
  g.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.2, 6), M.dark, 1.5, 1.7, 1.5));
  g.add(mesh(new THREE.SphereGeometry(0.06, 8, 6), M.lens, 1.5, 2.3, 1.5));
  const doors = [];
  for (const sx of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 1.15, 0.55, 0);
    const door = mesh(bevelBox(1.15, 0.1, 2.3), M.metal, -sx * 0.575, 0, 0);
    pivot.add(door);
    for (const z of [-0.75, 0, 0.75]) pivot.add(mesh(bevelBox(0.8, 0.05, 0.12), M.dark, -sx * 0.5, 0.06, z));   // stiffening ribs
    pivot.add(mesh(bevelBox(0.15, 0.12, 2.3), M.amber, -sx * 1.1, 0.01, 0));
    g.add(pivot);
    doors.push({ pivot, side: sx });
  }
  const rack = new THREE.Group();
  rack.position.y = -1.6;                              // stowed: fully below the slab and doors
  g.add(rack);
  rack.add(mesh(bevelBox(1.7, 0.2, 2.1), M.dark, 0, 0, 0));
  const tubes = [], noses = [];
  for (const x of [-0.42, 0.42]) for (const z of [-0.65, 0, 0.65]) {
    const t = mesh(new THREE.CylinderGeometry(0.17, 0.17, 1.4, 10), M.gunmetal, x, 0.8, z);
    rack.add(t);
    rack.add(mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.05, 10), M.black, x, 1.5, z));   // empty tube mouth
    const nose = mesh(new THREE.ConeGeometry(0.14, 0.3, 10), M.red, x, 1.62, z);
    rack.add(nose);
    noses.push(nose);
    const tip = new THREE.Object3D();
    tip.position.set(x, 1.55, z);
    rack.add(tip);
    tubes.push(tip);
  }
  Object.assign(g.userData, { doors, rack, tubes, noses, hatch: 0, rackDown: -1.6, rackUp: -0.45 });
}

// Railgun Battery (2x2): hazard-striped pad, bolted turntable, armoured cradle with capacitor banks and power
// conduits, finned breech with a charge gauge on top, and twin conductor rails on a recoil sled.
function railgun(g) {
  g.add(mesh(bevelBox(3.8, 0.12, 3.8), M.dark, 0, 0.06, 0));
  g.add(mesh(bevelBox(3.6, 0.3, 3.6), M.concrete, 0, 0.18, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g.add(mesh(bevelBox(0.5, 0.05, 0.5), M.amber, sx * 1.5, 0.345, sz * 1.5));
    g.add(mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.12, 8), M.black, sx * 1.5, 0.39, sz * 1.5));
  }
  g.add(mesh(new THREE.CylinderGeometry(1.5, 1.62, 0.4, 20), M.dark, 0, 0.53, 0));
  g.add(mesh(new THREE.TorusGeometry(1.45, 0.05, 6, 32), M.amber, 0, 0.74, 0).rotateX(Math.PI / 2));
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    g.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.06, 6), M.black, Math.cos(a) * 1.28, 0.76, Math.sin(a) * 1.28));
  }

  const head = new THREE.Group();
  head.position.y = 0.72;
  g.add(head);
  head.add(mesh(new THREE.CylinderGeometry(1.15, 1.25, 0.18, 16), M.metal, 0, 0.09, 0));
  head.add(mesh(bevelBox(1.7, 0.5, 2.0), M.metal, 0, 0.4, -0.25));          // chassis
  head.add(mesh(bevelBox(1.2, 0.3, 0.9), M.dark, 0, 0.35, 0.95));           // front glacis
  for (const sx of [-1, 1]) {                                                              // sloped side armour
    const plate = mesh(bevelBox(0.1, 1.0, 2.1), M.dark, sx * 0.98, 0.7, -0.25);
    plate.rotation.z = -sx * 0.16;
    head.add(plate);
    head.add(mesh(bevelBox(0.04, 0.12, 1.9), M.amber, sx * 1.06, 0.32, -0.25));
  }

  // Capacitor banks and the conductor strips share one material whose glow follows the charge.
  const caps = M.capIdle.clone();
  for (const sx of [-1, 1]) for (const z of [-0.95, -0.45, 0.05]) {
    const c = mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.42, 12), caps, sx * 0.62, 0.92, z);
    c.rotation.x = Math.PI / 2;
    head.add(c);
    for (const dz of [-0.17, 0.17]) head.add(mesh(new THREE.TorusGeometry(0.19, 0.03, 6, 14), M.black, sx * 0.62, 0.92, z + dz));
    const conduit = mesh(new THREE.TorusGeometry(0.2, 0.035, 6, 10, Math.PI), M.cable, sx * 0.42, 1.08, z);
    head.add(conduit);
  }

  // Breech with heat-sink fins and the charge gauge on top.
  head.add(mesh(bevelBox(0.62, 0.62, 1.7), M.dark, 0, 0.98, -0.5));
  for (let k = 0; k < 6; k++) head.add(mesh(bevelBox(0.8, 0.5, 0.05), M.gunmetal, 0, 0.98, -1.42 - k * 0.09));
  head.add(mesh(bevelBox(0.46, 0.04, 1.1), M.black, 0, 1.3, -0.5));          // gauge bezel
  head.add(mesh(bevelBox(0.34, 0.02, 0.98), M.gaugeBack, 0, 1.325, -0.5));   // dim blue track
  const gaugeGeo = bevelBox(0.3, 0.03, 0.94);
  gaugeGeo.translate(0, 0, 0.47);                                                         // origin at the rear end
  const gauge = mesh(gaugeGeo, M.gaugeFill.clone(), 0, 1.335, -0.97);
  gauge.scale.z = 0.001;
  gauge.castShadow = false;
  head.add(gauge);
  for (const z of [-0.735, -0.5, -0.265]) head.add(mesh(bevelBox(0.34, 0.035, 0.015), M.black, 0, 1.34, z));   // quarter ticks

  // Sensor mast.
  head.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.7, 6), M.dark, 0.78, 1.45, -1.0));
  head.add(mesh(bevelBox(0.2, 0.16, 0.26), M.white, 0.78, 1.85, -1.0));
  const eye = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 10), M.lens, 0.78, 1.85, -0.86);
  eye.rotation.x = Math.PI / 2;
  head.add(eye);

  // Recoil sled: rails, inner conductor strips, brackets, under-rail brace and emitter prongs at the muzzle.
  const gun = new THREE.Group();
  gun.position.set(0, 0.98, 0.6);
  head.add(gun);
  for (const sx of [-1, 1]) {
    gun.add(mesh(bevelBox(0.14, 0.24, 4.6), M.gunmetal, sx * 0.23, 0, 1.7));
    gun.add(mesh(bevelBox(0.03, 0.1, 4.3), caps, sx * 0.15, 0, 1.75));
    const prong = mesh(bevelBox(0.1, 0.16, 0.5), M.black, sx * 0.23, 0, 4.2);
    gun.add(prong);
    gun.add(mesh(bevelBox(0.06, 0.34, 3.2), M.dark, sx * 0.34, 0, 1.4));
  }
  for (const z of [0.0, 0.9, 1.8, 2.7, 3.6]) {
    gun.add(mesh(bevelBox(0.78, 0.1, 0.16), M.dark, 0, 0.17, z));
    gun.add(mesh(bevelBox(0.78, 0.1, 0.16), M.dark, 0, -0.17, z));
  }
  gun.add(mesh(bevelBox(0.2, 0.12, 3.6), M.black, 0, -0.26, 1.5));
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0, 4.3);
  gun.add(muzzle);
  const flash = new THREE.Sprite(M.flash);
  flash.position.set(0, 0, 4.5);
  flash.scale.set(1.8, 1.8, 1);
  flash.visible = false;
  gun.add(flash);
  Object.assign(g.userData, { head, guns: [{ gun, muzzle, flash, port: null, side: 1 }], gunRest: 0.6, recoilAmp: 1.3, recoilReturn: 0.7, caps, gauge });
}

// Command tower (the Core, 2x2): armoured plinth on four landing pylons, bunker block with reactor vents, tapered
// shaft, a cantilevered control room with a lit window band and walkway, and a sensor deck with a rotating radar.
function commandTower(g) {
  const oct = (rt, rb, h, mat, y) => g.add(mesh(new THREE.CylinderGeometry(rt, rb, h, 8), mat, 0, y, 0));
  // plinth and landing pylons (the intro animates pylon.scale.y, origin at the top)
  oct(2.3, 2.55, 0.5, M.dark, 0.25);
  oct(2.1, 2.3, 0.35, M.gunmetal, 0.67);
  const pylons = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const geo = bevelBox(0.34, 2.6, 0.34);
    geo.translate(0, -1.3, 0);
    const py = mesh(geo, M.metal, sx * 1.6, 2.6, sz * 1.6);
    g.add(py);
    pylons.push(py);
    g.add(mesh(bevelBox(0.5, 0.3, 0.5), M.dark, sx * 1.6, 2.6, sz * 1.6));          // pylon housing
    const strut = mesh(bevelBox(0.16, 0.16, 1.1), M.gunmetal, sx * 1.22, 2.3, sz * 1.22);
    strut.rotation.y = Math.atan2(sx, sz);
    g.add(strut);
  }

  // bunker block: sloped armour, blast door, reactor vents glowing through slats, hazard trim
  oct(1.55, 1.95, 1.7, M.olive, 1.7);
  oct(1.65, 1.6, 0.18, M.dark, 2.62);
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2;
    const face = new THREE.Group();
    face.rotation.y = a;
    face.add(mesh(bevelBox(0.9, 0.5, 0.06), M.core, 0, 1.75, 1.66));                 // reactor glow
    for (let v = 0; v < 4; v++) face.add(mesh(bevelBox(1.0, 0.06, 0.12), M.black, 0, 1.56 + v * 0.13, 1.7));
    face.add(mesh(bevelBox(1.2, 0.08, 0.1), M.amber, 0, 1.2, 1.84));
    g.add(face);
  }
  const door = new THREE.Group();
  door.rotation.y = Math.PI / 4;
  door.add(mesh(bevelBox(0.8, 1.0, 0.14), M.gunmetal, 0, 1.38, 1.78));
  door.add(mesh(bevelBox(0.04, 1.0, 0.16), M.black, 0, 1.38, 1.79));
  door.add(mesh(bevelBox(0.96, 0.1, 0.2), M.amber, 0, 1.95, 1.76));
  g.add(door);

  // shaft with panel bands and an external conduit run
  oct(0.95, 1.2, 3.0, M.metal, 4.2);
  for (const y of [3.2, 4.2, 5.2]) oct(1.12 - (y - 3.2) * 0.075, 1.14 - (y - 3.2) * 0.075, 0.12, M.dark, y);
  for (const a of [0.4, 2.5, 4.6]) {
    g.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.9, 6), M.cable, Math.sin(a) * 1.13, 4.2, Math.cos(a) * 1.13));
  }
  for (let k = 0; k < 3; k++) g.add(mesh(bevelBox(0.22, 0.14, 0.05), M.window, 0, 3.6 + k * 0.7, 1.09 - k * 0.055));   // slit windows

  // control room: cantilevered cab, lit window band with mullions, roof overhang, walkway and railing
  oct(1.45, 1.0, 0.5, M.dark, 5.9);                                                                // corbel
  oct(1.85, 1.45, 1.0, M.olive, 6.65);
  const band = mesh(new THREE.CylinderGeometry(1.8, 1.6, 0.5, 8, 1, true), M.window, 0, 6.72, 0);
  band.scale.set(1.012, 1, 1.012);
  g.add(band);
  const tilt = Math.atan((1.8 - 1.6) / 0.5);
  for (let k = 0; k < 16; k++) {
    const a = k * Math.PI / 8, corner = k % 2 === 0;
    const pivot = new THREE.Group();
    pivot.rotation.y = a;
    const r = (corner ? 1.7 : 1.7 * Math.cos(Math.PI / 8)) * 1.015;
    const bar = mesh(bevelBox(corner ? 0.12 : 0.05, 0.56, 0.06), M.black, 0, 6.72, r);
    bar.rotation.x = tilt;
    pivot.add(bar);
    g.add(pivot);
  }
  oct(2.05, 1.95, 0.16, M.dark, 7.23);                                                             // roof overhang
  oct(1.7, 1.9, 0.14, M.gunmetal, 7.38);
  g.add(mesh(new THREE.TorusGeometry(1.75, 0.05, 6, 8), M.gunmetal, 0, 6.18, 0).rotateX(Math.PI / 2));   // walkway
  g.add(mesh(new THREE.TorusGeometry(1.8, 0.025, 5, 8), M.amber, 0, 6.5, 0).rotateX(Math.PI / 2));       // railing
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4;
    g.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.34, 5), M.dark, Math.sin(a) * 1.8, 6.34, Math.cos(a) * 1.8));
  }

  // sensor deck: rotating radar, comms dome, dish, whip antennas with beacons
  const radar = new THREE.Group();
  radar.position.set(0, 7.45, 0);
  radar.add(mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.5, 8), M.gunmetal, 0, 0.25, 0));
  radar.add(mesh(bevelBox(0.3, 0.2, 0.3), M.dark, 0, 0.55, 0));
  const panel = mesh(bevelBox(2.0, 0.6, 0.08), M.white, 0, 0.85, 0.12);
  panel.rotation.x = -0.18;
  radar.add(panel);
  radar.add(mesh(bevelBox(2.04, 0.06, 0.12), M.dark, 0, 1.15, 0.07));
  for (const x of [-0.66, 0, 0.66]) radar.add(mesh(bevelBox(0.05, 0.62, 0.1), M.dark, x, 0.85, 0.1));
  radar.add(mesh(bevelBox(0.1, 0.1, 0.5), M.gunmetal, 0, 0.62, -0.2));
  g.add(radar);
  g.add(mesh(new THREE.SphereGeometry(0.34, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.white, -1.0, 7.45, 0.75));   // radome
  const dish = new THREE.Group();
  dish.position.set(1.05, 7.75, -0.7);
  dish.rotation.set(-0.7, 0.9, 0);
  dish.add(mesh(new THREE.SphereGeometry(0.34, 12, 8, 0, Math.PI * 2, 0, 1.0), M.white).rotateX(Math.PI));
  dish.add(mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.4, 5), M.dark, 0, -0.15, 0));
  g.add(dish);
  g.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.4, 6), M.dark, 1.05, 7.6, -0.7));
  for (const [x, z, h] of [[-0.9, -0.9, 1.9], [0.85, 0.95, 1.3]]) {
    g.add(mesh(new THREE.CylinderGeometry(0.018, 0.03, h, 5), M.dark, x, 7.45 + h / 2, z));
    g.add(mesh(new THREE.SphereGeometry(0.06, 8, 6), M.lens, x, 7.45 + h, z));
  }
  g.add(mesh(bevelBox(0.5, 0.26, 0.4), M.gunmetal, -0.2, 7.58, -1.1));                // equipment locker

  Object.assign(g.userData, { pylons, spin: radar, fairing: launchFairing(g) });
}

// Re-entry fairing: a four-petal aeroshell over the control room and sensor deck so the Core arrives looking like
// a rocket stage. Each petal is a group pivoted at its own centre of mass; the intro blows them off after landing.
function launchFairing(g) {
  const R = 2.32, Y0 = 5.05, Y1 = 5.75, Y2 = 8.3, Y3 = 13.0;
  const profile = (from, to, off = 0) => {
    const pts = [];
    if (from === 0) pts.push(new THREE.Vector2(1.3 + off, Y0), new THREE.Vector2(R + off, Y1));
    for (let k = Math.max(0, from); k <= to; k++) {
      const u = k / 14;
      pts.push(new THREE.Vector2(Math.max(0.001, R * (1 - Math.pow(u, 1.45))) + off, Y2 + (Y3 - Y2) * u));
    }
    return pts;
  };
  const petals = [];
  for (let k = 0; k < 4; k++) {
    const a0 = k * Math.PI / 2 + 0.014, len = Math.PI / 2 - 0.028, am = k * Math.PI / 2 + Math.PI / 4;
    const c = new THREE.Vector3(Math.sin(am) * 1.35, 8.0, Math.cos(am) * 1.35);
    const petal = new THREE.Group();
    petal.position.copy(c);
    const part = (geo, mat) => { geo.translate(-c.x, -c.y, -c.z); const m = new THREE.Mesh(geo, mat); petal.add(m); return m; };
    part(new THREE.LatheGeometry(profile(0, 10), 10, a0, len), M.fairing);
    part(new THREE.LatheGeometry(profile(10, 14), 10, a0, len), M.fairingTip);                       // scorched nose cap
    const band = (y, h, mat) => {
      const geo = new THREE.CylinderGeometry(R + 0.02, R + 0.02, h, 10, 1, true, a0, len);
      geo.translate(0, y, 0);
      part(geo, mat);
    };
    band(5.95, 0.22, M.fairingTip);
    band(6.35, 0.1, M.fairingStripe);
    band(8.12, 0.16, M.fairingTip);
    // separation bolts along the base ring and a hazard chevron plate on the petal face
    for (const da of [-0.55, 0, 0.55]) {
      const geo = bevelBox(0.16, 0.16, 0.1);
      geo.translate(0, 5.8, R + 0.03);
      geo.rotateY(am + da);
      part(geo, M.fairingStripe);
    }
    const plate = bevelBox(0.7, 0.9, 0.06);
    plate.translate(0, 7.3, R + 0.0);
    plate.rotateY(am);
    part(plate, M.fairingTip);
    petal.userData.am = am;
    g.add(petal);
    petals.push(petal);
  }
  return petals;
}

// Wall: a central post plus four thin arms reaching to the tile edges. Only the arms that lead to a neighbouring wall
// are shown (setWallLinks), so runs, corners, T-junctions and crossings all join up.
function wallSegment(g) {
  g.add(mesh(bevelBox(0.72, 1.7, 0.72), M.metal, 0, 0.85, 0));
  g.add(mesh(bevelBox(0.86, 0.16, 0.86), M.dark, 0, 1.76, 0));
  g.add(mesh(bevelBox(0.9, 0.22, 0.9), M.dark, 0, 0.11, 0));
  g.add(mesh(bevelBox(0.3, 0.06, 0.3), M.amber, 0, 1.86, 0));
  const arms = {};
  for (const [key, dx, dz] of [['e', 1, 0], ['w', -1, 0], ['s', 0, 1], ['n', 0, -1]]) {
    const arm = new THREE.Group();
    arm.rotation.y = Math.atan2(-dz, dx);                    // local +x points at the neighbour
    arm.add(mesh(bevelBox(0.72, 1.35, 0.42), M.metal, 0.68, 0.675, 0));
    arm.add(mesh(bevelBox(0.72, 0.14, 0.54), M.dark, 0.68, 1.42, 0));
    arm.add(mesh(bevelBox(0.72, 0.2, 0.56), M.dark, 0.68, 0.1, 0));
    arm.add(mesh(bevelBox(0.5, 0.5, 0.46), M.gunmetal, 0.66, 0.8, 0));   // recessed armour panel
    g.add(arm);
    arms[key] = arm;
  }
  g.userData.arms = arms;
  g.scale.y = 0.75;                                        // low barrier: post tops out around 1.4 units
  setWallLinks(g, {});
}

// links: { n, e, s, w } booleans for neighbouring walls. A lone wall or a run's end piece still spans its tile.
export function setWallLinks(g, links) {
  const arms = g.userData.arms;
  if (!arms) return;
  let { n, e, s, w } = links;
  const count = !!n + !!e + !!s + !!w;
  if (count === 0) e = w = true;
  else if (count === 1) { if (n || s) n = s = true; else e = w = true; }
  arms.n.visible = !!n; arms.e.visible = !!e; arms.s.visible = !!s; arms.w.visible = !!w;
}

// Refinery (1x1): green pump house on a skid, banded storage tank with a domed cap and feed pipe, a flare stack and
// a roof extractor fan (userData.spin) turning inside its cowl.
function refinery(g) {
  g.add(mesh(bevelBox(1.9, 0.16, 1.9), M.dark, 0, 0.08, 0));
  g.add(mesh(bevelBox(1.7, 0.86, 1.7, 0.07), M.green, 0, 0.59, 0));
  g.add(mesh(bevelBox(1.78, 0.1, 1.78), M.dark, 0, 1.05, 0));                                      // roof lip
  g.add(mesh(bevelBox(1.72, 0.09, 0.04), M.amber, 0, 0.3, 0.86));                                  // hazard trim
  g.add(mesh(bevelBox(0.5, 0.62, 0.05), M.gunmetal, 0.45, 0.5, 0.86));                             // service door
  g.add(mesh(bevelBox(0.08, 0.08, 0.04), M.lens, 0.26, 0.55, 0.89));
  for (let k = 0; k < 4; k++) g.add(mesh(bevelBox(0.6, 0.05, 0.06), M.black, -0.4, 0.42 + k * 0.12, 0.86));   // louvres
  for (let k = 0; k < 4; k++) g.add(mesh(bevelBox(0.06, 0.05, 0.7), M.black, 0.86, 0.42 + k * 0.12, 0.2));

  // storage tank: shell, bands, dome, gauge strip, feed pipe with an elbow down into the pump house
  g.add(mesh(new THREE.CylinderGeometry(0.47, 0.47, 1.25, 20), M.metal, -0.45, 1.72, -0.4));
  const cap = mesh(new THREE.SphereGeometry(0.47, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.metal, -0.45, 2.345, -0.4);
  cap.scale.y = 0.45;
  g.add(cap);
  for (const y of [1.3, 1.9]) g.add(mesh(new THREE.TorusGeometry(0.475, 0.03, 6, 24), M.dark, -0.45, y, -0.4).rotateX(Math.PI / 2));
  g.add(mesh(bevelBox(0.05, 0.9, 0.03), M.gaugeFill, -0.45, 1.7, 0.075));
  g.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.2, 8), M.dark, -0.45, 2.62, -0.4));
  const pipe = mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.95, 8), M.dark, 0.02, 1.5, -0.4);
  pipe.rotation.z = Math.PI / 2;
  g.add(pipe);
  g.add(mesh(new THREE.SphereGeometry(0.085, 8, 6), M.dark, 0.5, 1.5, -0.4));
  g.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.42, 8), M.dark, 0.5, 1.3, -0.4));
  g.add(mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.05, 10), M.amber, 0.22, 1.5, -0.4).rotateZ(Math.PI / 2));   // valve wheel

  // flare stack with a guard ring and a pilot glow
  g.add(mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.3, 10), M.dark, 0.6, 1.25, 0.5));
  g.add(mesh(new THREE.CylinderGeometry(0.11, 0.15, 1.5, 10), M.gunmetal, 0.6, 1.85, 0.5));
  g.add(mesh(new THREE.CylinderGeometry(0.16, 0.13, 0.16, 10), M.black, 0.6, 2.66, 0.5));
  g.add(mesh(new THREE.TorusGeometry(0.15, 0.02, 5, 12), M.amber, 0.6, 2.2, 0.5).rotateX(Math.PI / 2));
  g.add(mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.03, 10), M.core, 0.6, 2.735, 0.5));

  // extractor fan in a cowl
  const ring = [[0.56, 0], [0.52, 0.2], [0.46, 0.2], [0.46, 0]].map(([r, y]) => new THREE.Vector2(r, y));
  g.add(mesh(new THREE.LatheGeometry(ring, 20), M.dark, 0.35, 1.1, -0.05));
  g.add(mesh(new THREE.CylinderGeometry(0.47, 0.47, 0.02, 20), M.black, 0.35, 1.115, -0.05));
  const fan = new THREE.Group();
  fan.position.set(0.35, 1.24, -0.05);
  fan.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.1, 10), M.gunmetal));
  for (let k = 0; k < 5; k++) {
    const blade = mesh(bevelBox(0.4, 0.02, 0.15), M.amber, 0, 0, 0);
    blade.geometry.translate(0.26, 0, 0);
    blade.rotation.set(0.35, (k / 5) * Math.PI * 2, 0, 'YXZ');
    fan.add(blade);
  }
  g.add(fan);
  for (const a of [0, Math.PI / 2]) {                                                               // guard bars
    const bar = mesh(bevelBox(1.0, 0.03, 0.03), M.black, 0.35, 1.31, -0.05);
    bar.rotation.y = a;
    g.add(bar);
  }
  g.userData.spin = fan;
}

// Research Lab (1x1): instrument block with lit window slots, a glass observation dome over a glowing containment core
// on ribbed frames, and a comms mast.
function researchLab(g) {
  g.add(mesh(bevelBox(1.9, 0.16, 1.9), M.dark, 0, 0.08, 0));
  g.add(mesh(bevelBox(1.72, 0.7, 1.72, 0.07), M.white, 0, 0.5, 0));
  g.add(mesh(bevelBox(1.8, 0.1, 1.8), M.trim, 0, 0.88, 0));
  for (let k = 0; k < 4; k++) {                                                                      // window slots and a blue trim line per face
    const face = new THREE.Group();
    face.rotation.y = k * Math.PI / 2;
    face.add(mesh(bevelBox(1.74, 0.05, 0.03), M.cyan, 0, 0.22, 0.865));
    if (k === 0) {
      face.add(mesh(bevelBox(0.46, 0.52, 0.05), M.gunmetal, 0, 0.5, 0.87));                          // airlock door
      face.add(mesh(bevelBox(0.2, 0.1, 0.03), M.window, 0, 0.64, 0.9));
    } else for (const x of [-0.45, 0.45]) face.add(mesh(bevelBox(0.5, 0.16, 0.03), M.window, x, 0.58, 0.865));
    g.add(face);
  }
  g.add(mesh(new THREE.CylinderGeometry(0.8, 0.84, 0.12, 24), M.trim, 0, 0.98, 0));                  // dome seat
  g.add(mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.2, 12), M.gunmetal, 0, 1.1, 0));
  g.add(mesh(new THREE.SphereGeometry(0.24, 16, 12), M.plasma, 0, 1.38, 0));                         // containment core
  const halo = mesh(new THREE.TorusGeometry(0.36, 0.02, 6, 24), M.cyan, 0, 1.38, 0);
  halo.rotation.x = Math.PI / 2 - 0.35;
  g.add(halo);
  const dome = mesh(new THREE.SphereGeometry(0.74, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.glass, 0, 1.03, 0);
  g.add(dome);
  for (let k = 0; k < 4; k++) {                                                                      // dome ribs
    const rib = mesh(new THREE.TorusGeometry(0.75, 0.022, 5, 16, Math.PI), M.trim, 0, 1.03, 0);
    rib.rotation.y = k * Math.PI / 4;
    g.add(rib);
  }
  g.add(mesh(new THREE.CylinderGeometry(0.03, 0.04, 1.3, 6), M.dark, 0.72, 1.55, 0.72));             // comms mast
  g.add(mesh(bevelBox(0.18, 0.1, 0.18), M.dark, 0.72, 0.96, 0.72));
  g.add(mesh(new THREE.SphereGeometry(0.07, 8, 6), M.cyan, 0.72, 2.24, 0.72));
  for (const [y, w] of [[1.75, 0.42], [1.95, 0.28]]) g.add(mesh(bevelBox(w, 0.025, 0.025), M.dark, 0.72, y, 0.72));   // yagi elements
  g.userData.dome = dome;
}

// ---------------------------------------------------------------- Strategic Uplink Tower
M.dish = worn(new THREE.MeshStandardMaterial({ color: 0xe4e8ec, roughness: 0.4, metalness: 0.2, side: THREE.DoubleSide }), { grime: 0.18, chips: 0.25 });
M.aviation = new THREE.MeshStandardMaterial({ color: 0xff3020, emissive: 0xff2010, emissiveIntensity: 0.3, roughness: 0.4 });   // blinks (uplink tick)

// A thin open cylinder from a to b (lattice members, guy wires, cable runs); merged by the caller.
const _sm = new THREE.Matrix4(), _sq = new THREE.Quaternion(), _sd = new THREE.Vector3(), _sc = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1), _sy = new THREE.Vector3(0, 1, 0);
function strut(a, b, r, segs = 5) {
  _sd.subVectors(b, a);
  const geo = new THREE.CylinderGeometry(r, r, _sd.length(), segs, 1, true);
  geo.applyMatrix4(_sm.compose(_sc.addVectors(a, b).multiplyScalar(0.5), _sq.setFromUnitVectors(_sy, _sd.normalize()), _one));
  return geo;
}
function boxAt(w, h, d, x, y, z, ry = 0) {
  const geo = new THREE.BoxGeometry(w, h, d);
  if (ry) geo.rotateY(ry);
  return geo.translate(x, y, z);
}

// Parabolic dish with its opening along +Y: bowl, rim, back mount, and a feed horn held at the focus on three struts.
function dish(R) {
  const g = new THREE.Group(), f = R * 0.62, pts = [];
  for (let k = 0; k <= 8; k++) { const r = R * k / 8; pts.push(new THREE.Vector2(r, (r * r) / (4 * f))); }
  g.add(mesh(new THREE.LatheGeometry(pts, 20), M.dish));
  const lip = R * R / (4 * f);
  g.add(mesh(new THREE.TorusGeometry(R, R * 0.035, 5, 24), M.trim, 0, lip, 0).rotateX(Math.PI / 2));
  g.add(mesh(new THREE.CylinderGeometry(R * 0.22, R * 0.3, R * 0.25, 10), M.gunmetal, 0, -R * 0.1, 0));
  const feed = [];
  for (let k = 0; k < 3; k++) {
    const a = k / 3 * Math.PI * 2;
    feed.push(strut(new THREE.Vector3(Math.cos(a) * R * 0.92, lip, Math.sin(a) * R * 0.92), new THREE.Vector3(0, f * 0.95, 0), R * 0.018, 4));
  }
  g.add(mesh(mergeGeometries(feed), M.dark));
  g.add(mesh(new THREE.CylinderGeometry(R * 0.07, R * 0.1, R * 0.22, 8), M.dark, 0, f, 0));
  return g;
}
// Point a +Y-opening part at a direction given as azimuth (around Y, 0 = +Z) and elevation above the horizon.
function aim(o, az, el) { o.rotation.set(0, az, 0, 'YXZ'); o.rotation.x = Math.PI / 2 - el; return o; }

// Strategic Uplink Tower (2x2, support): an armoured equipment hall with a tall red-and-white banded lattice mast set
// off-centre on its roof, bristling with dishes, microwave drums, cellular panels and whips, with walkway platforms,
// guy wires and blinking aviation lights. The big uplink dish on the roof slowly slews while it holds its link.
function uplinkTower(g) {
  g.add(mesh(bevelBox(3.8, 0.2, 3.8), M.dark, 0, 0.1, 0));
  g.add(mesh(bevelBox(2.9, 1.25, 2.9, 0.08), M.white, 0, 0.83, 0));
  g.add(mesh(bevelBox(3.0, 0.1, 3.0), M.trim, 0, 1.5, 0));
  for (let k = 0; k < 4; k++) {                                                                        // hall faces
    const face = new THREE.Group();
    face.rotation.y = k * Math.PI / 2;
    face.add(mesh(bevelBox(2.92, 0.12, 0.03), M.hazard, 0, 0.3, 1.455));
    face.add(mesh(bevelBox(2.92, 0.05, 0.03), M.cyan, 0, 1.3, 1.455));
    if (k === 0) {
      face.add(mesh(bevelBox(0.8, 0.95, 0.06), M.gunmetal, 0.55, 0.7, 1.46));                          // blast door
      face.add(mesh(bevelBox(0.9, 0.06, 0.07), M.amber, 0.55, 1.2, 1.46));
      face.add(mesh(new THREE.SphereGeometry(0.06, 8, 6), M.lens, 0.55, 1.1, 1.5));
      for (let q = 0; q < 5; q++) face.add(mesh(bevelBox(0.08, 0.08, 0.03), q % 2 ? M.cyan : M.window, -0.9 + q * 0.16, 0.95, 1.47));   // status lamps
    } else if (k === 1) {
      for (const x of [-0.7, 0, 0.7]) face.add(mesh(bevelBox(0.5, 0.16, 0.03), M.window, x, 0.95, 1.46));
    } else {
      for (let q = 0; q < 5; q++) face.add(mesh(bevelBox(0.9, 0.05, 0.06), M.black, k === 2 ? -0.6 : 0.6, 0.6 + q * 0.11, 1.46));   // louvres
      face.add(mesh(bevelBox(0.4, 0.5, 0.18), M.trim, k === 2 ? 0.7 : -0.7, 0.55, 1.52));                                          // conduit box
    }
    g.add(face);
  }

  // mast: square lattice tapering from 1.24 to 0.44 wide over nine banded panels, legs + girts + X bracing
  const MX = -0.45, MZ = -0.45, Y0 = 1.55, YT = 13.25, N = 9;
  const hw = (y) => 0.62 + (0.22 - 0.62) * (y - Y0) / (YT - Y0);
  const corner = (y, cx, cz) => new THREE.Vector3(MX + cx * hw(y), y, MZ + cz * hw(y));
  const C = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const red = [], white = [];
  for (let p = 0; p < N; p++) {
    const ya = Y0 + (YT - Y0) * p / N, yb = Y0 + (YT - Y0) * (p + 1) / N, out = p % 2 ? white : red;
    for (let k = 0; k < 4; k++) {
      const [ax, az] = C[k], [bx, bz] = C[(k + 1) % 4];
      out.push(strut(corner(ya, ax, az), corner(yb, ax, az), 0.045));                                  // leg
      out.push(strut(corner(yb, ax, az), corner(yb, bx, bz), 0.028));                                  // girt
      out.push(strut(corner(ya, ax, az), corner(yb, bx, bz), 0.02), strut(corner(ya, bx, bz), corner(yb, ax, az), 0.02));   // X brace
    }
  }
  g.add(mesh(mergeGeometries(red), M.red), mesh(mergeGeometries(white), M.white));
  g.add(mesh(strut(new THREE.Vector3(MX - 0.1, Y0, MZ - hw(Y0) - 0.03), new THREE.Vector3(MX - 0.1, YT, MZ - hw(YT) - 0.03), 0.045, 6), M.cable));   // feeder cable run

  // top mast: banded pole, strobe, lightning rod and a fan of whips
  g.add(mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.0, 8), M.red, MX, YT + 0.5, MZ));
  g.add(mesh(new THREE.CylinderGeometry(0.045, 0.06, 0.8, 8), M.white, MX, YT + 1.4, MZ));
  g.add(mesh(new THREE.CylinderGeometry(0.012, 0.02, 0.7, 5), M.dark, MX, YT + 2.15, MZ));
  const lights = [mesh(new THREE.SphereGeometry(0.09, 10, 8), M.aviation, MX, YT + 1.85, MZ)];
  const whips = [];
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2 + Math.PI / 4, base = corner(YT, C[k][0], C[k][1]);
    whips.push(strut(base, new THREE.Vector3(base.x + Math.cos(a) * 0.22, YT + 1.5, base.z + Math.sin(a) * 0.22), 0.012, 4));
  }
  g.add(mesh(mergeGeometries(whips), M.dark));

  // walkway platforms with safety rails, a pair of aviation lights on each
  for (const y of [Y0 + (YT - Y0) * 3 / 9, Y0 + (YT - Y0) * 6 / 9, Y0 + (YT - Y0) * 8.5 / 9]) {
    const h = hw(y) + 0.32, rails = [];
    g.add(mesh(bevelBox(h * 2, 0.06, h * 2), M.gunmetal, MX, y, MZ));
    for (const [sx, sz] of C) rails.push(boxAt(0.035, 0.4, 0.035, MX + sx * h, y + 0.2, MZ + sz * h));
    for (const yy of [0.2, 0.38]) for (let k = 0; k < 4; k++) {
      const [sx, sz] = C[k], horiz = k % 2 === 0;
      rails.push(boxAt(horiz ? h * 2 : 0.025, 0.025, horiz ? 0.025 : h * 2, MX + (horiz ? 0 : sx * h), y + yy, MZ + (horiz ? sz * h : 0)));
    }
    g.add(mesh(mergeGeometries(rails), M.amber));
    for (const [sx, sz] of [[1, 1], [-1, -1]]) lights.push(mesh(new THREE.SphereGeometry(0.06, 8, 6), M.aviation, MX + sx * h, y + 0.45, MZ + sz * h));
  }
  g.add(...lights);

  // mast dishes: two mid-size on the first platform, three small ones higher up, all angled up at the sky
  const P1 = Y0 + (YT - Y0) * 3 / 9, P2 = Y0 + (YT - Y0) * 6 / 9;
  for (const [az, R, y, el] of [[Math.PI / 2, 0.42, P1 + 0.55, 0.55], [0, 0.42, P1 + 0.55, 0.7], [Math.PI * 0.25, 0.3, P2 + 0.45, 0.8], [Math.PI * 1.25, 0.3, P2 + 0.45, 0.6], [Math.PI * 0.75, 0.28, P2 - 0.9, 0.35]]) {
    const r = hw(y) + R * 0.75, d = aim(dish(R), az, el);
    d.position.set(MX + Math.sin(az) * r, y, MZ + Math.cos(az) * r);
    g.add(d);
    g.add(mesh(strut(new THREE.Vector3(MX + Math.sin(az) * hw(y), y, MZ + Math.cos(az) * hw(y)), d.position, 0.03, 5), M.gunmetal));
  }
  for (const [az, R, y, el] of [[Math.PI * 1.75, 0.26, 7.3, 0.5], [Math.PI * 0.5, 0.24, 11.0, 0.75], [Math.PI * 1.1, 0.22, 11.3, 0.9]]) {
    const r = hw(y) + R * 0.75, d = aim(dish(R), az, el);
    d.position.set(MX + Math.sin(az) * r, y, MZ + Math.cos(az) * r);
    g.add(d);
  }
  // microwave link drums (radomes) on the legs, pointing out horizontally
  for (const [az, y] of [[Math.PI * 1.5, 3.4], [Math.PI, 4.2], [Math.PI * 1.5, 7.5], [Math.PI * 0.5, 8.3], [Math.PI, 10.4], [Math.PI * 1.25, 6.6], [Math.PI * 0.25, 4.9], [Math.PI * 1.5, 10.9]]) {
    const r = hw(y) + 0.2, drum = new THREE.Group();
    drum.position.set(MX + Math.sin(az) * r, y, MZ + Math.cos(az) * r);
    drum.rotation.y = az;
    drum.add(mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.2, 16), M.gunmetal, 0, 0, 0).rotateX(Math.PI / 2));
    drum.add(mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.02, 16), M.dish, 0, 0, 0.11).rotateX(Math.PI / 2));
    g.add(drum);
  }
  // cellular panel sectors under the top platform
  const P3 = Y0 + (YT - Y0) * 8.5 / 9, panels = [], pipes = [];
  for (let k = 0; k < 3; k++) for (const off of [-0.18, 0.18]) {
    const a = k * Math.PI * 2 / 3 + 0.3, r = hw(P3) + 0.42, px = MX + Math.sin(a) * r + Math.cos(a) * off, pz = MZ + Math.cos(a) * r - Math.sin(a) * off;
    panels.push(boxAt(0.15, 0.8, 0.06, px, P3 - 0.55, pz, a));
    pipes.push(strut(new THREE.Vector3(px, P3 - 0.2, pz), new THREE.Vector3(MX + Math.sin(a) * hw(P3 - 0.2), P3 - 0.2, MZ + Math.cos(a) * hw(P3 - 0.2)), 0.02, 4));
  }
  for (let k = 0; k < 3; k++) {                                                                          // a second, lower sector ring
    const a = k * Math.PI * 2 / 3 + 1.3, r = hw(P2) + 0.38, px = MX + Math.sin(a) * r, pz = MZ + Math.cos(a) * r;
    panels.push(boxAt(0.14, 0.62, 0.05, px, P2 - 0.5, pz, a));
    pipes.push(strut(new THREE.Vector3(px, P2 - 0.3, pz), new THREE.Vector3(MX + Math.sin(a) * hw(P2 - 0.3), P2 - 0.3, MZ + Math.cos(a) * hw(P2 - 0.3)), 0.02, 4));
  }
  g.add(mesh(mergeGeometries(panels), M.white), mesh(mergeGeometries(pipes), M.gunmetal));
  // whips standing off the top platform's corners, and crossed dipoles on the second platform's rails
  const rods = [];
  for (const [sx, sz] of C) {
    const h3 = hw(P3) + 0.32, b3 = new THREE.Vector3(MX + sx * h3, P3 + 0.38, MZ + sz * h3);
    rods.push(strut(b3, new THREE.Vector3(b3.x + sx * 0.08, P3 + 1.75, b3.z + sz * 0.08), 0.014, 4));
    const h2 = hw(P2) + 0.32, x2 = MX + sx * h2, z2 = MZ + sz * h2;
    rods.push(strut(new THREE.Vector3(x2, P2 + 0.38, z2), new THREE.Vector3(x2, P2 + 1.1, z2), 0.016, 4));
    rods.push(strut(new THREE.Vector3(x2 - 0.22, P2 + 0.95, z2), new THREE.Vector3(x2 + 0.22, P2 + 0.95, z2), 0.012, 4));
    rods.push(strut(new THREE.Vector3(x2, P2 + 0.85, z2 - 0.22), new THREE.Vector3(x2, P2 + 0.85, z2 + 0.22), 0.012, 4));
  }
  g.add(mesh(mergeGeometries(rods), M.dark));
  // yagi on a boom off the second platform
  const yagi = new THREE.Group();
  yagi.position.set(MX + hw(P2 + 0.2) + 0.05, P2 + 0.2, MZ);
  yagi.rotation.y = Math.PI / 2;
  yagi.add(mesh(bevelBox(0.03, 0.03, 1.1), M.dark, 0, 0, 0.55));
  for (let q = 0; q < 6; q++) yagi.add(mesh(bevelBox(0.5 - q * 0.05, 0.02, 0.02), M.trim, 0, 0, 0.12 + q * 0.18));
  g.add(yagi);

  // guy wires from the plinth corners to the second platform
  const guys = [];
  for (const [sx, sz] of C) {
    const a = new THREE.Vector3(sx * 1.78, 0.22, sz * 1.78);
    guys.push(strut(a, corner(P2, sx, sz), 0.012, 4));
    g.add(mesh(bevelBox(0.18, 0.1, 0.18), M.gunmetal, a.x, 0.24, a.z));
  }
  g.add(mesh(mergeGeometries(guys), M.cable));

  // roof: the main uplink dish on an az-el pedestal, an HVAC unit and a small secondary dish
  const ped = new THREE.Group();
  ped.position.set(0.85, 1.55, 0.85);
  g.add(ped);
  ped.add(mesh(new THREE.CylinderGeometry(0.2, 0.28, 0.5, 12), M.trim, 0, 0.25, 0));
  const slew = new THREE.Group();
  slew.position.y = 0.5;
  ped.add(slew);
  slew.add(mesh(bevelBox(0.36, 0.22, 0.3), M.gunmetal, 0, 0.1, 0));
  const big = aim(dish(0.66), 0, 0.62);
  big.position.set(0, 0.42, 0.12);
  slew.add(big);
  g.add(mesh(bevelBox(0.7, 0.32, 0.5), M.trim, 0.9, 1.71, -0.95));
  g.add(mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.04, 14), M.black, 0.9, 1.88, -0.95));
  const small = aim(dish(0.28), -Math.PI * 0.35, 0.9);
  small.position.set(-1.05, 1.95, 0.9);
  g.add(small);
  g.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 6), M.dark, -1.05, 1.75, 0.9));

  const slew0 = Math.PI * 0.25;
  g.userData.slew = slew;                                                                              // it turns: bake.js keeps it apart
  g.userData.tick = (dt, t) => {
    slew.rotation.y = slew0 + 0.55 * Math.sin(t * 0.13) + 0.2 * Math.sin(t * 0.31);                  // holding the link as the bird crosses the sky
    M.aviation.emissiveIntensity = (t % 1.6) < 0.22 ? 6 : 0.3;                                         // shared: every tower blinks in step
  };
}

const ROUND_FOOTING = { hmg: [0.86, 8], turret: [1.16, 8], dual: [1.16, 8], flame: [1.11, 8], laser: [1.1, 24], mortar: [1.86, 20] };   // [radius, sides]

export function makeBuildingMesh(type) {
  const g = new THREE.Group();
  switch (type) {
    case 'wall': wallSegment(g); break;
    case 'heli': makeHelipad(g); break;
    case 'airship': makeAirshipPad(g); break;
    case 'hmg': hmg(g); break;
    case 'flame': flamethrower(g); break;
    case 'mortar': mortarPit(g); break;
    case 'missile': missileSilo(g); break;
    case 'rail': railgun(g); break;
    case 'turret': autocannon(g, false); break;
    case 'dual': autocannon(g, true); break;
    case 'laser': {
      // Directed-energy weapon: base plate, white pedestal, yoke with trunnion, beam-director tube.
      g.add(mesh(new THREE.CylinderGeometry(1.05, 1.1, 0.1, 24), M.white, 0, 0.05, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.9, 0.95, 0.06, 24), M.trim, 0, 0.13, 0));
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2;
        g.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.05, 6), M.black, Math.cos(a) * 0.98, 0.12, Math.sin(a) * 0.98));
      }
      g.add(mesh(new THREE.CylinderGeometry(0.55, 0.62, 1.4, 20), M.white, 0, 0.85, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.48, 0.55, 0.22, 20), M.trim, 0, 1.63, 0));

      const head = new THREE.Group();
      head.position.y = 1.74;
      // Yoke: two arms rising to the trunnion axle, with a small equipment shelf between them.
      for (const sx of [-1, 1]) {
        head.add(mesh(bevelBox(0.16, 0.7, 0.42), M.white, sx * 0.44, 0.3, -0.05));
        head.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 12), M.trim, sx * 0.55, 0.55, -0.05).rotateZ(Math.PI / 2));
      }
      head.add(mesh(bevelBox(0.72, 0.16, 0.5), M.white, 0, 0.05, -0.05));
      const axle = mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.0, 10), M.trim, 0, 0.55, -0.05);
      axle.rotation.z = Math.PI / 2;
      head.add(axle);

      // Sensor pods on the yoke arms: stereo camera pod on the right, single tracker on the left.
      const pod = mesh(bevelBox(0.28, 0.2, 0.34), M.white, 0.62, 0.2, 0.15);
      head.add(pod);
      for (const dy of [-0.05, 0.05]) {
        const cam = mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.08, 10), M.black, 0.62, 0.2 + dy, 0.35);
        cam.rotation.x = Math.PI / 2;
        head.add(cam);
      }
      head.add(mesh(bevelBox(0.22, 0.22, 0.28), M.white, -0.6, 0.2, 0.12));
      const tracker = mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.1, 12), M.black, -0.6, 0.2, 0.3);
      tracker.rotation.x = Math.PI / 2;
      head.add(tracker);

      // Cable conduits looping from the yoke down the back of the pedestal.
      for (const [x, r] of [[-0.2, 0.34], [0.12, 0.3]]) {
        const cable = mesh(new THREE.TorusGeometry(r, 0.028, 6, 14, Math.PI), M.cable, x, 0.05, -0.32);
        cable.rotation.set(0, Math.PI / 2, Math.PI);
        head.add(cable);
      }

      // Beam director pitches on the trunnion: main tube, front housing, lens, breech electronics box.
      const pitch = new THREE.Group();
      pitch.position.set(0, 0.55, -0.05);
      const tube = mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.5, 24), M.white, 0, 0.05, 0.35);
      tube.rotation.x = Math.PI / 2;
      pitch.add(tube);
      const housing = mesh(new THREE.CylinderGeometry(0.36, 0.33, 0.42, 24), M.white, 0, 0.05, 1.1);
      housing.rotation.x = Math.PI / 2;
      pitch.add(housing);
      const bezel = mesh(new THREE.TorusGeometry(0.31, 0.035, 8, 24), M.trim, 0, 0.05, 1.31);
      pitch.add(bezel);
      const lens = mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.04, 24), M.lensGlass.clone(), 0, 0.05, 1.32);
      lens.rotation.x = Math.PI / 2;
      pitch.add(lens);
      for (const z of [0.0, 0.45]) pitch.add(mesh(new THREE.TorusGeometry(0.31, 0.02, 6, 24), M.trim, 0, 0.05, z));
      pitch.add(mesh(bevelBox(0.5, 0.36, 0.5), M.white, 0, 0.0, -0.6));
      pitch.add(mesh(bevelBox(0.54, 0.08, 0.3), M.trim, 0, 0.24, -0.6));
      pitch.add(mesh(bevelBox(0.16, 0.14, 1.2), M.trim, 0, -0.3, 0.3));
      pitch.rotation.x = -0.25;                                  // idle: nose slightly raised
      const muzzle = new THREE.Object3D();
      muzzle.position.set(0, 0.05, 1.36);
      pitch.add(muzzle);
      head.add(pitch);
      g.add(head);
      Object.assign(g.userData, { head, pitch, muzzle, lens, idlePitch: -0.25 });
      break;
    }
    case 'refinery': refinery(g); break;
    case 'lab': researchLab(g); break;
    case 'uplink': uplinkTower(g); break;
    case 'core': commandTower(g); break;
  }
  // Foundation sunk into the ground under everything but walls and the (air-dropped) Core, so a building on a slope
  // shows a footing on its downhill side instead of daylight under the base plate.
  if (type !== 'wall' && type !== 'core') {
    const round = ROUND_FOOTING[type];
    const [w, d] = BUILDINGS[type].size || [1, 1];
    const geo = round ? new THREE.CylinderGeometry(round[0], round[0] * 1.05, 1.6, round[1]) : bevelBox(w * 2 - 0.2, 1.6, d * 2 - 0.2);
    g.add(mesh(geo, M.footing, 0, -0.79, 0));
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = !o.material.transparent; o.receiveShadow = true; } });
  return bakeStatic(g);                                    // fixed parts merged per material: far fewer draw calls
}

export function ghostify(group, ok) {
  group.traverse((o) => { if (o.isMesh) { o.material = ok ? M.ghostOk : M.ghostBad; o.castShadow = false; } });
}

// Procedural insectoid with articulated two-segment legs, layered chitin plates, mandibles and antennae.
// Faces +Z. userData exposes the rig for the gait/attack/death animations in game.js.
const bugMats = new Map();
function bugMaterials(def) {
  if (bugMats.has(def.name)) return bugMats.get(def.name);
  const m = {
    body: new THREE.MeshPhysicalMaterial({ color: def.color, roughness: 0.5, metalness: 0.1, clearcoat: 0.5, clearcoatRoughness: 0.35 }),
    plate: new THREE.MeshPhysicalMaterial({ color: def.plate, roughness: 0.35, metalness: 0.15, clearcoat: 0.9, clearcoatRoughness: 0.2 }),
    leg: new THREE.MeshStandardMaterial({ color: def.legColor, roughness: 0.65, metalness: 0.1 }),
    accent: new THREE.MeshStandardMaterial({ color: def.accent, emissive: def.spikes ? 0x000000 : def.accent, emissiveIntensity: 1.6, roughness: 0.4 }),
    eye: new THREE.MeshStandardMaterial({ color: def.eye, emissive: def.eye, emissiveIntensity: 2.2 }),
  };
  bugMats.set(def.name, m);
  return m;
}

const plateGeo = new THREE.SphereGeometry(1, 12, 7, 0, Math.PI * 2, 0, Math.PI / 2);
function plate(mat, x, y, z, sx, sy, sz, tilt = 0) {
  const p = new THREE.Mesh(plateGeo, mat);
  p.position.set(x, y, z);
  p.scale.set(sx, sy, sz);
  p.rotation.x = tilt;
  return p;
}

export function makeBugMesh(def) {
  const g = new THREE.Group();
  const M = bugMaterials(def);
  const body = new THREE.Group();
  g.add(body);

  // Abdomen: three tapering segments curving upward like a wasp, each with a dorsal plate.
  const segs = [[-0.42, 0.55, 0.42, 1.0], [-0.85, 0.6, 0.35, 0.9], [-1.18, 0.67, 0.25, 0.85]];
  for (const [z, y, r, sq] of segs) {
    const seg = mesh(new THREE.SphereGeometry(r, 12, 9), M.body, 0, y, z);
    seg.scale.set(1, 0.8 * sq, 1.15);
    body.add(seg);
    body.add(plate(M.plate, 0, y + 0.02, z, r * 1.05, r * 0.85, r * 1.2));
  }
  if (def.spikes) {
    for (const [z, y, r] of segs) for (const sx of [-1, 1]) {
      const sp = mesh(new THREE.ConeGeometry(r * 0.22, r * 1.1, 5), M.accent, sx * r * 0.45, y + r * 0.75, z);
      sp.rotation.set(-0.5, 0, sx * 0.45);
      body.add(sp);
    }
  } else {
    for (const [z, y, r] of segs) for (const sx of [-1, 1]) {
      body.add(mesh(new THREE.SphereGeometry(r * 0.16, 6, 5), M.accent, sx * r * 0.85, y - r * 0.1, z));
    }
  }

  // Thorax with a raised carapace.
  const thorax = mesh(new THREE.SphereGeometry(0.36, 12, 9), M.body, 0, 0.58, 0.05);
  thorax.scale.set(1, 0.85, 1.25);
  body.add(thorax);
  body.add(plate(M.plate, 0, 0.62, 0.02, 0.4, 0.34, 0.48));
  if (def.spikes) {
    const crest = mesh(new THREE.ConeGeometry(0.1, 0.5, 5), M.accent, 0, 0.98, -0.05);
    crest.rotation.x = -0.6;
    body.add(crest);
  }

  // Head, eyes, horns, mandibles, antennae.
  const head = new THREE.Group();
  head.position.set(0, 0.62, 0.52);
  body.add(head);
  const skull = mesh(new THREE.SphereGeometry(0.28, 12, 9), M.body);
  skull.scale.set(1, 0.9, 1.1);
  head.add(skull);
  head.add(plate(M.plate, 0, 0.04, -0.02, 0.3, 0.24, 0.32, 0.25));
  for (const sx of [-1, 1]) {
    head.add(mesh(new THREE.SphereGeometry(def.spikes ? 0.08 : 0.09, 8, 6), M.eye, sx * 0.17, 0.1, 0.2));
    if (def.spikes) {
      const horn = mesh(new THREE.ConeGeometry(0.06, 0.45, 5), M.accent, sx * 0.2, 0.22, 0.05);
      horn.rotation.set(-0.8, 0, sx * 0.6);
      head.add(horn);
    }
  }
  const mandibles = [];
  for (const sx of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.14, -0.1, 0.2);
    pivot.scale.x = sx;
    const arc = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.035, 5, 8, 2.0), def.spikes ? M.accent : M.leg);
    arc.position.x = -0.17;
    arc.rotation.x = Math.PI / 2;
    pivot.add(arc);
    head.add(pivot);
    mandibles.push(pivot);
  }
  const antennae = [];
  for (const sx of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.1, 0.22, 0.1);
    pivot.rotation.set(-0.9, 0, -sx * 0.45);
    const a = mesh(new THREE.CylinderGeometry(0.012, 0.02, 0.55, 4), M.leg, 0, 0.27, 0);
    pivot.add(a);
    head.add(pivot);
    antennae.push({ pivot, base: -0.9 });
  }

  // Legs: hip (yaw sweep) -> femur (up/out) -> knee -> tibia (down). Tripod gait phases.
  const legs = [];
  const lr = def.legR;
  const femurGeo = new THREE.CylinderGeometry(0.03 * lr, 0.045 * lr, 0.5, 5);
  const tibiaGeo = new THREE.CylinderGeometry(0.012 * lr, 0.035 * lr, 0.8, 5);
  const hipZ = [0.32, 0.05, -0.22], hipYaw = [0.55, 0.0, -0.55];
  for (const side of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const hip = new THREE.Group();
      hip.position.set(side * 0.28, 0.5, hipZ[k]);
      hip.scale.x = side;
      hip.rotation.y = hipYaw[k];
      const femur = new THREE.Group();
      femur.rotation.z = 0.75;
      const fm = new THREE.Mesh(femurGeo, M.leg);
      fm.rotation.z = -Math.PI / 2;
      fm.position.x = 0.25;
      femur.add(fm);
      const knee = new THREE.Group();
      knee.position.x = 0.5;
      knee.rotation.z = -0.55;
      knee.add(mesh(new THREE.SphereGeometry(0.045 * lr, 6, 5), M.plate));
      const tb = new THREE.Mesh(tibiaGeo, M.leg);
      tb.position.y = -0.4;
      knee.add(tb);
      femur.add(knee);
      hip.add(femur);
      g.add(hip);
      const tripod = (k + (side > 0 ? 0 : 1)) % 2;
      legs.push({ hip, femur, knee, baseYaw: hipYaw[k], femurBase: 0.75, kneeBase: -0.55, phase: tripod * Math.PI + (k - 1) * 0.25 });
    }
  }

  g.userData = { legs, body, head, mandibles, antennae };
  g.scale.setScalar(def.scale);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

const shellGeo = new THREE.SphereGeometry(0.16, 6, 5);
export const makeProjectile = () => new THREE.Mesh(shellGeo, M.shell);

const beamGeo = new THREE.CylinderGeometry(0.07, 0.07, 1, 6);
const _dir = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const tracerGeo = new THREE.CylinderGeometry(0.035, 0.035, 1, 5);
export function makeTracer(from, to) {
  const m = new THREE.Mesh(tracerGeo, M.tracer);
  _dir.subVectors(to, from);
  const len = _dir.length();
  m.position.copy(from).addScaledVector(_dir, 0.5);
  m.quaternion.setFromUnitVectors(_up, _dir.normalize());
  m.scale.set(1, len, 1);
  return m;
}

export function makeBeam(from, to) {
  const m = new THREE.Mesh(beamGeo, M.beam);
  _dir.subVectors(to, from);
  const len = _dir.length();
  m.position.copy(from).addScaledVector(_dir, 0.5);
  m.quaternion.setFromUnitVectors(_up, _dir.normalize());
  m.scale.set(1, len, 1);
  return m;
}

const mortarShellGeo = new THREE.CylinderGeometry(0.12, 0.14, 0.6, 8);
const mortarTipGeo = new THREE.ConeGeometry(0.12, 0.28, 8);
export function makeMortarShell() {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(mortarShellGeo, M.dark));
  const tip = new THREE.Mesh(mortarTipGeo, M.brass);
  tip.position.y = 0.44;
  g.add(tip);
  return g;
}

const missileBodyGeo = new THREE.CylinderGeometry(0.11, 0.11, 1.0, 8);
const missileNoseGeo = new THREE.ConeGeometry(0.11, 0.32, 8);
const missileFinGeo = new THREE.BoxGeometry(0.02, 0.22, 0.2);
const missileFlameGeo = new THREE.ConeGeometry(0.13, 1.1, 8, 1, true);
export function makeMissile() {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(missileBodyGeo, M.white));
  const nose = new THREE.Mesh(missileNoseGeo, M.red);
  nose.position.y = 0.66;
  g.add(nose);
  for (let k = 0; k < 4; k++) {
    const f = new THREE.Mesh(missileFinGeo, M.dark);
    f.position.set(Math.cos(k * Math.PI / 2) * 0.13, -0.4, Math.sin(k * Math.PI / 2) * 0.13);
    f.rotation.y = -k * Math.PI / 2;
    g.add(f);
  }
  const flame = new THREE.Mesh(missileFlameGeo, M.beam);
  flame.rotation.x = Math.PI;
  flame.position.y = -1.05;
  g.add(flame);
  g.userData.flame = flame;
  return g;
}

const casingGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.16, 6);
export const makeCasings = (cap) => instancePool(casingGeo, M.brass, cap);           // every spent casing, one draw

const gibGeo = new THREE.SphereGeometry(0.13, 6, 5);
export const makeGibs = (kind, cap) => instancePool(gibGeo, M[kind] || M.ichor, cap);   // one draw per kind

const markerGeo = new THREE.RingGeometry(1.6, 2.2, 24);
export function makeSpawnMarker() {
  const m = new THREE.Mesh(markerGeo, M.marker);
  m.rotation.x = -Math.PI / 2;
  return m;
}
