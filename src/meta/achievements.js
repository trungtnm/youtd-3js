// Pure achievement bookkeeping: turns a run summary and the profile into newly
// earned achievements, progress and unlocks. No storage, no DOM.

import { ACHIEVEMENTS, ACHIEVEMENT_BY_ID } from '../data/achievements.js';

// Abandoned runs earn nothing until this many waves were cleared, so quitting early cannot farm.
export const ABANDON_MIN_WAVES = 10;

const KINDS = { title: 'titles', modifier: 'modifiers', crest: 'crests' };

export function rewardsOf(a) {
  return Object.entries(a.reward || {}).map(([kind, id]) => ({ kind: KINDS[kind], id }));
}

export function countsForAchievements(sum) {
  return !sum.cfg.god && !(sum.outcome === 'abandoned' && sum.wavesCleared < ABANDON_MIN_WAVES);
}

// `counted` holds what this same game already contributed (a run continued after
// victory is evaluated again when it finally ends), so counters only add the difference.
export function evaluateRun(sum, profile, counted = {}) {
  const result = { earned: [], progress: {}, counted: { ...counted }, unlocks: [] };
  if (!countsForAchievements(sum)) return result;
  for (const a of ACHIEVEMENTS) {
    let done = false;
    if (a.counter) {
      const run = a.counter(sum);
      const value = (profile.progress[a.id] || 0) + Math.max(0, run - (counted[a.id] || 0));
      result.progress[a.id] = value;
      result.counted[a.id] = run;
      done = value >= a.target;
    } else if (a.collect) {
      const set = new Set([...(profile.progress[a.id] || []), ...a.collect(sum)]);
      result.progress[a.id] = [...set];
      done = set.size >= a.target;
    } else {
      done = a.test(sum);
    }
    if (done && !profile.achievements[a.id]) {
      result.earned.push(a.id);
      result.unlocks.push(...rewardsOf(a));
    }
  }
  return result;
}

// [current, target] for achievements that build up over several runs, else null.
export function progressOf(a, profile) {
  if (a.counter) return [Math.min(a.target, profile.progress[a.id] || 0), a.target];
  if (a.collect) return [(profile.progress[a.id] || []).length, a.target];
  return null;
}

export function unlockedSet(profile) {
  const out = { titles: new Set(), modifiers: new Set(), crests: new Set() };
  for (const id of Object.keys(profile.achievements)) {
    const a = ACHIEVEMENT_BY_ID[id];
    if (a) for (const r of rewardsOf(a)) out[r.kind].add(r.id);
  }
  return out;
}
