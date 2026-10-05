// Draws creeps that use a curated model as one instanced mesh per model and
// material, instead of a cloned skeleton, mixer and mesh tree per creep.
//
// Each model's move clip is baked once: every vertex (skinned or carried by a bone)
// is posed on the CPU at BAKE_FPS and written to half-float textures, positions in
// one and normals in another. The patched materials read the two frames around
// the creep's clip time and blend them. Per-instance data is the instance matrix
// (taken from an empty anchor in the creep's transform tree, so knockback, squash,
// yaw, flight bob and death topple keep working) and [clip frame, hit flash].
// Unseen creeps draw through an additive ghost layer; gilded creeps through a gold one.
import * as THREE from 'three';

const BAKE_FPS = 30;
const HEAVY_VERTS = 10000; // heavier models bake at half rate to halve texture memory
const MAX_FRAMES = 64;
const TEX_W = 2048;
const CAPACITY = 1024; // instances per layer; beyond this a model's extra creeps are not drawn
const FLASH = new THREE.Color(1.6, 1.5, 1.4); // matches the world's hit-flash material

const half = THREE.DataUtils.toHalfFloat;
const noRaycast = () => {};

// ---------------------------------------------------------------- shader patch

const VAT_VERTEX_HEAD = /* glsl */`
uniform highp sampler2D uVatPos;
uniform highp sampler2D uVatNrm;
uniform int uVatW;
uniform int uVatV;
uniform int uVatF;
attribute float aVid;
attribute vec2 aVat;
varying float vFlash;
vec3 vatFetch(highp sampler2D t, int f) {
  int i = f * uVatV + int(aVid + 0.5);
  return texelFetch(t, ivec2(i % uVatW, i / uVatW), 0).xyz;
}
void vatFrames(out int f0, out int f1, out float fa) {
  float vf = mod(aVat.x, float(uVatF));
  f0 = int(floor(vf));
  f1 = (f0 + 1) % uVatF;
  fa = fract(vf);
}
`;

function patch(material, vat, { flash = true } = {}) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, vat.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VAT_VERTEX_HEAD}`)
      .replace('#include <beginnormal_vertex>', `
        int vf0, vf1; float vfa; vatFrames(vf0, vf1, vfa);
        vec3 objectNormal = normalize(mix(vatFetch(uVatNrm, vf0), vatFetch(uVatNrm, vf1), vfa));
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3(tangent.xyz);
        #endif`)
      .replace('#include <begin_vertex>', `
        int vp0, vp1; float vpa; vatFrames(vp0, vp1, vpa);
        vec3 transformed = mix(vatFetch(uVatPos, vp0), vatFetch(uVatPos, vp1), vpa);
        vFlash = aVat.y;`);
    if (flash) {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vFlash;')
        .replace('#include <tonemapping_fragment>', `gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(${FLASH.r}, ${FLASH.g}, ${FLASH.b}), vFlash);\n#include <tonemapping_fragment>`);
    }
  };
  material.customProgramCacheKey = () => `vat${flash ? 'f' : ''}`;
  return material;
}

// ---------------------------------------------------------------- baking

