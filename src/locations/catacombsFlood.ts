// Биом «Катакомбы» — наводнение без движка (tmp/catacombs-wip/CONTRACT.md §2): часы прилива, уровень воды, нарастание
// угрозы для звука и подсказок, замедление в воде и дыхание/здоровье игрока под водой. Стиль — как obshaga.ts (свет) /
// snowCollapse.ts: create → step(dt) → события. Всё состояние — простой JSON (без классов, функций, Infinity/NaN): хост
// коопа рассылает часы срезом toWire, клиенты досчитывают их сами (advanceRemote).
//
// Замысел заказчика: питерские катакомбы, которые периодически затапливает водой, — надо место, где переждать.
//  • Цикл n: штиль (calm: первый — firstCalmS, дальше calmS; бросок по сиду) → предупреждение (warn: гул, капель
//    чаще, вода ещё не поднимается) → подъём (rise: плавно до пика) → пик (peak: вода стоит, чуть «дышит») → спад
//    (ebb: плавно до луж) → штиль цикла n + 1. Длительности — только от сида и n (поток makeRng(seed + "/flood" + n)):
//    не зависят от шага кадров, клиент коопа знает их сам.
//  • Уровень — метры над полом сети (все проходы на z = 0): штиль calmM (лужи), пик peakM. Площадки убежищ — на
//    refugeM и выше: сухо даже на пике (с «дыханием» пик не выше peakM + peakWobbleM).
//  • Под водой (голова ниже уровня — решает интеграция) — воздух breathS секунд, потом тонет: −drownDps здоровья в
//    секунду, кончилось — смерть «утонул». Над водой воздух быстро возвращается; здоровье заживает через regenDelayS
//    без урона. После «Ещё раз» — graceS неуязвимости (reviveLungs).
//
// Звуки и подсказки интеграция берёт из событий stepFlood (входы в фазы), floodWarn (0…1 — громкость гула и рёва) и
// untilRise (сколько секунд до подъёма — «вода идёт!»).
import { makeRng } from '../model/rng';

/** Настройки биома (секунды, метры, HP). Диапазоны [min, max] — равномерно по сиду. */
export const CATACOMBS = {
  // ── часы прилива ──
  /** первый штиль после входа в биом, с: успеть осмотреться и найти убежище */
  firstCalmS: [70, 110] as [number, number],
  /** штиль между наводнениями, с */
  calmS: [110, 200] as [number, number],
  /** предупреждение: гул и рёв издалека, вода ещё не идёт, с */
  warnS: 20,
  /** подъём от луж до пика (ease-in-out), с */
  riseS: 32,
  /** пик: вода стоит, с */
  peakS: 25,
  /** спад до луж (ease-in-out), с */
  ebbS: 40,
  /** предвестник: последние столько секунд штиля floodWarn уже растёт до foreWarn (далёкий гул) */
  foreS: 10,
  /** floodWarn в конце штиля (= в начале предупреждения) */
  foreWarn: 0.15,
  // ── уровень ──
  /** штиль: лужи, м над полом сети */
  calmM: 0.06,
  /** пик, м */
  peakM: 2.0,
  /** площадки убежищ — не ниже, м (сухо на пике) */
  refugeM: 2.1,
  /** «дыхание» воды на пике: ± столько метров… */
  peakWobbleM: 0.02,
  /** …волной примерно такого периода, с (целое число волн за пик — уровень непрерывен на стыках) */
  peakWobbleS: 6,
  // ── дыхание и здоровье ──
  /** воздуха под водой, с (1 → 0) */
  breathS: 12,
  /** над водой воздух с нуля до полного за столько, с */
  refillS: 3,
  /** всплыл после стольких секунд под водой — громкий вдох ('breathe') */
  breatheAfterS: 3,
  /** воздух кончился — тонет: урон HP в секунду */
  drownDps: 10,
  /** событие 'hurt' (вспышка, хрип) — раз в столько секунд утопления, первое — сразу */
  hurtEveryS: 1,
  /** здоровье; без воздуха — hp / drownDps = 10 с до смерти */
  hp: 100,
  /** заживает через столько секунд без урона — по regenPerS в секунду (как общага: с нуля до полного ~33 с) */
  regenDelayS: 4,
  regenPerS: 3,
  /** после «Ещё раз» — неуязвимость, с: воздух под водой не убывает, урона нет */
  graceS: 6,
};

