// End-of-run summary: four tabs built from Game.summary() and the profile result.
// Every name shown comes from a catalog looked up by id; free text goes through esc.

import { ELEMENTS, RARITIES, ATTACK_TYPES, RACES, SIZES, DIFFICULTIES, MODES, LENGTHS, MODIFIERS } from '../data/constants.js';
import { TOWERS } from '../data/towers.js';
import { ITEMS } from '../data/items.js';
import { PERKS } from '../data/tower-perks.js';
import { ACHIEVEMENTS, ACHIEVEMENT_BY_ID, UNLOCKS } from '../data/achievements.js';
import { progressOf, rewardsOf } from '../meta/achievements.js';
import { fmt } from '../world/world.js';
import { esc, towerIcon } from './util.js';

const $ = (s) => document.querySelector(s);
const pct = (part, whole) => (whole > 0 ? (part / whole) * 100 : 0);
const SPELL_CSS = '#9fd0ff';
const COLUMNS = [
  ['name', 'Tower'], ['level', 'Level'], ['kills', 'Kills'], ['damage', 'Damage'], ['share', 'Share'],
  ['items', 'Items'], ['perks', 'Perks'], ['invested', 'Gold'],
];

const unlockName = (r) => {
  if (r.kind === 'titles') return `Title "${UNLOCKS.titles[r.id].name}"`;
  if (r.kind === 'modifiers') return `Modifier "${MODIFIERS[r.id].name}"`;
  return `Crest "${UNLOCKS.crests[r.id].name}"`;
};

