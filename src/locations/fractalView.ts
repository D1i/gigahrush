// Меши «Фрактальной станции» (./sceneFractal.ts): ячейка и её копии, световые линии и ядра, эскалаторы, пропы, ниша
// выхода. Мир сцены = ячейка игрока [0, P)³ (копия k = 0); копии — thin instances со сдвигом k·P:
//  • ближние k ∈ {−1,0,1}³ (27): ячейка по поверхностям (meshCell lod 0), подложки эскалаторов (meshEscBand — сливаются в
//    один меш на поверхность, без сломанных и падающих), пропы (по мешу на id, клон шаблона PropModels);
//  • дальние |k|∞ = 2 (98): каркас lod 1 одним мешем, эскалатор — простой короб;
//  • световые линии и ядра — во всех 125 (в дальних — только линии атриума); в выходных копиях (isExitCell абсолютной
//    ячейки) ядро и линии тёплые, ниша светится, над ней табличка «Выход в город»; в прочих — тёмная решётка.
//  LOOK (бесконечность во все стороны): каркас дальних копий — без «станции 6» и стержней (вдали их не видно, а это
//  4/5 треугольников копии), зато ещё кольцо |k|∞ = 3 (218) — в тумане чёрные силуэты на фоне света; свет — своя кривая
//  угасания вместо тумана (./fractalFade.ts): «струны» вдоль внешних рёбер пилонов L1 (с рёбрами станции 18 — сквозные
//  прямые через все ячейки) и ядра — до |k|∞ = LIGHT_R, решётка огней уходит на 5 ячеек во все стороны.
// Эскалаторы — по мотивам src/view3d/metroScene.ts (лента ступеней, балюстрады сталь/дерево, чёрные поручни, настилы,
// торшеры, гребёнки), но в кадре эскалатора (up, fwd) и сразу в координатах ячейки; по бокам — короб до низа подложки
// (снизу её видно — «лестница Эшера»). Подробный эскалатор рисуется только в копиях рядом с камерой (≤ ESC_NEAR и в
// конусе взгляда), в прочих — короб. Ступени бегут сдвигом матрицы по наклону (один на все копии); срыв — вся
// конструкция падает вдоль −up во всех копиях разом и гаснет к 40 м.
// Пропы — тоже только рядом и в конусе взгляда (иначе 400 × 27 предметов — миллионы треугольников).
import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { StairBatch } from '../blockout/stairs';
import type { PropModels } from '../view3d/propModels';
import { AXIS_VEC, axisIdx, axisSign, isExitCell, type V3 } from './fractalAxes';
import { VX, type Box3, type FractalCell, type FractalEsc } from './fractalCell';
import { meshCell, meshEscBand, type Surf, type SurfMesh } from './fractalMesh';
import { FR_OFF, FrFadePlugin } from './fractalFade';
import { DARK_M, HALL_M, SLAB_M, darkMarbleTexture, haloTexture, hallTexture, slabTexture } from './fractalFinish';
import { Constants } from '@babylonjs/core/Engines/constants';

// ───────────────────────── копии ─────────────────────────

const cube = (r: number, pred: (k: V3) => boolean): V3[] => {
  const out: V3[] = [];
  for (let x = -r; x <= r; x++) for (let y = -r; y <= r; y++) for (let z = -r; z <= r; z++) if (pred([x, y, z])) out.push([x, y, z]);
  return out;
};
const cheb = (k: V3) => Math.max(Math.abs(k[0]), Math.abs(k[1]), Math.abs(k[2]));
/** Индекс вокселя точки (м, любые — по модулю P). */
const vidxW = (P: number, p: V3): number => {
  const w = (v: number) => ((Math.floor(v) % P) + P) % P;
  return w(p[0]) + P * (w(p[1]) + P * w(p[2]));
};
/** Ближние копии (27), первая — своя ячейка. */
export const NEAR: readonly V3[] = [[0, 0, 0], ...cube(1, (k) => cheb(k) === 1)];
/** Дальние копии (98). */
export const FAR: readonly V3[] = cube(2, (k) => cheb(k) === 2);
export const ALL: readonly V3[] = [...NEAR, ...FAR];
/** LOOK: кольцо силуэтов |k|∞ = 3 (218) — только каркас, в тумане чёрный. */
export const RING3: readonly V3[] = cube(3, (k) => cheb(k) === 3);
/** LOOK: «струны» и ядра — до стольких ячеек во все стороны (своя кривая угасания). */
export const LIGHT_R = 5;
/** Ядра без свечения: 2 ≤ |k|∞ ≤ LIGHT_R (ближние 27 — со свечением). */
export const LIGHT_FAR: readonly V3[] = cube(LIGHT_R, (k) => cheb(k) >= 2);

// ───────────────────────── числа ─────────────────────────

const TAN30 = Math.tan(Math.PI / 6);
const COS30 = Math.cos(Math.PI / 6);
/** Ступень: проступь в плане, подъём, шаг вдоль наклона (лента повторяется через столько), м. */
const STEP_R = 0.4;
const STEP_RISE = STEP_R * TAN30;
export const STEP_PITCH = STEP_R / COS30;
/** Линия носков ступеней — ниже линии опоры (PHYS rampH) на столько: ступни посередине проступи. */
const NOSE_DROP = 0.1;
/** Балюстрада: верх настила, поручень; начало до низа наклона и конец после верха, м. */
const DECK_TOP = 0.97;
const RAIL_TOP = 1.0;
const BAL_IN = 0.9;
const BAL_OUT = 0.6;
/** Короб по бокам эскалатора: ниже линии опоры (подложка — не ниже 3.3 м), м. */
const SKIRT_LOW = 3.45;
const TORCH_STEP = 2.8;
/** Подробный эскалатор / пропы — в копиях не дальше стольких м от камеры (и в конусе взгляда). */
export const ESC_NEAR = 55;
/** Пропы: дальше стольких м не рисуются — радиус растёт с габаритом (пути 9 м видны дальше скамьи, «игрушечные»
 *  станции 6 — только вблизи). */
const PROP_NEAR = 16;
const PROP_PER_M = 4.5;
const PROP_MAX = 60;
/** Проп с таким числом треугольников и меньше — «дешёвый»: виден до PROP_MAX. */
const PROP_CHEAP = 240;
/** LOOK: кессоны видны до PROP_MAX при любой цене (свет на гранях станции 18). */
const PROP_FAR: ReadonlySet<string> = new Set(['p_metro_light']);
/** LOOK: скамьи вдали (дальше своего радиуса, до PROP_MAX) — упрощённые: мраморные торцы, сиденье, спинка (36 треуг.
 *  вместо сотен) — по ним с потолка читается «пол вниз головой» (до пола 50 м). */
const BENCH_PROXY = 'p_metro_bench';
/** Конус взгляда: косинус половины угла (кадр 16:9 по горизонтали ~49° + запас 30°), ближе стольких м — всегда. */
const CONE_COS = Math.cos((79 * Math.PI) / 180);
const CONE_NEAR = 14;
/** Падение сорвавшегося эскалатора показывается до стольких м (дальше — туман; см. escDrop). */
export const DROP_MAX = 40;
const DROP_G = 9.8;

/** Падение сорвавшегося эскалатора для вида (чистая часть, тест — fractalScene.test.ts). Пока срыв идёт (pose из
 *  collapsePose) — drop оттуда, τ = √(2·drop/g); стадия fall кончилась (1.6 с, ≈ 12.5 м), run удалён, эскалатор в broken,
 *  а конструкция ещё не ушла на DROP_MAX — падение досматривается здесь: τ += dt, drop = g·τ²/2 (без привязки к runs).
 *  tau — состояние вида (null — не падает / упал). Результат — в общем объекте (без аллокаций в кадре). */
const DROP_OUT = { drop: 0, tau: null as number | null, hidden: false };
export function escDrop(pose: { drop: number } | null, broken: boolean, tau: number | null, dt: number): typeof DROP_OUT {
  const o = DROP_OUT;
  if (pose) {
    o.drop = Math.min(DROP_MAX + 1, pose.drop);
    o.tau = pose.drop > 0 ? Math.sqrt((2 * pose.drop) / DROP_G) : null;
  } else if (broken && tau !== null) {
    const tt = tau + dt;
    o.drop = Math.min(DROP_MAX + 1, 0.5 * DROP_G * tt * tt);
    o.tau = o.drop > DROP_MAX ? null : tt;
  } else {
    o.drop = 0;
    o.tau = null;
  }
  o.hidden = o.drop > DROP_MAX || (broken && !pose && o.tau === null);
  return o;
}
/** Световая полоса: толщина в атриуме, м (на станции 18 — / √3, на станции 6 — / 3). */
const LINE_T = 0.13;

export const LINE_COLD = Color3.FromHexString('#dfe8ff');
export const LINE_WARM = Color3.FromHexString('#ffd9a0');

type C4 = [number, number, number, number];
const rgb = (hex: string, a = 1): C4 => {
  const v = parseInt(hex.slice(1), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255, a];
};
const C = {
  tread: rgb('#8e9296'), riser: rgb('#55595d'), nose: rgb('#d6ae2c'),
  comb: rgb('#a3a7aa'), combSide: rgb('#6a6e72'),
  skirt: rgb('#8b8f93'), panel: rgb('#6e4a30'), panelEdge: rgb('#4f3422'), deck: rgb('#7a5537'),
  rail: rgb('#141414'), bronze: rgb('#8a6a3a'), cover: rgb('#7b887f'), coverEdge: rgb('#4d5951'),
  belt: rgb('#3c3f42'), iron: rgb('#1c1d1e'), white: [1, 1, 1, 1] as C4,
};

// ───────────────────────── векторы ─────────────────────────

