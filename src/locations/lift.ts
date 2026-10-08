// Механика спец-локации «Ржавый лифт» — без движка: поездка по этажам, падающая доска, раскачка,
// выходы «прямо» / «направо», логово босса. Движок (Babylon во вкладке 3D, позже — игра) подаёт время и
// положение игрока на площадке кабины, зовёт лифт на этаж и реагирует на события. Контракт зафиксирован
// оркестратором; правила и формулы — docs/LOCATIONS.md.
//
// Коротко (для игрока): кнопкой — на этаж. Тряхнуло доской — площадку кренит: перебегай на поднявшуюся сторону
// (до края не обязательно); на опустившейся раскачаешь сильнее, стоя на месте — не погасишь. С каретки сильный крен выбрасывает в
// шахту, а доска выпадет, только когда раскачка погашена. Клетка бьётся о стены, трос натягивается и долгой раскачки
// не держит — рвётся; доску в клетке надо спихнуть: подбежать к ней по площадке. На каждом этаже два выхода — прямо и направо; за
// одним из них на одном из этажей — логово: оттуда тянет красным светом и гулом.
import { hashSeed, makeRng } from '../model/rng';
import type { LiftSide, LiftSpec } from '../model/types';

export const DEFAULT_LIFT: LiftSpec = {
  kind: 'lift',
  cageChance: 0.5,
  floorsUp: [3, 6],
  floorsDown: [1, 2],
  lairChance: 1,
  speed: 0.6,
  boardChance: 0.35,
  boardFirst: true,
  boardKick: 0.5,
  boardPumpS: [4, 6],
  swingPeriod: 7,
  darkness: 0.7,
};

// Размеры — по ассету пользователя rusted_lift_v2 (docs/LOCATION-LIFT-BABYLON.md): оси кабины x — вправо (сторона
// широкого проёма «направо»), z — вперёд (сторона узкого проёма «прямо», она же вход на этаже 0).
/** Высота этажа шахты, м (уровни ассета 0 / 4.2 / 8.4). */
export const LIFT_FLOOR_M = 4.2;
/** Полуразмеры площадки кабины, м (площадка 2.0 × 3.0: узкая сторона — вперёд): положение игрока нормируется на них. */
export const LIFT_HALF_X = 1.0;
export const LIFT_HALF_Z = 1.5;
/** Шахта в плане (внутри), м: x — 3.6 (передняя стена с узким проёмом), z — 4.4. Комната-пресет лифта — этот прямоугольник. */
export const LIFT_SHAFT_X = 3.6;
export const LIFT_SHAFT_Z = 4.4;
/** Проёмы шахты, м: «прямо» — узкий (передняя стена, коридор 1.4 м), «направо» — широкий (правая стена, коридор 2.8 м). */
export const LIFT_DOOR_STRAIGHT_M = 1.0;
export const LIFT_DOOR_RIGHT_M = 2.4;
/** Крен при |φ| = 1 (предел), градусы — для сцены. */
export const LIFT_TILT_DEG = 15;
/** Собственное затухание качания (доля критического), пока доска застряла и скребёт. */
export const LIFT_ZETA = 0.03;
/** Доска выпала — башмаки снова держат направляющие: затухание сильнее (клетка без игрока стихает за ~10 с). */
export const LIFT_ZETA_FREE = 0.12;
/**
 * Вес игрока: на верхнем (поднятом) краю гасит качание, на нижнем — раскачивает, в центре — ничего. Член
 * затухания c_p = LIFT_PLAYER_DAMP · (−d · sgn φ), d — плечо: положение игрока по оси качания от центра площадки, м
 * (по x до ±1.0, по длинной оси z до ±1.5 — там бежать дальше, но и гасит сильнее).
 * Стоять у одного края — в среднем за период ноль: гасить можно, только перебегая на верхний край.
 */
