// Projectiles in flight: every glowing head in one instanced mesh and every trail
// in one ribbon mesh, so a field full of towers firing costs two draw calls. The
// trail is the head's recent path drawn as a camera-facing strip that tapers and
// fades toward its tail; when a shot lands its trail lingers a moment and fades.

import * as THREE from 'three';

const NODES = 10; // trail samples per projectile
const FADE = 0.18; // seconds a landed shot's trail lingers

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _d = new THREE.Vector3();
const _side = new THREE.Vector3();
const _toCam = new THREE.Vector3();
const _z = new THREE.Vector3(0, 0, 1);
const _c = new THREE.Color();

export class ProjectileBatch {
  constructor(scene, camera, max) {
    this.camera = camera;
    this.max = max;
    this.live = new Map(); // uid -> { pts: Float32Array(NODES*3), n, style, dead }

    const head = new THREE.IcosahedronGeometry(1, 2);
    // Lit, so a cannonball still reads as a ball, and glowing in its own colour:
    // the instance colour carries the projectile's glow strength.
    const headMat = new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.1 });
    headMat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n  totalEmissiveRadiance += vColor.rgb * 0.7;');
    };
    this.heads = new THREE.InstancedMesh(head, headMat, max);
    this.heads.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.heads.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.heads.frustumCulled = false;
    this.heads.count = 0;
    scene.add(this.heads);

    const verts = max * NODES * 2;
    const geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(verts * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.col = new THREE.BufferAttribute(new Float32Array(verts * 4), 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.pos);
    geo.setAttribute('color', this.col);
    const index = new Uint32Array(max * (NODES - 1) * 6);
    for (let t = 0, o = 0; t < max; t++) for (let i = 0; i < NODES - 1; i++) {
      const a = (t * NODES + i) * 2;
      index.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], o);
      o += 6;
    }
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    this.trails = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
    }));
    this.trails.frustumCulled = false;
    scene.add(this.trails);
  }

  // list: [{ uid, x, y, z, style }] for every projectile alive this frame.
  // style: { color, trail, size, glow, stretch }.
  sync(list, dt) {
    const seen = new Set();
    for (const p of list) {
      seen.add(p.uid);
      let e = this.live.get(p.uid);
      if (!e) {
        if (this.live.size >= this.max) continue;
        e = { pts: new Float32Array(NODES * 3), n: 0, style: p.style, dead: -1 };
        this.live.set(p.uid, e);
      }
      // Newest sample first; older ones shift toward the tail.
      e.pts.copyWithin(3, 0, (NODES - 1) * 3);
      e.pts[0] = p.x; e.pts[1] = p.y; e.pts[2] = p.z;
      e.n = Math.min(NODES, e.n + 1);
    }
    for (const [uid, e] of this.live) {
      if (seen.has(uid)) continue;
      if (e.dead < 0) e.dead = 0;
      e.dead += dt;
      if (e.dead >= FADE) this.live.delete(uid);
    }
    this._draw();
  }

  _draw() {
    _toCam.copy(this.camera.position);
    const P = this.pos.array, C = this.col.array;
    let h = 0, t = 0;
    for (const e of this.live.values()) {
      const st = e.style, pts = e.pts;
      const fade = e.dead < 0 ? 1 : 1 - e.dead / FADE;
      if (e.dead < 0 && e.n > 0) {
        // Head: a bright blob, stretched along the flight path for darts and bolts.
        _p.fromArray(pts, 0);
        const s = st.size * 1.5;
        if (st.stretch && e.n > 1) {
          _d.fromArray(pts, 3).sub(_p).negate();
          if (_d.lengthSq() > 1e-8) _q.setFromUnitVectors(_z, _d.normalize()); else _q.identity();
          _s.set(s, s, s * st.stretch);
        } else { _q.identity(); _s.setScalar(s); }
        this.heads.setMatrixAt(h, _m.compose(_p, _q, _s));
        _c.set(st.color).multiplyScalar(0.4 + st.glow * 0.45);
        this.heads.setColorAt(h, _c);
        h++;
      }
      if (e.n < 2) continue;
      // Trail: a camera-facing strip through the samples, tapering to the tail.
      _c.set(st.trail).multiplyScalar(1.6);
      const width = st.size * (st.stretch ? 1.4 : 2.0);
      const base = t * NODES * 2;
      for (let i = 0; i < NODES; i++) {
        const j = Math.min(i, e.n - 1);
        _p.fromArray(pts, j * 3);
        const a = Math.max(0, j - 1), b = Math.min(e.n - 1, j + 1);
        _d.fromArray(pts, a * 3).sub(_side.fromArray(pts, b * 3));
        if (_d.lengthSq() < 1e-10) _d.set(1, 0, 0);
        _side.subVectors(_toCam, _p).cross(_d).normalize();
        const u = j / (NODES - 1);
        const w = width * (1 - u) * (0.6 + 0.4 * fade);
        const alpha = Math.pow(1 - u, 1.2) * fade;
        const v = (base + i * 2) * 3;
        P[v] = _p.x + _side.x * w; P[v + 1] = _p.y + _side.y * w; P[v + 2] = _p.z + _side.z * w;
        P[v + 3] = _p.x - _side.x * w; P[v + 4] = _p.y - _side.y * w; P[v + 5] = _p.z - _side.z * w;
        const c = (base + i * 2) * 4;
        C[c] = C[c + 4] = _c.r; C[c + 1] = C[c + 5] = _c.g; C[c + 2] = C[c + 6] = _c.b; C[c + 3] = C[c + 7] = alpha;
      }
      t++;
    }
    this.heads.count = h;
    this.heads.visible = h > 0;
    if (h) { this.heads.instanceMatrix.needsUpdate = true; this.heads.instanceColor.needsUpdate = true; }
    this.trails.visible = t > 0;
    this.trails.geometry.setDrawRange(0, t * (NODES - 1) * 6);
    if (t) {
      for (const a of [this.pos, this.col]) { a.clearUpdateRanges(); a.addUpdateRange(0, t * NODES * 2 * a.itemSize); a.needsUpdate = true; }
    }
  }
}
