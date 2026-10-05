// Health bars and blob shadows for every creep, drawn as a few instanced meshes
// instead of several meshes (and materials) per creep. The instance lists are
// rebuilt each frame from the creeps the world syncs: begin(), bar()/blob() per
// creep, then end() to upload.
import * as THREE from 'three';

const MAX = 2048;
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
const _c = new THREE.Color();

function instanced(geo, material, max, renderOrder) {
  const mesh = new THREE.InstancedMesh(geo, material, max);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  mesh.frustumCulled = false; // instances span the whole field
  mesh.renderOrder = renderOrder;
  return mesh;
}

// Soft dark disc that fades to nothing at the rim (alpha only).
function blobTexture() {
  const N = 64, data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const d = Math.hypot(x + 0.5 - N / 2, y + 0.5 - N / 2) / (N / 2);
    data[(y * N + x) * 4 + 3] = Math.round(255 * Math.max(0, 1 - d * d));
  }
  const tex = new THREE.DataTexture(data, N, N);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export class CreepOverlays {
  constructor(scene) {
    // Bars draw over everything, as the per-creep bars did: background, then fill and shield.
    const quad = new THREE.PlaneGeometry(1, 1).translate(0.5, 0, 0); // anchored at its left edge
    this.bg = instanced(quad, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.7, depthTest: false, depthWrite: false }), MAX, 20);
    this.fg = instanced(quad, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthTest: false, depthWrite: false }), MAX * 2, 21);
    this.fg.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.blobs = instanced(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      map: blobTexture(), transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }), MAX, 1);
    scene.add(this.bg, this.fg, this.blobs);
    this.blobsOn = true;
  }

  begin(camera) {
    this.bg.count = this.fg.count = this.blobs.count = 0;
    this.camQ = camera.quaternion;
    _right.set(1, 0, 0).applyQuaternion(this.camQ);
    _up.set(0, 1, 0).applyQuaternion(this.camQ);
  }

  _put(mesh, x, y, z, ox, oy, w, h) {
    if (mesh.count >= mesh.instanceMatrix.count) return -1;
    _p.set(x, y, z).addScaledVector(_right, ox).addScaledVector(_up, oy);
    _m.compose(_p, this.camQ, _s.set(Math.max(0.001, w), h, 1));
    mesh.setMatrixAt(mesh.count, _m);
    return mesh.count++;
  }

  // A camera-facing bar of width `w` centred above (x, y, z); `k` is the health
  // fraction and `shieldK` the shield fraction (null when the creep has none).
  bar(x, y, z, w, k, shieldK) {
    this._put(this.bg, x, y, z, -(w + 0.1) / 2, 0, w + 0.1, 0.26);
    const i = this._put(this.fg, x, y, z, -w / 2, 0, w * k, 0.18);
    if (i >= 0) this.fg.setColorAt(i, _c.setHSL(k * 0.33, 0.9, 0.5));
    if (shieldK > 0) {
      const j = this._put(this.fg, x, y, z, -w / 2, 0.1, w * shieldK, 0.06);
      if (j >= 0) this.fg.setColorAt(j, _c.set(0x8fd8ff));
    }
  }

  // A soft shadow disc of radius `r` on the ground under (x, z).
  blob(x, z, r) {
    if (!this.blobsOn || this.blobs.count >= MAX) return;
    _m.compose(_p.set(x, 0.12, z), _flat, _s.set(r * 2, r * 2, 1)); // above the road and grid overlay
    this.blobs.setMatrixAt(this.blobs.count++, _m);
  }

  end() {
    for (const mesh of [this.bg, this.fg, this.blobs]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}
