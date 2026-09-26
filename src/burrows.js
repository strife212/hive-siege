import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { heightAt, cutDisc, groundMaterial, groundShade, sampleTerrain } from './terrain.js';
import { puff } from './particles.js';
import { audio } from './audio.js';
import { state, burst } from './game.js';

// Bug holes: where a wave's bugs come up. When a wave is called each nest erupts out of the ground: a crater of churned
// dirt with a dark resin crest, curved chitin spikes and glowing egg sacs round a hole going down into the dark, with
// a faint glow far below. Bugs climb up out of it (game.js), hive haze drifts up while it is open, and once the wave is
// cleared the hole caves in and the crater sinks back into the ground.
//
// The hole is real: the ground is cut away inside PIT_R (the terrain's opening mask, as for the silos) and a shaft
// goes down under it, darkening with depth. The crater's inner slope runs down into the shaft, which hides the stepped
// edge of the cut. Crater and shaft are drawn with the terrain's own material (groundMaterial), so they have its soil,
// rock and moss textures, normal maps and rain: the crater starts from the ground's own texture mix and shade at its
// foot, turns to churned soil up the slope and to rock down the shaft, darkening as it goes. Everything is draped over
// the terrain round the nest (built in the hole's own frame, origin on the ground at its centre) and kept low, so bugs
// walking out do not wade through it.
const OPEN_T = 0.9, CLOSE_T = 1.3;
export const PIT_R = 1.5;                                    // the opening in the ground
export const PIT_DEPTH = 3.2;                                // bugs start their climb this far down (game.js)
const holes = [];

const col = (hex) => new THREE.Color(hex);
const M = {
  glow: new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
  chitin: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.1 }),
  sac: new THREE.MeshStandardMaterial({ color: 0x9be04a, emissive: 0x7bd02a, emissiveIntensity: 1.4, roughness: 0.35 }),     // shared: they all pulse together
};

