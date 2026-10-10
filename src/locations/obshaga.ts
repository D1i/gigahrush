// Биом «Общага» (советское общежитие) — механика без движка: отключения света, самозакрывающиеся двери, керосиновая
// лампа с защитным полем и Рука. Движок (Babylon в «Прогулке») подаёт время, положения игроков, кто на что смотрит и
// путь руки по своей навигации — и реагирует на события. Стиль контракта — как stairwell.ts / snowCollapse.ts:
// create → step(dt) → события. Всё состояние — простой JSON (без классов, функций, Infinity/NaN): хост коопа рассылает
// его как есть, клиенты рисуют через lightLevel / handView / doorOpenness.
//
// Замысел заказчика:
//  • Двери комнат игрок открывает сам; закрываются они сами через какое-то время — но только пока на них никто не
//    смотрит. Увидели посреди хода — дверь замирает, отвернулись — закрывается дальше.
//  • Время от времени свет моргает и резко гаснет. Позже свет возвращается.
//  • Керосиновую лампу можно взять: светит тускло-жёлтым и держит вокруг себя поле — рука в него не заходит и уползает
//    обратно в свою дверь, если идти на неё с лампой. Поле защищает всех рядом (кооп), не только того, кто несёт.
//  • В темноте из случайной двери, на которую игрок не смотрит, вылезает огромная рука — «растёт» из двери (длинная
//    рука тянется назад, к двери), заполняет весь коридор. НИ ЗВУКА. Ползёт вдвое медленнее игрока и только пока её не
//    видят (темно или отвернулся); увидели — замирает. Невидимая и близко — резко хватает и утаскивает за свою дверь:
//    смерть. Свет вернулся — руки нет.
//  • Ползком (C) можно забраться под кровать (и под стол — но там не спасает). Под кроватью рука схватить не может —
//    приползает к кровати и бьёт пальцем: тычок раз в pokePeriodS, медленно нанося урон (здоровье ведёт интеграция:
//    hp, pokeDmg, заживление). Палец, что уже достаёт, бьёт и под взглядом (взгляд останавливает только ползание).
//    Вылез из-под кровати рядом с невидимой рукой — обычная хватка. Кровать рука знает (HandPlayer.cover — её рамка):
//    кончик не заходит в рамку, расширенную на pokeStandM (кисть и упёртые пальцы остаются снаружи кровати, под неё
//    уходит только указательный), и тычет только снаружи неё; к свободному боку кровати руку ведёт навигация (goal).
//    Ближе не подойти (бока у стен, лежит глубоко от изножья) — указательный вытягивается до pokeMaxM от кончика.
//  • Рука бьёт одного: цель (HandState.target, aimHand) — один игрок, лучший по счёту «агро − путь, м»: агро — шум
//    шага (память шума по горизонтальной скорости: бег громче шага, ползком и лёжа — тихо, спадает за несколько
//    секунд), горящий фонарик, метка (предмет), прилипание к нынешней цели; при равном агро — ближайший. Цель держится,
//    пока другой не обгоняет её на aggroSwitchM дольше aggroSwitchS или сама не выбыла (лампа / поле лампы, нет в
//    списке — погиб или ушёл, недостижима); открытый игрок в GRAB_R невидимой кисти — цель сразу (касание — хватка).
//    Хватает и тычет только цель, к ней одной ведёт путь (HandView.target → handGoal). Кровати не-целей — не преграда:
//    рука ползёт поверх них (кисть и предплечье ложатся на матрас — рендер), упор кончика — только у кровати цели.
//
// Рука беззвучна по замыслу: события руки — для логики и картинки, своих звуков у неё нет и быть не должно (ни шороха,
// ни скрежета; крик/дыхание схваченного игрока — на усмотрение интеграции, но не звук самой руки).
//
// Координаты: план, метры (x, y), одна согласованная система для всех точек одного шага (как у stepCollapse).
// Расстояния — по прямой в плане: стены механика не знает (поле лампы проходит сквозь стены; руку по коридорам ведёт
// навигация интеграции через goal). room — непрозрачная метка экземпляра (порталы рендера): механика её только переносит.
import { hashSeed, makeRng } from '../model/rng';
import { hash01 } from './stairLoop';

/** Точка плана, м; room — метка экземпляра комнаты (непрозрачна для механики). */
export interface Pt {
  x: number;
  y: number;
  room?: string;
}

/** Настройки биома (секунды, метры, доли скорости игрока). Диапазоны [min, max] — равномерно по сиду. */
export const OBSHAGA = {
  // ── свет ──
  /** первое отключение после входа в биом, с: 25–45 с — успеть осмотреться, но и короткий забег встретит темноту */
  firstLitS: [25, 45],
  /** свет горит между отключениями, с */
  litS: [70, 150],
  /** моргание перед отключением, с */
  flickerS: [2.5, 4.5],
  /** последние столько секунд моргания — ровный полный накал («лампы вспыхнули») и резкий обрыв в 0 */
  surgeS: 0.3,
  /** темнота, с */
  darkS: [45, 75],
  /** возврат света: короткое моргание до ровного, с */
  returnS: 1,
  /** мигание — кусочно-постоянное, переключений в секунду (как в sceneLift: 22) */
  flickerHz: 18,
  // ── двери ──
  /** игрок открыл (E): распахивается за столько, с */
  doorOpenS: 0.8,
  /** стоит распахнутой, с — потом закрывается сама (если никто не смотрит и проём не занят) */
  doorHoldS: [6, 10],
  /** ход закрывания, с */
  doorCloseS: 1.4,
  // ── лампа ──
  /** радиус поля лампы, м: рука в него не заходит (не ближе 1 м к лампе — и палец тоже), игроки внутри не хватаются */
  lanternR: 1,
  /** радиус видимого света лампы, м (> поля: руку видно раньше, чем она упрётся в поле) */
  lanternLightR: 6,
  /** «касание» поля: рука отступает, если поле накрыло руку глубже этого, м (хорды следа на дуге поля — не касание) */
  fieldSlackM: 0.05,
  // ── рука ──
  /** вылезает из двери до проёма (door → mouth) за столько, с */
  emergeS: 1.5,
  /** ползёт со скоростью игрока × столько */
  handSpeedK: 0.5,
  /** отступает от лампы со скоростью игрока × столько (быстрее идущего на неё игрока) */
  retreatK: 1.2,
  /** отступив, держится дальше поля на столько, м, прежде чем снова ползти (без дребезга stalk/retreat) */
  retreatClearM: 0.5,
  /** хватает, если кончик ближе стольких метров к незащищённому игроку */
  grabR: 1.2,
  /** утаскивает за дверь со скоростью, м/с */
  dragSpeed: 5,
  /** события drag — при росте прогресса волочения на столько */
  dragStep: 0.1,
  /** длина руки не больше, м */
  armMaxM: 45,
  /** точки следа (тела руки) — через столько метров пути кончика */
  trailStepM: 0.25,
  // ── под кроватью ──
  /** игрок под кроватью ближе стольких метров к кончику (досягаемость указательного ~2 м от кисти) — рука дальше не
   *  ползёт, тычет: кисть и дуги пальцев остаются снаружи кровати (игрок — до ~0.5 м от её края), под неё уходит палец */
  pokeR: 2.2,
  /** кончик держится от рамки кровати (HandPlayer.cover) не ближе стольких метров (рамка, расширенная на столько во все
   *  стороны, — запретная зона кончика): ладонь, упёртые в пол пальцы и поднятая часть указательного в позе тычка — в
   *  круге 1.2 м у кончика (src/view3d/obshagaHand.ts, проверено тестом), под кровать уходят только дальние фаланги
   *  указательного ниже 0.2 м; досягаемость под кровать от её края — pokeR − pokeStandM ≈ 0.9 м (кровать — 0.8) */
  pokeStandM: 1.3,
  /** вытянутый указательный достаёт до стольких метров от кончика — тычет так, только если ближе не подойти (кровать
   *  известна; кончик пришёл к цели навигации или упёрся в зону кровати); дальше pokeR палец удлиняется сверх своей
   *  длины (рендер). 1.9 м кровать в нише (оба длинных бока у стен): лежащий до ~1.65 м от свободного торца + отступ
   *  pokeStandM + 0.08 (цель навигации) ≈ 3.03 м */
  pokeMaxM: 3.2,
  /** кровать «рядом» (HandView.bed), если кончик ближе pokeStandM + столько, м */
  bedNearM: 2.5,
  /** тычок пальцем раз в столько секунд */
  pokePeriodS: 1.4,
  /** удар — в этой доле цикла тычка (до него замах и выпад, после — палец медленно отходит) */
  pokeHitU: 0.55,
  /** здоровье игрока; тычок отнимает pokeDmg — без передышки убивают ⌈hp / pokeDmg⌉ тычков: 17 × 1.4 с ≈ 23 с */
  hp: 100,
  pokeDmg: 6,
  /** заживает через столько секунд без тычков — по hpRegenPerS в секунду (с нуля до полного ~33 с) */
  hpRegenDelayS: 4,
  hpRegenPerS: 3,
  // ── цель и агро (aimHand): счёт игрока = агро − путь от кончика, м ──
  /** шум шага по горизонтальной скорости, м/с (noiseOfSpeed): до noiseQuietV — 0 (ползком ~0.58, лёжа ~0.39; присед
   *  ~0.85 — почти тихо), шаг (noiseWalkV, стоя 1.7) — noiseWalk, бег (noiseRunV: шаг × RUN_MUL 1.7) — 1; быстрее —
   *  дальше по прямой, не больше noiseMax (предметы — HandPlayer.loud — в тех же единицах) */
  noiseQuietV: 0.7,
  noiseWalkV: 1.7,
  noiseWalk: 0.4,
  noiseRunV: 2.9,
  noiseMax: 2,
  /** память шума спадает как e^(−t / noiseTauS): через 3 с — ~30%, через 6 с — ~9% */
  noiseTauS: 2.5,
  /** агро, м «ближе»: шум × aggroNoiseM (бег — 5 м, шаг — 2), горящий фонарик — aggroLightM, метка (предмет) —
   *  aggroMarkM (сильнее любой разницы пути в карте руки), нынешняя цель — ещё aggroStickM (прилипание) */
  aggroNoiseM: 5,
  aggroLightM: 2.5,
  aggroMarkM: 15,
  aggroStickM: 1,
  /** смена цели: другой обгоняет цель (с её прилипанием) больше чем на aggroSwitchM — непрерывно aggroSwitchS, с */
  aggroSwitchM: 1,
  aggroSwitchS: 1.2,
  // ── режиссёр ──
  /** рука появляется через столько секунд после отключения */
  spawnDelayS: [1, 3],
  /** после withdrawn / killed — новая рука (из другой двери, рядом с игроком) через столько, с, если всё ещё темно */
  respawnS: [2, 4],
  /** дверь появления: путь до ближайшего игрока, м — лучше всего сзади или сбоку от него (SpawnCandidate.facing) */
  spawnDistM: [4, 9],
  /** запасная дверь — ближайшая невидимая не ближе стольких метров пути */
  spawnMinM: 3,
  /** дверь появления не ближе стольких метров к лампе (LANTERN_R + 1.5): рука вылезает рядом, но не в поле */
  spawnLanternM: 2.5,
  /** «сзади или сбоку»: косинус угла между взглядом ближайшего игрока и направлением на проём — не больше */
  spawnBehindCos: 0.3,
} as const;

