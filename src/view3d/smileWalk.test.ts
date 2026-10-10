import { describe, expect, it } from 'vitest';
import {
  advanceState, aheadPoint, cornerSpots, doorAngleOk, doorSpot, farPoint, insideDorm, losPlan, pathTo, peekPlace, reachFrom, smileSpots, spotRoot,
  windowSpot, type SmDoor, type SmileMap, type SmOpening, type SmRoom,
} from './smileWalk';
import { createSmile, SMILE } from '../locations/smile';

// Синтетическая общага (план, м; y — вниз):
//   D1 — жилая комната над коридором (x 3…6.3, y −4.5…0), дверь в C1 посередине x 4.05…4.95, окно на северной стене;
//   C1 — коридор x 0…10, y 0…2; C2 — поворот x 10…12, y 0…2 (проёмы W → C1, S → C3); C3 — коридор x 10…12, y 2…12.
function room(id: string, x0: number, y0: number, x1: number, y1: number, o: Partial<SmRoom> = {}): SmRoom {
  return { id, z: 0, x0, y0, x1, y1, obsh: true, dorm: false, stair: false, open: [], windows: [], ...o };
}
function link(a: SmRoom, b: SmRoom, ax: number, ay: number, bx: number, by: number, dx: number, dy: number) {
  const o = { ax, ay, bx, by, cx: (ax + bx) / 2, cy: (ay + by) / 2 };
  a.open.push({ to: b.id, ...o, dx, dy } as SmOpening);
  b.open.push({ to: a.id, ...o, dx: -dx, dy: -dy } as SmOpening);
}
function world(): { map: SmileMap; door: SmDoor } {
  const D1 = room('D1', 3, -4.5, 6.3, 0, { dorm: true, windows: [{ x: 4.65, y: -4.45, nx: 0, ny: 1 }] });
  const C1 = room('C1', 0, 0, 10, 2);
  const C2 = room('C2', 10, 0, 12, 2);
  const C3 = room('C3', 10, 2, 12, 12);
  link(C1, C2, 10, 0, 10, 2, 1, 0);
  link(C2, C3, 10, 2, 12, 2, 0, 1);
  link(C1, D1, 4.05, 0, 4.95, 0, 0, -1);
  const door: SmDoor = { id: 'D1/c0', room: 'D1', cor: 'C1', x: 4.5, y: 0, nx: 0, ny: 1, z: 0, w: 0.9 };
  const rooms = new Map([D1, C1, C2, C3].map((r) => [r.id, r] as const));
  return { map: { rooms, doors: [door], doorsByRoom: new Map([['D1', [door]], ['C1', [door]]]) }, door };
}

describe('losPlan — прямая видимость сквозь цепочку проёмов', () => {
  const { map } = world();
  it('в одном коридоре и сквозь проём — видно', () => {
    expect(losPlan(map, { x: 2, y: 1, room: 'C1' }, { x: 8, y: 1, room: 'C1' })).toBe(true);
    expect(losPlan(map, { x: 2, y: 1, room: 'C1' }, { x: 11, y: 1, room: 'C2' })).toBe(true);
    expect(losPlan(map, { x: 11, y: 8, room: 'C3' }, { x: 11, y: 1, room: 'C2' })).toBe(true);
  });
  it('за углом и сквозь стену — не видно', () => {
    expect(losPlan(map, { x: 2, y: 1, room: 'C1' }, { x: 11, y: 8, room: 'C3' })).toBe(false);
    // в комнату — только через дверной проём
    expect(losPlan(map, { x: 2, y: 1, room: 'C1' }, { x: 4.5, y: -2, room: 'D1' })).toBe(false);
    expect(losPlan(map, { x: 4.5, y: 1.5, room: 'C1' }, { x: 4.5, y: -2, room: 'D1' })).toBe(true);
  });
});

describe('reachFrom / pathTo — путь по графу комнат', () => {
  it('сквозь середины проёмов', () => {
    const { map } = world();
    const r = reachFrom(map, { x: 2, y: 1, room: 'C1' }, 50);
    expect(r.get('C2')!.d).toBeCloseTo(8, 5);
    expect(r.get('C3')!.d).toBeCloseTo(8 + Math.SQRT2, 5);
    expect(pathTo(r, { x: 11, y: 8, room: 'C3' })).toBeCloseTo(8 + Math.SQRT2 + 6, 5);
    expect(pathTo(r, { x: 0, y: 0, room: 'nope' })).toBeNull();
  });
});

