// Map theme: the Elemental Realms. The valley is split into seven regions, one
// per element, and the road crosses them in order from the spawn gate to the
// portal: Nature, Fire, Ice, Storm, Iron, Astral, Darkness. Each region has its
// own ground, road surface, scenery and particles; boundaries blend softly.

import * as THREE from 'three';
import { mat, glow } from '../models.js';
import { ELEMENTS, ELEMENT_IDS } from '../../data/constants.js';
import {
  fbm, HALF_X, HALF_Z, distToRoute, outside, onEntryRoad, clearOfRoad as clearOf, nearTileCentre, mk, instanced,
  buildPathRibbon, buildAirLane, riftMaterial, GROUND_ROUTE, BLOCKED_TILES, SPAWN, PORTAL, tileToWorld,
} from './shared.js';

const ROAD_HALF = 1.25;
const SUN_DIR = new THREE.Vector3(0.42, 0.52, -0.74).normalize();
const GATE_X = SPAWN.x - 2.5;
const NATURE = 0, FIRE = 1, ICE = 2, STORM = 3, IRON = 4, ASTRAL = 5, DARK = 6;
const N_REG = ELEMENT_IDS.length;

const clearOfRoad = (x, z, margin) => clearOf(x, z, margin, ROAD_HALF);

// ------------------------------------------------------------------ regions

// Region boundaries as distance along the road (about 24 units each). The ice
// region wraps the east turn, storm holds the middle lane, iron the west turn.
const BOUNDS = [0, 24, 48, 73, 97, 122, 146, GROUND_ROUTE.length];
// Extra anchors outside the field: storm's lane is enclosed by the others, so
// it gets the eastern heights; iron gets the west and darkness the south-east.
const EXTRA = [
  [[SPAWN.x - 14, SPAWN.z, SPAWN.x, SPAWN.z]], [], [], [[46, 0, 100, 6]], [[-42, 3, -100, 6]], [], [[PORTAL.x, PORTAL.z, 90, 22]],
];
const REG_SEGS = ELEMENT_IDS.map((_, i) => {
  const list = [];
  for (const s of GROUND_ROUTE.segs) {
    const t0 = Math.max(0, BOUNDS[i] - s.start), t1 = Math.min(s.len, BOUNDS[i + 1] - s.start);
    if (t1 > t0) list.push({ ax: s.a.x, az: s.a.z, dx: s.dx, dz: s.dz, t0, t1 });
  }
  for (const [x0, z0, x1, z1] of EXTRA[i]) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    list.push({ ax: x0, az: z0, dx: (x1 - x0) / len, dz: (z1 - z0) / len, t0: 0, t1: len });
  }
  return list;
});

// Soft region weights: a softmin over the distance to each region's stretch of
// road. Noise bends the borders away from the road so they look organic, while
// staying close to the road's own boundaries next to it.
const WBUF = new Float32Array(N_REG);
function regionWeights(x, z, out = WBUF) {
  const jit = Math.min(9, distToRoute(x, z) * 0.8);
  let min = Infinity;
  for (let i = 0; i < N_REG; i++) {
    let best = Infinity;
    for (const s of REG_SEGS[i]) {
      const t = Math.max(s.t0, Math.min(s.t1, (x - s.ax) * s.dx + (z - s.az) * s.dz));
      const qx = s.ax + s.dx * t - x, qz = s.az + s.dz * t - z;
      best = Math.min(best, qx * qx + qz * qz);
    }
    out[i] = Math.sqrt(best) + (fbm(x * 0.06 + i * 13.1, z * 0.06 - i * 7.3, 3) - 0.5) * jit;
    min = Math.min(min, out[i]);
  }
  let sum = 0;
  for (let i = 0; i < N_REG; i++) { out[i] = Math.exp(-(out[i] - min) * 0.45); sum += out[i]; }
  for (let i = 0; i < N_REG; i++) out[i] /= sum;
  return out;
}
function dominant(x, z) {
  const w = regionWeights(x, z);
  let best = 0;
  for (let i = 1; i < N_REG; i++) if (w[i] > w[best]) best = i;
  return best;
}

// ------------------------------------------------------------------ height

// Hill roughness and mountain height per region: tall snowy peaks behind the
// ice, low volcanic ground behind the fire so its volcano stands out.
const ROUGH = [0.8, 1.2, 1.0, 1.4, 0.8, 0.9, 1.0];
const PEAK = [0.6, 0.45, 1.3, 1.1, 0.7, 0.8, 0.9];

function baseHeight(x, z) {
  const o = outside(x, z);
  const flat = (fbm(x * 0.15, z * 0.15) - 0.5) * 0.18;
  if (o < 0) return flat;
  const w = regionWeights(x, z);
  let rough = 0, peak = 0;
  for (let i = 0; i < N_REG; i++) { rough += w[i] * ROUGH[i]; peak += w[i] * PEAK[i]; }
  const n = fbm(x * 0.05 + 3, z * 0.05);
  const hills = Math.min(1, Math.max(0, o - 1) / 10) * (1 + n * 3 * rough);
  const peaks = o > 22 ? Math.pow((o - 22) / 40, 1.5) * 42 * peak * fbm(x * 0.03 + 7, z * 0.03, 5) : 0;
  return flat + hills + peaks;
}

// Lava rivers in the fire region, all outside the field: one along the far
// edge and one flowing down from the volcano into it.
const LAVA_W = 0.9;
const VOLCANO = { x: 2, z: -66 };
const LAVA_PATHS = [
  [[-8, -25.5], [-4, -22.6], [0, -23.2], [5, -22.2], [10, -23.6], [15, -24.6]],
  [[2.5, -22.8], [0.5, -29], [4, -36], [1.5, -44], [3.5, -52], [2, -57]],
];
const LAVA = LAVA_PATHS.map((path) => {
  const curve = new THREE.CatmullRomCurve3(path.map(([x, z]) => new THREE.Vector3(x, 0, z)));
  const n = Math.ceil(curve.getLength() / 0.5);
  const pts = curve.getSpacedPoints(n);
  return pts.map((p, i) => {
    const q = pts[Math.min(n, i + 1)], r = pts[Math.max(0, i - 1)];
    const dx = q.x - r.x, dz = q.z - r.z, l = Math.hypot(dx, dz) || 1;
    const nx = -dz / l, nz = dx / l;
    // Surface sits below the lowest bank so it never floats on a slope.
    const y = Math.min(baseHeight(p.x, p.z), baseHeight(p.x + nx * LAVA_W, p.z + nz * LAVA_W), baseHeight(p.x - nx * LAVA_W, p.z - nz * LAVA_W)) - 0.25;
    return { x: p.x, z: p.z, nx, nz, y, u: i * 0.5 * (curve.getLength() / (n * 0.5)) };
  });
});

// Frozen pools in the ice region, also outside the field.
const POOLS = [[21, -24, 2.6], [27, -30, 3.4], [37, -20, 2.4], [41, -33, 3.8], [34, -7, 1.8]].map(([x, z, r]) => {
  let y = baseHeight(x, z);
  for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2; y = Math.min(y, baseHeight(x + Math.cos(a) * r, z + Math.sin(a) * r)); }
  return { x, z, r, y: y - 0.06 };
});

function nearLava(x, z, pad) {
  if (z > -19 || z < -60 || Math.abs(x) > 20) return null;
  let best = null, bd = pad * pad;
  for (const path of LAVA) for (const s of path) {
    const d = (s.x - x) ** 2 + (s.z - z) ** 2;
    if (d < bd) { bd = d; best = s; }
  }
  return best ? { s: best, r: Math.sqrt(bd) } : null;
}
const inPool = (x, z, pad) => POOLS.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + pad);

function terrainHeight(x, z) {
  let h = baseHeight(x, z);
  if (outside(x, z) > 0) {
    const lv = nearLava(x, z, LAVA_W + 1.4);
    if (lv) h = Math.min(h, THREE.MathUtils.lerp(lv.s.y - 0.45, h, THREE.MathUtils.smoothstep(lv.r, LAVA_W * 0.8, LAVA_W + 1.4)));
    for (const p of POOLS) {
      const r = Math.hypot(x - p.x, z - p.z);
      if (r < p.r + 1) h = Math.min(h, THREE.MathUtils.lerp(p.y - 0.25, h, THREE.MathUtils.smoothstep(r, p.r - 0.2, p.r + 1)));
    }
  }
  if (distToRoute(x, z, GROUND_ROUTE) < ROAD_HALF + 0.3 || onEntryRoad(x, z)) h = Math.min(h, -0.04);
  return h;
}

// ------------------------------------------------------------------ terrain

const C = (hex) => new THREE.Color(hex);
// Ground palettes, kept muted so element-coloured towers stand out: base, light, patch.
const GROUND = [
  [C(0x4a742c), C(0x64903c), C(0x3a5a24)],   // nature: meadow, sunlit grass, shade
  [C(0x2e2826), C(0x403632), C(0x655d58)],   // fire: basalt, warm basalt, ash
  [C(0x7e8ea2), C(0x8c9cb0), C(0x64809e)],   // ice: snow, bright snow, blue ice (kept below the bloom threshold)
  [C(0x3e4250), C(0x323644), C(0x5a6072)],   // storm: slate, dark slate, pale streaks
  [C(0x584a3e), C(0x4c4844), C(0x76502f)],   // iron: rusty earth, grey grit, rust
  [C(0x30344f), C(0x3b4062), C(0x4b4878)],   // astral: violet dusk, lilac, glow patch
  [C(0x201b22), C(0x2a2130), C(0x3a2a48)],   // darkness: blight, ash, purple rot
];
const PEAK_COL = [C(0x4a5040), C(0x231d1d), C(0xaab6c4), C(0x2e3240), C(0x4c4642), C(0x3a3052), C(0x1c171e)];

function groundColor(i, x, z, h, n, out) {
  const [a, b, p] = GROUND[i];
  out.copy(a).lerp(b, n).lerp(p, Math.max(0, fbm(x * 0.09 + i * 5, z * 0.09) - 0.42) * 1.8);
  out.multiplyScalar(0.86 + fbm(x * 0.5, z * 0.5) * 0.28);
  if (i === FIRE && nearLava(x, z, 4)) out.lerp(C(0x4a2418), 0.5);        // scorched banks
  if (i === ICE && h > 1.5) out.lerp(PEAK_COL[ICE], Math.min(1, (h - 1.5) / 5));
  if (h > 7) out.lerp(PEAK_COL[i], Math.min(1, (h - 7) / 8));
  return out;
}

