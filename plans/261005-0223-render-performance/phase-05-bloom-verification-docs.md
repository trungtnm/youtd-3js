---
phase: 5
title: "Bloom cost, verification and docs"
status: completed
priority: P2
effort: "1d"
dependencies: [2, 3, 4]
---

# Phase 5: Bloom cost, verification and docs

## Goal

Lower the bloom cost on Low and Medium, verify the full plan against its acceptance
criteria, and document the new rendering pieces.

## Files to Create / Modify

- Modify: `src/world/world.js` (bloom render size from `quality.bloomScale` in
  `resize()` and `setQuality()`)
- Modify: `docs/architecture.md` (crowd renderer, creep overlays, quality presets,
  bench tool)
- Modify: `AGENTS.md` (add `npm run bench` to Commands and to "Verifying changes"
  for rendering work)
- Create: `plans/reports/profile-<date>-render-after.md` (bench tables before and
  after)

## Tasks & Steps

1. **Size bloom from the preset.** `UnrealBloomPass` gets its resolution as
   `innerWidth * bloomScale` by `innerHeight * bloomScale`, and `resize()` keeps it
   in sync. Check that the bloom look at 0.5 stays acceptable on every map.
2. **Run the full bench:**
   - `QUALITY=low,medium,high` with `THROTTLE=1` and `THROTTLE=4`
   - `CREEPS=150 TOWERS=25` on each map
   - write the before/after report
3. **Check visual parity.** Screenshot a running wave on each of the five maps at
   High, and compare with screenshots taken on `main` before phase 2.
4. **Check the simulation is untouched.** Run `npm run balance` on three seeds; the
   results should match `main`.
5. **Update the docs:**
   - `docs/architecture.md`: the world layer now has a crowd renderer and creep
     overlays, with their data flow, and quality presets.
   - `AGENTS.md`: the bench command.

## Verification

- Every acceptance criterion in `plan.md` is checked off with numbers from the
  report.
- `npm run build` passes.
