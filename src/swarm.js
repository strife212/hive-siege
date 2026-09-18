import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ENEMIES } from './config.js';

// Instanced bug renderer. Every bug of a species is one instance of a single merged geometry; the leg gait,
// mandible chomp, antenna twitch, body bob and death curl all run in the vertex shader from a per-vertex rig
// description (part id, pivots, axis, side, phase) and a per-instance animation vector. The CPU writes one
// matrix and a handful of floats per bug per frame, so thousands of bugs cost one draw call per species
// (plus one for shadows) instead of thirty meshes each.

const CAPACITY = 4096;
const PART = { BODY: 0, FEMUR: 1, TIBIA: 2, MANDIBLE: 3, ANTENNA: 4 };

// ---------------------------------------------------------------- rig construction (low-poly, then baked)
function tag(mesh, o) { mesh.userData.rig = o; return mesh; }
function m(geo, color, x = 0, y = 0, z = 0, emissive = 0x000000) {
  const mesh = new THREE.Mesh(geo);
  mesh.position.set(x, y, z);
  return tag(mesh, { part: PART.BODY, color, emissive, side: 1, phase: 0 });
}
const plateGeo = new THREE.SphereGeometry(1, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
function plate(color, x, y, z, sx, sy, sz, tilt = 0) {
  const p = m(plateGeo, color, x, y, z);
  p.scale.set(sx, sy, sz);
  p.rotation.x = tilt;
  return p;
}

function buildRig(def) {
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);
  const emitAccent = def.spikes ? 0x000000 : def.accent;

  const segs = [[-0.42, 0.55, 0.42, 1.0], [-0.85, 0.6, 0.35, 0.9], [-1.18, 0.67, 0.25, 0.85]];
  for (const [z, y, r, sq] of segs) {
    const seg = m(new THREE.SphereGeometry(r, 9, 6), def.color, 0, y, z);
    seg.scale.set(1, 0.8 * sq, 1.15);
    body.add(seg);
    body.add(plate(def.plate, 0, y + 0.02, z, r * 1.05, r * 0.85, r * 1.2));
  }
  if (def.spikes) {
    for (const [z, y, r] of segs) for (const sx of [-1, 1]) {
      const sp = m(new THREE.ConeGeometry(r * 0.22, r * 1.1, 4), def.accent, sx * r * 0.45, y + r * 0.75, z);
      sp.rotation.set(-0.5, 0, sx * 0.45);
      body.add(sp);
    }
  } else {
    for (const [z, y, r] of segs) for (const sx of [-1, 1]) {
      body.add(m(new THREE.SphereGeometry(r * 0.16, 5, 4), def.accent, sx * r * 0.85, y - r * 0.1, z, emitAccent));
    }
  }
  const thorax = m(new THREE.SphereGeometry(0.36, 9, 6), def.color, 0, 0.58, 0.05);
  thorax.scale.set(1, 0.85, 1.25);
  body.add(thorax);
  body.add(plate(def.plate, 0, 0.62, 0.02, 0.4, 0.34, 0.48));
  if (def.spikes) {
    const crest = m(new THREE.ConeGeometry(0.1, 0.5, 4), def.accent, 0, 0.98, -0.05);
    crest.rotation.x = -0.6;
    body.add(crest);
  }

  const head = new THREE.Group();
  head.position.set(0, 0.62, 0.52);
  body.add(head);
  const skull = m(new THREE.SphereGeometry(0.28, 9, 6), def.color);
  skull.scale.set(1, 0.9, 1.1);
  head.add(skull);
  head.add(plate(def.plate, 0, 0.04, -0.02, 0.3, 0.24, 0.32, 0.25));
  for (const sx of [-1, 1]) {
    head.add(m(new THREE.SphereGeometry(def.spikes ? 0.08 : 0.09, 6, 4), def.eye, sx * 0.17, 0.1, 0.2, def.eye));
    if (def.spikes) {
      const horn = m(new THREE.ConeGeometry(0.06, 0.45, 4), def.accent, sx * 0.2, 0.22, 0.05);
      horn.rotation.set(-0.8, 0, sx * 0.6);
      head.add(horn);
    }
  }
  for (const sx of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.14, -0.1, 0.2);
    pivot.rotation.y = 0.1;
    pivot.scale.x = sx;
    const arc = m(new THREE.TorusGeometry(0.17, 0.035, 4, 6, 2.0), def.spikes ? def.accent : def.legColor, -0.17, 0, 0);
    arc.rotation.x = Math.PI / 2;
    arc.userData.rig.part = PART.MANDIBLE;
    arc.userData.rig.side = sx;
    arc.userData.rig.pivot = pivot;
    pivot.add(arc);
    head.add(pivot);
  }
  for (const sx of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.1, 0.22, 0.1);
    pivot.rotation.set(-0.9, 0, -sx * 0.45);
    const a = m(new THREE.CylinderGeometry(0.012, 0.02, 0.55, 3), def.legColor, 0, 0.27, 0);
    a.userData.rig.part = PART.ANTENNA;
    a.userData.rig.side = sx;
    a.userData.rig.phase = sx > 0 ? 0 : 1.7;
    a.userData.rig.pivot = pivot;
    pivot.add(a);
    head.add(pivot);
  }

  const lr = def.legR;
  const femurGeo = new THREE.CylinderGeometry(0.03 * lr, 0.045 * lr, 0.5, 4);
  const tibiaGeo = new THREE.CylinderGeometry(0.012 * lr, 0.035 * lr, 0.8, 4);
  const hipZ = [0.32, 0.05, -0.22], hipYaw = [0.55, 0.0, -0.55];
  for (const side of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const hip = new THREE.Group();
      hip.position.set(side * 0.28, 0.5, hipZ[k]);
      hip.scale.x = side;
      hip.rotation.y = hipYaw[k];
      const femur = new THREE.Group();
      femur.rotation.z = 0.75;
      const fm = m(femurGeo, def.legColor, 0.25, 0, 0);
      fm.rotation.z = -Math.PI / 2;
      femur.add(fm);
      const knee = new THREE.Group();
      knee.position.x = 0.5;
      knee.rotation.z = -0.55;
      const kb = m(new THREE.SphereGeometry(0.045 * lr, 5, 4), def.plate);
      const tb = m(tibiaGeo, def.legColor, 0, -0.4, 0);
      knee.add(kb, tb);
      femur.add(knee);
      hip.add(femur);
      g.add(hip);
      const tripod = (k + (side > 0 ? 0 : 1)) % 2;
      const phase = tripod * Math.PI + (k - 1) * 0.25;
      Object.assign(fm.userData.rig, { part: PART.FEMUR, side, phase, hip });
      for (const t of [kb, tb]) Object.assign(t.userData.rig, { part: PART.TIBIA, side, phase, hip, knee });
    }
  }
  return g;
}

