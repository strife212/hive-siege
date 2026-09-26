import { state, placeStructure, spawnMany, footprint, log } from './game.js';
import { abilities } from './abilities.js';
import { weather } from './weather.js';

// Heavy scene (debug menu, or ?map=test&heavy with the test map unlocked): the stress case the performance numbers
// are measured in. The test range's 1200 bugs plus darters, spitters and ants, in rain, round a walled base with every
// kind of tower, while support strikes land on the swarm one after another, overlapping, for as long as it runs.
const BASE = [
  ['lab', 21, 17], ['refinery', 18, 20],
  ...[[13, 13], [26, 13], [13, 26], [26, 26], [19, 12], [20, 27], [12, 20], [27, 19]].map((p) => ['hmg', ...p]),
  ...[[15, 15], [24, 15], [15, 24], [24, 24]].map((p) => ['turret', ...p]),
  ...[[17, 13], [22, 13], [17, 26]].map((p) => ['dual', ...p]),
  ...[[12, 15], [27, 15], [12, 24], [27, 24]].map((p) => ['flame', ...p]),
  ...[[22, 26], [14, 19], [25, 21]].map((p) => ['laser', ...p]),
  ['mortar', 16, 18], ['mortar', 22, 18], ['missile', 18, 16], ['missile', 18, 22], ['rail', 21, 21], ['heli', 14, 21],
  ['airship', 6, 30], ['apoc', 30, 6],
  ...[[10, 20], [29, 20], [20, 10], [20, 29], [10, 10], [29, 29]].map((p) => ['mine', ...p]),
];
for (let i = 11; i <= 28; i++) for (const [a, b] of [[i, 11], [i, 28], [11, i], [28, i]]) BASE.push(['wall', a, b]);

// The strike rota: one every GAP s, round the ring of swarm outside the walls; the long ones (nuke, Archangel) less often.
const GAP = 1.2;
const ROTA = ['artillery', 'lance', 'strafe', 'blackhole', 'artillery', 'laser', 'lance', 'strafe', 'troopers', 'bomber',
  'artillery', 'nuke', 'lance', 'blackhole', 'strafe', 'artillery', 'archangel'];

export function startHeavy() {
  const credits = state.credits;
  let placed = 0;
  for (const [type, i, j] of BASE) {
    const [w, h] = footprint(type);
    let free = true;
    for (let a = 0; a < w; a++) for (let b = 0; b < h; b++) if (state.occ.has(`${i + a},${j + b}`)) free = false;
    if (free) { placeStructure(type, i, j, { instant: true }); placed++; }
  }
  state.credits = credits;                                 // the base is on the house
  spawnMany(120, 'darter'); spawnMany(80, 'spitter'); spawnMany(150, 'ant');
  weather.set('rain', true);
  log(`Heavy scene: ${placed} structures, rain, and strikes every ${GAP} s on top of the test range.`, true);

  let t = 0, next = 1, k = 0;
  const around = () => { const a = Math.random() * Math.PI * 2, r = 22 + Math.random() * 16; return { x: Math.cos(a) * r, z: Math.sin(a) * r }; };
  return {
    update(dt) {
      t += dt;
      if (t < next || abilities.cinematic) return;
      next = t + GAP;
      const key = ROTA[k++ % ROTA.length], p = around();
      abilities.demoFire(key, p);
      if (key === 'bomber') { const q = around(); abilities.click({ x: -q.x, z: -q.z }); }   // its heading: across the base
    },
  };
}
