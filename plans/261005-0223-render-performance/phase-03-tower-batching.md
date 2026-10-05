---
phase: 3
title: "Tower batching"
status: completed
priority: P2
effort: "1.5d"
dependencies: [1]
---

# Phase 3: Tower batching

## Goal

Cut towers from about 35 draw calls each to a handful, by merging static meshes
that share a material.

## Files to Create / Modify

- Modify: `src/world/models.js` (`pedestal`, `buildTowerModel`, `buildCrest`)
- Modify: `src/world/glb-models.js` (`towerInstance`: merge non-animated parts)
- Modify: `src/world/world.js` (tower hover/selection code that reads mesh
  children, if any)

## Tasks & Steps

1. **Measure the current split.** Per tower, count meshes, how many are animated
   (entries in the `anim` hooks: spin, bob, orbit, flicker, flap, pulse, barrels,
   head) and how many are static.
2. **Merge static pedestal meshes.** After `pedestal()` and the procedural tower
   body are built in `buildTowerModel`, merge every static mesh that is not
   referenced by an `anim` hook. Group them by material and use
   `BufferGeometryUtils.mergeGeometries` from `three/addons`, baking each mesh's
   local matrix into its geometry. Keep animated parts as separate meshes.
3. **Share merged geometry.** Cache the merged pedestal geometry per
   `(rarity, element, tier)` key, so towers of the same kind share one
   `BufferGeometry`.
4. **Merge static parts of GLB towers.** In `towerInstance()`, merge the
   non-skinned static parts of each GLB tower by material. Leave skinned and
   animated parts alone.
5. **Keep behavior unchanged:**
   - `castShadow` and `receiveShadow` stay as before;
   - the hit mesh used for picking stays;
   - the late-load swap through `attachTowerGlb` still replaces the procedural
     top.

## Verification

- `npm run bench` with `TOWERS=25 CREEPS=0`: draw calls fall from about 1,100 to
  300 or fewer.
- `/gallery.html`: every tower family looks the same as before, including
  spinning, bobbing and orbiting parts. Compare screenshots of a few families
  before and after.
- In the game, upgrade a tower and check that the new tier model swaps in and
  hover and selection rings still work.
- `npm run build` passes.
