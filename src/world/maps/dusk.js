// Map theme: an ancient battlefield valley at dusk. A walled plateau with a
// paved road, ruins, braziers, graves and war debris, autumn woods and hills
// outside the wall, mountains in haze, a low sun, ground fog and drifting embers.

import * as THREE from 'three';
import { mat, glow } from '../models.js';
import {
  fbm, HALF_X, HALF_Z, distToRoute, outside, onEntryRoad, clearOfRoad as clearOf, nearTileCentre, mk, instanced,
  buildPathRibbon, buildAirLane, riftMaterial, GROUND_ROUTE, BLOCKED_TILES, TILE, SPAWN, PORTAL, tileToWorld,
} from './shared.js';

const WALL = 1.4;          // the perimeter wall stands this far outside the play rectangle
const ROAD_HALF = 1.25;    // half width of the paved road
// Sunset sits behind the field as seen from the default camera.
const SUN_DIR = new THREE.Vector3(0.35, 0.32, -0.88).normalize();

function terrainHeight(x, z) {
  const o = outside(x, z);
  let h;
  if (o < 0) h = (fbm(x * 0.15, z * 0.15) - 0.5) * 0.18;                 // the plateau
  else {
    const n = fbm(x * 0.05 + 3, z * 0.05);
    const hills = Math.min(1, o / 10) * (1.2 + n * 3.5);                  // rolling hills past the wall
    const peaks = o > 22 ? Math.pow((o - 22) / 40, 1.5) * 46 * fbm(x * 0.03 + 7, z * 0.03, 5) : 0; // mountains
    h = hills + peaks;
  }
  if (distToRoute(x, z, GROUND_ROUTE) < ROAD_HALF + 0.3 || onEntryRoad(x, z)) h = Math.min(h, -0.04);
  return h;
}

const clearOfRoad = (x, z, margin) => clearOf(x, z, margin, ROAD_HALF);

// ------------------------------------------------------------------ terrain

function buildTerrain() {
  const W = 260, D = 210, SX = 156, SZ = 126;
  const geo = new THREE.PlaneGeometry(W, D, SX, SZ);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  // Dry autumn grass, trampled earth, scorched patches, rock and snow.
  const grassA = new THREE.Color(0x7a7a34), grassB = new THREE.Color(0xa08a3e), grassC = new THREE.Color(0x56622c);
  const earth = new THREE.Color(0x5a4430), scorch = new THREE.Color(0x2e2620);
  const hillA = new THREE.Color(0x5e6230), hillB = new THREE.Color(0x7a5a2e), hillD = new THREE.Color(0x3a3020), hillG = new THREE.Color(0x485a2a);
  const rock = new THREE.Color(0x5c5058), rockL = new THREE.Color(0x8a7a7a), snow = new THREE.Color(0xf0e4e8);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = terrainHeight(x, z);
    const n = fbm(x * 0.3, z * 0.3);
    const o = outside(x, z);
    if (o < WALL + 0.6) {
      c.copy(grassA).lerp(grassB, n).lerp(grassC, fbm(x * 0.06 + 3, z * 0.06) * 0.9).multiplyScalar(0.8 + fbm(x * 0.5, z * 0.5) * 0.35);
      const pd = distToRoute(x, z, GROUND_ROUTE);
      if (pd < ROAD_HALF + 1.2) c.lerp(earth, Math.min(1, (ROAD_HALF + 1.2 - pd) / 1.2) * 0.75);
      const burn = fbm(x * 0.09 + 11, z * 0.09 - 4);
      if (burn > 0.62) c.lerp(scorch, Math.min(0.85, (burn - 0.62) * 5));
    } else {
      // Patchwork of dry meadow, bare earth, darker scrub and greener hollows.
      c.copy(hillA).lerp(hillB, fbm(x * 0.04, z * 0.04)).lerp(hillG, Math.max(0, fbm(x * 0.09 + 9, z * 0.09) - 0.45) * 1.6);
      c.lerp(hillD, Math.max(0, fbm(x * 0.2 - 3, z * 0.2) - 0.5) * 1.4).multiplyScalar(0.85 + n * 0.3);
      if (h > 6) c.lerp(rock, Math.min(1, (h - 6) / 6)).lerp(rockL, n * 0.4);
      if (h > 20) c.lerp(snow, Math.min(1, (h - 20) / 8));
    }
    if (onEntryRoad(x, z)) c.copy(earth);
    pos.setY(i, h);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, metalness: 0 }));
  m.receiveShadow = true;
  return m;
}

