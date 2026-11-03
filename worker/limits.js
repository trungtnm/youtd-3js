// Fixed-window rate limits kept in D1. Bucket names are hashed so addresses and
// emails are never stored in the table.

import { fail } from './http.js';
import { sha256Hex } from './crypto.js';

const HOUR = 3600_000;

// Identity of a client address for limits: the IPv4 address, or the /64 of an IPv6
// address (one subscriber usually holds a whole /64, so single addresses mean nothing).
export function ipKey(ip) {
  if (!ip.includes(':')) return ip;
  const [head, tail = ''] = ip.split('::');
  const a = head ? head.split(':') : [];
  const b = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...a, ...Array(Math.max(0, 8 - a.length - b.length)).fill('0'), ...b] : a;
  return `v6:${groups.slice(0, 4).map((g) => g.toLowerCase().replace(/^0+(?=.)/, '')).join(':')}`;
}

export const LIMITS = {
  email: 3,        // per address per hour
  emailIp: 10,     // per IP per hour
  start: 30,       // run starts per user per hour
  submit: 60,      // run submissions per user per hour
  guest: 20,       // guest accounts per IP per hour
  peek: 30,        // confirm-page lookups per IP per hour
};

// Counts one hit; throws 429 once `max` is exceeded within the current hour.
export async function hit(env, bucket, id, max, now = Date.now()) {
  const k = (await sha256Hex(`${bucket}:${id}`)).slice(0, 32);
  const w = Math.floor(now / HOUR);
  const row = await env.DB.prepare(
    'INSERT INTO rate (k, w, n) VALUES (?, ?, 1) ON CONFLICT (k, w) DO UPDATE SET n = n + 1 RETURNING n',
  ).bind(k, w).first();
  if (row.n > max) fail(429, 'rate_limited', 'Too many requests. Try again later.');
}

export async function pruneRates(env, now = Date.now()) {
  await env.DB.prepare('DELETE FROM rate WHERE w < ?').bind(Math.floor(now / HOUR) - 1).run();
}
