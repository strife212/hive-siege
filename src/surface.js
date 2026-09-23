import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { perlinP, fbmP } from './noise.js';

// Shared hard-surface finish for every built model: bevelled boxes that catch an edge highlight, and a wear layer
// (grime, fine grain, paint chips) sampled triplanar in each part's own space, so it never swims when a turret turns
// and needs no UVs.

// Box with chamfered, smooth-shaded edges. Slivers (trim strips, gauge fills) stay plain: the bevel would eat them.
export function bevelBox(w, h, d, r) {
  const min = Math.min(w, h, d);
  if (min < 0.07) return new THREE.BoxGeometry(w, h, d);
  return new RoundedBoxGeometry(w, h, d, 1, r ?? Math.min(0.05, min * 0.22));
}

// Soft, pillowy box for sandbags and padding.
export function softBox(w, h, d, r) {
  return new RoundedBoxGeometry(w, h, d, 3, r ?? Math.min(w, h, d) * 0.42);
}

// Weather state shared by every material that reacts to rain (weather.js writes it): wet 0..1 soaks surfaces darker and
// glossier, rain 0..1 is how hard it is coming down right now (streaks, ripples), time drives the running water.
export const WEATHER_U = { wet: { value: 0 }, rain: { value: 0 }, time: { value: 0 }, sky: { value: new THREE.Color(0.12, 0.12, 0.15) } };   // sky: what puddles reflect

const S = 256;
let wearTex = null;
function wearTexture() {
  if (wearTex) return wearTex;
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      const grime = fbmP(u * 3, v * 3, 3, 4, 71) * 0.5 + 0.5;                                   // broad blotches
      const grain = fbmP(u * 10, v * 10, 10, 3, 72) * 0.5 + 0.5;                                // fine surface grain
      const scuff = 1 - Math.abs(perlinP(u * 9, v * 9, 9, 73));                                 // thin ridged scratches
      const chip = Math.max(0, Math.min(1, (perlinP(u * 11, v * 11, 11, 74) * 0.5 + 0.5 - 0.76) / 0.06))
        * Math.max(0, Math.min(1, (grime - 0.35) / 0.3));                                       // sparse chipped patches
      const k = (y * S + x) * 4;
      data[k] = Math.max(0, Math.min(1, grime)) * 255;
      data[k + 1] = Math.max(0, Math.min(1, grain * 0.8 + Math.pow(scuff, 18) * 0.35)) * 255;
      data[k + 2] = chip * 255;
      data[k + 3] = 255;
    }
  }
  wearTex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  wearTex.wrapS = wearTex.wrapT = THREE.RepeatWrapping;
  wearTex.minFilter = THREE.LinearMipmapLinearFilter;
  wearTex.magFilter = THREE.LinearFilter;
  wearTex.generateMipmaps = true;
  wearTex.anisotropy = 4;
  wearTex.needsUpdate = true;
  return wearTex;
}

// Patches a standard/physical material in place and returns it.
//   grime: how far the blotches darken the paint     rough: roughness swing from the grain
//   chips: exposed bare metal where paint has flaked  bump: micro relief strength      scale: texture repeats per unit
export function worn(mat, { grime = 0.22, rough = 0.22, chips = 0.5, bump = 0.5, scale = 0.6 } = {}) {
  const uniforms = {
    uWear: { value: wearTexture() },
    uWearP: { value: new THREE.Vector4(grime, rough, chips, bump) },
    uWearScale: { value: scale },
    uWetW: WEATHER_U.wet, uRainW: WEATHER_U.rain, uRainTW: WEATHER_U.time,
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWearPos;\nvarying vec3 vWearNrm;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWearPos = position;\nvWearNrm = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uWear; uniform vec4 uWearP; uniform float uWearScale;
        uniform float uWetW, uRainW, uRainTW;
        varying vec3 vWearPos; varying vec3 vWearNrm;
        vec3 wearSample; float wetStreak = 0.0;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 w = pow(abs(normalize(vWearNrm)), vec3(6.0)); w /= (w.x + w.y + w.z);
          vec3 p = vWearPos * uWearScale;
          wearSample = texture2D(uWear, p.zy).rgb * w.x + texture2D(uWear, p.xz).rgb * w.y + texture2D(uWear, p.xy).rgb * w.z;
          float dirt = smoothstep(0.3, 0.75, 1.0 - wearSample.r);
          diffuseColor.rgb *= 1.0 - uWearP.x * dirt;
          diffuseColor.rgb *= 0.96 + 0.08 * wearSample.g;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.43, 0.45), wearSample.b * uWearP.z);
          // rain: soaked surfaces go darker, and water runs down the vertical faces in streaks
          if (uWetW > 0.001) {
            float run = texture2D(uWear, vec2((vWearPos.x + vWearPos.z) * 2.3, vWearPos.y * 0.22 + uRainTW * 0.32)).g;
            wetStreak = smoothstep(0.56, 0.74, run) * (1.0 - w.y) * uRainW;
            diffuseColor.rgb *= (1.0 - 0.24 * uWetW) * (1.0 - 0.16 * wetStreak);
          }
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + (wearSample.g - 0.55) * uWearP.y + (1.0 - wearSample.r) * 0.12 * uWearP.y - wearSample.b * 0.25 * uWearP.z, 0.06, 1.0);
        roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.42, uWetW) * (1.0 - 0.5 * wetStreak);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, 0.85, wearSample.b * uWearP.z);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          float hgt = (wearSample.g * 0.5 + wearSample.r * 0.5 - wearSample.b * 0.6) * uWearP.w * 0.012;
          vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
          vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
          float det = dot(sx, r1);
          vec3 grad = sign(det) * (dFdx(hgt) * r1 + dFdy(hgt) * r2);
          normal = normalize(abs(det) * normal - grad);
        }`);
  };
  mat.customProgramCacheKey = () => 'worn';
  return mat;
}
