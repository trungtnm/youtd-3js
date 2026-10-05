// Loads curated models (public/models/*.glb, see src/data/model-map.js), fits
// them to the space a procedural model would take, and drives their clips.
// Towers stand on the pedestal, face their target, idle and swing on attack.
// Creeps walk (or fly) with a clip that speeds up and slows with the creep.
// Files load on first use; until then the procedural model stands in.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const pending = new Map(); // id -> Promise<gltf | null>
const ready = new Map();   // id -> gltf, once loaded

export function loadGlb(id) {
  if (!pending.has(id)) {
    pending.set(id, loader.loadAsync(`/models/${id}.glb`)
      .then((gltf) => { ready.set(id, gltf); return gltf; })
      .catch((err) => { console.warn(`model ${id} failed to load`, err); return null; }));
  }
  return pending.get(id);
}

const clip = (clips, ...tests) => {
  for (const t of tests) { const c = clips.find(t); if (c) return c; }
  return null;
};
const named = (re, not = /hit|react|back|left|right/i) => (c) => re.test(c.name) && !not.test(c.name);
// Exactly "Idle" first, then any idle that is not a hit reaction, then a standing
// pose, then the only clip a model has.
const pickIdle = (clips) => clip(clips, (c) => /(^|[|_])idle$/i.test(c.name), named(/idle/i), named(/stand/i))
  || (clips.length === 1 ? clips[0] : null);
const pickAttack = (clips) => clip(clips, named(/attack|punch|shoot|slash|sword|cast|bite|headbutt/i));
const pickMove = (clips, air) => (air
  ? clip(clips, (c) => /(^|[|_])(fast_)?fly(ing)?$/i.test(c.name), named(/fly/i))
  : clip(clips, (c) => /(^|[|_])walk$/i.test(c.name), named(/walk/i), named(/run/i), named(/gallop/i)));

// A clone of the model scaled to fit within `maxH` tall and `maxR` from the
// centre, standing on y = 0 and facing +Z.
function fitted(gltf, { maxH, maxR, yaw }) {
  const model = cloneSkinned(gltf.scene);
  model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  if (yaw) model.rotation.y = yaw;
  // Skinned bounds come from the bone matrices, which are only filled in by a
  // render; update them first or the measured size is meaningless.
  model.updateMatrixWorld(true);
  model.traverse((o) => { if (o.isSkinnedMesh) { o.skeleton.update(); o.boundingBox = null; } });
  const box = new THREE.Box3().setFromObject(model, true);
  const size = box.getSize(new THREE.Vector3());
  const k = Math.min(maxH / (size.y || 1), (maxR * 2) / (Math.max(size.x, size.z) || 1));
  model.scale.multiplyScalar(k);
  const centre = box.getCenter(new THREE.Vector3()).multiplyScalar(k);
  model.position.set(-centre.x, -box.min.y * k, -centre.z);
  const root = new THREE.Group();
  root.add(model);
  return { root, model, height: size.y * k };
}

// Drops the animation hooks of parts inside `root` (the procedural model being
// replaced), keeping hooks on anything else such as the dais or boss rings.
function clearHooks(anim, root, lists, keys) {
  const inside = (o) => { for (let p = o; p; p = p.parent) if (p === root) return true; return false; };
  for (const key of lists) {
    if (!anim[key]) continue;
    const kept = anim[key].filter((h) => !inside(h.obj || h.l || h));
    anim[key].length = 0;
    anim[key].push(...kept);
  }
  for (const key of keys) delete anim[key];
}

// ---------------------------------------------------------------- towers

const TOWER_H = 2.2;   // model height on the dais before the tower's cost scale
const TOWER_R = 1.4;   // widest it may reach from the centre; long models (lizards, boats) overhang the dais

function towerInstance(gltf, spec) {
  const inst = fitted(gltf, { maxH: spec.h ?? TOWER_H, maxR: TOWER_R, yaw: spec.yaw });
  inst.mixer = null; inst.playAttack = null;
  if (gltf.animations.length) {
    const mixer = new THREE.AnimationMixer(inst.model);
    const idleClip = pickIdle(gltf.animations), attackClip = pickAttack(gltf.animations);
    const idle = idleClip && mixer.clipAction(idleClip).play();
    if (idle) idle.time = Math.random() * idleClip.duration; // towers built together should not move in lockstep
    if (attackClip) {
      const attack = mixer.clipAction(attackClip);
      attack.setLoop(THREE.LoopOnce, 1);
      // The mixer runs on game time, so the swing follows game speed and pauses.
      mixer.addEventListener('finished', (e) => { if (e.action === attack) idle?.reset().fadeIn(0.15).play(); });
      inst.playAttack = () => {
        if (attack.isRunning()) return;
        attack.reset().fadeIn(0.08).play();
        idle?.fadeOut(0.08);
      };
    }
    inst.mixer = mixer;
  }
  return inst;
}

