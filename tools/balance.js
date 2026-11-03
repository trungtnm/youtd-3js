// Headless balance check: a greedy bot plays the simulation and reports how far it gets.
// Usage: DIFF=medium MODE=random SEED=7 A=fire B=storm node tools/balance.js

import { writeFileSync } from 'node:fs';
import { Game } from '../src/sim/game.js';
import { SIM_BUILD } from '../src/sim/sim-build.js';
import { TOWER_LIST, nextTier, FAMILIES, REVEAL_FAMILIES } from '../src/data/towers.js';
import { ITEMS } from '../src/data/items.js';
import { COLS, ROWS, isBuildable, tileToWorld, GROUND_ROUTE } from '../src/sim/map-layout.js';

const { DIFF: difficulty = 'medium', MODE: mode = 'build', SEED: seed = '7', A: focusA = 'fire', B: focusB = 'storm' } = process.env;
const CAP = Number(process.env.CAP || 999); // max towers the bot builds
const modifiers = (process.env.MODS || '').split(',').filter(Boolean); // e.g. MODS=glass,frugal
const g = new Game({ difficulty, mode, length: 'full', seed: Number(seed), autoWave: process.env.AUTO === '1', modifiers });

// Score tiles by how much path lies within 9 units.
const pathPts = [];
for (let d = 0; d < GROUND_ROUTE.length; d += 1) {
  const s = GROUND_ROUTE.segs.find((sg) => d < sg.start + sg.len) || GROUND_ROUTE.segs.at(-1);
  const t = d - s.start;
  pathPts.push({ x: s.a.x + s.dx * t, z: s.a.z + s.dz * t });
}
const tiles = [];
for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) {
  if (!isBuildable(c, r)) continue;
  const p = tileToWorld(c, r);
  const cover = pathPts.filter((q) => (q.x - p.x) ** 2 + (q.z - p.z) ** 2 < 81).length;
  tiles.push({ c, r, cover });
}
tiles.sort((a, b) => b.cover - a.cover);

const focus = [focusA, focusB];
let log = [];
const leaks = {};
g.on('creepLeaked', (c) => { leaks[c.level] = (leaks[c.level] || '') + c.size[0]; });
const verbose = process.env.V;
g.on('waveCleared', (w) => {
  const dps = [...g.towers.values()].reduce((s, t) => s + t.stats.dps, 0);
  if (verbose) log.push(`  w${w.level} ${g.wavePreview(0).length} dps ${Math.round(dps)} leaks ${leaks[w.level] || '-'} lives ${g.lives} gold ${g.gold}`);
  if (w.level % 10 === 0) log.push(`wave ${w.level}: lives ${g.lives} gold ${g.gold} towers ${g.towers.size} lvls ${[...g.towers.values()].map(t=>t.level).sort((a,b)=>b-a).slice(0,6).join('/')} tiers ${[...g.towers.values()].map(t=>t.def.tier+1).join('')} food ${g.food}/${g.foodCap} research ${focus.map((e) => g.research[e]).join('/')}`);
});

