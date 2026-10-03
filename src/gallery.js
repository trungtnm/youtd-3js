// Dev-only review page (gallery.html): every tower family and every creep
// race/size, built with the same model code the game uses.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { FAMILIES, TOWERS } from './data/towers.js';
import { ELEMENTS, ELEMENT_IDS, RACE_IDS, RACES } from './data/constants.js';
import { MODEL_LIBRARY } from './data/model-library.js';
import { buildTowerModel, buildCreepModel, preloadCreepModels } from './world/models.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
const labels = new CSS2DRenderer();
labels.setSize(innerWidth, innerHeight);
Object.assign(labels.domElement.style, { position: 'fixed', inset: '0', pointerEvents: 'none' });
document.body.appendChild(labels.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1d222d);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.35;
scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a3428, 1.6));
const sun = new THREE.DirectionalLight(0xfff2d8, 2.4);
sun.position.set(30, 50, 25);
scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0x2c3340, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 2000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

let items = []; // { obj, anim, kind }
const content = new THREE.Group();
scene.add(content);

const sourceOf = (def) => {
  if (!def.glb) return { kind: 'proc', text: 'procedural' };
  const m = MODEL_LIBRARY[def.glb.id];
  if (def.glb.id.startsWith('meshy-')) return { kind: 'meshy', text: 'Meshy' };
  return { kind: 'poly', text: m ? `${m.title} · ${m.author}` : def.glb.id };
};

function label(obj, y, name, sub, tag) {
  const el = document.createElement('div');
  el.className = 'label';
  el.innerHTML = `<div class="n">${name}${tag ? `<span class="tag ${tag.kind}">${tag.kind === 'poly' ? 'Poly Pizza' : tag.kind === 'meshy' ? 'Meshy' : 'procedural'}</span>` : ''}</div><div class="s">${sub}</div>`;
  el.addEventListener('click', () => focus(obj));
  const l = new CSS2DObject(el);
  l.position.y = y;
  obj.add(l);
}

function focus(obj) {
  const p = obj.getWorldPosition(new THREE.Vector3());
  controls.target.set(p.x, 1.5, p.z);
  camera.position.set(p.x + 5, 6, p.z + 9);
}

function clear() {
  content.traverse((o) => { if (o.isCSS2DObject) o.element.remove(); });
  content.clear();
  items = [];
}

function layout(list, spacing) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(list.length * 1.8)));
  list.forEach((o, i) => o.position.set((i % cols) * spacing, 0, Math.floor(i / cols) * spacing * 0.9));
  const w = (cols - 1) * spacing, d = (Math.ceil(list.length / cols) - 1) * spacing * 0.9;
  content.position.set(-w / 2, 0, -d / 2);
  ground.scale.set(w + spacing * 2, d + spacing * 2, 1);
  const r = Math.max(w, d, 10);
  controls.target.set(0, 1, 0);
  camera.position.set(0, r * 0.75, r * 0.95);
}

// ---------------------------------------------------------------- towers

let element = 'nature', source = 'all';
function showTowers() {
  clear();
  const heads = Object.values(FAMILIES).map((f) => TOWERS[f.tiers[0]])
    .filter((d) => (element === 'all' || d.element === element))
    .filter((d) => source === 'all' || sourceOf(d).kind === source);
  const objs = heads.map((def) => {
    const g = buildTowerModel(def);
    const src = sourceOf(def);
    label(g, 3.0, def.name, `${ELEMENTS[def.element].name} · ${def.tierCount} tier${def.tierCount > 1 ? 's' : ''} · ${src.text}`, src);
    content.add(g);
    items.push({ obj: g, anim: g.userData.anim, kind: 'tower' });
    return g;
  });
  layout(objs, 4.2);
  setCount(`${objs.length} tower families`);
}

// ---------------------------------------------------------------- creeps

const SIZES = ['mass', 'normal', 'champion', 'air', 'boss', 'challenge'];
function showCreeps() {
  clear();
  preloadCreepModels();
  const objs = [];
  for (const race of RACE_IDS) {
    for (const size of SIZES) {
      const creep = { race, size, air: size === 'air', armorType: size === 'boss' ? 'divine' : 'plate' };
      const g = buildCreepModel(creep);
      label(g, g.userData.height + 0.6, `${RACES[race].name} ${size}`, size === 'boss' ? 'with divine armor halo' : '');
      content.add(g);
      items.push({ obj: g, anim: g.userData.anim, kind: 'creep' });
      objs.push(g);
    }
  }
  // One row per race, columns by size.
  const sx = 7, sz = 8;
  objs.forEach((o, i) => o.position.set((i % SIZES.length) * sx, 0, Math.floor(i / SIZES.length) * sz));
  const w = (SIZES.length - 1) * sx, d = (RACE_IDS.length - 1) * sz;
  content.position.set(-w / 2, 0, -d / 2);
  ground.scale.set(w + 16, d + 16, 1);
  controls.target.set(0, 1, 0);
  camera.position.set(0, 30, 42);
  setCount(`${objs.length} creeps (${RACE_IDS.length} races × ${SIZES.length} sizes)`);
}

// ---------------------------------------------------------------- ui

const setCount = (t) => { document.getElementById('count').textContent = t; };
let tab = 'towers';
function renderFilters() {
  const box = document.getElementById('filters');
  if (tab !== 'towers') { box.innerHTML = ''; return; }
  const btn = (k, v, text, on) => `<button data-${k}="${v}" class="${on ? 'on' : ''}">${text}</button>`;
  box.innerHTML = [btn('el', 'all', 'All', element === 'all'), ...ELEMENT_IDS.map((e) => btn('el', e, ELEMENTS[e].name, element === e))].join(' ')
    + ' <span class="sep" style="display:inline-block;vertical-align:middle"></span> '
    + [['all', 'Any source'], ['poly', 'Poly Pizza'], ['meshy', 'Meshy'], ['proc', 'Procedural']].map(([v, t]) => btn('src', v, t, source === v)).join(' ');
  box.querySelectorAll('[data-el]').forEach((b) => b.addEventListener('click', () => { element = b.dataset.el; renderFilters(); showTowers(); }));
  box.querySelectorAll('[data-src]').forEach((b) => b.addEventListener('click', () => { source = b.dataset.src; renderFilters(); showTowers(); }));
}
document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
  tab = b.dataset.tab;
  document.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('on', x === b));
  renderFilters();
  if (tab === 'towers') showTowers(); else showCreeps();
}));
document.getElementById('btn-attack').addEventListener('click', () => { for (const it of items) it.anim.playAttack?.(); });
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  labels.setSize(innerWidth, innerHeight);
});

renderFilters();
showTowers();

// The same idle motion the game applies, minus anything that needs a target.
const timer = new THREE.Timer();
renderer.setAnimationLoop((now) => {
  timer.update(now);
  const dt = Math.min(0.05, timer.getDelta()), T = timer.getElapsed();
  for (const { anim: A } of items) {
    A.mixer?.update(dt);
    for (const s of A.spin || []) s.obj.rotation[s.axis || 'y'] += s.speed * dt;
    for (const b of A.bob || []) b.obj.position.y = b.base + Math.sin(T * b.speed) * b.amp;
    for (const o of A.orbit || []) { const a = T * o.speed + o.phase; o.obj.position.set(Math.cos(a) * o.r, o.y, Math.sin(a) * o.r); }
    if (A.body) A.body.position.y = (A.bodyY ?? 2.6) + Math.sin(T * 3) * 0.15;
  }
  controls.update();
  renderer.render(scene, camera);
  labels.render(scene, camera);
  window.__galleryReady = true;
});