export const LIFT_PLAYER_DAMP = 5;
/** Застрявшая доска раскачивает в такт: без игрока амплитуда растёт на столько долей предела в секунду. */
export const LIFT_PUMP_RATE = 0.16;
/** Скольжение игрока к нижнему краю: скорость, м/с, при |φ| = 1 (линейно по φ). Движок применяет его к игроку. */
export const LIFT_SLIP = 0.5;
/** Скорость бега, на которую рассчитан баланс (тесты, бот): бег в сцене должен быть не медленнее. */
export const LIFT_RUN = 3;
/** Клетка: удар о стену шахты гасит скорость крена до этой доли (отскок). */
export const LIFT_BOUNCE = 0.45;
/**
 * Трос клетки: пока доска держит кабину, а лебёдка тянет, трос натягивается — износ += (LIFT_WEAR_BASE +
 * LIFT_WEAR_SWAY·min(1, amp))·dt (раскачка рвёт сильнее), за попытку; спихнули доску — износ стоит. Износ LIFT_CABLE —
 * обрыв, клетка падает в шахту (смерть). Стоять на месте — обрыв через ~LIFT_CABLE секунд.
 */
export const LIFT_WEAR_BASE = 0.4;
export const LIFT_WEAR_SWAY = 0.6;
export const LIFT_CABLE = 8;
/** «Трос трещит» (событие fray): износ дошёл до этих долей LIFT_CABLE. */
export const LIFT_FRAY: readonly number[] = [1 / 3, 2 / 3];
/** Каретка: доска раскачивает не меньше pumpS секунд и выпадает, как только амплитуда ниже LIFT_FREE_AMP (раскачку
 *  погасили); не погасили — качает дальше. Бездействие (стоять где угодно) не гасит — выбросит. */
export const LIFT_FREE_AMP = 0.3;
/** Клетка: доска сидит, пока её не спихнут — игрок подбегает по площадке к её краю (+ось качания: «направо» — +x,
 *  «прямо» — +z) ближе LIFT_KICK_REACH, м, не раньше LIFT_KICK_DELAY с после удара. */
export const LIFT_KICK_REACH = 0.45;
export const LIFT_KICK_DELAY = 0.5;
/** «Стихло»: амплитуда ниже LIFT_STEADY_AMP дольше LIFT_STEADY_S после того, как доска перестала качать. */
export const LIFT_STEADY_AMP = 0.1;
export const LIFT_STEADY_S = 1;
/** События sway: не реже раза в SWAY_DT с и при изменении амплитуды на SWAY_STEP. */
export const SWAY_DT = 0.25;
export const SWAY_STEP = 0.05;
/** Шаг интегрирования, с (результат почти не зависит от частоты кадров). */
const H = 1 / 240;

/** Розыгрыш экземпляра лифта по сиду (детерминированно). */
export interface LiftRoll {
  variant: 'cage' | 'carriage';
  /** этажей с выходами над входом (1…): кабина ходит между −down и floors (0 — вход) */
  floors: number;
  /** этажей с выходами под входом (0…) */
  down: number;
  /** логово: этаж (−down…floors, кроме 0) и выход; null — у этого лифта логова нет */
  lair: { floor: number; side: LiftSide } | null;
  /** сид для расписания досок (каждая попытка после смерти — свой под-сид) */
  seed: string;
}

/** Доска на пролёте segment (между этажами segment и segment + 1), попытка attempt. */
export interface LiftBoard {
  segment: number;
  /** где на пролёте застревает: доля пролёта 0.3…0.7 */
  frac: number;
  /** в какой зазор падает (стена шахты со стороны выхода): 'straight' → качает по оси z (бегать 3 м), 'right' — по x (2 м) */
  side: LiftSide;
  /** сколько секунд качает, застряв */
  pumpS: number;
}

export type LiftPhase =
  /** стоит у этажа: выходы этого этажа доступны */
  | 'idle'
  /** едет к этажу target */
  | 'moving'
  /** доска застряла: лифт стоит и качается, пока раскачка не стихнет; затем едет дальше */
  | 'jammed'
  /** каретку накренило за предел — игрока выбросило в шахту (смерть) */
  | 'thrown'
  /** клетка: трос оборвался от раскачки — клетка с игроком упала в шахту (смерть) */
  | 'snapped';

/** Ось качания в осях кабины: x — вправо (сторона выхода «направо»), z — вперёд (выход «прямо»).
 *  φ > 0 — ниже край со стороны +оси. */
