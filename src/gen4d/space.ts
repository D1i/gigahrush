// Геометрия складчатого генератора: формы комнат в повороте и проверка «пересечения» двух тел.
// «Пересекаются» (конфликт) = есть клетка одного и клетка другого на расстоянии Чебышёва ≤ gap
// (max(|Δx|, |Δy|) ≤ gap): стена одной комнаты налезла бы на пол другой. Тот же критерий, что у
// коллизии евклидова генератора (§4.5 docs/GENERATOR.md); связанные метки стоят ровно через gap — не конфликт.
import { parseKey, rotateCell } from '../model/cells';
import type { CellKey, Connector, Room, Rot } from '../model/types';
import { transformSeg } from '../gen/geom';
import { scanSight } from '../gen/sight';

/** Раздутая форма: bits[(y − y0)·w + (x − x0)] = 1, если клетка (x, y) ближе gap к форме. */
export interface Infl {
  x0: number;
  y0: number;
  w: number;
  h: number;
  bits: Uint8Array;
}

/** Комната в одном повороте при dx = dy = 0. */
export interface FShape {
  xs: Int32Array;
  ys: Int32Array;
  /** граничные клетки (есть 4-сосед вне комнаты) — только их нужно «раздувать» на gap */
  bxs: Int32Array;
  bys: Int32Array;
  /** bbox, x1/y1 исключительно */
  x0: number; y0: number; x1: number; y1: number;
  /** битовая карта самих клеток (без раздутия) — «клетка принадлежит комнате» для лучей обзора */
  own: Infl;
  /** индексы клеток по возрастанию (y, x) — порядок полного скана обзора */
  ord: Int32Array;
  /** выпуклая оболочка клеток (углы клеток), пары x, y против часовой — источник взгляда для PVS */
  hull: Float64Array;
  /** раздутые карты по gap (общие для всех прогонов с этой геометрией) */
  infl: Map<number, Infl>;
  /** метки в повороте (порядок room.connectors) — свои на каждый прогон */
  conns: Connector[];
}

/** Тело в мире: форма + сдвиг. */
export interface Body {
  sh: FShape;
  dx: number;
  dy: number;
}

// ───────── Кэш геометрии между прогонами: по объекту room.cells, с поклеточной сверкой
// (редактор мутирует Set на месте) — как geoOf в src/gen/generate.ts ─────────

type ShapeGeo = Omit<FShape, 'conns'>;

interface Geo {
  keys: CellKey[];
  lx: Int32Array;
  ly: Int32Array;
  boundary: Uint8Array;
  rots: (ShapeGeo | undefined)[];
  /** внутренняя дальность обзора по cellM, м */
  sight: Map<number, number>;
}

const geoCache = new WeakMap<Set<CellKey>, Geo>();

function geoOf(cells: Set<CellKey>): Geo {
  const cached = geoCache.get(cells);
  if (cached && cached.keys.length === cells.size) {
    let i = 0;
    let same = true;
    for (const k of cells) if (k !== cached.keys[i++]) { same = false; break; }
    if (same) return cached;
  }
  const n = cells.size;
  const keys: CellKey[] = [];
  const lx = new Int32Array(n), ly = new Int32Array(n);
  let i = 0;
  for (const k of cells) {
    keys.push(k);
    const [x, y] = parseKey(k);
    lx[i] = x; ly[i] = y; i++;
  }
  const boundary = new Uint8Array(n);
  for (let j = 0; j < n; j++) {
    const x = lx[j], y = ly[j];
    if (!cells.has(`${x + 1},${y}`) || !cells.has(`${x - 1},${y}`) || !cells.has(`${x},${y + 1}`) || !cells.has(`${x},${y - 1}`)) boundary[j] = 1;
  }
  const geo: Geo = { keys, lx, ly, boundary, rots: [], sight: new Map() };
  geoCache.set(cells, geo);
  return geo;
}

function shapeGeo(geo: Geo, rot: Rot): ShapeGeo {
  const r = rot / 90;
  const cached = geo.rots[r];
  if (cached) return cached;
  const n = geo.lx.length;
  const xs = new Int32Array(n), ys = new Int32Array(n);
  const bx: number[] = [], by: number[] = [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let j = 0; j < n; j++) {
    const [x, y] = rotateCell(geo.lx[j], geo.ly[j], rot);
    xs[j] = x; ys[j] = y;
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x + 1 > x1) x1 = x + 1;
    if (y + 1 > y1) y1 = y + 1;
    if (geo.boundary[j]) { bx.push(x); by.push(y); }
  }
  if (x0 === Infinity) x0 = y0 = x1 = y1 = 0;
  const w = x1 - x0, h = y1 - y0;
  const bits = new Uint8Array(Math.max(0, w * h));
  for (let j = 0; j < n; j++) bits[(ys[j] - y0) * w + (xs[j] - x0)] = 1;
  const ord = Int32Array.from({ length: n }, (_, j) => j).sort((a, b) => ys[a] - ys[b] || xs[a] - xs[b]);
  const sg: ShapeGeo = {
    xs, ys, bxs: Int32Array.from(bx), bys: Int32Array.from(by), x0, y0, x1, y1,
    own: { x0, y0, w, h, bits }, ord, hull: hullOf(xs, ys, y0, h), infl: new Map(),
  };
  geo.rots[r] = sg;
  return sg;
}

