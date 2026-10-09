import { describe, expect, it } from 'vitest';
import { BED_CLEAR_M, buildBlockoutModel, PROP_COVER, propCover, propHeightM, TABLE_CLEAR_M, validateBlockout } from './core';
import { PROP_BY_ID } from '../data/props';
import type { BlockoutModel, RunConnector, RunExport, RunFinish, RunInstance, RunSegment, Side, SolidKind, WallFace } from './types';

// ───────────────────────── синтетические входы ─────────────────────────

type Cell = [number, number];
interface Seg {
  id: string;
  side: Side;
  cx: number;
  cy: number;
  len: number;
}

const rect = (x0: number, y0: number, w: number, h: number): Cell[] => {
  const out: Cell[] = [];
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) out.push([x, y]);
  return out;
};
const minus = (a: Cell[], b: Cell[]): Cell[] => a.filter(([x, y]) => !b.some(([u, v]) => u === x && v === y));

/** сжатие клеток в ряды "y:x1-x2,x3" (как exportRunJSON) */
function rows(cells: Cell[]): string[] {
  const by = new Map<number, number[]>();
  for (const [x, y] of cells) by.set(y, [...(by.get(y) ?? []), x]);
  return [...by.keys()].sort((a, b) => a - b).map((y) => {
    const xs = [...new Set(by.get(y))].sort((a, b) => a - b);
    const parts: string[] = [];
    for (let i = 0; i < xs.length; ) {
      let j = i;
      while (j + 1 < xs.length && xs[j + 1] === xs[j] + 1) j++;
      parts.push(i === j ? `${xs[i]}` : `${xs[i]}-${xs[j]}`);
      i = j + 1;
    }
    return `${y}:${parts.join(',')}`;
  });
}

const segLine = (s: Seg): [number, number, number, number] =>
  s.side === 'N' ? [s.cx, s.cy, s.cx + s.len, s.cy]
    : s.side === 'S' ? [s.cx, s.cy + 1, s.cx + s.len, s.cy + 1]
      : s.side === 'W' ? [s.cx, s.cy, s.cx, s.cy + s.len]
        : [s.cx + 1, s.cy, s.cx + 1, s.cy + s.len];

function room(id: string, cells: Cell[], cons: Seg[] = [], doors: Seg[] = []): RunInstance {
  const xs = cells.map((c) => c[0]), ys = cells.map((c) => c[1]);
  return {
    id, roomId: `r_${id}`, roomName: `Комната ${id}`, roomTags: [], rot: 0, dx: 0, dy: 0, depth: 0, parent: null,
    bbox: { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs) + 1, y1: Math.max(...ys) + 1 },
    cells: rows(cells),
    doors: doors.map((d): RunSegment => ({ ...d, line: segLine(d) })),
    connectors: cons.map((k): RunConnector => ({ ...k, name: k.id, tag: 't', line: segLine(k), linkedTo: null })),
    decor: [], spots: [], tier: null, danger: 0, dangerAcc: 0, loot: [],
  };
}

/** links: [instA, conA, instB, conB]; linkedTo проставляется по ним */
function mkRun(gap: number, instances: RunInstance[], links: [string, string, string, string][] = []): RunExport {
  const L = links.map(([ia, ca, ib, cb]) => ({ a: { inst: ia, connector: ca }, b: { inst: ib, connector: cb } }));
  for (const l of L) {
    for (const [p, q] of [[l.a, l.b], [l.b, l.a]] as const) {
      const k = instances.find((i) => i.id === p.inst)?.connectors.find((c) => c.id === p.connector);
      if (k) k.linkedTo = { ...q };
    }
  }
  return {
    format: 'room-forge-run', version: 1, seed: 't', cellM: 0.1, settings: { gap }, props: [], items: [],
    instances, links: L, openConnectors: [],
  };
}

/** сколько твёрдых объёмов (заданных видов) содержат точку строго внутри */
function cover(m: BlockoutModel, x: number, y: number, z: number, kinds?: SolidKind[]): number {
  return m.solids.filter((s) => (!kinds || kinds.includes(s.kind))
    && x > s.rect.x0 && x < s.rect.x1 && y > s.rect.y0 && y < s.rect.y1 && z > s.z0 && z < s.z1).length;
}

const close = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;

/** две комнаты 10×10 по x с зазором gap, метки E/W */
function pair(gap: number, a: { cy: number; len: number } = { cy: 3, len: 4 }, b: { cy: number; len: number } = a): RunExport {
  return mkRun(gap, [
    room('A', rect(0, 0, 10, 10), [{ id: 'a1', side: 'E', cx: 9, cy: a.cy, len: a.len }]),
    room('B', rect(10 + gap, 0, 10, 10), [{ id: 'b1', side: 'W', cx: 10 + gap, cy: b.cy, len: b.len }]),
  ], [['A', 'a1', 'B', 'b1']]);
}

// ───────────────────────── тесты ─────────────────────────

