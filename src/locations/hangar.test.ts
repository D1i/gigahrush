import { describe, expect, it } from 'vitest';
import {
  createThaw, fallPose, hangarBossSign, hangarRule, normHangar, rollHangar, strikeThaw, DEFAULT_HANGAR,
  FALL_LAND_S, FALL_LIE_EYE, FALL_ROOF_M, FALL_SNOW_M, FALL_TOTAL_S,
} from './hangar';

describe('ангар: подтаявший снег и падение', () => {
  it('розыгрыш — по ключу, в диапазонах', () => {
    const a = rollHangar(DEFAULT_HANGAR, 'k1');
    expect(rollHangar(DEFAULT_HANGAR, 'k1')).toEqual(a);
    for (let k = 0; k < 50; k++) {
      const r = rollHangar(DEFAULT_HANGAR, 'k' + k);
      expect(r.hits).toBeGreaterThanOrEqual(3);
      expect(r.hits).toBeLessThanOrEqual(5);
      expect(r.floorsDown).toBeGreaterThanOrEqual(2);
      expect(r.floorsDown).toBeLessThanOrEqual(3);
    }
  });

  it('пятно проваливается ровно на roll.hits-м ударе', () => {
    const roll = rollHangar(DEFAULT_HANGAR, 'x');
    const s = createThaw(roll);
    for (let k = 1; k < roll.hits; k++) {
      const ev = strikeThaw(s);
      expect(ev).toEqual([{ type: 'strike', hits: k, need: roll.hits, stage: k / roll.hits }]);
    }
    expect(strikeThaw(s).map((e) => e.type)).toEqual(['strike', 'break']);
    expect(strikeThaw(s)).toEqual([]);
  });

  it('падение: пелена, полёт с крыши, удар, лежит, встаёт', () => {
    expect(fallPose(0.1).phase).toBe('break');
    expect(fallPose(0.1).white).toBeGreaterThan(0);
    const mid = fallPose((FALL_LAND_S + 0.3) / 2 + 0.15);
    expect(mid.phase).toBe('fall');
    expect(mid.pitch).toBeLessThan(-0.9); // смотрит вниз, на кучу
    expect(fallPose(0).y).toBeCloseTo(FALL_SNOW_M + FALL_ROOF_M + FALL_LIE_EYE);
    expect(fallPose(FALL_LAND_S - 1e-4).y).toBeCloseTo(FALL_LIE_EYE, 1);
    expect(fallPose(FALL_LAND_S + 0.05).shake).toBeGreaterThan(0.8);
    expect(fallPose(FALL_LAND_S + 0.5).y).toBeLessThan(0.5);
    const end = fallPose(FALL_TOTAL_S + 0.1);
    expect(end.phase).toBe('done');
    expect(end.y).toBeCloseTo(1.6);
    // глаз опускается без скачков (за 10 мс — не больше скорости падения)
    let prev = fallPose(0);
    for (let t = 0.01; t < FALL_TOTAL_S + 0.2; t += 0.01) {
      const p = fallPose(t);
      expect(Math.abs(p.y - prev.y)).toBeLessThan(0.16);
      expect(Math.abs(p.pitch - prev.pitch)).toBeLessThan(0.12);
      prev = p;
    }
  });

  it('разбор, табличка, правило', () => {
    expect(normHangar({ kind: 'lift' })).toBeNull();
    expect(normHangar({ kind: 'hangar', hits: [9, 2], darkness: 4 })).toMatchObject({ hits: [2, 9], darkness: 1, floorsDown: [2, 3] });
    expect(hangarBossSign(DEFAULT_HANGAR)).toBe('Здесь будет мини-босс');
    expect(hangarRule()).toContain('3–5');
  });
});
