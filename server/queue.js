// A durable work queue in its own SQLite file, standing in for the Cloudflare Queue
// `youtd-verify`. A claimed message is leased: if the process dies mid-replay the lease
// runs out and another verifier picks it up. Like the Cloudflare consumer settings
// (max_retries 3), a message is delivered at most four times, then dropped; the cron
// re-queues runs left in `queued` (worker/verify.js), so a dropped message is not lost work.

import { DatabaseSync } from 'node:sqlite';

const LEASE_MS = 5 * 60_000; // far above the longest replay
export const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 10_000;

export function openQueue(file) {
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 10000;
    CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY, body TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, visible_at INTEGER NOT NULL)`);
  const insert = db.prepare('INSERT INTO messages (body, visible_at) VALUES (?, ?)');
  const claim = db.prepare(`UPDATE messages SET attempts = attempts + 1, visible_at = ?
    WHERE id = (SELECT id FROM messages WHERE visible_at <= ? ORDER BY id LIMIT 1) RETURNING id, body, attempts`);
  const remove = db.prepare('DELETE FROM messages WHERE id = ?');
  const delay = db.prepare('UPDATE messages SET visible_at = ? WHERE id = ?');
  const count = db.prepare('SELECT COUNT(*) AS n FROM messages');

  return {
    send(body) { insert.run(JSON.stringify(body), Date.now()); },
    // The next visible message, leased to the caller, or null.
    claim() {
      const now = Date.now();
      const row = claim.get(now + LEASE_MS, now);
      return row ? { id: row.id, body: JSON.parse(row.body), attempts: row.attempts } : null;
    },
    ack(id) { remove.run(id); },
    retry(msg) {
      if (msg.attempts > MAX_RETRIES) { remove.run(msg.id); return false; }
      delay.run(Date.now() + RETRY_DELAY_MS * msg.attempts, msg.id);
      return true;
    },
    // At startup no verifier is running, so leases left by a previous process are stale.
    releaseAll() { db.exec(`UPDATE messages SET visible_at = 0 WHERE visible_at > 0`); },
    size: () => count.get().n,
    close: () => db.close(),
  };
}