function buildTerrain() {
  const W = 280, D = 220, SX = 210, SZ = 165;
  const geo = new THREE.PlaneGeometry(W, D, SX, SZ);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3), glows = new Float32Array(pos.count * 4);
  const c = new THREE.Color(), t = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = terrainHeight(x, z);
    const n = fbm(x * 0.3, z * 0.3);
    const w = Float32Array.from(regionWeights(x, z));
    c.setRGB(0, 0, 0);
    for (let r = 0; r < N_REG; r++) if (w[r] > 0.01) c.add(groundColor(r, x, z, h, n, t).multiplyScalar(w[r]));
    // A darker shoulder outlines the road in every region.
    const pd = distToRoute(x, z, GROUND_ROUTE);
    if (pd < ROAD_HALF + 1.0) c.multiplyScalar(0.72 + 0.28 * Math.max(0, (pd - ROAD_HALF) / 1.0));
    if (onEntryRoad(x, z)) c.multiplyScalar(0.7);
    pos.setY(i, h);
    colors.set([c.r, c.g, c.b], i * 3);
    glows.set([w[FIRE], w[ASTRAL], w[DARK], w[STORM]], i * 4);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aGlow', new THREE.BufferAttribute(glows, 4));
  geo.computeVertexNormals();
  // Glowing details drawn in the shader: lava cracks in the fire region, star
  // specks in the astral region, purple veins in the darkness, and arcs that
  // flicker across the storm slate. Cracks, veins and arcs skip tile centres so
  // nothing glows under a tower.
  const uniforms = { uTime: { value: 0 } };
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aGlow; varying vec4 vGlow; varying vec2 vXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow; vXZ = (modelMatrix * vec4(position, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uTime; varying vec4 vGlow; varying vec2 vXZ;
        vec2 th2(vec2 p){ p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
        float tn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(th2(i).x, th2(i+vec2(1,0)).x, f.x), mix(th2(i+vec2(0,1)).x, th2(i+vec2(1,1)).x, f.x), f.y); }
        float cellEdge(vec2 q){
          vec2 cell = floor(q), f = fract(q); float d1 = 8.0, d2 = 8.0;
          for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
            vec2 g = vec2(float(x), float(y)); float dd = length(g + th2(cell + g) - f);
            if (dd < d1) { d2 = d1; d1 = dd; } else if (dd < d2) d2 = dd;
          }
          return d2 - d1;
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec2 p = vXZ;
          vec2 tf = abs(fract(p / 2.0) - 0.5);
          float inField = step(abs(p.x), 30.0) * step(abs(p.y), 16.0);
          float allow = 1.0 - inField * (1.0 - smoothstep(0.24, 0.34, max(tf.x, tf.y)));
          float width = mix(0.09, 0.045, inField);
          vec3 g = vec3(0.0);
          float fire = smoothstep(0.35, 0.75, vGlow.x);
          if (fire > 0.0) {
            float e = 1.0 - smoothstep(0.0, width, cellEdge(p * 0.6));
            float flow = 0.65 + 0.35 * sin(uTime * 1.3 + p.x * 0.45 + p.y * 0.3);
            g += vec3(1.0, 0.3, 0.05) * e * smoothstep(0.42, 0.6, tn(p * 0.25)) * flow * fire * allow * 1.5;
          }
          float dark = smoothstep(0.35, 0.75, vGlow.z);
          if (dark > 0.0) {
            float e = 1.0 - smoothstep(0.0, width * 0.6, cellEdge(p * 0.8 + 7.0));
            g += vec3(0.5, 0.12, 0.9) * e * smoothstep(0.66, 0.78, tn(p * 0.22 + 3.0)) * (0.6 + 0.4 * sin(uTime * 0.8 + p.x * 0.2)) * dark * allow * mix(0.35, 0.15, inField);
          }
          float storm = smoothstep(0.35, 0.75, vGlow.w);
          if (storm > 0.0) {
            // Each patch of ground arcs briefly at random moments.
            vec2 zone = floor(p * 0.25);
            float k = floor(uTime * 2.5 + th2(zone).x * 10.0);
            float on = step(0.86, th2(zone + k * 0.37).y);
            float e = 1.0 - smoothstep(0.0, width * 0.7, cellEdge(p * 0.9 + 11.0 + k));
            g += vec3(0.55, 0.6, 1.0) * e * on * storm * allow * 1.8;
          }
          float astral = smoothstep(0.35, 0.75, vGlow.y);
          if (astral > 0.0) {
            vec2 sc = floor(p * 2.2); vec2 r = th2(sc);
            float star = step(0.93, r.x) * smoothstep(0.1, 0.0, length(fract(p * 2.2) - 0.2 - 0.6 * th2(sc + 3.1)));
            g += mix(vec3(1.0, 0.85, 0.4), vec3(0.75, 0.6, 1.0), r.y) * star * (0.4 + 0.6 * sin(uTime * 2.0 + r.y * 40.0)) * astral * 1.6;
          }
          totalEmissiveRadiance += g;
        }`);
  };
  const m = new THREE.Mesh(geo, material);
  m.receiveShadow = true;
  return { mesh: m, uniforms };
}

// ------------------------------------------------------------------ road

// Road surface per region, authored in sRGB: stone A, stone B, mortar, mortar
// glow (colour, strength), metal plates instead of stones, roughness, metalness.
const ROAD = [
  { a: 0x6c6c5e, b: 0x8c8a76, m: 0x34461e, g: 0x000000, gs: 0, grid: 0, rough: 0.92, metal: 0 },     // mossy flagstones
  { a: 0x6a5446, b: 0x8a7262, m: 0x2a1410, g: 0xff5a14, gs: 1.6, grid: 0, rough: 0.85, metal: 0 },   // ash pavers, molten seams
  { a: 0x4e7ea8, b: 0x6a98c0, m: 0xa4bccf, g: 0x7fd8ff, gs: 0.1, grid: 0, rough: 0.65, metal: 0 }, // ice slabs, frost seams
  { a: 0x545a6a, b: 0x6c7284, m: 0x1c1e28, g: 0x8a9aff, gs: 0.45, grid: 0, rough: 0.8, metal: 0 },    // slate, charged seams
  { a: 0x84888e, b: 0xa2a6ac, m: 0x26241f, g: 0x000000, gs: 0, grid: 1, rough: 0.5, metal: 0.45 },   // steel grating
  { a: 0xa496cc, b: 0xc4b8e6, m: 0x4a3a2a, g: 0xffd86a, gs: 0.9, grid: 0, rough: 0.4, metal: 0.05 }, // crystal tiles
  { a: 0x86806f, b: 0xa29a88, m: 0x1c181e, g: 0xa040ff, gs: 0.35, grid: 0, rough: 0.9, metal: 0 },   // bone-grey stone
];
const v3 = (hex) => new THREE.Vector3(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);

function buildRoad() {
  const segs = GROUND_ROUTE.segs;
  const uniforms = {
    uA: { value: segs.map((s) => new THREE.Vector2(s.a.x, s.a.z)) },
    uB: { value: segs.map((s) => new THREE.Vector2(s.b.x, s.b.z)) },
    uS: { value: segs.map((s) => s.start) },
    uHalf: { value: ROAD_HALF }, uSpawn: { value: new THREE.Vector2(SPAWN.x, SPAWN.z) }, uEdgeX: { value: -HALF_X },
    uBounds: { value: BOUNDS.slice() }, uTime: { value: 0 },
    uStA: { value: ROAD.map((r) => v3(r.a)) }, uStB: { value: ROAD.map((r) => v3(r.b)) }, uMor: { value: ROAD.map((r) => v3(r.m)) },
    uGlo: { value: ROAD.map((r) => new THREE.Color(r.g).multiplyScalar(r.gs)) },
    uGrid: { value: ROAD.map((r) => r.grid) }, uRgh: { value: ROAD.map((r) => r.rough) }, uMtl: { value: ROAD.map((r) => r.metal) },
  };
  const NS = segs.length;
  const material = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vRoad;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRoad = (modelMatrix * vec4(position, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vRoad;
        uniform vec2 uA[${NS}]; uniform vec2 uB[${NS}]; uniform float uS[${NS}]; uniform float uHalf; uniform vec2 uSpawn; uniform float uEdgeX;
        uniform float uBounds[8]; uniform float uTime;
        uniform vec3 uStA[7]; uniform vec3 uStB[7]; uniform vec3 uMor[7]; uniform vec3 uGlo[7]; uniform float uGrid[7]; uniform float uRgh[7]; uniform float uMtl[7];
        vec2 rh2(vec2 p){ p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 roadGlow = vec3(0.0); float roadRough = 0.9; float roadMetal = 0.0;
        {
          vec2 p = vRoad;
          float d = 1e9, along = 0.0;
          for (int i = 0; i < ${NS}; i++) {
            vec2 pa = p - uA[i], ba = uB[i] - uA[i];
            float L = length(ba); float t = clamp(dot(pa, ba) / (L * L), 0.0, 1.0);
            float dd = length(pa - ba * t);
            if (dd < d) { d = dd; along = uS[i] + t * L; }
          }
          if (p.x < uEdgeX + 3.0 && p.x > uSpawn.x - 14.0 && abs(p.y - uSpawn.y) < d) { d = abs(p.y - uSpawn.y); along = 0.0; }
          // Blend the region materials over a few units around each boundary.
          vec3 sA = vec3(0.0), sB = vec3(0.0), mo = vec3(0.0), gl = vec3(0.0); float gr = 0.0;
          for (int k = 0; k < 7; k++) {
            float w = (k == 0 ? 1.0 : smoothstep(uBounds[k] - 2.5, uBounds[k] + 2.5, along))
                    * (k == 6 ? 1.0 : 1.0 - smoothstep(uBounds[k + 1] - 2.5, uBounds[k + 1] + 2.5, along));
            sA += uStA[k] * w; sB += uStB[k] * w; mo += uMor[k] * w; gl += uGlo[k] * w;
            gr += uGrid[k] * w; roadRough += (uRgh[k] - 0.9) * w; roadMetal += uMtl[k] * w;
          }
          // Flagstones: jittered cells, mortar where the two nearest centres are about equally far.
          vec2 q = p * 1.15; vec2 cell = floor(q); vec2 f = fract(q);
          float d1 = 8.0, d2 = 8.0; vec2 id = vec2(0.0);
          for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
            vec2 g = vec2(float(x), float(y)); vec2 o = rh2(cell + g) * 0.8 + 0.1;
            float dd = length(g + o - f);
            if (dd < d1) { d2 = d1; d1 = dd; id = cell + g; } else if (dd < d2) d2 = dd;
          }
          vec2 r = rh2(id);
          // Ragged border where stones drop out; plates keep a straight edge.
          if (d + (r.x - 0.5) * 0.35 * (1.0 - gr) > uHalf) discard;
          float mortar = smoothstep(0.04, 0.12, d2 - d1);
          vec3 stone = mix(sA, sB, r.x) * (0.85 + 0.25 * r.y) * (0.88 + 0.12 * smoothstep(0.0, 0.5, d1));
          vec3 col = mix(mo, stone, mortar);
          // Steel plates with seams, corner rivets and a diagonal tread.
          vec2 gq = p * 0.9; vec2 gf = fract(gq); vec2 gr2 = rh2(floor(gq));
          float seam = smoothstep(0.02, 0.06, min(min(gf.x, 1.0 - gf.x), min(gf.y, 1.0 - gf.y)));
          float rivet = smoothstep(0.07, 0.035, length(abs(gf - 0.5) - 0.37));
          float tread = step(0.5, fract((gf.x + gf.y) * 7.0)) * 0.07;
          vec3 plate = mix(sA, sB, gr2.x) * (0.88 + tread + 0.12 * gr2.y);
          plate = mix(plate, sB * 1.15, rivet);
          col = mix(col, mix(mo, plate, seam), gr);
          float seamMask = mix(mortar, seam, gr);
          col *= mix(1.0, 0.72, smoothstep(uHalf - 0.35, uHalf, d));
          roadGlow = pow(gl, vec3(1.0)) * (1.0 - seamMask) * (0.7 + 0.3 * sin(uTime * 1.8 + along * 0.6));
          diffuseColor.rgb = pow(col, vec3(2.2)); // authored in sRGB, lit in linear
        }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = roadRough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = roadMetal;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += roadGlow;');
  };
  const geo = new THREE.PlaneGeometry(HALF_X * 2 + 40, HALF_Z * 2 + 4);
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, material);
  m.position.y = 0.02;
  m.receiveShadow = true;
  return { mesh: m, uniforms };
}

// ------------------------------------------------------------------ sky

// Neutral twilight; the horizon drifts through faint element hues around the
// compass, with high aurora ribbons and stars. Lightning brightens one side.
function buildSky() {
  const geo = new THREE.SphereGeometry(600, 32, 16);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uSun: { value: SUN_DIR.clone() }, uTime: { value: 0 }, uFlash: { value: 0 }, uFlashDir: { value: new THREE.Vector3(1, 0.3, 0).normalize() } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 uSun; uniform float uTime; uniform float uFlash; uniform vec3 uFlashDir; varying vec3 vDir;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
      float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += noise(p) * a; p *= 2.1; a *= 0.5; } return s; }
      void main(){
        float y = vDir.y;
        float s = max(dot(vDir, uSun), 0.0);
        float az = atan(vDir.z, vDir.x);
        vec3 hue = 0.55 + 0.45 * cos(az + vec3(0.0, 2.1, 4.2));
        vec3 hor = mix(vec3(0.8, 0.66, 0.6), hue, 0.3);
        hor = mix(hor, vec3(1.0, 0.78, 0.55), pow(s, 3.0));
        vec3 band = vec3(0.4, 0.36, 0.52), top = vec3(0.07, 0.07, 0.17);
        vec3 col = mix(hor, band, smoothstep(0.0, 0.18, y));
        col = mix(col, top, smoothstep(0.12, 0.7, y));
        col = mix(col, vec3(0.16, 0.13, 0.18), smoothstep(0.0, -0.2, y));
        col += vec3(1.0, 0.7, 0.4) * pow(s, 6.0) * 0.4 + vec3(1.0, 0.85, 0.6) * pow(s, 60.0) * 0.7 + vec3(1.0, 0.95, 0.8) * smoothstep(0.9993, 0.9997, s) * 3.0;
        vec2 cp = vDir.xz / max(y + 0.12, 0.05) * vec2(0.6, 1.6) + vec2(uTime * 0.004, 0.0);
        float cl = smoothstep(0.5, 0.8, fbm(cp * 1.3)) * smoothstep(0.02, 0.12, y) * smoothstep(0.55, 0.2, y);
        col = mix(col, mix(vec3(0.3, 0.26, 0.38), vec3(1.0, 0.75, 0.55), pow(s, 2.0) * 0.8 + 0.2), cl * 0.7);
        // Aurora ribbons in the element hues.
        float au = smoothstep(0.25, 0.5, y) * smoothstep(0.9, 0.55, y);
        float rib = sin(vDir.x * 5.0 + sin(vDir.z * 4.0 + uTime * 0.08) * 1.6);
        col += hue * pow(max(0.0, 1.0 - abs(rib)), 10.0) * au * 0.18 * (0.6 + 0.4 * noise(vDir.xz * 6.0 + uTime * 0.05));
        vec2 sp = floor(vDir.xz / max(y, 0.1) * 120.0);
        col += step(0.998, hash(sp)) * smoothstep(0.4, 0.8, y) * (0.5 + 0.5 * sin(uTime * 2.0 + hash(sp + 1.0) * 30.0)) * 0.6;
        col += vec3(0.7, 0.65, 1.0) * uFlash * pow(max(dot(vDir, uFlashDir), 0.0), 3.0) * 0.7;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  return new THREE.Mesh(geo, material);
}

// ------------------------------------------------------------------ scatter

// Candidate spots, sampled once and sorted by region. Builders take from their
// region's list so props never stack on the same spot.
function sampleSpots(rand) {
  const out = ELEMENT_IDS.map(() => []), field = ELEMENT_IDS.map(() => []);
  const pass = (n, ext) => {
    for (let i = 0; i < n; i++) {
      const x = (rand() - 0.5) * 2 * (HALF_X + ext), z = (rand() - 0.5) * 2 * (HALF_Z + ext);
      const o = outside(x, z);
      if (o < 1.2 || o > ext || onEntryRoad(x, z) || Math.hypot(x - GATE_X, z - SPAWN.z) < 7) continue;
      if (nearLava(x, z, LAVA_W + 1.2) || inPool(x, z, 0.6)) continue;
      out[dominant(x, z)].push({ x, z, o, near: z > HALF_Z && o < 14, used: false });
    }
  };
  pass(9000, 22);
  pass(6000, 48);
  for (let i = 0; i < 5000; i++) {
    const x = (rand() - 0.5) * 2 * (HALF_X - 0.4), z = (rand() - 0.5) * 2 * (HALF_Z - 0.4);
    if (!clearOfRoad(x, z, 0.3)) continue;
    field[dominant(x, z)].push({ x, z, centre: nearTileCentre(x, z, 0.34), used: false });
  }
  return { out, field };
}

// Takes up to n unused spots passing `ok`, with their ground height.
function take(list, n, ok = () => true) {
  const res = [];
  for (const s of list) {
    if (res.length >= n) break;
    if (s.used || !ok(s)) continue;
    s.used = true;
    s.y = terrainHeight(s.x, s.z);
    res.push(s);
  }
  return res;
}

// Composes a prop-local matrix onto a placement matrix.
const place = (base, x, y, z, sx, ry = 0, sy = sx, sz = sx, rx = 0, rz = 0) => base.clone().multiply(mk(x, y, z, sx, ry, sy, sz, rx, rz));
// Matrix with yaw applied last, so a prop can be tipped (tilt about x, roll about z) then turned; scale comes first.
const _q = new THREE.Quaternion(), _e = new THREE.Euler();
const tilted = (x, y, z, yaw, tilt, roll, sx, sy, sz) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q.setFromEuler(_e.set(tilt, yaw, roll, 'YXZ')), new THREE.Vector3(sx, sy, sz));
const pick = (rand, arr) => arr[Math.floor(rand() * arr.length)];
const tall = (s) => !s.near;
const small = (s) => !s.centre;          // field props taller than a pebble keep off tile centres

// ------------------------------------------------------------------ nature

function buildNature(group, S, rand) {
  const trunks = [], canopy = [], canopyCol = [], stems = [], caps = [], capCol = [], bushes = [], bushCol = [];
  const greens = [0x3e7a2c, 0x4e8a32, 0x2e6a2a, 0x689a38, 0x5a8a2a].map(C);
  for (const s of take(S.out[NATURE], 150, (s) => tall(s) && s.o > 2.5 && fbm(s.x * 0.08 + 20, s.z * 0.08) > 0.42)) {
    const sc = 0.9 + rand() * 0.9, base = mk(s.x, s.y, s.z, sc, rand() * 6);
    trunks.push(place(base, 0, 1, 0, 1));
    const col = pick(rand, greens);
    for (let k = 0; k < 3; k++) {
      const a = rand() * 6, r = k === 0 ? 0 : 0.7;
      canopy.push(place(base, Math.cos(a) * r, 2.4 + k * 0.5 + rand() * 0.4, Math.sin(a) * r, 1.1 - k * 0.15, rand() * 6));
      canopyCol.push(col.clone().offsetHSL(0, 0, (rand() - 0.5) * 0.08));
    }
  }
  // Giant mushrooms with softly glowing caps.
  const capPal = [0xb04a36, 0xc49a44, 0x48a094, 0x8a62b8].map(C);
  const mush = (s, sc) => {
    const base = mk(s.x, s.y, s.z, sc, rand() * 6, sc, sc, (rand() - 0.5) * 0.2, (rand() - 0.5) * 0.2);
    const hgt = 1.6 + rand() * 1.4;
    stems.push(place(base, 0, 0, 0, 1, 0, hgt, 1));
    caps.push(place(base, 0, hgt - 0.1, 0, 1.1 + rand() * 0.5, rand() * 6, 0.9, 1.1 + rand() * 0.5));
    capCol.push(pick(rand, capPal));
  };
  for (const s of take(S.out[NATURE], 30, (s) => tall(s) && s.o < 16)) mush(s, 0.9 + rand() * 1.1);
  for (const s of take(S.out[NATURE], 16, (s) => s.near)) mush(s, 0.35 + rand() * 0.2);
  for (const s of take(S.out[NATURE], 140, () => true)) {
    bushes.push(mk(s.x, s.y + 0.2, s.z, 0.4 + rand() * 0.5, rand() * 6, 0.35 + rand() * 0.3));
    bushCol.push(pick(rand, greens).clone().offsetHSL(0, 0, -0.04));
  }
  // Field: grass tufts, flowers and small mushrooms.
  const tufts = [], flowers = [], flowerCol = [];
  const flowerPal = [0xf4f0e0, 0xf0d040, 0xe878a8, 0x80a8f0, 0xf09040].map(C);
  for (const s of take(S.field[NATURE], 420)) {
    if (rand() < 0.55) { const sc = 0.25 + rand() * 0.3; tufts.push(mk(s.x, s.y, s.z, sc, rand() * 6, sc * (1 + rand()), sc, (rand() - 0.5) * 0.4)); }
    else { flowers.push(mk(s.x, s.y + 0.08, s.z, 0.06 + rand() * 0.04, rand() * 6)); flowerCol.push(pick(rand, flowerPal)); }
  }
  for (const s of take(S.field[NATURE], 18, small)) mush(s, 0.16 + rand() * 0.08);
  for (const s of take(S.out[NATURE], 260, (s) => s.o < 20)) { const sc = 0.3 + rand() * 0.4; tufts.push(mk(s.x, s.y, s.z, sc, rand() * 6, sc * (1 + rand()), sc)); }

  const capGeo = new THREE.SphereGeometry(1, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
  const stemGeo = new THREE.CylinderGeometry(0.16, 0.24, 1, 7); stemGeo.translate(0, 0.5, 0);
  const tuftGeo = new THREE.ConeGeometry(0.12, 0.7, 3); tuftGeo.translate(0, 0.35, 0);
  group.add(instanced(new THREE.CylinderGeometry(0.16, 0.28, 2, 6), mat(0x4a3424, { flat: true }), trunks, { cast: false }));
  group.add(instanced(new THREE.IcosahedronGeometry(1, 0), mat(0xffffff, { flat: true, rough: 0.9 }), canopy, { cast: false, colors: canopyCol }));
  group.add(instanced(stemGeo, mat(0xe8dcc0, { flat: true }), stems));
  group.add(instanced(capGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x302018, roughness: 0.6, flatShading: true }), caps, { colors: capCol }));
  group.add(instanced(new THREE.IcosahedronGeometry(1, 0), mat(0xffffff, { flat: true, rough: 1 }), bushes, { cast: false, colors: bushCol }));
  group.add(instanced(tuftGeo, mat(0x6a9a3c, { flat: true, rough: 1 }), tufts, { cast: false }));
  group.add(instanced(new THREE.IcosahedronGeometry(1, 0), mat(0xffffff, { flat: true, rough: 0.8 }), flowers, { cast: false, colors: flowerCol }));
}

// ------------------------------------------------------------------ fire

// A lava river: a ribbon following the carved channel, with crust drifting
// over a hot core. Opaque and unlit so it reads as glowing through the haze.
function buildLava() {
  const positions = [], uvs = [], idx = [];
  let base = 0;
  for (const path of LAVA) {
    path.forEach((s, i) => {
      positions.push(s.x + s.nx * LAVA_W, s.y, s.z + s.nz * LAVA_W, s.x - s.nx * LAVA_W, s.y, s.z - s.nz * LAVA_W);
      uvs.push(s.u, 0, s.u, 1);
      if (i > 0) { const a = base + (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    });
    base += path.length * 2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  const material = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 } },
    vertexShader: `varying vec2 vUv; varying vec2 vW; void main(){ vUv = uv; vW = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform float uTime; varying vec2 vUv; varying vec2 vW;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
      void main(){
        float across = abs(vUv.y - 0.5) * 2.0;
        vec2 q = vec2(vUv.x * 0.9 - uTime * 0.25, vUv.y * 2.0);
        float n = noise(q * 2.0) * 0.6 + noise(q * 5.0 + 3.0) * 0.4;
        float crust = smoothstep(0.5, 0.72, n) * 0.85 + across * across * 0.7;
        vec3 hot = mix(vec3(1.0, 0.85, 0.4), vec3(1.0, 0.35, 0.05), smoothstep(0.0, 0.7, across));
        vec3 col = mix(hot * 0.95, vec3(0.1, 0.035, 0.02), clamp(crust * 1.25, 0.0, 1.0));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  return new THREE.Mesh(geo, material);
}

function buildVolcano(group, smokeSrc) {
  const prof = [[26, -2], [20, 5], [13, 14], [8, 22], [5.5, 25.5], [4.6, 25], [3.2, 23.2], [0, 23]].map(([r, y]) => new THREE.Vector2(r, y));
  const geo = new THREE.LatheGeometry(prof, 12);
  const y0 = terrainHeight(VOLCANO.x, VOLCANO.z) - 1;
  const cone = new THREE.Mesh(geo, mat(0x3e3430, { flat: true, rough: 0.95 }));
  cone.position.set(VOLCANO.x, y0, VOLCANO.z);
  cone.receiveShadow = true;
  group.add(cone);
  const crater = new THREE.Mesh(new THREE.CircleGeometry(3.4, 12), glow(0xff5a14, 3));
  crater.rotation.x = -Math.PI / 2;
  crater.position.set(VOLCANO.x, y0 + 23.4, VOLCANO.z);
  group.add(crater);
  // Glowing lava streaks down the flanks.
  const surf = (r) => {
    for (let i = 1; i < prof.length; i++) if (r >= prof[i].x) return THREE.MathUtils.mapLinear(r, prof[i - 1].x, prof[i].x, prof[i - 1].y, prof[i].y);
    return prof.at(-1).y;
  };
  const streaks = [];
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2 + 0.3, L = 7 + (k % 3) * 3, tilt = 0.95;
    const r = 5.8 + Math.cos(tilt) * L / 2;
    streaks.push(tilted(VOLCANO.x + Math.cos(a) * r, y0 + surf(r) + 0.25, VOLCANO.z + Math.sin(a) * r, Math.PI / 2 - a, tilt, 0, 0.4, 0.15, L));
  }
  group.add(instanced(new THREE.BoxGeometry(1, 1, 1), glow(0xff4a10, 2.4), streaks, { cast: false }));
  for (let k = 0; k < 4; k++) smokeSrc.push({ x: VOLCANO.x + (k - 1.5) * 1.2, y: y0 + 24, z: VOLCANO.z, big: 3.5, rise: 14 });
}

