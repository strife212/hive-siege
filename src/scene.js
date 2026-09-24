import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FLAT, MAP, MAPS, RECORD } from './config.js';
import { createSky, HORIZON } from './sky.js';
import { createQuality } from './quality.js';

const SUN_DIR = new THREE.Vector3(45, 38, 18).normalize();
const SHADOW_RES = 3072;
const SHADOW_REACH = 1.15;                    // shadows reach this many view distances from the screen centre

// The sun's shadow map is fitted to the view (fitShadow), so it stops short of the far edge of the screen. Instead of
// cutting off there, shadows fade out over the last few percent of the map, like a shadow distance in any engine.
// Patched into the shared shader chunk before anything compiles, so every lit material gets it.
{
  const src = THREE.ShaderChunk.shadowmap_pars_fragment;
  const at = src.indexOf('float getShadow( sampler2DShadow');
  const ret = 'return mix( 1.0, shadow, shadowIntensity );';
  const k = at < 0 ? -1 : src.indexOf(ret, at);
  if (k >= 0) {
    THREE.ShaderChunk.shadowmap_pars_fragment = src.slice(0, k)
      + 'vec2 shadowEdge = min( shadowCoord.xy, 1.0 - shadowCoord.xy );\n'
      + 'return mix( 1.0, shadow, shadowIntensity * smoothstep( 0.0, 0.08, min( shadowEdge.x, shadowEdge.y ) ) );'
      + src.slice(k + ret.length);
  }
}

export function createScene(container) {
  const lowfx = new URLSearchParams(location.search).has('lowfx');
  // high-performance: on laptops with integrated and discrete graphics, ask for the discrete GPU.
  // With the post chain (below) the scene is drawn into its own 4x MSAA target and the canvas only ever receives one
  // full-screen quad, so a multisampled canvas and a canvas depth buffer would cost bandwidth and do nothing. ?lowfx
  // draws the scene straight to the canvas and keeps both.
  const renderer = new THREE.WebGLRenderer({ antialias: lowfx, depth: lowfx, powerPreference: 'high-performance' });
  const maxRatio = lowfx ? 2 : 1.5;                     // the HDR + MSAA chain is heavy at 2x on big screens
  renderer.setPixelRatio(Math.min(devicePixelRatio, maxRatio));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(HORIZON.clone(), 110, 270);
  scene.add(createSky());

  // Image-based lighting that matches the world: dusk-purple horizon, dark zenith, warm ground bounce, a hot sun spot
  // where the key light sits and a broad cool glow opposite it, so metal picks up a warm edge and a cold edge.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(environmentScene(SUN_DIR), 0.035).texture;
  scene.environmentIntensity = 0.85;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.5, 1500);
  camera.position.set(...MAPS[MAP].cam);

  scene.add(new THREE.HemisphereLight(0x7a6aa8, 0x2a1c14, 0.62));
  const sun = new THREE.DirectionalLight(0xffdcb0, 2.6);
  sun.position.copy(SUN_DIR).multiplyScalar(62);
  sun.castShadow = true;
  Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 280 });
  sun.shadow.mapSize.set(SHADOW_RES, SHADOW_RES);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  // Fit the sun's shadow box to the ground the camera is looking at: every point on screen out to SHADOW_REACH x the
  // view distance from the point at the centre of the screen (the rest fades out, see the chunk patch above). The
  // closer the camera, the smaller the box and the finer the shadows. The box moves in whole shadow texels along the
  // shadow camera's own axes, and its size in steps, so shadow edges do not crawl while the camera pans.
  const lx = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), SUN_DIR).normalize();   // the shadow camera's
  const ly = new THREE.Vector3().crossVectors(SUN_DIR, lx);                                      // right and up axes
  const _ray = new THREE.Vector3(), _hit = new THREE.Vector3(), _focus = new THREE.Vector3(), _c = new THREE.Vector3();
  // Where a screen point's ray meets y = 0, or `far` units out across the ground if it meets it later or never.
  const groundAt = (sx, sy, out, far) => {
    _ray.set(sx, sy, 0.5).unproject(camera).sub(camera.position).normalize();
    const t = _ray.y < -0.001 ? camera.position.y / -_ray.y : Infinity;
    return out.copy(camera.position).addScaledVector(_ray, Math.min(t, far / Math.max(Math.hypot(_ray.x, _ray.z), 0.05)));
  };
  let shadowHalf = 0;
  function fitShadow() {
    camera.updateMatrixWorld();
    groundAt(0, 0, _focus, 70);                             // looking out at the horizon (cinematics): mid-distance
    const reach = THREE.MathUtils.clamp(camera.position.distanceTo(_focus) * SHADOW_REACH, 16, 95);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let sy = -1; sy <= 1; sy++) for (let sx = -1; sx <= 1; sx++) {
      groundAt(sx, sy, _hit, 400);
      _hit.y = 0;
      _c.set(_hit.x - _focus.x, 0, _hit.z - _focus.z);
      if (_c.length() > reach) _hit.copy(_focus).addScaledVector(_c.normalize(), reach);
      const px = _hit.dot(lx), py = _hit.dot(ly);
      x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
    }
    const half = THREE.MathUtils.clamp(Math.ceil((Math.max(x1 - x0, y1 - y0) / 2 + 4) / 3) * 3, 15, 96);
    const texel = (2 * half) / sun.shadow.mapSize.x;       // the size can drop at runtime (quality.js)
    const cx = Math.round((x0 + x1) / 2 / texel) * texel, cy = Math.round((y0 + y1) / 2 / texel) * texel;
    const cz = Math.round(_focus.dot(SUN_DIR) / 0.5) * 0.5;
    sun.target.position.copy(lx).multiplyScalar(cx).addScaledVector(ly, cy).addScaledVector(SUN_DIR, cz);
    sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, 140);
    if (half !== shadowHalf) {
      shadowHalf = half;
      Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half });
      sun.shadow.camera.updateProjectionMatrix();
    }
  }

  // RTS camera: MMB pan, RMB rotate, wheel zoom, WASD pan, Q/E rotate. LMB is left free for the game.
  const controls = new MapControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.minDistance = 12;
  controls.maxDistance = 130;
  controls.minPolarAngle = 0.25;
  controls.maxPolarAngle = 1.25;
  controls.zoomToCursor = true;
  controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
  controls.target.set(0, 0, 0);

  const keys = new Set();
  addEventListener('keydown', (e) => keys.add(e.code));
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());

  const fwd = new THREE.Vector3(), right = new THREE.Vector3(), move = new THREE.Vector3();
  function updateCamera(dt) {
    camera.getWorldDirection(fwd);
    fwd.y = 0;
    fwd.normalize();
    right.crossVectors(fwd, camera.up).normalize();
    move.set(0, 0, 0);
    if (keys.has('KeyW') || keys.has('ArrowUp')) move.add(fwd);
    if (keys.has('KeyS') || keys.has('ArrowDown')) move.sub(fwd);
    if (keys.has('KeyD') || keys.has('ArrowRight')) move.add(right);
    if (keys.has('KeyA') || keys.has('ArrowLeft')) move.sub(right);
    if (move.lengthSq() > 0) {
      const dist = camera.position.distanceTo(controls.target);
      move.normalize().multiplyScalar(dt * dist * 0.9);
      camera.position.add(move);
      controls.target.add(move);
    }
    let rot = 0;
    if (keys.has('KeyQ')) rot += dt * 1.6;
    if (keys.has('KeyE')) rot -= dt * 1.6;
    if (rot) {
      const off = camera.position.clone().sub(controls.target).applyAxisAngle(camera.up, rot);
      camera.position.copy(controls.target).add(off);
    }
    const lim = FLAT + 6;
    const cx = THREE.MathUtils.clamp(controls.target.x, -lim, lim);
    const cz = THREE.MathUtils.clamp(controls.target.z, -lim, lim);
    camera.position.x += cx - controls.target.x;
    camera.position.z += cz - controls.target.z;
    controls.target.x = cx;
    controls.target.z = cz;
    controls.update();
  }

  addEventListener('resize', () => {
    if (RECORD) return;                                   // the recorder owns the canvas size
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  // Post chain: HDR scene (4x MSAA) -> bloom on anything brighter than white (emissives, flashes, beams, hot speculars)
  // -> tone map + sRGB with a light vignette and a 1-bit dither that stops the dark sky gradients banding.
  // ?lowfx skips the chain and draws straight to the canvas.
  let composer = null, bloom = null;
  if (!lowfx) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    composer = new EffectComposer(renderer, target);
    composer.setPixelRatio(1);                            // sized in drawing-buffer pixels below
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(size.clone(), 0.34, 0.62, 1.0);
    composer.addPass(bloom);
    const out = new OutputPass();
    const fs = out.material.fragmentShader;
    out.material.fragmentShader = fs.slice(0, fs.lastIndexOf('}')) + `
        vec2 vq = vUv - 0.5;
        gl_FragColor.rgb *= mix(1.0, smoothstep(0.95, 0.35, length(vq)), 0.32);
        gl_FragColor.rgb += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
      }`;
    composer.addPass(out);
  }
  const bufSize = new THREE.Vector2(), lastSize = new THREE.Vector2();
  function render() {
    fitShadow();
    if (!composer) return renderer.render(scene, camera);
    renderer.getDrawingBufferSize(bufSize);
    if (!bufSize.equals(lastSize)) { lastSize.copy(bufSize); composer.setSize(bufSize.x, bufSize.y); }
    composer.render();
  }

  // Adaptive quality: steps the resolution and effects down if the frame rate stays low (quality.js).
  const quality = createQuality({ renderer, composer, bloom, sun, maxRatio });

  return { renderer, scene, camera, controls, updateCamera, render, quality };
}

