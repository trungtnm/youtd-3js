---
title: "Detailed end screen, player profile and achievements"
description: "Richer end-of-run summary plus a persistent player profile with achievements and non-power unlocks that give players a reason to start another run."
status: in-progress
priority: P2
effort: 5.75d
branch: feat/end-screen-profile-achievements
tags: [feature, frontend, sim]
blockedBy: []
blocks: []
created: 2026-10-03
---

# Detailed end screen, player profile and achievements

## Outcome

When a run ends the player sees what happened in detail: the MVP tower, every
tower's contribution, where the portal took damage and how damage split across
elements, attack types and spells. The result feeds a profile saved in the
browser that keeps records, run history, lifetime totals and achievements.
Achievements unlock titles, challenge modifiers and cosmetic tower crests, none
of which add power, so every run has a goal beyond "go further".

## Decisions (from the user, 2026-10-03)

- **No mid-run save.** Only the profile persists. The sim keeps closures in
  `delayed`, hidden RNG state and ad-hoc tower fields, so snapshots are out of scope.
- **Unlocks never add power.** Titles, challenge modifiers (harder runs with a
  score multiplier) and cosmetic crests. Balance bot results stay valid.
- **End screen shows:** tower MVP and per-tower table, new achievements and
  records, leak and damage analysis. No per-wave charts.
- **Storage:** `localStorage` with JSON export and import. Import replaces the
  profile after an in-game confirm.
- **Closed tabs are not recorded.** Only victory, defeat and "Abandon run" record.
- **Extreme Victory stays as is** (title "Unbroken" and crest "obsidian"), an
  intentionally rare goal.
- **God mode never counts.** Runs started with the testing toggle (commit
  `92f81f0`) skip records, history, totals and achievements.

## Constraints

- `src/sim/` stays headless. Stats are gathered in the sim; storage and
  achievement bookkeeping live in `src/meta/` (pure functions where possible so
  Node can test them).
- New HUD styles use `calc(var(--s) * Npx)`.
- UI text is English like the rest of the game.
- Profile data renders only through catalog lookups or `esc`.
- The balance bot gives identical results with no modifiers.

## Non-goals

Mid-run save and resume, recording runs closed by tab close or reload, cloud
sync or accounts, gameplay power from meta progression, per-wave charts,
locking existing difficulties or modes, merging imported profiles.

## Phases

| # | Phase | Effort | Depends on | Status |
|---|---|---|---|---|
| 1 | [Run stats ledger in the sim](phase-01-run-stats-ledger.md) | 0.75d | – | completed |
| 2 | [Profile store with export and import](phase-02-profile-store.md) | 0.75d | – | completed |
| 3 | [Achievement and unlock definitions plus evaluator](phase-03-achievements.md) | 1d | 1, 2 | completed |
| 4 | [End screen redesign](phase-04-end-screen.md) | 1d | 1, 2, 3 | pending |
| 5 | [Profile hall on the menu](phase-05-profile-hall.md) | 0.75d | 2, 3 | pending |
| 6 | [Challenge modifiers](phase-06-challenge-modifiers.md) | 0.75d | 3 | completed |
| 7 | [Cosmetic tower crests](phase-07-cosmetic-crests.md) | 0.5d | 3 | pending |
| 8 | [Docs and full verification](phase-08-docs-verification.md) | 0.25d | 1-7 | pending |

Run phases 1 and 2 one after the other: both touch `src/ui/hud.js` (lives bar,
moving `esc`). Phases 5, 6 and 7 can run in parallel after phase 3 if they keep
to their file lists; 5 and 7 both touch `src/ui/hall.js`, so do 7 after 5.

## Data flow

```
Game (sim) ── stats ledger ──> summary() (outcome from phase) ──┐
                                                                 ├─> recordRun(sum, runState)
loadProfile() re-read right before writing ──────────────────────┘     │  skip if cfg.god
                                                                       │  once per game; later calls add deltas
                                       evaluateRun(sum, profile) <─────┤  guard: abandoned & wavesCleared < 10
                                                                       v
                                  saveProfile(profile) ──> hud.showEnd(sum, result)
```

## Acceptance criteria

1. Victory, defeat and "Abandon run" record the game exactly once; a run
   continued after victory updates the same history entry and adds only the
   difference to totals. Reloading keeps records, history and achievements.
   Abandoned runs earn achievements only from 10 cleared waves on. God mode runs
   are never recorded.
2. The end screen has Overview, Towers, Analysis and Achievements views. Sold
   towers appear in the tower table with damage from hits that landed after the
   sale. The MVP is the tower with the most damage.
3. 32 achievements across progress, mastery, challenge, collection and quirky
   categories, each with a visible condition and progress where it makes sense;
   "reach/clear wave" conditions use waves cleared, not waves called.
