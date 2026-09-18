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

- **Terrain**: analytic domain-warped simplex heightmap (`src/terrain.js`) with a flatter plateau around
  the Core and ridged mountains beyond the playable square. Height is sampled analytically so bugs,
  buildings and mouse picking never raycast the 320k-triangle mesh (picking ray-marches the heightfield).
- **Terrain shading**: three procedurally generated tileable texture sets (soil, cracked rock, alien moss)
  with normal maps (`src/textures.js`), blended per-vertex by slope/height/patch noise inside an extended
  MeshStandardMaterial. Baked cavity AO in vertex colours, a glowing boundary line, darkening outside the
  playable area, and a cell grid that only shows while placing.
- **Atmosphere**: shader sky dome with nebula, stars and a planet (`src/sky.js`), matching fog, room
  environment lighting, instanced rocks and glowing crystals (`src/scatter.js`).
- **Map**: the buildable grid is the central 80x80 units; around it lies a flat basin 120x120 units where the bugs
  spawn and walk (`FLAT` in `src/config.js`), then a ring of mountains out to the rendered edge. Nests appear at
  the basin edge (`SPAWN_RADIUS`).
- **Grid placement**: 40x40 cells of 2 units. Ghost preview turns red for occupied, out-of-bounds or
  too-steep cells, or when a bug is standing there.
- **Build animation**: new structures start buried and rise out of the ground over 0.75 s with a soil spray;
  towers only start firing once fully risen.
- **Sidebar**: Red Alert style card list grouped by category, TECH tab for research, selected-structure
  panel with sell (50% refund).
- **Autocannon effects**: the gun assembly recoils 0.3 units on each shot (50 ms kick, 200 ms return) with an
  additive muzzle-flash sprite; a brass casing ejects from the side port, tumbles, bounces, rests on the
  terrain and vanishes after 3 s.
- **Laser tower**: modelled on a naval directed-energy weapon: base plate, white pedestal, yoke with trunnion,
  a beam-director tube with a glowing lens, stereo sensor pod, tracker and cable conduits. The yoke yaws and
  the tube pitches onto the target, and the lens flares while the beam is firing.
- **Big towers** (2x2 footprint; `size` in `src/config.js`, anchor and footprint helpers in `src/game.js`):
  Mortar Pit (sandbagged tube, 8-26 range, lobbed shells on a ballistic arc with lead, 55 damage in a 3-unit
  splash), Missile Silo (hatches open and a rack rises, six corkscrewing homing rockets every 6 s at the densest
  cluster), Railgun Battery (capacitor banks glow as it charges for 3 s, then a bolt pierces every bug along a
  60-unit line for up to 400; needs a lab).
- **Buildings**: Wall, HMG Turret (10 rounds/s instant tracers, low damage, short range), Autocannon (guided projectile), Dual Autocannon (two barrels, two shells per salvo,
  casings from both sides), Flamethrower (short-range gravity-arced fire stream; every bug in its 24° cone is
  set burning for 3 s at 14 damage/s, refreshed while it stays in the stream, with flames on the bug), Laser Tower (hitscan beam, needs a Research Lab),
  Refinery (+3 credits/s), Research Lab (unlocks laser + tech).
- **Research**: Reinforced Plating (walls x2 HP), Overcharged Optics (laser +50%), HE Rounds (turret splash).
- **Scale**: bugs are rendered as one instanced draw per species (`src/swarm.js`): the rig is baked into a single
  low-poly geometry with per-vertex pivot/axis/phase attributes and the gait, chomp, bob, burn glow and death curl
  run in the vertex shader, so the CPU writes one matrix and four floats per bug. HP bars are one instanced mesh.
  Pathing is a flow field (`src/flowfield.js`, Dijkstra from the Core over the basin, structures passable at an
  HP-scaled cost so bugs route through gaps or chew the cheapest wall); separation, targeting and area damage go
  through a spatial hash (`src/spatial.js`). Particles, gibs and decals are budgeted. Waves grow quadratically and
  spawn in batches; `?stress=2000` drops 2000 bugs at once for testing (`__spawnMany(n)` in the console).
