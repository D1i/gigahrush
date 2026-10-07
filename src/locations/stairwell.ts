// Механика спец-локации «Бесконечная лестница» — без движка: петля, звуки, Хвататель, размыкание.
// Движок (Babylon во вкладке 3D, позже — игра) только подаёт высоту игрока и время и реагирует на
// события. Контракт зафиксирован оркестратором; правила и формулы — docs/LOCATIONS.md.
//
// Коротко (для игрока): спускайся. Услышал звук снизу — сразу поднимись на этаж (чем дольше медлишь,
// тем ближе Хвататель); шаг вниз после звука — смерть. Переждал звук наверху — снова вниз.
// Пережил нужное число звуков подряд — петля размыкается, внизу выход.
import { hashSeed, makeRng } from '../model/rng';
import type { LocationSpec, StairwellSpec } from '../model/types';

export const DEFAULT_STAIRWELL: StairwellSpec = {
  kind: 'stairwell',
  sounds: [3, 5],
  interval: [18, 45],
  grabS: 9,
  accelS: 6,
  floorsDown: [1, 3],
  darkness: 0.85,
};

/** Высота этажа модуля, м (GLB-модуль подъезда). */
export const STAIR_FLOOR_M = 3;
/** Допуск «дошёл до этажа», м: подъём засчитан на y0 + STAIR_FLOOR_M − STAIR_ARRIVE_M (последняя ступень
 *  марша); тот же допуск у «спустился на этаж» перед первым звуком. */
export const STAIR_ARRIVE_M = 0.2;
/** Насколько ниже точки звука можно оступиться без смерти, м (5 ступеней по 0.15 м): дрожь контроллера,
 *  разворот на марше. Ниже — «пошёл вниз», Хвататель утаскивает. */
export const STAIR_DESCENT_M = 0.75;
/** События approach: не реже раза в APPROACH_DT с и при каждом росте близости на APPROACH_STEP. */
export const APPROACH_DT = 0.25;
export const APPROACH_STEP = 0.05;

/** Розыгрыш экземпляра локации по сиду (детерминированно): сколько звуков, куда выводит, расписание. */
export interface StairwellRoll {
  /** сколько звуков подряд пережить */
  sounds: number;
  /** на сколько этажей вниз выводит */
  floorsDown: number;
  /** сид для расписания звуков и вариаций (каждая попытка после смерти — следующий под-сид) */
  seed: string;
}

export type StairPhase =
  /** тихо, можно спускаться */
  | 'calm'
  /** прозвучал звук: надо подняться на этаж, Хвататель приближается */
  | 'threat'
  /** схвачен — смерть */
  | 'grabbed'
  /** петля разомкнута: лестница обычная, внизу выход */
  | 'open';

export interface StairwellState {
  phase: StairPhase;
  roll: StairwellRoll;
  /** номер попытки (после смерти — новая попытка, расписание звуков другое) */
  attempt: number;
  /** время с начала попытки, с */
  t: number;
  /** пережито звуков подряд */
  survived: number;
  /** через сколько секунд следующий звук (в фазе calm; отсчёт идёт, только пока игрок ниже mark на этаж) */
  nextSoundIn: number;
  /** угроза после звука: высота игрока в момент звука, время с звука, близость Хвателя 0..1 */
  threat: { y0: number; t: number; meter: number } | null;
  /** причина захвата */
  grabbedBy: 'descended' | 'slow' | null;
  /**
   * Отметка, м: отсчёт до звука (nextSoundIn) идёт, только когда игрок спустился от неё хотя бы на этаж —
   * y ≤ mark − STAIR_FLOOR_M + STAIR_ARRIVE_M. В начале попытки — 0 (пол входного этажа): первый звук не
   * застанет у двери. После пережитого звука — y0 + STAIR_FLOOR_M (этаж, куда игрок поднялся): следующий
   * звук — только когда он снова пошёл вниз и вернулся на этаж звука. Стоять наверху и «копить» звуки нельзя.
   */
  mark: number;
}

