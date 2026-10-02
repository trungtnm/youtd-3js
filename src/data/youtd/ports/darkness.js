// Ported darkness tower behaviors, keyed by YouTD 2 script name (MIT, see third_party/youtd2).
// Mechanics are re-implemented with this game's ability engine; descriptions are our own.

// eslint-disable-next-line no-unused-vars
import { UNIT, at, proc, autocast } from './helpers.js';
import { xpForLevel } from '../../constants.js';

// Radius in world units, rounded so generated descriptions stay readable.
const R = (wc3) => Math.round((wc3 / UNIT) * 10) / 10;
// Average base attack damage of the tower row.
const avgDmg = (row) => (row.dmg[0] + row.dmg[1]) / 2;
// Towers whose YouTD mana does not regenerate: the engine gives every pool a default
// regeneration, so a -100% regeneration bonus from level 0 cancels it.
const noRegen = { type: 'levelBonus', level: 0, mods: { manaRegen: -1 } };
// Radius that reaches only the tower itself (tiles are 2 apart), for self effects
// inside a multi whose target is another tower.
const SELF = { center: 'self', radius: 0.01 };
// Total experience a tower has banked when it starts level `lvl`.
const xpTotal = (lvl) => { let s = 0; for (let l = 0; l < lvl; l++) s += xpForLevel(l); return s; };

