# Dusk battlefield map and tower grandeur

Status: done (phases 1-3)

## Outcome

- The map reads as an ancient battlefield valley at dusk instead of a flat green
  island: warm low sun, layered mountains in haze, paved stone road, ruined
  walls and arches, broken columns, braziers, autumn trees, banners, graves,
  spears, low fog and drifting embers.
- Tower size and presence follow cost: common towers stay modest, rare and
  unique towers stand taller on grander daises (steps, pillars, trim, glow).
- Curated models are fitted by height first, so creatures and props of very
  different proportions read at a consistent size for their rarity.

## Constraints

- Gameplay layout is unchanged: `src/sim/map-layout.js` (tiles, routes, spawn,
  portal, blocked tiles) stays as is. Only `src/world/` and the grade shader change.
- The road and buildable tiles must stay readable from the default camera.
- Performance: instanced decor, at most a handful of point lights, no new
  full-screen passes beyond the existing grade pass.
- Pedestals stay inside a tile footprint plus a small overhang (tile is 2 units).

## Non-goals

- No map layout or balance changes. No new assets downloaded; decor is procedural.

## Phases

1. Environment: terrain valley + mountains, stone road, ruins and props, sky,
   fog, embers, lighting and grade (`environment.js`, `world.js`).
2. Tower grandeur: rarity- and tier-based scale, rarity daises, height-first
   model fitting (`models.js`, `glb-models.js`, `world.js` pick cylinder).
3. Verify: build, browser at 1920x1080 and 2560x1440, gallery review, docs.

## Acceptance

- `npm run build` passes; no console errors.
- Screenshots show the new style; road and tiles readable; unique towers
  visibly grander than commons; grid overlay still aligns when placing.