// A ring surface draped over the ground, from the outside in, one ring of vertices per profile row; lump(angle, ring)
// = [dr, dh] roughens it (periodic in the angle, so the seam closes). Rows are [radius, height, color] for a plain
// mesh, or, with ground set, [radius, height, shade, blend, mix] for one drawn with groundMaterial: its vertex shade is
// the ground's own times shade (a number, or [r, g, b] to tint), and its texture weights go from the ground's own at
// that spot (blend 0) to mix ([soil, rock, moss], blend 1). mottle varies the shade from vertex to vertex.
const hash = (k, i) => { const v = Math.sin(k * 12.9898 + i * 78.233) * 43758.5453; return v - Math.floor(v); };
function drape(x, z, g, profile, seg, lump = () => [0, 0], { ground = false, mottle = 0 } = {}) {
  const pos = [], cols = [], splat = [], idx = [];
  profile.forEach((row, k) => {
    const [r0, h0] = row;
    for (let s = 0; s <= seg; s++) {
      const a = (s / seg) * Math.PI * 2, [dr, dh] = lump(a, k), r = r0 + dr;
      const px = Math.cos(a) * r, pz = Math.sin(a) * r, wx = x + px, wz = z + pz;
      pos.push(px, heightAt(wx, wz) - g + h0 + dh, pz);
      if (!ground) { cols.push(row[2].r, row[2].g, row[2].b); continue; }
      const [, , shade, blend, mix] = row, t = [].concat(shade);
      const j = 1 + (hash(k, s % seg) * 2 - 1) * mottle;     // s % seg: the seam repeats the first vertex's shade
      const base = groundShade(wx, wz);
      cols.push(base[0] * t[0] * j, base[1] * (t[1] ?? t[0]) * j, base[2] * (t[2] ?? t[0]) * j);
      const own = blend < 1 ? sampleTerrain(wx, wz) : null;
      splat.push(...[own?.soil, own?.rock, own?.moss].map((v, n) => (own ? v * (1 - blend) : 0) + mix[n] * blend));
    }
  });
  for (let k = 0; k < profile.length - 1; k++) for (let s = 0; s < seg; s++) {
    const a = k * (seg + 1) + s, b = a + seg + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  if (ground) geo.setAttribute('splat', new THREE.Float32BufferAttribute(splat, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}
const SOIL = [0.85, 0.15, 0], CREST = [0.6, 0.4, 0], INNER = [0.3, 0.7, 0], ROCK = [0.1, 0.9, 0];   // soil, rock, moss

function build(x, z) {
  const g = heightAt(x, z), rnd = (a, b) => a + Math.random() * (b - a);
  const ph = [rnd(0, 6.3), rnd(0, 6.3), rnd(0, 6.3)];
  const n = (a) => 0.5 * Math.sin(3 * a + ph[0]) + 0.3 * Math.sin(5 * a + ph[1]) + 0.2 * Math.sin(9 * a + ph[2]);
  const crestH = (a) => 0.46 + n(a) * 0.16;
  const group = new THREE.Group();
  const add = (geo, mat, shadow) => { const m = new THREE.Mesh(geo, mat); m.castShadow = shadow; m.receiveShadow = true; group.add(m); return m; };

  // the crater: churned soil outside, a dark resin crest, and the inner slope, which stays above the ground across the
  // whole band where the stepped edge of the cut can fall (PIT_R give or take a mask cell) and only then drops away
  // into the shaft, so no uncut ground shows through and no cut shows past it
  const mouth = PIT_R - 0.32;
  add(drape(x, z, g, [
    [4.0, -0.35, 1, 0, SOIL], [3.5, 0.02, 1, 0.1, SOIL], [3.05, 0.2, 0.95, 0.6, SOIL],
    [2.6, 0.46, [0.92, 0.82, 0.88], 1, CREST], [2.2, 0.38, [0.66, 0.56, 0.62], 1, CREST],                  // a resin-stained crest
    [1.85, 0.22, 0.42, 1, INNER], [PIT_R + 0.05, 0.12, 0.28, 1, INNER], [mouth + 0.12, 0.05, 0.18, 1, INNER], [mouth, -0.32, 0.1, 1, INNER],
  ], 48, (a, k) => (k === 3 || k === 4 ? [n(a) * 0.15, n(a) * 0.16] : k === 2 || k === 5 ? [n(a) * 0.1, n(a) * 0.06] : [0, 0]),
  { ground: true, mottle: 0.1 }), groundMaterial, true);
  // the shaft: rough rock walls narrowing as they go down, black at the bottom
  const wall = (a, k) => [k > 0 && k < 5 ? 0.07 * Math.sin(7 * a + k * 1.7 + ph[1]) + 0.05 * Math.sin(13 * a + ph[2]) : 0, 0];
  add(drape(x, z, g, [
    [mouth, -0.32, 0.1, 1, INNER], [mouth - 0.03, -1.0, 0.06, 1, ROCK], [1.0, -2.0, 0.03, 1, ROCK],
    [0.8, -2.9, 0.015, 1, ROCK], [0.45, -3.5, 0.007, 1, ROCK], [0, -3.7, 0.004, 1, ROCK],
  ], 32, wall, { ground: true, mottle: 0.25 }), groundMaterial, false);
  // the glow far down in it
  add(drape(x, z, g, [[1.0, -3.4, col(0x000000)], [0.5, -3.5, col(0x14260a)], [0, -3.55, col(0x3a6a14)]], 24), M.glow, false);

  // chitin spikes curling out of the crest, dark at the root and bone-pale at the tip
  const spikes = [], sacs = [];
  const nSpike = 7, base = rnd(0, 6.3);
  for (let k = 0; k < nSpike; k++) {
    const a = base + (k / nSpike) * Math.PI * 2 + rnd(-0.25, 0.25), r = rnd(2.45, 2.75), len = rnd(1.0, 1.5);
    const geo = new THREE.ConeGeometry(rnd(0.16, 0.22), len, 6).translate(0, len / 2, 0);
    const p = geo.attributes.position, c = [];
    const root = col(0x4a1c26), tip = col(0xf0e2c0), t = new THREE.Color();
    // clamped: rounding leaves the base ring a hair below 0, and pow() of a negative is NaN, which the bloom then
    // smears across the whole screen
    for (let v = 0; v < p.count; v++) { t.copy(root).lerp(tip, Math.pow(Math.min(1, Math.max(0, p.getY(v) / len)), 1.2)); c.push(t.r, t.g, t.b); }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
    geo.rotateZ(-rnd(0.45, 0.85)).rotateY(-a);              // lean out, then face away from the pit
    const px = Math.cos(a) * r, pz = Math.sin(a) * r;
    spikes.push(geo.translate(px, heightAt(x + px, z + pz) - g + crestH(a) - 0.15, pz));
    // an egg sac or two between the spikes
    if (k % 2 === 0 || Math.random() < 0.4) {
      const b = a + Math.PI / nSpike, s = rnd(0.7, 1.2), rr = rnd(2.3, 2.6);
      const qx = Math.cos(b) * rr, qz = Math.sin(b) * rr;
      sacs.push(new THREE.SphereGeometry(0.2, 10, 8).scale(s, s * 0.75, s)
        .translate(qx, heightAt(x + qx, z + qz) - g + crestH(b) - 0.02, qz));
    }
  }
  add(mergeGeometries(spikes), M.chitin, true);
  add(mergeGeometries(sacs), M.sac, false);

  group.position.set(x, g, z);
  return { group, x, z, y: g };
}

const easeOutBack = (u) => 1 + 2.70158 * (u - 1) ** 3 + 1.70158 * (u - 1) ** 2;

export const burrows = {
  // A nest erupts at (x, z).
  open(x, z) {
    const h = build(x, z);
    h.t = 0; h.haze = 0.5; h.closing = false;
    h.group.scale.set(1, 0.02, 1);                          // grows up and down only: the shaft always meets the cut
    cutDisc(x, z, PIT_R, true);
    h.cut = true;
    state.scene.add(h.group);
    holes.push(h);
    burst(x, h.y + 0.3, z, 'soil', 22, 7);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + Math.random() * 0.5, sp = 2.5 + Math.random() * 1.5;
      puff(x + Math.cos(a) * 1.5, h.y + 0.4, z + Math.sin(a) * 1.5, { color: 0x8a6a48, size: 1.6, grow: 2, life: 1.3, opacity: 0.5, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: 1, drag: 2 });
    }
    audio.play('explosion', { x, z, size: 1.3, vol: 0.4 });
    state.shake += 0.06;
  },
  // The wave is over: every open hole sinks back into the ground.
  closeAll() {
    for (const h of holes) {
      if (h.closing) continue;
      h.closing = true;
      h.t = 0;
      if (h.cut) { cutDisc(h.x, h.z, PIT_R, false); h.cut = false; }   // it caves in, then the crater settles
      burst(h.x, h.y + 0.3, h.z, 'soil', 10, 4);
      for (let k = 0; k < 5; k++) {
        const a = Math.random() * Math.PI * 2;
        puff(h.x + Math.cos(a) * 2, h.y + 0.3, h.z + Math.sin(a) * 2, { color: 0x8a6a48, size: 1.4, grow: 1.6, life: 1.2, opacity: 0.4, vy: 0.6, drag: 2 });
      }
    }
  },
  update(dt, time) {
    M.sac.emissiveIntensity = 1.1 + 0.6 * Math.sin(time * 3.2);
    M.glow.opacity = 0.75 + 0.25 * Math.sin(time * 2.1);
    for (let k = holes.length - 1; k >= 0; k--) {
      const h = holes[k], G = h.group;
      h.t += dt;
      if (h.closing) {
        const u = Math.min(1, h.t / CLOSE_T), e = u * u;
        G.position.y = h.y - 0.9 * e;
        G.scale.set(1 - 0.25 * e, Math.max(0.02, 1 - 0.8 * e), 1 - 0.25 * e);
        if (u >= 1) {
          state.scene.remove(G);
          G.traverse((o) => o.geometry?.dispose());
          holes.splice(k, 1);
        }
        continue;
      }
      const u = Math.min(1, h.t / OPEN_T), b = easeOutBack(u);
      G.scale.set(1, Math.max(0.02, b), 1);
      G.position.y = h.y - 0.4 * (1 - u);
      if (u >= 1 && (h.haze -= dt) <= 0) {                   // hive breath drifting out of the pit
        h.haze = 0.35 + Math.random() * 0.2;
        const a = Math.random() * Math.PI * 2, r = Math.random() * 0.9;
        puff(h.x + Math.cos(a) * r, h.y - 0.5, h.z + Math.sin(a) * r, { color: 0x5a7a3a, size: 1.2, grow: 2, life: 1.8, opacity: 0.16, vy: 1.2, drag: 1 });
      }
    }
  },
};
