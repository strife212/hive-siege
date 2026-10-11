# Sound effect overrides

Every sound in the game is synthesised at runtime (see `src/audio.js`). To replace one with a real
recording, drop the file in this folder and list it in `manifest.json`:

    {
      "autocannon_fire": "autocannon_fire.ogg",
      "nuke_impact": "nuke_boom.mp3"
    }

Any format the browser can decode works (ogg, mp3, wav, m4a). Files listed here are decoded at startup
and used instead of the synth; anything not listed keeps its procedural version.

One-shot sounds (played once per event):

| name                | used by                                              |
| ------------------- | ---------------------------------------------------- |
| hmg_fire            | HMG Turret rounds, strafing-run cannon fire          |
| autocannon_fire     | Autocannon / Dual Autocannon shells (dual plays two) |
| laser_tick          | (spare) short laser zap                              |
| lance_charge        | Orbital Lance charge-up (~1.7 s)                     |
| lance_impact        | Orbital Lance strike                                 |
| jet_flyby           | Strafing Run jets approaching and passing (~4.5 s)   |
| rocket_launch       | each strafing-run rocket                             |
| explosion           | rockets, artillery shells, generic blasts (`size`)   |
| artillery_whistle   | each incoming artillery shell                        |
| mortar_fire         | Mortar Pit shot                                      |
| missile_launch      | each Missile Silo rocket                             |
| silo_hatch          | Missile Silo hatches opening                         |
| railgun_charge      | Railgun Battery 3 s charge                           |
| railgun_fire        | Railgun Battery bolt                                 |
| boss_roar           | Colossus emerging and dying                          |
| boss_step           | each Colossus footfall                               |
| hub_land            | Core touchdown in the intro                          |
| nuke_beep           | countdown tick (`hi` on the last 3 seconds)          |
| nuke_launch         | ICBM launch                                          |
| archangel_charge    | Archangel Lance wind-up (~9.5 s rising drone)        |
| nuke_rumble         | long rolling boom and echoes after the detonation    |
| nuke_impact         | nuclear detonation                                   |

Looping sounds (started and stopped by the game; files should loop cleanly):

| name           | used by                                  |
| -------------- | ---------------------------------------- |
| rain           | rain ambience while it rains (loop)      |
| thunder        | thunder (near strikes crack first)       |
| bh_open        | black hole opening (implosion + boom)    |
| bh_consume     | a bug crushed in the black hole          |
| bh_burst       | black hole collapsing                    |
| blackhole_hum  | black hole drone while it is open (loop) |
| bug_pop        | a bug dying (rate-limited; `size` = bug scale) |
| air_raid       | strategic launch warning siren           |
| silo_servo     | building elevator running: soft mid-low hum, kept quiet |
| blast_door     | silo blast doors meeting: muffled thump  |
| silo_doors     | silo blast doors swinging open           |
| airship_engine | Titan airship while airborne             |
| vtol_jet       | Gunship Pad VTOL while airborne          |
| hub_thruster   | Core descent engines in the intro        |
| laser_beam     | Laser Tower while it has a target        |
| orbital_laser  | Orbital Laser for its 6 s duration       |
| flame_loop     | Flamethrower while it is spraying        |

Radio call-outs (one per support ability, played when it is called in; not positional, and a new one cuts the
last one off). The recordings are in `voice/`, with their lines in `voice/lines.txt`:

| name              | line                                         |
| ----------------- | -------------------------------------------- |
| voice_laser       | 1. Orbital laser online.                     |
| voice_lance       | 2. Orbital lance firing.                     |
| voice_strafe      | 3. Strafing run inbound.                     |
| voice_artillery   | 4. Artillery strike targeted.                |
| voice_troopers    | 5. Shock troopers dropping.                  |
| voice_bomber      | 6. Strategic bombing run enroute.            |
| voice_nuke        | 7. Tactical nuclear strike authorised.       |
| voice_archangel   | 8. Archangel lance charging.                 |
| voice_blackhole   | 9. Micro-Singularity away.                   |
| voice_battleship  | 10. Landship authorised. Clear the dropzone. |
| voice_strategic   | 11. Strategic launch detected.               |

Press M in game to mute.
