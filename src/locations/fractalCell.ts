// «Фрактальная станция» (fractal) — ячейка-«матрёшка станций» P³ (контракт tmp/metro-wip/FRACTAL.md §1–§3).
// Чистый модуль без Babylon, детерминирован по сиду (makeRng('fractal:' + seed), подпотоки pylons/esc/props/lights).
//
//  • Ячейка [0, P)³, воксель 1 м, мир периодичен (индексы по модулю P). Каркас: плиты-стены с центральной дырой
//    (плита общая для соседних ячеек — воксели P−1 и 0), висящий блок 1/3 «станция 18» с дырами на гранях, в нём
//    блок 1/9 «станция 6», в нём светящееся ядро 1/27; пилоны 2×2 и стержни 1×1 сквозь дыры — подмножество углов от
//    сида (≥ 2 из 4 на ось). Любая осевая линия упирается в статичное твёрдое не дальше P (openAxisLines = 0).
//  • Наполнение ставится в каноническом кадре (x — поперёк, y — вверх от пола y = 1, z — вдоль) и переносится на любую
//    из 6 граней атриума одной из 48 симметрий куба (Place: up, fwd, зеркало поперёк) — с проверкой места по маске
//    занятости claim (1 — твёрдое эскалатора/павильона, 2 — обязана остаться пустой: «голова», проход, приямок).
//  • Эскалаторы: exit (ровно один, он же прибытие; ниша-арка в плите), main (к станции 18, по одному на грань),
//    pav (к павильону — кубу «станция 6» на полу). Подложка — ступенчатая полоса вокселей ESC0 + i под наклоном
//    (ломается вместе с эскалатором), площадка — LANDING (статичная). Верх наклона — целая координата вдоль fwd,
//    площадка начинается ровно там (наклон в площадку не врезается).
//  • Пропы (коллайдеров нет) и световые линии — данные для сцены. Свои копии/выход — сверхпериод FR_SUPER (fractalAxes).
import { makeRng, type Rng } from '../model/rng';
import { AXES6, AXIS_VEC, axis6, axisIdx, axisSign, isExitCell, opp, type Axis6, type V3 } from './fractalAxes';

/** Классы вокселей (значение в FractalCell.vox). */
export const VX = {
  AIR: 0,
  SLAB: 1,     // плиты ячейки: широкие грани — гранит, торцы (обод дыр) — тёмный мрамор
  SHELL1: 2,   // станция 18 — белый мрамор
  SHELL2: 3,   // станция 6 и павильоны — тёмный мрамор
  CORE: 4,     // ядро — светится
  PYLON: 5,    // пилоны 2×2 — белый мрамор
  ROD: 6,      // стержни 1×1 — тёмный мрамор
  TERRACE: 7,  // подиумы (резерв, если понадобятся)
  LANDING: 8,  // площадки эскалаторов — гранит
  ESC0: 32,    // 32 + i — подложка эскалатора i (i < 32): ломается вместе с ним
} as const;
export const isEscVx = (v: number): boolean => v >= VX.ESC0 && v < VX.ESC0 + 32;
/** Статичное твёрдое (для инвариантов и LOD): всё, кроме пустоты и подложек эскалаторов. */
export const isStaticVx = (v: number): boolean => v !== VX.AIR && !isEscVx(v);

export interface Box3 { lo: V3; hi: V3 }   // м, в координатах ячейки, hi > lo

export interface FractalLane { off: number; dir: 1 | 0 | -1 }   // смещение середины вдоль right эскалатора, м; куда везёт

export interface FractalEsc {
  i: number;               // индекс (= номер в маске поломок и материале подложки ESC0 + i)
  kind: 'main' | 'pav' | 'exit';
  up: Axis6;               // нормаль пола, на котором стоит низ (подъём идёт вдоль up)
  fwd: Axis6;              // направление подъёма в плане (низ → верх)
  o: V3;                   // низ: середина ширины на уровне пола, м
  run: number;             // пролёт в плане, м (rise / tan30°)
  rise: number;            // подъём, м (целое — верх площадки на целом уровне)
  width: number;           // 6.0 (3 дорожки) | 2.0 (1 дорожка)
  lanes: FractalLane[];    // 1 или 3
  top: Box3;               // верхняя площадка (воксели LANDING)
  dropM: number;           // глубина свободного падения из середины наклона (для QA/выбора)
}

export interface FractalProp { id: string; at: V3; up: Axis6; fwd: Axis6; s: number }  // at — точка на грани (низ-центр пропа)

export interface LightLine {
  a: V3; b: V3;            // концы ребра, м
  out: V3;                 // единичный вектор наружу из ребра (сумма двух нормалей / √2)
  kind: 'rim' | 'edge' | 'pav' | 'landing';
  scale: 1 | 3 | 9;        // 1 — атриум, 3 — станция 18, 9 — станция 6 (толщина полосы /scale^0.5)
}

export interface FractalSpot { at: V3; up: Axis6; fwd: Axis6 }   // ноги на грани

export interface FractalExit {
  esc: number;             // индекс эскалатора выхода
  arch: Box3;              // проём ниши (вырезан из плиты)
  trigger: Box3;           // объём в нише: тело игрока пересекло → выход (только в выходной копии)
  facing: Axis6;           // нормаль стены с нишей — в атриум
  up: Axis6;               // up пола эскалатора
}

export interface FractalCell {
  seed: string;
  P: number;               // 54 (или 81)
  vox: Uint8Array;         // P³, индекс vidx(P, x, y, z)
  esc: FractalEsc[];
  props: FractalProp[];
  lights: LightLine[];
  exit: FractalExit;
  arrival: FractalSpot;    // верх эскалатора выхода, дорожка 2, лицом вниз по эскалатору
  spots: FractalSpot[];    // ≥ 24 стоячих точек на разных гранях (страховка «застрял», напарники)
  pylons: { L1: number[][]; L2: number[][] };   // выбранные углы по осям [ось][углы 0..3] — для QA
}

export const vidx = (P: number, x: number, y: number, z: number): number => x + P * (y + P * z); // x,y,z ∈ [0,P)

// ── числа ─────────────────────────────────────────────────────────────────────────────────────────────────────
const TAN30 = Math.tan(Math.PI / 6);
/** Над наклоном и площадкой столько должно быть пусто, м. */
const HEAD = 2.4;
/** Подложка — ниже поверхности наклона не меньше чем на столько, м (в столбце берётся низ наклона над ним). */
const BAND_GAP = 0.3;
/** Толщина подложки и площадки, вокселей. */
const BAND_T = 2;
/** Глубина площадки main/exit и pav, м; у main строго пусты первые MAIN_STRICT м над площадкой (дальше — касание
 *  пилона/станции 18 допустимо, §3.3). */
const LAND_D = 4;
const PAV_LAND_D = 2;
const MAIN_STRICT = 2;
/** Пол перед низом наклона, который должен быть стоячим, вокселей (у main — 2: см. notes-fr-gen.md). */
const FRONT_EXIT = 3;
const FRONT_MAIN = 2;
const FRONT_PAV = 2;
/** Сколько раз перевыбрать углы пилонов, если main не набралось 4. */
const MAX_ATTEMPTS = 8;
/** Пропы с тегом «потолок» висят: at — на нижней стороне твёрдого, up смотрит В твёрдое (модель — вниз от at). */
export const FR_HANGING_PROPS: ReadonlySet<string> = new Set(['p_metro_sign', 'p_metro_light']);

/** Размеры матрёшки для периода P (P кратно 27): трети t1/t2, девятые n1/n2, ядро c1/c2, ширина пилона pw. */
interface Dims { P: number; t1: number; t2: number; n1: number; n2: number; c1: number; c2: number; pw: number }
const dimsOf = (P: number): Dims => {
  const q = P / 27;
  return { P, t1: 9 * q, t2: 18 * q, n1: 12 * q, n2: 15 * q, c1: 13 * q, c2: 14 * q, pw: q };
};
const wrapI = (i: number, P: number): number => ((i % P) + P) % P;
const inR = (v: number, lo: number, hi: number): boolean => v >= lo && v < hi;
/** Индекс по оси a и двум другим (u, v) в порядке x, y, z (как в прототипе frame.mjs). */
const alongIdx = (P: number, a: number, t: number, u: number, v: number): number =>
  a === 0 ? vidx(P, t, u, v) : a === 1 ? vidx(P, u, t, v) : vidx(P, u, v, t);
