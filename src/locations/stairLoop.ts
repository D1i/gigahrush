// Петля «бесконечной лестницы» без движка: геометрия модуля подъезда в плане, коллизии игрока (круг
// против прямоугольников плана), сворачивание высоты в окно из 5 модулей, состояния ламп и дверей по
// «развёрнутому» этажу, маршрут спуска/подъёма для автопилота QA.
//
// Координаты — Babylon (Y вверх, левосторонняя система). GLB пользователя в glTF правосторонний, и
// загрузчик Babylon зеркалит X (x_babylon = −x_glTF), Z не меняется. Поэтому здесь марш «вверх от
// площадки» (Flight_A) — при X > 0, «вниз» (Flight_B модуля ниже) — при X < 0. Дверь — передняя
// стена, Z ≈ +2.75; промежуточная площадка — у задней стены, Z < −1.65.
import { STAIR_FLOOR_M } from './stairwell';

/** Высота модуля (этажа), м. */
export const FLOOR_M = STAIR_FLOOR_M;
/** Модулей в окне петли и индекс среднего (в нём всегда глаза игрока). */
export const SLOTS = 5;
export const MID = 2;

/** Внутренний план: X ±1.45, Z ±2.75; стены 0.2 м. */
export const IN_X = 1.45;
export const IN_Z = 2.75;
export const WALL_T = 0.2;
/** Площадка этажа: Z от 1.15 до передней стены; промежуточная: Z от задней стены до −1.65 (на +1.5 м). */
export const LANDING_Z = 1.15;
export const HALF_Z = -1.65;
/** Ограждение пролёта между маршами (вместе с узким пролётом 0.3 м) — непроходимо. */
export const WELL_X = 0.17;
/** Дверной проём на площадке: X ±0.47, высота 2.075; полотно на петлях при X = +0.47 (ручка у −0.32). */
export const DOOR_X = 0.47;
export const DOOR_H = 2.075;
/** Тамбур за дверью: коридор шириной проёма до Z = VEST_Z1. */
export const VEST_Z0 = IN_Z + WALL_T;
export const VEST_Z1 = 4.25;
/** Переход за дверь засчитывается, когда игрок зашёл в тамбур глубже этой Z. */
export const EXIT_Z = 3.3;
/** Радиус игрока в плане, м; глаза над ногами, м. */
export const BODY_R = 0.25;
export const EYE_M = 1.6;

/** Прямоугольник плана (x, z), м. */
export interface Box2 {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

const B = (x0: number, z0: number, x1: number, z1: number): Box2 => ({ x0, z0, x1, z1 });

/** Стены и ограждение — одинаковы на всех этажах. */
export const STATIC_BOXES: readonly Box2[] = [
  B(-IN_X - 0.3, -IN_Z - 0.5, -IN_X, IN_Z + 0.5), // левая
  B(IN_X, -IN_Z - 0.5, IN_X + 0.3, IN_Z + 0.5), // правая
  B(-IN_X - 0.3, -IN_Z - 0.3, IN_X + 0.3, -IN_Z), // задняя
  B(-IN_X - 0.3, IN_Z, -DOOR_X, IN_Z + WALL_T), // передняя слева от проёма
  B(DOOR_X, IN_Z, IN_X + 0.3, IN_Z + WALL_T), // передняя справа от проёма
  B(-WELL_X, HALF_Z, WELL_X, LANDING_Z), // пролёт с ограждением
  // тамбур за проёмом: стенки и торец
  B(-DOOR_X - 0.3, VEST_Z0, -DOOR_X, VEST_Z1 + 0.3),
  B(DOOR_X, VEST_Z0, DOOR_X + 0.3, VEST_Z1 + 0.3),
  B(-DOOR_X - 0.3, VEST_Z1, DOOR_X + 0.3, VEST_Z1 + 0.3),
];
/** Закрытая дверь — полотно в проёме. */
export const DOOR_BOX: Box2 = B(-DOOR_X, IN_Z - 0.12, DOOR_X, IN_Z + WALL_T);
/** Низ разомкнутой лестницы: под маршем и промежуточной площадкой на нижнем этаже — тесно, не пускаем. */
export const BOTTOM_BOX: Box2 = B(-IN_X, -IN_Z, -0.12, -0.6);
/** Верхняя площадка (TopCap): ограждение неиспользуемого марша вверх (X > 0, до края площадки). */
export const CAP_BOX: Box2 = B(0.12, -IN_Z, IN_X + 0.3, LANDING_Z + 0.03);

/**
 * Круг (x, z, r) против прямоугольников: вытолкнуть наружу (несколько проходов — углы и стыки).
 * Возвращает новую точку; вход не меняется.
 */
export function collide2(x: number, z: number, r: number, boxes: readonly Box2[]): [number, number] {
  for (let it = 0; it < 4; it++) {
    let moved = false;
    for (const b of boxes) {
      const cx = Math.max(b.x0, Math.min(x, b.x1));
      const cz = Math.max(b.z0, Math.min(z, b.z1));
      const dx = x - cx, dz = z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-12) {
        const d = Math.sqrt(d2);
        x = cx + (dx / d) * r;
        z = cz + (dz / d) * r;
      } else {
        // центр внутри прямоугольника — к ближайшей стороне
        const l = x - b.x0, rr = b.x1 - x, n = z - b.z0, f = b.z1 - z;
        const m = Math.min(l, rr, n, f);
        if (m === l) x = b.x0 - r;
        else if (m === rr) x = b.x1 + r;
        else if (m === n) z = b.z0 - r;
        else z = b.z1 + r;
      }
      moved = true;
    }
    if (!moved) break;
  }
  return [x, z];
}

