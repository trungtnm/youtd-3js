# Item ports: scripted equipment items

Status: 74 of 123 scripted equipment items ported, 49 skipped.
Only `src/data/youtd/item-ports.js` was changed.

Validation:
- `describeItem` runs for every item. 49 items are still pending; all of them are on the skipped list below.
- The runtime check finishes without exceptions (`ok towers 48 kills 40`). An extra run put one ported item on each of 72 towers and played 4 waves: no NaN stats. 17 different item procs fired.

## Conventions used in the port file

- When YouTD multiplies a chance by base attack speed (`calc_chance(x * get_base_attack_speed())`), the port sets `noAsAdjust: false`, so the engine scales the chance by the tower cooldown (clamped 0.3–2.2).
- `buffAura(...)`: auras on stats that `aura` cannot carry (or that grow per level) are emulated. A silent proc every 1s gives towers in range a 1.5s buff, using `towerBuff` with `radius` and `perLevel`.
- `creepAura(...)`: creep auras are emulated by a silent debuff every 1s in a radius around the carrier.
- Item autocasts with a cooldown become `periodic` procs with `icd` = cooldown, plus `needCreeps` when the autocast is offensive.
- Experience effects have no description text in `describeEffect`, so the amount is put in the proc name, e.g. "Learn (+1 experience)".

## Ported items (script -> what the port does)

Data-only (the upstream script is empty): `wooden_leg`, `plain_staff` -> `{}`.

Tower auras:
- `cruel_torch` -> aura +3.5% crit, radius 300/94 (per-level part dropped).
- `war_drum` -> aura +7.5% attack speed, 200/94 (per-level part dropped).
- `flag_of_the_allegiance` -> aura +5% attack speed, 1000/94 (per-level part dropped).
- `libram_of_grace` -> aura +10% experience, 150/94 (per-level part dropped).
- `the_divine_wings_of_tragedy` -> aura +15% attack speed, plus a buff-aura of +15% damage, 250/94.
- `mighty_trees_acorns` -> buff-aura +2% trigger, max mana and spell damage, each +0.4% per level, 300/94.
- `magnetic_field` -> buff-aura +10% buff duration. The -15% debuff duration part is dropped because towers receive no debuffs.
- `sword_of_reckoning` / `sword_of_decay` -> buff-aura +12% (+0.24%/lvl) damage vs undead / feral.
- `bloody_key` -> buff-aura +12% (+0.24%/lvl) damage vs humanoid and brute (the +100 DPS part is dropped).
- `haunted_hand` -> self buff +10% (+1%/lvl) damage vs arcane. The random target switching (a drawback) is dropped.

Creep auras:
- `artifact_of_skadi` -> 14% slow within 800/94.
- `bhaals_essence` -> 10% (+0.2%/lvl) slow and -4 armor within 650/94 (armor per level dropped).
- `essence_of_rot` -> creeps within 800/94 take +20% damage (curse). Towers within 350/94 get -20% attack speed (+0.2%/lvl). The penalty also hits the carrier; the original spares the carrier.

