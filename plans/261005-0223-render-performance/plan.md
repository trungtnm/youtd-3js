---
title: "Render performance on three.js"
description: "Cut draw calls and render CPU for large waves by batching creeps, health bars and towers, with a benchmark and quality presets, instead of switching engines."
status: completed
priority: P1
effort: "8-11d"
branch: main
tags: [performance, rendering, threejs]
blockedBy: []
blocks: []
created: 2026-10-05
---

# Render performance on three.js

## Decision

**Stay on three.js and optimize.** The owner chose this over moving to Babylon.js
or Godot on 2026-10-05.

**Evidence:**
- [Render baseline profile](../reports/profile-261005-0102-render-baseline.md)
- [Engine research](../reports/researcher-261005-0102-game-engine-alternatives.md)

**What the profile shows:**
- **Simulation and HUD are cheap.** The simulation costs 0.14 ms per frame at 220
  creeps, and the HUD under 0.4 ms. Rewriting either in another engine buys nothing.
- **Rendering is the bottleneck.** At 153 creeps it costs ~10 ms CPU on an M4, with
  2,396 draw calls and 2.6M triangles.
- **Creeps cost ~14 draw calls each across two passes:**
  - one SkinnedMesh tree per creep (1-13 parts, 1-6 materials)
  - a health bar made of 3 meshes with unique materials
  - a shadow pass that draws the model again
- **25 towers add ~900 draw calls** (dais, model parts and crest are separate
  meshes).
- **Another engine would not help.** Babylon, PlayCanvas, Godot and Unity hit the
  same browser GPU limits, and Godot's web build is WebGL2 only.

## Outcome

Large waves stay smooth on mid-range laptops. The frame cost stops scaling with
creep count, and players can pick a lower quality preset on weak hardware.

## Constraints

- **Layering:** `src/sim/` is untouched; all work is in `src/world/`, `src/main.js`,
  the settings UI and `tools/`. Follow the layout rules in `AGENTS.md`.
- **Visual behavior stays the same:**
  - walk/fly animation, hit flash, squash and knockback
  - invisible-creep shimmer, health and shield bars
  - picking, selection rings, boss and champion extras
  - late-loading model swap and the procedural fallback
- **No new runtime dependencies**, unless a phase justifies one (three.js addons are
  fine).
- **Gallery still works:** `/gallery.html` keeps rendering every family and creep.

## Non-goals

- No engine switch, no WebGPU renderer migration, no gameplay or balance changes.
- No new art. Model decimation only reduces the vertex count of existing models.

## Phases

| # | Phase | Effort | Depends on | Status |
|---|-------|--------|------------|--------|
| 1 | [Benchmark and quality presets](./phase-01-benchmark-and-quality-presets.md) | 1d | none | Done |
| 2 | [Cheap per-creep wins](./phase-02-cheap-per-creep-wins.md) | 1.5d | 1 | Done |
| 3 | [Tower batching](./phase-03-tower-batching.md) | 1.5d | 1 | Done |
| 4 | [Instanced creep crowd with baked animation](./phase-04-instanced-creep-crowd.md) | 3-5d | 2 | Done |
| 5 | [Bloom cost, verification and docs](./phase-05-bloom-verification-docs.md) | 1d | 2, 3, 4 | Done |

Phases 2 and 3 touch different files and can run in parallel. Phase 4 builds on
phase 2's instanced health bars and blob shadows.

## Acceptance criteria

All numbers come from `npm run bench` (phase 1), comparing the High preset with
the recorded baseline. The scene is the Sky Island map at 1920x1080, device scale
2, with 150 creeps and 25 towers.

- [ ] **Draw calls:** 500 or fewer per frame (baseline: about 3,300 for this
  scene). Reached 512-580 (from about 4,100); animated tower parts make up the rest.
- [x] **Render CPU:** 4 ms per frame or less on the M4 (baseline: about 10-12 ms).
  3.3-3.9 ms under light load; 8 ms vs 33 ms for `main` under the heavy load of
  the final runs.
- [ ] **Throttled:** with the CPU throttled 4x through CDP, the Medium preset holds
  50 fps or more. Reached 45 fps under light load (from 13.6).
- [x] **Visual parity:** screenshots of a wave on each of the five maps at High show
  creep animation, hit flash, shimmer, health and shield bars, and tower models
  equivalent to before.
- [x] **Checks pass:**
  - `npm run build` passes
  - `/gallery.html` renders every family and creep
  - the balance bot gives unchanged results, since the simulation is untouched
- [x] **Docs:** `docs/architecture.md` describes the crowd renderer, quality presets
  and the bench tool.

## Outcome notes

- **Results:** see `../reports/bench-261005-1404-render-after.md`.
- **Model decimation (phase 2):** deferred. Triangles are not the bottleneck, and
  gltf-transform simplify halved the soldier's skinned body while barely shrinking
  the king model. Revisit if GPU-bound devices show up.
- **Tower batching** went further than phase 3 planned: a shared `BatchedMesh` per
  material (`src/world/tower-batcher.js`).
- **Bloom:** `bloomScale` (0.25 on Low, 0.5 on Medium and High) landed in phase 1
  instead of phase 5.

## Risks

- **Baked animation fidelity (phase 4):** fixed-rate frames can look steppy. Bake
  at 30 fps or more and interpolate between frames in the shader.
- **Texture memory:** 15 creep models x 1 move clip each is small (well under
  16 MB). Measure it in phase 4.
- **Multi-material models:** these become a multi-group InstancedMesh, one draw per
  material group, which is still constant per model.
