import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { babylonMotion, phaseOf, poseNumbers } from './propAnim';

const close = (a: number[], b: number[], eps = 1e-4) => a.every((v, i) => Math.abs(v - b[i]) < eps);

describe('подвижные части моделей: движение из extras.anim', () => {
  it('мусор — null', () => {
    expect(babylonMotion(null)).toBeNull();
    expect(babylonMotion({ period: 0, spin: [0, 0, 1], pivot: [0, 0, 0], turns: 1 })).toBeNull();
    expect(babylonMotion({ period: 4, n: 2, p: [0, 0, 0], q: [0, 0, 0, 1] })).toBeNull();
  });

  it('вращение: точка на оси стоит, полный оборот за period / turns, ось отражена по x', () => {
    const m = babylonMotion({ spin: [0, 0, 1], pivot: [0.5, 1, 0], turns: 2, period: 4 })!;
    expect(m.kind).toBe('spin');
    if (m.kind !== 'spin') return;
    expect(m.pivot.asArray()).toEqual([-0.5, 1, 0]);
    const at = (t: number, x: Vector3) => {
      const { p, q } = poseNumbers(m, t);
      const r = x.rotateByQuaternionToRef(Quaternion.FromArray(q), new Vector3());
      return r.add(Vector3.FromArray(p)).asArray();
    };
    // ось через pivot не движется
    expect(close(at(0.7, m.pivot), m.pivot.asArray())).toBe(true);
    // за полпериода (= оборот при turns 2) точка вернулась
    const x = new Vector3(0.2, 1.3, 0);
    expect(close(at(2, x), x.asArray())).toBe(true);
    expect(close(at(0.5, x), x.asArray())).toBe(false);
  });

  it('выборки: по кругу, линейно между соседними, масштаб — если есть', () => {
    const m = babylonMotion({ period: 4, n: 2, p: [0, 0, 0, 1, 2, 3], q: [0, 0, 0, 1, 0, 0, 0, 1], s: [1, 1, 1, 1, 3, 1] })!;
    expect(m.kind).toBe('keys');
    // x отражён: p₁ = (−1, 2, 3)
    expect(close(poseNumbers(m, 2).p, [-1, 2, 3])).toBe(true);
    expect(close(poseNumbers(m, 1).p, [-0.5, 1, 1.5])).toBe(true);
    expect(close(poseNumbers(m, 4).p, [0, 0, 0])).toBe(true);
    expect(close(poseNumbers(m, 3).p, [-0.5, 1, 1.5])).toBe(true);
    expect(close(poseNumbers(m, 2).s, [1, 3, 1])).toBe(true);
  });

  it('фаза по имени предмета: одна на предмет, разная у разных', () => {
    expect(phaseOf('propModel:a:p_fac_gear_pair', 4)).toBe(phaseOf('propModel:a:p_fac_gear_pair', 4));
    expect(phaseOf('propModel:a:p_fac_gear_pair', 4)).not.toBe(phaseOf('propModel:b:p_fac_gear_pair', 4));
    const ph = phaseOf('x', 4);
    expect(ph).toBeGreaterThanOrEqual(0);
    expect(ph).toBeLessThan(4);
  });
});
