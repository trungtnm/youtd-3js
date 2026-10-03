// Achievements and the unlocks they grant. Unlocks never add power: titles are
// shown on the menu and end screen, modifiers make runs harder for score, and
// crests decorate towers at the level cap.
//
// Each achievement uses one of:
//   test(sum)    → true when a single run earns it
//   counter(sum) → number added to progress each run; earned at `target`
//   collect(sum) → keys added to a set in progress; earned when it holds `target`
// `sum` is Game.summary(). "Clear wave N" always reads wavesCleared (waves
// cleared in order), never level (waves called).

import { TOWER_MAX_LEVEL } from './constants.js';

const mods = (s) => s.cfg.modifiers || [];
const has = (s, id) => mods(s).includes(id);
// A run continued after victory was won, even if it later fell.
const won = (s) => s.outcome === 'won' || s.continued;
const share = (part, s) => (s.damage > 0 ? part / s.damage : 0);
const mvp = (s) => s.towerLedger.find((t) => t.uid === s.mvp);
const capped = (s) => s.towerLedger.filter((t) => !t.sold && t.level >= TOWER_MAX_LEVEL).length;

export const ACHIEVEMENT_CATEGORIES = {
  progress: 'Progress', mastery: 'Mastery', challenge: 'Challenge', collection: 'Collection', quirky: 'Quirky',
};

export const ACHIEVEMENTS = [
  // Progress
  { id: 'first-stand', cat: 'progress', icon: '🛡', name: 'First Stand', desc: 'Clear wave 10.', test: (s) => s.wavesCleared >= 10 },
  { id: 'holding-line', cat: 'progress', icon: '🧱', name: 'Holding the Line', desc: 'Clear wave 40.', test: (s) => s.wavesCleared >= 40, reward: { modifier: 'glass' } },
  { id: 'deep-defense', cat: 'progress', icon: '🏰', name: 'Deep Defense', desc: 'Clear wave 80.', test: (s) => s.wavesCleared >= 80 },
  { id: 'portal-keeper', cat: 'progress', icon: '🗝', name: 'Portal Keeper', desc: 'Win a Trial run.', test: (s) => won(s) && s.cfg.length === 'trial', reward: { title: 'keeper' } },
  { id: 'warden', cat: 'progress', icon: '⚜', name: 'Warden of the Full March', desc: 'Win a Full run.', test: (s) => won(s) && s.cfg.length === 'full', reward: { title: 'warden' } },
  { id: 'endless-vigil', cat: 'progress', icon: '♾', name: 'Endless Vigil', desc: 'Clear wave 150, in Endless or after continuing a won run.', test: (s) => s.wavesCleared >= 150, reward: { crest: 'eternal' } },
  { id: 'medium-victory', cat: 'progress', icon: '🥉', name: 'Medium Victory', desc: 'Win on Medium.', test: (s) => won(s) && s.cfg.difficulty === 'medium' },
  { id: 'hard-victory', cat: 'progress', icon: '🥈', name: 'Hard Victory', desc: 'Win on Hard.', test: (s) => won(s) && s.cfg.difficulty === 'hard' },
  { id: 'extreme-victory', cat: 'progress', icon: '🥇', name: 'Extreme Victory', desc: 'Win on Extreme.', test: (s) => won(s) && s.cfg.difficulty === 'extreme', reward: { title: 'unbroken', crest: 'obsidian' } },

  // Mastery
  { id: 'ascended', cat: 'mastery', icon: '👑', name: 'Ascended', desc: `Bring a tower to level ${TOWER_MAX_LEVEL}.`, test: (s) => s.towerLedger.some((t) => t.level >= TOWER_MAX_LEVEL), reward: { crest: 'gilded' } },
  { id: 'trinity', cat: 'mastery', icon: '🔱', name: 'Trinity', desc: `End a run with 3 towers at level ${TOWER_MAX_LEVEL}.`, test: (s) => capped(s) >= 3 },
  { id: 'champion-carry', cat: 'mastery', icon: '🏋', name: 'Champion Carry', desc: 'Clear wave 30 with your MVP dealing at least half of all damage.', test: (s) => s.wavesCleared >= 30 && share(mvp(s)?.damage || 0, s) >= 0.5 },
  { id: 'clean-thirty', cat: 'mastery', icon: '✨', name: 'Clean Thirty', desc: 'Clear wave 30 without the portal taking damage before it.', test: (s) => s.wavesCleared >= 30 && !s.leakWaves.some((w) => w < 30), reward: { crest: 'ember' } },
  { id: 'untouchable', cat: 'mastery', icon: '💎', name: 'Untouchable', desc: 'Win with the portal at full integrity.', test: (s) => won(s) && s.lives >= s.maxLives },
  { id: 'spellweaver', cat: 'mastery', icon: '🔮', name: 'Spellweaver', desc: 'Clear wave 30 with spells dealing at least 40% of all damage.', test: (s) => s.wavesCleared >= 30 && share(s.damageByAttack.spell || 0, s) >= 0.4 },
  { id: 'lean-defense', cat: 'mastery', icon: '🪶', name: 'Lean Defense', desc: 'Clear wave 60 having built at most 6 towers.', test: (s) => s.wavesCleared >= 60 && s.towerLedger.length <= 6 },

  // Challenge: each one unlocks the next modifier
  { id: 'glass-portal', cat: 'challenge', icon: '🔹', name: 'Glass Portal', desc: 'Clear wave 40 with the Glass Portal modifier.', test: (s) => has(s, 'glass') && s.wavesCleared >= 40, reward: { modifier: 'frugal' } },
  { id: 'no-interest', cat: 'challenge', icon: '🪙', name: 'No Interest', desc: 'Clear wave 40 with the Frugal modifier.', test: (s) => has(s, 'frugal') && s.wavesCleared >= 40, reward: { modifier: 'swarm' } },
  { id: 'swarm-breaker', cat: 'challenge', icon: '🐝', name: 'Swarm Breaker', desc: 'Clear wave 40 with the Swarm modifier.', test: (s) => has(s, 'swarm') && s.wavesCleared >= 40, reward: { modifier: 'naked' } },
  { id: 'bare-hands', cat: 'challenge', icon: '✊', name: 'Bare Hands', desc: 'Clear wave 30 with the No Items modifier.', test: (s) => has(s, 'naked') && s.wavesCleared >= 30 },
  { id: 'stacked-odds', cat: 'challenge', icon: '🎲', name: 'Stacked Odds', desc: 'Win with three modifiers active.', test: (s) => won(s) && mods(s).length >= 3, reward: { title: 'daredevil' } },

  // Collection
  { id: 'elementalist', cat: 'collection', icon: '🌈', name: 'Elementalist', desc: 'Clear wave 40 with an MVP of each of the 7 elements, across runs.', collect: (s) => (s.wavesCleared >= 40 && mvp(s) ? [mvp(s).element] : []), target: 7, reward: { title: 'elementalist' } },
  { id: 'hoarder', cat: 'collection', icon: '🎒', name: 'Hoarder', desc: 'Find 500 items in total.', counter: (s) => s.items, target: 500 },
  { id: 'unique-taste', cat: 'collection', icon: '🍷', name: 'Unique Taste', desc: 'Carry 4 unique items at once.', test: (s) => s.peakUniquesCarried >= 4 },
  { id: 'transmuter', cat: 'collection', icon: '⚗', name: 'Transmuter', desc: 'Transmute 50 times in total.', counter: (s) => s.transmutes, target: 50 },
  { id: 'bounty-hunter', cat: 'collection', icon: '☠', name: 'Bounty Hunter', desc: 'Kill 100 bosses in total.', counter: (s) => s.bossKills, target: 100 },
  { id: 'veteran', cat: 'collection', icon: '🎖', name: 'Veteran', desc: 'Play 25 runs.', counter: () => 1, target: 25, reward: { title: 'veteran' } },
  { id: 'gambler', cat: 'collection', icon: '🃏', name: 'Gambler', desc: 'Win a Random mode run.', test: (s) => won(s) && s.cfg.mode === 'random', reward: { crest: 'dice' } },

  // Quirky
  { id: 'impatient', cat: 'quirky', icon: '⏩', name: 'Impatient', desc: 'Call 30 waves early in one run.', test: (s) => s.earlyCalls >= 30 },
  { id: 'scholar-of-war', cat: 'quirky', icon: '📜', name: 'Scholar of War', desc: 'Spend 20,000 gold on training in one run.', test: (s) => s.goldSpent.train >= 20000 },
  { id: 'close-call', cat: 'quirky', icon: '😅', name: 'Close Call', desc: 'Win with the portal at 10% integrity or less.', test: (s) => won(s) && s.lives / s.maxLives <= 0.1 },
  { id: 'speed-run', cat: 'quirky', icon: '⏱', name: 'Speed Run', desc: 'Win a Trial run in under 28 minutes of game time.', test: (s) => won(s) && s.cfg.length === 'trial' && s.time < 28 * 60 },
];

