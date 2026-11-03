// The subset of the Cloudflare D1 API that worker/ uses, on node:sqlite. D1 is SQLite,
// so the SQL runs unchanged; this only reproduces D1's result shapes and batch().
// node:sqlite is synchronous, so a statement or a whole batch never interleaves with
// other requests in the same thread; WAL and a busy timeout handle the verifier threads.

import { DatabaseSync } from 'node:sqlite';

// D1 stores booleans as 1/0 and rejects undefined; node:sqlite rejects both.
function param(v) {
  if (v === undefined) throw new TypeError('D1_TYPE_ERROR: undefined is not a valid bind value');
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  return v;
}

const plain = (row) => ({ ...row }); // node:sqlite rows have a null prototype

export function openD1(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 10000; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL;');
  const cache = new Map();
  const compiled = (sql) => {
    let s = cache.get(sql);
    if (!s) { s = db.prepare(sql); cache.set(sql, s); }
    return s;
  };
  const changes = () => db.prepare('SELECT changes() AS n').get().n;

  // Runs one statement and returns D1's { results, success, meta } shape.
  function execute(sql, params) {
    const s = compiled(sql);
    if (s.columns().length > 0) {
      const results = s.all(...params).map(plain);
      // changes() still holds the previous write after a plain SELECT; D1 reports 0 there.
      const wrote = !/^\s*(select|pragma)\b/i.test(sql);
      return { results, success: true, meta: { changes: wrote ? changes() : 0, rows_read: results.length } };
    }
    const r = s.run(...params);
    return { results: [], success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }

  class Statement {
    constructor(sql, params = []) { this.sql = sql; this.params = params; }
    bind(...values) { return new Statement(this.sql, values.map(param)); }
    async first(column) {
      const row = compiled(this.sql).get(...this.params);
      if (!row) return null;
      return column === undefined ? plain(row) : row[column];
    }
    async all() { return execute(this.sql, this.params); }
    async run() { return execute(this.sql, this.params); }
    async raw() {
      const s = compiled(this.sql);
      s.setReturnArrays(true);
      try { return s.all(...this.params); } finally { s.setReturnArrays(false); }
    }
  }

  return {
    prepare: (sql) => new Statement(sql),
    // D1 runs a batch as one transaction: all statements apply or none do.
    async batch(statements) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const out = statements.map((s) => execute(s.sql, s.params));
        db.exec('COMMIT');
        return out;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
    async exec(sql) { db.exec(sql); return { count: sql.split(';').filter((s) => s.trim()).length }; },
    sqlite: db,
    close: () => db.close(),
  };
}
