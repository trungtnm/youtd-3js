// Map theme: a floating island high in the sky in bright daylight. A meadow of
// stone and grass with a road of pale rune-inlaid stones, a jagged rock underside,
// waterfalls spilling off the rim into mist, bobbing islets with trees and ruins,
// a sea of clouds far below, birds, drifting petals and a clear blue sky.

import * as THREE from 'three';
import { mat, glow } from '../models.js';
import {
  fbm, hash, HALF_X, HALF_Z, distToRoute, outside, onEntryRoad, clearOfRoad as clearOf, nearTileCentre, mk, instanced,
  buildPathRibbon, buildAirLane, riftMaterial, GROUND_ROUTE, BLOCKED_TILES, SPAWN, PORTAL, tileToWorld,
} from './shared.js';

const ROAD_HALF = 1.25;
const SUN_DIR = new THREE.Vector3(0.42, 0.74, -0.52).normalize();
const FOG_COLOR = 0xa2bfe4, FOG_DENSITY = 0.0032;
const HAZE = new THREE.Color(FOG_COLOR);
const SEA_Y = -34;          // top of the cloud sea
const LAYER_Y = -26;        // thin, broken cloud layer above it
const DEPTH = 44;           // how far the main island's rock hangs down
// The island top is a superellipse a few units past the play rectangle.
const ISLE_A = HALF_X + 4, ISLE_B = HALF_Z + 4.5, ISLE_P = 8;
// A small islet carries the far end of the entry bridge.
const ENTRY = { x: SPAWN.x - 19.5, z: SPAWN.z, r: 6.5 };
const GATE_X = SPAWN.x - 2.5;

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clearOfRoad = (x, z, margin) => clearOf(x, z, margin, ROAD_HALF);

// ------------------------------------------------------------------ island shape

// Angle-only wobble keeps the outline function homogeneous, so the rim point in
// any direction is simply that direction divided by islandQ.
const wobble = (a) => 1 + 0.026 * Math.sin(5 * a + 1.3) + 0.017 * Math.sin(11 * a + 0.4) + 0.009 * Math.sin(23 * a + 2.1);

// Normalised island radius: < 1 on the island top, 1 at the cliff edge.
function islandQ(x, z) {
  const w = wobble(Math.atan2(z, x));
  const u = Math.abs(x) / (ISLE_A * w), v = Math.abs(z) / (ISLE_B * w);
  return Math.pow(u ** ISLE_P + v ** ISLE_P, 1 / ISLE_P);
}
const rimPoint = (a) => { const c = Math.cos(a), s = Math.sin(a), q = islandQ(c, s); return [c / q, s / q]; };

// Outward normal of the rim at a point, from the gradient of islandQ.
function rimNormal(x, z) {
  const e = 0.05;
  const gx = islandQ(x + e, z) - islandQ(x - e, z), gz = islandQ(x, z + e) - islandQ(x, z - e);
  const l = Math.hypot(gx, gz);
  return [gx / l, gz / l];
}

// Streams that run across the rim from a spring and pour off the edge.
const STREAMS = [[-0.42, -1], [0.5, -1], [1, 0.22], [-1, 0.42], [0.22, 1]].map(([dx, dz]) => {
  const a = Math.atan2(dz, dx);
  const [ex, ez] = rimPoint(a);
  const [nx, nz] = rimNormal(ex, ez);
  let len = 3.4;
  while (len > 1 && outside(ex - nx * len, ez - nz * len) < 0.9) len -= 0.2;
  return { ex: ex - nx * 0.05, ez: ez - nz * 0.05, sx: ex - nx * len, sz: ez - nz * len, nx, nz };
});

function streamDist(x, z) {
  let best = Infinity;
  for (const s of STREAMS) {
    const vx = s.ex - s.sx, vz = s.ez - s.sz, l2 = vx * vx + vz * vz;
    const t = Math.max(0, Math.min(1, ((x - s.sx) * vx + (z - s.sz) * vz) / l2));
    best = Math.min(best, Math.hypot(x - s.sx - vx * t, z - s.sz - vz * t), Math.hypot(x - s.sx, z - s.sz) - 0.4);
  }
  return best;
}

// Height of the main island's top surface (no off-island check).
function topHeight(x, z) {
  let h = (fbm(x * 0.15, z * 0.15) - 0.5) * 0.18;
  const o = outside(x, z);
  if (o > 0) {
    const k = Math.min(1, o / 2.5);
    h += k * fbm(x * 0.22 + 5, z * 0.22) * (z > HALF_Z ? 0.5 : 1.0);      // grassy hummocks on the rim
    h -= Math.min(1, o) * smooth(0.93, 1.0, islandQ(x, z)) * 0.55;        // the lip rolls off at the edge
    const sd = streamDist(x, z);
    if (sd < 1.1) { const c = smooth(1.1, 0.5, sd); h = Math.min(h, h * (1 - c) - 0.16 * c); }
  }
  if (distToRoute(x, z, GROUND_ROUTE) < ROAD_HALF + 0.3 || onEntryRoad(x, z)) h = Math.min(h, -0.04);
  return h;
}

function terrainHeight(x, z) {
  if (onEntryRoad(x, z)) return -0.04;                                    // the bridge deck
  if (islandQ(x, z) <= 1) return topHeight(x, z);
  if (Math.hypot(x - ENTRY.x, z - ENTRY.z) < ENTRY.r) return -0.05;       // the entry islet
  return SEA_Y;                                                            // a long fall to the clouds
}

// ------------------------------------------------------------------ rock bodies