// Paved road: one plane over the plateau whose shader draws flagstones within
// the road's distance field, with worn edges and a darker curb line. A standard
// material keeps sun, shadows and fog consistent with the terrain.
function buildRoad() {
  const segs = GROUND_ROUTE.segs;
  const uniforms = {
    uA: { value: segs.map((s) => new THREE.Vector2(s.a.x, s.a.z)) },
    uB: { value: segs.map((s) => new THREE.Vector2(s.b.x, s.b.z)) },
    uHalf: { value: ROAD_HALF }, uSpawn: { value: new THREE.Vector2(SPAWN.x, SPAWN.z) }, uEdgeX: { value: -HALF_X },
  };
  const material = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vRoad;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRoad = (modelMatrix * vec4(position, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vRoad;
        uniform vec2 uA[${segs.length}]; uniform vec2 uB[${segs.length}]; uniform float uHalf; uniform vec2 uSpawn; uniform float uEdgeX;
        vec2 rh2(vec2 p){ p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
        float segDist(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; float t = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * t); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec2 p = vRoad;
          float d = 1e9;
          for (int i = 0; i < ${segs.length}; i++) d = min(d, segDist(p, uA[i], uB[i]));
          if (p.x < uEdgeX + 3.0 && p.x > uSpawn.x - 14.0) d = min(d, abs(p.y - uSpawn.y));
          // Flagstones: jittered cells; mortar where the two nearest centres are about equally far.
          vec2 q = p * 1.15; vec2 cell = floor(q); vec2 f = fract(q);
          float d1 = 8.0, d2 = 8.0; vec2 id = vec2(0.0);
          for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
            vec2 g = vec2(float(x), float(y)); vec2 o = rh2(cell + g) * 0.8 + 0.1;
            float dd = length(g + o - f);
            if (dd < d1) { d2 = d1; d1 = dd; id = cell + g; } else if (dd < d2) d2 = dd;
          }
          vec2 r = rh2(id);
          // Ragged border: whole stones drop out near the edge.
          if (d + (r.x - 0.5) * 0.35 > uHalf) discard;
          float mortar = smoothstep(0.04, 0.12, d2 - d1);
          vec3 stone = mix(vec3(0.4, 0.36, 0.32), vec3(0.58, 0.52, 0.44), r.x) * (0.85 + 0.25 * r.y);
          stone *= 0.88 + 0.12 * smoothstep(0.0, 0.5, d1);
          vec3 col = mix(vec3(0.16, 0.13, 0.11), stone, mortar);
          // Wear: mud in the mortar toward the edges and down the middle wheel ruts.
          float rut = smoothstep(0.25, 0.0, abs(d - 0.55));
          col = mix(col, vec3(0.28, 0.22, 0.16), clamp(rut * 0.35 + smoothstep(uHalf - 0.5, uHalf, d) * 0.4, 0.0, 1.0) * (1.0 - mortar * 0.5));
          diffuseColor.rgb = pow(col, vec3(2.2)); // authored in sRGB, lit in linear
        }`);
  };
  const geo = new THREE.PlaneGeometry(HALF_X * 2 + 40, HALF_Z * 2 + 4);
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, material);
  m.position.y = 0.02;
  m.receiveShadow = true;
  return m;
}

function buildSky() {
  const geo = new THREE.SphereGeometry(600, 32, 16);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uSun: { value: SUN_DIR.clone() }, uTime: { value: 0 } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 uSun; uniform float uTime; varying vec3 vDir;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
      float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += noise(p) * a; p *= 2.1; a *= 0.5; } return s; }
      void main(){
        float y = vDir.y;
        float s = max(dot(vDir, uSun), 0.0);
        // Dusk gradient: ember horizon, rose band, violet zenith; warmer toward the sun.
        vec3 hor = mix(vec3(0.85, 0.42, 0.28), vec3(1.0, 0.62, 0.3), pow(s, 3.0));
        vec3 band = vec3(0.62, 0.32, 0.38), top = vec3(0.12, 0.09, 0.22);
        vec3 col = mix(hor, band, smoothstep(0.0, 0.16, y));
        col = mix(col, top, smoothstep(0.12, 0.65, y));
        col = mix(col, vec3(0.2, 0.12, 0.14), smoothstep(0.0, -0.2, y));
        // Sun disc and glow.
        col += vec3(1.0, 0.55, 0.25) * pow(s, 6.0) * 0.55 + vec3(1.0, 0.8, 0.55) * pow(s, 60.0) * 0.8 + vec3(1.0, 0.92, 0.75) * smoothstep(0.9993, 0.9997, s) * 3.0;
        // Streaky clouds lit from below by the sun.
        vec2 cp = vDir.xz / max(y + 0.12, 0.05) * vec2(0.6, 1.6) + vec2(uTime * 0.004, 0.0);
        float cl = smoothstep(0.5, 0.8, fbm(cp * 1.3)) * smoothstep(0.02, 0.12, y) * smoothstep(0.55, 0.2, y);
        vec3 cloudCol = mix(vec3(0.35, 0.2, 0.28), vec3(1.0, 0.6, 0.35), pow(s, 2.0) * 0.8 + 0.2);
        col = mix(col, cloudCol, cl * 0.75);
        // A few early stars high up, away from the sun.
        vec2 sp = floor(vDir.xz / max(y, 0.1) * 120.0);
        col += step(0.998, hash(sp)) * smoothstep(0.45, 0.8, y) * (0.5 + 0.5 * sin(uTime * 2.0 + hash(sp + 1.0) * 30.0)) * 0.6;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  return new THREE.Mesh(geo, material);
}

// ------------------------------------------------------------------ ruins and props

const STONE = 0x7a6e62, STONE_D = 0x564c44;

// A ruined wall around the plateau with gaps, crumbled tops and fallen blocks,
// plus a few standing arches.
function buildWalls(group, rand) {
  const blocks = [], fallen = [], caps = [];
  const sides = [
    { from: [-HALF_X - WALL, -HALF_Z - WALL], to: [HALF_X + WALL, -HALF_Z - WALL] },
    { from: [HALF_X + WALL, -HALF_Z - WALL], to: [HALF_X + WALL, HALF_Z + WALL] },
    { from: [HALF_X + WALL, HALF_Z + WALL], to: [-HALF_X - WALL, HALF_Z + WALL] },
    { from: [-HALF_X - WALL, HALF_Z + WALL], to: [-HALF_X - WALL, -HALF_Z - WALL] },
  ];
  for (const { from, to } of sides) {
    const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const dx = (to[0] - from[0]) / len, dz = (to[1] - from[1]) / len;
    const ry = Math.atan2(dx, dz);
    for (let t = 0; t < len; t += 1.6) {
      const x = from[0] + dx * t, z = from[1] + dz * t;
      if (onEntryRoad(x, z) || Math.abs(z - SPAWN.z) < 3 && x < 0) continue;
      const n = fbm(x * 0.12 + 5, z * 0.12);
      if (n < 0.36) {                                  // a breach: rubble only
        if (rand() < 0.7) fallen.push(mk(x + (rand() - 0.5) * 2, 0.25, z + (rand() - 0.5) * 2, 0.5 + rand() * 0.4, rand() * 6, 0.35, 0.6, rand() * 0.4, rand() * 0.4));
        continue;
      }
      // Taller where the noise is high, crumbled low elsewhere; the near side is kept low to see over.
      const near = z > HALF_Z ? 0.45 : 1;
      const hgt = (0.6 + (n - 0.36) * 6 + rand() * 0.9) * near;
      blocks.push(mk(x, hgt / 2, z, 0.9, ry, hgt, 1.62 + rand() * 0.1));
      if (rand() < 0.5) caps.push(mk(x + (rand() - 0.5) * 0.4, hgt + 0.15, z, 0.9 + rand() * 0.6, ry + (rand() - 0.5) * 0.3, 0.3, 0.9));
      if (rand() < 0.25) fallen.push(mk(x - dz * 1.4 * (rand() < 0.5 ? 1 : -1), 0.2, z + dx * 1.4, 0.6, rand() * 6, 0.4, 0.7, rand() * 0.5, rand() * 0.5));
    }
  }
  const box = new THREE.BoxGeometry(1, 1, 1);
  group.add(instanced(box, mat(STONE, { flat: true, rough: 0.95 }), blocks));
  group.add(instanced(box, mat(STONE_D, { flat: true, rough: 0.95 }), caps));
  group.add(instanced(new THREE.DodecahedronGeometry(1, 0), mat(STONE_D, { flat: true }), fallen));
}

// A broken arch: two pillars and a lintel, one side snapped off.
function arch(group, x, z, ry, s, rand) {
  const g = new THREE.Group();
  const stone = mat(STONE, { flat: true, rough: 0.9 });
  const intact = rand() < 0.5;
  for (const side of [-1, 1]) {
    const h = side === 1 && !intact ? 2.2 + rand() : 5;
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.9, h, 0.9), stone);
    p.position.set(side * 1.8, h / 2, 0); p.castShadow = true; p.receiveShadow = true;
    g.add(p);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(intact ? 4.6 : 2.6, 0.8, 1.0), stone);
  lintel.position.set(intact ? 0 : -1.0, 5.3, 0); lintel.rotation.z = intact ? 0 : -0.12; lintel.castShadow = true;
  g.add(lintel);
  g.position.set(x, terrainHeight(x, z), z); g.rotation.y = ry; g.scale.setScalar(s);
  group.add(g);
}

// Fallen and standing broken columns.
function buildColumns(group, spots, rand) {
  const shafts = [], drums = [], bases = [];
  for (const [x, z] of spots) {
    const y = terrainHeight(x, z);
    bases.push(mk(x, y + 0.2, z, 0.75, 0, 0.4, 0.75));
    if (rand() < 0.6) {
      const h = 1.2 + rand() * 3;
      shafts.push(mk(x, y + 0.4 + h / 2, z, 0.5, rand() * 6, h, 0.5, (rand() - 0.5) * 0.08, (rand() - 0.5) * 0.08));
    } else {
      const a = rand() * 6;
      for (let k = 0; k < 3; k++) drums.push(mk(x + Math.cos(a) * (k * 1.0 + 0.8), y + 0.42, z + Math.sin(a) * (k * 1.0 + 0.8), 0.48, a, 0.9, 0.48, Math.PI / 2, 0));
    }
  }
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 10);
  group.add(instanced(cyl, mat(0x8a7e74, { flat: true, rough: 0.85 }), shafts));
  group.add(instanced(cyl, mat(0x7a6e66, { flat: true, rough: 0.85 }), drums));
  group.add(instanced(new THREE.BoxGeometry(1.6, 1, 1.6), mat(STONE_D, { flat: true }), bases));
}

// Autumn trees outside the wall: trunks with clustered canopies in red, orange and gold.
function buildTrees(group, rand) {
  const trunks = [], canopy = [], canopyCol = [], dead = [];
  const palette = [0xa8381e, 0xc8581e, 0xd88a24, 0xb8702a, 0x8a2a1a, 0x6e6a2a].map((c) => new THREE.Color(c));
  for (let i = 0; i < 900 && trunks.length < 260; i++) {
    const x = (rand() - 0.5) * 230, z = (rand() - 0.5) * 190;
    const o = outside(x, z);
    // The near (camera) side stays open so canopies never hide the field.
    if (o < (z > HALF_Z ? WALL + 13 : WALL + 2) || o > 34 || onEntryRoad(x, z)) continue;
    const h = terrainHeight(x, z);
    if (h > 12) continue;
    // Woods grow in clumps.
    if (fbm(x * 0.06 + 20, z * 0.06) < 0.45) continue;
    const s = 0.9 + rand() * 0.9;
    trunks.push(mk(x, h + 1.0 * s, z, s, rand() * 6));
    const base = palette[Math.floor(rand() * palette.length)];
    for (let k = 0; k < 3; k++) {
      const a = rand() * 6, r = k === 0 ? 0 : 0.7 * s;
      canopy.push(mk(x + Math.cos(a) * r, h + (2.4 + k * 0.5 + rand() * 0.4) * s, z + Math.sin(a) * r, (1.1 - k * 0.15) * s, rand() * 6));
      canopyCol.push(base.clone().offsetHSL(0, 0, (rand() - 0.5) * 0.08));
    }
  }
  // Bare dead trees on the plateau's corners and near the wall.
  for (let i = 0; i < 40; i++) {
    const x = (rand() - 0.5) * (HALF_X * 2 + 8), z = (rand() - 0.5) * (HALF_Z * 2 + 8);
    const o = outside(x, z);
    if (o < 0.5 || o > WALL + 6 || onEntryRoad(x, z)) continue;
    dead.push(mk(x, terrainHeight(x, z) + 1.2, z, 0.7 + rand() * 0.4, rand() * 6, 1, 1, (rand() - 0.5) * 0.2));
  }
  group.add(instanced(new THREE.CylinderGeometry(0.16, 0.28, 2, 6), mat(0x3e2a1c, { flat: true }), trunks, { cast: false }));
  group.add(instanced(new THREE.IcosahedronGeometry(1, 0), mat(0xffffff, { flat: true, rough: 0.9 }), canopy, { cast: false, colors: canopyCol }));
  const deadGeo = new THREE.CylinderGeometry(0.06, 0.2, 2.4, 5);
  group.add(instanced(deadGeo, mat(0x2e221a, { flat: true }), dead));
}

// Graves, spears, shields and skulls: the debris of an old battle.
function buildBattleDebris(group, rand) {
  const graves = [], crosses = [], spears = [], shields = [], skulls = [], rocks = [], tufts = [], leaves = [];
  // Graveyards just outside the wall at three corners.
  for (const [cx, cz] of [[-HALF_X - 5, HALF_Z + 4], [HALF_X + 6, -HALF_Z - 4], [HALF_X + 6, HALF_Z + 5]]) {
    for (let k = 0; k < 14; k++) {
      const x = cx + (k % 5) * 1.5 + (rand() - 0.5) * 0.4, z = cz + Math.floor(k / 5) * 1.8 + (rand() - 0.5) * 0.4;
      const y = terrainHeight(x, z);
      if (rand() < 0.65) graves.push(mk(x, y + 0.45, z, 0.6, (rand() - 0.5) * 0.3, 0.9, 0.18, (rand() - 0.5) * 0.25, (rand() - 0.5) * 0.25));
      else crosses.push(mk(x, y + 0.6, z, 0.12, (rand() - 0.5) * 0.4, 1.2, 0.12, (rand() - 0.5) * 0.2));
    }
  }
  // Spears and shields stuck in the plateau, off the road; never on buildable tile centres.
  for (let i = 0; i < 140; i++) {
    const x = (rand() - 0.5) * (HALF_X * 2), z = (rand() - 0.5) * (HALF_Z * 2);
    if (!clearOfRoad(x, z, 0.6)) continue;
    if (nearTileCentre(x, z)) continue;                                // keep tile centres clear for towers
    const y = terrainHeight(x, z);
    const roll = rand();
    if (roll < 0.35) spears.push(mk(x, y + 0.7, z, 0.035, rand() * 6, 1.6, 0.035, (rand() - 0.5) * 0.7, (rand() - 0.5) * 0.7));
    else if (roll < 0.55) shields.push(mk(x, y + 0.12, z, 0.32, rand() * 6, 0.05, 0.32, (rand() - 0.5) * 0.6, (rand() - 0.5) * 0.6));
    else if (roll < 0.7) skulls.push(mk(x, y + 0.08, z, 0.11, rand() * 6));
    else rocks.push(mk(x, y + 0.05, z, 0.15 + rand() * 0.2, rand() * 6, 0.1 + rand() * 0.12));
  }
  // Blocked corner tiles get bigger rubble heaps.
  for (const key of BLOCKED_TILES) {
    const [c, r] = key.split(',').map(Number);
    const p = tileToWorld(c, r);
    for (let k = 0; k < 3; k++) rocks.push(mk(p.x + (rand() - 0.5) * 1.4, 0.2, p.z + (rand() - 0.5) * 1.4, 0.45 + rand() * 0.5, rand() * 6, 0.35 + rand() * 0.4));
  }
  // Dry grass tufts and fallen leaves over the plateau.
  const leafPal = [0xc0541e, 0xd8922a, 0x9a3a1a, 0xe0b040].map((c) => new THREE.Color(c));
  const leafCol = [];
  for (let i = 0; i < 1800; i++) {
    const x = (rand() - 0.5) * (HALF_X * 2 + 2), z = (rand() - 0.5) * (HALF_Z * 2 + 2);
    if (!clearOfRoad(x, z, 0.3)) continue;
    const y = terrainHeight(x, z);
    if (rand() < 0.6) {
      const s = 0.25 + rand() * 0.35;
      tufts.push(mk(x, y, z, s, rand() * 6, s * (1 + rand()), s, (rand() - 0.5) * 0.4));
    } else {
      leaves.push(mk(x, y + 0.02, z, 0.09 + rand() * 0.06, rand() * 6, 0.01, 0.06));
      leafCol.push(leafPal[Math.floor(rand() * leafPal.length)]);
    }
  }
  // Low scrub, boulders and dry grass beyond the wall, kept low so they never hide the field.
  const scrub = [], scrubCol = [], boulders = [];
  const scrubPal = [0x6a5a26, 0x5a4422, 0x56602a, 0x7a5426].map((c) => new THREE.Color(c));
  for (let i = 0; i < 2600; i++) {
    const x = (rand() - 0.5) * 150, z = (rand() - 0.5) * 120;
    const o = outside(x, z);
    if (o < WALL + 1.2 || o > 40 || onEntryRoad(x, z)) continue;
    const y = terrainHeight(x, z);
    const roll = rand();
    if (roll < 0.25) { scrub.push(mk(x, y + 0.2, z, 0.35 + rand() * 0.45, rand() * 6, 0.25 + rand() * 0.3)); scrubCol.push(scrubPal[Math.floor(rand() * 4)]); }
    else if (roll < 0.32) boulders.push(mk(x, y + 0.1, z, 0.4 + rand() * 0.9, rand() * 6, 0.3 + rand() * 0.5));
    else { const s = 0.3 + rand() * 0.4; tufts.push(mk(x, y, z, s, rand() * 6, s * (1 + rand()), s, (rand() - 0.5) * 0.4)); }
  }
  group.add(instanced(new THREE.IcosahedronGeometry(1, 0), mat(0xffffff, { flat: true, rough: 1 }), scrub, { cast: false, colors: scrubCol }));
  group.add(instanced(new THREE.DodecahedronGeometry(1, 0), mat(0x6a5e58, { flat: true, rough: 0.95 }), boulders, { cast: false }));
  const box = new THREE.BoxGeometry(1, 1, 1);
  group.add(instanced(box, mat(0x6e6a66, { flat: true, rough: 0.9 }), graves));
  group.add(instanced(box, mat(0x4a3a2c, { flat: true }), crosses, { cast: false }));
  group.add(instanced(new THREE.CylinderGeometry(1, 1, 1, 4), mat(0x5a4a3a, { metal: 0.3 }), spears));
  group.add(instanced(new THREE.CylinderGeometry(1, 1, 1, 8), mat(0x7a5a3a, { metal: 0.4, rough: 0.6 }), shields, { cast: false }));
  group.add(instanced(new THREE.SphereGeometry(1, 6, 5), mat(0xe0d6bc, { flat: true }), skulls, { cast: false }));
  group.add(instanced(new THREE.DodecahedronGeometry(1, 0), mat(0x6e6460, { flat: true, rough: 0.95 }), rocks, { cast: false }));
  const tuftGeo = new THREE.ConeGeometry(0.12, 0.7, 3);
  tuftGeo.translate(0, 0.35, 0);
  group.add(instanced(tuftGeo, mat(0xa08a44, { flat: true, rough: 1 }), tufts, { cast: false }));
  group.add(instanced(box, mat(0xffffff, { rough: 1 }), leaves, { cast: false, colors: leafCol }));
}

// Braziers at the road's corners and along the wall: stone bowls with live
// flames. Only a few carry real point lights; the rest glow through bloom.
function buildBraziers(group) {
  const spots = [];
  for (const p of GROUND_ROUTE.pts.slice(1, -1)) {
    for (const [ox, oz] of [[1.9, 1.9], [-1.9, -1.9], [1.9, -1.9], [-1.9, 1.9]]) {
      const x = p.x + ox, z = p.z + oz;
      if (distToRoute(x, z, GROUND_ROUTE) < 1.6) continue;
      spots.push([x, z]);
      break;
    }
  }
  spots.push([SPAWN.x + 6, SPAWN.z - 2.6], [SPAWN.x + 6, SPAWN.z + 2.6], [PORTAL.x - 2, PORTAL.z - 3.2], [PORTAL.x - 2, PORTAL.z + 3.2]);
  const flames = [];
  const stand = mat(0x3a302a, { metal: 0.4, rough: 0.6 });
  const bowl = mat(0x5a4a3e, { metal: 0.5, rough: 0.5 });
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
  spots.forEach(([x, z], i) => {
    const g = new THREE.Group();
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 1.3, 6), stand);
    post.position.y = 0.65; post.castShadow = true;
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.25, 0.35, 8), bowl);
    cup.position.y = 1.45; cup.castShadow = true;
    const coals = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.05, 8), glow(0xff5a1a, 3));
    coals.position.y = 1.6;
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.9, 6), flameMat);
    flame.position.y = 2.0;
    const core = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.55, 5), glow(0xffe08a, 4));
    core.position.y = 1.85;
    g.add(post, cup, coals, flame, core);
    if (i % 2 === 0) {
      const light = new THREE.PointLight(0xff8a3a, 6, 9, 1.6);
      light.position.y = 2.1;
      g.add(light);
      flames.push({ flame, core, light, seed: i * 1.7 });
    } else flames.push({ flame, core, seed: i * 1.7 });
    g.position.set(x, terrainHeight(x, z), z);
    group.add(g);
  });
  return flames;
}

// Tattered banners on poles near the gate and the wall; the cloth ripples in a vertex shader.
function buildBanners(group, rand) {
  const uniforms = { uTime: { value: 0 } };
  const cloth = new THREE.MeshStandardMaterial({ color: 0x8a1e1a, roughness: 0.9, side: THREE.DoubleSide, flatShading: true });
  cloth.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float k = clamp(-position.y / 1.6 + 0.5, 0.0, 1.0);
        transformed.z += sin(uTime * 3.0 + position.y * 2.5 + modelMatrix[3].x) * 0.18 * k;
        transformed.x += sin(uTime * 2.1 + position.y * 3.0) * 0.06 * k;`);
  };
  const clothGeo = new THREE.PlaneGeometry(0.9, 1.6, 2, 6);
  // Ragged hem: pull the bottom row's corners up unevenly.
  const pos = clothGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) if (pos.getY(i) < -0.7) pos.setY(i, pos.getY(i) + rand() * 0.35);
  const pole = mat(0x3a2a1e, { flat: true });
  const spots = [
    [SPAWN.x + 3.5, SPAWN.z - 3], [SPAWN.x + 3.5, SPAWN.z + 3],
    [-HALF_X - WALL - 1.2, -HALF_Z + 4], [HALF_X + WALL + 1.2, 0], [0, -HALF_Z - WALL - 1.4], [-12, HALF_Z + WALL + 1.4], [14, HALF_Z + WALL + 1.4],
  ];
  for (const [x, z] of spots) {
    const g = new THREE.Group();
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 4.2, 5), pole);
    p.position.y = 2.1; p.castShadow = true;
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.1, 4), pole);
    bar.rotation.z = Math.PI / 2; bar.position.set(0.5, 3.9, 0);
    const flag = new THREE.Mesh(clothGeo, cloth);
    flag.position.set(0.5, 3.05, 0); flag.castShadow = true;
    g.add(p, bar, flag);
    g.position.set(x, terrainHeight(x, z), z);
    g.rotation.y = rand() * 6;
    group.add(g);
  }
  return uniforms;
}

