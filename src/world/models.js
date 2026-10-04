// Procedural models for towers and creeps. Everything is built from primitives so
// the game ships without external assets; bloom does the heavy lifting on glow.

import * as THREE from 'three';
import { ELEMENTS, RARITIES, RACES } from '../data/constants.js';
import { attachTowerGlb, attachCreepGlb, loadGlb } from './glb-models.js';
import { CREEP_MODEL_MAP } from '../data/model-map.js';

const matCache = new Map();
export function mat(color, { rough = 0.7, metal = 0.05, emissive = 0, ei = 0, flat = false, transparent = false, opacity = 1 } = {}) {
  const key = [color, rough, metal, emissive, ei, flat, transparent, opacity].join('|');
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshStandardMaterial({
      color, roughness: rough, metalness: metal, emissive, emissiveIntensity: ei,
      flatShading: flat, transparent, opacity,
    }));
  }
  return matCache.get(key);
}
export const glow = (color, ei = 2.2) => mat(color, { emissive: color, ei, rough: 0.4 });

const geoCache = new Map();
const G = (key, make) => { if (!geoCache.has(key)) geoCache.set(key, make()); return geoCache.get(key); };
const cylG = (rt, rb, h, s = 12) => G(`c${rt}|${rb}|${h}|${s}`, () => new THREE.CylinderGeometry(rt, rb, h, s));
const boxG = (x, y, z) => G(`b${x}|${y}|${z}`, () => new THREE.BoxGeometry(x, y, z));
const sphG = (r, w = 16, h = 12) => G(`s${r}|${w}|${h}`, () => new THREE.SphereGeometry(r, w, h));
const coneG = (r, h, s = 12) => G(`k${r}|${h}|${s}`, () => new THREE.ConeGeometry(r, h, s));
const torG = (r, t, rs = 8, ts = 32) => G(`t${r}|${t}|${rs}|${ts}`, () => new THREE.TorusGeometry(r, t, rs, ts));
const octG = (r) => G(`o${r}`, () => new THREE.OctahedronGeometry(r, 0));
const icoG = (r, d = 0) => G(`i${r}|${d}`, () => new THREE.IcosahedronGeometry(r, d));
const dodG = (r) => G(`d${r}`, () => new THREE.DodecahedronGeometry(r, 0));

function add(parent, geo, material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  if (Array.isArray(s)) m.scale.set(...s); else m.scale.setScalar(s);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

const STONE = 0x5d5a66, STONE_D = 0x3c3a44, WOOD = 0x6b4a2f, WOOD_D = 0x4a321f, IRON = 0x6f747d, BRASS = 0xb08d4a, BONE = 0xe8e0c8;

// ------------------------------------------------------------------ towers

// Daises grow with rarity: commons sit on a plain stone block, uncommons gain a
// bronze-trimmed step, rares a third step with corner posts and element gems,
// uniques a gilded dais with four obelisks burning in the element's colour.
// Returns { top, anim parts } so the tower stands on the highest step.
const GOLD = 0xd8a440, BRONZE = 0xa0703a;
function pedestal(g, rarity, element, tier, A) {
  const r = RARITIES[rarity], e = ELEMENTS[element];
  const stone = mat(STONE, { rough: 0.85, flat: true }), dark = mat(STONE_D, { rough: 0.9, flat: true });
  const level = r.idx;
  let y = 0;
  const step = (rt, rb, h, m) => { add(g, cylG(rt, rb, h, 6), m, 0, y + h / 2, 0, 0, Math.PI / 6); y += h; };
  if (level === 0) {
    step(1.0, 1.12, 0.32, dark); step(0.86, 0.96, 0.28, stone);
  } else if (level === 1) {
    step(1.12, 1.22, 0.3, dark); step(1.0, 1.08, 0.22, stone);
    add(g, torG(1.02, 0.045, 6, 6), mat(BRONZE, { metal: 0.8, rough: 0.35 }), 0, y, 0, Math.PI / 2, 0, Math.PI / 6);
    step(0.84, 0.92, 0.22, stone);
  } else if (level === 2) {
    step(1.2, 1.3, 0.3, dark); step(1.06, 1.14, 0.26, stone); step(0.88, 0.96, 0.26, dark);
    add(g, torG(0.9, 0.05, 6, 6), mat(BRONZE, { metal: 0.8, rough: 0.3 }), 0, y, 0, Math.PI / 2, 0, Math.PI / 6);
    // Corner posts topped with element gems.
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      add(g, boxG(0.2, 1.0, 0.2), stone, Math.cos(a) * 1.08, 0.5 + 0.3, Math.sin(a) * 1.08);
      const gem = add(g, octG(0.13), glow(e.color, 2.8), Math.cos(a) * 1.08, 1.45, Math.sin(a) * 1.08);
      A.bob.push({ obj: gem, amp: 0.06, speed: 2 + i * 0.3 });
    }
  } else {
    const gold = mat(GOLD, { metal: 0.9, rough: 0.25 });
    step(1.3, 1.42, 0.32, dark); step(1.14, 1.24, 0.28, stone);
    add(g, torG(1.16, 0.06, 6, 6), gold, 0, y, 0, Math.PI / 2, 0, Math.PI / 6);
    step(0.96, 1.04, 0.3, dark);
    add(g, torG(0.98, 0.05, 6, 6), gold, 0, y, 0, Math.PI / 2, 0, Math.PI / 6);
    // Obelisks with element fire, and a rune ring turning slowly above the dais.
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      add(g, cylG(0.08, 0.17, 1.9, 4), stone, Math.cos(a) * 1.22, 1.25, Math.sin(a) * 1.22, 0, Math.PI / 4);
      add(g, coneG(0.13, 0.25, 4), gold, Math.cos(a) * 1.22, 2.3, Math.sin(a) * 1.22, 0, Math.PI / 4);
      const fire = add(g, octG(0.15), glow(e.color, 3.5), Math.cos(a) * 1.22, 2.62, Math.sin(a) * 1.22);
      A.flicker.push(fire);
    }
    const runes = add(g, torG(1.05, 0.025, 4, 64), glow(e.color, 2.2), 0, y + 0.08, 0, Math.PI / 2);
    A.spin.push({ obj: runes, axis: 'z', speed: 0.6 });
  }
  // Rarity glow line on the top step, and tier pips around the base.
  add(g, torG(level >= 2 ? 0.82 : 0.84, 0.04, 6, 6), glow(r.color, level === 0 ? 0.6 : 1.8), 0, y + 0.01, 0, Math.PI / 2, 0, Math.PI / 6);
  const pr = [1.04, 1.16, 1.24, 1.34][level];
  for (let i = 0; i <= tier; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    add(g, octG(0.09), glow(e.color, 2.5), Math.cos(a) * pr, 0.34, Math.sin(a) * pr);
  }
  return y;
}

