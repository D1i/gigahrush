// Санаторий (docs/GENERATOR-4D.md, раздел «Санаторий»): обычное трёхмерное здание без 4D — флаг биома Biome.flat.
// Сеть ходов flat-биома растёт евклидово: все её комнаты в одном слое W (слой родителя, dw = 0), занятость — против
// всех комнат слоя, первая комната сети — на свежем слое (ни одной комнаты там ещё нет), колец, швов, петель со сдвигом,
// стыковок loose и ослаблений localM (close) внутри нет. Флаг проверяется и на копии общаги с flat (не зависит от комнат
// санатория), и на самом санатории.
import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '../data/presets';
import { BIOME_ONLY_TAG, generateRun } from '../gen/generate';
import { strip } from '../gen/fixtures.test-util';
import { instanceWorld } from '../gen/world';
import { parseKey } from '../model/cells';
import type { Biome, Project, Room, Run, WorldSettings } from '../model/types';
import { biomeMul, defaultBiomes, isFlat, newWorldSettings, normBiome, normWorld, tunnelKind } from './biomes';
import { validateFoldRun } from './fold';
import { roomSightM } from './space';
import { createStreamWorld, streamSettings, type StreamSave, type StreamWorld } from './stream';
import { DEFAULT_WALK, walkStreamSettings } from '../view3d/walk';
import { DOOR_STYLE_BY_ID, doorGeometry, doorStyleFor, leafHere } from '../blockout/doors';

const project = (): Project => {
  const p = createDefaultProject();
  p.finishes ??= [];
  p.finishRules ??= [];
  return p;
};
const p = project();
const byId = new Map(p.rooms.map((r) => [r.id, r]));
const roomOf = (run: Run, id: string) => byId.get(run.instances.find((i) => i.id === id)!.roomId)!;
const has = (r: Room, t: string) => r.tags.includes(t);
const world = (o: Partial<WorldSettings> = {}): WorldSettings => ({ ...newWorldSettings(), ...o });
const biome = (id: string): Biome => newWorldSettings().biomes.find((b) => b.id === id)!;
/** Мир с копией общаги — flat-биомом (или без flat — контроль): флаг проверяется на чужих комнатах. */
const flatObshaga = (flat: boolean): Biome[] => newWorldSettings().biomes.map((b) => (b.id === 'obshaga' ? { ...b, ...(flat ? { flat: true } : {}) } : b));
const noFlat = (bs: Biome[]): Biome[] => bs.map((b) => {
  const { flat, ...rest } = b;
  void flat;
  return rest;
});
const OWN = p.rooms.filter((r) => r.tags[0] === 'санаторий');
const sanatorium = (seed: string, o: Partial<WorldSettings> = {}) =>
  createStreamWorld(p, streamSettings(seed, { world: world({ startBiome: 'sanatorium', trAfter: 100000, ...o }) }));

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

/** Закрытые выходы мира: [экземпляр, метка]. */
function exitsOf(w: StreamWorld): [string, string][] {
  const out: [string, string][] = [];
  const run = w.run();
  for (const i of run.instances) for (const c of roomOf(run, i.id).connectors) if (w.doorState(i.id, c.id) === 'exit') out.push([i.id, c.id]);
  return out;
}

/** Экземпляры сетей биома bid (по квартире-кластеру). */
const ofBiome = (w: StreamWorld, bid: string): Run['instances'] => w.run().instances.filter((i) => w.clusterAt(i.id)?.biome?.id === bid && w.clusterAt(i.id)!.tunnels);

/**
 * Пары экземпляров из списка, пересекающихся в 3D: на одном этаже клетки плана ближе зазора gap (по Чебышёву: общая
 * клетка или соседняя через угол/бок при gap 1). Слой W не учитывается — это и есть «одно место в 3D».
 */
function overlapPairs(list: Run['instances'], gap: number): [string, string][] {
  const K = (x: number, y: number, f: number) => ((f + 64) * 40000 + (x + 20000)) * 40000 + (y + 20000);
  const own = new Map<number, number>();
  const cells = list.map((inst) => [...instanceWorld(p, inst).cells].map(parseKey));
  list.forEach((inst, k) => { for (const [x, y] of cells[k]) own.set(K(x, y, inst.floor ?? 0), k); });
  const pairs = new Set<string>();
  list.forEach((inst, k) => {
    const f = inst.floor ?? 0;
    for (const [x, y] of cells[k]) {
      for (let dy = -gap; dy <= gap; dy++) {
        for (let dx = -gap; dx <= gap; dx++) {
          const o = own.get(K(x + dx, y + dy, f));
          if (o !== undefined && o !== k) pairs.add(o < k ? `${o}:${k}` : `${k}:${o}`);
        }
      }
    }
  });
  return [...pairs].map((s) => s.split(':').map((i) => list[Number(i)].id) as [string, string]);
}