On attack / on hit:
- `cursed_claw` -> every attack slows 10% (+0.4%/lvl) for 5s.
- `spiderling` -> 25%×speed: 5% slow for 4s.
- `bonks_face` -> hits on stunned creeps deal 20% of attack damage as spell AoE, 250/94.
- `sleeve_of_rage` -> stacking self buff, 120 stacks, 1.5s: +0.5% attack speed, +0.25% spell damage and +1% damage per stack (exact).
- `excalibur` -> main-target hits: -10 armor for 5s (the original is -5 or -10, with -0.2 per level).
- `dooms_ensign` -> main-target hits: -3 armor for 5s (the original is percent armor, -10% -0.6%/lvl).
- `dagger_of_bane` -> main-target hits: burn of 15% attack damage per second for 4s.
- `purifying_gloves` -> 12.5%×speed: chain bolt, 250 damage, 3 creeps, -25% per jump. The stun vs undead and brute is dropped.
- `mystical_shell` -> 10%×speed: +15% spell damage taken for 5s.
- `hippogryph_egg` -> 15%×speed: 1250 (+50/lvl) spell AoE, 200/94.
- `mana_stone` -> every 3rd attack restores 1% mana, plus a buff-aura of +7.5% mana regen, 200/94.
- `bartucs_spirit` -> every 10th attack: 2000 (+80/lvl) spell AoE, 300/94.
- `jah_rakals_fury` -> stacking +2% attack speed per attack, 50 stacks, 1.5s. The target-switch reset is dropped.
- `charged_disk` -> every hit deals 0.2× attack damage (+1.25%/lvl) as spell damage. The original scales with tower cost × cooldown, which works out to about this.
- `commander` -> (2% + 0.1%/lvl)×speed: towers within 350/94 get +50% attack speed for 4s (+0.2s/lvl).
- `glaive_of_supreme_follow_up` -> 10% (+0.4%/lvl): +300% attack speed for 0.6s. The original lasts for exactly one attack; its bonus crit is dropped.
- `dark_matter_trident` -> stacking +2% attack speed (20 stacks, 5s +0.1s/lvl), and a 10% slow on the target.
- `liquid_gold` (drawback) -> 10%×speed: -30% attack speed (scaled down per level) for 8s. The tower stun afterwards is dropped.
- `staff_of_the_wild_equus` -> 8%×speed vs creeps below champion: 2s stun. The bonus experience on death is dropped.
- `frog_pipe` -> 20%: 3 extra full attacks (the original fires 4 frogs that can miss, and never targets air).
- `mefis_rocket` -> every attack adds 0.2× (+4%/lvl) attack damage. Fires on attacks instead of its own timer; the spell damage scaling is dropped.
- `fragmentation_round` -> 40% on hit: 0.45× attack damage in a 2.5 radius. The +40% damage-taken mark is dropped.
- `grounding_gloves` -> 6%×speed: 4500 spell AoE with a 1.8s stun, 200/94. The one-root-per-boss rule is dropped.
- `overcharge_shot` -> every hit: 0.35× (+0.6%/lvl absolute) attack damage in a 1.2 radius. The original pierces in a line.
- `blaster_staff` -> at most once per second, 60 spell damage to the creep being attacked.
- `book_of_knowledge` -> 50%×speed on hit: +0.4 experience. Gives about 0.2×cooldown per hit; the range factor is dropped.
- `mini_forest_troll` -> 14%×speed, not while active: +1 multicrit, +25% attack speed, +5% crit and +0.4 crit damage for 4s.
- `holy_hand_grenade` -> 15%: 0.75× (+1%/lvl) attack damage as spell AoE, 400/94. The ×1.5 vs undead is dropped.
- `granite_hammer` -> every 5th attack adds an extra 0.5× attack damage, like a crit.
- `spear_of_loki` (drawback) -> 15%: -75% attack speed for 1s, standing in for a 1s self-stun.
- `stunner` -> (15% + 0.25%/lvl)×speed: 1s stun on non-bosses. Bosses: a third of that chance.
- `magic_gloves` -> 50%×speed: 200 (+10/lvl) spell damage, which matches the expected (100+5/lvl)×cooldown.
- `portable_tombstone` -> (0.25% + 0.01%/lvl)×speed vs creeps below champion: instant kill.
- `lucky_gem` -> five 4%×speed procs: 0.5s stun, 10% slow for 3s, 10 gold, +1 experience, or -5 armor for 3s.
- `chameleon_glaive` -> 40% (+0.4%/lvl): one extra full attack's damage.
- `stasis_trap` -> once per 8s on attack: 0.5s stun in a 2 radius around the target (the original stuns 3 random creeps within 1000).

