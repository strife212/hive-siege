export const VERSION = '1.8';                 // shown on the main menu; goes up by 0.1 with every commit
export const MAP_SIZE = 80;
export const HALF = MAP_SIZE / 2;
export const CELL = 2;
export const CELLS = MAP_SIZE / CELL;
export const FLAT = 60;                       // half-size of the flat, walkable basin (build area is HALF)
export const SPAWN_RADIUS = FLAT - 4;         // enemy nests appear at the edge of the basin
export const START_CREDITS = 450;

// Maps are picked with ?map=<key>; everything that depends on the terrain is built once at load.
export const MAPS = {
  basin: { name: 'Open Basin', cam: [0, 26, 28] },
  canyon: { name: 'Deadrock Canyon', cam: [0, 36, 30] },
  // Debug-only proving ground: the open basin kept crawling with bugs, and a Core that cannot be hurt. `hidden` maps are
  // left out of the normal map cycle and only load when the debug menu has set TEST_KEY for this tab.
  test: { name: 'Test Range', cam: [0, 26, 28], hidden: true, invincibleCore: true, population: 1200, credits: 50000 },
};
export const TEST_KEY = 'hive-siege-test-map';
const query = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
const mapParam = query.get('map');
// Title screen: an attract-mode battle on the canyon map. The first click or key sets DEPLOY_KEY and reloads into the
// real game (maps are built at load), so the demo only runs on a fresh visit.
export const DEPLOY_KEY = 'hive-siege-deployed';
let deployed = false;
try { deployed = sessionStorage.getItem(DEPLOY_KEY) === '1'; } catch { /* storage blocked: no demo */ deployed = true; }
export const RECORD = Number(query.get('record')) || 0;      // ?record=15 renders the demo scene to a 1080p video (record.js)
export const SCENE = RECORD > 0 ? query.get('scene') : null;  // ?record=14&scene=bomber films a scripted scene instead of the demo
export const DEMO = SCENE ? false : RECORD > 0 || (!deployed && !query.has('nointro') && !query.has('stress'));
let unlocked = false;
try { unlocked = sessionStorage.getItem(TEST_KEY) === '1'; } catch { /* stays locked */ }
export const MAP = DEMO ? 'canyon' : MAPS[mapParam] && (!MAPS[mapParam].hidden || unlocked) ? mapParam : 'basin';
export const MAX_SLOPE = 1.6;

