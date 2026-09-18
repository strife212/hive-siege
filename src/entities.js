import * as THREE from 'three';

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
  capIdle: new THREE.MeshStandardMaterial({ color: 0x4fd1ff, emissive: 0x2aa8dd, emissiveIntensity: 0.3, roughness: 0.3 }),
  white: new THREE.MeshStandardMaterial({ color: 0xdfe4e8, roughness: 0.45, metalness: 0.15 }),
  trim: new THREE.MeshStandardMaterial({ color: 0x6d737b, roughness: 0.55, metalness: 0.5 }),
  cable: new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.8, metalness: 0.1 }),
  lensGlass: new THREE.MeshPhysicalMaterial({ color: 0x0b2f3d, emissive: 0x1c8aa6, emissiveIntensity: 0.9, roughness: 0.1, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.05 }),
  cyan:  new THREE.MeshStandardMaterial({ color: 0x4fd1ff, emissive: 0x2aa8dd, emissiveIntensity: 1.2, roughness: 0.2 }),
  green: new THREE.MeshStandardMaterial({ color: 0x5f8f5a, roughness: 0.7, metalness: 0.2 }),
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
  head.add(mesh(new THREE.BoxGeometry(W, 0.5, 1.0), M.amber, 0, 0.15, -0.05));
  head.add(mesh(new THREE.BoxGeometry(W + 0.1, 0.16, 0.7), M.dark, 0, 0.42, -0.15));
  head.add(mesh(new THREE.BoxGeometry(W + 0.08, 0.3, 0.5), M.dark, 0, 0.0, -0.5));

  const addOptic = (x, y, z) => {
    const optic = mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.3, 10), M.black, x, y, z);
    optic.rotation.x = Math.PI / 2;
    head.add(optic);
    const lens = mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.02, 10), M.lens, x, y, z + 0.16);
    lens.rotation.x = Math.PI / 2;
    head.add(lens);
  };
  const addPort = (side) => {
    head.add(mesh(new THREE.BoxGeometry(0.1, 0.14, 0.24), M.black, side * (W / 2 + 0.05), 0.1, 0.05));
    const port = new THREE.Object3D();
    port.position.set(side * (W / 2 + 0.11), 0.12, 0.05);
    head.add(port);
    return port;
  };
  let ports;
  if (dual) {
    for (const sx of [-1, 1]) {
      head.add(mesh(new THREE.BoxGeometry(0.3, 0.3, 0.5), M.olive, sx * 0.38, 0.65, -0.2));
      head.add(mesh(new THREE.BoxGeometry(0.34, 0.04, 0.54), M.black, sx * 0.38, 0.82, -0.2));
    }
    addOptic(0, 0.62, 0.25);
    ports = [addPort(-1), addPort(1)];
  } else {
    head.add(mesh(new THREE.BoxGeometry(0.3, 0.36, 0.55), M.olive, -0.62, 0.12, -0.1));
    head.add(mesh(new THREE.BoxGeometry(0.34, 0.04, 0.5), M.black, -0.62, 0.32, -0.1));
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
  if (dual) head.add(mesh(new THREE.BoxGeometry(0.5, 0.08, 0.3), M.dark, 0, 0.12, 1.0));   // barrel clamp
  g.add(head);
  Object.assign(g.userData, { head, guns, gunRest: 0.3 });
}

