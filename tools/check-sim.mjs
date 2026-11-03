// Fails when simulation code uses something that can make a replay differ between
// machines: wall-clock time, unseeded randomness, engine-dependent math, or the DOM.
// Deterministic replacements live in src/sim/dmath.js. Also checks the build id.

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname;
const ALLOW = new Set(['src/sim/dmath.js']);
const RULES = [
  [/\bMath\.random\b/, 'Math.random (use game.rng)'],
  [/\b(Date\.now|new Date|performance\.now)\b/, 'wall-clock time'],
  [/\bMath\.(pow|exp|expm1|log|log2|log10|log1p|sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|asinh|acosh|atanh|hypot|cbrt)\b/, 'engine-dependent Math (use dmath.js)'],
  [/\*\*/, 'the ** operator (use sq or dpow from dmath.js)'],
  [/(?<![.\w$])(window|document|localStorage|setTimeout|setInterval|requestAnimationFrame)\b(?!\s*:)/, 'browser APIs'],
  [/from ['"]three['"]/, 'three.js'],
];

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? files(p) : e.name.endsWith('.js') ? [p] : [];
  });
}

let bad = 0;
for (const f of ['src/sim', 'src/data'].flatMap((d) => files(join(ROOT, d)))) {
  const rel = relative(ROOT, f);
  if (ALLOW.has(rel)) continue;
  readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '').replace(/'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"/g, "''");
    for (const [re, why] of RULES) if (re.test(code)) { console.error(`${rel}:${i + 1}: ${why}\n  ${line.trim()}`); bad++; }
  });
}
try { execFileSync('node', [join(ROOT, 'tools/sim-build.mjs'), '--check'], { stdio: 'inherit' }); } catch { bad++; }
if (bad) { console.error(`${bad} problem(s)`); process.exit(1); }
console.log('simulation code is deterministic');
