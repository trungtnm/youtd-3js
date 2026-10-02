// Headless game simulation. The 3D world and HUD read this state and listen to
// its events; nothing here touches the DOM or three.js.

import {
  ELEMENT_IDS, RARITIES, DAMAGE_MATRIX, SIZES, DIFFICULTIES, LENGTHS, ECON,
  TOWER_MAX_LEVEL, xpForLevel, ARMOR_REDUCTION,
} from '../data/constants.js';
import { TOWERS, FAMILIES, TOWER_LIST, nextTier, REVEAL_FAMILIES } from '../data/towers.js';
import { addLevelMods } from '../data/youtd/mods.js';
import { ITEMS, ITEMS_BY_RARITY } from '../data/items.js';
import { generateWave, SPECIALS } from './waves.js';
import { PERKS, PERK_LEVELS, perkFits } from '../data/tower-perks.js';
import { SPOILS, SPOIL_IDS } from '../data/boss-spoils.js';
import { GROUND_ROUTE, AIR_ROUTE, sampleRoute, tileToWorld, isBuildable } from './map-layout.js';
import { mulberry32, Emitter } from './rng.js';
import { initAbilities, tickTower, castActive, runProcs, buffMods, tickCreepDebuffs } from './abilities.js';

const BASE_SPEED = 2.6;
// Half-width of a tower in world units; YouTD ranges for tower-to-tower effects start at the edge.
export const TOWER_FOOTPRINT = 0.9;
const PROJECTILE_SPEED = {
  bullet: 46, bolt: 38, thorn: 30, shell: 24, fireball: 22, ember: 28, magma: 16, icebolt: 30,
  snow: 22, spark: 40, wind: 36, coin: 26, star: 30, moon: 20, skull: 22, shadow: 26, scythe: 26,
  leaf: 24, phoenix: 26, spore: 18,
};
const INSTANT = new Set(['lightning', 'beam']);
const STASH_SIZE = ECON.stashSize;

let UID = 1;

export class Game extends Emitter {
  constructor({ difficulty = 'medium', mode = 'build', length = 'full', seed = Date.now() } = {}) {
    super();
    this.cfg = { difficulty, mode, length, seed };
    this.rng = mulberry32(seed);
    this.diff = DIFFICULTIES[difficulty];
    this.finalWave = LENGTHS[length].waves;

    this.gold = Math.round(ECON.startGold * this.diff.gold);
    this.tomes = ECON.startTomes;
    this.lives = 100;
    this.foodCap = Infinity;          // no tower limit; untrained towers are weak instead
    this.food = 0;
    this.score = 0;
    this.time = 0;
    this.phase = 'prep'; // prep | running | won | lost
    this.level = 0;      // last started wave level
    this.nextWaveTimer = 0;
    this.research = Object.fromEntries(ELEMENT_IDS.map((e) => [e, 0]));
    this.bonusInterest = 0;
    this.incomeRate = 0;

    this.towers = new Map();      // uid -> tower
    this.towerGrid = new Map();   // "c,r" -> tower
    this.creeps = [];
    this.projectiles = [];
    this.delayed = [];
    this.activeWaves = [];
    this.stash = [];              // items
    this.towerStash = [];         // random mode: granted tower ids
    this.upcoming = [];
    this.spoils = [];             // pending boss reward offers
    this.stats = { kills: 0, leaks: 0, damage: 0, goldEarned: 0, itemsFound: 0 };

    for (let i = 1; i <= 6; i++) this.upcoming.push(generateWave(i, difficulty, this.rng));
    if (mode === 'random') this.grantRandomTowers(5, true);
  }

  // ------------------------------------------------------------------ queries

  wavePreview(n = 5) { return this.upcoming.slice(0, n); }
  researchCost(el) { return ECON.researchBase + this.research[el]; }

  towerUnlocked(def) {
    return this.research[def.element] >= def.reqLevel;
  }

  canAfford(def, upgrade = false) {
    const gold = upgrade ? def.cost : def.totalCost;
    return this.gold >= gold && this.tomes >= def.tomeCost;
  }

  buildCheck(towerId, c, r) {
    const def = TOWERS[towerId];
    if (!def) return 'Unknown tower';
    if (this.phase === 'won' || this.phase === 'lost') return 'Game over';
    if (!isBuildable(c, r)) return 'Cannot build here';
    if (this.towerGrid.has(`${c},${r}`)) return 'Tile occupied';
    if (this.cfg.mode === 'random' && !this.towerStash.includes(towerId)) return 'Not in your draft';
    // Like YouTD, only the first tier of a family is built; later tiers come from upgrades.
    if (this.cfg.mode === 'build' && def.tier > 0) return 'Build the first tier, then upgrade it';
    if (this.cfg.mode === 'build' && !this.towerUnlocked(def)) return `Requires ${def.element} level ${def.reqLevel}`;
    if (this.gold < def.totalCost) return 'Not enough gold';
    if (this.tomes < def.tomeCost) return 'Not enough tomes';
    return null;
  }

  upgradeCheck(tower) {
    const next = nextTier(tower.def.id);
    if (!next) return 'Max tier';
    if (!this.towerUnlocked(next)) return `Requires ${next.element} level ${next.reqLevel}`;
    if (this.gold < next.cost) return 'Not enough gold';
    if (this.tomes < next.tomeCost) return 'Not enough tomes';
    return null;
  }

  // ------------------------------------------------------------------ player actions

  build(towerId, c, r) {
    const err = this.buildCheck(towerId, c, r);
    if (err) { this.emit('error', err); return null; }
    const def = TOWERS[towerId];
    this.gold -= def.totalCost;
    this.tomes -= def.tomeCost;
    this.food += def.food;
    if (this.cfg.mode === 'random') this.towerStash.splice(this.towerStash.indexOf(towerId), 1);
    const p = tileToWorld(c, r);
    const tower = {
      uid: UID++, def, c, r, x: p.x, z: p.z,
      level: 0, xp: 0, kills: 0, damageDealt: 0, invested: def.totalCost,
      items: new Array(def.slots).fill(null), oil: {}, killStacks: 0, perks: [], perkOffer: null, trained: 0,
      timer: 0.2, abilityTimers: {}, beam: null, priority: 'first', stats: null, aim: 0,
    };
    initAbilities(tower);
    this.towers.set(tower.uid, tower);
    this.towerGrid.set(`${c},${r}`, tower);
    this.recalcAll();
    this.emit('towerBuilt', tower);
    return tower;
  }

  upgrade(tower) {
    const err = this.upgradeCheck(tower);
    if (err) { this.emit('error', err); return false; }
    const next = nextTier(tower.def.id);
    this.gold -= next.cost;
    this.tomes -= next.tomeCost;
    this.food += next.food - tower.def.food;
    tower.invested += next.cost;
    const oldSlots = tower.items;
    tower.def = next;
    tower.items = new Array(next.slots).fill(null);
    const lock = next.abilities.find((a) => a.type === 'itemRarityLock');
    oldSlots.forEach((it, i) => {
      if (!it) return;
      if (lock && ITEMS[it.id].rarity !== lock.rarity) this.addItem(it); else tower.items[i] = it;
    });
    initAbilities(tower);
    this.recalcAll();
    this.emit('towerUpgraded', tower);
    return true;
  }

  sell(tower) {
    const refund = Math.floor(tower.invested * ECON.sellRefund);
    this.gold += refund;
    this.food -= tower.def.food;
    for (const it of tower.items) if (it) this.addItem(it);
    this.towers.delete(tower.uid);
    this.towerGrid.delete(`${tower.c},${tower.r}`);
    this.recalcAll();
    this.emit('towerSold', { tower, refund });
  }

  doResearch(el) {
    const cost = this.researchCost(el);
    if (this.research[el] >= ECON.maxElementLevel) { this.emit('error', 'Element mastered'); return false; }
    if (this.tomes < cost) { this.emit('error', 'Not enough tomes'); return false; }
    this.tomes -= cost;
    this.research[el]++;
    this.emit('research', { element: el, level: this.research[el] });
    return true;
  }

