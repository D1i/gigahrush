// Эскалаторы метро (./metroEscalator.ts): дорожки и направления от сида, линия носков = опора марша, конвейер, броски
// срыва (детерминированы сидом, первая поездка и первые 60 с — без срыва, пауза 120 с), стадии по времени, «донесло до
// низа», перелезание, падение, возрождение.
import { describe, expect, it } from 'vitest';
import type { RunInstance, StairGeo } from '../blockout/types';
import { stairFloorAt } from '../blockout/stairs';
import {
  bgDue, beltSpeed, calmNow, carriedDown, carryStep, climbTarget, collapseShake, createCollapse, createDice, ESC, escDeadAt, escFallPose,
  escLandAt, escLanes, isEscalator, isMetroRoom, isRespawnRoom, lampFlicker, laneAt, laneAxes, laneDirs, lanePoint, LIE_EYE, nearestRoom,
  noseZ, noteBreak, rideRoll, runawayLeft, slidePose, slopeLen, stageAt, stepCollapse, tickDice, type EscLane,
} from './metroEscalator';

/** Тоннель как в контракте: 6.0 × 19.0 м, три марша по 1.2 м (x 0.4–1.6, 2.4–3.6, 4.4–5.6), y 2.5–16.5, подъём 8.1. */
const flights = () => [
  { x0: 4, y0: 25, x1: 16, y1: 165, up: 'N' as const, z0: 0, z1: 8.1, style: 'escalator' as const },
  { x0: 24, y0: 25, x1: 36, y1: 165, up: 'N' as const, z0: 0, z1: 8.1, style: 'escalator' as const },
  { x0: 44, y0: 25, x1: 56, y1: 165, up: 'N' as const, z0: 0, z1: 8.1, style: 'escalator' as const },
];
const tunnel = (o: Partial<RunInstance> = {}): Pick<RunInstance, 'stair' | 'escLanes' | 'escBroken' | 'roomTags' | 'z'> => ({
  roomTags: ['метро', 'эскалатор', 'лестница', 'ход', 'только-биом'],
  stair: { flights: flights(), pads: [{ x0: 0, y0: 0, x1: 60, y1: 25, z: 8.1 }] },
  z: 2.7,
  ...o,
});
const lanesOf = (o: Partial<RunInstance> = {}, key = 'сид/i7') => escLanes(tunnel(o), 0.1, key);