export const ACHIEVEMENT_BY_ID = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));

// Each unlock names the achievement that grants it (kept in sync by the reward fields above).
export const UNLOCKS = {
  titles: {
    keeper: { name: 'Keeper', from: 'portal-keeper' },
    warden: { name: 'Warden', from: 'warden' },
    unbroken: { name: 'Unbroken', from: 'extreme-victory' },
    daredevil: { name: 'Daredevil', from: 'stacked-odds' },
    elementalist: { name: 'Elementalist', from: 'elementalist' },
    veteran: { name: 'Veteran', from: 'veteran' },
  },
  modifiers: {
    glass: { from: 'holding-line' },
    frugal: { from: 'glass-portal' },
    swarm: { from: 'no-interest' },
    naked: { from: 'swarm-breaker' },
  },
  crests: {
    gilded: { name: 'Gilded', desc: 'A gold ring that turns slowly.', from: 'ascended' },
    ember: { name: 'Ember', desc: 'A flickering orange ring.', from: 'clean-thirty' },
    eternal: { name: 'Eternal', desc: 'Twin rings turning against each other.', from: 'endless-vigil' },
    obsidian: { name: 'Obsidian', desc: 'A dark ring with a violet glow.', from: 'extreme-victory' },
    dice: { name: 'Dice', desc: 'A small floating die.', from: 'gambler' },
  },
};
