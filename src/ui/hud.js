// DOM HUD: resources, wave preview, build panel, item stash, selection panel,
// tooltips, banners and end screens.

import {
  ELEMENTS, ELEMENT_IDS, RARITIES, ATTACK_TYPES, ARMOR_TYPES, DAMAGE_MATRIX, RACES, SIZES, ECON, xpForLevel, TOWER_MAX_LEVEL,
} from '../data/constants.js';
import { TOWERS, TOWER_LIST, FAMILIES, nextTier, describeAbility, revealsInvisible, REVEAL_FAMILIES, describeTowerMods } from '../data/towers.js';
import { ITEMS, describeItem, describeMods } from '../data/items.js';
import { describeSkill } from '../data/tower-skills.js';
import { PERKS, PERK_LEVELS } from '../data/tower-perks.js';
import { SPOILS } from '../data/boss-spoils.js';
import { SPECIALS } from '../sim/waves.js';
import { COLS, ROWS, TILE, GROUND_ROUTE, AIR_ROUTE, PORTAL, MAP_W, MAP_D } from '../sim/map-layout.js';
import { fmt } from '../world/world.js';

const $ = (s) => document.querySelector(s);
// Element-tinted tower glyph (SVG used as a CSS mask so currentColor applies).
const towerIcon = (icon, size = '') => `<span class="ico ${size}" style="--icon:url('${icon}')"></span>`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SIZE_ICON = { mass: '⁂', normal: '☗', air: '🜁', boss: '☠', champion: '♛', challenge: '✪', challengeMass: '✪' };
const SIZE_LABEL = { mass: 'Mass', normal: 'Normal', air: 'Air', boss: 'Boss', champion: 'Champion', challenge: 'Challenge', challengeMass: 'Challenge' };

// Attack types that deal >= 1.5x against an armor.
const strongVs = (armor) => Object.keys(DAMAGE_MATRIX).filter((a) => DAMAGE_MATRIX[a][armor] >= 1.5);

export class HUD {
  constructor(world, audio) {
    this.world = world;
    this.audio = audio;
    this.game = null;
    this.element = 'nature';
    this.placing = null;
    this.selection = null;
    this.selectedItem = null;
    this.transmuteSel = new Set();
    this.sigs = {};
    this.tick = 0;
    this.speed = 1;
    this._bindStatic();
  }

  // ---------------------------------------------------------------- setup

  _bindStatic() {
    $('#btn-next').addEventListener('click', () => { this.audio.click(); this.game?.callNextWave(); });
    document.querySelectorAll('.speed button').forEach((b) => b.addEventListener('click', () => this.setSpeed(Number(b.dataset.speed))));
    $('#btn-transmute').addEventListener('click', () => {
      if (!this.game) return;
      if (this.game.transmute([...this.transmuteSel])) { this.transmuteSel.clear(); this.audio.item('rare'); } else this.audio.error();
    });
    // Tooltips
    const tip = $('#tooltip');
    document.addEventListener('mouseover', (e) => {
      const el = e.target.closest('[data-tip],[data-tt]');
      if (!el) { tip.classList.add('hidden'); return; }
      const html = el.dataset.tt ? this.richTip(el.dataset.tt) : esc(el.dataset.tip);
      if (!html) { tip.classList.add('hidden'); return; }
      tip.innerHTML = html;
      tip.classList.remove('hidden');
    });
    document.addEventListener('mousemove', (e) => {
      if (tip.classList.contains('hidden')) return;
      const r = tip.getBoundingClientRect();
      let x = e.clientX + 16, y = e.clientY + 16;
      if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - 16;
      if (y + r.height > window.innerHeight - 8) y = e.clientY - r.height - 12;
      tip.style.left = `${x}px`; tip.style.top = `${y}px`;
    });
  }

  setGame(game) {
    const g = game;
    this.game = game;
    this.alertDismissed = 0;
    this.selection = null;
    this.placing = null;
    this.selectedItem = null;
    this.transmuteSel.clear();
    this.sigs = {};
    this.element = 'nature';
    $('#r-wavemax').textContent = Number.isFinite(game.finalWave) ? ` / ${game.finalWave}` : '';
    $('#btn-next').textContent = 'Start';
    game.on('error', (msg) => { this.toast(msg, 'error'); this.audio.error(); });
    game.on('notice', ({ text, kind }) => this.toast(text, kind));
    game.on('waveStart', (w) => {
      if (!this.placing && !this.selectedItem) this.hint('');
      $('#btn-next').textContent = 'Next wave';
      $('#btn-next').classList.remove('pulse');
      if (w.specials.includes('invisible')) this.banner(`Wave ${w.level}`, g.hasRevealer() ? 'Invisible creeps — your revealing towers are watching' : 'Invisible creeps — build a revealing tower!', true);
      else if (w.challenge) this.banner(`Wave ${w.level}`, 'Challenge — every hit pays', true);
      else if (w.size === 'boss') this.banner(`Wave ${w.level}`, `${RACES[w.race].name} warlord approaches`, true);
      else this.banner(`Wave ${w.level}`, `${w.list.length} ${RACES[w.race].name} · ${ARMOR_TYPES[w.armor].name} armor`);
      this.sigs.waves = null;
    });
    game.on('waveCleared', ({ level, income, interest, tomes }) => {
      this.toast(`Wave ${level} cleared · +${income} gold${interest ? ` · +${interest} interest` : ''} · +${tomes} tomes`, 'gold');
      this.sigs.waves = null;
    });
    game.on('draft', () => { this.sigs.build = null; });
    game.on('research', ({ element, level }) => { this.toast(`${ELEMENTS[element].name} research reached level ${level}`, 'gold'); this.sigs.build = null; });
    game.on('stash', () => { this.sigs.stash = null; this.sigs.sel = null; });
    game.on('itemDrop', ({ item }) => {
      const d = ITEMS[item.id];
      this.toast(`Found ${d.icon} ${d.name}`, 'item');
    });
    game.on('invisibleWarning', ({ level, now, covered }) => {
      if (!covered) { this.alertDismissed = 0; this.audio.error(); this.toast(now ? `Wave ${level} is invisible and you cannot see it!` : `Invisible creeps arrive on wave ${level}`, 'warn'); }
    });
    game.on('towerSold', ({ tower }) => { if (this.selection?.uid === tower.uid) this.select(null); });
    game.on('levelUp', () => { this.sigs.sel = null; });
    game.on('perkReady', (t) => {
      this.toast(`${t.def.name} reached level ${t.level}: choose a perk`, 'gold');
      this.world.fx.text(t.x, 4.5, t.z, 'Perk!', 'level');
      this.sigs.sel = null;
      this.renderPerkQueue();
    });
    game.on('perkChosen', ({ tower, perk }) => {
      this.world.fx.levelUp(tower);
      this.toast(`${tower.def.name} learned ${PERKS[perk].name}`, 'gold');
      this.sigs.sel = null;
      this.sigs.perkQueue = null;
      this.renderPerkQueue();
    });
    game.on('trained', () => { this.sigs.sel = null; });
    game.on('spoilsReady', () => { this.sigs.spoils = null; this.renderSpoils(); });
    game.on('spoilChosen', (o) => {
      this.sigs.spoils = null;
      this.renderSpoils();
      this.renderPerkQueue();
      this.audio.item(o.item ? ITEMS[o.item.id].rarity : 'rare');
      this.toast(o.item ? `Claimed ${ITEMS[o.item.id].icon} ${ITEMS[o.item.id].name}` : `Claimed ${SPOILS[o.type].name}`, 'gold');
    });
    this.renderAll();
  }

