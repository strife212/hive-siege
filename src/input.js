import * as THREE from 'three';
import { state, canPlace, placeStructure, log } from './game.js';
import { worldToCell, cellToWorld, cellKey, heightAt } from './terrain.js';
import { makeBuildingMesh, ghostify } from './entities.js';

export function createInput({ renderer, camera, scene, terrain, ui }) {
  const el = renderer.domElement;
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let ghost = null, ghostType = null;
  let down = null;

  function pick(ev) {
    ndc.set((ev.clientX / innerWidth) * 2 - 1, -(ev.clientY / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObject(terrain, false)[0];
    return hit ? hit.point : null;
  }

  function setBuild(type) {
    if (ghost) { scene.remove(ghost); ghost = null; }
    ghostType = type;
    if (type) {
      ghost = makeBuildingMesh(type);
      ghostify(ghost, true);
      ghost.visible = false;
      scene.add(ghost);
    }
  }

  function updateGhost(ev) {
    if (!ghost) return;
    const p = pick(ev);
    if (!p) { ghost.visible = false; return; }
    const c = worldToCell(p.x, p.z);
    const w = cellToWorld(c.i, c.j);
    ghost.visible = true;
    ghost.position.set(w.x, heightAt(w.x, w.z) - 0.15, w.z);
    ghostify(ghost, canPlace(ghostType, c.i, c.j).ok);
  }

  el.addEventListener('pointermove', updateGhost);
  el.addEventListener('pointerdown', (ev) => { down = { x: ev.clientX, y: ev.clientY, b: ev.button }; });
  el.addEventListener('pointerup', (ev) => {
    if (!down) return;
    const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y);
    down = null;
    if (moved > 5) return;                                   // it was a drag (camera), not a click
    if (ev.button === 2) { ghostType ? ui.cancel() : ui.showSelected(null); return; }
    if (ev.button !== 0) return;
    const p = pick(ev);
    if (!p) return;
    const c = worldToCell(p.x, p.z);
    if (ghostType) {
      const res = canPlace(ghostType, c.i, c.j);
      if (!res.ok) return log(res.reason, true);
      placeStructure(ghostType, c.i, c.j);
      // Walls (or shift-click) keep placement mode active for quick building.
      if (ghostType === 'wall' || ev.shiftKey) updateGhost(ev);
      else ui.cancel();
    } else {
      ui.showSelected(state.occ.get(cellKey(c.i, c.j)) || null);
    }
  });
  addEventListener('keydown', (e) => {
    if (e.code === 'Escape') { ui.cancel(); ui.showSelected(null); }
  });

  return { setBuild };
}
