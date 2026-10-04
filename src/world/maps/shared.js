// Helpers shared by the map themes in this folder. Every map uses the same
// gameplay layout (src/sim/map-layout.js); only the scenery differs.
//
// A map module default-exports:
//   id, name, desc        shown on the setup screen
//   lighting              { sunDir: Vector3, sunColor, sunIntensity, hemiSky, hemiGround,
//                           hemiIntensity, fillColor, fillIntensity, fillDir: Vector3,
//                           fogColor, fogDensity, exposure, gradeShadow: [r,g,b],
//                           gradeHighlight: [r,g,b], nexusFull, nexusLow,
//                           bloomStrength?, bloomThreshold? }   (defaults 0.75 / 0.82)
//   terrainHeight(x, z)   ground height, used by effects that land on the ground
//   build(rand)           -> { objects: Object3D[], gate, nexus, ...state for update }
//                           gate.userData.vortex: ShaderMaterial with uTime
//                           nexus.userData: { crystal, crystalMat, ring1, ring2, beam, pillarMat, crystalY }
//   update(env, T)        per-frame animation of the map's own objects

import * as THREE from 'three';
import { TILE, COLS, ROWS, GROUND_ROUTE, AIR_ROUTE, PATH_TILES, BLOCKED_TILES, SPAWN, PORTAL, tileToWorld } from '../../sim/map-layout.js';

// ------------------------------------------------------------------ noise
export function hash(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
export function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, z, oct = 4) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += vnoise(x * f, z * f) * a; f *= 2.03; a *= 0.5; }
  return s;
}

// ------------------------------------------------------------------ layout

// Half extents of the playable rectangle plus a small margin.
export const HALF_X = (COLS * TILE) / 2 + 1.5;
export const HALF_Z = (ROWS * TILE) / 2 + 1.5;

export function distToRoute(x, z, route = GROUND_ROUTE) {
  let best = Infinity;
  for (const s of route.segs) {
    const px = x - s.a.x, pz = z - s.a.z;
    const t = Math.max(0, Math.min(s.len, px * s.dx + pz * s.dz));
    const qx = s.a.x + s.dx * t - x, qz = s.a.z + s.dz * t - z;
    best = Math.min(best, qx * qx + qz * qz);
  }
  return Math.sqrt(best);
}

// Signed distance outside the playable rectangle (negative = inside).
export function outside(x, z) {
  const dx = Math.abs(x) - HALF_X, dz = Math.abs(z) - HALF_Z;
  const ox = Math.max(dx, 0), oz = Math.max(dz, 0);
  return Math.hypot(ox, oz) + Math.min(Math.max(dx, dz), 0);
}

// The stretch of road from the spawn gate onto the field.
export const onEntryRoad = (x, z) => Math.abs(z - SPAWN.z) < 2 && x < -HALF_X + 3 && x > SPAWN.x - 14;

// Keeps decor off the road, the entry road and a clear ring around the portal.
export const clearOfRoad = (x, z, margin, half = 1.25) => distToRoute(x, z) > half + margin && !onEntryRoad(x, z)
  && Math.hypot(x - PORTAL.x - 1.5, z - PORTAL.z) > 4.5;

// True near a tile centre, where towers stand; decor on the field avoids these.
export const nearTileCentre = (x, z, frac = 0.3) => {
  const tx = Math.abs((((x / TILE) % 1) + 1) % 1 - 0.5), tz = Math.abs((((z / TILE) % 1) + 1) % 1 - 0.5);
  return tx < frac && tz < frac;
};

// Points along the road, `step` apart, with the road's left normal.
export function roadSamples(step) {
  const out = [];
  const r = GROUND_ROUTE;
  for (let d = 0; d <= r.length; d += step) {
    const s = r.segs.find((sg) => d <= sg.start + sg.len) || r.segs.at(-1);
    const t = Math.min(s.len, d - s.start);
    out.push({ x: s.a.x + s.dx * t, z: s.a.z + s.dz * t, nx: -s.dz, nz: s.dx, dx: s.dx, dz: s.dz, d });
  }
  return out;
}

// ------------------------------------------------------------------ instancing

const dummy = new THREE.Object3D();
// Matrix for position, uniform-or-per-axis scale and rotation.
export const mk = (x, y, z, sx, ry = 0, sy = sx, sz = sx, rx = 0, rz = 0) => {
  dummy.position.set(x, y, z); dummy.rotation.set(rx, ry, rz); dummy.scale.set(sx, sy, sz); dummy.updateMatrix();
  return dummy.matrix.clone();
};

export function instanced(geo, material, matrices, { cast = true, colors = null } = {}) {
  const m = new THREE.InstancedMesh(geo, material, Math.max(1, matrices.length));
  matrices.forEach((mx, i) => m.setMatrixAt(i, mx));
  if (colors) colors.forEach((c, i) => m.setColorAt(i, c));
  m.count = matrices.length;
  m.castShadow = cast;
  m.receiveShadow = true;
  m.instanceMatrix.needsUpdate = true;
  return m;
}

// ------------------------------------------------------------------ shared pieces