  renderAll() {
    this.renderBuild(true);
    this.renderWaves(true);
    this.renderStash(true);
    this.renderSelection(true);
  }

  setSpeed(s) {
    this.speed = s;
    document.querySelectorAll('.speed button').forEach((b) => b.classList.toggle('on', Number(b.dataset.speed) === s));
    this.audio.click();
  }

  // ---------------------------------------------------------------- messages

  toast(text, kind = '') {
    const box = $('#toasts');
    while (box.children.length > 4) box.firstChild.remove();
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    // Keep toasts above the selection console, whatever its current height.
    const sel = $('#selection');
    const selH = sel && !sel.classList.contains('hidden') ? sel.offsetHeight : 0;
    box.style.bottom = `${selH + 24}px`;
    box.appendChild(el);
    setTimeout(() => el.remove(), 2700);
  }

  banner(title, sub, boss = false) {
    const b = $('#banner');
    b.innerHTML = `<h1>${esc(title)}</h1><p>${esc(sub)}</p>`;
    // Drop the banner lower while the boss spoils panel occupies the top centre.
    b.className = `${boss ? 'boss' : ''} ${$('#spoils') && !$('#spoils').classList.contains('hidden') ? 'low' : ''}`;
    void b.offsetWidth;
    b.classList.add('show');
  }

  hint(html) { $('#hint').innerHTML = html || ''; }

  // ---------------------------------------------------------------- per-frame

  update(dt) {
    const g = this.game;
    if (!g) return;
    this.tick += dt;
    $('#r-gold').textContent = fmt(Math.floor(g.gold));
    $('#r-tomes').textContent = g.tomes;
    $('#r-food').textContent = `${g.towers.size}`;
    $('#r-lives').textContent = `${Math.max(0, Math.round(g.lives))}%`;
    $('#r-livesbar').style.width = `${Math.max(0, g.lives)}%`;
    $('.res.lives').classList.toggle('low', g.lives < 30);
    $('#r-wave').textContent = g.level;
    $('#r-score').textContent = fmt(g.score);
    const gap = ECON.waveGap + 10;
    $('#r-timer').style.width = g.phase === 'running' && g.level < g.finalWave ? `${Math.max(0, Math.min(1, 1 - g.nextWaveTimer / gap)) * 100}%` : '0%';
    $('#btn-next').disabled = g.level >= g.finalWave || g.phase === 'won' || g.phase === 'lost';
    if (g.phase === 'prep') $('#btn-next').classList.add('pulse');

    if (this.tick > 0.2) {
      this.tick = 0;
      this.renderBuild();
      this.renderWaves();
      this.renderStash();
      this.renderSelection();
      this.renderAlert();
      this.renderSpoils();
    }
  }

  // ---------------------------------------------------------------- build panel

  availableTowers() {
    const g = this.game;
    if (g.cfg.mode === 'random') {
      const counts = {};
      for (const id of g.towerStash) counts[id] = (counts[id] || 0) + 1;
      return Object.entries(counts).map(([id, n]) => ({ def: TOWERS[id], count: n }));
    }
    // The shop lists only first tiers; higher tiers are reached through Upgrade on a built tower.
    return TOWER_LIST.filter((t) => t.element === this.element && t.tier === 0).map((def) => ({ def }));
  }