/** Номер этажа (развёрнутого) площадки, у которой стоит игрок: ближайший к ногам. */
export function landingFloor(feetY: number): number {
  return Math.round(feetY / FLOOR_M) || 0;
}

/** Этаж петли для HUD: модуль, в котором ноги (площадка этажа и марши над ней до следующего). */
export function moduleFloor(feetY: number): number {
  return Math.floor(feetY / FLOOR_M + 1e-6) || 0;
}

// ───────────────────────── окно петли ─────────────────────────

/**
 * Окно петли: SLOTS модулей по Y = FLOOR_M·(i − MID), i = 0…SLOTS−1. Глаза игрока держатся в среднем
 * модуле: выйдя за [0, FLOOR_M), игрок (и всё, что к нему привязано) сдвигается на ∓FLOOR_M, а base —
 * развёрнутый этаж среднего модуля — меняется на ±1. Модули одинаковы, поэтому сдвиг невидим; всё
 * переменное (лампы, двери, низ разомкнутой лестницы) берётся по развёрнутому этажу модуля.
 */
export interface LoopWindow {
  /** развёрнутый этаж среднего модуля */
  base: number;
}

/** На сколько модулей сдвинуть окно, чтобы глаза (локальная высота) оказались в [0, FLOOR_M). */
export function wrapShift(eyeLocal: number): number {
  return Math.floor(eyeLocal / FLOOR_M);
}

/** Развёрнутая высота по локальной (в окне) и base. */
export function unwrapY(localY: number, base: number): number {
  return localY + base * FLOOR_M;
}

/** Развёрнутый этаж модуля i окна. */
export function slotFloor(base: number, i: number): number {
  return base + (i - MID) || 0;
}

/** Высота модуля i окна (локальная). */
export function slotY(i: number): number {
  return (i - MID) * FLOOR_M;
}

// ───────────────────────── лампы ─────────────────────────

/** Хэш целых в [0, 1). */
export function hash01(...n: number[]): number {
  let h = 2166136261 >>> 0;
  for (const v of n) {
    h ^= v | 0;
    h = Math.imul(h, 16777619);
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995);
    h ^= h >>> 15;
  }
  return (h >>> 0) / 4294967296;
}

/** Состояние лампы: не горит / горит тускло / мигает. */
export type LampKind = 'dead' | 'dim' | 'flicker';

/** Лампа j (0 — у двери на площадке этажа, 1 — у промежуточной площадки) развёрнутого этажа floor.
 *  darkness 0…1: доля мёртвых ламп растёт с темнотой. */
export function lampKind(seed: number, floor: number, j: number, darkness: number): LampKind {
  const r = hash01(seed, floor, j);
  const alive = Math.max(0, Math.min(1, 1 - darkness)) * 2;
  if (r >= alive) return 'dead';
  return hash01(seed, floor, j, 7) < 0.45 ? 'flicker' : 'dim';
}

/** Яркость лампы 0…1 в момент t (с): тусклая — ровная с лёгким гулом, мигающая — срывы и вспышки. */
export function lampLevel(kind: LampKind, seed: number, floor: number, j: number, t: number): number {
  if (kind === 'dead') return 0;
  if (kind === 'dim') return 0.55 + 0.04 * Math.sin(t * 37 + floor * 3.1 + j);
  // мигающая: кусочно-постоянный шум с шагом 0.06–0.11 с, долгие затухания и короткие вспышки
  const step = 0.06 + 0.05 * hash01(seed, floor, j, 3);
  const k = Math.floor(t / step);
  const a = hash01(seed, floor, j, k);
  const slow = 0.5 + 0.5 * Math.sin(t * 0.7 + floor * 1.7 + j * 2.3);
  if (a < 0.35 * (1 - slow * 0.6)) return 0;
  return a > 0.9 ? 1 : 0.35 + 0.4 * a;
}

// ───────────────────────── маршрут ─────────────────────────

/** Точки маршрута в плане (x, z) на один этаж вниз: с площадки — марш при X < 0 до промежуточной,
 *  поворот, марш при X > 0 до площадки этажа ниже. Вверх — в обратном порядке. */
