// Runs one SQL statement on the database and prints the rows (or the change count).
// In the container: docker compose exec youtd node server/sql.js "SELECT COUNT(*) FROM users"

import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { dataDir } from './env.js';

const sql = process.argv[2];
if (!sql) { console.error('usage: node server/sql.js "<SQL>"'); process.exit(2); }
const db = new DatabaseSync(join(dataDir(), 'youtd.sqlite'));
db.exec('PRAGMA busy_timeout = 10000');
const stmt = db.prepare(sql);
if (stmt.columns().length) console.table(stmt.all());
else console.log(`${stmt.run().changes} row(s) changed`);
db.close();