- **Enemies**: procedural insectoids built from a small rig: segmented abdomen with glossy chitin plates,
  six two-segment legs (hip / femur / knee), mandibles, antennae, glow spots or spikes. Skitterers (fast,
  weak, purple with bioluminescent spots) and Brutes (from wave 3: armoured, horned, bone spikes).
  They burrow out of the ground at their nest, walk with a tripod gait (legs sweep at the hip and lift at
  the knee in the swing phase, body bobs), snap their mandibles when attacking, and flip onto their backs
  and sink into the ground when killed. They walk straight for the Core and attack whatever structure
  blocks their cell path. Kills leave ichor splatter decals (`src/decals.js`) draped over the terrain that
  hold for 10 s, fade over 2 s and remove themselves.
- **Intro cinematic** (`src/intro.js`): the Core drops from orbit on flickering thrusters, deploys landing
  legs, kicks up dust on touchdown and plants its pylons; the camera then flies to the gameplay view and
  the sidebar slides in. Any key or click skips it; append `?nointro` to the URL to jump straight to the fly-in.
- **Active abilities** (`src/abilities.js`): five commander powers on a bottom-centre bar (keys 1-5), each with
  a terrain-draped targeting reticle and a cooldown. Orbital Lance (five beams spiral inward and merge into one
  strike), Orbital Laser (sustained beam that follows the cursor for 6 s, scorching a trail), Strafing Run
  (three strike fighters with lathed fuselages, canopies, swept wings, canted twin fins, afterburners, contrails,
  wingtip missiles and rocket pods fly in from the map edge and rake an oriented strip with rockets and splash-damage cannon fire), Artillery
  Strike (10-12 shells from off-screen), Nuclear Strike (10 s countdown, ICBM, white-out flash, fireball,
  double shockwave, mushroom cloud, huge radius). Explosions leave scorch decals and shake the camera.
- **Sound** (`src/audio.js`): every turret and ability has a procedurally synthesised Web Audio effect
  (machine-gun bark, autocannon thump, laser hum loop, lance charge and strike, jet fly-by with doppler,
  rocket whoosh, explosions scaled by size, artillery whistle, nuke countdown beeps, launch rumble and
  detonation with ringing). Sounds are attenuated by distance from the camera focus and rate-limited.
  Drop audio files in `public/sfx/` and list them in `public/sfx/manifest.json` to replace any of them
  (see `public/sfx/README.md`). M toggles mute.
- **Waves**: manual start, scaling counts and HP, 1-4 spawn nests shown as red rings, clear bonus.

## Debugging

`window.__game` is the live state and `window.__step(dt, n)` advances the simulation manually
(useful when the tab is hidden and requestAnimationFrame is paused).

## Layout

    src/config.js    tuning: costs, stats, map size
    src/noise.js     simplex + periodic perlin, fbm, ridged
    src/terrain.js   heightmap, grid helpers, terrain mesh + splat shader, ray-march picking
    src/textures.js  procedural tileable albedo/normal maps
    src/sky.js       sky dome shader
    src/scatter.js   instanced rocks and crystals
    src/intro.js     landing cinematic
    src/decals.js    ground splatter and scorch decals
    src/particles.js shared sprite particle system (dust, smoke, fire)
    src/effects.js   explosions, impact rings, railgun beam (shared by turrets and abilities)
    src/swarm.js     instanced bug renderer (vertex-shader gait) + instanced HP bars
    src/flowfield.js Dijkstra flow field for bug pathing
    src/spatial.js   spatial hash for enemies
    src/abilities.js active abilities, their effects and the bottom bar
    src/entities.js  procedural meshes (buildings, bugs, HP bars, beams, gibs)
    src/scene.js     renderer, lights, RTS camera controls
    src/game.js      game state, placement, towers, enemy AI, waves
    src/ui.js        sidebar DOM
    src/input.js     raycast picking, ghost preview, click handling
    src/main.js      bootstrap + loop
