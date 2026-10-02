# YouTD ability and item mechanics taxonomy (for a browser remake)

Date: 2026-10-01. Scope: generic mechanics only. No tower, item or ability names or description text are reproduced. All numbers are representative values taken from the data.

## 0. Method, source quality, caveats

- Source: youtd.best. I fetched every list page, not a sample: 97 tower pages (669 towers) and 41 item pages (278 items). Each entry carries a rendered description plus a structured "trigger" block (event type and parameters such as chance, range, cooldown, mana cost, aura power).
- Credibility: this site is a repository of community-authored tower and item submissions for the YouTD engine map ("v1" entries, many authors), not a dump of one canonical balance file. Numbers vary a lot between authors. Treat counts as "how common is the pattern in the community pool", which is the useful signal for variety.
- Tower mix: 208 common, 232 uncommon, 146 rare, 83 unique. Elements are balanced: darkness 108, fire 98, storm 98, astral 96, iron 94, ice 89, nature 86. Item mix: 59 common, 97 uncommon, 67 rare, 55 unique.
- Counts below come from regex matching on the descriptions. Treat them as approximate (plus or minus 10 to 15 percent). A tower is counted once per pattern.
- NOT found on the site, so not verified here: oils (permanent consumables), the horadric-cube style recipe system, one-shot consumables, and any per-player-unique item restriction. The only hit for "oil" was incidental text. Section 5.6 states what I know from general knowledge of the original map and flags it as unverified.
- Not covered: creep wave design, tower upgrade (family) trees, damage and armor type matrix beyond what the text exposes, exact formulas in the Lua-like trigger code (only sampled).

## 1. Core data model the engine exposes (useful as an architecture hint)

Every ability on this site is declared as one or more event-bound triggers. Trigger counts across towers (items in parentheses):

| Trigger type | Towers | Items | Meaning |
|---|---|---|---|
| On Damage | 294 | 34 | Fires when the tower deals damage (attacks and spells), has a `chance` and `chanceLevelAdd` |
| On Tower Creation | 191 | - | Applies permanent stats or flags once when built |
| On Attack | 183 | 29 | Fires on each attack launch, has `chance` and `chanceLevelAdd` |
| Autocast | 161 | 10 | Active spell with target type, range, mana cost, cooldown |
| Tower Aura | 95 | 16 | Continuous buff or debuff in a radius with `power` and `powerAdd` per level |
| Periodic | 55 | 16 | Timer, period typically 0.1 to 2 s for fast loops, 5 to 40 s for slow pulses |
| On Kill | 26 | 11 | Creep killed by this tower |
| On Level Up | 15 | - | Tower level change |
| On Unit Comes In Range | 14 | 2 | Creep enters a radius (800 to 1000 typical) |
| On Tower Destruction | 21 | - | Tower sold or replaced |
| On Item Pickup / Drop / Creation | - | 27 / 19 / 24 | Items hook tower state when carried |
| On Spell Cast / On Spell Target | 1 / 3 | 4 / 1 | Rare, reacts to other spells |

Implication: a remake needs only about eight event hooks (onAttack, onDamage, onKill, periodic, onCreate, onLevelUp, unitEnterRange, autocast) plus an aura system. About 60 percent of towers are `onDamage` or `onAttack` driven.

Chance conventions seen in the data: `onDamage` chance of 1.0 (always run, then check inside) is the majority (189 of 294), so many "triggers" are really unconditional hooks used for passive stat modification. Real random procs cluster at 12.5, 15, 20, 25 and 30 percent.

## 2. Tower stat system

### 2.1 Base attack numbers by rarity (medians over all towers)

| Rarity | Gold cost (median / range) | Base DPS (median) | Range (median) | Attack cooldown (median) | Abilities per tower (avg) |
|---|---|---|---|---|---|
| Common | 650 / 34-2600 | ~500 | 850 | 1.2 s | 1.0 |
| Uncommon | 930 / 45-3360 | ~570 | 900 | 1.5 s | 1.6 |
| Rare | 1675 / 500-3600 | ~750 | 900 | 1.5 s | 2.5 |
| Unique | 3000 / 1500-5000 | ~1330 | 900 | 1.9 s | 3.2 |

Note: the cost range includes entries from different upgrade tiers inside one family, so use the median as the trend. Roughly, DPS doubles from common to unique while ability count triples. This is the right shape for a remake: higher rarity buys complexity, not just numbers.

Attack range values observed: 500 to 1500, with 800 to 900 dominant. Attack cooldowns observed: 0.2 (mana-limited rapid fire) to 4 s (slow heavy hitters).

### 2.2 Damage types (attack type per tower)

