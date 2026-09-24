import '@fontsource/rajdhani/latin-600.css';
import '@fontsource/rajdhani/latin-700.css';
import '@fontsource/barlow-semi-condensed/latin-400.css';
import '@fontsource/barlow-semi-condensed/latin-500.css';
import '@fontsource/barlow-semi-condensed/latin-600.css';
import * as THREE from 'three';
import { createScene } from './scene.js';
import { createTerrain } from './terrain.js';
import { state, init, update, log, spawnMany, spawnEnemy, placeStructure } from './game.js';
import { swarm } from './swarm.js';
import { createUI } from './ui.js';
import { createInput } from './input.js';
import { createScatter } from './scatter.js';
import { playIntro } from './intro.js';
import { abilities } from './abilities.js';
import { audio } from './audio.js';
import { initParticles, particleCount } from './particles.js';
import { initEffects, updateEffects } from './effects.js';
import { initDebug } from './debug.js';
import { DEMO, DEPLOY_KEY, RECORD, MAP, MAPS } from './config.js';
import { startDemo } from './demo.js';
import { iconImg } from './icons.js';
import { troopers } from './troopers.js';
import { retract } from './retract.js';
import { weather } from './weather.js';
import { flashes } from './flashes.js';
import { perf } from './perf.js';

const { renderer, scene, camera, controls, updateCamera, render: drawFrame, quality } = createScene(document.getElementById('app'));
const render = () => { perf.renderStart(); drawFrame(); perf.renderEnd(); };     // timed for the perf overlay
const terrain = createTerrain(renderer);
scene.add(terrain);
scene.add(createScatter());
init(scene);

let input;
const ui = createUI({ onSelectBuild: (type) => input.setBuild(type) });
input = createInput({ renderer, camera, scene, terrain, ui });
initParticles(scene);
initEffects(scene);
flashes.init(scene, camera);
perf.init(renderer, () => `${state.enemies.length} bugs · ${particleCount()} particles · ${quality.short()}`);
quality.onChange = (level, desc) => {
  console.info(`[quality] level ${level}: ${desc}`);
  if (!state.demo) log(`Graphics adjusted to keep the frame rate up (${desc}).`);
};
abilities.init({ scene, ui, camera, controls });
troopers.init(scene);
try { sessionStorage.removeItem(DEPLOY_KEY); } catch { /* fine */ }      // a manual refresh shows the title screen again
if (!DEMO && !RECORD) audio.init({ getListener: () => controls.target });   // the demo plays silent; the recorder owns the audio graph
weather.init({ scene, camera, renderer, auto: !DEMO && !RECORD });   // ?weather=rain starts in the rain
initDebug();
const muteBtn = document.getElementById('mute');
audio.onMute((m) => { muteBtn.innerHTML = iconImg(m ? 'sound_off' : 'sound_on', 16); muteBtn.classList.toggle('off', m); });
muteBtn.addEventListener('pointerdown', (e) => e.stopPropagation());      // not a skip-intro / place-building click
muteBtn.addEventListener('click', () => { audio.toggleMute(); muteBtn.blur(); });

const demo = DEMO ? startDemo({ camera, controls }) : null;
const intro = DEMO ? null : playIntro({
  scene, camera, controls, core: state.core,
  onDone: () => {
    state.intro = false;
    if (!MAPS[MAP].population) return log('Protect the Core. Build defenses, then start the first wave.');
    // test range: carpet the basin with bugs straight away; tick() keeps it topped up
    state.credits = MAPS[MAP].credits;
    for (let k = 0; k < MAPS[MAP].population; k++) {
      const a = Math.random() * Math.PI * 2, r = 14 + Math.sqrt(Math.random()) * 43;
      spawnEnemy(k % 7 === 6 ? 'brute' : 'skitter', Math.cos(a) * r, Math.sin(a) * r, true);
    }
    log(`Test range: ${MAPS[MAP].population} bugs, invincible Core, ${MAPS[MAP].credits} credits.`, true);
  },
});
if (intro && (RECORD || location.search.includes('nointro'))) intro.skip();
let director = null;                                   // scripted camera for recorded scenes (record.js)
const stress = Number(new URLSearchParams(location.search).get('stress'));
if (stress > 0) setTimeout(() => { spawnMany(stress); log(`Stress test: ${stress} bugs`, true); }, 500);

function tick(dt) {
  weather.update(dt);
  if (demo) demo.update(dt);
  else if (state.intro) {
    intro.update(dt);
    ui.refresh();
    render();
    return;
  }
  if (director) director(dt); else if (abilities.cinematic) abilities.cinematic(dt); else if (!demo) updateCamera(dt);
  if (!state.gameOver) { update(dt); troopers.update(dt); }
  if (MAPS[MAP].population && state.enemies.length < MAPS[MAP].population) spawnMany(Math.min(25, MAPS[MAP].population - state.enemies.length));   // test range refills from the rim
  abilities.update(dt);
  updateEffects(dt);
  flashes.update(dt);
  audio.update();
  ui.refresh();
  // Camera shake: applied only for the render so it never feeds back into the controls.
  const sh = state.shake;
  state.shake *= Math.exp(-3 * dt);
  const ox = (Math.random() - 0.5) * sh * 0.5, oy = (Math.random() - 0.5) * sh * 0.5, oz = (Math.random() - 0.5) * sh * 0.5;
  camera.position.x += ox; camera.position.y += oy; camera.position.z += oz;
  render();
  camera.position.x -= ox; camera.position.y -= oy; camera.position.z -= oz;
}

const timer = new THREE.Timer();
if (RECORD) import('./record.js').then((m) => m.record({ seconds: RECORD, tick, renderer, camera, scene, setDirector: (f) => { director = f; } }));
function frame() {
  if (RECORD) return;                                     // record.js drives the ticks
  perf.frameStart();
  quality.sample(performance.now());
  timer.update();
  tick(Math.min(timer.getDelta(), 0.05));
  perf.frameEnd();
  requestAnimationFrame(frame);
}
frame();


// Debug handles (browser console): __game is the live state, __step(dt, n) advances n fixed steps.
window.__game = state;
window.__cam = camera;
window.__controls = controls;
window.__abilities = abilities;
window.__quality = quality;                            // adaptive render quality: .level, .describe(), .sample(now)
window.__audio = audio;
window.__swarm = swarm;
window.__spawnMany = spawnMany;
window.__place = placeStructure;
window.__retract = retract;
window.__weather = weather;                            // set('rain' | 'clear', instant), cycle(), strike(near)                            // retract(s) / deploy(s) / snap(s, down); works on state.core too (cinematics)
window.__step = (dt = 1 / 60, n = 1) => { for (let k = 0; k < n; k++) tick(dt); };
