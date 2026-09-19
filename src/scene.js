import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { FLAT, MAP, MAPS, RECORD } from './config.js';
import { createSky, HORIZON } from './sky.js';

export function createScene(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(HORIZON.clone(), 110, 270);
  scene.add(createSky());

  // Soft image-based lighting so metals and crystals pick up reflections.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.35;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.5, 1500);
  camera.position.set(...MAPS[MAP].cam);

  scene.add(new THREE.HemisphereLight(0x7a6aa8, 0x2a1c14, 0.75));
  const sun = new THREE.DirectionalLight(0xffdcb0, 2.4);
  sun.position.set(45, 38, 18);
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

  return { renderer, scene, camera, controls, updateCamera };
}