// Puts the model into `top` (replacing the procedural parts when it loads late)
// and updates the tower's animation hooks. Returns the muzzle height, or null
// while loading; `onSwap(muzzleY)` runs after a late swap.
export function attachTowerGlb(top, spec, anim, baseY, onSwap) {
  const apply = (gltf) => {
    if (!gltf) return null;
    const inst = towerInstance(gltf, spec);
    inst.root.position.y = baseY;
    clearHooks(anim, top, ['spin', 'bob', 'orbit', 'flicker', 'flap', 'pulse'], ['barrels', 'press', 'hammer', 'scythe']);
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
  loadGlb(spec.id).then((g) => { const muzzle = apply(g); if (muzzle != null) onSwap?.(muzzle); });
  return null;
}

// ---------------------------------------------------------------- creeps

const CREEP_H = 1.9;     // ground creep height before the size scale
const CREEP_AIR_H = 1.3; // flyer body height; it hovers at FLY_Y
const CREEP_R = 1.1;     // long-bodied creeps (wolves, dinosaurs) need room along their walk direction
const FLY_Y = 2.6;

// When set (by the game world), curated creeps are drawn by this CreepCrowd instead
// of a cloned model per creep. The gallery leaves it unset and clones as before.
let crowd = null;
export function setCreepCrowd(c) { crowd = c; }

// Replaces the procedural body in `body` (the creep's inner group) with the
// model. Returns the model height, or null while loading.
const crowdKey = (spec, air) => `${spec.id}|${air ? 'air' : 'ground'}|${spec.h ?? ''}|${spec.yaw ?? ''}`;
const fitCreep = (gltf, spec, air) => fitted(gltf, { maxH: spec.h ?? (air ? CREEP_AIR_H : CREEP_H), maxR: CREEP_R, yaw: spec.yaw });
const crowdModel = (gltf, spec, air) => crowd.get(crowdKey(spec, air))
  || crowd.add(crowdKey(spec, air), fitCreep(gltf, spec, air), gltf.animations.length ? pickMove(gltf.animations, air) || pickIdle(gltf.animations) : null);

// Loads a creep model and bakes it for the crowd ahead of the first spawn.
export function prepareCreepGlb(spec, air) {
  return loadGlb(spec.id).then((gltf) => { if (gltf && crowd) crowdModel(gltf, spec, air); });
}

export function attachCreepGlb(body, spec, anim, air, onSwap) {
  const apply = (gltf) => {
    if (!gltf) return null;
    const fit = () => fitCreep(gltf, spec, air);
    clearHooks(anim, body, ['legs', 'arms', 'orbit'], ['flap', 'head', 'body']);
    anim.float = false;
    for (const part of [...body.children]) if (!part.userData.keep) body.remove(part);
    if (crowd) {
      // The crowd draws the model at an empty anchor that animations move like the model.
      const model = crowdModel(gltf, spec, air);
      const anchor = new THREE.Group();
      if (air) { anchor.position.y = FLY_Y - model.height / 2; anim.body = anchor; anim.bodyY = anchor.position.y; }
      body.add(anchor);
      anim.crowd = { model, anchor, time: Math.random() * model.dur, gold: false };
      return air ? FLY_Y + model.height / 2 : model.height;
    }
    const inst = fit();
    if (air) { inst.root.position.y = FLY_Y - inst.height / 2; anim.body = inst.root; anim.bodyY = inst.root.position.y; }
    body.add(inst.root);
    if (gltf.animations.length) {
      const mixer = new THREE.AnimationMixer(inst.model);
      const moveClip = pickMove(gltf.animations, air) || pickIdle(gltf.animations);
      if (moveClip) {
        const move = mixer.clipAction(moveClip).play();
        move.time = Math.random() * moveClip.duration;
      }
      anim.mixer = mixer;
    }
    return air ? FLY_Y + inst.height / 2 : inst.height;
  };
  const gltf = ready.get(spec.id);
  if (gltf) return apply(gltf);
  loadGlb(spec.id).then((g) => { const h = apply(g); if (h != null) onSwap?.(h); });
  return null;
}
