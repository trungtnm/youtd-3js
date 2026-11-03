// Replays a run log through the simulation and checks it against the checkpoints the
// player's client recorded. The server trusts only what a replay produces; the
// browser's own numbers are never read. Headless: runs in Node, Workers and browsers.

import { Game, validCommand, autoTransmuteRarities, LOG_VERSION, HASH_EVERY } from './game.js';
import { DIFFICULTIES, MODES, LENGTHS, MODIFIERS } from '../data/constants.js';

export const MAX_TICKS = 60 * 60 * 60 * 4; // four hours of game time
export const MAX_COMMANDS = 50_000;
export const MAX_PLAYERS = 4;
const PHASES = ['prep', 'running', 'won', 'lost', 'abandoned'];

const own = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isTick = (v) => Number.isInteger(v) && v >= 0 && v <= MAX_TICKS;
const isHash = (v) => typeof v === 'string' && /^[0-9a-f]{8}$/.test(v);

// The run settings a log may carry, cleaned; null when they are not valid settings.
export function cleanCfg(c) {
  if (!isObj(c) || !own(DIFFICULTIES, c.difficulty) || !own(MODES, c.mode) || !own(LENGTHS, c.length)) return null;
  if (!Array.isArray(c.modifiers) || c.modifiers.length > 8 || !c.modifiers.every((m) => own(MODIFIERS, m))) return null;
  const players = c.players ?? 1;
  if (!Number.isInteger(players) || players < 1 || players > MAX_PLAYERS) return null;
  if (c.autoWave !== undefined && typeof c.autoWave !== 'boolean') return null;
  if (c.autoTransmute !== undefined && (!Array.isArray(c.autoTransmute) || c.autoTransmute.length > 8)) return null;
  return {
    difficulty: c.difficulty, mode: c.mode, length: c.length, modifiers: [...new Set(c.modifiers)].sort(), players,
    autoWave: !!c.autoWave, autoTransmute: autoTransmuteRarities(c.autoTransmute || []),
  };
}

// Why a log cannot be replayed, or null when its shape is sound.
export function checkLog(log) {
  if (!isObj(log)) return 'not a log';
  if (log.v !== LOG_VERSION) return 'unsupported log version';
  if (typeof log.build !== 'string' || log.build.length > 64) return 'bad build';
  if (!Number.isInteger(log.seed) || log.seed < 0 || log.seed > 0xffffffff) return 'bad seed';
  const cfg = cleanCfg(log.cfg);
  if (!cfg) return 'bad settings';
  if (!Array.isArray(log.cmds) || log.cmds.length > MAX_COMMANDS) return 'bad command list';
  let last = 0;
  for (const c of log.cmds) {
    if (!validCommand(c, cfg.players)) return 'bad command';
    if (c[0] < last || c[0] > MAX_TICKS) return 'commands out of order';
    last = c[0];
  }
  if (!Array.isArray(log.hashes) || log.hashes.length > MAX_TICKS / HASH_EVERY) return 'bad checkpoints';
  for (const h of log.hashes) if (!Array.isArray(h) || h.length !== 2 || !isTick(h[0]) || !isHash(h[1])) return 'bad checkpoint';
  const e = log.end;
  if (!isObj(e) || !isTick(e.tick) || !isHash(e.hash) || !PHASES.includes(e.phase)) return 'bad end';
  if (last > e.tick) return 'command after the end';
  return null;
}

// Replays a log. Returns { ok, error, tick, work, game } where `game` is the replayed
// run (use game.summary()) and `work` counts entity updates (each tick: 1 plus its
// creeps, towers and projectiles), which tracks CPU far better than ticks alone: an
// idle tick costs almost nothing. `error` names the first disagreement with the client.
export function replayLog(log, { build = null, maxTicks = MAX_TICKS } = {}) {
  const bad = checkLog(log);
  if (bad) return { ok: false, error: bad, tick: 0, work: 0, game: null };
  if (build && log.build !== build) return { ok: false, error: 'different simulation build', tick: 0, work: 0, game: null };
  const cfg = cleanCfg(log.cfg);
  const game = new Game({ ...cfg, seed: log.seed, god: false });
  let work = 0;
  const fail = (error) => ({ ok: false, error, tick: game.tick, work, game });
  const expected = new Map(log.hashes.map(([t, h]) => [t, h]));
  const end = Math.min(log.end.tick, maxTicks);
  let i = 0;
  for (;;) {
    while (i < log.cmds.length && log.cmds[i][0] === game.tick) game.applyLogged(log.cmds[i++]);
    if (game.tick >= end) break;
    // A finished run stops ticking, so a later command could never have been issued.
    work += 1 + game.creeps.length + game.towers.size + game.projectiles.length;
    if (!game.step()) return fail(i < log.cmds.length ? 'command after the run ended' : 'run ended before its log');
    if (game.tick % HASH_EVERY === 0) {
      const want = expected.get(game.tick);
      const got = game.hashes[game.hashes.length - 1][1];
      if (want !== got) return fail(want ? 'state diverged' : 'missing checkpoint');
    }
  }
  if (log.end.tick > maxTicks) return fail('run too long');
  if (i < log.cmds.length) return fail('commands left over');
  if (game.hashes.length !== log.hashes.length) return fail('extra checkpoints');
  if (game.stateHash() !== log.end.hash) return fail('final state diverged');
  if (game.phase !== log.end.phase) return fail('different outcome');
  return { ok: true, error: null, tick: game.tick, work, game };
}
