import { describe, expect, it } from 'vitest';
import { makeRng } from '../model/rng';
import { contentProject } from './fixtures.test-util';
import { stepsStats, stepsText, tierRuleLines } from './rules';

describe('rules', () => {
  it('stepsText: от большего «до N» к меньшему', () => {
    expect(stepsText([{ upTo: 25, chance: 0.5 }, { upTo: 30, chance: 0.7 }])).toBe('до 30 — 70%, иначе до 25 — 50%');
    expect(stepsText([{ upTo: 1, chance: 0.05 }])).toBe('5%');
    expect(stepsText([{ upTo: 3, chance: 0.025 }])).toBe('до 3 — 2.5%');
    expect(stepsText([{ upTo: 10, chance: 1 }, { upTo: 5, chance: 0.5 }])).toBe('до 10 — 100%'); // дальше недостижимо
    expect(stepsText([])).toBe('не выпадает');
    expect(stepsText([{ upTo: 4, chance: 0.2 }, { upTo: 1, chance: 0.3 }])).toBe('до 4 — 20%, иначе 1 шт. — 30%');
  });

  it('stepsStats: точные P и матожидание', () => {
    const s = stepsStats([{ upTo: 25, chance: 0.5 }, { upTo: 30, chance: 0.7 }]);
    expect(s.pAny).toBeCloseTo(0.85, 12);
    expect(s.mean).toBeCloseTo(0.7 * 15.5 + 0.3 * 0.5 * 13, 12);
    expect(stepsStats([])).toEqual({ pAny: 0, mean: 0 });
    expect(stepsStats([{ upTo: 6, chance: 2 }])).toEqual({ pAny: 1, mean: 3.5 });
  });

  it('stepsStats совпадает с симуляцией правила «первая сработавшая сверху, count = int(1, upTo)»', () => {
    const steps = [{ upTo: 2, chance: 0.6 }, { upTo: 12, chance: 0.25 }, { upTo: 7, chance: 0.4 }];
    const order = [...steps].sort((a, b) => b.upTo - a.upTo);
    const rng = makeRng('sim');
    const N = 200000;
    let any = 0, sum = 0;
    for (let i = 0; i < N; i++) {
      for (const s of order) if (rng.chance(s.chance)) { any++; sum += rng.int(1, s.upTo); break; }
    }
    const st = stepsStats(steps);
    expect(Math.abs(any / N - st.pAny)).toBeLessThan(0.005);
    expect(Math.abs(sum / N - st.mean)).toBeLessThan(0.03);
  });

  it('tierRuleLines: понятные игроку строки', () => {
    const p = contentProject();
    expect(tierRuleLines(p, p.economy.tiers[1])).toEqual([
      'Проход: опасность +50',
      'Копейки: до 30 — 40%, иначе до 5 — 30% (в среднем 6.7)',
      'Самогонка в «сервант»: 50%',
      'Готовый предмет из «Магазин электрика» в «шкаф-инструменты»: 50%',
      'Самогонка в «холодильник»: 100%',
    ]);
    expect(tierRuleLines(p, { ...p.economy.tiers[0], danger: 0 })).toEqual(['Проход: опасность не растёт']);
  });
});
