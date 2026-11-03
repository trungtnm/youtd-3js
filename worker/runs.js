// Run tickets and submissions. A run starts with a server-signed ticket (seed, cfg,
// build) and ends with a gzip log that the verifier replays.

import { cleanCfg, checkLog } from '../src/sim/replay.js';
import { recordKey, newRunState } from '../src/meta/profile.js';
import { unlockedSet } from '../src/meta/achievements.js';
import { SIM_BUILD } from '../src/sim/sim-build.js';
import { json, fail, readJson, readBody } from './http.js';
import { signBlob, openBlob, randomId, randomBytes, subkey, sha256Hex } from './crypto.js';
import { hit, LIMITS, ipKey } from './limits.js';
import { weekOf, weeklyCfg, weeklySeed, weeklyKey } from './leaderboard.js';
import { getBudget, isImportant, shareExceeded } from './budget.js';
import { gunzip, storeLog, loadLog, logKey, MAX_COMPRESSED } from './logs.js';
import { profileOf } from './profile.js';
import { commitRun } from './commit.js';
import { unverifiedHistory } from './verify.js';

// Long enough for a paused session or a long offline run to still be uploaded.
const TICKET_TTL = 7 * 24 * 3600_000;
const SLACK_SEC = 120;   // wall-clock allowance on top of the 3x speed limit
const MAX_SPEED = 3;

const PUBLIC_STATUS = (r) => ({
  runId: r.id, status: r.status,
  ...(r.error ? { error: r.error, ...(r.err_tick !== null ? { tick: r.err_tick } : {}) } : {}),
  ...(r.result ? { result: JSON.parse(r.result) } : {}),
});

const modsEqual = (a, b) => a.length === b.length && a.every((m, i) => m === b[i]);

// ---------------------------------------------------------------- start

export async function startRun(ctx) {
  const { env, user } = ctx;
  const body = await readJson(ctx.req);
  await hit(env, 'start', user.id, LIMITS.start);

  const now = Date.now();
  let cfg, seed, boardKey;
  const weekly = body.weekly === true;
  if (weekly) {
    const week = weekOf(now);
    cfg = weeklyCfg(week);
    seed = await weeklySeed(env, week);
    boardKey = weeklyKey(week);
  } else {
    const raw = body.cfg;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(400, 'bad_cfg', 'cfg is required.');
    if (raw.god) fail(400, 'god_mode', 'God mode runs cannot be verified.');
    const clean = cleanCfg({ difficulty: raw.difficulty, mode: raw.mode, length: raw.length, modifiers: raw.modifiers, players: 1 });
    if (!clean) fail(400, 'bad_cfg', 'Unknown difficulty, mode, length or modifier.');
    cfg = { difficulty: clean.difficulty, mode: clean.mode, length: clean.length, modifiers: clean.modifiers };
    const unlocked = unlockedSet(profileOf(user)).modifiers;
    const locked = cfg.modifiers.filter((m) => !unlocked.has(m));
    if (locked.length) fail(403, 'modifier_locked', `Modifier not unlocked: ${locked.join(', ')}.`);
    seed = new DataView(randomBytes(4).buffer).getUint32(0);
    boardKey = recordKey(cfg);
  }

  const rid = randomId();
  const ticket = await signBlob(await subkey(env.TICKET_SECRET, 'ticket'), { rid, uid: user.id, seed, cfg, build: SIM_BUILD, weekly, iat: now, exp: now + TICKET_TTL });
  await env.DB.prepare(
    "INSERT INTO runs (id, user_id, status, cfg, seed, build, board_key, weekly, iat) VALUES (?, ?, 'started', ?, ?, ?, ?, ?, ?)",
  ).bind(rid, user.id, JSON.stringify(cfg), seed, SIM_BUILD, boardKey, weekly ? 1 : 0, now).run();
  return json({ runId: rid, ticket, seed, build: SIM_BUILD, cfg });
}

// ---------------------------------------------------------------- submit

const COUNT = (v) => Number.isFinite(v) && v >= 0 && v <= 1e12;

