// Погреб: протискивание боком (./cellarSqueeze.ts) — тело-эллипс по взгляду, влезает ли поворот в ход / щель, предел
// поворота в щели, «боком» с гистерезисом, щель впереди, приставной шаг, осыпи, пыль обвала, фильтр комнат обвала.
import { describe, expect, it } from 'vitest';
import {
  BODY, CELLAR_COLLAPSE, FIT_GAP, SHUFFLE_CYCLE, bodyExtents, cellarCollapseRoom, clampYaw, clearance, crossWidth, crumbDelay, dustFog, stepOk,
  dustLevel, facingAxis, fitAt, isSlitTags, newShuffle, slitAhead, squeezeRule, squeezing, stepShuffle, widthOf, wrapAngle,
  type Free,
} from './cellarSqueeze';
import { collapseSite, DEFAULT_COLLAPSE, type CollapseRun } from './snowCollapse';

/** Ход вдоль X шириной w (стены по z = ±w/2), середина тела смещена на dz; концы хода далеко. */
function slit(w: number, dz = 0, ends = 1.2): Free {
  const offs = [-0.92, -0.5, 0, 0.5, 0.92];
  return {
    x: offs.map((k) => ({ off: k * 0.2, pos: ends, neg: ends })),
    z: offs.map((k) => ({ off: k * 0.2, pos: w / 2 - dz, neg: w / 2 + dz })),
  };
}

const DEG = Math.PI / 180;

describe('тело-эллипс по взгляду', () => {
  it('лицом к +Z (ψ = 0): плечи вдоль X, грудь вдоль Z; лицом вдоль X — наоборот; 45° — поровну', () => {
    const a = bodyExtents(BODY.a, BODY.b, 0);
    expect(a.x).toBeCloseTo(0.23, 9);
    expect(a.z).toBeCloseTo(0.13, 9);
    const b = bodyExtents(BODY.a, BODY.b, Math.PI / 2);
    expect(b.x).toBeCloseTo(0.13, 9);
    expect(b.z).toBeCloseTo(0.23, 9);
    const c = bodyExtents(BODY.a, BODY.b, Math.PI / 4);
    expect(c.x).toBeCloseTo(c.z, 9);
    expect(c.x).toBeCloseTo(Math.sqrt((0.23 ** 2 + 0.13 ** 2) / 2), 9);
    // симметрия по знаку и по π
    for (const y of [0.3, 1.1, 2.5]) {
      expect(bodyExtents(0.23, 0.13, -y).x).toBeCloseTo(bodyExtents(0.23, 0.13, y).x, 9);
      expect(bodyExtents(0.23, 0.13, y + Math.PI).z).toBeCloseTo(bodyExtents(0.23, 0.13, y).z, 9);
    }
  });
});

describe('влезает ли поворот', () => {
  it('ход 0.6 м — любой поворот', () => {
    for (let d = 0; d < 360; d += 7.5) expect(fitAt(BODY, d * DEG, slit(0.6)).ok).toBe(true);
  });

  it('щель 0.4 м: лицом к стене — да, лицом вдоль щели — нет; предел ~50° от «лицом к стене»', () => {
    const f = slit(0.4);
    expect(fitAt(BODY, 0, f).ok).toBe(true);
    expect(fitAt(BODY, Math.PI, f).ok).toBe(true);
    expect(fitAt(BODY, Math.PI / 2, f).ok).toBe(false);
    expect(fitAt(BODY, -Math.PI / 2, f).ok).toBe(false);
    // граница: z-полуразмер = 0.2 − зазор
    let lim = 0;
    for (let d = 0; d <= 90; d += 0.25) if (fitAt(BODY, d * DEG, f).ok) lim = d;
    expect(lim).toBeGreaterThan(48);
    expect(lim).toBeLessThan(53);
    const e = bodyExtents(BODY.a, BODY.b, lim * DEG);
    expect(e.z).toBeLessThanOrEqual(0.2 - FIT_GAP + 1e-9);
  });

  it('прижат к стене: поворот сдвигает середину к середине щели (не дальше стен)', () => {
    // лицом к стене +Z, грудь у стены: до неё 0.131 (b = 0.13), сзади 0.269
    const f = slit(0.4, 0.069);
    const r = fitAt(BODY, 30 * DEG, f);
    expect(r.ok).toBe(true);
    expect(r.dz).toBeLessThan(0);
    const e = bodyExtents(BODY.a, BODY.b, 30 * DEG);
    // после сдвига: до стены впереди ≥ полуразмер + зазор, сзади тоже
    expect(0.131 - r.dz).toBeGreaterThanOrEqual(e.z + FIT_GAP - 1e-9);
    expect(0.269 + r.dz).toBeGreaterThanOrEqual(e.z + FIT_GAP - 1e-9);
    expect(r.dx).toBe(0);
  });

  it('щель уже груди — не влезает ни в каком повороте', () => {
    for (let d = 0; d < 360; d += 15) expect(fitAt(BODY, d * DEG, slit(0.25)).ok).toBe(false);
  });

  it('торец щели близко: лицом вдоль — не влезает и по X', () => {
    const f = slit(0.6, 0, 0.15);
    expect(fitAt(BODY, 0, f).ok).toBe(false); // плечи вдоль X (0.23) длиннее 0.15
    expect(fitAt(BODY, Math.PI / 2, f).ok).toBe(true); // грудь вдоль X (0.13) — влезает
  });
});