describe('эскалатор: дорожки', () => {
  it('комната: тег «эскалатор» и марши escalator; метро и возрождение — по тегам', () => {
    expect(isEscalator(tunnel())).toBe(true);
    expect(isEscalator(tunnel({ roomTags: ['метро', 'зал'] }))).toBe(false);
    expect(isEscalator(tunnel({ stair: undefined }))).toBe(false);
    expect(isEscalator(null)).toBe(false);
    expect(isMetroRoom(['метро', 'зал'])).toBe(true);
    expect(isMetroRoom(['общага', 'метро'])).toBe(false);
    expect(isRespawnRoom(['метро', 'зал', 'ход'])).toBe(true);
    expect(isRespawnRoom(['метро', 'хаб'])).toBe(true);
    expect(isRespawnRoom(['метро', 'эскалатор', 'зал'])).toBe(false);
    expect(isRespawnRoom(['метро', 'переход'])).toBe(false);
  });

  it('геометрия: метры, высоты над низом комнаты, номер — индекс марша; марш вниз (z1 < z0) — подъём наоборот', () => {
    const L = lanesOf();
    expect(L.map((l) => l.lane)).toEqual([0, 1, 2]);
    expect(L[1]).toMatchObject({ x0: 2.4, x1: 3.6, up: 'N', z0: 2.7, z1: 10.8, broken: false, steps: 54 });
    expect(L[1].y0).toBeCloseTo(2.5, 9);
    expect(L[1].y1).toBeCloseTo(16.5, 9);
    expect(L[1].len).toBeCloseTo(14, 9);
    expect(L[1].width).toBeCloseTo(1.2, 9);
    const rev = escLanes(tunnel({ stair: { flights: [{ ...flights()[0], z0: 8.1, z1: 0 }], pads: [] } }), 0.1, 'k');
    expect(rev[0]).toMatchObject({ up: 'S', z0: 2.7, z1: 10.8 });
  });

  it('стиль: дорожки — только марши escalator; без стиля у всех (не дошёл до экспорта) — все марши комнаты с тегом', () => {
    const f = flights();
    delete (f[1] as { style?: string }).style;
    expect(escLanes(tunnel({ stair: { flights: f, pads: [] } }), 0.1, 'k').map((l) => l.lane)).toEqual([0, 2]);
    const plain = flights().map(({ style: _s, ...x }) => x);
    expect(escLanes(tunnel({ stair: { flights: plain, pads: [] } }), 0.1, 'k').map((l) => l.lane)).toEqual([0, 1, 2]);
    expect(escLanes(tunnel({ roomTags: ['метро', 'зал'] }), 0.1, 'k')).toEqual([]);
  });

  it('сломанная: из escBroken; марши до поломки — из escLanes (номер дорожки не съезжает)', () => {
    const f = flights();
    const L = lanesOf({ stair: { flights: [f[0], f[2]], pads: [] }, escLanes: f, escBroken: [1] });
    expect(L.map((l) => [l.lane, l.broken])).toEqual([[0, false], [1, true], [2, false]]);
    expect(L[1].x0).toBeCloseTo(2.4, 9);
  });

  it('направления — от сида: те же у всех; обычно 0 вверх, средняя стоит или вниз, последняя вниз; иногда зеркально', () => {
    expect(laneDirs('a/i1', 3)).toEqual(laneDirs('a/i1', 3));
    expect(laneDirs('x', 1)).toEqual([1]);
    expect(laneDirs('x', 0)).toEqual([]);
    let flip = 0, stop = 0;
    const N = 2000;
    for (let i = 0; i < N; i++) {
      const d = laneDirs(`s/i${i}`, 3);
      expect([1, -1]).toContain(d[0]);
      expect(d[2]).toBe(-d[0]);
      expect([0, -1]).toContain(d[1]);
      if (d[0] === -1) flip++;
      if (d[1] === 0) stop++;
    }
    expect(flip / N).toBeGreaterThan(0.2);
    expect(flip / N).toBeLessThan(0.3);
    expect(stop / N).toBeGreaterThan(0.45);
    expect(stop / N).toBeLessThan(0.55);
    expect(lanesOf().map((l) => l.dir)).toEqual(laneDirs('сид/i7', 3));
  });

  it('оси: точка ↔ (s, a) для всех сторон; дорожка под точкой', () => {
    for (const up of ['N', 'S', 'E', 'W'] as const) {
      const l: EscLane = { lane: 0, x0: 1, y0: 2, x1: 3, y1: 12, up, z0: 0, z1: 5, len: up === 'N' || up === 'S' ? 10 : 2, width: up === 'N' || up === 'S' ? 2 : 10, steps: 33, dir: 1, broken: false };
      const [x, y] = lanePoint(l, 0.7, 0.4);
      const { s, a } = laneAxes(l, x, y);
      expect(s).toBeCloseTo(0.7, 9);
      expect(a).toBeCloseTo(0.4, 9);
    }
    const L = lanesOf();
    const hit = laneAt(L, 3.0, 10);
    expect(hit?.lane.lane).toBe(1);
    expect(hit?.s).toBeCloseTo(6.5, 9);
    expect(laneAt(L, 2.0, 10)).toBeNull(); // балюстрада между дорожками
    expect(laneAt(L, 3.0, 1)).toBeNull(); // верхняя площадка
    expect(laneAt(L, 3.0, 16.6)?.lane.lane).toBe(1); // проступь перед маршем — ещё дорожка
    expect(laneAt(L, 3.0, 17.5)).toBeNull(); // нижняя площадка
  });

  it('линия носков — та же, что у опоры марша (src/blockout/stairs.ts)', () => {
    const l = lanesOf()[0];
    const g: StairGeo = {
      inst: 'i7', base: 2.7, pads: [], rails: [],
      flights: [{ rect: { x0: l.x0, y0: l.y0, x1: l.x1, y1: l.y1 }, up: l.up, z0: l.z0, z1: l.z1, steps: l.steps }],
    };
    for (let s = -0.2; s <= l.len; s += 0.37) {
      const [x, y] = lanePoint(l, s, 0.6);
      expect(noseZ(l, s), `s=${s}`).toBeCloseTo(stairFloorAt([g], x, y)!.z, 9);
    }
    expect(noseZ(l, -5)).toBeCloseTo(2.7, 9);
    expect(noseZ(l, l.len)).toBeCloseTo(10.8, 9);
  });

  it('конвейер: по наклону 0.75 м/с — в плане меньше на косинус; вверх — к стороне подъёма', () => {
    const l = lanesOf()[0];
    const [dx, dy] = carryStep(l, ESC.speed, 1);
    expect(dx).toBe(0);
    expect(dy).toBeLessThan(0); // N — к меньшему y
    expect(-dy).toBeCloseTo((ESC.speed * l.len) / slopeLen(l), 9);
    expect(slopeLen(l)).toBeCloseTo(Math.hypot(14, 8.1), 9);
    const [, dn] = carryStep(l, -ESC.speed, 0.5);
    expect(dn).toBeCloseTo(-dy / 2, 9);
  });
});

