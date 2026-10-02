// Ability engine shared by tower actives (autocasts), passive procs and item procs.
// Every ability resolves through one effect executor so towers and items reuse
// the same building blocks.

import { RARITIES } from '../data/constants.js';

// ------------------------------------------------------------------ tower buffs

// A timed buff on a tower. Re-applying the same key refreshes it (no stacking).
export function addTowerBuff(game, tower, key, mods, dur, label, maxStacks = 1) {
  const existing = tower.buffs.find((b) => b.key === key);
  if (existing) {
    existing.t = Math.max(existing.t, dur);
    existing.stacks = Math.min(maxStacks, (existing.stacks || 1) + (maxStacks > 1 ? 1 : 0));
    existing.base = mods;
    existing.mods = scaleMods(mods, existing.stacks);
  } else tower.buffs.push({ key, base: mods, mods, t: dur, dur, label, stacks: 1 });
  game.computeStats(tower);
}

export function buffMods(tower) {
  const m = {};
  for (const b of tower.buffs) for (const [k, v] of Object.entries(b.mods)) m[k] = (m[k] || 0) + v;
  return m;
}

// ------------------------------------------------------------------ mana

export function initAbilities(tower) {
  const def = tower.def;
  const actives = def.actives || [];
  const r = RARITIES[def.rarity].idx;
  // Towers with autocasts always get a pool; others use the YouTD mana column when present.
  const hasPool = actives.length || def.mana > 0;
  tower.maxMana = hasPool ? def.mana ?? 60 + r * 40 + def.tier * 20 : 0;
  tower.manaRegen = hasPool ? def.manaRegen ?? 2 + r * 1.2 + def.tier * 0.6 : 0;
  tower.growth ||= {};
  tower.mana = tower.mana == null ? tower.maxMana * 0.5 : Math.min(tower.mana, tower.maxMana);
  const prev = tower.actives || [];
  tower.actives = actives.map((a) => {
    const old = prev.find((p) => p.def.id === a.id);
    return { def: a, cd: old ? old.cd : 0, auto: old ? old.auto : a.auto !== false };
  });
  tower.buffs ||= [];
  tower.procCd ||= {};
}

// ------------------------------------------------------------------ per-tick

export function tickTower(game, t, dt) {
  // Buff expiry
  if (t.buffs.length) {
    let changed = false;
    for (const b of t.buffs) { b.t -= dt; if (b.t <= 0) changed = true; }
    if (changed) { t.buffs = t.buffs.filter((b) => b.t > 0); game.computeStats(t); }
  }
  for (const k in t.procCd) t.procCd[k] -= dt;
  if (!t.maxMana) return;
  const maxMana = t.stats.maxMana ?? t.maxMana;
  t.mana = Math.min(maxMana, t.mana + (t.manaRegen + (t.stats.manaRegenFlat || 0)) * (1 + (t.stats.manaRegen || 0)) * dt);
  for (let i = 0; i < t.actives.length; i++) {
    const a = t.actives[i];
    if (a.cd > 0) a.cd -= dt;
    if (a.auto && a.cd <= 0 && t.mana >= a.def.mana) castActive(game, t, i, false);
  }
}

// ------------------------------------------------------------------ targeting

const avgDamage = (t) => ((t.def.damage[0] + t.def.damage[1]) / 2) * t.stats.damageMult;

function creepsNear(game, x, z, r, needSight = true) {
  const r2 = r * r;
  return game.creeps.filter((c) => c.alive && (!needSight || c.revealed) && (c.x - x) ** 2 + (c.z - z) ** 2 <= r2);
}

function towersNear(game, x, z, r) {
  // Tower-to-tower ranges start at the tower's edge (see TOWER_FOOTPRINT in game.js).
  const rr = r > 0 ? r + 0.9 : r;
  const r2 = rr * rr;
  return [...game.towers.values()].filter((o) => (o.x - x) ** 2 + (o.z - z) ** 2 <= r2);
}

// Point with the most creeps within `radius`, chosen among creeps in range.
function densest(cands, radius) {
  let best = null, bestN = -1;
  for (const c of cands) {
    let n = 0;
    for (const o of cands) if ((o.x - c.x) ** 2 + (o.z - c.z) ** 2 <= radius * radius) n++;
    if (n > bestN) { bestN = n; best = c; }
  }
  return best;
}

