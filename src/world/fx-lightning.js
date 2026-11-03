// Lightning bolts drawn entirely in the vertex shader, every live bolt in one
// batch. A vertex arrives as (t, side) on a flat ladder strip and the shader
// turns it into a world position: a straight axis from source to target, a fan
// of filaments around it, and kinks from linearly interpolated value noise
// (linear so the corners stay sharp, which is what reads as lightning). The
// ribbon faces the camera by crossing its tangent with the view vector.
//
// The bolt shape, strand fan, restrike flicker and colour profile are adapted
// from LinearAbiltyCastingThreeJS (https://github.com/achrefelouafi/LinearAbiltyCastingThreeJS),
// Copyright (c) 2026 mohamedachrefelouafi, MIT License (third_party/linear-ability-casting/LICENSE).
// The original draws one bolt per material; here each strand of each bolt is an
// instance with its own endpoints, birth and colour, so any number of towers
// firing at once still costs two draw calls (a hot core pass and a wide glow).

import * as THREE from 'three';
import { noiseGLSL } from './fx-noise.js';

const STRANDS = 5; // filaments per bolt: one thick main channel and four dimmer branches
const NODES = 28; // samples along a bolt; the kink detail ceiling

const VERTEX = /* glsl */ `
  #define PI  3.141592653589793
  #define TAU 6.283185307179586

  uniform float uTime;
  uniform float uWidthScale;

  attribute vec4 aFrom;   // xyz source, w birth time
  attribute vec4 aTo;     // xyz target, w life
  attribute vec4 aLook;   // rgb colour, w core half-width
  attribute vec4 aStrand; // x seed, y radial (0 = main channel), z jitter, w strand spread

  varying float vT;
  varying float vSide;
  varying float vStrand;
  varying float vFlash;
  varying float vProgress;
  varying float vFade;
  varying vec3  vColor;

  ${noiseGLSL}

  // Value noise with a linear ramp: piecewise-linear output, sharp corners.
  float vnoise(float x, float seed) {
    float i = floor(x);
    return mix(hash11(i + seed), hash11(i + 1.0 + seed), x - i) * 2.0 - 1.0;
  }

  vec2 kink(float t, float seed, float span) {
    vec2 o = vec2(0.0);
    float amp = 1.0;
    float freq = 0.6 * span;
    float scroll = uTime * 3.2;
    for (int i = 0; i < 4; i++) {
      o.x += amp * vnoise(t * freq + scroll, seed + 13.0 * float(i));
      o.y += amp * vnoise(t * freq + scroll * 1.17, seed + 71.3 + 13.0 * float(i));
      amp *= 0.55;
      freq *= 2.0;
      scroll *= 1.63;
    }
    return o;
  }

  vec3 boltPoint(float t, float seed, float radial, float jitter, vec3 n1, vec3 n2, float span) {
    vec3 axis = mix(aFrom.xyz, aTo.xyz, t);
    axis.y += 0.012 * span * sin(t * PI); // a slight upward bow
    // Pinned at both ends: a bolt that lands beside its target reads as a miss.
    float ends = smoothstep(0.0, 0.14, t) * smoothstep(0.0, 0.14, 1.0 - t);
    vec2 offset = kink(t, seed, span) * jitter * ends;
    float angle = seed * TAU + (t * 0.45 + uTime * 0.8) * TAU;
    float reach = mix(0.03, 0.4, pow(t, 1.6)) * min(1.0, span * 0.12);
    offset += vec2(cos(angle), sin(angle)) * reach * radial * aStrand.w;
    return axis + n1 * offset.x + n2 * offset.y;
  }

  void main() {
    float age = uTime - aFrom.w;
    float life = aTo.w;
    if (age < 0.0 || age > life) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    float k = age / life;

    float t = position.x;
    float side = position.y;
    vT = t;
    vSide = side;
    vColor = aLook.rgb;
    // The strike front crosses the whole span in the first third of the bolt's
    // life, then the bolt holds and burns out.
    vProgress = min(1.0, age / max(0.04, life * 0.3)) * 1.1;
    vFade = 1.0 - smoothstep(0.45, 1.0, k);

    vec3 delta = aTo.xyz - aFrom.xyz;
    float span = max(length(delta), 0.01);
    // A zero-length hop (two points on one spot) would normalise a zero vector
    // into NaN, which the bloom pass smears over the whole screen.
    vec3 dir = length(delta) > 1e-3 ? delta / length(delta) : vec3(0.0, 1.0, 0.0);
    vec3 n1 = cross(dir, vec3(0.0, 1.0, 0.0));
    n1 = length(n1) > 1e-3 ? normalize(n1) : vec3(1.0, 0.0, 0.0);
    vec3 n2 = normalize(cross(dir, n1));

    // Every filament snaps onto a new shape 24 times a second; the scroll inside
    // kink() slides it in between, so a held bolt never looks like a ribbon.
    float strike = floor(uTime * 24.0);
    float seed = hash11(aStrand.x * 7.13 + strike * 3.77) * 97.0;
    float radial = aStrand.y;
    vStrand = radial;

    vec3 here = boltPoint(t, seed, radial, aStrand.z, n1, n2, span);
    float ahead = t + 0.03;
    float flip = 1.0;
    if (ahead > 1.0) { ahead = t - 0.03; flip = -1.0; }
    vec3 next = boltPoint(ahead, seed, radial, aStrand.z, n1, n2, span);
    vec3 tangent = (next - here) * flip;
    tangent = length(tangent) > 1e-5 ? normalize(tangent) : dir;

    vec3 toCamera = normalize(cameraPosition - here);
    vec3 binormal = cross(tangent, toCamera);
    float bl = length(binormal);
    binormal = bl > 1e-4 ? binormal / bl : n1;

    // A per-filament blink quantised to one clock, so the bundle strobes together.
    float flash = mix(1.0, hash11(floor(uTime * 34.0) + radial * 11.0 + aStrand.x), 0.5);
    vFlash = flash;

    float halfWidth = aLook.w * uWidthScale;
    halfWidth *= mix(1.0, 0.55, t);
    halfWidth *= mix(2.1, 1.0, radial);
    halfWidth *= flash * (0.35 + 0.65 * vFade);

    gl_Position = projectionMatrix * viewMatrix * vec4(here + binormal * side * halfWidth, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uPassOpacity;

  varying float vT;
  varying float vSide;
  varying float vStrand;
  varying float vFlash;
  varying float vProgress;
  varying float vFade;
  varying vec3  vColor;

  ${noiseGLSL}

  void main() {
    // Ahead of the strike front there is no bolt yet: the ribbon is clipped, not
    // scaled, so its shape never changes as the front travels.
    float drawn = 1.0 - smoothstep(vProgress - 0.08, vProgress, vT);
    if (drawn <= 0.002) discard;

    float v = clamp(abs(vSide), 0.0, 1.0);
    vec3 core = vec3(1.0);
    vec3 inner = mix(vColor, vec3(1.0), 0.3);
    vec3 halo = vColor * 0.45;

    #ifdef BOLT_GLOW
      float profile = pow(1.0 - v, 2.4);
      vec3 color = mix(halo, vColor, profile);
    #else
      float profile = pow(1.0 - v, 3.4);
      vec3 color = mix(vColor, inner, smoothstep(0.0, 0.5, profile));
      color = mix(color, core, smoothstep(0.45, 1.0, profile));
    #endif
    // The leading edge is where the air is breaking down.
    color += core * smoothstep(vProgress - 0.16, vProgress, vT) * (1.0 - step(1.0, vProgress)) * 2.0;

    // Quantised, not sinusoidal: lightning stutters between brightnesses.
    float flicker = 1.0 - 0.3 * hash11(floor(uTime * 34.0) + vStrand * 5.0);
    float alpha = profile * drawn * flicker * vFlash * vFade * uPassOpacity;
    alpha *= mix(1.0, 0.72, vStrand);
    if (alpha < 0.003) discard;
    gl_FragColor = vec4(color * 1.15, alpha);
  }
`;

