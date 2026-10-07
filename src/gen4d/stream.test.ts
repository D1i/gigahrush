import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '../data/presets';
import { ALL4, project, rectRoom, strip } from '../gen/fixtures.test-util';
import { analyzeGrowth } from '../gen/generate';
import { makeRng } from '../model/rng';
import type { Project, Run } from '../model/types';
import { overlapPairs, validateFoldRun } from './fold';
import { computePvs } from './pvs';
import type { SightSpace } from './sight4d';
import {
  branchMul, createStreamWorld, DEFAULT_STREAM_FOLD, normStream, roomPrint, streamSettings, viewHorizonM, worldKey,
  type StreamSave, type StreamSettings, type StreamWorld,
} from './stream';

/** Пресеты. Поля отделки могут временно отсутствовать (их дописывают параллельно) — подстраховка. */
function presets(): Project {
  const p = createDefaultProject();
  p.finishes ??= [];
  p.finishRules ??= [];
  return p;
}

const neighbors = (run: Run, id: string): string[] => {
  const out: string[] = [];
  for (const l of run.links) {
    if (l.a.inst === id) out.push(l.b.inst);
    if (l.b.inst === id) out.push(l.a.inst);
  }
  return out;
};

/**
 * Случайное блуждание игрока: в каждой комнате — ensureAround, затем в случайного соседа (с вероятностью
 * explore — в ещё не посещённого). Соседи упорядочены по адресу — путь зависит только от мира и сида.
 * onStep — проверка после каждого шага. Возвращает текущую комнату.
 */
function randomWalk(w: StreamWorld, steps: number, seed: string, explore = 0.5, from = w.startId!, onStep?: (cur: string) => void): string {
  const R = makeRng(seed);
  let cur = from;
  const seen = new Set([cur]);
  w.ensureAround(cur);
  for (let k = 0; k < steps; k++) {
    const nb = neighbors(w.run(), cur).sort((a, b) => (w.addressOf(a)! < w.addressOf(b)! ? -1 : 1));
    if (nb.length === 0) throw new Error(`некуда идти из ${cur}`);
    const fresh = nb.filter((x) => !seen.has(x));
    const pool = fresh.length && R.next() < explore ? fresh : nb;
    cur = pool[R.int(0, pool.length - 1)];
    seen.add(cur);
    w.ensureAround(cur);
    onStep?.(cur);
  }
  return cur;
}

/** Совпадение двух миров по адресам: общие адреса, совпала постановка (комната, поворот, место), совпал и сдвиг
 *  порога dw связи с родителем; наполнение при совпавшей постановке обязано совпасть целиком. */
function compareByAddress(A: StreamWorld, B: StreamWorld): { common: number; placed: number; dw: number; contentBad: number } {
  const ra = A.run(), rb = B.run();
  const inB = new Map(rb.instances.map((i) => [B.addressOf(i.id)!, i]));
  const contentA = new Map(ra.content.map((c) => [c.inst, c]));
  const contentB = new Map(rb.content.map((c) => [c.inst, c]));
  const wA = new Map(ra.instances.map((i) => [i.id, i.w ?? 0]));
  const wB = new Map(rb.instances.map((i) => [i.id, i.w ?? 0]));
  let common = 0, placed = 0, dw = 0, contentBad = 0;
  for (const i of ra.instances) {
    const j = inB.get(A.addressOf(i.id)!);
    if (!j) continue;
    common++;
    if (i.roomId !== j.roomId || i.rot !== j.rot || i.dx !== j.dx || i.dy !== j.dy) continue;
    placed++;
    const dA = (i.w ?? 0) - (i.parent ? wA.get(i.parent)! : 0), dB = (j.w ?? 0) - (j.parent ? wB.get(j.parent)! : 0);
    if (dA === dB) dw++;
    // наполнение — от адреса: при той же постановке — то же самое (id экземпляров могут различаться)
    const ca = { ...contentA.get(i.id)!, inst: '', dangerAcc: 0 }, cb = { ...contentB.get(j.id)!, inst: '', dangerAcc: 0 };
    if (JSON.stringify(ca) !== JSON.stringify(cb)) contentBad++;
  }
  return { common, placed, dw, contentBad };
}

