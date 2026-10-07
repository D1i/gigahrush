// Подпрогоны складчатого (4D) прогона: болванка видимого множества каждой комнаты и каждого слоя —
// чистая (validateBlockout пуст). Прогон генерируется приложением — этот тест в прототип игры не
// переносится (в отличие от subrun.test.ts).
import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '../data/presets';
import { exportRunJSON } from '../gen/world';
import { generateFoldRun, overlapPairs, visibleSet } from '../gen4d/fold';
import type { Project } from '../model/types';
import { buildBlockoutModel, validateBlockout } from './core';
import { hasPvs, isFoldRun, layerRun, layersOf, linkBetween, overlapIds, pvsIds, safeDepth, subRun, visibleIds } from './subrun';
import type { RunExport } from './types';

function presets(): Project {
  const p = createDefaultProject();
  p.finishes ??= [];
  p.finishRules ??= [];
  return p;
}

describe('складчатый прогон по частям', { timeout: 180000 }, () => {
  const p = presets();
  const cases = [
    { seed: 'hrush-001', count: 40, gap: 1 },
    { seed: 'fold-b', count: 60, gap: 1 },
    { seed: 'fold-c', count: 40, gap: 0 },
    { seed: 'fold-d', count: 30, gap: 3 },
  ];
  for (const c of cases) {
    it(`${c.seed} count ${c.count} gap ${c.gap}: видимое множество каждой комнаты и каждый слой — чистые болванки`, () => {
      const run = generateFoldRun(p, { seed: c.seed, count: c.count, gap: c.gap, fold: { shiftChance: 0.3, maxShift: 2, localRadius: 2, maxLayer: 12 } });
      expect(run.fold!.layers).toBeGreaterThan(1);
      const rx = exportRunJSON(p, run) as RunExport;
      expect(isFoldRun(rx)).toBe(true);
      expect(safeDepth(rx)).toBe(1);

      // весь прогон целиком — пересечения (поэтому и нужны подпрогоны)
      if (run.fold!.overlaps > 0) expect(buildBlockoutModel(rx).issues.some((s) => s.includes('пересекаются'))).toBe(true);

      for (const inst of rx.instances) {
        const v = visibleIds(rx, inst.id, 1);
        expect(v).toEqual(visibleSet(run, inst.id, 1));
        const m = buildBlockoutModel(subRun(rx, v), { deadEnds: 'panel' });
        expect(m.issues.filter((s) => !s.startsWith('cellM'))).toEqual([]);
        expect(validateBlockout(m)).toEqual([]);
        expect(m.rooms.map((r) => r.inst).sort()).toEqual([...v].sort());
        // связи наружу множества закрыты панелями
        const out = rx.links.filter((l) => v.has(l.a.inst) !== v.has(l.b.inst)).length;
        expect(m.deadEnds.length).toBeGreaterThanOrEqual(out);
      }

      const layers = layersOf(rx);
      expect(layers.length).toBe(run.fold!.layers);
      let total = 0;
      for (const w of layers) {
        const sub = layerRun(rx, w);
        total += sub.instances.length;
        const m = buildBlockoutModel(sub);
        expect(m.issues.filter((s) => !s.startsWith('cellM'))).toEqual([]);
        expect(validateBlockout(m)).toEqual([]);
      }
      expect(total).toBe(rx.instances.length);

      // соседство в 4D по JSON = overlapPairs ядра
      const pairs = new Set(overlapPairs(p, run).map(([a, b]) => `${a}|${b}`));
      let n = 0;
      for (const inst of rx.instances) {
        for (const o of overlapIds(rx, inst.id)) {
          n++;
          expect(pairs.has(`${inst.id}|${o}`) || pairs.has(`${o}|${inst.id}`)).toBe(true);
          expect(rx.instances.find((i) => i.id === o)!.w).not.toBe(inst.w);
          expect(visibleIds(rx, inst.id, 1).has(o)).toBe(false);
        }
      }
      expect(n).toBe(2 * pairs.size);

      // переход через порог A → B: в болванках видимых множеств A и B полы обеих комнат и проём между
      // ними совпадают — игрока не телепортирует и не роняет при пересборке
      const models = new Map<string, ReturnType<typeof buildBlockoutModel>>();
      const vis = (id: string) => {
        let m = models.get(id);
        if (!m) models.set(id, (m = buildBlockoutModel(subRun(rx, visibleIds(rx, id, 1)), { deadEnds: 'panel' })));
        return m;
      };
      const floorsOf = (m: ReturnType<typeof buildBlockoutModel>, id: string) => JSON.stringify(m.floors.filter((f) => f.inst === id));
      const opening = (m: ReturnType<typeof buildBlockoutModel>, l: RunExport['links'][number]) =>
        m.openings.find((o) => o.a.inst === l.a.inst && o.a.connector === l.a.connector && o.b.inst === l.b.inst)?.rect ?? null;
      // при gap = 0 проём режется на t/2 там, где в его конец упирается перегородка третьей комнаты
      // (она есть в одном множестве и нет в другом) — допуск t/2 = 0.04 м; при gap ≥ 1 — точно
      const tol = c.gap === 0 ? 0.04 + 1e-6 : 1e-9;
      for (const l of rx.links) {
        const ma = vis(l.a.inst), mb = vis(l.b.inst);
        for (const id of [l.a.inst, l.b.inst]) expect(floorsOf(ma, id)).toBe(floorsOf(mb, id));
        const ra = opening(ma, l), rb = opening(mb, l);
        expect(ra && rb).toBeTruthy();
        for (const k of ['x0', 'y0', 'x1', 'y1'] as const) expect(Math.abs(ra![k] - rb![k])).toBeLessThanOrEqual(tol);
      }

      // сдвиг W по связи
      for (const l of rx.links) {
        const wa = rx.instances.find((i) => i.id === l.a.inst)!.w ?? 0;
        const wb = rx.instances.find((i) => i.id === l.b.inst)!.w ?? 0;
        expect(linkBetween(rx, l.a.inst, l.b.inst)!.dw).toBe(wb - wa);
        expect(linkBetween(rx, l.b.inst, l.a.inst)!.dw).toBe(wa - wb);
      }
    });
  }
});

