import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '../data/presets';
import { DEFAULT_FOLD, generateFoldRun } from './fold';

// Замеры скорости — отдельным файлом: свой воркер, чистая куча и JIT, без влияния тяжёлых проверок.
describe('складчатый генератор: скорость', { timeout: 120000 }, () => {
  const p = createDefaultProject();
  const avg = (a: number[]) => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1);

  it('count 150 без бесшовности — быстрее 300 мс: без предела обзора и при 9/7/6 м', () => {
    const fold = { ...DEFAULT_FOLD, seamless: false };
    generateFoldRun(p, { seed: 'warm', count: 150, sightM: 0, fold }); // прогрев JIT и кэша геометрии
    generateFoldRun(p, { seed: 'warm', count: 150, sightM: 7, fold });
    for (const sightM of [0, 9, 7, 6]) {
      const times: number[] = [];
      for (let i = 1; i <= 10; i++) times.push(generateFoldRun(p, { seed: `hrush-${i}`, count: 150, fill: false, sightM, fold }).ms);
      console.log(`[fold perf] seamless=off sightM=${sightM} count=150: среднее ${avg(times)} мс, максимум ${Math.max(...times).toFixed(1)} мс`);
      expect(Math.max(...times)).toBeLessThan(300);
    }
  });

  it('с бесшовностью (PVS): count 60–150 при 9/7 м — быстрее 500 мс', () => {
    generateFoldRun(p, { seed: 'warm', count: 150, sightM: 9 });
    for (const sightM of [9, 7]) {
      for (const count of [60, 150]) {
        const times: number[] = [];
        for (let i = 1; i <= 10; i++) times.push(generateFoldRun(p, { seed: `hrush-${i}`, count, fill: false, sightM }).ms);
        console.log(`[fold perf] seamless=on sightM=${sightM} count=${count}: среднее ${avg(times)} мс, максимум ${Math.max(...times).toFixed(1)} мс`);
        expect(Math.max(...times)).toBeLessThan(500);
      }
    }
  });
});