// Flatten the rig into one geometry with rig attributes, in the root's (unscaled) model space.
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
function bake(def) {
  const root = buildRig(def);
  root.updateMatrixWorld(true);
  const parts = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const r = o.userData.rig;
    const geo = o.geometry.clone();
    geo.deleteAttribute('uv');
    geo.applyMatrix4(o.matrixWorld);
    const n = geo.attributes.position.count;
    const col = new THREE.Color(r.color);
    const emitK = r.emissive ? 1.6 : 0;                 // emissive parts glow in their own colour
    const aColor = new Float32Array(n * 3), aRig = new Float32Array(n * 4);
    const aPivot = new Float32Array(n * 3), aPivot2 = new Float32Array(n * 3), aAxis = new Float32Array(n * 3);
    let pivot = _v.set(0, 0, 0).clone(), pivot2 = pivot.clone(), axis = new THREE.Vector3(0, 0, 1);
    if (r.part === PART.FEMUR || r.part === PART.TIBIA) {
      r.hip.matrixWorld.decompose(pivot, _q, _s);
      axis.set(0, 0, 1).applyQuaternion(_q).normalize();
      if (r.knee) r.knee.matrixWorld.decompose(pivot2, _q, _s);
    } else if (r.pivot) {
      r.pivot.matrixWorld.decompose(pivot, _q, _s);
    }
    for (let i = 0; i < n; i++) {
      aColor.set([col.r, col.g, col.b], i * 3);
      aRig.set([r.part, r.phase, r.side, emitK], i * 4);
      aPivot.set([pivot.x, pivot.y, pivot.z], i * 3);
      aPivot2.set([pivot2.x, pivot2.y, pivot2.z], i * 3);
      aAxis.set([axis.x, axis.y, axis.z], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(aColor, 3));
    geo.setAttribute('aRig', new THREE.BufferAttribute(aRig, 4));
    geo.setAttribute('aPivot', new THREE.BufferAttribute(aPivot, 3));
    geo.setAttribute('aPivot2', new THREE.BufferAttribute(aPivot2, 3));
    geo.setAttribute('aAxis', new THREE.BufferAttribute(aAxis, 3));
    parts.push(geo);
  });
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return merged;
}

