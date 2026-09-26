import { state, log, spawnEnemy, startWave } from './game.js';
import { SPAWN_RADIUS } from './config.js';
import { nestPosition } from './terrain.js';
import { retract } from './retract.js';
import { weather } from './weather.js';
import { perf } from './perf.js';
import { MAP, MAPS, DEPLOY_KEY, TEST_KEY } from './config.js';

// Debug popup (Z): cheat credits and cycle the map. Maps are built at load, so changing one reloads the page.
export function initDebug() {
  const el = document.getElementById('debug');
  const keys = Object.keys(MAPS).filter((k) => !MAPS[k].hidden);        // hidden maps (the test range) are not in the cycle
  const next = keys[(keys.indexOf(MAP) + 1) % keys.length];
  document.getElementById('dbgMapName').textContent = `Current: ${MAPS[MAP].name} \u2192 ${MAPS[next].name}`;
  addEventListener('keydown', (e) => {
    if (e.code === 'KeyZ' && !e.repeat && !e.ctrlKey && !e.metaKey && !state.intro) el.hidden = !el.hidden;
  });
  el.addEventListener('pointerdown', (e) => e.stopPropagation());
  document.getElementById('dbgCash').onclick = () => { state.credits += 50000; log('Debug: +50,000 credits'); };
  document.getElementById('dbgWave').onclick = () => startWave(true);
  document.getElementById('dbgBoss').onclick = () => { const p = nestPosition(0, 1, Math.random() * 6.28, SPAWN_RADIUS); spawnEnemy('colossus', p.x, p.z); };
  document.getElementById('dbgSpecial').onclick = () => {        // a pack of each special from one nest
    const p = nestPosition(0, 1, Math.random() * 6.28, SPAWN_RADIUS);
    for (let k = 0; k < 18; k++) { const a = Math.random() * 6.28, r = Math.random() * 5; spawnEnemy(k < 12 ? 'darter' : 'spitter', p.x + Math.cos(a) * r, p.z + Math.sin(a) * r); }
  };
  const perfBtn = document.getElementById('dbgPerf');
  const perfLabel = () => { perfBtn.textContent = `Performance stats: ${perf.on ? 'ON' : 'OFF'}`; perfBtn.classList.toggle('on', perf.on); };
  perfLabel();
  perfBtn.onclick = () => { perf.toggle(); perfLabel(); };
  const wxBtn = document.getElementById('dbgWeather');
  const wxLabel = () => { wxBtn.textContent = `Change weather (${weather.name(weather.current)})`; };
  wxLabel();
  wxBtn.onclick = () => { const next = weather.cycle(); wxLabel(); log(`Debug: weather turning to ${weather.name(next).toLowerCase()}`); };
  document.getElementById('dbgSilo').onclick = () => {         // city-wide drill: everything down, or everything back up
    const list = state.structures.filter((s) => s !== state.core && !s.selling);
    const anyUp = list.some((s) => !s.pending && !(s.silo && s.silo.target > 0));
    for (const s of list) if (anyUp) retract.retract(s); else retract.deploy(s);
  };
  document.getElementById('dbgCore').onclick = () => retract.toggle(state.core);   // players get no Core toggle: this is for staging cutscenes
  document.getElementById('dbgMap').onclick = () => {
    const q = new URLSearchParams(location.search);
    q.set('map', next);
    try { sessionStorage.setItem(DEPLOY_KEY, '1'); sessionStorage.removeItem(TEST_KEY); } catch { /* fine */ }   // straight into the new map, no title screen
    location.search = q.toString();
  };
  const testBtn = document.getElementById('dbgTest');
  if (MAP === 'test') testBtn.textContent = 'Leave test map';
  testBtn.onclick = () => {
    const q = new URLSearchParams(location.search);
    try {
      sessionStorage.setItem(DEPLOY_KEY, '1');
      if (MAP === 'test') { sessionStorage.removeItem(TEST_KEY); q.delete('map'); } else { sessionStorage.setItem(TEST_KEY, '1'); q.set('map', 'test'); }
    } catch { /* fine */ }
    location.search = q.toString();
  };
}