describe('blockout: стыковка комнат', () => {
  it('gap 1: один проём, одна стена между комнатами, перемычка над проёмом', () => {
    const run = pair(1);
    const before = JSON.stringify(run);
    const m = buildBlockoutModel(run);
    expect(JSON.stringify(run)).toBe(before); // вход не мутирован
    expect(m.issues).toEqual([]);
    expect(validateBlockout(m)).toEqual([]);
    expect(m.openings).toHaveLength(1);
    const op = m.openings[0];
    expect(op.rect).toEqual({ x0: 1, y0: 0.3, x1: 1.1, y1: 0.7 });
    expect(op.axis).toBe('x');
    expect(op.widthM).toBeCloseTo(0.4);
    expect(op.heightM).toBeCloseTo(2.1);
    // перемычка ровно над проёмом: от двери до верха плиты потолка
    const lintel = m.solids.filter((s) => s.kind === 'lintel');
    expect(lintel).toHaveLength(1);
    expect(lintel[0].rect).toEqual(op.rect);
    expect(lintel[0].z0).toBeCloseTo(2.1);
    expect(lintel[0].z1).toBeCloseTo(2.7);
    // зазор = ровно одна стена (каждая точка зазора — один объём), в проёме ниже двери пусто
    for (let y = 0.05; y < 1; y += 0.1) {
      const inOpening = y > 0.3 && y < 0.7;
      expect(cover(m, 1.05, y, 1.0)).toBe(inOpening ? 0 : 1);
      expect(cover(m, 1.05, y, 2.3)).toBe(1);
    }
    // стены зазора — на всю его ширину (не две половинки «каждой комнаты»)
    for (const s of m.solids.filter((s) => s.kind === 'wall' && s.rect.x0 < 1.1 && s.rect.x1 > 1 && s.rect.y0 < 1 && s.rect.y1 > 0)) {
      expect(s.rect.x0).toBeLessThanOrEqual(1);
      expect(s.rect.x1).toBeGreaterThanOrEqual(1.1);
    }
    expect(m.deadEnds).toEqual([]);
    expect(m.floors.map((f) => f.inst)).toEqual(['A', 'B', null]);
    expect(m.floors[2].rects).toEqual([op.rect]);
    expect(m.ceilings.map((f) => f.inst)).toEqual(['A', 'B']);
    expect(m.floors[0].z).toBe(0);
    expect(m.ceilings[0].z).toBeCloseTo(2.5);
    // стены: от низа плиты пола до верха плиты потолка
    const wall = m.solids.find((s) => s.kind === 'wall')!;
    expect(wall.z0).toBeCloseTo(-0.2);
    expect(wall.z1).toBeCloseTo(2.7);
    expect(m.stats.solids).toBe(m.solids.length);
    expect(m.solids.length).toBeLessThan(15);
  });

  it('метки разной длины (режим tag): проём — пересечение пролётов', () => {
    const m = buildBlockoutModel(pair(1, { cy: 2, len: 6 }, { cy: 4, len: 5 }));
    expect(m.issues).toEqual([]);
    expect(validateBlockout(m)).toEqual([]);
    expect(m.openings).toHaveLength(1);
    expect(m.openings[0].rect).toEqual({ x0: 1, y0: 0.4, x1: 1.1, y1: 0.8 });
    expect(m.openings[0].widthM).toBeCloseTo(0.4);
    // хвосты меток вне пересечения закрыты стеной
    expect(cover(m, 1.05, 0.25, 1, ['wall'])).toBe(1);
    expect(cover(m, 1.05, 0.85, 1, ['wall'])).toBe(1);
  });

  it('gap 0: перегородка по ребру с отверстием проёма и перемычкой', () => {
    const m = buildBlockoutModel(pair(0));
    expect(m.issues).toEqual([]);
    expect(validateBlockout(m)).toEqual([]);
    const parts = m.solids.filter((s) => s.kind === 'partition').map((s) => s.rect);
    expect(parts).toEqual(expect.arrayContaining([
      { x0: 0.96, y0: 0, x1: 1.04, y1: 0.3 },
      { x0: 0.96, y0: 0.7, x1: 1.04, y1: 1 },
    ]));
    expect(parts).toHaveLength(2);
    const lintel = m.solids.filter((s) => s.kind === 'lintel');
    expect(lintel).toHaveLength(1);
    expect(lintel[0].rect).toEqual({ x0: 0.96, y0: 0.3, x1: 1.04, y1: 0.7 });
    expect(lintel[0].z0).toBeCloseTo(2.1);
    expect(lintel[0].z1).toBeCloseTo(2.5); // под плитой потолка
    expect(m.openings[0].rect).toEqual(lintel[0].rect);
    expect(m.openings[0].widthM).toBeCloseTo(0.4);
    // между комнатами нет стеновой массы — только перегородка
    expect(m.solids.some((s) => s.kind === 'wall' && s.rect.x0 < 1.04 && s.rect.x1 > 0.96 && s.rect.y0 < 1 && s.rect.y1 > 0)).toBe(false);
    // перегородка — от пола до потолка
    const p = m.solids.find((s) => s.kind === 'partition')!;
    expect([p.z0, p.z1]).toEqual([0, 2.5]);
  });

  it('gap 3: толстая общая стена, проём на всю её толщину', () => {
    const m = buildBlockoutModel(pair(3));
    expect(m.issues).toEqual([]);
    expect(validateBlockout(m)).toEqual([]);
    expect(m.openings[0].rect).toEqual({ x0: 1, y0: 0.3, x1: 1.3, y1: 0.7 });
    for (const x of [1.05, 1.15, 1.25]) {
      for (let y = 0.05; y < 1; y += 0.1) expect(cover(m, x, y, 1)).toBe(y > 0.3 && y < 0.7 ? 0 : 1);
    }
  });

  it('метки не лицом к лицу / неизвестный экземпляр — проблема входа, проём пропущен, тупики', () => {
    const run = mkRun(1, [
      room('A', rect(0, 0, 10, 10), [{ id: 'a1', side: 'E', cx: 9, cy: 3, len: 4 }]),
      room('B', rect(11, 0, 10, 10), [{ id: 'b1', side: 'N', cx: 12, cy: 0, len: 4 }]),
    ], [['A', 'a1', 'B', 'b1'], ['A', 'a1', 'Z', 'z1']]);
    const m = buildBlockoutModel(run);
    expect(m.openings).toEqual([]);
    expect(m.issues.some((s) => /A\/a1 и B\/b1 связаны, но не стоят лицом к лицу.*проём пропущен/.test(s))).toBe(true);
    expect(m.issues.some((s) => /Z не найден/.test(s))).toBe(true);
    expect(m.deadEnds.map((d) => d.connector).sort()).toEqual(['a1', 'b1']);
    expect(validateBlockout(m)).toEqual([]);
  });

  it('пересечение экземпляров — проблема входа, клетки за первым', () => {
    const m = buildBlockoutModel(mkRun(1, [room('A', rect(0, 0, 10, 10)), room('B', rect(8, 0, 10, 10))]));
    expect(m.issues.some((s) => /A и B пересекаются \(20 кл\.\)/.test(s))).toBe(true);
    expect(m.rooms.find((r) => r.inst === 'B')!.floorAreaM2).toBeCloseTo(0.8);
    expect(validateBlockout(m)).toEqual([]);
  });
});

