// Временные эффекты игрока «Прогулки» (еда, выпивка, аптека) — чистые таймеры, без Babylon, DOM и localStorage:
// функции возвращают новое состояние (старое не меняется). Слой вида каждый кадр зовёт stepFx(fx, dt), еду —
// applyFood(fx, id) (лечение heal и «стамина до полной» — наружу: host.heal?(hp), stamina.v = 1), читает производные:
//  • speedMul — произведение баффов: закрутка ×1.3 на 120 с, пузырь ×2 на 60 с; лежит (down) — 0. Замедление сумкой —
//    отдельно (src/game/hotbar.ts: bagSpeed);
//  • invuln — неуязвим (юзграм: обморок 10 с); down — лежит (обморок юзграма или пьяное падение);
//  • marked — «меченый»: твари выбирают тебя (пузырь 60 с; пьяное падение — тоже); drunk — пузырь действует;
//  • badLuck — множитель для будущих бросков «случается плохое» (пузырь — ×1.5);
//  • noise 0…1 — сколько шума от игрока прямо сейчас (гаснет ~1/с; качание «Жучка» — addNoise; пьяное падение — 1:
//    охаешь на всю карту).
// Второй пузырь, пока пьян (drunk), — не бафф, а падение на 15 с (лечит и стамину всё равно даёт: выпил же).
// Свет зиппы (collapseMul) считает src/game/itemUse.ts — fxView склеивает всё в одно для Inventory.fx.

/** Закрутка: множитель скорости и время, с. */
export const PRESERVES_SPEED = 1.3;
export const PRESERVES_S = 120;
/** Пузырь: множитель скорости, время баффа / «меченый» / пьян, с; падение со второго подряд, с. */
export const BUBBLE_SPEED = 2;
export const BUBBLE_S = 60;
export const BUBBLE_COLLAPSE_S = 15;
/** Пузырь: множитель «плохих» бросков, пока действует. */
export const BUBBLE_BAD_LUCK = 1.5;
/** Юзграм: обморок (и неуязвимость), с. */
export const YUZGRAM_S = 10;
/** Шум гаснет на столько в секунду (доля шкалы). */
export const NOISE_DECAY = 1;
/** Самый длинный шаг таймеров, с (вкладка была скрыта — эффекты не сгорают разом). */
export const FX_MAX_DT = 0.5;

/** Еда: лечение, стамина до полной. */
export interface FoodDef {
  /** здоровье, HP */
  heal: number;
  /** стамина до 100 % */
  staminaFull: boolean;
}

/** Таблица еды по id предмета (src/data/itemsLoot.ts, kind 'food'). */
export const FOOD: Readonly<Record<string, FoodDef>> = {
  it_bread: { heal: 35, staminaFull: true },
  it_preserves: { heal: 50, staminaFull: true },
  it_bubble: { heal: 40, staminaFull: true },
  it_yuzgram: { heal: 0, staminaFull: false },
};

/** Состояние эффектов: секунды до конца каждого таймера (0 — нет) и шум. */
export interface Fx {
  /** закрутка: ×1.3 ещё столько секунд */
  speedT: number;
  /** пузырь: ×2, «меченый», пьян — ещё столько секунд */
  bubbleT: number;
  /** юзграм: обморок и неуязвимость — ещё столько секунд */
  faintT: number;
  /** пьяное падение (второй пузырь): лежит, охает, меченый — ещё столько секунд */
  collapseT: number;
  /** шум 0…1 */
  noise: number;
}

/** Всё, что видно наружу (Inventory.fx). */
export interface FxView {
  speedMul: number;
  invuln: boolean;
  marked: boolean;
  drunk: boolean;
  down: boolean;
  noise: number;
  /** множитель частоты обвалов (зиппа горит — 2; itemUse.collapseMul) */
  collapseMul: number;
  badLuck: number;
}