// Heavy machine gun: light pedestal mount, receiver with belt box, long ringed barrel. Fast, small recoil.
function hmg(g) {
  g.add(mesh(new THREE.CylinderGeometry(0.75, 0.85, 0.25, 8), M.dark, 0, 0.125, 0));
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + Math.PI / 6;
    const leg = mesh(new THREE.BoxGeometry(0.12, 0.12, 0.7), M.metal, Math.cos(a) * 0.45, 0.3, Math.sin(a) * 0.45);
    leg.rotation.y = -a + Math.PI / 2;
    leg.rotation.x = 0.35;
    g.add(leg);
  }
  g.add(mesh(new THREE.CylinderGeometry(0.22, 0.28, 0.8, 10), M.metal, 0, 0.6, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.12, 12), M.black, 0, 1.02, 0));

  const head = new THREE.Group();
  head.position.y = 1.08;
  head.add(mesh(new THREE.BoxGeometry(0.46, 0.3, 0.6), M.dark, 0, 0.15, -0.1));            // cradle
  head.add(mesh(new THREE.BoxGeometry(0.28, 0.3, 0.42), M.olive, -0.42, 0.22, -0.15));      // belt box
  head.add(mesh(new THREE.BoxGeometry(0.3, 0.03, 0.44), M.black, -0.42, 0.38, -0.15));
  head.add(mesh(new THREE.BoxGeometry(0.16, 0.06, 0.18), M.brass, -0.24, 0.3, 0.02));       // belt feed
  head.add(mesh(new THREE.BoxGeometry(0.1, 0.12, 0.2), M.black, 0.3, 0.26, 0.05));          // ejection port
  const port = new THREE.Object3D();
  port.position.set(0.36, 0.28, 0.05);
  head.add(port);
  const sight = mesh(new THREE.BoxGeometry(0.06, 0.1, 0.25), M.black, 0.08, 0.5, -0.05);
  head.add(sight);

  const gun = new THREE.Group();
  gun.position.set(0, 0.3, 0.2);
  head.add(gun);
  gun.add(mesh(new THREE.BoxGeometry(0.2, 0.22, 0.7), M.gunmetal, 0, 0, -0.1));             // receiver
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
    g.add(mesh(new THREE.BoxGeometry(0.22, 0.08, 0.1), M.amber, Math.cos(a) * 0.86, 0.7, Math.sin(a) * 0.86)).rotation.y = -a;
  }
  g.add(mesh(new THREE.CylinderGeometry(0.5, 0.58, 0.22, 12), M.dark, 0, 0.78, 0));

  const head = new THREE.Group();
  head.position.y = 1.0;
  head.add(mesh(new THREE.BoxGeometry(0.9, 0.45, 0.8), M.metal, 0, 0.2, -0.1));                 // body
  head.add(mesh(new THREE.BoxGeometry(1.0, 0.06, 0.5), M.black, 0, 0.45, -0.2));
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
  const shield = mesh(new THREE.BoxGeometry(1.1, 0.5, 0.06), M.dark, 0, 0.25, 0.34);              // blast shield
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

// Mortar Pit (2x2): sandbag ring, baseplate, tube on a yaw pivot fixed at 60 degrees, shell rack.
function mortarPit(g) {
  g.add(mesh(new THREE.CylinderGeometry(1.75, 1.85, 0.16, 20), M.dark, 0, 0.08, 0));
  for (let layer = 0; layer < 2; layer++) {
    for (let k = 0; k < 16; k++) {
      const a = ((k + layer * 0.5) / 16) * Math.PI * 2;
      const bag = mesh(new THREE.BoxGeometry(0.85, 0.36, 0.5), M.sandbag, Math.cos(a) * 1.75, 0.2 + layer * 0.34, Math.sin(a) * 1.75);
      bag.rotation.y = -a + Math.PI / 2;
      bag.rotation.z = (Math.random() - 0.5) * 0.08;
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
  g.add(mesh(new THREE.BoxGeometry(0.6, 0.45, 1.3), M.olive, -1.05, 0.38, -0.5));   // shell rack
  for (let k = 0; k < 4; k++) g.add(mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.55, 8), M.brass, -1.05, 0.85, -1.0 + k * 0.32));
  g.add(mesh(new THREE.BoxGeometry(0.5, 0.35, 0.5), M.dark, 1.05, 0.33, -0.9));      // ammo crate
  Object.assign(g.userData, { head, tube, muzzle, flash, tubeRest: 0 });
}

// Missile Silo (2x2): concrete slab, clamshell hatches, a launch rack that rises out of the pit.
function missileSilo(g) {
  g.add(mesh(new THREE.BoxGeometry(3.7, 0.5, 3.7), M.concrete, 0, 0.25, 0));
  g.add(mesh(new THREE.BoxGeometry(3.9, 0.08, 3.9), M.dark, 0, 0.04, 0));
  g.add(mesh(new THREE.BoxGeometry(2.3, 0.04, 2.3), M.black, 0, 0.51, 0));          // pit opening
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.5, 8), M.amber, sx * 1.65, 0.75, sz * 1.65));
  }
  g.add(mesh(new THREE.BoxGeometry(0.9, 0.7, 0.9), M.metal, 1.3, 0.85, 1.3));       // control shed
  g.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.2, 6), M.dark, 1.5, 1.7, 1.5));
  g.add(mesh(new THREE.SphereGeometry(0.06, 8, 6), M.lens, 1.5, 2.3, 1.5));
  const doors = [];
  for (const sx of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 1.15, 0.55, 0);
    const door = mesh(new THREE.BoxGeometry(1.15, 0.1, 2.3), M.metal, -sx * 0.575, 0, 0);
    pivot.add(door);
    pivot.add(mesh(new THREE.BoxGeometry(0.15, 0.12, 2.3), M.amber, -sx * 1.1, 0.01, 0));
    g.add(pivot);
    doors.push({ pivot, side: sx });
  }
  const rack = new THREE.Group();
  rack.position.y = -1.6;                              // stowed: fully below the slab and doors
  g.add(rack);
  rack.add(mesh(new THREE.BoxGeometry(1.7, 0.2, 2.1), M.dark, 0, 0, 0));
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

