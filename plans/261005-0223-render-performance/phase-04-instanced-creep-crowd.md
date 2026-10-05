---
phase: 4
title: "Instanced creep crowd with baked animation"
status: completed
priority: P1
effort: "3-5d"
dependencies: [2]
---

# Phase 4: Instanced creep crowd with baked animation

## Goal

Draw every creep that uses a curated GLB model as one instanced draw per model and
material group, so creep render cost no longer grows with creep count.

## Background

- **Creep models:** there are 15 GLB creep models (`CREEP_MODEL_MAP`, 5 races x
  ground/air/boss).
- **Today:** each creep gets a `SkeletonUtils.clone` and its own `AnimationMixer`
  (`attachCreepGlb` in `src/world/glb-models.js`). Models have 1-13 skinned parts
  and 1-6 materials.
- **Clip:** creeps play a single looping move clip, or idle, which makes them a good
  fit for baked vertex animation (VAT).

## Files to Create / Modify

- Create: `src/world/creep-crowd.js` (bake, instanced draw, per-instance state)
- Modify: `src/world/glb-models.js` (expose the loaded gltf and fitted transform for
  baking; `attachCreepGlb` returns crowd mode instead of cloning when the model is
  baked)
- Modify: `src/world/world.js` (`_addCreep`, `_syncGame`, `_look`, `_setUnseen`,
  creep removal paths, `modelswap` handling)
- Modify: `src/world/models.js` (`buildCreepModel` keeps procedural bodies and the
  `userData.keep` extras such as boss rings)
- Modify: `src/gallery.js` only if it relies on per-creep clones (keep the gallery on
  the old clone path if simpler)

## Tasks & Steps

1. **Bake each model once after it loads.**
   - Take the fitted model, i.e. the same scale and yaw as `fitted()`.
   - Merge all skinned and plain parts into one geometry, keeping material groups.
   - Sample the move clip (`pickMove`, falling back to `pickIdle`) at 30 fps over
     its duration.
   - For each frame, apply the skinned transforms on the CPU
     (`SkinnedMesh.applyBoneTransform`) and write positions and normals into
     float `DataTexture`s. Width is the vertex count, rows are frames; split rows
     if the width exceeds `maxTextureSize`.
   - Log the memory per model.
2. **Write the crowd shader.**
   - Patch the model's existing materials with `onBeforeCompile`, so lighting,
     maps and emissive stay identical.
   - Read the position and normal at `frame = floor(t)` and `frame + 1`, and
     interpolate between them.
   - Per-instance attributes:
     - `aAnim`: phase offset and time
     - `aFlash`: 0-1 white blend
     - `aUnseen`: shimmer amount, reusing the colours from `unseenMat` in
       `world.js`
     - `aSquash`: xyz scale
     - the instance matrix: position, yaw, base scale
3. **Add crowd management.**
   - Create one `InstancedMesh` per model with a capacity that grows by doubling.
   - Use `allocate`, `release` and `update` like the overlays from phase 2.
   - Mark the instance matrix and attributes `DynamicDrawUsage`.
   - Set `frustumCulled = false`, or keep a bounding sphere that grows to the map
     bounds.
   - Shadows: the crowd mesh casts shadows only when `quality.creepShadows` is
     true, which is still one draw per model.
4. **Integrate with `world.js`.**
   - **Per-creep state:** when a creep's model is baked, `_addCreep` allocates a
     crowd slot instead of adding a mesh tree.
   - **Animation and hit reactions:** `_syncGame` writes the slot's matrix and
     attributes; walk speed, stun freeze, slow and hit-stop scale the animation
     time instead of `mixer.update`. Hit flash and shimmer set `aFlash` and
     `aUnseen` instead of swapping materials in `_look`.
   - **Extras:** boss and champion extras (`userData.keep` parts) stay as small
     per-creep meshes, since there are only a few of those creeps at a time.
   - **Fallback:** procedural creeps (model not loaded yet, or no curated model)
     keep the current path. The `modelswap` event moves a creep from procedural
     to crowd.
5. **Remove the per-creep `AnimationMixer`** for baked creeps. Keep the clone path
   available behind a flag for debugging (`world.crowd = false`).

## Verification

- `npm run bench` at 150 creeps, High:
  - creep draw calls are constant, about 1-3 per model present, plus extras;
  - total draw calls are 500 or fewer;
  - render CPU is 4 ms or less on the M4.
- **Visual check in the game** for each race (ground, air, boss) at 1920x1080 and
  2560x1440:
  - the walk cycle is smooth, with desynced phases;
  - stunned creeps freeze and slowed creeps animate slower;
  - hit flash, squash and knockback work;
  - invisible creeps shimmer, and look normal once revealed;
  - picking and selecting a creep work;
  - boss rings render.
- Run with `world.crowd = false` and confirm the old path still works.
- `npm run build` passes, and `/gallery.html` renders all creeps.
