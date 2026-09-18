import * as THREE from 'three';
import { state, canPlace, placeStructure, log, anchorFor, footprintCenter } from './game.js';
import { worldToCell, cellToWorld, cellKey, heightAt, pickTerrain } from './terrain.js';
import { makeBuildingMesh, ghostify } from './entities.js';
import { abilities } from './abilities.js';

export function createInput({ renderer, camera, scene, terrain, ui }) {
  const el = renderer.domElement;
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let ghost = null, ghostType = null;
  let down = null;

  function pick(ev) {
    ndc.set((ev.clientX / innerWidth) * 2 - 1, -(ev.clientY / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return pickTerrain(ray.ray);
  }

  function setBuild(type) {
    if (ghost) { scene.remove(ghost); ghost = null; }
    ghostType = type;
    terrain.material.userData.setGrid?.(type ? 1 : 0);
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
    const c = anchorFor(ghostType, p.x, p.z);
    const w = footprintCenter(ghostType, c.i, c.j);
    ghost.visible = true;
    ghost.position.set(w.x, heightAt(w.x, w.z) - 0.15, w.z);
    ghostify(ghost, canPlace(ghostType, c.i, c.j).ok);
  }

  el.addEventListener('pointermove', (ev) => {
    if (state.intro) return;
    updateGhost(ev);
    if (abilities.armed || abilities.laserActive) abilities.hover(pick(ev));
  });
  el.addEventListener('pointerdown', (ev) => { down = { x: ev.clientX, y: ev.clientY, b: ev.button }; });
  el.addEventListener('pointerup', (ev) => {
    if (!down || state.intro) return;
    const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y);
    down = null;
    if (moved > 5) return;                                   // it was a drag (camera), not a click
    if (ev.button === 2) { if (abilities.armed) abilities.cancel(); else if (ghostType) ui.cancel(); else ui.showSelected(null); return; }
    if (ev.button !== 0) return;
    const p = pick(ev);
    if (!p) return;
    if (abilities.armed || abilities.laserActive) { if (abilities.click(p)) return; }
    const c = ghostType ? anchorFor(ghostType, p.x, p.z) : worldToCell(p.x, p.z);
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
    if (e.code === 'Escape') { abilities.cancel(); ui.cancel(); ui.showSelected(null); }
  });

  return { setBuild };
}
