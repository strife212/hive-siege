import * as THREE from 'three';

// Alien night sky: gradient, nebula haze, star field and a large planet on the horizon.
export const HORIZON = new THREE.Color(0.16, 0.10, 0.22);

export function createSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { uHorizon: { value: HORIZON }, uStorm: { value: 0 }, uFlash: { value: 0 }, uTime: { value: 0 }, uFlashDir: { value: new THREE.Vector3(0, 1, 0) } },   // storm + lightning driven by weather.js
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uHorizon, uFlashDir;
      uniform float uStorm, uFlash, uTime;
      varying vec3 vDir;
      float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }
      float noise3(vec3 p) {
        vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
          mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
      }
      float fbm3(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * noise3(p); p *= 2.1; a *= 0.5; } return s; }
      void main() {
        vec3 d = normalize(vDir);
        float t = clamp(d.y, -0.2, 1.0);
        vec3 zenith = vec3(0.015, 0.015, 0.04);
        vec3 col = mix(uHorizon, zenith, pow(smoothstep(-0.05, 0.65, t), 0.8));
        float up = smoothstep(0.0, 0.35, t);
        col += vec3(0.28, 0.08, 0.32) * smoothstep(0.45, 0.8, fbm3(d * 3.0)) * up * 0.9;
        col += vec3(0.05, 0.22, 0.30) * smoothstep(0.5, 0.85, fbm3(d * 4.0 + 7.0)) * up * 0.7;
        vec3 p = d * 260.0; vec3 ip = floor(p); vec3 fp = fract(p) - 0.5;
        float h = hash13(ip);
        float star = smoothstep(0.14, 0.0, length(fp)) * step(0.985, h) * (0.4 + 0.6 * hash13(ip + 3.0));
        col += star * up * 1.8;
        // Planet
        vec3 pd = normalize(vec3(0.55, 0.22, -0.8));
        float pr = 0.11;
        float dist = distance(d, pd);
        float disc = smoothstep(pr, pr - 0.004, dist);
        vec3 lightDir = normalize(vec3(0.6, 0.6, 0.3));
        vec3 pn = normalize(d - pd * dot(d, pd) * 0.0 - pd) ; // approx sphere normal
        pn = normalize((d - pd) / pr + pd * sqrt(max(0.0, 1.0 - dot((d - pd) / pr, (d - pd) / pr))));
        float lit = clamp(dot(pn, lightDir), 0.0, 1.0);
        float bands = 0.7 + 0.3 * sin(pn.y * 22.0 + fbm3(pn * 4.0) * 3.0);
        vec3 pcol = mix(vec3(0.35, 0.22, 0.14), vec3(0.75, 0.55, 0.35), bands) * (0.08 + lit * 1.1);
        col = mix(col, pcol, disc * (1.0 - uStorm));
        // Storm: a low, heavy overcast rolling across the whole sky, dark bellies and paler seams, blending into the
        // fog colour at the horizon; lightning lights the cloud deck from inside, brightest toward the strike.
        if (uStorm > 0.001) {
          vec2 cuv = d.xz / (max(d.y, 0.0) + 0.14) * 0.8 + vec2(uTime * 0.018, uTime * 0.007);
          float c1 = fbm3(vec3(cuv * 1.2, uTime * 0.015));
          float c2 = fbm3(vec3(cuv * 3.4 + 4.0, uTime * 0.03));
          float dens = smoothstep(0.32, 0.78, c1 * 0.72 + c2 * 0.28);
          vec3 base = mix(uHorizon * 1.08, vec3(0.05, 0.053, 0.066), pow(smoothstep(0.0, 0.7, t), 0.7));
          vec3 cloud = mix(base + vec3(0.018, 0.02, 0.026), base * 0.42, dens);
          vec3 storm = mix(uHorizon, cloud, smoothstep(-0.02, 0.22, t));
          float glow = pow(max(dot(d, uFlashDir), 0.0), 6.0);
          storm += uFlash * (0.22 + 1.9 * glow) * mix(vec3(0.3, 0.33, 0.46), vec3(0.78, 0.84, 1.0), dens) * (0.35 + dens);
          col = mix(col, storm, uStorm);
        }
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(600, 48, 24), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}
