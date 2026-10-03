// Entry point: menu, game lifecycle, input routing and the main loop.

import { World } from './world/world.js';
import { HUD } from './ui/hud.js';
import { Audio } from './audio/audio.js';
import { Game } from './sim/game.js';
import { DIFFICULTIES, MODES, LENGTHS, MODIFIERS } from './data/constants.js';
import { ACHIEVEMENT_BY_ID, UNLOCKS } from './data/achievements.js';
import { unlockedSet } from './meta/achievements.js';
import { esc } from './ui/util.js';
import { Hall } from './ui/hall.js';
import { ICON_CREDITS } from './data/tower-icons.js';
import { MUSIC_TRACKS } from './data/music-tracks.js';
import { loadProfile, recordRun, recordKey, newRunState } from './meta/profile.js';

const $ = (s) => document.querySelector(s);

const SETTINGS_KEY = 'youtd-reforged-settings';
const load = (k, d) => { try { return { ...d, ...JSON.parse(localStorage.getItem(k) || '{}') }; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } };

const settings = load(SETTINGS_KEY, { uiScale: 1, sfx: 0.6, music: 0.45, dmg: true, edge: true, bloom: true, shadows: true, difficulty: 'medium', mode: 'build', length: 'full', god: 'off' });

const world = new World($('#app'), $('#overlay'));
const audio = new Audio();
const hud = new HUD(world, audio);
let game = null;
let runState = null; // what this game already wrote to the profile
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
    renderMods();
    renderBest();
  }));
}
// The modifiers that will actually apply: known ids the profile has unlocked (God mode ignores locks).
function activeModifiers(unlocked = unlockedSet(loadProfile().profile).modifiers) {
  const picked = Array.isArray(settings.modifiers) ? settings.modifiers : [];
  return picked.filter((m) => MODIFIERS[m] && (settings.god === 'on' || unlocked.has(m)));
}
function renderMods() {
  const unlocked = unlockedSet(loadProfile().profile).modifiers;
  const active = activeModifiers(unlocked);
  const box = $('#opt-mods');
  box.innerHTML = Object.values(MODIFIERS).map((m) => {
    const open = settings.god === 'on' || unlocked.has(m.id);
    const src = ACHIEVEMENT_BY_ID[UNLOCKS.modifiers[m.id].from];
    const tip = open ? m.desc : `Locked. Earn "${src.name}" to unlock: ${src.desc}`;
    return `<button class="choice mod ${active.includes(m.id) ? 'on' : ''} ${open ? '' : 'locked'}" data-v="${m.id}" data-tip="${esc(tip)}">
      <b>${esc(m.name)}</b><small>${open ? `+${Math.round(m.score * 100)}% score` : `🔒 ${esc(src.name)}`}</small></button>`;
  }).join('');
  box.querySelectorAll('.choice').forEach((b) => b.addEventListener('click', () => {
    if (b.classList.contains('locked')) return;
    const set = new Set(active);
    if (set.has(b.dataset.v)) set.delete(b.dataset.v); else set.add(b.dataset.v);
    settings.modifiers = [...set];
    save(SETTINGS_KEY, settings);
    renderMods();
    renderBest();
  }));
}
function renderBest() {
  const best = loadProfile().profile.records[recordKey({ ...settings, modifiers: activeModifiers() })];
  $('#best-score').textContent = best ? `Best on this setup: wave ${best.level} · score ${best.score.toLocaleString()}` : '';
}
renderChoices('#opt-difficulty', DIFFICULTIES, 'difficulty');
renderChoices('#opt-mode', MODES, 'mode');
renderChoices('#opt-length', LENGTHS, 'length');
// God mode is a testing aid; its runs never count toward records or achievements.
const GOD_OPTIONS = {
  off: { id: 'off', name: 'Normal', desc: 'Records count.' },
  on: { id: 'on', name: 'God mode', desc: 'Testing: all elements mastered, 10M gold, 2000 tomes. Nothing is recorded.' },
};
renderChoices('#opt-god', GOD_OPTIONS, 'god');
renderMods();
renderBest();

