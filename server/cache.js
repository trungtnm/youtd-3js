// In-memory stand-in for the Workers Cache API (`caches.default`), used by the
// leaderboard routes for their 30 s cache. Honors max-age and keeps a bounded number of
// entries, since board keys come from the query string.

const MAX_ENTRIES = 500;

export function memoryCache() {
  const entries = new Map();
  const keyOf = (req) => (typeof req === 'string' ? req : req.url);
  return {
    async match(req) {
      const key = keyOf(req);
      const e = entries.get(key);
      if (!e) return undefined;
      if (e.expires <= Date.now()) { entries.delete(key); return undefined; }
      return new Response(e.body, { status: e.status, headers: e.headers });
    },
    async put(req, res) {
      const cc = res.headers.get('Cache-Control') || '';
      const maxAge = Number(/max-age=(\d+)/.exec(cc)?.[1]);
      if (!(maxAge > 0) || /no-store|private/.test(cc)) return;
      const key = keyOf(req);
      entries.delete(key);
      if (entries.size >= MAX_ENTRIES) entries.delete(entries.keys().next().value); // oldest first
      entries.set(key, { body: await res.arrayBuffer(), status: res.status, headers: [...res.headers], expires: Date.now() + maxAge * 1000 });
    },
    async delete(req) { return entries.delete(keyOf(req)); },
  };
}
