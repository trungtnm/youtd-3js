# YouTD port

The tower and item roster comes from YouTD, the Warcraft III map, through the data
tables of [YouTD 2](https://github.com/Praytic/youtd2).

## Licensing

- YouTD 2 source code and data tables are MIT licensed. The tables used here are
  copied to `third_party/youtd2/` with the license and the upstream commit
  (`SOURCE_COMMIT`).
- YouTD 2 assets (art, icons, text) are CC-BY-NC 4.0 and are **not** used. Tower
  and item descriptions shown in game are generated from the ported mechanics.
- Tower icons are game-icons.net glyphs (CC BY 3.0, `docs/icon-credits.md`);
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
| Towers | 690 | 684 | 6 |
| Items | 315 | 283 | 32 |

Pending towers need engine features that do not exist yet: the Ruined Wind
family (returning held items to the stash), Cloudy Temple of Absorption
(overkill damage reported on death) and Dimensional Flux Collector (per-tower
damage tracking and tower links). The 32 pending items are listed with reasons in
`plans/reports/porter-items-261002-0809-item-ports.md`.

Ports were done in two passes. Phase 2 replaced most phase-1 approximations with
exact mechanics using the engine primitives below. What remains approximate
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
- Towers with a YouTD mana value get a mana pool even without autocasts.
  Experience removal never goes below zero.

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
