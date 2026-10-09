// Превью моделей общаги (src/view3d/assets/obshaga_props.glb через PropModels — как в игре): предметы в ряд у стены
// (стена — z = 0, предмет спиной к ней, как болванка мебели при rot = 0), подвесные — под потолком 2.5 м.
// ?view=0..N — группа предметов в кадре, ?dark=1 — темно (видно свечение), ?yaw=град — поворот камеры.
// Скриншоты: node tools/obshaga-preview-shots.mjs
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { PropModels } from '../src/view3d/propModels';
import obshagaUrl from '../src/view3d/assets/obshaga_props.glb?url';

const q = new URLSearchParams(location.search);
const CEIL = 2.5;
/** id, план w × d, подвесной */
const ITEMS: [string, number, number, boolean][] = [
  ['p_obsh_bed', 1.9, 0.8, false],
  ['p_obsh_nightstand', 0.4, 0.4, false],
  ['p_obsh_wardrobe', 0.8, 0.5, false],
  ['p_obsh_window', 1.4, 0.1, false],
  ['p_obsh_radiator', 0.8, 0.12, false],
  ['p_obsh_table', 1.2, 0.7, false],
  ['p_obsh_stool', 0.35, 0.35, false],
  ['p_obsh_chair', 0.45, 0.45, false],
  ['p_obsh_plafond', 0.3, 0.3, true],
  ['p_obsh_stove', 0.5, 0.6, false],
  ['p_obsh_sink', 0.55, 0.45, false],
  ['p_obsh_fridge', 0.6, 0.6, false],
  ['p_obsh_washer', 0.5, 0.5, false],
  ['p_obsh_tub', 0.6, 0.4, false],
  ['p_obsh_bucket', 0.3, 0.3, false],
  ['p_obsh_pipes', 2.0, 0.25, false],
  ['p_obsh_tube', 1.2, 0.15, true],
  ['p_obsh_toilet', 0.5, 0.6, false],
  ['p_obsh_partition', 0.05, 1.5, false],
  ['p_obsh_shower', 0.9, 0.9, false],
  ['p_obsh_bench', 1.0, 0.3, false],
  ['p_obsh_fire_ext', 0.2, 0.15, false],
  ['p_obsh_clock', 0.35, 0.06, false],
  ['p_obsh_vahter_desk', 1.2, 0.6, false],
  ['p_obsh_keyboard', 0.6, 0.08, false],
  ['p_obsh_noticeboard', 1.0, 0.05, false],
  ['p_obsh_sofa', 1.8, 0.8, false],
  ['p_obsh_tv', 0.5, 0.45, false],
  ['p_obsh_lantern', 0.25, 0.25, false],
  ['p_obsh_stair_flight', 1.2, 3.0, false],
];
/** Кадры: какие предметы в кадр. */
const VIEWS: string[][] = [
  ['p_obsh_bed', 'p_obsh_nightstand', 'p_obsh_wardrobe'],
  ['p_obsh_window', 'p_obsh_radiator', 'p_obsh_table'],
  ['p_obsh_table', 'p_obsh_stool', 'p_obsh_chair', 'p_obsh_plafond'],
  ['p_obsh_stove', 'p_obsh_sink', 'p_obsh_fridge'],
  ['p_obsh_washer', 'p_obsh_tub', 'p_obsh_bucket'],
  ['p_obsh_pipes', 'p_obsh_tube'],
  ['p_obsh_toilet', 'p_obsh_partition', 'p_obsh_shower'],
  ['p_obsh_bench', 'p_obsh_fire_ext', 'p_obsh_clock'],
  ['p_obsh_vahter_desk', 'p_obsh_keyboard', 'p_obsh_noticeboard'],
  ['p_obsh_sofa', 'p_obsh_tv', 'p_obsh_lantern'],
  ['p_obsh_stair_flight'],
  ['p_obsh_lantern'],
  ['p_obsh_vahter_desk'],
];

const canvas = document.getElementById('c') as HTMLCanvasElement;
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
const scene = new Scene(engine);
const dark = q.get('dark') === '1';
scene.clearColor = dark ? new Color4(0.01, 0.01, 0.012, 1) : new Color4(0.2, 0.21, 0.23, 1);
const hemi = new HemisphericLight('hemi', new Vector3(0.2, 1, -0.4), scene);
hemi.intensity = dark ? 0.05 : 0.55;
hemi.groundColor = new Color3(0.25, 0.24, 0.22);
hemi.specular = Color3.Black();
const sun = new DirectionalLight('sun', new Vector3(0.4, -0.7, 0.6), scene);
sun.intensity = dark ? 0.08 : 0.75;
sun.specular = new Color3(0.2, 0.2, 0.2);

const props = new PropModels(scene, [obshagaUrl]);
const flat = (name: string, hex: string) => {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = Color3.FromHexString(hex);
  m.specularColor = Color3.Black();
  return m;
};
const camera = new ArcRotateCamera('cam', -Math.PI / 2, 1.2, 5, Vector3.Zero(), scene);
camera.minZ = 0.02;
camera.attachControl(canvas, true);

void (async () => {
  await props.loaded;
  const placed = new Map<string, Mesh>();
  let x = 0;
  const missing: string[] = [];
  for (const [id, w, d, ceil] of ITEMS) {
    const tpl = props.get(id);
    const cx = x + w / 2;
    x += w + 0.5;
    if (!tpl) {
      missing.push(id);
      continue;
    }
    const v = tpl.clone(`v:${id}`, null, false);
    v.setEnabled(true);
    v.isVisible = true;
    // как болванка мебели: центр на плане, спиной к стене (z = 0), подвесное — под потолком
    v.position.set(cx, ceil ? CEIL : 0, -d / 2);
    placed.set(id, v);
  }
  const floor = MeshBuilder.CreateGround('floor', { width: x + 4, height: 8 }, scene);
  floor.position.set(x / 2, 0, -3.5);
  floor.material = flat('floorMat', '#6b5a48');
  const wall = MeshBuilder.CreatePlane('wall', { width: x + 4, height: CEIL }, scene);
  wall.position.set(x / 2, CEIL / 2, 0.001);
  wall.material = flat('wallMat', '#9aa39a');
  const ceil = MeshBuilder.CreatePlane('ceil', { width: x + 4, height: 3 }, scene);
  ceil.rotation.x = -Math.PI / 2;
  ceil.position.set(x / 2, CEIL, -1.5);
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
  (window as unknown as { __obsh: unknown }).__obsh = { models: props.size, missing, error: props.error, view, center: c.asArray().map((n) => +n.toFixed(2)) };
})();
addEventListener('resize', () => engine.resize());