/** Радиус поля лампы, м. */
export const LANTERN_R: number = OBSHAGA.lanternR;
/** Радиус видимого света лампы, м. */
export const LANTERN_LIGHT_R: number = OBSHAGA.lanternLightR;
/** Радиус захвата, м. */
export const GRAB_R: number = OBSHAGA.grabR;
/** Досягаемость тычка под кровать от кончика, м. */
export const POKE_R: number = OBSHAGA.pokeR;
/** Кончик держится от рамки кровати не ближе, м. */
export const POKE_STAND: number = OBSHAGA.pokeStandM;
/** Вытянутый указательный достаёт от кончика, м. */
export const POKE_MAX: number = OBSHAGA.pokeMaxM;

/** Прямоугольник плана, м (x0 < x1, y0 < y1) — рамка кровати (как Rect болванки, src/blockout/types.ts). */
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Рамка, расширенная на m во все стороны. */
export function expandRect(r: Rect, m: number): Rect {
  return { x0: r.x0 - m, y0: r.y0 - m, x1: r.x1 + m, y1: r.y1 + m };
}

/** Насколько точка вне рамки по худшей оси (Чебышёв), м: внутри — 0. «Ближе m» (< m) — то же, что внутри
 *  expandRect(r, m). */
export function rectGap(p: { x: number; y: number }, r: Rect): number {
  return Math.max(0, r.x0 - p.x, p.x - r.x1, r.y0 - p.y, p.y - r.y1);
}

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const pos = (dt: number) => (fin(dt) && dt > 0 ? dt : 0);
const inRange = (r: readonly [number, number], u: number) => r[0] + (r[1] - r[0]) * u;
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
/** Копия точки (room — только если задан: JSON без undefined). */
const pt = (p: Pt): Pt => (p.room === undefined ? { x: p.x, y: p.y } : { x: p.x, y: p.y, room: p.room });

/** Расстояние от p до отрезка ab. */
function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const u = l2 > 0 ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / l2, 0, 1) : 0;
  return Math.hypot(a.x + dx * u - p.x, a.y + dy * u - p.y);
}

// ───────────────────────── свет ─────────────────────────

export type BlackoutPhase =
  /** горит ровно */
  | 'lit'
  /** моргает перед отключением (рука ещё не вылезает) */
  | 'flicker'
  /** темно: время руки */
  | 'dark'
  /** свет возвращается: короткое моргание, руки уже нет */
  | 'return';

export interface BlackoutState {
  seed: string;
  /** числовой ключ мигания (hash01) */
  key: number;
  phase: BlackoutPhase;
  /** номер цикла: отключение n (0 — первое); цикл — lit → flicker → dark → return */
  n: number;
  /** время в фазе и её длительность, с */
  t: number;
  dur: number;
  /** время с входа в биом, с */
  time: number;
}

export type BlackoutEvent =
  /** свет заморгал; dur — сколько секунд до отключения */
  | { type: 'flicker'; n: number; dur: number }
  /** свет резко погас; dur — сколько секунд темноты */
  | { type: 'blackout'; n: number; dur: number }
  /** свет возвращается (рука исчезает в этот же миг) */
  | { type: 'lightsBack'; n: number };

/** Длительности цикла n: поток makeRng(seed + "/b" + n) — не зависят от шага кадров и от forceBlackout. */
export function blackoutCycle(seed: string, n: number): { lit: number; flicker: number; dark: number } {
  const R = makeRng(`${seed}/b${n}`);
  const lit = inRange(n === 0 ? OBSHAGA.firstLitS : OBSHAGA.litS, R.next());
  const flicker = inRange(OBSHAGA.flickerS, R.next());
  const dark = inRange(OBSHAGA.darkS, R.next());
  return { lit, flicker, dark };
}

/** Свет при входе в биом. opts.firstLitS — переопределить паузу до первого моргания (QA / повторный вход), с. */
export function createBlackout(seed: string, opts?: { firstLitS?: number }): BlackoutState {
  const first = opts && fin(opts.firstLitS) ? Math.max(0, opts.firstLitS) : blackoutCycle(seed, 0).lit;
  return { seed, key: hashSeed(`obshaga-light|${seed}`), phase: 'lit', n: 0, t: 0, dur: first, time: 0 };
}

function nextPhase(b: BlackoutState, ev: BlackoutEvent[]) {
  const c = blackoutCycle(b.seed, b.n);
  b.t = 0;
  switch (b.phase) {
    case 'lit':
      b.phase = 'flicker';
      b.dur = c.flicker;
      ev.push({ type: 'flicker', n: b.n, dur: b.dur });
      break;
    case 'flicker':
      b.phase = 'dark';
      b.dur = c.dark;
      ev.push({ type: 'blackout', n: b.n, dur: b.dur });
      break;
    case 'dark':
      b.phase = 'return';
      b.dur = OBSHAGA.returnS;
      ev.push({ type: 'lightsBack', n: b.n });
      break;
    case 'return':
      b.n++;
      b.phase = 'lit';
      b.dur = blackoutCycle(b.seed, b.n).lit;
      break;
  }
}

/**
 * Шаг света: lit (первый раз firstLitS, дальше litS) → flicker → dark → return (returnS) → lit следующего цикла.
 * Длинный dt проходит несколько фаз — события по порядку; границы фаз не зависят от дробления dt.
 */
export function stepBlackout(b: BlackoutState, dt: number): BlackoutEvent[] {
  const ev: BlackoutEvent[] = [];
  let rest = pos(dt);
  while (rest > 0) {
    const left = b.dur - b.t;
    if (rest < left) {
      b.t += rest;
      b.time += rest;
      break;
    }
    const used = Math.max(0, left);
    b.time += used;
    rest -= used;
    nextPhase(b, ev);
  }
  return ev;
}

/** Dev/QA: сразу заморгать (из lit; из return — следующий цикл). В flicker / dark — ничего. */
export function forceBlackout(b: BlackoutState): BlackoutEvent[] {
  if (b.phase === 'flicker' || b.phase === 'dark') return [];
  if (b.phase === 'return') b.n++;
  b.phase = 'lit';
  const ev: BlackoutEvent[] = [];
  nextPhase(b, ev);
  return ev;
}

