// Сарай и площадка-переход бесконечного мира (docs/GENERATOR-4D.md §19): сеть проходов сарая из своих комнат, комнаты
// «только в биоме» вне биомов не растут, переход — обычная лестничная площадка, старт прогулки в выбранном биоме.
import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '../data/presets';
import { BIOME_ONLY_TAG, generateRun } from '../gen/generate';
import type { Project, Run, WorldSettings } from '../model/types';
import { newWorldSettings } from './biomes';
import { generateFoldRun, validateFoldRun } from './fold';
import { createStreamWorld, streamSettings, type StreamSave, type StreamWorld } from './stream';
import { walkBiome, walkStreamSettings } from '../view3d/walk';

const project = (): Project => {
  const p = createDefaultProject();
  p.finishes ??= [];
  p.finishRules ??= [];
  return p;
};
const p = project();
const roomOf = (run: Run, id: string) => p.rooms.find((r) => r.id === run.instances.find((i) => i.id === id)!.roomId)!;
const world = (o: Partial<WorldSettings> = {}): WorldSettings => ({ ...newWorldSettings(), ...o });
const barn = (seed: string, o: Partial<WorldSettings> = {}) =>
  createStreamWorld(p, streamSettings(seed, { world: world({ startBiome: 'barn', trAfter: 100000, ...o }) }));

/** «Пройти» мир: раскрыть экземпляры в ширину от from, пока комнат меньше n. */
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

/** Закрытые выходы мира (cid — только этой квартиры): [экземпляр, метка]. */
function exitsOf(w: StreamWorld, cid?: number): [string, string][] {
  const out: [string, string][] = [];
  const run = w.run();
  for (const i of run.instances) {
    if (cid !== undefined && w.clusterAt(i.id)?.id !== cid) continue;
    for (const c of roomOf(run, i.id).connectors) if (w.doorState(i.id, c.id) === 'exit') out.push([i.id, c.id]);
  }
  return out;
}
const wide = (w: StreamWorld, cid?: number) => exitsOf(w, cid).filter(([i, c]) => roomOf(w.run(), i).connectors.find((x) => x.id === c)!.len >= 7);

/** Мир с выпавшим переходом сразу (trAfter 0, шанс 100%): открыть первый широкий выход старта — за ним переход. */
function transitionAtStart(seed: string, o: Partial<WorldSettings>): { w: StreamWorld; t: string; exits: [string, string][] } {
  const w = createStreamWorld(p, streamSettings(seed, { world: world({ trAfter: 0, trBase: 1, trStep: 0, ...o }) }));
  w.enter(w.startId!);
  const exits = wide(w, 0);
  const t = w.openDoor(exits[0][0], exits[0][1])!;
  return { w, t, exits };
}

