// Hall of Records: the player's title, records, lifetime totals, run history,
// achievement gallery and unlocks, plus profile export, import and reset.
// Profile data is rendered only through catalog lookups and esc.

import { DIFFICULTIES, MODES, LENGTHS, MODIFIERS } from '../data/constants.js';
import { TOWERS } from '../data/towers.js';
import { ACHIEVEMENTS, ACHIEVEMENT_BY_ID, ACHIEVEMENT_CATEGORIES, UNLOCKS } from '../data/achievements.js';
import { progressOf, unlockedSet } from '../meta/achievements.js';
import { loadProfile, saveProfile, emptyProfile, exportProfile, importProfileFile, recordKey } from '../meta/profile.js';
import { fmt } from '../world/world.js';
import { esc } from './util.js';

const $ = (s) => document.querySelector(s);
const OUTCOME = { won: 'Victory', lost: 'Defeat', abandoned: 'Abandoned' };
const date = (t) => (t ? new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
const hours = (sec) => (sec >= 3600 ? `${(sec / 3600).toFixed(1)}h` : `${Math.floor(sec / 60)}m`);

export class Hall {
  // onChange runs after the profile changes here (title, crest, import, reset).
  constructor(onChange) {
    this.onChange = onChange;
    this.mode = 'build';
    this.pending = null; // { kind: 'import' | 'reset', profile? } awaiting confirmation
    this.message = '';
    const box = $('#hall');
    box.addEventListener('click', (e) => this.click(e));
    box.addEventListener('change', (e) => this.change(e));
    $('#hall-file').addEventListener('change', (e) => this.pickFile(e.target));
  }

  open() {
    this.pending = null; this.message = '';
    $('#hall').classList.remove('hidden');
    this.render();
  }

  close() { $('#hall').classList.add('hidden'); }

  // Always re-read storage so runs finished in another tab show up.
  load() {
    const state = loadProfile();
    this.profile = state.profile;
    this.loadError = state.loadError;
    this.storageOk = state.storageOk;
  }

  save() {
    if (!saveProfile(this.profile)) { this.message = 'Your browser refused to save the profile.'; return false; }
    this.onChange?.(this.profile);
    return true;
  }

  render() {
    this.load();
    const p = this.profile;
    const earned = Object.keys(p.achievements).length;
    const banners = [
      !this.storageOk ? 'Browser storage is unavailable, so progress will not be saved in this session.' : '',
      this.loadError ? 'Your saved profile could not be read, so a fresh one is in use. Import a backup or reset to start over.' : '',
    ].filter(Boolean).map((t) => `<div class="hall-banner">${esc(t)}</div>`).join('');
    $('#hall-body').innerHTML = `${banners}
      ${this.header(p, earned)}
      <section><h3>Records</h3>${this.records(p)}</section>
      <section><h3>Lifetime</h3>${this.lifetime(p)}</section>
      <section><h3>Recent runs</h3>${this.history(p)}</section>
      <section><h3>Achievements <small>${earned} / ${ACHIEVEMENTS.length}</small></h3>${this.gallery(p)}</section>
      <section><h3>Unlocks</h3>${this.unlocks(p)}</section>
      <section><h3>Profile data</h3>${this.data()}</section>`;
  }

  header(p, earned) {
    const titles = unlockedSet(p).titles;
    const options = ['<option value="">No title</option>', ...[...titles].map((id) => `<option value="${id}" ${p.title === id ? 'selected' : ''}>${esc(UNLOCKS.titles[id].name)}</option>`)];
    return `<div class="hall-head">
      <label>Title <select id="hall-title" ${titles.size ? '' : 'disabled'}>${options.join('')}</select></label>
      <div><b>${p.runs}</b><span>Runs</span></div>
      <div><b>${earned} / ${ACHIEVEMENTS.length}</b><span>Achievements</span></div>
      <div><b>${hours(p.totals.timeSec)}</b><span>Time defending</span></div>
    </div>`;
  }

  records(p) {
    const modes = Object.values(MODES).map((m) => `<button class="hall-toggle ${this.mode === m.id ? 'on' : ''}" data-mode="${m.id}">${m.name}</button>`).join('');
    const lengths = Object.values(LENGTHS);
    const rows = Object.values(DIFFICULTIES).map((d) => `<tr><th>${d.name}</th>${lengths.map((l) => {
      const r = p.records[recordKey({ difficulty: d.id, mode: this.mode, length: l.id })];
      return r ? `<td><b>wave ${r.level}</b><small>${fmt(r.score)}</small></td>` : '<td class="empty">—</td>';
    }).join('')}</tr>`).join('');
    const modded = Object.keys(p.records).filter((k) => k.includes('+')).length;
    return `<div class="hall-toggles">${modes}</div>
      <table class="hall-records"><thead><tr><th></th>${lengths.map((l) => `<th>${l.name}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>
      ${modded ? `<p class="hall-note">${modded} more records were set with challenge modifiers.</p>` : ''}`;
  }

  lifetime(p) {
    const t = p.totals;
    return `<div class="hall-tiles">${[
      ['Kills', fmt(t.kills)], ['Damage', fmt(t.damage)], ['Gold earned', fmt(t.gold)], ['Waves cleared', fmt(t.wavesCleared)],
      ['Bosses slain', fmt(t.bossKills)], ['Towers built', fmt(t.towersBuilt)], ['Level 30 towers', fmt(t.maxLevelTowers)], ['Portal hits', fmt(t.leaks)],
    ].map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join('')}</div>`;
  }

  history(p) {
    if (!p.history.length) return '<p class="hall-note">No runs yet. Finished and abandoned runs appear here.</p>';
    return `<div class="hall-scroll"><table class="hall-history"><thead><tr><th>Date</th><th>Setup</th><th>Result</th><th>Waves</th><th>Score</th><th>MVP</th></tr></thead><tbody>${
      [...p.history].reverse().map((h) => {
        const c = h.cfg;
        const mods = c.modifiers.filter((m) => MODIFIERS[m]).map((m) => MODIFIERS[m].name).join(', ');
        const mvp = h.mvp && TOWERS[h.mvp.id] ? `${esc(TOWERS[h.mvp.id].name)} <small>lv ${h.mvp.level}</small>` : '—';
        return `<tr><td>${date(h.at)}</td><td>${DIFFICULTIES[c.difficulty].name} · ${MODES[c.mode].name} · ${LENGTHS[c.length].name}${mods ? `<small class="hall-mods">${esc(mods)}</small>` : ''}</td>
          <td class="out-${h.outcome}">${OUTCOME[h.outcome]}</td><td>${h.wavesCleared}</td><td>${fmt(h.score)}</td><td>${mvp}</td></tr>`;
      }).join('')}</tbody></table></div>`;
  }

  gallery(p) {
    return Object.entries(ACHIEVEMENT_CATEGORIES).map(([cat, label]) => `<h4>${label}</h4><div class="hall-achs">${
      ACHIEVEMENTS.filter((a) => a.cat === cat).map((a) => {
        const got = p.achievements[a.id];
        const pr = !got && progressOf(a, p);
        const reward = a.reward ? Object.entries(a.reward).map(([k, id]) => (k === 'title' ? `Title: ${UNLOCKS.titles[id].name}` : k === 'crest' ? `Crest: ${UNLOCKS.crests[id].name}` : `Modifier: ${MODIFIERS[id].name}`)).join(' · ') : '';
        return `<div class="hall-ach ${got ? 'got' : ''}"><span class="hall-ach-icon">${a.icon}</span><div>
          <b>${esc(a.name)}</b><small>${esc(a.desc)}</small>
          ${reward ? `<em>${esc(reward)}</em>` : ''}
          ${got ? `<i>Earned ${date(got.at)}</i>` : pr ? `<div class="end-share"><i style="width:${(pr[0] / pr[1]) * 100}%"></i><span>${fmt(pr[0])} / ${fmt(pr[1])}</span></div>` : ''}
        </div></div>`;
      }).join('')}</div>`).join('');
  }

  unlocks(p) {
    const u = unlockedSet(p);
    const row = (kind, id, name, desc, on) => {
      const from = ACHIEVEMENT_BY_ID[UNLOCKS[kind][id].from];
      return `<div class="hall-unlock ${on ? 'on' : ''}"><b>${esc(name)}</b><small>${esc(desc || '')}</small><i>${on ? 'Unlocked' : `🔒 ${esc(from.name)}`}</i></div>`;
    };
    const crestPick = u.crests.size
      ? `<label class="hall-crest">Crest on level 30 towers <select id="hall-crest">${[...u.crests].map((id) => `<option value="${id}" ${(p.crest || 'gilded') === id ? 'selected' : ''}>${esc(UNLOCKS.crests[id].name)}</option>`).join('')}</select></label>` : '';
    return `<h4>Titles</h4><div class="hall-unlocks">${Object.entries(UNLOCKS.titles).map(([id, t]) => row('titles', id, t.name, '', u.titles.has(id))).join('')}</div>
      <h4>Challenge modifiers</h4><div class="hall-unlocks">${Object.keys(UNLOCKS.modifiers).map((id) => row('modifiers', id, MODIFIERS[id].name, `${MODIFIERS[id].desc} +${Math.round(MODIFIERS[id].score * 100)}% score.`, u.modifiers.has(id))).join('')}</div>
      <h4>Crests</h4>${crestPick}<div class="hall-unlocks">${Object.entries(UNLOCKS.crests).map(([id, c]) => row('crests', id, c.name, c.desc, u.crests.has(id))).join('')}</div>`;
  }

  data() {
    if (this.pending) {
      const text = this.pending.kind === 'import'
        ? 'Replace your current profile with the imported one? Your current records, history and achievements will be lost unless you export them first.'
        : 'Reset your profile? Records, history, achievements and unlocks will be erased.';
      return `<div class="hall-confirm"><p>${esc(text)}</p><div class="row">
        <button class="btn" data-act="export">Export current first</button>
        <button class="btn danger" data-act="confirm">${this.pending.kind === 'import' ? 'Replace profile' : 'Reset profile'}</button>
        <button class="btn" data-act="cancel">Cancel</button></div></div>`;
    }
    return `<p class="hall-note">Your profile lives in this browser. Export it to keep a backup or move it to another device.</p>
      ${this.message ? `<p class="hall-msg">${esc(this.message)}</p>` : ''}
      <div class="row"><button class="btn" data-act="export">Export</button><button class="btn" data-act="import">Import…</button><button class="btn danger" data-act="reset">Reset</button></div>`;
  }

  // ---------------------------------------------------------------- events

  click(e) {
    if (e.target.closest('#hall-close')) { this.close(); return; }
    const m = e.target.closest('[data-mode]');
    if (m) { this.mode = m.dataset.mode; this.render(); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'export') { this.load(); exportProfile(this.profile); return; }
    if (act === 'import') { $('#hall-file').value = ''; $('#hall-file').click(); return; }
    if (act === 'reset') this.pending = { kind: 'reset' };
    if (act === 'cancel') this.pending = null;
    if (act === 'confirm' && this.pending) {
      const next = this.pending.kind === 'import' ? this.pending.profile : { ...emptyProfile(), legacyMerged: true };
      const prev = this.profile;
      this.profile = next;
      if (this.save()) this.message = this.pending.kind === 'import' ? 'Profile imported.' : 'Profile reset.';
      else this.profile = prev;
      this.pending = null;
      this.render();
      return;
    }
    this.render();
  }

  change(e) {
    if (e.target.id === 'hall-title' || e.target.id === 'hall-crest') {
      this.load();
      const v = e.target.value || null;
      if (e.target.id === 'hall-title') this.profile.title = v; else this.profile.crest = v;
      this.save();
      this.render();
    }
  }

  async pickFile(input) {
    const file = input.files?.[0];
    if (!file) return;
    const res = await importProfileFile(file);
    if (!res.ok) { this.pending = null; this.message = res.error; } else { this.pending = { kind: 'import', profile: res.profile }; this.message = ''; }
    this.render();
  }

}
