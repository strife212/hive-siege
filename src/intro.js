import * as THREE from 'three';
import { heightAt } from './terrain.js';

// Opening cinematic: the Core drops from orbit on thrusters, deploys its legs, lands in a cloud of dust,
// plants itself, then the camera flies to the gameplay view and the UI slides in.
const T_LAND = 6.0;         // touchdown
const T_SETTLE = 0.8;       // bounce + plant duration
const T_FLY = 7.2;          // camera starts flying to the gameplay view
const FLY_DUR = 2.0;
const T_END = T_FLY + FLY_DUR;
const START_Y = 95;
const GAME_CAM = new THREE.Vector3(0, 26, 28);

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const easeOutCubic = (p) => 1 - Math.pow(1 - p, 3);
const easeInOut = (p) => p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;

function dustTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export function playIntro({ scene, camera, controls, core, onDone }) {
  const mesh = core.mesh;
  const restY = mesh.position.y;
  const pylons = mesh.userData.pylons || [];
  const fade = document.getElementById('fade');
  document.body.classList.add('intro');
  controls.enabled = false;

  let t = 0, finished = false, burstDone = false, shake = 0, flyStart = null, uiShown = false;
  const lookTarget = new THREE.Vector3(0, core.y + 2, 0);
  const flyFrom = new THREE.Vector3(), lookFrom = new THREE.Vector3();

  // ---- thrusters
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const flameCoreMat = new THREE.MeshBasicMaterial({ color: 0xfff1b0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const flames = [];
  const addFlame = (x, y, z, r, h) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    const outer = new THREE.Mesh(new THREE.ConeGeometry(r, h, 10, 1, true), flameMat);
    outer.rotation.x = Math.PI; outer.position.y = -h / 2;
    const inner = new THREE.Mesh(new THREE.ConeGeometry(r * 0.5, h * 0.6, 8, 1, true), flameCoreMat);
    inner.rotation.x = Math.PI; inner.position.y = -h * 0.3;
    g.add(outer, inner);
    mesh.add(g);
    flames.push(g);
  };
  addFlame(0, 0.05, 0, 0.9, 4.5);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) addFlame(sx * 1.6, 0.15, sz * 1.6, 0.3, 2.2);
  const light = new THREE.PointLight(0xff9040, 0, 45, 2);
  light.position.y = -0.6;
  mesh.add(light);

  // ---- dust
  const dustTex = dustTexture();
  const dust = [];
  function puff(x, z, speed, size, life) {
    const a = Math.random() * Math.PI * 2;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dustTex, color: 0xb59468, transparent: true, opacity: 0.5, depthWrite: false }));
    s.position.set(x, heightAt(x, z) + 0.4, z);
    s.scale.setScalar(size);
    scene.add(s);
    dust.push({ s, vx: Math.cos(a) * speed, vy: 0.8 + Math.random() * 2, vz: Math.sin(a) * speed, life, max: life, grow: size * 0.8 });
  }
  function ring(count, r0, r1, v0, v1, s0, s1) {
    for (let k = 0; k < count; k++) {
      const a = Math.random() * Math.PI * 2, r = r0 + Math.random() * (r1 - r0);
      puff(Math.cos(a) * r, Math.sin(a) * r, v0 + Math.random() * (v1 - v0), s0 + Math.random() * (s1 - s0), 1.4 + Math.random() * 1.2);
    }
  }

  function coreHeight() {
    if (t < T_LAND) return START_Y + (restY + 0.3 - START_Y) * easeOutCubic(t / T_LAND);
    const s = clamp01((t - T_LAND) / T_SETTLE);
    return restY + 0.3 * (1 - s) * (1 - s) - 0.12 * Math.sin(s * Math.PI);
  }

  function update(dt) {
    if (finished) return;
    t += dt;
    const p = clamp01(t / T_LAND);
    const y = coreHeight();

    // Core motion: sway and slow yaw while flying, then settle.
    const sway = 1 - p;
    mesh.position.set(Math.sin(t * 1.3) * 0.5 * sway, y, Math.cos(t * 0.9) * 0.5 * sway);
    mesh.rotation.set(Math.sin(t * 1.1) * 0.03 * sway, t * 0.12 * sway + 0.6 * (1 - sway) * 0.0, Math.cos(t * 0.8) * 0.03 * sway);

    // Landing legs deploy on approach, then plant into the ground after touchdown.
    const legs = easeOutCubic(clamp01((t - 4.2) / 1.2));
    const plant = easeInOut(clamp01((t - T_LAND - 0.15) / 0.5));
    for (const py of pylons) py.scale.y = 0.45 + 0.55 * legs + 0.14 * plant;

    // Thrusters throttle down right before touchdown.
    const throttle = t < T_LAND - 0.35 ? 1 : clamp01((T_LAND - t) / 0.35);
    for (const f of flames) {
      f.visible = throttle > 0;
      f.scale.set(0.9 + Math.random() * 0.2, (0.75 + Math.random() * 0.5) * throttle, 0.9 + Math.random() * 0.2);
    }
    light.intensity = 380 * throttle * (0.8 + Math.random() * 0.4);

    // Dust: build-up on approach, burst at touchdown.
    if (t > T_LAND - 1.6 && t < T_LAND) {
      const near = clamp01((t - (T_LAND - 1.6)) / 1.6);
      if (Math.random() < near * 0.6) ring(1, 1.5, 4, 3 + near * 4, 5 + near * 5, 1.5, 3);
    }
    if (t >= T_LAND && !burstDone) {
      burstDone = true;
      ring(55, 1.8, 3.2, 8, 15, 2, 4.5);
      shake = 0.6;
    }
    for (let k = dust.length - 1; k >= 0; k--) {
      const d = dust[k];
      d.life -= dt;
      if (d.life <= 0) { scene.remove(d.s); d.s.material.dispose(); dust.splice(k, 1); continue; }
      const damp = Math.exp(-2.2 * dt);
      d.vx *= damp; d.vz *= damp; d.vy -= 1.5 * dt;
      d.s.position.x += d.vx * dt; d.s.position.y += d.vy * dt; d.s.position.z += d.vz * dt;
      d.s.scale.addScalar(d.grow * dt);
      d.s.material.opacity = 0.55 * (d.life / d.max);
    }

    // Camera: slow orbit tracking the descent, then fly to the gameplay view.
    if (t < T_FLY) {
      const ang = 0.95 - 0.5 * clamp01(t / T_FLY);
      camera.position.set(Math.sin(ang) * 30, 11, Math.cos(ang) * 30);
      lookTarget.set(0, core.y + 2 + (y - restY) * 0.35, 0);
      if (shake > 0) {
        shake = Math.max(0, shake - dt);
        camera.position.x += (Math.random() - 0.5) * shake * 0.7;
        camera.position.y += (Math.random() - 0.5) * shake * 0.7;
      }
      camera.lookAt(lookTarget);
    } else {
      if (!flyStart) { flyStart = true; flyFrom.copy(camera.position); lookFrom.copy(lookTarget); }
      const f = easeInOut(clamp01((t - T_FLY) / FLY_DUR));
      camera.position.lerpVectors(flyFrom, GAME_CAM, f);
      lookTarget.lerpVectors(lookFrom, new THREE.Vector3(0, 0, 0), f);
      camera.lookAt(lookTarget);
      if (!uiShown && t > T_FLY + 0.5) { uiShown = true; document.body.classList.remove('intro'); }
    }

    fade.style.opacity = t < 1.4 ? String(1 - t / 1.4) : '0';
    if (t >= T_END) finish();
  }

  function finish() {
    if (finished) return;
    finished = true;
    for (const f of flames) mesh.remove(f);
    mesh.remove(light);
    for (const d of dust) { scene.remove(d.s); d.s.material.dispose(); }
    dust.length = 0;
    flameMat.dispose(); flameCoreMat.dispose(); dustTex.dispose();
    mesh.position.set(0, restY, 0);
    mesh.rotation.set(0, 0, 0);
    for (const py of pylons) py.scale.y = 1.14;
    camera.position.copy(GAME_CAM);
    controls.target.set(0, 0, 0);
    controls.enabled = true;
    controls.update();
    document.body.classList.remove('intro');
    fade.style.opacity = '0';
    removeEventListener('keydown', skip);
    removeEventListener('pointerdown', skip);
    onDone();
  }

  function skip() {
    if (finished) return;
    if (t < T_FLY) { burstDone = true; t = T_FLY; }
  }
  addEventListener('keydown', skip);
  addEventListener('pointerdown', skip);

  return { update, skip };
}
