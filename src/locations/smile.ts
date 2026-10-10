// «Улыбка» — моб биома «Общага» (свет, двери и рука — src/locations/obshaga.ts): девушка с улыбкой до ушей. Механика
// без движка: интеграция (Babylon в «Прогулке») подаёт игроков (где стоят, куда смотрят и бегут, держат ли фонарь,
// видит ли её избранный и держит ли в круге прицела, в какой жилой комнате стоят), кандидатов выглядывания с путём от
// избранного, точку «впереди по ходу» и далёкую точку для хруста — и реагирует на события. Стиль контракта — как
// obshaga.ts: create → step(dt) → события. Всё состояние — простой JSON (без классов, функций, Infinity/NaN): хост
// коопа рассылает его как есть, клиенты рисуют через smileView и запирают двери через smileLocked.
//
// Замысел заказчика:
//  «Девушка с улыбкой до ушей. Выглядывает из-за углов и иногда из-за окон. Перед появлением у одного из игроков
//   начинает стучать сердце и пищание в ушах. Вдалеке звук хруста плоти. После она откуда-то выглядывает. При
//   появлении видит её один игрок, и его задача — не дать другим игрокам зайти в её комнату или подойти к ней. Она
//   выглядывает из комнат.»
//
// Принятые трактовки (tmp/smile-wip/CONTRACT.md §1):
//  • Избранный — тот, кто держит фонарь (в активной ячейке, вкл. или выкл.). Видит её ТОЛЬКО избранный (у остальных
//    модель не рисуется). Держат несколько — избранный прежний, пока держит; иначе — первый по id. Никто не держит —
//    охота не начинается, она лишь хрустит вдалеке (noFlashS); посреди охоты показаться некому — «потеряла интерес».
//  • Каждое выглядывание: предвестие у избранного (omenS: писк в ушах, со стадии 2 — и сердце) → далёкий хруст плоти
//    (crunchAt) → выглядывает из-за косяка двери своей комнаты, из-за угла или из-за окна (windowChance, cornerChance).
//  • Стадия 1 (peeks1 раз): издалека (peek1DistM); прячется («выпрямляется» за косяк), как только избранный заметил её
//    краем глаза (noticeS) или к ней подошли (approach1M). Ловушек нет. Обозначает начало охоты.
//  • Стадия 2 (до peeks2 раз): ближе (peek2DistM), голова — на ближайшего игрока. Избранный держит её в круге прицела
//    stareS секунд (обрывы ≤ stareGraceS прощаются) — хруст, лицо рвётся (tearS); побежал от неё (fleeSpeedK × шаг)
//    или не побежал за fleeWaitS — уходит за свою дверь → стадия 3. Избранный подошёл (approach2M) — тоже уходит.
//    Не избранный подошёл на pounceR — бросок. Не досмотрел за peeks2 выглядываний — охота кончается ('lost').
//  • Стадия 3 — провокация: стоит посреди прохода впереди избранного (provokeAheadM). Подошёл кто угодно на pounceR —
//    бросок (pounceS) и еда (eatS): жертва не исчезает, пока ест, потом умирает ('eaten'). Избранный не смотрит на неё
//    дольше relocateS и он дальше relocateFarM — переставляется снова вперёд (до provokes раз). provokeS без жертвы —
//    уходит ('timeout').
//  • Ловушка-комната (со стадии trapFromStage): комнаты, из которых она выглядывала в этой охоте (последние trapRooms),
//    — «её». Зашёл туда НЕ избранный (он её не видит) — дверь тихо со скрипом закрывается (trapCloseS) и запирается,
//    лампочки бьются (trapDarkS), в темноте кружат красные зрачки и смех (trapEyesS), сердце и удушье (trapChokeS) —
//    смерть. Пока дверь закрывается — можно выскочить ('trapEscape'). Зашёл избранный — она его пропускает. Ловушка
//    одна за раз; дверь заперта (smileLocked) до смерти и ещё trapUnlockS. В соло ловушки не бывает (избранный — сам).
//  • Темнота (блэкаут руки, SmileInput.dark): новые выглядывания не начинаются; идущая стадия 3 продолжается.
//  • После жертвы (съела или задушила) — afterKillS, избранный пересчитывается, новая охота — со стадии 1; после
//    'lost' / 'timeout' — huntCooldownS, новая охота — со стадии againStage.
//
// Координаты: план, метры (x, y) — как в obshaga.ts; z — высота пола; room — непрозрачная метка экземпляра (механика
// её только переносит). Расстояния до неё — по прямой в плане (выглядывает она туда, откуда её видно, — кандидатов
// уже отфильтровала интеграция). ГСЧ — makeRng от сида и счётчика бросков (SmileState.rolls): один сид и один ход
// входов — одна и та же охота. Ручки SMILE — обычный изменяемый объект (вкладка «Бестиарий» правит его на лету):
// значения читаются в момент использования; длительность идущей фазы — та, что была на её начале.
import { makeRng } from '../model/rng';
import type { Pt } from './obshaga';

/** Диапазон [min, max] — равномерно по сиду. */
export type Range = [number, number];

