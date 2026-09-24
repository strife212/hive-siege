import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Static-part merging for buildings. A building is modelled from dozens (the uplink mast: 146) of small meshes, and
// each one costs a draw call in the main pass and another in the shadow pass. Parts that never move relative to each
// other are merged here, once, into one mesh per material, so a base draws a fraction of the calls with the same
// triangles and the same materials.
//
// What moves is found from userData: every object a building's userData refers to (turret heads, barrels, doors,
// lamps, the parked aircraft, the wall arms...) is left in place as a "frame", and only the plain parts under each
// frame are merged, into that frame. Anything the code animates must therefore be reachable from userData.
// Left alone as well: transparent parts (they are depth-sorted one by one), hidden parts, mirrored parts, and anything
// with children or custom callbacks.
//
// worn() materials texture a part from its own local position and normal, which merging would change, so merged
// geometry carries each part's original ones in `wearPos` (w = 2 marks them as present) and `wearNrm` (surface.js).

const _rel = new THREE.Matrix4(), _inv = new THREE.Matrix4();
const noCallback = THREE.Object3D.prototype.onBeforeRender;

function liveNodes(root) {
  const live = new Set(), seen = new Set();
  const collect = (v, depth) => {
    if (!v || typeof v !== 'object' || seen.has(v) || depth > 4) return;
    seen.add(v);
    if (v.isObject3D) { live.add(v); return; }
    if (v.isMaterial || v.isTexture || v.isBufferGeometry || ArrayBuffer.isView(v) || v instanceof HTMLElement) return;
    for (const x of Array.isArray(v) ? v : Object.values(v)) collect(x, depth + 1);
  };
  root.traverse((o) => { for (const v of Object.values(o.userData)) collect(v, 0); });
  live.delete(root);
  return live;
}

const signature = (geo) => Object.keys(geo.attributes).sort().map((k) => {
  const a = geo.attributes[k];
  return `${k}:${a.itemSize}:${a.normalized}:${a.array.constructor.name}`;
}).join('|') + (geo.index ? '|idx' : '');

export function bakeStatic(root) {
  root.updateMatrixWorld(true);
  const live = liveNodes(root);
  const buckets = new Map();                                // "frame id / material / flags / attributes" -> parts
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || live.has(o) || !o.visible || o.children.length) return;
    const mat = o.material, geo = o.geometry;
    if (Array.isArray(mat) || mat.transparent || o.onBeforeRender !== noCallback || o.customDepthMaterial || o.customDistanceMaterial) return;
    if (Object.keys(geo.morphAttributes).length || geo.drawRange.start !== 0 || geo.drawRange.count !== Infinity) return;
    let frame = o.parent;
    for (; frame !== root && !live.has(frame); frame = frame.parent) if (!frame.visible) return;
    _rel.copy(_inv.copy(frame.matrixWorld).invert()).multiply(o.matrixWorld);
    if (_rel.determinant() < 0) return;                     // mirrored: baking it would turn its faces inside out
    const key = `${frame.id}/${mat.id}/${o.castShadow}/${o.receiveShadow}/${o.renderOrder}/${o.frustumCulled}/${o.layers.mask}/${signature(geo)}`;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { frame, parts: [] }));
    b.parts.push({ o, rel: _rel.clone() });
  });

  for (const { frame, parts } of buckets.values()) {
    if (parts.length < 2) continue;
    const src = parts[0].o;
    const wornMat = !!src.material.userData.worn;
    const geos = parts.map(({ o, rel }) => {
      const g = o.geometry.clone();
      g.clearGroups();
      if (wornMat) {
        const p = g.attributes.position, n = g.attributes.normal, wp = new Float32Array(p.count * 4);
        for (let i = 0; i < p.count; i++) wp.set([p.getX(i), p.getY(i), p.getZ(i), 2], i * 4);
        g.setAttribute('wearPos', new THREE.BufferAttribute(wp, 4));
        g.setAttribute('wearNrm', n ? n.clone() : new THREE.BufferAttribute(new Float32Array(p.count * 3), 3));
      }
      return g.applyMatrix4(rel);
    });
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;                                  // incompatible after all: leave these parts as they are
    const m = new THREE.Mesh(merged, src.material);
    for (const k of ['castShadow', 'receiveShadow', 'renderOrder', 'frustumCulled']) m[k] = src[k];
    m.layers.mask = src.layers.mask;
    m.name = 'baked';
    frame.add(m);
    for (const { o } of parts) o.parent.remove(o);
  }

  // drop the plain groups that were only there to place parts and are empty now
  (function prune(o) {
    for (let i = o.children.length - 1; i >= 0; i--) {
      const c = o.children[i];
      prune(c);
      if (c.type === 'Group' && !c.children.length && !live.has(c) && !Object.keys(c.userData).length) o.remove(c);
    }
  })(root);
  return root;
}