Six damage types appear: Elemental 148, Energy 146, Physical 130, Decay 125, Essence 68, Magic 46. (The remaining 6 have none, being pure support.) Types interact with a creep armor-class system (text mentions armor classes and "attacks air only" / "ground only" restrictions on about 14 towers). Magic and some Essence damage ignores immunity or is converted. Simple remake mapping: type matrix of 4 to 6 types versus creep armor classes, plus an "immune" flag handled by converting spell damage to a fraction of attack damage (for example 80 percent) rather than nothing.

### 2.3 Stat vocabulary (these are the modifier channels)

A very consistent set of stat channels appears on both towers and items. A remake should model each as a multiplicative or additive modifier on the tower:

1. Attack speed percent (85 towers mention it).
2. Damage percent, split into attack damage and spell damage (separate scaling).
3. Crit chance, crit multiplier (shown as `x1.4`, `x2`), and a separate spell crit chance and spell crit multiplier (28 towers).
4. Multicrit count (15 towers, "Nx multicrit"): a crit rolls repeatedly, each extra roll adds another multiplier. Typical value 1 to 3 extra crits.
5. Mana (max) and mana regen, usually as per-level additive values.
6. Bounty collected percent (about 30 towers or items).
7. Experience gain percent (49 towers).
8. Item chance percent and item quality percent (25 towers), applied to drops from creeps.
9. Buff duration and debuff duration percent (a tower stat that scales its own buffs and shortens debuffs applied to it).
10. "Trigger chances" percent: multiplies all proc chances on the tower (items give about +8 to +12 percent).
11. Damage-vs-category: undead (50 mentions), nature, masses, air, humanoids, orcs, bosses, magical, normals, champions, invisible.

Common conditional damage values: +10 to +30 percent versus one category, scaling roughly +1 to +2.4 percent per level. Some towers have a penalty on one category (-10 to -40 percent), which is a cheap way to create specialists.

### 2.4 Level scaling (tower level 1 to 25)

- About 90 percent of towers (599 of 669) use "Level Bonus" or per-level text. Tower level (1 to 25) is the main power curve, gained from experience. It scales ability numbers linearly.
- Typical per-level conventions:
  - Proc chance: +0.25 to +1 percentage point per level.
  - Proc damage: +2 to +5 percent of the base value per level (a base 200 rising by about 10 per level; a base 2500 by 125).
  - Buff or stun duration: +0.05 to +0.4 s per level.
  - Aura values: +2 to +4 percent of base per level (for example 15 percent attack-speed aura gaining about 1 point per level).
  - Slow percent: +0.3 to +0.6 point per level.
  - Mana: +1, +2, +5 or +10 per level depending on tier. Mana regen: +0.1 per level is very common.
  - Attack-speed or damage self-stats: +3 percent attack speed or +5 to +8 percent damage per level for "stat-stick" towers.
  - Cooldown: -0.04 to -0.3 s per level.
- Threshold unlocks are common: "+1 extra target at level 15 and 25", "+1 projectile at level 10", "+1 bounce at 20". Thresholds are at 5, 10, 15, 20 or 25. These are cheap and make levels feel meaningful.
- Experience is itself a mechanic: it is shared, stolen, converted to gold, or granted on casts (see 3.6). A low "exp gain" tower trades level speed for other stats.

## 3. Tower passive patterns (with frequency, out of 669 towers)

### 3.1 Attack modifiers (shape of the attack)

| Pattern | Count | Typical numbers |
|---|---|---|
| Splash: main hit plus AoE radius percent | ~77 use a two-ring splash | Ring 1: radius 125 to 250 at 50 to 55 percent damage. Optional ring 2: radius 225 to 350 at 25 percent |
| Bounce attack | ~51 | 3 to 6 targets, -10 to -46 percent damage lost per bounce; low-damage-loss versions are rarer and costlier |
| Multishot (hit several targets at once) | ~20 | 2 to 3 targets, +1 target at levels 15 and 25 |
| Extra projectile chance, geometric chain | ~10 | 15 to 30 percent initial chance, 33 to 40 percent per extra projectile, hard cap 4 to 14 |
| Piercing / line through the target | a handful | Continues 350 to 1200 units, 35 percent of attack damage to those in path |
| Split projectile (fork after distance) | a few unique | Splits at 300 units, up to 4 splits |
| Attacks air only / ground only | ~14 | Restriction used as a balancing lever for cheap strong damage |
| Mana-driven rapid fire | ~30 | Fires every 0.1 to 0.2 s, each shot costs 1 to 10 mana until empty, applies a debuff per shot. Needs max mana of hundreds |
| Pure bonus-damage stat stick (no proc) | ~25 | +5 to +8 percent damage per level |

