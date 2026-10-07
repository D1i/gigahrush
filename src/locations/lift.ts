// Механика спец-локации «Ржавый лифт» — без движка: поездка по этажам, падающая доска, раскачка,
// выходы «прямо» / «направо», логово босса. Движок (Babylon во вкладке 3D, позже — игра) подаёт время и
// положение игрока на площадке кабины, зовёт лифт на этаж и реагирует на события. Контракт зафиксирован
// оркестратором; правила и формулы — docs/LOCATIONS.md.
//
// Коротко (для игрока): рычагом — на этаж. Тряхнуло доской — площадку кренит: перебегай на верхний край;
// на нижнем краю раскачаешь сильнее, стоя на месте — не погасишь. С каретки сильный крен выбрасывает в
// шахту; клетка бьётся о стены и стоит, пока не стихнет. На каждом этаже два выхода — прямо и направо; за
// одним из них на одном из этажей — логово: оттуда тянет красным светом и гулом.
import { hashSeed, makeRng } from '../model/rng';
import type { LiftSide, LiftSpec } from '../model/types';

export const DEFAULT_LIFT: LiftSpec = {
  kind: 'lift',
  cageChance: 0.5,
  floorsUp: [3, 6],
  lairChance: 1,
  speed: 0.6,
  boardChance: 0.35,
  boardKick: 0.5,
  boardPumpS: [4, 6],
  swingPeriod: 5,
  darkness: 0.7,
};

/** Высота этажа шахты, м (как у модуля подъезда). */
export const LIFT_FLOOR_M = 3;
/** Полуразмер площадки кабины, м (площадка 2.0 × 2.0): положение игрока нормируется на него. */
export const LIFT_HALF_M = 1.0;
/** Шахта в плане (внутри), м: комната-пресет лифта — 2.6 × 2.6; зазор кабина — стена 0.3 м (сюда застревает доска). */
export const LIFT_SHAFT_M = 2.6;
/** Крен при |φ| = 1 (предел), градусы — для сцены. */
export const LIFT_TILT_DEG = 15;
/** Собственное затухание качания (доля критического). */
export const LIFT_ZETA = 0.03;
/**
 * Вес игрока: на верхнем (поднятом) краю гасит качание, на нижнем — раскачивает, в центре — ничего. Член
 * затухания c_p = LIFT_PLAYER_DAMP · (−p · sgn φ), p — положение игрока по оси качания в долях полуразмера.
 * Стоять у одного края — в среднем за период ноль: гасить можно, только перебегая на верхний край.
 */
export const LIFT_PLAYER_DAMP = 3.5;
/** Застрявшая доска раскачивает в такт: без игрока амплитуда растёт на столько долей предела в секунду. */
export const LIFT_PUMP_RATE = 0.16;
/** Скольжение игрока к нижнему краю: скорость, м/с, при |φ| = 1 (линейно по φ). Движок применяет его к игроку. */
export const LIFT_SLIP = 0.5;
/** Скорость бега, на которую рассчитан баланс (тесты, бот): бег в сцене должен быть не медленнее. */
export const LIFT_RUN = 3;
/** Клетка: удар о стену шахты гасит скорость крена до этой доли (отскок). */
export const LIFT_BOUNCE = 0.45;
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
  /** этажей с выходами над входом (1…): кабина ходит между 0 (вход) и floors */
  floors: number;
  /** логово: этаж (1…floors) и выход; null — у этого лифта логова нет */
  lair: { floor: number; side: LiftSide } | null;
  /** сид для расписания досок (каждая попытка после смерти — свой под-сид) */
  seed: string;
}