describe('сарай: сеть проходов', { timeout: 300000 }, () => {
  it('проходы: гирлянда по одной стене, с другой — открытые стойла (перегородки, ясли), вместо стойла — проход; ковров и сена нет', () => {
    const barnRooms = p.rooms.filter((r) => r.tags[0] === 'сарай');
    const passes = barnRooms.filter((r) => r.tags.includes('ход') && !r.tags.includes('поворот'));
    expect(passes.length).toBeGreaterThanOrEqual(6);
    for (const r of passes) {
      const garl = r.decor.filter((d) => d.propId === 'p_barn_garland');
      expect(garl.length, r.id).toBeGreaterThan(0);
      // гирлянда — у восточной стены (rot 90), ответвление — на западной (сторона стойл)
      expect(garl.every((d) => d.rot === 90), r.id).toBe(true);
      const side = r.connectors.filter((c) => c.side === 'E' || c.side === 'W');
      expect(side.every((c) => c.side === 'W'), r.id).toBe(true);
      // стойла — в самом куске, без дверей: ясли в каждом стойле (кроме того, что стало проходом), перегородки между
      if (r.id === 'barn_tun_1') continue;
      const mangers = r.decor.filter((d) => d.propId === 'p_barn_manger').length;
      const divs = r.decor.filter((d) => d.propId === 'p_barn_stall_div').length;
      expect(mangers, r.id).toBeGreaterThanOrEqual(1);
      expect(divs, r.id).toBe(mangers + side.length - 1);
    }
    expect(barnRooms.every((r) => r.connectors.every((c) => c.tag === 'barn' || c.tag === 'stair'))).toBe(true);
    // длинные: есть куски 6 и 8 м
    expect(passes.some((r) => r.id === 'barn_tun_8')).toBe(true);
    const props = new Set(barnRooms.flatMap((r) => r.decor.map((d) => d.propId)));
    const pr = new Map(p.props.map((x) => [x.id, x]));
    for (const id of props) expect(pr.get(id)!.tags.some((t) => ['ковёр', 'ковер', 'сено', 'дорожка'].includes(t)), id).toBe(false);
    // света, кроме гирлянд, нет; биом тёмный
    expect(props.has('p_bsm_bulb')).toBe(false);
    expect(newWorldSettings().biomes.find((b) => b.id === 'barn')!.dark).toBeGreaterThan(0.5);
  });

  it('старт в сарае — хаб с лестницей-выходом; растут только комнаты сарая, проходы 1.5 м; отделка — доски', () => {
    for (const seed of ['b1', 'b2']) {
      const w = barn(seed, { tunnels: { ...newWorldSettings().tunnels, ring: 0, loop: 0 } });
      const start = roomOf(w.run(), w.startId!);
      expect(start.tags).toEqual(expect.arrayContaining(['сарай', 'хаб']));
      expect(w.clusterAt(w.startId!)).toMatchObject({ tunnels: true, biome: { id: 'barn' } });
      const stair = start.connectors.find((c) => c.tag === 'stair')!;
      expect(w.doorState(w.startId!, stair.id)).toBe('exit');
      walk(w, 160);
      const run = w.run();
      expect(run.instances.length).toBeGreaterThanOrEqual(120);
      for (const i of run.instances) expect(roomOf(run, i.id).tags[0], i.roomId).toBe('сарай');
      const kinds = (t: string) => run.instances.filter((i) => roomOf(run, i.id).tags.includes(t)).length;
      // длинные проходы, хабы редкие (hubEvery сарая — 60…140 м хода)
      expect(kinds('хаб')).toBeGreaterThanOrEqual(1);
      expect(kinds('ход')).toBeGreaterThan(kinds('хаб') * 10);
      // стойла — по всему ходу: ясли в кусках
      expect(run.instances.reduce((n, i) => n + roomOf(run, i.id).decor.filter((d) => d.propId === 'p_barn_manger').length, 0)).toBeGreaterThan(40);
      // куски направлены: за выходом — вход (стойла по одну руку); без колец и швов — у всех связей роста
      let flows = 0, bad = 0;
      for (const l of run.links) {
        if (l.kind || l.wrap || l.loose) continue;
        const ra = roomOf(run, l.a.inst), rb = roomOf(run, l.b.inst);
        if (ra.tags.includes('хаб') || rb.tags.includes('хаб')) continue;
        const ca = ra.connectors.find((c) => c.id === l.a.connector)!, cb = rb.connectors.find((c) => c.id === l.b.connector)!;
        flows++;
        if ((ca.side === 'S') === (cb.side === 'S')) bad++;
      }
      expect(flows).toBeGreaterThan(50);
      expect(bad / flows, `${bad} из ${flows}`).toBeLessThan(0.05);
      // проходы сарая — 1.5 м, с подвальными (1.0 м) не стыкуются
      for (const l of run.links) {
        if (l.kind || l.wrap) continue;
        const ca = roomOf(run, l.a.inst).connectors.find((c) => c.id === l.a.connector)!;
        if (ca.tag === 'barn') expect(ca.len).toBe(15);
      }
      for (const [k, i] of run.instances.entries()) {
        expect(['f_barn_vertical', 'f_barn_rust', 'f_barn_horizontal'], i.roomId).toContain(run.content[k].finish?.wall);
        expect(['f_barn_floor', 'f_barn_floor_grey'], i.roomId).toContain(run.content[k].finish?.floor);
      }
      expect(validateFoldRun(p, run)).toEqual([]);
    }
  });

  it('кольца из хаба и бесконечные прямые участки — как в подвале', () => {
    let rings = 0, wraps = 0;
    for (const seed of ['r1', 'r2', 'r3', 'r4']) {
      const w = barn(seed, { tunnels: { ...newWorldSettings().tunnels, ring: 1, loop: 0.3 } });
      walk(w, 120);
      rings += w.stats().rings;
      wraps += w.stats().wraps;
      expect(validateFoldRun(p, w.run())).toEqual([]);
    }
    expect(rings).toBeGreaterThanOrEqual(2);
    expect(wraps).toBeGreaterThanOrEqual(1);
  });

  it('выход из сарая — лестница хаба: за ней квартиры, остальные выходы сарая исчезают', () => {
    const w = barn('up');
    walk(w, 80);
    const exits = exitsOf(w);
    expect(exits.length).toBeGreaterThanOrEqual(1);
    const id = w.openDoor(...exits[0])!;
    expect(id).toBeTruthy();
    const cl = w.clusterAt(id)!;
    expect(cl.tunnels).toBe(false);
    expect(roomOf(w.run(), id).tags).not.toContain('сарай');
    for (const [x, y] of exits.slice(1)) expect(w.doorState(x, y)).toBe('dead');
    expect(validateFoldRun(p, w.run())).toEqual([]);
  });

  it('вне биомов сарая нет: прежняя прогулка, евклидов и складчатый прогон; «Спуск в подвал» — только в подвал', () => {
    const only = (run: Run) => run.instances.filter((i) => p.rooms.find((r) => r.id === i.roomId)!.tags.includes(BIOME_ONLY_TAG));
    expect(p.rooms.filter((r) => r.tags.includes(BIOME_ONLY_TAG) && r.tags[0] === 'сарай').length).toBe(11);
    const legacy = createStreamWorld(p, streamSettings('legacy'));
    walk(legacy, 400);
    expect(only(legacy.run())).toEqual([]);
    for (const seed of ['g1', 'g2', 'g3']) {
      expect(only(generateRun(p, { seed, count: 80 }))).toEqual([]);
      expect(only(generateFoldRun(p, { seed, count: 80, mode: 'fold' }))).toEqual([]);
    }
    // «Спуск в подвал»: выход с меткой хода — в хаб подвала, не сарая (проходы сарая с ним не стыкуются)
    let downs = 0;
    for (const seed of ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8']) {
      const w = createStreamWorld(p, streamSettings(seed, { world: world({ trAfter: 100000 }) }));
      let id = w.startId!;
      for (let k = 0; k < 30; k++) {
        const cid = w.clusterAt(id)!.id;
        const ex = exitsOf(w, cid);
        const down = ex.find(([i, c]) => roomOf(w.run(), i).connectors.find((x) => x.id === c)!.tag === 'basement');
        if (down) {
          const hub = w.openDoor(...down)!;
          expect(w.clusterAt(hub)!.biome?.id).toMatch(/^basement/);
          downs++;
          break;
        }
        if (!ex.length) break;
        id = w.openDoor(...ex[k % ex.length]) ?? id;
      }
    }
    expect(downs).toBeGreaterThanOrEqual(2);
  });

  it('сохранение → загрузка: сарай растёт дальше так же', () => {
    const a = barn('save', { tunnels: { ...newWorldSettings().tunnels, ring: 1, loop: 0.3 } });
    walk(a, 70);
    const sv: StreamSave = JSON.parse(JSON.stringify(a.save()));
    const b = createStreamWorld(p, a.settings, sv);
    expect(b.stale).toBe(false);
    walk(a, 130);
    walk(b, 130);
    expect(b.run().instances.map((i) => [i.roomId, i.dx, i.dy, i.w])).toEqual(a.run().instances.map((i) => [i.roomId, i.dx, i.dy, i.w]));
  });
});

