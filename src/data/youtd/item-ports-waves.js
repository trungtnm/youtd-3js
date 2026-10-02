// Ported item behaviors: Items driven by wave counters, interest, death marks or wave clear time.
// Same entry shape as ITEM_PORTS in item-ports.js; merged there.

import { proc } from './ports/helpers.js';

// Bonuses kept on the item itself, so they follow it to a new carrier.
const itemBonus = (stat, amount) => ({ kind: 'grow', stat, amount });

export const ITEM_PORTS_WAVES = {
  // Fires on the first attack after the item appears, then on the first attack once 15 more
  // waves have started. Forced drops use the carrier's item quality plus the listed bonus.
  spellbook_of_item_mastery: () => ({
    procs: [proc('Cast a Spell', 'attack', { everyWaves: 15 }, {
      kind: 'pick', fx: 'arcane', effects: [
        { kind: 'dropItem', count: 1, quality: 1 },
        { kind: 'dropItem', count: 2, quality: 0.5 },
        { kind: 'dropItem', count: 3, quality: 0.25 },
        { kind: 'multi', effects: [{ kind: 'dropItem', count: 2, quality: 0.25 }, itemBonus('itemFind', 0.1)] },
        itemBonus('itemFind', 0.25),
        itemBonus('itemQuality', 0.25),
      ],
    })],
  }),

  // +0.4% interest rate per 2500 gold of the carrier's cost.
  golden_decoration: () => ({ interest: { perCost: 0.004 / 2500 } }),

  // 20% x base attack speed per main-target hit: the creep permanently grants 5% more
  // experience on death, stacking with each proc.
  priest_figurine: () => ({
    procs: [proc('Enlighten', 'hit', { chance: 0.2, noAsAdjust: false, silent: true }, { kind: 'debuff', xpGranted: 0.05, quiet: true })],
  }),

  // The first attack on a creep of a newer wave pays 12 gold minus the seconds since the
  // carrier's previous attack, and half that much experience.
  speed_demons_reward: () => ({
    procs: [proc('Speed Award', 'attack', { silent: true }, { kind: 'paceReward', window: 12, xpRatio: 0.5 })],
  }),
};
