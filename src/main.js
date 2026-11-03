// Entry point: menu, game lifecycle, input routing and the main loop.

import { World } from './world/world.js';
import { MAPS, DEFAULT_MAP } from './world/environment.js';
import { HUD } from './ui/hud.js';
import { Audio } from './audio/audio.js';
import { Game, TICK } from './sim/game.js';
import { DIFFICULTIES, MODES, LENGTHS, MODIFIERS } from './data/constants.js';
import { ICON_CREDITS } from './data/icon-map.js';
import { MODEL_LIBRARY, MESHY_TOWER_MODELS } from './data/model-library.js';
import { ACHIEVEMENT_BY_ID, UNLOCKS } from './data/achievements.js';
import { unlockedSet } from './meta/achievements.js';
import { esc } from './ui/util.js';
import { Hall } from './ui/hall.js';
import { MUSIC_TRACKS } from './data/music-tracks.js';
import { loadProfile, recordRun, recordKey, newRunState, applyRun } from './meta/profile.js';
import { SIM_BUILD } from './sim/sim-build.js';
import { Online } from './online/online.js';
import { AccountPanel } from './ui/account.js';
import { Boards } from './ui/boards.js';

const $ = (s) => document.querySelector(s);

const SETTINGS_KEY = 'youtd-reforged-settings';
const load = (k, d) => { try { return { ...d, ...JSON.parse(localStorage.getItem(k) || '{}') }; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } };

const settings = load(SETTINGS_KEY, { uiScale: 1, sfx: 0.6, music: 0.45, dmg: true, edge: true, bloom: true, shadows: true, quality: 'high', difficulty: 'medium', mode: 'build', length: 'full', map: DEFAULT_MAP, autoWave: false, god: 'off' });

const world = new World($('#app'), $('#overlay'));
world.setMap(settings.map);
const audio = new Audio();
const hud = new HUD(world, audio);
let game = null;
let runState = null; // what this game already wrote to the profile
let runTicket = null; // { runId, ticket } when the server issued this run's seed
let paused = false;

// The account (guest or signed in) when the game server is reachable. Its profile,
// built by the server from verified runs, decides unlocks; without one the profile
// stored in this browser does.
const online = new Online();
const activeProfile = () => online.profile || loadProfile().profile;

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
  world.setQuality(settings.quality);
  save(SETTINGS_KEY, settings);
}
applySettings();

// ---------------------------------------------------------------- menu

function renderChoices(id, defs, key, onChange) {
  const box = $(id);
  box.innerHTML = Object.values(defs).map((d) => `<button class="choice ${settings[key] === d.id ? 'on' : ''}" data-v="${d.id}"><b>${d.name}</b><small>${d.desc}</small></button>`).join('');
  box.querySelectorAll('.choice').forEach((b) => b.addEventListener('click', () => {
    settings[key] = b.dataset.v;
    save(SETTINGS_KEY, settings);
    renderChoices(id, defs, key, onChange);
    onChange?.(b.dataset.v);
    renderMods();
    renderBest();
  }));
}
// The modifiers that will actually apply: known ids the profile has unlocked (God mode ignores locks).
function activeModifiers(unlocked = unlockedSet(activeProfile()).modifiers) {
  const picked = Array.isArray(settings.modifiers) ? settings.modifiers : [];
  return picked.filter((m) => MODIFIERS[m] && (settings.god === 'on' || unlocked.has(m)));
}
function renderMods() {
  const unlocked = unlockedSet(activeProfile()).modifiers;
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
  const best = activeProfile().records[recordKey({ ...settings, modifiers: activeModifiers() })];
  $('#best-score').textContent = best ? `Best on this setup: wave ${best.level} · score ${best.score.toLocaleString()}` : '';
}
// The menu backdrop switches to the chosen map at once.
renderChoices('#opt-map', MAPS, 'map', (id) => world.setMap(id));
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
  const t = activeProfile().title;
  $('#menu-title').textContent = t ? UNLOCKS.titles[t].name : '';
  $('#menu-title').classList.toggle('hidden', !t);
}
renderMenuTitle();
// Crest worn by level-cap towers: the chosen one if unlocked, else Gilded once earned.
function applyCrest(profile = activeProfile()) {
  const crests = unlockedSet(profile).crests;
  world.crest = crests.has(profile.crest) ? profile.crest : crests.has('gilded') ? 'gilded' : null;
}
applyCrest();
const refreshMenu = () => { renderMenuTitle(); renderMods(); renderBest(); applyCrest(); renderAccountChip(); };
const hall = new Hall(refreshMenu, online);
document.querySelectorAll('.open-hall').forEach((b) => b.addEventListener('click', () => { audio.click(); hall.open(); }));
const account = new AccountPanel(online, refreshMenu);
const boards = new Boards(online, () => { showMenuStep(true); startGame(true); });
document.querySelectorAll('.open-boards').forEach((b) => b.addEventListener('click', () => {
  audio.click();
  boards.open({ difficulty: settings.difficulty, mode: settings.mode, length: settings.length, modifiers: activeModifiers() });
}));
$('#account-chip').addEventListener('click', () => { audio.click(); account.open(); });

