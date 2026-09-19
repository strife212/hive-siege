import * as THREE from 'three';
import { state, canPlace, placeStructure, log, anchorFor, footprintCenter, wallLinks } from './game.js';
import { worldToCell, cellToWorld, cellKey, heightAt, pickTerrain } from './terrain.js';
import { makeBuildingMesh, ghostify, setWallLinks } from './entities.js';
import { abilities } from './abilities.js';
import { troopers } from './troopers.js';

export function createInput({ renderer, camera, scene, terrain, ui }) {
  const el = renderer.domElement;
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let ghost = null, ghostType = null;
  let down = null;
  const selBox = document.getElementById('selbox');
  const boxing = () => down && down.b === 0 && !ghostType && !abilities.armed && !abilities.laserActive;

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
    if (ghostType === 'wall') setWallLinks(ghost, wallLinks(c.i, c.j));
    ghostify(ghost, canPlace(ghostType, c.i, c.j).ok);
  }

  el.addEventListener('pointermove', (ev) => {
    if (state.intro) return;
    updateGhost(ev);
    if (boxing() && Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 5) {            // drag-select troopers
      down.box = true;
      Object.assign(selBox.style, { display: 'block', left: `${Math.min(down.x, ev.clientX)}px`, top: `${Math.min(down.y, ev.clientY)}px`,
        width: `${Math.abs(ev.clientX - down.x)}px`, height: `${Math.abs(ev.clientY - down.y)}px` });
    }
    if (abilities.armed || abilities.laserActive) abilities.hover(pick(ev));
  });
  el.addEventListener('pointerdown', (ev) => {
    down = { x: ev.clientX, y: ev.clientY, b: ev.button };
    if (ev.button === 0) el.setPointerCapture?.(ev.pointerId);
  });
  el.addEventListener('pointerup', (ev) => {
    if (!down || state.intro) return;
    const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y);
    const box = down.box ? down : null;
    down = null;
    selBox.style.display = 'none';
    if (box) {
      const n = troopers.selectBox(box.x, box.y, ev.clientX, ev.clientY, camera, ev.shiftKey);
      if (n) { ui.showSelected(null); log(`${n} trooper${n > 1 ? 's' : ''} selected: click to move, right-click to release`); }
      return;
    }
    if (moved > 5) return;                                   // it was a drag (camera), not a click
    if (ev.button === 2) {
      if (abilities.armed) abilities.cancel(); else if (ghostType) ui.cancel();
      else if (troopers.selectedCount) troopers.clearSelection(); else ui.showSelected(null);
      return;
    }
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
    } else if (troopers.selectAt(p, ev.shiftKey)) {
      ui.showSelected(null);
    } else if (troopers.selectedCount) {
      troopers.order(p);
    } else {
      ui.showSelected(state.occ.get(cellKey(c.i, c.j)) || null);
    }
  });
  addEventListener('keydown', (e) => {
    if (e.code === 'Escape') { abilities.cancel(); ui.cancel(); ui.showSelected(null); troopers.clearSelection(); }
  });

  return { setBuild };
}
