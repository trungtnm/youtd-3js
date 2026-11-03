// The verifier: replays a stored log with the real simulation and folds the result into
// the player's profile and the boards. Runs in the queue consumer; the cron handler
// re-queues work the budget guard deferred.

import { replayLog } from '../src/sim/replay.js';
import { applyRun, newRunState, sanitize, HISTORY_MAX } from '../src/meta/profile.js';
import { SIM_BUILD } from '../src/sim/sim-build.js';
import { loadLog, logKey } from './logs.js';
import { commitRun } from './commit.js';
import { getBudget, chargeCpu, workCost, RUN_OVERHEAD_MS } from './budget.js';
import { profileOf } from './profile.js';
import { getUser } from './sessions.js';
import { pruneRates } from './limits.js';
import { sha256Hex } from './crypto.js';

const MAX_ATTEMPTS = 3;
const COMMIT_RETRIES = 5;
const QUEUED_STALE_MS = 15 * 60_000;
const REQUEUE_BATCH = 50;
// Logs of finished runs are kept this long. Rejected runs and runs holding a board
// entry keep theirs, for review of disputes and top scores.
const LOG_RETENTION_MS = 90 * 24 * 3600_000;
const PRUNE_BATCH = 200;

// History entry for a run that was not replayed, built from the client's claim and
// passed through the profile sanitizer. Null when the claim is not a valid entry.
export function unverifiedHistory(cfg, claim, now) {
  const entry = {
    at: now, cfg, outcome: claim.outcome === 'running' ? 'abandoned' : claim.outcome,
    wavesCleared: claim.wavesCleared, level: claim.level, score: claim.score, kills: claim.kills, time: claim.time,
    mvp: null, unverified: true,
  };
  return sanitize({ version: 1, history: [entry] })?.history[0] || null;
}

const publicResult = (sum, out) => ({
  outcome: sum.outcome, level: sum.level, wavesCleared: sum.wavesCleared, score: Math.floor(sum.score), kills: sum.kills,
  time: sum.time, newRecord: out.newRecord, earned: out.earned, unlocks: out.unlocks, continued: sum.continued,
});

const reject = (env, run, error, tick) => commitRun(env, { run, set: { status: 'rejected', error, err_tick: tick ?? null } });

// A log is written just after its row commits; within this window a missing log means
// "not there yet", later it means lost.
const LOG_GRACE_MS = 2 * 60_000;

export async function verifyRun(env, runId) {
  let run = await env.DB.prepare('SELECT * FROM runs WHERE id = ?').bind(runId).first();
  if (!run || run.status !== 'queued') return; // duplicate or stale message

  // A replay that keeps killing the isolate must not loop forever.
  const attempts = run.attempts + 1;
  await env.DB.prepare('UPDATE runs SET attempts = ? WHERE id = ?').bind(attempts, run.id).run();
  if (attempts > MAX_ATTEMPTS) return reject(env, run, 'verification kept failing', null);

  const log = await loadLog(env, run.user_id, run.id, run.log_ver);
  if (!log) {
    if (Date.now() - run.submitted_at < LOG_GRACE_MS) throw new Error('log not stored yet'); // queue retries
    return reject(env, run, 'log missing', null);
  }

  // Charged before the replay starts, so an attempt the CPU limit kills still counts. The
  // work-based part is charged once, right after the replay, never again on commit retries.
  await chargeCpu(env, run, RUN_OVERHEAD_MS, { count: true });
  let result;
  try {
    result = replayLog(log, { build: SIM_BUILD });
  } catch (err) {
    console.error('replay threw:', err?.message);
    return reject(env, run, 'replay failed', null);
  }
  await chargeCpu(env, run, workCost(result.work));

  if (!result.ok) {
    // The code moved on since the ticket was issued: nothing to blame on the player.
    if (result.error === 'different simulation build') return markUnverified(env, run);
    return reject(env, run, result.error, result.tick);
  }

  const sum = result.game.summary();
  const copy = run.weekly ? await weeklyCopy(env, run, result.game) : null;
  for (let i = 0; i < COMMIT_RETRIES; i++) {
    const user = await getUser(env, run.user_id);
    if (!user) return; // account deleted meanwhile
    const profile = profileOf(user);
    const runState = run.run_state ? JSON.parse(run.run_state) : newRunState();
    const now = Date.now();
    const out = applyRun(profile, sum, runState, now);
    const set = { status: 'verified', error: null, err_tick: null, result: JSON.stringify(publicResult(sum, out)), run_state: JSON.stringify(runState) };
    if (copy) set.layout_hash = copy.hash;
    // A run continued past victory keeps the board score it had at victory.
    const board = sum.continued ? null : { key: run.board_key, sum, now, hidden: copy?.note || null };
    if (await commitRun(env, { run, set, profile, rev: user.rev, board })) return;
    // A newer submission replaced this log and has its own queue message.
    const fresh = await env.DB.prepare('SELECT * FROM runs WHERE id = ?').bind(runId).first();
    if (!fresh || fresh.status !== 'queued' || fresh.log_ver !== run.log_ver) return;
    run = fresh;
  }
  throw new Error('profile kept changing'); // lets the queue retry
}

// Every player gets the same weekly seed, so another player's log, retimed or padded
// with commands that change nothing, replays fine under a second account. Such a copy
// still ends with the same towers on the same tiles. The run counts for the player's
// profile, but its board entry is hidden until the owner reviews it.
export function towerLayout(game) {
  return [...game.towers.values()].map((t) => `${t.def.id}@${t.c},${t.r}`).sort().join(';');
}