// Resolves an active's target. Returns null when the cast would be wasted.
function pickTarget(game, t, a) {
  const range = a.range ?? t.stats.range;
  switch (a.target) {
    case 'creep': {
      const list = creepsNear(game, t.x, t.z, range);
      if (!list.length) return null;
      const pickBy = a.pick || 'strong';
      list.sort((p, q) => (pickBy === 'strong' ? q.hp - p.hp : pickBy === 'first' ? q.dist - p.dist : p.hp - q.hp));
      return { creep: list[0], x: list[0].x, z: list[0].z };
    }
    case 'area': {
      const list = creepsNear(game, t.x, t.z, range);
      if (list.length < (a.minTargets || 1)) return null;
      const c = densest(list, a.effect.radius || 3);
      return { creep: c, x: c.x, z: c.z };
    }
    case 'tower': {
      // Buff the strongest ally in range that doesn't already have this buff.
      if (!creepsNear(game, t.x, t.z, range + 4).length && !a.anytime) return null;
      const allies = towersNear(game, t.x, t.z, range).filter((o) => (a.allowSelf || o !== t) && !o.buffs.some((b) => b.key === a.id));
      if (!allies.length) return null;
      allies.sort((p, q) => q.stats.dps - p.stats.dps);
      return { tower: allies[0], x: allies[0].x, z: allies[0].z };
    }
    case 'self':
    default:
      if (!a.anytime && !creepsNear(game, t.x, t.z, range).length) return null;
      return { tower: t, x: t.x, z: t.z };
  }
}

export function castActive(game, t, idx, manual) {
  const st = t.actives[idx];
  if (!st) return false;
  const a = st.def;
  if (st.cd > 0) { if (manual) game.emit('error', `${a.name} is on cooldown`); return false; }
  if (t.mana < a.mana) { if (manual) game.emit('error', 'Not enough mana'); return false; }
  const target = pickTarget(game, t, a);
  if (!target) { if (manual) game.emit('error', 'No valid target'); return false; }
  t.mana -= a.mana;
  st.cd = a.cd * (1 - (t.stats.cdr || 0));
  game.emit('cast', { tower: t, active: a, x: target.x, z: target.z });
  applyEffect(game, t, a.effect, target);
  runProcs(game, t, 'cast', { creep: target.creep });
  return true;
}

// ------------------------------------------------------------------ passive procs

// Called by the simulation at trigger points. `on` is 'attack' | 'hit' | 'kill' | 'periodic'
// | 'enter' (creep enters range) | 'crit' | 'cast' (after an autocast) | 'death' (any creep dies in range).
const CONDITIONS = {
  slowed: (c) => c.slow > 0 || c.auraSlow > 0,
  stunned: (c) => c.stun > 0,
  boss: (c) => c.size === 'boss' || c.size === 'challenge',
  notBoss: (c) => c.size !== 'boss' && c.size !== 'challenge',
  air: (c) => c.air,
  wounded: (c) => c.hp / c.maxHp < 0.5,
  belowChampion: (c) => c.size === 'mass' || c.size === 'normal' || c.size === 'air' || c.size === 'challengeMass',
  champion: (c) => c.size === 'champion',
  bossOrChampion: (c) => c.size === 'champion' || c.size === 'boss' || c.size === 'challenge',
  ground: (c) => !c.air,
  healthy: (c) => c.hp / c.maxHp >= 0.5,
  cursed: (c) => c.curse > 0 || (c.auraCurse || 0) > 0,
  invisible: (c) => c.invisible,
};

// Extra proc filters that need the context or the proc's own fields.
function procAllowed(game, t, p, ctx) {
  const c = ctx.creep;
  if (p.minLevel && t.level < p.minLevel) return false;
  if (p.cond && !(c && CONDITIONS[p.cond](c))) return false;
  if (p.races && !(c && p.races.includes(c.race))) return false;
  if (p.sizes && !(c && p.sizes.includes(c.size))) return false;
  if (p.armors && !(c && p.armors.includes(c.armorType))) return false;
  if (p.hpBelow != null && !(c && c.hp / c.maxHp < p.hpBelow)) return false;
  if (p.hpAbove != null && !(c && c.hp / c.maxHp > p.hpAbove)) return false;
  if (p.onCrit && !ctx.crit) return false;
  if (p.manaCost && (t.mana || 0) < p.manaCost) return false;
  return true;
}

