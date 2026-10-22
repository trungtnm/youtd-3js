// In-run scoreboard (Tab): how each tower performs, and which creeps get through.
// Reads Game state only; every name comes from a catalog looked up by id.

import { ELEMENTS, RARITIES, ARMOR_TYPES, RACES, SIZES, DAMAGE_MATRIX } from '../data/constants.js';
import { fmt } from '../world/world.js';
import { esc } from './util.js';

const $ = (s) => document.querySelector(s);
const pct = (part, whole) => (whole > 0 ? (part / whole) * 100 : 0);
const SIZE_CSS = { mass: '#c8b28a', normal: '#e8d6a8', air: '#8fd0ff', champion: '#ff9e5e', boss: '#ff6a6a', challenge: '#d48cff', challengeMass: '#b78cff' };
const ARMORS = ['hide', 'chain', 'plate', 'spirit', 'divine'];
// Challenge waves come as one giant or a swarm; both are named "Challenge" in SIZES.
const SIZE_NAMES = { ...Object.fromEntries(Object.entries(SIZES).map(([id, s]) => [id, { name: s.name }])), challengeMass: { name: 'Challenge swarm' } };
const REFRESH = 1; // seconds between repaints while open

export class Scoreboard {
  constructor() {
    this.box = $('#scoreboard');
    this.timer = 0;
  }

  get open() { return !this.box.classList.contains('hidden'); }

  toggle(game, show = !this.open) {
    this.box.classList.toggle('hidden', !show);
    if (show) { this.timer = 0; this.render(game); }
  }

  update(game, dt) {
    if (!this.open) return;
    if (game.isOver()) { this.toggle(game, false); return; }
    if ((this.timer += dt) < REFRESH) return;
    this.timer = 0;
    this.render(game);
  }

  render(g) {
    const towers = [...g.towers.values()].sort((a, b) => b.damageDealt - a.damageDealt);
    const total = towers.reduce((s, t) => s + t.damageDealt, 0);
    const armorMult = this.armorProfile(towers, total);
    this.maxLives = g.maxLives;
    this.box.innerHTML = `<div class="sb-head"><h3>Scoreboard</h3><span>Wave ${g.level} · ${fmt(g.stats.kills)} kills · ${fmt(g.stats.damage)} damage · Tab to close</span></div>
      <div class="sb-body">
        <section><h4>Towers</h4>${this.towerTable(towers, total)}</section>
        <div class="sb-cols">
          <section><h4>Your damage vs armor</h4>${this.armorBars(armorMult)}${this.upcoming(g, armorMult)}</section>
          <section><h4>By creep size</h4>${this.groupTable(g.stats.groups.size, SIZE_NAMES, SIZE_CSS)}</section>
          <section><h4>By armor</h4>${this.groupTable(g.stats.groups.armor, ARMOR_TYPES)}</section>
          <section><h4>By race</h4>${this.groupTable(g.stats.groups.race, RACES)}</section>
        </div>
      </div>`;
  }

  // ---------------------------------------------------------------- towers