/** Горит ли свет (для руки): всё, кроме темноты. */
export function lightsOn(b: BlackoutState): boolean {
  return b.phase !== 'dark';
}

/**
 * Общий множитель ламп биома 0…1 (умножать на lampLevel / накал конкретной лампы).
 * lit — 1; flicker — кусочно-постоянное мигание (hash01, flickerHz), провалов всё больше к концу, последние surgeS —
 * ровный полный накал, затем РЕЗКО 0 (dark); return — первая вспышка сразу, потом мигание всё реже до ровного 1.
 */
export function lightLevel(b: BlackoutState): number {
  const { t, dur } = b;
  const k = Math.floor(t * OBSHAGA.flickerHz);
  switch (b.phase) {
    case 'lit':
      return 1;
    case 'dark':
      return 0;
    case 'flicker': {
      const surge = Math.min(OBSHAGA.surgeS, dur * 0.5);
      if (t >= dur - surge) return 1;
      const u = clamp(t / Math.max(1e-6, dur - surge), 0, 1);
      if (hash01(b.key, b.n, k) < 0.25 + 0.45 * u) return 0.05;
      return 0.6 + 0.4 * hash01(b.key, b.n, k, 1);
    }
    case 'return': {
      if (t < 0.1) return 1;
      const u = clamp(t / Math.max(1e-6, dur), 0, 1);
      return hash01(b.key, b.n, k, 2) < 0.55 * (1 - u) ? 0.05 : 1;
    }
  }
}

// ───────────────────────── двери ─────────────────────────

export type DoorPhase =
  | 'closed'
  /** игрок открыл: распахивается (doorOpenS) */
  | 'opening'
  /** распахнута: ждёт closeAfter */
  | 'open'
  /** закрывается сама (doorCloseS) */
  | 'closing'
  /** замерла посреди хода: на неё смотрят или проём занят */
  | 'paused';

export interface DoorState {
  seed: string;
  phase: DoorPhase;
  /** открытость 0 (закрыта) … 1 (распахнута) — интеграция переводит в угол створки */
  open: number;
  /** сколько уже стоит распахнутой, с */
  held: number;
  /** через сколько секунд распахнутая закроется (бросок на каждое открытие) */
  closeAfter: number;
  /** сколько раз открывали (под-сид closeAfter) */
  opens: number;
}

export type DoorEvent =
  /** пошла закрываться (или продолжила после паузы) */
  | 'closing'
  /** закрылась (щелчок замка) */
  | 'closed'
  /** замерла посреди хода — увидели или проём занят */
  | 'paused';

/** Пауза распахнутой двери перед закрыванием, открытие k: makeRng(seed + "/o" + k), в doorHoldS. */
export function doorCloseAfter(seed: string, k: number): number {
  return inRange(OBSHAGA.doorHoldS, makeRng(`${seed}/o${k}`).next());
}

export function createDoor(seed: string): DoorState {
  return { seed, phase: 'closed', open: 0, held: 0, closeAfter: doorCloseAfter(seed, 0), opens: 0 };
}

/**
 * Игрок открыл дверь (E) — можно в любой момент: закрытая и закрывающаяся распахиваются (ход — в stepDoor), уже
 * распахнутая ждёт заново. Каждое открытие — новый бросок closeAfter. Уже распахивается — ничего (false).
 */
export function openDoor(d: DoorState): boolean {
  if (d.phase === 'opening') return false;
  d.closeAfter = doorCloseAfter(d.seed, d.opens);
  d.opens++;
  d.held = 0;
  d.phase = d.open >= 1 ? 'open' : 'opening';
  return true;
}

/**
 * Шаг двери. seen — на дверь смотрит хоть кто-то из игроков; blocked — в проёме/на ходу створки кто-то стоит (или
 * рука). Распахивание не зависит от взглядов. Распахнутая ждёт closeAfter (время идёт и под взглядом), затем
 * закрывается, только пока !seen && !blocked; увидели посреди хода — 'paused', отвернулись — 'closing' дальше.
 */
export function stepDoor(d: DoorState, dt: number, look: { seen: boolean; blocked: boolean }): DoorEvent[] {
  const ev: DoorEvent[] = [];
  let rest = pos(dt);
  const free = !look.seen && !look.blocked;
  if (d.phase === 'opening') {
    const need = (1 - d.open) * OBSHAGA.doorOpenS;
    if (rest < need) {
      d.open += rest / OBSHAGA.doorOpenS;
      return ev;
    }
    d.open = 1;
    d.phase = 'open';
    d.held = 0;
    rest -= need;
  }
  if (d.phase === 'open') {
    const need = Math.max(0, d.closeAfter - d.held);
    if (rest < need || !free) {
      d.held += rest;
      return ev;
    }
    d.held += need;
    rest -= need;
    d.phase = 'closing';
    ev.push('closing');
  } else if (d.phase === 'paused') {
    if (!free) return ev;
    d.phase = 'closing';
    ev.push('closing');
  }
  if (d.phase === 'closing') {
    if (!free) {
      d.phase = 'paused';
      ev.push('paused');
      return ev;
    }
    const need = d.open * OBSHAGA.doorCloseS;
    if (rest < need) {
      d.open -= rest / OBSHAGA.doorCloseS;
      return ev;
    }
    d.open = 0;
    d.held = 0;
    d.phase = 'closed';
    ev.push('closed');
  }
  return ev;
}

// ───────────────────────── лампа ─────────────────────────

/** Защищена ли точка полем хоть одной лампы (строго ближе LANTERN_R; поле — для всех, не только для несущего). */
export function isProtected(p: Pt, lanterns: readonly Pt[]): boolean {
  for (const l of lanterns) if (dist(p, l) < LANTERN_R) return true;
  return false;
}

/** Освещена ли точка лампой (LANTERN_LIGHT_R) — подсказка интеграции для «видно ли руку в темноте». */
export function inLanternLight(p: Pt, lanterns: readonly Pt[]): boolean {
  for (const l of lanterns) if (dist(p, l) < LANTERN_LIGHT_R) return true;
  return false;
}

/** Предмет «керосиновая лампа» (src/data/items.ts): поле даёт и в руке (выбрана в хотбаре), и стоящая на полу. */
export const KEROLAMP_ITEM = 'it_kerolamp';

/** Лежащий предмет «Прогулки» (WorldDrop, src/gen4d/stream.ts): мировая Babylon — X = план x, Z = −план y; inst — комната. */
export interface FloorItem {
  item: string;
  inst: string;
  x: number;
  z: number;
  /** горит ли (лампа: false — кончился керосин, поля нет); нет поля — горит */
  on?: boolean;
}

/** Лампы на полу — точки поля в плане (лежащие KEROLAMP_ITEM, кроме погасших: on === false); inRoom — только эти
 *  комнаты (прочие не в счёт). У всех копий мира (кооп) список предметов один — поле у хоста и у клиентов одно. */
export function floorLanterns(drops: readonly FloorItem[], inRoom?: (room: string) => boolean): Pt[] {
  const out: Pt[] = [];
  for (const d of drops) if (d.item === KEROLAMP_ITEM && d.on !== false && (!inRoom || inRoom(d.inst))) out.push({ x: d.x, y: -d.z, room: d.inst });
  return out;
}

// ───────────────────────── рука ─────────────────────────

export type HandPhase =
  /** растёт из двери к проёму (door → mouth) */
  | 'emerging'
  /** ползёт кончиком к goal, пока не видят; увидели — замерла */
  | 'stalking'
  /** поле лампы накрыло руку — втягивается кончиком вперёд, пока не очистится */
  | 'retreating'
  /** схватила: тащит жертву по своему следу за дверь */
  | 'grabbing'
  /** втянулась в дверь целиком (лампа загнала) — ушла */
  | 'withdrawn'
  /** исчезла (свет) или утащила жертву */
  | 'gone';

