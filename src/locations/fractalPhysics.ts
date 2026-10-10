// «Фрактальная станция» (FRACTAL.md §4) — тело игрока без движка: ходьба по любой из 6 граней, поворот гравитации
// упором в стену, падение с обёрткой по периоду, эскалаторы (наклон, лента, срыв, перелезание).
//
//  • Мир — ячейка P³ вокселей 1 м, повторяется по модулю P (solidAt: подложка сломанного эскалатора — пусто). Тело —
//    AABB 0.6 × 1.7 × 0.6, длинная сторона вдоль up (одна из 6 осей); ступни — центр подошвы, всегда в [0, P), номер
//    копии — FrBody.cell. Столкновения — по осям по очереди против вокселей; dt режется на подшаги ≤ 1/60 с и ≤ 0.4 м.
//    В шаге нет аллокаций векторов: бокс, ход и пробы — модульные буферы.
//  • «Шагнул в стену»: ход упёрся в высокую стену (воксели на wallLow и wallHigh над ступнями), желаемый ход — в неё
//    (cos ≥ pushCos), стоишь на полу — копится push; pushHold — гравитация плавно (turnS, smoothstep, ввод заморожен)
//    поворачивается на стену: стена — пол, старый пол — стена за спиной, взгляд «в стену» — взгляд «вверх вдоль новой
//    стены», pitch сохранён. Тесно (новый бокс 1.7 м от стены не помещается) — отказ.
//  • Сорвался — падение вдоль −up до первого твёрдого (каркас гарантирует ≤ P по любой оси), обёртка в соседнюю
//    копию (событие wrap), удар (land: тряска, оглушение — по скорости).
//  • Эскалатор — кинематика: на наклоне ступни на высоте rampH(s) над полом, поперёк — зажаты в дорожке, лента везёт;
//    вход — только с торцов в том же up, с боков наклон — стена (балюстрада). Срыв (fractalEsc.ts): runaway уносит
//    вниз (донесло до низа — выбросило на пол, удар 1), E — перелезть через балюстраду (дальше — обычное падение),
//    fall — наклона нет, свободное падение. В чужой гравитации наклона нет — только воксели подложки.
//  • Соглашение кадра — Babylon (LH): right = up × fwd; yaw — поворот fwd к right (fwd(yaw) = F·cos + R·sin при
//    FRAME[up] = {R, F}), pitch > 0 — взгляд вверх.
import { AXIS_VEC, FRAME, axisIdx, axisSign, axis6, isExitCell, opp, type Axis6, type V3 } from './fractalAxes';
import { solidAt, type FractalCell, type FractalEsc, type FractalSpot } from './fractalCell';
import { ESC } from './metroEscalator';
import type { FrEscWorld } from './fractalEsc';

export const FRP = {
  /** глаз над ступнями (как viewer.ts EYE) */
  eye: 1.6,
  /** полуширина тела и высота (как posture stand ell 0.3/0.85) */
  half: 0.3,
  h: 1.7,
  /** шаг / бег (Shift, без стамины), м/с */
  walk: 3.0,
  run: 5.0,
  /** разгон на земле / в воздухе, м/с² */
  acc: 30,
  airAcc: 3,
  /** падение вдоль −up и предел скорости */
  g: 9.8,
  vMax: 26,
  /** подъём на наклон/площадку без ступеньки (воксельные ступени 1 м НЕ шагаются, прыжка нет) */
  stepUp: 0.35,
  /** упор в стену до смены гравитации, с; косинус угла между желаемым ходом и направлением в стену */
  pushHold: 0.2,
  pushCos: 0.7,
  /** стена «высокая», если упор и на этих высотах над ступнями, м */
  wallLow: 0.3,
  wallHigh: 1.5,
  /** плавный поворот кадра и пауза после него, с */
  turnS: 0.55,
  turnCool: 0.4,
  /** удар: < soft — только шаг; soft…hard — тряска 0.4, оглушение 0.5 с; > hard — тряска 1.0, оглушение 1.2 с */
  landSoft: 5,
  landHard: 15,
  stunSoft: 0.5,
  stunHard: 1.2,
  shakeSoft: 0.4,
  shakeHard: 1.0,
  /** тряска гаснет за столько 1/с */
  shakeFade: 1.25,
  /** множитель скорости в оглушении */
  stunMul: 0.4,
  /** страховка: столько в воздухе → rescue */
  airMaxS: 8,
  /** pitch ∈ [−pitchMax, pitchMax] */
  pitchMax: 1.45,
  /** шаг (звук) — через столько метров пути по полу/наклону */
  stride: 0.75,
  /** дорожка эскалатора 1.2 м: середина ± (0.6 − half) */
  laneHalf: 0.6,
  /** балюстрада над поверхностью наклона и «тело» наклона под ней (до подложки), м */
  rail: 1.0,
  under: 1.5,
} as const;

export type Quat = [number, number, number, number];   // x, y, z, w — как Babylon Quaternion
export interface FrInput { fwd: number; side: number; run: boolean; dYaw: number; dPitch: number; use: boolean }
export interface FrRide { esc: number; lane: number; s: number }   // s — м в плане от низа наклона
export interface FrTurn { t: number; from: Axis6; to: Axis6; eye0: V3; eye1: V3; q0: Quat; q1: Quat; pos1: V3; yaw1: number; pitch1: number }
export interface FrBody {
  pos: V3;                 // ступни (центр подошвы), всегда в [0, P)
  cell: V3;                // абсолютный номер ячейки (целые) — для сверхпериода и напарников
  up: Axis6;
  yaw: number; pitch: number;   // в кадре up (FRAME), рад; pitch ∈ [−1.45, 1.45]
  vel: V3;                 // м/с, мир (на наклоне — только свой ход, без ленты)
  ground: 'floor' | 'ramp' | 'air';
  ride: FrRide | null;
  push: number;            // с упора в «высокую» стену
  cool: number;            // с до разрешения следующего поворота
  turn: FrTurn | null;
  airT: number; fallV: number;  // время в воздухе; скорость вдоль −up
  stun: number;            // с оглушения после удара
  shake: number;           // 0…1, затухает (для камеры SCENE)
  /** м пути с последнего шага (звук) */
  stride: number;
  /** тело в триггере выхода (событие exit — на входе в него) */
  inExit: boolean;
}
export type FrEvent =
  | { k: 'step' } | { k: 'land'; v: number; power: 0 | 1 | 2 }
  | { k: 'turn'; from: Axis6; to: Axis6 } | { k: 'turned'; up: Axis6 }
  | { k: 'wrap'; d: V3 } | { k: 'ride'; esc: number; lane: number } | { k: 'off' }
  | { k: 'exit' } | { k: 'rescue' };
