---
phase: 2
title: "Cheap per-creep wins"
status: completed
priority: P1
effort: "1.5d"
dependencies: [1]
---

# Phase 2: Cheap per-creep wins

## Goal

Remove the per-creep draw calls that do not need skeletal animation work: health
bars, shadow-map casting and oversized meshes.

## Files to Create / Modify

- Create: `src/world/creep-overlays.js` (instanced health bars and blob shadows)
- Modify: `src/world/world.js`: `_addCreep`, `_syncGame`, `_setUnseen`, creep removal
  on `creepDied`, `creepLeaked` and the stale sweep
- Modify: `src/world/glb-models.js` (`fitted()` sets `castShadow` from the quality
  flag for creeps only)
- Modify: `tools/import-models.mjs` (simplify heavy creep models)
- Regenerated: `public/models/*.glb` for affected creeps, `docs/model-credits.md`
  if the generator rewrites it

## Tasks & Steps

1. **Build instanced health bars** in `creep-overlays.js`.
   - One `InstancedMesh` for each bar layer (background, fill, shield). Each uses
     a camera-facing quad: a vertex shader billboard through `onBeforeCompile`, or
     a per-frame matrix built from the camera quaternion.
   - Per-instance attributes: world position, width, fill fraction, colour (HSL
     from health, the same formula as now) and visibility.
   - Keep `depthTest: false` and the render order above the scene, as now.
   - `allocate(uid)` and `release(uid)` reuse slots. `update(...)` writes the
     attributes and `count`.
   - Replace the three per-creep `PlaneGeometry` meshes and materials in
     `_addCreep`. Today each creep creates three unique materials.
2. **Add blob shadows.** Use one `InstancedMesh` of a soft radial-gradient disc,
   transparent with `depthWrite: false`, scaled by creep size and hidden for
   unseen creeps. Creeps stop casting shadow-map shadows when
   `quality.creepShadows` is false. Towers and the map keep real shadows.
3. **Simplify heavy creep models.** In `tools/import-models.mjs`, add
   `--simplify true --simplify-ratio <r>` to the gltf-transform `optimize` call for
   creep entries whose vertex count is over about 8k. The soldier, king and
   challenge humanoids are about 20k vertices. Rerun `npm run import:models` for
   creeps only, and check `/gallery.html` for broken silhouettes.
4. **Keep picking unchanged.** The invisible hit sphere per creep stays, since it
   costs no draw call.

## Verification

- `npm run bench`, High and Medium at 150 creeps:
  - draw calls drop by at least 3 per creep from the health bars;
  - on Medium, shadow-pass creep draws are gone.
- In-browser wave check at 1920x1080 and 2560x1440:
  - bars follow creeps and recolour green to red;
  - shields show;
  - bars hide on invisible creeps;
  - blob shadows sit under ground creeps, and under fliers at reduced opacity.
- `/gallery.html`: simplified creeps still read correctly.
- `npm run build` passes.