export type LiftAxis = 'x' | 'z';

export interface LiftSwing {
  axis: LiftAxis;
  /** крен в долях предела: |φ| ≥ 1 — предел (каретка — выброс, клетка — удар о стену) */
  phi: number;
  /** dφ/dt, 1/с */
  vel: number;
  /** доска застряла и раскачивает (выпала / спихнули — false) */
  stuck: boolean;
  /** каретка: сколько ещё секунд доска раскачивает наверняка (≤ 0 — выпадет, как только раскачку погасят) */
  pump: number;
  /** сколько секунд подряд амплитуда ниже LIFT_STEADY_AMP (после выпадения доски) */
  calm: number;
  /** амплитуда √(φ² + (vel/ω)²) */
  amp: number;
  /** время качания, с (для событий sway) */
  t: number;
  /** амплитуда на последнем событии sway */
  ampEv: number;
}

export interface LiftState {
  phase: LiftPhase;
  roll: LiftRoll;
  attempt: number;
  /** время с начала попытки, с */
  t: number;
  /** высота пола кабины над полом входного этажа, м */
  y: number;
  /** этаж, у которого стоит (idle), или последний пройденный этаж */
  floor: number;
  /** куда едет (moving / jammed); null — стоит */
  target: number | null;
  swing: LiftSwing | null;
  /** пролёты, где доска уже падала в этой попытке */
  boards: number[];
  /** ударов клетки о стены за попытку */
  bangs: number;
  /** износ троса клетки за попытку (LIFT_CABLE — обрыв) */
  wear: number;
  /** выброс: ось и край (+1 / −1), с которого сбросило */
  thrown: { axis: LiftAxis; dir: 1 | -1 } | null;
}

export type LiftEvent =
  /** тронулся с этажа from к этажу to */
  | { type: 'depart'; from: number; to: number }
  /** проехал этаж, не останавливаясь */
  | { type: 'pass'; floor: number }
  /** остановился у этажа: выходы этажа доступны */
  | { type: 'arrive'; floor: number }
  /** доска упала и застряла между кабиной и стеной: удар, треск, пыль, рывок; лифт стоит и качается */
  | { type: 'board'; segment: number; side: LiftSide; axis: LiftAxis; pumpS: number }
  /** раскачка: амплитуда и крен (скрип, звон цепей, тряска камеры) */
  | { type: 'sway'; amp: number; phi: number }
  /** клетка ударилась о стену шахты (strength — скорость удара в долях ω, 0…; dir — край) */
  | { type: 'bang'; strength: number; dir: 1 | -1 }
  /** клетка: игрок подбежал к доске и спихнул её (следом — freed) */
  | { type: 'kick' }
  /** доска выпала и полетела вниз по шахте — больше не качает */
  | { type: 'freed' }
  /** раскачка стихла — лифт едет дальше */
  | { type: 'steady' }
  /** каретку накренило за предел — игрока выбросило в шахту (смерть, затем новая попытка у входа) */
  | { type: 'thrown'; axis: LiftAxis; dir: 1 | -1 }
  /** клетка: трос трещит — износ дошёл до доли LIFT_FRAY (wear — доля LIFT_CABLE): лопнула прядь, рывок */
  | { type: 'fray'; wear: number }
  /** клетка: трос оборвался — клетка с игроком падает в шахту (смерть, затем новая попытка у входа) */
  | { type: 'snap' };

/** Выход, доступный у этажа: на этаже 0 — вход (узкий передний проём, откуда игрок пришёл; широкий на этаже 0
 *  заколочен), на остальных (выше и ниже) — «прямо» (узкий передний) и «направо» (широкий правый). */
export interface LiftExit {
  floor: number;
  side: LiftSide | 'entry';
  /** за этим выходом логово */
  lair: boolean;
}

// ───────────────────────── Спецификация ─────────────────────────

export function newLift(): LiftSpec {
  return cloneLift(DEFAULT_LIFT);
}

export function cloneLift(s: LiftSpec): LiftSpec {
  return { ...s, floorsUp: [s.floorsUp[0], s.floorsUp[1]], floorsDown: [s.floorsDown[0], s.floorsDown[1]], boardPumpS: [s.boardPumpS[0], s.boardPumpS[1]] };
}

