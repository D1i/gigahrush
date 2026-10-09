// Навигация «Общаги» в «Прогулке» (src/view3d/obshagaNav.ts) и срез режиссёра для коопа (src/view3d/obshagaSync.ts).
import { describe, expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { buildBabylonBlockout } from '../blockout/babylon';
import { buildBlockoutModel } from '../blockout/core';
import type { RunConnector, RunExport, RunInstance, Side } from '../blockout/types';
import { createDefaultProject } from '../data/presets';
import { exportRunJSON } from '../gen/world';
import { newWorldSettings } from '../gen4d/biomes';
import { createStreamWorld, streamSettings } from '../gen4d/stream';
import {
  createHand, createObshagaDirector, forceObshagaBlackout, handView, openDoorById, POKE_R, POKE_STAND, rectGap, stepDirector, stepHand,
  type HandEvent, type ObshagaInput, type Pt, type Rect,
} from '../locations/obshaga';
import {
  BED_GOAL_PAD, CHART_HOPS, MOUTH_M, bedAt, bedGoal, bedRoute, buildNav, chartOf, doorPoints, handGoal, nearestHub, nextGoal, polyLength, remoteCover,
  roomAt, roomPath, spawnCandidates, waypoints,
} from './obshagaNav';
import { FX_MAX, advanceRemote, fromWire, simplifyTrail, toWire } from './obshagaSync';

// В node нет canvas: DynamicTexture сетки блокаута рисует в заглушку (NullEngine ничего не грузит в GPU).
class FakeCanvas {
  constructor(public width: number, public height: number) {}
  getContext() {
    const store: Record<string | symbol, unknown> = {};
    return new Proxy(store, { get: (t, k) => (k in t ? t[k] : () => undefined), set: (t, k, v) => ((t[k] = v), true) });
  }
}
(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas ??= FakeCanvas;

/** Настоящий мир общаги (~120 экземпляров от вестибюля), один на файл. */
let world: { rx: RunExport; startId: string } | null = null;
function obshWorld() {
  if (world) return world;
  const p = createDefaultProject();
  const w = createStreamWorld(p, streamSettings('нав-общага', { world: { ...newWorldSettings(), startBiome: 'obshaga', trAfter: 100000 } }));
  const q = [w.startId!];
  const seen = new Set<string>();
  while (q.length && w.run().instances.length < 120) {
    const id = q.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    w.expand(id);
    for (const l of w.run().links) if (l.a.inst === id) q.push(l.b.inst);
  }
  return (world = { rx: exportRunJSON(p, w.run()) as RunExport, startId: w.startId! });
}

// ───────── синтетический прогон: клетка 0.1 м ─────────

type K = Omit<RunConnector, 'line' | 'name' | 'cx' | 'cy'> & { line: [number, number, number, number] };
function inst(id: string, tags: string[], b: [number, number, number, number], connectors: K[], extra: Partial<RunInstance> = {}): RunInstance {
  return {
    id, roomId: id, roomName: id, roomTags: tags, rot: 0, dx: 0, dy: 0, depth: 0, parent: null,
    bbox: { x0: b[0], y0: b[1], x1: b[2], y1: b[3] }, cells: [], doors: [],
    connectors: connectors.map((k) => ({ ...k, name: k.id, cx: Math.min(k.line[0], k.line[2]), cy: Math.min(k.line[1], k.line[3]) })),
    decor: [], spots: [], tier: null, danger: 0, dangerAcc: 0, loot: [], ...extra,
  };
}
const k = (id: string, tag: string, side: Side, line: [number, number, number, number], linkedTo: { inst: string; connector: string } | null = null, extra: Partial<K> = {}): K =>
  ({ id, tag, side, len: Math.max(Math.abs(line[2] - line[0]), Math.abs(line[3] - line[1])), line, linkedTo, ...extra });

/**
 * Коридоры вдоль x: c1 [0, 9] × [0, 2] м, c2 [9.1, 18.1] × [0, 2] (проём на x 9…9.1), c3 — за швом (wrap) от c2.
 * У c1 сверху (y < 0) — комната r1 (дверь x 2…2.9), запертая дверь x 6…6.9; у c2 снизу — комната r2 (x 12…12.9);
 * у c1 слева — лестница s (тег «лестница»), за ней — коридор c4.
 */
function fixture(): RunExport {
  const G = ['общага', 'коридор', 'только-биом'];
  const instances = [
    inst('c1', G, [0, 0, 90, 20], [
      k('n1', 'obshaga>room', 'N', [20, 0, 29, 0], { inst: 'r1', connector: 's' }),
      k('n2', 'obshaga>room', 'N', [60, 0, 69, 0]),
      k('e', 'obshaga', 'E', [90, 0, 90, 20], { inst: 'c2', connector: 'w' }),
      k('w', 'obshaga', 'W', [0, 0, 0, 20], { inst: 's', connector: 'e' }),
    ]),
    inst('r1', ['общага', 'комната', 'только-биом'], [15, -46, 48, -1], [k('s', 'room>obshaga', 'S', [20, -1, 29, -1], { inst: 'c1', connector: 'n1' })], {
      spots: [{ id: 'obsh_room_2_s_lantern', name: 'Керосиновая лампа', x: 30, y: -30, rot: 0, groupId: null, variantId: null, content: { kind: 'prop', id: 'p_obsh_lantern', rot: 0 }, contentRot: 0 }],
    }),
    inst('c2', G, [91, 0, 181, 20], [
      k('w', 'obshaga', 'W', [91, 0, 91, 20], { inst: 'c1', connector: 'e' }),
      k('s1', 'obshaga>room', 'S', [120, 20, 129, 20], { inst: 'r2', connector: 'n' }),
      k('e', 'obshaga', 'E', [181, 0, 181, 20], { inst: 'c3', connector: 'w' }),
      k('s2', 'obshaga>room', 'S', [150, 20, 159, 20], null, { cut: true }),
    ]),
    inst('r2', ['общага', 'комната', 'только-биом'], [100, 21, 140, 60], [k('n', 'room>obshaga', 'N', [120, 21, 129, 21], { inst: 'c2', connector: 's1' })]),
    inst('c3', G, [500, 0, 590, 20], [k('w', 'obshaga', 'W', [500, 0, 500, 20], { inst: 'c2', connector: 'e' })]),
    inst('s', ['общага', 'лестница', 'вверх', 'только-биом'], [-25, -10, -1, 30], [
      k('e', 'obshaga', 'E', [-1, 0, -1, 20], { inst: 'c1', connector: 'w' }),
      k('w', 'obshaga', 'W', [-25, 0, -25, 20], { inst: 'c4', connector: 'e' }),
    ]),
    inst('c4', [...G, 'вахта'], [-116, 0, -26, 20], [k('e', 'obshaga', 'E', [-26, 0, -26, 20], { inst: 's', connector: 'w' })]),
    // затопленный подвал: ход b1 (x 0…8 м) — ход b2 (x 8.1…12.1 м), y 10…11.6 м
    inst('b1', ['общага', 'подвал', 'затоплено', 'ход', 'только-биом'], [0, 100, 80, 116], [k('e', 'obshaga_bsm', 'E', [80, 100, 80, 116], { inst: 'b2', connector: 'w' })], { z: -2.7 }),
    inst('b2', ['общага', 'подвал', 'затоплено', 'ход', 'только-биом'], [81, 100, 121, 116], [k('w', 'obshaga_bsm', 'W', [81, 100, 81, 116], { inst: 'b1', connector: 'e' })], { z: -2.7 }),
  ];
  const links = [
    { a: { inst: 'c1', connector: 'n1' }, b: { inst: 'r1', connector: 's' } },
    { a: { inst: 'c1', connector: 'e' }, b: { inst: 'c2', connector: 'w' } },
    { a: { inst: 'c2', connector: 's1' }, b: { inst: 'r2', connector: 'n' } },
    { a: { inst: 'c2', connector: 'e' }, b: { inst: 'c3', connector: 'w' }, wrap: [-410, 0] as [number, number] },
    { a: { inst: 'c1', connector: 'w' }, b: { inst: 's', connector: 'e' } },
    { a: { inst: 's', connector: 'w' }, b: { inst: 'c4', connector: 'e' } },
    { a: { inst: 'b1', connector: 'e' }, b: { inst: 'b2', connector: 'w' } },
  ];
  return {
    format: 'room-forge-run', version: 1, seed: 't', cellM: 0.1, settings: { gap: 1 }, props: [], items: [], instances, links, openConnectors: [],
  };
}

const P = (x: number, y: number, room?: string): Pt => (room === undefined ? { x, y } : { x, y, room });

describe('«Общага»: навигация', () => {
  const nav = buildNav(fixture());

  it('двери: связанная — полотно в комнате, середина между метками, нормаль в коридор; запертая — полотно в коридоре; нераскрытая — не дверь', () => {
    const ids = nav.doors.map((d) => d.id).sort();
    expect(ids).toEqual(['c1/n2', 'r1/s', 'r2/n']);
    const d1 = nav.doorById.get('r1/s')!;
    expect(d1).toMatchObject({ inst: 'r1', conn: 's', cor: 'c1', room: 'r1' });
    expect(d1.x).toBeCloseTo(2.45);
    expect(d1.y).toBeCloseTo(-0.05);
    expect([d1.nx, d1.ny]).toEqual([-0, 1]);
    const dead = nav.doorById.get('c1/n2')!;
    expect(dead).toMatchObject({ cor: 'c1', room: null, nx: 0, ny: 1 });
    expect(dead.y).toBeCloseTo(0);
    const d2 = nav.doorById.get('r2/n')!;
    expect([d2.nx, d2.ny]).toEqual([-0, -1]);
    expect(nav.doorsByRoom.get('c1')!.map((d) => d.id).sort()).toEqual(['c1/n2', 'r1/s']);
    expect(nav.doorsByRoom.get('r1')!.map((d) => d.id)).toEqual(['r1/s']);
  });

  it('точки двери появления: корень за дверью (в комнате), проём — в середине коридора', () => {
    const { door, mouth } = doorPoints(nav.doorById.get('r1/s')!);
    expect(door.room).toBe('r1');
    expect(door.y).toBeLessThan(-0.5);
    expect(mouth).toMatchObject({ room: 'c1' });
    expect(mouth.y).toBeCloseTo(-0.05 + MOUTH_M);
    expect(doorPoints(nav.doorById.get('c1/n2')!).door.room).toBe('c1');
  });

  it('лампа: спот с p_obsh_lantern — мировые клетки в метры', () => {
    expect(nav.lamps).toEqual([{ inst: 'r1', spot: 'obsh_room_2_s_lantern', x: 3, y: -3, z: 0 }]);
  });

  it('карта руки: без шва и без лестниц; путь и точки — середины проёмов с комнатой, из которой идут', () => {
    const chart = chartOf(nav, 'c1');
    expect([...chart.keys()].sort()).toEqual(['c1', 'c2', 'r1', 'r2']);
    expect(CHART_HOPS).toBeGreaterThanOrEqual(10);
    expect(chartOf(nav, 'c1', 1).has('r2')).toBe(false);
    const path = roomPath(nav, 'r1', 'r2', chart)!;
    expect(path).toEqual(['r1', 'c1', 'c2', 'r2']);
    const wps = waypoints(nav, path, P(12.4, 4, 'r2'));
    expect(wps.map((p) => p.room)).toEqual(['r1', 'c1', 'c2', 'r2']);
    expect(wps[1].x).toBeCloseTo(9.05);
    expect(roomPath(nav, 'c1', 'c3', chart)).toBeNull();
    expect(roomPath(nav, 'c1', 'c4', chart)).toBeNull();
    // пройденный проём пропускается; последняя точка — цель
    expect(nextGoal(P(9.0, 1, 'c1'), wps.slice(1))!.room).toBe('c2');
    expect(nextGoal(P(12.4, 4, 'r2'), [P(12.4, 4, 'r2')])).toBeNull();
    expect(polyLength(P(0, 0), [P(3, 4), P(3, 0)])).toBeCloseTo(9);
  });

  it('комната точки: по рамке пола, иначе соседи подсказки', () => {
    expect(roomAt(nav, P(4, 1, 'c1'))).toBe('c1');
    expect(roomAt(nav, P(10, 1, 'c1'))).toBe('c2');
    expect(roomAt(nav, P(2.4, -2, 'c1'))).toBe('r1');
    expect(roomAt(nav, P(50, 50, 'c1'))).toBe('c1');
    expect(roomAt(nav, P(4, 1, 'c1'), (id) => (id === 'c1' ? [{ x0: 5, y0: 0, x1: 9, y1: 2 }] : null))).toBe('c1');
  });

  it('цель руки: ближайший по пути незащищённый; с лампой и в поле — не цель; вне карты — стоять', () => {
    const chart = chartOf(nav, 'c1');
    const tip = P(2.45, 1, 'c1');
    const players = [
      { id: 'a', p: P(16, 1, 'c2'), protected: false },
      { id: 'b', p: P(2.4, -3, 'r1'), protected: true },
    ];
    let g = handGoal(nav, tip, players, [], chart);
    expect(g.target).toBe('a');
    expect(g.goal).toMatchObject({ room: 'c1' });
    expect(g.goal!.x).toBeCloseTo(9.05);
    // поле лампы накрывает a — незащищённых нет: ближайший защищённый (рука ползёт к краю поля — видна в свете лампы)
    g = handGoal(nav, tip, players, [P(15, 1)], chart);
    expect(g).toMatchObject({ target: 'b', open: false });
    expect(g.goal).not.toBeNull();
    expect(handGoal(nav, tip, players.slice(0, 1), [], chart)).toMatchObject({ target: 'a', open: true });
    // игрок за швом — вне карты
    expect(handGoal(nav, tip, [{ id: 'c', p: P(52, 1, 'c3'), protected: false }], [], chart).goal).toBeNull();
    // та же комната — прямо к игроку
    expect(handGoal(nav, tip, [{ id: 'd', p: P(7, 1, 'c1'), protected: false }], [], chart).goal).toMatchObject({ x: 7, y: 1, room: 'c1' });
  });

  it('двери появления: в карте игрока, путь от проёма, видимые и в поле — флагами', () => {
    const me = { id: 'me', p: P(16, 1, 'c2'), protected: false };
    const cands = spawnCandidates(nav, [me], new Set(['r2/n']), [P(12.45, 1)]);
    expect(cands.map((c) => c.id)).toEqual(['c1/n2', 'r1/s', 'r2/n']);
    const byId = new Map(cands.map((c) => [c.id, c]));
    expect(byId.get('r2/n')).toMatchObject({ seen: true, inField: true });
    expect(byId.get('r1/s')).toMatchObject({ seen: false, inField: false });
    // r1/s: проём (2.45, 0.95) → проём c1|c2 (9.05, 1) → игрок (16, 1)
    expect(byId.get('r1/s')!.dist).toBeCloseTo(Math.hypot(6.6, 0.05) + 6.95, 1);
    expect(byId.get('r1/s')!.door.room).toBe('r1');
    // за лестницей — не в карте
    expect(spawnCandidates(nav, [{ id: 'x', p: P(-5, 1, 'c4'), protected: false }], new Set(), [])).toEqual([]);
  });

  it('затопленный подвал без дверей: рука — из темноты соседнего куска хода (корень в его глубине, проём — у игрока)', () => {
    const pass = nav.spawns.filter((x) => x.id.startsWith('pass:'));
    expect(pass.map((x) => x.id).sort()).toEqual(['pass:b1>b2', 'pass:b2>b1']);
    const toB1 = pass.find((x) => x.id === 'pass:b2>b1')!;
    expect(toB1).toMatchObject({ cor: 'b1', doorRef: null });
    expect(toB1.mouth.x).toBeCloseTo(8.05 - 0.1);
    expect(toB1.door.x).toBeCloseTo(8.05 + 2.5);
    expect(toB1.door.room).toBe('b2');
    expect(nav.rooms.get('b1')!.z).toBe(-2.7);
    // игрок в b1 спиной к проходу: проём сзади
    const me = { id: 'me', p: P(2, 10.8, 'b1'), protected: false, fx: -1, fy: 0 };
    const c = spawnCandidates(nav, [me], new Set(), []);
    expect(c.map((x) => x.id)).toEqual(['pass:b2>b1']);
    expect(c[0].dist).toBeCloseTo(5.95, 1);
    expect(c[0].facing).toBeCloseTo(-1);
    // лицом к проходу — проём перед глазами
    expect(spawnCandidates(nav, [{ ...me, fx: 1 }], new Set(), [])[0].facing).toBeCloseTo(1);
    // у двери в коридоре — тоже взгляд: дверь r1/s слева-спереди у игрока, смотрящего вдоль коридора на восток
    const cor = spawnCandidates(nav, [{ id: 'me', p: P(1, 1, 'c1'), protected: false, fx: 1, fy: 0 }], new Set(), []);
    expect(cor.find((x) => x.id === 'r1/s')!.facing).toBeGreaterThan(0.5);
    expect(spawnCandidates(nav, [{ id: 'me', p: P(4, 1, 'c1'), protected: false, fx: 1, fy: 0 }], new Set(), []).find((x) => x.id === 'r1/s')!.facing).toBeLessThan(0);
  });

  it('возрождение: ближайший вестибюль по дверям (сквозь лестницы — можно)', () => {
    expect(nearestHub(nav, 'r2')).toBe('c4');
    expect(nearestHub(nav, 'c3')).toBeNull();
  });
});

// ───────── кровати: комната общаги на двоих ─────────

const BED_PROP = { id: 'p_obsh_bed', name: 'Кровать железная с панцирной сеткой', w: 1.9, h: 0.8, color: '#7d8a8c', tags: ['кровать', 'спальное', 'мебель', 'общага'], hasTex: false, tex: null };
const STAND_PROP = { id: 'p_obsh_nightstand', name: 'Тумбочка казённая', w: 0.4, h: 0.4, color: '#6b5a44', tags: ['тумбочка', 'мебель', 'общага'], hasTex: false, tex: null };
const WARDROBE_PROP = { id: 'p_obsh_wardrobe', name: 'Шкаф платяной казённый', w: 0.8, h: 0.5, color: '#6b5a44', tags: ['шкаф', 'мебель', 'общага'], hasTex: false, tex: null };
const decor = (id: string, propId: string, x: number, y: number, rot: number) => ({ id, propId, x, y, rot });

/**
 * Комната bd 3.3 × 4.5 м (x 0…3.3, y 0…4.5), дверь с севера (x 2.0…2.9) в коридор bc (y −2.1…−0.1); кровати вдоль
 * стен: E (rot 90 — x 2.5…3.3, y 1.7…3.6) и W (rot 270 — x 0…0.8), между ними проход 1.7 м; у E с юга тумбочка (на
 * споте — как выпавшее). Зал hl 8 × 8 м (x 10…18) — кровать посередине (rot 0 — x 13.05…14.95, y 3.6…4.4) и (extra)
 * ещё мебель.
 */
function bedFixture(hallExtra: { id: string; propId: string; x: number; y: number; rot: number }[] = []): RunExport {
  const G = ['общага', 'коридор', 'только-биом'];
  const instances = [
    inst('bc', G, [0, -21, 90, -1], [k('s', 'obshaga>room', 'S', [20, -1, 29, -1], { inst: 'bd', connector: 'n' })]),
    inst('bd', ['общага', 'комната', 'только-биом'], [0, 0, 33, 45], [k('n', 'room>obshaga', 'N', [20, 0, 29, 0], { inst: 'bc', connector: 's' })], {
      decor: [decor('E', 'p_obsh_bed', 29, 26.5, 90), decor('W', 'p_obsh_bed', 4, 26.5, 270)],
      spots: [{ id: 'ns', name: 'Тумбочка', x: 29, y: 40, rot: 0, groupId: null, variantId: null, content: { kind: 'prop', id: 'p_obsh_nightstand', rot: 90 }, contentRot: null }],
    }),
    inst('hl', ['общага', 'холл', 'только-биом'], [100, 0, 180, 80], [], { decor: [decor('B', 'p_obsh_bed', 140, 40, 0), ...hallExtra] }),
  ];
  return {
    format: 'room-forge-run', version: 1, seed: 't', cellM: 0.1, settings: { gap: 1 }, props: [BED_PROP, STAND_PROP, WARDROBE_PROP], items: [], instances,
    links: [{ a: { inst: 'bc', connector: 's' }, b: { inst: 'bd', connector: 'n' } }], openConnectors: [],
  };
}

const R4 = (r: Rect) => [r.x0, r.y0, r.x1, r.y1].map((v) => Math.round(v * 1000) / 1000);

describe('«Общага»: рука и кровать', () => {
  const nav = buildNav(bedFixture());
  const E = nav.rooms.get('bd')!.beds[0], W = nav.rooms.get('bd')!.beds[1];

  it('мебель из декора и спотов: рамки по осям, повёрнутые — w и d местами; кровати — отдельно', () => {
    expect(R4(E)).toEqual([2.5, 1.7, 3.3, 3.6]);
    expect(R4(W)).toEqual([0, 1.7, 0.8, 3.6]);
    const bd = nav.rooms.get('bd')!;
    expect(bd.props.map((p) => p.propId)).toEqual(['p_obsh_bed', 'p_obsh_bed', 'p_obsh_nightstand']);
    expect(bd.props[0].cover).toBe('bed');
    expect(bd.props[2]).toMatchObject({ cover: null, h: 0.85 });
    expect(R4(bd.props[2].rect)).toEqual([2.7, 3.8, 3.1, 4.2]);
    expect(R4(nav.rooms.get('hl')!.beds[0])).toEqual([13.05, 3.6, 14.95, 4.4]);
    expect(nav.rooms.get('bc')!.beds).toEqual([]);
  });

  it('кровать под точкой (с запасом) и правило напарника: глаз ниже порога И в рамке кровати', () => {
    expect(bedAt(nav, P(2.9, 2.6, 'bd'))).toBe(E);
    expect(bedAt(nav, P(0.4, 2.6, 'bd'))).toBe(W);
    expect(bedAt(nav, P(1.6, 2.6, 'bd'))).toBeNull();
    expect(bedAt(nav, P(2.45, 2.6, 'bd'))).toBe(E);
    expect(bedAt(nav, P(2.45, 2.6, 'bd'), 0)).toBeNull();
    // с меткой коридора (соседа по проёму) — та же кровать
    expect(bedAt(nav, P(2.9, 2.6, 'bc'))).toBe(E);
    // напарник: лёжа (глаз 0.22) под кроватью — укрыт; на четвереньках (0.5) — нет; лёжа в проходе — нет
    expect(remoteCover(nav, P(2.9, 2.6, 'bd'), 0.22, 0.35)).toBe(E);
    expect(remoteCover(nav, P(2.9, 2.6, 'bd'), 0.5, 0.35)).toBeNull();
    expect(remoteCover(nav, P(1.6, 2.6, 'bd'), 0.22, 0.35)).toBeNull();
    expect(remoteCover(nav, P(2.9, 2.6, 'bd'), undefined, 0.35)).toBeNull();
  });

  it('свободный бок: у стены и за стеной — нет; цель — проекция игрока снаружи на pokeStandM; подход по нормали', () => {
    const out = POKE_STAND + BED_GOAL_PAD;
    // E у восточной стены, торцы — у северной стены (близко) и у южной (за стеной): годен только западный бок
    const g = bedGoal(nav, 'bd', E, P(2.9, 2.65, 'bd'))!;
    expect(g.goal.x).toBeCloseTo(2.5 - out, 6);
    expect(g.goal.y).toBeCloseTo(2.65, 6);
    expect([g.nx, g.ny]).toEqual([-1, 0]);
    // подход — по нормали дальше цели, на полу комнаты (у стены — короче BED_APPROACH_M)
    expect(g.approach!.y).toBeCloseTo(2.65, 6);
    expect(g.goal.x - g.approach!.x).toBeGreaterThan(0.3);
    expect(g.approach!.x).toBeGreaterThan(0.1);
    // проекция — не ближе 0.25 м к углам
    expect(bedGoal(nav, 'bd', E, P(2.9, 3.55, 'bd'))!.goal.y).toBeCloseTo(3.35, 6);
    // W — зеркально
    expect(bedGoal(nav, 'bd', W, P(0.4, 2.2, 'bd'))!.goal.x).toBeCloseTo(0.8 + out, 6);
    // кровать посреди зала: ближе к игроку — торец; шкаф перед торцом — бок
    const hall = nav.rooms.get('hl')!.beds[0];
    const end = bedGoal(nav, 'hl', hall, P(13.3, 4, 'hl'))!;
    expect([end.nx, end.ny]).toEqual([-1, 0]);
    expect(end.goal.x).toBeCloseTo(13.05 - out, 6);
    const nav2 = buildNav(bedFixture([decor('wr', 'p_obsh_wardrobe', 120, 40, 90)]));
    const side = bedGoal(nav2, 'hl', nav2.rooms.get('hl')!.beds[0], P(13.3, 4, 'hl'))!;
    expect([side.nx, side.ny]).toEqual([0, -1]);
    expect(side.goal.x).toBeCloseTo(13.3, 6);
    expect(side.goal.y).toBeCloseTo(3.6 - out, 6);
    // места нет ни у одного бока (кровать во всю комнату) — null
    expect(bedGoal(nav, 'bd', { x0: 0.1, y0: 0.1, x1: 3.2, y1: 4.4 }, P(1.6, 2.2, 'bd'))).toBeNull();
  });

  /** Отрезок ab заходит в открытую рамку z (проверка пути — по точкам с шагом 1 см). */
  const enters = (a: Pt, b: Pt, z: Rect) => {
    const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.01);
    for (let i = 0; i <= n; i++) {
      const x = a.x + ((b.x - a.x) * i) / n, y = a.y + ((b.y - a.y) * i) / n;
      if (x > z.x0 + 1e-9 && x < z.x1 - 1e-9 && y > z.y0 + 1e-9 && y < z.y1 - 1e-9) return true;
    }
    return false;
  };

  it('путь к боку: в обход зоны кончика по углам, затем подход по нормали; на линии подхода — прямо; изнутри — сначала наружу', () => {
    const zone = { x0: E.x0 - POKE_STAND, y0: E.y0 - POKE_STAND, x1: E.x1 + POKE_STAND, y1: E.y1 + POKE_STAND };
    const ba = bedGoal(nav, 'bd', E, P(2.9, 2.65, 'bd'))!;
    // от двери (над кроватью — зона): угол, подход, цель; ни один отрезок не заходит в зону
    const door = P(2.45, -0.05, 'bc');
    const route = bedRoute(nav, 'bd', door, E, ba);
    expect(route.length).toBe(3);
    expect(route.slice(-2)).toEqual([ba.approach, ba.goal]);
    expect(route.every((p) => p.room === 'bd')).toBe(true);
    let a: Pt = door;
    for (const b of route) {
      expect(enters(a, b, zone), `${a.x},${a.y} → ${b.x},${b.y}`).toBe(false);
      a = b;
    }
    // на линии подхода — сразу к цели
    expect(bedRoute(nav, 'bd', P(ba.goal.x - 0.3, 2.7, 'bd'), E, ba)).toEqual([ba.goal]);
    // кончик в зоне (игрок залез под кровать рядом с рукой) — сначала наружу по ближайшей грани, на пол
    const inside = bedRoute(nav, 'bd', P(1.6, 1.0, 'bd'), E, ba);
    expect(rectGap(inside[0], E)).toBeGreaterThan(POKE_STAND);
    expect(inside[0].x).toBeLessThan(1.6);
    expect(inside[inside.length - 1]).toEqual(ba.goal);
  });

  it('рука по навигации: из коридора в обход кровати, кончик ни разу не ближе pokeStandM к ней, тычет с прохода лицом к кровати', () => {
    const me = { id: 'me', p: P(2.9, 2.65, 'bd'), protected: false, cover: E };
    const chart = chartOf(nav, 'bc');
    // цель — не игрок, а проход у бока кровати; путь длиннее прямой
    const g0 = handGoal(nav, P(6, -1, 'bc'), [me], [], chart);
    expect(g0).toMatchObject({ target: 'me', open: true });
    expect(g0.goal).toMatchObject({ room: 'bc' });
    const h = createHand('кровать', P(6, -1.9, 'bc'), P(6, -1.1, 'bc'));
    h.phase = 'stalking';
    h.emerge = 1;
    h.tip = P(6, -1.1, 'bc');
    const players = [{ id: 'me', p: me.p, protected: false, sees: false, sheltered: true, cover: E }];
    const ev: HandEvent[] = [];
    let minGap = Infinity;
    for (let i = 0; i < 64 * 30; i++) {
      const goal = handGoal(nav, h.tip, [me], [], chart).goal;
      ev.push(...stepHand(h, 1 / 64, { lightsOn: false, seen: false, goal, players, lanterns: [], playerSpeed: 4 }));
      if (h.tip.room === 'bd') minGap = Math.min(minGap, rectGap(h.tip, E));
      if (ev.filter((e) => e.type === 'poke').length >= 2) break;
    }
    expect(ev.some((e) => e.type === 'grab')).toBe(false);
    expect(ev.filter((e) => e.type === 'poke').length).toBe(2);
    expect(minGap).toBeGreaterThanOrEqual(POKE_STAND - 1e-6);
    // тычет из прохода между кроватями (запад от E), пришла от точки подхода — почти по нормали к боку, лицом к кровати
    const ba = bedGoal(nav, 'bd', E, me.p)!;
    expect(h.tip.x).toBeLessThan(E.x0 - POKE_STAND + 1e-6);
    expect(h.tip.x).toBeGreaterThan(ba.approach!.x - 1e-6);
    expect(Math.abs(h.tip.y - me.p.y)).toBeLessThan(0.2);
    expect(Math.hypot(h.tip.x - me.p.x, h.tip.y - me.p.y)).toBeLessThanOrEqual(POKE_R);
    expect(handView(h).bed).toEqual(E);
  });
});

describe('«Общага»: навигация в настоящем мире', () => {
  it('сеть общаги: двери комнат и запертые, лампа у вахтёра, вестибюль, у каждой двери появления путь', { timeout: 60000 }, () => {
    const { rx, startId } = obshWorld();
    const w = { startId };
    const nav = buildNav(rx);
    const linked = nav.doors.filter((d) => d.room);
    expect(linked.length).toBeGreaterThan(15);
    expect(nav.lamps.length).toBeGreaterThanOrEqual(1);
    const vahter = rx.instances.find((i) => i.roomTags.includes('вахтёрская'))!;
    expect(nav.lamps.some((l) => l.inst === vahter.id)).toBe(true);
    expect(nav.rooms.get(w.startId!)!.hub).toBe(true);
    // у связанной двери полотно — в комнате, коридор — через проём; нормаль смотрит из комнаты
    for (const d of linked) {
      const r = nav.rooms.get(d.room!)!;
      const into = { x: d.x - d.nx * 0.5, y: d.y - d.ny * 0.5 };
      expect(into.x > r.x0 - 0.01 && into.x < r.x1 + 0.01 && into.y > r.y0 - 0.01 && into.y < r.y1 + 0.01).toBe(true);
    }
    const start = w.startId!;
    const me = { id: 'me', p: { x: (nav.rooms.get(start)!.x0 + nav.rooms.get(start)!.x1) / 2, y: (nav.rooms.get(start)!.y0 + nav.rooms.get(start)!.y1) / 2, room: start }, protected: false };
    const cands = spawnCandidates(nav, [me], new Set(), []);
    expect(cands.length).toBeGreaterThan(3);
    for (const c of cands) expect(c.dist).toBeGreaterThan(0);
    expect(nearestHub(nav, linked[0].room!)).not.toBeNull();
  });

  it('кровати: рамки навигации — ровно коллайдеры кроватей болванки (PropBox ядра и меш Babylon с metadata.cover)', { timeout: 60000 }, () => {
    const { rx } = obshWorld();
    const nav = buildNav(rx);
    const key = (r: Rect) => [r.x0, r.y0, r.x1, r.y1].map((v) => (Math.round(v * 1000) / 1000 + 0).toFixed(3)).join(',');
    const ours = new Map<string, string[]>();
    for (const r of nav.rooms.values()) if (r.beds.length) ours.set(r.id, r.beds.map(key).sort());
    // кроватей много, и повёрнутые есть (rot 90/270 — w и d меняются местами)
    const all = [...ours.values()].flat();
    expect(all.length).toBeGreaterThan(10);
    expect(all.some((k) => { const [x0, y0, x1, y1] = k.split(',').map(Number); return y1 - y0 > x1 - x0 + 0.5; })).toBe(true);
    expect(all.some((k) => { const [x0, y0, x1, y1] = k.split(',').map(Number); return x1 - x0 > y1 - y0 + 0.5; })).toBe(true);
    // ядро: PropBox с cover 'bed' — центр (x, y), бокс w × d, повёрнутый на rot
    const model = buildBlockoutModel(rx);
    const core = new Map<string, string[]>();
    for (const p of model.props) {
      if (p.cover !== 'bed') continue;
      const a = (p.rot * Math.PI) / 180, ca = Math.abs(Math.cos(a)), sa = Math.abs(Math.sin(a));
      const hw = (ca * p.w + sa * p.d) / 2, hd = (sa * p.w + ca * p.d) / 2;
      const l = core.get(p.inst) ?? [];
      l.push(key({ x0: p.x - hw, y0: p.y - hd, x1: p.x + hw, y1: p.y + hd }));
      core.set(p.inst, l);
    }
    for (const l of core.values()) l.sort();
    expect(Object.fromEntries(ours)).toEqual(Object.fromEntries(core));
    // Babylon: коллайдер кровати (плита над просветом, metadata.cover) — его рамка в мире (x, −z) — та же; 3 комнаты
    const rooms = [...ours.keys()].slice(0, 3);
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const sub = { ...rx, instances: rx.instances.filter((i) => rooms.includes(i.id)), links: [] };
    buildBabylonBlockout(scene, buildBlockoutModel(sub), { collisions: true });
    const bab = new Map<string, string[]>();
    for (const m of scene.meshes) {
      const md = m.metadata as { cover?: string; inst?: string } | null;
      if (md?.cover !== 'bed') continue;
      m.computeWorldMatrix(true);
      const b = m.getBoundingInfo().boundingBox;
      const l = bab.get(md.inst!) ?? [];
      l.push(key({ x0: b.minimumWorld.x, y0: -b.maximumWorld.z, x1: b.maximumWorld.x, y1: -b.minimumWorld.z }));
      bab.set(md.inst!, l);
      // и под ней пролезают: плита от 0.30
      expect(b.minimumWorld.y).toBeCloseTo(0.3, 3);
    }
    for (const l of bab.values()) l.sort();
    expect(Object.fromEntries(bab)).toEqual(Object.fromEntries(rooms.map((r) => [r, ours.get(r)!])));
    scene.dispose();
    engine.dispose();
    // кровать под точкой: в середине рамки — она (и с меткой соседа по проёму — тоже)
    const [rid, beds] = [...nav.rooms.values()].filter((r) => r.beds.length).map((r) => [r.id, r.beds] as const)[0];
    const b = beds[0];
    expect(bedAt(nav, { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, room: rid })).toBe(b);
    const nb = nav.rooms.get(rid)!.edges[0]?.to;
    if (nb) expect(bedAt(nav, { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, room: nb })).toBe(b);
  });
});

describe('«Общага»: срез режиссёра для коопа', () => {
  it('рука длиной 45 м, 30 дверей в ходу, события — JSON < 2 КБ; туда-обратно — те же свет, двери, кисть', () => {
    const dir = createObshagaDirector('кооп');
    forceObshagaBlackout(dir);
    for (let i = 0; i < 30; i++) openDoorById(dir, `i${1000 + i}/c${i % 7}`);
    const input: ObshagaInput = { players: [], lanterns: [], playerSpeed: 1.7, spawnCandidates: [], goal: null };
    stepDirector(dir, 0.3, input);
    // рука по зигзагу через много комнат
    const h = createHand('h', { x: 0, y: -0.7, room: 'i1' }, { x: 0, y: 1, room: 'c1' });
    h.phase = 'stalking';
    h.emerge = 1;
    let x = 0, y = 1;
    for (let k = 0; k < 180; k++) {
      x += 0.25;
      if (k % 30 === 29) y += 0.4;
      h.trail.push({ x: x + 1234.56, y: y - 987.65, room: `i${100 + Math.floor(k / 9)}` });
    }
    h.tip = { x: x + 1234.8, y: y - 987.65, room: 'i199' };
    dir.hand = h;
    dir.handDoor = 'i1/c0';
    const w = toWire(dir, 7, [['grab', 'игрок-1'], ['killed', 'игрок-1']]);
    const json = JSON.stringify(w);
    expect(json.length).toBeLessThan(FX_MAX);
    expect(w.h!.p.length / 3).toBeLessThanOrEqual(40);
    const r = fromWire(JSON.parse(json))!;
    expect(r.q).toBe(7);
    expect(r.handDoor).toBe('i1/c0');
    expect(Object.keys(r.doors).length).toBe(30);
    expect(r.blackout.phase).toBe(dir.blackout.phase);
    expect(r.hand!.tip.x).toBeCloseTo(h.tip.x, 1);
    expect(r.hand!.tip.room).toBe('i199');
    expect(r.hand!.trail[0]).toMatchObject({ room: 'i1' });
    expect(r.events).toEqual([['grab', 'игрок-1'], ['killed', 'игрок-1']]);
    // свет досчитывается, не дальше конца фазы
    const t0 = r.blackout.t;
    advanceRemote(r, 0.5);
    expect(r.blackout.t).toBeCloseTo(Math.min(r.blackout.dur, t0 + 0.5));
    advanceRemote(r, 1e6);
    expect(r.blackout.t).toBe(r.blackout.dur);
  });

  it('тычок под кровать: кого, куда и фаза — туда-обратно; событие poke; рука 45 м с тычком — < 2 КБ', () => {
    const dir = createObshagaDirector('кооп-тычок');
    forceObshagaBlackout(dir);
    stepDirector(dir, 0.3, { players: [], lanterns: [], playerSpeed: 1.7, spawnCandidates: [], goal: null });
    const h = createHand('h', { x: 0, y: -0.7, room: 'i1' }, { x: 0, y: 1, room: 'c1' });
    h.phase = 'stalking';
    h.emerge = 1;
    for (let k = 0; k < 180; k++) h.trail.push({ x: 0.25 * k, y: 1 + Math.floor(k / 30) * 0.4, room: `i${100 + Math.floor(k / 9)}` });
    h.tip = { x: 45.1, y: 3, room: 'спальня-7' };
    h.poke = 'игрок-2';
    h.pokeT = 0.77;
    h.pokeAt = { x: 46.234, y: 3.5, room: 'спальня-7' };
    h.bed = { x0: 45.904, y0: 3.1, x1: 46.704, y1: 5.0 };
    dir.hand = h;
    const w = toWire(dir, 3, [['poke', 'игрок-2']]);
    expect(JSON.stringify(w).length).toBeLessThan(FX_MAX);
    const r = fromWire(JSON.parse(JSON.stringify(w)))!;
    expect(r.hand!.poke).toBe('игрок-2');
    expect(r.hand!.pokeAt).toEqual({ x: 46.23, y: 3.5, room: 'спальня-7' });
    expect(r.hand!.poke01).toBeCloseTo(0.77 / 1.4, 2);
    expect(r.hand!.bed).toEqual({ x0: 45.9, y0: 3.1, x1: 46.7, y1: 5 });
    expect(r.events).toEqual([['poke', 'игрок-2']]);
    // не тычет и кровати рядом нет — полей нет, у клиента — null
    h.poke = null;
    h.pokeAt = null;
    h.bed = null;
    const w2 = toWire(dir, 4);
    expect(w2.h!.pk).toBeUndefined();
    expect(w2.h!.bd).toBeUndefined();
    const r2 = fromWire(w2)!;
    expect(r2.hand!.poke).toBeNull();
    expect(r2.hand!.pokeAt).toBeNull();
    expect(r2.hand!.poke01).toBe(0);
    expect(r2.hand!.bed).toBeNull();
  });

  it('упрощение следа: концы на месте, прямые — в две точки, изгиб сохраняется', () => {
    const pts: Pt[] = [];
    for (let i = 0; i <= 40; i++) pts.push({ x: i * 0.25, y: 0, room: 'a' });
    for (let i = 1; i <= 40; i++) pts.push({ x: 10, y: i * 0.25, room: 'a' });
    const s = simplifyTrail(pts, 10);
    expect(s).toEqual([pts[0], pts[40], pts[80]]);
    expect(simplifyTrail(pts.slice(0, 5), 10)).toHaveLength(5);
  });

  it('пустой режиссёр: без руки и дверей — маленький срез', () => {
    const w = toWire(createObshagaDirector('x'), 1);
    expect(w.h).toBeNull();
    expect(JSON.stringify(w).length).toBeLessThan(120);
    expect(fromWire(w)!.hand).toBeNull();
    expect(fromWire(null as never)).toBeNull();
  });
});
