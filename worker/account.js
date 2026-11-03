// Account export and deletion.

import { json, fail, readJson } from './http.js';
import { userView, listSessions, sessionClearCookie } from './sessions.js';
import { profileOf } from './profile.js';
import { deleteUserLogs } from './logs.js';

const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

export async function exportAccount(ctx) {
  const { env, user, session } = ctx;
  const { results } = await env.DB.prepare(
    'SELECT id, status, cfg, seed, build, board_key, weekly, iat, claim, log_ticks, submitted_at, error, err_tick, result FROM runs WHERE user_id = ? ORDER BY iat DESC LIMIT 5000',
  ).bind(user.id).all();
  const runs = results.map((r) => ({
    id: r.id, status: r.status, cfg: parse(r.cfg), seed: r.seed, build: r.build, board: r.board_key, weekly: !!r.weekly, startedAt: r.iat,
    submittedAt: r.submitted_at, ticks: r.log_ticks, claim: parse(r.claim), error: r.error, errorTick: r.err_tick, result: parse(r.result),
  }));
  const body = { exportedAt: Date.now(), user: { ...userView(user), createdAt: user.created_at }, sessions: await listSessions(env, user.id, session.hash), runs, profile: profileOf(user) };
  return json(body, { headers: { 'Content-Disposition': 'attachment; filename="youtd-account.json"' } });
}

export async function deleteAccount(ctx) {
  const { env, user } = ctx;
  const body = await readJson(ctx.req);
  if (body.confirm !== 'DELETE') fail(400, 'confirm_required', 'Send { "confirm": "DELETE" } to delete the account.');
  await deleteUserLogs(env, user.id);
  const del = (sql, ...binds) => env.DB.prepare(sql).bind(...binds);
  await env.DB.batch([
    del('DELETE FROM board WHERE user_id = ?', user.id),
    del('DELETE FROM runs WHERE user_id = ?', user.id),
    del('DELETE FROM share WHERE k = ?', `u:${user.id}`),
    del('DELETE FROM sessions WHERE user_id = ?', user.id),
    del('DELETE FROM login_tokens WHERE email = ?', user.email ?? ''),
    del('DELETE FROM users WHERE id = ?', user.id),
  ]);
  const res = json({ ok: true });
  res.headers.append('Set-Cookie', sessionClearCookie(env));
  return res;
}
