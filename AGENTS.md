# AGENTS.md

Guidance for coding agents working in this repository.

## Project

YouTD Reforged: a browser tower-defense game in three.js, recreating YouTD (the
Warcraft III map). Plain JavaScript ES modules, built with Vite. No framework, no
TypeScript, no test framework.

Read first:
- `docs/architecture.md` for code layout and data flow.
- `docs/game-design.md` for rules, economy and balance targets.
- `docs/youtd-port.md` before touching towers, items or `third_party/youtd2`.

## Commands

```bash
npm install
npm run dev            # Vite dev server on port 5317 (add -- --host 0.0.0.0 for LAN/Tailscale)
npm run build          # production build into dist/; must pass before finishing
npm run balance        # headless balance bot (see below)
npm run bench          # render benchmark in headless Chrome; needs npm run dev running
npm run import:youtd   # regenerate src/data/youtd/generated.js from third_party/youtd2
GAME_ICONS_DIR=/path/to/game-icons npm run import:icons  # copy curated icons, regenerate docs/icon-credits.md
npm run import:models  # download/compress curated tower and creep models, regenerate docs/model-credits.md
MESHY_API_KEY=... MESHY_MAX=5 npm run import:models  # also generate up to 5 missing tower models with Meshy (costs credits)
```

Balance bot options are environment variables:

```bash
DIFF=medium MODE=build SEED=2 A=fire B=storm CAP=10 AUTO=0 V=1 node tools/balance.js
```

For runtime checks of many towers, set `game.cfg.mode = 'sandbox'` on a `Game`
instance: it skips the first-tier-only and research build rules.

`DIFF` difficulty, `MODE` build or random, `SEED` RNG seed, `A`/`B` elements the
bot researches, `CAP` max towers it builds (10 matches the intended play style),
`AUTO=1` turns on auto waves (default off, as in the game), `MODS=glass,frugal`
applies challenge modifiers, `V=1` prints per-wave lines. Run several seeds;
results vary by ±15 waves.

## Layout rules

- `src/sim/` is headless. Never import three.js or touch the DOM there; the
  balance bot runs it in Node.
- `src/world/` and `src/ui/` read simulation state and listen to `Game` events.
  Change rules through `Game` methods, not by mutating state from the view.
- New tower or item mechanics belong in the ability engine
  (`src/sim/abilities.js`, `applyEffect`) as reusable effect kinds, then get
  used from data (`src/data/youtd/tower-ports.js`).
- Tower family and item icons are curated in `src/data/icon-map.js` (one
  game-icons.net icon per family and item, matching the name). After editing it,
  run `npm run import:icons` with `GAME_ICONS_DIR` set to a clone of
  github.com/game-icons/icons; `public/icons/gi/` and `docs/icon-credits.md` are
  generated.
- Tower models are curated in `src/data/model-map.js` (Poly Pizza ids, CC0 or
  CC-BY only, keyed by the family's first tier name). `npm run import:models`
  downloads and compresses them; `public/models/`, `src/data/model-library.js`
  and `docs/model-credits.md` are generated. Families without a model use the
  procedural builders in `src/world/models.js`. Creep models per race are in
  `CREEP_MODEL_MAP` and must be animated (walk or fly clip). Families without a
  free model can get a Meshy model from a prompt in `tools/meshy-prompts.mjs`.
  Review picks at `/gallery.html` on the dev server (every tower family and
  creep): static T-pose characters and props that shrink to nothing look broken.
- `src/data/youtd/generated.js` is generated. Edit `tools/import-youtd2.mjs` or
  the data in `third_party/youtd2/` instead, then rerun the import.
- HUD sizes in `src/style.css` use `calc(var(--s) * Npx)` so the UI scales with
  the window. Keep that pattern for new styles.

## Licensing constraints

- Only the MIT-licensed YouTD 2 data tables may be used. Do not copy YouTD 2
  art, icons or text assets (CC-BY-NC), and do not copy ability description text
  from youtd.best or the original map. Write descriptions from the mechanics.
- Third-party assets must carry credits: icons in `docs/icon-credits.md`, models
  in `docs/model-credits.md`, and both in the in-game Credits section, music in `docs/music-credits.md` and Credits.

## Verifying changes

1. `npm run build` must pass.
2. For simulation or balance changes, run the balance bot on 3+ seeds and on the
   affected difficulties; compare against the table in `docs/game-design.md`.
3. For UI or rendering changes, check the game in a browser at 1920x1080 and
   2560x1440 (start a run, build towers, start a wave). `window.__youtd` exposes
   `game`, `world` and `hud` for scripted checks. For changes that can affect
   frame cost, compare `npm run bench` (draw calls, render ms) before and after;
   the timings are noisy, so judge draw calls first and run it more than once.
4. Update `docs/` when rules, data pipeline, balance targets or architecture
   change, and update the port status table in `docs/youtd-port.md` when porting
   scripts.

## Conventions

- Match the surrounding style: small helpers, short comments explaining why,
  descriptive names, no plan or ticket ids in code or commit messages.
- Distances in data from YouTD are Warcraft III units; divide by 94 for world
  units. YouTD tiers are 1-based; this game's `tier` field is 0-based.
- Plans and reports go in `plans/`; long-lived docs go in `docs/`.