export type FloodPhase =
  /** штиль: лужи */
  | 'calm'
  /** предупреждение: гул, вода ещё не поднимается */
  | 'warn'
  /** вода поднимается */
  | 'rise'
  /** пик: вода стоит (убежища сухие) */
  | 'peak'
  /** вода уходит */
  | 'ebb';

/** Порядок фаз в цикле (индекс — фаза в проволоке FloodWire). */
export const FLOOD_PHASES: readonly FloodPhase[] = ['calm', 'warn', 'rise', 'peak', 'ebb'];

export interface FloodState {
  seed: string;
  /** номер цикла: наводнение n (0 — первое после входа) */
  n: number;
  phase: FloodPhase;
  /** время в фазе и её длительность, с */
  t: number;
  dur: number;
}

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const pos = (dt: number) => (fin(dt) && dt > 0 ? dt : 0);
const inRange = (r: readonly [number, number], u: number) => r[0] + (r[1] - r[0]) * u;
/** ease-in-out (smoothstep): 0 → 1, скорость на концах 0 — вода трогается и останавливается плавно */
const smooth = (u: number) => u * u * (3 - 2 * u);
/** Доля пройденной фазы 0…1. */
const frac = (s: FloodState) => (s.dur > 0 ? clamp(s.t / s.dur, 0, 1) : 1);

/** Длительности цикла n, с: штиль — поток makeRng(seed + "/flood" + n) (n = 0 — firstCalmS), прочее — константы. */
export function floodCycle(seed: string, n: number): Record<FloodPhase, number> {
  const C = CATACOMBS;
  const calm = inRange(n === 0 ? C.firstCalmS : C.calmS, makeRng(`${seed}/flood${n}`).next());
  return { calm, warn: C.warnS, rise: C.riseS, peak: C.peakS, ebb: C.ebbS };
}

/** Часы при входе в биом: штиль цикла 0. */
export function createFlood(seed: string): FloodState {
  return { seed, n: 0, phase: 'calm', t: 0, dur: floodCycle(seed, 0).calm };
}

/** Следующая фаза (после ebb — штиль цикла n + 1); t = 0. */
function nextPhase(s: FloodState) {
  const i = FLOOD_PHASES.indexOf(s.phase);
  const wrap = i < 0 || i === FLOOD_PHASES.length - 1;
  if (wrap) s.n++;
  s.phase = FLOOD_PHASES[wrap ? 0 : i + 1];
  s.t = 0;
  s.dur = floodCycle(s.seed, s.n)[s.phase];
}

/**
 * Шаг часов: calm → warn → rise → peak → ebb → calm следующего цикла. Возвращает фазы, в которые вошли за шаг, по
 * порядку (длинный dt проходит несколько фаз); границы фаз не зависят от дробления dt. NaN / отрицательный dt — 0.
 */
export function stepFlood(s: FloodState, dt: number): FloodPhase[] {
  const ev: FloodPhase[] = [];
  let rest = pos(dt);
  while (rest > 0) {
    const left = s.dur - s.t;
    if (rest < left) {
      s.t += rest;
      break;
    }
    rest -= Math.max(0, left);
    nextPhase(s);
    ev.push(s.phase);
  }
  return ev;
}

/**
 * Dev/QA: сразу в начало фазы to (по умолчанию — предупреждение): если она впереди в этом цикле — в этом, иначе — в
 * следующем. Возвращает [to]. Длительности следующих циклов не меняются (сид). Уровень воды при этом может скакнуть
 * (например, с пика в штиль) — это проверочный рычаг, не игра. В коопе — только у хоста (срез унесёт клиентам).
 */
export function forceFlood(s: FloodState, to: FloodPhase = 'warn'): FloodPhase[] {
  const i = FLOOD_PHASES.indexOf(to);
  if (i < 0) return [];
  if (i <= FLOOD_PHASES.indexOf(s.phase)) s.n++;
  s.phase = to;
  s.t = 0;
  s.dur = floodCycle(s.seed, s.n)[to];
  return [to];
}

