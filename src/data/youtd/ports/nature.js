// Ported nature tower behaviors, keyed by YouTD 2 script name (MIT, see third_party/youtd2).
// Mechanics are re-implemented with this game's ability engine; descriptions are our own.

import { UNIT, at, proc, autocast } from './helpers.js';

// Aura radius from the tower's own aura row, in world units.
const auraRadius = (row, fallback) => (row.auras[0]?.range ?? fallback) / UNIT;

// Tower aura on one stat channel; the engine adds the tower footprint to the radius.
const aura = (stat, value, valuePerLevel, radius) => ({ type: 'aura', stat, value, valuePerLevel, radius });

// Ground creeps below boss size (YouTD roots and entangles skip air and bosses).
const GROUND_SMALL = ['mass', 'normal', 'champion', 'challengeMass'];

export const PORTS = {
  annoyed_tree: {
    passives: (row) => {
      const [dmg, add, r] = at([[150, 5, 300], [600, 20, 350], [1200, 40, 400], [1950, 65, 450]], row);
      return [proc('Rock Throw', 'attack', { chance: 0.3, chancePerLevel: 0.06 },
        { kind: 'spellDamage', flat: dmg, flatPerLevel: add, radius: r / UNIT, fx: 'nature' })];
    },
  },

  green_dragon_roost: {
    passives: (row) => [{ ...aura('multicrit', 2, 0, auraRadius(row, 200)), name: 'Green Dragon Force' }],
  },

  lesser_wolves_den: {
    passives: (row) => {
      const [as, add] = at([[0.10, 0.005], [0.15, 0.0075], [0.20, 0.01]], row);
      return [{ ...aura('attackSpeed', as, add, auraRadius(row, 200)), name: 'Wolven Tenacity' }];
    },
  },

  regenerating_well: {
    passives: (row) => {
      const [, , spell, add] = at([[0.10, 0.004, 0.15, 0.006], [0.15, 0.006, 0.20, 0.008], [0.20, 0.008, 0.25, 0.010]], row);
      return [{ ...aura('spell', spell, add, auraRadius(row, 200)), name: 'Cleansing Water' }];
    },
    actives: (row) => {
      const [pct] = at([[0.10, 0.004], [0.15, 0.006], [0.20, 0.008]], row);
      return [autocast(row, 'replenish', '💧', `Refills ${Math.round(pct * 100)}% of the maximum mana of every tower nearby.`, 'self',
        { kind: 'mana', radius: 500 / UNIT, pct, fx: 'nature' }, { anytime: true })];
    },
  },

  sacred_altar: {
    // The original aura lets every nearby tower root creeps; here the altar's own attacks do it,
    // with the per-attack chance the aura grants a tower of the altar's attack speed.
    passives: (row) => [proc('Entangle', 'attack', { chance: 0.10 * row.cd, chancePerLevel: 0.002 * row.cd, sizes: GROUND_SMALL },
      { kind: 'debuff', stun: 1.2, dot: { dps: 700, dpsPerLevel: 35, dur: 1, key: 'altar-entangle' }, fx: 'nature' })],
  },

  afflicted_obelisk: {
    passives: (row) => {
      const [vuln, add] = at([[0.025, 0.0005], [0.030, 0.0006], [0.035, 0.0007], [0.040, 0.0008]], row);
      // Every hit plants a parasite for 3s: the creep takes more nature damage while it lives,
      // then it bursts for another full attack.
      return [proc('Slumbering Parasite', 'hit', { chance: 1, silent: true }, { kind: 'multi', effects: [
        { kind: 'debuff', stackVuln: { pct: vuln, pctPerLevel: add, max: Math.ceil(3 / row.cd) + 1, element: 'nature', key: 'parasite' },
          debuffDur: 3, quiet: true, fx: 'nature' },
        { kind: 'attackDamage', mult: 1, delay: 3, fx: 'nature' },
      ] })];
    },
  },

  rooted_chasm: {
    passives: (row) => {
      const [dur, dps] = at([[1.5, 120], [2.25, 660], [3.0, 1800], [3.75, 4300]], row);
      return [proc('Entangle', 'hit', { chance: 0.125, chancePerLevel: 0.002, sizes: GROUND_SMALL },
        { kind: 'debuff', stun: dur, dot: { dps, dpsPerLevel: dps / 20, dur: Math.floor(dur), key: 'chasm-entangle' }, fx: 'nature' })];
    },
  },

  wild_warbeast: {
    passives: (row) => {
      const radius = auraRadius(row, 400);
      return [
        { ...aura('crit', 0.03, 0.0006, radius), name: 'Beast Dung' },
        { ...aura('critMult', 0.15, 0.003, radius), name: 'Beast Dung' },
        { ...aura('attackSpeed', 0.10, 0.002, radius), name: 'Beast Dung' },
        { ...aura('damage', 0.10, 0.002, radius), name: 'Beast Dung' },
        // Each devour adds another copy of the aura for 6s.
        proc('Devour', 'attack', { chance: 0.06, chancePerLevel: 0.001 }, { kind: 'multi', effects: [
          { kind: 'spellDamage', flat: 5000, flatPerLevel: 400, fx: 'nature' },
          { kind: 'towerBuff', key: 'devour', label: 'Devour', center: 'self', radius,
            mods: { crit: 0.03, critMult: 0.15, attackSpeed: 0.10, damage: 0.10 }, perLevel: 0.02, dur: 6, maxStacks: 3, quiet: true, fx: 'nature' },
        ] }),
      ];
    },
  },

  forest_archer: {
    passives: (row) => {
      const [stun, slow, slowDur] = at([[0.05, 0.10, 7.5], [0.06, 0.15, 8.5], [0.07, 0.20, 9.5]], row);
      return [
        proc('Gift of the Forest', 'hit', { chance: stun, chancePerLevel: 0.001 }, { kind: 'debuff', stun: 1.75, stunPerLevel: 0.05, fx: 'nature' }),
        // Roots only roll when the stun did not.
        proc('Grasping Roots', 'hit', { chance: slow * (1 - stun), chancePerLevel: 0.001 }, { kind: 'debuff', slow: 0.15, slowDur, fx: 'nature' }),
        { type: 'levelBonus', level: 15, mods: { multishot: 1 } },
      ];
    },
  },

  mud_golem: {
    passives: (row) => {
      const smash = { kind: 'attackDamage', flat: 4300, flatPerLevel: 230, radius: 750 / UNIT, slow: 0.6, slowDur: 0.5, fx: 'nature' };
      return [
        proc('Ground Smash', 'hit', { chance: 1 }, smash),
        // The Earthquake aura also lets the golem's own attacks smash (other towers' attacks are not ported).
        proc('Earthquake', 'attack', { chance: 0.03 * row.cd, chancePerLevel: 0.0004 * row.cd }, smash),
      ];
    },
  },

  razorboar_thornweaver: {
    passives: (row) => {
      const [chance, add, dbl, tpl] = at([[0.12, 0.0015, 0.05, 0.03], [0.15, 0.0018, 0.07, 0.05], [0.18, 0.0021, 0.09, 0.07]], row);
      const spray = { kind: 'attackDamage', mult: 0.3, perLevel: 0.002 / 0.3, radius: 800 / UNIT, fx: 'nature' };
      // Above level 15 a spray can repeat; at level 25 it always repeats and may repeat twice.
      // The level-25 entry tops the level-16 one up to that expectation.
      const extra25 = 1 + tpl - dbl;
      return [
        proc('Occasional Thornspray', 'attack', { chance, chancePerLevel: add }, spray),
        proc('Double Thornspray', 'attack', { chance: chance * dbl, chancePerLevel: add * dbl, minLevel: 16 }, spray),
        proc('Triple Thornspray', 'attack', { chance: chance * extra25, chancePerLevel: add * extra25, minLevel: 25 }, spray),
        proc('Thornspray Echo', 'cast', { chance: dbl, minLevel: 16 }, spray),
        proc('Thornspray Echo II', 'cast', { chance: extra25, minLevel: 25 }, spray),
      ];
    },
    actives: (row) => [autocast(row, 'thornspray', '🌵', 'Sprays thorns at every creep around the boar.', 'self',
      { kind: 'attackDamage', mult: 0.3, perLevel: 0.002 / 0.3, radius: 800 / UNIT, fx: 'nature' })],
  },

  cute_small_spider: {
    passives: (row) => {
      const [dmg, add] = at([[30, 1.5], [90, 4.5], [270, 13.5], [750, 37.5]], row);
      return [proc('Poisonous Spittle', 'hit', { chance: 1, silent: true },
        { kind: 'debuff', dot: { dps: dmg, dpsPerLevel: add, dur: 5, maxStacks: 5, key: 'spider-poison' }, quiet: true, fx: 'nature' })];
    },
  },

  skink: {
    // The original poisons through every nearby tower's attacks; here only the skink's own attacks do.
    passives: (row) => {
      const [dmg, add] = at([[3, 0.12], [10, 0.4], [30, 1.2], [76.5, 3.06], [127.5, 5.1]], row);
      return [proc('Poisonous Skin', 'attack', { chance: 1, silent: true },
        { kind: 'debuff', dot: { dps: dmg, dpsPerLevel: add, dur: 5, maxStacks: 50, key: 'skink-poison' }, quiet: true, fx: 'nature' })];
    },
  },

  bonk_the_living_mountain: {
    passives: () => [
      proc('Grow!', 'periodic', { icd: 25, silent: true }, { kind: 'multi', effects: [
        // 160 growths; the cap assumes they were all gained at level 25.
        { kind: 'growSelf', stat: 'damage', amount: 0.03, amountPerLevel: 0.001, cap: 160 * (0.03 + 0.001 * 25) },
        { kind: 'xp', amount: 4 },
      ] }),
      proc('Landslide!', 'attack', { chance: 0.25 },
        { kind: 'spellDamage', flat: 700, flatPerLevel: 50, radius: 300 / UNIT, stun: 0.5, fx: 'nature' }),
      proc('Crush!', 'hit', { chance: 1, cond: 'stunned' }, { kind: 'multi', effects: [
        { kind: 'spellDamage', flat: 5000, flatPerLevel: 250, fx: 'nature' },
        { kind: 'towerBuff', key: 'morale', label: 'Morale', center: 'self', radius: 500 / UNIT, mods: { damage: 0.1, attackSpeed: 0.1 }, perLevel: 0.04, dur: 10, fx: 'nature' },
      ] }),
    ],
  },

  forest_troll: {
    passives: (row) => {
      const [chance, lvlBase, lvlAdd, dur, durAdd] = at([[0.14, 0, 2, 4, 0.08], [0.15, 50, 3, 5, 0.10], [0.16, 100, 4, 6, 0.12]], row);
      const as = 1.5 + 0.01 * lvlBase;
      return [proc('Rampage', 'attack', { chance, icd: dur }, { kind: 'multi', effects: [
        { kind: 'towerBuff', key: 'rampage', label: 'Rampage', mods: { attackSpeed: as }, perLevel: (0.01 * lvlAdd) / as, dur, durPerLevel: durAdd, fx: 'nature' },
        { kind: 'towerBuff', key: 'rampage-crit', label: 'Rampage', mods: { crit: 0.25, critMult: 0.75 }, dur, durPerLevel: durAdd, quiet: true, fx: 'nature' },
      ] })];
    },
  },

  cenarion: {
    passives: (row) => [
      { ...aura('damage', 0.4, 0.004, auraRadius(row, 450)), name: 'Tranquility' },
      { ...aura('attackSpeed', -0.2, 0.004, auraRadius(row, 450)), name: 'Tranquility' },
      // A three-wave leaf blizzard over the target.
      proc('Leaf Storm', 'hit', { chance: 0.15, chancePerLevel: 0.006 },
        { kind: 'zone', flat: 700, flatPerLevel: 30, dur: 3, radius: 200 / UNIT, slow: 0.3, slowPerLevel: 0.006, slowDur: 1, fx: 'nature' }),
      proc('Thorned!', 'enter', { chance: 1, silent: true },
        { kind: 'debuff', stackVuln: { pct: 0.3, pctPerLevel: 0.006, max: 1, element: 'nature', key: 'thorned' },
          debuffDur: 3, debuffDurPerLevel: 0.06, quiet: true, fx: 'nature' }),
    ],
    actives: (row) => [autocast(row, 'roots', '🌿', 'Sends a fan of roots into a crowd, holding creeps in place while thorns tear at them.', 'area',
      { kind: 'debuff', radius: 300 / UNIT, stun: 1.5, stunPerLevel: 0.02, dot: { dps: 1100, dpsPerLevel: 44, dur: 1, key: 'cenarion-roots' }, fx: 'nature' })],
  },

  inexperienced_huntress: {
    passives: (row) => {
      const [crit, critAdd, ratio] = at([[0.25, 0.01, 0.25], [0.50, 0.02, 0.35], [0.75, 0.03, 0.45]], row);
      return [
        // A quick follow-up glaive that always lands as a (weak) critical hit.
        proc('Shadow Glaive', 'attack', { chance: 0.2, chancePerLevel: 0.008 },
          { kind: 'barrage', count: 1, mult: 1 + crit, perLevel: critAdd / (1 + crit), fx: 'shadow' }),
        proc('Star Glaive', 'hit', { chance: 0.25, chancePerLevel: 0.004 },
          { kind: 'spellDamage', mult: ratio, perLevel: 0.01 / ratio, fx: 'holy' }),
      ];
    },
  },

  poison_battery: {
    passives: (row) => {
      const [, , poison, poisonAdd, slow, slowAdd] = at([[300, 12, 100, 3, 0.05, 0.0012], [750, 30, 240, 8, 0.07, 0.0028], [1800, 72, 600, 20, 0.10, 0.004]], row);
      return [proc('Poison', 'hit', { chance: 1, silent: true },
        { kind: 'debuff', dot: { dps: poison, dpsPerLevel: poisonAdd, dur: 9, key: 'battery-poison' },
          slow, slowPerLevel: slowAdd, slowDur: 9, quiet: true, fx: 'nature' })];
    },
    actives: (row) => {
      const [dmg, add, poison, poisonAdd, slow, slowAdd] = at([[300, 12, 100, 3, 0.05, 0.0012], [750, 30, 240, 8, 0.07, 0.0028], [1800, 72, 600, 20, 0.10, 0.004]], row);
      // The spent 100 mana feeds one orb per 10 mana, fired every 0.2s at random creeps.
      return [autocast(row, 'overload', '🔋', 'Dumps the battery: a stream of poison orbs strikes random creeps nearby.', 'self',
        { kind: 'bolts', count: 9, interval: 0.2, flat: dmg, flatPerLevel: add, range: 1200 / UNIT,
          dot: { dps: poison, dpsPerLevel: poisonAdd, dur: 9, key: 'battery-poison' }, slow, slowPerLevel: slowAdd, slowDur: 9, fx: 'nature' })];
    },
  },

  magic_mushroom: {
    passives: () => [
      // 40% chance every 20s: one growth per ~50s on average, up to 40 growths.
      proc('Rapid Growth', 'periodic', { icd: 50, silent: true },
        { kind: 'growSelf', stat: 'spell', amount: 0.03, amountPerLevel: 0.0012, cap: 40 * (0.03 + 0.0012 * 25) }),
      // Each trance empowers the next hit; with the mushroom's mana that is about every 14th hit.
      proc('Fungus Strike', 'hit', { every: 14 },
        { kind: 'spellDamage', mult: 1, perLevel: 0.01,
          stackVuln: { pct: 0.1, max: 50, spellOnly: true, permanent: true, key: 'fungus' }, fx: 'nature' }),
    ],
    actives: (row) => [autocast(row, 'trance', '🍄', 'Sends a tower into a trance: stronger spells and more frequent triggered effects.', 'tower',
      { kind: 'towerBuff', key: 'trance', label: 'Mystical Trance', mods: { spell: 0.25, trigger: 0.25 }, perLevel: 0.04, dur: 5, durPerLevel: 0.2, fx: 'nature' },
      { allowSelf: true })],
  },

  forest_protectress: {
    passives: (row) => [
      // Meld builds +18%/s damage until Wrath fires and resets it; this keeps the average bonus.
      proc('Meld with the Forest', 'periodic', { icd: 1, silent: true },
        { kind: 'towerBuff', key: 'meld', label: 'Meld with the Forest', mods: { damage: 1.0 }, perLevel: 0.055, dur: 1.5, quiet: true, fx: 'nature' }),
      proc("Protectress's Wrath", 'hit', { chance: 0.27 },
        { kind: 'attackDamage', mult: 0.5, perLevel: 0.04, radius: 250 / UNIT, slow: 0.5, slowDur: 1.5, fx: 'nature' }),
      // Crit bonus scales with the target's remaining health; about half on average.
      { ...aura('crit', 0.125, 0.005, auraRadius(row, 175)), name: 'Strike the Unprepared' },
    ],
  },

  nature_sprites: {
    actives: (row) => {
      const s = at([1.0, 1.5, 2.0], row);
      // The original buff depends on the target's element plus a random second stat;
      // damage and attack speed stand in for that mix.
      return [autocast(row, 'gift', '🧚', 'Sprites bless a nearby tower with more damage and faster attacks.', 'tower',
        { kind: 'towerBuff', key: 'naturesGift', label: "Nature's Gift", mods: { damage: 0.16 * s, attackSpeed: 0.08 * s }, perLevel: 0.025, dur: 5, fx: 'nature' })];
    },
  },

  coconut_sapling: {
    passives: (row) => {
      const [dmg, add] = at([[1625, 162.5], [2600, 260]], row);
      // About 2.7-3 coconuts per hit scattered around the target; roughly 1.4 land on any creep there.
      const k = at([1.36, 1.5], row);
      return [proc('Coconut Rain', 'hit', { chance: 1 },
        { kind: 'spellDamage', flat: Math.round(dmg * k), flatPerLevel: Math.round(add * k), radius: 225 / UNIT, stun: 0.5, fx: 'nature' })];
    },
  },

  jungle_stalker: {
    passives: (row) => {
      const [gain, max, as, dur] = at([[0.002, 2.0, 1.0, 3], [0.003, 2.25, 1.25, 4], [0.004, 2.5, 1.5, 5]], row);
      return [
        proc('Feral Aggression', 'crit', { chance: 1, silent: true }, { kind: 'growSelf', stat: 'damage', amount: gain, cap: max }),
        proc('Bloodthirst', 'kill', { chance: 1, icd: dur },
          { kind: 'towerBuff', key: 'bloodthirst', label: 'Bloodthirst', mods: { attackSpeed: as }, perLevel: 0.01 / as, dur, durPerLevel: 0.05, fx: 'nature' }),
      ];
    },
  },

  garden_of_eden: {
    // Damage is stored lifeforce x wave level. Lifeforce comes from the garden's own kills and is
    // spent by every blast (10s cooldown); about 2 stored on average, 4 at blast time.
    passives: () => [proc('Essence of the Mortals', 'attack', { chance: 1, silent: true },
      { kind: 'spellDamage', flat: 4, scaleBy: { kind: 'wave', per: 1 }, quiet: true, fx: 'nature' })],
    actives: (row) => [autocast(row, 'edenWrath', '🌳', 'Releases the stored lifeforce in a huge blast around the garden.', 'self',
      { kind: 'spellDamage', flat: 60, scaleBy: { kind: 'wave', per: 1 }, delay: 0.5, radius: 1600 / UNIT, fx: 'nature' })],
  },

  greyfang: {
    passives: () => [proc('Bone Shatter', 'kill', { chance: 1 },
      { kind: 'attackDamage', mult: 0.2, radius: 300 / UNIT, fx: 'nature' })],
  },

  morphling: {
    // The Might/Swiftness stance toggles are not ported; the strike uses the Might variant
    // (burn) and evolves the tower each time it fires, up to 500 times.
    passives: () => [
      proc('Morphling Strike', 'hit', { chance: 0.2, chancePerLevel: 0.006 }, { kind: 'multi', effects: [
        { kind: 'chainSpell', flat: 2000, flatPerLevel: 60, count: 2, falloff: 0, jump: 900 / UNIT, burn: 0.25, burnDur: 5, fx: 'nature' },
        { kind: 'growSelf', stat: 'damage', amount: 0.002, cap: 1.0 },
        { kind: 'growSelf', stat: 'attackSpeed', amount: 0.001, cap: 0.5 },
      ] }),
    ],
  },
};
