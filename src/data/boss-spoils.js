// Boss spoils: when a boss falls the player picks one of three rewards.
// One option is always a rolled item of rare quality or better; the other two
// come from this pool. `value(game)` sizes the reward to the current wave.
import { TOWER_MAX_LEVEL } from './constants.js';

export const SPOILS = {
  gold:    { name: 'Warlord\'s Hoard', icon: '💰', weight: 3, value: (g) => Math.round(60 + g.level * 30), desc: (v) => `Gain ${v} gold.` },
  tomes:   { name: 'Forbidden Library', icon: '📚', weight: 3, value: (g) => 4 + Math.floor(g.level / 15), desc: (v) => `Gain ${v} knowledge tomes.` },
  wisdom:  { name: 'Battle Wisdom', icon: '🎓', weight: 3, value: () => 0.6, desc: () => 'Every tower gains 60% of a level\'s experience.' },
  oil:     { name: 'Alchemist\'s Cache', icon: '⚗', weight: 2, value: () => 0, desc: () => 'Receive a rare or unique oil.' },
  mend:    { name: 'Portal Mending', icon: '🔷', weight: 2, value: () => 20, desc: (v) => `Restore ${v}% portal integrity.`, when: (g) => g.lives <= g.maxLives * 0.85 },
  hero:    { name: 'Champion\'s Trial', icon: '🏆', weight: 2, value: (g) => 2 + Math.floor(g.level / 30), desc: (v) => `Your highest-level tower below level ${TOWER_MAX_LEVEL} instantly gains ${v} levels.`, when: (g) => [...g.towers.values()].some((t) => t.level < TOWER_MAX_LEVEL) },
};

export const SPOIL_IDS = Object.keys(SPOILS);
