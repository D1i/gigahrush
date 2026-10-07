// Подпрогоны на фикстурах (без зависимостей от приложения — переносится вместе с папкой).
import { describe, expect, it } from 'vitest';
import { buildBlockoutModel, validateBlockout } from './core';
import { isFoldRun, layerRun, layersOf, linkBetween, overlapIds, subRun, visibleIds } from './subrun';
import type { RunExport } from './types';
import gap1 from './fixtures/run-gap1-30.json';

describe('subRun на фикстуре', () => {
  // глубокая копия: тесты не должны делить объект импорта с другими файлами
  const run = JSON.parse(JSON.stringify(gap1)) as unknown as RunExport;

  it('экземпляры из набора, связи внутри, метки наружу — тупики, openConnectors пересчитаны', () => {
    const ids = new Set(['i0', 'i1', 'i2']);
    const before = JSON.stringify(run);
    const sub = subRun(run, ids);
    expect(JSON.stringify(run)).toBe(before); // вход не мутирован
    expect(sub.instances.map((i) => i.id)).toEqual(['i0', 'i1', 'i2']);
    for (const l of sub.links) expect(ids.has(l.a.inst) && ids.has(l.b.inst)).toBe(true);
    expect(sub.links.length).toBe(run.links.filter((l) => ids.has(l.a.inst) && ids.has(l.b.inst)).length);
    const linked = new Set(sub.links.flatMap((l) => [`${l.a.inst}/${l.a.connector}`, `${l.b.inst}/${l.b.connector}`]));
    const open = new Set(sub.openConnectors.map((o) => `${o.inst}/${o.connector}`));
    for (const inst of sub.instances) {
      for (const k of inst.connectors) {
        const key = `${inst.id}/${k.id}`;
        if (k.linkedTo) {
          expect(ids.has(k.linkedTo.inst)).toBe(true);
          expect(linked.has(key)).toBe(true);
        } else if (k.len >= 1) expect(open.has(key)).toBe(true);
        expect(linked.has(key) && open.has(key)).toBe(false);
      }
    }
    // i0 — c3 вёл в i5, c4 в i8: теперь тупики
    const i0 = sub.instances[0];
    expect(i0.connectors.find((k) => k.id === 'landing_1464_c3')!.linkedTo).toBeNull();
    expect(i0.connectors.find((k) => k.id === 'landing_1464_c1')!.linkedTo).toEqual({ inst: 'i1', connector: expect.any(String) });
  });

  it('весь набор — тот же прогон по связям и тупикам', () => {
    const sub = subRun(run, run.instances.map((i) => i.id));
    expect(sub.links).toEqual(run.links);
    expect(new Set(sub.openConnectors.map((o) => `${o.inst}/${o.connector}`))).toEqual(new Set(run.openConnectors.map((o) => `${o.inst}/${o.connector}`)));
  });

  it('видимое множество по связям; болванка подпрогона чистая', () => {
    const adj = new Map<string, Set<string>>();
    for (const l of run.links) {
      adj.set(l.a.inst, (adj.get(l.a.inst) ?? new Set()).add(l.b.inst));
      adj.set(l.b.inst, (adj.get(l.b.inst) ?? new Set()).add(l.a.inst));
    }
    for (const inst of run.instances) {
      const v = visibleIds(run, inst.id, 1);
      expect(v).toEqual(new Set([inst.id, ...(adj.get(inst.id) ?? [])]));
      const m = buildBlockoutModel(subRun(run, v));
      expect(validateBlockout(m)).toEqual([]);
      expect(m.rooms.length).toBe(v.size);
    }
    expect(visibleIds(run, 'нет', 1).size).toBe(0);
    expect(visibleIds(run, 'i0', 0)).toEqual(new Set(['i0']));
  });

  it('евклидов прогон: не складчатый, один слой, пересечений нет', () => {
    expect(isFoldRun(run)).toBe(false);
    expect(layersOf(run)).toEqual([0]);
    expect(layerRun(run, 0).instances.length).toBe(run.instances.length);
    expect(layerRun(run, 1).instances.length).toBe(0);
    for (const i of run.instances.slice(0, 10)) expect(overlapIds(run, i.id)).toEqual([]);
    const l = run.links[0];
    expect(linkBetween(run, l.a.inst, l.b.inst)?.dw).toBe(0);
    expect(linkBetween(run, l.b.inst, l.a.inst)?.link).toBe(l);
  });

  it('overlapIds видит наложение по клеткам с зазором', () => {
    // копия i1, сдвинутая к i0 вплотную, и копия i0 со сдвигом W
    const i0 = run.instances[0];
    const ghost = { ...i0, id: 'g', w: 3 };
    const r2: RunExport = { ...run, instances: [...run.instances, ghost] };
    expect(overlapIds(r2, 'g')).toContain('i0');
    expect(overlapIds(r2, 'i0')).toContain('g');
    expect(isFoldRun(r2)).toBe(true);
  });
});