/** Выпуклая оболочка множества клеток (по крайним клеткам каждого ряда), монотонная цепь Эндрю. */
function hullOf(xs: Int32Array, ys: Int32Array, y0: number, h: number): Float64Array {
  if (xs.length === 0) return new Float64Array(0);
  const lo = new Float64Array(h).fill(Infinity), hi = new Float64Array(h).fill(-Infinity);
  for (let i = 0; i < xs.length; i++) {
    const r = ys[i] - y0;
    if (xs[i] < lo[r]) lo[r] = xs[i];
    if (xs[i] + 1 > hi[r]) hi[r] = xs[i] + 1;
  }
  const pts: [number, number][] = [];
  for (let r = 0; r < h; r++) {
    if (lo[r] === Infinity) continue;
    const y = y0 + r;
    pts.push([lo[r], y], [lo[r], y + 1], [hi[r], y], [hi[r], y + 1]);
  }
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [], upper: [number, number][] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  const out = new Float64Array(hull.length * 2);
  hull.forEach(([x, y], i) => { out[2 * i] = x; out[2 * i + 1] = y; });
  return out;
}

/** Собственная (внутренняя) дальность обзора комнаты, м — как у евклидова генератора (§7.3 GENERATOR.md):
 *  самая длинная линия по её клеткам без проёмов. Не зависит от поворота; кэшируется. */
export function roomSightM(room: Room, cellM: number): number {
  const geo = geoOf(room.cells);
  let m = geo.sight.get(cellM);
  if (m === undefined) {
    m = scanSight({ xs: geo.lx, ys: geo.ly, owners: new Int32Array(geo.lx.length) }, new Set<string>(), cellM).maxM;
    geo.sight.set(cellM, m);
  }
  return m;
}

/** Формы комнат на один прогон (метки могли поменяться — их поворот считается заново). */
export class Shapes {
  private readonly cache = new Map<Room, (FShape | undefined)[]>();
  constructor(readonly gap: number) {}

  get(room: Room, rot: Rot): FShape {
    let arr = this.cache.get(room);
    if (!arr) this.cache.set(room, (arr = []));
    const r = rot / 90;
    let sh = arr[r];
    if (!sh) arr[r] = sh = { ...shapeGeo(geoOf(room.cells), rot), conns: room.connectors.map((c) => transformSeg(c, rot, 0, 0)) };
    return sh;
  }

  /** Клетки формы, раздутые на gap по Чебышёву (битовая карта по bbox, расширенному на gap). */
  infl(sh: FShape): Infl {
    const g = this.gap;
    const hit = sh.infl.get(g);
    if (hit) return hit;
    const x0 = sh.x0 - g, y0 = sh.y0 - g;
    const w = sh.x1 - sh.x0 + 2 * g, h = sh.y1 - sh.y0 + 2 * g;
    const bits = new Uint8Array(Math.max(0, w * h));
    for (let i = 0; i < sh.xs.length; i++) bits[(sh.ys[i] - y0) * w + (sh.xs[i] - x0)] = 1;
    // достаточно раздуть граничные клетки: клетка вне комнаты в пределах gap от комнаты
    // лежит в пределах gap и от какой-то граничной клетки (как в индексе занятости евклидова генератора)
    if (g > 0) {
      for (let i = 0; i < sh.bxs.length; i++) {
        const bx = sh.bxs[i] - x0, by = sh.bys[i] - y0;
        for (let oy = -g; oy <= g; oy++) for (let ox = -g; ox <= g; ox++) bits[(by + oy) * w + (bx + ox)] = 1;
      }
    }
    const m: Infl = { x0, y0, w, h, bits };
    sh.infl.set(g, m);
    return m;
  }

  /** Конфликт двух тел: bbox (расширенные на gap), затем поклеточно — клетки меньшего тела в зоне
   *  большего против раздутой карты большего. */
  conflict(a: Body, b: Body): boolean {
    const g = this.gap;
    const ax0 = a.sh.x0 + a.dx, ay0 = a.sh.y0 + a.dy, ax1 = a.sh.x1 + a.dx, ay1 = a.sh.y1 + a.dy;
    const bx0 = b.sh.x0 + b.dx, by0 = b.sh.y0 + b.dy, bx1 = b.sh.x1 + b.dx, by1 = b.sh.y1 + b.dy;
    if (ax1 + g <= bx0 || bx1 + g <= ax0 || ay1 + g <= by0 || by1 + g <= ay0) return false;
    const small = a.sh.xs.length <= b.sh.xs.length;
    const s = small ? a : b, t = small ? b : a;
    const m = this.infl(t.sh);
    // сдвиг клеток s в локальные координаты карты t
    const ox = s.dx - t.dx - m.x0, oy = s.dy - t.dy - m.y0;
    const w = m.w, h = m.h, bits = m.bits;
    const xs = s.sh.xs, ys = s.sh.ys;
    for (let i = 0; i < xs.length; i++) {
      const x = xs[i] + ox, y = ys[i] + oy;
      if (x < 0 || x >= w || y < 0 || y >= h) continue;
      if (bits[y * w + x] !== 0) return true;
    }
    return false;
  }
}
