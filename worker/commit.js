// Atomic run state changes. One D1 batch updates the run row, the board and the
// profile together, and every statement is conditioned on the run still being in the
// state we read and the profile still at the revision we read. A concurrent writer
// therefore makes the whole batch a no-op (returns false) and the caller retries.

import { boardStatement } from './leaderboard.js';

const RUN_COLUMNS = new Set(['status', 'claim', 'log_ticks', 'submitted_at', 'error', 'err_tick', 'result', 'run_state', 'attempts', 'log_ver', 'ip_key', 'cmds_hash', 'layout_hash']);

// run: the row as read ({ id, user_id, status, log_ver }). set: columns to change.
// profile + rev: new profile JSON object and the user revision it was derived from.
// board: { key, sum, now, hidden? } for a verified run; hidden is the reason to keep it
// off the public board.
export async function commitRun(env, { run, set, profile = null, rev = null, board = null }) {
  const cols = Object.keys(set);
  if (!cols.length || !cols.every((c) => RUN_COLUMNS.has(c))) throw new Error('bad run columns');

  const runWhere = 'id = ? AND status = ? AND log_ver = ?';
  const runBinds = [run.id, run.status, run.log_ver];
  let guardSql = `EXISTS (SELECT 1 FROM runs WHERE ${runWhere})`;
  const guardBinds = [...runBinds];
  let revSql = '';
  const revBinds = [];
  if (profile) {
    revSql = ' AND (SELECT rev FROM users WHERE id = ?) = ?';
    revBinds.push(run.user_id, rev);
    guardSql += revSql;
    guardBinds.push(...revBinds);
  }

  const stmts = [];
  if (board) stmts.push(boardStatement(env, { ...board, userId: run.user_id, runId: run.id, guardSql, guardBinds }));
  const runIdx = stmts.length;
  stmts.push(env.DB.prepare(`UPDATE runs SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE ${runWhere}${revSql}`)
    .bind(...cols.map((c) => set[c] ?? null), ...runBinds, ...revBinds));
  if (profile) {
    stmts.push(env.DB.prepare(
      'UPDATE users SET profile = ?, rev = rev + 1 WHERE id = ? AND rev = ? AND EXISTS (SELECT 1 FROM runs WHERE id = ? AND status = ? AND run_state IS ?)',
    ).bind(JSON.stringify(profile), run.user_id, rev, run.id, set.status, set.run_state ?? null));
  }
  const results = await env.DB.batch(stmts);
  return results[runIdx].meta.changes === 1;
}
