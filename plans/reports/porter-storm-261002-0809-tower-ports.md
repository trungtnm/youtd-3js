# Storm tower ports (porter-storm)

File changed: `src/data/youtd/ports/storm.js` (only).
Result: 28 of 31 storm scripts ported (2 kept from before, 26 new). 3 skipped.
Storm towers still pending: 6 (the families of the 3 skipped scripts).

Validation:
- Description check: no exceptions, `storm pending 6`.
- Required headless sim: no exceptions (`ok towers 5 kills 40`). The given command builds only 5 towers because the default mode needs a draft.
- Extra harness (scratchpad `storm-sim.mjs`): all 98 storm towers built in a sandbox mode at level 25 and run for 7 waves. Every proc and active effect was also applied directly with a creep target and with a tower target (180 calls). No exceptions and no NaN stats or creep HP.

## Ported scripts

- `broken_lightning_rod`: kept as it was (single-target bolt autocast).
- `rotted_flashing_grave`: kept as it was (random target).
- `charged_obelisk`: every attack deals 1000 (+40/lvl) spell damage, plus a 0.2s stun on non-boss creeps. The Charge autocast gives a tower +50% attack speed (+1.1%/lvl) for 10s.
- `phantom`: the Wind Shear autocast gives a nearby tower attack speed for 5s (+0.1s/lvl), using per-tier values. A 25% on-attack chain lightning hits 3 creeps with 25% falloff.
- `spell_collector`: 20% (+0.8%/lvl) on attack, a missile volley deals 3x missile damage.
- `storm_focus`: the Freezing Gust autocast gives a tower +10% damage vs air and +10% damage for 5s. Both grow 8% per level.
- `harpy_witch`: Twister (8/12% +lvl on attack) fires 2/3 extra attacks, and the target takes +10/18% damage from storm towers for 5s. The Sparks autocast gives a tower spell damage and spell crit, with a duration that grows with level.
- `gryphon_rider`: Storm Bolt hits creeps within 2.7 of the target for 0.6x attack damage (+2%/lvl). The Hammer Fall autocast deals 1.5x attack damage as spell damage within 6.4 and stuns for 1s.
- `lightning_eye`: the Glare autocast costs 40 mana with a cooldown equal to the attack cooldown. It forks to 3 creeps for 500 (+120/lvl) each.
- `zealot`: Zeal stacks +2/4/6/8% attack speed per attack (max 5 stacks, 2.5s). Phase Blade is an engine `shred` passive that removes 0.4–1.6 armor per hit, up to 5 stacks.
- `zeus`: each hit deals 500 (+20/lvl) spell damage in a 175 radius. Each kill restores 5% mana. The Thunderstorm autocast chains 20 bolts of 2500 (+125/lvl) with a 0.5s stun.
- `ancient_energy_converter`: the Energy Conversion autocast fires a 12-creep bolt for 4500 (+225/lvl) each, then a 4-creep chain lightning of 1500 (+75/lvl) with a 0.8s stun.
- `scales`: Overcharge is 25% (+1%/lvl) on hit for 900 (+36/lvl). Electrify is 20% (+0.8%/lvl) on hit for 4500 (+180/lvl) in a 225 radius. The Lightmare autocast chains to 10 creeps for 11700 (+468/lvl).
- `stormy_dog`: 30% on hit, towers within 420 gain +5% attack speed for 5s, scaled per level by the tier's buff scale.
- `cloud_warrior`: every main-target hit adds a lightning strike that deals flat attack damage per tier (100 to 3750, +5% of base per level).
- `red_ball_lightning`: an engine aura gives +20/35% spell damage within 250. 30% (+0.5%/lvl) on hit deals 1200/3500 spell damage.
- `chaining_storm`: Strong Wind is a 1s pulse in a 900 radius. It deals 2x attack damage (+5%/lvl) and slows 30%. Each kill restores 35 mana. The Chaining Storm autocast costs 100 mana and deals area spell damage of 800 (+260/lvl).
- `broken_circle_of_wind`: on attack, at the tier's chance, a non-boss target is stunned for 0.5–1s, and attack damage is dealt within a 300 radius.
- `gnoll_thunder_mage`: the Thunder Shock autocast deals base damage + 8 x per-tower damage. A second jump deals 25% damage, which stands in for the recast chance.
- `green_lightning`: Mana Feed gives +4 mana per attack. Lightning Burst is 12.5% (+0.5%/lvl) on hit for 40 x the tier's mana multiplier. The Surge autocast gives the tower +100/150/200/250% attack speed for 4s.
- `storm_battery`: every hit electrifies the creep for 9s (+8/16/24% damage taken, through `curse`). The Battery Overload autocast spends the whole pool of mana on (mana+100)/10 chained missiles, which also electrify.
- `lightning_generator`: every hit deals tier flat spell damage (+2%/lvl). 19.5% (+0.25%/lvl) on hit is a 3-creep chain lightning.
- `tiny_storm_lantern`: 20% (+1%/lvl) on attack fires 2–5 extra attacks at random creeps.
- `the_conduit`: 10% (+0.2%/lvl) on hit restores 50 mana. The Unleash autocast deals 12000 (+240/lvl) spell damage and gives the tower +0.75 spell crit damage for 3s.
- `prince_of_lightning`: Lightning Strike is 15/20% (+0.4%/lvl) for 2000/4000 (+100/200 per level). A 1s pulse makes creeps within 1300 take +10/15% damage from storm towers.
- `arcane_storm`: each attack fires 2 extra attacks at 1.3x and gives +3 multicrit for 2s. Surge is 5% on hit, a 4-creep spell chain for 2x attack damage. On kill, attack damage is dealt within 500.
- `storm_coil`: each hit adds 1.8x attack damage and a 15% slow for 1.5s. A 1s pulse makes creeps within 1000 take +10% damage from storm towers. The Magnetic Surge autocast deals about 16000 (+2%/lvl) spell damage.
- `lightning_totem`: a 1s pulse gives towers within 500 +10/15/20% spell crit for 2s, plus a per-level bonus.

