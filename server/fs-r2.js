// The subset of the Cloudflare R2 bucket API that worker/ uses, on a directory.
// Keys map to paths under `root` (`logs/<user>/<run>-<n>.json.gz`); writes go to a
// temporary file first and are renamed into place, so a reader never sees half a log.

import { mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { randomBytes } from 'node:crypto';

export function openR2(root) {
  mkdirSync(root, { recursive: true });
  const pathOf = (key) => {
    if (typeof key !== 'string' || !key || key.startsWith('/') || key.split('/').some((p) => p === '' || p === '.' || p === '..')) {
      throw new TypeError(`invalid object key: ${key}`);
    }
    return join(root, ...key.split('/'));
  };
  const bytesOf = async (value) => {
    if (typeof value === 'string') return Buffer.from(value);
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return Buffer.from(value.buffer ?? value, value.byteOffset ?? 0, value.byteLength);
    return Buffer.from(await new Response(value).arrayBuffer()); // ReadableStream or Blob
  };
  // Every key under `dir`, sorted, as R2 lists them.
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return []; }
    return entries.flatMap((e) => {
      const p = join(dir, e.name);
      if (e.isDirectory()) return walk(p);
      return e.name.includes('.tmp-') ? [] : [relative(root, p).split(sep).join('/')];
    });
  };

  return {
    async put(key, value) {
      const file = pathOf(key);
      const bytes = await bytesOf(value);
      mkdirSync(dirname(file), { recursive: true });
      const tmp = `${file}.tmp-${randomBytes(4).toString('hex')}`;
      writeFileSync(tmp, bytes);
      renameSync(tmp, file);
      return { key, size: bytes.length };
    },
    async get(key) {
      let bytes;
      try { bytes = readFileSync(pathOf(key)); } catch (err) { if (err.code === 'ENOENT') return null; throw err; }
      const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      return {
        key, size: bytes.length,
        arrayBuffer: async () => buf,
        text: async () => bytes.toString('utf8'),
        get body() { return new Blob([bytes]).stream(); },
      };
    },
    async head(key) {
      try { return { key, size: statSync(pathOf(key)).size }; } catch { return null; }
    },
    async delete(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        try { unlinkSync(pathOf(key)); } catch (err) { if (err.code !== 'ENOENT') throw err; }
      }
    },
    async list({ prefix = '', cursor, limit = 1000 } = {}) {
      const base = prefix.includes('/') ? prefix.slice(0, prefix.lastIndexOf('/')) : '';
      const all = walk(base ? join(root, ...base.split('/')) : root).filter((k) => k.startsWith(prefix)).sort();
      const from = cursor ? all.findIndex((k) => k > cursor) : 0;
      const page = from < 0 ? [] : all.slice(from, from + limit);
      const truncated = from >= 0 && from + limit < all.length;
      return { objects: page.map((key) => ({ key })), truncated, cursor: truncated ? page[page.length - 1] : undefined };
    },
  };
}
