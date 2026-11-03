// Visual effects: GPU particles, projectile visuals, lightning, beams, shockwaves,
// meteors, item beacons and floating combat text.

import * as THREE from 'three';
import { terrainHeight } from './environment.js';
import { LightningBolts } from './fx-lightning.js';
import { GroundEffects, GROUND } from './fx-ground.js';
import { ProjectileBatch } from './fx-projectiles.js';
import { Spikes } from './fx-spikes.js';
import { meteorGeometry, meteorMaterial, moltenCracks } from './fx-meteor.js';

// Relative visual weight of each creep size for death effects.
export const SIZE_WEIGHT = { mass: 0.7, normal: 1, air: 1.1, champion: 1.6, boss: 2.6, challenge: 3, challengeMass: 0.8 };

// ------------------------------------------------------------------ gibs

// Small flat-shaded shards that fly out of a dying creep, bounce on the ground and
// shrink away. One InstancedMesh draws them all.
class Gibs {
  constructor(scene, max) {
    this.max = max;
    const material = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.1, flatShading: true });
    this.mesh = new THREE.InstancedMesh(new THREE.TetrahedronGeometry(1, 0), material, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color());
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.list = [];
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.p = new THREE.Vector3();
    this.s = new THREE.Vector3();
    scene.add(this.mesh);
  }

  spawn(x, y, z, vx, vy, vz, size, color, life) {
    if (this.list.length >= this.max) this.list.shift();
    this.list.push({
      x, y, z, vx, vy, vz, size, life, t: 0, color: new THREE.Color(color),
      floor: terrainHeight(x, z) + size * 0.5,
      axis: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(),
      ang: Math.random() * 6, spin: 8 + Math.random() * 14,
    });
  }

  update(dt) {
    const L = this.list;
    if (!L.length && !this.mesh.count) return;
    let w = 0;
    for (let i = 0; i < L.length; i++) {
      const g = L[i];
      g.t += dt;
      if (g.t >= g.life) continue;
      g.vy -= 22 * dt;
      g.x += g.vx * dt; g.y += g.vy * dt; g.z += g.vz * dt;
      if (g.y < g.floor) {
        g.y = g.floor;
        // Bounce with heavy damping, then slide to rest.
        g.vy = Math.abs(g.vy) > 1.5 ? -g.vy * 0.38 : 0;
        g.vx *= 0.62; g.vz *= 0.62; g.spin *= 0.55;
      }
      g.ang += g.spin * dt;
      const k = g.t / g.life;
      const sc = g.size * (k > 0.65 ? (1 - k) / 0.35 : 1);
      this.q.setFromAxisAngle(g.axis, g.ang);
      this.m.compose(this.p.set(g.x, g.y, g.z), this.q, this.s.set(sc, sc, sc));
      this.mesh.setMatrixAt(w, this.m);
      this.mesh.setColorAt(w, g.color);
      L[w++] = g;
    }
    L.length = w;
    this.mesh.count = w;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ ground decals

// Procedural splat mask: a soft core with a few droplets, drawn once to a canvas.
function splatTexture() {
  const S = 128, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const blob = (x, y, r, a) => {
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, `rgba(255,255,255,${a})`);
    grd.addColorStop(0.65, `rgba(255,255,255,${a * 0.85})`);
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  };
  blob(64, 64, 34, 0.95);
  for (let i = 0; i < 7; i++) {
    const a = i * 0.9 + 0.3, d = 18 + (i * 37) % 22;
    blob(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 12 + (i * 13) % 9, 0.8);
  }
  for (let i = 0; i < 12; i++) {
    const a = i * 2.39, d = 38 + (i * 29) % 22;
    blob(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 3 + (i * 7) % 5, 0.9);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Fading ground splats (ichor, scorch) drawn as one instanced quad batch.
class Decals {
  constructor(scene, max) {
    this.max = max;
    this.cursor = 0;
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    this.aColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.aFade = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3); // birth, life, opacity
    for (let i = 0; i < max; i++) this.aFade.array[i * 3] = -1000;
    geo.setAttribute('aColor', this.aColor);
    geo.setAttribute('aFade', this.aFade);
    this.material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
      uniforms: { uTime: { value: 0 }, uMap: { value: splatTexture() } },
      vertexShader: `
        uniform float uTime; attribute vec3 aColor; attribute vec3 aFade;
        varying vec2 vUv; varying vec3 vColor; varying float vAlpha;
        void main(){
          float k = (uTime - aFade.x) / aFade.y;
          vAlpha = (k < 0.0 || k > 1.0) ? 0.0 : aFade.z * smoothstep(0.0, 0.02, k) * (1.0 - k * k);
          vUv = uv; vColor = aColor;
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform sampler2D uMap; varying vec2 vUv; varying vec3 vColor; varying float vAlpha;
        void main(){ float a = texture2D(uMap, vUv).a * vAlpha; if (a < 0.01) discard; gl_FragColor = vec4(vColor, a); }`,
    });
    this.mesh = new THREE.InstancedMesh(geo, this.material, max);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.m = new THREE.Matrix4();
    for (let i = 0; i < max; i++) this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
    scene.add(this.mesh);
  }

  add(time, x, z, r, color, life, opacity) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    const y = terrainHeight(x, z) + 0.1;
    this.m.makeRotationY(Math.random() * Math.PI * 2);
    this.m.scale(tmpV.set(r * 2, 1, r * 2));
    this.m.setPosition(x, y, z);
    this.mesh.setMatrixAt(i, this.m);
    tmpC.set(color);
    this.aColor.setXYZ(i, tmpC.r, tmpC.g, tmpC.b);
    this.aFade.setXYZ(i, time, life, opacity);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.aColor.needsUpdate = true;
    this.aFade.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ particles

