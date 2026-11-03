// Ground effects (shockwave rings, flash discs and lingering zones) drawn as one
// instanced batch. Every effect is a quad on the ground; the fragment shader
// draws its shape from the distance to the centre, so a splash ring, a nova and a
// storm field cost the same single draw call however many are on screen.

import * as THREE from 'three';
import { noiseGLSL } from './fx-noise.js';

export const GROUND = { RING: 0, FLASH: 1, ZONE: 2 };
const PAD = 1.2; // quad half-size in radii, so a ring's glow fits

const VERTEX = /* glsl */ `
  uniform float uTime;
  attribute vec4 aA; // xyz centre, w radius
  attribute vec4 aB; // rgb colour, w strength
  attribute vec4 aC; // x birth, y life, z kind, w seed
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vK;
  varying float vKind;
  varying float vStrength;
  varying float vSeed;
  varying float vAge;
  void main() {
    float age = uTime - aC.x;
    if (age < 0.0 || age > aC.y) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    vK = age / aC.y;
    vAge = age;
    vUv = position.xz * ${PAD.toFixed(2)};
    vColor = aB.rgb;
    vStrength = aB.w;
    vKind = aC.z;
    vSeed = aC.w;
    vec3 p = aA.xyz + vec3(position.x, 0.0, position.z) * aA.w * ${PAD.toFixed(2)};
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vK;
  varying float vKind;
  varying float vStrength;
  varying float vSeed;
  varying float vAge;
  ${noiseGLSL}
  void main() {
    float r = length(vUv);
    vec2 dir = r > 1e-4 ? vUv / r : vec2(1.0, 0.0);
    vec3 col = vColor;
    float a = 0.0;
    if (vKind < 0.5) {
      // Shockwave: a band racing outward and thinning, its edge broken by noise
      // so it reads as energy rather than a drawn circle; a faint wash behind it.
      float front = 0.2 + 0.8 * sqrt(vK);
      float n = snoise(vec3(dir * 3.0, vSeed + vK * 2.0)) * 0.5 + 0.5;
      float width = mix(0.05, 0.14, n) * (1.0 - vK * 0.6);
      float band = 1.0 - smoothstep(0.0, width, abs(r - front));
      float wash = smoothstep(front, 0.0, r) * 0.18 * (1.0 - vK);
      a = (band * (0.55 + 0.6 * n) + wash) * (1.0 - vK);
      col = mix(vColor, vec3(1.0), band * band * 0.45 * (1.0 - vK));
    } else if (vKind < 1.5) {
      // Flash: a soft disc, mottled, gone in a blink.
      float n = fbm3(vec3(vUv * 2.2, vSeed)) * 0.5 + 0.5;
      a = (1.0 - smoothstep(0.0, 1.0, r)) * (0.55 + 0.45 * n) * 0.4 * (1.0 - vK) * (1.0 - vK);
    } else {
      // Zone: a rim of rotating dashes, a slow swirl of noise inside, fading in and out.
      float fade = smoothstep(0.0, 0.08, vK) * (1.0 - smoothstep(0.85, 1.0, vK));
      float ang = atan(vUv.y, vUv.x);
      float dash = smoothstep(0.35, 0.65, sin(ang * 14.0 + vAge * 1.6) * 0.5 + 0.5);
      float rim = (1.0 - smoothstep(0.0, 0.05, abs(r - 0.97))) * (0.45 + 0.55 * dash);
      float swirl = fbm3(vec3(vUv * 1.6 + vec2(sin(vAge * 0.3), cos(vAge * 0.27)) * 0.6, vSeed + vAge * 0.15)) * 0.5 + 0.5;
      float inside = (1.0 - smoothstep(0.8, 1.0, r)) * (0.07 + 0.16 * smoothstep(0.45, 0.85, swirl));
      float pulse = 0.85 + 0.15 * sin(vAge * 4.0 + vSeed);
      a = (rim * 0.75 + inside) * fade * pulse;
    }
    a *= vStrength;
    if (a < 0.004) discard;
    gl_FragColor = vec4(col * 1.4, a);
  }
`;

export class GroundEffects {
  constructor(scene, max) {
    this.max = max;
    this.cursor = 0;
    this.until = 0;
    this.ends = new Float32Array(max); // when each slot's effect finishes
    const plane = new THREE.PlaneGeometry(2, 2);
    plane.rotateX(-Math.PI / 2);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = plane.index;
    geo.setAttribute('position', plane.getAttribute('position'));
    this.attrs = {};
    for (const key of ['aA', 'aB', 'aC']) {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(key, a);
      this.attrs[key] = a;
    }
    for (let i = 0; i < max; i++) this.attrs.aC.array[i * 4] = -1000;
    geo.instanceCount = max;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    this.uTime = { value: 0 };
    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      uniforms: { uTime: this.uTime }, vertexShader: VERTEX, fragmentShader: FRAGMENT,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.dirtyFrom = Infinity;
    this.dirtyTo = -1;
  }

  add(time, kind, x, y, z, radius, color, life, strength = 1) {
    // Take the next free slot so a long zone is never overwritten by a burst of
    // splash rings; with every slot busy, the one ending soonest gives way.
    let i = this.cursor, best = i;
    for (let n = 0; n < this.max; n++, i = (i + 1) % this.max) {
      if (this.ends[i] <= time) { best = i; break; }
      if (this.ends[i] < this.ends[best]) best = i;
    }
    i = best;
    this.cursor = (i + 1) % this.max;
    this.ends[i] = time + life;
    const { aA, aB, aC } = this.attrs;
    aA.array.set([x, y, z, radius], i * 4);
    aB.array.set([color.r, color.g, color.b, strength], i * 4);
    aC.array.set([time, life, kind, Math.random() * 100], i * 4);
    this.dirtyFrom = Math.min(this.dirtyFrom, i);
    this.dirtyTo = Math.max(this.dirtyTo, i + 1);
    this.until = Math.max(this.until, time + life);
  }

  update(time) {
    this.uTime.value = time;
    this.mesh.visible = time < this.until;
    if (this.dirtyTo < 0) return;
    for (const a of Object.values(this.attrs)) {
      a.clearUpdateRanges();
      a.addUpdateRange(this.dirtyFrom * 4, (this.dirtyTo - this.dirtyFrom) * 4);
      a.needsUpdate = true;
    }
    this.dirtyFrom = Infinity;
    this.dirtyTo = -1;
  }
}
