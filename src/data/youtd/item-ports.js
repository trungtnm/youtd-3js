// Ported item behaviors, keyed by YouTD 2 item script name (MIT, see third_party/youtd2).
// Each entry is a function (row) => ({ procs?, aura?, reveal? }) using this game's ability engine:
// - procs: same shape as tower procs ({ type: 'proc', name, on, chance, effect, ... })
// - aura: { stat, value, valuePerLevel?, radius, element?, self?, selfOnly? } shared with
//   towers near the carrier (the per-level part uses the carrier's level)
// - reveal: { radius } true sight for invisible creeps
//
// Conventions used here:
// - YouTD chances written as `chance * base attack speed` use `noAsAdjust: false`,
//   which makes the engine scale the chance by the tower's attack cooldown.
// - The engine `aura` keeps only the strongest aura per stat on each tower. YouTD
//   stacks different aura types, so items whose aura must stack (or that need a
//   second stat) use a silent 1s periodic buff that lasts 1.5s instead. The same
//   self-targeted buff (radius 0) carries fixed bonuses and drawbacks on the carrier.
// - Creep auras are emulated the same way with a periodic debuff around the carrier.
// - Item autocasts become periodic procs with the autocast cooldown.

import { UNIT, proc } from './ports/helpers.js';

// Silent, quiet effects for frequent ticks so they do not spam visuals.
const tick = (name, icd, effect, opts = {}) => proc(name, 'periodic', { icd, silent: true, ...opts }, { quiet: true, ...effect });

// Aura emulation: towers within `range` (WC3 units) gain `mods` while the carrier holds the item.
const buffAura = (name, key, range, mods, perLevel = 0) =>
  tick(name, 1, { kind: 'towerBuff', key, label: name, radius: range / UNIT, mods, perLevel, dur: 1.5 });

// Creep aura emulation: debuff creeps within `range` (WC3 units) every second.
// Riders take per-level fields (slowPerLevel, armorPerLevel, cursePerLevel) from the carrier.
const creepAura = (name, range, riders) =>
  tick(name, 1, { kind: 'debuff', radius: range / UNIT, debuffDur: 1.2, slowDur: 1.2, ...riders });

const silentHit = (name, opts, effect) => proc(name, 'hit', { silent: true, ...opts }, { quiet: true, ...effect });

// YouTD armor types mapped to this game's armor names (by the attack type that is strong against each).
const ARMOR = { lua: 'hide', sol: 'chain', hel: 'plate', myt: 'spirit', sif: 'divine', zod: 'bare' };
// "+25% damage against one armor type" items: an extra quarter of the attack against that armor.
const armorBane = (name, armor) => ({ procs: [silentHit(name, { armors: [ARMOR[armor]] }, { kind: 'attackDamage', mult: 0.25 })] });
// Races other than undead (for effects that differ against undead).
const NOT_UNDEAD = ['brute', 'humanoid', 'arcane', 'feral'];

