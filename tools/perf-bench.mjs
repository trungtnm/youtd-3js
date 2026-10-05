// Render benchmark: drives a local Google Chrome over the DevTools protocol against
// the running dev server, fills the field with towers and a large crowd, and prints
// per-frame cost (simulation, render, composer, HUD), draw calls and triangles for
// each quality preset. Start the dev server first (npm run dev).
//
//   MAP=sky TOWERS=25 CREEPS=150 QUALITY=low,medium,high THROTTLE=1 DPR=2 npm run bench
//
// THROTTLE slows the page's CPU (4 approximates a mid-range laptop). The numbers are
// CPU submission time; GPU time is not measured.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const env = process.env;
const URL_ = env.URL || 'http://localhost:5317/';
const MAP = env.MAP || 'sky';
const TOWERS = Number(env.TOWERS ?? 25);
const CREEPS = Number(env.CREEPS ?? 150);
const QUALITIES = (env.QUALITY || 'high,medium,low').split(',');
const THROTTLE = Number(env.THROTTLE || 1);
const DPR = Number(env.DPR || 2);
const SECONDS = Number(env.SECONDS || 4);
const CHROME = env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9300 + Math.floor(Math.random() * 500);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profileDir = mkdtempSync(join(tmpdir(), 'youtd-bench-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profileDir}`,
  '--window-size=1920,1080', '--enable-gpu', '--ignore-gpu-blocklist', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const quit = (code) => { chrome.kill(); try { rmSync(profileDir, { recursive: true, force: true }); } catch { /* best effort */ } process.exit(code); };
// Never leave a headless Chrome behind when a step throws.
process.on('uncaughtException', (e) => { console.error(e.message); quit(1); });
process.on('unhandledRejection', (e) => { console.error(e?.message || e); quit(1); });

let targets;
for (let i = 0; i < 50 && !targets; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); } catch { await sleep(200); }
}
if (!targets) { console.error('Chrome did not start (set CHROME to its binary).'); quit(1); }
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let nextId = 0;
const pending = new Map();
ws.addEventListener('message', (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
});
const send = (method, params = {}) => new Promise((r) => { const id = ++nextId; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
  return r.result?.result?.value;
};

await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: DPR, mobile: false });
const res = await send('Page.navigate', { url: URL_ });
if (res.result?.errorText) { console.error(`Cannot open ${URL_}: is the dev server running?`); quit(1); }
await sleep(3000);
// The map comes from saved settings, so store it and reload once.
await ev(`localStorage.setItem('youtd-reforged-settings', JSON.stringify({ ...JSON.parse(localStorage.getItem('youtd-reforged-settings') || '{}'), map: ${JSON.stringify(MAP)} }))`);
await send('Page.reload');
await sleep(4000);

const gpu = await ev(`(() => { const gl = window.__youtd.world.renderer.getContext(); const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; })()`);
await ev(`document.querySelector('#btn-start').click()`);
await sleep(2500);
const towers = await ev(`(async () => {
  const { game: g, world, hud } = window.__youtd;
  g.cfg.mode = 'sandbox'; g.gold = 1e9; g.tomes = 1e6; g.lives = 1e9;
  const { FAMILIES } = await import('/src/data/towers.js');
  const { COLS, ROWS, isBuildable } = await import('/src/sim/map-layout.js');
  const fams = Object.values(FAMILIES);
  let n = 0, fi = 0;
  for (let c = 0; c < COLS && n < ${TOWERS}; c += 2) for (let r = 0; r < ROWS && n < ${TOWERS}; r += 2) {
    if (isBuildable(c, r) && g.build(fams[fi++ % fams.length].tiers[0], c, r)) n++;
  }
  // Timers around each part of the frame; renderer.info summed across all passes.
  const P = window.__bench = { sim: 0, render: 0, composer: 0, hud: 0, frames: 0, calls: 0, tris: 0, creeps: 0 };
  const wrap = (obj, key, bucket) => { const f = obj[key].bind(obj); obj[key] = (...a) => { const t = performance.now(); const r = f(...a); P[bucket] += performance.now() - t; return r; }; };
  wrap(g, 'update', 'sim'); wrap(world.composer, 'render', 'composer'); wrap(hud, 'update', 'hud');
  world.renderer.info.autoReset = false;
  const render = world.render.bind(world);
  world.render = (...a) => {
    world.renderer.info.reset();
    const t = performance.now(); const r = render(...a); P.render += performance.now() - t;
    P.frames++; P.calls += world.renderer.info.render.calls; P.tris += world.renderer.info.render.triangles; P.creeps += g.creeps.length;
    return r;
  };
  // Keep the crowd topped up: towers kill creeps, so start more waves as needed.
  g.callNextWave();
  window.__topUp = setInterval(() => { if (g.creeps.length < ${CREEPS} && !g.isOver()) g.startWave(); }, 400);
  return n;
})()`);

// Wait for the crowd, plus a moment for curated models to finish loading.
for (let i = 0; i < 60 && CREEPS > 0; i++) {
  if (await ev('window.__youtd.game.creeps.length') >= CREEPS) break;
  await sleep(500);
}
await sleep(1500);
if (THROTTLE > 1) await send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });

console.log(`GPU: ${gpu}`);
console.log(`map ${MAP}, ${towers} towers, target ${CREEPS} creeps, ${DPR}x device scale, CPU throttle ${THROTTLE}x, ${SECONDS}s per preset\n`);
const rows = [];
for (const q of QUALITIES) {
  // Older builds without presets (for baseline runs) just measure their fixed look.
  await ev(`window.__youtd.world.setQuality?.(${JSON.stringify(q)})`);
  await sleep(1500); // shader recompiles after a shadow change
  await ev(`Object.assign(window.__bench, { sim: 0, render: 0, composer: 0, hud: 0, frames: 0, calls: 0, tris: 0, creeps: 0, t0: performance.now() })`);
  await sleep(SECONDS * 1000);
  rows.push({ quality: q, ...await ev(`(() => {
    const P = window.__bench, n = Math.max(1, P.frames), r = (x) => Math.round(x * 100) / 100;
    return { fps: r(P.frames / ((performance.now() - P.t0) / 1000)), creeps: Math.round(P.creeps / n), simMs: r(P.sim / n),
      renderMs: r(P.render / n), composerMs: r(P.composer / n), hudMs: r(P.hud / n), calls: Math.round(P.calls / n), tris: Math.round(P.tris / n) };
  })()`) });
}
console.table(rows);
quit(0);