/** Доска на пролёте segment (между этажами segment и segment + 1), попытка attempt. */
export interface LiftBoard {
  segment: number;
  /** где на пролёте застревает: доля пролёта 0.3…0.7 */
  frac: number;
  /** с какой стороны падает (из проёма какого выхода): 'straight' → качает по оси z, 'right' — по x */
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
  | 'thrown';

/** Ось качания в осях кабины: x — вправо (сторона выхода «направо»), z — вперёд (выход «прямо»).
 *  φ > 0 — ниже край со стороны +оси. */
export type LiftAxis = 'x' | 'z';

export interface LiftSwing {
  axis: LiftAxis;
  /** крен в долях предела: |φ| ≥ 1 — предел (каретка — выброс, клетка — удар о стену) */
  phi: number;
  /** dφ/dt, 1/с */
  vel: number;
  /** сколько ещё секунд доска раскачивает (≤ 0 — выпала) */
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
  /** доска выпала и полетела вниз по шахте — больше не качает */
  | { type: 'freed' }
  /** раскачка стихла — лифт едет дальше */
  | { type: 'steady' }
  /** каретку накренило за предел — игрока выбросило в шахту (смерть, затем новая попытка у входа) */
  | { type: 'thrown'; axis: LiftAxis; dir: 1 | -1 };

/** Выход, доступный у этажа: на этаже 0 — «назад» (входная дверь), выше — «прямо» и «направо». */
export interface LiftExit {
  floor: number;
  side: LiftSide | 'back';
  /** за этим выходом логово */
  lair: boolean;
}

// ───────────────────────── Спецификация ─────────────────────────

export function newLift(): LiftSpec {
  return cloneLift(DEFAULT_LIFT);
}

export function cloneLift(s: LiftSpec): LiftSpec {
  return { ...s, floorsUp: [s.floorsUp[0], s.floorsUp[1]], boardPumpS: [s.boardPumpS[0], s.boardPumpS[1]] };
}

export const LIFT_LIMITS = {
  cageChance: [0, 1],
  floorsUp: [1, 30],
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
 *  упорядочиваются и зажимаются в LIFT_LIMITS (этажи — целые ≥ 1). */
export function normLift(v: unknown): LiftSpec | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (o.kind !== 'lift') return null;
  const D = DEFAULT_LIFT, L = LIFT_LIMITS;
  return {
    kind: 'lift',
    cageChance: num(o.cageChance, D.cageChance, L.cageChance),
    floorsUp: range(o.floorsUp, D.floorsUp, L.floorsUp, true),
    lairChance: num(o.lairChance, D.lairChance, L.lairChance),
    speed: num(o.speed, D.speed, L.speed),
    boardChance: num(o.boardChance, D.boardChance, L.boardChance),
    boardKick: num(o.boardKick, D.boardKick, L.boardKick),
    boardPumpS: range(o.boardPumpS, D.boardPumpS, L.boardPumpS, false),
    swingPeriod: num(o.swingPeriod, D.swingPeriod, L.swingPeriod),
    darkness: num(o.darkness, D.darkness, L.darkness),
  };
}

// ───────────────────────── Формулы ─────────────────────────

/** Коэффициенты качания: φ'' = −ω²·φ − (2ζω + c_p)·φ' + P·sign(φ') (последнее — пока качает доска),
 *  c_p = kd·(−p·sgn φ) — вес игрока (LIFT_PLAYER_DAMP). */
export function swingCoef(spec: LiftSpec): { w: number; c: number; kd: number; pump: number } {
  const T = fin(spec.swingPeriod) && spec.swingPeriod > 0 ? spec.swingPeriod : DEFAULT_LIFT.swingPeriod;
  const w = (2 * Math.PI) / T;
  return {
    w,
    c: 2 * LIFT_ZETA * w,
    kd: LIFT_PLAYER_DAMP,
    // сила «в такт» P·sign(φ'): за период добавляет 4·P·A работы → dA/dt = 2P/(πω) = LIFT_PUMP_RATE
    pump: (LIFT_PUMP_RATE * Math.PI * w) / 2,
  };
}

/** Доска на пролёте segment в попытке attempt (null — не падает). Детерминированно по сиду, не зависит
 *  от того, как шли шаги: поток makeRng(roll.seed + "/a" + attempt + "/b" + segment). */
export function liftBoard(spec: LiftSpec, roll: LiftRoll, attempt: number, segment: number): LiftBoard | null {
  if (segment < 0 || segment >= roll.floors) return null;
  const R = makeRng(`${roll.seed}/a${attempt}/b${segment}`);
  const falls = R.next() < (fin(spec.boardChance) ? spec.boardChance : DEFAULT_LIFT.boardChance);
  const frac = 0.3 + 0.4 * R.next();
  const side: LiftSide = R.next() < 0.5 ? 'straight' : 'right';
  const [lo, hi] = range(spec.boardPumpS, DEFAULT_LIFT.boardPumpS, LIFT_LIMITS.boardPumpS, false);
  const pumpS = lo + (hi - lo) * R.next();
  return falls ? { segment, frac, side, pumpS } : null;
}

/** Выходы у этажа floor: 0 — «назад» (вход), выше — «прямо» и «направо». */
export function liftExitsAt(roll: LiftRoll, floor: number): LiftExit[] {
  if (floor === 0) return [{ floor: 0, side: 'back', lair: false }];
  if (floor < 0 || floor > roll.floors || !Number.isInteger(floor)) return [];
  return (['straight', 'right'] as const).map((side) => ({ floor, side, lair: isLair(roll, floor, side) }));
}

export function isLair(roll: LiftRoll, floor: number, side: LiftSide | 'back'): boolean {
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
  return `Рычаг — вверх или вниз, ${span(spec.floorsUp)} эт. над входом, на каждом — выходы прямо и направо. ` +
    `Тряхнуло доской — площадку кренит: перебегай на верхний край; на нижнем — раскачаешь сильнее, стоя на месте — не погасишь. ` +
    `С каретки сильный крен сбрасывает в шахту; клетка бьётся о стены и стоит, пока не стихнет.` + lair;
}

// ───────────────────────── Механика ─────────────────────────

const hex8 = (n: number) => (n >>> 0).toString(16).padStart(8, '0');

/** Розыгрыш экземпляра: по спецификации и ключу сида (locationSeedKey(...) из stairwell.ts). Порядок бросков
 *  фиксирован (вид, этажи, есть ли логово, этаж логова, выход логова) — не зависит от исходов. */
export function rollLift(spec: LiftSpec, seedKey: string): LiftRoll {
  const s = normLift(spec) ?? DEFAULT_LIFT;
  const R = makeRng(`lift|${seedKey}`);
  const variant = R.next() < s.cageChance ? 'cage' : 'carriage';
  const floors = R.int(s.floorsUp[0], s.floorsUp[1]);
  const has = R.next() < s.lairChance;
  const lairFloor = R.int(1, floors);
  const lairSide: LiftSide = R.next() < 0.5 ? 'straight' : 'right';
  return {
    variant,
    floors,
    lair: has ? { floor: lairFloor, side: lairSide } : null,
    seed: hex8(hashSeed(`lift-seed|${seedKey}`)) + hex8(R.int(0, 0xffffffff)),
  };
}

/** Начать попытку: кабина у входа (этаж 0), стоит. floor — у какого этажа начать (вход в лифт с этажа выше
 *  в «Прогулке», когда игрок возвращается из комнаты за выходом). */
export function createLift(roll: LiftRoll, attempt = 0, floor = 0): LiftState {
  const f = Number.isInteger(floor) && floor >= 0 && floor <= roll.floors ? floor : 0;
  return { phase: 'idle', roll, attempt, t: 0, y: f * LIFT_FLOOR_M, floor: f, target: null, swing: null, boards: [], bangs: 0, thrown: null };
}

/** Позвать кабину на этаж (рычаг / кнопка). Работает, когда стоит или едет (можно развернуть на ходу);
 *  в раскачке и после выброса — нет (пустой список). Тот же этаж, где стоит, — пусто. */
export function callLift(s: LiftState, floor: number): LiftEvent[] {
  if (s.phase !== 'idle' && s.phase !== 'moving') return [];
  if (!Number.isInteger(floor) || floor < 0 || floor > s.roll.floors) return [];
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
 * moving: кабина идёт к target со скоростью spec.speed; при подъёме через точку доски этой попытки (liftBoard,
 *         пролёт ещё не «отработан») — событие board, фаза jammed, кабина стоит, качание с удара: φ = 0,
 *         φ' = −boardKick·ω (кабину отбрасывает от стены, где застряла доска). Проехал этаж — pass, доехал — arrive.
 * jammed: φ'' = −ω²φ − (2ζω + c_p)·φ' + P·sign(φ') (последнее — пока доска качает, pump > 0; выпала — freed);
 *         c_p = LIFT_PLAYER_DAMP·(−p·sgn φ): игрок на верхнем краю гасит, на нижнем раскачивает; p — положение
 *         игрока по оси качания в долях полуразмера (−1…1), sgn φ сглажен у нуля (|φ| < 0.05). |φ| ≥ 1: каретка — thrown (смерть),
 *         клетка — bang (отскок с LIFT_BOUNCE). Доска выпала и амплитуда < LIFT_STEADY_AMP дольше LIFT_STEADY_S —
 *         steady, едет дальше к target.
 * thrown — терминальная: шаг ничего не делает.
 */
export function stepLift(spec: LiftSpec, s: LiftState, dt: number, player: { x: number; z: number }): LiftEvent[] {
  const ev: LiftEvent[] = [];
  if (s.phase === 'thrown') return ev;
  let rest = fin(dt) && dt > 0 ? Math.min(dt, 5) : 0;
  const px = fin(player?.x) ? clampN(player.x / LIFT_HALF_M, [-1, 1]) : 0;
  const pz = fin(player?.z) ? clampN(player.z / LIFT_HALF_M, [-1, 1]) : 0;
  const speed = fin(spec.speed) && spec.speed > 0 ? spec.speed : DEFAULT_LIFT.speed;
  const co = swingCoef(spec);
  while (rest > 1e-9 && (s.phase as LiftPhase) !== 'thrown') {
    const h = Math.min(H, rest);
    rest -= h;
    s.t += h;
    if (s.phase === 'moving') moveStep(spec, s, h, speed, co, ev);
    else if (s.phase === 'jammed') swingStep(s, h, s.swing!.axis === 'x' ? px : pz, co, ev);
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
    const b = s.boards.includes(seg) ? null : liftBoard(spec, s.roll, s.attempt, seg);
    if (b) {
      const by = (seg + b.frac) * LIFT_FLOOR_M;
      if (s.y < by && ny >= by) {
        s.y = by;
        s.boards.push(seg);
        s.phase = 'jammed';
        const axis: LiftAxis = b.side === 'straight' ? 'z' : 'x';
        const kick = fin(spec.boardKick) ? spec.boardKick : DEFAULT_LIFT.boardKick;
        const vel = -kick * co.w;
        s.swing = { axis, phi: 0, vel, pump: b.pumpS, calm: 0, amp: kick, t: 0, ampEv: kick };
        ev.push({ type: 'board', segment: seg, side: b.side, axis, pumpS: b.pumpS });
        return;
      }
    }
  }
  // проехал этажи
  const f0 = s.y / LIFT_FLOOR_M, f1 = ny / LIFT_FLOOR_M;
  if (dir > 0) for (let f = Math.floor(f0 + 1e-9) + 1; f < f1 - 1e-9 && f < s.target!; f++) ev.push({ type: 'pass', floor: f }), (s.floor = f);
  if (dir < 0) for (let f = Math.ceil(f0 - 1e-9) - 1; f > f1 + 1e-9 && f > s.target!; f--) ev.push({ type: 'pass', floor: f }), (s.floor = f);
  s.y = ny;
  if (ny === ty) {
    s.phase = 'idle';
    s.floor = s.target!;
    s.target = null;
    ev.push({ type: 'arrive', floor: s.floor });
  }
}

function swingStep(s: LiftState, h: number, p: number, co: ReturnType<typeof swingCoef>, ev: LiftEvent[]): void {
  const sw = s.swing!;
  const pumping = sw.pump > 0;
  const drive = pumping ? co.pump * (sw.vel !== 0 ? Math.sign(sw.vel) : 1) : 0;
  // вес игрока: на верхнем краю (p против крена) — затухание, на нижнем — раскачка
  const cp = co.kd * -p * Math.max(-1, Math.min(1, sw.phi / 0.05));
  // полунеявный Эйлер: сначала скорость, потом крен
  sw.vel += (-co.w * co.w * sw.phi - (co.c + cp) * sw.vel + drive) * h;
  sw.phi += sw.vel * h;
  sw.t += h;
  if (pumping) {
    sw.pump -= h;
    if (sw.pump <= 0) ev.push({ type: 'freed' });
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
  if (Math.floor(amp / SWAY_STEP) !== Math.floor(sw.ampEv / SWAY_STEP) || Math.floor(sw.t / SWAY_DT) > Math.floor(t0 / SWAY_DT)) {
    sw.ampEv = amp;
    ev.push({ type: 'sway', amp, phi: sw.phi });
  }
  if (sw.pump <= 0 && amp < LIFT_STEADY_AMP) {
    sw.calm += h;
    if (sw.calm >= LIFT_STEADY_S) {
      s.swing = null;
      s.phase = 'moving';
      ev.push({ type: 'steady' });
    }
  } else sw.calm = 0;
}