/** Ручки «Улыбки» (секунды, метры, доли). Изменяемые: бестиарий пишет сюда, механика читает в момент использования. */
export const SMILE = {
  // ── охота ──
  /** первая охота — через столько секунд после входа в общагу: успеть осмотреться */
  firstHuntS: [40, 80] as Range,
  /** перезарядка после охоты без жертвы («потеряла интерес» или провокация не сработала), с */
  huntCooldownS: [50, 100] as Range,
  /** перезарядка после жертвы (съела или задушила в комнате), с: сытая возвращается не скоро */
  afterKillS: [120, 200] as Range,
  /** предвестие перед каждым выглядыванием, с: писк в ушах избранного (со стадии 2 — и сердце) */
  omenS: 3.5,
  /** далёкий хруст плоти — в этой доле предвестия (0 — сразу, 1 — перед самым выглядыванием) */
  crunchAt: 0.4,
  /** никто не держит фонарь — охоты нет, только хруст вдалеке раз в столько секунд */
  noFlashS: [25, 50] as Range,
  /** некуда выглянуть (нет места в нужной дали), темно или занята ловушкой — новая попытка через столько, с */
  retryS: 1.5,
  /** доля выглядываний из-за окна (остальное — из-за угла и из дверей комнат); такого места рядом нет — из другого */
  windowChance: 0.15,
  /** доля выглядываний из-за угла коридора */
  cornerChance: 0.25,
  /** высовывается из-за косяка за столько, с (медленно: голова, плечо, пальцы на косяке) */
  peekInS: 0.8,
  /** прячется — «выпрямляется» за косяк — за столько, с; столько же уходит за дверь после разрыва лица */
  hideS: 0.35,
  // ── стадия 1: выглядывает издалека и прячется ──
  /** выглядываний на стадии 1 (потом — стадия 2) */
  peeks1: 3,
  /** даль выглядывания стадии 1 — путь от избранного, м */
  peek1DistM: [9, 18] as Range,
  /** пауза между выглядываниями стадии 1, с (от «спряталась» до следующего предвестия) */
  peek1GapS: [6, 14] as Range,
  /** не заметили — прячется сама через столько, с */
  peek1MaxS: 10,
  /** заметил краем глаза: в кадре и на виду у избранного столько секунд подряд — прячется */
  noticeS: 0.15,
  /** кто угодно подошёл ближе стольких метров — прячется */
  approach1M: 3,
  /** места, что уже в кадре у избранного (на краю зрения), выбираются во столько раз охотнее — её должны заметить */
  inViewW: 3,
  // ── стадия 2: смотрит, рвётся лицо ──
  /** выглядываний на стадии 2: не досмотрел за столько — охота кончается («потеряла интерес») */
  peeks2: 4,
  /** даль выглядывания стадии 2 — путь от избранного, м */
  peek2DistM: [4, 10] as Range,
  /** пауза между выглядываниями стадии 2, с */
  peek2GapS: [5, 10] as Range,
  /** не досмотрел — прячется через столько, с */
  peek2MaxS: 16,
  /** держать её в круге прицела столько секунд — лицо рвётся */
  stareS: 5,
  /** круг прицела — диаметр в долях высоты экрана (считает интеграция → SmilePlayer.aim) */
  aimCircle: 0.1,
  /** обрыв взгляда не дольше стольких секунд прощается (накопленное не сгорает) */
  stareGraceS: 0.35,
  /** лицо рвётся за столько, с: щёки к ушам, огромная кровавая улыбка */
  tearS: 1.2,
  /** «побежал»: скорость избранного от неё — не меньше стольких скоростей ходьбы */
  fleeSpeedK: 0.6,
  /** не побежал за столько секунд после разрыва — уходит за дверь сама (и всё равно стадия 3) */
  fleeWaitS: 4,
  /** избранный подошёл ближе стольких метров — уходит за дверь (стадия 3); больше pounceR — его она не хватает */
  approach2M: 2.5,
  // ── стадия 3: провокация ──
  /** ушла за дверь — через столько секунд встаёт посреди прохода впереди избранного */
  goneS: 1.5,
  /** насколько впереди по ходу избранного встаёт, м */
  provokeAheadM: [5, 9] as Range,
  /** стоит столько секунд без жертвы — уходит, охота кончается ('timeout') */
  provokeS: 20,
  /** переставляется вперёд не больше стольких раз за провокацию */
  provokes: 2,
  /** избранный не смотрит на неё дольше стольких секунд — переставляется вперёд */
  relocateS: 1.5,
  /** …если он дальше стольких метров от неё (рядом — стоит, ждёт шага) */
  relocateFarM: 4,
  /** подошёл ближе стольких метров — бросок (стадия 3 — кто угодно, стадия 2 — не избранный) */
  pounceR: 1,
  /** бросок длится столько, с */
  pounceS: 0.45,
  /** ест столько секунд (жертва видна, остальные видят кровь из шеи), потом жертва умирает */
  eatS: 3.5,
  /** охота после 'lost' / 'timeout' начинается с этой стадии (1–3); после жертвы — всегда с 1 */
  againStage: 2,
  // ── ловушка-комната ──
  /** ловушки — с этой стадии охоты (на стадии 1 — нет) */
  trapFromStage: 2,
  /** «её» комнаты — последние столько комнат, из которых она выглядывала в этой охоте */
  trapRooms: 2,
  /** дверь тихо со скрипом закрывается за жертвой столько, с; пока закрывается — можно выскочить */
  trapCloseS: 2.4,
  /** заперлась — лампочки бьются, свет гаснет за столько, с */
  trapDarkS: 0.6,
  /** в темноте вокруг жертвы бегают красные зрачки и смех столько, с */
  trapEyesS: 4,
  /** сердце и удушье столько секунд — потом смерть */
  trapChokeS: 3,
  /** после смерти дверь ещё столько секунд заперта */
  trapUnlockS: 2,
  // ── что слышит избранный: уровни 0…1 (плавность — у звука) ──
  /** сердце: предвестие стадии 1, выглядывание стадии 2, разрыв лица, стадия 3 и бросок */
  heart: { omen1: 0, peek2: 0.35, tear: 0.6, provoke: 1 },
  /** писк в ушах по стадиям охоты */
  ring: { stage1: 0.25, stage2: 0.4, stage3: 0.6 },
};

/** Тип ручек (обычный объект: подходит как Record<string, unknown> для бестиария). */
export type SmileConfig = typeof SMILE;

export type SmileStage = 0 | 1 | 2 | 3; // 0 — нет охоты

export type SmilePhase =
  /** её нет: ждёт охоты (stage 0) или следующего выглядывания (next) */
  | 'idle'
  /** предвестие: писк / сердце у избранного, хруст вдалеке (crunchAt) */
  | 'omen'
  /** выглядывает (spot): высовывается за peekInS */
  | 'peek'
  /** прячется за косяк (hideS) */
  | 'hide'
  /** стадия 2: лицо рвётся (tearS), потом стоит и ждёт, побежит ли избранный (fleeWaitS) */
  | 'tear'
  /** ушла за свою дверь (стадия 3): через goneS встанет впереди */
  | 'gone'
  /** стадия 3: стоит посреди прохода (at) */
  | 'provoke'
  /** бросок на жертву (pounceS) */
  | 'pounce'
  /** ест жертву (eatS) */
  | 'eat';

export type SpotKind = 'door' | 'corner' | 'window';

export interface SmileSpot {
  id: string;
  kind: SpotKind;
  /** где её голова при полном выглядывании (план, м); p.room — экземпляр, где стоит модель */
  p: Pt;
  /** высота пола, м */
  z: number;
  /** куда она «высовывается» — угол плана, рад (0 = +x, π/2 = +y), направление взгляда по умолчанию */
  yaw: number;
  /** в какую сторону наклон (−1 — выглядывает влево от своей оси, 1 — вправо) */
  side: -1 | 1;
  /** комната, «из которой» она выглядывает (ловушка), null — угол/окно */
  hideRoom: string | null;
  /** ObshDoor.id этой комнаты (для ловушки) */
  door?: string;
}

export interface SmilePlayer {
  id: string;
  p: Pt;
  z: number;
  /** взгляд в плане (единичный) */
  fx: number;
  fy: number;
  /** скорость в плане, м/с */
  vx: number;
  vy: number;
  /** держит фонарь (в активной ячейке, вкл. или выкл.) */
  flash: boolean;
  /** она у него в кадре и в прямой видимости (интеграция считает только у избранного) */
  sees: boolean;
  /** она в центральном круге aimCircle */
  aim: boolean;
  /** экземпляр, где стоит */
  room: string | null;
  /** жилая комната (hideRoom-кандидат), если он ВНУТРИ неё (за порогом ≥ 0.4 м) */
  inside: string | null;
  alive: boolean;
  /** в общаге (вне её — не в счёт) */
  obsh: boolean;
}

/** Кандидат выглядывания: место, путь от избранного, м, и в кадре ли оно у него сейчас. */
export interface SmileCandidate {
  spot: SmileSpot;
  pathM: number;
  inView: boolean;
}