class Particles {
  constructor(max, blending) {
    this.max = max;
    this.cursor = 0;
    const geo = new THREE.BufferGeometry();
    this.aStart = new Float32Array(max * 3);
    this.aVel = new Float32Array(max * 3);
    this.aColor = new Float32Array(max * 3);
    this.aMeta = new Float32Array(max * 4); // birth, life, size, gravity
    for (let i = 0; i < max; i++) this.aMeta[i * 4] = -1000;
    geo.setAttribute('position', new THREE.BufferAttribute(this.aStart, 3));
    geo.setAttribute('aVel', new THREE.BufferAttribute(this.aVel, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.aColor, 3));
    geo.setAttribute('aMeta', new THREE.BufferAttribute(this.aMeta, 4));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    this.geo = geo;
    this.material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending,
      uniforms: { uTime: { value: 0 }, uScale: { value: 1 } },
      vertexShader: `
        uniform float uTime; uniform float uScale;
        attribute vec3 aVel; attribute vec3 aColor; attribute vec4 aMeta;
        varying vec3 vColor; varying float vAlpha;
        void main(){
          float t = uTime - aMeta.x;
          float life = aMeta.y;
          if (t < 0.0 || t > life) { gl_Position = vec4(2.0,2.0,2.0,1.0); gl_PointSize = 0.0; return; }
          float k = t / life;
          vec3 drag = aVel * (1.0 - exp(-t * 2.0)) / 2.0;
          vec3 p = position + drag + vec3(0.0, -0.5 * aMeta.w * t * t, 0.0);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = aMeta.z * uScale * (1.0 - k * 0.6) * 300.0 / -mv.z;
          gl_Position = projectionMatrix * mv;
          vColor = aColor; vAlpha = 1.0 - k;
        }`,
      fragmentShader: `
        varying vec3 vColor; varying float vAlpha;
        void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d) * vAlpha; gl_FragColor = vec4(vColor * a, a); }`,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.dirty = false;
  }
  emit(time, x, y, z, vx, vy, vz, color, life, size, gravity = 0) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.aStart[i * 3] = x; this.aStart[i * 3 + 1] = y; this.aStart[i * 3 + 2] = z;
    this.aVel[i * 3] = vx; this.aVel[i * 3 + 1] = vy; this.aVel[i * 3 + 2] = vz;
    this.aColor[i * 3] = color.r; this.aColor[i * 3 + 1] = color.g; this.aColor[i * 3 + 2] = color.b;
    this.aMeta[i * 4] = time; this.aMeta[i * 4 + 1] = life; this.aMeta[i * 4 + 2] = size; this.aMeta[i * 4 + 3] = gravity;
    this.dirty = true;
  }
  flush() {
    if (!this.dirty) return;
    for (const k of ['position', 'aVel', 'aColor', 'aMeta']) this.geo.attributes[k].needsUpdate = true;
    this.dirty = false;
  }
}

// ------------------------------------------------------------------ projectile styles

const PROJ = {
  bullet: { color: 0xffd080, size: 0.08, trail: 0xffa040, glow: 3 },
  bolt: { color: 0xe8e0c0, size: 0.1, trail: 0xc8c0a0, glow: 1.5, stretch: 4 },
  thorn: { color: 0xc8f080, size: 0.12, trail: 0x6fdc4a, glow: 1.5, stretch: 2.5 },
  shell: { color: 0x404040, size: 0.2, trail: 0xffa040, glow: 0.4 },
  fireball: { color: 0xff7a1a, size: 0.32, trail: 0xff5a10, glow: 4 },
  ember: { color: 0xffb040, size: 0.15, trail: 0xff7020, glow: 4 },
  magma: { color: 0xff4a10, size: 0.4, trail: 0xff3000, glow: 3 },
  icebolt: { color: 0xbff0ff, size: 0.18, trail: 0x7fd8ff, glow: 3, stretch: 2.2 },
  snow: { color: 0xffffff, size: 0.22, trail: 0xbfe8ff, glow: 2.5 },
  spark: { color: 0xd8c0ff, size: 0.14, trail: 0xa080ff, glow: 4 },
  wind: { color: 0xe0f0ff, size: 0.12, trail: 0xc0e0ff, glow: 2, stretch: 3 },
  coin: { color: 0xffd040, size: 0.16, trail: 0xffc020, glow: 2 },
  star: { color: 0xfff2a0, size: 0.18, trail: 0xffe36b, glow: 4 },
  moon: { color: 0xc8d8ff, size: 0.22, trail: 0x8fa8ff, glow: 2.5 },
  skull: { color: 0xc8a0ff, size: 0.2, trail: 0x8040c0, glow: 3 },
  shadow: { color: 0xc04dff, size: 0.2, trail: 0x6a1aaf, glow: 3 },
  scythe: { color: 0xff4a8a, size: 0.2, trail: 0xa02050, glow: 3, stretch: 2 },
  leaf: { color: 0x9fff6a, size: 0.14, trail: 0x4fbf3a, glow: 2.5 },
  phoenix: { color: 0xffa040, size: 0.3, trail: 0xff5010, glow: 4, stretch: 1.8 },
  spore: { color: 0xb6ff6a, size: 0.25, trail: 0x8fbf3a, glow: 2 },
};


