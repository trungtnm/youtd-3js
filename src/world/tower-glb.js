// Loads curated tower models (public/models/*.glb, see src/data/model-map.js),
// fits them onto the pedestal and drives their idle and attack animations.
// Models load on first use; until then the tower shows its procedural model.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const pending = new Map(); // id -> Promise<gltf | null>
const ready = new Map();   // id -> gltf, once loaded

const MAX_H = 2.1;   // tallest a model may stand above the pedestal (world units, before tier scale)
const MAX_R = 0.95;  // widest it may reach from the pedestal centre

export function loadTowerGlb(id) {
  if (!pending.has(id)) {
    pending.set(id, loader.loadAsync(`/models/${id}.glb`)
      .then((gltf) => { ready.set(id, gltf); return gltf; })
      .catch((err) => { console.warn(`tower model ${id} failed to load`, err); return null; }));
  }
  return pending.get(id);
}

const ATTACK = /attack|punch|shoot|slash|sword|cast|bite|headbutt/i;
// Prefer a clip named exactly Idle, then any idle that is not a hit reaction,
// then a standing pose, then the only clip a model has.
const pickIdle = (clips) => clips.find((c) => /(^|[|_])idle$/i.test(c.name))
  || clips.find((c) => /idle/i.test(c.name) && !/hit|react/i.test(c.name))
  || clips.find((c) => /stand/i.test(c.name))
  || (clips.length === 1 ? clips[0] : null);

// Returns { root, height, mixer, playAttack } for a loaded model, scaled so it
// fits within MAX_H tall and MAX_R wide, standing on y = 0 and facing +Z.
function instance(gltf, spec) {
  const model = cloneSkinned(gltf.scene);
  model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  if (spec.yaw) model.rotation.y = spec.yaw;
  // Skinned bounds come from the bone matrices, which are only filled in by a
  // render; update them first or the measured size is meaningless.
  model.updateMatrixWorld(true);
  model.traverse((o) => { if (o.isSkinnedMesh) { o.skeleton.update(); o.boundingBox = null; } });
  const box = new THREE.Box3().setFromObject(model, true);
  const size = box.getSize(new THREE.Vector3());
  const height = spec.h ?? MAX_H;
  const k = Math.min(height / (size.y || 1), (MAX_R * 2) / (Math.max(size.x, size.z) || 1));
  model.scale.multiplyScalar(k);
  const centre = box.getCenter(new THREE.Vector3()).multiplyScalar(k);
  model.position.set(-centre.x, -box.min.y * k, -centre.z);
  const root = new THREE.Group();
  root.add(model);

  let mixer = null, playAttack = null;
  if (gltf.animations.length) {
    mixer = new THREE.AnimationMixer(model);
    const idleClip = pickIdle(gltf.animations);
    const attackClip = gltf.animations.find((c) => ATTACK.test(c.name) && !/hit|react/i.test(c.name));
    const idle = idleClip && mixer.clipAction(idleClip).play();
    if (idle) idle.time = Math.random() * idleClip.duration; // towers built together should not move in lockstep
    if (attackClip) {
      const attack = mixer.clipAction(attackClip);
      attack.setLoop(THREE.LoopOnce, 1);
      // The mixer runs on game time, so the swing follows game speed and pauses.
      mixer.addEventListener('finished', (e) => { if (e.action === attack) idle?.reset().fadeIn(0.15).play(); });
      playAttack = () => {
        if (attack.isRunning()) return;
        attack.reset().fadeIn(0.08).play();
        idle?.fadeOut(0.08);
      };
    }
  }
  return { root, height: size.y * k, mixer, playAttack };
}

// Puts the model into `top` (replacing the procedural parts when it loads late)
// and updates the tower's animation hooks. `onSwap` runs after a late swap.
export function attachTowerGlb(top, spec, anim, baseY, onSwap) {
  const apply = (gltf) => {
    if (!gltf) return null;
    const inst = instance(gltf, spec);
    inst.root.position.y = baseY;
    for (const key of ['spin', 'bob', 'orbit', 'flicker', 'flap', 'pulse']) anim[key].length = 0;
    for (const key of ['barrels', 'press', 'hammer', 'scythe']) delete anim[key];
    top.clear();
    top.add(inst.root);
    anim.head = inst.root;
    anim.headYaw = true;
    anim.mixer = inst.mixer;
    anim.playAttack = inst.playAttack;
    return baseY + inst.height;
  };
  const gltf = ready.get(spec.id);
  if (gltf) return apply(gltf);
  loadTowerGlb(spec.id).then((g) => { const muzzle = apply(g); if (muzzle != null) onSwap?.(muzzle); });
  return null;
}
