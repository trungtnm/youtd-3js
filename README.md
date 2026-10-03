# YouTD Reforged

A browser tower-defense game in three.js, recreating YouTD (the Warcraft III
map). The game is about training a few champion towers with levels, perks and
items, not about covering the map with towers.

- 690 towers and 315 items from YouTD, with their behavior scripts ported.
- Five difficulties, Build or Random mode, 80 waves, 120 waves or endless.
- Element research with knowledge tomes, tower training, perks every 5 levels,
  boss spoils, and challenge waves every 8th wave.
- Plain JavaScript ES modules built with Vite. No framework.

## Quick start

Requires Node.js and npm.

```bash
npm install
npm run dev        # http://localhost:5317
```

The dev server also serves `/gallery.html`, a review page showing every tower
family and creep with its model.

To open the game from another device on your network, run
`npm run dev -- --host 0.0.0.0`.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Vite dev server on port 5317 |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build on port 5318 |
| `npm run balance` | Headless balance bot (see below) |
| `npm run import:youtd` | Regenerate `src/data/youtd/generated.js` from `third_party/youtd2` |
| `npm run import:models` | Download and compress the tower and creep models in `src/data/model-map.js`; with `MESHY_API_KEY`, generate missing tower models with Meshy |
| `npm run import:icons` | Copy the icons chosen in `src/data/icon-map.js` from a game-icons clone (`GAME_ICONS_DIR`) |

## Controls

| Input | Action |
|---|---|
| Left click | Select, or place the tower being built |
| Shift + left click | Place and keep building the same tower |
| Right click | Cancel placement or clear the selection |
| Left or right drag | Pan the map |
| Screen edge | Pan the map (toggle in Settings) |
| Middle drag, Q / E | Rotate the camera |
| Mouse wheel | Zoom toward the cursor |
| Space | Call the next wave |
| Auto (top bar) | Toggle auto waves. Off by default: the next wave waits until the field is clear |
| Auto (Items panel) | Toggle auto transmute: spare items combine in threes as they arrive |
| 1 / 2 / 3 | Game speed |
| P | Pause |
| U | Upgrade the selected tower |
| T | Train the selected tower |
| F / G | Cast the selected tower's first / second ability |
| X / Delete | Sell the selected tower |
| Esc | Cancel, deselect, or open settings |

Drag an item from the stash onto a tower to equip it.

## Balance bot

The simulation in `src/sim/` is headless, so a bot can play full runs in Node.
Options are environment variables:

```bash
DIFF=medium MODE=build SEED=2 A=fire B=storm CAP=10 AUTO=0 V=1 node tools/balance.js
```

| Variable | Meaning |
|---|---|
| `DIFF` | Difficulty |
| `MODE` | `build` or `random` |
| `SEED` | RNG seed |
| `A`, `B` | The two elements the bot researches |
| `CAP` | Maximum number of towers the bot builds |
| `AUTO=1` | Turn on auto waves (off by default, as in the game) |
| `V=1` | Print one line per wave |

Results vary by about 15 waves between seeds, so run several. Current targets
are in [docs/game-design.md](docs/game-design.md#balance-targets).

## Project layout

| Path | Contents |
|---|---|
| `src/sim/` | Game state and rules. No three.js or DOM |
| `src/data/` | Elements, damage matrix, towers, items, perks, boss spoils |
| `src/world/` | three.js scene, camera, procedural models, effects |
| `src/ui/` | DOM HUD |
| `src/audio/` | Synthesized sound effects and music playlist |
| `src/main.js` | Menu, settings, input and the fixed-step game loop |
| `tools/` | Balance bot and YouTD 2 data importer |
| `third_party/youtd2/` | MIT-licensed YouTD 2 data tables |

## Documentation

- [Architecture](docs/architecture.md): layers, simulation, damage pipeline, rendering.
- [Game design](docs/game-design.md): rules, economy, waves and balance targets.
- [YouTD port](docs/youtd-port.md): data pipeline, licensing and port status.
- [AGENTS.md](AGENTS.md): conventions and verification steps for contributors.

## Credits and licensing

- Tower and item data come from the MIT-licensed tables of
  [YouTD 2](https://github.com/Praytic/youtd2), copied to `third_party/youtd2/`
  with their license. YouTD 2 art, icons and text (CC-BY-NC) are not used.
  In-game descriptions are written from the ported mechanics.
- Tower and item icons are from [game-icons.net](https://game-icons.net) (CC BY 3.0).
  See [docs/icon-credits.md](docs/icon-credits.md).
- Tower and creep models are CC0 and CC BY models from [Poly Pizza](https://poly.pizza)
  (Quaternius, Kay Lousberg, Poly by Google and others).
  See [docs/model-credits.md](docs/model-credits.md).
- Music by Kevin MacLeod ([incompetech.com](https://incompetech.com)), CC BY 4.0.
  See [docs/music-credits.md](docs/music-credits.md).
- YouTD is the original Warcraft III custom map. This project is a fan
  recreation and is not affiliated with Blizzard Entertainment.
