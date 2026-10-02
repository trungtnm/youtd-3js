# Item ports, phase 4: inventory group

Status: 8 of 8 ported. `ITEM_LIST.filter(i => i.pending.length)` no longer lists
strange_item, pocket_emporium, distorted_idol, ball_lightning, chrono_jumper,
orb_of_souls, shining_rock or lunar_essence (13 items remain pending, all in the
other two groups).

Ports: `src/data/youtd/item-ports-inventory.js`.

## Per item

| Script | Port | Exact / approximate |
|---|---|---|
| orb_of_souls, shining_rock, lunar_essence | `state: { xp: 50/100/200 }`. Equip hook `itemXp` grants the stored experience flat (ignores the experience bonus, like `add_exp_flat`). Unequip hook takes back up to 50/100/200 experience, losing levels if needed, and stores what it took on the item. | Exact. At max level (60) the grant is lost, because `giveXp` stops there; upstream has the same cap behavior at its own max level. Earned perks stay after a level loss, but a level cannot be re-earned for a second perk (perks are counted against levels reached). |
| strange_item | `state: { charges: 12, base: 12 }`. Periodic 5s `duplicateItem`: loses one charge per wave level while carried. At zero it creates a Strange Item with `base + 6` charges (into a free slot of the carrier, else the stash) and recharges by `base`. Equip hook restarts the count; unequip hook settles it (a duplicate made on unequip goes to the stash, as upstream). | Exact. If the stash is full, the duplicate is retried on the next check instead of being lost. |
| pocket_emporium | `state: { charges: 1, acc: 0 }`. Periodic 1s `buyItem`: one charge per 5 wave levels (max 5; levels count in the stash too, as upstream's accumulator does), spends 500 gold on a random equipment item with required wave 14-25: 2/25 unique, 4/25 rare, else uncommon. | Approximate trigger: upstream is a manual autocast. Here it buys automatically whenever a charge and 500 gold are available (no HUD changes allowed); unequip it to save gold. It never buys when the stash is full. |
| distorted_idol | -60% attack speed (data). `requires: 'corner'`: only a tower whose tile has two or more unbuildable side neighbours (path, rocks, map edge) can carry it; equip is refused otherwise. Equip hook `copyItems` copies every other item on the carrier as slotless instances (stats, auras, procs, hooks; autocast procs off). Unequip hook removes the copies and runs their unequip hooks. | Exact apart from the refusal: upstream equips, then drops the idol back to the stash; here the equip is refused with a message. Corner test uses the tower's current position, so the upstream Chrono Jumper trick (jump to a corner, swap in the idol) works. Copies are taken at equip time, as upstream. |
| ball_lightning | +150% attack speed (data). Periodic 3s `moveItem` (`waitFirst`): the item moves to a random other tower within 1500/94 that can hold it (open slot, rarity lock, one unique, corner rule), else to the stash. A bolt is drawn between the towers. | Approximate: the item moves instantly instead of flying for 1-2s, so the "target became invalid in flight" branch does not exist. The 3s timer travels with the item (see cooldowns below). |
| chrono_jumper | Periodic 30s `jumpTower`: teleports the carrier to the free buildable tile within 1500/94 whose attack range covers the most visible creeps (only if better than its current spot), gives +10% attack speed for 10s, then returns. Its own tile stays reserved; the 3D model follows a new `towerMoved` event. With no better spot it retries every second. | Approximate target: upstream is a manual point-target autocast; here the item picks its own spot. Upstream blocks upgrades while jumping; here upgrading keeps the jumped position and the tower still returns on time. Removing the item mid-jump does not cut the jump short (youtd1 behavior; youtd2 returns early). |

## New engine primitives

All additive. Names, shapes and locations:

- `src/sim/game.js`, new "item state and hooks" section after `useItem`:
  - `makeItem(id, extra)`: item instance with a fresh uid.
  - `itemState(item)`: `item.state`, created from the item def's `state` plus `born` (wave level). `addItem` stamps it for stateful items.
  - `carriedItems(t)`: slots plus copies stored in `state.copies`. Used by `computeStats`, `recalcAll` (auras, enter/death proc flags), `updateReveal`, `hasRevealer`, `giveXp` and `runProcs`.
  - `itemHook(t, item, on)`: runs the item's equip/unequip procs. Item proc cooldowns (`procCd` keys `i<uid>:`) are saved on the item on unequip and restored on equip, like YouTD's inherited periodic timers. This fixes resetting any periodic item (Mindleecher, Backpack, ...) by re-equipping it.
  - `itemEquipBlock(def, tower)`, `isCorner(t)`, `freeSlotFor(t, item)`, `placeItem(t, slot, item)`, `transferItem(from, slot, to|null)`, `randomItemBetween(rarity, minWave, maxWave)`, `addXpFlat(t, n)`, `takeXpFlat(t, n)` (can lose levels, returns the amount removed), `jumpSpot(t, range)`, `moveTower(t, x, z)` (emits `towerMoved`).
  - Hooks are called from `equip` (new item, swapped-out item), `unequip`, `sell`, and the rarity-lock ejection in `upgrade`. `equip` also checks `itemEquipBlock`.
- `src/sim/abilities.js`:
  - `runItemHook(game, t, item, on)`; `waitFirst` periodic item procs start a full cooldown on pickup.
  - `runProcs` takes items from `game.carriedItems(t)` and uses `copyProcs` for copies. An effect returning `false` resets its proc cooldown to at most 1s.
  - Effect kinds `itemXp`, `duplicateItem`, `buyItem`, `moveItem`, `copyItems`, `jumpTower`.
- `src/data/items.js`: item defs carry `state`, `requires`, `copyProcs` (procs minus those named after the item's autocasts). `describeItem` prints the corner rule and skips `hidden` procs.
- `src/data/tower-skills.js`: `describeSkill` handles `on: 'equip' | 'unequip'`; `describeEffect` covers the six new kinds.
- `src/world/world.js`: `towerMoved` listener moves the tower model.
- `docs/youtd-port.md`: primitives list updated. The status table (315 / 294 / 21) was not changed here to avoid merge conflicts with the other two groups; after all three merge it should read the final counts.

## Validation

- Pending list: only the 13 items of the other groups remain.
- `describeItem` for all 8 items: clean English, no undefined/NaN/raw keys (checked by printing all lines).
- Headless runtime check (throwaway script, not committed): sandbox game, seed 3, 10 towers, all slots open, items equipped, 16 waves at `update(1/60)`:
  - orb/rock/essence: equip grants 50/100/200; 10 moves between two towers, swap-in-place and sell all keep total experience unchanged (`50.0 -> 50.0`, `100.0 -> 100.0`, `200.0 -> 200.0`); selling returns the 200 to the item.
  - distorted_idol: refused on a non-corner tower; on a corner it copied Claws of Attack and Orb of Souls (damage x1.456, +50 xp); unequip restores stats and experience exactly; 5 equip/unequip cycles gain nothing.
  - ball_lightning moved 152 times in 459s (about every 3s); exactly one instance exists afterwards.
  - strange_item duplicated at wave 12; charges at wave 16: 9/12 (original) and 15/18 (duplicate).
  - pocket_emporium bought 4 items (1 starting charge + 3 from waves 5/10/15).
  - chrono_jumper jumped 15 times (30 moves) and is home at the end; its tile stayed reserved.
  - Unequipping an item saves its cooldown on the item and clears it from the tower.
  - No exceptions, no non-finite stats, no negative gold or experience.
- `npx vite build`: passes (only the existing chunk-size warning).
- `DIFF=medium SEED=1 A=fire B=storm CAP=10 node tools/balance.js`: runs, wave 45; seed 2: wave 51. Both identical to the unchanged baseline.

## Open questions

- Pocket Emporium auto-buys whenever it can. If players should control purchases, it needs an item active button in the HUD (out of scope here).
- Chrono Jumper's automatic spot choice scores current creeps only. A path-coverage score would jump earlier in a wave; the current rule never moves to a worse spot.
- Should a tower that loses levels through `takeXpFlat` also lose perks taken at those levels? Currently perks stay, but no extra perk can be earned by regaining the levels.