export interface HandState {
  seed: string;
  phase: HandPhase;
  /** точка за дверью (внутри комнаты) — корень руки */
  door: Pt;
  /** проём двери в коридоре — докуда рука вырастает в emerging */
  mouth: Pt;
  /** тело руки: trail[0] — дверь, дальше точки через ~trailStepM пути кончика; сам кончик — tip (в trail не входит) */
  trail: Pt[];
  tip: Pt;
  /** путь кончика с последней точки следа, м */
  lay: number;
  /** куда смотрит кисть (последнее направление роста), рад, atan2(dy, dx) */
  heading: number;
  /** вылезание 0…1 (после полного — всегда 1) */
  emerge: number;
  /** время в фазе, с */
  t: number;
  /** замерла под взглядом */
  frozen: boolean;
  /** упёрлась в поле лампы */
  blocked: boolean;
  /** схваченный игрок (grabbing) */
  victim: string | null;
  /** длина руки в момент захвата, м; прогресс волочения 0…1 */
  dragLen: number;
  drag: number;
  /** тычет пальцем под кровать (stalking): кого (null — никого), время в цикле тычка, с (0…pokePeriodS), куда — точка
   *  игрока под кроватью */
  poke: string | null;
  pokeT: number;
  pokeAt: Pt | null;
  /** кровать рядом (stalking): рамка кровати цели (лежит под ней), если кончик ближе pokeStandM + bedNearM к ней
   *  (рендер заранее подбирает пальцы — не лезут в неё на подходе); нет поля (старый срез) — null */
  bed?: Rect | null;
  /** цель (aimHand): id игрока, которого рука хватает или тычет, — одна; null — нет годных (все с лампой / в поле) */
  target?: string | null;
  /** кто обгоняет цель на aggroSwitchM и сколько секунд подряд (смена — через aggroSwitchS) */
  rival?: string | null;
  rivalT?: number;
}

export interface HandPlayer {
  id: string;
  p: Pt;
  /** защищён сам по себе (несёт лампу и т.п.); поле чужих ламп механика проверяет и сама по lanterns */
  protected: boolean;
  /** видит руку (в кадре, на линии взгляда и освещена — лампой/фонарём) */
  sees: boolean;
  /** под кроватью: не хватается — рука тычет пальцем (не путать с protected: тот — ещё и поле лампы у интеграции) */
  sheltered?: boolean;
  /** под какой кроватью (рамка на плане, вместе с sheltered): кончик не заходит ближе pokeStandM к ней (по худшей оси —
   *  rectGap) и тычет только оттуда — если это цель; кровати прочих — не преграда; нет — тычет, откуда достаёт */
  cover?: Rect;
  // ── агро (aimHand; всё необязательно — нет: тихо, без света, путь по прямой) ──
  /** горизонтальная скорость, м/с — хост меряет у всех одинаково, по смещениям; шум шага — noiseOfSpeed */
  speed?: number;
  /** добавочный шум (предметы), в единицах шума: 1 — бег */
  loud?: number;
  /** память шума 0…noiseMax (режиссёр подставляет свою, stepNoise); шум сейчас — не меньше speed / loud */
  noise?: number;
  /** горит фонарик */
  light?: boolean;
  /** помечен (предмет): +aggroMarkM — рука выбирает его */
  marked?: boolean;
  /** путь от кончика по навигации, м; null — не дойти (не цель); нет — по прямой */
  dist?: number | null;
}

export interface HandInput {
  /** свет горит (lightsOn(blackout)) — рука исчезает */
  lightsOn: boolean;
  /** руку видит хоть кто-то (обычно players.some(p => p.sees)) */
  seen: boolean;
  /** следующая точка пути кончика к цели (HandView.target; навигация интеграции, видна по прямой); null — стоять */
  goal: Pt | null;
  players: readonly HandPlayer[];
  /** где лампы (у кого бы ни были, в том числе стоящие на полу) */
  lanterns: readonly Pt[];
  /** скорость ходьбы игрока, м/с */
  playerSpeed: number;
  /** цель в этом шаге уже выбрана (aimHand до goal — так делает stepDirector); нет — stepHand выбирает сам */
  aimed?: boolean;
}

export type HandEvent =
  /** вылезла до проёма (дальше ползёт) */
  | { type: 'emerged' }
  /** поле лампы накрыло руку — втягивается */
  | { type: 'retreat' }
  /** поле позади — снова ползёт (или дорастает до проёма) */
  | { type: 'stalk' }
  /** втянулась в дверь целиком */
  | { type: 'withdrawn' }
  /** схватила игрока */
  | { type: 'grab'; victim: string }
  /** тащит: прогресс 0…1 (раз в dragStep) */
  | { type: 'drag'; victim: string; progress: number }
  /** утащила за дверь — смерть */
  | { type: 'killed'; victim: string }
  /** отпустила (свет или поле лампы во время волочения) */
  | { type: 'released'; victim: string }
  /** ткнула пальцем игрока под кроватью (раз в pokePeriodS; урон — у интеграции) */
  | { type: 'poke'; victim: string }
  /** исчезла: вернулся свет */
  | { type: 'vanish' };

/** Рука растёт из двери: door — точка за дверью (в комнате), mouth — проём в коридоре. */
export function createHand(seed: string, door: Pt, mouth: Pt): HandState {
  const near = dist(door, mouth) < 1e-6;
  return {
    seed,
    phase: near ? 'stalking' : 'emerging',
    door: pt(door),
    mouth: pt(mouth),
    trail: [pt(door)],
    tip: pt(near ? mouth : door),
    lay: 0,
    heading: Math.atan2(mouth.y - door.y, mouth.x - door.x),
    emerge: near ? 1 : 0,
    t: 0,
    frozen: false,
    blocked: false,
    victim: null,
    dragLen: 0,
    drag: 0,
    poke: null,
    pokeT: 0,
    pokeAt: null,
    bed: null,
    target: null,
    rival: null,
    rivalT: 0,
  };
}

/** Тело руки ломаной: дверь … кончик (кончик — последняя точка). */
export function armPoints(h: HandState): Pt[] {
  return [...h.trail, h.tip];
}

/** Длина руки по ломаной следа, м. */
export function armLength(h: HandState): number {
  let s = 0;
  let a = h.trail[0];
  for (let i = 1; i < h.trail.length; i++) {
    s += dist(a, h.trail[i]);
    a = h.trail[i];
  }
  return s + dist(a, h.tip);
}

/** Насколько рука глубже/дальше полей ламп: min по лампам (расстояние до ломаной руки) − LANTERN_R; ламп нет — +∞. */
function fieldGap(h: HandState, lanterns: readonly Pt[]): number {
  let best = Infinity;
  for (const l of lanterns) {
    let a = h.trail[0];
    for (let i = 1; i <= h.trail.length; i++) {
      const b = i < h.trail.length ? h.trail[i] : h.tip;
      best = Math.min(best, segDist(l, a, b));
      a = b;
    }
  }
  return best - LANTERN_R;
}

/** Зазор у поля при упоре, м (кончик останавливается чуть снаружи). */
const FIELD_EPS = 1e-6;

/**
 * Сколько можно пройти из p по (ux, uy), не входя в рамку r, расширенную на m (открытая: скольжение по грани — не
 * вход), — не больше s. Уже внутри — только наружу: шаг, после которого кончик ближе к рамке (rectGap), — 0.
 */
function bedStop(p: Pt, ux: number, uy: number, s: number, r: Rect, m: number): number {
  const g0 = rectGap(p, r);
  if (g0 < m) return rectGap({ x: p.x + ux * s, y: p.y + uy * s }, r) >= g0 - 1e-9 ? s : 0;
  const e = expandRect(r, m);
  let t0 = 0, t1 = s;
  for (const [o, u, lo, hi] of [[p.x, ux, e.x0, e.x1], [p.y, uy, e.y0, e.y1]] as const) {
    if (Math.abs(u) < 1e-12) {
      if (o <= lo || o >= hi) return s;
      continue;
    }
    const a = (lo - o) / u, b = (hi - o) / u;
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
  }
  return t1 - t0 > 1e-9 ? Math.max(0, t0 - FIELD_EPS) : s;
}

/**
 * Кончик — к target по прямой на d метров (не дальше target), не входя в поля ламп (упор на границе), в рамки кроватей
 * beds, расширенные на pokeStandM (упор на границе; уже внутри — только наружу), и не длиннее armMaxM. Точки следа —
 * через trailStepM пути. Возвращает пройденное, м.
 */
function advance(h: HandState, target: Pt, d: number, lanterns: readonly Pt[], beds: readonly Rect[] = []): number {
  h.blocked = false;
  const dx = target.x - h.tip.x, dy = target.y - h.tip.y;
  const L = Math.hypot(dx, dy);
  if (L < 1e-9 || !(d > 0)) return 0;
  const ux = dx / L, uy = dy / L;
  let s = Math.min(d, L, Math.max(0, OBSHAGA.armMaxM - armLength(h)));
  for (const r of beds) s = bedStop(h.tip, ux, uy, s, r, OBSHAGA.pokeStandM);
  for (const l of lanterns) {
    const px = h.tip.x - l.x, py = h.tip.y - l.y;
    const b = ux * px + uy * py;
    const c = px * px + py * py - LANTERN_R * LANTERN_R;
    if (b >= 0) continue; // от лампы (или по касательной) — поле не мешает
    if (c <= 0) {
      // уже в поле (лампа пришла сама, мельче fieldSlackM) — к лампе ни шагу, отступление решает stepHand
      s = 0;
      h.blocked = true;
      break;
    }
    const disc = b * b - c;
    if (disc <= 0) continue;
    const enter = -b - Math.sqrt(disc);
    if (enter < s + FIELD_EPS) {
      s = Math.max(0, enter - FIELD_EPS);
      h.blocked = true;
    }
  }
  if (s <= 0) return 0;
  const reached = s >= L - 1e-9;
  if (target.room !== undefined) h.tip.room = target.room;
  h.heading = Math.atan2(uy, ux);
  let rest = s;
  while (rest > 0) {
    const need = OBSHAGA.trailStepM - h.lay;
    if (rest < need) {
      h.tip.x += ux * rest;
      h.tip.y += uy * rest;
      h.lay += rest;
      break;
    }
    h.tip.x += ux * need;
    h.tip.y += uy * need;
    rest -= need;
    h.lay = 0;
    h.trail.push(pt(h.tip));
  }
  if (reached) {
    h.tip.x = target.x;
    h.tip.y = target.y;
  }
  return s;
}

