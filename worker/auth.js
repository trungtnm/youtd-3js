// Sign-in: guest accounts, Google OAuth (code flow with PKCE) and email magic links.

import { randomToken, sha256Hex, sha256Bytes, b64url, fromB64url, signBlob, openBlob, subkey } from './crypto.js';
import { fail, json, html, redirect, readJson, readCookie, cookie, clearCookie } from './http.js';
import { createUser, getUser, startSession, userView, dropSession, sessionClearCookie, userTag } from './sessions.js';
import { hit, LIMITS, ipKey } from './limits.js';
import { emailsPaused, countEmail, sendMail, magicLinkMail } from './mail.js';
import { getBudget } from './budget.js';
import { SIM_BUILD } from '../src/sim/sim-build.js';

const TOKEN_TTL = 15 * 60_000;
const OAUTH_TTL = 10 * 60;
const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const EMAIL_RE = /^[^\s@<>"',;:\\]{1,64}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;

// The body of /api/me and /api/auth/guest.
export async function meBody(env, user) {
  if (!user) return { user: null };
  return { user: { ...userView(user), tag: await userTag(user.id) }, verify: (await getBudget(env)).mode, build: SIM_BUILD };
}

function withCookies(res, cookies) {
  for (const c of cookies) res.headers.append('Set-Cookie', c);
  return res;
}

// ---------------------------------------------------------------- guest

export async function guest(ctx) {
  if (ctx.user) return json(await meBody(ctx.env, ctx.user));
  await hit(ctx.env, 'guest', ipKey(ctx.ip), LIMITS.guest);
  const user = await createUser(ctx.env, { guest: true });
  const setCookie = await startSession(ctx.env, ctx.req, user.id);
  return withCookies(json(await meBody(ctx.env, user)), [setCookie]);
}

export async function logout(ctx) {
  if (ctx.session) await dropSession(ctx.env, ctx.session.hash);
  return withCookies(json({ ok: true }), [sessionClearCookie(ctx.env)]);
}

// ---------------------------------------------------------------- shared account resolution

// Signs the identity into an account: the existing one when the identity is known,
// otherwise the current guest is upgraded (progress kept), otherwise a new account.
// `identity` is { email?, googleSub? } with an already verified email.
async function resolveUser(env, identity, guestHint) {
  const { email = null, googleSub = null } = identity;
  const byKey = async (col, v) => (v ? env.DB.prepare(`SELECT * FROM users WHERE ${col} = ?`).bind(v).first() : null);
  let existing = await byKey('google_sub', googleSub);
  if (!existing) existing = await byKey('email', email);
  if (existing) {
    // An account tied to another Google id is not ours to sign into through a shared email.
    if (googleSub && existing.google_sub && existing.google_sub !== googleSub) return null;
    // A known email gaining a Google login joins the same account.
    if (googleSub && !existing.google_sub) await env.DB.prepare('UPDATE users SET google_sub = ? WHERE id = ?').bind(googleSub, existing.id).run();
    return getUser(env, existing.id);
  }
  if (guestHint && guestHint.guest && !guestHint.email && !guestHint.google_sub) {
    await env.DB.prepare('UPDATE users SET guest = 0, email = ?, google_sub = ? WHERE id = ?').bind(email, googleSub, guestHint.id).run();
    return getUser(env, guestHint.id);
  }
  return createUser(env, { name: `Player-${randomToken(3).replace(/[-_]/g, 'x')}`, email, googleSub, guest: false });
}

// ---------------------------------------------------------------- Google

export async function googleStart(ctx) {
  const { env } = ctx;
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return redirect('/?signin=error');
  const state = randomToken(24);
  const verifier = randomToken(32);
  const challenge = b64url(await sha256Bytes(verifier));
  const blob = await signBlob(await subkey(env.TICKET_SECRET, 'oauth'), { state, verifier, exp: Date.now() + OAUTH_TTL * 1000 });
  const url = new URL(GOOGLE_AUTH);
  url.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID, redirect_uri: `${env.APP_ORIGIN}/api/auth/google/callback`, response_type: 'code',
    scope: 'openid email', state, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account',
  }).toString();
  return redirect(url.toString(), { 'Set-Cookie': cookie(env, 'oauth', blob, { maxAge: OAUTH_TTL, path: '/api/auth/google' }) });
}

function idTokenClaims(idToken) {
  const part = typeof idToken === 'string' ? idToken.split('.')[1] : null;
  const bytes = part && fromB64url(part);
  if (!bytes) return null;
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { return null; }
}

export async function googleCallback(ctx) {
  const { env, req, url } = ctx;
  const clear = clearCookie(env, 'oauth', '/api/auth/google');
  const bad = () => withCookies(redirect('/?signin=error'), [clear]);
  try {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const saved = await openBlob(await subkey(env.TICKET_SECRET, 'oauth'), readCookie(req, 'oauth'));
    if (!code || !state || code.length > 2048 || !saved || saved.exp < Date.now() || saved.state !== state) return bad();

    // The id_token comes straight from Google over TLS in this exchange, so its claims
    // need no signature check.
    const res = await fetch(env.GOOGLE_TOKEN_URL || GOOGLE_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, grant_type: 'authorization_code',
        redirect_uri: `${env.APP_ORIGIN}/api/auth/google/callback`, code_verifier: saved.verifier,
      }),
    });
    if (!res.ok) { console.error('google token exchange failed:', res.status); return bad(); }
    const claims = idTokenClaims((await res.json()).id_token);
    const issuers = ['https://accounts.google.com', 'accounts.google.com'];
    if (!claims || !issuers.includes(claims.iss) || claims.aud !== env.GOOGLE_CLIENT_ID
      || !(claims.exp * 1000 > Date.now()) || typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 64) return bad();
    const email = claims.email_verified === true && typeof claims.email === 'string' && EMAIL_RE.test(claims.email) && claims.email.length <= 254
      ? claims.email.toLowerCase() : null;

    const user = await resolveUser(env, { email, googleSub: claims.sub }, ctx.user);
    if (!user) return bad();
    const setCookie = await startSession(env, req, user.id, ctx.session);
    return withCookies(redirect('/?signin=google'), [setCookie, clear]);
  } catch (err) {
    console.error('google callback failed:', err?.message);
    return bad();
  }
}

