// Entry point: menu, game lifecycle, input routing and the main loop.

import { World } from './world/world.js';
import { HUD } from './ui/hud.js';
import { Audio } from './audio/audio.js';
import { Game } from './sim/game.js';
import { DIFFICULTIES, MODES, LENGTHS } from './data/constants.js';
import { ICON_CREDITS } from './data/icon-map.js';
import { MODEL_LIBRARY, MESHY_TOWER_MODELS } from './data/model-library.js';
import { MUSIC_TRACKS } from './data/music-tracks.js';

const $ = (s) => document.querySelector(s);

const SETTINGS_KEY = 'youtd-reforged-settings';
const BEST_KEY = 'youtd-reforged-best';
const load = (k, d) => { try { return { ...d, ...JSON.parse(localStorage.getItem(k) || '{}') }; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } };

const settings = load(SETTINGS_KEY, { uiScale: 1, sfx: 0.6, music: 0.45, dmg: true, edge: true, bloom: true, shadows: true, difficulty: 'medium', mode: 'build', length: 'full', autoWave: false, autoTransmute: false });

const world = new World($('#app'), $('#overlay'));
const audio = new Audio();
const hud = new HUD(world, audio);
let game = null;
let paused = false;

// Interface scale follows the window (1600x900 is the design size), times the player's preference.
function applyUiScale() {
  const auto = Math.min(window.innerWidth / 1600, window.innerHeight / 900);
  const s = Math.max(0.8, Math.min(2, auto * settings.uiScale));
  document.documentElement.style.setProperty('--s', s.toFixed(3));
}
window.addEventListener('resize', applyUiScale);

function applySettings() {
  applyUiScale();
  audio.setVolumes(settings.sfx, settings.music);
  world.fx.textEnabled = settings.dmg;
  world.edgeScroll = settings.edge;
  world.bloom.enabled = settings.bloom;
  world.sun.castShadow = settings.shadows;
  save(SETTINGS_KEY, settings);
}
applySettings();

// ---------------------------------------------------------------- menu

function renderChoices(id, defs, key) {
  const box = $(id);
  box.innerHTML = Object.values(defs).map((d) => `<button class="choice ${settings[key] === d.id ? 'on' : ''}" data-v="${d.id}"><b>${d.name}</b><small>${d.desc}</small></button>`).join('');
  box.querySelectorAll('.choice').forEach((b) => b.addEventListener('click', () => {
    settings[key] = b.dataset.v;
    save(SETTINGS_KEY, settings);
    renderChoices(id, defs, key);
    renderBest();
  }));
}
function bestKey() { return `${settings.difficulty}/${settings.mode}/${settings.length}`; }
function renderBest() {
  const best = load(BEST_KEY, {})[bestKey()];
  $('#best-score').textContent = best ? `Best on this setup: wave ${best.level} · score ${best.score.toLocaleString()}` : '';
}
renderChoices('#opt-difficulty', DIFFICULTIES, 'difficulty');
renderChoices('#opt-mode', MODES, 'mode');
renderChoices('#opt-length', LENGTHS, 'length');
renderBest();

// Tower and item icons are CC BY 3.0 and must be credited where players can see it.
// With hundreds of icons, credit each author with a count; docs/icon-credits.md lists every icon.
{
  const byAuthor = {};
  for (const c of ICON_CREDITS) byAuthor[c.author] = (byAuthor[c.author] || 0) + 1;
  const modelAuthors = {};
  for (const m of Object.values(MODEL_LIBRARY)) modelAuthors[m.author] = (modelAuthors[m.author] || 0) + 1;
  $('#credits-text').innerHTML = `Tower and item data from <a href="https://github.com/Praytic/youtd2" target="_blank" rel="noopener">YouTD 2</a> (MIT license),
    based on YouTD, the Warcraft III map by geX and the YouTD community. The original author of each tower and item is credited in its tooltip.<br><br>Tower and item icons from <a href="https://game-icons.net" target="_blank" rel="noopener">game-icons.net</a>, licensed under
    <a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noopener">CC BY 3.0</a> (background removed, recolored), by `
    + Object.entries(byAuthor).sort((a, b) => b[1] - a[1]).map(([a, n]) => `<b>${a}</b> (${n})`).join(', ')
    + `. Each icon's source is listed in <a href="https://github.com/trungtnm/youtd-3js/blob/main/docs/icon-credits.md" target="_blank" rel="noopener">docs/icon-credits.md</a>.`
    + `<br><br>Tower and creep models from <a href="https://poly.pizza" target="_blank" rel="noopener">Poly Pizza</a> (CC0 and CC BY; compressed, otherwise unchanged)${Object.keys(MESHY_TOWER_MODELS).length ? ' and generated with <a href="https://www.meshy.ai" target="_blank" rel="noopener">Meshy</a>' : ''}, by `
    + Object.entries(modelAuthors).sort((a, b) => b[1] - a[1]).map(([a, n]) => `<b>${a}</b> (${n})`).join(', ')
    + `. Each model's title, author and licence are listed in <a href="https://github.com/trungtnm/youtd-3js/blob/main/docs/model-credits.md" target="_blank" rel="noopener">docs/model-credits.md</a>.`
    + `<br><br>Music: ${MUSIC_TRACKS.map((t) => `"<a href="${t.source}" target="_blank" rel="noopener">${t.title}</a>" by ${t.artist}`).join(', ')}
    (incompetech.com), licensed under <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>; re-encoded to 128 kbps.
    Sound effects are synthesised in-game with Web Audio.<br><br>Built with <a href="https://threejs.org" target="_blank" rel="noopener">three.js</a> (MIT license).
    Fonts <a href="https://fonts.google.com/specimen/Cinzel" target="_blank" rel="noopener">Cinzel</a>, Cinzel Decorative and
    <a href="https://fonts.google.com/specimen/Inter" target="_blank" rel="noopener">Inter</a> via Google Fonts, licensed under the
    <a href="https://openfontlicense.org" target="_blank" rel="noopener">SIL Open Font License</a>.`;
}

