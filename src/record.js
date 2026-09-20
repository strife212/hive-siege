import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { audio } from './audio.js';
import * as THREE from 'three';
import { state, spawnEnemy, canPlace, placeStructure } from './game.js';
import { abilities } from './abilities.js';
import { heightAt } from './terrain.js';
import { SCENE } from './config.js';

// Offline video capture: ?record=<seconds>[&scene=bomber][&fps=60][&warm=25][&nosfx=name,name]. Without a scene it
// films the title-screen demo; with one it films a scripted scene from SCENES below.
// The sim is stepped at a fixed dt, every rendered frame goes through WebCodecs (H.264), and the game audio is
// rendered by an OfflineAudioContext that is suspended at each frame boundary so sounds land exactly where they
// happen. The finished MP4 is POSTed to the dev server (/__save, see vite.config.js) which writes it to recordings/.
const W = 1920, H = 1080;

// Scripted scenes (?scene=<name>): setup() dresses the map once the intro is out of the way, direct(t, dt) runs every
// frame of the take with t = seconds into the clip and owns the camera. `ear` is where the audio listener sits.
const ear = { x: 0, z: -14 };
const SCENES = {
  // Open map: one Gunship Pad, a loose scatter of bugs wandering in, and a chase camera on the VTOL as it hunts them.
  vtol: {
    warm: 4, preroll: 6.2,                                        // preroll: pad comes up out of its silo, aircraft arms and lifts off before the take
    spawnBug(far) {
      const a = Math.random() * Math.PI * 2, r = far ? 46 + Math.random() * 10 : 30 + Math.random() * 25;
      const e = spawnEnemy(Math.random() < 0.14 ? 'brute' : 'skitter', Math.cos(a) * r, Math.sin(a) * r, true);
      e.speed *= 0.4;                                              // ambling, so the gunship has to go out and find them
      return e;
    },
    setup() {
      state.core.hp = state.core.maxHp = 1e9;
      state.credits = 1e6;
      for (const [i, j] of [[24, 22], [25, 23], [23, 24], [26, 21]]) if (canPlace('heli', i, j).ok) { this.pad = placeStructure('heli', i, j); break; }
      for (let k = 0; k < 15; k++) this.spawnBug(false);
      this.look = null; this.cam = null; this.orbit = 0.6; this.topUp = 0;
    },
    direct(t, dt, camera) {
      // keep a dozen or so targets about, arriving one at a time from the rim
      this.topUp -= dt;
      if (this.topUp <= 0 && state.enemies.length < 12) { this.topUp = 0.7; this.spawnBug(true); }
      const craft = this.pad.mesh.userData.heli, P = craft.getWorldPosition(new THREE.Vector3());
      const tgt = this.pad.heli?.target;
      const aim = tgt && !tgt.dead ? new THREE.Vector3(tgt.x, heightAt(tgt.x, tgt.z), tgt.z) : P.clone().setY(P.y - 4);
      // chase camera: drifts around the aircraft, a little above it, framing the gunship with whatever it is shooting
      this.orbit += dt * 0.22;
      const want = new THREE.Vector3(P.x + Math.sin(this.orbit) * 13, P.y + 3.2, P.z + Math.cos(this.orbit) * 13);
      want.y = Math.max(want.y, heightAt(want.x, want.z) + 2.5);
      const goal = P.clone().lerp(aim, 0.2);                       // mostly on the aircraft, leaning toward what it is shooting
      if (!this.cam) { this.cam = want.clone(); this.look = goal.clone(); }
      this.cam.lerp(want, Math.min(1, dt * 2.2));
      this.look.lerp(goal, Math.min(1, dt * 4));
      camera.position.copy(this.cam);
      camera.lookAt(this.look);
      ear.x = this.cam.x; ear.z = this.cam.z;
    },
  },
  // Open map: a dense column of bugs marches on the Core, a strategic bomber carpets it end to end, and the camera
  // follows the aircraft out, zooming in as it leaves.
  bomber: {
    warm: 4,
    setup({ scene }) {
      state.core.hp = state.core.maxHp = 1e9;
      for (let k = 0; k < 460; k++) {
        const e = spawnEnemy(k % 8 === 7 ? 'brute' : 'skitter', 31 + Math.random() * 28, (Math.random() - 0.5) * 9.5, true);
        e.fx = -1; e.fz = 0;
      }
      this.called = false; this.plane = null; this.scene = scene;
      this.look = new THREE.Vector3(44, 1, 0);
    },
    direct(t, dt, camera) {
      if (!this.called && t >= 2.4) {                             // path: pinned on the column, heading down it toward the base
        this.called = true;
        abilities.arm('bomber');
        abilities.click({ x: 45, z: 0 });
        abilities.click({ x: 20, z: 0 });
      }
      if (this.called && !this.plane) {
        this.plane = this.scene.getObjectByName('bomber') || null;
        if (this.plane) this.plane.traverse((o) => { if (o.material && o.material.fog) { o.material.fog = false; o.material.needsUpdate = true; } });   // stays crisp into the distance
      }
      const P = this.plane && this.plane.parent ? this.plane.position : null;
      let fov = 50, goal;
      if (t < 4.7) {                                               // crane shot along the advancing column
        const u = t / 4.7, s = u * u * (3 - 2 * u), front = 31 - 4.8 * t;
        camera.position.set(66 - 22 * s, 8 + 13 * s, 15 + 17 * s);
        goal = new THREE.Vector3(front + 13, 0.5, 0);
        this.look.copy(goal);
        ear.x = 45; ear.z = 8;
      } else if (t < 7.7) {                                        // wide side-on: the stick of bombs walking down the column
        const u = (t - 4.7) / 3;
        camera.position.set(34 - 10 * u, 9 + 2 * u, 46);
        ear.x = 25; ear.z = 30;
        fov = 64;
        goal = new THREE.Vector3(P ? Math.max(-6, Math.min(62, P.x + 4)) : 60, 17, 0);
        if (t < 4.75) this.look.copy(goal);
      } else {                                                     // it has passed over: swing round and follow it out on a long lens
        camera.position.set(9, heightAt(9, 18) + 3, 18);
        ear.x = 9; ear.z = 18;
        goal = P ? P.clone() : this.look.clone();
        if (t < 7.75) this.look.copy(goal);
        const zoom = Math.max(0, Math.min(1, (t - 8.3) / 3.6));
        fov = 50 - 43.5 * zoom * zoom * (3 - 2 * zoom);             // 50 deg down to 6.5 deg
      }
      this.look.lerp(goal, Math.min(1, dt * (t < 4.7 ? 8 : t < 7.7 ? 6 : 9)));
      camera.lookAt(this.look);
      if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
    },
  },
};
const status = (window.__record = { phase: 'init', frame: 0, frames: 0, file: null, error: null });

