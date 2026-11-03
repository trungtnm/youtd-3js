// End-to-end test of the online API. Starts and stops its own server instances on ports
// 8787-8789 with fresh state, and a mock Google token endpoint; no real network service is
// called. By default the instances are the Node server that runs in production
// (server/index.js); API_SERVER=wrangler runs the same worker/ code under `wrangler dev`.
// Usage: npm run build && node tools/test-api.mjs

import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, createHmac } from 'node:crypto';
import { Game } from '../src/sim/game.js';
import { SIM_BUILD } from '../src/sim/sim-build.js';
import { TOWER_LIST } from '../src/data/towers.js';
import { isBuildable, COLS, ROWS } from '../src/sim/map-layout.js';
import { sendMail } from '../worker/mail.js';
import { runCost, workCost, budgetMode } from '../worker/budget.js';
import { replayLog } from '../src/sim/replay.js';
import { towerLayout } from '../worker/verify.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRANGLER = join(ROOT, 'node_modules/wrangler/bin/wrangler.js');
const SERVER = process.env.API_SERVER || 'node';
if (!['node', 'wrangler'].includes(SERVER)) throw new Error(`API_SERVER must be node or wrangler, not ${SERVER}`);
const SECRET = 'test-ticket-secret-not-for-production';
const CLIENT_ID = 'test-client.apps.googleusercontent.com';

const results = [];
let failed = false;
async function test(name, fn) {
  try { await fn(); results.push(`ok   ${name}`); } catch (e) { failed = true; results.push(`FAIL ${name}\n     ${e.message}`); if (process.env.DEBUG_API) console.log(children[0]?.logs().slice(-1500)); }
  console.log(results[results.length - 1]);
}

// ---------------------------------------------------------------- game driver

const tiles = [];
for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) if (isBuildable(c, r)) tiles.push({ c, r });

// A small scripted player: research fire, build cheap towers, upgrade and call waves.
function play(g) {
  const pl = g.players[0];
  const cmd = (op, args) => g.command(op, args, 0);
  while (pl.research.fire < 3 && pl.tomes >= g.researchCost('fire', pl)) cmd('research', { el: 'fire' });
  // Build mode: the cheapest unlocked fire tower. Random mode: whatever the draft offers.
  const pick = () => (g.cfg.mode === 'random'
    ? TOWER_LIST.find((t) => t.id === pl.towerStash[0])
    : TOWER_LIST.filter((t) => t.tier === 0 && t.element === 'fire' && g.towerUnlocked(t, pl)).sort((a, b) => a.totalCost - b.totalCost)[0]);
  for (const tile of tiles) {
    const def = pick();
    if (!def || pl.gold < def.totalCost || pl.tomes < def.tomeCost || g.towers.size >= 6) break;
    if (!g.towerGrid.has(`${tile.c},${tile.r}`)) cmd('build', { id: def.id, c: tile.c, r: tile.r });
  }
  for (const t of g.towers.values()) {
    while (t.perkOffer) cmd('perk', { tower: t.uid, perk: t.perkOffer[0] });
    if (!g.upgradeCheck(t)) cmd('upgrade', { tower: t.uid });
  }
  if (g.activeWaves.length === 0) cmd('wave');
}

function startGame(cfg, seed) {
  const g = new Game({ ...cfg, players: 1, seed, god: false, autoWave: false, autoTransmute: [] });
  g.on('error', () => {});
  g.command('wave');
  return g;
}

function advance(g, until, script = play) {
  while (!g.isOver() && g.tick < until) {
    if (g.tick % 30 === 0) script(g);
    g.step();
  }
  return g;
}

// Plays another run's commands again, each `delay` ticks later: a valid log with a
// different command list that ends with the same towers.
function retimed(srcLog, cfg, seed, delay) {
  const g = new Game({ ...cfg, players: 1, seed, god: false, autoWave: false, autoTransmute: [] });
  g.on('error', () => {});
  const cmds = srcLog.cmds.map(([t, slot, op, args]) => [t + delay, slot, op, args]);
  let i = 0;
  while (!g.isOver() && g.tick <= srcLog.end.tick + delay) {
    while (i < cmds.length && cmds[i][0] === g.tick) { g.command(cmds[i][2], cmds[i][3], cmds[i][1]); i++; }
    if (g.tick === srcLog.end.tick + delay) break;
    g.step();
  }
  return g;
}

const claimOf = (g) => { const s = g.summary(); return { outcome: s.outcome, level: s.level, wavesCleared: s.wavesCleared, score: Math.floor(s.score), kills: s.kills, time: s.time }; };
const logOf = (g, build = SIM_BUILD) => JSON.parse(JSON.stringify(g.exportLog(build)));

// ---------------------------------------------------------------- server and client

function startServer({ port, persist, vars }) {
  let child;
  if (SERVER === 'node') {
    const env = { ...process.env, ...Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, String(v)])), PORT: String(port), DATA_DIR: persist, TEST_SCHEDULED: '1' };
    child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], { cwd: ROOT, stdio: 'pipe', env });
  } else {
    const run = (args) => execFileSync(process.execPath, [WRANGLER, ...args], { cwd: ROOT, stdio: 'pipe' });
    run(['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', persist]);
    const varArgs = Object.entries(vars).flatMap(([k, v]) => ['--var', `${k}:${v}`]);
    child = spawn(process.execPath, [WRANGLER, 'dev', '--port', String(port), '--persist-to', persist, '--test-scheduled', ...varArgs], { cwd: ROOT, stdio: 'pipe' });
  }
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  child.logs = () => log;
  return child;
}

// Direct access to an instance's storage: SQL on its database, and a stored run log
// (throws when the log is missing).
function sqlAt(persist, q) {
  if (SERVER === 'wrangler') return execFileSync(process.execPath, [WRANGLER, 'd1', 'execute', 'DB', '--local', '--persist-to', persist, '--command', q], { cwd: ROOT, stdio: 'pipe' });
  const db = new DatabaseSync(join(persist, 'youtd.sqlite'));
  try { db.exec('PRAGMA busy_timeout = 10000'); db.exec(q); } finally { db.close(); }
}
function logAt(persist, key) {
  if (SERVER === 'wrangler') {
    return execFileSync(process.execPath, [WRANGLER, 'r2', 'object', 'get', `youtd-logs/${key}`, '--local', '--persist-to', persist, '--file', join(persist, 'fetched.gz')], { cwd: ROOT, stdio: 'pipe' });
  }
  return readFileSync(join(persist, 'logs', ...key.split('/')));
}