// A closed rock body from rings of points: each ring is N points around the
// outline; the first and last rings may collapse to a point. Flat shaded with
// per-vertex colours. Winding is fixed up so faces point outward.
function ringGeometry(rings, N) {
  const pos = [], col = [], idx = [];
  for (const ring of rings) for (const v of ring) { pos.push(v[0], v[1], v[2]); col.push(v[3].r, v[3].g, v[3].b); }
  for (let k = 0; k < rings.length - 1; k++) {
    for (let i = 0; i < N; i++) {
      const a = k * N + i, b = k * N + (i + 1) % N, c = (k + 1) * N + i, d = (k + 1) * N + (i + 1) % N;
      idx.push(a, c, b, b, c, d);
    }
  }
  // Check one side face against the outward direction and flip if needed.
  const mid = Math.floor(rings.length / 2) * N;
  const A = new THREE.Vector3(...pos.slice(mid * 3, mid * 3 + 3));
  const B = new THREE.Vector3(...pos.slice((mid + 1) * 3, (mid + 1) * 3 + 3));
  const C = new THREE.Vector3(...pos.slice((mid + N) * 3, (mid + N) * 3 + 3));
  const n = new THREE.Vector3().subVectors(C, A).cross(new THREE.Vector3().subVectors(B, A));
  if (n.dot(new THREE.Vector3(A.x, 0, A.z)) < 0) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

const SOIL = new THREE.Color(0x5e4128), SOIL_L = new THREE.Color(0x7d5a3a);
const ROCK_A = new THREE.Color(0xc4b49a), ROCK_B = new THREE.Color(0x9a8a78), ROCK_C = new THREE.Color(0x7e7268);
const ROCK_HAZE = new THREE.Color(0x8e9cb8);
const GRASS_EDGE = new THREE.Color(0x5e9636);

// Rock colour by depth fraction f (0 at the rim): soil, then sandstone strata
// that fade to a hazy blue far below.
function rockColor(f, y, a, k) {
  if (k === 0) return GRASS_EDGE.clone();
  if (k === 1) return SOIL.clone();
  if (k === 2) return SOIL_L.clone();
  const band = Math.sin(y * 1.1 + Math.sin(a * 3) * 1.5) * 0.5 + 0.5;
  const c = ROCK_A.clone().lerp(ROCK_B, band).lerp(ROCK_C, Math.max(0, Math.sin(y * 0.37 + a) * 0.6));
  return c.multiplyScalar(0.9 + hash(a * 31, y) * 0.18).lerp(ROCK_HAZE, Math.min(0.7, f * 0.8));
}

// Depth fractions of the underside rings, and the outline scale at each:
// near-vertical cliff at the top, then tapering to a point like an upturned peak.
const UNDER_F = [0, 0.014, 0.035, 0.07, 0.12, 0.18, 0.25, 0.33, 0.42, 0.52, 0.63, 0.75, 0.87];
const underScale = (f) => (f < 0.02 ? 1 + f * 0.5 : 1 - Math.pow((f - 0.02) / 0.98, 1.5) * 0.96);

// rim(a) -> [x, z, y]; returns rings from the rim down to the tip.
function underRings(rim, N, depth, rand, seed = 0) {
  const rings = [];
  UNDER_F.forEach((f, k) => {
    const ring = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const [x, z, y0] = rim(a);
      let s = underScale(f), y = y0 - f * depth;
      if (k >= 3) {
        s *= 1 + (hash(i * 1.7 + seed, k * 3.1) - 0.5) * (0.04 + f * 0.16);
        y += (hash(i * 2.3 + seed, k * 1.9 + 7) - 0.5) * depth * 0.035;
        // Occasional hanging spikes give the underside its jagged teeth.
        if (k >= 4 && hash(i * 5.1 + seed, k * 0.7) > 0.82) { y -= depth * (0.04 + 0.05 * hash(i, k + seed)); s *= 0.95; }
      }
      ring.push([x * s, y, z * s, rockColor(f, y, a, k)]);
    }
    rings.push(ring);
  });
  const tip = rim(0)[2] - depth * (1.0 + rand() * 0.06);
  rings.push(Array.from({ length: N }, () => [0, tip, 0, ROCK_HAZE.clone()]));
  return rings;
}

const rockMaterial = () => new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0 });

// ------------------------------------------------------------------ main island

function buildTerrain() {
  const W = ISLE_A * 2.1, D = ISLE_B * 2.1, SX = 100, SZ = 64;
  const geo = new THREE.PlaneGeometry(W, D, SX, SZ);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  // Fresh meadow greens with paler worn grass beside the road and warm sunlit patches.
  const grassA = new THREE.Color(0x52902e), grassB = new THREE.Color(0x76ac3e), grassC = new THREE.Color(0x427a2a);
  const worn = new THREE.Color(0xa8b878), sunny = new THREE.Color(0x98b84c), streamBed = new THREE.Color(0x6a7a5a);
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), z = pos.getZ(i);
    // Vertices past the rim collapse onto it, so the grid ends exactly at the cliff.
    const q = islandQ(x, z);
    if (q > 1) { x /= q; z /= q; }
    const h = topHeight(x, z);
    const n = fbm(x * 0.3, z * 0.3);
    c.copy(grassA).lerp(grassB, n).lerp(grassC, fbm(x * 0.06 + 3, z * 0.06) * 0.8).multiplyScalar(0.88 + fbm(x * 0.5, z * 0.5) * 0.24);
    const sun = fbm(x * 0.08 - 7, z * 0.08 + 2);
    if (sun > 0.58) c.lerp(sunny, Math.min(0.6, (sun - 0.58) * 3));
    const pd = distToRoute(x, z, GROUND_ROUTE);
    if (pd < ROAD_HALF + 1.0) c.lerp(worn, Math.min(1, (ROAD_HALF + 1.0 - pd) / 1.0) * 0.55);
    if (streamDist(x, z) < 0.9) c.lerp(streamBed, 0.7);
    pos.setX(i, x); pos.setZ(i, z); pos.setY(i, h);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }));
  m.receiveShadow = true;
  return m;
}

// The island's underside: soil band, sandstone cliffs and a long jagged root of rock.
function buildUnderside(rand) {
  const N = 180;
  const rim = (a) => { const [x, z] = rimPoint(a); return [x, z, topHeight(x * 0.999, z * 0.999)]; };
  const m = new THREE.Mesh(ringGeometry(underRings(rim, N, DEPTH, rand), N), rockMaterial());
  m.receiveShadow = true;
  return m;
}

// Loose rock teeth hanging under the cliff edge, beyond what the body mesh shows.
function buildHangingRocks(group, rand) {
  const cones = [];
  for (let i = 0; i < 70; i++) {
    const a = rand() * Math.PI * 2, f = 0.06 + rand() * 0.4;
    const [x, z] = rimPoint(a);
    const s = underScale(f) - 0.03;
    const h = 2 + rand() * 6, r = 0.6 + rand() * 1.1;
    cones.push(mk(x * s, -f * DEPTH - h / 2 + 0.6, z * s, r, rand() * 6, h, r, Math.PI));
  }
  group.add(instanced(new THREE.ConeGeometry(1, 1, 5), mat(0x9a8a76, { flat: true, rough: 0.95 }), cones, { cast: false }));
}