export const BUILDINGS = {
  wall: {
    name: 'Wall', cost: 25, hp: 320, cat: 'STRUCTURES',
    desc: 'Cheap barrier. Bugs have to chew through it to reach the Core.',
  },
  // Walkable: bugs path straight over it and never attack it (game.js). One mine goes off per bug that steps on the
  // tile, then the field re-arms for `rearm` s; once all `mines` are spent a new set takes `reload` s.
  // silo: false: no silo. The mines are fired down from orbit (mines.js), never retract, and stay out through the
  // strategic strike.
  mine: {
    name: 'Minefield', cost: 100, hp: 120, cat: 'STRUCTURES', walkable: true, silo: false,
    mines: 5, damage: 80, rearm: 1, reload: 30,
    desc: 'Five pressure mines on one tile. Bugs walk straight over it: each one that steps on it sets a mine off (80 damage, enough for a skitterer). Re-arms 1 s after each blast; once all five are spent a new set takes 30 s.',
  },
  hmg: {
    name: 'HMG Turret', cost: 85, hp: 170, cat: 'DEFENSE',
    kind: 'tracer', range: 11, damage: 3.5, rate: 10, turn: 5,
    desc: 'Heavy machine gun. Hoses down bugs with a stream of low-damage rounds.',
  },
  turret: {
    name: 'Autocannon', cost: 120, hp: 200, cat: 'DEFENSE',
    kind: 'projectile', range: 13, damage: 16, rate: 2.2, turn: 3.6,
    desc: 'Single-barrel autocannon firing guided shells. Reliable all-rounder.',
  },
  dual: {
    name: 'Dual Autocannon', cost: 230, hp: 240, cat: 'DEFENSE',
    kind: 'projectile', range: 13, damage: 16, rate: 2.2, turn: 3,
    desc: 'Twin-barrel autocannon. Fires two shells per salvo for double the firepower.',
  },
  flame: {
    name: 'Flamethrower', cost: 145, hp: 190, cat: 'DEFENSE',
    kind: 'flame', range: 7.5, damage: 14, burn: 3, cone: 24, turn: 3,
    desc: 'Short-range fire stream. Sets every bug in the cone burning for 3 s (damage over time, stacks by refreshing).',
  },
  laser: {
    name: 'Laser Tower', cost: 210, hp: 160, cat: 'DEFENSE',
    kind: 'hitscan', range: 15, damage: 4.5, rate: 9, turn: 2.6, requires: 'lab',
    desc: 'Hitscan beam. Instant hits, no travel time. Requires a Research Lab.',
  },
  mortar: {
    name: 'Mortar Pit', cost: 300, hp: 320, cat: 'DEFENSE', size: [2, 2],
    kind: 'mortar', range: 26, minRange: 8, damage: 55, splash: 3, rate: 0.4, turn: 1.6,
    desc: 'Indirect fire over walls. Long range, big splash, but cannot hit anything closer than 8.',
  },
  missile: {
    name: 'Missile Silo', cost: 400, hp: 350, cat: 'DEFENSE', size: [2, 2],
    kind: 'missile', range: 25, damage: 30, splash: 2.2, salvo: 6, interval: 6,
    desc: 'Every 6 s the hatches open and six homing rockets corkscrew into the densest cluster of bugs.',
  },
  heli: {
    name: 'Gunship Pad', cost: 500, hp: 380, cat: 'DEFENSE', size: [2, 2],
    kind: 'heli', range: 48, damage: 4, rate: 14, rounds: 100, rockets: 10, rocketDamage: 42, splash: 2.4, rearm: 5,
    desc: 'A heavy VTOL gunship lifts off to hunt the nearest bugs with 100 gatling rounds and 10 rockets, then returns to the pad for 5 s to rearm.',
  },
  airship: {
    name: 'Titan Airship Pad', cost: 5000, hp: 600, cat: 'DEFENSE', size: [2, 3], limit: 1,
    kind: 'airship', range: 52, rearm: 8,
    damage: 4, gatRate: 14, gatRounds: 500,                       // two gatling cannons
    hmgDamage: 3, hmgRate: 8, hmgRounds: 250,                     // two HMGs
    shells: 25, artRate: 0.5, artDamage: 95, artSplash: 4.6,      // belly howitzer
    bombs: 30, bombRate: 2.2, bombDamage: 120, bombSplash: 4,     // bomb bay, straight down
    desc: 'Titan Support Airship: twin gatlings (500 rds each), twin HMGs (250 each), a 25-shell howitzer and 30 bombs. Rearms on its pad for 8 s. Only one can be built.',
  },
  rail: {
    name: 'Railgun Battery', cost: 1000, hp: 300, cat: 'DEFENSE', size: [2, 2], requires: 'lab',
    kind: 'rail', range: 40, damage: 400, charge: 5, turn: 1.3,
    desc: 'Charges for 5 s then fires a bolt that pierces every bug in a line. Requires a Research Lab.',
  },
  refinery: {
    name: 'Refinery', cost: 150, hp: 260, cat: 'ECONOMY',
    income: 3,
    desc: 'Extracts credits from the crust: +3 credits / second, once the first wave has been called.',
  },
  lab: {
    name: 'Research Lab', cost: 500, hp: 220, cat: 'ECONOMY',
    desc: 'Unlocks the Laser Tower and the TECH tab research. Each tower\'s research is listed once one has been built.',
  },
  uplink: {
    name: 'Strategic Uplink Tower', cost: 2000, hp: 700, cat: 'SUPPORT', size: [2, 2],
    desc: 'A towering relay mast bristling with dishes and antennas that links the base to strategic command. Required to call in the Strategic Nuclear Strike.',
  },
};

