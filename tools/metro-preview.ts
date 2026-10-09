// Превью моделей метро (src/view3d/assets/metro_props.glb через PropModels — как в игре).
//  • ?view=0..N — группа предметов в ряд у стены (стена — z = 0, предмет спиной к ней, как болванка мебели при
//    rot = 0; подвесные — под потолком CEIL), камера-облёт: ?yaw=град, ?beta=рад, ?zoom=.
//  • ?hall=0..3 — макет зала `metro_hall_9` (контракт: пути 0–3, платформа, пилоны 0.8 × 1.2 через 4.5 м, неф 6–12,
//    потолок 4.5) из пяти кусков подряд, глазами игрока (1.6 м): 0 — вдоль нефа, 1 — с платформы на путевую стену,
//    2 — с края платформы вдоль путей, 3 — сверху.
//  • ?dark=1 — темно (видно свечение).
// Скриншоты: node tools/metro-preview-shots.mjs
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { PropModels } from '../src/view3d/propModels';
import metroUrl from '../src/view3d/assets/metro_props.glb?url';

const q = new URLSearchParams(location.search);
const CEIL = 4.5;
/** id, план w × d, подвесной */
const ITEMS: [string, number, number, boolean][] = [
  ['p_metro_track', 3.0, 9.0, false],
  ['p_metro_edge', 0.4, 9.0, false],
  ['p_metro_panel', 2.4, 0.06, false],
  ['p_metro_light', 3.0, 4.5, true],
  ['p_metro_light_strip', 0.3, 4.5, true],
  ['p_metro_bench', 2.4, 0.9, false],
  ['p_metro_sign', 1.6, 0.15, true],
  ['p_metro_turnstile', 0.2, 1.3, false],
  ['p_metro_kassa', 2.4, 1.2, false],
  ['p_metro_esc_booth', 1.3, 1.1, false],
  ['p_metro_esc_wreck', 6.0, 3.6, false],
  ['p_metro_debris', 1.2, 1.0, false],
  ['p_metro_clock', 0.8, 0.2, false],
  ['p_metro_gears', 2.0, 1.0, false],
  ['p_metro_cable', 2.0, 0.1, false],
  ['p_metro_mini_track', 1.5, 9.0, false],
  ['p_metro_mini_edge', 0.2, 9.0, false],
  ['p_metro_mini_panel', 1.2, 0.1, false],
  ['p_metro_micro_track', 0.75, 9.0, false],
  ['p_metro_micro_edge', 0.1, 9.0, false],
  ['p_metro_micro_panel', 0.6, 0.1, false],
];
/** Кадры: какие предметы в кадр. */
const VIEWS: string[][] = [
  ['p_metro_track', 'p_metro_edge'],
  ['p_metro_panel'],
  ['p_metro_light', 'p_metro_light_strip'],
  ['p_metro_bench', 'p_metro_sign'],
  ['p_metro_turnstile', 'p_metro_kassa'],
  ['p_metro_esc_booth'],
  ['p_metro_esc_wreck'],
  ['p_metro_debris', 'p_metro_clock', 'p_metro_cable'],
  ['p_metro_gears'],
  ['p_metro_mini_track', 'p_metro_mini_edge', 'p_metro_mini_panel', 'p_metro_micro_track', 'p_metro_micro_edge', 'p_metro_micro_panel'],
  ['p_metro_clock'],
  ['p_metro_turnstile'],
];

