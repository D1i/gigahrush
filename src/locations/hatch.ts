// Переход сюжета «Люк в погреб» (сарай → погреб, src/game/story.ts; docs/LOCATIONS.md «Люк в погреб») — сценарий без
// движка, в стиле hangar.ts / snowCollapse.ts: состояние, шаг → события, вид (крышка, затемнение, взгляд).
//
//  • Люк — в полу комнаты «Люк в погреб» (Room.location.kind 'hatch'), в середине габаритов экземпляра (hatchCenter).
//  • Ближе HATCH_NEAR м к середине люка (по плану) — «E — открыть люк» (openHatch).
//  • Крышка откидывается (LID_S, событие 'lid' — легла на пол), взгляд уходит в чёрный проём; спуск — затемнение
//    (DOWN_S). В полной темноте — событие 'descend': движок зовёт операцию мира descend (кооп — через лобби), сажает
//    игрока в комнату-выход и зовёт arriveHatch(ok) — проявление (REVEAL_S), 'done'. Не вышло (мир не поставил комнату) —
//    arriveHatch(false): проявление на месте, крышка закрывается.
//  • Пока идёт сценарий (от E до середины проявления), игрок не ходит (frozen).

/** Подойти к люку: ближе стольких метров к его середине (по плану). */
export const HATCH_NEAR = 1.3;
/** Сторона квадратного люка, м (в тесной комнате — меньше: hatchSize). */
export const HATCH_SIZE_M = 0.9;
/** Крышка откидывается, с. */
export const HATCH_LID_S = 0.9;
/** Спуск: затемнение, с. */
export const HATCH_DOWN_S = 1.2;
/** Проявление в новом месте, с. */
export const HATCH_REVEAL_S = 1.0;
/** Угол откинутой крышки, рад (за вертикаль — лежит на полу за петлями). */
export const HATCH_LID_OPEN = (105 * Math.PI) / 180;

export const HATCH_PROMPT = 'E — открыть люк';

export type HatchPhase = 'idle' | 'open' | 'down' | 'wait' | 'reveal';

export interface HatchState {
  phase: HatchPhase;
  /** время в фазе, с */
  t: number;
  /** спуск не удался — проявление на месте, крышка закрывается */
  failed: boolean;
}

export type HatchEvent =
  /** E: крышка пошла (скрип) */
  | { type: 'open' }
  /** крышка откинулась и легла (стук) */
  | { type: 'lid' }
  /** полная темнота: пора спускаться (операция мира) */
  | { type: 'descend' }
  /** проявился — сценарий окончен */
  | { type: 'done' };

/** Вид сценария в момент: крышка 0…1, затемнение 0…1, тяга взгляда в проём 0…1, игрок стоит. */
export interface HatchView {
  lid: number;
  black: number;
  look: number;
  frozen: boolean;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (t: number) => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};
/** Крышка: тяжёлая — тянут до вертикали (70% угла), за ней падает на пол с разгоном. */
const lidCurve = (t: number) => {
  const x = clamp01(t);
  return x < 0.6 ? 0.7 * smooth(x / 0.6) : 0.7 + 0.3 * ((x - 0.6) / 0.4) ** 2;
};

export function createHatch(): HatchState {
  return { phase: 'idle', t: 0, failed: false };
}

/** E у люка: только из покоя. */
export function openHatch(s: HatchState): HatchEvent[] {
  if (s.phase !== 'idle') return [];
  s.phase = 'open';
  s.t = 0;
  s.failed = false;
  return [{ type: 'open' }];
}

/** Шаг: dt — секунды. Фаза 'wait' ждёт arriveHatch. */
export function stepHatch(s: HatchState, dt: number): HatchEvent[] {
  if (s.phase === 'idle' || s.phase === 'wait') return [];
  s.t += Math.max(0, dt);
  if (s.phase === 'open' && s.t >= HATCH_LID_S) {
    s.phase = 'down';
    s.t = 0;
    return [{ type: 'lid' }];
  }
  if (s.phase === 'down' && s.t >= HATCH_DOWN_S) {
    s.phase = 'wait';
    s.t = 0;
    return [{ type: 'descend' }];
  }
  if (s.phase === 'reveal' && s.t >= HATCH_REVEAL_S) {
    s.phase = 'idle';
    s.t = 0;
    return [{ type: 'done' }];
  }
  return [];
}

/** Спуск состоялся (ok — игрок уже в комнате-выходе) или нет: проявление. */
export function arriveHatch(s: HatchState, ok: boolean): void {
  if (s.phase !== 'wait') return;
  s.phase = 'reveal';
  s.t = 0;
  s.failed = !ok;
}

export function hatchView(s: HatchState): HatchView {
  switch (s.phase) {
    case 'idle':
      return { lid: 0, black: 0, look: 0, frozen: false };
    case 'open':
      return { lid: lidCurve(s.t / HATCH_LID_S), black: 0, look: smooth(s.t / HATCH_LID_S), frozen: true };
    case 'down':
      // спускается: взгляд в проём, темнеет к концу быстрее
      return { lid: 1, black: smooth(s.t / HATCH_DOWN_S) ** 1.3, look: 1, frozen: true };
    case 'wait':
      return { lid: 1, black: 1, look: 1, frozen: true };
    case 'reveal': {
      const k = smooth(s.t / HATCH_REVEAL_S);
      return { lid: s.failed ? 1 - k : 1, black: 1 - k, look: 0, frozen: s.t < HATCH_REVEAL_S * 0.5 };
    }
  }
}

/** Середина люка — середина габаритов экземпляра (bbox в клетках плана), метры плана. */
export function hatchCenter(bbox: { x0: number; y0: number; x1: number; y1: number }, cellM: number): { x: number; y: number } {
  const c = cellM > 0 ? cellM : 0.1;
  return { x: ((bbox.x0 + bbox.x1) / 2) * c, y: ((bbox.y0 + bbox.y1) / 2) * c };
}

/** Сторона люка в комнате с габаритами bbox: HATCH_SIZE_M, в тесной — не больше 0.6 меньшей стороны (не меньше 0.5 м). */
export function hatchSize(bbox: { x0: number; y0: number; x1: number; y1: number }, cellM: number): number {
  const c = cellM > 0 ? cellM : 0.1;
  const m = Math.min(Math.abs(bbox.x1 - bbox.x0), Math.abs(bbox.y1 - bbox.y0)) * c;
  return Math.max(0.5, Math.min(HATCH_SIZE_M, 0.6 * m));
}

/** Игрок (план, м) ближе r к середине люка. */
export function nearHatch(px: number, py: number, c: { x: number; y: number }, r = HATCH_NEAR): boolean {
  return Math.hypot(px - c.x, py - c.y) < r;
}

/** Подсказка: у люка в покое — «E — открыть люк», иначе нет. */
export function hatchPrompt(s: HatchState, near: boolean): string | null {
  return s.phase === 'idle' && near ? HATCH_PROMPT : null;
}
