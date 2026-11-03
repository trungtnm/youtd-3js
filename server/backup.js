// Copies the database to DATA_DIR/backups/youtd-manual-<time>.sqlite (or the path given).
// Safe while the server runs. In the container: docker compose exec youtd node server/backup.js

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { dataDir } from './env.js';
import { backupTo, stamp } from './migrate.js';

const dir = join(dataDir(), 'backups');
mkdirSync(dir, { recursive: true });
const db = new DatabaseSync(join(dataDir(), 'youtd.sqlite'), { readOnly: true });
console.log(backupTo(db, process.argv[2] || join(dir, `youtd-manual-${stamp()}.sqlite`)));
db.close();