function ribbonGeometry() {
  const positions = new Float32Array(NODES * 2 * 3);
  for (let i = 0; i < NODES; i++) {
    const t = i / (NODES - 1);
    positions[i * 6] = t; positions[i * 6 + 1] = -1;
    positions[i * 6 + 3] = t; positions[i * 6 + 4] = 1;
  }
  const index = [];
  for (let i = 0; i < NODES - 1; i++) {
    const a = i * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(index);
  return geo;
}

export class LightningBolts {
  constructor(scene, maxBolts) {
    this.max = maxBolts;
    this.cursor = 0;
    this.until = 0; // time the last live bolt dies; the batch hides after that
    const n = maxBolts * STRANDS;
    const geo = ribbonGeometry();
    this.attrs = {};
    for (const key of ['aFrom', 'aTo', 'aLook', 'aStrand']) {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
      a.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(key, a);
      this.attrs[key] = a;
    }
    // Dead slots sit at birth -1000 and collapse in the vertex shader.
    for (let i = 0; i < n; i++) this.attrs.aFrom.array[i * 4 + 3] = -1000;
    geo.instanceCount = n;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    this.geo = geo;
    this.dirtyFrom = Infinity;
    this.dirtyTo = -1;

    this.uTime = { value: 0 };
    const pass = (glow) => new THREE.ShaderMaterial({
      defines: glow ? { BOLT_GLOW: '' } : {},
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
      uniforms: { uTime: this.uTime, uWidthScale: { value: glow ? 6 : 1 }, uPassOpacity: { value: glow ? 0.42 : 1 } },
      vertexShader: VERTEX, fragmentShader: FRAGMENT,
    });
    this.meshes = [new THREE.Mesh(geo, pass(true)), new THREE.Mesh(geo, pass(false))];
    for (const m of this.meshes) {
      m.frustumCulled = false;
      m.visible = false;
      scene.add(m);
    }
    this.meshes[1].renderOrder = 1;
  }

  // One bolt from a to b ({x, y, z}). width is the main channel's half-width in
  // world units; jitter how far the kinks wander; spread how far the side strands
  // fan out (0 with no jitter draws a straight beam).
  add(time, a, b, color, width, life = 0.22, jitter = 0.42, spread = 1) {
    const slot = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    const seed = Math.random() * 1000;
    const { aFrom, aTo, aLook, aStrand } = this.attrs;
    for (let s = 0; s < STRANDS; s++) {
      const o = (slot * STRANDS + s) * 4;
      aFrom.array.set([a.x, a.y, a.z, time], o);
      aTo.array.set([b.x, b.y, b.z, life], o);
      aLook.array.set([color.r, color.g, color.b, width], o);
      aStrand.array.set([seed + s * 17.3, s / (STRANDS - 1), jitter, spread], o);
    }
    this.dirtyFrom = Math.min(this.dirtyFrom, slot * STRANDS);
    this.dirtyTo = Math.max(this.dirtyTo, slot * STRANDS + STRANDS);
    this.until = Math.max(this.until, time + life);
  }

  update(time) {
    this.uTime.value = time;
    const live = time < this.until;
    for (const m of this.meshes) m.visible = live;
    if (this.dirtyTo < 0) return;
    // Upload only the slots written since the last frame.
    for (const a of Object.values(this.attrs)) {
      a.clearUpdateRanges();
      a.addUpdateRange(this.dirtyFrom * 4, (this.dirtyTo - this.dirtyFrom) * 4);
      a.needsUpdate = true;
    }
    this.dirtyFrom = Infinity;
    this.dirtyTo = -1;
  }
}