const fold = (f: Partial<StreamSettings['fold']>) => ({ ...DEFAULT_STREAM_FOLD, ...f });
const noSavedAt = (s: StreamSave) => ({ ...s, savedAt: 0, run: strip(s.run) });

describe('бесконечный мир: основа', { timeout: 120000 }, () => {
  const p = presets();

  it('старт — одна комната; ensureAround раскрывает ровно окно < doors по графу', () => {
    const w = createStreamWorld(p, streamSettings('base'));
    const run0 = w.run();
    expect(run0.instances.length).toBe(1);
    expect(w.startId).toBe('i0');
    expect(w.isExpanded('i0')).toBe(false);
    expect(run0.instances[0].roomId).toBe('landing_1464'); // тег start
    expect(w.ensureAround('i0', 0)).toEqual([]);
    const first = w.expand('i0');
    expect(first.length).toBeGreaterThan(0);
    expect(w.expand('i0')).toEqual([]); // уже раскрыт
    expect(w.expand('нет')).toEqual([]);
    // окно 2: стартовая и её соседи; соседи соседей — нет
    const nb = neighbors(w.run(), 'i0');
    w.ensureAround('i0', 2);
    for (const id of nb) expect(w.isExpanded(id)).toBe(true);
    const far = w.run().instances.filter((i) => !nb.includes(i.id) && i.id !== 'i0');
    expect(far.length).toBeGreaterThan(0);
    for (const i of far) expect(w.isExpanded(i.id)).toBe(false);
    // состояния дверей сходятся со связями и тупиками
    const run = w.run();
    const sv = w.save();
    const dead = new Set(sv.dead);
    for (const l of run.links) {
      expect(w.doorState(l.a.inst, l.a.connector)).toBe('linked');
      expect(w.doorState(l.b.inst, l.b.connector)).toBe('linked');
    }
    for (const o of run.openConnectors) {
      const st = w.doorState(o.inst, o.connector);
      expect(st).toBe(dead.has(`${o.inst}/${o.connector}`) ? 'dead' : 'pending');
      if (st === 'pending') expect(w.isExpanded(o.inst)).toBe(false);
    }
  });

  it('детерминизм: тот же сид и те же действия — тот же мир; другой сид или модификатор — другой', () => {
    const play = (s: StreamSettings) => {
      const w = createStreamWorld(p, s);
      randomWalk(w, 120, 'walk');
      return w;
    };
    const a = play(streamSettings('det')), b = play(streamSettings('det'));
    expect(strip(a.run())).toEqual(strip(b.run()));
    expect(noSavedAt(a.save())).toEqual(noSavedAt(b.save()));
    const c = play(streamSettings('det2'));
    expect(JSON.stringify(c.run().instances)).not.toBe(JSON.stringify(a.run().instances));
    const m = play(streamSettings('det', { mods: ['тьма'] }));
    expect(JSON.stringify(m.run().instances)).not.toBe(JSON.stringify(a.run().instances));
    expect(worldKey('det', [])).toBe('room-forge/world/det');
    expect(worldKey('det', ['тьма', 'x'])).toBe('room-forge/world/det+тьма+x');
  });

  it('настройки нормализуются; Run.settings — складчатый режим', () => {
    const s = normStream({ seed: 'n', deadEndChance: 7, branching: -1, aheadDoors: 2.7, gap: -3, sightM: -1, match: 'x' as never, fold: { maxShift: 99, seamless: undefined } as never });
    expect(s).toMatchObject({ deadEndChance: 1, branching: 0, aheadDoors: 2, gap: 0, sightM: 0, match: 'exact', mods: [] });
    expect(s.fold).toEqual({ ...DEFAULT_STREAM_FOLD, maxShift: 64 });
    const run = createStreamWorld(p, streamSettings('n')).run();
    expect(run.settings.mode).toBe('fold');
    expect(run.settings.fold).toEqual(DEFAULT_STREAM_FOLD);
  });

  it('onChange: уведомление о новых экземплярах; отписка', () => {
    const w = createStreamWorld(p, streamSettings('ev'));
    const got: string[][] = [];
    const off = w.onChange((ids) => got.push(ids));
    const ids = w.ensureAround('i0');
    expect(got.length).toBe(1);
    expect(got[0]).toEqual(ids);
    w.ensureAround('i0'); // ничего нового
    expect(got.length).toBe(1);
    off();
    w.expand(ids[ids.length - 1]);
    expect(got.length).toBe(1);
  });
});

