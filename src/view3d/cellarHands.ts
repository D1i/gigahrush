// Руки от первого лица в щели погреба (src/view3d/cellarWalk.ts): протискиваешься боком лицом к стене — свои ладони в
// тёмных грязных х/б перчатках плашмя на земле, по нижним краям кадра: видны пальцы, костяшки и верх кисти, остальное
// за краем; пальцы вверх, чуть врозь и наружу, большие пальцы — к середине; манжета перчатки, рукав ватника уходит вниз
// за край кадра. Без ассетов: примитивы, слитые в меши — на руку кисть (тыльная сторона, костяшки, большой палец,
// манжета, рукав) и четыре пальца на шарнирах у костяшек: 10 мешей на обе руки, один матовый материал (вязка и грязь —
// текстура, цвет частей — в вершинах: перчатка, тёмные костяшки, кончики в земле, манжета, рукав).
//
// Где: ладонь — на плоскости стены (dist, delta — лучи в коллайдеры, cellarWalk), по краю кадра: вбок — доля полуширины
// кадра на глубине ладони (широкий экран — руки шире), вниз — у нижнего края. Кисть меньше натуральной (HAND_SCALE):
// перчатка в 11 см от глаза в натуральную величину закрывает полкадра. Бугры земли: лучи probe (поле оболочки погреба,
// src/view3d/cellarMesh.ts cellarRay) у середины ладони и у кончиков пальцев — кисть ложится на землю (вглубь впадины,
// к себе на бугре), пальцы на шарнирах у костяшек сгибаются к земле / от неё.
//
// Приставной шаг — фаза по пути вбок (src/locations/cellarSqueeze.ts stepShuffle): ладони по очереди перехватывают
// стену — та, что идёт в сторону хода, чуть отрывается (пальцы от земли) и уходит вбок, упёртая — скользит назад. Стоит —
// дыхание. Стена под углом (в щели можно повернуться на ~±50°) — ладони на её плоскости, развёрнуты вдоль неё. Своего
// свечения почти нет: видно в свете фонаря и отсвета у груди ('cellar:near', cellarWalk). Рисуются поверх стен (группа
// рендера 1). Узел рук — у глаза и по повороту взгляда, без наклона и крена камеры: стена вертикальна, ладони на ней
// тоже — посмотрел вниз или качнулась голова — руки остаются на стене.
import type { Scene } from '@babylonjs/core/scene';
import type { TargetCamera } from '@babylonjs/core/Cameras/targetCamera';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';

/** Кисть меньше натуральной во столько раз (вплотную к глазу натуральная закрывает полкадра). */
export const HAND_SCALE = 0.62;
/** Середина ладони вбок — на доле EDGE_X полуширины кадра на её глубине, но в пределах [PALM_X_MIN, PALM_X_MAX] м;
 *  вниз — на доле EDGE_Y полувысоты кадра (у нижнего края: видны пальцы и верх кисти). */
export const EDGE_X = 1;
export const EDGE_Y = 1.1;
export const PALM_X_MIN = 0.05;
export const PALM_X_MAX = 0.16;
/** Ход перехвата вбок, м. */
export const PALM_SLIDE = 0.022;
/** Пальцы наружу от вертикали, рад. */
export const HAND_ROLL = 0.2;
/** Ладонь ближе стольких м / дальше — не на стене (z взгляда). */
export const PALM_Z_MIN = 0.08;
export const PALM_Z_MAX = 0.42;
/** Стена дальше стольких м или под углом больше WALL_MAX_DELTA — рук на стене нет. */
export const WALL_FAR = 0.5;
export const WALL_MAX_DELTA = 1.05;
/** Бугры земли: кисть сдвигается по нормали стены не больше чем на [−, +] м (− — к себе), палец гнётся на [−, +] рад. */
const PALM_E: readonly [number, number] = [-0.03, 0.05];
const FINGER_BEND: readonly [number, number] = [-0.4, 0.55];
/** Лучи рук в землю: начало — на столько м перед ладонью (к себе), длина. */
const PROBE_BACK = 0.08;
const PROBE_LEN = 0.2;