describe('blockout: формы и пустоты', () => {
  it('Г-образная комната: стены обходят внутренний угол, якорь в наибольшем прямоугольнике', () => {
    const m = buildBlockoutModel(mkRun(1, [room('L', [...rect(0, 0, 10, 4), ...rect(0, 4, 4, 6)])]));
    expect(m.issues).toEqual([]);
    expect(validateBlockout(m)).toEqual([]);
    const r = m.rooms[0];
    expect(r.floorAreaM2).toBeCloseTo(0.64);
    expect(r.anchor).toEqual([0.5, 0.2]);
    expect(r.bbox).toEqual({ x0: 0, y0: 0, x1: 1, y1: 1 });
    expect(cover(m, 0.45, 0.45, 1, ['wall'])).toBe(1); // клетка во внутреннем углу
    expect(cover(m, 0.8, 0.8, 1)).toBe(0); // дальше обвязки — снаружи пусто
  });

  it('дыра в комнате — колонна; без fillVoids — обычная обвязка', () => {
    const cells = minus(rect(0, 0, 10, 10), rect(4, 4, 2, 2));
    const m = buildBlockoutModel(mkRun(1, [room('H', cells)]));
    expect(validateBlockout(m)).toEqual([]);
    const cols = m.solids.filter((s) => s.kind === 'column');
    expect(cols).toHaveLength(1);
    expect(cols[0].rect).toEqual({ x0: 0.4, y0: 0.4, x1: 0.6, y1: 0.6 });
    expect([cols[0].z0, cols[0].z1]).toEqual([-0.2, 2.7]);
    expect(cover(m, 0.5, 0.5, 1)).toBe(1);

    const m2 = buildBlockoutModel(mkRun(1, [room('H', cells)]), { fillVoids: false });
    expect(m2.solids.some((s) => s.kind === 'column')).toBe(false);
    expect(cover(m2, 0.5, 0.5, 1, ['wall'])).toBe(1);
    expect(validateBlockout(m2)).toEqual([]);
  });

  it('двор, замкнутый несколькими комнатами, и щель между стенами заливаются массой', () => {
    // кольцо из 4 комнат вокруг двора 6×6 (gap 1) + далёкая комната через щель в 2 клетки
    const m = buildBlockoutModel(mkRun(1, [
      room('N', rect(0, 0, 20, 5)),
      room('S', rect(0, 15, 20, 5)),
      room('W', rect(0, 6, 5, 8)),
      room('E', rect(15, 6, 5, 8)),
      room('F', rect(26, 0, 5, 5)), // обвязки E/N и F — по 2 клетки, между ними 2 пустые → щель
    ]));
    expect(validateBlockout(m)).toEqual([]);
    expect(cover(m, 1.0, 1.0, 1, ['wall'])).toBe(1); // центр двора
    expect(cover(m, 2.35, 0.25, 1, ['wall'])).toBe(1); // щель между стенами
    expect(m.solids.some((s) => s.kind === 'column')).toBe(false); // двор не «колонна» одной комнаты
  });
});

describe('blockout: узлы перегородок (gap 0)', () => {
  const vertexChecks = (m: BlockoutModel, x: number, y: number): void => {
    expect(validateBlockout(m)).toEqual([]);
    const P: SolidKind[] = ['partition'];
    expect(cover(m, x, y, 1, P)).toBe(1);
    for (const [dx, dy] of [[0.03, 0], [-0.03, 0], [0, 0.03], [0, -0.03], [0.02, 0.02], [-0.02, -0.02], [0.02, -0.02], [-0.02, 0.02]]) {
      expect(cover(m, x + dx, y + dy, 1, P)).toBeLessThanOrEqual(1);
    }
  };

  it('Х-узел: четыре комнаты в одной точке — перегородки не пересекаются, узел закрыт', () => {
    const m = buildBlockoutModel(mkRun(0, [
      room('a', rect(0, 0, 5, 5)), room('b', rect(5, 0, 5, 5)), room('c', rect(0, 5, 5, 5)), room('d', rect(5, 5, 5, 5)),
    ]));
    vertexChecks(m, 0.5, 0.5);
    // вертикаль проходит насквозь, горизонтальные обрезаны на t/2
    const parts = m.solids.filter((s) => s.kind === 'partition').map((s) => s.rect);
    expect(parts).toEqual(expect.arrayContaining([
      { x0: 0.46, y0: 0, x1: 0.54, y1: 1 },
      { x0: 0, y0: 0.46, x1: 0.46, y1: 0.54 },
      { x0: 0.54, y0: 0.46, x1: 1, y1: 0.54 },
    ]));
    expect(parts).toHaveLength(3);
  });

  it('Т-узел: сквозная перегородка + ответвление, обрезанное на t/2', () => {
    const m = buildBlockoutModel(mkRun(0, [room('a', rect(0, 0, 5, 5)), room('b', rect(5, 0, 5, 5)), room('c', rect(0, 5, 10, 5))]));
    vertexChecks(m, 0.5, 0.5);
    const parts = m.solids.filter((s) => s.kind === 'partition').map((s) => s.rect);
    expect(parts).toEqual(expect.arrayContaining([
      { x0: 0, y0: 0.46, x1: 1, y1: 0.54 },
      { x0: 0.46, y0: 0, x1: 0.54, y1: 0.46 },
    ]));
    expect(parts).toHaveLength(2);
  });

  it('угол (L): угол перегородки закрыт без наложений', () => {
    const m = buildBlockoutModel(mkRun(0, [
      room('a', [...rect(0, 0, 10, 5), ...rect(0, 5, 5, 5)]),
      room('b', rect(5, 5, 5, 5)),
    ]));
    expect(validateBlockout(m)).toEqual([]);
    // все четыре четверти квадрата узла закрыты ровно одним объёмом: внешняя четверть (пол комнаты a)
    // тоже закрыта — a видит ровный угол перегородки, без выреза t/2
    for (const [x, y] of [[0.52, 0.52], [0.48, 0.52], [0.52, 0.48], [0.48, 0.48]]) expect(cover(m, x, y, 1, ['partition'])).toBe(1);
    const parts = m.solids.filter((s) => s.kind === 'partition').map((s) => s.rect);
    expect(parts).toHaveLength(3); // вертикаль, горизонталь (обрезана) и верхняя половина квадрата узла
    expect(parts).toContainEqual({ x0: 0.46, y0: 0.46, x1: 0.54, y1: 0.5 });
  });

  it('Т-узел из двух проёмов: сплошное ответвление доходит до оси, перемычки обрезаны', () => {
    // A — высокая слева, B и C справа; проёмы A–B и A–C сходятся в узле (0.5; 0.5), между B и C — перегородка
    const m = buildBlockoutModel(mkRun(0, [
      room('A', rect(0, 0, 5, 10), [{ id: 'ab', side: 'E', cx: 4, cy: 3, len: 2 }, { id: 'ac', side: 'E', cx: 4, cy: 5, len: 2 }]),
      room('B', rect(5, 0, 5, 5), [{ id: 'ba', side: 'W', cx: 5, cy: 3, len: 2 }]),
      room('C', rect(5, 5, 5, 5), [{ id: 'ca', side: 'W', cx: 5, cy: 5, len: 2 }]),
    ], [['A', 'ab', 'B', 'ba'], ['A', 'ac', 'C', 'ca']]));
    expect(m.issues).toEqual([]);
    expect(validateBlockout(m)).toEqual([]);
    expect(m.openings.map((o) => o.rect)).toEqual([
      { x0: 0.46, y0: 0.3, x1: 0.54, y1: 0.46 },
      { x0: 0.46, y0: 0.54, x1: 0.54, y1: 0.7 },
    ]);
    const rects = m.solids.map((s) => `${s.kind} ${s.rect.x0} ${s.rect.y0} ${s.rect.x1} ${s.rect.y1}`);
    expect(rects).toContain('partition 0.5 0.46 1 0.54'); // B | C — от оси узла
    expect(rects).toContain('lintel 0.46 0.46 0.5 0.54'); // добор перемычки над узлом со стороны A
    // ниже двери B и C не сообщаются через узел
    expect(cover(m, 0.52, 0.5, 1, ['partition'])).toBe(1);
  });

  it('Х-узел с проёмом у самого узла: сквозь узел идёт сплошная ось, ширина проёма в свету', () => {
    const m = buildBlockoutModel(mkRun(0, [
      room('a', rect(0, 0, 5, 5), [{ id: 'a1', side: 'E', cx: 4, cy: 3, len: 2 }]),
      room('b', rect(5, 0, 5, 5), [{ id: 'b1', side: 'W', cx: 5, cy: 3, len: 2 }]),
      room('c', rect(0, 5, 5, 5)), room('d', rect(5, 5, 5, 5)),
    ], [['a', 'a1', 'b', 'b1']]));
    expect(m.issues).toEqual([]);
    expect(validateBlockout(m)).toEqual([]);
    expect(m.openings[0].rect).toEqual({ x0: 0.46, y0: 0.3, x1: 0.54, y1: 0.46 });
    expect(m.openings[0].widthM).toBeCloseTo(0.16);
    expect(cover(m, 0.5, 0.5, 1, ['partition'])).toBe(1);
  });
});

