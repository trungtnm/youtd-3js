// Map theme: the original island. A green plateau ringed by a lake and pine-clad
// mountains under an evening sky, with fireflies, lanterns and crystal clusters.

import * as THREE from 'three';
import { mat, glow } from '../models.js';
import {
  fbm, HALF_X, HALF_Z, distToRoute as routeDist, outside, instanced, buildPathRibbon, buildAirLane, riftMaterial,
  GROUND_ROUTE, BLOCKED_TILES, SPAWN, PORTAL, tileToWorld,
} from './shared.js';

const SUN_DIR = new THREE.Vector3(45, 55, 28).normalize();
const FOG_COLOR = 0x2a2440, FOG_DENSITY = 0.0065;
const distToRoute = (x, z) => routeDist(x, z, GROUND_ROUTE);
const WATER_Y = -1.6;

function terrainHeight(x, z) {
  const o = outside(x, z) + (fbm(x * 0.08, z * 0.08) - 0.5) * 3;
  let h;
  if (o < 0) h = (fbm(x * 0.15, z * 0.15) - 0.5) * 0.25;
  else if (o < 2.5) h = -o * 1.6;             // cliff face
  else if (o < 16) h = -3.4 - Math.sin(o * 0.3) * 0.4; // lake bed
  else h = -3.4 + Math.pow((o - 16) / 30, 1.4) * 34 * fbm(x * 0.035 + 7, z * 0.035, 5); // ring of mountains
  // Bridge to the spawn gate
  if (Math.abs(z - SPAWN.z) < 1.8 && x < -HALF_X + 2 && x > SPAWN.x - 9) h = Math.max(h, -0.05);
  return h;
}

// ------------------------------------------------------------------ builders

function buildTerrain() {
  const W = 220, D = 170, SX = 132, SZ = 102;
  const geo = new THREE.PlaneGeometry(W, D, SX, SZ);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const grassA = new THREE.Color(0x3f6b2a), grassB = new THREE.Color(0x5c8a34), grassC = new THREE.Color(0x2e5222);
  const dirt = new THREE.Color(0x7a5c3c), dirtD = new THREE.Color(0x5a4028);
  const rock = new THREE.Color(0x5a5560), rockL = new THREE.Color(0x8a8590), sand = new THREE.Color(0x8a7a58), snow = new THREE.Color(0xe8eef8);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    let h = terrainHeight(x, z);
    const n = fbm(x * 0.3, z * 0.3);
    const pd = distToRoute(x, z);
    const o = outside(x, z);
    if (o < 0) {
      c.copy(grassA).lerp(grassB, n).lerp(grassC, fbm(x * 0.05 + 3, z * 0.05) * 0.6);
      if (pd < 1.5) { c.copy(dirt).lerp(dirtD, n); h -= 0.12 * (1 - pd / 1.5) + 0.02; }
      else if (pd < 2.2) c.lerp(dirt, (2.2 - pd) / 0.7 * 0.6);
    } else if (h < -0.5 && h > -3.8 && o < 18) {
      c.copy(rock).lerp(sand, Math.min(1, Math.max(0, (o - 2) / 4)));
    } else {
      c.copy(rock).lerp(rockL, n);
      if (h > 2 && h < 9) c.lerp(grassC, 0.5 * fbm(x * 0.1, z * 0.1));
      if (h > 14) c.lerp(snow, Math.min(1, (h - 14) / 6));
    }
    if (Math.abs(z - SPAWN.z) < 1.8 && x < -HALF_X + 2 && x > SPAWN.x - 9) c.copy(dirtD);
    pos.setY(i, h);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }));
  m.receiveShadow = true;
  return m;
}

