// Описание лестницы комнаты (Room.stair): прямой зал, высоты у меток, поворот в мир, проверки, сохранение в проекте.
import { describe, expect, it } from 'vitest';
import { transformSeg } from '../gen/geom';
import { parseRoom, serializeRoom } from './serialize';
import { connDz, connZ, parseStair, stairIssues, stairRise, stairZ, STOREY_M, straightStair, worldStair } from './stairs';
import { stairHall } from './stairs.test-util';
import type { Rot } from './types';

describe('лестница комнаты', () => {
  it('прямой зал: нижняя площадка, марш, верхняя площадка', () => {
    const s = straightStair({ w: 2.4, l: 5.5, up: 'N' });
    expect(s.flights).toEqual([{ x: 0, y: 10, w: 24, h: 35, up: 'N', z0: 0, z1: STOREY_M }]);
    expect(s.pads).toEqual([{ x: 0, y: 0, w: 24, h: 10, z: STOREY_M }]);
    expect(stairRise(s)).toBe(STOREY_M);
    // высота по средней линии: низ марша 0, середина — половина, у верхней площадки — этаж
    expect(stairZ(s, 12, 44.9)).toBeCloseTo(0.0077, 3);
    expect(stairZ(s, 12, 27.5)).toBeCloseTo(STOREY_M / 2, 6);
    expect(stairZ(s, 12, 5)).toBe(STOREY_M);
    expect(stairZ(s, 12, 50)).toBe(0);
    // вверх на юг / восток, узкий марш со сдвигом
    const e = straightStair({ w: 2, l: 6, up: 'E', flightW: 1.2, offset: 0.8, landing: 1.5, top: 0.5 });
    expect(e.flights[0]).toEqual({ x: 15, y: 8, w: 40, h: 12, up: 'E', z0: 0, z1: STOREY_M });
    expect(e.pads![0]).toEqual({ x: 55, y: 0, w: 5, h: 20, z: STOREY_M });
  });

  it('высота у меток: верх марша — его верх, низ — низ; поворот экземпляра её не меняет', () => {
    const h = stairHall('t');
    expect(connDz(h, 0)).toBeCloseTo(STOREY_M, 9);
    expect(connDz(h, 1)).toBe(0);
    expect(stairIssues(h)).toEqual([]);
    for (const rot of [0, 90, 180, 270] as Rot[]) {
      const ws = worldStair(h.stair!, rot, 7, -3);
      const spec = {
        flights: ws.flights.map((f) => ({ x: f.x0, y: f.y0, w: f.x1 - f.x0, h: f.y1 - f.y0, up: f.up, z0: f.z0, z1: f.z1 })),
        pads: ws.pads.map((q) => ({ x: q.x0, y: q.y0, w: q.x1 - q.x0, h: q.y1 - q.y0, z: q.z })),
      };
      h.connectors.forEach((c, ci) => expect(connZ(spec, transformSeg(c, rot, 7, -3)), `rot ${rot} ${c.name}`).toBeCloseTo(connDz(h, ci), 9));
    }
  });

  it('проверки: марш за клетками, метка на боку марша, высоты', () => {
    const h = stairHall('t');
    expect(stairIssues({ ...h, stair: { flights: [{ x: 20, y: 10, w: 10, h: 35, up: 'N', z0: 0, z1: 2.7 }] } }).join()).toMatch(/выходит за клетки/);
    expect(stairIssues({ ...h, stair: { flights: [{ x: 0, y: 0, w: 24, h: 55, up: 'E', z0: 0, z1: 2.7 }] } }).join()).toMatch(/на боку марша/);
    expect(stairIssues({ ...h, stair: { flights: [{ x: 0, y: 10, w: 24, h: 35, up: 'N', z0: 1, z1: 1 }] } }).join()).toMatch(/высоты/);
  });

  it('сохраняется в проекте (serializeRoom / parseRoom), мусор отбрасывается', () => {
    const h = stairHall('t');
    const back = parseRoom(JSON.parse(JSON.stringify(serializeRoom(h, 0.1))));
    expect(back.stair).toEqual(h.stair);
    expect(connDz(back, 0)).toBeCloseTo(STOREY_M, 9);
    const { stair: _s, ...plain } = h;
    expect('stair' in parseRoom(JSON.parse(JSON.stringify(serializeRoom({ ...plain } as typeof h, 0.1))))).toBe(false);
    expect(parseStair({ flights: 'x' })).toBeNull();
    expect(parseStair({ flights: [{ x: 1, y: 1, w: 0, h: 3 }] })).toBeNull();
    expect(parseStair({ flights: [{ x: 1, y: 1, w: 2, h: 3, up: 'Q', z0: -1, z1: 2 }] })).toEqual({ flights: [{ x: 1, y: 1, w: 2, h: 3, up: 'N', z0: 0, z1: 2 }] });
  });
});