  rerollDraft() {
    if (this.cfg.mode !== 'random') return false;
    if (this.tomes < ECON.rerollCost) { this.emit('error', 'Not enough tomes'); return false; }
    this.tomes -= ECON.rerollCost;
    const n = Math.max(3, this.towerStash.length);
    this.towerStash = [];
    this.grantRandomTowers(n, false);
    return true;
  }

  callNextWave() {
    if (this.phase === 'won' || this.phase === 'lost') return;
    if (this.level >= this.finalWave) return;
    if (this.phase === 'prep') { this.phase = 'running'; this.startWave(); return; }
    const spawning = this.activeWaves.filter((w) => w.idx < w.def.list.length).length;
    if (spawning >= 2) { this.emit('error', 'Too many waves spawning'); return; }
    const bonus = Math.floor(Math.max(0, this.nextWaveTimer) * ECON.earlyCallBonus * (1 + this.level * 0.05));
    if (bonus > 0) { this.addGold(bonus); this.emit('notice', { text: `Early call bonus +${bonus} gold`, kind: 'gold' }); }
    this.startWave();
  }

  setPriority(tower, p) { tower.priority = p; }

  castActive(tower, idx) { return castActive(this, tower, idx, true); }
  toggleAutocast(tower, idx) { const a = tower.actives[idx]; if (a) a.auto = !a.auto; return a?.auto; }
  itemDef(item) { return ITEMS[item.id]; }

  // Launches one regular attack from a tower at a creep.
  fireAt(t, target, base) {
    const kind = t.def.projectile;
    if (kind === 'lightning' || kind === 'beam') {
      this.emit('attack', { tower: t, target, kind: 'lightning' });
      this.resolveHit(t, target, base, { x: target.x, z: target.z });
      return;
    }
    const p = {
      uid: UID++, tower: t, target, kind, base,
      x: t.x, y: 2.4 + t.def.tier * 0.4, z: t.z, sx: t.x, sz: t.z,
      tx: target.x, tz: target.z, speed: PROJECTILE_SPEED[kind] || 26, arc: t.def.arc, t: 0,
    };
    p.total = Math.hypot(p.tx - p.x, p.tz - p.z);
    this.projectiles.push(p);
    this.emit('attack', { tower: t, target, kind, projectile: p });
  }

  // ------------------------------------------------------------------ items

  addItem(item) {
    if (this.stash.length >= STASH_SIZE) { this.emit('notice', { text: 'Item stash full', kind: 'warn' }); return false; }
    this.stash.push(item);
    this.emit('stash');
    return true;
  }

  equip(itemUid, tower, slot = -1) {
    const idx = this.stash.findIndex((i) => i.uid === itemUid);
    if (idx < 0) return false;
    const item = this.stash[idx];
    const def = ITEMS[item.id];
    if (def.kind === 'oil') {
      for (const [k, v] of Object.entries(def.mods)) tower.oil[k] = (tower.oil[k] || 0) + v;
      (tower.oilMods ||= []).push(...def.levelMods);
      this.stash.splice(idx, 1);
      this.recalcAll();
      this.emit('oil', { tower, item });
      this.emit('stash');
      return true;
    }
    if (def.kind !== 'equip') return false;
    const open = this.itemSlots();
    if (slot < 0) slot = tower.items.findIndex((s, i) => !s && i < open);
    if (slot >= open) { this.emit('error', `Item slot ${slot + 1} unlocks at wave ${this.slotUnlockWave(slot)}`); return false; }
    if (slot < 0 || slot >= tower.items.length) {
      this.emit('error', open < 6 ? `Open item slots are full — slot ${open + 1} unlocks at wave ${this.slotUnlockWave(open)}` : 'No free item slot');
      return false;
    }
    const lock = tower.def.abilities.find((a) => a.type === 'itemRarityLock');
    if (lock && def.rarity !== lock.rarity) { this.emit('error', `${tower.def.name} only holds ${lock.rarity} items`); return false; }
    if (def.rarity === 'unique' && tower.items.some((it, i) => it && i !== slot && ITEMS[it.id].rarity === 'unique')) {
      this.emit('error', 'A tower can carry only one unique item');
      return false;
    }
    const prev = tower.items[slot];
    this.stash.splice(idx, 1);
    tower.items[slot] = item;
    if (prev) this.stash.push(prev);
    this.recalcAll();
    this.emit('stash');
    this.emit('equip', { tower, item });
    return true;
  }

  // Item slots open for every tower as the run progresses.
  itemSlots() { return Math.min(6, 1 + Math.floor(this.level / ECON.itemSlotEvery)); }
  slotUnlockWave(slot) { return slot * ECON.itemSlotEvery; }

  unequip(tower, slot) {
    const item = tower.items[slot];
    if (!item) return false;
    if (this.stash.length >= STASH_SIZE) { this.emit('error', 'Item stash full'); return false; }
    tower.items[slot] = null;
    this.stash.push(item);
    this.recalcAll();
    this.emit('stash');
    return true;
  }

  useItem(itemUid) {
    const idx = this.stash.findIndex((i) => i.uid === itemUid);
    if (idx < 0) return false;
    const def = ITEMS[this.stash[idx].id];
    if (def.kind !== 'consumable') return false;
    const e = def.effect;
    if (e.tomes) this.tomes += e.tomes;
    if (e.goldPerLevel) this.addGold(e.goldPerLevel * Math.max(1, this.level));
    if (e.lives) this.lives = Math.min(100, this.lives + e.lives);
    if (e.income) this.incomeRate += e.income;
    this.stash.splice(idx, 1);
    this.emit('stash');
    this.emit('notice', { text: `Used ${def.name}`, kind: 'item' });
    return true;
  }

  // Combine three items of one rarity into a random item of the next rarity.
  transmute(uids) {
    const items = uids.map((u) => this.stash.find((i) => i.uid === u)).filter(Boolean);
    if (items.length !== 3) { this.emit('error', 'Select exactly 3 items'); return null; }
    const rarity = ITEMS[items[0].id].rarity;
    if (!items.every((i) => ITEMS[i.id].rarity === rarity)) { this.emit('error', 'Items must share a rarity'); return null; }
    const order = ['common', 'uncommon', 'rare', 'unique'];
    const nextR = order[Math.min(3, order.indexOf(rarity) + 1)];
    this.stash = this.stash.filter((i) => !uids.includes(i.uid));
    const pool = ITEMS_BY_RARITY[nextR];
    const made = { uid: UID++, id: pool[Math.floor(this.rng() * pool.length)].id };
    this.stash.push(made);
    this.emit('stash');
    this.emit('notice', { text: `Transmuted into ${ITEMS[made.id].name}`, kind: 'item', rarity: nextR });
    return made;
  }

  // ------------------------------------------------------------------ stats

