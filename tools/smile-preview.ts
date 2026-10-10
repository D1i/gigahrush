// Превью «Улыбки» (src/view3d/smileModel.ts): тусклый коридор общаги (2 × 2.5 м, крашеные стены, линолеум, редкие
// лампы) с дверным проёмом в комнату и окном; девушка в позах peek / stand / window / pounce / eat, красные зрачки в
// темноте, струя крови из шеи манекена.
//  ?scene=peek|stand|window|pounce|eat|eyes|spurt|face  ?torn=0..1 ?lean=0..1 ?pounce=0..1
//  ?side=1|-1 (peek: с какой стороны коридора зритель — модель зеркалится) ?dist=м ?t=с (часы позы; ?play=1 — идут)
//  ?flash=0|1 (фонарь у камеры, по умолчанию 1) ?lit=1 (светло — проверка формы) ?ui=0 ?orbit=1 ?fov=рад
// Скриншоты: node tools/smile-preview-shots.mjs
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { SpotLight } from '@babylonjs/core/Lights/spotLight';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { SmileModel, RedEyes, BloodSpurt, SMILE_MODEL, type SmilePose } from '../src/view3d/smileModel';

const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d);
type SceneId = 'peek' | 'stand' | 'window' | 'pounce' | 'eat' | 'eyes' | 'spurt' | 'face';
const SCENES: SceneId[] = ['peek', 'stand', 'window', 'pounce', 'eat', 'eyes', 'spurt', 'face'];
const st = {
  scene: (q.get('scene') ?? 'peek') as SceneId,
  torn: num('torn', 0),
  lean: num('lean', 1),
  pounce: num('pounce', 0.6),
  side: (num('side', 1) < 0 ? -1 : 1) as -1 | 1,
  dist: num('dist', -1),
  t: num('t', 1.2),
  play: q.get('play') === '1',
  flash: q.get('flash') !== '0',
  lit: q.get('lit') === '1',
  orbit: q.get('orbit') === '1',
};
const DIST: Record<SceneId, number> = { peek: 6, stand: 6, window: 2.6, pounce: 1.05, eat: 2.8, eyes: 1.6, spurt: 2.3, face: 0.55 };

// ───────────────────────── сцена ─────────────────────────

const canvas = document.getElementById('c') as HTMLCanvasElement;
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
const scene = new Scene(engine);
scene.clearColor = new Color4(0.01, 0.01, 0.009, 1);
scene.ambientColor = Color3.Black();
const hemi = new HemisphericLight('hemi', new Vector3(0.1, 1, -0.2), scene);
hemi.diffuse = new Color3(1, 0.9, 0.74);
hemi.groundColor = new Color3(0.25, 0.22, 0.2);
hemi.specular = Color3.Black();
scene.fogMode = Scene.FOGMODE_LINEAR;
scene.fogStart = 4;
scene.fogEnd = 26;
scene.fogColor = new Color3(0.012, 0.011, 0.01);