// TECH tab. `group` is the building whose section a research sits in: the section appears once one of those has been
// built (a list puts it in several sections). 'global' research is always listed. Effects live in game.js (stat
// changes in buildDefs, behaviour where the weapon fires) and abilities.js (cooldowns).
export const RESEARCH = {
  composite:   { group: 'global', name: 'Composite Armour', cost: 1800, desc: 'Every structure, the Core included, gets +25% max HP. Applies to existing buildings too.' },
  fireControl: { group: 'global', name: 'Integrated Fire Control', cost: 2100, desc: 'Every tower gets +10% range, the Gunship and Titan patrol areas included.' },
  orbital:     { group: 'global', name: 'Orbital Command Priority', cost: 3000, desc: 'Support ability cooldowns are 25% shorter. The Strategic Nuclear Strike is not affected.' },
  plating:     { group: 'wall', name: 'Reinforced Plating', cost: 450, desc: 'Walls get +100% HP. Applies to existing walls too.' },
  hmgFeed:     { group: 'hmg', name: 'High-Cyclic Feed', cost: 450, desc: 'HMG Turrets fire 30% faster.' },
  overpen:     { group: 'hmg', name: 'Overpenetration', cost: 525, desc: 'An HMG round that kills its bug carries the leftover damage on into the nearest bug within 2 m.' },
  he:          { group: ['turret', 'dual'], name: 'HE Rounds', cost: 600, desc: 'Autocannon and Dual Autocannon shells explode, damaging nearby bugs.' },
  autoloader:  { group: 'turret', name: 'Autoloader', cost: 525, desc: 'Autocannons fire 30% faster.' },
  sabot:       { group: 'turret', name: 'Sabot Shells', cost: 600, desc: 'Autocannon shells deal +50% damage to brutes, spitters and the Colossus.' },
  du:          { group: 'dual', name: 'Depleted-Uranium Shells', cost: 825, desc: 'Dual Autocannons deal +25% damage and reach further (range 13 → 15).' },
  tanks:       { group: 'flame', name: 'Pressurised Tanks', cost: 525, desc: 'Flamethrower range 7.5 → 10 and a wider cone (24° → 32°).' },
  napalm:      { group: 'flame', name: 'Clinging Napalm', cost: 600, desc: 'A bug that dies burning from a Flamethrower sets every bug within 2 m alight, so the fire chains through dense packs.' },
  optics:      { group: 'laser', name: 'Overcharged Optics', cost: 600, desc: 'Laser Towers deal +50% damage.' },
  focus:       { group: 'laser', name: 'Focusing Array', cost: 675, desc: 'Laser damage ramps up the longer it holds one target: +20% per second, up to +100%. Resets when it switches target.' },
  prism:       { group: 'laser', name: 'Prism Splitter', cost: 750, desc: 'Every laser pulse also arcs to one more bug within 3 m for half damage.' },
  crew:        { group: 'mortar', name: 'Double Crew', cost: 750, desc: 'Mortar Pits fire 50% faster (a shell every 1.7 s instead of 2.5 s).' },
  phosphorus:  { group: 'mortar', name: 'White Phosphorus', cost: 900, desc: 'Every bug caught in a mortar blast burns for 4 s at 12 damage per second.' },
  reload:      { group: 'missile', name: 'Hot Reload', cost: 900, desc: 'Missile Silos fire a salvo every 4 s instead of 6 s.' },
  distrib:     { group: 'missile', name: 'Distributed Targeting', cost: 1050, desc: 'Each missile in a salvo picks its own cluster of bugs instead of all six piling onto the same one.' },
  heliMags:    { group: 'heli', name: 'Extended Magazines', cost: 1200, desc: 'Gunships carry 160 gatling rounds and 16 rockets per sortie (+60%).' },
  hunter:      { group: 'heli', name: 'Hunter-Killer Avionics', cost: 1050, desc: 'Gunship rockets are saved for brutes, spitters and the Colossus; small bugs only get the gatling.' },
  deepMags:    { group: 'airship', name: 'Deep Magazines', cost: 4500, desc: 'The Titan carries 50% more of everything: 750 gatling and 375 HMG rounds per gun, 38 shells and 45 bombs.' },
  relay:       { group: 'airship', name: 'Fire Control Relay', cost: 6000, desc: 'While the Titan is in the air, every tower within 15 m of the ground beneath it fires 20% faster.' },
  supercap:    { group: 'rail', name: 'Supercapacitors', cost: 1800, desc: 'Railgun charge time 5 s → 3 s.' },
  penetrator:  { group: 'rail', name: 'Tungsten Penetrator', cost: 2250, desc: 'Railgun bolts deal triple damage to the Colossus.' },
};