function buildWater() {
  const geo = new THREE.PlaneGeometry(600, 600, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const material = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: { uTime: { value: 0 }, uSun: { value: SUN_DIR.clone() }, uFogColor: { value: new THREE.Color(FOG_COLOR) }, uFogDensity: { value: FOG_DENSITY } },
    vertexShader: `
      varying vec3 vWorld;
      void main(){ vec4 w = modelMatrix * vec4(position,1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `
      uniform float uTime; uniform vec3 uSun; uniform vec3 uFogColor; uniform float uFogDensity;
      varying vec3 vWorld;
      float h(vec2 p){ return sin(p.x*0.7+uTime*1.1)*0.5 + sin(p.y*0.9-uTime*0.8)*0.5 + sin((p.x+p.y)*1.7+uTime*1.7)*0.25 + sin((p.x-p.y)*2.9-uTime*2.3)*0.12; }
      void main(){
        vec2 p = vWorld.xz;
        float e = 0.08;
        vec3 n = normalize(vec3(h(p-vec2(e,0.))-h(p+vec2(e,0.)), 6.0, h(p-vec2(0.,e))-h(p+vec2(0.,e))));
        vec3 V = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - max(dot(n, V), 0.0), 4.0);
        vec3 deep = vec3(0.02,0.07,0.12), shallow = vec3(0.05,0.25,0.3);
        float r = length(max(abs(p) - vec2(${HALF_X.toFixed(1)}, ${HALF_Z.toFixed(1)}), 0.0));
        vec3 col = mix(shallow, deep, smoothstep(1.0, 10.0, r));
        col = mix(col, vec3(0.35,0.45,0.65), fres*0.7);
        vec3 H = normalize(uSun + V);
        col += vec3(1.0,0.85,0.6) * pow(max(dot(n,H),0.0), 180.0) * 2.5;
        float foam = smoothstep(2.2, 1.0, r) * (0.5 + 0.5*sin(r*6.0 - uTime*2.0));
        col += vec3(0.6,0.8,0.9) * foam * 0.25;
        float d = length(vWorld - cameraPosition);
        float f = 1.0 - exp(-uFogDensity*uFogDensity*d*d);
        gl_FragColor = vec4(mix(col, uFogColor, f), 0.92);
      }`,
  });
  const m = new THREE.Mesh(geo, material);
  m.position.y = WATER_Y;
  return m;
}

function buildSky() {
  const geo = new THREE.SphereGeometry(500, 32, 16);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uSun: { value: new THREE.Vector3(0.5, 0.35, 0.3).normalize() }, uTime: { value: 0 } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 uSun; uniform float uTime; varying vec3 vDir;
      float hash(vec3 p){ p = fract(p*0.3183099+.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      void main(){
        float y = vDir.y;
        vec3 top = vec3(0.04,0.06,0.16), mid = vec3(0.18,0.2,0.42), hor = vec3(0.95,0.55,0.38);
        vec3 col = mix(hor, mid, smoothstep(-0.02, 0.18, y));
        col = mix(col, top, smoothstep(0.15, 0.7, y));
        float s = max(dot(vDir, uSun), 0.0);
        col += vec3(1.0,0.6,0.3) * pow(s, 8.0) * 0.6 + vec3(1.0,0.9,0.7) * pow(s, 400.0) * 6.0;
        vec3 sp = floor(vDir * 300.0);
        float star = step(0.9975, hash(sp)) * smoothstep(0.15, 0.5, y);
        col += star * (0.6 + 0.4*sin(uTime*2.0 + hash(sp+1.0)*30.0));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  return new THREE.Mesh(geo, material);
}

function buildDecor(rand) {
  const group = new THREE.Group();
  const dummy = new THREE.Object3D();
  const mk = (x, y, z, s, ry = 0, sy = s) => {
    dummy.position.set(x, y, z); dummy.rotation.set(0, ry, 0); dummy.scale.set(s, sy, s); dummy.updateMatrix();
    return dummy.matrix.clone();
  };

  // Pines around the lake shore and on lower mountain slopes
  const trunks = [], crowns = [], crowns2 = [];
  for (let i = 0; i < 420; i++) {
    const x = (rand() - 0.5) * 240, z = (rand() - 0.5) * 180;
    const o = outside(x, z);
    const h = terrainHeight(x, z);
    if (o < 14 || h < 0.3 || h > 13) continue;
    const s = 0.8 + rand() * 1.0;
    trunks.push(mk(x, h + 0.6 * s, z, s));
    crowns.push(mk(x, h + 2.2 * s, z, s, rand() * 6));
    crowns2.push(mk(x, h + 3.3 * s, z, s * 0.75, rand() * 6));
  }
  // Scenery outside the playfield never casts shadows: it is far from the shadow camera anyway.
  group.add(instanced(new THREE.CylinderGeometry(0.15, 0.25, 1.2, 5), mat(0x4a3220, { flat: true }), trunks, { cast: false }));
  group.add(instanced(new THREE.ConeGeometry(1.1, 2.4, 7), mat(0x24482c, { flat: true, rough: 0.9 }), crowns, { cast: false }));
  group.add(instanced(new THREE.ConeGeometry(0.8, 1.8, 7), mat(0x2d5a34, { flat: true, rough: 0.9 }), crowns2, { cast: false }));

  // Rocks: scattered on blocked tiles, shores and slopes
  const rocks = [];
  for (const key of BLOCKED_TILES) {
    const [c, r] = key.split(',').map(Number);
    const p = tileToWorld(c, r);
    for (let k = 0; k < 2; k++) rocks.push(mk(p.x + (rand() - 0.5) * 1.2, 0.2, p.z + (rand() - 0.5) * 1.2, 0.5 + rand() * 0.6, rand() * 6, 0.4 + rand() * 0.5));
  }
  for (let i = 0; i < 140; i++) {
    const x = (rand() - 0.5) * 220, z = (rand() - 0.5) * 170;
    const o = outside(x, z);
    if (o < 1 || o > 40) continue;
    rocks.push(mk(x, terrainHeight(x, z), z, 0.6 + rand() * 1.8, rand() * 6, 0.4 + rand()));
  }
  group.add(instanced(new THREE.DodecahedronGeometry(1, 0), mat(0x6a6670, { flat: true, rough: 0.95 }), rocks, { cast: false }));

  // Glowing crystal clusters on blocked tiles
  const crystals = [];
  for (const key of ['0,0', '29,15', '29,0', '0,15']) {
    const [c, r] = key.split(',').map(Number);
    const p = tileToWorld(c, r);
    for (let k = 0; k < 4; k++) {
      dummy.position.set(p.x + (rand() - 0.5) * 1.2, 0.5, p.z + (rand() - 0.5) * 1.2);
      dummy.rotation.set((rand() - 0.5) * 0.6, rand() * 6, (rand() - 0.5) * 0.6);
      const s = 0.3 + rand() * 0.35; dummy.scale.set(s, s * 3, s); dummy.updateMatrix();
      crystals.push(dummy.matrix.clone());
    }
  }
  group.add(instanced(new THREE.OctahedronGeometry(0.5, 0), mat(0x8fd8ff, { emissive: 0x3f9fff, ei: 1.6, rough: 0.2 }), crystals));

  // Grass tufts across the plateau, avoiding the path
  const tufts = [];
  for (let i = 0; i < 1600; i++) {
    const x = (rand() - 0.5) * (HALF_X * 2), z = (rand() - 0.5) * (HALF_Z * 2);
    if (distToRoute(x, z) < 1.8) continue;
    const s = 0.25 + rand() * 0.35;
    dummy.position.set(x, terrainHeight(x, z), z); dummy.rotation.set((rand() - 0.5) * 0.4, rand() * 6, 0); dummy.scale.set(s, s * (1 + rand()), s); dummy.updateMatrix();
    tufts.push(dummy.matrix.clone());
  }
  const tuftGeo = new THREE.ConeGeometry(0.12, 0.7, 3);
  tuftGeo.translate(0, 0.35, 0);
  group.add(instanced(tuftGeo, mat(0x5f9a3a, { flat: true, rough: 1 }), tufts, { cast: false }));

  // Flowers: tiny emissive dots that catch the bloom at dusk
  const flowers = [];
  for (let i = 0; i < 180; i++) {
    const x = (rand() - 0.5) * (HALF_X * 2), z = (rand() - 0.5) * (HALF_Z * 2);
    if (distToRoute(x, z) < 2) continue;
    flowers.push(mk(x, 0.18, z, 0.07));
  }
  group.add(instanced(new THREE.SphereGeometry(1, 6, 4), mat(0xffe08a, { emissive: 0xffb04a, ei: 1.2 }), flowers, { cast: false }));

  // Edge stones lining the path
  const stones = [];
  const r = GROUND_ROUTE;
  for (let d = 0; d < r.length; d += 1.3) {
    const s = r.segs.find((sg) => d <= sg.start + sg.len) || r.segs.at(-1);
    const t = d - s.start;
    const x = s.a.x + s.dx * t, z = s.a.z + s.dz * t;
    if (x < -HALF_X + 1) continue;
    for (const side of [-1, 1]) {
      const ox = -s.dz * 1.55 * side, oz = s.dx * 1.55 * side;
      if (distToRoute(x + ox, z + oz, GROUND_ROUTE) < 1.4) continue;
      stones.push(mk(x + ox + (rand() - 0.5) * 0.3, 0.02, z + oz + (rand() - 0.5) * 0.3, 0.2 + rand() * 0.12, rand() * 6, 0.12 + rand() * 0.08));
    }
  }
  group.add(instanced(new THREE.DodecahedronGeometry(1, 0), mat(0x8a8478, { flat: true }), stones));

  // Lanterns at path corners
  for (const p of GROUND_ROUTE.pts.slice(1, -1)) {
    for (const [ox, oz] of [[1.9, 1.9], [-1.9, -1.9]]) {
      const x = p.x + ox, z = p.z + oz;
      if (distToRoute(x, z) < 1.5) continue;
      const lantern = new THREE.Group();
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.6, 6), mat(0x2a2420, { metal: 0.5 }));
      post.position.y = 0.8; post.castShadow = true;
      const lamp = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), glow(0xffb05a, 3));
      lamp.position.y = 1.7;
      lantern.add(post, lamp);
      lantern.position.set(x, 0, z);
      group.add(lantern);
    }
  }
  return group;
}

function buildGate() {
  const g = new THREE.Group();
  const stone = mat(0x4a4652, { flat: true, rough: 0.9 });
  for (const s of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.1, 6, 1.1), stone);
    pillar.position.set(0, 3, s * 2.6); pillar.castShadow = true;
    g.add(pillar);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.9, 1.4, 4), stone);
    cap.position.set(0, 6.7, s * 2.6); cap.rotation.y = Math.PI / 4;
    g.add(cap);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.9, 6.4), stone);
  lintel.position.y = 6.2; lintel.castShadow = true;
  g.add(lintel);
  const vortexMat = riftMaterial(0xa050ff, 0xffb3ff);
  const vortex = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 5.6), vortexMat);
  vortex.rotation.y = Math.PI / 2;
  vortex.position.y = 2.9;
  g.add(vortex);
  g.position.set(SPAWN.x - 2.5, 0, SPAWN.z);
  g.userData.vortex = vortexMat;
  return g;
}

function buildNexus() {
  const g = new THREE.Group();
  const stone = mat(0x55515e, { flat: true, rough: 0.8 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.0, 0.6, 8), stone);
  base.position.y = 0.3; base.receiveShadow = true; base.castShadow = true;
  g.add(base);
  const step = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.3, 0.4, 8), stone);
  step.position.y = 0.8; g.add(step);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.45, 3.4, 0.45), stone);
    p.position.set(Math.cos(a) * 2.3, 1.9, Math.sin(a) * 2.3); p.castShadow = true;
    g.add(p);
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), glow(0x6fe0ff, 3));
    gem.position.set(Math.cos(a) * 2.3, 3.8, Math.sin(a) * 2.3);
    g.add(gem);
  }
  const crystalMat = new THREE.MeshStandardMaterial({ color: 0x9fe8ff, emissive: 0x2fa8ff, emissiveIntensity: 2.2, roughness: 0.1, metalness: 0.2, flatShading: true });
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(1.1, 0), crystalMat);
  crystal.scale.set(0.8, 1.6, 0.8);
  crystal.position.y = 3.6; crystal.castShadow = true;
  g.add(crystal);
  const ring1 = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.05, 6, 48), glow(0x6fe0ff, 2.5));
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(2.0, 0.04, 6, 48), glow(0xb08cff, 2.5));
  ring1.position.y = ring2.position.y = 3.6;
  g.add(ring1, ring2);
  const pillarMat = new THREE.MeshBasicMaterial({ color: 0x6fd8ff, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.0, 40, 16, 1, true), pillarMat);
  beam.position.y = 22;
  g.add(beam);
  g.position.set(PORTAL.x + 1.5, 0, PORTAL.z);
  g.userData = { crystal, crystalMat, ring1, ring2, beam, pillarMat, crystalY: 3.6 };
  return g;
}

// Ambient fireflies drifting over the plateau.
function buildFireflies(rand) {
  const N = 60;
  const pos = new Float32Array(N * 3), seed = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    pos.set([(rand() - 0.5) * HALF_X * 2.4, 0.5 + rand() * 3, (rand() - 0.5) * HALF_Z * 2.4], i * 3);
    seed[i] = rand() * 100;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uScale: { value: 1 } },
    vertexShader: `
      uniform float uTime; uniform float uScale; attribute float aSeed; varying float vA;
      void main(){
        vec3 p = position;
        p.x += sin(uTime*0.3 + aSeed) * 2.0; p.z += cos(uTime*0.25 + aSeed*1.3) * 2.0; p.y += sin(uTime*0.8 + aSeed*2.0) * 0.4;
        vec4 mv = modelViewMatrix * vec4(p,1.0);
        vA = 0.5 + 0.5 * sin(uTime * 2.0 + aSeed * 7.0);
        gl_PointSize = uScale * 26.0 / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d) * vA; gl_FragColor = vec4(vec3(1.0,0.85,0.4) * a * 1.5, a); }`,
  });
  return new THREE.Points(geo, material);
}

export default {
  id: 'isle',
  name: 'Twilight Isle',
  desc: 'The original green island in a lake, ringed by pine mountains.',
  lighting: {
    sunDir: SUN_DIR, sunColor: 0xffd2a0, sunIntensity: 2.6,
    hemiSky: 0x9fb8ff, hemiGround: 0x3a2a24, hemiIntensity: 0.75,
    fillColor: 0x8a9cff, fillIntensity: 0.6, fillDir: new THREE.Vector3(-40, 30, -40).normalize(),
    fogColor: FOG_COLOR, fogDensity: FOG_DENSITY, exposure: 1.05,
    gradeShadow: [0, 0, 0], gradeHighlight: [0.02, 0.005, -0.012],
    nexusFull: 0x2ea8ff, nexusLow: 0x2e001a,
  },
  terrainHeight,
  build(rand) {
    const terrain = buildTerrain();
    const water = buildWater();
    const sky = buildSky();
    const ribbon = buildPathRibbon(0x9a4dff, 0xff4033, 0.22);
    const airLane = buildAirLane(0x6fa8ff, 0.18);
    const decor = buildDecor(rand);
    const gate = buildGate();
    const nexus = buildNexus();
    const fireflies = buildFireflies(rand);
    return { objects: [terrain, water, sky, ribbon, airLane, decor, gate, nexus, fireflies], water, sky, ribbon, fireflies, gate, nexus };
  },
  update(env, T) {
    env.water.material.uniforms.uTime.value = T;
    env.sky.material.uniforms.uTime.value = T;
    env.ribbon.material.uniforms.uTime.value = T;
    env.fireflies.material.uniforms.uTime.value = T;
    env.gate.userData.vortex.uniforms.uTime.value = T;
  },
};