/** Угол k (0 lo,lo · 1 hi,lo · 2 lo,hi · 3 hi,hi) в плоскости (u, v). */
const cornerUV = (lo: number, hi: number, k: number): [number, number] => [k & 1 ? hi : lo, k & 2 ? hi : lo];

/** right = up × fwd (как в FRAME). */
export function crossAxis(a: Axis6, b: Axis6): Axis6 {
  const A = AXIS_VEC[a], B = AXIS_VEC[b];
  const c = [A[1] * B[2] - A[2] * B[1], A[2] * B[0] - A[0] * B[2], A[0] * B[1] - A[1] * B[0]];
  for (let i = 0; i < 3; i++) if (c[i] !== 0) return axis6(i as 0 | 1 | 2, c[i] > 0 ? 1 : -1);
  return a; // параллельны — не бывает у нас
}
const addS = (p: V3, a: Axis6, k: number): V3 => {
  const d = AXIS_VEC[a];
  return [p[0] + d[0] * k, p[1] + d[1] * k, p[2] + d[2] * k];
};
/** Воксель ступни для точки на грани с нормалью up (точка лежит на целой плоскости вдоль up). */
export function footVox(at: V3, up: Axis6): [number, number, number] {
  const a = axisIdx(up);
  const r: [number, number, number] = [Math.floor(at[0]), Math.floor(at[1]), Math.floor(at[2])];
  const pl = Math.round(at[a]);
  r[a] = axisSign(up) > 0 ? pl : pl - 1;
  return r;
}

// ── каркас §1.2 ───────────────────────────────────────────────────────────────────────────────────────────────
/** Оболочка куба [lo, hi)³ толщиной 1 с центральными дырами [h0, h1)² на 6 гранях (рёбра не режутся). */
function shellInto(vox: Uint8Array, P: number, lo: number, hi: number, h0: number, h1: number, cls: number): void {
  for (let z = lo; z < hi; z++) for (let y = lo; y < hi; y++) for (let x = lo; x < hi; x++) {
    const onX = x === lo || x === hi - 1, onY = y === lo || y === hi - 1, onZ = z === lo || z === hi - 1;
    if (!onX && !onY && !onZ) continue;
    const hole = (onX && !onY && !onZ && inR(y, h0, h1) && inR(z, h0, h1))
      || (onY && !onX && !onZ && inR(x, h0, h1) && inR(z, h0, h1))
      || (onZ && !onX && !onY && inR(x, h0, h1) && inR(y, h0, h1));
    if (!hole) vox[vidx(P, x, y, z)] = cls;
  }
}

function buildFrame(D: Dims, L1: number[][], L2: number[][]): Uint8Array {
  const { P, t1, t2, n1, n2, c1, c2, pw } = D;
  const vox = new Uint8Array(P * P * P);
  // 1. плиты: по каждой оси воксели P−1 и 0, кроме центральной дыры [t1, t2)²
  for (let a = 0; a < 3; a++) for (const t of [P - 1, 0]) for (let u = 0; u < P; u++) for (let v = 0; v < P; v++) {
    if (inR(u, t1, t2) && inR(v, t1, t2)) continue;
    vox[alongIdx(P, a, t, u, v)] = VX.SLAB;
  }
  // 2–4. станция 18, станция 6, ядро
  shellInto(vox, P, t1, t2, n1, n2, VX.SHELL1);
  shellInto(vox, P, n1, n2, c1, c2, VX.SHELL2);
  for (let z = c1; z < c2; z++) for (let y = c1; y < c2; y++) for (let x = c1; x < c2; x++) vox[vidx(P, x, y, z)] = VX.CORE;
  // 5. пилоны pw×pw в углах дыры плиты, вдоль оси — всё вне [t1, t2)
  for (let a = 0; a < 3; a++) for (const k of L1[a]) {
    const [u0, v0] = cornerUV(t1, t2 - pw, k);
    for (let t = 0; t < P; t++) {
      if (inR(t, t1, t2)) continue;
      for (let du = 0; du < pw; du++) for (let dv = 0; dv < pw; dv++) vox[alongIdx(P, a, t, u0 + du, v0 + dv)] = VX.PYLON;
    }
  }
  // 6. стержни 1×1 в углах грани станции 6, вне [n1, n2), только в пустоту
  for (let a = 0; a < 3; a++) for (const k of L2[a]) {
    const [u0, v0] = cornerUV(n1, n2 - 1, k);
    for (let t = 0; t < P; t++) {
      if (inR(t, n1, n2)) continue;
      const i = alongIdx(P, a, t, u0, v0);
      if (vox[i] === VX.AIR) vox[i] = VX.ROD;
    }
  }
  return vox;
}

/** Подмножество углов на каждую ось: 2–4 из 4, по возрастанию. */
function pickCorners(r: Rng): number[][] {
  const out: number[][] = [];
  for (let a = 0; a < 3; a++) out.push(r.shuffle([0, 1, 2, 3]).slice(0, r.int(2, 4)).sort((p, q) => p - q));
  return out;
}

function countOpenLines(P: number, isSolid: (v: number) => boolean, vox: Uint8Array): number {
  const cov = [new Uint8Array(P * P), new Uint8Array(P * P), new Uint8Array(P * P)];
  for (let z = 0; z < P; z++) for (let y = 0; y < P; y++) for (let x = 0; x < P; x++) {
    if (!isSolid(vox[vidx(P, x, y, z)])) continue;
    cov[0][y + P * z] = 1; cov[1][x + P * z] = 1; cov[2][x + P * y] = 1;
  }
  let open = 0;
  for (let a = 0; a < 3; a++) for (let i = 0; i < P * P; i++) if (!cov[a][i]) open++;
  return open;
}

// ── канонический кадр и его перенос на грань ───────────────────────────────────────────────────────────────────
/** Перенос канонического кадра: up — нормаль пола (y), fwd — «вдоль» (z), flip — зеркало поперёк (x). */
interface Place { up: Axis6; fwd: Axis6; flip: boolean }
const latAxis = (pl: Place): number => 3 - axisIdx(pl.up) - axisIdx(pl.fwd);
/** Точка канонического кадра → ячейка. */
function ptW(P: number, pl: Place, x: number, y: number, z: number): V3 {
  const r: V3 = [0, 0, 0];
  r[axisIdx(pl.up)] = axisSign(pl.up) > 0 ? y : P - y;
  r[axisIdx(pl.fwd)] = axisSign(pl.fwd) > 0 ? z : P - z;
  r[latAxis(pl)] = pl.flip ? P - x : x;
  return r;
}
/** Воксель канонического кадра → индекс в ячейке (по модулю P). */
function vxW(P: number, pl: Place, x: number, y: number, z: number): number {
  const r = [0, 0, 0];
  r[axisIdx(pl.up)] = axisSign(pl.up) > 0 ? y : P - 1 - y;
  r[axisIdx(pl.fwd)] = axisSign(pl.fwd) > 0 ? z : P - 1 - z;
  r[latAxis(pl)] = pl.flip ? P - 1 - x : x;
  return vidx(P, wrapI(r[0], P), wrapI(r[1], P), wrapI(r[2], P));
}
function boxW(P: number, pl: Place, lo: V3, hi: V3): Box3 {
  const a = ptW(P, pl, lo[0], lo[1], lo[2]), b = ptW(P, pl, hi[0], hi[1], hi[2]);
  return { lo: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])], hi: [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])] };
}
/** Все 48 кадров (6 up × 4 fwd × 2 зеркала) в фиксированном порядке. */
function allPlaces(up?: Axis6): Place[] {
  const out: Place[] = [];
  for (const u of AXES6) {
    if (up !== undefined && u !== up) continue;
    for (const f of AXES6) if (axisIdx(f) !== axisIdx(u)) for (const flip of [false, true]) out.push({ up: u, fwd: f, flip });
  }
  return out;
}

// ── эскалаторы: шаблон → кандидат → проверка места → запись ────────────────────────────────────────────────────
interface EscTpl {
  kind: 'main' | 'pav' | 'exit';
  x0: number;        // поперёк: [x0, x0 + W)
  W: number;         // 6 | 2
  rise: number;
  ztop: number;      // верх наклона = начало площадки (целое)
  D: number;         // глубина площадки
  strictD: number;   // строго пусто над первыми strictD м площадки (дальше — касание пилона/станции 18)
  front: number;     // стоячий пол перед низом, вокселей
  niche: boolean;    // ниша выхода в плите за площадкой
  pav: { px: number; pz: number; n: number } | null;
}
interface Cand {
  pl: Place; tpl: EscTpl; z0: number; run: number;
  solid: number[]; solidCls: number[];   // подложка/площадка/павильон
  air: number[];                          // строго пусто
  soft: number[];                         // пусто или пилон/станция 18 (касание площадкой)
  under: number[];                        // под наклоном/площадкой: пусто или каркас
  front: number[];                        // ступни перед низом
  carve: number[];                        // ниша выхода (из SLAB)
}
interface Ctx { D: Dims; vox: Uint8Array; claim: Uint8Array }
const isFrameVx = (v: number): boolean => v >= VX.SLAB && v <= VX.ROD;

