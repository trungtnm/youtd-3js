# Ice tower ports

File changed: `src/data/youtd/ports/ice.js` only. Validation: 0 ice towers pending, every ice
ability description renders, the headless sim runs 120s (and 5 waves with level-25 towers)
with no exceptions, and each ice autocast was force-cast on live creeps to confirm it works.

## Ported scripts (26 of 26, 2 were already done)

- frost_root (kept as is) -> 15% on hit: flat spell damage.
- cold_obelisk (kept as is) -> every hit slows.
- small_ice_mine -> 20% (+0.4%/lvl) on hit: flat AoE spell damage plus a slow, per tier.
- igloo -> every 5s in combat: pulse over 900 range with flat spell damage, a 4s slow and a stun.
- tundra_stalker -> Ice Claw autocast: flat spell damage (the 5s DoT dealt at once) plus a slow; each cast adds a permanent stacking +0.5% attack speed (Frenzy), capped per tier.
- frozen_well -> Freezing Mist: every hit slows 15% (+0.4%/lvl) for 10s.
- tidewater_stream -> Spring Tide (15% on attack: AoE flat damage + 0.65s stun) and Splash (20% on hit: AoE flat damage + 12.5% spell vulnerability for 6s).
- genis_sage -> Aqua Edge (AoE on attack), Spread (AoE + stun on hit), Magic Boost (periodic +spell damage to nearby towers), Speed Cast (+attack speed and +trigger chance on self).
- baby_tuskin -> Vicious Snow Ball: one blended proc on attack, spell damage x0.64 plus a stun.
- fisherman -> Net (every hit slows 25% +1%/lvl), Strangle (rare: kills non-bosses instantly, or deals x4 attack damage to bosses) that also gives Fresh Fish (+damage) to nearby towers.
- taita_the_hermit -> Icy Touch (slow on hit plus bonusVsSlowed +60%), Frost Bolt (AoE attack damage vs slowed creeps), Cold Blood (+50% attack speed on kill).
- magna_warrior -> Frozen Spears: 10-14% on hit, an extra half-hit (+per level) plus a 0.5s stun.
- young_northern_troll -> Ice Coated Axes as bonusVsSlowed (+18/19.5/21%).
- sea_turtle -> Aqua Breath: each hit adds attack damage equal to the tower's max mana.
- chilled_spire -> Cold: chance to freeze (stun); half the chance and duration vs bosses.
- ice_battery -> Frost slow on hit; Battery Overload autocast: a 14-target frost chain with flat damage and a slow.
- ymir -> Wrath (20% on hit: spell damage scaled off attack damage, plus a slow), Blood (periodic +25% damage taken from ice in 900 range).
- ebonfrost_crystal -> Frostburn (burn after every hit), Icicles (flat attack damage on hit), Icy Bombardment (AoE on attack), Shattering Barrage autocast (stun, double damage taken, icicle burst).
- icy_skulls -> slow on every hit, per tier.
- the_frozen_wyrm -> Freezing Breath: separate slow and stun chances on hit.
- cold_troll -> Blizzard autocast on the densest group: all waves' damage at once, plus a slow.
- safirons_cold_grave -> Ice Shard: AoE flat damage on every hit plus +15% damage taken from ice.
- icy_core -> creepAura slow (15% / 25%) over the aura radius.
- icy_spirit -> Nova Storm: 25% on attack, one AoE with the combined damage of three novas plus a slow.
- lich_king -> King's Authority: 500 (+20/lvl) spell damage per second to creeps within 900.
- polar_bear_cub -> Cold Feet: each attack stacks +damage and -5% attack speed (10 stacks, 6s).
- frosty_rock -> slow on hit; Glacial Wrath as a flat-chance stun plus spell damage.

## Approximations

