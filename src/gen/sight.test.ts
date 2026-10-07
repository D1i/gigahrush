import { describe, expect, it } from 'vitest';
import { hashSeed } from '../model/rng';
import type { Connector, Side } from '../model/types';
import { generateRun } from './generate';
import { ALL4, checkLinks, checkNoOverlap, hrushLike, lProject, project, rectRoom } from './fixtures.test-util';
import { scanSight } from './sight';
import { exportRunJSON, runWorld } from './world';

const c = (id: string, side: Side, len: number, tag: string, cx: number, cy: number): Connector =>
  ({ id, name: id, tag, cx, cy, side, len });

const cells = (list: [number, number][], owners?: number[]) => ({
  xs: list.map((p) => p[0]),
  ys: list.map((p) => p[1]),
  owners: owners ?? list.map(() => 0),
});

function basic() {
  return project([
    rectRoom('hall', 30, 20, { tags: ['start'], conns: ALL4(8) }),
    rectRoom('small', 20, 20, { conns: ALL4(8), weight: 2 }),
    rectRoom('long', 60, 12, { conns: [['W', 8], ['E', 8], ['N', 8], ['S', 8]] }),
  ]);
}

/** Прямая секция коридора 1 × 4 м (метки на торцах) и угловая секция 1 × 1 м. */
function corridors() {
  const straight = rectRoom('straight', 10, 40, { tags: ['start'], weight: 5 });
  straight.connectors = [c('n', 'N', 8, 'c', 1, 0), c('s', 'S', 8, 'c', 1, 39)];
  const corner = rectRoom('corner', 10, 10, { weight: 1 });
  corner.connectors = [c('n', 'N', 8, 'c', 1, 0), c('e', 'E', 8, 'c', 9, 1)];
  return project([straight, corner]);
}

