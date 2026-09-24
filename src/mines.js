import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeBuildingMesh } from './entities.js';
import { uploadUsed, instancePool } from './instancing.js';

// Minefields, drawn like walls (walls.js): every field keeps its group (s.mesh) and its five mine frames for position,
// the silo and visibility, and the mines themselves are instances: one InstancedMesh per part of the mine model for the
// armed ones, one see-through "ghost" mesh for the spent ones. The countdown clock over a field that is laying a new
// set is instanced too, a camera-facing disc like the HP bars (hpbars.js). All of it is refreshed just before each
// render, from the groups and from the state game.js keeps on them: userData.spent (one flag per mine) and
// userData.reload (fraction of the reload still to run; 0 = no clock).
const FIELDS = 800, CAP = FIELDS * 5;
const CLOCK_SIZE = 1.3, CLOCK_Y = 1.45;                    // world units: disc diameter, height over the field
const fields = new Set();
let parts = null, ghost = null, clock = null;
const _m = new THREE.Matrix4(), _box = new THREE.Box3();

const shown = (o) => { for (; o; o = o.parent) if (!o.visible) return false; return true; };

// ---------------------------------------------------------------- countdown clock
// A clock face: the wedge of time still to run (it starts full and the hand eats it clockwise from twelve), hour ticks,
// a bright rim and the hand, all see-through.
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
    float disc = 1.0 - smoothstep(1.0 - aa, 1.0, r);
    if (disc <= 0.0) discard;
    float u = fract(atan(p.x, p.y) / 6.2831853 + 1.0);           // 0 at twelve o'clock, growing clockwise
    float done = 1.0 - vLeft;
    vec3 col = vec3(0.02, 0.05, 0.08);
    float a = 0.4;                                                 // the face
    float wedge = step(done, u) * (1.0 - smoothstep(0.8 - aa, 0.8, r));
    col = mix(col, vec3(0.25, 0.75, 1.0), wedge * 0.8);
    a = mix(a, 0.6, wedge);
    float rim = smoothstep(0.86 - aa, 0.86, r);
    col = mix(col, vec3(0.62, 0.9, 1.0), rim);
    a = mix(a, 0.85, rim);
    float arc = abs(fract(u * 12.0 + 0.5) - 0.5) / 12.0 * 6.2831853 * r;   // distance along the rim to the nearest hour
    float tick = (1.0 - smoothstep(0.02, 0.02 + aa, arc)) * step(0.64, r) * step(r, 0.8);
    col = mix(col, vec3(0.9, 0.97, 1.0), tick * 0.85);
    a = mix(a, 0.85, tick);
    vec2 d = vec2(sin(done * 6.2831853), cos(done * 6.2831853));
    float hand = 1.0 - smoothstep(0.05, 0.05 + aa, length(p - d * clamp(dot(p, d), 0.0, 0.76)));
    hand = max(hand, 1.0 - smoothstep(0.1, 0.1 + aa, r));        // and its hub
    col = mix(col, vec3(1.0), hand);
    a = mix(a, 0.95, hand);
    vec4 diffuseColor = vec4(col, a * disc * opacity);
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
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { size: { value: CLOCK_SIZE }, opacity: { value: 0.8 } }]),
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