On kill:
- `wanted_list` -> +2 gold.
- `wise_mans_cooking_recipe` -> +1 experience.
- `jungle_stalkers_doll` -> +20% (+0.4%/lvl) attack speed for 3s, not while active.
- `soul_collectors_cloak` -> grows the item by +10 flat damage per kill, max 4000. The original grows DPS; here it is damage per attack.
- `vampiric_skull` -> restores 7% mana.
- `soul_extractor` -> stuns creeps within 2 of the victim for 1.5s. The original stores 2 stun charges for later hits.
- `arms_dealer` -> once per 60s on hitting a boss: 8 + 0.25×wave gold, the expected value of the 25% sale.
- `old_hunter` -> +1 experience to up to 5 towers within 500/94, and the carrier loses 1 (the original loses 1 per tower that received experience, and needs level 5+).

Periodic and autocast:
- `jewels_of_the_moon` -> +3 experience every 15s.
- `writers_knowledge` -> +1 experience every 12s.
- `basics_of_calculus` -> 1 + 0.04×level experience every 15s. Goes to the carrier instead of a nearby tower.
- `fist_of_doom` (drawback) -> -2 experience every 10s.
- `crescent_stone` -> every 15s: +25% (+1%/lvl) trigger chance for 5s.
- `toy_boy` (drawback) -> every 10s: -50% attack speed for 2s.
- `mining_tools` -> 2 gold every 15s (the expected value of a 40%+ chance at 3–4 gold).
- `currency_converter` -> every 12s: +7 gold and -2 experience (the original uses 15 - 0.3×level seconds and only exchanges when the tower has the experience).
- `share_knowledge` -> every 15s: 2.6 experience to up to 5 towers within 400/94; the carrier loses 10.
- `magic_link` -> every 60s: moves 30 experience from the carrier to one tower within 1200/94.
- `ritual_talisman` -> every 10s in combat: +20% (+0.8%/lvl) experience and +10% (+0.2%/lvl) damage for 10s. The carrier gets the buff instead of a nearby tower.
- `scroll_of_strength` / `scroll_of_speed` -> every 13s in combat: towers within 350/94 get +10% damage / attack speed for 4s. This averages out the 10 charges that regain 3 per 40s.
- `helm_of_insanity` -> every 120s in combat: +100% damage for 6s, then -50% for 12s (the two overlap). The original counts hits: 12 at double damage, then 16 at half.

## Skipped items (49)

| Script | Reason |
|---|---|
| backpack, spellbook_of_item_mastery | No primitive that forces an item drop from a creep. |
| strange_item, pocket_emporium, distorted_idol, ball_lightning | Duplicate, buy, copy or move items between towers. |
| chrono_jumper | Moves the tower. |
| enchanted_knives, silver_armor, chameleons_soul | Fixed bonus on pickup (multishot, tower cost based, element based). Ports cannot add static mods. |
| golden_decoration | Changes the player's interest rate. |
| orb_of_souls, shining_rock, lunar_essence | Experience stored on the item that moves with it. |
| magic_hammer, even_more_magical_hammer, pendant_of_mana_supremacy, arcane_script, faithful_staff, magic_conductor | Need a spell-cast or spell-targeted trigger. |
| scroll_of_piercing_magic, deep_shadows, bones_of_essence, aqueous_vapor, unstable_current, shrapnel_ammunition | +25% damage against an armor type: procs cannot filter by armor type. |
| staff_of_essence, lich_mask, brimstone_helmet, elunes_bow | Override the attack type or the damage floor. |
| never-ending_keg, unyielding_maul, phase_gloves, sign_of_energy_infusion, optimists_preserved_face | Change the damage of the triggering hit (zero it, split it, or scale it). |
| medallion_of_opulence | Damage based on the player's gold. |
| wand_of_mana_zap | Creeps have no mana. |
| pendant_of_promptness | Mana drain per attack; the `mana` effect does not clamp at 0. |
| circle_of_power | Restores mana to a remembered level. |
| bloodthirsty_wheel_of_fortune, workbench, soul_collectors_scythe | Growth on item chance, item quality or crit damage. `grow` works, but `describeEffect` calls those stats "flat damage". |
| crit_blade, golden_trident | Need an on-crit trigger or a reset on crit. |
| priest_figurine, spider_broach | Creep mark for extra experience or item quality on death. |
| speed_demons_reward | Gold reward based on wave clear timing. |
| mindleecher | Steals experience from a random other tower. |

