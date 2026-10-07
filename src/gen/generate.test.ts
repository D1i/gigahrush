import { describe, expect, it } from 'vitest';
import type { Project } from '../model/types';
import { generateRun } from './generate';
import { compatible } from './geom';
import { ALL4, checkLinks, checkNoOverlap, countBy, lProject, project, rectRoom, strip } from './fixtures.test-util';
import { runWorld } from './world';

// ───────── фикстуры ─────────

function basic(): Project {
  return project([
    rectRoom('hall', 30, 20, { tags: ['start'], conns: ALL4(8) }),
    rectRoom('small', 20, 20, { conns: ALL4(8), weight: 2 }),
    rectRoom('long', 60, 12, { conns: [['W', 8], ['E', 8], ['N', 8], ['S', 8]] }),
  ]);
}

// ───────── тесты раскладки ─────────

describe('generateRun: раскладка', { timeout: 60000 }, () => {
  it('детерминирован по сиду', () => {
    const p = basic();
    const a = generateRun(p, { seed: 'abc', count: 25 });
    const b = generateRun(p, { seed: 'abc', count: 25 });
    expect(strip(a)).toEqual(strip(b));
    const c = generateRun(p, { seed: 'другой', count: 25 });
    expect(JSON.stringify(c.instances)).not.toEqual(JSON.stringify(a.instances));
  });

  it('не мутирует проект', () => {
    const p = basic();
    const before = JSON.stringify(p, (_k, v) => (v instanceof Set ? [...v] : v));
    generateRun(p, { count: 30 });
    expect(JSON.stringify(p, (_k, v) => (v instanceof Set ? [...v] : v))).toBe(before);
  });

  for (const gap of [0, 1, 3]) {
    it(`без пересечений и связи корректны (gap=${gap})`, () => {
      for (const seed of ['s1', 's2', 's3', 's4']) {
        const p = basic();
        const run = generateRun(p, { seed, count: 30, gap });
        expect(run.instances.length).toBe(30);
        checkNoOverlap(runWorld(p, run), gap);
        checkLinks(p, run);
        expect(run.links.length).toBeGreaterThanOrEqual(run.instances.length - 1);
      }
    });
  }

  it('L-образные комнаты во всех поворотах: без пересечений, связи лицом к лицу', () => {
    const p = lProject();
    const rots = new Set<number>();
    for (let s = 0; s < 10; s++) {
      const run = generateRun(p, { seed: `L${s}`, count: 25 });
      checkNoOverlap(runWorld(p, run), 1);
      checkLinks(p, run);
      run.instances.filter((i) => i.roomId === 'L').forEach((i) => rots.add(i.rot));
    }
    expect(rots.size).toBe(4);
  });

  it('старт: startRoomId, иначе тег start; стартовый экземпляр в (0,0) без поворота', () => {
    const p = basic();
    let run = generateRun(p, { count: 5 });
    expect(run.instances[0]).toMatchObject({ roomId: 'hall', rot: 0, dx: 0, dy: 0, depth: 0, parent: null });
    run = generateRun(p, { count: 5, startRoomId: 'long' });
    expect(run.instances[0].roomId).toBe('long');
  });

  it('петли: режим tag с разной длиной, режим len', () => {
    const p = project([
      rectRoom('a', 20, 20, { tags: ['start'], conns: ALL4(6, 'x') }),
      rectRoom('b', 20, 20, { conns: ALL4(9, 'x') }),
      rectRoom('c', 21, 21, { conns: ALL4(8, 'x') }),
    ]);
    for (const seed of ['t1', 't2', 't3']) {
      let run = generateRun(p, { seed, count: 30, match: 'tag' });
      checkNoOverlap(runWorld(p, run), 1);
      checkLinks(p, run);
      expect(run.links.some((l) => {
        const la = run.instances.find((i) => i.id === l.a.inst)!.roomId;
        const lb = run.instances.find((i) => i.id === l.b.inst)!.roomId;
        return la !== lb;
      })).toBe(true);
      run = generateRun(p, { seed, count: 30, match: 'exact' });
      checkLinks(p, run);
    }
    // в exact комнаты разных длин меток не стыкуются: растёт только 'a'
    const ex = generateRun(p, { count: 10, match: 'exact' });
    expect(new Set(ex.instances.map((i) => i.roomId))).toEqual(new Set(['a']));
    // в len — теги не важны
    const q = project([
      rectRoom('a', 20, 20, { tags: ['start'], conns: ALL4(6, 'x') }),
      rectRoom('b', 20, 20, { conns: ALL4(6, 'y'), weight: 5 }),
    ]);
    const lr = generateRun(q, { count: 20, match: 'len' });
    expect(countBy(lr).get('b')).toBeGreaterThan(0);
    checkLinks(q, lr);
  });

  it('направленные теги: "hall>kitchen" стыкуется с "kitchen>hall", но не с "hall>kitchen"', () => {
    expect(compatible({ tag: 'hall>kitchen', len: 8 }, { tag: 'kitchen>hall', len: 8 }, 'exact')).toBe(true);
    expect(compatible({ tag: 'hall>kitchen', len: 8 }, { tag: 'hall>kitchen', len: 8 }, 'exact')).toBe(false);
    expect(compatible({ tag: 'hall>kitchen', len: 8 }, { tag: 'hall>kitchen', len: 8 }, 'tag')).toBe(false);
    expect(compatible({ tag: 'hall>kitchen', len: 8 }, { tag: 'kitchen>hall', len: 6 }, 'tag')).toBe(true);
    expect(compatible({ tag: 'hall>kitchen', len: 8 }, { tag: 'kitchen>hall', len: 6 }, 'exact')).toBe(false);
    expect(compatible({ tag: 'hall>kitchen', len: 8 }, { tag: 'hall>kitchen', len: 8 }, 'len')).toBe(true);
    expect(compatible({ tag: 'stair', len: 8 }, { tag: 'stair', len: 8 }, 'exact')).toBe(true);
    expect(compatible({ tag: 'stair', len: 8 }, { tag: 'stair>x', len: 8 }, 'exact')).toBe(false);

    const p = project([
      rectRoom('hall', 20, 20, { tags: ['start'], conns: ALL4(8, 'hall>kitchen') }),
      rectRoom('kitchen', 16, 16, { conns: ALL4(8, 'kitchen>hall') }),
    ]);
    for (const seed of ['d1', 'd2', 'd3']) {
      const run = generateRun(p, { seed, count: 30 });
      expect(run.instances.length).toBeGreaterThan(5);
      checkNoOverlap(runWorld(p, run), 1);
      checkLinks(p, run);
      const room = new Map(run.instances.map((i) => [i.id, i.roomId]));
      for (const l of run.links) expect(new Set([room.get(l.a.inst), room.get(l.b.inst)])).toEqual(new Set(['hall', 'kitchen']));
    }
  });

  it('петли замыкаются: сетка одинаковых квадратов даёт связей больше, чем деревьев', () => {
    const p = project([rectRoom('q', 20, 20, { conns: ALL4(6) })]);
    const run = generateRun(p, { count: 40 });
    checkLinks(p, run);
    expect(run.links.length).toBeGreaterThan(run.instances.length - 1);
  });

  it('min / max / unique', () => {
    const p = project([
      rectRoom('hub', 30, 30, { tags: ['start'], conns: ALL4(8), weight: 1 }),
      rectRoom('rare', 20, 20, { conns: ALL4(8), weight: 0.001, min: 4 }),
      rectRoom('zero', 20, 20, { conns: ALL4(8), weight: 0, min: 2 }),
      rectRoom('capped', 20, 20, { conns: ALL4(8), weight: 1000, max: 3 }),
      rectRoom('uniq', 20, 20, { conns: ALL4(8), weight: 1000, unique: true, max: 50 }),
      rectRoom('never', 20, 20, { conns: ALL4(8), weight: 0 }),
    ]);
    for (const seed of ['m1', 'm2', 'm3', 'm4', 'm5']) {
      const run = generateRun(p, { seed, count: 40 });
      const c = countBy(run);
      expect(c.get('rare') ?? 0).toBeGreaterThanOrEqual(4);
      expect(c.get('zero')).toBe(2); // вес 0: ровно min
      expect(c.get('capped')).toBe(3);
      expect(c.get('uniq')).toBe(1);
      expect(c.get('never') ?? 0).toBe(0);
      expect(run.warnings).toEqual([]);
    }
  });

  it('предупреждения: min не набран, count не достигнут', () => {
    const p = project([
      rectRoom('solo', 20, 20, { tags: ['start'], weight: 0, conns: [['N', 8]] }),
      rectRoom('need', 20, 20, { min: 2, conns: [['S', 8, 'другой']] }),
    ]);
    const run = generateRun(p, { count: 10 });
    expect(run.instances.length).toBe(1);
    expect(run.warnings.some((w) => w.includes('из 10'))).toBe(true);
    expect(run.warnings.some((w) => w.includes('минимума 2'))).toBe(true);
    expect(run.openConnectors).toEqual([{ inst: 'i0', connector: 'solo_c0' }]);
  });

  it('пустой проект — пустой прогон с предупреждением', () => {
    const run = generateRun(project([]));
    expect(run.instances).toEqual([]);
    expect(run.warnings.length).toBe(1);
  });
});

// ───────── наполнение ─────────