// Railgun Battery (2x2): concrete pad, turntable, cradle with capacitor banks, twin rails on a recoil sled.
function railgun(g) {
  g.add(mesh(new THREE.BoxGeometry(3.6, 0.3, 3.6), M.concrete, 0, 0.15, 0));
  g.add(mesh(new THREE.CylinderGeometry(1.5, 1.6, 0.4, 16), M.dark, 0, 0.5, 0));
  g.add(mesh(new THREE.TorusGeometry(1.45, 0.05, 6, 32), M.amber, 0, 0.72, 0).rotateX(Math.PI / 2));
  const head = new THREE.Group();
  head.position.y = 0.7;
  g.add(head);
  head.add(mesh(new THREE.BoxGeometry(1.6, 0.5, 1.6), M.metal, 0, 0.25, -0.2));
  for (const sx of [-1, 1]) {
    head.add(mesh(new THREE.BoxGeometry(0.1, 0.95, 1.7), M.dark, sx * 0.85, 0.55, -0.2));   // armour plates
  }
  const caps = M.capIdle.clone();
  for (const sx of [-1, 1]) for (const z of [-0.7, -0.2, 0.3]) {
    const c = mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.5, 10), caps, sx * 0.6, 0.85, z);
    c.rotation.x = Math.PI / 2;
    head.add(c);
    head.add(mesh(new THREE.TorusGeometry(0.18, 0.03, 6, 12), M.black, sx * 0.6, 0.85, z));
  }
  head.add(mesh(new THREE.BoxGeometry(0.7, 0.5, 0.9), M.dark, 0, 0.85, -0.7));       // breech
  const gun = new THREE.Group();
  gun.position.set(0, 0.9, 0.6);
  head.add(gun);
  for (const sx of [-1, 1]) gun.add(mesh(new THREE.BoxGeometry(0.12, 0.18, 4.4), M.gunmetal, sx * 0.2, 0, 1.6));
  for (const z of [0.1, 1.2, 2.3, 3.4]) gun.add(mesh(new THREE.BoxGeometry(0.62, 0.34, 0.14), M.dark, 0, 0, z));
  gun.add(mesh(new THREE.BoxGeometry(0.34, 0.1, 4.2), M.black, 0, -0.14, 1.6));
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0, 3.9);
  gun.add(muzzle);
  const flash = new THREE.Sprite(M.flash);
  flash.position.set(0, 0, 4.1);
  flash.scale.set(1.6, 1.6, 1);
  flash.visible = false;
  gun.add(flash);
  Object.assign(g.userData, { head, guns: [{ gun, muzzle, flash, port: null, side: 1 }], gunRest: 0.6, recoilAmp: 1.3, recoilReturn: 0.7, caps });
}