Note: skipped items keep their table stat mods. Drawback-only scripts were ported where possible, so those items do not get their bonuses for free.

## Missing engine primitives (concrete proposals)

1. **Static item mods in the port shape.** Allow `ITEM_PORTS[script](row)` to return `mods: [[channel, base, perLevel]]`, merged into `levelMods` in `items.js`. Unlocks: `enchanted_knives` (`multishot` +3), `haunted_hand`, and exact per-level auras. Add a `cond(towerDef)` variant for `chameleons_soul` (by element) and `silver_armor` (by tower cost).
2. **Per-level aura values.** `aura: { stat, value, perLevel, radius }`, with `recalcAll` using `value + perLevel × carrier.level`. Also widen `auraMods` to any stat channel. That would replace the 1s buff emulation.
3. **Creep auras on items.** Let `updateTowers` read `creepAura` from item defs too (`{ slow, armor, curse, radius }`). That would replace the periodic debuff emulation for `artifact_of_skadi`, `bhaals_essence` and `essence_of_rot`.
4. **Armor-type filter on procs** (`armors: ['divine']`), plus a `vsArmor:<type>` damage channel. Unlocks the six +25%-vs-armor items.
5. **Hit damage modifiers.** A proc field `damageMult` or `damageScale(ctx)` applied to the triggering hit before it lands, plus an `asAttackType` override. Unlocks `never-ending_keg`, `unyielding_maul`, `phase_gloves`, `optimists_preserved_face`, `sign_of_energy_infusion`, `staff_of_essence`, `lich_mask`, `brimstone_helmet` and `elunes_bow`.
6. **Spell-cast triggers.** `runProcs(game, t, 'cast', { active })` in `castActive`, and `'targeted'` on buff targets. Unlocks the six spell-trigger items.
7. **Crit trigger.** `runProcs(..., 'crit')` from `resolveHit` when `crit` is true, plus a `grow` that resets on a trigger. Unlocks `crit_blade` and `golden_trident`.
8. **Safe experience removal.** Make the `xp` effect clamp at `-t.xp` for negative amounts, and add a `transferXp` effect `{ from: 'carrier' | 'randomNear', amount }` that returns what was really moved. Right now `fist_of_doom`, `currency_converter`, `share_knowledge`, `magic_link` and `old_hunter` can leave `t.xp` below 0, and the HUD then shows a negative value. This also unlocks `mindleecher`, and `orb_of_souls`, `shining_rock` and `lunar_essence` (with `onPickup` / `onDrop` hooks).
9. **Clamp mana effects** at 0, and add a "stop attacking when out of mana" flag. Unlocks `pendant_of_promptness`.
10. **Single-target periodic effects.** Periodic procs have no creep target, so a single-target effect hits nothing. Add `target: 'nearest' | 'random'` on periodic procs. That would make `blaster_staff`, `stasis_trap` (3 random creeps) and `mefis_rocket` exact.
11. **Item drop effect** `{ kind: 'dropItem', count, quality }`. Unlocks `backpack` and `spellbook_of_item_mastery`.
12. **Description gaps in `tower-skills.js`:**
    - `describeEffect` has no text for `xp` (worked around in proc names).
    - `grow` falls back to "flat damage" for any stat outside `STAT_NAMES`.
    - `fmtMod` prints raw channel ids (`vsUndead`, `manaRegen`, `buffDur`, `trigger`, `manaPct`) and "+-" for negative values. Suggest reusing `modLabel` from `mods.js`.
    - Chances under 1% round to "0%" (`portable_tombstone`), and small mods round to 0% (`sleeve_of_rage` spell damage shows "+0%").
    - `icd` is not shown for attack, hit and kill procs.

## Unresolved questions

- Should negative-experience drawbacks stay before primitive 8 lands, or should those five items be held back until experience removal is clamped?

## Phase 2