export type StairwellEvent =
  /** index — номер звука в попытке, с 1 */
  | { type: 'sound'; index: number }
  /** близость Хвателя 0..1 (громкость/темп шагов, дыхание, гаснущий свет) */
  | { type: 'approach'; meter: number }
  | { type: 'survived'; count: number; needed: number }
  | { type: 'grabbed'; reason: 'descended' | 'slow' }
  | { type: 'opened' };

// ───────────────────────── Спецификация ─────────────────────────

/** Свежая копия спецификации по умолчанию (массивы не общие с DEFAULT_STAIRWELL). */
export function newStairwell(): StairwellSpec {
  return cloneStairwell(DEFAULT_STAIRWELL);
}

export function cloneStairwell(s: StairwellSpec): StairwellSpec {
  return { ...s, sounds: [s.sounds[0], s.sounds[1]], interval: [s.interval[0], s.interval[1]], floorsDown: [s.floorsDown[0], s.floorsDown[1]] };
}

/** Копия спецификации локации (для дублирования комнаты); null/undefined — как есть. */
export function cloneLocation<T extends LocationSpec | null | undefined>(l: T): T {
  return (l ? cloneStairwell(l) : l) as T;
}

/** Допустимые рамки полей (нормализация и интерфейс). */
export const STAIRWELL_LIMITS = {
  sounds: [1, 50],
  interval: [1, 600],
  grabS: [1, 120],
  accelS: [0.5, 600],
  floorsDown: [1, 50],
  darkness: [0, 1],
} as const;

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clampN = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v));

function range(v: unknown, d: [number, number], lim: readonly [number, number], int: boolean): [number, number] {
  if (!Array.isArray(v) || v.length < 2 || !fin(v[0]) || !fin(v[1])) return [d[0], d[1]];
  const f = (x: number) => clampN(int ? Math.round(x) : x, lim);
  const a = f(v[0]), b = f(v[1]);
  return a <= b ? [a, b] : [b, a];
}

/**
 * Толерантный разбор спецификации «Бесконечной лестницы»: не объект или kind ≠ 'stairwell' — null;
 * отсутствующие/мусорные поля — по умолчанию; диапазоны [min, max] упорядочиваются и зажимаются в
 * STAIRWELL_LIMITS (звуки и этажи — целые ≥ 1).
 */
export function normStairwell(v: unknown): StairwellSpec | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (o.kind !== 'stairwell') return null;
  const D = DEFAULT_STAIRWELL, L = STAIRWELL_LIMITS;
  return {
    kind: 'stairwell',
    sounds: range(o.sounds, D.sounds, L.sounds, true),
    interval: range(o.interval, D.interval, L.interval, false),
    grabS: fin(o.grabS) ? clampN(o.grabS, L.grabS) : D.grabS,
    accelS: fin(o.accelS) ? clampN(o.accelS, L.accelS) : D.accelS,
    floorsDown: range(o.floorsDown, D.floorsDown, L.floorsDown, true),
    darkness: fin(o.darkness) ? clampN(o.darkness, L.darkness) : D.darkness,
  };
}

/** Разбор спец-локации комнаты (все виды); некорректное — null. */
export function parseLocation(v: unknown): LocationSpec | null {
  return normStairwell(v);
}

/** Виды спец-локаций — для интерфейса. */
export const LOCATION_KINDS: { kind: LocationSpec['kind']; name: string }[] = [{ kind: 'stairwell', name: 'Бесконечная лестница' }];

// ───────────────────────── Формулы ─────────────────────────

/** Рабочие параметры шага (защита от рукописных спецификаций без нормализации). */
function params(spec: StairwellSpec): { grabS: number; accelS: number; lo: number; hi: number } {
  const L = STAIRWELL_LIMITS, D = DEFAULT_STAIRWELL;
  const grabS = fin(spec.grabS) && spec.grabS > 0 ? spec.grabS : D.grabS;
  const accelS = fin(spec.accelS) && spec.accelS > 0 ? spec.accelS : D.accelS;
  const [lo, hi] = range(spec.interval, D.interval, L.interval, false);
  return { grabS, accelS, lo, hi };
}