function buildFire(group, S, rand, smokeSrc) {
  const cols = [], colCol = [], boulders = [], vents = [], ventTops = [];
  const basalt = [0x2a2424, 0x342c2a, 0x3c3230, 0x241e1e].map(C);
  // Basalt column clusters.
  for (const s of take(S.out[FIRE], 34, (s) => tall(s) && s.o > 2.5)) {
    const n = 4 + Math.floor(rand() * 6);
    for (let k = 0; k < n; k++) {
      const a = rand() * 6, r = rand() * 1.6, hgt = 0.8 + rand() * (s.o > 8 ? 5 : 2.5);
      cols.push(mk(s.x + Math.cos(a) * r, s.y + hgt / 2 - 0.2, s.z + Math.sin(a) * r, 0.45 + rand() * 0.2, rand(), hgt, 0.45 + rand() * 0.2));
      colCol.push(pick(rand, basalt));
    }
  }
  for (const s of take(S.out[FIRE], 120)) boulders.push(mk(s.x, s.y + 0.1, s.z, 0.3 + rand() * 0.8, rand() * 6, 0.25 + rand() * 0.4));
  // Smoking vents: low mounds with a glowing mouth.
  for (const s of take(S.out[FIRE], 9, (s) => s.o < 14)) {
    vents.push(mk(s.x, s.y, s.z, 0.9 + rand() * 0.4, rand() * 6, 0.6, 0.9 + rand() * 0.4));
    ventTops.push(mk(s.x, s.y + 0.58, s.z, 0.28, 0, 0.05, 0.28));
    smokeSrc.push({ x: s.x, y: s.y + 0.6, z: s.z, big: 1.2, rise: 6 });
  }
  // Field: ash pebbles and a few small off-centre vents.
  const pebbles = [];
  for (const s of take(S.field[FIRE], 160)) pebbles.push(mk(s.x, s.y + 0.04, s.z, 0.1 + rand() * 0.14, rand() * 6, 0.08 + rand() * 0.08));
  for (const s of take(S.field[FIRE], 5, small)) {
    vents.push(mk(s.x, s.y, s.z, 0.32, rand() * 6, 0.22, 0.32));
    ventTops.push(mk(s.x, s.y + 0.21, s.z, 0.1, 0, 0.03, 0.1));
    smokeSrc.push({ x: s.x, y: s.y + 0.25, z: s.z, big: 0.6, rise: 3.5 });
  }
  group.add(instanced(new THREE.CylinderGeometry(1, 1, 1, 6), mat(0xffffff, { flat: true, rough: 0.9 }), cols, { colors: colCol }));
  group.add(instanced(new THREE.DodecahedronGeometry(1, 0), mat(0x2e2828, { flat: true, rough: 0.95 }), boulders, { cast: false }));
  group.add(instanced(new THREE.CylinderGeometry(0.35, 1, 1, 7), mat(0x2a2220, { flat: true }), vents));
  group.add(instanced(new THREE.CylinderGeometry(1, 1, 1, 7), glow(0xff6a1f, 2.6), ventTops, { cast: false }));
  group.add(instanced(new THREE.DodecahedronGeometry(1, 0), mat(0x5e5650, { flat: true }), pebbles, { cast: false }));
}

