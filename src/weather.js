import * as THREE from 'three';
import { heightAt } from './terrain.js';
import { WEATHER_U } from './surface.js';
import { state, log } from './game.js';
import { spawnScorch } from './decals.js';
import { puff } from './particles.js';
import { glowTexture } from './entities.js';
import { audio } from './audio.js';

// Weather. Two states for now, CLEAR (the normal dusk sky) and RAIN (a storm), and one blend value `storm` 0..1 between
// them, so every change rolls in over several seconds: the clouds come over first, the rain follows once the sky has
// darkened, and the ground soaks through slowly and takes even longer to dry.
//
// Rain is drawn by the GPU. The drops live in a big box that follows the camera, each one fixed in world space and
// wrapped around the box as it moves, stretched into a motion streak along its velocity, and widened to at least a pixel
// with its alpha thinned to match so distant rain does not shimmer. Splash crowns pop up on the ground around the camera
// focus. The terrain collects puddles in its hollows that ripple with raindrops, buildings and boulders go dark and
// glossy with water running down their faces, and lightning flickers through the cloud deck, now and then striking
// somewhere in view. Everything that reacts to it reads the shared uniforms in surface.js (WEATHER_U).
export const WEATHERS = ['clear', 'rain'];
const NAMES = { clear: 'Clear', rain: 'Rain' };
const TRANSITION = 6;                    // seconds for the sky to turn over
const DROPS = 50000, SPLASHES = 900, SPLASH_LIFE = 0.34;
const BOX = new THREE.Vector3(100, 90, 100);

const rnd = (a = 0, b = 1) => a + Math.random() * (b - a);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (u) => { u = clamp01(u); return u * u * (3 - 2 * u); };
const lerp = (a, b, k) => a + (b - a) * k;

// The storm end of every blend. The clear end is read from the scene as built, so this never fights scene.js.
const STORM = {
  horizon: new THREE.Color(0.115, 0.12, 0.145), fogNear: 42, fogFar: 175,
  sun: 0.72, sunColor: new THREE.Color(0xa4b2cc), hemi: 0.95, hemiSky: new THREE.Color(0x7c8598), hemiGround: new THREE.Color(0x2a292d), env: 0.6,
};
const FLASH_TINT = new THREE.Color(0.82, 0.88, 1.0);

