// Ported item behaviors: Items that move, copy, buy or carry state with the item (equip/unequip hooks, stash, tower move).
// Same entry shape as ITEM_PORTS in item-ports.js; merged there.
//
// Extra fields used here (see Game.itemHook and runItemHook):
// - procs with on: 'equip' | 'unequip' run once when the item joins or leaves a tower
//   (equip, unequip, swap, sell, rarity-lock ejection, item moves). `hidden` keeps a
//   bookkeeping hook out of the description.
// - state: starting per-instance state; it lives on the item and travels with it.
// - requires: 'corner' limits which towers may carry the item.
// - waitFirst: a periodic proc first fires a full cooldown after the item is equipped.

import { UNIT, proc } from './ports/helpers.js';

// Experience that travels with the item: given on equip, taken back on unequip.
const carriedXp = (name, amount) => ({
  state: { xp: amount },
  procs: [
    proc(name, 'equip', { silent: true }, { kind: 'itemXp', start: amount }),
    proc(name, 'unequip', { silent: true }, { kind: 'itemXp', amount }),
  ],
});

export const ITEM_PORTS_INVENTORY = {
  orb_of_souls: () => carriedXp('Ethereal Knowledge', 50),
  shining_rock: () => carriedXp('Ethereal Knowledge', 100),
  lunar_essence: () => carriedXp('Sacred Wisdom', 200),

  // Charges count wave levels only while carried: equipping restarts the count,
  // unequipping settles it, a 5s tick handles the rest.
  strange_item: () => {
    const dup = { kind: 'duplicateItem', start: 12, growth: 6, fx: 'arcane' };
    return {
      state: { charges: 12, base: 12 },
      procs: [
        proc('Duplication', 'periodic', { icd: 5, silent: true }, dup),
        proc('Duplication', 'equip', { silent: true, hidden: true }, dup),
        proc('Duplication', 'unequip', { silent: true, hidden: true }, dup),
      ],
    };
  },

  // Manual active (autocast off by default, as upstream): each cast buys an item when a
  // charge and 500 gold are available. Rarity roll: 2/25 unique, 4/25 rare, else uncommon.
  pocket_emporium: () => ({
    state: { charges: 1, acc: 0 },
    procs: [proc('Purchase an Item', 'periodic', { icd: 1, silent: true, active: true, icon: '🛒', auto: false },
      { kind: 'buyItem', cost: 500, levelsPerCharge: 5, maxCharges: 5, minWave: 14, maxWave: 25, unique: 2 / 25, rare: 4 / 25, fx: 'gold' })],
  }),

  // Copies are taken when the idol is equipped and dropped with it.
  distorted_idol: () => ({
    requires: 'corner',
    procs: [
      proc('Imitation', 'equip', { silent: true }, { kind: 'copyItems' }),
      proc('Imitation', 'unequip', { silent: true, hidden: true }, { kind: 'copyItems' }),
    ],
  }),

  // Hops at once instead of flying for a second or two; the arc is drawn as a bolt.
  ball_lightning: () => ({
    procs: [proc('Ball Lightning', 'periodic', { icd: 3, silent: true, waitFirst: true },
      { kind: 'moveItem', radius: 1500 / UNIT, fx: 'storm' })],
  }),

  // Active with autocast on by default. Casts pick their own spot: the free tile in range
  // that covers the most creeps. Without a better spot autocast retries every second.
  chrono_jumper: () => ({
    procs: [proc('Chrono Jump', 'periodic', { icd: 30, silent: true, active: true, icon: '⏳', auto: true },
      { kind: 'jumpTower', range: 1500 / UNIT, dur: 10, mods: { attackSpeed: 0.1 }, key: 'chrono-jump', label: 'Chrono Jump', fx: 'arcane' })],
  }),
};
