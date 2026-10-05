# Render performance baseline

Measured 2026-10-05:
- **Machine and browser:** headless Chrome on an Apple M4 (ANGLE Metal, hardware GPU).
- **Viewport:** 1920x1080 at device scale 2; the renderer caps pixel ratio at 1.5.
- **Scene:** Sky Island map.
- **How:** a CDP script wrapped `game.update`, `world.render`, `world.composer.render`
  and `hud.update` with timers, and summed `renderer.info` per frame with `autoReset`
  off.
- **Limit:** no GPU timer queries, so the numbers are CPU submission time plus draw
  and triangle counts. Real GPU time on weaker machines is not measured.

## Where the frame goes

| Part | Cost | Notes |
|---|---|---|
| Simulation (`src/sim`) | 0.14 ms avg, 8 ms worst frame | Node, 25 towers, up to 220 creeps |
| HUD (`hud.update`) plus style/layout | under 0.4 ms | DOM work is not the problem |
| Render, no creeps, 25 towers | ~2.3 ms CPU, ~1,100 draw calls | Static scene and towers are not batched |
| Render, no creeps, no towers | ~0.6 ms CPU, ~200 draw calls | Map alone |
| Render, 111 creeps | 8.9 ms CPU, 1,783 calls, 1.73M tris | |
| Render, 153 creeps | ~10.4 ms CPU, 2,396 calls, 2.59M tris | ~14 calls and ~16k tris per creep across both passes |

## Toggles at 111 creeps

| Setting | Render CPU | Draw calls | Triangles |
|---|---|---|---|
| All on | 8.9 ms | 1,783 | 1.73M |
| Shadows off | lower; the run included one-off shader recompiles | 1,054 | 0.92M |
| Shadows and bloom off | 5.1 ms | 1,036 | 0.91M |

## Conclusions

1. **Rendering dominates the frame cost.**
   - The cost scales with creep count: each GLTF creep is a separate SkinnedMesh
     tree (`SkeletonUtils.clone` plus its own `AnimationMixer` in
     `src/world/glb-models.js`).
   - Each creep needs about 7 draw calls per pass.
   - Each creep is drawn twice, once for the shadow map and once for the main pass.
2. **The shadow pass roughly doubles draw calls and triangles.** Bloom adds about
   3-4 ms CPU.
3. **Towers add about 35 draw calls each** (~900 calls for 25 towers): dais, model
   parts and crest are separate meshes.
4. **An M4 holds 60 fps at about 10 ms render CPU.** An integrated-GPU laptop at 2-4x
   slower drops to 25-40 fps in the same wave, which matches the reported slowdown.
5. **The JS simulation and DOM HUD are not bottlenecks.** Moving them to another
   engine would not buy frame time.