describe('бесконечный мир: бесконечность, тупики, ветвистость', { timeout: 300000 }, () => {
  const p = presets();

  it('случайное блуждание 2000 шагов: всегда есть куда идти, у мира всегда есть нераскрытая ростовая дверь', () => {
    for (const seed of ['inf1', 'inf2']) {
      const w = createStreamWorld(p, streamSettings(seed, { deadEndChance: 0.5 }));
      let minGrow = Infinity;
      randomWalk(w, 2000, `walk-${seed}`, 0.6, w.startId!, () => { minGrow = Math.min(minGrow, w.stats().pendingGrow); });
      const st = w.stats();
      console.log(`[stream] блуждание 2000 шагов, deadEndChance 0.5, сид ${seed}: комнат ${st.instances}, раскрыто ${st.expanded}, ` +
        `минимум нераскрытых ростовых дверей ${minGrow}, слоёв ${st.layers}, пар в одном месте 3D ${st.overlaps}`);
      expect(minGrow).toBeGreaterThanOrEqual(1);
      expect(st.instances).toBeGreaterThan(200);
    }
  });

  it('deadEndChance 0 / 0.15 / 0.5: доля тупиков растёт; при 0 тупики только «не встало»', () => {
    const rows: string[] = [];
    const share: number[] = [];
    for (const dead of [0, 0.15, 0.5]) {
      let chance = 0, fail = 0, all = 0, inst = 0;
      for (const seed of ['d1', 'd2', 'd3']) {
        const w = createStreamWorld(p, streamSettings(seed, { deadEndChance: dead }));
        randomWalk(w, 600, `walk-${seed}`, 0.7);
        const st = w.stats();
        chance += st.deadChance; fail += st.deadFail; all += st.grown + st.loops + st.deadChance + st.deadFail; inst += st.instances;
      }
      share.push((chance + fail) / all);
      rows.push(`deadEndChance ${dead}: решено дверей ${all}, тупиков ${(100 * (chance + fail) / all).toFixed(1)}% (по шансу ${chance}, не встало ${fail}), комнат ${inst}`);
      if (dead === 0) expect(chance).toBe(0);
    }
    console.log(`[stream] тупики (3 сида × 600 шагов):\n  ${rows.join('\n  ')}`);
    expect(share[0]).toBeLessThan(0.15);
    expect(share[1]).toBeGreaterThan(share[0]);
    expect(share[2]).toBeGreaterThan(0.3);
    expect(share[2]).toBeLessThan(0.6);
  });

  it('branching: развилки (≥ 3 ростовые метки) чаще среди хабов; множитель — branching^(ходов − 1)', () => {
    expect(branchMul([true, true], 3)).toBe(1);
    expect(branchMul([true, true, true], 3)).toBe(3);
    expect(branchMul([true, true, true, true, false], 3)).toBe(9);
    const grow = analyzeGrowth(p, { match: 'exact', sightM: 9 });
    const g = (roomId: string) => grow[roomId]?.grow.filter(Boolean).length ?? 0;
    const forks = (b: number) => {
      let fork = 0, hub = 0;
      for (const seed of ['b1', 'b2', 'b3', 'b4']) {
        const w = createStreamWorld(p, streamSettings(seed, { branching: b }));
        randomWalk(w, 300, `walk-${seed}`, 0.7);
        for (const i of w.run().instances.slice(1)) {
          if (g(i.roomId) >= 2) hub++;
          if (g(i.roomId) >= 3) fork++;
        }
      }
      return fork / hub;
    };
    const lo = forks(0.25), mid = forks(1), hi = forks(4);
    console.log(`[stream] ветвистость: доля развилок среди поставленных хабов — branching 0.25: ${lo.toFixed(3)}, 1: ${mid.toFixed(3)}, 4: ${hi.toFixed(3)}`);
    expect(hi).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(lo);
  });
});