describe('blockout: тупики', () => {
  // несвязанная метка сверху и дверь без метки снизу
  const lone = (): RunExport => mkRun(1, [room('A', rect(0, 0, 10, 10),
    [{ id: 'c1', side: 'N', cx: 3, cy: 0, len: 4 }],
    [{ id: 'd1', side: 'S', cx: 2, cy: 9, len: 3 }, { id: 'd2', side: 'N', cx: 3, cy: 0, len: 4 }])]);

  it("'wall' — глухая стена без панелей", () => {
    const m = buildBlockoutModel(lone(), { deadEnds: 'wall' });
    expect(m.deadEnds).toEqual([]);
    expect(m.floors).toHaveLength(1);
    expect(cover(m, 0.5, -0.05, 1, ['wall'])).toBe(1);
    expect(validateBlockout(m)).toEqual([]);
  });

  it("'panel' — стена + DeadEnd для метки и для двери в никуда (дверь поверх метки не дублируется)", () => {
    const m = buildBlockoutModel(lone(), { deadEnds: 'panel' });
    expect(m.deadEnds).toEqual([
      { inst: 'A', connector: 'c1', line: [0.3, 0, 0.7, 0], normal: [0, 1], widthM: 0.4, heightM: 2.1, source: 'connector' },
      { inst: 'A', connector: 'd1', line: [0.2, 1, 0.5, 1], normal: [0, -1], widthM: 0.3, heightM: 2.1, source: 'door' },
    ]);
    expect(m.stats.deadEnds).toBe(2);
    expect(cover(m, 0.5, -0.05, 1, ['wall'])).toBe(1);
    expect(validateBlockout(m)).toEqual([]);
  });

  it("'panel' при gap 0: панель на грани перегородки, а не на оси", () => {
    const m = buildBlockoutModel(mkRun(0, [
      room('A', rect(0, 0, 10, 10), [{ id: 'a1', side: 'E', cx: 9, cy: 3, len: 4 }]),
      room('B', rect(10, 0, 10, 10)),
    ]));
    expect(m.deadEnds[0].line).toEqual([0.96, 0.3, 0.96, 0.7]);
    expect(m.deadEnds[0].normal).toEqual([-1, 0]);
  });

  it("'open' — проём прорезан наружу сквозь обвязку, с перемычкой, без DeadEnd", () => {
    const m = buildBlockoutModel(lone(), { deadEnds: 'open' });
    expect(m.deadEnds).toEqual([]);
    const portal = m.floors.find((f) => f.inst === null)!;
    expect(portal.rects).toEqual(expect.arrayContaining([
      { x0: 0.3, y0: -0.2, x1: 0.7, y1: 0 },
      { x0: 0.2, y0: 1, x1: 0.5, y1: 1.2 },
    ]));
    expect(cover(m, 0.5, -0.1, 1)).toBe(0); // проход свободен
    expect(cover(m, 0.5, -0.1, 2.3, ['lintel'])).toBe(1);
    expect(cover(m, 0.25, -0.1, 1, ['wall'])).toBe(1); // щёки проёма — стена
    expect(validateBlockout(m)).toEqual([]);
  });
});

