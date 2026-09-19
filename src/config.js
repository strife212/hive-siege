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
  hmg: {
    name: 'HMG Turret', cost: 70, hp: 170, cat: 'DEFENSE',
    kind: 'tracer', range: 11, damage: 3.5, rate: 10, turn: 5,
    desc: 'Heavy machine gun. Hoses down bugs with a stream of low-damage rounds.',
  },
  turret: {
    name: 'Autocannon', cost: 100, hp: 200, cat: 'DEFENSE',
    kind: 'projectile', range: 13, damage: 16, rate: 2.2, turn: 3.6,
    desc: 'Single-barrel autocannon firing guided shells. Reliable all-rounder.',
  },
  dual: {
    name: 'Dual Autocannon', cost: 190, hp: 240, cat: 'DEFENSE',
    kind: 'projectile', range: 13, damage: 16, rate: 2.2, turn: 3,
    desc: 'Twin-barrel autocannon. Fires two shells per salvo for double the firepower.',
  },
  flame: {
    name: 'Flamethrower', cost: 120, hp: 190, cat: 'DEFENSE',
    kind: 'flame', range: 7.5, damage: 14, burn: 3, cone: 24, turn: 3,
    desc: 'Short-range fire stream. Sets every bug in the cone burning for 3 s (damage over time, stacks by refreshing).',
  },
  laser: {
    name: 'Laser Tower', cost: 175, hp: 160, cat: 'DEFENSE',
    kind: 'hitscan', range: 15, damage: 4.5, rate: 9, turn: 2.6, requires: 'lab',
    desc: 'Hitscan beam. Instant hits, no travel time. Requires a Research Lab.',
  },
  mortar: {
    name: 'Mortar Pit', cost: 220, hp: 320, cat: 'DEFENSE', size: [2, 2],
    kind: 'mortar', range: 26, minRange: 8, damage: 55, splash: 3, rate: 0.4, turn: 1.6,
    desc: 'Indirect fire over walls. Long range, big splash, but cannot hit anything closer than 8.',
  },
  missile: {
    name: 'Missile Silo', cost: 260, hp: 350, cat: 'DEFENSE', size: [2, 2],
    kind: 'missile', range: 25, damage: 30, splash: 2.2, salvo: 6, interval: 6,
    desc: 'Every 6 s the hatches open and six homing rockets corkscrew into the densest cluster of bugs.',
  },
  heli: {
    name: 'Gunship Pad', cost: 420, hp: 380, cat: 'DEFENSE', size: [2, 2],
    kind: 'heli', range: 48, damage: 4, rate: 14, rounds: 100, rockets: 10, rocketDamage: 42, splash: 2.4, rearm: 5,
    desc: 'A heavy VTOL gunship lifts off to hunt the nearest bugs with 100 gatling rounds and 10 rockets, then returns to the pad for 5 s to rearm.',
  },
  airship: {
    name: 'Titan Airship Pad', cost: 1000, hp: 600, cat: 'DEFENSE', size: [2, 3], limit: 1,
    kind: 'airship', range: 52, rearm: 8,
    damage: 4, gatRate: 14, gatRounds: 500,                       // two gatling cannons
    hmgDamage: 3, hmgRate: 8, hmgRounds: 250,                     // two HMGs
    shells: 25, artRate: 0.5, artDamage: 95, artSplash: 4.6,      // belly howitzer
    bombs: 30, bombRate: 2.2, bombDamage: 120, bombSplash: 4,     // bomb bay, straight down
    desc: 'Titan Support Airship: twin gatlings (500 rds each), twin HMGs (250 each), a 25-shell howitzer and 30 bombs. Rearms on its pad for 8 s. Only one can be built.',
  },
  rail: {
    name: 'Railgun Battery', cost: 300, hp: 300, cat: 'DEFENSE', size: [2, 2], requires: 'lab',
    kind: 'rail', range: 40, damage: 400, charge: 3, turn: 1.3,
    desc: 'Charges for 3 s then fires a bolt that pierces every bug in a line. Requires a Research Lab.',
  },
  refinery: {
    name: 'Refinery', cost: 150, hp: 260, cat: 'ECONOMY',
    income: 3,
    desc: 'Extracts credits from the crust: +3 credits / second.',
  },
  lab: {
    name: 'Research Lab', cost: 200, hp: 220, cat: 'ECONOMY',
    desc: 'Unlocks the Laser Tower and the TECH tab upgrades.',
  },
};

export const RESEARCH = {
  plating: { name: 'Reinforced Plating', cost: 150, desc: 'Walls get +100% HP. Applies to existing walls too.' },
  optics:  { name: 'Overcharged Optics', cost: 200, desc: 'Laser Towers deal +50% damage.' },
  he:      { name: 'HE Rounds',          cost: 200, desc: 'Autocannon shells explode, damaging nearby bugs.' },
};

export const BOSS_EVERY = 10;                 // a Colossus joins every tenth wave
export const ENEMIES = {
  colossus: {
    name: 'Colossus', boss: true, hp: 5200, speed: 1.75, damage: 90, attackRate: 0.55, reward: 600, scale: 3,
  },
  skitter: {
    name: 'Skitterer', hpCapWave: 5, hp: 45, speed: 4.8, damage: 6, attackRate: 1.3, reward: 10, scale: 0.7,
    color: 0x5b2f70, plate: 0x2a1538, legColor: 0x2a1535, accent: 0x9be04a, eye: 0xff3020, spikes: false, legR: 1,
  },
  brute: {
    name: 'Brute', hpCapWave: 10, hp: 280, speed: 2.4, damage: 24, attackRate: 0.7, reward: 45, scale: 1.5,
    color: 0x5a2430, plate: 0x2b1016, legColor: 0x24101a, accent: 0xd9c9a8, eye: 0xff7a20, spikes: true, legR: 1.7,
  },
};