/** PVS прогона: настоящий (генератор с seamless) или синтетический — visibleIds глубины 2 при
 *  localRadius 4 (комнаты набора тоже не пересекаются). */
function withPvs(rx: RunExport): { rx: RunExport; real: boolean } {
  if (hasPvs(rx)) return { rx, real: true };
  const pvs: Record<string, string[]> = {};
  for (const i of rx.instances) pvs[i.id] = [...visibleIds(rx, i.id, 2)];
  return { rx: { ...rx, pvs }, real: false };
}

describe('бесшовная смена PVS на пороге: общая часть двух наборов — одинаковая геометрия', { timeout: 180000 }, () => {
  const p = presets();
  for (const c of [
    { seed: 'pvs-a', count: 50, gap: 1 },
    { seed: 'pvs-b', count: 40, gap: 3 },
  ]) {
    it(`${c.seed} gap ${c.gap}`, () => {
      const run = generateFoldRun(p, { seed: c.seed, count: c.count, gap: c.gap, fold: { shiftChance: 0.3, maxShift: 2, localRadius: 4, maxLayer: 12 } });
      const { rx } = withPvs(exportRunJSON(p, run) as RunExport);
      expect(hasPvs(rx)).toBe(true);
      const opts = { deadEnds: 'panel' as const, cutEnds: 'open' as const };
      const models = new Map<string, ReturnType<typeof buildBlockoutModel>>();
      const sets = new Map<string, Set<string>>();
      const get = (id: string) => {
        let m = models.get(id);
        if (!m) {
          const s = pvsIds(rx, id);
          sets.set(id, s);
          models.set(id, (m = buildBlockoutModel(subRun(rx, s), opts)));
          expect(m.issues.filter((x) => !x.startsWith('cellM'))).toEqual([]);
          expect(validateBlockout(m)).toEqual([]);
          // связи наружу набора — проёмы в темноту, не панели: панели только у настоящих тупиков
          const real = new Set(rx.openConnectors.map((o) => `${o.inst}/${o.connector}`));
          for (const d of m.deadEnds) if (d.source === 'connector') expect(real.has(`${d.inst}/${d.connector}`)).toBe(true);
        }
        return m;
      };
      /** всё, что модель строит для комнаты X (в порядке, не зависящем от состава набора) */
      const room = (m: ReturnType<typeof buildBlockoutModel>, x: string) => {
        const pick = <T extends { inst: string | null }>(list: T[]) => list.filter((e) => e.inst === x).map((e) => JSON.stringify(e)).sort();
        return { floors: pick(m.floors), ceilings: pick(m.ceilings), faces: pick(m.faces), props: pick(m.props), panels: pick(m.deadEnds), info: pick(m.rooms) };
      };
      let shared = 0;
      for (const l of rx.links) {
        const ma = get(l.a.inst), mb = get(l.b.inst);
        const sa = sets.get(l.a.inst)!, sb = sets.get(l.b.inst)!;
        expect(sa.has(l.b.inst) && sb.has(l.a.inst)).toBe(true);
        for (const x of sa) {
          if (!sb.has(x)) continue;
          shared++;
          expect(room(mb, x)).toEqual(room(ma, x));
        }
        // проёмы связей, у которых обе комнаты есть в обоих наборах
        const op = (m: ReturnType<typeof buildBlockoutModel>) =>
          m.openings.filter((o) => sa.has(o.a.inst) && sa.has(o.b.inst) && sb.has(o.a.inst) && sb.has(o.b.inst)).map((o) => JSON.stringify(o)).sort();
        expect(op(mb)).toEqual(op(ma));
      }
      expect(shared).toBeGreaterThan(rx.links.length);
    });
  }
});
