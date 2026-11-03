# Online play: accounts, cloud progress and verified runs

Status: phases 1-8 implemented and tested locally (2026-11-03); not deployed.
Phase 9 (co-op/versus) is a separate future plan. API contract:
[api-contract.md](api-contract.md). Docs: `docs/online.md`.

## Progress

| Phase | State | Evidence |
|---|---|---|
| 1 Deterministic simulation | done | `npm run check:sim`; same log, same hash in Node, Chrome, Firefox, WebKit (195k and 103k tick runs) |
| 2 Players and command layer | done | `npm run test:replay` (solo and two-player replays, ownership, tamper cases); balance bot bit-identical to before at the same timestep |
| 3 Backend skeleton | done | `worker/`, `migrations/0001_init.sql`, `wrangler.jsonc` |
| 4 Accounts | done | guest, Google (PKCE), magic link via Brevo, sessions; `npm run test:api` |
| 5 Run submission and verification | done | tickets, R2 logs, queue replay, rejections with tick |
| 6 Cloud profile and sync | done | server profile via `applyRun`, outbox survives a dropped connection (browser test) |
| 7 Leaderboards | done | per-setup boards, weekly challenge |
| 8 Hardening and ops | done locally | rate limits, CSRF, CSP (`public/_headers`), budget guard, retention cron, account export/delete, deploy runbook in `docs/online.md`; security review in `plans/reports/` |

Security review (`plans/reports/code-reviewer-261103-online-security.md`): all
findings fixed (C1, H1-H2, M1-M9, L1-L9). Evidence: `npm run test:replay` 11/11
(includes a log exported from the defeat event), `npm run test:api` 37/37,
browser runs ending in defeat and in abandonment verified, email sign-in through
the fragment-token confirm page, outbox upload after a dropped connection.
Not covered by a test: a resubmission landing mid-replay (M4) or mid-write (M5).

Deviations from the text below:
- Old builds' logs are not replayed on archived simulation bundles (a Worker
  cannot load code at runtime); runs that span a deploy become unverified
  history and keep their R2 log.
- No mid-run checkpoint uploads; a run's ticket covers it, and an unfinished
  run is lost if the tab closes before the end (as before).
- Runs started without a connection have no ticket and stay in the browser's
  own profile; only runs that started online upload later.
- Seed shopping is limited, not prevented: unused tickets count as runs when
  they expire, but a player can still restart for a better seed.
- Verification budget: besides the 70%/90% modes, each user may use 2% and each
  IP 5% of the monthly budget (owner confirmed 2026-11-03; change with
  `USER_SHARE`/`IP_SHARE`).
- Weekly copies (owner confirmed 2026-11-03): besides refusing identical command
  lists, a verified weekly run whose final tower layout matches another
  account's verified run is kept off the board (`board.hidden`, migration
  `0002_board_review.sql`) until the owner reviews it with the queries in
  `docs/online.md#weekly-review`.
- Contact: the menu's Contact section and the README give the owner's email for
  feedback.
- Owner decisions recorded 2026-11-03 (below).

## Outcome

Players sign in with Google or an email link, their profile (records, history,
achievements, unlocks, cosmetics) lives on the server and follows them across
devices, and global leaderboards only show runs the server has re-simulated and
confirmed. The game still plays offline and without lag. Every layer is built so
co-op and versus multiplayer can be added later without rewriting it.

## Owner decisions

| Question | Decision |
|---|---|
| Scope | Cloud save + verified leaderboards now; architecture ready for co-op/versus |
| Sign-in | Google OAuth and email magic link (plus an anonymous guest until sign-in) |
| Existing local profiles | Not migrated; online profiles start fresh |
| Budget | Cloudflare Workers Paid, $5/month, no surprise overage charges |
| Runs not verified (budget guard) | Personal history only; no totals, records or achievements |
| Email sender | Brevo transactional API on the owner's verified domain |

## What the code gives us today

- `src/sim/` is headless and already runs in Node (`tools/balance.js`), seeded by
  `mulberry32` in `rng.js`. A 54-wave run simulates in ~0.5 s of CPU.
- Hosting is a static Cloudflare Worker (`wrangler.jsonc`, assets only). Worker
  routes, D1, R2, Queues and Durable Objects fit in the same deploy.
- `src/meta/profile.js` has a strict `sanitize()` and `src/meta/achievements.js`
  a pure `evaluateRun()`; both can run unchanged on the server.

Gaps that block verified replays and lockstep multiplayer:

1. Variable timestep: `src/main.js:338` splits each frame's `dt * speed` into
   `ceil(total / (1/60))` equal steps, so step size depends on frame timing.
2. `let UID = 1` is module-level in `src/sim/game.js:34`.
3. Commands take object references (`upgrade(tower)`, `equip(uid, tower)`,
   `choosePerk(t, id)`); `setPriority` and `toggleAutocast` write fields directly.