function act() {
  // Research
  for (const el of focus) while (g.research[el] < 15 && g.tomes >= g.researchCost(el) + 0) { if (!g.command('research', { el })) break; }
  // Equip / use items
  for (const it of [...g.stash]) {
    const def = ITEMS[it.id];
    if (def.kind === 'consumable') g.command('use', { item: it.uid });
    else {
      const t = [...g.towers.values()].sort((a, b) => b.stats.dps - a.stats.dps).find((t) => def.kind === 'oil' || t.items.some((s, i) => !s && i < g.itemSlots()));
      if (t) g.command('equip', { item: it.uid, tower: t.uid });
    }
  }
  // See invisible creeps: keep one revealer per lane band once they can appear.
  const revealers = [...g.towers.values()].filter((t) => t.def.abilities.some((a) => a.type === 'reveal')).length;
  if (g.level >= 6 && revealers < 3 && mode !== 'random') {
    const tile = tiles.find((t) => !g.towerGrid.has(`${t.c},${t.r}`) && t.r % 5 === (revealers * 2 + 4) % 5);
    if (tile) g.command('build', { id: FAMILIES[REVEAL_FAMILIES[0]].tiers[0], c: tile.c, r: tile.r });
  }
  // Boss spoils: the first offer, or the first one that is not an item when the stash is full.
  while (g.spoils.length) {
    if (g.command('spoil', { idx: 0 })) continue;
    const i = g.spoils[0].options.findIndex((o) => o.type !== 'item' && o.type !== 'oil');
    if (i < 0 || !g.command('spoil', { idx: i })) break;
  }
  // Perks: prefer raw damage, then speed, then anything offered.
  const pref = ['ascendant', 'brutal', 'rhythm', 'swift', 'keen', 'overload', 'arcanist'];
  for (const t of g.towers.values()) {
    while (t.perkOffer) g.command('perk', { tower: t.uid, perk: pref.find((p) => t.perkOffer.includes(p)) || t.perkOffer[0] });
  }
  // Upgrade cheapest upgradable tower if efficient, else build
  for (let guard = 0; guard < 10; guard++) {
    const pool = mode === 'random' ? g.towerStash.map((id) => TOWER_LIST.find((t) => t.id === id))
      : TOWER_LIST.filter((t) => t.tier === 0 && focus.includes(t.element) && g.towerUnlocked(t));
    const affordable = pool.filter((t) => g.gold >= t.totalCost && g.tomes >= t.tomeCost && g.food + t.food <= g.foodCap)
      .sort((a, b) => b.totalCost - a.totalCost);
    const ups = [...g.towers.values()].map((t) => ({ t, n: nextTier(t.def.id) }))
      .filter(({ t, n }) => n && !g.upgradeCheck(t)).sort((a, b) => a.n.cost - b.n.cost);
    const foodTight = g.towers.size >= CAP || !tiles.some((t) => !g.towerGrid.has(`${t.c},${t.r}`));
    if (ups.length && (foodTight || ups[0].n.cost < g.gold * 0.6)) { g.command('upgrade', { tower: ups[0].t.uid }); continue; }
    if (!affordable.length || foodTight) {
      // Tower limit reached: pour spare gold into training the strongest towers.
      const ranked = [...g.towers.values()].filter((t) => t.level < 25).sort((a, b) => b.stats.dps - a.stats.dps);
      // Keep enough gold for the next tier upgrade that research already allows.
      const reserve = Math.min(...[...g.towers.values()].map((t) => nextTier(t.def.id)).filter((n) => n && g.towerUnlocked(n)).map((n) => n.cost), Infinity);
      const next = ranked.find((t) => g.gold - g.trainCost(t) > (Number.isFinite(reserve) ? reserve : 0));
      if (!next || ups.length || g.trainLocked()) break;
      g.command('train', { tower: next.uid });
      continue;
    }
    const tile = tiles.find((t) => !g.towerGrid.has(`${t.c},${t.r}`));
    if (!tile) break;
    if (!g.command('build', { id: affordable[0].id, c: tile.c, r: tile.r })) break;
  }
}

g.on('error', () => {});
// Plays through the command layer at fixed ticks, like the game, so every bot run
// is also a replayable log (LOG=path writes it; tools/replay.js checks it).
g.command('wave');
while (g.phase === 'running' && g.tick < 60 * 60 * 60 * 3) {
  if (g.tick % 60 === 0) act();
  g.step();
}
if (process.env.LOG) writeFileSync(process.env.LOG, JSON.stringify(g.exportLog(SIM_BUILD)));
console.log(log.join('\n'));
console.log(`RESULT ${difficulty}/${mode} seed ${seed} ${focus}: phase=${g.phase} wave=${g.level} lives=${g.lives} kills=${g.stats.kills} items=${g.stats.itemsFound} score=${g.score}${modifiers.length ? ` mods=${g.cfg.modifiers.join(',')}` : ''}`);