  recalcAll() {
    const towers = [...this.towers.values()];
    // Auras may target any stat channel. Like Warcraft III, different auras stack,
    // while copies of the same aura (same key) only count once, at their strongest.
    const byKey = new Map();
    for (const t of towers) { t.auraMods = {}; byKey.set(t, {}); }
    for (const src of towers) {
      const auras = src.def.abilities.filter((a) => a.type === 'aura' && (!a.minLevel || src.level >= a.minLevel));
      for (const it of src.items) if (it && ITEMS[it.id].aura) auras.push(ITEMS[it.id].aura);
      for (const a of auras) {
        const value = a.value + (a.valuePerLevel || 0) * src.level;
        for (const t of towers) {
          if (a.element && t.def.element !== a.element) continue;
          if (a.rarities && !a.rarities.includes(t.def.rarity)) continue;
          if (a.self === false && t === src) continue;
          if (a.selfOnly && t !== src) continue;
          // YouTD measures aura range from the tower's edge, so add the tower footprint.
          if (Math.hypot(t.x - src.x, t.z - src.z) > a.radius + TOWER_FOOTPRINT) continue;
          const key = `${a.key || a.name || src.def.family}|${a.stat}`;
          const bucket = byKey.get(t);
          const cur = bucket[key];
          if (cur == null || Math.abs(value) > Math.abs(cur.v)) bucket[key] = { stat: a.stat, v: value };
        }
      }
    }
    for (const t of towers) {
      for (const { stat, v } of Object.values(byKey.get(t))) t.auraMods[stat] = (t.auraMods[stat] || 0) + v;
    }
    this.bonusInterest = 0;
    for (const t of towers) {
      const procs = t.def.abilities.concat(...t.items.filter(Boolean).map((it) => ITEMS[it.id].procs || []));
      t.hasEnterProcs = procs.some((p) => p.type === 'proc' && p.on === 'enter');
      t.hasDeathProcs = procs.some((p) => p.type === 'proc' && p.on === 'death');
      this.computeStats(t);
      for (const a of t.def.abilities) if (a.type === 'interest') this.bonusInterest += a.pct;
    }
  }

  computeStats(t) {
    const m = {};
    const add = (mods) => { for (const [k, v] of Object.entries(mods)) m[k] = (m[k] || 0) + v; };
    const lvl0 = t.level;
    addLevelMods(m, t.def.levelMods || [], lvl0);
    for (const it of t.items) if (it) { addLevelMods(m, ITEMS[it.id].levelMods, lvl0); if (it.bound) add(it.bound); if (ITEMS[it.id].staticMods) add(ITEMS[it.id].staticMods); }
    addLevelMods(m, t.oilMods || [], lvl0);
    if (t.buffs?.length) add(buffMods(t));
    for (const id of t.perks) add(PERKS[id].mods);
    if (t.growth) add(t.growth);
    if (t.auraMods) add(t.auraMods);
    // Bonuses that switch on at a tower level (e.g. an extra target at level 15).
    for (const a of t.def.abilities) if (a.type === 'levelBonus' && t.level >= a.level) add(a.mods);
    const ab = (type) => t.def.abilities.find((a) => a.type === type);
    const crit = ab('crit');
    const multi = ab('multishot');
    const lvl = t.level;
    const s = {
      // Experience is the main source of power: level 0 deals 35%, level 5 100%,
      // level 25 ~360%, level 60 ~815%. Items and buffs multiply on top.
      damageMult: (0.35 + 0.13 * lvl) * (1 + (m.damage || 0) + t.killStacks),
      attackSpeed: 1 + (m.attackSpeed || 0) + lvl * 0.02,
      range: t.def.range + (m.range || 0),
      crit: (crit ? crit.chance : 0) + (m.crit || 0) + lvl * 0.004,
      critMult: (crit ? crit.mult : 1.5) + (m.critMult || 0),
      targets: (multi ? multi.count : 1) + (m.multishot || 0),
      spell: m.spell || 0, gold: m.gold || 0, itemFind: m.itemFind || 0,
      xp: m.xp || 0, slowOnHit: m.slowOnHit || 0, dotOnHit: m.dotOnHit || 0,
      vsAir: m.vsAir || 0, vsBoss: m.vsBoss || 0, vsChampion: m.vsChampion || 0, vsMass: m.vsMass || 0,
      manaRegen: m.manaRegen || 0, trigger: m.trigger || 0, spellCrit: (m.spellCrit || 0) + lvl * 0.003,
      multicrit: 1 + (m.multicrit || 0), cdr: Math.min(0.5, m.cdr || 0),
      bounty: m.bounty || 0, buffDur: m.buffDur || 0, spellCritMult: m.spellCritMult || 0,
      flatDamage: m.flatDamage || 0, itemQuality: m.itemQuality || 0,
      vsUndead: m.vsUndead || 0, vsBrute: m.vsBrute || 0, vsHumanoid: m.vsHumanoid || 0, vsFeral: m.vsFeral || 0,
      vsArcane: m.vsArcane || 0, vsNormal: m.vsNormal || 0,
      manaFlat: m.manaFlat || 0, manaPct: m.manaPct || 0, manaRegenFlat: m.manaRegenFlat || 0,
    };
    s.cd = t.def.cd / s.attackSpeed;
    // Attack type can be overridden by an item or an ability (last one wins).
    s.attackType = null;
    for (const a of t.def.abilities) if (a.type === 'attackOverride' && (!a.minLevel || t.level >= a.minLevel)) s.attackType = a.attack;
    for (const it of t.items) if (it && ITEMS[it.id].attackType) s.attackType = ITEMS[it.id].attackType;

    s.flatDamage += (m.dpsAdd || 0) * t.def.cd;
    if (t.maxMana) s.maxMana = (t.maxMana + s.manaFlat) * (1 + s.manaPct);
    s.dmgMin = t.def.damage[0] * s.damageMult + s.flatDamage;
    s.dmgMax = t.def.damage[1] * s.damageMult + s.flatDamage;
    s.dps = ((s.dmgMin + s.dmgMax) / 2) * (1 + s.crit * (s.critMult - 1)) * s.targets / s.cd;
    t.stats = s;
  }

  // ------------------------------------------------------------------ waves

  startWave() {
    const def = this.upcoming.shift();
    this.level = def.level;
    this.upcoming.push(generateWave(def.level + this.upcoming.length + 1, this.cfg.difficulty, this.rng));
    const wave = { def, idx: 0, timer: 0, alive: 0, done: false };
    this.activeWaves.push(wave);
    this.nextWaveTimer = ECON.waveGap + def.list.length * def.interval;
    if (this.cfg.mode === 'random') {
      this.grantRandomTowers(ECON.rollCount, false);
      this.ensureRevealerInDraft();
    }
    this.emit('waveStart', def);
    if (def.level % ECON.itemSlotEvery === 0 && def.level / ECON.itemSlotEvery < 6) {
      this.emit('notice', { text: `Every tower gained an item slot (${this.itemSlots()}/6)`, kind: 'gold' });
      this.emit('stash');
    }
    const soon = this.upcoming.slice(0, 2).find((w) => w.specials.includes('invisible'));
    if (def.specials.includes('invisible') || soon) this.emit('invisibleWarning', { level: def.specials.includes('invisible') ? def.level : soon.level, now: def.specials.includes('invisible'), covered: this.hasRevealer() });
  }

  updateWaves(dt) {
    for (const w of this.activeWaves) {
      if (w.idx < w.def.list.length) {
        w.timer -= dt;
        while (w.timer <= 0 && w.idx < w.def.list.length) {
          this.spawnCreep(w, w.def.list[w.idx++]);
          w.timer += w.def.interval;
        }
      } else if (w.alive <= 0 && !w.done) {
        w.done = true;
        this.onWaveCleared(w);
      }
    }
    this.activeWaves = this.activeWaves.filter((w) => !w.done);

    if (this.phase === 'running' && this.level < this.finalWave) {
      this.nextWaveTimer -= dt;
      if (this.nextWaveTimer <= 0) this.startWave();
    }
    if (this.phase === 'running' && this.level >= this.finalWave && this.activeWaves.length === 0 && this.creeps.length === 0) {
      this.phase = 'won';
      this.emit('victory', this.summary());
    }
  }

  onWaveCleared(w) {
    const lvl = w.def.level;
    const income = Math.round((20 + lvl * 3) * this.diff.gold * (1 + this.incomeRate));
    const interest = Math.min(ECON.interestCap * (1 + lvl / 40), Math.floor(this.gold * (ECON.interestRate + this.bonusInterest)));
    this.addGold(income + interest);
    const tomes = ECON.tomesPerWave + (lvl % 10 === 0 ? 2 : 0);
    this.tomes += tomes;

    this.emit('waveCleared', { level: lvl, income, interest, tomes, challenge: w.def.challenge });
  }