4. `Math.atan2`, `Math.hypot` (x4), `Math.pow` (x2) and fractional `**` in sim
   code are not guaranteed bit-identical across browser engines.
5. `seed = Date.now()` is chosen by the client.
6. `Game` assumes one player: one gold, lives, research, stash and draft.

## Architecture

```
Browser (Vite build)                  Cloudflare Worker (same deploy)
 ├─ sim (authoritative locally) ──┐    ├─ /api/auth/*      Google OAuth, email link, sessions
 ├─ command log + tick stamps     │    ├─ /api/runs/start  signed seed ticket
 └─ profile cache (localStorage)  └──► ├─ /api/runs/submit store log, enqueue verify
                                       ├─ Queue consumer   replay sim, write result
                                       ├─ /api/profile     derived from verified runs
                                       ├─ /api/leaderboard cached reads
                                       └─ (later) Room DO   lockstep relay per match
 D1: users, sessions, runs, records, achievements, usage   R2: compressed command logs
```

Trust model: the client is never trusted for outcomes. It sends a seed ticket and
a command log; the server replays the same `Game` code and derives summary,
records and achievements itself. A modified client can only submit commands a
real player could have issued. Bots and assisted play cannot be prevented, only
limited (rate limits, plausibility checks, reports, review of top entries).

### Multiplayer readiness (built now, used later)

The same pieces that make replay verification work are what lockstep multiplayer
needs, so they are designed for N players from the start:

- Commands carry a player slot: `{t: tick, p: 0, op: 'build', ...}`. Single
  player is slot 0. `game.apply(cmd)` checks the slot owns the tower or item.
- `Game` gets a `players` array (gold, research, stash, draft, perks per player);
  lives and waves stay shared. Single player is a one-element array, so balance
  and save data do not change shape later. Co-op vs versus differ only in config
  (shared lane vs separate lanes and sent creeps).
- Commands are scheduled a few ticks ahead (`t = now + inputDelay`; 0 offline),
  so a network relay can fit in without changing the sim.
- `stateHash()` every N ticks doubles as desync detection between peers.
- The replay log format holds commands from all players, so a multiplayer match
  is verified by the same Queue consumer.
- The later multiplayer phase adds one Durable Object per room that relays
  tick-stamped commands over hibernating WebSockets (billed only while messages
  flow) and writes the merged log for verification. No server-side simulation
  during play.

## Phases

1. **Deterministic simulation** - fixed 1/60 s tick with an accumulator in
   `main.js` (speed changes ticks per frame, never tick size); per-`Game` id
   counter; deterministic `atan2`/`hypot`/`pow` helpers in `src/sim/`; a check
   script that fails on `Math.random`, `Date.now` and engine-dependent `Math.*`
   in `src/sim/` and `src/data/`. Test: one recorded log replays to an identical
   state hash in Node, Chrome, Firefox and Safari.
2. **Players and command layer** - `players` array in `Game`; one
   `game.apply(cmd)` entry for every action (HUD, hotkeys, the balance bot);
   tick-scheduled command queue; `stateHash()`; replay log format (version, sim
   build hash, cfg, seed, players, commands, periodic hashes; gzip, a few KB);
   `tools/replay.js`. Archive the sim bundle per release so old logs replay on
   their own version.
3. **Backend skeleton** - Worker API routes beside the static assets, D1 schema
   and migrations, R2 bucket, Queue, dev/prod environments, request validation on
   every body, structured errors, usage counters (see Budget guard).
4. **Accounts** - anonymous guest account on first online visit; upgrade to
   Google OAuth or email magic link keeps the guest's progress. Sessions in
   httpOnly Secure SameSite=Lax cookies with rotation. Magic links: single-use,
   15-minute expiry, hashed in D1. Email sent through the Brevo transactional
   API from the owner's already-verified sending domain (free tier, 300
   emails/day); capped per address and per IP.
   The old local profile stays readable offline but is never uploaded.
5. **Run submission and verification** - `/runs/start` returns a server-chosen
   seed in an HMAC-signed, single-use ticket (user, cfg, seed, build, expiry);
   `/runs/submit` uploads the log; the Queue consumer replays it, compares
   periodic hashes and writes the server-derived `summary()`, records and
   achievements. Mismatch ⇒ `rejected` with the first divergent tick.
6. **Cloud profile and sync** - the server profile is a projection of verified
   runs plus cosmetic choices; the client keeps a cache and an outbox of unsent
   runs for offline play. Idempotent by ticket id.
7. **Leaderboards and online Hall of Records** - per `recordKey(cfg)` boards,
   weekly challenge with a shared seed, cached reads; writes only from the verifier.
8. **Hardening, ops and release** - rate limits, CSP and security headers,
   monitoring, D1 backups (Time Travel plus a scheduled export before every
   migration), account deletion and data export, load test, security review.