function buildDecor(rand) {
  const group = new THREE.Group();
  buildWalls(group, rand);
  // Arches stand at the corners outside the wall and flank the field.
  arch(group, -HALF_X - 7, -HALF_Z - 6, 0.4, 1.0, rand);
  arch(group, HALF_X + 8, -HALF_Z - 8, -0.3, 1.2, rand);
  arch(group, HALF_X + 9, HALF_Z + 9, 0.8, 1.1, rand);
  arch(group, -HALF_X - 9, HALF_Z + 10, -0.6, 1.0, rand);
  // Column ruins just outside the wall.
  const colSpots = [];
  for (let i = 0; i < 60 && colSpots.length < 22; i++) {
    const x = (rand() - 0.5) * (HALF_X * 2 + 20), z = (rand() - 0.5) * (HALF_Z * 2 + 20);
    const o = outside(x, z);
    if (o > WALL + 1.5 && o < WALL + 9 && !onEntryRoad(x, z)) colSpots.push([x, z]);
  }
  buildColumns(group, colSpots, rand);
  buildTrees(group, rand);
  buildBattleDebris(group, rand);
  const braziers = buildBraziers(group);
  const banners = buildBanners(group, rand);
  return { group, braziers, banners };
}

// The spawn gate: a massive ruined gatehouse with a swirling rift between its towers.
function buildGate() {
  const g = new THREE.Group();
  const stone = mat(0x5a5054, { flat: true, rough: 0.9 });
  const trim = mat(0x3a3238, { flat: true });
  for (const s of [-1, 1]) {
    const tower = new THREE.Mesh(new THREE.BoxGeometry(2.0, 8, 2.0), stone);
    tower.position.set(0, 4, s * 3.2); tower.castShadow = true;
    g.add(tower);
    const crown = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.5, 2.4), trim);
    crown.position.set(0, 8.2, s * 3.2); g.add(crown);
    for (const [ox, oz] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) {
      if (s === 1 && ox > 0 && oz > 0) continue;                         // one merlon broken off
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.5), trim);
      m.position.set(ox, 8.8, s * 3.2 + oz); g.add(m);
    }
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.2, 4.6), stone);
  lintel.position.y = 6.9; lintel.castShadow = true;
  g.add(lintel);
  const vortexMat = riftMaterial(0xff5a2a, 0xffd880);
  const vortex = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 6.0), vortexMat);
  vortex.rotation.y = Math.PI / 2;
  vortex.position.y = 3.1;
  g.add(vortex);
  g.position.set(SPAWN.x - 2.5, 0, SPAWN.z);
  g.userData.vortex = vortexMat;
  return g;
}

