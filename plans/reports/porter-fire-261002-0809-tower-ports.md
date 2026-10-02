# Fire tower ports

Scope: `src/data/youtd/ports/fire.js` only. All 31 fire scripts now have a `PORTS` entry, so the fire element has `pending = 0`. Three were already ported and are unchanged: `small_torch`, `small_fire_sprayer` and `broken_fire_pit`.

## Ported scripts (28 new)

- black_rock_totem -> Fighter Totem: a periodic (13s) radius buff of +10% damage, +5% crit and +0.5 crit damage that scales with level. Demonic Fire autocast: the creep takes +15% fire damage, towers nearby get +10% spell damage, and towers nearby get 2.25% mana.
- area_roaster -> Ignite on every hit: flat spell damage (5 ticks' worth) and +7/14/21% damage taken from fire.
- fiery_dog -> Roar every 4s in combat: towers nearby get +5% damage (scales with level), plus a separate stacking buff (up to 100 stacks) of +lm*0.05% each.
- lesser_elemental_ghost -> Elemental Wrath: self buff of +15% trigger chance on an attack-chance roll. Mimic: 50% on hit for an extra x0.33 attack damage, which matches the original's +17% average damage variance.
- crimson_wyrm -> Flaming Inferno every 9 attacks: three 3750 (+150/lvl) fireballs, modelled as a chainSpell across 3 creeps. Dragon's Hoard: killStack of +0.3% per kill, max +1800%.
- vulshok_the_berserker -> 1/3 crit chance, which stands in for "every 3rd attack crits". Every 7 attacks: +3000 (+200/lvl) attack damage. Every 12 attacks: an AoE cleave with slow. Every 15 attacks: +0.5% permanent damage (stacking buff). Maim: a ramping slow, averaged to 20% (+1.5%/lvl).
- little_phoenix -> Twin Attack (barrage of 1/2/3 extra attacks). Phoenixfire: `shred` engine passive, 0.5/0.6/0.7 armor per stack. Phoenix Explosion: the per-stack eruption damage is dealt on hit as a small AoE.
- the_omnislasher -> Omnislash: every hit applies +40% damage taken (curse) for 60s. In the original, 10 slashes of +4% physical vulnerability stack permanently.
- caged_fire -> Melt: creepAura of -3/-6 armor, plus a 1s pulse of 90/180 flat spell damage (scales with level) in a 900 radius. Both are averaged over about 8s of exposure.
- servant_of_the_twin_flames -> Red and Green Flame (10% each on attack; attack and spell damage at x0.65/0.75 of attack). Twin Pulses every 40 attacks: x0.55/0.75 spell damage in 900. Twin Disciplines: a stacking crit and spell crit self buff, max 10 stacks.
- geothermal_extractor -> aura of +18%/30% damage to towers in its range.
- inflamed_stone -> Spellfire Projectiles: an extra x0.9 attack hit every 4th attack, which approximates the mana-dump crit.
- portal_to_swine_purgatory -> Rampage of Pigs: barrage of pig_count-1 extra attacks per attack (the main attack is the remaining pig). Initiative: a full extra rampage every 4 kills.
- fire_battery -> Incinerate on hit: burn (120/300/800 dps converted to a ratio of base damage) and +5/10/15% fire damage taken for 9s. Battery Overload autocast: chainSpell of 10 x 300/750/1800 (scales with level) at different creeps, with the same ignite.
- fire_star -> Burn!: a follow-up attack hit (x1.25, +4%/lvl) with a 10% slow. Double the Trouble: 12.5% (+0.5%/lvl) for an extra x2.25 hit.
- shaman -> Bloody Experience: aura of +10/15/20% xp. Bloodlust autocast: tower buff of attack speed and crit damage (scales with level, duration 5s +0.12/lvl, can target itself).
- felweed -> Fireblossom: four deterministic counters (every N, N+1, N+2, N+3 hits), each an extra x(bonus-1) attack hit.
- firestorm_cell -> Firestorm: 12-24% on attack, three pulses of flat AoE (300 radius) dealt at once.
- the_furnace -> randomTarget (Uncontrollable Flames). Lingering Flame: 500 (+10/lvl) spell damage on hit. Feed the Flames: +120 mana on kill. Aura of +10% attack speed for fire towers within 350. Intense Heat autocast: 700 (+20/lvl) spell damage to all creeps within 1000.
- cruel_fire -> aura of +5/7.5/10% crit.
- living_volcano -> Lava Attack: 25% on attack, 3500 (+100/lvl) AoE. Heat Stroke: 40% on kill, 4500 (+100/lvl) AoE.
- dragon_sorcerer -> Burning Mark autocast: +7.5% crit and +25% attack speed (scales with level), plus a separate +1 multicrit buff, for 10s (+0.4/lvl).
- embershell_turtle_hatchling -> Overheat: a 75% miss passive, which matches the mana-limited sustained attack rate (1 mana/s regen against 4 attacks/s).
- the_fire_lord -> Hellfire: 25% (+0.2%/lvl) on attack for +4 targets over 7.5s (+0.2/lvl). Liquid Fire on hit: burn (500 dps as a ratio) and +10% fire damage taken for 5s.
- ash_geyser -> Ignite: 30% on hit, burn of 15% of attack damage per second for 8s.
- meteor_totem -> Torture: +8% damage taken for 2.5s on hit. Attraction autocast: 4 meteors (chainSpell, 200 +8/lvl) across creeps in the tower's range.
- burning_watchtower -> Burn on hit: +X% damage taken from fire, sized from the flat per-hit ramp at about 10 stacks and capped at 30%. Burn Out: an explosion on kill (49/277/750/1875 AoE 200).
- fenced_flames -> Embers: every 1s in combat, spell damage (x0.08-0.16, scales with level) to every creep in range.

## Approximations (beyond the per-line notes above)

- Several abilities in the originals are stacking flat DoTs: area_roaster, the_furnace, firestorm_cell, and the caged_fire ramp. These are front-loaded as flat spell damage on hit, at about half of a stack's lifetime.
- Flat-dps debuffs (fire_battery, the_fire_lord) became `burn` ratios of base average damage. They therefore scale with this game's level damage curve instead of +X per level.
- Two buffs are centered on the tower and fire from attack or hit procs: black_rock_totem's Fighter Totem and fiery_dog's Roar. They became periodic procs, because effects with a `radius` center on the proc target, which is the creep.
- Wherever randomness depends on crit chance (Twin Flames), or on bounty and gold (Dragon's Hoard), fixed chances or rates are used. The hoard's gold cost to the player is not modelled.
- Omnislash and Torture use `curse`, which affects all damage. The originals only amplify physical attack damage (Omnislash) or non-spell hits of 500 or more (Torture).
- Furnace's Flames of the Forge shares 50%+ of the Furnace's own bonuses with common/uncommon fire towers. It is modelled as a flat +10% attack speed fire aura with no rarity filter.
- Aura values are static: the engine's `aura` has no per-level growth, so base tier values are used.

## Skipped sub-mechanics (the script is ported, the part is dropped)

- little_phoenix "Eruption" autocast (manual early detonation of Phoenixfire stacks). Also dropped: the permanent partial armor loss after the stacks expire.
- living_volcano "Heat Aura" (creeps in 700 lose 3% of current HP per second). No percent-HP primitive exists.
- inflamed_stone "Spellfire" (converts spell damage, spell crit and spell crit damage into attack damage, crit and crit damage).
- ash_geyser HP regen reduction, which is only meaningful for `regen` creeps.
- the_furnace mana-scaled damage, the crit buff from Intense Heat, and gaining mana per attack.
- shaman Bloody Experience level cap and crit trigger.

No script was skipped entirely.

## Missing engine primitives (proposals)

1. **`dotFlat` rider / `stackDot` effect.** Fields: `{ dps, dpsPerLevel, dur, durPerLevel, stacking: 'add'|'max', maxStacks, tick }`. It adds a per-source flat spell DoT. With `'add'`, each application adds `dps` to the existing instance and refreshes its duration. This would make the area_roaster, furnace, firestorm, fire_battery, fire_lord and caged_fire ports exact.
2. **`towerBuff.center: 'self'`.** For hit, attack and kill procs, a radius towerBuff centers on the casting tower, not on the creep. This would make Fighter Totem and Roar exact as on-attack and on-hit procs.
3. **`stackVuln` rider.** Fields: `{ vulnStack: { el?|attackType?, pct, max }, debuffDur }`. It is an additive per-hit vulnerability that stacks per source, filtered by element or attack type (for example `physical`). It covers Omnislash, Demonic Fire, Burning Watchtower and Phoenixfire's stacking armor.
4. **`pctHp` effect / creepAura field.** Fields: `{ kind: 'pctHp', pct, current: true }`, or `creepAura.hpPctPerSec`. It deals a percentage of current HP, with a boss multiplier. Needed for Living Volcano's Heat Aura.
5. **`manaPerAttack` passive.** Fields: `{ type: 'manaPerAttack', cost, gain, gainPct }`. An attack is skipped when mana < cost, and attacks can also add mana (Furnace +1%). This makes Embershell's Overheat and the Furnace's mana loop exact.
6. **`auraLevel` fields on `aura`.** Fields: `valuePerLevel` and `rarity: [...]`, applied in recalcAll using the source tower's level. Needed for the Geothermal, Cruel Fire and Furnace (common/uncommon only) auras.
7. **Proc conditions `crit` and `spellCrit`, plus `chanceFrom: 'crit'|'spellCrit'`.** These let procs fire on critical hits, or use the tower's crit chance as the proc chance (Twin Flames, Twin Disciplines, Bloody Experience).
8. **`onDeathInRadius` trigger (`on: 'creepDeath'` with `radius`).** It fires when any creep dies within an aura (Heat Stroke, Burning Watchtower's explosion by any killer).
9. **`spawnRandom` targeting for spells.** `{ kind: 'spellDamage', targets: 'random', count, radius }`. It fires N independent AoE hits on random creeps in range: Crimson Wyrm's fireballs and Meteor Totem's meteors keep their splash this way.
10. **`statConvert` passive.** `{ from: 'spell', to: 'damage', ratio, ratioPerLevel }`. Needed for Inflamed Stone's Spellfire.

## Description/formatting issues found (not editable from fire.js)

- `fmtMod` in `src/data/tower-skills.js` shows `multishot` as a percent ("+400% multishot"; Fire Lord's Hellfire).
- `fmtMod` shows sub-1% mods as "+0%" (Fiery Dog's Roar stacks, 0.3%).
- `describeAbility` for `aura` prints the raw stat key (`attackSpeed`, `xp`).
- `describeSkill` says "Every Nth attack" for `every` procs on `hit` and `kill` too (Felweed, Initiative), and gives "12nd" as an ordinal.

## Validation

- The `fire pending` check prints 0, and `describeAbility` runs on every fire ability without errors.
- The headless sim command runs without exceptions. However, `game.build` now rejects tiers above 1 ("Build the first tier, then upgrade it"), so that command only builds 6 towers.
- Supplementary check (scratchpad `fire-force.mjs`): builds all 106 fire towers by building tier 1 and then upgrading. It force-applies every active and proc effect at level 12 against a live creep, then runs 60s of simulation. No exceptions, no NaN tower stats or creep HP.

## Unresolved questions

- Should the shared validation command be updated to build tier 1 and then upgrade, now that direct higher-tier builds are rejected?

## Phase 2

This phase reworked `src/data/youtd/ports/fire.js` only, using the new engine primitives. Fire `pending` is still 0. Both validation commands pass: 106 towers, nonfinite 0. The force-apply check (`scratchpad/fire-force.mjs`) also passes.

### Now exact, or matching in expectation

- **black_rock_totem.** Fighter Totem is now a 15% (+0.2%/lvl) on-attack proc centered on the totem (`center: 'self'`). Shamanic Totem is now a 30% (+0.4%/lvl) `cast` proc: it gives towers around the totem the spell buff and 7.5% mana.
- **area_roaster, the_furnace (Lingering Flame), fire_battery (Incinerate), the_fire_lord (Liquid Fire), caged_fire (Melt).** All now use real flat spell DoTs (`dot` rider). Stacking ones (roaster, furnace, caged fire) add a stack per hit or per second, so damage ramps the way the originals do.
- **fiery_dog.** Roar is now a 30% on-hit proc centered on the dog.
- **crimson_wyrm.** Fireballs are now `bolts` on random creeps in range (950), with a 250 splash, and a 4th fireball from level 10. Dragon's Hoard is now `growSelf` on both damage and spell damage (cap +1800%), so it is kept on upgrade.
- **vulshok_the_berserker.** Grow is now a permanent `growSelf` (+0.5% damage every 15 attacks). The Maim/Cleave slow growth is corrected to +2%/lvl.
- **little_phoenix.** The extra phoenix from level 15 is now in. Eruption damage now scales with the tower's damage multiplier (`mult`) rather than being flat.
- **the_omnislasher.** Now a permanent stacking vulnerability (`stackVuln`, physical attackers only, +40% per attack = 10 slashes x 4%).
- **servant_of_the_twin_flames.** Green Flame and Twin Disciplines now trigger on crits. Green Pulse now fires on 1 in 8 crits. Red and green pulses are now separate.
- **geothermal_extractor, cruel_fire.** Auras now grow per level (`valuePerLevel`).
- **inflamed_stone.** The mana crit is now exact. Above 20 mana, a hit spends all of its mana (`manaCost` + `spendMana`). The bonus is 0.5 + 0.08/0.09/0.10 per mana above the threshold (`scaleBy: mana`).
- **portal_to_swine_purgatory.** Pig counts are now 2/3/3, plus 1 at level 5 and 1 at level 15. Each pig also splashes 15% (+0.4%/lvl) as spell damage. Initiative now fires on creeps entering range as well as on kills.
- **fire_battery.** Overload now releases one fireball per 10 mana (`bolts` + `scaleBy: mana` + `spendMana`), and each fireball ignites.
- **fire_star.** Slow corrected to 5% (+1%/lvl). Double the Trouble corrected to one extra x1 hit.
- **shaman, dragon_sorcerer.** Buffs are split per stat, so each stat has its exact per-level growth.
- **the_furnace.** Now gains +1% mana per attack. Kills add +10 max mana permanently (`growSelf manaFlat`) and +4% mana. Intense Heat deals (7 + 0.2/lvl) x mana to all creeps in range, adds a Lingering Flame stack, and spends all mana. The aura is now limited to common/uncommon fire towers.
- **living_volcano.** Heat Aura is now in: 3% of current HP per second, bosses included (`pctHp`). Heat Stroke now fires on any creep death in range (`death`).
- **meteor_totem.** Meteors are now `bolts` with a 220 splash on random creeps within 1000, with +1 meteor every 5 levels (`cast` procs with `minLevel`). Torture now grows per level.
- **burning_watchtower.** Burn is now a ramping stacking fire vulnerability (one stack per hit, per-level growth, duration 5s + 0.12s/lvl). Burn Out now fires on any creep death in range.

### Still approximate

- **Proc chance from the tower's crit stat.** Red Flame chance is still a fixed 10%, because no `chanceFrom: spellCrit` exists.
- **Fixed-attack `every` counters.** These ignore the level-based reductions: Crimson Wyrm uses 9 attacks (the original is 8-12, then 7-11 and 6-10 at high level), and Twin Flames pulses use 8 flames (the original drops to 7 and 6). The level-10 4th fireball has its own counter, so it can fire out of step with the main volley.
- **Initiative weighting.** Creep size is ignored (1 in 8 per event, which matches normal creeps).
- **Demonic Fire.** Modelled as about 3 permanent fire-vulnerability stacks per brand. There is no "on damaged while debuffed" hook, and the boss-specific value is not used.
- **Phoenixfire.** Still a fixed `shred` per stack, with no per-level growth. The eruption is dealt per hit rather than on expiry. The permanent armor loss and the Eruption autocast are dropped.
- **Caged Fire armor ramp.** Still a static creepAura averaged over about 4s; the `armor` rider cannot stack.
- **Fire Star burn.** Still a per-hit x1.25 attack hit (about 5 stacks); there is no stack-count scaling.
- **Firestorm.** Pulses are still dealt at once, which gives the same total because leftover stacks burst on death.
- **Furnace.**
  - The Flames of the Forge share is a fixed +10% attack speed. The original shares a fraction of the Furnace's own item and buff bonuses, which is 0 without them.
  - The Intense Heat crit buff is a fixed +5%, equal to half a pool.
  - The mana gain from burn ticks is a hit proc estimate.
- **Fire Lord Hellfire.** Still +4 targets, without the +1 at level 15 and +1 at level 25, because `towerBuff` has no level-gated mods.
- **Burning Watchtower.** The flat per-hit bonus is expressed as a percentage of its own base damage, capped at 30 stacks. Other fire towers' hits do not add stacks. Bigger fire towers are amplified by percent, not by a flat amount.
- **Omnislasher.** The vulnerability also amplifies spell damage from physical towers (there is no `attackOnly` filter). The 250-stack cap keeps values finite; the original is unbounded.
- **Meteor Totem Torture.** Still `curse`, which applies to all damage, instead of an echo of attack hits of 500 or more.
- **Not portable yet.** Embershell's mana-gated attacks (no attack-gating primitive). Inflamed Stone's Spellfire stat conversion. Shaman's crit-to-experience aura (still +xp%). Ash Geyser's per-level ignite growth and regen cut. Fenced Flames depending on a nearby common tower's damage. Crimson Wyrm's gold cost for the hoard.
- **Descriptions.** `describeSkill` prints "undefined" for `every` procs on `enter`/`crit`. To avoid this, the ports use equivalent chances (1/8).
