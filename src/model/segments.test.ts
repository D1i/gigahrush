import { describe, expect, it } from 'vitest';
import { applyShape, rectCells } from './cells';
import { distToSegment, isSegmentValid, placeSegment, reattachSegments, segmentsOverlap } from './segments';
import { emptyProject } from './serialize';
import { createRoom } from './ops';
import type { CellKey, Connector, Segment } from './types';

/** L-форма: 40×20 сверху + 20×20 слева снизу. */
function lShape(): Set<CellKey> {
  const s = rectCells(0, 0, 40, 20);
  applyShape(s, rectCells(0, 20, 20, 20), 'add');
  return s;
}

describe('isSegmentValid / distToSegment', () => {
  const cells = rectCells(0, 0, 10, 10);
  it('валидность', () => {
    expect(isSegmentValid(cells, { cx: 2, cy: 0, side: 'N', len: 4 })).toBe(true);
    expect(isSegmentValid(cells, { cx: 8, cy: 0, side: 'N', len: 4 })).toBe(false); // вылезает
    expect(isSegmentValid(cells, { cx: 2, cy: 1, side: 'N', len: 4 })).toBe(false); // не граница
    expect(isSegmentValid(cells, { cx: 9, cy: 3, side: 'E', len: 7 })).toBe(true);
    expect(isSegmentValid(cells, { cx: 9, cy: 3, side: 'E', len: 0 })).toBe(false);
  });
  it('расстояние', () => {
    const seg = { cx: 2, cy: 0, side: 'N' as const, len: 4 }; // линия (2,0)-(6,0)
    expect(distToSegment(seg, 4, 3)).toBeCloseTo(3);
    expect(distToSegment(seg, 9, 4)).toBeCloseTo(5);
  });
});

describe('placeSegment', () => {
  const cells = rectCells(0, 0, 30, 20);

  it('центрирует по курсору у ближайшей стены', () => {
    expect(placeSegment(cells, 15, 1, 8, [])).toEqual({ cx: 11, cy: 0, side: 'N', len: 8 });
    expect(placeSegment(cells, 15, 19, 8, [])).toEqual({ cx: 11, cy: 19, side: 'S', len: 8 });
    expect(placeSegment(cells, 29.5, 10, 6, [])).toEqual({ cx: 29, cy: 7, side: 'E', len: 6 });
    expect(placeSegment(cells, -3, 10, 6, [])).toEqual({ cx: 0, cy: 7, side: 'W', len: 6 });
  });

  it('упор в угол сдвигает внутрь стены', () => {
    expect(placeSegment(cells, 1, -1, 8, [])).toEqual({ cx: 0, cy: 0, side: 'N', len: 8 });
    expect(placeSegment(cells, 30, -1, 8, [])).toEqual({ cx: 22, cy: 0, side: 'N', len: 8 });
  });

  it('не пересекается с others и не помещается — null', () => {
    const other: Segment = { id: 'd', cx: 10, cy: 0, side: 'N', len: 8 };
    const r = placeSegment(cells, 14, 0.5, 8, [other])!;
    expect(r.side).toBe('N');
    expect(segmentsOverlap(r, other)).toBe(false);
    expect(r.cx === 2 || r.cx === 18).toBe(true);
    expect(placeSegment(rectCells(0, 0, 5, 5), 2, 2, 8, [])).toBeNull();
  });

  it('L-форма: внутренние стены', () => {
    const s = lShape();
    // внутренний угол: нижняя стена верхней части (y=20, x 20..40) и правая стена ножки (x=20, y 20..40)
    const a = placeSegment(s, 30, 20.5, 6, [])!;
    expect(a).toEqual({ cx: 27, cy: 19, side: 'S', len: 6 });
    const b = placeSegment(s, 21, 30, 6, [])!;
    expect(b).toEqual({ cx: 19, cy: 27, side: 'E', len: 6 });
    expect(isSegmentValid(s, a)).toBe(true);
    expect(isSegmentValid(s, b)).toBe(true);
    // стена ножки длиной 20 — отрезок 25 туда не влезет, пойдёт на внешнюю
    const c = placeSegment(s, 21, 30, 25, [])!;
    expect(c.side).toBe('W');
  });
});

describe('reattachSegments', () => {
  it('перемещает невалидный и удаляет безнадёжный; валидные не трогает', () => {
    const p = emptyProject();
    const room = createRoom(p, 'Тест', 3, 2); // 30×20
    room.doors = [
      { id: 'ok', cx: 5, cy: 0, side: 'N', len: 6 },
      { id: 'mv', cx: 22, cy: 19, side: 'S', len: 6 },
      { id: 'big', cx: 0, cy: 19, side: 'S', len: 25 },
    ];
    const con: Connector = { id: 'c1', cx: 5, cy: 0, side: 'N', len: 6, name: 'a', tag: 'door' };
    room.connectors = [con];
    // вырезаем правый нижний угол: дверь mv теряет стену
    applyShape(room.cells, rectCells(20, 10, 10, 10), 'sub');
    // и поднимаем низ слева: дверь длиной 25 теперь влезает только на верхнюю стену, где стоит «ok»
    applyShape(room.cells, rectCells(0, 12, 20, 8), 'sub');
    const res = reattachSegments(room);
    expect(res).toEqual({ moved: 1, removed: 1 });
    expect(room.doors.map((d) => d.id)).toEqual(['ok', 'mv']);
    expect(room.doors[0]).toEqual({ id: 'ok', cx: 5, cy: 0, side: 'N', len: 6 });
    const mv = room.doors[1];
    expect(isSegmentValid(room.cells, mv)).toBe(true);
    expect(mv.len).toBe(6);
    // метка на месте двери — другая категория, не мешает
    expect(room.connectors[0]).toBe(con);
    expect(con.cx).toBe(5);
  });

  it('перемещённый отрезок не наезжает на соседа той же категории', () => {
    const p = emptyProject();
    const room = createRoom(p, 'Тест', 3, 2);
    room.doors = [
      { id: 'a', cx: 10, cy: 11, side: 'S', len: 6 },
      { id: 'b', cx: 10, cy: 19, side: 'S', len: 6 },
    ];
    // теперь нижняя стена на y=11 (строки 12..19 удалены); a валидна, b — нет
    applyShape(room.cells, rectCells(0, 12, 30, 8), 'sub');
    const res = reattachSegments(room);
    expect(res).toEqual({ moved: 1, removed: 0 });
    const [a, b] = room.doors;
    expect(a.cx).toBe(10);
    expect(isSegmentValid(room.cells, b)).toBe(true);
    expect(segmentsOverlap(a, b)).toBe(false);
  });
});
