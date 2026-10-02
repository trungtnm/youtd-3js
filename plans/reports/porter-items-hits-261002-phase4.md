# Item ports, phase 4: hits, cast targets, creep mana, carrier mana

Status: all 9 items ported. All ports are in `src/data/youtd/item-ports-hits.js` (`ITEM_PORTS_HITS`).
Engine changes are additive and sit next to the hit, damage and mana code.

## Items

| Script | Port | Exact? |
|---|---|---|
| elunes_bow | `damage` proc, `modifyHit { floor: true }`: a main hit that would deal less than the carrier's average attack damage (after armor and the type matrix) is raised to it. | Mostly exact. Upstream also lifts hits on immune targets (arcane attacks vs warded); here an immune target stays immune. |
| phase_gloves | `damage` proc, `modifyHit { toSpell: 0.3 }`: the hit lands at 70%; 30% of its post-armor amount lands right after as spell damage, which then gets spell modifiers and can spell-crit. | Exact for main hits. Upstream deals the spell part before the attack part; here it lands after, so a spell-part kill does not cancel the on-hit procs. |
| optimists_preserved_face | `damage` proc, `modifyHit { healthMult: [0.5, 1.75] }`: x(0.5 + 1.25 x health ratio) before the hit lands. | Exact for main hits. |
| sign_of_energy_infusion | `damage` proc with `every: 5` (counter per item), `modifyHit { regenMult: true }`: x max(0, 2 + mana regeneration bonus). | Exact. YouTD's base regeneration percent starts at 100%, so this game's `manaRegen` bonus (which starts at 0) gets +2, matching upstream's default x2. |
| faithful_staff | `cast` proc with the new `towerCast` filter: 1 experience to the carrier and 1 to the target tower (`xp` with `toCastTarget`). | Exact for tower-targeted autocasts (`target: 'tower'`). Self-cast autocasts do not count: here `self` also covers untargeted area casts, which have no target upstream. |
| wand_of_mana_zap | `damage` proc, `drainCreepMana`: (8 + 0.6 x level x base cooldown) x 55 / range^0.6 mana from the main target (range in YouTD units). | Formula exact. Creep mana is new (see below): only warded creeps carry it, and their ward needs 10+ mana, like YouTD's Magic Immunity. The lightning visual reuses `spellChain`. |
| pendant_of_promptness | Item field `attackManaPct: 0.05`. The +75% (+1%/lvl) attack speed comes from the item row. Each attack spends 5% of max mana before firing; without it the attack fizzles (cooldown spent, no projectile, no attack procs). | Exact. Manaless towers never attack, as upstream (5% of 0 is 0, and upstream stops the attack then). |
| circle_of_power | Periodic proc every 5s, `restoreMana { chance: 0.25 }`: if mana dropped since the previous check, 25% (scaled by trigger chance) to set it back; otherwise remember the current mana. | Exact. The memory is stored on the item and reset when the carrier changes or the memory is stale (item moved), which stands in for upstream's on-pickup hook. |
| forcefield_generator | Aura `debuffDur` -15% (-1%/carrier level) on towers within 200, carrier included. | Approximate target set: towers here receive debuffs only as timed `towerBuff`s whose mods are all negative (Hangover, Exhausted, Playtime, Tricky Weapon, ...). Those are now shortened by the receiver's `debuffDur`. |

`forcefield_generator` was not in the earlier skip table because it only has an aura row; its
script is a single `MOD_DEBUFF_DURATION -0.15 / -0.01` aura on towers.

## New engine primitives

- Proc trigger `damage` (`src/sim/game.js` `resolveHit`, `src/sim/abilities.js`): runs before an
  attack's main hit lands, with `ctx.hit = { damage, spell }`. Only towers with such a proc
  (`t.hasDamageProcs`, set in `recalcAll`) allocate the context; other hits are unchanged.
  Splash and chain hits are not main hits and are not modified.
- Effect `modifyHit` (abilities.js): `mult`, `healthMult: [atZero, atFull]`, `regenMult`, `floor`
  (raise to the carrier's average attack damage after the attack multiplier), `toSpell` (share
  moved into a spell damage instance that lands after the attack part).
- Cast context `targetTower` (abilities.js `castActive`) for actives with `target: 'tower'`, proc
  filter `towerCast`, and `xp` option `toCastTarget`.
- Creep mana (game.js `spawnCreep`): warded creeps get `mana`/`maxMana` by size (YouTD values:
  mass 100, normal 200, air 400, champion 300, boss 2000, challenge mass 100, challenge 3000).
  The ward (arcane immunity and 60% spell resistance) holds while mana is at least 10. Nothing
  else changes creep mana, so play without the wand is unchanged.
