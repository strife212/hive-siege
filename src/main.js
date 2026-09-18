import * as THREE from 'three';
import { createScene } from './scene.js';
import { createTerrain } from './terrain.js';
import { state, init, update, log, spawnMany, placeStructure } from './game.js';
import { swarm } from './swarm.js';
import { createUI } from './ui.js';
import { createInput } from './input.js';
import { createScatter } from './scatter.js';
import { playIntro } from './intro.js';
import { abilities } from './abilities.js';
import { audio } from './audio.js';
import { initParticles } from './particles.js';
import { initEffects, updateEffects } from './effects.js';

const { renderer, scene, camera, controls, updateCamera } = createScene(document.getElementById('app'));
const terrain = createTerrain(renderer);
scene.add(terrain);
scene.add(createScatter());
init(scene);

let input;
const ui = createUI({ onSelectBuild: (type) => input.setBuild(type) });
input = createInput({ renderer, camera, scene, terrain, ui });
initParticles(scene);
initEffects(scene);
abilities.init({ scene, ui });
audio.init({ getListener: () => controls.target });

const intro = playIntro({
  scene, camera, controls, core: state.core,
  onDone: () => { state.intro = false; log('Protect the Core. Build defenses, then start the first wave.'); },
});
if (location.search.includes('nointro')) intro.skip();
const stress = Number(new URLSearchParams(location.search).get('stress'));
if (stress > 0) setTimeout(() => { spawnMany(stress); log(`Stress test: ${stress} bugs`, true); }, 500);

function tick(dt) {
  if (state.intro) {
    intro.update(dt);
    ui.refresh();
    renderer.render(scene, camera);
    return;
  }
  updateCamera(dt);
  if (!state.gameOver) update(dt);
  abilities.update(dt);
  updateEffects(dt);
  audio.update();
  ui.refresh();
  // Camera shake: applied only for the render so it never feeds back into the controls.
  const sh = state.shake;
  state.shake *= Math.exp(-3 * dt);
  const ox = (Math.random() - 0.5) * sh * 0.5, oy = (Math.random() - 0.5) * sh * 0.5, oz = (Math.random() - 0.5) * sh * 0.5;
  camera.position.x += ox; camera.position.y += oy; camera.position.z += oz;
  renderer.render(scene, camera);
  camera.position.x -= ox; camera.position.y -= oy; camera.position.z -= oz;
}

const timer = new THREE.Timer();
function frame() {
  timer.update();
  tick(Math.min(timer.getDelta(), 0.05));
  requestAnimationFrame(frame);
}
frame();


// Debug handles (browser console): __game is the live state, __step(dt, n) advances n fixed steps.
window.__game = state;
window.__cam = camera;
window.__controls = controls;
window.__abilities = abilities;
window.__audio = audio;
window.__swarm = swarm;
window.__spawnMany = spawnMany;
window.__place = placeStructure;
window.__step = (dt = 1 / 60, n = 1) => { for (let k = 0; k < n; k++) tick(dt); };