function renderAccountChip() {
  const chip = $('#account-chip');
  const u = online.user;
  chip.classList.toggle('offline', !online.canStartRuns);
  chip.innerHTML = online.status === 'checking' ? '<span>Connecting…</span>'
    : !online.ready ? '<span>Offline</span><small>Progress stays in this browser</small>'
    : online.outdated ? '<span>New version available</span><small>Reload the page to play online</small>'
    : `<span>${esc(u.name)}</span><small>${u.guest ? 'Guest · Sign in to keep progress' : 'Signed in'}</small>`;
}
online.on('change', refreshMenu);
online.on('profile', refreshMenu);
// The end screen follows the upload and verification of the run it shows.
online.on('runStatus', (r) => { if (runTicket && r.runId === runTicket.runId) hud.setRunVerify(r.status); });
{
  // Coming back from Google sign-in or an emailed link.
  const params = new URLSearchParams(window.location.search);
  const signin = params.get('signin');
  if (signin) {
    history.replaceState(null, '', window.location.pathname);
    if (signin === 'error') setTimeout(() => { account.open(); account.msg = 'Sign-in did not complete. Please try again.'; account.render(); }, 0);
  }
}
renderAccountChip();
online.init();

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
    Sound effects are synthesised in-game with Web Audio.<br><br>Lightning bolts, the meteor's burning rock, its molten ground cracks and the erupting ice crystals are adapted from
    <a href="https://github.com/achrefelouafi/LinearAbiltyCastingThreeJS" target="_blank" rel="noopener">LinearAbiltyCastingThreeJS</a> by mohamedachrefelouafi (MIT license).<br><br>Built with <a href="https://threejs.org" target="_blank" rel="noopener">three.js</a> (MIT license).
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
  for (const r of world.raiders) world.scene.remove(r.v.group);
  world.raiders = [];
  world.fx.syncProjectiles([]);
  world.setGhost(null);
}

