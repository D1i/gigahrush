// Подвал бесконечного мира (docs/GENERATOR-4D.md §17): сеть ходов, редкие хабы, кольца через W, бесконечные прямые
// участки (шов wrap), вход и выход через хабы, отделка биома.
import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '../data/presets';
import type { Project, Run, TunnelSettings, WorldSettings } from '../model/types';
import { DEFAULT_TUNNELS, newWorldSettings } from './biomes';
import { validateFoldRun } from './fold';
import { createStreamWorld, streamSettings, type StreamSave, type StreamWorld } from './stream';
import { exportRunJSON } from '../gen/world';
import { buildBlockoutModel } from '../blockout/core';
import { buildPiece, piecePortals } from '../blockout/pieces';
import type { RunExport } from '../blockout/types';

const project = (): Project => {
  const p = createDefaultProject();
  p.finishes ??= [];
  p.finishRules ??= [];
  return p;
};
const p = project();
const roomOf = (run: Run, id: string) => p.rooms.find((r) => r.id === run.instances.find((i) => i.id === id)!.roomId)!;
const world = (o: Partial<WorldSettings> = {}, t: Partial<TunnelSettings> = {}): WorldSettings => {
  // переходы здесь — спец-комнаты (лестница, лифт); площадки-переходы — stream.barn.test.ts
  const w = { ...newWorldSettings(), trLanding: 0, ...o };
  w.tunnels = { ...DEFAULT_TUNNELS, ...t };
  return w;
};
const basement = (seed: string, t: Partial<TunnelSettings> = {}, o: Partial<WorldSettings> = {}) =>
  createStreamWorld(p, streamSettings(seed, { world: world({ startBiome: 'basement', trAfter: 100000, ...o }, t) }));

/** «Пройти» мир: раскрыть экземпляры в ширину от from (по умолчанию — старт), пока комнат меньше n. */
function walk(w: StreamWorld, n: number, from = w.startId!): void {
  const seen = new Set<string>();
  const q = [from];
  while (q.length && w.run().instances.length < n) {
    const id = q.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    w.expand(id);
    for (const l of w.run().links) {
      if (l.kind === 'descent' || l.kind === 'lift') continue;
      if (l.a.inst === id && !seen.has(l.b.inst)) q.push(l.b.inst);
      if (l.b.inst === id && !seen.has(l.a.inst)) q.push(l.a.inst);
    }
  }
}