/**
 * Близость Хвателя через t секунд после звука: m(t) = (t + t² / (2·accelS)) / grabS — интеграл темпа
 * dm/dt = (1 + t / accelS) / grabS. Не зависит от того, что делает игрок (кроме исходов: подъём / спуск).
 */
export function approachMeter(spec: StairwellSpec, t: number): number {
  const { grabS, accelS } = params(spec);
  return (t + (t * t) / (2 * accelS)) / grabS;
}

/**
 * Через сколько секунд после звука Хвататель хватает игрока, если тот не поднялся на этаж (m = 1):
 * t* = accelS · (√(1 + 2·grabS / accelS) − 1). По умолчанию (grabS 9, accelS 6) — ровно 6 с.
 * Без ускорения (accelS → ∞) t* → grabS; при сильном ускорении (accelS ≪ grabS) t* ≈ √(2·grabS·accelS).
 */
export function grabTime(spec: StairwellSpec): number {
  const { grabS, accelS } = params(spec);
  return accelS * (Math.sqrt(1 + (2 * grabS) / accelS) - 1);
}

/** Пауза до звука номер i (0 — первый) в попытке attempt: равномерно в [interval.min, interval.max]
 *  на потоке makeRng(roll.seed + "/a" + attempt + "/s" + i). Не зависит от того, как шли шаги. */
export function soundDelay(spec: StairwellSpec, roll: StairwellRoll, attempt: number, i: number): number {
  const { lo, hi } = params(spec);
  return lo + (hi - lo) * makeRng(`${roll.seed}/a${attempt}/s${i}`).next();
}

/** Ключ сида экземпляра локации в бесконечном мире: сид мира (seedKey(seed, mods)) + адрес экземпляра. */
export function locationSeedKey(worldSeedKey: string, addr: string): string {
  return `${worldSeedKey}#loc:${addr}`;
}

/** Русское склонение: 1 звук, 2 звука, 5 звуков. */
function plural(n: number, [one, few, many]: [string, string, string]): string {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  return b === 1 ? one : b >= 2 && b <= 4 ? few : many;
}

const span = ([a, b]: [number, number]) => (a === b ? `${a}` : `${a}–${b}`);

/** Правило для игрока одной строкой (подсказка в инспекторе и в UI игры). */
export function stairwellRule(spec: StairwellSpec): string {
  const t = grabTime(spec);
  return `Спускайся. Услышал звук снизу — сразу поднимись на этаж: Хвататель доберётся за ~${t.toFixed(1)} с, ` +
    `с каждой секундой быстрее; шаг вниз после звука — смерть. Переждал — снова вниз. ` +
    `${span(spec.sounds)} ${plural(spec.sounds[1], ['звук', 'звука', 'звуков'])} подряд — лестница становится обычной ` +
    `и выводит на ${span(spec.floorsDown)} ${plural(spec.floorsDown[1], ['этаж', 'этажа', 'этажей'])} ниже.`;
}

// ───────────────────────── Механика ─────────────────────────

const hex8 = (n: number) => (n >>> 0).toString(16).padStart(8, '0');

/** Розыгрыш экземпляра: по спецификации и ключу сида (например seed + адрес экземпляра). */
export function rollStairwell(spec: StairwellSpec, seedKey: string): StairwellRoll {
  const s = normStairwell(spec) ?? DEFAULT_STAIRWELL;
  const R = makeRng(`stairwell|${seedKey}`);
  const sounds = R.int(s.sounds[0], s.sounds[1]);
  const floorsDown = R.int(s.floorsDown[0], s.floorsDown[1]);
  return { sounds, floorsDown, seed: hex8(hashSeed(`stairwell-seed|${seedKey}`)) + hex8(R.int(0, 0xffffffff)) };
}

/** Начать попытку (attempt 0 — первая). */
export function createStairwell(spec: StairwellSpec, roll: StairwellRoll, attempt = 0): StairwellState {
  return {
    phase: 'calm',
    roll,
    attempt,
    t: 0,
    survived: 0,
    nextSoundIn: soundDelay(spec, roll, attempt, 0),
    threat: null,
    grabbedBy: null,
    mark: 0,
  };
}