const canvas = document.getElementById('c') as HTMLCanvasElement;
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
const scene = new Scene(engine);
const dark = q.get('dark') === '1';
const hall = q.get('hall');
// свет — как в игре (src/view3d/viewer.ts)
scene.clearColor = dark ? new Color4(0.01, 0.01, 0.012, 1) : hall != null ? Color4.FromHexString('#0d0e10ff') : new Color4(0.2, 0.21, 0.23, 1);
scene.ambientColor = new Color3(0.12, 0.12, 0.12);
const hemi = new HemisphericLight('hemi', new Vector3(0.15, 1, -0.25), scene);
hemi.intensity = dark ? 0.05 : 0.85;
hemi.groundColor = new Color3(0.62, 0.6, 0.58);
hemi.specular = Color3.Black();
const sun = new DirectionalLight('sun', new Vector3(-0.45, -1, 0.3), scene);
sun.intensity = dark ? 0.04 : 0.38;
sun.specular = Color3.Black();

const props = new PropModels(scene, [metroUrl]);
const flat = (name: string, hex: string) => {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = Color3.FromHexString(hex);
  m.specularColor = new Color3(0.05, 0.05, 0.05);
  return m;
};

/** Клон модели как у болванки: план (x, y) → Babylon (x, 0, −y), rot — градусы, подвесное — под потолком ceil. */
function place(id: string, x: number, y: number, rot = 0, ceil = 0): Mesh | null {
  const tpl = props.get(id);
  if (!tpl) return null;
  const v = tpl.clone(`v:${id}:${x}:${y}`, null, false);
  v.setEnabled(true);
  v.isVisible = true;
  v.position.set(x, ceil, -y);
  v.rotation.y = (rot * Math.PI) / 180;
  return v;
}

function buildHall() {
  const N = 5, L = 9 * N, W = 18;
  const floor = MeshBuilder.CreateGround('floor', { width: W, height: L }, scene);
  floor.position.set(W / 2, 0, -L / 2);
  floor.material = flat('floorMat', '#C9B9A0');
  const ceil = MeshBuilder.CreatePlane('ceil', { width: W, height: L }, scene);
  ceil.rotation.x = -Math.PI / 2;
  ceil.position.set(W / 2, CEIL, -L / 2);
  ceil.material = flat('ceilMat', '#E2DED6');
  const trackWall = flat('trackWallMat', '#76857B');
  for (const [x, ry] of [[0, -Math.PI / 2], [W, Math.PI / 2]] as const) {
    const w = MeshBuilder.CreatePlane(`wall${x}`, { width: L, height: CEIL }, scene);
    w.rotation.y = ry;
    w.position.set(x, CEIL / 2, -L / 2);
    w.material = trackWall;
  }
  const marble = flat('pylonMat', '#E3DFD5');
  for (let k = 0; k < 2 * N; k++) {
    const y = 1.65 + 4.5 * k;
    for (const x of [5.6, 12.4]) {
      const b = MeshBuilder.CreateBox(`pylon${k}:${x}`, { width: 0.8, height: CEIL, depth: 1.2 }, scene);
      b.position.set(x, CEIL / 2, -y);
      b.material = marble;
    }
  }
  for (let p = 0; p < N; p++) {
    const y0 = 9 * p;
    place('p_metro_track', 1.5, y0 + 4.5, 0);
    place('p_metro_track', 16.5, y0 + 4.5, 180);
    place('p_metro_edge', 3.2, y0 + 4.5, 0);
    place('p_metro_edge', 14.8, y0 + 4.5, 180);
    for (const yc of [3.9, 8.4]) {
      place('p_metro_panel', 0.05, y0 + yc, 270);
      place('p_metro_panel', 17.95, y0 + yc, 90);
    }
    for (const yc of [2.25, 6.75]) {
      place('p_metro_light', 7.5, y0 + yc, 0, CEIL);
      place('p_metro_light', 10.5, y0 + yc, 0, CEIL);
      place('p_metro_light_strip', 4.1, y0 + yc, 0, CEIL);
      place('p_metro_light_strip', 13.9, y0 + yc, 0, CEIL);
    }
    place('p_metro_bench', 9, y0 + 3.9, 90);
    if (p % 2 === 1) place('p_metro_sign', 9, y0 + 8.4, 0, CEIL);
  }
  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogStart = 18;
  scene.fogEnd = 48;
  scene.fogColor = new Color3(0.051, 0.055, 0.063);
  const cams: [number[], number[]][] = [
    [[9, 1.6, -43.5], [9, 2.0, 0]],
    [[4.4, 1.6, -30], [0, 2.2, -27.5]],
    [[3.7, 1.6, -44], [2.4, 1.0, -20]],
    [[9, 9, -46], [9, 0, -30]],
  ];
  const [p, t] = cams[Number(hall) || 0] ?? cams[0];
  const cam = new UniversalCamera('cam', new Vector3(...(p as [number, number, number])), scene);
  cam.setTarget(new Vector3(...(t as [number, number, number])));
  cam.minZ = 0.05;
  cam.fov = Number(q.get('fov') ?? 0.9);
  return cam;
}