export class EndScreen {
  constructor() {
    this.tab = 'overview';
    this.sort = { key: 'damage', dir: -1 };
    $('#end-tabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-tab]');
      if (b) { this.tab = b.dataset.tab; this.render(); }
    });
    $('#end-body').addEventListener('click', (e) => {
      const th = e.target.closest('[data-sort]');
      if (!th) return;
      const key = th.dataset.sort;
      this.sort = { key, dir: this.sort.key === key ? -this.sort.dir : key === 'name' ? 1 : -1 };
      this.render();
    });
  }

  // result is recordRun's return value, or null for God mode runs.
  show(sum, result, profile) {
    this.sum = sum; this.result = result; this.profile = profile;
    this.tab = result?.earned.length ? 'achievements' : 'overview';
    const box = $('#endscreen');
    box.classList.remove('hidden');
    const lost = sum.outcome !== 'won';
    box.querySelector('.end').classList.toggle('lost', lost);
    $('#end-title').textContent = sum.outcome === 'won' ? 'Victory' : sum.outcome === 'abandoned' ? 'Run Abandoned' : 'The Portal Has Fallen';
    $('#end-sub').textContent = sum.outcome === 'won' ? `You held the line through all ${sum.level} waves.`
      : sum.continued ? `You won, then held out until wave ${sum.level}.`
      : sum.outcome === 'abandoned' ? `You left the field after clearing ${sum.wavesCleared} waves.`
      : `Your defense broke on wave ${sum.level}.`;
    $('#btn-endless').classList.toggle('hidden', !(sum.outcome === 'won' && sum.cfg.length !== 'endless' && !sum.continued));
    this.render();
  }

  render() {
    const { sum, result } = this;
    const cfg = sum.cfg;
    const title = this.profile?.title && UNLOCKS.titles[this.profile.title];
    const tags = [
      `${DIFFICULTIES[cfg.difficulty].name} · ${MODES[cfg.mode].name} · ${LENGTHS[cfg.length].name}`,
      ...cfg.modifiers.map((m) => `<span class="end-mod">${esc(MODIFIERS[m].name)}</span>`),
      cfg.god ? '<span class="end-god">God mode · not recorded</span>' : '',
      result?.newRecord ? '<span class="end-record">New record</span>' : '',
      result && !result.saved ? '<span class="end-god">Progress could not be saved</span>' : '',
      title ? `<span class="end-title">${esc(title.name)}</span>` : '',
    ].filter(Boolean);
    $('#end-meta').innerHTML = tags.join('');
    const earned = result?.earned.length || 0;
    $('#end-tabs').innerHTML = [['overview', 'Overview'], ['towers', 'Towers'], ['analysis', 'Analysis'], ['achievements', earned ? `Achievements <b>${earned} new</b>` : 'Achievements']]
      .map(([id, label]) => `<button class="end-tab ${this.tab === id ? 'on' : ''}" data-tab="${id}">${label}</button>`).join('');
    $('#end-body').innerHTML = this[this.tab]();
  }

  // ---------------------------------------------------------------- tabs

  overview() {
    const s = this.sum;
    const m = s.towerLedger.find((t) => t.uid === s.mvp);
    const tiles = [
      ['Score', fmt(s.score)], ['Waves cleared', s.wavesCleared], ['Kills', fmt(s.kills)],
      ['Damage', fmt(s.damage)], ['Gold earned', fmt(s.gold)], ['Items found', s.items],
      ['Towers built', s.towerLedger.length], ['Portal', `${Math.round(pct(s.lives, s.maxLives))}%`], ['Time', `${Math.floor(s.time / 60)}m`],
    ];
    return `${m ? this.mvpCard(m) : ''}
      <div class="end-tiles">${tiles.map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join('')}</div>
      ${this.goals(1)}`;
  }

  mvpCard(t) {
    const d = TOWERS[t.id];
    return `<div class="end-mvp" data-tt="tower:${t.id}">
      <div class="end-mvp-badge">MVP</div>
      <div class="ticon" style="border-color:${RARITIES[t.rarity].css};color:${ELEMENTS[t.element].css}">${towerIcon(d.icon)}</div>
      <div class="end-mvp-main">
        <div class="end-mvp-name" style="color:${RARITIES[t.rarity].css}">${esc(d.name)}${t.sold ? ' <small>(sold)</small>' : ''}</div>
        <div class="end-mvp-stats">Level ${t.level} · ${fmt(t.kills)} kills · ${fmt(t.damage)} damage · ${pct(t.damage, this.sum.damage).toFixed(1)}% of all damage</div>
        <div class="end-mvp-gear">${this.itemIcons(t)}${this.perkIcons(t)}</div>
      </div></div>`;
  }

  itemIcons(t) {
    return t.items.filter((id) => ITEMS[id]).map((id) => `<span class="end-chip" data-tt="item:${id}" style="color:${RARITIES[ITEMS[id].rarity].css}">${ITEMS[id].icon}</span>`).join('');
  }

  perkIcons(t) {
    return t.perks.filter((id) => PERKS[id]).map((id) => `<span class="end-chip" data-tip="${esc(`${PERKS[id].name}: ${PERKS[id].desc}`)}">${PERKS[id].icon}</span>`).join('');
  }

  towers() {
    const s = this.sum;
    const val = (t, k) => (k === 'name' ? TOWERS[t.id].name : k === 'share' ? t.damage : k === 'items' ? t.items.length : k === 'perks' ? t.perks.length : t[k]);
    const { key, dir } = this.sort;
    const rows = [...s.towerLedger].sort((a, b) => {
      const x = val(a, key), y = val(b, key);
      return (typeof x === 'string' ? x.localeCompare(y) : x - y) * dir;
    });
    const head = COLUMNS.map(([k, label]) => `<th data-sort="${k}" class="${key === k ? (dir > 0 ? 'asc' : 'desc') : ''}">${label}</th>`).join('');
    const body = rows.map((t) => {
      const d = TOWERS[t.id], share = pct(t.damage, s.damage);
      return `<tr class="${t.sold ? 'sold' : ''}" data-tt="tower:${t.id}">
        <td class="end-tname"><span style="color:${ELEMENTS[t.element].css}">${ELEMENTS[t.element].glyph}</span> <span style="color:${RARITIES[t.rarity].css}">${esc(d.name)}</span>${t.sold ? '<small class="end-sold">sold</small>' : ''}${t.uid === s.mvp ? '<small class="end-mvp-tag">MVP</small>' : ''}</td>
        <td>${t.level}</td><td>${fmt(t.kills)}</td><td>${fmt(t.damage)}</td>
        <td><div class="end-share"><i style="width:${share}%"></i><span>${share.toFixed(1)}%</span></div></td>
        <td>${this.itemIcons(t)}</td><td>${this.perkIcons(t)}</td><td>${fmt(t.invested)}</td></tr>`;
    }).join('');
    return s.towerLedger.length
      ? `<div class="end-table-wrap"><table class="end-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`
      : '<p class="end-empty">No towers were built.</p>';
  }

  bars(entries, total) {
    const list = entries.filter(([, v]) => v >= 0.5).sort((a, b) => b[1] - a[1]);
    if (!list.length) return '<p class="end-empty">Nothing to show.</p>';
    return list.map(([label, v, css]) => `<div class="end-bar"><span class="end-bar-label">${label}</span>
      <div class="end-bar-track"><i style="width:${pct(v, total)}%;background:${css}"></i></div>
      <span class="end-bar-val">${fmt(v)} · ${pct(v, total).toFixed(1)}%</span></div>`).join('');
  }

  analysis() {
    const s = this.sum;
    const byEl = Object.entries(s.damageByElement).filter(([e]) => ELEMENTS[e]).map(([e, v]) => [`${ELEMENTS[e].glyph} ${ELEMENTS[e].name}`, v, ELEMENTS[e].css]);
    if (s.damageOther >= 1) byEl.push(['Other', s.damageOther, '#8a8070']);
    const byAtk = Object.entries(s.damageByAttack).map(([k, v]) => (k === 'spell' ? ['Spells', v, SPELL_CSS] : ATTACK_TYPES[k] ? [ATTACK_TYPES[k].name, v, ATTACK_TYPES[k].css] : null)).filter(Boolean);
    const atkTotal = byAtk.reduce((a, [, v]) => a + v, 0);
    const leakTotal = Object.values(s.leaksBySize).reduce((a, b) => a + b, 0);
    const bySize = Object.entries(s.leaksBySize).filter(([k]) => SIZES[k]).map(([k, v]) => [SIZES[k].name, v, '#ff8a78']);
    const byRace = Object.entries(s.leaksByRace).filter(([k]) => RACES[k]).map(([k, v]) => [RACES[k].name, v, RACES[k].css]);
    const boss = new Set(s.bossLeakWaves);
    const waves = s.leakWaves.length
      ? s.leakWaves.map((w) => `<span class="end-wave ${boss.has(w) ? 'boss' : ''}" ${boss.has(w) ? 'data-tip="A boss reached the portal"' : ''}>${w}</span>`).join('')
      : '<p class="end-empty">The portal never took damage.</p>';
    const g = s.goldSpent, tm = s.tomesSpent;
    const goldTotal = g.build + g.upgrade + g.train, tomeTotal = tm.research + tm.towers + tm.reroll;
    return `<div class="end-cols">
      <section><h4>Damage by element</h4>${this.bars(byEl, s.damage)}</section>
      <section><h4>Damage by attack type</h4>${this.bars(byAtk, atkTotal)}</section>
      <section><h4>Portal damage by creep size</h4>${leakTotal ? this.bars(bySize, leakTotal) : '<p class="end-empty">No creep reached the portal.</p>'}</section>
      <section><h4>Portal damage by race</h4>${leakTotal ? this.bars(byRace, leakTotal) : '<p class="end-empty">No creep reached the portal.</p>'}</section>
      <section class="wide"><h4>Waves that damaged the portal</h4><div class="end-waves">${waves}</div>
        ${s.challengeEscapes ? `<p class="end-note">${s.challengeEscapes} challenge creeps escaped (they never damage the portal).</p>` : ''}</section>
      <section><h4>Gold spent</h4>${this.bars([['Building', g.build, '#f2c766'], ['Upgrades', g.upgrade, '#e0a040'], ['Training', g.train, '#c0803a']], goldTotal)}</section>
      <section><h4>Tomes spent</h4>${this.bars([['Research', tm.research, '#7fb6ff'], ['Towers', tm.towers, '#5f8fd0'], ['Rerolls', tm.reroll, '#4a6fa8']], tomeTotal)}</section>
    </div>`;
  }

  achievements() {
    const { sum, result } = this;
    if (!result) {
      return `<p class="end-empty">${sum.cfg.god ? 'God mode runs are not recorded, so no achievements or records were updated.' : 'This run was not recorded.'}</p>`;
    }
    const earned = result.earned.map((id) => ACHIEVEMENT_BY_ID[id]).map((a) => `<div class="end-ach new">
      <span class="end-ach-icon">${a.icon}</span><div><b>${esc(a.name)}</b><small>${esc(a.desc)}</small>
      ${rewardsOf(a).length ? `<em>Unlocked: ${rewardsOf(a).map(unlockName).join(', ')}</em>` : ''}</div></div>`).join('');
    const record = result.newRecord
      ? `<div class="end-recordline">New record on this setup: score ${fmt(sum.score)}${result.prevRecord ? ` (previous ${fmt(result.prevRecord.score)} at wave ${result.prevRecord.level})` : ''}</div>` : '';
    const none = !earned && !record ? '<p class="end-empty">No new achievements this run.</p>' : '';
    return `${record}${earned ? `<div class="end-achs">${earned}</div>` : ''}${none}${this.goals(3)}`;
  }

  // The unearned achievements closest to completion.
  goals(n) {
    const p = this.result?.profile || this.profile;
    if (!p) return '';
    const open = ACHIEVEMENTS.filter((a) => !p.achievements[a.id]);
    if (!open.length) return '';
    const ranked = open.map((a) => {
      const pr = progressOf(a, p);
      return { a, pr, ratio: pr ? pr[0] / pr[1] : 0 };
    }).sort((x, y) => y.ratio - x.ratio).slice(0, n);
    return `<div class="end-goals"><h4>${n === 1 ? 'Next goal' : 'Next goals'}</h4>${ranked.map(({ a, pr }) => `<div class="end-goal">
      <span class="end-ach-icon">${a.icon}</span><div><b>${esc(a.name)}</b><small>${esc(a.desc)}</small>
      ${pr ? `<div class="end-share"><i style="width:${pct(pr[0], pr[1])}%"></i><span>${fmt(pr[0])} / ${fmt(pr[1])}</span></div>` : ''}</div></div>`).join('')}</div>`;
  }
}
