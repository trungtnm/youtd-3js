// Request/response helpers: errors, JSON, cookies, security headers and the CSRF rule.

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

export const fail = (status, code, message) => { throw new HttpError(status, code, message); };

const BASE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
};

export function json(body, { status = 200, headers = {}, cache = 'no-store' } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache, ...BASE_HEADERS, ...headers },
  });
}

export function errorResponse(err) {
  if (err instanceof HttpError) return json({ error: err.code, message: err.message }, { status: err.status });
  // Never echo internals; log the message only (no request data).
  console.error('unhandled error:', err?.message || String(err));
  return json({ error: 'internal', message: 'Something went wrong.' }, { status: 500 });
}

export function html(body, { status = 200, headers = {} } = {}) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...BASE_HEADERS, ...headers },
  });
}

export function redirect(location, headers = {}) {
  return new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'no-store', ...BASE_HEADERS, ...headers } });
}

// ---------------------------------------------------------------- cookies

export function readCookie(req, name) {
  const header = req.headers.get('Cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

// Secure only over https: Safari rejects Secure cookies on http://localhost, and the
// production origin is always https.
export function cookie(env, name, value, { maxAge, path = '/' } = {}) {
  const secure = String(env.APP_ORIGIN || '').startsWith('https://') ? '; Secure' : '';
  return `${name}=${value}; HttpOnly; SameSite=Lax; Path=${path}; Max-Age=${maxAge}${secure}`;
}

export const clearCookie = (env, name, path = '/') => cookie(env, name, '', { maxAge: 0, path });

// ---------------------------------------------------------------- request guards

// Mutating requests need the custom header (a cross-site form cannot set it) and,
// when the browser sends an Origin, it must be ours.
export function checkCsrf(req, env) {
  if (req.method === 'GET' || req.method === 'HEAD') return;
  if (req.headers.get('X-YouTD') !== '1') fail(403, 'csrf', 'Missing X-YouTD header.');
  const origin = req.headers.get('Origin');
  if (origin !== null && origin !== env.APP_ORIGIN) fail(403, 'csrf', 'Origin not allowed.');
}

export const clientIp = (req) => req.headers.get('CF-Connecting-IP') || '0.0.0.0';

// Reads at most `limit` bytes of the body; 413 when the body is larger.
export async function readBody(req, limit) {
  const declared = Number(req.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > limit) fail(413, 'too_large', 'Request body too large.');
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) { await reader.cancel().catch(() => {}); fail(413, 'too_large', 'Request body too large.'); }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.byteLength; }
  return out;
}

export async function readJson(req, limit = 16 * 1024) {
  const bytes = await readBody(req, limit);
  if (!bytes.length) return {};
  try {
    const v = JSON.parse(new TextDecoder().decode(bytes));
    if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error('shape');
    return v;
  } catch { return fail(400, 'bad_json', 'Body must be a JSON object.'); }
}
