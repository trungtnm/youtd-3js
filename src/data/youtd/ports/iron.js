// Ported iron tower behaviors, keyed by YouTD 2 script name (MIT, see third_party/youtd2).
// Mechanics are re-implemented with this game's ability engine; descriptions are our own.
// Approximations (no exact engine primitive) are noted inline.

// eslint-disable-next-line no-unused-vars
import { UNIT, at, proc, autocast } from './helpers.js';

// Gold-scaled tower buffs (buff mods cannot scale at runtime) assume a typical bank of this many gold.
const TYPICAL_GOLD = 1000;

// Rundown sentry: damage gained per intruder, by creep size (bigger intruders count more).
const AWARENESS_SIZE_MULT = { mass: 1, challengeMass: 2, normal: 3, air: 4, champion: 5, boss: 6, challenge: 8 };

export const PORTS = {
  obelisk_of_fortuity: {
    passives: (row) => {
      const base = at([0.3, 0.4, 0.5, 0.6, 0.7], row);
      return [{ type: 'miss', base, perLevel: -0.006, desc: `Warming up: misses ${Math.round(base * 100)}% of attacks, 0.6% less per level.` }];
    },
  },

  // Creeps entering range: chance to strip armor, the sentry heats up per intruder (more for
  // bigger creeps), and big intruders (air, champion, boss) put towers around the sentry on alert.
  rundown_iron_sentry: {
    passives: (row) => {
      const [chance, armor, armorAdd, alertDur, awareDur] = at([[0.4, 3, 0.1, 5, 5], [0.5, 4, 0.15, 10, 8], [0.6, 5, 0.2, 15, 12]], row);
      // The original armor loss stacks up to 5x and never expires; here it is one long-lasting stack.
      const list = [proc('Trespasser Awareness', 'enter', { chance, silent: true },
        { kind: 'debuff', armor, armorPerLevel: armorAdd, debuffDur: 999, fx: 'iron', quiet: true })];
      for (const [size, k] of Object.entries(AWARENESS_SIZE_MULT)) {
        list.push(proc('Awareness', 'enter', { chance: 1, sizes: [size], silent: true },
          { kind: 'towerBuff', key: `awareness-${size}`, label: 'Awareness', mods: { damage: 0.05 * k }, perLevel: 0.02, dur: awareDur, maxStacks: 20, quiet: true, fx: 'iron' }));
      }
      list.push(proc('Alert', 'enter', { chance: 1, sizes: ['air', 'champion', 'boss', 'challenge'] },
        { kind: 'towerBuff', key: 'alert', label: 'Alert', center: 'self', radius: 500 / UNIT, mods: { damage: 0.075 }, perLevel: 0.005 / 0.075, dur: alertDur, fx: 'iron' }));
      return list;
    },
  },

  'grab-o-bot': {
    passives: () => [
      proc('Grapple', 'attack', { chance: 0.08, chancePerLevel: 0.0032, cond: 'belowChampion' }, { kind: 'debuff', stun: 2.5, fx: 'iron' }),
      proc('Grapple', 'attack', { chance: 0.08, chancePerLevel: 0.0032, cond: 'bossOrChampion' }, { kind: 'debuff', stun: 0.9, fx: 'iron' }),
    ],
    actives: (row) => [autocast(row, 'shock', '⚡', 'Shocks a creep and everything around it for 1250 spell damage (+185 per level), stunning them for 2s.', 'creep',
      { kind: 'spellDamage', flat: 1250, flatPerLevel: 185, radius: 250 / UNIT, stun: 2, fx: 'storm' }, { pick: 'first' })],
  },

  silver_knight: {
    passives: (row) => {
      const [chance, gold, greed] = at([[0.035, 6, 16], [0.05, 18, 44]], row);
      return [
        proc('Transmute', 'hit', { chance, chancePerLevel: 0.0004, cond: 'belowChampion' },
          { kind: 'multi', effects: [{ kind: 'killInstant', fx: 'gold' }, { kind: 'gold', amount: gold, fx: 'gold' }] }),
        // Damage grows with the square root of banked gold (greed x (1 + sqrt(gold))).
        // A transmuted creep is already dead, so it takes no greed damage, like the original.
        proc('Gold Greed', 'hit', { chance: 1, silent: true },
          { kind: 'spellDamage', flat: greed, scaleBy: { kind: 'gold', per: 1 }, fx: 'gold', quiet: true }),
      ];
    },
  },

  bronze_dragon_roost: {
    passives: () => [proc('Bronzefication', 'hit', { chance: 0.1, chancePerLevel: 0.004 }, { kind: 'debuff', slow: 0.5, slowDur: 5, fx: 'gold' })],
  },

  // Jolt: bonus attack speed plus extra damage on each of the buffed tower's attacks
  // (scaled by its base attack cooldown, like the original).
  energy_junction: {
    actives: (row) => {
      const [as, asAdd, dmg] = at([[0.2, 0.002, 150], [0.25, 0.004, 320], [0.32, 0.0052, 500]], row);
      return [autocast(row, 'jolt', '⚡', `Charges a nearby tower for 10s: +${Math.round(as * 100)}% attack speed plus about ${dmg * 2} extra damage per attack for each second of the tower's base cooldown, growing with level.`, 'tower',
        { kind: 'multi', effects: [
          { kind: 'towerBuff', key: 'jolt', label: 'Jolt', mods: { attackSpeed: as }, perLevel: asAdd / as, dur: 10, fx: 'storm' },
          { kind: 'towerBuff', key: 'joltDamage', label: 'Jolt', mods: { dpsAdd: dmg * 2 }, perLevel: 0.04, dur: 10, quiet: true },
        ] }, { anytime: true, allowSelf: true })];
    },
  },

  // Each attack launches an energy ball fed by stored mana (3x current mana, then 20% of the
  // mana is spent); modelled as an area spell around the target.
  ball_lightning_accelerator: {
    passives: (row) => {
      const [dmg, add] = at([[500, 25], [1000, 50]], row);
      return [proc('Energetic Weapon', 'attack', { chance: 1, silent: true },
        { kind: 'spellDamage', flat: dmg, flatPerLevel: add, manaMult: 3, spendMana: 0.2, radius: 250 / UNIT, fx: 'storm' })];
    },
    // Energy Absorb: nearby towers attack slower for 8s while this tower regenerates mana faster.
    // The original's mana bonus scales with the number of towers drained; a cluster of 4 is assumed.
    actives: (row) => [autocast(row, 'absorb', '🔋', 'Drains nearby towers for 8s: they lose 10% attack speed (less with level) while this tower gains about +8 mana per second.', 'self',
      { kind: 'multi', effects: [
        { kind: 'towerBuff', key: 'absorbed', label: 'Energy Absorb', center: 'self', radius: 1000 / UNIT, others: true, mods: { attackSpeed: -0.1 }, perLevel: -0.01, dur: 8, fx: 'storm' },
        { kind: 'towerBuff', key: 'absorbing', label: 'Energy Absorb', mods: { manaRegenFlat: 8 }, perLevel: 0.02, dur: 8, fx: 'mana' },
      ] })],
  },

  gatling_gun: {
    passives: () => [
      proc('Rapid Gun Fire', 'attack', { chance: 0.65, chancePerLevel: 0.004, silent: true }, { kind: 'barrage', count: 2, mult: 1, fx: 'iron' }),
      proc('Explosive Rounds', 'hit', { chance: 0.1, chancePerLevel: 0.003 }, { kind: 'attackDamage', mult: 1, radius: 200 / UNIT, fx: 'iron' }),
      // Each creep entering range adds a stack (the original watches 800 range; this uses tower range).
      proc('Sentry', 'enter', { chance: 1, silent: true },
        { kind: 'towerBuff', key: 'sentry', label: 'Sentry', mods: { damage: 0.15 }, perLevel: 1 / 30, dur: 3, durPerLevel: 0.05, maxStacks: 20, quiet: true }),
    ],
  },

  // Samples from the current race are shared with nearby towers as bonus damage. The research
  // only covers the race being fought; modelled as a general bonus near its usual level.
  xeno_research_facility: {
    passives: () => [{ type: 'aura', stat: 'damage', value: 0.2, valuePerLevel: 0.008, radius: 280 / UNIT }],
  },

  mossy_acid_sprayer: {
    passives: (row) => {
      const armor = at([0.6, 1.2, 2.4, 4.8, 9.6], row);
      return [{ type: 'shred', armor, maxStacks: 1, dur: 3, desc: `Acid coating: hits strip ${armor} armor for 3s.` }];
    },
  },

  // Piercing shot: part of the attack ignores armor, modelled as bonus armor-free damage.
  burrow: {
    passives: (row) => {
      const [ratio, add] = at([[0.1, 0.004], [0.2, 0.008], [0.3, 0.012], [0.4, 0.016]], row);
      return [proc('Piercing Shot', 'hit', { chance: 1, silent: true }, { kind: 'spellDamage', mult: ratio * 0.35, perLevel: add / ratio, fx: 'iron', quiet: true })];
    },
  },

  solar_collector: {
    passives: (row) => {
      const cost = at([1, 2], row);
      // Every attack burns mana that would otherwise feed Release Energy.
      return [proc('Solar Drain', 'attack', { chance: 1, manaCost: cost, silent: true }, { kind: 'multi', effects: [] })];
    },
    actives: (row) => {
      const [dmg, add, stun, bossStun] = at([[4000, 150, 3, 1], [12000, 450, 5, 1.75]], row);
      return [autocast(row, 'release', '☀', `Releases stored sunlight at a creep: ${dmg} spell damage (+${add} per level) and a ${stun}s stun (${bossStun}s on bosses).`, 'creep',
        { kind: 'spellDamage', flat: dmg, flatPerLevel: add, stun, bossStunMult: bossStun / stun, fx: 'holy' }, { pick: 'first' })];
    },
  },

  marine: {
    passives: (row) => {
      const [chance, add, dmg, dmgAdd] = at([[0.2, 0.003, 1200, 100], [0.25, 0.004, 1800, 150]], row);
      // Shards spread in a cone; modelled as an area around the target. Each grenade adds a
      // permanent stack of damage taken (the original caps the total near 50%).
      return [proc('Frag Grenade', 'hit', { chance, chancePerLevel: add },
        { kind: 'spellDamage', flat: dmg, flatPerLevel: dmgAdd, radius: 250 / UNIT, fx: 'fire',
          stackVuln: { key: 'fragged', pct: 0.02, pctPerLevel: 0.001, max: 12, permanent: true } })];
    },
    actives: (row) => [autocast(row, 'stim', '💉', 'Stim: +150% attack speed but -50% damage for 5s (+0.08s per level).', 'self',
      { kind: 'towerBuff', key: 'stim', label: 'Stim', mods: { attackSpeed: 1.5, damage: -0.5 }, dur: 5, durPerLevel: 0.08, fx: 'iron' })],
  },

  // Fixed to concussive bombs (the original lets the player switch bomb types).
  bomb_turret: {
    passives: (row) => {
      const [radius, slow, add] = at([[250, 0.15, 0.004], [300, 0.25, 0.006]], row);
      return [proc('Concussive Bombs', 'hit', { chance: 1, silent: true },
        { kind: 'debuff', slow, slowPerLevel: add, slowDur: 4, radius: radius / UNIT, fx: 'iron', quiet: true })];
    },
  },

  // Burns creep mana for bonus damage; creeps with mana are the arcane ones here.
  contraption: {
    passives: (row) => {
      const [mana, perMana] = at([[6, 0.08], [8, 0.09], [10, 0.10], [12, 0.12]], row);
      const pct = mana * perMana;
      return [{ type: 'bonusVs', key: 'race', value: 'arcane', pct, desc: `Mana break: +${Math.round(pct * 100)}% damage against arcane creeps.` }];
    },
  },

  // Valor's Light: each creep entering range takes a burst of holy damage and a slow that
  // both halve every second for 5s.
  valor: {
    passives: () => {
      const pulses = [0, 1, 2, 3, 4].map((i) => {
        const f = 0.5 ** i;
        return { kind: 'spellDamage', flat: 2000 * f, flatPerLevel: 80 * f, slow: 0.3 * f, slowPerLevel: 0.012 * f, slowDur: 1, delay: i, quiet: i > 0, fx: 'holy' };
      });
      return [proc("Valor's Light", 'enter', { chance: 1 }, { kind: 'multi', effects: pulses })];
    },
  },

  // Phased creeps drop more and better items; modelled as a short self buff.
  small_ray_blaster: {
    passives: (row) => {
      const [value, add, dur] = at([[0.05, 0.003, 5], [0.08, 0.0035, 5], [0.1, 0.004, 5], [0.12, 0.0045, 6], [0.15, 0.005, 6]], row);
      return [proc('Phaze', 'hit', { chance: 1, silent: true },
        { kind: 'towerBuff', key: 'phaze', label: 'Phaze', mods: { itemFind: value, itemQuality: value }, perLevel: add / value, dur, durPerLevel: 0.1, quiet: true })];
    },
  },

  wooden_trap: {
    passives: (row) => {
      // The trap re-arms 0.2s faster per level; applied in steps of 1s every 5 levels.
      const cd = at([15, 14, 13, 12, 11], row);
      return [5, 10, 15, 20, 25].map((level) => ({ type: 'levelBonus', level, mods: { cdr: 1 / cd } }));
    },
    actives: (row) => {
      const [cd, dmg, add, stun, targets] = at([[15, 70, 3, 0.5, 3], [14, 270, 15, 0.75, 3], [13, 650, 33, 1, 4], [12, 1500, 75, 1.25, 4], [11, 2000, 100, 1.5, 5]], row);
      return [autocast(row, 'trap', '🪤', `Springs traps under up to ${targets} creeps: ${dmg} spell damage (+${add} per level) and a ${stun}s stun each.`, 'creep',
        { kind: 'chainSpell', flat: dmg, flatPerLevel: add, count: targets - 1, falloff: 0, jump: 950 / UNIT, stun, fx: 'iron' },
        { name: 'Activate Trap', cd, mana: 0, range: 950 / UNIT, pick: 'first' })];
    },
  },

  goblin_stronghold: {
    passives: () => [
      proc('Goblin Sapper', 'attack', { chance: 0.2, chancePerLevel: 0.004 },
        { kind: 'spellDamage', flat: 4500, flatPerLevel: 180, radius: 250 / UNIT, slow: 0.35, slowPerLevel: 0.006, slowDur: 3, fx: 'fire' }),
      // Robot and emitter go to a random nearby tower in the original; here they buff the stronghold.
      proc('Clockwork Engineer', 'attack', { chance: 0.2, chancePerLevel: 0.004 },
        { kind: 'towerBuff', key: 'robot', label: 'Clockwork Engineer', mods: { damage: 0.25, attackSpeed: 0.25 }, perLevel: 0.024, dur: 5, fx: 'iron' }),
      proc('Probability Field Emitter', 'attack', { chance: 0.2, chancePerLevel: 0.004 },
        { kind: 'towerBuff', key: 'emitter', label: 'Probability Field', mods: { trigger: 0.45 }, perLevel: 0.6 / 45, dur: 5, fx: 'arcane' }),
      // Pays out when none of the three goblins showed up: (1 - 0.2)^3 at level 0, falling with level.
      proc('Reimbursement', 'attack', { chance: 0.512, chancePerLevel: -0.0068, silent: true }, { kind: 'gold', amount: 5, fx: 'gold' }),
    ],
  },

  // Runs at a sustainable power level instead of the manual speed up/down controls.
  the_steam_engine: {
    passives: () => [
      { type: 'aura', stat: 'damage', value: 0.3, radius: 450 / UNIT, self: false },
      { type: 'aura', stat: 'attackSpeed', value: 0.15, radius: 450 / UNIT, self: false },
    ],
  },

  particle_accelerator: {
    passives: (row) => {
      const v = at([0.02, 0.03, 0.04], row);
      return [
        proc('Energy Acceleration', 'attack', { chance: 1, silent: true },
          { kind: 'towerBuff', key: 'accel', label: 'Energy Acceleration', mods: { damage: v, attackSpeed: v }, perLevel: 0.001 / v, dur: 4, maxStacks: 15, quiet: true }),
        proc('Errant Tachyons', 'kill', { chance: 1, silent: true },
          { kind: 'towerBuff', key: 'tachyons', label: 'Errant Tachyons', mods: { attackSpeed: -0.8 }, dur: 2, quiet: true }),
      ];
    },
  },

  // Helicopters strafe the target area: every hit also blasts, slows and cracks the armor of
  // creeps around it. Napalm (level 7) and tesla (level 15) copters join as the tower levels.
  helicopter_zone: {
    passives: () => [
      proc('Helicopter Zone', 'hit', { chance: 1, silent: true },
        { kind: 'attackDamage', mult: 1, radius: 140 / UNIT, slow: 0.5, slowDur: 0.8, armorPct: 0.3, debuffDur: 0.8, fx: 'iron' }),
      proc('Napalm', 'hit', { chance: 1, minLevel: 7, silent: true },
        { kind: 'debuff', burn: 0.5, burnDur: 5, slow: 0.2, slowDur: 5, radius: 175 / UNIT, fx: 'fire', quiet: true }),
      proc('Tesla Coil', 'hit', { chance: 1, minLevel: 15, silent: true },
        { kind: 'debuff', armorPct: 0.5, debuffDur: 0.8, radius: 210 / UNIT, fx: 'storm', quiet: true }),
    ],
  },

  militia_watchtower: {
    passives: (row) => {
      const add = at([0.01, 0.011, 0.011, 0.012], row);
      return [
        { type: 'miss', base: 0.33, perLevel: -add, desc: `Misses 33% of attacks; ${+(add * 100).toFixed(1)}% less per level.` },
        proc('Hail of Axes', 'attack', { chance: 1, silent: true }, { kind: 'barrage', count: 2, mult: 1, fx: 'iron' }),
        proc('Hail of Axes', 'attack', { chance: 1, minLevel: 15, silent: true }, { kind: 'barrage', count: 1, mult: 1, fx: 'iron' }),
        proc('Hail of Axes', 'attack', { chance: 1, minLevel: 25, silent: true }, { kind: 'barrage', count: 1, mult: 1, fx: 'iron' }),
      ];
    },
  },

  glaive_master: {
    passives: () => [
      // A glaive that ricochets between 20 random creeps in range.
      proc('Glaive Storm', 'hit', { chance: 0.05, chancePerLevel: 0.002 },
        { kind: 'bolts', count: 20, interval: 0.3, attack: true, mult: 0.5, perLevel: 0.04, fx: 'iron' }),
      proc('Bounder', 'attack', { chance: 0.15, chancePerLevel: 0.006 }, { kind: 'attackDamage', mult: 2.5, perLevel: 0.024, radius: 1, fx: 'iron' }),
    ],
    actives: (row) => [autocast(row, 'glaivesaw', '⚙', 'Plants a spinning glaivesaw for 30s that shreds nearby creeps every second for half the attack damage (+2% per level).', 'area',
      { kind: 'zone', mult: 0.5, perLevel: 0.02, radius: 150 / UNIT, dur: 30, fx: 'iron' }, { cd: 10 })],
  },

  dwarven_forgery: {
    passives: () => [{ type: 'aura', stat: 'itemQuality', value: 0.15, valuePerLevel: 0.004, radius: 550 / UNIT }],
  },

  coin_machine: {
    actives: (row) => {
      const [bounty, dur, gold] = at([[0.4, 10, 5], [0.6, 12, 7]], row);
      return [autocast(row, 'golden', '💰', `A nearby tower earns +${Math.round(bounty * 100)}% bounty for ${dur}s; each cast also mints ${gold} gold.`, 'tower',
        { kind: 'multi', effects: [
          { kind: 'towerBuff', key: 'golden', label: 'Golden Influence', mods: { bounty }, perLevel: 0.006 / bounty, dur, durPerLevel: 0.4, fx: 'gold' },
          { kind: 'gold', amount: gold, fx: 'gold' },
        ] })];
    },
  },

  // The script only draws a targeting marker and a reload bar; the blast is data-driven splash.
  nuclear_missile_launcher: {},

  rowing_boat: {
    passives: (row) => {
      // Plunder is a fraction of gold per attack; paid out in whole coins every few attacks.
      const [every, amount, bounty, bountyAdd] = at([[10, 3, 0.1, 0.005], [10, 13, 0.1, 0.01], [5, 12, 0.15, 0.01], [1, 4, 0.2, 0.01]], row);
      return [
        proc('Pirates', 'attack', { every, silent: true }, { kind: 'gold', amount, fx: 'gold' }),
        { type: 'aura', stat: 'bounty', value: bounty, valuePerLevel: bountyAdd, radius: 300 / UNIT },
      ];
    },
  },

  miner: {
    passives: (row) => {
      // Goldrush attack speed depends on banked gold when it starts; fixed at a typical bank.
      const [asBase, asDiv, rush, dig] = at([[0, 5, 1, 2], [20, 3, 3, 5], [40, 2, 5, 10]], row);
      const as = 0.2 + 0.01 * Math.floor(asBase + Math.sqrt(TYPICAL_GOLD) / asDiv);
      return [
        proc('Goldrush', 'attack', { chance: 0.2 },
          { kind: 'towerBuff', key: 'goldrush', label: 'Goldrush', mods: { attackSpeed: as }, dur: 5, durPerLevel: 0.1, fx: 'gold' }),
        // Gold per hit while Goldrush is up (about half the time).
        proc('Goldrush Nuggets', 'hit', { chance: 0.45, silent: true }, { kind: 'gold', amount: rush, fx: 'gold' }),
        // Every 20s a 25% chance to dig up gold; paid as the expected amount.
        proc('Excavation', 'periodic', { icd: 20 }, { kind: 'gold', amount: dig, fx: 'gold' }),
      ];
    },
  },

  // Toxic vapor: a 10s cloud dealing a tenth of the vapor damage every second.
  sewer_connection: {
    passives: (row) => {
      const [dmg, add] = at([[2000, 80], [6000, 240], [12000, 480], [22000, 880]], row);
      return [proc('Toxic Vapor', 'attack', { chance: 0.3, silent: true },
        { kind: 'debuff', dot: { key: 'toxicVapor', dps: dmg / 10, dpsPerLevel: add / 10, dur: 10 }, fx: 'nature', quiet: true })];
    },
  },

  sniper: {
    passives: (row) => {
      const [dmg, add, radius] = at([[400, 10, 150], [1200, 30, 160], [2400, 60, 170], [4000, 100, 180]], row);
      return [proc('Rocket Strike', 'attack', { chance: 0.3, chancePerLevel: 0.006 }, { kind: 'spellDamage', flat: dmg, flatPerLevel: add, radius: radius / UNIT, fx: 'fire' })];
    },
  },
};
