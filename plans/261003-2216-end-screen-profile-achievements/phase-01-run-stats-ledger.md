---
phase: 1
title: "Run stats ledger in the sim"
status: completed
priority: P1
effort: "0.75d"
dependencies: []
---

# Phase 1: Run stats ledger in the sim

## Goal

`Game.summary()` returns everything the end screen and achievements read,
including sold towers, a derived outcome and portal integrity, without changing
behavior or consuming RNG.

## Context

- `Game.stats` today: `kills, leaks, damage, goldEarned, itemsFound` (`src/sim/game.js:68`).
- Towers keep `damageDealt, kills, level, items, perks, trained, invested` (`src/sim/game.js:125`).
- `this.level` is the last *started* wave (`src/sim/game.js:52`); early calls push
  it ahead of what was survived (`src/sim/game.js:190-198`). Only
  `onWaveCleared()` (`src/sim/game.js:630-638`) knows a wave was cleared.
- `sell()` (`src/sim/game.js:159-167`) unequips items at :163 and deletes at :164.
  Projectiles and `delayed` closures fired before the sale still hit later and add
  to the detached tower's `damageDealt` (`src/sim/game.js:937-945`, `:1159-1163`, `:1199-1200`).
- Attack type is per hit (`src/sim/game.js:966`) and can change by level or item
  (`src/sim/game.js:567-569`); spell damage has none (`src/sim/game.js:1181`).
- Lives start at 100 (`:46`) and are capped at 100 in item use (`:327`) and the
  Mend spoil (`:1377`); `livesLost` scaling uses `100 - game.lives`
  (`src/sim/abilities.js:781`); Mend is offered when `g.lives <= 85`
  (`src/data/boss-spoils.js:11`); the HUD bar reads lives as a percent
  (`src/ui/hud.js:197-199`).
- `leak()` (`src/sim/game.js:801`) counts every creep, including challenge creeps
  with `leak: 0` (`src/data/constants.js:69`).
- Research and reroll spend tomes, not gold (`src/sim/game.js:170-185`); gold is
  spent in build (:117), upgrade (:141) and train (:1325).
- One unique item per tower (`src/sim/game.js:286-287`).

## Files to Create / Modify

- Modify: `src/sim/game.js`
- Modify: `src/sim/abilities.js` (`livesLost` uses `maxLives`)
- Modify: `src/data/boss-spoils.js` (Mend condition relative to `maxLives`)
- Modify: `src/ui/hud.js` (lives bar width `lives / maxLives`; nothing else in this phase)

## Tasks & Steps

0. Save the baseline before touching code: run `DIFF=medium|hard SEED=1..3
   CAP=10 node tools/balance.js` and write the RESULT lines to
   `plans/reports/balance-baseline-261003-end-screen.txt`. Every later phase
   diffs against this file.
1. **Portal integrity.** Add `this.maxLives = 100` in the constructor (phase 6
   sets it from modifiers). Use it for the start value, both caps (:327, :1377),
   `livesLost` (`maxLives - lives`), the Mend `when` (`g.lives <= g.maxLives * 0.85`)
   and the HUD bar. With no modifier every value equals today's.
2. **Counters.** Extend `this.stats` with only what a panel or achievement reads:
   - `wavesCleared`: highest wave cleared, set in `onWaveCleared()`.
   - `leakLog: []` of `{ wave, size, race, lives }` where `lives` is the portal
     damage (0 for challenge creeps).
   - `bossKills` (boss and challenge boss sizes, in `kill()`).
   - `goldSpent: { build, upgrade, train }` and `tomesSpent: { research, towers, reroll }`.
   - `earlyCalls`, `transmutes`, `peakUniquesCarried` (updated on equip).
   - `soldTowers: []`.
3. **Per-tower damage split.** Give each tower `dmgSplit = {}` at build. In
   `applyRaw()` add `dmg` to `t.dmgSplit[opts.spell ? 'spell' : (t.stats.attackType || t.def.attack)]`.
   That is one integer add on an existing object; no allocation per hit after the
   first key.
4. **Sold towers.** `towerSnapshot(t)` returns `{ uid, id, name, element, rarity,
   tier, level, kills, damage, dmgSplit, items: [ids], perks: [ids], trained,
   invested, sold }`. In `sell()`, as the first statement, push
   `tower` itself (not a copy) to `stats.soldTowers` and mark `tower.sold = true`;
   snapshots are built in `summary()`, so late hits from projectiles and delayed
   effects still count. Item ids are captured before unequip as `tower.soldItems`.
5. **Outcome.** Add a terminal phase `'abandoned'` and `abandon()` that sets it
   (only from `prep` or `running`). `callNextWave()`, `buildCheck()` and the wave
   timer in `update()` reject it like `won`/`lost`. `summary()` derives
   `outcome` from `this.phase` (`won`, `lost`, `abandoned`, or `running` for an
   in-progress game) and also reports `continued: this.finalWave === Infinity && this.cfg.length !== 'endless'`.
6. **Summary.** Keep every existing field (`level, score, kills, leaks, damage,
   gold, items, towers, time, cfg`) unchanged; `towers` stays the live count.
   Add: `outcome, continued, wavesCleared, lives, maxLives, towerLedger`
   (live and sold snapshots sorted by damage), `mvp` (uid of the top entry),
   `damageByElement`, `damageByAttack` (from `dmgSplit`, including `spell`),
   `leaksBySize`, `leaksByRace`, `leakWaves` (waves with portal damage),
   `challengeEscapes`, `goldSpent`, `tomesSpent`, `earlyCalls`, `transmutes`,
   `bossKills`, `peakUniquesCarried`.

## Verification

- `npm run build` passes.
- Balance bot RESULT lines for medium/hard seeds 1-3 match the baseline file.
- Node one-off (scratchpad): run the bot to wave 20, sell one tower, run 5 more
  waves, then check `summary()`: the sold tower appears with `sold: true`,
  `damageByElement` sums to `stats.damage` minus tower-less damage (shown as
  "Other"), `wavesCleared <= level`, and `outcome === 'running'`; after
  `abandon()`, `outcome === 'abandoned'` and `callNextWave()` does nothing.