/**
 * Уровень воды, м над полом сети (z = 0). Штиль и предупреждение — calmM; подъём — ease-in-out от calmM до peakM; пик —
 * peakM ± peakWobbleM («дышит»: целое число волн за пик под огибающей sin(πu) — на стыках ровно peakM и без излома);
 * спад — ease-in-out обратно до calmM. Непрерывен на всех стыках фаз; детерминирован от (phase, t, dur).
 */
export function floodLevel(s: FloodState): number {
  const C = CATACOMBS;
  const u = frac(s);
  switch (s.phase) {
    case 'calm':
    case 'warn':
      return C.calmM;
    case 'rise':
      return C.calmM + (C.peakM - C.calmM) * smooth(u);
    case 'peak': {
      const waves = Math.max(1, Math.round(s.dur / C.peakWobbleS));
      return C.peakM + C.peakWobbleM * Math.sin(Math.PI * u) * Math.sin(2 * Math.PI * waves * u);
    }
    case 'ebb':
      return C.peakM - (C.peakM - C.calmM) * smooth(u);
  }
}

/**
 * Нарастание угрозы 0…1 (громкость гула и рёва, подсказки): штиль — 0, последние foreS секунд штиля — слабый
 * предвестник до foreWarn; предупреждение — линейно foreWarn → 1; подъём и пик — 1; спад — вместе с водой 1 → 0.
 * Непрерывно на стыках.
 */
export function floodWarn(s: FloodState): number {
  const C = CATACOMBS;
  const u = frac(s);
  switch (s.phase) {
    case 'calm': {
      const k = s.t - (s.dur - C.foreS);
      return k > 0 ? C.foreWarn * clamp(k / C.foreS, 0, 1) : 0;
    }
    case 'warn':
      return C.foreWarn + (1 - C.foreWarn) * u;
    case 'rise':
    case 'peak':
      return 1;
    case 'ebb':
      return 1 - smooth(u);
  }
}

/** Секунды до начала подъёма текущего (штиль, предупреждение) или следующего (спад) цикла; 0 — подъём или пик идут. */
export function untilRise(s: FloodState): number {
  const left = Math.max(0, s.dur - s.t);
  switch (s.phase) {
    case 'calm':
      return left + floodCycle(s.seed, s.n).warn;
    case 'warn':
      return left;
    case 'rise':
    case 'peak':
      return 0;
    case 'ebb': {
      const c = floodCycle(s.seed, s.n + 1);
      return left + c.calm + c.warn;
    }
  }
}

/** Глубина, м → множитель скорости ходьбы: узлы кусочно-линейной функции (плато с короткими скатами, без скачков). */
export const WADE: readonly (readonly [depth: number, mul: number])[] = [
  [0.25, 1], // лужи и по щиколотку — как посуху
  [0.35, 0.75],
  [0.7, 0.75], // по колено
  [0.8, 0.55],
  [1.2, 0.55], // по пояс
  [1.3, 0.4], // по грудь и глубже (вплавь)
];

/** Множитель скорости по глубине воды у ног, м: 1 мельче 0.25; ~0.75 до 0.7; ~0.55 до 1.2; 0.4 глубже. Монотонно не
 *  возрастает, непрерывен; NaN / отрицательная глубина — 1. */
export function wadeMul(depth: number): number {
  if (!fin(depth) || depth <= WADE[0][0]) return WADE[0][1];
  for (let i = 1; i < WADE.length; i++) {
    const [d1, m1] = WADE[i];
    if (depth <= d1) {
      const [d0, m0] = WADE[i - 1];
      return m0 + (m1 - m0) * ((depth - d0) / (d1 - d0));
    }
  }
  return WADE[WADE.length - 1][1];
}

// ───────────────────────── дыхание ─────────────────────────

/** «Давно» для sinceHit (JSON без Infinity). */
const LONG_AGO = 1e6;
/** Допуск времени, с: воздух/здоровье, кончившиеся «почти ровно» к концу шага, кончились (дробление dt). */
const EPS = 1e-6;

