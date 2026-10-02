# Item ports: wave counters, interest, death marks, wave pace

Scope: `spellbook_of_item_mastery`, `golden_decoration`, `priest_figurine`,
`speed_demons_reward`. All four are in `ITEM_PORTS_WAVES`
(`src/data/youtd/item-ports-waves.js`) and no longer list pending abilities
(pending items went from 21 to 17).

## Per item

### Spellbook of Item Mastery (exact)
Upstream: the counter starts at 0, so the first attack after the item is created
fires; afterwards it fires on the first attack once 15 more wave levels have
started (the counter drops by the team level gained, checked every 5s). The spell
picks one of six outcomes at random:
1. 1 forced drop at +100% item quality; 2. 2 drops at +50%; 3. 3 drops at +25%;
4. 2 drops at +25% and a permanent +10% item chance; 5. permanent +25% item chance;
6. permanent +25% item quality.

Port: `proc('Cast a Spell', 'attack', { everyWaves: 15 }, { kind: 'pick', effects: [...] })`.
Drops use `dropItem` with `quality`/`count` (rolled like a creep drop of the target's
level with the carrier's item quality plus the bonus). Permanent bonuses use the
existing `grow` effect, which stores them on the item (`item.bound`), so they leave
and return with the item like upstream's `on_drop`/`on_pickup`.

### Golden Decoration (close approximation)
Upstream: on pickup, interest rate +0.4% x (carrier gold cost / 2500), removed on drop.
Port: `interest: { perCost: 0.004 / 2500 }`, summed into `game.bonusInterest` in
`recalcAll` using `t.def.totalCost` (the YouTD gold cost column). Difference:
upstream locks the value at pickup; here it is recomputed on every recalc, so
upgrading the carrier updates it. The game's interest cap still applies. The item's
bounty modifier comes from the data table as before.

### Priest Figurine (exact)
Upstream: on main-target damage, `0.2 x base attack speed` chance; the creep
permanently grants +5% experience, stacking per proc.
Port: `hit` proc, `chance: 0.2, noAsAdjust: false` (engine scales by cooldown, per the
item-ports convention), effect `{ kind: 'debuff', xpGranted: 0.05 }`. New rider
`xpGranted` adds to `c.xpGranted` (permanent, stacking); `kill` multiplies the creep's
experience total by `1 + c.xpGranted`. Not a `mark`, because marks expire and keep
the strongest value instead of stacking.

### Speed Demon's Reward (exact)
Upstream is not a wave-clear timer: on each attack it remembers the highest creep
level attacked and the (rounded) time. When it attacks a creep of a higher level than
before, it pays `12 - seconds since its previous attack` gold (if positive) and half
that as experience to the carrier.
Port: silent `attack` proc with `{ kind: 'paceReward', window: 12, xpRatio: 0.5 }`.
State (`paceLevel`, `paceTime`, `paceTotal`) lives on the item instance. Gold is
rounded to whole gold (this game keeps integer gold); experience is not rounded.
Since waves here auto-start every 22s plus spawn time, the reward mostly comes from
calling waves early, as in the original.

## New engine primitives

| Name | Shape | Where |
|---|---|---|
| Proc filter `everyWaves` | `{ everyWaves: N }` on any proc; fires on the first trigger, then once `game.level` advanced by N. Last firing level in `holder.waveFired[p.key or p.name]`, holder = item instance (or tower). | `runProcs`, `src/sim/abilities.js` |
| Effect `pick` | `{ kind: 'pick', effects: [...] }`, one sub-effect at random with equal odds | `applyEffect` |
| Effect `paceReward` | `{ kind: 'paceReward', window, xpRatio }` | `applyEffect` |
| `dropItem` forced drops | `{ kind: 'dropItem', quality, count }`; with `quality` set, rolls via `game.dropFor` | `applyEffect` + `Game.dropFor` |
| Rider `xpGranted` | `{ xpGranted: 0.05 }` on debuff effects; permanent, stacking | `debuffCreep`; applied in `Game.kill` |
| Item `interest` | port returns `interest: { pct?, perCost? }`; merged in `items.js`, summed in `recalcAll` | `src/data/items.js`, `src/sim/game.js` |
| `Game.dropRarity(lv, quality)` | rarity roll pulled out of `rollDrops` (same RNG order) and shared with `dropFor` | `src/sim/game.js` |

Descriptions: `describeSkill` handles `everyWaves`; `describeEffect` handles `pick`,
`paceReward`, `dropItem` with quality and the `xpGranted` rider; `describeItem`
prints the interest line.

## Validation

- Pending list no longer has the 4 items (17 left, all from other groups).
- describeItem output:
  - Golden Decoration: "+10% bounty (+0.4% per level)" / "Interest rate on banked gold +0.16% per 1000 gold of the carrier's cost."
  - Priest Figurine: "Enlighten (20% on hit): +5% experience granted on death (permanent, stacks)."
  - Speed Demon's Reward: "Speed Award (100% on attack): when attacking a creep of a newer wave within 12s of its last attack, grants gold equal to the seconds left and 0.5x that as experience."
  - Spellbook of Item Mastery: "Cast a Spell (once every 15 waves, on the first attack): one at random: (1) creates an item with +100% item quality; ... (4) creates 2 items with +25% item quality and permanently grows the item: +10% item chance; (5) ...; (6) permanently grows the item: +25% item quality."
- Headless run (throwaway script, sandbox mode, 8 high-cost towers, each item on its
  own carrier, next wave called as soon as the field is clear, update(1/60), 35 waves):
  no exceptions, no non-finite stats, no negative gold or experience.
  - Spellbook fired at waves 1, 16, 31; forced drops at wave 1 and 16, item bound
    became `{"itemFind":0.1}` at wave 16 (outcome 4).
  - Golden Decoration on a 4800-gold carrier: bonusInterest 0.00768; with 2000 gold
    banked, interest 55 per wave vs 40 without the item.
  - Speed Award paid 8-10 gold on 30 of 34 wave transitions (269 gold total).
  - Priest: a creep after 100 hit procs had xpGranted 1.05 (21 procs) and gave
    25.09 experience vs 12.24 unmarked (exactly x2.05).
- `npx vite build` passes (only the existing chunk size warning).
- Balance bot `DIFF=medium SEED=1 A=fire B=storm CAP=10`: identical to the pre-change
  baseline (wave 45, 319 kills, 31 items), which also shows the `dropRarity`
  extraction keeps the RNG order. Seed 2 moved from wave 51 to 59 (within the ±15
  seed spread; the new item procs consume RNG rolls when the bot equips them).

## Open questions

- Golden Decoration: lock the rate at pickup (needs the equip hook another agent is
  adding) or keep the live recompute? Live is simpler and only differs after upgrades.
- `docs/youtd-port.md` primitive list and pending count were not updated here, to avoid
  conflicts with the parallel item groups; update once all groups merge.