// ------------------------------------------------------------------ ice

function buildIce(group, S, rand) {
  const shards = [], pines = [], pineCol = [], drifts = [];
  const iceMat = new THREE.MeshStandardMaterial({ color: 0xa8dcff, emissive: 0x2a78b8, emissiveIntensity: 0.3, roughness: 0.4, metalness: 0, flatShading: true });
  // Crystal clusters: tall leaning shards.
  for (const s of take(S.out[ICE], 40, (s) => tall(s) && s.o > 2)) {
    const n = 3 + Math.floor(rand() * 4), big = s.o > 8 ? 1.6 : 1;
    for (let k = 0; k < n; k++) {
      const a = rand() * 6, r = rand() * 0.9, hgt = (1.2 + rand() * 2.2) * big;
      shards.push(mk(s.x + Math.cos(a) * r, s.y + hgt * 0.35, s.z + Math.sin(a) * r, 0.35 * big, rand() * 6, hgt, 0.35 * big, Math.cos(a) * 0.35, Math.sin(a) * 0.35));
    }
  }
  // Snowy pines: stacked cones, snow on the top tier.
  for (const s of take(S.out[ICE], 70, (s) => tall(s) && s.o > 4 && fbm(s.x * 0.08 + 9, s.z * 0.08) > 0.45)) {
    const sc = 0.8 + rand() * 0.7, base = mk(s.x, s.y, s.z, sc, rand() * 6);
    for (let k = 0; k < 3; k++) {
      pines.push(place(base, 0, 1.0 + k * 0.9, 0, 1.1 - k * 0.3, rand(), 1.5, 1.1 - k * 0.3));
      pineCol.push(C(k === 2 ? 0xa8b4c2 : 0x34524a).offsetHSL(0, 0, (rand() - 0.5) * 0.04));
    }
  }
  for (const s of take(S.out[ICE], 160)) drifts.push(mk(s.x, s.y + 0.05, s.z, 0.5 + rand() * 1.0, rand() * 6, 0.2 + rand() * 0.25, 0.4 + rand() * 0.6));
  // Field: snow lumps and small ice shards off the tile centres.
  const lumps = [];
  for (const s of take(S.field[ICE], 140)) lumps.push(mk(s.x, s.y + 0.03, s.z, 0.14 + rand() * 0.18, rand() * 6, 0.07 + rand() * 0.06));
  for (const s of take(S.field[ICE], 26, small)) {
    const hgt = 0.35 + rand() * 0.3;
    shards.push(mk(s.x, s.y + hgt * 0.3, s.z, 0.1, rand() * 6, hgt, 0.1, (rand() - 0.5) * 0.5, (rand() - 0.5) * 0.5));
  }
  // Frozen pools: flat glossy discs with ragged rims.
  const poolMat = new THREE.MeshStandardMaterial({ color: 0x9cc8e4, roughness: 0.08, metalness: 0.35, emissive: 0x10283a, emissiveIntensity: 1, polygonOffset: true, polygonOffsetFactor: -1 });
  for (const p of POOLS) {
    const geo = new THREE.CircleGeometry(p.r, 18);
    const pos = geo.attributes.position;
    for (let i = 1; i < pos.count; i++) { const k = 0.88 + rand() * 0.18; pos.setXY(i, pos.getX(i) * k, pos.getY(i) * k); }
    const m = new THREE.Mesh(geo, poolMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(p.x, p.y, p.z);
    m.receiveShadow = true;
    group.add(m);
  }
  group.add(instanced(new THREE.OctahedronGeometry(1, 0), iceMat, shards));
  group.add(instanced(new THREE.ConeGeometry(1, 1, 7), mat(0xffffff, { flat: true, rough: 0.85 }), pines, { cast: false, colors: pineCol }));
  group.add(instanced(new THREE.IcosahedronGeometry(1, 0), mat(0x9aa8b8, { flat: true, rough: 0.9 }), drifts, { cast: false }));
  group.add(instanced(new THREE.IcosahedronGeometry(1, 0), mat(0xa2aebc, { flat: true, rough: 0.9 }), lumps, { cast: false }));
}

// ------------------------------------------------------------------ storm

// Lightning-rod spires, crags and floating rocks on the eastern heights; small
// spires in the middle lane. Returns the rocks and bolt targets for animation.
function buildStorm(group, S, rand) {
  const shafts = [], rings = [], orbs = [], crags = [], shardsF = [];
  const targets = [];
  const spire = (x, y, z, hgt) => {
    shafts.push(mk(x, y + hgt / 2, z, 1, rand() * 6, hgt, 1));
    for (let k = 1; k <= 3; k++) rings.push(mk(x, y + hgt * (0.35 + k * 0.17), z, 1 - k * 0.15, 0, 1, 1 - k * 0.15, Math.PI / 2));
    orbs.push(mk(x, y + hgt + 0.25, z, 1));
    targets.push(new THREE.Vector3(x, y + hgt + 0.25, z));
  };
  for (const s of take(S.out[STORM], 9, (s) => tall(s) && s.o > 3 && s.o < 24)) spire(s.x, s.y, s.z, 4 + rand() * 4);
  for (const s of take(S.out[STORM], 40, tall)) crags.push(mk(s.x, s.y + 0.6, s.z, 0.8 + rand() * 1.2, rand() * 6, 1.4 + rand() * 2.4, 0.7 + rand(), (rand() - 0.5) * 0.3));
  for (const s of take(S.out[STORM], 80)) crags.push(mk(s.x, s.y + 0.1, s.z, 0.3 + rand() * 0.5, rand() * 6, 0.3 + rand() * 0.4));
  // Field: small spires off the tile centres and slate chips.
  const fieldSpires = take(S.field[STORM], 7, small);
  for (const s of fieldSpires) {
    const hgt = 0.7 + rand() * 0.25, sc = 0.28;
    shafts.push(mk(s.x, s.y + hgt / 2, s.z, sc, 0, hgt, sc));
    rings.push(mk(s.x, s.y + hgt * 0.7, s.z, sc * 0.9, 0, 1, sc * 0.9, Math.PI / 2));
    orbs.push(mk(s.x, s.y + hgt + 0.08, s.z, 0.3));
  }
  if (fieldSpires[0]) { const s = fieldSpires[0]; targets.push(new THREE.Vector3(s.x, s.y + 1, s.z)); }
  for (const s of take(S.field[STORM], 150)) shardsF.push(mk(s.x, s.y + 0.04, s.z, 0.1 + rand() * 0.15, rand() * 6, 0.06 + rand() * 0.1, 0.1 + rand() * 0.12, rand() * 0.6));
  // Floating rocks hover over the heights, each with a dangling crag beneath.
  const rocks = [];
  const rockTop = mat(0x4a4e5e, { flat: true, rough: 0.9 }), rockBot = mat(0x343846, { flat: true, rough: 0.9 });
  const topGeo = new THREE.DodecahedronGeometry(1, 0), botGeo = new THREE.ConeGeometry(0.9, 2, 6);
  botGeo.rotateX(Math.PI); botGeo.translate(0, -1.1, 0);
  for (const s of take(S.out[STORM], 9, (s) => tall(s) && s.o > 5 && s.o < 30)) {
    const g = new THREE.Group();
    const top = new THREE.Mesh(topGeo, rockTop); top.scale.set(1, 0.45, 1);
    const bot = new THREE.Mesh(botGeo, rockBot);
    top.castShadow = bot.castShadow = true;
    g.add(top, bot);
    const sc = 0.8 + rand() * 1.4, y = s.y + 4 + rand() * 5;
    g.position.set(s.x, y, s.z); g.scale.setScalar(sc); g.rotation.y = rand() * 6;
    group.add(g);
    rocks.push({ g, y, seed: rand() * 10 });
  }
  const shaftGeo = new THREE.CylinderGeometry(0.12, 0.32, 1, 6);
  group.add(instanced(shaftGeo, mat(0x3a3e4c, { flat: true, metal: 0.5, rough: 0.5 }), shafts));
  group.add(instanced(new THREE.TorusGeometry(0.4, 0.06, 4, 10), mat(0x8a8ea0, { metal: 0.7, rough: 0.35 }), rings, { cast: false }));
  group.add(instanced(new THREE.IcosahedronGeometry(0.32, 1), glow(ELEMENTS.storm.color, 3), orbs, { cast: false }));
  group.add(instanced(new THREE.DodecahedronGeometry(1, 0), mat(0x3a3e4a, { flat: true, rough: 0.9 }), crags));
  group.add(instanced(new THREE.DodecahedronGeometry(1, 0), mat(0x50566a, { flat: true }), shardsF, { cast: false }));
  return { rocks, targets };
}

// Pre-built jagged bolts from the clouds to spire tips; one flashes at a time.
function buildBolts(targets, rand) {
  const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.5, 2.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  return targets.slice(0, 6).map((t) => {
    const path = new THREE.CurvePath();
    let prev = new THREE.Vector3(t.x + (rand() - 0.5) * 6, t.y + 16, t.z + (rand() - 0.5) * 6);
    const N = 9;
    for (let k = 1; k <= N; k++) {
      const next = k === N ? t.clone() : new THREE.Vector3().lerpVectors(prev, t, 1 / (N - k + 1)).add(new THREE.Vector3((rand() - 0.5) * 1.6, 0, (rand() - 0.5) * 1.6));
      path.add(new THREE.LineCurve3(prev, next));
      prev = next;
    }
    const m = new THREE.Mesh(new THREE.TubeGeometry(path, 60, 0.045, 4, false), material);
    m.visible = false;
    return { mesh: m, target: t };
  });
}

// ------------------------------------------------------------------ iron

function gearGeometry(teeth, r, depth) {
  const s = new THREE.Shape();
  const step = (Math.PI * 2) / teeth;
  for (let k = 0; k < teeth; k++) {
    const a = k * step;
    const pts = [[a, r * 0.8], [a + step * 0.2, r], [a + step * 0.5, r], [a + step * 0.7, r * 0.8]];
    pts.forEach(([ang, rr], j) => (k === 0 && j === 0 ? s.moveTo : s.lineTo).call(s, Math.cos(ang) * rr, Math.sin(ang) * rr));
  }
  s.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, 0, r * 0.28, 0, Math.PI * 2, true);
  s.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 6 });
  g.translate(0, 0, -depth / 2);
  return g;
}

