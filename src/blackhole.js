import * as THREE from 'three';
import { heightAt } from './terrain.js';
import { state, eachEnemy, damageEnemy, consumeEnemy, log } from './game.js';
import { glowTexture } from './entities.js';
import { puff } from './particles.js';
import { explode } from './effects.js';
import { spawnScar } from './decals.js';
import { audio } from './audio.js';

// Micro-Singularity Gravity Bomb. A small missile drops on the target and a singularity opens a few units above the ground: every
// bug inside the radius is torn off its feet and spirals in, taking damage all the way. Small bugs reach the horizon
// and are crushed; anything bigger is held screaming in a tight orbit (the Colossus is too big to lift: it is dragged
// across the ground toward the hole, legs scrambling). Then the hole collapses and blows, and the survivors are flung
// back to the spot each was taken from.
//
//   t < T_HIT        missile falling                 T_OPEN..T_PULL   singularity open, pulling
//   T_PULL..T_BURST  contracting, straining          T_BURST          collapse, flash, survivors flung home
const T_HIT = 1.5, T_OPEN = T_HIT + 0.45, T_PULL = T_OPEN + 4.4, T_BURST = T_PULL + 0.8, T_END = T_BURST + 2.6;
const HR = 1.25, H = 3.6;                          // horizon radius, and how high above the ground the hole hangs
const DPS = 10, BOSS_DPS = 90;                     // damage per second on everything held (up to 2.2x DPS near the horizon: a brute loses ~40%)
const SMALL = (e) => e.def.scale < 1;              // skitterers: crushed at the horizon. Brutes and the boss survive to be spat out

const rnd = (a = 0, b = 1) => a + Math.random() * (b - a);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (u) => { u = clamp01(u); return u * u * (3 - 2 * u); };
const easeOut = (u) => 1 - Math.pow(1 - clamp01(u), 3);
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------- materials / geometry
const glowMat = (color, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide });
const VIOLET = 0xa060ff;