export interface SmileInput {
  players: SmilePlayer[];
  /** темно (блэкаут руки): новые выглядывания не начинаются */
  dark: boolean;
  /** м/с ходьбы (для fleeSpeedK) */
  walkSpeed: number;
  /** кандидаты выглядывания для избранного на стадии stage: интеграция уже отфильтровала по прямой видимости
   *  (из точки, где стоит избранный, точка выглядывания видна сквозь проёмы) и вернула путь-расстояние */
  spots(stage: 1 | 2, chosen: SmilePlayer): SmileCandidate[];
  /** точка посреди прохода впереди игрока по ходу (провокация); null — некуда */
  ahead(p: SmilePlayer, distM: number): { p: Pt; z: number; yaw: number } | null;
  /** далёкая точка для хруста (≥ 15 м по пути от избранного); null — рядом с ним в 20 м по направлению взгляда */
  far(chosen: SmilePlayer): Pt | null;
}

export interface SmileState {
  seed: string;
  /** время с создания, с */
  t: number;
  stage: SmileStage;
  phase: SmilePhase;
  /** время в фазе и её длительность, с (idle — 0 / 0: ждёт next) */
  phaseT: number;
  phaseDur: number;
  /** избранный — id держащего фонарь (smileChosen), null — никто */
  chosen: string | null;
  /** номер охоты (под-сиды) */
  hunt: number;
  /** выглядываний на этой стадии */
  peeks: number;
  /** стадия 1 — сколько секунд подряд её видит избранный (noticeS); стадия 2 — сколько держит в прицеле (stareS) */
  stare: number;
  /** стадия 2: длина нынешнего обрыва взгляда, с (дольше stareGraceS — stare сгорает) */
  grace: number;
  /** где выглядывает (peek / hide / tear; в gone — откуда ушла) */
  spot: SmileSpot | null;
  /** id игрока, на кого смотрит */
  look: string | null;
  /** разрыв лица 0…1 */
  torn: number;
  /** «её» комнаты этой охоты (порядок выглядывания, последние — в конце) */
  rooms: { room: string; door: string | null }[];
  /** ловушка: жертва, комната, дверь, шаг и время в нём, с */
  trap: { victim: string; room: string; door: string | null; ph: 'close' | 'dark' | 'eyes' | 'choke'; t: number } | null;
  /** еда: жертва, где схвачена, сколько секунд уже ест (во время броска — 0) */
  eat: { victim: string; p: Pt; z: number; t: number } | null;
  /** idle: до следующей попытки (охоты или предвестия), с */
  next: number;
  /** стадия 3: сколько раз переставлялась вперёд */
  provokes: number;
  /** стадия 3: сколько секунд избранный на неё не смотрит */
  unseen: number;
  /** сколько жертв всего */
  kills: number;
  // ── сверх контракта (аддитивно) ──
  /** стадия 3: где стоит посреди прохода */
  at: { p: Pt; z: number; yaw: number } | null;
  /** дверь, запертая после смерти в ловушке, и сколько ещё секунд (smileLocked) */
  lock: { door: string; t: number } | null;
  /** с какой стадии начнётся следующая охота */
  from: 1 | 2 | 3;
  /** id места прошлого выглядывания (подряд из одного места не выглядывает) */
  prev: string | null;
  /** счётчик бросков ГСЧ */
  rolls: number;
}

export type SmileEvent =
  /** предвестие у избранного (писк, со стадии 2 — сердце) */
  | { type: 'omen'; chosen: string; stage: 1 | 2 | 3 }
  /** далёкий хруст плоти */
  | { type: 'crunch'; p: Pt }
  /** выглянула */
  | { type: 'peek'; spot: SmileSpot }
  /** спряталась за косяк */
  | { type: 'hide'; spot: SmileSpot }
  /** хруст, лицо рвётся */
  | { type: 'tear' }
  /** исчезла за своей дверью → стадия 3 */
  | { type: 'flee' }
  /** встала посреди прохода (и при каждой перестановке) */
  | { type: 'provoke'; p: Pt; z: number }
  /** кинулась на жертву */
  | { type: 'pounce'; victim: string }
  /** смерть жертвы (конец еды) */
  | { type: 'eaten'; victim: string }
  /** дверь закрывается со скрипом */
  | { type: 'trap'; victim: string; room: string; door: string | null }
  /** лампочки бьются */
  | { type: 'trapDark'; victim: string; room: string }
  /** зрачки + смех */
  | { type: 'trapEyes'; victim: string }
  /** сердце + удушье */
  | { type: 'trapChoke'; victim: string }
  | { type: 'trapDeath'; victim: string; room: string; door: string | null }
  /** сверх контракта: жертва выскочила, пока дверь закрывалась — ловушка сорвалась, дверь не заперта */
  | { type: 'trapEscape'; victim: string; room: string; door: string | null }
  | { type: 'end'; why: 'kill' | 'lost' | 'timeout' };

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const clamp01 = (v: number) => (fin(v) ? clamp(v, 0, 1) : 0);
const pos = (dt: number) => (fin(dt) && dt > 0 ? dt : 0);
/** Ручка: не число (правка бестиария, старый срез) — запасное значение. */
const num = (v: unknown, d: number) => (fin(v) ? v : d);
/** Длительность из ручки, с: не меньше 0. */
const dur = (v: unknown) => Math.max(0, num(v, 0));
const inRange = (r: readonly number[] | undefined, u: number) => {
  const a = num(r?.[0], 0);
  const b = num(r?.[1], a);
  return a + (b - a) * u;
};
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
/** Копия точки (room — только если задан: JSON без undefined). */
const pt = (p: Pt): Pt => (typeof p.room === 'string' ? { x: p.x, y: p.y, room: p.room } : { x: p.x, y: p.y });
const okPt = (p: unknown): p is Pt => !!p && fin((p as Pt).x) && fin((p as Pt).y);
const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** Повтор, с: не меньше 0.05 (нулевая ручка не крутит шаг вхолостую). */
const retry = () => Math.max(0.05, num(SMILE.retryS, 1.5));
/** Скорость ходьбы, если интеграция не подала свою, м/с (как OBSHAGA.noiseWalkV). */
const WALK_FALLBACK = 1.7;
const stageOf = (v: unknown): 1 | 2 | 3 => clamp(Math.round(num(v, 2)), 1, 3) as 1 | 2 | 3;
const kindOf = (sp: SmileSpot): SpotKind => (sp.kind === 'window' || sp.kind === 'corner' ? sp.kind : 'door');

function copySpot(sp: SmileSpot): SmileSpot {
  const o: SmileSpot = {
    id: String(sp.id),
    kind: kindOf(sp),
    p: pt(sp.p),
    z: num(sp.z, 0),
    yaw: num(sp.yaw, 0),
    side: sp.side === -1 ? -1 : 1,
    hideRoom: typeof sp.hideRoom === 'string' ? sp.hideRoom : null,
  };
  if (typeof sp.door === 'string') o.door = sp.door;
  return o;
}

/** Бросок номер s.rolls (поток makeRng(seed + "/smile/" + n)): ход событий один — и броски одни. */
function draw(s: SmileState) {
  return makeRng(`${s.seed}/smile/${s.rolls++}`);
}

function roll(s: SmileState, r: readonly number[]): number {
  return Math.max(0, inRange(r, draw(s).next()));
}

/** Бросок по ключу охоты (счётчик не тратит: повтор той же постановки — та же даль). */
function keyed(s: SmileState, key: string): number {
  return makeRng(`${s.seed}/smile/h${s.hunt}/${key}`).next();
}

interface Ctx {
  inp: SmileInput;
  /** живые и в общаге */
  present: SmilePlayer[];
  chosen: SmilePlayer | null;
  /** скорость ходьбы, м/с */
  walk: number;
}

