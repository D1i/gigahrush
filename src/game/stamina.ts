// Выносливость для бега (Shift) в «Прогулке» от первого лица — чистая логика, без движка и DOM (тесты — stamina.test.ts).
//  • бег: Shift зажат, игрок идёт (сдвиг есть) и может бежать (стоя, не заморожен), не выдохся и шкала не пуста;
//  • на бегу шкала тает (полная — за ~7 с); дошла до нуля — «выдохся»: бега нет, даже с зажатым Shift, пока шкала
//    не наберёт recoverAt;
//  • восстановление — через delay с после бега; стоя на месте — быстрее (regenIdle), на ходу — медленнее (regen);
//  • dt зажат: переключение вкладки / долгий кадр не опустошает и не заливает шкалу разом.
// Применение к камере, звук и HUD — src/view3d/sprint.ts.

export interface StaminaCfg {
  /** расход на бегу, доля шкалы в секунду */
  drain: number;
  /** восстановление на ходу, доля в секунду */
  regen: number;
  /** восстановление на месте, доля в секунду */
  regenIdle: number;
  /** пауза после бега до начала восстановления, с */
  delay: number;
  /** выдохся — бегать снова можно с этого уровня */
  recoverAt: number;
}

export const STAMINA: StaminaCfg = { drain: 1 / 7, regen: 1 / 9, regenIdle: 1 / 5, delay: 0.9, recoverAt: 0.35 };

/** Самый длинный шаг логики, с (вкладка была скрыта, кадр «завис»). Не меньше кадра при ~4 кадрах/с: ход камеры от
 *  частоты кадров не зависит — и шкала на медленной машине тает за те же ~7 с. */
export const STAMINA_MAX_DT = 0.25;

export interface Stamina {
  /** шкала 0…1 */
  v: number;
  /** бежит в этом шаге */
  sprinting: boolean;
  /** выдохся: бега нет, пока v < recoverAt */
  exhausted: boolean;
  /** секунд с конца бега */
  rest: number;
}

export interface StaminaInput {
  /** Shift (и вперёд) зажаты */
  want: boolean;
  /** игрок реально идёт (сдвиг по горизонтали) */
  moving: boolean;
  /** поза позволяет (стоя, не заморожен, режим бега включён) */
  canRun: boolean;
}

export function newStamina(): Stamina {
  return { v: 1, sprinting: false, exhausted: false, rest: STAMINA.delay };
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function stepStamina(s: Stamina, dt: number, input: StaminaInput, cfg: StaminaCfg = STAMINA): Stamina {
  dt = Number.isFinite(dt) ? Math.min(STAMINA_MAX_DT, Math.max(0, dt)) : 0;
  let v = clamp01(Number.isFinite(s.v) ? s.v : 1);
  let exhausted = s.exhausted && v < cfg.recoverAt;
  let rest = Math.max(0, s.rest);
  const sprinting = input.want && input.moving && input.canRun && !exhausted && v > 0;
  if (sprinting) {
    v -= cfg.drain * dt;
    rest = 0;
    if (v <= 0) {
      v = 0;
      exhausted = true;
    }
  } else {
    // восстановление — только с той части шага, что после паузы
    const before = rest;
    rest += dt;
    const t = Math.min(dt, Math.max(0, rest - Math.max(before, cfg.delay)));
    v += (input.moving ? cfg.regen : cfg.regenIdle) * t;
  }
  v = clamp01(v);
  if (exhausted && v >= cfg.recoverAt) exhausted = false;
  return { v, sprinting, exhausted, rest };
}
