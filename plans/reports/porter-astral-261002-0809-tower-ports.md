# Astral tower ports

File changed: `src/data/youtd/ports/astral.js` (only). 29 astral scripts; 29 have a PORTS entry
(28 with behavior, `astral_lantern` intentionally empty). Astral towers with pending abilities: 0.

Validation: the `describeAbility` check and the headless sim command both ran with no exceptions.
I also ran each astral tower alone next to the route at level 15 with tanky creeps (40x HP)
for 3 waves. Every proc and autocast fired, and no stat came out NaN or infinite.

## Ported scripts

- star_gazer -> kept as it was (spell damage on hit that grows per level).
- mana-touched_drake -> Unstable Energies: 28% (+0.48%/lvl) on hit, extra attack damage = multiplier x steady-state mana.
- lunar_sentinel -> Lunar Grace autocast (flat spell nuke, 2s cd) + 12.5% (+0.5%/lvl) on-attack bonus strike with 0.3s stun and +12..24% spell damage taken for 2.5s.
- minor_magic_ruin -> Illuminate: +5..30% experience aura over the ruin's attack range.
- time_manipulator -> Time Twist: aura with +10% xp and +10% attack speed, plus a pulsed buff with +5% mana regen and +12.5% buff duration. Future Knowledge: +2 xp every 10s. Time Field autocast: a 10s zone in a 950 radius.
- timevault -> Time Travel: a 3s stun on every hit vs non-bosses, and a 20% (+0.5%/lvl) chance vs bosses. Timesurge: a pulsed +30% trigger-chance buff in 600.
- astral_rift -> Spacial Rift: 10% (+0.4%/lvl) on hit (5% vs bosses) gives a 0.71s stun (the push-back) and a 30% (+1%/lvl) slow in 250. Presence of the Rift: spell damage every 1s in range, based on move speed.
- initiate_elementalist -> Elemental Chaos: one proc per random spell with the original odds per tier (blast AoE, frost AoE + slow, single target + stun, multi-target lightning).
- solar_emitter -> Sunshine: creep aura with -10/-15 armor, plus a 1s pulse giving +10/15% damage taken from astral, nature, fire and iron towers.
- small_light -> Power of Light: undead hit take +5..30% damage from everything for 3..5s. True sight is still handled by REVEAL_SCRIPTS.
- warrior_of_light -> Ain Soph Aur: 20..25% on attack, flat spell damage in a 200 radius around the target. Aura of Light: pulsed vsUndead buff in 300.
- small_serpent_ward -> Snake Charm autocast: a tower in 200 gets +max mana%, +mana regen% and +spell damage for 5s (+6%/lvl scaling).
- nortrom_the_silencer -> Glaives: 45% on attack for one extra full-damage attack at a random creep. Curse of the Silent: every 7s, creeps in 800 take +20% damage from astral towers for 2s.
- witch_doctor -> Serpent Ward: 18% (+0.28%/lvl) on attack, 3 extra attacks at 20% damage. Maledict autocast: creeps in 800 take +18.5% damage for 8s.
- astral_lantern -> empty entry. The upstream behavior (invisible-only) is commented out in YouTD 2.
- sorceress -> Magic Missile: full-damage splash in a 150 radius (the missile pierces).
- owl_of_wisdom -> Energyball: 25% (+0.4%/lvl) on attack, flat AoE spell damage. Energy Detection: periodic expected-value pulse (10% x ball damage) over 900.
- holy_energy -> Sunlight Burst autocast: stuns all creeps in 1000 for 1.5s.
- magic_battery -> Faerie Fire on hit (+10..20% spell damage taken, 9s). Battery Overload autocast: 10 missiles (chainSpell, no falloff) with flat damage + Faerie Fire.
- glowing_solar_orb -> Afterglow: 5% (+0.6%/lvl) on hit for -2..10 armor for 5s; a second proc vs bosses roughly doubles the chance.
- drake_whisperer -> Unleash: 12.5% on attack, chain of 5 flat hits. Blue, Green and Red drakes are attack procs, each gated by a 4.5s icd. Blue: AoE + 25% slow. Green: 5000 + Versatile damage buff in 175. Red: 2x attack damage + 3s stun.
- teacher -> Knowledge: 10% (+0.6%/lvl) on attack, gives 1..2.2 xp to a nearby tower.
- library_of_alexandria -> +30% xp aura in 900; 2 xp to one tower in 500 every 5s. Divine Teachings autocast: +100% xp (+2%/lvl) for 10s (+0.2s/lvl), and the library itself gains 2 xp.
- princess_of_light -> Extract Experience autocast: the creep is marked for 10s, and attackers have a 33% chance to gain 1 xp (max 10 times).
- healing_obelisk -> Grace: modelled as a `miss` of 50..65% (-0.4..0.8%/lvl). This equals the net damage lost to healing.
- lesser_priest -> Smite: 5% (+2%/lvl) on hit for flat spell damage.
- basic_knowledge -> High Knowledge: +0.4..1 xp on every attack.
- planar_gate -> Planeshift: attacks become a 12-bounce chain with 10% falloff in a 500 range. Astral Eruption autocast: +100% damage for 6s (+0.18s/lvl), and creeps in range take +10% damage from astral towers for 20s.
- sun_crusader -> Blessed Weapon: 15% on hit for flat spell damage, +2 mana. For the God autocast: a tower gets +40/80% damage and xp for 8s (+0.1s/lvl).