export const BOSS_EVERY = 10;                 // a Colossus joins every tenth wave
export const ENEMIES = {
  colossus: {
    name: 'Colossus', boss: true, hp: 5000, speed: 1.75, damage: 90, attackRate: 0.55, reward: 500, scale: 3,
  },
  skitter: {
    name: 'Skitterer', hpCapWave: 5, hp: 45, speed: 4.8, damage: 6, attackRate: 1.3, reward: 10, scale: 0.7,
    color: 0x5b2f70, plate: 0x2a1538, legColor: 0x2a1535, accent: 0x9be04a, eye: 0xff3020, spikes: false, legR: 1,
  },
  brute: {
    name: 'Brute', hpCapWave: 10, hp: 280, speed: 2.4, damage: 24, attackRate: 0.7, reward: 45, scale: 1.5,
    color: 0x5a2430, plate: 0x2b1016, legColor: 0x24101a, accent: 0xd9c9a8, eye: 0xff7a20, spikes: true, legR: 1.7,
  },
  // Specials (see SPECIALS): a skitterer-sized sprinter, and a brute-sized bug with an acid cannon on its back.
  darter: {
    name: 'Darter', hpCapWave: 5, hp: 32, speed: 9.6, damage: 5, attackRate: 1.6, reward: 10, scale: 0.7,
    color: 0x2a93ad, plate: 0x0f4556, legColor: 0x0d2c38, accent: 0x55f0ff, eye: 0xffd23a, spikes: false, legR: 0.85, fins: true,
  },
  spitter: {
    name: 'Acid Spitter', hpCapWave: 10, hp: 240, speed: 2.5, damage: 16, attackRate: 0.8, reward: 45, scale: 1.5,
    color: 0x86821a, plate: 0x34360a, legColor: 0x262809, accent: 0xa6ff2e, eye: 0xff4a1a, spikes: false, legR: 1.6, cannon: true,
    // Lobs a glob at the nearest building within range (walls excepted: it arcs straight over them) while it walks.
    acid: { range: 8, damage: 14, rate: 0.45, turn: 4.5 },
  },
  // Fodder: half a skitterer, one hit kills it at any wave, and it is worth nothing. It soaks up fire and chews walls.
  ant: {
    name: 'Ant', hpCapWave: 1, hp: 1, speed: 5.4, damage: 2, attackRate: 1.5, reward: 0, scale: 0.35,
    color: 0x1d1d22, plate: 0x0b0b0e, legColor: 0x121216, accent: 0xff9a2e, eye: 0xffc440, spikes: false, legR: 1.2,
  },
};
export const SPECIALS = { from: 3, share: 0.1 };   // from wave 3, about one bug in ten is a Darter or an Acid Spitter
export const ANTS = { share: 0.5 };
// Plains, from wave `from`: four more bug holes open in the basin's diagonal corners (`inset` in from its edge) and
// add `share` more bugs between them, so each gives out far fewer than a main nest.
export const CORNERS = { from: 12, share: 0.2, inset: 8 };                // on top of every wave: half as many again, in ants
