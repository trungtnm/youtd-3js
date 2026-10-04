// Map theme: a snowy fortress valley at night. A walled snowfield with an icy
// flagstone road, snow-laden pine woods, frozen lakes with cracked ice, ice
// crystal outcrops and a ruined ice-and-stone wall, warm torches against cold
// moonlight, falling snow, stars, a large moon and a rippling aurora.

import * as THREE from 'three';
import { mat, glow } from '../models.js';
import {
  fbm, HALF_X, HALF_Z, distToRoute, outside, onEntryRoad, clearOfRoad as clearOf, nearTileCentre, mk, instanced,
  buildPathRibbon, buildAirLane, riftMaterial, GROUND_ROUTE, BLOCKED_TILES, SPAWN, PORTAL, tileToWorld,
} from './shared.js';

const WALL = 1.4;          // the perimeter wall stands this far outside the play rectangle
const ROAD_HALF = 1.25;    // half width of the road
// Moonlight comes from behind the field (as seen by the default camera) so
// shadows fall toward the viewer and the moon sits in the visible sky.
const MOON_DIR = new THREE.Vector3(-0.32, 0.62, -0.72).normalize();
const MOON_SKY = new THREE.Vector3(-0.3, 0.24, -0.92).normalize();
const FOG_COLOR = 0x18233f, FOG_DENSITY = 0.0042;
// Frozen lakes outside the wall: one behind the field, a small pond on the near side.
const LAKES = [{ x: 8, z: -HALF_Z - 21, r: 13 }, { x: -15, z: HALF_Z + 10, r: 6 }, { x: HALF_X + 18, z: 4, r: 8 }];
const ICE_Y = -0.35;

// Aurora curtains shared by the sky, the ice reflections and the low veil: a
// wavy lower edge at elevation `base`, vertical rays, green fading to violet upward.
const AURORA_GLSL = `
  float aHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float aNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(aHash(i), aHash(i+vec2(1,0)), f.x), mix(aHash(i+vec2(0,1)), aHash(i+vec2(1,1)), f.x), f.y); }
  vec3 curtain(float az, float y, float base, float k, float t, float decay){
    float edge = base + 0.035 * sin(az * 3.0 * k + t * 0.25) + 0.02 * sin(az * 7.0 - t * 0.4);
    float h = y - edge;
    if (h < 0.0) return vec3(0.0);
    float rays = 0.45 + 0.55 * aNoise(vec2(az * 40.0 * k + sin(az * 5.0 + t * 0.3) * 2.0, t * 0.35));
    float fold = 0.35 + 0.65 * aNoise(vec2(az * 6.0 * k - t * 0.08, t * 0.05));
    float a = smoothstep(0.0, 0.015, h) * exp(-h * decay) * rays * fold;
    return mix(vec3(0.15, 1.0, 0.55), vec3(0.55, 0.3, 1.0), smoothstep(0.02, 3.0 / decay, h)) * a;
  }`;

// 0..1, how deep inside a lake basin a point is.
function lakeFactor(x, z) {
  let f = 0;
  for (const l of LAKES) {
    const d = Math.hypot(x - l.x, z - l.z) + (fbm(x * 0.2, z * 0.2) - 0.5) * 3;
    f = Math.max(f, Math.min(1, Math.max(0, (l.r + 3 - d) / 3)));
  }
  return f;
}

function terrainHeight(x, z) {
  const o = outside(x, z);
  let h;
  if (o < 0) h = (fbm(x * 0.15, z * 0.15) - 0.5) * 0.16;                 // the snowfield
  else {
    const n = fbm(x * 0.05 + 3, z * 0.05);
    const near = z > HALF_Z ? 0.5 : 1;                                     // keep the camera side low
    const banks = Math.min(1, o / 10) * (0.9 + n * 3.2) * near;           // snow banks past the wall
    const peaks = o > 24 ? Math.pow((o - 24) / 40, 1.5) * 50 * fbm(x * 0.03 + 7, z * 0.03, 5) : 0; // mountains
    h = banks + peaks;
    const lf = lakeFactor(x, z);
    if (lf > 0) h = h + (-0.8 - h) * lf;
  }
  if (distToRoute(x, z, GROUND_ROUTE) < ROAD_HALF + 0.3 || onEntryRoad(x, z)) h = Math.min(h, -0.04);
  return h;
}

const clearOfRoad = (x, z, margin) => clearOf(x, z, margin, ROAD_HALF);
const inLake = (x, z, pad = 1.5) => LAKES.some((l) => Math.hypot(x - l.x, z - l.z) < l.r + pad);

// ------------------------------------------------------------------ terrain

