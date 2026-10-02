// Items from YouTD (via the MIT-licensed YouTD 2 data tables, see third_party/youtd2).
// Equipment sits in tower slots; oils are consumed into a tower permanently;
// consumables are used from the stash. Stat modifiers are ported directly;
// scripted item effects are listed as pending until ported.

import { YT_ITEMS } from './youtd/generated.js';
import { mapMods, baseMods, describeLevelMods, modLabel, isFlatMod } from './youtd/mods.js';
import { describeSkill } from './tower-skills.js';
import { ITEM_PORTS } from './youtd/item-ports.js';

// Consumable effects, re-implemented from the YouTD 2 scripts. Food-cap items
// are converted to gold because this game has no tower limit.
const CONSUMABLES = {
  book_of_force: { tomes: 3 },
  arcane_book_of_power: { tomes: 8 },
  divine_book_of_omnipotence: { tomes: 15 },
  consumable_hobbit: { tomes: 20, lives: 2 },
  mine_cart: { income: 0.1 },
  consumable_plant: { goldPerLevel: 4 },
  consumable_chicken: { goldPerLevel: 8 },
  consumable_piggy: { goldPerLevel: 20 },
};

// Card icon from the item's strongest stat line.
const ICONS = {
  damage: '🗡', attackSpeed: '⚔', crit: '🎯', critMult: '💥', multicrit: '✴', spell: '🔮', spellCrit: '✨',
  spellCritMult: '✨', bounty: '🪙', xp: '📜', itemFind: '🧲', itemQuality: '💎', trigger: '🎲', manaPct: '💧',
  manaRegen: '💧', manaFlat: '💧', manaRegenFlat: '💧', buffDur: '⏳', dpsAdd: '🔥',
};
const iconFor = (def, mapped) => {
  if (def.type === 'oil') return '🫙';
  if (def.type === 'consumable') return /book/.test(def.script || '') ? '📘' : '🎁';
  const top = mapped[0]?.[0];
  return ICONS[top] || (top?.startsWith('vs') ? '⚔' : '💠');
};

export const ITEMS = {};
for (const row of YT_ITEMS) {
  const levelMods = mapMods(row.mods);
  const kind = row.type === 'oil' ? 'oil' : row.type === 'consumable' ? 'consumable' : 'equip';
  const port = kind === 'equip' && row.script ? ITEM_PORTS[row.script]?.(row) : null;
  const pending = kind === 'equip' && row.script && !port
    ? [...row.abilities, ...row.auras, ...row.autocasts].map((a) => a.name).filter(Boolean)
    : [];
  if (kind === 'equip' && row.script && !port && !pending.length) pending.push('Special effect');
  ITEMS[`i${row.id}`] = {
    id: `i${row.id}`, ytId: row.id, name: row.name, author: row.author, rarity: row.rarity, kind,
    cost: row.cost, reqWave: row.reqWave, icon: iconFor(row, levelMods),
    levelMods, mods: baseMods(levelMods), pending,
    effect: kind === 'consumable' ? CONSUMABLES[row.script] || {} : undefined,
    procs: port?.procs, aura: port?.aura, reveal: port?.reveal,
    staticMods: port?.mods, attackType: port?.attackType,
    attackManaPct: port?.attackManaPct,
  };
}

export const ITEM_LIST = Object.values(ITEMS);
export const ITEMS_BY_RARITY = { common: [], uncommon: [], rare: [], unique: [] };
for (const i of ITEM_LIST) ITEMS_BY_RARITY[i.rarity].push(i);

// Readable lines for a flat mods object (used by oils on towers and tower buffs).
export function describeMods(mods) {
  return Object.entries(mods).map(([k, v]) => {
    const sign = v >= 0 ? '+' : '';
    // debuffDur on a tower is the duration of debuffs it receives.
    const label = k === 'debuffDur' ? 'duration of debuffs received' : modLabel(k);
    return isFlatMod(k) ? `${sign}${+v.toFixed(2)} ${label}` : `${sign}${+(v * 100).toFixed(1)}% ${label}`;
  });
}

export function describeItem(item) {
  if (item.kind === 'consumable') {
    const e = item.effect || {};
    const lines = [];
    if (e.tomes) lines.push(`Use: gain ${e.tomes} knowledge tomes.`);
    if (e.lives) lines.push(`Use: restore ${e.lives}% portal integrity.`);
    if (e.income) lines.push(`Use: wave income +${Math.round(e.income * 100)}% for the rest of the run.`);
    if (e.goldPerLevel) lines.push(`Use: gain ${e.goldPerLevel} gold per wave level.`);
    return lines.length ? lines : ['Use: no effect.'];
  }
  const lines = describeLevelMods(item.levelMods);
  if (item.staticMods) lines.push(...describeMods(item.staticMods));
  if (item.attackType) lines.push(`Changes the carrier's attack type to ${item.attackType}.`);
  if (item.attackManaPct) lines.push(`Each attack costs ${+(item.attackManaPct * 100).toFixed(1)}% of the carrier's max mana; without that much mana the attack fizzles, so towers without mana cannot attack.`);
  if (item.aura) {
    const a = item.aura;
    const per = a.valuePerLevel ? ` (${describeMods({ [a.stat]: a.valuePerLevel })[0]} per level)` : '';
    lines.push(a.selfOnly ? `The carrier gains ${describeMods({ [a.stat]: a.value })[0]}${per}.`
      : `Aura: ${a.element ? `${a.element} ` : ''}towers within ${a.radius.toFixed(1)} gain ${describeMods({ [a.stat]: a.value })[0]}${per}.`);
  }
  if (item.reveal) lines.push(`True sight: reveals invisible creeps within ${item.reveal.radius.toFixed(1)}.`);
  for (const p of item.procs || []) lines.push(describeSkill(p));
  if (item.pending.length) lines.push(`Special: ${item.pending.join(', ')} (effect not yet ported).`);
  if (item.kind === 'oil') lines.push('Drag onto a tower to consume permanently.');
  return lines;
}
