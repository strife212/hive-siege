import * as THREE from 'three';

// Light thrown by the fighting itself: explosions, muzzle blasts, the flamethrower, railgun bolts and acid hits light
// the ground and the buildings around them. A small fixed pool of point lights is handed out to whichever flashes
// matter most right now (bright, close to the camera, on screen). The pool never grows or shrinks, so no material
// recompiles when the battle heats up; idle lights just sit dark. A new flash takes the slot that currently counts
// for least, and only if it counts for more itself, so a stream of HMG muzzle flashes cannot snuff a mortar blast.
// A flash with a key (the tower firing it) refreshes that key's slot instead of taking another.
const N = 6;
const slots = [];
let camera = null;
const frustum = new THREE.Frustum(), _pv = new THREE.Matrix4(), _sph = new THREE.Sphere();

// How much a flash at (x, y, z) with this reach would be seen: 1 near the camera, falling off with distance, and
// next to nothing if its light cannot reach anything on screen.
function seen(x, y, z, range) {
  _sph.center.set(x, y, z);
  _sph.radius = range;
  if (!frustum.intersectsSphere(_sph)) return 0.02;
  const d = camera.position.distanceTo(_sph.center);
  return 1 / (1 + (d / 45) ** 2);
}
const level = (s) => (s.t >= s.life ? 0 : (1 - s.t / s.life) ** 2);

export const flashes = {
  init(scene, cam) {
    camera = cam;
    for (let k = 0; k < N; k++) {
      const light = new THREE.PointLight(0xffffff, 0, 1, 2);
      scene.add(light);
      slots.push({ light, key: null, power: 0, range: 1, life: 1, t: 1, flicker: 0, score: 0 });
    }
  },

  // o: color, power (peak intensity, candela), range (light reach), life (fade-out seconds), flicker (0..1), key
  add(x, y, z, { color = 0xffa050, power = 20, range = 8, life = 0.3, flicker = 0, key = null } = {}) {
    if (!camera) return;
    const score = power * seen(x, y, z, range);
    let slot = key ? slots.find((s) => s.key === key && s.t < s.life) : null;
    if (!slot) {
      let low = Infinity;
      for (const s of slots) { const w = s.score * level(s); if (w < low) { low = w; slot = s; } }
      if (low > score) return;
    }
    Object.assign(slot, { key, power, range, life, t: 0, flicker, score });
    slot.light.color.set(color);
    slot.light.position.set(x, y, z);
    slot.light.distance = range;
  },

  update(dt) {
    if (!camera) return;
    _pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(_pv);
    for (const s of slots) {
      s.t += dt;
      const f = s.flicker ? 1 - s.flicker * Math.random() : 1;
      s.light.intensity = s.power * level(s) * f;
    }
  },
};
