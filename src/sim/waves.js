// Wave generation: size, race, armor, champions, specials and health curve.

import { DIFFICULTIES, RACE_IDS, REGULAR_ARMORS } from '../data/constants.js';

export const SPECIALS = {
  swift:      { id: 'swift',      name: 'Swift',        css: '#7ff', desc: 'Moves 35% faster.', min: 6 },
  armored:    { id: 'armored',    name: 'Armored',      css: '#ccd', desc: 'Much higher armor.', min: 8 },
  regen:      { id: 'regen',      name: 'Regenerating', css: '#7f7', desc: 'Regenerates 1.2% health per second.', min: 10 },
  shielded:   { id: 'shielded',   name: 'Shielded',     css: '#8cf', desc: 'A barrier absorbs damage equal to 30% of health.', min: 12 },
  warded:     { id: 'warded',     name: 'Warded',       css: '#c9f', desc: 'Immune to arcane attacks and spells deal 40% damage while it has 10+ mana.', min: 16 },
  rich:       { id: 'rich',       name: 'Rich',         css: '#fd5', desc: 'Drops double gold.', min: 4 },
  wise:       { id: 'wise',       name: 'Wise',         css: '#9cf', desc: 'Grants double experience; may drop tomes.', min: 4 },
  splitter:   { id: 'splitter',   name: 'Splitter',     css: '#fa7', desc: 'Splits into two lesser creeps on death.', min: 14, noSize: ['mass', 'boss', 'challenge'] },
  blink:      { id: 'blink',      name: 'Blinking',     css: '#d8f', desc: 'Periodically teleports forward.', min: 18 },
  evasive:    { id: 'evasive',    name: 'Evasive',      css: '#eef', desc: 'Dodges 20% of attacks.', min: 20 },
  frenzy:     { id: 'frenzy',     name: 'Frenzied',     css: '#f77', desc: 'Moves faster as it loses health.', min: 22 },
  unyielding: { id: 'unyielding', name: 'Unyielding',   css: '#fb8', desc: 'Slows and stuns are 60% weaker.', min: 26 },
  healer:     { id: 'healer',     name: 'Mending Aura', css: '#afa', desc: 'Champions heal nearby creeps.', min: 15, needsChampion: true },
  invisible:  { id: 'invisible',  name: 'Invisible',    css: '#b8f0ff', desc: 'Cannot be targeted unless inside the detection range of a revealing tower (Shadow Eye, Star Lens, Seer\'s Obelisk). Area damage still hits it.', min: 10, noSize: ['boss', 'challenge'] },
  raider:     { id: 'raider',     name: 'Relic Raider', css: '#fc6', desc: 'Steals 6% of your gold if it reaches the portal.', min: 12 },
};

const SIZE_WEIGHTS = [['mass', 15], ['normal', 50], ['air', 15], ['boss', 20]];
const CHAMPION_COUNTS = { mass: [[0, 70], [1, 30]], normal: [[0, 42], [1, 30], [2, 20], [3, 8]] };
const COUNTS = { mass: 20, normal: 10, air: 6, boss: 1 };

const pickWeighted = (rng, entries) => {
  const total = entries.reduce((s, e) => s + e[1], 0);
  let r = rng() * total;
  for (const [v, w] of entries) { if ((r -= w) <= 0) return v; }
  return entries[entries.length - 1][0];
};
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

export function baseHp(level, difficulty) {
  const j = level - 1;
  const hp = 30 + j * (24 + j * (1.6 + j * (0.03 + j * 0.0005)));
  // 1.35: compensates for tower procs and autocasts added on top of base damage.
  return hp * 0.75 * (1 + 0.03 * level) * DIFFICULTIES[difficulty].hp;
}

export function baseArmor(level, difficulty) {
  return Math.floor((1 + level * 0.32 + level * level * 0.0016) * DIFFICULTIES[difficulty].armor);
}

export function isChallengeLevel(level) { return level % 8 === 0; }

export function generateWave(level, difficulty, rng) {
  const challenge = isChallengeLevel(level);
  let size;
  if (challenge) size = 'challenge';
  else if (level <= 2) size = 'normal';
  else size = pickWeighted(rng, SIZE_WEIGHTS);

  const race = pick(rng, RACE_IDS);
  const divineChance = level >= 12 ? 0.14 : 0;
  const armor = challenge ? 'bare' : (rng() < divineChance ? 'divine' : pick(rng, REGULAR_ARMORS));

  // Composition: an ordered list of sizes to spawn.
  const list = [];
  if (challenge) {
    const challengeMass = level % 16 === 0;
    if (challengeMass) for (let i = 0; i < 24; i++) list.push('challengeMass');
    else list.push('challenge');
  } else {
    const n = COUNTS[size];
    for (let i = 0; i < n; i++) list.push(size);
    const champs = level >= 5 && CHAMPION_COUNTS[size] ? pickWeighted(rng, CHAMPION_COUNTS[size]) : 0;
    for (let i = 0; i < champs; i++) {
      const at = Math.floor(((i + 1) * list.length) / (champs + 1));
      list.splice(at, 0, 'champion');
    }
  }

  // Specials
  const specials = [];
  if (!challenge) {
    let count = 0;
    if (level >= 6) count = rng() < 0.55 ? 1 : 0;
    if (level >= 30) count = 1;
    if (level >= 55) count = rng() < 0.5 ? 2 : 1;
    if (level >= 90) count = rng() < 0.5 ? 3 : 2;
    const hasChampion = list.includes('champion');
    const pool = Object.values(SPECIALS).filter((s) =>
      s.min <= level && !(s.noSize && s.noSize.includes(size)) && !(s.needsChampion && !hasChampion));
    for (let i = 0; i < count && pool.length; i++) {
      const s = pool.splice(Math.floor(rng() * pool.length), 1)[0];
      specials.push(s.id);
    }
  }

  return {
    level, size, race, armor, list, specials, challenge,
    hp: baseHp(level, difficulty) * (armor === 'divine' ? 0.55 : 1),
    armorValue: baseArmor(level, difficulty),
    interval: size === 'mass' || list[0] === 'challengeMass' ? 0.42 : size === 'air' ? 1.4 : 1.0,
  };
}
