import { MUSIC_TRACKS } from '../data/music-tracks.js';

// Audio: sound effects are synthesised with WebAudio; music is a licensed playlist.

export class Audio {
  constructor() {
    this.ctx = null;
    this.sfxVol = 0.6;
    this.musicVol = 0.45;
    this.last = new Map();
  }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    this.master = ctx.createDynamicsCompressor();
    this.master.threshold.value = -14;
    this.master.ratio.value = 4;
    this.master.connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.gain.value = this.sfxVol; this.sfx.connect(this.master);
    // Shared reverb for space
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(2.6, 2.2);
    const rv = ctx.createGain(); rv.gain.value = 0.35;
    this.reverb.connect(rv); rv.connect(this.master);
    this.noiseBuf = this._noise(1.5);
    this._startMusic();
  }

  setVolumes(sfx, music) {
    this.sfxVol = sfx; this.musicVol = music;
    if (this.ctx) this.sfx.gain.value = sfx;
  }

  _impulse(seconds, decay) {
    const ctx = this.ctx, len = ctx.sampleRate * seconds;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  _noise(seconds) {
    const ctx = this.ctx, len = ctx.sampleRate * seconds;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // Throttle identical sounds so a hundred towers firing doesn't clip.
  _gate(key, gap) {
    if (!this.ctx) return false;
    const now = this.ctx.currentTime;
    if ((this.last.get(key) || 0) + gap > now) return false;
    this.last.set(key, now);
    return true;
  }

  _env(node, t, a, peak, d, end = 0.0001) {
    node.gain.setValueAtTime(0.0001, t);
    node.gain.exponentialRampToValueAtTime(peak, t + a);
    node.gain.exponentialRampToValueAtTime(end, t + a + d);
  }

  tone({ type = 'sine', f0 = 440, f1 = f0, dur = 0.2, vol = 0.3, attack = 0.005, wet = 0.2, filter = 0, q = 1, delay = 0 }) {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    this._env(g, t, attack, vol, dur);
    let node = o;
    if (filter) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filter; f.Q.value = q; o.connect(f); node = f; }
    node.connect(g); g.connect(this.sfx);
    if (wet) { const w = ctx.createGain(); w.gain.value = wet; g.connect(w); w.connect(this.reverb); }
    o.start(t); o.stop(t + attack + dur + 0.05);
  }

  noise({ dur = 0.2, vol = 0.3, type = 'bandpass', f0 = 1000, f1 = f0, q = 1, attack = 0.003, wet = 0.15, delay = 0 }) {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime + delay;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = ctx.createGain();
    this._env(g, t, attack, vol, dur);
    s.connect(f); f.connect(g); g.connect(this.sfx);
    if (wet) { const w = ctx.createGain(); w.gain.value = wet; g.connect(w); w.connect(this.reverb); }
    s.start(t, Math.random() * 0.5); s.stop(t + attack + dur + 0.05);
  }

  // ---------------------------------------------------------------- game sounds

  shot(attack, kind) {
    if (!this._gate(`shot-${kind}`, kind === 'bullet' ? 0.07 : 0.05)) return;
    const v = 0.07;
    switch (kind) {
      case 'bullet': this.noise({ dur: 0.05, vol: v * 1.2, f0: 3000, f1: 1200, q: 0.8 }); break;
      case 'shell': case 'magma':
        this.tone({ type: 'sine', f0: 160, f1: 50, dur: 0.25, vol: v * 2.5 });
        this.noise({ dur: 0.18, vol: v * 1.5, type: 'lowpass', f0: 1400, f1: 200 }); break;
      case 'bolt': case 'thorn': case 'wind': this.noise({ dur: 0.12, vol: v * 1.2, f0: 2500, f1: 600, q: 2 }); break;
      case 'fireball': case 'ember': case 'phoenix': this.noise({ dur: 0.3, vol: v * 1.3, type: 'lowpass', f0: 2000, f1: 300 }); break;
      case 'lightning': case 'spark':
        this.noise({ dur: 0.12, vol: v * 1.4, type: 'highpass', f0: 4000, f1: 1500 });
        this.tone({ type: 'sawtooth', f0: 900, f1: 120, dur: 0.1, vol: v * 0.6, filter: 3000 }); break;
      case 'icebolt': case 'snow': this.tone({ type: 'triangle', f0: 1800, f1: 2600, dur: 0.12, vol: v * 0.8, wet: 0.4 }); break;
      case 'star': case 'moon': this.tone({ type: 'sine', f0: 1300, f1: 1700, dur: 0.18, vol: v * 0.8, wet: 0.5 }); break;
      case 'beam': this.tone({ type: 'sawtooth', f0: 220, f1: 240, dur: 0.12, vol: v * 0.35, filter: 1200 }); break;
      case 'coin': this.tone({ type: 'square', f0: 1500, f1: 2200, dur: 0.06, vol: v * 0.4, filter: 4000 }); break;
      default: this.tone({ type: 'triangle', f0: 500, f1: 200, dur: 0.12, vol: v * 0.8, filter: 2000 });
    }
  }

  // Layered kill sound: a body thump and a wet crunch scaled by size, plus a short
  // race "voice". Layers are gated separately so a pack dying at once stays clean.
  death(size, race) {
    if (size === 'boss' || size === 'challenge') { this.bossDeath(); return; }
    if (!this._gate('death', 0.035)) return;
    const k = size === 'mass' || size === 'challengeMass' ? 0.75 : size === 'champion' ? 1.6 : 1;
    const p = 0.88 + Math.random() * 0.24;
    this.tone({ type: 'sine', f0: 190 * p / k, f1: 45, dur: 0.1 + 0.06 * k, vol: 0.1 * k, wet: 0.08 });
    this.noise({ dur: 0.08 + 0.06 * k, vol: 0.07 * k, type: 'bandpass', f0: 2400 * p, f1: 350, q: 0.9, wet: 0.1 });
    if (size === 'champion') this.noise({ dur: 0.5, vol: 0.16, type: 'lowpass', f0: 1800, f1: 90, wet: 0.35 });
    if (!this._gate('deathVoice', 0.1)) return;
    const v = 0.045 * Math.sqrt(k);
    switch (race) {
      case 'undead': // bones clattering
        for (let i = 0; i < 3; i++) this.noise({ dur: 0.025, vol: v * 1.3, type: 'highpass', f0: 3500 + i * 700, f1: 2500, delay: i * 0.035 + Math.random() * 0.01, wet: 0.1 });
        break;
      case 'brute': this.tone({ type: 'sawtooth', f0: 150 * p, f1: 70, dur: 0.28, vol: v * 1.3, filter: 600, wet: 0.15 }); break;
      case 'arcane':
        this.tone({ type: 'sine', f0: 1500 * p, f1: 2600, dur: 0.22, vol: v, wet: 0.6 });
        this.tone({ type: 'sine', f0: 2250 * p, f1: 3600, dur: 0.18, vol: v * 0.6, wet: 0.6, delay: 0.03 });
        break;
      case 'feral': this.tone({ type: 'triangle', f0: 820 * p, f1: 1500, dur: 0.12, vol: v * 1.1, filter: 2600, wet: 0.15 }); break;
      default: this.tone({ type: 'sawtooth', f0: 280 * p, f1: 150, dur: 0.13, vol: v, filter: 1200, wet: 0.12 });
    }
  }

  // Two-stage boss explosion timed to the visual sequence (final blast at 0.6 s).
  bossDeath() {
    if (!this._gate('bossDeath', 0.5)) return;
    this.tone({ type: 'sine', f0: 140, f1: 40, dur: 0.6, vol: 0.32 });
    this.noise({ dur: 0.5, vol: 0.25, type: 'lowpass', f0: 2600, f1: 200, wet: 0.4 });
    for (let i = 0; i < 4; i++) this.noise({ dur: 0.25, vol: 0.13, type: 'lowpass', f0: 1600, f1: 120, delay: 0.1 + i * 0.12, wet: 0.4 });
    this.tone({ type: 'sine', f0: 110, f1: 26, dur: 1.8, vol: 0.55, delay: 0.6 });
    this.noise({ dur: 1.6, vol: 0.45, type: 'lowpass', f0: 3200, f1: 50, delay: 0.6, wet: 0.7 });
    this.noise({ dur: 0.12, vol: 0.2, type: 'highpass', f0: 6000, f1: 2500, delay: 0.6, wet: 0.3 });
    [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone({ type: 'triangle', f0: f, dur: 0.5, vol: 0.06, delay: 0.85 + i * 0.07, wet: 0.7 }));
  }

  // Metallic clink with two inharmonic partials. Quick successions climb in pitch.
  coin() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const last = this.last.get('coin') || 0;
    if (now - last < 0.045) return;
    this.coinStep = now - last < 0.25 ? Math.min(10, (this.coinStep || 0) + 1) : 0;
    this.last.set('coin', now);
    const f = 1900 * (0.95 + Math.random() * 0.1) * Math.pow(2, this.coinStep / 24);
    this.tone({ type: 'sine', f0: f, dur: 0.14, vol: 0.04, wet: 0.2 });
    this.tone({ type: 'sine', f0: f * 2.76, dur: 0.07, vol: 0.016, wet: 0.2 });
    this.noise({ dur: 0.02, vol: 0.02, type: 'highpass', f0: 7000, f1: 5000, wet: 0 });
  }

  crit() {
    if (!this._gate('crit', 0.09)) return;
    this.noise({ dur: 0.05, vol: 0.07, type: 'highpass', f0: 6000, f1: 2200, wet: 0.1 });
    this.tone({ type: 'square', f0: 1700, f1: 700, dur: 0.06, vol: 0.025, filter: 4000, wet: 0.1 });
  }

  // Kill-streak stinger: a rising arpeggio that grows with the tier.
  combo(tier) {
    if (!this._gate('combo', 0.3)) return;
    const notes = [392, 523, 659, 784, 1046, 1318, 1568];
    const n = Math.min(notes.length, 3 + tier);
    for (let i = 0; i < n; i++) {
      const f = notes[i] * (tier >= 3 ? 1.5 : 1);
      this.tone({ type: 'triangle', f0: f, dur: 0.22, vol: 0.07, delay: i * 0.045, wet: 0.5 });
      this.tone({ type: 'square', f0: f * 2, dur: 0.08, vol: 0.015, filter: 3500, delay: i * 0.045, wet: 0.3 });
    }
    this.noise({ dur: 0.35, vol: 0.06, type: 'bandpass', f0: 400, f1: 4000, q: 2, wet: 0.4 });
    if (tier >= 2) this.tone({ type: 'sine', f0: 120, f1: 45, dur: 0.5, vol: 0.18 });
  }

  leak() {
    if (!this._gate('leak', 0.25)) return;
    this.tone({ type: 'sawtooth', f0: 220, f1: 110, dur: 0.5, vol: 0.18, filter: 900 });
    this.tone({ type: 'sawtooth', f0: 233, f1: 116, dur: 0.5, vol: 0.14, filter: 900 });
  }

  build() { this.noise({ dur: 0.35, vol: 0.2, type: 'lowpass', f0: 600, f1: 80 }); this.tone({ type: 'triangle', f0: 330, f1: 660, dur: 0.25, vol: 0.12, wet: 0.4 }); }
  upgrade() { [523, 659, 784, 1046].forEach((f, i) => this.tone({ type: 'triangle', f0: f, dur: 0.3, vol: 0.08, delay: i * 0.06, wet: 0.5 })); }
  sell() { [880, 660].forEach((f, i) => this.tone({ type: 'square', f0: f, dur: 0.1, vol: 0.05, filter: 3000, delay: i * 0.07 })); }
  levelUp() { if (!this._gate('lvl', 0.15)) return; [784, 988, 1175].forEach((f, i) => this.tone({ type: 'sine', f0: f, dur: 0.35, vol: 0.06, delay: i * 0.05, wet: 0.6 })); }
  research() { [392, 494, 587, 784].forEach((f, i) => this.tone({ type: 'sine', f0: f, dur: 0.6, vol: 0.07, delay: i * 0.08, wet: 0.7 })); }
  item(rarity) {
    const notes = { common: [660, 880], uncommon: [660, 880, 1100], rare: [523, 784, 1046, 1318], unique: [523, 659, 784, 1046, 1318, 1568] }[rarity];
    notes.forEach((f, i) => this.tone({ type: 'triangle', f0: f, dur: 0.4, vol: 0.07, delay: i * 0.07, wet: 0.6 }));
  }
  thunder() { if (!this._gate('thunder', 0.15)) return; this.noise({ dur: 0.9, vol: 0.3, type: 'lowpass', f0: 2500, f1: 90, wet: 0.5 }); }
  boom() { this.tone({ type: 'sine', f0: 90, f1: 30, dur: 1.1, vol: 0.5 }); this.noise({ dur: 1.0, vol: 0.4, type: 'lowpass', f0: 1800, f1: 60, wet: 0.5 }); }
  meteorFall() { this.noise({ dur: 0.9, vol: 0.12, type: 'bandpass', f0: 600, f1: 2400, q: 3 }); }
  nova(kind) {
    if (!this._gate('nova', 0.2)) return;
    if (kind === 'void') this.tone({ type: 'sawtooth', f0: 80, f1: 300, dur: 0.6, vol: 0.12, filter: 800 });
    else if (kind === 'roots') { this.noise({ dur: 0.6, vol: 0.25, type: 'lowpass', f0: 500, f1: 80 }); }
    else this.tone({ type: 'sine', f0: 1200, f1: 400, dur: 0.6, vol: 0.1, wet: 0.7 });
  }
  shieldBreak() { this.tone({ type: 'triangle', f0: 2400, f1: 600, dur: 0.3, vol: 0.1, wet: 0.5 }); this.noise({ dur: 0.25, vol: 0.12, type: 'highpass', f0: 5000, f1: 2000 }); }
  waveHorn(challenge) {
    const base = challenge ? 196 : 147;
    this.tone({ type: 'sawtooth', f0: base, f1: base, dur: 1.4, vol: 0.12, attack: 0.15, filter: 900, wet: 0.6 });
    this.tone({ type: 'sawtooth', f0: base * 1.5, f1: base * 1.5, dur: 1.2, vol: 0.07, attack: 0.2, filter: 1100, wet: 0.6, delay: 0.1 });
  }
  bossHorn() {
    this.tone({ type: 'sawtooth', f0: 73, f1: 65, dur: 2.4, vol: 0.22, attack: 0.3, filter: 500, wet: 0.7 });
    this.tone({ type: 'sawtooth', f0: 110, f1: 98, dur: 2.2, vol: 0.12, attack: 0.3, filter: 700, wet: 0.7 });
    this.noise({ dur: 1.5, vol: 0.12, type: 'lowpass', f0: 300, f1: 60, attack: 0.3 });
  }
  cast(kind) {
    if (!this._gate('cast', 0.12)) return;
    const f = { fire: 300, frost: 1400, storm: 900, nature: 500, shadow: 220, holy: 1200, iron: 400, blood: 260 }[kind] || 800;
    this.tone({ type: 'sine', f0: f, f1: f * 1.6, dur: 0.35, vol: 0.08, wet: 0.7 });
    this.tone({ type: 'triangle', f0: f * 1.5, f1: f * 2.2, dur: 0.3, vol: 0.05, wet: 0.7, delay: 0.05 });
  }
  click() { this.tone({ type: 'triangle', f0: 1200, f1: 900, dur: 0.04, vol: 0.05, wet: 0 }); }
  error() { this.tone({ type: 'square', f0: 180, f1: 140, dur: 0.15, vol: 0.06, filter: 1200, wet: 0 }); }
  victory() { [523, 659, 784, 1046, 784, 1046, 1318].forEach((f, i) => this.tone({ type: 'triangle', f0: f, dur: 0.6, vol: 0.1, delay: i * 0.14, wet: 0.7 })); }
  defeat() { [392, 349, 311, 262].forEach((f, i) => this.tone({ type: 'sawtooth', f0: f, dur: 0.9, vol: 0.08, filter: 900, delay: i * 0.35, wet: 0.7 })); }

  // ---------------------------------------------------------------- music playlist

  // Licensed tracks (see docs/music-credits.md), cross-faded by game mood:
  // calm in menus and between waves, battle while creeps march, boss when one is alive.
  _startMusic() {
    this.decks = [new window.Audio(), new window.Audio()];
    for (const d of this.decks) { d.preload = 'auto'; d.volume = 0; d.addEventListener('ended', () => this._next()); }
    this.active = 0;
    this.mood = null;
    this.wantMood = 'calm';
    this.moodSince = 0;
    this.lastByMood = {};
    this.fade = null;
    this._play('calm');
    this.musicTimer = setInterval(() => this._tickMusic(0.1), 100);
  }

  _pick(mood) {
    const list = MUSIC_TRACKS.filter((t) => t.mood === mood);
    const options = list.length > 1 ? list.filter((t) => t.id !== this.lastByMood[mood]) : list;
    const track = options[Math.floor(Math.random() * options.length)];
    this.lastByMood[mood] = track.id;
    return track;
  }

  _play(mood) {
    const track = this._pick(mood);
    const from = this.decks[this.active];
    this.active = 1 - this.active;
    const to = this.decks[this.active];
    to.src = track.file;
    to.currentTime = 0;
    to.volume = 0;
    to.play().catch(() => {});
    this.mood = mood;
    this.nowPlaying = track;
    this.fade = { from, to, t: 0, dur: 2.5 };
  }

  _next() { this._play(this.mood || 'calm'); }

  _tickMusic(dt) {
    // Switch mood only after it has held for a moment, so short lulls don't thrash tracks.
    this.moodSince += dt;
    const hold = this.wantMood === 'calm' ? 8 : this.wantMood === 'boss' ? 0.5 : 3;
    if (this.wantMood !== this.mood && this.moodSince >= hold) this._play(this.wantMood);
    const vol = this.musicVol;
    if (this.fade) {
      const f = this.fade;
      f.t += dt;
      const k = Math.min(1, f.t / f.dur);
      f.to.volume = vol * k;
      if (f.from !== f.to) f.from.volume = vol * (1 - k) * (f.from.paused ? 0 : 1);
      if (k >= 1) { f.from.pause(); this.fade = null; }
    } else {
      this.decks[this.active].volume = vol;
    }
  }

  setMood(mood) {
    if (mood !== this.wantMood) { this.wantMood = mood; this.moodSince = 0; }
  }
}

