// Extra passives (procs) and actives (autocasts) per tower family.
// `t` is the tier index (0-based). Effect `mult` is a multiple of the tower's
// average attack damage; `perLevel` scales it by tower level (1-25).
//
// Proc fields: on ('attack' | 'hit' | 'kill' | 'periodic'), chance or every N,
// icd (internal cooldown), cond (slowed | stunned | boss | notBoss | air | wounded).
// Active fields: target ('creep' | 'area' | 'tower' | 'self'), mana, cd, auto.

const proc = (name, on, opts, effect) => ({ type: 'proc', name, on, ...opts, effect });
const active = (id, name, icon, desc, opts, effect) => ({ id, name, icon, desc, ...opts, effect });

export const TOWER_SKILLS = {
  // ---------------------------------------------------------------- nature
  thorn: {
    passives: (t) => [proc('Splinter Burst', 'hit', { chance: 0.15, chancePerLevel: 0.004 },
      { kind: 'attackDamage', mult: 0.7 + 0.1 * t, radius: 2.2, perLevel: 0.02, fx: 'nature' })],
  },
  spore: {
    passives: (t) => [proc('Sporeburst', 'kill', { chance: 0.35 },
      { kind: 'spellDamage', mult: 1.1 + 0.2 * t, radius: 3, burn: 0.25, fx: 'nature' })],
  },
  vine: {
    passives: (t) => [proc('Thorn Lash', 'attack', { every: 4 }, { kind: 'attackDamage', mult: 1.6, perLevel: 0.03, slow: 0.4, slowDur: 2, fx: 'nature' })],
    actives: (t) => [active('entangle', 'Entangle', '🌿', 'Roots every creep in an area, holding them in place and crushing them.',
      { target: 'area', mana: 40, cd: 9, minTargets: 2 }, { kind: 'spellDamage', mult: 2 + 0.5 * t, radius: 3, stun: 1.2, perLevel: 0.03, fx: 'nature' })],
  },
  grove: {
    passives: (t) => [proc('Moonwell', 'periodic', { icd: 12, silent: true }, { kind: 'mana', radius: 9, amount: 20 + 10 * t, fx: 'arcane' })],
    actives: (t) => [active('blessing', 'Verdant Blessing', '🍃', 'Grants a nearby tower faster attacks and faster learning.',
      { target: 'tower', mana: 20, cd: 4, range: 9 }, { kind: 'towerBuff', key: 'blessing', label: 'Verdant Blessing', mods: { attackSpeed: 0.28 + 0.06 * t, xp: 0.3 }, dur: 9, perLevel: 0.01, fx: 'nature' })],
  },
  worldroot: {
    passives: (t) => [proc('Root Snare', 'hit', { chance: 0.1 }, { kind: 'debuff', stun: 0.9, fx: 'nature' })],
    actives: (t) => [
      active('overgrowth', 'Overgrowth', '🌳', 'Turns the ground into a grasping thicket that crushes and slows for 6 seconds.',
        { target: 'area', mana: 90, cd: 18 }, { kind: 'zone', mult: 0.9 + 0.3 * t, radius: 4, dur: 6, slow: 0.35, slowDur: 1.5, perLevel: 0.02, fx: 'nature' }),
      active('ward', 'Ancient Ward', '🛡', 'All towers around the Worldroot deal more damage for a while.',
        { target: 'self', mana: 60, cd: 20 }, { kind: 'towerBuff', key: 'ward', label: 'Ancient Ward', radius: 9, mods: { damage: 0.2 + 0.05 * t }, dur: 8, fx: 'nature' }),
    ],
  },

  // ---------------------------------------------------------------- fire
  brazier: {
    passives: (t) => [proc('Flare-up', 'hit', { chance: 0.12, chancePerLevel: 0.003 }, { kind: 'spellDamage', mult: 1.4 + 0.2 * t, radius: 2.8, burn: 0.15, perLevel: 0.03, fx: 'fire' })],
  },
  wisp: {
    passives: (t) => [proc('Kindling', 'hit', { chance: 1, silent: true },
      { kind: 'towerBuff', key: 'kindling', label: 'Kindling', mods: { attackSpeed: 0.02 + 0.005 * t }, dur: 4, maxStacks: 20, quiet: true, fx: 'fire' })],
  },
  mortar: {
    passives: (t) => [proc('Molten Shell', 'attack', { every: 5 }, { kind: 'spellDamage', mult: 2.4 + 0.4 * t, radius: 4, burn: 0.3, perLevel: 0.03, fx: 'fire' })],
  },
  phoenix: {
    passives: (t) => [proc('Ember Spirit', 'kill', { chance: 0.4 }, { kind: 'spellDamage', mult: 1.2, radius: 3, burn: 0.2, fx: 'fire' })],
    actives: (t) => [active('rebirth', 'Rebirth Flames', '🔥', 'Sets an area ablaze for 5 seconds; creeps inside burn.',
      { target: 'area', mana: 70, cd: 14 }, { kind: 'zone', mult: 0.8 + 0.25 * t, radius: 3.5, dur: 5, burn: 0.15, perLevel: 0.02, fx: 'fire' })],
  },
  skyfall: {
    passives: (t) => [proc('Fire Within', 'hit', { chance: 0.08, cond: 'wounded' }, { kind: 'spellDamage', mult: 4, fx: 'fire' })],
    actives: (t) => [
      active('cinders', 'Rain of Cinders', '☄', 'Burning debris rains on an area for 6 seconds.',
        { target: 'area', mana: 100, cd: 20 }, { kind: 'zone', mult: 1.2 + 0.3 * t, radius: 5, dur: 6, perLevel: 0.02, fx: 'fire' }),
      active('forgefire', 'Forgefire', '⚒', 'Empowers a nearby tower with heavier, more critical blows.',
        { target: 'tower', mana: 30, cd: 6, range: 10 }, { kind: 'towerBuff', key: 'forgefire', label: 'Forgefire', mods: { damage: 0.35, critMult: 0.5 }, dur: 10, fx: 'fire' }),
    ],
  },

  // ---------------------------------------------------------------- ice
  shard: {
    passives: (t) => [proc('Frostbite', 'hit', { chance: 0.1, chancePerLevel: 0.003 }, { kind: 'spellDamage', mult: 1.8 + 0.3 * t, stun: 0.6, perLevel: 0.03, fx: 'frost' })],
  },
  snow: {
    passives: (t) => [proc('Whiteout', 'periodic', { icd: 6, needCreeps: true },
      { kind: 'spellDamage', mult: 0.6 + 0.2 * t, radius: 7, slow: 0.3, slowDur: 3, fx: 'frost' })],
  },
  prism: {
    passives: (t) => [proc('Shatter', 'hit', { chance: 0.2, cond: 'slowed' }, { kind: 'attackDamage', mult: 1.3 + 0.3 * t, radius: 2, perLevel: 0.03, fx: 'frost' })],
  },
  cryo: {
    passives: (t) => [proc('Brittle', 'hit', { chance: 0.2 }, { kind: 'debuff', vulnElement: { el: 'ice', pct: 0.15 + 0.05 * t }, debuffDur: 5, fx: 'frost' })],
    actives: (t) => [active('deepfreeze', 'Deep Freeze', '🧊', 'Encases the toughest creep in range in ice, shattering its armor.',
      { target: 'creep', mana: 50, cd: 8, pick: 'strong' }, { kind: 'spellDamage', mult: 4 + t, stun: 2, armor: 6 + 3 * t, debuffDur: 6, perLevel: 0.03, fx: 'frost' })],
  },
  rimeheart: {
    actives: (t) => [
      active('glacialnova', 'Glacial Nova', '❄', 'A blast of cold around a crowd, deeply slowing everything caught.',
        { target: 'area', mana: 80, cd: 12 }, { kind: 'spellDamage', mult: 3 + t, radius: 6, slow: 0.5, slowDur: 4, perLevel: 0.03, fx: 'frost' }),
      active('permafrost', 'Permafrost Field', '🌨', 'Freezes the ground for 8 seconds; creeps crossing it are slowed and chilled.',
        { target: 'area', mana: 60, cd: 16 }, { kind: 'zone', mult: 0.5 + 0.2 * t, radius: 4, dur: 8, slow: 0.6, slowDur: 1.2, fx: 'frost' }),
    ],
  },

  // ---------------------------------------------------------------- storm
  coil: {
    actives: (t) => [active('overcharge', 'Overcharge', '⚡', 'Releases stored charge as a bolt that leaps between creeps.',
      { target: 'creep', mana: 20, cd: 1, pick: 'first' }, { kind: 'chainSpell', mult: 1.2 + 0.3 * t, count: 2 + (t >= 2 ? 1 : 0), falloff: 0.25, perLevel: 0.03, fx: 'storm' })],
  },
  gale: {
    passives: (t) => [proc('Gust', 'attack', { every: 6 }, { kind: 'barrage', count: 3, mult: 0.8 + 0.1 * t, fx: 'storm' })],
  },
  rod: {
    actives: (t) => [active('thunderclap', 'Thunderclap', '🌩', 'Calls a thunderclap that stuns and damages a group.',
      { target: 'area', mana: 60, cd: 10 }, { kind: 'spellDamage', mult: 2.5 + 0.5 * t, radius: 4, stun: 0.6, perLevel: 0.03, fx: 'storm' })],
  },
  drum: {
    passives: (t) => [proc('Battle Cry', 'periodic', { icd: 15, needCreeps: true },
      { kind: 'towerBuff', key: 'battlecry', label: 'Battle Cry', radius: 9, mods: { damage: 0.1 + 0.03 * t }, dur: 5, fx: 'storm' })],
    actives: (t) => [active('rhythm', 'War Rhythm', '🥁', 'Drives a nearby tower into a frenzy of rapid attacks.',
      { target: 'tower', mana: 20, cd: 4, range: 9 }, { kind: 'towerBuff', key: 'rhythm', label: 'War Rhythm', mods: { attackSpeed: 0.35 + 0.05 * t }, dur: 8, perLevel: 0.01, fx: 'storm' })],
  },
  maelstrom: {
    passives: (t) => [proc('Arc Surge', 'hit', { chance: 0.15 }, { kind: 'chainSpell', mult: 1, count: 3, falloff: 0.2, fx: 'storm' })],
    actives: (t) => [
      active('tempest', 'Tempest', '🌀', 'A raging storm cell lashes an area for 6 seconds.',
        { target: 'area', mana: 100, cd: 20 }, { kind: 'zone', mult: 1 + 0.4 * t, radius: 5, dur: 6, perLevel: 0.02, fx: 'storm' }),
      active('staticfield', 'Static Field', '🔋', 'Charges every creep nearby so spells hurt them far more.',
        { target: 'area', mana: 40, cd: 10 }, { kind: 'debuff', radius: 10, vulnSpell: 0.2 + 0.05 * t, debuffDur: 6, fx: 'storm' }),
    ],
  },

  // ---------------------------------------------------------------- iron
  cannon: {
    passives: (t) => [proc('Heavy Shot', 'attack', { every: 4 }, { kind: 'attackDamage', mult: 1.5 + 0.2 * t, radius: 2.5, stun: 0.4, fx: 'iron' })],
  },
  ballista: {
    passives: (t) => [{ type: 'charge', name: 'Steady Aim', rate: 0.15 + 0.03 * t, cap: 1.8 }],
  },
  coinpress: {
    passives: (t) => [proc('Jackpot', 'kill', { chance: 0.08 }, { kind: 'gold', amount: 3, perWave: 0.5 + 0.2 * t, fx: 'gold' })],
    actives: (t) => [active('goldentouch', 'Golden Touch', '💰', 'A nearby tower earns much more gold per kill for a while.',
      { target: 'tower', mana: 20, cd: 5, range: 9 }, { kind: 'multi', effects: [
        { kind: 'towerBuff', key: 'goldentouch', label: 'Golden Touch', mods: { bounty: 0.4 + 0.1 * t }, dur: 10, fx: 'gold' },
        { kind: 'gold', amount: 4 + 2 * t, fx: 'gold' }] })],
  },
  gatling: {
    passives: (t) => [proc('Ricochet', 'hit', { chance: 0.05 }, { kind: 'barrage', count: 2, mult: 0.7, fx: 'iron' })],
    actives: (t) => [active('overdrive', 'Overdrive', '⚙', 'Spins the barrels past their limit: a huge burst of attack speed.',
      { target: 'self', mana: 50, cd: 15 }, { kind: 'towerBuff', key: 'overdrive', label: 'Overdrive', mods: { attackSpeed: 0.6 + 0.1 * t }, dur: 5, fx: 'iron' })],
  },
  anvil: {
    passives: (t) => [proc('Sunder', 'hit', { chance: 0.15 }, { kind: 'debuff', armor: 10 + 5 * t, debuffDur: 5, fx: 'iron' })],
    actives: (t) => [active('mastery', 'Forge Mastery', '🔨', 'Tempers every tower nearby: more damage and sharper crits.',
      { target: 'self', mana: 80, cd: 20, anytime: true }, { kind: 'towerBuff', key: 'mastery', label: 'Forge Mastery', radius: 9, mods: { damage: 0.2, crit: 0.05 }, dur: 10, fx: 'iron' })],
  },

  // ---------------------------------------------------------------- astral
  lens: {
    passives: (t) => [proc('Starfocus', 'hit', { chance: 0.1, chancePerLevel: 0.003 }, { kind: 'spellDamage', mult: 2.4 + 0.3 * t, perLevel: 0.03, fx: 'holy' })],
  },
  orrery: {
    passives: (t) => [proc('Eclipse', 'attack', { every: 8 }, { kind: 'spellDamage', mult: 2 + 0.4 * t, radius: 3, vulnSpell: 0.15, debuffDur: 5, fx: 'holy' })],
  },
  sunprism: {
    actives: (t) => [active('solarflare', 'Solar Flare', '☀', 'Focuses the sun into one searing explosion.',
      { target: 'area', mana: 70, cd: 12 }, { kind: 'spellDamage', mult: 5 + t, radius: 3, burn: 0.2, perLevel: 0.03, fx: 'holy' })],
  },
  seer: {
    passives: (t) => [proc('Omen', 'hit', { chance: 0.2 }, { kind: 'debuff', mark: { bounty: 0.25 + 0.05 * t, xpChance: 0.33 }, debuffDur: 6, fx: 'holy' })],
    actives: (t) => [active('foresight', 'Foresight', '🔮', 'A nearby tower sees the future: more crits and faster learning.',
      { target: 'tower', mana: 25, cd: 5, range: 9 }, { kind: 'towerBuff', key: 'foresight', label: 'Foresight', mods: { xp: 0.5, crit: 0.08 + 0.02 * t }, dur: 10, fx: 'holy' })],
  },
  sanctum: {
    actives: (t) => [
      active('starfall', 'Starfall', '🌠', 'Stars hammer an area for 4 seconds.',
        { target: 'area', mana: 100, cd: 18 }, { kind: 'zone', mult: 1.5 + 0.5 * t, radius: 5, dur: 4, perLevel: 0.02, fx: 'holy' }),
      active('grace', 'Celestial Grace', '✨', 'Blesses every tower nearby with stronger, more critical spells.',
        { target: 'self', mana: 60, cd: 20, anytime: true }, { kind: 'towerBuff', key: 'grace', label: 'Celestial Grace', radius: 10, mods: { spell: 0.3, spellCrit: 0.1 }, dur: 10, fx: 'holy' }),
    ],
  },

  // ---------------------------------------------------------------- darkness
  grave: {
    passives: (t) => [proc('Restless Dead', 'kill', { chance: 0.25 }, { kind: 'spellDamage', mult: 1.5 + 0.2 * t, radius: 3, fx: 'shadow' })],
  },
  shadoweye: {
    passives: (t) => [proc('Hex of Frailty', 'hit', { chance: 0.15 }, { kind: 'debuff', vulnSpell: 0.15 + 0.03 * t, debuffDur: 5, fx: 'shadow' })],
  },
  hex: {
    actives: (t) => [active('doombrand', 'Doom Brand', '☠', 'Brands the strongest creep: it takes much more damage from everything.',
      { target: 'creep', mana: 40, cd: 8, pick: 'strong' }, { kind: 'spellDamage', mult: 1, curse: 0.3 + 0.05 * t, debuffDur: 8, fx: 'shadow' })],
  },
  reaper: {
    passives: (t) => [proc('Soul Siphon', 'kill', { chance: 1, silent: true }, { kind: 'mana', self: true, amount: 6 + 2 * t })],
    actives: (t) => [active('harvest', 'Soul Harvest', '💀', 'Tears at the souls in an area. Kills teach nearby towers.',
      { target: 'area', mana: 70, cd: 12 }, { kind: 'multi', effects: [
        { kind: 'spellDamage', mult: 3 + t, radius: 4, perLevel: 0.03, fx: 'shadow' },
        { kind: 'shareXp', radius: 9, amount: 2, count: 4 }] })],
  },
  void: {
    actives: (t) => [
      active('horizon', 'Event Horizon', '🕳', 'Collapses space around a crowd, crushing and slowing it.',
        { target: 'area', mana: 90, cd: 16 }, { kind: 'spellDamage', mult: 2.5 + t, radius: 5, slow: 0.5, slowDur: 3, perLevel: 0.03, fx: 'shadow' }),
      active('oblivion', 'Oblivion Mark', '👁', 'Marks a creep for oblivion: spells and curses tear it apart.',
        { target: 'creep', mana: 50, cd: 10, pick: 'strong' }, { kind: 'debuff', vulnSpell: 0.3, curse: 0.2, debuffDur: 8, fx: 'shadow' }),
    ],
  },
};