// Snow everywhere, bluer in the hollows, packed and grey along the road, with
// rock showing on the mountains. A shader adds twinkling sparkle to the snow.
function buildTerrain() {
  const W = 260, D = 210, SX = 156, SZ = 126;
  const geo = new THREE.PlaneGeometry(W, D, SX, SZ);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  // Kept below pure white so moonlit snow does not trip the bloom threshold.
  const snowA = new THREE.Color(0x8c9cba), snowB = new THREE.Color(0xa0aec8), snowBlue = new THREE.Color(0x6e84ae);
  const packed = new THREE.Color(0x646e84), rock = new THREE.Color(0x4a4e5e), rockL = new THREE.Color(0x6a7082);
  const shore = new THREE.Color(0x58709a);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = terrainHeight(x, z);
    const n = fbm(x * 0.3, z * 0.3);
    const o = outside(x, z);
    // Drifts: soft bands of brighter and bluer snow.
    c.copy(snowA).lerp(snowB, n).lerp(snowBlue, Math.max(0, fbm(x * 0.07 + 3, z * 0.07) - 0.4) * 1.2);
    c.multiplyScalar(0.9 + fbm(x * 0.6, z * 0.6) * 0.18);
    if (o < WALL + 0.6) {
      const pd = distToRoute(x, z, GROUND_ROUTE);
      if (pd < ROAD_HALF + 1.0) c.lerp(packed, Math.min(1, (ROAD_HALF + 1.0 - pd) / 1.0) * 0.6);
    } else {
      const lf = lakeFactor(x, z);
      if (lf > 0) c.lerp(shore, lf * 0.7);
      // Wind-scoured rock on the steep mountain flanks.
      if (h > 7) c.lerp(rock, Math.min(0.75, (h - 7) / 8) * fbm(x * 0.12 + 5, z * 0.12)).lerp(rockL, n * 0.2);
    }
    if (onEntryRoad(x, z)) c.copy(packed);
    pos.setY(i, h);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const uniforms = { uTime: { value: 0 } };
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSnowP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSnowP = (modelMatrix * vec4(position, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSnowP; uniform float uTime;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          // Sparkle: rare cells glint briefly; the phase shifts with the view so it shimmers as the camera moves.
          vec2 cell = floor(vSnowP.xz * 7.0);
          float h = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
          vec2 f = fract(vSnowP.xz * 7.0) - 0.5;
          float spot = smoothstep(0.22, 0.0, length(f));
          float tw = pow(0.5 + 0.5 * sin(uTime * 2.5 + h * 300.0 + dot(cameraPosition.xz, vec2(0.7, 0.4))), 12.0);
          float snowy = smoothstep(0.25, 0.4, diffuseColor.b);
          totalEmissiveRadiance += vec3(0.75, 0.88, 1.0) * step(0.965, h) * spot * tw * snowy * 1.4;
        }`);
  };
  const m = new THREE.Mesh(geo, material);
  m.receiveShadow = true;
  m.userData.uniforms = uniforms;
  return m;
}

// Icy flagstone road: like the dusk road, stones in the road's distance field,
// but blue-grey with snow packed in the joints, frost creeping in from the edges
// and glossy ice patches.
function buildRoad() {
  const segs = GROUND_ROUTE.segs;
  const uniforms = {
    uA: { value: segs.map((s) => new THREE.Vector2(s.a.x, s.a.z)) },
    uB: { value: segs.map((s) => new THREE.Vector2(s.b.x, s.b.z)) },
    uHalf: { value: ROAD_HALF }, uSpawn: { value: new THREE.Vector2(SPAWN.x, SPAWN.z) }, uEdgeX: { value: -HALF_X },
  };
  const material = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vRoad;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRoad = (modelMatrix * vec4(position, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vRoad; float vIce;
        uniform vec2 uA[${segs.length}]; uniform vec2 uB[${segs.length}]; uniform float uHalf; uniform vec2 uSpawn; uniform float uEdgeX;
        vec2 rh2(vec2 p){ p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
        float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(rh2(i).x, rh2(i+vec2(1,0)).x, f.x), mix(rh2(i+vec2(0,1)).x, rh2(i+vec2(1,1)).x, f.x), f.y); }
        float segDist(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; float t = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * t); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vIce = 0.0;
        {
          vec2 p = vRoad;
          float d = 1e9;
          for (int i = 0; i < ${segs.length}; i++) d = min(d, segDist(p, uA[i], uB[i]));
          if (p.x < uEdgeX + 3.0 && p.x > uSpawn.x - 14.0) d = min(d, abs(p.y - uSpawn.y));
          vec2 q = p * 1.15; vec2 cell = floor(q); vec2 f = fract(q);
          float d1 = 8.0, d2 = 8.0; vec2 id = vec2(0.0);
          for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
            vec2 g = vec2(float(x), float(y)); vec2 o = rh2(cell + g) * 0.8 + 0.1;
            float dd = length(g + o - f);
            if (dd < d1) { d2 = d1; d1 = dd; id = cell + g; } else if (dd < d2) d2 = dd;
          }
          vec2 r = rh2(id);
          if (d + (r.x - 0.5) * 0.35 > uHalf) discard;
          float mortar = smoothstep(0.04, 0.12, d2 - d1);
          // Dark slate stones so the road reads clearly against the snow.
          vec3 stone = mix(vec3(0.26, 0.29, 0.36), vec3(0.4, 0.43, 0.5), r.x) * (0.85 + 0.25 * r.y);
          stone *= 0.88 + 0.12 * smoothstep(0.0, 0.5, d1);
          vec3 col = mix(vec3(0.52, 0.58, 0.7), stone, mortar);           // snow packed in the joints
          // Frost creeping in from the edges, thinner down the trodden middle.
          float frost = smoothstep(uHalf - 0.55, uHalf, d) * 0.55 + smoothstep(0.62, 0.8, vn(p * 2.3)) * 0.35;
          col = mix(col, vec3(0.55, 0.61, 0.72), clamp(frost, 0.0, 1.0) * mortar);
          // Glossy ice sheets over some stones.
          vIce = smoothstep(0.58, 0.72, vn(p * 0.45 + 7.0)) * smoothstep(uHalf, uHalf - 0.4, d);
          col = mix(col, vec3(0.3, 0.4, 0.52), vIce * 0.6);
          diffuseColor.rgb = pow(col, vec3(2.2));
        }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.4, vIce);');
  };
  const geo = new THREE.PlaneGeometry(HALF_X * 2 + 40, HALF_Z * 2 + 4);
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, material);
  m.position.y = 0.02;
  m.receiveShadow = true;
  return m;
}

// Night sky: deep blue gradient, stars, a large moon with a halo and green to
// violet aurora curtains rippling over the far side of the valley.
function buildSky() {
  const geo = new THREE.SphereGeometry(600, 48, 24);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uMoon: { value: MOON_SKY.clone() }, uTime: { value: 0 } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 uMoon; uniform float uTime; varying vec3 vDir;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
      float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ s += noise(p) * a; p *= 2.1; a *= 0.5; } return s; }
      ${AURORA_GLSL}
      void main(){
        float y = vDir.y;
        // Gradient: dusky blue horizon glow to a deep navy zenith.
        vec3 col = mix(vec3(0.1, 0.15, 0.3), vec3(0.04, 0.06, 0.16), smoothstep(0.0, 0.3, y));
        col = mix(col, vec3(0.012, 0.018, 0.06), smoothstep(0.25, 0.85, y));
        col = mix(col, vec3(0.07, 0.09, 0.17), smoothstep(0.0, -0.2, y));
        // Stars, denser and brighter higher up; a faint milky band.
        vec2 sp = floor(vDir.xz / max(y + 0.15, 0.08) * 140.0);
        float st = step(0.9965, hash(sp)) * smoothstep(0.04, 0.4, y);
        col += st * (0.55 + 0.45 * sin(uTime * 2.2 + hash(sp + 1.0) * 40.0)) * vec3(0.85, 0.9, 1.0);
        col += vec3(0.05, 0.06, 0.1) * smoothstep(0.55, 0.85, fbm(vDir.xz / max(y + 0.3, 0.1) * 3.0)) * smoothstep(0.1, 0.5, y);
        // Aurora: two curtains centred behind the field.
        float az = atan(vDir.x, -vDir.z);
        float mask = smoothstep(1.9, 0.6, abs(az));
        vec3 au = curtain(az, y, 0.09, 1.0, uTime, 7.0) + curtain(az + 1.3, y, 0.16, 1.4, uTime * 1.2 + 9.0, 7.0) * 0.7;
        col += au * mask * 0.85;
        // Moon: large pale disc with darker maria, a soft halo and a wide glow.
        float s = max(dot(vDir, uMoon), 0.0);
        col += vec3(0.4, 0.5, 0.8) * pow(s, 12.0) * 0.25 + vec3(0.7, 0.8, 1.0) * pow(s, 400.0) * 0.6;
        float disc = smoothstep(0.99905, 0.9992, s);
        if (disc > 0.0) {
          vec3 up = normalize(cross(cross(uMoon, vec3(0.0, 1.0, 0.0)), uMoon));
          vec3 side = normalize(cross(uMoon, up));
          vec2 mp = vec2(dot(vDir, side), dot(vDir, up)) * 60.0;
          float maria = smoothstep(0.45, 0.7, fbm(mp * 1.3 + 3.0));
          col = mix(col, vec3(1.0, 1.0, 0.96) * (1.0 - maria * 0.28), disc);
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  return new THREE.Mesh(geo, material);
}

// A low aurora veil hanging over the far lake. The game camera looks down too
// steeply to see much sky, so this curtain brings the aurora into view.
function buildAuroraVeil() {
  const geo = new THREE.PlaneGeometry(150, 1, 150, 1);
  geo.translate(5, 0.5, 0);
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      uniform float uTime; varying vec2 vP;
      void main(){
        vec3 p = position;
        vP = vec2(p.x, p.y);
        float h = mix(1.0, 15.0, p.y);
        // A slow ripple runs along the curtain; the top sways more than the hem.
        float z = -${(HALF_Z + 6.5).toFixed(1)} - 2.0 * sin(p.x * 0.045) + sin(p.x * 0.13 + uTime * 0.35) * (1.0 + p.y * 1.5);
        gl_Position = projectionMatrix * viewMatrix * vec4(p.x, h, z, 1.0);
      }`,
    fragmentShader: `
      uniform float uTime; varying vec2 vP;
      ${AURORA_GLSL}
      void main(){
        float v = vP.y, x = vP.x;
        float rays = 0.35 + 0.65 * aNoise(vec2(x * 0.7 + sin(x * 0.08 + uTime * 0.3) * 3.0, uTime * 0.4));
        float fold = smoothstep(0.25, 0.75, aNoise(vec2(x * 0.06 - uTime * 0.07, uTime * 0.04)));
        float ends = smoothstep(-70.0, -40.0, x) * smoothstep(80.0, 50.0, x);
        float a = smoothstep(0.0, 0.12, v) * exp(-v * 2.6) * rays * fold * ends;
        vec3 col = mix(vec3(0.15, 1.0, 0.55), vec3(0.6, 0.3, 1.0), smoothstep(0.15, 0.8, v));
        gl_FragColor = vec4(col * a * 1.1, a);
      }`,
  });
  const m = new THREE.Mesh(geo, material);
  m.frustumCulled = false;                                               // positions are set in the shader
  m.renderOrder = 2;
  return m;
}

