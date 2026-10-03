---
phase: 5
title: "Profile hall on the menu"
status: completed
priority: P2
effort: "0.75d"
dependencies: [2, 3]
---

# Phase 5: Profile hall on the menu

## Goal

A "Hall of Records" screen reachable from the menu and the end screen shows the
player's title, lifetime totals, records, run history and the achievement
gallery, and holds export, import and reset.

## Context

- The menu has two steps, `#menu-intro` and `#menu-setup` (`showMenuStep` in
  `src/main.js:136`). Credits and How to Play are collapsible sections at the
  bottom of setup.

## Files to Create / Modify

- Modify: `index.html` (a `#hall` modal, a "Hall of Records" link on both menu
  steps and a "Profile" button on the end screen)
- Create: `src/ui/hall.js` (renders the hall from a profile; keeps `hud.js` from growing)
- Modify: `src/main.js` (open/close, export/import/reset wiring, title display)
- Modify: `src/style.css`

## Tasks & Steps

1. Hall sections:
   - **Header:** chosen title (dropdown of unlocked titles), runs played,
     achievements earned `n / 32`, total play time.
   - **Records:** grid of difficulty rows × length columns for the current mode
     (toggle Build/Random), each cell best wave and score, empty cells dashed.
   - **Lifetime:** kills, damage, gold, bosses, towers built, level 30 towers.
   - **History:** last 25 runs, newest first: date, setup, outcome, wave, score,
     MVP name and level, modifiers.
   - **Achievements:** gallery grouped by category; locked ones show the
     condition and progress bar; earned ones show the date and reward. Hidden
     achievements are not used, every condition is visible.
   - **Unlocks:** titles, modifiers and crests with lock state and source.
   - **Data:** Export (download). Import replaces the whole profile: pick a
     file → `importProfile` (256 KB limit, sanitized) → an in-modal confirm that
     offers "Export current first" → `saveProfile`; a parse, validation or save
     failure shows the error and keeps the current profile. Reset uses the same
     two-step in-modal confirm (never `window.confirm`).
2. **Safe rendering.** Every name, title, crest, modifier and achievement is
   looked up by id in `src/data/achievements.js`, `UNLOCKS`, `TOWERS` or
   `src/data/constants.js`; unknown ids are skipped. Free text (MVP names,
   dates) goes through `esc` from `src/ui/util.js`. No profile string reaches
   `innerHTML` unescaped.
3. Banners: `storageOk === false` → progress will not be saved this session;
   `loadError` → the saved profile could not be read and a fresh one is in use
   (offer Reset or Import).
4. The hall re-reads the profile with `loadProfile()` each time it opens, so it
   reflects runs from other tabs.
5. Show the chosen title under the logo on the menu and in the end screen header.

## Verification

- `npm run build` passes.
- Browser: play two short runs, open the hall, check records, history and
  progress; export, reset, import the exported file and confirm everything is
  back; import a broken file, a 300 KB file and a file whose title and MVP name
  contain `<img src=x onerror=alert(1)>` and confirm the profile is untouched or
  the markup renders as plain text.
- Check at 1920x1080 and 2560x1440; the hall scrolls inside the viewport.
