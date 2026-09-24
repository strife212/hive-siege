import { BUILDINGS, RESEARCH } from './config.js';
import { state, on, startWave, doResearch, sellStructure, hasBuilding, countBuildings, log } from './game.js';
import { abilities } from './abilities.js';
import { iconImg } from './icons.js';
import { retract } from './retract.js';
import { MOBILE } from './mobile.js';

const $ = (id) => document.getElementById(id);

function card(key, name, cost) {
  const el = document.createElement('div');
  el.className = 'card';
  el.innerHTML = `<div class="icon">${iconImg(key)}</div><div class="name">${name}</div><div class="cost">$${cost.toLocaleString('en-US')}</div>`;
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
      const el = card(key, def.name, def.cost);
      el.addEventListener('click', () => {
        if (el.classList.contains('maxed')) return log(`Only ${def.limit} ${def.name} allowed`, true);
        if (el.classList.contains('locked')) return log(`${def.name} requires a ${BUILDINGS[def.requires].name}`, true);
        setActive(activeBuild === key ? null : key);
        if (MOBILE && activeBuild) desc.textContent = def.desc;
      });
      if (!MOBILE) el.addEventListener('mouseenter', () => { desc.textContent = def.desc; });
      buildList.appendChild(el);
      cards[key] = el;
    }
  }

  // TECH tab: GLOBAL on top, then a section per building in build-list order. A building's section is revealed the
  // first time one is built and stays listed after that. Research filed under two buildings gets a card in each.
  const techCards = [];                                      // [key, el]
  const techGroups = [];                                     // { type, els, shown }
  for (const type of ['global', ...Object.keys(BUILDINGS)]) {
    const keys = Object.keys(RESEARCH).filter((k) => [].concat(RESEARCH[k].group).includes(type));
    if (!keys.length) continue;
    const h = document.createElement('div');
    h.className = 'cat';
    h.textContent = type === 'global' ? 'GLOBAL' : BUILDINGS[type].name.toUpperCase();
    techList.appendChild(h);
    const els = [h];
    for (const key of keys) {
      const r = RESEARCH[key], el = card(key, r.name, r.cost);
      el.addEventListener('click', () => {
        if (MOBILE && techPick !== el) return pickTech(el, `${r.desc}${el.matches('.done, .locked') ? '' : ' Tap again to research.'}`);
        pickTech(null);
        doResearch(key);
      });
      if (!MOBILE) el.addEventListener('mouseenter', () => { desc.textContent = r.desc; });
      techList.appendChild(el);
      techCards.push([key, el]);
      els.push(el);
    }
    const shown = type === 'global';
    for (const el of els) el.hidden = !shown;
    techGroups.push({ type, els, shown });
  }
  // Phone mode: the tech card tapped once (highlighted, its description showing); a second tap researches it.
  let techPick = null;
  function pickTech(el, text = '') {
    techPick?.classList.remove('active');
    techPick = el;
    el?.classList.add('active');
    desc.textContent = text;
  }
  const techHint = document.createElement('div');
  techHint.className = 'hint';
  techHint.textContent = 'Each tower’s research is listed here once you have built one.';
  techList.appendChild(techHint);
  on('research', () => { if (selected) showSelected(selected); });     // upgraded stats in the info panel

  function setActive(key) {
    activeBuild = key;
    for (const [k, el] of Object.entries(cards)) el.classList.toggle('active', k === key);
    if (key) { showSelected(null); abilities.cancel(); }
    else if (MOBILE) desc.textContent = '';                  // phones show the description only while it is in use
    onSelectBuild(key);
  }

  for (const b of document.querySelectorAll('.tabs button')) {
    b.addEventListener('click', () => {
      document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
      buildList.hidden = b.dataset.tab !== 'build';
      techList.hidden = b.dataset.tab !== 'tech';
      if (MOBILE) { pickTech(null); if (b.dataset.tab === 'tech') setActive(null); }
    });
  }

  $('startWave').addEventListener('click', startWave);
  $('restart').addEventListener('click', () => location.reload());

  // Selected structure panel (built once, text updated per frame)
  info.innerHTML = '<h3></h3><div class="hp"><span>INTEGRITY</span><b></b></div><div class="bar"><div></div></div><div class="stats"></div><button class="silo"></button><button class="sell"></button>';
  const infoName = info.querySelector('h3'), infoHp = info.querySelector('.hp b'), infoBar = info.querySelector('.bar > div'), infoStats = info.querySelector('.stats');
  const sellBtn = info.querySelector('button.sell'), siloBtn = info.querySelector('button.silo');
  siloBtn.addEventListener('click', () => { if (selected) retract.toggle(selected); siloBtn.blur(); });
  addEventListener('keydown', (e) => { if (e.code === 'KeyR' && !e.repeat && selected && selected.type !== 'core' && !state.intro) retract.toggle(selected); });
  sellBtn.addEventListener('click', () => { if (selected) { sellStructure(selected); showSelected(null); } });

  function showSelected(s) {
    selected = s;
    info.hidden = !s;
    if (!s) return;
    infoName.textContent = s.name;
    sellBtn.hidden = siloBtn.hidden = s.type === 'core';
    const d = s.def || {};
    sellBtn.textContent = `SELL  +$${Math.floor((d.cost || 0) * 0.5)}`;
    const stats = d.kind === 'flame'
      ? `Range ${d.range} · Burns ${d.damage}/s for ${d.burn} s · ${d.cone}° cone`
      : d.kind === 'mortar' ? `Range ${d.minRange}-${d.range} · ${d.damage} dmg, ${d.splash} splash · ${d.rate}/s`
      : d.kind === 'missile' ? `Range ${d.range} · ${d.salvo} x ${d.damage} rockets every ${d.interval} s`
      : d.kind === 'airship' ? `Patrols ${d.range} · 2x${d.gatRounds} gatling · 2x${d.hmgRounds} HMG · ${d.shells} shells (${d.artDamage}) · ${d.bombs} bombs (${d.bombDamage}) · ${d.rearm} s rearm`
      : d.kind === 'heli' ? `Patrols ${d.range} · ${d.rounds} x ${d.damage} gatling + ${d.rockets} x ${d.rocketDamage} rockets · ${d.rearm} s rearm`
      : d.kind === 'rail' ? `Range ${d.range} · ${d.damage} piercing bolt · ${d.charge} s charge`
      : d.mines ? `${d.mines} mines · ${d.damage} damage each · Re-arms in ${d.rearm} s · New set ${d.reload} s after the last`
      : d.kind
      ? `Range ${d.range} · Damage ${d.damage} · ${d.rate}/s ${d.kind}`
      : d.income ? `+${d.income} credits / s` : '';
    infoStats.replaceChildren(...stats.split(' · ').filter(Boolean).map((t) => Object.assign(document.createElement('div'), { textContent: t })));
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

  // Big two-line announcement at the start of every wave; re-triggering restarts the 3 s animation.
  const banner = $('wavebanner');
  on('wave', (n, boss) => {
    banner.querySelector('b').textContent = `WAVE ${n}`;
    banner.querySelector('span').textContent = boss ? 'COLOSSUS INCOMING' : 'ENEMIES INCOMING';
    banner.classList.toggle('boss', boss);
    bannerStart = state.time;
  });
  // Driven by the game clock (not a CSS animation): slam in over 0.27 s, hold, fade out by 3 s.
  let bannerStart = -10;
  function updateBanner() {
    const u = (state.time - bannerStart) / 3;
    if (u < 0 || u >= 1) { if (banner.style.opacity !== '0') banner.style.opacity = '0'; return; }
    const inn = Math.min(1, u / 0.09), out = Math.max(0, (u - 0.8) / 0.2);
    const e = 1 - (1 - inn) ** 3;
    banner.style.opacity = String(e * (1 - out));
    banner.style.transform = `translateX(-50%) translateY(${-10 * out}px) scale(${1.35 - 0.35 * e - 0.04 * out})`;
  }

  on('gameover', () => {
    $('overlay').hidden = false;
    $('overlayStats').textContent = `Survived ${state.wave} waves · ${state.kills} bugs exterminated`;
  });

  const els = { credits: $('credits'), wave: $('wave'), kills: $('kills'), corehp: $('corehp'), corepct: $('corepct'), start: $('startWave') };
  const coreStat = $('coreStat'), waveBtn = $('waveBtn');
  const NUDGE_AFTER = 10;                                    // s of play before an unstarted wave 1 starts to glow
  const cache = {};
  const setText = (key, v) => { if (cache[key] !== v) { cache[key] = v; els[key].textContent = v; } };

  function refresh() {
    updateBanner();
    setText('credits', Math.floor(state.credits).toLocaleString('en-US'));
    setText('wave', state.wave);
    setText('kills', state.kills.toLocaleString('en-US'));
    const core = Math.max(0, state.core.hp / state.core.maxHp);
    els.corehp.style.width = `${core * 100}%`;
    setText('corepct', `${Math.ceil(core * 100)}%`);
    coreStat.classList.toggle('warn', core <= 0.6 && core > 0.3);
    coreStat.classList.toggle('crit', core <= 0.3);
    els.start.disabled = state.waveActive || state.gameOver;
    waveBtn.classList.toggle('nudge', state.wave === 0 && !state.waveActive && !state.gameOver && !state.demo && state.time > NUDGE_AFTER);
    setText('start', state.waveActive
      ? `WAVE ${state.wave}  •  ${state.enemies.length + state.spawnQueue.length + state.walkQueue.length} HOSTILES`
      : `START WAVE ${state.wave + 1}`);

    const labBuilt = hasBuilding('lab');
    for (const [key, el] of Object.entries(cards)) {
      const def = BUILDINGS[key];
      el.classList.toggle('locked', !!def.requires && !hasBuilding(def.requires));
      el.classList.toggle('maxed', !!def.limit && countBuildings(key) >= def.limit);
      el.classList.toggle('poor', state.credits < def.cost);
    }
    for (const g of techGroups) {
      if (g.shown || !hasBuilding(g.type)) continue;
      g.shown = true;
      for (const el of g.els) el.hidden = false;
    }
    techHint.hidden = techGroups.every((g) => g.shown);
    for (const [key, el] of techCards) {
      const done = !!state.research[key];
      el.classList.toggle('done', done);
      el.classList.toggle('locked', !done && !labBuilt);
      el.classList.toggle('poor', !done && state.credits < RESEARCH[key].cost);
    }
    if (selected) {
      if (selected.hp <= 0) showSelected(null);
      else {
        const hp = `${Math.ceil(selected.hp)} / ${selected.maxHp}`;
        if (infoHp.textContent !== hp) { infoHp.textContent = hp; infoBar.style.width = `${(selected.hp / selected.maxHp) * 100}%`; }
        const label = selected.selling ? 'CLEARING SITE…' : MOBILE ? retract.label(selected) : `${retract.label(selected)}  [R]`;
        if (siloBtn.textContent !== label) { siloBtn.textContent = label; siloBtn.disabled = !!selected.selling; }
      }
    }
  }

  return { refresh, setActive, showSelected, cancel: () => setActive(null), getActive: () => activeBuild };
}
