// Высокие залы (Room.ceilM), высота проёма по метке (TAG_OPEN_H) и эскалатор (StairFlight.style 'escalator') в кусках
// портального рендера (src/blockout/stairs.ts liftPiece): стены, потолок, перемычки и подвесные предметы — до своего
// потолка; проём на всю высоту зала — без перемычки; у соседей разной высоты каждая половина — до своего потолка, порталы
// двух сторон одной высоты; эскалатор из трёх маршей бок о бок — без видимых ступеней и перил по бокам, с пандусом,
// опорой на каждом марше и перилами у края верхней площадки над промежутками.
import { afterAll, describe, expect, it } from 'vitest';
import { createDefaultProject } from '../data/presets';
import { room, TAG_OPEN_H, type ConnTag } from '../data/roomBuilder';
import { exportRunJSON } from '../gen/world';
import { createStreamWorld, streamSettings } from '../gen4d/stream';
import { parseRoom, serializeRoom } from '../model/serialize';
import { connDz, parseStair, stairIssues, worldStair } from '../model/stairs';
import type { Project, Room, Rot, Side, StairSpec } from '../model/types';
import { validateBlockout } from './core';
import { buildPiece, mergePieces, piecePortals } from './pieces';
import { liftPiece, stairFloorAt, stairMeshes } from './stairs';
import { DEFAULT_BLOCKOUT, type BlockoutModel, type RunExport } from './types';

const H = DEFAULT_BLOCKOUT.wallHeightM, D = DEFAULT_BLOCKOUT.doorHeightM, S = DEFAULT_BLOCKOUT.slabM;
const TALL = 4.5;

// временные метки теста: высокий проход (на всю высоту зала), средний (2.9 — выше потолка коридора), обычный
TAG_OPEN_H.tt_big = TALL;
TAG_OPEN_H.tt_mid = 2.9;
afterAll(() => {
  delete TAG_OPEN_H.tt_big;
  delete TAG_OPEN_H.tt_mid;
});

/** Комната-прямоугольник с проёмами: [сторона, начало вдоль стены, метка-образец (длина), своя метка]. */
function box(id: string, w: number, h: number, doors: [Side, number, ConnTag, string][], o: { ceilM?: number; lamp?: boolean; weight?: number } = {}): Room {
  const b = room(id, `Тест ${id}`, { tags: ['тест-высота'], note: 'тест', gen: { weight: o.weight ?? 10, min: 0, max: 9999 }, elite: [] }).rect(0, 0, w, h);
  doors.forEach(([side, from, like], k) => b.open(side, from, like, `Проём ${k + 1}`));
  if (o.lamp) b.put('p_obsh_plafond', w / 2, h / 2);
  const r = b.build();
  r.connectors.forEach((c, k) => (c.tag = doors[k][3]));
  if (o.ceilM) r.ceilM = o.ceilM;
  return r;
}

function project(rooms: Room[]): Project {
  const p = createDefaultProject();
  p.finishes ??= [];
  p.finishRules ??= [];
  p.rooms = rooms;
  return p;
}

/** Зал 6×6 (потолок 4.5): N — высокий проход к такому же залу, S — средний (к коридору 2.5), E — обычный. Сам зал
 *  ростом не ставится (вес 0) — соседи у его меток ровно те, что нужны. */