4. Unlocks are titles, challenge modifiers and crests only; no unlock changes
   damage, gold, experience or lives in an unmodified run, and Glass Portal does
   not feed `livesLost` scaling.
5. Export downloads a JSON file; import rejects files over 256 KB, malformed or
   wrongly typed data and failed saves without touching the current profile;
   imported HTML renders as text. Old `youtd-reforged-best` records merge once.
6. The duplicate `btn-continue` id is fixed and "Keep playing (endless)" works
   after a Trial or Full victory; keys do nothing behind the end screen.
7. `npm run build` passes; the balance bot gives identical RESULT lines for
   medium/hard seeds 1-3 with no modifiers, compared with the baseline file
   saved in phase 1 step 0.
8. Browser check at 1920x1080 and 2560x1440 of the end screen, hall, modifier
   picker and crest.
9. Docs updated: `docs/architecture.md` (meta layer, stats, `summary()` shape,
   profile key), `docs/game-design.md` (achievements, modifiers, unlocks, the
   no-power rule), `AGENTS.md` (`MODS` bot option).

## Risks

- **Stats overhead in hot paths.** Per-hit work is one integer add into an
  existing per-tower object.
- **Profile schema drift.** Versioned schema; `sanitize()` walks default keys.
- **localStorage unavailable or full.** Reads and writes in try/catch; the game
  runs with an in-memory profile and the hall shows a warning.
- **Achievement balance.** Thresholds are data; tune after playtesting.

## Red Team Review

### Session — 2026-10-03
**Findings:** 15 after de-duplication (15 accepted, 0 rejected), each reviewed
by the user one by one.
**Severity breakdown:** 2 Critical, 5 High, 8 Medium

| # | Finding | Severity | Disposition | Applied To |
|---|---|---|---|---|
| 1 | A game could be recorded 2-3 times (endless continue, Esc then Abandon behind the end screen) | Critical | Accept | Phases 1, 2, 3, 4 |
| 2 | Glass Portal fed `livesLost` scaling (+35% damage on an Iron tower), Mend always offered, item heal past cap | Critical | Accept | Phases 1, 6 |
| 3 | `summary()` outcome never passed at the victory/defeat emits | High | Accept | Phase 1 |
| 4 | Stored XSS through imported profile strings | High | Accept | Phases 2, 4, 5 |
| 5 | Import validation undefined (types, `__proto__`, size, failed save, boot crash) | High | Accept | Phases 2, 5 |
| 6 | `level` counts waves called, so early calls farm "reach wave" goals | High | Accept | Phases 1, 3 |
| 7 | Damage by attack type not derivable at the end; late hits after a sale lost | High | Accept | Phase 1 |
| 8 | Challenge creeps counted as leaks | Medium | Accept | Phases 1, 3, 4 |
| 9 | Research spends tomes, so a gold "research" split is always zero | Medium | Accept | Phases 1, 4 |
| 10 | Speed Run and Perfect Hand came free with other achievements | Medium | Accept | Phase 3 |
| 11 | Unique Taste, Elementalist and "top tower" lacked data | Medium | Accept | Phases 1, 3 |
| 12 | Endless Vigil ignored runs continued after a win | Medium | Accept | Phase 3 |
| 13 | Crest lost on upgrade, shared geometry disposed, `ember` had no source, #2 reward missing | Medium | Accept | Phases 3, 7 |
| 14 | Contract slips: score only in `kill()`, `hud.js:749`, `main.js:141`, all interest sources for Frugal | Medium | Accept | Phases 4, 6 |
| 15 | Unvalidated modifier settings, stale profile across tabs, unused counters | Medium | Accept | Phases 1, 2, 6 |

## Validation Log

### Session 1 — 2026-10-03
- Mid-run save: none; profile only.
- Meta progression: unlocks without power.
- End screen content: MVP and tower table, achievements and records, leak and damage analysis.
- Storage: localStorage with export and import.
- Closed tabs: not recorded.
- Import: replace after confirm.
- Extreme Victory rewards: kept as is.
- God mode (added later the same day): never counts toward records or achievements.

### Verification Results
- Tier: Full (8 phases, 4 reviewers with Fact Checker, Flow Tracer, Scope Auditor, Contract Verifier)
- Line references re-checked: `main.js:141` (was cited as 140) and `leak()` at `game.js:801` corrected; all others verified.
- Line numbers in phases refer to commit `a0044a9`..`bd3199b`; God mode (`92f81f0`) shifted `src/main.js` and `src/sim/game.js` by a few lines, so re-check before editing.

## Open questions

None blocking. Achievement names and thresholds in phase 3 are proposals to
tune after playtesting.