export interface FrEnv { cell: FractalCell; esc: FrEscWorld }

const TAN30 = Math.tan(Math.PI / 6);
const COS30 = Math.cos(Math.PI / 6);
const EPS = 1e-6;
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const fin = (v: number): number => (Number.isFinite(v) ? v : 0);
const smooth = (t: number): number => {
  const u = clamp(t, 0, 1);
  return u * u * (3 - 2 * u);
};

/** Высота поверхности дорожки над полом эскалатора в точке s (м в плане). */
export function rampH(s: number): number {
  return s * TAN30;
}

/** right = up × fwd (оси). */
const RIGHT: Axis6[][] = [];
for (let u = 0; u < 6; u++) {
  RIGHT.push([]);
  for (let f = 0; f < 6; f++) {
    const a = AXIS_VEC[u], b = AXIS_VEC[f];
    const c: V3 = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const i = c.findIndex((x) => x !== 0);
    RIGHT[u].push(i < 0 ? (0 as Axis6) : axis6(i as 0 | 1 | 2, c[i] > 0 ? 1 : -1));
  }
}
/** Ось right = up × fwd (для эскалатора, грани, пропа). up ∥ fwd — 0. */
export const rightOf = (up: Axis6, fwd: Axis6): Axis6 => RIGHT[up][fwd];

/** yaw в кадре up, при котором взгляд в плоскости пола смотрит вдоль fwd (fwd ⊥ up). */
export function yawToward(up: Axis6, fwd: Axis6): number {
  const fr = FRAME[up], f = AXIS_VEC[fwd], R = AXIS_VEC[fr.right], F = AXIS_VEC[fr.fwd];
  return Math.atan2(f[0] * R[0] + f[1] * R[1] + f[2] * R[2], f[0] * F[0] + f[1] * F[1] + f[2] * F[2]);
}

// ───────────────────────── кватернионы (свои, без Babylon; x, y, z, w — как Babylon) ─────────────────────────

/** Кватернион поворота, переводящего X, Y, Z в r, u, f (базис ортонормален и правый в смысле r = u × f). */
export function quatFromBasis(r: V3, u: V3, f: V3): Quat {
  const m00 = r[0], m01 = u[0], m02 = f[0];
  const m10 = r[1], m11 = u[1], m12 = f[1];
  const m20 = r[2], m21 = u[2], m22 = f[2];
  const tr = m00 + m11 + m22;
  let x: number, y: number, z: number, w: number;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1);
    w = 0.25 / s; x = (m21 - m12) * s; y = (m02 - m20) * s; z = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    w = (m21 - m12) / s; x = 0.25 * s; y = (m01 + m10) / s; z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    w = (m02 - m20) / s; x = (m01 + m10) / s; y = 0.25 * s; z = (m12 + m21) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = 0.25 * s;
  }
  const n = Math.hypot(x, y, z, w) || 1;
  return [x / n, y / n, z / n, w / n];
}

