// Leaderboards: the best verified run per player on a setup, and the weekly
// challenge, where every player gets the same seed and settings.

import { DIFFICULTIES, MODES, LENGTHS, MODIFIERS } from '../data/constants.js';
import { recordKey } from '../meta/profile.js';
import { fmt } from '../world/world.js';
import { esc } from './util.js';

const $ = (s) => document.querySelector(s);
const OUTCOME = { won: 'Victory', lost: 'Defeat', abandoned: 'Abandoned' };
const date = (t) => (t ? new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—');
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const setupName = (c) => `${DIFFICULTIES[c.difficulty]?.name} · ${MODES[c.mode]?.name} · ${LENGTHS[c.length]?.name}`;

export class Boards {
  // onPlayWeekly starts a weekly challenge run.
  constructor(online, onPlayWeekly) {
    this.online = online;
    this.onPlayWeekly = onPlayWeekly;
    this.tab = 'setup';
    this.cfg = { difficulty: 'medium', mode: 'build', length: 'full', modifiers: [] };
    this.data = null;
    this.error = '';
    const box = $('#boards');
    box.addEventListener('click', (e) => this.click(e));
    box.addEventListener('change', (e) => {
      const k = e.target.dataset.cfg;
      if (k) { this.cfg[k] = e.target.value; this.load(); }
    });
  }

  open(cfg, tab = 'setup') {
    this.cfg = { ...this.cfg, ...cfg };
    this.tab = tab;
    $('#boards').classList.remove('hidden');
    this.load();
  }

  close() { $('#boards').classList.add('hidden'); }

  async load() {
    this.data = null; this.error = '';
    this.render();
    if (!this.online.ready) { this.error = 'Leaderboards need a connection to the game server.'; this.render(); return; }
    try {
      this.data = this.tab === 'weekly' ? await this.online.weekly() : await this.online.leaderboard(recordKey(this.cfg));
    } catch (e) {
      this.error = e.message || 'The leaderboard could not be loaded.';
    }
    this.render();
  }

  render() {
    const tabs = [['setup', 'By setup'], ['weekly', 'Weekly challenge']]
      .map(([id, label]) => `<button class="end-tab ${this.tab === id ? 'on' : ''}" data-tab="${id}">${label}</button>`).join('');
    const select = (key, defs) => `<select data-cfg="${key}">${Object.values(defs).map((d) => `<option value="${d.id}" ${this.cfg[key] === d.id ? 'selected' : ''}>${d.name}</option>`).join('')}</select>`;
    const mods = this.cfg.modifiers.filter((m) => own(MODIFIERS, m)).map((m) => MODIFIERS[m].name).join(', ');
    let head = '';
    if (this.tab === 'setup') {
      head = `<div class="boards-pick">${select('difficulty', DIFFICULTIES)}${select('mode', MODES)}${select('length', LENGTHS)}
        ${mods ? `<span class="end-mod">${esc(mods)}</span>` : ''}</div>`;
    } else if (this.data?.cfg) {
      const c = this.data.cfg;
      const ends = this.data.endsAt ? new Date(this.data.endsAt).toLocaleString(undefined, { weekday: 'long', hour: '2-digit', minute: '2-digit' }) : '';
      head = `<div class="boards-weekly"><div><b>Week ${esc(String(this.data.week))}</b><span>${esc(setupName(c))}${ends ? ` · ends ${esc(ends)}` : ''}</span></div>
        <button class="btn gold" data-act="weekly" ${this.online.canStartRuns ? '' : 'disabled'}>Play this week's challenge</button></div>
        <p class="hall-note">Everyone plays the same waves and drops. Your best verified score counts.</p>`;
    }
    const rows = this.data?.entries?.length
      ? `<table class="hall-history boards-table"><thead><tr><th>#</th><th>Player</th><th>Score</th><th>Wave</th><th>Result</th><th>Date</th></tr></thead><tbody>${
        this.data.entries.map((e) => `<tr><td>${Number(e.rank) || ''}</td><td>${esc(e.name)}${/^[0-9a-f]{4}$/.test(e.tag || '') ? ` <small class="board-tag">#${e.tag}</small>` : ''}</td><td>${fmt(Number(e.score) || 0)}</td>
          <td>${Number(e.level) || 0}</td><td class="out-${own(OUTCOME, e.outcome) ? e.outcome : ''}">${OUTCOME[e.outcome] || ''}</td><td>${date(e.at)}</td></tr>`).join('')}</tbody></table>`
      : this.data ? '<p class="hall-note">No verified runs yet. Be the first.</p>' : '';
    $('#boards-body').innerHTML = `<div class="end-tabs-row">${tabs}</div>${head}
      ${this.error ? `<p class="hall-note">${esc(this.error)}</p>` : !this.data ? '<p class="hall-note">Loading…</p>' : rows}`;
  }

  click(e) {
    if (e.target.closest('#boards-close')) { this.close(); return; }
    const tab = e.target.closest('[data-tab]')?.dataset.tab;
    if (tab && tab !== this.tab) { this.tab = tab; this.load(); return; }
    if (e.target.closest('[data-act="weekly"]')) { this.close(); this.onPlayWeekly(); }
  }
}