const validPlayer = (p: SmilePlayer) => !!p && typeof p.id === 'string' && okPt(p.p);

/** Ближайший к p из list, кто проходит ok (равное расстояние — меньший id); никого — null. */
function nearest(p: Pt, list: readonly SmilePlayer[], ok: (pl: SmilePlayer) => boolean = () => true): SmilePlayer | null {
  let best: SmilePlayer | null = null;
  let bd = 0;
  for (const pl of list) {
    if (!ok(pl)) continue;
    const d = dist(p, pl.p);
    if (!best || d < bd - 1e-9 || (Math.abs(d - bd) <= 1e-9 && pl.id < best.id)) (best = pl), (bd = d);
  }
  return best;
}

/**
 * Избранный: из живых в общаге, держащих фонарь, — прежний prev, пока держит; иначе первый по id; никто — null.
 */
export function smileChosen(prev: string | null, players: readonly SmilePlayer[]): string | null {
  let best: string | null = null;
  for (const p of players) {
    if (!validPlayer(p) || !p.alive || !p.obsh || !p.flash) continue;
    if (p.id === prev) return prev;
    if (best === null || p.id < best) best = p.id;
  }
  return best;
}

export function createSmile(seed: string): SmileState {
  const s: SmileState = {
    seed,
    t: 0,
    stage: 0,
    phase: 'idle',
    phaseT: 0,
    phaseDur: 0,
    chosen: null,
    hunt: 0,
    peeks: 0,
    stare: 0,
    grace: 0,
    spot: null,
    look: null,
    torn: 0,
    rooms: [],
    trap: null,
    eat: null,
    next: 0,
    provokes: 0,
    unseen: 0,
    kills: 0,
    at: null,
    lock: null,
    from: 1,
    prev: null,
    rolls: 0,
  };
  s.next = roll(s, SMILE.firstHuntS);
  return s;
}

/**
 * Dev/QA и бестиарий: охота — сразу (со следующего шага), со стадии stage. Идёт охота или ловушка — ничего (false).
 */
export function forceSmile(s: SmileState, stage: 1 | 2 | 3 = 1): boolean {
  if (s.stage !== 0 || s.trap) return false;
  s.from = stageOf(stage);
  s.next = 0;
  return true;
}

/** «Её» комнаты сейчас: последние trapRooms, из которых она выглядывала в этой охоте. */
function recentRooms(s: SmileState): { room: string; door: string | null }[] {
  const k = Math.max(0, Math.floor(num(SMILE.trapRooms, 0)));
  return k > 0 ? s.rooms.slice(-k) : [];
}

/** «Её» комнаты этой охоты (последние trapRooms) — экземпляры; ловушками они становятся со стадии trapFromStage. */
export function smileRooms(s: SmileState): string[] {
  return recentRooms(s).map((r) => r.room);
}

function addRoom(s: SmileState, sp: SmileSpot) {
  if (sp.hideRoom === null) return;
  const room = sp.hideRoom;
  s.rooms = s.rooms.filter((r) => r.room !== room);
  s.rooms.push({ room, door: sp.door ?? null });
  const cap = Math.max(8, Math.floor(num(SMILE.trapRooms, 0)));
  if (s.rooms.length > cap) s.rooms = s.rooms.slice(-cap);
}

/** Насколько выглянула 0…1 (вид): высовывается за peekInS, прячется — от того, насколько успела выглянуть. */
function leanOf(s: SmileState): number {
  const hide = dur(SMILE.hideS);
  switch (s.phase) {
    case 'peek': {
      const k = dur(SMILE.peekInS);
      return k > 0 ? clamp01(s.phaseT / k) : 1;
    }
    case 'hide':
      // длительность прятки = hideS × выглянутость в её начале (phaseDur) — убывает с той же скоростью до 0
      return hide > 0 ? clamp01((s.phaseDur - s.phaseT) / hide) : 0;
    case 'gone':
      return hide > 0 ? clamp01(1 - s.phaseT / hide) : 0;
    case 'tear':
    case 'provoke':
    case 'pounce':
    case 'eat':
      return 1;
    default:
      return 0;
  }
}

/** Доля фазы 0…1. */
function progress(s: SmileState): number {
  return s.phaseDur > 0 ? clamp01(s.phaseT / s.phaseDur) : 1;
}

/** Время фазы на rest: дошла до конца — остаток (≥ 0), phaseT = phaseDur; нет — null. */
function tick(s: SmileState, rest: number): number | null {
  const t1 = s.phaseT + rest;
  if (t1 < s.phaseDur) {
    s.phaseT = t1;
    return null;
  }
  s.phaseT = s.phaseDur;
  return t1 - s.phaseDur;
}

function toIdle(s: SmileState, next: number) {
  s.phase = 'idle';
  s.phaseT = 0;
  s.phaseDur = 0;
  s.next = Math.max(0, next);
  s.spot = null;
  s.look = null;
  s.stare = 0;
  s.grace = 0;
}

function endHunt(s: SmileState, why: 'kill' | 'lost' | 'timeout', ev: SmileEvent[]) {
  ev.push({ type: 'end', why });
  const kill = why === 'kill';
  s.stage = 0;
  toIdle(s, roll(s, kill ? SMILE.afterKillS : SMILE.huntCooldownS));
  s.from = kill ? 1 : stageOf(SMILE.againStage);
  s.peeks = 0;
  s.rooms = [];
  s.at = null;
  s.eat = null;
  s.torn = 0;
  s.provokes = 0;
  s.unseen = 0;
  s.prev = null;
  // после жертвы избранный пересчитывается (первый по id из держащих фонарь)
  if (kill) s.chosen = null;
}

/** Точка хруста: далёкая от игрока (far), иначе в 20 м по его взгляду. */
function crunchPoint(c: Ctx, pl: SmilePlayer): Pt {
  const f = c.inp.far(pl);
  if (okPt(f)) return pt(f);
  const L = Math.hypot(num(pl.fx, 0), num(pl.fy, 0));
  const fx = L > 1e-9 ? num(pl.fx, 0) / L : 1, fy = L > 1e-9 ? num(pl.fy, 0) / L : 0;
  return { x: pl.p.x + fx * 20, y: pl.p.y + fy * 20 };
}

/** Годные места выглядывания стадии st: путь в даль стадии, рядом (approach1M) никого, в её комнате никого. */
function spotCands(s: SmileState, st: 1 | 2, c: Ctx): SmileCandidate[] {
  const ch = c.chosen;
  if (!ch) return [];
  const r = st === 1 ? SMILE.peek1DistM : SMILE.peek2DistM;
  const a = num(r?.[0], 0), b = num(r?.[1], a);
  const lo = Math.min(a, b), hi = Math.max(a, b);
  const near = num(SMILE.approach1M, 3);
  const list = c.inp.spots(st, ch) ?? [];
  return list.filter((x) => {
    if (!x || !x.spot || typeof x.spot.id !== 'string' || !okPt(x.spot.p) || !fin(x.pathM)) return false;
    if (x.pathM < lo || x.pathM > hi) return false;
    const room = typeof x.spot.hideRoom === 'string' ? x.spot.hideRoom : null;
    if (room !== null && s.trap && s.trap.room === room) return false;
    return !c.present.some((pl) => dist(pl.p, x.spot.p) < near || (room !== null && pl.inside === room));
  });
}

