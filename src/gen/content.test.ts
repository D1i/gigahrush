import { describe, expect, it } from 'vitest';
import { makeRng } from '../model/rng';
import { generateRun, rollContent } from './generate';
import { contentProject, ok } from './fixtures.test-util';
import { stepsStats } from './rules';

describe('generateRun: наполнение', { timeout: 60000 }, () => {
  const N = 5000;

  it('варианты группы выпадают с частотой w/Σw; споты группы заполняются по варианту', () => {
    const p = contentProject();
    const freq: Record<string, number> = { v1: 0, v2: 0, v3: 0 };
    for (let i = 0; i < N; i++) {
      const run = generateRun(p, { seed: `g${i}`, count: 1 });
      const c = run.content[0];
      ok(c.groups.length === 1, 'groups');
      const v = c.groups[0].variantId;
      freq[v]++;
      ok(c.spots.map((s) => s.spotId).join() === 's1,s2', 'spots'); // s3 без группы не участвует
      if (v === 'v3') ok(c.spots.every((s) => s.content === null), 'v3 пуст');
      if (v === 'v1') ok(c.spots[1].content === null, 'v1: s2 пуст');
    }
    const exp = { v1: 0.1, v2: 0.2, v3: 0.7 };
    for (const k of Object.keys(exp) as (keyof typeof exp)[]) {
      const sd = Math.sqrt((exp[k] * (1 - exp[k])) / N);
      expect(Math.abs(freq[k] / N - exp[k])).toBeLessThan(4 * sd);
    }
  });

  it('тир по весам; проходка умножает веса тиров level ≥ 2; опасность копится по дереву', () => {
    const p = contentProject();
    let elite = 0, eliteP = 0;
    for (let i = 0; i < N; i++) {
      if (generateRun(p, { seed: `e${i}`, count: 1 }).content[0].tierId === 't2') elite++;
      if (generateRun(p, { seed: `e${i}`, count: 1, passId: 'pass' }).content[0].tierId === 't2') eliteP++;
    }
    const sd = (q: number) => Math.sqrt((q * (1 - q)) / N);
    expect(Math.abs(elite / N - 0.25)).toBeLessThan(4 * sd(0.25));
    expect(Math.abs(eliteP / N - 0.5)).toBeLessThan(4 * sd(0.5)); // 1·3 / (3 + 1·3)

    const q = contentProject();
    q.rooms[0].connectors = [
      { id: 'n', name: 'n', tag: 'd', cx: 6, cy: 0, side: 'N', len: 8 },
      { id: 's', name: 's', tag: 'd', cx: 6, cy: 19, side: 'S', len: 8 },
    ];
    const run = generateRun(q, { count: 8 });
    const acc = new Map(run.content.map((c) => [c.inst, c]));
    for (const inst of run.instances) {
      const c = acc.get(inst.id)!;
      const parentAcc = inst.parent ? acc.get(inst.parent)!.dangerAcc : 0;
      expect(c.dangerAcc).toBe(parentAcc + c.danger);
      expect(c.danger).toBe(c.tierId === 't2' ? 50 : 5);
    }
  });

  it('ступени лута тира соответствуют stepsStats; where и магазин', () => {
    const p = contentProject();
    p.rooms[0].elite = [{ tierId: 't2', weight: 1 }];
    const steps = p.economy.tiers[1].loot[0].steps;
    const st = stepsStats(steps);
    let any = 0, sum = 0, samInSideboard = 0, sideboardRuns = 0, shopHits = 0;
    const M = 10000;
    for (let i = 0; i < M; i++) {
      const run = generateRun(p, { seed: `l${i}`, count: 1 });
      const c = run.content[0];
      const r1 = c.loot.find((l) => l.rowId === 'r1');
      if (r1) {
        any++;
        sum += r1.count;
        ok(r1.count >= 1 && r1.count <= 30, `count ${r1.count}`);
      }
      // r4: декора «холодильник» нет — строка не разыгрывается никогда
      ok(!c.loot.some((l) => l.rowId === 'r4'), 'r4 без декора');
      // r2: сервант есть только если выпал вариант v1 (prop на споте s1)
      const hasSideboard = c.spots.some((s) => s.content?.kind === 'prop' && s.content.id === 'sideboard');
      const r2 = c.loot.find((l) => l.rowId === 'r2');
      if (!hasSideboard) ok(r2 === undefined, 'r2 без серванта');
      else {
        sideboardRuns++;
        if (r2) { samInSideboard++; ok(r2.decorId === 'spot:s1', 'r2.decorId'); }
      }
      // r3: всегда есть шкаф d1 (фиксированный декор)
      const r3 = c.loot.find((l) => l.rowId === 'r3');
      if (r3) {
        shopHits++;
        ok(r3.decorId === 'd1' && r3.shopId === 'el' && ['drill', 'tape'].includes(r3.itemId), 'r3');
      }
      // totals
      const t: Record<string, number> = {};
      for (const l of c.loot) t[l.itemId] = (t[l.itemId] ?? 0) + l.count;
      for (const s of c.spots) if (s.content?.kind === 'item') t[s.content.id] = (t[s.content.id] ?? 0) + 1;
      ok(JSON.stringify(run.totals) === JSON.stringify(t), 'totals');
    }
    const pAny = any / M;
    expect(Math.abs(pAny - st.pAny)).toBeLessThan(4 * Math.sqrt((st.pAny * (1 - st.pAny)) / M));
    expect(Math.abs(sum / M - st.mean)).toBeLessThan(0.4); // mean ≈ 0.4·15.5 + 0.6·0.3·3 = 6.74
    expect(st.pAny).toBeCloseTo(1 - 0.6 * 0.7, 10);
    expect(st.mean).toBeCloseTo(0.4 * 15.5 + 0.6 * 0.3 * 3, 10);
    expect(Math.abs(samInSideboard / sideboardRuns - 0.5)).toBeLessThan(0.1);
    expect(Math.abs(shopHits / M - 0.5)).toBeLessThan(0.03);
  });

  it('проходка: itemBoost множит шанс (cap 1)', () => {
    const p = contentProject();
    p.rooms[0].elite = [{ tierId: 't2', weight: 1 }];
    let hits = 0, runs = 0;
    for (let i = 0; i < 3000; i++) {
      const c = generateRun(p, { seed: `b${i}`, count: 1, passId: 'pass' }).content[0];
      if (c.groups[0].variantId !== 'v1') continue;
      runs++;
      if (c.loot.some((l) => l.rowId === 'r2')) hits++;
    }
    expect(hits).toBe(runs); // 0.5 × 2 = 1
  });

  it('мировые позиции и поворот спотов', () => {
    const p = contentProject();
    const inst = { id: 'i0', roomId: 'room', rot: 90 as const, dx: 100, dy: 50, order: 0, parent: null, depth: 0 };
    for (let i = 0; i < 50; i++) {
      const c = rollContent(p, p.rooms[0], inst, makeRng(`w${i}`), null);
      const s1 = c.spots.find((s) => s.spotId === 's1')!;
      expect([s1.x, s1.y]).toEqual([-3.5 + 100, 2.5 + 50]);
      expect(s1.rot).toBe((90 + 90 + (s1.content?.rot ?? 0)) % 360);
    }
  });
});