/** Дыхание и здоровье игрока в катакомбах (у каждого своё; простой JSON). */
export interface Lungs {
  /** воздух 1 (полный) … 0 (кончился — тонет) */
  breath: number;
  /** здоровье 0…CATACOMBS.hp */
  hp: number;
  /** секунд без урона (заживление — после regenDelayS) */
  sinceHit: number;
  dead: boolean;
  /** причина смерти ('drown') или null */
  cause: string | null;
  /** под водой на прошлом шаге */
  under: boolean;
  /** секунд под водой в этом погружении (0 — над водой) */
  underS: number;
  /** секунд утопления (без воздуха) в этом погружении — такт событий 'hurt' */
  drownS: number;
  /** осталось неуязвимости, с */
  grace: number;
}

export type LungsEvent =
  /** ушёл под воду (бульк, глухой звук) */
  | 'gasp'
  /** воздух кончился (хрип, пузыри) */
  | 'choke'
  /** тонет: урон (красная вспышка), раз в hurtEveryS */
  | 'hurt'
  /** утонул (cause 'drown') */
  | 'dead'
  /** всплыл после ≥ breatheAfterS под водой (громкий вдох) */
  | 'breathe';

export function createLungs(): Lungs {
  return { breath: 1, hp: CATACOMBS.hp, sinceHit: LONG_AGO, dead: false, cause: null, under: false, underS: 0, drownS: 0, grace: 0 };
}

/** «Ещё раз»: полное здоровье и воздух, graceS неуязвимости. */
export function reviveLungs(l: Lungs): void {
  Object.assign(l, createLungs(), { grace: CATACOMBS.graceS });
}

/** s секунд без урона: счётчик sinceHit и заживление после regenDelayS (точно по времени — не зависит от дробления dt). */
function rest(l: Lungs, s: number) {
  if (s <= 0) return;
  const before = l.sinceHit;
  l.sinceHit = Math.min(LONG_AGO, before + s);
  const heal = l.sinceHit - Math.max(before, CATACOMBS.regenDelayS);
  if (heal > 0) l.hp = Math.min(CATACOMBS.hp, l.hp + CATACOMBS.regenPerS * heal);
}

/** s секунд над водой: воздух возвращается (refillS с нуля до полного). */
function refill(l: Lungs, s: number) {
  if (s > 0) l.breath = Math.min(1, l.breath + s / CATACOMBS.refillS);
}

/**
 * Шаг дыхания: under — голова под водой (решает интеграция: уровень floodLevel выше глаз). События по порядку:
 * 'gasp' — ушёл под воду (если воздуха уже нет — сразу и 'choke'); 'choke' — воздух кончился (breathS); дальше −drownDps
 * HP/с и 'hurt' в начале каждой hurtEveryS утопления; 'dead' — здоровье кончилось (cause 'drown', дальше шаги — пусто
 * до reviveLungs); 'breathe' — всплыл после ≥ breatheAfterS под водой. Над водой воздух возвращается за refillS.
 * Заживление — через regenDelayS без урона (и под водой, пока есть воздух). Неуязвимость (grace): воздух не убывает,
 * урона нет. Большой dt проходит всё по порядку; итог не зависит от дробления dt (с точностью до плавающей точки).
 */
