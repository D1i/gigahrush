import { describe, expect, it } from 'vitest';
import {
  applyShape,
  bbox,
  boundaryEdges,
  boundaryRuns,
  brushCells,
  cellKey,
  decodeCells,
  ellipseCells,
  encodeCells,
  isRectangle,
  outlineLines,
  rectCells,
  resizeCells,
  transformCells,
} from './cells';
import type { CellKey } from './types';

const sorted = (s: Set<CellKey>) => [...s].sort();

/** L-форма: 4×2 сверху + 2×2 слева снизу (x 0..3, y 0..1; x 0..1, y 2..3). */
function lShape(): Set<CellKey> {
  const s = rectCells(0, 0, 4, 2);
  applyShape(s, rectCells(0, 2, 2, 2), 'add');
  return s;
}

describe('encode/decode', () => {
  it('прямоугольник 5×4 м = 40 строк', () => {
    const rows = encodeCells(rectCells(0, 0, 50, 40));
    expect(rows).toHaveLength(40);
    expect(rows[0]).toBe('0:0-49');
    expect(rows[39]).toBe('39:0-49');
  });

  it('одиночная клетка без дефиса, ряды по возрастанию y', () => {
    const s = new Set([cellKey(5, 2), cellKey(1, 0), cellKey(2, 0), cellKey(3, 0), cellKey(7, 2)]);
    expect(encodeCells(s)).toEqual(['0:1-3', '2:5,7']);
  });

  it('отрицательные координаты', () => {
    const s = new Set<CellKey>();
    for (let x = -5; x <= -1; x++) s.add(cellKey(x, -3));
    s.add(cellKey(2, -3));
    s.add(cellKey(-7, -10));
    const rows = encodeCells(s);
    expect(rows).toEqual(['-10:-7', '-3:-5--1,2']);
    expect(sorted(decodeCells(rows))).toEqual(sorted(s));
  });

  it('отрезок через ноль', () => {
    const s = rectCells(-2, -1, 5, 2);
    expect(encodeCells(s)).toEqual(['-1:-2-2', '0:-2-2']);
    expect(sorted(decodeCells(encodeCells(s)))).toEqual(sorted(s));
  });

  it('roundtrip дырявой формы', () => {
    const s = rectCells(0, 0, 20, 20);
    applyShape(s, rectCells(5, 5, 4, 4), 'sub');
    applyShape(s, ellipseCells(12, 10, 18, 16), 'sub');
    applyShape(s, rectCells(30, -8, 3, 3), 'add');
    expect(sorted(decodeCells(encodeCells(s)))).toEqual(sorted(s));
  });

  it('некорректные фрагменты пропускаются', () => {
    const s = decodeCells(['0:1-2,abc,4', 'мусор', 'x:1', '1:', '2:3--', '3: 5 ']);
    expect(sorted(s)).toEqual(sorted(new Set([cellKey(1, 0), cellKey(2, 0), cellKey(4, 0), cellKey(5, 3)])));
  });
});

describe('формы', () => {
  it('ellipseCells нормализует углы и симметричен', () => {
    const a = ellipseCells(0, 0, 10, 6);
    const b = ellipseCells(10, 6, 0, 0);
    expect(sorted(a)).toEqual(sorted(b));
    expect(a.has(cellKey(5, 3))).toBe(true);
    expect(a.has(cellKey(0, 0))).toBe(false);
    for (const k of a) {
      const [x, y] = k.split(',').map(Number);
      expect(a.has(cellKey(9 - x, y))).toBe(true);
      expect(a.has(cellKey(x, 5 - y))).toBe(true);
    }
    expect(ellipseCells(3, 3, 3, 8).size).toBe(0);
  });

  it('brushCells — диск', () => {
    expect(sorted(brushCells(0.5, 0.5, 0))).toEqual(['0,0']);
    const d = brushCells(0, 0, 1);
    // центры (±0.5, ±0.5) на расстоянии 0.707
    expect(sorted(d)).toEqual(sorted(new Set(['-1,-1', '0,-1', '-1,0', '0,0'])));
    expect(brushCells(10, 10, 3).size).toBeGreaterThan(20);
  });

  it('isRectangle', () => {
    expect(isRectangle(rectCells(2, 3, 4, 5))).toBe(true);
    expect(isRectangle(new Set())).toBe(false);
    expect(isRectangle(lShape())).toBe(false);
  });

  it('transformCells: поворот 4×90 = тождество, bbox поворачивается', () => {
    const s = lShape();
    let t: Set<CellKey> = s;
    for (let i = 0; i < 4; i++) t = transformCells(t, 90, 0, 0);
    expect(sorted(t)).toEqual(sorted(s));
    const r = transformCells(rectCells(0, 0, 4, 2), 90, 10, 0);
    expect(bbox(r)).toMatchObject({ w: 2, h: 4, x0: 8, y0: 0 });
  });
});