async function waitReady(base, child, ms = 120_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (child.exitCode !== null) throw new Error(`${SERVER} server exited early:\n${child.logs().slice(-2000)}`);
    try { if ((await fetch(`${base}/api/me`)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${SERVER} server did not start:\n${child.logs().slice(-2000)}`);
}

const stop = (child) => new Promise((resolve) => {
  if (child.exitCode !== null) return resolve();
  child.once('exit', resolve);
  child.kill('SIGTERM');
  setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 8000);
});

function client(base) {
  const origin = new URL(base).origin;
  const jar = () => ({});
  async function api(j, method, path, { body, headers = {}, csrf = true, raw, redirect = 'follow' } = {}) {
    const h = { ...headers };
    if (method !== 'GET' && csrf) h['X-YouTD'] = '1';
    if (j.sid) h.Cookie = `sid=${j.sid}`;
    if (j.oauth) h.Cookie = `${h.Cookie ? `${h.Cookie}; ` : ''}oauth=${j.oauth}`;
    let payload;
    if (raw !== undefined) payload = raw;
    else if (body !== undefined) { payload = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
    const res = await fetch(base + path, { method, headers: h, body: payload, redirect });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i), value = pair.slice(i + 1);
      const gone = /Max-Age=0/i.test(c);
      if (name === 'sid' || name === 'oauth') { if (gone) delete j[name]; else j[name] = value; }
    }
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : await res.text();
    return { status: res.status, data, headers: res.headers };
  }
  return { api, jar, origin, base };
}

async function waitRun(c, j, runId, want, ms = 90_000) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    last = (await c.api(j, 'GET', `/api/runs/${runId}`)).data;
    if (want.includes(last.status)) return last;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`run ${runId} stuck at ${JSON.stringify(last)}`);
}

const tokenOf = (link) => new URL(link).hash.replace(/^#token=/, '');
const submitBody = (ticket, log, claim) => gzipSync(JSON.stringify({ ticket, log, claim }));
const submit = (c, j, ticket, log, claim) => c.api(j, 'POST', '/api/runs/submit', { raw: submitBody(ticket, log, claim), headers: { 'Content-Type': 'application/gzip' } });
const CFG = { difficulty: 'easy', mode: 'build', length: 'trial', modifiers: [] };

async function newGuest(c) {
  const j = c.jar();
  const r = await c.api(j, 'POST', '/api/auth/guest');
  assert.equal(r.status, 200);
  assert.ok(j.sid, 'session cookie set');
  return { j, user: r.data.user };
}

const start = (c, j, body = { cfg: CFG }) => c.api(j, 'POST', '/api/runs/start', { body });

// ---------------------------------------------------------------- mock Google token endpoint

function mockGoogle() {
  const state = { last: null };
  const server = http.createServer((req, res) => {
    let data = '';
    req.on('data', (d) => { data += d; });
    req.on('end', () => {
      const form = Object.fromEntries(new URLSearchParams(data));
      state.last = form;
      const fresh = form.code === 'new-sub-code'; // a Google account the server has never seen
      const claims = { iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: fresh ? 'google-sub-3' : form.code === 'other-sub-code' ? 'google-sub-2' : 'google-sub-1', email: fresh ? 'New@Example.com' : 'Gee@Example.com', email_verified: true, exp: Math.floor(Date.now() / 1000) + 3600 };
      const part = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
      res.setHeader('Content-Type', 'application/json');
      if (!['good-code', 'other-sub-code', 'new-sub-code'].includes(form.code)) { res.statusCode = 400; res.end('{"error":"invalid_grant"}'); return; }
      res.end(JSON.stringify({ id_token: `${part({ alg: 'none' })}.${part(claims)}.sig`, access_token: 'x' }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, state, port: server.address().port })));
}

// ---------------------------------------------------------------- main

const tmp = mkdtempSync(join(tmpdir(), 'youtd-api-'));
const children = [];
let google;
const cleanup = async () => {
  await Promise.all(children.map(stop));
  google?.server.close();
  rmSync(tmp, { recursive: true, force: true });
};
process.on('SIGINT', async () => { await cleanup(); process.exit(130); });

try {
  google = await mockGoogle();
  const main = startServer({
    port: 8787, persist: join(tmp, 'main'),
    vars: { TICKET_SECRET: SECRET, DEV_MAIL_ECHO: 1, CONTACT_EMAIL: 'help@example.com', GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: 'test-google-secret', BOARD_CACHE_SECONDS: 0, GOOGLE_TOKEN_URL: `http://127.0.0.1:${google.port}/token` },
  });
  children.push(main);
  const C = client('http://localhost:8787');
  await waitReady(C.base, main);
  console.log(`${SERVER} server ready on ${C.base} (pid ${main.pid}), build ${SIM_BUILD}`);

  // ---------------------------------------------------------------- basics and CSRF
  let A; // the main player, guest first
  await test('/api/config reports the contact address from the environment', async () => {
    const r = await C.api(C.jar(), 'GET', '/api/config');
    assert.equal(r.status, 200);
    assert.deepEqual(r.data, { contact: 'help@example.com' });
  });

  await test('guest creation sets a session and /api/me reports it', async () => {
    const anon = await C.api(C.jar(), 'GET', '/api/me');
    assert.deepEqual(anon.data, { user: null });
    A = await newGuest(C);
    assert.equal(A.user.guest, true);
    const me = await C.api(A.j, 'GET', '/api/me');
    assert.equal(me.data.user.id, A.user.id);
    assert.equal(me.data.verify, 'all');
    assert.equal(me.data.build, SIM_BUILD);
    assert.equal(me.headers.get('cache-control'), 'no-store');
    assert.equal(me.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(me.headers.get('referrer-policy'), 'same-origin');
  });

  await test('mutating requests need X-YouTD and a matching Origin (csrf)', async () => {
    const j = C.jar();
    const noHeader = await C.api(j, 'POST', '/api/auth/guest', { csrf: false });
    assert.equal(noHeader.status, 403);
    assert.equal(noHeader.data.error, 'csrf');
    const badOrigin = await C.api(j, 'POST', '/api/auth/guest', { headers: { Origin: 'http://evil.example' } });
    assert.equal(badOrigin.status, 403);
    assert.equal(badOrigin.data.error, 'csrf');
    const goodOrigin = await C.api(j, 'POST', '/api/auth/guest', { headers: { Origin: C.origin } });
    assert.equal(goodOrigin.status, 200);
  });

  await test('protected routes need a session; unknown routes give 404/405', async () => {
    assert.equal((await C.api(C.jar(), 'GET', '/api/profile')).status, 401);
    assert.equal((await C.api(C.jar(), 'GET', '/api/nope')).status, 404);
    assert.equal((await C.api(C.jar(), 'POST', '/api/me')).status, 405);
  });

  // ---------------------------------------------------------------- start validation
  await test('start rejects god mode, bad cfg and locked modifiers', async () => {
    const god = await start(C, A.j, { cfg: { ...CFG, god: true } });
    assert.equal(god.status, 400);
    assert.equal((await start(C, A.j, { cfg: { ...CFG, difficulty: 'nightmare' } })).status, 400);
    assert.equal((await start(C, A.j, { cfg: { ...CFG, modifiers: ['bogus'] } })).status, 400);
    assert.equal((await start(C, A.j, {})).status, 400);
    const locked = await start(C, A.j, { cfg: { ...CFG, modifiers: ['glass'] } });
    assert.equal(locked.status, 403);
    assert.equal(locked.data.error, 'modifier_locked');
  });

  // ---------------------------------------------------------------- the happy path
  let g1, run1;
  await test('a real run is verified; profile, records, totals and board follow', async () => {
    const s = await start(C, A.j);
    assert.equal(s.status, 200);
    assert.equal(s.data.build, SIM_BUILD);
    assert.deepEqual(s.data.cfg, CFG);
    assert.ok(Number.isInteger(s.data.seed));
    run1 = s.data;
    g1 = advance(startGame(CFG, s.data.seed), 4200);
    const sub = await submit(C, A.j, s.data.ticket, logOf(g1), claimOf(g1));
    assert.equal(sub.status, 200, JSON.stringify(sub.data));
    assert.equal(sub.data.status, 'queued');
    const done = await waitRun(C, A.j, s.data.runId, ['verified', 'rejected']);
    assert.equal(done.status, 'verified', JSON.stringify(done));
    assert.equal(done.result.kills, g1.stats.kills);
    const p = (await C.api(A.j, 'GET', '/api/profile')).data;
    assert.equal(p.profile.runs, 1);
    assert.equal(p.profile.totals.kills, g1.stats.kills);
    assert.equal(p.profile.history.length, 1);
    assert.equal(p.profile.records['easy/build/trial'].score, Math.floor(g1.score));
    assert.deepEqual(p.pending, []);
    const board = (await C.api(C.jar(), 'GET', '/api/leaderboard?key=easy/build/trial')).data;
    assert.equal(board.entries.length, 1);
    assert.equal(board.entries[0].rank, 1);
    assert.equal(board.entries[0].score, Math.floor(g1.score));
    assert.ok(board.entries[0].name.length >= 3);
  });

  await test('a continued log adds only the difference and keeps one history entry', async () => {
    const before = (await C.api(A.j, 'GET', '/api/profile')).data.profile;
    advance(g1, 6000);
    const sub = await submit(C, A.j, run1.ticket, logOf(g1), claimOf(g1));
    assert.equal(sub.status, 200, JSON.stringify(sub.data));
    assert.equal(sub.data.status, 'queued');
    // wait for the status to leave queued
    const done = await waitRun(C, A.j, run1.runId, ['verified', 'rejected']);
    assert.equal(done.status, 'verified');
    const p = (await C.api(A.j, 'GET', '/api/profile')).data.profile;
    assert.equal(p.runs, 1);
    assert.equal(p.history.length, 1);
    assert.equal(p.history[0].at, before.history[0].at);
    assert.equal(p.totals.kills, g1.stats.kills);
    assert.ok(g1.stats.kills >= before.totals.kills);
  });

  await test('resubmitting the identical log is a no-op', async () => {
    const sub = await submit(C, A.j, run1.ticket, logOf(g1), claimOf(g1));
    assert.equal(sub.status, 200);
    assert.equal(sub.data.status, 'verified');
  });

  await test('a reused ticket with a log that is not an extension is refused', async () => {
    const other = advance(startGame(CFG, run1.seed), 6600, (g) => { if (g.activeWaves.length === 0) g.command('wave'); });
    const sub = await submit(C, A.j, run1.ticket, logOf(other), claimOf(other));
    assert.equal(sub.status, 409);
    assert.equal(sub.data.error, 'not_extension');
  });

  // ---------------------------------------------------------------- cheating
  await test('a tampered log is rejected with its error and tick', async () => {
    const s = await start(C, A.j);
    const g = advance(startGame(CFG, s.data.seed), 3000);
    const log = logOf(g);
    const i = log.cmds.findIndex((c) => c[2] === 'build');
    log.cmds[i][3].c = (log.cmds[i][3].c + 1) % COLS;
    const sub = await submit(C, A.j, s.data.ticket, log, claimOf(g));
    assert.equal(sub.status, 200, JSON.stringify(sub.data));
    const done = await waitRun(C, A.j, s.data.runId, ['rejected', 'verified']);
    assert.equal(done.status, 'rejected');
    assert.ok(done.error && Number.isInteger(done.tick), JSON.stringify(done));
    const again = await submit(C, A.j, s.data.ticket, logOf(g), claimOf(g));
    assert.equal(again.status, 409);
    assert.equal(again.data.error, 'run_rejected');
    const p = (await C.api(A.j, 'GET', '/api/profile')).data.profile;
    assert.equal(p.runs, 1, 'rejected run did not touch the profile');
  });

  await test('forged, foreign and malformed tickets are refused', async () => {
    const s = await start(C, A.j);
    const g = advance(startGame(CFG, s.data.seed), 600);
    const log = logOf(g), claim = claimOf(g);
    const [body, sig] = s.data.ticket.split('.');
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    const forgedBody = Buffer.from(JSON.stringify({ ...payload, seed: payload.seed ^ 1 })).toString('base64url');
    assert.equal((await submit(C, A.j, `${forgedBody}.${sig}`, log, claim)).status, 400);
    assert.equal((await submit(C, A.j, `${body}.${sig.slice(0, -2)}AA`, log, claim)).status, 400);
    assert.equal((await submit(C, A.j, 'garbage', log, claim)).status, 400);
    const B = await newGuest(C);
    const foreign = await submit(C, B.j, s.data.ticket, log, claim);
    assert.equal(foreign.status, 403);
    // a log for a different seed under a valid ticket
    const wrongSeed = advance(startGame(CFG, s.data.seed + 1), 600);
    const mismatch = await submit(C, A.j, s.data.ticket, logOf(wrongSeed), claimOf(wrongSeed));
    assert.equal(mismatch.status, 422);
    assert.equal(mismatch.data.error, 'log_mismatch');
  });

  await test('a log longer than the wall clock allows is refused', async () => {
    const s = await start(C, A.j);
    const g = advance(startGame(CFG, s.data.seed), 24000, (x) => { if (x.activeWaves.length === 0) x.command('wave'); });
    assert.ok(g.tick > 21600, `idle game only reached tick ${g.tick}`);
    const sub = await submit(C, A.j, s.data.ticket, logOf(g), claimOf(g));
    assert.equal(sub.status, 422);
    assert.equal(sub.data.error, 'too_fast');
  });

  await test('submit validates content type, gzip and size', async () => {
    const s = await start(C, A.j);
    assert.equal((await C.api(A.j, 'POST', '/api/runs/submit', { body: {} })).status, 415);
    const notGzip = await C.api(A.j, 'POST', '/api/runs/submit', { raw: Buffer.from('plain text'), headers: { 'Content-Type': 'application/gzip' } });
    assert.equal(notGzip.status, 400);
    const huge = await C.api(A.j, 'POST', '/api/runs/submit', { raw: Buffer.alloc(600 * 1024, 7), headers: { 'Content-Type': 'application/gzip' } });
    assert.equal(huge.status, 413);
    const bomb = await C.api(A.j, 'POST', '/api/runs/submit', { raw: gzipSync(Buffer.alloc(9 * 1024 * 1024, 32)), headers: { 'Content-Type': 'application/gzip' } });
    assert.equal(bomb.status, 413);
    const noClaim = await C.api(A.j, 'POST', '/api/runs/submit', { raw: gzipSync(JSON.stringify({ ticket: s.data.ticket, log: {} })), headers: { 'Content-Type': 'application/gzip' } });
    assert.equal(noClaim.status, 400);
  });

  await test('a ticket from an older simulation build is kept as unverified history', async () => {
    const s = await start(C, A.j);
    const [body] = s.data.ticket.split('.');
    const payload = { ...JSON.parse(Buffer.from(body, 'base64url').toString()), build: 'oldbuild000' };
    const ticketKey = createHmac('sha256', SECRET).update('youtd:ticket').digest('base64url');
    const b = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const ticket = `${b}.${createHmac('sha256', ticketKey).update(b).digest('base64url')}`;
    const g = advance(startGame(CFG, s.data.seed), 900);
    const before = (await C.api(A.j, 'GET', '/api/profile')).data.profile;
    const sub = await submit(C, A.j, ticket, logOf(g, 'oldbuild000'), claimOf(g));
    assert.equal(sub.status, 200, JSON.stringify(sub.data));
    assert.equal(sub.data.status, 'unverified');
    const p = (await C.api(A.j, 'GET', '/api/profile')).data.profile;
    assert.equal(p.history.length, before.history.length + 1);
    assert.equal(p.history[p.history.length - 1].unverified, true);
    assert.equal(p.runs, before.runs);
    assert.deepEqual(p.totals, before.totals);
    assert.deepEqual(p.records, before.records);
  });

  // ---------------------------------------------------------------- profile edits
  await test('profile edits validate name, title and crest', async () => {
    const ok = await C.api(A.j, 'PUT', '/api/profile', { body: { name: 'Tower Master_1' } });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.user.name, 'Tower Master_1');
    for (const name of ['ab', 'x'.repeat(21), ' lead', 'bad<script>', 5]) {
      assert.equal((await C.api(A.j, 'PUT', '/api/profile', { body: { name } })).status, 400, `name ${name}`);
    }
    assert.equal((await C.api(A.j, 'PUT', '/api/profile', { body: { title: 'keeper' } })).status, 400);
    assert.equal((await C.api(A.j, 'PUT', '/api/profile', { body: { crest: 'nonsense' } })).status, 400);
    assert.equal((await C.api(A.j, 'PUT', '/api/profile', { body: { title: null } })).status, 200);
    assert.equal((await C.api(A.j, 'PUT', '/api/profile', { body: { evil: 1 } })).status, 400);
    const board = (await C.api(C.jar(), 'GET', '/api/leaderboard?key=easy/build/trial')).data;
    assert.equal(board.entries[0].name, 'Tower Master_1');
  });

  // ---------------------------------------------------------------- weekly
  await test('weekly runs share one seed and rank on the weekly board', async () => {
    const B = await newGuest(C);
    const a = await start(C, A.j, { weekly: true });
    const b = await start(C, B.j, { weekly: true });
    assert.equal(a.status, 200);
    assert.equal(a.data.seed, b.data.seed);
    assert.deepEqual(a.data.cfg, b.data.cfg);
    const info = (await C.api(C.jar(), 'GET', '/api/leaderboard/weekly')).data;
    assert.match(info.week, /^\d{4}-W\d{2}$/);
    assert.deepEqual(info.cfg, a.data.cfg);
    assert.ok(info.endsAt > Date.now());
    const g = advance(startGame(a.data.cfg, a.data.seed), 2400);
    const sub = await submit(C, A.j, a.data.ticket, logOf(g), claimOf(g));
    assert.equal(sub.status, 200, JSON.stringify(sub.data));
    assert.equal((await waitRun(C, A.j, a.data.runId, ['verified', 'rejected'])).status, 'verified');
    const copy = await submit(C, B.j, b.data.ticket, logOf(g), claimOf(g));
    assert.equal(copy.status, 409, 'a copied weekly log is refused');
    assert.equal(copy.data.error, 'duplicate_log');
    // A retimed copy replays fine and counts for the copier's profile, but it ends with
    // the same towers, so its board entry stays hidden.
    const g2 = retimed(logOf(g), a.data.cfg, a.data.seed, 7);
    assert.notDeepEqual(logOf(g2).cmds, logOf(g).cmds);
    assert.ok(g.towers.size > 0, 'the weekly bot builds towers');
    assert.equal(towerLayout(g2), towerLayout(g));
    const sub2 = await submit(C, B.j, b.data.ticket, logOf(g2), claimOf(g2));
    assert.equal(sub2.status, 200, JSON.stringify(sub2.data));
    assert.equal((await waitRun(C, B.j, b.data.runId, ['verified', 'rejected'])).status, 'verified');
    const after = (await C.api(C.jar(), 'GET', '/api/leaderboard/weekly')).data;
    assert.equal(after.entries.length, 1);
    assert.equal(after.entries[0].name, (await C.api(A.j, 'GET', '/api/me')).data.user.name);
    const named = (await C.api(C.jar(), 'GET', `/api/leaderboard?key=weekly:${info.week}`)).data;
    assert.equal(named.entries.length, 1);
    assert.equal((await C.api(C.jar(), 'GET', '/api/leaderboard?key=a%20b')).status, 400);
  });

  // ---------------------------------------------------------------- email magic link
  let deviceLink;
  await test('email magic link upgrades the guest; the link works once', async () => {
    const r = await C.api(A.j, 'POST', '/api/auth/email', { body: { email: 'Player.One@Example.com' } });
    assert.equal(r.status, 200);
    assert.equal(r.data.ok, true);
    assert.match(r.data.link, /\/api\/auth\/email\/verify#token=/);
    const path = new URL(r.data.link).pathname; // the fragment never leaves the browser
    const page = await C.api(C.jar(), 'GET', path);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
    assert.match(page.data, /<button id="go"/);
    assert.match(page.headers.get('content-security-policy'), /nonce-/);
    const again = await C.api(C.jar(), 'GET', path); // a mail scanner prefetching must not burn it
    assert.equal(again.status, 200);
    const token = tokenOf(r.data.link);
    assert.equal(page.data.includes(tokenOf(r.data.link)), false, 'the page never contains the token');
    const peek = await C.api(C.jar(), 'POST', '/api/auth/email/peek', { body: { token: tokenOf(r.data.link) } });
    assert.equal(peek.status, 200);
    assert.equal(peek.data.email, 'pl***@example.com');
    assert.equal((await C.api(C.jar(), 'POST', '/api/auth/email/peek', { body: { token: 'y'.repeat(40) } })).status, 400);
    const oldSid = A.j.sid;
    const v = await C.api(A.j, 'POST', '/api/auth/email/verify', { body: { token } });
    assert.equal(v.status, 200);
    assert.notEqual(A.j.sid, oldSid, 'session rotated');
    const me = (await C.api(A.j, 'GET', '/api/me')).data.user;
    assert.equal(me.id, A.user.id, 'same account as the guest');
    assert.equal(me.guest, false);
    assert.equal(me.email, 'player.one@example.com');
    assert.equal((await C.api({ sid: oldSid }, 'GET', '/api/me')).data.user, null, 'old session is gone');
    const reuse = await C.api(C.jar(), 'POST', '/api/auth/email/verify', { body: { token } });
    assert.equal(reuse.status, 400);
    assert.equal((await C.api(C.jar(), 'POST', '/api/auth/email/verify', { body: { token: 'x'.repeat(40) } })).status, 400);
  });

  await test('a link requested by one guest never upgrades that guest from another browser', async () => {
    const attacker = await newGuest(C);
    const r = await C.api(attacker.j, 'POST', '/api/auth/email', { body: { email: 'victim@example.com' } });
    const token = tokenOf(r.data.link);
    const victim = C.jar(); // the victim opens the link in their own browser, with no session
    assert.equal((await C.api(victim, 'POST', '/api/auth/email/verify', { body: { token } })).status, 200);
    const vme = (await C.api(victim, 'GET', '/api/me')).data.user;
    assert.notEqual(vme.id, attacker.user.id, 'victim gets their own account');
    assert.equal(vme.email, 'victim@example.com');
    const ame = (await C.api(attacker.j, 'GET', '/api/me')).data.user;
    assert.equal(ame.guest, true, 'the requesting guest stays a guest');
    assert.equal(ame.email, null);
  });

  await test('the same address signs in on a second device with the same progress', async () => {
    const D = C.jar();
    const r = await C.api(D, 'POST', '/api/auth/email', { body: { email: 'player.one@example.com' } });
    deviceLink = r.data.link;
    const token = tokenOf(deviceLink);
    assert.equal((await C.api(D, 'POST', '/api/auth/email/verify', { body: { token } })).status, 200);
    const me = (await C.api(D, 'GET', '/api/me')).data.user;
    assert.equal(me.id, A.user.id);
    const p = (await C.api(D, 'GET', '/api/profile')).data.profile;
    assert.equal(p.runs, (await C.api(A.j, 'GET', '/api/profile')).data.profile.runs);
    assert.ok(p.runs >= 1);
    A.second = D;
  });

  await test('sessions list and revoke', async () => {
    const list = (await C.api(A.j, 'GET', '/api/sessions')).data.sessions;
    assert.equal(list.length, 2);
    assert.equal(list.filter((s) => s.current).length, 1);
    const other = list.find((s) => !s.current);
    assert.match(other.id, /^[0-9a-f]{12}$/);
    assert.equal((await C.api(A.j, 'DELETE', `/api/sessions/${other.id}`)).status, 200);
    assert.equal((await C.api(A.second, 'GET', '/api/me')).data.user, null);
    assert.equal((await C.api(A.j, 'DELETE', `/api/sessions/${other.id}`)).status, 404);
    assert.equal((await C.api(A.j, 'DELETE', '/api/sessions/zz')).status, 400);
  });

  await test('logout clears the session', async () => {
    const G = await newGuest(C);
    assert.equal((await C.api(G.j, 'POST', '/api/auth/logout')).status, 200);
    assert.equal(G.j.sid, undefined);
  });

  await test('the email sender builds a Brevo request', async () => {
    let seen;
    const fake = async (url, init) => { seen = { url, init }; return { ok: true, status: 201 }; };
    await sendMail({ BREVO_API_KEY: 'k-123', MAIL_FROM: 'no-reply@example.com', MAIL_FROM_NAME: 'Game' }, { to: 'a@example.com', subject: 's', html: '<p>h</p>', text: 't' }, fake);
    assert.equal(seen.url, 'https://api.brevo.com/v3/smtp/email');
    assert.equal(seen.init.method, 'POST');
    assert.equal(seen.init.headers['api-key'], 'k-123');
    const body = JSON.parse(seen.init.body);
    assert.deepEqual(body.to, [{ email: 'a@example.com' }]);
    assert.equal(body.sender.email, 'no-reply@example.com');
    await assert.rejects(sendMail({ BREVO_API_KEY: 'k' }, { to: 'a@example.com' }, async () => ({ ok: false, status: 401 })), /401/);
  });

  // ---------------------------------------------------------------- Google (mock token endpoint)
  await test('Google sign-in links the guest through PKCE and state', async () => {
    const G = await newGuest(C);
    const start1 = await C.api(G.j, 'GET', '/api/auth/google', { redirect: 'manual' });
    assert.equal(start1.status, 302);
    const loc = new URL(start1.headers.get('location'));
    assert.equal(loc.origin + loc.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.equal(loc.searchParams.get('client_id'), CLIENT_ID);
    assert.equal(loc.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(loc.searchParams.get('redirect_uri'), `${C.origin}/api/auth/google/callback`);
    assert.ok(G.j.oauth, 'signed state cookie set');
    const state = loc.searchParams.get('state');

    // wrong state is refused
    const badJ = { ...G.j };
    const bad = await C.api(badJ, 'GET', '/api/auth/google/callback?code=good-code&state=nope', { redirect: 'manual' });
    assert.equal(bad.headers.get('location'), '/?signin=error');
    // tampered cookie is refused
    const tamperJ = { ...G.j, oauth: `${G.j.oauth.slice(0, -3)}AAA` };
    assert.equal((await C.api(tamperJ, 'GET', `/api/auth/google/callback?code=good-code&state=${state}`, { redirect: 'manual' })).headers.get('location'), '/?signin=error');
    // bad code
    assert.equal((await C.api({ ...G.j }, 'GET', `/api/auth/google/callback?code=bad&state=${state}`, { redirect: 'manual' })).headers.get('location'), '/?signin=error');

    const oldSid = G.j.sid;
    const cb = await C.api(G.j, 'GET', `/api/auth/google/callback?code=good-code&state=${state}`, { redirect: 'manual' });
    assert.equal(cb.status, 302);
    assert.equal(cb.headers.get('location'), '/?signin=google');
    assert.notEqual(G.j.sid, oldSid);
    // PKCE: the verifier sent to the token endpoint hashes to the challenge
    const sent = google.state.last;
    assert.equal(createHash('sha256').update(sent.code_verifier).digest('base64url'), loc.searchParams.get('code_challenge'));
    assert.equal(sent.client_secret, 'test-google-secret');
    const me = (await C.api(G.j, 'GET', '/api/me')).data.user;
    assert.equal(me.id, G.user.id, 'guest account kept');
    assert.equal(me.guest, false);
    assert.equal(me.google, true);
    assert.equal(me.email, 'gee@example.com');
    assert.equal(me.named, false, 'an upgraded guest has not chosen a name yet');
    const kept = await C.api(G.j, 'PUT', '/api/profile', { body: { name: me.name } });
    assert.equal(kept.data.user.named, true, 'keeping the generated name counts as choosing it');
    assert.equal((await C.api(G.j, 'GET', '/api/me')).data.user.named, true);
    // signing in again from a fresh browser lands on the same account
    const H = C.jar();
    const s2 = await C.api(H, 'GET', '/api/auth/google', { redirect: 'manual' });
    const st2 = new URL(s2.headers.get('location')).searchParams.get('state');
    await C.api(H, 'GET', `/api/auth/google/callback?code=good-code&state=${st2}`, { redirect: 'manual' });
    assert.equal((await C.api(H, 'GET', '/api/me')).data.user.id, G.user.id);
  });

  await test('Google sign-in in a popup answers with a page that tells the game and closes', async () => {
    const N = C.jar();
    const s = await C.api(N, 'GET', '/api/auth/google?popup=1', { redirect: 'manual' });
    const state = new URL(s.headers.get('location')).searchParams.get('state');
    assert.ok(state.startsWith('p.'), 'popup flows are marked in the state');
    const cb = await C.api(N, 'GET', `/api/auth/google/callback?code=new-sub-code&state=${state}`, { redirect: 'manual' });
    assert.equal(cb.status, 200);
    assert.equal(cb.headers.get('location'), null);
    assert.match(cb.headers.get('content-type'), /text\/html/);
    assert.match(cb.headers.get('content-security-policy'), /script-src 'nonce-/);
    assert.ok(cb.data.includes("new BroadcastChannel('youtd-auth')") && cb.data.includes('result: "google"'));
    assert.ok(N.sid, 'session set by the popup');
    const me = (await C.api(N, 'GET', '/api/me')).data.user;
    assert.equal(me.email, 'new@example.com');
    assert.equal(me.guest, false);
    assert.equal(me.named, false, 'a new account is asked for a name');
    const named = await C.api(N, 'PUT', '/api/profile', { body: { name: 'New Hero' } });
    assert.equal(named.data.user.name, 'New Hero');
    assert.equal(named.data.user.named, true);
    // a refused popup sign-in also answers with the page, reporting the error
    const bad = await C.api(C.jar(), 'GET', '/api/auth/google/callback?code=good-code&state=p.nope', { redirect: 'manual' });
    assert.equal(bad.status, 200);
    assert.ok(bad.data.includes('result: "error"'));
  });

  await test('Google refuses an email that belongs to an account with another Google id', async () => {
    const H = C.jar();
    const s1 = await C.api(H, 'GET', '/api/auth/google', { redirect: 'manual' });
    const st = new URL(s1.headers.get('location')).searchParams.get('state');
    const cb = await C.api(H, 'GET', `/api/auth/google/callback?code=other-sub-code&state=${st}`, { redirect: 'manual' });
    assert.equal(cb.headers.get('location'), '/?signin=error');
    assert.equal(H.sid, undefined);
    assert.equal((await C.api(H, 'GET', '/api/me')).data.user, null);
  });

  await test('malformed percent-escapes in paths give a JSON error', async () => {
    const r = await C.api(C.jar(), 'GET', '/api/runs/%zz');
    assert.equal(r.status, 400);
    assert.equal(r.data.error, 'bad_path');
  });

  await test('board entries carry a stable tag that matches /api/me', async () => {
    const board = (await C.api(C.jar(), 'GET', '/api/leaderboard?key=easy/build/trial')).data;
    assert.match(board.entries[0].tag, /^[0-9a-f]{4}$/);
    const me = (await C.api(A.j, 'GET', '/api/me')).data.user;
    assert.equal(me.tag, board.entries[0].tag);
  });

  await test('a continued run keeps only its newest log version in R2', async () => {
    const get = (ver) => logAt(join(tmp, 'main'), `logs/${A.user.id}/${run1.runId}-${ver}.json.gz`);
    get(2);
    assert.throws(() => get(1), undefined, 'superseded version removed');
  });

  await test('claims must agree with how the log ends', async () => {
    const s = await start(C, A.j);
    const g = advance(startGame(CFG, s.data.seed), 600);
    const sub = await submit(C, A.j, s.data.ticket, logOf(g), { ...claimOf(g), outcome: 'won' });
    assert.equal(sub.status, 422);
    assert.equal(sub.data.error, 'bad_claim');
  });

  await test('an abandoned ticket counts as a run once it is old enough', async () => {
    const T = await newGuest(C);
    const s = await start(C, T.j);
    const sql = (q) => sqlAt(join(tmp, 'main'), q);
    sql(`UPDATE runs SET iat = ${Date.now() - 9 * 24 * 3600_000} WHERE id = '${s.data.runId}'`);
    assert.equal((await C.api(T.j, 'GET', '/api/profile')).data.profile.runs, 0);
    assert.equal((await fetch(`${C.base}/cdn-cgi/handler/scheduled?cron=*/15+*+*+*+*`)).status, 200);
    assert.equal((await C.api(T.j, 'GET', '/api/profile')).data.profile.runs, 1);
    assert.equal((await C.api(T.j, 'GET', `/api/runs/${s.data.runId}`)).status, 404);
  });

  // ---------------------------------------------------------------- export and delete
  await test('account export lists runs without logs; delete removes everything', async () => {
    const E = await newGuest(C);
    const s = await start(C, E.j);
    const g = advance(startGame(CFG, s.data.seed), 2400);
    assert.equal((await submit(C, E.j, s.data.ticket, logOf(g), claimOf(g))).status, 200);
    assert.equal((await waitRun(C, E.j, s.data.runId, ['verified', 'rejected'])).status, 'verified');
    const key = `logs/${E.user.id}/${s.data.runId}-1.json.gz`;
    logAt(join(tmp, 'main'), key); // throws when the log is missing

    const ex = await C.api(E.j, 'GET', '/api/account/export');
    assert.equal(ex.status, 200);
    assert.equal(ex.data.user.id, E.user.id);
    assert.equal(ex.data.runs.length, 1);
    assert.equal(ex.data.runs[0].status, 'verified');
    assert.ok(!JSON.stringify(ex.data).includes('"cmds"'), 'no logs in the export');
    assert.equal(ex.data.profile.runs, 1);
    const name = ex.data.user.name;

    assert.equal((await C.api(E.j, 'DELETE', '/api/account', { body: {} })).status, 400);
    assert.equal((await C.api(E.j, 'DELETE', '/api/account', { body: { confirm: 'DELETE' } })).status, 200);
    assert.equal((await C.api(E.j, 'GET', '/api/me')).data.user, null);
    const board = (await C.api(C.jar(), 'GET', '/api/leaderboard?key=easy/build/trial')).data;
    assert.ok(!board.entries.some((e) => e.name === name), 'board row removed');
    assert.throws(() => logAt(join(tmp, 'main'), key), undefined, 'log removed from storage');
  });

  // ---------------------------------------------------------------- rate limits (last: they use up per-address budgets)
  await test('email sign-in is rate limited per address', async () => {
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await C.api(C.jar(), 'POST', '/api/auth/email', { body: { email: 'limit@example.com' } })).status);
    assert.deepEqual(codes, [200, 200, 200, 429]);
    const r = await C.api(C.jar(), 'POST', '/api/auth/email', { body: { email: 'limit@example.com' } });
    assert.equal(r.data.error, 'rate_limited');
    assert.equal((await C.api(C.jar(), 'POST', '/api/auth/email', { body: { email: 'not-an-email' } })).status, 400);
  });

  await test('cron handler runs cleanly', async () => {
    const res = await fetch(`${C.base}/cdn-cgi/handler/scheduled?cron=*/15+*+*+*+*`);
    assert.equal(res.status, 200);
  });

  // ---------------------------------------------------------------- budget guard (own instance, tiny budget)
  const N = 3000;
  const sample = replayLog(logOf(advance(startGame(CFG, 1), N)), { build: SIM_BUILD });
  assert.ok(sample.ok && sample.work > N);
  const cost = runCost(sample.work);
  const budget = cost / 0.8; // one replay of N ticks lands at about 80% of the budget
  await test('budget modes switch at 70% and 90%', () => {
    assert.equal(budgetMode(69, 100), 'all');
    assert.equal(budgetMode(70, 100), 'important');
    assert.equal(budgetMode(89.9, 100), 'important');
    assert.equal(budgetMode(90, 100), 'paused');
  });

  await test('an idle log is charged for the work it takes, not its length', () => {
    const idle = new Game({ ...CFG, players: 1, seed: 1, god: false, autoWave: false, autoTransmute: [] });
    for (let i = 0; i < 24000; i++) idle.step();
    const r = replayLog(logOf(idle), { build: SIM_BUILD });
    assert.ok(r.ok, r.error);
    assert.ok(r.work >= 24000, `work ${r.work}`);
    assert.ok(workCost(r.work) < 40, `idle charge ${workCost(r.work)} ms`);
    assert.ok(workCost(r.work) < 24000 * 0.02 / 4, 'far below a per-tick charge');
  });

  const second = startServer({
    port: 8788, persist: join(tmp, 'budget'),
    vars: { TICKET_SECRET: SECRET, DEV_MAIL_ECHO: 1, APP_ORIGIN: 'http://localhost:8788', CPU_BUDGET_MS: budget, EMAIL_DAILY_CAP: 10, USER_SHARE: 1, IP_SHARE: 1 },
  });
  children.push(second);
  const B = client('http://localhost:8788');
  await waitReady(B.base, second);
  console.log(`${SERVER} server ready on ${B.base} (pid ${second.pid}), budget ${budget.toFixed(1)} ms`);

  await test('tight budget verifies only important runs, then defers', async () => {
    const P = await newGuest(B);
    const mode = async () => (await B.api(P.j, 'GET', '/api/me')).data.verify;
    assert.equal(await mode(), 'all');
    const play1 = async (claimOverride, ticks) => {
      const s = await start(B, P.j);
      const g = advance(startGame(CFG, s.data.seed), ticks);
      const claim = { ...claimOf(g), ...claimOverride };
      return { s, sub: await submit(B, P.j, s.data.ticket, logOf(g), claim) };
    };
    const r1 = await play1({}, N);
    assert.equal(r1.sub.data.status, 'queued');
    assert.equal((await waitRun(B, P.j, r1.s.data.runId, ['verified', 'rejected'])).status, 'verified');
    assert.equal(await mode(), 'important');

    const before = (await B.api(P.j, 'GET', '/api/profile')).data.profile;
    const r2 = await play1({ outcome: 'running', score: 0 }, 600);
    assert.equal(r2.sub.data.status, 'unverified', 'unimportant run is not replayed');
    const mid = (await B.api(P.j, 'GET', '/api/profile')).data.profile;
    assert.equal(mid.history.length, before.history.length + 1);
    assert.equal(mid.history[mid.history.length - 1].unverified, true);
    assert.equal(mid.runs, before.runs);
    assert.deepEqual(mid.totals, before.totals);

    const r3 = await play1({ score: 999999 }, N);
    assert.equal(r3.sub.data.status, 'queued', 'a claimed record is still replayed');
    assert.equal((await waitRun(B, P.j, r3.s.data.runId, ['verified', 'rejected'])).status, 'verified');
    assert.equal(await mode(), 'paused');

    const r4 = await play1({}, 600);
    assert.equal(r4.sub.data.status, 'deferred');
    const p = (await B.api(P.j, 'GET', '/api/profile')).data;
    assert.ok(p.pending.some((x) => x.runId === r4.s.data.runId && x.status === 'deferred'));
    const cron = await fetch(`${B.base}/cdn-cgi/handler/scheduled?cron=*/15+*+*+*+*`);
    assert.equal(cron.status, 200);
    assert.equal((await B.api(P.j, 'GET', `/api/runs/${r4.s.data.runId}`)).data.status, 'deferred', 'still deferred while paused');
  });

  await test('board reads are served from the Cache API', async () => {
    const a = await B.api(B.jar(), 'GET', '/api/leaderboard/weekly');
    const b = await B.api(B.jar(), 'GET', '/api/leaderboard/weekly');
    assert.equal(a.headers.get('x-board-cache'), 'miss');
    assert.equal(b.headers.get('x-board-cache'), 'hit');
    assert.deepEqual(a.data, b.data);
  });

  await test('email sign-in pauses at 90% of the daily cap', async () => {
    const sent = [];
    for (let i = 0; i < 10; i++) sent.push(await B.api(B.jar(), 'POST', '/api/auth/email', { body: { email: `user${i}@example.com` } }));
    assert.deepEqual(sent.map((r) => r.status), [200, 200, 200, 200, 200, 200, 200, 200, 200, 503]);
    assert.equal(sent[9].data.error, 'email_paused');
  });

  // ---------------------------------------------------------------- per-user share (own instance)
  const third = startServer({
    port: 8789, persist: join(tmp, 'share'),
    vars: { TICKET_SECRET: SECRET, APP_ORIGIN: 'http://localhost:8789', CPU_BUDGET_MS: cost * 10, USER_SHARE: 0.25, IP_SHARE: 1, BOARD_CACHE_SECONDS: 0 },
  });
  children.push(third);
  const S3 = client('http://localhost:8789');
  await waitReady(S3.base, third);
  console.log(`${SERVER} server ready on ${S3.base} (pid ${third.pid}), budget ${(cost * 10).toFixed(0)} ms, user share 25%`);

  await test('a user past their monthly share keeps runs as unverified history', async () => {
    const P = await newGuest(S3);
    const statuses = [];
    for (let i = 0; i < 6; i++) {
      const s = await start(S3, P.j);
      const g = advance(startGame(CFG, s.data.seed), N);
      const sub = await submit(S3, P.j, s.data.ticket, logOf(g), claimOf(g));
      assert.equal(sub.status, 200, JSON.stringify(sub.data));
      statuses.push(sub.data.status);
      if (sub.data.status === 'queued') await waitRun(S3, P.j, s.data.runId, ['verified', 'rejected']);
      else break;
    }
    assert.equal(statuses[0], 'queued');
    assert.equal(statuses[statuses.length - 1], 'unverified', statuses.join(','));
    assert.equal((await S3.api(P.j, 'GET', '/api/me')).data.verify, 'all', 'the global budget is fine');
    const p = (await S3.api(P.j, 'GET', '/api/profile')).data.profile;
    assert.equal(p.history[p.history.length - 1].unverified, true);
    assert.equal(p.runs, statuses.length - 1);
  });
} catch (err) {
  failed = true;
  console.error('test run aborted:', err.stack || err.message);
} finally {
  await cleanup();
}

console.log(`\n${results.filter((r) => r.startsWith('ok')).length}/${results.length} passed`);
process.exit(failed ? 1 : 0);
