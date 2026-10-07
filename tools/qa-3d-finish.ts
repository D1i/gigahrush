// QA отделки на синтетической модели (без ядра и пресетов): две комнаты через стену 0.1 м с проёмом,
// обои с несимметричным мотивом (видно зеркало/переворот), кафель 15 см под побелкой (dado 1.5 м),
// паркет и плитка на полу. Вид — ?view=0..4 (см. VIEWS), ?fin=0 — без отделки.
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { buildBabylonBlockout } from '../src/blockout/babylon';
import { DEFAULT_BLOCKOUT, type BlockoutModel, type RunFinish, type WallFace } from '../src/blockout/types';

const R = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1 });

/** Текстура из canvas: draw рисует один повтор size×size. */
function tex(size: number, draw: (c: CanvasRenderingContext2D, s: number) => void): string {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  draw(cv.getContext('2d')!, size);
  return cv.toDataURL('image/png');
}

// обои: зелёный фон, ромб-мотив и буква «Р» со стрелкой вверх — по ним видно ориентацию
const wallpaper = tex(256, (c, s) => {
  c.fillStyle = '#3f6b4a';
  c.fillRect(0, 0, s, s);
  c.fillStyle = '#5d8a62';
  c.beginPath();
  c.moveTo(s / 2, 10);
  c.lineTo(s - 10, s / 2);
  c.lineTo(s / 2, s - 10);
  c.lineTo(10, s / 2);
  c.closePath();
  c.fill();
  c.fillStyle = '#d8c98a';
  c.font = 'bold 90px sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText('Р↑', s / 2, s / 2);
});
// кафель 15 см: белая плитка с серой затиркой по краю повтора
const kafel = tex(128, (c, s) => {
  c.fillStyle = '#9aa3a6';
  c.fillRect(0, 0, s, s);
  c.fillStyle = '#e9eef0';
  c.fillRect(3, 3, s - 6, s - 6);
});
// паркет «ёлочкой» упрощённо: доски 0.1 × 0.5 м в повторе 0.5 м
const parquet = tex(256, (c, s) => {
  for (let k = 0; k < 5; k++) {
    c.fillStyle = k % 2 ? '#9a6a3c' : '#a8774a';
    c.fillRect((k * s) / 5, 0, s / 5, s);
    c.fillStyle = '#5a3a1e';
    c.fillRect((k * s) / 5, 0, 2, s);
    c.fillRect((k * s) / 5, ((k * 0.37) % 1) * s, s / 5, 2);
  }
});
const floorTile = tex(128, (c, s) => {
  c.fillStyle = '#6c5f55';
  c.fillRect(0, 0, s, s);
  c.fillStyle = '#b5a48f';
  c.fillRect(2, 2, s / 2 - 4, s / 2 - 4);
  c.fillRect(s / 2 + 2, s / 2 + 2, s / 2 - 4, s / 2 - 4);
  c.fillStyle = '#8c7a66';
  c.fillRect(s / 2 + 2, 2, s / 2 - 4, s / 2 - 4);
  c.fillRect(2, s / 2 + 2, s / 2 - 4, s / 2 - 4);
});

const fin = (id: string, name: string, surface: 'wall' | 'floor', color: string, t: string | null, tileW: number, tileH: number, dado: RunFinish['dado'] = null): RunFinish => ({
  id, name, surface, color, tex: t, hasTex: !!t, tileW, tileH, dado,
});