describe('бесконечный мир: сохранение', { timeout: 300000 }, () => {
  const p = presets();

  it('сохранение → JSON → загрузка → продолжение = то же, что без сохранения', () => {
    for (const s of [streamSettings('sv1'), streamSettings('sv2', { deadEndChance: 0.4, branching: 2 }), streamSettings('sv3', { sightM: 0 })]) {
      const A = createStreamWorld(p, s);
      const cur = randomWalk(A, 200, 'first', 0.7);
      const saved: StreamSave = JSON.parse(JSON.stringify(A.save()));
      const B = createStreamWorld(p, { ...s, seed: 'не тот' }, saved); // настройки берутся из сохранения
      expect(B.stale).toBe(false);
      expect(B.settings).toEqual(A.settings);
      // восстановлено без генерации: тот же прогон (наполнение выведено из адресов заново — совпадает)
      expect(strip(B.run())).toEqual(strip(A.run()));
      expect(B.stats()).toMatchObject({ ...A.stats(), expandMsAvg: expect.any(Number), expandMsP95: expect.any(Number), expandMsMax: expect.any(Number), expands: expect.any(Number) });
      for (const i of A.run().instances) expect(B.isExpanded(i.id)).toBe(A.isExpanded(i.id));
      // продолжение
      randomWalk(A, 200, 'second', 0.7, cur);
      randomWalk(B, 200, 'second', 0.7, cur);
      expect(strip(B.run())).toEqual(strip(A.run()));
      expect(noSavedAt(B.save())).toEqual(noSavedAt(A.save()));
    }
  });

  it('формат компактный: без клеток и наполнения; отпечатки комнат', () => {
    const w = createStreamWorld(p, streamSettings('size'));
    randomWalk(w, 400, 'walk', 0.8);
    const sv = w.save();
    const json = JSON.stringify(sv);
    const n = sv.run.instances.length;
    console.log(`[stream] сохранение: ${n} комнат — ${(json.length / 1024).toFixed(0)} КБ (${(json.length / n).toFixed(0)} Б на комнату)`);
    expect(sv.format).toBe('room-forge-world');
    expect(sv.run.content).toEqual([]);
    expect(json.includes('"cells"')).toBe(false);
    expect(json.length / n).toBeLessThan(600);
    for (const id of new Set(sv.run.instances.map((i) => i.roomId))) expect(sv.rooms![id]).toBe(roomPrint(p.rooms.find((r) => r.id === id)!));
  });

  it('комната изменилась или удалена — мир «устарел»: предупреждение, мир начат заново с того же сида', () => {
    const s = streamSettings('stale');
    const w = createStreamWorld(p, s);
    randomWalk(w, 50, 'walk', 0.8);
    const sv = JSON.parse(JSON.stringify(w.save())) as StreamSave;
    const used = sv.run.instances[1].roomId;
    // изменить клетки одной из комнат мира
    const changed: Project = { ...p, rooms: p.rooms.map((r) => (r.id === used ? { ...r, cells: new Set([...r.cells].slice(1)) } : r)) };
    const a = createStreamWorld(changed, s, sv);
    expect(a.stale).toBe(true);
    expect(a.warnings.some((x) => x.startsWith('Сохранённый мир устарел') && x.includes('изменена'))).toBe(true);
    expect(a.run().instances.length).toBe(1);
    expect(a.run().warnings.some((x) => x.startsWith('Сохранённый мир устарел'))).toBe(true);
    // удалить
    const removed: Project = { ...p, rooms: p.rooms.filter((r) => r.id !== used) };
    const b = createStreamWorld(removed, s, sv);
    expect(b.stale).toBe(true);
    expect(b.warnings.some((x) => x.includes('удалена'))).toBe(true);
    // правка не геометрии (лут) — не устарел
    const loot: Project = { ...p, rooms: p.rooms.map((r) => (r.id === used ? { ...r, loot: [] } : r)) };
    expect(createStreamWorld(loot, s, sv).stale).toBe(false);
  });
});

