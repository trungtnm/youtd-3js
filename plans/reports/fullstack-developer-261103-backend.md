# Backend report: online accounts and verified runs

Status: done. All contract endpoints work on local `wrangler dev`; `node tools/test-api.mjs` passes 27/27; `npm run build` and `node tools/test-replay.mjs` still pass. Nothing was deployed, committed or created remotely.

## File map

- `worker/index.js`: `fetch` (router, CSRF check, session lookup, error mapping, falls through to `ASSETS`), `queue`, `scheduled`.
- `worker/http.js`: errors, JSON/HTML/redirect responses with security headers, cookies, CSRF rule, size-capped body readers.
- `worker/crypto.js`: base64url, SHA-256, HMAC, signed blobs (tickets, OAuth cookie).
- `worker/sessions.js`: users, sessions (hashed sid), list/revoke.
- `worker/auth.js`: guest, Google OAuth (PKCE + signed state cookie), email magic link and confirm page.
- `worker/mail.js`: Brevo sender, daily send counter, 90% pause.
- `worker/limits.js`: D1 fixed-window rate limits (bucket names hashed).
- `worker/runs.js`: `start`, `submit`, `GET /runs/:id`.
- `worker/verify.js`: queue consumer (replay, fold, board), cron (re-queue, housekeeping).
- `worker/commit.js`: one D1 batch that updates run, board and profile together, guarded by run state and profile revision so concurrent writers cannot double count.
- `worker/budget.js`: CPU estimate, modes, important-run filter.
- `worker/leaderboard.js`: boards, weekly challenge (ISO week, HMAC seed).
- `worker/profile.js`, `worker/account.js`, `worker/logs.js` (R2 + gzip with a decompression cap).
- `migrations/0001_init.sql`, `wrangler.jsonc`, `.dev.vars.example`, `.gitignore` (`.dev.vars`, `.wrangler/`, `backups/`), `package.json` scripts, `tools/test-api.mjs`.
- Deviations and extra details are appended to `plans/261103-1457-online-accounts-and-verified-runs/api-contract.md` under "Backend notes".

## Run locally

```bash
npm run build
cp .dev.vars.example .dev.vars        # then edit TICKET_SECRET
npm run api:migrate                   # local D1
npm run api:dev                       # wrangler dev on 8787
npm run test:api                      # starts its own instances on 8787 and 8788 (needs both free)
npm run db:backup                     # wrangler d1 export of the local DB to backups/youtd-local.sql
```

The test uses a temp persist dir per run, passes secrets with `--var`, and mocks Google's token endpoint on a random local port. It stops the instances it started (verified: nothing left on 8787/8788, no workerd).

## Test results (real output)

```
ok   guest creation sets a session and /api/me reports it
ok   mutating requests need X-YouTD and a matching Origin (csrf)
ok   protected routes need a session; unknown routes give 404/405
ok   start rejects god mode, bad cfg and locked modifiers
ok   a real run is verified; profile, records, totals and board follow
ok   a continued log adds only the difference and keeps one history entry
ok   resubmitting the identical log is a no-op
ok   a reused ticket with a log that is not an extension is refused
ok   a tampered log is rejected with its error and tick
ok   forged, foreign and malformed tickets are refused
ok   a log longer than the wall clock allows is refused
ok   submit validates content type, gzip and size
ok   a ticket from an older simulation build is kept as unverified history
ok   profile edits validate name, title and crest
ok   weekly runs share one seed and rank on the weekly board
ok   email magic link upgrades the guest; the link works once
ok   the same address signs in on a second device with the same progress
ok   sessions list and revoke
ok   logout clears the session
ok   the email sender builds a Brevo request
ok   Google sign-in links the guest through PKCE and state
ok   account export lists runs without logs; delete removes everything
ok   email sign-in is rate limited per address
ok   cron handler runs cleanly
ok   budget modes switch at 70% and 90%
ok   tight budget verifies only important runs, then defers
ok   email sign-in pauses at 90% of the daily cap
27/27 passed
```

Account delete also checks, through `wrangler r2 object get --local`, that the log exists before and is gone after.

## CPU calibration

`LOG=... DIFF=easy CAP=10 SEED=1 node tools/balance.js` gave wave 66, 194,818 ticks, replayed in 1182 ms = 6.1 us/tick. `DIFF=beginner SEED=2` gave wave 97, 280,437 ticks in 1873 ms = 6.7 us/tick. The budget uses 3x: `TICK_COST_MS = 0.02` (20 us/tick) plus 50 ms fixed overhead per replay, documented in `worker/budget.js`. A 280k-tick run is estimated at 5.65 s; the longest allowed log (`MAX_TICKS`, 864,000) at about 17 s, inside the 60 s `cpu_ms` limit. The 3x factor was not measured inside workerd, since `Date.now()` does not advance there; check real CPU in Cloudflare analytics after deploy and adjust the constant.