// ---------------------------------------------------------------- rain streaks
function makeRain() {
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const seed = new Float32Array(DROPS * 4);
  for (let k = 0; k < DROPS * 4; k++) seed[k] = Math.random();
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
  geo.instanceCount = DROPS;
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
    uniforms: {
      uCenter: { value: new THREE.Vector3() }, uBox: { value: BOX }, uOffset: { value: new THREE.Vector3() }, uVel: { value: new THREE.Vector3(0, -27, 0) },
      uCam: { value: new THREE.Vector3() }, uPx: { value: 0.001 }, uIntensity: { value: 0 }, uFlash: { value: 0 },
      uColor: { value: new THREE.Color(0.62, 0.68, 0.8) }, uAlpha: { value: 0.34 },
    },
    vertexShader: `
      uniform vec3 uCenter, uBox, uOffset, uVel, uCam; uniform float uPx, uIntensity;
      attribute vec4 aSeed;
      varying vec2 vUv; varying float vA;
      void main() {
        if (aSeed.w > uIntensity) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vA = 0.0; return; }   // lighter rain: fewer drops
        vec3 lo = uCenter - uBox * 0.5;
        vec3 p = mod(aSeed.xyz * uBox + uOffset - lo, uBox) + lo;          // world-fixed, wrapped round the camera's box
        vec3 dir = normalize(uVel);
        float h = fract(dot(aSeed.xyz, vec3(12.99, 78.23, 37.71)) * 43.7585);
        float len = length(uVel) * 0.05 * (0.6 + 0.8 * h);                 // motion streak
        float depth = distance(uCam, p);
        vec3 side = normalize(cross(dir, normalize(uCam - p)));
        float w = 0.02, wMin = depth * uPx * 1.15;                          // never thinner than a pixel...
        float cover = w / max(w, wMin);                                     // ...but fainter to keep the same coverage
        w = max(w, wMin);
        vec3 wp = p - dir * len * position.y + side * position.x * w;       // head at p, tail trailing up the fall line
        vUv = vec2(position.x + 0.5, position.y);
        vA = cover * (0.6 + 0.4 * h) * smoothstep(2.0, 6.0, depth) * (1.0 - smoothstep(48.0, 118.0, depth));
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uAlpha, uFlash;
      varying vec2 vUv; varying float vA;
      void main() {
        float edge = 1.0 - abs(vUv.x - 0.5) * 2.0;
        float body = smoothstep(0.0, 0.1, vUv.y) * (1.0 - vUv.y * 0.85);   // bright head, fading tail
        float a = edge * body * vA * uAlpha * (1.0 + uFlash * 1.5);
        if (a < 0.002) discard;
        gl_FragColor = vec4(uColor * (1.0 + uFlash * 3.5), a);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 8;
  mesh.visible = false;
  return mesh;
}

// ---------------------------------------------------------------- splash crowns
function makeSplashes() {
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0], 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const data = new Float32Array(SPLASHES * 4).fill(-100);
  const attr = new THREE.InstancedBufferAttribute(data, 4).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aSplash', attr);
  const size = new Float32Array(SPLASHES);
  for (let k = 0; k < SPLASHES; k++) size[k] = rnd(0.22, 0.42);
  geo.setAttribute('aSize', new THREE.InstancedBufferAttribute(size, 1));
  geo.instanceCount = SPLASHES;
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: { uTime: { value: 0 }, uLife: { value: SPLASH_LIFE }, uRight: { value: new THREE.Vector3(1, 0, 0) }, uColor: { value: new THREE.Color(0.72, 0.78, 0.9) }, uAlpha: { value: 0.6 }, uFlash: { value: 0 } },
    vertexShader: `
      uniform float uTime, uLife; uniform vec3 uRight;
      attribute vec4 aSplash; attribute float aSize;
      varying vec2 vQ; varying float vAge;
      void main() {
        vAge = (uTime - aSplash.w) / uLife;
        if (vAge < 0.0 || vAge > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        vQ = position.xy;
        vec3 wp = aSplash.xyz + uRight * position.x * aSize + vec3(0.0, position.y * aSize * 1.1, 0.0);
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uAlpha, uFlash;
      varying vec2 vQ; varying float vAge;
      void main() {
        float u = vAge, a = 0.0;
        for (int i = 0; i < 5; i++) {                                      // droplets thrown up and out in a crown
          float s = (float(i) - 2.0) / 2.0;
          vec2 c = vec2(s * 0.85 * u, (1.5 - abs(s) * 0.45) * u - 1.9 * u * u);
          a += smoothstep(0.1, 0.02, length(vQ - c)) * step(0.0, c.y + 0.02);
        }
        a += smoothstep(0.06, 0.0, abs(length(vec2(vQ.x, vQ.y * 5.0)) - u * 0.9)) * 0.7;   // the ring on the ground
        a *= (1.0 - u) * uAlpha;
        if (a < 0.004) discard;
        gl_FragColor = vec4(uColor * (1.0 + uFlash * 3.0), a);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 7;
  mesh.visible = false;
  return { mesh, data, attr, mat };
}

// ---------------------------------------------------------------- lightning
const boltGeo = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true);
function jag(a, b, rough, levels) {
  let pts = [a.clone(), b.clone()];
  for (let it = 0; it < levels; it++) {
    const next = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i], q = pts[i + 1], len = p.distanceTo(q);
      const m = p.clone().lerp(q, 0.5);
      m.x += rnd(-1, 1) * len * rough; m.z += rnd(-1, 1) * len * rough; m.y += rnd(-0.25, 0.25) * len * rough;
      next.push(m, q);
    }
    pts = next;
  }
  return pts;
}
function makeBolt(top, ground, width) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 3.4, 4.4), transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const addPath = (pts, w) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], seg = new THREE.Mesh(boltGeo, mat);
      seg.position.lerpVectors(a, b, 0.5);
      seg.scale.set(w, a.distanceTo(b), w);
      seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3().subVectors(b, a).normalize());
      g.add(seg);
    }
  };
  const main = jag(top, ground, 0.22, 5);
  addPath(main, width);
  for (let k = 0; k < 3; k++) {                                            // forks peeling off the upper half
    const from = main[Math.floor(rnd(0.12, 0.55) * main.length)];
    const to = from.clone().add(new THREE.Vector3(rnd(-1, 1), rnd(-1.4, -0.7), rnd(-1, 1)).multiplyScalar(from.distanceTo(ground) * rnd(0.25, 0.45)));
    addPath(jag(from, to, 0.28, 4), width * 0.55);
  }
  g.userData.mat = mat;
  return g;
}

// ---------------------------------------------------------------- the system
let W = null;

