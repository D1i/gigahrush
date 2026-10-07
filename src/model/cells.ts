// Геометрия множеств клеток. Всё в клеточных координатах, ось Y вниз.
// Контракт зафиксирован оркестратором; реализации помеченные TODO(core) дописывает агент ядра.
import type { CellKey, Rot, Side } from './types';

export const cellKey = (x: number, y: number): CellKey => `${x},${y}`;

export function parseKey(k: CellKey): [number, number] {
  const i = k.indexOf(',');
  return [+k.slice(0, i), +k.slice(i + 1)];
}

export interface BBox {
  x0: number;
  y0: number;
  /** исключительно */
  x1: number;
  /** исключительно */
  y1: number;
  w: number;
  h: number;
}

/** Прямоугольник w×h клеток с левым верхним углом (x0, y0). */
export function rectCells(x0: number, y0: number, w: number, h: number): Set<CellKey> {
  const s = new Set<CellKey>();
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) s.add(cellKey(x, y));
  return s;
}

export function bbox(cells: Iterable<CellKey>): BBox | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const k of cells) {
    const [x, y] = parseKey(k);
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x + 1 > x1) x1 = x + 1;
    if (y + 1 > y1) y1 = y + 1;
  }
  if (x0 === Infinity) return null;
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

export function areaM2(cells: Set<CellKey>, cellM: number): number {
  return Math.round(cells.size * cellM * cellM * 100) / 100;
}

export const SIDE_DELTA: Record<Side, [number, number]> = {
  N: [0, -1],
  S: [0, 1],
  E: [1, 0],
  W: [-1, 0],
};

export const OPPOSITE: Record<Side, Side> = { N: 'S', S: 'N', E: 'W', W: 'E' };

/** Поворот стороны на rot по часовой: N→E→S→W. */
export function rotateSide(side: Side, rot: number): Side {
  const order: Side[] = ['N', 'E', 'S', 'W'];
  const steps = ((Math.round(rot / 90) % 4) + 4) % 4;
  return order[(order.indexOf(side) + steps) % 4];
}

/** Поворот точки (клеточные координаты) вокруг начала координат на rot (кратно 90) по часовой.
 *  90°: (x, y) → (−y, x). */
export function rotatePoint(x: number, y: number, rot: number): [number, number] {
  const steps = ((Math.round(rot / 90) % 4) + 4) % 4;
  switch (steps) {
    case 1: return [-y, x];
    case 2: return [-x, -y];
    case 3: return [y, -x];
    default: return [x, y];
  }
}

/** Поворот клетки: клетка — квадрат, поэтому 90°: (x, y) → (−y−1, x). */
export function rotateCell(x: number, y: number, rot: number): [number, number] {
  const steps = ((Math.round(rot / 90) % 4) + 4) % 4;
  switch (steps) {
    case 1: return [-y - 1, x];
    case 2: return [-x - 1, -y - 1];
    case 3: return [y, -x - 1];
    default: return [x, y];
  }
}

export function normRot(rot: number): Rot {
  return ((((Math.round(rot / 90) % 4) + 4) % 4) * 90) as Rot;
}

// ───────────── Формы и операции над множествами ─────────────

/** Клетки эллипса, вписанного в прямоугольник [x0,x1)×[y0,y1) (центр клетки внутри эллипса).
 *  Порядок углов произвольный — функция нормализует. */
export function ellipseCells(x0: number, y0: number, x1: number, y1: number): Set<CellKey> {
  const lx = Math.min(x0, x1), hx = Math.max(x0, x1);
  const ly = Math.min(y0, y1), hy = Math.max(y0, y1);
  const s = new Set<CellKey>();
  const rx = (hx - lx) / 2, ry = (hy - ly) / 2;
  if (rx <= 0 || ry <= 0) return s;
  const cx = (lx + hx) / 2, cy = (ly + hy) / 2;
  for (let y = Math.floor(ly); y < Math.ceil(hy); y++) {
    const dy = (y + 0.5 - cy) / ry;
    if (dy * dy > 1) continue;
    for (let x = Math.floor(lx); x < Math.ceil(hx); x++) {
      const dx = (x + 0.5 - cx) / rx;
      if (dx * dx + dy * dy <= 1 + 1e-9) s.add(cellKey(x, y));
    }
  }
  return s;
}