export function slerp(a: Quat, b: Quat, t: number): Quat {
  let bx = b[0], by = b[1], bz = b[2], bw = b[3];
  let c = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (c < 0) { c = -c; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  let k0: number, k1: number;
  if (c > 0.9995) {
    k0 = 1 - t; k1 = t;
  } else {
    const th = Math.acos(c), s = Math.sin(th);
    k0 = Math.sin((1 - t) * th) / s; k1 = Math.sin(t * th) / s;
  }
  const x = k0 * a[0] + k1 * bx, y = k0 * a[1] + k1 * by, z = k0 * a[2] + k1 * bz, w = k0 * a[3] + k1 * bw;
  const n = Math.hypot(x, y, z, w) || 1;
  return [x / n, y / n, z / n, w / n];
}

/** a·b (сначала b, потом a). */
function qmul(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

/** Повернуть вектор кватернионом. */
export function qrot(q: Quat, v: V3): V3 {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}

// ───────────────────────── кадр взгляда ─────────────────────────

/** Взгляд в плоскости пола и вправо при yaw (в буферы). */
function planeDirs(up: Axis6, yaw: number, fwd: V3, right: V3): void {
  const fr = FRAME[up], R = AXIS_VEC[fr.right], F = AXIS_VEC[fr.fwd];
  const c = Math.cos(yaw), s = Math.sin(yaw);
  for (let k = 0; k < 3; k++) {
    fwd[k] = F[k] * c + R[k] * s;
    right[k] = R[k] * c - F[k] * s;
  }
}

/** Базис камеры (right, up, fwd) при up/yaw/pitch — новые массивы. */
function camBasis(up: Axis6, yaw: number, pitch: number): { right: V3; up: V3; fwd: V3 } {
  const f: V3 = [0, 0, 0], r: V3 = [0, 0, 0];
  planeDirs(up, yaw, f, r);
  const U = AXIS_VEC[up], c = Math.cos(pitch), s = Math.sin(pitch);
  return {
    right: r,
    up: [U[0] * c - f[0] * s, U[1] * c - f[1] * s, U[2] * c - f[2] * s],
    fwd: [f[0] * c + U[0] * s, f[1] * c + U[1] * s, f[2] * c + U[2] * s],
  };
}

// ───────────────────────── тело ─────────────────────────

const wrapP = (v: number, P: number): number => {
  const r = v % P;
  return r < 0 ? r + P : r;
};

/** Поставить тело в точку (ступни at, гравитация up, взгляд yaw; cell — номер копии, P — обернуть at в [0, P)) —
 *  сброс движения, поворота, удара. */
export function placeBody(b: FrBody, at: V3, up: Axis6, yaw: number, cell?: V3, P?: number): void {
  for (let k = 0; k < 3; k++) {
    const v = fin(at[k]);
    const w = P ? Math.floor(v / P) : 0;
    b.pos[k] = v - w * (P ?? 0);
    if (cell) b.cell[k] = Math.round(fin(cell[k])) + w;
    else b.cell[k] += w;
  }
  b.up = up;
  b.yaw = fin(yaw);
  b.pitch = 0;
  b.vel[0] = b.vel[1] = b.vel[2] = 0;
  b.ground = 'floor';
  b.ride = null;
  b.push = 0;
  b.cool = 0;
  b.turn = null;
  b.airT = 0;
  b.fallV = 0;
  b.stun = 0;
  b.shake = 0;
  b.stride = 0;
  b.inExit = false;
}

export function createBody(spot: FractalSpot, cell: V3): FrBody {
  const b: FrBody = {
    pos: [0, 0, 0], cell: [0, 0, 0], up: spot.up, yaw: 0, pitch: 0, vel: [0, 0, 0], ground: 'floor', ride: null, push: 0, cool: 0,
    turn: null, airT: 0, fallV: 0, stun: 0, shake: 0, stride: 0, inExit: false,
  };
  placeBody(b, spot.at, spot.up, yawToward(spot.up, spot.fwd), cell);
  return b;
}

// ───────────────────────── воксели (модульные буферы; без аллокаций) ─────────────────────────

let CELL: FractalCell | null = null;
let BROKEN: ReadonlySet<number> = new Set();
let PP = 54;
const useEnv = (env: FrEnv): void => {
  CELL = env.cell;
  BROKEN = env.esc.broken;
  PP = env.cell.P;
};
const C: V3 = [0, 0, 0];
const solidC = (): boolean => solidAt(CELL!, C[0], C[1], C[2], BROKEN);

/** Есть ли твёрдое в боксе (м; границы — с допуском EPS внутрь). */
function boxSolid(l0: number, l1: number, l2: number, h0: number, h1: number, h2: number): boolean {
  const x0 = Math.floor(l0 + EPS), x1 = Math.ceil(h0 - EPS) - 1;
  const y0 = Math.floor(l1 + EPS), y1 = Math.ceil(h1 - EPS) - 1;
  const z0 = Math.floor(l2 + EPS), z1 = Math.ceil(h2 - EPS) - 1;
  for (let z = z0; z <= z1; z++)
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) if (solidAt(CELL!, x, y, z, BROKEN)) return true;
  return false;
}

/** Свободен ли бокс (м, мир ячейки, с оборачиванием) от твёрдого. */
export function boxFree(env: FrEnv, lo: V3, hi: V3): boolean {
  useEnv(env);
  return !boxSolid(lo[0], lo[1], lo[2], hi[0], hi[1], hi[2]);
}

/** Бокс тела (ступни p, гравитация up) — в LO/HI. */
const LO: V3 = [0, 0, 0], HI: V3 = [0, 0, 0];
function setBox(p: V3, up: Axis6): void {
  const ua = axisIdx(up), us = axisSign(up);
  for (let k = 0; k < 3; k++) {
    if (k === ua) {
      LO[k] = us > 0 ? p[k] : p[k] - FRP.h;
      HI[k] = us > 0 ? p[k] + FRP.h : p[k];
    } else {
      LO[k] = p[k] - FRP.half;
      HI[k] = p[k] + FRP.half;
    }
  }
}
const bodySolid = (): boolean => boxSolid(LO[0], LO[1], LO[2], HI[0], HI[1], HI[2]);

/** Слой вокселей i по оси k в поперечнике бокса — есть твёрдое? */
function layerSolid(k: number, i: number): boolean {
  const o1 = k === 0 ? 1 : 0, o2 = k === 2 ? 1 : 2;
  const a0 = Math.floor(LO[o1] + EPS), a1 = Math.ceil(HI[o1] - EPS) - 1;
  const b0 = Math.floor(LO[o2] + EPS), b1 = Math.ceil(HI[o2] - EPS) - 1;
  C[k] = i;
  for (let a = a0; a <= a1; a++) {
    C[o1] = a;
    for (let b = b0; b <= b1; b++) {
      C[o2] = b;
      if (solidC()) return true;
    }
  }
  return false;
}

/** Слой, о который упёрся последний sweep (NaN — не упёрся). */
let HIT = NaN;
/** Ход бокса LO/HI по оси k на d до первого твёрдого слоя; возвращает пройденное (бокс НЕ двигает). */
function sweep(k: number, d: number): number {
  HIT = NaN;
  if (d > 0) {
    const from = HI[k], i0 = Math.ceil(from - EPS), i1 = Math.ceil(from + d - EPS) - 1;
    for (let i = i0; i <= i1; i++) if (layerSolid(k, i)) { HIT = i; return Math.min(d, i - from); }
  } else if (d < 0) {
    const from = LO[k], i0 = Math.floor(from + EPS) - 1, i1 = Math.floor(from + d + EPS);
    for (let i = i0; i >= i1; i--) if (layerSolid(k, i)) { HIT = i; return Math.max(d, i + 1 - from); }
  }
  return d;
}

/** Опора: проба 0.05 м под подошвой по всему следу. */
function supported(up: Axis6): boolean {
  const ua = axisIdx(up), us = axisSign(up);
  const l = us > 0 ? LO[ua] - 0.05 : HI[ua], h = us > 0 ? LO[ua] : HI[ua] + 0.05;
  const sl = LO[ua], sh = HI[ua];
  LO[ua] = l; HI[ua] = h;
  const r = bodySolid();
  LO[ua] = sl; HI[ua] = sh;
  return r;
}

/** Стена «высокая»: в слое iw по оси k твёрдое на wallLow и wallHigh над ступнями (в поперечнике тела). */
function highWall(k: number, iw: number, up: Axis6, feet: number): boolean {
  const ua = axisIdx(up), us = axisSign(up), o = 3 - k - ua;
  const c0 = Math.floor(LO[o] + EPS), c1 = Math.ceil(HI[o] - EPS) - 1;
  for (let j = 0; j < 2; j++) {
    C[k] = iw;
    C[ua] = Math.floor(feet + us * (j ? FRP.wallHigh : FRP.wallLow));
    let any = false;
    for (let c = c0; c <= c1 && !any; c++) {
      C[o] = c;
      any = solidC();
    }
    if (!any) return false;
  }
  return true;
}

// ───────────────────────── эскалаторы (кадр: s — вдоль fwd в плане, a — вдоль right, h — над полом) ─────────────────────────

const ES = { s: 0, a: 0, h: 0 };
/** Координаты точки p в кадре эскалатора e (с оборачиванием) — в ES. */
function escLocal(e: FractalEsc, p: V3): void {
  const P = PP, U = AXIS_VEC[e.up], F = AXIS_VEC[e.fwd], R = AXIS_VEC[rightOf(e.up, e.fwd)];
  let s = 0, a = 0, h = 0;
  for (let k = 0; k < 3; k++) {
    // ближайший образ — относительно середины эскалатора (наклон длиннее P/2)
    const m = F[k] * e.run * 0.5 + U[k] * e.rise * 0.5;
    let d = p[k] - e.o[k];
    d -= P * Math.round((d - m) / P);
    s += d * F[k]; a += d * R[k]; h += d * U[k];
  }
  ES.s = s; ES.a = a; ES.h = h;
}

/** Точка в кадре эскалатора → мир ячейки (в out). */
function escWorld(e: FractalEsc, s: number, a: number, h: number, out: V3): void {
  const U = AXIS_VEC[e.up], F = AXIS_VEC[e.fwd], R = AXIS_VEC[rightOf(e.up, e.fwd)];
  for (let k = 0; k < 3; k++) out[k] = e.o[k] + F[k] * s + R[k] * a + U[k] * h;
}

/** Ближайшая дорожка к a; -1 — между дорожками дальше laneHalf + half (торец балюстрады). */
function laneAt(e: FractalEsc, a: number): number {
  let best = -1, bd = Infinity;
  for (let i = 0; i < e.lanes.length; i++) {
    const d = Math.abs(a - e.lanes[i].off);
    if (d < bd) { bd = d; best = i; }
  }
  return bd <= FRP.laneHalf + FRP.half ? best : -1;
}

/** Торец эскалатора, с которого входят (ES уже посчитан): 1 — низ, 2 — верх, 0 — нет. */
function entryEnd(e: FractalEsc): 0 | 1 | 2 {
  if (Math.abs(ES.a) > e.width / 2 || laneAt(e, ES.a) < 0) return 0;
  if (ES.s >= -FRP.half && ES.s <= 0.6 && Math.abs(ES.h) <= FRP.stepUp) return 1;
  if (ES.s >= e.run - 0.6 && ES.s <= e.run + FRP.half && Math.abs(ES.h - e.rise) <= FRP.stepUp) return 2;
  return 0;
}

const escLive = (env: FrEnv, i: number): boolean => !env.esc.broken.has(i);

/** Насколько тело (ступни p, гравитация up) влезло вбок в призму наклона (балюстраду) эскалатора своего up: м поперёк
 *  (width/2 + half − |a|, наибольшее по эскалаторам); 0 — не упирается ни в один. Торцы (вход) не считаются. */
function rampDepth(env: FrEnv, p: V3, up: Axis6): number {
  const list = env.cell.esc;
  let depth = 0;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (e.up !== up || !escLive(env, i)) continue;
    escLocal(e, p);
    const { s, a, h } = ES;
    if (s + FRP.half <= 0 || s - FRP.half >= e.run) continue;
    const dA = e.width / 2 + FRP.half - Math.abs(a);
    if (dA <= 0) continue;
    const top = rampH(clamp(s + FRP.half, 0, e.run)) + FRP.rail, bot = rampH(clamp(s - FRP.half, 0, e.run)) - FRP.under;
    if (h >= top || h + FRP.h <= bot) continue;
    if (entryEnd(e)) continue;
    if (dA > depth) depth = dA;
  }
  return depth;
}

