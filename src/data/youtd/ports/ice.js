// Ported ice tower behaviors, keyed by YouTD 2 script name (MIT, see third_party/youtd2).
// Mechanics are re-implemented with this game's ability engine; descriptions are our own.

import { UNIT, at, proc, autocast } from './helpers.js';

export const PORTS = {
  frost_root: {
    passives: (row) => {
      const [dmg, add] = at([[25, 1], [125, 5], [375, 15], [750, 30], [1500, 60], [2500, 100]], row);
      return [proc('Frozen Thorn', 'hit', { chance: 0.15 }, { kind: 'spellDamage', flat: dmg, flatPerLevel: add, fx: 'frost' })];
    },
  },
  cold_obelisk: {
    passives: (row) => {
      const [slow, add] = at([[0.18, 0.004], [0.24, 0.0045], [0.30, 0.005]], row);
      return [proc('Chill', 'hit', { chance: 1, silent: true }, { kind: 'debuff', slow, slowPerLevel: add, slowDur: 4, fx: 'frost', quiet: true })];
    },
  },

  small_ice_mine: {
    passives: (row) => {
      const [slow, slowDur, radius, dmg, add] = at([[0.075, 2, 250, 150, 7.5], [0.09, 3, 300, 500, 25], [0.11, 4, 350, 1250, 62.5], [0.14, 5, 400, 2500, 125]], row);
      return [proc('Ice Nova', 'hit', { chance: 0.2, chancePerLevel: 0.004 },
        { kind: 'spellDamage', flat: dmg, flatPerLevel: add, radius: radius / UNIT, slow, slowDur, fx: 'frost' })];
    },
  },

  // Each creep is chilled once as it enters range; the freeze lands when the chill wears off.
  igloo: {
    passives: (row) => {
      const [stun, dmg, add, slow] = at([[0.4, 700, 35, 0.2], [0.8, 1500, 75, 0.25], [1.2, 2800, 140, 0.3]], row);
      return [proc('Extreme Cold', 'enter', { chance: 1 }, { kind: 'multi', effects: [
        { kind: 'spellDamage', flat: dmg, flatPerLevel: add, slow, slowPerLevel: 0.004, slowDur: 4, fx: 'frost' },
        { kind: 'debuff', stun, delay: 4, fx: 'frost' },
      ] })];
    },
  },

  tundra_stalker: {
    actives: (row) => {
      const [maxBonus, buffLevel, dmg, add] = at([[1, 0, 50, 2], [1.125, 1, 100, 4], [1.25, 2, 200, 8], [1.375, 3, 400, 16], [1.5, 4, 600, 24]], row);
      const slow = 0.2 + 0.05 * buffLevel;
      // The claw lasts 5s (+0.2s per level); the longer duration is folded into the damage per second.
      const dpsAdd = +(add + dmg * 0.04).toFixed(2);
      return [autocast(row, 'iceclaw', '🐾',
        `Claws a creep: ${dmg} spell damage per second (+${dpsAdd} per level) and ${Math.round(slow * 100)}% slow for 5s. Each cast permanently grants +0.5% attack speed, up to +${Math.round(maxBonus * 100)}%; the bonus carries over on upgrade.`,
        'creep', { kind: 'multi', effects: [
          { kind: 'debuff', dot: { dps: dmg, dpsPerLevel: dpsAdd, dur: 5, key: 'iceclaw' }, slow, slowDur: 5, fx: 'frost' },
          { kind: 'growSelf', stat: 'attackSpeed', amount: 0.005, cap: maxBonus },
        ] }, { pick: 'strong' })];
    },
  },

  frozen_well: {
    passives: (row) => [
      { type: 'aura', stat: 'buffDur', value: 0.25, valuePerLevel: 0.004, radius: (row.auras[0]?.range || 500) / UNIT },
      proc('Freezing Mist', 'hit', { chance: 1, silent: true },
        { kind: 'debuff', slow: 0.15, slowPerLevel: 0.004, slowDur: 10, fx: 'frost', quiet: true }),
    ],
  },

  // Spring Tide sends a wave down a line that throws stunning stones; modeled as a blast around the target.
  tidewater_stream: {
    passives: (row) => [
      { type: 'aura', stat: 'spellCrit', value: 0.1, valuePerLevel: 0.004, radius: (row.auras[0]?.range || 250) / UNIT },
      proc('Spring Tide', 'attack', { chance: 0.15, chancePerLevel: 0.006 },
        { kind: 'spellDamage', flat: 2200, flatPerLevel: 88, radius: 250 / UNIT, stun: 0.65, fx: 'frost' }),
      proc('Splash', 'hit', { chance: 0.2, chancePerLevel: 0.004 },
        { kind: 'spellDamage', flat: 4000, flatPerLevel: 160, radius: 175 / UNIT, vulnSpell: 0.125, vulnSpellPerLevel: 0.005, debuffDur: 6, fx: 'frost' }),
    ],
  },

  genis_sage: {
    passives: () => {
      const speedCast = { kind: 'towerBuff', key: 'speedcast', label: 'Speed Cast', mods: { attackSpeed: 0.25, trigger: 0.25 }, perLevel: 0.04, dur: 3.5, durPerLevel: 0.1, fx: 'frost' };
      return [
        // Three water waves fan out in a cone; modeled as a blast around the target.
        proc('Aqua Edge', 'attack', { chance: 0.2, chancePerLevel: 0.006, manaCost: 15 },
          { kind: 'spellDamage', flat: 1500, flatPerLevel: 150, radius: 250 / UNIT, fx: 'frost' }),
        proc('Spread', 'hit', { chance: 0.1, chancePerLevel: 0.002, manaCost: 40 },
          { kind: 'spellDamage', flat: 3000, flatPerLevel: 200, radius: 250 / UNIT, stun: 0.8, fx: 'frost' }),
        // A 30% roll every 7s, expressed as the same average rate.
        proc('Magic Boost', 'periodic', { icd: 23, needCreeps: true, manaCost: 40 },
          { kind: 'towerBuff', key: 'magicboost', label: 'Magic Boost', radius: 350 / UNIT, mods: { spell: 0.2 }, perLevel: 0.05, dur: 3, fx: 'frost' }),
        // Speed Cast follows 15% of the spells above; rolled alongside each spell's own trigger.
        proc('Speed Cast', 'attack', { chance: 0.03, chancePerLevel: 0.0009, key: 'speedcastEdge' }, speedCast),
        proc('Speed Cast', 'hit', { chance: 0.015, chancePerLevel: 0.0003, key: 'speedcastSpread' }, speedCast),
      ];
    },
  },

  // Snowballs only fly when the creep shows its side (temple hit) or its back (knockdown).
  // With random facing that is 1/9 and 4/9 of attacks.
  baby_tuskin: {
    passives: (row) => {
      const [temple, knock, add] = at([[0.6, 0.4, 0.01], [0.8, 0.6, 0.0125], [1.0, 0.8, 0.014]], row);
      return [
        proc('Temple Crusher', 'attack', { chance: +(0.2 / 9).toFixed(4), chancePerLevel: +(add / 9).toFixed(5) },
          { kind: 'spellDamage', mult: 1.2, stun: temple, fx: 'frost' }),
        proc('Knockdown', 'attack', { chance: +(0.8 / 9).toFixed(4), chancePerLevel: +(add * 4 / 9).toFixed(5) },
          { kind: 'spellDamage', mult: 0.5, stun: knock, fx: 'frost' }),
      ];
    },
  },

  fisherman: {
    passives: () => {
      // Fresh Fish adds flat DPS equal to 15% of the fisherman's DPS; approximated as +15% damage.
      const fish = { kind: 'towerBuff', key: 'freshfish', label: 'Fresh Fish!', radius: 500 / UNIT, mods: { damage: 0.15 }, perLevel: 0.004 / 0.15, dur: 5, durPerLevel: 0.1, fx: 'frost' };
      return [
        proc("Fisherman's Net", 'hit', { chance: 1, silent: true },
          { kind: 'debuff', slow: 0.25, slowPerLevel: 0.01, slowDur: 3, fx: 'frost', quiet: true }),
        // Strangle rolls once per expiring net on a heavily slowed creep; approximated per hit.
        proc('Strangle', 'hit', { chance: 0.01, chancePerLevel: 0.0007, cond: 'notBoss' }, { kind: 'multi', effects: [{ kind: 'killInstant', fx: 'frost' }, fish] }),
        proc('Strangle', 'hit', { chance: 0.01, chancePerLevel: 0.0007, cond: 'boss' }, { kind: 'multi', effects: [
          { kind: 'attackDamage', mult: 4, perLevel: 0.04, fx: 'frost' }, fish] }),
      ];
    },
  },

  taita_the_hermit: {
    passives: (row) => [
      // Each hit adds a stack (max 6): +10% (+2%/lvl) damage per stack from this kind of attack.
      // The slow grows by 10% per stack upstream; a fixed 40% is used.
      proc('Icy Touch', 'hit', { chance: 1, silent: true }, { kind: 'debuff', slow: 0.4, slowDur: 5, debuffDur: 5,
        stackVuln: { pct: 0.1, pctPerLevel: 0.02, max: 6, element: 'ice', attack: row.attack, key: 'icytouch' }, fx: 'frost', quiet: true }),
      // Upstream chance equals the creep's slow percentage and damage scales with Icy Touch stacks.
      proc('Frost Bolt', 'attack', { chance: 0.4, cond: 'slowed' },
        { kind: 'attackDamage', mult: 1.2, perLevel: 0.02, radius: 200 / UNIT, fx: 'frost' }),
      proc('Cold Blood', 'kill', { chance: 1 },
        { kind: 'towerBuff', key: 'coldblood', label: 'Cold Blood', mods: { attackSpeed: 0.5 }, perLevel: 0.01, dur: 3, fx: 'frost' }),
    ],
  },

  magna_warrior: {
    passives: (row) => {
      const [chance, add] = at([[0.10, 0.01], [0.11, 0.02], [0.12, 0.03], [0.13, 0.04], [0.14, 0.05]], row);
      // The hit deals x(1.5 + bonus per level): modeled as an extra half-hit on top.
      return [proc('Frozen Spears', 'hit', { chance },
        { kind: 'attackDamage', mult: 0.5, perLevel: add / 0.5, stun: 0.5, stunPerLevel: 0.01, fx: 'frost' })];
    },
  },

  // Ice Smashing Axe purges buffs, which creeps here do not have; only Ice Coated Axes is ported.
  young_northern_troll: {
    passives: (row) => {
      // Bonus is per percent of slow; assumes a typical 30% slow.
      const coat = at([0.006, 0.0065, 0.007], row);
      const pct = +(coat * 30).toFixed(3);
      return [{ type: 'bonusVsSlowed', pct, desc: `Ice Coated Axes: deals +${Math.round(pct * 100)}% damage to slowed creeps.` }];
    },
  },

  // Attacks charge mana and every hit deals bonus attack damage equal to current mana.
  // The upstream 1.75%/s mana leak is dropped: the engine has no describable mana-drain effect.
  sea_turtle: {
    passives: (row) => {
      const gain = at([64, 128, 192], row);
      return [
        proc('Tidal Charge', 'attack', { chance: 1, silent: true }, { kind: 'mana', self: true, amount: gain }),
        proc('Aqua Breath', 'hit', { chance: 1, silent: true }, { kind: 'attackDamage', flat: 0, manaMult: 1, fx: 'frost' }),
      ];
    },
  },

  chilled_spire: {
    passives: (row) => {
      const [chance, add, dur] = at([[0.20, 0.004, 1.0], [0.25, 0.005, 1.2]], row);
      return [
        proc('Cold', 'hit', { chance, chancePerLevel: add, cond: 'notBoss' }, { kind: 'debuff', stun: dur, stunPerLevel: 0.05, fx: 'frost' }),
        proc('Cold', 'hit', { chance: chance / 2, chancePerLevel: add / 2, cond: 'boss' }, { kind: 'debuff', stun: dur / 2, stunPerLevel: 0.025, fx: 'frost' }),
      ];
    },
  },

  ice_battery: {
    passives: (row) => {
      const [, , slow, add] = at([[300, 12, 0.10, 0.003], [750, 30, 0.15, 0.0045], [1800, 72, 0.20, 0.006]], row);
      return [proc('Frost', 'hit', { chance: 1, silent: true }, { kind: 'debuff', slow, slowPerLevel: add, slowDur: 9, fx: 'frost', quiet: true })];
    },
    actives: (row) => {
      const [dmg, add, slow, slowAdd] = at([[300, 12, 0.10, 0.003], [750, 30, 0.15, 0.0045], [1800, 72, 0.20, 0.006]], row);
      // Upstream spends 10 mana per missile until the battery is empty; the 100-mana charge gives 10 missiles.
      return [autocast(row, 'overload', '🔋',
        `Discharges the battery: 10 frost missiles over 2s strike random creeps for ${dmg} spell damage (+${add} per level) each and slow them.`,
        'self', { kind: 'bolts', count: 10, interval: 0.2, range: 1200 / UNIT, flat: dmg, flatPerLevel: add, slow, slowPerLevel: slowAdd, slowDur: 9, fx: 'frost' })];
    },
  },

  // Flesh of Ymir shortens debuffs on towers, which never receive debuffs here.
  ymir: {
    passives: () => {
      // Wrath slows by the creep's remaining health share for 2s; split into four health bands.
      const wrath = (slow, band) => proc('Wrath of Ymir', 'hit', { chance: 0.2, chancePerLevel: 0.004, ...band },
        { kind: 'spellDamage', mult: 0.1, perLevel: 0.06, slow, slowDur: 2, fx: 'frost' });
      return [
        wrath(0.875, { hpAbove: 0.75 }),
        wrath(0.625, { hpAbove: 0.5, hpBelow: 0.75 }),
        wrath(0.375, { hpAbove: 0.25, hpBelow: 0.5 }),
        wrath(0.125, { hpBelow: 0.25 }),
        proc('Blood of Ymir', 'enter', { chance: 1 },
          { kind: 'debuff', stackVuln: { pct: 0.25, pctPerLevel: 0.004, max: 1, element: 'ice', key: 'ymirblood' }, debuffDur: 6, debuffDurPerLevel: 0.08, fx: 'frost' }),
      ];
    },
  },

  ebonfrost_crystal: {
    passives: () => [
      // Upstream half of each hit lands later as a frost burn; here the burn is added on top.
      proc('Frostburn', 'hit', { chance: 1, silent: true }, { kind: 'debuff', burn: 0.1, burnDur: 5, fx: 'frost', quiet: true }),
      // Icicles are stored and fired later; here they fire right away.
      proc('Icicles', 'hit', { chance: 0.15, chancePerLevel: 0.004 },
        { kind: 'attackDamage', flat: 3000, flatPerLevel: 80, fx: 'frost' }),
      // 1-4 shards (about 1.4 on average) bombard the target area.
      proc('Icy Bombardment', 'attack', { chance: 0.15, chancePerLevel: 0.004 },
        { kind: 'attackDamage', mult: 0.35, perLevel: 0.024, radius: 200 / UNIT, fx: 'frost' }),
    ],
    // Freeze time comes from the mana spent (~300-400 mana gives 2-3s); a fixed 2.5s is used.
    actives: (row) => [autocast(row, 'shatter', '🧊',
      'Spends all mana to freeze a creep solid: it takes double damage from everything, and the stored icicles crash into it.',
      'creep', { kind: 'attackDamage', flat: 9000, flatPerLevel: 240, stun: 2.5, bossStunMult: 0.8, curse: 1, debuffDur: 2.5, spendMana: 1, fx: 'frost' },
      { pick: 'strong' })],
  },

  icy_skulls: {
    passives: (row) => {
      const [slow, add, dur] = at([[0.075, 0.003, 3], [0.1, 0.004, 4], [0.125, 0.005, 5], [0.15, 0.006, 6]], row);
      return [proc('Icy Touch', 'hit', { chance: 1, silent: true }, { kind: 'debuff', slow, slowPerLevel: add, slowDur: dur, fx: 'frost', quiet: true })];
    },
  },

  the_frozen_wyrm: {
    passives: () => [
      proc('Freezing Breath', 'hit', { chance: 0.25, chancePerLevel: 0.01, key: 'breathSlow' },
        { kind: 'debuff', slow: 0.27, slowPerLevel: 0.002, slowDur: 4, fx: 'frost' }),
      proc('Freezing Breath', 'hit', { chance: 0.05, chancePerLevel: 0.002, key: 'breathStun' },
        { kind: 'debuff', stun: 1.5, fx: 'frost' }),
    ],
  },

  // Blizzard waves strike once per second. The per-wave slow almost always lands; the per-wave stun chance is dropped.
  cold_troll: {
    actives: (row) => {
      const [slow, slowDur, dmg, radius, waves, ratio] = at([
        [0.07, 4, 60, 200, 5, 0.1], [0.09, 4.5, 333, 300, 6, 0.036], [0.11, 5, 572, 400, 7, 0.033], [0.14, 5.5, 1000, 500, 8, 0.05]], row);
      return [autocast(row, 'blizzard', '🌨',
        `Calls a blizzard on a group: ${waves} waves of ${dmg} spell damage (+${+(dmg * ratio).toFixed(1)} per level) in an area, slowing creeps by ${Math.round(slow * 100)}%.`,
        'area', { kind: 'zone', flat: dmg, flatPerLevel: +(dmg * ratio).toFixed(1), radius: radius / UNIT, dur: waves, slow, slowPerLevel: 0.0001, slowDur, fx: 'frost' })];
    },
  },

  // Shards split into a widening fan; modeled as a blast around the target.
  safirons_cold_grave: {
    passives: () => [proc('Ice Shard', 'hit', { chance: 1 },
      { kind: 'spellDamage', flat: 2280, flatPerLevel: 85, radius: 350 / UNIT, fx: 'frost',
        stackVuln: { pct: 0.15, pctPerLevel: 0.004, max: 100, element: 'ice', permanent: true, key: 'liquidice' } })],
  },

  icy_core: {
    passives: (row) => {
      const [slow, add] = at([[0.15, 0.004], [0.25, 0.006]], row);
      return [{ type: 'creepAura', slow, slowPerLevel: add, radius: +((row.auras[0]?.range || 800) / UNIT).toFixed(1) }];
    },
  },

  // Novas strike random creeps in range: 3, 4 from level 15, 5 from level 25. Edge falloff is not modeled.
  icy_spirit: {
    passives: (row) => {
      const [dmg, add] = at([[350, 17.5], [910, 45.5], [2100, 105]], row);
      const novas = (count) => ({ kind: 'bolts', count, interval: 0.1, range: 900 / UNIT, radius: 200 / UNIT, flat: dmg, flatPerLevel: add,
        slow: 0.125, slowPerLevel: 0.005, slowDur: 4, fx: 'frost' });
      const chance = { chance: 0.25, chancePerLevel: 0.005 };
      return [
        proc('Nova Storm', 'attack', chance, novas(3)),
        proc('Nova Storm', 'attack', { ...chance, minLevel: 15, key: 'novaStorm15', silent: true }, novas(1)),
        proc('Nova Storm', 'attack', { ...chance, minLevel: 25, key: 'novaStorm25', silent: true }, novas(1)),
      ];
    },
  },

  // Damage builds while a creep stays in the aura and lands when it leaves; dealt here as a steady pulse.
  // Icy Curse (longer debuffs on creeps) has no equivalent.
  lich_king: {
    passives: () => [proc("King's Authority", 'periodic', { icd: 1, needCreeps: true, silent: true },
      { kind: 'spellDamage', flat: 500, flatPerLevel: 20, radius: 900 / UNIT, quiet: true, fx: 'frost' })],
  },

  // Each attack adds a stack (max 10): more damage, less attack speed. The penalty shrinks at levels 15 and 25.
  polar_bear_cub: {
    passives: (row) => {
      const dmg = at([0.2, 0.25, 0.3], row);
      const relief = (key) => ({ kind: 'towerBuff', key, label: 'Cold Feet', mods: { attackSpeed: 0.01 }, dur: 6, maxStacks: 10, quiet: true });
      return [
        proc('Cold Feet', 'attack', { chance: 1, silent: true },
          { kind: 'towerBuff', key: 'coldfeet', label: 'Cold Feet', mods: { damage: dmg, attackSpeed: -0.05 }, dur: 6, maxStacks: 10, quiet: true, fx: 'frost' }),
        proc('Cold Feet', 'attack', { chance: 1, silent: true, minLevel: 15, key: 'coldfeet15' }, relief('coldfeet15')),
        proc('Cold Feet', 'attack', { chance: 1, silent: true, minLevel: 25, key: 'coldfeet25' }, relief('coldfeet25')),
      ];
    },
  },

  // The chance grows after each miss and resets on success; an equivalent flat chance is used.
  frosty_rock: {
    passives: (row) => {
      const [slow, add, dmg, dmgAdd, chance, stun] = at([
        [0.07, 0.0035, 100, 2, 0.11, 0.8], [0.1, 0.005, 520, 10.4, 0.14, 0.9], [0.13, 0.0065, 1300, 26, 0.16, 1.0], [0.16, 0.008, 2150, 43, 0.18, 1.1]], row);
      return [
        proc('Frost', 'hit', { chance: 1, silent: true }, { kind: 'debuff', slow, slowPerLevel: add, slowDur: 3, fx: 'frost', quiet: true }),
        proc('Glacial Wrath', 'hit', { chance }, { kind: 'spellDamage', flat: dmg, flatPerLevel: dmgAdd, stun, fx: 'frost' }),
      ];
    },
  },
};
