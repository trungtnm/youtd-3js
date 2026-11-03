// Applies migrations/*.sql in name order, tracked in `d1_migrations` like
// `wrangler d1 migrations apply`. A database that already has data is copied first
// (VACUUM INTO, a consistent snapshot even while other threads write).

import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z');

export function backupTo(db, file) {
  db.prepare('VACUUM INTO ?').run(file);
  return file;
}

export function migrate(db, dir, backupDir) {
  db.exec('CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  const done = new Set(db.prepare('SELECT name FROM d1_migrations').all().map((r) => r.name));
  const pending = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().filter((f) => !done.has(f));
  if (!pending.length) return { applied: [], backup: null };
  let backup = null;
  if (done.size) {
    mkdirSync(backupDir, { recursive: true });
    backup = backupTo(db, join(backupDir, `youtd-pre-${pending[0].replace(/\.sql$/, '')}-${stamp()}.sqlite`));
  }
  for (const f of pending) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(readFileSync(join(dir, f), 'utf8'));
      db.prepare('INSERT INTO d1_migrations (name) VALUES (?)').run(f);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`migration ${f} failed: ${err.message}`);
    }
  }
  return { applied: pending, backup };
}

export { stamp };