// Towers grow with their cost (log scale, so a 5000-gold unique stands about
// twice as tall as a 30-gold common), with a little extra for rarity.
export function towerScale(def) {
  const byCost = 0.8 + 0.4 * Math.log10(Math.max(30, def.cost) / 30);
  return byCost + [0, 0.04, 0.1, 0.2][RARITIES[def.rarity].idx];
}

const TOWER_BUILDERS = {
  thorn(g, c, y, t, A) {
    add(g, cylG(0.22, 0.35, 1.2, 7), mat(WOOD, { flat: true }), 0, y + 0.6, 0);
    for (let i = 0; i < 5 + t * 2; i++) {
      const a = i * 2.4, h = y + 0.5 + (i % 4) * 0.28;
      add(g, coneG(0.08, 0.5, 5), mat(0xd9e6a0, { flat: true }), Math.cos(a) * 0.3, h, Math.sin(a) * 0.3, Math.cos(a) * 1.2, 0, -Math.sin(a) * 1.2);
    }
    const crown = add(g, icoG(0.55 + t * 0.08, 0), mat(0x3f8f2c, { flat: true, rough: 0.8 }), 0, y + 1.45 + t * 0.1, 0);
    A.head = crown;
    add(g, octG(0.16), glow(c, 2.5), 0, y + 1.95 + t * 0.15, 0);
    return y + 1.7;
  },
  mushroom(g, c, y, t, A) {
    add(g, cylG(0.22, 0.3, 1.1, 10), mat(0xe9ddc0), 0, y + 0.55, 0);
    const cap = add(g, sphG(0.85 + t * 0.08, 18, 10), mat(0x8a3fb0, { rough: 0.6 }), 0, y + 1.15, 0, 0, 0, 0, [1, 0.55, 1]);
    for (let i = 0; i < 7; i++) {
      const a = i * 0.9;
      add(g, sphG(0.1, 8, 6), glow(0xb6ff6a, 1.6), Math.cos(a) * 0.55, y + 1.42, Math.sin(a) * 0.55);
    }
    for (let i = 0; i < t; i++) add(g, sphG(0.35, 12, 8), mat(0x6e2f93), Math.cos(i * 2.1) * 0.75, y + 0.35, Math.sin(i * 2.1) * 0.75, 0, 0, 0, [1, 0.5, 1]);
    A.bob.push({ obj: cap, amp: 0.04, speed: 1.4 });
    return y + 1.3;
  },
  vine(g, c, y, t, A) {
    for (let i = 0; i < 3 + t; i++) {
      const a = (i / (3 + t)) * Math.PI * 2;
      const v = add(g, torG(0.55, 0.09, 6, 20), mat(0x2f7d32, { flat: true }), Math.cos(a) * 0.2, y + 0.8, Math.sin(a) * 0.2, 0, a, Math.PI / 2.4);
      A.spin.push({ obj: v, axis: 'y', speed: 0.2 });
    }
    add(g, cylG(0.18, 0.28, 1.6, 6), mat(0x3d6b22, { flat: true }), 0, y + 0.8, 0);
    const bloom = add(g, icoG(0.35, 0), glow(0xff4fa3, 1.4), 0, y + 1.75, 0);
    A.head = bloom;
    return y + 1.7;
  },
  tree(g, c, y, t, A) {
    add(g, cylG(0.25, 0.42, 1.8, 8), mat(0x8a6a4a, { flat: true }), 0, y + 0.9, 0);
    for (let i = 0; i < 3; i++) add(g, icoG(0.9 - i * 0.18 + t * 0.06, 1), mat(0x2e8a57 + i * 0x081008, { flat: true, rough: 0.8 }), 0, y + 1.9 + i * 0.5, 0);
    const well = add(g, torG(0.6, 0.05, 6, 30), glow(0x9fe8ff, 2), 0, y + 0.25, 0, Math.PI / 2);
    A.spin.push({ obj: well, axis: 'z', speed: 0.5 });
    for (let i = 0; i < 4; i++) {
      const o = add(g, sphG(0.09, 8, 6), glow(c, 3), Math.cos(i * 1.57) * 1.1, y + 1.7, Math.sin(i * 1.57) * 1.1);
      A.orbit.push({ obj: o, r: 1.1, y: y + 1.7, speed: 0.8, phase: i * 1.57 });
    }
    return y + 2.4;
  },
  worldroot(g, c, y, t, A) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      add(g, coneG(0.25, 1.4, 6), mat(0x5a3e28, { flat: true }), Math.cos(a) * 0.7, y + 0.3, Math.sin(a) * 0.7, Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9);
    }
    add(g, cylG(0.4, 0.65, 2.6, 8), mat(0x6a4a30, { flat: true }), 0, y + 1.3, 0);
    for (let i = 0; i < 4; i++) add(g, icoG(1.1 - i * 0.15, 1), mat(0x2b7a3a + i * 0x0a0a00, { flat: true }), Math.sin(i) * 0.3, y + 2.6 + i * 0.45, Math.cos(i) * 0.3);
    const heart = add(g, octG(0.32), glow(0x9dff6a, 3), 0, y + 1.5, 0.45);
    A.spin.push({ obj: heart, axis: 'y', speed: 1.5 });
    return y + 3.2;
  },
  brazier(g, c, y, t, A) {
    add(g, cylG(0.2, 0.32, 0.9, 8), mat(IRON, { metal: 0.7, rough: 0.4 }), 0, y + 0.45, 0);
    add(g, cylG(0.75 + t * 0.08, 0.35, 0.5, 10), mat(0x3a302a, { metal: 0.6, rough: 0.4 }), 0, y + 1.1, 0);
    const f1 = add(g, coneG(0.5, 1.1 + t * 0.2, 8), glow(0xff7a1a, 3), 0, y + 1.75, 0);
    const f2 = add(g, coneG(0.28, 0.8, 8), glow(0xffd36a, 4), 0, y + 1.7, 0);
    A.flicker.push(f1, f2);
    return y + 1.6;
  },
  wisp(g, c, y, t, A) {
    add(g, cylG(0.15, 0.4, 0.6, 8), mat(STONE, { flat: true }), 0, y + 0.3, 0);
    const core = add(g, sphG(0.45 + t * 0.06, 18, 14), glow(0xff8a2a, 3.5), 0, y + 1.6, 0);
    const shell = add(g, icoG(0.62 + t * 0.06, 1), mat(0xffb04a, { emissive: 0xff5a00, ei: 1.2, transparent: true, opacity: 0.35 }), 0, y + 1.6, 0);
    A.bob.push({ obj: core, amp: 0.15, speed: 2 }, { obj: shell, amp: 0.15, speed: 2 });
    A.spin.push({ obj: shell, axis: 'y', speed: 1.2 });
    A.flicker.push(core);
    return y + 1.6;
  },
  mortar(g, c, y, t, A) {
    add(g, cylG(0.7, 0.8, 0.4, 10), mat(0x40332c, { metal: 0.5 }), 0, y + 0.2, 0);
    const head = new THREE.Group(); head.position.y = y + 0.5; g.add(head);
    add(head, cylG(0.45, 0.6, 1.1, 12), mat(0x2d2a2a, { metal: 0.6, rough: 0.35 }), 0, 0.45, 0.15, -0.5, 0, 0);
    add(head, torG(0.47, 0.08, 6, 16), mat(BRASS, { metal: 0.8, rough: 0.3 }), 0, 0.85, 0.35, Math.PI / 2 - 0.5, 0, 0);
    add(head, cylG(0.38, 0.38, 0.05, 12), glow(0xff5a1a, 3), 0, 0.98, 0.42, -0.5, 0, 0);
    A.head = head; A.headYaw = true;
    return y + 1.4;
  },
  roost(g, c, y, t, A) {
    add(g, cylG(0.3, 0.45, 1.8, 6), mat(0x4a3428, { flat: true }), 0, y + 0.9, 0);
    add(g, torG(0.7, 0.18, 6, 12), mat(0x3a2a20, { flat: true }), 0, y + 1.85, 0, Math.PI / 2);
    const bird = new THREE.Group(); bird.position.y = y + 2.3; g.add(bird);
    add(bird, sphG(0.3, 12, 10), glow(0xff6a1a, 2.6), 0, 0, 0, 0, 0, 0, [1, 0.9, 1.5]);
    const wl = add(bird, boxG(1.2, 0.04, 0.45), glow(0xffa33a, 2.4), -0.65, 0.1, 0, 0, 0, 0.3);
    const wr = add(bird, boxG(1.2, 0.04, 0.45), glow(0xffa33a, 2.4), 0.65, 0.1, 0, 0, 0, -0.3);
    A.flap.push({ l: wl, r: wr, speed: 4 });
    A.head = bird; A.headYaw = true;
    A.bob.push({ obj: bird, amp: 0.12, speed: 1.6 });
    return y + 2.3;
  },
  forge(g, c, y, t, A) {
    add(g, boxG(1.4, 1.2, 1.4), mat(0x3c3236, { flat: true, metal: 0.4 }), 0, y + 0.6, 0);
    add(g, coneG(0.95, 1.2, 4), mat(0x2a2326, { flat: true, metal: 0.4 }), 0, y + 1.8, 0, 0, Math.PI / 4);
    add(g, boxG(0.7, 0.5, 0.05), glow(0xff5a12, 3.5), 0, y + 0.55, 0.71);
    const ring = add(g, torG(0.9, 0.06, 6, 40), glow(0xff8a2a, 2.5), 0, y + 3.0, 0, Math.PI / 2);
    const rock = add(g, dodG(0.4), mat(0x2a1a14, { emissive: 0xff4a0a, ei: 1.6, flat: true }), 0, y + 3.0, 0);
    A.spin.push({ obj: ring, axis: 'z', speed: 1 }, { obj: rock, axis: 'y', speed: 0.7 });
    A.bob.push({ obj: rock, amp: 0.2, speed: 1.2 });
    return y + 3;
  },
  crystal(g, c, y, t, A) {
    const main = add(g, octG(0.55), mat(0xbfefff, { emissive: 0x4fc8ff, ei: 0.9, rough: 0.15, metal: 0.1 }), 0, y + 1.3 + t * 0.15, 0, 0, 0, 0, [0.7, 1.9 + t * 0.25, 0.7]);
    for (let i = 0; i < 3 + t; i++) {
      const a = (i / (3 + t)) * Math.PI * 2;
      add(g, octG(0.25), mat(0xa8e6ff, { emissive: 0x3fb0ff, ei: 0.6, rough: 0.2 }), Math.cos(a) * 0.55, y + 0.5, Math.sin(a) * 0.55, Math.cos(a) * 0.4, 0, Math.sin(a) * 0.4, [0.7, 1.6, 0.7]);
    }
    A.spin.push({ obj: main, axis: 'y', speed: 0.6 });
    A.head = main;
    return y + 2.4;
  },
  totem(g, c, y, t, A) {
    for (let i = 0; i < 3; i++) {
      add(g, boxG(0.7 - i * 0.08, 0.6, 0.7 - i * 0.08), mat(0x8fa4b8, { flat: true }), 0, y + 0.3 + i * 0.6, 0, 0, i * 0.4);
      add(g, boxG(0.3, 0.1, 0.05), glow(0x9fe8ff, 2.5), 0, y + 0.35 + i * 0.6, 0.36 - i * 0.04, 0, i * 0.4);
    }
    const flakes = new THREE.Group(); flakes.position.y = y + 2.1; g.add(flakes);
    for (let i = 0; i < 6 + t * 2; i++) add(flakes, octG(0.08), glow(0xe8fbff, 2), Math.cos(i) * (0.6 + (i % 3) * 0.2), (i % 4) * 0.25 - 0.3, Math.sin(i) * (0.6 + (i % 3) * 0.2));
    A.spin.push({ obj: flakes, axis: 'y', speed: 1.5 });
    return y + 2.1;
  },
  prism(g, c, y, t, A) {
    add(g, cylG(0.5, 0.6, 0.4, 3), mat(0x9db8c8, { flat: true }), 0, y + 0.2, 0);
    const p = add(g, cylG(0.05, 0.6, 1.8, 3), mat(0xeaffff, { emissive: 0x7fdcff, ei: 0.8, rough: 0.05, metal: 0.2, transparent: true, opacity: 0.85 }), 0, y + 1.3, 0);
    const d = add(g, octG(0.22), glow(0xffffff, 3), 0, y + 2.4, 0);
    A.spin.push({ obj: p, axis: 'y', speed: 0.4 }, { obj: d, axis: 'y', speed: -2 });
    A.bob.push({ obj: d, amp: 0.1, speed: 2 });
    return y + 2.4;
  },
  obelisk(g, c, y, t, A) {
    add(g, cylG(0.3, 0.55, 2.4, 4), mat(0x6f8fa8, { flat: true, rough: 0.5 }), 0, y + 1.2, 0, 0, Math.PI / 4);
    add(g, coneG(0.3, 0.6, 4), mat(0xbfefff, { emissive: 0x5fd0ff, ei: 1.5 }), 0, y + 2.7, 0, 0, Math.PI / 4);
    for (let i = 0; i < 2; i++) {
      const r = add(g, torG(0.75 - i * 0.15, 0.04, 6, 32), glow(0x7fe0ff, 2.2), 0, y + 1.4 + i * 0.6, 0, Math.PI / 2);
      A.spin.push({ obj: r, axis: 'x', speed: 0.8 + i * 0.5 });
    }
    return y + 2.8;
  },
  titan(g, c, y, t, A) {
    add(g, boxG(1.0, 1.4, 0.7), mat(0x9fc8e0, { flat: true, emissive: 0x2f6f9f, ei: 0.3 }), 0, y + 1.1, 0);
    add(g, boxG(0.5, 0.5, 0.5), mat(0xbfe6ff, { flat: true }), 0, y + 2.1, 0);
    add(g, boxG(0.3, 0.06, 0.05), glow(0x9fffff, 4), 0, y + 2.15, 0.26);
    for (const s of [-1, 1]) {
      add(g, boxG(0.35, 1.1, 0.35), mat(0x8fb8d0, { flat: true }), s * 0.7, y + 1.0, 0, 0, 0, s * 0.2);
      add(g, octG(0.3), mat(0xdff8ff, { emissive: 0x7fdfff, ei: 1.2 }), s * 0.85, y + 0.35, 0);
    }
    add(g, boxG(0.35, 0.6, 0.35), mat(0x7fa8c0, { flat: true }), -0.25, y + 0.3, 0);
    add(g, boxG(0.35, 0.6, 0.35), mat(0x7fa8c0, { flat: true }), 0.25, y + 0.3, 0);
    const halo = add(g, torG(0.6, 0.04, 6, 32), glow(0xbff6ff, 3), 0, y + 2.6, 0, Math.PI / 2);
    A.spin.push({ obj: halo, axis: 'z', speed: 1 });
    A.bob.push({ obj: halo, amp: 0.08, speed: 1.5 });
    return y + 2.4;
  },
  coil(g, c, y, t, A) {
    add(g, cylG(0.18, 0.3, 2.0, 8), mat(IRON, { metal: 0.8, rough: 0.3 }), 0, y + 1.0, 0);
    for (let i = 0; i < 4 + t; i++) add(g, torG(0.45 - i * 0.04, 0.06, 6, 20), mat(0xb87333, { metal: 0.9, rough: 0.25 }), 0, y + 0.4 + i * 0.32, 0, Math.PI / 2);
    const orb = add(g, sphG(0.35, 16, 12), glow(0xc8a8ff, 3.5), 0, y + 2.3, 0);
    A.flicker.push(orb);
    return y + 2.3;
  },
  spire(g, c, y, t, A) {
    add(g, coneG(0.5, 2.6 + t * 0.2, 5), mat(0xd0d6f0, { flat: true, rough: 0.4 }), 0, y + 1.3, 0);
    const blades = new THREE.Group(); blades.position.y = y + 1.4; g.add(blades);
    for (let i = 0; i < 3; i++) add(blades, boxG(1.6, 0.05, 0.25), mat(0xe8f0ff, { metal: 0.7, rough: 0.2 }), 0, i * 0.4, 0, 0, (i * Math.PI) / 3, 0.15);
    A.spin.push({ obj: blades, axis: 'y', speed: 4 });
    add(g, octG(0.16), glow(c, 3), 0, y + 2.8 + t * 0.2, 0);
    return y + 2.6;
  },
  rod(g, c, y, t, A) {
    add(g, cylG(0.08, 0.12, 2.6, 6), mat(0x8890a0, { metal: 0.9, rough: 0.25 }), 0, y + 1.3, 0);
    for (let i = 0; i < 3; i++) add(g, coneG(0.06, 0.6, 4), mat(0x8890a0, { metal: 0.9 }), Math.cos(i * 2.1) * 0.25, y + 2.5, Math.sin(i * 2.1) * 0.25, Math.sin(i * 2.1) * 0.5, 0, -Math.cos(i * 2.1) * 0.5);
    const cloud = new THREE.Group(); cloud.position.y = y + 3.1; g.add(cloud);
    for (let i = 0; i < 4; i++) add(cloud, sphG(0.35, 10, 8), mat(0x50506a, { emissive: 0x6a50ff, ei: 0.4 }), Math.cos(i * 1.6) * 0.35, 0, Math.sin(i * 1.6) * 0.35);
    A.spin.push({ obj: cloud, axis: 'y', speed: 0.6 });
    return y + 2.7;
  },
  drum(g, c, y, t, A) {
    add(g, cylG(0.85, 0.85, 1.0, 16), mat(0x7a3a2a, { rough: 0.6 }), 0, y + 0.6, 0);
    add(g, cylG(0.88, 0.88, 0.05, 16), mat(0xe8dcc0), 0, y + 1.12, 0);
    for (let i = 0; i < 8; i++) add(g, boxG(0.04, 1.0, 0.04), mat(BRASS, { metal: 0.8 }), Math.cos(i * 0.785) * 0.87, y + 0.6, Math.sin(i * 0.785) * 0.87);
    const sigil = add(g, torG(0.4, 0.05, 6, 6), glow(c, 3), 0, y + 1.16, 0, Math.PI / 2);
    A.spin.push({ obj: sigil, axis: 'z', speed: 1 });
    A.pulse.push(sigil);
    return y + 1.3;
  },
  eye(g, c, y, t, A) {
    add(g, cylG(0.25, 0.45, 1.4, 6), mat(STONE_D, { flat: true }), 0, y + 0.7, 0);
    const eye = new THREE.Group(); eye.position.y = y + 2.0; g.add(eye);
    add(eye, sphG(0.55, 20, 16), mat(0x1a1020, { rough: 0.3, metal: 0.3 }), 0, 0, 0);
    add(eye, sphG(0.25, 16, 12), glow(c, 3.5), 0, 0, 0.42, 0, 0, 0, [1, 1, 0.4]);
    add(eye, sphG(0.1, 10, 8), mat(0x000000), 0, 0, 0.53);
    for (let i = 0; i < 2; i++) {
      const r = add(g, torG(0.8 + i * 0.15, 0.04, 6, 40), glow(c, 2), 0, y + 2.0, 0, Math.PI / 2 + i * 0.6, i);
      A.spin.push({ obj: r, axis: i ? 'x' : 'y', speed: 1 + i });
    }
    A.head = eye; A.headYaw = true;
    A.bob.push({ obj: eye, amp: 0.1, speed: 1.3 });
    return y + 2.0;
  },
  cannon(g, c, y, t, A) {
    add(g, cylG(0.65, 0.75, 0.4, 10), mat(0x50463e, { metal: 0.5, flat: true }), 0, y + 0.2, 0);
    const head = new THREE.Group(); head.position.y = y + 0.75; g.add(head);
    add(head, sphG(0.5, 14, 10), mat(0x3a3a40, { metal: 0.7, rough: 0.35 }), 0, 0, 0);
    add(head, cylG(0.2 + t * 0.03, 0.28 + t * 0.03, 1.3 + t * 0.15, 12), mat(0x2a2a30, { metal: 0.8, rough: 0.3 }), 0, 0.05, 0.65, Math.PI / 2, 0, 0);
    add(head, torG(0.27, 0.06, 6, 16), mat(BRASS, { metal: 0.9, rough: 0.25 }), 0, 0.05, 1.25 + t * 0.07);
    A.head = head; A.headYaw = true;
    return y + 1;
  },
  ballista(g, c, y, t, A) {
    add(g, boxG(0.8, 0.5, 0.8), mat(WOOD_D, { flat: true }), 0, y + 0.25, 0);
    const head = new THREE.Group(); head.position.y = y + 0.8; g.add(head);
    add(head, boxG(0.25, 0.2, 2.0), mat(WOOD, { flat: true }), 0, 0, 0.2);
    add(head, boxG(2.0 + t * 0.2, 0.12, 0.15), mat(WOOD_D, { flat: true }), 0, 0.05, 0.8, 0, 0, 0);
    add(head, cylG(0.04, 0.04, 1.8, 6), mat(IRON, { metal: 0.8 }), 0, 0.15, 0.4, Math.PI / 2);
    add(head, coneG(0.08, 0.3, 6), glow(c, 1.5), 0, 0.15, 1.4, Math.PI / 2);
    A.head = head; A.headYaw = true;
    return y + 1;
  },
  press(g, c, y, t, A) {
    add(g, boxG(1.3, 0.9, 1.0), mat(0x5a4a3a, { flat: true, metal: 0.4 }), 0, y + 0.45, 0);
    add(g, cylG(0.12, 0.12, 1.6, 8), mat(IRON, { metal: 0.9 }), -0.45, y + 1.5, 0);
    add(g, cylG(0.12, 0.12, 1.6, 8), mat(IRON, { metal: 0.9 }), 0.45, y + 1.5, 0);
    const ram = add(g, boxG(1.1, 0.35, 0.7), mat(0x6a6a72, { metal: 0.8, rough: 0.3 }), 0, y + 1.6, 0);
    A.press = ram;
    const coin = add(g, cylG(0.35, 0.35, 0.06, 20), mat(0xffd34a, { metal: 1, rough: 0.2, emissive: 0xffa000, ei: 0.5 }), 0, y + 2.6, 0, Math.PI / 2);
    A.spin.push({ obj: coin, axis: 'y', speed: 2 });
    A.bob.push({ obj: coin, amp: 0.12, speed: 2 });
    return y + 1.6;
  },
  gatling(g, c, y, t, A) {
    add(g, cylG(0.6, 0.8, 0.5, 8), mat(0x3a3a40, { metal: 0.6, flat: true }), 0, y + 0.25, 0);
    const head = new THREE.Group(); head.position.y = y + 0.95; g.add(head);
    add(head, boxG(0.9, 0.6, 0.9), mat(0x4a4a52, { metal: 0.7, rough: 0.35 }), 0, 0, 0);
    const barrels = new THREE.Group(); barrels.position.set(0, 0, 0.6); head.add(barrels);
    for (let i = 0; i < 6; i++) add(barrels, cylG(0.07, 0.07, 1.3, 6), mat(0x2a2a2e, { metal: 0.9, rough: 0.2 }), Math.cos(i * 1.047) * 0.18, Math.sin(i * 1.047) * 0.18, 0.5, Math.PI / 2);
    add(barrels, torG(0.24, 0.05, 6, 16), mat(BRASS, { metal: 0.9 }), 0, 0, 1.0);
    A.head = head; A.headYaw = true; A.barrels = barrels;
    return y + 1.2;
  },
  anvil(g, c, y, t, A) {
    add(g, boxG(0.9, 0.7, 0.7), mat(0x2e2a2a, { metal: 0.8, rough: 0.35 }), 0, y + 0.35, 0);
    add(g, boxG(1.8, 0.45, 0.9), mat(0x3a3434, { metal: 0.85, rough: 0.3 }), 0, y + 0.9, 0);
    add(g, coneG(0.35, 0.8, 4), mat(0x3a3434, { metal: 0.85 }), 1.25, y + 0.95, 0, 0, 0, -Math.PI / 2);
    const hammer = new THREE.Group(); hammer.position.set(0, y + 2.6, 0); g.add(hammer);
    add(hammer, cylG(0.08, 0.08, 1.4, 8), mat(WOOD), 0, -0.5, 0);
    add(hammer, boxG(0.9, 0.5, 0.5), mat(0x55555e, { metal: 0.9, rough: 0.25, emissive: 0xff5a1a, ei: 0.4 }), 0, 0.2, 0);
    A.hammer = hammer;
    add(g, boxG(1.82, 0.04, 0.92), glow(0xff6a1a, 2.5), 0, y + 1.14, 0);
    return y + 1.6;
  },
  lens(g, c, y, t, A) {
    add(g, cylG(0.12, 0.2, 1.8, 8), mat(BRASS, { metal: 0.9, rough: 0.25 }), 0, y + 0.9, 0);
    const head = new THREE.Group(); head.position.y = y + 2.0; g.add(head);
    add(head, torG(0.55 + t * 0.06, 0.08, 8, 32), mat(BRASS, { metal: 1, rough: 0.2 }), 0, 0, 0);
    add(head, cylG(0.55 + t * 0.06, 0.55 + t * 0.06, 0.06, 32), mat(0xfff6c8, { emissive: 0xffe36b, ei: 1.8, transparent: true, opacity: 0.8 }), 0, 0, 0, Math.PI / 2);
    A.head = head; A.headYaw = true;
    return y + 2.0;
  },
  orrery(g, c, y, t, A) {
    add(g, cylG(0.1, 0.25, 1.6, 8), mat(BRASS, { metal: 0.9, rough: 0.3 }), 0, y + 0.8, 0);
    add(g, sphG(0.35, 16, 12), glow(0xfff0a0, 3), 0, y + 1.9, 0);
    for (let i = 0; i < 2 + t; i++) {
      const r = 0.7 + i * 0.3;
      const ring = add(g, torG(r, 0.02, 4, 48), mat(BRASS, { metal: 1, rough: 0.3 }), 0, y + 1.9, 0, Math.PI / 2 + i * 0.25);
      ring.castShadow = false;
      const moon = add(g, sphG(0.12 + i * 0.02, 12, 10), mat(0xd8e0ff, { emissive: 0x8fa8ff, ei: 0.8 }), r, y + 1.9, 0);
      A.orbit.push({ obj: moon, r, y: y + 1.9, speed: 1.2 - i * 0.25, phase: i * 2, tilt: i * 0.25 });
    }
    return y + 1.9;
  },
  sunprism(g, c, y, t, A) {
    add(g, cylG(0.4, 0.55, 0.6, 6), mat(0xd8c890, { flat: true, metal: 0.4 }), 0, y + 0.3, 0);
    const head = new THREE.Group(); head.position.y = y + 1.6; g.add(head);
    add(head, octG(0.6), mat(0xfff4c0, { emissive: 0xffb02a, ei: 1.6, rough: 0.1, transparent: true, opacity: 0.9 }), 0, 0, 0, 0, 0, 0, [0.8, 1.3, 0.8]);
    for (let i = 0; i < 3; i++) {
      const s = add(g, boxG(0.08, 1.1, 0.08), mat(BRASS, { metal: 0.9 }), Math.cos(i * 2.09) * 0.45, y + 0.95, Math.sin(i * 2.09) * 0.45, Math.sin(i * 2.09) * 0.3, 0, -Math.cos(i * 2.09) * 0.3);
      s.castShadow = true;
    }
    A.spin.push({ obj: head, axis: 'y', speed: 0.8 });
    A.bob.push({ obj: head, amp: 0.1, speed: 1.8 });
    return y + 1.6;
  },
  seer(g, c, y, t, A) {
    add(g, cylG(0.35, 0.6, 2.8, 4), mat(0x3a3450, { flat: true, rough: 0.5 }), 0, y + 1.4, 0, 0, Math.PI / 4);
    for (let i = 0; i < 4; i++) add(g, boxG(0.06, 0.4, 0.02), glow(0xffe36b, 2.4), Math.cos(i * 1.57 + 0.785) * 0.34, y + 1.2 + i * 0.4, Math.sin(i * 1.57 + 0.785) * 0.34, 0, -i * 1.57 - 0.785);
    const eye = add(g, sphG(0.3, 16, 12), glow(0xffffff, 3), 0, y + 3.3, 0);
    A.bob.push({ obj: eye, amp: 0.15, speed: 1.2 });
    const r = add(g, torG(0.55, 0.03, 6, 32), glow(0xffe36b, 2.5), 0, y + 3.3, 0, Math.PI / 2);
    A.spin.push({ obj: r, axis: 'x', speed: 1.4 });
    A.bob.push({ obj: r, amp: 0.15, speed: 1.2 });
    return y + 3.0;
  },
  sanctum(g, c, y, t, A) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      add(g, cylG(0.1, 0.12, 2.2, 6), mat(0xe8e0d0, { rough: 0.4 }), Math.cos(a) * 0.8, y + 1.1, Math.sin(a) * 0.8);
    }
    add(g, cylG(1.0, 1.0, 0.15, 6), mat(0xe8e0d0, { rough: 0.4 }), 0, y + 2.25, 0);
    const star = add(g, octG(0.5), glow(0xfff2a0, 4), 0, y + 1.2, 0);
    A.spin.push({ obj: star, axis: 'y', speed: 1.2 });
    A.bob.push({ obj: star, amp: 0.2, speed: 1 });
    for (let i = 0; i < 5; i++) {
      const o = add(g, octG(0.1), glow(0xffffff, 3), 0, y + 2.9, 0);
      A.orbit.push({ obj: o, r: 0.9, y: y + 2.9, speed: 1.5, phase: (i / 5) * Math.PI * 2 });
    }
    return y + 2.4;
  },
  tomb(g, c, y, t, A) {
    add(g, boxG(1.0, 0.25, 0.7), mat(0x55505a, { flat: true }), 0, y + 0.12, 0);
    add(g, boxG(0.8, 1.3 + t * 0.2, 0.3), mat(0x6a6672, { flat: true, rough: 0.9 }), 0, y + 0.9 + t * 0.1, 0);
    add(g, cylG(0.4, 0.4, 0.3, 12, 1), mat(0x6a6672, { flat: true }), 0, y + 1.55 + t * 0.2, 0, Math.PI / 2);
    add(g, boxG(0.1, 0.5, 0.04), glow(0xc04dff, 2.5), 0, y + 1.1 + t * 0.1, 0.16);
    add(g, boxG(0.35, 0.1, 0.04), glow(0xc04dff, 2.5), 0, y + 1.2 + t * 0.1, 0.16);
    const ghost = add(g, sphG(0.22, 12, 10), mat(0xd8b0ff, { emissive: 0xa050ff, ei: 1.6, transparent: true, opacity: 0.6 }), 0.6, y + 1.8, 0);
    A.orbit.push({ obj: ghost, r: 0.75, y: y + 1.8, speed: 0.9, phase: 0 });
    return y + 1.8;
  },
  altar(g, c, y, t, A) {
    add(g, boxG(1.3, 0.6, 1.0), mat(0x2a2030, { flat: true }), 0, y + 0.3, 0);
    for (const s of [-1, 1]) add(g, coneG(0.12, 0.9, 5), mat(0x1a1420, { flat: true }), s * 0.55, y + 1.05, 0.35);
    for (const s of [-1, 1]) add(g, coneG(0.12, 0.9, 5), mat(0x1a1420, { flat: true }), s * 0.55, y + 1.05, -0.35);
    const rune = add(g, torG(0.45, 0.04, 4, 5), glow(0xff3fbf, 3), 0, y + 0.65, 0, Math.PI / 2);
    A.spin.push({ obj: rune, axis: 'z', speed: 0.8 });
    const orb = add(g, sphG(0.25, 14, 10), glow(0xc04dff, 3), 0, y + 1.5, 0);
    A.bob.push({ obj: orb, amp: 0.15, speed: 1.5 });
    A.pulse.push(orb);
    return y + 1.5;
  },
  reaper(g, c, y, t, A) {
    const body = add(g, coneG(0.6, 2.2, 8), mat(0x1a1622, { rough: 0.8 }), 0, y + 1.1, 0);
    add(g, sphG(0.32, 14, 10), mat(0x1a1622), 0, y + 2.3, 0);
    add(g, sphG(0.06, 6, 6), glow(0xff3f6a, 4), -0.1, y + 2.33, 0.26);
    add(g, sphG(0.06, 6, 6), glow(0xff3f6a, 4), 0.1, y + 2.33, 0.26);
    const scythe = new THREE.Group(); scythe.position.set(0.6, y + 1.6, 0); g.add(scythe);
    add(scythe, cylG(0.04, 0.04, 2.4, 6), mat(WOOD_D), 0, 0, 0);
    add(scythe, boxG(0.06, 0.18, 1.1), mat(0xd0d0e0, { metal: 1, rough: 0.2, emissive: 0x8040ff, ei: 0.4 }), 0, 1.1, 0.5, 0.3, 0, 0);
    A.head = body; A.bob.push({ obj: body, amp: 0.06, speed: 1 });
    A.scythe = scythe;
    return y + 2.3;
  },
  monolith(g, c, y, t, A) {
    const m = add(g, boxG(0.9, 3.4, 0.5), mat(0x0c0a12, { rough: 0.15, metal: 0.6 }), 0, y + 1.9, 0);
    add(g, boxG(0.92, 0.06, 0.52), glow(0xc04dff, 3), 0, y + 1.2, 0);
    add(g, boxG(0.92, 0.06, 0.52), glow(0xc04dff, 3), 0, y + 2.6, 0);
    const core = add(g, sphG(0.4, 16, 12), mat(0x000000, { emissive: 0x6a1aff, ei: 1, rough: 0 }), 0, y + 4.1, 0);
    const ring = add(g, torG(0.8, 0.05, 6, 40), glow(0xd070ff, 3), 0, y + 4.1, 0, Math.PI / 2);
    A.spin.push({ obj: ring, axis: 'z', speed: 1.4 });
    A.bob.push({ obj: core, amp: 0.15, speed: 1 });
    A.pulse.push(ring);
    return y + 3.6;
  },
};