const tmpV = new THREE.Vector3();
const tmpC = new THREE.Color();
const WHITE = new THREE.Color(1, 1, 1);

export class FX {
  constructor(scene, camera, overlay) {
    this.scene = scene;
    this.camera = camera;
    this.overlay = overlay;
    this.time = 0;
    this.add = new Particles(9000, THREE.AdditiveBlending);
    this.smoke = new Particles(2500, THREE.NormalBlending);
    scene.add(this.add.points, this.smoke.points);
    this.projectiles = new ProjectileBatch(scene, camera, 768);
    this._projOut = [];
    this.shots = []; // fx-owned shots (raiders at the nexus), see bolt()
    this.shotId = 0;
    this.temp = []; // {obj, t, life, update(k), dispose}
    this.texts = [];
    this.shake = 0;
    this.textEnabled = true;
    this.gibs = new Gibs(scene, 500);
    this.decals = new Decals(scene, 160);
    this.bolts = new LightningBolts(scene, 320);
    this.ground = new GroundEffects(scene, 256);
    this.ice = new Spikes(scene, 256, { roughness: 0.2, metalness: 0.15, emissive: 0x3d8ec0, emissiveIntensity: 0.9 });
    this.roots = new Spikes(scene, 128, { roughness: 0.9 });
    this.tickers = []; // {t, life, fn(k)}: per-frame work with nothing of its own to draw
    this.timers = []; // {t, fn} run on real time
    this.coinEls = [];
    this.flash = 0; // white screen flash, read by the world's grade pass
    this.punch = 0; // camera punch-zoom, read by the world's camera
    this.onCoinArrive = null;
    this.callEl = null;
  }

  after(delay, fn) { this.timers.push({ t: delay, fn }); }