/** Тело (ступни p, гравитация up) упирается в бок наклона (балюстраду) какого-нибудь эскалатора своего up. */
const rampBlocks = (env: FrEnv, p: V3, up: Axis6): boolean => rampDepth(env, p, up) > 0;

// ───────────────────────── шаг ─────────────────────────

const NO_EVENTS: readonly FrEvent[] = Object.freeze([]) as readonly FrEvent[];
const EV_STEP: FrEvent = { k: 'step' }, EV_OFF: FrEvent = { k: 'off' }, EV_EXIT: FrEvent = { k: 'exit' }, EV_RESCUE: FrEvent = { k: 'rescue' };
let OUT: FrEvent[] | null = null;
const emit = (e: FrEvent): void => {
  (OUT ??= []).push(e);
};
/** События шага: новый массив или общий пустой (замороженный — не дописывать). */
const flush = (): FrEvent[] => OUT ?? (NO_EVENTS as FrEvent[]);

const WISH: V3 = [0, 0, 0], FW: V3 = [0, 0, 0], RT: V3 = [0, 0, 0], TMP: V3 = [0, 0, 0];
let WISH_LEN = 0;

/** Желаемая скорость в плоскости пола (в WISH) и единичный желаемый ход (в FW — для упора). */
function wishOf(b: FrBody, inp: FrInput): void {
  planeDirs(b.up, b.yaw, FW, RT);
  let f = clamp(fin(inp.fwd), -1, 1), s = clamp(fin(inp.side), -1, 1);
  const n = Math.hypot(f, s);
  if (n > 1) { f /= n; s /= n; }
  const sp = (inp.run ? FRP.run : FRP.walk) * (b.stun > 0 ? FRP.stunMul : 1);
  WISH_LEN = Math.min(1, n);
  for (let k = 0; k < 3; k++) WISH[k] = (FW[k] * f + RT[k] * s) * sp;
  // единичный ход — в FW (для косинуса упора)
  if (n > 1e-6) for (let k = 0; k < 3; k++) FW[k] = (WISH[k] / sp) / WISH_LEN;
  else FW[0] = FW[1] = FW[2] = 0;
}

/** Плоская скорость (без компоненты вдоль up) — к WISH с ускорением ≤ a·h. */
function approach(b: FrBody, a: number, h: number): void {
  const ua = axisIdx(b.up);
  let n2 = 0;
  for (let k = 0; k < 3; k++) {
    if (k === ua) { TMP[k] = 0; continue; }
    TMP[k] = WISH[k] - b.vel[k];
    n2 += TMP[k] * TMP[k];
  }
  const n = Math.sqrt(n2), m = a * h;
  const f = n > m ? m / n : 1;
  for (let k = 0; k < 3; k++) if (k !== ua) b.vel[k] += TMP[k] * f;
}