// Animated chevrons along the road showing the direction of travel, fading from
// `from` at the gate to `to` at the portal.
export function buildPathRibbon(from = 0x9a4dff, to = 0xff4033, strength = 0.2) {
  const pts = roadSamples(0.5);
  const w = 0.8;
  const positions = [], uvs = [], idx = [];
  pts.forEach((p, i) => {
    positions.push(p.x + p.nx * w, 0.07, p.z + p.nz * w, p.x - p.nx * w, 0.07, p.z - p.nz * w);
    uvs.push(p.d, 0, p.d, 1);
    if (i > 0) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uLen: { value: GROUND_ROUTE.length }, uFrom: { value: new THREE.Color(from) }, uTo: { value: new THREE.Color(to) }, uStrength: { value: strength } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform float uTime; uniform float uLen; uniform vec3 uFrom; uniform vec3 uTo; uniform float uStrength; varying vec2 vUv;
      void main(){
        float across = abs(vUv.y - 0.5) * 2.0;
        float chev = fract((vUv.x - across * 0.6) * 0.5 - uTime * 0.6);
        float band = smoothstep(0.0, 0.08, chev) * smoothstep(0.22, 0.1, chev);
        vec3 col = mix(uFrom, uTo, vUv.x / uLen);
        float a = band * (1.0 - across) * uStrength;
        gl_FragColor = vec4(col * a, a);
      }`,
  });
  return new THREE.Mesh(geo, material);
}

// Faint line showing the flyers' route.
export function buildAirLane(color = 0x6fa8ff, opacity = 0.18) {
  const pts = AIR_ROUTE.pts.map((p) => new THREE.Vector3(p.x, 2.7, p.z));
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.0);
  const geo = new THREE.TubeGeometry(curve, 200, 0.03, 4, false);
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
}

// Tile grid + hover highlight shown while placing a tower (the same on every map).
export function buildGridOverlay(lineColor = 0xfff0c0) {
  const W = COLS * TILE, D = ROWS * TILE;
  const geo = new THREE.PlaneGeometry(W, D);
  geo.rotateX(-Math.PI / 2);
  // Encode buildability into a data texture (1 = buildable).
  const data = new Uint8Array(COLS * ROWS * 4);
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const ok = !PATH_TILES.has(`${c},${r}`) && !BLOCKED_TILES.has(`${c},${r}`);
    data.set([ok ? 255 : 0, 0, 0, 255], (r * COLS + c) * 4);
  }
  const tex = new THREE.DataTexture(data, COLS, ROWS);
  tex.needsUpdate = true;
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uTex: { value: tex }, uHover: { value: new THREE.Vector2(-1, -1) }, uValid: { value: 1 }, uTime: { value: 0 }, uShow: { value: 0 }, uLine: { value: new THREE.Color(lineColor) } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform sampler2D uTex; uniform vec2 uHover; uniform float uValid; uniform float uTime; uniform float uShow; uniform vec3 uLine; varying vec2 vUv;
      void main(){
        vec2 g = vec2(vUv.x * ${COLS}.0, (1.0 - vUv.y) * ${ROWS}.0);
        vec2 cell = floor(g); vec2 f = fract(g);
        float ok = texture2D(uTex, (cell + 0.5) / vec2(${COLS}.0, ${ROWS}.0)).r;
        float edge = 1.0 - smoothstep(0.0, 0.06, min(min(f.x, 1.0-f.x), min(f.y, 1.0-f.y)));
        vec3 col = uLine; float a = edge * 0.3 * ok;
        if (cell == uHover) {
          col = mix(vec3(1.0,0.25,0.2), vec3(0.3,1.0,0.5), uValid);
          a = 0.35 + edge * 0.5 + 0.1 * sin(uTime * 6.0);
        }
        gl_FragColor = vec4(col, a * uShow);
      }`,
  });
  // DataTexture rows start at the bottom; flip lookup by storing rows top-down above.
  tex.flipY = false;
  const m = new THREE.Mesh(geo, material);
  m.position.y = 0.08;
  m.renderOrder = 4;
  return m;
}

// The swirling rift used inside spawn gates; `color` tints it.
export function riftMaterial(color, highlight = 0xffffff) {
  return new THREE.ShaderMaterial({
    transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(color) }, uHi: { value: new THREE.Color(highlight) } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform float uTime; uniform vec3 uColor; uniform vec3 uHi; varying vec2 vUv;
      void main(){
        vec2 p = vUv - 0.5; p.y *= 1.25;
        float r = length(p), a = atan(p.y, p.x);
        float swirl = sin(a * 5.0 + r * 18.0 - uTime * 4.0) * 0.5 + 0.5;
        float m = smoothstep(0.5, 0.1, r);
        vec3 col = mix(uColor, uHi, swirl * (1.0 - r * 2.0));
        gl_FragColor = vec4(col * (0.5 + swirl) * m * 1.6, m);
      }`,
  });
}

export { SPAWN, PORTAL, GROUND_ROUTE, AIR_ROUTE, PATH_TILES, BLOCKED_TILES, TILE, COLS, ROWS, tileToWorld };