function model(): BlockoutModel {
  const H = 2.5;
  const W = (r: ReturnType<typeof R>, z0 = -0.2, z1 = H + 0.2) => ({ kind: 'wall' as const, rect: r, z0, z1 });
  const face = (inst: string, line: WallFace['line'], normal: WallFace['normal'], finish: string, z0 = 0, z1 = H, part: WallFace['part'] = 'wall'): WallFace => ({ inst, line, normal, z0, z1, part, finish });
  const room = (inst: string, x0: number, x1: number, f: string): WallFace[] => [
    face(inst, [x0, 0.2, x1, 0.2], [0, 1], f),
    face(inst, [x0, 3.2, x1, 3.2], [0, -1], f),
  ];
  return {
    format: 'room-forge-blockout', version: 1, units: 'm', axes: 'plan: x right, y down, z up', cellM: 0.1,
    options: { ...DEFAULT_BLOCKOUT },
    bounds: R(0, 0, 7.4, 3.4),
    solids: [
      W(R(0, 0, 7.4, 0.2)), W(R(0, 3.2, 7.4, 3.4)), W(R(0, 0.2, 0.2, 3.2)), W(R(7.2, 0.2, 7.4, 3.2)),
      W(R(4.2, 0.2, 4.3, 1.3)), W(R(4.2, 2.1, 4.3, 3.2)),
      { kind: 'lintel', rect: R(4.2, 1.3, 4.3, 2.1), z0: 2.1, z1: H + 0.2 },
      { kind: 'column', rect: R(2.8, 2.2, 3.2, 2.6), z0: 0, z1: H },
    ],
    floors: [
      { inst: 'a', rects: [R(0.2, 0.2, 4.2, 2.2), R(0.2, 2.2, 2.8, 2.6), R(3.2, 2.2, 4.2, 2.6), R(0.2, 2.6, 4.2, 3.2)], z: 0, finish: 'parquet' },
      { inst: 'b', rects: [R(4.3, 0.2, 7.2, 3.2)], z: 0, finish: 'floorTile' },
      { inst: null, rects: [R(4.2, 1.3, 4.3, 2.1)], z: 0, finish: null },
    ],
    ceilings: [
      { inst: 'a', rects: [R(0.2, 0.2, 4.2, 3.2)], z: H },
      { inst: 'b', rects: [R(4.3, 0.2, 7.2, 3.2)], z: H },
      { inst: null, rects: [R(4.2, 1.3, 4.3, 2.1)], z: H },
    ],
    openings: [{ a: { inst: 'a', connector: 'c1' }, b: { inst: 'b', connector: 'c0' }, rect: R(4.2, 1.3, 4.3, 2.1), axis: 'x', widthM: 0.8, heightM: 2.1 }],
    deadEnds: [{ inst: 'a', connector: 'c2', line: [1.4, 0.2, 2.2, 0.2], normal: [0, 1], widthM: 0.8, heightM: 2.1 }],
    faces: [
      ...room('a', 0.2, 4.2, 'wp'),
      face('a', [0.2, 0.2, 0.2, 3.2], [1, 0], 'wp'),
      face('a', [4.2, 0.2, 4.2, 1.3], [-1, 0], 'wp'),
      face('a', [4.2, 2.1, 4.2, 3.2], [-1, 0], 'wp'),
      face('a', [4.2, 1.3, 4.2, 2.1], [-1, 0], 'wp', 2.1, H, 'lintel'),
      // колонна в комнате a — четыре грани наружу
      face('a', [2.8, 2.2, 3.2, 2.2], [0, -1], 'wp'),
      face('a', [2.8, 2.6, 3.2, 2.6], [0, 1], 'wp'),
      face('a', [2.8, 2.2, 2.8, 2.6], [-1, 0], 'wp'),
      face('a', [3.2, 2.2, 3.2, 2.6], [1, 0], 'wp'),
      ...room('b', 4.3, 7.2, 'whitewash'),
      face('b', [7.2, 0.2, 7.2, 3.2], [-1, 0], 'whitewash'),
      face('b', [4.3, 0.2, 4.3, 1.3], [1, 0], 'whitewash'),
      face('b', [4.3, 2.1, 4.3, 3.2], [1, 0], 'whitewash'),
      face('b', [4.3, 1.3, 4.3, 2.1], [1, 0], 'whitewash', 2.1, H, 'lintel'),
    ],
    finishes: [
      fin('wp', 'Обои «Дамаск» (QA)', 'wall', '#3f6b4a', wallpaper, 0.5, 0.5),
      fin('whitewash', 'Побелка + кафель (QA)', 'wall', '#e4e1d8', null, 1, 1, { finishId: 'kafel', heightM: 1.5 }),
      fin('kafel', 'Кафель 15 см (QA)', 'wall', '#e9eef0', kafel, 0.15, 0.15),
      fin('parquet', 'Паркет (QA)', 'floor', '#a07040', parquet, 0.5, 0.5),
      fin('floorTile', 'Плитка пола (QA)', 'floor', '#8c7a66', floorTile, 0.6, 0.6),
    ],
    props: [{ inst: 'a', source: 'decor', propId: 'p', name: 'Шкаф', x: 0.6, y: 1.5, rot: 90, w: 1, d: 0.5, h: 2, color: '#8a5a33', tags: [] }],
    rooms: [
      { inst: 'a', roomId: 'a', name: 'A', tags: [], bbox: R(0.2, 0.2, 4.2, 3.2), anchor: [2.2, 1.7], tier: null, floorAreaM2: 12, finish: { wall: 'wp', floor: 'parquet' } },
      { inst: 'b', roomId: 'b', name: 'B', tags: [], bbox: R(4.3, 0.2, 7.2, 3.2), anchor: [5.75, 1.7], tier: null, floorAreaM2: 8.7, finish: { wall: 'whitewash', floor: 'floorTile' } },
    ],
    stats: { floorCells: 0, wallCells: 0, solids: 8, openings: 1, deadEnds: 1, ms: 0 },
    issues: [],
  };
}