void (async () => {
  await props.loaded;
  if (hall != null) {
    buildHall();
    engine.runRenderLoop(() => scene.render());
    await new Promise((res) => setTimeout(res, 300));
    (window as unknown as { __metro: unknown }).__metro = { models: props.size, error: props.error, hall };
    return;
  }
  const camera = new ArcRotateCamera('cam', -Math.PI / 2, 1.2, 5, Vector3.Zero(), scene);
  camera.minZ = 0.02;
  const placed = new Map<string, Mesh>();
  let x = 0;
  const missing: string[] = [];
  for (const [id, w, d, ceil] of ITEMS) {
    const cx = x + w / 2;
    x += w + 0.6;
    const v = place(id, cx, d / 2, 0, ceil ? CEIL : 0);
    if (!v) {
      missing.push(id);
      continue;
    }
    placed.set(id, v);
  }
  const floor = MeshBuilder.CreateGround('floor', { width: x + 4, height: 14 }, scene);
  floor.position.set(x / 2, 0, -6.5);
  floor.material = flat('floorMat', '#8a7c68');
  const wall = MeshBuilder.CreatePlane('wall', { width: x + 4, height: CEIL }, scene);
  wall.position.set(x / 2, CEIL / 2, 0.001);
  wall.material = flat('wallMat', '#9aa39a');
  const ceil = MeshBuilder.CreatePlane('ceil', { width: x + 4, height: 6 }, scene);
  ceil.rotation.x = -Math.PI / 2;
  ceil.position.set(x / 2, CEIL, -3);
  ceil.material = flat('ceilMat', '#c8c4b8');
  const view = VIEWS[Number(q.get('view') ?? 0)] ?? VIEWS[0];
  let lo = new Vector3(Infinity, Infinity, Infinity), hi = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const id of view) {
    const v = placed.get(id);
    if (!v) continue;
    v.computeWorldMatrix(true);
    const b = v.getBoundingInfo().boundingBox;
    lo = Vector3.Minimize(lo, b.minimumWorld);
    hi = Vector3.Maximize(hi, b.maximumWorld);
  }
  const c = lo.add(hi).scale(0.5);
  const r = Math.max(0.4, hi.subtract(lo).length());
  camera.target = c;
  camera.alpha = -Math.PI / 2 + (Number(q.get('yaw') ?? 25) * Math.PI) / 180;
  camera.beta = Number(q.get('beta') ?? 1.25);
  camera.radius = r * Number(q.get('zoom') ?? 1.15);
  engine.runRenderLoop(() => scene.render());
  await new Promise((res) => setTimeout(res, 300));
  const spin = scene.meshes.filter((m) => m.name.includes('.rotor:')).map((m) => `${m.name.slice(m.name.lastIndexOf('.') + 1)}=${(m.rotationQuaternion?.toEulerAngles().z ?? 0).toFixed(2)}`);
  (window as unknown as { __metro: unknown }).__metro = { models: props.size, missing, error: props.error, view, center: c.asArray().map((n) => +n.toFixed(2)), animated: props.animated, spin };
})();
addEventListener('resize', () => engine.resize());
