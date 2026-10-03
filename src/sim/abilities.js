// Ability engine shared by tower actives (autocasts), passive procs and item procs.
// Every ability resolves through one effect executor so towers and items reuse
// the same building blocks.

import { RARITIES } from '../data/constants.js';
import { UNIT } from '../data/youtd/ports/helpers.js';
import { ECON } from '../data/constants.js';

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
  // A link autocast only fires while there is no live link; manual casts can relink.
  if (!manual && a.effect.kind === 'link' && t.linkTo && game.towers.has(t.linkTo)) return false;
  const target = pickTarget(game, t, a);
  if (!target) { if (manual) game.emit('error', 'No valid target'); return false; }
  t.mana -= a.mana;
  st.cd = a.cd * (1 - (t.stats.cdr || 0));
  game.emit('cast', { tower: t, active: a, x: target.x, z: target.z });
  applyEffect(game, t, a.effect, target);
  // targetTower: the ally a tower-targeted cast was aimed at (for procs that reward it).
  runProcs(game, t, 'cast', { creep: target.creep, targetTower: a.target === 'tower' ? target.tower : null });
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
  if (p.manaAbove != null && (t.mana || 0) <= p.manaAbove) return false;
  if (p.goldCost && game.gold < p.goldCost) return false;
  if (p.notOwnKill && ctx.killer === t) return false;
  if (p.attacks && !p.attacks.includes(t.stats.attackType || t.def.attack)) return false;
  if (p.elements && !p.elements.includes(t.def.element)) return false;
  if (p.towerCast && !ctx.targetTower) return false;
  return true;
}