// Road: one plane whose shader paints pale ancient flagstones within the road's
// distance field, with a curb, a faint rune inlay along it and glowing rune
// glyphs carved into some stones. A standard material keeps sun, shadow and fog.
function buildRoad() {
  const segs = GROUND_ROUTE.segs;
  const uniforms = {
    uA: { value: segs.map((s) => new THREE.Vector2(s.a.x, s.a.z)) },
    uB: { value: segs.map((s) => new THREE.Vector2(s.b.x, s.b.z)) },
    uHalf: { value: ROAD_HALF }, uSpawn: { value: new THREE.Vector2(SPAWN.x, SPAWN.z) }, uEdgeX: { value: -HALF_X },
    uTime: { value: 0 },
  };
  const material = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vRoad;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRoad = (modelMatrix * vec4(position, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vRoad;
        uniform vec2 uA[${segs.length}]; uniform vec2 uB[${segs.length}]; uniform float uHalf; uniform vec2 uSpawn; uniform float uEdgeX; uniform float uTime;
        vec2 rh2(vec2 p){ p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
        float segDist(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; float t = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * t); }
        float lineMask(vec2 l, float ang, float w){ return smoothstep(w, w * 0.4, abs(dot(l, vec2(-sin(ang), cos(ang))))); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 runeGlow = vec3(0.0);
        {
          vec2 p = vRoad;
          float d = 1e9;
          for (int i = 0; i < ${segs.length}; i++) d = min(d, segDist(p, uA[i], uB[i]));
          if (p.x < uEdgeX + 3.0 && p.x > uSpawn.x - 14.0) d = min(d, abs(p.y - uSpawn.y));
          if (d > uHalf) discard;
          // Flagstones: jittered cells; mortar where the two nearest centres are about equally far.
          vec2 q = p * 1.15; vec2 cell = floor(q); vec2 f = fract(q);
          float d1 = 8.0, d2 = 8.0; vec2 id = vec2(0.0); vec2 rel = vec2(0.0);
          for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
            vec2 g = vec2(float(x), float(y)); vec2 o = rh2(cell + g) * 0.8 + 0.1;
            vec2 dv = f - g - o; float dd = length(dv);
            if (dd < d1) { d2 = d1; d1 = dd; id = cell + g; rel = dv; } else if (dd < d2) d2 = dd;
          }
          vec2 r = rh2(id);
          float mortar = smoothstep(0.035, 0.1, d2 - d1);
          vec3 stone = mix(vec3(0.66, 0.64, 0.59), vec3(0.8, 0.78, 0.72), r.x) * (0.9 + 0.1 * r.y);
          stone *= 0.9 + 0.1 * smoothstep(0.0, 0.5, d1);
          vec3 col = mix(vec3(0.42, 0.46, 0.5), stone, mortar);
          // Curb of long blue-grey blocks with a fine rune inlay just inside it.
          float curb = smoothstep(uHalf - 0.26, uHalf - 0.22, d);
          float joint = smoothstep(0.03, 0.0, abs(fract(dot(p, vec2(0.7071)) * 0.9) - 0.5) - 0.47);
          col = mix(col, vec3(0.6, 0.64, 0.7) * (1.0 - joint * 0.35), curb);
          float inlay = smoothstep(0.03, 0.0, abs(d - (uHalf - 0.3)));
          col = mix(col, vec3(0.5, 0.85, 1.0), inlay * 0.7);
          // Rune glyphs on about one stone in six: a ring with strokes through it.
          float rune = 0.0;
          if (r.y > 0.83 && d < uHalf - 0.45) {
            float rad = length(rel); float a0 = r.x * 6.283;
            float ring = smoothstep(0.035, 0.012, abs(rad - 0.2));
            float s1 = lineMask(rel, a0, 0.03) * step(rad, 0.2);
            float s2 = lineMask(rel, a0 + 2.1, 0.03) * step(rad, 0.14) * step(0.5, fract(r.x * 7.0));
            float dotc = smoothstep(0.06, 0.035, rad) * step(fract(r.x * 13.0), 0.5);
            rune = max(max(ring, s1), max(s2, dotc)) * mortar;
          }
          float pulse = 0.7 + 0.3 * sin(uTime * 1.6 + r.x * 20.0);
          col = mix(col, vec3(0.6, 0.92, 1.0), rune * 0.85);
          diffuseColor.rgb = pow(col, vec3(2.2)); // authored in sRGB, lit in linear
          runeGlow = vec3(0.2, 0.7, 1.0) * (rune * 1.3 * pulse + inlay * 0.35);
        }`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += runeGlow;');
  };
  const geo = new THREE.PlaneGeometry(HALF_X * 2 + 40, HALF_Z * 2 + 4);
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, material);
  m.position.y = 0.02;
  m.receiveShadow = true;
  m.userData.uniforms = uniforms;
  return m;
}

// ------------------------------------------------------------------ sky and clouds

function buildSky() {
  const geo = new THREE.SphereGeometry(600, 32, 16);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uSun: { value: SUN_DIR.clone() }, uTime: { value: 0 }, uHaze: { value: HAZE.clone() } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 uSun; uniform float uTime; uniform vec3 uHaze; varying vec3 vDir;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
      float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += noise(p) * a; p *= 2.1; a *= 0.5; } return s; }
      void main(){
        float y = vDir.y;
        float s = max(dot(vDir, uSun), 0.0);
        // Clear daylight: deep blue zenith fading to a pale haze at the horizon.
        vec3 zen = vec3(0.07, 0.24, 0.66);
        vec3 col = mix(uHaze, zen, pow(smoothstep(-0.02, 0.75, y), 0.6));
        col = mix(col, uHaze, smoothstep(0.02, -0.06, y));
        // Sun: wide warm glow and a bright disc.
        col += vec3(1.0, 0.9, 0.7) * pow(s, 8.0) * 0.35 + vec3(1.0, 0.95, 0.85) * smoothstep(0.9990, 0.9995, s) * 4.0;
        // Soft cumulus banks above the horizon, lit on the sun side.
        vec2 cp = vDir.xz / max(y + 0.1, 0.05) * 0.8 + vec2(uTime * 0.006, 0.0);
        float n = fbm(cp);
        float cl = smoothstep(0.48, 0.72, n) * smoothstep(0.0, 0.06, y) * smoothstep(0.5, 0.12, y);
        vec3 cloudCol = mix(vec3(0.5, 0.58, 0.7), vec3(0.76, 0.78, 0.82), smoothstep(0.5, 0.8, n) * 0.7 + s * 0.3);
        col = mix(col, cloudCol, cl * 0.85);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const m = new THREE.Mesh(geo, material);
  m.renderOrder = -1;
  return m;
}

// The sea of clouds far below: billowing noise lit from the sun's side, fading
// into the horizon haze. `alpha` > 0 makes a broken, translucent upper layer.
function cloudLayer(y, scale, speed, broken) {
  const geo = new THREE.CircleGeometry(560, 48);
  geo.rotateX(-Math.PI / 2);
  const material = new THREE.ShaderMaterial({
    transparent: broken, depthWrite: !broken, fog: false,
    uniforms: { uTime: { value: 0 }, uSun: { value: SUN_DIR.clone() }, uHaze: { value: HAZE.clone() } },
    vertexShader: `varying vec3 vWorld; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `
      uniform float uTime; uniform vec3 uSun; uniform vec3 uHaze; varying vec3 vWorld;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
      float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += noise(p) * a; p *= 2.03; a *= 0.5; } return s; }
      void main(){
        vec2 p = vWorld.xz * ${scale.toFixed(4)} + vec2(uTime * ${speed.toFixed(4)}, uTime * ${(speed * 0.4).toFixed(4)});
        float c = fbm(p);
        // Fake lighting: brighter where density falls off toward the sun.
        float lit = clamp((c - fbm(p + uSun.xz * 0.25)) * 4.0 + 0.6, 0.0, 1.0);
        vec3 col = mix(vec3(0.26, 0.38, 0.58), vec3(0.68, 0.71, 0.77), smoothstep(0.35, 0.65, c) * 0.6 + lit * 0.4);
        float d = length(vWorld - cameraPosition);
        float f = 1.0 - exp(-pow(d * 0.0034, 2.0));
        col = mix(col, uHaze, f);
        float a = ${broken ? 'smoothstep(0.55, 0.75, c) * 0.4 * (1.0 - f * 0.6)' : '1.0'};
        gl_FragColor = vec4(col, a);
      }`,
  });
  const m = new THREE.Mesh(geo, material);
  m.position.y = y;
  return m;
}

// Puffy cloud clumps rising out of the sea and drifting past the far islets.
function buildCloudPuffs(rand) {
  const puffs = [];
  for (let i = 0; i < 60; i++) {
    const a = rand() * Math.PI * 2, r = 55 + rand() * 170;
    const x = Math.cos(a) * r, z = Math.sin(a) * r * 0.8;
    const high = rand() < 0.3 && z < -110;                                  // a few high clouds far behind
    const y = high ? 4 + rand() * 18 : SEA_Y + 2 + rand() * 8;
    const s = 3 + rand() * 5;
    for (let k = 0; k < 5; k++) {
      const ox = (rand() - 0.5) * s * 2.6, oz = (rand() - 0.5) * s * 1.4;
      const ks = s * (0.55 + rand() * 0.5);
      puffs.push(mk(x + ox, y + ks * 0.25, z + oz, ks, rand() * 6, ks * 0.7, ks));
    }
  }
  return instanced(new THREE.IcosahedronGeometry(1, 2), mat(0xc8d0dc, { rough: 1, emissive: 0x9aa8c0, ei: 0.1 }), puffs, { cast: false });
}