/** Удар о пол со скоростью v (power — по скорости или не слабее min). */
function land(b: FrBody, v: number, min: 0 | 1 | 2 = 0): void {
  const pv: 0 | 1 | 2 = v < FRP.landSoft ? 0 : v < FRP.landHard ? 1 : 2;
  const power: 0 | 1 | 2 = pv > min ? pv : min;
  if (power === 1) { b.stun = Math.max(b.stun, FRP.stunSoft); b.shake = Math.max(b.shake, FRP.shakeSoft); }
  if (power === 2) { b.stun = Math.max(b.stun, FRP.stunHard); b.shake = Math.max(b.shake, FRP.shakeHard); }
  emit({ k: 'land', v, power });
  b.airT = 0;
  b.fallV = 0;
}

function addStride(b: FrBody, d: number): void {
  b.stride += d;
  if (b.stride >= FRP.stride) {
    b.stride -= FRP.stride * Math.floor(b.stride / FRP.stride);
    emit(EV_STEP);
  }
}

/** Встать на дорожку lane эскалатора i в точке s (поперёк — в дорожке). */
function mount(env: FrEnv, b: FrBody, i: number, lane: number, s: number): void {
  const e = env.cell.esc[i], off = e.lanes[lane].off;
  escLocal(e, b.pos);
  const ss = clamp(s, 0, e.run), a = clamp(ES.a, off - (FRP.laneHalf - FRP.half), off + (FRP.laneHalf - FRP.half));
  escWorld(e, ss, a, rampH(ss), b.pos);
  wrapPos(b);
  b.ride = { esc: i, lane, s: ss };
  b.ground = 'ramp';
  b.airT = 0;
  b.fallV = 0;
  const ua = axisIdx(b.up);
  b.vel[ua] = 0;
  emit({ k: 'ride', esc: i, lane });
}

/** Сойти с наклона в точке (s, a, h) кадра эскалатора. */
function dismount(b: FrBody, e: FractalEsc, s: number, a: number, h: number, ground: 'floor' | 'air'): void {
  escWorld(e, s, a, h, b.pos);
  wrapPos(b);
  b.ride = null;
  b.ground = ground;
  b.airT = 0;
  emit(EV_OFF);
}

const WRAP_D: V3 = [0, 0, 0];
function wrapPos(b: FrBody): boolean {
  const P = PP;
  let any = false;
  for (let k = 0; k < 3; k++) {
    WRAP_D[k] = 0;
    const v = b.pos[k];
    if (v >= P || v < 0) {
      const w = Math.floor(v / P);
      b.pos[k] = v - w * P;
      if (b.pos[k] >= P) b.pos[k] = 0;
      b.cell[k] += w;
      WRAP_D[k] = w;
      any = true;
    }
  }
  return any;
}

/** Можно ли сейчас перелезть через балюстраду (наклон, лента бежит вниз, не у концов, сбоку свободно). */
export function canHop(env: FrEnv, b: FrBody): boolean {
  useEnv(env);
  return hopTarget(env, b) !== 0;
}

/** Куда перелезть: ±1 — сторона (right эскалатора), 0 — нельзя. Цель — в HOP. */
const HOP: V3 = [0, 0, 0];
function hopTarget(env: FrEnv, b: FrBody): -1 | 0 | 1 {
  const r = b.ride;
  if (!r || env.esc.stage(r.esc) !== 'runaway') return 0;
  const e = env.cell.esc[r.esc];
  const end = ESC.climbEndM * COS30;
  if (r.s < end || r.s > e.run - end) return 0;
  escLocal(e, b.pos);
  const off = e.lanes[r.lane].off;
  const first: 1 | -1 = off > 0.01 ? 1 : off < -0.01 ? -1 : ES.a >= off ? 1 : -1;
  for (let j = 0; j < 2; j++) {
    const side: 1 | -1 = j ? (-first as 1 | -1) : first;
    escWorld(e, r.s, side * (e.width / 2 + FRP.half + 0.05), rampH(r.s), HOP);
    setBox(HOP, b.up);
    if (!bodySolid()) return side;
  }
  return 0;
}

function rideStep(env: FrEnv, b: FrBody, inp: FrInput, h: number): void {
  const r = b.ride!, e = env.cell.esc[r.esc];
  if (!e) {
    b.ride = null;
    b.ground = 'air';
    emit(EV_OFF);
    return;
  }
  if (!escLive(env, r.esc)) {
    // наклон пропал (стадия fall) — свободное падение с тем, что было
    escLocal(e, b.pos);
    dismount(b, e, ES.s, ES.a, ES.h, 'air');
    const belt = env.esc.belt(r.esc, r.lane);
    const F = AXIS_VEC[e.fwd], U = AXIS_VEC[e.up];
    for (let k = 0; k < 3; k++) b.vel[k] += F[k] * belt * COS30 + U[k] * belt * 0.5;
    return;
  }
  const stage = env.esc.stage(r.esc);
  if (inp.use) {
    const side = hopTarget(env, b);
    if (side) {
      b.pos[0] = HOP[0]; b.pos[1] = HOP[1]; b.pos[2] = HOP[2];
      wrapPos(b);
      b.ride = null;
      b.ground = 'air';
      b.airT = 0;
      emit(EV_OFF);
      return;
    }
  }
  approach(b, FRP.acc, h);
  const F = AXIS_VEC[e.fwd], R = AXIS_VEC[rightOf(e.up, e.fwd)];
  let vs = 0, va = 0;
  for (let k = 0; k < 3; k++) { vs += b.vel[k] * F[k]; va += b.vel[k] * R[k]; }
  const belt = env.esc.belt(r.esc, r.lane);
  escLocal(e, b.pos);
  const off = e.lanes[r.lane].off, lim = FRP.laneHalf - FRP.half;
  const s1 = r.s + (vs + belt * COS30) * h;
  let a1 = ES.a + va * h;
  if (a1 < off - lim || a1 > off + lim) {
    a1 = clamp(a1, off - lim, off + lim);
    for (let k = 0; k < 3; k++) b.vel[k] -= R[k] * va;
  }
  addStride(b, Math.abs(vs) * h / COS30);
  if (s1 < 0) {
    dismount(b, e, s1, a1, 0, 'floor');
    for (let k = 0; k < 3; k++) b.vel[k] += F[k] * belt * COS30;
    // донесло до низа в runaway — выбросило на пол
    if (stage === 'runaway') land(b, Math.abs(belt), 1);
    return;
  }
  if (s1 > e.run) {
    dismount(b, e, s1, a1, e.rise, 'floor');
    for (let k = 0; k < 3; k++) b.vel[k] += F[k] * belt * COS30;
    return;
  }
  r.s = s1;
  escWorld(e, s1, a1, rampH(s1), b.pos);
  wrapPos(b);
}

