// Shares the merged static parts of every tower (see mergeStatic in models.js) in
// one BatchedMesh per material and shadow setting, so the whole field of daises
// and static tower bodies costs a handful of draw calls. Animated parts stay as
// ordinary meshes in each tower's group.
import * as THREE from 'three';

const _m = new THREE.Matrix4();

export class TowerBatcher {
  constructor(scene) {
    this.scene = scene;
    this.sets = new Map();
  }

  _set(mesh) {
    const geo = mesh.geometry;
    const key = `${mesh.material.uuid}|${mesh.castShadow}|${mesh.receiveShadow}|${Object.keys(geo.attributes).sort().join(',')}|${!!geo.index}`;
    let set = this.sets.get(key);
    if (!set) {
      const batched = new THREE.BatchedMesh(32, 16384, geo.index ? 32768 : 0, mesh.material);
      // Its bounding sphere is computed once and never refreshed as towers come and
      // go, so object-level culling would hide the whole set; instances still cull.
      batched.frustumCulled = false;
      batched.castShadow = mesh.castShadow;
      batched.receiveShadow = mesh.receiveShadow;
      this.scene.add(batched);
      set = { batched, geoIds: new Map(), live: 0 };
      this.sets.set(key, set);
    }
    return set;
  }

  _geometryId(set, geo) {
    let id = set.geoIds.get(geo);
    if (id !== undefined) return id;
    const b = set.batched;
    const verts = geo.attributes.position.count, idx = geo.index ? geo.index.count : 0;
    if (b.unusedVertexCount < verts || b.unusedIndexCount < idx) {
      const usedV = b._maxVertexCount - b.unusedVertexCount, usedI = b._maxIndexCount - b.unusedIndexCount;
      b.setGeometrySize(Math.max(b._maxVertexCount * 2, usedV + verts), geo.index ? Math.max(b._maxIndexCount * 2, usedI + idx) : 0);
    }
    id = b.addGeometry(geo);
    set.geoIds.set(geo, id);
    return id;
  }

  // Moves the tower group's batched meshes into the shared sets. Returns the handle
  // that update() and remove() take.
  add(group) {
    group.updateMatrixWorld(true);
    const entries = [];
    for (const mesh of group.children.filter((o) => o.userData.batched)) {
      const set = this._set(mesh);
      const gid = this._geometryId(set, mesh.geometry);
      const b = set.batched;
      if (b.instanceCount >= b.maxInstanceCount) b.setInstanceCount(b.maxInstanceCount * 2);
      const id = b.addInstance(gid);
      b.setMatrixAt(id, mesh.matrixWorld);
      entries.push({ set, id, local: mesh.matrix.clone() });
      mesh.removeFromParent();
    }
    return entries;
  }

  // Follows the group's transform (the build pop-in scales it).
  update(entries, group) {
    group.updateMatrixWorld(true);
    for (const e of entries) e.set.batched.setMatrixAt(e.id, _m.multiplyMatrices(group.matrixWorld, e.local));
  }

  remove(entries) {
    for (const e of entries) e.set.batched.deleteInstance(e.id);
  }
}
