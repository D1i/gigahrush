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

// ───────────── TODO(core): реализации ниже пишет агент ядра ─────────────

/** Клетки эллипса, вписанного в прямоугольник [x0,x1)×[y0,y1) (центр клетки внутри эллипса).
 *  Порядок углов произвольный — функция нормализует. */
export function ellipseCells(x0: number, y0: number, x1: number, y1: number): Set<CellKey> {
  throw new Error('TODO(core) ellipseCells');
}

/** Диск кисти: клетки, центр которых на расстоянии ≤ r (в клетках) от точки (px, py). */
export function brushCells(px: number, py: number, r: number): Set<CellKey> {
  throw new Error('TODO(core) brushCells');
}

/** Добавить/вычесть фигуру из множества на месте. */
export function applyShape(target: Set<CellKey>, shape: Set<CellKey>, mode: 'add' | 'sub'): void {
  throw new Error('TODO(core) applyShape');
}

/** true, если множество — сплошной прямоугольник (и не пустое). */
export function isRectangle(cells: Set<CellKey>): boolean {
  throw new Error('TODO(core) isRectangle');
}

/**
 * Изменение габарита (ТЗ §5 «Размер»): from — текущий bbox, to — новый.
 * Прямоугольная форма → просто прямоугольник to.
 * Сложная форма: при расширении продолжается крайний ряд/столбец клеток (копируется профиль
 * крайнего ряда наружу), при сжатии лишнее отсекается. Сначала по X, потом по Y.
 * Возвращает новое множество.
 */
export function resizeCells(cells: Set<CellKey>, to: { x0: number; y0: number; x1: number; y1: number }): Set<CellKey> {
  throw new Error('TODO(core) resizeCells');
}

/** Повернуть множество клеток (rotateCell) и сдвинуть на (dx, dy). */
export function transformCells(cells: Iterable<CellKey>, rot: number, dx: number, dy: number): Set<CellKey> {
  throw new Error('TODO(core) transformCells');
}

/** Сжатие: одна строка на ряд "y:x1-x2,x3" (ряды по возрастанию y, отрезки по возрастанию x). */
export function encodeCells(cells: Set<CellKey>): string[] {
  throw new Error('TODO(core) encodeCells');
}

/** Разбор строк "y:x1-x2,x3". Некорректные фрагменты пропускаются. */
export function decodeCells(rows: string[]): Set<CellKey> {
  throw new Error('TODO(core) decodeCells');
}

/** Граничное ребро: клетка комнаты (cx, cy) и её сторона, за которой не комната. */
export interface Edge {
  cx: number;
  cy: number;
  side: Side;
}

export function boundaryEdges(cells: Set<CellKey>): Edge[] {
  throw new Error('TODO(core) boundaryEdges');
}

/** Контур для отрисовки: список отрезков границы, слитых в длинные линии
 *  [x1,y1,x2,y2] в клеточных координатах (углы клеток). */
export function outlineLines(cells: Set<CellKey>): [number, number, number, number][] {
  throw new Error('TODO(core) outlineLines');
}