export const DOWN_PATH: readonly [number, number][] = [
  [-0.78, 1.55],
  [-0.78, -2.1],
  [0.78, -2.1],
  [0.78, 1.55],
];
export const UP_PATH: readonly [number, number][] = [
  [0.78, 1.55],
  [0.78, -2.1],
  [-0.78, -2.1],
  [-0.78, 1.55],
];

// ───────────────────────── опора под ногами ─────────────────────────

/**
 * Карта высот опоры модуля: верхние (смотрящие вверх) треугольники ступеней и площадок из меша модуля,
 * растеризованные по клеткам плана (по центрам клеток, барицентрически). В клетке — до K разных высот
 * в координатах модуля (0 — пол площадки, до FLOOR_M — верх марша). Модули повторяются по Y с шагом
 * FLOOR_M — высоты всех этажей получаются сдвигом. Строится один раз при загрузке GLB; поиск — O(1),
 * без лучей по сцене (и переносится в любой движок как есть).
 */
export class GroundField {
  readonly nx: number;
  readonly nz: number;
  private readonly h: Float32Array;

  constructor(
    readonly x0 = -IN_X,
    readonly z0 = -IN_Z,
    readonly x1 = IN_X,
    readonly z1 = IN_Z,
    readonly cell = 0.025,
    readonly K = 4,
  ) {
    this.nx = Math.ceil((x1 - x0) / cell);
    this.nz = Math.ceil((z1 - z0) / cell);
    this.h = new Float32Array(this.nx * this.nz * K).fill(NaN);
  }

  /** Треугольник поверхности (x, y, z — координаты модуля); вертикальные и нижние грани не передавать. */
  addTriangle(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number) {
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(d) < 1e-12) return;
    const c = this.cell;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - this.x0) / c));
    const i1 = Math.min(this.nx - 1, Math.floor((Math.max(ax, bx, cx) - this.x0) / c));
    const j0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - this.z0) / c));
    const j1 = Math.min(this.nz - 1, Math.floor((Math.max(az, bz, cz) - this.z0) / c));
    const e = -1e-6;
    for (let i = i0; i <= i1; i++) {
      const px = this.x0 + (i + 0.5) * c;
      for (let j = j0; j <= j1; j++) {
        const pz = this.z0 + (j + 0.5) * c;
        const l1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / d;
        const l2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / d;
        const l3 = 1 - l1 - l2;
        if (l1 < e || l2 < e || l3 < e) continue;
        this.put(i, j, l1 * ay + l2 * by + l3 * cy);
      }
    }
  }

  private put(i: number, j: number, y: number) {
    const o = (j * this.nx + i) * this.K;
    const h = this.h;
    let low = -1;
    for (let k = 0; k < this.K; k++) {
      const v = h[o + k];
      if (Number.isNaN(v)) {
        h[o + k] = y;
        return;
      }
      if (Math.abs(v - y) < 0.02) {
        if (y > v) h[o + k] = y;
        return;
      }
      if (low < 0 || v < h[o + low]) low = k;
    }
    if (y > h[o + low]) h[o + low] = y; // клетка полна — оставить верхние
  }

  /** Высоты опоры в точке плана (координаты модуля); вне карты — пусто. */
  heights(x: number, z: number): number[] {
    const i = Math.floor((x - this.x0) / this.cell);
    const j = Math.floor((z - this.z0) / this.cell);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return [];
    const o = (j * this.nx + i) * this.K;
    const out: number[] = [];
    for (let k = 0; k < this.K; k++) {
      const v = this.h[o + k];
      if (!Number.isNaN(v)) out.push(v);
    }
    return out;
  }

  /** Заполненных клеток (для QA). */
  get filled(): number {
    let n = 0;
    for (let o = 0; o < this.h.length; o += this.K) if (!Number.isNaN(this.h[o])) n++;
    return n;
  }
}

/** Опора в развёрнутой лестнице: самая высокая поверхность не выше top среди этажей, где модуль есть
 *  (visible(k) — модуль этажа k на месте), плюс пол тамбура каждого этажа и плита низа (bottom). */
export function groundY(field: GroundField, x: number, z: number, top: number, visible: (k: number) => boolean, bottom: number | null): number | null {
  let best = -Infinity;
  const kHi = Math.floor(top / FLOOR_M);
  const hs = field.heights(x, z);
  const vest = Math.abs(x) < DOOR_X && z >= IN_Z - 0.01 && z <= VEST_Z1;
  for (let k = kHi; k >= kHi - 2; k--) {
    if (!visible(k)) continue;
    for (const h of hs) {
      const y = k * FLOOR_M + h;
      if (y <= top && y > best) best = y;
    }
    if (vest) {
      const y = k * FLOOR_M;
      if (y <= top && y > best) best = y;
    }
  }
  // плита низа разомкнутой лестницы: там, где был марш вниз
  if (bottom !== null && z <= LANDING_Z + 0.01 && Math.abs(x) <= IN_X) {
    const y = bottom * FLOOR_M;
    if (y <= top && y > best) best = y;
  }
  return best === -Infinity ? null : best;
}
