# Hive Siege — Alien Base Defense

A three.js base-defense game: build walls, towers, refineries and a research lab on a
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
| LMB drag | Select shock troopers and battleships (then click to move them) |
| Esc / RMB click | Cancel placement, deselect |
| Shift+click | Keep placing the same building (walls always do) |

### Phones (landscape)

A touch screen the size of a phone (`src/mobile.js`: coarse pointer, shorter side <= 540 px) gets phone mode: the
same UI scaled down (narrower sidebar, one-row HUD without the kill count, three cards a row, icon-only call-in bar,
log top left, no key hints, a title screen without the map blurbs), a rotate prompt when held upright, and render
quality starting at level 1. Where the browser has the Fullscreen API (Android) the game goes full screen on its first
tap (not on the title screen: picking a map reloads the page, which ends it) and a button toggles it after that.
iPhone Safari has none, so its title screen suggests Add to Home Screen, which opens the game without browser bars
(`apple-mobile-web-app-capable`). `?mobile` forces it, `?mobile=0` turns
it off. Desktop is untouched: every rule is under `body.mobile`.

| Touch | Action |
| --- | --- |
| Tap | Aim: put down the building's ghost, or the call-in's target ring. Tap it again (or the bar's BUILD / FIRE) to commit |
| Tap a structure / trooper | Select it (a trooper brings its whole squad); tap the ground to move troopers |
| One-finger drag | Pan (while the Orbital Laser burns: steer it) |
| Pinch / two-finger drag | Zoom / rotate and tilt |
| Bar's CANCEL / RELEASE | Cancel placement or a call-in, release troopers |
| Tech card | First tap shows what it does, a second tap researches it |

Aiming then committing is on for any touch screen (tablets too); the touch bar is phone mode only.

## What is in the game

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
- **Core**: a military command tower (`commandTower` in `src/entities.js`): armoured plinth on the four landing pylons,
  bunker block with glowing reactor vents and a blast door, tapered shaft, cantilevered control room with a lit
  window band, walkway and railing, and a sensor deck with a rotating radar, radome, dish and beaconed antennas.
- **Build animation**: new structures start buried and rise out of the ground over 0.75 s with a soil spray;
  towers only start firing once fully risen.
- **Sidebar**: Red Alert style card list grouped by category, TECH tab for research, a START WAVE 1 button that
  starts pulsing with a bright glow if it has not been pressed 10 s into the game, selected-structure
  panel with sell (50% refund). A building that needs a Research Lab first shows a padlock over its card's icon. A selected tower shows its reach as a ring drawn into the terrain shader (so it
  follows the ground exactly), with a faint tint inside; the mortar's shows its 8-unit dead zone too, and research that
  extends a range updates it live. Aircraft pads, economy and support buildings, walls and mines have none.
  Every tower and minefield keeps a kill count, shown under its integrity bar: a kill goes to whichever structure lands
  the killing blow. Shells, missiles, rockets, bombs and splash count for the structure that fired them, and a burning
  bug counts for the last flamethrower or White Phosphorus mortar to set it alight (Clinging Napalm's spread too).
  Strikes and troopers credit no structure.
- **Autocannon effects**: the gun assembly recoils 0.3 units on each shot (50 ms kick, 200 ms return) with an
  additive muzzle-flash sprite; a brass casing ejects from the side port, tumbles, bounces, rests on the
  terrain and vanishes after 3 s.
- **Laser tower**: modelled on a naval directed-energy weapon: base plate, white pedestal, yoke with trunnion,
  a beam-director tube with a glowing lens, stereo sensor pod, tracker and cable conduits. The yoke yaws and
  the tube pitches onto the target, and the lens flares while the beam is firing.
- **Big towers** (2x2 footprint; `size` in `src/config.js`, anchor and footprint helpers in `src/game.js`):
  Mortar Pit (sandbagged tube, 8-26 range, lobbed shells on a ballistic arc with lead, 55 damage in a 3-unit
  splash), Missile Silo (hatches open and a rack rises, six corkscrewing homing rockets every 6 s at the densest
  cluster), Railgun Battery (capacitor banks glow as it charges for 5 s, then a bolt pierces every bug along a
  60-unit line for up to 400; the mount traverses at a fixed rate and holds its charge until aligned, and a blue
  gauge on the breech fills with the charge; target priority is the Colossus whenever it is in range, then medium
  bugs (brutes, spitters), then small ones, nearest first within a class; needs a lab).
- **Fire shader** (`src/flame.js`): flamethrower streams and burning bugs are one instanced quad mesh whose fragment
  shader shapes each flame from scrolling fbm noise, erodes it with age and ramps white-hot to orange, red and sooty
  smoke; premultiplied blending makes the core add light while the smoke occludes.
- **Buildings**: Wall, Minefield ($100: five pressure mines on one tile that bugs walk straight over and never attack;
  each bug that steps on it sets the nearest mine off for 80 damage, enough for a skitterer at any wave before the hive
  adapts; a bug trips a set only once (a brute that survives walks on), and once all five are spent a new set takes 30 s, with a see-through
  countdown clock over the tile and the spent mines shown as ghosts; it has no silo: its mines are fired down from
  orbit one after another as glowing streaks that slam into the dirt, it cannot be retracted, it stays out through
  the strategic strike, and selling digs it up on the spot), HMG Turret (10 rounds/s instant tracers, low damage, short range), Autocannon (guided projectile), Dual Autocannon (two barrels, two shells per salvo,
  casings from both sides), Flamethrower (short-range gravity-arced fire stream; every bug in its 24° cone is
  set burning for 3 s at 14 damage/s, refreshed while it stays in the stream, with flames on the bug), Laser Tower (hitscan beam, needs a Research Lab),
  Refinery (+3 credits/s, only once wave 1 has been called; until then its drill idles), Research Lab (unlocks laser + research).
- **Strategic Uplink Tower** (SUPPORT, 2x2, 2000 credits): a very tall comms tower. An armoured equipment hall carries a
  red-and-white banded lattice mast about 15 units high, bristling with hardware:
  - parabolic dishes, microwave drums, two rings of cellular panels, a yagi, crossed dipoles and whips
  - three railed walkway platforms, guy wires, and blinking red aviation lights
  - a big uplink dish on the roof that slowly slews to hold its link

  The Strategic Nuclear Strike and the Airdrop Land Battleship stay locked until one stands, and lock again if it is
  lost. It sinks whole into a deep silo like everything else.
- **Research** (TECH tab, needs a Research Lab): GLOBAL is always listed; every building's own section appears the
  first time one is built and stays. Stat research rebuilds the live per-type stats that every structure points at
  (`s.def`), so towers, aircraft and the info panel update the moment it completes.
  - GLOBAL: Composite Armour ($1,800, every structure and the Core +25% HP), Integrated Fire Control ($2,100, all tower
    ranges +10%), Orbital Command Priority ($3,000, ability cooldowns -25%, the Strategic Strike excepted).
  - Wall: Reinforced Plating ($450, x2 HP).
  - HMG: High-Cyclic Feed ($450, +30% fire rate), Overpenetration ($525, a killing round carries its leftover damage
    into the nearest bug within 2 m).
  - Autocannon: HE Rounds ($600, splash; also listed under and applies to the Dual Autocannon), Autoloader ($525, +30%
    fire rate), Sabot Shells ($600, +50% damage to brutes, spitters and the Colossus).
  - Dual Autocannon: HE Rounds, Depleted-Uranium Shells ($825, +25% damage, range 13 -> 15).
  - Flamethrower: Pressurised Tanks ($525, range 7.5 -> 10, cone 24 -> 32 degrees), Clinging Napalm ($600, a bug that
    dies in Flamethrower fire sets everything within 2 m alight).
  - Laser: Overcharged Optics ($600, +50% damage), Focusing Array ($675, +20% per second on one target up to +100%,
    the beam thickens), Prism Splitter ($750, each pulse forks to one more bug within 3 m for half damage).
  - Mortar: Double Crew ($750, +50% fire rate), White Phosphorus ($900, the blast sets bugs burning, 12/s for 4 s).
  - Missile Silo: Hot Reload ($900, salvo every 4 s), Distributed Targeting ($1,050, each missile claims its own
    cluster; with fewer clusters than missiles they are shared out in turn).
  - Gunship: Extended Magazines ($1,200, 160 rounds and 16 rockets), Hunter-Killer Avionics ($1,050, rockets only for
    brutes, spitters and the Colossus; with the gun dry it hunts only those, or heads home).
  - Titan: Deep Magazines ($4,500, +50% of every ammo type), Fire Control Relay ($6,000, towers within 15 m of the
    ground under the airborne Titan fire 20% faster; the circle is traced on the terrain).
  - Apocalypse Heavy Artillery: Priority Override ($4,000). Selecting the gun shows an AUTO / MANUAL button (T): pick a spot
    with the same reticle and click / tap-to-aim flow as the abilities (`abilities.designate`), and the gun lays onto it and
    shells only that spot, whenever a bug is inside the blast area, until it is switched back to AUTO. The spot is marked
    on the ground with a pulsing ring the size of the blast.
  - Railgun: Supercapacitors ($1,800, charge 5 -> 3 s), Tungsten Penetrator ($2,250, x3 damage to the Colossus).
- **Scale**: bugs are rendered as one instanced draw per species (`src/swarm.js`): the rig is baked into a single
  low-poly geometry with per-vertex pivot/axis/phase attributes and the gait, chomp, bob, burn glow and death curl
  run in the vertex shader, so the CPU writes one matrix and four floats per bug. HP bars are one instanced mesh.
  Pathing is a flow field (`src/flowfield.js`, Dijkstra from the Core over the basin, structures passable at an
  HP-scaled cost so bugs route through gaps or chew the cheapest wall); separation, targeting and area damage go
  through a spatial hash (`src/spatial.js`). Particles, gibs and decals are budgeted. Waves grow quadratically and
  spawn in batches; `?stress=2000` drops 2000 bugs at once for testing (`__spawnMany(n)` in the console).
- **Draw calls**: a building's fixed parts are merged into one mesh per material when it is built (`src/bake.js`);
  anything the game moves or toggles must be reachable from the building's userData so it stays separate. Merged
  parts carry their own local coordinates for the wear shader (`wearPos` / `wearNrm`), so they look identical.
  All particles (smoke, dust, sparks, glows) are one instanced draw call, sorted back to front each frame, normal and
  additive together through premultiplied blending, so they layer exactly as separate sprites did (`src/particles.js`).
  All ground decals (splatter, scorch marks, burn scars) are one mesh too: a pool of slots whose draped patch is written
  once when a decal lands, with its fade, ember glow and shine in a small per-slot float texture (`src/decals.js`).
  Every placed wall is drawn by six instanced meshes (`src/walls.js`), every mine in every minefield by five more,
  and all the reload clocks by one (`src/mines.js`). Instance buffers upload only the part in use,
  explosions and ordnance share their geometry, and the sky is drawn after the opaque scene so it only shades the
  pixels that still show sky. A 79-structure base went from about 4,000 draw calls a frame to under 1,000.
  Building HP bars (`src/hpbars.js`, a sprite-equivalent shader), spent casings and gibs are instanced too (shared
  helpers in `src/instancing.js`). The WebGL context asks for the high-performance GPU (dual-GPU laptops) and, with
  the post chain on, has no MSAA or depth buffer of its own: the scene is drawn into the composer's 2x MSAA target and
  the canvas only receives the final full-screen pass. The terrain skips the texture lookups of any splat layer whose
  weight is exactly zero at that pixel, and it is drawn after every other solid object so the depth test throws out
  the ground hidden under buildings and bugs before it is shaded (its pixels are the most expensive in the scene).
- **Adaptive quality** (`src/quality.js`): if the frame rate stays under 45 fps for a 2 s window, rendering steps down
  a level. Levels 0-4: pixel-ratio cap 1.5 / 1.0 / 0.85 / 0.8 / 0.7, MSAA 2 / 2 / 0 / 0 / 0, shadow map
  3072 / 2048 / 2048 / 1536 / 1024, bloom off only at the last level. All of it changes live, without shader
  recompiles. Frames over 150 ms (compiles, GC, tab switches) are ignored unless ten come in a row, nothing is judged
  for 3 s after loading or 1.5 s after a change, and if two steps in a row buy under 5% more frames (CPU-bound, or the
  browser capping the frame rate on battery) they are handed back and the level is frozen. The level lasts for the tab
  (sessionStorage), so the title screen's verdict carries into the game; phones start a fresh tab at level 1. `?quality=0..4` forces a level; the perf
  overlay shows it (`Q2 · 85%`); `window.__quality` in the console.
- **Enemies**: procedural insectoids built from a small rig: segmented abdomen with glossy chitin plates,
  six two-segment legs (hip / femur / knee), mandibles, antennae, glow spots or spikes. Skitterers (fast,
  weak, purple with bioluminescent spots) and Brutes (from wave 3: armoured, horned, bone spikes). From wave 3
  about one bug in ten is a special (`SPECIALS` in `src/config.js`), alternating between two kinds:
  - **Darter**: skitterer-sized, twice as fast and more fragile. Teal with cyan glow spots and cyan blades swept
    back along its spine.
  - **Acid Spitter**: brute-sized, olive-yellow, with a glowing acid sac strapped to its abdomen that feeds a cannon
    turret on its back. It keeps walking for the Core while the turret tracks the nearest building within 8 units
    (it ignores walls and lobs straight over them). The sac swells and brightens as a shot charges and squeezes
    when it fires. The glob (`src/acid.js`) arcs in trailing fumes, splashes on the face of the building for 14
    damage and leaves it sizzling. The sac bursts when the spitter dies.
  - **Ant**: half a skitterer, glossy black with amber glow spots. It has 1 HP at every wave and is worth no credits.
    Every wave, and the canyon walkers, carries half as many again in ants (`ANTS` in `src/config.js`). They are
    fodder that soaks up fire and chews at walls.
  They burrow out of the ground at their nest, walk with a tripod gait (legs sweep at the hip and lift at
  the knee in the swing phase, body bobs), snap their mandibles when attacking, and burst into chunks when
  killed: instanced head, abdomen and leg pieces (`src/gore.js`) fly out, tumble, bounce and skid on the terrain,
  then sink away. They walk straight for the Core and attack whatever structure
  blocks their cell path. Kills leave ichor splatter decals (`src/decals.js`) draped over the terrain that
  hold for 10 s, fade over 2 s and remove themselves.
- **Intro cinematic** (`src/intro.js`): the Core drops from orbit on flickering thrusters, deploys landing
  legs, kicks up dust on touchdown and plants its pylons; the camera then flies to the gameplay view and
  the sidebar slides in. Any key or click skips it; append `?nointro` to the URL to jump straight to the fly-in.
- **Colossus** (boss, every 10th wave, `src/boss.js`): a giant bug on eight long spindly legs (procedural stepping + two-bone IK) that walks
  straight over walls and towers and stabs the Core with its front legs. 5000 HP (scaled by wave), boss bar at the top. Turrets, the railgun
  and the flamethrower elevate to hit its hull. Death: convulsions and ruptures, legs buckle, it crashes down, the abdomen swells and bursts
  (damaging nearby bugs), and the husk sinks away. Debug menu (Z) has a *Spawn boss* button.
  Every Colossus killed, by any means, makes the hive adapt. Bugs that spawn from then on get +10% HP and +10% speed,
  compounding: x1.1, then x1.21, and so on. The next Colossus is included. Bugs already on the field keep their stats
  (`HIVE_BUFF` / `state.hiveBuff` in `src/game.js`).
- **Titan Airship Pad** (2x3, 5000 credits, limit 1, needs a Research Lab, `src/airship.js`): a big rigid airship (ring-framed cigar hull, cruciform tail, long lit
  gondola, four ducted fans, solar spine) that parks over the thickest knot of bugs. Twin gatlings (500 rds each), twin HMGs (250 each), a
  belly howitzer (25 shells, big splash) and a bomb bay that drops 30 bombs straight down. Returns when empty or idle, rearms moored for 8 s.
- **Apocalypse Heavy Artillery** (3x3, 6000 credits, limit 1, needs a Research Lab, `src/apocalypse.js`): a colossal sci-fi howitzer on a slab with four
  outrigger jacks: armoured turret, trunnion-mounted cradle with recuperators, a long barrel wrapped in glowing coil rings and a slotted
  muzzle brake. Range 180 (the whole map; nothing closer than 10), one 650-damage shell with a 7 m blast every 10 s. It shells the
  biggest clump on the field: bugs are binned into 4-unit cells weighted by size (ants count little, brutes and spitters double, the
  Colossus most), each cell scored with its neighbours, and the shell is aimed at the weighted centroid led by the clump's walking
  speed. Each shot plays the full cycle: the barrel slams back and runs out, drops level, the breech door slides open and throws out the
  spent brass case (it tumbles, bounces and lies on the ground before sinking away), a hoist lifts the next round out of the magazine,
  a rammer drives it home, the breech shuts and the gun lays onto the next clump. In its silo the barrel stands on end.
- **Gunship Pad** (2x2 tower, `src/heli.js`): a heavy off-white VTOL gunship (wingtip lift-jet nacelles that vector with the flight, multi-tube
  rocket pods, tall fin) lifts off, hunts the nearest bugs within 48 units of the pad with a 100-round chin gatling and 10 rockets, flies home
  when both are empty (or nothing is left to shoot), and rearms on the pad for 5 s. An ammo readout (gatling bar + one pip per rocket) hangs
  under it in flight. If the pad dies the aircraft goes down with it.
- **Archangel Lance** (ability 8): the ultimate orbital strike, on a par with the nuke. Twelve golden beams in two counter-rotating rings
  spiral in and merge into one lance that swells to half the target radius, wreathed in lightning, then detonates with a train of shockwaves.
- **Strategic Bomber** (ability 7, `src/bomber.js`): click a point, then a direction; a six-engined white delta bomber (canards, drooped
  wingtips, twin fins) flies that line across the entire map and lays a stick of heavy bombs you can watch fall.
- **Shock Troopers** (ability 6, `src/troopers.js`): five drop pods slam down (crushing bugs underneath) and unload three troopers each.
  Drag a box to select them, click to move, right-click or ESC to release. Light machine gun (15 dps vs the HMG turret's 35), a grenade
  every 3-6 s, 2 HP: a small bug's bite costs 1, a brute or spitter takes both. They are the bugs' top priority: any bug within 16 units with a
  clear run at a trooper drops what it is doing (even a structure it was chewing) and hunts him.
- **Title screen**: a fresh visit opens on an attract-mode battle (`src/demo.js`): a self-repairing fortress in the canyon under an
  endless swarm, with strafing runs and artillery called in alternately, silent and dimmed. Two buttons under the title,
  *Plains Defense* (the open basin) and *Canyon Siege*, each unfold on hover or keyboard focus into a card with a shot
  of that map (`src/menu/*.webp`, captured in-engine). Clicking one loads the game on that map. On touch screens the
  cards start open, and on narrow screens the buttons stack. If the demo Core falls, the scene restarts. `?nointro`
  and `?stress` skip the title screen.
- **Icons**: every building, research item and ability has a 16x16 pixel-art icon drawn in code (`src/icons.js`), no image files.
- **Maps**: `?map=canyon` loads Deadrock Canyon, a box canyon with the Core at the closed end, a choke point in front of it
  and nests only at the mouth (`MAPS` in `src/config.js`, canyon shape in `src/terrain.js`). Default is the open basin.
- **Debug menu**: press `Z` for a popup (bottom left) with *Add 50,000 credits*, *Spawn next wave*, *Spawn boss*, *Spawn darters + spitters*, *Change map*, *Heavy scene* and *Test map*
  (a debug-only basin kept at 1200 bugs with an invincible Core and 50,000 credits; it cannot be opened from the URL alone) (`src/debug.js`; changing map reloads).
  *Heavy scene* is the stress case the performance numbers are measured in (`src/heavy.js`, `?map=test&heavy` once the test
  map is unlocked): the test range plus 350 darters, spitters and ants, rain, a walled base with every kind of tower, and
  support strikes landing on the swarm every 1.2 s, overlapping, for as long as it runs.
  *Performance stats* toggles an overlay in the top left (`src/perf.js`, remembered per browser):
  - FPS, the average frame time and the worst frame in the last ~2.7 s, over a graph with one bar per frame.
  - CPU time for the game's own code, split into simulation and render submission.
  - GPU time, from a WebGL timer query. Chromium supports it; Firefox usually shows *no timer*.
  - Draw calls and triangles for the whole frame, including the shadow and post-processing passes, plus bug and
    particle counts.

- **Active abilities** (`src/abilities.js`): five commander powers on a bottom-centre bar (keys 1-5), each with
  a terrain-draped targeting reticle and a cooldown. Orbital Lance (five beams spiral inward and merge into one
  strike), Orbital Laser (sustained beam that follows the cursor for 6 s, scorching a trail), Strafing Run
  (three strike fighters with lathed fuselages, canopies, swept wings, canted twin fins, afterburners, contrails,
  wingtip missiles and rocket pods fly in from the map edge and rake an oriented strip with rockets and splash-damage cannon fire), Artillery
  Strike (10-12 shells from off-screen), Tactical Nuke (10 s countdown, ICBM, white-out flash, fireball,
  double shockwave, mushroom cloud, huge radius). Explosions leave scorch decals and shake the camera.
- **Weather** (`src/weather.js`): Clear (the normal dusk sky) and Rain, blended through one `storm` value so a change
  rolls in over about six seconds: the overcast comes over first (a cloud deck in the sky shader, stars and planet
  hidden, fog pulled in and greyed, the sun dimmed and cooled), then the rain. Rain is 50,000 GPU streaks in a box that
  follows the camera, world-fixed and wrapped, stretched along their wind-slanted velocity and never thinner than a pixel
  (thinned alpha instead, so distant rain does not shimmer), with splash crowns popping on the ground around the view,
  low mist drifting through, and a rain ambience loop. The ground soaks through over ~14 s and dries over ~30 s: the
  terrain darkens and turns glossy, puddles collect on flat ground in the hollows and ripple with raindrops, and
  buildings and boulders go dark with water running down their faces (shared uniforms `WEATHER_U` in surface.js).
  Lightning flickers through the cloud deck every few seconds, lighting the scene and the rain, with bolts beyond the
  mountains (biased toward where the camera looks) and now and then a strike right in view with a crack of thunder and a
  scorch mark. The game changes weather by itself every few minutes (not in the title demo or recordings); the debug
  menu (Z) has *Change weather*, `?weather=rain` starts in the rain, and `window.__weather` has `set`, `cycle`, `strike`.
- **Micro-Singularity Gravity Bomb** (key 9, `src/blackhole.js`): a small missile drops on the target and a singularity opens above the
  ground: a black horizon inside a swirling accretion disk (shader), a photon-ring rim, a halo, sparks spiralling down the
  drain, lightning tendrils lashing the ground and rings pulsing inward. Every bug inside the radius is torn off its
  feet and spirals in, tumbling and taking damage; skitterers and darters are crushed at the horizon (a flash, no corpse), brutes and spitters are
  held in a tight orbit and the Colossus is dragged across the ground toward it, legs scrambling. After about four
  seconds the hole strains, collapses and blows, and every survivor is flung on an arc back to the spot it was taken
  from, landing dazed. Held bugs are still valid targets for towers. `e.held` (moved by blackhole.js, skipped by the
  AI and the separation pass, lifted and tumbled by the swarm renderer) and `e.stun`.
- **Strategic Nuclear Strike** (key -, the last button on the bar, `src/strategic.js`, needs a Strategic Uplink Tower): a last resort played as a cinematic. It arms like the other
  call-ins, with INITIATE STRATEGIC LAUNCH riding above the cursor (no ground marker); any click on the map launches it.
  Every structure (minefields excepted: they stay out) and the Core retract into their silos; then a 10 s beeping countdown ("STRATEGIC LAUNCH DETECTED /
  IMPACT IN n") while a giant ICBM comes down on the centre of the map. With 7 s to go the camera leaves the player,
  rides alongside the missile, then races ahead to watch it land. The shock front crosses the whole map killing every
  bug it reaches (and any troopers left outside), with fires and burn scars across the basin. A Colossus is the exception:
  the front hits it once for 30,000 damage (`BOSS_HIT`), so a late-game one can survive, and the log says so. The
  camera pulls back to the mushroom cloud, the cloud thins, the view returns to where the player left it and everything
  the strike sent below redeploys. Aircraft do not shelter: every gunship in the air and the Titan (cast off first if it
  was moored) scatter to the map edge on separate headings at emergency power, loiter there, and return to work on the
  all clear, landing once their pads are back up; a gunship sitting on its pad rides down with it.
  The strike also holds the attack (`state.waveHold`), so the base is never caught underground:
  - From launch, nothing more spawns.
  - A wave the blast clears does not start the next one.
  - The hold lifts only once the camera is handed back and every sheltered structure is fully redeployed. The attack
    then resumes 5 s later (`BREATHER` in `src/strategic.js`). START WAVE still works if the player wants to go early.

  The shock front does not destroy a Land Battleship: it takes half its max HP, once.
- **Airdrop Land Battleship** (key 0, `src/battleship.js`, 240 s cooldown, needs a Strategic Uplink Tower): a
  destroyer-hulled battleship on tracks, on station for two minutes (`SHIP.deploy`, 120 s). The cooldown only starts
  once its time on the field is over (or it is destroyed first).
  - **Hull:** 16.4 m by 4.2 m. A faceted stealth hull with tumblehome sides and a raked, wave-piercing ram bow; a gun
    on the foredeck, then the VLS, a bridge block with its pyramid mast and radar, an aft deckhouse with two stacks
    (black exhaust when it drives) and a helipad on the stern with its own gunship.
  - **Drop:** the reticle is its footprint, facing away from the Core the way it will land, red where it will not fit
    (buildings, scenery, another battleship). It falls at 40 m/s in an orange drop harness, the harness's four
    retro-thrusters light at 58 m and brake it to a soft touchdown, crushing whatever is underneath. The harness then
    lets go and boosts back to orbit.
  - **Time on station:** while it is down, its call-in button turns into a green countdown from 120 (in place of the
    cooldown; it shows 120 while the ship is still coming down). The log warns at 10 s. At 0 it holds where it is (no
    more move orders) and calls its gunship home; once the gunship is on the deck a fresh drop rig comes down on its
    retros, clamps on with a thump and lifts the whole ship, gunship and all, back to orbit. It keeps fighting, and the
    bugs keep at it, right up to the lift. Destroyed while the rig is on its way down, the rig turns back empty.
  - **Aggro:** every bug on the field goes for it first while it is down, ahead of troopers and the Core: they head
    for the nearest point of its hull and bite it for their structure damage (only while the way there is open, as
    with troopers), anywhere it goes: on the canyon map that includes out past the mouth, where bugs on the walk-in
    ground turn for it too. Spitters lob acid at it, and a Colossus walks to it and stabs it instead of the Core.
  - **Control:** select it like the shock troopers (drag a box over it or click it; it joins a trooper selection),
    then click to move. Each order is planned as a route (A* on a 2 m grid round buildings, canyon walls and the
    map's edge, cut down to its corners); it drives it corner to corner at 2.4 m/s, turning on the spot about the
    middle of the hull, and backs up to a spot just behind it. Round anything the route did not foresee it turns the
    long way when the short way is blocked, edges forward or back to make room to turn, and steers along walls; it
    gives up only when it truly cannot move. On the canyon map it can go anywhere on the canyon floor, right up to the
    foot of the walls (`SHIP.wall`) but never up them, and out through the mouth onto the open ground the bugs come
    in from. It sits on a best-fit plane through the ground under its tracks, digging in up to 0.3 m rather than
    perching on the highest bump. Selected, it shows its info panel: integrity, kills and weapons.
  - **Ram:** driving forward, the bow kills any bug it runs into (a Colossus excepted); backing up, the stern runs
    over small ones. Bugs elsewhere along the hull are shoved aside.
  - **Weapons**, each within a firing arc so nothing ever swings through the superstructure: a railgun (500 piercing
    bolt every 5 s, Colossus first, ±135° off the bow), CIWS gatlings fore and aft (25 rounds/s each), an eight-cell
    VLS (40-damage missiles with a 2.5 m blast every 7 s, spread over up to three clusters) and four dual autocannon sponsons (a 25-damage shell
    from each barrel per shot). CIWS rounds do 5. Everything it fields hits harder than its tower or trooper
    counterpart. All kills go on
    its own count.
  - **Escort gunship** (`updateEscort` in `src/heli.js`): the Gunship Pad's aircraft, slightly smaller and in the
    ship's naval livery (battleship greys, the gold trim as its one accent, pale LB / LBB-01 HS markings), parked on
    the helipad (it rides along while the ship drives). It lifts off when bugs come within 24 m of the ship and circles
    it about 9.5 m out, the circle leaning toward whatever it is fighting, nose on the bug nearest the ship. Out of
    ammo, after 6 s with nothing to shoot, or when a strategic strike is coming, it flies back and lands on the deck,
    matching the ship's speed if it is driving, then rearms for 5 s. Same gun, rockets and research as the Gunship
    Pad, but harder-hitting (8 per round, 53 per rocket); its kills count for the ship. If the ship is destroyed it goes down too.
  - **Helipad sentry** (`makeSentry` / `updateSentry` in `src/troopers.js`): a shock trooper posted on one of the
    helipad's two aft corners, beside the parked gunship. He fires his machine gun (the troopers' own, but with 16 m of
    reach up there instead of 10, and 3 damage a round instead of 2.5) at the nearest bug inside his corner's arc off that side and the stern, angling it
    down off the deck, and never shoots across the ship. While the gunship is up and away, if his side is quiet and
    the other side has bugs in reach, he runs across the stern to the other corner; he stays put while it is parked,
    landing or lifting off. No grenades, and nothing bites him; he rides out the extraction and is lost if the ship is.
  - **Integrity:** 15,000 HP. Below half it smokes, below a quarter it burns. Destroyed, explosions ripple along the
    hull, the magazines go up (400 damage over 7 m), and the wreck burns out and sinks.

  A strike that wants the camera
  registers a driver through `abilities.cinematic`, which main.js runs in place of the player's controls (`body.cine`
  slides the HUD away and brings in letterbox bars).
- **Sound** (`src/audio.js`): every turret and ability has a procedurally synthesised Web Audio effect
  (machine-gun bark, autocannon thump, laser hum loop, lance charge and strike, jet fly-by with doppler,
  rocket whoosh, explosions scaled by size, artillery whistle, nuke countdown beeps, launch rumble and
  detonation with ringing). Sounds are attenuated by distance from the camera focus and rate-limited.
  Drop audio files in `public/sfx/` and list them in `public/sfx/manifest.json` to replace any of them
  (see `public/sfx/README.md`). M toggles mute.
- **Presentation**: every built model uses bevelled boxes and a shared wear layer (`src/surface.js`: grime, grain and
  paint chips sampled triplanar in each part's own space, so nothing swims when a turret turns). Buildings sit on a
  sunk footing so slopes never show daylight under a base plate. Boulders share the cliff rock texture. Reflections
  come from a probe that matches the world (dusk horizon, hot sun spot, cool fill) and the frame goes through an HDR
  chain: 2x MSAA, bloom on anything brighter than white, ACES tone map, light vignette and a dither against banding.
  Add `?lowfx` to the URL to skip the chain on weak GPUs. The UI uses bundled fonts (Rajdhani, Barlow Semi Condensed).
  - **Battle light** (`src/flashes.js`): explosions, muzzle blasts, the flamethrower, railgun bolts, laser hits and
    acid splashes light the ground and buildings around them. A fixed pool of six point lights goes to the flashes
    that matter most right now (bright, near the camera, on screen), so shaders never recompile mid-fight.
  - **View-fitted shadows** (`fitShadow` in `src/scene.js`): the sun's shadow map covers only the ground in view,
    out to 1.15x the view distance, and fades out at its edge. That makes shadows about 1.8x sharper than the old
    whole-map box at the default zoom and about 3.3x zoomed in. Bugs, gore, troopers and the Colossus now receive
    shadows as well as casting them.
  - **Sky rim on bugs**: a cool rim along the top of each bug's silhouette (`swarm.rim`), so dark shells stand out
    from the dark ground at strategy-camera distance.
- **Retractable buildings** (`src/retract.js`): every structure but the minefield (and the Core) stands on an elevator in its own silo.
  One reversible timeline drives the whole cycle: collar lock bolts spin free, weapons stow pointing straight up (rail
  sled stands on end, mortar tube goes vertical, silo hatches shut, wall link arms pull in, Core pylons draw up), the
  platform sinks down a lit shaft on spinning drive screws, two blast doors swing up and slam, and a hub lock and the
  door bolts turn home under rotating beacons. The shaft is a real hole: the terrain shader discards against a mask
  (`cutHole` in terrain.js). New buildings arrive this way (run backwards, faster) and sold ones leave this way. Select a
  building and press R (or the panel button) to retract or deploy it: a retracted building is offline, cannot be hurt
  and bugs walk over its doors. Gunships are recalled to the pad first and ride down on it; the Titan casts off and
  holds overhead (it would never fit), and a new airship pad comes up empty while its ship flies in. None of the
  hardware exists while a building is just standing there. The Core has no player toggle: drive it from code for
  cutscenes with `retract.retract(state.core)` / `deploy` / `snap(s, down)` (`window.__retract` in the console, or the
  debug menu's Core silo button). The debug menu also has a base-wide retract / deploy drill.
- **Waves**: manual start, scaling counts and HP, 1-4 spawn nests, clear bonus. On the plains, from wave 12
  (`CORNERS` in `src/config.js`) four more holes open in the basin's diagonal corners and add 20% more bugs between
  them, the same mix as the rest of the wave, as a steady trickle: each gives out far fewer than a main nest. Each nest is a bug hole
  (`src/burrows.js`) that erupts out of the ground when the wave is called: a crater of churned dirt draped over the
  terrain, with bone-tipped chitin spikes and pulsing green egg sacs round a real hole. The ground is cut away inside
  it (the terrain's opening mask, the one the silos use, now reaching out past the nests) and an unlit shaft goes about
  3.5 units down under it, darkening to black with a faint glow at the bottom; the crater's inner slope stays above
  the ground across the band where the mask's stepped edge can fall, then drops into the shaft. Crater and shaft are
  drawn with the terrain's own material (a variant without the openings mask, `groundMaterial`), so they have its
  soil / rock / moss textures, normal maps and rain wetness: the crater starts from the ground's own texture mix and
  baked shade at its foot (`sampleTerrain`, `groundShade`), turns to churned soil up the slope with a resin-stained
  crest, and to rock down the shaft, darkening with depth. Bugs start deep in the
  shaft and climb up it and over the lip; hive haze drifts out. A red ring pulses on the ground round each
  new hole for 3 s, then fades, so a fresh nest catches the eye. When the wave is cleared the hole caves in and the
  crater sinks back into the ground.

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
    src/weather.js   weather: storm blend, GPU rain and splashes, lightning, wet-surface uniforms
    src/blackhole.js the Micro-Singularity Gravity Bomb: singularity visuals, capture / orbit / consume / fling of held bugs
    src/strategic.js the Strategic Nuclear Strike cinematic (giant ICBM, camera choreography, map-wide blast)
    src/battleship.js the Airdrop Land Battleship: model, drop, driving, footprint, weapons, wreck
    src/retract.js   retractable-building silos: timeline, stow poses, shaft/door/lock hardware
    src/surface.js   bevelled boxes and the triplanar wear shader shared by all built models
    src/intro.js     landing cinematic
    src/decals.js    ground splatter and scorch decals
    src/particles.js shared particle system (dust, smoke, fire, glows): one instanced, depth-sorted draw call
    src/effects.js   explosions, impact rings, railgun beam (shared by turrets and abilities)
    src/gore.js      instanced death chunks with bounce/skid physics
    src/swarm.js     instanced bug renderer (vertex-shader gait) + instanced HP bars
    src/flowfield.js Dijkstra flow field for bug pathing
    src/spatial.js   spatial hash for enemies
    src/acid.js      Acid Spitter globs: ballistic arc, trail, splash, sizzle
    src/flashes.js   pooled point lights for explosions, muzzle flashes and fire
    src/abilities.js active abilities, their effects and the bottom bar
    src/entities.js  procedural meshes (buildings, bugs, HP bars, beams, gibs)
    src/scene.js     renderer, lights, reflection probe, post chain (bloom/tone map), RTS camera controls
    src/game.js      game state, placement, towers, enemy AI, waves
    src/ui.js        sidebar DOM
    src/input.js     raycast picking, ghost preview, click handling, touch aiming and the phone touch bar
    src/mobile.js    phone-mode detection (body.mobile)
    src/main.js      bootstrap + loop