export function runProcs(game, t, on, ctx) {
  const sources = [[t.def.abilities, null]];
  for (const it of t.items) if (it && game.itemDef(it).procs) sources.push([game.itemDef(it).procs, it]);
  for (const [list, item] of sources) {
    for (const p of list) {
      if (p.type !== 'proc' || p.on !== on) continue;
      const key = (item ? `i${item.uid}:` : '') + (p.key || p.name);
      if (p.icd && (t.procCd[key] || 0) > 0) continue;
      if (!procAllowed(game, t, p, ctx)) continue;
      if (p.needCreeps && !game.creeps.some((c) => c.alive && c.revealed && (c.x - t.x) ** 2 + (c.z - t.z) ** 2 <= t.stats.range ** 2)) continue;
      if (p.every) {
        // Deterministic counter: fires on every Nth trigger.
        t.counters ||= {};
        t.counters[key] = (t.counters[key] || 0) + 1;
        if (t.counters[key] < p.every) continue;
        t.counters[key] = 0;
      } else {
        let chance = (p.chance ?? 1) + (p.chancePerLevel || 0) * t.level;
        // Attack-speed adjusted: slow hitters proc more per attack, fast ones less,
        // so the procs-per-second budget stays tied to the tower, not its speed.
        if ((on === 'attack' || on === 'hit') && !p.noAsAdjust) chance *= Math.max(0.3, Math.min(2.2, t.def.cd));
        chance *= 1 + (t.stats.trigger || 0);
        if (game.rng() >= chance) {
          // A failed periodic roll still waits out its window, so "30% every 7s" means one roll per 7s.
          if (on === 'periodic' && p.icd) t.procCd[key] = p.icd;
          continue;
        }
      }
      if (p.icd) t.procCd[key] = p.icd;
      if (p.manaCost) t.mana -= p.manaCost;
      const target = ctx.creep ? { creep: ctx.creep, x: ctx.creep.x, z: ctx.creep.z } : { tower: t, x: t.x, z: t.z };
      if (!p.silent) game.emit('proc', { tower: t, name: p.name, x: target.x, z: target.z, fx: p.effect.fx });
      applyEffect(game, t, p.effect, target, { ...ctx, item });
    }
  }
}

// ------------------------------------------------------------------ effects