## Approximations (beyond the per-line notes)

- Engine auras carry fixed values: the per-level aura growth is dropped everywhere. Auras for stats
  outside auraMods (trigger, vsUndead, manaRegen, buffDur) are faked with a silent 2s periodic
  `towerBuff` (2.5s duration, radius). This also buffs the source tower itself.
- Creep-side "experience granted" debuffs (Illuminate, Divine Research) become xp auras over the area.
- Push-back and rewind (Spacial Rift, Time Travel) become stuns of the same lost-progress duration
  (175 units / ~245 speed = 0.71s; rewind 3s).
- Mana-Touched Drake uses the steady-state mana (regen x proc interval / 0.75, capped at max mana),
  because towers without actives get no mana. The Mana Distortion aura (mana burn) is skipped: creeps have no mana.
- Time Field uses `zone` (scales with attack damage). The flat 1500 is converted at base damage, with no per-level part.
- Random-spell and multi-drake scripts use independent procs whose expected output matches the
  original exclusive rolls. The elementalist's repeated-spell stacking bonus and the per-level stun durations are dropped.
- Silence (Nortrom, Sorceress) is meaningless here: Nortrom's silenced-damage bonus becomes an astral-only
  vulnerability window. The glaive targets a random creep, not the lowest-HP one.
- Maledict (stored damage released on expiry) becomes an equal-share curse. Ward shots are a 3-shot barrage.
- Owl: the bonus that grows with experience is approximated as +225/+325 per level. Immune-creep handling is skipped.
- Witch Doctor Purify, Princess Channel Energy, Time Manipulator's xp-to-spell-damage conversion,
  Lesser Priest's permanent armor reduction at level 25, Holy Energy's tower stun and
  Glimmer of Hope (debuff duration on towers), and the Sorceress's player-chosen missile modifications are not ported.
- Battery Overload: 10 missiles per 100 mana keeps the original 10 mana per missile, but it is not a full mana dump.

## Skipped scripts

None fully skipped. The `astral_lantern` entry is empty on purpose, because its upstream behavior is disabled.

## Missing engine primitives (proposals)

