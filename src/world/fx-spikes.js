// Crystals and spikes bursting out of the ground (ice novas, root novas), all in
// one instanced mesh. Each spike waits for the wave front to reach it, punches up
// with a little overshoot, holds, then sinks back into the ground.
// The outward eruption follows LinearAbiltyCastingThreeJS's Frost Lance
// (https://github.com/achrefelouafi/LinearAbiltyCastingThreeJS), MIT License,
// Copyright (c) 2026 mohamedachrefelouafi.

import * as THREE from 'three';
import { terrainHeight } from './environment.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const outBack = (k) => 1 + 2.70158 * Math.pow(k - 1, 3) + 1.70158 * Math.pow(k - 1, 2);

export class Spikes {
  // material: MeshStandardMaterial options (ice glows faintly, roots do not).
  constructor(scene, max, material) {
    this.max = max;
    this.list = [];
    // A five-sided shard standing on its base, point up.
    const geo = new THREE.CylinderGeometry(0, 1, 1, 5, 1);
    geo.translate(0, 0.5, 0);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, ...material }), max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  // One spike at (x, z): `h` tall, `w` wide, tilted by (tx, tz) radians, rising
  // after `delay` and gone after `life`.
  add(x, z, h, w, tx, tz, color, delay, life) {
    if (this.list.length >= this.max) this.list.shift();
    this.list.push({ x, y: terrainHeight(x, z), z, h, w, tx, tz, yaw: Math.random() * 6.28, color: new THREE.Color(color), t: -delay, life });
  }

  // A ring of shards erupting outward from (x, z) to `radius`, front at `speed`.
  burst(x, z, radius, color, { count = 28, height = 1.6, width = 0.28, speed = 14, life = 0.9 } = {}) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = radius * Math.sqrt(0.08 + 0.92 * Math.random());
      const outward = r / radius;
      // Small and dense near the centre, opening into tall blades at the edge,
      // leaning away from where the wave came from.
      const h = height * (0.45 + 0.75 * outward) * (0.7 + Math.random() * 0.6);
      const lean = 0.25 + 0.35 * outward;
      this.add(x + Math.cos(a) * r, z + Math.sin(a) * r, h, width * (0.6 + Math.random() * 0.7),
        Math.sin(a) * lean, -Math.cos(a) * lean, color, r / speed, life);
    }
  }

  update(dt) {
    const L = this.list;
    if (!L.length && !this.mesh.count) return;
    let n = 0, w = 0;
    for (const s of L) {
      s.t += dt;
      if (s.t >= s.life) continue;
      L[w++] = s;
      if (s.t < 0) continue;
      const k = s.t / s.life;
      // Punch up in the first 15%, hold, sink in the last 35%.
      const up = k < 0.15 ? outBack(k / 0.15) : 1;
      const sink = k > 0.65 ? (k - 0.65) / 0.35 : 0;
      const h = s.h * Math.max(0.001, up) * (1 - sink * 0.6);
      _p.set(s.x, s.y - sink * s.h * 0.7, s.z);
      _q.setFromEuler(_e.set(s.tx, s.yaw, s.tz));
      _s.set(s.w, h, s.w);
      this.mesh.setMatrixAt(n, _m.compose(_p, _q, _s));
      this.mesh.setColorAt(n, _c.copy(s.color));
      n++;
    }
    L.length = w;
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (n) { this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor.needsUpdate = true; }
  }
}