// ---------------------------------------------------------------- shader injection
const RIG_GLSL = `
  attribute vec4 aRig;       // part, phase, side, emissive strength
  attribute vec3 aPivot; attribute vec3 aPivot2; attribute vec3 aAxis;
  #define aPart aRig.x
  #define aPhase aRig.y
  #define aSide aRig.z
  attribute vec4 iAnim;      // theta, amp (1 walking / 0.22 idle), chomp, dead
  attribute float iBurn;
  uniform float uTime;
  mat3 rotAxis(vec3 a, float ang) {
    float c = cos(ang), s = sin(ang), t = 1.0 - c;
    return mat3(c + t*a.x*a.x, t*a.x*a.y + s*a.z, t*a.x*a.z - s*a.y,
                t*a.x*a.y - s*a.z, c + t*a.y*a.y, t*a.y*a.z + s*a.x,
                t*a.x*a.z + s*a.y, t*a.y*a.z - s*a.x, c + t*a.z*a.z);
  }
  void bugAnim(out vec3 p, out mat3 r) {
    p = position; r = mat3(1.0);
    float theta = iAnim.x, amp = iAnim.y, chomp = iAnim.z, dead = iAnim.w;
    if (aPart < 0.5 || aPart > 2.5) {
      if (aPart > 2.5 && aPart < 3.5) {                       // mandible chomp
        mat3 rm = rotAxis(vec3(0.0, 1.0, 0.0), aSide * (0.55 * chomp * (1.0 - dead) + 0.5 * dead));
        p = rm * (p - aPivot) + aPivot; r = rm;
      } else if (aPart > 3.5) {                              // antenna twitch
        mat3 ra = rotAxis(vec3(1.0, 0.0, 0.0), 0.18 * sin(uTime * 5.0 + aPhase + theta * 0.05));
        p = ra * (p - aPivot) + aPivot; r = ra;
      }
      float bob = step(0.5, amp) * (1.0 - dead);             // body bob and roll while walking
      mat3 rb = rotAxis(vec3(0.0, 0.0, 1.0), 0.05 * sin(theta) * bob) * rotAxis(vec3(1.0, 0.0, 0.0), 0.02 * sin(theta * 2.0) * bob);
      p = rb * p; p.y += 0.035 * abs(sin(theta)) * bob; r = rb * r;
    } else {                                                 // legs: knee bend, femur lift, hip sweep
      float th = theta + aPhase;
      float lift = max(0.0, cos(th)) * amp;
      float yaw = 0.42 * sin(th) * amp * (1.0 - dead);
      float fem = mix(lift * 0.55, 0.9, dead) * aSide;
      float kne = mix(-lift * 0.75, -1.5, dead) * aSide;
      if (aPart > 1.5) { mat3 rk = rotAxis(aAxis, kne); p = rk * (p - aPivot2) + aPivot2; r = rk; }
      mat3 rf = rotAxis(aAxis, fem); p = rf * (p - aPivot) + aPivot; r = rf * r;
      mat3 ry = rotAxis(vec3(0.0, 1.0, 0.0), yaw); p = ry * (p - aPivot) + aPivot; r = ry * r;
    }
  }
`;

