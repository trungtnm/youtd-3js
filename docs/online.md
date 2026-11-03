# Online play

Players get an account (a guest at first, then Google or an emailed link), a
profile kept on the server, and leaderboards that only list runs the server has
replayed and confirmed. The game still plays without lag and works offline: the
network is only used to start a run and to upload it when it ends.

## Pieces

| Part | Path | Role |
|---|---|---|
| Simulation | `src/sim/` | Deterministic; replays a run from its seed and command log (see [architecture](architecture.md#ticks-commands-and-replays)) |
| Replay | `src/sim/replay.js` | `checkLog`, `replayLog(log, { build })` |
| Profile fold | `src/meta/profile.js` | `applyRun`: the same rules locally and on the server |
| Browser client | `src/online/online.js`, `src/online/api.js` | Account state, run tickets, upload outbox |
| UI | `src/ui/account.js`, `src/ui/boards.js`, `src/ui/hall.js`, `src/ui/end-screen.js` | Account panel, leaderboards and weekly challenge, Hall account tab, verification status |
| Server | `worker/` | Cloudflare Worker: static files plus `/api/*` |
| Schema | `migrations/` | D1 tables: users, sessions, login tokens, runs, board (with review flags), rate windows, usage |
| Config | `wrangler.jsonc`, `.dev.vars.example` | Bindings, vars, cron, limits |

One Worker serves the Vite build from its asset store and runs first only for
`/api/*`. Bindings: D1 `DB`, R2 `LOGS` (run logs), Queue `VERIFY`
(`youtd-verify`, one replay per message), cron every 15 minutes.

## Trust model

The browser is never trusted for outcomes. A run starts with a ticket the server
signs (HMAC with a key derived from `TICKET_SECRET`; OAuth cookies and weekly
seeds use their own derived keys): run id, user, server-chosen seed, settings,
simulation build, 7-day expiry. When the run ends the client uploads the gzip of
`{ ticket, log, claim }`. The queue consumer replays the log with the server's
copy of the simulation and folds the replayed `summary()` into the profile with
`applyRun`. Records, totals, achievements, unlocks and leaderboard rows come only
from replays. The client's `claim` is used for two things only: the history entry
of a run the server did not replay, and deciding which runs to replay when the
budget is tight.

What a modified client cannot do: change gold or other state (the checkpoints and
the replay disagree), issue commands a player could not (the replay runs the
same rule checks; malformed commands fail `validCommand`), pick its seed (the
server picks it), replay a ticket with a different log (a second upload must
extend the first), finish faster than 3x speed allows (`end.tick / 60 / 3` must
fit in the time since the ticket, plus 120 s), claim an outcome its log does not
end in, submit another account's weekly log (identical weekly command lists are
refused; see [Weekly review](#weekly-review) for retimed copies), use modifiers its account has not unlocked, or play God mode online.
What it can do: play well with help (a bot, macros), and restart a run until it
likes the seed. Unused tickets count as runs in the profile when they expire,
but restarting is not prevented. Help is limited by rate limits and leaderboard
review, not prevented.

## Run lifecycle

1. `POST /api/runs/start` with the menu settings (or `weekly: true`) returns
   `{ runId, ticket, seed, cfg }`; the client builds the `Game` from them.
   Without a server the run uses a local seed and is recorded in this browser's
   profile only.
2. Every action goes through `game.command`, so `game.exportLog(SIM_BUILD)` holds
   the whole run.
3. At the end the client queues the upload in the outbox (`localStorage`
   `youtd-reforged-outbox`) and sends it. Network errors, 429 and 5xx keep it for a
   retry (15 s, doubling to 10 minutes; also on the browser `online` event).
4. The server checks the ticket and log, stores the log in R2 and enqueues it.
   Statuses: `queued`, `verified`, `rejected` (replay disagreed; error and tick
   stored), `unverified` (budget guard or simulation updated since the ticket;
   history only), `deferred` (budget paused; replayed when the month resets).
5. A tab opened before a deploy runs an older simulation build than the server;
   it shows "New version available" and does not start online runs until it is
   reloaded.
6. The client polls `GET /api/runs/:id`; the end screen shows the status. Its
   result is previewed at once with `applyRun` on a copy of the account profile.
7. A run continued after victory uploads again with the same ticket. The new log
   must extend the old one; the profile adds only the difference, and the
   leaderboard keeps the score at victory. An unsent victory upload stays queued
   ahead of the continued one.

A deploy that changes `src/sim/` or `src/data/` changes `SIM_BUILD`. Runs started
before it are kept as unverified history.

## API

All responses are JSON with `Cache-Control: no-store` (boards are cached 30 s),
`X-Content-Type-Options: nosniff` and `Referrer-Policy: same-origin`. Errors are
`{ error, message }` with an HTTP status. Mutating requests need the header
`X-YouTD: 1` and, when the browser sends `Origin`, that origin must equal
`APP_ORIGIN`.

| Route | Purpose |
|---|---|
| `GET /api/me` | Current user (or null), budget mode, simulation build |
| `POST /api/auth/guest` | Create a guest account and session if there is none |
| `GET /api/auth/google`, `GET /api/auth/google/callback` | Google sign-in (code flow, PKCE, state cookie) |
| `POST /api/auth/email` | Email a sign-in link (always answers ok) |
| `GET /api/auth/email/verify#token=` | Confirm page. The token is in the fragment, so it never reaches the server's logs; the page shows the masked address and its button POSTs, so mail scanners do not use up the link |
| `POST /api/auth/email/peek` | The masked address of a link's token (no side effects) |
| `POST /api/auth/email/verify` | Sign in with the link's token |
| `POST /api/auth/logout` | End the session |
| `GET /api/sessions`, `DELETE /api/sessions/:id` | Signed-in devices |
| `GET /api/profile`, `PUT /api/profile` | Profile and pending runs; change name, title, crest |
| `POST /api/runs/start`, `POST /api/runs/submit`, `GET /api/runs/:id` | Run tickets, uploads, status |
| `GET /api/leaderboard?key=`, `GET /api/leaderboard/weekly` | Top 50, best verified run per player; each entry has a 4-hex `tag` so equal names stay distinct. Cached 30 s at the edge |
| `GET /api/account/export`, `DELETE /api/account` | Download or delete all account data |

Board keys are `recordKey(cfg)` (`medium/build/full+glass`) and
`weekly:<ISO week>`. The weekly challenge uses one seed for everyone, Trial
length, no modifiers, difficulty cycling medium, hard, extreme and mode
alternating build and random.

## Weekly review

Everyone plays the weekly challenge on the same seed, so a copied log is valid
under any account. Two checks keep copies off the weekly board:

- An upload whose command list equals another account's weekly run is refused
  (409 `duplicate_log`).
- A copy that was retimed or padded with harmless commands still ends with the
  same towers on the same tiles. The verifier hashes the towers standing at the
  end (`towerLayout` in `worker/verify.js`) into `runs.layout_hash`. When another
  account's verified run on the same board has that hash, the new run still
  counts for its player's profile, but its board entry is stored with
  `hidden = 1` and a `note` naming the earlier run.

Hidden entries are left off `/api/leaderboard*`, and a better run from the same
player keeps the entry hidden. Only the owner unhides or hides entries, after
looking at the runs. Review the top of a week (the example is week 45 of 2026) with:

```bash
npx wrangler d1 execute DB --remote --command "SELECT b.user_id, u.name, b.score, b.hidden, b.note, b.run_id, r.log_ver, r.layout_hash FROM board b JOIN users u ON u.id = b.user_id JOIN runs r ON r.id = b.run_id WHERE b.key = 'weekly:2026-W45' ORDER BY b.score DESC LIMIT 20"
npx wrangler r2 object get youtd-logs/logs/<user_id>/<run_id>-<log_ver>.json.gz --remote --file run.json.gz
gunzip run.json.gz && npm run replay -- run.json
npx wrangler d1 execute DB --remote --command "UPDATE board SET hidden = 1, note = 'copied run' WHERE key = 'weekly:2026-W45' AND user_id = '<user_id>'"
npx wrangler d1 execute DB --remote --command "UPDATE board SET hidden = 0, note = NULL WHERE key = 'weekly:2026-W45' AND user_id = '<user_id>'"
```

Logs of runs holding a board entry (hidden or not) are kept for review. Boards are
cached for 30 s, so a change shows up within that time.

## Accounts and sessions

- Session cookie `sid`: 32 random bytes; D1 stores its SHA-256. `HttpOnly`,
  `SameSite=Lax`, 30 days, `Secure` on https. Rotated on every sign-in.
- A new Google id or email upgrades the guest in the browser that signs in, so
  guest progress carries over. A Google id or email that already has an account
  signs into that account (the guest is left behind). A verified Google email
  equal to an account's email links the two, unless that account is already
  linked to a different Google id (then sign-in is refused).
- Magic links: 32-byte tokens, stored hashed, single use, 15 minutes. Only the
  guest of the browser that opens the link is upgraded, never the one that
  requested it.
- Display names are 3 to 20 characters `[A-Za-z0-9 _-]`; the Google name is never
  used.
- Online profiles start empty; the profile stored in a browser is never uploaded.
  It stays on the Hall's "This browser" tab.

## Limits and cost

Everything is sized to stay inside the Workers Paid plan ($5/month) and free
tiers, because Cloudflare bills usage above the included amounts automatically.

| Limit | Value | Where |
|---|---|---|
| Upload size | 512 KB gzip, 8 MB unpacked | `worker/logs.js` |
| Log size | 50,000 commands, 4 hours of game time | `src/sim/replay.js` |
| Rate limits per hour | 3 emails per address, 10 per IP; 30 run starts and 60 uploads per user; 20 guests per IP; 30 link lookups per IP (IPv6 counted per /64) | `worker/limits.js` |
| Verification share per month | 2% of the CPU budget per user, 5% per IP (`USER_SHARE`, `IP_SHARE`); past it, runs are history only | `worker/budget.js` |
| Replay CPU | `limits.cpu_ms` 60000 | `wrangler.jsonc` |

Budget guard (`worker/budget.js`): Workers clocks do not advance during pure
computation, so each replay's CPU is estimated from the work the replay did
(`replayLog` returns `work`: per tick, 1 plus its creeps, towers and
projectiles) at 1 µs per unit, about 3x the measured 320-350 ns in Node, plus
50 ms charged when the attempt starts (so replays killed by the CPU limit still
count). A 65-wave run is ~3.9M units, ~4 s estimated, ~1.3 s measured. Idle
ticks cost almost nothing, so long idle logs cannot drain the budget. With `CPU_BUDGET_MS` = 30,000,000 (the plan's included CPU), the month's
estimate decides the mode: below 70% every run is replayed; 70 to 90% only runs
whose claim would set the player's record, reach the top 50, are weekly, or claim
a victory (others become unverified history); above 90% uploads are deferred
until next month. Email sign-in pauses at 90% of `EMAIL_DAILY_CAP` (300, Brevo's
free daily quota). Check real CPU in the Cloudflare dashboard after launch and
adjust `TICK_COST_MS`.

Retention (cron): R2 logs of finished runs are deleted after 90 days unless the
run was rejected or holds a leaderboard entry. Logs are versioned per upload
(`logs/<user>/<run>-<n>.json.gz`, written after the run row commits; older
versions are deleted). Expired tokens, sessions older than 31 days, unused
tickets after 8 days (counted as runs first) and guests with no session and no
runs are deleted.

## Local development

```bash
cp .dev.vars.example .dev.vars   # set TICKET_SECRET; DEV_MAIL_ECHO=1 returns links instead of mailing
npm run build                    # the Worker serves dist/
npm run api:migrate              # local D1
npm run api:dev                  # http://localhost:8787 (game and API)
npm run test:api                 # end-to-end API tests (own instances on 8787 and 8788)
```

`npm run dev` (Vite, port 5317) proxies `/api` to 8787. For sign-in through the
Vite server, set `APP_ORIGIN=http://localhost:5317` in `.dev.vars`, since the
Origin check and the OAuth redirect use it. Rebuilding while `api:dev` runs
replaces `dist/`; restart `api:dev` afterwards. With no server reachable the
game shows "Offline" and keeps progress in the browser.

## Deploying

Nothing in the repo creates remote resources; run these once with the owner's
Cloudflare account:

1. `npx wrangler d1 create youtd`; put the id in `wrangler.jsonc`
   (`database_id`). `npx wrangler r2 bucket create youtd-logs`.
   `npx wrangler queues create youtd-verify`.
2. Set `vars` in `wrangler.jsonc`: `APP_ORIGIN` (the https origin), `MAIL_FROM`
   (an address on the domain verified in Brevo), `MAIL_FROM_NAME`.
3. Secrets: `npx wrangler secret put TICKET_SECRET` (64 random hex chars),
   `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (Google Cloud OAuth client, web
   type, redirect URI `<APP_ORIGIN>/api/auth/google/callback`, scopes `openid`
   and `email`), `BREVO_API_KEY` (transactional API key). Never set
   `DEV_MAIL_ECHO` or `GOOGLE_TOKEN_URL` in production.
4. `npx wrangler d1 migrations apply DB --remote`, then `npm run deploy`.
5. In the Cloudflare dashboard, add billing notifications at 50% and 80% of
   each included amount.

Backups: D1 Time Travel restores any minute of the last 30 days. Before every
migration, export: `npx wrangler d1 export DB --remote --output backups/youtd-<date>.sql`
(`backups/` is gitignored). `npm run db:backup` does the same for the local
database.

## Multiplayer readiness

The pieces above are built for more than one player: commands carry a player
slot, `Game` keeps an economy per player and checks tower ownership, commands can
be scheduled ahead with `game.inputDelay`, and the state hash detects machines
drifting apart. A co-op or versus mode would add a Durable Object per room that
relays tick-stamped commands between players (no simulation on the server
during play) and submits the merged log to the same verifier. Logs with more
than one player are refused by `submit` today.
