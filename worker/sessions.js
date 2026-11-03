// Users and cookie sessions. The sid cookie holds 32 random bytes; D1 keeps only its hash.

import { emptyProfile } from '../src/meta/profile.js';
import { randomToken, randomId, sha256Hex } from './crypto.js';
import { cookie, clearCookie, readCookie, fail } from './http.js';

export const SESSION_MAX_AGE = 30 * 24 * 3600; // seconds, same as the cookie
const TOUCH_EVERY = 10 * 60_000;

// Short stable suffix that tells apart players who picked the same name.
export async function userTag(id) {
  return (await sha256Hex(`tag:${id}`)).slice(0, 4);
}

export const userView = (u) => ({ id: u.id, name: u.name, guest: !!u.guest, email: u.email || null, google: !!u.google_sub });

export async function createUser(env, { name, email = null, googleSub = null, guest }) {
  const id = randomId();
  const now = Date.now();
  const profile = emptyProfile();
  await env.DB.prepare('INSERT INTO users (id, name, guest, email, google_sub, profile, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, name || `Guest-${randomToken(3).replace(/[-_]/g, 'x')}`, guest ? 1 : 0, email, googleSub, JSON.stringify(profile), now).run();
  return getUser(env, id);
}

export const getUser = (env, id) => env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();

// Returns { user, session } for a valid cookie, else null.
export async function authenticate(env, req) {
  const sid = readCookie(req, 'sid');
  if (!sid || sid.length > 64) return null;
  const hash = await sha256Hex(sid);
  const now = Date.now();
  const s = await env.DB.prepare(
    'SELECT u.*, s.hash, s.created_at AS s_created, s.last_seen AS s_seen FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.hash = ? AND s.created_at > ?',
  ).bind(hash, now - SESSION_MAX_AGE * 1000).first();
  if (!s) return null;
  if (now - s.s_seen > TOUCH_EVERY) await env.DB.prepare('UPDATE sessions SET last_seen = ? WHERE hash = ?').bind(now, hash).run();
  return { user: s, session: { hash } };
}

// Issues a fresh session (rotating `replace`, the caller's old one, away) and returns the Set-Cookie value.
export async function startSession(env, req, userId, replace = null) {
  const sid = randomToken(32);
  const now = Date.now();
  const stmts = [env.DB.prepare('INSERT INTO sessions (hash, user_id, created_at, last_seen, agent) VALUES (?, ?, ?, ?, ?)')
    .bind(await sha256Hex(sid), userId, now, now, (req.headers.get('User-Agent') || '').slice(0, 120))];
  if (replace) stmts.push(env.DB.prepare('DELETE FROM sessions WHERE hash = ?').bind(replace.hash));
  await env.DB.batch(stmts);
  return cookie(env, 'sid', sid, { maxAge: SESSION_MAX_AGE });
}

export const dropSession = (env, hash) => env.DB.prepare('DELETE FROM sessions WHERE hash = ?').bind(hash).run();
export const sessionClearCookie = (env) => clearCookie(env, 'sid');

export async function listSessions(env, userId, currentHash) {
  const { results } = await env.DB.prepare('SELECT hash, created_at, last_seen, agent FROM sessions WHERE user_id = ? ORDER BY last_seen DESC LIMIT 50')
    .bind(userId).all();
  return results.map((s) => ({ id: s.hash.slice(0, 12), createdAt: s.created_at, lastSeen: s.last_seen, agent: s.agent, current: s.hash === currentHash }));
}

// Revokes one session by its short id. Returns the full hash that was removed, or null.
export async function revokeSession(env, userId, shortId) {
  if (!/^[0-9a-f]{12}$/.test(shortId)) fail(400, 'bad_id', 'Invalid session id.');
  const row = await env.DB.prepare('SELECT hash FROM sessions WHERE user_id = ? AND substr(hash, 1, 12) = ?').bind(userId, shortId).first();
  if (!row) return null;
  await dropSession(env, row.hash);
  return row.hash;
}
