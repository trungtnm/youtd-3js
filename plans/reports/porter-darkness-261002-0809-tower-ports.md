# Darkness tower ports

File changed: `src/data/youtd/ports/darkness.js`. Nothing else was edited.

Result: 34 of 36 darkness scripts are ported. This includes `tombstone` and `broken_cage`, which were already there and are unchanged. `void_drake` and `harby` are skipped.

Validation:
- The pending check now lists only Void Drake, Void Dragon and Harby. `describeAbility` runs without errors on every darkness tower.
- The given headless sim run finished without exceptions.
- A second sim run built all 110 darkness towers at level 0 and again at level 25, using a stubbed `buildCheck` so every tier could be placed. It ran 600 s of game time with no exceptions, and every tower's stats stayed finite.

## Ported scripts

- necromantic_altar -> autocast chainSpell: 3 hits on creeps in range for x3, x4 and x5 of the tier damage (a negative falloff makes each hit stronger).
- small_bug_nest -> killStack: permanent damage per kill, sized from bug damage and base attack, with a cap.
- monolith_of_chaos -> creepAura: -5 armor within 750.
- bone_shrine -> on attack: target takes +10 stacks' worth of extra damage from darkness towers (60s).
- thief_apprentice -> on hit: gold proc. Small amounts become rarer 3+ gold thefts with the same average.
- chaos_warlock -> execute below 5.5% HP (non-boss, hit target only). Shadowbolt Wave autocast: chainSpell with 10/12 bolts. The cooldown is tripled to match the alternating 40%/20% wave roll.
- undisturbed_crypt -> Critical Mass: on attack, extra attack damage equal to the expected burst length. Corpse Explosion: every 5s, slow plus extra darkness damage taken across the range.
- haunted_rubble -> on attack: slow debuff for 5s.
- tentacle_spawn -> on hit: burn for 6s plus extra spell damage taken.
- village_witch -> Soul Split on hit: flat spell damage and a stacking attack-speed buff. Love Potion autocast: slow.
- it -> on attack (1s cooldown): 2x field damage in 250 around the target, plus a 1s stun in place of the teleport back.
- shard_of_souls -> Soul Link autocast: chain over 3 creeps applying a curse equal to the shared damage ratio x2.
- black_dragon_roost -> on hit: 50% slow and +20% damage taken for 5s.
- shadow -> Dark Shroud as a +5% damage aura. Dark Orbs as a zone on attack (20%). Lesser orb as a small zone on kill.
- essence_of_fury -> on hit: poison burn for 6s.
- the_council_of_demons -> Maledict: spell vulnerability on hit. Demonic Edict: pulsed +50% mana regen to towers in 400. Impenetrable Darkness autocast: 5 s of spell damage dealt up front, plus a slow.
- lunar_emitter -> pulsed creep debuff in the aura range: spell vulnerability, plus vulnerability to astral, darkness, ice and storm.
- death_knight -> Insatiable Hunger: self damage buff (+63%, +4%/level), assuming the mana pool is about half empty.
- sacrificial_lamb -> Blood Spill: attack speed to neighbors, self fatigue and XP (6s internal cooldown). Sacrifice autocast: dpsAdd buff on an ally.
- dark_battery -> Corruption on hit: curse for the attack-damage part and vulnSpell for the spell part. Battery Overload autocast: AoE spell damage over the full range.
- small_frost_fire -> autocast AoE spell damage plus slow.
- buried_soul -> Soul Scattering: spell vulnerability on the target and an attack-speed penalty on the tower itself. Shadowstrike: flat spell damage.
- mister_fireflies -> Moths of Prey: a 1s, 0-mana autocast dealing AoE spell damage around the target. The tower's own attack is already 1 damage.
- dutchmans_grave -> the cannonball is the regular attack with 100% splash in 250. Panic on kill: -25 armor in 300. Soul Attack on kill (5s cooldown): 14000 spell damage near the corpse.
- soulflame_device -> Soulfire on hit: burn. Awaken autocast: attack-speed buff to towers in 350.
- kraken -> Eat the Dead (killStack), Acid Goo (armor shred), and Tentacles every 4s (AoE attack damage plus stun).
- soul_vault -> armor creepAura, Acid Skull AoE spell damage, and Soulsteal (long spell vulnerability).
- lesser_skeletal_mage -> autocast curse on the strongest creep.
- cursed_grounds -> Cursed Attack (spell damage, slow, spell vulnerability). Mortal Coil: pulsed buff for damage vs humanoid, brute and feral.
- spider_queen -> Parasite (burn plus armor) and a damage killStack.
- hall_of_souls -> damage killStack and XP on kill.
- plagued_crypt -> Plague burn in 250 around the hit target (stands in for spreading). Army of the Damned: stacking buff on kill.
- dreadlord -> Dreadlord Slash: mana-sized spell hit with an internal cooldown of 80 mana / regen. Bloodsucker: killStack. Awakening autocast: attack speed.