  renderBuild(force) {
    const g = this.game;
    const sig = [this.element, Math.floor(g.gold / 10), g.tomes, g.food, g.foodCap, JSON.stringify(g.research), g.towerStash.join(), this.placing].join('|');
    if (!force && sig === this.sigs.build) return;
    this.sigs.build = sig;
    const random = g.cfg.mode === 'random';

    // Tabs
    const tabs = $('#element-tabs');
    tabs.innerHTML = ELEMENT_IDS.map((e) => {
      const el = ELEMENTS[e];
      return `<button class="etab ${this.element === e ? 'on' : ''}" data-el="${e}" style="color:${el.css}" data-tip="${el.name} — research level ${g.research[e]}">${el.glyph}<span class="lv">${g.research[e]}</span></button>`;
    }).join('') + (random ? `<button class="etab ${this.element === 'draft' ? 'on' : ''}" data-el="draft" style="color:#ffcf5a" data-tip="Your drafted towers">🂠<span class="lv">${g.towerStash.length}</span></button>` : '');
    tabs.querySelectorAll('.etab').forEach((b) => b.addEventListener('click', () => { this.element = b.dataset.el; this.audio.click(); this.renderBuild(true); }));

    // Header
    const head = $('#element-head');
    if (this.element === 'draft') {
      head.innerHTML = `<div><div class="eh-name" style="color:var(--gold)">Draft</div><div class="eh-lvl">${ECON.rollCount} new towers arrive each wave</div></div>
        <button class="btn" id="btn-reroll" data-tip="Replace your draft with new random towers.">Reroll · ${ECON.rerollCost} 📘</button>`;
      $('#btn-reroll').addEventListener('click', () => { if (g.rerollDraft()) this.audio.research(); });
    } else {
      const el = ELEMENTS[this.element];
      const lv = g.research[this.element];
      const cost = g.researchCost(this.element);
      const maxed = lv >= ECON.maxElementLevel;
      head.innerHTML = `<div style="color:${el.css}"><div class="eh-name">${el.glyph} ${el.name}</div>
          <div class="lvl-pips">${Array.from({ length: 15 }, (_, i) => `<i class="${i < lv ? 'on' : ''}"></i>`).join('')}</div></div>
        <button class="btn ${!maxed && g.tomes >= cost ? 'gold' : ''}" id="btn-research" ${maxed || g.tomes < cost ? 'disabled' : ''}
          data-tip="Research ${el.name}: unlocks higher tiers and rarer ${el.name} towers${random ? ' and makes them appear more often in your draft' : ''}.">
          ${maxed ? 'Mastered' : `Research · ${cost} 📘`}</button>`;
      $('#btn-research').addEventListener('click', () => g.doResearch(this.element));
    }

    // Tower list
    const list = $('#tower-list');
    let items;
    if (random) {
      items = this.element === 'draft' ? this.availableTowers() : TOWER_LIST.filter((t) => t.element === this.element && t.tier === 0).map((def) => ({ def, catalog: true }));
    } else items = this.availableTowers();
    let html = '';
    let lastRarity = null;
    for (const { def, count, catalog } of items) {
      if (def.rarity !== lastRarity && this.element !== 'draft') { html += `<div class="group-label" style="color:${RARITIES[def.rarity].css}">${RARITIES[def.rarity].name}</div>`; lastRarity = def.rarity; }
      const locked = !random && g.research[def.element] < def.reqLevel;
      const poor = g.gold < def.totalCost || g.tomes < def.tomeCost || g.food + def.food > g.foodCap;
      const el = ELEMENTS[def.element];
      const r = RARITIES[def.rarity];
      const dps = Math.round(((def.damage[0] + def.damage[1]) / 2) / def.cd);
      html += `<div class="tcard ${locked ? 'locked' : ''} ${poor ? 'poor' : ''} ${catalog ? 'locked' : ''} ${this.placing === def.id ? 'active' : ''} ${this.flash?.id === def.id && performance.now() < this.flash.until ? 'flash' : ''}" data-id="${def.id}" data-tt="tower:${def.id}">
        <div class="ticon" style="border-color:${r.css};color:${el.css}">${towerIcon(def.icon)}<span class="tier">${['I', 'II', 'III', 'IV', 'V', 'VI'][def.tier]}</span></div>
        <div><div class="tname">${esc(def.name)}${revealsInvisible(def) ? '<span class="reveal" data-tip="Reveals invisible creeps">👁</span>' : ''}${count > 1 ? ` <span style="color:var(--gold)">×${count}</span>` : ''}</div>
          <div class="tmeta"><span style="color:${ATTACK_TYPES[def.attack].css}">${ATTACK_TYPES[def.attack].name}</span> · ${dps} dps · ${def.range.toFixed(1)} rng</div></div>
        <div class="tcost">${locked ? `<span class="req">Lv ${def.reqLevel}</span>` : catalog ? '<span class="req">catalog</span>' : `${fmt(def.totalCost)} ◉`}${def.tomeCost ? `<small>${def.tomeCost} 📘</small>` : ''}</div>
      </div>`;
    }
    if (!items.length) html = `<div class="tmeta" style="padding:12px">No towers drafted yet. New towers arrive each wave.</div>`;
    list.innerHTML = html;
    list.querySelectorAll('.tcard').forEach((c) => c.addEventListener('click', () => {
      if (c.classList.contains('locked')) { this.audio.error(); return; }
      this.startPlacing(c.dataset.id);
    }));
  }

  // ---------------------------------------------------------------- pending perks

  // Compact toast listing every tower that still has a perk to choose.
  renderPerkQueue() {
    const g = this.game;
    const box = $('#perk-queue');
    const waiting = [...g.towers.values()].filter((t) => t.perkOffer);
    // Include the offer itself so choosing a perk (same level) refreshes the list.
    const sig = waiting.map((t) => `${t.uid}:${t.perks.length}:${t.perkOffer.join('/')}`).join();
    if (sig === this.sigs.perkQueue) return;
    this.sigs.perkQueue = sig;
    if (!waiting.length) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    box.innerHTML = `<div class="pq-title">✦ Perks to choose <span>${waiting.length}</span></div>
      <div class="pq-list">${waiting.map((t) => `<button class="pq-item" data-uid="${t.uid}" data-tip="Select this tower to pick its perk">
        <span style="color:${ELEMENTS[t.def.element].css}">${towerIcon(t.def.icon)}</span>
        <b style="color:${RARITIES[t.def.rarity].css}">${esc(t.def.name)}</b><small>Level ${t.level}</small></button>`).join('')}</div>`;
    box.querySelectorAll('.pq-item').forEach((b) => b.addEventListener('click', () => {
      const t = g.towers.get(Number(b.dataset.uid));
      if (!t) return;
      this.audio.click();
      this.select({ type: 'tower', uid: t.uid });
      this.world.focus(t.x, t.z + 4);
    }));
  }

  // ---------------------------------------------------------------- boss spoils

  renderSpoils() {
    const g = this.game;
    const box = $('#spoils');
    const offer = g.spoils[0];
    if (!offer) { box.classList.add('hidden'); this.sigs.spoils = null; return; }
    const sig = `${g.spoils.length}|${offer.options.map((o) => o.item?.uid ?? o.type).join()}`;
    if (sig === this.sigs.spoils) return;
    this.sigs.spoils = sig;
    box.classList.remove('hidden');
    const card = (o, i) => {
      if (o.item) {
        const d = ITEMS[o.item.id];
        return `<button class="spoil r-${d.rarity}" data-spoil="${i}">
          <span class="sp-icon">${d.icon}</span><span class="sp-tag" style="color:${RARITIES[d.rarity].css}">${RARITIES[d.rarity].name} ${d.kind === 'oil' ? 'oil' : 'item'}</span>
          <b class="r-${d.rarity}">${esc(d.name)}</b><ul>${describeItem(d).map((l) => `<li>${esc(l)}</li>`).join('')}</ul></button>`;
      }
      const sp = SPOILS[o.type];
      return `<button class="spoil" data-spoil="${i}"><span class="sp-icon">${sp.icon}</span><span class="sp-tag">Reward</span>
        <b>${sp.name}</b><ul><li>${esc(sp.desc(o.value))}</li></ul></button>`;
    };
    box.innerHTML = `<div class="sp-head"><span class="sp-title">${offer.challenge ? '✪ Challenge Spoils' : '☠ Boss Spoils'}</span>
        <span class="sp-sub">Wave ${offer.level} · choose one reward</span>
        ${g.spoils.length > 1 ? `<span class="sp-count">${g.spoils.length} waiting</span>` : ''}</div>
      <div class="sp-list">${offer.options.map(card).join('')}</div>`;
    box.querySelectorAll('[data-spoil]').forEach((b) => b.addEventListener('click', () => g.chooseSpoil(Number(b.dataset.spoil))));
  }

