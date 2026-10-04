// Level-milestone perks. At each milestone a tower offers three perks and the
// player keeps one, so two towers of the same type can grow in different directions.

// A perk every 5 levels up to the level cap of 30.
export const PERK_LEVELS = [5, 10, 15, 20, 25, 30];

// `mods` use the same stat channels as items. `minLevel` gates stronger perks,
// `needs` restricts a perk to towers where it does something.
export const PERKS = {
  brutal:     { name: 'Brutal Edge',     icon: '🗡', mods: { damage: 0.2 }, desc: '+20% damage.' },
  swift:      { name: 'Quickened',       icon: '💨', mods: { attackSpeed: 0.14 }, desc: '+14% attack speed.' },
  keen:       { name: 'Keen Eye',        icon: '🎯', mods: { crit: 0.06, critMult: 0.3 }, desc: '+6% crit chance, +x0.3 crit damage.' },
  reach:      { name: 'Long Reach',      icon: '📏', mods: { range: 1.4 }, desc: '+1.4 range.' },
  arcanist:   { name: 'Arcanist',        icon: '🔮', mods: { spell: 0.3, spellCrit: 0.05 }, desc: '+30% spell damage, +5% spell crit.' },
  wellspring: { name: 'Wellspring',      icon: '💧', mods: { manaRegen: 0.5, cdr: 0.1 }, desc: '+50% mana regeneration, abilities recharge 10% faster.', needs: 'actives' },
  prospector: { name: 'Prospector',      icon: '⛏', mods: { bounty: 0.25, itemFind: 0.25 }, desc: '+25% bounty, +25% item find.' },
  scholar:    { name: 'Scholar',         icon: '📚', mods: { xp: 0.5 }, desc: '+50% experience gained.', maxLevel: 20 },
  giantslayer:{ name: 'Giant Slayer',    icon: '🪓', mods: { vsBoss: 0.35, vsChampion: 0.25 }, desc: '+35% vs bosses, +25% vs champions.' },
  swarmbane:  { name: 'Swarmbane',       icon: '🕸', mods: { vsMass: 0.4, vsAir: 0.2 }, desc: '+40% vs mass, +20% vs air.' },
  trigger:    { name: 'Hair Trigger',    icon: '⚡', mods: { trigger: 0.25 }, desc: '+25% chance for every proc.', needs: 'procs' },
  rhythm:     { name: 'Deadly Rhythm',   icon: '🥁', mods: { multicrit: 1, crit: 0.03 }, desc: '+1 multicrit, +3% crit chance.', minLevel: 10 },
  overload:   { name: 'Overload',        icon: '🔱', mods: { multishot: 1, damage: -0.1 }, desc: '+1 target per attack, -10% damage.', minLevel: 15 },
  ascendant:  { name: 'Ascendant',       icon: '👑', mods: { damage: 0.35, attackSpeed: 0.1 }, desc: '+35% damage, +10% attack speed.', minLevel: 20 },
  apex:       { name: 'Apex Predator',   icon: '🦁', mods: { damage: 0.5, multicrit: 1 }, desc: '+50% damage, +1 multicrit.', minLevel: 25 },
  legend:     { name: 'Living Legend',   icon: '🌟', mods: { damage: 0.6, attackSpeed: 0.2, range: 1 }, desc: '+60% damage, +20% attack speed, +1 range.', minLevel: 30 },
  // Repeatable perks keep late milestones meaningful once the named ones are taken.
  might:      { name: 'Might',           icon: '💪', mods: { damage: 0.15 }, desc: '+15% damage. Can be taken repeatedly.', repeatable: true },
  fervor:     { name: 'Fervor',          icon: '🔥', mods: { attackSpeed: 0.1 }, desc: '+10% attack speed. Can be taken repeatedly.', repeatable: true },
  lethality:  { name: 'Lethality',       icon: '☠', mods: { crit: 0.03, critMult: 0.2 }, desc: '+3% crit chance, +x0.2 crit damage. Can be taken repeatedly.', repeatable: true },
  patience:   { name: 'Patience',        icon: '⏳', mods: { buffDur: 0.4, cdr: 0.15 }, desc: 'Buffs last 40% longer, abilities recharge 15% faster.', needs: 'actives', minLevel: 10 },
};

export function perkFits(tower, id) {
  const p = PERKS[id];
  if (tower.perks.includes(id) && !p.repeatable) return false;
  if (p.minLevel && tower.level < p.minLevel) return false;
  if (p.maxLevel && tower.level > p.maxLevel) return false;
  if (p.needs === 'actives' && !tower.def.actives.length) return false;
  if (p.needs === 'procs' && !tower.def.abilities.some((a) => a.type === 'proc')) return false;
  return true;
}