/** Евклидова сеть: все экземпляры в одном слое; ни одна пара не пересекается в 3D; связи между ними — без сдвига W,
 *  без loose/close/wrap/fresh; колец и швов в мире нет. */
function expectFlat(w: StreamWorld, list: Run['instances'], label: string): void {
  const run = w.run();
  expect(list.length, label).toBeGreaterThan(0);
  expect(new Set(list.map((i) => i.w ?? 0)).size, `${label}: слоёв W`).toBe(1);
  expect(overlapPairs(list, w.settings.gap), `${label}: пересечения в 3D`).toEqual([]);
  const ids = new Set(list.map((i) => i.id));
  for (const l of run.links) {
    if (!ids.has(l.a.inst) || !ids.has(l.b.inst)) continue;
    expect(l.wrap, `${label}: шов`).toBeUndefined();
    expect(l.loose, `${label}: loose`).toBeUndefined();
    expect(l.close, `${label}: close`).toBeUndefined();
    expect(l.fresh, `${label}: fresh внутри сети`).toBeUndefined();
    expect(l.dw ?? 0, `${label}: dw`).toBe(0);
  }
  expect(w.stats().rings, `${label}: кольца`).toBe(0);
  expect(w.stats().wraps, `${label}: швы`).toBe(0);
}

/**
 * Войти в сеть биома target переходом из хрущёвок: мир — только хрущёвки и target, переход выпадает сразу и ведёт в
 * target. kind 'landing' — лестничная площадка (её дверь → вход сети, связь fresh), 'stair' — спец-комната (спуск
 * лестницы → комната-выход на свежем слое этажа ниже; лифт — выход на этаже выше). Возвращает мир и id первой комнаты
 * сети (null — не вышло за 40 шагов).
 */
function enterFrom(seed: string, biomes: Biome[], target: string, kind: 'landing' | 'stair'): { w: StreamWorld; entry: string | null } {
  const bs = biomes.filter((b) => b.id === 'khrush' || b.id === target);
  const W = world({ biomes: bs, startBiome: 'khrush', trAfter: 2, trBase: 1, trStep: 0, trToBiome: 1, trLanding: kind === 'landing' ? 1 : 0 });
  const w = createStreamWorld(p, streamSettings(seed, { world: W }));
  const tried = new Set<string>();
  for (let step = 0; step < 40; step++) {
    for (const i of w.run().instances) w.enter(i.id);
    for (const i of w.run().instances) {
      if (tried.has(i.id)) continue;
      const cl = w.clusterAt(i.id);
      const loc = roomOf(w.run(), i.id).location?.kind;
      if (kind === 'landing' && cl?.gate) {
        tried.add(i.id);
        const ex = roomOf(w.run(), i.id).connectors.find((c) => w.doorState(i.id, c.id) === 'exit');
        if (!ex) continue;
        const id = w.openDoor(i.id, ex.id);
        if (id && w.clusterAt(id)?.biome?.id === target && w.clusterAt(id)!.tunnels) return { w, entry: id };
      }
      if (kind === 'stair' && (loc === 'stairwell' || loc === 'lift')) {
        tried.add(i.id);
        const L = w.locationOf(i.id)!;
        const id = L.kind === 'lift' ? w.ascend(i.id, L.roll.floors >= 1 ? 1 : -1, 'straight') : w.descend(i.id);
        if (w.clusterAt(id)?.biome?.id === target && w.clusterAt(id)!.tunnels) return { w, entry: id };
      }
    }
    const ex = exitsOf(w).filter(([i]) => !w.clusterAt(i)?.gate && w.clusterAt(i)?.biome?.id === 'khrush');
    if (!ex.length) break;
    w.openDoor(...ex[(step * 3) % ex.length]);
  }
  return { w, entry: null };
}

