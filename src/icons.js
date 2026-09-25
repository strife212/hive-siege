// Pixel-art UI icons. Each icon is drawn on a 16x16 grid with a few primitives, given an automatic dark outline,
// and cached as a data URL. iconImg(key) returns an <img> tag that CSS scales up with nearest-neighbour filtering.
const SIZE = 16;
const PAL = {
  k: '#15171d', w: '#f4f6f8', g: '#b9c2ce', d: '#7d8898', s: '#4b5361',
  o: '#7f9144', O: '#4d5a2c', r: '#e5493b', R: '#9a2b26', y: '#ffd541', a: '#f28b26',
  b: '#55d4ff', B: '#2b7fc4', n: '#a5713f', N: '#6a4527', G: '#62d66f', p: '#a868e6', c: '#ffedb3',
};

function painter() {
  const grid = new Array(SIZE * SIZE).fill(null);
  const p = {
    px(x, y, c) { if (x >= 0 && y >= 0 && x < SIZE && y < SIZE) grid[y * SIZE + x] = c; return p; },
    rect(x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) p.px(x + i, y + j, c); return p; },
    line(x0, y0, x1, y1, c) {
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) || 1;
      for (let k = 0; k <= n; k++) p.px(Math.round(x0 + (x1 - x0) * k / n), Math.round(y0 + (y1 - y0) * k / n), c);
      return p;
    },
    disc(cx, cy, r, c) {
      for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r + 0.3) p.px(x, y, c);
      }
      return p;
    },
    rows(y, spans, c) { spans.forEach(([x, w], k) => p.rect(x, y + k, w, 1, c)); return p; },   // one [x, width] per row
    grid,
  };
  return p;
}

