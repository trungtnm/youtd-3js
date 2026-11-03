// The meteor's burning rock and the molten cracks it tears into the ground.
//
// Adapted from LinearAbiltyCastingThreeJS's Cinder Fall (asteroid geometry, lava
// seam material, ground fissures), https://github.com/achrefelouafi/LinearAbiltyCastingThreeJS,
// Copyright (c) 2026 mohamedachrefelouafi, MIT License (third_party/linear-ability-casting/LICENSE).
// Left out: the raymarched fire wake, the debris chunks and the basalt lips,
// which cost more than a tower defense can spend on one cast.

import * as THREE from 'three';
import { noiseGLSL } from './fx-noise.js';
import { terrainHeight } from './environment.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const saturate = (v) => clamp(v, 0, 1);
const smoothstep = (a, b, x) => { const t = saturate((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const rand = (a, b) => a + Math.random() * (b - a);

// ------------------------------------------------------------------ rock geometry

function hash11(n) {
  const s = Math.sin(n * 127.1) * 43758.5453123;
  return s - Math.floor(s);
}

function lattice(ix, iy, iz, seed) {
  return hash11(ix * 127.1 + iy * 311.7 + iz * 74.7 + seed * 19.19);
}

// Value noise on a smoothstepped lattice, 0..1. The rock is displaced on the CPU,
// so its silhouette and flat-shaded normals follow the shape.
function valueNoise3(x, y, z, seed) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  const c000 = lattice(ix, iy, iz, seed), c100 = lattice(ix + 1, iy, iz, seed);
  const c010 = lattice(ix, iy + 1, iz, seed), c110 = lattice(ix + 1, iy + 1, iz, seed);
  const c001 = lattice(ix, iy, iz + 1, seed), c101 = lattice(ix + 1, iy, iz + 1, seed);
  const c011 = lattice(ix, iy + 1, iz + 1, seed), c111 = lattice(ix + 1, iy + 1, iz + 1, seed);
  const x00 = c000 + (c100 - c000) * ux, x10 = c010 + (c110 - c010) * ux;
  const x01 = c001 + (c101 - c001) * ux, x11 = c011 + (c111 - c011) * ux;
  const y0 = x00 + (x10 - x00) * uy, y1 = x01 + (x11 - x01) * uy;
  return y0 + (y1 - y0) * uz;
}

function fbmValue(x, y, z, seed, octaves) {
  let value = 0, amplitude = 0.5, frequency = 1;
  for (let i = 0; i < octaves; i++) {
    value += amplitude * (valueNoise3(x * frequency, y * frequency, z * frequency, seed + i * 7.7) * 2 - 1);
    frequency *= 2.03;
    amplitude *= 0.5;
  }
  return value;
}

// A fractured, cratered ball of rock of radius about 1: an icosphere pushed in
// and out by noise, with impact bowls punched in and flat faces sliced off.
function asteroidGeometry(seed) {
  const lumpiness = 0.26, noiseScale = 1.5, roughness = 0.16;
  const cuts = 9, cutDepth = 0.28, craters = 5, craterDepth = 0.18, craterSize = 0.5;
  const geometry = new THREE.IcosahedronGeometry(1, 2); // already non-indexed: one normal per face
  const array = geometry.attributes.position.array;
  const direction = (a, b) => {
    const phi = Math.acos(2 * hash11(a) - 1), theta = hash11(b) * TAU, s = Math.sin(phi);
    return { x: s * Math.cos(theta), y: Math.cos(phi), z: s * Math.sin(theta) };
  };
  const planes = [];
  for (let i = 0; i < cuts; i++) {
    const n = direction(seed * 2.3 + i * 9.1, seed * 5.7 + i * 4.3);
    // Kept above 0.55 so a cut never lops the rock in half.
    n.offset = 1 - cutDepth * (0.35 + 0.9 * hash11(seed * 13.1 + i * 6.7));
    planes.push(n);
  }
  const bowls = [];
  for (let i = 0; i < craters; i++) {
    const c = direction(seed * 3.1 + i * 12.9, seed * 7.7 + i * 5.3);
    c.radius = Math.max(0.08, craterSize * (0.45 + 0.8 * hash11(seed * 11.3 + i * 3.7)));
    c.depth = craterDepth * (0.5 + hash11(seed * 17.9 + i * 2.1));
    bowls.push(c);
  }
  for (let i = 0; i < array.length; i += 3) {
    const x = array[i], y = array[i + 1], z = array[i + 2];
    let radius = 1;
    radius += fbmValue(x * noiseScale, y * noiseScale, z * noiseScale, seed, 3) * lumpiness;
    radius += fbmValue(x * noiseScale * 4.3, y * noiseScale * 4.3, z * noiseScale * 4.3, seed + 31.7, 2) * roughness * 0.5;
    // Craters before the cuts, so a cut can shear one in half.
    for (const bowl of bowls) {
      const q = Math.acos(clamp(x * bowl.x + y * bowl.y + z * bowl.z, -1, 1)) / bowl.radius;
      if (q >= 1.4) continue;
      radius -= bowl.depth * Math.max(0, 1 - q * q);
      radius += bowl.depth * 0.5 * smoothstep(0.72, 1.0, q) * (1 - smoothstep(1.0, 1.4, q));
    }
    radius = Math.max(0.35, radius);
    let px = x * radius, py = y * radius, pz = z * radius;
    // Project anything outside a cut plane back onto it: a truly flat facet.
    for (const p of planes) {
      const over = px * p.x + py * p.y + pz * p.z - p.offset;
      if (over <= 0) continue;
      px -= p.x * over; py -= p.y * over; pz -= p.z * over;
    }
    array[i] = px; array[i + 1] = py; array[i + 2] = pz;
  }
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.userData.shared = true;
  return geometry;
}

let rocks = null;
export function meteorGeometry() {
  rocks ??= [1.7, 4.2, 7.9].map(asteroidGeometry);
  return rocks[Math.floor(Math.random() * rocks.length)];
}

// ------------------------------------------------------------------ rock material

// Burning rock: lava seams are the zero crossings of an fbm field sampled in the
// rock's local space (so they tumble with it), charred either side, white-hot in
// the middle. uCharge runs 0..1 on the way down and prises the seams open, and
// the facets facing the direction of travel take the compression heat.
export function meteorMaterial() {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.94, metalness: 0, flatShading: true });
  const uniforms = {
    uTime: { value: 0 },
    uSeed: { value: Math.random() * 10 },
    uCharge: { value: 0 },
    uHeading: { value: new THREE.Vector3(0, -1, 0) },
    uColorRock: { value: new THREE.Color('#6e675f') },
    uColorChar: { value: new THREE.Color('#17130f') },
    uColorCrack: { value: new THREE.Color('#ff6a12') },
    uColorHot: { value: new THREE.Color('#fff3d0') },
  };
  material.userData.uniforms = uniforms;
  material.userData.owned = true; // disposed with the effect, unlike the shared mat() cache
  material.customProgramCacheKey = () => 'fx-meteor-rock';
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vRockLocal;
        varying vec3 vRockNormalW;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vRockLocal = transformed;
        vRockNormalW = normalize(mat3(modelMatrix) * objectNormal);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uTime;
        uniform float uSeed;
        uniform float uCharge;
        uniform vec3  uHeading;
        uniform vec3  uColorRock;
        uniform vec3  uColorChar;
        uniform vec3  uColorCrack;
        uniform vec3  uColorHot;
        varying vec3  vRockLocal;
        varying vec3  vRockNormalW;
        ${noiseGLSL}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec3  N   = normalize(normal);
          float ndv = clamp(dot(N, normalize(vViewPosition)), 0.0, 1.0);
          float rim = pow(1.0 - ndv, 2.2);

          // The seam as a cross-section: an open fissure (no rock, only magma),
          // a wider charred lip, and a core hot enough to run white.
          vec3  p  = vRockLocal * 0.95 + uSeed * 19.0;
          float f1 = fbm3(p);
          float f2 = fbm3(p * 2.7 + 11.3);
          float width = 0.045 * (1.0 + uCharge * 0.8);
          float dist = min(abs(f1), abs(f2) / 0.5);
          float fissure = 1.0 - smoothstep(width * 0.35, width, dist);
          float lip     = 1.0 - smoothstep(width, width * 2.0, dist);
          float core    = 1.0 - smoothstep(0.0, width * 0.45, dist);
          float pulse = snoise(vRockLocal * 4.0 + vec3(0.0, uTime * 0.9, 0.0) + uSeed * 7.0);
          float flow  = mix(1.0, 0.45 + 0.75 * (pulse * 0.5 + 0.5), 0.7);

          float mottle = fbm3(vRockLocal * 3.4 + uSeed * 31.0) * 0.5 + 0.5;
          vec3  rock = mix(uColorRock, uColorChar, smoothstep(0.3, 0.85, mottle));
          // Hashing the object-space face normal gives every flat face its own shade.
          vec3  faceN = normalize(cross(dFdx(vRockLocal), dFdy(vRockLocal)));
          rock *= 1.0 + (hash13(faceN * 37.0 + uSeed + 0.5) - 0.5) * 0.5;
          rock *= mix(0.75, 1.0, smoothstep(0.55, 1.0, length(vRockLocal)));
          rock = mix(rock, uColorChar, lip * 0.6);
          rock *= 1.0 - fissure * 0.92;
          rock *= mix(0.55, 1.15, ndv);
          diffuseColor.rgb *= rock;

          vec3 glow = mix(uColorCrack, uColorHot, core * core) * fissure * flow * 3.2;
          float charge2 = uCharge * uCharge;
          glow += uColorCrack * rim * 0.7 * charge2;
          float lead = pow(clamp(dot(normalize(vRockNormalW), uHeading), 0.0, 1.0), 2.6);
          glow += uColorHot * lead * 0.9 * charge2;
          glow *= 1.1;
          // Soft ceiling: stacked terms would otherwise bloom into a white blob.
          glow /= 1.0 + glow * 0.22;
          totalEmissiveRadiance += glow;
        }`);
  };
  return material;
}

// ------------------------------------------------------------------ molten cracks

const MAX_NODES = 700;
const STEP = 0.045; // centreline resample step, unit space

const FISSURE_VERTEX = /* glsl */ `
  attribute vec3  aSide;
  attribute float aAcross;
  attribute float aDist;
  attribute float aWidth;
  uniform float uWidthMul;
  uniform float uWidthAdd;
  varying float vAcross;
  varying float vDist;
  void main() {
    vAcross = aAcross;
    vDist = aDist;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position + aSide * aAcross * (aWidth * uWidthMul + uWidthAdd * step(0.001, aWidth)), 1.0);
  }
