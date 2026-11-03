// Thin client for the game's /api routes (see docs/online.md). Same-origin requests
// carry the session cookie; the X-YouTD header is what the server's CSRF check expects.

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

const TIMEOUT_MS = 8000;

export async function api(path, { method = 'GET', body, raw, contentType, timeout = TIMEOUT_MS } = {}) {
  const headers = { Accept: 'application/json' };
  if (method !== 'GET') headers['X-YouTD'] = '1';
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (raw !== undefined) headers['Content-Type'] = contentType;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method, headers, credentials: 'same-origin', signal: ctrl.signal,
      body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new ApiError(0, 'network', e.name === 'AbortError' ? 'The server did not answer in time.' : 'The server could not be reached.');
  } finally {
    clearTimeout(timer);
  }
  const type = res.headers.get('Content-Type') || '';
  const data = type.includes('application/json') ? await res.json().catch(() => null) : null;
  if (!res.ok) throw new ApiError(res.status, data?.error || `http_${res.status}`, data?.message);
  if (data === null) throw new ApiError(res.status, 'not_json', 'Unexpected response from the server.');
  return data;
}

// Gzip of a JSON value, for run uploads.
export async function gzipJson(value) {
  const stream = new Blob([JSON.stringify(value)]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(text) {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