- Missing auras: frozen_well (+buff duration), tidewater_stream (+spell crit), ymir Flesh (tower debuff duration, does nothing here) and lich_king Icy Curse (creep debuff duration) are dropped.
- Creeps entering range (igloo, ymir Blood): modeled as a periodic pulse over the trigger range.
- DoTs with flat damage (tundra_stalker, lich_king): dealt up front or as a 1s pulse. Lich King does not store damage from kills or deal it when creeps leave the aura.
- Per-level duration growth (icy_skulls, tundra_stalker, ice_battery) uses the base duration. Per-level slow growth for icy_core and per-level stun growth for chilled_spire are also dropped.
- genis_sage: mana costs are dropped, because only towers with autocasts get mana. Magic Boost (30% every 7s) became every 23s, and Speed Cast became a 4.5% chance per attack.
- baby_tuskin: the facing check became a ~56% factor. Temple Crusher and Knockdown are blended into one damage and stun value.
- fisherman: Strangle is rolled per hit at about 1/3 of the original chance, not when a net expires. Impatient retargeting is dropped. Fresh Fish (+flat DPS) became +15% damage.
- taita: Icy Touch stacks became a fixed 40% slow and +60% damage vs slowed creeps (no per-level growth). Frost Bolt uses a fixed 40% chance instead of the creep's slow %.
- magna_warrior, young_northern_troll: the damage multipliers became an extra hit and a flat bonusVsSlowed (Coated Axes assumes a 30% slow). The troll's Smashing Axe (buff purge plus self-fatigue) is dropped.
- sea_turtle: mana-equals-damage uses max mana, because current mana stays near the cap in combat.
- ice_battery: the random missile stream became a 14-creep chain, so it does less with fewer creeps.
- ebonfrost_crystal: hit damage is not halved, so Frostburn's burn is extra damage. Icicles fire right away instead of being stored. Shatter's stun, damage taken and icicle damage use fixed values, not values scaled by mana.
- cold_troll: the per-wave stun chance is dropped and the slow always applies.
- safirons_cold_grave: the splitting shard fan became a 350-unit AoE. Liquid Ice does not stack and lasts 30s instead of forever.
- icy_spirit: three novas on random creeps became one AoE on the target with 2.25x damage (the original has 50% edge falloff).
- frosty_rock: the escalating chance became a flat chance of 11/14/16/18%.
- polar_bear_cub: the attack-speed penalty per stack does not drop at levels 15 and 25.
- tundra_stalker: Frenzy does not carry over on upgrade, and "permanent" is a 1e6s buff.

## Skipped

None.

## Missing engine primitives (proposals)

1. **Aura stats `buffDur`, `spellCrit`, `trigger`**: add these keys to `auraMods` in `recalcAll` and computeStats so `{type:'aura', stat:'spellCrit'|'buffDur'|...}` works (frozen_well, tidewater_stream).
2. **`on: 'enterRange'` proc trigger**: fires once per creep the first time it enters `radius` of the tower. It needs a per-tower `Set` of creep uids, and `ctx.creep` is the creep (igloo, ymir Blood).
3. **Flat DoT rider `dot: {flat, flatPerLevel, dur}`** in debuffCreep, dealing `flat/s` as spell damage (tundra_stalker Ice Claw, ebonfrost Frostburn).
4. **Stacking creep debuff `stackDebuff: {key, max, perStack: {slow, vulnTower, vulnElement}, dur}`**: tracks stacks per creep. Add an engine passive `bonusPerStack {key, pct, pctPerLevel}` read in damageMultiplier (taita Icy Touch, safirons Liquid Ice, which would need `dur: Infinity`).
5. **`perLevel` on slowDur, stun and debuffDur** (`slowDurPerLevel`, `stunPerLevel`, `debuffDurPerLevel`) for icy_skulls, chilled_spire, magna_warrior and ice_battery.
6. **`creepAura.slowPerLevel`**, read in updateTowers (icy_core).
7. **Slow-proportional bonus**: `bonusVsSlowed {perSlowPct}` multiplies by `1 + perSlowPct * slow*100` (young_northern_troll). The proc option `chanceFromSlow: true` sets chance = creep slow (taita Frost Bolt).
8. **Health-scaled slow**: debuff rider `slowFromMissingHp: true` sets slow = 1 - hp/maxHp (ymir Wrath).
9. **Pseudo-random proc**: proc option `escalate: true`. The chance grows by the base chance on each failure and resets on success (frosty_rock).
10. **Mana for passive towers**: give `def.mana` towers a mana pool even without autocasts, plus a proc option `manaCost` that skips the proc when mana is short (genis_sage). Add an effect kind `attackDamage {fromMana: true}` that deals current mana (sea_turtle).
11. **`randomVolley` effect `{count, interval, flat, radius}`**: fires `count` delayed hits at random creeps in range (ice_battery Overload, icy_spirit Nova Storm, ebonfrost bombardment).
12. **Chance-gated riders**: `stunChance` and `slowChance` in debuffCreep for per-wave chances (cold_troll Blizzard, the_frozen_wyrm).
13. **Permanent tower buffs**: `dur: Infinity` handled in towerBuff, with descriptions showing "permanently" and stacks kept on upgrade (tundra_stalker Frenzy).
14. **`towerBuff` stat `dpsFlat`**: a flat DPS bonus derived from the caster's DPS (fisherman Fresh Fish).
15. **Creep debuff-duration modifier `debuffDurTaken`**: multiplies durations in debuffCreep (lich_king Icy Curse).