function injectRig(shader, withNormals) {
  shader.uniforms.uTime = uTime;
  if (!withNormals) {                                   // shadow depth pass: geometry only
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
${RIG_GLSL}`)
      .replace('#include <begin_vertex>', `vec3 bugP; mat3 bugR; bugAnim(bugP, bugR); vec3 transformed = bugP;`);
    return;
  }
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
${RIG_GLSL}
varying vec3 vEmissive; varying float vBurn;`)
    .replace('#include <begin_vertex>', `vec3 bugP; mat3 bugR; bugAnim(bugP, bugR); vec3 transformed = bugP; vEmissive = color * aRig.w; vBurn = iBurn;`)
    .replace('#include <beginnormal_vertex>', `vec3 bugP0; mat3 bugR0; bugAnim(bugP0, bugR0); vec3 objectNormal = bugR0 * vec3(normal);`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
varying vec3 vEmissive; varying float vBurn;`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += vEmissive + vec3(1.0, 0.32, 0.04) * vBurn * 0.9;`);
}
const uTime = { value: 0 };

// ---------------------------------------------------------------- HP bars (one instanced mesh for all bugs)
function makeBarMesh() {
  const quad = (layer) => {
    const g = new THREE.PlaneGeometry(1, 1);
    const n = g.attributes.position.count;
    g.setAttribute('aLayer', new THREE.BufferAttribute(new Float32Array(n).fill(layer), 1));
    return g;
  };
  const base = mergeGeometries([quad(0), quad(1)], false);
  const geo = new THREE.InstancedBufferGeometry().copy(base);
  geo.instanceCount = 0;
  const iBar = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 2 * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const iHp = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 2), 1).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iBar', iBar);
  geo.setAttribute('iHp', iHp);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false,
    vertexShader: `
      attribute float aLayer; attribute vec4 iBar; attribute float iHp;
      varying vec3 vColor; varying float vAlpha;
      void main() {
        float w = iBar.w;
        float h = aLayer > 0.5 ? 0.09 : 0.13;
        float fx = aLayer > 0.5 ? (-0.5 * w + (position.x + 0.5) * w * iHp) : position.x * w;
        vec4 mv = viewMatrix * vec4(iBar.xyz, 1.0);
        mv.xy += vec2(fx, position.y * h + (aLayer > 0.5 ? 0.0 : 0.0));
        gl_Position = projectionMatrix * mv;
        vColor = aLayer > 0.5 ? mix(vec3(0.9, 0.15, 0.1), vec3(0.25, 0.9, 0.3), iHp) : vec3(0.08, 0.0, 0.0);
        vAlpha = aLayer > 0.5 ? 1.0 : 0.85;
      }`,
    fragmentShader: `varying vec3 vColor; varying float vAlpha; void main() { gl_FragColor = vec4(vColor, vAlpha); }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  mesh.userData = { iBar, iHp };
  return mesh;
}

// ---------------------------------------------------------------- public
const species = {};
let scene = null, bars = null;
const _pos = new THREE.Vector3(), _qy = new THREE.Quaternion(), _qr = new THREE.Quaternion(), _sc = new THREE.Vector3(), _m = new THREE.Matrix4();
const Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);

export const swarm = {
  init(s) {
    scene = s;
    for (const [key, def] of Object.entries(ENEMIES)) {
      const geo = bake(def);
      const iAnim = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 4), 4).setUsage(THREE.DynamicDrawUsage);
      const iBurn = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY), 1).setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('iAnim', iAnim);
      geo.setAttribute('iBurn', iBurn);
      const mat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.12, clearcoat: 0.6, clearcoatRoughness: 0.3 });
      mat.onBeforeCompile = (sh) => injectRig(sh, true);
      mat.customProgramCacheKey = () => 'bug-rig';
      const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
      depth.onBeforeCompile = (sh) => injectRig(sh, false);
      depth.customProgramCacheKey = () => 'bug-rig-depth';
      const mesh = new THREE.InstancedMesh(geo, mat, CAPACITY);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.customDepthMaterial = depth;
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      mesh.count = 0;
      scene.add(mesh);
      species[key] = { mesh, iAnim, iBurn, n: 0, verts: geo.attributes.position.count };
    }
    bars = makeBarMesh();
    scene.add(bars);
  },

  // Writes every live bug and corpse into the instance buffers. Called once per frame after the simulation.
  update(enemies, corpses, time, heightAt) {
    uTime.value = time;
    for (const sp of Object.values(species)) sp.n = 0;
    let nb = 0;
    const { iBar, iHp } = bars.userData;
    const write = (e, dead) => {
      const sp = species[e.type];
      if (!sp || sp.n >= CAPACITY) return;
      const k = sp.n++;
      const sc = e.def.scale;
      const y = heightAt(e.x, e.z);
      const fl = Math.hypot(e.fx, e.fz) || 1;
      let px = e.x, py = y, pz = e.z, roll = 0;
      if (dead) {
        const flip = 1 - Math.pow(1 - Math.min(1, e.deadT / 0.35), 3);
        const sink = Math.max(0, (e.deadT - 0.8) / 0.7);
        py = y + 0.55 * sc * flip - 1.4 * sc * sink * sink;
        roll = Math.PI * flip;
      } else {
        const lunge = e.lunge * 0.35 * sc;
        const emergeUp = 1 - Math.pow(1 - e.emerge, 3);
        px += e.fx / fl * lunge; pz += e.fz / fl * lunge;
        py = y - 1.3 * sc * (1 - emergeUp);
      }
      _qy.setFromAxisAngle(Y, Math.atan2(e.fx, e.fz));
      if (roll) { _qr.setFromAxisAngle(Z, roll); _qy.multiply(_qr); }
      _m.compose(_pos.set(px, py, pz), _qy, _sc.set(sc, sc, sc));
      sp.mesh.setMatrixAt(k, _m);
      const moving = !dead && !e.target && e.emerge >= 1;
      const theta = moving ? e.walk * (4.5 / sc) + e.phase : time * 3 + e.phase;
      const deadAmt = dead ? Math.min(1, e.deadT / 0.35) : 0;
      sp.iAnim.setXYZW(k, theta, moving ? 1 : 0.22, Math.sin(Math.min(1, e.lunge) * Math.PI), deadAmt);
      sp.iBurn.setX(k, e.burn ? 1 : 0);
      if (!dead && e.hp < e.maxHp && nb < CAPACITY * 2) {
        iBar.setXYZW(nb, e.x, y + 1.35 * sc, e.z, 1.0 * sc);
        iHp.setX(nb, Math.max(0, e.hp / e.maxHp));
        nb++;
      }
    };
    for (let i = 0; i < enemies.length; i++) if (!enemies[i].dead) write(enemies[i], false);
    for (let i = 0; i < corpses.length; i++) write(corpses[i], true);
    const total = enemies.length + corpses.length;
    for (const sp of Object.values(species)) {
      sp.mesh.count = sp.n;
      sp.mesh.instanceMatrix.needsUpdate = true;
      sp.iAnim.needsUpdate = true;
      sp.iBurn.needsUpdate = true;
      sp.mesh.castShadow = total < 900;          // shadows for a horde cost a second full pass
    }
    bars.geometry.instanceCount = nb;
    iBar.needsUpdate = true;
    iHp.needsUpdate = true;
  },

  stats() { return Object.fromEntries(Object.entries(species).map(([k, s]) => [k, { count: s.n, vertsPerBug: s.verts }])); },
};