const mat = (name: string, r: number, g: number, b: number, spec = 0.04) => {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = new Color3(r, g, b);
  m.specularColor = new Color3(spec, spec, spec);
  m.ambientColor = Color3.Black();
  m.maxSimultaneousLights = 8;
  return m;
};
const M = {
  green: mat('green', 0.24, 0.33, 0.27, 0.08),
  white: mat('white', 0.62, 0.6, 0.54),
  floor: mat('floor', 0.3, 0.2, 0.14, 0.1),
  ceil: mat('ceil', 0.5, 0.5, 0.47),
  room: mat('room', 0.32, 0.3, 0.27),
  frame: mat('frame', 0.36, 0.26, 0.17, 0.06),
  dark: mat('dark', 0.05, 0.05, 0.05),
  cloth: mat('cloth', 0.13, 0.15, 0.19),
  flesh: mat('flesh', 0.55, 0.46, 0.42),
};
const statics: Mesh[] = [];
function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, m: StandardMaterial): Mesh {
  const b = CreateBox('box', { width: x1 - x0, height: y1 - y0, depth: z1 - z0 }, scene);
  b.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  b.material = m;
  statics.push(b);
  return b;
}
/** стена с панелью: низ зелёный, верх побелка */
function wall(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) {
  const mid = 1.3;
  if (y0 < mid) box(x0, x1, y0, Math.min(mid, y1), z0, z1, M.green);
  if (y1 > mid) box(x0, x1, Math.max(mid, y0), y1, z0, z1, M.white);
}
const CW = 1, CH = 2.5, WT = 0.12;
const DOOR = { z0: 2.6, z1: 3.4, h: 2.05 };
const WIN = { z0: -3.1, z1: -1.9, y0: 0.85, y1: 2.0, gx: 1.06 };
// коридор
box(-CW, CW, -0.05, 0, -14, 16, M.floor);
box(-CW, CW, CH, CH + 0.05, -14, 16, M.ceil);
wall(-CW - WT, -CW, 0, CH, -14, DOOR.z0);
wall(-CW - WT, -CW, 0, CH, DOOR.z1, 16);
box(-CW - WT, -CW, DOOR.h, CH, DOOR.z0, DOOR.z1, M.white);
wall(CW, CW + WT, 0, CH, -14, WIN.z0);
wall(CW, CW + WT, 0, CH, WIN.z1, 16);
wall(CW, CW + WT, 0, WIN.y0, WIN.z0, WIN.z1);
box(CW, CW + WT, WIN.y1, CH, WIN.z0, WIN.z1, M.white);
wall(-CW, CW, 0, CH, -14.1, -14);
wall(-CW, CW, 0, CH, 16, 16.1);
// комната за дверью
box(-4.2, -CW - WT, -0.05, 0, 0.8, 5.2, M.floor);
box(-4.2, -CW - WT, CH, CH + 0.05, 0.8, 5.2, M.ceil);
box(-4.3, -4.2, 0, CH, 0.8, 5.2, M.room);
box(-4.2, -CW - WT, 0, CH, 0.7, 0.8, M.room);
box(-4.2, -CW - WT, 0, CH, 5.2, 5.3, M.room);
// рама и стекло окна, улица за ним
box(WIN.gx - 0.03, WIN.gx + 0.03, WIN.y0 - 0.04, WIN.y0, WIN.z0, WIN.z1, M.frame);
box(WIN.gx - 0.03, WIN.gx + 0.03, WIN.y1, WIN.y1 + 0.04, WIN.z0, WIN.z1, M.frame);
box(WIN.gx - 0.03, WIN.gx + 0.03, WIN.y0, WIN.y1, WIN.z0, WIN.z0 + 0.04, M.frame);
box(WIN.gx - 0.03, WIN.gx + 0.03, WIN.y0, WIN.y1, WIN.z1 - 0.04, WIN.z1, M.frame);
box(WIN.gx - 0.03, WIN.gx + 0.03, 1.2, 1.24, WIN.z0, WIN.z1, M.frame);
box(CW + WT, 5, -0.05, 0, -6, 1, M.dark);
const glassM = mat('glass', 0.3, 0.34, 0.33, 0.6);
glassM.alpha = 0.14;
glassM.specularPower = 120;
const glass = CreatePlane('glass', { width: WIN.z1 - WIN.z0, height: WIN.y1 - WIN.y0 }, scene);
glass.position.set(WIN.gx, (WIN.y0 + WIN.y1) / 2, (WIN.z0 + WIN.z1) / 2);
glass.rotation.y = Math.PI / 2;
glass.material = glassM;
glassM.backFaceCulling = false;
// лампы под потолком
const lamps: PointLight[] = [];
const lampGlow = mat('lampGlow', 0, 0, 0);
lampGlow.emissiveColor = new Color3(0.95, 0.88, 0.7);
for (const z of [-9, -4, 1.2, 6, 11]) {
  box(-0.08, 0.08, CH - 0.04, CH, z - 0.3, z + 0.3, lampGlow);
  const l = new PointLight('lamp', new Vector3(0, CH - 0.12, z), scene);
  l.diffuse = new Color3(1, 0.9, 0.72);
  l.specular = new Color3(0.3, 0.27, 0.22);
  l.range = 7;
  lamps.push(l);
}
const roomLamp = new PointLight('roomLamp', new Vector3(-2.8, CH - 0.2, 3), scene);
roomLamp.diffuse = new Color3(1, 0.85, 0.65);
roomLamp.range = 5;
// манекен-жертва (лежит на спине, голова к +z): шея — в neckAt
const dummy: Mesh[] = [];
function buildDummy(neck: Vector3, dirZ: number) {
  const add = (m: Mesh) => {
    dummy.push(m);
    statics.push(m);
    return m;
  };
  const head = add(CreateSphere('dHead', { diameter: 0.2, segments: 12 }, scene));
  head.position.set(neck.x, 0.1, neck.z + dirZ * 0.13);
  head.material = M.flesh;
  const nk = add(CreateCylinder('dNeck', { height: 0.1, diameter: 0.1 }, scene));
  nk.position.set(neck.x, 0.1, neck.z + dirZ * 0.02);
  nk.rotation.x = Math.PI / 2;
  nk.material = M.flesh;
  const body = add(CreateBox('dBody', { width: 0.42, height: 0.2, depth: 0.62 }, scene));
  body.position.set(neck.x, 0.11, neck.z - dirZ * 0.38);
  body.material = M.cloth;
  for (const sx of [-1, 1]) {
    const leg = add(CreateCylinder('dLeg', { height: 0.9, diameter: 0.14 }, scene));
    leg.rotation.x = Math.PI / 2;
    leg.position.set(neck.x + sx * 0.11, 0.08, neck.z - dirZ * 1.12);
    leg.material = M.cloth;
    const arm = add(CreateCylinder('dArm', { height: 0.62, diameter: 0.09 }, scene));
    arm.rotation.x = Math.PI / 2;
    arm.rotation.y = sx * 0.25;
    arm.position.set(neck.x + sx * 0.3, 0.06, neck.z - dirZ * 0.4);
    arm.material = M.cloth;
  }
}

