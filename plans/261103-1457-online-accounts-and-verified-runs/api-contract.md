# API contract (backend phases 3-8)

Shared by the Worker (`worker/`) and the browser client (`src/online/`). Changes to
this file must be mirrored on both sides.

## Hosting

One Cloudflare Worker serves the Vite build (`dist/`, static assets) and `/api/*`.
`wrangler.jsonc`: `main: worker/index.js`, assets with `binding: ASSETS`,
`run_worker_first: ["/api/*"]`, D1 `DB`, R2 `LOGS`, Queue producer and consumer
`VERIFY` (queue `youtd-verify`), cron trigger for deferred verification,
`observability.enabled`, `limits.cpu_ms` high enough for a replay (60000).

Vars: `APP_ORIGIN` (e.g. `https://youtd.example`; `http://localhost:8787` in dev),
`CPU_BUDGET_MS` (30000000), `EMAIL_DAILY_CAP` (300), `MAIL_FROM`, `MAIL_FROM_NAME`.
Secrets (`wrangler secret put`, `.dev.vars` locally, never committed): `TICKET_SECRET`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `BREVO_API_KEY`.
Dev only: `DEV_MAIL_ECHO=1` returns the magic link in the response instead of mailing.

## Conventions

- JSON in and out unless stated. Errors: HTTP status + `{ error: "<code>", message }`.
- Every `/api` response: `Cache-Control: no-store` (except cached GET boards),
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`.
- Session: cookie `sid` = 32 random bytes base64url; D1 stores its SHA-256.
  `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`. Rotated on sign-in.
- Mutating requests (POST/PUT/DELETE) require header `X-YouTD: 1` and, when an
  `Origin` header is present, `Origin === APP_ORIGIN`. Otherwise 403 `csrf`.
- Rate limits (fixed windows in D1, 429 `rate_limited`): sign-in email 3/hour per
  address and 10/hour per IP; run start 30/hour per user; submit 60/hour per user;
  guest creation 20/hour per IP.

## Endpoints

| Method, path | Body | Response |
|---|---|---|
| GET `/api/me` | | `{ user: null }` or `{ user: { id, name, guest, email, google }, verify: "all" \| "important" \| "paused", build }` |
| POST `/api/auth/guest` | | creates a guest user and session when there is none; same as `/api/me` |
| GET `/api/auth/google` | | 302 to Google (OAuth code flow, PKCE S256, `state` in a 10-minute signed cookie) |
| GET `/api/auth/google/callback` | | 302 to `/?signin=google` or `/?signin=error` |
| POST `/api/auth/email` | `{ email }` | always `{ ok: true }` (no account enumeration); dev echo adds `link` |
| GET `/api/auth/email/verify?token=` | | small HTML page with a Sign in button (mail scanners prefetch GETs) that POSTs |
| POST `/api/auth/email/verify` | `{ token }` | sets session; `{ ok: true }` |
| POST `/api/auth/logout` | | clears session |
| GET `/api/sessions` | | `{ sessions: [{ id, createdAt, lastSeen, agent, current }] }` (`id` = first 12 hex of hash) |
| DELETE `/api/sessions/:id` | | revokes one |
| GET `/api/profile` | | `{ profile, pending: [{ runId, status, at, cfg }] }` |
| PUT `/api/profile` | `{ name?, title?, crest? }` | `{ profile, user }`; name 3-20 chars `[A-Za-z0-9 _-]`; title/crest must be unlocked |
| POST `/api/runs/start` | `{ cfg: { difficulty, mode, length, modifiers }, weekly?: true }` | `{ runId, ticket, seed, build, cfg }` |
| POST `/api/runs/submit` | `{ ticket, log, claim }` (gzip, `Content-Type: application/gzip`) | `{ runId, status }` |
| GET `/api/runs/:id` | | `{ runId, status, error?, result? }` |
| GET `/api/leaderboard?key=` | | `{ key, entries: [{ rank, name, score, level, wavesCleared, outcome, at }] }` (top 50, best run per user) |
| GET `/api/leaderboard/weekly` | | `{ week, cfg, endsAt, entries }` |
| GET `/api/account/export` | | the user's data as JSON (user, sessions, runs without logs, profile) |
| DELETE `/api/account` | `{ confirm: "DELETE" }` | removes user, sessions, runs, logs, board rows |

## Run tickets and verification

- Ticket: `base64url(JSON payload) + "." + base64url(HMAC-SHA256(TICKET_SECRET))`.
  Payload `{ rid, uid, seed, cfg, build, weekly, iat, exp }`, `exp = iat + 24h`.
  The server picks `seed` (crypto random uint32; weekly: derived from the week id
  with HMAC so every player gets the same seed and cfg).
- Weekly challenge: week id `YYYY-Www` (ISO week, UTC). cfg: difficulty cycles
  `medium, hard, extreme` by week number, mode alternates `build`/`random`, length
  `trial`, no modifiers. Its board key is `weekly:<week id>`; normal boards use
  `recordKey(cfg)` from `src/meta/profile.js`. Board rows rank by score; a
  continued run counts as it stood at victory, like profile records.
- `start` refuses `cfg.god`, modifiers not unlocked in the server profile, and
  unknown cfg ids. It inserts a `runs` row with status `started`, so abandoned
  tickets still count as runs.
- `submit` body is the gzip of `JSON.stringify({ ticket, log, claim })`. Limits:
  512 KB compressed, 8 MB decompressed. `log` is `Game.exportLog(SIM_BUILD)`
  (see `src/sim/replay.js`). `claim` is the client's own summary
  `{ outcome, level, wavesCleared, score, kills, time }`, used only for unverified
  history and for picking which runs to verify when the budget is tight.
- Checks before storing: ticket signature, expiry, `uid` = session user, run not
  `rejected`, `log.seed`/`log.cfg`/`log.build` equal the ticket's, `checkLog(log)`
  passes, and wall clock: `log.end.tick / 60 / 3 <= (now - iat) / 1000 + 120`.
- A run may be submitted again with a longer log (continued after victory): same
  ticket, the new log must extend the old one (same commands as a prefix, larger
  `end.tick`). It is verified again and the profile adds only the difference
  (`applyRun` with the stored `runState`).
- Statuses: `started`, `queued`, `verified`, `rejected` (replay disagreed; `error`
  and `tick` stored), `unverified` (budget guard or different build; history only),
  `deferred` (budget paused; re-queued by cron when the month resets).
- The verifier replays with `replayLog(log, { build: SIM_BUILD })` and folds
  `game.summary()` into the profile with `applyRun` from `src/meta/profile.js`.
  Only verified runs touch totals, records, achievements and leaderboards.
  Unverified runs add a history entry with `unverified: true`.

## Budget guard

`usage` row per month: estimated CPU ms (replayed ticks x a calibrated cost per
tick, since Workers clocks do not advance during pure computation), runs
verified; `usage_daily` per day: emails sent. Mode from `cpu / CPU_BUDGET_MS`:
below 0.7 `all`; 0.7-0.9 `important` (claimed score beats the player's record for
that setup, enters the top 50, is a weekly run, or claims a victory); above 0.9
`paused` (runs stored as `deferred`). Email sign-in returns 503 `email_paused`
at 90% of `EMAIL_DAILY_CAP`.

## Backend notes

Details the Worker settles that the contract above leaves open, plus small deviations.

- `/api/me` `user.google` is a boolean (a Google account is linked), not the Google id.
- The `sid` and `oauth` cookies add `Secure` only when `APP_ORIGIN` is https (Safari drops Secure cookies on `http://localhost`). Production is https, so there it is always set.
- Extra var `GOOGLE_TOKEN_URL` (optional) overrides Google's token endpoint; the API test points it at a local mock. Never set it in production.
- Google sign-in requests scope `openid email`. The Google display name is never used: new accounts get `Player-xxxx`, guests `Guest-xxxx`, and the name is editable. Sign-in order: known `google_sub`, then a verified email that matches an existing account (the Google id is linked to it), then the current guest is upgraded, else a new account.
- Magic link: if the address is new, the link upgrades the guest of the browser that opens it (never the guest that asked for it: that would let someone request a link for another person's address and share the account they then sign into); otherwise it signs into the account that owns the address. Every sign-in rotates the session.
- `POST /api/auth/email` returns 400 `bad_email` for a malformed address, 429 `rate_limited`, 503 `email_paused`; otherwise always `{ ok: true }`, even when Brevo fails.
- `POST /api/runs/start` errors: 400 `bad_cfg` / `god_mode`, 403 `modifier_locked`, 429. With `weekly: true` the `cfg` in the body is ignored and the weekly cfg is used. Weekly runs rank only on the weekly board (not on the normal board for the same setup), though the profile still records them.
- `POST /api/runs/submit` errors: 415 `bad_type`, 413 `too_large`, 400 `bad_gzip` / `bad_json` / `bad_body` / `bad_claim` / `bad_ticket` / `ticket_expired`, 403 `bad_ticket` (another user's ticket), 422 `invalid_log` / `log_mismatch` / `too_fast`, 409 `run_rejected` / `run_final` / `not_extension` / `conflict`, 429. The claim requires `outcome` in `won|lost|abandoned|running` and non-negative numbers for the other fields.
- Resubmitting a byte-for-byte identical log returns the current status without re-verifying. A longer log must keep the old commands and checkpoints as a prefix. A continued run is only ever `queued` or `deferred` (the 70% filter applies to first submissions). A run with status `unverified` is final (409 `run_final`).
- `GET /api/runs/:id` for a rejected run returns `{ runId, status: "rejected", error, tick }`. `result` is `{ outcome, level, wavesCleared, score, kills, time, newRecord, earned, unlocks, continued }`.
- `pending` in `/api/profile` lists `queued` and `deferred` runs; `at` is the submission time and `cfg` the run settings.
- "Enters the top 50" for the important-run filter means the claimed score is above 0 and either the board has fewer than 50 rows or the score beats the 50th.
- Boards ignore a verified run that has `continued: true` (its victory score was recorded by the earlier submission).
- Cron (every 15 minutes): re-queues `queued` runs older than 15 minutes (lost queue message), re-queues up to 50 `deferred` runs when the month is back in `all` mode, deletes R2 logs of verified/unverified runs older than 90 days that hold no board entry (`runs.log_pruned`, `board.run_id`), deletes expired rate windows, login tokens, sessions, `started` tickets older than 3 days, and guest accounts with no session and no runs.
- Static security headers (CSP etc.) for the HTML pages are not set by the Worker, which only runs first for `/api/*`; use `public/_headers`.

### Backend notes: security review fixes

- Budget accounting: a replay is charged `RUN_OVERHEAD_MS` (50 ms) when its attempt starts and `work x 1 us` once after it ends (`work` from `replayLog`; calibration in `worker/budget.js`). Retried commits never charge again. Vars `USER_SHARE` (default 0.02) and `IP_SHARE` (default 0.05) are fractions of `CPU_BUDGET_MS` per month for one account and one client address (IPv4, or IPv6 /64, stored hashed on the run). A first submission over a share is stored `unverified` (history only); a resubmission over it gets 429 `verify_share`.
- `submit`: `claim.outcome` must match `log.end.phase` (`won`, `lost`, `abandoned`; `running` for `prep`/`running`), else 422 `bad_claim`. A weekly log whose command list equals another account's weekly run of the same week is refused with 409 `duplicate_log`. Every accepted submission resets the replay attempt counter. Ticket lifetime is 7 days; tickets never submitted are deleted after 8 days by the cron and each one adds 1 to `profile.runs`. Possible 503 `storage_unavailable` when R2 fails.
- Email link: `link` is now `<APP_ORIGIN>/api/auth/email/verify#token=<token>`; the token is in the fragment and never reaches the server until the page POSTs it. The confirm page (GET, no query) calls `POST /api/auth/email/peek { token }` -> `{ email: "pl***@example.com" }` (no side effects, 30/hour per IP) and shows it before the Sign in button. Login tokens no longer store the requesting user.
- Google: an account found by verified email that already has a different Google id is not signed into (redirect `/?signin=error`).
- Boards: each entry has `tag` (4 hex chars of a hash of the user id) and `/api/me` `user.tag` carries the same value; clients should render `name #tag`. Board GETs are cached with the Cache API for 30 s (`BOARD_CACHE_SECONDS`, 0 disables; response header `X-Board-Cache: hit|miss`).
- Keys: tickets, the OAuth cookie and weekly seeds each use their own key derived from `TICKET_SECRET` with HMAC. Tickets issued before this change are invalid.
- Email sends are rate limited per IPv6 /64 (and per IPv4 address) as well as per address; malformed percent escapes in paths return 400 `bad_path`.
- R2 logs are stored per accepted submission as `logs/<uid>/<runId>-<n>.json.gz`; the run row names the current one and older versions are deleted after the new one is stored.