export const LIFT_LIMITS = {
  cageChance: [0, 1],
  floorsUp: [1, 30],
  floorsDown: [0, 30],
  lairChance: [0, 1],
  speed: [0.1, 5],
  boardChance: [0, 1],
  boardKick: [0, 2],
  boardPumpS: [0, 60],
  swingPeriod: [0.8, 10],
  darkness: [0, 1],
} as const;

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clampN = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v));
const num = (v: unknown, d: number, lim: readonly [number, number]) => (fin(v) ? clampN(v, lim) : d);

function range(v: unknown, d: [number, number], lim: readonly [number, number], int: boolean): [number, number] {
  if (!Array.isArray(v) || v.length < 2 || !fin(v[0]) || !fin(v[1])) return [d[0], d[1]];
  const f = (x: number) => clampN(int ? Math.round(x) : x, lim);
  const a = f(v[0]), b = f(v[1]);
  return a <= b ? [a, b] : [b, a];
}

/** Толерантный разбор: не объект или kind ≠ 'lift' — null; мусорные поля — по умолчанию; диапазоны
 *  упорядочиваются и зажимаются в LIFT_LIMITS (этажи — целые: вверх ≥ 1, вниз ≥ 0). */
const oldDefaults = (o: Record<string, unknown>): boolean =>
  o.swingPeriod === 5 && o.boardKick === 0.5 && Array.isArray(o.boardPumpS) && o.boardPumpS[0] === 4 && o.boardPumpS[1] === 6;

export function normLift(v: unknown): LiftSpec | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (o.kind !== 'lift') return null;
  const D = DEFAULT_LIFT, L = LIFT_LIMITS;
  return {
    kind: 'lift',
    cageChance: num(o.cageChance, D.cageChance, L.cageChance),
    floorsUp: range(o.floorsUp, D.floorsUp, L.floorsUp, true),
    floorsDown: range(o.floorsDown, D.floorsDown, L.floorsDown, true),
    lairChance: num(o.lairChance, D.lairChance, L.lairChance),
    speed: num(o.speed, D.speed, L.speed),
    boardChance: num(o.boardChance, D.boardChance, L.boardChance),
    boardFirst: typeof o.boardFirst === 'boolean' ? o.boardFirst : D.boardFirst,
    boardKick: num(o.boardKick, D.boardKick, L.boardKick),
    boardPumpS: range(o.boardPumpS, D.boardPumpS, L.boardPumpS, false),
    // старые значения по умолчанию (период 5 с при толчке 0.5 и доске 4–6 с) — к новым: раскачка медленнее, больше
    // времени на реакцию (свои значения не трогаются)
    swingPeriod: oldDefaults(o) ? D.swingPeriod : num(o.swingPeriod, D.swingPeriod, L.swingPeriod),
    darkness: num(o.darkness, D.darkness, L.darkness),
  };
}

// ───────────────────────── Формулы ─────────────────────────

/** Коэффициенты качания: φ'' = −ω²·φ − (2ζω + c_p)·φ' + P·sign(φ') (последнее — пока качает доска),
 *  c_p = kd·(−d·sgn φ) — вес игрока (LIFT_PLAYER_DAMP, d — плечо, м). Период одинаков по обеим осям. */
export function swingCoef(spec: LiftSpec): { w: number; c: number; cFree: number; kd: number; pump: number } {
  const T = fin(spec.swingPeriod) && spec.swingPeriod > 0 ? spec.swingPeriod : DEFAULT_LIFT.swingPeriod;
  const w = (2 * Math.PI) / T;
  return {
    w,
    c: 2 * LIFT_ZETA * w,
    cFree: 2 * LIFT_ZETA_FREE * w,
    kd: LIFT_PLAYER_DAMP,
    // сила «в такт» P·sign(φ'): за период добавляет 4·P·A работы → dA/dt = 2P/(πω) = LIFT_PUMP_RATE
    pump: (LIFT_PUMP_RATE * Math.PI * w) / 2,
  };
}

