---
title: "Implement end screen, profile, achievements, modifiers and crests"
date: 2026-10-04
summary: Executed all 8 phases of the end-screen/profile plan on feat/end-screen-profile-achievements; bot baseline unchanged throughout.
---

# Implement end screen, profile, achievements, modifiers and crests

## What happened
- Implemented the plan in 10 commits on `feat/end-screen-profile-achievements`: run ledger in the sim, validated localStorage profile, 32 achievements with a pure evaluator, four-tab end screen, Hall of Records, challenge modifiers, level-30 crests, docs.
- Balance bot RESULT lines matched `plans/reports/balance-baseline-261003-end-screen.txt` after every sim-touching phase. Node checks: 16 summary, ~70 profile, 61 achievement cases.
- Browser checks drove the sim through `window.__youtd` (fast-forwarding `game.update`), which surfaced two real bugs: Close Call was earned after a won run continued and fell (integrity now read at victory), and a lowered `finalWave` or an endless run counted as a win (wins now require all waves of the length cleared).
- Independent review found a data-loss bug: `recordRun` wrote a fresh profile over one it could not read (newer version or corrupted JSON). Fixed so an unreadable profile is never overwritten. Also fixed Glass Portal visuals and heals assuming 100 lives, and continued wins showing as defeats in history.

## Gotchas
- requestAnimationFrame stalls while the automation tab is not visible, so world state (crests) only updates after a screenshot/wait; read view state after a frame.
- Dispatching keydown on `window` throws inside handlers that call `e.target.closest`; dispatch on `document.body` instead.
- No Items changes RNG consumption, so modifier bot runs are noisy (seed 1 went further than baseline).

## Next steps
- Export button not exercised in the browser (it downloads a file).
- 2560x1440 could only be checked at a 1903x1445 viewport on this screen.
- Branch is ready to merge into main once Trung confirms.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
