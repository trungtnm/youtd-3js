# Security review: online accounts and verified runs

Reviewer: independent code-review agent, 2026-11-03. Saved by the controller
because the reviewer's write failed (disk full). Fix status is tracked in
`plans/261103-1457-online-accounts-and-verified-runs/plan.md`.

## Summary

Auth core, CSRF, SQL, escaping, size limits and ticket signing are sound. Two
release blockers: honest runs that end in victory or defeat were rejected (C1),
and one anonymous client could push the monthly budget to `paused` with cheap
idle logs (H1).

## Critical

- C1. Every run ending in victory or defeat is rejected. `victory`/`defeat` fire
  inside `update()` before `tick++`; `endRun` exports from the handler, so the log
  ends at tick T with a half-tick state and the replay reports `final state
  diverged`. Fix: emit end events after the tick and checkpoint complete; test
  an export from inside the event.

## High

- H1. Budget exhaustion. Cost is charged per tick; an 864k-tick idle log costs
  ~29 ms to replay but is charged 17,330 ms. Twenty guests per IP per hour with
  30 tickets each reach `important` in about two hours, and claiming `won` keeps
  the logs replayed until `paused`. Fix: charge for work done, add per-user and
  per-IP (/64) monthly shares, reject implausible idle logs.
- H2. Weekly logs can be copied between accounts (same seed and cfg, no player
  binding in the log). Fix: reject duplicate weekly command logs; review top
  entries.

## Medium

- M1. In `important` mode the claim decides replay; `won` forces it. Check the
  claim against `log.end.phase`.
- M2. A magic link requested by guest A and opened by B still upgrades B's guest
  to A's address. Upgrade only when the opener is the requester; show the masked
  address on the confirm page.
- M3. Google sign-in links to an account by email even when that account is
  linked to a different Google id.
- M4. A verifier retry can commit a stale result after a resubmission changed
  `log_ticks`.
- M5. The log is stored before the conditional commit; racing submissions can
  leave R2 and the run row inconsistent and bypass the extension rule.
- M6. `attempts` is not reset on resubmission.
- M7. A tab open across a deploy loses its runs (refused `log_mismatch`, dropped
  from the outbox); the client never compares builds.
- M8. Seed shopping is unlimited; unused tickets are deleted, not counted.
- M9. The outbox replaces an unsent victory upload with the continued log, losing
  the victory record and board entry.

## Low

- L1. A malformed `%` path escape throws outside the error handler.
- L2. Usage is charged again on every failed commit retry.
- L3. Replays killed by the CPU limit are never charged.
- L4. Email sign-in can be paused for a day by one IP (/64).
- L5. Display names are not unique; impersonation on boards.
- L6. One secret signs tickets and OAuth cookies and derives weekly seeds.
- L7. The magic-link token is in the GET URL and reaches logs.
- L8. Boards are not edge-cached; every read hits D1 without a rate limit.
- L9. Tickets expire after 24 h with no grace; overnight pauses lose the run.

## Open questions

- Must the weekly board resist log copying between accounts, or is it casual?
- Should guests consume verification budget at all?
