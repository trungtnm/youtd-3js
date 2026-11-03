// Draws many small moving meshes (animated tower parts, curated model meshes,
// creep crowns and halos) as a few instanced meshes. Tracked meshes stay in the
// scene graph, so their animation keeps working, but are taken off every render
// layer; just before each render their world matrices are copied into one
// InstancedMesh per geometry, material and shadow setting. The grouping is done
// every frame from each mesh's current material, so material swaps (hit flash,
// invisible shimmer) and shadow toggles need no bookkeeping.

import * as THREE from 'three';

const eligible = (o) => o.isMesh && !o.isSkinnedMesh && !o.isInstancedMesh && !o.isBatchedMesh
  && !Array.isArray(o.material) && o.material.visible !== false && !o.morphTargetInfluences
  // Transparent parts keep their own mesh so they sort by their own position, not the batch's.
  && !o.material.transparent;

function visibleChain(o, stop) {
  for (let p = o; p && p !== stop; p = p.parent) if (!p.visible) return false;
  return true;
}

export class InstanceProxies {
  constructor(scene) {
    this.scene = scene;
    this.owners = new Map(); // owner key -> { root, meshes }
    this.buckets = new Map(); // geometry|material|cast|receive -> { mesh, used }
    const prev = scene.onBeforeRender;
    // Runs after the renderer has updated world matrices and before the shadow
    // and colour passes, so both see this frame's transforms.
    scene.onBeforeRender = (...a) => { prev?.apply(scene, a); this.flush(); };
  }

  // (Re)collects the eligible meshes under `root` for `owner`.
  track(owner, root) {
    this.untrack(owner);
    const meshes = [];
    root.traverse((o) => {
      if (!eligible(o)) return;
      o.layers.disableAll();
      meshes.push(o);
    });
    this.owners.set(owner, { root, meshes });
  }

  untrack(owner) {
    const e = this.owners.get(owner);
    if (!e) return;
    for (const o of e.meshes) o.layers.set(0);
    this.owners.delete(owner);
  }

  _bucket(o) {
    const key = `${o.geometry.id}|${o.material.id}|${o.castShadow}|${o.receiveShadow}`;
    let b = this.buckets.get(key);
    if (!b) {
      b = { mesh: null, used: 0, geometry: o.geometry, material: o.material, cast: o.castShadow, receive: o.receiveShadow };
      this._grow(b, 16);
      this.buckets.set(key, b);
    }
    if (b.used >= b.mesh.instanceMatrix.count) this._grow(b, b.mesh.instanceMatrix.count * 2);
    return b;
  }

  _grow(b, capacity) {
    const old = b.mesh;
    const mesh = new THREE.InstancedMesh(b.geometry, b.material, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.castShadow = b.cast;
    mesh.receiveShadow = b.receive;
    mesh.count = 0;
    if (old) {
      mesh.instanceMatrix.array.set(old.instanceMatrix.array.subarray(0, b.used * 16));
      this.scene.remove(old);
      old.dispose();
    }
    this.scene.add(mesh);
    b.mesh = mesh;
  }

  // Turning proxies off puts every tracked mesh back on the default layer, so each
  // draws itself again (a reference for visual checks).
  setEnabled(on) {
    this.enabled = on;
    for (const { meshes } of this.owners.values()) for (const o of meshes) if (on) o.layers.disableAll(); else o.layers.set(0);
  }

  flush() {
    for (const b of this.buckets.values()) b.used = 0;
    if (this.enabled === false) { for (const b of this.buckets.values()) b.mesh.visible = false; return; }
    for (const [owner, { root, meshes }] of this.owners) {
      // An owner whose root has left the scene (tower sold, creep gone) is dropped.
      if (!root.parent) { this.owners.delete(owner); continue; }
      for (const o of meshes) {
        if (!o.parent || !visibleChain(o, null)) continue;
        const b = this._bucket(o);
        o.matrixWorld.toArray(b.mesh.instanceMatrix.array, b.used * 16);
        b.used++;
      }
    }
    for (const b of this.buckets.values()) {
      b.mesh.count = b.used;
      b.mesh.visible = b.used > 0;
      if (b.used) b.mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