function cleanClaim(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) fail(400, 'bad_claim', 'claim is required.');
  const outcomes = ['won', 'lost', 'abandoned', 'running'];
  if (!outcomes.includes(c.outcome) || !['level', 'wavesCleared', 'score', 'kills', 'time'].every((k) => COUNT(c[k]))) {
    fail(400, 'bad_claim', 'claim must be { outcome, level, wavesCleared, score, kills, time }.');
  }
  return { outcome: c.outcome, level: Math.floor(c.level), wavesCleared: Math.floor(c.wavesCleared), score: Math.floor(c.score), kills: Math.floor(c.kills), time: c.time };
}

// What the client may claim for each way a log can end.
const PHASE_OUTCOME = { won: ['won'], lost: ['lost'], abandoned: ['abandoned'], prep: ['running'], running: ['running'] };

// Does `next` continue `prev` (same commands and checkpoints as a prefix)?
function extendsLog(prev, next) {
  if (next.end.tick < prev.end.tick || next.cmds.length < prev.cmds.length || next.hashes.length < prev.hashes.length) return false;
  for (let i = 0; i < prev.cmds.length; i++) if (JSON.stringify(prev.cmds[i]) !== JSON.stringify(next.cmds[i])) return false;
  return prev.hashes.every((h, i) => h[0] === next.hashes[i][0] && h[1] === next.hashes[i][1]);
}

