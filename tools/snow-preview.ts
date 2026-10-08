// Превью снежных ходов (src/view3d/snowMesh.ts + snowView.ts) без мира: цепочка кусков — прямой лаз с горкой,
// поворот, развилка, берлога (лавка, глухой проём, завал). Вид — ?view=0..4, ?lamp=warm|cold, ?fog=0.
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { buildSnowPiece } from '../src/view3d/snowView';
import type { SnowDoor, SnowPieceSpec } from '../src/view3d/snowMesh';

const q = new URLSearchParams(location.search);
const door = (id: string, side: SnowDoor['side'], x: number, y: number, state: SnowDoor['state'] = 'open'): SnowDoor => {
  const n = { N: [0, 1], S: [0, -1], E: [-1, 0], W: [1, 0] }[side];
  return { id, side, x, y, nx: n[0], ny: n[1], half: 0.6, state };
};
const P = (x0: number, y0: number, x1: number, y1: number, doors: SnowDoor[], o: Partial<SnowPieceSpec> = {}): SnowPieceSpec => ({ x0, y0, x1, y1, floorY: 0, den: false, rise: 0, bench: false, seed: Math.round(x0 * 100 + y0 * 7), doors, ...o });
const pieces: SnowPieceSpec[] = [
  P(0, -3, 1.2, 0, [door('a', 'N', 0.6, -3), door('b', 'S', 0.6, 0)]),
  P(0, 0, 1.2, 3, [door('a', 'N', 0.6, 0), door('b', 'S', 0.6, 3)], { rise: 0.25 }),
  P(0, 3, 2, 5, [door('a', 'N', 0.6, 3), door('b', 'E', 2, 4.4)]),
  P(2, 3.8, 4.4, 6.2, [door('a', 'W', 2, 4.4), door('b', 'E', 4.4, 4.4), door('c', 'S', 3.2, 6.2)]),
  P(4.4, 2.9, 7.4, 5.9, [door('a', 'W', 4.4, 4.4), door('b', 'N', 5.9, 2.9), door('c', 'E', 7.4, 4.4, 'closed'), door('d', 'S', 5.9, 5.9, 'collapsed')], { den: true, bench: true }),
  P(2.6, 6.2, 3.8, 9.2, [door('a', 'N', 3.2, 6.2), door('b', 'S', 3.2, 9.2)], { rise: -0.3 }),
];

const canvas = document.getElementById('c') as HTMLCanvasElement;
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
const scene = new Scene(engine);
scene.clearColor = new Color4(0.01, 0.012, 0.018, 1);
scene.ambientColor = new Color3(0, 0, 0);
if (q.get('fog') !== '0') {
  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogColor = new Color3(0.01, 0.012, 0.018);
  scene.fogStart = 1.5;
  scene.fogEnd = 8;
}
const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
hemi.intensity = Number(q.get('amb') ?? 0.12);
hemi.diffuse = new Color3(0.7, 0.8, 1);
hemi.groundColor = new Color3(0.3, 0.32, 0.38);
hemi.specular = Color3.Black();
const lamp = new PointLight('lamp', Vector3.Zero(), scene);
lamp.diffuse = q.get('lamp') === 'cold' ? new Color3(0.8, 0.9, 1) : new Color3(1, 0.78, 0.5);
lamp.specular = lamp.diffuse.scale(0.6);
lamp.range = 5;
lamp.intensity = Number(q.get('li') ?? 0.9);
let tris = 0, ms = 0;
for (const [k, s] of pieces.entries()) {
  const m = buildSnowPiece(scene, 'p' + k, s);
  tris += m.shell.getTotalIndices() / 3;
  ms += m.ms;
}
// вид: глаз (x, y плана, высота) → цель (x, y плана, высота); Babylon: X = x, Y = высота, Z = −y плана
const VIEWS: [number, number, number, number, number, number][] = [
  [0.6, 2.6, 0.5, 0.6, -3, 0.45], // в лазе с горкой, смотрим вперёд
  [0.6, -2.5, 0.5, 0.6, 3, 0.5], // назад, на горку и поворот
  [5.2, 4.2, 1.05, 7.4, 4.4, 0.5], // в берлоге: на глухой проём
  [5.9, 3.6, 1.05, 5.9, 6.5, 0.2], // в берлоге: на завал
  [3.0, 4.6, 0.5, 3.2, 8, 0.3], // развилка → яма
  [3.5, 4.5, 9, 3.5, 4.4, 0], // сверху
  [1.0, 4.2, 0.5, 4.4, 4.4, 0.4], // из поворота в развилку и берлогу
];
const v = VIEWS[Number(q.get('view') ?? 0)] ?? VIEWS[0];
const cam = new UniversalCamera('cam', new Vector3(v[0], v[2], -v[1]), scene);
cam.setTarget(new Vector3(v[3], v[5], -v[4]));
cam.fov = 1.15;
cam.minZ = 0.03;
lamp.position.copyFrom(cam.position).addInPlaceFromFloats(0, 0.3, 0);
(window as unknown as { __snow: unknown }).__snow = { tris, ms };
engine.runRenderLoop(() => scene.render());
