import { describe, expect, it } from 'vitest';
import { DEFAULT_WET, WET_EDGES, WET_START, WET_TAGS, isSwamp, normWet, piecesToSwamp, wetLevel, wetNext, wetRule, wetTag } from './wet';

describe('влажность сети ходов (завод)', () => {
  it('ступени: сухо, сыро, течь, топь по границам', () => {
    expect(WET_TAGS).toEqual(['сухо', 'сыро', 'течь', 'топь']);
    expect(wetLevel(0)).toBe(0);
    expect(wetLevel(WET_EDGES[0] - 1e-6)).toBe(0);
    expect(wetLevel(WET_EDGES[0])).toBe(1);
    expect(wetLevel(0.5)).toBe(2);
    expect(wetLevel(0.99)).toBe(3);
    expect(wetTag(0.75)).toBe('топь');
  });

  it('линия держит направление, развилка: мокрый выход +fork, сухие −dry; обрезка в [0, 1]', () => {
    const s = DEFAULT_WET;
    expect(wetNext({ w: 0.5, dir: 1 }, null, s)).toEqual({ w: 0.5 + s.line, dir: 1 });
    expect(wetNext({ w: 0.5, dir: -1 }, null, s).w).toBeCloseTo(0.5 - s.line);
    expect(wetNext({ w: 0.5, dir: -1 }, true, s)).toEqual({ w: 0.5 + s.fork, dir: 1 });
    expect(wetNext({ w: 0.5, dir: 1 }, false, s)).toEqual({ w: 0.5 - s.dry, dir: -1 });
    expect(wetNext({ w: 0.01, dir: -1 }, false, s).w).toBe(0);
    expect(wetNext({ w: 0.98, dir: 1 }, true, s).w).toBe(1);
    expect(isSwamp(wetNext({ w: 0.98, dir: 1 }, true, s))).toBe(true);
  });

  it('на любой развилке мокрый выход — на ступень мокрее сухого (видно сразу)', () => {
    for (let w = 0; w < 1; w += 0.005) {
      const wet = wetNext({ w, dir: 1 }, true, DEFAULT_WET), dry = wetNext({ w, dir: 1 }, false, DEFAULT_WET);
      if (isSwamp(wet)) continue;
      expect(wetLevel(wet.w)).toBeGreaterThan(wetLevel(dry.w));
    }
  });

  it('по мокрому пути болото — за конечное число кусков (развилка через 3 куска — меньше 20)', () => {
    const n = piecesToSwamp(DEFAULT_WET, 3);
    expect(n).toBeGreaterThan(5);
    expect(n).toBeLessThan(20);
    // сухой путь не мокреет
    let w = WET_START;
    for (let k = 0; k < 50; k++) w = wetNext(w, k % 3 === 0 ? false : null, DEFAULT_WET);
    expect(w.w).toBe(0);
  });

  it('разбор настроек и правило', () => {
    expect(normWet(null)).toBeNull();
    expect(normWet({})).toEqual(DEFAULT_WET);
    expect(normWet({ line: 5, fork: -1, dry: 'x' })).toEqual({ line: 1, fork: 0, dry: DEFAULT_WET.dry });
    expect(wetRule(DEFAULT_WET)).toMatch(/влажнее/);
  });
});