export function applyEffect(game, t, e, target, ctx = {}) {
  if (e.delay) {
    // Delayed effects re-run without the delay once the timer is up.
    const later = { ...e, delay: 0 };
    game.delayed.push({ at: game.time + e.delay, fn: () => { if (game.towers.has(t.uid)) applyEffect(game, t, later, target, ctx); } });
    return;
  }
  const lvlScale = 1 + (e.perLevel || 0) * t.level;
  // Original YouTD spells deal flat damage that grows per level; others scale off attack damage.
  let base = e.flat != null ? e.flat + (e.flatPerLevel || 0) * t.level : avgDamage(t) * (e.mult || 0) * lvlScale;
  if (e.manaMult) base += (t.mana || 0) * e.manaMult;
  if (e.scaleBy) base *= 1 + e.scaleBy.per * scaleValue(game, t, e.scaleBy.kind, target);
  if (e.spendMana) t.mana = Math.max(0, (t.mana || 0) * (1 - e.spendMana));
  const fx = e.fx || 'arcane';
  switch (e.kind) {
    case 'spellDamage': {
      const hits = e.radius ? creepsNear(game, target.x, target.z, e.radius, false) : target.creep?.alive ? [target.creep] : [];
      if (!e.quiet) game.emit('spellFx', { kind: fx, x: target.x, z: target.z, radius: e.radius || 1.2, tower: t });
      for (const c of hits) {
        game.damage(t, c, base + hpPart(c, e), { spell: true, big: !e.quiet });
        if (c.alive) debuffCreep(game, t, c, e);
      }
      break;
    }
    case 'attackDamage': {
      // Extra physical-type hit that goes through armor and the damage matrix.
      const hits = e.radius ? creepsNear(game, target.x, target.z, e.radius, false) : target.creep?.alive ? [target.creep] : [];
      game.emit('spellFx', { kind: fx, x: target.x, z: target.z, radius: e.radius || 1, tower: t });
      for (const c of hits) { game.damage(t, c, base + hpPart(c, e), { big: !e.quiet }); if (c.alive) debuffCreep(game, t, c, e); }
      break;
    }
    case 'debuff': {
      const hits = e.radius ? creepsNear(game, target.x, target.z, e.radius, false) : target.creep?.alive ? [target.creep] : [];
      if (!e.quiet) game.emit('spellFx', { kind: fx, x: target.x, z: target.z, radius: e.radius || 1.2, tower: t });
      for (const c of hits) debuffCreep(game, t, c, e);
      break;
    }
    case 'chainSpell': {
      let cur = target.creep;
      if (!cur?.alive) break;
      const hit = new Set();
      const pts = [{ x: t.x, z: t.z, y: 3 }];
      let dmg = base;
      for (let i = 0; i <= e.count && cur; i++) {
        hit.add(cur.uid);
        pts.push({ x: cur.x, z: cur.z });
        game.damage(t, cur, dmg, { spell: true, big: i === 0 });
        if (cur.alive) debuffCreep(game, t, cur, e);
        dmg *= 1 - (e.falloff ?? 0.15);
        const next = creepsNear(game, cur.x, cur.z, e.jump || 6).filter((c) => !hit.has(c.uid));
        cur = next.sort((p, q) => (p.x - cur.x) ** 2 + (p.z - cur.z) ** 2 - ((q.x - cur.x) ** 2 + (q.z - cur.z) ** 2))[0];
      }
      game.emit('spellChain', { tower: t, points: pts, fx });
      break;
    }
    case 'zone': {
      // Lingering field that pulses spell damage every second.
      game.emit('zoneFx', { kind: fx, x: target.x, z: target.z, radius: e.radius, dur: e.dur });
      for (let i = 1; i <= e.dur; i++) {
        game.delayed.push({ at: game.time + i, fn: () => {
          if (!game.towers.has(t.uid)) return;
          game.emit('spellFx', { kind: fx, x: target.x, z: target.z, radius: e.radius, tower: t, quiet: true });
          for (const c of creepsNear(game, target.x, target.z, e.radius, false)) {
            game.damage(t, c, base, { spell: true });
            if (c.alive) debuffCreep(game, t, c, e);
          }
        } });
      }
      break;
    }
    case 'barrage': {
      // Fires extra regular attacks at random creeps in range.
      const list = creepsNear(game, t.x, t.z, t.stats.range);
      for (let i = 0; i < e.count && list.length; i++) {
        const c = list[Math.floor(game.rng() * list.length)];
        game.fireAt(t, c, avgDamage(t) * (e.mult || 1) * lvlScale);
      }
      break;
    }
    case 'towerBuff': {
      const cx = e.center === 'self' ? t.x : target.x, cz = e.center === 'self' ? t.z : target.z;
      let targets = e.radius ? towersNear(game, cx, cz, e.radius) : [target.tower || t];
      if (e.others) targets = targets.filter((o) => o !== t);
      if (e.element) targets = targets.filter((o) => o.def.element === e.element);
      for (const o of targets) {
        const dur = (e.dur + (e.durPerLevel || 0) * t.level) * (1 + (t.stats.buffDur || 0));
        addTowerBuff(game, o, e.key || e.label, scaleMods(e.mods, lvlScale), dur, e.label, e.maxStacks || 1);
        if (!e.quiet) game.emit('buffFx', { tower: o, kind: fx });
      }
      break;
    }
    case 'mana': {
      const list = e.self ? [t] : towersNear(game, t.x, t.z, e.radius || 0);
      for (const o of list) {
        if (!o.maxMana) continue;
        const cap = o.stats.maxMana ?? o.maxMana;
        o.mana = Math.min(cap, o.mana + (e.pct ? cap * e.pct : e.amount + (e.amountPerLevel || 0) * t.level));
      }
      game.emit('buffFx', { tower: t, kind: 'mana' });
      break;
    }
    case 'gold': {
      const amount = Math.round((e.amount || 0) + (e.perWave || 0) * game.level);
      game.addGold(amount);
      game.emit('goldFx', { x: target.x, z: target.z, amount });
      break;
    }
    case 'xp': {
      game.giveXp(t, e.amount * lvlScale);
      break;
    }
    case 'killInstant': {
      const c = target.creep;
      if (c?.alive) { game.emit('execute', c); game.damage(t, c, c.hp + c.shield + 1, { pure: true }); }
      break;
    }
    case 'grow': {
      // Growth stored on the item itself, so it travels with the item.
      const it = ctx.item;
      if (!it) break;
      it.bound ||= {};
      it.bound[e.stat] = Math.max(e.min ?? -Infinity, Math.min(e.cap ?? Infinity, (it.bound[e.stat] || 0) + e.amount));
      game.computeStats(t);
      break;
    }
    case 'shareXp': {
      const near = towersNear(game, t.x, t.z, e.radius).filter((o) => o !== t).slice(0, e.count || 5);
      for (const o of near) game.giveXp(o, e.amount);
      break;
    }
    case 'bolts': {
      // A stream of strikes on random creeps in range, spread over time.
      const interval = e.interval ?? 0.15;
      for (let i = 0; i < e.count; i++) {
        game.delayed.push({ at: game.time + i * interval, fn: () => {
          if (!game.towers.has(t.uid)) return;
          const list = creepsNear(game, t.x, t.z, e.range ?? t.stats.range);
          if (!list.length) return;
          const c = list[Math.floor(game.rng() * list.length)];
          game.emit('spellChain', { tower: t, points: [{ x: t.x, z: t.z, y: 3 }, { x: c.x, z: c.z }], fx });
          const hits = e.radius ? creepsNear(game, c.x, c.z, e.radius, false) : [c];
          for (const h of hits) { game.damage(t, h, base, { spell: !e.attack }); if (h.alive) debuffCreep(game, t, h, e); }
        } });
      }
      break;
    }
    case 'growSelf': {
      // Permanent growth stored on the tower; kept through upgrades.
      t.growth ||= {};
      const amount = e.amount + (e.amountPerLevel || 0) * t.level;
      t.growth[e.stat] = Math.min(e.cap ?? Infinity, (t.growth[e.stat] || 0) + amount);
      game.computeStats(t);
      break;
    }
    case 'transferXp': {
      // Moves experience from this tower to others nearby (never below zero).
      const near = towersNear(game, t.x, t.z, e.radius).filter((o) => o !== t).slice(0, e.count || 5);
      for (const o of near) { const take = Math.min(t.xp, e.amount); game.giveXp(t, -take); game.giveXp(o, take); }
      break;
    }
    case 'multi': {
      for (const sub of e.effects) applyEffect(game, t, sub, target, ctx);
      break;
    }
    default: break;
  }
}