// виды: [позиция плана x, y, высота глаз], [точка взгляда x, y, z]
const VIEWS: [number, number, number, number, number, number][] = [
  [3.6, 2.9, 1.6, 0.6, 0.4, 1.2], // a: северо-западный угол, панель тупика, шкаф
  [1.0, 1.7, 1.6, 4.3, 1.7, 1.6], // a: восточная стена с проёмом и перемычкой
  [6.8, 2.8, 1.6, 4.3, 0.4, 0.9], // b: кафель до 1.5 м, побелка, угол
  [4.6, 1.7, 0.6, 4.3, 1.0, 1.5], // b: вплотную к стыку у проёма, низкий взгляд — мерцание/швы
  [2.2, 1.7, 1.6, 3.0, 2.4, 1.2], // a: колонна — стыки граней по углам
  [3.7, 1.3, 2.25, 4.2, 1.3, 2.25], // a: вплотную к стыку стена | перемычка (край проёма y = 1.3)
];

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const engine = new Engine(canvas, params.get('aa') !== '0', undefined, true);
const scene = new Scene(engine);
scene.clearColor = new Color4(0.05, 0.05, 0.06, 1);
const hemi = new HemisphericLight('hemi', new Vector3(0.15, 1, -0.25), scene);
hemi.intensity = 0.85;
hemi.groundColor = new Color3(0.62, 0.6, 0.58);
const sun = new DirectionalLight('sun', new Vector3(-0.45, -1, 0.3), scene);
sun.intensity = 0.38;
const v = VIEWS[+(params.get('view') ?? 0)] ?? VIEWS[0];
const cam = new UniversalCamera('cam', new Vector3(v[0], v[2], -v[1]), scene);
cam.minZ = 0.05;
cam.fov = 1.15;
cam.setTarget(new Vector3(v[3], v[5], -v[4]));
const bo = buildBabylonBlockout(scene, model(), { finishes: params.get('fin') !== '0' });
// ?walls=0 — скрыть объёмы под облицовкой (отладка швов)
if (params.get('walls') === '0') for (const m of bo.walls) m.isVisible = false;
engine.runRenderLoop(() => scene.render());
scene.executeWhenReady(() => setTimeout(() => ((window as any).__ready = true), 300));