/** Диск кисти: клетки, центр которых на расстоянии ≤ r (в клетках) от точки (px, py). */
export function brushCells(px: number, py: number, r: number): Set<CellKey> {
  const s = new Set<CellKey>();
  if (!(r >= 0)) return s;
  const r2 = r * r + 1e-9;
  for (let y = Math.floor(py - r - 0.5); y <= Math.ceil(py + r); y++) {
    const dy = y + 0.5 - py;
    if (dy * dy > r2) continue;
    for (let x = Math.floor(px - r - 0.5); x <= Math.ceil(px + r); x++) {
      const dx = x + 0.5 - px;
      if (dx * dx + dy * dy <= r2) s.add(cellKey(x, y));
    }
  }
  return s;
}

/** Добавить/вычесть фигуру из множества на месте. */
export function applyShape(target: Set<CellKey>, shape: Set<CellKey>, mode: 'add' | 'sub'): void {
  if (mode === 'add') for (const k of shape) target.add(k);
  else for (const k of shape) target.delete(k);
}

/** true, если множество — сплошной прямоугольник (и не пустое). */
export function isRectangle(cells: Set<CellKey>): boolean {
  const b = bbox(cells);
  // клетки уникальны и все внутри bbox ⇒ достаточно сравнить количество
  return !!b && b.w * b.h === cells.size;
}

/** Сдвиг границ одной оси: расширение копирует профиль крайнего столбца/ряда, сжатие отсекает. */
function resizeAxis(src: [number, number][], axis: 0 | 1, lo: number, hi: number): [number, number][] {
  if (!src.length) return [];
  const o = axis === 0 ? 1 : 0; // вторая ось
  let min = Infinity, max = -Infinity;
  for (const c of src) {
    if (c[axis] < min) min = c[axis];
    if (c[axis] > max) max = c[axis];
  }
  const out: [number, number][] = [];
  const push = (a: number, b: number) => out.push(axis === 0 ? [a, b] : [b, a]);
  for (const c of src) {
    if (c[axis] >= lo && c[axis] < hi) out.push(c);
    // профиль крайнего столбца (ряда) тянется наружу
    if (c[axis] === max) for (let a = Math.max(max + 1, lo); a < hi; a++) push(a, c[o]);
    if (c[axis] === min) for (let a = Math.min(min - 1, hi - 1); a >= lo; a--) push(a, c[o]);
  }
  return out;
}

/**
 * Изменение габарита (ТЗ §5 «Размер»): from — текущий bbox, to — новый.
 * Прямоугольная форма → просто прямоугольник to.
 * Сложная форма: при расширении продолжается крайний ряд/столбец клеток (копируется профиль
 * крайнего ряда наружу), при сжатии лишнее отсекается. Сначала по X, потом по Y.
 * Возвращает новое множество.
 */
export function resizeCells(cells: Set<CellKey>, to: { x0: number; y0: number; x1: number; y1: number }): Set<CellKey> {
  const x0 = Math.min(to.x0, to.x1), x1 = Math.max(to.x0, to.x1);
  const y0 = Math.min(to.y0, to.y1), y1 = Math.max(to.y0, to.y1);
  if (x1 === x0 || y1 === y0) return new Set();
  if (cells.size === 0 || isRectangle(cells)) return rectCells(x0, y0, x1 - x0, y1 - y0);
  let pts: [number, number][] = [];
  for (const k of cells) pts.push(parseKey(k));
  pts = resizeAxis(pts, 0, x0, x1);
  pts = resizeAxis(pts, 1, y0, y1);
  const out = new Set<CellKey>();
  for (const [x, y] of pts) out.add(cellKey(x, y));
  // вырожденный случай: новый габарит попал в «дыру» формы
  return out.size ? out : rectCells(x0, y0, x1 - x0, y1 - y0);
}

/** Повернуть множество клеток (rotateCell) и сдвинуть на (dx, dy). */
export function transformCells(cells: Iterable<CellKey>, rot: number, dx: number, dy: number): Set<CellKey> {
  const out = new Set<CellKey>();
  for (const k of cells) {
    const [x, y] = parseKey(k);
    const [rx, ry] = rotateCell(x, y, rot);
    out.add(cellKey(rx + dx, ry + dy));
  }
  return out;
}

// ───────────── Сжатый формат ─────────────

/** Сжатие: одна строка на ряд "y:x1-x2,x3" (ряды по возрастанию y, отрезки по возрастанию x). */
export function encodeCells(cells: Set<CellKey>): string[] {
  const rows = new Map<number, number[]>();
  for (const k of cells) {
    const [x, y] = parseKey(k);
    const r = rows.get(y);
    if (r) r.push(x);
    else rows.set(y, [x]);
  }
  const ys = [...rows.keys()].sort((a, b) => a - b);
  const out: string[] = [];
  for (const y of ys) {
    const xs = rows.get(y)!.sort((a, b) => a - b);
    const parts: string[] = [];
    let s = xs[0], e = xs[0];
    for (let i = 1; i <= xs.length; i++) {
      const x = xs[i];
      if (i < xs.length && x === e + 1) {
        e = x;
        continue;
      }
      parts.push(s === e ? `${s}` : `${s}-${e}`);
      s = e = x;
    }
    out.push(`${y}:${parts.join(',')}`);
  }
  return out;
}