// Accretion disk: hot inner edge fading out, spiral bands streaming inward, one side Doppler-bright.
const diskMat = () => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
  uniforms: { uTime: { value: 0 }, uAlpha: { value: 0 } },
  vertexShader: 'varying vec2 vP; void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform float uTime, uAlpha; varying vec2 vP;
    void main() {
      float r = length(vP), a = atan(vP.y, vP.x);
      float u = clamp((r - 1.0) / 2.8, 0.0, 1.0);                       // 0 at the horizon, 1 at the rim
      float spiral = a * 3.0 + u * 14.0 - uTime * 5.0;
      float bands = 0.55 + 0.45 * sin(spiral) * sin(a * 7.0 - u * 9.0 + uTime * 2.3);
      float fine = 0.8 + 0.2 * sin(a * 23.0 + u * 40.0 - uTime * 9.0);
      float doppler = 1.0 + 0.55 * sin(a - uTime * 4.0);
      float hot = pow(1.0 - u, 2.4);
      vec3 col = mix(vec3(0.16, 0.22, 1.0), vec3(0.62, 0.36, 1.0), u);   // blue rim through violet
      col = mix(col, vec3(1.0, 0.94, 1.0), hot * 0.85);                  // white-hot at the horizon
      float alpha = (hot * 1.6 + 0.18) * bands * fine * doppler * (1.0 - smoothstep(0.82, 1.0, u)) * uAlpha;
      gl_FragColor = vec4(col * alpha, alpha);
    }`,
});
// Photon ring: a shell just outside the horizon lit only at its rim.
const rimMat = () => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  uniforms: { uAlpha: { value: 0 } },
  vertexShader: 'varying vec3 vN, vV; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
  fragmentShader: `uniform float uAlpha; varying vec3 vN, vV;
    void main() { float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 3.2); vec3 col = mix(vec3(0.5, 0.3, 1.0), vec3(1.0), rim * 0.8); gl_FragColor = vec4(col * rim * uAlpha, rim * uAlpha); }`,
});
const segGeo = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true);

// Ring draped over the terrain (like the targeting reticles).
function drapedRing(cx, cz, r, w) {
  const N = 72, pos = new Float32Array((N + 1) * 2 * 3), idx = [];
  for (let i = 0; i <= N; i++) {
    const a = i / N * Math.PI * 2;
    for (let j = 0; j < 2; j++) {
      const rr = r - w + j * w, x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr, k = (i * 2 + j) * 3;
      pos[k] = x; pos[k + 1] = heightAt(x, z) + 0.14; pos[k + 2] = z;
    }
    if (i < N) { const a0 = i * 2; idx.push(a0, a0 + 2, a0 + 1, a0 + 1, a0 + 2, a0 + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

// The bomb: a stubby dark missile with glowing violet containment bands.
function makeBomb() {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x23262c, roughness: 0.45, metalness: 0.6 });
  const band = new THREE.MeshStandardMaterial({ color: 0xb080ff, emissive: 0x8040ff, emissiveIntensity: 2.6, roughness: 0.3 });
  const add = (geo, m, y) => { const o = new THREE.Mesh(geo, m); o.position.y = y; g.add(o); return o; };
  add(new THREE.CylinderGeometry(0.34, 0.38, 2.2, 14), dark, 0);
  add(new THREE.ConeGeometry(0.34, 0.9, 14), dark, 1.55);
  add(new THREE.SphereGeometry(0.44, 16, 12), dark, -0.2).scale.set(1, 0.7, 1);                        // the containment sphere amidships
  for (const y of [-0.55, 0.15, 0.7]) add(new THREE.TorusGeometry(0.39, 0.035, 6, 24).rotateX(Math.PI / 2), band, y);
  for (let k = 0; k < 4; k++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.7, 0.5), dark);
    fin.geometry.translate(0, 0, 0.3);
    fin.position.set(Math.sin(k * Math.PI / 2) * 0.35, -0.8, Math.cos(k * Math.PI / 2) * 0.35);
    fin.rotation.y = k * Math.PI / 2;
    g.add(fin);
  }
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.8, 10, 1, true), glowMat(0xc0a0ff, 0.7));
  flame.rotation.x = Math.PI; flame.position.y = -2.0;
  g.add(flame);
  g.userData.flame = flame;
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

// ---------------------------------------------------------------- the effect
export function blackHoleBomb(scene, cx, cz, R) {
  const gy = heightAt(cx, cz), hy = gy + H;
  const centre = new THREE.Vector3(cx, hy, cz);
  const start = new THREE.Vector3(cx - 14, gy + 62, cz - 9);

  // --- missile
  const bomb = makeBomb();
  bomb.position.copy(start);
  _v.subVectors(new THREE.Vector3(cx, gy, cz), start).normalize();
  bomb.quaternion.setFromUnitVectors(UP, _v);
  scene.add(bomb);
  audio.play('artillery_whistle', { x: cx, z: cz, vol: 0.55 });
  log('Gravity bomb away.');

  // --- singularity dressing (built now, shown at T_OPEN)
  const hole = new THREE.Group();
  hole.position.copy(centre);
  hole.visible = false;
  scene.add(hole);
  const horizon = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), new THREE.MeshBasicMaterial({ color: 0x000000, fog: false }));
  const rim = new THREE.Mesh(new THREE.SphereGeometry(1.16, 32, 20), rimMat());
  const disk = new THREE.Mesh(new THREE.RingGeometry(1.0, 3.8, 96, 3), diskMat());
  disk.rotation.x = -Math.PI / 2 + 0.42;                                        // tilted so the RTS camera sees the face
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x7050ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  halo.scale.setScalar(9);
  hole.add(disk, halo, rim, horizon);
  for (const m of [horizon, rim, disk, halo]) m.renderOrder = 6;
  const arcs = [];                                                              // lightning tendrils lashing the ground
  for (let k = 0; k < 4; k++) {
    const arc = new THREE.Group();
    for (let s = 0; s < 7; s++) arc.add(new THREE.Mesh(segGeo, glowMat(0xd0b0ff, 0.85)));
    arc.visible = false;
    scene.add(arc);
    arcs.push({ g: arc, t: rnd(0, 0.2), on: false, tx: cx, tz: cz });
  }
  // inflow sparks: points spiralling down the drain
  const N = 260, sp = [];
  const pPos = new Float32Array(N * 3), pCol = new Float32Array(N * 3);
  for (let k = 0; k < N; k++) sp.push({ a: rnd(0, 6.28), r: rnd(HR * 1.4, R * 1.15), h: rnd(-0.8, 2.2), w: rnd(0.8, 1.6), c: Math.random() });
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  const sparks = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.42, map: glowTexture(), vertexColors: true, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, sizeAttenuation: true }));
  sparks.visible = false;
  scene.add(sparks);
  // ground rings that pulse inward
  const rings = [1, 0.72, 0.46].map((f) => { const m = new THREE.Mesh(drapedRing(cx, cz, R * f, 0.22 + 0.1 * f), glowMat(VIOLET, 0)); scene.add(m); return m; });
  // collapse: flash sphere + shock rings, made at the burst
  let flash = null, shock = null, shock2 = null;

  const held = [];                                                             // { e, x0, z0, ang, r, lift, tumble, spin, boss, mode, done }
  const consumeFx = [];
  let hum = null, t = 0, hit = false, burst = false, ended = false, trailT = 0, dustT = 0, arcT = 0;

  function grab(e) {
    if (e.held || e.dead || e.emerge < 1) return;
    const dx = e.x - cx, dz = e.z - cz;
    const h = { e, x0: e.x, z0: e.z, ang: Math.atan2(dz, dx), r: Math.hypot(dx, dz), lift: 0, tumble: rnd(0, 6.28), spin: Math.random() < 0.5 ? -1 : 1, roll: 0, pitch: 0, boss: !!e.boss, mode: 'pull', done: false };
    e.held = h;
    e.target = null; e.lunge = 0;
    if (!e.boss) e.aimH = 0.5 * e.def.scale;
    held.push(h);
  }
  function consume(h) {
    const e = h.e;
    h.done = true;
    e.held = null;
    consumeEnemy(e);
    audio.play('bh_consume', { x: cx, z: cz, vol: 0.5 });
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xe0c8ff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    s.position.set(cx + Math.cos(h.ang) * HR, hy + rnd(-0.4, 0.4), cz + Math.sin(h.ang) * HR);
    s.scale.setScalar(1.4 * e.def.scale + 0.6);
    scene.add(s);
    consumeFx.push({ s, t: 0 });
    for (let k = 0; k < 3; k++) puff(s.position.x, s.position.y, s.position.z, { color: 0x9fe33a, size: 0.35, grow: 0.4, life: 0.35, opacity: 0.9, vx: -Math.cos(h.ang) * 3, vz: -Math.sin(h.ang) * 3, vy: rnd(-1, 1), drag: 3 });
  }
  function release(h) {                                                        // let go where it stands (hole ended early, bug died)
    const e = h.e;
    if (e.held === h) { e.held = null; if (!e.boss) delete e.aimH; }
    h.done = true;
  }
  function fling(h) {
    const e = h.e;
    if (e.dead) { release(h); return; }
    h.mode = 'spit';
    h.u = 0;
    h.fromX = e.x; h.fromZ = e.z; h.fromLift = h.lift;
    const d = Math.hypot(h.x0 - e.x, h.z0 - e.z);
    h.dur = h.boss ? 0.8 + d * 0.05 : 0.55 + d * 0.045;
    h.arc = h.boss ? 0 : 2.5 + d * 0.25;
  }

  function pose(h, dt) {
    const e = h.e;
    if (h.mode === 'pull') {
      if (h.boss) {                                                            // dragged along the ground, held short of the hole
        h.r = Math.max(4.5, h.r - 3.2 * dt);
        h.lift = Math.min(1.6, h.lift + dt * 0.9);
        e.x = cx + Math.cos(h.ang) * h.r; e.z = cz + Math.sin(h.ang) * h.r;
        damageEnemy(e, BOSS_DPS * dt);
        return;
      }
      const w = (0.9 + 5.5 / (h.r + 0.6)) * h.spin;                             // faster round the drain
      h.ang += w * dt;
      const rMin = SMALL(e) ? HR * 0.55 : HR * 1.55 + 0.35 * e.def.scale;
      const v = 1.3 + 5.5 / (h.r + 0.5);
      h.r = Math.max(rMin, h.r - v * dt);
      const want = H * smooth(1 - h.r / (R * 0.95)) + 0.2;
      h.lift += (want - h.lift) * Math.min(1, dt * 4);
      h.tumble += dt * (2 + 10 / (h.r + 1)) * h.spin;
      h.roll = Math.sin(h.tumble) * 1.1; h.pitch = Math.cos(h.tumble * 0.8) * 0.9 + 0.4;
      e.x = cx + Math.cos(h.ang) * h.r; e.z = cz + Math.sin(h.ang) * h.r;
      e.fx = -Math.sin(h.ang) * h.spin; e.fz = Math.cos(h.ang) * h.spin;     // facing along the orbit
      e.walk += dt * 9;                                                        // legs scrambling
      e.aimH = h.lift + 0.5 * e.def.scale;
      damageEnemy(e, DPS * (1 + 1.2 * clamp01(1 - h.r / R)) * dt);
      if (!e.dead && SMALL(e) && h.r <= rMin + 0.05) consume(h);
    } else {                                                                   // spat back to where it was taken from
      h.u += dt / h.dur;
      const u = Math.min(1, h.u), s = h.boss ? smooth(u) : u;
      e.x = h.fromX + (h.x0 - h.fromX) * s; e.z = h.fromZ + (h.z0 - h.fromZ) * s;
      if (!h.boss) {
        h.lift = h.fromLift * (1 - u) + Math.sin(u * Math.PI) * h.arc;
        h.tumble += dt * 14 * h.spin;
        h.roll = Math.sin(h.tumble) * 1.4; h.pitch = Math.cos(h.tumble * 0.7);
        e.fx = h.x0 - h.fromX; e.fz = h.z0 - h.fromZ;
        e.aimH = h.lift + 0.5 * e.def.scale;
      } else h.lift = 1.6 * (1 - u);
      if (u >= 1) {
        const y = heightAt(e.x, e.z);
        for (let k = 0; k < (h.boss ? 10 : 4); k++) { const a = rnd(0, 6.28); puff(e.x, y + 0.3, e.z, { color: 0xb59468, size: rnd(0.6, 1.2) * e.def.scale, grow: 2, life: rnd(0.5, 0.9), opacity: 0.5, vx: Math.cos(a) * 4, vz: Math.sin(a) * 4, vy: 1, drag: 2 }); }
        audio.play('hub_land', { x: e.x, z: e.z, vol: h.boss ? 0.5 : 0.18, rate: h.boss ? 1.2 : 2.2 });
        e.stun = h.boss ? 0.6 : 1.1;
        release(h);
      }
    }
  }

  function open() {
    hit = true;
    scene.remove(bomb);
    bomb.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    explode(cx, cz, 1.1, 0, 0, { shake: 0.25, smoke: 3 });
    audio.play('bh_open', { x: cx, z: cz, vol: 0.9 });
    hum = audio.loop('blackhole_hum', { x: cx, z: cz, vol: 0.7 });
    spawnScar(scene, cx, cz, R * 1.1, { color: 0x14102a, hold: T_END + 4, fade: 5 });
    log('Singularity open.', true);
  }
  function collapse() {
    burst = true;
    if (hum) { hum.stop(); hum = null; }
    audio.play('bh_burst', { x: cx, z: cz, vol: 1 });
    state.shake += 1.1;
    hole.visible = false; sparks.visible = false;
    for (const a of arcs) a.g.visible = false;
    for (const m of rings) m.material.opacity = 0;
    flash = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), glowMat(0xffffff, 1));
    flash.position.copy(centre);
    shock = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 10, 72).rotateX(Math.PI / 2), glowMat(0xd8c8ff, 0.95));
    shock.position.set(cx, gy + 0.6, cz);
    shock2 = new THREE.Mesh(new THREE.TorusGeometry(1, 0.05, 10, 72), glowMat(0x9070ff, 0.9));
    shock2.position.copy(centre);
    scene.add(flash, shock, shock2);
    for (let k = 0; k < 30; k++) { const a = rnd(0, 6.28), s = rnd(6, 16); puff(cx, hy, cz, { color: 0xb090ff, size: 1.2, grow: 3, life: rnd(0.6, 1.1), opacity: 0.7, additive: true, vx: Math.cos(a) * s, vz: Math.sin(a) * s, vy: rnd(-3, 3), drag: 1.4, priority: true }); }
    for (const h of held) if (!h.done) fling(h);
    log('Singularity collapsed.');
  }

  return {
    update(dt) {
      t += dt;
      // --- falling
      if (!hit) {
        const p = clamp01(t / T_HIT), q = p * p * 0.45 + p * 0.55;
        bomb.position.lerpVectors(start, _w.set(cx, gy, cz), q);
        bomb.rotateY(dt * 6);
        bomb.userData.flame.scale.set(1, rnd(0.8, 1.3), 1);
        trailT -= dt;
        if (trailT <= 0) { trailT = 0.04; puff(bomb.position.x, bomb.position.y + 1.2, bomb.position.z, { color: 0xb8a8d8, size: 0.7, grow: 2, life: 1.4, opacity: 0.45, drag: 0.6 }); }
        if (t >= T_HIT) open();
        return true;
      }
      const a = t - T_HIT;
      // --- the hole: grows in, strains, collapses
      if (!burst) {
        const grow = easeOut(a / (T_OPEN - T_HIT));
        const strain = t > T_PULL ? smooth((t - T_PULL) / (T_BURST - T_PULL)) : 0;
        const size = HR * grow * (1 - 0.55 * strain) * (1 + 0.06 * Math.sin(t * 28) * strain);
        hole.visible = true; sparks.visible = true;
        horizon.scale.setScalar(size);
        rim.scale.setScalar(size);
        rim.material.uniforms.uAlpha.value = 1.4 * grow * (1 + strain * 1.5);
        disk.scale.setScalar(size * (1 + 0.25 * strain));
        disk.rotation.z += dt * 1.4;
        disk.material.uniforms.uTime.value = t;
        disk.material.uniforms.uAlpha.value = grow * (1 + strain * 0.8);
        halo.material.opacity = 0.35 * grow * (1 + strain);
        halo.scale.setScalar(9 * (1 + 0.5 * strain));
        rings.forEach((m, k) => { m.material.opacity = 0.75 * grow * Math.pow(Math.max(0, Math.sin((a * 1.6 - k * 0.55) * Math.PI)), 3); });
        // sparks spiral in and drop, respawning at the rim
        for (let k = 0; k < N; k++) {
          const s = sp[k];
          s.a += (0.6 + 5 / (s.r + 0.5)) * s.w * dt;
          s.r -= (1.2 + 6 / (s.r + 0.5)) * s.w * dt * (1 + 2 * strain);
          if (s.r < HR * 0.7) { s.r = rnd(R * 0.9, R * 1.15); s.a = rnd(0, 6.28); s.h = rnd(-1.2, 2.2); s.c = Math.random(); }
          const u = clamp01(1 - s.r / R), y = hy + s.h * (1 - u * 0.9);
          const px = cx + Math.cos(s.a) * s.r, pz = cz + Math.sin(s.a) * s.r;
          pPos[k * 3] = px; pPos[k * 3 + 1] = Math.max(heightAt(px, pz) + 0.2, y); pPos[k * 3 + 2] = pz;
          const br = (0.25 + 0.75 * u) * grow;
          pCol[k * 3] = br * (0.55 + 0.45 * u); pCol[k * 3 + 1] = br * (0.3 + 0.6 * u * s.c); pCol[k * 3 + 2] = br;
        }
        pGeo.attributes.position.needsUpdate = true; pGeo.attributes.color.needsUpdate = true;
        // lightning tendrils
        arcT -= dt;
        if (arcT <= 0) {
          arcT = 0.055;
          for (const arc of arcs) {
            arc.t -= 0.055;
            if (arc.t <= 0) { arc.on = !arc.on; arc.t = arc.on ? rnd(0.1, 0.3) : rnd(0.25, 0.9) / (1 + 2 * strain); if (arc.on) { arc.tx = cx + rnd(-R * 0.8, R * 0.8); arc.tz = cz + rnd(-R * 0.8, R * 0.8); } }
            arc.g.visible = arc.on;
            if (!arc.on) continue;
            const end = _w.set(arc.tx, heightAt(arc.tx, arc.tz) + 0.1, arc.tz);
            let prev = _v.copy(centre).clone();
            arc.g.children.forEach((seg, i) => {
              const u = (i + 1) / arc.g.children.length, j = u < 1 ? 0.9 * (1 - u) : 0;
              const next = new THREE.Vector3().lerpVectors(centre, end, u).add(new THREE.Vector3(rnd(-j, j), rnd(-j, j), rnd(-j, j)));
              seg.position.lerpVectors(prev, next, 0.5);
              seg.scale.set(0.05, prev.distanceTo(next), 0.05);
              seg.quaternion.setFromUnitVectors(UP, new THREE.Vector3().subVectors(next, prev).normalize());
              prev = next;
            });
          }
        }
        // dust torn off the ground and dragged in
        dustT -= dt;
        if (dustT <= 0) {
          dustT = 0.05;
          const an = rnd(0, 6.28), rr = rnd(R * 0.5, R * 1.1), x = cx + Math.cos(an) * rr, z = cz + Math.sin(an) * rr;
          puff(x, heightAt(x, z) + 0.3, z, { color: 0x8a78a8, size: rnd(0.8, 1.6), grow: 0.3, life: rnd(0.9, 1.4), opacity: 0.5, vx: -Math.cos(an) * rr * 1.1, vz: -Math.sin(an) * rr * 1.1, vy: 2.4, drag: 0.35 });
        }
        // grab and pull
        if (t < T_PULL) eachEnemy(cx, cz, R, (e) => grab(e));
        if (t >= T_BURST) collapse();
      } else {
        const b = t - T_BURST;
        if (flash) {
          flash.scale.setScalar(0.3 + 7 * easeOut(b / 0.5));
          flash.material.opacity = Math.max(0, 1 - b / 0.5);
          shock.scale.setScalar(1 + R * 2.2 * easeOut(b / 0.9));
          shock.material.opacity = 0.95 * Math.max(0, 1 - b / 0.9);
          shock2.scale.setScalar(1 + R * 1.4 * easeOut(b / 0.7));
          shock2.rotation.y += dt * 2;
          shock2.material.opacity = 0.9 * Math.max(0, 1 - b / 0.7);
          if (b > 0.9) { scene.remove(flash, shock, shock2); flash = null; }
        }
      }
      for (const h of held) if (!h.done) { if (h.e.dead) release(h); else pose(h, dt); }
      for (let k = consumeFx.length - 1; k >= 0; k--) {
        const f = consumeFx[k];
        f.t += dt;
        f.s.scale.multiplyScalar(1 + dt * 4);
        f.s.material.opacity = Math.max(0, 1 - f.t / 0.28);
        if (f.t > 0.28) { scene.remove(f.s); f.s.material.dispose(); consumeFx.splice(k, 1); }
      }
      if (t >= T_END && !ended) {
        ended = true;
        for (const h of held) if (!h.done) release(h);
        scene.remove(hole, sparks, ...rings, ...arcs.map((x) => x.g));
        for (const m of [horizon, rim, disk]) { m.geometry.dispose(); m.material.dispose(); }
        halo.material.dispose(); pGeo.dispose(); sparks.material.dispose();
        for (const m of rings) { m.geometry.dispose(); m.material.dispose(); }
        for (const f of consumeFx) scene.remove(f.s);
        if (hum) hum.stop();
        return false;
      }
      return true;
    },
  };
}