// The chosen title shows under the logo.
function renderMenuTitle() {
  const t = loadProfile().profile.title;
  $('#menu-title').textContent = t ? UNLOCKS.titles[t].name : '';
  $('#menu-title').classList.toggle('hidden', !t);
}
renderMenuTitle();
// Crest worn by level-cap towers: the chosen one if unlocked, else Gilded once earned.
function applyCrest(profile = loadProfile().profile) {
  const crests = unlockedSet(profile).crests;
  world.crest = crests.has(profile.crest) ? profile.crest : crests.has('gilded') ? 'gilded' : null;
}
applyCrest();
const hall = new Hall((profile) => { renderMenuTitle(); renderMods(); renderBest(); applyCrest(profile); });
document.querySelectorAll('.open-hall').forEach((b) => b.addEventListener('click', () => { audio.click(); hall.open(); }));

// Tower icons are CC BY 3.0 and must be credited where players can see it.
{
  const byAuthor = {};
  for (const c of ICON_CREDITS) (byAuthor[c.author] ||= []).push(`<a href="${c.source}" target="_blank" rel="noopener">${c.iconName}</a>`);
  $('#credits-text').innerHTML = `Tower and item data from <a href="https://github.com/Praytic/youtd2" target="_blank" rel="noopener">YouTD 2</a> (MIT license),
    based on YouTD, the Warcraft III map by geX and the YouTD community. The original author of each tower and item is credited in its tooltip.<br><br>Tower icons from <a href="https://game-icons.net" target="_blank" rel="noopener">game-icons.net</a>, licensed under
    <a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noopener">CC BY 3.0</a> (background removed, recolored). `
    + Object.entries(byAuthor).map(([a, list]) => `<b>${a}</b>: ${list.join(', ')}`).join(' · ')
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
  renderMods();
  renderBest();
  renderMenuTitle();
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
  game = new Game({ difficulty: settings.difficulty, mode: settings.mode, length: settings.length, seed: (Math.random() * 1e9) | 0, god: settings.god === 'on', modifiers: activeModifiers() });
  world.bind(game, audio);
  hud.setGame(game);
  hud.setSpeed(1);
  paused = false;
  runState = newRunState();
  game.on('victory', () => { audio.victory(); endRun(); });
  game.on('defeat', () => { audio.defeat(); endRun(); });
  $('#menu').classList.add('hidden');
  $('#endscreen').classList.add('hidden');
  $('#hud').classList.remove('hidden');
  world.cam.menu = false;
  world.cam.tyaw = 0;
  world.cam.tdist = 66;
  world.focus(0, 0);
  hud.banner('Prepare', game.cfg.god ? 'God mode: everything unlocked, nothing is recorded'
    : settings.mode === 'random' ? 'Your first towers have been drafted' : 'Research an element and build your first towers');
  hud.hint('Pick a tower on the right, place it beside the path, then press <b>Start</b> or <b>Space</b>.');
  setTimeout(() => { if (game && game.phase === 'prep') hud.hint(''); }, 9000);
}

$('#btn-start').addEventListener('click', startGame);
// The welcome screen opens on the controls; Start Game moves on to run setup.
function showMenuStep(setup) {
  $('#menu-intro').classList.toggle('hidden', setup);
  $('#menu-setup').classList.toggle('hidden', !setup);
  $('#menu').scrollTop = 0;
}
$('#btn-continue').addEventListener('click', () => showMenuStep(true));
$('#btn-back').addEventListener('click', () => showMenuStep(false));
$('#btn-again').addEventListener('click', () => { $('#endscreen').classList.add('hidden'); showMenu(); });
// Records the finished run (once per game; God mode is skipped) and shows the summary.
function endRun() {
  const sum = game.summary();
  const result = recordRun(sum, runState);
  if (result) applyCrest(result.profile);
  hud.showEnd(sum, result, result?.profile || loadProfile().profile);
}

$('#btn-endless').addEventListener('click', () => {
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
// Abandoning ends a run in progress; one that never started a wave just returns to the menu.
$('#btn-quit').addEventListener('click', () => {
  openSettings(false);
  if (!game || game.level < 1 || !game.abandon()) { showMenu(); return; }
  endRun();
});
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
  if (e.key === 'Escape' && !$('#hall').classList.contains('hidden')) { hall.close(); return; }
  if (!game || e.target.closest('input')) return;
  if (!$('#endscreen').classList.contains('hidden')) return; // the run is over; keys stay inert behind its summary
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