// ───────────────────────── «Улыбка» ─────────────────────────

const girl = new SmileModel(scene);
const eyes = new RedEyes(scene);
const spurt = new BloodSpurt(scene);
for (const m of [...girl.meshes, ...eyes.meshes, ...spurt.meshes]) m.layerMask = 0x0fffffff;
const ucam = new UniversalCamera('cam', new Vector3(0, 1.6, -5), scene);
ucam.minZ = 0.03;
ucam.fov = num('fov', 1.0);
const acam = new ArcRotateCamera('orbit', -Math.PI / 2, 1.45, 3, new Vector3(0, 1.4, 0), scene);
acam.minZ = 0.03;
acam.wheelPrecision = 60;
acam.lowerRadiusLimit = 0.3;
let cam: Camera = ucam;
const flash = new SpotLight('flash', Vector3.Zero(), new Vector3(0, 0, 1), 0.9, 6, scene);
flash.diffuse = new Color3(1, 0.95, 0.85);
flash.specular = new Color3(0.4, 0.4, 0.38);
flash.range = 22;

const rootAt = (x: number, z: number, yaw: number) => {
  girl.root.position.set(x, 0, z);
  girl.root.rotation.set(0, yaw, 0);
};
const W2L = (lx: number, ly: number, lz: number) => {
  girl.root.computeWorldMatrix(true);
  return Vector3.TransformCoordinates(new Vector3(lx * girl.root.scaling.x, ly, lz), girl.root.getWorldMatrix());
};
let spurtNeck: Vector3 | null = null;
let spurtDir = new Vector3(0.35, 0.8, 0.3);
let setupAt = -1;

