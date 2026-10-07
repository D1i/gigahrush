import { describe, expect, it } from 'vitest';
import {
  BODY_R, CAP_BOX, DOOR_BOX, DOOR_X, DOWN_PATH, EXIT_Z, FLOOR_M, IN_X, IN_Z, STATIC_BOXES, UP_PATH, VEST_Z1,
  GroundField, collide2, groundY, hash01, lampKind, lampLevel, landingFloor, moduleFloor, slotFloor, slotY, unwrapY, wrapShift,
} from './stairLoop';

describe('коллизии в плане', () => {
  it('стены выталкивают внутрь', () => {
    const [x] = collide2(IN_X - 0.05, 0, BODY_R, STATIC_BOXES);
    expect(x).toBeCloseTo(IN_X - BODY_R, 6);
    const [, z] = collide2(0.9, -IN_Z + 0.1, BODY_R, STATIC_BOXES);
    expect(z).toBeCloseTo(-IN_Z + BODY_R, 6);
  });

  it('пролёт между маршами непроходим', () => {
    const [x] = collide2(0.05, 0, BODY_R, STATIC_BOXES);
    expect(Math.abs(x)).toBeGreaterThanOrEqual(0.17 + BODY_R - 1e-9);
  });

  it('открытый проём пропускает в тамбур, закрытая дверь — нет', () => {
    const open = collide2(0, EXIT_Z + 0.2, BODY_R, STATIC_BOXES);
    expect(open[0]).toBeCloseTo(0, 6);
    expect(open[1]).toBeCloseTo(EXIT_Z + 0.2, 6);
    expect(DOOR_X * 2).toBeGreaterThan(BODY_R * 2);
    const shut = collide2(0, IN_Z - 0.1, BODY_R, [...STATIC_BOXES, DOOR_BOX]);
    expect(shut[1]).toBeLessThanOrEqual(DOOR_BOX.z0 - BODY_R + 1e-9);
    // торец тамбура
    const end = collide2(0, VEST_Z1 - 0.05, BODY_R, STATIC_BOXES);
    expect(end[1]).toBeCloseTo(VEST_Z1 - BODY_R, 6);
  });

  it('верхняя площадка: к маршу вверх не пускает, площадка свободна', () => {
    const boxes = [...STATIC_BOXES, CAP_BOX, DOOR_BOX];
    const [, z] = collide2(0.8, 1.2, BODY_R, boxes);
    expect(z).toBeGreaterThanOrEqual(CAP_BOX.z1 + BODY_R - 1e-9);
    const free = collide2(-0.78, 1.55, BODY_R, boxes);
    expect(free[0]).toBeCloseTo(-0.78, 6);
    expect(free[1]).toBeCloseTo(1.55, 6);
    // приход снизу маршем при X < 0 — свободен
    const arrive = collide2(-0.78, 0.5, BODY_R, boxes);
    expect(arrive[0]).toBeCloseTo(-0.78, 6);
  });

  it('маршрут спуска и подъёма свободен (и по отрезкам)', () => {
    for (const path of [DOWN_PATH, UP_PATH]) {
      const pts = [...path, path[0]];
      for (let k = 0; k + 1 < pts.length; k++) {
        const [a, b] = [pts[k], pts[k + 1]];
        for (let t = 0; t <= 1; t += 0.05) {
          const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
          const [cx, cz] = collide2(x, z, BODY_R, STATIC_BOXES);
          expect(Math.hypot(cx - x, cz - z)).toBeLessThan(1e-9);
        }
      }
    }
  });
});

describe('окно петли', () => {
  it('глаза держатся в [0, 3)', () => {
    expect(wrapShift(0)).toBe(0);
    expect(wrapShift(2.999)).toBe(0);
    expect(wrapShift(3)).toBe(1);
    expect(wrapShift(-0.001)).toBe(-1);
    expect(wrapShift(-3.5)).toBe(-2);
  });

  it('развёрнутая высота непрерывна при сдвиге', () => {
    let base = 0;
    let feet = 0.1; // локально
    const ys: number[] = [];
    for (let k = 0; k < 400; k++) {
      feet -= 0.05; // спуск
      const eye = feet + 1.6;
      const s = wrapShift(eye);
      if (s) {
        feet -= s * FLOOR_M;
        base += s;
      }
      ys.push(unwrapY(feet, base));
    }
    for (let k = 1; k < ys.length; k++) expect(ys[k - 1] - ys[k]).toBeCloseTo(0.05, 9);
    expect(ys[ys.length - 1]).toBeCloseTo(0.1 - 400 * 0.05, 6);
  });

  it('этажи модулей окна', () => {
    expect([0, 1, 2, 3, 4].map((i) => slotFloor(-7, i))).toEqual([-9, -8, -7, -6, -5]);
    expect([0, 1, 2, 3, 4].map(slotY)).toEqual([-6, -3, 0, 3, 6]);
    expect(landingFloor(-2.9)).toBe(-1);
    expect(landingFloor(-1.4)).toBe(0);
    expect(moduleFloor(-0.01)).toBe(-1);
    expect(moduleFloor(0)).toBe(0);
    expect(moduleFloor(2.99)).toBe(0);
  });
});