  towerTable(towers, total) {
    if (!towers.length) return '<p class="end-empty">No towers yet.</p>';
    const rows = towers.map((t) => {
      const d = t.def, share = pct(t.damageDealt, total);
      return `<tr data-tt="tower:${d.id}">
        <td class="end-tname"><span style="color:${ELEMENTS[d.element].css}">${ELEMENTS[d.element].glyph}</span> <span style="color:${RARITIES[d.rarity].css}">${esc(d.name)}</span></td>
        <td>${t.level}</td><td>${fmt(t.kills)}</td><td>${fmt(t.damageDealt)}</td>
        <td><div class="end-share"><i style="width:${share}%"></i><span>${share.toFixed(1)}%</span></div></td>
        <td>${fmt(t.stats?.dps || 0)}</td>
        <td>${this.sizeBar(t)}</td>
        <td class="sb-armor">${this.matchup(t)}</td></tr>`;
    }).join('');
    return `<div class="end-table-wrap"><table class="end-table sb-table"><thead><tr>
      <th>Tower</th><th>Lv</th><th>Kills</th><th>Damage</th><th>Share</th><th data-tip="Expected attack damage per second from current stats, before armor">DPS</th>
      <th data-tip="Where this tower's damage went, by creep size">Damage by size</th><th data-tip="Attack damage multiplier against each armor type. Spells ignore armor.">Armor matchup</th>
      </tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  sizeBar(t) {
    const by = t.dmgBySize || {};
    const sum = Object.values(by).reduce((s, v) => s + v, 0);
    if (!sum) return '<span class="sb-muted">-</span>';
    const parts = Object.entries(by).filter(([k]) => SIZES[k]).sort((a, b) => b[1] - a[1]);
    const tip = parts.map(([k, v]) => `${SIZES[k].name} ${pct(v, sum).toFixed(0)}%`).join(', ');
    return `<div class="sb-stack" data-tip="${esc(tip)}">${parts.map(([k, v]) => `<i style="width:${pct(v, sum)}%;background:${SIZE_CSS[k] || '#888'}"></i>`).join('')}</div>`;
  }

  // Strong and weak armor for the tower's attack type; mostly-spell towers ignore armor.
  matchup(t) {
    const spell = t.dmgSplit?.spell || 0;
    if (t.damageDealt > 0 && spell / t.damageDealt >= 0.5) return '<span class="sb-muted">Spells ignore armor</span>';
    const row = DAMAGE_MATRIX[t.stats?.attackType || t.def.attack];
    if (!row) return '';
    const list = ARMORS.map((a) => [a, row[a]]);
    const strong = list.filter(([, m]) => m > 1).map(([a, m]) => `<b style="color:${ARMOR_TYPES[a].css}">${ARMOR_TYPES[a].name} ×${m}</b>`);
    const weak = list.filter(([, m]) => m < 1).map(([a, m]) => `<b style="color:${ARMOR_TYPES[a].css}">${ARMOR_TYPES[a].name} ×${m}</b>`);
    return `${strong.length ? `<span class="sb-good">▲</span> ${strong.join(' ')}` : ''}${weak.length ? ` <span class="sb-bad">▼</span> ${weak.join(' ')}` : ''}`;
  }

  // ---------------------------------------------------------------- creeps

  // Damage-weighted multiplier of the whole defense against each armor type.
  armorProfile(towers, total) {
    const out = Object.fromEntries(ARMORS.map((a) => [a, 1]));
    if (!total) return out;
    for (const a of ARMORS) {
      let sum = 0;
      for (const t of towers) {
        const spell = Math.min(t.damageDealt, t.dmgSplit?.spell || 0);
        const row = DAMAGE_MATRIX[t.stats?.attackType || t.def.attack];
        sum += spell + (t.damageDealt - spell) * (row ? row[a] : 1);
      }
      out[a] = sum / total;
    }
    return out;
  }

  armorBars(mult) {
    const worst = ARMORS.reduce((w, a) => (mult[a] < mult[w] ? a : w), ARMORS[0]);
    return ARMORS.map((a) => `<div class="end-bar sb-bar"><span class="end-bar-label" style="color:${ARMOR_TYPES[a].css}">${ARMOR_TYPES[a].name}${a === worst ? ' <small class="sb-weak">weakest</small>' : ''}</span>
      <div class="end-bar-track"><i style="width:${Math.min(100, (mult[a] / 1.8) * 100)}%;background:${mult[a] < 0.8 ? '#ff7a6a' : mult[a] < 1 ? '#e0b050' : '#7fd07a'}"></i></div>
      <span class="end-bar-val">×${mult[a].toFixed(2)}</span></div>`).join('');
  }

  // Upcoming waves whose armor the defense handles poorly.
  upcoming(g, mult) {
    const risky = g.wavePreview(5).filter((w) => mult[w.armor] != null && mult[w.armor] < 0.85);
    if (!risky.length) return '<p class="sb-note">No weak armor matchups in the next 5 waves.</p>';
    return `<p class="sb-note">${risky.map((w) => `Wave ${w.level}: <b style="color:${ARMOR_TYPES[w.armor].css}">${ARMOR_TYPES[w.armor].name}</b> ${esc(SIZES[w.size]?.name || '')} (×${mult[w.armor].toFixed(2)})`).join('<br>')}</p>`;
  }

  groupTable(groups, catalog, colors = {}) {
    const rows = Object.entries(groups).filter(([id]) => catalog[id])
      .sort((a, b) => b[1].lives - a[1].lives || (a[1].killed / a[1].seen) - (b[1].killed / b[1].seen));
    if (!rows.length) return '<p class="end-empty">No creeps yet.</p>';
    const worst = rows[0][1].lives > 0 ? rows[0][0] : null;
    return `<table class="end-table sb-group"><thead><tr><th>Type</th><th>Seen</th><th>Killed</th><th data-tip="Creeps that reached the portal">Out</th><th data-tip="Portal integrity lost">Portal</th></tr></thead><tbody>
      ${rows.map(([id, r]) => `<tr class="${id === worst ? 'sb-worst' : ''}">
        <td style="color:${colors[id] || catalog[id].css || 'inherit'}">${esc(catalog[id].name)}${id === worst ? ' <small class="sb-weak">weak spot</small>' : ''}</td>
        <td>${fmt(r.seen)}</td><td>${fmt(r.killed)} <small class="sb-muted">${pct(r.killed, r.seen).toFixed(0)}%</small></td>
        <td>${r.escaped ? fmt(r.escaped) : '-'}</td><td>${r.lives ? `${Math.round(pct(r.lives, this.maxLives))}%` : '-'}</td></tr>`).join('')}
      </tbody></table>`;
  }
}