/** Расстановка сцены: где девушка, камера, свет. */
function setup() {
  const s = st.scene;
  const dist = st.dist > 0 ? st.dist : DIST[s];
  for (const m of dummy) m.setEnabled(false);
  girl.setVisible(s !== 'eyes' && s !== 'spurt');
  eyes.set(null);
  spurtNeck = null;
  spurt.clear();
  let eye = new Vector3(0.2, 1.6, -dist), tgt = new Vector3(0, 1.45, 0);
  const lit = st.lit ? 0.85 : 0.2;
  hemi.intensity = lit;
  for (const l of lamps) l.intensity = st.lit ? 0.4 : 0.42;
  lampGlow.emissiveColor.set(0.95, 0.88, 0.7);
  roomLamp.intensity = st.lit ? 0.4 : 0.12;
  if (s === 'peek') {
    // зритель — вдоль коридора со стороны side; ближний косяк — между ним и ей
    const vz = st.side > 0 ? DOOR.z1 + dist : DOOR.z0 - dist;
    eye = new Vector3(0.6, 1.62, vz);
    const pl = SmileModel.placePeekDoor(new Vector3(-CW, 0, (DOOR.z0 + DOOR.z1) / 2), new Vector3(1, 0, 0), DOOR.z1 - DOOR.z0, eye);
    girl.root.position.copyFrom(pl.position);
    girl.root.rotation.set(0, pl.yaw, 0);
    peekSide = pl.side;
    const P = SMILE_MODEL.peek;
    tgt = W2L(pl.side * P.head.x, P.head.y - 0.1, P.head.z);
  } else if (s === 'stand' || s === 'face') {
    rootAt(0, 0, Math.PI);
    if (s === 'face') {
      eye = new Vector3(0.04, SMILE_MODEL.headY - 0.02, -dist);
      tgt = new Vector3(0, SMILE_MODEL.headY - 0.03, 0);
    } else {
      eye = new Vector3(0.25, 1.62, -dist);
      tgt = new Vector3(0, 1.25, 0);
    }
  } else if (s === 'window') {
    const pl = SmileModel.placeWindow(new Vector3(WIN.gx, SMILE_MODEL.window.headY, (WIN.z0 + WIN.z1) / 2), new Vector3(-1, 0, 0), 0);
    girl.root.position.copyFrom(pl.position);
    girl.root.rotation.set(0, pl.yaw, 0);
    eye = new Vector3(Math.max(-0.85, WIN.gx - 0.4 - dist * 0.8), 1.6, (WIN.z0 + WIN.z1) / 2 - dist * 0.55);
    tgt = new Vector3(WIN.gx, 1.4, (WIN.z0 + WIN.z1) / 2);
  } else if (s === 'pounce') {
    rootAt(0, 0, Math.PI);
    eye = new Vector3(0.0, 1.58, -dist);
    tgt = new Vector3(0, 1.35, 0);
  } else if (s === 'eat') {
    rootAt(0, 0, Math.PI);
    const N = SMILE_MODEL.eat.neck;
    const neck = W2L(N.x, N.y, N.z);
    for (const m of dummy) m.setEnabled(true);
    if (!dummy.length) buildDummy(neck, 1);
    spurtNeck = neck;
    spurtDir = new Vector3(0.5, 0.75, -0.2);
    eye = new Vector3(0.9, 0.55 + dist * 0.15, -0.5 - dist * 0.12);
    tgt = new Vector3(0, 0.3, -0.3);
  } else if (s === 'eyes') {
    hemi.intensity = 0;
    for (const l of lamps) l.intensity = 0;
    roomLamp.intensity = 0;
    lampGlow.emissiveColor.set(0, 0, 0);
    eye = new Vector3(0, 1.6, -dist);
    tgt = new Vector3(0, 1.55, 0);
  } else if (s === 'spurt') {
    const neck = new Vector3(0, 0.12, -0.2);
    for (const m of dummy) m.setEnabled(true);
    if (!dummy.length) buildDummy(neck, 1);
    spurtNeck = neck;
    spurtDir = new Vector3(0.45, 0.8, -0.15);
    eye = new Vector3(0.75, 1.25, -0.3 - dist * 0.8);
    tgt = new Vector3(0, 0.35, -0.3);
  }
  // ?cam=x,y,z&tgt=x,y,z — свой ракурс (отладка)
  const cv = q.get('cam')?.split(',').map(Number), tv3 = q.get('tgt')?.split(',').map(Number);
  if (cv?.length === 3) eye = new Vector3(cv[0], cv[1], cv[2]);
  if (tv3?.length === 3) tgt = new Vector3(tv3[0], tv3[1], tv3[2]);
  ucam.position.copyFrom(eye);
  ucam.setTarget(tgt);
  acam.setTarget(tgt);
  acam.radius = Math.max(0.4, Vector3.Distance(eye, tgt));
  flash.setEnabled(st.flash && !st.lit && s !== 'eyes');
  // струя: прогнать до t
  if (spurtNeck) for (let k = 0; k < Math.round(Math.min(st.t, 8) * 60); k++) spurt.frame(1 / 60, spurtNeck, spurtDir, 0);
  setupAt = performance.now();
}
let peekSide: -1 | 1 = 1;