describe('подвал: сеть ходов', { timeout: 300000 }, () => {
  it('старт в подвале — хаб с закрытым маршем наверх; ходы растут на ходу, хабы редкие, ходы длинные', () => {
    const w = basement('tun-a');
    const run0 = w.run();
    expect(run0.instances).toHaveLength(1);
    const start = roomOf(run0, w.startId!);
    expect(start.tags).toContain('хаб');
    expect(w.clusterAt(w.startId!)).toMatchObject({ tunnels: true, biome: { id: 'basement' } });
    // марш наверх — закрытый выход
    const stair = start.connectors.find((c) => c.tag === 'stair')!;
    expect(w.doorState(w.startId!, stair.id)).toBe('exit');
    walk(w, 260);
    const run = w.run();
    const st = w.stats();
    expect(run.instances.length).toBeGreaterThanOrEqual(200);
    // все комнаты — подвальные (ход, поворот, развилка, хаб, кладовая, служебка)
    for (const i of run.instances) expect(roomOf(run, i.id).tags.some((t) => ['подвал', 'кладовка', 'служебное'].includes(t)), i.roomId).toBe(true);
    const hubs = run.instances.filter((i) => roomOf(run, i.id).tags.includes('хаб')).length;
    const tunnels = run.instances.filter((i) => roomOf(run, i.id).tags.includes('ход')).length;
    expect(st.hubs).toBe(hubs);
    // хабы редкие: на хаб — десятки метров хода
    expect(hubs).toBeGreaterThanOrEqual(2);
    expect(tunnels / hubs).toBeGreaterThan(6);
    expect(validateFoldRun(p, run)).toEqual([]);
  });

  it('кольцо из хаба: ход уходит из одного прохода хаба и возвращается в другой (через слои W)', () => {
    let rings = 0;
    for (const seed of ['r1', 'r2', 'r3', 'r4', 'r5', 'r6']) {
      const w = basement(seed, { ring: 1 });
      w.expand(w.startId!);
      rings += w.stats().rings;
      if (!w.stats().rings) continue;
      const run = w.run();
      // хаб связан с кольцом двумя проходами, кольцо — цепочка ходов и поворотов
      const hubLinks = run.links.filter((l) => !l.wrap && (l.a.inst === w.startId || l.b.inst === w.startId));
      expect(hubLinks.length).toBeGreaterThanOrEqual(2);
      expect(validateFoldRun(p, run)).toEqual([]);
    }
    expect(rings).toBeGreaterThanOrEqual(3);
  });

  it('бесконечный прямой участок: тройник, прямые куски и шов wrap — метки лицом к лицу со сдвигом', () => {
    let wraps = 0;
    for (const seed of ['w1', 'w2', 'w3']) {
      const w = basement(seed, { loop: 1, hubEvery: [400, 500], ring: 0 });
      walk(w, 120);
      const run = w.run();
      const ws = run.links.filter((l) => l.wrap);
      wraps += ws.length;
      expect(ws.length).toBe(w.stats().wraps);
      for (const l of ws) {
        // шов — в тройник (вход сбоку), с другой стороны — не меньше двух прямых кусков
        expect(roomOf(run, l.b.inst).id).toBe('bsm_tun_T');
        expect(roomOf(run, l.a.inst).tags).toContain('ход');
        expect(Math.hypot(l.wrap![0], l.wrap![1]) * 0.1).toBeGreaterThanOrEqual(DEFAULT_TUNNELS.loopLen[0]);
      }
      expect(validateFoldRun(p, run)).toEqual([]);
    }
    expect(wraps).toBeGreaterThanOrEqual(2);
  });

  it('шов в болванке: в модели целиком — тупики без жалоб; в кусках портального рендера — проём со сдвигом', () => {
    const w = basement('w2', { loop: 1, hubEvery: [400, 500], ring: 0 });
    walk(w, 120);
    const rx = exportRunJSON(p, w.run(), { withTex: false }) as RunExport;
    const l = rx.links.find((x) => x.wrap)!;
    expect(l).toBeTruthy();
    const whole = buildBlockoutModel(rx);
    expect(whole.issues.filter((x) => x.includes(l.a.inst) && x.includes(l.b.inst))).toEqual([]);
    for (const [id, other, sgn] of [[l.a.inst, l.b.inst, 1], [l.b.inst, l.a.inst, -1]] as const) {
      const piece = buildPiece(rx, id, {}, true);
      const q = piecePortals(rx, piece, id).find((x) => x.to === other);
      expect(q, `${id} → ${other}`).toBeTruthy();
      expect(q!.shift![0]).toBeCloseTo(sgn * l.wrap![0] * 0.1, 9);
      expect(q!.shift![1]).toBeCloseTo(sgn * l.wrap![1] * 0.1, 9);
      // проём во всю ширину хода (1.0 м)
      expect(q!.hi - q!.lo).toBeCloseTo(1.0, 6);
    }
  });

  it('выход из подвала — марш хаба: за ним квартиры, остальные выходы подвала исчезают', () => {
    const w = basement('up', {}, { biomes: newWorldSettings().biomes });
    walk(w, 120);
    const exits: [string, string][] = [];
    for (const i of w.run().instances) for (const c of roomOf(w.run(), i.id).connectors) if (w.doorState(i.id, c.id) === 'exit') exits.push([i.id, c.id]);
    expect(exits.length).toBeGreaterThanOrEqual(1);
    const [a, c] = exits[0];
    const id = w.openDoor(a, c)!;
    expect(id).toBeTruthy();
    const cl = w.clusterAt(id)!;
    expect(cl.tunnels).toBe(false);
    expect(cl.biome?.layout).toBeUndefined();
    for (const [x, y] of exits.slice(1)) expect(w.doorState(x, y)).toBe('dead');
    expect(validateFoldRun(p, w.run())).toEqual([]);
  });

  it('вход в подвал — «Спуск в подвал» из квартир: выход с меткой хода ведёт в хаб подвала', () => {
    let found = false;
    for (const seed of ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8']) {
      const w = createStreamWorld(p, streamSettings(seed, { world: world({ trAfter: 100000 }) }));
      let id = w.startId!;
      for (let k = 0; k < 30 && !found; k++) {
        const cid = w.clusterAt(id)!.id;
        const ex: [string, string][] = [];
        for (const i of w.run().instances) {
          if (w.clusterAt(i.id)?.id !== cid) continue;
          for (const c of roomOf(w.run(), i.id).connectors) if (w.doorState(i.id, c.id) === 'exit') ex.push([i.id, c.id]);
        }
        const down = ex.find(([i, c]) => roomOf(w.run(), i).connectors.find((x) => x.id === c)!.tag === 'basement');
        if (down) {
          const hub = w.openDoor(down[0], down[1])!;
          const cl = w.clusterAt(hub)!;
          expect(cl.tunnels).toBe(true);
          expect(roomOf(w.run(), hub).tags).toContain('хаб');
          expect(validateFoldRun(p, w.run())).toEqual([]);
          found = true;
          break;
        }
        if (!ex.length) break;
        id = w.openDoor(...ex[k % ex.length]) ?? id;
      }
      if (found) break;
    }
    expect(found).toBe(true);
  });

  it('переход в подвал приводит в хаб; отделка — по правилам биома (затопленный: вода на полу, сырой бетон)', () => {
    const W = newWorldSettings();
    const keep = new Set(['khrush', 'basement_wet']);
    const w = createStreamWorld(p, streamSettings('wet', { world: world({ biomes: W.biomes.filter((b) => keep.has(b.id)), trAfter: 1, trBase: 1, trStep: 0, trToBiome: 1 }) }));
    const ids = w.run().instances.map((i) => i.id);
    for (const id of ids) w.enter(id);
    expect(w.transitionState()!.pending).toBe(true);
    // открыть выход — за ним переход
    let t: string | null = null;
    for (const i of w.run().instances) {
      for (const c of roomOf(w.run(), i.id).connectors) {
        if (t || w.doorState(i.id, c.id) !== 'exit' || c.len < 7) continue;
        t = w.openDoor(i.id, c.id);
      }
    }
    expect(t).toBeTruthy();
    const kind = w.locationOf(t!)?.kind;
    const out = kind === 'stairwell' ? w.descend(t!) : w.ascend(t!, 1, 'straight');
    const cl = w.clusterAt(out)!;
    expect(cl.biome?.id).toBe('basement_wet');
    expect(cl.tunnels).toBe(true);
    expect(roomOf(w.run(), out).tags).toContain('хаб');
    walk(w, w.run().instances.length + 60, out);
    const run = w.run();
    const wet = run.instances.filter((i) => w.clusterAt(i.id)?.biome?.id === 'basement_wet' && roomOf(run, i.id).tags[0] === 'подвал');
    expect(wet.length).toBeGreaterThan(5);
    for (const i of wet) {
      const c = run.content[i.order];
      expect(['f_bsm_damp', 'f_bsm_brick']).toContain(c.finish?.wall);
      expect(['f_bsm_water', 'f_bsm_damp_floor']).toContain(c.finish?.floor);
    }
    expect(validateFoldRun(p, run)).toEqual([]);
  });

  it('сохранение → загрузка: подвал, кольца, швы, метры до хаба; продолжение — то же, что без сохранения', () => {
    const mk = () => basement('save', { loop: 0.3, ring: 1 });
    const a = mk();
    walk(a, 90);
    const sv: StreamSave = JSON.parse(JSON.stringify(a.save()));
    const b = createStreamWorld(p, a.settings, sv);
    expect(b.stale).toBe(false);
    expect(b.run().links).toEqual(a.run().links);
    expect(b.stats()).toMatchObject({ hubs: a.stats().hubs, wraps: a.stats().wraps });
    // дальше растут одинаково
    walk(a, 160);
    walk(b, 160);
    expect(b.run().instances.map((i) => [i.roomId, i.dx, i.dy, i.w])).toEqual(a.run().instances.map((i) => [i.roomId, i.dx, i.dy, i.w]));
    expect(validateFoldRun(p, b.run())).toEqual([]);
  });

  it('тот же сид — тот же подвал', () => {
    const x = basement('same', { loop: 0.2 });
    const y = basement('same', { loop: 0.2 });
    walk(x, 120);
    walk(y, 120);
    expect(y.run().links).toEqual(x.run().links);
  });
});
