// Cloudflare Worker entry: /api/* routes, the verify queue consumer and the cron handler.
// Everything else is served from the static asset store (the Vite build).

import { HttpError, fail, json, errorResponse, checkCsrf, clientIp } from './http.js';
import { authenticate, startSession, dropSession, listSessions, revokeSession, sessionClearCookie } from './sessions.js';
import * as auth from './auth.js';
import * as runs from './runs.js';
import { getProfile, putProfile } from './profile.js';
import { leaderboard, weeklyBoard } from './leaderboard.js';
import { exportAccount, deleteAccount } from './account.js';
import { handleQueue, handleScheduled } from './verify.js';

// [method, path pattern, handler, needs a signed-in user]
const ROUTES = [
  ['GET', '/api/me', async (c) => json(await auth.meBody(c.env, c.user)), false],
  ['GET', '/api/config', async (c) => json(publicConfig(c.env)), false],
  ['POST', '/api/auth/guest', auth.guest, false],
  ['GET', '/api/auth/google', auth.googleStart, false],
  ['GET', '/api/auth/google/callback', auth.googleCallback, false],
  ['POST', '/api/auth/email', auth.emailStart, false],
  ['GET', '/api/auth/email/verify', auth.emailConfirmPage, false],
  ['POST', '/api/auth/email/peek', auth.emailPeek, false],
  ['POST', '/api/auth/email/verify', auth.emailVerify, false],
  ['POST', '/api/auth/logout', auth.logout, false],
  ['GET', '/api/sessions', async (c) => json({ sessions: await listSessions(c.env, c.user.id, c.session.hash) }), true],
  ['DELETE', '/api/sessions/:id', revoke, true],
  ['GET', '/api/profile', getProfile, true],
  ['PUT', '/api/profile', putProfile, true],
  ['POST', '/api/runs/start', runs.startRun, true],
  ['POST', '/api/runs/submit', runs.submitRun, true],
  ['GET', '/api/runs/:id', runs.getRun, true],
  ['GET', '/api/leaderboard', leaderboard, false],
  ['GET', '/api/leaderboard/weekly', weeklyBoard, false],
  ['GET', '/api/account/export', exportAccount, true],
  ['DELETE', '/api/account', deleteAccount, true],
].map(([method, path, handler, needsUser]) => ({
  method, handler, needsUser,
  re: new RegExp(`^${path.replace(/:[a-z]+/g, '([^/]+)')}$`), names: [...path.matchAll(/:([a-z]+)/g)].map((m) => m[1]),
}));

// Settings the page shows that come from the server's environment.
const CONTACT_RE = /^[^\s@<>"'()]{1,64}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
function publicConfig(env) {
  const contact = typeof env.CONTACT_EMAIL === 'string' ? env.CONTACT_EMAIL.trim() : '';
  return { contact: CONTACT_RE.test(contact) && contact.length <= 254 ? contact : null };
}

async function revoke(ctx) {
  const hash = await revokeSession(ctx.env, ctx.user.id, ctx.params.id);
  if (!hash) fail(404, 'not_found', 'Unknown session.');
  const res = json({ ok: true });
  if (hash === ctx.session.hash) res.headers.append('Set-Cookie', sessionClearCookie(ctx.env));
  return res;
}

function match(method, pathname) {
  let pathMatched = false;
  for (const r of ROUTES) {
    const m = r.re.exec(pathname);
    if (!m) continue;
    pathMatched = true;
    if (r.method !== method) continue;
    try {
      return { route: r, params: Object.fromEntries(r.names.map((n, i) => [n, decodeURIComponent(m[i + 1])])) };
    } catch { return { badPath: true }; } // malformed percent-escape
  }
  return { pathMatched };
}

async function handleApi(req, env, exec) {
  const url = new URL(req.url);
  const hit = match(req.method, url.pathname);
  if (hit.badPath) return errorResponse(new HttpError(400, 'bad_path', 'Malformed path.'));
  if (!hit.route) {
    return hit.pathMatched ? errorResponse(new HttpError(405, 'method_not_allowed', 'Method not allowed.')) : errorResponse(new HttpError(404, 'not_found', 'No such endpoint.'));
  }
  try {
    for (const k of ['APP_ORIGIN', 'TICKET_SECRET']) if (!env[k]) throw new Error(`${k} is not configured`);
    checkCsrf(req, env);
    const found = await authenticate(env, req);
    const ctx = { req, env, url, waitUntil: exec.waitUntil.bind(exec), params: hit.params, ip: clientIp(req), user: found?.user ?? null, session: found?.session ?? null };
    if (hit.route.needsUser && !ctx.user) fail(401, 'unauthorized', 'Sign in first.');
    return await hit.route.handler(ctx);
  } catch (err) {
    return errorResponse(err);
  }
}

export default {
  async fetch(req, env, exec) {
    const { pathname } = new URL(req.url);
    if (pathname === '/api' || pathname.startsWith('/api/')) return handleApi(req, env, exec);
    return env.ASSETS.fetch(req);
  },
  queue: (batch, env) => handleQueue(batch, env),
  scheduled: (event, env, ctx) => { ctx.waitUntil(handleScheduled(env)); },
};