  spawnCreep(wave, sizeId) {
    const def = wave.def;
    const size = SIZES[sizeId];
    const air = sizeId === 'air';
    const route = air ? AIR_ROUTE : GROUND_ROUTE;
    let maxHp = def.hp * size.hp;
    let armor = def.armorValue;
    const has = (s) => def.specials.includes(s);
    if (has('armored')) armor = armor * 1.5 + 3;
    if (sizeId === 'champion' || sizeId === 'boss' || sizeId === 'challenge') armor += 2;
    const c = {
      uid: UID++, wave, level: def.level, size: sizeId, race: def.race, armorType: def.armor,
      armor, maxHp, hp: maxHp, air, route, dist: 0, x: 0, z: 0, dx: 1, dz: 0,
      speed: BASE_SPEED * size.speed * (has('swift') ? 1.35 : 1),
      specials: def.specials, shield: has('shielded') ? maxHp * 0.3 : 0, maxShield: has('shielded') ? maxHp * 0.3 : 0,
      slow: 0, slowT: 0, auraSlow: 0, auraArmor: 0, auraT: 0, stun: 0, dots: [], shred: {}, curse: 0, curseT: 0,
      blinkT: 4 + this.rng() * 3, damageBy: new Map(), alive: true, spawnT: this.time,
      invisible: has('invisible'), revealed: !has('invisible'),
    };
    sampleRoute(route, 0, c);
    wave.alive++;
    this.creeps.push(c);
    this.emit('creepSpawned', c);
    if (sizeId === 'boss' || sizeId === 'challenge') this.emit('bossSpawned', c);
    return c;
  }

  // ------------------------------------------------------------------ random draft

  grantRandomTowers(n, starter) {
    const maxCost = starter ? 40 : 60 + this.level * 45;
    for (let i = 0; i < n; i++) {
      // Element weight grows with research; unresearched elements still appear sometimes.
      const ew = ELEMENT_IDS.map((e) => [e, 0.35 + this.research[e] * 1.2]);
      let total = ew.reduce((s, x) => s + x[1], 0);
      let r = this.rng() * total, el = ew[0][0];
      for (const [e, w] of ew) { if ((r -= w) <= 0) { el = e; break; } }
      const lv = this.research[el];
      const rw = [['common', 70], ['uncommon', 18 + lv * 2], ['rare', lv >= 5 ? 5 + lv : 0], ['unique', lv >= 10 ? lv - 8 : 0]];
      total = rw.reduce((s, x) => s + x[1], 0);
      r = this.rng() * total;
      let rar = 'common';
      for (const [k, w] of rw) { if ((r -= w) <= 0) { rar = k; break; } }
      let pool = TOWER_LIST.filter((t) => t.element === el && t.rarity === rar && t.reqLevel <= lv && t.totalCost <= maxCost);
      if (!pool.length) pool = TOWER_LIST.filter((t) => t.element === el && t.tier === 0 && t.rarity === 'common');
      // Prefer the highest affordable tier of a random family.
      const fams = [...new Set(pool.map((t) => t.family))];
      const famId = fams[Math.floor(this.rng() * fams.length)];
      const best = pool.filter((t) => t.family === famId).sort((a, b) => b.tier - a.tier)[0];
      if (this.towerStash.length < 12) this.towerStash.push(best.id);
    }
    this.emit('draft', this.towerStash);
  }

  // Random mode: if invisible creeps are coming and the player has no way to see
  // them, slip a revealing tower into the draft.
  ensureRevealerInDraft() {
    const soon = this.upcoming.slice(0, 2).some((w) => w.specials.includes('invisible'));
    if (!soon || this.hasRevealer()) return;
    if (this.towerStash.some((id) => REVEAL_FAMILIES.includes(TOWERS[id].family))) return;
    const pick = FAMILIES[REVEAL_FAMILIES[0]]?.tiers[0];
    if (!pick) return;
    this.towerStash.push(pick);
    this.emit('notice', { text: `Invisible creeps ahead: ${TOWERS[pick].name} added to your draft`, kind: 'warn' });
    this.emit('draft', this.towerStash);
  }

  // ------------------------------------------------------------------ main update

  update(dt) {
    if (this.phase === 'won' || this.phase === 'lost') return;
    this.time += dt;
    this.updateWaves(dt);
    this.updateCreeps(dt);
    this.updateReveal();
    this.updateTowers(dt);
    this.updateProjectiles(dt);
    if (this.delayed.length) {
      const now = this.time;
      const due = this.delayed.filter((d) => d.at <= now);
      if (due.length) {
        this.delayed = this.delayed.filter((d) => d.at > now);
        for (const d of due) d.fn();
      }
    }
    if (this.creeps.some((c) => !c.alive)) this.creeps = this.creeps.filter((c) => c.alive);
  }

  updateCreeps(dt) {
    for (const c of this.creeps) {
      if (!c.alive) continue;
      const has = (s) => c.specials.includes(s);
      // Status timers
      if (c.slowT > 0) { c.slowT -= dt; if (c.slowT <= 0) c.slow = 0; }
      if (c.auraT > 0) { c.auraT -= dt; if (c.auraT <= 0) { c.auraSlow = 0; c.auraArmor = 0; c.auraCurse = 0; c.auraVulnSpell = 0; c.auraVulnEl = null; c.auraXp = 0; } }
      if (c.curseT > 0) { c.curseT -= dt; if (c.curseT <= 0) c.curse = 0; }
      for (const k in c.shred) { const s = c.shred[k]; s.t -= dt; if (s.t <= 0) delete c.shred[k]; }
      tickCreepDebuffs(c, dt);

      // Damage over time
      if (c.dots.length) {
        for (const d of c.dots) {
          d.t -= dt;
          const tick = d.dps * Math.min(dt, d.t + dt) * (d.stacks || 1);
          // Flat YouTD-style DoTs are spell damage; burn riders keep the old raw behaviour.
          if (d.flat) { if (this.towers.has(d.src.uid)) this.damage(d.src, c, tick, { spell: true }); }
          else this.applyRaw(d.src, c, tick * (1 + c.curse));
          if (!c.alive) break;
        }
        c.dots = c.dots.filter((d) => d.t > 0);
        if (!c.alive) continue;
      }
      if (has('regen')) c.hp = Math.min(c.maxHp, c.hp + c.maxHp * 0.012 * dt);
      if (has('healer') && c.size === 'champion') {
        for (const o of this.creeps) {
          if (o !== c && o.alive && Math.abs(o.x - c.x) < 5 && Math.abs(o.z - c.z) < 5) o.hp = Math.min(o.maxHp, o.hp + o.maxHp * 0.025 * dt);
        }
      }

      // Movement
      if (c.stun > 0) { c.stun -= dt; continue; }
      const slow = Math.max(c.slow, c.auraSlow);
      let speed = c.speed * (1 - Math.min(0.8, slow));
      if (has('frenzy')) speed *= 1 + 0.6 * (1 - c.hp / c.maxHp);
      c.dist += speed * dt;
      if (has('blink')) {
        c.blinkT -= dt;
        if (c.blinkT <= 0) {
          c.blinkT = 6;
          const from = { x: c.x, z: c.z };
          c.dist += 7;
          sampleRoute(c.route, c.dist, c);
          this.emit('blink', { creep: c, from });
        }
      }
      if (c.dist >= c.route.length) { this.leak(c); continue; }
      sampleRoute(c.route, c.dist, c);
    }
  }

  // Invisible creeps become targetable only inside a revealing tower's radius.
  updateReveal() {
    const revealers = [];
    for (const t of this.towers.values()) {
      const a = t.def.abilities.find((x) => x.type === 'reveal') || t.items.map((it) => it && ITEMS[it.id].reveal).find(Boolean);
      if (a) revealers.push({ x: t.x, z: t.z, r2: a.radius * a.radius });
    }
    for (const c of this.creeps) {
      if (!c.invisible) continue;
      c.revealed = revealers.some((v) => (c.x - v.x) ** 2 + (c.z - v.z) ** 2 <= v.r2);
    }
  }

