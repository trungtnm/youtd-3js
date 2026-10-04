// three.js view of the simulation: renderer, post-processing, RTS camera, picking,
// and per-frame sync of towers, creeps, projectiles and effects.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

import { buildEnvironment, updateEnvironment, SUN_DIR } from './environment.js';
import { buildTowerModel, buildCrest, buildCreepModel, preloadCreepModels, RACE_COLORS } from './models.js';
import { FX } from './fx.js';
import { TOWER_MAX_LEVEL, ELEMENTS, RARITIES } from '../data/constants.js';
import { worldToTile, tileToWorld, isBuildable, PORTAL, MAP_W, MAP_D } from '../sim/map-layout.js';
import { mulberry32 } from '../sim/rng.js';

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uFlash: { value: 0 }, uTime: { value: 0 }, uLow: { value: 0 }, uWhite: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uFlash; uniform float uTime; uniform float uLow; uniform float uWhite; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = vUv - 0.5;
      float v = smoothstep(0.85, 0.25, length(d * vec2(1.0, 0.8)));
      c.rgb *= mix(0.55, 1.0, v);
      // Dusk split-tone: violet in the shadows, amber in the highlights, a touch more contrast.
      float lum = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb += mix(vec3(0.012, 0.0, 0.022), vec3(0.035, 0.012, -0.025), smoothstep(0.15, 0.7, lum));
      c.rgb = mix(vec3(lum), c.rgb, 1.08);
      c.rgb = (c.rgb - 0.5) * 1.06 + 0.5;
      float edge = smoothstep(0.35, 0.75, length(d));
      float danger = uFlash + uLow * (0.25 + 0.15 * sin(uTime * 4.0));
      c.rgb = mix(c.rgb, vec3(0.9, 0.05, 0.05), edge * danger * 0.6);
      // Big-kill flash: brightest at the centre, fading toward the edges.
      c.rgb = mix(c.rgb, vec3(1.0, 0.96, 0.88), uWhite * 0.22 * (1.0 - edge * 0.6));
      gl_FragColor = c;
    }`,
};

// Kill-streak tiers: kills needed inside the rolling window, and the callout text.
const STREAKS = [
  { n: 4, name: 'Cleave' },
  { n: 7, name: 'Carnage' },
  { n: 11, name: 'Massacre' },
  { n: 16, name: 'Slaughter' },
  { n: 24, name: 'Extinction' },
];

const easeOutBack = (k) => 1 + 2.70158 * Math.pow(k - 1, 3) + 1.70158 * Math.pow(k - 1, 2);

export class World {
  constructor(container, overlay) {
    this.container = container;
    this.overlay = overlay;
    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    // 1.5x is visually close to native on retina screens at roughly half the pixel cost.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    // Warm dusk haze: mountains fade into rose, the field stays clear.
    scene.fog = new THREE.FogExp2(0x5c3e3c, 0.0042);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.35;
    this.scene = scene;

    this.camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.5, 1200);

    // Lighting: a low sunset sun behind the field, violet sky fill, and a cool
    // front fill so faces turned toward the camera stay readable.
    const sun = new THREE.DirectionalLight(0xffb070, 3.6);
    sun.position.copy(SUN_DIR).multiplyScalar(80);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const sc = sun.shadow.camera;
    // Tight frustum around the compact playfield keeps 1024px shadows crisp.
    // The low sun stretches the field in light space, so the frustum is taller than the map.
    sc.left = -40; sc.right = 40; sc.top = 34; sc.bottom = -34; sc.near = 10; sc.far = 190;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    scene.add(sun);
    scene.add(new THREE.HemisphereLight(0xc8b0a8, 0x3a2a1e, 0.8));
    const rim = new THREE.DirectionalLight(0x8a98d0, 0.7);
    rim.position.set(-20, 35, 50);
    scene.add(rim);
    this.sun = sun;

    this.env = buildEnvironment(scene, mulberry32(1337));

    this.fx = new FX(scene, this.camera, overlay);

    // Post-processing
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.75, 0.55, 0.82);
    // Bloom is blurry by nature: run it at half resolution.
    const bloomSetSize = this.bloom.setSize.bind(this.bloom);
    this.bloom.setSize = (w, h) => bloomSetSize(Math.round(w / 2), Math.round(h / 2));
    composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    composer.addPass(this.grade);
    // On high-DPI screens the extra pixels already smooth edges; skip SMAA there.
    this.smaa = new SMAAPass();
    this.smaa.enabled = window.devicePixelRatio < 1.5;
    composer.addPass(this.smaa);
    composer.addPass(new OutputPass());
    this.composer = composer;

    // Selection visuals
    this.rangeRing = this._ring(0x9fe8ff, 0.5);
    this.auraRing = this._ring(0xffd34a, 0.35);
    this.hoverRing = this._ring(0xffffff, 0.25);
    this.selectMarker = new THREE.Mesh(new THREE.RingGeometry(1.15, 1.35, 6), new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.selectMarker.rotation.x = -Math.PI / 2;
    this.selectMarker.visible = false;
    scene.add(this.selectMarker);
    this.ghost = null;
    this.ghostId = null;

    this.unseenMat = new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending });
    this.hoverMarker = new THREE.Mesh(new THREE.RingGeometry(1.15, 1.3, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.hoverMarker.rotation.x = -Math.PI / 2;
    this.hoverMarker.visible = false;
    scene.add(this.hoverMarker);
    this.towerViews = new Map();
    this.creepViews = new Map();
    preloadCreepModels();
    this.dying = [];
    // Hit flash: creep meshes swap to this shared material for a few frames.
    this.flashMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.5, 1.4) });
    this.hitStop = 0;
    this.killTimes = [];
    this.streak = { tier: -1, last: -10 };

    // Camera rig
    this.cam = { x: 0, z: 2, yaw: 0, dist: 74, tx: 0, tz: 2, tyaw: 0, tdist: 74, menu: true };
    this.keys = new Set();
    this.mouse = { x: 0, y: 0, inside: false, ndc: new THREE.Vector2() };
    this.raycaster = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.edgeScroll = true;
    this._bindInput();
    window.addEventListener('resize', () => this.resize());
    this.time = 0;
  }

  _ring(color, opacity) {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 96), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: opacity * 0.12, depthWrite: false }));
    ring.rotation.x = disc.rotation.x = -Math.PI / 2;
    g.add(ring, disc);
    g.position.y = 0.12;
    g.visible = false;
    this.scene.add(g);
    return g;
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }

  // ---------------------------------------------------------------- input

  _bindInput() {
    const el = this.renderer.domElement;
    window.addEventListener('keydown', (e) => { if (!e.target.closest('input')) this.keys.add(e.key.toLowerCase()); });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (this.cam.menu) return;
      // Trackpads send many small deltas, mouse wheels a few large ones; normalise both.
      const delta = Math.max(-1, Math.min(1, e.deltaY / 120));
      const before = this.cam.tdist;
      this.cam.tdist = Math.max(20, Math.min(80, before * Math.exp(delta * 0.14)));
      // Zoom toward the point under the cursor.
      const g = this.pickGround();
      if (g) {
        const k = 1 - this.cam.tdist / before;
        this.cam.tx += (g.x - this.cam.tx) * k * 0.8;
        this.cam.tz += (g.z - this.cam.tz) * k * 0.8;
        this._clamp();
      }
    }, { passive: false });
    let drag = null;
    const setMouse = (e) => {
      this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.inside = true;
      this.mouse.ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    };
    el.addEventListener('pointerdown', (e) => {
      if (e.button > 2) return;
      setMouse(e);
      // Left and right drag pan the map; middle drag rotates.
      drag = { b: e.button, x: e.clientX, y: e.clientY, moved: 0, grab: e.button === 1 ? null : this.pickGround() };
    });
    window.addEventListener('pointermove', (e) => {
      setMouse(e);
      if (!drag) return;
      const dx = e.clientX - drag.x;
      drag.moved += Math.abs(dx) + Math.abs(e.clientY - drag.y);
      drag.x = e.clientX; drag.y = e.clientY;
      if (this.cam.menu) return;
      if (drag.b === 1) { this.cam.tyaw -= dx * 0.006; return; }
      // A left click with a few pixels of jitter must still select or build, not pan.
      if (drag.b === 0 && drag.moved <= 6) return;
      this.dragging = true;
      // Grab-pan: keep the ground point under the cursor pinned, with no lag.
      const g = this.pickGround();
      if (drag.grab && g) {
        const ox = drag.grab.x - g.x, oz = drag.grab.z - g.z;
        this.cam.tx += ox; this.cam.tz += oz; this.cam.x += ox; this.cam.z += oz;
        this._clamp(true);
        this.cam.vx = this.cam.vz = 0;
      }
    });
    window.addEventListener('pointerup', (e) => { if (drag && drag.b === e.button) { this.lastDragMoved = drag.moved; drag = null; this.dragging = false; } });
    // `document` never receives mouseleave; without this the last edge position
    // keeps scrolling after the cursor leaves the window.
    document.documentElement.addEventListener('mouseleave', () => { this.mouse.inside = false; });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _clamp(both) {
    const c = this.cam;
    const bx = MAP_W / 2 + 6, bz = MAP_D / 2 + 6;
    c.tx = Math.max(-bx, Math.min(bx, c.tx));
    c.tz = Math.max(-bz, Math.min(bz, c.tz));
    if (both) { c.x = Math.max(-bx, Math.min(bx, c.x)); c.z = Math.max(-bz, Math.min(bz, c.z)); }
  }

  focus(x, z) { this.cam.tx = x; this.cam.tz = z; this._clamp(); }

  // dt here is real time, independent of game speed or pause.
  _updateCamera(dt) {
    const c = this.cam;
    c.vx ??= 0; c.vz ??= 0; c.vyaw ??= 0;
    if (c.menu) {
      c.tyaw += dt * 0.05;
      c.tdist = 64;
    } else {
      const k = this.keys;
      // Panning is mouse-only: edge scrolling here, drag-pan in the pointer handlers.
      let px = 0, pz = 0;
      if (this.edgeScroll && this.mouse.inside && !this.dragging && document.hasFocus()) {
        const m = 10;
        px = (this.mouse.x < m ? -1 : 0) + (this.mouse.x > window.innerWidth - m ? 1 : 0);
        pz = (this.mouse.y < m ? -1 : 0) + (this.mouse.y > window.innerHeight - m ? 1 : 0);
      }
      const len = Math.hypot(px, pz) || 1;
      const maxSpeed = c.dist * 1.1;
      // Accelerate toward the desired velocity, then glide to a stop.
      const accel = 1 - Math.exp(-dt * ((px || pz) ? 9 : 6));
      const ws = Math.cos(c.tyaw), wn = Math.sin(c.tyaw);
      const wx = (px * ws + pz * wn) / len * maxSpeed, wz = (-px * wn + pz * ws) / len * maxSpeed;
      c.vx += (wx - c.vx) * accel;
      c.vz += (wz - c.vz) * accel;
      c.tx += c.vx * dt; c.tz += c.vz * dt;
      const ox = c.tx, oz = c.tz;
      this._clamp();
      // Drop momentum into a wall so reversing away from it responds at once.
      if (c.tx !== ox) c.vx = 0;
      if (c.tz !== oz) c.vz = 0;
      const wantYaw = (k.has('q') ? 1 : 0) - (k.has('e') ? 1 : 0);
      c.vyaw += (wantYaw * 1.6 - c.vyaw) * (1 - Math.exp(-dt * 8));
      c.tyaw += c.vyaw * dt;
    }
    const fp = 1 - Math.exp(-dt * 14), fz = 1 - Math.exp(-dt * 9), fy = 1 - Math.exp(-dt * 10);
    c.x += (c.tx - c.x) * fp; c.z += (c.tz - c.z) * fp;
    c.yaw += (c.tyaw - c.yaw) * fy; c.dist += (c.tdist - c.dist) * fz;
    const t = Math.max(0, Math.min(1, (c.dist - 20) / 52));
    const pitch = 0.58 + t * 0.42;
    const cx = c.x + Math.sin(c.yaw) * Math.cos(pitch) * c.dist;
    const cz = c.z + Math.cos(c.yaw) * Math.cos(pitch) * c.dist;
    // Punch-zoom on big kills: a quick dolly toward the target that eases back.
    const punch = 1 - this.fx.punch * this.fx.punch * 0.06;
    const cx2 = c.x + (cx - c.x) * punch, cz2 = c.z + (cz - c.z) * punch;
    const cy = Math.sin(pitch) * c.dist * punch;
    // Smooth, decaying shake instead of per-frame random jitter.
    const sh = this.fx.shake, T = this.realTime = (this.realTime || 0) + dt;
    this.camera.position.set(cx2 + Math.sin(T * 47) * sh * 0.5, cy + Math.sin(T * 61 + 1) * sh * 0.4, cz2 + Math.sin(T * 53 + 2) * sh * 0.5);
    this.camera.lookAt(c.x, 0, c.z);
  }

  // ---------------------------------------------------------------- picking

  pickGround() {
    this.raycaster.setFromCamera(this.mouse.ndc, this.camera);
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, p)) return null;
    return { x: p.x, z: p.z, ...worldToTile(p.x, p.z) };
  }

  // Creeps win when the ray hits them. Towers are resolved in screen space so a
  // tall tower in front never steals clicks meant for the tower behind it:
  // a click on a tower's base tile selects it, otherwise the tower whose
  // on-screen silhouette (base-to-top segment) is nearest the cursor wins.
  pickUnit() {
    this.raycaster.setFromCamera(this.mouse.ndc, this.camera);
    const creepHits = this.raycaster.intersectObjects([...this.creepViews.values()].map((v) => v.hit), false);
    if (creepHits.length) return creepHits[0].object.userData.pick;
    return this.pickTower();
  }

  pickTower() {
    if (!this.game) return null;
    const g = this.pickGround();
    if (g) {
      const t = this.game.towerGrid.get(`${g.c},${g.r}`);
      if (t) return { type: 'tower', uid: t.uid };
    }
    const mx = this.mouse.x, my = this.mouse.y;
    let best = null, bestD = 34;
    for (const [uid, v] of this.towerViews) {
      const t = this.game.towers.get(uid);
      if (!t) continue;
      const a = this.toScreen(t.x, 0.3, t.z), b = this.toScreen(t.x, v.muzzleY + 0.4, t.z);
      if (a.behind) continue;
      const abx = b.x - a.x, aby = b.y - a.y;
      const k = Math.max(0, Math.min(1, ((mx - a.x) * abx + (my - a.y) * aby) / (abx * abx + aby * aby || 1)));
      const d = Math.hypot(mx - (a.x + abx * k), my - (a.y + aby * k));
      // Slight bias toward the tower further from the camera, whose body is
      // the part drawn above the nearer tower.
      const score = d - (1 - k) * 2;
      if (score < bestD) { bestD = score; best = uid; }
    }
    return best ? { type: 'tower', uid: best } : null;
  }

  // ---------------------------------------------------------------- game binding

  bind(game, audio) {
    this.game = game;
    this.audio = audio;
    const fx = this.fx;
    const H = (c) => (c.air ? 2.6 : 1);
    game.on('attack', ({ tower, target, kind }) => {
      const v = this.towerViews.get(tower.uid);
      if (v) { v.recoil = 1; v.anim.playAttack?.(); }
      if (kind === 'lightning') {
        const top = { x: tower.x, y: v ? v.muzzleY : 2.5, z: tower.z };
        fx.lightning([top, { x: target.x, y: H(target), z: target.z }], ELEMENTS[tower.def.element].color);
      }
      audio?.shot(tower.def.attack, tower.def.projectile);
    });
    game.on('impact', (p) => fx.impact(p));
    game.on('chain', ({ tower, points }) => fx.lightning(points.map((p) => ({ ...p, y: 1.1 })), ELEMENTS[tower.def.element].color, 0.05));
    game.on('splash', ({ tower, x, z, radius }) => fx.ring(x, z, radius, ELEMENTS[tower.def.element].color, 0.35, 0.2, 0.6));
    game.on('strike', ({ x, z }) => { fx.strike(x, z); audio?.thunder(); });
    game.on('nova', ({ tower, radius, fx: kind }) => { fx.nova(tower.x, tower.z, radius, kind); audio?.nova(kind); });
    game.on('meteorCast', ({ x, z, delay, radius }) => { fx.meteorCast(x, z, delay, radius); audio?.meteorFall(); });
    game.on('meteorImpact', ({ x, z, radius }) => { fx.meteorImpact(x, z, radius); audio?.boom(); });
    game.on('damageText', ({ x, z, amount, crit, spell }) => {
      fx.text(x, 2.2, z, `${fmt(amount)}${crit ? '!' : ''}`, crit ? 'crit' : spell ? 'spell' : 'dmg');
      if (crit) {
        // Rate-limited so crit-heavy builds don't turn into constant camera noise.
        const now = this.realTime || 0;
        if (now - (this.lastCritPunch || -1) > 0.3) {
          this.lastCritPunch = now;
          fx.punch = Math.max(fx.punch, 0.3);
          fx.shake = Math.max(fx.shake, 0.06);
        }
        audio?.crit();
      }
    });
    fx.onCoinArrive = () => {
      audio?.coin();
      // Bump the HUD gold counter when coins land (runtime style only).
      const el = document.getElementById('r-gold');
      const now = this.realTime || 0;
      if (el?.animate && now - (this.lastGoldBump || -1) > 0.12) {
        this.lastGoldBump = now;
        el.animate([{ transform: 'scale(1.35)', filter: 'brightness(1.8)' }, { transform: 'scale(1)', filter: 'none' }], { duration: 220, easing: 'ease-out' });
      }
    };
    game.on('creepDied', ({ creep, bounty }) => {
      const big = creep.size === 'boss' || creep.size === 'challenge';
      fx.death(creep, RACE_COLORS[creep.race]);
      fx.text(creep.x, 2.6, creep.z, `+${bounty}`, 'gold');
      fx.coins(creep.x, H(creep), creep.z, big ? 10 : creep.size === 'champion' ? 3 : bounty >= 20 ? 2 : 1);
      const v = this.creepViews.get(creep.uid);
      if (v) {
        this.creepViews.delete(creep.uid);
        v.flash = 0.09;
        this.dying.push({ v, t: 0, rate: big ? 0.45 : 1 });
      }
      if (big) this.hitStop = Math.max(this.hitStop, 0.12);
      audio?.death(creep.size, creep.race);
      this._countKill();
    });
    game.on('creepLeaked', (c) => {
      const v = this.creepViews.get(c.uid);
      if (v) { this.scene.remove(v.group); this.creepViews.delete(c.uid); }
      if (c.size !== 'challenge' && c.size !== 'challengeMass') {
        this.grade.uniforms.uFlash.value = 1;
        fx.shake = Math.max(fx.shake, 0.35);
        this.nexusHit = 1;
        audio?.leak();
      }
      fx.burst(PORTAL.x + 1.5, 3.6, PORTAL.z, 0xff3a3a, 30, 6, 0.8, 0.35, 4);
    });
    game.on('towerBuilt', (t) => { this._addTower(t, true); fx.buildDust(t.x, t.z, ELEMENTS[t.def.element].color); audio?.build(); });
    game.on('towerUpgraded', (t) => {
      this._removeTower(t.uid);
      this._addTower(t, true);
      fx.levelUp(t);
      fx.buildDust(t.x, t.z, RARITIES[t.def.rarity].color);
      audio?.upgrade();
    });
    game.on('towerSold', ({ tower, refund }) => {
      this._removeTower(tower.uid);
      fx.puff(tower.x, 0.5, tower.z, 0x8a7a64, 16, 0.9, 1);
      fx.text(tower.x, 2, tower.z, `+${refund}`, 'gold');
      audio?.sell();
    });
    // Teleported towers (Chrono Jumper) keep their tile; only the body moves.
    game.on('towerMoved', (t) => {
      const v = this.towerViews.get(t.uid);
      if (v) v.group.position.set(t.x, 0, t.z);
      fx.puff(t.x, 0.5, t.z, 0x8fb8ff, 16, 0.9, 1);
    });
    game.on('levelUp', (t) => { fx.levelUp(t); fx.text(t.x, 3.5, t.z, `Level ${t.level}`, 'level'); audio?.levelUp(); });
    game.on('itemDrop', ({ x, z, rarity, item }) => {
      fx.beacon(x, z, RARITIES[rarity].color);
      fx.text(x, 3, z, 'Item!', `item r-${rarity}`);
      audio?.item(rarity);
    });
    game.on('tomeDrop', ({ x, z }) => { fx.text(x, 3, z, '+1 Tome', 'tome'); fx.burst(x, 1.5, z, 0x6fb8ff, 14, 3, 0.8, 0.25, 0); });
    game.on('stun', (c) => fx.burst(c.x, H(c) + 1, c.z, 0xffffff, 5, 2, 0.4, 0.15, 0));
    game.on('execute', (c) => { fx.text(c.x, 2.6, c.z, 'REAPED', 'crit'); fx.burst(c.x, 1, c.z, 0xff3f6a, 20, 5, 0.6, 0.3, 4); });
    game.on('miss', (c) => fx.text(c.x, 2.4, c.z, 'miss', 'miss'));
    game.on('immune', (c) => { if (Math.random() < 0.2) fx.text(c.x, 2.4, c.z, 'immune', 'miss'); });
    game.on('shieldBreak', (c) => { fx.burst(c.x, H(c), c.z, 0x8fd0ff, 24, 5, 0.5, 0.3, 4); audio?.shieldBreak(); });
    game.on('blink', ({ creep, from }) => fx.blink(from, creep));
    game.on('bossSpawned', () => audio?.bossHorn());
    game.on('waveStart', (w) => audio?.waveHorn(w.challenge));
    game.on('research', () => audio?.research());
    // Ability engine visuals
    const SPELL_COLORS = { arcane: 0x8fb8ff, fire: 0xff7a1a, frost: 0x9fe8ff, storm: 0xc8a8ff, nature: 0x8fe04a, shadow: 0xc04dff, holy: 0xfff2a0, iron: 0xffc070, blood: 0xff3f5a, gold: 0xffd34a };
    const col = (k) => SPELL_COLORS[k] || 0xffffff;
    game.on('cast', ({ tower, active }) => {
      fx.ring(tower.x, tower.z, 1.8, col(active.effect.fx), 0.5, 0.25);
      fx.text(tower.x, 4, tower.z, active.name, 'cast');
      audio?.cast(active.effect.fx);
    });
    game.on('spellFx', ({ kind, x, z, radius, quiet }) => {
      fx.ring(x, z, radius, col(kind), 0.45, 0.2, quiet ? 0.5 : 1);
      if (!quiet) fx.flashDisc(x, z, radius * 0.9, col(kind), 0.3);
      fx.burst(x, 1, z, col(kind), quiet ? 6 : 18, 4, 0.5, 0.28, 3);
    });
    game.on('spellChain', ({ points, fx: kind }) => fx.lightning(points.map((p) => ({ ...p, y: p.y ?? 1.1 })), col(kind), 0.07));
    game.on('zoneFx', ({ kind, x, z, radius, dur }) => fx.zone(x, z, radius, col(kind), dur));
    game.on('buffFx', ({ tower, kind }) => {
      fx.ring(tower.x, tower.z, 1.4, col(kind === 'mana' ? 'arcane' : kind), 0.6, 0.3);
      fx.burst(tower.x, 1.5, tower.z, col(kind === 'mana' ? 'arcane' : kind), 12, 2, 0.8, 0.22, -1);
    });
    game.on('proc', ({ name, x, z, fx: kind }) => { fx.text(x, 3.2, z, name, 'proc'); fx.burst(x, 1.2, z, col(kind), 8, 3, 0.4, 0.22, 2); });
    game.on('goldFx', ({ x, z, amount }) => fx.text(x, 3, z, `+${amount}`, 'gold'));
  }

  // Kill streaks: several kills inside a short window trigger a callout. Each tier
  // shows once per streak; the streak ends after a lull.
  _countKill() {
    const now = this.fx.time;
    const kt = this.killTimes;
    kt.push(now);
    while (kt.length && now - kt[0] > 1.2) kt.shift();
    const st = this.streak;
    if (now - st.last > 2) st.tier = -1;
    st.last = now;
    let tier = -1;
    for (let i = 0; i < STREAKS.length; i++) if (kt.length >= STREAKS[i].n) tier = i;
    if (tier <= st.tier) return;
    st.tier = tier;
    this.fx.callout(STREAKS[tier].name, `${kt.length} kills`, tier);
    this.audio?.combo(tier);
    this.fx.punch = Math.max(this.fx.punch, 0.4 + tier * 0.12);
    if (tier >= 2) this.hitStop = Math.max(this.hitStop, 0.07);
  }

  _addTower(t, animate) {
    const group = buildTowerModel(t.def);
    group.position.set(t.x, 0, t.z);
    // Invisible picking cylinder
    // Picking cylinder covers the whole tower, which can be twice as tall for costly ones.
    const hitH = Math.max(2.6, group.userData.height || 0);
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, hitH, 8), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = hitH / 2;
    hit.userData.pick = { type: 'tower', uid: t.uid };
    group.add(hit);
    this.scene.add(group);
    const view = { group, hit, anim: group.userData.anim, muzzleY: group.userData.muzzleY, born: animate ? 0 : 1, recoil: 0, yaw: t.aim || 0, beamCd: 0 };
    group.addEventListener('modelswap', () => { view.muzzleY = group.userData.muzzleY; });
    this.towerViews.set(t.uid, view);
  }

  // Towers at the level cap wear the player's crest (null when none is unlocked).
  // Checked every frame, so level ups, upgrades and crest changes all apply.
  _syncCrest(t, v, dt, T) {
    const want = t.level >= TOWER_MAX_LEVEL ? this.crest : null;
    if (v.crestStyle !== want) {
      if (v.crest) v.group.remove(v.crest);
      v.crest = want ? buildCrest(want) : null;
      v.crestStyle = want;
      if (v.crest) { v.crest.position.y = v.muzzleY + 1.3; v.group.add(v.crest); }
    }
    if (!v.crest) return;
    v.crest.rotation.y += dt * 0.8;
    v.crest.position.y = v.muzzleY + 1.3 + Math.sin(T * 1.6 + t.uid) * 0.08;
    for (const s of v.crest.userData.spin) s.obj.rotation[s.axis] += s.speed * dt;
    for (const f of v.crest.userData.flicker) f.scale.setScalar(1 + Math.sin(T * 11 + t.uid) * 0.06);
  }

  _removeTower(uid) {
    const v = this.towerViews.get(uid);
    if (!v) return;
    this.scene.remove(v.group);
    v.hit.geometry.dispose();
    this.towerViews.delete(uid);
  }

  _addCreep(c) {
    const group = buildCreepModel(c);
    const h = group.userData.height;
    // Health bar billboard
    const bar = new THREE.Group();
    const w = c.size === 'boss' || c.size === 'challenge' ? 3.4 : c.size === 'champion' ? 2.0 : c.size === 'mass' ? 1.2 : 1.6;
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.1, 0.26), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.7, depthTest: false }));
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.18), new THREE.MeshBasicMaterial({ color: 0x5aff5a, transparent: true, depthTest: false }));
    const shield = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.06), new THREE.MeshBasicMaterial({ color: 0x8fd8ff, transparent: true, depthTest: false }));
    fill.geometry.translate(w / 2, 0, 0); fill.position.x = -w / 2;
    shield.geometry.translate(w / 2, 0, 0); shield.position.set(-w / 2, 0.1, 0);
    shield.visible = c.maxShield > 0;
    bg.renderOrder = 20; fill.renderOrder = 21; shield.renderOrder = 22;
    bar.add(bg, fill, shield);
    bar.position.y = h + 0.5;
    group.add(bar);
    const hit = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.8, h * 0.45), 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = c.air ? 2.6 : h * 0.5;
    hit.userData.pick = { type: 'creep', uid: c.uid };
    group.add(hit);
    group.position.set(c.x, 0, c.z);
    this.scene.add(group);
    const inner = group.userData.inner;
    const meshes = [];
    const collect = () => { meshes.length = 0; inner.traverse((o) => { if (o.isMesh) meshes.push({ o, base: o.material }); }); };
    collect();
    const v = {
      group, bar, fill, shield, hit, anim: group.userData.anim, inner, meshes, look: null,
      baseScale: inner.scale.x, air: c.air, weight: c.size === 'boss' || c.size === 'challenge' ? 0.35 : c.size === 'champion' ? 0.7 : 1,
      phase: Math.random() * 6, lastHp: c.hp + c.shield, dmgAcc: 0, hitCd: 0, flash: 0, squash: 0, yaw: Math.atan2(c.dx, c.dz),
    };
    // A curated model that finishes loading late replaces the meshes the hit flash and shimmer swap.
    group.addEventListener('modelswap', () => { collect(); v.look = undefined; this._look(v); if (v.unseen) this._setUnseen(v, true); });
    this.creepViews.set(c.uid, v);
    return v;
  }

  // Unrevealed invisible creeps render as a faint shimmer with no health bar.
  _setUnseen(v, unseen) {
    v.unseen = unseen;
    for (const e of v.meshes) e.o.castShadow = !unseen;
    v.bar.visible = !unseen;
    this._look(v);
  }

  // Pick the material set for a creep: shimmer when unseen, white during a hit flash.
  _look(v) {
    const m = v.unseen ? this.unseenMat : v.flash > 0 ? this.flashMat : null;
    if (m === v.look) return;
    v.look = m;
    for (const e of v.meshes) e.o.material = m || e.base;
  }

  _ringColor(ring, color) { for (const m of ring.children) m.material.color.set(color); }

  setHover(sel) {
    const t = sel?.type === 'tower' && this.game?.towers.get(sel.uid);
    this.hoverMarker.visible = !!t;
    if (t) this.hoverMarker.position.set(t.x, 0.16, t.z);
    this.renderer.domElement.style.cursor = sel ? 'pointer' : '';
  }

  // ---------------------------------------------------------------- placement preview

  setGhost(towerDef) {
    if (this.ghost) { this.scene.remove(this.ghost); this.ghost = null; }
    this.ghostId = towerDef ? towerDef.id : null;
    if (!towerDef) {
      // Leaving placement: hide the preview range and reveal rings too.
      this.env.grid.material.uniforms.uShow.value = 0;
      this.hoverRing.visible = false;
      this.auraRing.visible = false;
      this.env.grid.material.uniforms.uHover.value.set(-1, -1);
      return;
    }
    const g = buildTowerModel(towerDef);
    this.ghostMat = new THREE.MeshBasicMaterial({ color: 0x5aff8a, transparent: true, opacity: 0.45, depthWrite: false });
    const ghostify = () => g.traverse((o) => { if (o.isMesh) { o.material = this.ghostMat; o.castShadow = false; } });
    ghostify();
    g.addEventListener('modelswap', ghostify);
    this.ghost = g;
    this.ghostDef = towerDef;
    this.scene.add(g);
    this.env.grid.material.uniforms.uShow.value = 1;
  }

  updateGhost(tile, valid) {
    const u = this.env.grid.material.uniforms;
    if (!this.ghost || !tile) { u.uHover.value.set(-1, -1); if (this.ghost) this.ghost.visible = false; this.hoverRing.visible = false; return; }
    const p = tileToWorld(tile.c, tile.r);
    this.ghost.visible = isBuildable(tile.c, tile.r);
    this.ghost.position.set(p.x, 0, p.z);
    this.ghostMat.color.set(valid ? 0x5aff8a : 0xff4a4a);
    u.uHover.value.set(tile.c, tile.r);
    u.uValid.value = valid ? 1 : 0;
    this.hoverRing.visible = this.ghost.visible;
    this.hoverRing.position.set(p.x, 0.12, p.z);
    this.hoverRing.scale.setScalar(this.ghostDef.range);
    const reveal = this.ghostDef.abilities.find((a) => a.type === 'reveal');
    this.auraRing.visible = !!reveal && this.ghost.visible;
    if (reveal) { this.auraRing.position.set(p.x, 0.13, p.z); this.auraRing.scale.setScalar(reveal.radius); this._ringColor(this.auraRing, 0x7fe0ff); }
  }

  showSelection(sel) {
    this.rangeRing.visible = this.selectMarker.visible = false;
    if (!this.ghost) this.auraRing.visible = false;
    if (!sel || !this.game) return;
    if (sel.type === 'tower') {
      const t = this.game.towers.get(sel.uid);
      if (!t) return;
      this.rangeRing.visible = true;
      this.rangeRing.position.set(t.x, 0.12, t.z);
      this.rangeRing.scale.setScalar(t.stats.range);
      const aura = t.def.abilities.find((a) => a.type === 'reveal' || a.type === 'aura' || a.type === 'creepAura' || a.type === 'nova');
      if (aura && aura.radius !== t.stats.range) {
        this.auraRing.visible = true;
        this._ringColor(this.auraRing, aura.type === 'reveal' ? 0x7fe0ff : 0xffd34a);
        this.auraRing.position.set(t.x, 0.13, t.z);
        this.auraRing.scale.setScalar(aura.radius);
      }
      this.selectMarker.visible = true;
      this.selectMarker.position.set(t.x, 0.15, t.z);
      this.selectMarker.material.color.set(RARITIES[t.def.rarity].color);
    } else if (sel.type === 'creep') {
      const c = this.game.creeps.find((x) => x.uid === sel.uid);
      if (!c) return;
      this.selectMarker.visible = true;
      this.selectMarker.position.set(c.x, c.air ? 0.15 : 0.15, c.z);
      this.selectMarker.material.color.set(0xff6a5a);
    }
  }

  // ---------------------------------------------------------------- frame

  render(dt, sel, realDt = dt) {
    this.time += dt;
    const T = this.time;
    const env = this.env;
    updateEnvironment(env, T);
    const nx = env.nexus.userData;
    nx.crystal.rotation.y += dt * 0.6;
    nx.crystal.position.y = 3.9 + Math.sin(T * 1.3) * 0.2;
    nx.ring1.rotation.x = T * 0.7; nx.ring2.rotation.y = T * 0.5; nx.ring2.rotation.x = 1.2;
    this.nexusHit = Math.max(0, (this.nexusHit || 0) - dt * 2);
    const integrity = this.game ? Math.max(0, this.game.lives) / this.game.maxLives : 1;
    // Amber at full integrity, draining toward a dim red as the portal weakens.
    nx.crystalMat.emissive.setRGB(1.0, 0.25 + 0.3 * integrity + this.nexusHit * 0.5, 0.05 + 0.1 * integrity + this.nexusHit * 0.6);
    nx.crystalMat.emissiveIntensity = 2.0 + this.nexusHit * 4 + (integrity < 0.3 ? Math.sin(T * 8) * 0.8 : 0);
    nx.pillarMat.opacity = 0.08 + 0.05 * Math.sin(T * 2) + this.nexusHit * 0.2;
    this.grade.uniforms.uFlash.value = Math.max(0, this.grade.uniforms.uFlash.value - dt * 2.5);
    this.grade.uniforms.uTime.value = T;
    this.grade.uniforms.uLow.value = integrity < 0.25 && this.game?.phase === 'running' ? 1 : 0;

    this.grade.uniforms.uWhite.value = this.fx.flash;

    // Hit-stop: creep animation and particles nearly freeze for a few frames
    // on big kills. Purely visual; the simulation keeps running.
    let vdt = dt;
    if (this.hitStop > 0) { this.hitStop -= realDt; vdt = dt * 0.06; }
    if (this.game) this._syncGame(vdt, T);
    this.showSelection(sel);
    this._updateCamera(realDt);
    this.fx.update(vdt, window.innerWidth, window.innerHeight, realDt);
    this.composer.render(dt);
  }

  _syncGame(dt, T) {
    const g = this.game;
    // Towers
    for (const t of g.towers.values()) {
      let v = this.towerViews.get(t.uid);
      if (!v) { this._addTower(t, false); v = this.towerViews.get(t.uid); }
      if (v.born < 1) {
        v.born = Math.min(1, v.born + dt * 2.2);
        v.group.scale.setScalar(Math.max(0.01, easeOutBack(v.born)));
      }
      this._syncCrest(t, v, dt, T);
      const A = v.anim;
      A.mixer?.update(dt);
      for (const s of A.spin) s.obj.rotation[s.axis] += s.speed * dt;
      for (const b of A.bob) b.obj.position.y = b.base + Math.sin(T * b.speed + t.uid) * b.amp;
      for (const o of A.orbit) {
        const a = T * o.speed + o.phase;
        o.obj.position.set(Math.cos(a) * o.r, o.y + Math.sin(a) * (o.tilt || 0) * o.r, Math.sin(a) * o.r);
      }
      for (const f of A.flicker) f.scale.y = 1 + Math.sin(T * 13 + f.id) * 0.08 + Math.sin(T * 23 + t.uid) * 0.05;
      for (const f of A.flap) { const a = Math.sin(T * f.speed) * 0.5; f.l.rotation.z = 0.3 + a; f.r.rotation.z = -0.3 - a; }
      for (const p of A.pulse) p.scale.setScalar(1 + Math.max(0, v.recoil) * 0.3);
      if (A.head && A.headYaw) {
        let d = t.aim - v.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        v.yaw += d * Math.min(1, dt * 10);
        A.head.rotation.y = v.yaw;
      }
      if (A.barrels) A.barrels.rotation.z += dt * (v.recoil > 0 ? 25 : 2);
      if (A.press) A.press.position.y = (A.pressBase ??= A.press.position.y) - Math.max(0, v.recoil) * 0.5;
      if (A.hammer) A.hammer.rotation.z = Math.max(0, v.recoil) * -1.2;
      if (A.scythe) A.scythe.rotation.y = -Math.max(0, v.recoil) * 2.5;
      v.recoil = Math.max(0, v.recoil - dt * 5);
      // Sun prism beam
      if (t.beam) {
        const c = g.creeps.find((x) => x.uid === t.beam && x.alive);
        if (c && (v.beamCd -= dt) <= 0) {
          v.beamCd = 0.05;
          this.fx.beam({ x: t.x, y: v.muzzleY, z: t.z }, { x: c.x, y: c.air ? 2.6 : 1, z: c.z }, 0xffc04a, Math.min(2.5, t.beamRamp || 1));
        }
      }
    }
    for (const uid of [...this.towerViews.keys()]) if (!g.towers.has(uid)) this._removeTower(uid);

    // Creeps
    const camQ = this.camera.quaternion;
    for (const c of g.creeps) {
      if (!c.alive) continue;
      let v = this.creepViews.get(c.uid);
      if (!v) v = this._addCreep(c);
      if (c.invisible && v.unseen !== !c.revealed) this._setUnseen(v, !c.revealed);
      // Hit reaction: accumulate lost health+shield; a meaningful chunk triggers
      // a white flash, a squash and a small shove back along the path.
      const hpNow = c.hp + c.shield;
      const lost = v.lastHp - hpNow;
      v.lastHp = hpNow;
      if (lost > 0) v.dmgAcc += lost;
      v.hitCd -= dt;
      if (v.hitCd <= 0 && v.dmgAcc >= c.maxHp * 0.015) {
        const s = Math.min(1, 0.4 + (v.dmgAcc / c.maxHp) * 5);
        v.flash = 0.06;
        v.squash = Math.max(v.squash, s * v.weight);
        v.hitCd = 0.12;
        v.dmgAcc = 0;
        if (!v.unseen) this.fx.hitSpark(c.x, c.air ? 2.6 : 0.9 + (1 - v.weight) * 1.2, c.z, RACE_COLORS[c.race].accent, s);
      }
      v.flash -= dt;
      this._look(v);
      const q = v.squash;
      v.squash = Math.max(0, q - dt * 5);
      const dl = Math.hypot(c.dx, c.dz) || 1;
      const kb = q * q * 0.22;
      v.group.position.x = c.x - (c.dx / dl) * kb; v.group.position.z = c.z - (c.dz / dl) * kb;
      if (q > 0) {
        // Squash, then a little stretch as it recovers.
        const w = q * Math.cos((1 - q) * 4.5);
        const bs = v.baseScale;
        if (v.air) v.inner.scale.setScalar(bs * (1 - 0.12 * w));
        else v.inner.scale.set(bs * (1 + 0.14 * w), bs * (1 - 0.2 * w), bs * (1 + 0.14 * w));
      } else if (v.inner.scale.x !== v.baseScale) v.inner.scale.setScalar(v.baseScale);
      const targetYaw = Math.atan2(c.dx, c.dz);
      let d = targetYaw - v.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      v.yaw += d * Math.min(1, dt * 8);
      v.inner.rotation.y = v.yaw;
      const moving = c.stun <= 0;
      const slow = Math.max(c.slow, c.auraSlow);
      v.phase += dt * (moving ? 9 * (1 - slow * 0.8) : 0);
      const A = v.anim;
      A.mixer?.update(moving ? dt * (1 - slow * 0.8) : 0);
      const sw = Math.sin(v.phase);
      A.legs.forEach((l, i) => { l.rotation.x = (i % 2 ? sw : -sw) * 0.6 * (A.legs.length > 2 && i >= 2 ? -1 : 1); });
      A.arms.forEach((a, i) => { a.rotation.x = (i % 2 ? -sw : sw) * 0.5; });
      for (const s of A.spin) s.obj.rotation[s.axis || 'y'] += s.speed * dt;
      for (const o of A.orbit) { const a = T * o.speed + o.phase; o.obj.position.set(Math.cos(a) * o.r, o.y, Math.sin(a) * o.r); }
      if (A.flap) { const a = Math.sin(T * 10 + c.uid) * 0.6; A.flap.l.rotation.z = a; A.flap.r.rotation.z = -a; }
      if (A.body) A.body.position.y = (A.bodyY ?? 2.6) + Math.sin(T * 3 + c.uid) * 0.15;
      v.inner.position.y = A.float ? 0.2 + Math.sin(T * 2 + c.uid) * 0.15 : Math.abs(Math.sin(v.phase)) * 0.06;
      // Health bar
      const k = Math.max(0, c.hp / c.maxHp);
      v.fill.scale.x = Math.max(0.001, k);
      v.fill.material.color.setHSL(k * 0.33, 0.9, 0.5);
      if (c.maxShield > 0) { v.shield.scale.x = Math.max(0.001, c.shield / c.maxShield); v.shield.visible = c.shield > 0; }
      v.bar.quaternion.copy(camQ);
      // Status particles
      if (slow > 0 && Math.random() < dt * 6) this.fx.burst(c.x, 0.6, c.z, 0x9fe8ff, 1, 1, 0.6, 0.18, -1);
      if (c.dots.length && Math.random() < dt * 8) this.fx.burst(c.x, 1, c.z, 0x9fdc4a, 1, 1, 0.5, 0.15, -2);
      if (c.curse > 0 && Math.random() < dt * 5) this.fx.burst(c.x, 1.6, c.z, 0xc04dff, 1, 0.8, 0.6, 0.18, -1);
      if (c.stun > 0 && Math.random() < dt * 10) this.fx.burst(c.x, (c.air ? 3.2 : 2.0), c.z, 0xfff6a0, 1, 1.5, 0.3, 0.12, 0);
    }
    // Remove stale creep views (e.g. creeps cleared without events)
    if (this.creepViews.size > g.creeps.length) {
      const alive = new Set(g.creeps.map((c) => c.uid));
      for (const [uid, v] of this.creepViews) if (!alive.has(uid)) { this.scene.remove(v.group); this.creepViews.delete(uid); }
    }
    // Death animations: white pop, topple, shrink and sink. Bosses play slower.
    for (const d of this.dying) {
      d.t += dt * d.rate;
      const v = d.v;
      v.bar.visible = false;
      v.flash -= dt;
      this._look(v);
      const pop = d.t < 0.16 ? Math.sin((d.t / 0.16) * Math.PI) * 0.3 : 0;
      const shrink = d.t > 0.35 ? Math.max(0.05, 1 - (d.t - 0.35) * 1.6) : 1;
      v.inner.scale.setScalar(v.baseScale * (1 + pop) * shrink);
      v.inner.rotation.z = Math.min(1.4, d.t * 4);
      v.group.position.y = -Math.max(0, d.t - 0.3) * 2;
    }
    const finished = this.dying.filter((d) => d.t > 0.9);
    if (finished.length) {
      for (const d of finished) this.scene.remove(d.v.group);
      this.dying = this.dying.filter((d) => d.t <= 0.9);
    }

    this.fx.syncProjectiles(g.projectiles);
  }

  // Project a world position to screen pixels (used by the HUD for anchored popups).
  toScreen(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight, behind: v.z > 1 };
  }
}

export function fmt(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e4) return `${(n / 1e3).toFixed(1)}k`;
  return `${Math.round(n)}`;
}
