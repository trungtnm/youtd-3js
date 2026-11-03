// Cloud profile routes. The profile is stored as sanitized JSON in the users table.

import { emptyProfile, sanitize } from '../src/meta/profile.js';
import { unlockedSet } from '../src/meta/achievements.js';
import { json, fail, readJson } from './http.js';
import { userView } from './sessions.js';

const NAME_RE = /^[A-Za-z0-9_-][A-Za-z0-9 _-]{1,18}[A-Za-z0-9_-]$/; // 3-20 chars, no edge spaces

export function profileOf(row) {
  try { return sanitize(JSON.parse(row.profile)) || emptyProfile(); } catch { return emptyProfile(); }
}

export async function getProfile(ctx) {
  const { results } = await ctx.env.DB.prepare(
    "SELECT id, status, submitted_at, cfg FROM runs WHERE user_id = ? AND status IN ('queued', 'deferred') ORDER BY submitted_at DESC LIMIT 20",
  ).bind(ctx.user.id).all();
  const pending = results.map((r) => ({ runId: r.id, status: r.status, at: r.submitted_at, cfg: JSON.parse(r.cfg) }));
  return json({ profile: profileOf(ctx.user), pending });
}

export async function putProfile(ctx) {
  const { env, user } = ctx;
  const body = await readJson(ctx.req);
  const unknown = Object.keys(body).filter((k) => !['name', 'title', 'crest'].includes(k));
  if (unknown.length) fail(400, 'bad_field', 'Only name, title and crest can be changed.');

  if (body.name !== undefined && (typeof body.name !== 'string' || !NAME_RE.test(body.name))) {
    fail(400, 'bad_name', 'Name must be 3-20 characters: letters, digits, space, _ or -.');
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = attempt === 0 ? user : await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first();
    const profile = profileOf(row);
    const unlocked = unlockedSet(profile);
    for (const [field, set] of [['title', unlocked.titles], ['crest', unlocked.crests]]) {
      if (body[field] === undefined) continue;
      if (body[field] !== null && (typeof body[field] !== 'string' || !set.has(body[field]))) fail(400, `bad_${field}`, `That ${field} is not unlocked.`);
      profile[field] = body[field];
    }
    const name = body.name ?? row.name;
    // Saving a name, even the generated one, counts as choosing it.
    const named = body.name !== undefined || !!row.named;
    const res = await env.DB.prepare('UPDATE users SET name = ?, named = ?, profile = ?, rev = rev + 1 WHERE id = ? AND rev = ?')
      .bind(name, named ? 1 : 0, JSON.stringify(profile), user.id, row.rev).run();
    if (res.meta.changes === 1) return json({ profile, user: userView({ ...row, name, named }) });
  }
  return fail(409, 'conflict', 'Profile changed while saving. Try again.');
}