### 3.2 Proc patterns (chance-based)

Most common basic shape: `onAttack or onDamage, chance 12 to 30 percent (median ~20)`.

| Pattern | Count | Typical numbers |
|---|---|---|
| Chance on attack/damage to deal extra spell damage | ~130 | 150 to 4000 base damage by rarity; often AoE 175 to 300 radius |
| Chain lightning style (hits N targets, falloff) | ~29 | 3 targets, 25 percent falloff, +1 target at level 20 |
| Chance to stun | ~59 stun users | 6 to 10 percent for 0.5 to 1.75 s on normal attacks; bosses get 20 to 25 percent of the chance or duration |
| Chance to slow | ~97 | 10 to 50 percent slow, 1.5 to 8 s |
| Chance to reduce armor | ~39 | Armor -2 to -15 for 5 s, double chance on bosses sometimes |
| Chance to crit (explicit crit towers) | ~58 | 4 to 20 percent chance, x1.4 to x2 base multiplier, +0.3 to +0.7 percent chance and +0.03 to +0.07 multiplier per level |
| Chance for burst of falling strikes / novas in an area | ~25 | 3 novas, radius 200, 50 percent damage at the edge, 350 damage at 25 percent chance |
| Chance on attack to summon a short-lived helper | ~12 | Lasts 6 s, deals 20 percent of owner attack damage |
| Miss chance as a drawback | ~28 | 30 to 35 percent miss, shrinking about 1 percent per level, used to pay for very high base damage |
| Random-effect roll (pick from gold, exp, stun, slow, armor) | few | Cheap way to generate variety from one primitive |
| Every Nth attack effect (counter, not chance) | ~23 | Every 3rd to 11th attack; range given as "7th to 11th" with thresholds reducing it |
| "Attack-speed adjusted chance" | ~17 | Chance is scaled by attack cooldown so fast attackers do not proc more per second. Strongly recommended convention |
| "Triggers on the Nth instance of spell damage" | few | Deterministic spell-crit counter |

### 3.3 On-damage, conditional and stacking effects

| Pattern | Count | Typical numbers |
|---|---|---|
| Damage bonus vs creep category | ~143 | +10 to +50 percent, scaling per level (see 2.3) |
| "Vulnerability" debuff: target takes X percent more damage from a damage source | ~61 | +10 to +40 percent more from spells, from attacks, or from a specific element, 4 to 9 s. Elemental versions (more damage from towers of element E) reward mono-element builds |
| Stacking self-buff per hit | ~72 stack mentions | +1 to +5 percent attack damage or attack speed per proc, caps of 20 to 100 stacks, 5 s refresh |
| Permanent growth per kill or crit | ~29 | +0.1 to +0.4 percent damage, hard cap 250 to 700 percent total |
| Damage scaling off resources | ~15 | Spell damage equal to (N times current mana), or square root of player gold, or per-tower count owned by the player |
| Damage from stored build-up | ~6 | Gains percent damage for each second of not attacking (cap ~12 s), consumed on next attack |
| Deal "dps" as percent of own damage to others | ~54 mention dps | Convert own damage into buff on other towers, see 3.5 |
| Execute / below-HP thresholds | 0 | Nothing in the data uses execute or HP-percent conditions. One tower scales a crit stat by remaining creep HP percent. Skip execute for now |
| Purge enemy buffs for bonus damage | 1 | +12 percent damage per purged effect, 4 s cooldown |

### 3.4 Damage over time and debuffs

- DoT (poison, burn, bleed, "damage over N seconds"): ~85 towers. Typical: poison 125 to 240 damage per second for 5 to 9 s, stacking or refresh-only, sometimes "attack-speed and range adjusted". Some DoT versions convert 50 percent of attack damage to instant damage and the rest to spell damage over 5 s, with leftover damage carrying into a refreshed duration.
- Debuff stacking to cap: slow-and-armor-shred loops (lose 3 percent speed per second under effect, or armor -1 extra per second) are used by aura-like creep debuffs.
- Link effects: "link N enemies for X s, damage to one is shared 10 to 15 percent with others" (~3 towers).
- Mark-and-detonate: curse for 8 s, then deal 15 percent of damage received (stacks add more) (~2 towers).
- Chance-to-kill on a very long debuff (3 percent per tick, bosses and immune excluded and instead take 400 percent attack damage) (1 tower). Instant-kill procs exist on items too (see 5.4).
- Mark creep so that other towers get something when damaging it: gain experience (33 percent chance, 1 exp, up to 10 extractions), bonus bounty, or item chance. This is the cheapest cross-tower synergy, ~10 towers.

