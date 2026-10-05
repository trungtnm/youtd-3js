# Game engine alternatives for YouTD Reforged

Research only, written from a code scan and public sources (2025-2026). Runtime
numbers for this game are in `profile-261005-0102-render-baseline.md`.

## Bottom line

Switching engines does not fix browser performance. Skinning, fill rate, shadow
passes and bloom cost the same on the same GPU whichever engine issues them. A
switch costs a rewrite of `src/sim/`, the HUD and the data pipeline. The large win
(baked vertex animation for crowds) is also available in three.js.

## Comparison

| Option | Likely gain vs three.js here | Port cost | Fit |
|---|---|---|---|
| Stay on three.js and optimize | High if the skinned crowd is the bottleneck | Days | Best: sim, HUD and balance bot untouched |
| Babylon.js | Moderate: built-in baked vertex animation | 1-2 weeks to rewrite `src/world/` | OK |
| PlayCanvas | Moderate: faster on joint-heavy skinning and shadows plus post | Large, editor-centric | Poor for a code-first Vite project |
| Godot 4 (web) | None to negative: web is WebGL2 Compatibility renderer only | Full rewrite (GDScript; C# cannot export to web) | Poor |
| Unity 6 (web) | Neutral; ~8 MB empty build, slower load | Full rewrite in C# | Poor |
| Defold / Cocos / Bevy-wasm | Not evaluated in depth | Full rewrite | Not worth it |

## Findings

- **Godot 4 web:** WebGL2 Compatibility renderer only, no official WebGPU.
  Multi-threaded export needs COOP/COEP headers. C# projects cannot export to web.
  Native export (Vulkan/Metal) is faster, but that is a different product goal.
  [docs](https://docs.godotengine.org/en/latest/tutorials/export/exporting_for_web.html),
  [C# web status](https://forum.godotengine.org/t/is-there-an-update-on-exporting-c-projects-to-web/128821)
- **Engine benchmark** (three.js r186, PlayCanvas 2.22, Babylon 9.26, one M1 Pro):
  - 500 plain skinned models: 12-14 ms CPU in all three.
  - Joint-heavy models: PlayCanvas fastest.
  - Shadows plus post-processing: PlayCanvas 21 ms, three.js 52 ms, Babylon 78 ms.
  - Baked vertex animation in Babylon: about 0.1 ms for 500 characters.
  - WebGPU is slower than WebGL2 for non-instanced scenes in all three.

  [mvaligursky/webgpu-webgl-benchmarks](https://github.com/mvaligursky/webgpu-webgl-benchmarks).
  This is one third-party source on one machine, so treat it as directional.
- **Babylon baked animation:** [blog](https://babylonjs.medium.com/creating-thousands-of-animated-entities-in-babylon-js-ce3c439bdacf)
- **Unity 6:** WebGPU is reported out of experimental in 6.6 but off by default.
  The runtime fee was cancelled in 2024.
  [runtime fee](https://unity.com/blog/unity-is-canceling-the-runtime-fee),
  [build sizes](https://gist.github.com/aras-p/740c2d4f9977ce92b7de72b1394dd365)
- **three.js:**
  - `BatchedMesh` and `InstancedMesh` cover static geometry.
  - Skinned crowds need baked animation (vertex animation textures) to become one
    instanced draw per model.
  - Shadow casters and post passes multiply the cost.

  [forum: instanced skinned meshes](https://discourse.threejs.org/t/animated-instanced-skinned-meshes-gltf/41958),
  [BatchedMesh](https://tympanus.net/codrops/2024/10/30/interactive-3d-with-three-js-batchedmesh-and-webgpurenderer/)

## Limits

- The engine benchmark is a single source.
- Unity 6.6 and three.js WebGPU readiness rest on secondary sources.
- The Godot WASM size was not verified.
- Mobile browsers were not covered.
