---
title: Online play with replay-verified runs
date: 2026-11-03
summary: "Deterministic sim, command log, Worker verification, accounts and boards; review caught mid-tick end exports and an idle-log budget drain"
---

# Online play with replay-verified runs

## What happened
- Made the simulation deterministic: fixed 1/60 s ticks (`game.step()`), per-game ids, `src/sim/dmath.js` instead of engine-dependent Math/`**`, enforced by `npm run check:sim`. The same log replays to the same hash in Node, Chrome, Firefox and WebKit.
- All player actions go through `game.command(op, args, slot)` and are logged; `game.players` holds per-player economy and towers have owners, ready for co-op.
- Balance bot is bit-identical to before at the same timestep; the shift seen at 1/60 vs the old 1/30 bot step comes from the step size, not rules.
- Cloudflare Worker (`worker/`): guest/Google/magic-link accounts, signed run tickets with server seeds, R2 logs, queue replay with `replayLog`, profile fold via the shared `applyRun`, leaderboards, weekly challenge, budget guard, retention cron.

## What went wrong
- Every run ending in victory or defeat was rejected: the end events fired inside `update()` before `tick++`, so the end screen exported a half-finished tick. Browser e2e only covered abandoned runs, so it slipped past. Fixed by flushing end events after the tick and checkpoint; regression test exports from inside the defeat event.
- Budget charged per tick, so a long idle log cost ~29 ms but was billed ~17 s; a few guests could push the month to "paused". Now charged by replay work (creeps+towers+projectiles per tick) plus per-user and per-IP monthly shares.
- Magic link upgraded the requesting guest, enabling account sharing with a victim; now only the opener's browser guest is upgraded, token moved to the URL fragment.
- Disk filled up (ENOSPC) during review; removed the Playwright Firefox/WebKit downloads I had installed.

## Decision
- Verification by replay, not server-authoritative realtime play: zero gameplay latency, ~1 s CPU per 65-wave run.
- Runs spanning a deploy become unverified history (Workers cannot load archived sim bundles).
- Weekly board blocks exact log copies only; seed restarting is limited, not prevented.

## Next steps
- Deploy runbook in docs/online.md: create D1/R2/queue, secrets, Google client, Brevo sender, billing alerts.
- Measure real replay CPU in Cloudflare and adjust `TICK`-work cost; untested races: resubmission mid-replay/mid-write.
- Phase 9 (co-op/versus over Durable Objects) as its own plan.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
