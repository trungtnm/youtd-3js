// Downloads the tower and creep models chosen in src/data/model-map.js from
// Poly Pizza (CC0 and CC-BY only), generates models with Meshy for tower
// families listed in tools/meshy-prompts.mjs that have no Poly Pizza pick,
// optimizes everything with gltf-transform (meshopt, textures at most 512 px
// WebP) into public/models/, and regenerates src/data/model-library.js and
// docs/model-credits.md.
//
//   npm run import:models
//   MESHY_API_KEY=... MESHY_MAX=5 npm run import:models      # generate up to 5 missing models
//   MESHY_API_KEY=... MESHY_ONLY="Storm Coil,Igloo" npm run import:models
//
// Generation costs Meshy credits (about 30 per model: preview mesh + texture).
// Files that already exist in public/models/ are never regenerated.

import { writeFileSync, mkdirSync, existsSync, readdirSync, rmSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOWER_MODEL_MAP, CREEP_MODEL_MAP } from '../src/data/model-map.js';
import { MESHY_PROMPTS, MESHY_STYLE } from './meshy-prompts.mjs';
import { YT_TOWERS } from '../src/data/youtd/generated.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public/models');
const LICENCES = { 'CC0 1.0': 'https://creativecommons.org/publicdomain/zero/1.0/', 'CC-BY 3.0': 'https://creativecommons.org/licenses/by/3.0/', 'CC-BY 4.0': 'https://creativecommons.org/licenses/by/4.0/' };
const pageUrl = (id) => `https://poly.pizza/m/${id}`;

const families = new Set(YT_TOWERS.filter((r) => r.tier === 1).map((r) => r.name));
const unknown = [...Object.keys(TOWER_MODEL_MAP), ...Object.keys(MESHY_PROMPTS)].filter((n) => !families.has(n));
if (unknown.length) { for (const n of unknown) console.error(`no tower family starts with "${n}"`); process.exit(1); }

// Poly Pizza embeds the model record as JSON in the page.
// Retries a few times: the site rate-limits bursts of page requests.
async function modelInfo(id) {
  for (let attempt = 1; ; attempt++) {
    const html = await (await fetch(pageUrl(id), { headers: { 'User-Agent': 'Mozilla/5.0' } })).text();
    const m = html.match(/window.__SERVER_APP_STATE__ =\s*(\{.*?\})<\/script>/s);
    const model = m && JSON.parse(m[1]).initialData?.model;
    if (model?.ResourceID) return model;
    if (attempt === 4) throw new Error(`no model data for ${id}`);
    await new Promise((r) => setTimeout(r, 3000 * attempt));
  }
}

mkdirSync(OUT, { recursive: true });
const TMP = mkdtempSync(join(tmpdir(), 'youtd-models-'));
const optimize = (raw, file) => execFileSync('npx', ['-y', '@gltf-transform/cli@4', 'optimize', raw, file, '--compress', 'meshopt', '--texture-compress', 'webp', '--texture-size', '512'], { stdio: 'ignore' });
const idOf = (v) => (typeof v === 'string' ? v : v.id);
const creepIds = Object.values(CREEP_MODEL_MAP).flatMap((r) => Object.values(r).map(idOf));
const ids = [...new Set([...Object.values(TOWER_MODEL_MAP).map(idOf), ...creepIds])].sort();
const library = {};
for (const id of ids) {
  const m = await modelInfo(id);
  if (!LICENCES[m.Licence]) throw new Error(`${id} "${m.Title}" has licence ${m.Licence}, which is not allowed`);
  const file = join(OUT, `${id}.glb`);
  if (!existsSync(file)) {
    const res = await fetch(`https://static.poly.pizza/${m.ResourceID}.glb`);
    if (!res.ok) throw new Error(`download failed for ${id}: ${res.status}`);
    const raw = join(TMP, `${id}.glb`);
    writeFileSync(raw, Buffer.from(await res.arrayBuffer()));
    optimize(raw, file);
  }
  library[id] = { title: m.Title.trim(), author: m.Creator?.Username || 'Anonymous', licence: m.Licence, source: pageUrl(id), tris: m.Tris, animated: !!m.Animated };
  console.log(`${id}  ${m.Licence.padEnd(9)} ${String(m.Tris).padStart(6)} tris  ${m.Title} by ${library[id].author}`);
}

// ---------------------------------------------------------------- Meshy

const MESHY = 'https://api.meshy.ai/openapi/v2/text-to-3d';
const slug = (name) => `meshy-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function meshy(path, body) {
  const res = await fetch(`${MESHY}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${process.env.MESHY_API_KEY}`, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Meshy ${res.status}: ${json.message || JSON.stringify(json)}`);
  return json;
}
async function meshyTask(body) {
  const { result: taskId } = await meshy('', body);
  for (;;) {
    await sleep(8000);
    const t = await meshy(`/${taskId}`);
    if (t.status === 'SUCCEEDED') return t;
    if (t.status === 'FAILED' || t.status === 'CANCELED') throw new Error(`Meshy task ${taskId} ${t.status}: ${t.task_error?.message || ''}`);
  }
}
async function generate(name) {
  const preview = await meshyTask({ mode: 'preview', prompt: `${MESHY_PROMPTS[name]} ${MESHY_STYLE}`.slice(0, 800), ai_model: 'latest', topology: 'triangle', target_polycount: 5000, should_remesh: true });
  const refined = await meshyTask({ mode: 'refine', preview_task_id: preview.id, enable_pbr: false });
  const res = await fetch(refined.model_urls.glb);
  if (!res.ok) throw new Error(`download failed for ${name}: ${res.status}`);
  const raw = join(TMP, `${slug(name)}.glb`);
  writeFileSync(raw, Buffer.from(await res.arrayBuffer()));
  optimize(raw, join(OUT, `${slug(name)}.glb`));
  return refined.id;
}

