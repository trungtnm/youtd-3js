---
phase: 7
title: "Cosmetic tower crests"
status: pending
priority: P3
effort: "0.5d"
dependencies: [3]
---

# Phase 7: Cosmetic tower crests

## Goal

Towers at level 30 wear a crest in the 3D world, in a style the player picks
from crests unlocked by achievements. This makes the level-30 goal visible.

## Context

- Tower views are built in `src/world/models.js` and managed in
  `src/world/world.js` (`towerViews`). `torG` caches geometry by key
  (`src/world/models.js:26`); `glow` makes emissive materials.
- An upgrade rebuilds the view (`_removeTower` then `_addTower`,
  `src/world/world.js:414-417`) while `tower.level` stays the same, and
  `giveXp` returns early at the cap, so `levelUp` does not fire again.
- `_removeTower` removes the whole group (`src/world/world.js:504-509`).
- `src/world/` only reads sim state; the crest choice comes from the profile
  through `main.js` (`world.crest = profile.crest`).

## Files to Create / Modify

- Modify: `src/world/models.js` (`buildCrest(style)` using cached geometry and materials)
- Modify: `src/world/world.js` (attach crests in `_addTower` and on `levelUp`)
- Modify: `src/main.js` (pass the chosen crest), `src/ui/hall.js` (crest picker)

## Crest styles and sources

| Style | Look | Unlocked by |
|---|---|---|
| gilded | gold ring, slow spin | Ascended (#10) |
| ember | orange glow ring with flicker | Clean Thirty (#13) |
| eternal | twin counter-rotating rings | Endless Vigil (#6) |
| obsidian | dark ring with violet glow | Extreme Victory (#9) |
| dice | small floating cube | Gambler (#28) |

## Tasks & Steps

1. `buildCrest(style)` returns a `THREE.Group` placed above the tower top, built
   from cached geometries and materials shared across towers.
2. In `world.js`, attach the crest inside `_addTower` when
   `t.level >= TOWER_MAX_LEVEL` (covers bind and upgrades) and in the `levelUp`
   handler when a tower first reaches the cap. Removal happens with the tower
   group; never dispose crest geometry or materials per tower.
3. With no crest chosen, a level-30 tower shows `gilded` once Ascended is
   earned, and nothing before that.
4. The hall's Unlocks section has a crest picker; changing it rebuilds crests on
   live towers.

## Verification

- `npm run build` passes.
- Browser: give a tower level 30 via `window.__youtd.game.giveXp(t, 1e6)` and
  confirm the crest appears; upgrade it and confirm the crest is still there;
  switch crest in the hall; sell one of two crested towers and confirm the other
  crest still renders.
