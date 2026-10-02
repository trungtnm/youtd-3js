# Kill juice: hit feedback, deaths, coins, streaks

Date: 2026-10-02. Scope: view and audio only. No simulation, data, UI, CSS or HTML files changed.
Gameplay rules and balance are untouched; hit-stop is visual only.

## Changes

### `src/world/fx.js`
- `Gibs`: one pooled `InstancedMesh` of up to 500 tetrahedron shards with per-instance color. Shards
  bounce on `terrainHeight`, slide, spin down and shrink out (1.1 to 1.8 s).
- `Decals`: one pooled `InstancedMesh` of up to 160 ground splats. A custom shader fades them on the GPU.
  The splat mask is drawn procedurally on a canvas. Each splat is tinted a dark version of the race accent.
  Boss kills leave a large scorch.
- `SIZE_WEIGHT` per creep size. `death(creep, colors)` now scales everything by it: a white core pop,
  the colored burst, smoke, shards, rising embers, a ground splat and a small ring. Champions also get a
  flash disc, a little shake and a camera punch.
- `bossDeath()`: four staggered blasts over about 0.5 s, then a final blast at 0.6 s with two shockwave
  rings, about 40 shards, a scorch, a screen flash, a punch-zoom and a heavy shake.
- `hitSpark()`: fast white streak sparks plus a few race-colored sparks when a creep takes a real hit.
  `impact()` now bursts at air height for air targets.
- Gold coins (`coins()`): DOM coins in `#overlay`, styled inline. They pop out of the creep, home in on
  `#r-gold` (falling back to the top-left if it is missing) and spin. At most 36 are on screen.
  `onCoinArrive` is a hook the world fills in.
- Kill-streak callout (`callout()`): one inline-styled DOM element animated with WAAPI. A new callout
  replaces the old one. Font sizes use `var(--s)`.
- Floating text: crit and gold numbers pop in oversized and settle (2.1x for crits, 1.7x for gold) with an
  ease-out rise. Crits also jitter for the first 30% of their life and last a little longer.
- `after(delay, fn)` timers run on real time. New `flash` and `punch` fields are read by the world.
  `update(dt, w, h, realDt)` takes real time for coins, timers and the flash/punch decay.

### `src/world/world.js`
- Hit reaction in `_syncGame`: each creep tracks lost hp+shield. Once at least 1.5% of max hp is lost
  (at most one reaction every 0.12 s), the creep flashes white for 60 ms, squashes then stretches, gets
  pushed back along its path, and throws hit sparks. Bosses and champions react less.
- The flash swaps the creep's meshes to one shared `MeshBasicMaterial`. Shared cached materials are
  never changed. `_look()` handles both the flash and the existing unseen shimmer, so `_setUnseen` uses it too.
- Deaths: a white pop, scale-up then shrink, topple and sink. Bosses play their death at 0.45x speed.
- Hit-stop: on a boss kill (120 ms) and on streak tier 3 and up (70 ms), creep animation and particles run
  at 6% speed. The simulation keeps running at full speed.
- Camera punch-zoom (up to 6% dolly) in `_updateCamera`. The grade pass gets a new `uWhite` uniform for
  the big-kill screen flash.
- Kill streaks: a rolling 1.2 s window of kills (in game-speed time). Tiers at 4, 7, 11, 16 and 24 kills:
  Cleave, Carnage, Massacre, Slaughter, Extinction. Each tier shows once per streak. A streak ends after 2 s
  without a kill.
- Crits: a small punch and shake, at most once every 0.3 s, plus a crit sound.
- On coin arrival: a coin clink and a short WAAPI scale/brightness bump on `#r-gold`. This is a runtime
  animation only; no HUD file was changed.

### `src/audio/audio.js`
- `death(size, race)`: a pitch-randomized body thump and crunch, scaled by size. On top of that, a race
  voice gated separately: bone clatter (undead), groan (brute), shimmer (arcane), squeal (feral), grunt
  (humanoid). Champions add a low blast.
- `bossDeath()`: a two-stage explosion that matches the visual timing, then a short rising chime.
- `coin()`: a metallic two-partial clink with pitch randomization. At most one every 45 ms, and quick
  runs climb in pitch. This replaced the old fixed coin tone inside `death`.
- `crit()` (gated to 90 ms) and `combo(tier)` (a rising arpeggio and whoosh, with a sub hit at tier 2 and up).
- Every sound goes through the existing `sfx` gain, so the volume setting applies.

### `src/world/models.js`
- Not changed.

## Settings respected
- `fx.textEnabled` still hides damage and crit numbers; gold text was always shown and still is.
  Coins and streak callouts are not damage numbers, so they always show.
- All audio goes through the SFX volume.

## Performance (headless Chrome, Metal ANGLE, 1600x900, 40 towers, 2x speed)

Each run builds 40 high-tier towers and calls 4 overlapping waves. "Off" means the new gibs, decals,
coins, sparks and flash were stubbed out at runtime, as an approximate baseline.

| Scenario | fps | render ms/frame | worst frame ms | kills in 8 s | max creeps | draw calls |
|---|---|---|---|---|---|---|
| ~110 creeps, juice on | 60 | 4.61 | 12.4 | 204 | 110 | 1430 |
| ~110 creeps, juice off | 60 | 4.68 | 7.3 | 194 | 117 | 1849 |
| ~200-245 creeps, juice on | 60 | 7.18 | 11.9 | 34 | 245 | 5438 |
| ~200-245 creeps, juice off | 60 | 6.98 | 9.7 | 53 | 216 | 5034 |
| final build, 169 creeps, on | 60 | 6.16 | 9.5 | 158 | 169 | 3147 |

The added cost is within run-to-run noise. Gibs and decals are 2 draw calls in total. At most 36 coin
nodes plus 1 callout node are on screen. No page errors in any run. `npx vite build` passes.

## Follow-ups
- The new death rings still create a `Mesh` and material per kill, like the existing `ring()`. If draw
  calls ever matter, pool the rings the same way as decals.
- The streak callout uses inline styles because `src/style.css` was off limits. The UI owner may want to
  move it into a `.streak` class.
- The coin target is `#r-gold`. If the HUD renames it, coins fall back to the top-left corner.
- The streak thresholds and the boss flash strength (`uWhite * 0.22`) are worth tuning after real play.
  The boss peak frame is very bright when zoomed in close.
- The new floating-text animation was not checked at 2560x1440. It uses `var(--s)` sizing, so it should scale.