const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Кадр эскалатора: точка (b — вправо, h — вверх, s — по подъёму в плане) → координаты ячейки. */
interface EscFrame {
  o: V3;
  r: V3;
  u: V3;
  f: V3;
}
const escFrame = (e: FractalEsc): EscFrame => {
  const u = AXIS_VEC[e.up] as V3, f = AXIS_VEC[e.fwd] as V3;
  return { o: e.o, r: cross(u, f), u, f };
};
const at = (F: EscFrame, b: number, h: number, s: number): V3 => [
  F.o[0] + F.r[0] * b + F.u[0] * h + F.f[0] * s,
  F.o[1] + F.r[1] * b + F.u[1] * h + F.f[1] * s,
  F.o[2] + F.r[2] * b + F.u[2] * h + F.f[2] * s,
];

// ───────────────────────── меши ─────────────────────────

/** Индексы под лицевую сторону Babylon (cross(p1 − p0, p2 − p0) — против нормали, как StairBatch.poly): мешер мог
 *  обойти наоборот — тогда перевернуть все. Решение — по большинству первых треугольников. */
export function orientIndices(pos: ArrayLike<number>, nrm: ArrayLike<number>, idx: Uint32Array | number[]): Uint32Array | number[] {
  let good = 0, bad = 0;
  const n = Math.min(idx.length, 3 * 96);
  for (let t = 0; t < n; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const d = (uy * vz - uz * vy) * nrm[a] + (uz * vx - ux * vz) * nrm[a + 1] + (ux * vy - uy * vx) * nrm[a + 2];
    if (d < 0) good++;
    else if (d > 0) bad++;
  }
  if (bad <= good) return idx;
  const out = idx instanceof Uint32Array ? new Uint32Array(idx) : [...idx];
  for (let t = 0; t + 2 < out.length; t += 3) {
    const x = out[t + 1];
    out[t + 1] = out[t + 2];
    out[t + 2] = x;
  }
  return out;
}

function surfMesh(scene: Scene, name: string, s: SurfMesh, mat: StandardMaterial): Mesh | null {
  if (!s.indices.length) return null;
  const m = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = s.positions;
  vd.normals = s.normals;
  vd.uvs = s.uvs;
  vd.indices = orientIndices(s.positions, s.normals, s.indices);
  vd.applyToMesh(m, false);
  m.material = mat;
  m.isPickable = false;
  m.checkCollisions = false;
  m.alwaysSelectAsActiveMesh = true;
  return m;
}

/** Слить несколько наборов поверхностей одного вида в один (подложки всех целых эскалаторов). */
function mergeSurf(list: SurfMesh[]): SurfMesh | null {
  if (!list.length) return null;
  if (list.length === 1) return list[0];
  let nv = 0, ni = 0, quads = 0;
  for (const s of list) {
    nv += s.positions.length;
    ni += s.indices.length;
    quads += s.quads;
  }
  const positions = new Float32Array(nv), normals = new Float32Array(nv), uvs = new Float32Array((nv / 3) * 2), indices = new Uint32Array(ni);
  let ov = 0, oi = 0;
  for (const s of list) {
    positions.set(s.positions, ov);
    normals.set(s.normals, ov);
    uvs.set(s.uvs, (ov / 3) * 2);
    const base = ov / 3;
    for (let i = 0; i < s.indices.length; i++) indices[oi + i] = s.indices[i] + base;
    ov += s.positions.length;
    oi += s.indices.length;
  }
  return { surf: list[0].surf, positions, normals, uvs, indices, quads };
}

function batchMesh(scene: Scene, name: string, B: StairBatch, mat: StandardMaterial): Mesh | null {
  if (!B.i.length) return null;
  const m = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = B.p;
  vd.normals = B.n;
  vd.colors = B.c;
  vd.indices = B.i;
  vd.applyToMesh(m, false);
  m.material = mat;
  m.isPickable = false;
  m.checkCollisions = false;
  m.alwaysSelectAsActiveMesh = true;
  return m;
}

/** Thin instances меша с буфером на cap копий: матрицы пишутся на месте, без аллокаций. */
class Thin {
  readonly buf: Float32Array;
  n = 0;
  constructor(
    readonly mesh: Mesh,
    readonly cap: number,
  ) {
    this.buf = new Float32Array(Math.max(1, cap) * 16);
    for (let i = 0; i < this.buf.length; i += 16) this.buf[i] = this.buf[i + 5] = this.buf[i + 10] = this.buf[i + 15] = 1;
    mesh.thinInstanceSetBuffer('matrix', this.buf, 16, false);
    mesh.thinInstanceCount = 0;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.setEnabled(false);
  }
  reset() {
    this.n = 0;
  }
  /** перенос */
  t(x: number, y: number, z: number) {
    if (this.n >= this.cap) return;
    const b = this.buf, o = this.n++ * 16;
    b[o] = 1; b[o + 1] = 0; b[o + 2] = 0;
    b[o + 4] = 0; b[o + 5] = 1; b[o + 6] = 0;
    b[o + 8] = 0; b[o + 9] = 0; b[o + 10] = 1;
    b[o + 12] = x; b[o + 13] = y; b[o + 14] = z;
  }
  /** поворот (строки — образы локальных X, Y, Z) × масштаб + перенос */
  m(r: ArrayLike<number>, s: number, x: number, y: number, z: number) {
    if (this.n >= this.cap) return;
    const b = this.buf, o = this.n++ * 16;
    b[o] = r[0] * s; b[o + 1] = r[1] * s; b[o + 2] = r[2] * s;
    b[o + 4] = r[3] * s; b[o + 5] = r[4] * s; b[o + 6] = r[5] * s;
    b[o + 8] = r[6] * s; b[o + 9] = r[7] * s; b[o + 10] = r[8] * s;
    b[o + 12] = x; b[o + 13] = y; b[o + 14] = z;
  }
  commit() {
    this.mesh.thinInstanceCount = this.n;
    this.mesh.thinInstanceBufferUpdated('matrix');
    this.mesh.setEnabled(this.n > 0);
  }
}

// ───────────────────────── материалы ─────────────────────────

/** Материал с процедурной текстурой облицовки (uv в метрах → модуль module м); emissive — подъём теней × текстура. */
function texMat(scene: Scene, name: string, tex: Texture, module: number, emissive: number): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = Color3.White();
  m.specularColor = new Color3(0.06, 0.06, 0.06);
  m.specularPower = 24;
  tex.uScale = tex.vScale = 1 / module;
  m.diffuseTexture = tex;
  m.emissiveColor = new Color3(emissive, emissive * 0.96, emissive * 0.92);
  return m;
}

function glowMat(scene: Scene, name: string, c: Color3, k = 1): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = Color3.Black();
  m.specularColor = Color3.Black();
  m.emissiveColor = c.scale(k);
  m.disableLighting = true;
  return m;
}

/** Свет без тумана сцены — своя кривая (./fractalFade.ts): d0 — без спада, len — длина спада, [z, w] — в ноль. */
function fadeOf(m: StandardMaterial, d0: number, len: number, z: number, w: number, widen = false): FrFadePlugin {
  const p = new FrFadePlugin(m, { widen });
  p.fade.set(d0, len, z, w);
  return p;
}

/** Ниша выхода: свет «с улицы» — почти белый, к краям теплее. */
function archTexture(scene: Scene): DynamicTexture {
  const t = new DynamicTexture('fr:archTex', { width: 256, height: 256 }, scene, true);
  const g = t.getContext() as unknown as CanvasRenderingContext2D;
  const gr = g.createRadialGradient(128, 150, 10, 128, 128, 190);
  gr.addColorStop(0, '#ffffff');
  gr.addColorStop(0.5, '#fff1d8');
  gr.addColorStop(1, '#f0b878');
  g.fillStyle = gr;
  g.fillRect(0, 0, 256, 256);
  // ступени уходящей вверх лестницы — силуэт в свете
  g.fillStyle = 'rgba(140,110,80,0.42)';
  for (let k = 0; k < 7; k++) g.fillRect(40 + k * 4, 256 - 24 - k * 26, 176 - k * 8, 6);
  t.update();
  return t;
}

