// Player profile kept in localStorage: records, run history, lifetime totals,
// achievements and cosmetic choices. Everything read from storage or an imported
// file goes through sanitize(), which rebuilds the profile from the default
// shape and keeps only values of the right type and known ids.

import { DIFFICULTIES, MODES, LENGTHS, ELEMENT_IDS, TOWER_MAX_LEVEL } from '../data/constants.js';
import { TOWERS } from '../data/towers.js';
import { ACHIEVEMENT_BY_ID, UNLOCKS } from '../data/achievements.js';
import { evaluateRun, countsForAchievements } from './achievements.js';

export const PROFILE_KEY = 'youtd-reforged-profile';
export const LEGACY_BEST_KEY = 'youtd-reforged-best';
export const PROFILE_VERSION = 1;
export const HISTORY_MAX = 25;
export const IMPORT_MAX_BYTES = 256 * 1024;

const TOTAL_KEYS = ['kills', 'damage', 'gold', 'wavesCleared', 'timeSec', 'bossKills', 'leaks', 'towersBuilt', 'maxLevelTowers'];
const OUTCOMES = ['won', 'lost', 'abandoned'];
const MOD_ID = /^[a-z]{2,16}$/;

export function emptyProfile() {
  return {
    version: PROFILE_VERSION, createdAt: Date.now(), runs: 0, legacyMerged: false,
    totals: Object.fromEntries(TOTAL_KEYS.map((k) => [k, 0])),
    records: {}, history: [], achievements: {}, progress: {}, title: null, crest: null,
  };
}

// ---------------------------------------------------------------- validation

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : d);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const modList = (v) => (Array.isArray(v) ? [...new Set(v.filter((m) => typeof m === 'string' && MOD_ID.test(m)))].sort().slice(0, 8) : []);

export function recordKey(cfg) {
  const base = `${cfg.difficulty}/${cfg.mode}/${cfg.length}`;
  const mods = modList(cfg.modifiers);
  return mods.length ? `${base}+${mods.join(',')}` : base;
}

function validRecordKey(k) {
  const [base, mods] = k.split('+');
  const [d, m, l] = base.split('/');
  if (!own(DIFFICULTIES, d) || !own(MODES, m) || !own(LENGTHS, l)) return false;
  return mods === undefined || mods.split(',').every((x) => MOD_ID.test(x));
}

function sanitizeCfg(c) {
  if (!isObj(c) || !own(DIFFICULTIES, c.difficulty) || !own(MODES, c.mode) || !own(LENGTHS, c.length)) return null;
  return { difficulty: c.difficulty, mode: c.mode, length: c.length, modifiers: modList(c.modifiers) };
}

function sanitizeHistoryEntry(h) {
  if (!isObj(h)) return null;
  const cfg = sanitizeCfg(h.cfg);
  if (!cfg || !OUTCOMES.includes(h.outcome)) return null;
  const mvp = isObj(h.mvp) && typeof h.mvp.id === 'string' && own(TOWERS, h.mvp.id)
    ? { id: h.mvp.id, level: Math.min(TOWER_MAX_LEVEL, Math.floor(num(h.mvp.level))) } : null;
  return {
    at: num(h.at), cfg, outcome: h.outcome, wavesCleared: Math.floor(num(h.wavesCleared)), level: Math.floor(num(h.level)),
    score: Math.floor(num(h.score)), kills: Math.floor(num(h.kills)), time: num(h.time), mvp,
  };
}

