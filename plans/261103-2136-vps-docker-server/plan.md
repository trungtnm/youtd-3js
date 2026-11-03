# Self-host the online server on the VPS with Docker

Status: done (2026-11-03): live at https://youtd.0xtrungtran.com from ctb-1; Cloudflare Worker, D1, R2 and Queue deleted

## Outcome

The game and `/api` are served from one Docker container on `ctb-1`
(194.233.86.144) at `https://youtd.0xtrungtran.com`, behind the existing nginx
and the Cloudflare proxy. Cloudflare keeps only DNS and the proxy; the Worker,
D1, R2 and Queue are retired.

## Constraints

- `worker/` stays unchanged: a Node adapter supplies the bindings it expects
  (`DB`, `LOGS`, `VERIFY`, `ASSETS`, `caches.default`, `waitUntil`, cron).
- Same trust model, limits and API contract as documented in `docs/online.md`.
- Replays must not block HTTP: they run in worker threads.
- Data lives in one host directory (`/home/trungtran/projects/youtd/data`): SQLite database, run
  logs, durable queue, daily backups. Backup before every migration.
- Secrets only in `/home/trungtran/projects/youtd/.env` on the VPS (mode 600), never in the repo.
- Follow the VPS's nginx pattern: Cloudflare-only gate, real IP from
  `CF-Connecting-IP`, Let's Encrypt via webroot.

## Non-goals

- No change to game rules, the simulation or the API.
- No container registry or CI; deploys build on the VPS from `git archive HEAD`.

## Pieces

| Piece | Path |
|---|---|
| Node entry: HTTP, bindings, cron, migrations | `server/index.js` |
| D1 API on `node:sqlite` | `server/sqlite-d1.js` |
| R2 API on the filesystem | `server/fs-r2.js` |
| Durable queue (SQLite) and verifier threads | `server/queue.js`, `server/verifier.js` |
| Static files (`_headers`, Range, 404) | `server/assets.js` |
| Board cache (`caches.default`) | `server/cache.js` |
| Image and service | `Dockerfile`, `.dockerignore`, `compose.yaml` |
| nginx site | `deploy/nginx/youtd.0xtrungtran.com.conf` |
| Deploy script | `tools/deploy-vps.sh` |
| Tests | `tools/test-api.mjs` runs against the Node server (default) or `wrangler dev` (`API_SERVER=wrangler`) |

## Acceptance

1. `test:api` passes against the Node server; `test:replay`, `check:sim`, build pass.
2. Container healthy on the VPS; `/api/me` returns the build id through nginx.
3. After the DNS switch: the live smoke test passes (page loads, guest created,
   weekly board returns a week, a played run becomes verified).
4. `docs/online.md` describes the VPS deployment, backups and review commands.
5. Empty Cloudflare D1/R2/Queue and the Worker secret are deleted after confirmation.

## Cutover (needs the owner in the Cloudflare dashboard)

1. Remove the Workers custom domain `youtd.0xtrungtran.com` from `youtd-reforged`.
2. Add DNS `A youtd -> 194.233.86.144`, proxied.
3. `certbot certonly --webroot -w /var/www/letsencrypt -d youtd.0xtrungtran.com`,
   then enable the 443 server block. Expect a few minutes of downtime.

Rollback: re-attach the custom domain to the Worker (the static game keeps working).
