# YouTD three.js remake

Status: playable; tower and item roster replaced by YouTD data (phase 1 of the port, see docs/youtd-port.md)

## Outcome
A browser tower-defense game in three.js that recreates YouTD's systems with original content and polished visuals.

## Systems carried over from YouTD (mechanics only, original names/art)
- 7 elements (Nature, Fire, Ice, Storm, Iron, Astral, Darkness), 4 rarities, tower families with upgrade tiers.
- Attack type vs armor type matrix, plus a divine-like armor that resists everything but essence.
- Waves: mass / normal (+champions) / air / boss, challenge waves every 8 levels, races, random wave specials.
- Economy: gold (bounty + wave income), knowledge tomes for element research, food cap.
- Tower XP levels, item drops, item slots, oils, transmute.
- Modes: Build / Random draft; lengths 80 / 120 / endless; five difficulties.

## Non-goals
Multiplayer, builders, exact tower roster of the original.

## Acceptance
- `npm run build` passes; game runs in browser from menu to victory/defeat.
- Headless balance sim (`node tools/balance.js`) shows a greedy bot survives early waves on Medium and is pressured later.

## Layout
- `src/data` static definitions, `src/sim` headless game simulation, `src/world` three.js view, `src/ui` DOM HUD, `src/audio` WebAudio synth.
