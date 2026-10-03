---
phase: 4
title: "End screen redesign"
status: completed
priority: P1
effort: "1d"
dependencies: [1, 2, 3]
---

# Phase 4: End screen redesign

## Goal

The end screen tells the story of the run in four views, celebrates what the
player earned and points at the next goal. Each game is recorded once.

## Context

- Markup: `#endscreen` in `index.html:167-177`. Renderer: `hud.showEnd()` in
  `src/ui/hud.js:737`. Wired in `src/main.js:114-115`.
- Duplicate id bug: `#btn-continue` exists at `index.html:121` (welcome "Start
  Game") and `index.html:174` ("Keep playing (endless)"). `src/main.js:141` and
  `:144` both bind `#btn-continue`, and `src/ui/hud.js:749` toggles it. All three
  resolve to the welcome button, so the endless button never works and the
  welcome button also runs the endless handler on a null `game`.
  `src/style.css:500` styles the welcome button and stays as it is.
- Esc opens settings whenever `game` is set (`src/main.js:218-226`), even behind
  the end screen; Space calls `callNextWave()` (`src/main.js:228`).
- God mode runs (`cfg.god`) are never recorded (phase 3).
- Line numbers are from commit `92f81f0`; re-check them before editing.

## Files to Create / Modify

- Modify: `index.html` (end screen markup; rename the endless button to `btn-endless`)
- Modify: `src/ui/hud.js` (`showEnd` and helpers; use `esc` from `src/ui/util.js`)
- Modify: `src/main.js` (record flow, endless button, keyboard guard, abandon)
- Modify: `src/style.css` (end screen styles with `calc(var(--s) * Npx)`)

## Layout

```
┌──────────────────────────── VICTORY / THE PORTAL HAS FALLEN / RUN ABANDONED ────────────┐
│ Medium · Build · Full   wave 87   ★ 84,380  (NEW RECORD)            title: Warden        │
│ [Overview] [Towers] [Analysis] [Achievements 3 new]                                      │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ Overview: MVP card (icon, name, level, kills, damage, % share, items, perks)             │
│           stat tiles (score, waves cleared, kills, damage, gold, items, towers,          │
│           portal integrity, time); "Next goal" strip with the closest unearned goal      │
│ Towers:   sortable table (damage, %, kills, level, tier, items, perks, gold invested),   │
│           sold towers greyed with a "sold" tag, share bars inline                        │
│ Analysis: damage by element and by attack type plus spell; portal damage by creep        │
│           size and race; waves with portal damage (boss waves marked); challenge         │
│           escapes on their own row; gold spent (build / upgrade / train) and tomes       │
│           spent (research / towers / reroll)                                             │
│ Achievements: newly earned (big, with reward), records broken, unlocks gained,          │
│           3 nearest goals with progress                                                  │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│                [Play again]  [Keep playing (endless)]  [Hall of Records]                 │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

## Tasks & Steps

1. **Button fix.** Rename the endless button to `btn-endless` in `index.html:174`,
   bind it in `main.js` (replacing the `:144` handler) and toggle it in
   `showEnd` instead of `hud.js:749`. The welcome `#btn-continue` keeps its
   handler at `main.js:141`.
2. **Record flow in `main.js`.** Keep one `runState` per `Game` (phase 2).
   - `victory` and `defeat`: `recordRun(game.summary(), runState)`, save, show
     the end screen. A defeat after "Keep playing" updates the same record.
   - "Abandon run" (`#btn-quit`): allowed only while `game.phase` is `prep` or
     `running` and the end screen is hidden. It calls `game.abandon()`, records
     when `game.level >= 1`, then shows the end screen titled "Run Abandoned".
   - The keydown handler ignores every key while `#endscreen` is visible, so
     Escape never opens settings there and Space never calls a wave.
   - Closed tabs and reloads are not recorded (non-goal).
   - God mode runs skip `recordRun`; the end screen shows "God mode: not
     recorded" in place of records and achievements.
3. **`showEnd(sum, result)`.** The endless button shows when
   `sum.outcome === 'won' && sum.cfg.length !== 'endless' && !sum.continued`
   (this replaces today's `canContinue` argument). Header: setup, waves cleared,
   score, record ribbon, title. Default tab is Achievements when something new
   was earned, otherwise Overview.
4. **Safe rendering.** Names and labels come from catalogs (`TOWERS`, `ITEMS`,
   `PERKS`, `ACHIEVEMENTS`, `UNLOCKS`) looked up by id; unknown ids are skipped.
   Free text passes through `esc`.
5. **Towers tab.** Click a header to sort; tower names use the rarity color and
   element glyph like the build list; reuse `towerIcon()` and `fmt()`; rows carry
   `data-tt="tower:<id>"` for the existing tooltip.
6. **Analysis tab.** Bars are divs with percent widths; colors from
   `ELEMENTS[...].css` and `ATTACK_TYPES[...].css`; spell uses a neutral color;
   damage with no tower shows as "Other".
7. **Achievements tab.** Earned cards animate in (CSS only) and list their reward.
8. The modal scrolls inside the viewport at both test resolutions.

## Verification

- `npm run build` passes.
- Browser at 1920x1080 and 2560x1440: lose a medium run quickly and check every
  tab; sell a tower mid-run and confirm it appears greyed; abandon from settings
  at wave 3 and confirm the end screen and one history entry; press Esc on the
  end screen and confirm settings do not open.
- Win a Trial run via `window.__youtd.game` (set `finalWave` low), press "Keep
  playing (endless)", lose, and confirm the hall shows one run with the later wave.
- A God mode run ends without touching the profile.