// Online runs get their seed and settings from the server, which later replays the
// run to verify it. Without a connection the run is kept in this browser.
let starting = false;
async function startGame(weekly = false) {
  if (starting) return;
  audio.init();
  audio.click();
  const god = settings.god === 'on';
  let cfg = { difficulty: settings.difficulty, mode: settings.mode, length: settings.length, modifiers: activeModifiers() };
  let seed = (Math.random() * 1e9) | 0;
  runTicket = null;
  if (online.canStartRuns && !god) {
    starting = true;
    $('#btn-start').disabled = true;
    const t = await online.startRun(cfg, weekly);
    $('#btn-start').disabled = false;
    starting = false;
    if (!t.error) { runTicket = { runId: t.runId, ticket: t.ticket }; seed = t.seed; cfg = { ...cfg, ...t.cfg }; }
    else if (t.error === 'outdated') { showMenuStep(true); $('#best-score').textContent = 'A new version of the game is out. Reload the page to play online; this run would stay in this browser.'; renderAccountChip(); return; }
    else if (t.error !== 'offline' && t.error !== 'network') { showMenuStep(true); $('#best-score').textContent = t.message || 'The server refused to start this run.'; return; }
  }
  if (weekly && !runTicket) { $('#best-score').textContent = 'The weekly challenge needs a connection to the game server.'; return; }
  if (game) clearWorld();
  game = new Game({ ...cfg, autoWave: settings.autoWave, seed, god });
  world.bind(game, audio);
  hud.setGame(game);
  hud.onAutoWave = (on) => { settings.autoWave = on; save(SETTINGS_KEY, settings); };
  hud.setSpeed(1);
  paused = false;
  runState = newRunState();
  tickBudget = 0;
  game.on('victory', () => { audio.victory(); endRun(); });
  game.on('defeat', () => { audio.defeat(); endRun(); });
  $('#menu').classList.add('hidden');
  $('#endscreen').classList.add('hidden');
  $('#hud').classList.remove('hidden');
  world.cam.menu = false;
  world.cam.tyaw = 0;
  world.cam.tdist = 66 * world.viewScale;
  world.focus(0, 0);
  hud.banner('Prepare', game.cfg.god ? 'God mode: everything unlocked, nothing is recorded'
    : settings.mode === 'random' ? 'Your first towers have been drafted' : 'Research an element and build your first towers');
  hud.hint('Pick a tower on the right, place it beside the path, then press <b>Start</b> or <b>Space</b>.');
  setTimeout(() => { if (game && game.phase === 'prep') hud.hint(''); }, 9000);
}

$('#btn-start').addEventListener('click', () => startGame(false));
// The welcome screen opens on the controls; Start Game moves on to run setup.
function showMenuStep(setup) {
  $('#menu-intro').classList.toggle('hidden', setup);
  $('#menu-setup').classList.toggle('hidden', !setup);
  $('#menu').scrollTop = 0;
}
$('#btn-setup').addEventListener('click', () => showMenuStep(true));
$('#btn-back').addEventListener('click', () => showMenuStep(false));
$('#btn-again').addEventListener('click', () => { $('#endscreen').classList.add('hidden'); showMenu(); });
// Records the finished run (once per game; God mode is skipped) and shows the summary.
// An online run is uploaded for the server to verify; the end screen previews its
// result on a copy of the account profile with the same rules the server applies.
function endRun() {
  const sum = game.summary();
  if (runTicket) {
    const profile = structuredClone(activeProfile());
    const result = { ...applyRun(profile, sum, runState), saved: true };
    hud.showEnd(sum, result, profile, 'uploading');
    const claim = { outcome: sum.outcome, level: sum.level, wavesCleared: sum.wavesCleared, score: sum.score, kills: sum.kills, time: sum.time };
    online.submitRun({ ...runTicket, log: game.exportLog(SIM_BUILD), claim }).catch(() => hud.setRunVerify('waiting'));
    return;
  }
  const result = recordRun(sum, runState);
  if (result) applyCrest(result.profile);
  hud.showEnd(sum, result, result?.profile || loadProfile().profile, online.user && !sum.cfg.god ? 'local' : null);
}

