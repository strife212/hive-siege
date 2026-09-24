import * as THREE from 'three';
import { uploadUsed as upload } from './instancing.js';

// Procedural fire renderer. Every flame is one instance of a camera-facing quad; the fragment shader shapes it
// with scrolling fbm noise, erodes it as it ages and ramps the colour from white-hot through orange and red
// into sooty smoke. Premultiplied blending lets the hot core add light while the smoke tail occludes.
const CAP = 2400;
const uTime = { value: 0 };
let mesh = null, iPos = null, iData = null;
const px = new Float32Array(CAP), py = new Float32Array(CAP), pz = new Float32Array(CAP);
const vx = new Float32Array(CAP), vy = new Float32Array(CAP), vz = new Float32Array(CAP);
const life = new Float32Array(CAP), maxLife = new Float32Array(CAP), size = new Float32Array(CAP), grow = new Float32Array(CAP);
const grav = new Float32Array(CAP), drag = new Float32Array(CAP), seed = new Float32Array(CAP), heat = new Float32Array(CAP);
let n = 0;

const VERT = `
  attribute vec3 iPos;
  attribute vec4 iData;            // age 0..1, seed, size, heat
  uniform float uTime;
  varying vec2 vUv; varying float vAge; varying float vSeed; varying float vHeat;
  void main() {
    vAge = iData.x; vSeed = iData.y; vHeat = iData.w;
    vUv = uv;
    float ang = vSeed * 6.2832 + (vSeed - 0.5) * uTime * 2.0;
    float c = cos(ang), s = sin(ang);
    vec2 q = vec2(position.x * c - position.y * s, position.x * s + position.y * c) * iData.z;
    vec4 mv = viewMatrix * vec4(iPos, 1.0);
    mv.xy += q;
    gl_Position = projectionMatrix * mv;
  }`;

const FRAG = `
  precision highp float;
  uniform float uTime;
  varying vec2 vUv; varying float vAge; varying float vSeed; varying float vHeat;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) { return noise(p) * 0.5 + noise(p * 2.03 + 7.7) * 0.3 + noise(p * 4.1 - 3.1) * 0.2; }
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    float t = uTime * 2.2;
    float n1 = fbm(p * 2.1 + vec2(vSeed * 9.1, vSeed * 4.7 - t));
    float n2 = fbm(p * 4.3 + vec2(-t * 0.7, vSeed * 6.3));
    float shape = 1.0 - r * 1.15 + (n1 - 0.5) * 1.35 + (n2 - 0.5) * 0.55;
    float erode = 0.5 + vAge * 0.85;                      // ragged from birth, eaten away as it ages
    float mask = smoothstep(erode, erode + 0.28, shape);
    if (mask < 0.003) discard;
    float h = smoothstep(0.95, 0.05, r) * (0.55 + 0.45 * n1) * (1.0 - vAge * 0.75) * vHeat;   // heat falls off from the centre
    vec3 col = mix(vec3(0.30, 0.02, 0.0), vec3(1.0, 0.32, 0.03), smoothstep(0.0, 0.40, h));
    col = mix(col, vec3(1.0, 0.70, 0.18), smoothstep(0.40, 0.80, h));
    col = mix(col, vec3(1.0, 0.92, 0.60), smoothstep(0.90, 1.0, h));
    float smoke = smoothstep(0.45, 0.95, vAge);
    col = mix(col, vec3(0.10, 0.085, 0.075), smoke);
    float fade = 1.0 - smoothstep(0.82, 1.0, vAge);
    float a = mask * fade;
    float coverage = a * mix(0.72, 0.9, smoke);           // mostly 'over': stacked flames converge to flame colour, never white
    vec3 rgb = col * a;
    gl_FragColor = vec4(rgb, coverage);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export const flame = {
  init(scene) {
    const geo = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1, 1));
    geo.instanceCount = 0;
    iPos = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3).setUsage(THREE.DynamicDrawUsage);
    iData = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 4), 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', iPos);
    geo.setAttribute('iData', iData);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime },
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, depthTest: true,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendEquation: THREE.AddEquation,
    });
    mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
    scene.add(mesh);
  },

  // o: vx, vy, vz, life, size, grow, grav, drag, heat (0.6 = smouldering, 1 = furnace)
  emit(x, y, z, o = {}) {
    if (n >= CAP) return;
    const k = n++;
    px[k] = x; py[k] = y; pz[k] = z;
    vx[k] = o.vx ?? 0; vy[k] = o.vy ?? 1.5; vz[k] = o.vz ?? 0;
    life[k] = maxLife[k] = o.life ?? 0.6;
    size[k] = o.size ?? 0.5; grow[k] = o.grow ?? 1.2;
    grav[k] = o.grav ?? 0; drag[k] = o.drag ?? 1.0;
    seed[k] = Math.random(); heat[k] = o.heat ?? 1;
  },

  update(dt, time) {
    uTime.value = time;
    let a = 0;
    for (let k = 0; k < n; k++) {
      life[k] -= dt;
      if (life[k] <= 0) continue;
      const d = Math.exp(-drag[k] * dt);
      vx[k] *= d; vz[k] *= d; vy[k] = vy[k] * d - grav[k] * dt;
      px[k] += vx[k] * dt; py[k] += vy[k] * dt; pz[k] += vz[k] * dt;
      size[k] += grow[k] * dt;
      if (a !== k) {
        px[a] = px[k]; py[a] = py[k]; pz[a] = pz[k]; vx[a] = vx[k]; vy[a] = vy[k]; vz[a] = vz[k];
        life[a] = life[k]; maxLife[a] = maxLife[k]; size[a] = size[k]; grow[a] = grow[k];
        grav[a] = grav[k]; drag[a] = drag[k]; seed[a] = seed[k]; heat[a] = heat[k];
      }
      iPos.setXYZ(a, px[a], py[a], pz[a]);
      iData.setXYZW(a, 1 - life[a] / maxLife[a], seed[a], size[a], heat[a]);
      a++;
    }
    n = a;
    mesh.geometry.instanceCount = n;
    upload(iPos, n);
    upload(iData, n);
  },
  count: () => n,
};