  // ---------------------------------------------------------------- invisible-enemy guide

  // Waves (active or the next two) carrying the Invisible trait.
  invisibleThreat() {
    const g = this.game;
    const waves = g.activeWaves.map((w) => w.def).concat(g.wavePreview(2)).filter((w) => w.level <= g.finalWave);
    return waves.find((w) => w.specials.includes('invisible')) || null;
  }

  renderAlert() {
    const g = this.game;
    const box = $('#alert');
    const threat = this.invisibleThreat();
    const unseen = g.creeps.filter((c) => c.alive && c.invisible && !c.revealed).length;
    const covered = g.hasRevealer();
    const show = threat && (!covered || unseen > 0) && this.alertDismissed !== threat.level;
    if (!show) { box.classList.add('hidden'); this.sigs.alert = null; return; }
    const active = g.activeWaves.some((w) => w.def === threat);
    const sig = [threat.level, covered, unseen, active, Math.floor(g.gold / 10), JSON.stringify(g.research), g.towerStash.join()].join('|');
    if (sig === this.sigs.alert && !box.classList.contains('hidden')) return;
    this.sigs.alert = sig;
    box.classList.remove('hidden');
    box.classList.toggle('ok', covered);
    box.classList.toggle('urgent', !covered && active);
    const title = covered
      ? `${unseen} invisible creep${unseen === 1 ? '' : 's'} slipping past unseen`
      : active ? `Wave ${threat.level} is invisible — your towers cannot see it!` : `Invisible creeps on wave ${threat.level}`;
    const sub = covered
      ? 'Place another revealing tower so its detection radius covers more of the path.'
      : 'Towers can only attack invisible creeps inside a revealing tower\'s detection radius. Build one beside the path:';
    const options = REVEAL_FAMILIES.map((fid) => TOWERS[FAMILIES[fid].tiers[0]]);
    box.innerHTML = `<div class="al-head"><span class="al-eye">👁</span><div><div class="al-title">${title}</div><div class="al-sub">${sub}</div></div>
      <button class="al-close" data-tip="Dismiss for this wave">✕</button></div>
      <div class="al-towers">${options.map((d) => {
        const el = ELEMENTS[d.element];
        const locked = g.cfg.mode === 'random' ? !g.towerStash.some((id) => TOWERS[id].family === d.family) : g.research[d.element] < d.reqLevel;
        const reveal = d.abilities.find((a) => a.type === 'reveal');
        const note = g.cfg.mode === 'random' ? (locked ? 'not in draft' : 'in your draft') : locked ? `needs ${el.name} Lv ${d.reqLevel}` : `${d.totalCost} gold`;
        return `<button class="al-tower ${locked ? 'locked' : ''}" data-fam="${d.family}" data-tt="tower:${d.id}">
          <span style="color:${el.css}">${towerIcon(d.icon)}</span><span><b>${esc(d.name)}</b><small>${RARITIES[d.rarity].name} ${el.name} · sees ${reveal.radius.toFixed(1)} · ${note}</small></span></button>`;
      }).join('')}</div>`;
    box.querySelector('.al-close').addEventListener('click', () => { this.alertDismissed = threat.level; box.classList.add('hidden'); });
    box.querySelectorAll('.al-tower').forEach((b) => b.addEventListener('click', () => this.guideToFamily(b.dataset.fam)));
  }

  // Jump the build panel to a family and start placing it when possible.
  guideToFamily(fid) {
    const g = this.game;
    const f = FAMILIES[fid];
    if (g.cfg.mode === 'random') {
      const id = g.towerStash.find((x) => TOWERS[x].family === fid);
      this.element = 'draft';
      this.renderBuild(true);
      if (id) { this.startPlacing(id); this.flashCard(id); }
      else this.toast(`${TOWERS[f.tiers[0]].name} is not in your draft — reroll or research ${ELEMENTS[f.element].name}`, 'warn');
      return;
    }
    this.element = f.element;
    this.renderBuild(true);
    // Highest unlocked tier the player can afford, else tier 1.
    const unlocked = f.tiers.map((id) => TOWERS[id]).filter((d) => g.research[d.element] >= d.reqLevel);
    if (!unlocked.length) {
      const d = TOWERS[f.tiers[0]];
      this.toast(`Research ${ELEMENTS[f.element].name} to level ${d.reqLevel} to unlock ${d.name}`, 'warn');
      this.flashCard(d.id);
      return;
    }
    const pick = [...unlocked].reverse().find((d) => g.gold >= d.totalCost && g.tomes >= d.tomeCost) || unlocked[0];
    this.startPlacing(pick.id);
    this.flashCard(pick.id);
    this.hint('Place the revealing tower where its <b>blue detection ring</b> covers the path · <b>Right click</b> to cancel');
  }

