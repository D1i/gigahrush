import { describe, expect, it } from 'vitest';
import src from './stamina.ts?raw';
import { newStamina, stepStamina, STAMINA, STAMINA_MAX_DT, type Stamina, type StaminaInput } from './stamina';

const RUN: StaminaInput = { want: true, moving: true, canRun: true };
const WALK: StaminaInput = { want: false, moving: true, canRun: true };
const IDLE: StaminaInput = { want: false, moving: false, canRun: true };

/** t секунд шагами по 1/60. */
function run(s: Stamina, t: number, input: StaminaInput): Stamina {
  for (let i = 0, n = Math.round(t * 60); i < n; i++) s = stepStamina(s, 1 / 60, input);
  return s;
}

describe('выносливость (бег Shift)', () => {
  it('модуль без движка и DOM', () => {
    const imports = [...src.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
    expect(imports).toEqual([]);
    expect(src).not.toMatch(/@babylonjs|document\.|window\./);
  });

  it('новая — полная, не бежит, не выдохся', () => {
    expect(newStamina()).toMatchObject({ v: 1, sprinting: false, exhausted: false });
  });

  it('бег — только если хочет, идёт и может; шкала тает только на бегу', () => {
    const s = newStamina();
    expect(stepStamina(s, 1 / 60, RUN).sprinting).toBe(true);
    expect(stepStamina(s, 1 / 60, { ...RUN, moving: false }).sprinting).toBe(false);
    expect(stepStamina(s, 1 / 60, { ...RUN, canRun: false }).sprinting).toBe(false);
    expect(stepStamina(s, 1 / 60, { ...RUN, want: false }).sprinting).toBe(false);
    expect(stepStamina(s, 1 / 60, { ...RUN, moving: false }).v).toBe(1);
    expect(stepStamina(s, 1 / 60, RUN).v).toBeLessThan(1);
  });

  it('полная шкала — ~7 с бега, потом «выдохся»', () => {
    let s = run(newStamina(), 6.5, RUN);
    expect(s.sprinting).toBe(true);
    expect(s.exhausted).toBe(false);
    expect(s.v).toBeGreaterThan(0);
    s = run(s, 0.6, RUN);
    expect(s.v).toBe(0);
    expect(s.exhausted).toBe(true);
    expect(stepStamina(s, 1 / 60, RUN).sprinting).toBe(false);
  });

  it('выдохся: Shift зажат — бега нет, пока шкала не наберёт recoverAt', () => {
    let s = run(newStamina(), 7.2, RUN);
    expect(s.exhausted).toBe(true);
    // держит Shift и идёт: шкала растёт (на ходу), но бега нет
    let ran = false;
    for (let i = 0; i < 60 * 30 && s.exhausted; i++) {
      s = stepStamina(s, 1 / 60, RUN);
      ran ||= s.sprinting;
    }
    expect(ran).toBe(false);
    expect(s.exhausted).toBe(false);
    expect(s.v).toBeGreaterThanOrEqual(STAMINA.recoverAt);
    expect(s.v).toBeLessThan(STAMINA.recoverAt + 0.01);
    // набрал — снова бежит, не отпуская Shift
    expect(stepStamina(s, 1 / 60, RUN).sprinting).toBe(true);
  });

  it('восстановление — после паузы delay; на месте быстрее, чем на ходу', () => {
    const half = run(newStamina(), 3.5, RUN);
    const v0 = half.v;
    // пауза: ничего не набирается
    expect(run(half, STAMINA.delay - 0.05, IDLE).v).toBeCloseTo(v0, 6);
    const idle = run(half, STAMINA.delay + 1, IDLE).v - v0;
    const walk = run(half, STAMINA.delay + 1, WALK).v - v0;
    expect(idle).toBeCloseTo(STAMINA.regenIdle, 2);
    expect(walk).toBeCloseTo(STAMINA.regen, 2);
    expect(idle).toBeGreaterThan(walk);
  });

  it('пауза считается с конца бега: короткий рывок сбрасывает её', () => {
    let s = run(newStamina(), 2, RUN);
    s = run(s, STAMINA.delay + 0.5, IDLE);
    const v1 = s.v;
    s = stepStamina(s, 1 / 60, RUN);
    expect(s.rest).toBe(0);
    s = run(s, STAMINA.delay - 0.1, IDLE);
    expect(s.v).toBeCloseTo(v1 - STAMINA.drain / 60, 6);
  });

  it('шкала не выше 1 и не ниже 0', () => {
    expect(run(newStamina(), 20, IDLE).v).toBe(1);
    // 30 с с зажатым Shift: выдохся → набрал → снова бежит…; шкала в пределах, ноль достигается
    let s = newStamina(), lo = 1, hi = 0, tired = 0;
    for (let i = 0; i < 60 * 30; i++) {
      s = stepStamina(s, 1 / 60, RUN);
      lo = Math.min(lo, s.v);
      hi = Math.max(hi, s.v);
      if (s.exhausted) tired++;
    }
    expect(lo).toBe(0);
    expect(hi).toBeLessThanOrEqual(1);
    expect(tired).toBeGreaterThan(0);
  });

  it('dt зажат: долгий кадр (вкладка скрыта) не опустошает шкалу разом', () => {
    const s = stepStamina(newStamina(), 30, RUN);
    expect(s.v).toBeCloseTo(1 - STAMINA.drain * STAMINA_MAX_DT, 6);
    expect(stepStamina(newStamina(), NaN, RUN).v).toBe(1);
    expect(stepStamina(newStamina(), -1, RUN).v).toBe(1);
  });

  it('свои настройки', () => {
    const cfg = { ...STAMINA, drain: 1 };
    let s = newStamina();
    for (let i = 0; i < 11; i++) s = stepStamina(s, 0.1, RUN, cfg);
    expect(s.exhausted).toBe(true);
  });

  it('не мутирует вход', () => {
    const s = newStamina();
    const copy = { ...s };
    stepStamina(s, 1 / 60, RUN);
    expect(s).toEqual(copy);
  });
});
