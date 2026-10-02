# Iron tower ports

File changed: `src/data/youtd/ports/iron.js` (nothing else).
Result: 31 of 31 iron scripts have a port entry, and none are skipped. `iron pending` is 0.
The headless sim ran with all 100 iron towers placed, for 2 minutes and then for 6 waves, with no exceptions and no NaN stats.

## Ported scripts

- obelisk_of_fortuity -> kept as it was (`miss` that drops with level).
- rundown_iron_sentry -> hits may strip flat armor (tier chance; 3/4/5 armor, 30s). Each attack adds a stacking self damage buff (+15%, 5 stacks, lasts for the tier's awareness duration). Hitting air or boss creeps gives towers near the creep +7.5% damage (Alert).
- grab-o-bot -> on attack, 8% (+0.32%/lvl) stun: 2.5s on creeps below champion, 0.9s on bosses. Shock autocast: 1250 (+185/lvl) spell damage in 250 AoE plus a 2s stun.
- silver_knight -> Transmute: kills creeps below champion instantly and pays 6/18 gold. Gold Greed: flat spell damage on every hit.
- bronze_dragon_roost -> 10% (+0.4%/lvl) on hit: 50% slow for 5s.
- energy_junction -> Jolt autocast (can target self, casts even out of combat): +AS buff, plus a `dpsAdd` buff (2x the tier damage, scaled by the target's base cooldown and +4%/lvl), 10s.
- ball_lightning_accelerator -> every attack: 500/1000 (+25/50 per level) spell damage in 250 AoE around the target.
- gatling_gun -> 65% (+0.4%/lvl) on attack: burst of 2 extra attacks. 10% (+0.3%/lvl) explosive hit (attack damage, 200 AoE). Sentry: self damage +15% per stack (+1/30 per level), 20 stacks, 3s.
- xeno_research_facility -> aura: +20% damage for towers within 280.
- mossy_acid_sprayer -> `shred` (1 stack, 3s) of 0.6/1.2/2.4/4.8/9.6 armor.
- burrow -> every hit adds armor-free spell damage of ratio x 0.35 x attack (ratio 10-40%, +4% relative per level).
- solar_collector -> Release Energy autocast: 4000/12000 (+150/450 per level) spell damage plus a 3/5s stun.
- marine -> Frag Grenade: 20/25% on hit, 1200/1800 (+100/150 per level) spell damage in 250 AoE, plus +10% damage taken for 8s. Stim autocast: +150% AS, -50% damage, 5s (+0.08s/lvl).
- bomb_turret -> concussive bombs only: every hit slows 15/25% (+0.4/0.6% per level) in the bomb radius for 4s.
- contraption -> `bonusVs` arcane creeps for +(mana burned x bonus per mana): +48/72/100/144%.
- valor -> Valor's Light: every 5s in combat, 3875 (+155/lvl) spell damage in 800 range and a 30% slow for 1.5s.
- small_ray_blaster -> each hit gives a self buff: +item find and +item quality, 5-15% (+per level), 5s.
- wooden_trap -> autocast with no mana cost on the tier cooldown (15..11s): a chain to up to 3-5 creeps, flat spell damage plus a stun each, no falloff.
- goblin_stronghold -> three independent 20% (+0.4%/lvl) on-attack procs:
  - sapper: 4500 (+180/lvl) spell AoE plus a 35% slow
  - robot: self +25% damage and +25% AS for 5s
  - emitter: self +45% trigger chance for 5s
  - Reimbursement: 50% chance for 5 gold
- the_steam_engine -> auras within 450: +30% damage and +15% attack speed.
- particle_accelerator -> each attack stacks +2/3/4% damage and AS (+0.1%/lvl), max 15 stacks, 4s. A kill applies -80% AS for 2s, in place of the 2s self-stun.
- helicopter_zone -> each hit adds an attack-damage blast in 140 AoE with a 50% slow for 0.8s.
- militia_watchtower -> `miss` 33% (-1/1.1/1.2% per level) plus 2 extra axe attacks per attack. The extra attacks go through the same miss.
- glaive_master -> Glaive Storm: 5% (+0.2%/lvl) on attack, 20 extra attacks at 0.5x (+4%/lvl). Bounder: 15% (+0.6%/lvl), 2.5x attack-damage AoE. Glaivesaw autocast: a 30s zone (1.6 radius) dealing 0.5x attack damage per second, cd 10, so at most 3 are up at once.
- dwarven_forgery -> periodic 1s refresh of a +15% (+0.4%/lvl) item quality buff on towers within 550, including itself.
- coin_machine -> Golden Influence autocast on a tower: +40/60% bounty (+0.6%/lvl) for 10/12s (+0.4s/lvl), plus 5/7 gold per cast.
- nuclear_missile_launcher -> empty entry. The script only draws a target marker and a reload bar. Damage is the data-driven splash.
- rowing_boat -> plunder gold (3 every 10th attack, 13 every 10th, 12 every 5th, 4 every attack) plus a bounty aura (10/10/15/20%) within 300.
- miner -> Goldrush: 20% on attack, self AS buff for 5s (+0.1s/lvl). The size uses the original formula at 1000 gold. Also 45% per hit for 1/3/5 gold, and 2/5/10 gold every 20s (the original's chance x amount).
- sewer_connection -> 30% on attack: a 10s burn at 1.2x base attack per second. This works out to the same ratio as the original's flat vapor damage at every tier.
- sniper -> 30% (+0.6%/lvl) on attack: rocket of 400/1200/2400/4000 (+10/30/60/100 per level) spell damage in 150-180 AoE.

## Approximations (with reason)

- **Triggers when a creep enters range**: rundown_iron_sentry, gatling Sentry and valor use these. They are mapped to on-hit/on-attack procs or a 5s pulse, so they can fire more than once per creep.
  - The sentry's size-based damage multiplier is fixed at the normal-size value and capped at 5 stacks.
  - Sentry armor strip has no per-level growth (the `armor` rider is static).
- **Alert buff is centered on the creep, not the tower**: a radius `towerBuff` from a hit proc is centered on the creep. Champion is missing from Alert, and from Grab-o-Bot's short-stun branch, because no `champion` condition exists.
- **Effects that scale with player gold or lives use fixed values**:
  - silver_knight Gold Greed and miner Goldrush assume 1000 gold.
  - valor "We Will Not Fall" (bonus scales with lives lost) and "Last Line of Defense" (second entry into range) are not ported.
- **Mana mechanics are dropped or folded into other effects**:
  - ball_lightning: the mana-fed damage bonus and the Energy Absorb autocast are dropped. Absorb mainly debuffs allies to raise mana regen. The slow is also dropped; at these damage values it was about 0.1%.
  - solar_collector: the mana cost per attack, and the forced stop when mana runs out, are dropped.
  - contraption: mana burn becomes a fixed bonus against arcane creeps.
  - the_steam_engine: the manual power level, mana drain, overload stun and XP surge are replaced by a fixed power of about 5, a level the original can sustain.
- **Effects modeled as damage riders**:
  - burrow: armor-ignore is modeled as extra spell damage, assuming about 35% average mitigation. Its proc text reads "x0.0" because `mult` (0.035) rounds away in describeEffect.
  - marine: shard spread is modeled as a 250 AoE. The stacking "attack damage taken" (max 50%) becomes a non-stacking 10% `curse`.
  - helicopter_zone: three copters with missiles, napalm, tesla and ghost become an on-hit AoE blast. The Targeted Run autocast and the -30% armor are not ported.
- **Targets or modes that changed**:
  - bomb_turret: only concussive bombs; acid (percent armor) and smoke (silence) can't be selected.
  - goblin_stronghold: robot and emitter buff the stronghold itself, not a random nearby tower.
  - energy_junction: the per-attack spell plus attack hit becomes a `dpsAdd` damage buff.
  - wooden_trap: cooldown reduction per level is not ported. Chain targets are the nearest creeps, not random ones.
- **Other approximations**:
  - glaive_master: Lacerate (50% now, 50% as DoT) is not ported because it only moves damage around. Bounder hits around the target, not along a path to the saws.
  - small_ray_blaster: the creep debuff (better drops for any killer) becomes a self buff, so it only helps when this tower gets the kill.
  - dwarven_forgery: the item-quality aura is built from refreshing timed buffs, because aura stats only cover combat stats.
  - rowing_boat and miner: gold amounts are rounded, and per-level gold growth is dropped. `gold` rounds the amount, and periodic procs ignore `chance` because the roll repeats every frame until it succeeds.
  - bronze_dragon_roost: the debuff's armor increase, the HP regen cut and the item quality on death are not ported.
  - coin_machine: +5/10% income rate is not ported.

## Skipped

None. Every script has an entry. Sub-mechanics that were dropped are listed above.

## Missing engine primitives (proposals)

1. **`on: 'enterRange'` proc trigger.** Fields: `{ on: 'enterRange', radius }`. Fires once per creep when it first enters the radius around the tower, with `ctx.creep`. Users: rundown_iron_sentry, gatling Sentry, valor.
2. **`cond: 'champion'` / `'championUp'` condition.** Covers `size === 'champion'` or anything at least champion. Users: grab-o-bot, solar_collector boss stun, silver_knight.
3. **`center: 'tower'` on radius effects from procs.** `towerBuff` with a radius would center on the caster instead of the proc target.
4. **`armorPierce` passive.** Fields: `{ type: 'armorPierce', pct, perLevel }`. In `damageMultiplier` for non-spell hits, blend: `m = lerp(mitigated, typeOnly, pct)`. Users: burrow.
5. **`armorPct` debuff rider.** Fields: `{ armorPct, debuffDur }`. Reduces or raises armor by a percentage. Users: bomb_turret acid, helicopter_zone, bronze_dragon_roost.
6. **`flatDot` rider.** Fields: `{ dot: flatDps, dotPerLevel, dotDur }`. A flat-damage DoT instead of `burn` (a multiple of attack damage). Users: sewer_connection, glaive Lacerate, helicopter napalm.
7. **`stackCurse` rider.** Fields: `{ attackTaken, attackTakenPerStack, max }`. A stacking "attack damage taken" debuff. Users: marine.
8. **Gold- and lives-scaled values.** Effect fields `scale: { by: 'sqrtGold' | 'livesLost', k }` multiply `flat` or mod values when applied. Users: silver_knight, miner, valor aura.
9. **`creepMark` item rider.** Extend `mark` with `itemFind` and `itemQuality`, read in `rollDrops`, so any killer benefits. Users: small_ray_blaster, bronze_dragon_roost.
10. **Aura over any stat.** Let `{type:'aura'}` take any `computeStats` key, for example itemQuality, trigger or manaRegen. Users: dwarven_forgery, steam_engine.
11. **`income` passive.** Fields: `{ type: 'income', pct }`. Adds to `incomeRate` while the tower stands. Users: coin_machine.
12. **`attackManaCost` passive.** The tower spends mana per attack and holds fire when empty. Users: solar_collector.
13. **`resetBuff` effect.** Fields: `{ kind: 'resetBuff', key }` plus a self-`stun` on a tower. Allows "stack until kill, then reset and pause". Users: particle_accelerator.
14. **Random-target multi-spell.** Fields: `{ kind: 'multiSpell', count }`. Hits N random creeps in tower range, and works from periodic procs with no target creep. Users: wooden_trap.
15. **Level thresholds.** Fields: `minLevel` on a proc, or `countPerLevelStep`. Users: militia extra axes at lvl 15/25, helicopter copter modes at 7/15/25.
16. **Chance on periodic procs.** Make a failed chance roll still consume `icd`, so `{on:'periodic', icd, chance}` means "every icd seconds, with this chance". Users: miner Excavation.
17. **Mode-switch actives.** Toggle autocasts that swap a passive set. Users: bomb_turret, the_steam_engine.

## Validation

- Pending check: `iron pending 0`. `describeAbility` ran on all iron abilities without errors.
- Headless sim with all iron towers: finished without exceptions, 40 kills in 2 minutes.
- Six-wave run: 122 kills, no NaN damage. Rocket Strike, Excavation and Jolt were seen firing.

## Phase 2

File changed: `src/data/youtd/ports/iron.js` only. Iron pending is still 0; every iron script has an entry.

### Now exact (or much closer)

- **rundown_iron_sentry**: all three parts now run on `on: 'enter'` (once per creep, tower range 925 = the original's 925).
  - Trespasser armor loss uses `armorPerLevel` (+0.10/0.15/0.20 per level) and lasts for the creep's life.
  - Awareness uses the original size multipliers through `sizes` filters (mass 1, challenge-mass 2, normal 3, air 4, champion 5, boss 6, challenge boss 8). Each stack is +5% x multiplier (+0.1% x multiplier per level) for the tier's duration.
  - Alert now includes champions and is centered on the sentry (`center: 'self'`, 500 range).
- **grab-o-bot**: the short 0.9s grapple now covers champions too (`cond: 'bossOrChampion'`).
- **silver_knight**: Gold Greed scales with the square root of banked gold (`scaleBy: gold`). It deals greed x (1 + sqrt(gold)), one greed value above the original. A transmuted creep is already dead, so it takes no greed damage, as in the original's else branch.
- **ball_lightning_accelerator**: each ball adds 3x current mana to its damage and spends 20% of the mana (`manaMult`, `spendMana`). The Energy Absorb autocast is ported: towers within 1000 lose 10% attack speed (less with level) for 8s, and the accelerator gains mana regen.
- **gatling_gun**: Sentry stacks on `enter` instead of a 50% on-attack roll.
- **solar_collector**: every attack spends 1/2 mana (`manaCost`). Boss stun is 1s/1.75s (`bossStunMult`).
- **marine**: Frag Grenade adds a permanent stacking damage-taken debuff (`stackVuln`: 2% +0.1%/lvl per stack, max 12).
- **valor**: Valor's Light runs on `enter` and is the original's decaying burst: 2000 (+80/lvl) spell damage and a 30% (+1.2%/lvl) slow, both halving every second for 5 pulses (`delay`).
- **small_ray_blaster**: buff duration is 5/5/5/6/6s +0.1s per level, as in the original.
- **wooden_trap**: the cooldown drops 0.2s per level, through `levelBonus` CDR in 1s steps every 5 levels (exact at levels 5, 10, 15, 20, 25).
- **goblin_stronghold**: Reimbursement pays only when no goblin triggered. The chance is now (1 - 0.2)^3 = 51.2% at level 0, falling 0.68% per level, instead of a flat 50%.
- **the_steam_engine**: the aura no longer buffs the engine itself (`self: false`), as in the original.
- **helicopter_zone**:
  - the blast now cuts 30% armor (`armorPct`) for 0.8s
  - Napalm from level 7: 0.5x attack damage burn for 5s and a 20% slow, in 175 range
  - Tesla from level 15: a 50% armor cut in 210 range
- **militia_watchtower**: +1 axe at level 15 and +1 more at 25 (`minLevel` procs).
- **glaive_master**: Glaive Storm triggers on hit, like the original. It is now 20 ricochets on random creeps spread over time (`bolts`, attack damage), not one instant barrage.
- **dwarven_forgery**: a real `itemQuality` aura (15% +0.4%/lvl, 550 range, itself included). This replaces the 1s buff pulse.
- **rowing_boat**: the bounty aura gains its per-level growth (+0.5%/1% per level).
- **xeno_research_facility**: the aura gains per-level growth (+0.8%/lvl).
- **sewer_connection**: Toxic Vapor is the exact flat DoT: vapor/10 per second for 10s (`dot`), plus vapor_add/10 per level.
- **miner**: Goldrush attack speed uses the original formula (0.2 + 0.01 x (base + sqrt(gold)/divisor)), evaluated at 1000 gold.

### Still approximate (and why)

- **Buff mods cannot scale at runtime**: `scaleBy` only scales damage.
  - miner Goldrush assumes 1000 gold.
  - ball_lightning's Energy Absorb assumes 4 drained towers, for +8 mana/s (+0.16/lvl).
  - valor "We Will Not Fall" (spell and attack damage grow with lives lost, on an aura) is still not ported.
- **valor "Last Line of Defense"** is not ported. It needs a second-entry trigger, and `enter` fires once per creep.
- **rundown sentry**:
  - Armor loss does not stack to 5x, because the `armor` rider is a single value per family.
  - Awareness stacks share one timer per size and are capped at 20, while the original keeps an independent timer per intruder.
- **gatling_gun**:
  - Sentry uses tower range (1000) for `enter`, not the original's 800.
  - The burst size is fixed at 2 extra attacks; the original rolls a geometric count that averages about 2.1.
  - Explosive Rounds rolls on every hit, not only on burst bullets.
- **ball_lightning**: manaMult is flat 3x. The original's +0.05x per level is dropped because there is no `manaMultPerLevel`. The ball's line path is modelled as an AoE at the target, and its tiny slow is dropped.
- **solar_collector**: the tower keeps attacking with no mana. The original stops attacking, and there is no "hold fire" primitive.
- **marine**: shards are an AoE. The damage-taken stack also amplifies spells, because `stackVuln` has no attack-only filter. Max 12 stacks approximates the original's level-dependent 50% cap.
- **burrow**: there is still no armor-pierce primitive, so the bonus is armor-free spell damage at about 35% assumed mitigation.
- **contraption**: creeps have no mana pool, so this stays a flat bonus against arcane creeps.
- **the_steam_engine**: the manual power level, mana drain, overload stun and Power Surge XP (which triggers on other towers' attacks) still use a fixed power of 5.
- **bomb_turret**: there are no mode-switch actives, so it stays on concussive only (acid/smoke not selectable).
- **goblin_stronghold**: robot and emitter still buff the stronghold. `towerBuff` cannot pick one random nearby tower; `others: true` would buff every tower in range.
- **particle_accelerator**: there is still no reset-on-kill, so it stays as 15 stacks with a 4s refresh, and a kill gives -80% AS for 2s instead of a stun.
- **energy_junction**: unchanged; the `dpsAdd` buff matches the original's per-attack spell plus attack hit.
- **wooden_trap**:
  - Targets are the nearest creeps, not random distinct ones. `bolts` can repeat a creep, so `chainSpell` stays.
  - Cooldown reduction is stepped.
- **helicopter_zone**:
  - Copters still map to on-hit effects.
  - The ghost copter (level 25) and the Targeted Run autocast are not ported.
  - The armor cut has no per-level growth, because there is no `armorPctPerLevel`.
- **glaive_master**: Lacerate (half now, half over 5s) is not ported, because it only moves damage around. Glaivesaws are 30s zones, not permanent saws capped at 3.
- **small_ray_blaster** and **bronze_dragon_roost**: there is still no creep-side item find/quality mark.
  - small_ray stays a self buff.
  - bronze's armor raise, HP regen cut and item quality are not ported. There is also no per-level duration for slows.
- **coin_machine**: there is no income-rate passive, so its +5/10% income is not ported.
- **rowing_boat / miner**: gold is still paid in whole coins.
  - Per-level gold growth (miner nuggets/excavation) is dropped.
  - Periodic procs ignore `chance`, so Excavation pays the expected value.
- **xeno_research_facility**: still a general damage aura. Research tracks one race at a time, and this engine has no "current race" state.

### Remaining primitive gaps

`manaMultPerLevel`, `armorPctPerLevel`, attack-only `stackVuln`, stacking flat `armor` rider, runtime-scaled buff/aura mods (`scaleBy` on `towerBuff`/`aura`), random single ally target for `towerBuff`, reset-buff-on-kill, hold-fire-without-mana, creep item marks, income passive, mode-switch actives.

### Validation

- `describeAbility` on all iron abilities: no errors; `pending 0`.
- Full-roster sandbox run (100 iron towers, 180s): `ok towers 100 kills 56 nonfinite 0`.
- A focused 3-wave run per tower, built next to the path, showed these firing:
  - enter procs: Alert, Awareness stacks reaching 20, Valor's Light, Sentry stacks reaching 20
  - Energy Absorb casts
  - Release Energy with the mana drain
  - wooden trap CDR of 0.2 at level 15

## Phase 3

File changed: `src/data/youtd/ports/iron.js` only. Iron pending is still 0.

### Replaced with phase-3 primitives

- **rundown_iron_sentry**: Trespasser armor loss is now a real stacking `armorStack` (3/4/5 armor, +0.1/0.15/0.2 per level, up to 5 stacks, lasts for the creep's life). Stacks are shared by all sentries, as in the original.
- **miner**:
  - Goldrush attack speed now reads the live gold bank. A `towerBuff` `scaleBy: gold` gives 0.2 + 0.01 x (base + sqrt(gold) / divisor). The `TYPICAL_GOLD` constant is removed.
  - Excavation now rolls its real 25% chance every 20s and pays the full 7.5/21/40 gold, rounded to whole coins.
- **ball_lightning_accelerator**: Energy Absorb mana regen now counts towers. It gives +2 mana/s (+0.04 per level) per other tower: a buff scaled by `towers` (towers + 1 shares) plus a fixed -2 share offset buff.
- **solar_collector**: `manaPerAttack { cost }` replaces the drain proc. The tower holds fire when its mana is below the cost, as in the original.
- **marine**: the Frag Grenade stack uses `stackVuln.attacksOnly`. It amplifies attack damage only, which matches the original's attack-damage-received modifier.
- **goblin_stronghold**: Clockwork Engineer and Probability Field go to one random other tower within 500 (`pick: 'random'`, `others`). They no longer buff the stronghold.
- **small_ray_blaster**: Phaze is now a creep mark (`mark.itemChance` / `mark.itemQuality`) that pays off on death. It lasts 5/6s +0.1s per level.
- **bronze_dragon_roost**: Bronzefication now has these parts:
  - a 50% slow for 5s +0.1s per level (`slowDurPerLevel`)
  - a +50% armor raise (negative `armorPct`)
  - a +25% item quality mark, with the same duration
- **particle_accelerator**: the stacks are now exact. Each attack permanently adds damage and attack speed (`growSelf`, v + 0.001 per level, no cap), and a kill wipes both (`resetGrowSelf`). This replaces the 15-stack, 4s refresh model.
- **valor**: "We Will Not Fall" is ported. Every 15s, towers within 400 (not Valor) get damage and spell damage of 0.5% (+0.02% per level) per portal percent lost, through a `towerBuff` scaled by `livesLost`.

### Still approximate

- **ball_lightning Energy Absorb**: `scaleBy: towers` counts every tower on the map, not only those within 1000, so mana regen is too high when towers are spread out. manaMult is still flat 3x (no per-level growth).
- **valor We Will Not Fall**: the scaled buff is base x (1 + lost), so it gives one extra lost percent (+0.5%) at full lives.
- **valor**: Last Line of Defense is still not ported. It needs a second-entry trigger.
- **small_ray_blaster**: a mark has no per-level value. It is one proc per 5-level step (0, 5, ... 25), and the highest unlocked step is applied last. The tooltip therefore lists six Phaze lines.
- **bronze_dragon_roost**:
  - armor raise and item quality stay at their level-0 values (+50% armor, +25% quality) and do not shrink or grow with level. A chance proc cannot be split into level steps without rolling once per step.
  - the HP regen cut is not ported.
- **marks overwrite**: a creep holds only one mark, so Small Ray and Bronze marks replace each other and other towers' bounty marks.
- **particle_accelerator**: the 2s self-stun is still -80% attack speed. Growth carries through upgrades, while the original resets it on upgrade.
- **miner**:
  - Goldrush refreshes when it procs again; the original does not reapply while active.
  - Nuggets still use a flat 45% chance instead of "while Goldrush is active".
  - Gold per level is still dropped.
- **Unchanged from Phase 2**: gatling, burrow, contraption, steam engine, bomb turret, wooden trap, helicopter, glaive, coin machine, rowing boat and xeno.

### Description issue outside this file

`describeEffect` in `src/data/tower-skills.js` prints marks as "marked: +NaN% bounty, attackers may gain experience" when the mark has only `itemChance`/`itemQuality`. The fix belongs in that file, which is not owned here.

### Validation

- `describeAbility` on all iron abilities: no errors; `pending 0`.
- Full-roster sandbox run (180s): `ok towers 100 kills 56 nonfinite 0`.
- Focused runs with towers next to the path confirmed:
  - particle growth accumulates and resets
  - the solar collector holds fire at low mana
  - robot and emitter buffs land on a neighbouring tower
  - Goldrush gives +40% attack speed at 10000 gold
  - Small Ray and Bronze marks reach creeps
  - Bronze raises armor (negative shred)
  - Fragged stacks are attack-only
  - trespasser stacks reach 2x with three sentries
  - Energy Absorb gives +16 net regen with 9 towers
  - We Will Not Fall gives +10.5% at 20 lives lost
