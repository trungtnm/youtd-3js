// Runs the Cloudflare Worker in worker/ as a plain Node server (self-hosted with Docker).
// worker/ is unchanged: this file supplies what the Workers runtime did. Static files
// and /api/* over HTTP, the verify queue (verifier threads), the 15-minute cron, D1
// (SQLite file), R2 (directory) and the Cache API (memory).
//
// Environment: PORT (8787), HOST (127.0.0.1), DATA_DIR (.data), DIST_DIR (dist),
// QUEUE_CONCURRENCY (2), TRUST_PROXY (1 behind nginx: client IP from X-Real-IP),
// BACKUP_KEEP (14 daily backups), TEST_SCHEDULED (1: GET /cdn-cgi/handler/scheduled runs the cron).

import http from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Worker } from 'node:worker_threads';
import { mkdirSync, readdirSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import worker from '../worker/index.js';
import { SIM_BUILD } from '../src/sim/sim-build.js';
import { ROOT, createEnv, dataDir, execContext } from './env.js';
import { migrate, backupTo } from './migrate.js';
import { createAssets } from './assets.js';
import { memoryCache } from './cache.js';

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const CONCURRENCY = Math.max(1, Number(process.env.QUEUE_CONCURRENCY || 2));
const BACKUP_KEEP = Math.max(1, Number(process.env.BACKUP_KEEP || 14));
const CRON_MS = 15 * 60_000;
const DATA = dataDir();
const BACKUPS = join(DATA, 'backups');
mkdirSync(BACKUPS, { recursive: true });

// ---------------------------------------------------------------- environment and storage

const verifiers = [];
const { env, queue } = createEnv({ notify: () => { for (const w of verifiers) w.postMessage('wake'); } });

if (String(env.APP_ORIGIN || '').startsWith('https://')) {
  for (const k of ['DEV_MAIL_ECHO', 'GOOGLE_TOKEN_URL']) {
    if (env[k]) { console.error(`${k} is a development setting and must not be set with an https APP_ORIGIN`); process.exit(1); }
  }
}
for (const k of ['APP_ORIGIN', 'TICKET_SECRET']) if (!env[k]) { console.error(`${k} is not set`); process.exit(1); }

const { applied, backup } = migrate(env.DB.sqlite, join(ROOT, 'migrations'), BACKUPS);
if (backup) console.log(`backed up the database to ${backup}`);
if (applied.length) console.log(`applied migrations: ${applied.join(', ')}`);

env.ASSETS = createAssets(process.env.DIST_DIR || join(ROOT, 'dist'));
globalThis.caches = { default: memoryCache() };

// ---------------------------------------------------------------- verifier threads

let stopping = false;
queue.releaseAll();
if (queue.size()) console.log(`${queue.size()} queued runs waiting for verification`);
function startVerifier(i) {
  const w = new Worker(new URL('./verifier.js', import.meta.url), { env: process.env });
  w.on('error', (err) => console.error(`verifier ${i} crashed:`, err?.stack || err));
  w.on('exit', (code) => {
    verifiers.splice(verifiers.indexOf(w), 1);
    if (!stopping) { console.error(`verifier ${i} exited (${code}); restarting`); setTimeout(() => startVerifier(i), 1000); }
  });
  verifiers.push(w);
}
for (let i = 0; i < CONCURRENCY; i++) startVerifier(i);

// ---------------------------------------------------------------- cron and backups

// One copy of the database per UTC day, the newest BACKUP_KEEP kept.
function dailyBackup() {
  const file = join(BACKUPS, `youtd-${new Date().toISOString().slice(0, 10)}.sqlite`);
  if (existsSync(file)) return;
  backupTo(env.DB.sqlite, file);
  const daily = readdirSync(BACKUPS).filter((f) => /^youtd-\d{4}-\d\d-\d\d\.sqlite$/.test(f)).sort();
  for (const f of daily.slice(0, Math.max(0, daily.length - BACKUP_KEEP))) unlinkSync(join(BACKUPS, f));
}

let cronRunning = null;
function runCron() {
  cronRunning ??= (async () => {
    const ctx = execContext();
    try {
      await worker.scheduled({ cron: '*/15 * * * *', scheduledTime: Date.now() }, env, ctx);
      await ctx.settle();
      dailyBackup();
    } catch (err) {
      console.error('cron failed:', err?.stack || err);
    } finally {
      cronRunning = null;
    }
  })();
  return cronRunning;
}
let cronTimer;
const scheduleCron = () => { cronTimer = setTimeout(() => { runCron(); scheduleCron(); }, CRON_MS - (Date.now() % CRON_MS)); };
scheduleCron();

// ---------------------------------------------------------------- HTTP

// Bodies are read in full before worker/ sees them, as on Cloudflare: when a handler
// answers early (413 on Content-Length), an unread upload would otherwise reset the
// connection before the client reads the answer. worker/ applies its own, smaller limits.
const MAX_BODY = 2 * 1024 * 1024;
async function readAll(req) {
  const chunks = [];
  let n = 0;
  for await (const c of req) {
    n += c.length;
    if (n > MAX_BODY) return null;
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

async function toRequest(req) {
  const proto = TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  const headers = new Headers();
  for (let i = 0; i < req.rawHeaders.length; i += 2) headers.append(req.rawHeaders[i], req.rawHeaders[i + 1]);
  // worker/ reads the client address from CF-Connecting-IP; only nginx may set it.
  const ip = (TRUST_PROXY && req.headers['x-real-ip']) || req.socket.remoteAddress || '';
  headers.delete('X-Real-IP');
  headers.set('CF-Connecting-IP', ip.replace(/^::ffff:/, ''));
  let body;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    body = await readAll(req);
    if (body === null) return null;
  }
  return new Request(`${proto}://${req.headers.host || `localhost:${PORT}`}${req.url}`, { method: req.method, headers, body });
}

async function send(res, response, method) {
  const headers = {};
  response.headers.forEach((v, k) => { if (k !== 'set-cookie') headers[k] = v; });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) headers['set-cookie'] = cookies;
  res.writeHead(response.status, headers);
  if (!response.body || method === 'HEAD') { await response.body?.cancel(); res.end(); return; }
  await pipeline(Readable.fromWeb(response.body), res);
}

const server = http.createServer(async (req, res) => {
  try {
    if (!req.url.startsWith('/')) { res.writeHead(400).end(); return; }
    if (process.env.TEST_SCHEDULED === '1' && req.url.startsWith('/cdn-cgi/handler/scheduled')) {
      await runCron();
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end('Ran scheduled event');
      return;
    }
    const request = await toRequest(req);
    if (!request) {
      res.writeHead(413, { 'Content-Type': 'application/json', Connection: 'close' }).end('{"error":"too_large","message":"Request body too large."}');
      return;
    }
    const ctx = execContext();
    const response = await worker.fetch(request, env, ctx);
    await send(res, response, req.method);
    await ctx.settle();
  } catch (err) {
    console.error('request failed:', err?.stack || err);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' }).end('{"error":"internal","message":"Internal error."}');
    else res.destroy();
  }
});
server.requestTimeout = 60_000;
server.headersTimeout = 20_000;
server.listen(PORT, HOST, () => console.log(`youtd server on http://${HOST}:${PORT} (build ${SIM_BUILD}, data ${DATA}, ${CONCURRENCY} verifiers)`));

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`${signal}: shutting down`);
  clearTimeout(cronTimer);
  server.close();
  server.closeIdleConnections();
  // A replay cut short keeps its lease and is re-delivered after the lease runs out.
  await Promise.all(verifiers.map((w) => w.terminate()));
  await cronRunning;
  env.DB.close();
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
