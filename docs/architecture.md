# Architecture

YouTD Reforged is a browser tower-defense game built with three.js and Vite. The
code is plain JavaScript ES modules with no framework.

## Layers

| Layer | Path | Responsibility |
|---|---|---|
| Data | `src/data/` | Static definitions: elements, damage matrix, towers, items, perks, boss spoils, modifiers, achievements, music, icons |
| Simulation | `src/sim/` | Headless game state and rules. No DOM, no three.js. Runs in Node for the balance bot |
| World | `src/world/` | three.js scene, camera, post-processing, procedural models, effects |
| Meta | `src/meta/` | Player profile in `localStorage` and achievement bookkeeping. Pure functions plus thin storage wrappers |
| UI | `src/ui/` | DOM HUD (`hud.js`), end-of-run summary (`end-screen.js`), Hall of Records (`hall.js`), shared helpers (`util.js`) |
| Audio | `src/audio/audio.js` | Synthesized sound effects and the licensed music playlist |
| Entry | `src/main.js` | Menu, settings, input routing, fixed-step game loop |

The simulation emits events (`Game extends Emitter`). The world and the HUD
subscribe to them and read game state each frame; they never mutate rules
directly except through `Game` methods (`build`, `upgrade`, `equip`, `castActive`,
`choosePerk`, `train`, `chooseSpoil`, ...).

## Simulation (`src/sim/`)

- `game.js`: the `Game` class. Economy, waves, towers, creeps, projectiles, damage
  pipeline, items, perks, training, boss spoils, invisible creeps.
- `abilities.js`: shared ability engine. Tower actives (mana, cooldown, autocast),
  passive procs (`attack`, `hit`, `kill`, `periodic`), timed tower buffs, creep
  debuffs, and one effect executor (`applyEffect`) used by towers and items alike.
- `waves.js`: wave generation (size, race, armor, champions, specials) and the
  creep health curve.
- `map-layout.js`: grid (30x16 tiles of 2 world units), ground and air routes,
  buildable tiles. Shared by the simulation and the world.
- `rng.js`: seeded PRNG and the event emitter.

### Run ledger and summary

`Game.stats` records what the end screen and achievements need without touching
the RNG: waves cleared in order (`wavesCleared`; `level` is the last wave
*called*), every leak with its portal damage, boss kills, gold and tomes spent by
purpose, early calls, transmutes and the peak number of uniques carried. Each
tower keeps `dmgSplit`, its damage by attack type or `spell`, filled in
`applyRaw`. Sold towers stay in `stats.soldTowers` by reference, so hits that land
after the sale still count.

`summary()` turns this into plain data: the old totals plus `outcome` (`won`,
`lost`, `abandoned` or `running`, derived from `phase`), `continued` (a won run
kept going), `towerLedger` and `mvp`, damage and portal-damage breakdowns,
`lives`, `maxLives` and `livesAtVictory`. A finished run (`isOver()`) accepts no
more commands; `abandon()` ends a run in progress.

`cfg.god` (testing) and `cfg.modifiers` (challenge modifiers from `MODIFIERS`)
are set at construction. `maxLives` drives the lives caps, `livesLost` scaling,
the Mend offer and the HUD bar, so Glass Portal never feeds power to towers.

The main loop calls `game.update(dt)` in fixed sub-steps of at most 1/60 s, so the
simulation stays stable at 2x and 3x speed.

### Damage pipeline

`resolveHit` → miss checks → crit/multicrit → `damage()` → `damageMultiplier()`
(attack type vs armor matrix, armor reduction, race/size bonuses, curse and
vulnerability debuffs) → shields → `applyRaw` (health, experience credit) → `kill`.
Spell damage skips the armor matrix and uses spell damage and spell crit stats.

### Auras and triggers

`recalcAll()` rebuilds aura bonuses whenever towers, items or aura levels change.
Auras can target any stat; different auras stack and copies of the same aura count
once. Proc triggers (`attack`, `hit`, `kill`, `periodic`, `enter`, `crit`, `cast`,
`death`) are dispatched from `game.js` into `runProcs` in `abilities.js`.

### Tower power

`computeStats(t)` gathers modifiers from the tower definition (per-level YouTD
modifiers), items, oils, perks, buffs and auras. Damage is multiplied by a level
factor of `0.35 + 0.13 * level` (plus `0.05` per level above 20, up to the cap of
30), so untrained towers are weak and levels are the main power source.

## Data (`src/data/`)

- `constants.js`: elements, rarities, attack and armor types, damage matrix,
  creep sizes, difficulties, economy (`ECON`), experience curve, level cap (30).
- `towers.js`: builds `TOWERS`, `FAMILIES`, `TOWER_LIST` from the YouTD data
  (see [youtd-port.md](youtd-port.md)).
- `items.js`: builds `ITEMS` from the YouTD data, including oils and consumables.
- `youtd/generated.js`: generated from `third_party/youtd2` by
  `tools/import-youtd2.mjs`. Do not edit by hand.
- `youtd/mods.js`: maps YouTD `MOD_*` ids to stat channels.
- `youtd/tower-ports.js`: hand-ported tower behaviors.
- `tower-perks.js`, `boss-spoils.js`, `tower-skills.js` (effect descriptions),
  `music-tracks.js`, `icon-map.js` (curated game-icons.net icon per tower family
  and item, imported by `npm run import:icons`), `model-map.js` (curated Poly
  Pizza model per tower family, imported by `npm run import:models`).