  hasRevealer() {
    for (const t of this.towers.values()) if (t.def.abilities.some((a) => a.type === 'reveal') || t.items.some((it) => it && ITEMS[it.id].reveal)) return true;
    return false;
  }

  leak(c) {
    c.alive = false;
    c.wave.alive--;
    const size = SIZES[c.size];
    this.stats.leaks++;
    if (size.leak > 0) {
      this.lives -= size.leak;
      if (c.specials.includes('raider')) {
        const stolen = Math.floor(this.gold * 0.06);
        this.gold -= stolen;
        this.emit('notice', { text: `A Relic Raider stole ${stolen} gold!`, kind: 'warn' });
      }
    }
    this.emit('creepLeaked', c);
    if (this.lives <= 0 && this.phase !== 'lost') {
      this.lives = 0;
      this.phase = 'lost';
      this.emit('defeat', this.summary());
    }
  }

  effectiveArmor(c) {
    let shred = 0;
    for (const k in c.shred) shred += c.shred[k].armor * c.shred[k].stacks;
    return c.armor - shred - c.auraArmor;
  }

  findTargets(t, n) {
    const r2 = t.stats.range * t.stats.range;
    const inRange = [];
    for (const c of this.creeps) {
      if (!c.alive || !c.revealed) continue;
      if ((t.def.targets === 'air' && !c.air) || (t.def.targets === 'ground' && c.air)) continue;
      const dx = c.x - t.x, dz = c.z - t.z;
      if (dx * dx + dz * dz <= r2) inRange.push(c);
    }
    if (!inRange.length) return inRange;
    if (t.def.abilities.some((a) => a.type === 'randomTarget')) {
      for (let i = inRange.length - 1; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); [inRange[i], inRange[j]] = [inRange[j], inRange[i]]; }
      return inRange.slice(0, n);
    }
    const key = {
      first: (c) => -c.dist / c.route.length,
      last: (c) => c.dist / c.route.length,
      strong: (c) => -c.hp,
      weak: (c) => c.hp,
    }[t.priority] || ((c) => -c.dist);
    inRange.sort((a, b) => key(a) - key(b));
    return inRange.slice(0, n);
  }

  updateTowers(dt) {
    for (const t of this.towers.values()) {
      tickTower(this, t, dt);
      runProcs(this, t, 'periodic', {});
      if (t.hasEnterProcs) {
        // 'enter' procs fire once per creep when it first comes into range.
        const r2 = t.stats.range ** 2;
        t.seen ||= new Set();
        for (const c of this.creeps) {
          if (!c.alive || t.seen.has(c.uid)) continue;
          if ((c.x - t.x) ** 2 + (c.z - t.z) ** 2 <= r2) { t.seen.add(c.uid); runProcs(this, t, 'enter', { creep: c }); }
        }
        if (t.seen.size > 400) t.seen = new Set([...t.seen].slice(-200));
      }
      const s = t.stats;
      // Passive abilities that tick independently of attacks
      for (const a of t.def.abilities) {
        if (a.type === 'creepAura') {
          const r2 = a.radius * a.radius;
          for (const c of this.creeps) {
            if (!c.alive) continue;
            const dx = c.x - t.x, dz = c.z - t.z;
            if (dx * dx + dz * dz > r2) continue;
            const resist = c.specials.includes('unyielding') ? 0.4 : 1;
            const lv = t.level;
            if (a.slow) c.auraSlow = Math.max(c.auraSlow, (a.slow + (a.slowPerLevel || 0) * lv) * resist);
            if (a.armor) c.auraArmor = Math.max(c.auraArmor, a.armor + (a.armorPerLevel || 0) * lv);
            if (a.curse) c.auraCurse = Math.max(c.auraCurse || 0, a.curse + (a.cursePerLevel || 0) * lv);
            if (a.vulnSpell) c.auraVulnSpell = Math.max(c.auraVulnSpell || 0, a.vulnSpell + (a.vulnSpellPerLevel || 0) * lv);
            if (a.vulnElement) { c.auraVulnEl ||= {}; c.auraVulnEl[a.vulnElement.el] = Math.max(c.auraVulnEl[a.vulnElement.el] || 0, a.vulnElement.pct); }
            if (a.xpBonus) c.auraXp = Math.max(c.auraXp || 0, a.xpBonus + (a.xpBonusPerLevel || 0) * lv);
            c.auraT = 0.3;
          }
        } else if (a.type === 'nova' || a.type === 'meteor') {
          t.abilityTimers[a.type] = (t.abilityTimers[a.type] || 0) + dt * s.attackSpeed;
          if (t.abilityTimers[a.type] >= a.interval) {
            if (a.type === 'nova' ? this.castNova(t, a) : this.castMeteor(t, a)) t.abilityTimers[a.type] = 0;
            else t.abilityTimers[a.type] = a.interval;
          }
        }
      }

      if (t.def.canAttack === false) continue;
      t.timer -= dt;
      if (t.timer > 0) continue;
      const mpa = t.def.abilities.find((a) => a.type === 'manaPerAttack');
      if (mpa && mpa.cost && (t.mana || 0) < mpa.cost) { t.timer = 0; continue; }
      const targets = this.findTargets(t, s.targets);
      if (!targets.length) { t.timer = 0; t.beam = null; t.beamRamp = 1; t.idle = (t.idle || 0) + dt; continue; }
      const charge = t.def.abilities.find((a) => a.type === 'charge');
      const chargeMult = charge ? 1 + Math.min(charge.cap, (t.idle || 0) * charge.rate) : 1;
      if (charge && chargeMult > 1.3) this.emit('proc', { tower: t, name: charge.name, x: targets[0].x, z: targets[0].z, fx: 'iron' });
      t.idle = 0;
      t.timer += s.cd;
      if (t.timer < 0) t.timer = 0;
      const first = targets[0];
      t.aim = Math.atan2(first.x - t.x, first.z - t.z);

      for (const target of targets) {
        const base = (s.dmgMin + this.rng() * (s.dmgMax - s.dmgMin)) * chargeMult;
        const kind = t.def.projectile;
        if (kind === 'beam') {
          const beamAb = t.def.abilities.find((a) => a.type === 'beam');
          if (t.beam === target.uid) t.beamRamp = Math.min(beamAb.max, (t.beamRamp || 1) + beamAb.ramp * s.cd);
          else { t.beam = target.uid; t.beamRamp = 1; }
          this.resolveHit(t, target, base * t.beamRamp, { x: target.x, z: target.z });
        } else this.fireAt(t, target, base);
      }
      if (mpa) {
        const cap = t.stats.maxMana ?? t.maxMana ?? 0;
        t.mana = Math.max(0, Math.min(cap, (t.mana || 0) - (mpa.cost || 0) + (mpa.gain || 0) + (mpa.gainPerLevel || 0) * t.level));
      }
      runProcs(this, t, 'attack', { creep: first });
    }
  }

  updateProjectiles(dt) {
    const keep = [];
    for (const p of this.projectiles) {
      if (p.target.alive) { p.tx = p.target.x; p.tz = p.target.z; }
      const dx = p.tx - p.x, dz = p.tz - p.z;
      const d = Math.hypot(dx, dz);
      const step = p.speed * dt;
      if (d <= step + 0.3) {
        p.x = p.tx; p.z = p.tz;
        if (p.target.alive) this.resolveHit(p.tower, p.target, p.base, p);
        else this.resolveSplashOnly(p.tower, p.base, p);
        this.emit('impact', p);
        continue;
      }
      p.x += (dx / d) * step;
      p.z += (dz / d) * step;
      p.t = 1 - d / Math.max(p.total, 0.01);
      keep.push(p);
    }
    this.projectiles = keep;
  }

  // ------------------------------------------------------------------ damage

  damageMultiplier(t, c, spell) {
    const s = t.stats;
    let m;
    if (spell) {
      m = 1 + s.spell;
      if (c.specials.includes('warded')) m *= 0.4;
    } else {
      const attack = t.stats.attackType || t.def.attack;
      if (attack === 'arcane' && c.specials.includes('warded')) return 0;
      m = DAMAGE_MATRIX[attack][c.armorType] * (1 - ARMOR_REDUCTION(this.effectiveArmor(c)));
    }
    for (const a of t.def.abilities) {
      if (a.type === 'bonusVs') {
        if ((a.key === 'race' && c.race === a.value) || (a.key === 'size' && c.size === a.value)) m *= 1 + a.pct;
      } else if (a.type === 'bonusVsSlowed' && (c.slow > 0 || c.auraSlow > 0 || c.stun > 0)) m *= 1 + a.pct;
    }
    if (c.air) m *= 1 + s.vsAir;
    if (c.size === 'boss' || c.size === 'challenge') m *= 1 + s.vsBoss;
    if (c.size === 'champion') m *= 1 + s.vsChampion;
    if (c.size === 'normal') m *= 1 + s.vsNormal;
    const raceBonus = { undead: s.vsUndead, brute: s.vsBrute, humanoid: s.vsHumanoid, feral: s.vsFeral, arcane: s.vsArcane }[c.race];
    if (raceBonus) m *= 1 + raceBonus;
    if (c.size === 'mass' || c.size === 'challengeMass') m *= 1 + s.vsMass;
    if (spell && (c.vulnSpell || c.auraVulnSpell)) m *= 1 + Math.max(c.vulnSpell || 0, c.auraVulnSpell || 0);
    if (c.auraCurse) m *= 1 + c.auraCurse;
    if (c.auraVulnEl?.[t.def.element]) m *= 1 + c.auraVulnEl[t.def.element];
    if (c.vulnStack) {
      for (const k in c.vulnStack) {
        const v = c.vulnStack[k];
        if (v.element && v.element !== t.def.element) continue;
        if (v.attack && v.attack !== t.def.attack) continue;
        if (v.spellOnly && !spell) continue;
        if (v.attacksOnly && spell) continue;
        m *= 1 + v.stacks * v.pct;
      }
    }
    const ev = c.vulnEl?.[t.def.element];
    if (ev) m *= 1 + ev.pct;
    return m * (1 + c.curse);
  }

  // Primary hit from an attack: crit, procs, splash and chain.
  resolveHit(t, c, base, at) {
    const s = t.stats;
    if (c.specials.includes('evasive') && this.rng() < 0.2) { this.emit('miss', c); return; }
    const miss = t.def.abilities.find((a) => a.type === 'miss');
    if (miss && this.rng() < Math.max(0, miss.base + miss.perLevel * t.level)) { this.emit('miss', c); return; }
    let dmg = base;
    let crit = false;
    for (let i = 0; i < s.multicrit; i++) {
      if (this.rng() >= s.crit) break;
      dmg *= i === 0 ? s.critMult : 1 + (s.critMult - 1) * 0.5;
      crit = true;
    }
    const dealt = this.damage(t, c, dmg, { crit });
    this.applyOnHit(t, c, dealt > 0 ? dmg : 0, true);
    // On-hit procs fire for every damaging hit, including the killing blow; single-target
    // effects skip dead creeps on their own, area effects still hit the neighbours.
    if (dealt > 0) runProcs(this, t, 'hit', { creep: c, damage: dmg, crit });
    if (crit && c.alive) runProcs(this, t, 'crit', { creep: c, damage: dmg, crit });
    for (const a of t.def.abilities) {
      if (a.type === 'strike' && c.alive && this.rng() < a.chance) {
        this.emit('strike', { tower: t, x: c.x, z: c.z });
        this.damage(t, c, base * a.mult, { spell: true, big: true });
      } else if (a.type === 'execute' && c.alive && c.size !== 'boss' && c.size !== 'challenge' && c.hp / c.maxHp < a.pct) {
        this.emit('execute', c);
        this.damage(t, c, c.hp + c.shield + 1, { pure: true });
      }
    }
    this.resolveSplash(t, base, at, c);
    const chain = t.def.abilities.find((a) => a.type === 'chain');
    if (chain) this.resolveChain(t, c, base, chain);
  }

  resolveSplashOnly(t, base, at) { this.resolveSplash(t, base, at, null); }

  resolveSplash(t, base, at, primary) {
    const sp = t.def.abilities.find((a) => a.type === 'splash');
    if (!sp) return;
    const rings = sp.rings || [{ radius: sp.radius, pct: sp.pct }];
    const r2 = sp.radius * sp.radius;
    for (const o of this.creeps) {
      if (!o.alive || o === primary) continue;
      const dx = o.x - at.x, dz = o.z - at.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > r2) continue;
      const ring = rings.find((r) => d2 <= r.radius * r.radius) || rings[rings.length - 1];
      this.damage(t, o, base * ring.pct, { splash: true });
      this.applyOnHit(t, o, base * ring.pct, false);
    }
    this.emit('splash', { tower: t, x: at.x, z: at.z, radius: sp.radius });
  }

  resolveChain(t, from, base, a) {
    const hit = new Set([from.uid]);
    const points = [{ x: from.x, z: from.z }];
    let cur = from, dmg = base;
    for (let i = 0; i < a.count; i++) {
      let best = null, bd = a.range * a.range;
      for (const o of this.creeps) {
        if (!o.alive || !o.revealed || hit.has(o.uid)) continue;
        const d = (o.x - cur.x) ** 2 + (o.z - cur.z) ** 2;
        if (d < bd) { bd = d; best = o; }
      }
      if (!best) break;
      dmg *= 1 - a.falloff;
      hit.add(best.uid);
      points.push({ x: best.x, z: best.z });
      this.damage(t, best, dmg, {});
      this.applyOnHit(t, best, dmg, false);
      cur = best;
    }
    if (points.length > 1) this.emit('chain', { tower: t, points });
  }

  applyOnHit(t, c, dmg, primary) {
    if (!c.alive) return;
    const s = t.stats;
    const resist = c.specials.includes('unyielding') ? 0.4 : 1;
    const slowIt = (pct, dur) => {
      pct *= resist;
      if (pct >= c.slow) { c.slow = pct; c.slowT = Math.max(c.slowT, dur); }
    };
    for (const a of t.def.abilities) {
      switch (a.type) {
        case 'slow': slowIt(a.pct, a.dur); break;
        case 'dot': this.addDot(t, c, dmg * a.pct, a.dur); break;
        case 'stun': if (primary && this.rng() < a.chance) { c.stun = Math.max(c.stun, a.dur * resist); this.emit('stun', c); } break;
        case 'shred': if (primary) {
          const k = t.def.family;
          const cur = c.shred[k] || { stacks: 0, armor: a.armor, t: 0 };
          cur.stacks = Math.min(a.maxStacks, cur.stacks + 1);
          cur.armor = a.armor; cur.t = a.dur;
          c.shred[k] = cur;
        } break;
        case 'curse': if (primary && a.pct >= c.curse) { c.curse = a.pct; c.curseT = a.dur; } break;
        default: break;
      }
    }
    if (s.slowOnHit) slowIt(s.slowOnHit, 1.5);
    if (s.dotOnHit && primary) this.addDot(t, c, dmg * s.dotOnHit, 3);
  }

  // Flat damage-over-time that stacks per source and key, refreshing duration.
  addFlatDot(t, c, key, dps, dur, maxStacks) {
    if (dps <= 0) return;
    const existing = c.dots.find((d) => d.flat && d.src === t && d.key === key);
    if (existing) { existing.stacks = Math.min(maxStacks, existing.stacks + 1); existing.dps = dps; existing.t = dur; return; }
    if (c.dots.length >= 10) c.dots.sort((a, b) => a.dps * (a.stacks || 1) - b.dps * (b.stacks || 1)).shift();
    c.dots.push({ src: t, key, dps, t: dur, stacks: 1, flat: true });
  }

  addDot(t, c, dps, dur) {
    if (dps <= 0) return;
    const existing = c.dots.find((d) => d.src === t && !d.flat);
    if (existing) { existing.dps = Math.max(existing.dps, dps); existing.t = dur; return; }
    if (c.dots.length >= 6) c.dots.sort((a, b) => a.dps - b.dps).shift();
    c.dots.push({ src: t, dps, t: dur });
  }

  castNova(t, a) {
    const r2 = a.radius * a.radius;
    const hits = this.creeps.filter((c) => c.alive && (c.x - t.x) ** 2 + (c.z - t.z) ** 2 <= r2);
    if (!hits.length) return false;
    const s = t.stats;
    const base = ((t.def.damage[0] + t.def.damage[1]) / 2) * s.damageMult * a.mult;
    this.emit('nova', { tower: t, radius: a.radius, fx: a.fx || 'nova' });
    for (const c of hits) {
      this.damage(t, c, base, { spell: true, big: true });
      if (!c.alive) continue;
      const resist = c.specials.includes('unyielding') ? 0.4 : 1;
      if (a.stun) c.stun = Math.max(c.stun, a.stun * resist);
      if (a.curse && a.curse >= c.curse) { c.curse = a.curse; c.curseT = 4; }
    }
    return true;
  }

  castMeteor(t, a) {
    const r2 = t.stats.range * t.stats.range;
    const cands = this.creeps.filter((c) => c.alive && c.revealed && (c.x - t.x) ** 2 + (c.z - t.z) ** 2 <= r2);
    if (!cands.length) return false;
    let best = cands[0], bestN = -1;
    for (const c of cands) {
      let n = 0;
      for (const o of cands) if ((o.x - c.x) ** 2 + (o.z - c.z) ** 2 < a.radius * a.radius) n++;
      if (n > bestN) { bestN = n; best = c; }
    }
    // Lead the target slightly so the meteor lands where it will be.
    const lead = sampleRoute(best.route, best.dist + best.speed * 0.9 * (1 - best.slow), {});
    const pos = { x: lead.x, z: lead.z };
    this.emit('meteorCast', { tower: t, x: pos.x, z: pos.z, delay: 0.9, radius: a.radius });
    const base = ((t.def.damage[0] + t.def.damage[1]) / 2) * t.stats.damageMult * a.mult;
    this.delayed.push({ at: this.time + 0.9, fn: () => {
      if (!this.towers.has(t.uid)) return;
      this.emit('meteorImpact', { x: pos.x, z: pos.z, radius: a.radius });
      for (const c of this.creeps) {
        if (!c.alive || (c.x - pos.x) ** 2 + (c.z - pos.z) ** 2 > a.radius * a.radius) continue;
        this.damage(t, c, base, { spell: true, big: true });
        this.addDot(t, c, base * 0.08, 3);
      }
    } });
    return true;
  }

  // Applies one instance of damage through armor, multipliers and shields.
  damage(t, c, amount, opts) {
    if (!c.alive) return 0;
    const mult = opts.pure ? 1 : this.damageMultiplier(t, c, !!opts.spell);
    if (mult <= 0) { this.emit('immune', c); return 0; }
    let dmg = amount * mult;
    const forcedCrit = opts.spell && t && t.nextSpellCrit > 0;
    if (forcedCrit) t.nextSpellCrit--;
    if (opts.spell && t && (forcedCrit || this.rng() < t.stats.spellCrit)) { dmg *= 1.5 + (t.stats.spellCritMult || 0); opts = { ...opts, crit: true }; }
    // Spell damage from a linked tower is banked on the tower that linked it.
    if (opts.spell && t?.linkedBy) { const lk = this.towers.get(t.linkedBy); if (lk && lk.linkTo === t.uid) lk.linkBank = (lk.linkBank || 0) + dmg; }
    if (c.shield > 0) {
      const absorbed = Math.min(c.shield, dmg);
      c.shield -= absorbed;
      dmg -= absorbed;
      if (c.shield <= 0) this.emit('shieldBreak', c);
    }
    this.applyRaw(t, c, dmg, opts);
    return amount * mult;
  }

  applyRaw(t, c, dmg, opts = {}) {
    if (!c.alive || dmg <= 0) return;
    const hpBefore = c.hp;
    c.hp -= dmg;
    this.stats.damage += dmg;
    if (t) {
      t.damageDealt += dmg;
      c.damageBy.set(t, (c.damageBy.get(t) || 0) + dmg);
      if (c.mark?.xpChance && c.mark.left !== 0 && this.rng() < c.mark.xpChance) {
        c.mark.left = (c.mark.left ?? 10) - 1;
        this.giveXp(t, 1);
      }
    }
    if (opts.crit || opts.big) this.emit('damageText', { x: c.x, z: c.z, amount: dmg, crit: !!opts.crit, spell: !!opts.spell });
    if (c.hp <= 0) this.kill(c, t, Math.max(0, dmg - hpBefore));
  }

  kill(c, killer, overkill = 0) {
    if (!c.alive) return;
    c.alive = false;
    c.hp = 0;
    c.wave.alive--;
    const size = SIZES[c.size];
    const has = (s) => c.specials.includes(s);
    this.stats.kills++;

    // Gold
    let bounty = (3 + c.level * 0.6) * size.bounty * this.diff.gold;
    if (has('rich')) bounty *= 2;
    if (c.mark?.bounty) bounty *= 1 + c.mark.bounty;
    if (killer) {
      bounty *= 1 + killer.stats.bounty;
      bounty += killer.stats.gold;
      for (const a of killer.def.abilities) if (a.type === 'goldOnKill') bounty += a.amount;
    }
    bounty = Math.max(1, Math.round(bounty));
    this.addGold(bounty);
    this.score += Math.round(size.score * c.level * (this.diff.hp));

    // Experience: half to the killer, the rest shared by damage contribution.
    // auraXp: creeps inside an experience aura grant more experience when they die.
    const xpTotal = size.xp * 6 * (has('wise') ? 2 : 1) * (1 + c.level * 0.02) * (1 + (c.auraXp || 0));
    let totalDmg = 0;
    for (const v of c.damageBy.values()) totalDmg += v;
    for (const [t, d] of c.damageBy) {
      if (!this.towers.has(t.uid)) continue;
      let share = xpTotal * 0.5 * (d / Math.max(1, totalDmg));
      if (t === killer) share += xpTotal * 0.5;
      this.giveXp(t, share);
    }
    if (killer && this.towers.has(killer.uid)) {
      killer.kills++;
      runProcs(this, killer, 'kill', { creep: c, overkill });
      for (const a of killer.def.abilities) {
        if (a.type === 'killStack') { killer.killStacks = Math.min(a.max, killer.killStacks + a.pct); this.computeStats(killer); }
        if (a.type === 'tomeOnKill' && this.rng() < a.chance) { this.tomes++; this.emit('tomeDrop', { x: c.x, z: c.z }); }
      }
    }
    if (has('wise') && this.rng() < 0.04) { this.tomes++; this.emit('tomeDrop', { x: c.x, z: c.z }); }

    this.rollDrops(c, killer);
    this.emit('creepDied', { creep: c, bounty, killer });
    // 'death' procs fire for any creep dying within the tower's range, whoever killed it.
    for (const t of this.towers.values()) {
      if (!t.hasDeathProcs) continue;
      if ((c.x - t.x) ** 2 + (c.z - t.z) ** 2 <= (t.deathRange || t.stats.range) ** 2) runProcs(this, t, 'death', { creep: c, overkill, killer });
    }
    if (c.size === 'boss' || c.size === 'challenge') this.offerSpoils(c);

    if (has('splitter') && c.size !== 'mass') {
      for (let i = 0; i < 2; i++) {
        const child = this.spawnCreep(c.wave, 'mass');
        child.maxHp = child.hp = c.maxHp * 0.25;
        child.specials = c.specials.filter((s) => s !== 'splitter');
        child.route = c.route; child.air = c.air;
        child.dist = Math.max(0, c.dist - i * 0.8);
        sampleRoute(child.route, child.dist, child);
      }
    }
  }

  giveXp(t, amount) {
    // Experience costs never drop a tower below the start of its current level.
    if (amount < 0) { t.xp = Math.max(0, t.xp + amount); return; }
    if (t.level >= TOWER_MAX_LEVEL) return;
    t.xp += amount * (1 + t.stats.xp);
    let leveled = false;
    while (t.level < TOWER_MAX_LEVEL && t.xp >= xpForLevel(t.level)) {
      t.xp -= xpForLevel(t.level);
      t.level++;
      leveled = true;
    }
    if (leveled) {
      // Auras can grow per level or unlock at a level, so refresh them for everyone.
      const hasAura = t.def.abilities.some((a) => a.type === 'aura') || t.items.some((it) => it && ITEMS[it.id].aura);
      if (hasAura) this.recalcAll(); else this.computeStats(t);
      this.emit('levelUp', t);
      this.offerPerk(t);
    }
  }

  // At each milestone level the tower offers three perks; the player keeps one.
  offerPerk(t) {
    if (t.perkOffer) return;
    const earned = PERK_LEVELS.filter((l) => t.level >= l).length;
    if (t.perks.length >= earned) return;
    const pool = Object.keys(PERKS).filter((id) => perkFits(t, id));
    const offer = [];
    while (offer.length < 3 && pool.length) offer.push(pool.splice(Math.floor(this.rng() * pool.length), 1)[0]);
    t.perkOffer = offer;
    this.emit('perkReady', t);
  }

  choosePerk(t, id) {
    if (!t.perkOffer?.includes(id)) return false;
    t.perks.push(id);
    t.perkOffer = null;
    this.computeStats(t);
    this.emit('perkChosen', { tower: t, perk: id });
    this.offerPerk(t); // several milestones may be pending
    return true;
  }

  trainCost(t) { return Math.round(ECON.trainBase * (1 + t.level * 0.5) * (1 + t.trained * 0.04)); }

  // Spend gold to grant experience: the gold sink once the tower limit is full.
  train(t) {
    if (t.level >= TOWER_MAX_LEVEL) { this.emit('error', 'Tower is at max level'); return false; }
    const cost = this.trainCost(t);
    if (this.gold < cost) { this.emit('error', 'Not enough gold'); return false; }
    this.gold -= cost;
    t.trained++;
    this.giveXp(t, xpForLevel(t.level) * ECON.trainXpPct / (1 + t.stats.xp));
    this.emit('trained', t);
    return true;
  }

  // ------------------------------------------------------------------ boss spoils

  // Items of a rarity that may drop at this wave (falls back to the whole rarity).
  itemPool(rarity, level, kind) {
    const all = ITEMS_BY_RARITY[rarity].filter((d) => !kind || d.kind === kind);
    const ok = all.filter((d) => d.reqWave <= Math.max(1, level));
    return ok.length ? ok : all;
  }

  rollItemAt(minRarity, uniqueChance, kind = 'equip') {
    const rarity = this.rng() < uniqueChance ? 'unique' : minRarity;
    const list = this.itemPool(rarity, this.level + 5, kind);
    return { uid: UID++, id: list[Math.floor(this.rng() * list.length)].id };
  }

  // A fallen boss offers three rewards: always one rolled item, plus two from the pool.
  offerSpoils(c) {
    const challenge = c.size === 'challenge';
    const uniqueChance = Math.min(0.6, (challenge ? 0.3 : 0.12) + c.level * 0.004);
    const options = [{ type: 'item', item: this.rollItemAt('rare', uniqueChance) }];
    if (challenge) options.push({ type: 'item', item: this.rollItemAt('rare', uniqueChance) });
    const pool = SPOIL_IDS.filter((id) => !SPOILS[id].when || SPOILS[id].when(this));
    while (options.length < 3 && pool.length) {
      const total = pool.reduce((sum, id) => sum + SPOILS[id].weight, 0);
      let r = this.rng() * total, pick = pool[0];
      for (const id of pool) { if ((r -= SPOILS[id].weight) <= 0) { pick = id; break; } }
      pool.splice(pool.indexOf(pick), 1);
      const opt = { type: pick, value: SPOILS[pick].value(this) };
      if (pick === 'oil') opt.item = this.rollItemAt(this.rng() < 0.35 ? 'unique' : 'rare', 0, 'oil');
      options.push(opt);
    }
    this.spoils.push({ level: c.level, challenge, options });
    this.emit('spoilsReady', this.spoils[0]);
  }

  chooseSpoil(index) {
    const offer = this.spoils[0];
    const o = offer?.options[index];
    if (!o) return false;
    if ((o.type === 'item' || o.type === 'oil') && this.stash.length >= STASH_SIZE) { this.emit('error', 'Item stash full'); return false; }
    switch (o.type) {
      case 'item': case 'oil': this.addItem(o.item); break;
      case 'gold': this.addGold(o.value); break;
      case 'tomes': this.tomes += o.value; break;
      case 'wisdom': for (const t of this.towers.values()) this.giveXp(t, xpForLevel(t.level) * o.value / (1 + t.stats.xp)); break;
      case 'mend': this.lives = Math.min(100, this.lives + o.value); break;
      case 'hero': {
        // Your highest-level tower gains whole levels.
        const best = [...this.towers.values()].sort((a, b) => b.level - a.level || b.stats.dps - a.stats.dps)[0];
        if (best) for (let i = 0; i < o.value; i++) this.giveXp(best, (xpForLevel(best.level) - best.xp) / (1 + best.stats.xp) + 0.01);
        break;
      }
      default: break;
    }
    this.spoils.shift();
    this.emit('spoilChosen', o);
    if (this.spoils.length) this.emit('spoilsReady', this.spoils[0]);
    return true;
  }

  rollDrops(c, killer) {
    const size = SIZES[c.size];
    const find = 1 + (killer ? killer.stats.itemFind : 0) + (c.mark?.itemChance || 0);
    const chance = 0.035 * find;
    let rolls = size.drops;
    let found = 0;
    for (let i = 0; i < rolls && found < 3; i++) {
      if (this.rng() >= chance) continue;
      found++;
      const lv = c.level;
      const q = this.rng();
      const quality = 1 + (killer ? killer.stats.itemQuality : 0) + (c.mark?.itemQuality || 0);
      const uniqueP = (0.01 + lv * 0.0004) * quality, rareP = (0.06 + lv * 0.0012) * quality, uncP = 0.26 + lv * 0.0015;
      let rarity = 'common';
      if (q < uniqueP) rarity = 'unique';
      else if (q < uniqueP + rareP) rarity = 'rare';
      else if (q < uniqueP + rareP + uncP) rarity = 'uncommon';
      const pool = this.itemPool(rarity, lv);
      const def = pool[Math.floor(this.rng() * pool.length)];
      const item = { uid: UID++, id: def.id };
      this.stats.itemsFound++;
      if (this.addItem(item)) this.emit('itemDrop', { item, x: c.x, z: c.z, rarity });
    }
  }

  addGold(n) {
    this.gold += n;
    this.stats.goldEarned += n;
  }

  summary() {
    return {
      level: this.level, score: this.score, kills: this.stats.kills, leaks: this.stats.leaks,
      damage: this.stats.damage, gold: this.stats.goldEarned, items: this.stats.itemsFound,
      towers: this.towers.size, time: this.time, cfg: this.cfg,
    };
  }
}

export { TOWERS, FAMILIES, SPECIALS };
