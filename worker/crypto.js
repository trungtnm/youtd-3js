// Web Crypto helpers: random ids, hashing, HMAC signing and base64url.

const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(str) {
  if (typeof str !== 'string' || !/^[A-Za-z0-9_-]*$/.test(str)) return null;
  const pad = '='.repeat((4 - (str.length % 4)) % 4);
  try {
    const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/') + pad);
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch { return null; }
}

export const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));
export const randomToken = (n = 32) => b64url(randomBytes(n));
export const randomId = () => randomToken(12);

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function sha256Hex(text) {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

export async function sha256Bytes(text) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

const hmacKey = (secret, usage) => crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);

export async function hmac(secret, text) {
  return new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret, 'sign'), enc.encode(text)));
}

// A key derived per purpose (tickets, OAuth cookie, weekly seeds), so a leak or misuse
// of one signature never helps forge another. Cached per isolate.
const subkeys = new Map();
export async function subkey(secret, purpose) {
  const id = `${purpose}:${secret}`;
  if (!subkeys.has(id)) subkeys.set(id, b64url(await hmac(secret, `youtd:${purpose}`)));
  return subkeys.get(id);
}

// Signed blob: base64url(JSON payload) + "." + base64url(HMAC-SHA256). Used for run
// tickets and the short-lived OAuth cookie.
export async function signBlob(secret, payload) {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  return `${body}.${b64url(await hmac(secret, body))}`;
}

// Returns the payload, or null when the signature or shape is wrong. Expiry is the caller's call.
export async function openBlob(secret, blob) {
  if (typeof blob !== 'string' || blob.length > 4096) return null;
  const [body, sig, extra] = blob.split('.');
  if (!body || !sig || extra !== undefined) return null;
  const sigBytes = fromB64url(sig);
  const bodyBytes = fromB64url(body);
  if (!sigBytes || !bodyBytes) return null;
  // subtle.verify compares in constant time
  if (!(await crypto.subtle.verify('HMAC', await hmacKey(secret, 'verify'), sigBytes, enc.encode(body)))) return null;
  try { return JSON.parse(dec.decode(bodyBytes)); } catch { return null; }
}
