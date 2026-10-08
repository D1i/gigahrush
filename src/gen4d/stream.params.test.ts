// Параметры генераторов «Прогулки» (docs/GENERATOR-4D.md §18): свои у биома, правила роста, частота кусков подвала,
// 4D и обзор прогулки.
import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '../data/presets';
import type { Project, WorldSettings } from '../model/types';
import { aptOf, DEFAULT_TUNNELS, newWorldSettings, normWorld, tunOf } from './biomes';
import { validateFoldRun } from './fold';
import { createStreamWorld, streamSettings, type StreamWorld } from './stream';
import { walkStreamSettings } from '../view3d/walk';

const p: Project = createDefaultProject();
const roomOf = (w: StreamWorld, id: string) => p.rooms.find((r) => r.id === w.run().instances.find((i) => i.id === id)!.roomId)!;
const W = (f: (w: WorldSettings) => void = () => {}): WorldSettings => {
  const w = { ...newWorldSettings(), trAfter: 100000 };
  w.tunnels = { ...DEFAULT_TUNNELS, pieceWeights: {} };
  f(w);
  return w;
};
const exitsOf = (w: StreamWorld, cid?: number): [string, string][] => {
  const out: [string, string][] = [];
  for (const i of w.run().instances) {
    if (cid !== undefined && w.clusterAt(i.id)?.id !== cid) continue;
    for (const c of roomOf(w, i.id).connectors) if (w.doorState(i.id, c.id) === 'exit') out.push([i.id, c.id]);
  }
  return out;
};

/** Цепочка квартир: открыть выход, ещё и ещё; итог — средние по квартирам. */
function chain(world: WorldSettings, seeds: string[], steps = 10) {
  let cl = 0, exits = 0, leaves = 0, rooms = 0, loose = 0;
  for (const seed of seeds) {
    const w = createStreamWorld(p, streamSettings(seed, { world }));
    let id = w.startId!;
    for (let k = 0; k < steps; k++) {
      const c = w.clusterAt(id)!;
      const ids = w.run().instances.filter((i) => w.clusterAt(i.id)?.id === c.id).map((i) => i.id);
      for (const r of ids) {
        const doors = roomOf(w, r).connectors.filter((x) => x.len >= 1).map((x) => w.doorState(r, x.id));
        if (doors.filter((s) => s === 'linked').length <= 1 && !doors.includes('exit')) leaves++;
      }
      const ex = exitsOf(w, c.id);
      cl++;
      rooms += ids.length;
      exits += ex.length;
      let next: string | null = null;
      for (let j = 0; j < ex.length && !next; j++) next = w.openDoor(...ex[(k + j) % ex.length]);
      if (!next) break;
      id = next;
    }
    loose += w.run().links.filter((l) => l.loose).length;
    expect(validateFoldRun(p, w.run())).toEqual([]);
  }
  return { exits: exits / cl, leaves: leaves / cl, rooms: rooms / cl, loose };
}