const DRAW = {
  // ---------------------------------------------------------------- buildings
  wall(p) {
    p.rect(2, 3, 12, 11, 'g').rect(2, 3, 12, 1, 'w');
    for (const y of [6, 9, 12]) p.rect(2, y, 12, 1, 's');
    for (const x of [6, 11]) { p.rect(x, 4, 1, 2, 's'); p.rect(x, 10, 1, 2, 's'); }
    for (const x of [4, 9]) { p.rect(x, 7, 1, 2, 's'); p.rect(x, 13, 1, 1, 's'); }
    p.rect(2, 5, 4, 1, 'd').rect(7, 5, 4, 1, 'd').rect(12, 5, 2, 1, 'd').rect(5, 8, 4, 1, 'd').rect(10, 8, 4, 1, 'd').rect(2, 11, 4, 1, 'd').rect(7, 11, 4, 1, 'd');
  },
  mine(p) {                                                                                         // pressure mine, armed
    p.rows(7, [[3, 10], [2, 12], [2, 12], [2, 12], [3, 10]], 'o').rect(2, 10, 12, 1, 'O').rect(3, 11, 10, 1, 'O');   // casing
    p.rows(5, [[5, 6], [4, 8], [4, 8]], 's').rect(5, 5, 6, 1, 'd').rect(4, 7, 8, 1, 'k');                          // plate
    p.rect(3, 8, 10, 1, 'O').px(12, 8, 'r').px(12, 7, 'r').px(13, 6, 'c');                                          // seam, light
    p.px(1, 3, 'a').px(2, 2, 'y').px(14, 2, 'a').px(13, 1, 'y');                                                    // sparks
  },
  hmg(p) {
    p.line(5, 13, 7, 10, 's').line(10, 13, 8, 10, 's').rect(7, 9, 2, 2, 's');       // tripod
    p.rect(3, 6, 6, 3, 'o').rect(3, 6, 6, 1, 'G').rect(2, 7, 1, 2, 'O');              // receiver + grip
    p.rect(9, 7, 5, 1, 'd').px(13, 7, 's');                                           // barrel
    p.rect(4, 9, 3, 3, 'O').px(5, 10, 'y').px(7, 9, 'y').px(8, 8, 'y');               // ammo box and belt
    p.px(14, 7, 'y').px(15, 7, 'c').px(14, 6, 'a').px(14, 8, 'a');                    // muzzle flash
  },
  turret(p) {
    p.rect(3, 12, 9, 2, 's').rect(5, 11, 5, 1, 'd');
    p.rect(3, 6, 7, 5, 'o').rect(3, 6, 7, 1, 'G').rect(3, 10, 7, 1, 'O').px(5, 8, 'k').px(6, 8, 'b');
    p.rect(10, 7, 4, 2, 'd').rect(10, 7, 4, 1, 'g').rect(13, 6, 2, 4, 's');
  },
  dual(p) {
    p.rect(2, 12, 10, 2, 's').rect(4, 11, 6, 1, 'd');
    p.rect(2, 5, 8, 6, 'o').rect(2, 5, 8, 1, 'G').rect(2, 10, 8, 1, 'O').px(4, 8, 'k').px(5, 8, 'b');
    p.rect(10, 5, 5, 2, 'd').rect(10, 5, 5, 1, 'g').rect(14, 4, 1, 4, 's');
    p.rect(10, 9, 5, 2, 'd').rect(10, 9, 5, 1, 'g').rect(14, 8, 1, 4, 's');
  },
  flame(p) {
    p.rect(2, 7, 4, 7, 'r').rect(2, 7, 1, 7, 'R').rect(3, 6, 2, 1, 's').px(4, 9, 'w');   // fuel tank
    p.rect(6, 9, 3, 2, 's').px(8, 8, 'd');
    p.disc(11.5, 8.5, 3.2, 'a').disc(11, 9, 2, 'y').px(10, 9, 'w').px(11, 9, 'c');
    p.px(13, 4, 'a').px(14, 5, 'r').px(12, 4, 'r').px(15, 8, 'r').px(14, 12, 'a').px(13, 12, 'r');
  },
  laser(p) {
    p.rect(4, 12, 8, 2, 's').rect(6, 8, 4, 4, 'd').rect(7, 8, 1, 4, 'g');
    p.rect(3, 4, 8, 4, 'w').rect(3, 7, 8, 1, 'g').rect(9, 5, 2, 2, 'B').px(10, 5, 'b');
    p.line(11, 5, 15, 1, 'b').line(12, 5, 15, 2, 'w').px(15, 0, 'b');
  },
  mortar(p) {
    p.rows(10, [[3, 10], [2, 12], [2, 12], [3, 10]], 'n').rect(2, 12, 12, 1, 'N');
    for (const x of [4, 7, 10]) p.px(x, 11, 'N').px(x + 1, 13, 'N');
    p.line(6, 10, 10, 4, 's').line(7, 10, 11, 4, 'd').line(8, 10, 12, 4, 's').px(11, 3, 'k').px(12, 3, 'k');
    p.px(13, 1, 'y').px(14, 0, 'c').px(12, 2, 'a');
  },
  missile(p) {
    p.rect(2, 10, 12, 4, 's').rect(2, 10, 12, 1, 'y');
    for (const x of [3, 6, 9, 12]) p.px(x, 10, 'k');
    p.rect(7, 3, 2, 7, 'w').px(8, 4, 'g').px(8, 6, 'g').px(8, 8, 'g');
    p.rect(7, 1, 2, 2, 'r').px(7, 0, 'r');
    p.px(6, 8, 'r').px(6, 9, 'r').px(9, 8, 'r').px(9, 9, 'r').rect(7, 6, 2, 1, 'r');
  },
  airship(p) {
    p.rows(2, [[4, 9], [2, 13], [1, 14], [1, 14], [2, 13], [4, 9]], 'g').rows(5, [[1, 14], [2, 13], [4, 9]], 'd');       // envelope, shaded belly
    p.rect(13, 3, 3, 3, 'k').px(15, 4, 's');                                                                            // dark nose cap
    for (const x of [4, 7, 10]) p.rect(x, 2, 1, 6, 's');                                                                // ring frames
    p.rect(0, 1, 2, 2, 'r').rect(0, 7, 2, 2, 'r').rect(0, 3, 1, 4, 'd');                                                // tail fins
    p.rect(6, 9, 6, 2, 's').rect(7, 9, 4, 1, 'y').px(12, 10, 'b');                                                      // gondola, lit windows
    p.px(8, 11, 'k').px(8, 12, 'o').px(8, 13, 'o').px(10, 12, 'k').px(10, 13, 'o').px(10, 14, 'o');                     // bombs away
    p.line(12, 10, 15, 12, 'y').px(3, 10, 'd').px(3, 9, 'd');
  },
  heli(p) {
    p.rect(11, 0, 2, 5, 'g').rect(11, 0, 2, 1, 'B');                                                 // tall fin, blue cap
    p.rows(3, [[4, 8], [3, 10], [3, 10], [4, 8]], 'w').rect(3, 4, 3, 2, 'k').rect(3, 6, 2, 1, 'a');  // slab hull, cockpit, amber chin
    p.rect(0, 2, 3, 1, 'B').rect(0, 3, 3, 4, 'w').rect(0, 7, 3, 1, 'a').rect(0, 8, 3, 1, 'B');       // near lift-jet nacelle
    p.rect(13, 3, 3, 1, 'B').rect(13, 4, 3, 3, 'g').rect(13, 7, 3, 1, 'a').rect(13, 8, 3, 1, 'B');   // far nacelle
    p.rect(6, 7, 4, 2, 'd').px(6, 8, 'k').px(8, 8, 'k').px(1, 9, 'b').px(14, 9, 'b').px(1, 10, 'w').px(14, 10, 'w');   // rocket pods, jet wash
    p.rect(3, 12, 10, 3, 'd').rect(3, 12, 10, 1, 'g').rect(6, 13, 1, 2, 'w').rect(9, 13, 1, 2, 'w').px(7, 13, 'w').px(8, 13, 'w');   // pad with H
  },
  apoc(p) {
    p.rect(1, 13, 14, 2, 's').rect(1, 13, 14, 1, 'd').px(2, 14, 'r').px(13, 14, 'r');                         // slab, lamps
    p.rows(8, [[4, 7], [3, 9], [3, 9], [3, 9], [2, 11]], 'd').rect(4, 8, 7, 1, 'w').rect(3, 11, 9, 1, 'a');  // turret, white roof, glowing vents
    p.line(8, 9, 14, 3, 'g').line(8, 8, 14, 2, 'g').line(8, 10, 13, 5, 's');                                   // long barrel, raised
    p.px(10, 7, 'a').px(12, 5, 'a');                                                                          // coil rings
    p.rect(13, 1, 3, 3, 'k').px(14, 2, 's').px(15, 0, 'y').px(15, 1, 'c');                                    // muzzle brake, flash
    p.rect(1, 9, 2, 3, 'y').px(1, 9, 'c').px(1, 12, 'n');                                                     // spent case
  },
  rail(p) {
    p.rect(2, 12, 9, 2, 's').rect(4, 11, 5, 1, 'd');
    p.rect(1, 5, 6, 6, 'd').rect(1, 5, 6, 1, 'g').rect(2, 7, 3, 2, 'B').px(2, 7, 'b');
    p.rect(7, 5, 8, 2, 'g').rect(7, 9, 8, 2, 'g').rect(7, 6, 8, 1, 'd').rect(7, 10, 8, 1, 'd');
    p.rect(7, 7, 8, 2, 'B').rect(8, 7, 7, 1, 'b').px(15, 7, 'w').px(15, 8, 'w');
  },
  refinery(p) {
    p.rect(2, 6, 7, 8, 'g').rect(2, 6, 7, 1, 'w').rect(2, 9, 7, 1, 'a').rect(2, 13, 7, 1, 'd').rect(8, 7, 1, 7, 'd');
    p.rect(10, 4, 3, 10, 'd').rect(10, 4, 1, 10, 'g').rect(10, 4, 3, 1, 'r').rect(10, 6, 3, 1, 'w');
    p.rect(9, 11, 1, 1, 's');
    p.px(11, 2, 'a').px(12, 1, 'y').px(11, 1, 'a').px(13, 0, 'g').px(14, 1, 'g');
    p.px(4, 11, 'y').px(5, 11, 'y').px(5, 10, 'y').px(4, 12, 'y');                 // credit glint
  },
  lab(p) {
    p.rect(6, 1, 4, 1, 'w').rect(7, 2, 2, 4, 'w').px(8, 3, 'g');
    p.rows(6, [[6, 4], [5, 6], [5, 6], [4, 8], [3, 10], [3, 10], [2, 12], [2, 12]], 'w');
    p.rows(9, [[4, 8], [3, 10], [3, 10], [2, 12], [2, 12]], 'G');
    p.px(6, 11, 'w').px(9, 10, 'w').px(10, 12, 'c').px(5, 9, 'c').px(8, 7, 'G').px(7, 5, 'G');
  },
  uplink(p) {
    p.rect(3, 13, 10, 3, 'g').rect(3, 13, 10, 1, 'w').px(5, 14, 'b').px(7, 14, 'b').px(10, 14, 'y');          // equipment hall
    const bands = ['r', 'r', 'w', 'w', 'r', 'r', 'w', 'w', 'r', 'r', 'w', 'w'];                                  // banded lattice mast
    for (let y = 1; y <= 12; y++) { const w = y < 5 ? 2 : y < 9 ? 4 : 6; p.rect(8 - w / 2, y, w, 1, bands[y - 1]); }
    p.px(7, 6, 's').px(8, 7, 's').px(8, 6, 's').px(7, 7, 's');                                                   // bracing
    p.px(6, 9, 's').px(7, 10, 's').px(8, 11, 's').px(9, 12, 's').px(9, 9, 's').px(8, 10, 's').px(7, 11, 's').px(6, 12, 's');
    p.rect(7, 0, 2, 1, 'r');                                                                                      // beacon
    p.rows(3, [[1, 2], [0, 3], [0, 3], [1, 2]], 'w').px(2, 4, 'g').line(3, 5, 6, 5, 's');                         // dish, left
    p.rows(6, [[13, 2], [13, 3], [13, 3], [13, 2]], 'w').px(13, 7, 'g').line(10, 8, 12, 8, 's');                  // dish, right
    p.rows(10, [[12, 3], [11, 4]], 'd').px(12, 10, 'w').px(13, 10, 'w');                                         // roof uplink dish
  },
  // ---------------------------------------------------------------- research
  plating(p) {
    p.rows(2, [[3, 10], [3, 10], [3, 10], [3, 10], [3, 10], [3, 10], [4, 8], [4, 8], [5, 6], [6, 4], [7, 2]], 'd');
    p.rows(3, [[4, 8], [4, 8], [4, 8], [4, 8], [4, 8], [5, 6], [5, 6], [6, 4], [7, 2]], 'g');
    p.rect(7, 3, 2, 8, 'w').rect(5, 5, 6, 2, 'w');
    for (const [x, y] of [[4, 3], [11, 3]]) p.px(x, y, 's');
  },
  optics(p) {
    p.disc(7.5, 7.5, 6, 's').disc(7.5, 7.5, 5, 'B').disc(7.5, 7.5, 3, 'b').px(6, 6, 'w').px(5, 6, 'w').px(6, 5, 'w');
    p.rect(7, 1, 2, 2, 'r').rect(7, 13, 2, 2, 'r').rect(1, 7, 2, 2, 'r').rect(13, 7, 2, 2, 'r');
  },
  he(p) {
    p.disc(7.5, 7.5, 5, 'a').disc(7.5, 7.5, 3.2, 'y').disc(7.5, 7.5, 1.2, 'w');
    for (const [x, y] of [[7, 0], [8, 1], [14, 7], [15, 8], [7, 15], [8, 14], [0, 7], [1, 8], [2, 2], [13, 2], [2, 13], [13, 13], [3, 3], [12, 12], [12, 3], [3, 12]]) p.px(x, y, 'r');
  },
  composite(p) {                                                                                  // laminated shield
    p.rows(2, [[2, 12], [2, 12], [2, 12], [2, 12], [2, 12], [2, 12], [3, 10], [3, 10], [4, 8], [5, 6], [6, 4], [7, 2]], 'B');
    p.rows(3, [[3, 10], [3, 10], [3, 10], [3, 10], [3, 10], [4, 8], [4, 8], [5, 6], [6, 4], [7, 2]], 'g');
    p.rect(3, 5, 10, 1, 'd').rect(3, 8, 10, 1, 'd').rect(6, 11, 4, 1, 'd').rect(4, 3, 4, 1, 'w').rect(4, 6, 3, 1, 'w');
  },
  fireControl(p) {                                                                                // reticle
    p.disc(7.5, 7.5, 6.2, 'G').disc(7.5, 7.5, 4.9, null);
    p.rect(7, 0, 2, 5, 'G').rect(7, 11, 2, 5, 'G').rect(0, 7, 5, 2, 'G').rect(11, 7, 5, 2, 'G');
    p.rect(7, 7, 2, 2, 'r');
  },
  orbital(p) {                                                                                    // satellite, fast chevrons
    p.rect(0, 3, 5, 3, 'B').rect(11, 3, 5, 3, 'B').px(1, 4, 'b').px(3, 4, 'b').px(12, 4, 'b').px(14, 4, 'b');
    p.rect(5, 4, 6, 1, 's').rect(6, 1, 4, 6, 'g').rect(6, 1, 4, 1, 'w').px(7, 3, 'b').px(8, 3, 'b');
    p.line(4, 9, 7, 11, 'y').line(11, 9, 8, 11, 'y').line(4, 12, 7, 14, 'a').line(11, 12, 8, 14, 'a');
  },
  hmgFeed(p) {                                                                                    // linked cartridges
    p.line(4, 0, 6, 1, 'w').line(6, 1, 4, 2, 'w').line(9, 0, 11, 1, 'w').line(11, 1, 9, 2, 'w');
    for (const x of [1, 5, 9, 13]) p.px(x, 4, 'n').rect(x, 5, 2, 2, 'n').rect(x, 7, 2, 6, 'y').rect(x + 1, 7, 1, 6, 'a');
    p.rect(0, 10, 16, 1, 's');
  },
  overpen(p) {                                                                                    // one round, two bugs
    p.disc(5.5, 8.5, 2.6, 'p').disc(11.5, 8.5, 2.6, 'p').px(4, 7, 'G').px(10, 7, 'G');
    p.rect(0, 8, 14, 1, 'y').rect(0, 9, 3, 1, 'a').rect(13, 7, 3, 3, 'n').px(15, 8, 'y');
    p.px(8, 5, 'G').px(8, 12, 'G').px(14, 12, 'G');
  },
  autoloader(p) {                                                                                 // shell in a reload loop
    p.rect(7, 1, 2, 2, 'd').rect(6, 3, 4, 3, 'd').rect(6, 6, 4, 8, 'y').rect(9, 6, 1, 8, 'a').rect(6, 13, 4, 1, 'a');
    p.line(3, 3, 2, 5, 'G').rect(2, 5, 1, 6, 'G').line(2, 11, 3, 13, 'G').px(4, 2, 'G').px(3, 1, 'G').px(4, 4, 'G');
    p.line(12, 3, 13, 5, 'G').rect(13, 5, 1, 6, 'G').line(13, 11, 12, 13, 'G').px(11, 14, 'G').px(12, 15, 'G').px(11, 12, 'G');
  },
  sabot(p) {                                                                                      // dart shedding its petals
    p.px(7, 0, 'g').px(8, 0, 'g').rect(7, 1, 2, 11, 'g').rect(7, 1, 1, 11, 'w');
    p.rect(5, 12, 6, 1, 'd').rect(6, 13, 4, 2, 'd');
    p.line(4, 4, 3, 9, 'o').line(5, 5, 4, 10, 'O').line(11, 4, 12, 9, 'o').line(10, 5, 11, 10, 'O');
  },
  du(p) {                                                                                         // two heavy shells
    for (const x of [2, 10]) p.px(x + 1, 1, 'G').rect(x, 2, 3, 4, 's').rect(x, 6, 3, 8, 'y').rect(x + 2, 6, 1, 8, 'a').rect(x, 13, 3, 1, 'a');
    p.px(7, 4, 'G').px(8, 7, 'G').px(7, 10, 'G');
  },
  tanks(p) {                                                                                      // twin pressure tanks, gauge
    for (const x of [1, 10]) p.rows(4, [[x + 1, 3], [x, 5]], 'r').rect(x, 6, 5, 9, 'r').rect(x + 3, 6, 2, 9, 'R').rect(x, 9, 5, 1, 'y');
    p.rect(3, 2, 10, 1, 'd').rect(3, 3, 1, 1, 'd').rect(12, 3, 1, 1, 'd');
    p.disc(7.5, 3.5, 2.2, 'w').line(7, 4, 9, 2, 'r');
  },
  napalm(p) {                                                                                     // clinging fire, spatter
    p.rows(2, [[7, 1], [7, 2], [6, 3], [6, 4], [5, 5], [4, 7], [4, 8], [3, 9], [3, 10], [3, 10], [4, 8], [5, 6]], 'a');
    p.rows(7, [[7, 2], [6, 3], [6, 4], [5, 5], [6, 4], [7, 2]], 'y');
    p.rect(3, 14, 10, 1, 'R').px(1, 6, 'a').px(14, 8, 'a').px(12, 4, 'a').px(1, 12, 'r').px(14, 13, 'r');
  },
  focus(p) {                                                                                      // lens pulling beams to a point
    p.rect(0, 4, 4, 1, 'b').rect(0, 7, 4, 2, 'b').rect(0, 11, 4, 1, 'b');
    p.rect(5, 2, 2, 12, 'B').rect(4, 4, 1, 8, 'B').rect(7, 4, 1, 8, 'B').rect(5, 3, 1, 3, 'b');
    p.line(8, 4, 11, 7, 'b').line(8, 11, 11, 8, 'b').rect(8, 7, 3, 2, 'b');
    p.disc(12.5, 7.5, 1.6, 'w').rect(13, 7, 3, 2, 'w');
  },
  prism(p) {                                                                                      // beam split by a prism
    p.rows(2, [[7, 2], [7, 2], [6, 4], [6, 4], [5, 6], [5, 6], [4, 8], [4, 8], [3, 10], [3, 10]], 'B');
    p.rows(4, [[7, 1], [7, 1], [6, 2], [6, 2], [5, 3], [5, 3]], 'b');
    p.line(0, 10, 4, 8, 'w').line(11, 7, 15, 4, 'b').line(12, 9, 15, 13, 'r');
  },
  crew(p) {                                                                                       // two helmeted gunners
    p.rows(1, [[10, 4], [9, 6], [9, 6]], 'O').rect(8, 4, 8, 1, 's').rect(10, 5, 4, 3, 'n').px(11, 6, 'k').px(13, 6, 'k').rect(9, 8, 6, 7, 'O');
    p.rows(4, [[2, 4], [1, 6], [1, 6]], 'o').rect(0, 7, 8, 1, 'O').rect(2, 8, 4, 3, 'c').px(3, 9, 'k').px(5, 9, 'k').rect(1, 11, 6, 5, 'o');
  },
  phosphorus(p) {                                                                                 // white-phosphorus burst
    p.disc(7.5, 5.5, 4, 'w').rect(4, 7, 8, 2, 'g').px(6, 3, 'g').px(10, 4, 'g');
    p.line(4, 9, 1, 13, 'g').line(11, 9, 14, 13, 'g').line(6, 10, 5, 14, 'g').line(9, 10, 10, 14, 'g');
    p.px(1, 14, 'a').px(14, 14, 'a').px(5, 15, 'y').px(10, 15, 'y').px(0, 13, 'y').px(15, 13, 'y');
  },
  reload(p) {                                                                                     // hot missile
    p.px(7, 0, 'r').px(8, 0, 'r').rect(6, 1, 4, 2, 'r').rect(6, 3, 4, 9, 'w').rect(9, 3, 1, 9, 'g');
    p.rect(4, 10, 2, 3, 'd').rect(10, 10, 2, 3, 'd').rect(7, 12, 2, 2, 'a').px(7, 14, 'y').px(8, 14, 'y');
    for (const x of [1, 13]) p.px(x + 1, 3, 'a').px(x, 4, 'a').px(x, 5, 'a').px(x + 1, 6, 'a').px(x + 1, 7, 'a').px(x, 8, 'a');
  },
  distrib(p) {                                                                                    // one launch, three targets
    for (const [x, y] of [[0, 1], [6, 0], [12, 1]]) p.rect(x, y, 4, 4, 'r').rect(x + 1, y + 1, 2, 2, null);
    p.line(7, 14, 3, 6, 'w').line(8, 14, 8, 5, 'w').line(8, 14, 12, 6, 'w').rect(6, 13, 4, 3, 'd');
  },
  heliMags(p) {                                                                                   // ammo can, belt on top
    for (const x of [3, 5, 7, 9, 11]) p.px(x, 1, 'n').rect(x, 2, 1, 3, 'y');
    p.rect(1, 5, 14, 2, 'o').rect(2, 7, 12, 8, 'O').rect(3, 10, 10, 1, 'y').rect(2, 7, 12, 1, 's');
  },
  hunter(p) {                                                                                     // a lock on the big bug
    p.rect(0, 0, 4, 1, 'y').rect(0, 0, 1, 4, 'y').rect(12, 0, 4, 1, 'y').rect(15, 0, 1, 4, 'y');
    p.rect(0, 15, 4, 1, 'y').rect(0, 12, 1, 4, 'y').rect(12, 15, 4, 1, 'y').rect(15, 12, 1, 4, 'y');
    p.line(3, 5, 5, 7, 's').line(12, 5, 10, 7, 's').line(3, 12, 5, 10, 's').line(12, 12, 10, 10, 's');
    p.disc(7.5, 8.5, 3.6, 'R').rect(6, 5, 4, 2, 'r').px(6, 6, 'y').px(9, 6, 'y');
  },
  deepMags(p) {                                                                                   // a full bomb rack
    for (const x of [1, 6, 11]) {
      p.rect(x, 2, 4, 1, 'd').rect(x + 1, 3, 2, 1, 'd').rect(x + 1, 4, 2, 1, 'o').rect(x, 5, 4, 7, 'o').rect(x + 1, 12, 2, 1, 'o');
      p.rect(x, 9, 4, 1, 'y').rect(x + 3, 5, 1, 7, 'O');
    }
    p.rect(0, 0, 16, 1, 's');
  },
  relay(p) {                                                                                      // the Titan, signalling down
    p.rows(1, [[4, 8], [2, 12], [1, 14], [2, 12], [4, 8]], 'g').rect(4, 1, 8, 1, 'w').rect(3, 5, 10, 1, 'd');
    p.px(0, 2, 'r').px(0, 3, 'r').rect(6, 6, 4, 1, 's');
    p.line(5, 9, 7, 10, 'b').line(8, 10, 10, 9, 'b').line(3, 11, 7, 13, 'b').line(8, 13, 12, 11, 'b');
    p.rect(7, 15, 2, 1, 'b');
  },
  supercap(p) {                                                                                   // charged capacitor
    p.rect(5, 1, 2, 2, 'd').rect(9, 1, 2, 2, 'd').rect(4, 3, 8, 1, 'g').rect(4, 4, 8, 11, 'B').rect(5, 4, 1, 11, 'b');
    p.line(10, 5, 7, 9, 'y').rect(7, 9, 3, 1, 'y').line(9, 10, 7, 13, 'y');
  },
  override(p) {                                                                                   // a hand-placed target mark
    p.disc(8, 8, 6.5, 'r').disc(8, 8, 5, null).disc(8, 8, 2.5, 'a').px(8, 8, 'c');
    p.rect(7, 0, 2, 4, 'w').rect(7, 12, 2, 4, 'w').rect(0, 7, 4, 2, 'w').rect(12, 7, 4, 2, 'w');
  },
  penetrator(p) {                                                                                 // slug through armour
    p.rect(7, 2, 3, 12, 'd').rect(7, 2, 1, 12, 'g');
    p.line(0, 14, 13, 1, 'b').line(1, 14, 14, 1, 'w').line(1, 15, 14, 2, 'g').px(15, 0, 'w');
    p.px(5, 6, 'y').px(11, 5, 'y').px(11, 10, 'y').px(4, 11, 'a').px(12, 8, 'a');
  },
  // ---------------------------------------------------------------- abilities
  ab_lance(p) {
    p.line(2, 0, 7, 11, 'B').line(13, 0, 8, 11, 'B').line(3, 0, 7, 10, 'b').line(12, 0, 8, 10, 'b');
    p.rect(7, 0, 2, 12, 'w');
    p.disc(7.5, 12.5, 2.4, 'y').rect(7, 12, 2, 2, 'w').px(3, 13, 'a').px(12, 13, 'a').px(2, 14, 'a').px(13, 14, 'a');
  },
  ab_laser(p) {
    p.rect(3, 2, 4, 3, 'g').rect(3, 2, 4, 1, 'w').px(5, 5, 's');
    p.rect(0, 3, 3, 1, 'B').rect(7, 3, 3, 1, 'B').px(1, 3, 'b').px(8, 3, 'b');
    p.line(5, 6, 12, 13, 'r').line(6, 6, 13, 13, 'a').line(6, 7, 12, 13, 'r');
    p.disc(12.5, 13, 1.6, 'y').px(14, 11, 'a').px(10, 14, 'a').px(15, 14, 'a');
  },
  ab_strafe(p) {
    p.rect(7, 1, 2, 12, 'g').px(7, 0, 'w').px(8, 0, 'w').rect(7, 3, 2, 2, 'b');
    p.rows(6, [[6, 4], [4, 8], [2, 12], [1, 14]], 'd').rect(1, 9, 14, 1, 's');
    p.rows(12, [[5, 6], [4, 8]], 'd');
    p.px(3, 10, 'r').px(12, 10, 'r').px(3, 11, 'a').px(12, 11, 'a');
    p.px(7, 14, 'a').px(8, 14, 'a').px(7, 15, 'y').px(8, 15, 'y');
  },
  ab_artillery(p) {
    p.rect(5, 1, 1, 3, 's').rect(10, 1, 1, 3, 's').rect(6, 2, 4, 2, 's').rect(7, 0, 2, 2, 'd');       // fins
    p.rect(5, 4, 6, 7, 'o').rect(5, 4, 1, 7, 'G').rect(10, 4, 1, 7, 'O').rect(5, 6, 6, 1, 'y');
    p.rows(11, [[6, 4], [6, 4], [7, 2], [7, 2]], 'O').px(7, 14, 'r').px(8, 14, 'r');
    p.px(2, 3, 'g').px(2, 5, 'g').px(13, 2, 'g').px(13, 4, 'g').px(13, 6, 'g').px(2, 7, 'g');
  },
  ab_archangel(p) {
    p.rect(5, 0, 6, 1, 'y').px(4, 1, 'y').px(11, 1, 'y').rect(5, 2, 6, 1, 'y');                                // halo
    p.rect(6, 3, 4, 10, 'c').rect(7, 3, 2, 10, 'w');                                                            // the lance
    p.line(5, 5, 1, 3, 'y').line(5, 7, 0, 6, 'y').line(5, 9, 1, 9, 'a').line(10, 5, 14, 3, 'y').line(10, 7, 15, 6, 'y').line(10, 9, 14, 9, 'a');   // wings of light
    p.rows(13, [[3, 10], [1, 14]], 'y').rect(5, 13, 6, 1, 'w').px(0, 15, 'a').px(15, 15, 'a').rect(6, 15, 4, 1, 'w');   // detonation
  },
  ab_bomber(p) {
    p.rect(7, 0, 2, 12, 'w').px(7, 0, 'k').px(8, 0, 'k').rect(7, 2, 2, 1, 'b');                              // long neck, cockpit
    p.rect(5, 3, 6, 1, 'g');                                                                                 // canards
    p.rows(6, [[6, 4], [5, 6], [4, 8], [3, 10], [2, 12], [1, 14], [1, 14]], 'w').rect(1, 12, 3, 1, 'd').rect(12, 12, 3, 1, 'd');
    p.rect(5, 9, 6, 4, 'g').rect(5, 13, 6, 1, 's');                                                          // nacelle
    for (const x of [5, 7, 9]) p.px(x, 14, 'a').px(x + 1, 14, 'y');
    p.px(4, 15, 'k').px(11, 15, 'k').rect(6, 15, 1, 1, 'r').rect(9, 15, 1, 1, 'r');
  },
  ab_troopers(p) {
    p.rows(2, [[5, 6], [4, 8], [3, 10], [3, 10], [3, 10]], 'B').rows(3, [[5, 5], [4, 6], [4, 3]], 'b');     // helmet dome
    p.rect(7, 0, 2, 5, 'y').px(7, 0, 'c');                                                                   // crest
    p.rect(3, 7, 10, 2, 'k').rect(4, 7, 3, 2, 'G').rect(9, 7, 3, 2, 'G').px(4, 7, 'w').px(9, 7, 'w');         // visor
    p.rows(9, [[3, 10], [4, 8]], 'B').rect(6, 11, 4, 3, 'g').px(7, 12, 's').px(8, 12, 's').rect(6, 13, 4, 1, 'd');
    p.rect(1, 10, 3, 4, 'B').rect(12, 10, 3, 4, 'B').rect(1, 10, 3, 1, 'y').rect(12, 10, 3, 1, 'y');          // pauldrons
  },
  ab_strategic(p) {
    p.disc(7.5, 12.5, 6.4, 'B').disc(7.5, 12.5, 5.4, 'b').rect(3, 10, 3, 2, 'G').rect(8, 9, 4, 2, 'G').rect(6, 12, 3, 2, 'G');     // the world, going under
    p.rect(0, 14, 16, 2, null);
    p.line(12, 0, 8, 6, 'a').line(13, 1, 9, 7, 'y').px(14, 0, 'r');                                                         // exhaust streak
    p.rect(6, 3, 3, 5, 'w').rect(6, 5, 3, 1, 'k').rect(7, 8, 1, 2, 'r').px(6, 8, 'r').px(8, 8, 'r').px(5, 3, 'd').px(9, 3, 'd');   // the ICBM, nose down
    p.px(7, 10, 'y');
  },
  ab_blackhole(p) {
    p.disc(7.5, 9.5, 6.4, 'B').disc(7.5, 9.5, 5.6, 'b').disc(7.5, 9.5, 4.6, 'p');                                  // accretion disk, blue rim to violet
    p.disc(7.5, 9.5, 3.1, 'k');                                                                                     // the horizon
    p.px(4, 7, 'w').px(5, 6, 'w').px(6, 6, 'c').px(3, 9, 'c').px(11, 12, 'c').px(10, 13, 'w').px(9, 13, 'c');   // photon ring glints
    p.rect(11, 0, 2, 4, 'g').px(11, 0, 'r').px(12, 0, 'r').px(10, 3, 'd').px(13, 3, 'd').px(11, 4, 'p').px(12, 4, 'p');   // the bomb coming down
  },
  ab_nuke(p) {
    p.disc(7.5, 7.5, 7, 'y').disc(7.5, 7.5, 6, 'a').disc(7.5, 7.5, 5.4, 'y');
    p.disc(7.5, 7.5, 1.2, 'k');
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {                                     // trefoil blades
      const dx = x - 7.5, dy = 7.5 - y, r = Math.hypot(dx, dy);
      if (r < 2.4 || r > 5.7) continue;
      const deg = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
      if ([30, 150, 270].some((c) => Math.abs(((deg - c + 540) % 360) - 180) <= 30)) p.px(x, y, 'k');
    }
  },
  // ---------------------------------------------------------------- misc
  sound_on(p) {
    p.rect(2, 6, 3, 4, 'g').rows(4, [[7, 1], [6, 2], [5, 3], [5, 3], [5, 3], [5, 3], [6, 2], [7, 1]], 'w');
    p.px(10, 6, 'b').px(10, 9, 'b').rect(11, 7, 1, 2, 'b').px(12, 4, 'b').px(12, 11, 'b').rect(13, 5, 1, 6, 'b');
  },
  sound_off(p) {
    p.rect(2, 6, 3, 4, 'd').rows(4, [[7, 1], [6, 2], [5, 3], [5, 3], [5, 3], [5, 3], [6, 2], [7, 1]], 'g');
    p.line(10, 5, 14, 10, 'r').line(14, 5, 10, 10, 'r');
  },
};

const cache = {};
export function iconURL(key) {
  if (cache[key]) return cache[key];
  const draw = DRAW[key];
  if (!draw) return '';
  const p = painter();
  draw(p);
  const g = p.grid, out = g.slice();
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {            // outline: empty pixels touching a filled one
    if (g[y * SIZE + x]) continue;
    const near = (x > 0 && g[y * SIZE + x - 1]) || (x < SIZE - 1 && g[y * SIZE + x + 1]) || (y > 0 && g[(y - 1) * SIZE + x]) || (y < SIZE - 1 && g[(y + 1) * SIZE + x]);
    if (near) out[y * SIZE + x] = 'k';
  }
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const ctx = c.getContext('2d');
  out.forEach((ch, i) => { if (ch) { ctx.fillStyle = PAL[ch]; ctx.fillRect(i % SIZE, Math.floor(i / SIZE), 1, 1); } });
  return (cache[key] = c.toDataURL());
}

export const iconImg = (key, px = 32) => `<img class="pxicon" src="${iconURL(key)}" width="${px}" height="${px}" alt="" draggable="false">`;
export const ICON_KEYS = Object.keys(DRAW);