export const PORTS = {
  tombstone: {
    passives: (row) => {
      const [chance, add] = at([[0.008, 0.0015], [0.010, 0.0017], [0.012, 0.0020], [0.014, 0.0022], [0.016, 0.0024], [0.020, 0.0025]], row);
      return [proc("Tomb's Curse", 'hit', { chance, chancePerLevel: add, cond: 'belowChampion' }, { kind: 'killInstant', fx: 'shadow' })];
    },
  },
  broken_cage: {
    passives: (row) => {
      const [mult, add] = at([[0.35, 0.010], [0.45, 0.013], [0.55, 0.016], [0.65, 0.019], [0.75, 0.022]], row);
      return [proc('Caged Spirits', 'hit', { chance: 1, silent: true, races: ['undead', 'arcane', 'feral'] },
        { kind: 'spellDamage', mult, perLevel: add / mult, fx: 'shadow', quiet: true })];
    },
  },

  // Three spirits strike random creeps in range, each harder than the last (x3, x4, x5).
  necromantic_altar: {
    actives: (row) => {
      const [dmg, add] = at([[200, 12], [400, 24], [800, 48], [1700, 100]], row);
      const spirit = (k) => ({ kind: 'bolts', count: 1, flat: dmg * k, flatPerLevel: add * k, range: R(875), fx: 'shadow' });
      return [autocast(row, 'soulrevenge', '💀', `Three spirits strike random creeps in range for ${dmg * 3}, ${dmg * 4} and ${dmg * 5} spell damage (+${add * 3}/${add * 4}/${add * 5} per level).`, 'self',
        { kind: 'multi', effects: [spirit(3), spirit(4), spirit(5)] })];
    },
  },

  // Each kill adds a bug: permanent base damage, with diminishing returns.
  small_bug_nest: {
    passives: (row) => {
      const [bug, every] = at([[6, 12], [12, 10], [20, 8], [30, 6]], row);
      const pct = bug / avgDmg(row);
      const max = (2 * every * bug * (bug + 1)) / 2 / avgDmg(row);
      return [{ type: 'killStack', pct, max, desc: `Swarm of Bugs: each kill adds +${(pct * 100).toFixed(2)}% damage permanently (max +${Math.round(max * 100)}%).` }];
    },
  },

  // Creeps entering range may have their armor stripped (bosses keep half).
  monolith_of_chaos: {
    passives: () => {
      const opts = { chance: 0.45, chancePerLevel: 0.004 };
      const strip = (armorPct) => ({ kind: 'debuff', armorPct, debuffDur: 3, debuffDurPerLevel: 0.1, fx: 'shadow' });
      return [
        proc('Chaos', 'enter', { ...opts, cond: 'notBoss' }, strip(1)),
        proc('Chaos', 'enter', { ...opts, cond: 'boss', key: 'chaosBoss' }, strip(0.5)),
      ];
    },
  },

  // Each attack adds a permanent stack (max 10) of extra damage taken from darkness towers.
  bone_shrine: {
    passives: (row) => {
      const [inc, add] = at([[0.02, 0.0004], [0.04, 0.0008], [0.06, 0.0012]], row);
      return [proc('Empowering Darkness', 'attack', { chance: 1, silent: true },
        { kind: 'debuff', stackVuln: { pct: inc, pctPerLevel: add, max: 10, element: 'darkness', permanent: true, key: 'boneshrine' }, fx: 'shadow', quiet: true })];
    },
  },

  // Steals gold on hit. Small amounts are paid as rarer, larger thefts with the same average.
  thief_apprentice: {
    passives: (row) => {
      const [gold, add] = at([[0.3, 0.012], [0.9, 0.036], [2.7, 0.108], [6, 0.24], [12, 0.48]], row);
      const avg = gold + add * 12;
      const amount = Math.max(3, Math.round(avg));
      const k = avg / amount;
      return [proc('Steal', 'hit', { chance: 0.1 * k, chancePerLevel: 0.004 * k }, { kind: 'gold', amount, fx: 'gold' })];
    },
  },

  // The wave rolls 40% per cast, or 20% right after a wave: one wave per three casts on average.
  chaos_warlock: {
    passives: (row) => {
      const [cd, count, dmg, add] = at([[2.5, 10, 1050, 21], [1.5, 12, 1700, 34]], row);
      const out = [proc('Shadowbolt Wave', 'periodic', { icd: cd, chance: 1 / 3, needCreeps: true },
        { kind: 'bolts', count, interval: 0.05, flat: dmg, flatPerLevel: add, range: R(1000), fx: 'shadow' })];
      // Only the upgraded tower carries the Slow Decay aura.
      if (row.auras.length) out.unshift({ type: 'execute', pct: 0.055, desc: 'Slow Decay: non-boss creeps it hits below 5.5% health are destroyed.' });
      return out;
    },
  },

  undisturbed_crypt: {
    passives: (row) => {
      const [mass, lvl, lvlAdd] = at([[0.30, 50, 2], [0.33, 80, 3], [0.36, 130, 4], [0.39, 200, 6]], row);
      // Expected burst length: shots continue with chance p, up to 14.
      const shots = (p) => (1 - p ** 14) / (1 - p);
      const mult = +shots(mass).toFixed(3);
      const perLevel = +((shots(mass + 0.15) / shots(mass) - 1) / 25).toFixed(4);
      const dur = 8 + 0.25 * lvl;
      return [
        proc('Critical Mass', 'attack', { chance: 0.3, chancePerLevel: 0.003 }, { kind: 'attackDamage', mult, perLevel, fx: 'shadow' }),
        // A fresh corpse explodes over the creeps around it.
        proc('Corpse Explosion', 'death', { chance: 1, icd: 5 },
          { kind: 'debuff', radius: R(500), slow: lvl / 1000, slowPerLevel: lvlAdd / 1000, slowDur: dur,
            stackVuln: { pct: lvl / 1000, pctPerLevel: lvlAdd / 1000, max: 1, element: 'darkness', key: 'corpseExplosion' },
            debuffDur: dur, debuffDurPerLevel: 0.25 * lvlAdd, fx: 'shadow' }),
      ];
    },
  },

  haunted_rubble: {
    passives: (row) => {
      const [slow, chance, add] = at([[0.15, 0.10, 0.001], [0.18, 0.12, 0.0012], [0.21, 0.15, 0.0014], [0.24, 0.16, 0.0016], [0.27, 0.18, 0.0018]], row);
      const effect = { kind: 'debuff', slow, slowDur: 5, fx: 'shadow' };
      return [
        proc('Atrophy', 'attack', { chance, chancePerLevel: add, cond: 'notBoss' }, effect),
        proc('Atrophy', 'attack', { chance: chance * 0.66, chancePerLevel: add * 0.66, cond: 'boss', key: 'atrophyBoss' }, effect),
      ];
    },
  },

  tentacle_spawn: {
    passives: (row) => {
      const [dps, add] = at([[20, 0.8], [60, 2.4], [120, 4.8], [240, 10], [480, 20], [960, 40]], row);
      return [proc('Rend', 'hit', { chance: 0.25, chancePerLevel: 0.01 },
        { kind: 'debuff', dot: { dps, dpsPerLevel: add, dur: 6, key: 'rend' }, vulnSpell: 0.02 + 0.01 * row.tier, debuffDur: 6, fx: 'shadow' })];
    },
  },

  village_witch: {
    passives: (row) => {
      const [chance, dmg, add, dec, as] = at([[30, 50, 2, 10, 0.10], [36, 400, 16, 9, 0.15], [39, 800, 32, 8.5, 0.20], [42, 2000, 80, 8, 0.25]], row);
      // The chance drops while stacks are active; 60% of the base chance is the steady-state average.
      return [proc('Soul Split', 'hit', { chance: +(chance / 100 * 0.6).toFixed(3) }, { kind: 'multi', effects: [
        { kind: 'spellDamage', flat: dmg, flatPerLevel: add, fx: 'shadow' },
        { kind: 'towerBuff', key: 'soulsplit', label: 'Soul Split', mods: { attackSpeed: as }, dur: 10, maxStacks: Math.floor(chance / dec), quiet: true },
      ] })];
    },
    actives: (row) => {
      const slow = at([0.25, 0.32, 0.36, 0.42], row);
      return [autocast(row, 'lovepotion', '💘', `Throws a potion that slows a creep by ${Math.round(slow * 100)}% (+0.375% per level) for 7s.`, 'creep',
        { kind: 'debuff', slow, slowPerLevel: 0.00375, slowDur: 7, fx: 'shadow' }, { pick: 'strong' })];
    },
  },

  // Creeps caught in the corruption field are hit, carried back to the recreation field and
  // hit again there. Bosses stay put and take one hit. Each field use feeds It's hunger.
  it: {
    passives: () => {
      const hunger = { kind: 'growSelf', stat: 'spell', amount: 0.001, amountPerLevel: 0.0001, cap: 7 };
      const field = (flat, flatPerLevel, pushBack) => ({ kind: 'multi', effects: [
        { kind: 'spellDamage', flat, flatPerLevel, radius: R(250), pushBack, fx: 'shadow' }, hunger] });
      return [
        proc('Corruption Field', 'attack', { chance: 1, icd: 1, cond: 'notBoss', key: 'field' }, field(6000, 200, R(800))),
        proc('Corruption Field', 'attack', { chance: 1, icd: 1, cond: 'boss', key: 'field' }, field(3000, 100, 0)),
        proc('It Hunger', 'kill', { chance: 1, silent: true }, hunger),
      ];
    },
  },

  // Links creeps so damage to one is repeated on every linked creep. With three links,
  // each one taking 3x the share as extra damage gives the same total.
  shard_of_souls: {
    actives: (row) => {
      const [ratio, dist] = at([[0.125, 600], [0.15, 700]], row);
      const curse = +(ratio * 3).toFixed(3);
      return [autocast(row, 'soullink', '🔗', `Links 3 nearby creeps for 2.5s; each takes ${Math.round(curse * 100)}% (+0.9% per level) more damage from the shared pain.`, 'creep',
        { kind: 'chainSpell', flat: 0, count: 2, falloff: 0, jump: R(dist), curse, cursePerLevel: 0.009, debuffDur: 2.5, fx: 'shadow' }, { pick: 'strong' })];
    },
  },

  // Feared creeps are slowed and take more damage, but their armor rises.
  black_dragon_roost: {
    passives: () => [proc('Fear the Dark', 'hit', { chance: 0.2, chancePerLevel: 0.004 },
      { kind: 'debuff', slow: 0.5, slowDur: 5, curse: 0.225, cursePerLevel: 0.009, armorPct: -0.4, debuffDur: 5, debuffDurPerLevel: 0.1, fx: 'shadow' })],
  },

  shadow: {
    passives: () => [
      // Allies trade 10% of their damage for a decay hit worth 10% + 0.5%/level: a net per-level gain.
      { type: 'aura', stat: 'damage', value: 0, valuePerLevel: 0.005, radius: R(300) },
      proc('Dark Orbs', 'attack', { chance: 0.2 }, { kind: 'zone', mult: 0.05, perLevel: 0.173, radius: R(450), dur: 6, fx: 'shadow' }),
      proc('Soul Conversion', 'kill', { chance: 1, silent: true }, { kind: 'zone', mult: 0.03, perLevel: 0.04, radius: R(450), dur: 3, fx: 'shadow' }),
    ],
  },

  essence_of_fury: {
    passives: (row) => {
      const [dps, add] = at([[25, 1], [75, 3], [150, 6], [300, 12], [625, 25]], row);
      return [proc('Poisoned Heart', 'hit', { chance: 1, silent: true },
        { kind: 'debuff', dot: { dps, dpsPerLevel: add, dur: 6, key: 'poisonheart' }, fx: 'shadow', quiet: true })];
    },
  },

  the_council_of_demons: {
    passives: () => [
      proc('Maledict', 'hit', { chance: 0.2, chancePerLevel: 0.004 }, { kind: 'debuff', vulnSpell: 0.2, vulnSpellPerLevel: 0.006, debuffDur: 5, fx: 'shadow' }),
      // Allies get +100% (+2%/level) mana regeneration for 3s after each cast; about half uptime.
      { type: 'aura', stat: 'manaRegen', value: 0.5, valuePerLevel: 0.01, radius: R(400) },
    ],
    // The stored damage released at the end (75% +1%/level) is modelled as extra spell damage taken.
    actives: (row) => [autocast(row, 'darkness', '🌘', 'Engulfs the strongest creep in darkness for 5s: 1000 spell damage per second (+40 per level), a 40% slow, and it takes 75% (+1% per level) more spell damage.', 'creep',
      { kind: 'debuff', dot: { dps: 1000, dpsPerLevel: 40, dur: 5, key: 'darkness' }, slow: 0.4, slowPerLevel: 0.006, slowDur: 5,
        vulnSpell: 0.75, vulnSpellPerLevel: 0.01, debuffDur: 5, fx: 'shadow' }, { pick: 'strong' })],
  },

  lunar_emitter: {
    passives: (row) => {
      const [range, spell, spellAdd, vuln, vulnAdd] = at([[800, 0.15, 0.0045, 0.10, 0.003], [1100, 0.225, 0.0075, 0.15, 0.005]], row);
      const radius = R(range);
      const el = (name) => ({ kind: 'debuff', radius, stackVuln: { pct: vuln, pctPerLevel: vulnAdd, max: 1, element: name, key: `moon-${name}` }, debuffDur: 1.5, quiet: true });
      return [
        { type: 'creepAura', radius, vulnSpell: spell, vulnSpellPerLevel: spellAdd },
        proc('Moonlight', 'periodic', { icd: 1, needCreeps: true, silent: true }, { kind: 'multi', effects: [el('astral'), el('darkness'), el('ice'), el('storm')] }),
      ];
    },
  },

  // Missing mana feeds its damage. Hits and kills refill mana; Will of the Undying spends it.
  death_knight: {
    passives: (row) => {
      const maxMana = row.mana || 50;
      const wither = [1, 2, 3, 4].map((delay) => ({ kind: 'spellDamage', flat: 0, pctHp: 0.05, bossPctMult: 1, delay, quiet: true }));
      return [
        noRegen,
        // (0.025 + 0.001/level) x missing mana as extra damage, written as mult x (1 - mana/max).
        proc('Insatiable Hunger', 'hit', { chance: 1, silent: true },
          { kind: 'attackDamage', mult: 0.025 * maxMana, perLevel: 0.04, scaleBy: { kind: 'mana', per: -1 / maxMana }, fx: 'shadow', quiet: true }),
        proc('Hunger Feeds', 'hit', { chance: 1, silent: true }, { kind: 'mana', self: true, pct: 0.01 }),
        proc('Hunger Feeds', 'kill', { chance: 1, silent: true, key: 'hungerKill' }, { kind: 'mana', self: true, pct: 0.05 }),
        proc('Withering Presence', 'enter', { chance: 0.15, chancePerLevel: 0.004 }, { kind: 'multi', effects: wither, fx: 'shadow' }),
      ];
    },
    // Spends half its mana; strong neighbours lose damage while the knight gains it.
    actives: (row) => [autocast(row, 'undying', '🗡', 'Halves its mana to drain nearby towers: they lose 10% damage (+0.2% per level) and the knight gains 15% (+0.2% per level) for 5s.', 'self',
      { kind: 'multi', spendMana: 0.5, effects: [
        { kind: 'towerBuff', key: 'undyingDrain', label: 'Drained', center: 'self', radius: R(200), others: true, mods: { damage: -0.1 }, perLevel: 0.02, dur: 5, fx: 'shadow' },
        { kind: 'towerBuff', key: 'undying', label: 'Will of the Undying', ...SELF, mods: { damage: 0.15 }, perLevel: 0.0133, dur: 5, quiet: true },
      ] })],
  },

  sacrificial_lamb: {
    passives: (row) => {
      const [add, as, xp] = at([[0.002, 0.5, 0.25], [0.004, 0.75, 0.5]], row);
      // Bonus is split among neighbours; two is the usual count.
      return [proc('Blood Spill', 'attack', { chance: 0.15, chancePerLevel: add, icd: 6 }, { kind: 'multi', effects: [
        { kind: 'towerBuff', key: 'bloodspill', label: 'Blood Spill', center: 'self', radius: R(200), others: true, mods: { attackSpeed: as / 2 }, perLevel: 0.01 / as, dur: 6, fx: 'shadow' },
        { kind: 'towerBuff', key: 'bloodfatigue', label: 'Exhausted', mods: { attackSpeed: -0.9 }, dur: 6, quiet: true },
        { kind: 'xp', amount: xp * 2 },
      ] })];
    },
    // The ally gets a share of the lamb's attack damage per second; the lamb deals no damage meanwhile.
    actives: (row) => {
      const ratio = at([0.30, 0.45], row);
      // Lamb damage x ratio, both growing with level, fitted to a linear per-level scale.
      const dps = Math.round(avgDmg(row) * 0.35 * ratio);
      const grow = ((0.35 + 0.13 * 25) * (ratio + 0.006 * 25)) / (0.35 * ratio);
      const perLevel = +((grow - 1) / 25).toFixed(3);
      return [autocast(row, 'sacrifice', '🩸', `Gives a nearby tower ${dps} extra damage per second (+${Math.round(perLevel * 100)}% per level) for 6s; the lamb deals no damage meanwhile.`, 'tower',
        { kind: 'multi', effects: [
          { kind: 'towerBuff', key: 'sacrifice', label: 'Sacrifice', mods: { dpsAdd: dps }, perLevel, dur: 6, fx: 'shadow' },
          { kind: 'towerBuff', key: 'sacrificeFatigue', label: 'Sacrificed', ...SELF, mods: { damage: -1 }, dur: 6, quiet: true },
        ] })];
    },
  },

  dark_battery: {
    passives: (row) => {
      const [spell, spellAdd, atk, atkAdd] = at([[0.05, 0.002, 0.10, 0.004], [0.10, 0.003, 0.20, 0.008], [0.15, 0.006, 0.30, 0.012]], row);
      return [proc('Corruption', 'hit', { chance: 1, silent: true },
        { kind: 'debuff', curse: atk, cursePerLevel: atkAdd, vulnSpell: spell, vulnSpellPerLevel: spellAdd, debuffDur: 9, debuffDurPerLevel: 0.3, fx: 'shadow', quiet: true })];
    },
    // The overload turns all stored mana into missiles at 10 mana each, five per second.
    actives: (row) => {
      const [dmg, add, spell, spellAdd, atk, atkAdd] = at([[300, 12, 0.05, 0.002, 0.10, 0.004], [750, 30, 0.10, 0.003, 0.20, 0.008], [1800, 72, 0.15, 0.006, 0.30, 0.012]], row);
      return [autocast(row, 'overload', '🔋', `Discharges the battery: 10 missiles over 2s strike random creeps in range for ${dmg} spell damage each (+${add} per level) and corrupt them.`, 'self',
        { kind: 'bolts', count: 10, interval: 0.2, flat: dmg, flatPerLevel: add, range: R(1200), spendMana: 1,
          curse: atk, cursePerLevel: atkAdd, vulnSpell: spell, vulnSpellPerLevel: spellAdd, debuffDur: 9, debuffDurPerLevel: 0.3, fx: 'shadow' })];
    },
  },

  small_frost_fire: {
    actives: (row) => {
      const [dmg, add, slow, slowAdd] = at([[50, 2, 0.05, 0.002], [200, 8, 0.06, 0.004], [550, 24, 0.08, 0.006], [1000, 48, 0.10, 0.008], [1800, 96, 0.12, 0.010]], row);
      return [autocast(row, 'soulchill', '❄', `Chills creeps around a target for ${dmg} spell damage (+${add} per level) and slows them ${Math.round(slow * 100)}% for 4s.`, 'creep',
        { kind: 'spellDamage', flat: dmg, flatPerLevel: add, radius: R(250), slow, slowPerLevel: slowAdd, slowDur: 4, fx: 'shadow' }, { pick: 'first' })];
    },
  },

  buried_soul: {
    passives: (row) => {
      const [banish, banishAdd, dur, dmg, add] = at([[0.40, 0.0032, 2.5, 80, 4], [0.60, 0.0048, 3, 310, 15.5], [0.80, 0.0064, 3.5, 1240, 62], [1.00, 0.008, 4, 2450, 122.5]], row);
      return [
        proc('Soul Scattering', 'attack', { chance: 0.1 }, { kind: 'multi', effects: [
          { kind: 'debuff', vulnSpell: banish, vulnSpellPerLevel: banishAdd, debuffDur: dur, fx: 'shadow' },
          { kind: 'towerBuff', key: 'cripple', label: 'Crippled', mods: { attackSpeed: -0.6 }, perLevel: -0.01 / 0.6, dur, quiet: true },
        ] }),
        proc('Shadowstrike', 'attack', { chance: 0.25, chancePerLevel: 0.005 }, { kind: 'spellDamage', flat: dmg, flatPerLevel: add, fx: 'shadow' }),
      ];
    },
  },

  // Attacks barely hurt; a swarm of moths strikes random creeps twice a second each.
  mister_fireflies: {
    passives: (row) => {
      const [dmg, count] = at([[75, 6], [120, 6], [165, 7]], row);
      return [proc('Moths of Prey', 'periodic', { icd: 1, needCreeps: true, silent: true },
        { kind: 'bolts', count: count * 2, interval: 1 / (count * 2), flat: dmg, fx: 'shadow' })];
    },
  },

  // The ghost ship's cannon is the regular attack with full splash. Kills bank souls:
  // one is fired every 5s for heavy damage, the rest feed the soul storm.
  dutchmans_grave: {
    passives: () => [
      { type: 'splash', rings: [{ radius: R(250), pct: 1 }], radius: R(250), pct: 1 },
      proc('Panic', 'kill', { chance: 1, silent: true }, { kind: 'debuff', radius: R(300), armor: 25, armorPerLevel: 1, debuffDur: 5, fx: 'shadow' }),
      proc('Soul Attack', 'kill', { chance: 1, icd: 5 }, { kind: 'bolts', count: 1, flat: 14000, flatPerLevel: 1400, range: R(1200), fx: 'shadow' }),
      proc('Soul Storm', 'kill', { chance: 1, silent: true }, { kind: 'bolts', count: 1, flat: 14000, range: R(1200), fx: 'shadow' }),
    ],
  },

  soulflame_device: {
    passives: () => [
      noRegen,
      proc('Soulfire', 'hit', { chance: 0.2, chancePerLevel: 0.004 },
        { kind: 'debuff', dot: { dps: 1000, dpsPerLevel: 40, dur: 5, maxStacks: 50, key: 'soulfire' }, fx: 'fire' }),
      // Burning creeps feed the device 5 mana when they die.
      proc('Soul Consumption', 'death', { chance: 1, silent: true }, { kind: 'mana', self: true, amount: 5 }),
      // Shares part of the device's own bonuses, mostly attack speed from repeated awakenings.
      { type: 'aura', stat: 'attackSpeed', value: 0.1, valuePerLevel: 0.004, radius: R(350), element: 'darkness', rarities: ['common', 'uncommon'], self: false },
    ],
    actives: (row) => [autocast(row, 'awaken', '🔥', 'Towers nearby gain +50% attack speed (+2% per level) for 3s. Each awakening permanently adds +1% attack speed to the device.', 'self',
      { kind: 'multi', effects: [
        { kind: 'towerBuff', key: 'awaken', label: 'Awaken', radius: R(350), mods: { attackSpeed: 0.5 }, perLevel: 0.04, dur: 3, fx: 'shadow' },
        { kind: 'growSelf', stat: 'attackSpeed', amount: 0.01 },
      ] })],
  },

  kraken: {
    passives: () => {
      const tentacles = (count) => ({ kind: 'bolts', count, interval: 0.05, mult: 0.15, attack: true, stun: 0.4, range: R(1200), fx: 'shadow' });
      const eat = (sizes, amount) => proc('Eat the Dead', 'kill', { chance: 1, silent: true, sizes, key: `eat-${sizes[0]}` }, { kind: 'growSelf', stat: 'damage', amount });
      return [
        eat(['mass', 'challengeMass'], 0.005), eat(['normal'], 0.01), eat(['air', 'champion'], 0.02), eat(['boss', 'challenge'], 0.1),
        proc('Acid Goo', 'hit', { chance: 0.3, chancePerLevel: 0.01 }, { kind: 'debuff', armor: 15, armorPerLevel: 0.6, debuffDur: 5, debuffDurPerLevel: 0.2, fx: 'nature' }),
        // Fires when a creep comes into range or every 4s, whichever is first; shares one cooldown.
        proc('Tentacle Attack', 'periodic', { icd: 4, needCreeps: true }, tentacles(6)),
        proc('Tentacle Attack', 'enter', { chance: 1, icd: 4 }, tentacles(6)),
        proc('Extra Tentacle', 'periodic', { icd: 4, needCreeps: true, minLevel: 15, silent: true }, tentacles(1)),
        proc('Extra Tentacle', 'periodic', { icd: 4, needCreeps: true, minLevel: 25, silent: true, key: 'tentacle25' }, tentacles(1)),
      ];
    },
  },

  soul_vault: {
    passives: () => [
      proc("Vault's Presence", 'periodic', { icd: 1, needCreeps: true, silent: true }, { kind: 'debuff', radius: R(775), armorPct: 0.25, debuffDur: 1.5, quiet: true }),
      proc('Acid Skull', 'attack', { chance: 0.25, chancePerLevel: 0.004 }, { kind: 'multi', effects: [
        { kind: 'spellDamage', flat: 360, flatPerLevel: 18, quiet: true },
        { kind: 'spellDamage', flat: 1440, flatPerLevel: 72, radius: R(225), armor: -0.5, armorPerLevel: -0.02, debuffDur: 4.5, fx: 'nature' },
      ] }),
      proc('Soulsteal', 'hit', { chance: 0.125, chancePerLevel: 0.001 }, { kind: 'debuff', vulnSpell: 0.5, vulnSpellPerLevel: 0.02, debuffDur: 1000, fx: 'shadow' }),
    ],
  },

  // The curse only raises damage from attacks upstream; here it raises all damage taken.
  lesser_skeletal_mage: {
    actives: (row) => {
      const vuln = at([0.15, 0.22, 0.29, 0.36], row);
      return [autocast(row, 'darkcurse', '☠', `Curses the strongest creep: it takes ${Math.round(vuln * 100)}% (+0.6% per level) more damage for 5s (+0.1s per level).`, 'creep',
        { kind: 'debuff', curse: vuln, cursePerLevel: 0.006, debuffDur: 5, debuffDurPerLevel: 0.1, fx: 'shadow' }, { pick: 'strong' })];
    },
  },

  cursed_grounds: {
    passives: (row) => {
      const [dmg, add, slow, spell, aura, auraAdd] = at([[200, 10, 0.20, 0.10, 0.10, 0.004], [320, 16, 0.25, 0.125, 0.15, 0.006], [560, 28, 0.30, 0.15, 0.20, 0.008]], row);
      const coil = (stat) => ({ type: 'aura', stat, value: aura, valuePerLevel: auraAdd, radius: R(350) });
      return [
        proc('Cursed Attack', 'hit', { chance: 0.25, chancePerLevel: 0.01 },
          { kind: 'spellDamage', flat: dmg, flatPerLevel: add, slow, slowDur: 4, vulnSpell: spell, debuffDur: 4, debuffDurPerLevel: 0.1, fx: 'shadow' }),
        coil('vsHumanoid'), coil('vsBrute'), coil('vsFeral'),
      ];
    },
  },

  // Parasites burn and erode armor; when a host dies the queen grows and the brood jumps on.
  spider_queen: {
    passives: () => {
      const parasite = { dot: { dps: 500, dpsPerLevel: 100, dur: 10, key: 'parasite' }, armorPct: 0.3, debuffDur: 1000 };
      return [
        proc('Inject Parasite', 'hit', { chance: 0.3, chancePerLevel: 0.004 }, { kind: 'debuff', ...parasite, fx: 'nature' }),
        // About half the creeps dying near the queen carry a parasite.
        proc('Brood', 'death', { chance: 0.5, silent: true }, { kind: 'multi', effects: [
          { kind: 'growSelf', stat: 'damage', amount: 0.0075 },
          { kind: 'bolts', count: 1, flat: 0, ...parasite, fx: 'nature' },
        ] }),
      ];
    },
  },

  // Every creep dying nearby, whoever kills it, makes the hall stronger and wiser.
  hall_of_souls: {
    passives: (row) => {
      const [dmg, add, xp] = at([[6, 0.3, 1], [12, 0.6, 2], [18, 0.9, 3]], row);
      const amount = +(dmg / avgDmg(row)).toFixed(5);
      const amountPerLevel = +(add / avgDmg(row)).toFixed(6);
      return [proc(`Revenge of Souls (+${xp} experience)`, 'death', { chance: 1, silent: true }, { kind: 'multi', effects: [
        { kind: 'growSelf', stat: 'damage', amount, amountPerLevel },
        { kind: 'xp', amount: xp },
      ] })];
    },
  },

  plagued_crypt: {
    passives: () => {
      // Each repeat hit adds a stack worth half the base plague; the plague spreads through crowds.
      const plague = { dps: 375, dpsPerLevel: 15, dur: 5 };
      return [
        proc('Plague', 'hit', { chance: 1, silent: true }, { kind: 'multi', effects: [
          { kind: 'debuff', dot: { ...plague, maxStacks: 50, key: 'plagueStack' }, quiet: true },
          { kind: 'debuff', radius: R(250), dot: { ...plague, key: 'plague' }, fx: 'nature', quiet: true },
        ] }),
        // A corpse is consumed every 3s; stacks last 20s, so about seven are up at once.
        proc('Army of the Damned', 'death', { chance: 1, icd: 3 },
          { kind: 'towerBuff', key: 'army', label: 'Army of the Damned', mods: { attackSpeed: 0.05, damage: 0.05 }, dur: 20, durPerLevel: 0.4, maxStacks: 7, fx: 'shadow' }),
      ];
    },
  },

  // Mana-fuelled strikes cost 80 mana each.
  dreadlord: {
    passives: (row) => {
      const mana = row.mana || 1000;
      return [
        proc('Dreadlord Slash', 'hit', { chance: 1, manaCost: 80 }, { kind: 'spellDamage', flat: mana, flatPerLevel: mana * 0.04, fx: 'shadow' }),
        proc('Bloodsucker', 'kill', { chance: 1, silent: true }, { kind: 'multi', effects: [
          { kind: 'growSelf', stat: 'attackSpeed', amount: 0.005 },
          { kind: 'growSelf', stat: 'manaFlat', amount: 10, cap: 2010 },
        ] }),
      ];
    },
    actives: (row) => [autocast(row, 'awakening', '🦇', 'Awakens for 10s: +50% attack speed and +20 mana per second (both +4% per level).', 'self',
      { kind: 'towerBuff', key: 'awakening', label: "Dreadlord's Awakening", mods: { attackSpeed: 0.5, manaRegenFlat: 20 }, perLevel: 0.04, dur: 10, fx: 'shadow' })],
  },

  // Slowly loses experience but never a level. The drain is a share of all experience the
  // tower has banked, so it grows in steps with the level.
  void_drake: {
    passives: (row) => {
      const [pct, add] = at([[0.010, 0.0002], [0.015, 0.0003]], row);
      const drain = (lvl) => (pct + add * lvl) * xpTotal(lvl);
      const steps = [3, 5, 10, 15, 20, 25, 30, 40, 50];
      return steps.map((lvl, i) => {
        const amount = -Math.round(drain(lvl) - (i ? drain(steps[i - 1]) : 0));
        return proc('Void', 'periodic', { icd: 1, minLevel: lvl, silent: true, key: `void${lvl}` }, { kind: 'xp', amount });
      });
    },
  },

  // Fires an arcane orb with each attack that costs 100 mana and deals (6 + 0.1/level) x its
  // mana as spell damage. Kills grow the mana pool; nearby towers sometimes get mana back.
  harby: {
    passives: () => [
      // Damage uses the mana before the 100 is spent: (6 + 0.1L) x (mana left + 100).
      proc('Arcane Orb', 'attack', { chance: 1, manaCost: 100 }, { kind: 'spellDamage', flat: 600, flatPerLevel: 10, scaleBy: { kind: 'mana', per: 0.01 }, fx: 'arcane' }),
      proc('Arcane Replenish', 'attack', { chance: 0.1, chancePerLevel: 0.004 }, { kind: 'mana', self: true, pct: 0.12 }),
      proc('Grotesque Appetite', 'kill', { chance: 1, silent: true }, { kind: 'growSelf', stat: 'manaFlat', amount: 1 }),
      // Allies regain 10% mana on some of their casts (at most every 5s): about every 30s.
      proc('Arcane Aura', 'periodic', { icd: 30, needCreeps: true }, { kind: 'mana', radius: R(350), pct: 0.1 }),
    ],
  },
};
