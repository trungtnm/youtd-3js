# Effects upgrade at half the render cost

Status: done (all phases); results below

## Outcome

Better-looking tower and spell effects, and the render benchmark at about twice
today's headroom: roughly half the draw calls and render time of the baseline.

Baseline (`QUALITY=high npm run bench`, Apple M4, 25 towers, ~170 creeps):
~650-740 draw calls, ~3.7 ms render, ~3.0 ms composer.
Stress variant (12 bolts + chain per 100 ms, meteor per 600 ms): ~970 calls, 4.5 ms.

Where the calls go today: ~206 in the shadow pass; ~120 per-creep champion rings,
crown spikes and halos; ~90 animated tower parts (gems, runes, halos) and ~60 curated
model meshes; ~100 unbatched static map props.

## Phases

1. Instance proxies: animated tower parts, curated tower model meshes and creep
   crowns are drawn through shared instanced meshes keyed by geometry and material,
   while the scene graph keeps animating them.
2. Static map batching: map props that never move are merged per material when a
   map is built (moving ones found by sampling the map's own update).
3. Meteor Totem calls falling meteors (the new rock) instead of orange bolts.
4. Batched projectiles with ribbon trails.
5. Batched ground effects: rings, flash discs, zones and scorch marks in one
   instanced shader with per-element styles.
6. Novas: instanced ice crystals and root spikes bursting from the ground.
7. Beams drawn through the batched bolt renderer.
8. Find the NaN that whites out the screen at extreme gold/lives values.

## Acceptance

- `npm run build` passes.
- Bench (high) draw calls and render ms about half the baseline; stress bench too.
- Screenshots of each effect at 1920x1080 and 2560x1440; no console errors.
- Balance bot on 3 seeds unchanged within noise for the Meteor Totem change.
- Docs: architecture.md lists the new modules; credits stay complete.

## Results

`QUALITY=high`, 3 runs each, same session, original commit vs. this work:

| | Draw calls | Render ms | Composer ms |
|---|---|---|---|
| Normal, before | ~650 | ~3.86 | ~3.12 |
| Normal, after | ~343 | ~3.25 | ~2.52 |
| Stress, before | ~955 | ~4.55 | ~3.81 |
| Stress, after | ~356 | ~3.37 | ~2.59 |

Draw calls halved (2.7x fewer under effect load). CPU render time fell 16-26%,
not half: the remaining cost is per-frame overhead (skinned tower models, scene
traversal, post passes) rather than draw count. GPU time is not measured.

Meteor Totem carry score (`tools/carry-bench.js`): 0.50 before, 0.48 after; the
meteors now land 0.6 s after the cast and hit what stands there then. The
balance bot never builds it, so its results are unchanged.

The white screen at extreme values came from the nexus glow reading
lives / maxLives unclamped (the bench sets lives to 1e9); integrity is clamped now.

## Review fixes

An independent review found no crashes, leaks, picking or sim desync bugs. Fixed
after it: shader-patched map materials (dusk banners) are no longer merged; the
ground-effect batch takes a free slot so long zones are not overwritten by
splash rings; transparent tower parts stay out of the instance proxies; the
falling-meteor lead uses the movement step's capped slow and stun. Balance bot
(medium, fire+storm, seeds 1-3) is identical before and after; the bot never
builds Meteor Totem.