function pose(t: number): SmilePose {
  const s = st.scene;
  const camPos = cam.globalPosition.clone();
  const base: SmilePose = { pose: 'stand', lean: st.lean, side: 1, torn: st.torn, t, look: camPos };
  if (s === 'peek') return { ...base, pose: 'peek', side: peekSide };
  if (s === 'window') return { ...base, pose: 'window' };
  if (s === 'pounce') return { ...base, pose: 'pounce', pounce: st.pounce };
  if (s === 'eat') return { ...base, pose: 'eat', look: null };
  return base;
}

// ───────────────────────── кадр ─────────────────────────

let clock = st.t;
let last = performance.now();
let poseMs = 0, poseN = 0;
scene.onBeforeRenderObservable.add(() => {
  const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (st.play) clock += dt;
  if (girl.visible) {
    const t0 = performance.now();
    girl.setPose(pose(clock));
    poseMs += performance.now() - t0;
    poseN++;
  }
  if (st.scene === 'eyes') {
    // зрачки ходят вокруг (как в ловушке): полукругом перед камерой
    const a = clock * 0.9;
    const p = new Vector3(Math.sin(a) * 0.55, 1.5 + 0.05 * Math.sin(a * 2.3), -0.2 + Math.cos(a) * 0.25 - 0.4);
    eyes.set(p, cam.globalPosition, clock);
  }
  if (spurtNeck && st.play) spurt.frame(dt, spurtNeck, spurtDir, 0);
  flash.position.copyFrom(cam.globalPosition);
  flash.position.y -= 0.15;
  const fwd = cam.getDirection(Vector3.Forward());
  flash.direction.copyFrom(fwd);
});
engine.runRenderLoop(() => scene.render());
addEventListener('resize', () => engine.resize());

// ───────────────────────── интерфейс ─────────────────────────