/** Втянуть руку кончиком вперёд по следу на d метров. true — кончик у двери (рука втянулась целиком). */
function retract(h: HandState, d: number): boolean {
  let rest = d;
  while (rest > 0) {
    const last = h.trail[h.trail.length - 1];
    const seg = dist(h.tip, last);
    if (rest < seg) {
      const k = rest / seg;
      h.tip.x += (last.x - h.tip.x) * k;
      h.tip.y += (last.y - h.tip.y) * k;
      break;
    }
    rest -= seg;
    h.tip = pt(last);
    if (h.trail.length === 1) break;
    h.trail.pop();
  }
  h.lay = dist(h.trail[h.trail.length - 1], h.tip);
  return h.trail.length === 1 && h.lay < 1e-9;
}

// ── цель и агро ──

/** Шум шага по горизонтальной скорости v, м/с (OBSHAGA.noise*): тише noiseQuietV — 0, шаг — noiseWalk, бег — 1. */
export function noiseOfSpeed(v: number): number {
  const { noiseQuietV: q, noiseWalkV: w, noiseRunV: r, noiseWalk: nw, noiseMax } = OBSHAGA;
  if (!fin(v) || v <= q) return 0;
  if (v <= w) return (nw * (v - q)) / (w - q);
  return Math.min(noiseMax, nw + ((1 - nw) * (v - w)) / (r - w));
}

/** Шум игрока сейчас: шаг (speed) + предметы (loud), не меньше заданной памяти noise; 0…noiseMax. */
function noiseNow(pl: HandPlayer): number {
  const s = fin(pl.speed) ? noiseOfSpeed(pl.speed) : 0;
  const l = fin(pl.loud) && pl.loud > 0 ? pl.loud : 0;
  const n = fin(pl.noise) && pl.noise > 0 ? pl.noise : 0;
  return clamp(Math.max(n, s + l), 0, OBSHAGA.noiseMax);
}

/**
 * Память шума за шаг dt: у каждого из players — max(шум сейчас, прошлое × e^(−dt / noiseTauS)): громкий шаг слышен
 * сразу, тишина — спадает за несколько секунд; при неизменном шуме дробление dt итога не меняет. Ушедших из списка нет
 * (состояние маленькое), почти ноль не хранится.
 */
export function stepNoise(mem: Readonly<Record<string, number>>, dt: number, players: readonly HandPlayer[]): Record<string, number> {
  const k = Math.exp(-pos(dt) / OBSHAGA.noiseTauS);
  const out: Record<string, number> = {};
  for (const pl of players) {
    const m = Math.max(noiseNow(pl), memOf(mem, pl.id) * k);
    if (m >= 1e-4) out[pl.id] = m;
  }
  return out;
}

/** Память шума игрока id (нет — 0). */
export function memOf(mem: Readonly<Record<string, number>> | undefined, id: string): number {
  return mem && Object.prototype.hasOwnProperty.call(mem, id) && fin(mem[id]) ? mem[id] : 0;
}

/** Агро игрока, м «ближе»: шум × aggroNoiseM + фонарик aggroLightM + метка aggroMarkM (без прилипания к цели). */
export function aggroOf(pl: HandPlayer): number {
  return noiseNow(pl) * OBSHAGA.aggroNoiseM + (pl.light ? OBSHAGA.aggroLightM : 0) + (pl.marked ? OBSHAGA.aggroMarkM : 0);
}

/** Годится в цели: не с лампой, не в поле ламп, достижим (dist не null). */
function validTarget(pl: HandPlayer, lanterns: readonly Pt[]): boolean {
  if (pl.protected || isProtected(pl.p, lanterns)) return false;
  return pl.dist === undefined || fin(pl.dist);
}

/** Счёт игрока для руки h, м: агро (+ aggroStickM, если он — цель) − путь от кончика (dist; нет — по прямой). */
export function targetScore(h: HandState, pl: HandPlayer): number {
  const d = fin(pl.dist) ? pl.dist : dist(h.tip, pl.p);
  return aggroOf(pl) + (pl.id === h.target ? OBSHAGA.aggroStickM : 0) - d;
}

/**
 * Цель руки (h.target) на шаг dt — одна:
 *  • годны (validTarget): не с лампой, не в поле ламп, достижимы; цель выбыла (нет в списке — погиб, ушёл; взял лампу;
 *    недостижима) — сразу лучшая по targetScore (равный счёт — меньший id); годных нет — null;
 *  • касание: невидимая кисть (stalking) в GRAB_R от открытого (не под кроватью) годного — он цель сразу (ближайший),
 *    если цель — не такой же;
 *  • иначе цель держится: другой лучший сменит её, только обгоняя (её счёт — с aggroStickM) больше чем на aggroSwitchM
 *    непрерывно aggroSwitchS (обгоняющий сменился — отсчёт заново).
 * В grabbing (цель — жертва), withdrawn и gone — ничего.
 */
export function aimHand(h: HandState, dt: number, input: HandInput): void {
  if (h.phase === 'grabbing' || h.phase === 'withdrawn' || h.phase === 'gone') return;
  const ok = input.players.filter((pl) => validTarget(pl, input.lanterns));
  const cur = ok.find((pl) => pl.id === h.target) ?? null;
  const set = (id: string | null) => {
    h.target = id;
    h.rival = null;
    h.rivalT = 0;
  };
  if (!input.seen && h.phase === 'stalking') {
    const touch = (pl: HandPlayer) => !pl.sheltered && dist(h.tip, pl.p) <= GRAB_R;
    if (!(cur && touch(cur))) {
      let c: HandPlayer | null = null;
      let cd = Infinity;
      for (const pl of ok) {
        if (!touch(pl)) continue;
        const d = dist(h.tip, pl.p);
        if (d < cd || (d === cd && c && pl.id < c.id)) (c = pl), (cd = d);
      }
      if (c) return set(c.id);
    }
  }
  let best: HandPlayer | null = null;
  let bs = -Infinity;
  for (const pl of ok) {
    if (pl === cur) continue;
    const s = targetScore(h, pl);
    if (s > bs + 1e-9 || (Math.abs(s - bs) <= 1e-9 && best && pl.id < best.id)) (best = pl), (bs = s);
  }
  if (!cur) return set(best ? best.id : null);
  if (best && bs > targetScore(h, cur) + OBSHAGA.aggroSwitchM) {
    if (h.rival !== best.id) (h.rival = best.id), (h.rivalT = 0);
    h.rivalT = (fin(h.rivalT) ? h.rivalT : 0) + pos(dt);
    if (h.rivalT >= OBSHAGA.aggroSwitchS - 1e-9) set(best.id);
  } else {
    h.rival = null;
    h.rivalT = 0;
  }
}

/** Цель среди игроков шага — если ещё годна (иначе null: ни хватки, ни тычка до следующего aimHand). */
function targetOf(h: HandState, input: HandInput): HandPlayer | null {
  if (h.target == null) return null;
  const pl = input.players.find((x) => x.id === h.target);
  return pl && validTarget(pl, input.lanterns) ? pl : null;
}

/** Кого хватает: цель, если она открыта (не под кроватью) и ближе GRAB_R к кончику. */
function pickVictim(h: HandState, T: HandPlayer | null): string | null {
  return T && !T.sheltered && dist(h.tip, T.p) <= GRAB_R ? T.id : null;
}

/**
 * Кого тычет: цель T под кроватью — в той же комнате, что кончик (если обе метки есть: сквозь стену палец не достаёт —
 * рука ползёт по пути дальше, в комнату); кровать известна (cover) — кончик не ближе pokeStandM к её рамке (иначе кисть
 * и пальцы легли бы на кровать); отрезок кончик → игрок не задевает поле лампы (палец — тоже рука). Ближе POKE_R —
 * тычет; до pokeMaxM — палец вытягивается, только если кровать известна и ближе не подойти: goal нет, кончик в нём или
 * шаг к нему упирается в зону кровати.
 */