/** Поле взгляда: тангенсы половины угла обзора по горизонтали и вертикали. */
export interface ViewTan {
  tx: number;
  ty: number;
}

export interface PalmPose {
  /** середина ладони на стене в осях взгляда без наклона (x вправо, y вверх, z вперёд по горизонтали; начало — глаз) */
  x: number;
  y: number;
  z: number;
  /** поворот ладони вдоль стены (рад, вокруг вертикали камеры) */
  yaw: number;
  /** 0…1 — оторвана от стены (идёт вбок) */
  lift: number;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Поза ладони side (−1 левая, 1 правая) у стены: phase — фаза приставного шага (рад), dir — сторона хода (1 — вправо),
 * dist — до стены по её нормали от глаза (м), delta — угол от взгляда до направления на стену (рад, + — стена правее),
 * view — поле взгляда (руки — у краёв кадра на глубине ладони).
 */
export function wallPalm(phase: number, side: -1 | 1, dir: 1 | -1, dist: number, delta: number, view: ViewTan, breathe = 0, edge = { x: EDGE_X, y: EDGE_Y }): PalmPose {
  const ph = phase + (side > 0 ? 0 : Math.PI);
  const lift = Math.max(0, Math.cos(ph));
  const s = Math.sin(delta), c = Math.max(0.2, Math.cos(delta));
  // на плоскости стены: (x, z)·(sin δ, cos δ) = dist − отрыв; x — у края кадра на глубине z (сходится за пару шагов)
  const d = dist - 0.01 * lift;
  let z = clamp(d / c, PALM_Z_MIN, PALM_Z_MAX);
  let x = 0;
  for (let k = 0; k < 3; k++) {
    x = side * clamp(edge.x * view.tx * z, PALM_X_MIN, PALM_X_MAX) + dir * PALM_SLIDE * Math.sin(ph);
    z = clamp((d - x * s) / c, PALM_Z_MIN, PALM_Z_MAX);
  }
  return { x, y: -edge.y * view.ty * z + 0.006 * lift + breathe, z, yaw: delta, lift };
}

/** Луч в землю (мир Babylon, d — единичный): расстояние или null (не попал / оболочки нет). */
export type WallProbe = (o: Vector3, d: Vector3, max: number) => number | null;

// ───────────────────────── модель кисти ─────────────────────────
// Оси кисти (правая; левая — зеркально по x): x — вправо (к мизинцу), y — вверх (к пальцам), z — к стене; z = 0 —
// плоскость ладони на стене (тыльная сторона — к глазу, z < 0). Размеры — натуральные (перчатка), масштаб — HAND_SCALE.

/** Пальцы (указательный … мизинец): x основания (у правой), длина, толщина, веер (рад, + — к большому пальцу). */
const FINGERS: readonly { x: number; len: number; d: number; fan: number }[] = [
  { x: -0.027, len: 0.068, d: 0.0195, fan: 0.1 },
  { x: -0.009, len: 0.076, d: 0.02, fan: 0.025 },
  { x: 0.009, len: 0.071, d: 0.019, fan: -0.05 },
  { x: 0.026, len: 0.056, d: 0.0165, fan: -0.15 },
];
/** Костяшки — на такой высоте кисти. */
const KNUCKLE_Y = 0.046;
/** Фаланги: доли длины и сгиб (рад, накопленный; + — к стене): от костяшки чуть вверх, кончик прижат к земле. */
const PHALANX: readonly [number, number][] = [[0.49, -0.07], [0.29, 0.08], [0.22, 0.24]];

/** Цвета частей (в вершинах; материал — белый × текстура): перчатка, костяшки, кончики в земле, манжета, рукав. */
const GLOVE = [0.3, 0.28, 0.25];
const KNUCKLE = [0.25, 0.23, 0.2];
const DIRT = [0.19, 0.14, 0.095];
const CUFF = [0.34, 0.32, 0.28];
const SLEEVE = [0.2, 0.21, 0.17];

function paint(m: Mesh, col: (x: number, y: number, z: number) => readonly number[]): Mesh {
  const p = m.getVerticesData(VertexBuffer.PositionKind)!;
  const n = p.length / 3;
  const c = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const v = col(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
    c[i * 4] = v[0];
    c[i * 4 + 1] = v[1];
    c[i * 4 + 2] = v[2];
    c[i * 4 + 3] = 1;
  }
  m.setVerticesData(VertexBuffer.ColorKind, c);
  return m;
}
const flat = (m: Mesh, c: readonly number[]) => paint(m, () => c);
const mix = (a: readonly number[], b: readonly number[], t: number) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Цилиндр по отрезку a → b (диаметры у a и у b). */
function limb(scene: Scene, a: Vector3, b: Vector3, da: number, db: number, tess: number): Mesh {
  const d = b.subtract(a);
  const len = d.length();
  const m = MeshBuilder.CreateCylinder('cellar:limb', { height: len, diameterBottom: da, diameterTop: db, tessellation: tess }, scene);
  m.position.copyFrom(a.add(d.scale(0.5)));
  const ax = d.scale(1 / len);
  m.rotation.set(Math.acos(clamp(ax.y, -1, 1)), Math.atan2(ax.x, ax.z), 0);
  return m;
}

function ball(scene: Scene, at: Vector3, sx: number, sy: number, sz: number, seg = 6): Mesh {
  const m = MeshBuilder.CreateSphere('cellar:ball', { diameter: 1, segments: seg }, scene);
  m.scaling.set(sx, sy, sz);
  m.position.copyFrom(at);
  return m;
}

function merge(parts: Mesh[], name: string): Mesh {
  const m = Mesh.MergeMeshes(parts, true, true)!;
  m.name = name;
  return m;
}

/** Палец по оси y от шарнира (0, 0, 0), подушечка — на z = 0 (ось — на −d/2): фаланги, суставы, кончик в земле. */
function fingerMesh(scene: Scene, len: number, d: number): Mesh {
  const parts: Mesh[] = [];
  const p = new Vector3(0, 0, -d / 2);
  let dk = d;
  for (const [share, bend] of PHALANX) {
    const l = len * share;
    const q = p.add(new Vector3(0, Math.cos(bend) * l, Math.sin(bend) * l));
    const d1 = dk * 0.93;
    parts.push(limb(scene, p, q, dk, d1, 10));
    // сустав вровень с фалангами (без «шариков»); на конце — подушечка кончика, чуть вытянутая
    parts.push(ball(scene, q, d1, d1 * (share < 0.25 ? 1.2 : 1), d1, 8));
    p.copyFrom(q);
    dk = d1;
  }
  const m = merge(parts, 'cellar:finger');
  // кончики — в земле (от середины средней фаланги), выше — чистая перчатка
  return paint(m, (_x, y) => mix(GLOVE, DIRT, 0.85 * clamp((y - len * 0.55) / (len * 0.4), 0, 1)));
}

/** Кисть без четырёх пальцев: тыльная сторона, костяшки, большой палец, манжета, рукав ватника (вниз-назад-наружу). */
function backMesh(scene: Scene, side: -1 | 1): Mesh {
  const s = side;
  const parts: Mesh[] = [];
  // тыльная сторона кисти: приплюснутый «скруглённый брусок» (сфера, раздутая к углам; ладонь — на z = 0)
  const back = ball(scene, new Vector3(0.003 * s, -0.004, -0.013), 0.088, 0.1, 0.026, 14);
  const bp = back.getVerticesData(VertexBuffer.PositionKind)!;
  const boxy = (v: number) => 0.5 * Math.sign(v) * Math.pow(Math.min(1, Math.abs(v) / 0.5), 0.6);
  for (let i = 0; i < bp.length; i += 3) {
    bp[i] = boxy(bp[i]);
    bp[i + 1] = boxy(bp[i + 1]);
  }
  back.updateVerticesData(VertexBuffer.PositionKind, bp);
  parts.push(flat(back, GLOVE));
  // костяшки — пологие бугорки у оснований пальцев
  for (const f of FINGERS) parts.push(flat(ball(scene, new Vector3(f.x * s, KNUCKLE_Y - 0.006, -0.017), f.d * 1.05, f.d * 0.85, f.d * 0.55), KNUCKLE));
  // большой палец: от низа кисти у края — вверх и к середине, вдоль кромки кисти, лежит на стене
  const a = 0.6;
  const u = new Vector3(-s * Math.sin(a), Math.cos(a), 0);
  let p = new Vector3(-0.036 * s, -0.026, -0.012);
  const seg: [number, number, number][] = [[0.03, 0.025, 0.022], [0.024, 0.022, 0.02], [0.02, 0.02, 0.018]];
  for (let k = 0; k < seg.length; k++) {
    const [l, d0, d1] = seg[k];
    const dir = u.add(new Vector3(0, 0, 0.1 * k)).normalize();
    const q = p.add(dir.scale(l));
    parts.push(flat(limb(scene, p, q, d0, d1, 10), k === 2 ? DIRT : GLOVE));
    parts.push(flat(ball(scene, q, d1, k === 2 ? d1 * 1.2 : d1, d1, 8), k === 2 ? DIRT : GLOVE));
    p = q;
  }
  // манжета и рукав: от запястья вниз, к себе и наружу (к локтю за краем кадра)
  const wrist = new Vector3(0.002 * s, -0.05, -0.014);
  const fa = new Vector3(0.3 * s, -1, -0.42).normalize();
  const c1 = wrist.add(fa.scale(0.05));
  parts.push(flat(limb(scene, wrist.add(fa.scale(-0.004)), c1, 0.062, 0.068, 12), CUFF));
  // резинка манжеты — валик у края
  parts.push(flat(limb(scene, c1.add(fa.scale(-0.006)), c1.add(fa.scale(0.004)), 0.071, 0.071, 12), mix(CUFF, DIRT, 0.4)));
  parts.push(flat(limb(scene, c1.add(fa.scale(0.002)), wrist.add(fa.scale(0.42)), 0.084, 0.11, 10), SLEEVE));
  return merge(parts, `cellar:handBack${s}`);
}

/** Текстура: вязка х/б перчатки (петли рядами) и пятна земли; средняя яркость ~0.9. */
function knitTexture(scene: Scene): Texture | null {
  if (typeof document === 'undefined') return null;
  const N = 64;
  const px = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      // петли: столбики «ёлочкой» (v), ряды
      const col = x % 4, row = y % 3;
      const loop = 0.9 + 0.08 * Math.cos(((col + (row === 1 ? 0.5 : 0)) / 4) * Math.PI * 2) - (row === 0 ? 0.06 : 0);
      // пятна земли: несколько гармоник (повтор без шва)
      const dirt = 0.5 + 0.25 * Math.sin((x / N) * Math.PI * 2 * 3 + Math.sin((y / N) * Math.PI * 2 * 2) * 1.7) + 0.25 * Math.sin((y / N) * Math.PI * 2 * 5 + (x / N) * Math.PI * 2 * 2);
      const k = loop * (1 - 0.18 * clamp(dirt - 0.45, 0, 1));
      const o = (y * N + x) * 4;
      px[o] = Math.round(clamp(k * (1 + 0.02 * dirt), 0, 1) * 255);
      px[o + 1] = Math.round(clamp(k, 0, 1) * 255);
      px[o + 2] = Math.round(clamp(k * (1 - 0.05 * dirt), 0, 1) * 255);
      px[o + 3] = 255;
    }
  }
  const t = RawTexture.CreateRGBATexture(px, N, N, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
  t.name = 'cellar:knit';
  t.wrapU = t.wrapV = Texture.WRAP_ADDRESSMODE;
  t.uScale = 3;
  t.vScale = 3;
  return t;
}