describe('эскалатор: бросок срыва', () => {
  const ridesWithBreak = (seed: string, n: number): number[] => {
    const d = createDice(seed);
    tickDice(d, 1000);
    const out: number[] = [];
    for (let i = 0; i < n; i++) if (rideRoll(d)) out.push(i);
    return out;
  };

  it('детерминирован сидом и номером поездки; шанс ≈ 5%; срыв — на доле пути 0.3…0.65', () => {
    expect(ridesWithBreak('a', 400)).toEqual(ridesWithBreak('a', 400));
    expect(ridesWithBreak('a', 400)).not.toEqual(ridesWithBreak('b', 400));
    let hits = 0;
    const N = 20000;
    const d = createDice('много');
    tickDice(d, 1e6);
    for (let i = 0; i < N; i++) {
      const r = rideRoll(d);
      if (!r) continue;
      hits++;
      expect(r.at).toBeGreaterThanOrEqual(0.3);
      expect(r.at).toBeLessThanOrEqual(0.65);
    }
    expect(hits / N).toBeGreaterThan(0.04);
    expect(hits / N).toBeLessThan(0.06);
  });

  it('первая поездка — никогда; первые 60 с в метро — никогда (поездки всё равно считаются)', () => {
    for (let s = 0; s < 300; s++) {
      const d = createDice(`s${s}`);
      tickDice(d, 1e5);
      expect(rideRoll(d), `seed s${s}`).toBeNull();
      expect(d.rides).toBe(1);
    }
    const d = createDice('рано');
    for (let i = 0; i < 2000; i++) {
      tickDice(d, 0.02);
      expect(rideRoll(d)).toBeNull();
    }
    expect(d.t).toBeLessThan(ESC.graceS);
    expect(d.rides).toBe(2000);
    expect(calmNow(d)).toBe(true);
  });

  it('пауза 120 с после любого срыва рядом', () => {
    const d = createDice('пауза');
    tickDice(d, 200);
    expect(calmNow(d)).toBe(false);
    noteBreak(d);
    expect(calmNow(d)).toBe(true);
    let any = false;
    for (let i = 0; i < 3000; i++) {
      tickDice(d, 0.03);
      if (rideRoll(d)) any = true;
    }
    expect(d.t - d.last).toBeLessThan(ESC.pauseS);
    expect(any).toBe(false);
    tickDice(d, ESC.pauseS);
    expect(calmNow(d)).toBe(false);
  });

  it('фоновый: время копится, только пока видна целая дорожка; срок 180…540 с; пауза действует', () => {
    const d = createDice('фон');
    tickDice(d, 100);
    expect(d.bgNext).toBeGreaterThanOrEqual(ESC.bgEveryS * 0.5);
    expect(d.bgNext).toBeLessThan(ESC.bgEveryS * 1.5);
    for (let i = 0; i < 10000; i++) expect(bgDue(d, 0.1, false)).toBe(false);
    expect(d.bgT).toBe(0);
    let at = -1;
    for (let i = 0; i < 6000 && at < 0; i++) if (bgDue(d, 0.1, true)) at = i * 0.1;
    expect(at).toBeGreaterThan(ESC.bgEveryS * 0.5 - 1);
    expect(at).toBeLessThan(ESC.bgEveryS * 1.5);
    expect(d.bgN).toBe(1);
    noteBreak(d);
    d.bgT = 1e6;
    expect(bgDue(d, 0.1, true)).toBe(false);
  });
});

