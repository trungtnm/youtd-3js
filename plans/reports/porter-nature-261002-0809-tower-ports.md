# Nature tower ports

File changed: `src/data/youtd/ports/nature.js` (nothing else).
Result: 26 of 26 nature scripts ported. Several are approximations; none skipped. `nature pending 0`.

Local helpers in nature.js:
- `pulseAura`/`pseudoAura`: a 1s silent periodic proc that refreshes a 1.5s `towerBuff` on towers in radius. Used for auras whose value grows with level or that carry stats the engine `aura` cannot hold (multicrit, critMult). `perLevel` = per-level add / base value.
- `growth`: a permanent stacking self buff (`towerBuff`, dur 3600s, `maxStacks`) to model "grows forever" mechanics.

## Ported scripts

- annoyed_tree -> on attack 30% (+6%/lvl): flat spell AoE (150..1950, radius 300..450).
- green_dragon_roost -> pulse aura +2 multicrit to towers within 200.
- lesser_wolves_den -> pulse aura attack speed 10/15/20% (+0.5/0.75/1%/lvl), radius from aura row.
- regenerating_well -> pulse aura spell damage 15/20/25% (+per level); autocast Replenish restores 10/15/20% max mana to towers within 500 (anytime).
- sacred_altar -> on hit 25% (+0.5%/lvl), non-boss: 700 (+35) spell damage + 1.2s stun.
- afflicted_obelisk -> every hit: nature vulnerability (2.5..4% x steady-state stacks 3/cd) for 3s + an extra full attack-damage hit.
- rooted_chasm -> on hit 12.5% (+0.2%/lvl), non-boss: stun 1.5..3.75s + entangle damage folded into one spell hit (dps x ticks, +5%/lvl).
- wild_warbeast -> pulse aura (crit +3%, crit dmg +0.15, AS +10%, dmg +10%, +2%/lvl) radius 400; Devour 6% on attack: 5000 (+400) spell damage + temporary extra aura stack (6s, max 3).
- forest_archer -> on hit: stun 1.75s (5/6/7%) and slow 15% for 7.5/8.5/9.5s (10/15/20%).
- mud_golem -> every hit: Ground Smash, flat 4300 (+230) attack damage in 750 radius + 60% slow 0.5s.
- razorboar_thornweaver -> on attack 12/15/18%: attack-damage spray x0.3 (+0.2%/lvl) in 800 radius; autocast Thornspray does the same around the tower.
- cute_small_spider -> every hit: poison folded into flat spell damage (5 ticks).
- skink -> every own hit: poison folded into flat spell damage (5 ticks).
- bonk_the_living_mountain -> Grow! every 25s: +3% dmg stack (max 160) and 4 xp; Landslide 25% on attack: 700 (+50) AoE 300 + 0.5s stun; Crush on hits vs stunned: 5000 (+250) + Morale buff (+10% dmg/AS, +0.4%/lvl) to towers in 500 for 10s.
- forest_troll -> Rampage 14/15/16% on attack: self +150% AS (+0.5/1.0 at tiers 2/3), +25% crit, +0.75 crit dmg for 4/5/6s (+dur/lvl); icd = duration.
- cenarion -> Tranquility pulse aura (+40% dmg +1%/lvl, -20% AS shrinking with level); Leaf Storm 15% (+0.6%) on hit: 2100 (+90) AoE 200 + 30% slow; Thorned (+30% nature damage taken, 3s) on hit; autocast Entangling Roots: 1100 (+44) AoE + 1.5s stun.
- inexperienced_huntress -> Shadow Glaive 20% (+0.8%) on attack: one extra attack at x(1+crit bonus); Star Glaive 25% (+0.4%) on hit: spell damage x0.25/0.35/0.45 (+1%/lvl) of attack.
- poison_battery -> every hit: poison folded (poison x cd) + 5/7/10% slow 9s; autocast Battery Overload: chain of 10 orbs (projectile + poison) with slow.
- magic_mushroom -> Rapid Growth: +3% spell dmg stack every ~50s (max 40); Fungus Strike every 14th hit: x1 (+1%/lvl) spell damage + 10% spell vulnerability 60s; autocast Mystical Trance on a tower (self allowed): +25% spell, +25% trigger chance (+4%/lvl), 5s (+0.2s/lvl).
- forest_protectress -> Meld: constant +100% dmg (+5.5%/lvl) self buff (average of the sawtooth); Wrath 27% on hit: x0.5 (+4%/lvl) attack AoE 250 + 50% slow; Strike the Unprepared pulse aura +12.5% crit (+4%/lvl).
- nature_sprites -> autocast Nature's Gift on a tower: +16/24/32% dmg and +8/12/16% AS (+2.5%/lvl) for 5s.
- coconut_sapling -> every hit: coconut rain as spell AoE 225, ~1.36/1.5 coconuts worth of damage per creep, 0.5s stun.
- jungle_stalker -> Feral Aggression: on hit with chance = crit/10, +2/3/4% permanent damage (max 200/225/250%); Bloodthirst on kill: +100/125/150% AS (+1%/lvl) for 3/4/5s (+0.05s/lvl).
- garden_of_eden -> every attack: x0.35 (+4%/lvl) spell damage; autocast Eden's Wrath: x2.6 (+4%/lvl) spell damage in 1600 radius.
- greyfang -> on kill: bone shards as attack AoE x0.2 in 300 radius.
- morphling -> Morphling Strike 20% (+0.6%) on hit: 3-creep chain of 2000 (+60) spell damage + burn (25% attack dmg/s, 5s); Evolve: 2% (+0.06%) per hit, +2% dmg +1% AS stack (max 50).

