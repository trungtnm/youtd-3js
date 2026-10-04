// Core game definitions: elements, rarities, damage matrix, creep taxonomy, difficulty.

export const ELEMENTS = {
  nature:   { id: 'nature',   name: 'Nature',   color: 0x6fdc4a, css: '#6fdc4a', glyph: '❦' },
  fire:     { id: 'fire',     name: 'Fire',     color: 0xff6a1f, css: '#ff6a1f', glyph: '♨' },
  ice:      { id: 'ice',      name: 'Ice',      color: 0x7fd8ff, css: '#7fd8ff', glyph: '❄' },
  storm:    { id: 'storm',    name: 'Storm',    color: 0xb18cff, css: '#b18cff', glyph: 'ϟ' },
  iron:     { id: 'iron',     name: 'Iron',     color: 0xc9b48a, css: '#c9b48a', glyph: '⚙' },
  astral:   { id: 'astral',   name: 'Astral',   color: 0xffe36b, css: '#ffe36b', glyph: '✦' },
  darkness: { id: 'darkness', name: 'Darkness', color: 0xc04dff, css: '#c04dff', glyph: '☾' },
};
export const ELEMENT_IDS = Object.keys(ELEMENTS);

export const RARITIES = {
  common:   { id: 'common',   name: 'Common',   idx: 0, color: 0xb8c0c8, css: '#b8c0c8', food: 1, slots: 6 },
  uncommon: { id: 'uncommon', name: 'Uncommon', idx: 1, color: 0x4fe08a, css: '#4fe08a', food: 1, slots: 6 },
  rare:     { id: 'rare',     name: 'Rare',     idx: 2, color: 0x4aa8ff, css: '#4aa8ff', food: 1, slots: 6 },
  unique:   { id: 'unique',   name: 'Unique',   idx: 3, color: 0xffa42b, css: '#ffa42b', food: 1, slots: 6 },
};
export const RARITY_IDS = Object.keys(RARITIES);

export const ATTACK_TYPES = {
  physical:  { id: 'physical',  name: 'Physical',  css: '#d9c39a' },
  decay:     { id: 'decay',     name: 'Decay',     css: '#a98bff' },
  energy:    { id: 'energy',    name: 'Energy',    css: '#4fb3ff' },
  elemental: { id: 'elemental', name: 'Elemental', css: '#6aa0ff' },
  essence:   { id: 'essence',   name: 'Essence',   css: '#6ff0c8' },
  arcane:    { id: 'arcane',    name: 'Arcane',    css: '#5fd8ff' },
};

export const ARMOR_TYPES = {
  hide:   { id: 'hide',   name: 'Hide',   css: '#c58a52' },
  chain:  { id: 'chain',  name: 'Chain',  css: '#9fb4c8' },
  plate:  { id: 'plate',  name: 'Plate',  css: '#e2e6ee' },
  spirit: { id: 'spirit', name: 'Spirit', css: '#9df0ff' },
  divine: { id: 'divine', name: 'Divine', css: '#ffd75e' },
  bare:   { id: 'bare',   name: 'Bare',   css: '#e88' },
};
export const REGULAR_ARMORS = ['hide', 'chain', 'plate', 'spirit'];

// Each regular attack type is strong against one armor, decent against one,
// weak against two. Essence is the only reliable answer to divine armor.
export const DAMAGE_MATRIX = {
  physical:  { hide: 1.8, chain: 1.2, spirit: 0.9, plate: 0.6, divine: 0.4, bare: 1.0 },
  decay:     { chain: 1.8, plate: 1.2, hide: 0.9, spirit: 0.6, divine: 0.4, bare: 1.0 },
  energy:    { plate: 1.8, spirit: 1.2, chain: 0.9, hide: 0.6, divine: 0.4, bare: 1.0 },
  elemental: { spirit: 1.8, hide: 1.2, plate: 0.9, chain: 0.6, divine: 0.4, bare: 1.0 },
  essence:   { hide: 1.0, chain: 1.0, plate: 1.0, spirit: 1.0, divine: 1.0, bare: 1.0 },
  arcane:    { hide: 1.5, chain: 1.5, plate: 1.5, spirit: 1.5, divine: 0.4, bare: 1.5 },
};

export const RACES = {
  undead:   { id: 'undead',   name: 'Undead',   css: '#9ee6a0' },
  brute:    { id: 'brute',    name: 'Brute',    css: '#e07a4a' },
  humanoid: { id: 'humanoid', name: 'Humanoid', css: '#e8d6a8' },
  arcane:   { id: 'arcane',   name: 'Arcane',   css: '#8fb8ff' },
  feral:    { id: 'feral',    name: 'Feral',    css: '#b6e04a' },
};
export const RACE_IDS = Object.keys(RACES);