  burst(x, y, z, color, n = 12, speed = 4, life = 0.6, size = 0.25, gravity = 4) {
    tmpC.set(color);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, u = Math.random() * 2 - 1;
      const s = speed * (0.4 + Math.random() * 0.6);
      const r = Math.sqrt(1 - u * u);
      this.add.emit(this.time, x, y, z, Math.cos(a) * r * s, Math.abs(u) * s * 0.9 + 1, Math.sin(a) * r * s, tmpC, life * (0.6 + Math.random() * 0.6), size * (0.6 + Math.random() * 0.8), gravity);
    }
  }

  puff(x, y, z, color = 0x6a6058, n = 8, size = 0.6, life = 1.0) {
    tmpC.set(color);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      this.smoke.emit(this.time, x + Math.cos(a) * 0.3, y, z + Math.sin(a) * 0.3, Math.cos(a) * 1.5, 1 + Math.random() * 1.5, Math.sin(a) * 1.5, tmpC, life * (0.7 + Math.random() * 0.6), size * (0.7 + Math.random() * 0.6), -0.5);
    }
  }

  // ---------------------------------------------------------------- projectiles

  syncProjectiles(list, dt = 1 / 60) {
    const out = this._projOut;
    out.length = 0;
    for (const p of list) {
      const st = PROJ[p.kind] || PROJ.bullet;
      const targetY = p.target.air ? 2.6 : 0.9;
      let y = p.y + (targetY - p.y) * p.t;
      if (p.arc) y += Math.sin(p.t * Math.PI) * Math.min(7, p.total * 0.45);
      out.push({ uid: p.uid, x: p.x, y, z: p.z, style: st });
      // The ribbon trail carries the shape; a few sparks and smoke keep it alive.
      if (Math.random() < 0.35) this.add.emit(this.time, p.x, y, p.z, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8, tmpC.set(st.trail), 0.3, st.size * 1.1, 0);
      if (p.kind === 'magma' || p.kind === 'fireball' || p.kind === 'shell') {
        this.smoke.emit(this.time, p.x, y, p.z, 0, 0.5, 0, tmpC.set(0x3a3330), 0.6, st.size * 2.2, -0.5);
      }
    }
    for (const s of this.shots) {
      s.k += dt / s.travel;
      if (s.k >= 1) {
        this.burst(s.to.x, s.to.y, s.to.z, s.color, 10, 3.5, 0.4, s.size * 1.4, 5);
        s.onHit?.();
        continue;
      }
      const { from: a, to: b, k } = s;
      out.push({ uid: s.uid, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k + Math.sin(k * Math.PI) * s.arc, z: a.z + (b.z - a.z) * k, style: s.style });
    }
    if (this.shots.length) this.shots = this.shots.filter((s) => s.k < 1);
    this.projectiles.sync(out, dt);
  }

  impact(p) {
    const st = PROJ[p.kind] || PROJ.bullet;
    const big = p.kind === 'magma' || p.kind === 'fireball' || p.kind === 'shell' || p.kind === 'phoenix';
    const y = p.target?.air ? 2.6 : 1;
    this.burst(p.x, y, p.z, st.trail, big ? 18 : 7, big ? 6 : 3, 0.45, st.size * 1.6, 6);
    if (big) this.puff(p.x, 0.6, p.z, 0x4a403a, 4, 0.7, 0.9);
  }

  // Bright, fast sparks on a creep that just took a meaningful hit.
  hitSpark(x, y, z, color, strength = 1) {
    tmpC.set(0xfff4e0);
    const n = 2 + Math.round(strength * 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 5 + Math.random() * 5 * strength;
      this.add.emit(this.time, x, y, z, Math.cos(a) * s, 2 + Math.random() * 4, Math.sin(a) * s, tmpC, 0.16 + Math.random() * 0.1, 0.13, 14);
    }
    this.burst(x, y, z, color, 1 + Math.round(strength * 2), 2.5, 0.3, 0.3 * (0.8 + strength * 0.5), 3);
  }

  // ---------------------------------------------------------------- one-shot effects

  _tick(life, fn) { this.tickers.push({ t: 0, life, fn }); }

  _temp(obj, life, update) {
    this.scene.add(obj);
    this.temp.push({ obj, t: 0, life, update });
  }

  // A glowing shot with a trail; onHit runs when it lands. arc lifts it mid-flight
  // (0 flies straight, like a bullet).
  bolt(from, to, color, size = 0.22, travel = 0.35, onHit = null, arc = 0.8) {
    // Flown by syncProjectiles through the projectile batch, like tower shots.
    this.shots.push({ uid: `shot${this.shotId++}`, from, to, travel, arc, onHit, color, size, k: 0,
      style: { color, trail: color, size: size / 1.5, glow: 3 } });
  }

  // Expanding shockwave ring; `width` scales its strength (0.6 for a splash).
  ring(x, z, radius, color, life = 0.5, y = 0.15, width = 1) {
    this.ground.add(this.time, GROUND.RING, x, y, z, radius, tmpC.set(color), life, width);
  }

  flashDisc(x, z, radius, color, life = 0.35) {
    this.ground.add(this.time, GROUND.FLASH, x, 0.12, z, radius, tmpC.set(color), life);
  }

  // A bolt through each pair of points (a chain is several hops fired at once).
  lightning(points, color = 0xc8b0ff, width = 0.06, height = 1.2) {
    tmpC.set(color);
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      this.bolts.add(this.time, { x: a.x, y: a.y ?? height, z: a.z }, { x: b.x, y: b.y ?? height, z: b.z }, tmpC, width);
      const by = b.y ?? height;
      for (let k = 0; k < 5; k++) this.add.emit(this.time, b.x, by, b.z, (Math.random() - 0.5) * 6, Math.random() * 4, (Math.random() - 0.5) * 6, tmpC, 0.3, 0.18, 8);
    }
  }

  strike(x, z) {
    this.lightning([{ x: x + (Math.random() - 0.5) * 2, y: 16, z: z + (Math.random() - 0.5) * 2 }, { x, y: 0.3, z }], 0xb8a0ff, 0.12);
    this.ring(x, z, 2.5, 0xb8a0ff, 0.4);
    this.burst(x, 0.5, z, 0xd8c8ff, 18, 6, 0.5, 0.3, 6);
    this.shake = Math.max(this.shake, 0.15);
  }

  // A held beam, refreshed every few frames by its caller: a straight bundle in
  // the bolt batch, with a faint tight fan so it shimmers.
  beam(from, to, color, widthScale) {
    tmpC.set(color);
    this.bolts.add(this.time, from, to, tmpC, 0.05 * widthScale, 0.1, 0.02, 0.15);
    this.add.emit(this.time, to.x, to.y, to.z, (Math.random() - 0.5) * 3, Math.random() * 3, (Math.random() - 0.5) * 3, tmpC, 0.3, 0.2 * widthScale, 4);
  }

  nova(x, z, radius, fx) {
    const colors = { roots: 0x7fdc4a, starfall: 0xfff2a0, void: 0xc04dff, nova: 0x9fe8ff };
    const color = colors[fx] || 0xffffff;
    this.ring(x, z, radius, color, 0.7, 0.2);
    this.ring(x, z, radius * 0.6, color, 0.5, 0.25);
    this.flashDisc(x, z, radius * 0.8, color, 0.3);
    if (fx === 'roots') {
      this.roots.burst(x, z, radius, 0x6b5a34, { count: 16, height: 1.8, width: 0.25, speed: 10, life: 0.9 });
    } else if (fx === 'nova') {
      this.ice.burst(x, z, radius, 0x9fd8f5, { count: Math.min(40, Math.round(radius * 5)), height: 1.7, width: 0.3, speed: 16, life: 1.1 });
    } else if (fx === 'starfall') {
      for (let i = 0; i < 6; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * radius;
        const sx = x + Math.cos(a) * r, sz = z + Math.sin(a) * r;
        this.lightning([{ x: sx + 2, y: 14, z: sz - 2 }, { x: sx, y: 0.3, z: sz }], 0xfff2a0, 0.05);
        this.burst(sx, 0.4, sz, 0xfff2a0, 8, 4, 0.5, 0.25, 6);
      }
    } else if (fx === 'void') {
      tmpC.set(0xc04dff);
      for (let i = 0; i < 60; i++) {
        const a = Math.random() * Math.PI * 2, r = radius * (0.6 + Math.random() * 0.4);
        this.add.emit(this.time, x + Math.cos(a) * r, 0.5 + Math.random() * 2, z + Math.sin(a) * r, -Math.cos(a) * r * 1.6, 0, -Math.sin(a) * r * 1.6, tmpC, 0.6, 0.35, 0);
      }
    }
  }

  // Element touches on top of a spell's ring and flash.
  spellFlavor(kind, x, z, radius) {
    if (kind === 'frost') {
      this.ice.burst(x, z, radius, 0x9fd8f5, { count: Math.min(16, Math.round(radius * 3)), height: 1.0, width: 0.22, speed: 14, life: 0.8 });
    } else if (kind === 'nature') {
      this.roots.burst(x, z, radius, 0x6b5a34, { count: Math.min(12, Math.round(radius * 2.5)), height: 1.2, width: 0.2, speed: 10, life: 0.8 });
    } else if (kind === 'fire') {
      this.scorch(x, z, radius * 0.7);
    } else if (kind === 'storm') {
      // Short arcs crawling over the ground from the centre.
      for (let i = 0; i < 3; i++) {
        const a = Math.random() * Math.PI * 2, r = radius * (0.5 + Math.random() * 0.5);
        this.bolts.add(this.time, { x, y: 0.3, z }, { x: x + Math.cos(a) * r, y: 0.25, z: z + Math.sin(a) * r }, tmpC.set(0xc8a8ff), 0.04, 0.25, 0.3);
      }
    } else if (kind === 'shadow') {
      tmpC.set(0xc04dff);
      for (let i = 0; i < 24; i++) {
        const a = Math.random() * Math.PI * 2, r = radius * (0.6 + Math.random() * 0.4);
        this.add.emit(this.time, x + Math.cos(a) * r, 0.4 + Math.random(), z + Math.sin(a) * r, -Math.cos(a) * r * 1.6, 0.5, -Math.sin(a) * r * 1.6, tmpC, 0.5, 0.3, 0);
      }
    }
  }

  meteorCast(x, z, delay, radius) {
    const start = new THREE.Vector3(x - 12, 30, z - 8), end = new THREE.Vector3(x, 0.5, z);
    const rock = new THREE.Mesh(meteorGeometry(), meteorMaterial());
    rock.scale.setScalar(1.35);
    const ru = rock.material.userData.uniforms;
    ru.uHeading.value.subVectors(end, start).normalize();
    // Target marker: the zone shader's rotating dashed rim.
    this.ground.add(this.time, GROUND.ZONE, x, 0.15, z, radius, tmpC.set(0xff5a1a), delay, 1.6);
    this._temp(rock, delay, (k) => {
      rock.position.lerpVectors(start, end, k * k);
      rock.rotation.x += 0.06; rock.rotation.y += 0.04;
      // The seams prise open and the nose heats up as it comes in.
      ru.uCharge.value = Math.pow(k, 1.6);
      ru.uTime.value = this.time;
      tmpC.set(0xff6a1a);
      for (let i = 0; i < 3; i++) this.add.emit(this.time, rock.position.x, rock.position.y, rock.position.z, (Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5), tmpC, 0.5, 0.8, 0);
      this.smoke.emit(this.time, rock.position.x, rock.position.y, rock.position.z, 0, 0.5, 0, tmpC.set(0x2a2220), 1.2, 1.2, -0.3);
    });
  }

  meteorImpact(x, z, radius) {
    this.burst(x, 0.5, z, 0xff7a1a, 60, 12, 0.8, 0.45, 10);
    this.burst(x, 0.5, z, 0xffd36a, 30, 7, 0.6, 0.3, 8);
    this.puff(x, 0.5, z, 0x3a302a, 18, 1.5, 1.6);
    this.ring(x, z, radius * 1.4, 0xff8a3a, 0.6, 0.2);
    this.flashDisc(x, z, radius, 0xff6a1a, 0.5);
    this.scorch(x, z, radius * 0.8);
    const cracks = moltenCracks(x, z, radius * 1.3);
    this._temp(cracks.group, cracks.life, (k) => cracks.update(k * cracks.life));
    this.shake = Math.max(this.shake, 0.45);
  }

  // Lingering ground field (storm cloud, frost field, poison bog...).
  zone(x, z, radius, color, dur) {
    this.ground.add(this.time, GROUND.ZONE, x, 0.15, z, radius, tmpC.set(color), dur);
    const c = new THREE.Color(color);
    this._tick(dur, () => {
      if (Math.random() < 0.5) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * radius;
        this.add.emit(this.time, x + Math.cos(a) * r, 0.3, z + Math.sin(a) * r, 0, 1.5 + Math.random(), 0, c, 0.8, 0.25, -0.5);
      }
    });
  }

  // Charred splat that fades over six seconds.
  scorch(x, z, r) {
    this.decals.add(this.time, x, z, r, 0x0c0806, 6, 0.55);
  }

  // colors: { body, accent, dark } from RACE_COLORS. Effects scale with creep size.
  death(creep, colors) {
    const k = SIZE_WEIGHT[creep.size] || 1;
    const x = creep.x, z = creep.z;
    const h = creep.air ? 2.6 : 0.6 + 0.35 * Math.min(2, k);
    const accent = colors.accent;
    // Hot core pop, then the colored blast.
    this.burst(x, h, z, 0xffffff, Math.round(4 + 3 * k), 2.5 * k, 0.18, 0.45 * k, 0);
    this.burst(x, h, z, accent, Math.round(12 + 10 * k), 3.5 + 2 * k, 0.65, 0.26 + 0.05 * k, 7);
    this.puff(x, h * 0.6, z, 0x40383a, Math.round(3 + 2 * k), 0.6 + 0.15 * k, 1.1);
    // Shards of the body that bounce on the ground.
    const shards = Math.round(4 + 4 * k);
    for (let i = 0; i < shards; i++) {
      const a = Math.random() * Math.PI * 2, s = (2.5 + Math.random() * 4) * Math.sqrt(k);
      const c = i % 4 === 0 ? accent : i % 4 === 1 ? colors.dark : colors.body;
      this.gibs.spawn(x, h, z, Math.cos(a) * s, 4 + Math.random() * 5 * Math.sqrt(k), Math.sin(a) * s, (0.07 + Math.random() * 0.08) * Math.sqrt(k), c, 1.1 + Math.random() * 0.7);
    }
    // Embers and a soul wisp drifting up.
    tmpC.set(accent).lerp(WHITE, 0.45);
    const embers = Math.round(4 + 2 * k);
    for (let i = 0; i < embers; i++) {
      this.add.emit(this.time, x + (Math.random() - 0.5) * 0.6, h, z + (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 1.5, 2.5 + Math.random() * 3, (Math.random() - 0.5) * 1.5, tmpC, 0.9 + Math.random() * 0.6, 0.16 + Math.random() * 0.1, -1.2);
    }
    // Ground splat in a dark tint of the race accent.
    tmpC.set(accent).multiplyScalar(0.35);
    this.decals.add(this.time, x, z, 0.55 + 0.35 * k, tmpC.getHex(), 5 + k, 0.75);
    this.ring(x, z, 1 + 0.9 * k, accent, 0.3, 0.2, 0.7);
    if (creep.size === 'champion') {
      this.flashDisc(x, z, 2.2, accent, 0.25);
      this.shake = Math.max(this.shake, 0.12);
      this.punch = Math.max(this.punch, 0.35);
    }
    if (creep.size === 'boss' || creep.size === 'challenge') this.bossDeath(x, h, z, colors, k);
  }

  // A drawn-out chain of blasts ending in one big shockwave.
  bossDeath(x, h, z, colors, k) {
    const accent = colors.accent;
    this.flash = Math.max(this.flash, 0.8);
    this.punch = 1;
    this.shake = Math.max(this.shake, 0.6);
    this.ring(x, z, 4, 0xffffff, 0.4, 0.3);
    for (let i = 0; i < 4; i++) {
      this.after(0.1 + i * 0.12, () => {
        const ox = (Math.random() - 0.5) * 2.5, oz = (Math.random() - 0.5) * 2.5;
        this.burst(x + ox, h + Math.random(), z + oz, accent, 26, 7, 0.6, 0.38, 6);
        this.burst(x + ox, h, z + oz, 0xffe2a0, 10, 3, 0.25, 0.6, 0);
        this.puff(x + ox, h, z + oz, 0x3a3234, 5, 1.1, 1.3);
        this.shake = Math.max(this.shake, 0.3);
      });
    }
    this.after(0.6, () => {
      this.flash = 1;
      this.punch = 1;
      this.shake = Math.max(this.shake, 0.95);
      this.burst(x, h, z, 0xffffff, 24, 10, 0.25, 0.6, 0);
      this.burst(x, h, z, accent, 90, 15, 0.9, 0.5, 9);
      this.burst(x, h, z, 0xffc040, 40, 9, 1.0, 0.35, 5);
      this.puff(x, 0.6, z, 0x2e282a, 22, 1.8, 1.8);
      this.ring(x, z, 10 * k / 2.6, 0xffe9b0, 0.9, 0.25);
      this.ring(x, z, 6 * k / 2.6, accent, 0.7, 0.3);
      this.flashDisc(x, z, 6, 0xffc040, 0.6);
      for (let i = 0; i < 40; i++) {
        const a = Math.random() * Math.PI * 2, s = 4 + Math.random() * 9;
        const c = i % 3 === 0 ? accent : i % 3 === 1 ? colors.dark : colors.body;
        this.gibs.spawn(x, h, z, Math.cos(a) * s, 6 + Math.random() * 9, Math.sin(a) * s, 0.12 + Math.random() * 0.18, c, 1.6 + Math.random());
      }
      this.decals.add(this.time, x, z, 4.5, 0x0a0706, 9, 0.8);
      tmpC.set(accent).lerp(WHITE, 0.5);
      for (let i = 0; i < 30; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * 2;
        this.add.emit(this.time, x + Math.cos(a) * r, h, z + Math.sin(a) * r, Math.cos(a) * 0.8, 3 + Math.random() * 5, Math.sin(a) * 0.8, tmpC, 1.4 + Math.random(), 0.25, -1.5);
      }
    });
  }

  // ---------------------------------------------------------------- gold coins (screen space)

  // Coins pop out of the creep and fly to the gold counter in the top bar.
  coins(x, y, z, n) {
    if (!this.overlay) return;
    tmpV.set(x, y, z).project(this.camera);
    if (tmpV.z > 1) return;
    const w = window.innerWidth, hgt = window.innerHeight;
    const sx = (tmpV.x * 0.5 + 0.5) * w, sy = (-tmpV.y * 0.5 + 0.5) * hgt;
    for (let i = 0; i < n; i++) {
      if (this.coinEls.length >= 36) break;
      const el = document.createElement('div');
      el.style.cssText = 'position:absolute;left:0;top:0;width:calc(var(--s,1)*12px);height:calc(var(--s,1)*12px);margin:calc(var(--s,1)*-6px) 0 0 calc(var(--s,1)*-6px);border-radius:50%;'
        + 'background:radial-gradient(circle at 35% 30%,#fffbe0 0 15%,#ffd84a 38%,#d39a28 72%,#7a5010 100%);box-shadow:0 0 calc(var(--s,1)*7px) rgba(255,200,60,.85);will-change:transform;pointer-events:none;';
      this.overlay.appendChild(el);
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      const sp = 160 + Math.random() * 140;
      this.coinEls.push({ el, x0: sx, y0: sy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: -i * 0.04, life: 0.75 + Math.random() * 0.15, spin: Math.random() * 6 });
    }
  }

  _coinTarget() {
    const el = document.getElementById('r-gold');
    const r = el && el.getBoundingClientRect();
    if (!r || !r.width) return { x: 60, y: 24 };
    return { x: r.left + Math.min(r.width / 2, 14), y: r.top + r.height / 2 };
  }

  _updateCoins(dt) {
    if (!this.coinEls.length) return;
    const tgt = this._coinTarget();
    let arrived = 0;
    for (const c of this.coinEls) {
      c.t += dt;
      const t = Math.max(0, c.t);
      // Ballistic pop, blended into a homing curve toward the counter.
      const bx = c.x0 + c.vx * t, by = c.y0 + c.vy * t + 700 * t * t;
      const h = Math.min(1, Math.max(0, (t - 0.18) / (c.life - 0.18)));
      const e = h * h * (3 - 2 * h) * h;
      const x = bx + (tgt.x - bx) * e, y = by + (tgt.y - by) * e;
      const sx = 0.25 + 0.75 * Math.abs(Math.cos(t * 14 + c.spin));
      const s = c.t < 0 ? 0 : 1 - 0.35 * e;
      c.el.style.transform = `translate(${x}px, ${y}px) scale(${sx * s}, ${s})`;
      if (t >= c.life) { c.el.remove(); c.done = true; arrived++; }
    }
    if (arrived) {
      this.coinEls = this.coinEls.filter((c) => !c.done);
      this.onCoinArrive?.(arrived);
    }
  }

  // ---------------------------------------------------------------- kill streak callout

  callout(title, sub, tier) {
    if (!this.overlay) return;
    this.callEl?.remove();
    const el = document.createElement('div');
    const hue = [44, 30, 14, 350, 285][Math.min(4, tier)];
    const size = 26 + tier * 5;
    el.style.cssText = `position:absolute;left:50%;top:22%;transform:translate(-50%,-50%);text-align:center;pointer-events:none;white-space:nowrap;`
      + `font-family:var(--serif,Georgia,serif);font-weight:900;letter-spacing:.06em;text-transform:uppercase;font-size:calc(var(--s,1)*${size}px);`
      + `color:hsl(${hue},100%,64%);text-shadow:0 0 calc(var(--s,1)*14px) hsla(${hue},100%,55%,.75),0 calc(var(--s,1)*2px) 0 #000,0 0 calc(var(--s,1)*3px) #000;`;
    el.textContent = title;
    if (sub) {
      const s = document.createElement('div');
      s.textContent = sub;
      s.style.cssText = 'font-size:.42em;letter-spacing:.2em;color:#fff;opacity:.85;margin-top:.1em;';
      el.appendChild(s);
    }
    this.overlay.appendChild(el);
    this.callEl = el;
    const tr = (y, s, r = 0) => `translate(-50%, ${y}%) scale(${s}) rotate(${r}deg)`;
    const anim = el.animate([
      { transform: tr(-50, 2.4, -4), opacity: 0 },
      { transform: tr(-50, 0.9, 1), opacity: 1, offset: 0.1 },
      { transform: tr(-50, 1.05, 0), opacity: 1, offset: 0.18 },
      { transform: tr(-50, 1, 0), opacity: 1, offset: 0.75 },
      { transform: tr(-90, 1.08, 0), opacity: 0 },
    ], { duration: 1400, easing: 'ease-out' });
    anim.onfinish = () => { el.remove(); if (this.callEl === el) this.callEl = null; };
  }

  levelUp(t) {
    this.ring(t.x, t.z, 2.2, 0xffd34a, 0.8, 0.3);
    tmpC.set(0xffd34a);
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      this.add.emit(this.time, t.x + Math.cos(a) * 0.9, 0.5, t.z + Math.sin(a) * 0.9, 0, 4 + Math.random() * 2, 0, tmpC, 0.8, 0.22, 0);
    }
  }

  buildDust(x, z, color) {
    this.puff(x, 0.3, z, 0x8a7a64, 14, 0.8, 1.0);
    this.ring(x, z, 2, color, 0.6);
    this.burst(x, 0.5, z, color, 20, 5, 0.6, 0.25, 5);
  }

  beacon(x, z, color, life = 3.5) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.5, 14, 12, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    m.position.set(x, 7, z);
    this._temp(m, life, (k) => { m.material.opacity = (k < 0.1 ? k * 10 : 1 - (k - 0.1) / 0.9) * 0.6; m.scale.x = m.scale.z = 1 + Math.sin(k * 30) * 0.1; });
    this.burst(x, 0.5, z, color, 20, 5, 0.9, 0.25, 3);
  }

  blink(from, to) {
    this.burst(from.x, 1, from.z, 0xd8a0ff, 14, 3, 0.4, 0.25, 0);
    this.burst(to.x, 1, to.z, 0xd8a0ff, 14, 3, 0.4, 0.25, 0);
  }

  // ---------------------------------------------------------------- floating text

  text(x, y, z, str, cls) {
    if (!this.textEnabled && !cls.includes('gold')) return;
    if (this.texts.length > 70) { const old = this.texts.shift(); old.el.remove(); }
    const el = document.createElement('div');
    el.className = `ftext ${cls}`;
    el.textContent = str;
    this.overlay.appendChild(el);
    // Crits and gold pop in oversized and settle; crits also shake briefly.
    const crit = cls.includes('crit'), gold = cls.includes('gold');
    this.texts.push({ el, x, y, z, t: 0, life: crit ? 1.25 : 1.1, vx: (Math.random() - 0.5) * 0.8, peak: crit ? 2.1 : gold ? 1.7 : 0, shake: crit ? 7 : 0 });
  }

  // ---------------------------------------------------------------- frame

  // dt is visual (game-speed scaled, near zero during hit-stop); realDt drives
  // screen-space UI effects and timed sequences.
  update(dt, width, height, realDt = dt) {
    this.time += dt;
    this.decals.material.uniforms.uTime.value = this.time;
    this.gibs.update(dt);
    this.ice.update(dt);
    this.roots.update(dt);
    this.bolts.update(this.time);
    this.ground.update(this.time);
    if (this.tickers.length) {
      for (const tk of this.tickers) { tk.t += dt; tk.fn(Math.min(1, tk.t / tk.life)); }
      this.tickers = this.tickers.filter((tk) => tk.t < tk.life);
    }
    if (this.timers.length) {
      for (const tm of this.timers) tm.t -= realDt;
      const due = this.timers.filter((tm) => tm.t <= 0);
      if (due.length) {
        this.timers = this.timers.filter((tm) => tm.t > 0);
        for (const tm of due) tm.fn();
      }
    }
    this._updateCoins(realDt);
    this.flash = Math.max(0, this.flash - realDt * 5);
    this.punch = Math.max(0, this.punch - realDt * 4);
    this.add.material.uniforms.uTime.value = this.time;
    this.smoke.material.uniforms.uTime.value = this.time;
    this.add.flush();
    this.smoke.flush();

    for (const e of this.temp) {
      e.t += dt;
      e.update(Math.min(1, e.t / e.life));
    }
    const done = this.temp.filter((e) => e.t >= e.life);
    if (done.length) {
      for (const e of done) {
        this.scene.remove(e.obj);
        e.obj.traverse((o) => {
          if (!o.isMesh) return;
          if (o.material.type !== 'MeshStandardMaterial' || o.material.userData.owned) o.material.dispose();
          if (!o.geometry.userData.shared) o.geometry.dispose();
        });
      }
      this.temp = this.temp.filter((e) => e.t < e.life);
    }

    for (const t of this.texts) {
      t.t += dt;
      const k = t.t / t.life;
      const rise = t.peak ? 1.9 * (1 - (1 - k) ** 3) : k * 1.6;
      tmpV.set(t.x + t.vx * k, t.y + rise, t.z).project(this.camera);
      let sx = (tmpV.x * 0.5 + 0.5) * width, sy = (-tmpV.y * 0.5 + 0.5) * height;
      let s;
      if (t.peak) {
        // 0 -> peak in the first 5%, then ease back to 1 by 30%.
        s = k < 0.05 ? 0.4 + (t.peak - 0.4) * (k / 0.05) : k < 0.3 ? 1 + (t.peak - 1) * ((0.3 - k) / 0.25) ** 2 : 1;
        if (t.shake && k < 0.3) { const a = t.shake * (1 - k / 0.3); sx += (Math.random() - 0.5) * a; sy += (Math.random() - 0.5) * a; }
      } else s = k < 0.15 ? 0.6 + k * 2.6 : 1;
      t.el.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -50%) scale(${s})`;
      t.el.style.opacity = k > 0.7 ? (1 - k) / 0.3 : 1;
      t.el.style.display = tmpV.z > 1 ? 'none' : '';
    }
    const gone = this.texts.filter((t) => t.t >= t.life);
    if (gone.length) {
      for (const t of gone) t.el.remove();
      this.texts = this.texts.filter((t) => t.t < t.life);
    }
    this.shake = Math.max(0, this.shake - dt * 1.4);
  }
}
