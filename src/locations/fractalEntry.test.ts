// Вход во «Фрактальную станцию» (tmp/metro-wip/FRACTAL.md §6): бездонный эскалатор метро — комната, дорожки, вуаль,
// рост в мире метро и выход descend → вестибюль.
import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '../data/presets';
import { connDz, stairIssues } from '../model/stairs';
import type { Project, Room, Run, WorldSettings } from '../model/types';
import { newWorldSettings, tunnelKind } from '../gen4d/biomes';
import { validateFoldRun } from '../gen4d/fold';
import { roomSightM } from '../gen4d/space';
import { createStreamWorld, streamSettings, type StreamSave, type StreamWorld } from '../gen4d/stream';
import { exportRunJSON } from '../gen/world';
import type { RunExport } from '../blockout/types';
import { escLanes } from './metroEscalator';
import { ABYSS, ABYSS_DIRS, ABYSS_TAG, abyssEnter, abyssVeil, isAbyss } from './fractalEntry';

const project = (): Project => {
  const p = createDefaultProject();
  p.finishes ??= [];
  p.finishRules ??= [];
  return p;
};
const p = project();
const byId = new Map(p.rooms.map((r) => [r.id, r]));
const roomOf = (run: Run, id: string) => byId.get(run.instances.find((i) => i.id === id)!.roomId)!;
const ABYSS_ID = 'metro_esc_abyss';
const abyss = () => byId.get(ABYSS_ID)!;

/** Мир метро; often — бездна в 40 раз чаще (множитель куска), чтобы найти её за короткий обход. */
function metro(seed: string, often = true): StreamWorld {
  const base = newWorldSettings();
  const biomes = base.biomes.map((b) => (b.id === 'metro' && often && b.tunnels ? { ...b, tunnels: { ...b.tunnels, pieceWeights: { ...b.tunnels.pieceWeights, [ABYSS_ID]: 40 } } } : b));
  const world: WorldSettings = { ...base, biomes, startBiome: 'metro', trAfter: 100000 };
  return createStreamWorld(p, streamSettings(seed, { world }));
}

/** Обход в ширину от старта (без переходов), служебные двери — раскрыть; первая бездна или null. */
function findAbyss(w: StreamWorld, n: number): string | null {
  const seen = new Set<string>();
  const q = [w.startId!];
  while (q.length && w.run().instances.length < n) {
    const id = q.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    w.expand(id);
    const run = w.run();
    const hit = run.instances.find((i) => isAbyss(byId.get(i.roomId)?.tags));
    if (hit) return hit.id;
    for (const l of run.links) {
      if (l.kind === 'descent' || l.kind === 'lift') continue;
      if (l.a.inst === id && !seen.has(l.b.inst)) q.push(l.b.inst);
      if (l.b.inst === id && !seen.has(l.a.inst)) q.push(l.a.inst);
    }
  }
  return null;
}

describe('фрактал: бездонный эскалатор — комната', () => {
  it('кладовая метро за дверью служебного хода: одна дверь на верхней площадке, три дорожки вниз на 10.8 м', () => {
    const r = abyss();
    expect(r).toBeDefined();
    expect(r.location).toBeUndefined();
    expect(r.tags).toEqual(expect.arrayContaining(['метро', 'эскалатор', 'лестница', ABYSS_TAG, 'только-биом']));
    expect(r.tags[0]).toBe('метро');
    expect(isAbyss(r.tags)).toBe(true);
    expect(tunnelKind(r)).toBe('storage');
    expect(r.cells.size).toBe(60 * 237);
    expect(r.ceilM).toBe(3.5);
    expect(roomSightM(r, p.settings.cellM)).toBeLessThanOrEqual(28 + 1e-9);
    expect(stairIssues(r)).toEqual([]);
    expect(r.connectors).toHaveLength(1);
    expect(r.connectors[0]).toMatchObject({ side: 'N', tag: 'room>slu', len: 9 });
    expect(connDz(r, 0)).toBeCloseTo(10.8, 9);
    const fl = r.stair!.flights;
    expect(fl.map((f) => [f.x, f.w])).toEqual([[4, 12], [24, 12], [44, 12]]);
    for (const f of fl) expect(f).toMatchObject({ y: 25, h: 187, up: 'N', z0: 0, z1: 10.8, style: 'escalator' });
    expect(r.stair!.pads).toEqual([{ x: 0, y: 0, w: 60, h: 25, z: 10.8 }]);
    // ~6 % кладовых метро (по весу)
    const store = p.rooms.filter((x) => x.tags[0] === 'метро' && tunnelKind(x) === 'storage');
    const sum = store.reduce((s, x) => s + x.gen.weight, 0);
    expect(r.gen.weight / sum).toBeGreaterThan(0.04);
    expect(r.gen.weight / sum).toBeLessThan(0.08);
    // прочие эскалаторы — не бездна
    for (const x of p.rooms) if (x.id !== ABYSS_ID) expect(isAbyss(x.tags), x.id).toBe(false);
  });

  it('дорожки: все вниз, средняя стоит — при любом ключе; у тоннеля — как прежде', () => {
    const r = abyss();
    const stair = {
      flights: r.stair!.flights.map((f) => ({ x0: f.x, y0: f.y, x1: f.x + f.w, y1: f.y + f.h, up: f.up, z0: f.z0, z1: f.z1, style: f.style })),
      pads: [],
    };
    for (const key of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const lanes = escLanes({ stair, roomTags: r.tags, z: -5 }, 0.1, key);
      expect(lanes.map((l) => l.dir)).toEqual([...ABYSS_DIRS]);
      expect(lanes[0]).toMatchObject({ up: 'N', z0: -5, z1: 5.8 });
    }
    const t = byId.get('metro_esc_tunnel')!;
    const dirs = new Set<string>();
    for (const key of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) dirs.add(escLanes({ stair, roomTags: t.tags, z: 0 }, 0.1, key).map((l) => l.dir).join());
    expect([...dirs].some((d) => d !== ABYSS_DIRS.join())).toBe(true);
  });

  it('вуаль: с 60 % подъёма темнеет, к 30 % — чёрное и вход', () => {
    const z0 = -20, rise = 10.8;
    const at = (share: number) => z0 + share * rise;
    expect(abyssVeil(at(1), z0, rise)).toBe(0);
    expect(abyssVeil(at(ABYSS.veilFrom), z0, rise)).toBeCloseTo(0, 9);
    expect(abyssVeil(at(0.45), z0, rise)).toBeCloseTo(0.5, 9);
    expect(abyssVeil(at(ABYSS.veilTo), z0, rise)).toBeCloseTo(1, 9);
    expect(abyssVeil(at(0), z0, rise)).toBe(1);
    expect(abyssVeil(at(1.5), z0, rise)).toBe(0);
    expect(abyssEnter(at(0.31), z0, rise)).toBe(false);
    expect(abyssEnter(at(0.3), z0, rise)).toBe(true);
    expect(abyssEnter(at(0.1), z0, rise)).toBe(true);
    // без подъёма — не бездна: не темнеть, не входить
    expect(abyssVeil(z0, z0, 0)).toBe(0);
    expect(abyssEnter(z0, z0, 0)).toBe(false);
    expect(abyssVeil(NaN, z0, rise)).toBe(0);
    expect(isAbyss(undefined)).toBe(false);
  });
});