// hp: multiplier of wave base HP, leak: % of portal integrity lost,
// bounty: gold multiplier, xp: tower experience granted, drops: item roll count.
export const SIZES = {
  mass:      { id: 'mass',      name: 'Mass',      hp: 0.38, speed: 1.0,  leak: 1,  bounty: 0.4, xp: 1,  drops: 1,  scale: 0.62, score: 1 },
  normal:    { id: 'normal',    name: 'Normal',    hp: 1.0,  speed: 1.0,  leak: 2,  bounty: 1.0, xp: 2,  drops: 2,  scale: 0.9,  score: 2 },
  air:       { id: 'air',       name: 'Air',       hp: 1.3,  speed: 0.95, leak: 4,  bounty: 1.8, xp: 4,  drops: 4,  scale: 0.95, score: 4 },
  champion:  { id: 'champion',  name: 'Champion',  hp: 3.2,  speed: 0.9,  leak: 5,  bounty: 3.0, xp: 4,  drops: 4,  scale: 1.25, score: 4 },
  boss:      { id: 'boss',      name: 'Boss',      hp: 9,    speed: 0.75, leak: 20, bounty: 12,  xp: 20, drops: 20, scale: 1.9,  score: 20 },
  challenge: { id: 'challenge', name: 'Challenge', hp: 26,   speed: 0.7,  leak: 0,  bounty: 18,  xp: 40, drops: 40, scale: 2.4,  score: 200 },
  challengeMass: { id: 'challengeMass', name: 'Challenge', hp: 1.6, speed: 1.05, leak: 0, bounty: 1.2, xp: 3, drops: 3, scale: 0.75, score: 20 },
};

export const DIFFICULTIES = {
  beginner: { id: 'beginner', name: 'Beginner', hp: 0.62, armor: 0.6, gold: 1.25, desc: 'Gentle curve. Learn the elements.' },
  easy:     { id: 'easy',     name: 'Easy',     hp: 0.8,  armor: 0.8, gold: 1.1,  desc: 'Forgiving, with room to experiment.' },
  medium:   { id: 'medium',   name: 'Medium',   hp: 1.0,  armor: 1.0, gold: 1.0,  desc: 'The intended experience.' },
  hard:     { id: 'hard',     name: 'Hard',     hp: 1.15, armor: 1.25, gold: 0.95, desc: 'Tight economy. Every tome matters.' },
  extreme:  { id: 'extreme',  name: 'Extreme',  hp: 1.25, armor: 1.5, gold: 0.9,  desc: 'For veterans of the maze.' },
};

export const LENGTHS = {
  trial:     { id: 'trial',     name: 'Trial',     waves: 80,  desc: '80 waves' },
  full:      { id: 'full',      name: 'Full',      waves: 120, desc: '120 waves' },
  endless:   { id: 'endless',   name: 'Endless',   waves: Infinity, desc: 'Until the portal falls' },
};

export const MODES = {
  build:  { id: 'build',  name: 'Build',  desc: 'Build any tower your element research has unlocked.' },
  random: { id: 'random', name: 'Random', desc: 'Each wave grants random towers to your stash. Upgrades stay free to pick.' },
};

// Challenge modifiers: each makes a run harder in one way and raises the score
// earned. They are unlocked by achievements and never add power.
export const MODIFIERS = {
  glass:  { id: 'glass',  name: 'Glass Portal', desc: 'Portal integrity starts and caps at 30.', score: 0.3 },
  frugal: { id: 'frugal', name: 'Frugal',       desc: 'No interest is paid at the end of a wave.', score: 0.2 },
  swarm:  { id: 'swarm',  name: 'Swarm',        desc: 'Creeps move 15% faster.', score: 0.25 },
  naked:  { id: 'naked',  name: 'No Items',     desc: 'Creeps drop no items and boss spoils never offer items or oils.', score: 0.35 },
};

export const ECON = {
  startGold: 90,
  startTomes: 24,
  stashSize: 40,
  itemSlotEvery: 10,        // every tower starts with 1 item slot, +1 every N waves, up to 6
  trainBase: 40,            // gold cost of a training session, scales with level
  trainXpPct: 0.35,         // fraction of the current level's requirement granted per session
  tomesPerWave: 5,
  researchBase: 5,          // research cost = base + current level
  maxElementLevel: 15,
  interestRate: 0.02,       // paid on banked gold at wave end
  interestCap: 0.02 * 3000,
  sellRefund: 0.75,
  earlyCallBonus: 0.5,      // gold per second skipped from the wave countdown
  waveGap: 22,              // seconds between waves when not called early (auto waves on)
  clearGap: 5,              // breather after the field is clear before the next wave (auto waves off)
  rollCount: 3,             // random mode: towers granted per wave
  rerollCost: 2,            // random mode: tomes per reroll
};

export const TOWER_MAX_LEVEL = 30;
// Experience needed to go from level n to n+1. Quadratic up to level 15, then
// linear so the climb to the level 30 cap stays within reach of a full run.
export const xpForLevel = (lvl) => Math.round(12 + lvl * 9 + lvl * Math.min(lvl, 15) * 1.6);

export const ARMOR_REDUCTION = (armor) => armor >= 0
  ? (0.05 * armor) / (1 + 0.05 * armor)
  : -(1 - Math.pow(0.94, -armor));