// Returns a clean profile, or null when the data is not a profile this version can read.
export function sanitize(raw) {
  if (!isObj(raw)) return null;
  if (raw.version !== undefined && (typeof raw.version !== 'number' || raw.version > PROFILE_VERSION)) return null;
  const p = emptyProfile();
  p.createdAt = num(raw.createdAt, p.createdAt);
  p.runs = Math.floor(num(raw.runs));
  p.legacyMerged = raw.legacyMerged === true;
  if (isObj(raw.totals)) for (const k of TOTAL_KEYS) p.totals[k] = num(raw.totals[k]);
  if (isObj(raw.records)) {
    for (const k of Object.keys(raw.records)) {
      const r = raw.records[k];
      if (validRecordKey(k) && isObj(r)) p.records[k] = { level: Math.floor(num(r.level)), score: Math.floor(num(r.score)), at: num(r.at) };
    }
  }
  if (Array.isArray(raw.history)) p.history = raw.history.slice(-HISTORY_MAX).map(sanitizeHistoryEntry).filter(Boolean);
  if (isObj(raw.achievements)) {
    for (const id of Object.keys(raw.achievements)) {
      if (own(ACHIEVEMENT_BY_ID, id)) p.achievements[id] = { at: num(raw.achievements[id]?.at) };
    }
  }
  if (isObj(raw.progress)) {
    for (const id of Object.keys(raw.progress)) {
      const a = ACHIEVEMENT_BY_ID[id], v = raw.progress[id];
      if (!own(ACHIEVEMENT_BY_ID, id)) continue;
      if (a.counter) p.progress[id] = num(v);
      else if (a.collect && Array.isArray(v)) p.progress[id] = [...new Set(v.filter((e) => ELEMENT_IDS.includes(e)))];
    }
  }
  if (typeof raw.title === 'string' && own(UNLOCKS.titles, raw.title)) p.title = raw.title;
  if (typeof raw.crest === 'string' && own(UNLOCKS.crests, raw.crest)) p.crest = raw.crest;
  return p;
}

// ---------------------------------------------------------------- storage

// Session copy used when browser storage is unavailable, so the hall and achievements stay consistent.
let memoryProfile = null;

function defaultStorage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

// Old builds kept only best scores per setup; fold them in once, keeping the higher score.
function mergeLegacyBest(p, storage) {
  try {
    const old = JSON.parse(storage.getItem(LEGACY_BEST_KEY) || '{}');
    if (isObj(old)) {
      for (const k of Object.keys(old)) {
        const r = old[k];
        if (!validRecordKey(k) || !isObj(r) || !Number.isFinite(r.level) || !Number.isFinite(r.score)) continue;
        if (!p.records[k] || r.score > p.records[k].score) p.records[k] = { level: Math.max(0, Math.floor(r.level)), score: Math.max(0, Math.floor(r.score)), at: 0 };
      }
    }
  } catch { /* unreadable legacy data is skipped */ }
  p.legacyMerged = true;
}

// Returns { profile, loadError }. A missing profile is not an error; an unreadable one is,
// and the caller shows a warning while a fresh profile is used.
export function loadProfile(storage = defaultStorage()) {
  let profile = emptyProfile(), loadError = false;
  if (!storage) return { profile: memoryProfile ? sanitize(memoryProfile) : profile, loadError, storageOk: false };
  try {
    const text = storage.getItem(PROFILE_KEY);
    if (text) {
      const clean = sanitize(JSON.parse(text));
      if (clean) profile = clean; else loadError = true;
    }
  } catch { loadError = true; }
  if (!profile.legacyMerged) mergeLegacyBest(profile, storage);
  return { profile, loadError, storageOk: true };
}

export function saveProfile(profile, storage = defaultStorage()) {
  if (!storage) { memoryProfile = profile; return false; }
  try { storage.setItem(PROFILE_KEY, JSON.stringify(profile)); return true; } catch { return false; }
}

// ---------------------------------------------------------------- recording

const runTotals = (sum) => ({
  kills: sum.kills, damage: sum.damage, gold: sum.gold, wavesCleared: sum.wavesCleared, timeSec: sum.time,
  bossKills: sum.bossKills, leaks: Object.values(sum.leaksBySize).reduce((a, b) => a + b, 0),
  towersBuilt: sum.towerLedger.length,
  maxLevelTowers: sum.towerLedger.filter((t) => t.level >= TOWER_MAX_LEVEL).length,
});