export const weather = {
  // auto: let the weather change by itself from time to time (the real game; not the title demo or a recording)
  init({ scene, camera, renderer, auto = true }) {
    const sky = scene.children.find((o) => o.material?.uniforms?.uStorm);
    const sun = scene.children.find((o) => o.isDirectionalLight);
    const hemi = scene.children.find((o) => o.isHemisphereLight);
    sky.material.uniforms.uHorizon.value = scene.fog.color;                // sky horizon and fog stay one colour
    W = {
      scene, camera, renderer, sky: sky.material.uniforms, sun, hemi, auto,
      clear: {
        horizon: scene.fog.color.clone(), fogNear: scene.fog.near, fogFar: scene.fog.far, sun: sun.intensity, sunColor: sun.color.clone(),
        hemi: hemi.intensity, hemiSky: hemi.color.clone(), hemiGround: hemi.groundColor.clone(), env: scene.environmentIntensity,
      },
      current: 'clear', target: 0, storm: 0, wet: 0, t: 0,
      offset: new THREE.Vector3(), vel: new THREE.Vector3(),
      rain: makeRain(), splash: makeSplashes(), splashT: 0, mistT: 0,
      flash: 0, pulses: [], strikeT: rnd(4, 9), bolts: [], snd: null,
      autoT: rnd(200, 360),
    };
    scene.add(W.rain, W.splash.mesh);
    const want = new URLSearchParams(location.search).get('weather');
    if (want && NAMES[want]) weather.set(want, true);
  },
  get current() { return W ? W.current : 'clear'; },
  name: (k) => NAMES[k] || k,
  set(kind, instant = false) {
    if (!W || !NAMES[kind]) return;
    W.current = kind;
    W.target = kind === 'rain' ? 1 : 0;
    if (instant) { W.storm = W.wet = W.target; }
  },
  cycle() {
    const next = WEATHERS[(WEATHERS.indexOf(W.current) + 1) % WEATHERS.length];
    weather.set(next);
    return next;
  },
  strike(near) { if (W) lightning(near); },

  update(dt) {
    if (!W) return;
    W.t += dt;
    const t = W.t;
    // --- blend toward the target weather
    W.storm += Math.max(-dt / TRANSITION, Math.min(dt / TRANSITION, W.target - W.storm));
    const s = smooth(W.storm);
    const rain = smooth((W.storm - 0.35) / 0.65);                          // rain starts once the sky has darkened
    W.wet += rain > 0.3 ? Math.min(dt / 14, 1 - W.wet) : -Math.min(dt / 32, W.wet);
    WEATHER_U.wet.value = smooth(W.wet);
    WEATHER_U.rain.value = rain;
    WEATHER_U.time.value = t;

    // --- lightning flash envelope: a few sharp pulses per strike
    W.flash = 0;
    for (let k = W.pulses.length - 1; k >= 0; k--) {
      const p = W.pulses[k], a = t - p.at;
      if (a < 0) continue;
      if (a > 1.2) { W.pulses.splice(k, 1); continue; }
      W.flash += p.amp * Math.exp(-a * 16);
    }
    const f = Math.min(1.6, W.flash);

    // --- sky, fog and light
    const C = W.clear, fog = W.scene.fog;
    fog.color.copy(C.horizon).lerp(STORM.horizon, s);
    fog.near = lerp(C.fogNear, STORM.fogNear, s);
    fog.far = lerp(C.fogFar, STORM.fogFar, s);
    W.sun.intensity = lerp(C.sun, STORM.sun, s) + f * 5.5;
    W.sun.color.copy(C.sunColor).lerp(STORM.sunColor, s).lerp(FLASH_TINT, Math.min(1, f));
    W.hemi.intensity = lerp(C.hemi, STORM.hemi, s) + f * 1.4;
    W.hemi.color.copy(C.hemiSky).lerp(STORM.hemiSky, s);
    W.hemi.groundColor.copy(C.hemiGround).lerp(STORM.hemiGround, s);
    W.scene.environmentIntensity = lerp(C.env, STORM.env, s);
    WEATHER_U.sky.value.copy(fog.color).multiplyScalar(1.25).lerp(FLASH_TINT, Math.min(1, f * 0.6));
    W.sky.uStorm.value = s;
    W.sky.uFlash.value = f;
    W.sky.uTime.value = t;

    // --- the rain itself
    const cam = W.camera;
    const gust = Math.sin(t * 0.23) * 1.8 + Math.sin(t * 0.71 + 1.3) * 1.1;
    W.vel.set(3.2 + gust, -27, 1.4 + gust * 0.4);
    const ru = W.rain.material.uniforms;
    W.rain.visible = rain > 0.002;
    if (W.rain.visible) {
      W.offset.addScaledVector(W.vel, dt);
      for (const ax of ['x', 'y', 'z']) W.offset[ax] = ((W.offset[ax] % BOX[ax]) + BOX[ax]) % BOX[ax];
      const along = THREE.MathUtils.clamp(cam.position.distanceTo(groundFocus()) * 0.55, 12, 46);   // box sits between camera and ground
      cam.getWorldDirection(_dir);
      ru.uCenter.value.copy(cam.position).addScaledVector(_dir, along);
      ru.uCenter.value.y = Math.max(ru.uCenter.value.y, heightAt(ru.uCenter.value.x, ru.uCenter.value.z) + BOX.y * 0.3);
      ru.uOffset.value.copy(W.offset);
      ru.uVel.value.copy(W.vel);
      ru.uCam.value.copy(cam.position);
      W.renderer.getDrawingBufferSize(_size);
      ru.uPx.value = 2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) / Math.max(1, _size.y);
      ru.uIntensity.value = rain;
      ru.uFlash.value = f;
    }
    updateSplashes(dt, rain, f);

    // --- ground mist drifting through the base in heavy rain
    W.mistT -= dt;
    if (rain > 0.5 && W.mistT <= 0) {
      W.mistT = 0.3;
      const g = groundFocus();
      const a = rnd(0, 6.28), r = rnd(4, 34), x = g.x + Math.cos(a) * r, z = g.z + Math.sin(a) * r;
      puff(x, heightAt(x, z) + rnd(0.8, 2.2), z, { color: 0x8b8e98, size: rnd(7, 12), grow: 1.4, life: rnd(6, 9), opacity: 0.075 * rain, vx: W.vel.x * 0.25, vz: W.vel.z * 0.25, drag: 0.1, fadeIn: 2.5 });
    }

    // --- lightning
    if (s > 0.8) {
      W.strikeT -= dt;
      if (W.strikeT <= 0) { W.strikeT = rnd(5, 14); lightning(Math.random() < 0.28); }
    }
    for (let k = W.bolts.length - 1; k >= 0; k--) {
      const b = W.bolts[k];
      b.t += dt;
      const env = Math.max(0, W.flash - 0.05) / Math.max(0.2, b.peak);
      b.g.userData.mat.opacity = Math.min(1, env * 1.4) * (b.t < 0.7 ? 1 : 0);
      if (b.glow) { b.glow.material.opacity = Math.min(1, env); b.glow.scale.setScalar(b.glowSize * (1 + b.t)); }
      if (b.t > 0.9) {
        W.scene.remove(b.g);
        b.g.userData.mat.dispose();
        if (b.glow) { W.scene.remove(b.glow); b.glow.material.dispose(); }
        W.bolts.splice(k, 1);
      }
    }

    // --- rain on the roof
    if (rain > 0.02 && !W.snd) W.snd = audio.loop('rain', { vol: 0.25 });   // ambience: kept well under the battle
    if (W.snd) {
      if (rain <= 0.02) { W.snd.stop(); W.snd = null; }
      else if (Math.abs((W.sndVol ?? -1) - rain) > 0.02) { W.sndVol = rain; W.snd.setVol(rain); }
    }

    // --- weather changes by itself now and then (the real game only)
    if (W.auto && !state.intro && !state.demo) {
      W.autoT -= dt;
      if (W.autoT <= 0) {
        W.autoT = rnd(200, 360);
        if (Math.random() < 0.5) {
          const next = weather.cycle();
          log(next === 'rain' ? 'Weather: a storm front is rolling in.' : 'Weather: the storm is passing.');
        }
      }
    }
  },
};

