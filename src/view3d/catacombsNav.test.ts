// Катакомбы в «Прогулке»: чистая геометрия (src/view3d/catacombsNav.ts) — сухие площадки, перелаз, вода.
import { describe, expect, it } from 'vitest';
import { CATACOMBS } from '../locations/catacombsFlood';
import {
  CLIMB_BEYOND, PLAYER_R, blocked, climbDuration, climbEye, climbTarget, depthAt, dryPads, isBottle, isCatacombs, isClimbPipe, isDuct, landingOf,
  nearestDry, nearestRoom, obstacleOf, onFloor, pipeApproach, pipeGeo, underNow, waterPlaneY, type PlanProp,
} from './catacombsNav';

const pad = (x0: number, y0: number, x1: number, y1: number, z: number) => ({ x0, y0, x1, y1, z });
const inst = (id: string, tags: string[], pads: ReturnType<typeof pad>[] = [], z = 0) => ({
  id,
  roomTags: tags,
  z,
  stair: pads.length ? { flights: [], pads } : undefined,
});
const link = (a: string, b: string, extra: Record<string, unknown> = {}) => ({ a: { inst: a, connector: 'x' }, b: { inst: b, connector: 'y' }, ...extra });

describe('комнаты катакомб', () => {
  it('катакомбы — первый тег, лаз — тег «лаз» у комнаты катакомб', () => {
    expect(isCatacombs(['катакомбы', 'имперский', 'ход'])).toBe(true);
    expect(isCatacombs(['имперский', 'катакомбы'])).toBe(false);
    expect(isCatacombs(undefined)).toBe(false);
    expect(isDuct(['катакомбы', 'смешанный', 'лаз'])).toBe(true);
    expect(isDuct(['снег', 'лаз'])).toBe(false);
  });

  it('труба-перелаз — по тегу или id набора; бутылка — мусор с «бутыл» в имени или bottle в id', () => {
    expect(isClimbPipe({ propId: 'p_x', tags: ['перелаз'] })).toBe(true);
    expect(isClimbPipe({ propId: 'p_cat_pipe_low' })).toBe(true);
    expect(isClimbPipe({ propId: 'p_cat_pipe_mid', tags: [] })).toBe(true);
    expect(isClimbPipe({ propId: 'p_cat_pipe_high', tags: [] })).toBe(false);
    expect(isBottle({ propId: 'p_cat_bottle', name: 'Бутылка', tags: ['мусор'] })).toBe(true);
    expect(isBottle({ propId: 'p_cat_bottles', name: 'Кучка', tags: ['мусор'] })).toBe(true);
    expect(isBottle({ propId: 'p_cat_can', name: 'Банка', tags: ['мусор'] })).toBe(false);
    expect(isBottle({ propId: 'p_cat_bottle', name: 'Бутылка', tags: [] })).toBe(false);
  });
});

describe('сухие площадки', () => {
  it('площадки не ниже 2.1 м — в мировых метрах и абсолютной высоте, большие первыми', () => {
    const i = inst('r1', ['катакомбы', 'имперский', 'убежище'], [pad(0, 0, 10, 10, 1.2), pad(20, 0, 30, 20, 2.1), pad(40, 0, 50, 10, 2.4)], 0.5);
    const p = dryPads(i, 0.1);
    expect(p.map((x) => x.z)).toEqual([0.5 + 2.1, 0.5 + 2.4]);
    expect(p[0]).toMatchObject({ inst: 'r1', x: 2.5, y: 1, w: 1, d: 2 });
    expect(dryPads(inst('r2', ['катакомбы']), 0.1)).toEqual([]);
  });

  it('ближайшая — обходом связей (своя комната первой), без спусков и запечатанных', () => {
    const rx = {
      cellM: 0.1,
      instances: [
        inst('a', ['катакомбы', 'ход']),
        inst('b', ['катакомбы', 'ход']),
        inst('far', ['катакомбы', 'убежище'], [pad(0, 0, 10, 10, 2.1)]),
        inst('near', ['катакомбы', 'убежище'], [pad(0, 0, 10, 10, 2.2)]),
        inst('low', ['катакомбы', 'убежище'], [pad(0, 0, 10, 10, 1.5)]),
        inst('other', ['общага', 'убежище'], [pad(0, 0, 10, 10, 3)]),
      ],
      links: [link('a', 'b'), link('b', 'far'), link('a', 'low'), link('a', 'other'), link('a', 'near', { kind: 'descent' }), link('b', 'near', { sealed: true })],
    };
    expect(nearestDry(rx, 'a')?.inst).toBe('far');
    expect(nearestDry(rx, 'far')?.inst).toBe('far');
    // площадка ниже refugeM — не сухая
    expect(nearestDry({ ...rx, links: [link('a', 'low')] }, 'a')).toBeNull();
    expect(nearestDry(rx, 'a')!.z).toBeGreaterThanOrEqual(CATACOMBS.refugeM);
    expect(nearestRoom(rx.links, 'a', (id) => id === 'b')).toBe('b');
    expect(nearestRoom(rx.links, 'a', () => false)).toBeNull();
  });
});