/**
 * Место выглядывания: не то же, что в прошлый раз (если есть другие); вид места — по долям windowChance /
 * cornerChance / остальное — двери (среди тех видов, что есть рядом); на стадии 1 места в кадре у избранного —
 * в inViewW раз охотнее. Порядок кандидатов не важен (сортировка по id).
 */
function pickSpot(s: SmileState, st: 1 | 2, cands: readonly SmileCandidate[]): SmileCandidate {
  const fresh = cands.filter((x) => x.spot.id !== s.prev);
  const list = (fresh.length ? fresh : cands).slice().sort((a, b) => byId(a.spot.id, b.spot.id));
  const win = Math.max(0, num(SMILE.windowChance, 0));
  const cor = Math.max(0, num(SMILE.cornerChance, 0));
  const share: Record<SpotKind, number> = { window: win, corner: cor, door: Math.max(0, 1 - win - cor) };
  const cnt: Record<SpotKind, number> = { door: 0, corner: 0, window: 0 };
  for (const x of list) cnt[kindOf(x.spot)]++;
  const vw = Math.max(0, num(SMILE.inViewW, 1));
  const w = list.map((x) => {
    const k = kindOf(x.spot);
    return (share[k] / cnt[k]) * (st === 1 && x.inView ? vw : 1);
  });
  const R = draw(s);
  let i = R.weightedIndex(w);
  if (i < 0) i = Math.min(list.length - 1, Math.floor(R.next() * list.length));
  return list[i];
}

/** Кого хватает у точки p: ближайший живой в общаге ближе pounceR (не жертва ловушки; notChosen — кроме избранного). */
function pounceVictim(s: SmileState, p: Pt, c: Ctx, notChosen: boolean): SmilePlayer | null {
  const R = num(SMILE.pounceR, 1);
  return nearest(p, c.present, (pl) => (!notChosen || pl.id !== s.chosen) && (!s.trap || pl.id !== s.trap.victim) && dist(pl.p, p) <= R);
}

/** Бежит ли игрок от точки p: составляющая скорости от неё ≥ fleeSpeedK × шаг (и > 0). */
function runsAway(pl: SmilePlayer, p: Pt, walk: number): boolean {
  const dx = pl.p.x - p.x, dy = pl.p.y - p.y, L = Math.hypot(dx, dy);
  const vx = num(pl.vx, 0), vy = num(pl.vy, 0);
  const away = L > 1e-6 ? (vx * dx + vy * dy) / L : Math.hypot(vx, vy);
  return away > 1e-6 && away >= Math.max(0, num(SMILE.fleeSpeedK, 0.6)) * walk;
}

/** Точка провокации впереди игрока (даль — по ключу key этой охоты); некуда — null. */
function aheadOf(s: SmileState, c: Ctx, pl: SmilePlayer, key: string): { p: Pt; z: number; yaw: number } | null {
  const a = c.inp.ahead(pl, Math.max(0, inRange(SMILE.provokeAheadM, keyed(s, key))));
  if (!a || !okPt(a.p)) return null;
  return { p: pt(a.p), z: num(a.z, 0), yaw: num(a.yaw, 0) };
}

// ───────────────────────── переходы ─────────────────────────

function toHide(s: SmileState, ev: SmileEvent[]) {
  const sp = s.spot;
  if (!sp) return toIdle(s, retry());
  const lean = leanOf(s);
  s.phase = 'hide';
  s.phaseT = 0;
  s.phaseDur = dur(SMILE.hideS) * lean;
  s.look = null;
  ev.push({ type: 'hide', spot: copySpot(sp) });
}

/** Спряталась: стадия 1 кончилась — стадия 2; стадия 2 кончилась без разрыва — 'lost'; иначе пауза до предвестия. */
function afterHide(s: SmileState, ev: SmileEvent[]) {
  s.stare = s.grace = 0;
  if (s.stage === 1 && s.peeks >= num(SMILE.peeks1, 3)) {
    s.stage = 2;
    s.peeks = 0;
    return toIdle(s, roll(s, SMILE.peek2GapS));
  }
  if (s.stage === 2 && s.peeks >= num(SMILE.peeks2, 4)) return endHunt(s, 'lost', ev);
  toIdle(s, roll(s, s.stage === 1 ? SMILE.peek1GapS : SMILE.peek2GapS));
}

function toTear(s: SmileState, ev: SmileEvent[]) {
  s.phase = 'tear';
  s.phaseT = 0;
  s.phaseDur = dur(SMILE.tearS) + dur(SMILE.fleeWaitS);
  s.torn = dur(SMILE.tearS) > 0 ? 0 : 1;
  s.stare = s.grace = 0;
  ev.push({ type: 'tear' });
}

/** Исчезла за своей дверью → стадия 3 (через goneS встанет впереди избранного). */
function toFlee(s: SmileState, ev: SmileEvent[]) {
  ev.push({ type: 'flee' });
  s.stage = 3;
  s.phase = 'gone';
  s.phaseT = 0;
  s.phaseDur = dur(SMILE.goneS);
  s.look = null;
  s.stare = s.grace = 0;
  s.unseen = 0;
  s.provokes = 0;
}

function startProvoke(s: SmileState, a: { p: Pt; z: number; yaw: number }, c: Ctx, ev: SmileEvent[]) {
  s.at = a;
  s.spot = null;
  s.phase = 'provoke';
  s.phaseT = 0;
  s.phaseDur = dur(SMILE.provokeS);
  s.unseen = 0;
  s.provokes = 0;
  s.look = nearest(a.p, c.present)?.id ?? null;
  ev.push({ type: 'provoke', p: pt(a.p), z: a.z });
}

/** Начатый разрыв лица дорывается и после ухода (побежал, едва лицо пошло трещинами) — со скоростью tearS. */
function tearOn(s: SmileState, rest: number) {
  if (!(s.torn > 0) || s.torn >= 1) return;
  const ts = dur(SMILE.tearS);
  s.torn = ts > 0 ? clamp01(s.torn + rest / ts) : 1;
}

/** Бросок: лицо рвётся до конца (есть-то надо), жертва — где стояла. */
function toPounce(s: SmileState, v: SmilePlayer, ev: SmileEvent[]) {
  s.phase = 'pounce';
  s.phaseT = 0;
  s.phaseDur = dur(SMILE.pounceS);
  s.eat = { victim: v.id, p: pt(v.p), z: num(v.z, 0), t: 0 };
  s.look = v.id;
  s.torn = 1;
  ev.push({ type: 'pounce', victim: v.id });
}

/** Сменился избранный: предвестие сгорает, выглядывание — прячется, разорванная — уходит (стадия 3). */
function chosenChanged(s: SmileState, ev: SmileEvent[]) {
  if (s.phase === 'omen') toIdle(s, retry());
  else if (s.phase === 'peek') toHide(s, ev);
  else if (s.phase === 'tear') toFlee(s, ev);
}

/**
 * Попытка начать предвестие (idle, next истёк). Нет избранного: посреди охоты — 'lost', без охоты — хруст вдалеке
 * (от первого по id в общаге) и новая попытка через noFlashS. Темно, ловушка или еда — повтор через retryS. Стадия 1/2
 * и некуда выглянуть — повтор. Иначе (без охоты — новая охота со стадии from) — 'omen'.
 */