// Frozen lake surface: pale ice with darker clear patches, white crack lines,
// a sky reflection at grazing angles and the moon's glint.
function buildIce() {
  const group = new THREE.Group();
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uMoon: { value: MOON_SKY.clone() }, uFogColor: { value: new THREE.Color(FOG_COLOR) }, uFogDensity: { value: FOG_DENSITY } },
    vertexShader: `varying vec3 vWorld; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `
      uniform float uTime; uniform vec3 uMoon; uniform vec3 uFogColor; uniform float uFogDensity; varying vec3 vWorld;
      ${AURORA_GLSL}
      vec2 rh2(vec2 p){ p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
      float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(rh2(i).x, rh2(i+vec2(1,0)).x, f.x), mix(rh2(i+vec2(0,1)).x, rh2(i+vec2(1,1)).x, f.x), f.y); }
      // Distance to the nearest crack: the border between Voronoi cells.
      float cracks(vec2 p){
        vec2 c = floor(p), f = fract(p); float d1 = 8.0, d2 = 8.0;
        for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
          vec2 g = vec2(float(x), float(y)); float dd = length(g + rh2(c + g) - f);
          if (dd < d1) { d2 = d1; d1 = dd; } else if (dd < d2) d2 = dd;
        }
        return d2 - d1;
      }
      void main(){
        vec2 p = vWorld.xz;
        vec3 V = normalize(cameraPosition - vWorld);
        float clear = smoothstep(0.3, 0.6, vn(p * 0.12));
        vec3 col = mix(vec3(0.34, 0.45, 0.58), vec3(0.1, 0.17, 0.29), clear);
        col *= 0.9 + 0.2 * vn(p * 1.3);
        // Two scales of cracks; the fine ones only show on the pale ice.
        float big = smoothstep(0.06, 0.0, cracks(p * 0.35 + vn(p * 0.5) * 0.6));
        float fine = smoothstep(0.05, 0.0, cracks(p * 1.2)) * (1.0 - clear * 0.7);
        col = mix(col, vec3(0.62, 0.72, 0.85), max(big, fine * 0.5));
        // Snow dusting toward the shore-free patches.
        col = mix(col, vec3(0.6, 0.67, 0.78), smoothstep(0.6, 0.8, vn(p * 0.3 + 11.0)) * 0.5);
        float fres = pow(1.0 - max(V.y, 0.0), 3.0);
        col = mix(col, vec3(0.3, 0.4, 0.62), fres * 0.5);
        col = pow(col, vec3(2.2));                                           // authored in sRGB, output linear
        vec3 H = normalize(uMoon + V);
        col += vec3(0.75, 0.85, 1.0) * pow(max(H.y, 0.0), 300.0) * 1.2 * (0.4 + clear);
        // The aurora mirrored in the ice: the camera looks down, so the reflected
        // ray climbs steeply and meets curtains set higher than the sky's.
        vec3 R = reflect(-V, normalize(vec3(vn(p * 2.0) - 0.5, 8.0, vn(p * 2.0 + 5.0) - 0.5)));
        float az = atan(R.x, -R.z);
        vec3 au = curtain(az * 1.6, R.y, 0.5, 1.0, uTime, 3.5) + curtain(az * 1.6 + 2.0, R.y, 0.62, 1.3, uTime * 1.1 + 4.0, 3.5) * 0.6;
        col += au * (0.12 + clear * 0.5) * (1.0 - big * 0.7);
        float d = length(vWorld - cameraPosition);
        float f = 1.0 - exp(-uFogDensity * uFogDensity * d * d);
        gl_FragColor = vec4(mix(col, uFogColor, f), 1.0);
      }`,
  });
  for (const l of LAKES) {
    const geo = new THREE.CircleGeometry(l.r + 3.5, 48);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, material);
    m.position.set(l.x, ICE_Y, l.z);
    m.receiveShadow = true;
    group.add(m);
  }
  group.userData.material = material;
  return group;
}

// ------------------------------------------------------------------ ruins and props

const STONE = 0x6a7080, STONE_D = 0x4e5464, SNOW = 0xb4c2da;
const iceMat = () => mat(0x9ad0ee, { rough: 0.15, metal: 0.1, emissive: 0x2a6a9a, ei: 0.3, flat: true, transparent: true, opacity: 0.82 });

// A ruined wall around the field: stone stretches capped with snow, some
// sections rebuilt in blocks of ice, breaches filled with snowy rubble.
function buildWalls(group, rand) {
  const blocks = [], iceBlocks = [], fallen = [], caps = [];
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
      if (n < 0.36) {
        if (rand() < 0.7) fallen.push(mk(x + (rand() - 0.5) * 2, 0.25, z + (rand() - 0.5) * 2, 0.5 + rand() * 0.4, rand() * 6, 0.35, 0.6, rand() * 0.4, rand() * 0.4));
        continue;
      }
      const near = z > HALF_Z ? 0.45 : 1;
      const hgt = (0.6 + (n - 0.36) * 6 + rand() * 0.9) * near;
      const ice = fbm(x * 0.09 - 7, z * 0.09 + 2) > 0.58;
      (ice ? iceBlocks : blocks).push(mk(x, hgt / 2, z, 0.9, ry, hgt, 1.62 + rand() * 0.1));
      // Snow settles on every stone top; ice is too slick to hold much.
      if (!ice) caps.push(mk(x, hgt + 0.06, z, 1.0, ry, 0.14, 1.66));
      if (rand() < 0.25) fallen.push(mk(x - dz * 1.4 * (rand() < 0.5 ? 1 : -1), 0.2, z + dx * 1.4, 0.6, rand() * 6, 0.4, 0.7, rand() * 0.5, rand() * 0.5));
    }
  }
  const box = new THREE.BoxGeometry(1, 1, 1);
  group.add(instanced(box, mat(STONE, { flat: true, rough: 0.95 }), blocks));
  group.add(instanced(box, iceMat(), iceBlocks));
  group.add(instanced(box, mat(SNOW, { flat: true, rough: 1 }), caps, { cast: false }));
  group.add(instanced(new THREE.DodecahedronGeometry(1, 0), mat(0x5a6278, { flat: true }), fallen));
}

// Snow-laden pines: dark tiers each topped with a snow cap. Thick on the far
// sides, kept well back on the camera side.
function buildPines(group, rand) {
  const trunks = [], tiers = [], tierCol = [], caps = [];
  const palette = [0x1e3a34, 0x24443a, 0x1a3230, 0x2a4a44].map((c) => new THREE.Color(c));
  for (let i = 0; i < 1400 && trunks.length < 320; i++) {
    const x = (rand() - 0.5) * 230, z = (rand() - 0.5) * 190;
    const o = outside(x, z);
    if (o < (z > HALF_Z ? WALL + 13 : WALL + 2.5) || o > 36 || onEntryRoad(x, z) || inLake(x, z, 2)) continue;
    const h = terrainHeight(x, z);
    if (h > 14) continue;
    if (fbm(x * 0.06 + 20, z * 0.06) < 0.42) continue;                    // woods grow in clumps
    const s = 0.8 + rand() * 1.0;
    trunks.push(mk(x, h + 0.5 * s, z, s, rand() * 6));
    const col = palette[Math.floor(rand() * palette.length)];
    for (let k = 0; k < 3; k++) {
      const r = (1.25 - k * 0.32) * s, y = h + (1.2 + k * 1.05) * s, ry = rand() * 6;
      tiers.push(mk(x, y, z, r, ry, 1.5 * s, r));
      tierCol.push(col);
      caps.push(mk(x, y + 0.42 * s, z, r * 0.8, ry, 0.75 * s, r * 0.8));
    }
  }
  group.add(instanced(new THREE.CylinderGeometry(0.14, 0.22, 1, 6), mat(0x3a2a22, { flat: true }), trunks, { cast: false }));
  group.add(instanced(new THREE.ConeGeometry(1, 1, 7), mat(0xffffff, { flat: true, rough: 0.9 }), tiers, { cast: false, colors: tierCol }));
  group.add(instanced(new THREE.ConeGeometry(1, 1, 7), mat(SNOW, { flat: true, rough: 0.95 }), caps, { cast: false }));
}

// Clusters of tall ice crystals beyond the wall, plus small shards in the
// field corners. They glow faintly so they catch the bloom.
function buildCrystals(group, rand) {
  const shards = [];
  const cluster = (cx, cz, size, n) => {
    const y = terrainHeight(cx, cz);
    for (let k = 0; k < n; k++) {
      const a = rand() * 6, r = k === 0 ? 0 : (0.3 + rand() * 0.8) * size;
      const hgt = (k === 0 ? 1 : 0.4 + rand() * 0.5) * size * 2.2;
      shards.push(mk(cx + Math.cos(a) * r, y + hgt * 0.35, cz + Math.sin(a) * r, 0.22 * size, rand() * 6, hgt, 0.22 * size, (rand() - 0.5) * 0.7, (rand() - 0.5) * 0.7));
    }
  };
  for (let i = 0; i < 160; i++) {
    const x = (rand() - 0.5) * 140, z = (rand() - 0.5) * 110;
    const o = outside(x, z);
    if (o < WALL + 2 || o > 30 || onEntryRoad(x, z)) continue;
    const near = z > HALF_Z;
    cluster(x, z, near ? 0.6 + rand() * 0.4 : 0.8 + rand() * 1.6, 3 + Math.floor(rand() * 4));
  }
  // Crystal heaps on the blocked corner tiles.
  for (const key of BLOCKED_TILES) {
    const [c, r] = key.split(',').map(Number);
    const p = tileToWorld(c, r);
    cluster(p.x + (rand() - 0.5) * 0.6, p.z + (rand() - 0.5) * 0.6, 0.45 + rand() * 0.2, 4);
  }
  group.add(instanced(new THREE.OctahedronGeometry(1, 0), iceMat(), shards));
}

// Small field decor kept off the road and tile centres: snow mounds, snowy
// rocks, ice shards and frozen grass; plus low drifts and boulders past the wall.
function buildFieldDecor(group, rand) {
  const mounds = [], rocks = [], rockCaps = [], shards = [], tufts = [];
  for (let i = 0; i < 260; i++) {
    const x = (rand() - 0.5) * (HALF_X * 2), z = (rand() - 0.5) * (HALF_Z * 2);
    if (!clearOfRoad(x, z, 0.5) || nearTileCentre(x, z)) continue;
    const y = terrainHeight(x, z);
    const roll = rand();
    if (roll < 0.35) mounds.push(mk(x, y, z, 0.25 + rand() * 0.3, rand() * 6, 0.1 + rand() * 0.08));
    else if (roll < 0.55) {
      const s = 0.14 + rand() * 0.16;
      rocks.push(mk(x, y + s * 0.4, z, s, rand() * 6, s * 0.8));
      rockCaps.push(mk(x, y + s * 0.95, z, s * 0.85, rand() * 6, s * 0.3));
    } else if (roll < 0.7) shards.push(mk(x, y + 0.1, z, 0.06, rand() * 6, 0.25 + rand() * 0.15, 0.06, (rand() - 0.5) * 0.6, (rand() - 0.5) * 0.6));
    else { const s = 0.2 + rand() * 0.25; tufts.push(mk(x, y, z, s, rand() * 6, s * (1 + rand()), s, (rand() - 0.5) * 0.4)); }
  }
  // Past the wall: drifts, snowy boulders and frozen grass, low enough to never hide the field.
  const drifts = [], boulders = [], bCaps = [];
  for (let i = 0; i < 1600; i++) {
    const x = (rand() - 0.5) * 150, z = (rand() - 0.5) * 120;
    const o = outside(x, z);
    if (o < WALL + 1.2 || o > 40 || onEntryRoad(x, z) || inLake(x, z, 0.5)) continue;
    const y = terrainHeight(x, z);
    const roll = rand();
    if (roll < 0.35) drifts.push(mk(x, y, z, 0.6 + rand() * 1.2, rand() * 6, 0.18 + rand() * 0.25, 0.4 + rand() * 0.6));
    else if (roll < 0.45) {
      const s = 0.4 + rand() * 0.8;
      boulders.push(mk(x, y + s * 0.3, z, s, rand() * 6, s * 0.7));
      bCaps.push(mk(x, y + s * 0.78, z, s * 0.8, rand() * 6, s * 0.25));
    } else { const s = 0.25 + rand() * 0.35; tufts.push(mk(x, y, z, s, rand() * 6, s * (1 + rand()), s, (rand() - 0.5) * 0.4)); }
  }
  const ico = new THREE.IcosahedronGeometry(1, 0), dod = new THREE.DodecahedronGeometry(1, 0);
  const snow = mat(SNOW, { flat: true, rough: 1 });
  group.add(instanced(ico, snow, mounds, { cast: false }));
  group.add(instanced(ico, snow, drifts, { cast: false }));
  group.add(instanced(dod, mat(0x50566a, { flat: true, rough: 0.95 }), rocks, { cast: false }));
  group.add(instanced(dod, mat(0x50566a, { flat: true, rough: 0.95 }), boulders, { cast: false }));
  group.add(instanced(dod, snow, rockCaps, { cast: false }));
  group.add(instanced(dod, snow, bCaps, { cast: false }));
  group.add(instanced(new THREE.OctahedronGeometry(1, 0), iceMat(), shards, { cast: false }));
  const tuftGeo = new THREE.ConeGeometry(0.1, 0.6, 3);
  tuftGeo.translate(0, 0.3, 0);
  group.add(instanced(tuftGeo, mat(0x8a8a78, { flat: true, rough: 1 }), tufts, { cast: false }));
}

// Braziers at the road's corners and by the gate and portal: iron bowls with
// warm flames for contrast against the moonlight. Half carry point lights.
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
  const stand = mat(0x2e2c30, { metal: 0.5, rough: 0.55 });
  const bowl = mat(0x4a4448, { metal: 0.55, rough: 0.5 });
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
  spots.forEach(([x, z], i) => {
    const g = new THREE.Group();
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 1.3, 6), stand);
    post.position.y = 0.65; post.castShadow = true;
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.25, 0.35, 8), bowl);
    cup.position.y = 1.45; cup.castShadow = true;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.06, 4, 10), mat(SNOW, { flat: true }));
    rim.rotation.x = Math.PI / 2; rim.position.y = 1.62;
    const coals = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.05, 8), glow(0xff5a1a, 3));
    coals.position.y = 1.6;
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.9, 6), flameMat);
    flame.position.y = 2.0;
    const core = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.55, 5), glow(0xffe08a, 4));
    core.position.y = 1.85;
    g.add(post, cup, rim, coals, flame, core);
    if (i % 2 === 0) {
      const light = new THREE.PointLight(0xff8a3a, 14, 11, 1.4);
      light.position.y = 2.1;
      g.add(light);
      flames.push({ flame, core, light, seed: i * 1.7 });
    } else flames.push({ flame, core, seed: i * 1.7 });
    g.position.set(x, terrainHeight(x, z), z);
    group.add(g);
  });
  return flames;
}

// A ruined watchtower stump outside a corner: snow on top, icicles under the rim.
function watchtower(group, x, z, s) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.8, 4.5, 8), mat(STONE, { flat: true, rough: 0.9 }));
  body.position.y = 2.25; body.castShadow = true; body.receiveShadow = true;
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.6, 0.5, 8), mat(STONE_D, { flat: true }));
  rim.position.y = 4.7; rim.castShadow = true;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.85, 0.3, 8), mat(SNOW, { flat: true, rough: 1 }));
  cap.position.y = 5.05;
  g.add(body, rim, cap);
  addIcicles(g, 8, (k) => { const a = (k / 8) * Math.PI * 2 + 0.2; return [Math.cos(a) * 1.75, 4.45, Math.sin(a) * 1.75]; }, 0.5);
  g.position.set(x, terrainHeight(x, z), z); g.scale.setScalar(s);
  group.add(g);
}

// Downward ice cones at the positions given by `at(k)`.
function addIcicles(parent, n, at, len) {
  const geo = new THREE.ConeGeometry(0.09, 1, 5);
  geo.rotateX(Math.PI);
  const m = iceMat();
  for (let k = 0; k < n; k++) {
    const [x, y, z] = at(k);
    const l = len * (0.5 + ((k * 7) % 5) / 5);
    const c = new THREE.Mesh(geo, m);
    c.scale.set(1, l, 1);
    c.position.set(x, y - l / 2, z);
    parent.add(c);
  }
}

function buildDecor(rand) {
  const group = new THREE.Group();
  buildWalls(group, rand);
  watchtower(group, -HALF_X - 7, -HALF_Z - 6, 1.0);
  watchtower(group, HALF_X + 8, -HALF_Z - 7, 1.2);
  watchtower(group, HALF_X + 7, HALF_Z + 8, 0.55);                       // near side: stays low
  buildPines(group, rand);
  buildCrystals(group, rand);
  buildFieldDecor(group, rand);
  const braziers = buildBraziers(group);
  return { group, braziers };
}

// The spawn gate: an ice-crusted gatehouse with icicles under the lintel and
// a cold blue-white rift between its towers.
function buildGate() {
  const g = new THREE.Group();
  const stone = mat(0x565c6c, { flat: true, rough: 0.9 });
  const trim = mat(0x3a4050, { flat: true });
  const snow = mat(SNOW, { flat: true, rough: 1 });
  const ice = iceMat();
  for (const s of [-1, 1]) {
    const tower = new THREE.Mesh(new THREE.BoxGeometry(2.0, 8, 2.0), stone);
    tower.position.set(0, 4, s * 3.2); tower.castShadow = true;
    g.add(tower);
    // Ice crust climbing the inner face of each tower.
    const crust = new THREE.Mesh(new THREE.BoxGeometry(2.1, 4.5, 0.35), ice);
    crust.position.set(0, 2.25, s * 2.15); crust.rotation.z = s * 0.04;
    g.add(crust);
    const crown = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.5, 2.4), trim);
    crown.position.set(0, 8.2, s * 3.2); g.add(crown);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(2.45, 0.18, 2.45), snow);
    cap.position.set(0, 8.52, s * 3.2); g.add(cap);
    for (const [ox, oz] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) {
      if (s === 1 && ox > 0 && oz > 0) continue;
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.5), trim);
      m.position.set(ox, 8.95, s * 3.2 + oz); g.add(m);
    }
    // Tall ice spikes flanking the gate.
    const spike = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0), ice);
    spike.scale.set(0.45, 2.6, 0.45); spike.position.set(1.4, 1.6, s * 4.6); spike.rotation.set(s * 0.25, 0, -0.2);
    g.add(spike);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.2, 4.6), stone);
  lintel.position.y = 6.9; lintel.castShadow = true;
  const lcap = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.2, 4.7), snow);
  lcap.position.y = 7.6;
  g.add(lintel, lcap);
  addIcicles(g, 9, (k) => [((k * 3) % 3 - 1) * 0.6, 6.3, -2.0 + k * 0.5], 1.1);
  const vortexMat = riftMaterial(0x3a8aff, 0xeaf6ff);
  const vortex = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 6.0), vortexMat);
  vortex.rotation.y = Math.PI / 2;
  vortex.position.y = 3.1;
  g.add(vortex);
  const light = new THREE.PointLight(0x7ab8ff, 8, 12, 1.6);
  light.position.set(2, 3, 0);
  g.add(light);
  g.position.set(SPAWN.x - 2.5, 0, SPAWN.z);
  g.userData.vortex = vortexMat;
  return g;
}

// The portal: a snowy stepped shrine ringed by ice pillars around a floating
// ice-blue crystal.
function buildNexus() {
  const g = new THREE.Group();
  const stone = mat(0x5e6474, { flat: true, rough: 0.8 });
  const dark = mat(0x444a5a, { flat: true, rough: 0.85 });
  const snow = mat(SNOW, { flat: true, rough: 1 });
  const ice = iceMat();
  const steps = [[3.2, 3.5, 0.4, stone], [2.6, 2.9, 0.4, dark], [2.0, 2.3, 0.35, stone]];
  let y = 0;
  for (const [rt, rb, h, m] of steps) {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 8), m);
    s.position.y = y + h / 2; s.castShadow = true; s.receiveShadow = true;
    g.add(s);
    // A thin ring of snow on the outer edge of each step.
    const drift = new THREE.Mesh(new THREE.CylinderGeometry(rt + 0.02, rt + 0.02, 0.06, 8, 1, true), snow);
    drift.position.y = y + h + 0.01;
    g.add(drift);
    y += h;
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const h = i % 3 === 2 ? 2.2 : 4.4;
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.34, h, 6), ice);
    p.position.set(Math.cos(a) * 2.7, y + h / 2 - 0.4, Math.sin(a) * 2.7); p.castShadow = true;
    g.add(p);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.6, 6), ice);
    tip.position.set(Math.cos(a) * 2.7, y + h - 0.1, Math.sin(a) * 2.7);
    g.add(tip);
    if (h > 3) {
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.18, 0), glow(0x8ae0ff, 3));
      gem.position.set(Math.cos(a) * 2.7, y + h + 0.35, Math.sin(a) * 2.7);
      g.add(gem);
    }
  }
  const crystalMat = new THREE.MeshStandardMaterial({ color: 0xd8f4ff, emissive: 0x3ab8ff, emissiveIntensity: 2.0, roughness: 0.1, metalness: 0.2, flatShading: true });
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(1.1, 0), crystalMat);
  crystal.scale.set(0.8, 1.6, 0.8);
  crystal.position.y = 3.9; crystal.castShadow = true;
  g.add(crystal);
  const ring1 = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.05, 6, 48), glow(0x9ae6ff, 2.5));
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(2.0, 0.04, 6, 48), glow(0x6a9aff, 2.5));
  ring1.position.y = ring2.position.y = 3.9;
  g.add(ring1, ring2);
  const pillarMat = new THREE.MeshBasicMaterial({ color: 0x9ad8ff, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.0, 40, 16, 1, true), pillarMat);
  beam.position.y = 22;
  g.add(beam);
  const light = new THREE.PointLight(0x7ac8ff, 10, 14, 1.5);
  light.position.y = 4;
  g.add(light);
  g.position.set(PORTAL.x + 1.5, 0, PORTAL.z);
  g.userData = { crystal, crystalMat, ring1, ring2, beam, pillarMat, crystalY: 3.9 };
  return g;
}

// Falling snow: soft flakes drifting down and sideways, wrapped in a box over the field.
function buildSnowfall(rand) {
  const N = 420, H = 14;
  const pos = new Float32Array(N * 3), seed = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    pos.set([(rand() - 0.5) * (HALF_X * 2 + 30), rand() * H, (rand() - 0.5) * (HALF_Z * 2 + 24)], i * 3);
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
        vec3 p = position;
        float sp = 0.6 + fract(aSeed * 1.7) * 0.6;
        p.y = mod(position.y - uTime * sp, ${H}.0);
        float wx = 76.0;
        p.x = mod(position.x + uTime * 0.35 + sin(uTime * 0.7 + aSeed) * 0.8 + wx * 0.5, wx) - wx * 0.5;
        p.z += cos(uTime * 0.5 + aSeed * 1.3) * 0.6;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vA = smoothstep(${H}.0, ${H - 3}.0, p.y) * smoothstep(0.0, 0.8, p.y) * (0.55 + 0.45 * fract(aSeed * 3.1));
        gl_PointSize = (160.0 + fract(aSeed * 5.3) * 120.0) / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `varying float vA;
      void main(){
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.1, d) * vA * 0.8;
        gl_FragColor = vec4(vec3(0.82, 0.88, 1.0), a);
      }`,
  });
  return new THREE.Points(geo, material);
}

// Low drifting snow haze: very thin over the field, thicker past the wall.
function buildGroundMist() {
  const geo = new THREE.PlaneGeometry(320, 260);
  geo.rotateX(-Math.PI / 2);
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: { uTime: { value: 0 }, uHalf: { value: new THREE.Vector2(HALF_X + WALL, HALF_Z + WALL) }, uColor: { value: new THREE.Color(0x8ea2c8) } },
    vertexShader: `varying vec3 vWorld; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `
      uniform float uTime; uniform vec2 uHalf; uniform vec3 uColor; varying vec3 vWorld;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
      void main(){
        vec2 p = vWorld.xz;
        float n = noise(p * 0.06 + vec2(uTime * 0.05, uTime * 0.01)) * 0.6 + noise(p * 0.15 - vec2(uTime * 0.08, 0.0)) * 0.4;
        float out_ = length(max(abs(p) - uHalf, 0.0));
        float a = mix(0.02, 0.35, smoothstep(2.0, 18.0, out_)) * smoothstep(0.3, 0.75, n);
        a *= smoothstep(170.0, 90.0, length(p));
        gl_FragColor = vec4(uColor, a);
      }`,
  });
  const m = new THREE.Mesh(geo, material);
  m.position.y = 0.6;
  m.renderOrder = 3;
  return m;
}