export function makeBuildingMesh(type) {
  const g = new THREE.Group();
  switch (type) {
    case 'wall': {
      g.add(mesh(new THREE.BoxGeometry(1.9, 1.5, 1.9), M.metal, 0, 0.75, 0));
      g.add(mesh(new THREE.BoxGeometry(2.0, 0.25, 2.0), M.dark, 0, 1.6, 0));
      break;
    }
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
        head.add(mesh(new THREE.BoxGeometry(0.16, 0.7, 0.42), M.white, sx * 0.44, 0.3, -0.05));
        head.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 12), M.trim, sx * 0.55, 0.55, -0.05).rotateZ(Math.PI / 2));
      }
      head.add(mesh(new THREE.BoxGeometry(0.72, 0.16, 0.5), M.white, 0, 0.05, -0.05));
      const axle = mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.0, 10), M.trim, 0, 0.55, -0.05);
      axle.rotation.z = Math.PI / 2;
      head.add(axle);

      // Sensor pods on the yoke arms: stereo camera pod on the right, single tracker on the left.
      const pod = mesh(new THREE.BoxGeometry(0.28, 0.2, 0.34), M.white, 0.62, 0.2, 0.15);
      head.add(pod);
      for (const dy of [-0.05, 0.05]) {
        const cam = mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.08, 10), M.black, 0.62, 0.2 + dy, 0.35);
        cam.rotation.x = Math.PI / 2;
        head.add(cam);
      }
      head.add(mesh(new THREE.BoxGeometry(0.22, 0.22, 0.28), M.white, -0.6, 0.2, 0.12));
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
      pitch.add(mesh(new THREE.BoxGeometry(0.5, 0.36, 0.5), M.white, 0, 0.0, -0.6));
      pitch.add(mesh(new THREE.BoxGeometry(0.54, 0.08, 0.3), M.trim, 0, 0.24, -0.6));
      pitch.add(mesh(new THREE.BoxGeometry(0.16, 0.14, 1.2), M.trim, 0, -0.3, 0.3));
      pitch.rotation.x = -0.25;                                  // idle: nose slightly raised
      const muzzle = new THREE.Object3D();
      muzzle.position.set(0, 0.05, 1.36);
      pitch.add(muzzle);
      head.add(pitch);
      g.add(head);
      Object.assign(g.userData, { head, pitch, muzzle, lens, idlePitch: -0.25 });
      break;
    }
    case 'refinery': {
      g.add(mesh(new THREE.BoxGeometry(1.8, 1.0, 1.8), M.green, 0, 0.5, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.6, 12), M.metal, -0.5, 1.4, -0.4));
      g.add(mesh(new THREE.CylinderGeometry(0.12, 0.15, 1.2, 8), M.dark, 0.6, 1.6, 0.5));
      const fan = mesh(new THREE.BoxGeometry(0.9, 0.08, 0.15), M.amber, 0.4, 1.12, -0.4);
      g.add(fan);
      g.userData.spin = fan;
      break;
    }
    case 'lab': {
      g.add(mesh(new THREE.BoxGeometry(1.8, 0.8, 1.8), M.metal, 0, 0.4, 0));
      g.add(mesh(new THREE.SphereGeometry(0.7, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.blue, 0, 0.8, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.2, 6), M.dark, 0.7, 1.4, 0.7));
      g.add(mesh(new THREE.SphereGeometry(0.08, 8, 6), M.cyan, 0.7, 2.0, 0.7));
      break;
    }
    case 'core': {
      g.add(mesh(new THREE.CylinderGeometry(2.2, 2.5, 0.8, 8), M.dark, 0, 0.4, 0));
      g.add(mesh(new THREE.CylinderGeometry(1.2, 1.6, 1.4, 8), M.metal, 0, 1.5, 0));
      const pylons = [];
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const geo = new THREE.BoxGeometry(0.3, 2.6, 0.3);
        geo.translate(0, -1.3, 0);                       // origin at the top: scale.y extends it downward
        const py = mesh(geo, M.metal, sx * 1.6, 2.6, sz * 1.6);
        g.add(py);
        pylons.push(py);
      }
      g.userData.pylons = pylons;
      const orb = mesh(new THREE.IcosahedronGeometry(0.8, 1), M.core, 0, 3.0, 0);
      g.add(orb);
      g.userData.spin = orb;
      break;
    }
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
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

// Billboard HP bars: two sprites, foreground anchored at its left edge so it shrinks from the right.
const barBg = new THREE.SpriteMaterial({ color: 0x1a0000, depthTest: false, depthWrite: false });
const barFg = new THREE.SpriteMaterial({ color: 0x44dd44, depthTest: false, depthWrite: false });
export function makeHpBar(width = 1.2) {
  const g = new THREE.Group();
  const bg = new THREE.Sprite(barBg);
  bg.scale.set(width, 0.12, 1);
  const fg = new THREE.Sprite(barFg);
  fg.center.set(0, 0.5);
  fg.position.x = -width / 2;
  fg.scale.set(width, 0.09, 1);
  bg.renderOrder = 10;
  fg.renderOrder = 11;
  g.add(bg, fg);
  g.userData = { fg, width };
  return g;
}
export function setHpBar(bar, ratio) {
  bar.userData.fg.scale.x = Math.max(0.001, bar.userData.width * Math.max(0, ratio));
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
export const makeCasing = () => new THREE.Mesh(casingGeo, M.brass);

const gibGeo = new THREE.SphereGeometry(0.13, 6, 5);
export const makeGib = (kind) => new THREE.Mesh(gibGeo, M[kind] || M.ichor);

const markerGeo = new THREE.RingGeometry(1.6, 2.2, 24);
export function makeSpawnMarker() {
  const m = new THREE.Mesh(markerGeo, M.marker);
  m.rotation.x = -Math.PI / 2;
  return m;
}