function tryOmen(s: SmileState, c: Ctx, ev: SmileEvent[]) {
  const hunting = s.stage !== 0;
  const ch = c.chosen;
  if (!ch) {
    if (hunting) return endHunt(s, 'lost', ev);
    const pl = c.present.slice().sort((a, b) => byId(a.id, b.id))[0];
    if (pl) ev.push({ type: 'crunch', p: crunchPoint(c, pl) });
    s.next = pl ? roll(s, SMILE.noFlashS) : retry();
    return;
  }
  if (c.inp.dark || s.trap || s.eat) {
    s.next = retry();
    return;
  }
  const st: 1 | 2 | 3 = hunting ? (s.stage as 1 | 2 | 3) : stageOf(s.from);
  if (st !== 3 && !spotCands(s, st, c).length) {
    s.next = retry();
    return;
  }
  if (!hunting) {
    s.hunt++;
    s.stage = st;
    s.peeks = 0;
    s.rooms = [];
    s.torn = 0;
    s.prev = null;
    s.provokes = 0;
    s.unseen = 0;
    s.at = null;
  }
  s.phase = 'omen';
  s.phaseT = 0;
  s.phaseDur = dur(SMILE.omenS);
  s.spot = null;
  s.look = null;
  ev.push({ type: 'omen', chosen: ch.id, stage: st });
}

/** Выглянуть (конец предвестия стадии 1/2): место — pickSpot; некуда — предвестие впустую, повтор. */
function startPeek(s: SmileState, c: Ctx, ev: SmileEvent[]) {
  const st = s.stage === 1 ? 1 : 2;
  const cands = spotCands(s, st, c);
  if (!cands.length || !c.chosen) return toIdle(s, retry());
  const sp = copySpot(pickSpot(s, st, cands).spot);
  s.spot = sp;
  s.prev = sp.id;
  s.phase = 'peek';
  s.phaseT = 0;
  s.phaseDur = dur(st === 1 ? SMILE.peek1MaxS : SMILE.peek2MaxS);
  s.peeks++;
  s.stare = s.grace = 0;
  s.look = st === 2 ? nearest(sp.p, c.present)?.id ?? null : null;
  addRoom(s, sp);
  ev.push({ type: 'peek', spot: copySpot(sp) });
}

// ───────────────────────── фазы ─────────────────────────

function idleStep(s: SmileState, rest: number, c: Ctx, ev: SmileEvent[]): number {
  if (s.next > rest) {
    s.next -= rest;
    return 0;
  }
  const left = rest - Math.max(0, s.next);
  s.next = 0;
  tryOmen(s, c, ev);
  return left;
}

function omenStep(s: SmileState, rest: number, c: Ctx, ev: SmileEvent[]): number {
  // в темноте не выглядывает, ловушка — она занята жертвой: предвестие сгорает
  if (c.inp.dark || s.trap) {
    toIdle(s, retry());
    return 0;
  }
  const t0 = s.phaseT, t1 = t0 + rest;
  const ends = t1 >= s.phaseDur;
  const ct = clamp01(num(SMILE.crunchAt, 0.4)) * s.phaseDur;
  if (t0 <= ct && (t1 > ct || ends) && c.chosen) ev.push({ type: 'crunch', p: crunchPoint(c, c.chosen) });
  const left = tick(s, rest);
  if (left === null) return 0;
  if (s.stage === 3) {
    // охота сразу со стадии 3: предвестие — и встаёт впереди (через gone без задержки)
    s.phase = 'gone';
    s.phaseT = 0;
    s.phaseDur = 0;
    s.spot = null;
  } else startPeek(s, c, ev);
  return left;
}

function peekStep(s: SmileState, rest: number, c: Ctx, ev: SmileEvent[]): number {
  const sp = s.spot;
  if (!sp) {
    toIdle(s, retry());
    return 0;
  }
  const ch = c.chosen;
  if (s.stage === 2) {
    s.look = nearest(sp.p, c.present)?.id ?? null;
    const v = pounceVictim(s, sp.p, c, true);
    if (v) {
      toPounce(s, v, ev);
      return 0;
    }
    if (ch && dist(ch.p, sp.p) < num(SMILE.approach2M, 2.5)) {
      toFlee(s, ev);
      return 0;
    }
    if (ch && ch.sees && ch.aim) {
      s.stare += rest;
      s.grace = 0;
    } else {
      s.grace += rest;
      if (s.grace > num(SMILE.stareGraceS, 0)) s.stare = s.grace = 0;
    }
    if (s.stare >= num(SMILE.stareS, 5)) {
      s.phaseT += rest;
      toTear(s, ev);
      return 0;
    }
  } else {
    s.look = null;
    if (c.present.some((pl) => dist(pl.p, sp.p) < num(SMILE.approach1M, 3))) {
      s.phaseT += rest;
      toHide(s, ev);
      return 0;
    }
    if (ch && ch.sees) {
      s.stare += rest;
      if (s.stare >= num(SMILE.noticeS, 0.15)) {
        s.phaseT += rest;
        toHide(s, ev);
        return 0;
      }
    } else s.stare = 0;
  }
  const left = tick(s, rest);
  if (left === null) return 0;
  toHide(s, ev);
  return left;
}

function hideStep(s: SmileState, rest: number, c: Ctx, ev: SmileEvent[]): number {
  const left = tick(s, rest);
  if (left === null) return 0;
  s.spot = null;
  afterHide(s, ev);
  return left;
}

function tearStep(s: SmileState, rest: number, c: Ctx, ev: SmileEvent[]): number {
  const sp = s.spot;
  if (!sp) {
    toFlee(s, ev);
    return 0;
  }
  s.look = nearest(sp.p, c.present)?.id ?? null;
  const v = pounceVictim(s, sp.p, c, true);
  if (v) {
    toPounce(s, v, ev);
    return 0;
  }
  const left = tick(s, rest);
  const ts = dur(SMILE.tearS);
  s.torn = ts > 0 ? clamp01(s.phaseT / ts) : 1;
  const ch = c.chosen;
  if (ch && (dist(ch.p, sp.p) < num(SMILE.approach2M, 2.5) || runsAway(ch, sp.p, c.walk))) {
    toFlee(s, ev);
    return 0;
  }
  if (left === null) return 0;
  // не побежал за fleeWaitS — уходит сама
  toFlee(s, ev);
  return left;
}

function goneStep(s: SmileState, rest: number, c: Ctx, ev: SmileEvent[]): number {
  const t0 = s.phaseT;
  const left = tick(s, rest);
  tearOn(s, s.phaseT - t0);
  if (left === null) return 0;
  const a = c.chosen ? aheadOf(s, c, c.chosen, 'a0') : null;
  if (a) {
    startProvoke(s, a, c, ev);
    return left;
  }
  if (s.phaseT >= dur(SMILE.provokeS)) {
    endHunt(s, 'timeout', ev);
    return left;
  }
  s.phaseDur += retry();
  return left;
}

