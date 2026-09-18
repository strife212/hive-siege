import * as THREE from 'three';
import { glowTexture } from './entities.js';

// Shared sprite particle system (dust, smoke, fire, sparks). One sprite + material per particle so each can
// fade and tint independently; counts stay in the low hundreds so this is cheap enough.
const particles = [];
const MAX_PARTICLES = 1400;
let scene = null;
const _c = new THREE.Color();

export function initParticles(s) { scene = s; }

// o: color, color2 (tint at end of life), size, grow, life, opacity, fadeIn, vx/vy/vz, drag, grav, additive
export function puff(x, y, z, o = {}) {
  if (particles.length >= MAX_PARTICLES && !o.priority) return null;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(), color: o.color ?? 0xb59468, transparent: true, opacity: o.opacity ?? 0.6,
    depthWrite: false, blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending, fog: false,
  }));
  s.position.set(x, y, z);
  s.scale.setScalar(o.size ?? 1);
  s.material.rotation = Math.random() * Math.PI * 2;
  scene.add(s);
  particles.push({
    s, vx: o.vx ?? 0, vy: o.vy ?? 0, vz: o.vz ?? 0, life: o.life ?? 1, max: o.life ?? 1, grow: o.grow ?? 0,
    drag: o.drag ?? 1.5, grav: o.grav ?? 0, op: o.opacity ?? 0.6, fadeIn: o.fadeIn ?? 0,
    c0: o.color2 !== undefined ? new THREE.Color(o.color ?? 0xffffff) : null, c1: o.color2 !== undefined ? new THREE.Color(o.color2) : null,
  });
  return s;
}

export function killPuff(sprite) {
  const p = particles.find((q) => q.s === sprite);
  if (p) p.life = 0;
}

export function updateParticles(dt) {
  for (let k = particles.length - 1; k >= 0; k--) {
    const p = particles[k];
    p.life -= dt;
    if (p.life <= 0) { scene.remove(p.s); p.s.material.dispose(); particles.splice(k, 1); continue; }
    const damp = Math.exp(-p.drag * dt);
    p.vx *= damp; p.vz *= damp; p.vy = p.vy * damp - p.grav * dt;
    p.s.position.x += p.vx * dt; p.s.position.y += p.vy * dt; p.s.position.z += p.vz * dt;
    p.s.scale.addScalar(p.grow * dt);
    const age = p.max - p.life;
    const fi = p.fadeIn > 0 ? Math.min(1, age / p.fadeIn) : 1;
    p.s.material.opacity = p.op * fi * Math.min(1, p.life / (p.max * 0.6));
    if (p.c0) p.s.material.color.copy(_c.lerpColors(p.c0, p.c1, Math.min(1, age / p.max)));
  }
}

export const particleCount = () => particles.length;
