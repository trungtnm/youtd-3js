// Ported storm tower behaviors, keyed by YouTD 2 script name (MIT, see third_party/youtd2).
// Mechanics are re-implemented with this game's ability engine; descriptions are our own.

import { UNIT, at, proc, autocast } from './helpers.js';

// Warcraft III distance -> world units, rounded so aura descriptions stay readable.
const rad = (u) => +(u / UNIT).toFixed(1);

export const PORTS = {
  broken_lightning_rod: {
    actives: (row) => {
      const [dmg, add] = at([[70, 3.5], [250, 12.5], [700, 35], [1400, 70], [2500, 125]], row);
      return [autocast(row, 'bolt', '⚡', `Strikes a creep for ${dmg} spell damage (+${add} per level).`, 'creep',
        { kind: 'spellDamage', flat: dmg, flatPerLevel: add, fx: 'storm' }, { pick: 'first' })];
    },
  },
  rotted_flashing_grave: {
    passives: () => [{ type: 'randomTarget', desc: 'Attacks a random creep in range.' }],
  },

  charged_obelisk: {
    // Every attack also zaps a random creep within 1000; bosses shrug off the stun.
    passives: () => [proc('Electric Field', 'attack', { chance: 1, silent: true },
      { kind: 'bolts', count: 1, interval: 0, flat: 1000, flatPerLevel: 40, range: 1000 / UNIT, stun: 0.2, bossStunMult: 0, fx: 'storm' })],
    // The charge starts at +25% (+0.6% per level) and grows every second by 5% (+0.1% per level).
    actives: (row) => {
      const grow = Array.from({ length: 9 }, (_, i) => ({ kind: 'towerBuff', key: 'chargegrow', label: 'Charge build-up',
        mods: { attackSpeed: 0.05 }, perLevel: 0.02, dur: 9 - i, maxStacks: 9, quiet: true, delay: i + 1, fx: 'storm' }));
      return [autocast(row, 'charge', '🔋', 'Charges a tower in range for 10 seconds: +25% attack speed (+0.6% per level), growing by 5% (+0.1% per level) every second.', 'tower',
        { kind: 'multi', effects: [
          { kind: 'towerBuff', key: 'charge', label: 'Charge', mods: { attackSpeed: 0.25 }, perLevel: 0.024, dur: 10, fx: 'storm' },
          ...grow] }, { allowSelf: true })];
    },
  },

  phantom: {
    passives: (row) => {
      const [dmg, add] = at([[100, 4], [300, 12], [600, 24], [1000, 40], [1800, 72]], row);
      return [proc('Wind Shear Bolt', 'attack', { chance: 0.25 },
        { kind: 'chainSpell', flat: dmg, flatPerLevel: add, count: 2, falloff: 0.25, fx: 'storm' })];
    },
    actives: (row) => {
      const as = at([0.10, 0.15, 0.20, 0.25, 0.30], row) + 0.01 * at([0, 5, 10, 15, 20], row);
      return [autocast(row, 'windshear', '🌪', `Wraps a nearby tower in shearing wind: +${Math.round(as * 100)}% attack speed (+1% per level) for 5 seconds.`, 'tower',
        { kind: 'towerBuff', key: 'windshear', label: 'Wind Shear', mods: { attackSpeed: as }, perLevel: 0.01 / as, dur: 5, durPerLevel: 0.1, fx: 'storm' },
        { allowSelf: true })];
    },
  },

  spell_collector: {
    // Missile count depends on spells cast nearby; three missiles is the typical volley.
    passives: (row) => {
      const [dmg, add] = at([[2000, 80], [4000, 160]], row);
      return [proc('Magical Barrage', 'attack', { chance: 0.2, chancePerLevel: 0.008 },
        { kind: 'spellDamage', flat: dmg * 3, flatPerLevel: add * 3, fx: 'arcane' })];
    },
  },

  storm_focus: {
    // The Gust aura turns the buffed tower's bonus vs air into general damage; the damage half
    // uses a linear fit of that conversion.
    actives: (row) => [autocast(row, 'freezinggust', '🌬', 'Chills a nearby tower for 5 seconds: +10% damage to air (+0.8% per level) and +10% damage overall (+1.3% per level).', 'tower',
      { kind: 'multi', effects: [
        { kind: 'towerBuff', key: 'freezinggust', label: 'Freezing Gust', mods: { vsAir: 0.1 }, perLevel: 0.08, dur: 5, durPerLevel: 0.05, fx: 'frost' },
        { kind: 'towerBuff', key: 'gust', label: 'Gust', mods: { damage: 0.1 }, perLevel: 0.128, dur: 5, durPerLevel: 0.05, quiet: true, fx: 'frost' }] },
      { allowSelf: true })],
  },

  harpy_witch: {
    passives: (row) => {
      const [chance, add, count, vuln, vulnAdd] = at([[0.08, 0.003, 2, 0.10, 0.004], [0.12, 0.005, 3, 0.18, 0.007]], row);
      return [proc('Twister', 'attack', { chance, chancePerLevel: add },
        { kind: 'bolts', attack: true, count, interval: 0.05, mult: 1, range: 1000 / UNIT, debuffDur: 5,
          stackVuln: { pct: vuln, pctPerLevel: vulnAdd, max: 1, element: 'storm', key: 'twister' }, fx: 'storm' })];
    },
    actives: (row) => {
      const [spell, spellAdd, crit, critAdd] = at([[0.15, 0.002, 0.10, 0.001], [0.20, 0.004, 0.125, 0.002]], row);
      return [autocast(row, 'sparks', '✨', `Gives a nearby tower +${Math.round(spell * 100)}% spell damage and +${+(crit * 100).toFixed(1)}% spell crit for 7.5 seconds (all three grow with level).`, 'tower',
        { kind: 'multi', effects: [
          { kind: 'towerBuff', key: 'sparks', label: 'Sparks', mods: { spell }, perLevel: spellAdd / spell, dur: 7.5, durPerLevel: 0.3, fx: 'storm' },
          { kind: 'towerBuff', key: 'sparkscrit', label: 'Sparks', mods: { spellCrit: crit }, perLevel: critAdd / crit, dur: 7.5, durPerLevel: 0.3, quiet: true, fx: 'storm' }] },
        { allowSelf: true })];
    },
  },

  gryphon_rider: {
    // The bolt hits its target again on arrival, then rolls on along a line, weakening each step.
    passives: () => [proc('Storm Bolt', 'hit', { chance: 1, silent: true }, { kind: 'multi', effects: [
      { kind: 'attackDamage', mult: 1, radius: 85 / UNIT, quiet: true, fx: 'storm' },
      { kind: 'attackDamage', mult: 0.6, perLevel: 0.02, radius: 2.7, delay: 0.15, quiet: true, fx: 'storm' }] })],
    // Upstream never sets the hammer's base damage; this uses attack damage, boosted 5% per storm
    // tower. Storm towers deal 10% less damage for 6 seconds, as upstream.
    actives: (row) => [autocast(row, 'hammerfall', '🔨', 'Drops a storm hammer on a creep, crushing and stunning every creep around it. Stronger with more storm towers, but storm towers deal 10% less damage for 6 seconds.', 'creep',
      { kind: 'multi', effects: [
        { kind: 'spellDamage', mult: 1, radius: 600 / UNIT, stun: 1, scaleBy: { kind: 'elementTowers', per: 0.05 }, fx: 'storm' },
        { kind: 'towerBuff', key: 'hammerfall', label: 'Hammer Fall', center: 'self', radius: 2500 / UNIT, element: 'storm', mods: { damage: -0.1 }, dur: 6, quiet: true, fx: 'storm' }] },
      { pick: 'strong' })],
  },

  lightning_eye: {
    // Each attack spends 40 mana on forked lightning: the target plus two random creeps.
    passives: (row) => [proc('Glare', 'attack', { chance: 1, manaCost: 40 }, { kind: 'multi', effects: [
      { kind: 'spellDamage', flat: 500, flatPerLevel: 120, pctHp: 0.015, bossPctMult: 1, fx: 'storm' },
      { kind: 'bolts', count: 2, interval: 0, flat: 500, flatPerLevel: 120, range: row.range / UNIT, fx: 'storm' }] })],
  },

  zealot: {
    passives: (row) => {
      const [zeal, pierce] = at([[0.02, 0.4], [0.04, 0.8], [0.06, 1.2], [0.08, 1.6]], row);
      return [
        proc('Zeal', 'attack', { chance: 1, silent: true },
          { kind: 'towerBuff', key: 'zeal', label: 'Zeal', mods: { attackSpeed: zeal }, dur: 2.5, maxStacks: 5, quiet: true, fx: 'storm' }),
        { type: 'shred', armor: pierce, maxStacks: 5, dur: 10,
          desc: `Phase Blade: each hit pierces ${pierce} more armor of its target, up to 5 times.` },
      ];
    },
  },

  zeus: {
    passives: () => [
      proc('Electrified Attack', 'hit', { chance: 1, silent: true },
        { kind: 'spellDamage', flat: 500, flatPerLevel: 20, radius: 175 / UNIT, fx: 'storm', quiet: true }),
      proc('Divine Hammer', 'kill', { chance: 1, silent: true }, { kind: 'mana', self: true, pct: 0.05 }),
    ],
    // 20 bolts over 4 seconds. The extra bolt every 5 levels is folded into per-level damage,
    // and the boss stun chance (20%) into a shorter boss stun.
    actives: (row) => [autocast(row, 'thunderstorm', '🌩', 'Calls down 20 lightning bolts on random creeps within 1200 over 4 seconds: 2500 spell damage each (+170 per level) and a short stun.', 'creep',
      { kind: 'bolts', count: 20, interval: 0.2, flat: 2500, flatPerLevel: 170, range: 1200 / UNIT, stun: 0.5, bossStunMult: 0.2, fx: 'storm' })],
  },

  ancient_energy_converter: {
    // Three orbs zap a random creep every second for 12 seconds, and a quarter of the zaps also
    // fire a stunning chain. The extra orb every 5 levels is folded into per-level damage.
    actives: (row) => [autocast(row, 'conversion', '🔆', 'Releases energy orbs for 12 seconds: 36 zaps on random creeps for 1500 spell damage each (+250 per level), and 9 stunning lightning bursts.', 'creep',
      { kind: 'multi', effects: [
        { kind: 'bolts', count: 36, interval: 1 / 3, flat: 1500, flatPerLevel: 250, fx: 'storm' },
        { kind: 'bolts', count: 9, interval: 12 / 9, flat: 1500, flatPerLevel: 250, radius: 2.5, stun: 0.8, fx: 'storm' }] },
      { range: 650 / UNIT })],
  },

  scales: {
    passives: () => [
      proc('Overcharge', 'hit', { chance: 0.25, chancePerLevel: 0.01, hpAbove: 0.405 }, { kind: 'spellDamage', flat: 900, flatPerLevel: 36, fx: 'storm' }),
      // Overcharge can repeat with falling odds; the repeats average out to this second roll.
      proc('Overcharge Echo', 'hit', { chance: 0.05, chancePerLevel: 0.012, hpAbove: 0.405, silent: true }, { kind: 'spellDamage', flat: 900, flatPerLevel: 36, quiet: true, fx: 'storm' }),
      proc('Electrify', 'hit', { chance: 0.2, chancePerLevel: 0.008 },
        { kind: 'zone', flat: 900, flatPerLevel: 36, radius: 225 / UNIT, dur: 5, fx: 'storm' }),
    ],
    // Ten seconds of forked lightning, three strikes every third of a second.
    actives: (row) => [autocast(row, 'lightmare', '⛈', 'Unleashes a lightning nightmare for 10 seconds: 90 strikes on random creeps within 1500 for 1300 spell damage each (+52 per level).', 'creep',
      { kind: 'bolts', count: 90, interval: 10 / 90, flat: 1300, flatPerLevel: 52, range: 1500 / UNIT, fx: 'storm' })],
  },

  stormy_dog: {
    passives: (row) => {
      const scale = at([6, 9, 12, 15, 18], row);
      return [proc('Thunderous Roar', 'hit', { chance: 0.3 }, { kind: 'multi', effects: [
        { kind: 'towerBuff', key: 'roar', label: 'Thunderous Roar', center: 'self', radius: 420 / UNIT, mods: { attackSpeed: 0.05 }, perLevel: 0.01 * scale, dur: 5, quiet: true, fx: 'storm' },
        { kind: 'towerBuff', key: 'roarstack', label: 'Roar stacks', center: 'self', radius: 420 / UNIT, mods: { attackSpeed: 0.0005 * scale }, dur: 5, maxStacks: 99, quiet: true, fx: 'storm' }] })];
    },
  },

  cloud_warrior: {
    passives: (row) => {
      const [dmg, add] = at([[100, 5], [300, 15], [750, 37.5], [1875, 93.75], [3750, 187.5]], row);
      return [proc('Lightning Strike', 'hit', { chance: 1, silent: true }, { kind: 'attackDamage', flat: dmg, flatPerLevel: add, delay: 0.4, fx: 'storm' })];
    },
  },

  red_ball_lightning: {
    passives: (row) => {
      const [dmg, add, spell, spellAdd] = at([[1200, 48, 0.20, 0.004], [3500, 140, 0.35, 0.006]], row);
      return [
        { type: 'aura', stat: 'spell', value: spell, valuePerLevel: spellAdd, radius: rad(250) },
        proc('Lightning Shock', 'hit', { chance: 0.3, chancePerLevel: 0.005 }, { kind: 'spellDamage', flat: dmg, flatPerLevel: add, fx: 'storm' }),
      ];
    },
  },

  chaining_storm: {
    passives: () => [
      // The wind slow ramps up to 45% over 15 seconds; this aura uses its typical strength.
      { type: 'creepAura', radius: 900 / UNIT, slow: 0.3, slowPerLevel: 0.008 },
      proc('Strong Wind', 'periodic', { icd: 1, needCreeps: true, silent: true },
        { kind: 'spellDamage', mult: 2, perLevel: 0.05, radius: 900 / UNIT, quiet: true, fx: 'storm' }),
      proc('Storm Power', 'death', { chance: 1, silent: true }, { kind: 'mana', self: true, amount: 35 }),
      // Damage grows with the crowd around the target; this assumes about four creeps.
      proc('Chaining Storm', 'attack', { chance: 0.25, chancePerLevel: 0.0125, manaCost: 100 },
        { kind: 'spellDamage', flat: 800, flatPerLevel: 260, radius: 350 / UNIT, fx: 'storm' }),
    ],
  },

  broken_circle_of_wind: {
    passives: (row) => {
      const [chance, add, dur, dmg, dmgAdd] = at([[0.20, 0.003, 0.5, 20, 2], [0.22, 0.004, 0.6, 68, 7], [0.24, 0.005, 0.7, 196, 20],
        [0.26, 0.006, 0.8, 600, 60], [0.28, 0.007, 1.0, 1120, 112]], row);
      return [proc('Wind of Death', 'attack', { chance, chancePerLevel: add, sizes: ['mass', 'normal', 'champion'] }, { kind: 'multi', effects: [
        { kind: 'debuff', stun: dur, quiet: true, fx: 'storm' },
        { kind: 'attackDamage', flat: dmg, flatPerLevel: dmgAdd, radius: 300 / UNIT, delay: dur, fx: 'storm' }] })];
    },
  },

  gnoll_thunder_mage: {
    // Damage is the tier's base plus 30% of it per tower built. A recast hits random creeps:
    // one, two from level 15, three at level 25 (separate rolls with the same expected count).
    passives: (row) => {
      const [base, add] = at([[1450, 58], [2900, 116], [4350, 174]], row);
      const recast = { kind: 'bolts', count: 1, interval: 0, flat: base, flatPerLevel: add, range: 1200 / UNIT, scaleBy: { kind: 'towers', per: 0.3 }, fx: 'storm' };
      return [
        proc('Multicast', 'cast', { chance: 0.25 }, recast),
        proc('Multicast II', 'cast', { chance: 0.25, minLevel: 15, silent: true }, recast),
        proc('Multicast III', 'cast', { chance: 0.25, minLevel: 25, silent: true }, recast),
      ];
    },
    actives: (row) => {
      const [base, add] = at([[1450, 58], [2900, 116], [4350, 174]], row);
      return [autocast(row, 'thundershock', '⚡', `Shocks a creep for ${base} spell damage (+${add} per level), plus 30% more for every tower you have built.`, 'creep',
        { kind: 'spellDamage', flat: base, flatPerLevel: add, scaleBy: { kind: 'towers', per: 0.3 }, fx: 'storm' }, { pick: 'first' })];
    },
  },

  green_lightning: {
    passives: (row) => {
      const [mult, crit] = at([[15, 0.4], [25, 0.6], [35, 0.8], [45, 1.0]], row);
      return [
        proc('Mana Feed', 'attack', { chance: 1, silent: true }, { kind: 'mana', self: true, amount: 4 }),
        proc('Lightning Burst', 'hit', { chance: 0.125, chancePerLevel: 0.005 }, { kind: 'spellDamage', flat: 0, manaMult: mult, fx: 'storm' }),
        // Spell crit builds up with every attack and resets on a burst; this is the build-up a
        // burst finds on average.
        { type: 'aura', stat: 'spellCrit', value: crit, valuePerLevel: -0.01 * crit, radius: 0, selfOnly: true },
      ];
    },
    // The surge ends after 5 attacks (+1 per 5 levels); the duration covers that many attacks.
    actives: (row) => {
      const as = at([1, 1.5, 2, 2.5], row);
      const dur = +(5 * row.cd / (1 + as)).toFixed(2), durAdd = +(0.2 * row.cd / (1 + as)).toFixed(3);
      return [autocast(row, 'surge', '⚡', `Overloads itself: +${Math.round(as * 100)}% attack speed (+2% per level) for about five attacks.`, 'self',
        { kind: 'towerBuff', key: 'surge', label: 'Lightning Surge', mods: { attackSpeed: as }, perLevel: 0.02 / as, dur, durPerLevel: durAdd, fx: 'storm' })];
    },
  },

  storm_battery: {
    // Electrified creeps take extra damage. Upstream's roll looks inverted; this uses the
    // expected bonus of a 20% (+0.3% per level) chance for +40/80/120% (+0.8/1.6/2.4% per level).
    passives: (row) => {
      const [curse, curseAdd] = at([[0.08, 0.0034], [0.16, 0.0068], [0.24, 0.0102]], row);
      return [proc('Electrify', 'hit', { chance: 1, silent: true },
        { kind: 'debuff', curse, cursePerLevel: curseAdd, debuffDur: 9, debuffDurPerLevel: 0.3, quiet: true, fx: 'storm' })];
    },
    // Spends all its mana on missiles, 5 per second at 10 mana each (100 bonus mana included).
    actives: (row) => {
      const [dmg, add, curse, curseAdd] = at([[300, 12, 0.08, 0.0034], [750, 30, 0.16, 0.0068], [1800, 72, 0.24, 0.0102]], row);
      return [autocast(row, 'overload', '🔋', `Empties the battery: 20 energy missiles strike random creeps within 1200 over 4 seconds for ${dmg} spell damage each (+${add} per level) and electrify them.`, 'creep',
        { kind: 'bolts', count: 20, interval: 0.2, flat: dmg, flatPerLevel: add, range: 1200 / UNIT, spendMana: 1,
          curse, cursePerLevel: curseAdd, debuffDur: 9, debuffDurPerLevel: 0.3, fx: 'storm' },
        { range: 800 / UNIT })];
    },
  },

  lightning_generator: {
    passives: (row) => {
      const [chain, hit] = at([[150, 70], [560, 260], [1680, 770], [4000, 1840]], row);
      return [
        proc('Force Attack', 'hit', { chance: 1, silent: true }, { kind: 'spellDamage', flat: hit, flatPerLevel: +(hit * 0.02).toFixed(1), quiet: true, fx: 'storm' }),
        proc('Chain Lightning', 'attack', { chance: 0.195, chancePerLevel: 0.0025 },
          { kind: 'chainSpell', flat: chain, flatPerLevel: +(chain * 0.02).toFixed(1), count: 2, falloff: 0, fx: 'storm' }),
      ];
    },
  },

  tiny_storm_lantern: {
    // One more shot at level 15 and another at 25 (separate rolls with the same expected count).
    passives: (row) => {
      const shot = (count) => ({ kind: 'bolts', attack: true, count, interval: 0.2, delay: 0.2, mult: 1, fx: 'storm' });
      return [
        proc('Burst Lightning', 'attack', { chance: 0.2, chancePerLevel: 0.01 }, shot(at([2, 3, 4, 5], row))),
        proc('Burst Lightning II', 'attack', { chance: 0.2, chancePerLevel: 0.01, minLevel: 15, silent: true }, shot(1)),
        proc('Burst Lightning III', 'attack', { chance: 0.2, chancePerLevel: 0.01, minLevel: 25, silent: true }, shot(1)),
      ];
    },
  },

  the_conduit: {
    passives: () => [proc('Absorb Energy', 'hit', { chance: 0.1, chancePerLevel: 0.002 }, { kind: 'mana', self: true, amount: 50, amountPerLevel: 1 })],
    actives: (row) => [autocast(row, 'unleash', '⚡', 'Unleashes stored energy as lightning: 400 spell damage (+8 per level) for every wave so far. Towers next to the conduit gain +75% spell crit damage for 3 seconds.', 'creep',
      { kind: 'multi', effects: [
        { kind: 'spellDamage', flat: 400, flatPerLevel: 8, scaleBy: { kind: 'wave', per: 1 }, fx: 'storm' },
        { kind: 'towerBuff', key: 'unleash', label: 'Unleash', center: 'self', radius: 350 / UNIT, mods: { spellCritMult: 0.75 }, perLevel: 0.04, dur: 3, quiet: true, fx: 'storm' }] },
      { pick: 'strong' })],
  },

  prince_of_lightning: {
    passives: (row) => {
      const [chance, dmg, add, vuln, vulnAdd] = at([[0.15, 2000, 100, 0.10, 0.002], [0.20, 4000, 200, 0.15, 0.004]], row);
      return [
        proc('Lightning Strike', 'hit', { chance, chancePerLevel: 0.004 }, { kind: 'spellDamage', flat: dmg, flatPerLevel: add, fx: 'storm' }),
        // A pulse rather than a creep aura, so the bonus can grow with level.
        proc('Realm of Thunder', 'periodic', { icd: 1, needCreeps: true, silent: true },
          { kind: 'debuff', radius: 1300 / UNIT, stackVuln: { pct: vuln, pctPerLevel: vulnAdd, max: 1, element: 'storm', key: 'realm' }, debuffDur: 1.5, quiet: true, fx: 'storm' }),
      ];
    },
  },

  arcane_storm: {
    passives: () => [
      // Each hit spends all mana: two extra attacks on random creeps deal +1% damage per mana
      // spent, and multicrit rises for 2 seconds. Creeps hit build attraction stacks that refill
      // mana; this assumes about 8 mana back per hit.
      proc('Mana Storm', 'hit', { chance: 1, silent: true }, { kind: 'multi', effects: [
        { kind: 'bolts', attack: true, count: 2, interval: 0, mult: 1, scaleBy: { kind: 'mana', per: 0.01 }, spendMana: 1, fx: 'arcane' },
        { kind: 'towerBuff', key: 'manastorm', label: 'Mana Storm', mods: { multicrit: 3 }, dur: 2, quiet: true, fx: 'arcane' },
        { kind: 'mana', self: true, amount: 8 }] }),
      proc('Surge', 'hit', { chance: 0.05, chancePerLevel: 0.001 }, { kind: 'chainSpell', mult: 2, perLevel: 0.02, count: 3, falloff: 0, fx: 'arcane' }),
      // A dying creep passes its stacks to creeps nearby, which take damage per stack received.
      proc('Arcane Attraction', 'death', { chance: 1 }, { kind: 'attackDamage', mult: 0.4, perLevel: 0.02, radius: 500 / UNIT, fx: 'arcane' }),
    ],
  },

  storm_coil: {
    passives: () => [
      // Bonus damage and slow grow with distance to the target; values assume about 500 range.
      proc('Overload', 'hit', { chance: 1, silent: true }, { kind: 'attackDamage', mult: 1.8, slow: 0.15, slowDur: 1.5, fx: 'storm' }),
      // Storm damage taken grows with distance from the coil; this uses about 500 range. A pulse
      // rather than a creep aura, so the bonus can grow with level.
      proc('Energetic Field', 'periodic', { icd: 1, needCreeps: true, silent: true },
        { kind: 'debuff', radius: 1000 / UNIT, stackVuln: { pct: 0.1, pctPerLevel: 0.003, max: 1, element: 'storm', key: 'energeticfield' }, debuffDur: 1.5, quiet: true, fx: 'storm' }),
    ],
    // The shock grows with the distance the creep travels; this assumes a typical walking speed.
    actives: (row) => [autocast(row, 'magneticsurge', '🧲', 'Magnetizes a creep: it is shocked as it moves for the next 4 seconds, about 16000 spell damage in total (+2% per level).', 'creep',
      { kind: 'debuff', dot: { dps: 4000, dpsPerLevel: 80, dur: 4, key: 'magneticsurge' }, fx: 'storm' }, { pick: 'first' })],
  },

  ruined_wind_tower: {
    // Upstream throws held items of other rarities back to the stash on every attack; the
    // engine lock rejects them on equip and returns them on upgrade, which ends the same way.
    passives: (row) => [{ type: 'itemRarityLock', rarity: at(['common', 'uncommon', 'rare', 'unique'], row) }],
  },

  cloudy_temple_of_absorption: {
    passives: () => {
      // Overkill on creeps dying nearby becomes mana: x1 plus 5% per level, in steps of 0.5 at
      // levels 5, 15, 25... (within 0.25 of the exact multiplier). The steps share one cooldown
      // key, listed highest first, so only the highest unlocked step pays out per death.
      // Upstream ignores creeps hit by its own storm, otherwise the storm would feed itself.
      // Own kills stand in for that: they set the shared key for the rest of the frame, so the
      // death that follows pays nothing.
      const absorb = { key: 'absorb', icd: 0.001, chance: 1, silent: true };
      const steps = [55, 45, 35, 25, 15, 5, 0].map((lvl) => proc(lvl ? `Cloud of Absorption (level ${lvl})` : 'Cloud of Absorption', 'death',
        { ...absorb, minLevel: lvl || undefined }, { kind: 'mana', self: true, amount: 0, fromOverkill: 1 + 0.5 * Math.ceil(lvl / 10) }));
      return [
        proc('Own kills absorb nothing', 'kill', absorb, { kind: 'multi', effects: [] }),
        ...steps,
        // Every 0.4s above 1000 mana, a bolt deals mana x (0.5 + 0.02 per level) to a random creep.
        // Upstream drains mana by how much of the creep's health the bolt removed; this spends
        // a fixed 30% of the current mana per bolt instead.
        proc('Cloudy Thunderstorm', 'periodic', { icd: 0.4, manaAbove: 1000, needCreeps: true, silent: true },
          { kind: 'bolts', count: 1, interval: 0, flat: 0.5, flatPerLevel: 0.02, scaleBy: { kind: 'mana', per: 1 }, spendMana: 0.3,
            range: 1000 / UNIT, fx: 'storm' }),
      ];
    },
  },

  dimensional_flux_collector: {
    // The collector never attacks. Once linked for 10 seconds, it fires every second at a random
    // creep within 800, dealing energy attack damage equal to 25% (+1% per level) of the spell
    // damage the linked tower dealt in the meantime. The level share comes in steps at levels
    // 5, 15, 25...; the procs share one cooldown, so only the highest unlocked step fires.
    passives: () => {
      const steps = [55, 45, 35, 25, 15, 5, 0];
      return [
        { type: 'attackOverride', attack: 'energy' },
        ...steps.map((lvl) => {
          const pct = +(0.25 + 0.01 * (lvl ? lvl + 5 : 0)).toFixed(2);
          return proc(lvl ? `Dimensional Flux (level ${lvl})` : 'Dimensional Flux', 'periodic', { key: 'flux', icd: 1, needCreeps: true, silent: true, minLevel: lvl || undefined },
            { kind: 'bolts', attack: true, count: 1, interval: 0, flat: 0, fromLinked: pct, linkAfter: 10, range: 800 / UNIT, fx: 'storm' });
        }),
      ];
    },
    // A player-chosen link upstream. Re-casting resets the link, so it is not cast automatically.
    actives: (row) => [autocast(row, 'dimlink', '🔗', 'Links the strongest allied tower nearby to the collector. The collector banks the spell damage that tower deals and releases it as flux. Cast it once; re-casting restarts the link.', 'tower',
      { kind: 'link', fx: 'storm' }, { anytime: true })],
  },

  lightning_totem: {
    passives: (row) => [{ type: 'aura', stat: 'spellCrit', value: at([0.10, 0.15, 0.20], row), valuePerLevel: 0.002, radius: rad(500), self: false }],
  },
};