## Approximations

- **Random targets.** Several scripts strike random creeps: charged_obelisk, harpy twister, zeus, battery missiles, lantern. Attack procs use the attacked creep. Multi-bolt spells use `chainSpell` with `falloff: 0` and a large `jump`, so they hit distinct creeps with no repeats.
- **Effects over time condensed into one burst.** Zeus Thunderstorm (20 bolts over 4s), Ancient Energy Converter orbs (12s), Scales Lightmare (10s at 3 casts/s), Storm Battery missiles and Scales Electrify (5s debuff ticks) all hit at once. Totals were matched where the count was known.
- **Damage that depends on runtime state uses a fixed assumption:**
  - gnoll: 8 towers
  - conduit: wave 30
  - green_lightning: 40 mana
  - chaining_storm: about 4 creeps in a 350 radius
  - spell_collector: 3 missiles
  - storm_coil: 500 range
  - Magnetic Surge: about 200 units/s of movement
- **Auras that the engine aura does not support** (spell crit, vulnerability to an element, auras on creeps that grow with level) are periodic 1s pulses. They apply a 1.5–2s `towerBuff` or `debuff`. lightning_totem's aura also reaches the totem itself, which the original does not.
- **Buffs that grow with stacks** (stormy_dog stacks, charged_obelisk growth over time, zealot drain from neighbours) use their average or their first-stack value.
- **phantom.** The chain lightning comes from the Phantom itself, not from the buffed tower. The 4-target version at level 20+ is dropped.
- **storm_focus.** The Gust aura converts damage vs air into general damage. It is folded into the autocast as a flat +10% damage bonus. The original's level scaling is quadratic, and the port's is linear.
- **gryphon_rider.** The trailing line of damage is approximated as splash within 2.7, and the split between spell and physical damage is dropped. Upstream Hammer Fall uses an uninitialized `user_real`, so it deals 0 damage. The port uses 1.5x attack damage, which reads as the intended bonus for nearby storm towers (capped at 2x). The -10% damage penalty on those storm towers is dropped.
- **storm_battery.** The upstream damage-taken branch looks inverted. The port uses expected value: a 20% chance of +40/80/120% becomes a flat +8/16/24% through `curse`.
- **Dropped details:**
  - lightning_eye: the bonus of 1.5% of the creep's HP, and the Static Field aura (x1.2 vs immune creeps)
  - scales: the hp > 40.5% condition on Overcharge, and I Scale (growth per wave)
  - charged_obelisk: the spell crit bonus
  - red_ball: the crit ratio
  - zealot: the Lightning Shield (debuff duration on towers has no meaning here)
  - chaining_storm: the tiny vulnerability per creep count, and the Storm Power chance growth
  - arcane_storm: the damage multiplier from mana on the main hit, and the attraction stack bookkeeping
  - the_conduit: the aura that shares stats (it copies the conduit's bonus stats)
- **Spell vs attack damage.** chaining_storm Strong Wind uses quiet spell damage instead of attack damage, to avoid a full-radius flash every second.

## Skipped scripts

- `ruined_wind_tower`: its only behavior is a penalty that returns every held item not of the tier's rarity to the stash on each attack. There is no primitive for dropping items. Porting it as a no-op would make the tower strictly better than the original.
- `cloudy_temple_of_absorption`: overkill damage on any creep within 1000 feeds a 10000-mana pool. A storm then deals damage of mana x (0.5 + 0.02/lvl) and drains mana in proportion to the damage. Neither the overkill income nor damage that scales with mana exists, and inventing a mana income would not be faithful.
- `dimensional_flux_collector`: the tower links to another tower and fires 25% (+1%/lvl) of that tower's measured spell DPS as attack damage. There is no tracking of damage per tower or link primitive.

## Missing engine primitives (proposals)

1. **`overkillMana` aura (passive):** `{ type: 'overkillMana', radius, mult, multPerLevel }`. When any creep within `radius` dies, the excess damage x (mult + multPerLevel x level) is added to this tower's mana. Hook: `game.kill` has the final hit amount. Needed by cloudy_temple.
2. **`scaleBy` on effects:** `{ ..., scaleBy: { source: 'mana' | 'towers' | 'wave' | 'creepsInRadius' | 'targetHp', per, radius? } }`. Multiplies `base` in `applyEffect` by the runtime quantity. Examples: green_lightning (damage = mana x k), gnoll (towers), conduit (wave), chaining_storm (creep count), lightning_eye (1.5% of target HP), cloudy_temple.
3. **`spendMana` on procs:** `{ type: 'proc', manaCost, ... }`. Skips the proc when mana < cost and subtracts the cost when it fires. Makes lightning_eye and chaining_storm exact procs on attack, instead of autocasts.
4. **`bolts` effect:** `{ kind: 'bolts', count, interval, flat, flatPerLevel, range, stun, bossStunChance }`. Schedules `count` strikes on random creeps in range every `interval` through `game.delayed`. Covers zeus, battery overload, scales lightmare and the AEC orbs, all without condensing them into one burst.
5. **Flat damage in `zone`:** honour `flat`/`flatPerLevel` in the `zone` kind (it currently uses only `mult`). Needed for DOT fields like scales Electrify and storm_coil Magnetic Surge.
6. **Effects that grant procs:** `towerBuff` with `procs: [proc]`, which runs while the buff is active (merged into `runProcs` sources). Makes phantom Wind Shear exact (the buffed tower casts the chain).
7. **More aura stats:** add `spellCrit`, `spellCritMult`, `trigger` and `vsAir` to `auraMods` (recalcAll and computeStats), and `perLevel` on `aura`. This replaces the workaround with periodic towerBuffs (lightning_totem), and gives red_ball/prince level scaling.
8. **`creepAura` riders:** let `creepAura` carry `vulnElement`, `vulnSpell` and `curse`, and filter attackers by `element`. This covers prince_of_lightning and storm_coil Energetic Field without periodic pulses. It also lets lightning_eye's "x1.2 vs immune" work as `vsWarded`.
9. **`rampStacks` debuff:** `{ kind: 'debuff', slowStack, maxStacks, dmgPerStack }`, a slow that gains a stack every second the creep stays in the aura. Needed for chaining_storm Strong Wind.
10. **`distanceScale` on hit effects:** `{ distanceScale: { per, from: 'tower' | 'castPoint' } }`. Multiplies damage and slow by the distance. Needed for storm_coil Overload and Magnetic Surge.
11. **Tower stat growth:** a `grow` variant for towers, such as `{ type: 'waveGrowth', mods: { spell, spellCritMult, spellCrit } }` per wave since the tower was built. Needed for scales I Scale.
12. **Item rules:** `{ type: 'itemRarityLock', rarity }`. On attack, any held item of another rarity goes back to the stash. Needed for ruined_wind_tower.
13. **Damage tracking per tower and links:** record spell damage per source tower, plus an autocast that targets an allied tower and stores the link (`{ kind: 'link' }`). Needed for dimensional_flux_collector.
14. **More `CONDITIONS`:** `healthy` (hp > 40.5%) for the scales Overcharge cap, and `notAirNotBoss` / a list of sizes (`sizes: [...]` on procs) for broken_circle_of_wind (mass, normal, champion).

## Unresolved questions

- The storm_battery Electrify branch looks inverted upstream (damage x0.4 on a failed roll). The port assumes the intent was a 20% chance for bonus damage.
- Upstream gryphon_rider Hammer Fall deals 0 damage. Confirm whether to keep the 1.5x attack damage interpretation.

## Phase 2

File changed: `src/data/youtd/ports/storm.js` (only). Storm towers still pending: 6 (same 3 skipped scripts).

Validation:
- Description check: no exceptions, `pending 6`.
- Full-roster sandbox run: `ok towers 98 kills 56 nonfinite 0`.
- Extra harness (scratchpad `p2b.mjs`): 98 storm towers at max level, creeps with 10000x HP, 6 waves. Every proc effect was applied directly and every autocast was force-cast each frame (3071 calls). No exceptions, no non-finite creep HP, tower stats or mana. `chk.mjs` confirmed that the Charge buff grows +5% per second and expires at 10 s.

### Now exact (or exact in expectation)

- **Real auras instead of pulses.** lightning_totem uses a spell-crit aura, +0.2% per level, excluding itself. red_ball_lightning's spell aura gains +0.4/0.6% per level.
- **Random targets and streams over time (`bolts`):**
  - charged_obelisk zaps a random creep within 1000 on every attack. The stun skips bosses (`bossStunMult: 0`).
  - zeus Thunderstorm: 20 bolts over 4 s within 1200.
  - harpy twisters: N attack-damage strikes on random creeps.
  - Storm Battery: 20 missiles at 5 per second, spending all mana.
  - scales Lightmare: 90 strikes over 10 s within 1500.
  - Ancient Energy Converter: 36 orb zaps over 12 s, plus 9 stunning bursts (the 25% chain chance).
  - lightning_eye: target plus 2 random creeps.
  - tiny_storm_lantern: shots 0.2 s apart.
- **Mana-gated procs (`manaCost`).** lightning_eye Glare (40 mana) and chaining_storm Chaining Storm (100 mana) are now on-attack procs with their real chances, not autocasts.
- **Runtime scaling (`scaleBy`, `manaMult`, `pctHp`):**
  - gnoll damage is (base) x (1 + 0.3 per tower), which matches 435/1450 exactly.
  - green_lightning Burst is current mana x 15/25/35/45.
  - the_conduit Unleash is (400 + 8/lvl) x waves. It is one wave high, because `scaleBy` gives 1 + wave.
  - lightning_eye adds 1.5% of the target's current health, with no boss reduction (as upstream).
  - gryphon Hammer Fall gets +5% per storm tower.
- **Level-gated extra casts.** gnoll recasts (1/2/3 at level 0/15/25) and lantern extra shots (+1 at 15, +1 at 25) use extra procs with `minLevel` and the same chance. The expected count matches; the rolls are independent.
- **Per-level values that were missing or linearized:**
  - harpy Sparks: spell damage and spell crit each have their own per-level rate (two buffs).
  - harpy Twister: storm vulnerability +0.4/0.7% per level, through `stackVuln` with an element.
  - prince Realm: +0.2/0.4% per level.
  - storm_coil Energetic Field: +0.3% per level.
  - storm_battery: electrify duration +0.3 s per level, plus a per-level curse.
  - storm_focus: duration +0.05 s per level.
- **Charge (charged_obelisk).** Starts at +25% (+0.6%/lvl) and grows +5% (+0.1%/lvl) each second through 9 delayed stacking buffs that all expire at 10 s. This replaces the average.
- **stormy_dog.** Stacking roar (up to 99 extra stacks of +0.0005 x scale each) on top of the base buff, centred on the dog.
- **Triggers and filters:**
  - chaining_storm gains 35 mana when any creep dies in range (`death`).
  - arcane_storm Attraction triggers on any death in range.
  - broken_circle uses `sizes: [mass, normal, champion]`, and the area damage lands when the cyclone ends (`delay`).
  - scales Overcharge needs > 40.5% health (`hpAbove`).
  - cloud_warrior strike is delayed 0.4 s.
- **The_conduit Unleash.** The spell-crit-damage buff now reaches every tower within 350 of the conduit (`towerBuff center:'self'`).
- **gryphon_rider:**
  - The bolt re-hits its target at full damage (85 radius), then the 0.6x (+1.2%/lvl) line follows 0.15 s later.
  - Hammer Fall applies the upstream -10% damage for 6 s to storm towers within 2500.
- **storm_coil Magnetic Surge.** Now a 4 s flat DoT (4000 dps, +2%/lvl) instead of an instant burst.
- **scales Electrify.** Now a 5 s field ticking 900 (+36/lvl) each second, instead of a 4500 burst.
- **green_lightning:**
  - Surge lasts about 5 (+1 per 5 levels) attacks at the boosted speed.
  - The spell crit build-up is a self aura equal to the average build-up a burst finds: per-attack crit / burst chance, which is linear from 0.4/0.6/0.8/1.0 down by 1%/lvl. That is exact at levels 0 and 25 and within about 5% between.

### Still approximate

- **Folded level growth.** Zeus (+1 bolt per 5 levels) and Ancient Energy Converter (+1 orb per 5 levels) fold the extra bolts and orbs into per-level damage: +170 and +250 per level, fitted to levels 0–25. The bolt count stays fixed. Zeus's boss stun (20% chance) uses expected value: 0.2x duration.
- **Typical runtime state is still assumed:**
  - spell_collector: 3 missiles. There is no "spells cast nearby" counter.
  - chaining_storm: 4 creeps near the target. `creepsInRange` counts the whole tower range.
  - storm_coil: 500 range for Overload and walking speed for the Surge. There is no distance scaling.
  - arcane_storm: about 8 mana back per hit from attraction stacks, and about 2 stacks per neighbour on death. The main-hit +1%/mana bonus and the extra attack per (75 - lvl) mana are dropped. Extra attacks do scale with spent mana.
  - zealot: 2 qualifying neighbours. There is no tower-count-in-radius or gold-cost filter, so the drain on neighbours is also dropped.
- **Ramping effects use flat values.** chaining_storm Strong Wind (slow ramping to 45% over 15 s) is a creep-aura slow of 30% (+0.8%/lvl). Its damage stays a 1 s pulse at 2x attack damage (+5%/lvl). Storm Power growth is dropped.
- **Pulses kept on purpose.** prince Realm and storm_coil Energetic Field remain 1 s pulses using `stackVuln`, because `creepAura.vulnElement` has no per-level value. Moving to `creepAura` would lose 33–50% of the bonus at level 25.
- **Overcharge repeats.** scales Overcharge repeats with falling odds; this is a second independent proc (5% +1.2%/lvl), a linear fit of the expected extra hits. Lightmare strikes do not trigger Overcharge. Electrify is centred on the hit creep (upstream centres it on the tower, which looks unintended). I Scale (per-wave growth) is still dropped, because there is no once-per-wave trigger.
- **Phantom.** The chain still comes from the Phantom, not the buffed tower, and the 4-target version at level 20+ is dropped. There is no `towerBuff` that grants procs and no maximum-level filter.
- **storm_focus.** Damage vs air for towers with other air bonuses is not converted. The damage half uses a linear fit of the quadratic level growth.
- **Gryphon line.** The line is still splash within 2.7, and the spell/physical split is dropped. Hammer Fall's base (attack damage) is an interpretation, since upstream deals 0. The 2x cap on the storm-tower bonus is not enforced.
- **storm_battery.** Missile count is fixed at 20, which is what a cast at 100 mana gives upstream. The inverted upstream roll is still read as a 20% chance for bonus damage.
- **Still dropped:**
  - lightning_eye Static Field (x1.2 vs immune creeps)
  - red_ball crit ratio
  - charged_obelisk extra spell crit
  - zealot Lightning Shield
  - the_conduit aura that shares stats, its zero attack damage (no primitive) and +1 mana/lvl on Absorb
  - chaining_storm's tiny vulnerability per creep count
  - lightning_generator stays as before

### Still skipped (no faithful primitive)

- `ruined_wind_tower`: needs item ejection by rarity.
- `cloudy_temple_of_absorption`: `death` procs do not carry the overkill amount, so there is no overkill-to-mana income.
- `dimensional_flux_collector`: needs per-tower spell-damage tracking and a tower link.

### Primitives that would close the remaining gaps

- `death`/`kill` context with `overkill`.
- `creepAura.vulnElement.pctPerLevel`.
- A `maxLevel` proc filter.
- `towerBuff.procs`.
- A once-per-wave trigger.
- `scaleBy` kinds `creepsNearTarget` and `distance`.
- A bolts `countPerLevel`.
- An item-rarity lock.
- Damage tracking per tower with links.

## Phase 3

File changed: `src/data/youtd/ports/storm.js` (only). All 31 storm scripts are now ported. Storm towers pending: 0.

Validation:
- Description check: no exceptions, `pending 0`.
- Full-roster sandbox run: `ok towers 98 kills 56 nonfinite 0`. A 12-wave run of the roster, with the link cast, also had no non-finite stats or mana.
- Scratch tests (scratchpad `p3-storm.mjs`, `p3-temple.mjs`):
  - Link: the cast links the strongest ally, and its 5000 spell damage is banked (attack damage is not). Nothing is released before 10 s. After 10 s, a level-60 collector releases 85% of the bank as one energy hit (3745 after armor), and the bank empties.
  - Temple overkill: another tower's kill with 2000 overkill gives +8000 mana at level 60 (x4). The temple's own kill gives 0, and the next frame pays out again.
  - Temple storm: the first bolt at 20000 mana and level 60 deals 34000 (mana x 1.7). On a creep that cannot die, it drains to about 800 mana in 4 s and stops.
  - Rarity lock: a common item equips on the tier-1 tower and an uncommon one is rejected. After the upgrade to tier 2 (uncommon), the common item is back in the stash.

### New ports

- `ruined_wind_tower`: `itemRarityLock` per tier (common, uncommon, rare, unique). Upstream ejects items of other rarities on each attack. The lock rejects them on equip and returns them on upgrade, so the tower ends up holding the same items.
- `cloudy_temple_of_absorption`:
  - Cloud of Absorption: a `death` proc turns overkill into mana, x1 at level 0.
  - Cloudy Thunderstorm: a periodic proc (0.4 s, `manaAbove: 1000`) fires a bolt at a random creep within 1000 for mana x (0.5 + 0.02/lvl). The damage uses `flat: 0.5, flatPerLevel: 0.02, scaleBy: mana x1`, which is (0.5 + 0.02 L) x (1 + mana) and so exact to within one point of mana.
- `dimensional_flux_collector`:
  - The `attackOverride` passive makes its damage energy.
  - The Dimensional Link active uses the `link` effect and targets the strongest ally within 800.
  - Dimensional Flux is a periodic proc (1 s) that fires a `bolts` attack at a random creep within 800. It deals `fromLinked` x bank after `linkAfter: 10`.

### Phase-2 approximations replaced

- the_conduit Absorb Energy now restores +1 mana per level (`amountPerLevel`).
- lightning_generator Chain Lightning now triggers on attack, as upstream (it was on hit).

### Approximations in the new ports

- **Level scaling in steps.** `fromOverkill` and `fromLinked` have no per-level field. Both use one proc per level step, listed highest first. The procs share a `key` and a cooldown, so only the highest unlocked step fires.
  - Temple: x1, then +0.5 at levels 5, 15, 25 and so on. This stays within 0.25 of the exact 1 + 0.05/lvl.
  - Collector: 25%, then 35% at level 5, 45% at 15, and so on up to 85% at 55. This stays within 5 points of the exact 25% + 1%/lvl.
  - Each step shows as its own line in the tooltip.
- **Temple storm drain.** Upstream drains mana by (damage taken)² / health x a size factor. The port spends a fixed 30% of the current mana per bolt.
- **Temple storm trigger.** Upstream charges to full mana, or uses a manual cast, then unloads until 1000. The port fires whenever mana is above 1000. Because the drain is proportional, total damage per mana is the same. Only the timing differs. The two manual actives (Thunderstorm and Adjust Threshold) are dropped.
- **Temple income from its own kills.** Upstream ignores creeps hit by the storm. Without that rule the storm feeds itself: in testing, its overkill on weak creeps refilled more mana than each bolt spent. The port ignores every kill the temple makes:
  - A `kill` proc sets the shared absorb key for 0.001 s, so the death proc that follows is skipped.
  - Upstream's income from the temple's own attack kills is also lost. That income is small.
  - The 0.001 s cooldown also skips other deaths in range in the same frame. A 25-wave run had no same-frame deaths in range.
- **Ranges.** Overkill is collected within the tower's 900 range, not the aura's 1000, because `deathRange` is not configurable. Banked damage counts all spell damage from the linked ally, not only damage to creeps within 2150.
- **Collector details:**
  - The bank is released once per second, not once per attack. Bonus attack speed does not speed it up.
  - The hit cannot crit (upstream uses multicrit).
  - If no creep is within 800 when the proc fires, that second's bank is lost.
  - Before the link is ready, it fires a 0-damage bolt.
- **Link is cast manually (`auto: false`).** The link effect resets the bank and link timer on every cast. An auto-cast (cooldown 1 s) would relink every second and never fire. Upstream it is also a player-targeted spell, but here the player cannot choose the ally: the cast always links the strongest one.

### Still not replaced (no fitting primitive yet)

- Zeus and Ancient Energy Converter folded bolt counts: no `countPerLevel`.
- Zeus's boss-only stun chance: `stunChance` applies to all creeps.
- Phantom: no `towerBuff.procs` and no `maxLevel`.
- Zealot: there is no filter on neighbour gold cost or count, and max stacks do not grow with level.
- spell_collector, chaining_storm, storm_coil and arcane_storm still assume typical runtime counts and distances.
- The extra spell crit on charged_obelisk and red_ball: no per-hit bonus to spell crit.
- the_conduit zero attack damage: a -100% damage bonus would also stop its on-hit procs, because `hit` procs need damage above 0.

### Engine requests

1. `fromOverkillPerLevel` on `mana` and `fromLinkedPerLevel` on `fromLinked`. These would replace the stepped procs with one exact proc each.
2. A death-proc filter `notOwnKill`, or a way to skip creeps hit by the tower's own effects. This would remove the cooldown trick and the same-frame skip.
3. Make `link` a no-op when relinking the same ally, or skip the auto-cast while a live link exists. The collector could then auto-cast.
4. Configurable `deathRange` (the temple's is 1000).
