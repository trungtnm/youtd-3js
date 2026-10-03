---
phase: 8
title: "Docs and full verification"
status: pending
priority: P2
effort: "0.25d"
dependencies: [1, 2, 3, 4, 5, 6, 7]
---

# Phase 8: Docs and full verification

## Goal

Docs describe the meta layer and the full acceptance list in `plan.md` passes.

## Files to Create / Modify

- Modify: `docs/architecture.md` (new `src/meta/` layer, `src/ui/hall.js`,
  stats ledger and `summary()` shape, profile storage key and versioning)
- Modify: `docs/game-design.md` (achievements, unlocks, modifiers and score
  multipliers, the "no power from meta" rule)
- Modify: `AGENTS.md` (mention `MODS` in the balance bot options)

## Tasks & Steps

1. Update the docs above; keep the achievement list itself in
   `src/data/achievements.js` and link to it instead of copying it.
2. Run the acceptance list in `plan.md` item by item and record results in a
   report under `plans/reports/`.

## Verification

- `npm run build` passes.
- Balance bot medium/hard seeds 1-3 with no modifiers match the baseline.
- Browser checks at 1920x1080 and 2560x1440 for the end screen, hall, modifier
  picker and crest.