/** Труба поперёк хода вдоль x: пролёт 2 м (w), толщина 0.3 м (d), высота h. */
const pipe = (over: Partial<PlanProp> = {}): PlanProp => ({ inst: 'r', propId: 'p_cat_pipe_low', x: 1, y: 5, rot: 0, w: 2, d: 0.3, h: 0.7, tags: ['перелаз'], ...over });
/** Ход 2 × 10 м: x 0…2, y 0…10. */
const hall = [{ x0: 0, y0: 0, x1: 2, y1: 10 }];

describe('перелаз: геометрия трубы', () => {
  it('длинная сторона — пролёт; поворот по часовой (план, y вниз)', () => {
    const g = pipeGeo(pipe(), 0);
    expect(g).toMatchObject({ cx: 1, cy: 5, half: 0.15, len: 1, base: 0, top: 0.7 });
    expect(Math.abs(g.tx)).toBeCloseTo(1);
    expect(Math.abs(g.ny)).toBeCloseTo(1);
    // глубина длиннее ширины — пролёт по локальной y
    const h = pipeGeo(pipe({ w: 0.3, d: 2 }), 0.5);
    expect(h.len).toBeCloseTo(1);
    expect(Math.abs(h.ty)).toBeCloseTo(1);
    expect(h.base).toBe(0.5);
    // поворот на 90°: локальная x уходит в +y
    const r = pipeGeo(pipe({ rot: 90 }), 0);
    expect(r.tx).toBeCloseTo(0);
    expect(Math.abs(r.ty)).toBeCloseTo(1);
    expect(Math.abs(r.nx)).toBeCloseTo(1);
    // своя отметка предмета (площадка) — base
    expect(pipeGeo(pipe({ z: 2.1 }), 0)).toMatchObject({ base: 2.1, top: 2.8 });
  });

  it('смотрю ли на трубу: близко, в пролёте, взгляд поперёк на другую сторону', () => {
    const g = pipeGeo(pipe(), 0);
    // игрок у трубы с меньших y (над ней на плане), смотрит вниз по плану (+y) — на трубу
    const a = pipeApproach(g, { x: 1, y: 4.2 }, { x: 0, y: 1 });
    expect(a).not.toBeNull();
    expect(a!.gap).toBeCloseTo(0.65);
    expect(a!.dot).toBeCloseTo(1);
    // спиной — нет; вбок (вдоль трубы) — нет; под 45° — да
    expect(pipeApproach(g, { x: 1, y: 4.2 }, { x: 0, y: -1 })).toBeNull();
    expect(pipeApproach(g, { x: 1, y: 4.2 }, { x: 1, y: 0 })).toBeNull();
    expect(pipeApproach(g, { x: 1, y: 4.2 }, { x: 1, y: 1 })).not.toBeNull();
    // далеко — нет; за концом пролёта — нет
    expect(pipeApproach(g, { x: 1, y: 3.5 }, { x: 0, y: 1 })).toBeNull();
    expect(pipeApproach(g, { x: 2.3, y: 4.5 }, { x: 0, y: 1 })).toBeNull();
    // с другой стороны — сторона другая, смотреть в −y
    const b = pipeApproach(g, { x: 0.5, y: 5.6 }, { x: 0, y: -1 });
    expect(b).not.toBeNull();
    expect(b!.side).toBe(-a!.side);
    expect(b!.along).toBeCloseTo(-0.5);
  });

  it('место за трубой: напротив игрока, на CLIMB_BEYOND дальше грани; на полу и не в предмете', () => {
    const g = pipeGeo(pipe(), 0);
    const a = pipeApproach(g, { x: 1, y: 4.3 }, { x: 0, y: 1 })!;
    const l = landingOf(g, a.side, a.along);
    expect(l.x).toBeCloseTo(1);
    expect(l.y).toBeCloseTo(5 + 0.15 + CLIMB_BEYOND);
    expect(climbTarget(g, a, hall, [])).toEqual(l);
    // у самого конца пролёта — не ближе радиуса к стене
    const e = landingOf(g, a.side, 0.98);
    expect(e.x).toBeCloseTo(1 + 1 - PLAYER_R);
    // ход кончается сразу за трубой — места нет
    expect(climbTarget(g, a, [{ x0: 0, y0: 0, x1: 2, y1: 5.5 }], [])).toBeNull();
    // за трубой ящик напротив — сдвиг вдоль пролёта; ящик во всю ширину — нельзя
    const box = obstacleOf({ inst: 'r', propId: 'p_cat_crate', x: 1, y: 5.8, rot: 0, w: 0.5, d: 0.5, h: 0.6 }, 0)!;
    const t = climbTarget(g, a, hall, [box]);
    expect(t).not.toBeNull();
    expect(Math.abs(t!.x - 1)).toBeGreaterThan(0.5);
    const wall = obstacleOf({ inst: 'r', propId: 'p_cat_rubble', x: 1, y: 5.8, rot: 0, w: 2, d: 0.6, h: 1 }, 0)!;
    expect(climbTarget(g, a, hall, [wall])).toBeNull();
    // мусор и подвесное под потолком — не помеха; высоко над телом — не помеха
    expect(obstacleOf({ inst: 'r', propId: 'p_cat_bottle', x: 1, y: 5.8, rot: 0, w: 0.3, d: 0.1, h: 0.1, tags: ['мусор'] }, 0)).toBeNull();
    expect(obstacleOf({ inst: 'r', propId: 'p_cat_vault_1', x: 1, y: 5.8, rot: 0, w: 2, d: 1, h: 1, tags: ['потолок'] }, 0)).toBeNull();
    const high = obstacleOf({ inst: 'r', propId: 'p_cat_pipe_high', x: 1, y: 5.8, rot: 0, w: 2, d: 0.3, h: 1.9, clear: 1.8 }, 0)!;
    expect(blocked([high], 1, 5.8, 0)).toBe(false);
    expect(blocked([wall], 1, 5.8, 0)).toBe(true);
    // повёрнутая помеха — по своим осям
    const rotBox = obstacleOf({ inst: 'r', propId: 'p_cat_crate', x: 1, y: 5.8, rot: 90, w: 2, d: 0.2, h: 1 }, 0)!;
    // rot 90: ширина 2 м уходит вдоль y (4.8…6.8), глубина 0.2 м — по x
    expect(blocked([rotBox], 1, 6.6, 0)).toBe(true);
    expect(blocked([rotBox], 1.5, 5.8, 0)).toBe(false);
    expect(blocked([rotBox], 1, 7.2, 0)).toBe(false);
  });

  it('на полу: круг радиуса игрока целиком в прямоугольниках (стык кусков — внутри)', () => {
    expect(onFloor(hall, 1, 5)).toBe(true);
    expect(onFloor(hall, 0.2, 5)).toBe(false);
    expect(onFloor([{ x0: 0, y0: 0, x1: 2, y1: 5 }, { x0: 0, y0: 5, x1: 2, y1: 10 }], 1, 5)).toBe(true);
  });

  it('дуга перелаза: концы — свои высоты, в середине над трубой с запасом 0.35 м', () => {
    expect(climbEye(0, 1.6, 1.62, 0.7)).toBeCloseTo(1.6);
    expect(climbEye(1, 1.6, 1.62, 0.7)).toBeCloseTo(1.62);
    // низкая труба: горб не меньше 8 см над прямой
    expect(climbEye(0.5, 1.6, 1.6, 0.7)).toBeCloseTo(1.68);
    // скрючившись у трубы по грудь: глаз над её верхом на 0.35
    expect(climbEye(0.5, 1.1, 1.6, 1.25)).toBeCloseTo(1.6);
    expect(climbDuration(0.7)).toBeGreaterThanOrEqual(0.8);
    expect(climbDuration(1.25)).toBeLessThanOrEqual(1.3);
    expect(climbDuration(1.25)).toBeGreaterThan(climbDuration(0.7));
  });
});

describe('вода', () => {
  it('глубина у ног и «под водой» с гистерезисом', () => {
    expect(depthAt(1.2, 0)).toBeCloseTo(1.2);
    expect(depthAt(1.2, 2.1)).toBe(0);
    expect(underNow(false, 1.6, 1.6)).toBe(false);
    expect(underNow(false, 1.55, 1.6)).toBe(true);
    expect(underNow(true, 1.62, 1.6)).toBe(true);
    expect(underNow(true, 1.64, 1.6)).toBe(false);
  });

  it('плоскость воды — не выше потолка комнаты (лаз 0.85 м)', () => {
    expect(waterPlaneY(0, 1.5, 3)).toBeCloseTo(1.5);
    expect(waterPlaneY(0, 1.5, 0.85)).toBeCloseTo(0.82);
    expect(waterPlaneY(1, 0.06, null)).toBeCloseTo(1.06);
  });
});