export async function record({ seconds, tick, renderer, camera, scene, setDirector }) {
  try {
    const q = new URLSearchParams(location.search);
    const script = SCENES[SCENE] || null;
    const fps = Number(q.get('fps')) || 60, warm = q.has('warm') ? Number(q.get('warm')) : script ? script.warm : 25;
    const frames = Math.round(seconds * fps), dt = 1 / fps;
    status.frames = frames;

    renderer.setPixelRatio(1);
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    const canvas = renderer.domElement;

    status.phase = 'loading audio';
    const ctx = await audio.beginOffline(seconds + 0.5, { skip: ['laser_beam', 'laser_tick', ...(q.get('nosfx') || '').split(',').filter(Boolean)], listener: ear });

    status.phase = 'warm-up';
    for (let k = 0; k < warm * 30; k++) { tick(1 / 30); if (k % 60 === 0) await new Promise((r) => setTimeout(r)); }
    const clock = { t: 0 };
    if (script) {
      if (state.intro) throw new Error('intro still running after warm-up');
      script.setup({ scene, camera });
      for (let k = 0; k < (script.preroll || 0) * 30; k++) { tick(1 / 30); if (k % 60 === 0) await new Promise((r) => setTimeout(r)); }
      setDirector((step) => script.direct(clock.t, step, camera));
    }

    const muxer = new Muxer({
      target: new ArrayBufferTarget(), fastStart: 'in-memory',
      video: { codec: 'avc', width: W, height: H, frameRate: fps },
      audio: { codec: 'aac', sampleRate: 48000, numberOfChannels: 2 },
    });
    const venc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { status.error = String(e); } });
    venc.configure({ codec: 'avc1.640028', width: W, height: H, bitrate: 16e6, framerate: fps });

    status.phase = 'rendering';
    audio.setPaused(false);
    let rendered = null;
    for (let f = 0; f < frames; f++) {
      if (f > 0) {
        const at = ctx.suspend(f * dt);                    // stop the audio render exactly at this frame's time
        if (f === 1) rendered = ctx.startRendering(); else ctx.resume();
        await at;
      }
      if (canvas.width !== W || canvas.height !== H) renderer.setSize(W, H, false);     // belt and braces: never let a
      if (camera.aspect !== W / H) { camera.aspect = W / H; camera.updateProjectionMatrix(); }   // window resize leak into the take
      clock.t = f * dt;
      tick(dt);
      if (canvas.width !== W || canvas.height !== H) status.badFrames = (status.badFrames || 0) + 1;
      const vf = new VideoFrame(canvas, { timestamp: Math.round(f * dt * 1e6), duration: Math.round(dt * 1e6) });
      venc.encode(vf, { keyFrame: f % (fps * 2) === 0 });
      vf.close();
      status.frame = f + 1;
      while (venc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 2));
    }
    audio.setPaused(true);
    ctx.resume();
    const buf = await rendered;
    await venc.flush();

    status.phase = 'encoding audio';
    const aenc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: (e) => { status.error = String(e); } });
    aenc.configure({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 });
    const total = Math.min(buf.length, Math.round(seconds * 48000)), L = buf.getChannelData(0), R = buf.getChannelData(1);
    for (let o = 0; o < total; o += 4800) {
      const n = Math.min(4800, total - o), data = new Float32Array(n * 2);
      data.set(L.subarray(o, o + n), 0);
      data.set(R.subarray(o, o + n), n);
      const ad = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(o / 48000 * 1e6), data });
      aenc.encode(ad);
      ad.close();
    }
    await aenc.flush();
    muxer.finalize();

    status.phase = 'saving';
    const name = `hive-siege-${SCENE || 'demo'}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.mp4`;
    const res = await fetch(`/__save?name=${encodeURIComponent(name)}`, { method: 'POST', body: muxer.target.buffer });
    if (!res.ok) throw new Error(`save failed: ${res.status}`);
    status.file = (await res.json()).path;
    status.bytes = muxer.target.buffer.byteLength;
    status.phase = 'done';
  } catch (e) {
    status.error = String(e && e.stack || e);
    status.phase = 'failed';
  }
}