1. `zone` with flat damage: honor `flat`/`flatPerLevel` in `applyEffect` `zone` (same as `spellDamage`). Makes Time Field exact.
2. Aura on any stat: let `recalcAll` accept any computeStats key in `{type:'aura', stat, value, valuePerLevel, radius, self?}` (store it in auraMods generically, add `valuePerLevel * src.level`). This replaces the pseudo-aura pulses for trigger, vsUndead, manaRegen and buffDur, and adds per-level aura growth.
3. `creepAura` vulnerability: `{type:'creepAura', slow, armor, vulnElements:{astral:0.1,...}, vulnSpell, xpGranted, radius}`, applied each tick like auraSlow. Covers Solar Emitter, Library Divine Research and Illuminate.
4. Debuff rider `pushBack: units`: moves the creep back along its route (`c.dist -= units/UNIT`). Debuff rider `rewind: seconds`: stores `c.dist` and restores it after N seconds. Makes Spacial Rift and Time Travel exact.
5. Debuff rider `xpGranted: pct`: the creep grants more kill experience while debuffed (multiply xpTotal in `kill`).
6. Debuff rider `storeDamage: {dur, pct, pctPerStack}`: accumulates damage taken and deals a spell-damage share when it expires (Maledict).
7. Proc option `exclusive` group (`group:'chaos', weight`): exactly one proc of the group fires per trigger, by weight. Covers the Initiate Elementalist random spell.
8. Proc option `manaCost`: the proc only fires if the tower has the mana and spends it. Give towers mana when `def.mana` is set, even without actives (Mana-Touched Drake, Nortrom glaives, Astral Rift).
9. Effect kind `manaNuke {mult, spend}`: damage = mult x current mana, then spend a fraction (Unstable Energies).
10. Engine passive `replaceAttack: 'spell'`: the attack deals spell damage instead of attack damage (Sorceress, Planar Gate zero on-damage).
11. `stunPerLevel` / `debuffDurPerLevel` riders, like `slowPerLevel`.
12. Trigger `spellTargeted` (fires when another tower's autocast targets this one), for Channel Energy.
13. Permanent stacking creep debuffs: `armorPermanent` (Lesser Priest at level 25) and an astral vulnerability that stacks per hit (Planar Shift).
14. Effect `xp` should get a describeEffect line: the `xp` kind currently renders an empty description
    ("High Knowledge (100% on attack): ", "Future Knowledge (Every 10s): "). Also add STAT_NAMES
    for manaPct, manaRegen, buffDur, trigger and vsUndead so buff texts read naturally.

## Phase 2

File changed: `src/data/youtd/ports/astral.js` only. Astral towers with pending abilities: still 0.
Both validation commands ran with no exceptions: the `describeAbility` check, and the full-roster
sandbox run (96 towers, nonfinite 0). I also ran each changed tower alone at about level 55 against
very tanky creeps for 90s. Every new proc and autocast fired: mana-cost procs spent mana, and
push-back procs lowered the creeps' average path progress.

The `pseudoAura` helper (silent 2s tower-buff pulse) is removed. Every aura is now a real engine aura.

### Now exact (matches the upstream script)

- Time Manipulator: Time Twist is now four real auras (xp, attack speed, mana regen, buff duration),
  each with its per-level growth. Time Field is a `zone` with flat 1500 (+75/lvl) every second for 10s in a 950 radius.
- Timevault: Timesurge is a real trigger-chance aura, 30% (+0.6%/lvl).
- Warrior of Light: Aura of Light is a real vsUndead aura, 15/20/25% (+0.6/0.8/1%/lvl).
- Solar Emitter: Sunshine is now creep auras with no pulse: armor -10/-15 (+0.3/0.5 per level), plus
  +10/15% damage taken from astral, nature, fire and iron (one creepAura each).
- Minor Magic Ruin and Library of Alexandria: the xp auras gain their per-level growth (+0.2..1.2%/lvl and +1%/lvl).
- Mana-Touched Drake: Unstable Energies deals `manaMult` x current mana as attack damage and spends 75% of it. It uses the real mana pool.
- Astral Rift: Spacial Rift costs 30 mana (`manaCost`) and pushes creeps back by 175/94 units (`pushBack`), with no stun.
  15% of rifts push every creep within 175 of the target. Bosses roll at half chance and get pushed too.
- Lunar Sentinel: the bonus strike now rolls after each Lunar Grace cast (`on: 'cast'`), not on attack.
  From level 15 the cast deals its higher damage, via a `minLevel: 15` cast proc for the difference.
- Nortrom: the glaive is thrown on every attack while 40 mana is available (`manaCost: 40`), not by a 45% roll.
- Initiate Elementalist: Aftershock stuns now grow per level (`stunPerLevel` 0.01 / 0.02).
- Holy Energy: Sunlight Burst stun grows by 0.02s per level.
- Magic Battery: Faerie Fire gains +0.4/0.6/0.8% per level and +0.3s duration per level. Battery Overload is now
  `bolts`: 10 missiles, one every 0.2s, at random creeps within 1200, instead of a chain.
- Glowing Solar Orb: exact chances (doubled vs bosses, no longer a second additive roll) and
  duration 5s (+0.25s/lvl).
- Small Light: the vulnerability and its duration grow per level.
- Witch Doctor: the Serpent Ward is now `bolts` attack strikes: 6s / attack cooldown shots, one per attack interval, at random
  creeps within 800, for 20% (+0.2%/lvl) attack damage.

### Closer, still approximate

- Time Travel: the rewind is a `pushBack` applied 3s after the hit. Its size is the distance a creep of that size
  walks in 3s at base speed (7.8 / 7.0 champion / 5.85 boss). A creep slowed or stunned during
  those 3s is pushed further than it really walked.
- Initiate Elementalist: the spells still roll independently, not as one exclusive pick. The top tier folds the
  expected streak bonus for repeated spells into its numbers (x1.21 at 30% odds, x1.13 at 20%, linearised per level).
- Owl of Wisdom: the ball's experience-based bonus uses its cap of +150 damage per wave (`scaleBy: wave`), not the
  owl's actual experience. Energy Detection keeps the expected-value pulse, now with the +0.2%/lvl chance.
- Planar Gate: the bounce chain is 20 bounces at 7.5% falloff, the same total as the original
  linear 5%/bounce projectile (about 10.5 hits). The original can bounce back onto the same creep, and the chain cannot.
  Planar Shift is a permanent stacking astral vulnerability (`stackVuln`, permanent). Each eruption gives the creeps
  in range one 3% stack, an estimate of the bounces they take during the 6s window.
- Nortrom: Curse of the Silent now uses `stackVuln` with per-level strength (+20% +3.2%/lvl) and duration (2s +0.04s/lvl).
  It still applies to every astral tower, not to Nortrom alone. The glaive still picks a random target, not the lowest-health creep.

### Still not portable (missing primitive)

- Creep-side "experience granted" (Illuminate, the library aura): `creepAura.xpBonus` sets `c.auraXp`,
  but `kill()` never reads it. These remain xp auras on towers.
- Time Manipulator's xp-to-spell-damage conversion needs a proc filter on the tower's own experience.
- Maledict (stored damage released on expiry), Purify, Channel Energy (spell-targeted trigger), the
  Sorceress missile modifications and spell-type attack, and the Mana Distortion mana burn (creeps have no mana) are unchanged.
- Lesser Priest's level-25 permanent armor reduction needs a chance-gated, stacking, permanent armor rider.
- Per-level growth on `creepAura.vulnElement` (Solar Emitter +0.3/0.5%/lvl), on `shareXp` amounts (Library's
  2 +0.2/lvl) and on `mana` gains (Sun Crusader 2 +0.1/lvl) is not supported; these use the base value.
- Small fixed bonuses at level 25 (Lunar stun 0.4s, Snake Charm duration doubling, Lunar vulnerability at 15) are dropped.
- Holy Energy's tower stun and Glimmer of Hope (towers carry no debuffs) are still not ported.