// Human-readable line for a proc/charge passive.
export function describeSkill(p) {
  if (p.type === 'charge') return `${p.name}: gains +${Math.round(p.rate * 100)}% damage per second without attacking (max +${Math.round(p.cap * 100)}%), spent on the next shot.`;
  const when = p.everyWaves ? `once every ${p.everyWaves} waves, on the first ${p.on}`
    : p.every ? `Every ${ordinal(p.every)} ${{ attack: 'attack', hit: 'hit', damage: 'hit', kill: 'kill', periodic: 'tick', enter: 'creep entering range', crit: 'crit', cast: 'cast', death: 'creep death in range', buffed: 'buff received' }[p.on]}`
    : p.on === 'periodic' ? `${p.chance != null && p.chance < 1 ? `${pctText(p.chance)} chance every` : 'Every'} ${p.icd}s${p.needCreeps ? ' in combat' : ''}`
    : `${pctText(p.chance ?? 1)}${p.chancePerLevel ? ` (+${pctText(p.chancePerLevel)}/lvl)` : ''} ${{
      attack: 'on attack', hit: 'on hit', damage: 'on hit', kill: 'on kill', enter: 'when a creep enters range', crit: 'on crit',
      cast: 'after casting', death: 'when a creep dies in range', buffed: 'when buffed by another tower' }[p.on]}`;
  const cond = (p.onCrit ? ', on crits' : '') + (p.manaAbove != null ? `, while above ${p.manaAbove} mana` : '')
    + (p.towerCast ? ' on a tower' : '') + (p.attacks ? `, ${p.attacks.join('/')} attackers only` : '') + (p.elements ? `, ${p.elements.join('/')} carriers only` : '') + (p.minLevel ? `, from level ${p.minLevel}` : '') + (p.manaCost ? `, costs ${p.manaCost} mana` : '')
    + (p.sizes ? ` vs ${p.sizes.join('/')}` : '') + (p.armors ? ` vs ${p.armors.join('/')} armor` : '')
    + (p.hpBelow != null ? ` below ${pctText(p.hpBelow)} health` : '') + (p.hpAbove != null ? ` above ${pctText(p.hpAbove)} health` : '')
    + (p.cond ? ` vs ${p.cond} creeps` : '') + (p.races ? ` vs ${p.races.join('/')}` : '') + (p.icd && p.on !== 'periodic' ? `, ${p.icd}s cooldown` : '');
  return `${p.name} (${when}${cond}): ${describeEffect(p.effect)}`;
}