/**
 * Шаг механики. y — высота глаз/ног игрока в «развёрнутой» лестнице, м (0 — пол входного этажа,
 * вниз — отрицательные; движок сам сворачивает петлю, но y передаёт непрерывным). Мутирует state,
 * возвращает события этого шага.
 *
 * calm:   если y ≤ mark − STAIR_FLOOR_M + STAIR_ARRIVE_M — идёт отсчёт nextSoundIn; дошёл до 0 — событие sound,
 *         фаза threat, y0 = y (остаток dt идёт уже в угрозу).
 * threat: близость m(t) = (t + t²/(2·accelS)) / grabS. Проверки в конце шага, по порядку:
 *         y < y0 − STAIR_DESCENT_M → grabbed 'descended'; y ≥ y0 + STAIR_FLOOR_M − STAIR_ARRIVE_M → survived
 *         (успел — даже если m дошла до 1 в этом же шаге); m ≥ 1 → grabbed 'slow'; иначе approach (раз в
 *         APPROACH_DT с и при росте m на APPROACH_STEP). После survived: пережито ≥ roll.sounds → open
 *         (событие opened), иначе calm, mark = y0 + STAIR_FLOOR_M, новый nextSoundIn.
 * grabbed / open — терминальные: шаг ничего не делает.
 */
export function stepStairwell(spec: StairwellSpec, s: StairwellState, dt: number, y: number): StairwellEvent[] {
  const ev: StairwellEvent[] = [];
  if (s.phase === 'grabbed' || s.phase === 'open' || !fin(y)) return ev;
  let rest = fin(dt) && dt > 0 ? dt : 0;
  if (s.phase === 'calm') {
    if (s.survived >= s.roll.sounds) {
      s.phase = 'open';
      ev.push({ type: 'opened' });
      return ev;
    }
    const armed = y <= s.mark - STAIR_FLOOR_M + STAIR_ARRIVE_M;
    if (!armed || rest < s.nextSoundIn) {
      if (armed) s.nextSoundIn -= rest;
      s.t += rest;
      return ev;
    }
    s.t += s.nextSoundIn;
    rest -= s.nextSoundIn;
    s.nextSoundIn = 0;
    s.phase = 'threat';
    s.threat = { y0: y, t: 0, meter: 0 };
    ev.push({ type: 'sound', index: s.survived + 1 });
  }
  const th = s.threat!;
  const { grabS, accelS } = params(spec);
  const t0 = th.t, t1 = t0 + rest, m0 = th.meter;
  const m1 = Math.min(1, m0 + (rest + (t1 * t1 - t0 * t0) / (2 * accelS)) / grabS);
  th.t = t1;
  th.meter = m1;
  s.t += rest;
  if (y < th.y0 - STAIR_DESCENT_M) return grab(s, 'descended', ev);
  if (y >= th.y0 + STAIR_FLOOR_M - STAIR_ARRIVE_M) {
    s.survived++;
    ev.push({ type: 'survived', count: s.survived, needed: s.roll.sounds });
    s.mark = th.y0 + STAIR_FLOOR_M;
    s.threat = null;
    if (s.survived >= s.roll.sounds) {
      s.phase = 'open';
      ev.push({ type: 'opened' });
    } else {
      s.phase = 'calm';
      s.nextSoundIn = soundDelay(spec, s.roll, s.attempt, s.survived);
    }
    return ev;
  }
  if (m1 >= 1) return grab(s, 'slow', ev);
  if (Math.floor(m1 / APPROACH_STEP) > Math.floor(m0 / APPROACH_STEP) || Math.floor(t1 / APPROACH_DT) > Math.floor(t0 / APPROACH_DT)) {
    ev.push({ type: 'approach', meter: m1 });
  }
  return ev;
}

function grab(s: StairwellState, reason: 'descended' | 'slow', ev: StairwellEvent[]): StairwellEvent[] {
  s.phase = 'grabbed';
  s.grabbedBy = reason;
  ev.push({ type: 'grabbed', reason });
  return ev;
}
