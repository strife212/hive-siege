import * as THREE from 'three';
import { createScene } from './scene.js';
import { createTerrain } from './terrain.js';
import { state, init, update, log } from './game.js';
import { createUI } from './ui.js';
import { createInput } from './input.js';

const { renderer, scene, camera, updateCamera } = createScene(document.getElementById('app'));
const terrain = createTerrain();
scene.add(terrain);
init(scene);

let input;
const ui = createUI({ onSelectBuild: (type) => input.setBuild(type) });
input = createInput({ renderer, camera, scene, terrain, ui });

function tick(dt) {
  updateCamera(dt);
  if (!state.gameOver) update(dt);
  ui.refresh();
  renderer.render(scene, camera);
}

const clock = new THREE.Clock();
function frame() {
  tick(Math.min(clock.getDelta(), 0.05));
  requestAnimationFrame(frame);
}
frame();

log('Protect the Core. Build defenses, then start the first wave.');

// Debug handles (browser console): __game is the live state, __step(dt, n) advances n fixed steps.
window.__game = state;
window.__step = (dt = 1 / 60, n = 1) => { for (let k = 0; k < n; k++) tick(dt); };