// Poses every mesh under `root` for each frame of `clip` and returns the vertex
// textures plus one geometry per material (sharing a vertex id attribute).
function bake(root, model, clip) {
  root.position.set(0, 0, 0);
  root.rotation.set(0, 0, 0);
  root.scale.setScalar(1);
  const parts = [];
  root.traverseVisible((o) => { if (o.isMesh && !Array.isArray(o.material)) parts.push(o); });
  const V = parts.reduce((n, p) => n + p.geometry.attributes.position.count, 0);
  const dur = clip ? Math.max(clip.duration, 1e-3) : 1;
  const fps = V > HEAVY_VERTS ? BAKE_FPS / 2 : BAKE_FPS;
  const F = clip ? Math.max(1, Math.min(MAX_FRAMES, Math.round(dur * fps))) : 1;
  const H = Math.ceil((F * V) / TEX_W);
  const pos = new Uint16Array(TEX_W * H * 4);
  const nrm = new Uint16Array(TEX_W * H * 4);
  const mixer = clip ? new THREE.AnimationMixer(model) : null;
  if (mixer) mixer.clipAction(clip).play();

  const p = new THREE.Vector3(), n = new THREE.Vector3(), m = new THREE.Matrix4(), nm = new THREE.Matrix3();
  const boneM = [];
  for (let f = 0; f < F; f++) {
    if (mixer) mixer.setTime((f / F) * dur);
    root.updateMatrixWorld(true);
    let base = 0;
    for (const part of parts) {
      const geo = part.geometry, P = geo.attributes.position, N = geo.attributes.normal;
      const count = P.count;
      if (part.isSkinnedMesh) {
        // Per bone: world * bindInverse * bone * boneInverse * bind, so each vertex is a weighted sum.
        const sk = part.skeleton;
        const pre = new THREE.Matrix4().multiplyMatrices(part.matrixWorld, part.bindMatrixInverse);
        sk.bones.forEach((b, i) => {
          boneM[i] ??= new THREE.Matrix4();
          boneM[i].multiplyMatrices(b.matrixWorld, sk.boneInverses[i]).premultiply(pre).multiply(part.bindMatrix);
        });
        const SI = geo.attributes.skinIndex, SW = geo.attributes.skinWeight;
        for (let v = 0; v < count; v++) {
          const e = m.elements;
          e.fill(0);
          for (let k = 0; k < 4; k++) {
            const w = SW.getComponent(v, k);
            if (!w) continue;
            const be = boneM[SI.getComponent(v, k)].elements;
            for (let j = 0; j < 16; j++) e[j] += be[j] * w;
          }
          p.fromBufferAttribute(P, v).applyMatrix4(m);
          n.set(0, 1, 0);
          if (N) n.fromBufferAttribute(N, v).applyMatrix3(nm.setFromMatrix4(m)).normalize();
          write(f * V + base + v);
        }
      } else {
        nm.getNormalMatrix(part.matrixWorld);
        for (let v = 0; v < count; v++) {
          p.fromBufferAttribute(P, v).applyMatrix4(part.matrixWorld);
          n.set(0, 1, 0);
          if (N) n.fromBufferAttribute(N, v).applyMatrix3(nm).normalize();
          write(f * V + base + v);
        }
      }
      base += count;
    }
  }
  function write(i) {
    const o = i * 4;
    pos[o] = half(p.x); pos[o + 1] = half(p.y); pos[o + 2] = half(p.z);
    nrm[o] = half(n.x); nrm[o + 1] = half(n.y); nrm[o + 2] = half(n.z);
  }
  const tex = (data) => {
    const t = new THREE.DataTexture(data, TEX_W, H, THREE.RGBAFormat, THREE.HalfFloatType);
    t.minFilter = t.magFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  };

  // One geometry per material: the part's own attributes (uv, colour, ...) plus the
  // vertex id into the textures. Position and normal hold frame 0 for bounds only.
  const groups = new Map();
  let base = 0;
  for (const part of parts) {
    const src = part.geometry;
    const count = src.attributes.position.count;
    const geo = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(src.attributes)) {
      if (name === 'skinIndex' || name === 'skinWeight') continue;
      geo.setAttribute(name, attr.clone());
    }
    const vid = new Float32Array(count);
    for (let v = 0; v < count; v++) vid[v] = base + v;
    geo.setAttribute('aVid', new THREE.BufferAttribute(vid, 1));
    // Source positions may be quantized (normalized ints), so frame 0 gets a float attribute.
    const p0 = new Float32Array(count * 3);
    for (let v = 0; v < count; v++) for (let c = 0; c < 3; c++) p0[v * 3 + c] = THREE.DataUtils.fromHalfFloat(pos[(base + v) * 4 + c]);
    geo.setAttribute('position', new THREE.BufferAttribute(p0, 3));
    geo.setIndex(src.index ? src.index.clone() : [...Array(count).keys()]);
    const key = `${part.material.uuid}|${Object.keys(geo.attributes).sort().join(',')}`;
    if (!groups.has(key)) groups.set(key, { material: part.material, geos: [] });
    groups.get(key).geos.push(geo);
    base += count;
  }
  const merged = [...groups.values()].map((g) => ({ material: g.material, geometry: mergeIndexed(g.geos) }));
  return { posTex: tex(pos), nrmTex: tex(nrm), V, F, dur, groups: merged };
}

// Concatenates indexed geometries with identical attribute sets.
function mergeIndexed(geos) {
  if (geos.length === 1) return geos[0];
  const out = new THREE.BufferGeometry();
  for (const name of Object.keys(geos[0].attributes)) {
    const a0 = geos[0].attributes[name];
    const total = geos.reduce((n, g) => n + g.attributes[name].count, 0);
    const arr = new Float32Array(total * a0.itemSize);
    let o = 0;
    for (const g of geos) {
      const a = g.attributes[name];
      for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) arr[o++] = a.getComponent(i, c);
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, a0.itemSize, false));
  }
  const idx = [];
  let off = 0;
  for (const g of geos) {
    for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + off);
    off += g.attributes.position.count;
  }
  out.setIndex(idx);
  return out;
}