export function buildTowerModel(def) {
  const g = new THREE.Group();
  const anim = { spin: [], bob: [], orbit: [], flicker: [], flap: [], pulse: [], head: null, headYaw: false };
  const color = ELEMENTS[def.element].color;
  const y = pedestal(g, def.rarity, def.element, def.tier, anim);
  const top = new THREE.Group();
  top.position.y = y;
  g.add(top);
  const s = towerScale(def);
  // A curated model replaces the procedural one; if it is still loading, the
  // procedural model stands in and is swapped out when the file arrives.
  // The top group stands on the dais and scales about its base, so the model
  // grows upward instead of sinking into the steps.
  const onSwap = (muzzleY) => { g.userData.muzzleY = y + muzzleY * s; g.dispatchEvent({ type: 'modelswap' }); };
  let muzzle = def.glb ? attachTowerGlb(top, def.glb, anim, 0, onSwap) : null;
  if (muzzle == null) muzzle = (TOWER_BUILDERS[def.model] || TOWER_BUILDERS.crystal)(top, color, 0, def.tier, anim);
  top.scale.setScalar(s);
  if (def.rarity === 'unique') {
    const halo = add(g, torG(1.5, 0.04, 6, 48), glow(RARITIES.unique.color, 2.5), 0, 0.1, 0, Math.PI / 2);
    anim.spin.push({ obj: halo, axis: 'z', speed: 0.4 });
  }
  // Record base positions for bobbing parts.
  for (const b of anim.bob) b.base = b.obj.position.y;
  g.userData.anim = anim;
  g.userData.muzzleY = y + muzzle * s;
  g.userData.height = y + muzzle * s;
  return g;
}

