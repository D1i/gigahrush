// Внутренние геометрические хелперы генератора (не зависят от TODO(core)-функций ядра).
// Формулы продублированы в docs/GENERATOR.md — движок игры должен повторять их один в один.
import { OPPOSITE, parseKey, rotateCell } from '../model/cells';
import { tagsCompatible } from '../model/segments';
import type { CellKey, MatchMode, Rot, Segment, Side } from '../model/types';

export type SegGeom = Pick<Segment, 'cx' | 'cy' | 'side' | 'len'>;

const SIDE_ORDER: Side[] = ['N', 'E', 'S', 'W'];

/** Знак внешней нормали стороны по «своей» оси: N/W — к меньшим координатам, S/E — к большим. */
export const OUT_SIGN: Record<Side, number> = { N: -1, S: 1, W: -1, E: 1 };

/** Угол в [0, 360). */
export function normDeg(r: number): number {
  const v = r % 360;
  return v < 0 ? v + 360 : v === 0 ? 0 : v;
}

/** Поворот (кратный 90), переводящий локальную сторону from в мировую to. */
export function rotFor(from: Side, to: Side): Rot {
  const steps = (SIDE_ORDER.indexOf(to) - SIDE_ORDER.indexOf(from) + 4) % 4;
  return (steps * 90) as Rot;
}

/** Поворот стороны по часовой (N→E→S→W). Своя копия — чтобы не зависеть от порядка реализации ядра. */
export function turnSide(side: Side, rot: number): Side {
  const steps = ((Math.round(rot / 90) % 4) + 4) % 4;
  return SIDE_ORDER[(SIDE_ORDER.indexOf(side) + steps) % 4];
}

/**
 * Отрезок после поворота rot вокруг (0,0) и сдвига (dx, dy).
 * Клетки поворачиваются как клетки (rotateCell), сторона — turnSide,
 * стартовая клетка — минимальная по оси отрезка.
 */
export function transformSeg<T extends SegGeom>(seg: T, rot: number, dx: number, dy: number): T {
  const n = Math.max(1, seg.len) - 1;
  const horiz = seg.side === 'N' || seg.side === 'S';
  const [ax, ay] = rotateCell(seg.cx, seg.cy, rot);
  const [bx, by] = rotateCell(horiz ? seg.cx + n : seg.cx, horiz ? seg.cy : seg.cy + n, rot);
  return { ...seg, side: turnSide(seg.side, rot), cx: Math.min(ax, bx) + dx, cy: Math.min(ay, by) + dy };
}

/** Координата линии отрезка по нормали: N → cy, S → cy+1, W → cx, E → cx+1. */
export function segLine(s: SegGeom): number {
  switch (s.side) {
    case 'N': return s.cy;
    case 'S': return s.cy + 1;
    case 'W': return s.cx;
    case 'E': return s.cx + 1;
  }
}

/** Начало отрезка вдоль стены: N/S → cx, E/W → cy. */
export function segStart(s: SegGeom): number {
  return s.side === 'N' || s.side === 'S' ? s.cx : s.cy;
}

/** Совместимость меток по режиму стыковки. Теги сравниваются через tagsCompatible:
 *  направленный "a>b" стыкуется только с "b>a", простой тег — только с таким же. */
export function compatible(
  a: { tag: string; len: number },
  b: { tag: string; len: number },
  match: MatchMode,
): boolean {
  switch (match) {
    case 'exact': return a.len === b.len && tagsCompatible(a.tag, b.tag);
    case 'tag': return tagsCompatible(a.tag, b.tag);
    case 'len': return a.len === b.len;
  }
}

/**
 * Где должна стоять метка B (мировая сторона = OPPOSITE(A.side)), пристыкованная к A:
 * линия B = линия A + gap·OUT_SIGN[A.side]; начало B = начало A + floor((lenA − lenB)/2).
 * Возвращает мировые (cx, cy) стартовой клетки B.
 */
export function dockTarget(a: SegGeom, bLen: number, gap: number): { side: Side; cx: number; cy: number } {
  const side = OPPOSITE[a.side];
  const line = segLine(a) + gap * OUT_SIGN[a.side];
  const start = segStart(a) + Math.floor((a.len - bLen) / 2);
  switch (side) {
    case 'N': return { side, cx: start, cy: line };
    case 'S': return { side, cx: start, cy: line - 1 };
    case 'W': return { side, cx: line, cy: start };
    case 'E': return { side, cx: line - 1, cy: start };
  }
}

/** Две мировые метки стоят лицом к лицу с зазором gap (с любой из двух сторон округления). */
export function facing(a: SegGeom, b: SegGeom, gap: number): boolean {
  if (b.side !== OPPOSITE[a.side]) return false;
  if (segLine(b) !== segLine(a) + gap * OUT_SIGN[a.side]) return false;
  const sa = segStart(a);
  const sb = segStart(b);
  return sb === sa + Math.floor((a.len - b.len) / 2) || sa === sb + Math.floor((b.len - a.len) / 2);
}

/** Сжатие клеток в строки "y:x1-x2,x3" (ряды по возрастанию y, отрезки по возрастанию x). */
export function encodeRows(cells: Iterable<CellKey>): string[] {
  const rows = new Map<number, number[]>();
  for (const k of cells) {
    const [x, y] = parseKey(k);
    let r = rows.get(y);
    if (!r) rows.set(y, (r = []));
    r.push(x);
  }
  const ys = [...rows.keys()].sort((a, b) => a - b);
  const out: string[] = [];
  for (const y of ys) {
    const xs = rows.get(y)!.sort((a, b) => a - b);
    const parts: string[] = [];
    let s = xs[0];
    let prev = xs[0];
    for (let i = 1; i <= xs.length; i++) {
      const x = xs[i];
      if (i < xs.length && x === prev + 1) { prev = x; continue; }
      if (i < xs.length && x === prev) continue; // дубликаты (не должно быть)
      parts.push(s === prev ? `${s}` : `${s}-${prev}`);
      s = prev = x;
    }
    out.push(`${y}:${parts.join(',')}`);
  }
  return out;
}
