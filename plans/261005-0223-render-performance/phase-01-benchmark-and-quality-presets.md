---
phase: 1
title: "Benchmark and quality presets"
status: completed
priority: P1
effort: "1d"
dependencies: []
---

# Phase 1: Benchmark and quality presets

## Goal

Make render cost measurable and repeatable with one command, and let players trade
visuals for frame rate.

## Files to Create / Modify

- Create: `tools/perf-bench.mjs`
- Modify: `package.json` (`bench` script)
- Modify: `src/main.js` (settings defaults, `applySettings`)
- Modify: `src/world/world.js` (pixel-ratio cap and creep-shadow switch read from a
  quality object)
- Modify: `index.html` (Quality select in Settings, next to the Bloom and Shadows
  checkboxes)

## Tasks & Steps

1. **Write `tools/perf-bench.mjs`.** Use plain Node with the built-in `WebSocket`,
   so no new dependency.
   - Launch local Google Chrome headless with `--remote-debugging-port` against
     the dev server (`http://localhost:5317`), which must already be running.
   - Start a run and set `game.cfg.mode = 'sandbox'` and `game.lives = 1e9`.
   - Build `TOWERS` towers (default 25) across families, then start waves until
     `CREEPS` creeps are alive (default 150), using `callNextWave()` plus
     `startWave()`.
   - Wrap `game.update`, `world.render`, `world.composer.render` and `hud.update`
     with timers, and sum `renderer.info` per frame with `autoReset = false`,
     reset at the start of `world.render`.
   - Print fps, sim/render/composer/HUD ms, draw calls and triangles for each
     preset (`QUALITY=low,medium,high`). Print the same with
     `Emulation.setCPUThrottlingRate` when `THROTTLE=4`.
   - Options are env vars, matching `tools/balance.js`: `MAP`, `TOWERS`, `CREEPS`,
     `QUALITY`, `THROTTLE`, `DPR`.
2. **Add the script:** `"bench": "node tools/perf-bench.mjs"` in `package.json`.
3. **Add a `quality` setting** (`low` | `medium` | `high`, default `high` so current
   visuals stay unless the player changes it). One object in `src/world/world.js`
   maps each preset to:
   - `pixelRatioCap`: 1 / 1.25 / 1.5
   - `creepShadows`: false / false / true (phase 2 adds blob shadows for false)
   - `bloomScale`: 0.5 / 0.5 / 1 (wired in phase 5)
4. **Add a `world.setQuality(q)` method.** It calls `renderer.setPixelRatio`,
   refreshes composer sizes through `resize()`, and stores the flags for later
   phases. The existing Bloom and Shadows checkboxes keep working as overrides.
5. **Add a Quality select** to the Settings panel in `index.html`, styled with
   `calc(var(--s) * Npx)` sizes. Wire it in `applySettings()`.
6. **Record the baseline.** Run `npm run bench` on `main` before any other phase
   and paste the table into `plans/reports/` as the baseline for the acceptance
   criteria.

## Verification

- `npm run build` passes.
- `npm run bench` prints a row per preset. The High row roughly matches the
  baseline report (about 2,400 calls at 150 creeps with no towers).
- Changing Quality in Settings updates the pixel ratio live
  (`window.__youtd.world.renderer.getPixelRatio()`), and the choice persists after a
  reload.
