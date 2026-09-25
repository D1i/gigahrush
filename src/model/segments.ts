// Двери и метки стыковки — отрезки на границе комнаты (см. Segment в types.ts).
// Контракт зафиксирован оркестратором; реализации TODO(core) дописывает агент ядра.
import type { CellKey, Room, Segment, Side } from './types';

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

// ───────────── TODO(core) ─────────────

/** Отрезок корректен: все клетки в комнате, соседи по side — нет. */
export function isSegmentValid(cells: Set<CellKey>, seg: Pick<Segment, 'cx' | 'cy' | 'side' | 'len'>): boolean {
  throw new Error('TODO(core) isSegmentValid');
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
  throw new Error('TODO(core) placeSegment');
}

/**
 * Перепривязка после изменения формы (ТЗ §5): невалидный отрезок переезжает на ближайшую
 * допустимую стену (по расстоянию от его старой середины), если стены нет — удаляется.
 * Мутирует room.doors и room.connectors. Возвращает число перемещённых и удалённых.
 */
export function reattachSegments(room: Room): { moved: number; removed: number } {
  throw new Error('TODO(core) reattachSegments');
}

/** Расстояние от точки до отрезка (в клетках) — для попадания курсором. */
export function distToSegment(seg: Pick<Segment, 'cx' | 'cy' | 'side' | 'len'>, px: number, py: number): number {
  throw new Error('TODO(core) distToSegment');
}