/** Бросок доски на пролёте segment (−down…floors−1) в попытке attempt: падает ли по шансу и её параметры.
 *  Поток makeRng(roll.seed + "/a" + attempt + "/b" + segment) — не зависит от того, как шли шаги. */
function boardRoll(spec: LiftSpec, roll: LiftRoll, attempt: number, segment: number): { falls: boolean; board: LiftBoard } | null {
  if (!Number.isInteger(segment) || segment < -(roll.down ?? 0) || segment >= roll.floors) return null;
  const R = makeRng(`${roll.seed}/a${attempt}/b${segment}`);
  const falls = R.next() < (fin(spec.boardChance) ? spec.boardChance : DEFAULT_LIFT.boardChance);
  const frac = 0.3 + 0.4 * R.next();
  const side: LiftSide = R.next() < 0.5 ? 'straight' : 'right';
  const [lo, hi] = range(spec.boardPumpS, DEFAULT_LIFT.boardPumpS, LIFT_LIMITS.boardPumpS, false);
  const pumpS = lo + (hi - lo) * R.next();
  return { falls, board: { segment, frac, side, pumpS } };
}

/** Доска на пролёте segment в попытке attempt по шансу (null — не падает). Детерминированно по сиду. */
export function liftBoard(spec: LiftSpec, roll: LiftRoll, attempt: number, segment: number): LiftBoard | null {
  const r = boardRoll(spec, roll, attempt, segment);
  return r?.falls ? r.board : null;
}

/** Доска, которая упадёт, когда кабина поедет вверх через пролёт segment в состоянии s: по шансу (liftBoard), а если
 *  boardFirst и в этой попытке досок ещё не было — всегда (первый подъём не обходится без доски). На пролёте, где
 *  доска уже падала, — null. Этим пользуются и шаг механики, и сцена (доска видна за полсекунды до удара). */
export function boardAhead(spec: LiftSpec, s: LiftState, segment: number): LiftBoard | null {
  if (s.boards.includes(segment)) return null;
  const r = boardRoll(spec, s.roll, s.attempt, segment);
  if (!r) return null;
  return r.falls || (spec.boardFirst !== false && s.boards.length === 0) ? r.board : null;
}

/** Выходы у этажа floor: 0 — вход, выше и ниже (−down…floors) — «прямо» и «направо». */
export function liftExitsAt(roll: LiftRoll, floor: number): LiftExit[] {
  if (floor === 0) return [{ floor: 0, side: 'entry', lair: false }];
  if (floor < -(roll.down ?? 0) || floor > roll.floors || !Number.isInteger(floor)) return [];
  return (['straight', 'right'] as const).map((side) => ({ floor, side, lair: isLair(roll, floor, side) }));
}

/** Подпись этажа в шахте (табличка, кнопки): вход и выше — 1, 2, 3…; ниже входа — −1, −2… */
export function liftFloorLabel(floor: number): string {
  return floor >= 0 ? String(floor + 1) : `−${-floor}`;
}

export function isLair(roll: LiftRoll, floor: number, side: LiftSide | 'entry'): boolean {
  return !!roll.lair && roll.lair.floor === floor && roll.lair.side === side;
}

/** Доступные сейчас выходы: только когда кабина стоит у этажа. */
export function liftExits(s: LiftState): LiftExit[] {
  return s.phase === 'idle' ? liftExitsAt(s.roll, s.floor) : [];
}

const span = ([a, b]: [number, number]) => (a === b ? `${a}` : `${a}–${b}`);

/** Правило для игрока одной строкой (подсказка в инспекторе и в UI игры). */
export function liftRule(spec: LiftSpec): string {
  const lair = spec.lairChance <= 0 ? '' : ` На одном из этажей за одним из выходов — логово: оттуда тянет красным светом и гулом.`;
  const down = spec.floorsDown[1] <= 0 ? '' : ` и ${span(spec.floorsDown)} под ним`;
  return `Кнопки на посту — вверх или вниз: ${span(spec.floorsUp)} эт. над входом${down}, на каждом — выходы прямо (узкий, над входом) и направо (широкий). ` +
    `Тряхнуло доской — площадку кренит: перебегай на поднявшуюся сторону (до края не обязательно); на опустившейся — раскачаешь сильнее, стоя на месте — не погасишь. ` +
    `С каретки сильный крен сбрасывает в шахту, а доска выпадет, только когда раскачку погасишь. ` +
    `Клетку доска держит, пока её не спихнёшь — подбеги к ней по площадке: трос натягивается и долго не выдержит.` + lair;
}

