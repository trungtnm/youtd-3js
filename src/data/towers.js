// Tower roster from YouTD (via the MIT-licensed YouTD 2 data tables, see
// third_party/youtd2). Each family is an upgrade line; each tier is one tower.
// Stats and data-driven abilities are ported directly; scripted abilities are
// ported in batches (src/data/youtd/tower-ports.js) and listed as pending until then.

import { RARITIES } from './constants.js';
import { YT_TOWERS } from './youtd/generated.js';
import { mapMods, describeLevelMods } from './youtd/mods.js';
import { TOWER_ICONS } from './tower-icons.js';
import { describeSkill, describeStatMod } from './tower-skills.js';
import { TOWER_PORTS } from './youtd/tower-ports.js';

const UNIT = 94; // Warcraft III distance units per world unit (800 range -> ~8.5)

// Element research level needed, from the original cost thresholds.
const REQ_COST = [140, 215, 345, 500, 680, 900, 1080, 1300, 1550, 1850, 2130, 2440, 2750, 3100, 3500];
const reqLevelFor = (cost) => { let lvl = 0; REQ_COST.forEach((c, i) => { if (cost >= c) lvl = i + 1; }); return lvl; };
const TOME_COST = { common: 0, uncommon: 4, rare: 10, unique: 25 };

// Procedural models and icons are grouped by element; each family gets a stable pick.
const MODELS = {
  nature: ['thorn', 'mushroom', 'vine', 'tree', 'worldroot'], fire: ['brazier', 'wisp', 'mortar', 'roost', 'forge'],
  ice: ['crystal', 'totem', 'prism', 'obelisk', 'titan'], storm: ['coil', 'spire', 'rod', 'drum', 'eye'],
  iron: ['cannon', 'ballista', 'press', 'gatling', 'anvil'], astral: ['lens', 'orrery', 'sunprism', 'seer', 'sanctum'],
  darkness: ['tomb', 'eye', 'altar', 'reaper', 'monolith'],
};
const ICON_KEYS = {
  nature: ['thorn', 'spore', 'vine', 'grove', 'worldroot'], fire: ['brazier', 'wisp', 'mortar', 'phoenix', 'skyfall'],
  ice: ['shard', 'snow', 'prism', 'cryo', 'rimeheart'], storm: ['coil', 'gale', 'rod', 'drum', 'maelstrom'],
  iron: ['cannon', 'ballista', 'coinpress', 'gatling', 'anvil'], astral: ['lens', 'orrery', 'sunprism', 'seer', 'sanctum'],
  darkness: ['grave', 'shadoweye', 'hex', 'reaper', 'void'],
};
const PROJECTILES = { nature: 'thorn', fire: 'fireball', ice: 'icebolt', storm: 'spark', iron: 'shell', astral: 'star', darkness: 'shadow' };
const pickBy = (list, n) => list[((n * 2654435761) >>> 0) % list.length];

// Families whose towers can see invisible creeps in the original.
const REVEAL_SCRIPTS = new Set(['small_light']);

export const FAMILIES = {};
export const TOWERS = {};
export const TOWER_LIST = [];

const byFamily = new Map();
for (const row of YT_TOWERS) {
  if (!byFamily.has(row.family)) byFamily.set(row.family, []);
  byFamily.get(row.family).push(row);
}

for (const [famNum, rows] of byFamily) {
  rows.sort((a, b) => a.tier - b.tier);
  const fid = `f${famNum}`;
  const head = rows[0];
  FAMILIES[fid] = { id: fid, element: head.element, rarity: head.rarity, tiers: [], names: rows.map((r) => r.name) };
  rows.forEach((row, t) => {
    const abilities = [];
    if (row.splash.length) {
      const rings = row.splash.map(([r, pct]) => ({ radius: r / UNIT, pct }));
      abilities.push({ type: 'splash', rings, radius: rings[rings.length - 1].radius, pct: rings[0].pct });
    }
    if (row.bounce) abilities.push({ type: 'chain', count: Math.max(1, row.bounce[0] - 1), falloff: row.bounce[1], range: 6 });
    if (row.multishot > 1) abilities.push({ type: 'multishot', count: row.multishot });
    if (REVEAL_SCRIPTS.has(row.script)) abilities.push({ type: 'reveal', radius: row.range / UNIT });

    const port = row.script ? TOWER_PORTS[row.script] : null;
    if (port?.passives) abilities.push(...port.passives(row));
    const actives = port?.actives ? port.actives(row) : [];
    // Scripted abilities that are not ported yet are listed so players know they exist.
    const pending = port || !row.script ? [] : [
      ...row.abilities.map((a) => a.name), ...row.auras.map((a) => a.name), ...row.autocasts.map((a) => a.name),
    ].filter(Boolean);
    if (row.script && !port && !pending.length) pending.push('Special behavior');

    const id = `y${row.id}`;
    const tower = {
      id, ytId: row.id, family: fid, tier: t, tierCount: rows.length, name: row.name, author: row.author,
      element: row.element, rarity: row.rarity, attack: row.attack,
      cost: row.cost, totalCost: row.cost, reqLevel: reqLevelFor(row.cost), tomeCost: TOME_COST[row.rarity],
      food: 1, slots: 6, damage: row.dmg, cd: row.cd, range: row.range / UNIT,
      // A real mana pool keeps its upstream regeneration, including 0.
      mana: row.mana || undefined, manaRegen: row.mana > 0 ? row.manaRegen : undefined,
      levelMods: mapMods(row.mods), abilities, actives, pending,
      canAttack: row.attackEnabled,
      targets: row.target.includes('SIZE_AIR') ? 'air' : row.target.includes('SIZE_') ? 'ground' : 'all',
      projectile: row.lightning ? 'lightning' : PROJECTILES[row.element], arc: row.arc >= 0.3,
      model: pickBy(MODELS[row.element], famNum), icon: TOWER_ICONS[pickBy(ICON_KEYS[row.element], famNum)],
      lore: `${RARITIES[row.rarity].name} ${row.element} tower by ${row.author}.`,
    };
    FAMILIES[fid].tiers.push(id);
    TOWERS[id] = tower;
    TOWER_LIST.push(tower);
  });
}

