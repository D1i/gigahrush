import { describe, expect, it } from 'vitest';
import type { Room } from '../model/types';
import { generateRun } from './generate';
import { ALL4, checkLinks, checkNoOverlap, lRoom, project, rectRoom } from './fixtures.test-util';
import { runWorld } from './world';

// ───────── производительность ─────────

describe('generateRun: скорость', { timeout: 60000 }, () => {
  it('count=60, комнаты 500–4000 клеток — < 300 мс', () => {
    const rooms: Room[] = [
      rectRoom('p500', 25, 20, { tags: ['start'], conns: ALL4(10) }),
      rectRoom('p1200', 40, 30, { conns: ALL4(10) }),
      rectRoom('p2000', 50, 40, { conns: ALL4(10) }),
      rectRoom('p4000', 80, 50, { conns: ALL4(10) }),
      rectRoom('p3600', 60, 60, { conns: ALL4(10) }),
      rectRoom('corr', 100, 12, { conns: [['W', 10], ['E', 10], ['N', 10], ['S', 10]] }),
    ];
    const big = lRoom('Lbig', [
      { id: 'a', name: 'a', tag: 'door', cx: 10, cy: 0, side: 'N', len: 10 },
      { id: 'b', name: 'b', tag: 'door', cx: 29, cy: 1, side: 'E', len: 10 },
      { id: 'c', name: 'c', tag: 'door', cx: 1, cy: 29, side: 'S', len: 10 },
      { id: 'd', name: 'd', tag: 'door', cx: 0, cy: 10, side: 'W', len: 10 },
    ]);
    rooms.push(big);
    for (const r of rooms) expect(r.cells.size).toBeGreaterThanOrEqual(500);
    const p = project(rooms);
    generateRun(p, { seed: 'warm', count: 60 }); // прогрев JIT
    const times: number[] = [];
    for (let i = 0; i < 10; i++) {
      const t = performance.now();
      const run = generateRun(p, { seed: `perf${i}`, count: 60 });
      times.push(performance.now() - t);
      expect(run.instances.length).toBe(60);
      if (i === 0) {
        checkNoOverlap(runWorld(p, run), 1);
        checkLinks(p, run);
      }
    }
    const max = Math.max(...times);
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    console.log(`[perf] count=60: среднее ${avg.toFixed(1)} мс, максимум ${max.toFixed(1)} мс`);
    expect(max).toBeLessThan(300);
  });
});