- `achievements.js`: the achievement catalog (each with `test`, `counter` or
  `collect` over a run summary) and the `UNLOCKS` catalog of titles, modifiers
  and crests with the achievement that grants each.

## Meta (`src/meta/`)

- `profile.js`: the profile under `localStorage` key `youtd-reforged-profile`
  (versioned, `PROFILE_VERSION`). `sanitize()` rebuilds every loaded or imported
  profile from the default shape, keeping only typed values and catalog ids, so
  bad data cannot pollute prototypes or reach the DOM. `recordRun(sum, runState)`
  records a game once per `runState`; a later call for the same game adds only
  the difference. God mode runs are never recorded. The old
  `youtd-reforged-best` key is merged once and left in place. Imports are capped
  at 256 KB and replace the profile after a confirm.
- `achievements.js`: `evaluateRun()` (pure), `progressOf()`, `unlockedSet()`.
  Abandoned runs earn nothing before 10 cleared waves.

## World (`src/world/`)

- `world.js`: renderer, EffectComposer with reduced-resolution bloom, SMAA on
  low-DPI screens only, RTS camera with velocity-based panning and grab-pan,
  picking, per-frame sync of towers, creeps and projectiles. `QUALITY` presets
  (Settings, Graphics quality) set the pixel-ratio cap (1 / 1.25 / 1.5), the bloom
  buffer scale and whether creeps cast shadow-map shadows (High only; Low and
  Medium draw blob shadows instead). `World.setQuality(name)` applies one live.
- `creep-crowd.js`: draws every creep that uses a curated model. Each model's move
  clip is baked once (when the model loads) into half-float vertex textures, and
  all creeps of that model draw as one `InstancedMesh` per material whose shader
  blends the two baked frames around each creep's clip time. A creep keeps an
  empty anchor in its transform tree, so knockback, squash, yaw, flight bob and the
  death topple still drive it; the crowd copies the anchor's world matrix each
  frame. Hit flash is a per-instance value, unseen creeps draw through an additive
  ghost layer and gilded challenge creeps through a gold layer. The gallery does
  not set the crowd (`setCreepCrowd`) and clones models as before;
  `world.setCrowd(false)` does the same in game for debugging.
- `creep-overlays.js`: health and shield bars and blob shadows for all creeps as a
  few instanced meshes, rebuilt from the synced creeps every frame.
- `tower-batcher.js`: `models.js` merges each tower's static meshes per material
  (`mergeStatic`, cached per tower kind) and the batcher moves those into one
  shared `BatchedMesh` per material, so all daises and static tower bodies cost a
  handful of draw calls. Animated parts stay ordinary meshes in the tower group.
- `environment.js`: registry of map themes (`MAPS`, `DEFAULT_MAP`). Builds the
  chosen map plus the shared placement grid, disposes it on a switch, animates it
  each frame, and exposes the active map's `terrainHeight` for effects.
  `World.setMap(id)` swaps the scenery and applies the map's lighting, fog,
  exposure, grade tints and portal colours; the player picks the map on the
  setup screen and the menu backdrop follows the choice.
- `maps/`: one module per theme, all built around the same gameplay layout, so
  the map never affects balance. `shared.js` documents the module interface and
  holds the common helpers (noise, road distance, instancing, direction ribbon,
  air lane, grid overlay, rift shader). Themes: `isle.js` (Twilight Isle, the
  original lake island), `dusk.js` (Dusk Battlefield: walled field, flagstone
  road drawn by a shader in the road's distance field, ruins, braziers, autumn
  woods, sunset sky, ground fog, embers), `frost.js` (Frozen Night), `sky.js`
  (Sky Island) and `elements.js` (Elemental Realms, one region per element along
  the road).
- `models.js`: procedural tower and creep models built from primitives,
  `buildCrest()` for level-cap towers (`world.crest`, synced per frame), and the
  tower dais. Daises grow with rarity (steps, bronze or gold trim, corner posts,
  burning obelisks for uniques) and towers scale with cost (`towerScale`, log
  scale), so a 5000-gold unique stands about twice as tall as a 30-gold common.
- `glb-models.js`: loads curated tower and creep models (`public/models/`,
  chosen in `src/data/model-map.js`) and fits them where the procedural model
  would stand. Towers play their idle clip and an attack clip on each shot;
  creeps play a walk or fly clip at their current speed. The procedural model
  stands in until a file arrives.
- `fx.js`: GPU particle systems, projectiles, lightning, beams, rings, meteors,
  zones and floating combat text.

## UI scaling

All HUD sizes in `src/style.css` are written as `calc(var(--s) * Npx)`.
`main.js` sets `--s` from the window size (1600x900 is the design size) times
the player's "Interface size" setting.

## Tools

- `tools/balance.js`: headless bot that plays the simulation and prints the wave
  it reached. Configure with environment variables (see `AGENTS.md`).
- `tools/perf-bench.mjs` (`npm run bench`): drives local Google Chrome over the
  DevTools protocol against the dev server, fills the field with towers and a
  crowd, and prints per-frame simulation, render and HUD time, draw calls and
  triangles per quality preset.
- `tools/import-youtd2.mjs`: regenerates `src/data/youtd/generated.js`.
