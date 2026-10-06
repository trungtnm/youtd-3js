# Game design

The game is about training a few champion towers, not about covering the map with
towers. There is no tower limit, but untrained and unequipped towers are weak.

## Run setup

- Difficulty: Beginner, Easy, Medium, Hard, Extreme (`DIFFICULTIES` in
  `src/data/constants.js`). Each scales creep health, armor and gold.
- Mode: Build (any researched tower) or Random (towers are drafted into a stash
  each wave).
- Length: 80 waves, 120 waves, or endless.
- Challenge modifiers (`MODIFIERS` in `src/data/constants.js`), unlocked by
  achievements: Glass Portal (integrity capped at 30, +30% score), Frugal (no
  interest, +20%), Swarm (creeps 15% faster, +25%) and No Items (no drops or item
  spoils, +35%). Multipliers add up. Records are kept per modifier set.
- God mode (testing): every element mastered, 10M gold, 2000 tomes. Nothing is
  recorded.

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
  gold sink once the core towers are built. **Train Max** (Shift+T) repeats
  Train until gold runs out or the tower reaches level 30.
- **Perks**: every 5 levels the tower offers three perks and keeps one
  (`src/data/tower-perks.js`), six in all. Strong perks unlock at levels 20,
  25 and 30, with Living Legend reserved for the cap; three
  repeatable perks keep late milestones useful. Towers with a perk waiting are
  listed in the "Perks to choose" toast.
- **Items**: every tower has 6 slots. All towers start with 1 open slot and gain
  one every 10 waves (6 at wave 50). There is no limit on unique items per tower.
  Oils are consumed into a tower permanently. Three items of one rarity can be
  transmuted into a random item of the next rarity.
- Auto transmute (Items panel menu, off by default, remembered in settings): the
  player picks which of common, uncommon and rare to combine. Whenever an item
  reaches the stash, spare equipment of those rarities is combined in threes, cheapest first, and the results can cascade. This
  covers every source: creep drops, item and tower skills, Pocket Emporium
  purchases, boss spoils and Strange Item copies. Uniques, oils, consumables,
  items with grown stats and item copies held by another item are never used.
  It also runs when an item returns to the stash from a tower (unequip, swap or
  sell), and those items count as spare again.

## Waves

- Sizes: mass, normal (with champions), air, boss. Every 8th wave is a challenge
  wave that cannot damage the portal.
- Races: undead, brute, humanoid, arcane, feral. Armor: hide, chain, plate,
  spirit, divine, bare (see the damage matrix in `constants.js`).
- Specials such as swift, armored, regenerating, shielded, warded, splitter,
  blinking and invisible. Invisible creeps can only be targeted inside a
  revealing tower's range (the Small Light family).
- The incoming panel shows the active wave and the next three.
- Auto waves (top bar toggle, off by default, remembered in settings). Off: the
  next wave starts 5 seconds (`ECON.clearGap`) after every active wave has been
  killed or has leaked. On: waves also arrive on a countdown (`ECON.waveGap` plus
  the spawn time) while earlier waves are still alive. Calling a wave early
  always works and pays bonus gold for the skipped time; with auto waves off,
  calling during a wave counts as skipping a full `waveGap`.

## Boss spoils

Killing a boss (or a challenge boss) offers three rewards; the player keeps one.
One option is always a rolled rare-or-better item. The others come from gold,
tomes, experience for all towers, an oil, portal repair, or levels for the
highest-level tower still below the cap (`src/data/boss-spoils.js`).

## Progression across runs

Meta progression never adds power: a fresh profile and a full one play the same
game. What carries over is a profile with records, the last 25 runs, lifetime
totals and achievements (`src/data/achievements.js`, 32 in five categories).
Achievements unlock titles (shown on the menu and end screen), the challenge
modifiers above, and crests that float over towers at level 30.

- "Clear wave N" counts waves cleared in order, not waves called early.
- A win needs every wave of the run's length cleared. An Endless run wins once
  it clears wave 120 (`ENDLESS_GOAL`): from then on the portal falling ends it as
  a victory, and End run (top bar, or Abandon run in Settings) banks it early. A
  run continued after victory works the same way. Integrity goals read the portal
  at the moment of victory, or at wave 120 for Endless.
- Abandoned runs count toward history and totals but earn achievements only
  from 10 cleared waves on. Closed tabs are not recorded.

The end screen shows an overview with the MVP (most damage), a sortable tower
table including sold towers, damage by element, attack type and spells, portal
damage by creep size, race and wave, gold and tomes spent, and the achievements
earned with the next goals. The Hall of Records holds the rest and offers
export, import and reset.

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