export async function submitRun(ctx) {
  const { env, user, req } = ctx;
  if (!(req.headers.get('Content-Type') || '').startsWith('application/gzip')) fail(415, 'bad_type', 'Send the body as application/gzip.');
  await hit(env, 'submit', user.id, LIMITS.submit);

  const packed = await readBody(req, MAX_COMPRESSED);
  let body;
  try { body = JSON.parse(new TextDecoder().decode(await gunzip(packed))); } catch (err) {
    if (err?.status) throw err;
    fail(400, 'bad_json', 'Decompressed body is not JSON.');
  }
  if (!body || typeof body !== 'object' || typeof body.ticket !== 'string') fail(400, 'bad_body', 'Body must be { ticket, log, claim }.');

  // Ticket: signature, expiry, owner, and the run row it names.
  const t = await openBlob(await subkey(env.TICKET_SECRET, 'ticket'), body.ticket);
  const now = Date.now();
  if (!t || typeof t.rid !== 'string' || !t.cfg) fail(400, 'bad_ticket', 'Invalid ticket.');
  if (!(t.exp > now)) fail(400, 'ticket_expired', 'Ticket expired.');
  if (t.uid !== user.id) fail(403, 'bad_ticket', 'Ticket belongs to another account.');
  const run = await env.DB.prepare('SELECT * FROM runs WHERE id = ? AND user_id = ?').bind(t.rid, user.id).first();
  if (!run || run.seed !== t.seed || run.iat !== t.iat) fail(400, 'bad_ticket', 'Unknown ticket.');
  if (run.status === 'rejected') fail(409, 'run_rejected', 'This run was rejected.');
  if (run.status === 'unverified') fail(409, 'run_final', 'This run is already recorded as unverified.');

  const claim = cleanClaim(body.claim);
  const log = body.log;
  const bad = checkLog(log);
  if (bad) fail(422, 'invalid_log', bad);
  // The claim picks which runs get replayed while the budget is tight, so it must agree with the log.
  if (!PHASE_OUTCOME[log.end.phase].includes(claim.outcome)) fail(422, 'bad_claim', 'claim.outcome does not match the log.');

  // The log must be the run the ticket was issued for.
  const cfg = cleanCfg(log.cfg);
  if (log.seed !== t.seed || log.build !== t.build || cfg.players !== 1 || cfg.difficulty !== t.cfg.difficulty || cfg.mode !== t.cfg.mode
    || cfg.length !== t.cfg.length || !modsEqual(cfg.modifiers, [...t.cfg.modifiers].sort())) {
    fail(422, 'log_mismatch', 'Log does not match the ticket.');
  }
  // Speed hack check: game time cannot pass faster than 3x wall time.
  if (log.end.tick / 60 / MAX_SPEED > (now - t.iat) / 1000 + SLACK_SEC) fail(422, 'too_fast', 'Run finished faster than real time allows.');

  // A second submission for the same ticket has to continue the first.
  if (run.status !== 'started') {
    const prev = await loadLog(env, user.id, run.id, run.log_ver);
    if (!prev) fail(409, 'run_final', 'This run cannot be extended.');
    if (!extendsLog(prev, log)) fail(409, 'not_extension', 'A resubmitted log must continue the stored one.');
    if (log.end.tick === prev.end.tick && log.cmds.length === prev.cmds.length) return json({ runId: run.id, status: run.status });
  }

  // Weekly seeds are shared, so a log copied from another player's run is a valid log
  // for everyone. The same command list under two accounts is a copy.
  const cmdsHash = await sha256Hex(JSON.stringify(log.cmds));
  if (run.weekly) {
    const dup = await env.DB.prepare('SELECT 1 AS x FROM runs WHERE board_key = ? AND cmds_hash = ? AND user_id != ? LIMIT 1').bind(run.board_key, cmdsHash, user.id).first();
    if (dup) fail(409, 'duplicate_log', 'This log was already submitted by another player.');
  }

  // Decide whether this run gets replayed. A continued run was already accepted once, so
  // only the pause can hold it back.
  const profile = profileOf(user);
  const resubmitted = run.status !== 'started';
  if (resubmitted && t.build !== SIM_BUILD) fail(409, 'run_final', 'The simulation was updated; this run can no longer be extended.');
  const ipHash = (await sha256Hex(ipKey(ctx.ip))).slice(0, 16);
  let status = 'queued';
  if (t.build !== SIM_BUILD) {
    status = 'unverified'; // the replay code changed since the ticket: it cannot be checked
  } else {
    const { mode } = await getBudget(env);
    if (mode === 'paused') status = 'deferred';
    else if (mode === 'important' && !resubmitted
      && !(await isImportant(env, { profile, cfg: t.cfg, boardKey: run.board_key, weekly: !!run.weekly, claim }))) status = 'unverified';
    // One account or network cannot spend more than its share of the month's replay CPU.
    if (status === 'queued' && await shareExceeded(env, user.id, ipHash)) {
      if (resubmitted) fail(429, 'verify_share', 'Verification limit reached for this month; this run keeps its earlier result.');
      status = 'unverified';
    }
  }

  const set = { status, claim: JSON.stringify(claim), log_ticks: log.end.tick, submitted_at: now, attempts: 0, ip_key: ipHash, cmds_hash: cmdsHash };
  if (status === 'unverified') {
    const entry = unverifiedHistory(t.cfg, claim, now);
    if (entry) profile.history = [...profile.history, entry].slice(-25);
    set.run_state = JSON.stringify(newRunState());
    if (!(await commitRun(env, { run, set, profile, rev: user.rev }))) fail(409, 'conflict', 'Profile changed while saving. Submit again.');
    return json({ runId: run.id, status });
  }

  // Commit the row first (it only applies if nobody else changed the run), then write the
  // log it names. The verifier reads the version the row points at.
  const ver = run.log_ver + 1;
  if (!(await commitRun(env, { run, set: { ...set, log_ver: ver } }))) fail(409, 'conflict', 'Run changed while saving. Submit again.');
  try {
    await storeLog(env, user.id, run.id, ver, log);
  } catch (err) {
    console.error('log store failed:', err?.message);
    // Put the row back so it never names a log that does not exist.
    await commitRun(env, {
      run: { ...run, status, log_ver: ver },
      set: { status: run.status, log_ver: run.log_ver, log_ticks: run.log_ticks, submitted_at: run.submitted_at, attempts: run.attempts },
    });
    fail(503, 'storage_unavailable', 'Could not store the log. Try again.');
  }
  if (run.log_ver > 0) await env.LOGS.delete(logKey(user.id, run.id, run.log_ver)).catch(() => {});
  if (status === 'queued') await env.VERIFY.send({ runId: run.id });
  return json({ runId: run.id, status });
}

// ---------------------------------------------------------------- status

export async function getRun(ctx) {
  const row = await ctx.env.DB.prepare('SELECT * FROM runs WHERE id = ? AND user_id = ?').bind(ctx.params.id, ctx.user.id).first();
  if (!row) fail(404, 'not_found', 'Unknown run.');
  return json(PUBLIC_STATUS(row));
}