describe('параметры генераторов «Прогулки»', { timeout: 300000 }, () => {
  it('нормализация: свои параметры биома частично, 4D прогулки, частота кусков — сохранение → загрузка без потерь', () => {
    const w = W((x) => {
      x.biomes.find((b) => b.id === 'dorm')!.apartments = { clusterRooms: [10, 15] };
      x.biomes.find((b) => b.id === 'basement_wet')!.tunnels = { hubEvery: [300, 400], pieceWeights: { bsm_tun_8: 0 } };
      x.walk.shiftChance = 0.3;
      x.exitReserve = 0.5;
      x.outerTags = ['corridor', 'stair'];
    });
    const back = normWorld(JSON.parse(JSON.stringify(w)));
    expect(back).toEqual(w);
    expect(aptOf(back, 'dorm')).toMatchObject({ clusterRooms: [10, 15], clusterExits: back.clusterExits, exitReserve: 0.5 });
    expect(tunOf(back, 'basement_wet')).toMatchObject({ hubEvery: [300, 400], ring: back.tunnels.ring, pieceWeights: { bsm_tun_8: 0 } });
    // мусор — в рамки
    const bad = normWorld({ ...w, exitReserve: 7, entrySpare: -3, transitionMinLen: 0, walk: { localRadius: 0, sightM: -1 } });
    expect(bad).toMatchObject({ exitReserve: 1, entrySpare: 0, transitionMinLen: 0.1, walk: { localRadius: 1, sightM: 0 } });
  });

  it('свои параметры квартир у биома: стартовая квартира в одну комнату', () => {
    const w = createStreamWorld(p, streamSettings('own', { world: W((x) => (x.biomes.find((b) => b.id === 'khrush')!.apartments = { clusterRooms: [1, 1] })) }));
    expect(w.clusterAt(w.startId!)!.rooms).toBe(1);
    const d = createStreamWorld(p, streamSettings('own', { world: W() }));
    expect(d.clusterAt(d.startId!)!.rooms).toBeGreaterThan(1);
  });

  it('проходимость: 100% — больше выходов и меньше тупиковых комнат, чем 0%', () => {
    const seeds = ['a', 'b', 'c', 'd'];
    const hi = chain(W((x) => (x.exitReserve = 1)), seeds);
    const lo = chain(W((x) => (x.exitReserve = 0)), seeds);
    expect(hi.exits).toBeGreaterThan(lo.exits);
    expect(hi.leaves).toBeLessThan(lo.leaves);
  });

  it('без 4D-швов — ни одной связи loose, мир идёт', () => {
    const r = chain(W((x) => (x.seamEntries = false)), ['s1', 's2'], 10);
    expect(r.loose).toBe(0);
    expect(r.exits).toBeGreaterThan(0);
    expect(chain(W(), ['s1', 's2'], 10).loose).toBeGreaterThan(0);
  });

  it('метки «наружу» — из настроек', () => {
    const w = createStreamWorld(p, streamSettings('o', { world: W((x) => (x.outerTags = ['corridor'])) }));
    const outer = (w as unknown as { outer: Set<string> }).outer;
    expect([...outer]).toEqual(['corridor']);
  });

  it('дверь под переход от 1.2 м: за дверью 1.0 м перехода нет', () => {
    for (const [min, expectT] of [[0.7, true], [1.2, false]] as const) {
      const w = createStreamWorld(p, streamSettings('tr', { world: W((x) => Object.assign(x, { trAfter: 0, trBase: 1, trStep: 0, transitionMinLen: min })) }));
      w.enter(w.startId!);
      expect(w.transitionState()!.pending).toBe(true);
      const ex = exitsOf(w).find(([i, c]) => roomOf(w, i).connectors.find((x) => x.id === c)!.len === 10)!;
      const id = w.openDoor(...ex)!;
      expect(!!roomOf(w, id).location, `${min} м`).toBe(expectT);
    }
  });

  it('свои параметры подвала у биома и частота кусков: хабов нет до 1000 м, длинного хода нет', () => {
    const w = createStreamWorld(p, streamSettings('bw', {
      world: W((x) => {
        x.startBiome = 'basement_wet';
        x.biomes.find((b) => b.id === 'basement_wet')!.tunnels = { hubEvery: [1000, 1000], pieceWeights: { bsm_tun_8: 0 } };
      }),
    }));
    const seen = new Set<string>();
    const q = [w.startId!];
    while (q.length && w.run().instances.length < 200) {
      const id = q.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      w.expand(id);
      for (const l of w.run().links) {
        if (l.kind) continue;
        if (l.a.inst === id) q.push(l.b.inst);
        if (l.b.inst === id) q.push(l.a.inst);
      }
    }
    const run = w.run();
    expect(run.instances.length).toBeGreaterThan(150);
    expect(w.stats().hubs).toBe(1); // только стартовый
    expect(run.instances.some((i) => i.roomId === 'bsm_tun_8')).toBe(false);
    expect(validateFoldRun(p, run)).toEqual([]);
  });

  it('4D и обзор прогулки — в настройки мира «Прогулки»', () => {
    const q: Project = { ...p, world: W((x) => Object.assign(x.walk, { shiftChance: 0.25, maxShift: 2, localRadius: 2, maxLayer: 30, sightM: 6, aheadDoors: 3 })) };
    const s = walkStreamSettings(q, { seed: 'x', deadEndChance: 0.1, branching: 1, aheadDoors: 5, clusters: true });
    expect(s.fold).toMatchObject({ shiftChance: 0.25, maxShift: 2, localRadius: 2, maxLayer: 30, seamless: false });
    expect(s.sightM).toBe(6);
    expect(s.aheadDoors).toBe(3);
    // прежний рост: «вперёд дверей» — из панели прогулки
    expect(walkStreamSettings(q, { seed: 'x', deadEndChance: 0.1, branching: 1, aheadDoors: 5, clusters: false }).aheadDoors).toBe(5);
    // складки действуют на рост
    const w = createStreamWorld(p, s);
    expect(w.settings.fold.maxShift).toBe(2);
  });
});