describe('эскалатор: срыв', () => {
  const total = ESC.shudderS + ESC.runawayS + ESC.fallS;

  it('стадии по времени: shudder → runaway → fall → broken; события — по порядку, и при крупном шаге', () => {
    expect(stageAt(0)).toBe('shudder');
    expect(stageAt(ESC.shudderS + 0.01)).toBe('runaway');
    expect(stageAt(ESC.shudderS + ESC.runawayS + 0.01)).toBe('fall');
    expect(stageAt(total + 0.01)).toBe('broken');
    const c = createCollapse('i7', 1, ESC.speed);
    const ev: string[] = [];
    for (let i = 0; i < 400; i++) ev.push(...stepCollapse(c, 1 / 60));
    expect(ev).toEqual(['runaway', 'fall', 'broken']);
    const big = createCollapse('i7', 1, ESC.speed);
    expect(stepCollapse(big, 10)).toEqual(['runaway', 'fall', 'broken']);
    expect(stepCollapse(big, 1)).toEqual([]);
    expect(stepCollapse(big, 0)).toEqual([]);
  });

  it('лента: рывком встаёт, бежит вниз с разгоном до 7 м/с; путь — интеграл (шаг кадра не важен)', () => {
    expect(beltSpeed(0, 0.75)).toBeCloseTo(0.75, 9);
    expect(beltSpeed(ESC.jerkS + 0.01, 0.75)).toBe(0);
    expect(beltSpeed(ESC.shudderS + ESC.runawayS - 1e-9, 0.75)).toBeCloseTo(-ESC.runawayV, 6);
    expect(beltSpeed(total, 0.75)).toBe(0);
    const want = (0.75 * ESC.jerkS) / 2 - (ESC.runawayV * ESC.runawayS) / 2;
    for (const dt of [1 / 144, 1 / 60, 1 / 20, 0.37]) {
      const c = createCollapse('i', 0, 0.75);
      while (c.t < total) stepCollapse(c, dt);
      expect(c.belt, `dt=${dt}`).toBeCloseTo(want, 6);
      expect(c.v).toBe(0);
    }
  });

  it('«донесло до низа»: лента до обрыва убежит 8.75 м; позже — меньше; после обрыва — нисколько', () => {
    const full = (ESC.runawayV * ESC.runawayS) / 2;
    expect(runawayLeft(0)).toBeCloseTo(full, 9);
    expect(runawayLeft(ESC.shudderS)).toBeCloseTo(full, 9);
    expect(runawayLeft(ESC.shudderS + ESC.runawayS / 2)).toBeCloseTo(full * 0.75, 9);
    expect(runawayLeft(ESC.shudderS + ESC.runawayS)).toBe(0);
    expect(carriedDown(5, 0)).toBe(true);
    expect(carriedDown(full, 0)).toBe(true);
    expect(carriedDown(full + 0.1, 0)).toBe(false);
    expect(carriedDown(7, ESC.shudderS + 1.5)).toBe(false);
    expect(carriedDown(-1, total)).toBe(true); // уже внизу
    // согласовано со stepCollapse: стоящего смирно в dist от низа лента сносит ровно на |belt| за runaway
    const c = createCollapse('i', 0, 0);
    stepCollapse(c, ESC.shudderS);
    const b0 = c.belt;
    stepCollapse(c, ESC.runawayS);
    expect(b0 - c.belt).toBeCloseTo(runawayLeft(ESC.shudderS), 6);
  });

  it('тряска и мигание торшеров: детерминированы, после обрыва — гаснут', () => {
    expect(collapseShake(0.1)).toBeGreaterThan(1);
    expect(collapseShake(total + 1)).toBe(0);
    expect(lampFlicker(0.5, 'k')).toBe(lampFlicker(0.5, 'k'));
    expect(lampFlicker(total + 1, 'k')).toBe(0);
    for (let t = 0; t < total; t += 0.05) {
      const f = lampFlicker(t, 'k');
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
    }
  });

  it('сползание: стоит — как марш; лежит — на дне, низ уехал к нижней площадке на (длина по наклону − длина)', () => {
    const l = lanesOf()[0];
    expect(slidePose(l, 0).pitch).toBeCloseTo(0, 9);
    expect(slidePose(l, 0).shift).toBeCloseTo(0, 9);
    const end = slidePose(l, 1);
    expect(end.pitch).toBeCloseTo(Math.atan2(8.1, 14), 9);
    expect(end.shift).toBeCloseTo(slopeLen(l) - l.len, 9);
    let prev = -1;
    for (let k = 0; k <= 1; k += 0.05) {
      const p = slidePose(l, k);
      expect(p.pitch).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = p.pitch;
    }
  });
});

