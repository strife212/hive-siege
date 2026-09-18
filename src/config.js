export const MAP_SIZE = 80;
export const HALF = MAP_SIZE / 2;
export const CELL = 2;
export const CELLS = MAP_SIZE / CELL;
export const START_CREDITS = 450;
export const MAX_SLOPE = 1.6;

export const BUILDINGS = {
  wall: {
    name: 'Wall', cost: 25, hp: 320, cat: 'STRUCTURES', icon: '🧱',
    desc: 'Cheap barrier. Bugs have to chew through it to reach the Core.',
  },
  turret: {
    name: 'Gun Turret', cost: 100, hp: 200, cat: 'DEFENSE', icon: '🔫',
    kind: 'projectile', range: 13, damage: 16, rate: 2.2,
    desc: 'Autocannon that fires guided shells. Reliable all-rounder.',
  },
  laser: {
    name: 'Laser Tower', cost: 175, hp: 160, cat: 'DEFENSE', icon: '🔆',
    kind: 'hitscan', range: 15, damage: 4.5, rate: 9, requires: 'lab',
    desc: 'Hitscan beam. Instant hits, no travel time. Requires a Research Lab.',
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
  he:      { name: 'HE Rounds',          cost: 200, icon: '💥', desc: 'Gun Turret shells explode, damaging nearby bugs.' },
};

export const ENEMIES = {
  skitter: { name: 'Skitterer', hp: 45, speed: 4.2, damage: 6, attackRate: 1.3, reward: 10, scale: 0.7, color: 0x5b2f70, legColor: 0x2a1535 },
  brute:   { name: 'Brute',     hp: 280, speed: 2.0, damage: 24, attackRate: 0.7, reward: 45, scale: 1.5, color: 0x4a1f2e, legColor: 0x24101a },
};