function provokeStep(s: SmileState, rest: number, c: Ctx, ev: SmileEvent[]): number {
  const at = s.at;
  if (!at) {
    endHunt(s, 'timeout', ev);
    return 0;
  }
  s.look = nearest(at.p, c.present)?.id ?? null;
  const v = pounceVictim(s, at.p, c, false);
  if (v) {
    toPounce(s, v, ev);
    return 0;
  }
  const ch = c.chosen;
  if (ch && !ch.sees) {
    s.unseen += rest;
    if (
      s.unseen > num(SMILE.relocateS, 1.5) &&
      dist(ch.p, at.p) > num(SMILE.relocateFarM, 4) &&
      s.provokes < num(SMILE.provokes, 0)
    ) {
      const a = aheadOf(s, c, ch, `a${s.provokes + 1}`);
      if (a) {
        s.at = a;
        s.provokes++;
        s.unseen = 0;
        ev.push({ type: 'provoke', p: pt(a.p), z: a.z });
      }
    }
  } else s.unseen = 0;
  const t0 = s.phaseT;
  const left = tick(s, rest);
  tearOn(s, s.phaseT - t0);
  if (left === null) return 0;
  endHunt(s, 'timeout', ev);
  return left;
}

function pounceStep(s: SmileState, rest: number): number {
  const left = tick(s, rest);
  if (left === null) return 0;
  s.phase = 'eat';
  s.phaseT = 0;
  s.phaseDur = dur(SMILE.eatS);
  return left;
}

function eatStep(s: SmileState, rest: number, ev: SmileEvent[]): number {
  const left = tick(s, rest);
  const e = s.eat;
  if (e) e.t = s.phaseT;
  if (left === null) return 0;
  if (e) ev.push({ type: 'eaten', victim: e.victim });
  s.kills++;
  endHunt(s, 'kill', ev);
  return left;
}

function stepPhase(s: SmileState, rest: number, c: Ctx, ev: SmileEvent[]): number {
  switch (s.phase) {
    case 'idle':
      return idleStep(s, rest, c, ev);
    case 'omen':
      return omenStep(s, rest, c, ev);
    case 'peek':
      return peekStep(s, rest, c, ev);
    case 'hide':
      return hideStep(s, rest, c, ev);
    case 'tear':
      return tearStep(s, rest, c, ev);
    case 'gone':
      return goneStep(s, rest, c, ev);
    case 'provoke':
      return provokeStep(s, rest, c, ev);
    case 'pounce':
      return pounceStep(s, rest);
    case 'eat':
      return eatStep(s, rest, ev);
  }
}

// ───────────────────────── ловушка ─────────────────────────

const TRAP_SEQ = ['close', 'dark', 'eyes', 'choke'] as const;
type TrapPh = (typeof TRAP_SEQ)[number];

function trapDur(ph: TrapPh): number {
  switch (ph) {
    case 'close':
      return dur(SMILE.trapCloseS);
    case 'dark':
      return dur(SMILE.trapDarkS);
    case 'eyes':
      return dur(SMILE.trapEyesS);
    case 'choke':
      return dur(SMILE.trapChokeS);
  }
}

/**
 * Начать ловушку: охота со стадии trapFromStage, избранный есть (в соло ловушки нет: избранный — сам игрок), она не
 * ест. Жертва — первый по id живой в общаге НЕ избранный, кто стоит внутри «её» комнаты (smileRooms) и её не видит.
 * Выглядывала как раз из этой двери — прячется (разорванная — уходит: стадия 3): она ушла к жертве.
 */
function startTrap(s: SmileState, c: Ctx, ev: SmileEvent[]) {
  if (s.stage === 0 || s.stage < num(SMILE.trapFromStage, 2) || !s.chosen) return;
  if (s.phase === 'pounce' || s.phase === 'eat') return;
  const rooms = recentRooms(s);
  if (!rooms.length) return;
  let best: SmilePlayer | null = null;
  let entry: { room: string; door: string | null } | null = null;
  for (const pl of c.present) {
    if (pl.id === s.chosen || pl.sees || typeof pl.inside !== 'string') continue;
    const r = rooms.find((x) => x.room === pl.inside);
    if (r && (!best || pl.id < best.id)) (best = pl), (entry = r);
  }
  if (!best || !entry) return;
  s.trap = { victim: best.id, room: entry.room, door: entry.door, ph: 'close', t: 0 };
  ev.push({ type: 'trap', victim: best.id, room: entry.room, door: entry.door });
  if (s.spot && s.spot.hideRoom === entry.room) {
    if (s.phase === 'peek') toHide(s, ev);
    else if (s.phase === 'tear') toFlee(s, ev);
  }
}

/** Смерть в ловушке: дверь ещё trapUnlockS заперта; жертва — её: охота кончается 'kill' (ест — кончит еда). */
function trapDeath(s: SmileState, ev: SmileEvent[]) {
  const tr = s.trap!;
  ev.push({ type: 'trapDeath', victim: tr.victim, room: tr.room, door: tr.door });
  s.trap = null;
  if (tr.door !== null) s.lock = { door: tr.door, t: dur(SMILE.trapUnlockS) };
  s.kills++;
  if (s.stage !== 0) {
    if (s.phase !== 'pounce' && s.phase !== 'eat') endHunt(s, 'kill', ev);
  } else {
    s.next = Math.max(s.next, roll(s, SMILE.afterKillS));
    s.from = 1;
  }
}

/**
 * Шаг ловушки: close (trapCloseS) → 'trapDark' → dark (trapDarkS) → 'trapEyes' → eyes (trapEyesS) → 'trapChoke' →
 * choke (trapChokeS) → 'trapDeath'. Жертва пропала (погибла иначе, ушла из общаги, вышла из игры) — ловушка
 * распадается молча; вышла из комнаты, пока дверь закрывалась, — 'trapEscape'. Длинный dt проходит несколько шагов.
 */
function stepTrap(s: SmileState, rest: number, c: Ctx, ev: SmileEvent[]) {
  if (!s.trap) return startTrap(s, c, ev);
  const tr = s.trap;
  const v = c.present.find((p) => p.id === tr.victim);
  if (!v) {
    s.trap = null;
    return;
  }
  if (tr.ph === 'close' && v.inside !== tr.room) {
    s.trap = null;
    ev.push({ type: 'trapEscape', victim: tr.victim, room: tr.room, door: tr.door });
    return;
  }
  let r = rest;
  for (let i = 0; i < 8; i++) {
    const d = trapDur(tr.ph);
    if (tr.t + r < d) {
      tr.t += r;
      return;
    }
    r = Math.max(0, r - Math.max(0, d - tr.t));
    const k = TRAP_SEQ.indexOf(tr.ph);
    if (k >= TRAP_SEQ.length - 1) return trapDeath(s, ev);
    tr.ph = TRAP_SEQ[k + 1];
    tr.t = 0;
    if (tr.ph === 'dark') ev.push({ type: 'trapDark', victim: tr.victim, room: tr.room });
    else if (tr.ph === 'eyes') ev.push({ type: 'trapEyes', victim: tr.victim });
    else ev.push({ type: 'trapChoke', victim: tr.victim });
  }
}

/**
 * Шаг «Улыбки». Мутирует состояние, возвращает события по порядку.
 *
 *  • Избранный — smileChosen (прежний, пока держит фонарь; иначе первый по id). Сменился посреди появления —
 *    предвестие сгорает, выглядывание прячется, разорванная уходит (стадия 3); провокация, бросок и еда идут дальше.
 *  • Запертая после ловушки дверь отпирается через trapUnlockS; ловушка — stepTrap (параллельно охоте; пока она идёт,
 *    новые предвестия не начинаются).
 *  • Охота: idle (next) → omen (omenS, хруст в crunchAt) → peek (стадии 1/2) или провокация (охота со стадии 3) → …
 *    см. замысел в шапке. Временные переходы — точно на границах фаз (длинный dt проходит несколько фаз); входы игроков
 *    (sees / aim / подход / скорость) — раз за шаг, со всем dt шага.
 */
