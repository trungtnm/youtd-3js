---
phase: 3
title: "Achievement and unlock definitions plus evaluator"
status: completed
priority: P1
effort: "1d"
dependencies: [1, 2]
---

# Phase 3: Achievement and unlock definitions plus evaluator

## Goal

Achievements are data. A pure evaluator turns a run summary and the profile
into newly earned achievements, updated progress and the unlocks they grant,
and cannot be farmed by quitting early or calling waves early.

## Files to Create / Modify

- Create: `src/data/achievements.js` (definitions and the `UNLOCKS` catalog)
- Create: `src/meta/achievements.js` (`evaluateRun`, `progressOf`, `unlockedSet`)
- Modify: `src/meta/profile.js` (`recordRun` applies the evaluation; `sanitize` keeps only known ids)

## Design

Each achievement: `{ id, name, desc, cat, icon, test?(sum, profile) → bool,
counter?(sum) → number, collect?(sum) → string[], target?, reward? }`.

- `test` checks one run.
- `counter` adds a number to `progress[id]` each run; earned at `target`.
- `collect` adds keys to the set in `progress[id]`; earned when the set reaches `target`.
- `reward` is `{ title }`, `{ modifier }` or `{ crest }`, pointing into `UNLOCKS`.

Rules every condition follows:
- "Reach" or "clear wave N" reads `sum.wavesCleared`, never `sum.level`.
- Portal integrity reads `sum.lives / sum.maxLives`.
- "Top tower" means the MVP (`sum.mvp`, the top damage entry in `towerLedger`).
- A continued run (won, then "Keep playing") is judged on its final summary.
  Endless Vigil counts continued runs.

**God mode:** runs with `sum.cfg.god` (the testing toggle on the setup screen)
are never recorded: no history, totals, records, progress or achievements.
`recordRun` returns early for them and the end screen says so.

**Anti-farming guard:** when `sum.outcome === 'abandoned'` and
`sum.wavesCleared < 10`, `evaluateRun` earns nothing and adds no progress.
Ratio and no-leak achievements also need their window passed (see conditions).

Unlocks carry no power: titles show on the menu and end screen, modifiers
(phase 6) make runs harder for score, crests (phase 7) decorate level-30 towers.

## Catalog (32, thresholds tunable)

**Progress**
1. First Stand: clear wave 10.
2. Holding the Line: clear wave 40. Reward: modifier "glass".
3. Deep Defense: clear wave 80.
4. Portal Keeper: win a Trial run. Reward: title "Keeper".
5. Warden of the Full March: win a Full run. Reward: title "Warden".
6. Endless Vigil: clear wave 150 (Endless, or continued after a win). Reward: crest "eternal".
7. Medium Victory, 8. Hard Victory: win on that difficulty.
9. Extreme Victory: win on Extreme. Reward: title "Unbroken" and crest "obsidian".

**Mastery** (ties into the level 30 goal)
10. Ascended: a tower reaches level 30. Reward: crest "gilded".
11. Trinity: end a run with 3 towers at level 30.
12. Champion Carry: clear wave 30 with the MVP dealing at least 50% of all damage.
13. Clean Thirty: clear wave 30 with no portal damage before it (`leakWaves`
    has nothing below 30). Reward: crest "ember".
14. Untouchable: win with `lives === maxLives`.
15. Spellweaver: clear wave 30 with spell damage at least 40% of all damage
    (`damageByAttack.spell`).
16. Lean Defense: clear wave 60 with at most 6 towers in `towerLedger`.

**Challenge** (each unlocks the next modifier)
17. Glass Portal: clear wave 40 with Glass Portal. Reward: modifier "frugal".
18. No Interest: clear wave 40 with Frugal. Reward: modifier "swarm".
19. Swarm Breaker: clear wave 40 with Swarm. Reward: modifier "naked".
20. Bare Hands: clear wave 30 with No Items.
21. Stacked Odds: win with three modifiers active. Reward: title "Daredevil".

**Collection** (across runs)
22. Elementalist: `collect` the MVP's element on runs that clear wave 40; earned
    at 7 of 7. Reward: title "Elementalist".
23. Hoarder: `counter` items found, target 500.
24. Unique Taste: `peakUniquesCarried >= 4` in one run.
25. Transmuter: `counter` transmutes, target 50.
26. Bounty Hunter: `counter` boss kills, target 100.
27. Veteran: `counter` runs (1 per recorded run that passes the guard), target 25. Reward: title "Veteran".
28. Gambler: win a Random mode run. Reward: crest "dice".

**Quirky**
29. Impatient: 30 early calls in one run.
30. Scholar of War: 20,000 gold spent on training in one run.
31. Close Call: win with `lives / maxLives <= 0.1`.
32. Speed Run: win a Trial run in under 28 minutes of game time (`sum.time`).

## Tasks & Steps

1. Write `src/data/achievements.js` with the catalog and
   `UNLOCKS = { titles, modifiers, crests }` (name, description, source achievement id).
2. `evaluateRun(sum, profile)` → `{ earned: [ids], progress: { id: value }, unlocks: [{ kind, id }] }`.
   Pure; skips achievements already earned; applies the guard first.
3. `recordRun` (phase 2) applies the result. On a second record for the same
   game, counters add only the difference (`counted` from `runState`), sets are
   unions, and Veteran does not count again.
4. `unlockedSet(profile)` → `{ titles, modifiers, crests }` as sets.
5. `sanitize` drops achievement, progress, title and crest ids that are not in
   the catalog.

## Verification

- `npm run build` passes.
- Node script (scratchpad) with crafted summaries:
  - Each achievement fires on its intended summary and not on a near miss.
  - Farming: an abandoned run with `wavesCleared: 3`, one tower and no leaks
    earns nothing and leaves `progress` untouched; the same run at
    `wavesCleared: 12` counts.
  - Early calls: `level: 12, wavesCleared: 4` does not earn First Stand.
  - Win, continue, lose: Veteran progress goes up by 1 and counters by the run's totals.
  - Every `reward` points to an `UNLOCKS` entry and every unlock has exactly one
    source achievement.