export function newRunState() {
  return { recorded: false, historyAt: null, totals: null, progress: {} };
}

// Records a finished run. Each game is recorded once: a later call for the same
// game (a run continued after victory) updates its history entry and adds only
// the difference to totals and progress. God mode runs are never recorded.
// Returns null for god mode, else { profile, newRecord, earned, unlocks, saved }.
export function recordRun(sum, runState, storage = defaultStorage()) {
  if (sum.cfg.god) return null;
  const { profile, loadError } = loadProfile(storage);
  // An unreadable stored profile (corrupted, or from a newer version) is kept as is:
  // writing a fresh one over it would erase the player's progress.
  if (loadError) return { profile, newRecord: false, prevRecord: null, earned: [], unlocks: [], saved: false };
  const totals = runTotals(sum);
  for (const k of TOTAL_KEYS) profile.totals[k] += Math.max(0, totals[k] - (runState.totals?.[k] || 0));
  const entry = sanitizeHistoryEntry({
    at: runState.historyAt ?? Date.now(), cfg: sum.cfg, outcome: sum.continued ? 'won' : sum.outcome === 'running' ? 'abandoned' : sum.outcome,
    wavesCleared: sum.wavesCleared, level: sum.level, score: sum.score, kills: sum.kills, time: sum.time,
    mvp: (() => { const t = sum.towerLedger.find((x) => x.uid === sum.mvp); return t && { id: t.id, level: t.level }; })(),
  });
  if (!runState.recorded) profile.runs++;
  if (entry) {
    const i = runState.recorded ? profile.history.findIndex((h) => h.at === runState.historyAt) : -1;
    if (i >= 0) profile.history[i] = entry; else profile.history.push(entry);
    profile.history = profile.history.slice(-HISTORY_MAX);
  }

  // Records keep the run as it was won: waves played after continuing past the
  // last wave would put an impossible wave count under a fixed-length setup.
  const key = recordKey(sum.cfg);
  const prev = profile.records[key];
  const newRecord = !sum.continued && (!prev || sum.score > prev.score);
  if (newRecord) profile.records[key] = { level: sum.level, score: sum.score, at: Date.now() };

  let earned = [], unlocks = [];
  if (countsForAchievements(sum)) {
    const ev = evaluateRun(sum, profile, runState.progress);
    Object.assign(profile.progress, ev.progress);
    for (const id of ev.earned) profile.achievements[id] = { at: Date.now() };
    earned = ev.earned; unlocks = ev.unlocks;
    runState.progress = ev.counted;
  }

  runState.recorded = true;
  runState.historyAt = entry?.at ?? runState.historyAt;
  runState.totals = totals;
  const saved = saveProfile(profile, storage);
  return { profile, newRecord, prevRecord: prev || null, earned, unlocks, saved };
}

// ---------------------------------------------------------------- export / import

export function exportProfile(profile) {
  const blob = new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `youtd-profile-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Parses and validates an exported profile. Never writes; the caller confirms and saves.
export function parseProfileText(text) {
  if (typeof text !== 'string' || text.length > IMPORT_MAX_BYTES) return { ok: false, error: 'The file is too large to be a profile.' };
  let raw;
  try { raw = JSON.parse(text); } catch { return { ok: false, error: 'The file is not valid JSON.' }; }
  if (!isObj(raw) || raw.version === undefined) return { ok: false, error: 'The file is not a YouTD Reforged profile.' };
  if (typeof raw.version === 'number' && raw.version > PROFILE_VERSION) return { ok: false, error: 'The profile comes from a newer version of the game.' };
  const profile = sanitize(raw);
  if (!profile) return { ok: false, error: 'The profile could not be read.' };
  profile.legacyMerged = true; // never fold this browser's old best scores into an imported profile
  return { ok: true, profile };
}

export async function importProfileFile(file) {
  if (!file || file.size > IMPORT_MAX_BYTES) return { ok: false, error: 'The file is too large to be a profile.' };
  return parseProfileText(await file.text());
}