export function stepLungs(l: Lungs, dt: number, under: boolean): LungsEvent[] {
  const ev: LungsEvent[] = [];
  if (l.dead) return ev;
  const C = CATACOMBS;
  let left = pos(dt);
  if (under && !l.under) {
    ev.push('gasp');
    l.under = true;
    l.underS = 0;
    l.drownS = 0;
    if (l.breath <= 0) ev.push('choke');
  } else if (!under && l.under) {
    if (l.underS >= C.breatheAfterS - EPS) ev.push('breathe');
    l.under = false;
    l.underS = 0;
    l.drownS = 0;
  }
  // неуязвимость: под водой воздух стоит, над водой возвращается; урона нет
  const g = Math.min(left, l.grace);
  if (g > 0) {
    l.grace = Math.max(0, l.grace - g);
    if (under) l.underS += g;
    else refill(l, g);
    rest(l, g);
    left -= g;
  }
  if (left <= 0) return ev;
  if (!under) {
    refill(l, left);
    rest(l, left);
    return ev;
  }
  l.underS += left;
  // воздух
  if (l.breath > 0) {
    const air = l.breath * C.breathS;
    if (left < air - EPS) {
      l.breath -= left / C.breathS;
      rest(l, left);
      return ev;
    }
    rest(l, air);
    l.breath = 0;
    ev.push('choke');
    left = Math.max(0, left - air);
    if (left <= EPS) return ev;
  }
  // тонет
  const toDeath = l.hp / C.drownDps;
  const d = Math.min(left, toDeath);
  const h = C.hurtEveryS;
  // такты 'hurt' — моменты k·h утопления в [drownS, drownS + d)
  const hurts = Math.ceil((l.drownS + d) / h - EPS) - Math.ceil(l.drownS / h - EPS);
  for (let k = 0; k < hurts; k++) ev.push('hurt');
  l.drownS += d;
  l.hp = Math.max(0, l.hp - C.drownDps * d);
  l.sinceHit = 0;
  if (left >= toDeath - EPS) {
    l.hp = 0;
    l.dead = true;
    l.cause = 'drown';
    ev.push('dead');
  }
  return ev;
}

// ───────────────────────── кооп ─────────────────────────

/** Срез часов для клиентов: индекс фазы (FLOOD_PHASES), номер цикла, время в фазе (с, сотые). */
export type FloodWire = [phase: number, n: number, t: number];

export function toWire(s: FloodState): FloodWire {
  return [Math.max(0, FLOOD_PHASES.indexOf(s.phase)), s.n, Math.round(s.t * 100) / 100];
}

/** Часы из среза хоста (толерантно: мусор — штиль цикла 0); длительность фазы — из floodCycle(seed, n). */
export function fromWire(seed: string, w: FloodWire): FloodState {
  const a: unknown[] = Array.isArray(w) ? w : [];
  const i = fin(a[0]) ? clamp(Math.floor(a[0]), 0, FLOOD_PHASES.length - 1) : 0;
  const n = fin(a[1]) ? clamp(Math.floor(a[1]), 0, 1e6) : 0;
  const phase = FLOOD_PHASES[i];
  const dur = floodCycle(seed, n)[phase];
  return { seed, n, phase, t: fin(a[2]) ? clamp(a[2], 0, dur) : 0, dur };
}

/**
 * Часы у клиента между рассылками хоста — как stepFlood (длительности фаз клиент знает по сиду, так что проходит
 * стыки фаз сам и совпадает с хостом), но БЕЗ событий: свежий срез хоста (fromWire) может откатить часы на доли секунды
 * назад, и события по шагам повторились бы. Звуки входа в фазы клиент берёт по росту floodOrd (phasesSince).
 */
export function advanceRemote(s: FloodState, dt: number): void {
  stepFlood(s, dt);
}

/** Порядковый номер фазы за всю историю часов: n · 5 + индекс фазы — монотонно растёт. */
export function floodOrd(s: FloodState): number {
  return s.n * FLOOD_PHASES.length + Math.max(0, FLOOD_PHASES.indexOf(s.phase));
}

/**
 * Фазы, в которые вошли после порядкового номера prev (не включая) до текущей включительно — не больше одного цикла
 * (последние 5). Клиент коопа: seen = floodOrd(s) при первом срезе; дальше каждый кадр
 * `for (ph of phasesSince(seen, s)) …; seen = Math.max(seen, floodOrd(s))` — откат часов срезом событий не повторит.
 */
export function phasesSince(prev: number, s: FloodState): FloodPhase[] {
  const ord = floodOrd(s);
  if (!fin(prev)) return [];
  const out: FloodPhase[] = [];
  for (let k = Math.max(Math.floor(prev) + 1, ord - FLOOD_PHASES.length + 1); k <= ord; k++) out.push(FLOOD_PHASES[k % FLOOD_PHASES.length]);
  return out;
}