function buildIron(group, S, rand, smokeSrc) {
  const stacks = [], bands = [], rims = [], gears = [], pipes = [], supports = [], crates = [], scraps = [], bolts = [];
  // Smokestacks on the western flats, kept off the near side.
  for (const s of take(S.out[IRON], 5, (s) => tall(s) && s.o > 8 && s.o < 26)) {
    const hgt = 5 + rand() * 3, r = 0.65 + rand() * 0.2;
    stacks.push(mk(s.x, s.y + hgt / 2 - 0.3, s.z, r, 0, hgt, r));
    for (const f of [0.3, 0.62, 0.92]) bands.push(mk(s.x, s.y + hgt * f, s.z, r * 1.08, 0, 0.25, r * 1.08));
    rims.push(mk(s.x, s.y + hgt - 0.25, s.z, r * 0.85, 0, 0.12, r * 0.85));
    smokeSrc.push({ x: s.x, y: s.y + hgt, z: s.z, big: 2.2, rise: 12 });
  }
  // Half-buried gears, pipes on trestles and crates.
  for (const s of take(S.out[IRON], 28, tall)) {
    const sc = 0.8 + rand() * 1.6;
    gears.push(mk(s.x, s.y + sc * 0.45, s.z, sc, rand() * 6, sc, sc, (rand() - 0.5) * 0.3, rand() * 6));
  }
  for (const s of take(S.out[IRON], 5, (s) => tall(s) && s.z < HALF_Z && s.o > 3 && s.o < 20)) {
    const ry = rand() * Math.PI, L = 4 + rand() * 4;
    const dx = Math.cos(ry), dz = -Math.sin(ry);
    pipes.push(tilted(s.x, s.y + 1.4, s.z, ry, 0, Math.PI / 2, 0.35, L, 0.35));
    for (let t = -L / 2 + 0.6; t <= L / 2; t += 2.4) {
      const x = s.x + dx * t, z = s.z + dz * t;
      supports.push(mk(x, terrainHeight(x, z) + 0.6, z, 0.2, ry, 1.6, 0.6));
    }
  }
  for (const s of take(S.out[IRON], 50)) {
    if (rand() < 0.5) crates.push(mk(s.x, s.y + 0.35, s.z, 0.7, rand() * 6));
    else scraps.push(mk(s.x, s.y + 0.06, s.z, 0.4 + rand() * 0.6, rand() * 6, 0.06, 0.3 + rand() * 0.5, (rand() - 0.5) * 0.3));
  }
  // Rails running west from the field edge across the iron flats.
  const rails = [], sleepers = [];
  const railZ = 5.8;
  for (let x = -HALF_X - 1; x > -105; x -= 1.1) {
    const y = terrainHeight(x, railZ);
    sleepers.push(mk(x, y + 0.05, railZ, 0.25, 0, 0.1, 1.6));
    for (const o of [-0.5, 0.5]) rails.push(mk(x - 0.55, y + 0.14, railZ + o, 1.15, 0, 0.08, 0.08));
  }
  // Field: bolts, small gears and plate scraps off the tile centres.
  for (const s of take(S.field[IRON], 120)) bolts.push(mk(s.x, s.y + 0.04, s.z, 0.06 + rand() * 0.04, rand() * 6, 0.05));
  for (const s of take(S.field[IRON], 22, small)) {
    if (rand() < 0.5) gears.push(mk(s.x, s.y + 0.08, s.z, 0.25 + rand() * 0.1, rand() * 6, 0.25, 0.25, Math.PI / 2 - 0.2 + rand() * 0.4));
    else scraps.push(mk(s.x, s.y + 0.03, s.z, 0.3, rand() * 6, 0.03, 0.25));
  }
  const steel = mat(0x7a7e84, { metal: 0.6, rough: 0.45, flat: true });
  const rust = mat(0x6a4a34, { metal: 0.3, rough: 0.7, flat: true });
  const gearGeo = gearGeometry(10, 1, 0.3);
  group.add(instanced(new THREE.CylinderGeometry(0.9, 1.05, 1, 10), mat(0x5a443a, { flat: true, rough: 0.85 }), stacks));
  group.add(instanced(new THREE.CylinderGeometry(1, 1, 1, 10), mat(0x2e2c2a, { metal: 0.4 }), bands, { cast: false }));
  group.add(instanced(new THREE.CylinderGeometry(1, 1, 1, 10), mat(0x1e1a18, { rough: 1 }), rims, { cast: false }));
  group.add(instanced(gearGeo, rust, gears));
  group.add(instanced(new THREE.CylinderGeometry(1, 1, 1, 8), steel, pipes));
  group.add(instanced(new THREE.BoxGeometry(1, 1, 1), mat(0x3a3836, { metal: 0.4 }), supports));
  group.add(instanced(new THREE.BoxGeometry(1, 1, 1), mat(0x6a5a44, { flat: true }), crates));
  group.add(instanced(new THREE.BoxGeometry(1, 1, 1), steel, scraps, { cast: false }));
  group.add(instanced(new THREE.BoxGeometry(1, 1, 1), mat(0x9a9ea4, { metal: 0.7, rough: 0.3 }), rails, { cast: false }));
  group.add(instanced(new THREE.BoxGeometry(1, 1, 1), mat(0x3a2e26, { flat: true }), sleepers, { cast: false }));
  group.add(instanced(new THREE.CylinderGeometry(1, 1, 1, 6), steel, bolts, { cast: false }));
  // Three big upright gears that turn slowly near the field's west edge.
  const spin = [];
  const bigGear = mat(0x8a6a44, { metal: 0.55, rough: 0.45, flat: true });
  const bigGeo = gearGeometry(14, 1, 0.35);
  for (const [x, z, r, dir] of [[-HALF_X - 5, -3.5, 2.6, 1], [-HALF_X - 7.6, 0.6, 1.8, -1.44], [-HALF_X - 5, 12, 2.2, 1.2]]) {
    const m = new THREE.Mesh(bigGeo, bigGear);
    m.scale.setScalar(r);
    m.position.set(x, terrainHeight(x, z) + r * 0.75, z);
    m.rotation.y = Math.PI / 2;
    m.castShadow = true;
    group.add(m);
    spin.push({ m, dir });
  }
  return spin;
}

