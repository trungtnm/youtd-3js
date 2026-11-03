// Static world: one of several map themes (src/world/maps/) built around the
// shared gameplay layout, plus the placement grid every map uses.

import isle from './maps/isle.js';
import dusk from './maps/dusk.js';
import frost from './maps/frost.js';
import sky from './maps/sky.js';
import elements from './maps/elements.js';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildGridOverlay } from './maps/shared.js';

export const MAPS = Object.fromEntries([sky, elements, frost, dusk, isle].map((m) => [m.id, m]));
export const DEFAULT_MAP = 'dusk';

let current = MAPS[DEFAULT_MAP];

// Ground height of the active map, for effects that land on the ground.
export const terrainHeight = (x, z) => current.terrainHeight(x, z);

export function buildEnvironment(scene, rand, mapId = DEFAULT_MAP) {
  current = MAPS[mapId] || MAPS[DEFAULT_MAP];
  const env = current.build(rand);
  env.map = current;
  env.grid = buildGridOverlay();
  env.objects.push(env.grid);
  scene.add(...env.objects);
  mergeStaticProps(scene, env);
  return env;
}

const SAMPLE_TIMES = [0.37, 1.9, 3.3, 5.05, 7.7, 13.1];
const MERGEABLE = new Set(['MeshStandardMaterial', 'MeshBasicMaterial', 'MeshLambertMaterial', 'MeshPhongMaterial']);

// Map props are hundreds of separate meshes; this merges them into one mesh per
// material and shadow setting. Movement is found by running the map's own update
// at several times: props whose world matrix never changes are merged in world
// space, and props that only ride along with their top-level map object (a bobbing
// islet, a drifting rock) are merged in that object's space and parented to it.
// The nexus crystal and rings are animated from outside the map, so they are left alone.
// Shader, patched and transparent materials are skipped: a shader may depend on its object's
// transform, and transparent parts need their own sort order.
function mergeStaticProps(scene, env) {
  const skip = new Set();
  // World code spins and bobs these nexus parts each frame (see World#render).
  const nx = env.nexus?.userData || {};
  for (const o of [nx.crystal, nx.ring1, nx.ring2, nx.beam, env.grid]) o?.traverse?.((c) => skip.add(c));
  const visibleNow = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
  const rel = (c) => c.root.matrixWorld.clone().invert().multiply(c.o.matrixWorld);
  const candidates = [];
  scene.updateMatrixWorld(true);
  for (const root of env.objects) root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.isBatchedMesh || o.isSkinnedMesh || skip.has(o)) return;
    if (Array.isArray(o.material) || !MERGEABLE.has(o.material.type) || o.material.transparent || o.material.visible === false) return;
    // A patched material may read local positions or the object's matrix (the dusk banners wave from them).
    if (o.material.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile) return;
    if (o.morphTargetInfluences || o.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender || !visibleNow(o)) return;
    // Removing a merged mesh would take its children with it (the nexus light shaft hangs off a mesh).
    if (o.children.length) return;
    const c = { o, root, world: o.matrixWorld.clone() };
    c.local = rel(c);
    candidates.push(c);
  });
  for (const T of SAMPLE_TIMES) {
    env.map.update(env, T);
    scene.updateMatrixWorld(true);
    for (const c of candidates) {
      if (!visibleNow(c.o)) { c.worldMoved = c.rootMoved = true; continue; }
      if (!c.worldMoved && !c.o.matrixWorld.equals(c.world)) c.worldMoved = true;
      if (!c.rootMoved && c.root !== c.o && !approxEqual(rel(c), c.local)) c.rootMoved = true;
    }
  }
  env.map.update(env, 0);
  scene.updateMatrixWorld(true);
  const groups = new Map();
  for (const c of candidates) {
    const { o } = c;
    // World-static first; otherwise rigid with its root (a root mesh itself is never re-parented).
    const target = !c.worldMoved ? scene : !c.rootMoved && c.root !== o ? c.root : null;
    if (!target) continue;
    const geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const k of Object.keys(geo.morphAttributes)) delete geo.morphAttributes[k];
    geo.applyMatrix4(target === scene ? c.world : c.local);
    const key = `${target.uuid}|${o.material.uuid}|${o.castShadow}|${o.receiveShadow}|${Object.keys(geo.attributes).sort().join(',')}`;
    if (!groups.has(key)) groups.set(key, { target, material: o.material, cast: o.castShadow, receive: o.receiveShadow, geos: [], meshes: [] });
    const g = groups.get(key);
    g.geos.push(geo);
    g.meshes.push(o);
  }
  for (const g of groups.values()) {
    if (g.meshes.length < 2) continue;
    const merged = mergeGeometries(g.geos);
    if (!merged) continue;
    for (const o of g.meshes) o.removeFromParent();
    const mesh = new THREE.Mesh(merged, g.material);
    mesh.castShadow = g.cast;
    mesh.receiveShadow = g.receive;
    mesh.name = 'static-props';
    g.target.add(mesh);
    if (g.target === scene) env.objects.push(mesh);
  }
}

function approxEqual(a, b) {
  for (let i = 0; i < 16; i++) if (Math.abs(a.elements[i] - b.elements[i]) > 1e-4) return false;
  return true;
}

// Removes a map's objects and frees their GPU resources.
export function disposeEnvironment(scene, env) {
  for (const o of env.objects) {
    scene.remove(o);
    o.traverse((c) => {
      c.geometry?.dispose();
      for (const m of [].concat(c.material || [])) { for (const v of Object.values(m.uniforms || {})) v.value?.isTexture && v.value.dispose(); m.dispose(); }
    });
  }
}

export function updateEnvironment(env, T) {
  env.map.update(env, T);
  env.grid.material.uniforms.uTime.value = T;
}
