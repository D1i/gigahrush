import { describe, expect, it } from 'vitest';
import { buildSnowMesh, crawlProfile, snowField, SNOW_A, SNOW_CRAWL_H, type SnowDoor, type SnowPieceSpec } from './snowMesh';

const door = (id: string, side: SnowDoor['side'], x: number, y: number, half = 0.6, state: SnowDoor['state'] = 'open'): SnowDoor => {
  const n = { N: [0, 1], S: [0, -1], E: [-1, 0], W: [1, 0] }[side];
  return { id, side, x, y, nx: n[0], ny: n[1], half, state };
};

/** прямой лаз 1.2 × len м вдоль y (проёмы N и S), начало плана — (x0, y0); pad — полузазор до плоскости проёма */
const straight = (x0: number, y0: number, len: number, seed: number, rise = 0, pad = 0): SnowPieceSpec => ({
  x0, y0, x1: x0 + 1.2, y1: y0 + len, floorY: 0, den: false, rise, bench: false, seed, pad,
  doors: [door('n', 'N', x0 + 0.6, y0 - pad), door('s', 'S', x0 + 0.6, y0 + len + pad)],
});

/** вершины сетки на плоскости y = Y (Babylon Z = −Y), отсортированные */
const ring = (m: ReturnType<typeof buildSnowMesh>, Y: number) => {
  const out: string[] = [];
  for (let i = 0; i < m.positions.length / 3; i++) {
    if (Math.abs(m.positions[i * 3 + 2] + Y) < 1e-6) out.push(`${m.positions[i * 3].toFixed(4)},${m.positions[i * 3 + 1].toFixed(4)}`);
  }
  return out.sort();
};

describe('снежная оболочка куска', () => {
  it('профиль устья — как у набора пользователя: 1.1 м в свету, 0.9 м высотой', () => {
    expect(crawlProfile(0, 0.45)).toBeLessThan(0);
    expect(crawlProfile(SNOW_A + 0.01, 0.3)).toBeGreaterThan(0);
    expect(crawlProfile(0, SNOW_CRAWL_H + 0.01)).toBeGreaterThan(0);
    expect(crawlProfile(0, -0.01)).toBeGreaterThan(0);
  });

  it('у соседей по проёму кольцо вершин на плоскости проёма совпадает (шов не виден)', () => {
    const a = buildSnowMesh(straight(3.0, 1.0, 3, 11, 0.25));
    const b = buildSnowMesh(straight(3.0, 4.0, 2, 77));
    const ra = ring(a, 4.0), rb = ring(b, 4.0);
    expect(ra.length).toBeGreaterThan(20);
    expect(ra).toEqual(rb);
    // с зазором 0.1 м между комнатами: плоскость проёма — середина зазора, оболочки доходят до неё обе
    const c = buildSnowMesh(straight(3.0, 1.0, 3, 11, -0.3, 0.05));
    const d = buildSnowMesh(straight(3.0, 4.1, 2, 77, 0, 0.05));
    const rc = ring(c, 4.05), rd = ring(d, 4.05);
    expect(rc.length).toBeGreaterThan(20);
    expect(rc).toEqual(rd);
  });

  it('полость не выходит за план, кроме проёмов (до их плоскости)', () => {
    const s = straight(0, 0, 3, 5, 0, 0.05);
    const m = buildSnowMesh(s);
    for (let i = 0; i < m.positions.length / 3; i++) {
      const x = m.positions[i * 3], y = -m.positions[i * 3 + 2];
      expect(x).toBeGreaterThanOrEqual(s.x0 - 1e-9);
      expect(x).toBeLessThanOrEqual(s.x1 + 1e-9);
      expect(y).toBeGreaterThanOrEqual(s.y0 - 0.05 - 1e-9);
      expect(y).toBeLessThanOrEqual(s.y1 + 0.05 + 1e-9);
      // за линией стены — только в пролёте проёма (|x − 0.6| < 0.6)
      if (y < s.y0 || y > s.y1) expect(Math.abs(x - 0.6)).toBeLessThan(0.6);
    }
  });

  it('в лазе можно ползти: по оси воздух от пола до 0.8 м, горка поднимает пол', () => {
    const f = snowField(straight(0, 0, 4, 3)).f;
    for (const y of [0.2, 1, 2, 3, 3.8]) {
      expect(f(0.6, y, 0.1)).toBeLessThan(0);
      expect(f(0.6, y, 0.75)).toBeLessThan(0);
      expect(f(0.6, y, 1.1)).toBeGreaterThan(0);
    }
    const hump = snowField(straight(0, 0, 4, 3, 0.25));
    expect(hump.f(0.6, 2, 0.1)).toBeGreaterThan(0); // посередине пол выше
    expect(hump.f(0.6, 2, 0.9)).toBeLessThan(0);
    expect(hump.floorAt(0.6, 2)).toBeCloseTo(0.25, 1);
  });

  it('глухой проём — лаз обрывается до стены; завал — пробка в проёме', () => {
    const s = straight(0, 0, 3, 9);
    s.doors[1].state = 'closed';
    const f = snowField(s).f;
    expect(f(0.6, 2.9, 0.4)).toBeGreaterThan(0);
    expect(f(0.6, 1.5, 0.4)).toBeLessThan(0);
    const c = straight(0, 0, 3, 9);
    c.doors[1].state = 'collapsed';
    const g = snowField(c).f;
    expect(g(0.6, 2.95, 0.4)).toBeGreaterThan(0);
    expect(g(0.6, 1.0, 0.4)).toBeLessThan(0);
    // раскопан на ¾ — пробка меньше и ниже: сверху щель
    expect(g(0.6, 2.75, 0.75)).toBeGreaterThan(0);
    c.doors[1].dug = 0.75;
    const h = snowField(c).f;
    expect(h(0.6, 2.75, 0.75)).toBeLessThan(0);
  });

  it('поворот, развилка и берлога строятся быстро', () => {
    const turn: SnowPieceSpec = { x0: 0, y0: 0, x1: 2, y1: 2, floorY: 0, den: false, rise: 0, bench: false, seed: 1, doors: [door('s', 'S', 0.6, 2), door('e', 'E', 2, 0.6)] };
    const tee: SnowPieceSpec = { x0: 0, y0: 0, x1: 2.4, y1: 2.4, floorY: 0, den: false, rise: 0, bench: false, seed: 2, doors: [door('s', 'S', 1.2, 2.4), door('n', 'N', 1.2, 0), door('w', 'W', 0, 1.2)] };
    const den: SnowPieceSpec = { x0: 0, y0: 0, x1: 3, y1: 3, floorY: 0, den: true, rise: 0, bench: true, seed: 3, doors: [door('s', 'S', 1.5, 3), door('w', 'W', 0, 1.5), door('e', 'E', 3, 1.5)] };
    for (const s of [turn, tee, den]) {
      const t0 = performance.now();
      const m = buildSnowMesh(s);
      const ms = performance.now() - t0;
      expect(m.indices.length).toBeGreaterThan(300);
      // замер — в snowMesh.perf.test.ts; здесь — только «не зависло» (тесты идут параллельно)
      expect(ms).toBeLessThan(3000);
      console.log(`кусок ${s.x1}×${s.y1}${s.den ? ' берлога' : ''}: ${m.positions.length / 3} вершин, ${m.indices.length / 3} треуг., ${ms.toFixed(0)} мс`);
    }
    // в берлоге стоишь скрючившись: 1.2 м над полом посередине — воздух
    expect(snowField(den).f(1.5, 1.5, 1.2)).toBeLessThan(0);
  });
});