function showMenu() {
  $('#menu').classList.remove('hidden');
  $('#hud').classList.add('hidden');
  $('#endscreen').classList.add('hidden');
  $('#settings').classList.add('hidden');
  world.cam.menu = true;
  world.cam.tx = 0; world.cam.tz = 2;
  if (game) { world.game = null; clearWorld(); }
  game = null;
  renderBest();
}

function clearWorld() {
  for (const uid of [...world.towerViews.keys()]) world._removeTower(uid);
  for (const [, v] of world.creepViews) world.scene.remove(v.group);
  world.creepViews.clear();
  for (const d of world.dying) world.scene.remove(d.v.group);
  world.dying = [];
  world.fx.syncProjectiles([]);
  world.setGhost(null);
}

function startGame() {
  audio.init();
  audio.click();
  if (game) clearWorld();
  game = new Game({ difficulty: settings.difficulty, mode: settings.mode, length: settings.length, autoWave: settings.autoWave, autoTransmute: settings.autoTransmute, seed: (Math.random() * 1e9) | 0 });
  world.bind(game, audio);
  hud.setGame(game);
  hud.onAutoWave = (on) => { settings.autoWave = on; save(SETTINGS_KEY, settings); };
  hud.onAutoTransmute = (on) => { settings.autoTransmute = on; save(SETTINGS_KEY, settings); };
  hud.setSpeed(1);
  paused = false;
  game.on('victory', (sum) => { recordBest(sum); audio.victory(); hud.showEnd(true, sum, settings.length !== 'endless'); });
  game.on('defeat', (sum) => { recordBest(sum); audio.defeat(); hud.showEnd(false, sum, false); });
  $('#menu').classList.add('hidden');
  $('#endscreen').classList.add('hidden');
  $('#hud').classList.remove('hidden');
  world.cam.menu = false;
  world.cam.tyaw = 0;
  world.cam.tdist = 66;
  world.focus(0, 0);
  hud.banner('Prepare', settings.mode === 'random' ? 'Your first towers have been drafted' : 'Research an element and build your first towers');
  hud.hint('Pick a tower on the right, place it beside the path, then press <b>Start</b> or <b>Space</b>.');
  setTimeout(() => { if (game && game.phase === 'prep') hud.hint(''); }, 9000);
}

function recordBest(sum) {
  const all = load(BEST_KEY, {});
  const prev = all[bestKey()];
  if (!prev || sum.score > prev.score) { all[bestKey()] = { level: sum.level, score: sum.score }; save(BEST_KEY, all); }
}

$('#btn-start').addEventListener('click', startGame);
// The welcome screen opens on the controls; Start Game moves on to run setup.
function showMenuStep(setup) {
  $('#menu-intro').classList.toggle('hidden', setup);
  $('#menu-setup').classList.toggle('hidden', !setup);
  $('#menu').scrollTop = 0;
}
$('#btn-setup').addEventListener('click', () => showMenuStep(true));
$('#btn-back').addEventListener('click', () => showMenuStep(false));
$('#btn-again').addEventListener('click', () => { $('#endscreen').classList.add('hidden'); showMenu(); });
$('#btn-continue').addEventListener('click', () => {
  game.finalWave = Infinity;
  game.phase = 'running';
  $('#r-wavemax').textContent = '';
  $('#endscreen').classList.add('hidden');
});

// ---------------------------------------------------------------- settings modal

