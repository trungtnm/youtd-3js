// Serves the Vite build the way the Workers asset store did: headers from `_headers`,
// `/x` resolving to `x.html` or `x/index.html`, a plain 404 for missing files, ETags and
// byte ranges (the music player seeks with Range requests).

import { createReadStream, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { Readable } from 'node:stream';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.map': 'application/json', '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.ico': 'image/x-icon', '.ktx2': 'image/ktx2', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
  '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.woff2': 'font/woff2', '.woff': 'font/woff',
};

// `_headers`: blocks of a path pattern (`*` matches anything) followed by indented `Name: value` lines.
function parseHeaders(text) {
  const rules = [];
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      const re = new RegExp(`^${line.trim().split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
      rules.push({ re, headers: [] });
    } else if (rules.length) {
      const i = line.indexOf(':');
      if (i > 0) rules[rules.length - 1].headers.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]);
    }
  }
  return rules;
}

export function createAssets(dir) {
  let rules = [];
  try { rules = parseHeaders(readFileSync(join(dir, '_headers'), 'utf8')); } catch { /* no _headers file */ }
  const root = normalize(dir + sep);

  const fileAt = (rel) => {
    const p = normalize(join(dir, rel));
    if (!p.startsWith(root)) return null;
    try { const st = statSync(p); return st.isFile() ? { path: p, st } : null; } catch { return null; }
  };
  function resolve(pathname) {
    if (pathname === '/_headers' || pathname === '/_redirects') return null; // config files, never served
    if (pathname.endsWith('/')) return fileAt(`${pathname}index.html`);
    return fileAt(pathname) || fileAt(`${pathname}.html`) || fileAt(`${pathname}/index.html`);
  }

  return {
    async fetch(req) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
      let pathname;
      try { pathname = decodeURIComponent(new URL(req.url).pathname); } catch { return new Response('Bad request', { status: 400 }); }
      const headers = new Headers();
      for (const r of rules) if (r.re.test(pathname)) for (const [k, v] of r.headers) headers.set(k, v);
      const file = pathname.includes('\0') ? null : resolve(pathname);
      if (!file) {
        headers.set('Content-Type', 'text/plain; charset=utf-8');
        headers.set('Cache-Control', 'no-store');
        return new Response(req.method === 'HEAD' ? null : 'Not found', { status: 404, headers });
      }

      const { path, st } = file;
      const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
      headers.set('Content-Type', TYPES[extname(path).toLowerCase()] || 'application/octet-stream');
      headers.set('ETag', etag);
      headers.set('Accept-Ranges', 'bytes');
      if (!headers.has('Cache-Control')) headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
      if (req.headers.get('If-None-Match') === etag) return new Response(null, { status: 304, headers });

      let start = 0, end = st.size - 1, status = 200;
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('Range') || '');
      if (range && (range[1] || range[2])) {
        if (range[1]) { start = Number(range[1]); if (range[2]) end = Math.min(Number(range[2]), end); } else { start = Math.max(0, st.size - Number(range[2])); }
        if (start > end || start >= st.size) {
          headers.set('Content-Range', `bytes */${st.size}`);
          return new Response(null, { status: 416, headers });
        }
        status = 206;
        headers.set('Content-Range', `bytes ${start}-${end}/${st.size}`);
      }
      headers.set('Content-Length', String(end - start + 1));
      if (req.method === 'HEAD' || st.size === 0) return new Response(null, { status, headers });
      return new Response(Readable.toWeb(createReadStream(path, { start, end })), { status, headers });
    },
  };
}