const _dir = new THREE.Vector3(), _c = new THREE.Vector3(), _size = new THREE.Vector2(), _right = new THREE.Vector3();

// Where the camera is looking on the ground (roughly): used to place splashes and mist.
function groundFocus() {
  const cam = W.camera;
  cam.getWorldDirection(_dir);
  const k = _dir.y < -0.05 ? (cam.position.y - heightAt(cam.position.x, cam.position.z)) / -_dir.y : 40;
  return _c.copy(cam.position).addScaledVector(_dir, Math.min(90, k));
}

function updateSplashes(dt, rain, f) {
  const sp = W.splash, u = sp.mat.uniforms;
  sp.mesh.visible = rain > 0.02;
  if (!sp.mesh.visible) return;
  u.uTime.value = W.t;
  u.uFlash.value = f;
  _right.setFromMatrixColumn(W.camera.matrixWorld, 0);
  _right.y = 0;
  u.uRight.value.copy(_right.lengthSq() > 1e-6 ? _right.normalize() : _right.set(1, 0, 0));
  const g = groundFocus(), gx = g.x, gz = g.z;
  const R = THREE.MathUtils.clamp(W.camera.position.distanceTo(g) * 0.8, 16, 60);
  const active = Math.floor(SPLASHES * rain), d = sp.data;
  let dirty = false;
  for (let k = 0; k < SPLASHES; k++) {
    const i = k * 4;
    if (k >= active) { if (d[i + 3] > -50 && W.t - d[i + 3] > SPLASH_LIFE) { d[i + 3] = -100; dirty = true; } continue; }
    if (W.t - d[i + 3] < SPLASH_LIFE) continue;
    const a = rnd(0, Math.PI * 2), r = Math.sqrt(Math.random()) * R, x = gx + Math.cos(a) * r, z = gz + Math.sin(a) * r;
    d[i] = x; d[i + 1] = heightAt(x, z) + 0.03; d[i + 2] = z; d[i + 3] = W.t + rnd(0, SPLASH_LIFE);
    dirty = true;
  }
  if (dirty) sp.attr.needsUpdate = true;
}

