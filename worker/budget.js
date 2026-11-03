// Monthly CPU budget guard. Workers clocks do not advance during pure computation, so
// the CPU a replay used is estimated from the work it did: `replayLog` counts one unit
// per tick plus one per creep, tower and projectile updated in it.

import { recordKey } from '../src/meta/profile.js';

// Calibrated with tools/replay.js on three long bot logs (65, 79 and 97 waves): 318 to
// 345 ns per work unit on Node 25 / Apple silicon. Workers run slower and noisier than a
// laptop, so the charge uses about 3x: 1 us per unit. Charging by work instead of ticks
// matters: an idle log of 864k ticks replays in ~30 ms and is charged about that, while
// a busy log costs what it really takes.
export const WORK_COST_MS = 0.001;
// Charged when a replay attempt starts, so attempts killed by the CPU limit still count.
// It also covers the fixed cost of a verification: parse, gunzip, D1 and R2 round trips.
export const RUN_OVERHEAD_MS = 50;

export const IMPORTANT_AT = 0.7;
export const PAUSED_AT = 0.9;

// Monthly verification CPU one account, or one IP (IPv4 address or IPv6 /64), may use,
// as a fraction of CPU_BUDGET_MS. Beyond it runs are kept as unverified history.
export const DEFAULT_USER_SHARE = 0.02;
export const DEFAULT_IP_SHARE = 0.05;

export const workCost = (work) => work * WORK_COST_MS;
export const runCost = (work) => RUN_OVERHEAD_MS + workCost(work);

export function budgetMode(cpuMs, budgetMs) {
  const ratio = cpuMs / budgetMs;
  if (ratio >= PAUSED_AT) return 'paused';
  if (ratio >= IMPORTANT_AT) return 'important';
  return 'all';
}

const monthKey = (now = Date.now()) => new Date(now).toISOString().slice(0, 7);
const budgetOf = (env) => Number(env.CPU_BUDGET_MS) || 30_000_000;
const shareOf = (v, d) => (Number(v) > 0 ? Number(v) : d);

export async function getBudget(env, now = Date.now()) {
  const row = await env.DB.prepare('SELECT cpu_ms, verified FROM usage WHERE month = ?').bind(monthKey(now)).first();
  const cpu = row?.cpu_ms || 0;
  return { mode: budgetMode(cpu, budgetOf(env)), cpu, verified: row?.verified || 0, budget: budgetOf(env) };
}

// Has this user or IP used up its share of this month's verification budget?
export async function shareExceeded(env, userId, ipHash, now = Date.now()) {
  const { results } = await env.DB.prepare('SELECT k, cpu_ms FROM share WHERE month = ? AND k IN (?, ?)')
    .bind(monthKey(now), `u:${userId}`, `i:${ipHash}`).all();
  const spent = Object.fromEntries(results.map((r) => [r.k, r.cpu_ms]));
  const budget = budgetOf(env);
  return (spent[`u:${userId}`] || 0) >= budget * shareOf(env.USER_SHARE, DEFAULT_USER_SHARE)
    || (spent[`i:${ipHash}`] || 0) >= budget * shareOf(env.IP_SHARE, DEFAULT_IP_SHARE);
}

// Adds CPU to the month, the user's and the IP's shares and the run's own total. `count`
// marks the first charge of a replay attempt (one verified run per attempt).
export function chargeCpu(env, run, ms, { count = false, now = Date.now() } = {}) {
  const month = monthKey(now);
  const share = (k) => env.DB.prepare('INSERT INTO share (month, k, cpu_ms) VALUES (?, ?, ?) ON CONFLICT (month, k) DO UPDATE SET cpu_ms = cpu_ms + excluded.cpu_ms')
    .bind(month, k, ms);
  return env.DB.batch([
    env.DB.prepare('INSERT INTO usage (month, cpu_ms, verified) VALUES (?, ?, ?) ON CONFLICT (month) DO UPDATE SET cpu_ms = cpu_ms + excluded.cpu_ms, verified = verified + excluded.verified')
      .bind(month, ms, count ? 1 : 0),
    share(`u:${run.user_id}`),
    share(`i:${run.ip_key || 'none'}`),
    env.DB.prepare('UPDATE runs SET charged = charged + ? WHERE id = ?').bind(ms, run.id),
  ]);
}

// While the budget is tight, only runs that matter get replayed: a claimed victory,
// a weekly run, a score above the player's record or one that would enter the top 50.
export async function isImportant(env, { profile, cfg, boardKey, weekly, claim }) {
  if (weekly || claim.outcome === 'won') return true;
  const record = profile.records[recordKey(cfg)];
  if (claim.score > (record?.score || 0)) return true;
  const cut = await env.DB.prepare('SELECT score FROM board WHERE key = ? ORDER BY score DESC LIMIT 1 OFFSET 49').bind(boardKey).first();
  return claim.score > 0 && (!cut || claim.score > cut.score);
}
