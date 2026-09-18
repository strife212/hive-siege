export const MAP_SIZE = 80;
export const HALF = MAP_SIZE / 2;
export const CELL = 2;
export const CELLS = MAP_SIZE / CELL;
export const FLAT = 60;                       // half-size of the flat, walkable basin (build area is HALF)
export const SPAWN_RADIUS = FLAT - 4;         // enemy nests appear at the edge of the basin
export const START_CREDITS = 450;
export const MAX_SLOPE = 1.6;

export const BUILDINGS = {
  wall: {
    name: 'Wall', cost: 25, hp: 320, cat: 'STRUCTURES', icon: '🧱',
    desc: 'Cheap barrier. Bugs have to chew through it to reach the Core.',
  },
  hmg: {
    name: 'HMG Turret', cost: 70, hp: 170, cat: 'DEFENSE', icon: '🔫',
    kind: 'tracer', range: 11, damage: 3.5, rate: 10,
    desc: 'Heavy machine gun. Hoses down bugs with a stream of low-damage rounds.',
  },
  turret: {
    name: 'Autocannon', cost: 100, hp: 200, cat: 'DEFENSE', icon: '🎯',
    kind: 'projectile', range: 13, damage: 16, rate: 2.2,
    desc: 'Single-barrel autocannon firing guided shells. Reliable all-rounder.',
  },
  dual: {
    name: 'Dual Autocannon', cost: 190, hp: 240, cat: 'DEFENSE', icon: '⚔️',
    kind: 'projectile', range: 13, damage: 16, rate: 2.2,
    desc: 'Twin-barrel autocannon. Fires two shells per salvo for double the firepower.',
  },
  flame: {
    name: 'Flamethrower', cost: 120, hp: 190, cat: 'DEFENSE', icon: '🔥',
    kind: 'flame', range: 7.5, damage: 14, burn: 3, cone: 24,
    desc: 'Short-range fire stream. Sets every bug in the cone burning for 3 s (damage over time, stacks by refreshing).',
  },
  laser: {
    name: 'Laser Tower', cost: 175, hp: 160, cat: 'DEFENSE', icon: '🔆',
    kind: 'hitscan', range: 15, damage: 4.5, rate: 9, requires: 'lab',
    desc: 'Hitscan beam. Instant hits, no travel time. Requires a Research Lab.',
  },
  mortar: {
    name: 'Mortar Pit', cost: 220, hp: 320, cat: 'DEFENSE', icon: '🧨', size: [2, 2],
    kind: 'mortar', range: 26, minRange: 8, damage: 55, splash: 3, rate: 0.4,
    desc: 'Indirect fire over walls. Long range, big splash, but cannot hit anything closer than 8.',
  },
  missile: {
    name: 'Missile Silo', cost: 260, hp: 350, cat: 'DEFENSE', icon: '🚀', size: [2, 2],
    kind: 'missile', range: 25, damage: 30, splash: 2.2, salvo: 6, interval: 6,
    desc: 'Every 6 s the hatches open and six homing rockets corkscrew into the densest cluster of bugs.',
  },
  rail: {
    name: 'Railgun Battery', cost: 300, hp: 300, cat: 'DEFENSE', icon: '⚡', size: [2, 2], requires: 'lab',
    kind: 'rail', range: 40, damage: 400, charge: 3,
    desc: 'Charges for 3 s then fires a bolt that pierces every bug in a line. Requires a Research Lab.',
  },
  refinery: {
    name: 'Refinery', cost: 150, hp: 260, cat: 'ECONOMY', icon: '⛽',
    income: 3,
    desc: 'Extracts credits from the crust: +3 credits / second.',
  },
  lab: {
    name: 'Research Lab', cost: 200, hp: 220, cat: 'ECONOMY', icon: '🧪',
    desc: 'Unlocks the Laser Tower and the TECH tab upgrades.',
  },
};

export const RESEARCH = {
  plating: { name: 'Reinforced Plating', cost: 150, icon: '🛡️', desc: 'Walls get +100% HP. Applies to existing walls too.' },
  optics:  { name: 'Overcharged Optics', cost: 200, icon: '🔭', desc: 'Laser Towers deal +50% damage.' },
  he:      { name: 'HE Rounds',          cost: 200, icon: '💥', desc: 'Autocannon shells explode, damaging nearby bugs.' },
};

export const ENEMIES = {
  skitter: {
    name: 'Skitterer', hp: 45, speed: 4.8, damage: 6, attackRate: 1.3, reward: 10, scale: 0.7,
    color: 0x5b2f70, plate: 0x2a1538, legColor: 0x2a1535, accent: 0x9be04a, eye: 0xff3020, spikes: false, legR: 1,
  },
  brute: {
    name: 'Brute', hp: 280, speed: 2.4, damage: 24, attackRate: 0.7, reward: 45, scale: 1.5,
    color: 0x5a2430, plate: 0x2b1016, legColor: 0x24101a, accent: 0xd9c9a8, eye: 0xff7a20, spikes: true, legR: 1.7,
  },
};
