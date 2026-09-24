import * as THREE from 'three';
import { heightAt } from './terrain.js';
import { puff } from './particles.js';
import { uploadUsed as upload } from './instancing.js';

// Death gore: a bug bursts into rigid chunks (head, three abdomen segments, six legs) that fly out, tumble,
// bounce and skid on the terrain, then settle and sink away. Chunks are instanced per chunk type with a
// per-instance colour, so a horde dying at once stays cheap. Oldest chunks are recycled when the pool fills.
const CAP = 3000;
const MAX_LIVE = 4800;                 // 6 of every 10 chunks are legs, keeps them inside CAP
const LIFE = 4.5, SINK_AT = 3.4;
const kinds = {};
const live = [];
let scene = null;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _dq = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
const rnd = (a, b) => a + Math.random() * (b - a);

function makeKind(name, geo) {
  const mat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.1, clearcoat: 0.5, clearcoatRoughness: 0.35 });
  const mesh = new THREE.InstancedMesh(geo, mat, CAP);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3);
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.count = 0;
  scene.add(mesh);
  kinds[name] = { mesh, n: 0 };
}

function legGeometry() {
  const femur = new THREE.CylinderGeometry(0.03, 0.045, 0.5, 4);
  femur.rotateZ(-Math.PI / 2); femur.translate(0.25, 0, 0);
  const knee = new THREE.SphereGeometry(0.05, 5, 4);
  knee.translate(0.5, 0, 0);
  const tibia = new THREE.CylinderGeometry(0.012, 0.035, 0.8, 4);
  tibia.rotateZ(0.55); tibia.translate(0.5 + 0.21, -0.32, 0);
  const g = new THREE.BufferGeometry();
  const parts = [femur, knee, tibia];
  let pos = [], nor = [], idx = [], off = 0;
  for (const p of parts) {
    pos.push(...p.attributes.position.array); nor.push(...p.attributes.normal.array);
    for (const i of p.index.array) idx.push(i + off);
    off += p.attributes.position.count;
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  g.translate(-0.35, 0.1, 0);
  return g;
}

export const gore = {
  init(s) {
    scene = s;
    const head = new THREE.SphereGeometry(0.28, 9, 6); head.scale(1, 0.9, 1.1);
    const seg = new THREE.SphereGeometry(0.4, 9, 6); seg.scale(1, 0.8, 1.15);
    makeKind('head', head);
    makeKind('seg', seg);
    makeKind('leg', legGeometry());
  },

  // Blow a bug apart at its current position, flinging chunks away from an impulse origin (or randomly).
  spawnDeath(e) {
    if (live.length >= MAX_LIVE) live.splice(0, MAX_LIVE >> 3);          // evict the oldest eighth in one go
    const sc = e.def.scale, y = heightAt(e.x, e.z) + (e.held ? e.held.lift : 0);
    const fl = Math.hypot(e.fx, e.fz) || 1, fx = e.fx / fl, fz = e.fz / fl;
    const body = e.def.color, leg = e.def.legColor;
    const add = (kind, ox, oy, oz, size, color, spinK) => {
      const wx = e.x + (fx * oz - fz * ox) * sc, wz = e.z + (fz * oz + fx * ox) * sc;
      const a = Math.atan2(wz - e.z, wx - e.x) + rnd(-0.5, 0.5), sp = rnd(2.5, 7) * Math.sqrt(sc);
      const ch = {
        kind, color, size: size * sc, t: 0, settled: false,
        x: wx, y: y + oy * sc + 0.2, z: wz,
        vx: Math.cos(a) * sp, vy: rnd(3.5, 8.5) * Math.sqrt(sc), vz: Math.sin(a) * sp,
        wx: rnd(-1, 1) * spinK, wy: rnd(-1, 1) * spinK, wz: rnd(-1, 1) * spinK,
        q: new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd(0, 6.3), rnd(0, 6.3), rnd(0, 6.3))),
      };
      live.push(ch);
    };
    add('head', 0, 0.6, 0.55, 1, body, 14);
    for (const [oz, oy, r] of [[-0.42, 0.55, 1.0], [-0.85, 0.6, 0.85], [-1.18, 0.67, 0.65]]) add('seg', 0, oy, oz, r, body, 10);
    for (const side of [-1, 1]) for (const oz of [0.32, 0.05, -0.22]) add('leg', side * 0.3, 0.5, oz, 1, leg, 18);
    // ichor spray and a wet pop
    for (let k = 0; k < 6; k++) {
      const a = rnd(0, 6.3), sp = rnd(2, 6) * sc;
      puff(e.x, y + 0.5 * sc, e.z, { color: 0x8fe33a, size: 0.35 * sc, life: rnd(0.35, 0.7), opacity: 0.9, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: rnd(2, 6), grav: 18, drag: 0.6 });
    }
    puff(e.x, y + 0.5 * sc, e.z, { color: 0xc8ff70, size: 1.6 * sc, grow: 3, life: 0.18, opacity: 0.7, additive: true });
    if (e.def.cannon) {                                                  // the acid sac ruptures too
      const bx = e.x - fx * 0.72 * sc, bz = e.z - fz * 0.72 * sc, by = y + 1.0 * sc;
      puff(bx, by, bz, { color: 0xd4ff7a, size: 2.2 * sc, grow: 4, life: 0.25, opacity: 0.8, additive: true });
      for (let k = 0; k < 10; k++) {
        const a = rnd(0, 6.3), sp = rnd(2, 5) * sc;
        puff(bx, by, bz, { color: 0xa6ff2e, size: rnd(0.2, 0.4) * sc, life: rnd(0.4, 0.8), opacity: 0.9, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: rnd(3, 7), grav: 18, drag: 0.6 });
      }
      for (let k = 0; k < 3; k++) puff(bx + rnd(-0.5, 0.5), by, bz + rnd(-0.5, 0.5), { color: 0x94b85a, color2: 0x4a5040, size: 0.8 * sc, grow: 1.5, life: 1.4, opacity: 0.35, fadeIn: 0.15, vy: 1, drag: 1 });
    }
  },

  update(dt) {
    for (const k of Object.values(kinds)) k.n = 0;
    let alive = 0;
    for (let i = 0; i < live.length; i++) {
      const c = live[i];
      c.t += dt;
      if (c.t >= LIFE) continue;
      live[alive++] = c;
      if (!c.settled) {
        c.vy -= 22 * dt;
        c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt;
        _dq.set(c.wx * dt * 0.5, c.wy * dt * 0.5, c.wz * dt * 0.5, 1).normalize();
        c.q.premultiply(_dq);
        const ground = heightAt(c.x, c.z) + 0.12 * c.size;
        if (c.y <= ground) {
          c.y = ground;
          if (c.vy < -1.2) {                                   // bounce
            c.vy = -c.vy * 0.35; c.vx *= 0.55; c.vz *= 0.55; c.wx *= 0.5; c.wy *= 0.5; c.wz *= 0.5;
            if (c.kind !== 'leg' && Math.random() < 0.5) puff(c.x, c.y, c.z, { color: 0x8fe33a, size: 0.3 * c.size, life: 0.3, opacity: 0.7, vy: 1.5, grav: 10 });
          } else {                                             // skid
            c.vy = 0;
            const f = Math.exp(-7 * dt);
            c.vx *= f; c.vz *= f; c.wx *= Math.exp(-10 * dt); c.wy *= f; c.wz *= Math.exp(-10 * dt);
            if (c.vx * c.vx + c.vz * c.vz < 0.01) { c.settled = true; c.vx = c.vz = 0; }
          }
        }
      }
      const sink = c.t > SINK_AT ? (c.t - SINK_AT) / (LIFE - SINK_AT) : 0;
      const kind = kinds[c.kind];
      if (kind.n >= CAP) continue;
      const n = kind.n++;
      _m.compose(_p.set(c.x, c.y - 0.5 * c.size * sink * sink, c.z), c.q, _s.setScalar(c.size));
      kind.mesh.setMatrixAt(n, _m);
      kind.mesh.setColorAt(n, _c.setHex(c.color));
    }
    live.length = alive;
    for (const k of Object.values(kinds)) {
      k.mesh.count = k.n;
      upload(k.mesh.instanceMatrix, k.n);
      upload(k.mesh.instanceColor, k.n);
    }
  },
  count: () => live.length,
};
