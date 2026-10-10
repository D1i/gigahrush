// Куски комнат (владение, ownership) для портального рендера складчатого прогона: для каждой связи A–B
// куски A и B вместе — чистая стыковка (validateBlockout пуст: объёмы не пересекаются, пол закрыт,
// проём сквозной), на прогонах С ПЕРЕСЕЧЕНИЯМИ (seamless выкл., localRadius 1 — соседи комнаты между
// собой пересекаются в 3D). Прогон генерируется приложением — тест в прототип игры не переносится.
import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '../data/presets';
import { exportRunJSON } from '../gen/world';
import { generateFoldRun } from '../gen4d/fold';
import type { Project } from '../model/types';
import { buildBlockoutModel, validateBlockout } from './core';
import { buildPiece, mergePieces, neighborIds, pieceFloorRects, piecePortals, translateInstance } from './pieces';
import { overlapIds } from './subrun';
import type { BlockoutModel, Rect, RunExport } from './types';

function presets(): Project {
  const p = createDefaultProject();
  p.finishes ??= [];
  p.finishRules ??= [];
  return p;
}

const area = (r: Rect): number => (r.x1 - r.x0) * (r.y1 - r.y0);
const inter = (a: Rect, b: Rect): number => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

describe('куски комнат: стыковка соседей на складчатом прогоне с пересечениями', { timeout: 240000 }, () => {
  const p = presets();
  const cases = [
    { seed: 'hrush-001', count: 60, gap: 1, sightM: 8, localRadius: 1 },
    { seed: 'fold-b', count: 90, gap: 1, sightM: 9, localRadius: 1 },
    { seed: 'hrush-002', count: 60, gap: 1, sightM: 7, localRadius: 1 },
    { seed: 'fold-d', count: 30, gap: 3, sightM: 8, localRadius: 1 },
  ];
  let neighborOverlaps = 0;
  for (const c of cases) {
    it(`${c.seed} count ${c.count} gap ${c.gap} sightM ${c.sightM} localRadius ${c.localRadius}`, () => {
      const run = generateFoldRun(p, { seed: c.seed, count: c.count, gap: c.gap, sightM: c.sightM, fold: { shiftChance: 0.3, maxShift: 2, localRadius: c.localRadius, maxLayer: 12, seamless: false } });
      expect(run.fold!.overlaps).toBeGreaterThan(0);
      const rx = exportRunJSON(p, run) as RunExport;
      const pieces = new Map<string, BlockoutModel>();
      for (const i of rx.instances) pieces.set(i.id, buildPiece(rx, i.id, { deadEnds: 'panel' }));

      for (const [id, pc] of pieces) {
        // кусок сам по себе замкнут (открыты только половины проёмов к соседям)
        expect(pc.issues, id).toEqual([]);
        expect(validateBlockout(mergePieces([pc])), id).toEqual([]);
        expect(pc.solids.every((s) => s.inst === id)).toBe(true);
        expect(pc.rooms.map((r) => r.inst)).toEqual([id]);
        // порталы — по одному на соседа (по каждой связи)
        const nb = neighborIds(rx, id);
        const ports = piecePortals(rx, pc, id);
        expect(ports.length).toBe(rx.links.filter((l) => l.a.inst === id || l.b.inst === id).length);
        expect(new Set(ports.map((q) => q.to))).toEqual(new Set(nb));
        // соседи между собой пересекаются — именно то, что раньше ломало рендер «комната + соседи»
        for (let a = 0; a < nb.length; a++) for (let b = a + 1; b < nb.length; b++) if (overlapIds(rx, nb[a]).includes(nb[b])) neighborOverlaps++;
      }

      for (const l of rx.links) {
        const A = pieces.get(l.a.inst)!, B = pieces.get(l.b.inst)!;
        const name = `${l.a.inst}–${l.b.inst}`;
        expect(validateBlockout(mergePieces([A, B])), name).toEqual([]);
        // проём — пополам: половины пола проёма A и B не перекрываются и вместе дают весь проём;
        // граница половин — плоскость портала (там же меняется текущая комната)
        const pa = piecePortals(rx, A, l.a.inst).find((q) => q.to === l.b.inst && q.a.connector === l.a.connector)!;
        const pb = piecePortals(rx, B, l.b.inst).find((q) => q.to === l.a.inst && q.a.connector === l.a.connector)!;
        expect(pa && pb, name).toBeTruthy();
        expect(pa.at).toBeCloseTo(pb.at, 6);
        expect(pa.dir).toBe(-pb.dir);
        if (c.gap >= 1) {
          const ha = A.floors.filter((f) => f.inst === null && f.owner === l.a.inst).flatMap((f) => f.rects).filter((r) => inter(r, pa.rect) > 1e-9);
          const hb = B.floors.filter((f) => f.inst === null && f.owner === l.b.inst).flatMap((f) => f.rects).filter((r) => inter(r, pa.rect) > 1e-9);
          const sa = ha.reduce((s, r) => s + inter(r, pa.rect), 0), sb = hb.reduce((s, r) => s + inter(r, pa.rect), 0);
          expect(sa).toBeCloseTo(area(pa.rect) / 2, 6);
          expect(sb).toBeCloseTo(area(pa.rect) / 2, 6);
          for (const r of ha) for (const q of hb) expect(inter(r, q)).toBeLessThan(1e-9);
          // половина A — со стороны A от плоскости портала
          const mid = (r: Rect) => (pa.axis === 'x' ? (r.x0 + r.x1) / 2 : (r.y0 + r.y1) / 2);
          for (const r of ha) expect(Math.sign(mid(r) - pa.at)).toBe(-pa.dir);
          for (const r of hb) expect(Math.sign(mid(r) - pa.at)).toBe(pa.dir);
        }
        // пол для определения текущей комнаты: у A и B не пересекается
        const fa = pieceFloorRects(A, l.a.inst), fb = pieceFloorRects(B, l.b.inst);
        for (const r of fa) for (const q of fb) expect(inter(r, q)).toBeLessThan(1e-9);
      }
    });
  }
  it('в прогонах есть пары соседей, пересекающихся между собой', () => {
    expect(neighborOverlaps).toBeGreaterThan(10);
  });

  it('gap 0: куски соседей не пересекаются, проём сквозной (облицовка в узлах трёх комнат — приближённо)', () => {
    const run = generateFoldRun(p, { seed: 'fold-c', count: 40, gap: 0, sightM: 8, fold: { shiftChance: 0.3, maxShift: 2, localRadius: 1, maxLayer: 12, seamless: false } });
    const rx = exportRunJSON(p, run) as RunExport;
    const pieces = new Map(rx.instances.map((i) => [i.id, buildPiece(rx, i.id)] as const));
    for (const l of rx.links) {
      const errs = validateBlockout(mergePieces([pieces.get(l.a.inst)!, pieces.get(l.b.inst)!]));
      expect(errs.filter((s) => s.startsWith('Пересекаются') || s.startsWith('Проём')), `${l.a.inst}–${l.b.inst}`).toEqual([]);
    }
  });
});

