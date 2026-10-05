---
title: "Render performance: instanced creep crowd and tower batching"
date: 2026-10-05
summary: "Cut draw calls about 86% (4,125 to 580) and render CPU about 4x by baking creep animation into instanced meshes, instancing health bars, and batching tower statics"
---

# Render performance: instanced creep crowd and tower batching

## What happened
Executed `plans/261005-0223-render-performance`.

The render cost came from per-creep mesh trees:
- skinned clones with their own mixers;
- health bars made of 3 meshes with unique materials;
- a second shadow pass.

Towers added about 40 draw calls each.

**Implemented:**
- `npm run bench`, a CDP benchmark in headless Chrome.
- Quality presets (pixel ratio, bloom scale, creep shadows).
- Instanced health bars and blob shadows.
- Static tower merging plus a shared `BatchedMesh` per material.
- A crowd renderer that bakes each creep model's walk clip into half-float vertex
  textures and draws every creep of a model as one `InstancedMesh` per material.

## Results
Same machine load, High preset:

| Metric | Before | After |
|---|---|---|
| Draw calls | 4,125 | 580 |
| Render CPU | 33 ms | 8.4 ms |
| Render CPU, 4x CPU throttle | 119 ms | 31 ms |

Under light load: about 3.8 ms render CPU, and Medium at 4x throttle went from
13.6 to 45 fps.

## Gotchas
- **SMAA:** renders white in headless Chrome at device scale 1. This happens on
  `main` too.
- **Bloom:** with creeps on screen it whites out the screen in headless captures.
  Screenshots need bloom off.
- **Blob shadows:** at y=0.04 they sat under the road and grid overlay; raised to
  0.12.
- **Normalized attributes:** gltf-transform quantizes attributes to normalized
  ints, so writing baked positions into a cloned attribute wrapped values. A fresh
  Float32 attribute was needed.
- **`BatchedMesh` bounding sphere:** it is computed once, which culled whole tower
  sets. Fixed with `frustumCulled = false` (the code review found this).
- **Teleporting towers:** they must also move their batched parts.
- **Benchmark noise:** another session's headless Chrome (about 270% CPU on its
  GPU process) skewed the benches. Compare draw calls first.

## Next steps
- The 500-call and "Medium at 50 fps throttled" targets are not met. Animated tower
  parts (heads, orbiting gems, GLB tower skeletons) are the remaining cost.
- Model decimation was deferred.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
