// Leaderboards (best verified run per user per board) and the weekly challenge.

import { json, fail } from './http.js';
import { hmac, subkey } from './crypto.js';
import { userTag } from './sessions.js';

const DAY = 86_400_000;
const TOP = 50;
const WEEKLY_DIFFICULTY = ['medium', 'hard', 'extreme'];

// ISO week (UTC): id "YYYY-Www", its number and the start of the next week.
export function weekOf(now = Date.now()) {
  const d = new Date(now);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - day * DAY;
  const thursday = new Date(monday + 3 * DAY);
  const year = thursday.getUTCFullYear();
  const number = Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / DAY / 7) + 1;
  return { id: `${year}-W${String(number).padStart(2, '0')}`, number, endsAt: monday + 7 * DAY };
}

export function weeklyCfg(week) {
  return {
    difficulty: WEEKLY_DIFFICULTY[week.number % WEEKLY_DIFFICULTY.length],
    mode: week.number % 2 ? 'random' : 'build',
    length: 'trial',
    modifiers: [],
  };
}

// Same seed for every player in a week; the HMAC keeps it unguessable ahead of time.
export async function weeklySeed(env, week) {
  const b = await hmac(await subkey(env.TICKET_SECRET, 'weekly'), `weekly:${week.id}`);
  return ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
}

export const weeklyKey = (week) => `weekly:${week.id}`;

export async function boardEntries(env, key) {
  const { results } = await env.DB.prepare(
    'SELECT b.user_id, u.name, b.score, b.level, b.waves, b.outcome, b.at FROM board b JOIN users u ON u.id = b.user_id WHERE b.key = ? AND b.hidden = 0 ORDER BY b.score DESC, b.at ASC LIMIT ?',
  ).bind(key, TOP).all();
  const tags = await Promise.all(results.map((r) => userTag(r.user_id)));
  return results.map((r, i) => ({ rank: i + 1, name: r.name, tag: tags[i], score: r.score, level: r.level, wavesCleared: r.waves, outcome: r.outcome, at: r.at }));
}

// Boards change only when a run is verified, so a short cache is safe. The Cache API
// keeps D1 reads flat under heavy polling; BOARD_CACHE_SECONDS=0 turns it off (tests).
async function cachedBoard(ctx, build) {
  const ttl = ctx.env.BOARD_CACHE_SECONDS === undefined ? 30 : Number(ctx.env.BOARD_CACHE_SECONDS);
  if (!(ttl > 0) || typeof caches === 'undefined') return json(await build(), { cache: 'no-store' });
  const key = new Request(ctx.url.toString());
  const hit = await caches.default.match(key);
  if (hit) { const res = new Response(hit.body, hit); res.headers.set('X-Board-Cache', 'hit'); return res; }
  const res = json(await build(), { cache: `public, max-age=${ttl}`, headers: { 'X-Board-Cache': 'miss' } });
  ctx.waitUntil(caches.default.put(key, res.clone()));
  return res;
}

export async function leaderboard(ctx) {
  const key = ctx.url.searchParams.get('key') || '';
  if (!/^[A-Za-z0-9/+,:_-]{1,100}$/.test(key)) fail(400, 'bad_key', 'Invalid board key.');
  return cachedBoard(ctx, async () => ({ key, entries: await boardEntries(ctx.env, key) }));
}

export async function weeklyBoard(ctx) {
  return cachedBoard(ctx, async () => {
    const week = weekOf();
    return { week: week.id, cfg: weeklyCfg(week), endsAt: week.endsAt, entries: await boardEntries(ctx.env, weeklyKey(week)) };
  });
}

// Statement that records a verified run on a board, keeping the user's best score. It
// only applies while `guard` (a SQL condition with its binds) holds, so it commits or
// not together with the profile write. A hidden entry stays hidden when a better run
// replaces it: only the owner unhides entries, after review.
export function boardStatement(env, { key, userId, runId, sum, now, hidden = null, guardSql, guardBinds }) {
  const outcome = sum.outcome === 'running' ? 'abandoned' : sum.outcome;
  return env.DB.prepare(
    `INSERT INTO board (key, user_id, score, level, waves, outcome, at, run_id, hidden, note)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guardSql}
     ON CONFLICT (key, user_id) DO UPDATE SET score = excluded.score, level = excluded.level, waves = excluded.waves,
       outcome = excluded.outcome, at = excluded.at, run_id = excluded.run_id,
       hidden = MAX(board.hidden, excluded.hidden), note = COALESCE(excluded.note, board.note) WHERE excluded.score > board.score`,
  ).bind(key, userId, Math.floor(sum.score), sum.level, sum.wavesCleared, outcome, now, runId, hidden ? 1 : 0, hidden, ...guardBinds);
}
