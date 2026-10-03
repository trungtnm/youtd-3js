---
phase: 6
title: "Challenge modifiers"
status: completed
priority: P2
effort: "0.75d"
dependencies: [3]
---

# Phase 6: Challenge modifiers

## Goal

Unlockable modifiers make a run harder in a specific way and raise the score
multiplier, giving experienced players new goals without adding power.

## Context

- `maxLives` exists after phase 1 and drives the start value, both lives caps,
  `livesLost` scaling, the Mend condition and the HUD bar.
- Score is only added in `kill()` (`src/sim/game.js:1231`); wave clears add none.
- Interest comes from `ECON.interestRate` plus `bonusInterest` from tower
  abilities and items (`src/sim/game.js:518-521`), paid in `onWaveCleared()`.
- `new Game({...})` is called from `src/main.js` (`startGame`) and
  `tools/balance.js:11`.

## Files to Create / Modify

- Modify: `src/data/constants.js` (`MODIFIERS` table)
- Modify: `src/sim/game.js` (`cfg.modifiers`, apply each rule, score multiplier)
- Modify: `tools/balance.js` (`MODS=glass,frugal` env, printed in RESULT)
- Modify: `index.html`, `src/main.js`, `src/style.css` (modifier picker, HUD tag)

## Modifiers (each makes the run harder)

| id | Name | Rule | Score |
|---|---|---|---|
| glass | Glass Portal | `maxLives = 30` | +30% |
| frugal | Frugal | No interest at wave end from any source (base rate, abilities, items) | +20% |
| swarm | Swarm | Creeps move 15% faster | +25% |
| naked | No Items | Creeps drop no items; boss spoils never offer items | +35% |

Multipliers add up.

## Tasks & Steps

1. `MODIFIERS` in constants with `name, desc, score`.
2. `new Game({ ..., modifiers: [] })` stores a sorted, de-duplicated list of
   known ids in `cfg.modifiers`. Apply: `maxLives` (`glass`); skip the whole
   interest payment in `onWaveCleared` (`frugal`); creep speed at spawn
   (`swarm`); drop rolls and the item spoil option (`naked`). In `kill()`
   multiply the score increment by `1 + sum(score)` only when the list is
   non-empty, so unmodified scores keep the exact same expression.
3. Setup screen: a "Challenge modifiers" row under Length with toggles; locked
   ones show the achievement that unlocks them. The selection is saved in
   settings. At `startGame`, filter it to an array of ids that exist in
   `MODIFIERS` and are in `unlockedSet(profile).modifiers`; God mode ignores the
   lock (testing) but its runs are not recorded anyway.
4. Records use the modifier-aware key from phase 2; history lists the
   modifiers; achievements read `sum.cfg.modifiers`.
5. HUD: a small tag beside the wave counter lists active modifiers.
6. Balance bot: `MODS` env parsed into the array. Without `MODS`, results match
   the baseline.

## Verification

- `npm run build` passes.
- Balance bot with no modifiers matches the baseline file from phase 1.
- `MODS=glass` and `MODS=frugal,swarm` on medium seeds 1-3 end earlier than the
  unmodified runs (record the waves in the phase notes). With `MODS=glass`, a
  tower using `livesLost` scaling starts at 0 stacks.
- Browser: locked modifiers cannot be toggled; a settings file with an unknown
  or locked modifier id starts a clean run; active modifiers show on the HUD
  and the end screen.