describe('peekPlace / doorSpot — выглядывание из двери', () => {
  const { door } = world();
  it('у ближнего к зрителю косяка: тело в проёме, голова — в коридоре', () => {
    const sp = doorSpot(door, { x: 1, y: 1 });
    expect(sp.kind).toBe('door');
    expect(sp.p.room).toBe('C1');
    expect(sp.hideRoom).toBe('D1');
    expect(sp.door).toBe('D1/c0');
    const root = spotRoot(sp);
    // голова — в коридоре у западного косяка, тело — глубже в проёме, дальше от зрителя
    expect(sp.p.y).toBeGreaterThan(0.06);
    expect(Math.abs(sp.p.x - 4.05)).toBeLessThan(0.4);
    expect(root.y).toBeLessThan(0.06);
    expect(root.x).toBeGreaterThan(4.05);
    expect(root.x).toBeLessThan(4.95);
    // обращена к зрителю (на запад)
    expect(Math.cos(sp.yaw)).toBeLessThan(-0.99);
  });
  it('зритель с другой стороны — другой косяк', () => {
    const sp = doorSpot(door, { x: 9, y: 1 });
    expect(Math.abs(sp.p.x - 4.95)).toBeLessThan(0.4);
    expect(Math.cos(sp.yaw)).toBeGreaterThan(0.99);
  });
  it('напротив двери вплотную — не годится (тело видно сквозь проём); вдоль стены или далеко — годится', () => {
    expect(doorAngleOk(door, { x: 4.6, y: 1.8 })).toBe(false);
    expect(doorAngleOk(door, { x: 1, y: 1 })).toBe(true);
    expect(doorAngleOk(door, { x: 4.5, y: 7 })).toBe(true);
    expect(doorAngleOk(door, { x: 4.5, y: -1 })).toBe(false);
  });
  it('spotRoot — обратная к peekPlace', () => {
    const pl = peekPlace({ x: 4.05, y: 0.06 }, { x: 0, y: 1 }, { x: 1, y: 1 });
    const r = spotRoot({ p: { x: pl.head.x, y: pl.head.y }, yaw: pl.yaw, side: pl.side, kind: 'door' });
    expect(r.x).toBeCloseTo(pl.root.x, 6);
    expect(r.y).toBeCloseTo(pl.root.y, 6);
  });
});

describe('cornerSpots — поворот коридора', () => {
  const { map } = world();
  it('зритель в C1: стоит в C3 за ребром, голова — в повороте', () => {
    const list = cornerSpots(map, map.rooms.get('C2')!, { x: 5, y: 1 });
    expect(list).toHaveLength(1);
    const sp = list[0];
    expect(sp.p.room).toBe('C2');
    expect(sp.p.x).toBeGreaterThan(10);
    expect(sp.p.y).toBeLessThan(2);
    const r = spotRoot(sp);
    expect(r.y).toBeGreaterThan(2);
    expect(r.x).toBeGreaterThan(10);
  });
  it('зритель в C3: стоит в C1 за ребром', () => {
    const list = cornerSpots(map, map.rooms.get('C2')!, { x: 11, y: 8 });
    expect(list).toHaveLength(1);
    const r = spotRoot(list[0]);
    expect(r.x).toBeLessThan(10);
  });
  it('у жилой комнаты и прямого куска углов нет', () => {
    expect(cornerSpots(map, map.rooms.get('C1')!, { x: 5, y: 1 })).toHaveLength(0);
    expect(cornerSpots(map, map.rooms.get('D1')!, { x: 5, y: 1 })).toHaveLength(0);
  });
});

describe('windowSpot — лицо у стекла', () => {
  it('у створки ближе к зрителю, обращена в комнату, тело — за рамой', () => {
    const { map } = world();
    const D1 = map.rooms.get('D1')!;
    const sp = windowSpot(D1, D1.windows[0], 0, { x: 4, y: -2 });
    expect(sp.kind).toBe('window');
    expect(sp.p.x).toBeCloseTo(4.65 - 0.295, 6);
    expect(Math.sin(sp.yaw)).toBeCloseTo(1, 6);
    const r = spotRoot(sp);
    expect(r.y).toBeLessThan(-4.45);
  });
});