### 3.5 Support and economy effects

| Pattern | Count | Typical numbers |
|---|---|---|
| Gold or bounty | ~30 | +10 to +60 percent bounty collected; chance on attack (3.5 to 5 percent) to convert a non-boss to bonus gold (6 to 18); flat gold per autocast cast (+5 to +7) |
| Experience | ~49 | +20 to +100 percent exp gain for self or buffed tower; convert exp to gold; give 1 exp per cast; tower exp stealing |
| Item chance / item quality | ~25 | Hit creeps drop better or more items: +15 percent chance and quality for 6 s on damage; steady bonus +5 to +40 percent |
| Mana economy | ~51 mana-regen towers | Attack restores 1 to 4 mana; kill restores 3 to 5 percent max mana; restore 20 percent of max mana of towers in 500 range |
| Level cap interplay | 3 | Tower gives experience to lower-level neighbours up to a level cap (for example below level 10) when it crits or kills |
| Team-state coupling | 2 | Damage scales with percent of lost lives (more lives lost, more damage) |

### 3.6 Experience-sharing and tower-to-tower transfers

About 20 towers move experience or damage between towers: crit gives neighbours 1 exp, kill transfers 1 flat exp to up to 5 neighbours, a tower sacrifices some of its own damage to boost another tower's dps by 30 to 45 percent for 6 s, or splits its own attack speed among neighbours. This produces "support" towers that are meaningful without having damage of their own.

## 4. Auras and actives

### 4.1 Auras (95 towers have a Tower Aura trigger, 16 items)

Target type distribution: friendly towers 62, enemy creeps 23, filtered by element or rarity 8 (for example only storm towers, or only common and uncommon). Self inclusion is true for 60 of 95.

Radius distribution (units): 200 (16), 300 (13), 350 (10), 250 (5), 500 (5), 800 to 1000 (about 9), 0 meaning global or self (7). Item auras use almost exactly the same radii (200 dominant, 7 of 16).

Aura value conventions (text parsing of what auras do):

| Aura effect | Typical value at base | Per level |
|---|---|---|
| Attack speed to nearby towers | +5 to +20 percent (wolf-pack style) | +0.1 to +1 point |
| Damage to nearby towers | +15 to +25 percent | +0.5 to +1 point |
| Crit chance to nearby towers | +3.5 to +10 percent | +0.08 to +0.4 point |
| Spell damage, spell crit | +25 percent / +10 percent | +1 / +0.4 |
| Damage vs one or several creep categories | +10 to +15 percent | +0.24 to +0.6 point |
| Bounty, exp gain | +10 percent bounty, +30 percent exp | +1 point |
| Buff duration / debuff duration | +25 percent buff duration, -15 percent debuff duration | +0.2 to +0.4 |
| Mana regen / max mana | +7.5 percent regen | small |
| Creep debuff: slow | 5 to 20 percent | +0.2 to +0.3 |
| Creep debuff: armor reduction | -1 to -15 armor, up to range 1100 | +0.2 to +0.5 |
| Creep debuff: extra damage taken | +5 to +20 percent from attacks, spells or specific elements | +0.4 to +0.5 |
| Creep debuff: periodic damage plus ramp | 20 to 40 damage per tick, ramps per second in aura | scaling with level |

Rarity guidance: small radius (200 to 350) for strong buffs and radius 800 to 1100 for creep debuffs that use few percent values. Aura power in the structured data is a per-level pair (power + powerAdd), so the clean primitive is `aura(targetFilter, radius, effectId, base, perLevel)`.

Aura-like but not aura-typed: "on proc, emit a battle cry buffing all towers in 420 range" (attack speed +5 percent or damage +5 percent, 5 s, re-applying refreshes and adds +0.3 percent, stacks up to 100). These "proc buffs" appear about 10 times.

### 4.2 Active / autocast (161 towers, ~24 percent)

Structure of an autocast spell (from the structured fields): target type, auto-range (where it auto-fires), cast range, mana cost, cooldown, an "is extended" flag, and "buffs before idle" (how many targets to buff before the AI stops).

Target type: no explicit target / self-centered or point 87, friendly towers 45, creeps 28, any player tower 1.

Autocast behaviour type (count):
- Offensive immediate (casts when a creep is in range, no target needed): 45.
- Offensive unit (casts on an enemy creep in range): 37.
- Offensive buff (casts a buff on a friendly tower while creeps are in range): 34.
- Always buff (casts on friendly towers whenever off cooldown, even without creeps): 22.
- No-autocast immediate (player triggers, never auto): 20, plus 2 point-targeted (player picks location) and 1 tower-targeted.

Numbers:

| Parameter | Observed distribution |
|---|---|
| Cooldown | 1 s (24), 2 s (15), 5 s (27), 6 s (10), 4 s (7), 10 s (6), 20 s (18), 40 s for big ones |
| Mana cost | 0 (34), 10 to 20 (50), 30 to 50 (20), 90 to 100 (about 25), a few unique casters at 1000 |
| Range | 1200 (35 offensive), 900 (20), 500 (17), 800 (11), 300 or less (5) for tower-buff casts |
| Buff duration | 4 to 12 s, +0.1 to +0.4 s per level |

By rarity (autocast counts and typical costs):
- Common: 15 entries, all the same template: 20 mana, 1 s cooldown, auto-cast on creeps in range, an essentially on-attack replacement spell.
- Uncommon: 40 entries, mana 10 to 30 (some 95), cooldown 2 to 5 s.
- Rare: 63 entries, the biggest group. Mana 15 to 20 for cheap buffs, 60 to 100 for strong AoE or mass-buff casts; 18 of them are 100 mana with a 20 s cooldown (area spell templates).
- Unique: 43 entries, mana 0 to 50 usually (or spend-everything-based), cooldown 1 to 5 s, or 40 s for big resets.

Typical mana pools and regen (what "mana per level" means): the base pool is not shown on list pages, but per-level mana gain is. Uncommon casters gain about +0.5 to +1 mana per level (this is the mana-per-attack kind, 1 mana per hit with 1 mana per second regen). Rare casters gain +10 mana per level (18 of 27 explicit values; others +1 or +2 per level), and mana regen +0.1 per level. Unique casters gain +5 to +10 per level (some +100 to +500 for towers that spend mana as damage), with regen +0.1 to +3 per level. A reasonable remake baseline: pool 100 at level 1 plus about 10 per level for rare casters, regen 1 to 3 per second.

Typical autocast effects, in order of frequency:
1. Buff a nearby tower (range 300 to 600): +25 to +45 percent attack speed, or +30 to +40 percent attack damage and exp, or +40 to +60 percent bounty, or crit chance +7.5 percent and multicrit +1, for 8 to 12 s. About 45 towers.
2. Area spell on creeps (range 1000 to 1200): stun 0.5 to 0.75 s on 3 targets (270 to 2500 damage) or damage plus slow. About 30 towers.
3. Single-target nuke: base damage 4000-ish plus per-tower-count scaling, 25 percent chance to recast (max 1 extra). About 8 towers.
4. Mana restoration to towers in range (20 percent of max mana) or mana feed on attack. About 8 towers.
5. Debuff cleansing or shield effects: reduce debuff duration of towers in range 15 percent; stun all towers and enemies; create persistent ground fields at chosen locations that punish creeps walking through them. About 8.
6. Player-targeted ground spells (point cast): rare, about 2 towers, but fun.
7. Mana-burn or drain: about 9 towers mention mana burn, steal or drain.
8. Cast-trigger chain: autocast has a 20 percent chance to release a burst of homing bolts (12 bolts, 1700 damage each). The "autocast procs another effect" idea shows up on unique towers.

Periodic-timer spells (55 towers, ~8 percent): "Every X seconds" with a short period (0.1 to 2 s) usually means a continuous channeled or storm effect (for example random lightning every 0.4 s, costing mana, until mana drops below a threshold). A long period (7 to 25 s) means a pulse: trap 3 creeps, stun and damage, or make a fixed trade of exp for gold.

## 5. Items

### 5.1 Structure