import { modLabel, isFlatMod } from './youtd/mods.js';

export const STAT_NAMES = { attackSpeed: 'attack speed', damage: 'damage', crit: 'crit chance', xp: 'experience', bounty: 'bounty', spell: 'spell damage', spellCrit: 'spell crit', multishot: 'targets' };
const statName = (k) => STAT_NAMES[k] || modLabel(k);
const pctText = (v) => `${+(v * 100).toFixed(Math.abs(v) < 0.01 ? 2 : Math.abs(v) < 0.1 ? 1 : 0)}%`;
// Flat channels (multicrit, extra targets, mana...) print as numbers, the rest as percentages.
const sign = (v) => (v >= 0 ? '+' : '-');
const fmtMod = (k, v) => k === 'critMult' ? `${sign(v)}x${+Math.abs(v).toFixed(Math.abs(v) < 0.1 ? 3 : 2)} crit damage`
  : k === 'multishot' || isFlatMod(k) ? `${sign(v)}${+Math.abs(v).toFixed(2)} ${statName(k)}`
  : `${v >= 0 ? '+' : ''}${pctText(v)} ${statName(k)}`;
export const describeStatMod = fmtMod;
const ordinal = (n) => { const m = n % 100; return `${n}${m >= 11 && m <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`; };

const SCALE_NAMES = { mana: 'mana', gold: '√gold', livesLost: 'portal % lost', towers: 'tower', towersInRange: 'tower in range', goldLinear: 'gold owned', towerCost: 'gold invested in the tower', maxMana: 'max mana', elementTowers: 'same-element tower', wave: 'wave', creepsInRange: 'creep in range', targetMissingHp: '100% missing health', kills: 'kill' };

