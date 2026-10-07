// Двери и метки стыковки — отрезки на границе комнаты (см. Segment в types.ts).
// Контракт зафиксирован оркестратором; реализации TODO(core) дописывает агент ядра.
import type { CellKey, Room, Segment, Side } from './types';
import { SIDE_DELTA, boundaryRuns, cellKey, type BoundaryRun } from './cells';

/** Клетки комнаты, образующие отрезок. */
export function segmentCells(seg: Pick<Segment, 'cx' | 'cy' | 'side' | 'len'>): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < seg.len; i++) {
    out.push(seg.side === 'N' || seg.side === 'S' ? [seg.cx + i, seg.cy] : [seg.cx, seg.cy + i]);
  }
  return out;
}

/** Линия отрезка на ребре: [x1, y1, x2, y2] в клеточных координатах (углы клеток). */
export function segmentLine(seg: Pick<Segment, 'cx' | 'cy' | 'side' | 'len'>): [number, number, number, number] {
  const { cx, cy, len } = seg;
  switch (seg.side) {
    case 'N': return [cx, cy, cx + len, cy];
    case 'S': return [cx, cy + 1, cx + len, cy + 1];
    case 'W': return [cx, cy, cx, cy + len];
    case 'E': return [cx + 1, cy, cx + 1, cy + len];
  }
}

/** Середина отрезка в клеточных координатах. */
export function segmentMid(seg: Pick<Segment, 'cx' | 'cy' | 'side' | 'len'>): [number, number] {
  const [x1, y1, x2, y2] = segmentLine(seg);
  return [(x1 + x2) / 2, (y1 + y2) / 2];
}

type Geom = Pick<Segment, 'cx' | 'cy' | 'side' | 'len'>;

/** Отрезок корректен: все клетки в комнате, соседи по side — нет. */
export function isSegmentValid(cells: Set<CellKey>, seg: Pick<Segment, 'cx' | 'cy' | 'side' | 'len'>): boolean {
  if (!(seg.len >= 1) || !Number.isInteger(seg.len) || !SIDE_DELTA[seg.side]) return false;
  const [dx, dy] = SIDE_DELTA[seg.side];
  for (const [x, y] of segmentCells(seg)) {
    if (!cells.has(cellKey(x, y)) || cells.has(cellKey(x + dx, y + dy))) return false;
  }
  return true;
}

/** Два отрезка занимают хотя бы одно общее граничное ребро (одна сторона, общие клетки). */
export function segmentsOverlap(a: Geom, b: Geom): boolean {
  if (a.side !== b.side) return false;
  const horiz = a.side === 'N' || a.side === 'S';
  if (horiz ? a.cy !== b.cy : a.cx !== b.cx) return false;
  const a0 = horiz ? a.cx : a.cy, b0 = horiz ? b.cx : b.cy;
  return a0 < b0 + b.len && b0 < a0 + a.len;
}

/**
 * Лучшее положение отрезка длиной len на стене run: центр как можно ближе к проекции точки,
 * без пересечения с others. Возвращает начальную координату вдоль стены или null.
 */
function fitOnRun(run: BoundaryRun, along: number, len: number, others: Geom[]): number | null {
  const horiz = run.side === 'N' || run.side === 'S';
  const start = horiz ? run.cx : run.cy;
  const lo = start, hi = start + run.len - len;
  if (hi < lo) return null;
  // запрещённые начала: [o0 - len + 1, o0 + o.len - 1] для каждого пересекающего стену отрезка
  const banned: [number, number][] = [];
  for (const o of others) {
    if (o.side !== run.side) continue;
    if (horiz ? o.cy !== run.cy : o.cx !== run.cx) continue;
    const o0 = horiz ? o.cx : o.cy;
    const b0 = o0 - len + 1, b1 = o0 + o.len - 1;
    if (b1 < lo || b0 > hi) continue;
    banned.push([b0, b1]);
  }
  const want = Math.min(hi, Math.max(lo, Math.round(along - len / 2)));
  if (!banned.length) return want;
  banned.sort((p, q) => p[0] - q[0]);
  // свободные интервалы начал внутри [lo, hi]
  let best: number | null = null;
  let bestD = Infinity;
  const consider = (a: number, b: number) => {
    if (b < a) return;
    const s = Math.min(b, Math.max(a, want));
    const d = Math.abs(s - want);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  };
  let cur = lo;
  for (const [b0, b1] of banned) {
    consider(cur, Math.min(hi, b0 - 1));
    cur = Math.max(cur, b1 + 1);
    if (cur > hi) break;
  }
  consider(cur, hi);
  return best;
}