describe('ход: тело влезает на месте (clearance)', () => {
  it('щель 0.4: лицом к стене запас 0.07, лицом вдоль — минус 0.03 (не пускать); не хуже, чем было, — можно', () => {
    expect(clearance(BODY, 0, slit(0.4))).toBeCloseTo(0.07, 9);
    expect(clearance(BODY, Math.PI / 2, slit(0.4))).toBeCloseTo(-0.03, 9);
    // прижат к стене — запас по той стороне
    expect(clearance(BODY, 0, slit(0.4, 0.05))).toBeCloseTo(0.02, 9);
    expect(stepOk(0.01, 0.07)).toBe(true);
    expect(stepOk(-0.003, 0.07)).toBe(true); // допуск коллизий
    expect(stepOk(-0.03, 0.07)).toBe(false);
    expect(stepOk(-0.03, -0.05)).toBe(true); // и так не влезал — лучше можно
    expect(stepOk(-0.06, -0.05)).toBe(false);
  });
});

describe('поворот в тесноте (clampYaw)', () => {
  it('в щели поворот к «лицом вдоль» останавливается у предела, назад — свободно', () => {
    const f = slit(0.4);
    const y = clampYaw(BODY, 0, Math.PI / 2, f);
    expect(y).toBeGreaterThan(48 * DEG);
    expect(y).toBeLessThan(55 * DEG);
    expect(fitAt(BODY, y, f).ok).toBe(true);
    expect(clampYaw(BODY, y, 0.2, f)).toBe(0.2);
    // через ±π — по короткой дуге
    const z = clampYaw(BODY, Math.PI, Math.PI - Math.PI / 2, f);
    expect(Math.abs(wrapAngle(z - Math.PI))).toBeGreaterThan(48 * DEG);
    expect(Math.abs(wrapAngle(z - Math.PI))).toBeLessThan(55 * DEG);
  });

  it('рывок мышью через «лицом вдоль» к другой стене — не проскакивает (дуга проверяется целиком)', () => {
    const f = slit(0.4);
    const y = clampYaw(BODY, 40 * DEG, 140 * DEG, f);
    expect(y).toBeGreaterThan(45 * DEG);
    expect(y).toBeLessThan(53 * DEG);
    expect(clampYaw(BODY, -10 * DEG, 10 * DEG, f)).toBe(10 * DEG);
  });

  it('влезает — как хотел; не влезал и не лучше — стоит; лучше — можно', () => {
    expect(clampYaw(BODY, 0, 0.4, slit(0.4))).toBe(0.4);
    // не влезал (лицом вдоль щели 0.4): ещё дальше от стены — нельзя, к стене — можно
    const f = slit(0.4);
    expect(clampYaw(BODY, 80 * DEG, 89 * DEG, f)).toBe(80 * DEG);
    expect(clampYaw(BODY, 80 * DEG, 70 * DEG, f)).toBe(70 * DEG);
  });

  it('ход 0.6: ничего не ограничивает', () => {
    expect(clampYaw(BODY, 0, 3, slit(0.6))).toBe(3);
  });
});

