import { describe, expect, it } from 'vitest';
import { cellKey, rectCells } from '../model/cells';
import { segmentCells } from '../model/segments';
import type { CellKey, Instance, Rot } from '../model/types';
import { generateRun } from './generate';
import { encodeRows } from './geom';
import { contentProject, lProject, rectRoom, project } from './fixtures.test-util';
import { exportRunJSON, instanceWorld, runWorld } from './world';

/** Независимый декодер строк "y:x1-x2,x3" (с отрицательными координатами). */
function decode(rows: string[]): Set<CellKey> {
  const out = new Set<CellKey>();
  for (const row of rows) {
    const i = row.indexOf(':');
    const y = +row.slice(0, i);
    for (const part of row.slice(i + 1).split(',')) {
      const m = /^(-?\d+)(?:-(-?\d+))?$/.exec(part)!;
      const a = +m[1], b = m[2] !== undefined ? +m[2] : a;
      for (let x = a; x <= b; x++) out.add(cellKey(x, y));
    }
  }
  return out;
}

const inst = (roomId: string, rot: Rot, dx = 0, dy = 0): Instance => ({ id: 'i0', roomId, rot, dx, dy, order: 0, parent: null, depth: 0 });

describe('world', () => {
  it('поворот метки: клетки через rotateCell, сторона по часовой, старт — минимальная клетка', () => {
    const r = rectRoom('r', 10, 4);
    r.connectors = [{ id: 'c', name: 'c', tag: 't', cx: 2, cy: 0, side: 'N', len: 3 }];
    const p = project([r]);
    expect(instanceWorld(p, inst('r', 90, 100, 50)).connectors[0]).toMatchObject({ side: 'E', cx: 99, cy: 52, len: 3 });
    expect(instanceWorld(p, inst('r', 180)).connectors[0]).toMatchObject({ side: 'S', cx: -5, cy: -1 });
    expect(instanceWorld(p, inst('r', 270)).connectors[0]).toMatchObject({ side: 'W', cx: 0, cy: -5 });
  });

  it('во всех поворотах метки остаются корректными (на границе, снаружи пусто)', () => {
    const p = lProject();
    const d = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] } as const;
    for (const rot of [0, 90, 180, 270] as Rot[]) {
      const w = instanceWorld(p, inst('L', rot, 7, -3));
      expect(w.cells.size).toBe(p.rooms[1].cells.size);
      for (const c of w.connectors) {
        for (const [x, y] of segmentCells(c)) {
          expect(w.cells.has(cellKey(x, y))).toBe(true);
          expect(w.cells.has(cellKey(x + d[c.side][0], y + d[c.side][1]))).toBe(false);
        }
      }
    }
  });

  it('декор и споты: позиция rotatePoint, rot += rot экземпляра', () => {
    const r = rectRoom('r', 10, 4);
    r.decor = [{ id: 'd', propId: 'p', x: 2.5, y: 1.5, rot: 300 }];
    r.spots = [{ id: 's', name: 's', x: 1, y: 2, rot: 0, groupId: null }];
    const w = instanceWorld(project([r]), inst('r', 90, 10, 0));
    expect(w.decor[0]).toMatchObject({ x: 8.5, y: 2.5, rot: 30 });
    expect(w.spots[0]).toMatchObject({ x: 8, y: 1, rot: 90 });
    expect(w.bbox).toEqual({ x0: 6, y0: 0, x1: 10, y1: 10 });
  });

  it('encodeRows: ряды по y, отрезки по x, отрицательные координаты', () => {
    const cells = new Set([cellKey(-3, -1), cellKey(-2, -1), cellKey(0, -1), cellKey(5, 2)]);
    expect(encodeRows(cells)).toEqual(['-1:-3--2,0', '2:5']);
    const big = new Set([...rectCells(-7, -4, 13, 9), ...rectCells(20, 0, 3, 3)]);
    big.delete(cellKey(0, 0));
    expect(decode(encodeRows(big))).toEqual(big);
  });

  it('exportRunJSON: самодостаточный JSON в мировых координатах', () => {
    const p = contentProject();
    p.rooms[0].connectors = [
      { id: 'n', name: 'n', tag: 'd', cx: 6, cy: 0, side: 'N', len: 8 },
      { id: 'e', name: 'e', tag: 'd', cx: 19, cy: 6, side: 'E', len: 8 },
      { id: 's', name: 's', tag: 'd', cx: 6, cy: 19, side: 'S', len: 8 },
    ];
    const run = generateRun(p, { count: 12, seed: 'exp' });
    const json = exportRunJSON(p, run) as any;
    const round = JSON.parse(JSON.stringify(json));
    expect(round).toEqual(json);
    expect(json).toMatchObject({ format: 'room-forge-run', version: 1, seed: 'exp', cellM: 0.1 });
    expect(json.units).toEqual({ cell: 0.1, note: 'координаты в клетках, ось Y вниз' });
    expect(json.instances.length).toBe(run.instances.length);
    const worlds = runWorld(p, run);
    json.instances.forEach((ji: any, i: number) => {
      expect(decode(ji.cells)).toEqual(worlds[i].cells);
      expect(ji.roomName).toBe('Комната room');
      for (const c of ji.connectors) {
        if (c.linkedTo) {
          const other = json.instances.find((x: any) => x.id === c.linkedTo.inst).connectors.find((x: any) => x.id === c.linkedTo.connector);
          expect(other.linkedTo).toEqual({ inst: ji.id, connector: c.id });
        }
      }
      const spot = ji.spots.find((s: any) => s.id === 's1');
      expect(spot.variantId).toBe(run.content[i].groups[0].variantId);
    });
    // текстуры не раздувают экспорт, но флаг есть
    const sb = json.props.find((x: any) => x.id === 'wardrobe');
    expect(sb).toMatchObject({ tex: null, hasTex: false });
    const withTex = exportRunJSON(p, run, { withTex: true }) as any;
    const anySideboard = withTex.props.find((x: any) => x.id === 'sideboard');
    if (anySideboard) expect(anySideboard.tex).toMatch(/^data:/);
    expect(json.totals).toEqual(run.totals);
    expect(json.links).toEqual(run.links);
  });
});