describe('предел дальности обзора', { timeout: 60000 }, () => {
  it('sightM = 0: снимок раскладки (регрессия; обновлён после адаптивного резерва роста)', () => {
    // хэши [instances, links, openConnectors]; снимок обновлён вместе с алгоритмом роста (§4.5 GENERATOR.md)
    const expected: [string, string, number, number][] = [
      ['basic', 'b1', 30, 261300491],
      ['basic', 'b2', 30, 2484658588],
      ['basic', 'b3', 30, 3831530196],
      ['L', 'b1', 25, 3490309403],
      ['L', 'b2', 25, 371789271],
      ['L', 'b3', 25, 1112327574],
      ['hrush', 'b1', 40, 2941187117],
      ['hrush', 'b2', 40, 128585726],
      ['hrush', 'b3', 40, 931429012],
    ];
    const projects = { basic: basic(), L: lProject(), hrush: hrushLike() } as const;
    for (const [name, seed, count, hash] of expected) {
      const r = generateRun(projects[name as keyof typeof projects], { seed, count, sightM: 0 });
      expect(hashSeed(JSON.stringify([r.instances, r.links, r.openConnectors])), `${name}/${seed}`).toBe(hash);
    }
  });

  it('линия проходит сквозь проём двух соосных комнат', () => {
    const a = rectRoom('a', 10, 10, { tags: ['start'] });
    a.connectors = [c('e', 'E', 4, 'd', 9, 3)];
    const b = rectRoom('b', 10, 10, { weight: 1 });
    b.connectors = [c('w', 'W', 4, 'd', 0, 3)];
    b.gen.max = 1;
    const run = generateRun(project([a, b]), { count: 2 });
    expect(run.instances.length).toBe(2);
    expect(run.sight.maxM).toBeCloseTo(2.1, 6); // 10 + 1 (проём) + 10 клеток
    expect(run.sight.line).toEqual([0, 3.5, 21, 3.5]);
    // тот же предел, но 2 м — вторая комната не ставится
    const lim = generateRun(project([a, b]), { count: 2, sightM: 2 });
    expect(lim.instances.length).toBe(1);
    expect(lim.sight.maxM).toBeCloseTo(1.414, 3); // диагональ 10×10
  });

  it('несвязанная стена обзор не пропускает; диагональ сквозь угол не проходит', () => {
    // две комнаты 10 клеток в ряд через стену в 1 клетку без проёма
    const row: [number, number][] = [];
    for (let x = 0; x < 10; x++) row.push([x, 0]);
    for (let x = 11; x < 21; x++) row.push([x, 0]);
    expect(scanSight(cells(row, row.map((p) => (p[0] < 10 ? 0 : 1))), new Set(), 0.1).maxM).toBeCloseTo(1, 6);
    // касание по диагонали — не линия: максимум — одна клетка по диагонали (√2·0.1), а не две
    expect(scanSight(cells([[0, 0], [1, 1]]), new Set(), 0.1).maxM).toBeCloseTo(0.141, 3);
    // «Г» из трёх клеток: диагональ (0,0)→(1,1) требует и (0,1), и (1,0)
    expect(scanSight(cells([[0, 0], [1, 0], [1, 1]]), new Set(), 0.1).maxM).toBeCloseTo(0.2, 6);
    // полный квадрат 2×2 — диагональ разрешена: 2·√2·0.1
    const sq = scanSight(cells([[0, 0], [1, 0], [0, 1], [1, 1]]), new Set(), 0.1);
    expect(sq.maxM).toBeCloseTo(0.283, 3);
    expect(sq.line).toEqual([0, 0, 2, 2]);
  });

  it('прямой коридор из секций с пределом 6 м не собирается в прямую длиннее 6 м', () => {
    const p = corridors();
    const free = generateRun(p, { seed: 'k1', count: 12 });
    expect(free.sight.maxM).toBeGreaterThan(6); // без предела секции встают в линию
    for (const seed of ['k1', 'k2', 'k3', 'k4', 'k5']) {
      const run = generateRun(p, { seed, count: 12, sightM: 6 });
      expect(run.sight.maxM).toBeLessThanOrEqual(6);
      checkNoOverlap(runWorld(p, run), 1);
      checkLinks(p, run);
      // две прямые секции подряд соосно не стыкуются
      const byId = new Map(run.instances.map((i) => [i.id, i]));
      for (const l of run.links) {
        const ia = byId.get(l.a.inst)!, ib = byId.get(l.b.inst)!;
        if (ia.roomId === 'straight' && ib.roomId === 'straight') throw new Error('две прямые секции подряд');
      }
      expect(run.instances.some((i) => i.roomId === 'corner')).toBe(true);
    }
  });

  it('инкрементальная проверка согласована с полным сканом (включая петли) при gap 0, 1, 2', () => {
    const grid = project([rectRoom('q', 20, 20, { conns: ALL4(6) })]);
    for (const gap of [0, 1, 2]) {
      for (const [p, lim] of [[basic(), 5], [lProject(), 4], [hrushLike(), 5], [grid, 3.5]] as const) {
        for (const seed of ['x1', 'x2', 'x3']) {
          const run = generateRun(p, { seed, count: 30, gap, sightM: lim });
          expect(run.sight.maxM, `gap ${gap} seed ${seed}`).toBeLessThanOrEqual(lim + 1e-9);
          checkNoOverlap(runWorld(p, run), gap);
          checkLinks(p, run);
        }
      }
    }
  });

  it('комнаты длиннее предела исключаются из пула (warning); стартовая ставится с предупреждением', () => {
    const p = project([
      rectRoom('hall', 30, 20, { tags: ['start'], conns: ALL4(8) }),
      rectRoom('small', 20, 20, { conns: ALL4(8) }),
      rectRoom('long', 60, 12, { conns: [['W', 8], ['E', 8], ['N', 8], ['S', 8]] }),
    ]);
    const run = generateRun(p, { count: 10, sightM: 3.5 });
    expect(run.instances.every((i) => i.roomId !== 'long')).toBe(true);
    expect(run.warnings.some((w) => w.includes('«Комната long» (6 м)'))).toBe(true);
    expect(run.warnings.some((w) => w.startsWith('Стартовая комната «Комната hall»'))).toBe(false);
    const run2 = generateRun(p, { count: 10, sightM: 2.5, startRoomId: 'long' });
    expect(run2.instances[0].roomId).toBe('long');
    expect(run2.warnings.some((w) => w.startsWith('Стартовая комната «Комната long» сама длиннее'))).toBe(true);
  });

  it('sight детерминирован и попадает в экспорт', () => {
    const p = hrushLike();
    const a = generateRun(p, { seed: 'z', count: 30, sightM: 5 });
    const b = generateRun(p, { seed: 'z', count: 30, sightM: 5 });
    expect(a.sight).toEqual(b.sight);
    expect(a.sight.line).not.toBeNull();
    expect((exportRunJSON(p, a) as { sight: unknown }).sight).toEqual(a.sight);
  });
});