/** Вход в сеть: первая комната — на свежем слое (до неё на этом слое этажа не было ни одной комнаты); дальше сеть растёт
 *  евклидово; validateFoldRun чисто. */
function checkEntry(w: StreamWorld, entry: string, target: string, label: string, grow = 150): void {
  const run0 = w.run();
  const e = run0.instances.find((i) => i.id === entry)!;
  const before = run0.instances.slice(0, e.order).filter((i) => (i.floor ?? 0) === (e.floor ?? 0) && (i.w ?? 0) === (e.w ?? 0));
  expect(before.map((i) => i.id), `${label}: слой входа W ${e.w} не свежий`).toEqual([]);
  walk(w, run0.instances.length + grow, entry);
  const list = ofBiome(w, target);
  expect(list.length, label).toBeGreaterThan(Math.min(grow, 60));
  expectFlat(w, list, label);
  expect(list.every((i) => (i.w ?? 0) === (e.w ?? 0) && (i.floor ?? 0) === (e.floor ?? 0)), `${label}: вся сеть — в слое входа`).toBe(true);
  expect(validateFoldRun(p, w.run()), label).toEqual([]);
}

describe('flat: флаг биома (без 4D-сдвигов)', { timeout: 600000 }, () => {
  it('нормализация: flat сохраняется (только true), порядок полей санатория — как у normBiome; flat — только у сетей ходов', () => {
    const san = biome('sanatorium');
    expect(san).toMatchObject({ layout: 'tunnels', flat: true, sightM: 0, viewM: 50 });
    expect(san.dark).toBeUndefined();
    expect(san.tunnels).toMatchObject({ ring: 0, loop: 0 });
    expect(JSON.stringify(normBiome(JSON.parse(JSON.stringify(san))))).toBe(JSON.stringify(san));
    const w = newWorldSettings();
    expect(JSON.stringify(normWorld(JSON.parse(JSON.stringify(w))))).toBe(JSON.stringify(w));
    expect(normBiome({ id: 'x', flat: true })!.flat).toBe(true);
    for (const v of [false, 1, 'true', null]) expect(normBiome({ id: 'x', flat: v })).not.toHaveProperty('flat');
    expect(isFlat(san)).toBe(true);
    expect(isFlat({ ...san, layout: undefined })).toBe(false);
    expect(defaultBiomes().filter((b) => b.flat).map((b) => b.id)).toEqual(['sanatorium']);
    // правила отделки — по второму тегу, правила по тегу группы нет
    expect(san.finishRules!.map((r) => r.tag)).not.toContain('санаторий');
  });

  it('копия общаги с flat: один слой, ни одной пары в одном месте 3D, без колец и швов; без flat — пересечения есть', () => {
    let control = 0;
    for (const seed of ['f1', 'f2', 'f3']) {
      const w = createStreamWorld(p, streamSettings(seed, { world: world({ biomes: flatObshaga(true), startBiome: 'obshaga', trAfter: 100000 }) }));
      walk(w, 260);
      const list = ofBiome(w, 'obshaga');
      expect(list.length, seed).toBeGreaterThanOrEqual(200);
      expectFlat(w, list, seed);
      expect(w.stats().overlaps, seed).toBe(0);
      expect(validateFoldRun(p, w.run()), seed).toEqual([]);
      const c = createStreamWorld(p, streamSettings(seed, { world: world({ biomes: flatObshaga(false), startBiome: 'obshaga', trAfter: 100000 }) }));
      walk(c, 260);
      control += overlapPairs(ofBiome(c, 'obshaga'), c.settings.gap).length;
    }
    // тот же мир без flat — 4D: комнаты сети стоят друг в друге (тест это ловит)
    expect(control).toBeGreaterThan(0);
  });

  it('вход во flat-сеть переходом (площадка, спец-лестница) — на свежий слой, дальше евклидово', () => {
    let landing = 0, stair = 0;
    for (const seed of ['e1', 'e2', 'e3', 'e4']) {
      for (const kind of ['landing', 'stair'] as const) {
        const { w, entry } = enterFrom(seed, flatObshaga(true), 'obshaga', kind);
        if (!entry) continue;
        if (kind === 'landing') landing++;
        else stair++;
        checkEntry(w, entry, 'obshaga', `${seed}/${kind}`, 120);
        // вход площадкой — дверь между слоями (связь fresh: |dw| любой — граница биома)
        if (kind === 'landing') expect(w.run().links.some((l) => l.fresh && l.b.inst === entry)).toBe(true);
      }
    }
    expect(landing).toBeGreaterThanOrEqual(2);
    expect(stair).toBeGreaterThanOrEqual(2);
  });

  it('flat у непосещаемого биома ничего не меняет: мир общаги — бит в бит как с тем же биомом без flat', () => {
    for (const seed of ['b1', 'b2']) {
      const a = createStreamWorld(p, streamSettings(seed, { world: world({ startBiome: 'obshaga', trAfter: 100000 }) }));
      const b = createStreamWorld(p, streamSettings(seed, { world: world({ biomes: noFlat(newWorldSettings().biomes), startBiome: 'obshaga', trAfter: 100000 }) }));
      walk(a, 200);
      walk(b, 200);
      expect(strip(a.run()).instances).toEqual(strip(b.run()).instances);
      expect(a.run().links).toEqual(b.run().links);
    }
  });
});