// A strike: out beyond the mountains most of the time (the flash, the sky lit from inside, a bolt if the camera is
// looking that way), sometimes right in view with a crack of thunder on top of it.
function lightning(near) {
  const t = W.t;
  const amp = near ? rnd(1.1, 1.4) : rnd(0.55, 1.0);
  W.pulses.push({ at: t, amp }, { at: t + rnd(0.07, 0.12), amp: amp * rnd(0.4, 0.7) });
  if (Math.random() < 0.6) W.pulses.push({ at: t + rnd(0.18, 0.3), amp: amp * rnd(0.5, 0.9) });
  let ground, top, width;
  if (near) {
    const g = groundFocus(), a = rnd(0, 6.28), r = rnd(8, 26);
    const x = g.x + Math.cos(a) * r, z = g.z + Math.sin(a) * r;
    ground = new THREE.Vector3(x, heightAt(x, z), z);
    top = new THREE.Vector3(x + rnd(-10, 10), ground.y + 75, z + rnd(-10, 10));
    width = 0.16;
  } else {
    W.camera.getWorldDirection(_dir);
    const face = Math.atan2(_dir.z, _dir.x), a = Math.random() < 0.7 ? face + rnd(-0.8, 0.8) : rnd(0, 6.28), r = rnd(170, 250);
    ground = new THREE.Vector3(Math.cos(a) * r, -4, Math.sin(a) * r);
    top = new THREE.Vector3(ground.x + rnd(-30, 30), 105, ground.z + rnd(-30, 30));
    width = 0.9;
  }
  W.sky.uFlashDir.value.copy(top).normalize();
  const bolt = makeBolt(top, ground, width);
  W.scene.add(bolt);
  const b = { g: bolt, t: 0, peak: amp, glow: null, glowSize: near ? 9 : 40 };
  if (near) {
    b.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xb8c8ff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    b.glow.position.copy(ground).y += 0.8;
    W.scene.add(b.glow);
    spawnScorch(W.scene, ground.x, ground.z, rnd(2.4, 3.4));
    for (let k = 0; k < 14; k++) { const an = rnd(0, 6.28), sp = rnd(3, 9); puff(ground.x, ground.y + 0.4, ground.z, { color: 0xd8e0ff, size: rnd(0.3, 0.6), life: rnd(0.2, 0.45), opacity: 1, additive: true, vx: Math.cos(an) * sp, vz: Math.sin(an) * sp, vy: rnd(2, 7), grav: 12, drag: 1 }); }
    puff(ground.x, ground.y + 1, ground.z, { color: 0x6a6870, size: 2.5, grow: 3, life: 2.4, opacity: 0.35, vy: 1.4, drag: 0.8 });
    state.shake = Math.max(state.shake, 0.22);
  }
  W.bolts.push(b);
  audio.play('thunder', { vol: near ? 1 : rnd(0.55, 0.85), delay: near ? 0.03 : rnd(0.7, 2.6), size: near ? 1 : rnd(0, 0.35) });
}
