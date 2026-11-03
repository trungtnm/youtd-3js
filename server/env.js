// Builds the `env` object worker/ expects: plain vars plus the DB, LOGS and VERIFY
// bindings. Defaults for vars come from wrangler.jsonc (one place for them); the process
// environment (.env in production, .dev.vars locally) overrides them.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openD1 } from './sqlite-d1.js';
import { openR2 } from './fs-r2.js';
import { openQueue } from './queue.js';

export const ROOT = new URL('..', import.meta.url).pathname;

// Strips // and /* */ comments outside strings, and trailing commas.
function parseJsonc(text) {
  let out = '', inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) { out += c; if (c === '\\') out += text[++i]; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && text[i + 1] === '*') { i = text.indexOf('*/', i + 2) + 1; continue; }
    out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

export const defaultVars = () => parseJsonc(readFileSync(join(ROOT, 'wrangler.jsonc'), 'utf8')).vars ?? {};

export const dataDir = () => process.env.DATA_DIR || join(ROOT, '.data');

// `notify` wakes the verifier threads after a message is queued.
export function createEnv({ notify = () => {} } = {}) {
  const dir = dataDir();
  const vars = { ...defaultVars() };
  for (const [k, v] of Object.entries(process.env)) if (/^[A-Z][A-Z0-9_]*$/.test(k)) vars[k] = v;
  const queue = openQueue(join(dir, 'queue.sqlite'));
  const env = {
    ...vars,
    DB: openD1(join(dir, 'youtd.sqlite')),
    LOGS: openR2(join(dir, 'logs')),
    VERIFY: {
      async send(body) { queue.send(body); notify(); },
      async sendBatch(messages) { for (const m of messages) queue.send(m.body); notify(); },
    },
  };
  return { env, queue };
}

// Collects ctx.waitUntil promises so callers can await them and errors get logged.
export function execContext() {
  const pending = [];
  return {
    waitUntil(p) { pending.push(Promise.resolve(p).catch((err) => console.error('waitUntil failed:', err?.stack || err))); },
    passThroughOnException() {},
    settle: () => Promise.all(pending),
  };
}