export default {
  id: 'frost',
  name: 'Frozen Night',
  desc: 'A snowbound fortress valley under the moon and a rippling aurora.',
  lighting: {
    sunDir: MOON_DIR, sunColor: 0x9cb6ff, sunIntensity: 1.5,
    hemiSky: 0x4a5c90, hemiGround: 0x20263a, hemiIntensity: 0.7,
    fillColor: 0x7a88c0, fillIntensity: 0.4, fillDir: new THREE.Vector3(-20, 35, 50).normalize(),
    fogColor: FOG_COLOR, fogDensity: FOG_DENSITY, exposure: 1.05,
    gradeShadow: [0.0, 0.006, 0.03], gradeHighlight: [-0.008, 0.004, 0.02],
    nexusFull: 0x3ab8ff, nexusLow: 0x1a2a8a,
  },
  terrainHeight,
  build(rand) {
    const terrain = buildTerrain();
    const road = buildRoad();
    const sky = buildSky();
    const ice = buildIce();
    const veil = buildAuroraVeil();
    const ribbon = buildPathRibbon(0x9ae0ff, 0xb48aff, 0.18);
    const airLane = buildAirLane(0xbfe0ff, 0.14);
    const { group: decor, braziers } = buildDecor(rand);
    const gate = buildGate();
    const nexus = buildNexus();
    const snow = buildSnowfall(rand);
    const mist = buildGroundMist();
    return { objects: [terrain, road, sky, ice, veil, ribbon, airLane, decor, gate, nexus, snow, mist], terrain, sky, ice, veil, ribbon, braziers, gate, nexus, snow, mist };
  },
  update(env, T) {
    env.terrain.userData.uniforms.uTime.value = T;
    env.sky.material.uniforms.uTime.value = T;
    env.ice.userData.material.uniforms.uTime.value = T;
    env.veil.material.uniforms.uTime.value = T;
    env.ribbon.material.uniforms.uTime.value = T;
    env.snow.material.uniforms.uTime.value = T;
    env.mist.material.uniforms.uTime.value = T;
    env.gate.userData.vortex.uniforms.uTime.value = T;
    for (const b of env.braziers) {
      const f = 1 + Math.sin(T * 13 + b.seed) * 0.12 + Math.sin(T * 23 + b.seed * 2) * 0.08;
      b.flame.scale.set(1, f, 1);
      b.core.scale.set(1, 2 - f, 1);
      if (b.light) b.light.intensity = 14 * (0.85 + (f - 1) * 1.5);
    }
  },
};