## Approximations (what differs from the original)

- Auras with per-level values or non-aura stats use the 1s pulse buff (up to 1s latency, description says "Every 1s ... for 1.5s").
- Aura radii are `range / 94`. With 2-unit tiles a 200 aura (2.13) reaches only the 4 orthogonal neighbours; in WC3 it reaches all 8. Affects wolves den, roost, well, skink, golem, altar, protectress.
- Flat DoTs (spider, skink, battery, chasm/altar/cenarion entangle ticks) are folded into one up-front spell hit. Spider stack/cap and tier-override rules dropped.
- Effects that other towers trigger through an aura (sacred_altar entangle, skink poison, mud_golem smash) only trigger from the owner's own attacks.
- Tower-centred bursts triggered on attack/hit (mud golem smash, razorboar thornspray proc) are centred on the target creep.
- Ground-only (mud golem) and air exclusion (altar, chasm) not enforced; `notBoss` used.
- Level gates dropped: forest_archer 4 targets at 15, forest_troll multicrit at 15/25, razorboar double/triple spray at 15/25, greyfang double crit roll at 25, bonk grow thresholds (10 for Crush, 20 for Landslide), bonk grow-count damage scaling, golem range at 25.
- Stacking multipliers dropped: razorboar 1.11^stacks thorns, obelisk per-hit vuln stacks (one steady-state value), warbeast devour stacks capped at 3, mushroom fungus vulnerability (non-stacking, 60s instead of permanent).
- Delays dropped: obelisk parasite burst (3s), garden blast (0.5s), tree rock flight.
- Shadow Glaive (next attack faster + forced crit) is modelled as one extra attack.
- Nature's Gift: element-dependent main stat + random second stat replaced by fixed damage + attack speed.
- Morphling: Might/Swiftness/Adapt stance toggles not ported; the strike works without the 25-stack requirement. Evolve values grouped into 10x larger, 10x rarer steps (same expectation); same for jungle_stalker feral growth.
- Magic mushroom: 40%-per-20s growth as one per 50s; growth period shrinking with level ignored. Fungus Strike modelled as every 14th hit (trance is mana-bound) and does not cancel the attack's own damage.
- Forest protectress: Meld/Wrath sawtooth replaced by its expected average (+~100% damage, 27% wrath chance) for the base 2.2s attack.
- Strike the Unprepared uses half of the max crit bonus (creep health ratio ~0.5).
- Garden of Eden: lifeforce scaled by wave level replaced by attack-damage multiples (tuned to waves 20-80); race requirement for storing lifeforce ignored (assumed full).
- Greyfang shards: two decaying line shards replaced by one radius hit.
- Coconut sapling: random coconut count/scatter replaced by its expectation.
- Cenarion Thorned applied on hit, not on creeps entering range; Entangling Roots cone replaced by an AoE of radius 300.
- Regenerating well mana pct does not grow per level; same-family half refill not modelled.
- Growth buffs last 3600s, not forever, and are recomputed at the current level (original locks each stack at the level it was gained).
- Description cosmetics: negative mods render as "+-20% attack speed" (Cenarion), and growth buffs show "for 3600s".

## Skipped scripts

None.

## Missing engine primitives (proposals)