// The portal the creeps march on: a stepped stone shrine around a floating crystal.
function buildNexus() {
  const g = new THREE.Group();
  const stone = mat(0x6a6064, { flat: true, rough: 0.8 });
  const dark = mat(0x4a4248, { flat: true, rough: 0.85 });
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
    const h = i % 3 === 2 ? 2.0 : 4.2;                                   // a few pillars have crumbled
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.5, h, 0.5), stone);
    p.position.set(Math.cos(a) * 2.7, y + h / 2 - 0.4, Math.sin(a) * 2.7); p.castShadow = true;
    g.add(p);
    if (h > 3) {
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), glow(0xffb05a, 3));
      gem.position.set(Math.cos(a) * 2.7, y + h - 0.1, Math.sin(a) * 2.7);
      g.add(gem);
    }
  }
  const crystalMat = new THREE.MeshStandardMaterial({ color: 0xffd8a0, emissive: 0xff8a2a, emissiveIntensity: 2.0, roughness: 0.15, metalness: 0.2, flatShading: true });
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(1.1, 0), crystalMat);
  crystal.scale.set(0.8, 1.6, 0.8);
  crystal.position.y = 3.9; crystal.castShadow = true;
  g.add(crystal);
  const ring1 = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.05, 6, 48), glow(0xffb05a, 2.5));
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(2.0, 0.04, 6, 48), glow(0xff6a3a, 2.5));
  ring1.position.y = ring2.position.y = 3.9;
  g.add(ring1, ring2);
  const pillarMat = new THREE.MeshBasicMaterial({ color: 0xffb070, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.0, 40, 16, 1, true), pillarMat);
  beam.position.y = 22;
  g.add(beam);
  const light = new THREE.PointLight(0xffa050, 10, 14, 1.5);
  light.position.y = 4;
  g.add(light);
  g.position.set(PORTAL.x + 1.5, 0, PORTAL.z);
  g.userData = { crystal, crystalMat, ring1, ring2, beam, pillarMat, crystalY: 3.9 };
  return g;
}

