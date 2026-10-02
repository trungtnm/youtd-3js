// Ported item behaviors: Items that change the triggering hit, use cast targets, creep mana or carrier mana levels.
// Same entry shape as ITEM_PORTS in item-ports.js; merged there.
//
// The 'damage' trigger runs before an attack's main hit lands, so `modifyHit` can change it
// (YouTD's on-damage event). Splash and chain hits are not main hits and stay unchanged.

import { UNIT, proc } from './ports/helpers.js';

const onHit = (name, effect, opts = {}) => proc(name, 'damage', { silent: true, ...opts }, { quiet: true, ...effect });

export const ITEM_PORTS_HITS = {
  // Raises a weak main hit (after armor and attack type) to the carrier's plain attack damage.
  // Creeps immune to the attack stay immune.
  elunes_bow: () => ({ procs: [onHit("Elune's Grace", { kind: 'modifyHit', floor: true })] }),

  // 30% of each main hit becomes spell damage, which then gets spell modifiers on top.
  phase_gloves: () => ({ procs: [onHit('Phase Powers', { kind: 'modifyHit', toSpell: 0.3 })] }),

  // x1.75 on healthy creeps, falling linearly to x0.5 as their health runs out.
  optimists_preserved_face: () => ({ procs: [onHit('Optimist Hunting Season', { kind: 'modifyHit', healthMult: [0.5, 1.75] })] }),

  // Every 5th hit (counted per item) is multiplied by 2 plus the mana regeneration bonus.
  sign_of_energy_infusion: () => ({
    procs: [proc('Infuse with Regeneration', 'damage', { every: 5 }, { kind: 'modifyHit', regenMult: true, fx: 'arcane' })],
  }),

  // Casts aimed at a tower grant 1 experience to that tower and 1 to the carrier.
  faithful_staff: () => ({
    procs: [proc('Reward the Faithful', 'cast', { towerCast: true }, { kind: 'multi', effects: [
      { kind: 'xp', amount: 1 },
      { kind: 'xp', amount: 1, toCastTarget: true },
    ] })],
  }),

  // Drains (8 + 0.6 x level x base cooldown) x 55 / range^0.6 mana per main hit. Only warded
  // creeps carry mana here (YouTD's Magic Immunity also runs on mana), and their ward
  // drops below 10 mana.
  wand_of_mana_zap: () => ({
    procs: [onHit('Mana Zap', { kind: 'drainCreepMana', amount: 8, amountPerLevel: 0.6, perLevelByCd: true, rangeRef: 55, rangeExp: 0.6, fx: 'arcane' })],
  }),

  // The +75% attack speed comes from the item's modifiers. Each attack costs 5% of max mana
  // and fizzles without it, so towers without mana gain nothing (as upstream).
  pendant_of_promptness: () => ({ attackManaPct: 0.05 }),

  // Every 5s: if mana dropped since the last check, 25% chance to put it back.
  circle_of_power: () => ({
    procs: [proc('Circle of Power', 'periodic', { icd: 5, silent: true }, { kind: 'restoreMana', chance: 0.25, every: 5, label: 'Circle of Power', fx: 'gold' })],
  }),

  // Towers within 200 receive debuffs 15% shorter (+1% per carrier level). Debuffs on towers
  // here are timed buffs that only lower stats (e.g. Hangover, Exhausted, Playtime).
  forcefield_generator: () => ({
    aura: { key: 'forcefield_generator', stat: 'debuffDur', value: -0.15, valuePerLevel: -0.01, radius: 200 / UNIT },
  }),
};