// ------------------------------------------------------------------ creeps

const RACE_COLORS = {
  undead: { body: 0xcfc6ad, accent: 0x5dff8a, dark: 0x3a3a34 },
  brute: { body: 0x9a5236, accent: 0xffb03a, dark: 0x4a2a1a },
  humanoid: { body: 0x9aa4b4, accent: 0xff4a3a, dark: 0x3a3c48 },
  arcane: { body: 0x6a8cff, accent: 0xa8f0ff, dark: 0x2a2a6a },
  feral: { body: 0x7a6a3a, accent: 0xffe04a, dark: 0x3a3018 },
};
const ARMOR_TINT = { hide: 0x8a5a32, chain: 0x8a98a8, plate: 0xd8dce6, spirit: 0x7fe8ff, divine: 0xffd75e, bare: 0x887070 };

function biped(g, col, armorCol, A, opts = {}) {
  const legL = new THREE.Group(), legR = new THREE.Group();
  legL.position.set(-0.18, 0.62, 0); legR.position.set(0.18, 0.62, 0);
  g.add(legL, legR);
  add(legL, boxG(0.16, 0.6, 0.16), mat(col.dark, { flat: true }), 0, -0.3, 0);
  add(legR, boxG(0.16, 0.6, 0.16), mat(col.dark, { flat: true }), 0, -0.3, 0);
  const torso = add(g, boxG(0.55 * (opts.wide || 1), 0.6, 0.35), mat(opts.torso || col.body, { flat: true }), 0, 0.95, 0);
  add(g, boxG(0.58 * (opts.wide || 1), 0.25, 0.38), mat(armorCol, { metal: 0.6, rough: 0.35, flat: true }), 0, 1.05, 0);
  const armL = new THREE.Group(), armR = new THREE.Group();
  armL.position.set(-0.36 * (opts.wide || 1), 1.18, 0); armR.position.set(0.36 * (opts.wide || 1), 1.18, 0);
  g.add(armL, armR);
  add(armL, boxG(0.13, 0.55, 0.13), mat(col.body, { flat: true }), 0, -0.25, 0);
  add(armR, boxG(0.13, 0.55, 0.13), mat(col.body, { flat: true }), 0, -0.25, 0);
  A.legs.push(legL, legR); A.arms.push(armL, armR);
  return torso;
}

