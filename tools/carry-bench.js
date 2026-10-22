// Carry benchmark: how hard a late wave one main tower can hold with a typical late-game
// setup around it. Most runs are won by a single carry dealing 90%+ of the damage, so
// this compares carries directly instead of whole runs.
//
// Each top-tier tower is tested as the carry next to 4 control towers (slows and
// entangles) and one buff-aura tower, at the same level, with five oils. Every carry is
// run with a physical loadout and a spell loadout; the better one counts.
// Scenarios: a single boss, a mass wave and an air wave on plain armor. The score is the
// largest health multiplier at which the whole wave dies before any creep leaks
// (1.0 = holds the normal wave). Damage that scales with creep health stays honest.
//
// Usage: WAVE=90 LVL=25 DIFF=medium TOP=25 node tools/carry-bench.js
//        ONLY=y281,y60 node tools/carry-bench.js   (just these towers)
//        V=1 prints progress to stderr

import { Game } from '../src/sim/game.js';
import { FAMILIES, TOWERS } from '../src/data/towers.js';
import { generateWave } from '../src/sim/waves.js';
import { COLS, ROWS, isBuildable, tileToWorld, GROUND_ROUTE } from '../src/sim/map-layout.js';
import { xpForLevel } from '../src/data/constants.js';

const WAVE = Number(process.env.WAVE || 90);
const LVL = Number(process.env.LVL || 25);
const SUPPORT_LVL = Number(process.env.SUPPORT_LVL || 15);
const DIFF = process.env.DIFF || 'medium';
const TOP = Number(process.env.TOP || 25);
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const COUNTS = { boss: 1, mass: 20, air: 6 };
const GOLD = Number(process.env.GOLD || 20000); // gold banked during the wave; some towers scale with it

// Icy Flower (slow aura), Frozen Well (slow on hit), Sacred Altar and Flourishing Chasm (entangle).
const CONTROL = ['y543', 'y100', 'y607', 'y679'];
const LOADOUTS = {
  physical: {
    aura: 'y391', // The Steam Engine: +30% damage, +15% attack speed
    oils: ['i1003', 'i1003', 'i1009', 'i1012', 'i1022'], // Sharpness x2, Accuracy, Swiftness, Tears of the Gods
    perks: ['legend', 'apex', 'ascendant', 'rhythm', 'keen', 'brutal', 'might', 'lethality'],
  },
  spell: {
    aura: 'y289', // Red Lightning Conductor: +35% spell damage
    oils: ['i1015', 'i1015', 'i1006', 'i1012', 'i1024'], // Sorcery x2, Magic, Swiftness, Wizard's Soul
    perks: ['arcanist', 'trigger', 'wellspring', 'legend', 'ascendant', 'patience', 'brutal', 'might'],
  },
};

// Tiles ranked by how much ground path lies within 9 units.
const pathPts = [];
for (let d = 0; d < GROUND_ROUTE.length; d += 1) {
  const s = GROUND_ROUTE.segs.find((sg) => d < sg.start + sg.len) || GROUND_ROUTE.segs.at(-1);
  pathPts.push({ x: s.a.x + s.dx * (d - s.start), z: s.a.z + s.dz * (d - s.start) });
}
const tiles = [];
for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) {
  if (!isBuildable(c, r)) continue;
  const p = tileToWorld(c, r);
  tiles.push({ c, r, cover: pathPts.filter((q) => (q.x - p.x) ** 2 + (q.z - p.z) ** 2 < 81).length });
}
tiles.sort((a, b) => b.cover - a.cover);

function levelTo(g, t, lvl, perks) {
  // Some towers gain experience slowly or not at all; give up on xp after a while.
  for (let guard = 0; t.level < lvl && guard < 200; guard++) {
    g.giveXp(t, xpForLevel(t.level) / Math.max(0.05, 1 + t.stats.xp) + 1);
    while (t.perkOffer) g.choosePerk(t, perks.find((p) => t.perkOffer.includes(p)) || t.perkOffer[0]);
  }
}

