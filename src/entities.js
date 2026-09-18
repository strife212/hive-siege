import * as THREE from 'three';

// Shared materials
const M = {
  metal: new THREE.MeshStandardMaterial({ color: 0x8d949c, roughness: 0.6, metalness: 0.5 }),
  dark:  new THREE.MeshStandardMaterial({ color: 0x3a3f48, roughness: 0.7, metalness: 0.4 }),
  amber: new THREE.MeshStandardMaterial({ color: 0xd9a441, roughness: 0.5, metalness: 0.3 }),
  cyan:  new THREE.MeshStandardMaterial({ color: 0x4fd1ff, emissive: 0x2aa8dd, emissiveIntensity: 1.2, roughness: 0.2 }),
  green: new THREE.MeshStandardMaterial({ color: 0x5f8f5a, roughness: 0.7, metalness: 0.2 }),
  blue:  new THREE.MeshStandardMaterial({ color: 0x6f7fff, emissive: 0x2233aa, emissiveIntensity: 0.8, roughness: 0.3 }),
  core:  new THREE.MeshStandardMaterial({ color: 0xffb347, emissive: 0xff7a00, emissiveIntensity: 1.5 }),
  ghostOk:  new THREE.MeshBasicMaterial({ color: 0x4fff7a, transparent: true, opacity: 0.45, depthWrite: false }),
  ghostBad: new THREE.MeshBasicMaterial({ color: 0xff4040, transparent: true, opacity: 0.45, depthWrite: false }),
  shell: new THREE.MeshBasicMaterial({ color: 0xffd76a }),
  beam:  new THREE.MeshBasicMaterial({ color: 0x7fe6ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
  ichor: new THREE.MeshBasicMaterial({ color: 0x8fe33a }),
  debris: new THREE.MeshBasicMaterial({ color: 0x777777 }),
  marker: new THREE.MeshBasicMaterial({ color: 0xff3a3a, transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
};

function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

export function makeBuildingMesh(type) {
  const g = new THREE.Group();
  switch (type) {
    case 'wall': {
      g.add(mesh(new THREE.BoxGeometry(1.9, 1.5, 1.9), M.metal, 0, 0.75, 0));
      g.add(mesh(new THREE.BoxGeometry(2.0, 0.25, 2.0), M.dark, 0, 1.6, 0));
      break;
    }
    case 'turret': {
      g.add(mesh(new THREE.CylinderGeometry(0.9, 1.0, 0.5, 12), M.dark, 0, 0.25, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.4, 0.5, 0.6, 8), M.metal, 0, 0.8, 0));
      const head = new THREE.Group();
      head.position.y = 1.2;
      head.add(mesh(new THREE.BoxGeometry(0.9, 0.55, 1.1), M.amber));
      const barrel = mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.3, 8), M.dark, 0, 0.05, 0.9);
      barrel.rotation.x = Math.PI / 2;
      head.add(barrel);
      const muzzle = new THREE.Object3D();
      muzzle.position.set(0, 0.05, 1.55);
      head.add(muzzle);
      g.add(head);
      g.userData.head = head;
      g.userData.muzzle = muzzle;
      break;
    }
    case 'laser': {
      g.add(mesh(new THREE.CylinderGeometry(0.8, 0.9, 0.4, 8), M.dark, 0, 0.2, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.3, 0.4, 2.2, 8), M.metal, 0, 1.5, 0));
      const ring = mesh(new THREE.TorusGeometry(0.5, 0.06, 8, 24), M.cyan, 0, 2.5, 0);
      ring.rotation.x = Math.PI / 2;
      g.add(ring);
      const crystal = mesh(new THREE.OctahedronGeometry(0.45), M.cyan, 0, 3.0, 0);
      g.add(crystal);
      g.userData.muzzle = crystal;
      g.userData.spin = crystal;
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
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        g.add(mesh(new THREE.BoxGeometry(0.3, 2.6, 0.3), M.metal, sx * 1.6, 1.3, sz * 1.6));
      }
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

// Procedural insectoid: abdomen, thorax, head, mandibles, six animated legs. Faces +Z.
export function makeBugMesh(def) {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.45, metalness: 0.15 });
  const legMat = new THREE.MeshStandardMaterial({ color: def.legColor, roughness: 0.7 });
  const eye = new THREE.MeshStandardMaterial({ color: 0xff3020, emissive: 0xff2010, emissiveIntensity: 2 });

  const abdomen = mesh(new THREE.SphereGeometry(0.5, 12, 10), body, 0, 0.5, -0.55);
  abdomen.scale.set(1, 0.8, 1.4);
  g.add(abdomen);
  g.add(mesh(new THREE.SphereGeometry(0.35, 10, 8), body, 0, 0.55, 0.1));
  g.add(mesh(new THREE.SphereGeometry(0.28, 10, 8), body, 0, 0.6, 0.55));
  for (const s of [-1, 1]) {
    g.add(mesh(new THREE.SphereGeometry(0.07, 6, 5), eye, s * 0.14, 0.7, 0.76));
    const mand = mesh(new THREE.ConeGeometry(0.06, 0.45, 5), legMat, s * 0.16, 0.48, 0.9);
    mand.rotation.x = Math.PI / 2;
    mand.rotation.z = -s * 0.35;
    g.add(mand);
  }
  const legs = [];
  for (const s of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const pivot = new THREE.Group();
      pivot.position.set(s * 0.3, 0.5, 0.35 - k * 0.35);
      const leg = mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.9, 5), legMat, s * 0.4, -0.05, 0);
      leg.rotation.z = s * 1.0;
      pivot.add(leg);
      g.add(pivot);
      legs.push({ pivot, phase: (k + (s > 0 ? 0 : 1.5)) * 1.1 });
    }
  }
  g.userData.legs = legs;
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
export function makeBeam(from, to) {
  const m = new THREE.Mesh(beamGeo, M.beam);
  _dir.subVectors(to, from);
  const len = _dir.length();
  m.position.copy(from).addScaledVector(_dir, 0.5);
  m.quaternion.setFromUnitVectors(_up, _dir.normalize());
  m.scale.set(1, len, 1);
  return m;
}

const gibGeo = new THREE.SphereGeometry(0.13, 6, 5);
export const makeGib = (kind) => new THREE.Mesh(gibGeo, kind === 'debris' ? M.debris : M.ichor);

const markerGeo = new THREE.RingGeometry(1.6, 2.2, 24);
export function makeSpawnMarker() {
  const m = new THREE.Mesh(markerGeo, M.marker);
  m.rotation.x = -Math.PI / 2;
  return m;
}