$('#btn-endless').addEventListener('click', () => {
  if (!game.command('continue')) return;
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
    $('#set-quality').value = settings.quality;
  }
}
$('#btn-settings').addEventListener('click', () => openSettings(true));
$('#btn-resume').addEventListener('click', () => openSettings(false));
// Abandoning ends a run in progress; one that never started a wave just returns to the menu.
$('#btn-quit').addEventListener('click', () => {
  openSettings(false);
  if (game?.command('finish')) return; // a secured run ends as a victory instead of being abandoned
  if (!game || game.level < 1 || !game.command('abandon')) { showMenu(); return; }
  endRun();
});
for (const [id, key, num] of [['#set-ui', 'uiScale', true], ['#set-sfx', 'sfx', true], ['#set-music', 'music', true], ['#set-dmg', 'dmg'], ['#set-edge', 'edge'], ['#set-bloom', 'bloom'], ['#set-shadows', 'shadows']]) {
  $(id).addEventListener('input', (e) => { settings[key] = num ? Number(e.target.value) : e.target.checked; applySettings(); });
}
$('#set-quality').addEventListener('change', (e) => { settings.quality = e.target.value; applySettings(); });

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
    const t = game.command('build', { id: hud.placing, c: tile.c, r: tile.r });
    if (t) {
      const keep = e.shiftKey && (game.cfg.mode !== 'random' || game.towerStash.includes(hud.placing));
      if (!keep) { hud.stopPlacing(); hud.select({ type: 'tower', uid: t.uid }); }
    }
    return;
  }
  const hit = world.pickUnit();
  if (hit && hit.type === 'tower' && hud.selectedItem) {
    const t = game.towers.get(hit.uid);
    if (t && game.command('equip', { item: hud.selectedItem, tower: t.uid })) { audio.upgrade(); hud.selectedItem = null; hud.hint(''); }
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
  if (uid && hit?.type === 'tower' && game.command('equip', { item: uid, tower: hit.uid })) { audio.upgrade(); hud.select(hit); }
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#hall').classList.contains('hidden')) { hall.close(); return; }
  if (e.key === 'Escape' && account.isOpen()) { account.close(); return; }
  if (e.key === 'Escape' && !$('#boards').classList.contains('hidden')) { boards.close(); return; }
  if (!game || e.target.closest('input')) return;
  if (!$('#endscreen').classList.contains('hidden')) return; // the run is over; keys stay inert behind its summary
  const k = e.key.toLowerCase();
  if (k === 'escape') {
    if (hud.scoreboard.open) hud.toggleScoreboard();
    else if (hud.placing) hud.stopPlacing();
    else if (hud.selection || hud.selectedItem) { hud.selectedItem = null; hud.hint(''); hud.select(null); }
    else openSettings($('#settings').classList.contains('hidden'));
    return;
  }
  if (!$('#settings').classList.contains('hidden')) return;
  if (k === 'tab') { e.preventDefault(); hud.toggleScoreboard(); }
  else if (k === ' ') { e.preventDefault(); game.command('wave'); }
  else if (k === 'p') hud.setSpeed(hud.speed === 0 ? 1 : 0);
  else if (k === '1' || k === '2' || k === '3') hud.setSpeed(Number(k));
  else if (k === 'u') hud.upgradeSelected();
  else if (k === 'b') hud.toggleTowerPanel();
  else if (k === 't') hud.trainSelected(e.shiftKey);
  else if (k === 'f') hud.castSelected(0);
  else if (k === 'g') hud.castSelected(1);
  else if (k === 'x' || k === 'delete') hud.sellSelected();
});

// ---------------------------------------------------------------- loop

let last = performance.now();
let tickBudget = 0;
const MAX_FRAME_TICKS = 12; // 3x speed at a 20 fps floor
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (game && !paused && hud.speed > 0 && $('#endscreen').classList.contains('hidden')) {
    // The simulation runs in fixed ticks so the run replays exactly from its log;
    // game speed changes how many ticks a frame runs, never the tick length.
    tickBudget = Math.min(tickBudget + dt * hud.speed, MAX_FRAME_TICKS * TICK);
    while (tickBudget >= TICK) { tickBudget -= TICK; game.step(); }
    world.tickAlpha = tickBudget / TICK;
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