function makeCand(D: Dims, pl: Place, t: EscTpl, i: number): Cand {
  const P = D.P;
  const run = t.rise / TAN30, z0 = t.ztop - run;
  const c: Cand = { pl, tpl: t, z0, run, solid: [], solidCls: [], air: [], soft: [], under: [], front: [], carve: [] };
  const zb = Math.floor(z0);
  const band = VX.ESC0 + i;
  for (let x = t.x0; x < t.x0 + t.W; x++) {
    for (let z = zb - t.front; z < zb; z++) {
      c.front.push(vxW(P, pl, x, 1, z));
      for (let h = 0; h < 3; h++) c.air.push(vxW(P, pl, x, 1 + h, z));
    }
    // наклон: столбец z — подложка под низом наклона над ним, выше — пусто до HEAD над верхом
    for (let z = zb; z < t.ztop; z++) {
      const hLo = Math.max(0, z - z0) * TAN30, hHi = Math.min(run, z + 1 - z0) * TAN30;
      const top = Math.floor(hLo - BAND_GAP), b0 = Math.max(0, top - BAND_T);
      for (let h = 0; h < b0; h++) c.under.push(vxW(P, pl, x, 1 + h, z));
      for (let h = b0; h < top; h++) { c.solid.push(vxW(P, pl, x, 1 + h, z)); c.solidCls.push(band); }
      const hEnd = Math.ceil(hHi + HEAD);
      for (let h = Math.max(0, top); h < hEnd; h++) c.air.push(vxW(P, pl, x, 1 + h, z));
    }
    // площадка: BAND_T вокселей, верх на высоте подъёма
    for (let z = t.ztop; z < t.ztop + t.D; z++) {
      for (let h = 0; h < t.rise - BAND_T; h++) c.under.push(vxW(P, pl, x, 1 + h, z));
      for (let h = t.rise - BAND_T; h < t.rise; h++) { c.solid.push(vxW(P, pl, x, 1 + h, z)); c.solidCls.push(VX.LANDING); }
      const hEnd = Math.ceil(t.rise + HEAD);
      for (let h = t.rise; h < hEnd; h++) (z < t.ztop + t.strictD ? c.air : c.soft).push(vxW(P, pl, x, 1 + h, z));
    }
  }
  if (t.niche) {
    for (let x = t.x0 + 1; x < t.x0 + 5; x++) for (let h = t.rise; h < t.rise + 4; h++) c.carve.push(vxW(P, pl, x, 1 + h, P - 1));
  }
  if (t.pav) {
    const { px, pz, n } = t.pav, q = n / 3;
    for (let z = pz; z < pz + n; z++) for (let y = 1; y < 1 + n; y++) for (let x = px; x < px + n; x++) {
      const cx = x - px, cy = y - 1, cz = z - pz;
      const onX = cx === 0 || cx === n - 1, onY = cy === 0 || cy === n - 1, onZ = cz === 0 || cz === n - 1;
      const mid = (k: number) => k >= q && k < 2 * q;
      const core = mid(cx) && mid(cy) && mid(cz);
      const hole = (onX && !onY && !onZ && mid(cy) && mid(cz)) || (onY && !onX && !onZ && mid(cx) && mid(cz)) || (onZ && !onX && !onY && mid(cx) && mid(cy));
      const idx = vxW(P, pl, x, y, z);
      if (core) { c.solid.push(idx); c.solidCls.push(VX.CORE); }
      else if ((onX || onY || onZ) && !hole) { c.solid.push(idx); c.solidCls.push(VX.SHELL2); }
      else c.air.push(idx);
    }
    for (let z = pz; z < pz + n; z++) for (let x = px; x < px + n; x++) for (let h = 0; h < 3; h++) c.air.push(vxW(P, pl, x, 1 + n + h, z));
  }
  return c;
}

function fits(ctx: Ctx, c: Cand): boolean {
  const { vox, claim } = ctx, P = ctx.D.P;
  for (const i of c.solid) { const v = vox[i]; if (claim[i] || (v !== VX.AIR && !isFrameVx(v))) return false; }
  for (const i of c.air) if (vox[i] !== VX.AIR || claim[i] === 1) return false;
  for (const i of c.soft) { const v = vox[i]; if (claim[i] === 1 || (v !== VX.AIR && v !== VX.PYLON && v !== VX.SHELL1)) return false; }
  for (const i of c.under) { const v = vox[i]; if (claim[i] === 1 || (v !== VX.AIR && !isFrameVx(v))) return false; }
  for (const i of c.carve) if (vox[i] !== VX.SLAB || claim[i]) return false;
  // ступни перед низом: пусто, над ними пусто, под ними статичное твёрдое (не чужое)
  const up = c.pl.up, a = axisIdx(up), s = axisSign(up);
  for (const i of c.front) {
    const x = i % P, y = Math.floor(i / P) % P, z = Math.floor(i / (P * P));
    const p = [x, y, z];
    const below = p.slice(); below[a] = wrapI(below[a] - s, P);
    const above = p.slice(); above[a] = wrapI(above[a] + s, P);
    const bi = vidx(P, below[0], below[1], below[2]), ai = vidx(P, above[0], above[1], above[2]);
    if (vox[i] !== VX.AIR || vox[ai] !== VX.AIR || claim[i] === 1 || claim[ai] === 1) return false;
    if (!isStaticVx(vox[bi]) || claim[bi] === 2) return false;
  }
  return true;
}

function commit(ctx: Ctx, c: Cand): void {
  const { vox, claim } = ctx;
  for (let k = 0; k < c.solid.length; k++) {
    const i = c.solid[k];
    if (vox[i] === VX.AIR) { vox[i] = c.solidCls[k]; claim[i] = 1; }
  }
  const keep = (i: number) => { if (vox[i] === VX.AIR && claim[i] === 0) claim[i] = 2; };
  for (const i of c.air) keep(i);
  for (const i of c.soft) keep(i);
  for (const i of c.under) keep(i);
  for (const i of c.carve) { vox[i] = VX.AIR; claim[i] = 2; }
}

function lanesFor(kind: EscTpl['kind'], W: number, r: Rng): FractalLane[] {
  if (W <= 2) return [{ off: 0, dir: r.pick([1, 1, 0] as const) }];
  if (kind === 'exit') return [{ off: -2, dir: 1 }, { off: 0, dir: 0 }, { off: 2, dir: -1 }];
  // как в метро: обычно 0 — вверх, средняя — стоит или вниз, последняя — вниз; изредка наоборот
  const mid: 0 | -1 = r.chance(0.5) ? 0 : -1;
  const d: (1 | 0 | -1)[] = r.chance(0.15) ? [-1, mid, 1] : [1, mid, -1];
  return [{ off: -2, dir: d[0] }, { off: 0, dir: d[1] }, { off: 2, dir: d[2] }];
}

interface Placed { c: Cand; esc: FractalEsc }

function escFrom(D: Dims, c: Cand, i: number, lanes: FractalLane[]): FractalEsc {
  const P = D.P, t = c.tpl;
  return {
    i, kind: t.kind, up: c.pl.up, fwd: c.pl.fwd,
    o: ptW(P, c.pl, t.x0 + t.W / 2, 1, c.z0),
    run: c.run, rise: t.rise, width: t.W, lanes,
    top: boxW(P, c.pl, [t.x0, 1 + t.rise - BAND_T, t.ztop], [t.x0 + t.W, 1 + t.rise, t.ztop + t.D]),
    dropM: 0,
  };
}

