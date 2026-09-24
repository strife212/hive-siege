import * as THREE from 'three';

// Shared pieces of the instanced renderers (swarm, gore, flame, walls, HP bars, casings, gibs).

// Upload only the first n instances of an attribute: the buffers are sized for the worst case, and sending all of
// them every frame moved megabytes over the bus however few were in use. Nothing past n is drawn, so it can stay stale.
export function uploadUsed(attr, n) {
  attr.clearUpdateRanges();
  if (n <= 0) return;
  attr.addUpdateRange(0, n * attr.itemSize);
  attr.needsUpdate = true;
}

// One InstancedMesh standing in for a crowd of short-lived copies of a mesh (casings, gibs). The instances move every
// frame, so it is never frustum culled (there are no stable bounds to cull by).
export function instancePool(geometry, material, cap) {
  const im = new THREE.InstancedMesh(geometry, material, cap);
  im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  im.frustumCulled = false;
  im.count = 0;
  return im;
}