Status: 91 of 123 scripted equipment items ported (17 new), 32 still skipped.
Only `src/data/youtd/item-ports.js` was changed.

Validation:
- `describeItem` runs for every item; 32 items are pending, all listed below.
- The runtime check finishes without exceptions: `ok towers 48 kills 56 nonfinite 0`.
- An extra run put each changed or new item on its own tower and played 6 waves: no non-finite stats, no negative experience, and item growth stayed finite. A second run checked that `cast` procs fire on a tower with an autocast (29 casts, 4 Magical Greed procs).

Armor-type mapping used by `armors:` filters (by the attack type that is strong against each armor): LUA = hide, SOL = chain, HEL = plate, MYT = spirit, SIF = divine, ZOD = bare.

### Approximations that are now exact or closer

| Item | Phase 1 | Phase 2 |
|---|---|---|
| cruel_torch, war_drum, flag_of_the_allegiance, libram_of_grace | per-level part dropped | `aura.valuePerLevel` (+0.08% crit, +0.1% / +0.1% attack speed, +0.4% experience per carrier level). Exact values. |
| bloody_key | +100 DPS part dropped | `aura` on `dpsAdd` 100 (+6/lvl) next to the race buff. Exact. |
| bhaals_essence | armor per level dropped | `armorPerLevel: 0.2`. Exact. |
| essence_of_rot | creep curse without per level | `cursePerLevel: 0.004`. Correction to phase 1: the tower aura has `target_self` TRUE upstream, so the attack speed penalty on the carrier is correct. |
| excalibur | flat -10 armor | -5 on every hit, overwritten by -10 on half the hits, both +0.2 per level. Exact. |
| dooms_ensign | flat -3 armor | `armorPct: 0.1`. The +0.6%/lvl is still dropped (`armorPct` has no per-level field). |
| staff_of_the_wild_equus | `belowChampion` (let air through) | `sizes: [mass, challengeMass, normal]`. Exact filter; bonus experience while lifted is still dropped. |
| frog_pipe | 3 extra attacks | 4 frogs, only when the target is on the ground. |
| blaster_staff | 1/s on attack | Own 1s timer, `bolts` at a creep within 1000/94 (upstream picks the first creep, here a random one). |
| holy_hand_grenade | x1.5 vs undead dropped | Two procs split by race; undead get 1.125 (+1.33%/lvl). Exact. |
| stasis_trap | stun around the target every 8s on attack | Every 8s, 3 random creeps within 1000/94 stunned 0.5s, 1s from level 25. Random picks can repeat a creep. |
| soul_extractor | AoE stun around the victim | Each kill stuns 2 random creeps in range for 1.5s. The charges spent on later hits are still not modeled. |
| arms_dealer | once per 60s on boss hit, expected value | 25% when a boss enters range: 25 + 1 per wave gold. The tower-level part of the reward is dropped, and the tower range replaces 600. |
| old_hunter | shareXp + flat -1 | `transferXp` 1 to up to 5 towers within 500/94, from level 5. Exact. |
| mining_tools | 2 gold expected value | 40% (+2%/lvl) for 3 gold, plus 1 gold from level 25. Exact apart from the extra gold not sharing the roll (at level 25 the chance is above 90%). |
| share_knowledge | any level | From level 2 (`minLevel`). |
| magic_link | shareXp + flat -30 | `transferXp` 30 to one tower within 1200/94. Exact. |
| fist_of_doom, currency_converter | could push experience below 0 | Experience removal is clamped now. Currency converter still pays its gold when the tower has under 2 experience, and uses 12s instead of 15 - 0.3×level. |

Kept on the 1s buff emulation on purpose: `sword_of_reckoning`, `sword_of_decay`, `mighty_trees_acorns`, `the_divine_wings_of_tragedy` (damage part), `magnetic_field`, `mana_stone` and the `essence_of_rot` penalty. Their numbers are already exact, and the engine `aura` keeps only the strongest aura per stat on a tower, while YouTD stacks different aura types. A negative engine aura would also cancel a stronger-looking positive one.