describe('переход — лестничная площадка', { timeout: 300000 }, () => {
  it('trLanding 1: за дверью — площадка (без спец-локации), все её двери — выходы; вход в неё в счёт не идёт', () => {
    for (const seed of ['l1', 'l2', 'l3']) {
      const { w, t } = transitionAtStart(seed, { trLanding: 1, trToBiome: 1 });
      const room = roomOf(w.run(), t);
      expect(room.tags).toContain('лестница');
      expect(room.location).toBeUndefined();
      expect(w.locationOf(t)).toBeNull();
      expect(w.clusterAt(w.startId!)!.transition).toBe(t);
      expect(w.transitionState()!.pending).toBe(false);
      const doors = exitsOf(w).filter(([i]) => i === t);
      expect(doors.length).toBeGreaterThanOrEqual(2);
      expect(w.enter(t)).toMatchObject({ counted: false });
      expect(validateFoldRun(p, w.run())).toEqual([]);
    }
  });

  it('прошёл площадку — другой биом, счётчик с нуля, остальные её двери исчезают; назад — через ту же дверь', () => {
    for (const seed of ['p1', 'p2', 'p3', 'p4']) {
      const { w, t } = transitionAtStart(seed, { trLanding: 1, trToBiome: 1 });
      w.enter(t);
      const doors = exitsOf(w).filter(([i]) => i === t);
      const id = w.openDoor(...doors[0])!;
      expect(id).toBeTruthy();
      const cl = w.clusterAt(id)!;
      expect(cl.biome?.id).not.toBe('khrush');
      expect(cl.rich).toBe(false);
      expect(w.transitionState()).toMatchObject({ count: 0, pending: false, resets: 1 });
      for (const [x, y] of doors.slice(1)) expect(w.doorState(x, y)).toBe('dead');
      // дверь, через которую прошёл, — связь (можно вернуться)
      expect(w.doorState(...doors[0])).toBe('linked');
      expect(validateFoldRun(p, w.run())).toEqual([]);
    }
  });

  it('trToBiome 0 — площадка ведёт в богатую квартиру; trLanding 0 — переход только спец-комната', () => {
    const { w, t } = transitionAtStart('rich', { trLanding: 1, trToBiome: 0 });
    const id = w.openDoor(...exitsOf(w).filter(([i]) => i === t)[0])!;
    expect(w.clusterAt(id)).toMatchObject({ rich: true, home: { id: 'khrush' } });
    for (const seed of ['s1', 's2', 's3']) {
      const x = transitionAtStart(seed, { trLanding: 0 });
      expect(x.w.locationOf(x.t)?.kind).toMatch(/stairwell|lift/);
    }
  });

  it('площадку переходом пропустил — она исчезает, как спец-комната', () => {
    const { w, t, exits } = transitionAtStart('skip', { trLanding: 1 });
    w.openDoor(...exits[1]);
    const link = w.run().links.find((l) => !l.kind && (l.a.inst === t || l.b.inst === t))!;
    expect(link.sealed).toBe(true);
    const side = link.a.inst === t ? link.b : link.a;
    expect(w.doorState(side.inst, side.connector)).toBe('dead');
  });

  it('сохранение → загрузка: площадка-переход и её выходы; проход после загрузки — тот же', () => {
    const { w: a, t } = transitionAtStart('lsave', { trLanding: 1, trToBiome: 1 });
    const sv: StreamSave = JSON.parse(JSON.stringify(a.save()));
    const b = createStreamWorld(p, a.settings, sv);
    expect(b.stale).toBe(false);
    const da = exitsOf(a).filter(([i]) => i === t);
    expect(exitsOf(b).filter(([i]) => i === t)).toEqual(da);
    const ia = a.openDoor(...da[0])!, ib = b.openDoor(...da[0])!;
    expect(ib).toBe(ia);
    expect(b.clusterAt(ib)!.biome?.id).toBe(a.clusterAt(ia)!.biome?.id);
    expect(b.transitionState()).toEqual(a.transitionState());
  });
});

describe('«Прогулка»: биом старта', () => {
  it('выбранный биом — старт мира; стартовый биом проекта и богатый — мир проекта как есть', () => {
    const o = { seed: 'x', deadEndChance: 0.1, branching: 1, aheadDoors: 2, clusters: true };
    expect(walkStreamSettings(p, { ...o, biome: 'barn' }).world?.startBiome).toBe('barn');
    expect(walkStreamSettings(p, { ...o, biome: 'khrush' }).world?.startBiome).toBe(p.world.startBiome);
    expect(walkStreamSettings(p, { ...o, biome: null }).world?.startBiome).toBe(p.world.startBiome);
    expect(walkBiome(p, { clusters: true, biome: 'rich' })).toBeNull();
    expect(walkBiome(p, { clusters: true, biome: 'нет-такого' })).toBeNull();
    expect(walkBiome(p, { clusters: false, biome: 'barn' })).toBeNull();
    const w = createStreamWorld(p, walkStreamSettings(p, { ...o, biome: 'barn' }));
    expect(w.clusterAt(w.startId!)?.biome?.id).toBe('barn');
  });
});
