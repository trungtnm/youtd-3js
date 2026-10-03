# YouTD port

The tower and item roster comes from YouTD, the Warcraft III map, through the data
tables of [YouTD 2](https://github.com/Praytic/youtd2).

## Licensing

- YouTD 2 source code and data tables are MIT licensed. The tables used here are
  copied to `third_party/youtd2/` with the license and the upstream commit
  (`SOURCE_COMMIT`).
- YouTD 2 assets (art, icons, text) are CC-BY-NC 4.0 and are **not** used. Tower
  and item descriptions shown in game are generated from the ported mechanics.
- Tower and item icons are game-icons.net glyphs (CC BY 3.0, `docs/icon-credits.md`),
  one per tower family and item, chosen to match the name (`src/data/icon-map.js`);
  most tower families also use a CC0 or CC-BY model from Poly Pizza
  (`src/data/model-map.js`, `docs/model-credits.md`);
  music is by Kevin MacLeod (CC BY 4.0, `docs/music-credits.md`).

## Pipeline

```
third_party/youtd2/*.csv
  └─ node tools/import-youtd2.mjs
       └─ src/data/youtd/generated.js   (YT_TOWERS, YT_ITEMS)
            ├─ src/data/towers.js      (TOWERS, FAMILIES, TOWER_LIST)
            └─ src/data/items.js       (ITEMS, ITEMS_BY_RARITY)
```

What is ported directly from the tables:

- Towers: name, family, tier, rarity, element, attack type, damage, cooldown,
  range (Warcraft III units / 94), mana, cost, multishot, splash rings, bounce,
  air-only/ground-only targeting, and per-level `MOD_*` modifiers.
- Items: name, rarity, type (equipment, oil, consumable), required wave level,
  per-level `MOD_*` modifiers.
- Consumables: re-implemented by script name in `src/data/items.js`. Food-cap
  items give gold instead because this game has no tower limit.

`src/data/youtd/mods.js` maps `MOD_*` ids onto stat channels (damage, attack
speed, crit, spell damage, mana, bounty, experience, item chance and quality,
race and size damage bonuses, ...).

## Scripted behaviors

Most YouTD towers and many items have a behavior script. These are re-implemented
by hand, keyed by the script name (`row.script`):

- Towers: one file per element in `src/data/youtd/ports/<element>.js`, merged by
  `src/data/youtd/tower-ports.js`. Shared helpers are in `ports/helpers.js`.
- Items: `src/data/youtd/item-ports.js`, merged by `src/data/items.js`.

Until a script is ported, the tower or item lists its abilities as "Not yet
ported" in the UI.

Status at the last update:

| | Total | Data-only or ported | Pending |
|---|---|---|---|
| Towers | 690 | 690 | 0 |
| Items | 315 | 315 | 0 |

Ports were done in four passes. Phase 2 replaced most phase-1 approximations
with exact mechanics using the engine primitives below; phase 3 added the
remaining primitives (item rarity locks, overkill, tower links, mana per attack,
attack type overrides, item marks, stacking armor, chance riders) and finished
the last tower scripts; phase 4 ported the last 21 items, which needed new
mechanics (item state and equip hooks, item copies and purchases, tower moves,
hit modification, creep mana, wave counters, item interest). Item ports for
phase 4 live in `item-ports-inventory.js`, `item-ports-hits.js` and
`item-ports-waves.js`; their reports are
`plans/reports/porter-items-{inventory,hits,waves}-261002-phase4.md`. What remains approximate
(typical values where the engine cannot measure the real one, counters that
should shrink with level, a few dropped riders) is listed per element in the
"Phase 2" section of `plans/reports/porter-<element>-261002-0809-tower-ports.md`.

### Engine primitives available to ports

- Auras on any stat channel: `{ type: 'aura', stat, value, valuePerLevel, radius,
  element, rarities, self: false, selfOnly, minLevel, key }`. Different auras stack;
  copies of the same aura (same `key`, else name or family) count once at their
  strongest.
- Creep auras: `{ type: 'creepAura', radius, slow, armor, curse, vulnSpell,
  vulnElement, xpBonus, ...PerLevel }`.
- Proc triggers: `attack`, `hit`, `kill`, `periodic`, `enter` (once per creep
  entering range), `crit`, `cast` (after an autocast), `death` (any creep dying in
  range). Filters: `chance`, `chancePerLevel`, `every`, `icd`, `cond`, `races`,
  `sizes`, `armors`, `hpBelow`, `hpAbove`, `onCrit`, `minLevel`, `manaCost`.
  A failed periodic roll waits out its `icd`.
- Effect kinds: `spellDamage`, `attackDamage`, `debuff`, `chainSpell`, `zone`,
  `bolts`, `barrage`, `towerBuff` (`center: 'self'`, `others`, `element`), `mana`,
  `gold`, `xp`, `transferXp`, `killInstant`, `grow` (on the item), `growSelf` (on
  the tower, kept through upgrades), `multi`.
- Effect modifiers: `flat`/`flatPerLevel` or `mult`/`perLevel`, `delay`,
  `scaleBy` (`mana`, `gold`, `livesLost`, `towers`, `elementTowers`, `wave`,
  `creepsInRange`, `targetMissingHp`, `kills`), `manaMult`, `spendMana`, `pctHp`,
  `pctMaxHp`.
- Debuff riders: `stun`, `slow`, `armor`, `armorPct`, `curse`, `vulnSpell`,
  `vulnElement`, `stackVuln`, `dot` (flat, stacking spell DoT), `burn`, `pushBack`,
  `mark`, plus `...PerLevel` variants and `debuffDurPerLevel`.
- Passives: `levelBonus` (stats that switch on at a level), `miss`,
  `randomTarget`, `reveal`, `charge`, `multishot`, `splash`, `chain`.
- Phase 3 additions: passives `itemRarityLock`, `attackOverride`,
  `manaPerAttack {cost, gain}`; trigger `buffed`; proc filters `attacks`,
  `elements`, `manaAbove`, `goldCost`, `notOwnKill`, `everyPerLevel`/`everyMin`
  and exact `everySteps: [[level, n], ...]`; towerBuff `pick: 'random'` and
  `scaleBy` on buff mods; riders `armorStack`, `stunChance`/`slowChance` (+ per
  level), `slowDurPerLevel`, `dot.durPerLevel`, `stackVuln.attacksOnly`; mark
  `itemChance`/`itemQuality`; kinds `stealXp`, `dropItem`, `resetGrow`,
  `resetGrowSelf`, `nextSpellCrit`, `link` (with `fromLinked`), `mana` with
  `fromOverkill` and `pctCurrent`; scaleBy `goldLinear`, `towerCost`, `maxMana`,
  `towersInRange` (with `range`); item ports may return `mods` and `attackType`;
  creep aura `xpBonusPerLevel`. Gold spending never goes below zero.
- Towers with a YouTD mana value get a mana pool even without autocasts.
  Experience removal never goes below zero. On-hit procs also fire on the killing blow.
- Item instances (inventory items): procs with `on: 'equip'` / `'unequip'` run once
  when an item joins or leaves a tower (equip, unequip, swap, sell, rarity-lock
  ejection, item moves; `hidden` keeps a hook out of the description). Item ports may
  return `state` (per-instance state kept on the item, read with `game.itemState`) and
  `requires: 'corner'`. Item proc cooldowns travel with the item, and periodic procs with
  `waitFirst` start a full cooldown on pickup. An effect that returns `false` (nothing to
  do) retries after at most 1s. Kinds: `itemXp` (experience stored on the item, taken back
  exactly on unequip, levels included), `duplicateItem`, `buyItem`, `moveItem`,
  `copyItems` (copies apply without slots and without autocast procs), `jumpTower`
  (moves the tower body; its tile stays reserved; `towerMoved` event).
- Item actives: an item proc with `active: true` (plus `icon`, default `auto`) gets a
  button in the tower panel: click casts it (`Game.castItem`), right-click toggles its
  autocast (`Game.toggleItemAuto`, stored on the item). With autocast off a periodic
  active still ticks with `ctx.passive` so effects keep their state; a manual cast runs
  with `ctx.manual` and reports `ctx.fail` when nothing happens. Used by Pocket Emporium
  (autocast off, as upstream) and Chrono Jumper (autocast on).
- Hit modification: trigger `damage` runs before the main hit lands, with effect
  `modifyHit` (`mult`, `healthMult`, `regenMult`, `floor`, `toSpell`). Only towers
  with such a proc build the per-hit context. It changes the main hit only, not bounces.
- Casts: the `cast` context carries `targetTower`; filter `towerCast`; `xp` option
  `toCastTarget`. Mana: `restoreMana`, item field `attackManaPct` (attacks spend max
  mana and fizzle without it), and `debuffDur` on towers shortens buffs whose stat
  changes are all negative.
- Creep mana: warded creeps have a mana pool (YouTD per-size values) and keep their
  ward only at 10+ mana; `drainCreepMana` lowers it.
- Waves and economy: proc filter `everyWaves` (counter stored on the item), effect
  kinds `pick` (one random sub-effect) and `paceReward`, `dropItem` with `quality` and
  `count`, item `interest: { pct, perCost }`, and the debuff rider `xpGranted` (stacking
  extra experience granted on death).

Upstream script bugs that the ports reinterpret: Gryphon Rider's Hammer Fall
deals 0 damage upstream (ported as 1.5x attack damage), and Storm Battery's
Electrify bonus is inverted upstream (ported as +8/16/24% damage taken).

## Porting a tower script

1. Read the upstream script (`src/towers/tower_behaviors/<name>.gd` in YouTD 2).
   Note `get_tier_stats()`, the trigger (`on_attack`, `on_damage`, `on_kill`,
   periodic, autocast, aura) and the effect.
2. Add an entry to `PORTS` in `src/data/youtd/ports/<element>.js` (item scripts go in
   `ITEM_PORTS` in `src/data/youtd/item-ports.js`):
   - `passives(row)` returns procs (`{ type: 'proc', on, chance, chancePerLevel,
     cond, races, every, icd, effect }`) or engine passives (`miss`,
     `randomTarget`, `reveal`, `charge`, `aura`, `creepAura`).
   - `actives(row)` returns autocasts; use the `autocast()` helper so cooldown,
     mana and range come from the original autocast row.
   - Use `at([...], row)` to pick per-tier values (tiers are 1-based).
3. Effects go through `applyEffect` in `src/sim/abilities.js`. Original spells
   deal flat damage: use `flat` and `flatPerLevel`. Distances are divided by 94.
   Tower-to-tower ranges (auras, radius buffs) automatically add the tower
   footprint (`TOWER_FOOTPRINT`, 0.9), because YouTD measures them from the
   tower's edge.
   If a mechanic is missing, add a new effect kind there rather than special
   casing the tower in `game.js`.
4. Check the description renders (`describeSkill` in `src/data/tower-skills.js`)
   and run the balance bot.

Chances in ports set `noAsAdjust: true`, because YouTD scripts already state the
real per-hit chance.

## Updating the data

1. Copy the five CSVs (`tower_properties`, `item_properties`, `aura_properties`,
   `autocast_properties`, `ability_properties`) from a YouTD 2 checkout's `data/`
   into `third_party/youtd2/` and update `SOURCE_COMMIT`.
2. Run `node tools/import-youtd2.mjs`.
3. Run the balance bot and review the shop in the browser.