// ------------------------------------------------------------------ water

// Streams and waterfalls share one ribbon material: flowing streaks that speed
// up over the lip, foam brighter in the fall, fading out into mist below.
function waterMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      attribute float aFall; attribute float aFade; varying vec2 vUv; varying float vFall; varying float vFade;
      void main(){ vUv = uv; vFall = aFall; vFade = aFade; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform float uTime; varying vec2 vUv; varying float vFall; varying float vFade;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
      void main(){
        float across = abs(vUv.x - 0.5) * 2.0;
        float sp = mix(0.8, 3.0, vFall);
        float s1 = noise(vec2(vUv.x * 9.0, vUv.y * 0.6 - uTime * sp));
        float s2 = noise(vec2(vUv.x * 21.0 + 3.0, vUv.y * 1.4 - uTime * sp * 1.4));
        float foam = smoothstep(0.45, 0.85, s1 * 0.6 + s2 * 0.4);
        vec3 col = mix(vec3(0.2, 0.5, 0.75), vec3(0.8, 0.87, 0.94), clamp(foam + vFall * 0.45, 0.0, 1.0));
        float a = mix(0.85, 0.75 + foam * 0.2, vFall) * smoothstep(1.0, 0.65, across) * vFade;
        gl_FragColor = vec4(col, a);
      }`,
  });
}

// One ribbon per stream: along the rim, over the lip, then down a gravity curve.
function buildWaterfalls(group) {
  const material = waterMaterial();
  const mistPts = [];
  for (const s of STREAMS) {
    const pts = [];
    const sideX = -s.nz, sideZ = s.nx;
    for (let k = 0; k <= 8; k++) {
      const t = k / 8, x = s.sx + (s.ex - s.sx) * t, z = s.sz + (s.ez - s.sz) * t;
      pts.push({ x, z, y: topHeight(x, z) + 0.08, w: 1.1, fall: 0, fade: 1 });
    }
    const top = pts[pts.length - 1].y, L = 25;
    for (let k = 1; k <= 30; k++) {
      const t = k / 30, drop = t * t * 0.35 * L + t * 0.65 * L;
      const o = 0.2 + 0.55 * Math.sqrt(drop);
      pts.push({ x: s.ex + s.nx * o, z: s.ez + s.nz * o, y: top - drop, w: 1.3 + t * 2.4, fall: Math.min(1, t * 6), fade: 1 - smooth(0.45, 1, t) });
    }
    const pos = [], uv = [], fall = [], fade = [], idx = [];
    let dist = 0;
    pts.forEach((p, i) => {
      if (i > 0) { const q = pts[i - 1]; dist += Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z); }
      pos.push(p.x + sideX * p.w / 2, p.y, p.z + sideZ * p.w / 2, p.x - sideX * p.w / 2, p.y, p.z - sideZ * p.w / 2);
      uv.push(0, dist, 1, dist);
      fall.push(p.fall, p.fall); fade.push(p.fade, p.fade);
      if (i > 0) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('aFall', new THREE.Float32BufferAttribute(fall, 1));
    geo.setAttribute('aFade', new THREE.Float32BufferAttribute(fade, 1));
    geo.setIndex(idx);
    const m = new THREE.Mesh(geo, material);
    m.renderOrder = 2;
    group.add(m);
    // Spring pool with a ring of stones where the stream starts.
    const pool = new THREE.Mesh(new THREE.CircleGeometry(0.85, 12), material);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(s.sx, topHeight(s.sx, s.sz) + 0.09, s.sz);
    group.add(pool);
    const b = pts[pts.length - 1];
    mistPts.push({ x: b.x, y: b.y + 6, z: b.z, sideX, sideZ });
  }
  const stones = [];
  for (const s of STREAMS) {
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2 + 0.4, x = s.sx + Math.cos(a) * 1.05, z = s.sz + Math.sin(a) * 1.05;
      if (Math.hypot(x - s.ex, z - s.ez) < Math.hypot(s.sx - s.ex, s.sz - s.ez) - 0.5) continue; // leave the outflow open
      stones.push(mk(x, topHeight(x, z) + 0.05, z, 0.22 + hash(k, s.sx) * 0.15, k, 0.16));
    }
  }
  group.add(instanced(new THREE.DodecahedronGeometry(1, 0), mat(0xb8b0a4, { flat: true }), stones, { cast: false }));
  return { material, mistPts };
}

// Mist where each waterfall frays into the clouds: big soft puffs that swell and fade.
function buildMist(spots, rand) {
  const N = spots.length * 26;
  const pos = new Float32Array(N * 3), seed = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const s = spots[i % spots.length], a = (rand() - 0.5) * 7;
    pos.set([s.x + s.sideX * a, s.y + (rand() - 0.5) * 8, s.z + s.sideZ * a], i * 3);
    seed[i] = rand() * 100;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      uniform float uTime; attribute float aSeed; varying float vA;
      void main(){
        float life = fract(uTime * 0.08 + aSeed * 0.137);
        vec3 p = position + vec3(sin(aSeed) * life * 2.0, life * 3.0 - 1.5, cos(aSeed) * life * 2.0);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vA = smoothstep(0.0, 0.2, life) * smoothstep(1.0, 0.5, life) * 0.4;
        gl_PointSize = (1400.0 + life * 1800.0) / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d) * vA; gl_FragColor = vec4(vec3(0.78, 0.84, 0.9), a); }`,
  });
  return new THREE.Points(geo, material);
}

// ------------------------------------------------------------------ islets

const TREE_PAL = [0x5f9e3a, 0x78b448, 0x4e8a34, 0x8cc050].map((c) => new THREE.Color(c));
const BLOSSOM = [0xf0b0cc, 0xf6d0e0].map((c) => new THREE.Color(c));

// Round-canopied trees (some in blossom) as trunk and canopy matrix lists.
function addTree(out, x, y, z, s, rand) {
  out.trunks.push(mk(x, y + 0.9 * s, z, s, rand() * 6));
  const pal = rand() < 0.22 ? BLOSSOM : TREE_PAL;
  const base = pal[Math.floor(rand() * pal.length)];
  for (let k = 0; k < 3; k++) {
    const a = rand() * 6, r = k === 0 ? 0 : 0.6 * s;
    out.canopy.push(mk(x + Math.cos(a) * r, y + (2.1 + k * 0.45 + rand() * 0.3) * s, z + Math.sin(a) * r, (1.0 - k * 0.15) * s, rand() * 6));
    out.canopyCol.push(base.clone().offsetHSL(0, 0, (rand() - 0.5) * 0.08));
  }
}
function treeMeshes(t, cast = false) {
  return [
    instanced(new THREE.CylinderGeometry(0.14, 0.24, 1.8, 6), mat(0x6a4a30, { flat: true }), t.trunks, { cast }),
    instanced(new THREE.IcosahedronGeometry(1, 0), mat(0xffffff, { flat: true, rough: 0.9 }), t.canopy, { cast, colors: t.canopyCol }),
  ];
}

const STONE = 0xd8d0c2, STONE_D = 0xa89e92;