// ───────────────────────── Механика ─────────────────────────

const hex8 = (n: number) => (n >>> 0).toString(16).padStart(8, '0');

/** Розыгрыш экземпляра: по спецификации и ключу сида (locationSeedKey(...) из stairwell.ts). Порядок бросков
 *  фиксирован (вид, этажи вверх, этажи вниз, есть ли логово, этаж логова, выход логова) — не зависит от исходов.
 *  Этаж логова — равновероятно любой с выходами, кроме входного: −down…−1, 1…floors. */
export function rollLift(spec: LiftSpec, seedKey: string): LiftRoll {
  const s = normLift(spec) ?? DEFAULT_LIFT;
  const R = makeRng(`lift|${seedKey}`);
  const variant = R.next() < s.cageChance ? 'cage' : 'carriage';
  const floors = R.int(s.floorsUp[0], s.floorsUp[1]);
  const down = R.int(s.floorsDown[0], s.floorsDown[1]);
  const has = R.next() < s.lairChance;
  const k = R.int(0, down + floors - 1);
  const lairFloor = k < down ? -(k + 1) : k - down + 1;
  const lairSide: LiftSide = R.next() < 0.5 ? 'straight' : 'right';
  return {
    variant,
    floors,
    down,
    lair: has ? { floor: lairFloor, side: lairSide } : null,
    seed: hex8(hashSeed(`lift-seed|${seedKey}`)) + hex8(R.int(0, 0xffffffff)),
  };
}

/** Начать попытку: кабина у входа (этаж 0), стоит. floor — у какого этажа начать (вход в лифт с другого этажа
 *  в «Прогулке», когда игрок возвращается из комнаты за выходом). */
export function createLift(roll: LiftRoll, attempt = 0, floor = 0): LiftState {
  const f = Number.isInteger(floor) && floor >= -(roll.down ?? 0) && floor <= roll.floors ? floor : 0;
  return { phase: 'idle', roll, attempt, t: 0, y: f * LIFT_FLOOR_M, floor: f, target: null, swing: null, boards: [], bangs: 0, wear: 0, thrown: null };
}

/** Позвать кабину на этаж (рычаг / кнопка). Работает, когда стоит или едет (можно развернуть на ходу);
 *  в раскачке и после выброса — нет (пустой список). Тот же этаж, где стоит, — пусто. */
export function callLift(s: LiftState, floor: number): LiftEvent[] {
  if (s.phase !== 'idle' && s.phase !== 'moving') return [];
  if (!Number.isInteger(floor) || floor < -(s.roll.down ?? 0) || floor > s.roll.floors) return [];
  if (s.phase === 'idle' && floor === s.floor) return [];
  if (s.phase === 'moving' && s.target === floor) return [];
  const from = s.phase === 'idle' ? s.floor : s.y / LIFT_FLOOR_M;
  s.target = floor;
  s.phase = 'moving';
  return [{ type: 'depart', from, to: floor }];
}

