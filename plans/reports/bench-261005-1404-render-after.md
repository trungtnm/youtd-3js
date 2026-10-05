# Render optimizations: before and after

**Setup:**
- **Command:** `npm run bench`.
- **Machine:** Apple M4, headless Chrome (ANGLE Metal).
- **Scene:** Sky Island at 1920x1080, 2x device scale, 25 tier-1 towers, crowd
  topped up to at least 150 creeps (about 200 in practice).
- **Baseline file:** `bench-261005-1319-baseline.md`.

**Load caveat:**
- During the final runs the machine was heavily loaded (load average 25-44). The
  load included another session's headless Chrome, whose GPU process used about
  270% CPU.
- So absolute fps is capped by GPU contention, and timings swing ±30% between runs.
- The two rows below were run back to back under the same load.
- Draw calls are the stable metric.

## Same-load comparison (High preset)

| build | throttle | fps | renderMs | draw calls | tris |
|---|---|---|---|---|---|
| `main` | 1x | 26.2 | 33.4 | 4,125 | 3.11M |
| optimized | 1x | 35.4 | 8.4 | 580 | 3.23M |
| `main` | 4x | 7.2 | 119.3 | 3,720 | 2.37M |
| optimized | 4x | 19.8 | 31.3 | 556 | 2.36M |

## Optimized, all presets, same session

| quality | throttle | fps | renderMs | calls | tris |
|---|---|---|---|---|---|
| high | 1x | 35.4 | 8.35 | 580 | 3.23M |
| medium | 1x | 49.2 | 8.02 | 549 | 1.82M |
| low | 1x | 59.0 | 6.73 | 546 | 1.65M |
| high | 4x | 19.8 | 31.3 | 556 | 2.36M |
| medium | 4x | 23.5 | 28.3 | 519 | 1.25M |
| low | 4x | 25.3 | 25.6 | 512 | 1.11M |

## Under lighter load, earlier in the session

These are not comparable to the tables above, but they show the ceiling:

| state | High | Medium | Low |
|---|---|---|---|
| Crowd done, 1x throttle | 3.8 ms render, 780 calls | | |
| Crowd done, 4x throttle | 39 fps, 17.6 ms | 45 fps | 52 fps |
| Baseline, 4x throttle | 11.5 fps | 13.6 fps | 14.2 fps |

Tower batching later cut about 200 more calls.

## Where the draw calls went

| Step | Draw calls, High |
|---|---|
| Baseline | ~4,000 |
| Instanced health bars | ~2,950 |
| Crowd (baked animation) | ~760 |
| Tower `BatchedMesh` | ~580 |

Remaining with 25 towers:
- about 200 for the map;
- about 250 for animated tower parts (heads, orbiting gems, GLB tower models with
  their own skeletons);
- the rest for the batched daises, the crowd (1-4 per creep model present) and
  overlays.

## Acceptance criteria

| Criterion | Result |
|---|---|
| 500 or fewer draw calls | Not met: 512-580. The excess is animated tower parts. |
| Render CPU at most 4 ms (M4) | Met under light load (3.3-3.9 ms, before tower batching). Not reproducible under the final heavy load (8 ms, while `main` measured 33 ms in the same conditions). |
| Medium 50 fps or more at 4x throttle | Not met: 45 fps under light load, 23.5 under heavy load. |
| Visual parity | Met. Five maps checked. Crowd and clone screenshots of the same scene match. Towers match before and after. |
| Checks pass | Met. Build passes, gallery renders, balance bot runs; `src/sim/` is unchanged. |

## Memory

Crowd textures total about 30 MB after half-rate baking of the heavy king and
soldier models. Before that change the king alone was 13.9 MB. Baking happens
while models load in the menu; the slowest model took 548 ms before the half-rate
change.