const CREEP_BUILDERS = {
  undead(g, col, armorCol, A) {
    biped(g, col, armorCol, A, { torso: 0x8a8470 });
    add(g, sphG(0.22, 10, 8), mat(BONE, { flat: true }), 0, 1.45, 0);
    add(g, boxG(0.07, 0.05, 0.03), glow(col.accent, 4), -0.08, 1.48, 0.2);
    add(g, boxG(0.07, 0.05, 0.03), glow(col.accent, 4), 0.08, 1.48, 0.2);
  },
  brute(g, col, armorCol, A) {
    const t = biped(g, col, armorCol, A, { wide: 1.5 });
    t.scale.set(1, 1.15, 1.2);
    add(g, sphG(0.22, 10, 8), mat(col.body, { flat: true }), 0, 1.38, 0.15);
    add(g, coneG(0.04, 0.18, 5), mat(BONE), -0.1, 1.3, 0.34, -1.1);
    add(g, coneG(0.04, 0.18, 5), mat(BONE), 0.1, 1.3, 0.34, -1.1);
    add(g, boxG(0.05, 0.04, 0.02), glow(col.accent, 3), -0.08, 1.42, 0.36);
    add(g, boxG(0.05, 0.04, 0.02), glow(col.accent, 3), 0.08, 1.42, 0.36);
  },
  humanoid(g, col, armorCol, A) {
    biped(g, col, armorCol, A);
    add(g, cylG(0.17, 0.2, 0.32, 8), mat(armorCol, { metal: 0.7, rough: 0.3 }), 0, 1.45, 0);
    add(g, boxG(0.25, 0.04, 0.02), glow(col.accent, 3), 0, 1.47, 0.19);
    add(g, coneG(0.06, 0.25, 4), mat(col.accent, { emissive: col.accent, ei: 0.6 }), 0, 1.72, 0);
    add(g, cylG(0.3, 0.3, 0.06, 6), mat(armorCol, { metal: 0.7 }), -0.45, 0.95, 0.1, 0, 0, Math.PI / 2);
  },
  arcane(g, col, armorCol, A) {
    const core = add(g, octG(0.4), mat(col.body, { emissive: col.accent, ei: 1.2, rough: 0.2 }), 0, 1.0, 0, 0, 0, 0, [1, 1.4, 1]);
    A.spin.push({ obj: core, speed: 2 });
    for (let i = 0; i < 3; i++) {
      const s = add(g, octG(0.12), mat(armorCol, { emissive: col.accent, ei: 1.5 }), 0, 1.0, 0);
      A.orbit.push({ obj: s, r: 0.55, y: 1.0, speed: 3, phase: i * 2.09 });
    }
    A.float = true;
  },
  feral(g, col, armorCol, A) {
    add(g, boxG(0.42, 0.38, 1.0), mat(col.body, { flat: true }), 0, 0.68, 0);
    add(g, boxG(0.44, 0.15, 0.6), mat(armorCol, { metal: 0.5, flat: true }), 0, 0.9, -0.05);
    const head = add(g, boxG(0.3, 0.3, 0.42), mat(col.body, { flat: true }), 0, 0.85, 0.62);
    add(g, coneG(0.06, 0.18, 4), mat(col.dark), -0.1, 1.06, 0.55);
    add(g, coneG(0.06, 0.18, 4), mat(col.dark), 0.1, 1.06, 0.55);
    add(g, boxG(0.05, 0.04, 0.02), glow(col.accent, 3), -0.08, 0.9, 0.84);
    add(g, boxG(0.05, 0.04, 0.02), glow(col.accent, 3), 0.08, 0.9, 0.84);
    add(g, boxG(0.08, 0.08, 0.5), mat(col.dark), 0, 0.8, -0.65, 0.5);
    for (const [x, z] of [[-0.16, 0.35], [0.16, 0.35], [-0.16, -0.35], [0.16, -0.35]]) {
      const leg = new THREE.Group(); leg.position.set(x, 0.5, z); g.add(leg);
      add(leg, boxG(0.12, 0.5, 0.12), mat(col.dark, { flat: true }), 0, -0.25, 0);
      A.legs.push(leg);
    }
    A.head = head;
  },
};