// ---------------------------------------------------------------- crowd

export class CreepCrowd {
  constructor(scene, ghostMaterial, goldMaterial) {
    this.scene = scene;
    this.ghostMaterial = ghostMaterial;
    this.goldMaterial = goldMaterial;
    this.models = new Map();
    this.shadows = true;
  }

  get(key) { return this.models.get(key); }

  // Bakes a model once. `inst` is a fitted clone ({ root, model, height }) that the
  // bake consumes; `clip` is the move clip (or null for a static model).
  add(key, inst, clip) {
    const t0 = performance.now();
    const b = bake(inst.root, inst.model, clip);
    const vat = {
      uniforms: {
        uVatPos: { value: b.posTex }, uVatNrm: { value: b.nrmTex },
        uVatW: { value: TEX_W }, uVatV: { value: b.V }, uVatF: { value: b.F },
      },
    };
    const model = { key, vat, groups: b.groups, frames: b.F, fps: b.F / b.dur, dur: b.dur, height: inst.height, layers: {} };
    model.layers.normal = this._layer(model, (m) => m.clone(), true);
    this.models.set(key, model);
    model.bakeMs = Math.round(performance.now() - t0);
    model.texBytes = (b.posTex.image.data.byteLength + b.nrmTex.image.data.byteLength);
    return model;
  }

  // A set of instanced meshes (one per material group) sharing instance data.
  _layer(model, makeMaterial, solid) {
    const matrix = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 16), 16).setUsage(THREE.DynamicDrawUsage);
    const vatAttr = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 2), 2).setUsage(THREE.DynamicDrawUsage);
    const meshes = model.groups.map((g) => {
      const geo = new THREE.BufferGeometry();
      for (const [name, attr] of Object.entries(g.geometry.attributes)) geo.setAttribute(name, attr);
      geo.setIndex(g.geometry.index);
      geo.setAttribute('aVat', vatAttr);
      const material = patch(makeMaterial(g.material), model.vat, { flash: solid });
      const mesh = new THREE.InstancedMesh(geo, material, 0); // shares the layer's matrix buffer below
      mesh.instanceMatrix = matrix;
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.raycast = noRaycast;
      mesh.receiveShadow = solid;
      mesh.castShadow = solid && this.shadows;
      if (solid) mesh.customDepthMaterial = patch(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), model.vat, { flash: false });
      this.scene.add(mesh);
      return mesh;
    });
    return { meshes, matrix, vatAttr, count: 0, solid };
  }

  _layerFor(model, kind) {
    if (!model.layers[kind]) {
      if (kind === 'ghost') model.layers.ghost = this._layer(model, () => this.ghostMaterial.clone(), false);
      else {
        // Gilding keeps glowing parts as they are, like the per-mesh gild did.
        model.layers.gold = this._layer(model, (m) => (m.emissiveIntensity && m.emissive?.getHex() ? m.clone() : this.goldMaterial.clone()), true);
      }
    }
    return model.layers[kind];
  }

  setShadows(on) {
    this.shadows = on;
    for (const model of this.models.values()) {
      for (const layer of Object.values(model.layers)) if (layer.solid) for (const m of layer.meshes) m.castShadow = on;
    }
  }

  begin() {
    for (const model of this.models.values()) for (const layer of Object.values(model.layers)) layer.count = 0;
  }

  // Adds one creep: `matrix` is its anchor's world matrix, `time` its clip time in
  // seconds, `flash` 0-1 white blend, `unseen` draws it as a ghost, `gold` gilded.
  put(model, matrix, time, flash, unseen, gold) {
    const layer = unseen ? this._layerFor(model, 'ghost') : gold ? this._layerFor(model, 'gold') : model.layers.normal;
    if (layer.count >= CAPACITY) return;
    const i = layer.count++;
    matrix.toArray(layer.matrix.array, i * 16);
    layer.vatAttr.array[i * 2] = ((time % model.dur) / model.dur) * model.frames;
    layer.vatAttr.array[i * 2 + 1] = flash;
  }

  end() {
    for (const model of this.models.values()) {
      for (const layer of Object.values(model.layers)) {
        for (const m of layer.meshes) m.count = layer.count;
        if (layer.count) { layer.matrix.needsUpdate = true; layer.vatAttr.needsUpdate = true; }
      }
    }
  }
}
