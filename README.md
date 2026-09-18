# Hive Siege — Alien Base Defense (proof of concept)

A three.js base-defense prototype: build walls, towers, refineries and a research lab on a
procedurally generated 3D terrain, then hold off waves of insectoid aliens that chew through
anything between them and your Core.

## Run

    npm install
    npm run dev

## Controls

| Input | Action |
| --- | --- |
| LMB | Place the selected building / select a structure |
| RMB drag | Rotate camera |
| MMB drag or WASD | Pan |
| Scroll | Zoom (to cursor) |
| Q / E | Rotate |
| Esc / RMB click | Cancel placement, deselect |
| Shift+click | Keep placing the same building (walls always do) |

## What is in the prototype

- **Terrain**: analytic value-noise heightmap (`src/terrain.js`) with a flatter plateau around the Core.
  Height is sampled analytically so bugs, buildings and projectiles never raycast the mesh.
- **Grid placement**: 40x40 cells of 2 units. Ghost preview turns red for occupied, out-of-bounds or
  too-steep cells, or when a bug is standing there.
- **Sidebar**: Red Alert style card list grouped by category, TECH tab for research, selected-structure
  panel with sell (50% refund).
- **Buildings**: Wall, Gun Turret (guided projectile), Laser Tower (hitscan beam, needs a Research Lab),
  Refinery (+3 credits/s), Research Lab (unlocks laser + tech).
- **Research**: Reinforced Plating (walls x2 HP), Overcharged Optics (laser +50%), HE Rounds (turret splash).
- **Enemies**: procedural insectoids with animated legs. Skitterers (fast, weak) and Brutes (from wave 3).
  They walk straight for the Core and attack whatever structure blocks their cell path.
- **Waves**: manual start, scaling counts and HP, 1-4 spawn nests shown as red rings, clear bonus.

## Debugging

`window.__game` is the live state and `window.__step(dt, n)` advances the simulation manually
(useful when the tab is hidden and requestAnimationFrame is paused).

## Layout

    src/config.js    tuning: costs, stats, map size
    src/noise.js     value noise / fbm
    src/terrain.js   heightmap, grid helpers, terrain mesh
    src/entities.js  procedural meshes (buildings, bugs, HP bars, beams, gibs)
    src/scene.js     renderer, lights, RTS camera controls
    src/game.js      game state, placement, towers, enemy AI, waves
    src/ui.js        sidebar DOM
    src/input.js     raycast picking, ghost preview, click handling
    src/main.js      bootstrap + loop