Status: DONE_WITH_CONCERNS
Summary: Ported all 24 remaining ice scripts (26 of 26 including frost_root and cold_obelisk); validation passes with no exceptions.
Concerns: Many ports are approximations (see above); balance was not re-checked with the balance bot.

## Phase 2

File changed: `src/data/youtd/ports/ice.js` only. Validation: 0 ice towers pending, every ice
ability description renders, and the full ice roster (91 towers, max level, 180s) runs with no
exceptions and no non-finite stats. A per-family probe confirmed the new mechanics fire: enter
procs (igloo, ymir), flat DoT and permanent growth (tundra_stalker), mana-scaled hits (sea_turtle),
stacking vulnerability (taita, safirons, ymir), auras (frozen_well, tidewater_stream), bolts
(ice_battery, icy_spirit), the blizzard zone (cold_troll), mana costs (genis_sage), and the
level-based stack relief (polar_bear_cub).

### Now exact (or exact up to engine limits)

- frozen_well: Flowing Frost is a real `buffDur` aura (+25%, +0.4%/lvl, 500 range).
- tidewater_stream: Calming Noises is a real `spellCrit` aura (+10%, +0.4%/lvl, 250 range). Splash spell vulnerability grows +0.5%/lvl.
- igloo: an `enter` proc per creep (damage and 4s slow), plus the stun applied 4s later when the chill expires.
- ymir: Blood of Ymir is an `enter` proc. +25% (+0.4%/lvl) damage taken from ice, for 6s (+0.08s/lvl), through `stackVuln` with an element filter.
- tundra_stalker: Ice Claw is a real flat spell DoT with a slow. Frenzy uses `growSelf` (+0.5% attack speed per cast, capped per tier), which carries over on upgrade.
- genis_sage: real mana costs (15/40/40) through `manaCost` on the new mana pool. Speed Cast rolls 15% of each spell's own chance, not a flat 4.5% per attack.
- taita_the_hermit: Icy Touch is a 6-stack `stackVuln` (+10%, +2%/lvl per stack) instead of a flat bonus against slowed creeps.
- sea_turtle: attacks charge mana (64/128/192). Each hit deals attack damage equal to current mana (`manaMult`).
- magna_warrior: the stun grows +0.01s/lvl. chilled_spire: the freeze grows +0.05s/lvl (+0.025s/lvl vs bosses).
- ice_battery: Battery Overload is a stream of 10 missiles over 2s at random creeps within 1200 (`bolts`), not a chain.
- ebonfrost_crystal: Shattering Barrage spends all mana. The boss freeze is shortened (x0.8, which comes to about the 2s floor).
- cold_troll: Blizzard is a `zone` with one wave per second for 5-8 waves, using the per-wave damage and per-level ratio.
- safirons_cold_grave: Liquid Ice is a permanent stacking +15% (+0.4%/lvl) damage taken from ice (capped at 100 stacks).
- icy_core: the slow grows per level (`creepAura.slowPerLevel`).
- icy_spirit: Nova Storm fires novas at random creeps within 900 (`bolts`): 3, plus 1 from level 15 and 1 more from level 25.
- polar_bear_cub: the attack-speed penalty per stack drops from 5% to 4% at level 15 and to 3% at level 25, through two extra stacking relief buffs gated by `minLevel`.
- baby_tuskin: Temple Crusher (1.2x, side hit) and Knockdown (0.5x, back hit) are separate procs, weighted 1/9 and 4/9 for random facing.
- ymir Wrath: the slow now follows the creep's remaining health in four bands (88/63/38/13%), using `hpAbove`/`hpBelow`.

### Still approximate