## Deviations (all recorded in the contract)

- `/api/me` `user.google` is a boolean.
- `Secure` on cookies only when `APP_ORIGIN` is https.
- Optional var `GOOGLE_TOKEN_URL` for the test mock.
- Weekly runs rank only on the weekly board.
- Google sign-in links by verified email to an existing account; Google display names are never used.
- Magic link upgrades the guest that requested it, even if opened elsewhere.

## Open issues and notes

- `database_id` in `wrangler.jsonc` is a placeholder; replace it after `wrangler d1 create youtd`, and set `APP_ORIGIN` (default is the dev origin), `MAIL_FROM` and the secrets before deploy.
- Not built: R2 log pruning after 90 days (plan item, not in the contract) and a scheduled D1 export before migrations; `db:backup` exports the local DB only. Production backups would use `wrangler d1 export --remote` or Time Travel.
- Static HTML security headers must come from `public/_headers`, as the Worker only runs first for `/api/*`.
- Abandoned guests (after logout or after signing into an existing account) stay as orphan rows; no purge job yet.
- The weekly cron does not test re-queue of deferred runs end to end (needs a month rollover); the logic shares `getBudget` and `commitRun` with the tested paths.
- No shared module in `src/` needed changes.

## Review fixes

All 17 items from `plans/reports/code-reviewer-261103-online-security.md` that were assigned are done in `worker/**`, `migrations/0001_init.sql` (edited in place), `tools/test-api.mjs` and the contract's Backend notes (new subsection "security review fixes").

1. Budget (H1): CPU is charged from `result.work` at 1 us per unit (3x the measured 318-345 ns) plus a 50 ms overhead; per-user (2%) and per-IP (5%, IPv6 /64) monthly shares via vars `USER_SHARE` and `IP_SHARE`; over a share the run is `unverified`. New `share` table and `runs.ip_key`, `runs.charged`.
2. Charging (L2/L3): 50 ms up front when an attempt starts, work cost once right after the replay, nothing on commit retries (usage moved out of `commitRun`).
3. Claim must match `log.end.phase` (M1), 422 `bad_claim`.
4. Weekly copy detection (H2): `runs.cmds_hash`, 409 `duplicate_log`.
5. and 6. Magic link (M2, L7): token in the URL fragment; confirm page reads and clears it, calls `POST /api/auth/email/peek` for the masked address (no side effects, 30/hour per IP), then POSTs verify. `login_tokens.user_id` removed.
7. Google with a conflicting Google id is refused (M3).
8. Verifier stops when the re-read run's log version changed (M4).
9. Versioned logs (M5): `runs.log_ver`, key `logs/<uid>/<runId>-<n>.json.gz`; the run row commits first (guarded on status and `log_ver`), then the log is written (row restored if the write fails), older versions deleted after. A verifier that finds the log missing within 2 minutes of submission retries instead of rejecting.
10. `attempts` reset on every accepted submission (M6).
11. Abandoned tickets (M8): the cron counts each deleted `started` ticket in `profile.runs`, guarded by `rev`.
12. Ticket TTL 7 days, cleanup after 8 (L9).
13. Malformed percent escapes give JSON 400 `bad_path` (L1).
14. Board `tag` field (4 hex chars); `/api/me` `user.tag` has the same value. Client field name: `tag`.
15. Separate HMAC-derived keys for tickets, OAuth cookie and weekly seeds (L6).
16. Board GETs use `caches.default` for 30 s, keyed by URL (L8); `BOARD_CACHE_SECONDS=0` disables it (the main test instance does, so boards are fresh).
17. Email sends also limited per IPv6 /64 through the shared `ipKey` helper (L4); guest creation uses it too.

Not covered by a test: M4 (needs a concurrent resubmission mid-replay) and the C1 export-inside-event case (a lost run takes longer than the wall-clock rule allows from a test). The idle-log test checks the charge directly (`workCost` of a 24,000-tick idle replay is under 40 ms against 480 ms with the old per-tick rule).

Results (real output, tail of `npm run test:api`, which now starts three instances on 8787-8789):

```
ok   a link requested by one guest never upgrades that guest from another browser
ok   Google refuses an email that belongs to an account with another Google id
ok   malformed percent-escapes in paths give a JSON error
ok   board entries carry a stable tag that matches /api/me
ok   a continued run keeps only its newest log version in R2
ok   claims must agree with how the log ends
ok   an abandoned ticket counts as a run once it is old enough
ok   an idle log is charged for the work it takes, not its length
ok   board reads are served from the Cache API
ok   a user past their monthly share keeps runs as unverified history
37/37 passed
```

Other checks: `node tools/test-replay.mjs` 11 ok, 0 FAIL; `node tools/check-sim.mjs` "simulation code is deterministic"; `npm run build` passes. No wrangler process, `.wrangler` dir, persist dir or backup file is left behind.