describe('бесконечный мир: детерминизм по адресам', { timeout: 300000 }, () => {
  const p = presets();

  it('две разные истории раскрытий: наполнение по адресу не зависит от порядка; постановка совпадает почти всегда', () => {
    let common = 0, placed = 0, dw = 0, contentBad = 0;
    for (const seed of ['o1', 'o2', 'o3', 'o4', 'o5', 'o6']) {
      const s = streamSettings(seed);
      // два игрока-блуждателя x и y: в мире A сначала ходит x, потом y; в мире B — наоборот
      const A = createStreamWorld(p, s), B = createStreamWorld(p, s);
      randomWalk(A, 150, 'x', 0.8); randomWalk(A, 150, 'y', 0.8);
      randomWalk(B, 150, 'y', 0.8); randomWalk(B, 150, 'x', 0.8);
      const r = compareByAddress(A, B);
      common += r.common; placed += r.placed; dw += r.dw; contentBad += r.contentBad;
    }
    console.log(`[stream] порядок раскрытий (6 сидов, 2 истории): общих адресов ${common}, постановка совпала ${(100 * placed / common).toFixed(1)}%, ` +
      `из них сдвиг порога dw совпал ${(100 * dw / placed).toFixed(1)}%, наполнение при совпавшей постановке не совпало — ${contentBad}`);
    expect(contentBad).toBe(0);
    expect(placed / common).toBeGreaterThan(0.95);
  });
});

