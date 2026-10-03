# Game design

The game is about training a few champion towers, not about covering the map with
towers. There is no tower limit, but untrained and unequipped towers are weak.

## Run setup

- Difficulty: Beginner, Easy, Medium, Hard, Extreme (`DIFFICULTIES` in
  `src/data/constants.js`). Each scales creep health, armor and gold.
- Mode: Build (any researched tower) or Random (towers are drafted into a stash
  each wave).
- Length: 80 waves, 120 waves, or endless.

## Economy

| Resource | Source | Spent on |
|---|---|---|
| Gold | Kill bounty, wave income, interest, boss spoils | Towers, upgrades, training |
| Knowledge tomes | 5 per wave (+2 every 10th wave), books, boss spoils | Element research, uncommon/rare/unique towers |

- Element research levels 0-15. A tower requires the element level given by its
  gold cost (the original YouTD thresholds: 140, 215, 345, ... 3500 gold).
- Tower tome costs: common 0, uncommon 4, rare 10, unique 25.
- The shop lists only the first tier of each family. Higher tiers are reached by
  upgrading a built tower, which costs the full price of the next tier and keeps
  level, experience, perks and items.

## Tower growth

- **Levels** (0-30): level 30 is the goal for a run's carries. Experience comes
  mostly from kills (the killer gets half, the rest is split by damage dealt).
  The per-level requirement grows quadratically up to level 15 and linearly
  after it, so about 13,800 experience reaches the cap. Damage multiplier is
  `0.35 + 0.13 * level`, plus `0.05` per level above 20 (35% at level 0, 100%
  at 5, about 295% at 20, about 475% at 30). Attack speed rises 2% per level.
  YouTD per-level stat bonuses also apply. With `CAP=10` the bot's top tower
  reaches 30 around wave 60-80 when the run lasts that long.
- **Train**: spend gold for 35% of the current level's experience. Cost grows
  with level and 2% per session already spent on that tower. This is the main
  gold sink once the core towers are built.
- **Perks**: every 5 levels the tower offers three perks and keeps one
  (`src/data/tower-perks.js`), six in all. Strong perks unlock at levels 20,
  25 and 30, with Living Legend reserved for the cap; three
  repeatable perks keep late milestones useful. Towers with a perk waiting are
  listed in the "Perks to choose" toast.
- **Items**: every tower has 6 slots. All towers start with 1 open slot and gain
  one every 10 waves (6 at wave 50). A tower may carry only one unique item.
  Oils are consumed into a tower permanently. Three items of one rarity can be
  transmuted into a random item of the next rarity.

## Waves

- Sizes: mass, normal (with champions), air, boss. Every 8th wave is a challenge
  wave that cannot damage the portal.
- Races: undead, brute, humanoid, arcane, feral. Armor: hide, chain, plate,
  spirit, divine, bare (see the damage matrix in `constants.js`).
- Specials such as swift, armored, regenerating, shielded, warded, splitter,
  blinking and invisible. Invisible creeps can only be targeted inside a
  revealing tower's range (the Small Light family).
- The incoming panel shows the active wave and the next three.

## Boss spoils

Killing a boss (or a challenge boss) offers three rewards; the player keeps one.
One option is always a rolled rare-or-better item. The others come from gold,
tomes, experience for all towers, an oil, portal repair, or levels for the
highest-level tower still below the cap (`src/data/boss-spoils.js`).

## Balance targets

Measured with the balance bot focusing about 10 towers in two elements
(`CAP=10 node tools/balance.js`), after the fourth porting pass (all 690 tower and 315 item scripts ported, see
[youtd-port.md](youtd-port.md)):

| Difficulty | Bot reaches |
|---|---|
| Beginner | wave ~91-100 |
| Medium | waves ~45-71 (fire/storm seeds 1-3, ice/astral 46-51) |
| Hard | wave ~39-43 |
| Extreme | wave ~29-33 |

The bot builds first tiers and upgrades, ignores armor matchups and never casts
manually, so human players should reach further. Many ports are still
approximations; rerun the bot after engine primitives replace them. The health curve lives in
`baseHp()` in `src/sim/waves.js`.
