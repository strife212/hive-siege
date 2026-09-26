import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeBuildingMesh } from './entities.js';
import { uploadUsed, instancePool } from './instancing.js';
import { puff } from './particles.js';
import { audio } from './audio.js';
import { state, burst } from './game.js';

// Minefields, drawn like walls (walls.js): every field keeps its group (s.mesh) and its five mine frames for position,
// the silo and visibility, and the mines themselves are instances: one InstancedMesh per part of the mine model for the
// armed ones, one see-through "ghost" mesh for the spent ones. The countdown clock over a field that is laying a new
// set is instanced too, a camera-facing disc like the HP bars (hpbars.js). All of it is refreshed just before each
// render, from the groups and from the state game.js keeps on them: userData.spent (one flag per mine) and
// userData.reload (fraction of the reload still to run; 0 = no clock).
const FIELDS = 800, CAP = FIELDS * 5;
const CLOCK_SIZE = 0.85, CLOCK_Y = 1.15;                    // world units: disc diameter, height over the field
const fields = new Set();
let parts = null, ghost = null, clock = null;
const _m = new THREE.Matrix4(), _box = new THREE.Box3();

const shown = (o) => { for (; o; o = o.parent) if (!o.visible) return false; return true; };

// ---------------------------------------------------------------- countdown clock
// Just the time still to run: a see-through grey disc that the passing time eats away clockwise from twelve.
const clockVertex = `
  attribute vec3 iPos;       // clock centre, world space
  attribute float iLeft;     // fraction of the time still to run
  uniform float size;
  varying vec2 vUv;
  varying float vLeft;
  #include <common>
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vLeft = iLeft;
    vec4 mvPosition = viewMatrix * vec4(iPos, 1.0);
    mvPosition.xy += position.xy * size;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;
const clockFragment = `
  uniform float opacity;
  varying vec2 vUv;
  varying float vLeft;
  #include <common>
  #include <fog_pars_fragment>
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    float aa = fwidth(r) * 1.5;
    float u = fract(atan(p.x, p.y) / 6.2831853 + 1.0);           // 0 at twelve o'clock, growing clockwise
    float done = 1.0 - vLeft;
    float left = done <= 0.0 ? 1.0 : smoothstep(-aa, aa, (u - done) * 6.2831853 * r);   // soft along the moving edge
    float a = (1.0 - smoothstep(1.0 - aa, 1.0, r)) * left;
    if (a <= 0.0) discard;
    vec4 diffuseColor = vec4(vec3(0.6, 0.62, 0.65), a * opacity);
    vec3 outgoingLight = diffuseColor.rgb;
    #include <opaque_fragment>
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }`;

function makeClocks(scene) {
  const geo = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1, 1));
  geo.instanceCount = 0;
  const iPos = new THREE.InstancedBufferAttribute(new Float32Array(FIELDS * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const iLeft = new THREE.InstancedBufferAttribute(new Float32Array(FIELDS), 1).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iPos', iPos);
  geo.setAttribute('iLeft', iLeft);
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { size: { value: CLOCK_SIZE }, opacity: { value: 0.4 } }]),
    vertexShader: clockVertex, fragmentShader: clockFragment, fog: true, transparent: true, depthTest: false, depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 19;                                   // under the HP bars
  scene.add(mesh);
  return { mesh, iPos, iLeft };
}

// ---------------------------------------------------------------- per-frame refresh
function sync() {
  let np = 0, ng = 0, nc = 0;
  for (const g of fields) {
    if (!g.parent) { fields.delete(g); continue; }         // sold or destroyed: out of the scene
    if (!shown(g)) continue;                               // locked down in its silo
    const { mines, spent, reload } = g.userData;
    for (let k = 0; k < mines.length; k++) {
      if (!mines[k].visible) continue;                     // not fired yet (orbital drop)
      const f = mines[k].matrixWorld;
      if (spent[k]) { if (ng < CAP) ghost.setMatrixAt(ng++, f); continue; }
      if (np >= CAP) continue;
      for (const p of parts) p.im.setMatrixAt(np, _m.multiplyMatrices(f, p.local));
      np++;
    }
    if (reload > 0 && nc < FIELDS) {
      const e = g.matrixWorld.elements;
      clock.iPos.setXYZ(nc, e[12], e[13] + CLOCK_Y, e[14]);
      clock.iLeft.setX(nc, reload);
      nc++;
    }
  }
  for (const { im } of parts) { im.count = np; uploadUsed(im.instanceMatrix, np); }
  ghost.count = ng;
  uploadUsed(ghost.instanceMatrix, ng);
  clock.mesh.geometry.instanceCount = nc;
  uploadUsed(clock.iPos, nc);
  uploadUsed(clock.iLeft, nc);
}

// ---------------------------------------------------------------- orbital drop
// A field is not built: its mines are fired down from orbit one after another, each a glowing streak trailing smoke
// along the line it comes in on, and slam into the ground in a spray of dirt. The field arms once the last is down.
const DROP_H = 55, FALL = 0.5, GAP = 0.13, STREAK = 7, FADE = 0.3;
const DROP_DIR = new THREE.Vector3(0.3, 1, -0.2).normalize();     // where they come in from
const streakGeo = new THREE.CylinderGeometry(0.02, 0.13, 1, 8, 1, true).translate(0, 0.5, 0);   // widest at the mine
const headGeo = new THREE.SphereGeometry(0.34, 12, 8);                                               // re-entry glow round the mine
const glowMat = new THREE.MeshBasicMaterial({ color: 0xffc27a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
const _up = new THREE.Vector3(0, 1, 0);

export function dropField(s) {
  const mines = s.mesh.userData.mines;
  s.landing = {
    t: 0,
    rest: mines.map((m) => m.position.clone()),           // where each one comes to rest (on the ground under it)
    streaks: mines.map(() => null), smoke: mines.map(() => 0), down: mines.map(() => false), fade: mines.map(() => 0),
  };
  for (const m of mines) m.visible = false;
  audio.play('artillery_whistle', { x: s.x, z: s.z, vol: 0.3 });
}

// Per frame while a field is landing. Returns true until every mine is down and its streak has faded.
export function updateDrop(s, dt) {
  const L = s.landing, mines = s.mesh.userData.mines;
  L.t += dt;
  let busy = false;
  mines.forEach((m, k) => {
    const u = (L.t - k * GAP) / FALL;
    if (u < 0) { busy = true; return; }
    const rest = L.rest[k], wx = s.x + rest.x, wz = s.z + rest.z;
    if (!L.down[k]) {
      m.visible = true;
      m.position.copy(rest).addScaledVector(DROP_DIR, DROP_H * Math.max(0, 1 - u));
      if (!L.streaks[k]) {
        const st = new THREE.Group(), mat = glowMat.clone();
        const tail = new THREE.Mesh(streakGeo, mat);
        tail.quaternion.setFromUnitVectors(_up, DROP_DIR);
        tail.scale.set(1, STREAK, 1);
        st.add(tail, new THREE.Mesh(headGeo, mat));
        st.renderOrder = 5;
        st.userData.mat = mat;
        state.scene.add(st);
        L.streaks[k] = st;
      }
      const y = s.baseY + m.position.y;
      L.streaks[k].position.set(s.x + m.position.x, y + 0.08, s.z + m.position.z);
      if ((L.smoke[k] -= dt) <= 0) {                        // a smoke trail hanging along its path
        L.smoke[k] = 0.06;
        puff(s.x + m.position.x, y + 0.3, s.z + m.position.z, { color: 0x6a625a, size: 0.5, grow: 1.2, life: 0.9, opacity: 0.35 });
      }
      if (u >= 1) {                                         // impact
        L.down[k] = true;
        m.position.copy(rest);
        const gy = s.baseY + rest.y;
        burst(wx, gy + 0.2, wz, 'soil', 6, 4);
        puff(wx, gy + 0.2, wz, { color: 0xfff0c8, size: 1.4, life: 0.12, opacity: 0.9, additive: true });
        for (let n = 0; n < 3; n++) {
          const a = Math.random() * 6.283;
          puff(wx, gy + 0.25, wz, { color: 0x9a7a55, size: 0.7, grow: 1.4, life: 0.8, opacity: 0.45, vx: Math.cos(a) * 1.6, vz: Math.sin(a) * 1.6, vy: 0.6, drag: 2.5 });
        }
        audio.play('blast_door', { x: wx, z: wz, vol: 0.2 });
        state.shake += 0.015;
      }
      busy = true;
      return;
    }
    const st = L.streaks[k];                                 // down: its streak fades where it came in
    if (!st) return;
    L.fade[k] += dt;
    st.userData.mat.opacity = 0.9 * Math.max(0, 1 - L.fade[k] / FADE);
    st.children[1].scale.setScalar(1 + 2 * L.fade[k] / FADE);   // the glow flares out as it dies
    if (L.fade[k] >= FADE) { endStreak(L, k); return; }
    busy = true;
  });
  if (!busy) s.landing = null;
  return busy;
}

function endStreak(L, k) {
  const st = L.streaks[k];
  if (!st) return;
  state.scene.remove(st);
  st.userData.mat.dispose();
  L.streaks[k] = null;
}
// A field removed mid-drop: take its streaks away with it.
export function clearDrop(s) {
  if (!s.landing) return;
  s.landing.streaks.forEach((_, k) => endStreak(s.landing, k));
  s.landing = null;
}

export const mineBatch = {
  init(scene) {
    const t = makeBuildingMesh('mine');
    t.updateMatrixWorld(true);
    const frame = t.userData.mines[0];
    const meshes = frame.children.filter((o) => o.isMesh);
    parts = meshes.map((o) => {
      const im = instancePool(o.geometry, o.material, CAP);
      im.castShadow = o.castShadow;
      im.receiveShadow = o.receiveShadow;
      scene.add(im);
      return { im, local: o.matrix.clone() };             // the part's placement in its mine
    });
    // The spent mine: the whole mine as one see-through shape, like the placement ghost but pale.
    const shape = mergeGeometries(meshes.map((o) => {
      const src = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', src.attributes.position.clone());
      return geo.applyMatrix4(o.matrix);
    }), false);
    ghost = instancePool(shape, new THREE.MeshBasicMaterial({ color: 0x9fdcff, transparent: true, opacity: 0.16, depthWrite: false }), CAP);
    scene.add(ghost);
    clock = makeClocks(scene);
    const prev = scene.onBeforeRender;
    scene.onBeforeRender = function (...a) { prev.apply(this, a); sync(); };
  },
  // A placed field: hand its drawing over to the instances. Its height is kept for the silo (retract.js).
  add(g) {
    g.updateMatrixWorld(true);
    g.userData.stowHeight = _box.setFromObject(g).max.y - g.position.y;
    for (const f of g.userData.mines) for (const c of [...f.children]) if (c.isMesh) f.remove(c);
    g.userData.spent = g.userData.mines.map(() => false);
    g.userData.reload = 0;
    fields.add(g);
  },
};