/** Шаблоны в каноническом кадре (пол y = 1, подъём вдоль +z). */
const exitTpl = (D: Dims, x0: number): EscTpl => ({
  kind: 'exit', x0, W: 6, rise: D.t1, ztop: D.P - 1 - LAND_D, D: LAND_D, strictD: LAND_D, front: FRONT_EXIT, niche: true, pav: null,
});
const mainTpl = (D: Dims, ztop: number): EscTpl => ({
  kind: 'main', x0: D.t1 - 6, W: 6, rise: D.t1 - 1, ztop, D: LAND_D, strictD: MAIN_STRICT, front: FRONT_MAIN, niche: false, pav: null,
});
const pavTpl = (D: Dims, px: number, pz: number, W: number): EscTpl => {
  const n = D.P / 9;
  return { kind: 'pav', x0: px + Math.floor((n - W) / 2), W, rise: n, ztop: pz - PAV_LAND_D, D: PAV_LAND_D, strictD: PAV_LAND_D, front: FRONT_PAV, niche: false, pav: { px, pz, n } };
};
/** Поперечные «полосы» выхода (x0) и проверенный образец §1.3 (up +Y, подъём +Z, x0 = 2). */
const EXIT_X0 = [2, 5, 8, 11];
const EXIT_SAMPLE: Place = { up: 2, fwd: 4, flip: false };

function placeEscalators(ctx: Ctx, r: Rng): { placed: Placed[]; mains: number } {
  const D = ctx.D, P = D.P;
  const placed: Placed[] = [];
  const tryPlace = (cands: { pl: Place; tpl: EscTpl }[]): boolean => {
    for (const { pl, tpl } of cands) {
      if (placed.length >= 32) return false;
      const c = makeCand(D, pl, tpl, placed.length);
      if (!fits(ctx, c)) continue;
      commit(ctx, c);
      placed.push({ c, esc: escFrom(D, c, placed.length, lanesFor(tpl.kind, tpl.W, r)) });
      return true;
    }
    return false;
  };
  // 1. выход: 48 кадров × 4 полосы в порядке shuffle; запасной — проверенный образец
  const ex: { pl: Place; tpl: EscTpl }[] = [];
  for (const pl of allPlaces()) for (const x0 of EXIT_X0) ex.push({ pl, tpl: exitTpl(D, x0) });
  if (!tryPlace(r.shuffle(ex))) {
    const c = makeCand(D, EXIT_SAMPLE, exitTpl(D, 2), 0);
    commit(ctx, c);
    placed.push({ c, esc: escFrom(D, c, 0, lanesFor('exit', 6, r)) });
  }
  // 2. main — по одному на грань; не набралось 4 — второй проход по всем граням
  const mainCands = (up: Axis6) => {
    const out: { pl: Place; tpl: EscTpl }[] = [];
    for (const pl of allPlaces(up)) for (const zt of [D.t2 - 3, D.t2 - 2]) out.push({ pl, tpl: mainTpl(D, zt) });
    return r.shuffle(out);
  };
  let mains = 0;
  const faces = r.shuffle([...AXES6]);
  for (const up of faces) if (tryPlace(mainCands(up))) mains++;
  for (const up of faces) { if (mains >= 4) break; if (tryPlace(mainCands(up))) mains++; }
  // 3. павильоны 1–2 на грань
  const n = P / 9;
  const pxs = [2, Math.floor((D.t1 - n) / 2), D.t1 - n - 1];
  const pzs: number[] = [];
  const pzMin = Math.ceil(1 + FRONT_PAV + n / TAN30 + PAV_LAND_D) + 1;
  for (let pz = pzMin; pz + n <= P - 2; pz += 3) pzs.push(pz);
  for (const up of faces) {
    const want = r.int(1, 2);
    for (let k = 0; k < want; k++) {
      const W = r.chance(0.3) ? 6 : 2;
      const cands: { pl: Place; tpl: EscTpl }[] = [];
      for (const pl of allPlaces(up)) for (const px of pxs) for (const pz of pzs) cands.push({ pl, tpl: pavTpl(D, px, pz, W) });
      tryPlace(r.shuffle(cands));
    }
  }
  return { placed, mains };
}

// ── сборка ───────────────────────────────────────────────────────────────────────────────────────────────────
export function buildFractalCell(seed: string, opts?: { P?: 54 | 81 }): FractalCell {
  const P = opts?.P ?? 54;
  const D = dimsOf(P);
  const rng = makeRng('fractal:' + seed);
  const rp = rng.sub('pylons');
  let L1: number[][] = [], L2: number[][] = [];
  let ctx: Ctx | null = null;
  let placed: Placed[] = [];
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    L1 = pickCorners(rp); L2 = pickCorners(rp);
    ctx = { D, vox: buildFrame(D, L1, L2), claim: new Uint8Array(P * P * P) };
    const res = placeEscalators(ctx, rng.sub(attempt ? 'esc' + attempt : 'esc'));
    placed = res.placed;
    if (res.mains >= 4) break;
  }
  const { vox, claim } = ctx!;
  const esc = placed.map((p) => p.esc);
  const cell: FractalCell = {
    seed, P, vox, esc, props: [], lights: [],
    exit: null as unknown as FractalExit, arrival: null as unknown as FractalSpot, spots: [],
    pylons: { L1, L2 },
  };
  for (const e of esc) {
    const mid = addS(addS(e.o, e.fwd, e.run / 2), e.up, e.rise / 2);
    e.dropM = axisRay(cell, mid, opp(e.up), 2 * P) ?? 2 * P;
  }
  // 4. выход и прибытие
  const ex = placed[0];
  const xt = ex.c.tpl, pl = ex.c.pl;
  cell.exit = {
    esc: 0,
    arch: boxW(P, pl, [xt.x0 + 1, 1 + xt.rise, P - 1], [xt.x0 + 5, 5 + xt.rise, P]),
    trigger: boxW(P, pl, [xt.x0 + 1.3, 1 + xt.rise, P - 0.75], [xt.x0 + 4.7, 3.5 + xt.rise, P]),
    facing: opp(pl.fwd),
    up: pl.up,
  };
  const e0 = ex.esc, right0 = crossAxis(e0.up, e0.fwd);
  cell.arrival = { at: addS(addS(addS(e0.o, e0.fwd, e0.run + 1.0), e0.up, e0.rise), right0, 2), up: e0.up, fwd: opp(e0.fwd) };
  cell.spots = makeSpots(D, vox, claim);
  // 5. пропы и линии
  cell.props = makeProps(D, vox, claim, placed, rng.sub('props'));
  cell.lights = makeLights(D, vox, placed);
  // 6. самопроверка
  const open = openAxisLines(cell);
  if (open !== 0) throw new Error(`fractal: открытых осевых линий ${open} (баг каркаса)`);
  return cell;
}

/** Для тестов: годен ли запасной образец выхода на каркасе со ВСЕМИ углами пилонов и стержней (подмножество углов
 *  только убирает твёрдое — значит, образец годен при любом выборе сида). */
export function exitSampleFitsAllCorners(P: 54 | 81 = 54): boolean {
  const D = dimsOf(P);
  const all = [[0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 2, 3]];
  const ctx: Ctx = { D, vox: buildFrame(D, all, all), claim: new Uint8Array(P * P * P) };
  return fits(ctx, makeCand(D, EXIT_SAMPLE, exitTpl(D, 2), 0));
}

// ── стоячие точки ────────────────────────────────────────────────────────────────────────────────────────────
function standVox(P: number, vox: Uint8Array, x: number, y: number, z: number, up: Axis6): boolean {
  const d = AXIS_VEC[up];
  const at = (dx: number, dy: number, dz: number) => vox[vidx(P, wrapI(x + dx, P), wrapI(y + dy, P), wrapI(z + dz, P))];
  return at(0, 0, 0) === VX.AIR && at(d[0], d[1], d[2]) === VX.AIR && at(-d[0], -d[1], -d[2]) !== VX.AIR;
}

/** Ближайшая к (j, k) стоячая и не занятая эскалатором точка на плоскости feet (ось a), радиус ≤ 8. */
function findSpot(D: Dims, vox: Uint8Array, claim: Uint8Array, up: Axis6, feet: number, plane: number, j0: number, k0: number, fwd: Axis6): FractalSpot | null {
  const P = D.P, a = axisIdx(up), j = (a + 1) % 3, k = (a + 2) % 3;
  for (let r = 0; r <= 8; r++) for (let dj = -r; dj <= r; dj++) for (let dk = -r; dk <= r; dk++) {
    if (Math.max(Math.abs(dj), Math.abs(dk)) !== r) continue;
    const p = [0, 0, 0];
    p[a] = feet; p[j] = wrapI(Math.floor(j0) + dj, P); p[k] = wrapI(Math.floor(k0) + dk, P);
    const i = vidx(P, p[0], p[1], p[2]);
    if (claim[i] || !standVox(P, vox, p[0], p[1], p[2], up)) continue;
    const at: V3 = [p[0] + 0.5, p[1] + 0.5, p[2] + 0.5];
    at[a] = plane;
    return { at, up, fwd };
  }
  return null;
}

