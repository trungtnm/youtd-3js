---
phase: 2
title: "Profile store with export and import"
status: pending
priority: P1
effort: "0.75d"
dependencies: []
---

# Phase 2: Profile store with export and import

## Goal

One versioned, validated profile in `localStorage` holds records, run history,
lifetime totals, achievements and unlock choices. It records each game exactly
once, survives bad data, and can be exported and imported (import replaces the
profile after a confirm).

## Context

- `src/main.js:13-16` has `load`/`save`, `SETTINGS_KEY` and `BEST_KEY`
  (`youtd-reforged-best`: `difficulty/mode/length` → `{ level, score }`), read
  by `renderBest()` (`src/main.js:58`) and written by `recordBest()` (`src/main.js:128`).
- `load` spreads raw JSON with no type checks (`src/main.js:15`); `save`
  swallows errors (`src/main.js:16`).

## Files to Create / Modify

- Create: `src/meta/profile.js`
- Create: `src/ui/util.js` (move `esc` out of `src/ui/hud.js:19` and export it)
- Modify: `src/ui/hud.js` (import `esc` from `util.js`)
- Modify: `src/main.js` (use the profile instead of `BEST_KEY`)

## Schema

```js
{ version: 1, createdAt, runs: 0, legacyMerged: false,
  totals: { kills, damage, gold, wavesCleared, timeSec, bossKills, leaks, towersBuilt, maxLevelTowers },
  records: { 'medium/build/full': { level, score, at } },   // modifier runs: 'medium/build/full+frugal,glass'
  history: [],          // last 25 entries
  achievements: {},     // id -> { at }
  progress: {},         // id -> number, or array of collected keys (e.g. elements)
  title: null, crest: null }
```

The modifier selection lives only in settings (phase 6), not in the profile.

## Tasks & Steps

1. **Validation.** `sanitize(raw)` builds a fresh `emptyProfile()` and copies
   values by walking the *default* keys only (never the input's keys, so
   `__proto__` and unknown keys are ignored). Numbers must be finite and `>= 0`;
   arrays must be arrays (history trimmed to 25, each entry sanitized field by
   field); `records` keys must match `difficulty/mode/length(+mods)` built from
   the ids in `src/data/constants.js`; `achievements`, `progress`, `title` and
   `crest` keep only ids present in `src/data/achievements.js` (phase 3; until
   then, accept none). `version` above `PROFILE_VERSION` is rejected.
2. **Storage.** `loadProfile()`: read, `JSON.parse`, `sanitize`; on any failure
   return `emptyProfile()` with a transient `loadError` flag (never persisted)
   so the hall can warn. Legacy best scores merge here only: when
   `legacyMerged` is false, fold `BEST_KEY` entries with finite `level` and
   `score` into `records` by max score, set `legacyMerged = true`, and leave the
   old key in place. `saveProfile(p)` returns `true`/`false`; on `false` the
   caller keeps the in-memory copy and marks `storageOk = false` for the hall
   banner.
3. **Recording once per game.** `recordRun(sum, runState)`:
   - Re-reads storage with `loadProfile()` right before writing, so a second tab
     cannot clobber progress.
   - `runState` is kept by `main.js` per `Game` (`{ recorded: false, counted: null, historyAt: null }`).
     First call: add totals, append a history entry, check the record, mark
     `recorded` and store the totals that were counted.
   - Later call for the same game (a run continued after victory, then lost or
     abandoned): add only the difference to totals, update the same history
     entry (matched by `historyAt`) and the record; never increment `runs` again.
   - Returns `{ profile, newRecord, earned, unlocks }` (achievement parts filled
     by phase 3).
4. **Export / import.** `exportProfile(p)` downloads
   `youtd-profile-YYYY-MM-DD.json`. `importProfile(file)` rejects files over
   256 KB before reading, parses, sanitizes, and returns `{ ok, profile, error }`.
   The hall (phase 5) asks for confirmation, suggests exporting first, then calls
   `saveProfile`; a failed save counts as a failed import and keeps the previous
   profile. Import never merges legacy best scores.
5. **main.js.** Replace `recordBest`/`renderBest` with the profile; the menu line
   "Best on this setup" reads the plain (no modifier) key and guards missing
   fields.

## Verification

- `npm run build` passes.
- Node script (scratchpad) on the pure functions:
  `sanitize({})` equals `emptyProfile()`; `sanitize(JSON.parse('{"__proto__":{"x":1},"history":{}}'))`
  leaves `({}).x` undefined and `history` an empty array; legacy merge keeps
  the higher score and runs only once; two `recordRun` calls with the same
  `runState` give `runs === 1` and totals equal to the run's totals;
  history stays at 25 entries; a 300 KB file is rejected; a future `version`
  is rejected.
- Browser: an existing `youtd-reforged-best` entry still shows on the menu.
