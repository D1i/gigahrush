// Параметры генераторов «Прогулки» (docs/GENERATOR-4D.md §18): свои у биома, правила роста, частота кусков подвала,
// 4D и обзор прогулки, 4D-складки не ближе N м пути.
import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '../data/presets';
import type { Project, WorldSettings } from '../model/types';
import { aptOf, DEFAULT_TUNNELS, newWorldSettings, normWorld, tunOf } from './biomes';
import { generateFoldRun, validateFoldRun } from './fold';
import { createStreamWorld, DEFAULT_STREAM_FOLD, streamSettings, type StreamWorld } from './stream';
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
      x.walk.localM = 4.5;
      x.exitReserve = 0.5;
      x.outerTags = ['corridor', 'stair'];
    });
    const back = normWorld(JSON.parse(JSON.stringify(w)));
    expect(back).toEqual(w);
    expect(aptOf(back, 'dorm')).toMatchObject({ clusterRooms: [10, 15], clusterExits: back.clusterExits, exitReserve: 0.5 });
    expect(tunOf(back, 'basement_wet')).toMatchObject({ hubEvery: [300, 400], ring: back.tunnels.ring, pieceWeights: { bsm_tun_8: 0 } });
    // мусор — в рамки
    const bad = normWorld({ ...w, exitReserve: 7, entrySpare: -3, transitionMinLen: 0, walk: { localRadius: 0, sightM: -1, localM: -2 } });
    expect(bad).toMatchObject({ exitReserve: 1, entrySpare: 0, transitionMinLen: 0.1, walk: { localRadius: 1, sightM: 0, localM: 0 } });
    // старый проект без поля — складки по умолчанию
    expect(normWorld({ ...w, walk: { sightM: 9 } }).walk.localM).toBe(6);
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

  it('дверь под переход от 1.2 м: выходы — двери не уже (кроме добора до минимума), за открытой — переход всегда', () => {
    const lenOf = (w: StreamWorld, [i, c]: [string, string]) => roomOf(w, i).connectors.find((x) => x.id === c)!.len;
    for (const seed of ['tr', 'tr2', 'tr3']) {
      const narrow: number[] = [];
      for (const min of [0.7, 1.2]) {
        const world = W((x) => Object.assign(x, { trAfter: 0, trBase: 1, trStep: 0, transitionMinLen: min }));
        const w = createStreamWorld(p, streamSettings(seed, { world }));
        const ex = exitsOf(w);
        const n = ex.filter((e) => lenOf(w, e) < min * 10).length;
        // уже предела — только добор до минимума выходов
        expect(n, `${seed} ${min} м`).toBeLessThanOrEqual(Math.max(0, world.clusterExits[0] - (ex.length - n)));
        narrow.push(ex.length);
        w.enter(w.startId!);
        expect(w.transitionState()!.pending).toBe(true);
        // гарантия — и за самой узкой из выходов
        const d = ex.reduce((a, b) => (lenOf(w, b) < lenOf(w, a) ? b : a));
        expect(roomOf(w, w.openDoor(...d)!).location, `${seed} ${min} м`).toBeTruthy();
      }
      // при 1.2 м выходов не больше, чем при 0.7 м
      expect(narrow[1]).toBeLessThanOrEqual(narrow[0]);
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
    const q: Project = { ...p, world: W((x) => Object.assign(x.walk, { shiftChance: 0.25, maxShift: 2, localRadius: 2, localM: 7, maxLayer: 30, sightM: 6, aheadDoors: 3 })) };
    const s = walkStreamSettings(q, { seed: 'x', deadEndChance: 0.1, branching: 1, aheadDoors: 5, clusters: true });
    expect(s.fold).toMatchObject({ shiftChance: 0.25, maxShift: 2, localRadius: 2, localM: 7, maxLayer: 30, seamless: false });
    expect(s.sightM).toBe(6);
    expect(s.aheadDoors).toBe(3);
    // прежний рост: «вперёд дверей» — из панели прогулки
    expect(walkStreamSettings(q, { seed: 'x', deadEndChance: 0.1, branching: 1, aheadDoors: 5, clusters: false }).aheadDoors).toBe(5);
    // складки действуют на рост
    const w = createStreamWorld(p, s);
    expect(w.settings.fold.maxShift).toBe(2);
  });

  it('4D-складки не ближе N м пути: квартиры и подвал — пересекающихся комнат ближе нет (проверка validateFoldRun), без предела — есть', () => {
    const grow = (localM: number, seed: string, biome?: string) => {
      const w = createStreamWorld(p, streamSettings(seed, { world: W((x) => { if (biome) x.startBiome = biome; }), fold: { ...DEFAULT_STREAM_FOLD, localM } }));
      if (biome) {
        // подвал: обход в ширину, пока не встанет 150 комнат
        const seen = new Set<string>();
        const q = [w.startId!];
        while (q.length && w.run().instances.length < 150) {
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
      } else {
        let id = w.startId!;
        for (let k = 0; k < 6; k++) {
          const ex = exitsOf(w, w.clusterAt(id)!.id);
          let next: string | null = null;
          for (let j = 0; j < ex.length && !next; j++) next = w.openDoor(...ex[(k + j) % ex.length]);
          if (!next) break;
          id = next;
        }
      }
      return w.run();
    };
    const close = (errs: string[]) => errs.filter((e) => e.includes('localM')).length;
    for (const [seed, biome] of [['m1', undefined], ['m2', undefined], ['m3', 'basement']] as const) {
      const run = grow(6, seed, biome);
      expect(run.settings.fold).toMatchObject({ localM: 6 });
      expect(validateFoldRun(p, run), seed).toEqual([]);
    }
    // без предела складки встают и за соседней дверью — та же проверка их видит
    const free = grow(0, 'm1');
    expect(validateFoldRun(p, free)).toEqual([]);
    expect(close(validateFoldRun(p, { ...free, settings: { ...free.settings, fold: { ...free.settings.fold!, localM: 6 } } }))).toBeGreaterThan(10);
  });

  it('4D-складки по метрам — и в прогоне фиксированного размера', () => {
    const fold = { shiftChance: 0.5, maxShift: 3, localRadius: 1, maxLayer: 12, seamless: false };
    const run = generateFoldRun(p, { seed: 'fm', count: 80, gap: 1, sightM: 9, fold: { ...fold, localM: 5 } });
    expect(run.instances.length).toBeGreaterThan(40);
    expect(validateFoldRun(p, run)).toEqual([]);
    const free = generateFoldRun(p, { seed: 'fm', count: 80, gap: 1, sightM: 9, fold });
    expect(validateFoldRun(p, { ...free, settings: { ...free.settings, fold: { ...fold, localM: 5 } } }).some((e) => e.includes('localM'))).toBe(true);
  });

  it('гарантия перехода: выпал — он за той дверью, которую открыл игрок (любой выход, с складками по метрам и без)', () => {
    let tried = 0;
    for (const localM of [0, 6]) {
      for (const seed of ['g1', 'g2', 'g3', 'g4', 'g5', 'g6']) {
        for (let k = 0; k < 4; k++) {
          const world = W((x) => Object.assign(x, { trAfter: 0, trBase: 1, trStep: 0 }));
          const w = createStreamWorld(p, streamSettings(seed, { world, fold: { ...DEFAULT_STREAM_FOLD, localM } }));
          let id = w.startId!;
          // k % 2 квартир пройти (переход ещё не выпал — счётчик не тронут), в следующей войти в комнату — выпал (100%)
          for (let s = 0; s < k % 2; s++) {
            const ex = exitsOf(w, w.clusterAt(id)!.id);
            id = (ex.length && w.openDoor(...ex[0])) || id;
          }
          const cid = w.clusterAt(id)!.id;
          w.enter(id);
          expect(w.transitionState()!.pending).toBe(true);
          const ex = exitsOf(w, cid);
          const t = w.openDoor(...ex[k % ex.length]);
          tried++;
          expect(t && roomOf(w, t).location?.kind, `${localM} ${seed} ${k}`).toMatch(/^(lift|stairwell)$/);
          expect(w.transitionState()!.pending).toBe(false);
          expect(validateFoldRun(p, w.run())).toEqual([]);
        }
      }
    }
    expect(tried).toBe(48);
  });
});
