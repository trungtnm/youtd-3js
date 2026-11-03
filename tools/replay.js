// Replays a run log and reports whether it matches its checkpoints.
// Usage: node tools/replay.js run.json   (LOG=run.json node tools/balance.js writes one)

import { readFileSync } from 'node:fs';
import { replayLog } from '../src/sim/replay.js';

const file = process.argv[2];
if (!file) { console.error('usage: node tools/replay.js <log.json>'); process.exit(2); }
const log = JSON.parse(readFileSync(file, 'utf8'));
const t0 = performance.now();
const r = replayLog(log);
const ms = performance.now() - t0;
const sum = r.game?.summary();
console.log(`${r.ok ? 'OK' : `FAIL (${r.error})`} tick ${r.tick} in ${ms.toFixed(0)} ms (${(ms / Math.max(1, r.tick) * 1000).toFixed(1)} µs/tick, work ${r.work}, ${(ms / Math.max(1, r.work) * 1e6).toFixed(0)} ns/work)`
  + (sum ? ` outcome=${sum.outcome} wave=${sum.level} score=${sum.score} kills=${sum.kills}` : ''));
process.exit(r.ok ? 0 : 1);