- Rarity tiers: common 59, uncommon 97, rare 67, unique 55 (the site's equivalents of white/green/blue/orange). Item gold values: common 36 to ~1100 (clusters at 60, 150, 1050 to 1100), uncommon 63 to ~1400 (540 modal), rare 80 to ~1970 (1000 modal), unique 50 to ~2750 (1000 and 1500 modal).
- Each item has an item level (0 to 83) that tracks its power and drives how late it should drop; it also influences the gold value. Items have 0 to 3 effects each.
- Item triggers are the same event system as towers: onAttack, onDamage, onKill, periodic, aura, autocast ("use"), plus pickup, drop and creation hooks (to hold bonuses that are bound to the item and to remove them on drop).

### 5.2 Stat-stick items (about 60 percent of items)

Single-line items with 1 to 3 stat lines. Value ranges that appear (all percentages):
- Attack speed +5.5 to +10 (+0.5 per level), crit chance +2.5 to +8, crit multiplier +x0.05 to +x1, spell crit chance +3 and multiplier +x0.1 to +x1, damage +7 to +75, spell damage +20 to +27 (up to +45 on special items), mana regen +10 to +30, exp gain +12 to +80, bounty +10 to +30 (or +3 per level), item chance +6 to +25, item quality +10 to +75, trigger chances +7.5 to +12.5, buff duration +28 to +33, debuff duration reduction -17 to -35 (up to -60), damage versus a category +10 to +84, versus champions or bosses +10.
- Roughly 40 items (14 percent) are trade-off items with an explicit drawback: -7 to -16 percent attack speed for +exp or crit, -50 percent item chance for +75 percent damage, -20 percent damage and spell damage for +bounty, -35 percent item chance for +75 percent item quality. This is the cheapest variety trick in the list.
- Tier-quality pattern: common = single stat at modest value, uncommon = 2 stats or one big stat with small downside, rare = 2 to 4 stats or a stat plus a minor effect, unique = effect-based with the stat as flavour.
- Per-element synergy item: grants a different bonus per element of the tower carrying it (exp for one element, spell damage for another, crit for another and so on). One item with seven branches.

### 5.3 Unique-effect items

On-attack and on-kill and periodic effects, with frequencies (of 278 items): on-attack or chance-on-attack about 31, on-kill about 20, aura about 26, charges about 6, active-use or periodic about 24.

Representative effects (generic):
- Chance (8 to 40 percent, attack-speed adjusted) to release a missile or burst: 75 percent of last hit as spell damage in 400 radius, flat 1250 spell damage in radius 200, 45 percent damage fragments to two extra targets.
- Chance to debuff target: +15 percent spell damage taken for 5 s.
- Stacking attack speed per hit (+2 percent per hit up to 20 stacks plus a slow of the same size on the creep).
- Ramp-up per consecutive hit on the same target: +2 percent attack speed per hit, cap +100 percent, halved when the target changes.
- Rampage proc: 14 percent chance for 4 s of +25 percent attack speed, +1 multicrit, +x0.4 crit damage, +5 percent crit chance.
- Crit-ramp: each attack +2 percent crit chance, max 40, reset on crit; or +x0.005 crit multiplier per kill, max +x3.
- Every 5th spell instance crits; every 5th hit gets bonus damage equal to mana-regen percent.
- Pierce: attack continues 350 through target for 35 percent damage.
- Missile that ignores immunity, scaled by 20 percent of spell damage.
- Instant kill chance: 0.25 percent per attack (non-boss, non-champion), growing +0.01 per level.
- Splash damage when hitting a stunned creep: 20 percent of attack damage in radius 250.
- Random-effect roll on damage: exp, gold, stun 0.5 s, slow 10 percent, or armor -5.
- Drop manipulation on attack: a randomised spell that gives a high-quality item, several normal items or boosts item chance for a while.
- Guaranteed drop every 150 s on next kill. Gains 1 charge per kill and spends a charge to stun.
- Economy: spend a charge (gained every 5th wave, max 5) to buy a random level 14 to 25 item for 500 gold; gold from bosses coming close to the carrier.
- Attack type convertor: spend 100 charges (regenerates 50 per attack) to switch the carrier's damage type.
- Copy effect: duplicates all other non-active items on the tower; the cost is -60 percent attack speed and lost on drop.
- Drawback effects: hangover (slow then stun), forced random target selection, periodic attack-speed penalty, stun chance on own attacks, experience loss every 10 s for large stat gains.

Bound-to-item growth ("bonus is bound to the item and survives tower swap"): about 10 items. Examples: flat experience (50, 100, 200) given to the holder and removed or drained on drop; crit chance that ramps and resets; per-kill dps growth with a cap of 4000; item-find that random-walks between -24 and +48 percent. This is a strong "collect and carry" mechanic.

### 5.4 Item auras (16)

Same radii as tower auras (200 most common). Typical values: +5 to +15 percent attack speed to nearby towers (drum-like items, up to 1000 radius at +5 percent), +3.5 percent crit chance, +12 percent damage versus a race to all towers in 200, +10 percent buff duration and -15 percent debuff duration, +10 percent exp to towers in 150 radius, creep slow 14 percent in 800 radius, creep armor -4 and slow 10 percent in 650, a debuff that raises damage taken by 20 percent in 800 radius at the cost of -20 percent attack speed in 350 for nearby towers, and detection (reveal invisible creeps in 750 to 900 and +20 percent damage against invisible ones).

### 5.5 Active-use items and cooldowns

- Only 10 items have an autocast trigger, but another ~14 are timed via periodic triggers. Item cooldowns: 4 to 30 s for combat actives, 60 to 150 s for utility, with mana cost always 0 (they use cooldown or charges).
- Charge-based active: costs 1 charge, regenerates 3 charges every 40 s, max 10, grants nearby towers (radius 350) +10 percent damage or +10 percent attack speed for 4 s.
- Periodic traps: every 8 s stun 3 creeps in radius 1000 for 0.5 s. Periodic converters: every 15 s (minus 0.3 s per level) convert 2 exp into 7 gold.
- Single-use target actions: ritual on a nearby tower giving +20 percent exp gain and +10 percent damage for 10 s; give a tower +1 exp (+0.04 per level); steal 15 to 60 exp from a random tower in range; teach exp to up to five random towers in 400 range every 15 s at the cost of 10 own exp.
- Item casts feed into other items: "when the carrier casts its own active, it gains exp equal to 0.2 times cooldown and grants gold equal to 0.5 times cooldown".

### 5.6 Oils, consumables, per-player-unique and recipes

Not present in the data. From general knowledge of the original map (unverified, treat as a hypothesis):
- Oils are permanent consumables applied to a tower and give flat stat increases (damage, attack speed, spell damage, crit and similar), and some towers ignore oils (one tower in the data states "does not benefit from damage increasing items or oils", which confirms oils exist as a concept and are a damage-increasing stat source).
- Combining items via a cube-style recipe (several lower-tier items into one higher-tier) existed in the original; this site has no recipe field.
- Per-player-unique restriction: only 3 items in the data hint at one-per-tower or one-per-player text. No evidence of a hard unique-per-player rule here. Recommend a simple "one copy per tower" rule for items with a ramp-up or bound effect.
- Item "level" (0 to 83) plus "item quality" suggests quality affects the strength roll, and "item chance" affects drop count. The data states that some effects are explicitly not affected by quality (the item-purchase effect).

## 6. Tower and item archetypes (what combinations produce variety)

1. Stat-stick mono-attack tower: 1 ability, a per-level stat line. Cheap, common tier.
2. Splash or bounce shape plus a category damage bonus. Shape plus "versus undead" or "versus air" is the standard common/uncommon tower.
3. Proc tower: chance on attack for a nuke, chain, nova or stun. Uncommon/rare.
4. Support buffer: low damage, aura or autocast buff for a neighbour. Rare/unique.
5. Debuffer: armor shred, vulnerability, slow field. Rare/unique.
6. Economy tower: bounty or exp bonus, converts to gold, boosts neighbours' exp. Rare.
7. Mana-burst tower: huge mana per level, spends it as rapid fire or as a storm. Rare/unique.
8. Scaling or hoarding tower: damage grows from kills, crits, gold, or time without attacking. Unique.
9. Mono-element synergy: effects that only buff or vulnerability-link one element. Adds drafting depth.

## 7. Prioritized primitives (about 30), ranked by variety per implementation effort

Default numbers are meant to be tuned. "lvl" means tower level 1 to 25. "AS-adj" means the chance is multiplied by attack cooldown relative to a 1 s baseline.

Tier A: implement first (about 80 percent of the variety)

1. `statMod`: additive or multiplicative modifier on one channel (attack damage, spell damage, attack speed, crit chance, crit multiplier, mana, mana regen, bounty, exp, item chance, item quality, buff duration, debuff duration, trigger chance). Default: +X percent plus Y percent per lvl.
2. `onHit chance -> extra spell damage (single target)`: chance 20 percent, damage 3 to 4 times attack damage, +4 percent damage per lvl, +0.5 point chance per lvl.
3. `onHit chance -> AoE spell damage around target`: chance 20 percent, radius 200, falloff 100 percent to 50 percent at edge.
4. `splash attack`: ring1 radius 150 at 50 percent, optional ring2 radius 250 at 25 percent. Static shape of the attack.
5. `bounce attack`: 3 targets, -35 percent damage per bounce, +1 target at lvl 20.
6. `damageVs(category)`: +15 percent damage versus one category (air, ground, armored, mass, boss, undead and so on), +1 point per lvl, optional -20 percent versus another.
7. `crit`: chance 8 percent, multiplier x2, +0.4 point and +0.04x per lvl, plus separate spell crit with the same shape.
8. `onHit chance -> stun`: 8 percent, 0.75 s, +0.02 s per lvl; bosses get half chance or one quarter duration.
9. `onHit slow`: 15 to 25 percent for 3 s, refresh on hit, +0.3 point per lvl.
10. `armorShred debuff`: -3 armor for 5 s on 15 percent chance, stack up to 3.
11. `vulnerability debuff`: target takes +12 percent damage from a named source (spells, attacks, or one element) for 5 s on 20 percent chance. Element-filtered version is the best synergy primitive.
12. `dot`: apply 5 s burn or poison dealing 25 percent of attack damage per second as spell damage, refresh not stack; optional stacking up to 5.

Tier B: second wave (support and economy, strong depth)

13. `aura(towers)`: radius 300, +12 percent attack speed (or +15 percent damage, or +5 percent crit) to towers in range, +1 point per lvl. Allow an element filter.
14. `aura(creeps)`: radius 900, slow 10 percent or armor -3 or +10 percent damage taken, +0.3 per lvl.
15. `autocast: buff nearby tower`: +30 percent attack speed for 8 s, cost 20 mana, cooldown 4 s, range 500, +0.3 s per lvl. Prefer the target without the buff.
16. `autocast: buff tower exp or bounty`: +40 percent exp or bounty for 10 s, cost 20, cd 4, plus 5 gold per cast.
17. `autocast: AoE on creeps`: stun 3 creeps for 0.6 s plus 300 spell damage, cost 20, cd 10, range 1000, auto-fires when creeps in range.
18. `mana model`: max mana from level (rare 100 plus 10 per lvl), regen 1 to 3 per second, `on attack restore N mana`, `on kill restore percent of max mana`.
19. `onKill`: +1 exp to self or random towers in range 500; +5 percent bounty; grow permanent damage by 0.1 percent up to a cap.
20. `bounty/exp/itemChance stat on creep debuff`: mark a creep so that damage from any tower yields +30 percent chance to grant +1 exp or +10 percent item chance for 6 s.
21. `every Nth attack`: counter-based 5th attack releases a larger effect; deterministic and easy to explain.
22. `extra projectile chain`: 20 percent chance for a bonus projectile, 30 percent for each additional, cap 6.
23. `stacking buff on hit`: +2 percent attack speed per hit up to 20 stacks, 5 s refresh; creep gets the matching slow.

Tier C: spice (higher effort, high payoff for rare and unique tiers)

24. `multicrit`: crit rolls again at x damage; default chain up to 3 with each extra roll multiplying; items add +1 count.
25. `mana-burst rapid fire`: ticks every 0.2 s, 10 mana each, damage 300 plus 12 per lvl, applies the element's debuff; requires mana pool and regen 5 or more.
26. `chain lightning`: 3 targets, 25 percent falloff, 150 damage plus 3 per lvl, +1 target at lvl 20.
27. `ground field / trap`: player or auto placed 250 radius zone that damages or stuns creeps passing over, 3000 damage on trigger.
28. `resource-scaled damage`: damage equals N times current mana, or square root of gold, or per owned tower count; interacts with economy.
29. `damage transfer buff`: this tower gives up X percent of its dps to boost a neighbour by 30 to 45 percent for 6 s (support-only tower).
30. `time-without-attacking build-up`: +18 percent damage per idle second up to 12 s, consumed on next attack. Cheap "sniper" archetype.

Item primitives (map to the numbers above)

31. `item statMod(+drawback)`: one positive and one negative line (for example +25 percent damage, -15 percent attack speed).
32. `item aura`: radius 200, +7.5 percent attack speed or +3.5 percent crit to towers in range.
33. `item on-attack proc`: 15 percent AS-adj chance for 750 to 1250 spell damage in radius 200.
34. `item active with charges`: 10 max charges, +3 per 40 s, nearby towers +10 percent damage for 4 s.
35. `item bound growth`: per kill +10 dps (cap 4000), or +2 percent crit chance per attack (cap 40, reset on crit); survives tower swap and is lost only with the item.

## 8. Final recommendation

Ranking of what to build first for the largest variety gain per effort:

1. Modifier channels (primitive 1) with per-level scaling and a "category damage" system (6). Everything else hangs off them, and 60 percent of the towers and items in the source are just this.
2. Event hooks (onAttack, onHit, onKill, periodic) with AS-adjusted chances (2, 3, 8, 11, 19, 21). These cover about 130 to 300 towers.
3. Aura engine with tower-buff and creep-debuff modes and per-level power (13, 14, 32).
4. Mana and autocast framework with a small set of target types (self-centered, tower, creep): primitives 15 to 18. 24 percent of the source towers are casters, and the autocast behaviour types are only four.
5. Item system with five item shapes (31 to 35) and "bound to item" persistent state.

Skip initially: execute effects (none in the data), recipes and oils (not verifiable from this source, only add if the remake design calls for crafting), per-player-unique restriction.

## 9. Unresolved questions

- Does the remake want crafting (oils, recipe cube)? The source has no data; I could research the original map's wiki separately.
- How are base mana pools set for casters? The list pages only show per-level mana gain; a family page or the original map's data would be needed for baselines.
- Are numbers from community towers balanced against one another? They are not guaranteed to be. Use the rarity medians in 2.1 as budgets rather than copying individual values.
