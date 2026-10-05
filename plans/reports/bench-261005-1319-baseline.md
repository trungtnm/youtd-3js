# Bench baseline (before render optimizations)

**Setup:**
- **Command:** `npm run bench`, with only the quality presets and the bench tool from
  phase 1 added.
- **Machine:** Apple M4, headless Chrome (ANGLE Metal).
- **Scene:** Sky Island map at 1920x1080, 2x device scale, 25 tier-1 towers across
  families.
- **Crowd:** waves are topped up to at least 150 creeps, and overshoot to about 200.

**Columns:**
- `renderMs` is all of `world.render`, including `composerMs`.
- Calls and triangles are summed over all passes (shadow plus main plus post).

## CPU throttle 1x

| quality | fps | creeps | simMs | renderMs | composerMs | hudMs | calls | tris |
|---|---|---|---|---|---|---|---|---|
| high | 41.9 | 209 | 0.26 | 21.97 | 19.50 | 0.13 | 3,994 | 2.59M |
| medium | 54.1 | 207 | 0.25 | 16.76 | 14.68 | 0.08 | 2,734 | 1.39M |
| low | 59.8 | 186 | 0.30 | 13.65 | 11.97 | 0.07 | 2,547 | 1.28M |

## CPU throttle 4x

| quality | fps | creeps | simMs | renderMs | composerMs | hudMs | calls | tris |
|---|---|---|---|---|---|---|---|---|
| high | 11.5 | 190 | 2.18 | 74.31 | 65.04 | 0.91 | 3,780 | 2.19M |
| medium | 13.6 | 205 | 2.07 | 62.61 | 54.27 | 0.71 | 2,747 | 1.33M |
| low | 14.2 | 198 | 2.03 | 60.15 | 52.92 | 0.63 | 2,700 | 1.30M |

## Towers only (`CREEPS=0`, high)

60 fps, 2.73 ms render, 1,076 calls, 288k tris.