// Shop order: by rarity, then cost, then tier.
const RORDER = { common: 0, uncommon: 1, rare: 2, unique: 3 };
TOWER_LIST.sort((a, b) => RORDER[a.rarity] - RORDER[b.rarity] || a.totalCost - b.totalCost || a.tier - b.tier);

export const nextTier = (towerId) => {
  const t = TOWERS[towerId];
  const f = FAMILIES[t.family];
  return t.tier + 1 < f.tiers.length ? TOWERS[f.tiers[t.tier + 1]] : null;
};

export const revealsInvisible = (def) => def.abilities.some((a) => a.type === 'reveal');
export const REVEAL_FAMILIES = Object.keys(FAMILIES).filter((fid) => revealsInvisible(TOWERS[FAMILIES[fid].tiers[0]]));

export function describeAbility(a) {
  const p = (x) => `${Math.round(x * 100)}%`;
  switch (a.type) {
    case 'splash': return `Splash: ${a.rings.map((r) => `${p(r.pct)} within ${r.radius.toFixed(1)}`).join(', ')}.`;
    case 'chain': return `Bounces to ${a.count} more creeps, losing ${p(a.falloff)} damage per bounce.`;
    case 'multishot': return `Attacks ${a.count} targets at once.`;
    case 'reveal': return `True sight: reveals invisible creeps within ${a.radius.toFixed(1)}.`;
    case 'crit': return `Critical strike: ${p(a.chance)} chance for x${a.mult.toFixed(2)} damage.`;
    case 'slow': return `Slows by ${p(a.pct)} for ${a.dur}s.`;
    case 'stun': return `${p(a.chance)} chance to stun for ${a.dur}s.`;
    case 'aura': if (a.selfOnly) return `This tower gains ${describeStatMod(a.stat, a.value)}${a.valuePerLevel ? ` (${describeStatMod(a.stat, a.valuePerLevel)} per level)` : ''}${a.minLevel ? `, from level ${a.minLevel}` : ''}.`;
      return `Aura: ${a.element ? `${a.element} ` : ''}${a.rarities ? `${a.rarities.join('/')} ` : ''}towers within ${(+a.radius).toFixed(1)} gain ${describeStatMod(a.stat, a.value)}${a.valuePerLevel ? ` (${describeStatMod(a.stat, a.valuePerLevel)} per level)` : ''}${a.minLevel ? `, from level ${a.minLevel}` : ''}.`;
    case 'creepAura': {
      const parts = [];
      if (a.slow) parts.push(`slowed ${p(a.slow)}`);
      if (a.armor) parts.push(`lose ${a.armor} armor`);
      if (a.curse) parts.push(`take +${p(a.curse)} damage`);
      if (a.vulnSpell) parts.push(`take +${p(a.vulnSpell)} spell damage`);
      if (a.vulnElement) parts.push(`take +${p(a.vulnElement.pct)} damage from ${a.vulnElement.el}`);
      if (a.xpBonus) parts.push(`grant +${p(a.xpBonus)}${a.xpBonusPerLevel ? ` (+${(a.xpBonusPerLevel * 100).toFixed(1)}%/lvl)` : ''} experience when they die`);
      return `Aura: creeps within ${(+a.radius).toFixed(1)} ${parts.join(', ')}.`;
    }
    case 'itemRarityLock': return `Only holds ${a.rarity} items; others return to the stash.`;
    case 'attackOverride': return `Attack type becomes ${a.attack}${a.minLevel ? ` from level ${a.minLevel}` : ''}.`;
    case 'manaPerAttack': return `${a.cost ? `Each attack costs ${a.cost} mana and stops when empty` : ''}${a.cost && a.gain ? '; ' : ''}${a.gain ? `each attack restores ${a.gain} mana` : ''}.`;
    case 'levelBonus': return `At level ${a.level}: ${Object.entries(a.mods).map(([k, v]) => describeStatMod(k, v)).join(', ')}.`;
    case 'proc': case 'charge': return describeSkill(a);
    default: return a.desc || a.type;
  }
}

export const describeTowerMods = (def) => describeLevelMods(def.levelMods);