function wings(g, col, armorCol, A) {
  add(g, sphG(0.35, 12, 10), mat(col.body, { flat: true }), 0, 0, 0, 0, 0, 0, [0.9, 0.8, 1.5]);
  add(g, sphG(0.2, 10, 8), mat(col.body, { flat: true }), 0, 0.12, 0.5);
  add(g, boxG(0.06, 0.05, 0.02), glow(col.accent, 4), -0.07, 0.17, 0.69);
  add(g, boxG(0.06, 0.05, 0.02), glow(col.accent, 4), 0.07, 0.17, 0.69);
  const wl = new THREE.Group(), wr = new THREE.Group();
  wl.position.x = -0.25; wr.position.x = 0.25; g.add(wl, wr);
  add(wl, boxG(1.1, 0.04, 0.6), mat(armorCol, { flat: true, rough: 0.6 }), -0.55, 0, 0);
  add(wr, boxG(1.1, 0.04, 0.6), mat(armorCol, { flat: true, rough: 0.6 }), 0.55, 0, 0);
  add(g, coneG(0.12, 0.6, 5), mat(col.dark), 0, 0, -0.65, -Math.PI / 2);
  A.flap = { l: wl, r: wr };
}

// Ground creeps use the race's ground model, flyers its air model, and bosses
// (including challenge bosses) its boss model.
function creepModelSpec(creep) {
  const kinds = CREEP_MODEL_MAP[creep.race];
  const v = kinds && (creep.air ? kinds.air : creep.size === 'boss' || creep.size === 'challenge' ? kinds.boss : kinds.ground);
  return v ? (typeof v === 'string' ? { id: v } : v) : null;
}