describe('resizeCells', () => {
  it('прямоугольник → новый прямоугольник', () => {
    const r = resizeCells(rectCells(0, 0, 3, 3), { x0: -1, y0: 0, x1: 5, y1: 2 });
    expect(sorted(r)).toEqual(sorted(rectCells(-1, 0, 6, 2)));
  });

  it('L-форма: расширение вправо и вниз продолжает крайний профиль', () => {
    const r = resizeCells(lShape(), { x0: 0, y0: 0, x1: 6, y1: 5 });
    // вправо тянутся ряды 0 и 1 (у них есть клетка в столбце 3)
    expect(r.has(cellKey(5, 0))).toBe(true);
    expect(r.has(cellKey(5, 1))).toBe(true);
    expect(r.has(cellKey(5, 2))).toBe(false);
    // вниз тянется ряд 3 — столбцы 0..1
    expect(r.has(cellKey(0, 4))).toBe(true);
    expect(r.has(cellKey(1, 4))).toBe(true);
    expect(r.has(cellKey(2, 4))).toBe(false);
    expect(r.size).toBe(8 + 4 + 4 + 2);
    expect(bbox(r)).toMatchObject({ x0: 0, y0: 0, x1: 6, y1: 5 });
  });

  it('L-форма: расширение влево и вверх', () => {
    const r = resizeCells(lShape(), { x0: -2, y0: -1, x1: 4, y1: 4 });
    // влево тянутся все ряды (столбец 0 полный)
    for (let y = 0; y < 4; y++) expect(r.has(cellKey(-2, y))).toBe(true);
    // вверх тянется ряд 0 (после X он занимает -2..3)
    for (let x = -2; x < 4; x++) expect(r.has(cellKey(x, -1))).toBe(true);
    expect(r.has(cellKey(3, 3))).toBe(false);
  });

  it('L-форма: сжатие отсекает', () => {
    const r = resizeCells(lShape(), { x0: 0, y0: 0, x1: 3, y1: 3 });
    expect(sorted(r)).toEqual(sorted(new Set(['0,0', '1,0', '2,0', '0,1', '1,1', '2,1', '0,2', '1,2'])));
  });
});

describe('граница', () => {
  it('boundaryEdges прямоугольника = периметр', () => {
    expect(boundaryEdges(rectCells(0, 0, 5, 3))).toHaveLength(2 * (5 + 3));
    expect(boundaryEdges(new Set(['0,0']))).toHaveLength(4);
  });

  it('boundaryRuns и outlineLines сливают рёбра', () => {
    const lines = outlineLines(rectCells(0, 0, 5, 3));
    expect(lines).toHaveLength(4);
    expect(lines).toEqual(
      expect.arrayContaining([
        [0, 0, 5, 0],
        [0, 3, 5, 3],
        [0, 0, 0, 3],
        [5, 0, 5, 3],
      ]),
    );
    // L-форма — шестиугольник
    expect(outlineLines(lShape())).toHaveLength(6);
    const runs = boundaryRuns(lShape());
    expect(runs).toContainEqual({ cx: 2, cy: 1, side: 'S', len: 2 });
    expect(runs).toContainEqual({ cx: 0, cy: 0, side: 'W', len: 4 });
  });

  it('производительность: 4000 клеток', () => {
    const s = rectCells(0, 0, 80, 50);
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) {
      decodeCells(encodeCells(s));
      outlineLines(s);
    }
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});