const ui = document.getElementById('ui')!;
if (q.get('ui') === '0') ui.classList.add('off');
const sc = document.getElementById('scenes')!;
const bind = (id: 'torn' | 'lean' | 'pounce' | 'dist') => {
  const el = document.getElementById(id) as HTMLInputElement, lab = document.getElementById(id + 'V')!;
  const get = () => (id === 'dist' ? (st.dist > 0 ? st.dist : DIST[st.scene]) : st[id]);
  el.value = String(get());
  lab.textContent = get().toFixed(2);
  el.oninput = () => {
    (st as Record<string, unknown>)[id] = Number(el.value);
    lab.textContent = Number(el.value).toFixed(2);
    if (id === 'dist') setup();
  };
  return () => {
    el.value = String(get());
    lab.textContent = get().toFixed(2);
  };
};
const refreshers = (['torn', 'lean', 'pounce', 'dist'] as const).map(bind);
function refreshUi() {
  sc.innerHTML = '';
  SCENES.forEach((s, i) => {
    const b = document.createElement('button');
    b.textContent = `${i + 1} ${s}`;
    if (s === st.scene) b.className = 'on';
    b.onclick = () => select(s);
    sc.appendChild(b);
  });
  for (const r of refreshers) r();
  for (const [id, on] of [['side', st.side < 0], ['flash', st.flash], ['lit', st.lit], ['orbit', st.orbit]] as const) {
    document.getElementById(id)!.className = on ? 'on' : '';
  }
}
function select(s: SceneId) {
  st.scene = s;
  st.dist = -1;
  setup();
  refreshUi();
}
const toggle = (k: 'flash' | 'lit' | 'orbit') => {
  st[k] = !st[k];
  if (k === 'orbit') useCam();
  setup();
  refreshUi();
};
function useCam() {
  cam = st.orbit ? acam : ucam;
  scene.activeCamera = cam;
  for (const c of [ucam, acam]) c.detachControl();
  cam.attachControl(canvas, true);
  cam.layerMask = 0x0fffffff;
}
document.getElementById('side')!.onclick = () => {
  st.side = st.side > 0 ? -1 : 1;
  setup();
  refreshUi();
};
document.getElementById('flash')!.onclick = () => toggle('flash');
document.getElementById('lit')!.onclick = () => toggle('lit');
document.getElementById('orbit')!.onclick = () => toggle('orbit');
addEventListener('keydown', (e) => {
  const n = Number(e.key);
  if (n >= 1 && n <= SCENES.length) select(SCENES[n - 1]);
  else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    const d = e.key === 'ArrowRight' ? 0.05 : -0.05;
    if (st.scene === 'pounce') st.pounce = Math.min(1, Math.max(0, st.pounce + d));
    else st.lean = Math.min(1, Math.max(0, st.lean + d));
    refreshUi();
  } else if (e.key === 't' || e.key === 'T') {
    st.torn = st.torn > 0.5 ? 0 : 1;
    refreshUi();
  } else if (e.key === 's' || e.key === 'S') {
    st.side = st.side > 0 ? -1 : 1;
    setup();
    refreshUi();
  } else if (e.key === 'p' || e.key === 'P') st.play = !st.play;
});
useCam();
setup();
refreshUi();

// ───────────────────────── готовность (для скриншотов) ─────────────────────────

const info = document.getElementById('info')!;
setTimeout(() => {
  const tris = girl.meshes.reduce((a, m) => a + m.getTotalIndices() / 3, 0);
  const verts = girl.meshes.reduce((a, m) => a + m.getTotalVertices(), 0);
  // замер: 200 поз подряд
  const t0 = performance.now();
  if (girl.visible) for (let k = 0; k < 200; k++) girl.setPose(pose(clock + k * 0.016));
  const ms = (performance.now() - t0) / 200;
  if (girl.visible) girl.setPose(pose(clock));
  const head = girl.headLocal();
  const res = {
    scene: st.scene, tris, verts, poseMs: Number(ms.toFixed(3)), headLocal: { x: +head.x.toFixed(3), y: +head.y.toFixed(3), z: +head.z.toFixed(3) },
    head: girl.headPos().asArray().map((v) => +v.toFixed(3)), mouth: girl.mouthPos().asArray().map((v) => +v.toFixed(3)),
    neck: girl.neckPos().asArray().map((v) => +v.toFixed(3)), setupMs: Math.round(performance.now() - setupAt), avgFramePoseMs: +(poseMs / Math.max(1, poseN)).toFixed(3),
  };
  info.textContent = `tris ${tris}  verts ${verts}\nsetPose ${res.poseMs} мс\nголова ${JSON.stringify(res.headLocal)}`;
  setTimeout(() => {
    (window as unknown as { __smile: unknown }).__smile = res;
  }, 300);
}, 900);