### Newly ported (17)

- Armor-type bonuses: `deep_shadows` (chain), `bones_of_essence` (divine), `aqueous_vapor` (spirit), `unstable_current` (plate), `shrapnel_ammunition` (hide): hit proc with `armors`, extra 0.25x attack damage. `scroll_of_piercing_magic`: 0.25x as spell damage vs divine. Crits on the triggering hit are not included in the bonus.
- `golden_trident`: hit proc with `onCrit`, 4 gold at 50% x cooldown (expected 2 x cooldown, as upstream). The bounty multiplier is dropped.
- `pendant_of_mana_supremacy`: `cast` proc, 20%, once per 10s, restores 15% max mana (+0.6%/lvl dropped: the `mana` effect has no per-level field).
- `arcane_script`: `cast` proc, +1 experience and 3 gold. Upstream scales with the spell cooldown (0.2 exp and 0.5 gold per second); 5s, the median tower spell cooldown, is assumed.
- `even_more_magical_hammer`: every 5th spell hit crits, modeled as a self buff of +20% spell crit. Extra hammers on one tower do not add more.
- `enchanted_knives`: self buff +3 targets (the table's -50% attack speed stays).
- `chameleons_soul`: seven self buffs filtered by the carrier's element (astral +100% exp, darkness +45% spell, nature +10% crit, fire +40% damage, ice +50% buff duration, storm +25% attack speed, iron +30% item chance). Exact.
- `never-ending_keg`, `unyielding_maul` (drawbacks): 10% of attacks deal nothing upstream; modeled as a self buff of -10% damage (additive with other damage bonuses, so slightly milder than x0.9).
- `workbench`: `grow` +0.15% item quality per kill (capped at +1000%; unbounded upstream).
- `soul_collectors_scythe`: `grow` +0.005 crit damage per kill, max +3. Exact.
- `bloodthirsty_wheel_of_fortune`: two kill procs, 16.67% for +4% item chance and 8.33% for -4% (25% x 2/3 and 1/3), max +48%. `grow` has no lower bound, so the upstream floor of -24% is not enforced.

### Still skipped (32)

| Script | Reason |
|---|---|
| backpack, spellbook_of_item_mastery | No effect that forces an item drop. |
| strange_item, pocket_emporium, distorted_idol, ball_lightning | Duplicate, buy, copy or move items. |
| chrono_jumper | Moves the tower. |
| silver_armor | Bonus based on the carrier's gold cost; no tower-cost value in effects. |
| golden_decoration | Changes the interest rate. |
| orb_of_souls, shining_rock, lunar_essence | Need pickup/drop hooks that move experience with the item. |
| magic_hammer | "The next spell crits" needs a one-shot spell crit; a timed buff would also crit unrelated spell procs. |
| faithful_staff | Needs the cast's target to be a tower; the `cast` context only has a creep. |
| magic_conductor | Needs an "is targeted by a spell" trigger. |
| staff_of_essence, lich_mask, brimstone_helmet | Override the attack type's armor multiplier; procs cannot read the carrier's attack type. |
| elunes_bow | Raises the hit to a damage floor. |
| phase_gloves, optimists_preserved_face, sign_of_energy_infusion | Scale the triggering hit (split to spell, health-ratio multiplier both ways, mana-regen multiplier). An emulation with `damage` mods drifts by up to 50% once the tower has other damage bonuses. |
| medallion_of_opulence | Needs damage linear in gold (`scaleBy: 'gold'` is a square root). |
| wand_of_mana_zap | Creeps have no mana. |
| pendant_of_promptness | Needs mana drain as a percent of max mana and "stop attacking when empty". |
| circle_of_power | Restores mana to a remembered level. |
| crit_blade | Needs a growth that resets on crit (`grow` has no reset or floor). |
| priest_figurine, spider_broach | Creep debuffs for more experience or item quality granted on death. |
| speed_demons_reward | Gold reward based on wave clear time. |
| mindleecher | Steals experience from a random other tower (`transferXp` only moves experience away from the carrier). |

### Description gaps (in files outside this port)

- `describeEffect` for `grow` labels every stat other than `flatDamage` as "flat damage" and prints "+-4%" for negative amounts (`workbench`, `soul_collectors_scythe`, `bloodthirsty_wheel_of_fortune`). Using `fmtMod(e.stat, e.amount)` there would fix it; the proc names carry the right stat meanwhile.
- `describeItem` prints the aura's base value only, not `valuePerLevel`.
- `describeSkill` / `describeEffect` do not mention `onCrit`, `armorPerLevel` or `cursePerLevel`, and `bolts` with `flat: 0` prints "0 spell damage" (`stasis_trap`, `soul_extractor`). The golden trident proc name says "crits only" as a workaround.

### Unresolved questions

- Should the engine `aura` stack across different sources (as YouTD does for different aura types) instead of keeping the strongest per stat? If so, the remaining buff-emulated auras can move to `aura`.

## Phase 3

Status: 102 of 123 scripted equipment items ported (11 new), 21 still skipped.
Only `src/data/youtd/item-ports.js` was changed.

Validation:
- `describeItem` runs for every item; `pending items 21`, all listed below.
- Runtime check: `ok towers 48 kills 56 nonfinite 0 stash 6`.
- A targeted run put each new or changed item on its own tower for 14 waves: no non-finite stats, no negative experience. Direct calls through `runProcs` / `applyEffect` confirmed the new mechanics. Backpack adds an item to the stash once per 150s. Crit Blade grows to +40% crit and resets on a crit. Magic Hammer queues one forced spell crit per 5 casts. Magic Conductor reacts to a buff from another tower. Spider Broach sets an `itemQuality` mark. Silver Armor gives +0.0001 damage per gold of cost. Ritual Talisman buffs one random tower in range. Mindleecher steals experience every 30s.

### Newly ported (11)

| Script | Port |
|---|---|
| backpack | Kill proc with a 150s cooldown (the autocast cooldown): `dropItem` uncommon, 2% unique. Upstream rolls the rarity like a regular drop, using the carrier's item quality. The fixed rarity sits near the mid-game average. |
| silver_armor | Silent 1s self buff: +0.01% damage per gold of tower cost (`scaleBy: towerCost`). It refreshes every second, so upgrades count. |
| magic_hammer | `cast` proc, `every: 5`: `nextSpellCrit` 1. Exact. |
| magic_conductor | `buffed` proc: +20% (+0.5%/lvl) attack speed for 10s. Upstream reacts to any spell aimed at the carrier; here it reacts to any buff from another tower, which includes periodic buff auras. |
| staff_of_essence | `attackType: 'essence'` (all armor multipliers 1.0, the same as dividing out the armor factor). Exact apart from essence ignoring the warded rule for arcane. |
| lich_mask, brimstone_helmet | `attackType: 'decay'` / `'elemental'`. Upstream converts hits only when charge reaches 100, gaining 50 + level per attack: half the hits at level 0, all from level 50. Modeled as a full conversion. |
| medallion_of_opulence | 20% x speed on attack: spell damage of 1 + 10% of the player's gold (`scaleBy: goldLinear`). |
| crit_blade | Attack proc `grow` +2% crit (max 40%); `crit` proc `resetGrow`. Upstream checks the attack's crits before growing; here growth comes first and the hit that crits resets it. |
| spider_broach | 15% x speed on hit: mark `{ itemQuality: 0.4 }` for 5s (+0.1s/lvl). The +1%/lvl quality is dropped (marks have no per-level values). |
| mindleecher | Every 30s: `stealXp` 37.5 (the average of the random 15–60) from a random tower within 450/94. |

### Approximations tightened

| Item | Phase 2 | Phase 3 |
|---|---|---|
| magnetic_field, sword_of_reckoning, sword_of_decay, mana_stone | 1s buff emulation | Real `aura` (buff duration +10%; +12% (+0.24%/lvl) vs undead / feral; +7.5% mana regen). Exact. |
| haunted_hand | 1s self buff | Self-only `aura`, +10% (+1%/lvl) vs arcane. |
| essence_of_rot | tower penalty by 1s buff | Tower penalty is a real `aura`: -20% (+0.2%/lvl) attack speed within 350/94. The creep part stays a periodic debuff because item defs cannot carry `creepAura`. |
| enchanted_knives, never-ending_keg, unyielding_maul, even_more_magical_hammer | 1s self buff | Fixed `mods` (+3 targets, -10% damage, -10% damage, +20% spell crit). Extra hammers now add up, as upstream. |
| bloodthirsty_wheel_of_fortune | no lower bound | `grow` `min: -0.24`. Exact. |
| ritual_talisman | buffed the carrier | One random tower within 450/94, carrier included (`pick: 'random'`). Both bonuses share one per-level factor, so damage is exact (+0.2%/lvl). Experience grows +0.4%/lvl instead of +0.8%. |
| all item auras | merged by carrier family | Every item aura sets `key` to its script name. Different item auras on one stat now stack, and copies of one item count once. |

Items still on buff emulation, because they need two aura stats: `the_divine_wings_of_tragedy` (damage part), `mighty_trees_acorns` (three stats), `bloody_key` (race part). `chameleons_soul` keeps per-element self buffs.

### Still skipped (21)

| Script | Reason |
|---|---|
| strange_item, pocket_emporium, distorted_idol, ball_lightning | Duplicate, buy, copy or move items. |
| chrono_jumper | Moves the tower. |
| spellbook_of_item_mastery | Needs a timer counted in waves (fires once per 15 waves); `icd` is in seconds and wave length depends on the player. |
| golden_decoration | Changes the interest rate; only tower abilities feed `bonusInterest`. |
| orb_of_souls, shining_rock, lunar_essence | Need pickup/drop hooks that move experience with the item. A one-time grant on equip could be repeated by moving the item. |
| faithful_staff | Needs the cast's target tower. The `cast` context has only a creep, and no filter fires only on tower-targeted casts. |
| elunes_bow | Raises the triggering hit to a damage floor. |
| phase_gloves, optimists_preserved_face, sign_of_energy_infusion | Scale or split the triggering hit. |
| wand_of_mana_zap | Creeps have no mana. |
| pendant_of_promptness | The drain works (`mana` with a negative `pct`), but "stop attacking when empty" does not. Attack speed mods are additive, so a stall buff cannot cancel the item's own +75% without risking a zero or negative attack speed. Porting only the drain would give manaless towers +75% attack speed for free; upstream such towers never attack. |
| circle_of_power | Restores mana to a level remembered on the previous tick. |
| priest_figurine | Needs a creep mark for more experience granted on death; marks support `bounty`, `itemChance`, `itemQuality` and `xpChance` only. |
| speed_demons_reward | Gold reward based on wave clear time. |

Still approximate from earlier phases: `dooms_ensign` (no `armorPctPerLevel`), `pendant_of_mana_supremacy` (no per-level `pct` on `mana`), `currency_converter` (fixed 12s; a periodic `every` counts frames, not seconds), `basics_of_calculus` (experience goes to the carrier; no "random tower" experience effect), `purifying_gloves` (race-limited stun on chain hits), `fragmentation_round`, `soul_extractor`, `glaive_of_supreme_follow_up`, `liquid_gold`, `staff_of_the_wild_equus`, `arms_dealer`.

### Description gaps (files outside this port)

- `describeEffect` prints the mark rider as `+NaN% bounty, attackers may gain experience` for marks without `bounty` (`spider_broach`). It should list `itemChance` / `itemQuality`.
- `scaleBy` text has no labels for `goldLinear`, `towerCost` or `maxMana` ("per goldLinear"). `towerBuff` descriptions ignore `scaleBy`. The Medallion and Silver Armor proc names carry the real formula meanwhile.
- `describeItem` prints a self-only aura as "towers within 0.0" (`haunted_hand`). It should say "the carrier".
- `dropItem` text says "a uncommon item".