function scaleMods(mods, k) {
  const out = {};
  for (const [key, v] of Object.entries(mods)) out[key] = v * k;
  return out;
}

// Applies slow, stun, armor and curse riders carried by an effect.
function debuffCreep(game, t, c, e) {
  const resist = c.specials.includes('unyielding') ? 0.4 : 1;
  const lvl = t.level;
  const dur = (e.debuffDur || 5) + (e.debuffDurPerLevel || 0) * lvl;
  if (e.stun) {
    const bossCut = c.size === 'boss' || c.size === 'challenge' ? (e.bossStunMult ?? 1) : 1;
    c.stun = Math.max(c.stun, (e.stun + (e.stunPerLevel || 0) * lvl) * resist * bossCut);
    game.emit('stun', c);
  }
  if (e.slow) {
    const pct = (e.slow + (e.slowPerLevel || 0) * t.level) * resist;
    if (pct >= c.slow) { c.slow = pct; c.slowT = Math.max(c.slowT, e.slowDur || 3); }
  }
  if (e.armor) {
    const k = `${t.def.family}-spell`;
    c.shred[k] = { stacks: 1, armor: e.armor + (e.armorPerLevel || 0) * lvl, t: dur };
  }
  if (e.armorPct) {
    // Percent armor reduction, converted to a flat shred of the creep's current base armor.
    c.shred[`${t.def.family}-pct`] = { stacks: 1, armor: Math.max(0, c.armor) * e.armorPct, t: dur };
  }
  const curse = e.curse ? e.curse + (e.cursePerLevel || 0) * lvl : 0;
  if (curse && curse >= c.curse) { c.curse = curse; c.curseT = dur; }
  if (e.burn) game.addDot(t, c, avgDamage(t) * e.burn, e.burnDur || 3);
  if (e.dot) {
    // Flat spell damage over time; stacks per source up to maxStacks.
    const d = e.dot;
    game.addFlatDot(t, c, d.key || t.def.family, d.dps + (d.dpsPerLevel || 0) * lvl, d.dur, d.maxStacks || 1);
  }
  if (e.pushBack) c.dist = Math.max(0, c.dist - e.pushBack);
  if (e.stackVuln) {
    const v = e.stackVuln;
    c.vulnStack ||= {};
    const k = v.key || t.def.family;
    const cur = c.vulnStack[k] || { stacks: 0, pct: v.pct, t: 0, element: v.element, attack: v.attack, spellOnly: v.spellOnly };
    cur.stacks = Math.min(v.max || 1, cur.stacks + 1);
    cur.pct = v.pct + (v.pctPerLevel || 0) * lvl;
    cur.t = v.permanent ? Infinity : dur;
    c.vulnStack[k] = cur;
  }
  const vulnSpell = e.vulnSpell ? e.vulnSpell + (e.vulnSpellPerLevel || 0) * lvl : 0;
  if (vulnSpell && vulnSpell >= (c.vulnSpell || 0)) { c.vulnSpell = vulnSpell; c.vulnSpellT = dur; }
  if (e.vulnElement) {
    c.vulnEl ||= {};
    const cur = c.vulnEl[e.vulnElement.el];
    if (!cur || cur.pct <= e.vulnElement.pct) c.vulnEl[e.vulnElement.el] = { pct: e.vulnElement.pct, t: dur };
  }
  if (e.mark) c.mark = { ...e.mark, t: dur };
}