function pokeTarget(h: HandState, input: HandInput, T: HandPlayer | null): HandPlayer | null {
  if (!T || !T.sheltered) return null;
  if (T.p.room !== undefined && h.tip.room !== undefined && T.p.room !== h.tip.room) return null;
  if (T.cover && rectGap(h.tip, T.cover) < OBSHAGA.pokeStandM - 1e-4) return null;
  const d = dist(h.tip, T.p);
  if (d > POKE_MAX) return null;
  for (const l of input.lanterns) if (segDist(l, h.tip, T.p) < LANTERN_R) return null;
  if (d <= POKE_R) return T;
  if (!T.cover) return null;
  const g = input.goal;
  const L = g ? dist(h.tip, g) : 0;
  if (!g || L <= 1e-3) return T;
  return bedStop(h.tip, (g.x - h.tip.x) / L, (g.y - h.tip.y) / L, Math.min(L, 0.05), T.cover, OBSHAGA.pokeStandM) <= 1e-6 ? T : null;
}

/** Цикл тычка на rest секунд: 'poke' в момент удара (pokeHitU цикла); новая жертва — цикл с начала. */
function pokeStep(h: HandState, pl: HandPlayer, rest: number, ev: HandEvent[]) {
  const P = OBSHAGA.pokePeriodS, hit = OBSHAGA.pokeHitU * P;
  if (h.poke !== pl.id) {
    h.poke = pl.id;
    h.pokeT = 0;
  }
  h.pokeAt = pt(pl.p);
  let t = h.pokeT;
  let r = rest;
  for (;;) {
    const toHit = (t < hit ? hit : P + hit) - t;
    if (r < toHit) {
      t += r;
      break;
    }
    r -= toHit;
    t = hit;
    ev.push({ type: 'poke', victim: pl.id });
  }
  h.pokeT = t >= P ? t - P : t;
}

function endPoke(h: HandState) {
  h.poke = null;
  h.pokeT = 0;
  h.pokeAt = null;
}

/** Кровать рядом: рамка кровати цели (лежит под ней) в pokeStandM + bedNearM от кончика; нет — null. */
function nearBed(h: HandState, T: HandPlayer | null): Rect | null {
  const b = T && T.sheltered ? T.cover : undefined;
  return b && rectGap(h.tip, b) < OBSHAGA.pokeStandM + OBSHAGA.bedNearM ? { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 } : null;
}

function vanish(h: HandState, ev: HandEvent[]): HandEvent[] {
  if (h.victim !== null) ev.push({ type: 'released', victim: h.victim });
  h.victim = null;
  h.phase = 'gone';
  h.frozen = false;
  h.blocked = false;
  h.t = 0;
  endPoke(h);
  h.bed = null;
  h.target = h.rival = null;
  h.rivalT = 0;
  ev.push({ type: 'vanish' });
  return ev;
}

function toRetreat(h: HandState, ev: HandEvent[]) {
  h.phase = 'retreating';
  h.t = 0;
  h.frozen = false;
  h.blocked = false;
  endPoke(h);
  h.bed = null;
  ev.push({ type: 'retreat' });
}

function toGrab(h: HandState, victim: string, ev: HandEvent[]) {
  h.phase = 'grabbing';
  h.victim = victim;
  h.target = victim;
  h.rival = null;
  h.rivalT = 0;
  h.dragLen = armLength(h);
  h.drag = 0;
  h.t = 0;
  h.frozen = false;
  h.blocked = false;
  endPoke(h);
  h.bed = null;
  ev.push({ type: 'grab', victim });
}

/**
 * Шаг руки. Мутирует состояние, возвращает события (ни одного звукового — рука беззвучна).
 *
 *  • lightsOn — сразу 'vanish' → gone (тащила — сначала 'released').
 *  • emerging: кончик растёт door → mouth за emergeS (только пока не видят), дорос — 'emerged' → stalking.
 *  • Цель — aimHand в начале шага (input.aimed — уже выбрана): хватает и тычет только её.
 *  • stalking: видят — замерла (ни шага, ни захвата). Не видят — кончик к goal со скоростью handSpeedK·playerSpeed
 *    (упор на границе поля лампы, не длиннее armMaxM); затем цель, открытая и в GRAB_R от кончика, — 'grab' → grabbing.
 *    Цель под кроватью (sheltered) не хватается: она в POKE_R от кончика (та же комната, палец не задевает поле лампы)
 *    — рука дальше не ползёт и тычет пальцем: 'poke' раз в pokePeriodS (удар — pokeHitU цикла), и под взглядом тоже.
 *    Открытый годный игрок в GRAB_R рядом с тычущей невидимой рукой — сразу цель (aimHand), хватка. Кровать цели
 *    известна (cover) — кончик не заходит ближе pokeStandM к её рамке (упор на границе расширенной рамки; уже внутри —
 *    только наружу) и тычет только снаружи; ближе не подойти (goal нет / достигнут / шаг упирается в зону) — палец
 *    тянется до pokeMaxM; тыча, невидимая доползает до goal (бок кровати у навигации), пока конец шага не дальше от
 *    цели, чем max(POKE_R, сейчас). Кровати прочих игроков (не цели) — не преграда.
 *  • Поле лампы накрыло руку (любую её точку глубже fieldSlackM) в emerging/stalking — 'retreat': втягивается кончиком
 *    вперёд со скоростью retreatK·playerSpeed (и под взглядом), пока рука не дальше поля на retreatClearM — 'stalk'
 *    (недоросла — снова emerging); дотянулась до двери — 'withdrawn'.
 *  • grabbing: тащит по следу dragSpeed м/с ('drag' раз в dragStep прогресса), у двери — 'killed' → gone. Поле лампы
 *    накрыло руку на волоке (напарник с лампой) — 'released' + 'retreat'.
 */
export function stepHand(h: HandState, dt: number, input: HandInput): HandEvent[] {
  const ev: HandEvent[] = [];
  if (h.phase === 'gone' || h.phase === 'withdrawn') return ev;
  if (input.lightsOn) return vanish(h, ev);
  const rest = pos(dt);
  const v = fin(input.playerSpeed) && input.playerSpeed > 0 ? input.playerSpeed : 0;
  const lanterns = input.lanterns;
  h.t += rest;
  const gap = fieldGap(h, lanterns);

  if (h.phase === 'grabbing') {
    const victim = h.victim!;
    if (gap < -OBSHAGA.fieldSlackM) {
      ev.push({ type: 'released', victim });
      h.victim = null;
      h.drag = 0;
      toRetreat(h, ev);
    } else {
      const before = h.drag;
      const home = retract(h, OBSHAGA.dragSpeed * rest);
      h.drag = home || h.dragLen <= 1e-9 ? 1 : clamp(1 - armLength(h) / h.dragLen, 0, 1);
      if (home) {
        h.phase = 'gone';
        h.victim = null;
        h.t = 0;
        ev.push({ type: 'killed', victim });
      } else if (Math.floor(h.drag / OBSHAGA.dragStep) > Math.floor(before / OBSHAGA.dragStep)) {
        ev.push({ type: 'drag', victim, progress: h.drag });
      }
      return ev;
    }
  }

  if (h.phase === 'retreating') {
    if (gap >= OBSHAGA.retreatClearM) {
      h.phase = h.emerge < 1 ? 'emerging' : 'stalking';
      h.t = 0;
      ev.push({ type: 'stalk' });
    }
  } else if (gap < -OBSHAGA.fieldSlackM) toRetreat(h, ev);

  if (h.phase === 'retreating') {
    if (retract(h, OBSHAGA.retreatK * v * rest)) {
      h.phase = 'withdrawn';
      h.t = 0;
      ev.push({ type: 'withdrawn' });
    }
    return ev;
  }

  h.frozen = input.seen;
  if (!input.aimed) aimHand(h, rest, input);
  const T = targetOf(h, input);
  h.bed = h.phase === 'stalking' ? nearBed(h, T) : null;
  // цель под кроватью в досягаемости пальца — тычет (и под взглядом: взгляд останавливает только ползание)
  const pk = h.phase === 'stalking' ? pokeTarget(h, input, T) : null;
  if (!pk) endPoke(h);
  if (input.seen) {
    h.blocked = false;
    if (pk) pokeStep(h, pk, rest, ev);
    return ev;
  }

  if (h.phase === 'emerging') {
    const dm = dist(h.door, h.mouth);
    advance(h, h.mouth, (dm / OBSHAGA.emergeS) * rest, lanterns);
    const done = dist(h.tip, h.mouth) < 1e-9;
    h.emerge = done ? 1 : clamp(dist(h.door, h.tip) / dm, 0, 1);
    if (done) {
      h.tip = pt(h.mouth);
      h.phase = 'stalking';
      h.t = 0;
      ev.push({ type: 'emerged' });
    }
    return ev;
  }

  // кровать цели: кончик в её расширенную рамку не заходит (вылезание из двери — без неё); чужие кровати — пол
  const beds: Rect[] = T && T.sheltered && T.cover ? [T.cover] : [];
  // stalking: тычет — стоит; кровать известна — тыча, доползает до цели навигации (бок кровати, по нормали — кисть
  // повернётся к кровати), пока палец достаёт (конец шага не дальше от цели, чем max(POKE_R, сейчас))
  if (pk) {
    h.blocked = false;
    const g = input.goal, step = OBSHAGA.handSpeedK * v * rest;
    if (pk.cover && g) {
      const L = dist(h.tip, g), k = L > 1e-9 ? Math.min(1, step / L) : 0;
      const end = { x: h.tip.x + (g.x - h.tip.x) * k, y: h.tip.y + (g.y - h.tip.y) * k };
      if (k > 0 && dist(end, pk.p) <= Math.max(POKE_R, dist(h.tip, pk.p)) + 1e-9) advance(h, g, step, lanterns, beds);
      h.blocked = false;
    }
    pokeStep(h, pk, rest, ev);
    return ev;
  }
  if (input.goal) advance(h, input.goal, OBSHAGA.handSpeedK * v * rest, lanterns, beds);
  else h.blocked = false;
  const victim = pickVictim(h, T);
  if (victim !== null) toGrab(h, victim, ev);
  return ev;
}