describe('боком, щель впереди, шаг', () => {
  it('ширина поперёк хода и гистерезис «боком»', () => {
    const f = slit(0.4);
    expect(widthOf(f.z)).toBeCloseTo(0.4, 9);
    expect(crossWidth(f, 0.01, 0)).toBeCloseTo(0.4, 9);
    expect(crossWidth(f, 0, 0.01)).toBeCloseTo(2.4, 9);
    expect(crossWidth(f, 0, 0)).toBeNull();
    expect(squeezing(0.4, false)).toBe(true);
    expect(squeezing(0.6, true)).toBe(false);
    expect(squeezing(0.52, true)).toBe(true); // между порогами — как было
    expect(squeezing(0.52, false)).toBe(false);
    expect(squeezing(null, true)).toBe(true);
  });

  it('щель впереди: грудью не пролезть, боком — да', () => {
    expect(slitAhead(0.4)).toBe(true);
    expect(slitAhead(0.6)).toBe(false);
    expect(slitAhead(0.22)).toBe(false);
  });

  it('ось взгляда: ближайшая ось мира, наискось (~45°) — нет', () => {
    expect(facingAxis(0, 1)).toEqual({ axis: 'z', sign: 1 });
    expect(facingAxis(-1, 0.1)).toEqual({ axis: 'x', sign: -1 });
    expect(facingAxis(0.7, 0.7)).toBeNull();
  });

  it('приставной шаг: два шага на цикл SHUFFLE_CYCLE, сторона хода', () => {
    const s = newShuffle();
    let steps = 0;
    for (let i = 0; i < 101; i++) if (stepShuffle(s, SHUFFLE_CYCLE / 50).step) steps++;
    expect(steps).toBe(4);
    expect(s.dir).toBe(1);
    stepShuffle(s, -0.01);
    expect(s.dir).toBe(-1);
    // перенос (телепорт) — не шаг
    const ph = s.phase;
    expect(stepShuffle(s, 0.8).step).toBe(false);
    expect(s.phase).toBe(ph);
  });
});

describe('осыпи и пыль обвала', () => {
  it('пауза осыпей 6…20 с, в щели — чаще', () => {
    expect(crumbDelay(0, false)).toBe(6);
    expect(crumbDelay(1, false)).toBe(20);
    expect(crumbDelay(0.5, true)).toBeLessThan(crumbDelay(0.5, false));
  });

  it('пыль: сжимается быстро, держится, оседает за ~8 с', () => {
    expect(dustLevel(0)).toBe(0);
    expect(dustLevel(1)).toBeCloseTo(1, 6);
    expect(dustLevel(3)).toBeCloseTo(1, 6);
    expect(dustLevel(6)).toBeGreaterThan(0.2);
    expect(dustLevel(6)).toBeLessThan(0.9);
    expect(dustLevel(9)).toBe(0);
    expect(dustLevel(Infinity)).toBe(0);
    const base = { start: 0.6, end: 4.5 };
    expect(dustFog(base, 0)).toEqual(base);
    expect(dustFog(base, 1)).toEqual({ start: 0.3, end: 1.5 });
  });
});

describe('обвалы в погребе', () => {
  it('числа: как в снегу, метров между обвалами 50…120; правило для игрока', () => {
    expect(CELLAR_COLLAPSE.everyM).toEqual([50, 120]);
    expect(CELLAR_COLLAPSE.warnS).toBe(DEFAULT_COLLAPSE.warnS);
    expect(squeezeRule()).toMatch(/боком/);
  });

  it('комнаты обвала — ходы погреба (не камеры, не клетушки); щель — кусок хода', () => {
    expect(cellarCollapseRoom(['погреб', 'ход', 'только-биом'])).toBe(true);
    expect(cellarCollapseRoom(['погреб', 'ход', 'щель', 'только-биом'])).toBe(true);
    expect(cellarCollapseRoom(['погреб', 'хаб', 'только-биом'])).toBe(false);
    expect(cellarCollapseRoom(['погреб', 'клетушка'])).toBe(false);
    expect(cellarCollapseRoom(['снег', 'ход'])).toBe(false);
    expect(isSlitTags(['погреб', 'ход', 'щель'])).toBe(true);
  });

  it('collapseSite с фильтром погреба: место — проём хода; по умолчанию (снег) ход погреба — нет', () => {
    const conn = (id: string, line: [number, number, number, number], to: string | null, cut = false) => ({
      id, side: 'N' as const, len: 6, line, linkedTo: to ? { inst: to, connector: 'x' } : null, cut,
    });
    const run: CollapseRun = {
      cellM: 0.1,
      instances: [
        { id: 'a', roomTags: ['погреб', 'хаб'], connectors: [conn('n', [0, 0, 6, 0], 'b')] },
        { id: 'b', roomTags: ['погреб', 'ход'], connectors: [conn('x', [0, 0, 6, 0], 'a'), conn('s', [0, 30, 6, 30], 'c')] },
        { id: 'c', roomTags: ['погреб', 'ход'], connectors: [conn('x', [0, 30, 6, 30], 'b'), conn('far', [0, 60, 6, 60], null, true)] },
      ],
    };
    expect(collapseSite(run, 'b', 0.3, 2.6)).toBeNull();
    const s = collapseSite(run, 'b', 0.3, 2.6, cellarCollapseRoom);
    // ближе к игроку — южный проём (y = 3 м), но его завал запер бы игрока (нераскрытое — только за ним) → северный
    expect(s?.connector).toBe('x');
    expect(s?.inst).toBe('b');
    expect(collapseSite(run, 'a', 0.3, 0.1, cellarCollapseRoom)).toBeNull();
  });
});