describe('blockout: высоты и опции', () => {
  it('slabM = 0, без потолков: стены от 0 до wallH, проверка чистая', () => {
    const m = buildBlockoutModel(pair(1), { slabM: 0, ceilings: false });
    expect(m.ceilings).toEqual([]);
    const w = m.solids.find((s) => s.kind === 'wall')!;
    expect([w.z0, w.z1]).toEqual([0, 2.5]);
    expect(validateBlockout(m)).toEqual([]);
  });

  it('дверь не ниже потолка — без перемычки, проём закрыт плитой потолка', () => {
    const m = buildBlockoutModel(pair(1), { doorHeightM: 2.5 });
    expect(m.solids.some((s) => s.kind === 'lintel')).toBe(false);
    expect(m.ceilings.find((c) => c.inst === null)?.rects).toEqual([m.openings[0].rect]);
    expect(validateBlockout(m)).toEqual([]);
  });

  it('болванки мебели: декор и выпавшее на спотах, габарит из props, высота по тегам', () => {
    const run = pair(1);
    run.props = [
      { id: 'p_wardrobe', name: 'Шкаф платяной', w: 1.2, h: 0.6, color: '#875', tags: ['шкаф', 'мебель'], hasTex: false, tex: null },
      { id: 'p_chair', name: 'Стул', w: 0.42, h: 0.45, color: '#a85', tags: ['стул'], hasTex: false, tex: null },
    ];
    run.instances[0].decor = [{ id: 'f1', propId: 'p_wardrobe', x: 3, y: 1, rot: 90 }];
    run.instances[0].spots = [
      { id: 's1', name: 'стул', x: 5, y: 5, rot: 0, groupId: 'g', variantId: 'v', content: { kind: 'prop', id: 'p_chair', rot: 0 }, contentRot: 180 },
      { id: 's2', name: 'пусто', x: 6, y: 6, rot: 0, groupId: 'g', variantId: null, content: null, contentRot: null },
    ];
    const m = buildBlockoutModel(run);
    expect(m.props).toEqual([
      { inst: 'A', source: 'decor', propId: 'p_wardrobe', name: 'Шкаф платяной', x: 0.3, y: 0.1, rot: 90, w: 1.2, d: 0.6, h: 1.9, color: '#875', tags: ['шкаф', 'мебель'] },
      { inst: 'A', source: 'spot', propId: 'p_chair', name: 'Стул', x: 0.5, y: 0.5, rot: 180, w: 0.42, d: 0.45, h: 0.45, color: '#a85', tags: ['стул'] },
    ]);
    expect(buildBlockoutModel(run, { spotProps: false }).props).toHaveLength(1);
    expect(buildBlockoutModel(run, { props: false }).props).toEqual([]);
  });

  it('propHeightM: таблица по тегам и словам имени', () => {
    expect(propHeightM(['стенка', 'сервант'], 'Стенка мебельная')).toBe(2.0);
    expect(propHeightM(['книги', 'шкаф'], 'Шкаф книжный')).toBe(1.9);
    expect(propHeightM(['сервант'], 'Сервант')).toBe(1.8);
    expect(propHeightM(['холодильник', 'кухня'], 'Холодильник «ЗИЛ»')).toBe(1.5);
    expect(propHeightM(['плита', 'кухня', 'газ'], 'Плита газовая')).toBe(0.85);
    expect(propHeightM(['мойка', 'кухня'], 'Мойка с тумбой')).toBe(0.85);
    expect(propHeightM(['тумба', 'кухня'], 'Стол-тумба кухонный')).toBe(0.85);
    expect(propHeightM(['стол', 'письменный'], 'Стол письменный')).toBe(0.75);
    expect(propHeightM(['стул'], 'Стул')).toBe(0.45);
    expect(propHeightM(['табурет'], 'Табурет')).toBe(0.45);
    expect(propHeightM(['кровать', 'спальное'], 'Кровать односпальная')).toBe(0.5);
    expect(propHeightM(['диван'], 'Диван-книжка')).toBe(0.85);
    expect(propHeightM(['ванна', 'санузел'], 'Ванна чугунная 1.5 м')).toBe(0.6);
    expect(propHeightM(['унитаз'], 'Унитаз с бачком')).toBe(0.75);
    expect(propHeightM(['ковёр', 'пол'], 'Ковёр большой')).toBe(0.01);
    expect(propHeightM(['батарея', 'отопление'], 'Батарея чугунная МС-140')).toBe(0.6);
    expect(propHeightM(['лифт', 'техника'], 'Лифт пассажирский')).toBe(2.2);
    expect(propHeightM(['почта', 'хранение'], 'Почтовые ящики')).toBe(1.5);
    expect(propHeightM([], 'Нечто')).toBe(0.8);
  });

  it('укрытия: кровать и стол на ножках получают cover/clear, сплошные — нет', () => {
    // все id таблицы — настоящие предметы каталога, вид совпадает с каталогом (кровать / стол)
    for (const [id, c] of Object.entries(PROP_COVER)) {
      const def = PROP_BY_ID[id];
      expect(def, id).toBeDefined();
      expect(c.clear).toBe(c.cover === 'bed' ? BED_CLEAR_M : TABLE_CLEAR_M);
      expect(def.tags.includes(c.cover === 'bed' ? 'кровать' : 'стол') || def.tags.includes('раскладушка'), id).toBe(true);
      // под болванкой есть плита: высота по тегам выше просвета
      expect(propHeightM(def.tags, def.name), id).toBeGreaterThan(c.clear + 0.04);
    }
    expect(BED_CLEAR_M).toBe(0.3);
    expect(TABLE_CLEAR_M).toBe(0.62);
    expect(propCover('p_obsh_bed')).toEqual({ cover: 'bed', clear: 0.3 });
    expect(propCover('p_obsh_table')).toEqual({ cover: 'table', clear: 0.62 });
    for (const id of ['p_desk', 'p_office_desk', 'p_obsh_vahter_desk', 'p_sofa', 'p_mattress', 'p_wardrobe', 'constructor', 'toString']) expect(propCover(id), id).toBeNull();

    const run = pair(1);
    const P = (id: string, name: string, tags: string[]) => ({ id, name, w: 0.9, h: 2, color: '#875', tags, hasTex: false, tex: null });
    run.props = [P('p_bed1', 'Кровать односпальная', ['кровать']), P('p_table_kitchen', 'Стол кухонный', ['стол']), P('p_desk', 'Стол письменный', ['стол'])];
    run.instances[0].decor = ['p_bed1', 'p_table_kitchen', 'p_desk'].map((propId, k) => ({ id: 'f' + k, propId, x: 2 + k * 10, y: 2, rot: 0 }));
    const m = buildBlockoutModel(run);
    const by = (id: string) => m.props.find((p) => p.propId === id)!;
    expect(by('p_bed1')).toMatchObject({ h: 0.5, cover: 'bed', clear: 0.3 });
    expect(by('p_table_kitchen')).toMatchObject({ h: 0.75, cover: 'table', clear: 0.62 });
    expect('cover' in by('p_desk') || 'clear' in by('p_desk')).toBe(false);
  });
});