1. `aura.valuePerLevel` (and stat keys `multicrit`, `critMult`, `trigger`): `{type:'aura', stat, value, valuePerLevel, radius, element?}`; recalcAll uses `value + valuePerLevel * src.level` and recalcs on level up. Removes the pulse-buff workaround.
2. `auraProc`: `{type:'auraProc', radius, proc:{on, chance, chanceScaleByCd, cond, effect}}`; procs of the aura owner also run when any tower within radius attacks/hits (effect resolved with the aura owner as caster, chance optionally x the buffed tower's base cd). Makes sacred_altar, skink, mud_golem exact.
3. Flat DoT rider: `dot: {dps, dpsPerLevel, dur, stacks?, cap?, capPerLevel?}` in debuffCreep, ticking spell damage per second from the caster (stacks add to dps up to cap). Makes spider, skink, battery, entangle ticks exact.
4. `towerCentered: true` on effects: area centre is the tower even when triggered by a creep (mud golem smash, thornspray proc).
5. Conditions: `ground` (not air), `notBossOrAir`, and `crit` (ctx.crit) in CONDITIONS. Makes chasm/altar/golem/jungle stalker exact.
6. `minLevel` on procs/passives and a level-gated `multishot`/mods passive: `{type:'levelBonus', level:15, mods:{multishot:3}}`. Covers forest_archer, forest_troll, razorboar, greyfang.
7. Permanent self growth: `{kind:'growSelf', stat, amount, amountPerLevel, cap}` stored on the tower (like item `grow`), surviving upgrades within the family. Covers bonk, mushroom, jungle stalker, morphling evolve.
8. `resetOn`/consume semantics: a counter stat that builds per second and resets when a named proc fires (`{type:'buildUp', stat:'damage', perSecond, max, resetBy:'Protectress\'s Wrath'}`), and proc chance scaling with that counter. Covers forest_protectress.
9. Stacking debuffs: `vulnElement.stack: true` (+maxStacks) and `damageStackMult` per creep (razorboar 1.11^n).
10. `delay` on effects: schedule the effect via `game.delayed` (obelisk burst, garden blast, rock flight).
11. Wave-scaled flat damage: `flatPerWave` in applyEffect (`+ flatPerWave * game.level`) and a per-tower charge counter filled on kills (`{kind:'charge', key, max, maxPerLevel, races}` + `consumeCharge`) for garden_of_eden.
12. Target-element buffs: `towerBuff.byElement: {nature:{crit:..}, fire:{damage:..}, ...}` plus `randomSecond: true` for nature_sprites.
13. Toggle stances for manual actives: an active that removes buff keys (`removeKeys: [...]`) before applying its own, so morphling Might/Swiftness/Adapt can be ported.
14. `describeEffect`: render negative mods as "-20%" and a `permanent: true` flag instead of "for 3600s".

## Validation

- `nature pending 0`; describeAbility runs on every nature ability.
- Given headless sim command finishes without exceptions (it builds only 5 towers because higher tiers must be upgraded).
- Extra scratch checks (not committed): all 72 nature towers built and upgraded near the path at level 0 and 25 for 12 waves; plus a forced test with tanky creeps and `trigger` boosted that fired every proc and autocast. No exceptions, no NaN/Infinity in tower stats.

## Unresolved questions

- Aura radius convention for adjacent-tower auras (see Approximations); may want a shared rule such as `range / 94 + 0.9` so 8 neighbours are covered.

## Phase 2

File changed: `src/data/youtd/ports/nature.js` only. The `pulseAura`/`pseudoAura`/`growth` helpers are gone; every port now uses engine primitives. `nature pending 0`.

### Now exact (or exact up to engine granularity)

- Auras are real `aura` passives with `valuePerLevel`: green_dragon_roost (multicrit 2), lesser_wolves_den (AS), regenerating_well (spell), wild_warbeast (crit, critMult, AS, damage at 0.03/0.15/0.10/0.10 + 0.0006/0.003/0.002/0.002 per level), cenarion Tranquility (+40% dmg, -20% AS, both +0.4%/lvl), forest_protectress Strike the Unprepared.
- Flat DoTs use the `dot` rider: cute_small_spider (5 stacks, 5s), skink (5s, stacks freely), poison_battery (9s, refresh only), rooted_chasm and sacred_altar entangle ticks, cenarion Entangling Roots ticks.
- Ground-only, non-boss filters via `sizes` (rooted_chasm, sacred_altar).
- afflicted_obelisk: stacking nature vulnerability (`stackVuln`, +per-level) and the parasite burst delayed 3s (`delay`).
- cenarion Thorned! now fires on `enter`, with per-level value and duration; Leaf Storm is a 3-wave `zone` (700 +30/lvl per wave).
- bonk: Grow! is `growSelf` (+3% +0.1%/lvl, kept on upgrade); Morale is centred on Bonk (`center: 'self'`).
- jungle_stalker: Feral Aggression fires on `crit` and grows damage permanently (`growSelf`, real gain and cap).
- magic_mushroom: Rapid Growth is `growSelf` (+3% +0.12%/lvl spell); Fungus Strike applies a permanent stacking +10% spell vulnerability.
- morphling: Evolve is applied on each strike via `growSelf` (+0.2% dmg, +0.1% AS, 500 cap).
- forest_archer: +1 target at level 15 (`levelBonus`), stun duration +0.05s/lvl, roots roll only when the stun did not.
- razorboar: level 16+ double and level 25 triple sprays as `minLevel` procs on attack and on `cast` (expected spray count matches).
- poison_battery Battery Overload: 9 orbs at random creeps every 0.2s (`bolts`) instead of a chain.
- garden_of_eden: damage now scales with the wave level (`scaleBy: wave`), blast delayed 0.5s.
- forest_troll: Rampage attack speed grows per level from the tier's base buff level.
- mud_golem: the golem's own attacks also roll the Earthquake aura chance.
- wild_warbeast Devour buff is now centred on the warbeast (was the creep).

### Still approximate

- Aura-carried procs from *other* towers (sacred_altar entangle, skink poison, mud_golem smash): no aura-proc primitive; only the owner's attacks trigger them.
- Tower-centred bursts from attack/hit triggers (mud_golem smash, razorboar attack-triggered spray) are centred on the target creep. Autocast and `cast` sprays are tower-centred.
- Effects that hit an area cannot filter air (mud_golem smash hits air).
- Level-range gates: forest_troll multicrit at 15/25 (needs a max-level filter or level-gated buff mods); greyfang double crit roll at 25; mud_golem 800 smash range at 25.
- Counters on a tower that gate or scale procs: bonk grow-count gates (Crush at 10, Landslide at 20) and +50/+15 damage per grow; garden_of_eden lifeforce (fixed estimate: 2 stored per attack, 4 per blast); razorboar 1.11^stacks thorn multiplier per creep.
- Per-level slow durations (forest_archer roots, mud_golem slow) and DoT durations (spider +0.05s/lvl) use the base value.
- obelisk vulnerability stacks share one timer (cap = hits in 3s at base speed + 1) instead of expiring per hit.
- magic_mushroom growth: 40%/20s kept as one roll per 50s (periodic procs re-roll every frame on a failed chance, so a chance + icd periodic would always fire); the period shrinking with level is ignored. Fungus Strike stays every 14th hit and does not zero the attack's own damage.
- forest_protectress Meld/Wrath sawtooth kept as its average (+100% +5.5%/lvl self buff, 27% Wrath). Strike the Unprepared uses half of the health-scaled bonus.
- nature_sprites element-dependent buff, morphling stances, coconut scatter, greyfang line shards, huntress next-attack speed buff, regenerating_well per-level/same-family mana: unchanged (no primitive).
- Growth caps for bonk/mushroom assume all growths gained at level 25.

### Engine notes for the owner of `src/sim`

- `aura` keeps only the strongest |value| per stat, so Cenarion's -20% attack speed replaces a weaker positive attack speed aura (e.g. wolves den +10%) instead of adding to it.
- `describeStatMod('critMult', 0.003)` prints "+x0 crit damage" (two-decimal rounding) for the warbeast per-level line; towerBuff descriptions print a double space before "for".
- Periodic procs with `chance < 1` re-roll every tick until they succeed; a "roll once per period" option would make chance-based periodic growth exact.
- `addDot` (burn rider) matches any dot from the same tower, including flat `dot` riders; a tower mixing both would overwrite one with the other.

### Validation

- `nature pending 0`; `describeAbility` runs on all nature abilities.
- Full-roster sandbox run: `ok towers 89 kills 56 nonfinite 0`.
- Scratch per-family runs at level 25 with 300x creep health: every proc, autocast, `enter`/`crit`/`cast` trigger, `levelBonus` (Forest Amazon 4 targets) and `growSelf` fired; no non-finite stats.