## Approximations (worth reviewing)

- Flat damage-over-time becomes `burn = dps / avg base attack`. The burn then scales with this game's damage multiplier, not with the flat per-level value (tentacle, essence, soulflame, spider, plague).
- Percent-armor changes become flat armor: monolith -100% -> 5, soul vault -25% -> 3, spider -2%/s -> 3. Armor increases on creeps are dropped (black dragon +50%, acid skull +0.5).
- "Unit comes in range" triggers become auras or on-hit procs (monolith, death knight's withering is dropped).
- Corpse triggers become kill procs or range pulses (undisturbed_crypt, plagued_crypt, dutchman souls).
- Per-level growth is dropped wherever the effect kind has no per-level field: vulnElement, vulnSpell, curse, armor and burn duration.
- Chances that fall while stacks are active (village witch) use a fixed average (60% of the base).
- Sacrifice does not apply the lamb's -100% damage self-fatigue, because a tower-targeted effect cannot also hit the caster. The ally gets dpsAdd with no cost to the lamb.
- Description glitches from the existing formatter: negative mods print as "+-60% attack speed". Pulse auras for non-aura stats print raw stat keys (vsHumanoid, manaRegen). The `xp` effect has no text, so the hall proc puts the amount in its name.

Dropped sub-mechanics:
- Chaos warlock: Siphon Essence.
- It: teleport and the It Hunger spell-damage growth.
- Shard of Souls: XP on linked deaths.
- Council: stored-damage release and the spell-cast missiles.
- Witch: item chance and the 2x bonus on potion targets.
- Death knight: withering and Will of the Undying.
- Dutchman: Soul Storm and the Panic speed-up.
- Soulflame: Evil Device stat copy and the +1% attack speed per cast.
- Fireflies: element switch and mana burn.
- Spider: parasite jump on death.
- Dreadlord: max-mana growth.

## Skipped scripts

- void_drake: its behaviors are silence (creeps here do not cast) and a 1%/s XP drain that may not drop the tower a level. Negative `giveXp` could push XP below zero, and without a drain the port would be a pure buff.
- harby: it sleeps until a spell targets it, and its attack damage is (6 + 0.1·level) × current mana. The tower has no autocast, so it has no mana pool in this engine. Its aura procs on allies' mana-cost casts.

## Missing engine primitives

1. `xpDrain` effect: `{ kind: 'xpDrain', pctOfXp, perLevel, keepLevel: true }`. Removes XP but never drops below the current level's threshold. Needed by void_drake.
2. `onCreepDeathNear` trigger: `proc on: 'death'` with `radius`. Fires when any creep dies within the radius, whoever killed it. Fixes hall_of_souls and gives corpse mechanics (undisturbed/plagued crypt, dutchman souls) their real trigger.
3. `onEnterRange` trigger: `proc on: 'enter'`. Fires once per creep the first time it enters range. Needed by monolith_of_chaos, death_knight withering and kraken tentacles.
4. Flat spell DoT rider: `{ dot: flat, dotPerLevel, dotDur, stacking: bool, spell: true }` in debuffCreep. Ticks as spell damage through `game.damage` and supports stacks. Fixes rend, poison, soulfire, parasite and plague.
5. Per-level fields on riders: `vulnSpellPerLevel`, `vulnElement.perLevel`, `cursePerLevel`, `armorPerLevel`, `debuffDurPerLevel`.
6. Percent armor rider: `{ armorPct }`, so the change scales with the creep's armor value. A negative value raises armor.
7. `selfEffect` on tower-targeted actives: `{ ..., selfEffect: {kind:'towerBuff', ...} }`, applied to the caster after the main effect. Needed for the Sacrifice fatigue.
8. `randomBolts` spell: `{ kind: 'randomBolts', count, flat, radius }`. Fires N independent bolts at random creeps in range, allowing repeats. Needed by necromantic altar, chaos warlock, dark battery and fireflies moths.
9. `manaScaled` damage: `{ flatFromMana: 'max'|'current', manaMult, manaCost }` on spellDamage. The proc only fires when mana ≥ cost and spends it. Needed by dreadlord and harby.
10. `killStackStat`: killStack with `stat: 'attackSpeed'|'spell'|'manaFlat'`. Needed by dreadlord, it and the soulflame awaken counter.
11. A generic `aura` stat channel: let `recalcAll` accept any stat key (vsHumanoid, manaRegen, ...) so pulse-buff workarounds are not needed.
12. `pctHpDamage` rider: `{ hpPctPerSec, dur }`. Needed by death knight withering.
13. `damageLink` debuff: `{ link: id, sharePct }`. Shares the damage taken by one linked creep with the others. Needed by shard_of_souls.
14. `onTargetedBySpell` trigger, so actives cast near or on a tower can wake it (harby) and so an aura can react to allies' casts (council, harby).

## Phase 2

File changed: `src/data/youtd/ports/darkness.js` only. All 36 darkness scripts are now ported, including `void_drake` and `harby`. No darkness tower is pending.

Validation:
- The pending check prints `pending 0`. `describeAbility` runs on every darkness tower without errors.
- The full-roster sandbox run (110 towers, given 1e6 XP, 180 s) finished with `nonfinite 0`.
- An extra run put all 110 towers through 3 waves at 0 XP, at 300 XP and at max level. Stats, mana and XP stayed finite, and mana and XP never went negative. Void Drake stays pinned near the start of its level, which is the intended behavior.

### Now exact, or exact up to rounding
- Flat damage over time now uses the `dot` rider, which deals flat spell damage per second with per-level growth: tentacle_spawn (Rend), essence_of_fury, soulflame_device (stacking, up to 50 stacks), spider_queen (parasite), plagued_crypt and the council's Impenetrable Darkness (1000 +40/level per second).
- Plague stacks: each hit applies a non-stacking base and a stacking part, both 375 +15/level. That sums to the upstream 750 + 375 per refresh, with one extra 375 stack.
- Percent armor now uses `armorPct`. Monolith uses -100% on non-bosses and -50% on bosses, for 3 s +0.1 s/level. Black Dragon raises armor by 40% through a negative `armorPct`. Soul Vault's aura is a 1 s pulse of -25%, and the Spider parasite applies -30%.
- "Creep enters range" triggers now use `on: 'enter'`: monolith Chaos, death knight Withering Presence, and the Kraken tentacles, which share one 4 s cooldown with the periodic tentacles.
- Corpse and nearby-death triggers now use `on: 'death'`:
  - undisturbed_crypt: Corpse Explosion fires on a death, with a 5 s cooldown, in 500 around the corpse.
  - hall_of_souls: any death in range grows damage and gives XP.
  - plagued_crypt: Army of the Damned.
  - soulflame_device: +5 mana per death.
  - spider_queen: Brood.
- Riders now grow per level: vulnSpell (council, dark battery, buried soul, soul vault, lunar), curse (dark battery, skeletal mage, black dragon, shard), armor (kraken, dutchman Panic +1/level), debuff duration (monolith, crypt, dragon, dark battery, kraken, skeletal mage, cursed grounds), and the darkness vulnerability of the crypt.
- bone_shrine: a permanent `stackVuln` from darkness towers, up to 10 stacks, +inc and +add per level.
- lunar_emitter: a real `creepAura` for spell vulnerability (with per-level growth), plus a 1 s pulse of per-element `stackVuln` for astral, darkness, ice and storm (with per-level growth).
- Auras that used to be silent pulses are now real auras:
  - council: mana regeneration, +50% +1%/level.
  - cursed_grounds: vsHumanoid, vsBrute and vsFeral, +value +add per level.
  - shadow: a net +0.5% damage per level from Dark Shroud.
- Random-target strikes now use `bolts`:
  - necromantic_altar: three bolts for x3, x4 and x5 damage.
  - chaos_warlock: 10/12 bolts, as a periodic roll at 1/3 chance on the autocast cooldown.
  - dark_battery: 10 missiles over 2 s, which spend the remaining mana.
  - fireflies: 12–14 moth strikes per second.
  - dutchman: soul attack and soul storm.
  - kraken: 6 tentacles, with +1 at level 15 and +1 more at level 25.
- Permanent growth now uses `growSelf`:
  - kraken Eat the Dead: per creep size, no cap.
  - It Hunger: +0.1% +0.01%/level spell damage, max +700%.
  - dreadlord: +0.5% attack speed and +10 max mana per kill (mana max +2010). Phase 1 wrongly gave damage here.
  - soulflame: +1% attack speed per Awaken cast.
  - harby: +1 max mana per kill.
  - hall and spider: damage growth with no cap.
- dreadlord: Slash now uses `manaCost: 80`, the real cost, in place of an internal cooldown. Awakening adds +20 mana regeneration with +0.8 per level.
- death_knight:
  - Insatiable Hunger is now driven by real missing mana: `mult x (1 - mana/max)` with `scaleBy: mana`.
  - Hits restore 1% mana and kills 5%.
  - Regeneration is 0 through a `levelBonus` of -100% mana regeneration.
  - The Will of the Undying autocast halves the knight's mana and drains neighbors.
- sacrificial_lamb: Sacrifice now applies its cost, -100% damage on the lamb for 6 s, through a self-only `towerBuff` (radius 0.01, centered on itself). The ally's dps bonus follows the lamb's damage per level.
- haunted_rubble: bosses get 0.66x the chance.
- soul_vault: Acid Skull deals 1800 to the main target and 1440 around it (+5%/level). Soulsteal lasts 1000 s.
- void_drake (new): every second it loses (1% +0.02%/level) of its total banked XP (1.5% / 0.03% on the Dragon). It cannot lose a level because the engine clamps XP at zero.
- harby (new): the Arcane Orb fires on every attack with `manaCost: 100`. It deals (6 +0.1/level) × mana before the spend, written exactly as `600 (+10/level) × (1 + 0.01 × mana left)`. Arcane Replenish and +1 max mana per kill are also included.

### Still approximate
- void_drake: the drain steps up at levels 3, 5, 10, 15, 20, 25, 30, 40 and 50, in place of growing smoothly. Silence is dropped because creeps here do not cast. The XP loss on upgrade is dropped because there is no on-create hook.
- harby:
  - It is always awake. There is no "targeted by a spell" trigger, so the sleep that banks mana for bursts is not modeled.
  - The Arcane Aura (allies regain mana on their casts) is a 30 s pulse of 10% mana in 350.
  - Replenish uses a fixed 12%, the level-12 value.
- Fixed values where a field has no per-level growth: essence poison duration (6 s), small frost fire slow duration, shadow orb count (folded into a linear per-level scale), kraken tentacle cooldown (4 s), plague spread speed-up, chaos warlock execute threshold (5.5%), and black dragon armor (+40%).
- undisturbed_crypt Critical Mass: the expected burst length is one extra attack-damage hit, scaled linearly per level.
- village_witch: the chance that drops per active stack is still a 60% average. The 2x bonus on potion targets and the item chance are dropped.
- shard_of_souls: the link is still a curse, of 3x the share ratio with +0.9% per level. That matches the total extra damage only when damage is spread evenly. The extra links at levels 15 and 25 and the XP on linked deaths are dropped.
- it:
  - Two hits plus a pushback of 8.5 world units stand in for the player-placed field pair.
  - The boss exclusion is decided by the attacked creep, not by each creep in the field.
  - Hunger grows once per field use, not once per transported creep.
- council: Darkness's stored-damage release is modeled as +75% (+1%/level) spell damage taken. The -95% attack damage taken, Maledict's bonus on spell targeting, and the missiles on allied casts are dropped.
- death_knight: Will of the Undying assumes one expensive neighbor, and its penalty also hits cheap neighbors. Withering is four delayed 5%-of-current-health spell hits, which are subject to spell modifiers.
- sacrificial_lamb: Blood Spill still assumes two neighbors, and its fatigue is -90% attack speed because -100% would make the cooldown infinite. The Sacrifice dps uses a linear per-level fit of the lamb's damage.
- dark_battery: the overload always fires 10 missiles, which matches the steady state of casting at about 100 mana.
- soulflame_device:
  - Evil Device is a fixed aura (+10% +0.4%/level attack speed) to common and uncommon darkness towers, because the engine cannot copy another tower's live stats.
  - Soulfire stacks do not spread on death.
  - The +5 mana per death counts every death in range.
- spider_queen: the armor loss is a flat 30% (about the level-12 total) and lasts long, in place of eroding per tick. Brood counts half of the deaths in range, and the jump picks a random creep in range.
- plagued_crypt: spreading is modeled by infecting everything within 250 of the hit. Army stacks are capped at 7, the steady state of one corpse per 3 s with a 20 s duration.
- dutchmans_grave: Soul Storm becomes one 14000 bolt per kill, ignoring collision halving and the line path. The Panic speed-up is dropped.
- lesser_skeletal_mage and dark_battery: "attack damage taken" uses `curse`, which also raises spell damage.
- cursed_grounds: the slow lasts a fixed 4 s, while the vulnerability duration grows per level.
- chaos_warlock: Siphon Essence is still dropped. The execute is on hit, not a 1 s aura sweep. Only the tier-2 tower gets it, because tier 1 has no aura.
- small_bug_nest, thief_apprentice and dreadlord's mana-scaled damage are unchanged. Dreadlord's damage uses the base 1000 mana and ignores max-mana growth, because `scaleBy` has no max-mana kind.

### Engine notes for a later pass
- The `mana` effect caps restored mana at the base `maxMana`, not at `stats.maxMana`. Towers that grew their pool (harby, dreadlord) are refilled only up to the base value. Regeneration in `tickTower` uses `stats.maxMana` correctly.
- `towers.js` maps a YouTD mana regeneration of 0 to the engine default. Death Knight and Soulflame work around this with the `noRegen` level bonus. A `manaRegen: 0` that is respected would be cleaner.
- Formatter glitches: a negative `armorPct`, `armor` or `scaleBy.per` prints as "--40% armor" or "+-2% per mana". The `xp` effect prints "grants -N experience".
- Missing primitives: a "targeted by an allied spell" trigger (harby, council), an "attack damage taken" rider, `armorPct` on `creepAura`, a per-level field for `execute`, and a `scaleBy` kind for max mana.
