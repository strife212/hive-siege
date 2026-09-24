import * as THREE from 'three';
import { heightAt } from './terrain.js';
import { state, damageEnemy, burst, log } from './game.js';
import { retract } from './retract.js';
import { makeMushroom } from './abilities.js';
import { flame } from './flame.js';
import { spawnScar } from './decals.js';
import { puff } from './particles.js';
import { explode } from './effects.js';
import { audio } from './audio.js';
import { worn } from './surface.js';

// Strategic Nuclear Strike: the last-resort call-in, played as a short cinematic.
//
//   shelter    every structure (the Core too) retracts into its silo
//   countdown  10 s, beeping, "STRATEGIC LAUNCH DETECTED / IMPACT IN n" on screen; an ICBM the size of a tower block
//              is already on its way down, and with 7 s to go the camera leaves the player and rides alongside it
//   impact     ground zero is the centre of the map: a fireball, a shock front that crosses the whole map killing
//              every bug it passes (a Colossus takes BOSS_HIT instead, once), fires and burn scars everywhere
//   aftermath  the camera pulls back to the mushroom cloud, the cloud thins, the view returns to where the player
//              left it and the base comes back up out of the ground
const SHELTER_MIN = 3, SHELTER_MAX = 9, COUNT = 10, PAN_AT = 7, SPEED = 40, FRONT = 62;   // FRONT: shock front speed, units/s
const CLOUD = { R: 38, top: 62, hold: 8.5, gone: 14.5, smooth: true, stemK: 1.9, dense: 1.7 };
const T_RETURN = 11.5, T_DEPLOY = 13.5, T_HANDBACK = 14.2, T_END = 21;                     // seconds after impact
const BREATHER = 5;
const BOSS_HIT = 30000;                        // a Colossus is not simply erased: it takes this much, once, and may live                           // seconds between the base being back up and the attack resuming

const UP = new THREE.Vector3(0, 1, 0), _gz = new THREE.Vector3();
const rnd = (a = 0, b = 1) => a + Math.random() * (b - a);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (u) => { u = clamp01(u); return u * u * (3 - 2 * u); };
const easeOut = (u) => 1 - Math.pow(1 - clamp01(u), 3);

// ---------------------------------------------------------------- the missile
function makeICBM() {
  const g = new THREE.Group();                                   // nose along +y, about 26 units long
  const mat = (color, o = {}) => { const m = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.35, ...o }); m.fog = false; return m; };
  const white = worn(mat(0xe4e6e8), { grime: 0.25, chips: 0.1, scale: 0.25 }), dark = worn(mat(0x1d2024, { roughness: 0.6 }), { grime: 0.12, chips: 0.1, scale: 0.25 });
  const red = mat(0xb3261c), metal = mat(0x5a5f66, { roughness: 0.35, metalness: 0.85 });
  const add = (geo, m, y) => { const o = new THREE.Mesh(geo, m); o.position.y = y; g.add(o); return o; };
  add(new THREE.CylinderGeometry(1.6, 1.6, 10, 24), white, -6);                                  // first stage
  add(new THREE.CylinderGeometry(1.63, 1.63, 0.9, 24), dark, -0.8);                              // interstage
  add(new THREE.CylinderGeometry(1.35, 1.6, 7, 24), white, 3.1);                                 // second stage
  add(new THREE.CylinderGeometry(1.38, 1.38, 0.5, 24), red, 5.2);
  add(new THREE.CylinderGeometry(1.37, 1.37, 0.6, 24), dark, 6.9);
  const ogive = [];
  for (let k = 0; k <= 12; k++) { const u = k / 12; ogive.push(new THREE.Vector2(1.35 * Math.sqrt(Math.max(0.0003, 1 - u * u)), 7.2 + u * 5.6)); }
  g.add(new THREE.Mesh(new THREE.LatheGeometry(ogive, 24), dark));                               // warhead shroud
  for (const y of [-9.5, -4, 1.2]) add(new THREE.CylinderGeometry(1.62, 1.62, 0.22, 24), dark, y);
  for (let k = 0; k < 4; k++) {                                                                   // roll pattern and fins
    const a = k * Math.PI / 2;
    const patch = new THREE.Mesh(new THREE.CylinderGeometry(1.615, 1.615, 2.4, 8, 1, true, a, Math.PI / 4), dark);
    patch.position.y = -2.8; g.add(patch);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.14, 3.4, 2.6), dark);
    fin.geometry.translate(0, 0, 1.3);
    fin.position.set(Math.sin(a) * 1.5, -9.4, Math.cos(a) * 1.5);
    fin.rotation.y = a;
    g.add(fin);
  }
  for (let k = 0; k < 4; k++) {                                                                   // engine bells
    const a = k * Math.PI / 2 + Math.PI / 4;
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.62, 1.3, 14, 1, true), metal);
    bell.material.side = THREE.DoubleSide;
    bell.position.set(Math.sin(a) * 0.75, -11.6, Math.cos(a) * 0.75);
    g.add(bell);
  }
  const fmat = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const plume = new THREE.Mesh(new THREE.ConeGeometry(1.7, 17, 16, 1, true), fmat(0xff9a3a, 0.7));
  plume.rotation.x = Math.PI; plume.position.y = -20.5;
  const core = new THREE.Mesh(new THREE.ConeGeometry(0.9, 10, 12, 1, true), fmat(0xfff0c8, 0.95));
  core.rotation.x = Math.PI; core.position.y = -17;
  g.add(plume, core);
  g.userData = { plume, core };
  return g;
}

