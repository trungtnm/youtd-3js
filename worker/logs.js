// Run log storage in R2 and the gzip plumbing around submissions.

import { fail } from './http.js';

export const MAX_COMPRESSED = 512 * 1024;
export const MAX_DECOMPRESSED = 8 * 1024 * 1024;

// One object per accepted submission, so a racing resubmission never overwrites the log
// a run row points at.
export const logKey = (userId, runId, ver) => `logs/${userId}/${runId}-${ver}.json.gz`;

async function collect(stream, limit, onOverflow) {
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) { await reader.cancel().catch(() => {}); return onOverflow(); }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.byteLength; }
  return out;
}

// Decompresses with a hard output cap, so a gzip bomb cannot exhaust memory.
export async function gunzip(bytes, limit = MAX_DECOMPRESSED) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  try {
    return await collect(stream, limit, () => fail(413, 'too_large', 'Log is too large once decompressed.'));
  } catch (err) {
    if (err?.status) throw err;
    return fail(400, 'bad_gzip', 'Body is not valid gzip.');
  }
}

export const gzip = (bytes) => collect(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip')), Infinity, () => null);

export async function storeLog(env, userId, runId, ver, log) {
  await env.LOGS.put(logKey(userId, runId, ver), await gzip(new TextEncoder().encode(JSON.stringify(log))), {
    httpMetadata: { contentType: 'application/gzip' },
  });
}

// The stored log, or null when it is missing.
export async function loadLog(env, userId, runId, ver) {
  const obj = await env.LOGS.get(logKey(userId, runId, ver));
  if (!obj) return null;
  try { return JSON.parse(new TextDecoder().decode(await gunzip(new Uint8Array(await obj.arrayBuffer())))); } catch { return null; }
}

// Deletes every stored log of a user (account deletion).
export async function deleteUserLogs(env, userId) {
  let cursor;
  do {
    const page = await env.LOGS.list({ prefix: `logs/${userId}/`, cursor, limit: 1000 });
    if (page.objects.length) await env.LOGS.delete(page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}