`;

const FISSURE_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uGrown;
  uniform float uHeat;
  uniform float uFade;
  varying float vAcross;
  varying float vDist;
  void main() {
    // The crack is only open behind its racing front.
    float openness = smoothstep(0.0, 0.08, uGrown - vDist);
    if (openness <= 0.001) discard;
    float pulse = sin(vDist * 22.0 - uTime * 2.6) * 0.28 + 0.72;
    #ifdef FISSURE_GLOW
      float falloff = pow(max(1.0 - abs(vAcross), 0.0), 1.6);
      float strength = falloff * pulse * uHeat * 0.34;
      vec3 color = vec3(1.0, 0.42, 0.08) * strength;
      float alpha = openness * uFade * clamp(strength * 2.2, 0.0, 1.0);
    #else
      float centre = 1.0 - smoothstep(0.12, 1.0, abs(vAcross));
      float flicker = sin(uTime * 9.0 + vDist * 120.0) * 0.08 + 0.94;
      // A white flash rides the propagating crack front.
      float flash = (1.0 - smoothstep(0.0, 0.14, abs(uGrown - vDist))) * 1.6;
      float heat = centre * pulse * flicker * uHeat + flash;
      vec3 color = mix(vec3(0.06, 0.02, 0.01), vec3(0.9, 0.12, 0.02), smoothstep(0.0, 0.55, heat));
      color = mix(color, vec3(1.0, 0.45, 0.08), smoothstep(0.55, 1.15, heat));
      color = mix(color, vec3(1.0, 0.95, 0.8), smoothstep(1.15, 2.1, heat));
      float alpha = openness * (1.0 - smoothstep(0.82, 1.0, abs(vAcross))) * uFade;
    #endif
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(color, alpha);
  }
`;

