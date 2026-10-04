// Static world: one of several map themes (src/world/maps/) built around the
// shared gameplay layout, plus the placement grid every map uses.

import isle from './maps/isle.js';
import dusk from './maps/dusk.js';
import frost from './maps/frost.js';
import sky from './maps/sky.js';
import elements from './maps/elements.js';
import { buildGridOverlay } from './maps/shared.js';

export const MAPS = Object.fromEntries([isle, dusk, frost, sky, elements].map((m) => [m.id, m]));
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
  return env;
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
