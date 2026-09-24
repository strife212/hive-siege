import * as THREE from 'three';
import { state, canPlace, placeStructure, log, anchorFor, footprintCenter, footprint, wallLinks } from './game.js';
import { BUILDINGS, CELL } from './config.js';
import { worldToCell, cellToWorld, cellKey, heightAt, pickTerrain } from './terrain.js';
import { makeBuildingMesh, ghostify, setWallLinks } from './entities.js';
import { abilities, ABILITIES } from './abilities.js';
import { troopers } from './troopers.js';
import { MOBILE } from './mobile.js';

// Touch screens have no hover, so a tap only aims (it puts down the ghost building, or the strike's target ring) and a
// second tap on it commits; in phone mode the touch bar's confirm button does the same. A one-finger drag pans the
// camera (no drag-select), two fingers pinch-zoom and turn it, and while the Orbital Laser burns a drag steers it.
const TAP_SLOP = 10;                                          // px a finger may wander and still count as a tap
const RETAP = 48;                                             // px: a second tap this close to the first commits

export function createInput({ renderer, camera, scene, terrain, ui, controls }) {
  const el = renderer.domElement;
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let ghost = null, ghostType = null;
  let down = null;
  const fingers = new Set();                                  // touch points on the canvas
  let pending = null;                                         // touch: aimed but not committed yet
  const selBox = document.getElementById('selbox');
  const boxing = () => down && down.b === 0 && !down.touch && !ghostType && !abilities.armed && !abilities.laserActive;

  function pick(ev) {
    ndc.set((ev.clientX / innerWidth) * 2 - 1, -(ev.clientY / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return pickTerrain(ray.ray);
  }

  function setBuild(type) {
    if (ghost) { scene.remove(ghost); ghost = null; }
    ghostType = type;
    pending = null;
    terrain.material.userData.setGrid?.(type ? 1 : 0);
    if (type) {
      ghost = makeBuildingMesh(type);
      ghostify(ghost, true);
      ghost.visible = false;
      scene.add(ghost);
    }
  }

  function showGhost(c) {
    const w = footprintCenter(ghostType, c.i, c.j);
    ghost.visible = true;
    ghost.position.set(w.x, heightAt(w.x, w.z) - 0.15, w.z);
    if (ghostType === 'wall') setWallLinks(ghost, wallLinks(c.i, c.j));
    ghostify(ghost, canPlace(ghostType, c.i, c.j).ok);
  }

  function updateGhost(ev) {
    if (!ghost) return;
    const p = pick(ev);
    if (!p) { ghost.visible = false; return; }
    showGhost(anchorFor(ghostType, p.x, p.z));
  }

  // Place the current building at anchor cell c. Returns false (with the reason logged) if it cannot go there.
  function build(c, again) {
    const res = canPlace(ghostType, c.i, c.j);
    if (!res.ok) { log(res.reason, true); return false; }
    placeStructure(ghostType, c.i, c.j);
    // Walls (or shift-click) keep placement mode active for quick building.
    if (!again && ghostType !== 'wall') ui.cancel();
    return true;
  }

  // ---- touch: aim, then commit
  const onGhost = (p, c) => {                                 // is ground point p on the ghost at anchor cell c?
    const [w, h] = footprint(ghostType), m = footprintCenter(ghostType, c.i, c.j);
    return Math.abs(p.x - m.x) <= (w / 2 + 0.25) * CELL && Math.abs(p.z - m.z) <= (h / 2 + 0.25) * CELL;
  };
  const aimValid = () => pending && (pending.type
    ? pending.type === ghostType
    : pending.seq === abilities.seq);                         // the same strike still armed (not re-armed since)

  function commit() {
    if (!aimValid()) return;
    const a = pending;
    pending = null;
    if (a.type) {
      if (build(a.c, false)) { if (ghost) ghost.visible = false; }   // walls: the next tap aims the next piece
      else pending = a;
    } else abilities.click(a.p);
  }

  function tap(ev, p) {
    if (abilities.armed) {
      const def = ABILITIES[abilities.armed];
      if (def.line && !abilities.anchored) { pending = null; abilities.click(p); return; }   // bomber: pin the run first
      if (aimValid() && (def.global || Math.hypot(ev.clientX - pending.x, ev.clientY - pending.y) < RETAP)) return commit();
      pending = { x: ev.clientX, y: ev.clientY, p, seq: abilities.seq };
      abilities.hover(p);
      return;
    }
    if (ghostType) {
      if (aimValid() && onGhost(p, pending.c)) return commit();
      const c = anchorFor(ghostType, p.x, p.z);
      pending = { x: ev.clientX, y: ev.clientY, c, type: ghostType };
      showGhost(c);
      return;
    }
    pending = null;
    abilities.steer(p);
    const n = troopers.selectSquad(p);
    if (n) { ui.showSelected(null); log(`${n} trooper${n > 1 ? 's' : ''} selected: tap the ground to move them`); }
    else if (troopers.selectedCount) troopers.order(p);
    else { const c = worldToCell(p.x, p.z); ui.showSelected(state.occ.get(cellKey(c.i, c.j)) || null); }
  }

  el.addEventListener('pointermove', (ev) => {
    if (state.intro) return;
    if (ev.pointerType === 'touch') {                          // no hover on a touch screen: only a laser drag
      if (abilities.laserActive && down && !down.multi && fingers.size === 1) abilities.steer(pick(ev));
      return;
    }
    updateGhost(ev);
    if (boxing() && Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 5) {            // drag-select troopers
      down.box = true;
      Object.assign(selBox.style, { display: 'block', left: `${Math.min(down.x, ev.clientX)}px`, top: `${Math.min(down.y, ev.clientY)}px`,
        width: `${Math.abs(ev.clientX - down.x)}px`, height: `${Math.abs(ev.clientY - down.y)}px` });
    }
    if (abilities.armed || abilities.laserActive) abilities.hover(pick(ev));
  });
  el.addEventListener('pointerdown', (ev) => {
    const touch = ev.pointerType === 'touch';
    if (touch) {
      fingers.add(ev.pointerId);
      if (down && fingers.size > 1) { down.multi = true; return; }                 // a pinch or a turn, not a tap
    }
    down = { x: ev.clientX, y: ev.clientY, b: ev.button, touch };
    if (ev.button === 0) el.setPointerCapture?.(ev.pointerId);
  });
  el.addEventListener('pointercancel', (ev) => { fingers.delete(ev.pointerId); if (!fingers.size) down = null; });
  el.addEventListener('pointerup', (ev) => {
    if (ev.pointerType === 'touch') fingers.delete(ev.pointerId);
    if (!down || state.intro) return;
    if (down.multi) { if (!fingers.size) down = null; return; }
    const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y);
    const box = down.box ? down : null, touch = down.touch;
    down = null;
    selBox.style.display = 'none';
    if (box) {
      const n = troopers.selectBox(box.x, box.y, ev.clientX, ev.clientY, camera, ev.shiftKey);
      if (n) { ui.showSelected(null); log(`${n} trooper${n > 1 ? 's' : ''} selected: click to move, right-click to release`); }
      return;
    }
    if (moved > (touch ? TAP_SLOP : 5)) return;              // it was a drag (camera), not a click
    if (ev.button === 2) {
      if (abilities.armed) abilities.cancel(); else if (ghostType) ui.cancel();
      else if (troopers.selectedCount) troopers.clearSelection(); else ui.showSelected(null);
      return;
    }
    if (ev.button !== 0) return;
    const p = pick(ev);
    if (!p) return;
    if (touch) return tap(ev, p);
    if (abilities.armed || abilities.laserActive) { if (abilities.click(p)) return; }
    const c = ghostType ? anchorFor(ghostType, p.x, p.z) : worldToCell(p.x, p.z);
    if (ghostType) {
      if (build(c, ev.shiftKey) && (ghostType === 'wall' || ev.shiftKey)) updateGhost(ev);
    } else if (troopers.selectAt(p, ev.shiftKey)) {
      ui.showSelected(null);
    } else if (troopers.selectedCount) {
      troopers.order(p);
    } else {
      ui.showSelected(state.occ.get(cellKey(c.i, c.j)) || null);
    }
  });
  function cancelAll() { pending = null; abilities.cancel(); ui.cancel(); ui.showSelected(null); troopers.clearSelection(); }
  addEventListener('keydown', (e) => { if (e.code === 'Escape') cancelAll(); });

  // ---- phone mode: the touch bar (what a tap will do, confirm, cancel), since there is no right-click or Esc
  const bar = MOBILE ? document.getElementById('touchbar') : null;
  let barSig = '';
  if (bar) {
    bar.innerHTML = '<span></span><button class="go" type="button"></button><button class="x" type="button" aria-label="Cancel">✕</button>';
    bar.querySelector('.go').addEventListener('click', commit);
    bar.querySelector('.x').addEventListener('click', cancelAll);
  }
  function syncBar() {
    let text = '', go = '', ok = false, x = 'CANCEL';
    const aimed = aimValid();
    if (abilities.armed) {
      const def = ABILITIES[abilities.armed];
      text = def.name;
      go = def.global ? 'LAUNCH' : 'FIRE';
      text += def.line && !abilities.anchored ? ' · tap a point on the run'
        : aimed ? ` · tap again to ${def.global ? 'launch' : 'fire'}`
        : def.global ? ' · tap the map' : def.line ? ' · tap a direction' : ' · tap a target';
      ok = aimed;
    } else if (ghostType) {
      const def = BUILDINGS[ghostType];
      go = `BUILD $${def.cost.toLocaleString('en-US')}`;
      ok = aimed && canPlace(ghostType, pending.c.i, pending.c.j).ok;
      text = `${def.name} · ${!aimed ? 'tap to place' : ok ? 'tap again to build' : canPlace(ghostType, pending.c.i, pending.c.j).reason}`;
    } else if (troopers.selectedCount) {
      const n = troopers.selectedCount;
      text = `${n} trooper${n > 1 ? 's' : ''} · tap to move`;
      x = 'RELEASE';
    }
    const sig = `${text}|${go}|${ok}|${x}`;
    if (sig === barSig) return;
    barSig = sig;
    bar.hidden = !text;
    bar.querySelector('span').textContent = text;
    const b = bar.querySelector('.go');
    b.textContent = go; b.hidden = !go; b.disabled = !ok;
    bar.querySelector('.x').textContent = x;
  }

  return {
    setBuild,
    // Per frame: the touch bar, and one-finger drags steer the laser instead of panning while it burns.
    update() {
      controls.touches.ONE = abilities.laserActive ? null : THREE.TOUCH.PAN;
      if (bar) syncBar();
    },
  };
}