// ───────────────────────── облицовка и отделка ─────────────────────────

const facesOf = (m: BlockoutModel, inst: string, part?: WallFace['part']): WallFace[] =>
  m.faces.filter((f) => f.inst === inst && (!part || f.part === part));
const flen = (f: WallFace): number => Math.hypot(f.line[2] - f.line[0], f.line[3] - f.line[1]);
const wallLen = (m: BlockoutModel, inst: string): number => facesOf(m, inst, 'wall').reduce((a, f) => a + flen(f), 0);
const lines = (fs: WallFace[]): string[] => fs.map((f) => `${f.part} ${f.line.join(' ')} n${f.normal.join(',')}`).sort();

describe('blockout: облицовка', () => {
  it('gap 1: у каждой комнаты облицовка по периметру минус проём + перемычка над проёмом', () => {
    const m = buildBlockoutModel(pair(1));
    expect(validateBlockout(m)).toEqual([]);
    expect(wallLen(m, 'A')).toBeCloseTo(3.6);
    expect(wallLen(m, 'B')).toBeCloseTo(3.6);
    // линия идёт слева направо, если смотреть на стену из комнаты; нормаль — внутрь комнаты
    expect(lines(facesOf(m, 'A'))).toEqual([
      'lintel 1 0.3 1 0.7 n-1,0',
      'wall 0 0 1 0 n0,1', // северная стена: смотрим на север — слева запад
      'wall 0 1 0 0 n1,0',
      'wall 1 0 1 0.3 n-1,0',
      'wall 1 0.7 1 1 n-1,0',
      'wall 1 1 0 1 n0,-1',
    ]);
    expect(lines(facesOf(m, 'B', 'lintel'))).toEqual(['lintel 1.1 0.7 1.1 0.3 n1,0']);
    const l = facesOf(m, 'A', 'lintel')[0];
    expect([l.z0, l.z1]).toEqual([2.1, 2.5]);
    const w = facesOf(m, 'A', 'wall')[0];
    expect([w.z0, w.z1, w.finish]).toEqual([0, 2.5, null]);
  });

  it('gap 0: облицовка на гранях перегородки (t/2 от ребра) с обеих сторон, перемычка — тоже', () => {
    const m = buildBlockoutModel(pair(0));
    expect(validateBlockout(m)).toEqual([]);
    expect(lines(facesOf(m, 'A'))).toEqual([
      'lintel 0.96 0.3 0.96 0.7 n-1,0',
      'wall 0 0 0.96 0 n0,1',
      'wall 0 1 0 0 n1,0',
      'wall 0.96 0 0.96 0.3 n-1,0',
      'wall 0.96 0.7 0.96 1 n-1,0',
      'wall 0.96 1 0 1 n0,-1',
    ]);
    expect(lines(facesOf(m, 'B'))).toEqual([
      'lintel 1.04 0.7 1.04 0.3 n1,0',
      'wall 1.04 0 2 0 n0,1',
      'wall 1.04 0.3 1.04 0 n1,0',
      'wall 1.04 1 1.04 0.7 n1,0',
      'wall 2 0 2 1 n-1,0',
      'wall 2 1 1.04 1 n0,-1',
    ]);
  });

  it('gap 3 и Г-образная комната: облицовка повторяет контур пола', () => {
    const m3 = buildBlockoutModel(pair(3));
    expect(validateBlockout(m3)).toEqual([]);
    expect(wallLen(m3, 'B')).toBeCloseTo(3.6);
    expect(lines(facesOf(m3, 'B', 'lintel'))).toEqual(['lintel 1.3 0.7 1.3 0.3 n1,0']);

    const m = buildBlockoutModel(mkRun(1, [room('L', [...rect(0, 0, 10, 4), ...rect(0, 4, 4, 6)])]));
    expect(validateBlockout(m)).toEqual([]);
    expect(lines(facesOf(m, 'L'))).toEqual([
      'wall 0 0 1 0 n0,1',
      'wall 0 1 0 0 n1,0',
      'wall 0.4 0.4 0.4 1 n-1,0', // внутренний угол
      'wall 0.4 1 0 1 n0,-1',
      'wall 1 0 1 0.4 n-1,0',
      'wall 1 0.4 0.4 0.4 n0,-1',
    ]);
  });

  it('колонна облицована со стороны комнаты', () => {
    const m = buildBlockoutModel(mkRun(1, [room('H', minus(rect(0, 0, 10, 10), rect(4, 4, 2, 2)))]));
    expect(validateBlockout(m)).toEqual([]);
    expect(wallLen(m, 'H')).toBeCloseTo(4.8);
    const col = lines(facesOf(m, 'H')).filter((l) => /^wall 0\.[46] 0\.[46] 0\.[46] 0\.[46] /.test(l));
    expect(col).toEqual([
      'wall 0.4 0.4 0.4 0.6 n-1,0',
      'wall 0.4 0.6 0.6 0.6 n0,1',
      'wall 0.6 0.4 0.4 0.4 n0,-1',
      'wall 0.6 0.6 0.6 0.4 n1,0',
    ]);
  });

  it('Х- и Т-узлы gap 0: облицовка обрывается на гранях перегородок, углы ровные', () => {
    const x = buildBlockoutModel(mkRun(0, [
      room('a', rect(0, 0, 5, 5)), room('b', rect(5, 0, 5, 5)), room('c', rect(0, 5, 5, 5)), room('d', rect(5, 5, 5, 5)),
    ]));
    expect(validateBlockout(x)).toEqual([]);
    // каждая комната видит ровно свой прямоугольник: пол минус t/2 перегородок
    expect(lines(facesOf(x, 'a'))).toEqual([
      'wall 0 0 0.46 0 n0,1', 'wall 0 0.46 0 0 n1,0', 'wall 0.46 0 0.46 0.46 n-1,0', 'wall 0.46 0.46 0 0.46 n0,-1',
    ]);
    expect(lines(facesOf(x, 'd'))).toEqual([
      'wall 0.54 0.54 1 0.54 n0,1', 'wall 0.54 1 0.54 0.54 n1,0', 'wall 1 0.54 1 1 n-1,0', 'wall 1 1 0.54 1 n0,-1',
    ]);

    const t = buildBlockoutModel(mkRun(0, [room('a', rect(0, 0, 5, 5)), room('b', rect(5, 0, 5, 5)), room('c', rect(0, 5, 10, 5))]));
    expect(validateBlockout(t)).toEqual([]);
    expect(lines(facesOf(t, 'b'))).toEqual([
      'wall 0.54 0 1 0 n0,1', 'wall 0.54 0.46 0.54 0 n1,0', 'wall 1 0 1 0.46 n-1,0', 'wall 1 0.46 0.54 0.46 n0,-1',
    ]);
    expect(lines(facesOf(t, 'c'))).toEqual([ // сквозная перегородка — одна грань на всю ширину
      'wall 0 0.54 1 0.54 n0,1', 'wall 0 1 0 0.54 n1,0', 'wall 1 0.54 1 1 n-1,0', 'wall 1 1 0 1 n0,-1',
    ]);
  });

  it("тупики: 'panel'/'wall' — облицовка идёт по стене; 'open' — над прорезью только перемычка", () => {
    const lone = (): RunExport => mkRun(1, [room('A', rect(0, 0, 10, 10), [{ id: 'c1', side: 'N', cx: 3, cy: 0, len: 4 }])]);
    for (const deadEnds of ['wall', 'panel'] as const) {
      const m = buildBlockoutModel(lone(), { deadEnds });
      expect(lines(facesOf(m, 'A')).filter((l) => l.endsWith('n0,1'))).toEqual(['wall 0 0 1 0 n0,1']);
      expect(validateBlockout(m)).toEqual([]);
    }
    const m = buildBlockoutModel(lone(), { deadEnds: 'open' });
    expect(lines(facesOf(m, 'A')).filter((l) => l.endsWith('n0,1'))).toEqual(['lintel 0.3 0 0.7 0 n0,1', 'wall 0 0 0.3 0 n0,1', 'wall 0.7 0 1 0 n0,1']);
    expect(wallLen(m, 'A')).toBeCloseTo(3.6);
    expect(validateBlockout(m)).toEqual([]);
  });

  it('дверь не ниже потолка — перемычек нет, облицовки над проёмом тоже', () => {
    const m = buildBlockoutModel(pair(1), { doorHeightM: 2.5 });
    expect(m.faces.some((f) => f.part === 'lintel')).toBe(false);
    expect(validateBlockout(m)).toEqual([]);
  });
});