/**
 * Выпад пальца по фазе цикла тычка u (0…1, HandView.poke01) — для рендера: 0 — палец у края кровати, 1 — удар
 * (u = pokeHitU, держится ~0.08 цикла), меньше 0 — замах (палец отведён). Перед ударом — резкий выпад с разгоном,
 * после — медленно отходит.
 */
export function pokeReach(u: number): number {
  const H = OBSHAGA.pokeHitU, THRUST = 0.17, HOLD = 0.08, BACK = -0.2;
  const q = fin(u) ? u - Math.floor(u) : 0;
  const s = (k: number) => k * k * (3 - 2 * k);
  if (q <= 0) return 0;
  if (q < H - THRUST) return BACK * s(q / (H - THRUST));
  if (q < H) {
    const k = (q - (H - THRUST)) / THRUST;
    return BACK + (1 - BACK) * k * k;
  }
  if (q < H + HOLD) return 1;
  return 1 - s((q - H - HOLD) / (1 - H - HOLD));
}

/** Всё для рендера руки. */
export interface HandView {
  phase: HandPhase;
  /** рисовать ли (не withdrawn / gone) */
  visible: boolean;
  /** кисть (в grabbing — с жертвой: интеграция ставит схваченного игрока сюда) */
  tip: Pt;
  /** куда смотрят пальцы, рад, atan2(dy, dx) в плане — направление последнего отрезка руки наружу */
  heading: number;
  /** тело руки ломаной от двери до кисти включительно (рука «заполняет весь коридор» — толщину выбирает рендер) */
  trail: Pt[];
  /** длина руки, м */
  length: number;
  victim: string | null;
  /** волочение 0…1 */
  dragProgress: number;
  /** вылезание из двери 0…1 */
  emerge01: number;
  /** замерла под взглядом */
  frozen: boolean;
  /** упёрлась в поле лампы */
  blocked: boolean;
  /** 0…1 по сиду — вариация (подёргивание пальцев, фаза анимации) */
  variant: number;
  /** тычет пальцем под кровать: кого (null — нет), куда (план, точка игрока), фаза цикла 0…1 (выпад — pokeReach,
   *  удар — OBSHAGA.pokeHitU; клиент между срезами досчитывает её сам: + dt / pokePeriodS). pokeAt бывает до pokeMaxM
   *  от кончика: дальше pokeR указательный вытягивается сверх своей длины */
  poke: string | null;
  pokeAt: Pt | null;
  poke01: number;
  /** кровать рядом (HandState.bed): кровать цели ближе pokeStandM + bedNearM — пальцы подобраны (не на кровати); нет —
   *  null. Прочие кровати — не преграда: кисть и рука ложатся на них сверху */
  bed?: Rect | null;
  /** цель руки (HandState.target): к кому ползёт, кого хватает или тычет; null — нет */
  target?: string | null;
}

export function handView(h: HandState): HandView {
  const pts = armPoints(h);
  let heading = h.heading;
  for (let i = pts.length - 1; i > 0; i--) {
    const a = pts[i - 1], b = pts[i];
    if (dist(a, b) > 1e-6) {
      heading = Math.atan2(b.y - a.y, b.x - a.x);
      break;
    }
  }
  return {
    phase: h.phase,
    visible: h.phase !== 'withdrawn' && h.phase !== 'gone',
    tip: pt(h.tip),
    heading,
    trail: pts.map(pt),
    length: armLength(h),
    victim: h.victim,
    dragProgress: h.drag,
    emerge01: h.emerge,
    frozen: h.frozen,
    blocked: h.blocked,
    variant: hash01(hashSeed(h.seed), 17),
    poke: h.poke ?? null,
    pokeAt: h.pokeAt ? pt(h.pokeAt) : null,
    poke01: h.poke ? clamp((h.pokeT || 0) / OBSHAGA.pokePeriodS, 0, 1) : 0,
    bed: h.bed ? { x0: h.bed.x0, y0: h.bed.y0, x1: h.bed.x1, y1: h.bed.y1 } : null,
    target: h.target ?? null,
  };
}

// ───────────────────────── режиссёр ─────────────────────────

/** Дверь, из которой может вылезти рука (интеграция собирает по дверям рядом с игроками). */
export interface SpawnCandidate {
  /** id двери — тот же, что в openDoorById / doors */
  id: string;
  /** точка за дверью (в комнате) и проём в коридоре */
  door: Pt;
  mouth: Pt;
  /** путь от проёма до ближайшего игрока, м (навигация) */
  dist: number;
  /** на дверь смотрит хоть кто-то */
  seen: boolean;
  /** проём в поле лампы (механика дополнительно проверяет door–mouth по lanterns) */
  inField: boolean;
  /** косинус угла между взглядом ближайшего игрока и направлением от него на проём: 1 — прямо перед ним, −1 — за
   *  спиной (необязательно: нет — «сбоку») */
  facing?: number;
}

export interface ObshagaInput {
  /** игроки (агро: speed / loud / light / marked / dist — HandPlayer; память шума ведёт режиссёр — ObshagaState.noise) */
  players: readonly HandPlayer[];
  lanterns: readonly Pt[];
  playerSpeed: number;
  spawnCandidates: readonly SpawnCandidate[];
  /** следующая точка пути руки: готовая или по виду руки (зовётся, только когда рука есть) */
  goal: Pt | null | ((hand: HandView) => Pt | null);
  /** видит ли руку хоть кто-то; по умолчанию — players.some(p => p.sees) */
  seen?: boolean;
}

export interface ObshagaState {
  seed: string;
  blackout: BlackoutState;
  hand: HandState | null;
  /** id двери текущей руки (она занята — не закрывается) */
  handDoor: string | null;
  /** дверь прошлой руки в этом отключении — следующая вылезет из другой */
  lastDoor: string | null;
  /** сколько рук было (под-сиды) */
  hands: number;
  /** до появления руки, с; null — не ждём (свет или рука уже есть) */
  spawnIn: number | null;
  /** открытые/движущиеся двери; нет записи — закрыта */
  doors: Record<string, DoorState>;
  /** счётчик открытий дверей (сиды новых записей) */
  doorOpens: number;
  /** память шума игроков (stepNoise; id → 0…noiseMax, тихих нет) — агро руки; нет поля (старый срез) — пусто */
  noise?: Record<string, number>;
}

export type ObshagaEvent = BlackoutEvent | HandEvent | { type: 'spawn'; door: string; n: number };

export function createObshagaDirector(seed: string, opts?: { firstLitS?: number }): ObshagaState {
  return {
    seed,
    blackout: createBlackout(`${seed}/light`, opts),
    hand: null,
    handDoor: null,
    lastDoor: null,
    hands: 0,
    spawnIn: null,
    doors: {},
    doorOpens: 0,
    noise: {},
  };
}

/** Задержка руки после отключения n, с (spawnDelayS). */
export function spawnDelay(seed: string, n: number): number {
  return inRange(OBSHAGA.spawnDelayS, makeRng(`${seed}/s${n}`).next());
}