// A broken little ruin: column stubs and an arch, placed on an islet top.
function addRuin(g, R, y, rand) {
  const stone = mat(STONE, { flat: true, rough: 0.85 });
  for (let k = 0; k < 4; k++) {
    const a = rand() * 6, r = R * (0.25 + rand() * 0.4), h = 0.8 + rand() * 2.4;
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, h, 8), stone);
    c.position.set(Math.cos(a) * r, y + h / 2, Math.sin(a) * r);
    c.rotation.z = (rand() - 0.5) * 0.1;
    g.add(c);
  }
  const arch = new THREE.Group();
  for (const s of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.6, s === 1 ? 2.0 : 3.4, 0.6), stone);
    p.position.set(s * 1.3, (s === 1 ? 2.0 : 3.4) / 2, 0);
    arch.add(p);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.5, 0.7), stone);
  lintel.position.set(-0.5, 3.6, 0); lintel.rotation.z = -0.15;
  arch.add(lintel);
  arch.position.y = y; arch.rotation.y = rand() * 6;
  g.add(arch);
}

// A floating islet: grassy dome on a jagged rock cone, with trees, a ruin or a rune stone.
function buildIslet(x, y, z, R, kind, rand) {
  const g = new THREE.Group();
  const N = 28, depth = R * (1.8 + rand() * 0.8);
  const ph = rand() * 6;
  const w = (a) => 1 + 0.12 * Math.sin(3 * a + ph) + 0.06 * Math.sin(7 * a + ph * 2);
  const rim = (a) => [Math.cos(a) * R * w(a), Math.sin(a) * R * w(a), 0];
  const grass = new THREE.Color(0x6aa63c), grassL = new THREE.Color(0x86ba4c);
  // Top cap: centre point, an inner ring raised a little, then the rim and the underside.
  const centre = Array.from({ length: N }, () => [0, 0.35, 0, grassL.clone()]);
  const inner = Array.from({ length: N }, (_, i) => { const a = (i / N) * Math.PI * 2, [rx, rz] = rim(a); return [rx * 0.55, 0.22, rz * 0.55, grass.clone().lerp(grassL, hash(i, R))]; });
  const rings = [centre, inner, ...underRings(rim, N, depth, rand, R * 13)];
  const body = new THREE.Mesh(ringGeometry(rings, N), rockMaterial());
  g.add(body);
  const trees = { trunks: [], canopy: [], canopyCol: [] };
  if (kind === 'trees') {
    const n = Math.round(R * 0.9);
    for (let k = 0; k < n; k++) { const a = rand() * 6, r = rand() * R * 0.6; addTree(trees, Math.cos(a) * r, 0.25, Math.sin(a) * r, 0.7 + rand() * 0.6, rand); }
  } else if (kind === 'ruins') {
    addRuin(g, R, 0.25, rand);
    for (let k = 0; k < 2; k++) { const a = rand() * 6; addTree(trees, Math.cos(a) * R * 0.6, 0.2, Math.sin(a) * R * 0.6, 0.6 + rand() * 0.3, rand); }
  } else if (kind === 'rune') {
    const st = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.55, 3.2, 5), mat(0x8a94a8, { flat: true }));
    st.position.y = 1.85;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.47, 0.5, 0.25, 5), glow(0x6fd8ff, 2.2));
    band.position.y = 2.0;
    g.add(st, band);
  }
  if (trees.trunks.length) g.add(...treeMeshes(trees));
  g.position.set(x, y, z);
  g.userData = { baseY: y, phase: ph, amp: 0.35 + rand() * 0.5, rate: 0.25 + rand() * 0.25 };
  return g;
}

// Islets around the main island. Those on the camera side sit well below the
// field so they never hide it; the tall, high ones drift behind.
const ISLETS = [
  [-56, -32, 3, 5, 'trees'], [-22, -46, 6, 6, 'ruins'], [10, -54, 11, 4, 'trees'], [42, -40, 2, 5.5, 'trees'],
  [64, -12, -4, 6, 'ruins'], [60, 24, -10, 4.5, 'rune'], [-62, 16, -8, 5, 'trees'], [-30, 38, -14, 4, 'trees'],
  [26, 40, -15, 5, 'ruins'], [-100, -72, 16, 10, 'trees'], [92, -82, 22, 11, 'ruins'], [0, -118, 28, 13, 'trees'],
  [-110, 10, -2, 8, 'trees'], [112, 26, 4, 9, 'trees'],
];

// The islet carrying the far end of the entry bridge: static, level with the road.
function buildEntryIslet(rand) {
  const g = buildIslet(ENTRY.x, -0.25, ENTRY.z, ENTRY.r, 'none', rand);
  const trees = { trunks: [], canopy: [], canopyCol: [] };
  for (const [ox, oz] of [[-3.5, -3.6], [-1.5, 4.0], [2.5, -4.0]]) addTree(trees, ox, 0.25, oz, 0.8 + rand() * 0.3, rand);
  g.add(...treeMeshes(trees));
  return g;
}

// ------------------------------------------------------------------ bridge, gate and props

// Stone bridge from the entry islet to the island: deck slabs, low parapets and
// hanging keel stones; a landing slab under the gate.
function buildBridge(group, rand) {
  const slabs = [], parapets = [], keels = [];
  for (let x = ENTRY.x + 3; x < SPAWN.x - 1; x += 1.25) {
    slabs.push(mk(x + 0.6, -0.3, SPAWN.z, 1, (rand() - 0.5) * 0.04, 0.55, 1, 0, (rand() - 0.5) * 0.02));
    for (const s of [-1, 1]) if (rand() < 0.85) parapets.push(mk(x + 0.6, 0.18, SPAWN.z + s * 1.62, 1.05, 0, 0.42 + rand() * 0.12, 0.3));
    if (Math.round(x) % 3 === 0) { const h = 2.2 + rand() * 1.8; keels.push(mk(x + 0.6, -0.55 - h / 2, SPAWN.z, 0.9 + rand() * 0.4, rand() * 6, h, 0.9, Math.PI)); }
  }
  const box = new THREE.BoxGeometry(1.25, 1, 3.6);
  group.add(instanced(box, mat(0xb4ac9e, { flat: true, rough: 0.9 }), slabs));
  group.add(instanced(new THREE.BoxGeometry(1, 1, 1), mat(STONE_D, { flat: true }), parapets));
  group.add(instanced(new THREE.ConeGeometry(1, 1, 5), mat(0x9a8a76, { flat: true }), keels, { cast: false }));
  // Loose stones that broke off and float below the span.
  const loose = [];
  for (let k = 0; k < 10; k++) loose.push(mk(ENTRY.x + 4 + rand() * 12, -2.5 - rand() * 4, SPAWN.z + (rand() - 0.5) * 6, 0.3 + rand() * 0.5, rand() * 6, 0.3 + rand() * 0.3, 0.4, rand(), rand()));
  group.add(instanced(new THREE.DodecahedronGeometry(1, 0), mat(0xb0a698, { flat: true }), loose, { cast: false }));
}