/** Падение сверху на наклон своего up (центр тела над лентой, ступни за подшаг dh вдоль up пересекли rampH) — встать
 *  на дорожку и удар. true — сел. */
function catchRamp(env: FrEnv, b: FrBody, dh: number): boolean {
  const list = env.cell.esc;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (e.up !== b.up || !escLive(env, i)) continue;
    escLocal(e, b.pos);
    if (ES.s < 0 || ES.s > e.run || Math.abs(ES.a) > e.width / 2) continue;
    const hr = rampH(ES.s), h0 = ES.h - dh;
    if (ES.h <= hr && h0 >= hr - 0.05) {
      const lane = laneAt(e, ES.a);
      const v = b.fallV;
      mount(env, b, i, lane < 0 ? nearestLane(e, ES.a) : lane, ES.s);
      for (let k = 0; k < 3; k++) b.vel[k] = 0;
      land(b, v);
      return true;
    }
  }
  return false;
}

/** Падение на кромку наклона своего up: центр тела снаружи (|a| > width/2), бок задевает балюстраду, ступни за подшаг
 *  dh (< 0) опустятся ниже её верха. Отжать поперёк за балюстраду (дальше — падение мимо; поперечный ход к эскалатору
 *  гасится) — false; за ней тесно — сесть на ближайшую дорожку (удар) — true. Без этого тело проваливалось на воксели
 *  подложки под настилом и потом ходило сквозь эскалатор. */
const EDGE: V3 = [0, 0, 0];
function edgeFall(env: FrEnv, b: FrBody, dh: number): boolean {
  const list = env.cell.esc;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (e.up !== b.up || !escLive(env, i)) continue;
    escLocal(e, b.pos);
    const { s, a, h } = ES;
    if (s + FRP.half <= 0 || s - FRP.half >= e.run) continue;
    const w2 = e.width / 2, aa = Math.abs(a);
    // центр над лентой — ловит catchRamp; бок не достаёт — мимо
    if (aa <= w2 || aa - FRP.half >= w2) continue;
    const top = rampH(clamp(s + FRP.half, 0, e.run)) + FRP.rail;
    // уже ниже верха (вбок держит moveStep) или за подшаг не достанет
    if (h < top - 1e-6 || h + dh >= top) continue;
    const sg = a > 0 ? 1 : -1;
    escWorld(e, s, sg * (w2 + FRP.half + 0.01), h, EDGE);
    setBox(EDGE, b.up);
    if (!bodySolid() && !rampBlocks(env, EDGE, b.up)) {
      const R = AXIS_VEC[rightOf(e.up, e.fwd)];
      let va = 0;
      for (let k = 0; k < 3; k++) { b.pos[k] = EDGE[k]; va += b.vel[k] * R[k]; }
      if (va * sg < 0) for (let k = 0; k < 3; k++) b.vel[k] -= R[k] * va;
      setBox(b.pos, b.up);
      return false;
    }
    setBox(b.pos, b.up);
    const v = b.fallV;
    mount(env, b, i, nearestLane(e, a), s);
    for (let k = 0; k < 3; k++) b.vel[k] = 0;
    land(b, v);
    return true;
  }
  return false;
}

/** Ход по полу / в воздухе на подшаг h. */
function moveStep(env: FrEnv, b: FrBody, h: number): void {
  const ua = axisIdx(b.up), us = axisSign(b.up);
  const air = b.ground === 'air';
  approach(b, air ? FRP.airAcc : FRP.acc, h);
  if (air) {
    let vu = b.vel[ua] * us - FRP.g * h;
    if (vu < -FRP.vMax) vu = -FRP.vMax;
    b.vel[ua] = vu * us;
    b.airT += h;
  } else {
    b.vel[ua] = 0;
  }
  b.fallV = Math.max(0, -b.vel[ua] * us);
  setBox(b.pos, b.up);
  // уже в призме наклона (поворот, перенос, старые сохранения) — выходить можно только наружу: вглубь, а значит и
  // насквозь под настилом на другую сторону, не пускает та же балюстрада
  const depth0 = rampDepth(env, b.pos, b.up);
  // по горизонтальным осям: упор, «высокая» стена, балюстрады
  let pushNow = false, pushK = -1, pushSign = 0, pushI = 0, bestCos: number = FRP.pushCos;
  let moved = 0;
  for (let k = 0; k < 3; k++) {
    if (k === ua) continue;
    const d = b.vel[k] * h;
    if (d === 0) continue;
    const got = sweep(k, d);
    b.pos[k] += got; LO[k] += got; HI[k] += got;
    if (rampDepth(env, b.pos, b.up) > depth0 + 1e-9) {
      b.pos[k] -= got; LO[k] -= got; HI[k] -= got;
      b.vel[k] = 0;
      continue;
    }
    moved += got * got;
    if (got !== d && !Number.isNaN(HIT)) {
      b.vel[k] = 0;
      const sg = d > 0 ? 1 : -1, cs = FW[k] * sg;
      if (!air && b.cool <= 0 && cs >= bestCos && highWall(k, HIT, b.up, b.pos[ua])) {
        pushNow = true; pushK = k; pushSign = sg; pushI = HIT; bestCos = cs;
      }
    }
  }
  if (!air) addStride(b, Math.sqrt(moved));
  // вдоль up: падение и приземление
  if (air) {
    const d = b.vel[ua] * h;
    // падает на кромку наклона центром снаружи — отжать за балюстраду (тесно — сел на ленту)
    if (d * us < 0 && edgeFall(env, b, d * us)) return;
    const got = sweep(ua, d);
    b.pos[ua] += got; LO[ua] += got; HI[ua] += got;
    // поймал наклон своего up сверху — раньше вокселей подложки под настилом (щель от 0.3 м, подшаг до 0.4 м)
    if (d * us < 0 && catchRamp(env, b, got * us)) return;
    if (got !== d && !Number.isNaN(HIT)) {
      const v = Math.max(0, -b.vel[ua] * us);
      b.vel[ua] = 0;
      if (d * us < 0) {
        b.ground = 'floor';
        land(b, v);
      }
    }
  }
  // опора
  if (b.ground === 'floor') {
    if (!supported(b.up)) {
      b.ground = 'air';
      b.airT = 0;
    } else {
      // вход на наклон с торца (в том же up, ход — внутрь)
      const list = env.cell.esc;
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (e.up !== b.up || !escLive(env, i)) continue;
        escLocal(e, b.pos);
        const end = entryEnd(e);
        if (!end) continue;
        const F = AXIS_VEC[e.fwd];
        const vf = b.vel[0] * F[0] + b.vel[1] * F[1] + b.vel[2] * F[2];
        if ((end === 1 && vf > 0.05) || (end === 2 && vf < -0.05)) {
          mount(env, b, i, laneAt(e, ES.a), ES.s);
          break;
        }
      }
    }
  }
  // упор → поворот
  if (pushNow) {
    b.push += h;
    if (b.push >= FRP.pushHold) {
      b.push = 0;
      tryTurn(b, pushK, pushSign, pushI);
    }
  } else {
    b.push = 0;
  }
}

