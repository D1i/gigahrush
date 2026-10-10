// Эффекты игрока: еда (лечение, стамина, баффы), пузырь (×2, меченый, пьян; второй подряд — падение 15 с с охами),
// юзграм (обморок + неуязвимость), шум, шаг таймеров (dt зажат). Модель неизменяемая.
import { describe, expect, it } from 'vitest';
import {
  addNoise, applyFood, BUBBLE_BAD_LUCK, FX_MAX_DT, fxView, newFx, PRESERVES_SPEED, speedMul, stepFx, type Fx,
} from './effects';

/** прогнать таймеры s секунд шагами по 0.25 с */
function run(fx: Fx, s: number): Fx {
  for (let t = 0; t < s - 1e-9; t += 0.25) fx = stepFx(fx, Math.min(0.25, s - t));
  return fx;
}
const eat = (fx: Fx, id: string) => applyFood(fx, id)!;

describe('effects', () => {
  it('новое состояние: без баффов, ×1, не лежит, тихо', () => {
    expect(fxView(newFx())).toEqual({
      speedMul: 1, invuln: false, marked: false, drunk: false, down: false, noise: 0, collapseMul: 1, badLuck: 1,
    });
    expect(fxView(newFx(), 2).collapseMul).toBe(2);
  });

  it('не еда — null; хлеб — +35 HP и стамина, без баффов', () => {
    expect(applyFood(newFx(), 'it_kopeyki')).toBeNull();
    const r = eat(newFx(), 'it_bread');
    expect(r.heal).toBe(35);
    expect(r.staminaFull).toBe(true);
    expect(fxView(r.fx).speedMul).toBe(1);
  });

  it('закрутка: +50 HP, стамина, ×1.3 ровно 120 с', () => {
    const fx0 = newFx();
    const r = eat(fx0, 'it_preserves');
    expect(r).toMatchObject({ heal: 50, staminaFull: true });
    expect(fx0.speedT).toBe(0);
    expect(speedMul(r.fx)).toBeCloseTo(PRESERVES_SPEED);
    expect(speedMul(run(r.fx, 119.5))).toBeCloseTo(1.3);
    expect(speedMul(run(r.fx, 120.25))).toBe(1);
  });

  it('пузырь: +40 HP, стамина, ×2 / меченый / пьян / невезение 60 с; с закруткой — произведение', () => {
    const r = eat(newFx(), 'it_bubble');
    expect(r).toMatchObject({ heal: 40, staminaFull: true });
    const v = fxView(r.fx);
    expect(v).toMatchObject({ speedMul: 2, marked: true, drunk: true, down: false, badLuck: BUBBLE_BAD_LUCK });
    expect(speedMul(eat(r.fx, 'it_preserves').fx)).toBeCloseTo(2.6);
    expect(fxView(run(r.fx, 59.5))).toMatchObject({ speedMul: 2, marked: true });
    expect(fxView(run(r.fx, 60.25))).toMatchObject({ speedMul: 1, marked: false, drunk: false, badLuck: 1 });
  });

  it('второй пузырь, пока пьян: падение 15 с — лежит, охает (шум 1), меченый; бафф не продлён; потом встаёт', () => {
    const one = run(eat(newFx(), 'it_bubble').fx, 10);
    const two = eat(one, 'it_bubble');
    expect(two.heal).toBe(40);
    expect(two.fx.bubbleT).toBeCloseTo(50);
    let fx = two.fx;
    expect(fxView(fx)).toMatchObject({ down: true, speedMul: 0, noise: 1, marked: true, drunk: true, invuln: false });
    fx = run(fx, 14.5);
    expect(fxView(fx)).toMatchObject({ down: true, noise: 1 });
    fx = run(fx, 0.75);
    expect(fxView(fx)).toMatchObject({ down: false, speedMul: 2, marked: true });
    // шум гаснет ~1/с
    expect(fxView(run(fx, 1.25)).noise).toBe(0);
    // пузырь выветрился — следующий снова бафф
    const sober = run(fx, 40);
    expect(fxView(sober).drunk).toBe(false);
    expect(fxView(eat(sober, 'it_bubble').fx)).toMatchObject({ down: false, speedMul: 2 });
  });

  it('юзграм: обморок 10 с — лежит и неуязвим, без лечения', () => {
    const r = eat(newFx(), 'it_yuzgram');
    expect(r).toMatchObject({ heal: 0, staminaFull: false });
    expect(fxView(r.fx)).toMatchObject({ down: true, invuln: true, speedMul: 0, marked: false });
    expect(fxView(run(r.fx, 9.75))).toMatchObject({ down: true, invuln: true });
    expect(fxView(run(r.fx, 10.25))).toMatchObject({ down: false, invuln: false, speedMul: 1 });
  });

  it('шум: копится до 1, гаснет ~1/с; мусор — без изменений', () => {
    const fx0 = newFx();
    const a = addNoise(fx0, 0.8);
    expect(a.noise).toBeCloseTo(0.8);
    expect(fx0.noise).toBe(0);
    expect(addNoise(a, 0.8).noise).toBe(1);
    expect(addNoise(a, -1)).toBe(a);
    expect(addNoise(a, NaN)).toBe(a);
    expect(run(a, 0.5).noise).toBeCloseTo(0.3);
    expect(run(a, 1).noise).toBe(0);
  });

  it('stepFx: dt зажат (вкладка спала — эффект не сгорает), NaN — 0', () => {
    const r = eat(newFx(), 'it_preserves').fx;
    expect(stepFx(r, 1000).speedT).toBeCloseTo(120 - FX_MAX_DT);
    expect(stepFx(r, NaN).speedT).toBe(120);
    expect(stepFx(r, -5).speedT).toBe(120);
  });
});