// The spawn gate: a floating archway of separate stone blocks around a bright rift.
function buildGate() {
  const g = new THREE.Group();
  const stone = mat(0x9aa2b0, { flat: true, rough: 0.85 });
  const runeMat = glow(0x6fd8ff, 2.4);
  const pieces = [];
  const add = (mesh, bob) => { g.add(mesh); mesh.castShadow = true; if (bob) pieces.push({ mesh, y: mesh.position.y, seed: pieces.length * 1.3 }); };
  for (const s of [-1, 1]) {
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.6, 1.5), stone);
    base.position.set(0, 0.3, s * 3.0);
    add(base, false);
    // Pillar drums float with small gaps between them.
    for (let k = 0; k < 3; k++) {
      const drum = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.5, 1.1), stone);
      drum.position.set(0, 1.25 + k * 1.75, s * 3.0);
      drum.rotation.y = (k - 1) * 0.12 * s;
      add(drum, true);
      const rune = new THREE.Mesh(new THREE.BoxGeometry(1.14, 0.12, 1.14), runeMat);
      rune.position.copy(drum.position);
      drum.add(rune); rune.position.set(0, 0.3, 0);
    }
  }
  // Pointed arch of five voussoirs, each hovering slightly apart.
  for (let k = 0; k < 5; k++) {
    const a = Math.PI * (0.1 + 0.8 * (k / 4));
    const v = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.8, k === 2 ? 1.2 : 1.0), k === 2 ? runeMat : stone);
    v.position.set(0, 6.0 + Math.sin(a) * 1.6, Math.cos(a) * 3.0);
    v.rotation.x = -(a - Math.PI / 2);
    add(v, true);
  }
  const vortexMat = riftMaterial(0x2a9cff, 0xeafcff);
  const vortex = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 6.6), vortexMat);
  vortex.rotation.y = Math.PI / 2;
  vortex.position.y = 3.4;
  g.add(vortex);
  // Rune circle on the landing below the rift.
  const circle = new THREE.Mesh(new THREE.RingGeometry(1.6, 1.8, 32), new THREE.MeshBasicMaterial({ color: 0x7fe0ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
  circle.rotation.x = -Math.PI / 2; circle.position.y = 0.06;
  g.add(circle);
  const light = new THREE.PointLight(0x6fd0ff, 8, 12, 1.6);
  light.position.set(1, 3.4, 0);
  g.add(light);
  g.position.set(GATE_X, 0, SPAWN.z);
  g.userData.vortex = vortexMat;
  g.userData.pieces = pieces;
  return g;
}

// The portal: an open sky shrine of white marble and gold around a floating crystal.
function buildNexus() {
  const g = new THREE.Group();
  const marble = mat(0xc8c0b4, { flat: true, rough: 0.6 });
  const marbleD = mat(0xa8a094, { flat: true, rough: 0.7 });
  const gold = mat(0xe0b050, { metal: 0.7, rough: 0.35 });
  const steps = [[3.2, 3.5, 0.35, marbleD], [2.6, 2.9, 0.35, marble], [2.0, 2.3, 0.3, marbleD]];
  let y = 0;
  for (const [rt, rb, h, m] of steps) {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 8), m);
    s.position.y = y + h / 2; s.castShadow = true; s.receiveShadow = true;
    g.add(s);
    y += h;
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 4.2, 8), marble);
    p.position.set(Math.cos(a) * 2.7, y + 1.7, Math.sin(a) * 2.7); p.castShadow = true;
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.25, 0.6), gold);
    cap.position.set(Math.cos(a) * 2.7, y + 3.9, Math.sin(a) * 2.7);
    g.add(p, cap);
  }
  // A thin gilded ring tying the pillar tops together.
  const crown = new THREE.Mesh(new THREE.TorusGeometry(2.7, 0.12, 5, 36), gold);
  crown.rotation.x = Math.PI / 2; crown.position.y = y + 4.15;
  g.add(crown);
  const crystalMat = new THREE.MeshStandardMaterial({ color: 0xfff0c8, emissive: 0xffb83a, emissiveIntensity: 1.1, roughness: 0.12, metalness: 0.2, flatShading: true });
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(1.1, 0), crystalMat);
  crystal.scale.set(0.8, 1.6, 0.8);
  crystal.position.y = 3.6; crystal.castShadow = true;
  g.add(crystal);
  const ring1 = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.05, 6, 48), glow(0x6fe8ff, 2.5));
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(2.0, 0.04, 6, 48), glow(0xffd27a, 2.5));
  ring1.position.y = ring2.position.y = 3.6;
  g.add(ring1, ring2);
  const pillarMat = new THREE.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.0, 40, 16, 1, true), pillarMat);
  beam.position.y = 22;
  g.add(beam);
  const light = new THREE.PointLight(0xffd890, 4, 12, 1.5);
  light.position.y = 4;
  g.add(light);
  g.position.set(PORTAL.x + 1.5, 0, PORTAL.z);
  g.userData = { crystal, crystalMat, ring1, ring2, beam, pillarMat, crystalY: 3.6 };
  return g;
}

// Rune pylons on the outside of each road corner (on tile corners, clear of
// towers): short stone posts with a floating crystal. Two carry real lights.
function buildPylons(group) {
  const out = [];
  const pts = GROUND_ROUTE.pts;
  const post = mat(0xc8c0b4, { flat: true, rough: 0.85 });
  for (let i = 1; i < pts.length - 1; i++) {
    const s1 = GROUND_ROUTE.segs[i - 1], s2 = GROUND_ROUTE.segs[i];
    const x = pts[i].x + (s1.dx - s2.dx) * 1.15, z = pts[i].z + (s1.dz - s2.dz) * 1.15;
    const g = new THREE.Group();
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.22, 1.0, 5), post);
    p.position.y = 0.5; p.castShadow = true;
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), glow(0x6fd8ff, 3));
    gem.position.y = 1.35;
    g.add(p, gem);
    if (i % 2 === 1) { const l = new THREE.PointLight(0x7fd8ff, 3, 6, 1.6); l.position.y = 1.4; g.add(l); }
    g.position.set(x, terrainHeight(x, z), z);
    group.add(g);
    out.push({ gem, seed: i * 1.9 });
  }
  return out;
}

// Rune monoliths floating above the rim, slowly turning; small ones on the camera side.
function buildRuneStones(rand) {
  const list = [];
  for (let i = 0; i < 80 && list.length < 16; i++) {
    const a = rand() * Math.PI * 2;
    const [ex, ez] = rimPoint(a);
    const x = ex * 0.95, z = ez * 0.95;
    if (outside(x, z) < 1.2 || streamDist(x, z) < 2 || Math.hypot(x - GATE_X, z - SPAWN.z) < 6 || onEntryRoad(x, z)) continue;
    if (list.some((s) => Math.hypot(s.x - x, s.z - z) < 7)) continue;
    const near = z > HALF_Z;
    list.push({ x, z, y: topHeight(x, z) + (near ? 0.6 : 1.0), h: near ? 0.9 + rand() * 0.4 : 2.0 + rand() * 1.4, phase: rand() * 6, spin: (rand() - 0.5) * 0.3 });
  }
  const stones = instanced(new THREE.CylinderGeometry(0.3, 0.42, 1, 5), mat(0x8a94a8, { flat: true, rough: 0.8 }), list.map(() => new THREE.Matrix4()), { cast: false });
  const bands = instanced(new THREE.CylinderGeometry(0.4, 0.4, 0.08, 5), glow(0x6fd8ff, 2.4), list.map(() => new THREE.Matrix4()), { cast: false });
  return { list, stones, bands };
}

