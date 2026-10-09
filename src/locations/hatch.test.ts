import { describe, expect, it } from 'vitest';
import {
  arriveHatch, createHatch, hatchCenter, hatchPrompt, hatchSize, hatchView, nearHatch, openHatch, stepHatch,
  HATCH_DOWN_S, HATCH_LID_S, HATCH_NEAR, HATCH_PROMPT, HATCH_REVEAL_S, HATCH_SIZE_M, type HatchEvent, type HatchState,
} from './hatch';

/** Прогнать сценарий шагами dt, пока не наберётся sec секунд; события — подряд. */
function run(s: HatchState, sec: number, dt = 1 / 60): HatchEvent[] {
  const out: HatchEvent[] = [];
  for (let t = 0; t < sec - 1e-9; t += dt) out.push(...stepHatch(s, dt));
  return out;
}

describe('люк в погреб', () => {
  it('середина и размер — по габаритам экземпляра', () => {
    expect(hatchCenter({ x0: 10, y0: 20, x1: 50, y1: 60 }, 0.1)).toEqual({ x: 3, y: 4 });
    expect(hatchSize({ x0: 0, y0: 0, x1: 40, y1: 60 }, 0.1)).toBe(HATCH_SIZE_M);
    // тесная комната — меньше, но не меньше 0.5 м
    expect(hatchSize({ x0: 0, y0: 0, x1: 12, y1: 60 }, 0.1)).toBeCloseTo(0.72);
    expect(hatchSize({ x0: 0, y0: 0, x1: 5, y1: 5 }, 0.1)).toBe(0.5);
  });

  it('подсказка — только рядом и в покое', () => {
    const s = createHatch();
    const c = { x: 3, y: 4 };
    expect(nearHatch(3 + HATCH_NEAR - 0.05, 4, c)).toBe(true);
    expect(nearHatch(3 + HATCH_NEAR + 0.05, 4, c)).toBe(false);
    expect(hatchPrompt(s, true)).toBe(HATCH_PROMPT);
    expect(hatchPrompt(s, false)).toBeNull();
    openHatch(s);
    expect(hatchPrompt(s, true)).toBeNull();
  });

  it('E → крышка → затемнение → descend → ждёт перехода → проявление', () => {
    const s = createHatch();
    expect(stepHatch(s, 1)).toEqual([]); // в покое ничего не идёт
    expect(openHatch(s)).toEqual([{ type: 'open' }]);
    expect(openHatch(s)).toEqual([]); // второй E не перезапускает
    expect(hatchView(s).frozen).toBe(true);
    const ev = run(s, HATCH_LID_S + HATCH_DOWN_S + 0.1);
    expect(ev.map((e) => e.type)).toEqual(['lid', 'descend']);
    expect(s.phase).toBe('wait');
    const v = hatchView(s);
    expect(v.black).toBe(1);
    expect(v.lid).toBe(1);
    // переход ещё не готов — темнота держится
    expect(run(s, 5)).toEqual([]);
    expect(hatchView(s).black).toBe(1);
    arriveHatch(s, true);
    expect(s.phase).toBe('reveal');
    expect(run(s, HATCH_REVEAL_S + 0.05).map((e) => e.type)).toEqual(['done']);
    expect(s.phase).toBe('idle');
    expect(hatchView(s)).toEqual({ lid: 0, black: 0, look: 0, frozen: false });
  });

  it('крышка и темнота растут монотонно, затемнение ~1.2 с', () => {
    const s = createHatch();
    openHatch(s);
    let lid = 0, black = 0;
    for (let k = 0; k < 200; k++) {
      if (stepHatch(s, 1 / 60).some((e) => e.type === 'descend')) break;
      const v = hatchView(s);
      expect(v.lid).toBeGreaterThanOrEqual(lid - 1e-9);
      expect(v.black).toBeGreaterThanOrEqual(black - 1e-9);
      lid = v.lid;
      black = v.black;
    }
    expect(HATCH_DOWN_S).toBeCloseTo(1.2);
    // в начале спуска ещё светло, в конце — почти темно
    const s2 = createHatch();
    openHatch(s2);
    run(s2, HATCH_LID_S + 0.05);
    expect(hatchView(s2).black).toBeLessThan(0.05);
    run(s2, HATCH_DOWN_S - 0.15);
    expect(hatchView(s2).black).toBeGreaterThan(0.9);
  });

  it('не вышло — проявление на месте, крышка закрывается', () => {
    const s = createHatch();
    openHatch(s);
    run(s, HATCH_LID_S + HATCH_DOWN_S + 0.1);
    arriveHatch(s, false);
    expect(s.failed).toBe(true);
    run(s, HATCH_REVEAL_S * 0.5);
    expect(hatchView(s).lid).toBeLessThan(1);
    run(s, HATCH_REVEAL_S);
    expect(s.phase).toBe('idle');
    // снова можно открыть
    expect(openHatch(s)).toEqual([{ type: 'open' }]);
    expect(s.failed).toBe(false);
  });

  it('arriveHatch вне ожидания — ничего', () => {
    const s = createHatch();
    arriveHatch(s, true);
    expect(s.phase).toBe('idle');
    openHatch(s);
    arriveHatch(s, true);
    expect(s.phase).toBe('open');
  });
});