describe('aheadPoint — точка провокации по коридору', () => {
  const { map } = world();
  it('вдоль коридора по скорости, посреди прохода, лицом к игроку', () => {
    const a = aheadPoint(map, { p: { x: 2, y: 1.6, room: 'C1' }, vx: 1.7, vy: 0, fx: 1, fy: 0 }, 6)!;
    expect(a.p.room).toBe('C1');
    expect(a.p.x).toBeCloseTo(8, 1);
    expect(a.p.y).toBeCloseTo(1, 6);
    expect(Math.cos(a.yaw)).toBeLessThan(-0.95);
  });
  it('за поворот', () => {
    const a = aheadPoint(map, { p: { x: 2, y: 1, room: 'C1' }, vx: 1.7, vy: 0, fx: 1, fy: 0 }, 10)!;
    expect(a.p.room).toBe('C3');
    expect(a.p.x).toBeCloseTo(11, 6);
  });
  it('стоит — по взгляду; из жилой комнаты — в коридор и вдоль него', () => {
    const a = aheadPoint(map, { p: { x: 4.5, y: -2, room: 'D1' }, vx: 0, vy: 0, fx: 0, fy: 1 }, 6)!;
    expect(a.p.room).toBe('C1');
    expect(a.p.y).toBeCloseTo(1, 6);
    expect(Math.hypot(a.p.x - 4.5, a.p.y + 2)).toBeGreaterThanOrEqual(3);
  });
  it('в тупике ближе 3 м — некуда', () => {
    expect(aheadPoint(map, { p: { x: 11, y: 10.5, room: 'C3' }, vx: 0, vy: 1.7, fx: 0, fy: 1 }, 6)).toBeNull();
  });
});

describe('farPoint, insideDorm', () => {
  const { map } = world();
  it('далёкая комната — по пути, не по прямой', () => {
    expect(farPoint(map, { x: 2, y: 1, room: 'C1' }, 15)).toBeNull();
    expect(farPoint(map, { x: 2, y: 1, room: 'C1' }, 5)).toEqual({ x: 11, y: 1, room: 'C2' });
  });
  it('внутри жилой — за порогом не меньше insideM', () => {
    expect(insideDorm(map, { x: 4.5, y: -0.3, room: 'D1' })).toBeNull();
    expect(insideDorm(map, { x: 4.5, y: -1, room: 'D1' })).toBe('D1');
    expect(insideDorm(map, { x: 4.5, y: 1, room: 'C1' })).toBeNull();
  });
});

describe('smileSpots — кандидаты для избранного', () => {
  it('дверь и угол на виду, окно за стеной — нет', () => {
    const { map } = world();
    const list = smileSpots(map, { p: { x: 1, y: 1, room: 'C1' }, fx: 1, fy: 0 });
    const ids = list.map((c) => c.spot.id).sort();
    expect(ids).toContain('door:D1/c0');
    expect(ids.some((id) => id.startsWith('corner:C2'))).toBe(true);
    expect(ids.some((id) => id.startsWith('window:'))).toBe(false);
    const door = list.find((c) => c.spot.id === 'door:D1/c0')!;
    expect(door.pathM).toBeGreaterThan(3);
    expect(door.inView).toBe(true);
    // запертая (ключ) — не выглядывает
    expect(smileSpots(map, { p: { x: 1, y: 1, room: 'C1' }, fx: 1, fy: 0 }, { locked: () => true }).some((c) => c.spot.kind === 'door')).toBe(false);
  });
  it('из комнаты видно окно', () => {
    const { map } = world();
    const list = smileSpots(map, { p: { x: 4.5, y: -2, room: 'D1' }, fx: 0, fy: -1 });
    expect(list.some((c) => c.spot.kind === 'window' && c.inView)).toBe(true);
  });
});

describe('advanceState — часы фазы клиента между срезами', () => {
  it('выглядывание и разрыв идут дальше, idle — нет', () => {
    const s = createSmile('t');
    expect(advanceState(s, 1)).toBe(s);
    const peek = { ...s, phase: 'peek' as const, phaseT: 0.2, phaseDur: 10 };
    expect(advanceState(peek, 0.5).phaseT).toBeCloseTo(0.7, 6);
    const tear = { ...s, phase: 'tear' as const, phaseT: 0, phaseDur: SMILE.tearS + SMILE.fleeWaitS, torn: 0 };
    expect(advanceState(tear, SMILE.tearS / 2).torn).toBeCloseTo(0.5, 6);
    expect(JSON.parse(JSON.stringify(advanceState(peek, 0.1)))).toEqual(advanceState(peek, 0.1));
  });
});
