import * as THREE from 'three';
import { glowTexture } from './entities.js';
import { uploadUsed } from './instancing.js';

// Shared particle system (dust, smoke, fire, sparks, glows). Every particle is a camera-facing soft disc drawn exactly as
// a THREE.Sprite would be (same texture, tint, opacity and rotation), but all of them are one instanced draw call. They
// were a sprite and a material each, and a big strike put hundreds of draw calls on the CPU.
//
// Normal and additive particles share the batch through premultiplied blending (ONE, ONE_MINUS_SRC_ALPHA): a normal
// one writes (rgb * a, a), which blends as SRC_ALPHA / ONE_MINUS_SRC_ALPHA did, and an additive one (rgb * a, 0), which
// blends as SRC_ALPHA / ONE did. So they stay sorted back to front together every frame, the way the separate sprites
// were. The batch sits where the sprites sat in the transparent pass: before anything with a render order above 0
// (decals, flames, rain, bug holes), and after the other order-0 effects (fireballs, beams) rather than interleaved
// with them by distance, since a batch has no single distance of its own.
//
// puff() still returns a handle for the few effects that steer a particle themselves (a lance's glow following its
// beam): it has the sprite's position, scale and material.opacity / .color, and killPuff() ends it.
const particles = [];
const MAX_PARTICLES = 1400;
let scene = null, camera = null, batch = null;
const _c = new THREE.Color(), _fwd = new THREE.Vector3();

const vertexShader = `
  attribute vec3 iPos;       // centre, world space
  attribute vec4 iSRO;       // size (world units), rotation, opacity, additive (0 / 1)
  attribute vec3 iColor;
  varying vec2 vUv;
  varying vec4 vColor;
  varying float vAdd;
  #include <common>
  void main() {
    vUv = uv;
    vColor = vec4(iColor, iSRO.z);
    vAdd = iSRO.w;
    vec4 mvPosition = viewMatrix * vec4(iPos, 1.0);
    vec2 p = position.xy * iSRO.x;
    float c = cos(iSRO.y), s = sin(iSRO.y);
    mvPosition.xy += vec2(c * p.x - s * p.y, s * p.x + c * p.y);
    gl_Position = projectionMatrix * mvPosition;
  }`;
const fragmentShader = `
  uniform sampler2D map;
  varying vec2 vUv;
  varying vec4 vColor;
  varying float vAdd;
  #include <common>
  void main() {
    vec4 diffuseColor = vColor * texture2D(map, vUv);
    vec3 outgoingLight = diffuseColor.rgb;
    #include <opaque_fragment>
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    gl_FragColor.rgb *= gl_FragColor.a;                  // premultiplied last, as the blender used to do it
    if (vAdd > 0.5) gl_FragColor.a = 0.0;               // additive: covers nothing of what is behind
  }`;

// The instanced batch; its buffers grow if a burst ever outruns them.
function makeBatch() {
  const geo = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1, 1));
  geo.instanceCount = 0;
  const mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: glowTexture() } }, vertexShader, fragmentShader,
    transparent: true, depthWrite: false, fog: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 0.5;
  const b = { mesh, geo, cap: 0, list: [] };
  grow(b, 2048);
  return b;
}
function grow(b, cap) {
  b.cap = cap;
  for (const [name, n] of [['iPos', 3], ['iSRO', 4], ['iColor', 3]]) {
    const attr = new THREE.InstancedBufferAttribute(new Float32Array(cap * n), n).setUsage(THREE.DynamicDrawUsage);
    b.geo.setAttribute(name, attr);
    b[name] = attr;
  }
}

export function initParticles(s) {
  scene = s;
  batch = makeBatch();
  scene.add(batch.mesh);
  const prev = scene.onBeforeRender;
  scene.onBeforeRender = function (renderer, sc, cam, ...rest) { prev.call(this, renderer, sc, cam, ...rest); camera = cam; sync(); };
}

// o: color, color2 (tint at end of life), size, grow, life, opacity, fadeIn, vx/vy/vz, drag, grav, additive
export function puff(x, y, z, o = {}) {
  if (particles.length >= MAX_PARTICLES && !o.priority) return null;
  const p = {
    position: new THREE.Vector3(x, y, z), scale: new THREE.Vector3().setScalar(o.size ?? 1),
    material: { opacity: o.opacity ?? 0.6, color: new THREE.Color(o.color ?? 0xb59468) },
    rot: Math.random() * Math.PI * 2, additive: !!o.additive, depth: 0,
    vx: o.vx ?? 0, vy: o.vy ?? 0, vz: o.vz ?? 0, life: o.life ?? 1, max: o.life ?? 1, grow: o.grow ?? 0,
    drag: o.drag ?? 1.5, grav: o.grav ?? 0, op: o.opacity ?? 0.6, fadeIn: o.fadeIn ?? 0,
    c0: o.color2 !== undefined ? new THREE.Color(o.color ?? 0xffffff) : null, c1: o.color2 !== undefined ? new THREE.Color(o.color2) : null,
  };
  particles.push(p);
  return p;
}

export function killPuff(handle) {
  if (handle) handle.life = 0;
}

export function updateParticles(dt) {
  for (let k = particles.length - 1; k >= 0; k--) {
    const p = particles[k];
    p.life -= dt;
    if (p.life <= 0) { particles.splice(k, 1); continue; }
    const damp = Math.exp(-p.drag * dt);
    p.vx *= damp; p.vz *= damp; p.vy = p.vy * damp - p.grav * dt;
    p.position.x += p.vx * dt; p.position.y += p.vy * dt; p.position.z += p.vz * dt;
    p.scale.addScalar(p.grow * dt);
    const age = p.max - p.life;
    const fi = p.fadeIn > 0 ? Math.min(1, age / p.fadeIn) : 1;
    p.material.opacity = p.op * fi * Math.min(1, p.life / (p.max * 0.6));
    if (p.c0) p.material.color.copy(_c.lerpColors(p.c0, p.c1, Math.min(1, age / p.max)));
  }
}

// Just before each render: every live particle into the batch, farthest first.
function sync() {
  const b = batch, list = b.list;
  list.length = 0;
  for (const p of particles) if (p.life > 0) list.push(p);
  if (camera && list.length > 1) {
    camera.getWorldDirection(_fwd);
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
    for (const p of list) p.depth = (p.position.x - cx) * _fwd.x + (p.position.y - cy) * _fwd.y + (p.position.z - cz) * _fwd.z;
    list.sort((a, c) => c.depth - a.depth);
  }
  const n = list.length;
  if (n > b.cap) grow(b, Math.max(n, b.cap * 2));
  const P = b.iPos.array, S = b.iSRO.array, C = b.iColor.array;
  for (let k = 0; k < n; k++) {
    const p = list[k], i = k * 3, j = k * 4;
    P[i] = p.position.x; P[i + 1] = p.position.y; P[i + 2] = p.position.z;
    S[j] = p.scale.x; S[j + 1] = p.rot; S[j + 2] = p.material.opacity; S[j + 3] = p.additive ? 1 : 0;
    C[i] = p.material.color.r; C[i + 1] = p.material.color.g; C[i + 2] = p.material.color.b;
  }
  b.geo.instanceCount = n;
  uploadUsed(b.iPos, n); uploadUsed(b.iSRO, n); uploadUsed(b.iColor, n);
}

export const particleCount = () => particles.length;