describe('санаторий: комнаты', () => {
  it('все — «только в биоме» группы «санаторий»: растут только в санатории; хабы — вестибюль (вход, «stair») и бассейн', () => {
    expect(OWN.length).toBeGreaterThan(10);
    const bs = newWorldSettings().biomes;
    for (const r of OWN) {
      expect(has(r, BIOME_ONLY_TAG), r.id).toBe(true);
      for (const b of bs) expect(biomeMul(b, r) > 0, `${r.id} в ${b.id}`).toBe(b.id === 'sanatorium');
    }
    const hubs = OWN.filter((r) => tunnelKind(r) === 'hub');
    expect(hubs.some((r) => has(r, 'вестибюль') && r.connectors.some((c) => c.tag === 'stair'))).toBe(true);
    expect(hubs.some((r) => has(r, 'бассейн'))).toBe(true);
    // залы длиннее общего предела обзора (9 м) — в пуле санатория всё равно (sightM 0)
    expect(hubs.some((r) => roomSightM(r, p.settings.cellM) > 9)).toBe(true);
  });
});

describe('санаторий: двери', () => {
  it('палаты и процедурные — белая филёнчатая (полотно в комнате, не сама закрывается); конец коридора и выход к корпусам — остеклённая перегородка', () => {
    const SAN = ['санаторий', 'коридор', 'ход', BIOME_ONLY_TAG];
    for (const tag of ['room>sanat', 'sanat>room', 'proc>sanat', 'sanat>proc']) {
      expect(doorStyleFor(tag, SAN, false, 'a/' + tag)?.id, tag).toBe('sanatorium_door');
      expect(doorStyleFor(tag, SAN, true, 'a/' + tag)?.id, tag).toBe('sanatorium_door');
      expect(doorStyleFor(tag, [], true, 'a/' + tag)?.id, tag).toBe('sanatorium_door');
    }
    expect(leafHere('room>sanat')).toBe(true);
    expect(leafHere('sanat>room')).toBe(false);
    expect(leafHere('proc>sanat')).toBe(true);
    expect(leafHere('sanat>proc')).toBe(false);
    expect(DOOR_STYLE_BY_ID.get('sanatorium_door')!.selfClosing).toBeUndefined();
    // проход сети открытый — без двери; закрытый конец коридора (3.0 м) — перегородка во всю ширину, где бы ни стоял
    expect(doorStyleFor('sanat', SAN, false, 'a/b')).toBeNull();
    expect(doorStyleFor('sanat', SAN, true, 'a/b')?.id).toBe('sanatorium_screen');
    expect(doorStyleFor('sanat', [], true, 'a/b')?.id).toBe('sanatorium_screen');
    expect(doorStyleFor('stair', ['санаторий', 'вестибюль', 'хаб'], true, 'a/b')?.id).toBe('sanatorium_screen');
    // прочие биомы — как были
    expect(doorStyleFor('stair', ['лестница'], true, 'a/b')?.id).toBe('tambour');
    const sc = doorGeometry({ style: DOOR_STYLE_BY_ID.get('sanatorium_screen')!, widthM: 3.0, heightM: 3.3, hinge: 'left', role: 'dead', leaf: true, seed: 's' });
    expect(sc.leaves.length).toBe(2);
    expect(Math.max(...sc.leaves.map((l) => l.y0 + l.height))).toBeGreaterThanOrEqual(3.3);
    const d = doorGeometry({ style: DOOR_STYLE_BY_ID.get('sanatorium_door')!, widthM: 0.9, heightM: 2.1, hinge: 'left', role: 'exit', leaf: true, seed: 's', tag: 'room>sanat' });
    // латунная ручка и табличка-номер
    expect(d.leaves[0].handle?.parts.every((p) => p.color === '#b39257')).toBe(true);
    expect(d.leaves[0].parts.filter((p) => p.color === '#b39257').length).toBeGreaterThanOrEqual(3);
  });
});