// Tiny stand-in world rendered once into the reflection probe.
function environmentScene(sunDir) {
  const env = new THREE.Scene();
  const geo = new THREE.SphereGeometry(50, 32, 16);
  const col = new Float32Array(geo.attributes.position.count * 3);
  const zenith = new THREE.Color(0.05, 0.06, 0.16), horizon = new THREE.Color(0.62, 0.42, 0.72), ground = new THREE.Color(0.2, 0.13, 0.08), c = new THREE.Color();
  for (let k = 0; k < geo.attributes.position.count; k++) {
    const y = geo.attributes.position.getY(k) / 50;
    if (y >= 0) c.copy(horizon).lerp(zenith, Math.pow(y, 0.55)); else c.copy(horizon).multiplyScalar(0.6).lerp(ground, Math.min(1, -y * 5));
    col.set([c.r, c.g, c.b], k * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  env.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const blob = (dir, size, color) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(size, 16, 12), new THREE.MeshBasicMaterial({ color }));
    m.position.copy(dir).multiplyScalar(40);
    env.add(m);
  };
  blob(sunDir, 5, new THREE.Color(38, 27, 15));                                                         // key: warm and hot
  blob(new THREE.Vector3(-sunDir.x, 0.35, -sunDir.z).normalize(), 14, new THREE.Color(0.5, 1.1, 1.7));   // cool fill opposite
  blob(new THREE.Vector3(0.55, 0.22, -0.8).normalize(), 6, new THREE.Color(1.6, 1.1, 0.7));             // the planet
  return env;
}