export function newFx(): Fx {
  return { speedT: 0, bubbleT: 0, faintT: 0, collapseT: 0, noise: 0 };
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const pos = (v: number): number => (Number.isFinite(v) && v > 0 ? v : 0);

/** Таймеры вперёд на dt секунд (dt зажат 0…FX_MAX_DT). Пьяное падение держит шум на 1, иначе шум гаснет. */
export function stepFx(fx: Fx, dt: number): Fx {
  dt = Number.isFinite(dt) ? Math.min(FX_MAX_DT, Math.max(0, dt)) : 0;
  const collapseT = Math.max(0, pos(fx.collapseT) - dt);
  return {
    speedT: Math.max(0, pos(fx.speedT) - dt),
    bubbleT: Math.max(0, pos(fx.bubbleT) - dt),
    faintT: Math.max(0, pos(fx.faintT) - dt),
    collapseT,
    noise: collapseT > 0 ? 1 : Math.max(0, clamp01(pos(fx.noise)) - NOISE_DECAY * dt),
  };
}

/** Добавить шум (качнул «Жучка», упал…): шкала до 1. */
export function addNoise(fx: Fx, v: number): Fx {
  if (!Number.isFinite(v) || v <= 0) return fx;
  return { ...fx, noise: clamp01(pos(fx.noise) + v) };
}

/** Итог еды: новое состояние, лечение (HP) и «стамина до полной». */
export interface Eaten {
  fx: Fx;
  heal: number;
  staminaFull: boolean;
}

/** Съесть / выпить предмет itemId. Не еда — null.
 *  • хлеб: +35 HP, стамина;
 *  • закрутка: +50 HP, стамина, ×1.3 на 120 с (повтор — таймер заново);
 *  • пузырь: +40 HP, стамина, ×2 / меченый / пьян на 60 с; пока пьян — второй валит с ног на 15 с (бафф не продлевает);
 *  • юзграм: обморок и неуязвимость на 10 с, без лечения. */
export function applyFood(fx: Fx, itemId: string): Eaten | null {
  const f = FOOD[itemId];
  if (!f) return null;
  const next: Fx = { ...fx };
  switch (itemId) {
    case 'it_preserves':
      next.speedT = Math.max(pos(fx.speedT), PRESERVES_S);
      break;
    case 'it_bubble':
      if (drunk(fx)) {
        next.collapseT = Math.max(pos(fx.collapseT), BUBBLE_COLLAPSE_S);
        next.noise = 1;
      } else next.bubbleT = BUBBLE_S;
      break;
    case 'it_yuzgram':
      next.faintT = Math.max(pos(fx.faintT), YUZGRAM_S);
      break;
    // хлеб — только лечение и стамина
  }
  return { fx: next, heal: f.heal, staminaFull: f.staminaFull };
}

/** Лежит: обморок юзграма или пьяное падение (двигаться и бегать нельзя). */
export const down = (fx: Fx): boolean => fx.faintT > 0 || fx.collapseT > 0;
/** Неуязвим: обморок юзграма. */
export const invuln = (fx: Fx): boolean => fx.faintT > 0;
/** Пьян: пузырь действует (или лежит после второго). */
export const drunk = (fx: Fx): boolean => fx.bubbleT > 0 || fx.collapseT > 0;
/** «Меченый»: твари выбирают тебя первым (пузырь, пьяное падение). */
export const marked = (fx: Fx): boolean => fx.bubbleT > 0 || fx.collapseT > 0;
/** Множитель «плохих» случайностей: пузырь — BUBBLE_BAD_LUCK, иначе 1. */
export const badLuck = (fx: Fx): number => (drunk(fx) ? BUBBLE_BAD_LUCK : 1);
/** Шум 0…1. */
export const noise = (fx: Fx): number => clamp01(pos(fx.noise));

/** Множитель скорости от эффектов: произведение баффов (закрутка, пузырь); лежит — 0. Сумка — не здесь. */
export function speedMul(fx: Fx): number {
  if (down(fx)) return 0;
  return (fx.speedT > 0 ? PRESERVES_SPEED : 1) * (fx.bubbleT > 0 ? BUBBLE_SPEED : 1);
}

/** Всё разом — для Inventory.fx; collapseMul — от света в руке (itemUse.collapseMul), по умолчанию 1. */
export function fxView(fx: Fx, collapseMul = 1): FxView {
  return {
    speedMul: speedMul(fx),
    invuln: invuln(fx),
    marked: marked(fx),
    drunk: drunk(fx),
    down: down(fx),
    noise: noise(fx),
    collapseMul,
    badLuck: badLuck(fx),
  };
}
