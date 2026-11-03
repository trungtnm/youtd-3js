// Account panel: sign in (Google or an emailed link), display name, signed-in
// devices, data export and account deletion. Server text goes through esc.

import { esc } from './util.js';

const $ = (s) => document.querySelector(s);
const date = (t) => (t ? new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const NAME = /^[A-Za-z0-9 _-]{3,20}$/;
// "Chrome on macOS" from a user-agent string, for the device list.
function deviceName(ua = '') {
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}
const VERIFY_NOTE = {
  important: 'The server is busy this month: only runs that set a record, reach a leaderboard or claim a victory are verified. Other runs go to your history.',
  paused: 'Verification is paused until next month. Your runs are kept and verified then.',
};

export class AccountPanel {
  constructor(online, onChange) {
    this.online = online;
    this.onChange = onChange;
    this.msg = '';
    this.sessions = null;
    this.confirmDelete = false;
    this.naming = false; // the first-sign-in name prompt is showing
    const box = $('#account');
    box.addEventListener('click', (e) => this.click(e));
    box.addEventListener('submit', (e) => { e.preventDefault(); this.submit(e.target); });
    online.on('change', () => { if (this.isOpen()) this.render(); });
  }

  isOpen() { return !$('#account').classList.contains('hidden'); }

  open() {
    this.msg = ''; this.confirmDelete = false; this.sessions = null; this.naming = false;
    $('#account').classList.remove('hidden');
    this.render();
    if (this.online.ready) this.loadSessions();
  }

  close() { $('#account').classList.add('hidden'); }

  // After signing in to an account that has no chosen name: ask for one first.
  openNamePrompt() {
    this.open();
    this.naming = true;
    this.render();
  }

  async loadSessions() {
    try { this.sessions = (await this.online.sessions()).sessions; } catch { this.sessions = null; }
    if (this.isOpen()) this.render();
  }

  // Redraws the panel. Late updates (the device list, account changes) redraw while the
  // player may be typing, so the focused field keeps its text and focus; the name prompt
  // starts with its field focused.
  render() {
    const body = $('#account-body');
    const active = document.activeElement;
    const typing = body.contains(active) && active.name && active.form?.id ? { form: active.form.id, name: active.name, value: active.value } : null;
    this.draw();
    const field = typing ? body.querySelector(`#${typing.form} [name="${typing.name}"]`) : this.naming ? body.querySelector('#acct-name [name="name"]') : null;
    if (!field) return;
    if (typing) field.value = typing.value;
    field.focus();
  }

  draw() {
    const o = this.online, u = o.user;
    const msg = this.msg ? `<p class="acct-msg">${esc(this.msg)}</p>` : '';
    if (o.status === 'checking') { $('#account-body').innerHTML = '<p class="hall-note">Connecting…</p>'; return; }
    if (!o.ready) {
      $('#account-body').innerHTML = `${msg}<p class="hall-note">The game server cannot be reached. You can keep playing: runs are saved in this browser
        ${u ? `and runs already started online upload when you reconnect` : ''}.</p>
        <div class="row"><button class="btn" data-act="retry">Try again</button></div>`;
      return;
    }
    if (this.naming && !u.guest) {
      $('#account-body').innerHTML = `${msg}<section class="acct-welcome"><h3>Choose your name</h3>
        <p class="hall-note">You are signed in${u.email ? ` as ${esc(u.email)}` : ''}. Pick the name shown on leaderboards:
          3 to 20 letters, digits, spaces, _ or -. You can change it later here.</p>
        <form id="acct-name" class="acct-form"><input name="name" required minlength="3" maxlength="20" pattern="[A-Za-z0-9 _\\-]{3,20}"
          placeholder="${esc(u.name)}" autocomplete="nickname" />
        <button class="btn gold" type="submit">Save name</button></form>
        <div class="row"><button class="btn" data-act="keep-name">Keep ${esc(u.name)}</button></div></section>`;
      return;
    }
    const how = u.guest ? 'Guest account on this browser' : [u.google ? 'Google' : '', u.email ? esc(u.email) : ''].filter(Boolean).join(' · ');
    const signIn = u.guest || !u.google || !u.email ? `<section><h3>${u.guest ? 'Keep your progress' : 'Add a sign-in method'}</h3>
      ${u.guest ? '<p class="hall-note">You are playing as a guest. Sign in to keep your records and achievements on any device; your guest progress moves to the account.</p>' : ''}
      <div class="acct-signin">
        ${u.google ? '' : '<button class="btn gold" data-act="google">Sign in with Google</button>'}
        ${u.email ? '' : `<form id="acct-email" class="acct-form"><input type="email" name="email" required maxlength="254" placeholder="you@example.com" autocomplete="email" />
          <button class="btn" type="submit">Email me a sign-in link</button></form>`}
      </div></section>` : '';
    const sessions = this.sessions ? this.sessions.map((s) => `<tr><td>${esc(deviceName(s.agent))}${s.current ? ' <small>(this one)</small>' : ''}</td>
      <td>${date(s.lastSeen)}</td><td>${s.current ? '' : `<button class="btn small" data-revoke="${esc(s.id)}">Sign out</button>`}</td></tr>`).join('') : '';
    $('#account-body').innerHTML = `${msg}
      <div class="acct-head"><div><b>${esc(u.name)}${/^[0-9a-f]{4}$/.test(u.tag || '') ? ` <small class="board-tag">#${u.tag}</small>` : ''}</b><span>${how}</span></div></div>
      ${VERIFY_NOTE[o.verify] ? `<div class="hall-banner">${esc(VERIFY_NOTE[o.verify])}</div>` : ''}
      ${signIn}
      <section><h3>Display name</h3><p class="hall-note">Shown on leaderboards. 3 to 20 letters, digits, spaces, _ or -.</p>
        <form id="acct-name" class="acct-form"><input name="name" required minlength="3" maxlength="20" pattern="[A-Za-z0-9 _\\-]{3,20}" value="${esc(u.name)}" />
        <button class="btn" type="submit">Save</button></form></section>
      ${this.sessions?.length ? `<section><h3>Signed-in devices</h3><table class="hall-history"><tbody>${sessions}</tbody></table></section>` : ''}
      <section><h3>Your data</h3><div class="row">
        <button class="btn" data-act="export">Download my data</button>
        ${u.guest ? '' : '<button class="btn" data-act="logout">Sign out</button>'}
        <button class="btn danger" data-act="delete">${this.confirmDelete ? 'Really delete everything?' : 'Delete account'}</button>
        ${this.confirmDelete ? '<button class="btn" data-act="keep">Cancel</button>' : ''}
      </div>${this.confirmDelete ? '<p class="hall-note">Deleting removes your account, runs, records and leaderboard entries. It cannot be undone.</p>' : ''}</section>`;
  }

  async run(fn, done) {
    try { await fn(); this.msg = done || ''; } catch (e) { this.msg = e.message || 'Something went wrong.'; }
    this.render();
  }

  click(e) {
    if (e.target.closest('#account-close')) { this.close(); return; }
    const revoke = e.target.closest('[data-revoke]')?.dataset.revoke;
    if (revoke) { this.run(async () => { await this.online.revokeSession(revoke); await this.loadSessions(); }, 'Device signed out.'); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'retry') this.online.init();
    if (act === 'google' && this.online.signInGoogle()) { this.msg = 'Finish signing in with Google in the window that opened.'; this.render(); }
    if (act === 'keep-name') this.run(async () => { await this.online.updateProfile({ name: this.online.user.name }); this.naming = false; }, 'Name kept.');
    if (act === 'logout') this.run(async () => { await this.online.signOut(); this.onChange?.(); }, 'Signed out.');
    if (act === 'keep') { this.confirmDelete = false; this.render(); }
    if (act === 'delete') {
      if (!this.confirmDelete) { this.confirmDelete = true; this.render(); return; }
      this.confirmDelete = false;
      this.run(async () => { await this.online.deleteAccount(); this.onChange?.(); }, 'Your account was deleted.');
    }
    if (act === 'export') {
      this.run(async () => {
        const data = await this.online.exportAccount();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
        a.download = `youtd-account-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      });
    }
  }

  submit(form) {
    if (form.id === 'acct-email') {
      const email = form.email.value.trim();
      this.run(async () => {
        const res = await this.online.emailLink(email);
        // Development servers return the link instead of mailing it.
        if (res.link && new URL(res.link, window.location.href).origin === window.location.origin) window.location.href = res.link;
      }, `If ${email} can receive mail, a sign-in link is on its way. It works for 15 minutes.`);
    } else if (form.id === 'acct-name') {
      const name = form.name.value.trim();
      if (!NAME.test(name)) { this.msg = 'Use 3 to 20 letters, digits, spaces, _ or -.'; this.render(); return; }
      this.run(async () => { await this.online.updateProfile({ name }); this.naming = false; }, 'Name saved.');
    }
  }
}