function buildDecor(rand) {
  const group = new THREE.Group();
  const trees = { trunks: [], canopy: [], canopyCol: [] };
  // Trees on the rim, except on the camera side, kept clear of streams and the gate.
  for (let i = 0; i < 700 && trees.trunks.length < 60; i++) {
    const x = (rand() - 0.5) * ISLE_A * 2, z = (rand() - 0.5) * ISLE_B * 2;
    const o = outside(x, z);
    if (o < 1.3 || islandQ(x, z) > 0.95 || z > HALF_Z || streamDist(x, z) < 1.8) continue;
    if (Math.hypot(x - GATE_X, z - SPAWN.z) < 6 || onEntryRoad(x, z)) continue;
    if (fbm(x * 0.12 + 20, z * 0.12) < 0.42) continue;                         // groves, not a hedge
    addTree(trees, x, topHeight(x, z), z, 0.7 + rand() * 0.5, rand);
  }
  group.add(...treeMeshes(trees, true));

  // Ground cover over the whole top: grass tufts (wind-swept in the shader), flowers and pebbles.
  const tufts = [], flowers = [], flowerCol = [], pebbles = [], runes = [], bushes = [], bushCol = [];
  const flowerPal = [0xffffff, 0xffe066, 0xf4a6c8, 0x9fc8ff].map((c) => new THREE.Color(c));
  for (let i = 0; i < 2600; i++) {
    const x = (rand() - 0.5) * ISLE_A * 2, z = (rand() - 0.5) * ISLE_B * 2;
    if (islandQ(x, z) > 0.975 || !clearOfRoad(x, z, 0.3) || streamDist(x, z) < 0.9) continue;
    if (Math.hypot(x - GATE_X, z - SPAWN.z) < 3.5) continue;
    const y = topHeight(x, z);
    const roll = rand();
    if (roll < 0.62) { const s = 0.25 + rand() * 0.3; tufts.push(mk(x, y, z, s, (rand() - 0.5) * 0.6, s * (1 + rand() * 0.8), s)); }
    else if (roll < 0.8) { flowers.push(mk(x, y + 0.12, z, 0.06 + rand() * 0.03)); flowerCol.push(flowerPal[Math.floor(rand() * 4)]); }
    else if (roll < 0.86 && !nearTileCentre(x, z)) pebbles.push(mk(x, y + 0.03, z, 0.12 + rand() * 0.14, rand() * 6, 0.06 + rand() * 0.06));
    else if (roll < 0.875 && !nearTileCentre(x, z) && outside(x, z) < 0) runes.push(mk(x, y + 0.02, z, 0.2, rand() * 6, 0.03));
    else if (roll < 0.92 && outside(x, z) > 0.8) { bushes.push(mk(x, y + 0.15, z, 0.35 + rand() * 0.3, rand() * 6, 0.3 + rand() * 0.2)); bushCol.push(TREE_PAL[Math.floor(rand() * 4)]); }
  }
  // Blocked corner tiles: pale boulders with cyan crystal clusters.
  const boulders = [], crystals = [];
  for (const key of BLOCKED_TILES) {
    const [c, r] = key.split(',').map(Number);
    const p = tileToWorld(c, r);
    for (let k = 0; k < 2; k++) boulders.push(mk(p.x + (rand() - 0.5) * 1.2, 0.15, p.z + (rand() - 0.5) * 1.2, 0.45 + rand() * 0.4, rand() * 6, 0.35 + rand() * 0.35));
    if (rand() < 0.6) for (let k = 0; k < 3; k++) {
      const s = 0.18 + rand() * 0.15;
      crystals.push(mk(p.x + (rand() - 0.5) * 1.0, 0.3, p.z + (rand() - 0.5) * 1.0, s, rand() * 6, s * 3, s, (rand() - 0.5) * 0.6, (rand() - 0.5) * 0.6));
    }
  }
  // Rocks along the rim edge.
  for (let i = 0; i < 70; i++) {
    const a = rand() * Math.PI * 2, [ex, ez] = rimPoint(a), x = ex * 0.97, z = ez * 0.97;
    if (outside(x, z) < 0.8 || onEntryRoad(x, z) || streamDist(x, z) < 1.2 || Math.hypot(x - GATE_X, z - SPAWN.z) < 4) continue;
    boulders.push(mk(x, topHeight(x, z), z, 0.3 + rand() * 0.6, rand() * 6, 0.25 + rand() * 0.4));
  }

  const tuftGeo = new THREE.ConeGeometry(0.11, 0.7, 3);
  tuftGeo.translate(0, 0.35, 0);
  const tuftMat = new THREE.MeshStandardMaterial({ color: 0x78b040, roughness: 1, flatShading: true });
  const wind = { value: 0 };
  // Sway in world x by height, phased by each instance's position, so gusts roll across the meadow.
  tuftMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = wind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec2 ip = instanceMatrix[3].xz;
        float gust = sin(uTime * 1.7 + ip.x * 0.25 + ip.y * 0.15) * 0.5 + 0.5;
        transformed.x += (0.12 + gust * 0.22) * position.y * position.y * 2.0;
        transformed.z += sin(uTime * 2.3 + ip.x) * 0.05 * position.y;`);
  };
  group.add(instanced(tuftGeo, tuftMat, tufts, { cast: false }));
  group.add(instanced(new THREE.SphereGeometry(1, 5, 4), mat(0xffffff, { rough: 0.8 }), flowers, { cast: false, colors: flowerCol }));
  group.add(instanced(new THREE.DodecahedronGeometry(1, 0), mat(0xaca498, { flat: true }), pebbles, { cast: false }));
  group.add(instanced(new THREE.CylinderGeometry(1, 1, 1, 6), mat(0x8aa0b0, { emissive: 0x3fa0e0, ei: 0.25, rough: 0.6 }), runes, { cast: false }));
  group.add(instanced(new THREE.IcosahedronGeometry(1, 0), mat(0xffffff, { flat: true, rough: 0.9 }), bushes, { cast: false, colors: bushCol }));
  group.add(instanced(new THREE.DodecahedronGeometry(1, 0), mat(0xa49c90, { flat: true, rough: 0.9 }), boulders));
  group.add(instanced(new THREE.OctahedronGeometry(0.5, 0), mat(0x9fe8ff, { emissive: 0x3fb0ff, ei: 1.5, rough: 0.2 }), crystals));

  // A few broken columns on the far rim.
  const cols = [];
  for (const [x, z] of [[-HALF_X - 1.5, -HALF_Z - 2], [HALF_X + 2, -HALF_Z - 1.2], [-6, -HALF_Z - 2.6], [HALF_X + 2.2, 2]]) {
    if (islandQ(x, z) > 0.95) continue;
    const h = 1.2 + hash(x, z) * 2;
    cols.push(mk(x, topHeight(x, z) + h / 2, z, 0.4, 0, h, 0.4, (hash(z, x) - 0.5) * 0.1));
  }
  group.add(instanced(new THREE.CylinderGeometry(1, 1, 1, 8), mat(STONE, { flat: true, rough: 0.85 }), cols));

  buildHangingRocks(group, rand);
  buildBridge(group, rand);
  const pylons = buildPylons(group);
  return { group, pylons, wind };
}

// ------------------------------------------------------------------ ambient life

// Petals and sunlit motes carried across the island by the wind.
function buildPetals(rand) {
  const N = 260;
  const pos = new Float32Array(N * 3), seed = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    pos.set([(rand() - 0.5) * 120, 0.4 + rand() * 8, (rand() - 0.5) * (HALF_Z * 2 + 20)], i * 3);
    seed[i] = rand() * 100;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uTime: { value: 0 }, uScale: { value: 1 } },
    vertexShader: `
      uniform float uTime; uniform float uScale; attribute float aSeed; varying float vA; varying float vMote;
      void main(){
        vec3 p = position;
        p.x = mod(position.x + uTime * (1.2 + fract(aSeed) * 0.8) + 60.0, 120.0) - 60.0;
        p.y += sin(uTime * 0.9 + aSeed) * 0.5;
        p.z += sin(uTime * 0.5 + aSeed * 1.3) * 1.5;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vMote = step(0.6, fract(aSeed * 3.7));
        vA = (0.55 + 0.45 * sin(uTime * 3.0 + aSeed * 7.0)) * smoothstep(60.0, 50.0, abs(p.x));
        gl_PointSize = uScale * (vMote > 0.5 ? 14.0 : 18.0) / -mv.z * 2.0;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `varying float vA; varying float vMote;
      void main(){
        vec2 c = gl_PointCoord - 0.5;
        float d = vMote > 0.5 ? length(c) : length(c * vec2(1.0, 2.2));
        float a = smoothstep(0.5, 0.1, d) * vA;
        vec3 col = vMote > 0.5 ? vec3(1.0, 0.95, 0.7) * 1.4 : vec3(1.0, 0.78, 0.86);
        gl_FragColor = vec4(col, a * 0.85);
      }`,
  });
  return new THREE.Points(geo, material);
}

