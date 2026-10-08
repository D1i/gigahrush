import { describe, expect, it } from 'vitest';
import {
  collapseSite, createCollapse, collapseRule, digCollapse, normCollapse, postponeCollapse, startCollapse, stepCollapse, DEFAULT_COLLAPSE,
  type CollapseEvent, type CollapseSite,
} from './snowCollapse';

const S = DEFAULT_COLLAPSE;
const site: CollapseSite = { inst: 'i5', connector: 'c2', x: 10, y: 4 };
const crawl = (s: ReturnType<typeof createCollapse>, m: number) => {
  const ev: CollapseEvent[] = [];
  for (let k = 0; k < m * 10; k++) ev.push(...stepCollapse(S, s, 0.1, 0.1, { x: 0, y: 0 }));
  return ev;
};

describe('обвал в снежных ходах', () => {
  it('порог — по метрам ползком, детерминированно по сиду', () => {
    const a = createCollapse(S, 'мир'), b = createCollapse(S, 'мир'), c = createCollapse(S, 'другой');
    expect(a.next).toBe(b.next);
    expect(a.next).not.toBe(c.next);
    expect(a.next).toBeGreaterThanOrEqual(S.everyM[0]);
    expect(a.next).toBeLessThanOrEqual(S.everyM[1]);
    // стоя (0 м) — обвала нет никогда
    for (let k = 0; k < 1000; k++) expect(stepCollapse(S, a, 0.1, 0, { x: 0, y: 0 })).toEqual([]);
    const ev = crawl(a, Math.ceil(a.next) + 1);
    expect(ev.some((e) => e.type === 'due')).toBe(true);
  });

  it('успел уползти — ход завален, игрок свободен, следующий порог дальше', () => {
    const s = createCollapse(S, 'x');
    crawl(s, Math.ceil(s.next) + 1);
    expect(startCollapse(S, s, site)[0]).toMatchObject({ type: 'crack', warnS: S.warnS });
    const ev: CollapseEvent[] = [];
    for (let t = 0; t < S.warnS + 0.2; t += 0.1) ev.push(...stepCollapse(S, s, 0.1, 0, { x: 12, y: 4 }));
    expect(ev.filter((e) => e.type === 'crumbs').length).toBeGreaterThan(10);
    expect(ev.find((e) => e.type === 'fall')).toMatchObject({ buried: false });
    expect(s.phase).toBe('calm');
    expect(s.next).toBeGreaterThan(s.crawled + S.everyM[0] - 1e-9);
  });

  it('не успел — засыпало; откапывается сам за digSelf нажатий, с напарником — быстрее', () => {
    const s = createCollapse(S, 'y');
    crawl(s, Math.ceil(s.next) + 1);
    startCollapse(S, s, site);
    const ev: CollapseEvent[] = [];
    for (let t = 0; t < S.warnS + 0.2; t += 0.1) ev.push(...stepCollapse(S, s, 0.1, 0, { x: 10.3, y: 4.2 }));
    expect(ev.find((e) => e.type === 'fall')).toMatchObject({ buried: true });
    expect(s.phase).toBe('buried');
    for (let k = 1; k < S.digSelf; k++) expect(digCollapse(S, s, 'self').some((e) => e.type === 'freed')).toBe(false);
    expect(digCollapse(S, s, 'self').some((e) => e.type === 'freed')).toBe(true);
    expect(s.phase).toBe('calm');
    // напарник
    crawl(s, Math.ceil(s.next - s.crawled) + 1);
    startCollapse(S, s, site);
    for (let t = 0; t < S.warnS + 0.2; t += 0.1) stepCollapse(S, s, 0.1, 0, { x: 10, y: 4 });
    let n = 0;
    while (s.phase === 'buried') {
      digCollapse(S, s, 'mate');
      n++;
    }
    expect(n).toBe(S.digMate);
  });

  it('места нет — отсрочка; разбор и правило', () => {
    const s = createCollapse(S, 'z');
    crawl(s, Math.ceil(s.next) + 1);
    postponeCollapse(S, s);
    expect(s.next).toBeCloseTo(s.crawled + S.retryM);
    expect(normCollapse({ everyM: [90, 10], warnS: -1, digSelf: 3.4 })).toMatchObject({ everyM: [10, 90], warnS: 0.3, digSelf: 3 });
    expect(normCollapse('мусор')).toEqual(DEFAULT_COLLAPSE);
    expect(collapseRule()).toContain('2 с');
  });
});

describe('место обвала', () => {
  const C = (id: string, side: 'N' | 'S' | 'E' | 'W', line: [number, number, number, number], to: string | null, cut = false) =>
    ({ id, side, len: 12, line, linkedTo: to ? { inst: to.split('/')[0], connector: to.split('/')[1] } : null, ...(cut ? { cut } : {}) });
  // a — b — c, у c нераскрытый проём; у b — тупиковая берлога d
  const run = {
    cellM: 0.1,
    instances: [
      { id: 'a', roomTags: ['снег', 'ход'], connectors: [C('n', 'N', [0, 0, 12, 0], null), C('s', 'S', [0, 30, 12, 30], 'b/n')] },
      { id: 'b', roomTags: ['снег', 'ход'], connectors: [C('n', 'N', [0, 31, 12, 31], 'a/s'), C('s', 'S', [0, 61, 12, 61], 'c/n'), C('w', 'W', [0, 40, 0, 52], 'd/e')] },
      { id: 'c', roomTags: ['снег', 'ход'], connectors: [C('n', 'N', [0, 62, 12, 62], 'b/s'), C('s', 'S', [0, 92, 12, 92], null, true)] },
      { id: 'd', roomTags: ['снег', 'берлога'], connectors: [C('e', 'E', [-1, 40, -1, 52], 'b/w')] },
    ],
  };
  it('ближайший проём, если завал не запирает; в берлоге — нет', () => {
    // игрок в b у южного проёма: завал там отрезал бы путь к c (нераскрытый проём) — берётся следующий ближайший
    const s = collapseSite(run, 'b', 0.6, 5.9);
    expect(s).not.toBeNull();
    expect(s!.connector).not.toBe('s');
    // в c: северный проём завалить можно (впереди — нераскрытый)
    expect(collapseSite(run, 'c', 0.6, 6.4)?.connector).toBe('n');
    expect(collapseSite(run, 'd', -0.5, 4.6)).toBeNull();
  });
  it('в тупике без выхода к нераскрытому — места нет', () => {
    expect(collapseSite(run, 'a', 0.6, 2.9)).toBeNull();
  });
});