// Plays one wave with health scaled by hpMult. Returns whether it died without leaks.
function run(carryId, loadout, size, hpMult) {
  const g = new Game({ difficulty: DIFF, mode: 'sandbox', length: 'endless', seed: 1 });
  g.gold = 1e12; g.tomes = 1e9; g.lives = g.maxLives = 1e9;
  g.on('error', () => {});
  const free = [...tiles];
  const take = (pred = () => true) => { const i = free.findIndex(pred); return i < 0 ? null : free.splice(i, 1)[0]; };
  const at = take();
  const carry = g.build(carryId, at.c, at.r);
  if (!carry) return null;
  // The buff aura sits next to the carry; control towers take the next best tiles.
  const near = take((t) => Math.abs(t.c - at.c) + Math.abs(t.r - at.r) === 1);
  const support = [];
  if (near) support.push(g.build(LOADOUTS[loadout].aura, near.c, near.r));
  for (const id of CONTROL) { const t = take(); if (t) support.push(g.build(id, t.c, t.r)); }
  for (const t of support) if (t) levelTo(g, t, SUPPORT_LVL, ['brutal', 'swift']);
  levelTo(g, carry, LVL, LOADOUTS[loadout].perks);
  for (const id of LOADOUTS[loadout].oils) { const it = g.makeItem(id); g.stash.push(it); g.equip(it.uid, carry); }
  g.gold = GOLD;
  g.recalcAll();

  const def = generateWave(WAVE, DIFF, () => 0.5);
  const count = COUNTS[size];
  Object.assign(def, { size, list: new Array(count).fill(size), specials: [], armor: 'bare', challenge: false,
    interval: size === 'mass' ? 0.42 : size === 'air' ? 1.4 : 1 });
  def.hp *= hpMult;
  g.upcoming[0] = def;
  g.startWave();
  g.phase = 'running';
  let leaked = 0, killed = 0;
  g.on('creepLeaked', () => { leaked++; });
  g.on('creepDied', () => { killed++; });
  for (let i = 0; i < 20 * 600 && !leaked && killed < count; i++) g.update(0.05);
  const total = [...g.towers.values()].reduce((s, t) => s + t.damageDealt, 0);
  return { ok: !leaked && killed >= count, share: total ? carry.damageDealt / total : 0,
    spell: (carry.dmgSplit.spell || 0) / Math.max(1, carry.damageDealt) };
}

// Largest health multiplier the setup holds: double until it fails, then bisect.
function holdLimit(carryId, loadout, size) {
  let lo = 0, hi = 0.25, probe = null;
  for (let r; hi < 4096 && (r = run(carryId, loadout, size, hi)) && r.ok; hi *= 2) { lo = hi; probe = r; }
  for (let i = 0; i < 6; i++) {
    const mid = lo ? Math.sqrt(lo * hi) : hi / 2;
    const r = run(carryId, loadout, size, mid);
    if (r?.ok) { lo = mid; probe = r; } else hi = mid;
  }
  return { limit: lo, ...(probe || run(carryId, loadout, size, 1) || {}) };
}

const SIZES = ['boss', 'mass', 'air'];
const ids = ONLY.length ? ONLY : Object.values(FAMILIES).map((f) => f.tiers.at(-1));
const rows = [];
for (const id of ids) {
  const t0 = Date.now();
  if (process.env.V) process.stderr.write(`${id} ${TOWERS[id].name} ... `);
  const row = { id, name: TOWERS[id].name, attack: TOWERS[id].attack };
  for (const size of SIZES) {
    let top = null;
    for (const lo of Object.keys(LOADOUTS)) {
      const r = holdLimit(id, lo, size);
      if (!top || r.limit > top.limit) top = { ...r, lo };
    }
    row[size] = top.limit;
    row[`${size}Lo`] = top.lo;
    row[`${size}Spell`] = top.spell || 0;
    row[`${size}Share`] = top.share || 0;
  }
  row.spell = (row.bossSpell + row.massSpell + row.airSpell) / 3;
  row.share = (row.bossShare + row.massShare + row.airShare) / 3;
  row.score = Math.cbrt(row.boss * row.mass * row.air);
  rows.push(row);
  if (process.env.V) process.stderr.write(`${Date.now() - t0}ms\n`);
}
rows.sort((a, b) => b.score - a.score);

const pct = (v) => `${Math.round(v * 100)}%`.padStart(4);
const f = (v) => (v ?? 0).toFixed(2).padStart(6);
console.log(`Carry bench: wave ${WAVE}, ${DIFF}, carry level ${LVL}, support level ${SUPPORT_LVL}. Score = health multiple held (geo mean of boss/mass/air).`);
console.log('rank  id     score   boss   mass    air  spell carry  name');
rows.slice(0, TOP).forEach((r, i) => console.log(`${String(i + 1).padStart(4)}  ${r.id.padEnd(5)} ${f(r.score)} ${f(r.boss)} ${f(r.mass)} ${f(r.air)}  ${pct(r.spell)}  ${pct(r.share)}  ${r.name} (${r.attack}, ${r.bossLo}/${r.massLo}/${r.airLo})`));
const avg = (list) => list.reduce((s, v) => s + v, 0) / Math.max(1, list.length);
const kinds = [['Spell', (r) => r.spell >= 0.5], ['Attack', (r) => r.spell < 0.5]];
console.log('\nTop-5 average per scenario (spell = carries dealing >=50% spell damage):');
for (const key of ['score', 'boss', 'mass', 'air']) {
  console.log(`  ${key.padEnd(5)} ${kinds.map(([name, pred]) => `${name} ${f(avg(rows.filter(pred).map((r) => r[key]).sort((a, b) => b - a).slice(0, 5)))}`).join('   ')}`);
}