export function describeEffect(e) {
  const pct = (x) => `${+(x * 100).toFixed(Math.abs(x) < 0.01 ? 1 : 0)}%`;
  const riders = [];
  if (e.stun) riders.push(`stun ${e.stun}s`);
  if (e.slow) riders.push(`slow ${pct(e.slow)}${e.slowPerLevel ? ` (+${+(e.slowPerLevel * 100).toFixed(2)}% per level)` : ''}${e.slowDur ? ` for ${e.slowDur}s` : ''}${e.slowDurPerLevel ? ` (+${e.slowDurPerLevel}s/lvl)` : ''}`);
  if (e.burn) riders.push(`burn ${pct(e.burn)}/s`);
  if (e.armor) riders.push(`${e.armor > 0 ? '-' : '+'}${Math.abs(e.armor)} armor`);
  if (e.curse) riders.push(`+${pct(e.curse)} damage taken`);
  if (e.vulnSpell) riders.push(`+${pct(e.vulnSpell)} spell damage taken`);
  if (e.vulnElement) riders.push(`+${pct(e.vulnElement.pct)} damage taken from ${e.vulnElement.el} towers`);
  if (e.mark) {
    const m = [];
    if (e.mark.bounty) m.push(`+${pct(e.mark.bounty)} bounty`);
    if (e.mark.xpChance) m.push('attackers may gain experience');
    if (e.mark.itemChance) m.push(`+${pct(e.mark.itemChance)} item chance`);
    if (e.mark.itemQuality) m.push(`+${pct(e.mark.itemQuality)} item quality`);
    riders.push(`marked: ${m.join(', ')}`);
  }
  if (e.dot) riders.push(`${e.dot.dps}${e.dot.dpsPerLevel ? ` (+${e.dot.dpsPerLevel}/lvl)` : ''} spell damage per second for ${e.dot.dur}s${e.dot.durPerLevel ? ` (+${e.dot.durPerLevel}s/lvl)` : ''}${(e.dot.maxStacks || 1) > 1 ? `, stacks ${e.dot.maxStacks}x` : ''}`);
  if (e.stackVuln) riders.push(`+${pct(e.stackVuln.pct)} damage taken${e.stackVuln.element ? ` from ${e.stackVuln.element}` : ''}${e.stackVuln.spellOnly ? ' from spells' : ''}${e.stackVuln.attacksOnly ? ' from attacks' : ''} per stack (max ${e.stackVuln.max || 1})`);
  if (e.armorPct) riders.push(`${e.armorPct > 0 ? '-' : '+'}${pct(Math.abs(e.armorPct))} armor`);
  if (e.armorPerLevel) riders.push(`armor loss +${e.armorPerLevel}/lvl`);
  if (e.armorStack) riders.push(`-${e.armorStack.armor} armor per stack (max ${e.armorStack.max || 1})`);
  if (e.stunChance != null) riders.push(`${pctText(e.stunChance)} stun chance`);
  if (e.slowChance != null) riders.push(`${pctText(e.slowChance)} slow chance`);
  if (e.fromLinked) riders.push(`+${pctText(e.fromLinked)} of the linked tower's banked spell damage`);
  if (e.fromOverkill) riders.push(`+${e.fromOverkill}x overkill damage`);
  if (e.cursePerLevel) riders.push(`damage taken +${pctText(e.cursePerLevel)}/lvl`);
  if (e.stunPerLevel) riders.push(`stun +${e.stunPerLevel}s/lvl`);
  if (e.xpGranted) riders.push(`+${pct(e.xpGranted)} experience granted on death (permanent, stacks)`);
  if (e.pushBack) riders.push(`pushes back ${+e.pushBack.toFixed(1)}`);
  if (e.pctHp) riders.push(`+${pct(e.pctHp)} of current health`);
  if (e.pctMaxHp) riders.push(`+${pct(e.pctMaxHp)} of max health`);
  if (e.manaMult) riders.push(`+${e.manaMult}x current mana`);
  if (e.scaleBy) riders.push(`${e.scaleBy.per >= 0 ? '+' : '-'}${pctText(Math.abs(e.scaleBy.per))} per ${SCALE_NAMES[e.scaleBy.kind] || e.scaleBy.kind}`);
  if (e.delay) riders.push(`after ${e.delay}s`);
  const r = riders.length ? ` (${riders.join(', ')})` : '';
  const area = e.radius ? ` in a ${+e.radius.toFixed(1)} radius` : '';
  // Flat damage (ported YouTD spells) or a multiple of attack damage.
  // Effects whose damage comes only from mana (or health) read better without a "0" base.
  const onlyRiders = (e.flat == null && !e.mult) || e.flat === 0;
  const noDamage = onlyRiders && !e.manaMult && !e.pctHp && !e.pctMaxHp && !e.scaleBy;
  const amount = onlyRiders ? 'bonus' : e.flat != null
    ? `${e.flat}${e.flatPerLevel ? ` (+${e.flatPerLevel} per level)` : ''}`
    : `x${+(e.mult || 0).toFixed((e.mult || 0) < 0.1 ? 3 : 1)}${e.perLevel ? ` (+${+(e.perLevel * 100).toFixed(1)}% per level)` : ''}`;
  switch (e.kind) {
    case 'spellDamage': return noDamage ? `${riders.join(', ') || 'no effect'}${area}.` : `${amount} spell damage${area}${r}.`;
    case 'attackDamage': return `extra ${amount} attack damage${area}${r}.`;
    case 'killInstant': return 'kills the creep instantly.';
    case 'bolts': return noDamage ? `${e.count} strikes on random creeps${area}${r}.` : `${e.count} strikes on random creeps for ${amount} ${e.attack ? 'attack' : 'spell'} damage each${area}${r}.`;
    case 'growSelf': return `permanently gains ${fmtMod(e.stat, e.amount)}${e.cap != null ? ` (max ${fmtMod(e.stat, e.cap)})` : ''}.`;
    case 'stealXp': return `steals ${e.amount} experience from a random nearby tower.`;
    case 'dropItem': if (e.quality != null) return `creates ${(e.count || 1) > 1 ? `${e.count} items` : 'an item'} with +${pctText(e.quality)} item quality.`;
      return `creates ${/^[aeiou]/.test(e.rarity || 'common') ? 'an' : 'a'} ${e.rarity || 'common'} item${e.uniqueChance ? ` (${pctText(e.uniqueChance)} unique)` : ''}.`;
    case 'resetGrow': case 'resetGrowSelf': return `resets its ${STAT_NAMES[e.stat] || e.stat} growth.`;
    case 'nextSpellCrit': return `the next ${e.count || 1} spell${(e.count || 1) > 1 ? 's' : ''} always crit.`;
    case 'link': return 'links to an allied tower and banks its spell damage.';
    case 'transferXp': return `gives ${e.amount} of its experience to up to ${e.count || 5} nearby towers.`;
    case 'debuff': return `${riders.join(', ')}${area}.`;
    case 'chainSpell': return `bolt hitting ${e.count + 1} creeps for ${amount} spell damage${r}.`;
    case 'zone': return `field for ${e.dur}s dealing ${amount} spell damage per second${area}${r}.`;
    case 'barrage': return `fires ${e.count} extra attacks at x${(e.mult || 1).toFixed(1)} damage.`;
    case 'towerBuff': return `${e.radius ? 'towers nearby gain' : 'gains'} ${Object.entries(e.mods).map(([k, v]) => fmtMod(k, v)).join(', ')}${e.scaleBy ? `, scaled ${e.scaleBy.per >= 0 ? '+' : '-'}${pctText(Math.abs(e.scaleBy.per))} per ${SCALE_NAMES[e.scaleBy.kind] || e.scaleBy.kind}` : ''}${e.dur >= 600 ? ' permanently' : ` for ${e.dur}s`}${e.maxStacks ? ` (stacks ${e.maxStacks}x)` : ''}.`;
    case 'mana': return `${(e.amount || 0) < 0 ? 'drains' : 'restores'} ${e.pct ? pct(e.pct) : e.fromOverkill ? `${e.fromOverkill}x overkill as` : Math.abs(e.amount)} mana${e.self ? '' : ' to towers nearby'}.`;
    case 'gold': return `grants ${e.amount}${e.perWave ? ` + ${e.perWave}/wave` : ''} gold.`;
    case 'shareXp': return `${e.amount} experience to ${e.count} nearby towers.`;
    case 'xp': return `grants ${e.amount} experience${e.toCastTarget ? ' to the target tower' : ''}${e.perLevel ? ` (+${pctText(e.perLevel)} per level)` : ''}.`;
    case 'modifyHit': {
      const parts = [];
      if (e.mult != null) parts.push(`the hit deals x${e.mult}`);
      if (e.healthMult) parts.push(`the hit deals x${e.healthMult[1]} against creeps at full health, falling to x${e.healthMult[0]} as they near death`);
      if (e.regenMult) parts.push("the hit is multiplied by 2 plus the carrier's mana regeneration bonus");
      if (e.floor) parts.push("the hit deals at least the carrier's attack damage, whatever the armor");
      if (e.toSpell) parts.push(`${pctText(e.toSpell)} of the hit is dealt as spell damage instead`);
      return `${parts.join('; ')}.`;
    }
    case 'drainCreepMana': return `drains ${e.amount}${e.amountPerLevel ? ` (+${e.amountPerLevel} per level${e.perLevelByCd ? ' x base attack cooldown' : ''})` : ''} mana from the target${e.rangeExp ? ', less for long-range towers' : ''}. Warded creeps lose their ward below 10 mana.`;
    case 'restoreMana': return `${e.chance != null ? `${pctText(e.chance)} chance to restore` : 'restores'} the carrier's mana to its level ${e.every || 5}s earlier if it has dropped since.`;
    case 'grow': return `permanently grows the item: ${fmtMod(e.stat, e.amount)}${e.cap != null ? ` (up to ${fmtMod(e.stat, e.cap)})` : ''}${e.min != null ? ` (down to ${fmtMod(e.stat, e.min)})` : ''}.`;
    case 'pick': {
      const part = (s) => (s.kind === 'multi' ? s.effects.map(part).join(' and ') : describeEffect(s).replace(/\.$/, ''));
      return `one at random: ${e.effects.map((s, i) => `(${i + 1}) ${part(s)}`).join('; ')}.`;
    }
    case 'paceReward': return `when attacking a creep of a newer wave within ${e.window}s of its last attack, grants gold equal to the seconds left${e.xpRatio ? ` and ${e.xpRatio}x that as experience` : ''}.`;
    case 'multi': return e.effects.map(describeEffect).filter(Boolean).map((t, i) => (i ? t.charAt(0).toUpperCase() + t.slice(1) : t)).join(' ');
    default: return '';
  }
}