// Creep models are few and needed from the first wave, so fetch them up front.
export function preloadCreepModels() {
  for (const kinds of Object.values(CREEP_MODEL_MAP)) for (const v of Object.values(kinds)) loadGlb(typeof v === 'string' ? v : v.id);
}

export function buildCreepModel(creep) {
  const outer = new THREE.Group();
  const g = new THREE.Group();
  outer.add(g);
  const col = RACE_COLORS[creep.race];
  const armorCol = ARMOR_TINT[creep.armorType];
  const A = { legs: [], arms: [], spin: [], orbit: [], flap: null, float: false, head: null };
  if (creep.air) {
    const body = new THREE.Group(); body.position.y = 2.6; g.add(body);
    wings(body, col, armorCol, A);
    A.body = body;
  } else {
    (CREEP_BUILDERS[creep.race] || CREEP_BUILDERS.humanoid)(g, col, armorCol, A);
  }
  const size = creep.size;
  // Rings, crowns and halos stay when a curated model replaces the body.
  const keep = (m) => { m.userData.keep = true; return m; };
  const crown = [];
  if (size === 'champion' || size === 'boss' || size === 'challenge') {
    const ring = keep(add(g, torG(0.6, 0.04, 6, 32), glow(size === 'champion' ? 0xb07aff : 0xff4a2a, 2.5), 0, 0.05, 0, Math.PI / 2));
    ring.castShadow = false;
    A.spin.push({ obj: ring, speed: 1.5, axis: 'z' });
    if (size !== 'champion') {
      for (let i = 0; i < 5; i++) {
        crown.push(keep(add(g, coneG(0.05, 0.25, 4), glow(0xffc040, 2), Math.cos(i * 1.256) * 0.18, creep.air ? 3.0 : 1.75, Math.sin(i * 1.256) * 0.18)));
      }
    }
  }
  if (creep.armorType === 'divine') {
    const halo = keep(add(g, torG(0.25, 0.025, 6, 24), glow(0xffd75e, 3), 0, creep.air ? 3.1 : 1.85, 0, Math.PI / 2));
    halo.castShadow = false;
    crown.push(halo);
  }
  const gild = () => {
    if (size === 'challenge' || size === 'challengeMass') {
      g.traverse((m) => { if (m.isMesh && !m.userData.keep && !(m.material.emissiveIntensity && m.material.emissive?.getHex())) m.material = mat(0xffd34a, { metal: 0.9, rough: 0.25 }); });
    }
  };
  // Crowns and halos sit just above whatever model is shown.
  const fitCrown = (top) => { for (const m of crown) m.position.y = top + (m.geometry.type === 'TorusGeometry' ? 0.15 : 0.05); };
  const spec = creepModelSpec(creep);
  if (spec) {
    const top = attachCreepGlb(g, spec, A, creep.air, (late) => { fitCrown(late); gild(); outer.dispatchEvent({ type: 'modelswap' }); });
    if (top != null) fitCrown(top);
  }
  gild();
  const scale = { mass: 0.95, normal: 1.3, air: 1.25, champion: 1.75, boss: 2.6, challenge: 3.2, challengeMass: 1.05 }[size] || 1;
  g.scale.setScalar(scale);
  outer.userData.anim = A;
  outer.userData.inner = g;
  outer.userData.height = (creep.air ? 3.2 : 1.9) * scale;
  return outer;
}

export { RACE_COLORS };
export const raceColor = (race) => RACES[race]?.css;