describe('лампы', () => {
  it('детерминированы по этажу, темнота гасит', () => {
    expect(hash01(1, 2, 3)).toBe(hash01(1, 2, 3));
    expect(hash01(1, 2, 3)).not.toBe(hash01(1, 2, 4));
    let dark = 0, light = 0;
    for (let f = -200; f < 200; f++) {
      if (lampKind(5, f, 0, 0.95) === 'dead') dark++;
      if (lampKind(5, f, 0, 0.1) === 'dead') light++;
    }
    expect(dark).toBeGreaterThan(300);
    expect(light).toBeLessThan(20);
    for (let t = 0; t < 5; t += 0.01) {
      const v = lampLevel('flicker', 5, 3, 1, t);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(lampLevel('dead', 5, 3, 1, 1)).toBe(0);
  });
});

describe('опора: карта высот модуля', () => {
  /** площадка (y 0) и марш из 10 ступеней 0.15/0.28 вверх по −Z при X > 0 — как в модуле */
  const field = () => {
    const g = new GroundField();
    const quad = (x0: number, z0: number, x1: number, z1: number, y: number) => {
      g.addTriangle(x0, y, z0, x1, y, z0, x1, y, z1);
      g.addTriangle(x0, y, z0, x1, y, z1, x0, y, z1);
    };
    quad(-1.45, 1.15, 1.45, 2.75, 0);
    for (let i = 0; i < 10; i++) quad(0.15, 1.15 - (i + 1) * 0.28, 1.45, 1.15 - i * 0.28, (i + 1) * 0.15);
    return g;
  };
  const all = () => true;

  it('ступени и площадка — по клеткам', () => {
    const g = field();
    expect(g.filled).toBeGreaterThan(1000);
    expect(g.heights(0, 2)).toEqual([0]);
    expect(g.heights(0.8, 1.15 - 0.28 * 2.5)[0]).toBeCloseTo(0.45, 5);
    expect(g.heights(-0.8, 0)).toEqual([]);
    expect(g.heights(9, 9)).toEqual([]);
  });

  it('высота по этажам модуля: не выше ног + подъём', () => {
    const g = field();
    // на площадке этажа −2: y = −6
    expect(groundY(g, 0, 2, -6 + 0.45, all, null)).toBeCloseTo(-6, 6);
    // над 4-й ступенью (h 0.6): с 3-й (ноги 0.45, подъём 0.45) — встаём; с пола площадки — нет,
    // опора — та же ступень этажом ниже (высоты в карте — float32)
    const z = 1.15 - 0.28 * 3.5;
    expect(groundY(g, 0.8, z, 0.45 + 0.45, all, null)).toBeCloseTo(0.6, 5);
    expect(groundY(g, 0.8, z, 0 + 0.45, all, null)).toBeCloseTo(0.6 - 3, 5);
  });

  it('скрытые модули не держат; плита низа и пол тамбура держат', () => {
    const g = field();
    const vis = (k: number) => k >= -1;
    expect(groundY(g, 0, 2, -6 + 0.45, vis, null)).toBeNull();
    // плита низа на этаже −1: на месте марша вниз (z ≤ 1.15)
    expect(groundY(g, -0.8, 0, -3 + 0.45, vis, -1)).toBeCloseTo(-3, 6);
    expect(groundY(g, -0.8, 0, -3 + 0.45, vis, null)).toBeNull();
    // тамбур за дверью — пол этажа
    expect(groundY(g, 0, 3.5, -3 + 0.3, all, null)).toBeCloseTo(-3, 6);
  });
});