describe('blockout: отделка', () => {
  const fin = (id: string, surface: 'wall' | 'floor', dado: RunFinish['dado'] = null): RunFinish => ({
    id, name: id, surface, color: '#c8b48c', tex: 'data:image/png;base64,AAAA', hasTex: true, tileW: 0.53, tileH: 0.6, dado,
  });

  it('отделка пробрасывается в облицовку, полы и комнаты; без отделки — null', () => {
    const run = pair(1);
    run.finishes = [fin('f_wall', 'wall', { finishId: 'f_paint', heightM: 1.5 }), fin('f_paint', 'wall'), fin('f_lino', 'floor')];
    run.instances[0].finish = { wall: 'f_wall', floor: 'f_lino' };
    const before = JSON.stringify(run);
    const m = buildBlockoutModel(run);
    expect(JSON.stringify(run)).toBe(before);
    expect(m.issues).toEqual([]);
    expect(m.finishes).toEqual(run.finishes);
    expect(m.finishes).not.toBe(run.finishes);
    expect(facesOf(m, 'A').every((f) => f.finish === 'f_wall')).toBe(true);
    expect(facesOf(m, 'B').every((f) => f.finish === null)).toBe(true);
    expect(facesOf(m, 'B').length).toBeGreaterThan(0); // облицовка строится и без отделки
    expect(m.floors.map((f) => [f.inst, f.finish])).toEqual([['A', 'f_lino'], ['B', null], [null, null]]);
    expect(m.ceilings.every((c) => c.finish === null)).toBe(true);
    expect(m.rooms.map((r) => r.finish)).toEqual([{ wall: 'f_wall', floor: 'f_lino' }, { wall: null, floor: null }]);
    expect(validateBlockout(m)).toEqual([]);
  });

  it('неизвестная отделка — проблема входа, без отделки; без таблицы finishes — пустой список', () => {
    const run = pair(1);
    run.instances[1].finish = { wall: 'nope', floor: null };
    const m = buildBlockoutModel(run);
    expect(m.issues).toEqual(['Отделка «nope» (стены B) не найдена в finishes — без отделки']);
    expect(m.finishes).toEqual([]);
    expect(facesOf(m, 'B').every((f) => f.finish === null)).toBe(true);
  });
});