// ------------------------------------------------------------------ astral

function buildAstral(group, S, rand) {
  const crystals = [], crystalCol = [], plinths = [];
  const pal = [0xb89aff, 0x9a7aff, 0xd0b8ff, 0xffe08a].map(C);
  const cluster = (s, big) => {
    const n = 3 + Math.floor(rand() * 4);
    for (let k = 0; k < n; k++) {
      const a = rand() * 6, r = rand() * 0.8 * big, hgt = (0.8 + rand() * 1.8) * big;
      crystals.push(mk(s.x + Math.cos(a) * r, s.y + hgt * 0.35, s.z + Math.sin(a) * r, 0.3 * big, rand() * 6, hgt, 0.3 * big, Math.cos(a) * 0.4, Math.sin(a) * 0.4));
      crystalCol.push(rand() < 0.15 ? pal[3] : pick(rand, pal.slice(0, 3)));
    }
  };
  for (const s of take(S.out[ASTRAL], 30, (s) => tall(s) && s.o > 2)) cluster(s, s.z > HALF_Z ? 0.9 : s.o > 10 ? 1.7 : 1.1);
  for (const s of take(S.out[ASTRAL], 30, (s) => s.near)) cluster(s, 0.45);          // low on the camera side
  for (const s of take(S.out[ASTRAL], 8, (s) => tall(s) && s.o > 4)) plinths.push(mk(s.x, s.y + 0.3, s.z, 1.2, rand() * 6, 0.6, 1.2));
  for (const s of take(S.field[ASTRAL], 24, small)) {
    const hgt = 0.3 + rand() * 0.25;
    crystals.push(mk(s.x, s.y + hgt * 0.3, s.z, 0.09, rand() * 6, hgt, 0.09, (rand() - 0.5) * 0.5, (rand() - 0.5) * 0.5));
    crystalCol.push(pick(rand, pal));
  }
  const crystalMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x5a30c0, emissiveIntensity: 0.55, roughness: 0.2, metalness: 0.1, flatShading: true });
  group.add(instanced(new THREE.OctahedronGeometry(1, 0), crystalMat, crystals, { colors: crystalCol }));
  group.add(instanced(new THREE.CylinderGeometry(1, 1.1, 1, 8), mat(0x4a4068, { flat: true }), plinths));
  // Floating star orbs, bobbing over the astral ground outside the field.
  const orbSpots = take(S.out[ASTRAL], 14, (s) => s.o > 3 && s.o < 20);
  const orbs = instanced(new THREE.IcosahedronGeometry(0.18, 1), glow(ELEMENTS.astral.color, 1.8), orbSpots.map((s) => mk(s.x, s.y + 2, s.z, 1)), { cast: false });
  group.add(orbs);
  return { orbs, spots: orbSpots.map((s) => ({ x: s.x, z: s.z, y: s.y + (s.near ? 1.2 : 1.8 + rand() * 2.5), seed: rand() * 10 })) };
}

// ------------------------------------------------------------------ darkness

function buildDarkness(group, S, rand) {
  const trunks = [], branches = [], graves = [], crosses = [], bones = [], pebbles = [];
  for (const s of take(S.out[DARK], 60, (s) => tall(s) || s.o < 6)) {
    const sc = (s.near ? 0.5 : 0.8) + rand() * 0.5, base = mk(s.x, s.y, s.z, sc, rand() * 6, sc, sc, (rand() - 0.5) * 0.15);
    trunks.push(place(base, 0, 1.3, 0, 1));
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + rand();
      branches.push(base.clone().multiply(tilted(Math.cos(a) * 0.1, 1.6 + k * 0.4, Math.sin(a) * 0.1, -a, 0, -0.9, 1, 1.3 - k * 0.25, 1)));
    }
  }
  // Graveyards in a few clumps.
  for (const c of take(S.out[DARK], 5, (s) => s.o > 2 && s.o < 16)) {
    for (let k = 0; k < 10; k++) {
      const x = c.x + (k % 4) * 1.4 + (rand() - 0.5) * 0.4, z = c.z + Math.floor(k / 4) * 1.6 + (rand() - 0.5) * 0.4;
      if (outside(x, z) < 1 || !clearOfRoad(x, z, 1)) continue;
      const y = terrainHeight(x, z);
      if (rand() < 0.65) graves.push(mk(x, y + 0.4, z, 0.55, (rand() - 0.5) * 0.3, 0.8, 0.16, (rand() - 0.5) * 0.25, (rand() - 0.5) * 0.25));
      else crosses.push(mk(x, y + 0.55, z, 0.1, (rand() - 0.5) * 0.4, 1.1, 0.1, (rand() - 0.5) * 0.2));
    }
  }
  for (const s of take(S.out[DARK], 45)) pebbles.push(mk(s.x, s.y + 0.08, s.z, 0.25 + rand() * 0.5, rand() * 6, 0.2 + rand() * 0.3));
  // Field: bones, skull-sized pebbles and a few tiny headstones off the tile centres.
  for (const s of take(S.field[DARK], 120)) {
    if (rand() < 0.5) bones.push(mk(s.x, s.y + 0.03, s.z, 0.03, rand() * 6, 0.03, 0.25, Math.PI / 2));
    else pebbles.push(mk(s.x, s.y + 0.04, s.z, 0.08 + rand() * 0.1, rand() * 6, 0.06 + rand() * 0.06));
  }
  for (const s of take(S.field[DARK], 10, small)) graves.push(mk(s.x, s.y + 0.18, s.z, 0.26, rand() * 6, 0.36, 0.08, (rand() - 0.5) * 0.3));
  const box = new THREE.BoxGeometry(1, 1, 1);
  const branchGeo = new THREE.CylinderGeometry(0.03, 0.08, 1, 5); branchGeo.translate(0, 0.5, 0);
  group.add(instanced(new THREE.CylinderGeometry(0.08, 0.2, 2.6, 5), mat(0x1e1a1c, { flat: true }), trunks));
  group.add(instanced(branchGeo, mat(0x1e1a1c, { flat: true }), branches, { cast: false }));
  group.add(instanced(box, mat(0x55525c, { flat: true, rough: 0.9 }), graves));
  group.add(instanced(box, mat(0x2a2228, { flat: true }), crosses, { cast: false }));
  group.add(instanced(new THREE.CylinderGeometry(1, 1, 1, 5), mat(0xd8d0bc, { flat: true }), bones, { cast: false }));
  group.add(instanced(new THREE.DodecahedronGeometry(1, 0), mat(0x2e2830, { flat: true }), pebbles, { cast: false }));
}