function makeSpots(D: Dims, vox: Uint8Array, claim: Uint8Array): FractalSpot[] {
  const { P, t1, t2, pw } = D;
  const out: FractalSpot[] = [];
  for (const up of AXES6) {
    const a = axisIdx(up), s = axisSign(up), j = ((a + 1) % 3) as 0 | 1 | 2, k = ((a + 2) % 3) as 0 | 1 | 2;
    // 4 на грань атриума — посреди каждой полосы, лицом к дыре
    const plane = s > 0 ? 1 : P - 1, feet = s > 0 ? 1 : P - 2;
    const tg: [number, number, Axis6][] = [
      [t1 / 2, P / 2, axis6(j, 1)], [P - t1 / 2, P / 2, axis6(j, -1)], [P / 2, t1 / 2, axis6(k, 1)], [P / 2, P - t1 / 2, axis6(k, -1)],
    ];
    for (const [j0, k0, f] of tg) { const sp = findSpot(D, vox, claim, up, feet, plane, j0, k0, f); if (sp) out.push(sp); }
    // 1 на внешнюю грань станции 18
    const pl18 = s > 0 ? t2 : t1, feet18 = s > 0 ? t2 : t1 - 1;
    const sp = findSpot(D, vox, claim, up, feet18, pl18, t1 + pw + 1.5, (t1 + t2) / 2, axis6(k, 1));
    if (sp) out.push(sp);
  }
  return out;
}

// ── пропы §3.4 ───────────────────────────────────────────────────────────────────────────────────────────────
// Оси пропа (как у прогулки, notes-props.md): сцена переводит локальные (+X, +Y, +Z) в (up × fwd, up, fwd). Зад модели
// (план −y) — локальный +Z, т. е. fwd смотрит «спиной»: у настенных (панно, часы) fwd — в стену; перед (пульт будки,
// голова турникета) — к −fwd; носик кромки и контактный рельс путей — на −right.
interface PropW { id: string; w: number; d: number }
const PW = (id: string, w: number, d: number): PropW => ({ id, w, d });