const fixtures = import.meta.glob<RunExport>('./fixtures/*.json', { eager: true, import: 'default' });

describe('владение (ownership) на фикстурах обычных прогонов', () => {
  for (const name of ['run-gap0-30', 'run-gap1-30', 'run-gap3-20', 'run-gap1-150']) {
    it(`${name}: модель с владением чистая, у каждого объёма есть владелец`, () => {
      const run = fixtures[`./fixtures/${name}.json`];
      expect(run).toBeTruthy();
      const m = buildBlockoutModel(run, { ownership: true });
      expect(m.issues).toEqual([]);
      expect(validateBlockout(m)).toEqual([]);
      const ids = new Set(run.instances.map((i) => i.id));
      expect(m.solids.every((s) => typeof s.inst === 'string' && ids.has(s.inst))).toBe(true);
      expect(m.floors.filter((f) => f.inst === null).every((f) => typeof f.owner === 'string')).toBe(true);
      // без владения — как раньше: владельцев нет
      const plain = buildBlockoutModel(run);
      expect(plain.solids.some((s) => s.inst !== undefined)).toBe(false);
    });
  }
});

describe('сдвиг экземпляра (шов бесконечного хода, translateInstance)', () => {
  it('отрицательные координаты клеток: отрезки сдвигаются целиком, ядро разбирает строки', () => {
    const run = fixtures['./fixtures/run-gap1-30.json'];
    const src = run.instances[0];
    const i = { ...src, cells: ['5:-317--273,-10,4-6', '-2:0'] };
    expect(translateInstance(i, -604, 3).cells).toEqual(['8:-921--877,-614,-600--598', '1:-604']);
    // настоящий экземпляр, уведённый в минус и обратно: пол тот же, ни одной неразобранной строки
    const cells = (m: BlockoutModel) => m.stats.floorCells;
    const base = buildBlockoutModel({ ...run, instances: [src], links: [] });
    const neg = translateInstance(src, -5000, -7000);
    const back = translateInstance(neg, 5000, 7000);
    expect(back.cells).toEqual(src.cells);
    const m = buildBlockoutModel({ ...run, instances: [neg], links: [] });
    expect(m.issues.filter((s) => s.includes('не разобрана'))).toEqual([]);
    expect(cells(m)).toBe(cells(base));
  });
});
