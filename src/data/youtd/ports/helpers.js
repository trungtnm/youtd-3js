// Shared helpers for hand-ported YouTD tower behaviors (see docs/youtd-port.md).

export const UNIT = 94; // Warcraft III distance units per world unit

// Pick a per-tier value; YouTD tiers are 1-based and later tiers reuse the last entry.
export const at = (arr, row) => arr[Math.min(arr.length, row.tier) - 1];

// Proc passive. YouTD scripts state real per-hit chances, so no attack-speed adjustment.
export const proc = (name, on, opts, effect) => ({ type: 'proc', name, on, noAsAdjust: true, ...opts, effect });

// Autocast built from the tower's own autocast row (cooldown, mana, range).
export function autocast(row, id, icon, desc, target, effect, extra = {}) {
  const ac = row.autocasts[0] || { cd: 1, mana: 0, range: row.range };
  return { id, name: ac.name, icon, desc, target, mana: ac.mana, cd: ac.cd, range: (ac.range || row.range) / UNIT, ...extra, effect };
}