describe('blockout: validateBlockout ловит испорченную модель', () => {
  it('пересечение объёмов, утечка наружу, перекрытый проём', () => {
    const m = buildBlockoutModel(pair(1));
    expect(validateBlockout(m)).toEqual([]);

    const overlap: BlockoutModel = { ...m, solids: [...m.solids, { kind: 'wall', rect: { x0: 0.95, y0: 0.05, x1: 1.2, y1: 0.2 }, z0: 0, z1: 1 }] };
    expect(validateBlockout(overlap).some((s) => s.startsWith('Пересекаются объёмы'))).toBe(true);

    // убрать стену, примыкающую к левому краю пола A
    const leftWall = m.solids.findIndex((s) => s.kind === 'wall' && s.rect.x1 === 0 && s.rect.y0 <= 0.5 && s.rect.y1 >= 0.5);
    expect(leftWall).toBeGreaterThanOrEqual(0);
    const leak: BlockoutModel = { ...m, solids: m.solids.filter((_, i) => i !== leftWall) };
    expect(validateBlockout(leak).some((s) => /Край пола A .* открыт наружу/.test(s))).toBe(true);

    const blocked: BlockoutModel = { ...m, solids: [...m.solids.filter((s) => s.kind !== 'lintel'), { kind: 'wall', rect: { ...m.openings[0].rect }, z0: -0.2, z1: 2.7 }] };
    expect(validateBlockout(blocked).some((s) => /Проём A\/a1 ↔ B\/b1 перекрыт/.test(s))).toBe(true);

    // облицовка: сдвинута с грани, пропала, легла поперёк проёма, задвоилась
    const k = m.faces.findIndex((f) => f.inst === 'A' && f.part === 'wall' && f.normal[0] === 1); // западная стена A
    const shifted: BlockoutModel = { ...m, faces: m.faces.map((f, i) => (i === k ? { ...f, line: [0.05, 1, 0.05, 0] } : f)) };
    expect(validateBlockout(shifted).some((s) => /Облицовка A .* не лежит на грани твёрдого объёма/.test(s))).toBe(true);
    const missing: BlockoutModel = { ...m, faces: m.faces.filter((_, i) => i !== k) };
    const mv = validateBlockout(missing);
    expect(mv.some((s) => /Край пола A .* закрыт стеной, но без облицовки/.test(s))).toBe(true);
    expect(mv.some((s) => /Облицовка комнаты A: длина 2\.6 м, а закрытый периметр пола 3\.6 м/.test(s))).toBe(true);
    const across: BlockoutModel = { ...m, faces: [...m.faces, { inst: 'A', line: [1, 0.3, 1, 0.7], normal: [-1, 0], z0: 0, z1: 2.5, part: 'wall', finish: null }] };
    expect(validateBlockout(across).some((s) => /висит над проёмом ниже двери/.test(s))).toBe(true);
    const dup: BlockoutModel = { ...m, faces: [...m.faces, { ...m.faces[k] }] };
    expect(validateBlockout(dup).some((s) => /Облицовки A накладываются/.test(s))).toBe(true);

    // gap 0 без перегородки
    const m0 = buildBlockoutModel(pair(0));
    const noPart: BlockoutModel = { ...m0, solids: m0.solids.filter((s) => s.kind !== 'partition') };
    expect(validateBlockout(noPart).some((s) => /Полы A и B соприкасаются .* без перегородки/.test(s))).toBe(true);
  });
});

// ───────────────────────── реальные прогоны ─────────────────────────

const fixtures = import.meta.glob<RunExport>('./fixtures/*.json', { eager: true, import: 'default' });

describe('blockout: фикстуры реальных прогонов', () => {
  it('найдены все 4 фикстуры', () => {
    expect(Object.keys(fixtures).length).toBe(4);
  });

  for (const [path, run] of Object.entries(fixtures)) {
    const name = path.replace(/^.*\//, '').replace('.json', '');
    it(`${name}: модель чистая, проблем входа нет`, () => {
      buildBlockoutModel(run); // прогрев JIT
      const m = buildBlockoutModel(run);
      const errs = validateBlockout(m);
      const kinds: Record<string, number> = {};
      for (const s of m.solids) kinds[s.kind] = (kinds[s.kind] ?? 0) + 1;
      console.log(`[blockout] ${name}: rooms ${m.rooms.length}, solids ${m.solids.length} ${JSON.stringify(kinds)}, `
        + `floorRects ${m.floors.reduce((a, f) => a + f.rects.length, 0)}, openings ${m.openings.length}, deadEnds ${m.deadEnds.length}, `
        + `props ${m.props.length}, ${m.stats.ms} ms, issues ${m.issues.length}, validate ${errs.length}`);
      expect(errs).toEqual([]);
      expect(m.issues).toEqual([]);
      expect(m.openings.length).toBe(run.links.length);
      expect(m.deadEnds.length).toBe(run.openConnectors.length); // двери в фикстурах совпадают с метками
      expect(m.rooms.length).toBe(run.instances.length);
      expect(m.solids.length).toBeLessThan(m.rooms.length * 20);
      // облицовка у каждой комнаты; при gap ≥ 1 над каждым проёмом — по перемычке с обеих сторон
      expect(new Set(m.faces.map((f) => f.inst)).size).toBe(m.floors.filter((f) => f.inst !== null).length);
      if (run.settings.gap >= 1) expect(m.faces.filter((f) => f.part === 'lintel').length).toBe(2 * m.openings.length);
      console.log(`[blockout] ${name}: faces ${m.faces.length} (lintel ${m.faces.filter((f) => f.part === 'lintel').length})`);
      if (name === 'run-gap1-150') {
        // лучший из трёх прогретых запусков — устойчиво к фоновой нагрузке машины
        const best = Math.min(m.stats.ms, buildBlockoutModel(run).stats.ms, buildBlockoutModel(run).stats.ms);
        expect(best).toBeLessThan(300);
      }
      // gap 0 — комнаты вплотную: стены между ними тонкие перегородки
      if (run.settings.gap === 0) expect(m.solids.some((s) => s.kind === 'partition')).toBe(true);
      else expect(m.solids.some((s) => s.kind === 'partition')).toBe(false);
    });
  }

  it('run-gap1-30 с другими опциями (без плит, тупики открыты, обвязка 3) тоже чистая', () => {
    const run = fixtures['./fixtures/run-gap1-30.json'];
    for (const o of [{ slabM: 0, ceilings: false }, { deadEnds: 'open' as const }, { outerWallCells: 3, deadEnds: 'wall' as const }, { fillVoids: false }]) {
      const m = buildBlockoutModel(run, o);
      expect(validateBlockout(m)).toEqual([]);
      expect(m.issues).toEqual([]);
    }
  });
});