interface Hand {
  side: -1 | 1;
  node: TransformNode;
  fingers: Mesh[];
  /** кисть по нормали стены от плоскости (бугры), м; изгиб пальцев, рад — сглажены */
  e: number;
  bend: number[];
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const TIP = new Vector3(), O = new Vector3(), N = new Vector3();

export class WallHands {
  readonly root: TransformNode;
  private hands: Hand[] = [];
  private mat: StandardMaterial;
  private tex: Texture | null;
  /** видны 0…1 (появляются и прячутся плавно — уходят вниз) */
  private shown = 0;
  private t = 0;
  /** стена: последняя известная (рук нет — держать, пока прячутся) */
  private dist = 0.25;
  private delta = 0;
  /** лучей в землю за последний кадр (QA) */
  rays = 0;
  /** поза (QA подбирает на лету): масштаб кисти, края кадра, пальцы наружу */
  tune = { scale: HAND_SCALE, edgeX: EDGE_X, edgeY: EDGE_Y, roll: HAND_ROLL };

  constructor(
    scene: Scene,
    private readonly camera: TargetCamera,
  ) {
    this.root = new TransformNode('cellar:hands', scene);
    // тёмная грязная х/б перчатка: матовая, цвет частей — в вершинах
    const m = (this.mat = new StandardMaterial('cellar:glove', scene));
    m.diffuseColor = Color3.White();
    m.specularColor = new Color3(0.03, 0.028, 0.025);
    m.specularPower = 6;
    m.emissiveColor = Color3.Black();
    this.tex = knitTexture(scene);
    if (this.tex) m.diffuseTexture = this.tex;
    const fingerTpl = FINGERS.map((f) => fingerMesh(scene, f.len, f.d));
    for (const side of [-1, 1] as const) {
      const node = new TransformNode(`cellar:hand${side}`, scene);
      node.parent = this.root;
      node.scaling.setAll(HAND_SCALE);
      const back = backMesh(scene, side);
      back.parent = node;
      const fingers: Mesh[] = [];
      FINGERS.forEach((f, k) => {
        const fm = side > 0 ? fingerTpl[k] : (fingerTpl[k].clone(`cellar:finger${k}`) as Mesh);
        fm.name = `cellar:finger${side}:${k}`;
        fm.parent = node;
        fm.position.set(f.x * side, KNUCKLE_Y, 0);
        fm.rotation.set(0, 0, f.fan * side);
        fingers.push(fm);
      });
      for (const x of [back, ...fingers]) {
        x.material = m;
        x.isPickable = false;
        x.checkCollisions = false;
        x.renderingGroupId = 1;
        x.alwaysSelectAsActiveMesh = true;
        x.layerMask = 0x0fffffff;
      }
      this.hands.push({ side, node, fingers, e: 0, bend: FINGERS.map(() => 0) });
    }
    this.root.setEnabled(false);
  }