/**
 * Шаг механики. dt — секунды; player — положение игрока на площадке в осях кабины, м (x — вправо, z — вперёд,
 * 0 — центр; движок сам следит, чтобы игрок был в кабине). Мутирует state, возвращает события шага.
 *
 * moving: кабина идёт к target со скоростью spec.speed; при подъёме через точку доски этой попытки (boardAhead:
 *         по шансу, первый подъём — всегда при boardFirst; пролёт ещё не «отработан») — событие board, фаза jammed, кабина стоит, качание с удара: φ = 0,
 *         φ' = −boardKick·ω (кабину отбрасывает от стены, где застряла доска). Проехал этаж — pass, доехал — arrive.
 * jammed: φ'' = −ω²φ − (2ζω + c_p)·φ' + P·sign(φ') (последнее — пока доска качает, pump > 0; выпала — freed);
 *         c_p = LIFT_PLAYER_DAMP·(−d·sgn φ): игрок на верхнем краю гасит, на нижнем раскачивает; d — плечо, м: положение
 *         игрока по оси качания в долях полуразмера (−1…1), sgn φ сглажен у нуля (|φ| < 0.05). |φ| ≥ 1: каретка — thrown (смерть),
 *         клетка — bang (отскок с LIFT_BOUNCE). Доска: каретка — качает не меньше pumpS, затем выпадает (freed), как
 *         только amp < LIFT_FREE_AMP; клетка — сидит, пока игрок не подбежит к её краю (+ось качания) ближе
 *         LIFT_KICK_REACH (kick, freed). Клетка, пока доска сидит: износ троса += (LIFT_WEAR_BASE + LIFT_WEAR_SWAY·min(1,
 *         amp))·dt, на долях LIFT_FRAY — fray, LIFT_CABLE — snap (смерть). Доска выпала и амплитуда < LIFT_STEADY_AMP
 *         дольше LIFT_STEADY_S — steady, едет дальше к target.
 * thrown, snapped — терминальные: шаг ничего не делает.
 */
export function stepLift(spec: LiftSpec, s: LiftState, dt: number, player: { x: number; z: number }): LiftEvent[] {
  const ev: LiftEvent[] = [];
  if (s.phase === 'thrown' || s.phase === 'snapped') return ev;
  let rest = fin(dt) && dt > 0 ? Math.min(dt, 5) : 0;
  const px = fin(player?.x) ? clampN(player.x / LIFT_HALF_X, [-1, 1]) : 0;
  const pz = fin(player?.z) ? clampN(player.z / LIFT_HALF_Z, [-1, 1]) : 0;
  const speed = fin(spec.speed) && spec.speed > 0 ? spec.speed : DEFAULT_LIFT.speed;
  const co = swingCoef(spec);
  while (rest > 1e-9 && (s.phase as LiftPhase) !== 'thrown' && (s.phase as LiftPhase) !== 'snapped') {
    const h = Math.min(H, rest);
    rest -= h;
    s.t += h;
    if (s.phase === 'moving') moveStep(spec, s, h, speed, co, ev);
    // плечо веса игрока, м: на длинной оси (z) — до 1.5 м, сильнее (бежать дальше, зато и гасит сильнее)
    else if (s.phase === 'jammed') {
      const half = s.swing!.axis === 'x' ? LIFT_HALF_X : LIFT_HALF_Z;
      swingStep(s, h, (s.swing!.axis === 'x' ? px : pz) * half, half, co, ev);
    }
  }
  return ev;
}

function moveStep(spec: LiftSpec, s: LiftState, h: number, speed: number, co: ReturnType<typeof swingCoef>, ev: LiftEvent[]): void {
  const ty = s.target! * LIFT_FLOOR_M;
  const dir = Math.sign(ty - s.y);
  let ny = Math.abs(ty - s.y) <= speed * h ? ty : s.y + dir * speed * h;
  // доска: только при подъёме, один раз на пролёт за попытку
  if (dir > 0) {
    const seg = Math.floor(s.y / LIFT_FLOOR_M + 1e-9);
    const b = boardAhead(spec, s, seg);
    if (b) {
      const by = (seg + b.frac) * LIFT_FLOOR_M;
      if (s.y < by && ny >= by) {
        s.y = by;
        s.boards.push(seg);
        s.phase = 'jammed';
        const axis: LiftAxis = b.side === 'straight' ? 'z' : 'x';
        const kick = fin(spec.boardKick) ? spec.boardKick : DEFAULT_LIFT.boardKick;
        const vel = -kick * co.w;
        s.swing = { axis, phi: 0, vel, stuck: true, pump: b.pumpS, calm: 0, amp: kick, t: 0, ampEv: kick };
        ev.push({ type: 'board', segment: seg, side: b.side, axis, pumpS: b.pumpS });
        return;
      }
    }
  }
  // проехал этажи: отметка этажа f·этаж — в (y, ny] (вверх) или [ny, y) (вниз), кроме целевого
  const F = LIFT_FLOOR_M;
  if (dir > 0) {
    for (let f = Math.floor(s.y / F) + 1; f * F <= ny && f < s.target!; f++) if (f * F > s.y) ev.push({ type: 'pass', floor: f }), (s.floor = f);
  } else if (dir < 0) {
    for (let f = Math.ceil(s.y / F) - 1; f * F >= ny && f > s.target!; f--) if (f * F < s.y) ev.push({ type: 'pass', floor: f }), (s.floor = f);
  }
  s.y = ny;
  if (ny === ty) {
    s.phase = 'idle';
    s.floor = s.target!;
    s.target = null;
    ev.push({ type: 'arrive', floor: s.floor });
  }
}