- Slow duration per level (icy_skulls +0.1-0.4s, the_frozen_wyrm +0.24s, ice_battery +0.3s, tundra_stalker +0.2s): debuffs have no `slowDurPerLevel`. Tundra Stalker's longer claw is folded into its damage per second (+4% of base per level).
- genis_sage: Magic Boost upstream is a 30% roll every 7s. A periodic proc with chance < 1 re-rolls every frame, so it stays an every-23s pulse. Aqua Edge's cone of three waves is a 250 blast around the target.
- fisherman: Strangle triggers on net expiry upstream, which the engine cannot detect, so it is rolled per hit at about 1/3 of the chance. Fresh Fish adds flat DPS from the fisherman's DPS; towerBuff mods are static, so it stays +15% damage. Impatient retargeting is dropped.
- taita: Icy Touch's slow grows 10% per stack upstream. The engine has a single slow value, so a fixed 40% is used. The icy touch vulnerability also boosts other ice towers with the same attack type. Frost Bolt's chance equals the creep's slow % upstream (here a flat 40% vs slowed creeps), and its damage scales with stacks (here 6 stacks are assumed).
- young_northern_troll: the bonus scales with the creep's slow % upstream (assumed 30%), with no per-level growth. Smashing Axe (buff purge plus self-fatigue) is dropped.
- sea_turtle: the 1.75%/s mana leak is dropped, because a describable mana-drain effect is missing (an empty effect renders a blank line). Mana gained per attack ignores the per-level growth, because the `mana` effect has no per-level field. The engine also gives the turtle default mana regen.
- ebonfrost_crystal: hits are not halved, so the burn is extra damage. Icicles fire immediately and their damage does not grow with the fired count. Freeze length does not scale with the mana spent.
- cold_troll: the per-wave stun chance is dropped, and the per-wave slow chance is treated as always landing.
- safirons_cold_grave, tidewater_stream Spring Tide: projectile fans and lines are blasts around the target.
- icy_spirit: the nova's 50% edge falloff is not modeled.
- lich_king: damage accumulated in the aura lands as a 1s pulse, not on exit. Kill storage and the Icy Curse (longer creep debuffs) have no engine equivalent.
- frosty_rock: the escalating chance stays a flat equivalent.
- chilled_spire: the "does not re-freeze a frozen creep" rule and the regen reduction are dropped.
- igloo: the trigger uses the tower's 1000 range, not the script's 900.
- small_ice_mine: the nova's +30% bonus spell crit chance is dropped.

### Engine notes for the owner of src/sim

- `giveXp` level-ups call `computeStats` but not `recalcAll`. Aura `valuePerLevel` and aura `minLevel` therefore stay at the build-time level until something else triggers `recalcAll` (seen as `buffDur` 0.25 on a level-19 Frozen Well).
- The `mana` effect caps at `o.maxMana` (the base pool), not `stats.maxMana`.
- Remaining primitive gaps: `slowDurPerLevel`, `dot.durPerLevel`, `mana.amountPerLevel`, a describable mana-drain effect, chance-gated stun/slow riders, and periodic procs that roll once per `icd` window.

## Phase 3

File changed: `src/data/youtd/ports/ice.js` only. Validation: 0 ice towers pending, every ice
ability description renders, and the full ice roster (91 towers, max level, 180s) runs with no
exceptions and no non-finite stats. A probe on Genis Sage over 140s showed 6 Magic Boost casts
(20 windows x 30%), and a max-level Sea Turtle fills its pool through `manaPerAttack`.

### Now exact

- icy_skulls: slow duration grows +0.1/0.2/0.3/0.4s per level by tier (`slowDurPerLevel`).
- the_frozen_wyrm: the Freezing Breath slow lasts 4s +0.24s per level.
- ice_battery: Frost and the Battery Overload missiles slow for 9s +0.3s per level.
- tundra_stalker: Ice Claw's DoT and slow both last 5s +0.2s per level (`dot.durPerLevel`, `slowDurPerLevel`). The DPS growth is back to the upstream +2/4/8/16/24 per level, since the duration is no longer folded into it.
- sea_turtle: mana per attack is the `manaPerAttack` passive with the upstream per-level growth (64/128/192, +2.56/5.12/7.68 per level).
- genis_sage: Magic Boost is a 30% roll once per 7s window (it no longer waits for creeps in range, as upstream). Speed Cast after Magic Boost is an extra 4.5% roll per 7s window (30% x 15%).
- cold_troll: each Blizzard wave rolls the per-tier slow chance (30-45%) and stun chance (10-25%, 0.25-1s stun) per creep through `slowChance`/`stunChance`.

### Still approximate

- cold_troll: the slow and stun chances do not grow per level (+1% and +0.1% upstream), because the rider chances are flat.
- sea_turtle: the leak of 1.75% of current mana per second is still dropped. The `mana` effect drains flat amounts or a share of max mana, not of current mana.
- genis_sage: the Speed Cast roll after Magic Boost is independent of whether Magic Boost fired. The periodic description reads "Every 7s" and does not show the 30% chance (the describer omits the chance on periodic procs).
- Unchanged from Phase 2 (no phase-3 primitive fits): fisherman (net-expiry trigger, Fresh Fish DPS share), taita (slow per stack, Frost Bolt chance and stack scaling), young_northern_troll (slow-% scaling), ebonfrost_crystal (halved hits, stored icicles, mana-scaled freeze), projectile fans and lines (safirons, tidewater, genis Aqua Edge), icy_spirit falloff, lich_king exit damage and Icy Curse, frosty_rock escalating chance, chilled_spire re-freeze rule, igloo 900 range, small_ice_mine bonus crit on the nova.
