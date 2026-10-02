// Ported fire tower behaviors, keyed by YouTD 2 script name (MIT, see third_party/youtd2).
// Mechanics are re-implemented with this game's ability engine; descriptions are our own.

// eslint-disable-next-line no-unused-vars
import { UNIT, at, proc, autocast } from './helpers.js';

// World-unit radius from a Warcraft III distance, rounded so descriptions stay readable.
const R = (d) => +(d / UNIT).toFixed(2);
const avgDmg = (row) => (row.dmg[0] + row.dmg[1]) / 2;

export const PORTS = {
  small_torch: {
    actives: (row) => {
      const [dmg, add] = at([[60, 3], [215, 11], [600, 30], [1200, 60], [2150, 107]], row);
      return [autocast(row, 'blaze', '🔥', `Blasts the area around a creep for ${dmg} spell damage (+${add} per level).`, 'creep',
        { kind: 'spellDamage', flat: dmg, flatPerLevel: add, radius: 200 / UNIT, fx: 'fire' }, { pick: 'first' })];
    },
  },
  small_fire_sprayer: {
    passives: (row) => [{ type: 'miss', base: 0.33, perLevel: -at([0.008, 0.009, 0.010, 0.011, 0.012, 0.013], row), desc: 'Misses 33% of attacks; less with every level.' }],
  },
  broken_fire_pit: {
    passives: (row) => {
      const [crit, dur] = at([[0.15, 7.5], [0.2, 8.5], [0.25, 9.5], [0.3, 10.5], [0.35, 11.5]], row);
      return [proc('Hot Coals', 'kill', { chance: 1 }, {
        kind: 'towerBuff', key: 'coals', label: 'Hot Coals', mods: { crit }, perLevel: 0.003 / crit, dur, durPerLevel: 0.05, fx: 'fire' })];
    },
  },

  // Totem that buffs nearby towers' attacks and marks creeps to take more fire damage.
  black_rock_totem: {
    passives: () => [
      proc('Fighter Totem', 'attack', { chance: 0.15, chancePerLevel: 0.002 }, {
        kind: 'towerBuff', key: 'fighterTotem', label: 'Fighter Totem', center: 'self', radius: R(500),
        mods: { damage: 0.10, crit: 0.05, critMult: 0.5 }, perLevel: 0.04, dur: 5, durPerLevel: 0.2, fx: 'fire' }),
      // Each Demonic Fire cast may also inspire the towers around the totem.
      proc('Shamanic Totem', 'cast', { chance: 0.30, chancePerLevel: 0.004 }, { kind: 'multi', effects: [
        { kind: 'towerBuff', key: 'shamanicTotem', label: 'Shamanic Totem', center: 'self', radius: R(500), mods: { spell: 0.10 }, perLevel: 0.04, dur: 5, durPerLevel: 0.2, fx: 'fire' },
        { kind: 'mana', radius: R(500), pct: 0.075 },
      ] }),
    ],
    // While branded, hits have a 20% chance to make the creep permanently weaker to fire; about three per brand.
    actives: (row) => [autocast(row, 'demonicFire', '😈', 'Brands a creep with demonic fire: while it burns, hits keep making it permanently weaker to fire towers.', 'creep',
      { kind: 'debuff', stackVuln: { pct: 0.09, pctPerLevel: 0.0024, max: 20, element: 'fire', permanent: true, key: 'demonicFire' }, debuffDur: 5, debuffDurPerLevel: 0.2, fx: 'fire' })],
  },

  // Each hit adds a stack of burning that also makes the creep take more fire damage.
  area_roaster: {
    passives: (row) => {
      const [vuln, dmg, add] = at([[0.07, 35, 1.4], [0.14, 70, 2.8], [0.21, 140, 5.6]], row);
      // A stack ticks twice per second; every hit adds a stack and refreshes the burn.
      return [proc('Ignite', 'hit', { chance: 1, silent: true }, {
        kind: 'debuff', dot: { dps: dmg * 2, dpsPerLevel: +(add * 2).toFixed(1), dur: 5, maxStacks: 200, key: 'ignite' },
        vulnElement: { el: 'fire', pct: vuln }, debuffDur: 5, quiet: true, fx: 'fire' })];
    },
  },

  // Roars on hits, stacking a damage buff on every tower nearby.
  fiery_dog: {
    passives: (row) => {
      const lm = at([6, 9, 12, 15, 18], row);
      return [proc('Roar', 'hit', { chance: 0.3 }, { kind: 'multi', effects: [
        { kind: 'towerBuff', key: 'roar', label: 'Roar', center: 'self', radius: R(420), mods: { damage: 0.05 }, perLevel: lm * 0.0005 / 0.05, dur: 5, fx: 'fire' },
        { kind: 'towerBuff', key: 'roarStack', label: 'Roar Stacks', center: 'self', radius: R(420), mods: { damage: lm * 0.0005 }, dur: 5, maxStacks: 100, quiet: true, fx: 'fire' },
      ] })];
    },
  },

  lesser_elemental_ghost: {
    passives: (row) => {
      const [add, chance] = at([[0.005, 0.15], [0.006, 0.175], [0.007, 0.2], [0.008, 0.225], [0.009, 0.25]], row);
      return [
        proc('Elemental Wrath', 'attack', { chance }, {
          kind: 'towerBuff', key: 'wrath', label: 'Elemental Wrath', mods: { trigger: 0.15 }, perLevel: add / 0.15, dur: 5, durPerLevel: 0.1, fx: 'fire' }),
        // Original rerolls the damage type every hit (x0.6 to x1.8, about +17% on average).
        proc('Mimic', 'hit', { chance: 0.5, silent: true }, { kind: 'attackDamage', mult: 0.33, fx: 'fire' }),
      ];
    },
  },

  crimson_wyrm: {
    passives: () => {
      // Every 8-12 attacks (fewer at high level) it hurls fireballs at random creeps in range; a fourth from level 10.
      const fireball = { kind: 'bolts', count: 3, interval: 0.15, flat: 3750, flatPerLevel: 150, radius: R(250), range: R(950), fx: 'fire' };
      return [
        proc('Flaming Inferno', 'attack', { every: 9 }, fireball),
        proc('Flaming Inferno', 'attack', { every: 9, minLevel: 10, key: 'inferno4', silent: true }, { ...fireball, count: 1 }),
        // Hoarded bounty grows both attack and spell damage (up to +1800% at a full hoard), kept on upgrade.
        proc("Dragon's Hoard", 'kill', { chance: 1, silent: true }, { kind: 'multi', effects: [
          { kind: 'growSelf', stat: 'damage', amount: 0.003, cap: 18 },
          { kind: 'growSelf', stat: 'spell', amount: 0.003, cap: 18 },
        ] }),
      ];
    },
  },

  vulshok_the_berserker: {
    passives: () => [
      // Every third attack crits in the original.
      { type: 'crit', chance: 1 / 3, mult: 1.5 },
      proc('Ultimate Fighter', 'attack', { every: 7 }, { kind: 'attackDamage', flat: 3000, flatPerLevel: 200, fx: 'fire' }),
      proc('Cleave', 'attack', { every: 12 }, { kind: 'attackDamage', mult: 1, radius: R(200), slow: 0.2, slowPerLevel: 0.02, slowDur: 5, fx: 'fire' }),
      proc('Grow', 'attack', { every: 15, silent: true }, { kind: 'growSelf', stat: 'damage', amount: 0.005 }),
      // The slow deepens every second it stays on the creep; averaged over its 5s.
      proc('Maim', 'hit', { chance: 1, silent: true }, { kind: 'debuff', slow: 0.2, slowPerLevel: 0.02, slowDur: 5, quiet: true, fx: 'fire' }),
    ],
  },

  little_phoenix: {
    passives: (row) => {
      const [count, armor, eruptPerStack, eruptAdd] = at([[1, 0.5, 50, 1], [2, 0.6, 156, 3.9], [3, 0.7, 308, 8.8]], row);
      const mult = +(eruptPerStack / avgDmg(row)).toFixed(4);
      return [
        proc('Twin Attack', 'attack', { chance: 1, silent: true }, { kind: 'barrage', count, mult: 1, fx: 'fire' }),
        proc('Twin Attack', 'attack', { chance: 1, minLevel: 15, key: 'twin15', silent: true }, { kind: 'barrage', count: 1, mult: 1, fx: 'fire' }),
        { type: 'shred', armor, maxStacks: 50, dur: 5, desc: `Phoenixfire: each hit strips ${armor} armor for 5s, stacking.` },
        // The original erupts when the stacks expire; each stack's share is dealt on hit instead.
        proc('Phoenix Explosion', 'hit', { chance: 1, silent: true }, { kind: 'attackDamage', mult, perLevel: eruptAdd / eruptPerStack, radius: R(200), quiet: true, fx: 'fire' }),
      ];
    },
  },

  the_omnislasher: {
    // Ten slashes per attack; every slash makes the creep permanently take +4% more physical attack damage.
    passives: () => [proc('Omnislash', 'hit', { chance: 1, silent: true }, {
      kind: 'debuff', stackVuln: { pct: 0.4, max: 250, attack: 'physical', permanent: true, key: 'omnislash' }, quiet: true, fx: 'fire' })],
  },

  caged_fire: {
    passives: (row) => {
      const [armor, armorAdd, dmg, add] = at([[3, 0.12, 20, 0.8], [6, 0.24, 40, 1.6]], row);
      return [
        // Armor loss ramps up every second a creep stays inside; the value averages about 4s of exposure.
        { type: 'creepAura', slow: 0, armor, armorPerLevel: armorAdd, radius: R(900) },
        // Every second inside the cage adds a stack to the burn, so damage ramps up linearly.
        proc('Melt', 'periodic', { icd: 1, needCreeps: true, silent: true }, {
          kind: 'debuff', radius: R(900), dot: { dps: dmg, dpsPerLevel: add, dur: 1.5, maxStacks: 300, key: 'melt' }, quiet: true, fx: 'fire' }),
      ];
    },
  },

  servant_of_the_twin_flames: {
    passives: (row) => {
      const [flame, flameAdd, pulse, pulseAdd, crit] = at([[0.65, 0.005, 0.55, 0.005, 0.01], [0.75, 0.01, 0.75, 0.01, 0.02]], row);
      return [
        // Red flames roll the tower's spell crit chance on each attack.
        proc('Red Flame', 'attack', { chance: 0.1 }, { kind: 'attackDamage', mult: flame, perLevel: flameAdd / flame, fx: 'fire' }),
        // Green flames roll the attack crit chance, which on average is one per crit.
        proc('Green Flame', 'crit', { chance: 1 }, { kind: 'spellDamage', mult: flame, perLevel: flameAdd / flame, fx: 'fire' }),
        // Every 8 flames of one colour pulse through everything nearby.
        proc('Red Pulse', 'attack', { every: 80 }, { kind: 'spellDamage', mult: pulse, perLevel: pulseAdd / pulse, radius: R(900), fx: 'fire' }),
        proc('Green Pulse', 'crit', { chance: 0.125 }, { kind: 'attackDamage', mult: pulse, perLevel: pulseAdd / pulse, radius: R(900), fx: 'fire' }),
        proc('Twin Disciplines', 'crit', { chance: 1, silent: true }, {
          kind: 'towerBuff', key: 'disciplines', label: 'Twin Disciplines', mods: { crit, spellCrit: crit }, dur: 7, maxStacks: 10, quiet: true }),
      ];
    },
  },

  geothermal_extractor: {
    passives: (row) => {
      const [value, add] = at([[0.18, 0.005], [0.3, 0.008]], row);
      return [{ type: 'aura', stat: 'damage', value, valuePerLevel: add, radius: R(row.auras[0]?.range ?? 200) }];
    },
  },

  inflamed_stone: {
    passives: (row) => {
      const perMana = at([0.08, 0.09, 0.10], row);
      // Once mana passes 20, the next hit burns all of it into a crit that grows with every mana point above 20.
      return [proc('Spellfire Projectiles', 'hit', { chance: 1, manaCost: 20 }, {
        kind: 'attackDamage', mult: 0.5, scaleBy: { kind: 'mana', per: perMana / 0.5 }, spendMana: 1, fx: 'fire' })];
    },
  },

  portal_to_swine_purgatory: {
    passives: (row) => {
      const pigs = at([2, 3, 3], row);
      const rampage = (count) => ({ kind: 'barrage', count, mult: 1, fx: 'fire' });
      return [
        // The attack itself is the first pig; one more pig joins at level 5 and another at 15.
        proc('Rampage of Pigs', 'attack', { chance: 1, silent: true }, rampage(pigs - 1)),
        proc('Rampage of Pigs', 'attack', { chance: 1, minLevel: 5, key: 'pigs5', silent: true }, rampage(1)),
        proc('Rampage of Pigs', 'attack', { chance: 1, minLevel: 15, key: 'pigs15', silent: true }, rampage(1)),
        // Each pig's landing splashes a share of its damage as spell damage.
        proc('Pig Splash', 'hit', { chance: 1, silent: true }, { kind: 'spellDamage', mult: 0.15, perLevel: 0.004 / 0.15, quiet: true, fx: 'fire' }),
        // Creeps entering range and dying build initiative; about one in eight normal creeps fills the bar.
        proc('Initiative', 'enter', { chance: 0.125 }, rampage(pigs)),
        proc('Initiative', 'kill', { chance: 0.125, key: 'initiativeKill' }, rampage(pigs)),
      ];
    },
  },

  fire_battery: {
    passives: (row) => {
      const [, , dot, dotAdd, vuln] = at([[300, 12, 120, 5, 0.05], [750, 30, 300, 12, 0.10], [1800, 72, 800, 32, 0.15]], row);
      return [proc('Incinerate', 'hit', { chance: 1, silent: true }, {
        kind: 'debuff', dot: { dps: dot, dpsPerLevel: dotAdd, dur: 9, key: 'incinerate' },
        vulnElement: { el: 'fire', pct: vuln }, debuffDur: 9, debuffDurPerLevel: 0.3, quiet: true, fx: 'fire' })];
    },
    actives: (row) => {
      const [dmg, add, dot, dotAdd, vuln] = at([[300, 12, 120, 5, 0.05], [750, 30, 300, 12, 0.10], [1800, 72, 800, 32, 0.15]], row);
      // One fireball per 10 stored mana (10 for the cast itself), so the volley grows with the charge.
      return [autocast(row, 'overload', '🔋', `Dumps its stored charge as a stream of fireballs at random creeps, one per 10 mana, each dealing ${dmg} spell damage (+${add} per level) and igniting the creep.`, 'self',
        { kind: 'bolts', count: 10, interval: 0.2, flat: dmg, flatPerLevel: add, range: R(1200), scaleBy: { kind: 'mana', per: 0.01 }, spendMana: 1,
          dot: { dps: dot, dpsPerLevel: dotAdd, dur: 9, key: 'incinerate' }, vulnElement: { el: 'fire', pct: vuln }, debuffDur: 9, debuffDurPerLevel: 0.3, fx: 'fire' },
        { range: R(1200) })];
    },
  },

  fire_star: {
    passives: () => [
      // The ignite ticks every 2s (one attack interval) and gets stronger with every stack; about five stacks on average.
      proc('Burn!', 'hit', { chance: 1, silent: true }, { kind: 'attackDamage', mult: 1.25, perLevel: 0.04, slow: 0.05, slowPerLevel: 0.01, slowDur: 2.5, fx: 'fire' }),
      proc('Double the Trouble', 'hit', { chance: 0.125, chancePerLevel: 0.005 }, { kind: 'attackDamage', mult: 1, fx: 'fire' }),
    ],
  },

  shaman: {
    // Original: towers nearby that crit gain experience until a level cap.
    passives: (row) => [{ type: 'aura', stat: 'xp', value: at([0.1, 0.15, 0.2], row), radius: R(at([250, 300, 350], row)) }],
    actives: (row) => {
      const [crit, critAdd, as, asAdd] = at([[0.45, 0.004, 0.15, 0.002], [0.55, 0.006, 0.20, 0.003], [0.65, 0.008, 0.25, 0.004]], row);
      return [autocast(row, 'bloodlust', '🩸', `Sends a tower into a bloodlust: +${Math.round(as * 100)}% attack speed and +x${crit} crit damage, growing with level.`, 'tower',
        { kind: 'multi', effects: [
          { kind: 'towerBuff', key: 'bloodlust', label: 'Bloodlust', mods: { attackSpeed: as }, perLevel: asAdd / as, dur: 5, durPerLevel: 0.12, fx: 'fire' },
          { kind: 'towerBuff', key: 'bloodlustCrit', label: 'Bloodlust', mods: { critMult: crit }, perLevel: critAdd / crit, dur: 5, durPerLevel: 0.12, quiet: true },
        ] }, { allowSelf: true })];
    },
  },

  felweed: {
    passives: (row) => {
      const [n, b1, b2, b3, b4, a1, a2, a3, a4] = at([
        [7, 1.10, 1.20, 1.30, 1.40, 0.002, 0.004, 0.006, 0.008], [7, 1.10, 1.20, 1.30, 1.40, 0.002, 0.004, 0.006, 0.008],
        [6, 1.125, 1.25, 1.375, 1.50, 0.0025, 0.005, 0.0075, 0.01], [6, 1.125, 1.25, 1.375, 1.50, 0.0025, 0.005, 0.0075, 0.01],
        [5, 1.15, 1.30, 1.45, 1.60, 0.003, 0.006, 0.009, 0.012], [5, 1.15, 1.30, 1.45, 1.60, 0.003, 0.006, 0.009, 0.012]], row);
      return [[b1, a1], [b2, a2], [b3, a3], [b4, a4]].map(([b, a], i) => proc('Fireblossom', 'hit', { every: n + i, key: `blossom${i}`, silent: true },
        { kind: 'attackDamage', mult: +(b - 1).toFixed(3), perLevel: a / (b - 1), fx: 'fire' }));
    },
  },

  firestorm_cell: {
    passives: (row) => {
      const [chance, chanceAdd, dmg, add] = at([[0.12, 0.004, 100, 3], [0.16, 0.005, 300, 10], [0.20, 0.006, 800, 35], [0.24, 0.007, 1400, 65]], row);
      // Three firestorm pulses around the creep (any left over burst when it dies), dealt at once.
      return [proc('Firestorm', 'attack', { chance, chancePerLevel: chanceAdd }, { kind: 'spellDamage', flat: dmg * 3, flatPerLevel: add * 3, radius: R(300), fx: 'fire' })];
    },
  },

  the_furnace: {
    passives: () => {
      const linger = { dps: 100, dpsPerLevel: 2, dur: 10, maxStacks: 200, key: 'lingering' };
      return [
        { type: 'randomTarget', desc: 'Uncontrollable Flames: attacks a random creep in range.' },
        proc('Stoke', 'attack', { chance: 1, silent: true }, { kind: 'mana', self: true, pct: 0.01 }),
        // Stacking burn: every hit adds 100 (+2 per level) spell damage per second for 10s.
        proc('Lingering Flame', 'hit', { chance: 1, silent: true }, { kind: 'debuff', dot: linger, quiet: true, fx: 'fire' }),
        // Burn ticks sometimes return mana, more with more stacks; about five stacks on average.
        proc('Lingering Embers', 'hit', { chance: 0.2, chancePerLevel: 0.004, silent: true }, { kind: 'mana', self: true, pct: 0.025 }),
        proc('Feed the Flames', 'kill', { chance: 1, silent: true }, { kind: 'multi', effects: [
          { kind: 'growSelf', stat: 'manaFlat', amount: 10 },
          { kind: 'mana', self: true, pct: 0.04 },
        ] }),
        // Shares part of the Furnace's own speed bonuses with lesser fire towers; a fixed estimate here.
        { type: 'aura', stat: 'attackSpeed', value: 0.1, radius: R(350), element: 'fire', rarities: ['common', 'uncommon'] },
      ];
    },
    actives: (row) => [autocast(row, 'intenseHeat', '♨', 'Pours all its mana into a heatwave: every creep in range takes 7 (+0.2 per level) spell damage per mana point and gains a Lingering Flame stack, and towers nearby gain crit chance.', 'self',
      { kind: 'multi', effects: [
        { kind: 'spellDamage', flat: 7, flatPerLevel: 0.2, scaleBy: { kind: 'mana', per: 1 }, spendMana: 1, radius: R(1000),
          dot: { dps: 100, dpsPerLevel: 2, dur: 10, maxStacks: 200, key: 'lingering' }, fx: 'fire' },
        // Crit bonus scales with the mana spent; this is the value for half a full pool.
        { kind: 'towerBuff', key: 'intenseHeat', label: 'Intense Heat', center: 'self', radius: R(350), mods: { crit: 0.05, spellCrit: 0.05 }, dur: 4, quiet: true },
      ] })],
  },

  cruel_fire: {
    passives: (row) => {
      const [value, add] = at([[0.05, 0.002], [0.075, 0.003], [0.1, 0.004]], row);
      return [{ type: 'aura', stat: 'crit', value, valuePerLevel: add, radius: R(row.auras[0]?.range ?? 300) }];
    },
  },

  living_volcano: {
    passives: (row) => [
      proc('Lava Attack', 'attack', { chance: 0.25 }, { kind: 'spellDamage', flat: 3500, flatPerLevel: 100, radius: R(300), fx: 'fire' }),
      // Creeps in the aura lose 3% of their current health every second (bosses too).
      proc('Heat Aura', 'periodic', { icd: 1, needCreeps: true, silent: true }, {
        kind: 'spellDamage', flat: 0, pctHp: 0.03, bossPctMult: 1, radius: R(row.auras[0]?.range ?? 700), quiet: true, fx: 'fire' }),
      proc('Heat Stroke', 'death', { chance: 0.4 }, { kind: 'spellDamage', flat: 4500, flatPerLevel: 100, radius: R(300), fx: 'fire' }),
    ],
  },

  dragon_sorcerer: {
    actives: (row) => [autocast(row, 'burningMark', '🐉', 'Marks a tower with dragon fire: an extra crit roll, more crit chance and faster attacks.', 'tower',
      { kind: 'multi', effects: [
        { kind: 'towerBuff', key: 'burningMark', label: 'Burning Mark', mods: { crit: 0.075 }, perLevel: 0.002 / 0.075, dur: 10, durPerLevel: 0.4, fx: 'fire' },
        { kind: 'towerBuff', key: 'burningMarkSpeed', label: 'Burning Mark', mods: { attackSpeed: 0.25 }, perLevel: 0.006 / 0.25, dur: 10, durPerLevel: 0.4, quiet: true },
        { kind: 'towerBuff', key: 'burningMarkCrit', label: 'Burning Mark', mods: { multicrit: 1 }, dur: 10, durPerLevel: 0.4, quiet: true },
      ] }, { allowSelf: true })],
  },

  embershell_turtle_hatchling: {
    // Every attack costs 1 mana and it stops when dry: with 1 mana/s regen it sustains about one attack in four.
    passives: () => [{ type: 'miss', base: 0.75, perLevel: 0, desc: 'Overheat: runs out of steam, so only about one attack in four lands.' }],
  },

  the_fire_lord: {
    passives: () => [
      proc('Hellfire', 'attack', { chance: 0.25, chancePerLevel: 0.002 }, { kind: 'towerBuff', key: 'hellfire', label: 'Hellfire', mods: { multishot: 4 }, dur: 7.5, durPerLevel: 0.2, fx: 'fire' }),
      proc('Liquid Fire', 'hit', { chance: 1, silent: true }, {
        kind: 'debuff', dot: { dps: 500, dpsPerLevel: 50, dur: 5, key: 'liquidFire' },
        stackVuln: { pct: 0.10, pctPerLevel: 0.004, max: 1, element: 'fire', key: 'liquidFire' }, debuffDur: 5, debuffDurPerLevel: 0.1, quiet: true, fx: 'fire' }),
    ],
  },

  ash_geyser: {
    passives: () => [proc('Ignite', 'hit', { chance: 0.3 }, { kind: 'debuff', burn: 0.15, burnDur: 8, fx: 'fire' })],
  },

  meteor_totem: {
    passives: () => [
      // Torture echoes 8% (+0.1% per level) of big attack hits as spell damage: about that much damage taken.
      proc('Torture', 'hit', { chance: 1, silent: true }, { kind: 'debuff', curse: 0.08, cursePerLevel: 0.001, debuffDur: 2.5, debuffDurPerLevel: 0.05, quiet: true, fx: 'fire' }),
      // One more meteor for every 5 levels.
      ...[5, 10, 15, 20, 25].map((lv) => proc('Attraction', 'cast', { chance: 1, minLevel: lv, key: `attraction${lv}`, silent: true },
        { kind: 'bolts', count: 1, flat: 200, flatPerLevel: 8, radius: R(220), range: R(1000), fx: 'fire' })),
    ],
    // Nearby towers each pull down a meteor on their next attack; modelled as meteors on random creeps.
    actives: (row) => [autocast(row, 'attraction', '☄', 'Calls four meteors (one more every 5 levels) down on random creeps, each dealing 200 spell damage (+8 per level) in a small area.', 'self',
      { kind: 'bolts', count: 4, interval: 0.3, flat: 200, flatPerLevel: 8, radius: R(220), range: R(1000), fx: 'fire' }, { range: row.range / UNIT })],
  },

  burning_watchtower: {
    passives: (row) => {
      const [bonus, bonusAdd, explode] = at([[1.0, 0.10, 49], [2.5, 0.25, 277], [4.0, 0.40, 750], [5.5, 0.55, 1875]], row);
      // Each of its hits on a burning creep adds flat damage to every later fire hit; expressed per stack of its own damage.
      const avg = avgDmg(row);
      return [
        proc('Burn', 'hit', { chance: 1, silent: true }, {
          kind: 'debuff', stackVuln: { pct: +(bonus / avg).toFixed(4), pctPerLevel: +(bonusAdd / avg).toFixed(5), max: 30, element: 'fire', key: 'burningWatch' },
          debuffDur: 5, debuffDurPerLevel: 0.12, quiet: true, fx: 'fire' }),
        proc('Burn Out', 'death', { chance: 1 }, { kind: 'spellDamage', flat: explode, radius: R(200), fx: 'fire' }),
      ];
    },
  },

  fenced_flames: {
    passives: (row) => {
      const [ratio, add] = at([[0.08, 0.0016], [0.10, 0.002], [0.12, 0.0048], [0.16, 0.0064]], row);
      // Embers fly from a nearby common tower at every creep in range.
      return [proc('Embers', 'periodic', { icd: 1, needCreeps: true, silent: true }, {
        kind: 'spellDamage', mult: ratio, perLevel: add / ratio, radius: row.range / UNIT, quiet: true, fx: 'fire' })];
    },
  },
};