// Birds gliding in loose circles around the far islets, flapping now and then.
function buildBirds(rand) {
  const geo = new THREE.BufferGeometry();
  // Body at the origin, wing tips raised; scaling y flaps the wings.
  geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.25, -0.9, 0.35, -0.2, 0, 0, -0.2, 0, 0, 0.25, 0, 0, -0.2, 0.9, 0.35, -0.2], 3));
  geo.computeVertexNormals();
  const birds = [];
  const flocks = [[-22, -46, 12], [42, -40, 9], [-56, -32, 10], [0, -70, 16]];
  for (const [cx, cz, cy] of flocks) {
    for (let k = 0; k < 4; k++) birds.push({ cx, cz, y: cy + rand() * 3, r: 7 + rand() * 7, w: (0.25 + rand() * 0.15) * (rand() < 0.5 ? 1 : -1), ph: rand() * 6 });
  }
  const mesh = instanced(geo, new THREE.MeshBasicMaterial({ color: 0x3a4250, side: THREE.DoubleSide }), birds.map(() => new THREE.Matrix4()), { cast: false });
  return { mesh, birds };
}

export default {
  id: 'sky',
  name: 'Sky Island',
  desc: 'A floating meadow of runes and ruins high above a sea of clouds.',
  lighting: {
    sunDir: SUN_DIR, sunColor: 0xfff2dc, sunIntensity: 2.9,
    hemiSky: 0xc4e0ff, hemiGround: 0x6a7a58, hemiIntensity: 0.7,
    fillColor: 0xd8e6ff, fillIntensity: 0.55, fillDir: new THREE.Vector3(-20, 40, 50).normalize(),
    fogColor: FOG_COLOR, fogDensity: FOG_DENSITY, exposure: 1.0,
    gradeShadow: [0.0, 0.006, 0.02], gradeHighlight: [0.02, 0.012, -0.012],
    nexusFull: 0xffb83a, nexusLow: 0x7a1a12,
    bloomStrength: 0.55, bloomThreshold: 0.93,
  },
  terrainHeight,
  build(rand) {
    const terrain = buildTerrain();
    const underside = buildUnderside(rand);
    const road = buildRoad();
    const sky = buildSky();
    const sea = cloudLayer(SEA_Y, 0.03, 0.01, false);
    const layer = cloudLayer(LAYER_Y, 0.022, 0.02, true);
    const puffs = buildCloudPuffs(rand);
    const ribbon = buildPathRibbon(0x6fd8ff, 0xffc04a, 0.16);
    const airLane = buildAirLane(0xffffff, 0.16);
    const { group: decor, pylons, wind } = buildDecor(rand);
    const { material: water, mistPts } = buildWaterfalls(decor);
    const mist = buildMist(mistPts, rand);
    const runeStones = buildRuneStones(rand);
    const islets = ISLETS.map(([x, z, y, r, kind]) => buildIslet(x, y, z, r, kind, rand));
    const entry = buildEntryIslet(rand);
    const gate = buildGate();
    const nexus = buildNexus();
    const petals = buildPetals(rand);
    const birds = buildBirds(rand);
    return {
      objects: [terrain, underside, road, sky, sea, layer, puffs, ribbon, airLane, decor, mist, runeStones.stones, runeStones.bands, ...islets, entry, gate, nexus, petals, birds.mesh],
      road, sky, sea, layer, ribbon, pylons, wind, water, mist, runeStones, islets, gate, nexus, petals, birds,
    };
  },
  update(env, T) {
    env.road.userData.uniforms.uTime.value = T;
    env.sky.material.uniforms.uTime.value = T;
    env.sea.material.uniforms.uTime.value = T;
    env.layer.material.uniforms.uTime.value = T;
    env.ribbon.material.uniforms.uTime.value = T;
    env.water.uniforms.uTime.value = T;
    env.mist.material.uniforms.uTime.value = T;
    env.petals.material.uniforms.uTime.value = T;
    env.gate.userData.vortex.uniforms.uTime.value = T;
    env.wind.value = T;
    for (const p of env.gate.userData.pieces) p.mesh.position.y = p.y + Math.sin(T * 1.2 + p.seed) * 0.06;
    for (const p of env.pylons) { p.gem.position.y = 1.35 + Math.sin(T * 1.8 + p.seed) * 0.08; p.gem.rotation.y = T * 0.8 + p.seed; }
    for (const g of env.islets) {
      const u = g.userData;
      g.position.y = u.baseY + Math.sin(T * u.rate + u.phase) * u.amp;
      g.rotation.y = Math.sin(T * u.rate * 0.5 + u.phase) * 0.04;
    }
    const rs = env.runeStones;
    rs.list.forEach((s, i) => {
      const y = s.y + s.h / 2 + Math.sin(T * 0.9 + s.phase) * 0.15, ry = s.phase + T * s.spin;
      rs.stones.setMatrixAt(i, mk(s.x, y, s.z, 1, ry, s.h, 1));
      rs.bands.setMatrixAt(i, mk(s.x, y + s.h * 0.12, s.z, 1, ry, 1, 1));
    });
    rs.stones.instanceMatrix.needsUpdate = rs.bands.instanceMatrix.needsUpdate = true;
    const b = env.birds;
    b.birds.forEach((d, i) => {
      const a = d.ph + T * d.w;
      const flap = Math.sin(T * 9 + d.ph * 5) * (Math.sin(T * 0.7 + d.ph) > 0.2 ? 1 : 0.15);
      b.mesh.setMatrixAt(i, mk(d.cx + Math.cos(a) * d.r, d.y + Math.sin(T * 0.5 + d.ph) * 0.6, d.cz + Math.sin(a) * d.r, 0.9, -a + (d.w > 0 ? Math.PI : 0), flap, 0.9));
    });
    b.mesh.instanceMatrix.needsUpdate = true;
  },
};