export function stepSmile(s: SmileState, dt: number, inp: SmileInput): SmileEvent[] {
  const ev: SmileEvent[] = [];
  const rest = pos(dt);
  s.t += rest;
  const present = (inp.players ?? []).filter((p) => validPlayer(p) && p.alive && p.obsh);
  const was = s.chosen;
  s.chosen = smileChosen(was, present);
  const c: Ctx = {
    inp,
    present,
    chosen: present.find((p) => p.id === s.chosen) ?? null,
    walk: fin(inp.walkSpeed) && inp.walkSpeed > 0 ? inp.walkSpeed : WALK_FALLBACK,
  };
  if (s.chosen !== was) chosenChanged(s, ev);
  if (s.lock) {
    s.lock.t -= rest;
    if (!(s.lock.t > 0)) s.lock = null;
  }
  stepTrap(s, rest, c, ev);
  let left = rest;
  for (let i = 0; i < 16; i++) {
    left = stepPhase(s, left, c, ev);
    if (!(left > 0)) break;
  }
  return ev;
}

// ───────────────────────── вид ─────────────────────────

/** Что рисовать/играть: только для избранного видна модель; heart/ring — уровни для избранного; жертвы — для всех. */
export interface SmileView {
  /** есть ли она в мире сейчас (видит только chosen) */
  visible: boolean;
  chosen: string | null;
  pose: 'peek' | 'stand' | 'pounce' | 'eat' | 'window' | null;
  spot: SmileSpot | null;
  /** где модель (план; peek — голова при полном выглядывании, остальное — между ступнями), высота пола, поворот, рад */
  p: Pt | null;
  z: number;
  yaw: number;
  /** 0 — спряталась за косяком, 1 — выглянула (pounce — фаза броска 0…1) */
  lean: number;
  /** 0..1 разрыв лица */
  torn: number;
  /** id игрока, на кого смотрит */
  look: string | null;
  /** 0..1 для избранного (0 — нет): целевые уровни, плавность — у звука */
  heart: number;
  ring: number;
  trap: SmileState['trap'];
  eat: SmileState['eat'];
  // ── сверх контракта ──
  stage: SmileStage;
  phase: SmilePhase;
  /** доля нынешней фазы 0…1 (бросок, еда, разрыв) */
  u: number;
}

type Pose = NonNullable<SmileView['pose']>;
interface Body {
  pose: Pose;
  p: Pt;
  z: number;
  yaw: number;
  lean: number;
}

/** Откуда кинулась: место провокации или выглядывания. */
function origin(s: SmileState): { p: Pt; z: number; yaw: number } | null {
  if (s.at) return s.at;
  if (s.spot) return { p: s.spot.p, z: s.spot.z, yaw: s.spot.yaw };
  return null;
}

function body(s: SmileState): Body | null {
  switch (s.phase) {
    case 'peek':
    case 'hide':
    case 'tear':
    case 'gone': {
      const sp = s.spot;
      if (!sp) return null;
      if (s.phase === 'gone' && !(s.phaseT < dur(SMILE.hideS))) return null;
      return { pose: kindOf(sp) === 'window' ? 'window' : 'peek', p: pt(sp.p), z: sp.z, yaw: sp.yaw, lean: leanOf(s) };
    }
    case 'provoke':
      return s.at ? { pose: 'stand', p: pt(s.at.p), z: s.at.z, yaw: s.at.yaw, lean: 1 } : null;
    case 'pounce':
    case 'eat': {
      const e = s.eat;
      if (!e) return null;
      const o = origin(s) ?? { p: e.p, z: e.z, yaw: 0 };
      const dx = e.p.x - o.p.x, dy = e.p.y - o.p.y;
      const yaw = Math.hypot(dx, dy) > 1e-6 ? Math.atan2(dy, dx) : o.yaw;
      if (s.phase === 'eat') return { pose: 'eat', p: pt(e.p), z: e.z, yaw, lean: 1 };
      const u = progress(s);
      const k = u * u * (3 - 2 * u);
      const p: Pt = { x: o.p.x + dx * k, y: o.p.y + dy * k };
      const room = k < 0.5 ? o.p.room : e.p.room;
      if (typeof room === 'string') p.room = room;
      return { pose: 'pounce', p, z: o.z + (e.z - o.z) * k, yaw, lean: u };
    }
    default:
      return null;
  }
}

/** Целевые сердце и писк избранного по стадии и фазе (0…1). */
function levels(s: SmileState): { heart: number; ring: number } {
  const H = SMILE.heart ?? { omen1: 0, peek2: 0, tear: 0, provoke: 0 };
  const R = SMILE.ring ?? { stage1: 0, stage2: 0, stage3: 0 };
  const lv = (h: number, r: number) => ({ heart: clamp01(num(h, 0)), ring: clamp01(num(r, 0)) });
  if (s.stage === 0 || s.phase === 'idle') return { heart: 0, ring: 0 };
  if (s.phase === 'pounce' || s.phase === 'eat') return lv(H.provoke, R.stage3);
  if (s.stage === 1) return lv(H.omen1, R.stage1);
  if (s.stage === 2) return s.phase === 'tear' ? lv(H.tear, R.stage2) : lv(H.peek2, R.stage2);
  return lv(H.provoke, R.stage3);
}

export function smileView(s: SmileState): SmileView {
  const b = body(s);
  const { heart, ring } = levels(s);
  return {
    visible: !!b,
    chosen: s.chosen,
    pose: b ? b.pose : null,
    spot: s.spot ? copySpot(s.spot) : null,
    p: b ? b.p : null,
    z: b ? b.z : 0,
    yaw: b ? b.yaw : 0,
    lean: b ? b.lean : 0,
    torn: clamp01(s.torn),
    look: b ? s.look : null,
    heart,
    ring,
    trap: s.trap ? { ...s.trap } : null,
    eat: s.eat ? { ...s.eat, p: pt(s.eat.p) } : null,
    stage: s.stage,
    phase: s.phase,
    u: progress(s),
  };
}

/** Где она сейчас в мире (план, высота пола); её нет — null. Для звука (хруст рядом, разрыв, бросок). */
export function smilePos(s: SmileState): { p: Pt; z: number } | null {
  const b = body(s);
  return b ? { p: b.p, z: b.z } : null;
}

/** Ближайший к ней живой игрок в общаге (её нет — null). */
export function smileNearest(s: SmileState, players: readonly SmilePlayer[]): SmilePlayer | null {
  const at = smilePos(s);
  if (!at) return null;
  return nearest(at.p, players, (pl) => validPlayer(pl) && pl.alive && pl.obsh);
}

/** Заперта ли дверь ловушкой (интеграция: E не открывает, рука не открывает): идёт ловушка или trapUnlockS после. */
export function smileLocked(s: SmileState, doorId: string): boolean {
  return (!!s.trap && s.trap.door === doorId) || (!!s.lock && s.lock.door === doorId);
}