// ---------------------------------------------------------------- the strike
export function strategicStrike({ scene, camera, controls, setCinematic }) {
  const gx = 0, gz = 0, gy = heightAt(0, 0);
  const GZ = new THREE.Vector3(gx, gy, gz);
  const banner = document.getElementById('strategic'), line1 = banner.querySelector('b'), line2 = banner.querySelector('span');
  const flashEl = document.getElementById('flash');
  const sun = scene.children.find((o) => o.isDirectionalLight), sunBase = sun ? sun.intensity : 0;

  // Aircraft do not shelter: anything in the air (and the airship, which cannot fit down a shaft anyway) scatters to
  // the edge of the map, each on its own heading, and comes back to work on the all clear. A gunship sitting on its
  // pad rides down with it.
  const fliers = state.structures.filter((s) => s.def?.kind === 'airship' || (s.def?.kind === 'heli' && s.heli && s.mesh.userData.heli.parent !== s.mesh));
  const spin = rnd(0, 6.28);
  fliers.forEach((s, k) => { s.evac = { ang: spin + (k / fliers.length) * Math.PI * 2 + rnd(-0.25, 0.25) }; });

  // everything still standing goes to shelter; buildings the player had already retracted stay the player's business
  const mine = [];
  for (const s of state.structures) if (!s.selling && !s.pending && !(s.silo && s.silo.target > 0)) { retract.retract(s); mine.push(s); }
  // Hold the attack until the base is back: no more spawns, and a wave cleared by the blast does not start the next one
  // while everything is still underground (game.js updateWave). Lifted once the view is handed back and every sheltered
  // structure is up again, plus a breather.
  state.waveHold = true;
  let holding = true;
  const release = () => {
    holding = false;
    state.waveHold = false;
    state.waveResumeAt = state.time + BREATHER;
    log(`Base operational. The swarm regroups: attack resumes in ${BREATHER} s.`, true);
  };
  log('STRATEGIC LAUNCH DETECTED. All structures to shelter.', true);
  audio.play('air_raid', { vol: 0.8 });
  line1.textContent = 'STRATEGIC LAUNCH DETECTED';
  line2.textContent = 'ALL STRUCTURES TO SHELTER';
  banner.classList.remove('count');

  const dir = new THREE.Vector3(0.52, -0.74, 0.42).normalize();           // direction of flight
  const side = new THREE.Vector3().crossVectors(dir, UP).normalize();
  let t = 0, countT = null, hitT = null, shown = -1, icbm = null, trailT = 0;
  let saved = null, camOn = false, handedBack = false, deployed = false;
  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), goalPos = new THREE.Vector3(), goalLook = new THREE.Vector3();
  const watch = new THREE.Vector3(58, 0, 80), wide = new THREE.Vector3(108, 0, 144);
  watch.y = Math.max(gy + 32, heightAt(watch.x, watch.z) + 14);
  wide.y = Math.max(gy + 60, heightAt(wide.x, wide.z) + 20);
  let cloud = null, ball = null, glow = null, shocks = [], dome = null, fires = [], boomT = 0, booms = 0;

  function takeCamera() {
    saved = { pos: camera.position.clone(), target: controls.target.clone() };
    camPos.copy(camera.position); camLook.copy(controls.target);
    controls.enabled = false;
    camOn = true;
    document.body.classList.add('cine');
    setCinematic(cinematic);
  }
  function handBack() {
    handedBack = true; camOn = false;
    camera.position.copy(saved.pos);
    controls.target.copy(saved.target);
    controls.enabled = true;
    controls.update();
    document.body.classList.remove('cine');
    setCinematic(null);
  }

  // Camera: called by main.js in place of the player's controls while the strike owns the view.
  function cinematic(dt) {
    let k = 4;
    if (hitT === null) {
      const left = COUNT - (t - countT);
      if (icbm) {
        // ride alongside, drifting from ahead of the nose round to abeam; over the last few seconds race ahead of it to
        // a stand-off point beyond ground zero and watch it come in
        const u = clamp01((PAN_AT - left) / (PAN_AT - 1.5)), ahead = 22 - 30 * u, out = 24 + 10 * u, w = smooth((3.6 - left) / 2.6);
        goalPos.copy(icbm.position).addScaledVector(dir, ahead).addScaledVector(side, out).addScaledVector(UP, 7 - 3 * u);
        goalPos.y = Math.max(goalPos.y, heightAt(goalPos.x, goalPos.z) + 8);
        goalPos.lerp(watch, w);
        goalLook.copy(icbm.position).addScaledVector(dir, 4).lerp(_gz.copy(GZ).setY(gy + 5), smooth((1.1 - left) / 1.1));
        k = 2.2 + 6 * smooth((PAN_AT - left) / 1.4);              // swing over gently, then lock on
      }
    } else {
      const a = t - hitT;
      if (a < T_RETURN) {
        const u = smooth((a - 1.4) / 7.5);
        goalPos.lerpVectors(watch, wide, u);
        goalLook.set(gx, gy + 5 + 39 * u, gz);
        k = 2.5;
      } else { goalPos.copy(saved.pos); goalLook.copy(saved.target); k = 2.2 + 5 * smooth((a - T_RETURN) / (T_HANDBACK - T_RETURN)); }
    }
    const f = 1 - Math.exp(-k * dt);
    camPos.lerp(goalPos, f); camLook.lerp(goalLook, f);
    camera.position.copy(camPos);
    camera.lookAt(camLook);
  }

  function detonate() {
    hitT = t;
    scene.remove(icbm);
    icbm.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    icbm = null;
    banner.style.opacity = '0';
    flashEl.style.opacity = '1';
    audio.play('nuke_impact', { vol: 1 }); audio.play('nuke_rumble', { vol: 1 }); audio.play('lance_impact', { vol: 1 }); audio.play('explosion', { vol: 1, size: 3 });
    state.shake += 8;
    log('STRATEGIC DETONATION.', true);
    cloud = makeMushroom(gx, gy, gz, CLOUD.R, CLOUD);
    scene.add(cloud.group);
    const glowMat = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide });
    ball = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), glowMat(0xffffff, 1));
    ball.position.set(gx, gy + 3, gz);
    glow = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), glowMat(0xff7a2a, 0.5));
    glow.position.copy(ball.position);
    dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 18, 0, Math.PI * 2, 0, Math.PI / 2), glowMat(0xffe6c4, 0.3));
    dome.position.copy(GZ);
    for (const [color, lag, h] of [[0xffffff, 0, 1.2], [0xffc27a, 0.35, 0.8], [0xff7a3a, 0.8, 0.6]]) {   // the front, and two fire walls rolling behind it
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.03, 10, 96).rotateX(Math.PI / 2), glowMat(color, 0.95));
      ring.position.set(gx, gy + h, gz);
      shocks.push({ ring, lag });
      scene.add(ring);
    }
    scene.add(ball, glow, dome);
    for (let k = 0; k < 70; k++) { const an = rnd(0, 6.28), sp = rnd(20, 44); puff(gx, gy + 1.5, gz, { color: 0xb0987a, size: 5, grow: 7, life: rnd(2.5, 4.5), opacity: 0.7, vx: Math.cos(an) * sp, vz: Math.sin(an) * sp, vy: rnd(1, 4), drag: 1.0, priority: true }); }
    burst(gx, gy + 1, gz, 'debris', 40, 60); burst(gx, gy + 1, gz, 'soil', 40, 60);
    // the ground: one vast glassed crater, a broken ring of deep burns round it, streaks flung to the edge of the basin
    const SCAR = { hold: CLOUD.gone + 4, fade: 8 };
    spawnScar(scene, gx, gz, 46, { ...SCAR, glow: 12, glowI: 0.3 });
    spawnScar(scene, gx, gz, 28, { ...SCAR, color: 0x060504, glow: 16, glowI: 0.3 });
    for (let k = 0; k < 14; k++) { const an = k / 14 * 6.28 + rnd(-0.2, 0.2), rr = rnd(18, 44); spawnScar(scene, gx + Math.cos(an) * rr, gz + Math.sin(an) * rr, rnd(13, 22), { ...SCAR, glow: rnd(6, 11), glowI: 0.22 }); }
    for (let k = 0; k < 22; k++) { const an = rnd(0, 6.28), rr = rnd(40, 62); spawnScar(scene, gx + Math.cos(an) * rr, gz + Math.sin(an) * rr, rnd(6, 12), { ...SCAR, opacity: rnd(0.5, 0.85) }); }
    for (let k = 0; k < 150; k++) {                              // fires right across the basin, guttering out as the cloud goes
      const an = rnd(0, 6.28), rr = Math.sqrt(rnd(0.01, 1)) * 60, x = gx + Math.cos(an) * rr, z = gz + Math.sin(an) * rr;
      fires.push({ x, y: heightAt(x, z) + 0.15, z, r: rr, size: rnd(2, 4.6), t: 0, out: CLOUD.gone * rnd(0.6, 1) });
    }
  }

  const struck = new Set();                                  // bosses the shock front has already hit
  function aftermath(a, dt) {
    // The shock front crosses the whole map; whatever it reaches is gone. It lingers a moment for late arrivals.
    if (a < 4.5) {
      const r2 = (FRONT * a + 6) ** 2;
      for (const e of state.enemies) {
        if (e.dead || (e.x - gx) ** 2 + (e.z - gz) ** 2 >= r2) continue;
        if (!e.boss) { damageEnemy(e, 1e9); continue; }
        if (struck.has(e)) continue;                             // the front washes over it once
        struck.add(e);
        damageEnemy(e, BOSS_HIT);
        if (!e.dead) log('The Colossus survived the strike!', true);
      }
      for (const tr of state.troopers) if (tr.hp > 0 && (tr.x - gx) ** 2 + (tr.z - gz) ** 2 < r2) tr.hp = 0;
    }
    state.shake = Math.max(state.shake, 1.3 * (1 - a / 5.5));
    flashEl.style.opacity = String(Math.max(0, 1 - a / 3.2));
    if (sun) sun.intensity = sunBase * (1 + 5 * Math.max(0, 1 - a / 2.6) ** 2);
    if (cloud && !cloud.update(a, dt)) { cloud.dispose(); cloud = null; }
    if (ball) {
      if (a < 5) {
        const s = 2 + 50 * easeOut(a / 2.2);
        ball.scale.setScalar(s); glow.scale.setScalar(s * 1.45);
        ball.material.color.setHex(a < 0.35 ? 0xffffff : a < 1.3 ? 0xffc070 : 0xff5a20);
        ball.material.opacity = 0.95 * (1 - clamp01((a - 1.2) / 3.4));
        glow.material.opacity = 0.5 * (1 - clamp01((a - 0.8) / 3.8));
        ball.position.y = glow.position.y = gy + 3 + a * 9;
        dome.scale.setScalar(1 + 170 * easeOut(a / 2.6));
        dome.material.opacity = 0.3 * (1 - clamp01(a / 2.6));
        for (const sh of shocks) {
          const b = Math.max(0, a - sh.lag), front = 1 + FRONT * b * (sh.lag ? 0.8 : 1);
          sh.ring.scale.set(front, front * 0.6, front);
          sh.ring.material.opacity = b > 0 ? 0.95 * (1 - clamp01(b / 3.6)) ** 1.3 : 0;
        }
        const front = FRONT * a;
        if (a < 3.2) for (let k = 0; k < 22; k++) {               // the front tears the ground up and sets it alight as it goes
          const an = rnd(0, 6.28), px = gx + Math.cos(an) * front, pz = gz + Math.sin(an) * front, py = heightAt(px, pz);
          puff(px, py + 0.6, pz, { color: 0xcdb592, size: rnd(3, 5.5), grow: 3.4, life: rnd(0.9, 1.6), opacity: 0.55, vx: Math.cos(an) * 14, vz: Math.sin(an) * 14, vy: rnd(1, 4), drag: 2.2, priority: true });
          if (k < 12) flame.emit(px, py + 0.3, pz, { size: rnd(2.5, 5), grow: 1.5, life: rnd(0.5, 0.9), vy: rnd(3, 7), vx: Math.cos(an) * 6, vz: Math.sin(an) * 6, drag: 1, heat: 1 });
        }
      } else { scene.remove(ball, glow, dome, ...shocks.map((s) => s.ring)); for (const m of [ball, glow, dome, ...shocks.map((s) => s.ring)]) { m.geometry.dispose(); m.material.dispose(); } ball = null; }
    }
    boomT -= dt;                                                 // secondary explosions chasing the front outward
    if (a < 3 && boomT <= 0 && booms < 14) {
      boomT = 0.18; booms++;
      const an = rnd(0, 6.28), rr = Math.min(58, FRONT * a * rnd(0.5, 0.95));
      explode(gx + Math.cos(an) * rr, gz + Math.sin(an) * rr, rnd(2.4, 3.6), 0, 0, { shake: 0, smoke: 5 });
    }
    for (const f of fires) {
      if (a >= f.out || f.r > FRONT * a) continue;
      f.t -= dt;
      if (f.t > 0) continue;
      const left = Math.min(1, (f.out - a) / 5), big = f.size * (0.4 + 0.6 * left);
      f.t = 0.09 + Math.random() * 0.06;
      flame.emit(f.x + rnd(-0.5, 0.5) * big, f.y, f.z + rnd(-0.5, 0.5) * big, { size: big * rnd(0.7, 1.1), grow: 1.3, life: rnd(0.6, 1.05), vy: rnd(2.6, 5) * (0.6 + 0.4 * left), vx: 0.6, vz: rnd(-0.3, 0.3), drag: 0.8, heat: 0.7 + 0.3 * left });
      if (Math.random() < 0.04) puff(f.x, f.y + 1.4, f.z, { color: 0x1f1b18, size: 1.6, grow: 1.8, life: 2.6, opacity: 0.35, vy: 2.8, vx: 0.7, drag: 0.6 });
    }
    if (!deployed && a >= T_DEPLOY) {                            // all clear: the base comes back up
      deployed = true;
      for (const s of mine) if (s.hp > 0) retract.deploy(s);
      for (const s of fliers) s.evac = null;
      log('All clear. Structures redeploying.');
    }
    if (!handedBack && a >= T_HANDBACK) handBack();
  }

  return {
    update(dt) {
      t += dt;
      if (countT === null) {                                     // shelter: wait for the last blast door (within reason)
        banner.style.opacity = String(0.75 + 0.25 * Math.sin(t * 7));
        const down = mine.every((s) => s.hp <= 0 || retract.isDown(s));
        if ((down && t >= SHELTER_MIN) || t >= SHELTER_MAX) {
          countT = t;
          banner.classList.add('count');
          icbm = makeICBM();
          icbm.quaternion.setFromUnitVectors(UP, dir);
          scene.add(icbm);
          audio.play('nuke_launch', { vol: 1 });
        }
      } else if (hitT === null) {
        const left = COUNT - (t - countT), n = Math.max(0, Math.ceil(left));
        if (n !== shown) {
          shown = n;
          line2.textContent = `IMPACT IN ${n}`;
          audio.play('nuke_beep', { hi: n <= 3, vol: 1, dur: n <= 3 ? 0.6 : 0.4, rate: n <= 3 ? 1.2 : 1 });
        }
        const beat = left % 1;                                   // the readout kicks on every second
        banner.style.opacity = '1';
        banner.style.transform = `translateX(-50%) scale(${1 + 0.06 * beat * beat})`;
        icbm.position.copy(GZ).addScaledVector(dir, -SPEED * Math.max(0, left) - 12);   // nose reaches the ground at zero
        icbm.rotateY(dt * 0.35);
        icbm.userData.plume.scale.set(rnd(0.9, 1.1), rnd(0.85, 1.2), rnd(0.9, 1.1));
        icbm.userData.core.scale.y = rnd(0.8, 1.15);
        trailT -= dt;
        if (trailT <= 0) {
          trailT = 0.03;
          const p = icbm.position;
          puff(p.x - dir.x * 24, p.y - dir.y * 24, p.z - dir.z * 24, { color: 0xf2f2f2, size: 3.2, grow: 2.6, life: 6, opacity: 0.55, drag: 0.4, priority: true });
        }
        if (!camOn && left <= PAN_AT) { takeCamera(); audio.play('jet_flyby', { vol: 0.8 }); }
        if (left <= 0) detonate();
      } else {
        const a = t - hitT;
        aftermath(a, dt);
        if (holding && handedBack && mine.every((s) => s.hp <= 0 || (!s.silo && !s.buried))) release();
        if (a >= T_END) {
          if (holding) release();                               // never leave the attack held
          if (cloud) cloud.dispose();
          if (sun) sun.intensity = sunBase;
          flashEl.style.opacity = '0';
          if (!handedBack) handBack();
          for (const s of fliers) s.evac = null;
          return false;
        }
      }
      return true;
    },
  };
}
