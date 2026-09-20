import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FLAT, MAP, MAPS, RECORD } from './config.js';
import { createSky, HORIZON } from './sky.js';

const SUN_DIR = new THREE.Vector3(45, 38, 18).normalize();

export function createScene(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  const lowfx = new URLSearchParams(location.search).has('lowfx');
  renderer.setPixelRatio(Math.min(devicePixelRatio, lowfx ? 2 : 1.5));   // the HDR + MSAA chain is heavy at 2x on big screens
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
  Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 220 });
  sun.shadow.mapSize.set(3072, 3072);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

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
  let composer = null;
  if (!lowfx) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    composer = new EffectComposer(renderer, target);
    composer.setPixelRatio(1);                            // sized in drawing-buffer pixels below
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new UnrealBloomPass(size.clone(), 0.34, 0.62, 1.0));
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
    if (!composer) return renderer.render(scene, camera);
    renderer.getDrawingBufferSize(bufSize);
    if (!bufSize.equals(lastSize)) { lastSize.copy(bufSize); composer.setSize(bufSize.x, bufSize.y); }
    composer.render();
  }

  return { renderer, scene, camera, controls, updateCamera, render };
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