const RUN_RE = /^(-?\d+)(?:-(-?\d+))?$/;
const INT_RE = /^-?\d+$/;
/** Защита от мусора вида "0:0-999999999": длиннее ряд не бывает. */
const MAX_RUN = 100_000;

/** Разбор строк "y:x1-x2,x3". Некорректные фрагменты пропускаются. */
export function decodeCells(rows: string[]): Set<CellKey> {
  const s = new Set<CellKey>();
  if (!Array.isArray(rows)) return s;
  for (const row of rows) {
    if (typeof row !== 'string') continue;
    const c = row.indexOf(':');
    if (c < 0) continue;
    const ys = row.slice(0, c).trim();
    if (!INT_RE.test(ys)) continue;
    const y = +ys;
    for (const frag of row.slice(c + 1).split(',')) {
      const m = RUN_RE.exec(frag.trim());
      if (!m) continue;
      let a = +m[1];
      let b = m[2] !== undefined ? +m[2] : a;
      if (b < a) [a, b] = [b, a];
      if (b - a > MAX_RUN) continue;
      for (let x = a; x <= b; x++) s.add(cellKey(x, y));
    }
  }
  return s;
}

// ───────────── Граница ─────────────

/** Граничное ребро: клетка комнаты (cx, cy) и её сторона, за которой не комната. */
export interface Edge {
  cx: number;
  cy: number;
  side: Side;
}

const SIDES: Side[] = ['N', 'E', 'S', 'W'];

export function boundaryEdges(cells: Set<CellKey>): Edge[] {
  const out: Edge[] = [];
  for (const k of cells) {
    const [x, y] = parseKey(k);
    for (const side of SIDES) {
      const [dx, dy] = SIDE_DELTA[side];
      if (!cells.has(cellKey(x + dx, y + dy))) out.push({ cx: x, cy: y, side });
    }
  }
  return out;
}

/**
 * Прямая «стена»: максимальный непрерывный отрезок граничных рёбер одной стороны в одном ряду
 * (для N/S) или столбце (для E/W). Геометрия — как у Segment: (cx, cy) — первая клетка,
 * клетки идут вдоль +X (N/S) или +Y (E/W), len — длина в клетках.
 * Любой корректный отрезок границы целиком лежит внутри одной такой стены.
 */
export interface BoundaryRun {
  cx: number;
  cy: number;
  side: Side;
  len: number;
}

export function boundaryRuns(cells: Set<CellKey>): BoundaryRun[] {
  // группа: сторона + фиксированная координата → координаты вдоль стены
  const groups = new Map<string, { side: Side; fixed: number; along: number[] }>();
  for (const e of boundaryEdges(cells)) {
    const horiz = e.side === 'N' || e.side === 'S';
    const fixed = horiz ? e.cy : e.cx;
    const gk = `${e.side}${fixed}`;
    let g = groups.get(gk);
    if (!g) groups.set(gk, (g = { side: e.side, fixed, along: [] }));
    g.along.push(horiz ? e.cx : e.cy);
  }
  const out: BoundaryRun[] = [];
  for (const g of groups.values()) {
    const a = g.along.sort((p, q) => p - q);
    const horiz = g.side === 'N' || g.side === 'S';
    let s = a[0];
    for (let i = 1; i <= a.length; i++) {
      if (i < a.length && a[i] === a[i - 1] + 1) continue;
      const len = a[i - 1] - s + 1;
      out.push(horiz ? { cx: s, cy: g.fixed, side: g.side, len } : { cx: g.fixed, cy: s, side: g.side, len });
      s = a[i];
    }
  }
  return out;
}

/** Контур для отрисовки: список отрезков границы, слитых в длинные линии
 *  [x1,y1,x2,y2] в клеточных координатах (углы клеток). */
export function outlineLines(cells: Set<CellKey>): [number, number, number, number][] {
  return boundaryRuns(cells).map(({ cx, cy, side, len }): [number, number, number, number] => {
    switch (side) {
      case 'N': return [cx, cy, cx + len, cy];
      case 'S': return [cx, cy + 1, cx + len, cy + 1];
      case 'W': return [cx, cy, cx, cy + len];
      case 'E': return [cx + 1, cy, cx + 1, cy + len];
    }
  });
}

