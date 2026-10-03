# Verification: end screen, player profile and achievements

Plan: [261003-2216-end-screen-profile-achievements](../261003-2216-end-screen-profile-achievements/plan.md)
Branch: `feat/end-screen-profile-achievements`

All eight phases are implemented. Every acceptance criterion passed except the
2560x1440 browser check, which ran at the largest viewport this screen allows
(1903x1445 CSS pixels at DPR 2).

## Acceptance criteria

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | Each game recorded once; continued runs update the same entry; abandon gating; God mode never recorded | Pass | Node `check-profile.mjs` (win, continue, lose gives `runs === 1`, totals counted once); browser: Trial win, Keep playing, defeat left one history entry with the later wave; abandon at wave 3 recorded one `abandoned` entry; God mode run left no profile |
| 2 | Four end-screen tabs; sold towers in the table; MVP is top damage | Pass | Browser: sold tower greyed with a `sold` tag; MVP badge on the top-damage row; Node `check-summary.mjs` (sold tower stays in the ledger, `mvp` equals the top entry) |
| 3 | 32 achievements; wave goals use waves cleared | Pass | Node `check-achievements.mjs`: 61 hit and near-miss checks, including `level: 12, wavesCleared: 4` not earning First Stand |
| 4 | Unlocks add no power; Glass Portal does not feed `livesLost` | Pass | Node: Glass gives `lives 30 / 30`, `livesLost 0`; balance bot without modifiers matches the baseline |
| 5 | Import rejects >256 KB, malformed and wrongly typed data and failed saves; HTML renders as text; legacy best merged once | Pass | Node: prototype pollution, bad types, future version, 300 KB file, failed save; browser: garbage and 300 KB imports rejected, a profile with `<img onerror>` in an MVP id and an achievement key rendered nothing executable |
| 6 | Endless button works; keys inert behind the end screen | Pass | Browser: the button showed after a Trial win and resumed the run; Escape on the end screen did not open settings |
| 7 | Build passes; bot identical to the baseline | Pass | `npm run build`; `compare-baseline.sh` gave BASELINE MATCH after phases 1, 4, 6 and at the end against `balance-baseline-261003-end-screen.txt` |
| 8 | Browser check at 1920x1080 and 2560x1440 | Partial | 1920x1080 window checked for the end screen, Hall, modifier row and crest. The 2560x1440 resize capped at a 1903x1445 viewport; layouts scaled correctly there |
| 9 | Docs updated | Pass | `docs/architecture.md`, `docs/game-design.md`, `AGENTS.md` (`MODS`) |

## Modifier runs (medium, CAP=10, seeds 1-3)

| Modifiers | Waves reached | Baseline |
|---|---|---|
| none | 45 / 71 / 57 | 45 / 71 / 57 |
| glass | 38 / 53 / 43 | |
| frugal,swarm | 37 / 42 / 46 | |
| naked | 51 / 47 / 47 | |

No Items reached further on seed 1 (51 vs 45). Skipping drop rolls changes the
RNG stream, so later waves differ; this is within the ±15 wave seed variance
noted in `AGENTS.md`, and seeds 2 and 3 ended earlier.

## Bugs found and fixed during implementation

- Close Call and Untouchable read the portal at the end of the run, so a won run
  that continued and then fell earned Close Call. Integrity is now taken at the
  moment of victory (`livesAtVictory`).
- A "win" only checked `outcome`, so lowering `finalWave` from the console, or an
  endless run, could earn win achievements. A win now needs every wave of the
  run's length cleared.
- `recordRun` would throw on a summary whose config failed validation; it now
  skips the history entry instead.

## Not verified

- The Export button was not clicked in the browser because it downloads a file;
  `exportProfile` is a Blob download and was not exercised.
