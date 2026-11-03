// Verifier thread: takes one queued run at a time and hands it to the Worker's queue
// handler (worker/verify.js replays it). Replays take seconds of CPU, so they run here,
// off the thread that answers HTTP. The main thread posts 'wake' when it queues a run.

import { parentPort } from 'node:worker_threads';
import worker from '../worker/index.js';
import { createEnv, execContext } from './env.js';

const IDLE_POLL_MS = 1000;
const { env, queue } = createEnv();
let wake = null;
parentPort.on('message', (m) => { if (m === 'wake' && wake) { wake(); wake = null; } });
const idle = () => new Promise((resolve) => { wake = resolve; setTimeout(resolve, IDLE_POLL_MS); });

async function deliver(m) {
  let acked = false, retried = false;
  const msg = { id: String(m.id), body: m.body, attempts: m.attempts, timestamp: new Date(), ack: () => { acked = true; }, retry: () => { retried = true; } };
  const ctx = execContext();
  try {
    await worker.queue({ queue: 'youtd-verify', messages: [msg], ackAll: msg.ack, retryAll: msg.retry }, env, ctx);
    await ctx.settle();
  } catch (err) {
    console.error('queue handler threw:', err?.stack || err);
    retried = true;
  }
  // As on Cloudflare: an explicit ack wins; a retry or a throw re-delivers; otherwise done.
  if (acked || !retried) queue.ack(m.id);
  else if (!queue.retry(m)) console.error(`run ${m.body?.runId}: dropped after ${m.attempts} attempts`);
}

for (;;) {
  const m = queue.claim();
  if (m) await deliver(m);
  else await idle();
}