describe('бесконечный мир: проверка и 4D', { timeout: 300000 }, () => {
  const p = presets();

  it('validateFoldRun чист на снимке мира (по умолчанию, без предела обзора, с бесшовностью)', () => {
    const cases: [string, StreamSettings, number][] = [
      ['по умолчанию', streamSettings('v1'), 300],
      ['deadEnd 0.4, branching 3', streamSettings('v2', { deadEndChance: 0.4, branching: 3 }), 300],
      ['sightM 0', streamSettings('v3', { sightM: 0 }), 200],
      ['sightM 7', streamSettings('v4', { sightM: 7 }), 200],
      ['seamless', streamSettings('v5', { fold: fold({ seamless: true }) }), 120],
    ];
    for (const [name, s, steps] of cases) {
      const w = createStreamWorld(p, s);
      try {
        randomWalk(w, steps, 'walk', 0.8);
      } catch {
        // бесшовный мир может заглохнуть — проверяем то, что построено
      }
      const run = w.run();
      expect(validateFoldRun(p, run), name).toEqual([]);
      if (s.sightM > 0) {
        expect(Object.keys(run.pvs!).length).toBe(run.instances.length);
        expect(run.sight.maxM).toBeLessThanOrEqual(s.sightM + 1e-9);
      } else expect(run.pvs).toBeUndefined();
    }
  });

  it('пересечения в 3D многочисленны (это и есть 4D): разные слои, не соседи; сводка сходится', () => {
    const rows: string[] = [];
    for (const seed of ['x1', 'x2', 'x3']) {
      const w = createStreamWorld(p, streamSettings(seed));
      randomWalk(w, 500, 'walk', 0.8);
      const run = w.run();
      const pairs = overlapPairs(p, run);
      expect(pairs.length).toBe(run.fold!.overlaps);
      expect(pairs.length).toBeGreaterThan(run.instances.length);
      const byId = new Map(run.instances.map((i) => [i.id, i]));
      const linked = new Set(run.links.map((l) => [l.a.inst, l.b.inst].sort().join('|')));
      for (const [a, b] of pairs) {
        expect(byId.get(a)!.w).not.toBe(byId.get(b)!.w);
        expect(linked.has([a, b].sort().join('|'))).toBe(false);
      }
      const st = w.stats();
      rows.push(`${seed}: комнат ${run.instances.length}, слоёв ${st.layers} (W ${st.minW}…${st.maxW}), пар в одном месте 3D ${pairs.length} ` +
        `(${(pairs.length / run.instances.length).toFixed(1)} на комнату), порогов со сдвигом ${st.shifted} из ${run.links.length}`);
    }
    console.log(`[stream] 4D (500 шагов):\n  ${rows.join('\n  ')}`);
  });

  it('ensureVisible: все комнаты PVS раскрыты — в поле зрения ничего не появится; глубина PVS по дверям', () => {
    const w = createStreamWorld(p, streamSettings('vis'));
    randomWalk(w, 150, 'walk', 0.8, w.startId!, (cur) => {
      w.ensureVisible(cur);
      for (const id of w.run().pvs![cur]) expect(w.isExpanded(id)).toBe(true);
    });
    // глубина PVS (в дверях по графу) — сколько надо раскрывать вперёд, чтобы мир был готов до того, как его увидят
    const run = w.run();
    const hist = new Map<number, number>();
    for (const i of run.instances) {
      if (!w.isExpanded(i.id)) continue;
      const d = new Map([[i.id, 0]]);
      let fr = [i.id];
      for (let k = 1; fr.length; k++) {
        const nx: string[] = [];
        for (const x of fr) for (const y of neighbors(run, x)) if (!d.has(y)) { d.set(y, k); nx.push(y); }
        fr = k < 10 ? nx : [];
      }
      const m = Math.max(...run.pvs![i.id].map((x) => d.get(x) ?? 99));
      hist.set(m, (hist.get(m) ?? 0) + 1);
    }
    console.log(`[stream] глубина PVS в дверях (комнат): ${[...hist].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}: ${v}`).join(', ')}`);
  });

  it('ensureVisible с дальностью горизонта (viewHorizonM): раскрыто всё, что видно сквозь проёмы до него; детерминизм', () => {
    expect([viewHorizonM(9), viewHorizonM(6), viewHorizonM(0)]).toEqual([27, 24, 40]);
    const walk = (w: StreamWorld, check: boolean) => {
      const reach = viewHorizonM(w.settings.sightM);
      const S = (w as unknown as { lay: { sight: SightSpace } }).lay.sight;
      const cellM = p.settings.cellM;
      let bigger = 0;
      randomWalk(w, 120, 'walk-far', 0.8, w.startId!, (cur) => {
        w.ensureVisible(cur); // по умолчанию — горизонт
        if (!check) return;
        const run = w.run();
        const order = run.instances.find((i) => i.id === cur)!.order;
        const far = computePvs(S, order, reach / cellM, 0.05 / cellM).map((m) => run.instances[m].id);
        for (const id of far) expect(w.isExpanded(id), `${cur}: ${id}`).toBe(true);
        // дальний набор — надмножество PVS (sightM), а он раскрыт тоже
        const near = run.pvs![cur];
        for (const id of near) expect(w.isExpanded(id)).toBe(true);
        if (far.length > near.length) bigger++;
      });
      return bigger;
    };
    const a = createStreamWorld(p, streamSettings('vis-far'));
    expect(walk(a, true)).toBeGreaterThan(0); // дальний набор бывает шире PVS
    expect(validateFoldRun(p, a.run())).toEqual([]);
    const b = createStreamWorld(p, streamSettings('vis-far'));
    walk(b, false);
    expect(noSavedAt(b.save())).toEqual(noSavedAt(a.save()));
  });

  it('петли: на коробках с дверями на всех сторонах мир замыкается сам на себя; гарантии целы', () => {
    const q = project([rectRoom('b', 20, 20, { tags: ['start'], conns: ALL4(8) }), rectRoom('c', 30, 20, { conns: ALL4(8) })]);
    let loops = 0;
    for (const seed of ['l1', 'l2', 'l3']) {
      const w = createStreamWorld(q, streamSettings(seed, { fold: fold({ shiftChance: 0.2, maxShift: 2 }), sightM: 0, deadEndChance: 0 }));
      randomWalk(w, 200, 'walk', 0.8);
      loops += w.stats().loops;
      expect(validateFoldRun(q, w.run())).toEqual([]);
    }
    expect(loops).toBeGreaterThan(0);
  });

  it('unique — один раз на мир', () => {
    const q = project([
      rectRoom('hub', 20, 20, { tags: ['start'], conns: ALL4(8), max: 999 }),
      rectRoom('one', 20, 20, { conns: ALL4(8), unique: true, weight: 50 }),
    ]);
    const w = createStreamWorld(q, streamSettings('u', { sightM: 0 }));
    randomWalk(w, 150, 'walk', 0.8);
    expect(w.run().instances.filter((i) => i.roomId === 'one').length).toBe(1);
  });
});