describe('санаторий: сеть', { timeout: 600000 }, () => {
  it('старт — вестибюль; евклидово: один слой, без пересечений, колец, швов, loose/close; коридоры, палаты, процедурные, бассейн', () => {
    const found = new Map<string, number>();
    const add = (k: string) => found.set(k, (found.get(k) ?? 0) + 1);
    for (const seed of ['s1', 's2', 's3', 's4']) {
      const w = sanatorium(seed);
      const start = roomOf(w.run(), w.startId!);
      expect(has(start, 'вестибюль'), seed).toBe(true);
      expect(start.connectors.some((c) => c.tag === 'stair')).toBe(true);
      walk(w, 170);
      const run = w.run();
      expect(run.instances.length, seed).toBeGreaterThanOrEqual(150);
      // только свои комнаты
      for (const i of run.instances) expect(roomOf(run, i.id).tags[0], i.roomId).toBe('санаторий');
      expectFlat(w, run.instances, seed);
      expect(w.stats().overlaps, seed).toBe(0);
      expect(run.instances.every((i) => (i.floor ?? 0) === 0 && (i.z ?? 0) === 0), seed).toBe(true);
      expect(validateFoldRun(p, run), seed).toEqual([]);
      const kinds = new Set<string>();
      for (const i of run.instances) {
        const r = roomOf(run, i.id);
        if (has(r, 'коридор')) kinds.add('коридор');
        if (has(r, 'палата')) kinds.add('палата');
        if (r.connectors.some((c) => c.tag === 'proc>sanat')) kinds.add('процедурная');
        if (has(r, 'бассейн') && has(r, 'хаб')) kinds.add('бассейн');
        if (has(r, 'ремонт')) kinds.add('ремонт');
      }
      for (const k of kinds) add(k);
    }
    for (const k of ['коридор', 'палата', 'процедурная']) expect(found.get(k) ?? 0, k).toBe(4);
    expect(found.get('бассейн') ?? 0, 'бассейн').toBeGreaterThanOrEqual(2);
  });

  it('здание не замыкается само в себе: за куском хода есть куда идти, палаты не встают перед нерешёнными проходами', () => {
    // b, c, w — сиды, на которых без этих правил сеть глохла на 24–170 комнатах (коридор упирался в свою же палату)
    for (const seed of ['b', 'c', 'w', 'x1', 'x2', 'x3']) {
      const w = sanatorium(seed);
      walk(w, 260);
      expect(w.run().instances.length, seed).toBeGreaterThanOrEqual(260);
      expect(w.stats().overlaps, seed).toBe(0);
      // боковых помещений по-прежнему много: палаты, процедурные
      const side = w.run().instances.filter((i) => tunnelKind(roomOf(w.run(), i.id)) === null || tunnelKind(roomOf(w.run(), i.id)) === 'storage');
      expect(side.length, seed).toBeGreaterThan(50);
    }
  });

  it('настройки «Прогулки» проекта (walkStreamSettings): тот же евклидов санаторий', () => {
    for (const seed of ['w1', 'w2']) {
      const w = createStreamWorld(p, walkStreamSettings(p, { ...DEFAULT_WALK, seed, biome: 'sanatorium' }));
      expect(w.clusterAt(w.startId!)?.biome?.id).toBe('sanatorium');
      walk(w, 170);
      const list = ofBiome(w, 'sanatorium');
      expect(list.length, seed).toBeGreaterThanOrEqual(150);
      expectFlat(w, list, seed);
      expect(validateFoldRun(p, w.run()), seed).toEqual([]);
    }
  });

  it('вход переходом из квартир (площадка и спец-лестница): вестибюль на свежем слое, дальше рост без пересечений', () => {
    let landing = 0, stair = 0;
    for (const seed of ['v1', 'v2', 'v3', 'v4']) {
      for (const kind of ['landing', 'stair'] as const) {
        const { w, entry } = enterFrom(seed, newWorldSettings().biomes, 'sanatorium', kind);
        if (!entry) continue;
        if (kind === 'landing') landing++;
        else stair++;
        expect(has(roomOf(w.run(), entry), 'вестибюль'), `${seed}/${kind}`).toBe(true);
        checkEntry(w, entry, 'sanatorium', `${seed}/${kind}`);
      }
    }
    expect(landing).toBeGreaterThanOrEqual(2);
    expect(stair).toBeGreaterThanOrEqual(2);
  });

  it('выход — двери вестибюля «stair»: за ними квартиры, остальные выходы санатория исчезают', () => {
    const w = sanatorium('up');
    walk(w, 150);
    const exits = exitsOf(w);
    expect(exits.length).toBeGreaterThanOrEqual(1);
    for (const [i, c] of exits) {
      expect(roomOf(w.run(), i).connectors.find((x) => x.id === c)!.tag).toBe('stair');
      expect(has(roomOf(w.run(), i), 'вестибюль')).toBe(true);
    }
    const id = w.openDoor(...exits[0])!;
    expect(id).toBeTruthy();
    expect(w.clusterAt(id)!.tunnels).toBe(false);
    expect(roomOf(w.run(), id).tags[0]).not.toBe('санаторий');
    for (const [x, y] of exits.slice(1)) expect(w.doorState(x, y)).toBe('dead');
    expect(validateFoldRun(p, w.run())).toEqual([]);
  });

  it('вне биома санатория нет: прежняя прогулка, прогон, квартиры хрущёвок, общага', () => {
    const ownI = (run: Run) => run.instances.filter((i) => byId.get(i.roomId)!.tags[0] === 'санаторий');
    const legacy = createStreamWorld(p, streamSettings('legacy'));
    walk(legacy, 300);
    expect(ownI(legacy.run())).toEqual([]);
    expect(ownI(generateRun(p, { seed: 'g1', count: 80 }))).toEqual([]);
    const kh = createStreamWorld(p, streamSettings('kh', { world: world({ trAfter: 100000 }) }));
    walk(kh, 200);
    expect(ownI(kh.run())).toEqual([]);
    const ob = createStreamWorld(p, streamSettings('ob', { world: world({ startBiome: 'obshaga', trAfter: 100000 }) }));
    walk(ob, 200);
    expect(ownI(ob.run())).toEqual([]);
  });

  it('сохранение → загрузка: санаторий растёт дальше так же (и вход со свежим слоем — тоже)', () => {
    const a = sanatorium('save');
    walk(a, 90);
    const sv: StreamSave = JSON.parse(JSON.stringify(a.save()));
    const b = createStreamWorld(p, a.settings, sv);
    expect(b.stale).toBe(false);
    walk(a, 200);
    walk(b, 200);
    const pick = (w: StreamWorld) => w.run().instances.map((i) => [i.roomId, i.dx, i.dy, i.w ?? 0, i.z ?? 0]);
    expect(pick(b)).toEqual(pick(a));
    // вход площадкой: связь fresh переживает сохранение
    const { w, entry } = enterFrom('save-e', newWorldSettings().biomes, 'sanatorium', 'landing');
    expect(entry).toBeTruthy();
    const c = createStreamWorld(p, w.settings, JSON.parse(JSON.stringify(w.save())) as StreamSave);
    expect(c.stale).toBe(false);
    expect(c.run().links).toEqual(w.run().links);
    walk(w, w.run().instances.length + 60, entry!);
    walk(c, c.run().instances.length + 60, entry!);
    expect(pick(c)).toEqual(pick(w));
    expect(validateFoldRun(p, c.run())).toEqual([]);
  });

  it('тот же мир без flat (контроль): сеть санатория складывается в 4D — пересечения в 3D есть', () => {
    let pairs = 0;
    for (const seed of ['k1', 'k2']) {
      const bs = newWorldSettings().biomes.map((b) => (b.id === 'sanatorium' ? noFlat([b])[0] : b));
      const w = createStreamWorld(p, streamSettings(seed, { world: world({ biomes: bs, startBiome: 'sanatorium', trAfter: 100000 }) }));
      walk(w, 170);
      pairs += overlapPairs(ofBiome(w, 'sanatorium'), w.settings.gap).length;
    }
    expect(pairs).toBeGreaterThan(0);
  });
});
