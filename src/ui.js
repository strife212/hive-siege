import { BUILDINGS, RESEARCH } from './config.js';
import { state, on, startWave, doResearch, sellStructure, hasBuilding, log } from './game.js';
import { abilities } from './abilities.js';

const $ = (id) => document.getElementById(id);

function card(icon, name, cost) {
  const el = document.createElement('div');
  el.className = 'card';
  el.innerHTML = `<div class="icon">${icon}</div><div class="name">${name}</div><div class="cost">$${cost}</div>`;
  return el;
}

export function createUI({ onSelectBuild }) {
  const buildList = $('buildList'), techList = $('techList'), desc = $('desc'), info = $('infoPanel');
  let activeBuild = null;
  let selected = null;

  // Build cards grouped by category (Red Alert style sidebar)
  const cards = {};
  const cats = [...new Set(Object.values(BUILDINGS).map((b) => b.cat))];
  for (const cat of cats) {
    const h = document.createElement('div');
    h.className = 'cat';
    h.textContent = cat;
    buildList.appendChild(h);
    for (const [key, def] of Object.entries(BUILDINGS)) {
      if (def.cat !== cat) continue;
      const el = card(def.icon, def.name, def.cost);
      el.addEventListener('click', () => {
        if (el.classList.contains('locked')) return log(`${def.name} requires a ${BUILDINGS[def.requires].name}`, true);
        setActive(activeBuild === key ? null : key);
      });
      el.addEventListener('mouseenter', () => { desc.textContent = def.desc; });
      buildList.appendChild(el);
      cards[key] = el;
    }
  }

  const techCards = {};
  for (const [key, r] of Object.entries(RESEARCH)) {
    const el = card(r.icon, r.name, r.cost);
    el.addEventListener('click', () => doResearch(key));
    el.addEventListener('mouseenter', () => { desc.textContent = r.desc; });
    techList.appendChild(el);
    techCards[key] = el;
  }

  function setActive(key) {
    activeBuild = key;
    for (const [k, el] of Object.entries(cards)) el.classList.toggle('active', k === key);
    if (key) { showSelected(null); abilities.cancel(); }
    onSelectBuild(key);
  }

  for (const b of document.querySelectorAll('.tabs button')) {
    b.addEventListener('click', () => {
      document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
      buildList.hidden = b.dataset.tab !== 'build';
      techList.hidden = b.dataset.tab !== 'tech';
    });
  }

  $('startWave').addEventListener('click', startWave);
  $('restart').addEventListener('click', () => location.reload());

  // Selected structure panel (built once, text updated per frame)
  info.innerHTML = '<h3></h3><div class="hp"></div><div class="stats"></div><button>SELL (50%)</button>';
  const infoName = info.querySelector('h3'), infoHp = info.querySelector('.hp'), infoStats = info.querySelector('.stats');
  const sellBtn = info.querySelector('button');
  sellBtn.addEventListener('click', () => { if (selected) { sellStructure(selected); showSelected(null); } });

  function showSelected(s) {
    selected = s;
    info.hidden = !s;
    if (!s) return;
    infoName.textContent = s.name;
    sellBtn.hidden = s.type === 'core';
    const d = s.def || {};
    infoStats.textContent = d.kind === 'flame'
      ? `Range ${d.range} · Burns ${d.damage}/s for ${d.burn} s · ${d.cone}° cone`
      : d.kind === 'mortar' ? `Range ${d.minRange}-${d.range} · ${d.damage} dmg, ${d.splash} splash · ${d.rate}/s`
      : d.kind === 'missile' ? `Range ${d.range} · ${d.salvo} x ${d.damage} rockets every ${d.interval} s`
      : d.kind === 'rail' ? `Range ${d.range} · ${d.damage} piercing bolt · ${d.charge} s charge`
      : d.kind
      ? `Range ${d.range} · Damage ${d.damage} · ${d.rate}/s ${d.kind}`
      : d.income ? `+${d.income} credits / s` : '';
  }

  const logEl = $('log');
  on('log', (msg, bad) => {
    const div = document.createElement('div');
    div.textContent = msg;
    if (bad) div.className = 'bad';
    logEl.appendChild(div);
    while (logEl.children.length > 6) logEl.firstChild.remove();
    setTimeout(() => div.remove(), 4000);
  });

  on('gameover', () => {
    $('overlay').hidden = false;
    $('overlayStats').textContent = `Survived ${state.wave} waves · ${state.kills} bugs exterminated`;
  });

  const els = { credits: $('credits'), wave: $('wave'), kills: $('kills'), corehp: $('corehp'), start: $('startWave') };
  const cache = {};
  const setText = (key, v) => { if (cache[key] !== v) { cache[key] = v; els[key].textContent = v; } };

  function refresh() {
    setText('credits', Math.floor(state.credits));
    setText('wave', state.wave);
    setText('kills', state.kills);
    els.corehp.style.width = `${Math.max(0, (state.core.hp / state.core.maxHp) * 100)}%`;
    els.start.disabled = state.waveActive || state.gameOver;
    setText('start', state.waveActive
      ? `WAVE ${state.wave} — ${state.enemies.length + state.spawnQueue.length} BUGS LEFT`
      : `START WAVE ${state.wave + 1}`);

    const labBuilt = hasBuilding('lab');
    for (const [key, el] of Object.entries(cards)) {
      const def = BUILDINGS[key];
      el.classList.toggle('locked', !!def.requires && !hasBuilding(def.requires));
      el.classList.toggle('poor', state.credits < def.cost);
    }
    for (const [key, el] of Object.entries(techCards)) {
      const done = !!state.research[key];
      el.classList.toggle('done', done);
      el.classList.toggle('locked', !done && !labBuilt);
      el.classList.toggle('poor', !done && state.credits < RESEARCH[key].cost);
    }
    if (selected) {
      if (selected.hp <= 0) showSelected(null);
      else infoHp.textContent = `HP ${Math.ceil(selected.hp)} / ${selected.maxHp}`;
    }
  }

  return { refresh, setActive, showSelected, cancel: () => setActive(null), getActive: () => activeBuild };
}