  flashCard(id) {
    this.flash = { id, until: performance.now() + 3000 };
    this.renderBuild(true);
    document.querySelector(`.tcard[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  startPlacing(id) {
    if (this.placing === id) { this.stopPlacing(); return; }
    this.placing = id;
    this.select(null);
    this.world.setGhost(TOWERS[id]);
    this.audio.click();
    this.hint('<b>Left click</b> to build · <b>Shift</b> to keep placing · <b>Right click</b> / <b>Esc</b> to cancel');
    this.sigs.build = null;
  }

  stopPlacing() {
    this.placing = null;
    this.world.setGhost(null);
    this.hint('');
    this.sigs.build = null;
  }

  // ---------------------------------------------------------------- waves

  renderWaves(force) {
    const g = this.game;
    const active = g.activeWaves.map((w) => w.def);
    const upcoming = g.wavePreview(3).filter((w) => w.level <= g.finalWave);
    const sig = [...active, ...upcoming].map((w) => w.level).join(',') + '|' + g.activeWaves.map((w) => w.alive).join(',');
    if (!force && sig === this.sigs.waves) return;
    this.sigs.waves = sig;
    const card = (w, isActive, alive) => {
      const armor = ARMOR_TYPES[w.armor];
      const weak = strongVs(w.armor);
      const counts = {};
      for (const s of w.list) counts[s] = (counts[s] || 0) + 1;
      const comp = Object.entries(counts).map(([s, n]) => `${n} ${SIZE_ICON[s]}`).join(' + ');
      const size = w.challenge ? 'challenge' : w.size;
      return `<div class="wave-card ${isActive ? 'active' : ''} ${w.challenge ? 'challenge' : ''}" data-tt="wave:${w.level}">
        <div class="wc-top"><span class="wc-lvl">${w.level}</span><span class="wc-size" style="color:${size === 'boss' ? '#ff7a5a' : size === 'air' ? '#7fb8ff' : size === 'challenge' ? '#ffd34a' : '#ddd'}">${SIZE_LABEL[size]}</span>
          <span class="wc-hp">${isActive ? `${alive} left` : `${fmt(w.hp * SIZES[w.list[0]].hp)} hp`}</span></div>
        <div class="wc-row"><span class="chip" style="color:${RACES[w.race].css}">${RACES[w.race].name}</span>
          <span class="chip" style="color:${armor.css}" data-tt="armor:${w.armor}">${armor.name}</span><span class="weak">${comp}</span></div>
        ${w.specials.length ? `<div class="wc-row">${w.specials.map((s) => `<span class="chip" style="color:${SPECIALS[s].css}" data-tt="special:${s}">${SPECIALS[s].name}</span>`).join('')}</div>` : ''}
        <div class="wc-row weak">Weak to: ${weak.map((a) => `<b style="color:${ATTACK_TYPES[a].css}">${ATTACK_TYPES[a].name}</b>`).join(', ')}</div>
      </div>`;
    };
    $('#wave-list').innerHTML = g.activeWaves.map((w) => card(w.def, true, w.alive)).join('') + upcoming.map((w) => card(w, false)).join('');
  }

  // ---------------------------------------------------------------- items

  renderStash(force) {
    const g = this.game;
    const sig = g.stash.map((i) => i.uid).join(',') + '|' + this.selectedItem + '|' + [...this.transmuteSel].join(',');
    if (!force && sig === this.sigs.stash) return;
    this.sigs.stash = sig;
    $('#stash-count').textContent = `${g.stash.length}/${ECON.stashSize}`;
    const slots = [];
    for (let i = 0; i < Math.max(18, Math.min(ECON.stashSize, Math.ceil((g.stash.length + 1) / 6) * 6)); i++) {
      const it = g.stash[i];
      if (!it) { slots.push('<div class="slot empty"></div>'); continue; }
      const d = ITEMS[it.id];
      slots.push(`<div class="slot r-${d.rarity} ${this.selectedItem === it.uid ? 'sel' : ''} ${this.transmuteSel.has(it.uid) ? 'tsel' : ''}" draggable="true" data-uid="${it.uid}" data-tt="item:${it.id}:${it.uid}">${d.icon}${d.kind !== 'equip' ? `<span class="kind">${d.kind === 'oil' ? 'OIL' : 'USE'}</span>` : ''}</div>`);
    }
    const box = $('#stash');
    box.innerHTML = slots.join('');
    box.querySelectorAll('.slot[data-uid]').forEach((el) => {
      const uid = Number(el.dataset.uid);
      el.addEventListener('click', (e) => {
        this.audio.click();
        if (e.shiftKey) {
          if (this.transmuteSel.has(uid)) this.transmuteSel.delete(uid); else if (this.transmuteSel.size < 3) this.transmuteSel.add(uid);
          this.renderStash(true);
          return;
        }
        const d = ITEMS[g.stash.find((i) => i.uid === uid).id];
        if (d.kind === 'consumable') { g.useItem(uid); return; }
        if (this.selection?.type === 'tower') {
          const t = g.towers.get(this.selection.uid);
          if (t && g.equip(uid, t)) { this.audio.upgrade(); this.selectedItem = null; return; }
        }
        this.selectedItem = this.selectedItem === uid ? null : uid;
        this.hint(this.selectedItem ? 'Click a tower to give it this item · <b>Right click</b> to cancel' : '');
        this.renderStash(true);
      });
      el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/item', String(uid)); this.dragItem = uid; });
      el.addEventListener('dragend', () => { this.dragItem = null; });
    });
  }

  // ---------------------------------------------------------------- selection

  select(sel) {
    this.selection = sel;
    this.sigs.sel = null;
    this.renderSelection(true);
  }

  renderSelection(force) {
    const g = this.game;
    const box = $('#selection');
    const sel = this.selection;
    if (!sel) { box.classList.add('hidden'); this.sigs.sel = null; return; }
    if (sel.type === 'tower') {
      const t = g.towers.get(sel.uid);
      if (!t) { this.select(null); return; }
      const sig = [t.def.id, t.level, Math.floor(t.xp), t.kills, Math.floor(t.damageDealt / 100), t.items.map((i) => i?.uid).join(), t.priority, Math.floor(g.gold / 10), g.tomes, JSON.stringify(t.oil),
        Math.floor(t.mana || 0), t.actives.map((a) => `${Math.ceil(a.cd * 4)}${a.auto}`).join(),
        g.itemActives(t).map((a) => `${Math.ceil(a.cd * 4)}${a.auto}${a.item.state?.charges ?? ''}`).join(), t.buffs.map((b) => b.key).join(),
        t.perks.join(), (t.perkOffer || []).join(), g.itemSlots()].join('|');
      if (!force && sig === this.sigs.sel) return;
      this.sigs.sel = sig;
      box.classList.remove('hidden');
      this._renderTower(box, t);
    } else {
      const c = g.creeps.find((x) => x.uid === sel.uid);
      if (!c) { this.select(null); return; }
      box.classList.remove('hidden');
      this._renderCreep(box, c);
    }
  }

  _renderTower(box, t) {
    const g = this.game;
    const d = t.def, s = t.stats, el = ELEMENTS[d.element], r = RARITIES[d.rarity];
    const next = nextTier(d.id);
    const itemActs = g.itemActives(t);
    const upErr = next ? g.upgradeCheck(t) : 'Max tier';
    const need = t.level < TOWER_MAX_LEVEL ? xpForLevel(t.level) : 1;
    const xpPct = t.level >= TOWER_MAX_LEVEL ? 100 : (t.xp / need) * 100;
    const prios = [['first', 'First'], ['last', 'Last'], ['strong', 'Strong'], ['weak', 'Weak']];
    const oil = Object.keys(t.oil).length ? `<div class="abil" style="color:#ffcf8a">${describeMods(t.oil).map((x) => `<div>Oil: ${x}</div>`).join('')}</div>` : '';
    box.innerHTML = `
      <div class="sel-portrait" style="border-color:${r.css};color:${el.css}">${towerIcon(d.icon, 'big')}</div>
      <div>
        <div class="sel-title"><h2 style="color:${r.css}">${esc(d.name)}</h2>
          <span class="sub">${r.name} ${el.name} · Tier ${d.tier + 1}/${d.tierCount} · Level ${t.level}${t.level >= TOWER_MAX_LEVEL ? ' (max)' : ''}</span></div>
        <div class="xpbar" data-tip="Experience ${Math.floor(t.xp)} / ${need}"><div style="width:${xpPct}%"></div></div>
        ${t.maxMana ? `<div class="manabar" data-tip="Mana ${Math.floor(t.mana)} / ${Math.round(t.maxMana)} (+${(t.manaRegen * (1 + (s.manaRegen || 0))).toFixed(1)}/s)"><div style="width:${(t.mana / t.maxMana) * 100}%"></div></div>` : ''}
        <div class="stats">
          <div><span>Damage</span><b>${fmt(s.dmgMin)}–${fmt(s.dmgMax)}</b></div>
          <div><span>DPS</span><b>${fmt(s.dps)}</b></div>
          <div><span>Cooldown</span><b>${s.cd.toFixed(2)}s</b></div>
          <div><span>Range</span><b>${s.range.toFixed(1)}</b></div>
          <div><span>Attack</span><b style="color:${ATTACK_TYPES[d.attack].css}">${ATTACK_TYPES[d.attack].name}</b></div>
          <div><span>Crit</span><b>${Math.round(s.crit * 100)}% ×${s.critMult.toFixed(1)}</b></div>
          <div><span>Kills</span><b>${t.kills}</b></div>
          <div><span>Dealt</span><b>${fmt(t.damageDealt)}</b></div>
        </div>
        <div class="abil">${[...describeTowerMods(d), ...d.abilities.map(describeAbility)].map((l) => `<div>${esc(l)}</div>`).join('')}
          ${d.pending.length ? `<div class="pending" data-tip="This ability exists in the original YouTD and will be ported in a later batch.">Not yet ported: ${esc(d.pending.join(', '))}</div>` : ''}</div>${oil}
        ${t.perkOffer ? `<div class="perk-offer"><div class="po-title">Level ${PERK_LEVELS[t.perks.length]} perk: choose one</div>
          <div class="po-list">${t.perkOffer.map((id) => `<button class="perk" data-perk="${id}"><span>${PERKS[id].icon}</span><b>${PERKS[id].name}</b><small>${PERKS[id].desc}</small></button>`).join('')}</div></div>` : ''}
        ${t.perks.length ? `<div class="perks">${t.perks.map((id) => `<span data-tip="${esc(PERKS[id].desc)}">${PERKS[id].icon} ${PERKS[id].name}</span>`).join('')}
          ${PERK_LEVELS.filter((l) => l > t.level).slice(0, 1).map((l) => `<em>next perk at level ${l}</em>`).join('')}</div>` : t.perkOffer ? '' : `<div class="perks"><em>First perk at level ${PERK_LEVELS[0]}</em></div>`}
        ${t.buffs.length ? `<div class="buffs">${t.buffs.map((b) => `<span data-tip="${esc(describeMods(b.mods).join(', '))}">${esc(b.label || b.key)} ${Math.ceil(b.t)}s</span>`).join('')}</div>` : ''}
        <div class="sel-bottom">
          <div class="islots">${t.items.map((it, i) => i >= g.itemSlots() && !it
            ? `<div class="slot empty locked" data-tip="Unlocks at wave ${g.slotUnlockWave(i)} for every tower.">🔒</div>`
            : it
            ? `<div class="slot r-${ITEMS[it.id].rarity}" data-slot="${i}" data-tt="item:${it.id}:${it.uid}">${ITEMS[it.id].icon}</div>`
            : `<div class="slot empty" data-slot="${i}" data-tip="Empty item slot. Click an item in your stash, or drag one here."></div>`).join('')}</div>
          ${t.actives.length || itemActs.length ? `<div class="actives">${t.actives.map((a, i) => `<button class="act ${a.auto ? 'auto' : ''} ${t.mana < a.def.mana ? 'nomana' : ''}" data-act="${i}"
              data-tip="${esc(`${a.def.name} — ${a.def.desc} (${a.def.mana} mana, ${a.def.cd}s cooldown). Click to cast [${'FG'[i]}], right-click to toggle autocast.`)}">
              ${a.def.icon}<span class="key">${'FG'[i]}</span><span class="mana">${a.def.mana}</span>
              <span class="cdsweep" style="--cd:${a.cd > 0 ? (a.cd / a.def.cd) * 360 : 0}deg"></span></button>`).join('')}${itemActs.map((a, i) => `<button class="act item-act r-${ITEMS[a.item.id].rarity} ${a.auto ? 'auto' : ''}" data-iact="${i}"
              data-tip="${esc(`${ITEMS[a.item.id].name}: ${describeSkill(a.proc)}`)}">
              ${a.proc.icon || ITEMS[a.item.id].icon}${a.item.state?.charges != null ? `<span class="mana">${a.item.state.charges}</span>` : ''}
              <span class="cdsweep" style="--cd:${a.cd > 0 && a.proc.icd > 1 ? (a.cd / a.proc.icd) * 360 : 0}deg"></span></button>`).join('')}</div>` : ''}
          <div class="prio">${prios.map(([k, n]) => `<button data-prio="${k}" class="${t.priority === k ? 'on' : ''}" data-tip="Target the ${n.toLowerCase()} creep in range">${n}</button>`).join('')}</div>
          <div class="sel-actions">
            ${next ? `<button class="btn ${upErr ? '' : 'gold'}" id="btn-upgrade" ${upErr ? 'disabled' : ''} data-tt="tower:${next.id}">Upgrade [U] · ${fmt(next.cost)} ◉${next.tomeCost ? ` ${next.tomeCost} 📘` : ''}</button>` : ''}
            ${t.level < TOWER_MAX_LEVEL ? `<button class="btn" id="btn-train" ${g.gold < g.trainCost(t) ? 'disabled' : ''} data-tip="Spend gold to train this tower: +${Math.round(ECON.trainXpPct * 100)}% of a level's experience. The cost rises with level. [T]">Train · ${fmt(g.trainCost(t))}</button>` : ''}
            <button class="btn danger" id="btn-sell" data-tip="Sell for ${Math.floor(t.invested * ECON.sellRefund)} gold. Items return to your stash. [X]">Sell · ${fmt(Math.floor(t.invested * ECON.sellRefund))}</button>
          </div>
        </div>
      </div>`;
    box.querySelectorAll('[data-act]').forEach((b) => {
      const i = Number(b.dataset.act);
      b.addEventListener('click', () => { if (g.castActive(t, i)) this.sigs.sel = null; });
      b.addEventListener('contextmenu', (e) => { e.preventDefault(); const on = g.toggleAutocast(t, i); this.toast(`Autocast ${on ? 'on' : 'off'}: ${t.actives[i].def.name}`); this.audio.click(); this.renderSelection(true); });
    });
    box.querySelectorAll('[data-iact]').forEach((b) => {
      const i = Number(b.dataset.iact);
      b.addEventListener('click', () => { if (g.castItem(t, i)) this.audio.click(); this.renderSelection(true); });
      b.addEventListener('contextmenu', (e) => { e.preventDefault(); const on = g.toggleItemAuto(t, i); this.toast(`Autocast ${on ? 'on' : 'off'}: ${itemActs[i].proc.name}`); this.audio.click(); this.renderSelection(true); });
    });
    box.querySelectorAll('[data-prio]').forEach((b) => b.addEventListener('click', () => { g.setPriority(t, b.dataset.prio); this.audio.click(); this.renderSelection(true); }));
    box.querySelectorAll('.islots .slot').forEach((sl) => {
      const i = Number(sl.dataset.slot);
      sl.addEventListener('click', () => {
        if (this.selectedItem) { if (g.equip(this.selectedItem, t, i)) { this.audio.upgrade(); this.selectedItem = null; this.hint(''); } }
        else if (t.items[i]) { g.unequip(t, i); this.audio.click(); }
      });
      sl.addEventListener('dragover', (e) => e.preventDefault());
      sl.addEventListener('drop', (e) => {
        e.preventDefault();
        const uid = Number(e.dataTransfer.getData('text/item'));
        if (uid && g.equip(uid, t, i)) this.audio.upgrade();
      });
    });
    $('#btn-upgrade')?.addEventListener('click', () => this.upgradeSelected());
    $('#btn-sell').addEventListener('click', () => this.sellSelected());
    $('#btn-train')?.addEventListener('click', () => this.trainSelected());
    box.querySelectorAll('[data-perk]').forEach((b) => b.addEventListener('click', () => { g.choosePerk(t, b.dataset.perk); this.audio.upgrade(); }));
  }

  _renderCreep(box, c) {
    const armor = ARMOR_TYPES[c.armorType];
    const eff = this.game.effectiveArmor(c);
    const k = Math.max(0, c.hp / c.maxHp);
    box.innerHTML = `
      <div class="sel-portrait" style="border-color:${RACES[c.race].css};color:${RACES[c.race].css}">${SIZE_ICON[c.size]}</div>
      <div>
        <div class="sel-title"><h2>${RACES[c.race].name} ${SIZE_LABEL[c.size]}</h2><span class="sub">Wave ${c.level}</span></div>
        <div class="hpbar"><div style="width:${k * 100}%;background:hsl(${k * 120},80%,45%)"></div><span>${fmt(c.hp)} / ${fmt(c.maxHp)}${c.shield > 0 ? ` (+${fmt(c.shield)} shield)` : ''}</span></div>
        <div class="stats">
          <div><span>Armor</span><b style="color:${armor.css}">${armor.name} ${Math.round(eff)}</b></div>
          <div><span>Speed</span><b>${(c.speed * (1 - Math.max(c.slow, c.auraSlow))).toFixed(1)}</b></div>
          <div><span>Slowed</span><b>${Math.round(Math.max(c.slow, c.auraSlow) * 100)}%</b></div>
          <div><span>Cursed</span><b>${Math.round(c.curse * 100)}%</b></div>
        </div>
        <div class="abil">${c.specials.map((s) => `<div style="color:${SPECIALS[s].css}">${SPECIALS[s].name}: ${SPECIALS[s].desc}</div>`).join('') || '<div>No special traits.</div>'}
          <div>Weak to ${strongVs(c.armorType).map((a) => ATTACK_TYPES[a].name).join(', ')}.</div></div>
      </div>`;
  }

  castSelected(i) {
    const t = this.selection?.type === 'tower' && this.game.towers.get(this.selection.uid);
    if (t && t.actives[i]) this.game.castActive(t, i);
  }

  trainSelected() {
    const t = this.selection?.type === 'tower' && this.game.towers.get(this.selection.uid);
    if (t && this.game.train(t)) this.audio.levelUp();
  }

  upgradeSelected() {
    const t = this.selection?.type === 'tower' && this.game.towers.get(this.selection.uid);
    if (t && this.game.upgrade(t)) this.sigs.sel = null;
  }

  sellSelected() {
    const t = this.selection?.type === 'tower' && this.game.towers.get(this.selection.uid);
    if (t) { this.game.sell(t); this.select(null); }
  }

  // ---------------------------------------------------------------- tooltips

  richTip(key) {
    const [kind, id] = key.split(':');
    const g = this.game;
    if (kind === 'tower') {
      const d = TOWERS[id];
      const el = ELEMENTS[d.element], r = RARITIES[d.rarity], at = ATTACK_TYPES[d.attack];
      const good = Object.entries(DAMAGE_MATRIX[d.attack]).filter(([, v]) => v >= 1.5).map(([a]) => ARMOR_TYPES[a].name);
      const bad = Object.entries(DAMAGE_MATRIX[d.attack]).filter(([, v]) => v <= 0.6).map(([a]) => ARMOR_TYPES[a].name);
      const dps = ((d.damage[0] + d.damage[1]) / 2) / d.cd;
      const req = g && g.research[d.element] < d.reqLevel ? `<div class="bad">Requires ${el.name} research level ${d.reqLevel}</div>` : '';
      return `<h4 style="color:${r.css};display:flex;align-items:center;gap:6px"><span style="color:${el.css}">${towerIcon(d.icon)}</span>${esc(d.name)}</h4>
        <div class="tt-sub"><span style="color:${el.css}">${el.glyph} ${el.name}</span> · ${r.name} · Tier ${d.tier + 1} of ${d.tierCount} · ${d.slots} item slots</div>
        <div class="tt-grid">
          <span>Attack</span><b style="color:${at.css}">${at.name}</b>
          <span>Damage</span><b>${d.damage[0]}–${d.damage[1]} every ${d.cd}s (${Math.round(dps)} dps)</b>
          <span>Range</span><b>${d.range.toFixed(1)}</b>
          <span>Cost</span><b>${d.totalCost} gold total${d.tier ? ` (${d.cost} to upgrade)` : ''}${d.tomeCost ? `, ${d.tomeCost} tomes` : ''}</b>
          ${good.length ? `<span>Strong vs</span><b class="good">${good.join(', ')}</b>` : ''}
          ${bad.length ? `<span>Weak vs</span><b class="bad">${bad.join(', ')}</b>` : ''}
        </div>
        ${d.abilities.length || d.levelMods.length ? `<div style="margin-top:6px">${[...describeTowerMods(d), ...d.abilities.map(describeAbility)].map((l) => `<div>◆ ${esc(l)}</div>`).join('')}</div>` : ''}
        ${d.pending.length ? `<div class="bad" style="margin-top:4px">Not yet ported: ${esc(d.pending.join(', '))}</div>` : ''}
        ${(d.actives || []).map((a) => `<div style="margin-top:4px;color:#9fd0ff">${a.icon} <b>${esc(a.name)}</b> (active, ${a.mana} mana, ${a.cd}s): ${esc(a.desc)}</div>`).join('')}
        ${req}<div class="tt-lore">Original YouTD tower by ${esc(d.author)}.</div>`;
    }
    if (kind === 'item') {
      const d = ITEMS[id];
      const uid = Number(key.split(':')[2]);
      const inst = uid && (g.stash.find((i) => i.uid === uid) || [...g.towers.values()].flatMap((t) => t.items).find((i) => i?.uid === uid));
      const grown = inst?.bound ? `<div class="good" style="margin-top:4px">Grown so far: ${describeMods(inst.bound).join(', ')}</div>` : '';
      const r = RARITIES[d.rarity];
      return `<h4 style="color:${r.css}">${d.icon} ${esc(d.name)}</h4><div class="tt-sub">${r.name} ${d.kind === 'equip' ? 'equipment' : d.kind}</div>
        ${describeItem(d).map((l) => `<div>${esc(l)}</div>`).join('')}
        ${grown}${d.kind === 'equip' ? '<div class="tt-sub" style="margin-top:6px">Shift-click to select for Transmute.</div>' : ''}
        ${d.author ? `<div class="tt-lore">Original YouTD item by ${esc(d.author)}.</div>` : ''}`;
    }
    if (kind === 'special') {
      const s = SPECIALS[id];
      return `<h4 style="color:${s.css}">${s.name}</h4><div>${esc(s.desc)}</div>`;
    }
    if (kind === 'armor') {
      const a = ARMOR_TYPES[id];
      const rows = Object.keys(ATTACK_TYPES).map((at) => {
        const v = DAMAGE_MATRIX[at][id];
        return `<span style="color:${ATTACK_TYPES[at].css}">${ATTACK_TYPES[at].name}</span><b class="${v >= 1.5 ? 'good' : v <= 0.6 ? 'bad' : ''}">${Math.round(v * 100)}%</b>`;
      }).join('');
      return `<h4 style="color:${a.css}">${a.name} armor</h4><div class="tt-sub">Damage taken from each attack type</div><div class="tt-grid">${rows}</div>`;
    }
    if (kind === 'wave') {
      const lvl = Number(id);
      const w = g.activeWaves.map((x) => x.def).concat(g.wavePreview(6)).find((x) => x.level === lvl);
      if (!w) return '';
      return `<h4>Wave ${w.level}${w.challenge ? ' · Challenge' : ''}</h4>
        <div class="tt-sub">${RACES[w.race].name} · ${ARMOR_TYPES[w.armor].name} armor (${w.armorValue}) · ${w.list.length} creeps</div>
        <div class="tt-grid"><span>Base health</span><b>${fmt(w.hp)}</b>
        ${Object.entries(w.list.reduce((m, s) => ((m[s] = (m[s] || 0) + 1), m), {})).map(([s, n]) => `<span>${n}× ${SIZES[s].name}</span><b>${fmt(w.hp * SIZES[s].hp)} hp · ${SIZES[s].leak}% leak</b>`).join('')}
        </div>${w.challenge ? '<div class="tt-lore">Challenge creeps never damage the portal. Deal as much damage as you can for gold, items and score.</div>' : ''}`;
    }
    return '';
  }

  // ---------------------------------------------------------------- end screens

  showEnd(won, sum, canContinue) {
    const box = $('#endscreen');
    box.classList.remove('hidden');
    box.querySelector('.end').classList.toggle('lost', !won);
    $('#end-title').textContent = won ? 'Victory' : 'The Portal Has Fallen';
    $('#end-sub').textContent = won ? `You held the line through all ${sum.level} waves.` : `Your defense broke on wave ${sum.level}.`;
    const mins = Math.floor(sum.time / 60);
    $('#end-stats').innerHTML = [
      ['Score', fmt(sum.score)], ['Wave', sum.level], ['Kills', fmt(sum.kills)],
      ['Damage', fmt(sum.damage)], ['Gold earned', fmt(sum.gold)], ['Items found', sum.items],
      ['Towers', sum.towers], ['Leaks', sum.leaks], ['Time', `${mins}m`],
    ].map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join('');
    $('#btn-continue').classList.toggle('hidden', !canContinue);
  }
}