function nearestLane(e: FractalEsc, a: number): number {
  let best = 0, bd = Infinity;
  for (let i = 0; i < e.lanes.length; i++) {
    const d = Math.abs(a - e.lanes[i].off);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/** Поворот гравитации в стену (ось k, знак sg, слой стены iw). false — тесно. */
function tryTurn(b: FrBody, k: number, sg: number, iw: number): boolean {
  const d = axis6(k as 0 | 1 | 2, sg > 0 ? 1 : -1), nu = opp(d);
  const ua = axisIdx(b.up), us = axisSign(b.up), o = 3 - k - ua;
  const w = sg > 0 ? iw : iw + 1;
  const f = b.pos[ua];
  const pos1: V3 = [0, 0, 0];
  pos1[k] = w;
  pos1[o] = b.pos[o];
  let ok = false;
  for (let sh = 0; sh <= 1.2 + 1e-9 && !ok; sh += 0.3) {
    pos1[ua] = f + us * (FRP.half + sh);
    setBox(pos1, nu);
    ok = !bodySolid();
  }
  if (!ok) return false;
  const cam0 = camBasis(b.up, b.yaw, b.pitch);
  const q0 = quatFromBasis(cam0.right, cam0.up, cam0.fwd);
  // R: старый up → новый (−d), d → старый up; ось d × up, +90°
  const D = AXIS_VEC[d], U = AXIS_VEC[b.up];
  const n: V3 = [D[1] * U[2] - D[2] * U[1], D[2] * U[0] - D[0] * U[2], D[0] * U[1] - D[1] * U[0]];
  const s = Math.SQRT1_2;
  const R: Quat = [n[0] * s, n[1] * s, n[2] * s, s];
  const q1 = qmul(R, q0);
  // новый yaw — разложение повёрнутого взгляда в плоскости пола в FRAME[nu]; pitch сохранён
  const f0: V3 = [0, 0, 0], r0: V3 = [0, 0, 0];
  planeDirs(b.up, b.yaw, f0, r0);
  const f1 = qrot(R, f0);
  const fr = FRAME[nu], RR = AXIS_VEC[fr.right], FF = AXIS_VEC[fr.fwd];
  const yaw1 = Math.atan2(f1[0] * RR[0] + f1[1] * RR[1] + f1[2] * RR[2], f1[0] * FF[0] + f1[1] * FF[1] + f1[2] * FF[2]);
  const NU = AXIS_VEC[nu];
  b.turn = {
    t: 0, from: b.up, to: nu,
    eye0: [b.pos[0] + U[0] * FRP.eye, b.pos[1] + U[1] * FRP.eye, b.pos[2] + U[2] * FRP.eye],
    eye1: [pos1[0] + NU[0] * FRP.eye, pos1[1] + NU[1] * FRP.eye, pos1[2] + NU[2] * FRP.eye],
    q0, q1, pos1, yaw1, pitch1: b.pitch,
  };
  b.vel[0] = b.vel[1] = b.vel[2] = 0;
  b.push = 0;
  emit({ k: 'turn', from: b.up, to: nu });
  return true;
}

/** Один шаг (dt режется на подшаги ≤ 1/60 с и ≤ 0.4 м). Массив событий — новый (или общий пустой). */
export function stepBody(env: FrEnv, b: FrBody, inp: FrInput, dt: number): FrEvent[] {
  OUT = null;
  if (!(dt > 0) || !Number.isFinite(dt)) return NO_EVENTS as FrEvent[];
  useEnv(env);
  // взгляд (поворот кадра морозит ввод)
  if (!b.turn) {
    b.yaw += fin(inp.dYaw);
    if (b.yaw > Math.PI || b.yaw < -Math.PI) b.yaw -= 2 * Math.PI * Math.round(b.yaw / (2 * Math.PI));
    b.pitch = clamp(b.pitch + fin(inp.dPitch), -FRP.pitchMax, FRP.pitchMax);
  }
  // страховка: тело в твёрдом — вытолкнуть вдоль up ≤ 3 м, иначе rescue
  if (!b.turn && !b.ride) {
    setBox(b.pos, b.up);
    if (bodySolid()) {
      const U = AXIS_VEC[b.up];
      let ok = false;
      for (let i = 1; i <= 60 && !ok; i++) {
        for (let k = 0; k < 3; k++) TMP[k] = b.pos[k] + U[k] * 0.05 * i;
        setBox(TMP, b.up);
        ok = !bodySolid();
      }
      if (!ok) {
        emit(EV_RESCUE);
        return flush();
      }
      b.pos[0] = TMP[0]; b.pos[1] = TMP[1]; b.pos[2] = TMP[2];
      wrapPos(b);
    }
  }
  const vEst = Math.hypot(b.vel[0], b.vel[1], b.vel[2]) + FRP.g * dt + FRP.run;
  const n = Math.min(1200, Math.max(1, Math.ceil(dt * 60 - 1e-9), Math.ceil((vEst * dt) / 0.4)));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    const t = b.turn;
    if (t) {
      t.t += h;
      if (t.t >= FRP.turnS) {
        b.pos[0] = t.pos1[0]; b.pos[1] = t.pos1[1]; b.pos[2] = t.pos1[2];
        b.up = t.to;
        b.yaw = t.yaw1;
        b.pitch = t.pitch1;
        b.turn = null;
        b.cool = FRP.turnCool;
        b.ground = 'floor';
        b.vel[0] = b.vel[1] = b.vel[2] = 0;
        if (wrapPos(b)) emit({ k: 'wrap', d: [WRAP_D[0], WRAP_D[1], WRAP_D[2]] });
        emit({ k: 'turned', up: b.up });
      }
      continue;
    }
    if (b.cool > 0) b.cool = Math.max(0, b.cool - h);
    if (b.stun > 0) b.stun = Math.max(0, b.stun - h);
    if (b.shake > 0) b.shake = Math.max(0, b.shake - FRP.shakeFade * h);
    wishOf(b, inp);
    if (b.ride) rideStep(env, b, inp, h);
    else moveStep(env, b, h);
    if (wrapPos(b)) emit({ k: 'wrap', d: [WRAP_D[0], WRAP_D[1], WRAP_D[2]] });
    if (b.ground === 'air' && b.airT > FRP.airMaxS) {
      b.airT = 0;
      emit(EV_RESCUE);
      break;
    }
  }
  // выход: тело в триггере ниши в выходной копии — событие на входе
  if (!b.turn) {
    const inside = isExitCell(b.cell) && inTrigger(env.cell, b);
    if (inside && !b.inExit) emit(EV_EXIT);
    b.inExit = inside;
  }
  return flush();
}

/** Тело пересекает триггер выхода (с оборачиванием). */
function inTrigger(cell: FractalCell, b: FrBody): boolean {
  const tr = cell.exit?.trigger;
  if (!tr) return false;
  setBox(b.pos, b.up);
  const P = cell.P;
  for (let k = 0; k < 3; k++) {
    const c = (LO[k] + HI[k]) / 2, tc = (tr.lo[k] + tr.hi[k]) / 2;
    const off = P * Math.round((tc - c) / P);
    if (!(LO[k] + off < tr.hi[k] && HI[k] + off > tr.lo[k])) return false;
  }
  return true;
}

// ───────────────────────── позы для сцены ─────────────────────────

/** Камера в координатах ячейки: глаз и базис (во время поворота — интерполяция; тряску накладывает SCENE). */
export function camPose(b: FrBody): { eye: V3; right: V3; up: V3; fwd: V3; q: Quat } {
  const t = b.turn;
  if (t) {
    const u = smooth(t.t / FRP.turnS);
    const q = slerp(t.q0, t.q1, u);
    return {
      eye: [t.eye0[0] + (t.eye1[0] - t.eye0[0]) * u, t.eye0[1] + (t.eye1[1] - t.eye0[1]) * u, t.eye0[2] + (t.eye1[2] - t.eye0[2]) * u],
      right: qrot(q, [1, 0, 0]), up: qrot(q, [0, 1, 0]), fwd: qrot(q, [0, 0, 1]), q,
    };
  }
  const U = AXIS_VEC[b.up];
  const c = camBasis(b.up, b.yaw, b.pitch);
  return {
    eye: [b.pos[0] + U[0] * FRP.eye, b.pos[1] + U[1] * FRP.eye, b.pos[2] + U[2] * FRP.eye],
    right: c.right, up: c.up, fwd: c.fwd, q: quatFromBasis(c.right, c.up, c.fwd),
  };
}

/** Поза тела для аватара/копий: ступни, up, направление взгляда в плоскости пола, скорость по плоскости; q — кадр
 *  тела с yaw (X → right, Y → up, Z → fwd). Во время поворота — интерполяция кадра. */
export function bodyPose(b: FrBody): { feet: V3; up: V3; fwd: V3; speed: number; q: Quat } {
  const f: V3 = [0, 0, 0], r: V3 = [0, 0, 0];
  planeDirs(b.up, b.yaw, f, r);
  const U = AXIS_VEC[b.up];
  const q0 = quatFromBasis(r, [U[0], U[1], U[2]], f);
  const ua = axisIdx(b.up);
  let sp2 = 0;
  for (let k = 0; k < 3; k++) if (k !== ua) sp2 += b.vel[k] * b.vel[k];
  const t = b.turn;
  if (!t) return { feet: [b.pos[0], b.pos[1], b.pos[2]], up: [U[0], U[1], U[2]], fwd: f, speed: Math.sqrt(sp2), q: q0 };
  const f1: V3 = [0, 0, 0], r1: V3 = [0, 0, 0];
  planeDirs(t.to, t.yaw1, f1, r1);
  const U1 = AXIS_VEC[t.to];
  const u = smooth(t.t / FRP.turnS);
  const q = slerp(q0, quatFromBasis(r1, [U1[0], U1[1], U1[2]], f1), u);
  const up = qrot(q, [0, 1, 0]);
  const eye: V3 = [t.eye0[0] + (t.eye1[0] - t.eye0[0]) * u, t.eye0[1] + (t.eye1[1] - t.eye0[1]) * u, t.eye0[2] + (t.eye1[2] - t.eye0[2]) * u];
  return {
    feet: [eye[0] - up[0] * FRP.eye, eye[1] - up[1] * FRP.eye, eye[2] - up[2] * FRP.eye],
    up, fwd: qrot(q, [0, 0, 1]), speed: 0, q,
  };
}

/** Для HUD: доля упора 0…1. */
export const pushShare = (b: FrBody): number => clamp(b.push / FRP.pushHold, 0, 1);