// ------------------------------------------------------------------ shared decor

// Rubble on the blocked corner tiles, tinted to the region they sit in.
function buildCornerRubble(group, rand) {
  const rocks = [], cols = [];
  const tint = [0x5e6052, 0x2e2826, 0xc8d4e0, 0x404452, 0x5a4e44, 0x4a4068, 0x2a2430].map(C);
  for (const key of BLOCKED_TILES) {
    const [c, r] = key.split(',').map(Number);
    const p = tileToWorld(c, r);
    const reg = dominant(p.x, p.z);
    for (let k = 0; k < 3; k++) {
      rocks.push(mk(p.x + (rand() - 0.5) * 1.4, 0.2, p.z + (rand() - 0.5) * 1.4, 0.45 + rand() * 0.5, rand() * 6, 0.35 + rand() * 0.4));
      cols.push(tint[reg]);
    }
  }
  group.add(instanced(new THREE.DodecahedronGeometry(1, 0), mat(0xffffff, { flat: true, rough: 0.95 }), rocks, { colors: cols }));
}

// The six point lights the map can afford: lava, iron furnace, astral glow,
// gate and lightning here; the nexus carries the sixth.
function buildLights(group) {
  const add = (color, intensity, dist, x, y, z) => {
    const l = new THREE.PointLight(color, intensity, dist, 1.6);
    l.position.set(x, y, z);
    group.add(l);
    return l;
  };
  const lava = add(0xff6a20, 14, 20, 3, 1.5, -23);
  const furnace = add(0xff8a3a, 8, 14, -HALF_X - 4, 2.5, 3);
  const astral = add(0xb08aff, 8, 16, -14, 2.5, HALF_Z + 3);
  const flash = add(0xc8b8ff, 0, 30, 0, 8, 0);
  return { lava, furnace, astral, flash };
}

function buildDecor(rand) {
  const group = new THREE.Group();
  const S = sampleSpots(rand);
  const smokeSrc = [];
  buildNature(group, S, rand);
  buildFire(group, S, rand, smokeSrc);
  buildVolcano(group, smokeSrc);
  buildIce(group, S, rand);
  const storm = buildStorm(group, S, rand);
  const gears = buildIron(group, S, rand, smokeSrc);
  const astral = buildAstral(group, S, rand);
  buildDarkness(group, S, rand);
  buildCornerRubble(group, rand);
  const lights = buildLights(group);
  const bolts = buildBolts(storm.targets, rand);
  for (const b of bolts) group.add(b.mesh);
  return { group, smokeSrc, rocks: storm.rocks, bolts, gears, astral, lights };
}

// ------------------------------------------------------------------ gate and nexus

// The spawn gate: an arch of seven stones, one per element, each with a glowing
// rune, over a white rift.
function buildGate() {
  const g = new THREE.Group();
  const stone = mat(0x4a4652, { flat: true, rough: 0.85 });
  const dark = mat(0x2e2a34, { flat: true });
  const R = 3.0, base = 3.0;
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(1.3, base, 1.1), stone);
    leg.position.set(0, base / 2, s * R); leg.castShadow = true;
    const foot = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.5, 1.6), dark);
    foot.position.set(0, 0.25, s * R);
    g.add(leg, foot);
  }
  ELEMENT_IDS.forEach((id, i) => {
    const a = Math.PI - ((i + 0.5) / 7) * Math.PI;           // nature on the left as the creeps leave
    const y = base + Math.sin(a) * R, z = Math.cos(a) * R;
    const blk = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.25, 1.0), stone);
    blk.position.set(0, y, z); blk.rotation.x = -(a - Math.PI / 2); blk.castShadow = true;
    const rune = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), glow(ELEMENTS[id].color, 3.2));
    rune.position.set(0.72, 0, 0); rune.scale.set(0.5, 1, 1);
    blk.add(rune);
    const back = rune.clone(); back.position.x = -0.72; blk.add(back);
    // A floating shard above each stone.
    const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), glow(ELEMENTS[id].color, 2.6));
    shard.position.set(0, base + Math.sin(a) * (R + 1.2), Math.cos(a) * (R + 1.2)); shard.scale.set(0.7, 1.4, 0.7);
    g.add(blk, shard);
  });
  const vortexMat = riftMaterial(0xa8b0ff, 0xffffff);
  const vortex = new THREE.Mesh(new THREE.PlaneGeometry(5.0, 6.2), vortexMat);
  vortex.rotation.y = Math.PI / 2;
  vortex.position.y = 3.1;
  g.add(vortex);
  const light = new THREE.PointLight(0xd8dcff, 6, 12, 1.6);
  light.position.set(1.5, 3, 0);
  g.add(light);
  g.position.set(GATE_X, 0, SPAWN.z);
  g.userData.vortex = vortexMat;
  return g;
}

// The portal: a dark obsidian shrine around a floating violet crystal.
function buildNexus() {
  const g = new THREE.Group();
  const stone = mat(0x2e2a36, { flat: true, rough: 0.6, metal: 0.2 });
  const dark = mat(0x1c1822, { flat: true, rough: 0.7 });
  const steps = [[3.2, 3.5, 0.4, stone], [2.6, 2.9, 0.4, dark], [2.0, 2.3, 0.35, stone]];
  let y = 0;
  for (const [rt, rb, h, m] of steps) {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 8), m);
    s.position.y = y + h / 2; s.castShadow = true; s.receiveShadow = true;
    g.add(s);
    y += h;
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const h = i % 2 ? 3.2 : 4.4;
    // Obsidian spikes leaning in toward the crystal.
    const p = new THREE.Mesh(new THREE.ConeGeometry(0.35, h, 5), stone);
    p.position.set(Math.cos(a) * 2.6, y + h / 2 - 0.3, Math.sin(a) * 2.6);
    p.rotation.set(Math.sin(a) * 0.18, 0, -Math.cos(a) * 0.18);
    p.castShadow = true;
    g.add(p);
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), glow(ELEMENTS.darkness.color, 3));
    gem.position.set(Math.cos(a) * 2.75, y + 0.9, Math.sin(a) * 2.75);
    g.add(gem);
  }
  const crystalMat = new THREE.MeshStandardMaterial({ color: 0xd8b0ff, emissive: 0xb04dff, emissiveIntensity: 2.0, roughness: 0.15, metalness: 0.2, flatShading: true });
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(1.1, 0), crystalMat);
  crystal.scale.set(0.8, 1.6, 0.8);
  crystal.position.y = 3.9; crystal.castShadow = true;
  g.add(crystal);
  const ring1 = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.05, 6, 48), glow(0xc77dff, 2.5));
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(2.0, 0.04, 6, 48), glow(0x7a3aff, 2.5));
  ring1.position.y = ring2.position.y = 3.9;
  g.add(ring1, ring2);
  const pillarMat = new THREE.MeshBasicMaterial({ color: 0xb070ff, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.0, 40, 16, 1, true), pillarMat);
  beam.position.y = 22;
  g.add(beam);
  const light = new THREE.PointLight(0xa050ff, 10, 14, 1.5);
  light.position.y = 4;
  g.add(light);
  g.position.set(PORTAL.x + 1.5, 0, PORTAL.z);
  g.userData = { crystal, crystalMat, ring1, ring2, beam, pillarMat, crystalY: 3.9 };
  return g;
}

// ------------------------------------------------------------------ particles and mist