// A network of cracks radiating from (x, z): meandering main arms that pull back
// toward their launch bearing, with forked branches hung off them, laid on the
// terrain as ribbons. dist (0..1 from the centre) drives the racing front.
function fissureGeometry(x, z, radius, width) {
  const pos = [], side = [], across = [], dists = [], widths = [], index = [];
  let node = 0;
  const walk = (sx, sz, heading, length, originDist, widthScale, branch) => {
    const laid = [];
    let ux = sx, uz = sz, angle = heading, jitter = 1;
    const curvature = rand(-1.6, 1.6);
    const first = node;
    for (let travelled = 0; travelled <= length && node < MAX_NODES; travelled += STEP) {
      jitter = clamp(jitter + rand(-0.18, 0.18), 0.6, 1.45);
      // A crack ends in a needle, not a rounded cap.
      const tip = Math.pow(saturate((length - travelled) / 0.22), 0.65);
      const w = width * 0.5 * jitter * widthScale * (branch ? 0.62 * Math.pow(1 - travelled / length, 0.7) : tip);
      const wx = x + ux * radius, wz = z + uz * radius;
      const y = terrainHeight(wx, wz) + 0.07;
      const lx = Math.cos(angle + Math.PI / 2), lz = Math.sin(angle + Math.PI / 2);
      for (const a of [-1, 1]) {
        pos.push(wx, y, wz); side.push(lx, 0, lz); across.push(a);
        dists.push(saturate(originDist + travelled)); widths.push(w);
      }
      laid.push({ x: ux, z: uz, angle, dist: saturate(originDist + travelled) });
      node++;
      ux += Math.cos(angle) * STEP;
      uz += Math.sin(angle) * STEP;
      angle += curvature * STEP + rand(-0.35, 0.35) * STEP;
      // Pull back toward the launch bearing, or a steady veer curls into a circle.
      angle += (heading - angle) * 0.06;
    }
    for (let i = first; i < node - 1; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    return laid;
  };
  const arms = 6, spin = Math.random() * TAU, mains = [];
  for (let i = 0; i < arms; i++) {
    // Uneven spacing: equal angles read as a star however much they meander.
    const heading = spin + (i / arms) * TAU + rand(-0.45, 0.45);
    const r0 = rand(0.04, 0.12);
    mains.push(walk(Math.cos(heading) * r0, Math.sin(heading) * r0, heading, rand(0.6, 1.0), r0, 1, false));
  }
  for (let b = 0; b < 6; b++) {
    const arm = mains[Math.floor(Math.random() * mains.length)];
    if (arm.length < 4) continue;
    const at = arm[Math.floor(rand(1, arm.length - 1))];
    // 32 to 72 degrees off the parent, like a lightning fork.
    const heading = at.angle + (Math.random() < 0.5 ? 1 : -1) * rand(0.55, 1.25);
    walk(at.x, at.z, heading, rand(0.18, 0.42), at.dist, 0.8, true);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 3));
  geo.setAttribute('aAcross', new THREE.Float32BufferAttribute(across, 1));
  geo.setAttribute('aDist', new THREE.Float32BufferAttribute(dists, 1));
  geo.setAttribute('aWidth', new THREE.Float32BufferAttribute(widths, 1));
  geo.setIndex(index);
  geo.computeBoundingSphere();
  return geo;
}