// ---------------------------------------------------------------- email magic link

export async function emailStart(ctx) {
  const { env } = ctx;
  const body = await readJson(ctx.req);
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (email.length > 254 || !EMAIL_RE.test(email)) fail(400, 'bad_email', 'Enter a valid email address.');
  await hit(env, 'email-ip', ipKey(ctx.ip), LIMITS.emailIp);
  await hit(env, 'email', email, LIMITS.email);
  if (await emailsPaused(env)) fail(503, 'email_paused', 'Email sign-in is paused for today. Try again tomorrow or use Google.');

  const token = randomToken(32);
  await env.DB.prepare('INSERT INTO login_tokens (hash, email, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256Hex(token), email, Date.now() + TOKEN_TTL).run();
  const link = `${env.APP_ORIGIN}/api/auth/email/verify#token=${token}`;
  await countEmail(env);
  if (env.DEV_MAIL_ECHO === '1') return json({ ok: true, link });
  try {
    await sendMail(env, { to: email, ...magicLinkMail(link) });
  } catch (err) {
    // The client still sees ok: a failure here must not reveal anything about the address.
    console.error('magic link mail failed:', err?.message);
  }
  return json({ ok: true });
}

// pl***@example.com: enough to recognise the account, not enough to harvest addresses.
const maskEmail = (e) => { const [l, d] = e.split('@'); return `${l.slice(0, 2)}***@${d}`; };

// The token lives in the URL fragment, which browsers never send to servers, so it stays out
// of access logs and Referer headers. The page reads it, clears it from the address bar,
// shows which account it signs into (peek) and signs in on a click, so mail scanners that
// prefetch the link cannot burn it.
export function emailConfirmPage() {
  const nonce = randomToken(12);
  const csp = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in to YouTD Reforged</title>
<style>body{font:16px system-ui,sans-serif;background:#10131a;color:#e8ecf4;display:grid;place-items:center;min-height:100vh;margin:0}
main{text-align:center;padding:2rem}button{font:inherit;padding:.7rem 1.6rem;border-radius:8px;border:0;background:#4f8cff;color:#fff;cursor:pointer}</style></head>
<body><main><h1>YouTD Reforged</h1><p id="msg" role="status">Checking your link...</p>
<button id="go" hidden>Sign in</button></main>
<script nonce="${nonce}">
const btn = document.getElementById('go'), msg = document.getElementById('msg');
const token = new URLSearchParams(location.hash.slice(1)).get('token');
history.replaceState(null, '', location.pathname);
const call = (path) => fetch('/api/auth/email/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-YouTD': '1' }, body: JSON.stringify({ token }) });
async function init() {
  if (!token) { msg.textContent = 'This sign-in link is not valid.'; return; }
  try {
    const r = await call('peek');
    if (!r.ok) { msg.textContent = 'This link has expired or was already used. Request a new one.'; return; }
    msg.textContent = 'Sign in as ' + (await r.json()).email + ' on this device?';
    btn.hidden = false;
  } catch { msg.textContent = 'Network error. Reload the page.'; }
}
btn.addEventListener('click', async () => {
  btn.disabled = true;
  try {
    const r = await call('verify');
    if (r.ok) { location.href = '/?signin=email'; return; }
    msg.textContent = 'This link has expired or was already used. Request a new one.';
  } catch { msg.textContent = 'Network error. Try again.'; }
  btn.disabled = false;
});
init();
</script></body></html>`;
  return html(page, { headers: { 'Content-Security-Policy': csp } });
}

// Which address a link belongs to, masked. Changes nothing, so the link survives it.
export async function emailPeek(ctx) {
  const { env } = ctx;
  const body = await readJson(ctx.req);
  if (typeof body.token !== 'string' || !TOKEN_RE.test(body.token)) fail(400, 'bad_token', 'Invalid sign-in link.');
  await hit(env, 'peek', ipKey(ctx.ip), LIMITS.peek);
  const row = await env.DB.prepare('SELECT email FROM login_tokens WHERE hash = ? AND used = 0 AND expires_at > ?')
    .bind(await sha256Hex(body.token), Date.now()).first();
  if (!row) fail(400, 'bad_token', 'This link has expired or was already used.');
  return json({ email: maskEmail(row.email) });
}

export async function emailVerify(ctx) {
  const { env } = ctx;
  const body = await readJson(ctx.req);
  if (typeof body.token !== 'string' || !TOKEN_RE.test(body.token)) fail(400, 'bad_token', 'Invalid sign-in link.');
  const hash = await sha256Hex(body.token);
  // Single use: only the request that flips `used` gets the row.
  const row = await env.DB.prepare('UPDATE login_tokens SET used = 1 WHERE hash = ? AND used = 0 AND expires_at > ? RETURNING email')
    .bind(hash, Date.now()).first();
  if (!row) fail(400, 'bad_token', 'This link has expired or was already used.');

  // Only the guest in the browser that opens the link is upgraded: upgrading whoever asked
  // for it would let anyone request a link for someone else's address.
  const user = await resolveUser(env, { email: row.email }, ctx.user);
  const setCookie = await startSession(env, ctx.req, user.id, ctx.session);
  return withCookies(json({ ok: true }), [setCookie]);
}