  /** Видны ли сейчас (QA). */
  get visible(): boolean {
    return this.root.isEnabled();
  }

  /** Поле взгляда камеры (тангенсы половины угла по горизонтали и вертикали). */
  private viewTan(): ViewTan {
    const cam = this.camera;
    const eng = cam.getScene().getEngine();
    const aspect = eng.getAspectRatio(cam) || 1;
    const t = Math.tan(cam.fov / 2);
    // fovMode 0 — вертикальный угол задан (по умолчанию), 1 — горизонтальный
    return cam.fovMode === 1 ? { tx: t, ty: t / aspect } : { tx: t * aspect, ty: t };
  }

  /**
   * Кадр: on — руки на стене (боком в щели), phase / dir — приставной шаг, wall — стена перед лицом (dist — по её
   * нормали от глаза, delta — угол от взгляда; null — нет), dt — с, lit — 0…1 горит фонарь (едва заметный отсвет на
   * перчатках), probe — лучи в землю (бугры под ладонью и пальцами; нет — плоскость стены).
   */
  update(on: boolean, phase: number, dir: 1 | -1, wall: { dist: number; delta: number } | null, dt: number, lit = 0, probe?: WallProbe | null) {
    this.t += dt;
    this.rays = 0;
    const can = on && !!wall && wall.dist < WALL_FAR && Math.abs(wall.delta) < WALL_MAX_DELTA;
    if (can && wall) {
      // стена «прыгает» (угол, другая стена) — ладони переходят к ней плавно
      const k = Math.min(1, dt * 14);
      this.dist += (wall.dist - this.dist) * k;
      this.delta += (wall.delta - this.delta) * k;
    }
    this.shown = Math.min(1, Math.max(0, this.shown + (can ? dt : -dt) / 0.28));
    const vis = this.shown > 0.01;
    if (vis !== this.root.isEnabled()) this.root.setEnabled(vis);
    if (!vis) return;
    // у глаза, по повороту взгляда (без наклона и крена)
    const yaw = this.camera.rotation.y;
    this.root.position.copyFrom(this.camera.position);
    this.root.rotation.set(0, yaw, 0);
    const hide = 1 - smooth(this.shown);
    const view = this.viewTan();
    const breathe = 0.003 * Math.sin(this.t * 1.9);
    const g = 0.012 * Math.min(1, Math.max(0, lit));
    this.mat.emissiveColor.set(g, g * 0.92, g * 0.8);
    // нормаль стены (к земле): в осях узла и в мире
    const nx = Math.sin(this.delta), nz = Math.cos(this.delta);
    N.set(Math.sin(yaw + this.delta), 0, Math.cos(yaw + this.delta));
    const kS = Math.min(1, dt * 12);
    const tn = this.tune, edge = { x: tn.edgeX, y: tn.edgeY };
    const rays = !!probe && this.shown > 0.5;
    if (rays) this.root.computeWorldMatrix(true);
    for (const h of this.hands) {
      const s = h.side;
      const p = wallPalm(phase, s, dir, this.dist, this.delta, view, breathe * (s > 0 ? 1 : 0.7), edge);
      // прячутся — вниз и к себе; бугры — по нормали стены
      const x = p.x * (1 - 0.3 * hide) + nx * h.e, y = p.y - 0.2 * hide, z = p.z - 0.06 * hide + nz * h.e;
      h.node.position.set(x, y, z);
      h.node.rotation.set(-0.12 * p.lift, p.yaw, -s * tn.roll);
      h.node.scaling.setAll(tn.scale);
      if (rays) {
        const wm = h.node.computeWorldMatrix(true);
        // середина ладони: насколько земля дальше / ближе плоскости, где кисть сейчас
        Vector3.TransformCoordinatesToRef(Vector3.ZeroReadOnly, wm, TIP);
        const e0 = this.cast(probe!, TIP);
        if (e0 !== null) h.e += (clamp(h.e + e0, PALM_E[0], PALM_E[1]) - h.e) * kS;
        // кончики пальцев (прямой палец на плоскости ладони): земля там дальше — палец к ней, ближе — от неё
        FINGERS.forEach((f, k) => {
          const a = f.fan * s;
          TIP.set(f.x * s - Math.sin(a) * f.len, KNUCKLE_Y + Math.cos(a) * f.len, 0);
          Vector3.TransformCoordinatesToRef(TIP, wm, TIP);
          const e = this.cast(probe!, TIP);
          const want = e === null ? 0 : clamp(Math.atan2((e0 === null ? e : e - e0) / tn.scale, f.len), FINGER_BEND[0], FINGER_BEND[1]);
          h.bend[k] += (want - h.bend[k]) * kS;
        });
      }
      // оторванная ладонь — пальцы от земли
      h.fingers.forEach((m, k) => (m.rotation.x = h.bend[k] - 0.25 * p.lift));
    }
  }

  /** Луч в землю по нормали стены из точки на ладони (мир): насколько земля дальше (+) / ближе (−) неё, м. */
  private cast(probe: WallProbe, at: Vector3): number | null {
    O.set(at.x - N.x * PROBE_BACK, at.y, at.z - N.z * PROBE_BACK);
    this.rays++;
    const t = probe(O, N, PROBE_LEN);
    return t === null ? null : t - PROBE_BACK;
  }

  dispose() {
    this.mat.dispose();
    this.tex?.dispose();
    this.root.dispose(false, true);
  }
}