/** Табличка «Выход в город» с «М». */
function signTexture(scene: Scene): DynamicTexture {
  const t = new DynamicTexture('fr:signTex', { width: 512, height: 128 }, scene, true);
  const g = t.getContext() as unknown as CanvasRenderingContext2D;
  g.fillStyle = '#10203a';
  g.fillRect(0, 0, 512, 128);
  g.strokeStyle = '#c8b27a';
  g.lineWidth = 4;
  g.strokeRect(4, 4, 504, 120);
  g.fillStyle = '#d8342c';
  g.beginPath();
  g.arc(70, 64, 40, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#ffffff';
  g.font = 'bold 56px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('М', 70, 67);
  g.font = '600 40px sans-serif';
  g.fillText('ВЫХОД В ГОРОД', 300, 66);
  t.update();
  return t;
}

/** Квад с uv 0…1: центр, оси (u — вправо по картинке, v — вверх), размеры, нормаль — к зрителю. */
function texQuad(c: V3, u: V3, v: V3, w: number, h: number, nrm: V3, pos: number[], nr: number[], uv: number[], idx: number[]) {
  const base = pos.length / 3;
  for (const [a, b] of [[0, 0], [1, 0], [1, 1], [0, 1]] as const) {
    const p = add(add(c, u, (a - 0.5) * w), v, (b - 0.5) * h);
    pos.push(...p);
    nr.push(...nrm);
    uv.push(a, b);
  }
  const tri = orientIndices(pos.slice(base * 3), nr.slice(base * 3), [0, 1, 2, 0, 2, 3]) as number[];
  for (const i of tri) idx.push(base + i);
}

function rawMesh(scene: Scene, name: string, pos: number[], nr: number[], uv: number[], idx: number[], mat: StandardMaterial): Mesh | null {
  if (!idx.length) return null;
  const m = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = pos;
  vd.normals = nr;
  vd.uvs = uv;
  vd.indices = idx;
  vd.applyToMesh(m, false);
  m.material = mat;
  m.isPickable = false;
  m.alwaysSelectAsActiveMesh = true;
  return m;
}

// ───────────────────────── эскалаторы: постройка ─────────────────────────

/** Высота линии опоры над полом эскалатора в точке s плана (с площадками по концам). */
const lineH = (e: FractalEsc, s: number) => Math.min(e.run, Math.max(0, s)) * TAN30;

/** Слэб вдоль профиля: поперёк [b0, b1], по s — участки ss, низ/верх — h(s) + lo/hi (как metroScene.slab). */
function slab(B: StairBatch, F: EscFrame, b0: number, b1: number, ss: number[], h: (s: number) => number, lo: number | ((s: number) => number), hi: number, top: C4, side: C4) {
  const L = typeof lo === 'number' ? (s: number) => h(s) + lo : lo;
  for (let k = 0; k + 1 < ss.length; k++) {
    const sa = ss[k], sb = ss[k + 1];
    if (sb - sa < 1e-6) continue;
    const la = L(sa), lb = L(sb), ha = h(sa) + hi, hb = h(sb) + hi;
    B.hexa(
      [at(F, b0, la, sa), at(F, b1, la, sa), at(F, b1, lb, sb), at(F, b0, lb, sb)],
      [at(F, b0, ha, sa), at(F, b1, ha, sa), at(F, b1, hb, sb), at(F, b0, hb, sb)],
      top, side,
    );
  }
}

/** Бокс в кадре эскалатора: [b0,b1] × [h0,h1] × [s0,s1]. */
function box(B: StairBatch, F: EscFrame, b0: number, b1: number, h0: number, h1: number, s0: number, s1: number, top: C4, side: C4) {
  B.hexa(
    [at(F, b0, h0, s0), at(F, b1, h0, s0), at(F, b1, h0, s1), at(F, b0, h0, s1)],
    [at(F, b0, h1, s0), at(F, b1, h1, s0), at(F, b1, h1, s1), at(F, b0, h1, s1)],
    top, side,
  );
}

/** Шестигранная призма (плафон): центр низа (b, h, s), радиус, высота. */
function prism(B: StairBatch, F: EscFrame, b: number, h: number, s: number, r: number, height: number, col: C4) {
  const n = 6;
  const ring = (y: number): V3[] => Array.from({ length: n }, (_, k) => at(F, b + r * Math.cos((k / n) * Math.PI * 2), y, s + r * Math.sin((k / n) * Math.PI * 2)));
  const lo = ring(h), hi = ring(h + height);
  const mid = at(F, b, h + height / 2, s);
  B.color = col;
  B.poly(lo, mid);
  B.poly(hi, mid);
  for (let k = 0; k < n; k++) B.poly([lo[k], lo[(k + 1) % n], hi[(k + 1) % n], hi[k]], mid);
}

/** Лента ступеней дорожки (ступени — проступь, подступенок, жёлтый носок): от-под пола до-под верхней площадки. */
function belt(B: StairBatch, F: EscFrame, e: FractalEsc, off: number) {
  // QA: ступени вплотную к фартукам (±0.6) — в щель 4 см сверху виднелась гранитная подложка под лентой
  const b0 = off - 0.595, b1 = off + 0.595, bm = off;
  for (let s = -2 * STEP_R; s + STEP_R <= e.run - STEP_R + 1e-6; s += STEP_R) {
    const H = s * TAN30 - NOSE_DROP;
    B.color = C.tread;
    B.poly([at(F, b0, H, s), at(F, b1, H, s), at(F, b1, H, s + STEP_R), at(F, b0, H, s + STEP_R)], at(F, bm, H - 1, s + STEP_R / 2));
    B.color = C.riser;
    B.poly([at(F, b0, H, s + STEP_R), at(F, b1, H, s + STEP_R), at(F, b1, H + STEP_RISE, s + STEP_R), at(F, b0, H + STEP_RISE, s + STEP_R)], at(F, bm, H + STEP_RISE / 2, s + STEP_R + 0.5));
    B.color = C.nose;
    B.poly([at(F, b0, H + 0.004, s), at(F, b1, H + 0.004, s), at(F, b1, H + 0.004, s + 0.045), at(F, b0, H + 0.004, s + 0.045)], at(F, bm, H - 1, s));
  }
}

/** Статика эскалатора (B) и плафоны (L): балюстрады, поручни, настилы, торшеры, гребёнки, короб по бокам, «пол» под
 *  лентой (виден в копиях без ленты), лента стоящих дорожек. */
function escBody(B: StairBatch, L: StairBatch, e: FractalEsc, F: EscFrame) {
  const h = (s: number) => lineH(e, s);
  const W = e.width, hw = W / 2;
  const s0 = -BAL_IN, s1 = e.run + BAL_OUT;
  const ss = [s0, 0, e.run, s1];
  const lanes = [...e.lanes].sort((a, b) => a.off - b.off);
  for (const l of lanes) {
    const e0 = l.off - 0.6, e1 = l.off + 0.6;
    for (const [p0, p1, r0, r1] of [[e0 - 0.05, e0, e0 - 0.07, e0 + 0.03], [e1, e1 + 0.05, e1 - 0.03, e1 + 0.07]] as const) {
      slab(B, F, p0, p1, ss, h, -0.55, 0.12, C.skirt, C.skirt); // фартук — до «пола» под лентой (сбоку не видно подложки)
      slab(B, F, p0, p1, ss, h, 0.12, 0.92, C.panelEdge, C.panel);
      slab(B, F, r0, r1, [s0 - 0.3, ...ss, s1 + 0.25], (s) => h(Math.min(s1, Math.max(s0, s))), 0.92, RAIL_TOP, C.rail, C.rail);
    }
    // «пол» под лентой: тёмная полоса ниже ступеней
    slab(B, F, e0, e1, [0, e.run], h, -0.55, -0.5, C.belt, C.belt);
    // гребёнки внизу и вверху
    box(B, F, e0 + 0.02, e1 - 0.02, 0, 0.026, -0.35, 0.1, C.comb, C.combSide);
    box(B, F, e0 + 0.02, e1 - 0.02, 0, 0.028, 0.065, 0.1, C.nose, C.nose);
    box(B, F, e0 + 0.02, e1 - 0.02, e.rise, e.rise + 0.026, e.run - 0.5, e.run + 0.15, C.comb, C.combSide);
    box(B, F, e0 + 0.02, e1 - 0.02, e.rise, e.rise + 0.028, e.run - 0.5, e.run - 0.465, C.nose, C.nose);
    if (l.dir === 0) belt(B, F, e, l.off);
  }
  // настилы: промежутки между дорожками и у краёв
  const gaps: { b0: number; b1: number; inner: boolean }[] = [];
  let prev = -hw;
  lanes.forEach((l, k) => {
    gaps.push({ b0: prev, b1: l.off - 0.65, inner: k > 0 });
    prev = l.off + 0.65;
  });
  gaps.push({ b0: prev, b1: hw, inner: false });
  for (const g of gaps) {
    if (g.b1 - g.b0 < 0.04) continue;
    slab(B, F, g.b0, g.b1, ss, h, DECK_TOP - 0.06, DECK_TOP, C.deck, C.panelEdge);
    // торцы настила — до пола
    box(B, F, g.b0, g.b1, 0, DECK_TOP - 0.06, s0, s0 + 0.04, C.panelEdge, C.panel);
    box(B, F, g.b0, g.b1, e.rise, e.rise + DECK_TOP - 0.06, s1 - 0.04, s1, C.panelEdge, C.panel);
    // торшеры — на настилах между дорожками (у одной дорожки — на обоих краевых)
    if (!g.inner && lanes.length > 1) continue;
    const bm = (g.b0 + g.b1) / 2;
    for (let s = 1.2; s < e.run - 0.8; s += TORCH_STEP) {
      const y = h(s) + DECK_TOP;
      // LOOK: торшеры крупнее (плафон 0.3 → 0.42 м) — в атриуме 52 м прежние читались точками
      box(B, F, bm - 0.025, bm + 0.025, y, y + 0.95, s - 0.025, s + 0.025, C.bronze, C.bronze);
      box(B, F, bm - 0.07, bm + 0.07, y + 0.92, y + 0.96, s - 0.07, s + 0.07, C.bronze, C.bronze);
      prism(L, F, bm, y + 0.96, s, 0.11, 0.42, C.white);
    }
  }
  // короб по бокам: от низа подложки (не ниже пола) до настила — прячет ступенчатую подложку сбоку. QA: тёмный
  // сплошной короб читался в кадре дырой — светлее и с бронзовым поясом под настилом (панели по 1.5 м стоили +0.1 М тр.)
  const sLow = SKIRT_LOW / TAN30;
  const cs = [s0, 0, ...(sLow < e.run ? [sLow] : []), e.run, s1];
  const low = (s: number) => Math.max(0, h(s) - SKIRT_LOW);
  for (const [c0, c1, o] of [[-hw - 0.05, -hw - 0.02, -1], [hw + 0.02, hw + 0.05, 1]] as const) {
    slab(B, F, c0, c1, cs, h, low, DECK_TOP, C.coverEdge, C.cover);
    const b0 = o < 0 ? c0 - 0.012 : c1, b1 = o < 0 ? c0 : c1 + 0.012;
    slab(B, F, b0, b1, [s0, 0, e.run, s1], h, DECK_TOP - 0.3, DECK_TOP - 0.24, C.bronze, C.bronze);
  }
}

/** Простой короб эскалатора (копии вдали от камеры): наклонная плита с бортами; в дальних копиях — одна плита. */
function escBox(B: StairBatch, e: FractalEsc, F: EscFrame, simple = false) {
  const h = (s: number) => lineH(e, s);
  const hw = e.width / 2;
  const ss = [0, e.run];
  if (simple) {
    slab(B, F, -hw, hw, ss, h, -0.6, DECK_TOP, C.deck, C.cover);
    return;
  }
  slab(B, F, -hw, hw, ss, h, -0.6, 0.0, C.tread, C.cover);
  slab(B, F, -hw, -hw + 0.4, ss, h, 0, DECK_TOP, C.deck, C.cover);
  slab(B, F, hw - 0.4, hw, ss, h, 0, DECK_TOP, C.deck, C.cover);
}

// ───────────────────────── вид ─────────────────────────

/** Что сцена знает об эскалаторах (FrEscWorld и collapsePose). */
export interface FrViewEsc {
  broken: ReadonlySet<number>;
  belt(esc: number, lane: number): number;
  stage(esc: number): string | null;
  pose(esc: number): { belt: number; drop: number; lamp: number } | null;
}

interface EscView {
  e: FractalEsc;
  F: EscFrame;
  /** центр для отбора копий и радиус */
  c: V3;
  rad: number;
  /** вдоль наклона (единичный) */
  sd: V3;
  body: Thin | null;
  lamps: Thin | null;
  /** ленты по направлению: +1 / −1 (стоящая — в body) */
  belts: { dir: 1 | -1; lane: number; thin: Thin; phase: number }[];
  box: Thin | null;
  /** копии с подробным видом (индексы в ALL) */
  near: number[];
  drop: number;
  hidden: boolean;
  /** с падения (escDrop): после конца стадии fall падение досматривает вид; null — не падает */
  tau: number | null;
}

interface PropGroup {
  id: string;
  thin: Thin;
  /** на предмет: поворот×масштаб (9) и точка */
  rot: Float32Array;
  at: Float32Array;
  scale: Float32Array;
  /** средняя сторона шаблона, м (дальность); дешёвые — огромная */
  size: number;
  /** наибольшая сторона, м (конус взгляда) */
  cull: number;
  rad: number;
  /** упрощённая копия вдали (до PROP_MAX), null — нет */
  proxy: Thin | null;
}

export interface FractalViewStats {
  meshes: number;
  thin: number;
  props: number;
  propIds: number;
  missingProps: string[];
  escNear: number;
  /** треугольники по группам мешей (с копиями) — для бюджета */
  tris: Record<string, number>;
}

export class FractalView {
  readonly P: number;
  /** светятся в GlowLayer (линии ближних копий, ядра, ниша, табличка) */
  readonly glowMeshes: Mesh[] = [];
  /** растёт при пересборке мешей (подложки, короба) — сцене: обновить списки свечения */
  meshVer = 0;
  private readonly meshes: Mesh[] = [];
  private readonly mats: StandardMaterial[] = [];
  private readonly thins: Thin[] = [];
  private readonly esc: EscView[] = [];
  private props: PropGroup[] = [];
  private missing: string[] = [];
  private coreCold: Thin | null = null;
  private coreWarm: Thin | null = null;
  /** ядра 2 ≤ |k|∞ ≤ LIGHT_R — без свечения, своя кривая угасания */
  private farCoreCold: Thin | null = null;
  private farCoreWarm: Thin | null = null;
  /** расширяемые полосы: полуширина на метр дальности — от высоты кадра (update) */
  private widen: FrFadePlugin[] = [];
  private lineCold: Thin | null = null;
  private lineWarm: Thin | null = null;
  private farLineCold: Thin | null = null;
  private farLineWarm: Thin | null = null;
  private arch: Thin | null = null;
  private signThin: Thin | null = null;
  private grille: Thin | null = null;
  private bands: Mesh[] = [];
  private bandKey: string | null = null;
  private farBox: Thin | null = null;
  private farBoxKey: string | null = null;
  private bodyMat: StandardMaterial;
  private lampOn: StandardMaterial;
  private lampFlick: StandardMaterial;
  /** торшеры досматриваемого падения (стадия broken — погасли, lampFlicker 0) */
  private lampDead: StandardMaterial;
  private surfMats: Record<Surf, StandardMaterial>;
  private cell: V3 = [0, 0, 0];
  private exitK: boolean[] = ALL.map(() => false);
  /** камера при последнем отборе копий (подробные эскалаторы, пропы) */
  private lastCam: V3 = [1e9, 0, 0];
  private lastFwd: V3 = [0, 0, 1];
  private lastPick = 0;
  /** точка пропа при отборе (переиспользуется) */
  private readonly pickP: V3 = [0, 0, 0];
  private time = 0;
  private escNear = 0;
  private propCount = 0;
  private disposed = false;

  constructor(
    private readonly scene: Scene,
    readonly fc: FractalCell,
  ) {
    this.P = fc.P;
    // материалы поверхностей (§3.2 fractalMesh): камень чуть светится — грани не тонут в черноте. LOOK: грани атриума —
    // облицовка модулем 6 м (красный гранитный пояс, мраморное поле), станция 18 и пилоны — плиты белого мрамора 1.5×3 м
    // (./fractalFinish.ts) вместо плитки 1.2 м: издали — «членения», а не кафель
    const granite = texMat(scene, 'fr:granite', hallTexture(scene, 1024), HALL_M, 0.07);
    const dark = texMat(scene, 'fr:marbleDark', darkMarbleTexture(scene, 512), DARK_M, 0.05);
    const marble = texMat(scene, 'fr:marble', slabTexture(scene, 512), SLAB_M, 0.06);
    const far = texMat(scene, 'fr:far', hallTexture(scene, 256), HALL_M, 0.08);
    // каркас дальних копий: кривая тумана сцены (EXP, FR_FOG = 0.0085 → длина спада 118 м) и гашение к краю кольца
    // |k| = 3 (иначе за ним — обрез в чёрное)
    fadeOf(far, 0, 118, 2.55 * this.P, 3.35 * this.P);
    const core = glowMat(scene, 'fr:core', LINE_COLD, 1.1);
    this.surfMats = { granite, trim: dark, marble, marbleDark: dark, landing: granite, core, far };
    this.mats.push(granite, dark, marble, far, core);
    this.bodyMat = new StandardMaterial('fr:esc', scene);
    this.bodyMat.diffuseColor = Color3.White();
    this.bodyMat.specularColor = new Color3(0.12, 0.12, 0.12);
    this.bodyMat.specularPower = 32;
    this.bodyMat.backFaceCulling = false;
    this.lampOn = glowMat(scene, 'fr:escLamp', new Color3(1, 0.88, 0.66));
    this.lampFlick = glowMat(scene, 'fr:escLampFlick', new Color3(1, 0.88, 0.66));
    this.lampDead = glowMat(scene, 'fr:escLampDead', new Color3(1, 0.88, 0.66), 0.04);
    this.mats.push(this.bodyMat, this.lampOn, this.lampFlick, this.lampDead);
    this.buildCell();
    this.buildLines();
    this.buildStrings();
    this.buildDecor();
    this.buildExit();
    for (const e of fc.esc) this.buildEsc(e);
  }

  // ───────────── ячейка ─────────────

  private add(m: Mesh | null): Mesh | null {
    if (m) this.meshes.push(m);
    return m;
  }

  private thin(m: Mesh | null, cap: number): Thin | null {
    if (!m) return null;
    const t = new Thin(m, cap);
    this.thins.push(t);
    return t;
  }

  private buildCell() {
    const P = this.P;
    for (const s of meshCell(this.fc, { lod: 0 })) {
      if (s.surf === 'core') {
        // ядро — в ближних 27 копиях со свечением, холодное / тёплое (выходная копия); дальше — farCore* без свечения
        const cold = this.add(surfMesh(this.scene, 'fr:coreCold', s, this.surfMats.core));
        const warmMat = glowMat(this.scene, 'fr:coreWarm', LINE_WARM, 1.15);
        this.mats.push(warmMat);
        const warm = this.add(surfMesh(this.scene, 'fr:coreWarm', s, warmMat));
        this.coreCold = this.thin(cold, NEAR.length);
        this.coreWarm = this.thin(warm, NEAR.length);
        if (cold) this.glowMeshes.push(cold);
        if (warm) this.glowMeshes.push(warm);
        continue;
      }
      const m = this.add(surfMesh(this.scene, `fr:cell:${s.surf}`, s, this.surfMats[s.surf]));
      const t = this.thin(m, NEAR.length);
      if (!t) continue;
      for (const k of NEAR) t.t(k[0] * P, k[1] * P, k[2] * P);
      t.commit();
    }
    // дальние копии и кольцо силуэтов: каркас без «станции 6», павильонов и стержней (их 4/5 квадов копии, а в 80+ м
    // их не видно); ядра остаются (свет)
    const vox = this.fc.vox.slice();
    for (let i = 0; i < vox.length; i++) if (vox[i] === VX.SHELL2 || vox[i] === VX.ROD) vox[i] = VX.AIR;
    const ring = [...FAR, ...RING3];
    for (const s of meshCell({ ...this.fc, vox }, { lod: 1 })) {
      if (s.surf === 'core') continue;
      const m = this.add(surfMesh(this.scene, `fr:far:${s.surf}`, s, this.surfMats.far));
      const t = this.thin(m, ring.length);
      if (!t) continue;
      for (const k of ring) t.t(k[0] * P, k[1] * P, k[2] * P);
      t.commit();
    }
    // ядра вдали: куб главного ядра (без павильонов) — решётка огней до LIGHT_R ячеек
    {
      const q = P / 27, c1 = 13 * q, c2 = 14 * q;
      const B = new StairBatch();
      B.hexa(
        [[c1, c1, c1], [c2, c1, c1], [c2, c1, c2], [c1, c1, c2]],
        [[c1, c2, c1], [c2, c2, c1], [c2, c2, c2], [c1, c2, c2]],
        C.white, C.white,
      );
      const end = LIGHT_R * P;
      const cold = glowMat(this.scene, 'fr:farCoreCold', LINE_COLD, 1.1), warm = glowMat(this.scene, 'fr:farCoreWarm', LINE_WARM, 1.15);
      fadeOf(cold, 30, 115, 0.72 * end, 0.97 * end);
      fadeOf(warm, 30, 135, 0.72 * end, 0.97 * end);
      this.mats.push(cold, warm);
      this.farCoreCold = this.thin(this.add(batchMesh(this.scene, 'fr:farCoreCold', B, cold)), LIGHT_FAR.length);
      this.farCoreWarm = this.thin(this.add(batchMesh(this.scene, 'fr:farCoreWarm', B, warm)), LIGHT_FAR.length);
    }
  }

  /** «Струны»: внешние рёбра пилонов L1 вместе с рёбрами станции 18 — прямые без конца вдоль оси (пилон идёт от станции
   *  18 своей ячейки до станции 18 соседней). Полоса — на ребре, наполовину в камне; меш один — LIGHT_R ячеек во все
   *  стороны и вдоль (мир периодичен: при обёртке двигать нечего). Без свечения (вдали — «снег»), своя кривая угасания и
   *  расширение до полупикселя (FR_WIDEN) — нить не мерцает. */
  private buildStrings() {
    const P = this.P, R = LIGHT_R;
    const q = P / 27, t1 = 9 * q, t2 = 18 * q;
    const h = 0.075;
    const pos: number[] = [], nr: number[] = [], off: number[] = [], idx: number[] = [];
    const v3 = (a: number, t: number, u: number, v: number): V3 => (a === 0 ? [t, u, v] : a === 1 ? [u, t, v] : [u, v, t]);
    const t0 = -R * P, tE = (R + 1) * P, mid = P / 2;
    // расширение — по вершинам: длинный отрезок рядом с камерой брал бы ширину своих дальних концов (серые «трубы»).
    // Отрезки короче вблизи ячейки игрока (P/2) и длиннее вдали (половина дальности до середины ячейки)
    const cuts = (lat: number): number[] => {
      const out = [t0];
      for (let t = t0; t < tE - 1e-6; ) {
        const step = Math.max(P / 2, 0.5 * Math.hypot(lat, Math.max(0, Math.abs(t - mid) - P)));
        t = Math.min(tE, t + step);
        out.push(t);
      }
      return out;
    };
    for (let a = 0; a < 3; a++) {
      for (const k of this.fc.pylons.L1[a] ?? []) {
        const uo = k & 1 ? t2 : t1, vo = k & 2 ? t2 : t1;
        for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) {
          const U = uo + i * P, V = vo + j * P;
          const ts = cuts(Math.hypot(U - mid, V - mid));
          // 4 боковые грани: нормаль ±u / ±v; углы — смещения (su·h, sv·h)
          for (const [nu, nv] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const corners: [number, number][] = nu ? [[nu, -1], [nu, 1]] : [[-1, nv], [1, nv]];
            const base = pos.length / 3;
            for (const t of ts) {
              for (const [su, sv] of corners) {
                pos.push(...v3(a, t, U + su * h, V + sv * h));
                nr.push(...v3(a, 0, nu, nv));
                off.push(...v3(a, 0, su * h, sv * h));
              }
            }
            // вершины отрезка n: 2n (t_n, c0), 2n+1 (t_n, c1); лицевая — по нормали (orientIndices по первому)
            const flip = (orientIndices(pos.slice(base * 3, base * 3 + 12), nr.slice(base * 3, base * 3 + 12), [0, 1, 3, 0, 3, 2]) as number[])[1] !== 1;
            for (let n = 0; n + 1 < ts.length; n++) {
              const q0 = base + 2 * n;
              const tri = [q0, q0 + 1, q0 + 3, q0, q0 + 3, q0 + 2];
              if (flip) idx.push(tri[0], tri[2], tri[1], tri[3], tri[5], tri[4]);
              else idx.push(...tri);
            }
          }
        }
      }
    }
    if (!idx.length) return;
    const mat = glowMat(this.scene, 'fr:strings', LINE_COLD, 1.05);
    const plug = fadeOf(mat, 18, 125, 0.72 * R * P, 0.97 * R * P, true);
    this.widen.push(plug);
    this.mats.push(mat);
    const m = new Mesh('fr:strings', this.scene);
    const vd = new VertexData();
    vd.positions = pos;
    vd.normals = nr;
    vd.indices = idx;
    vd.applyToMesh(m, false);
    m.setVerticesData(FR_OFF, off, false, 3);
    m.material = mat;
    m.isPickable = false;
    m.alwaysSelectAsActiveMesh = true;
    this.add(m);
  }

  /** Световые линии: полоса-брус вдоль ребра (наполовину в камне — видна с обеих граней). LOOK: только грани наружу
   *  (out · n ≥ 0) и торцы — внутренние две в камне (−1/3 треугольников в кадре и в свечении). */
  private buildLines() {
    const near = new StairBatch(), far = new StairBatch();
    for (const l of this.fc.lights) {
      const t = LINE_T / Math.sqrt(l.scale);
      const lo: V3 = [Math.min(l.a[0], l.b[0]) - t / 2, Math.min(l.a[1], l.b[1]) - t / 2, Math.min(l.a[2], l.b[2]) - t / 2];
      const hi: V3 = [Math.max(l.a[0], l.b[0]) + t / 2, Math.max(l.a[1], l.b[1]) + t / 2, Math.max(l.a[2], l.b[2]) + t / 2];
      const mid: V3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
      for (const B of l.scale === 1 ? [near, far] : [near]) {
        B.color = C.white;
        for (let ax = 0; ax < 3; ax++) for (const s of [-1, 1]) {
          // грань с нормалью s·e_ax: внутрь камня (против out) — не нужна
          if (s * l.out[ax] < -1e-6) continue;
          const w = s > 0 ? hi[ax] : lo[ax];
          const ua = (ax + 1) % 3, va = (ax + 2) % 3;
          const pts: V3[] = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([pu, pv]) => {
            const p: V3 = [0, 0, 0];
            p[ax] = w;
            p[ua] = pu ? hi[ua] : lo[ua];
            p[va] = pv ? hi[va] : lo[va];
            return p;
          });
          B.poly(pts, mid);
        }
      }
    }
    const cold = glowMat(this.scene, 'fr:lineCold', LINE_COLD, 1);
    const warm = glowMat(this.scene, 'fr:lineWarm', LINE_WARM, 1);
    // без тумана — своя кривая: линии ближних копий видны дальше «съедающего» тумана (струны тессеракта)
    fadeOf(cold, 30, 120, 2.0 * this.P, 2.6 * this.P);
    fadeOf(warm, 30, 140, 2.0 * this.P, 2.6 * this.P);
    this.mats.push(cold, warm);
    // свечение — только у ближних копий: дальние линии в текстуре свечения — точки, размытые в «снег»
    const mk = (name: string, B: StairBatch, mat: StandardMaterial, cap: number, glow: boolean) => {
      const m = this.add(batchMesh(this.scene, name, B, mat));
      if (m && glow) this.glowMeshes.push(m);
      return this.thin(m, cap);
    };
    this.lineCold = mk('fr:linesCold', near, cold, NEAR.length, true);
    this.lineWarm = mk('fr:linesWarm', near, warm, NEAR.length, true);
    this.farLineCold = mk('fr:farLinesCold', far, cold, FAR.length, false);
    this.farLineWarm = mk('fr:farLinesWarm', far, warm, FAR.length, false);
  }

  /** Ниша выхода: открытая — светящийся проём и табличка; закрытая — решётка. */
  private buildExit() {
    const x = this.fc.exit;
    const fa = axisIdx(x.facing), fs = axisSign(x.facing);
    const ua = axisIdx(x.up), us = axisSign(x.up);
    const ra = (3 - fa - ua) as 0 | 1 | 2;
    const A = x.arch;
    const mid = (i: number) => (A.lo[i] + A.hi[i]) / 2;
    const ext = (i: number) => A.hi[i] - A.lo[i];
    const nrm = AXIS_VEC[x.facing] as V3;
    const upV = AXIS_VEC[x.up] as V3;
    const view: V3 = [-nrm[0], -nrm[1], -nrm[2]];
    const right = cross(upV, view);
    const back = fs > 0 ? A.lo[fa] : A.hi[fa];
    const open = fs > 0 ? A.hi[fa] : A.lo[fa];
    const pt = (f: number, u: number, r: number): V3 => {
      const p: V3 = [0, 0, 0];
      p[fa] = f;
      p[ua] = u;
      p[ra] = r;
      return p;
    };
    // открытая: свет в глубине ниши + табличка над аркой
    {
      const pos: number[] = [], nr: number[] = [], uv: number[] = [], idx: number[] = [];
      texQuad(pt(back + fs * 0.02, mid(ua), mid(ra)), right, upV, ext(ra) - 0.04, ext(ua) - 0.04, nrm, pos, nr, uv, idx);
      // QA: StandardMaterial СКЛАДЫВАЕТ emissiveColor и emissiveTexture — с белым цветом ниша и табличка были сплошным
      // белым пятном (ни градиента, ни надписи). Цвет — чёрный, картинку даёт текстура; сила свечения — metadata.glow
      // (селектор свечения сцены, sceneFractal.ts), свечение берёт текстуру × этот цвет
      const mat = glowMat(this.scene, 'fr:arch', Color3.White(), 0.8);
      mat.emissiveTexture = archTexture(this.scene);
      mat.emissiveColor = Color3.Black();
      // свечение слабее линий: со свечением 0.5 и вблизи, и издали ниша — сплошное белое пятно без лестницы
      mat.metadata = { glow: new Color3(0.16, 0.15, 0.13) };
      this.mats.push(mat);
      const m = this.add(rawMesh(this.scene, 'fr:arch', pos, nr, uv, idx, mat));
      const p2: number[] = [], n2: number[] = [], u2: number[] = [], i2: number[] = [];
      const top = us > 0 ? A.hi[ua] : A.lo[ua];
      texQuad(pt(open + fs * 0.03, top + us * 0.6, mid(ra)), right, upV, 3.2, 0.8, nrm, p2, n2, u2, i2);
      const smat = glowMat(this.scene, 'fr:sign', Color3.White(), 0.9);
      smat.emissiveTexture = signTexture(this.scene);
      smat.emissiveColor = Color3.Black();
      smat.metadata = { glow: new Color3(0.35, 0.35, 0.35) };
      this.mats.push(smat);
      const sign = this.add(rawMesh(this.scene, 'fr:sign', p2, n2, u2, i2, smat));
      if (m) this.glowMeshes.push(m);
      if (sign) this.glowMeshes.push(sign);
      this.arch = this.thin(m, ALL.length);
      // табличка — вместе с аркой (те же копии): отдельный меш, тот же буфер копий
      if (sign) this.signThin = this.thin(sign, ALL.length);
    }
    // закрытая: решётка в проёме
    {
      const B = new StairBatch();
      const f0 = open - fs * 0.12, f1 = open - fs * 0.07;
      const u0 = A.lo[ua], u1 = A.hi[ua], r0 = A.lo[ra], r1 = A.hi[ra];
      const bar = (a: V3, b: V3) => {
        const lo: V3 = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])];
        const hi: V3 = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])];
        B.hexa(
          [[lo[0], lo[1], lo[2]], [hi[0], lo[1], lo[2]], [hi[0], lo[1], hi[2]], [lo[0], lo[1], hi[2]]],
          [[lo[0], hi[1], lo[2]], [hi[0], hi[1], lo[2]], [hi[0], hi[1], hi[2]], [lo[0], hi[1], hi[2]]],
          C.iron, C.iron,
        );
      };
      for (let r = r0 + 0.2; r < r1 - 0.1; r += 0.22) bar(pt(f0, u0, r - 0.025), pt(f1, u1, r + 0.025));
      for (const u of [u0 + 0.15, u0 + (u1 - u0) * 0.5, u1 - 0.15]) bar(pt(f0 - fs * 0.04, u - 0.04, r0), pt(f1 - fs * 0.04, u + 0.04, r1));
      const mat = new StandardMaterial('fr:grille', this.scene);
      mat.diffuseColor = Color3.White();
      mat.specularColor = new Color3(0.2, 0.2, 0.2);
      this.mats.push(mat);
      this.grille = this.thin(this.add(batchMesh(this.scene, 'fr:grille', B, mat)), NEAR.length);
    }
  }

  // ───────────── эскалаторы ─────────────

  /** LOOK, метро: пилоны L1 — облицованные колонны с базами/капителями (у плиты и у станции 18 — «низ» и «верх» смотря
   *  откуда смотреть, поэтому профиль один: гранитный цоколь, бронзовая полка, бронзовая шейка); у каждого прохода пилона
   *  сквозь плиту, с обеих её сторон — торшер (бронзовая стойка, матовый плафон) и тёплое пятно света на камне вокруг.
   *  Всё — в ближних 27 копиях (thin instances), без коллайдеров (как пропы). */
  private buildDecor() {
    const P = this.P, fc = this.fc;
    const q = P / 27, t1 = 9 * q, t2 = 18 * q, pw = q;
    const B = new StairBatch(), L = new StairBatch();
    const COL = { plinth: rgb('#4a2420'), shelf: rgb('#8a6a3a'), neck: rgb('#b08a4a'), base: rgb('#3b2b1a') };
    const v3 = (a: number, t: number, u: number, v: number): V3 => (a === 0 ? [t, u, v] : a === 1 ? [u, t, v] : [u, v, t]);
    const unit = (a: number): V3 => v3(a, 1, 0, 0);
    const vAt = (p: V3) => fc.vox[vidxW(P, p)];
    // ── базы/капители: на обоих концах обоих видимых пролётов пилона ([1, t1) и [t2, P − 1))
    for (let a = 0; a < 3; a++) {
      const ax = [0, 1, 2].filter((x) => x !== a);
      for (const k of fc.pylons.L1[a] ?? []) {
        const u0 = k & 1 ? t2 - pw : t1, v0 = k & 2 ? t2 - pw : t1;
        const cu = u0 + pw / 2, cv = v0 + pw / 2;
        for (const [end, dir] of [[1, 1], [t1, -1], [t2, 1], [P - 1, -1]] as const) {
          // кадр: o — центр сечения на торце, u — вдоль пилона внутрь пролёта, r/f — две другие оси мира
          const F: EscFrame = { o: v3(a, end, cu, cv), r: [0, 0, 0], u: unit(a).map((x) => x * dir) as V3, f: [0, 0, 0] };
          F.r[ax[0]] = 1;
          F.f[ax[1]] = 1;
          const hp = pw / 2;
          box(B, F, -hp - 0.2, hp + 0.2, 0, 0.62, -hp - 0.2, hp + 0.2, COL.plinth, COL.plinth);
          box(B, F, -hp - 0.3, hp + 0.3, 0, 0.16, -hp - 0.3, hp + 0.3, COL.shelf, COL.shelf);
          box(B, F, -hp - 0.24, hp + 0.24, 0.62, 0.7, -hp - 0.24, hp + 0.24, COL.shelf, COL.shelf);
          box(B, F, -hp - 0.05, hp + 0.05, 1.05, 1.12, -hp - 0.05, hp + 0.05, COL.neck, COL.neck);
        }
      }
    }
    // ── торшеры у проходов пилонов сквозь плиту (стоят на плите по диагонали наружу от угла дыры)
    const pools: { c: V3; n: V3 }[] = [];
    for (let a = 0; a < 3; a++) {
      for (const k of fc.pylons.L1[a] ?? []) {
        const uo = k & 1 ? t2 : t1, vo = k & 2 ? t2 : t1;
        const du = k & 1 ? 1 : -1, dv = k & 2 ? 1 : -1;
        for (const [plane, s] of [[1, 1], [P - 1, -1]] as const) {
          const at = v3(a, plane, uo + du * 1.7, vo + dv * 1.7);
          const U = unit(a).map((x) => x * s) as V3;
          // под стойкой — плита, над ней 4 м пусто; рядом нет эскалатора и пропа той же грани
          const under: V3 = [at[0] - U[0] * 0.5, at[1] - U[1] * 0.5, at[2] - U[2] * 0.5];
          if (vAt(under) !== VX.SLAB) continue;
          let free = true;
          for (let h = 0.5; h < 4 && free; h += 1) if (vAt([at[0] + U[0] * h, at[1] + U[1] * h, at[2] + U[2] * h]) !== VX.AIR) free = false;
          if (!free || this.nearEscOrProp(at, U, 1.6)) continue;
          const ax = [0, 1, 2].filter((x) => x !== a);
          const F: EscFrame = { o: at, r: [0, 0, 0], u: U, f: [0, 0, 0] };
          F.r[ax[0]] = 1;
          F.f[ax[1]] = 1;
          prism(B, F, 0, 0, 0, 0.24, 0.1, COL.base);
          box(B, F, -0.035, 0.035, 0.1, 3.05, -0.035, 0.035, C.bronze, C.bronze);
          prism(B, F, 0, 3.0, 0, 0.12, 0.08, COL.shelf);
          prism(L, F, 0, 3.08, 0, 0.2, 0.7, C.white);
          prism(B, F, 0, 3.78, 0, 0.23, 0.06, COL.shelf);
          pools.push({ c: [at[0] + U[0] * 0.03, at[1] + U[1] * 0.03, at[2] + U[2] * 0.03], n: U });
        }
      }
    }
    const near = (t: Thin | null) => {
      if (!t) return;
      for (const k of NEAR) t.t(k[0] * P, k[1] * P, k[2] * P);
      t.commit();
    };
    near(this.thin(this.add(batchMesh(this.scene, 'fr:decor', B, this.bodyMat)), NEAR.length));
    near(this.thin(this.add(batchMesh(this.scene, 'fr:decorLamps', L, this.lampOn)), NEAR.length));
    // тёплые пятна света: квад 5.5 × 5.5 м на камне, лицом в воздух (сложение цвета, без записи глубины)
    if (pools.length) {
      const pos: number[] = [], nr: number[] = [], uv: number[] = [], idx: number[] = [];
      for (const { c, n } of pools) {
        const ax = [0, 1, 2].filter((x) => n[x] === 0);
        const e1: V3 = [0, 0, 0], e2: V3 = [0, 0, 0];
        e1[ax[0]] = 1;
        e2[ax[1]] = 1;
        texQuad(c, e1, e2, 5.5, 5.5, n, pos, nr, uv, idx);
      }
      const mat = new StandardMaterial('fr:pool', this.scene);
      mat.disableLighting = true;
      mat.diffuseColor = Color3.Black();
      mat.specularColor = Color3.Black();
      mat.emissiveColor = new Color3(0.5, 0.36, 0.2);
      mat.opacityTexture = haloTexture(this.scene, 'fr:poolTex');
      mat.alphaMode = Constants.ALPHA_ADD;
      mat.disableDepthWrite = true;
      mat.zOffset = -2;
      this.mats.push(mat);
      near(this.thin(this.add(rawMesh(this.scene, 'fr:pools', pos, nr, uv, idx, mat)), NEAR.length));
    }
  }

  /** Рядом с точкой на грани (up U) эскалатор той же грани или проп — не ставить декор. */
  private nearEscOrProp(p: V3, U: V3, r: number): boolean {
    for (const e of this.fc.esc) {
      const F = escFrame(e);
      if (dot(F.u, U) < 0.99) continue;
      const d: V3 = [p[0] - e.o[0], p[1] - e.o[1], p[2] - e.o[2]];
      const h = dot(d, F.u), b = dot(d, F.r), s = dot(d, F.f);
      if (Math.abs(h) < 0.6 && Math.abs(b) < e.width / 2 + 0.9 && s > -2.5 && s < e.run + 5) return true;
    }
    for (const pr of this.fc.props) {
      const u = AXIS_VEC[pr.up] as V3;
      if (dot(u, U) < 0.99) continue;
      if (Math.hypot(pr.at[0] - p[0], pr.at[1] - p[1], pr.at[2] - p[2]) < r) return true;
    }
    return false;
  }

  private buildEsc(e: FractalEsc) {
    const F = escFrame(e);
    const B = new StairBatch(), L = new StairBatch();
    escBody(B, L, e, F);
    const body = this.thin(this.add(batchMesh(this.scene, `fr:esc:${e.i}`, B, this.bodyMat)), NEAR.length);
    // плафоны — чистый эмиссив, без свечения: их сотни в копиях, в тумане — «снег»
    const lm = this.add(batchMesh(this.scene, `fr:escLamps:${e.i}`, L, this.lampOn));
    const lamps = this.thin(lm, NEAR.length);
    const belts: EscView['belts'] = [];
    for (const dir of [1, -1] as const) {
      const ls = e.lanes.map((l, k) => ({ l, k })).filter((x) => x.l.dir === dir);
      if (!ls.length) continue;
      const S = new StairBatch();
      for (const x of ls) belt(S, F, e, x.l.off);
      const t = this.thin(this.add(batchMesh(this.scene, `fr:escBelt:${e.i}:${dir}`, S, this.bodyMat)), NEAR.length);
      if (t) belts.push({ dir, lane: ls[0].k, thin: t, phase: 0 });
    }
    const X = new StairBatch();
    escBox(X, e, F);
    const bx = this.thin(this.add(batchMesh(this.scene, `fr:escBox:${e.i}`, X, this.bodyMat)), ALL.length);
    const c = at(F, 0, e.rise / 2, e.run / 2);
    const rad = Math.hypot(e.run, e.rise, e.width) / 2 + 1;
    const sd = add(F.f.map((v) => v * COS30) as V3, F.u, 0.5);
    this.esc.push({ e, F, c, rad, sd, body, lamps, belts, box: bx, near: [], drop: 0, hidden: false, tau: null });
  }

  /** Заслоняют свечение (рисуются в его текстуру чёрным): ближняя геометрия — ячейка, подложки, решётки. Пропы и
   *  дальние копии — нет (дёшево; дальние за ближними линиями почти не встают). LOOK: эскалаторы — тоже нет (подробные
   *  копии стоили ~150 тыс. треугольников второго прохода, а заслоняют лишь узкие балюстрады — ореол сквозь них мягкий). */
  occluders(): Mesh[] {
    return this.meshes.filter((m) => /^fr:(cell|band|grille):/.test(m.name + ':'));
  }

  /** Подложки целых эскалаторов (без сломанных и падающих) — по мешу на поверхность, во всех ближних копиях. */
  private rebuildBands(hide: ReadonlySet<number>) {
    this.meshVer++;
    for (const m of this.bands) {
      const i = this.meshes.indexOf(m);
      if (i >= 0) this.meshes.splice(i, 1);
      const j = this.thins.findIndex((t) => t.mesh === m);
      if (j >= 0) this.thins.splice(j, 1);
      m.dispose(false, false);
    }
    this.bands = [];
    const by = new Map<Surf, SurfMesh[]>();
    for (const e of this.fc.esc) {
      if (hide.has(e.i)) continue;
      for (const s of meshEscBand(this.fc, e.i)) {
        let l = by.get(s.surf);
        if (!l) by.set(s.surf, (l = []));
        l.push(s);
      }
    }
    for (const [surf, list] of by) {
      const s = mergeSurf(list);
      if (!s) continue;
      const m = this.add(surfMesh(this.scene, `fr:band:${surf}`, s, this.surfMats[surf === 'core' ? 'granite' : surf]));
      const t = this.thin(m, NEAR.length);
      if (!m || !t) continue;
      for (const k of NEAR) t.t(k[0] * this.P, k[1] * this.P, k[2] * this.P);
      t.commit();
      this.bands.push(m);
    }
  }

  /** Короба эскалаторов в дальних копиях (без сломанных). */
  private rebuildFarBox(hide: ReadonlySet<number>) {
    if (this.farBox) {
      const m = this.farBox.mesh;
      this.meshes.splice(this.meshes.indexOf(m), 1);
      this.thins.splice(this.thins.indexOf(this.farBox), 1);
      m.dispose(false, false);
      this.farBox = null;
    }
    const B = new StairBatch();
    for (const v of this.esc) if (!hide.has(v.e.i)) escBox(B, v.e, v.F, true);
    const t = (this.farBox = this.thin(this.add(batchMesh(this.scene, 'fr:farEsc', B, this.bodyMat)), FAR.length));
    if (!t) return;
    for (const k of FAR) t.t(k[0] * this.P, k[1] * this.P, k[2] * this.P);
    t.commit();
  }

  // ───────────── пропы ─────────────

  /** Пропы ячейки: по id — включённый клон шаблона, копии — thin instances (только рядом и в конусе взгляда). */
  setProps(models: PropModels) {
    for (const g of this.props) {
      g.thin.mesh.dispose(false, false);
      g.proxy?.mesh.dispose(false, false);
    }
    this.props = [];
    this.missing = [];
    const by = new Map<string, typeof this.fc.props>();
    for (const p of this.fc.props) {
      let l = by.get(p.id);
      if (!l) by.set(p.id, (l = []));
      l.push(p);
    }
    for (const [id, list] of by) {
      const tpl = models.get(id);
      if (!tpl) {
        this.missing.push(id);
        continue;
      }
      const m = tpl.clone(`fr:prop:${id}`, null, true);
      if (!m) continue;
      m.setEnabled(true);
      m.isPickable = false;
      m.checkCollisions = false;
      const rot = new Float32Array(list.length * 9), atA = new Float32Array(list.length * 3), scale = new Float32Array(list.length);
      // кессоны на гранях станции 18 — эти грани для кого-то пол: высота 0.3 → 0.12 м (плоская световая панель, через
      // неё проходят, как через любой проп)
      const flat = id === 'p_metro_light' ? 0.4 : 1;
      list.forEach((p, i) => {
        const u = AXIS_VEC[p.up] as V3, f = AXIS_VEC[p.fwd] as V3, r = cross(u, f);
        rot.set([...r, ...u.map((x) => x * flat), ...f], i * 9);
        atA.set(p.at, i * 3);
        scale[i] = p.s;
      });
      const bb = tpl.getBoundingInfo().boundingBox;
      const dims = [bb.maximum.x - bb.minimum.x, bb.maximum.y - bb.minimum.y, bb.maximum.z - bb.minimum.z].sort((a, b) => a - b);
      // дальность — по средней стороне (у путей 9 × 3 × 0.36 — 3 м, не 9: рельсы вдали не видны, а треугольников
      // у них больше всех); дешёвые (кромки) — до предела
      const cheap = tpl.getTotalIndices() / 3 <= PROP_CHEAP || PROP_FAR.has(id);
      const size = cheap ? 1e3 : dims[1];
      const rad = Math.min(PROP_MAX, PROP_NEAR + PROP_PER_M * size * Math.max(...scale));
      const thin = new Thin(m, list.length * NEAR.length);
      let proxy: Thin | null = null;
      if (id === BENCH_PROXY) {
        // торцы белого мрамора, сиденье и спинка дерева — в осях шаблона (ширина X 2.4, глубина Z 0.9, высота Y 1)
        const B = new StairBatch(), white = rgb('#d9d4ca'), wood = rgb('#7a4a28');
        const bx = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, c: C4) =>
          B.hexa([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], c, c);
        bx(-1.2, -1.08, 0, 0.98, -0.45, 0.45, white);
        bx(1.08, 1.2, 0, 0.98, -0.45, 0.45, white);
        bx(-1.08, 1.08, 0.36, 0.46, -0.42, 0.42, wood);
        bx(-1.08, 1.08, 0.46, 0.94, -0.05, 0.05, wood);
        const pm = this.add(batchMesh(this.scene, `fr:propFar:${id}`, B, this.bodyMat));
        if (pm) {
          this.meshes.splice(this.meshes.indexOf(pm), 1);
          proxy = new Thin(pm, list.length * NEAR.length);
        }
      }
      this.props.push({ id, thin, rot, at: atA, scale, size, rad, cull: dims[2], proxy });
    }
    this.lastCam = [1e9, 0, 0];
  }

  // ───────────── кадр ─────────────

  /** Абсолютная ячейка игрока: какие копии выходные (ядро, линии, ниша). */
  setCell(c: V3) {
    this.cell = [c[0], c[1], c[2]];
    const P = this.P;
    this.exitK = ALL.map((k) => isExitCell([c[0] + k[0], c[1] + k[1], c[2] + k[2]]));
    const split = (cold: Thin | null, warm: Thin | null, list: readonly V3[], off: number) => {
      cold?.reset();
      warm?.reset();
      list.forEach((k, i) => (this.exitK[off + i] ? warm : cold)?.t(k[0] * P, k[1] * P, k[2] * P));
      cold?.commit();
      warm?.commit();
    };
    split(this.coreCold, this.coreWarm, NEAR, 0);
    // ядра вдали (2 ≤ |k|∞ ≤ LIGHT_R): тёплые — через каждые 2 холодных вдоль оси (сверхпериод выхода)
    this.farCoreCold?.reset();
    this.farCoreWarm?.reset();
    for (const k of LIGHT_FAR) {
      const warm = isExitCell([c[0] + k[0], c[1] + k[1], c[2] + k[2]]);
      (warm ? this.farCoreWarm : this.farCoreCold)?.t(k[0] * P, k[1] * P, k[2] * P);
    }
    this.farCoreCold?.commit();
    this.farCoreWarm?.commit();
    split(this.lineCold, this.lineWarm, NEAR, 0);
    split(this.farLineCold, this.farLineWarm, FAR, NEAR.length);
    this.arch?.reset();
    this.signThin?.reset();
    this.grille?.reset();
    ALL.forEach((k, i) => {
      if (this.exitK[i]) {
        this.arch?.t(k[0] * P, k[1] * P, k[2] * P);
        this.signThin?.t(k[0] * P, k[1] * P, k[2] * P);
      } else if (i < NEAR.length) this.grille?.t(k[0] * P, k[1] * P, k[2] * P);
    });
    this.arch?.commit();
    this.signThin?.commit();
    this.grille?.commit();
  }

  get absCell(): V3 {
    return this.cell;
  }

  /** Размер пикселя: м на пиксель на метр дальности (2·tan(fov/2) / высота кадра) — нити «струн» не тоньше ~0.6 пикселя. */
  setPixelScale(k: number) {
    for (const p of this.widen) p.widen.x = 0.6 * k;
  }

  /** Кадр: бегущие ленты, срывы, отбор копий рядом с камерой (eye — глаз в координатах ячейки, fwd — взгляд). */
  update(dt: number, eye: V3, fwd: V3, esc: FrViewEsc) {
    if (this.disposed) return;
    this.time += dt;
    // подложки и короба: без сломанных и падающих
    const hide = new Set<number>(esc.broken);
    for (const v of this.esc) if (esc.stage(v.e.i) === 'fall') hide.add(v.e.i);
    const key = [...hide].sort((a, b) => a - b).join(',');
    if (key !== this.bandKey) {
      this.bandKey = key;
      this.rebuildBands(hide);
    }
    const fk = [...esc.broken].sort((a, b) => a - b).join(',');
    if (fk !== this.farBoxKey) {
      this.farBoxKey = fk;
      this.rebuildFarBox(esc.broken);
    }
    // отбор копий: сдвинулся / повернулся / раз в 0.3 с
    const moved = Math.hypot(eye[0] - this.lastCam[0], eye[1] - this.lastCam[1], eye[2] - this.lastCam[2]);
    const turned = dot(fwd, this.lastFwd);
    const pick = moved > 1 || turned < 0.985 || this.time - this.lastPick > 0.3;
    if (pick) {
      this.lastCam = [eye[0], eye[1], eye[2]];
      this.lastFwd = [fwd[0], fwd[1], fwd[2]];
      this.lastPick = this.time;
      this.pickEsc(eye, fwd);
      this.pickProps(eye, fwd);
    }
    // эскалаторы: ленты, падение, плафоны
    let flick = 1;
    for (const v of this.esc) {
      const i = v.e.i;
      const pose = esc.pose(i);
      // падение: из collapsePose, после конца стадии fall — досматривается до DROP_MAX (escDrop), потом прячется
      const fall = escDrop(pose, esc.broken.has(i), v.tau, dt);
      const hidden = fall.hidden, tail = !pose && fall.tau !== null;
      const drop = hidden ? v.drop : fall.drop;
      v.tau = fall.tau;
      if (pose && pose.lamp < 0.999) flick = Math.min(flick, pose.lamp);
      if (v.lamps) v.lamps.mesh.material = tail ? this.lampDead : pose && pose.lamp < 0.999 ? this.lampFlick : this.lampOn;
      const reshow = hidden !== v.hidden || drop !== v.drop || pick;
      v.hidden = hidden;
      v.drop = drop;
      if (reshow) this.placeEsc(v);
      // ленты: фаза по скорости (при срыве — сдвиг из collapsePose), сдвиг по модулю шага ступеней
      for (const b of v.belts) {
        if (pose) b.phase = pose.belt;
        else b.phase += esc.belt(i, b.lane) * dt;
        if (hidden) continue;
        const sh = ((b.phase % STEP_PITCH) + STEP_PITCH) % STEP_PITCH;
        const t = b.thin;
        t.reset();
        const ox = v.sd[0] * sh - v.F.u[0] * drop, oy = v.sd[1] * sh - v.F.u[1] * drop, oz = v.sd[2] * sh - v.F.u[2] * drop;
        for (const n of v.near) {
          const k = ALL[n];
          t.t(k[0] * this.P + ox, k[1] * this.P + oy, k[2] * this.P + oz);
        }
        t.commit();
      }
    }
    this.lampFlick.emissiveColor.set(flick, 0.88 * flick, 0.66 * flick);
  }

  private inView(p: V3, rad: number, eye: V3, fwd: V3, maxD: number): boolean {
    const dx = p[0] - eye[0], dy = p[1] - eye[1], dz = p[2] - eye[2];
    const d = Math.hypot(dx, dy, dz);
    if (d - rad > maxD) return false;
    if (d < CONE_NEAR + rad) return true;
    // конус, расширенный на угловой размер объекта
    const c = (dx * fwd[0] + dy * fwd[1] + dz * fwd[2]) / d;
    const ang = Math.acos(Math.max(-1, Math.min(1, c))) - Math.asin(Math.min(1, rad / d));
    return Math.cos(Math.max(0, ang)) >= CONE_COS;
  }

  private pickEsc(eye: V3, fwd: V3) {
    const P = this.P;
    let n = 0;
    for (const v of this.esc) {
      v.near = [];
      for (let i = 0; i < NEAR.length; i++) {
        const k = NEAR[i];
        if (this.inView([v.c[0] + k[0] * P, v.c[1] + k[1] * P, v.c[2] + k[2] * P], v.rad, eye, fwd, ESC_NEAR)) v.near.push(i);
      }
      n += v.near.length;
    }
    this.escNear = n;
  }

  /** Подробный эскалатор — в отобранных копиях, короб — в остальных ближних (дальние — общий короб). */
  private placeEsc(v: EscView) {
    const P = this.P;
    const ox = -v.F.u[0] * v.drop, oy = -v.F.u[1] * v.drop, oz = -v.F.u[2] * v.drop;
    for (const t of [v.body, v.lamps]) {
      if (!t) continue;
      t.reset();
      if (!v.hidden) for (const n of v.near) t.t(ALL[n][0] * P + ox, ALL[n][1] * P + oy, ALL[n][2] * P + oz);
      t.commit();
    }
    if (v.box) {
      const t = v.box;
      t.reset();
      if (!v.hidden) {
        for (let i = 0; i < NEAR.length; i++) {
          if (v.near.includes(i)) continue;
          t.t(NEAR[i][0] * P + ox, NEAR[i][1] * P + oy, NEAR[i][2] * P + oz);
        }
      }
      t.commit();
    }
    if (v.hidden) for (const b of v.belts) {
      b.thin.reset();
      b.thin.commit();
    }
  }

  private pickProps(eye: V3, fwd: V3) {
    const P = this.P;
    let total = 0;
    for (const g of this.props) {
      const t = g.thin, px = g.proxy;
      t.reset();
      px?.reset();
      const n = g.scale.length;
      const reach = px ? PROP_MAX : g.rad;
      for (let ki = 0; ki < NEAR.length; ki++) {
        const k = NEAR[ki];
        const kx = k[0] * P, ky = k[1] * P, kz = k[2] * P;
        // вся копия дальше радиуса — мимо
        const cx = kx + P / 2 - eye[0], cy = ky + P / 2 - eye[1], cz = kz + P / 2 - eye[2];
        if (Math.hypot(cx, cy, cz) - P * 0.87 > reach) continue;
        for (let i = 0; i < n; i++) {
          // без аллокаций: отбор идёт и посреди поворота (скамьи вдали — сотни экземпляров на копию)
          const p = this.pickP;
          p[0] = g.at[i * 3] + kx;
          p[1] = g.at[i * 3 + 1] + ky;
          p[2] = g.at[i * 3 + 2] + kz;
          const sz = g.size * g.scale[i];
          const full = Math.min(PROP_MAX, PROP_NEAR + PROP_PER_M * sz);
          if (!this.inView(p, 0.6 * g.cull * g.scale[i], eye, fwd, px ? PROP_MAX : full)) continue;
          const near = !px || Math.hypot(p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]) <= full;
          (near ? t : px).m(g.rot.subarray(i * 9, i * 9 + 9), g.scale[i], p[0], p[1], p[2]);
        }
      }
      t.commit();
      px?.commit();
      total += t.n + (px?.n ?? 0);
    }
    this.propCount = total;
  }

  /** Середина эскалатора i (координаты ячейки) — для звука и выбора. */
  escCenter(i: number): V3 | null {
    const v = this.esc.find((x) => x.e.i === i);
    return v ? [...v.c] as V3 : null;
  }

  /** Точка на дорожке lane эскалатора i в плане s (над линией опоры на 0.5 м) — для звука. */
  lanePoint(i: number, lane: number, s: number): V3 | null {
    const v = this.esc.find((x) => x.e.i === i);
    const l = v?.e.lanes[lane];
    if (!v || !l) return null;
    return at(v.F, l.off, lineH(v.e, s) + 0.5 - v.drop, s);
  }

  stats(): FractalViewStats {
    let thin = 0;
    for (const t of this.thins) thin += t.mesh.isEnabled() ? t.n : 0;
    for (const g of this.props) thin += g.thin.n + (g.proxy?.n ?? 0);
    return {
      meshes: this.meshes.filter((m) => m.isEnabled()).length + this.props.filter((g) => g.thin.n > 0).length + this.props.filter((g) => (g.proxy?.n ?? 0) > 0).length,
      thin,
      props: this.propCount,
      propIds: this.props.length,
      missingProps: [...this.missing],
      escNear: this.escNear,
      tris: this.trisBy(),
    };
  }

  private trisBy(): Record<string, number> {
    const out: Record<string, number> = {};
    const add = (m: Mesh, n: number) => {
      if (!m.isEnabled() || n <= 0) return;
      const k = m.name.split(':').slice(0, m.name.startsWith('fr:prop:') ? 3 : 2).join(':');
      out[k] = (out[k] ?? 0) + Math.round((m.getTotalIndices() / 3) * n);
    };
    for (const t of this.thins) add(t.mesh, t.n);
    for (const g of this.props) {
      add(g.thin.mesh, g.thin.n);
      if (g.proxy) add(g.proxy.mesh, g.proxy.n);
    }
    return out;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const g of this.props) {
      g.thin.mesh.dispose(false, false);
      g.proxy?.mesh.dispose(false, false);
    }
    for (const m of this.meshes) m.dispose(false, false);
    for (const m of this.mats) m.dispose(true, true);
    this.props = [];
  }
}

/** Бокс в координатах ячейки → центр (для QA и звука). */
export const boxCenter = (b: Box3): V3 => [(b.lo[0] + b.hi[0]) / 2, (b.lo[1] + b.hi[1]) / 2, (b.lo[2] + b.hi[2]) / 2];
