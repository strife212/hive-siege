import { state, canPlace, placeStructure, spawnEnemy } from './game.js';
import { abilities } from './abilities.js';
import { canyonDist, canyonCenter } from './terrain.js';
import { DEPLOY_KEY, RECORD } from './config.js';

// Title-screen attract mode: a fortified canyon under a never-ending swarm, with strafing runs and artillery called
// in alternately. It runs the real simulation (silently) behind a dimmed overlay. The first key or click reloads
// into the actual game; if the demo Core falls the page reloads and the scene starts over.
const POPULATION = 330;

function build(type, i, j) {
  if (!canPlace(type, i, j).ok) return null;
  return placeStructure(type, i, j);
}

function fortify() {
  state.credits = 1e9;
  build('lab', 17, 24);
  build('refinery', 21, 24);
  for (let i = 8; i <= 31; i++) { build('wall', i, 9); build('wall', i, 8); }          // double wall across the choke
  for (let i = 9; i <= 30; i++) build(i % 3 === 0 ? 'flame' : 'hmg', i, 10);
  for (let i = 10; i <= 29; i += 2) build(i % 4 === 0 ? 'dual' : 'turret', i, 12);
  for (const i of [13, 17, 22, 26]) build('laser', i, 14);
  build('mortar', 14, 16); build('mortar', 24, 16);
  build('missile', 16, 21); build('missile', 23, 21);
  build('rail', 19, 15);
}

function scatterBugs(n) {
  for (let k = 0, tries = 0; k < n && tries < n * 20; tries++) {
    const z = -28 - Math.random() * 66, x = canyonCenter(z) + (Math.random() * 2 - 1) * 60;
    if (canyonDist(x, z) > -2) continue;
    spawnEnemy(k % 7 === 6 ? 'brute' : 'skitter', x, z, true);
    k++;
  }
}

export function startDemo({ camera, controls }) {
  state.demo = true;
  controls.enabled = false;
  document.body.classList.add('demo');
  const fade = document.getElementById('fade');
  fade.style.transition = 'opacity .45s';
  fade.style.opacity = '0.4';

  // the Core stands landed and unwrapped
  const ud = state.core.mesh.userData;
  for (const q of ud.fairing || []) q.removeFromParent();
  for (const py of ud.pylons || []) py.scale.y = 1.14;

  fortify();
  scatterBugs(POPULATION);

  let t = 0, spawnT = 0, repairT = 3, callT = 5, strafeNext = true, leaving = false;
  function leave(deploy) {
    if (leaving) return;
    leaving = true;
    if (deploy) { try { sessionStorage.setItem(DEPLOY_KEY, '1'); } catch { /* fine */ } }
    document.getElementById('deploy').hidden = true;
    fade.style.opacity = '1';
    setTimeout(() => location.reload(), 480);
  }
  const onGesture = (e) => { if (e.isTrusted !== false && !RECORD) leave(true); };
  addEventListener('pointerdown', onGesture);
  addEventListener('keydown', onGesture);

  return {
    update(dt) {
      t += dt;
      if ((state.gameOver || state.core.hp <= 0) && !RECORD) return leave(false);
      state.credits = 1e9;

      // field engineers: damaged structures mend and lost ones are rebuilt, so the siege can run indefinitely
      for (const s of state.structures) if (s.hp < s.maxHp) s.hp = Math.min(s.maxHp, s.hp + s.maxHp * (s === state.core ? 0.25 : 0.08) * dt);
      repairT -= dt;
      if (repairT <= 0) { repairT = 3; fortify(); }

      // keep the swarm topped up: mostly marching in from beyond the mouth
      spawnT -= dt;
      if (spawnT <= 0 && state.enemies.length < POPULATION) {
        spawnT = 0.2;
        for (let k = 0; k < 7; k++) {
          const z = -92 - Math.random() * 10;
          spawnEnemy(Math.random() < 0.12 ? 'brute' : 'skitter', canyonCenter(z) + (Math.random() * 2 - 1) * 62, z, true);
        }
      }

      // alternate strafing runs and artillery on the press in front of the wall
      callT -= dt;
      if (callT <= 0) {
        callT = 8;
        const z = -30 - Math.random() * 10;
        abilities.demoFire(strafeNext ? 'strafe' : 'artillery', { x: canyonCenter(z) + (Math.random() * 2 - 1) * 7, z });
        strafeNext = !strafeNext;
      }

      // slow sweep above and behind the fortress, looking down the canyon
      const ang = Math.sin(t * 0.05 + 0.3) * 0.7, R = 34 + 4 * Math.sin(t * 0.045);
      camera.position.set(Math.sin(ang) * R, 30 + 3 * Math.sin(t * 0.05 + 1), -20 + Math.cos(ang) * R);
      camera.lookAt(0, 1, -25);
    },
  };
}