function hallWorld(): { p: Project; rx: RunExport; hall: string; twin: string; mid: string; low: string } {
  const p = project([
    box('tt_hall', 6, 6, [['N', 1, 'factory', 'tt_big'], ['S', 2, 'corridor', 'tt_mid'], ['E', 2, 'basement', 'tt_low']], { ceilM: TALL, lamp: true, weight: 0 }),
    box('tt_hall2', 6, 6, [['N', 1, 'factory', 'tt_big'], ['S', 1, 'factory', 'tt_big']], { ceilM: TALL }),
    box('tt_cor_mid', 2, 4, [['N', 0.35, 'corridor', 'tt_mid'], ['S', 0.35, 'corridor', 'tt_mid']]),
    box('tt_cor_low', 2, 4, [['N', 0.5, 'basement', 'tt_low'], ['S', 0.5, 'basement', 'tt_low']]),
  ]);
  for (const seed of ['tall', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']) {
    const w = createStreamWorld(p, streamSettings(seed, { startRoomId: 'tt_hall', deadEndChance: 0, sightM: 0 }));
    w.ensureAround(w.startId!, 1);
    const rx = exportRunJSON(p, w.run()) as RunExport;
    const h = rx.instances.find((i) => i.id === w.startId)!;
    const at = (k: number) => h.connectors[k].linkedTo?.inst ?? null;
    const [twin, mid, low] = [at(0), at(1), at(2)];
    if (twin && mid && low) return { p, rx, hall: h.id, twin, mid, low };
  }
  throw new Error('нет сида, при котором у зала все три соседа');
}

describe('высокие залы и проёмы по метке', { timeout: 60000 }, () => {
  const { rx, hall, twin, mid, low } = hallWorld();
  const pieces = new Map<string, BlockoutModel>(rx.instances.map((i) => [i.id, buildPiece(rx, i.id, { deadEnds: 'panel', doors: true })]));
  const inst = (id: string) => rx.instances.find((i) => i.id === id)!;
  const portal = (from: string, to: string) => piecePortals(rx, pieces.get(from)!, from).find((q) => q.to === to)!;
  /** перемычки куска id над проёмом к соседу to: [низ, верх] */
  const lintels = (id: string, to: string) => {
    const op = pieces.get(id)!.openings.find((o) => o.a.inst === to || o.b.inst === to)!;
    const ov = (r: { x0: number; y0: number; x1: number; y1: number }) =>
      Math.min(r.x1, op.rect.x1) - Math.max(r.x0, op.rect.x0) > 1e-6 && Math.min(r.y1, op.rect.y1) - Math.max(r.y0, op.rect.y0) > 1e-6;
    return pieces.get(id)!.solids.filter((s) => s.kind === 'lintel' && ov(s.rect)).map((s) => [s.z0, s.z1]);
  };

  it('экспорт: своя высота потолка у экземпляра и высота проёма у метки', () => {
    expect(inst(hall).ceilM).toBe(TALL);
    expect(inst(mid).ceilM).toBeUndefined();
    expect(inst(hall).connectors.map((c) => c.openH)).toEqual([TALL, 2.9, undefined]);
  });

  it('зал: стены и потолок до своей высоты, подвесной предмет — под потолком', () => {
    const pc = pieces.get(hall)!;
    const walls = pc.solids.filter((s) => s.kind === 'wall');
    expect(Math.max(...walls.map((s) => s.z1))).toBeCloseTo(TALL + S, 6);
    expect(pc.ceilings.find((c) => c.inst === hall)!.z).toBeCloseTo(TALL, 6);
    expect(pc.floors.find((f) => f.inst === hall)!.z).toBe(0);
    for (const f of pc.faces.filter((x) => x.part === 'wall')) expect(f.z1).toBeCloseTo(TALL, 6);
    // babylon.ts ставит модель подвесного на z + wallHeightM — потолок зала
    const lamp = pc.props.find((x) => x.tags.includes('потолок'))!;
    expect(lamp.z! + H).toBeCloseTo(TALL, 6);
  });

  it('проход на всю высоту между высокими залами — без перемычки, половины закрыты плитой потолка', () => {
    for (const [a, b] of [[hall, twin], [twin, hall]]) {
      expect(lintels(a, b), a).toEqual([]);
      const op = pieces.get(a)!.openings.find((o) => o.a.inst === b || o.b.inst === b)!;
      expect(op.heightM).toBeCloseTo(TALL, 6);
      const plate = pieces.get(a)!.ceilings.find((c) => c.inst === null && c.owner === a)!;
      expect(plate.z).toBeCloseTo(TALL, 6);
      expect(plate.rects.some((r) => Math.min(r.x1, op.rect.x1) - Math.max(r.x0, op.rect.x0) > 1e-6 && Math.min(r.y1, op.rect.y1) - Math.max(r.y0, op.rect.y0) > 1e-6)).toBe(true);
      expect(portal(a, b).h).toBeCloseTo(TALL, 6);
      // ни перемычки, ни её облицовки
      expect(pieces.get(a)!.faces.some((f) => f.part === 'lintel' && f.z0 >= TALL - 1e-6)).toBe(false);
    }
  });

  it('соседи разной высоты: верх проёма — по низкому потолку, каждая половина перемычки — до своего', () => {
    // средняя метка 2.9 выше потолка коридора 2.5: проём — до 2.5; у зала перемычка 2.5…4.5, у коридора её нет
    expect(portal(hall, mid).h).toBeCloseTo(H, 6);
    expect(portal(mid, hall).h).toBeCloseTo(H, 6);
    const lh = lintels(hall, mid);
    expect(lh.length).toBeGreaterThan(0);
    for (const [z0, z1] of lh) {
      expect(z0).toBeCloseTo(H, 6);
      expect(z1).toBeCloseTo(TALL + S, 6);
    }
    expect(lintels(mid, hall)).toEqual([]);
    // облицовка перемычки зала — от верха проёма до потолка
    const lf = pieces.get(hall)!.faces.filter((f) => f.part === 'lintel');
    expect(lf.some((f) => Math.abs(f.z0 - H) < 1e-6 && Math.abs(f.z1 - TALL) < 1e-6)).toBe(true);
    // обычная метка: проём по doorHeightM, перемычки — до своих потолков
    expect(portal(hall, low).h).toBeCloseTo(D, 6);
    expect(portal(low, hall).h).toBeCloseTo(D, 6);
    for (const [z0, z1] of lintels(hall, low)) expect([z0, z1]).toEqual([D, TALL + S]);
    for (const [z0, z1] of lintels(low, hall)) expect([z0, z1]).toEqual([D, H + S]);
    expect(lintels(low, hall).length).toBeGreaterThan(0);
    // двери (наличники) — высотой проёма
    const slot = pieces.get(hall)!.doors?.find((d) => d.connector === inst(hall).connectors[0].id);
    if (slot) expect(slot.heightM).toBeCloseTo(TALL, 6);
  });

  it('порталы двух сторон каждого проёма — одной высоты', () => {
    const hs = new Map<string, number>();
    for (const [id, pc] of pieces) {
      for (const q of piecePortals(rx, pc, id)) {
        const key = [`${q.a.inst}/${q.a.connector}`, `${q.b.inst}/${q.b.connector}`].sort().join('|');
        const seen = hs.get(key);
        if (seen === undefined) hs.set(key, q.h);
        else expect(q.h, key).toBeCloseTo(seen, 9);
      }
    }
    expect(hs.size).toBeGreaterThanOrEqual(3);
  });

  it('validateBlockout: зал и каждый сосед вместе — чистая стыковка', () => {
    for (const [id, pc] of pieces) expect(validateBlockout(mergePieces([pc])), id).toEqual([]);
    for (const nb of [twin, mid, low]) expect(validateBlockout(mergePieces([pieces.get(hall)!, pieces.get(nb)!])), nb).toEqual([]);
  });

  it('комната без своего потолка и высоких меток — кусок не меняется', () => {
    const pc = pieces.get(low)!;
    const of = (x: string) => rx.instances.find((i) => i.id === x);
    expect(liftPiece(pc, inst(low), of)).toBe(pc);
  });

  it('Room.ceilM переживает сохранение проекта; мусор — нет поля', () => {
    const r = box('tt_x', 2, 2, [], { ceilM: 3.2 });
    expect(parseRoom(JSON.parse(JSON.stringify(serializeRoom(r, 0.1)))).ceilM).toBe(3.2);
    const j = JSON.parse(JSON.stringify(serializeRoom(r, 0.1)));
    for (const bad of [-1, 0, 'x', null]) expect('ceilM' in parseRoom({ ...j, ceilM: bad })).toBe(false);
    delete r.ceilM;
    expect('ceilM' in serializeRoom(r, 0.1)).toBe(false);
  });
});

// ───────────────────────── эскалатор ─────────────────────────

const RISE = 8.1;
/** Эскалаторный тоннель метро (геометрия metro_esc_tunnel из контракта): 6.0 × 19.0, верхняя площадка y 0–2.5 на 8.1 во
 *  всю ширину, три марша-эскалатора бок о бок (x 0.4–1.6, 2.4–3.6, 4.4–5.6; y 2.5–16.5), низ — пол комнаты. */
function escalator(): Room {
  const r = room('tt_esc', 'Тестовый эскалатор', { tags: ['тест-высота', 'эскалатор', 'лестница'], note: 'тест', gen: { weight: 1, min: 0, max: 9999 }, elite: [] })
    .rect(0, 0, 6, 19)
    .open('N', 0.4, 'factory', 'Верх')
    .open('S', 0.4, 'factory', 'Низ')
    .build();
  const lane = (x: number) => ({ x, y: 25, w: 12, h: 140, up: 'N' as const, z0: 0, z1: RISE, style: 'escalator' as const });
  r.stair = { flights: [lane(4), lane(24), lane(44)], pads: [{ x: 0, y: 0, w: 60, h: 25, z: RISE }] };
  r.ceilM = 3.5;
  return r;
}

describe('эскалатор: три марша бок о бок', { timeout: 60000 }, () => {
  const esc = escalator();
  const p = project([esc]);
  const w = createStreamWorld(p, streamSettings('esc', { startRoomId: 'tt_esc', sightM: 0 }));
  const rx = exportRunJSON(p, w.run()) as RunExport;
  const id = w.startId!;
  const pc = buildPiece(rx, id, { deadEnds: 'panel' });
  const g = pc.stairs!;
  const lanes = g[0].flights;

  it('описание: stairIssues чисто, верх — на площадке, низ — пол; стиль переживает сохранение и поворот', () => {
    expect(stairIssues(esc)).toEqual([]);
    expect(connDz(esc, 0)).toBeCloseTo(RISE, 9);
    expect(connDz(esc, 1)).toBe(0);
    expect(parseRoom(JSON.parse(JSON.stringify(serializeRoom(esc, 0.1)))).stair).toEqual(esc.stair);
    expect(parseStair({ flights: [{ x: 0, y: 0, w: 2, h: 3, up: 'N', z0: 0, z1: 1, style: 'лифт' }] })!.flights[0].style).toBeUndefined();
    for (const rot of [0, 90, 180, 270] as Rot[]) expect(worldStair(esc.stair as StairSpec, rot, 3, 4).flights.map((f) => f.style)).toEqual(['escalator', 'escalator', 'escalator']);
    expect(rx.instances[0].stair!.flights.every((f) => f.style === 'escalator')).toBe(true);
  });

  it('кусок: зал на подъём + свой потолок, три марша со стилем', () => {
    expect(lanes.map((f) => f.style)).toEqual(['escalator', 'escalator', 'escalator']);
    expect(Math.max(...pc.solids.filter((s) => s.kind === 'wall').map((s) => s.z1))).toBeCloseTo(RISE + 3.5 + S, 6);
    expect(pc.ceilings.find((c) => c.inst === id)!.z).toBeCloseTo(RISE + 3.5, 6);
  });

  it('опора: у каждого марша своя — по линии носков от низа до площадки; между маршами — нет', () => {
    for (const f of lanes) {
      const x = (f.rect.x0 + f.rect.x1) / 2;
      let last = -1;
      for (let y = f.rect.y1 - 0.05; y > f.rect.y0; y -= 0.25) {
        const s = stairFloorAt(g, x, y)!;
        expect(s.flight).toBe(true);
        expect(s.z).toBeGreaterThanOrEqual(last);
        last = s.z;
      }
      expect(last).toBeGreaterThan(RISE - 0.3);
      expect(stairFloorAt(g, x, (f.rect.y0 + f.rect.y1) / 2)!.z).toBeCloseTo(RISE / 2, 0);
    }
    for (const x of [2.0, 4.0, 0.2, 5.8]) expect(stairFloorAt(g, x, 9.5), `x ${x}`).toBeNull();
    expect(stairFloorAt(g, 2.0, 1.0)).toEqual({ z: RISE, flight: false });
  });

  it('перила: по бокам маршей — только коллайдер, у края верхней площадки над промежутками — видимые', () => {
    const rails = g[0].rails;
    const side = rails.filter((r) => r.hidden);
    const top = rails.filter((r) => !r.hidden);
    // 3 марша × 2 бока (снаружи везде пол: полоски у стен и промежутки 0.8 м)
    expect(side.length).toBe(6);
    // край площадки: две полоски у стен и два промежутка
    expect(top.length).toBe(4);
    for (const r of top) for (const q of r.pts) expect(q[2]).toBeCloseTo(RISE, 6);
    const spans = top.map((r) => [Math.min(...r.pts.map((q) => q[0])), Math.max(...r.pts.map((q) => q[0]))]).sort((a, b) => a[0] - b[0]);
    expect(spans.map(([a, b]) => [Math.round(a * 10) / 10, Math.round(b * 10) / 10])).toEqual([[0, 0.4], [1.6, 2.4], [3.6, 4.4], [5.6, 6]]);
    for (const r of side) expect(r.low).toBe(0);
  });

  it('меши: ни ступеней, ни перил над дорожками; пандус и стенки перил — в коллайдере', () => {
    const sm = stairMeshes(g);
    expect(sm.collider.empty).toBe(false);
    expect(sm.pads.empty).toBe(false);
    // видимое — только перила у площадки: ни одной вершины над дорожкой марша
    for (let k = 0; k < sm.visible.p.length; k += 3) {
      const x = sm.visible.p[k], y = -sm.visible.p[k + 2];
      for (const f of lanes) {
        const inside = x > f.rect.x0 + 0.06 && x < f.rect.x1 - 0.06 && y > f.rect.y0 + 0.06 && y < f.rect.y1 - 0.06;
        expect(inside, `(${x}, ${y})`).toBe(false);
      }
    }
    // обычная лестница той же геометрии — со ступенями и перилами: видимого много больше
    const plain = stairMeshes([{ ...g[0], flights: lanes.map(({ style: _s, ...f }) => f), rails: g[0].rails.map(({ hidden: _h, ...r }) => r) }]);
    expect(plain.visible.p.length).toBeGreaterThan(sm.visible.p.length * 4);
    // коллайдер тот же: пандусы и стенки перил не зависят от стиля
    expect(plain.collider.p.length).toBe(sm.collider.p.length);
  });

  it('validateBlockout: кусок тоннеля чистый', () => {
    expect(validateBlockout(mergePieces([pc]))).toEqual([]);
  });
});