// Embers rising from the battlefield and ash drifting on the wind.
function buildEmbers(rand) {
  const N = 220;
  const pos = new Float32Array(N * 3), seed = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    pos.set([(rand() - 0.5) * (HALF_X * 2 + 30), rand() * 9, (rand() - 0.5) * (HALF_Z * 2 + 24)], i * 3);
    seed[i] = rand() * 100;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uScale: { value: 1 } },
    vertexShader: `
      uniform float uTime; uniform float uScale; attribute float aSeed; varying float vA; varying float vEmber;
      void main(){
        vec3 p = position;
        float life = fract(uTime * 0.05 + aSeed * 0.137);
        p.y = mod(position.y + uTime * (0.35 + fract(aSeed) * 0.4), 9.0);
        p.x += sin(uTime * 0.4 + aSeed) * 1.5 + uTime * 0.3 - floor((position.x + uTime * 0.3 + 60.0) / 120.0) * 120.0;
        p.z += cos(uTime * 0.3 + aSeed * 1.3) * 1.2;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vEmber = step(0.45, fract(aSeed * 3.7));
        vA = (0.4 + 0.6 * sin(uTime * 3.0 + aSeed * 7.0)) * smoothstep(9.0, 6.0, p.y) * smoothstep(0.0, 1.0, p.y);
        gl_PointSize = uScale * (vEmber > 0.5 ? 16.0 : 22.0) / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `varying float vA; varying float vEmber;
      void main(){
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d) * vA;
        vec3 col = vEmber > 0.5 ? vec3(1.0, 0.55, 0.2) * 1.8 : vec3(0.55, 0.5, 0.5) * 0.35;
        gl_FragColor = vec4(col * a, a);
      }`,
  });
  return new THREE.Points(geo, material);
}

// Low ground fog: a noise-driven haze sheet, thin over the field so towers and
// creeps stay readable, thick past the wall and in the hollows.
function buildGroundFog() {
  const geo = new THREE.PlaneGeometry(320, 260);
  geo.rotateX(-Math.PI / 2);
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: { uTime: { value: 0 }, uHalf: { value: new THREE.Vector2(HALF_X + WALL, HALF_Z + WALL) }, uColor: { value: new THREE.Color(0xb89488) } },
    vertexShader: `varying vec3 vWorld; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `
      uniform float uTime; uniform vec2 uHalf; uniform vec3 uColor; varying vec3 vWorld;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
      void main(){
        vec2 p = vWorld.xz;
        float n = noise(p * 0.06 + vec2(uTime * 0.02, uTime * 0.01)) * 0.6 + noise(p * 0.15 - vec2(uTime * 0.03, 0.0)) * 0.4;
        float out_ = length(max(abs(p) - uHalf, 0.0));
        float a = mix(0.025, 0.45, smoothstep(2.0, 16.0, out_)) * smoothstep(0.25, 0.75, n);
        a *= smoothstep(170.0, 90.0, length(p));
        gl_FragColor = vec4(uColor, a);
      }`,
  });
  const m = new THREE.Mesh(geo, material);
  m.position.y = 0.7;
  m.renderOrder = 3;
  return m;
}