function swingStep(s: LiftState, h: number, arm: number, half: number, co: ReturnType<typeof swingCoef>, ev: LiftEvent[]): void {
  const sw = s.swing!;
  const pumping = sw.stuck;
  const drive = pumping ? co.pump * (sw.vel !== 0 ? Math.sign(sw.vel) : 1) : 0;
  // вес игрока: на верхнем краю (p против крена) — затухание, на нижнем — раскачка
  const cp = co.kd * -arm * Math.max(-1, Math.min(1, sw.phi / 0.05));
  // полунеявный Эйлер: сначала скорость, потом крен
  sw.vel += (-co.w * co.w * sw.phi - ((pumping ? co.c : co.cFree) + cp) * sw.vel + drive) * h;
  sw.phi += sw.vel * h;
  sw.t += h;
  sw.pump -= h;
  // клетка: подбежал к доске — спихнул
  if (sw.stuck && s.roll.variant === 'cage' && sw.t >= LIFT_KICK_DELAY && arm >= half - LIFT_KICK_REACH) {
    sw.stuck = false;
    ev.push({ type: 'kick' }, { type: 'freed' });
  }
  if (Math.abs(sw.phi) >= 1) {
    const dir = (sw.phi > 0 ? 1 : -1) as 1 | -1;
    if (s.roll.variant === 'carriage') {
      s.phase = 'thrown';
      s.thrown = { axis: sw.axis, dir };
      ev.push({ type: 'thrown', axis: sw.axis, dir });
      return;
    }
    const strength = Math.abs(sw.vel) / co.w;
    sw.phi = dir;
    sw.vel = -sw.vel * LIFT_BOUNCE;
    s.bangs++;
    ev.push({ type: 'bang', strength, dir });
  }
  const amp = Math.hypot(sw.phi, sw.vel / co.w);
  const t0 = sw.t - h;
  sw.amp = amp;
  // каретка: доска выпадает не раньше pumpS и только когда раскачка погашена
  if (sw.stuck && s.roll.variant !== 'cage' && sw.pump <= 0 && amp < LIFT_FREE_AMP) {
    sw.stuck = false;
    ev.push({ type: 'freed' });
  }
  // клетка: пока доска держит кабину, а лебёдка тянет, трос натягивается и изнашивается (сильнее при раскачке); износ
  // LIFT_CABLE — обрыв. Спихнули доску — натяжение спало, износ стоит
  if (s.roll.variant === 'cage' && sw.stuck) {
    const w0 = s.wear;
    s.wear += (LIFT_WEAR_BASE + LIFT_WEAR_SWAY * Math.min(1, amp)) * h;
    for (const f of LIFT_FRAY) if (w0 < f * LIFT_CABLE && s.wear >= f * LIFT_CABLE) ev.push({ type: 'fray', wear: f });
    if (s.wear >= LIFT_CABLE) {
      s.phase = 'snapped';
      ev.push({ type: 'snap' });
      return;
    }
  }
  if (Math.floor(amp / SWAY_STEP) !== Math.floor(sw.ampEv / SWAY_STEP) || Math.floor(sw.t / SWAY_DT) > Math.floor(t0 / SWAY_DT)) {
    sw.ampEv = amp;
    ev.push({ type: 'sway', amp, phi: sw.phi });
  }
  if (!sw.stuck && amp < LIFT_STEADY_AMP) {
    sw.calm += h;
    if (sw.calm >= LIFT_STEADY_S) {
      s.swing = null;
      s.phase = 'moving';
      ev.push({ type: 'steady' });
    }
  } else sw.calm = 0;
}