export const ITEM_PORTS = {
  // ---------------------------------------------------------------- data-only scripts
  wooden_leg: () => ({}),
  plain_staff: () => ({}),

  // ---------------------------------------------------------------- tower auras
  cruel_torch: () => ({ aura: { stat: 'crit', value: 0.035, valuePerLevel: 0.0008, radius: 300 / UNIT } }),
  war_drum: () => ({ aura: { stat: 'attackSpeed', value: 0.075, valuePerLevel: 0.001, radius: 200 / UNIT } }),
  flag_of_the_allegiance: () => ({ aura: { stat: 'attackSpeed', value: 0.05, valuePerLevel: 0.001, radius: 1000 / UNIT } }),
  libram_of_grace: () => ({ aura: { stat: 'xp', value: 0.1, valuePerLevel: 0.004, radius: 150 / UNIT } }),
  the_divine_wings_of_tragedy: () => ({
    aura: { stat: 'attackSpeed', value: 0.15, radius: 250 / UNIT },
    procs: [buffAura('Divine Wings', 'divine-wings', 250, { damage: 0.15 })],
  }),
  mighty_trees_acorns: () => ({
    procs: [buffAura('Charitable Roots', 'acorns', 300, { trigger: 0.02, manaPct: 0.02, spell: 0.02 }, 0.2)],
  }),
  magnetic_field: () => ({ procs: [buffAura('Magnetic Field', 'magnetic-field', 200, { buffDur: 0.1 })] }),
  sword_of_reckoning: () => ({ procs: [buffAura('Holy Wrath', 'reckoning', 200, { vsUndead: 0.12 }, 0.02)] }),
  sword_of_decay: () => ({ procs: [buffAura('Rot', 'decay', 200, { vsFeral: 0.12 }, 0.02)] }),
  bloody_key: () => ({
    aura: { stat: 'dpsAdd', value: 100, valuePerLevel: 6, radius: 200 / UNIT },
    procs: [buffAura('Bestial Rage', 'bloody-key', 200, { vsHumanoid: 0.12, vsBrute: 0.12 }, 0.02)],
  }),
  haunted_hand: () => ({
    // The original also redirects attacks to random creeps; only the bonus is kept.
    procs: [buffAura('Haunting', 'haunted-hand', 0, { vsArcane: 0.1 }, 0.1)],
  }),

  // ---------------------------------------------------------------- creep auras
  artifact_of_skadi: () => ({ procs: [creepAura("Skadi's Chill", 800, { slow: 0.14 })] }),
  bhaals_essence: () => ({ procs: [creepAura('Fright', 650, { slow: 0.1, slowPerLevel: 0.002, armor: 4, armorPerLevel: 0.2 })] }),
  essence_of_rot: () => ({
    procs: [
      creepAura('Presence of Rot', 800, { curse: 0.2, cursePerLevel: 0.004 }),
      // Drawback: nearby towers attack slower, the carrier included.
      buffAura('Stench of Rot', 'rot-penalty', 350, { attackSpeed: -0.2 }, -0.01),
    ],
  }),

  // ---------------------------------------------------------------- on attack / on hit
  cursed_claw: () => ({
    procs: [proc('Cripple', 'attack', { silent: true }, { kind: 'debuff', slow: 0.1, slowPerLevel: 0.004, slowDur: 5, quiet: true })],
  }),
  spiderling: () => ({
    procs: [proc('Spiderling Poison', 'attack', { chance: 0.25, noAsAdjust: false }, { kind: 'debuff', slow: 0.05, slowDur: 4, fx: 'nature' })],
  }),
  bonks_face: () => ({
    procs: [proc('Crush', 'hit', { cond: 'stunned' }, { kind: 'spellDamage', mult: 0.2, radius: 250 / UNIT, fx: 'iron' })],
  }),
  sleeve_of_rage: () => ({
    procs: [proc('Rage', 'attack', { silent: true }, {
      kind: 'towerBuff', key: 'sleeve-rage', label: 'Rage', mods: { attackSpeed: 0.005, spell: 0.0025, damage: 0.01 },
      dur: 1.5, maxStacks: 120, quiet: true })],
  }),
  excalibur: () => ({
    // Half the hits shred 5 armor, the other half 10 (both +0.2 per level). The second
    // roll overwrites the first, which gives the original 50/50 split.
    procs: [
      silentHit('Sundering Edge', {}, { kind: 'debuff', armor: 5, armorPerLevel: 0.2, debuffDur: 5 }),
      silentHit('Sundering Edge (deep cut)', { chance: 0.5 }, { kind: 'debuff', armor: 10, armorPerLevel: 0.2, debuffDur: 5 }),
    ],
  }),
  // Percent armor shred; the original also adds 0.6% per level.
  dooms_ensign: () => ({ procs: [silentHit('Doom', {}, { kind: 'debuff', armorPct: 0.1, debuffDur: 5 })] }),
  dagger_of_bane: () => ({ procs: [silentHit('Bane Poison', {}, { kind: 'debuff', burn: 0.15, burnDur: 4 })] }),
  purifying_gloves: () => ({
    procs: [proc('Purify', 'attack', { chance: 0.125, noAsAdjust: false }, { kind: 'chainSpell', flat: 250, count: 2, falloff: 0.25, fx: 'storm' })],
  }),
  mystical_shell: () => ({
    procs: [proc('Resonance', 'attack', { chance: 0.1, noAsAdjust: false }, { kind: 'debuff', vulnSpell: 0.15, debuffDur: 5, fx: 'arcane' })],
  }),
  hippogryph_egg: () => ({
    procs: [proc('Hippogryph Young', 'attack', { chance: 0.15, noAsAdjust: false },
      { kind: 'spellDamage', flat: 1250, flatPerLevel: 50, radius: 200 / UNIT, fx: 'nature' })],
  }),
  mana_stone: () => ({
    procs: [
      proc('Mana Spark', 'attack', { every: 3, silent: true }, { kind: 'mana', self: true, pct: 0.01 }),
      buffAura('Mana Flow', 'mana-stone', 200, { manaRegen: 0.075 }),
    ],
  }),
  bartucs_spirit: () => ({
    procs: [proc("Bartuc's Spirit", 'attack', { every: 10 }, { kind: 'spellDamage', flat: 2000, flatPerLevel: 80, radius: 300 / UNIT, fx: 'shadow' })],
  }),
  jah_rakals_fury: () => ({
    // Builds attack speed while attacking; the original also drains stacks on target switch.
    procs: [proc('Fury', 'attack', { silent: true }, {
      kind: 'towerBuff', key: 'jah-fury', label: 'Fury', mods: { attackSpeed: 0.02 }, dur: 1.5, maxStacks: 50, quiet: true })],
  }),
  charged_disk: () => ({
    // Original scales with tower cost x cooldown; about a fifth of a regular attack.
    procs: [proc('Discharge', 'hit', { silent: true }, { kind: 'spellDamage', mult: 0.2, perLevel: 0.0125, quiet: true, fx: 'storm' })],
  }),
  commander: () => ({
    procs: [proc('Attack!', 'attack', { chance: 0.02, chancePerLevel: 0.001, noAsAdjust: false }, {
      kind: 'towerBuff', key: 'commander', label: 'Attack!', radius: 350 / UNIT, mods: { attackSpeed: 0.5 }, dur: 4, durPerLevel: 0.2, fx: 'iron' })],
  }),
  glaive_of_supreme_follow_up: () => ({
    procs: [proc('Follow Up', 'attack', { chance: 0.1, chancePerLevel: 0.004 }, {
      kind: 'towerBuff', key: 'follow-up', label: 'Follow Up', mods: { attackSpeed: 3 }, perLevel: 0.0133, dur: 0.6, fx: 'iron' })],
  }),
  dark_matter_trident: () => ({
    procs: [silentHit('Dark Matter Drain', {}, { kind: 'multi', effects: [
      { kind: 'towerBuff', key: 'dark-matter', label: 'Dark Matter', mods: { attackSpeed: 0.02 }, dur: 5, durPerLevel: 0.1, maxStacks: 20, quiet: true },
      { kind: 'debuff', slow: 0.1, slowDur: 5, quiet: true },
    ] })],
  }),
  liquid_gold: () => ({
    // Drawback: random hangover that slows attacks (the tower stun afterwards is omitted).
    procs: [proc('Hangover', 'attack', { chance: 0.1, noAsAdjust: false }, {
      kind: 'towerBuff', key: 'hangover', label: 'Hangover', mods: { attackSpeed: -0.3 }, perLevel: -0.0333, dur: 8, fx: 'gold' })],
  }),
  staff_of_the_wild_equus: () => ({
    // Mass and normal creeps only; the bonus experience while lifted is dropped.
    procs: [proc('Ascension', 'hit', { chance: 0.08, noAsAdjust: false, sizes: ['mass', 'challengeMass', 'normal'] }, { kind: 'debuff', stun: 2, fx: 'storm' })],
  }),
  frog_pipe: () => ({
    // Four frogs, only when the target is on the ground.
    procs: [proc('Frog Piper', 'attack', { chance: 0.2, cond: 'ground' }, { kind: 'barrage', count: 4, mult: 1, fx: 'nature' })],
  }),
  mefis_rocket: () => ({
    procs: [proc('Rocket', 'attack', { silent: true }, { kind: 'attackDamage', mult: 0.2, perLevel: 0.04, fx: 'fire' })],
  }),
  fragmentation_round: () => ({
    procs: [proc('Fragmentation Round', 'hit', { chance: 0.4 }, { kind: 'attackDamage', mult: 0.45, radius: 2.5, fx: 'iron' })],
  }),
  grounding_gloves: () => ({
    procs: [proc('Entangling Roots', 'hit', { chance: 0.06, noAsAdjust: false }, {
      kind: 'spellDamage', flat: 4500, radius: 200 / UNIT, stun: 1.8, fx: 'nature' })],
  }),
  overcharge_shot: () => ({
    procs: [proc('Overcharge', 'hit', { silent: true }, { kind: 'attackDamage', mult: 0.35, perLevel: 0.0171, radius: 1.2, fx: 'storm' })],
  }),
  blaster_staff: () => ({
    // One bolt per second at a creep within 1000 range.
    procs: [proc('Blaster Bolt', 'periodic', { icd: 1, silent: true }, { kind: 'bolts', count: 1, flat: 60, range: 1000 / UNIT, fx: 'arcane' })],
  }),
  book_of_knowledge: () => ({
    // Experience per hit scales with attack cooldown; the range factor is dropped.
    procs: [proc('Study (+0.4 experience)', 'hit', { chance: 0.5, noAsAdjust: false, silent: true }, { kind: 'xp', amount: 0.4 })],
  }),
  mini_forest_troll: () => ({
    procs: [proc('Rampage', 'attack', { chance: 0.14, noAsAdjust: false, icd: 4 }, {
      kind: 'towerBuff', key: 'rampage', label: 'Rampage', mods: { multicrit: 1, attackSpeed: 0.25, crit: 0.05, critMult: 0.4 }, dur: 4, fx: 'nature' })],
  }),
  holy_hand_grenade: () => ({
    // Undead targets take 1.5x.
    procs: [
      proc('Big Badaboom', 'hit', { chance: 0.15, races: NOT_UNDEAD }, { kind: 'spellDamage', mult: 0.75, perLevel: 0.0133, radius: 400 / UNIT, fx: 'holy' }),
      proc('Big Badaboom (undead)', 'hit', { chance: 0.15, races: ['undead'] }, { kind: 'spellDamage', mult: 1.125, perLevel: 0.0133, radius: 400 / UNIT, fx: 'holy' }),
    ],
  }),
  granite_hammer: () => ({
    // Every 5th attack hits like a crit: an extra half of a regular attack.
    procs: [proc('Heavy Weapon', 'attack', { every: 5 }, { kind: 'attackDamage', mult: 0.5, fx: 'iron' })],
  }),
  spear_of_loki: () => ({
    // Drawback: the tower briefly locks up (approximated by a heavy attack speed loss).
    procs: [proc('Tricky Weapon', 'attack', { chance: 0.15 }, {
      kind: 'towerBuff', key: 'loki', label: 'Tricky Weapon', mods: { attackSpeed: -0.75 }, dur: 1, fx: 'shadow' })],
  }),
  stunner: () => ({
    procs: [
      proc('Stun', 'hit', { chance: 0.15, chancePerLevel: 0.0025, noAsAdjust: false, cond: 'notBoss' }, { kind: 'debuff', stun: 1, fx: 'iron' }),
      proc('Stun (boss)', 'hit', { chance: 0.05, chancePerLevel: 0.00083, noAsAdjust: false, cond: 'boss' }, { kind: 'debuff', stun: 1, fx: 'iron' }),
    ],
  }),
  magic_gloves: () => ({
    // Damage scales with attack cooldown in the original; here the chance does.
    procs: [proc('Magic Touch', 'attack', { chance: 0.5, noAsAdjust: false, silent: true }, {
      kind: 'spellDamage', flat: 200, flatPerLevel: 10, quiet: true, fx: 'arcane' })],
  }),
  portable_tombstone: () => ({
    procs: [proc('Curse of the Grave', 'attack', { chance: 0.0025, chancePerLevel: 0.0001, noAsAdjust: false, cond: 'belowChampion' },
      { kind: 'killInstant', fx: 'shadow' })],
  }),
  lucky_gem: () => {
    const lucky = (name, effect) => proc(name, 'hit', { chance: 0.04, noAsAdjust: false }, { fx: 'gold', ...effect });
    return {
      procs: [
        lucky('Lucky Stun', { kind: 'debuff', stun: 0.5 }),
        lucky('Lucky Slow', { kind: 'debuff', slow: 0.1, slowDur: 3 }),
        lucky('Lucky Gold', { kind: 'gold', amount: 10 }),
        lucky('Lucky Lesson (+1 experience)', { kind: 'xp', amount: 1 }),
        lucky('Lucky Break', { kind: 'debuff', armor: 5, debuffDur: 3 }),
      ],
    };
  },
  chameleon_glaive: () => ({
    procs: [proc('Launch Glaive', 'attack', { chance: 0.4, chancePerLevel: 0.004 }, { kind: 'attackDamage', mult: 1, fx: 'nature' })],
  }),
  stasis_trap: () => ({
    // Every 8s: stuns 3 random creeps within 1000 range (1s from level 25).
    procs: [
      proc('Activate Trap', 'periodic', { icd: 8 }, { kind: 'bolts', count: 3, interval: 0, flat: 0, range: 1000 / UNIT, stun: 0.5, fx: 'arcane' }),
      proc('Activate Trap (level 25)', 'periodic', { icd: 8, minLevel: 25, silent: true }, { kind: 'bolts', count: 3, interval: 0, flat: 0, range: 1000 / UNIT, stun: 1, fx: 'arcane' }),
    ],
  }),

  // ---------------------------------------------------------------- armor-type damage
  scroll_of_piercing_magic: () => ({
    procs: [silentHit('Piercing Magic', { armors: [ARMOR.sif] }, { kind: 'spellDamage', mult: 0.25, fx: 'arcane' })],
  }),
  deep_shadows: () => armorBane('Deep Shadows', 'sol'),
  bones_of_essence: () => armorBane('Essence Bones', 'sif'),
  aqueous_vapor: () => armorBane('Aqueous Vapor', 'myt'),
  unstable_current: () => armorBane('Unstable Current', 'hel'),
  shrapnel_ammunition: () => armorBane('Shrapnel', 'lua'),

  // ---------------------------------------------------------------- crits and spell casts
  golden_trident: () => ({
    // Gold on crits, scaled by attack cooldown: 4 gold at 50% x cooldown averages 2 x cooldown.
    procs: [proc('Golden Hit (crits only)', 'hit', { onCrit: true, chance: 0.5, noAsAdjust: false }, { kind: 'gold', amount: 4, fx: 'gold' })],
  }),
  pendant_of_mana_supremacy: () => ({
    // The original restores 0.6% more per level.
    procs: [proc('Magical Greed', 'cast', { chance: 0.2, icd: 10 }, { kind: 'mana', self: true, pct: 0.15 })],
  }),
  arcane_script: () => ({
    // The original scales with the spell's cooldown (0.2 experience and 0.5 gold per second
    // of cooldown); a 5s cooldown, the median for tower spells, is assumed.
    procs: [proc('Script Reading (+1 experience)', 'cast', { silent: true }, { kind: 'multi', effects: [
      { kind: 'xp', amount: 1 },
      { kind: 'gold', amount: 3, fx: 'gold' },
    ] })],
  }),
  even_more_magical_hammer: () => ({
    // Every 5th spell hit crits: modeled as +20% spell crit chance.
    procs: [buffAura('Magical Weapon', 'more-magic-hammer', 0, { spellCrit: 0.2 })],
  }),

  // ---------------------------------------------------------------- fixed bonuses and drawbacks on the carrier
  enchanted_knives: () => ({ procs: [buffAura('Multishot', 'enchanted-knives', 0, { multishot: 3 })] }),
  chameleons_soul: () => {
    // The bonus depends on the carrier's element.
    const forms = [
      ['astral', { xp: 1 }], ['darkness', { spell: 0.45 }], ['nature', { crit: 0.1 }], ['fire', { damage: 0.4 }],
      ['ice', { buffDur: 0.5 }], ['storm', { attackSpeed: 0.25 }], ['iron', { itemFind: 0.3 }],
    ];
    return { procs: forms.map(([el, mods]) => tick(`Transform (${el} towers)`, 1,
      { kind: 'towerBuff', key: 'chameleon-soul', label: 'Transform', element: el, mods, dur: 1.5 })) };
  },
  // Drawbacks: 10% of attacks deal no damage, modeled as -10% attack damage.
  'never-ending_keg': () => ({ procs: [buffAura('Drunk!', 'keg-drunk', 0, { damage: -0.1 })] }),
  unyielding_maul: () => ({ procs: [buffAura('Miss', 'maul-miss', 0, { damage: -0.1 })] }),

  // ---------------------------------------------------------------- growth on kill (stored on the item)
  workbench: () => ({
    // Unbounded in the original; capped here at +1000% item quality.
    procs: [proc('Craftsmanship (+0.15% item quality per kill)', 'kill', { silent: true }, { kind: 'grow', stat: 'itemQuality', amount: 0.0015, cap: 10 })],
  }),
  soul_collectors_scythe: () => ({
    procs: [proc('Soul Reaping (+0.005 crit damage per kill)', 'kill', { silent: true }, { kind: 'grow', stat: 'critMult', amount: 0.005, cap: 3 })],
  }),
  bloodthirsty_wheel_of_fortune: () => ({
    // 25% per kill: two times in three +4% item chance (max +48%), otherwise -4%.
    procs: [
      proc('Fortune Rises (+4% item chance)', 'kill', { chance: 0.1667 }, { kind: 'grow', stat: 'itemFind', amount: 0.04, cap: 0.48, fx: 'gold' }),
      proc('Fortune Falls (-4% item chance)', 'kill', { chance: 0.0833 }, { kind: 'grow', stat: 'itemFind', amount: -0.04, cap: 0.48, fx: 'shadow' }),
    ],
  }),

  // ---------------------------------------------------------------- on kill
  wanted_list: () => ({ procs: [proc('Headhunt', 'kill', {}, { kind: 'gold', amount: 2, fx: 'gold' })] }),
  wise_mans_cooking_recipe: () => ({ procs: [proc('Hearty Meal (+1 experience)', 'kill', { silent: true }, { kind: 'xp', amount: 1 })] }),
  jungle_stalkers_doll: () => ({
    procs: [proc('Enrage', 'kill', { icd: 3 }, {
      kind: 'towerBuff', key: 'stalker', label: 'Enrage', mods: { attackSpeed: 0.2 }, perLevel: 0.02, dur: 3, fx: 'nature' })],
  }),
  soul_collectors_cloak: () => ({
    // Grows flat damage per attack (the original grows damage per second).
    procs: [proc('Soul Harvest', 'kill', { silent: true }, { kind: 'grow', stat: 'flatDamage', amount: 10, cap: 4000 })],
  }),
  vampiric_skull: () => ({ procs: [proc('Vampiric Feast', 'kill', { silent: true }, { kind: 'mana', self: true, pct: 0.07 })] }),
  soul_extractor: () => ({
    // Each kill stuns 2 creeps in range for 1.5s (the original stores 2 charges spent on the next hits).
    procs: [proc('Soul Extraction', 'kill', {}, { kind: 'bolts', count: 2, flat: 0, stun: 1.5, fx: 'shadow' })],
  }),
  arms_dealer: () => ({
    // 25% when a boss comes into range: 25 gold + 1 per wave (the tower level part is dropped).
    procs: [proc('The Customer Is Boss', 'enter', { cond: 'boss', chance: 0.25 }, { kind: 'gold', amount: 25, perWave: 1, fx: 'gold' })],
  }),
  old_hunter: () => ({
    procs: [proc('Hunting Lore', 'kill', { silent: true, minLevel: 5 }, { kind: 'transferXp', radius: 500 / UNIT, amount: 1, count: 5 })],
  }),

  // ---------------------------------------------------------------- periodic and autocasts
  jewels_of_the_moon: () => ({ procs: [tick('Celestial Wisdom (+3 experience)', 15, { kind: 'xp', amount: 3 })] }),
  writers_knowledge: () => ({ procs: [tick('Learn (+1 experience)', 12, { kind: 'xp', amount: 1 })] }),
  basics_of_calculus: () => ({ procs: [tick('Learn (+1 experience, +4% per level)', 15, { kind: 'xp', amount: 1, perLevel: 0.04 })] }),
  fist_of_doom: () => ({ procs: [tick('Pay With Blood (-2 experience)', 10, { kind: 'xp', amount: -2 })] }),
  crescent_stone: () => ({
    procs: [proc('Earth and Moon', 'periodic', { icd: 15 }, {
      kind: 'towerBuff', key: 'earth-moon', label: 'Earth and Moon', mods: { trigger: 0.25 }, perLevel: 0.04, dur: 5, fx: 'holy' })],
  }),
  toy_boy: () => ({
    procs: [proc('Play with me!', 'periodic', { icd: 10 }, {
      kind: 'towerBuff', key: 'playtime', label: 'Playtime', mods: { attackSpeed: -0.5 }, dur: 2, fx: 'nature' })],
  }),
  mining_tools: () => ({
    // 3 gold, 4 from level 25 (where the chance is already above 90%).
    procs: [
      proc('Mining', 'periodic', { icd: 15, chance: 0.4, chancePerLevel: 0.02 }, { kind: 'gold', amount: 3, fx: 'gold' }),
      proc('Mining (level 25)', 'periodic', { icd: 15, minLevel: 25, silent: true }, { kind: 'gold', amount: 1, fx: 'gold' }),
    ],
  }),
  currency_converter: () => ({
    procs: [proc('Exchange (-2 experience)', 'periodic', { icd: 12 }, { kind: 'multi', effects: [
      { kind: 'gold', amount: 7, fx: 'gold' },
      { kind: 'xp', amount: -2 },
    ] })],
  }),
  share_knowledge: () => ({
    procs: [proc('Share Knowledge (-10 experience)', 'periodic', { icd: 15, minLevel: 2 }, { kind: 'multi', effects: [
      { kind: 'shareXp', radius: 400 / UNIT, amount: 2.6, count: 5 },
      { kind: 'xp', amount: -10 },
    ] })],
  }),
  magic_link: () => ({
    procs: [proc('Transfer Experience', 'periodic', { icd: 60 }, { kind: 'transferXp', radius: 1200 / UNIT, amount: 30, count: 1 })],
  }),
  ritual_talisman: () => ({
    procs: [proc('Shamanistic Ritual', 'periodic', { icd: 10, needCreeps: true }, { kind: 'multi', effects: [
      { kind: 'towerBuff', key: 'ritual-xp', label: 'Ritual', mods: { xp: 0.2 }, perLevel: 0.04, dur: 10, fx: 'nature' },
      { kind: 'towerBuff', key: 'ritual-dmg', label: 'Ritual', mods: { damage: 0.1 }, perLevel: 0.02, dur: 10, quiet: true },
    ] })],
  }),
  scroll_of_strength: () => ({
    // 10 charges regained at 3 per 40s: modeled as one boost every 13s.
    procs: [proc('Strength Boost', 'periodic', { icd: 13, needCreeps: true }, {
      kind: 'towerBuff', key: 'scroll-strength', label: 'Strength Boost', radius: 350 / UNIT, mods: { damage: 0.1 }, dur: 4, fx: 'iron' })],
  }),
  scroll_of_speed: () => ({
    procs: [proc('Speed Boost', 'periodic', { icd: 13, needCreeps: true }, {
      kind: 'towerBuff', key: 'scroll-speed', label: 'Speed Boost', radius: 350 / UNIT, mods: { attackSpeed: 0.1 }, dur: 4, fx: 'storm' })],
  }),
  helm_of_insanity: () => ({
    // A burst of double damage followed by exhaustion at half damage.
    procs: [proc('Insane Strength', 'periodic', { icd: 120, needCreeps: true }, { kind: 'multi', effects: [
      { kind: 'towerBuff', key: 'insane', label: 'Insane Strength', mods: { damage: 1 }, dur: 6, fx: 'fire' },
      { kind: 'towerBuff', key: 'exhausted', label: 'Exhausted', mods: { damage: -0.5 }, dur: 12, quiet: true },
    ] })],
  }),
};