async function weeklyCopy(env, run, game) {
  const layout = towerLayout(game);
  if (!layout) return null;
  const hash = await sha256Hex(layout);
  const other = await env.DB.prepare(
    "SELECT id FROM runs WHERE board_key = ? AND layout_hash = ? AND user_id != ? AND status = 'verified' ORDER BY submitted_at LIMIT 1",
  ).bind(run.board_key, hash, run.user_id).first();
  return { hash, note: other ? `same final layout as run ${other.id}` : null };
}

async function markUnverified(env, run) {
  for (let i = 0; i < COMMIT_RETRIES; i++) {
    const user = await getUser(env, run.user_id);
    if (!user) return;
    const profile = profileOf(user);
    const entry = unverifiedHistory(JSON.parse(run.cfg), JSON.parse(run.claim), Date.now());
    if (entry) profile.history = [...profile.history, entry].slice(-HISTORY_MAX);
    const set = { status: 'unverified', run_state: JSON.stringify(newRunState()) };
    if (await commitRun(env, { run, set, profile, rev: user.rev })) return;
  }
  throw new Error('profile kept changing');
}

export async function handleQueue(batch, env) {
  for (const msg of batch.messages) {
    try {
      await verifyRun(env, msg.body.runId);
      msg.ack();
    } catch (err) {
      console.error('verify failed:', err?.message);
      msg.retry();
    }
  }
}

// ---------------------------------------------------------------- cron

// Tickets expire after 7 days; ones never submitted still count as runs, so shopping for a
// seed and walking away costs a run each time. Deleted per user in one batch that applies
// only if the profile is still at the revision we read (otherwise the next cron retries).
const TICKET_GRACE_MS = 8 * 24 * 3600_000;
const TICKET_CHUNK = 50; // D1 allows 100 bound values per statement

async function countAbandonedTickets(env, now) {
  const { results } = await env.DB.prepare("SELECT id, user_id FROM runs WHERE status = 'started' AND iat < ? ORDER BY user_id LIMIT 500")
    .bind(now - TICKET_GRACE_MS).all();
  const byUser = new Map();
  for (const r of results) byUser.set(r.user_id, [...(byUser.get(r.user_id) || []), r.id]);
  for (const [userId, all] of byUser) {
    const user = await getUser(env, userId);
    const ids = all.slice(0, TICKET_CHUNK);
    if (!user) { await env.DB.prepare(`DELETE FROM runs WHERE status = 'started' AND id IN (${ids.map(() => '?').join(',')})`).bind(...ids).run(); continue; }
    const profile = profileOf(user);
    profile.runs += ids.length;
    // Delete first, then bump the profile: both are conditioned on the same revision.
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM runs WHERE status = 'started' AND id IN (${ids.map(() => '?').join(',')}) AND (SELECT rev FROM users WHERE id = ?) = ?`)
        .bind(...ids, userId, user.rev),
      env.DB.prepare('UPDATE users SET profile = ?, rev = rev + 1 WHERE id = ? AND rev = ?').bind(JSON.stringify(profile), userId, user.rev),
    ]);
  }
}

export async function handleScheduled(env) {
  const now = Date.now();
  // Runs whose queue message was lost (send failed, or the consumer kept dying).
  const stale = await env.DB.prepare("SELECT id FROM runs WHERE status = 'queued' AND submitted_at < ? LIMIT ?")
    .bind(now - QUEUED_STALE_MS, REQUEUE_BATCH).all();
  for (const r of stale.results) await env.VERIFY.send({ runId: r.id });

  // Deferred runs wait for a month with room in the budget.
  const { mode } = await getBudget(env);
  if (mode === 'all') {
    const { results } = await env.DB.prepare("SELECT * FROM runs WHERE status = 'deferred' ORDER BY submitted_at LIMIT ?").bind(REQUEUE_BATCH).all();
    for (const run of results) {
      if (await commitRun(env, { run, set: { status: 'queued', submitted_at: now, attempts: 0 } })) await env.VERIFY.send({ runId: run.id });
    }
  }

  const old = await env.DB.prepare(
    `SELECT id, user_id, log_ver FROM runs r WHERE r.status IN ('verified', 'unverified') AND r.log_pruned = 0 AND r.submitted_at < ?
     AND NOT EXISTS (SELECT 1 FROM board b WHERE b.run_id = r.id) LIMIT ?`,
  ).bind(now - LOG_RETENTION_MS, PRUNE_BATCH).all();
  if (old.results.length) {
    await env.LOGS.delete(old.results.map((r) => logKey(r.user_id, r.id, r.log_ver)));
    await env.DB.batch(old.results.map((r) => env.DB.prepare('UPDATE runs SET log_pruned = 1 WHERE id = ?').bind(r.id)));
  }

  await countAbandonedTickets(env, now);

  // Housekeeping: expired rate windows, tokens, sessions and abandoned tickets.
  await pruneRates(env, now);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM login_tokens WHERE expires_at < ?').bind(now - 24 * 3600_000),
    env.DB.prepare('DELETE FROM sessions WHERE created_at < ?').bind(now - 31 * 24 * 3600_000),
    // Guests nobody can sign into any more (no session) and who never played online.
    env.DB.prepare(`DELETE FROM users WHERE guest = 1 AND created_at < ? AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = users.id)
      AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.user_id = users.id)`).bind(now - 24 * 3600_000),
    env.DB.prepare('DELETE FROM share WHERE month < ?').bind(new Date(now - 62 * 24 * 3600_000).toISOString().slice(0, 7)),
    env.DB.prepare('DELETE FROM usage_daily WHERE day < ?').bind(new Date(now - 7 * 24 * 3600_000).toISOString().slice(0, 10)),
  ]);
}
