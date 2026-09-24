import * as THREE from 'three';
import { makeBuildingMesh } from './entities.js';

// Placed walls are drawn with instancing: one InstancedMesh per part of the wall model (the post's parts, and one
// arm's parts), holding an instance per wall (per shown arm for the arm parts). However many walls there are, they
// cost six draw calls and six shadow draws, where each wall on its own took a dozen or more.
//
// Every wall keeps its group (s.mesh) for everything else: position, sinking into its silo, visibility, and which
// arms show (setWallLinks). Only its meshes are taken out. Just before each render (after the world matrices update,
// before the shadow pass) the instances are copied from the groups' current transforms.
const CAP = 1600;                                    // one wall per grid cell at most (40 x 40)
let posts = null, arms = null;
const walls = new Set();
const _m = new THREE.Matrix4(), _box = new THREE.Box3();

function instanced(scene, src, cap) {
  const im = new THREE.InstancedMesh(src.geometry, src.material, cap);
  im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  im.castShadow = src.castShadow;
  im.receiveShadow = src.receiveShadow;
  im.frustumCulled = false;                          // the instances move; the whole set is a handful of draws anyway
  im.count = 0;
  scene.add(im);
  return { im, local: src.matrix.clone() };          // the part's placement in its group (the wall, or an arm)
}

const shown = (o) => { for (; o; o = o.parent) if (!o.visible) return false; return true; };

function sync() {
  let np = 0, na = 0;
  for (const g of walls) {
    if (!g.parent) { walls.delete(g); continue; }    // sold or destroyed: out of the scene
    if (!shown(g)) continue;                         // locked down in its silo
    for (const p of posts) p.im.setMatrixAt(np, _m.multiplyMatrices(g.matrixWorld, p.local));
    np++;
    for (const arm of Object.values(g.userData.arms)) {
      if (!arm.visible) continue;
      for (const p of arms) p.im.setMatrixAt(na, _m.multiplyMatrices(arm.matrixWorld, p.local));
      na++;
    }
  }
  for (const [list, n] of [[posts, np], [arms, na]]) {
    for (const { im } of list) {
      im.count = n;
      if (!n) continue;
      im.instanceMatrix.clearUpdateRanges();
      im.instanceMatrix.addUpdateRange(0, n * 16);
      im.instanceMatrix.needsUpdate = true;
    }
  }
}

export const wallBatch = {
  init(scene) {
    const t = makeBuildingMesh('wall');
    t.updateMatrixWorld(true);
    posts = t.children.filter((o) => o.isMesh).map((o) => instanced(scene, o, CAP));
    arms = t.userData.arms.e.children.filter((o) => o.isMesh).map((o) => instanced(scene, o, CAP * 4));
    const prev = scene.onBeforeRender;
    scene.onBeforeRender = function (...a) { prev.apply(this, a); sync(); };
  },
  // A placed wall: hand its drawing over to the instances. Its height is kept for the silo (retract.js measures
  // buildings by their meshes).
  add(g) {
    g.updateMatrixWorld(true);
    g.userData.stowHeight = _box.setFromObject(g).max.y - g.position.y;
    for (const o of [g, ...Object.values(g.userData.arms)]) for (const c of [...o.children]) if (c.isMesh) o.remove(c);
    walls.add(g);
  },
};
