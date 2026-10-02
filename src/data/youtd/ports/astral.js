// Ported astral tower behaviors, keyed by YouTD 2 script name (MIT, see third_party/youtd2).
// Mechanics are re-implemented with this game's ability engine; descriptions are our own.

// eslint-disable-next-line no-unused-vars
import { UNIT, at, proc, autocast } from './helpers.js';

// Aura radius from the tower's own aura row, in world units.
const auraRadius = (row, fallback) => (row.auras[0]?.range ?? fallback) / UNIT;

// Typical creep move speed in Warcraft III units (BASE_SPEED 2.6 * 94).
const CREEP_SPEED = 245;
// Creep move speed in world units per second (game.js BASE_SPEED).
const BASE_SPEED = 2.6;

// Magic Battery's Faerie Fire debuff fields per tier.
const faerie = (row) => {
  const [vulnSpell, vulnSpellPerLevel] = at([[0.1, 0.004], [0.15, 0.006], [0.2, 0.008]], row);
  return { vulnSpell, vulnSpellPerLevel, debuffDur: 9, debuffDurPerLevel: 0.3 };
};

export const PORTS = {
  star_gazer: {
    passives: (row) => {
      const bonus = at([0.01, 0.02, 0.03, 0.04], row);
      return [proc('Starlight', 'hit', { chance: 1, silent: true }, { kind: 'spellDamage', mult: 1, perLevel: bonus, fx: 'holy', quiet: true })];
    },
  },

  // Unstable Energies converts the drake's stored mana into a heavy hit and spends most of it.
  'mana-touched_drake': {
    passives: (row) => [proc('Unstable Energies', 'hit', { chance: 0.28, chancePerLevel: 0.0048 },
      { kind: 'attackDamage', flat: 0, manaMult: at([8, 9.5, 11, 12.5], row), spendMana: 0.75, fx: 'arcane' })],
  },

  // Lunar Grace: a cheap single-target nuke (stronger from level 15). Each cast may add a
  // second strike that also stuns and softens the creep.
  lunar_sentinel: {
    passives: (row) => {
      const [dmg, add, dmg15] = at([[50, 2, 70], [500, 20, 700], [1500, 60, 2100], [2500, 100, 3500]], row);
      const vuln = at([0.12, 0.16, 0.2, 0.24], row);
      return [
        proc('Lunar Grace', 'cast', { key: 'lunarGrace15', chance: 1, minLevel: 15, silent: true },
          { kind: 'spellDamage', flat: dmg15 - dmg, quiet: true }),
        proc('Lunar Grace Bonus', 'cast', { chance: 0.125, chancePerLevel: 0.005 },
          { kind: 'spellDamage', flat: dmg, flatPerLevel: add, stun: 0.3, vulnSpell: vuln, debuffDur: 2.5, fx: 'holy' }),
      ];
    },
    actives: (row) => {
      const [dmg, add] = at([[50, 2], [500, 20], [1500, 60], [2500, 100]], row);
      return [autocast(row, 'lunargrace', '🌙', `Strikes a creep with moonlight for ${dmg} spell damage (+${add} per level).`, 'creep',
        { kind: 'spellDamage', flat: dmg, flatPerLevel: add, fx: 'holy' }, { pick: 'first' })];
    },
  },

  // Illuminate makes the creeps the ruin hits worth more experience for 5 seconds. The ruin
  // hits whatever is in its range, so creeps inside that range grant the bonus when they die.
  // (The engine's creep aura has no per-level growth; the base value is used.)
  minor_magic_ruin: {
    passives: (row) => [{ type: 'creepAura', xpBonus: at([0.05, 0.1, 0.15, 0.2, 0.25, 0.3], row), xpBonusPerLevel: at([0.002, 0.004, 0.006, 0.008, 0.01, 0.012], row), radius: row.range / UNIT }],
  },

  time_manipulator: {
    passives: (row) => {
      const r = auraRadius(row, 240);
      return [
        { type: 'aura', stat: 'xp', value: 0.1, valuePerLevel: 0.016, radius: r },
        { type: 'aura', stat: 'attackSpeed', value: 0.1, valuePerLevel: 0.01, radius: r },
        { type: 'aura', stat: 'manaRegen', value: 0.05, valuePerLevel: 0.02, radius: r },
        { type: 'aura', stat: 'buffDur', value: 0.125, valuePerLevel: 0.015, radius: r },
        proc('Future Knowledge', 'periodic', { icd: 10, silent: true }, { kind: 'xp', amount: 2 }),
      ];
    },
    actives: (row) => [autocast(row, 'timefield', '⏳', 'Warps time around the tower for 10 seconds: every creep nearby takes 1500 spell damage (+75 per level) each second.', 'self',
      { kind: 'zone', flat: 1500, flatPerLevel: 75, radius: 950 / UNIT, dur: 10, fx: 'arcane' })],
  },

  // Time Travel: 3 seconds after a hit, the creep jumps back to where it stood when hit,
  // i.e. it loses the ground it walked in those 3 seconds (base speed of its size).
  // Bosses only rewind sometimes.
  timevault: {
    passives: (row) => {
      const rewind = (sizeSpeed) => ({ kind: 'debuff', delay: 3, pushBack: +(BASE_SPEED * sizeSpeed * 3).toFixed(2), fx: 'arcane', quiet: true });
      return [
        proc('Time Travel', 'hit', { chance: 1, cond: 'belowChampion', silent: true }, rewind(1)),
        proc('Time Travel', 'hit', { key: 'timetravelChampion', chance: 1, cond: 'champion', silent: true }, rewind(0.9)),
        proc('Time Travel', 'hit', { key: 'timetravelBoss', chance: 0.2, chancePerLevel: 0.005, cond: 'boss' }, rewind(0.75)),
        { type: 'aura', stat: 'trigger', value: 0.3, valuePerLevel: 0.006, radius: auraRadius(row, 600) },
      ];
    },
  },

  // Spacial Rift (30 mana) pushes the creep back along its path, or 15% of the time every creep
  // around it, and slows the area. Bosses trigger it half as often. The rift's presence
  // burns creeps based on how fast they move.
  astral_rift: {
    passives: (row) => {
      const rift = (key, chance, cond, aoe) => proc('Spacial Rift', 'hit', { key, chance, chancePerLevel: chance * 0.04, cond, manaCost: 30 },
        { kind: 'multi', effects: [
          { kind: 'debuff', ...(aoe ? { radius: 175 / UNIT } : {}), pushBack: +(175 / UNIT).toFixed(2), quiet: true },
          { kind: 'debuff', radius: 250 / UNIT, slow: 0.3, slowPerLevel: 0.01, slowDur: 2, fx: 'arcane' }] });
      return [
        rift('riftSingle', 0.1 * 0.85, 'notBoss', false),
        rift('riftArea', 0.1 * 0.15, 'notBoss', true),
        rift('riftBossSingle', 0.05 * 0.85, 'boss', false),
        rift('riftBossArea', 0.05 * 0.15, 'boss', true),
        proc('Presence of the Rift', 'periodic', { icd: 1, needCreeps: true, silent: true },
          { kind: 'spellDamage', flat: CREEP_SPEED * 2, flatPerLevel: Math.round(CREEP_SPEED * 0.16), radius: auraRadius(row, 750), quiet: true }),
      ];
    },
  },

  // Elemental Chaos: every attack casts one random spell. Separate procs with the original odds
  // give the same average output (they roll independently instead of exclusively).
  // The top tier grows a spell by 50% (+1% per level) each time it repeats in a row; its
  // numbers fold in the expected repeat bonus (x1.21 at 30% odds, x1.13 at 20% odds).
  initiate_elementalist: {
    passives: (row) => {
      const tier = Math.min(4, row.tier);
      const blast = (chance, r, dmg, add) => proc('Fire Blast', 'attack', { chance }, { kind: 'spellDamage', flat: dmg, flatPerLevel: add, radius: r / UNIT, fx: 'fire' });
      const frost = (chance, r, dmg, add, slow, dur) => proc('Frost Nova', 'attack', { chance },
        { kind: 'spellDamage', flat: dmg, flatPerLevel: add, radius: r / UNIT, slow, slowDur: dur, fx: 'frost' });
      const stone = (chance, dmg, add, stun, stunAdd) => proc('Aftershock', 'attack', { chance },
        { kind: 'spellDamage', flat: dmg, flatPerLevel: add, stun, stunPerLevel: stunAdd, fx: 'nature' });
      const storm = (chance, n, dmg, add) => proc('Lightning Burst', 'attack', { chance },
        { kind: 'chainSpell', flat: dmg, flatPerLevel: add, count: n - 1, falloff: 0, jump: 900 / UNIT, fx: 'storm' });
      if (tier === 1) return [blast(2 / 3, 200, 190, 7.6), frost(1 / 3, 250, 125, 5, 0.1, 3)];
      if (tier === 2) return [blast(0.4, 250, 500, 10), stone(0.4, 750, 0, 0.5, 0.01), frost(0.2, 250, 250, 8, 0.12, 3)];
      if (tier === 3) return [blast(0.3, 250, 1650, 18), stone(0.3, 2000, 0, 0.5, 0.01), frost(0.2, 250, 800, 10, 0.14, 4), storm(0.2, 5, 1650, 30)];
      // Expected repeat bonus: 1 + (0.5 + 0.01 * level) * p / (1 - p), linearised per level.
      return [blast(0.3, 300, 3640, 86), stone(0.3, 7290, 26, 0.7, 0.02), frost(0.2, 300, 2250, 95, 0.15, 4), storm(0.2, 6, 3375, 75)];
    },
  },

  // Sunshine: creeps near the emitter lose armor and take more damage from astral,
  // nature, fire and iron towers.
  solar_emitter: {
    passives: (row) => {
      const r = auraRadius(row, 800);
      const [armor, armorPerLevel, vuln] = at([[10, 0.3, 0.1], [15, 0.5, 0.15]], row);
      return [
        { type: 'creepAura', armor, armorPerLevel, radius: r },
        ...['astral', 'nature', 'fire', 'iron'].map((el) => ({ type: 'creepAura', vulnElement: { el, pct: vuln }, radius: r })),
      ];
    },
  },

  // Power of Light: undead hit by the tower take more damage from everything for a while.
  // True sight comes from REVEAL_SCRIPTS in towers.js.
  small_light: {
    passives: (row) => {
      const [vuln, vulnAdd, dur, durAdd] = at([[0.05, 0.002, 3, 0.12], [0.1, 0.004, 3, 0.16], [0.15, 0.006, 4, 0.16], [0.2, 0.008, 4, 0.2], [0.3, 0.01, 5, 0.2]], row);
      return [proc('Power of Light', 'hit', { chance: 1, silent: true, races: ['undead'] },
        { kind: 'debuff', curse: vuln, cursePerLevel: vulnAdd, debuffDur: dur, debuffDurPerLevel: durAdd, fx: 'holy', quiet: true })];
    },
  },

  warrior_of_light: {
    passives: (row) => {
      const [chance, chanceAdd, dmg, add, undead, undeadAdd] = at([[0.2, 0.005, 1000, 50, 0.15, 0.006], [0.23, 0.007, 2000, 100, 0.2, 0.008], [0.25, 0.01, 3000, 150, 0.25, 0.01]], row);
      return [
        // The shockwave travels through the target; a blast around it covers the same creeps.
        proc('Ain Soph Aur', 'attack', { chance, chancePerLevel: chanceAdd }, { kind: 'spellDamage', flat: dmg, flatPerLevel: add, radius: 200 / UNIT, fx: 'holy' }),
        { type: 'aura', stat: 'vsUndead', value: undead, valuePerLevel: undeadAdd, radius: auraRadius(row, 300) },
      ];
    },
  },

  small_serpent_ward: {
    actives: (row) => {
      const k = at([0.1, 0.2, 0.3, 0.4], row);
      return [autocast(row, 'snakecharm', '🐍', `Charms a tower next to the ward: +${Math.round(k * 100)}% max mana, +${Math.round(k * 100)}% mana regeneration and +${Math.round(k * 50)}% spell damage for 5 seconds (stronger with level).`, 'tower',
        { kind: 'towerBuff', key: 'snakecharm', label: 'Snake Charm', mods: { manaPct: k, manaRegen: k, spell: k / 2 }, perLevel: 0.06, dur: 5, fx: 'arcane' },
        { anytime: true, allowSelf: true })];
    },
  },

  // Silence has no meaning here (creeps cast nothing), so the silence windows become windows
  // where astral towers deal extra damage. Every attack with 40 mana to spare also throws a
  // glaive: an extra full attack on a random creep.
  nortrom_the_silencer: {
    passives: () => [
      proc('Glaives of Wisdom', 'attack', { chance: 1, manaCost: 40, silent: true }, { kind: 'barrage', count: 1, mult: 1, fx: 'arcane' }),
      proc('Curse of the Silent', 'periodic', { icd: 7, needCreeps: true },
        { kind: 'debuff', radius: 800 / UNIT, debuffDur: 2, debuffDurPerLevel: 0.04, fx: 'arcane',
          stackVuln: { key: 'silence', pct: 0.2, pctPerLevel: 0.032, max: 1, element: 'astral' } }),
    ],
  },

  witch_doctor: {
    // A ward lives 6 seconds and shoots a random creep within 800 once per attack interval
    // for 20% (+0.2% per level) of the doctor's attack damage.
    passives: (row) => [proc('Serpent Ward', 'attack', { chance: 0.18, chancePerLevel: 0.0028 },
      { kind: 'bolts', attack: true, count: Math.max(1, Math.round(6 / row.cd)), interval: row.cd, mult: 0.2, perLevel: 0.01, range: 800 / UNIT, fx: 'nature' })],
    // Maledict stores damage taken and releases 15% (+3.5% per stack) of it after 8 seconds;
    // a curse of the same share for the same time gives that damage up front.
    actives: (row) => [autocast(row, 'maledict', '🪬', 'Curses every creep around the doctor for 8 seconds: they take 18% more damage from all sources.', 'self',
      { kind: 'debuff', radius: 800 / UNIT, curse: 0.185, debuffDur: 8, fx: 'shadow' })],
  },

  // The original only affects invisible creeps, and YouTD 2 left that code disabled.
  astral_lantern: {},

  // The missile passes through creeps around the target, hitting all of them in full, and
  // grows by 2% per level. Upstream the missile deals spell damage; the engine has no spell
  // attack type, so it stays an attack. Choosing missile modifications is not ported.
  sorceress: {
    passives: () => [
      { type: 'splash', rings: [{ radius: 150 / UNIT, pct: 1 }], radius: 150 / UNIT, pct: 1, desc: 'Magic Missile: each attack also hits every creep near the target in full.' },
      { type: 'aura', key: 'magicMissile', stat: 'damage', value: 0, valuePerLevel: 0.02, radius: 0, selfOnly: true },
    ],
  },

  owl_of_wisdom: {
    // Ball damage grows with the owl's experience up to +150 per wave; the port uses that cap.
    passives: (row) => {
      const [base, period] = at([[4500, 5], [6500, 4]], row);
      const scaleBy = { kind: 'wave', per: 150 / base };
      return [
        proc('Energyball', 'attack', { chance: 0.25, chancePerLevel: 0.004 }, { kind: 'spellDamage', flat: base, scaleBy, radius: 100 / UNIT, fx: 'arcane' }),
        // Every creep in range has a 10% (+0.2% per level) chance to draw a ball: the expected damage per creep.
        proc('Energy Detection', 'periodic', { icd: period, needCreeps: true, silent: true },
          { kind: 'spellDamage', flat: base * 0.1, flatPerLevel: base * 0.002, scaleBy, radius: 900 / UNIT, quiet: true }),
      ];
    },
  },

  // Sunlight Burst stuns every creep around the tower. (The original also stuns nearby towers.)
  holy_energy: {
    actives: (row) => [autocast(row, 'sunlightburst', '☀', 'Releases a burst of sunlight that stuns every creep around the tower for 1.5 seconds (+0.02s per level).', 'self',
      { kind: 'debuff', radius: 1000 / UNIT, stun: 1.5, stunPerLevel: 0.02, fx: 'holy' })],
  },

  // Faerie Fire: +spell damage taken for 9s (+0.3s per level), both growing with level.
  magic_battery: {
    passives: (row) => [proc('Faerie Fire', 'hit', { chance: 1, silent: true }, { kind: 'debuff', ...faerie(row), fx: 'arcane', quiet: true })],
    actives: (row) => {
      const [dmg, add] = at([[300, 12], [750, 30], [1800, 72]], row);
      // The original spends 10 mana per missile until empty, firing every 0.2s at random creeps
      // within 1200; the cast's mana buys 10 missiles.
      return [autocast(row, 'overload', '🔋', `Discharges the battery: 10 missiles at random creeps over 2 seconds, each dealing ${dmg} spell damage (+${add} per level) and applying Faerie Fire.`, 'creep',
        { kind: 'bolts', count: 10, interval: 0.2, range: 1200 / UNIT, flat: dmg, flatPerLevel: add, ...faerie(row), fx: 'arcane' })];
    },
  },

  glowing_solar_orb: {
    passives: (row) => {
      const armor = at([2, 3, 5, 7, 10], row);
      const e = { kind: 'debuff', armor, debuffDur: 5, debuffDurPerLevel: 0.25, fx: 'holy' };
      // Bosses are twice as likely to be hit by it.
      return [
        proc('Afterglow', 'hit', { chance: 0.05, chancePerLevel: 0.006, cond: 'notBoss' }, e),
        proc('Afterglow', 'hit', { key: 'afterglowBoss', chance: 0.1, chancePerLevel: 0.012, cond: 'boss' }, e),
      ];
    },
  },

  // Drakes fly out roughly every 1.5 seconds while fed; each drake is gated by its own flight time.
  drake_whisperer: {
    passives: () => [
      proc('Unleash', 'attack', { chance: 0.125, chancePerLevel: 0.003 },
        { kind: 'chainSpell', flat: 1250, flatPerLevel: 40, count: 4, falloff: 0, jump: 600 / UNIT, fx: 'arcane' }),
      proc('Blue Drake', 'attack', { chance: 1, icd: 4.5 },
        { kind: 'spellDamage', flat: 6000, flatPerLevel: 150, radius: 125 / UNIT, slow: 0.25, slowDur: 3, fx: 'frost' }),
      proc('Green Drake', 'attack', { chance: 1, icd: 4.5 }, { kind: 'multi', effects: [
        { kind: 'spellDamage', flat: 5000, fx: 'nature' },
        { kind: 'towerBuff', key: 'versatile', label: 'Versatile', radius: 175 / UNIT, mods: { damage: 0.05 }, perLevel: 0.27, dur: 2.5, quiet: true }] }),
      proc('Red Drake', 'attack', { chance: 1, icd: 4.5 }, { kind: 'attackDamage', mult: 2, perLevel: 0.04, stun: 3, fx: 'fire' }),
    ],
  },

  teacher: {
    passives: (row) => [proc('Knowledge', 'attack', { chance: 0.1, chancePerLevel: 0.006 },
      { kind: 'shareXp', radius: 600 / UNIT, amount: at([1, 1.3, 1.5, 1.8, 2, 2.2], row), count: 1 })],
  },

  library_of_alexandria: {
    passives: (row) => [
      // Divine Research: creeps near the library grant 30% more experience when they die.
      { type: 'creepAura', xpBonus: 0.3, radius: auraRadius(row, 900) },
      proc('Divine Knowledge', 'periodic', { icd: 5, silent: true }, { kind: 'shareXp', radius: 500 / UNIT, amount: 2, count: 1 }),
    ],
    actives: (row) => [autocast(row, 'teachings', '📖', 'Teaches a nearby tower: it gains double experience for 10 seconds (longer with level). The library learns a little too.', 'tower',
      { kind: 'multi', effects: [
        { kind: 'towerBuff', key: 'teachings', label: 'Divine Teachings', mods: { xp: 1 }, perLevel: 0.02, dur: 10, durPerLevel: 0.2, fx: 'holy' },
        { kind: 'xp', amount: 2 }] }, { anytime: true })],
  },

  // Extract Experience: towers damaging the marked creep sometimes learn from it.
  // Channel Energy: each spell another tower casts on the princess adds a damage stack
  // (up to 15). Stacks share one timer here instead of expiring one by one, and the
  // caster's +1 experience is not ported.
  princess_of_light: {
    passives: (row) => {
      const [k, dur] = at([[0.15, 10], [0.2, 12]], row);
      return [proc('Channel Energy', 'buffed', { chance: 1, silent: true },
        { kind: 'towerBuff', key: 'channelEnergy', label: 'Channel Energy', mods: { damage: k }, perLevel: 0.005 / k, dur, durPerLevel: 0.1, maxStacks: 15, fx: 'holy', quiet: true })];
    },
    actives: (row) => [autocast(row, 'extract', '✨', 'Marks a creep for 10 seconds; towers hitting it have a 33% chance to gain experience (up to 10 times).', 'creep',
      { kind: 'debuff', mark: { bounty: 0, xpChance: 0.33 }, debuffDur: 10, fx: 'holy' })],
  },

  // Grace heals hit creeps for part of the damage dealt; the same net loss as missing that share.
  healing_obelisk: {
    passives: (row) => {
      const [ratio, add] = at([[0.5, 0.004], [0.55, 0.0052], [0.6, 0.0068], [0.65, 0.008]], row);
      return [{ type: 'miss', base: ratio, perLevel: -add, desc: `Grace: creeps heal back ${Math.round(ratio * 100)}% of the damage taken (less with level).` }];
    },
  },

  // At level 25 every smite also strips armor for good (less from bosses). The armor loss
  // rolls separately with the same 55% odds as the smite.
  lesser_priest: {
    passives: (row) => {
      const [dmg, add] = at([[10, 18], [35, 63], [90, 162], [190, 342], [380, 648]], row);
      const [armor, armorBoss] = at([[0.6, 0.2], [0.9, 0.3], [1.2, 0.4], [1.5, 0.5], [1.8, 0.6]], row);
      const shred = (key, cond, amount) => proc('Holy Erosion', 'hit', { key, chance: 0.05, chancePerLevel: 0.02, minLevel: 25, cond, silent: true },
        { kind: 'debuff', armorStack: { key: 'smite', armor: amount, max: 999 }, debuffDur: Infinity, quiet: true });
      return [
        proc('Smite', 'hit', { chance: 0.05, chancePerLevel: 0.02 }, { kind: 'spellDamage', flat: dmg, flatPerLevel: add, fx: 'holy' }),
        shred('smiteArmor', 'notBoss', armor),
        shred('smiteArmorBoss', 'boss', armorBoss),
      ];
    },
  },

  basic_knowledge: {
    passives: (row) => [proc('High Knowledge', 'attack', { chance: 1, silent: true }, { kind: 'xp', amount: at([0.4, 0.55, 0.7, 0.85, 1], row) })],
  },

  // Planeshift: attacks become a bouncing projectile that loses 5% of its damage per bounce until
  // spent (about 10.5 hits in total); a 20-bounce chain with 7.5% falloff deals the same total.
  planar_gate: {
    passives: () => [{ type: 'chain', count: 20, falloff: 0.075, range: 500 / UNIT }],
    // During the eruption every bounce also leaves a small permanent astral weakness on the creep;
    // each cast gives the creeps around the gate one 3% stack (an estimate of those bounces).
    actives: (row) => [autocast(row, 'eruption', '🌀', 'Astral Eruption: doubles the gate\'s damage for 6 seconds and leaves creeps around it permanently more vulnerable to astral towers (stacks).', 'self',
      { kind: 'multi', effects: [
        { kind: 'towerBuff', key: 'eruption', label: 'Astral Eruption', mods: { damage: 1 }, dur: 6, durPerLevel: 0.18, fx: 'arcane' },
        { kind: 'debuff', radius: row.range / UNIT, fx: 'arcane',
          stackVuln: { key: 'planarShift', pct: 0.03, max: 50, element: 'astral', permanent: true } }] })],
  },

  sun_crusader: {
    passives: (row) => {
      const dmg = at([500, 1000], row);
      return [proc('Blessed Weapon', 'hit', { chance: 0.15 }, { kind: 'multi', effects: [
        { kind: 'spellDamage', flat: dmg, flatPerLevel: 50, fx: 'holy' },
        { kind: 'mana', self: true, amount: 2, amountPerLevel: 0.1 }] })];
    },
    actives: (row) => {
      const k = at([0.4, 0.8], row);
      return [autocast(row, 'forthegod', '⚔', `Blesses a tower: +${Math.round(k * 100)}% damage and experience gained for 8 seconds (stronger with level).`, 'tower',
        { kind: 'towerBuff', key: 'forthegod', label: 'For the God', mods: { damage: k, xp: k }, perLevel: 0.025, dur: 8, durPerLevel: 0.1, fx: 'holy' })];
    },
  },
};