const meshyTowers = {};
const wanted = Object.keys(MESHY_PROMPTS).filter((n) => !TOWER_MODEL_MAP[n]);
const only = process.env.MESHY_ONLY ? new Set(process.env.MESHY_ONLY.split(',').map((s) => s.trim())) : null;
const missing = wanted.filter((n) => !existsSync(join(OUT, `${slug(n)}.glb`)) && (!only || only.has(n)));
const budget = Math.min(missing.length, Number(process.env.MESHY_MAX ?? Infinity));
if (missing.length && !process.env.MESHY_API_KEY) console.log(`${missing.length} Meshy models not generated (set MESHY_API_KEY to generate them)`);
else if (budget) {
  console.log(`generating ${budget} of ${missing.length} missing Meshy models (about ${budget * 30} credits)`);
  // A few at a time: each task takes a minute or two on Meshy's side.
  const queue = missing.slice(0, budget);
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
    for (let name; (name = queue.shift());) {
      try { console.log(`  ${name}: ${await generate(name)}`); } catch (e) { console.error(`  ${name}: ${e.message}`); }
    }
  }));
}
// Tasks ids are not kept; the prompt and the file are what matter for credits.
for (const name of wanted) {
  const id = slug(name);
  if (!existsSync(join(OUT, `${id}.glb`))) continue;
  meshyTowers[name] = id;
  library[id] = { title: name, author: 'Generated with Meshy AI for this project', licence: 'Meshy (paid plan, owned by the project)', source: 'https://www.meshy.ai', tris: 5000, animated: false };
}

rmSync(TMP, { recursive: true, force: true });
// Drop files no longer referenced.
for (const f of readdirSync(OUT)) if (f.endsWith('.glb') && !library[f.slice(0, -4)]) rmSync(join(OUT, f));

writeFileSync(join(ROOT, 'src/data/model-library.js'), `// Generated by tools/import-models.mjs from src/data/model-map.js and
// tools/meshy-prompts.mjs. Do not edit by hand.

// Model file id (public/models/<id>.glb) -> metadata used for credits.
export const MODEL_LIBRARY = ${JSON.stringify(library, null, 2)};

// Tower families whose model was generated with Meshy -> model file id.
export const MESHY_TOWER_MODELS = ${JSON.stringify(meshyTowers, null, 2)};
`);

const users = new Map(Object.keys(library).map((id) => [id, []]));
for (const [name, v] of Object.entries(TOWER_MODEL_MAP)) users.get(idOf(v)).push(name);
for (const [race, kinds] of Object.entries(CREEP_MODEL_MAP)) for (const [kind, v] of Object.entries(kinds)) users.get(idOf(v)).push(`${race} ${kind} creep`);
for (const [name, id] of Object.entries(meshyTowers)) users.get(id).push(name);
const row = (id) => {
  const l = library[id];
  const licence = LICENCES[l.licence] ? `[${l.licence}](${LICENCES[l.licence]})` : l.licence;
  return `| ${l.title} | ${l.author} | [${new URL(l.source).hostname}](${l.source}) | ${licence} | ${users.get(id).join(', ')} |`;
};
const polyIds = ids, meshyIds = Object.values(meshyTowers);
writeFileSync(join(ROOT, 'docs/model-credits.md'), `# Model Credits

Tower and creep models live in \`public/models/\`. Modifications: meshes are
meshopt-compressed and textures resized to at most 512 px and re-encoded as WebP
by gltf-transform; the models are otherwise unchanged. Towers and creeps
without an entry here use the game's own procedural models.

The picks are curated in \`src/data/model-map.js\` and the Meshy prompts in
\`tools/meshy-prompts.mjs\`. This file, \`src/data/model-library.js\` and
\`public/models/\` are generated by \`npm run import:models\` (see
\`tools/import-models.mjs\`); do not edit them by hand.

## Poly Pizza

${polyIds.length} models by ${new Set(polyIds.map((id) => library[id].author)).size} authors, from [Poly Pizza](https://poly.pizza).
Each is CC0 (no attribution required, listed anyway) or CC-BY (attribution required).

| Model | Author | Source | Licence | Used by |
|---|---|---|---|---|
${polyIds.map(row).join('\n')}
${meshyIds.length ? `
## Generated with Meshy

${meshyIds.length} tower models generated for this project with [Meshy](https://www.meshy.ai) on a paid plan,
from the prompts in \`tools/meshy-prompts.mjs\`.

| Model | Author | Source | Licence | Used by |
|---|---|---|---|---|
${meshyIds.map(row).join('\n')}
` : ''}`);
console.log(`wrote ${Object.keys(library).length} models to public/models, src/data/model-library.js and docs/model-credits.md`);
