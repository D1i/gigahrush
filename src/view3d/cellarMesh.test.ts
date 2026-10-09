import { describe, expect, it } from 'vitest';
import type { RunConnector, RunExport, RunInstance, Side } from '../blockout/types';
import {
  buildCellarMesh, cellarField, cellarSpecFor, cellarSpecOf, cellRects, isCellarRoom, CEL_DOOR_H, CEL_IN, CEL_STEP, type CellarPieceSpec,
} from './cellarMesh';

// Синтетические куски погреба по замыслу биома (клетка 0.1 м, зазор 1 клетка): ход 0.6 м, щель-«песочные часы»
// (0.6 — 0.4 — 0.6), хаб 1.5 × 2 с выходом наверх ('stair', дверь болванки), комнатка 1.2 × 1.5 за щелью 0.4 м.
const C = 0.1;

interface K {
  id: string;
  side: Side;
  /** первая клетка вдоль стены и длина, клетки */
  at: number;
  len: number;
  tag?: string;
  link?: { inst: string; connector: string };
  exit?: boolean;
  collapsed?: boolean;
}

/** экземпляр: клетки — прямоугольники [x0, y0, x1, y1) в клетках; метки — на сторонах габарита */
function inst(id: string, tags: string[], rects: [number, number, number, number][], ks: K[]): RunInstance {
  const rows = new Map<number, number[]>();
  for (const [x0, y0, x1, y1] of rects) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) rows.set(y, [...(rows.get(y) ?? []), x]);
  const cells = [...rows.entries()].map(([y, xs]) => `${y}:${[...new Set(xs)].sort((a, b) => a - b).join(',')}`);
  const bx0 = Math.min(...rects.map((r) => r[0])), by0 = Math.min(...rects.map((r) => r[1]));
  const bx1 = Math.max(...rects.map((r) => r[2])), by1 = Math.max(...rects.map((r) => r[3]));
  const connectors: RunConnector[] = ks.map((k) => {
    const line: [number, number, number, number] =
      k.side === 'N' ? [k.at, by0, k.at + k.len, by0] : k.side === 'S' ? [k.at, by1, k.at + k.len, by1] : k.side === 'W' ? [bx0, k.at, bx0, k.at + k.len] : [bx1, k.at, bx1, k.at + k.len];
    return {
      id: k.id, name: k.id, tag: k.tag ?? 'cellar', side: k.side, len: k.len, line,
      cx: k.side === 'E' ? bx1 - 1 : k.side === 'W' ? bx0 : k.at, cy: k.side === 'S' ? by1 - 1 : k.side === 'N' ? by0 : k.at,
      linkedTo: k.link ?? null, ...(k.exit ? { exit: true } : {}), ...(k.collapsed ? { collapsed: true } : {}),
    };
  });
  return {
    id, roomId: id, roomName: id, roomTags: tags, rot: 0, dx: 0, dy: 0, depth: 0, parent: null,
    bbox: { x0: bx0, y0: by0, x1: bx1, y1: by1 }, cells, doors: [], connectors, decor: [], spots: [], tier: null, danger: 0, dangerAcc: 0, loot: [],
  };
}

const PASS = ['погреб', 'только-биом', 'ход'];
/** ход A 0.6 × 3 м, под ним (через зазор) ход B 0.6 × 2 м: A.s — B.n */
const A = inst('A', PASS, [[0, 0, 6, 30]], [{ id: 'n', side: 'N', at: 0, len: 6 }, { id: 's', side: 'S', at: 0, len: 6, link: { inst: 'B', connector: 'n' } }]);
const B = inst('B', PASS, [[0, 31, 6, 51]], [{ id: 'n', side: 'N', at: 0, len: 6, link: { inst: 'A', connector: 's' } }, { id: 's', side: 'S', at: 0, len: 6 }]);
/** щель: концы 0.6 × 0.6, середина 0.4 × 1.8 */
const Q = inst('Q', [...PASS, 'щель'], [[0, 0, 6, 6], [1, 6, 5, 24], [0, 24, 6, 30]], [{ id: 'n', side: 'N', at: 0, len: 6, link: { inst: 'x', connector: 'y' } }, { id: 's', side: 'S', at: 0, len: 6, link: { inst: 'x', connector: 'z' } }]);
/** хаб 1.5 × 2: ход на север, щель 0.4 на восток (в комнатку R), выход наверх на юге (дверь болванки) */
const Hb = inst('H', ['погреб', 'только-биом', 'хаб'], [[0, 0, 15, 20]], [
  { id: 'n', side: 'N', at: 5, len: 6, link: { inst: 'x', connector: 'y' } },
  { id: 'bin', side: 'E', at: 8, len: 4, tag: 'cellar>bin', link: { inst: 'R', connector: 'w' } },
  { id: 'up', side: 'S', at: 3, len: 8, tag: 'stair', exit: true },
]);
const R = inst('R', ['погреб', 'только-биом', 'комнатка'], [[16, 5, 28, 20]], [{ id: 'w', side: 'W', at: 8, len: 4, tag: 'bin>cellar', link: { inst: 'H', connector: 'bin' } }]);
const run = (insts: RunInstance[]): RunExport =>
  ({ format: 'room-forge-run', version: 1, seed: 's', cellM: C, settings: { gap: 1 }, props: [], items: [], instances: insts, links: [], openConnectors: [] }) as unknown as RunExport;
