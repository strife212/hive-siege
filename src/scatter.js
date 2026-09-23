import * as THREE from 'three';
import { sampleTerrain, EXTENT, isScenery } from './terrain.js';
import { HALF, FLAT, MAP } from './config.js';
import { terrainTextures } from './textures.js';
import { WEATHER_U } from './surface.js';

// Instanced decoration: low-poly rocks everywhere (bigger in the mountains) and glowing crystals on moss.
function seeded(seed) {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
}

function rockGeometry(rnd) {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position;
  // Jitter shared corners consistently by rounding to a key, so faces stay closed.
  const seen = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let j = seen.get(key);
    if (!j) { j = [(rnd() - 0.5) * 0.3, (rnd() - 0.5) * 0.3, (rnd() - 0.5) * 0.3]; seen.set(key, j); }
    p.setXYZ(i, p.getX(i) + j[0], p.getY(i) + j[1], p.getZ(i) + j[2]);
  }
  g.computeVertexNormals();
  return g;
}

// Boulders wear the same rock texture as the cliffs (world-space triplanar, canyon strata tint included) so they read
// as broken-off pieces of the terrain, and darken toward their buried base.
function rockMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true });
  const tex = terrainTextures();
  if (!tex) { mat.color.set(0x6b6b72); return mat; }
  mat.customProgramCacheKey = () => 'scatter-rock';
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.tRock = { value: tex.rock.map };
    shader.uniforms.uCanyon = { value: MAP === 'canyon' ? 1 : 0 };
    shader.uniforms.uWet = WEATHER_U.wet;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vRockPos; varying float vRockY;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 rp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          rp = instanceMatrix * rp;
        #endif
        vRockPos = (modelMatrix * rp).xyz;
        vRockY = position.y;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D tRock; uniform float uCanyon, uWet; varying vec3 vRockPos; varying float vRockY;`)
      .replace('#include <map_fragment>', `
        vec3 rn = abs(normalize(cross(dFdx(vRockPos), dFdy(vRockPos))));
        vec3 rw = pow(rn, vec3(4.0)); rw /= (rw.x + rw.y + rw.z);
        vec3 rockC = texture2D(tRock, vRockPos.zy * 0.3).rgb * rw.x + texture2D(tRock, vRockPos.xz * 0.3).rgb * rw.y + texture2D(tRock, vRockPos.xy * 0.3).rgb * rw.z;
        float band = sin(vRockPos.y * 2.6 + sin(vRockPos.x * 0.11 + vRockPos.z * 0.07) * 2.0) * 0.5 + 0.5;
        vec3 strata = mix(vec3(1.18, 0.78, 0.55), vec3(1.5, 1.12, 0.82), band) * (0.8 + 0.2 * (1.0 - rn.y));
        rockC *= mix(vec3(1.0), strata, uCanyon);
        diffuseColor.rgb *= rockC * 1.12 * mix(0.5, 1.0, smoothstep(-0.55, 0.25, vRockY)) * (1.0 - 0.38 * uWet);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n        roughnessFactor = mix(roughnessFactor, 0.38, uWet);');
  };
  return mat;
}

export function createScatter() {
  const rnd = seeded(4242);
  const group = new THREE.Group();
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), v = new THREE.Vector3();

  const rocks = [];
  const crystals = [];
  let tries = 0;
  while ((rocks.length < 1300 || crystals.length < 180) && tries++ < 30000) {
    const x = (rnd() * 2 - 1) * (EXTENT - 2), z = (rnd() * 2 - 1) * (EXTENT - 2);
    const r = Math.hypot(x, z);
    if (r < 7) continue;
    const d = Math.max(Math.abs(x), Math.abs(z));
    const t = sampleTerrain(x, z);
    const outside = isScenery(x, z);
    if (rocks.length < 1300 && rnd() < 0.12 + 0.8 * t.rock + (outside ? 0.35 : 0)) {
      const base = outside ? 0.8 + rnd() * 2.6 : d > HALF + 3 ? 0.3 + rnd() * 0.9 : 0.22 + rnd() * 0.55;
      rocks.push({ x, z, y: t.h - base * 0.25, sx: base * (0.7 + rnd() * 0.6), sy: base * (0.5 + rnd() * 0.5), sz: base * (0.7 + rnd() * 0.6), rot: rnd() * Math.PI * 2 });
    } else if (crystals.length < 180 && !outside && t.moss > 0.55 && rnd() < 0.5) {
      const n = 1 + Math.floor(rnd() * 3);
      for (let k = 0; k < n && crystals.length < 180; k++) {
        const ox = (rnd() - 0.5) * 1.2, oz = (rnd() - 0.5) * 1.2;
        const h = 0.35 + rnd() * 0.75;
        crystals.push({ x: x + ox, z: z + oz, y: sampleTerrain(x + ox, z + oz).h - 0.1, h, tilt: (rnd() - 0.5) * 0.5, rot: rnd() * Math.PI * 2 });
      }
    }
  }

  const rockMesh = new THREE.InstancedMesh(
    rockGeometry(rnd),
    rockMaterial(),
    rocks.length,
  );
  rocks.forEach((rk, i) => {
    e.set(rnd() * 0.6, rk.rot, rnd() * 0.6);
    m.compose(v.set(rk.x, rk.y, rk.z), q.setFromEuler(e), s.set(rk.sx, rk.sy, rk.sz));
    rockMesh.setMatrixAt(i, m);
  });
  rockMesh.castShadow = rockMesh.receiveShadow = true;
  group.add(rockMesh);

  const crystalMesh = new THREE.InstancedMesh(
    new THREE.OctahedronGeometry(1, 0),
    new THREE.MeshStandardMaterial({ color: 0x2e8f8a, emissive: 0x1c9c92, emissiveIntensity: 0.55, roughness: 0.3, metalness: 0.05, flatShading: true }),
    crystals.length,
  );
  crystals.forEach((c, i) => {
    e.set(c.tilt, c.rot, c.tilt * 0.7);
    m.compose(v.set(c.x, c.y + c.h * 0.6, c.z), q.setFromEuler(e), s.set(c.h * 0.22, c.h, c.h * 0.22));
    crystalMesh.setMatrixAt(i, m);
  });
  crystalMesh.castShadow = true;
  group.add(crystalMesh);

  return group;
}