// Molten cracks around an impact. Returns the group plus update(age) and its life.
export function moltenCracks(x, z, radius, life = 4.5) {
  const geo = fissureGeometry(x, z, radius, 0.22);
  const group = new THREE.Group();
  const uniforms = { uTime: { value: 0 }, uGrown: { value: 0 }, uHeat: { value: 1.5 }, uFade: { value: 1 } };
  // Underglow first so the core adds on top of it.
  for (const glow of [true, false]) {
    const m = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      defines: glow ? { FISSURE_GLOW: '' } : {},
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
      polygonOffset: true, polygonOffsetFactor: -3,
      // The glow pass is the same ribbon drawn wider, painting light onto the ground around the seam.
      uniforms: { ...uniforms, uWidthMul: { value: glow ? 3.4 : 1 }, uWidthAdd: { value: glow ? 0.12 : 0 } },
      vertexShader: FISSURE_VERTEX, fragmentShader: FISSURE_FRAGMENT,
    }));
    group.add(m);
  }
  const growth = 9 / radius; // the front races out at 9 world units per second
  const update = (age) => {
    const k = age / life;
    uniforms.uTime.value = age;
    uniforms.uGrown.value = Math.min(1.2, age * growth);
    // Cools from white-hot to a dull red seam, then closes up.
    uniforms.uHeat.value = 1.5 * (1 - smoothstep(0.15, 0.9, k)) + 0.3;
    uniforms.uFade.value = 1 - smoothstep(0.7, 1, k);
  };
  return { group, update, life };
}