const W = run([A, B, Q, Hb, R]);
const spec = (id: string): CellarPieceSpec => cellarSpecFor(W, id, { deadEnds: 'wall', openCut: true })!.spec;

/** вершины сетки на плоскости y = Y (Babylon Z = −Y), отсортированные */
const ring = (m: ReturnType<typeof buildCellarMesh>, Y: number) => {
  const out: string[] = [];
  for (let i = 0; i < m.positions.length / 3; i++) if (Math.abs(m.positions[i * 3 + 2] + Y) < 1e-6) out.push(`${m.positions[i * 3].toFixed(4)},${m.positions[i * 3 + 1].toFixed(4)}`);
  return out.sort();
};

describe('оболочка погреба', () => {
  it('комната погреба — по первому тегу; клетки — прямоугольники', () => {
    expect(isCellarRoom(A)).toBe(true);
    expect(isCellarRoom({ roomTags: ['подвал', 'погреб'] })).toBe(false);
    expect(cellRects(Q.cells)).toEqual([{ x0: 0, y0: 0, x1: 6, y1: 6 }, { x0: 1, y0: 6, x1: 5, y1: 24 }, { x0: 0, y0: 24, x1: 6, y1: 30 }]);
    expect(cellarSpecFor(run([{ ...A, roomTags: ['подвал'] }]), 'A')).toBeNull();
  });

  it('знак поля: в ходе — воздух, в стене, под полом и над сводом — земля', () => {
    const F = cellarField(spec('A'));
    for (const y of [0.4, 1.5, 2.6]) {
      expect(F.f(0.3, y, 0.1)).toBeLessThan(0);
      expect(F.f(0.3, y, 1.0)).toBeLessThan(0);
      expect(F.f(0.3, y, 1.75)).toBeLessThan(0);
      expect(F.f(-0.12, y, 1.0)).toBeGreaterThan(0);
      expect(F.f(0.72, y, 1.0)).toBeGreaterThan(0);
      expect(F.f(0.3, y, -0.05)).toBeGreaterThan(0);
      expect(F.f(0.3, y, 2.1)).toBeGreaterThan(0);
    }
    // щель посередине — 0.4 м: стена сразу за линией клеток (x = 0.1 и 0.5)
    const G = cellarField(spec('Q'));
    expect(G.f(0.3, 1.5, 1.0)).toBeLessThan(0);
    expect(G.f(0.0, 1.5, 1.0)).toBeGreaterThan(0);
    expect(G.f(0.6, 1.5, 1.0)).toBeGreaterThan(0);
  });

  it('у соседей по проёму кольцо вершин на плоскости проёма совпадает (шов не виден)', () => {
    const a = buildCellarMesh(spec('A'));
    const b = buildCellarMesh(spec('B'));
    const ra = ring(a, 3.05), rb = ring(b, 3.05);
    expect(ra.length).toBeGreaterThan(40);
    expect(ra).toEqual(rb);
    // устье на плоскости — внутри проёма (маски портала): по ширине ±(0.3 − 4 мм), по высоте 0…CEL_DOOR_H
    for (const v of ra) {
      const [x, z] = v.split(',').map(Number);
      expect(x).toBeGreaterThanOrEqual(0.0035);
      expect(x).toBeLessThanOrEqual(0.5965);
      expect(z).toBeGreaterThanOrEqual(-1e-6);
      expect(z).toBeLessThanOrEqual(CEL_DOOR_H + 1e-6);
    }
    // щель 0.4 м хаба и комнатки: тоже совпадает
    const h = buildCellarMesh(spec('H'));
    const r = buildCellarMesh(spec('R'));
    const ringX = (m: ReturnType<typeof buildCellarMesh>, X: number) => {
      const out: string[] = [];
      for (let i = 0; i < m.positions.length / 3; i++) if (Math.abs(m.positions[i * 3] - X) < 1e-6) out.push(`${(-m.positions[i * 3 + 2]).toFixed(4)},${m.positions[i * 3 + 1].toFixed(4)}`);
      return out.sort();
    };
    const rh = ringX(h, 1.55), rr = ringX(r, 1.55);
    expect(rh.length).toBeGreaterThan(30);
    expect(rh).toEqual(rr);
  });

  it('оболочка не заходит в проходимое глубже 2 см и не выходит за плоскости проёмов вне устья', () => {
    for (const id of ['A', 'B', 'Q', 'H', 'R']) {
      const s = spec(id);
      const F = cellarField(s);
      const m = buildCellarMesh(s);
      let worst = 0;
      for (let i = 0; i < m.positions.length / 3; i++) {
        const x = m.positions[i * 3], z = m.positions[i * 3 + 1], y = -m.positions[i * 3 + 2];
        if (z > 0.25 && z < 1.6) worst = Math.min(worst, F.plan(x, y));
        for (const d of s.doors) {
          if (d.state !== 'open') continue;
          const al = (x - d.x) * d.nx + (y - d.y) * d.ny;
          const la = Math.abs(-(x - d.x) * d.ny + (y - d.y) * d.nx);
          expect(al).toBeGreaterThanOrEqual(-1e-9);
          if (al < 0.005) expect(la).toBeLessThanOrEqual(d.half);
        }
      }
      expect(worst).toBeGreaterThanOrEqual(-CEL_IN - 0.002);
    }
  });

  it('свод: в ходе и щели 1.8…1.95 м, в хабе 1.9…2.05 м', () => {
    const vaultAt = (F: ReturnType<typeof cellarField>, x: number, y: number) => {
      let z = 1.0;
      while (F.f(x, y, z) < 0 && z < 3) z += 0.005;
      return z;
    };
    for (const [id, x, y0, y1, lo, hi] of [['A', 0.3, 0.6, 2.4, 1.8, 1.95], ['Q', 0.3, 0.8, 2.2, 1.8, 1.95], ['H', 0.75, 0.5, 1.5, 1.9, 2.05]] as const) {
      const F = cellarField(spec(id));
      let mn = Infinity, mx = -Infinity;
      for (let y = y0; y <= y1; y += 0.05) for (const dx of [-0.08, 0, 0.08]) {
        const v = vaultAt(F, x + dx, y);
        mn = Math.min(mn, v);
        mx = Math.max(mx, v);
      }
      expect(mn).toBeGreaterThanOrEqual(lo);
      expect(mx).toBeLessThanOrEqual(hi);
    }
  });

  it('выход наверх: ниша за полотном и свод над наличником (дверь болванки видна)', () => {
    const s = spec('H');
    const up = s.doors.find((d) => d.id === 'up')!;
    expect(up.state).toBe('closed');
    expect(up.slot).toBeCloseTo(2.1, 6);
    const F = cellarField(s);
    // середина двери: линия стены y = 2.0 (плоскость — 2.05)
    expect(F.f(0.8, 2.0 + 0.02, 1.0)).toBeLessThan(0); // ниша за линией стены
    expect(F.f(0.8, 2.0 - 0.1, 2.15)).toBeLessThan(0); // альков выше свода хаба
    expect(F.f(0.8, 2.0 + 0.06, 1.0)).toBeGreaterThan(0); // за нишей — земля
    // тупик без двери (тупики 'wall') — глухая стена
    const dead = cellarSpecOf({ ...Hb, connectors: Hb.connectors.map((k) => (k.id === 'n' ? { ...k, linkedTo: null } : k)) }, C, { deadEnds: 'wall' });
    expect(dead.doors.find((d) => d.id === 'n')!.slot).toBeUndefined();
    expect(cellarField(dead).f(0.8, -0.02, 1.0)).toBeGreaterThan(0);
  });

  it('завал — куча земли в проёме', () => {
    const c = cellarSpecOf({ ...A, connectors: A.connectors.map((k) => (k.id === 's' ? { ...k, linkedTo: null, collapsed: true } : k)) }, C, { deadEnds: 'wall' });
    const F = cellarField(c);
    expect(F.f(0.3, 2.9, 0.3)).toBeGreaterThan(0);
    expect(F.f(0.3, 1.5, 0.3)).toBeLessThan(0);
  });

  it('треугольников — не больше 12 тыс. на метр хода; куски строятся быстро', () => {
    for (const id of ['A', 'Q', 'H', 'R']) {
      const s = spec(id);
      const t0 = performance.now();
      const m = buildCellarMesh(s);
      const ms = performance.now() - t0;
      const tris = m.indices.length / 3;
      const len = id === 'A' || id === 'Q' ? 3 : 1;
      if (len > 1) expect(tris / len).toBeLessThan(12000);
      expect(ms).toBeLessThan(5000);
      console.log(`погреб ${id}: ${m.positions.length / 3} вершин, ${tris} треуг.${len > 1 ? ` (${Math.round(tris / len)} на метр)` : ''}, ${ms.toFixed(0)} мс`);
    }
    expect(CEL_STEP).toBe(0.05);
  });
});
