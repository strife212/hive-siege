import * as THREE from 'three';
import { uploadUsed } from './instancing.js';

// Building HP bars. Each bar is an empty group (s.bar) that the game positions, shows and hides as before; what is
// drawn is two instanced meshes for every bar together: the dark backing (render order 20), then the green fill (21).
// They were two sprites per bar, which made a damaged base cost hundreds of draw calls. The vertex shader places each
// quad exactly as a sprite would (camera-facing, sized in world units at the bar's depth), and the fragment shader is
// the sprite one, so the bars look the same. The instances are refreshed just before each render.
const CAP = 2048;
const bars = new Set();
let bg = null, fg = null;

const vertexShader = `
  attribute vec3 iPos;       // bar centre, world space
  attribute vec3 iRect;      // x offset, width, height, all in world units
  #include <common>
  #include <fog_pars_vertex>
  void main() {
    vec4 mvPosition = viewMatrix * vec4(iPos, 1.0);
    mvPosition.xy += vec2(position.x * iRect.y + iRect.x, position.y * iRect.z);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;
const fragmentShader = `
  uniform vec3 diffuse;
  uniform float opacity;
  #include <common>
  #include <fog_pars_fragment>
  void main() {
    vec4 diffuseColor = vec4(diffuse, opacity);
    vec3 outgoingLight = diffuseColor.rgb;
    #include <opaque_fragment>
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }`;

function layer(scene, color, opacity, order) {
  const geo = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1, 1));
  geo.instanceCount = 0;
  const iPos = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const iRect = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iPos', iPos);
  geo.setAttribute('iRect', iRect);
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { diffuse: { value: new THREE.Color(color) }, opacity: { value: opacity } }]),
    vertexShader, fragmentShader, fog: true, transparent: true, depthTest: false, depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = order;
  scene.add(mesh);
  return { mesh, iPos, iRect };
}

function sync() {
  let n = 0;
  for (const bar of bars) {
    if (!bar.visible || !bar.parent?.visible || n >= CAP) continue;
    const e = bar.matrixWorld.elements, { width: w, ratio: r } = bar.userData;
    bg.iPos.setXYZ(n, e[12], e[13], e[14]);
    fg.iPos.setXYZ(n, e[12], e[13], e[14]);
    bg.iRect.setXYZ(n, 0, w + 0.06, 0.15);
    fg.iRect.setXYZ(n, (r - 1) * w * 0.5, w * r, 0.09);   // left edge stays at -width/2
    n++;
  }
  for (const l of [bg, fg]) { l.mesh.geometry.instanceCount = n; uploadUsed(l.iPos, n); uploadUsed(l.iRect, n); }
}

export const hpBars = {
  init(scene) {
    bg = layer(scene, 0x05070a, 0.8, 20);
    fg = layer(scene, 0x6fe08a, 1, 21);
    const prev = scene.onBeforeRender;
    scene.onBeforeRender = function (...a) { prev.apply(this, a); sync(); };
  },
};

// A bar is drawn while it is in the scene and visible.
export function makeHpBar(width = 1.2) {
  const g = new THREE.Group();
  g.userData = { width, ratio: 1 };
  g.addEventListener('added', () => bars.add(g));
  g.addEventListener('removed', () => bars.delete(g));
  return g;
}

export function setHpBar(bar, ratio) {
  bar.userData.ratio = Math.min(1, Math.max(0.001, ratio));
}