- Effect `drainCreepMana` (abilities.js): `amount`, `amountPerLevel`, `perLevelByCd`, `rangeRef`,
  `rangeExp`.
- Effect `restoreMana` (abilities.js): `chance`, `every`, `label`; memory on the item.
- Item field `attackManaPct` (items.js, read in `computeStats` as `stats.attackManaPct`, applied in
  the attack loop of `updateTowers`).
- Stat `stats.debuffDur` (computeStats) and debuff shortening in `towerBuff` for all-negative mods.
  This also gives the data-only items with `MOD_DEBUFF_DURATION` (Divine Shield, Obsidian
  Figurine, Sacred Halo, Pure Aether, Bhaal's Essence) a real effect.
- Descriptions: `describeSkill` knows the `damage` trigger and `towerCast`; `describeEffect` covers
  the new effects; `describeItem` prints the attack mana cost; `describeMods` labels `debuffDur`
  as "duration of debuffs received".

## Validation

- Pending list (acceptance 1): only the 12 items owned by the other two groups remain.
- Descriptions (acceptance 2), e.g.
  - "Elune's Grace (100% on hit): the hit deals at least the carrier's attack damage, whatever the armor."
  - "Infuse with Regeneration (Every 5th hit): the hit is multiplied by 2 plus the carrier's mana regeneration bonus."
  - "Reward the Faithful (100% after casting on a tower): grants 1 experience. Grants 1 experience to the target tower."
  - "Each attack costs 5% of the carrier's max mana; without that much mana the attack fizzles, so towers without mana cannot attack."
  - "Aura: towers within 2.1 gain -15% duration of debuffs received (-1% duration of debuffs received per level)."
- Runtime check (throwaway script, sandbox mode, 11 towers, one item each, warded creeps on even
  waves, 16 waves at 1/60 steps): no exceptions, no non-finite stats or damage, no negative tower
  mana, creep mana or gold. Evidence:
  - Control tower: attack amount / rolled base = 1.000.
  - Elune: 54 of 127 hits raised; example base 15.9 -> 27.8 pre-armor, x0.571 multiplier = 15.9 dealt (= average attack damage); minimum dealt / average = 1.000.
  - Phase Gloves: non-crit ratio 0.700; 122 spell parts, e.g. attack 6.4 + spell 3.1 (expected 3.1).
  - Optimist: max error vs 0.5 + 1.25 x health ratio = 0.0000 (1.744 near full health, 0.628 at 10%).
  - Sign: 8 of 43 non-crit hits boosted, each x2.000 (no regen bonus); 8 proc events.
  - Faithful Staff: 12 Wind Shear casts on towers, 24 experience grants (carrier + target).
  - Mana Zap: deterministic check, warded normal creep 200 mana, level 0 tower: ward broke after
    24 hits (mana 8.66), spell multiplier 0.400 -> 1.000. In waves: 52 warded creeps drained.
  - Pendant: manaless tower 0 attacks; 250-mana tower 85 attacks (control 137), minimum mana 5.75.
  - Circle of Power: 9 restores.
  - Forcefield: towers in range have `debuffDur` -0.15; an 8s harmful buff lasts 6.80s inside
    vs 8.00s outside; a positive 8s buff inside stays 8.00s.
- `npx vite build`: passes.
- Balance bot `DIFF=medium SEED=1 A=fire B=storm CAP=10`: wave 45 before and after (identical
  kills 319, score 21210). Seed 2: wave 51.

## Open questions

- `src/sim/waves.js` (not edited here) still describes Warded as "Immune to arcane attacks; spells
  deal 40% damage." Suggest appending "while it has 10+ mana" now that the ward runs on mana.
- `src/data/youtd/mods.js` (not edited here) labels `debuffDur` "debuff duration on creeps", which
  is wrong for YouTD (it is the duration of debuffs the unit receives). `describeMods` overrides it
  for item auras and oils; level-mod lines of data-only items still use the old label.
- `docs/youtd-port.md` was left for the controller (three groups edit the same status table and
  primitives list). Suggested primitives bullet: "Phase 4: trigger `damage` with effect
  `modifyHit` (`mult`, `healthMult`, `regenMult`, `floor`, `toSpell`); cast filter `towerCast` and
  `xp.toCastTarget`; creep mana on warded creeps with `drainCreepMana`; `restoreMana`; item field
  `attackManaPct`; tower stat `debuffDur` shortens all-negative tower buffs."
- Should `damage` procs also apply to chain (bounce) hits? Upstream bounce attacks fire the
  on-damage event per bounce; here only the main hit is modified.