export function runProcs(game, t, on, ctx) {
  const sources = [[t.def.abilities, null]];
  // Copies (made by another item) run without their autocast procs.
  for (const it of game.carriedItems(t)) if (it && game.itemDef(it).procs) sources.push([it.copyOf ? game.itemDef(it).copyProcs : game.itemDef(it).procs, it]);
  for (const [list, item] of sources) {
    for (const p of list) {
      if (p.type !== 'proc' || p.on !== on) continue;
      const key = (item ? `i${item.uid}:` : '') + (p.key || p.name);
      if (p.icd && (t.procCd[key] || 0) > 0) continue;
      // Item actives with autocast off still tick once a second without acting, so effects
      // can keep their state (charges) current; the player casts them from the tower panel.
      if (p.active && item && !itemAutoOn(item, p)) {
        if ((t.procCd[`${key}:tick`] || 0) > 0) continue;
        t.procCd[`${key}:tick`] = 1;
        applyEffect(game, t, p.effect, { tower: t, x: t.x, z: t.z }, { ...ctx, item, passive: true });
        continue;
      }
      if (!procAllowed(game, t, p, ctx)) continue;
      if (p.needCreeps && !game.creeps.some((c) => c.alive && c.revealed && (c.x - t.x) ** 2 + (c.z - t.z) ** 2 <= t.stats.range ** 2)) continue;
      // everyWaves: fires on the first trigger, then again once the wave level has advanced
      // by N. The last firing wave lives on the item (or tower), so it travels with the item.
      const waveHolder = item || t;
      if (p.everyWaves && waveHolder.waveFired?.[p.key || p.name] != null
        && game.level - waveHolder.waveFired[p.key || p.name] < p.everyWaves) continue;
      if (p.every) {
        // Deterministic counter: fires on every Nth trigger.
        t.counters ||= {};
        t.counters[key] = (t.counters[key] || 0) + 1;
        // Counters may shrink with level (everyPerLevel < 0), never below everyMin.
        // everySteps: [[level, every], ...] switches the count at exact levels (e.g. [[15, 9], [25, 8]]).
        let every = Math.max(p.everyMin ?? 1, Math.round(p.every + (p.everyPerLevel || 0) * t.level));
        if (p.everySteps) for (const [lvl, n] of p.everySteps) if (t.level >= lvl) every = n;
        if (t.counters[key] < every) continue;
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
      if (p.everyWaves) (waveHolder.waveFired ||= {})[p.key || p.name] = game.level;
      if (p.manaCost) t.mana -= p.manaCost;
      const target = ctx.creep ? { creep: ctx.creep, x: ctx.creep.x, z: ctx.creep.z } : { tower: t, x: t.x, z: t.z };
      if (!p.silent) game.emit('proc', { tower: t, name: p.name, x: target.x, z: target.z, fx: p.effect.fx });
      // An effect that finds nothing to do returns false; it retries after at most 1s.
      if (applyEffect(game, t, p.effect, target, { ...ctx, item }) === false && p.icd) t.procCd[key] = Math.min(p.icd, 1);
    }
  }
}

// Item actives: a proc with `active: true` can be cast from the tower panel. Its autocast
// switch lives on the item instance (default `auto`), so it travels with the item.
export const itemAutoOn = (item, p) => item.auto?.[p.key || p.name] ?? !!p.auto;

// Manual cast of an item active. Returns true, or a short reason when nothing happened.
export function castItemActive(game, t, item, p) {
  const key = `i${item.uid}:${p.key || p.name}`;
  if ((t.procCd[key] || 0) > 0) return `${p.name} is on cooldown (${Math.ceil(t.procCd[key])}s)`;
  const ctx = { item, manual: true };
  if (applyEffect(game, t, p.effect, { tower: t, x: t.x, z: t.z }, ctx) === false) return ctx.fail || `${p.name}: nothing to do`;
  if (p.icd) t.procCd[key] = p.icd;
  return true;
}

// Item hooks: procs with on 'equip' | 'unequip' run once for that item when it joins or
// leaves a tower (see Game.itemHook). Effects read ctx.hook to tell the two apart.
export function runItemHook(game, t, item, on) {
  const def = game.itemDef(item);
  for (const p of (item.copyOf ? def.copyProcs : def.procs) || []) {
    if (p.type !== 'proc') continue;
    if (p.on === on) applyEffect(game, t, p.effect, { tower: t, x: t.x, z: t.z }, { item, hook: on });
    // waitFirst: a periodic proc starts a full cooldown on pickup unless one carried over.
    const key = `i${item.uid}:${p.key || p.name}`;
    if (on === 'equip' && p.on === 'periodic' && p.waitFirst && !(t.procCd[key] > 0)) t.procCd[key] = p.icd;
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
  if (e.fromLinked) {
    // Releases a share of the spell damage the linked ally dealt (needs linkAfter seconds of link).
    const ready = t.linkTo && game.towers.has(t.linkTo) && game.time - (t.linkSince || 0) >= (e.linkAfter || 0);
    base += ready ? (t.linkBank || 0) * e.fromLinked : 0;
    if (ready) t.linkBank = 0;
  }
  if (e.scaleBy) base *= 1 + e.scaleBy.per * scaleValue(game, t, e.scaleBy.kind, target, e.scaleBy);
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
      if (e.pick === 'random' && targets.length) targets = [targets[Math.floor(game.rng() * targets.length)]];
      for (const o of targets) {
        let dur = (e.dur + (e.durPerLevel || 0) * t.level) * (1 + (t.stats.buffDur || 0));
        // Debuff duration (e.g. Forcefield) shortens buffs that only lower the receiver's stats.
        if (o.stats.debuffDur && harmfulMods(e.mods)) dur *= Math.max(0, 1 + o.stats.debuffDur);
        if (dur <= 0) continue;
        const runtime = e.scaleBy ? 1 + e.scaleBy.per * scaleValue(game, t, e.scaleBy.kind, target, e.scaleBy) : 1;
        addTowerBuff(game, o, e.key || e.label, scaleMods(e.mods, lvlScale * runtime), dur, e.label, e.maxStacks || 1);
        if (!e.quiet) game.emit('buffFx', { tower: o, kind: fx });
        if (o !== t) runProcs(game, o, 'buffed', { from: t });
      }
      break;
    }
    case 'mana': {
      const list = e.self ? [t] : towersNear(game, t.x, t.z, e.radius || 0);
      for (const o of list) {
        if (!o.maxMana) continue;
        const cap = o.stats.maxMana ?? o.maxMana;
        // pctCurrent: share of current mana (negative drains), pct: share of max mana.
        const gain = e.pctCurrent ? o.mana * e.pctCurrent : e.pct ? cap * e.pct : (e.amount || 0) + (e.amountPerLevel || 0) * t.level + (ctx.overkill || 0) * (e.fromOverkill || 0);
        o.mana = Math.max(0, Math.min(cap, o.mana + gain));
      }
      game.emit('buffFx', { tower: t, kind: 'mana' });
      break;
    }
    case 'gold': {
      const amount = Math.round((e.amount || 0) + (e.perWave || 0) * game.level);
      if (amount < 0) {
        // Spending never takes the player below zero and is not counted as earnings.
        game.gold = Math.max(0, game.gold + amount);
      } else {
        game.addGold(amount);
        game.emit('goldFx', { x: target.x, z: target.z, amount });
      }
      break;
    }
    case 'xp': {
      // toCastTarget: the experience goes to the tower a cast was aimed at.
      const who = e.toCastTarget ? ctx.targetTower : t;
      if (who && game.towers.has(who.uid)) game.giveXp(who, e.amount * lvlScale);
      break;
    }
    case 'modifyHit': {
      // Changes the attack hit that is about to land (trigger 'damage'). ctx.hit.damage is
      // the pre-armor amount; YouTD scripts work on the amount after armor, so the attack
      // multiplier converts between the two where it matters.
      const hit = ctx.hit, c = target.creep;
      if (!hit || !c?.alive) break;
      if (e.mult != null) hit.damage *= e.mult;
      if (e.healthMult) hit.damage *= e.healthMult[0] + (e.healthMult[1] - e.healthMult[0]) * (c.hp / c.maxHp);
      // YouTD's mana regeneration percent starts at 100%, so the default factor is 2.
      if (e.regenMult) hit.damage *= Math.max(0, 2 + (t.stats.manaRegen || 0));
      if (e.floor || e.toSpell) {
        const m = game.damageMultiplier(t, c, false);
        if (e.floor && m > 0) hit.damage = Math.max(hit.damage, ((t.stats.dmgMin + t.stats.dmgMax) / 2) / m);
        if (e.toSpell) { hit.spell += hit.damage * e.toSpell * Math.max(0, m); hit.damage *= 1 - e.toSpell; }
      }
      break;
    }
    case 'drainCreepMana': {
      // Creep mana only exists on creeps whose specials run on it (see spawnCreep).
      const c = target.creep;
      if (!c?.alive || !(c.mana > 0)) break;
      // perLevelByCd: the per-level part grows with the tower's base attack cooldown.
      // rangeExp: long-range towers drain less, by (rangeRef / range)^... as in YouTD.
      let amount = e.amount + (e.amountPerLevel || 0) * t.level * (e.perLevelByCd ? t.def.cd : 1);
      if (e.rangeExp) amount *= (e.rangeRef || 55) / Math.pow(Math.max(1, t.def.range * UNIT), e.rangeExp);
      c.mana = Math.max(0, c.mana - amount);
      game.emit('spellChain', { tower: t, points: [{ x: t.x, z: t.z, y: 3 }, { x: c.x, z: c.z }], fx });
      break;
    }
    case 'restoreMana': {
      // Remembers the carrier's mana on each tick; when it has dropped since, a chance
      // restores it to the remembered level. The memory lives on the item, so a new
      // carrier starts from its own mana (YouTD sets it on pickup).
      const it = ctx.item;
      if (!it || !t.maxMana) break;
      // A stale memory (item moved, or held in the stash) starts over like a fresh pickup.
      if (it.manaMemo?.uid !== t.uid || game.time - it.manaMemo.at > (e.every || 5) * 1.5) {
        it.manaMemo = { uid: t.uid, mana: t.mana, at: game.time };
        break;
      }
      it.manaMemo.at = game.time;
      const cap = t.stats.maxMana ?? t.maxMana;
      if (t.mana < it.manaMemo.mana && game.rng() < (e.chance ?? 1) * (1 + (t.stats.trigger || 0))) {
        t.mana = Math.min(cap, it.manaMemo.mana);
        game.emit('proc', { tower: t, name: e.label || 'Restore Mana', x: t.x, z: t.z, fx });
        game.emit('buffFx', { tower: t, kind: 'mana' });
      } else it.manaMemo.mana = t.mana;
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
    case 'stealXp': {
      // Takes experience from a random other tower in range (never below zero).
      const near = towersNear(game, t.x, t.z, e.radius).filter((o) => o !== t && o.xp > 0);
      if (!near.length) break;
      const o = near[Math.floor(game.rng() * near.length)];
      const take = Math.min(o.xp, e.amount + (e.amountPerLevel || 0) * t.level);
      game.giveXp(o, -take);
      game.giveXp(t, take);
      break;
    }
    case 'dropItem': {
      if (e.quality != null) {
        // Forced drops rolled like a creep drop of the target's level, with the carrier's
        // item quality plus `quality`.
        const lv = target.creep?.level ?? game.level;
        for (let i = 0; i < (e.count || 1); i++) game.dropFor(t, lv, e.quality, target.x, target.z);
        break;
      }
      // Creates an item in the stash, as if dropped by a creep.
      const item = game.rollItemAt(e.rarity || 'common', e.uniqueChance || 0, e.itemKind || 'equip');
      if (game.addItem(item)) game.emit('itemDrop', { item, x: target.x, z: target.z, rarity: game.itemDef(item).rarity });
      break;
    }
    case 'resetGrow': {
      if (ctx.item?.bound) { delete ctx.item.bound[e.stat]; game.computeStats(t); }
      break;
    }
    case 'resetGrowSelf': {
      if (t.growth) { delete t.growth[e.stat]; game.computeStats(t); }
      break;
    }
    case 'nextSpellCrit': {
      t.nextSpellCrit = (t.nextSpellCrit || 0) + (e.count || 1);
      break;
    }
    case 'link': {
      // Links this tower to an ally; the ally's spell damage is banked on this tower.
      const o = target.tower;
      if (!o || o === t) break;
      if (t.linkTo === o.uid) break; // already linked: keep the bank and the timer
      if (t.linkTo && game.towers.get(t.linkTo)) game.towers.get(t.linkTo).linkedBy = null;
      t.linkTo = o.uid; t.linkSince = game.time; t.linkBank = 0;
      o.linkedBy = t.uid;
      game.emit('buffFx', { tower: o, kind: fx });
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
    case 'pick': {
      // One of the sub-effects, chosen at random with equal odds.
      applyEffect(game, t, e.effects[Math.floor(game.rng() * e.effects.length)], target, ctx);
      break;
    }
    case 'paceReward': {
      // Rewards attacking a creep of a newer wave soon after the last attack: gold equal to
      // `window` minus the seconds since that attack, plus `xpRatio` of it as experience.
      // State lives on the item (or tower), so it follows the item between carriers.
      const c = target.creep;
      if (!c) break;
      const st = ctx.item || t;
      if (st.paceLevel > 0 && st.paceLevel < c.level) {
        const reward = e.window - (game.time - st.paceTime);
        if (reward > 0) {
          const gold = Math.round(reward);
          if (gold > 0) { game.addGold(gold); game.emit('goldFx', { x: t.x, z: t.z, amount: gold }); }
          game.giveXp(t, reward * (e.xpRatio || 0));
          st.paceTotal = (st.paceTotal || 0) + gold;
        }
      }
      st.paceLevel = Math.max(st.paceLevel || 0, c.level);
      st.paceTime = Math.round(game.time);
      break;
    }
    case 'itemXp': {
      // Experience stored on the item: released into the carrier on equip, and up to
      // `amount` taken back on unequip (levels included), so moving it never duplicates it.
      const st = game.itemState(ctx.item);
      if (ctx.hook === 'unequip') st.xp = game.takeXpFlat(t, e.amount);
      else if (ctx.hook === 'equip') { game.addXpFlat(t, st.xp || 0); st.xp = 0; }
      break;
    }
    case 'duplicateItem': {
      // Loses a charge per wave level while carried. At zero it makes a copy of itself with
      // `growth` more charges (onto the carrier, else the stash) and recharges.
      const it = ctx.item;
      const st = game.itemState(it);
      if (ctx.hook === 'equip') { st.lastLevel = game.level; break; }
      st.lastLevel ??= game.level;
      if (game.level > st.lastLevel) { st.charges -= game.level - st.lastLevel; st.lastLevel = game.level; }
      if (st.charges > 0) break;
      const base = st.base + e.growth;
      const made = game.makeItem(it.id, { state: { charges: base, base } });
      const slot = ctx.hook ? -1 : game.freeSlotFor(t, made);
      if (slot >= 0) game.placeItem(t, slot, made);
      else if (!game.addItem(made)) break; // stash full: keep the charge at zero and retry
      st.charges += st.base;
      game.emit('itemDrop', { item: made, x: t.x, z: t.z, rarity: game.itemDef(made).rarity });
      break;
    }
    case 'buyItem': {
      // Gains a charge every `levelsPerCharge` wave levels (max `maxCharges`, counted even in
      // the stash). Each charge buys a random item of wave level minWave-maxWave for `cost` gold.
      const st = game.itemState(ctx.item);
      st.lastLevel ??= st.born;
      if (game.level > st.lastLevel) {
        st.acc += game.level - st.lastLevel;
        st.lastLevel = game.level;
        if (st.charges >= e.maxCharges) st.acc = 0;
        while (st.acc >= e.levelsPerCharge && st.charges < e.maxCharges) { st.acc -= e.levelsPerCharge; st.charges++; }
      }
      if (ctx.passive) break;
      if (st.charges <= 0) { ctx.fail = 'No purchase charge ready'; return false; }
      if (game.gold < e.cost) { ctx.fail = `Need ${e.cost} gold`; return false; }
      if (game.stash.length >= ECON.stashSize) { ctx.fail = 'Stash is full'; return false; }
      const roll = game.rng();
      const rarity = roll < e.unique ? 'unique' : roll < e.unique + e.rare ? 'rare' : 'uncommon';
      const bought = game.randomItemBetween(rarity, e.minWave, e.maxWave);
      if (!bought || !game.addItem(bought)) return false;
      st.charges--;
      game.gold -= e.cost;
      game.emit('notice', { text: `Bought ${game.itemDef(bought).name} for ${e.cost} gold`, kind: 'item', rarity });
      break;
    }
    case 'moveItem': {
      // The item hops to a random other tower within `radius` that can hold it, or goes
      // back to the stash when none can. Copies have no slot to leave.
      const it = ctx.item;
      const slot = t.items.indexOf(it);
      if (it.copyOf || slot < 0) break;
      const dests = towersNear(game, t.x, t.z, e.radius).filter((o) => o !== t && game.freeSlotFor(o, it) >= 0);
      const to = dests.length ? dests[Math.floor(game.rng() * dests.length)] : null;
      if (!game.transferItem(t, slot, to)) break;
      if (to) game.emit('spellChain', { tower: t, points: [{ x: t.x, z: t.z, y: 2.5 }, { x: to.x, z: to.z, y: 2.5 }], fx });
      else game.emit('notice', { text: `${game.itemDef(it).name} returned to the stash`, kind: 'item' });
      break;
    }
    case 'copyItems': {
      // On equip, copies every other item the carrier holds: their stats and procs apply
      // without using slots (autocast procs stay off). On unequip the copies vanish.
      const it = ctx.item;
      if (it.copyOf) break;
      const st = game.itemState(it);
      for (const cp of st.copies || []) game.itemHook(t, cp, 'unequip');
      st.copies = [];
      if (ctx.hook !== 'equip') break;
      st.copies = t.items.filter((o) => o && o.id !== it.id).map((o) => game.makeItem(o.id, { copyOf: it.uid }));
      for (const cp of st.copies) game.itemHook(t, cp, 'equip');
      break;
    }
    case 'jumpTower': {
      // Teleports the carrier to the free tile within `range` that covers the most creeps,
      // with a timed buff, and brings it back after `dur` seconds. Its own tile stays reserved.
      if (ctx.passive) break;
      if (t.jumpHome) { ctx.fail = 'Already jumping'; return false; }
      const spot = game.jumpSpot(t, e.range);
      if (!spot) { ctx.fail = 'No better free tile in range'; return false; }
      const home = { x: t.x, z: t.z };
      t.jumpHome = home;
      game.emit('proc', { tower: t, name: e.label, x: t.x, z: t.z, fx });
      game.moveTower(t, spot.x, spot.z);
      addTowerBuff(game, t, e.key, e.mods, e.dur, e.label);
      game.emit('buffFx', { tower: t, kind: fx });
      game.delayed.push({ at: game.time + e.dur, fn: () => {
        t.jumpHome = null;
        if (game.towers.has(t.uid)) game.moveTower(t, home.x, home.z);
      } });
      break;
    }
    default: break;
  }
}

// True when every stat a buff changes goes down (a debuff on the receiving tower).
function harmfulMods(mods) {
  for (const k in mods) if (mods[k] >= 0) return false;
  return true;
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
  if (e.stun && (e.stunChance == null || game.rng() < e.stunChance + (e.stunChancePerLevel || 0) * t.level)) {
    const bossCut = c.size === 'boss' || c.size === 'challenge' ? (e.bossStunMult ?? 1) : 1;
    c.stun = Math.max(c.stun, (e.stun + (e.stunPerLevel || 0) * lvl) * resist * bossCut);
    game.emit('stun', c);
  }
  if (e.slow && (e.slowChance == null || game.rng() < e.slowChance + (e.slowChancePerLevel || 0) * t.level)) {
    const pct = (e.slow + (e.slowPerLevel || 0) * t.level) * resist;
    const slowDur = (e.slowDur || 3) + (e.slowDurPerLevel || 0) * t.level;
    if (pct >= c.slow) { c.slow = pct; c.slowT = Math.max(c.slowT, slowDur); }
  }
  if (e.armorStack) {
    // Flat armor loss that stacks per source up to max.
    const k = `${t.def.family}-stack-${e.armorStack.key || ''}`;
    const cur = c.shred[k] || { stacks: 0, armor: e.armorStack.armor, t: 0 };
    cur.stacks = Math.min(e.armorStack.max || 1, cur.stacks + 1);
    cur.armor = e.armorStack.armor + (e.armorStack.armorPerLevel || 0) * t.level;
    cur.t = dur;
    c.shred[k] = cur;
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
    game.addFlatDot(t, c, d.key || t.def.family, d.dps + (d.dpsPerLevel || 0) * lvl, d.dur + (d.durPerLevel || 0) * lvl, d.maxStacks || 1);
  }
  if (e.pushBack) c.dist = Math.max(0, c.dist - e.pushBack);
  // Permanent, stacking bonus to the experience the creep grants when it dies.
  if (e.xpGranted) c.xpGranted = (c.xpGranted || 0) + e.xpGranted;
  if (e.stackVuln) {
    const v = e.stackVuln;
    c.vulnStack ||= {};
    const k = v.key || t.def.family;
    const cur = c.vulnStack[k] || { stacks: 0, pct: v.pct, t: 0, element: v.element, attack: v.attack, spellOnly: v.spellOnly, attacksOnly: v.attacksOnly };
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
  if (e.mark) {
    // Marks from several towers merge, keeping the strongest value of each field.
    const prev = c.mark || {};
    const next = { ...prev, t: Math.max(prev.t || 0, dur) };
    for (const [k, v] of Object.entries(e.mark)) next[k] = Math.max(prev[k] || 0, v);
    c.mark = next;
  }
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
function scaleValue(game, t, kind, target, opts = {}) {
  switch (kind) {
    case 'mana': return t.mana || 0;
    case 'gold': return Math.sqrt(Math.max(0, game.gold));
    case 'livesLost': return game.maxLives - game.lives;
    case 'towers': return game.towers.size;
    case 'towersInRange': return towersNear(game, t.x, t.z, opts.range ?? t.stats.range).length - 1;
    case 'elementTowers': return [...game.towers.values()].filter((o) => o.def.element === t.def.element).length;
    case 'wave': return game.level;
    case 'creepsInRange': return creepsNear(game, t.x, t.z, t.stats.range).length;
    case 'targetMissingHp': return target.creep ? 1 - target.creep.hp / target.creep.maxHp : 0;
    case 'kills': return t.kills;
    case 'goldLinear': return Math.max(0, game.gold);
    case 'towerCost': return t.invested || t.def.totalCost;
    case 'maxMana': return t.stats.maxMana ?? t.maxMana ?? 0;
    default: return 0;
  }
}