export default {
  id: 'dusk',
  name: 'Dusk Battlefield',
  desc: 'An ancient walled field at sunset: ruins, braziers, autumn woods.',
  lighting: {
    sunDir: SUN_DIR, sunColor: 0xffb070, sunIntensity: 3.6,
    hemiSky: 0xc8b0a8, hemiGround: 0x3a2a1e, hemiIntensity: 0.8,
    fillColor: 0x8a98d0, fillIntensity: 0.7, fillDir: new THREE.Vector3(-20, 35, 50).normalize(),
    fogColor: 0x5c3e3c, fogDensity: 0.0042, exposure: 1.05,
    gradeShadow: [0.012, 0.0, 0.022], gradeHighlight: [0.035, 0.012, -0.025],
    nexusFull: 0xff8a2a, nexusLow: 0x8a1a10,
  },
  terrainHeight,
  build(rand) {
    const terrain = buildTerrain();
    const road = buildRoad();
    const sky = buildSky();
    const ribbon = buildPathRibbon(0xffb04d, 0xff4d26, 0.16);
    const airLane = buildAirLane(0xffc89a, 0.14);
    const { group: decor, braziers, banners } = buildDecor(rand);
    const gate = buildGate();
    const nexus = buildNexus();
    const embers = buildEmbers(rand);
    const fog = buildGroundFog();
    return { objects: [terrain, road, sky, ribbon, airLane, decor, gate, nexus, embers, fog], sky, ribbon, braziers, banners, gate, nexus, embers, fog };
  },
  update(env, T) {
    env.sky.material.uniforms.uTime.value = T;
    env.ribbon.material.uniforms.uTime.value = T;
    env.embers.material.uniforms.uTime.value = T;
    env.fog.material.uniforms.uTime.value = T;
    env.gate.userData.vortex.uniforms.uTime.value = T;
    env.banners.uTime.value = T;
    for (const b of env.braziers) {
      const f = 1 + Math.sin(T * 13 + b.seed) * 0.12 + Math.sin(T * 23 + b.seed * 2) * 0.08;
      b.flame.scale.set(1, f, 1);
      b.core.scale.set(1, 2 - f, 1);
      if (b.light) b.light.intensity = 6 * (0.85 + (f - 1) * 1.5);
    }
  },
};
