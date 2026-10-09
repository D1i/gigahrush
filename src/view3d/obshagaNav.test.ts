// Навигация «Общаги» в «Прогулке» (src/view3d/obshagaNav.ts) и срез режиссёра для коопа (src/view3d/obshagaSync.ts).
import { describe, expect, it } from 'vitest';
import type { RunConnector, RunExport, RunInstance, Side } from '../blockout/types';
import { createDefaultProject } from '../data/presets';
import { exportRunJSON } from '../gen/world';
import { newWorldSettings } from '../gen4d/biomes';
import { createStreamWorld, streamSettings } from '../gen4d/stream';
import { createHand, createObshagaDirector, forceObshagaBlackout, openDoorById, stepDirector, type ObshagaInput, type Pt } from '../locations/obshaga';
import {
  CHART_HOPS, MOUTH_M, buildNav, chartOf, doorPoints, handGoal, nearestHub, nextGoal, polyLength, roomAt, roomPath, spawnCandidates, waypoints,
} from './obshagaNav';
import { FX_MAX, advanceRemote, fromWire, simplifyTrail, toWire } from './obshagaSync';

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

describe('«Общага»: навигация в настоящем мире', () => {
  it('сеть общаги: двери комнат и запертые, лампа у вахтёра, вестибюль, у каждой двери появления путь', () => {
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
    const rx = exportRunJSON(p, w.run()) as RunExport;
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
