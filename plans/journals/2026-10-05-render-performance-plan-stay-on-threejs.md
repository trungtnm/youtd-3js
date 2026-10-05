---
title: "Render performance plan: stay on three.js"
date: 2026-10-05
summary: "Profiling showed rendering, not the JS sim or DOM HUD, dominates frame cost; planned batching and instanced creeps instead of an engine switch"
---

# Render performance plan: stay on three.js

## What happened
The owner asked whether moving off three.js to a dedicated game engine would fix
browser performance. Before planning, a CDP profile of headless Chrome on an M4
split each frame into sim, render, composer and HUD time.

- Sim: 0.14 ms avg at 220 creeps and 25 towers (Node). HUD and layout: under 0.4 ms.
- Render at 153 creeps: about 10 ms CPU, 2,396 draw calls, 2.6M triangles.
- About 14 draw calls per creep: SkinnedMesh trees of 1-13 parts, a 3-mesh health
  bar with unique materials, and a second shadow pass.
- 25 towers alone add about 900 draw calls; nothing static is merged.

A researcher compared Godot 4, Babylon.js, PlayCanvas and Unity 6. None escapes
the browser GPU limits, and Godot's web build is WebGL2 only.

## Decision
Stay on three.js. The owner picked this over Babylon.js and Godot.

## Next steps
Plan `plans/261005-0223-render-performance/`:
1. Benchmark tool and quality presets.
2. Instanced health bars, blob shadows and decimated creep models.
3. Tower batching.
4. Instanced creep crowd with baked vertex animation.
5. Bloom resolution, verification and docs.

Targets: 500 or fewer draw calls and at most 4 ms render CPU at 150 creeps.

Reports: `plans/reports/profile-261005-0102-render-baseline.md` and
`plans/reports/researcher-261005-0102-game-engine-alternatives.md`.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