describe('фрактал: бездна в мире метро', { timeout: 600000 }, () => {
  it('вырастает за служебной дверью; descend → вестибюль метро этажом ниже; повтор — тот же; сохранение держит связь', () => {
    let found = 0;
    for (const seed of ['fa1', 'fa2', 'fa3']) {
      const w = metro(seed);
      const id = findAbyss(w, 400);
      if (!id) continue;
      found++;
      const run = w.run();
      const inst = run.instances.find((i) => i.id === id)!;
      const r = roomOf(run, id);
      expect(r.id).toBe(ABYSS_ID);
      expect(w.locationOf(id)).toBeNull();
      // сосед — служебный ход метро, дверь на верхней площадке: пол соседа на +10.8 над низом бездны
      const l = run.links.find((x) => !x.kind && (x.a.inst === id || x.b.inst === id))!;
      expect(l).toBeDefined();
      const nb = l.a.inst === id ? l.b.inst : l.a.inst;
      const nr = roomOf(run, nb);
      expect(nr.tags).toEqual(expect.arrayContaining(['метро', 'служебное', 'ход']));
      const nz = run.instances.find((i) => i.id === nb)!.z ?? 0;
      const nc = nr.connectors.findIndex((c) => c.id === (l.a.inst === nb ? l.a.connector : l.b.connector));
      expect(nz + connDz(nr, nc)).toBeCloseTo((inst.z ?? 0) + 10.8, 6);
      expect(validateFoldRun(p, run), seed).toEqual([]);
      // экспорт: три дорожки-эскалатора, все вниз, средняя стоит
      const rx = exportRunJSON(p, run) as RunExport;
      const ri = rx.instances.find((i) => i.id === id)!;
      expect(ri.stair!.flights.filter((f) => f.style === 'escalator')).toHaveLength(3);
      expect(escLanes(ri, rx.cellM, `${seed}/${id}`).map((x) => x.dir)).toEqual([...ABYSS_DIRS]);
      // выход из «Фрактальной станции»
      const out = w.descend(id);
      expect(w.descend(id)).toBe(out);
      const run2 = w.run();
      const ex = roomOf(run2, out);
      expect(ex.tags).toEqual(expect.arrayContaining(['метро', 'вестибюль']));
      expect(w.clusterAt(out)).toMatchObject({ tunnels: true, biome: { id: 'metro' } });
      const fl = (x: string) => run2.instances.find((i) => i.id === x)!.floor ?? 0;
      expect(fl(out)).toBe(fl(id) - 1);
      const dl = run2.links.find((x) => x.kind === 'descent' && x.a.inst === id)!;
      expect(dl).toMatchObject({ b: { inst: out }, floors: 1 });
      expect(ex.connectors.find((c) => c.id === dl.b.connector)!.tag).toBe('stair');
      w.expand(out);
      expect(validateFoldRun(p, w.run()), seed).toEqual([]);
      // сохранение → загрузка: связь та же, повторный descend — тот же вестибюль
      const sv: StreamSave = JSON.parse(JSON.stringify(w.save()));
      const b = createStreamWorld(p, w.settings, sv);
      expect(b.stale).toBe(false);
      expect(b.descend(id)).toBe(out);
      expect(b.run().links.some((x) => x.kind === 'descent' && x.a.inst === id && x.b.inst === out)).toBe(true);
    }
    expect(found).toBeGreaterThanOrEqual(2);
  });

  it('без множителя — редкая: не каждая кладовая метро', () => {
    const w = metro('fa-plain', false);
    findAbyss(w, 250);
    const run = w.run();
    const stores = run.instances.filter((i) => tunnelKind(byId.get(i.roomId) as Room) === 'storage');
    const abysses = stores.filter((i) => isAbyss(byId.get(i.roomId)?.tags));
    expect(abysses.length).toBeLessThanOrEqual(Math.max(1, stores.length * 0.3));
    expect(validateFoldRun(p, run)).toEqual([]);
  });
});
