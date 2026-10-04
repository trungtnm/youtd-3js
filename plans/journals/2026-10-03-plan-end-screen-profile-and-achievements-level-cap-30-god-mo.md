---
title: "Plan end screen, profile and achievements; level cap 30; god mode"
date: 2026-10-03
summary: Planned the meta-progression feature with a red-team pass; shipped level cap 30 rebalance and a god mode toggle.
---

# Plan end screen, profile and achievements; level cap 30; god mode

## What happened
- Capped tower level at 30 (`bd3199b`). XP per level turns linear after 15 (about 13,800 XP to cap), +5% damage per level above 20, train cost grows 2% per session instead of 4%, strong perks moved to 20/25/30, Champion's Trial skips capped towers. Bot: hard, extreme and ice/astral medium unchanged; medium fire/storm seed 2 went 59 -> 71 when its carry hit 30 around wave 60.
- Added god mode for testing (`92f81f0`): all elements at research 15, 10M gold, 2000 tomes; best-score records skip god runs.
- Wrote `plans/261003-2216-end-screen-profile-achievements/` (8 phases): run stats ledger, versioned localStorage profile with export/import, 32 data-driven achievements, four-tab end screen, profile hall, challenge modifiers, cosmetic level-30 crests.

## Decisions
- User: no mid-run save, unlocks never add power, import replaces after confirm, closed tabs not recorded, Extreme Victory rewards kept, god mode never counts.
- Red team (4 reviewers) found 15 issues; the user reviewed and accepted all. The ones that mattered: a game could be recorded 2-3 times (endless continue, Esc -> Abandon behind the end screen); Glass Portal (lives 30) would have fed `livesLost = 100 - lives` scaling and buffed an Iron tower by ~35%; imported profile strings would reach `innerHTML` (stored XSS) and badly typed imports could brick boot; `level` counts waves called, so early calls could farm "reach wave" achievements.
- Existing bug found while scouting: two buttons share id `btn-continue`, so "Keep playing (endless)" never worked. Fix is in phase 4.

## Next steps
- Implement with `/ak:cook plans/261003-2216-end-screen-profile-achievements/plan.md` on branch `feat/end-screen-profile-achievements`, starting with the balance baseline in phase 1 step 0.
- Re-check line numbers in the phases: the god mode commit shifted `src/main.js` and `src/sim/game.js`.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