function openSettings(open) {
  paused = open;
  $('#settings').classList.toggle('hidden', !open);
  if (open) {
    $('#set-ui').value = settings.uiScale;
    $('#set-sfx').value = settings.sfx; $('#set-music').value = settings.music;
    $('#set-dmg').checked = settings.dmg; $('#set-edge').checked = settings.edge;
    $('#set-bloom').checked = settings.bloom; $('#set-shadows').checked = settings.shadows;
  }
}
$('#btn-settings').addEventListener('click', () => openSettings(true));
$('#btn-resume').addEventListener('click', () => openSettings(false));
$('#btn-quit').addEventListener('click', () => { openSettings(false); showMenu(); });
for (const [id, key, num] of [['#set-ui', 'uiScale', true], ['#set-sfx', 'sfx', true], ['#set-music', 'music', true], ['#set-dmg', 'dmg'], ['#set-edge', 'edge'], ['#set-bloom', 'bloom'], ['#set-shadows', 'shadows']]) {
  $(id).addEventListener('input', (e) => { settings[key] = num ? Number(e.target.value) : e.target.checked; applySettings(); });
}

// ---------------------------------------------------------------- world input

const canvas = world.renderer.domElement;
let downAt = null;
canvas.addEventListener('pointerdown', (e) => { if (e.button === 0) downAt = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointerup', (e) => {
  if (!game) return;
  if (e.button === 2) {
    if ((world.lastDragMoved || 0) > 6) return;
    if (hud.placing) hud.stopPlacing();
    else if (hud.selectedItem) { hud.selectedItem = null; hud.hint(''); hud.renderStash(true); }
    else hud.select(null);
    return;
  }
  if (e.button !== 0 || !downAt) return;
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
  downAt = null;
  if (moved > 6) return;
  if (hud.placing) {
    const tile = world.pickGround();
    if (!tile) return;
    const t = game.build(hud.placing, tile.c, tile.r);
    if (t) {
      const keep = e.shiftKey && (game.cfg.mode !== 'random' || game.towerStash.includes(hud.placing));
      if (!keep) { hud.stopPlacing(); hud.select({ type: 'tower', uid: t.uid }); }
    }
    return;
  }
  const hit = world.pickUnit();
  if (hit && hit.type === 'tower' && hud.selectedItem) {
    const t = game.towers.get(hit.uid);
    if (game.equip(hud.selectedItem, t)) { audio.upgrade(); hud.selectedItem = null; hud.hint(''); }
    hud.select(hit);
    return;
  }
  if (hit) audio.click();
  hud.select(hit);
});
canvas.addEventListener('dragover', (e) => e.preventDefault());
canvas.addEventListener('drop', (e) => {
  e.preventDefault();
  if (!game) return;
  const uid = Number(e.dataTransfer.getData('text/item'));
  world.mouse.ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  const hit = world.pickUnit();
  if (uid && hit?.type === 'tower' && game.equip(uid, game.towers.get(hit.uid))) { audio.upgrade(); hud.select(hit); }
});

window.addEventListener('keydown', (e) => {
  if (!game || e.target.closest('input')) return;
  const k = e.key.toLowerCase();
  if (k === 'escape') {
    if (hud.placing) hud.stopPlacing();
    else if (hud.selection || hud.selectedItem) { hud.selectedItem = null; hud.hint(''); hud.select(null); }
    else openSettings($('#settings').classList.contains('hidden'));
    return;
  }
  if (!$('#settings').classList.contains('hidden')) return;
  if (k === ' ') { e.preventDefault(); game.callNextWave(); }
  else if (k === 'p') hud.setSpeed(hud.speed === 0 ? 1 : 0);
  else if (k === '1' || k === '2' || k === '3') hud.setSpeed(Number(k));
  else if (k === 'u') hud.upgradeSelected();
  else if (k === 't') hud.trainSelected();
  else if (k === 'f') hud.castSelected(0);
  else if (k === 'g') hud.castSelected(1);
  else if (k === 'x' || k === 'delete') hud.sellSelected();
});

// ---------------------------------------------------------------- loop

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (game && !paused && hud.speed > 0 && $('#endscreen').classList.contains('hidden')) {
    // Fixed sub-steps keep the simulation stable at high game speeds.
    const total = dt * hud.speed;
    const steps = Math.ceil(total / (1 / 60));
    for (let i = 0; i < steps; i++) game.update(total / steps);
  }
  if (game && hud.placing) {
    const tile = world.pickGround();
    world.updateGhost(tile, tile ? !game.buildCheck(hud.placing, tile.c, tile.r) : false);
    world.setHover(null);
  } else if (game && world.mouse.inside && !document.querySelector('#hud .panel:hover, #topbar:hover, #alert:hover')) {
    world.setHover(world.pickTower());
  } else world.setHover(null);
  if (game) {
    const boss = game.creeps.some((c) => c.alive && (c.size === 'boss' || c.size === 'challenge'));
    if (audio.ctx) audio.setMood(boss ? 'boss' : game.creeps.length ? 'battle' : 'calm');
  }
  const fxDt = game && (paused || hud.speed === 0) ? 0 : dt * (game ? Math.max(1, hud.speed * 0.75) : 1);
  world.render(fxDt || dt * 0.0001, hud.selection, dt);
  hud.update(dt);
}

// Let the first frame render before revealing the menu.
requestAnimationFrame((t) => {
  last = t;
  frame(t);
  setTimeout(() => $('#loading').classList.add('hidden'), 250);
});

window.__youtd = { get game() { return game; }, world, hud };
