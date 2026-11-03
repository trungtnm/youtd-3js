// Online account state: the signed-in (or guest) player, their server profile, run
// tickets and the outbox of finished runs waiting to upload. Without a reachable
// server the game keeps working offline on the profile stored in this browser.

import { Emitter } from '../sim/rng.js';
import { sanitize } from '../meta/profile.js';
import { api, ApiError, gzipJson, toBase64, fromBase64 } from './api.js';
import { SIM_BUILD } from '../sim/sim-build.js';

const CACHE_KEY = 'youtd-reforged-online';  // last known { user, profile }, shown while offline
const OUTBOX_KEY = 'youtd-reforged-outbox'; // [{ runId, tick, body, at }]: gzip uploads not yet accepted
const OUTBOX_MAX = 20;
const POLL_MS = 2000;
const POLL_FOR_MS = 120_000;
const FINAL = new Set(['verified', 'rejected', 'unverified', 'deferred']);

const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };

export class Online extends Emitter {
  constructor() {
    super();
    this.status = 'checking'; // checking | online | offline
    this.user = null;
    this.profile = null;      // sanitized server profile
    this.pending = [];
    this.verify = 'all';      // the server's budget mode: all | important | paused
    this.outdated = false;    // the server runs a newer game build than this tab
    this.outbox = read(OUTBOX_KEY, []).filter((e) => e && typeof e.runId === 'string' && typeof e.body === 'string');
    this.memoryOutbox = null; // used when storage refuses the outbox
    this.retryMs = 15_000;
    const cache = read(CACHE_KEY, null);
    if (cache?.user && cache.profile) { this.user = cache.user; this.profile = sanitize(cache.profile); }
    window.addEventListener('online', () => this.init());
  }

  // True when the account can be used right now.
  get ready() { return this.status === 'online' && !!this.user; }
  // True when new runs can be verified: a tab left open across a deploy runs an older
  // simulation than the server and has to reload first.
  get canStartRuns() { return this.ready && !this.outdated; }

  async init() {
    this.status = 'checking';
    this.emit('change');
    try {
      let me = await api('/me');
      if (!me.user) me = await api('/auth/guest', { method: 'POST' });
      this.setMe(me);
      this.status = 'online';
      await this.refreshProfile();
    } catch {
      this.status = 'offline';
    }
    this.emit('change');
    if (this.status === 'online') this.flush();
  }

  setMe(me) {
    this.user = me.user;
    this.verify = me.verify || 'all';
    this.outdated = typeof me.build === 'string' && me.build !== SIM_BUILD;
  }

  async refreshProfile() {
    const data = await api('/profile');
    this.profile = sanitize(data.profile);
    this.pending = Array.isArray(data.pending) ? data.pending : [];
    write(CACHE_KEY, { user: this.user, profile: this.profile });
    this.emit('profile', this.profile);
    return this.profile;
  }

  // ---------------------------------------------------------------- runs

  // Asks the server for a run ticket and seed. Returns { runId, ticket, seed, cfg } or { error }.
  async startRun(cfg, weekly = false) {
    if (!this.canStartRuns) return { error: this.outdated ? 'outdated' : 'offline' };
    try {
      const t = await api('/runs/start', { method: 'POST', body: { cfg, weekly }, timeout: 6000 });
      if (t.build !== SIM_BUILD) { this.outdated = true; this.emit('change'); return { error: 'outdated' }; }
      return t;
    } catch (e) {
      if (e.status === 0) { this.status = 'offline'; this.emit('change'); }
      return { error: e.code, message: e.message };
    }
  }

  // Queues a finished (or continued) run for upload. A continued run's longer log is
  // queued after its victory log rather than replacing it: the server records the
  // victory (record, leaderboard) from the first and only adds the rest from the second.
  async submitRun({ runId, ticket, log, claim }) {
    const body = toBase64(await gzipJson({ ticket, log, claim }));
    const tick = log.end.tick;
    const box = this.queue().filter((e) => e.runId !== runId || e.tick !== tick);
    box.push({ runId, tick, body, at: Date.now() });
    this.saveOutbox(box.slice(-OUTBOX_MAX));
    this.emit('runStatus', { runId, status: 'uploading' });
    this.flush();
  }

  queue() { return this.memoryOutbox || this.outbox; }

  saveOutbox(box) {
    this.outbox = box;
    this.memoryOutbox = write(OUTBOX_KEY, box) ? null : box;
  }

  async flush() {
    if (this.flushing || !this.ready) return;
    this.flushing = true;
    try {
      for (const entry of [...this.queue()]) {
        let res;
        try {
          res = await api('/runs/submit', { method: 'POST', raw: fromBase64(entry.body), contentType: 'application/gzip', timeout: 30_000 });
        } catch (e) {
          // Network trouble, rate limits and server errors keep the run for a later try.
          if (!(e instanceof ApiError) || e.status === 0 || e.status === 429 || e.status >= 500) {
            this.emit('runStatus', { runId: entry.runId, status: 'waiting' });
            clearTimeout(this.retryTimer);
            this.retryTimer = setTimeout(() => this.flush(), this.retryMs);
            this.retryMs = Math.min(10 * 60_000, this.retryMs * 2);
            break;
          }
          res = { runId: entry.runId, status: 'refused', error: e.code, message: e.message };
        }
        this.retryMs = 15_000;
        this.saveOutbox(this.queue().filter((e) => e.runId !== entry.runId || e.at !== entry.at));
        this.emit('runStatus', res);
        if (res.status === 'queued') this.poll(res.runId);
        else if (res.status !== 'refused') this.refreshProfile().catch(() => {});
      }
    } finally {
      this.flushing = false;
    }
  }

  // Follows a queued run until the server has verified (or refused) it.
  async poll(runId) {
    const until = Date.now() + POLL_FOR_MS;
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      let run;
      try { run = await api(`/runs/${encodeURIComponent(runId)}`); } catch { continue; }
      if (FINAL.has(run.status)) {
        await this.refreshProfile().catch(() => {});
        this.emit('runStatus', run);
        return run;
      }
    }
    return null;
  }

  // ---------------------------------------------------------------- account

  signInGoogle() { window.location.href = '/api/auth/google'; }

  async emailLink(email) { return api('/auth/email', { method: 'POST', body: { email } }); }

  async signOut() {
    await api('/auth/logout', { method: 'POST' });
    try { localStorage.removeItem(CACHE_KEY); } catch { /* storage unavailable */ }
    this.user = null; this.profile = null;
    await this.init();
  }

  async updateProfile(changes) {
    const data = await api('/profile', { method: 'PUT', body: changes });
    if (data.user) this.user = data.user;
    this.profile = sanitize(data.profile);
    write(CACHE_KEY, { user: this.user, profile: this.profile });
    this.emit('profile', this.profile);
    this.emit('change');
    return this.profile;
  }

  sessions() { return api('/sessions'); }
  revokeSession(id) { return api(`/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
  exportAccount() { return api('/account/export'); }

  async deleteAccount() {
    await api('/account', { method: 'DELETE', body: { confirm: 'DELETE' } });
    try { localStorage.removeItem(CACHE_KEY); localStorage.removeItem(OUTBOX_KEY); } catch { /* storage unavailable */ }
    this.user = null; this.profile = null; this.outbox = []; this.memoryOutbox = null;
    await this.init();
  }

  leaderboard(key) { return api(`/leaderboard?key=${encodeURIComponent(key)}`); }
  weekly() { return api('/leaderboard/weekly'); }
}