describe('эскалатор: перелезть, падение, возрождение', () => {
  it('перелезть: к ближней соседней целой; у концов — нельзя; сломанная и срывающаяся — не соседи', () => {
    const L = lanesOf();
    expect(climbTarget(L, L[1], 6, 0.2)?.lane).toBe(0);
    expect(climbTarget(L, L[1], 6, 1.0)?.lane).toBe(2);
    expect(climbTarget(L, L[0], 6, 0.1)?.lane).toBe(1); // у стены соседа нет — другая сторона
    expect(climbTarget(L, L[1], 0.5, 0.2)).toBeNull();
    expect(climbTarget(L, L[1], L[1].len - 0.5, 0.2)).toBeNull();
    expect(climbTarget(L, L[1], 6, 0.2, (n) => n === 0)?.lane).toBe(2);
    expect(climbTarget(L, L[1], 6, 0.2, (n) => n !== 1)).toBeNull();
    const f = flights();
    const B = lanesOf({ stair: { flights: [f[1]], pads: [] }, escLanes: f, escBroken: [0, 2] });
    expect(climbTarget(B, B[1], 6, 0.2)).toBeNull();
  });

  it('падение: проседает, свободно падает до дна, лежит; глаз не ниже «лёжа»; смерть — после удара', () => {
    const h = 6.2;
    const land = escLandAt(h);
    expect(land).toBeCloseTo(0.3 + Math.sqrt((2 * (h - 0.3 - LIE_EYE)) / 9.81), 9);
    expect(escDeadAt(h)).toBeGreaterThan(land);
    let prev = Infinity;
    for (let t = 0; t <= land + 1; t += 0.01) {
      const p = escFallPose(t, h);
      expect(p.y).toBeLessThanOrEqual(prev + 1e-9);
      expect(p.y).toBeGreaterThanOrEqual(LIE_EYE - 1e-9);
      prev = p.y;
      expect(p.phase).toBe(t < 0.3 ? 'break' : t < land ? 'fall' : 'lie');
    }
    expect(escFallPose(0, h).y).toBeCloseTo(h, 9);
    expect(escFallPose(land + 0.2, h).y).toBe(LIE_EYE);
    // низко (у самого низа марша) — сразу лёжа, без NaN
    const low = escFallPose(0.5, 0.2);
    expect(low.y).toBe(LIE_EYE);
    expect(Number.isFinite(low.pitch)).toBe(true);
  });

  it('возрождение: ближайшая по проёмам подходящая комната (поиск в ширину), нет — null', () => {
    const links = [
      { a: { inst: 'esc' }, b: { inst: 'p1' } },
      { a: { inst: 'p1' }, b: { inst: 'p2' } },
      { a: { inst: 'p2' }, b: { inst: 'hallFar' } },
      { a: { inst: 'esc' }, b: { inst: 'x1' } },
      { a: { inst: 'x1' }, b: { inst: 'hallNear' } },
    ];
    const hall = (id: string) => id.startsWith('hall');
    expect(nearestRoom(links, 'esc', hall)).toBe('hallNear');
    expect(nearestRoom(links, 'hallFar', hall)).toBe('hallFar');
    expect(nearestRoom(links, 'esc', () => false)).toBeNull();
    expect(nearestRoom(links, 'esc', hall, 1)).toBeNull();
  });
});