function makeProps(D: Dims, vox: Uint8Array, claim: Uint8Array, placed: Placed[], r: Rng): FractalProp[] {
  const { P, t1, t2, n1, n2, pw } = D;
  const out: FractalProp[] = [];
  const LIMIT = 400;
  const vAt = (x: number, y: number, z: number) => vox[vidx(P, wrapI(Math.floor(x), P), wrapI(Math.floor(y), P), wrapI(Math.floor(z), P))];
  const cAt = (x: number, y: number, z: number) => claim[vidx(P, wrapI(Math.floor(x), P), wrapI(Math.floor(y), P), wrapI(Math.floor(z), P))];
  /** След пропа: центр и 4 угла (с отступом 0.05) — ступня пуста, под ней статичное твёрдое, не на эскалаторе. */
  const okFoot = (at: V3, up: Axis6, fwd: Axis6, w: number, d: number, allowClaim: boolean): boolean => {
    const right = crossAxis(up, fwd);
    for (const [u, v] of [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const p = addS(addS(at, right, u * Math.max(0, w / 2 - 0.05)), fwd, v * Math.max(0, d / 2 - 0.05));
      const f = footVox(p, up), b = addS(f as V3, opp(up), 1);
      if (vAt(f[0], f[1], f[2]) !== VX.AIR || !isStaticVx(vAt(b[0], b[1], b[2]))) return false;
      if (!allowClaim && cAt(f[0], f[1], f[2])) return false;
    }
    return true;
  };
  const put = (pr: PropW, at: V3, up: Axis6, fwd: Axis6, s = 1, allowClaim = false): boolean => {
    if (out.length >= LIMIT) return false;
    if (!okFoot(at, up, fwd, pr.w * s, pr.d * s, allowClaim)) return false;
    out.push({ id: pr.id, at, up, fwd, s });
    return true;
  };
  const pt = (a: number, av: number, j: number, jv: number, k: number, kv: number): V3 => {
    const p: V3 = [0, 0, 0]; p[a] = av; p[j] = jv; p[k] = kv; return p;
  };
  const EDGE = PW('p_metro_edge', 0.4, 9), BENCH = PW('p_metro_bench', 2.4, 0.9), TRACK = PW('p_metro_track', 3, 9);
  const MINI = PW('p_metro_mini_track', 1.5, 9), MICRO = PW('p_metro_micro_track', 0.75, 9), PANEL = PW('p_metro_panel', 2.4, 0.06);
  const TURN = PW('p_metro_turnstile', 0.2, 1.3), BOOTH = PW('p_metro_esc_booth', 1.3, 1.1), SIGN = PW('p_metro_sign', 1.6, 0.15);
  const CLOCK = PW('p_metro_clock', 0.8, 0.2);
  const COFFER = PW('p_metro_light', 3, 4.5);
  const hole = t2 - t1, nEdge = Math.floor(hole / 9), edge0 = t1 + (hole - nEdge * 9) / 2;

  for (const up of AXES6) {
    const a = axisIdx(up), s = axisSign(up), j = ((a + 1) % 3) as 0 | 1 | 2, k = ((a + 2) % 3) as 0 | 1 | 2;
    const plane = s > 0 ? 1 : P - 1;
    // кромки по ободу дыры плиты (носик — к дыре, т. е. right — от дыры)
    for (const [ax, other] of [[j, k], [k, j]] as const) {
      for (const lo of [true, false]) {
        const toHole = axis6(ax, lo ? 1 : -1);
        const c = lo ? t1 - 0.2 : t2 + 0.2;
        for (let m = 0; m < nEdge; m++) {
          const along = edge0 + 4.5 + 9 * m;
          const at = ax === j ? pt(a, plane, j, c, k, along) : pt(a, plane, k, c, j, along);
          let fwd = axis6(other, 1);
          if (crossAxis(up, fwd) === toHole) fwd = opp(fwd);
          put(EDGE, at, up, fwd);
        }
      }
    }
    // скамьи: 2–4 на полосу, длинной стороной вдоль обода
    for (const [ax, other] of [[j, k], [k, j]] as const) {
      for (const lo of [true, false]) {
        const want = r.int(2, 4);
        const slots: [number, number][] = [];
        for (const off of [2.5, 6]) for (let q = 4; q <= P - 4; q += 4) slots.push([lo ? t1 - off : t2 + off, q]);
        let got = 0;
        for (const [c, along] of r.shuffle(slots)) {
          if (got >= want) break;
          const at = ax === j ? pt(a, plane, j, c, k, along) : pt(a, plane, k, c, j, along);
          if (put(BENCH, at, up, axis6(ax, lo ? 1 : -1))) got++;
        }
      }
    }
    // станция 18: 1–2 скамьи масштаба 1/3 на внешней грани
    {
      const pl18 = s > 0 ? t2 : t1;
      const want = r.int(1, 2);
      let got = 0;
      for (const along of r.shuffle([t1 + pw + 3, (t1 + t2) / 2, t2 - pw - 3])) {
        if (got >= want) break;
        if (put(BENCH, pt(a, pl18, j, t1 + pw + 1.5, k, along), up, axis6(j, 1), 1 / 3)) got++;
      }
    }
  }

  // «рельсы Эшера»: кольцо через 4 грани вокруг оси rr (поперёк — cc), на двух оставшихся гранях — по прямой
  const rr = r.int(0, 2);
  const cc = r.pick([4.5, 7.5, 10.5, P - 4.5, P - 7.5, P - 10.5]);
  const rVec = AXIS_VEC[axis6(rr as 0 | 1 | 2, 1)];
  const trackLine = (pr: PropW, up: Axis6, plane: number, latAx: number, lat: number, fwd: Axis6, from: number, len: number, piece: number, s: number) => {
    const a = axisIdx(up), b = axisIdx(fwd), n = Math.floor(len / piece + 1e-6);
    for (let m = 0; m < n; m++) {
      const along = axisSign(fwd) > 0 ? from + piece * (m + 0.5) : from + len - piece * (m + 0.5);
      const at: V3 = [0, 0, 0]; at[a] = plane; at[latAx] = lat; at[b] = along;
      put(pr, at, up, fwd, s);
    }
  };
  /** Касательная кольца вокруг оси rr на грани с нормалью up: t = r × up. */
  const ringFwd = (up: Axis6): Axis6 => {
    const u = AXIS_VEC[up];
    const t = [rVec[1] * u[2] - rVec[2] * u[1], rVec[2] * u[0] - rVec[0] * u[2], rVec[0] * u[1] - rVec[1] * u[0]];
    for (let i = 0; i < 3; i++) if (t[i] !== 0) return axis6(i as 0 | 1 | 2, t[i] > 0 ? 1 : -1);
    return up;
  };
  for (const up of AXES6) {
    const a = axisIdx(up), plane = axisSign(up) > 0 ? 1 : P - 1;
    if (a !== rr) {
      trackLine(TRACK, up, plane, rr, cc, ringFwd(up), 1, P - 2, 9, 1);
    } else {
      const b = (a + 1) % 3, lat = 3 - a - b;
      const c2 = r.pick([4.5, 7.5, 10.5, P - 4.5, P - 7.5, P - 10.5]);
      trackLine(TRACK, up, plane, lat, c2, axis6(b as 0 | 1 | 2, r.chance(0.5) ? 1 : -1), 1, P - 2, 9, 1);
    }
  }
  // эхо: кольца путей на станции 18 (мини, 1/3) и станции 6 (микро, 1/9) вокруг той же оси
  for (const up of AXES6) {
    const a = axisIdx(up), s = axisSign(up);
    if (a === rr) continue;
    trackLine(MINI, up, s > 0 ? t2 : t1, rr, t1 + pw + 1.25, ringFwd(up), t1, t2 - t1, 3, 1 / 3);
    trackLine(MICRO, up, s > 0 ? n2 : n1, rr, n1 + 1.25, ringFwd(up), n1, n2 - n1, 1, 1 / 9);
  }

  // панно у вогнутых рёбер: стоит на полу, задом к стене
  {
    // LOOK: 4–8 → 7–12 (мозаика — главный «метро»-знак на гранях атриума)
    const want = r.int(7, 12);
    let got = 0;
    for (let tries = 0; tries < 120 && got < want; tries++) {
      const up = r.pick(AXES6), a = axisIdx(up);
      const wall = r.pick(AXES6.filter((d) => axisIdx(d) !== a));
      const wa = axisIdx(wall), third = 3 - a - wa;
      const at: V3 = [0, 0, 0];
      at[a] = axisSign(up) > 0 ? 1 : P - 1;
      at[wa] = axisSign(wall) > 0 ? P - 1 - 0.05 : 1 + 0.05;
      at[third] = r.int(3, P - 4) + 0.5;
      if (put(PANEL, at, up, wall)) got++;
    }
  }
  // турникеты в никуда: ряд из 5 поперёк полосы на 1–2 гранях
  {
    const want = r.int(1, 2);
    let got = 0;
    for (const up of r.shuffle([...AXES6])) {
      if (got >= want) break;
      const a = axisIdx(up), j = (a + 1) % 3, k = (a + 2) % 3;
      const lo = r.chance(0.5), along = r.int(6, P - 7) + 0.5;
      const cj = lo ? t1 / 2 : P - t1 / 2;
      const fwd = axis6(k as 0 | 1 | 2, r.chance(0.5) ? 1 : -1);
      let ok = 0;
      for (let m = -2; m <= 2; m++) {
        const at: V3 = [0, 0, 0]; at[a] = axisSign(up) > 0 ? 1 : P - 1; at[j] = cj + 0.8 * m; at[k] = along;
        if (put(TURN, at, up, fwd)) ok++;
      }
      if (ok) got++;
    }
  }
  // у каждого эскалатора: будка у низа, указатель под площадкой, часы на стене над верхом
  for (const { esc: e } of placed) {
    const right = crossAxis(e.up, e.fwd);
    for (const side of [1, -1]) {
      const at = addS(addS(e.o, right, side * (e.width / 2 + 1.0)), e.fwd, -1.2);
      if (put(BOOTH, at, e.up, e.fwd)) break;
    }
    // указатель висит под площадкой у края наклона: up — в площадку
    {
      const at = addS(addS(e.o, e.fwd, e.run + 0.6), e.up, e.rise - BAND_T);
      const f = footVox(at, opp(e.up)), above = footVox(at, e.up);
      if (out.length < LIMIT && vAt(f[0], f[1], f[2]) === VX.AIR && isStaticVx(vAt(above[0], above[1], above[2]) )) {
        out.push({ id: SIGN.id, at, up: e.up, fwd: e.fwd, s: 1 });
      }
    }
    // часы: край площадки, за которым стена ≥ 3 м (впереди или сбоку)
    {
      const depth = e.kind === 'pav' ? PAV_LAND_D : LAND_D;
      const topC = addS(addS(e.o, e.fwd, e.run + depth / 2), e.up, e.rise);
      const tries: [Axis6, number, number][] = [
        [e.fwd, depth / 2, -(e.width / 2 - 0.5)], [e.fwd, depth / 2, e.width / 2 - 0.5],
        [right, e.width / 2, 0], [opp(right), e.width / 2, 0],
      ];
      for (const [dir, dist, side] of tries) {
        const lat = dir === e.fwd ? right : e.fwd;
        const edgeP = addS(addS(topC, dir, dist), lat, side);
        let wall = true;
        for (let h = 0; h < 3 && wall; h++) {
          const w = footVox(addS(addS(edgeP, dir, 0.5), e.up, h), e.up);
          if (!isStaticVx(vAt(w[0], w[1], w[2]))) wall = false;
        }
        if (!wall) continue;
        if (put(CLOCK, addS(edgeP, dir, -0.1), e.up, dir, 1, true)) break;
      }
    }
  }
  // LOOK: кессоны-светильники на шести гранях станции 18 — по одному в каждой полосе между краем грани и дырой (для
  // стоящих под станцией это потолок со светом). Висячие (как указатель): up — в оболочку, модель — наружу от грани;
  // перед кессоном пусто (не площадка/подложка), за ним — оболочка, рядом на той же грани нет пропа (скамьи 1/3)
  {
    const mid0 = (t1 + n1) / 2, mid1 = (n2 + t2) / 2, c0 = (n1 + n2) / 2;
    const near = (at: V3, up: Axis6) => out.some((p) => p.up === opp(up) && Math.hypot(p.at[0] - at[0], p.at[1] - at[1], p.at[2] - at[2]) < 3.2);
    for (const nrm of AXES6) {
      const a = axisIdx(nrm), s = axisSign(nrm), j = ((a + 1) % 3) as 0 | 1 | 2, k = ((a + 2) % 3) as 0 | 1 | 2;
      const plane = s > 0 ? t2 : t1, up = opp(nrm);
      for (const [cj, ck, along] of [[mid0, c0, k], [mid1, c0, k], [c0, mid0, j], [c0, mid1, j]] as const) {
        if (out.length >= LIMIT) break;
        const at = pt(a, plane, j, cj, k, ck);
        const fwd = axis6(along as 0 | 1 | 2, 1), right = crossAxis(up, fwd);
        let ok = !near(at, up);
        for (const [u, v] of [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          if (!ok) break;
          const p = addS(addS(at, right, u * (COFFER.w / 2 - 0.1)), fwd, v * (COFFER.d / 2 - 0.1));
          const front = footVox(p, nrm), back = footVox(p, up);
          if (vAt(front[0], front[1], front[2]) !== VX.AIR || vAt(back[0], back[1], back[2]) !== VX.SHELL1) ok = false;
        }
        if (ok) out.push({ id: COFFER.id, at, up, fwd, s: 1 });
      }
    }
  }
  return out;
}

// ── световые линии ───────────────────────────────────────────────────────────────────────────────────────────
function makeLights(D: Dims, vox: Uint8Array, placed: Placed[]): LightLine[] {
  const { P, t1, t2, n1, n2, c1, c2, pw } = D;
  const out: LightLine[] = [];
  const vAt = (p: V3) => vox[vidx(P, wrapI(Math.floor(p[0]), P), wrapI(Math.floor(p[1]), P), wrapI(Math.floor(p[2]), P))];
  const SQ = Math.SQRT1_2;
  /** Ребро вдоль оси k на (j-плоскость, a-плоскость) с наружными нормалями n1, n2; лишь выпуклое и свободное. */
  const edge = (pa: V3, pb: V3, na: Axis6, nb: Axis6, kind: LightLine['kind'], scale: 1 | 3 | 9): void => {
    const mid: V3 = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2];
    if (vAt(addS(addS(mid, na, 0.5), nb, -0.5)) !== VX.AIR) return;
    if (vAt(addS(addS(mid, nb, 0.5), na, -0.5)) !== VX.AIR) return;
    if (vAt(addS(addS(mid, na, 0.5), nb, 0.5)) !== VX.AIR) return;
    if (vAt(addS(addS(mid, na, -0.5), nb, -0.5)) === VX.AIR) return;
    const A = AXIS_VEC[na], B = AXIS_VEC[nb];
    out.push({ a: pa, b: pb, out: [(A[0] + B[0]) * SQ, (A[1] + B[1]) * SQ, (A[2] + B[2]) * SQ], kind, scale });
  };
  const seg = (k: number, from: number, to: number, fix: [number, number][]): [V3, V3] => {
    const a: V3 = [0, 0, 0], b: V3 = [0, 0, 0];
    a[k] = from; b[k] = to;
    for (const [ax, v] of fix) { a[ax] = v; b[ax] = v; }
    return [a, b];
  };
  /** 12 рёбер куба [lo, hi)³ (обрезка clip с концов — там пилоны/стержни). */
  const cubeEdges = (lo: V3, hi: V3, clip: number, kind: LightLine['kind'], scale: 1 | 3 | 9, only?: (na: Axis6, nb: Axis6, k: number) => boolean) => {
    for (let k = 0; k < 3; k++) {
      const j = (k + 1) % 3, a = (k + 2) % 3;
      for (const sj of [-1, 1] as const) for (const sa of [-1, 1] as const) {
        const na = axis6(j as 0 | 1 | 2, sj), nb = axis6(a as 0 | 1 | 2, sa);
        if (only && !only(na, nb, k)) continue;
        const [pa, pb] = seg(k, lo[k] + clip, hi[k] - clip, [[j, sj < 0 ? lo[j] : hi[j]], [a, sa < 0 ? lo[a] : hi[a]]]);
        edge(pa, pb, na, nb, kind, scale);
      }
    }
  };
  /** Ободья дыр [h0, h1)² на 6 гранях куба [lo, hi)³ толщиной 1 — снаружи и изнутри. */
  const holeRims = (lo: number, hi: number, h0: number, h1: number, clip: number, scale: 1 | 3 | 9) => {
    for (let a = 0; a < 3; a++) for (const sa of [-1, 1] as const) {
      const planes: [number, Axis6][] = sa > 0 ? [[hi, axis6(a as 0 | 1 | 2, 1)], [hi - 1, axis6(a as 0 | 1 | 2, -1)]]
        : [[lo, axis6(a as 0 | 1 | 2, -1)], [lo + 1, axis6(a as 0 | 1 | 2, 1)]];
      for (const [pv, np] of planes) for (const j of [(a + 1) % 3, (a + 2) % 3]) {
        const k = 3 - a - j;
        for (const [jv, nj] of [[h0, axis6(j as 0 | 1 | 2, 1)], [h1, axis6(j as 0 | 1 | 2, -1)]] as [number, Axis6][]) {
          const [pa, pb] = seg(k, h0 + clip, h1 - clip, [[a, pv], [j, jv]]);
          edge(pa, pb, np, nj, 'rim', scale);
        }
      }
    }
  };
  // ободья дыр плит — с обеих сторон плиты (поверхности a = 1 и a = P − 1)
  for (let a = 0; a < 3; a++) for (const [pv, np] of [[1, axis6(a as 0 | 1 | 2, 1)], [P - 1, axis6(a as 0 | 1 | 2, -1)]] as [number, Axis6][]) {
    for (const j of [(a + 1) % 3, (a + 2) % 3]) {
      const k = 3 - a - j;
      for (const [jv, nj] of [[t1, axis6(j as 0 | 1 | 2, 1)], [t2, axis6(j as 0 | 1 | 2, -1)]] as [number, Axis6][]) {
        const [pa, pb] = seg(k, t1 + pw, t2 - pw, [[a, pv], [j, jv]]);
        edge(pa, pb, np, nj, 'rim', 1);
      }
    }
  }
  // станция 18 и станция 6: рёбра и ободья дыр
  cubeEdges([t1, t1, t1], [t2, t2, t2], pw, 'edge', 3);
  holeRims(t1, t2, n1, n2, 1, 3);
  cubeEdges([n1, n1, n1], [n2, n2, n2], 1, 'edge', 9);
  holeRims(n1, n2, c1, c2, 0, 9);
  // павильоны и края площадок
  for (const { c, esc: e } of placed) {
    const t = c.tpl;
    if (t.pav) {
      const b = boxW(P, c.pl, [t.pav.px, 1, t.pav.pz], [t.pav.px + t.pav.n, 1 + t.pav.n, t.pav.pz + t.pav.n]);
      cubeEdges(b.lo, b.hi, 0, 'pav', 9);
    }
    cubeEdges(e.top.lo, e.top.hi, 0, 'landing', 1, (na, nb, k) =>
      k !== axisIdx(e.up) && (na === e.up || nb === e.up) && na !== opp(e.fwd) && nb !== opp(e.fwd));
  }
  return out;
}

// ── запросы ──────────────────────────────────────────────────────────────────────────────────────────────────
/** Класс вокселя по целым координатам (любым — оборачиваются по модулю P). */
export function voxAt(cell: FractalCell, x: number, y: number, z: number): number {
  const P = cell.P;
  return cell.vox[vidx(P, ((x % P) + P) % P, ((y % P) + P) % P, ((z % P) + P) % P)];
}

/** Твёрдо ли: подложка сломанного эскалатора — пусто. */
export function solidAt(cell: FractalCell, x: number, y: number, z: number, broken?: ReadonlySet<number>): boolean {
  const v = voxAt(cell, x, y, z);
  if (v === VX.AIR) return false;
  if (isEscVx(v)) return !broken || !broken.has(v - VX.ESC0);
  return true;
}

/** Число осевых линий (3·P² штук), на которых нет статичного твёрдого. Должно быть 0. */
export function openAxisLines(cell: FractalCell): number {
  return countOpenLines(cell.P, isStaticVx, cell.vox);
}

/** Расстояние по оси dir от точки до первого статичного твёрдого, м (null — дальше maxM). */
export function axisRay(cell: FractalCell, from: V3, dir: Axis6, maxM: number): number | null {
  const a = axisIdx(dir), s = axisSign(dir);
  const p = [Math.floor(from[0]), Math.floor(from[1]), Math.floor(from[2])];
  if (isStaticVx(voxAt(cell, p[0], p[1], p[2]))) return 0;
  const steps = Math.ceil(maxM) + 2;
  for (let k = 1; k <= steps; k++) {
    p[a] += s;
    if (!isStaticVx(voxAt(cell, p[0], p[1], p[2]))) continue;
    const d = s > 0 ? p[a] - from[a] : from[a] - (p[a] + 1);
    return d <= maxM ? Math.max(0, d) : null;
  }
  return null;
}

/** Воксель (x,y,z) — место ступни: он и следующий по up пусты, предыдущий (по −up) твёрд. */
export function standable(cell: FractalCell, x: number, y: number, z: number, up: Axis6): boolean {
  const d = AXIS_VEC[up];
  return !solidAt(cell, x, y, z) && !solidAt(cell, x + d[0], y + d[1], z + d[2]) && solidAt(cell, x - d[0], y - d[1], z - d[2]);
}

/** Граф ходьбы (как nav.mjs): шаг вбок; падение вдоль −up; смена up у стены ≥ 2 м (за спиной просвет);
 *  эскалаторы — низ↔верх по направлениям дорожек (стоящая — в обе стороны). Узел = vidx·6 + up.
 *  Сверх контракта: maxFall — самое длинное падение в графе, м (вокселей). */
export function navReach(cell: FractalCell, from: FractalSpot): { seen: Uint8Array; count: number; total: number; has(at: V3, up: Axis6): boolean; maxFall: number } {
  const P = cell.P, N = P * P * P, vox = cell.vox;
  const seen = new Uint8Array(N * 6);
  const queue = new Int32Array(N * 6);
  let qh = 0, qt = 0, maxFall = 0;
  const solid = (x: number, y: number, z: number) => vox[vidx(P, wrapI(x, P), wrapI(y, P), wrapI(z, P))] !== VX.AIR;
  const stand = (x: number, y: number, z: number, up: Axis6) => {
    const d = AXIS_VEC[up];
    return !solid(x, y, z) && !solid(x + d[0], y + d[1], z + d[2]) && solid(x - d[0], y - d[1], z - d[2]);
  };
  const push = (x: number, y: number, z: number, up: Axis6) => {
    const node = vidx(P, wrapI(x, P), wrapI(y, P), wrapI(z, P)) * 6 + up;
    if (seen[node]) return;
    seen[node] = 1; queue[qt++] = node;
  };
  // рёбра эскалаторов: ступня внизу (перед наклоном) ↔ на площадке
  const escEdges = new Map<number, number[]>();
  const nodeOf = (p: V3, up: Axis6) => { const f = footVox(p, up); return vidx(P, wrapI(f[0], P), wrapI(f[1], P), wrapI(f[2], P)) * 6 + up; };
  const link = (a: number, b: number) => { const l = escEdges.get(a); if (l) l.push(b); else escEdges.set(a, [b]); };
  for (const e of cell.esc) {
    const right = crossAxis(e.up, e.fwd);
    for (const ln of e.lanes) {
      const base = addS(e.o, right, ln.off);
      const lo = nodeOf(addS(base, e.fwd, -0.5), e.up), hi = nodeOf(addS(addS(base, e.fwd, e.run + 0.5), e.up, e.rise), e.up);
      if (ln.dir >= 0) link(lo, hi);
      if (ln.dir <= 0) link(hi, lo);
    }
  }
  const f0 = footVox(from.at, from.up);
  push(f0[0], f0[1], f0[2], from.up);
  while (qh < qt) {
    const node = queue[qh++];
    const up = (node % 6) as Axis6, vi = (node - up) / 6;
    const x = vi % P, y = Math.floor(vi / P) % P, z = Math.floor(vi / (P * P));
    const U = AXIS_VEC[up], ax = axisIdx(up);
    const jumps = escEdges.get(node);
    if (jumps) for (const t of jumps) if (!seen[t]) { seen[t] = 1; queue[qt++] = t; }
    for (const d of AXES6) {
      if (axisIdx(d) === ax) continue;
      const Dd = AXIS_VEC[d];
      const nx = x + Dd[0], ny = y + Dd[1], nz = z + Dd[2];
      if (solid(nx, ny, nz)) {
        // стена ≥ 2 м и за спиной просвет — смена гравитации на opp(d)
        if (solid(nx + U[0], ny + U[1], nz + U[2]) && !solid(x - Dd[0], y - Dd[1], z - Dd[2])) {
          const nu = opp(d);
          if (stand(x, y, z, nu)) push(x, y, z, nu);
        }
        continue;
      }
      if (solid(nx + U[0], ny + U[1], nz + U[2])) continue; // низкий проход
      if (stand(nx, ny, nz, up)) { push(nx, ny, nz, up); continue; }
      // падение вдоль −up
      let fx = nx, fy = ny, fz = nz, k = 0;
      while (!solid(fx - U[0], fy - U[1], fz - U[2]) && k < 2 * P) { fx -= U[0]; fy -= U[1]; fz -= U[2]; k++; }
      if (k >= 2 * P) continue;
      maxFall = Math.max(maxFall, k + 1);
      push(fx, fy, fz, up);
    }
  }
  let count = 0, total = 0;
  for (let z = 0; z < P; z++) for (let y = 0; y < P; y++) for (let x = 0; x < P; x++) {
    if (vox[vidx(P, x, y, z)] !== VX.AIR) continue;
    const vi = vidx(P, x, y, z);
    for (const up of AXES6) if (stand(x, y, z, up)) { total++; if (seen[vi * 6 + up]) count++; }
  }
  return {
    seen, count, total, maxFall,
    has(at: V3, up: Axis6) { return seen[nodeOf(at, up)] === 1; },
  };
}

/** Сдвиги k (|k|∞ ≤ range) соседних копий относительно ячейки игрока c, которые выходные. */
export function exitCopies(c: V3, range: number): V3[] {
  const out: V3[] = [];
  for (let dz = -range; dz <= range; dz++) for (let dy = -range; dy <= range; dy++) for (let dx = -range; dx <= range; dx++) {
    if (isExitCell([c[0] + dx, c[1] + dy, c[2] + dz])) out.push([dx, dy, dz]);
  }
  return out;
}

// ── страховка «застрял» (INTEGRATE, tmp/metro-wip/notes-fr-integrate.md) ─────────────────────────────────────────
/** Сколько узлов графа ходьбы (правила navReach; подложки сломанных — пусто) достижимо из стоячей точки — до cap.
 *  Меньше cap — замкнутый карман: при P = 54 это щель 1 м между оболочкой и ядром «станции 6»/павильона и ядро под
 *  её дырой (шагнул в дыру — головой в дыре, назад не выйти: notes-fr-gen п. 9). Обычное место — весь граф (~20 тыс.).
 *  Карман щели при P = 54 — ≤ 84 узла, поэтому cap 400 (обход ~0.5 мс). Точка не стоячая (край, наклон) — cap:
 *  «не знаю» ≠ «застрял». */
export function navPocket(cell: FractalCell, at: V3, up: Axis6, broken?: ReadonlySet<number>, cap = 400): number {
  const P = cell.P;
  const solid = (x: number, y: number, z: number) => solidAt(cell, x, y, z, broken);
  const stand = (x: number, y: number, z: number, u: Axis6) => {
    const d = AXIS_VEC[u];
    return !solid(x, y, z) && !solid(x + d[0], y + d[1], z + d[2]) && solid(x - d[0], y - d[1], z - d[2]);
  };
  const key = (x: number, y: number, z: number, u: Axis6) => vidx(P, wrapI(x, P), wrapI(y, P), wrapI(z, P)) * 6 + u;
  const f0 = footVox(at, up);
  if (!stand(f0[0], f0[1], f0[2], up)) return cap;
  // эскалаторы (целые): ступня внизу ↔ на площадке, по направлениям дорожек — как navReach
  const escEdges = new Map<number, number[]>();
  const nodeOf = (p: V3, u: Axis6) => { const f = footVox(p, u); return key(f[0], f[1], f[2], u); };
  const link = (a: number, b: number) => { const l = escEdges.get(a); if (l) l.push(b); else escEdges.set(a, [b]); };
  for (const e of cell.esc) {
    if (broken?.has(e.i)) continue;
    const right = crossAxis(e.up, e.fwd);
    for (const ln of e.lanes) {
      const base = addS(e.o, right, ln.off);
      const lo = nodeOf(addS(base, e.fwd, -0.5), e.up), hi = nodeOf(addS(addS(base, e.fwd, e.run + 0.5), e.up, e.rise), e.up);
      if (ln.dir >= 0) link(lo, hi);
      if (ln.dir <= 0) link(hi, lo);
    }
  }
  const seen = new Set<number>();
  const queue: number[] = [];
  const push = (x: number, y: number, z: number, u: Axis6) => {
    const n = key(x, y, z, u);
    if (!seen.has(n)) { seen.add(n); queue.push(n); }
  };
  push(f0[0], f0[1], f0[2], up);
  for (let qh = 0; qh < queue.length && seen.size < cap; qh++) {
    const node = queue[qh];
    const u = (node % 6) as Axis6, vi = (node - u) / 6;
    const x = vi % P, y = Math.floor(vi / P) % P, z = Math.floor(vi / (P * P));
    const U = AXIS_VEC[u], ax = axisIdx(u);
    const jumps = escEdges.get(node);
    if (jumps) for (const t of jumps) if (!seen.has(t)) { seen.add(t); queue.push(t); }
    for (const d of AXES6) {
      if (axisIdx(d) === ax) continue;
      const Dd = AXIS_VEC[d];
      const nx = x + Dd[0], ny = y + Dd[1], nz = z + Dd[2];
      if (solid(nx, ny, nz)) {
        if (solid(nx + U[0], ny + U[1], nz + U[2]) && !solid(x - Dd[0], y - Dd[1], z - Dd[2])) {
          const nu = opp(d);
          if (stand(x, y, z, nu)) push(x, y, z, nu);
        }
        continue;
      }
      if (solid(nx + U[0], ny + U[1], nz + U[2])) continue;
      if (stand(nx, ny, nz, u)) { push(nx, ny, nz, u); continue; }
      let fx = nx, fy = ny, fz = nz, k = 0;
      while (!solid(fx - U[0], fy - U[1], fz - U[2]) && k < 2 * P) { fx -= U[0]; fy -= U[1]; fz -= U[2]; k++; }
      if (k < 2 * P) push(fx, fy, fz, u);
    }
  }
  return Math.min(cap, seen.size);
}