/** Ближайшее к точке место на границе (общая логика placeSegment и reattachSegments). */
function nearestPlacement(runs: BoundaryRun[], px: number, py: number, len: number, others: Geom[]): Geom | null {
  let best: Geom | null = null;
  let bestD = Infinity;
  for (const run of runs) {
    if (run.len < len) continue;
    const horiz = run.side === 'N' || run.side === 'S';
    const s = fitOnRun(run, horiz ? px : py, len, others);
    if (s === null) continue;
    const g: Geom = horiz
      ? { cx: s, cy: run.cy, side: run.side, len }
      : { cx: run.cx, cy: s, side: run.side, len };
    const [mx, my] = segmentMid(g);
    const d = Math.hypot(mx - px, my - py);
    if (d < bestD - 1e-9) {
      bestD = d;
      best = g;
    }
  }
  return best;
}

/**
 * Постановка кликом (ТЗ §5): найти ближайшую к точке (px, py) грань границы, на которой
 * помещается отрезок длиной len, не пересекающийся с отрезками `others` (той же категории),
 * и центрировать его по курсору (со сдвигом внутрь прямой стены при упоре в угол).
 * Возвращает геометрию или null, если места нет нигде.
 */
export function placeSegment(
  cells: Set<CellKey>,
  px: number,
  py: number,
  len: number,
  others: Segment[],
): { cx: number; cy: number; side: Side; len: number } | null {
  if (!(len >= 1)) return null;
  return nearestPlacement(boundaryRuns(cells), px, py, Math.round(len), others);
}

/**
 * Перепривязка после изменения формы (ТЗ §5): невалидный отрезок переезжает на ближайшую
 * допустимую стену (по расстоянию от его старой середины), если стены нет — удаляется.
 * Мутирует room.doors и room.connectors. Возвращает число перемещённых и удалённых.
 */
export function reattachSegments(room: Room): { moved: number; removed: number } {
  let moved = 0, removed = 0;
  let runs: BoundaryRun[] | null = null; // считаются лениво — обычно всё валидно
  const fix = <T extends Segment>(list: T[]): T[] => {
    const bad = list.filter((s) => !isSegmentValid(room.cells, s));
    if (!bad.length) return list;
    runs ??= boundaryRuns(room.cells);
    // занятое место: валидные отрезки + уже переставленные
    const placed: Geom[] = list.filter((s) => !bad.includes(s));
    const drop = new Set<T>();
    for (const s of bad) {
      const [mx, my] = segmentMid(s);
      const g = s.len >= 1 ? nearestPlacement(runs, mx, my, Math.round(s.len), placed) : null;
      if (!g) {
        drop.add(s);
        removed++;
        continue;
      }
      s.cx = g.cx;
      s.cy = g.cy;
      s.side = g.side;
      s.len = g.len;
      placed.push(s);
      moved++;
    }
    return drop.size ? list.filter((s) => !drop.has(s)) : list;
  };
  room.doors = fix(room.doors);
  room.connectors = fix(room.connectors);
  return { moved, removed };
}

/** Расстояние от точки до отрезка (в клетках) — для попадания курсором. */
export function distToSegment(seg: Pick<Segment, 'cx' | 'cy' | 'side' | 'len'>, px: number, py: number): number {
  const [x1, y1, x2, y2] = segmentLine(seg);
  const vx = x2 - x1, vy = y2 - y1;
  const l2 = vx * vx + vy * vy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - x1) * vx + (py - y1) * vy) / l2)) : 0;
  return Math.hypot(px - (x1 + t * vx), py - (y1 + t * vy));
}

/**
 * Совместимость тегов меток стыковки.
 *  • Направленный тег "a>b" стыкуется только с "b>a" (прихожая "hall>kitchen" ↔ кухня "kitchen>hall"),
 *    поэтому две прихожие не соединятся через свои кухонные проёмы.
 *  • Простой тег (без ">") стыкуется только с таким же ("stair" ↔ "stair").
 */
export function tagsCompatible(a: string, b: string): boolean {
  const i = a.indexOf('>');
  if (i < 0) return b.indexOf('>') < 0 && a === b;
  return b === `${a.slice(i + 1)}>${a.slice(0, i)}`;
}
