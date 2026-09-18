import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { HALF } from './config.js';

export function createScene(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0e14);
  scene.fog = new THREE.Fog(0x0b0e14, 80, 160);

  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.5, 400);
  camera.position.set(0, 26, 28);

  scene.add(new THREE.HemisphereLight(0x8fa8ff, 0x3a2a20, 0.7));
  const sun = new THREE.DirectionalLight(0xffe0b0, 2.2);
  sun.position.set(30, 50, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -50, right: 50, top: 50, bottom: -50, near: 1, far: 150 });
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);

  // RTS camera: MMB pan, RMB rotate, wheel zoom, WASD pan, Q/E rotate. LMB is left free for the game.
  const controls = new MapControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.minDistance = 12;
  controls.maxDistance = 95;
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
    const lim = HALF + 6;
    const cx = THREE.MathUtils.clamp(controls.target.x, -lim, lim);
    const cz = THREE.MathUtils.clamp(controls.target.z, -lim, lim);
    camera.position.x += cx - controls.target.x;
    camera.position.z += cz - controls.target.z;
    controls.target.x = cx;
    controls.target.z = cz;
    controls.update();
  }

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  return { renderer, scene, camera, controls, updateCamera };
}