/** Пауза перед рукой номер k после ухода прошлой, с (respawnS). */
export function respawnDelay(seed: string, k: number): number {
  return inRange(OBSHAGA.respawnS, makeRng(`${seed}/r${k}`).next());
}

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Выбор двери для руки k. Годны: невидимые, не в поле (inField), не exclude, путь ≥ spawnMinM, обе точки двери (за дверью
 * и проём) не ближе spawnLanternM к лампам. Из годных с путём в spawnDistM — сначала те, что за спиной или сбоку от
 * ближайшего игрока (facing ≤ spawnBehindCos), иначе любые из диапазона: случайная (makeRng(seed + "/spawn" + k),
 * порядок кандидатов не важен); таких нет — ближайшая годная; годных нет — null (попробовать в следующем кадре).
 */
export function pickSpawn(seed: string, k: number, cands: readonly SpawnCandidate[], lanterns: readonly Pt[], exclude: string | null = null): SpawnCandidate | null {
  const farFromLamps = (c: SpawnCandidate) => !lanterns.some((l) => segDist(l, c.door, c.mouth) < OBSHAGA.spawnLanternM);
  const ok = cands.filter((c) => !c.seen && !c.inField && c.id !== exclude && fin(c.dist) && c.dist >= OBSHAGA.spawnMinM && farFromLamps(c));
  if (!ok.length) return null;
  const [lo, hi] = OBSHAGA.spawnDistM;
  const mid = ok.filter((c) => c.dist >= lo && c.dist <= hi).sort(byId);
  const behind = mid.filter((c) => !fin(c.facing) || c.facing! <= OBSHAGA.spawnBehindCos);
  if (behind.length) return makeRng(`${seed}/spawn${k}`).pick(behind);
  if (mid.length) return makeRng(`${seed}/spawn${k}`).pick(mid);
  return ok.reduce((a, b) => (b.dist < a.dist || (b.dist === a.dist && b.id < a.id) ? b : a));
}

function ensureDoor(dir: ObshagaState, id: string): DoorState {
  let d = dir.doors[id];
  if (!d) d = dir.doors[id] = createDoor(`${dir.seed}/door/${id}/${dir.doorOpens}`);
  dir.doorOpens++;
  return d;
}

/** Игрок открыл дверь id (E). false — уже распахивается. */
export function openDoorById(dir: ObshagaState, id: string): boolean {
  return openDoor(ensureDoor(dir, id));
}

/** Открытость двери 0…1 (нет записи — закрыта). */
export function doorOpenness(dir: ObshagaState, id: string): number {
  return dir.doors[id]?.open ?? 0;
}

/**
 * Шаг всех дверей: seenIds — на какие смотрят, blockedIds — в каких проёмах кто-то стоит. Дверь текущей руки занята
 * всегда (рука в проёме). Закрывшиеся записи удаляются (состояние для рассылки остаётся маленьким).
 */
export function stepDoors(dir: ObshagaState, dt: number, seenIds: ReadonlySet<string>, blockedIds: ReadonlySet<string>): { id: string; type: DoorEvent }[] {
  const out: { id: string; type: DoorEvent }[] = [];
  for (const id of Object.keys(dir.doors).sort()) {
    const d = dir.doors[id];
    const blocked = blockedIds.has(id) || id === dir.handDoor;
    for (const type of stepDoor(d, dt, { seen: seenIds.has(id), blocked })) out.push({ id, type });
    if (d.phase === 'closed') delete dir.doors[id];
  }
  return out;
}

/** Dev/QA: сразу заморгать (дальше — отключение и рука по обычным правилам). */
export function forceObshagaBlackout(dir: ObshagaState): BlackoutEvent[] {
  return forceBlackout(dir.blackout);
}

function dropHand(dir: ObshagaState) {
  dir.hand = null;
  dir.handDoor = null;
}

/**
 * Рука потеряла игроков (ушли дальше, за лестницу или шов — решает интеграция) — уходит сразу, без отступления по следу
 * (её не видно: интеграция зовёт, только когда на неё никто не смотрит), и следующая — рядом с игроками через
 * respawnDelay, из другой двери. Тащила — отпускает. Нет руки или не темно — ничего.
 */
export function withdrawHand(dir: ObshagaState): HandEvent[] {
  const h = dir.hand;
  if (!h || dir.blackout.phase !== 'dark') return [];
  const ev: HandEvent[] = [];
  if (h.victim !== null) ev.push({ type: 'released', victim: h.victim });
  h.victim = null;
  h.phase = 'withdrawn';
  endPoke(h);
  ev.push({ type: 'withdrawn' });
  dir.lastDoor = dir.handDoor;
  dropHand(dir);
  dir.spawnIn = respawnDelay(dir.seed, dir.hands);
  return ev;
}

/**
 * Шаг режиссёра: свет → рука. На 'blackout' — рука через spawnDelay (только в темноте); одна за раз; после
 * 'withdrawn' / 'killed' — следующая через respawnDelay из ДРУГОЙ двери, если ещё темно; на 'lightsBack' рука
 * исчезает ('released' / 'vanish'), до следующего отключения рук нет. Новая рука распахивает свою дверь.
 * Память шума игроков (stepNoise) — каждый шаг, и при свете; руке игроки идут с ней (noise). Цель руки выбирается
 * (aimHand) до goal: goal получает вид руки с target. Двери — отдельно: stepDoors.
 */
export function stepDirector(dir: ObshagaState, dt: number, input: ObshagaInput): ObshagaEvent[] {
  const ev: ObshagaEvent[] = [];
  const rest = pos(dt);
  const noise = (dir.noise = stepNoise(dir.noise ?? {}, rest, input.players));
  for (const e of stepBlackout(dir.blackout, rest)) {
    ev.push(e);
    if (e.type === 'blackout') {
      dir.spawnIn = spawnDelay(dir.seed, e.n);
      dir.lastDoor = null;
    } else if (e.type === 'lightsBack') {
      if (dir.hand) ev.push(...stepHand(dir.hand, 0, { lightsOn: true, seen: false, goal: null, players: [], lanterns: [], playerSpeed: 0 }));
      dropHand(dir);
      dir.spawnIn = null;
      dir.lastDoor = null;
    }
  }
  if (dir.blackout.phase !== 'dark') return ev;
  // в темноте прошло столько этого шага (отключение могло случиться посреди шага)
  const darkDt = Math.min(rest, dir.blackout.t);
  const h = dir.hand;
  if (h) {
    const seen = input.seen ?? input.players.some((p) => p.sees);
    const players = input.players.map((p) => ({ ...p, noise: memOf(noise, p.id) }));
    const hin: HandInput = { lightsOn: false, seen, goal: null, players, lanterns: input.lanterns, playerSpeed: input.playerSpeed, aimed: true };
    aimHand(h, darkDt, hin);
    hin.goal = typeof input.goal === 'function' ? input.goal(handView(h)) : input.goal;
    const hev = stepHand(h, darkDt, hin);
    for (const e of hev) {
      ev.push(e);
      if (e.type === 'withdrawn' || e.type === 'killed') {
        dir.lastDoor = dir.handDoor;
        dropHand(dir);
        dir.spawnIn = respawnDelay(dir.seed, dir.hands);
      }
    }
    return ev;
  }
  if (dir.spawnIn === null) return ev;
  dir.spawnIn = Math.max(0, dir.spawnIn - darkDt);
  if (dir.spawnIn > 0) return ev;
  const c = pickSpawn(dir.seed, dir.hands, input.spawnCandidates, input.lanterns, dir.lastDoor);
  if (!c) return ev;
  dir.hand = createHand(`${dir.seed}/h${dir.hands}`, c.door, c.mouth);
  dir.handDoor = c.id;
  dir.spawnIn = null;
  ev.push({ type: 'spawn', door: c.id, n: dir.hands });
  dir.hands++;
  const d = ensureDoor(dir, c.id);
  if (d.phase !== 'opening' && d.open < 1) openDoor(d);
  return ev;
}

/** Срез для рендера / клиента коопа (из присланного хостом состояния). */
export function obshagaView(dir: ObshagaState): { light: number; phase: BlackoutPhase; hand: HandView | null; handDoor: string | null } {
  return { light: lightLevel(dir.blackout), phase: dir.blackout.phase, hand: dir.hand ? handView(dir.hand) : null, handDoor: dir.handDoor };
}

/** Правило для игрока одной строкой (подсказка в UI). */
export function obshagaRule(): string {
  return `Свет моргнул — сейчас погаснет. В темноте из дверей лезет рука: ползёт, пока на неё не смотрят, и утаскивает ` +
    `за дверь. Смотри на неё — замрёт. Керосиновая лампа держит её на ${LANTERN_R} м от всех рядом, иди на неё с лампой — ` +
    `уползёт в свою дверь. Под кроватью (ползком, C) не схватит — но достанет пальцем. Вернулся свет — руки нет.`;
}
