// Replay and command-layer checks: a bot run replays exactly, a two-player log replays
// exactly, players cannot act on each other's towers, and tampered logs are rejected.
// Usage: node tools/test-replay.mjs

import assert from 'node:assert/strict';
import { Game } from '../src/sim/game.js';
import { replayLog } from '../src/sim/replay.js';
import { TOWER_LIST } from '../src/data/towers.js';
import { isBuildable, COLS, ROWS } from '../src/sim/map-layout.js';

const BUILD = 'test';
const tiles = [];
for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) if (isBuildable(c, r)) tiles.push({ c, r });

// A small scripted player: research one element, build cheap towers, train and upgrade.
function play(g, slot, el, until) {
  const pl = g.players[slot];
  const cmd = (op, args) => g.command(op, args, slot);
  while (pl.research[el] < 3 && pl.tomes >= g.researchCost(el, pl)) cmd('research', { el });
  const def = TOWER_LIST.filter((t) => t.tier === 0 && t.element === el && g.towerUnlocked(t, pl)).sort((a, b) => a.totalCost - b.totalCost)[0];
  for (const tile of tiles) {
    if (pl.gold < def.totalCost) break;
    if ((tile.c + slot) % 2 === 0 && !g.towerGrid.has(`${tile.c},${tile.r}`)) cmd('build', { id: def.id, c: tile.c, r: tile.r });
    if ([...g.towers.values()].filter((t) => t.owner === slot).length >= 6) break;
  }
  for (const t of g.towers.values()) {
    if (t.owner !== slot) continue;
    while (t.perkOffer) cmd('perk', { tower: t.uid, perk: t.perkOffer[0] });
    if (!g.upgradeCheck(t)) cmd('upgrade', { tower: t.uid });
  }
  for (const it of [...pl.stash]) {
    const t = [...g.towers.values()].find((x) => x.owner === slot && x.items.some((s, i) => !s && i < g.itemSlots()));
    if (t) cmd('equip', { item: it.uid, tower: t.uid });
  }
  while (pl.spoils.length && cmd('spoil', { idx: 0 }));
  if (g.level < until && g.activeWaves.length === 0) cmd('wave');
}

function run(players, waves) {
  const g = new Game({ difficulty: 'easy', seed: 4242, players });
  g.on('error', () => {});
  g.command('wave');
  while (!g.isOver() && g.level < waves && g.tick < 60 * 60 * 30) {
    if (g.tick % 30 === 0) for (let s = 0; s < players; s++) play(g, s, s ? 'ice' : 'fire', waves);
    g.step();
  }
  return g;
}

const results = [];
function test(name, fn) {
  try { fn(); results.push(`ok   ${name}`); } catch (e) { results.push(`FAIL ${name}\n     ${e.message}`); process.exitCode = 1; }
}

const solo = run(1, 12);
console.log(`solo: wave ${solo.level}, ${solo.log.length} commands, ${solo.towers.size} towers, tick ${solo.tick}`);
const soloLog = JSON.parse(JSON.stringify(solo.exportLog(BUILD)));

test('single-player log replays to the same state', () => {
  const r = replayLog(soloLog, { build: BUILD });
  assert.equal(r.error, null);
  assert.equal(r.game.stateHash(), solo.stateHash());
  assert.equal(r.game.score, solo.score);
});

test('a log from another build is refused', () => {
  assert.equal(replayLog(soloLog, { build: 'other' }).error, 'different simulation build');
});

test('two-player log replays to the same state', () => {
  const duo = run(2, 12);
  const owners = new Set([...duo.towers.values()].map((t) => t.owner));
  assert.deepEqual([...owners].sort(), [0, 1]);
  const r = replayLog(JSON.parse(JSON.stringify(duo.exportLog(BUILD))), { build: BUILD });
  assert.equal(r.error, null);
  assert.equal(r.game.stateHash(), duo.stateHash());
  assert.notEqual(r.game.players[0].gold, undefined);
});

test('a player cannot act on another player\'s tower', () => {
  const g = new Game({ seed: 1, players: 2, god: true });
  const t = g.command('build', { id: TOWER_LIST.find((d) => d.tier === 0).id, c: tiles[0].c, r: tiles[0].r }, 0);
  assert.ok(t);
  assert.equal(g.command('sell', { tower: t.uid }, 1), false);
  assert.ok(g.towers.has(t.uid));
  assert.ok(g.command('sell', { tower: t.uid }, 0));
});

test('commands with a bad shape are refused', () => {
  const g = new Game({ seed: 1 });
  assert.equal(g.command('build', { id: '__proto__', c: 1, r: 1 }), null);
  assert.equal(g.command('build', { id: 'x', c: -1, r: 1 }), false);
  assert.equal(g.command('nope', {}), false);
  assert.equal(g.command('wave', { extra: 1 }), false);
  assert.equal(g.command('wave', {}, 1), false); // no slot 1 in a solo game
});

test('an edited command is caught', () => {
  const log = structuredClone(soloLog);
  const i = log.cmds.findIndex((c) => c[2] === 'build');
  log.cmds[i][3].c = (log.cmds[i][3].c + 1) % COLS;
  assert.equal(replayLog(log, { build: BUILD }).ok, false);
});

test('an injected command is caught', () => {
  const log = structuredClone(soloLog);
  log.cmds.splice(1, 0, [log.cmds[1][0], 0, 'research', { el: 'storm' }]);
  assert.equal(replayLog(log, { build: BUILD }).ok, false);
});

test('a forged checkpoint or end state is caught', () => {
  const a = structuredClone(soloLog);
  a.hashes[1][1] = a.hashes[1][1] === '00000000' ? '00000001' : '00000000';
  assert.equal(replayLog(a, { build: BUILD }).error, 'state diverged');
  const b = structuredClone(soloLog);
  b.end.tick += 600;
  assert.equal(replayLog(b, { build: BUILD }).ok, false);
});

test('malformed logs are refused before replaying', () => {
  for (const bad of [null, {}, { ...soloLog, v: 9 }, { ...soloLog, seed: -1 }, { ...soloLog, cfg: { ...soloLog.cfg, difficulty: 'toString' } },
    { ...soloLog, cmds: [[0, 0, 'build', { id: 'a', c: 1, r: 1, gold: 5 }]] }, { ...soloLog, cmds: [[5, 0, 'wave', {}], [4, 0, 'wave', {}]] }]) {
    assert.equal(replayLog(bad, { build: BUILD }).ok, false);
  }
});

test('a log exported from the defeat event replays (the game does this at run end)', () => {
  const g = new Game({ difficulty: 'hard', seed: 77, modifiers: ['glass'] });
  let log = null;
  g.on('defeat', () => { log = JSON.parse(JSON.stringify(g.exportLog(BUILD))); });
  while (!g.isOver() && g.tick < 60 * 60 * 60) {
    if (g.tick % 60 === 0) g.command('wave');
    g.step();
  }
  assert.equal(g.phase, 'lost');
  assert.ok(log, 'defeat fired');
  const r = replayLog(log, { build: BUILD });
  assert.equal(r.error, null);
  assert.equal(r.game.phase, 'lost');
});

test('the simulation is deterministic across fresh games', () => {
  assert.equal(run(1, 6).stateHash(), run(1, 6).stateHash());
});

console.log(results.join('\n'));