9. **Later: co-op and versus** (separate plan) - room Durable Object, lobby and
   invites, input delay tuning, reconnect from the last hash checkpoint, sent
   creeps for versus, multiplayer leaderboards.

## Budget: $5/month with no overage

Cloudflare Workers Paid is $5/month and bills usage above the included amounts
automatically; it has no hard spending cap, only billing notifications. So the
cap is enforced by the app, and services outside the plan stay on free tiers.

Included in Workers Paid (per month) and expected use:

| Resource | Included | Main consumer | Guard |
|---|---|---|---|
| Worker requests | 10M | API calls, ~10 per run | rate limits per user and IP |
| Worker CPU | 30M ms | replay verification, ~1-5 s per run | monthly CPU budget counter |
| D1 | 25B rows read, 50M written, 5 GB | profiles, runs, boards | indexes, cached board reads |
| Queues | 1M operations | ~3 per verified run | follows the verify budget |
| Durable Objects (later) | 1M requests, 400k GB-s | multiplayer rooms | room cap, hibernation |
| R2 (separate, free tier) | 10 GB, 1M writes, 10M reads | command logs | 90-day pruning, size caps |
| Brevo (free tier) | 300 emails/day | magic links | per-address and per-IP limits |

Replay CPU is the binding limit: 30M ms covers roughly 6,000-30,000 full runs a
month. The guard, stored in D1 and checked before enqueueing:

- Below 70% of the monthly CPU budget, every run is verified.
- Between 70% and 90%, only runs that would set a record, enter a board or
  unlock an achievement are verified; others keep a client summary marked
  unverified. Unverified runs appear in personal history only; they never
  count toward lifetime totals, records, achievements or leaderboards.
- Above 90%, verification pauses until the month resets and runs wait in the
  queue; email sign-in also pauses before the Brevo daily cap.
- Cloudflare billing notifications at 50% and 80% of each included amount as
  a second alarm.

## Security and cheat prevention

| Threat | Control |
|---|---|
| Edited `localStorage`, memory or devtools gold | Outcomes come only from server replay; client numbers are display only |
| Forged or replayed submissions | Signed seed ticket, single use, expiry, bound to user and cfg |
| Seed shopping | Server picks the seed; abandoned tickets count as runs; weekly challenge uses a shared seed |
| Impossible commands | Replay runs the real `buildCheck`/`canAfford`/ownership checks; an invalid command rejects the run |
| Speed hacks | Ticks, not wall time; run wall-clock duration checked against tick count at max 3x speed |
| Bots and macros | Rate limits, plausibility stats, report button, manual review of top-10 entries |
| Log bombs, CPU exhaustion | Size cap (512 KB gzip), command and tick caps, per-job CPU limit, CPU budget guard |
| Session theft, CSRF | httpOnly Secure cookies, SameSite=Lax plus origin check on mutating routes, rotation, session list with revoke |
| Magic-link abuse | Single use, short expiry, hashed tokens, send limits, no account enumeration in responses |
| Injection, XSS via names | Parameterized D1 queries; validated display names rendered with `textContent` |
| Multiplayer griefing (later) | Server-relayed commands only, slot ownership in `apply`, desync ⇒ match voided not scored |
| Secrets | `wrangler secret` for HMAC, OAuth and Brevo keys; never in repo or client bundle |

## Performance

- Gameplay is unchanged; the network is off the hot path. One request at run
  end, plus an optional checkpoint upload every 10 waves.
- The online client is code-split and loaded after the menu.
- Verification runs in Queue consumers; measure a 120-wave replay first and
  optimize the sim hot paths if it exceeds ~5 s, since CPU is the budget limit.
- Leaderboards and public profiles are served from the Cache API with a 30-60 s
  TTL; D1 indexes on `(record_key, score DESC)` and `(user_id, created_at)`.
- Logs gzip to kilobytes; keep rejected and top logs, prune the rest after 90 days.

## Acceptance

- `npm run build` passes; balance bot results unchanged within noise after
  phases 1 and 2.
- One log replays to identical hashes in Node, Chrome, Firefox and Safari.
- A two-slot command log (scripted) replays deterministically, proving the
  multiplayer-ready command layer.
- A browser run is accepted and appears on the board; logs with edited gold, an
  illegal build, a forged ticket or a reused ticket are rejected.
- Offline play works; the outbox submits after reconnect.
- A guest's progress survives sign-in with Google and with an email link, and
  shows on a second device.
- The budget guard switches modes at 70% and 90% in a test with a lowered budget.
- Security review of the Worker routes before public release.
- Docs: `docs/architecture.md` (online layer, trust model, players array), new
  `docs/online.md` (API, replay format, budget guard, ops runbook), README.

## Non-goals

- Shipping co-op or versus in this plan (phase 9 is its own plan).
- Migrating existing local profiles.
- Monetization, chat, clans.
