// Maps YouTD modifier ids onto this game's stat channels.
// Each YouTD modifier is [id, base, perLevel]; perLevel scales with the carrier's level.

export const MOD_CHANNELS = {
  MOD_ATTACKSPEED: 'attackSpeed',
  MOD_DAMAGE_BASE_PERC: 'damage',
  MOD_DAMAGE_ADD_PERC: 'damage',
  MOD_DPS_ADD: 'dpsAdd',
  MOD_ATK_CRIT_CHANCE: 'crit',
  MOD_ATK_CRIT_DAMAGE: 'critMult',
  MOD_MULTICRIT_COUNT: 'multicrit',
  MOD_SPELL_CRIT_CHANCE: 'spellCrit',
  MOD_SPELL_CRIT_DAMAGE: 'spellCritMult',
  MOD_SPELL_DAMAGE_DEALT: 'spell',
  MOD_MANA: 'manaFlat',
  MOD_MANA_PERC: 'manaPct',
  MOD_MANA_REGEN: 'manaRegenFlat',
  MOD_MANA_REGEN_PERC: 'manaRegen',
  MOD_BOUNTY_RECEIVED: 'bounty',
  MOD_EXP_RECEIVED: 'xp',
  MOD_ITEM_CHANCE_ON_KILL: 'itemFind',
  MOD_ITEM_QUALITY_ON_KILL: 'itemQuality',
  MOD_TRIGGER_CHANCES: 'trigger',
  MOD_BUFF_DURATION: 'buffDur',
  MOD_DEBUFF_DURATION: 'debuffDur',
  MOD_DMG_TO_UNDEAD: 'vsUndead',
  MOD_DMG_TO_ORC: 'vsBrute',
  MOD_DMG_TO_HUMANOID: 'vsHumanoid',
  MOD_DMG_TO_NATURE: 'vsFeral',
  MOD_DMG_TO_MAGIC: 'vsArcane',
  MOD_DMG_TO_MASS: 'vsMass',
  MOD_DMG_TO_NORMAL: 'vsNormal',
  MOD_DMG_TO_AIR: 'vsAir',
  MOD_DMG_TO_CHAMPION: 'vsChampion',
  MOD_DMG_TO_BOSS: 'vsBoss',
};

// [[YouTD id, base, perLevel]] -> [[channel, base, perLevel]] (unknown ids dropped)
export const mapMods = (list) => list
  .filter(([id]) => MOD_CHANNELS[id])
  .map(([id, base, add]) => [MOD_CHANNELS[id], base, add]);

// Base values only, as a flat object (used for item cards and stacking).
export const baseMods = (mapped) => {
  const out = {};
  for (const [ch, base] of mapped) out[ch] = (out[ch] || 0) + base;
  return out;
};

// Adds mapped modifiers, including the per-level part, into an accumulator.
export function addLevelMods(acc, mapped, level) {
  for (const [ch, base, add] of mapped) acc[ch] = (acc[ch] || 0) + base + add * level;
}

const LABELS = {
  attackSpeed: 'attack speed', damage: 'damage', dpsAdd: 'DPS', crit: 'crit chance', critMult: 'crit damage',
  multicrit: 'multicrit', spellCrit: 'spell crit chance', spellCritMult: 'spell crit damage', spell: 'spell damage',
  manaFlat: 'mana', manaPct: 'max mana', manaRegenFlat: 'mana per second', manaRegen: 'mana regeneration',
  bounty: 'bounty', xp: 'experience', itemFind: 'item chance', itemQuality: 'item quality', trigger: 'trigger chances',
  buffDur: 'buff duration', debuffDur: 'debuff duration on creeps',
  vsUndead: 'damage to undead', vsBrute: 'damage to brutes', vsHumanoid: 'damage to humanoids', vsFeral: 'damage to feral',
  vsArcane: 'damage to arcane creeps', vsMass: 'damage to mass', vsNormal: 'damage to normal', vsAir: 'damage to air',
  vsChampion: 'damage to champions', vsBoss: 'damage to bosses',
};
const FLAT = new Set(['multicrit', 'manaFlat', 'manaRegenFlat', 'dpsAdd']);

const fmt = (ch, v) => (FLAT.has(ch) ? `${v >= 0 ? '+' : ''}${+v.toFixed(2)}` : `${v >= 0 ? '+' : ''}${+(v * 100).toFixed(2)}%`);

export function describeLevelMods(mapped) {
  // Upstream tables contain placeholder modifiers of 0 with no growth; skip them.
  return mapped.filter(([, base, add]) => base || add).map(([ch, base, add]) => {
    const per = add ? ` (${fmt(ch, add)} per level)` : '';
    return `${fmt(ch, base)} ${LABELS[ch] || ch}${per}`;
  });
}

export const modLabel = (ch) => LABELS[ch] || ch;
export const isFlatMod = (ch) => FLAT.has(ch);