// Ticks creep-side ability debuffs (vulnerability, marks).
export function tickCreepDebuffs(c, dt) {
  if (c.vulnSpellT > 0) { c.vulnSpellT -= dt; if (c.vulnSpellT <= 0) c.vulnSpell = 0; }
  if (c.vulnEl) for (const k in c.vulnEl) { c.vulnEl[k].t -= dt; if (c.vulnEl[k].t <= 0) delete c.vulnEl[k]; }
  if (c.mark) { c.mark.t -= dt; if (c.mark.t <= 0) c.mark = null; }
  if (c.vulnStack) for (const k in c.vulnStack) { c.vulnStack[k].t -= dt; if (c.vulnStack[k].t <= 0) delete c.vulnStack[k]; }
}

// Extra damage from a share of the target's health.
function hpPart(c, e) {
  if (!e.pctHp && !e.pctMaxHp) return 0;
  const boss = c.size === 'boss' || c.size === 'challenge';
  const k = boss ? (e.bossPctMult ?? 0.25) : 1;
  return ((e.pctHp || 0) * c.hp + (e.pctMaxHp || 0) * c.maxHp) * k;
}

// Runtime values an effect can scale with (scaleBy: { kind, per }).
function scaleValue(game, t, kind, target) {
  switch (kind) {
    case 'mana': return t.mana || 0;
    case 'gold': return Math.sqrt(Math.max(0, game.gold));
    case 'livesLost': return 100 - game.lives;
    case 'towers': return game.towers.size;
    case 'elementTowers': return [...game.towers.values()].filter((o) => o.def.element === t.def.element).length;
    case 'wave': return game.level;
    case 'creepsInRange': return creepsNear(game, t.x, t.z, t.stats.range).length;
    case 'targetMissingHp': return target.creep ? 1 - target.creep.hp / target.creep.maxHp : 0;
    case 'kills': return t.kills;
    default: return 0;
  }
}