// One point cloud whose motion depends on the region each mote spawned in:
// fireflies, embers, snow, sparks, falling forge sparks, star motes, wisps.
function buildMotes(rand) {
  const N = 360;
  const pos = new Float32Array(N * 3), seed = new Float32Array(N), kind = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const x = (rand() - 0.5) * (HALF_X * 2 + 24), z = (rand() - 0.5) * (HALF_Z * 2 + 20);
    pos.set([x, rand() * 7, z], i * 3);
    seed[i] = rand() * 100;
    kind[i] = dominant(x, z);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  geo.setAttribute('aKind', new THREE.BufferAttribute(kind, 1));
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uScale: { value: 1 } },
    vertexShader: `
      uniform float uTime; uniform float uScale; attribute float aSeed; attribute float aKind; varying float vA; varying vec3 vCol;
      void main(){
        vec3 p = position; float s = aSeed, t = uTime, size = 0.14, a = 1.0;
        if (aKind < 0.5) {            // nature: fireflies
          p.x += sin(t * 0.5 + s) * 0.8; p.z += cos(t * 0.4 + s * 1.3) * 0.8; p.y = 0.4 + mod(position.y, 2.2) + sin(t * 0.9 + s) * 0.3;
          vCol = vec3(0.75, 1.0, 0.35) * 1.6; a = smoothstep(0.2, 1.0, sin(t * 1.7 + s * 5.0) * 0.5 + 0.5);
        } else if (aKind < 1.5) {     // fire: embers rising
          p.y = mod(position.y + t * (0.5 + fract(s) * 0.5), 7.0); p.x += sin(t * 0.6 + s) * 0.6;
          vCol = vec3(1.0, 0.5, 0.15) * 1.8; a = smoothstep(7.0, 4.0, p.y) * (0.6 + 0.4 * sin(t * 5.0 + s * 9.0)); size = 0.11;
        } else if (aKind < 2.5) {     // ice: snow falling
          p.y = 7.0 - mod(7.0 - position.y + t * (0.35 + fract(s) * 0.25), 7.0); p.x += sin(t * 0.7 + s) * 0.5; p.z += cos(t * 0.5 + s) * 0.4;
          vCol = vec3(0.85, 0.92, 1.0) * 0.7; a = smoothstep(0.0, 0.6, p.y) * 0.8; size = 0.12;
        } else if (aKind < 3.5) {     // storm: brief sparks that jump around
          float ph = fract(t * 0.6 + s * 0.37), k = floor(t * 0.6 + s * 0.37);
          p += vec3(sin(s * 3.0 + k * 7.0), 0.0, cos(s * 2.0 + k * 5.0)) * 1.2; p.y = 0.3 + position.y * 0.4;
          vCol = vec3(0.8, 0.72, 1.0) * 2.4; a = step(0.8, ph) * (0.5 + 0.5 * sin(t * 40.0 + s)); size = 0.1;
        } else if (aKind < 4.5) {     // iron: sparks falling from the works
          p.y = 4.5 - mod(4.5 - position.y + t * 1.4 * (0.6 + fract(s)), 4.5);
          vCol = vec3(1.0, 0.72, 0.35) * 1.6; a = step(0.6, fract(s * 7.1)) * smoothstep(0.0, 0.5, p.y); size = 0.08;
        } else if (aKind < 5.5) {     // astral: drifting star motes
          p.y = 0.6 + mod(position.y, 4.0) + sin(t * 0.6 + s) * 0.5; p.x += sin(t * 0.3 + s) * 1.0; p.z += cos(t * 0.35 + s) * 1.0;
          vCol = mix(vec3(1.0, 0.88, 0.45), vec3(0.75, 0.6, 1.0), fract(s * 3.3)) * 1.8; a = 0.5 + 0.5 * sin(t * 2.5 + s * 11.0);
        } else {                      // darkness: slow purple wisps
          p.y = mod(position.y + t * 0.25, 5.0); p.x += sin(t * 0.4 + s) * 0.7;
          vCol = vec3(0.6, 0.25, 0.95) * 1.3; a = smoothstep(5.0, 2.0, p.y) * smoothstep(0.0, 0.8, p.y); size = 0.22;
        }
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vA = a;
        gl_PointSize = uScale * size * 1400.0 / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `varying float vA; varying vec3 vCol;
      void main(){
        float a = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5)) * vA;
        gl_FragColor = vec4(vCol * a, a);
      }`,
  });
  return new THREE.Points(geo, material);
}

// Soft smoke puffs rising from vents, smokestacks and the volcano.
function buildSmoke(sources, rand) {
  const per = 9, N = sources.length * per;
  const pos = new Float32Array(N * 3), meta = new Float32Array(N * 3);
  sources.forEach((s, i) => {
    for (let k = 0; k < per; k++) {
      const j = i * per + k;
      pos.set([s.x, s.y, s.z], j * 3);
      meta.set([rand() * 100, s.big, s.rise], j * 3);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aMeta', new THREE.BufferAttribute(meta, 3));
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      uniform float uTime; attribute vec3 aMeta; varying float vA;
      void main(){
        float life = fract(uTime * 0.12 + aMeta.x * 0.137);
        vec3 p = position + vec3(life * aMeta.z * 0.35 + sin(aMeta.x) * life, life * aMeta.z, cos(aMeta.x) * life * 0.8);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vA = smoothstep(0.0, 0.12, life) * (1.0 - life) * 0.4;
        gl_PointSize = aMeta.y * (0.5 + life * 1.5) * 1400.0 / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `varying float vA;
      void main(){
        float a = smoothstep(0.5, 0.15, length(gl_PointCoord - 0.5)) * vA;
        gl_FragColor = vec4(vec3(0.22, 0.2, 0.22), a);
      }`,
  });
  const pts = new THREE.Points(geo, material);
  pts.renderOrder = 2;
  return pts;
}

// Low ground mist coloured per region from a baked texture: ash haze over the
// fire, white over the ice, smog by the works, thick purple mist at the portal.
const MIST = [[0xa8c098, 0.5], [0x5a4c48, 0.8], [0xb8c6d8, 0.3], [0x6a7090, 0.6], [0x7a6c5c, 0.7], [0x7a6cb0, 0.45], [0x4e2c72, 1.2]];
function buildMist() {
  const W = 320, D = 260, TW = 96, TD = 78;
  const data = new Uint8Array(TW * TD * 4);
  const c = new THREE.Color(), t = new THREE.Color();
  for (let r = 0; r < TD; r++) for (let q = 0; q < TW; q++) {
    const x = ((q + 0.5) / TW - 0.5) * W, z = ((r + 0.5) / TD - 0.5) * D;
    const w = regionWeights(x, z);
    c.setRGB(0, 0, 0); let dens = 0;
    for (let i = 0; i < N_REG; i++) { c.add(t.set(MIST[i][0]).multiplyScalar(w[i])); dens += MIST[i][1] * w[i]; }
    data.set([c.r * 255, c.g * 255, c.b * 255, Math.min(255, dens / 1.5 * 255)], (r * TW + q) * 4);
  }
  const tex = new THREE.DataTexture(data, TW, TD);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  const geo = new THREE.PlaneGeometry(W, D);
  geo.rotateX(-Math.PI / 2);
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: { uTime: { value: 0 }, uHalf: { value: new THREE.Vector2(HALF_X, HALF_Z) }, uTex: { value: tex }, uSize: { value: new THREE.Vector2(W, D) } },
    vertexShader: `varying vec3 vWorld; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `
      uniform float uTime; uniform vec2 uHalf; uniform sampler2D uTex; uniform vec2 uSize; varying vec3 vWorld;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
      void main(){
        vec2 p = vWorld.xz;
        vec4 reg = texture2D(uTex, p / uSize + 0.5);
        float dens = reg.a * 1.5;
        float n = noise(p * 0.06 + vec2(uTime * 0.02, uTime * 0.01)) * 0.6 + noise(p * 0.15 - vec2(uTime * 0.03, 0.0)) * 0.4;
        float out_ = length(max(abs(p) - uHalf, 0.0));
        float a = mix(0.02 * dens * dens, 0.4 * dens, smoothstep(2.0, 16.0, out_)) * smoothstep(0.25, 0.75, n);
        a *= smoothstep(170.0, 90.0, length(p));
        gl_FragColor = vec4(reg.rgb, min(a, 0.6));
      }`,
  });
  const m = new THREE.Mesh(geo, material);
  m.position.y = 0.7;
  m.renderOrder = 3;
  return m;
}

// ------------------------------------------------------------------ export

const _orb = new THREE.Matrix4();
export default {
  id: 'elements',
  name: 'Elemental Realms',
  desc: 'Seven elemental realms in one valley, crossed in turn from gate to portal.',
  lighting: {
    sunDir: SUN_DIR, sunColor: 0xffe4c8, sunIntensity: 3.2,
    hemiSky: 0xb8bcd8, hemiGround: 0x2e2836, hemiIntensity: 0.85,
    fillColor: 0x9aa4d8, fillIntensity: 0.6, fillDir: new THREE.Vector3(-20, 35, 50).normalize(),
    fogColor: 0x4a4660, fogDensity: 0.0036, exposure: 1.05,
    gradeShadow: [0.008, 0.0, 0.02], gradeHighlight: [0.02, 0.01, -0.012],
    nexusFull: 0xb04dff, nexusLow: 0x3a0a50,
  },
  terrainHeight,
  build(rand) {
    const { mesh: terrain, uniforms: terrainU } = buildTerrain();
    const { mesh: road, uniforms: roadU } = buildRoad();
    const sky = buildSky();
    const ribbon = buildPathRibbon(0xfff0c0, 0xc04dff, 0.14);
    const airLane = buildAirLane(0xd8d0ff, 0.12);
    const lava = buildLava();
    const decor = buildDecor(rand);
    const gate = buildGate();
    const nexus = buildNexus();
    const motes = buildMotes(rand);
    const smoke = buildSmoke(decor.smokeSrc, rand);
    const mist = buildMist();
    return {
      objects: [terrain, road, sky, ribbon, airLane, lava, decor.group, gate, nexus, motes, smoke, mist],
      terrainU, roadU, sky, ribbon, lava, gate, nexus, motes, smoke, mist,
      rocks: decor.rocks, bolts: decor.bolts, gears: decor.gears, astral: decor.astral, lights: decor.lights,
    };
  },
  update(env, T) {
    env.sky.material.uniforms.uTime.value = T;
    env.ribbon.material.uniforms.uTime.value = T;
    env.terrainU.uTime.value = T;
    env.roadU.uTime.value = T;
    env.lava.material.uniforms.uTime.value = T;
    env.motes.material.uniforms.uTime.value = T;
    env.smoke.material.uniforms.uTime.value = T;
    env.mist.material.uniforms.uTime.value = T;
    env.gate.userData.vortex.uniforms.uTime.value = T;
    for (const r of env.rocks) { r.g.position.y = r.y + Math.sin(T * 0.6 + r.seed) * 0.35; r.g.rotation.y += 0.002; }
    for (const g of env.gears) g.m.rotation.x = T * 0.25 * g.dir;
    const { orbs, spots } = env.astral;
    spots.forEach((s, i) => { _orb.makeTranslation(s.x, s.y + Math.sin(T * 0.9 + s.seed) * 0.4, s.z); orbs.setMatrixAt(i, _orb); });
    orbs.instanceMatrix.needsUpdate = true;
    const L = env.lights;
    L.lava.intensity = 14 * (0.85 + 0.15 * Math.sin(T * 1.7) + 0.05 * Math.sin(T * 7.3));
    L.furnace.intensity = 8 * (0.8 + 0.2 * Math.sin(T * 3.1 + 1));
    L.astral.intensity = 8 * (0.8 + 0.2 * Math.sin(T * 0.9));
    // Lightning: at most one strike every few seconds, with a double flicker.
    const P = 4.6, k = Math.floor(T / P), h = Math.abs(Math.sin(k * 12.9898) * 43758.5453) % 1;
    const dt = T - k * P - (0.4 + h * 2.8);
    const on = dt > 0 && dt < 0.4 && env.bolts.length > 0;
    const vis = on && (dt < 0.07 || (dt > 0.13 && dt < 0.22) || dt > 0.3);
    const bi = Math.floor(h * 97) % Math.max(1, env.bolts.length);
    env.bolts.forEach((b, i) => { b.mesh.visible = vis && i === bi; });
    if (on) {
      const t = env.bolts[bi].target;
      L.flash.position.set(t.x, t.y + 3, t.z);
      env.sky.material.uniforms.uFlashDir.value.set(t.x, 30, t.z).normalize();
    }
    L.flash.intensity = vis ? 18 * (1 - dt / 0.4) : 0;
    env.sky.material.uniforms.uFlash.value = vis ? 1 - dt / 0.4 : 0;
  },
};
