// Потоковый (бесконечный) складчатый мир: комнаты за дверями генерируются, когда игрок к ним
// приближается; уже сгенерированное сохраняется и при возврате восстанавливается как было.
// Всё выводится из сида (+ модификаторов сида — позже). Контракт зафиксирован оркестратором;
// алгоритм и гарантии — docs/GENERATOR-4D.md §15 «Бесконечный мир».
//
// Стыковка, проверки, петли и PVS — общие со складчатым прогоном (foldcore.ts). Отличия:
//  • рост не идёт по общей очереди меток: раскрывается конкретный экземпляр (все его двери по порядку);
//  • ГСЧ — свой поток на каждую дверь по её «адресу» (путь дверей от старта), наполнение — по адресу
//    экземпляра: содержимое комнаты не зависит от того, в каком порядке игрок ходил;
//  • тупики по шансу (deadEndChance) с резервом роста, ветвистость, max — «в окрестности пути».
// Спец-локации (Room.location, src/locations/): экземпляр локации сам на другие этажи не раскрывается — переход на
// этаж(и) ниже создаёт только descend() (комната-выход на этаже floor − k и связь kind 'descent'), выход лифта на
// этаже выше — только ascend() (комната за выходом на этаже floor + k и связь kind 'lift'); этаж — ещё одно
// измерение занятости, как W (docs/LOCATIONS.md, docs/GENERATOR-4D.md §15.14).
// Режим квартир (settings.world, docs/GENERATOR-4D.md §16): мир растёт квартирами — кластерами комнат с закрытыми
// дверями-выходами; открыл выход — за ним новая квартира, остальные выходы исчезают; биомы задают веса комнат;
// переходы (спец-комнаты) появляются по счётчику пройденных комнат рядом с игроком и ведут в другой биом или в
// богатую квартиру. Без settings.world — прежний рост (магистраль, тупики по шансу).
// Подвал (биом с layout 'tunnels', docs/GENERATOR-4D.md §17): вместо квартир — сеть ходов, растущая на ходу: длинные
// ходы, редкие хабы (через них вход и выход), ответвления-кладовые, кольца из хаба в хаб через слои W и бесконечные
// прямые участки — шов со сдвигом (связь wrap: дошёл до конца — снова в начале).
import { OPPOSITE } from '../model/cells';
import { hashSeed, makeRng, type Rng } from '../model/rng';
import type {
  Biome, Connector, FoldSettings, FoldStats, InstanceContent, LairSpec, LiftSide, LiftSpec, Link, MatchMode, Pass, Project, Room, Rot, Run,
  Side, StairwellSpec, WorldSettings,
} from '../model/types';
import { apartmentBiomes, biomeMul, isTunnels, normWorld, plainBiomes, startBiomeOf, transitionChance, tunnelBiomes } from './biomes';
import { locationSeedKey, rollStairwell, type StairwellRoll } from '../locations/stairwell';
import { isLair, rollLift, type LiftRoll } from '../locations/lift';
import { rollContent } from '../gen/generate';
import { walkWarning } from '../gen/walk';
import { compatible, dockTarget, facing, OUT_SIGN, rotFor, segLine, turnSide, type SegGeom } from '../gen/geom';
import { sightLimits } from '../gen/sight';
import {
  addPvs, around, buildPool, growFrom, growOthers, layerFree, LIMIT, link, newLay, normFold, pickWeighted, place, PVS_TOL_M, RESERVE_MAX, tryLink,
  Buckets, type Ctx, type Fails, type FoldGenSettings, type Info, type Lay, type Node, type Why,
} from './foldcore';
import type { Body } from './space';
import { computePvs, viewHorizonM } from './pvs';
export { viewHorizonM } from './pvs';
import { roomSightM, Shapes } from './space';

export interface StreamSettings {
  seed: string;
  /** модификаторы сида (на будущее): строки, которые детерминированно меняют ГСЧ и веса; пока [] */
  mods: string[];
  gap: number;
  match: MatchMode;
  /** предел прямой видимости, м (0 — без предела) */
  sightM: number;
  fold: FoldSettings;
  /** id стартовой комнаты или null — по тегу start / весу */
  startRoomId: string | null;
  /**
   * Тупики: вероятность, что ещё не открытая дверь при раскрытии окажется глухой (заколоченная
   * дверь), даже если за ней можно было бы что-то поставить. 0 — все двери ведут дальше.
   */
  deadEndChance: number;
  /** ветвистость: множитель веса комнат-развилок (хабов) при выборе; 1 — как в пуле, >1 — ветвистее, <1 — коридорнее.
   *  Развилка с k ходами вперёд (ростовых меток кроме входной) получает вес × branching^(k − 1) — branchMul */
  branching: number;
  /** на сколько дверей вперёд (по графу от комнаты игрока) мир должен быть уже сгенерирован */
  aheadDoors: number;
  /** режим квартир, биомы и переходы (docs/GENERATOR-4D.md §16); null — прежний рост без квартир */
  world: WorldSettings | null;
}

/** Состояние счётчика переходов: пройдено комнат (впервые, без спец-комнат) с последнего перехода, шанс для
 *  следующей новой комнаты, выпал ли переход (появится за следующей открытой дверью), сколько раз сбрасывался. */
export interface TransitionState {
  count: number;
  chance: number;
  pending: boolean;
  resets: number;
}

/** Итог входа в комнату (StreamWorld.enter): засчитана ли она и выпал ли переход именно сейчас. */
export interface EnterResult extends TransitionState {
  counted: boolean;
  triggered: boolean;
}

/** Квартира экземпляра — для интерфейса. */
export interface ClusterInfo {
  id: number;
  biome: Biome | null;
  /** куда ведут её выходы (у богатой квартиры — биом, откуда в неё пришли) */
  home: Biome | null;
  rich: boolean;
  rooms: number;
  /** закрытых выходов */
  exits: number;
  /** спец-комната перехода в этой квартире (id) или null */
  transition: string | null;
  /** подвал: сеть ходов (растёт на ходу), а не квартира */
  tunnels: boolean;
}

/** Сохранение режима квартир. */
export interface WorldSave {
  clusters: { biome: string; home: string; rich: boolean; entry: string; exits: string[]; opened: string[]; transition: string | null; tunnels?: true }[];
  /** подвал: метры хода от прошлого хаба по порядку instances (−1 — не ход) */
  tdist?: number[];
  /** квартира каждого экземпляра по порядку instances (−1 — вне квартир) */
  clusterOf: number[];
  /** «исчезнувшие» двери: индексы связей-дверей (пропущенные переходы) */
  sealed: number[];
  /** комнаты, где игрок уже был */
  visited: string[];
  tr: { count: number; resets: number; pending: boolean };
}

/** Компактное сохранение мира: достаточно, чтобы восстановить его без генерации заново (раскладка, двери,
 *  PVS — как были) и продолжить ровно так же, как без сохранения. Ключ в localStorage — worldKey(seed, mods). */
export interface StreamSave {
  format: 'room-forge-world';
  version: 1;
  settings: StreamSettings;
  /** накопленный прогон: экземпляры, связи, pvs, sight, fold. Клеток нет — геометрия берётся из проекта по
   *  roomId + rot + dx + dy (+ w). content пуст: наполнение выводится при загрузке из адресов экземпляров
   *  (тот же ГСЧ — тот же результат); если content заполнен — берётся как есть */
  run: Run;
  /** какие экземпляры уже раскрыты (за их дверями сгенерировано) */
  expanded: string[];
  /** двери, ставшие тупиками: "inst/connector" */
  dead: string[];
  savedAt: number;
  /** причины тупиков параллельно dead: 'chance' — по deadEndChance, иначе — почему не встала комната */
  deadWhy?: string[];
  /** экземпляры магистрали (её продолжение не бывает тупиком по шансу) */
  spine?: string[];
  /** отпечатки комнат мира: roomId → хэш клеток и меток. Не сошёлся — мир «устарел» */
  rooms?: Record<string, string>;
  /** режим квартир: квартиры, выходы, исчезнувшие двери, посещённые комнаты, счётчик переходов */
  world?: WorldSave;
}

/** Состояние двери экземпляра: связана / заколочена (тупик) / ещё не раскрыта / закрытый выход квартиры (можно открыть). */
export type DoorState = 'linked' | 'dead' | 'pending' | 'exit';

/** Сводка мира — для отладки, тестов и интерфейса. */
export interface StreamStats {
  instances: number;
  expanded: number;
  /** нераскрытые двери (у нераскрытых экземпляров) и из них ростовые */
  pending: number;
  pendingGrow: number;
  /** двери, решённые при раскрытии: выросла комната / петля / тупик по шансу / тупик — ничего не встало */
  grown: number;
  loops: number;
  deadChance: number;
  deadFail: number;
  layers: number;
  minW: number;
  maxW: number;
  /** пар комнат, пересекающихся в 3D (разные слои) */
  overlaps: number;
  shifted: number;
  /** раскрытий экземпляров; время одного раскрытия, мс — среднее / 95-й перцентиль / максимум по последним 500 */
  expands: number;
  expandMsAvg: number;
  expandMsP95: number;
  expandMsMax: number;
  /** переходов вниз из спец-локаций (descend); выходов лифтов (ascend); этажей с комнатами; самый нижний и самый
   *  верхний этаж */
  descents: number;
  lifts: number;
  floors: number;
  minFloor: number;
  maxFloor: number;
  /** режим квартир: квартир, закрытых выходов, счётчик переходов (null — режим выключен) */
  clusters: number;
  exitsOpen: number;
  transition: TransitionState | null;
  /** подвал: хабов, замкнутых колец, бесконечных прямых участков (швов) */
  hubs: number;
  rings: number;
  wraps: number;
}

/** Спец-локация экземпляра и её розыгрыш (по виду; kind — как spec.kind, для сужения типа): lair — без розыгрыша. */
export type LocationInfo =
  | { kind: 'stairwell'; spec: StairwellSpec; roll: StairwellRoll }
  | { kind: 'lift'; spec: LiftSpec; roll: LiftRoll }
  | { kind: 'lair'; spec: LairSpec; roll: null };

export interface StreamWorld {
  readonly settings: StreamSettings;
  /** id стартового экземпляра (null — в проекте нет ни одной комнаты для генерации) */
  readonly startId: string | null;
  /** сохранение не подошло к проекту (комнаты изменились/удалены) — мир начат заново; причина в warnings */
  readonly stale: boolean;
  readonly warnings: readonly string[];
  /** текущее состояние (растёт по мере раскрытия); объект можно мутировать только через методы мира */
  run(): Run;
  /** раскрыть экземпляр: сгенерировать комнаты за всеми его ещё не раскрытыми дверями (или сделать их
   *  тупиками). Детерминированно по сиду и истории раскрытий. Возвращает id новых экземпляров. */
  expand(instId: string): string[];
  /** раскрыть всё в пределах aheadDoors дверей от экземпляра (вызывать при входе игрока в комнату) */
  ensureAround(instId: string, doors?: number): string[];
  /** раскрыть все комнаты, которые могут быть видны из экземпляра (и так до замыкания): сгенерировано
   *  окончательно — при ходьбе ничего не «появится» в поле зрения. reachM — дальность, м (по умолчанию
   *  viewHorizonM(sightM) — горизонт портального рендера без тумана): PVS экземпляра (sightM) и, если reachM
   *  больше, — PVS той же логики с дальностью reachM по текущей геометрии мира. */
  ensureVisible(instId: string, reachM?: number): string[];
  isExpanded(instId: string): boolean;
  doorState(instId: string, connectorId: string): DoorState | null;
  /** адрес экземпляра — хэш пути дверей от старта (16 hex); от него — ГСЧ наполнения */
  addressOf(instId: string): string | null;
  /** спец-локация экземпляра (Room.location) и её розыгрыш — один источник правды для движка, descend и ascend:
   *  rollStairwell / rollLift(spec, locationSeedKey(seedKey(seed, mods), адрес)); логово — roll null.
   *  null — обычная комната */
  locationOf(instId: string): LocationInfo | null;
  /** переход вниз из спец-локации (петля разомкнута): один раз и детерминированно по адресу создаёт комнату-выход
   *  на этаже floor − roll.floorsDown и связь kind 'descent'; дальше мир растёт от выхода как обычно (выход —
   *  на своей магистрали). Повторный вызов — тот же id. Ошибка, если у экземпляра нет спец-локации */
  descend(instId: string): string;
  /** комната-выход спец-локации, если descend уже был; иначе null */
  exitOf(instId: string): string | null;
  /** выход лифта (docs/LOCATIONS.md, «Ржавый лифт»): один раз и детерминированно по адресу создаёт комнату за
   *  выходом side на этаже floor(лифта) + floor (floor — −roll.down…−1 или 1…roll.floors: ниже или выше входа) и
   *  связь kind 'lift' (floors, side); если это логово по розыгрышу (roll.lair) — комнату с location.kind 'lair'.
   *  Повторный вызов — тот же id. Ошибка, если экземпляр не лифт или этаж вне диапазона (или 0 — вход) */
  ascend(instId: string, floor: number, side: LiftSide): string;
  /** комната за выходом лифта, если ascend уже был; иначе null */
  liftExitOf(instId: string, floor: number, side: LiftSide): string | null;
  /** режим квартир: открыть закрытый выход квартиры — за ним встаёт новая квартира (того же биома), остальные
   *  закрытые выходы этой квартиры исчезают, пропущенный в ней переход исчезает; выпал переход — он встаёт в новой
   *  квартире рядом со входом. Возвращает id комнаты за дверью (null — ничего не встало, дверь стала глухой).
   *  Ошибка, если это не закрытый выход */
  openDoor(instId: string, connectorId: string): string | null;
  /** режим квартир: игрок вошёл в комнату — счётчик переходов (впервые и не в спец-комнату — +1; после trAfter —
   *  бросок шанса). Без режима квартир — ничего не делает */
  enter(instId: string): EnterResult;
  /** квартира экземпляра (null — вне квартир / режим выключен) */
  clusterAt(instId: string): ClusterInfo | null;
  /** счётчик переходов (null — режим выключен) */
  transitionState(): TransitionState | null;
  stats(): StreamStats;
  /** сохранение / подписка на изменения (для автосохранения и перерисовки) */
  save(): StreamSave;
  onChange(cb: (newIds: string[]) => void): () => void;
}

export const DEFAULT_STREAM: Omit<StreamSettings, 'seed' | 'fold' | 'startRoomId'> = {
  mods: [],
  gap: 1,
  match: 'exact',
  sightM: 9,
  deadEndChance: 0.15,
  branching: 1,
  aheadDoors: 2,
  world: null,
};

/** Складки бесконечного мира по умолчанию: бесшовность выключена (её даёт портальный рендер), localRadius 1
 *  (комната не пересекается с соседями — физика на пороге), складок много, слоёв — сколько угодно. */
export const DEFAULT_STREAM_FOLD: FoldSettings = {
  shiftChance: 0.8,
  maxShift: 4,
  localRadius: 1,
  maxLayer: 1000,
  seamless: false,
};

/** Окно правила max: столько предков по пути от старта (с их детьми) считаются «окрестностью». */
export const MAX_WINDOW = 10;
/** Резерв роста: при стольких нераскрытых ростовых дверях в мире (и меньше) ростовые двери не становятся
 *  тупиками по шансу и сначала пробуют комнаты, дающие рост, — как RESERVE_MAX генератора при count → ∞. */
export const STREAM_RESERVE = RESERVE_MAX;

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Нормализация настроек мира: мусор и пропуски → значения по умолчанию (DEFAULT_STREAM, DEFAULT_STREAM_FOLD). */
export function normStream(s: Partial<StreamSettings>): StreamSettings {
  const f: Partial<FoldSettings> = {};
  for (const [k, v] of Object.entries(s.fold ?? {})) if (v !== undefined) (f as Record<string, unknown>)[k] = v;
  const D = DEFAULT_STREAM;
  return {
    seed: String(s.seed ?? ''),
    mods: Array.isArray(s.mods) ? s.mods.map(String) : [],
    gap: clamp(Math.floor(num(s.gap, D.gap)), 0, 64),
    match: s.match === 'tag' || s.match === 'len' || s.match === 'exact' ? s.match : D.match,
    sightM: Math.max(0, num(s.sightM, D.sightM)),
    fold: normFold({ ...DEFAULT_STREAM_FOLD, ...f }),
    startRoomId: typeof s.startRoomId === 'string' ? s.startRoomId : null,
    deadEndChance: clamp(num(s.deadEndChance, D.deadEndChance), 0, 1),
    branching: clamp(num(s.branching, D.branching), 0, 100),
    aheadDoors: clamp(Math.floor(num(s.aheadDoors, D.aheadDoors)), 0, 16),
    world: s.world ? normWorld(s.world) : null,
  };
}

/** Полные настройки мира для сида: значения по умолчанию + частичные. */
export function streamSettings(seed: string, o: Partial<StreamSettings> = {}): StreamSettings {
  return normStream({ ...o, seed });
}

/**
 * Модификаторы сида → вес комнаты при выборе. Точка расширения.
 * TODO(mods): разбор модификаторов («+подвал», «-кухня», «тьма», «самосбор»…): множители весов по тегам,
 * сдвиг shiftChance/deadEndChance, запрет комнат. Сейчас модификаторы только входят в сид (hash(seed + mods)).
 */
export function applyMods(mods: readonly string[], room: Room, weight: number): number {
  void mods;
  void room;
  return weight;
}

/**
 * Множитель ветвистости веса комнаты: branching^(ходов − 1), где ходов — ростовых меток кроме входной
 * (ростовых − 1). Проходная комната (коридор: 2 ростовые) — ×1, развилка T (3) — ×branching, крест (4) — ×branching².
 * Комнаты без роста и с одной ростовой меткой не меняются. Сравниваются только комнаты, совместимые с одной
 * дверью, поэтому множитель «всем хабам» ничего бы не дал — важна доля развилок среди них.
 */
export function branchMul(grow: readonly boolean[], branching: number): number {
  let g = 0;
  for (const x of grow) if (x) g++;
  return g >= 3 ? Math.pow(branching, g - 2) : 1;
}

/** Строка сида ГСЧ мира: сид + модификаторы (тот же вид, что в ключе сохранения). */
export function seedKey(seed: string, mods: readonly string[]): string {
  return mods.length ? `${seed}+${mods.join('+')}` : seed;
}

/** Ключ сохранения мира в localStorage для сида и модификаторов. */
export function worldKey(seed: string, mods: string[]): string {
  return `room-forge/world/${seedKey(seed, mods)}`;
}

const hex8 = (n: number) => (n >>> 0).toString(16).padStart(8, '0');

/** Адрес старта. */
export const ROOT_ADDR = '0000000000000000';
/** Псевдо-метка адреса комнаты-выхода: адрес выхода = childAddr(адрес локации, DESCENT_CONN). */
export const DESCENT_CONN = '@descent';
/** Тег метки, через которую в комнату-выход приходят сверху (марш лестницы). */
export const ARRIVAL_TAG = 'stair';
/** Теги комнат-выходов (площадки и коридоры). */
export const EXIT_TAGS: readonly string[] = ['лестница', 'коридор'];
/** Тег метки, через которую в комнату за выходом лифта приходят из кабины: проём выхода кабины 1.3 м — как
 *  двустворчатые двери коридоров и площадок. */
export const LIFT_ARRIVAL_TAG = 'corridor';

/** Псевдо-метка адреса комнаты за выходом лифта: адрес = childAddr(адрес лифта, liftConn(floor, side)). */
export function liftConn(floor: number, side: LiftSide): string {
  return `@lift:${floor}:${side}`;
}

/** Мировая сторона шахты лифта для выхода side (по ассету rusted_lift_v2): «прямо» — узкий проём над входом, та же
 *  стена, что входная метка лифта (первая метка с длиной; у пресета — S); «направо» — правая рука, если войти в кабину
 *  и стоять лицом от входа: по часовой от стены напротив входа (у пресета — E). Поворот экземпляра rot учтён через
 *  мировые метки. */
export function liftWall(conns: readonly Pick<Connector, 'side' | 'len'>[], rot: Rot, side: LiftSide): Side {
  const entry = conns.find((c) => c.len >= 1)?.side ?? turnSide('S', rot);
  return side === 'straight' ? entry : turnSide(OPPOSITE[entry], 90);
}

/** Виртуальная метка на всю сторону wall габарита экземпляра (мировые клетки): к ней стыкуется комната за выходом
 *  лифта (dockTarget — по центру стороны, через gap). */
function shaftSide(n: Pick<Node, 'x0' | 'y0' | 'x1' | 'y1'>, wall: Side): SegGeom {
  switch (wall) {
    case 'N': return { side: wall, cx: n.x0, cy: n.y0, len: n.x1 - n.x0 };
    case 'S': return { side: wall, cx: n.x0, cy: n.y1 - 1, len: n.x1 - n.x0 };
    case 'W': return { side: wall, cx: n.x0, cy: n.y0, len: n.y1 - n.y0 };
    case 'E': return { side: wall, cx: n.x1 - 1, cy: n.y0, len: n.y1 - n.y0 };
  }
}

/** Адрес двери connId экземпляра с адресом parent (= адрес комнаты, которая встанет за ней): 64-битный
 *  хэш пути «старт → … → дверь». */
export function childAddr(parent: string, connId: string): string {
  return hex8(hashSeed(`${parent}/${connId}`)) + hex8(hashSeed(`${connId}\\${parent}`));
}

/** Отпечаток геометрии комнаты: клетки и метки (id, место, длина, тег, порог). */
export function roomPrint(room: Room): string {
  const cells = [...room.cells].sort();
  const conns = room.connectors.map((c) => [c.id, c.cx, c.cy, c.side, c.len, c.tag, c.shift ?? 'auto'].join(','));
  return `${room.cells.size}:${hex8(hashSeed(`${cells.join(';')}|${conns.join(';')}`))}`;
}

const now = (): number => (globalThis.performance ? globalThis.performance.now() : Date.now());
const round3 = (m: number) => Math.round(m * 1000) / 1000;
/** ключ двери в картах: order·1024 + индекс метки */
const dk = (order: number, ci: number) => order * 1024 + ci;
const lineKey = (side: string, line: number) => `${side}:${line}`;

/** Почему дверь глухая: 'chance' — тупик по шансу; 'cluster' — в квартире не нужна (стена); 'vanished' —
 *  закрытый выход исчез (игрок ушёл через другой); иначе — почему не встала комната. */
type DeadWhy = 'chance' | 'cluster' | 'vanished' | Why;
const isWhy = (w: DeadWhy): w is Why => w !== 'chance' && w !== 'cluster' && w !== 'vanished';

interface DoorRef { n: Node; ci: number }

/** Квартира (режим квартир): кластер комнат с дверями-выходами. */
interface Cluster {
  id: number;
  /** биом квартиры и биом, куда ведут её выходы (у богатой квартиры — откуда пришли) */
  biome: string;
  home: string;
  rich: boolean;
  /** входная комната и все комнаты (order) по порядку постановки; entry −1 — ещё не поставлена */
  entry: number;
  rooms: number[];
  /** закрытые выходы (dk), открытые выходы (dk) */
  exits: number[];
  opened: number[];
  /** переход (order спец-комнаты), поставленный в эту квартиру */
  transition: number | null;
  /** подвал: сеть ходов — комнаты не раскрыты заранее, растут на ходу (expandTunnel) */
  tunnels: boolean;
}

/** Метки «наружу» — двери из квартиры в общие места и в другие квартиры: входная дверь квартиры, двустворчатые
 *  двери коридоров и площадок, марши, подвальные ходы. Только они бывают выходами квартиры; остальные (прихожая →
 *  кухня, комната → балкон, коридор → комната общежития, подвал → клетушка…) — внутренние: квартира достраивает их
 *  первыми, лишние становятся стенами. */
export const OUTER_TAGS: readonly string[] = ['landing>apt', 'apt>landing', 'corridor', 'stair', 'basement'];

/** Переход встаёт за дверью шириной от стольких клеток (0.7 м — межкомнатная дверь и шире). */
const TRANSITION_MIN_LEN = 7;

/** Сколько у комнаты дверей, кроме двери bi (в режиме квартир каждая — будущий проём или выход). */
const doorsBesides = (info: Info, bi: number): number => {
  let k = 0;
  info.room.connectors.forEach((c, j) => { if (j !== bi && c.len >= 1) k++; });
  return k;
};

/** Пул комнат биома: кандидаты и их веса. */
interface Pool {
  list: Info[];
  weightOf(x: Info): number;
}

// ───────── подвал: сеть ходов (docs/GENERATOR-4D.md §17) ─────────

/** Проход хода — проём 1.0 м во всю ширину хода. */
const TUNNEL_TAG = 'basement';
/** Выход хаба наверх (марш) — закрытая дверь, ведёт в квартиры. */
const HUB_EXIT_TAG = 'stair';
/** Метки кусков роста ходов (кроме хабов): проход, дверь в кладовую, дверь в служебку. */
const TUNNEL_DOORS: ReadonlySet<string> = new Set([TUNNEL_TAG, 'basement>storage', 'corridor>service']);
/** Бесконечный прямой участок — не ближе стольких метров хода к хабу. */
const LOOP_MIN_DIST = 12;
type TunKind = 'hub' | 'straight' | 'turn' | 'branch';
/** Направления: N, E, S, W (по часовой) — индекс курса. */
const HEADS: readonly Side[] = ['N', 'E', 'S', 'W'];
const DIR: Record<Side, [number, number]> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };

/** Вид куска хода: хаб (тег «хаб»), прямой (два прохода на противоположных стенах), поворот (на соседних), развилка
 *  (три и больше); null — не кусок хода (у него есть другие двери: марш, квартирная…). */
function tunKind(info: Info): TunKind | null {
  const r = info.room;
  if (r.tags.includes('хаб')) return 'hub';
  if (!r.connectors.every((c) => c.len < 1 || TUNNEL_DOORS.has(c.tag))) return null;
  const t = r.connectors.filter((c) => c.len >= 1 && c.tag === TUNNEL_TAG);
  if (t.length >= 3) return 'branch';
  if (t.length !== 2) return null;
  return t[0].side === OPPOSITE[t[1].side] ? 'straight' : 'turn';
}

/** Якорь двери: середина проёма на линии стены (клетки плана). */
function anchorOf(c: SegGeom): [number, number] {
  const line = segLine(c);
  return c.side === 'N' || c.side === 'S' ? [c.cx + c.len / 2, line] : [line, c.cy + c.len / 2];
}

/** Метка-образец ширины len с якорем в (0, 0), смотрит на side. */
function probeDoor(side: Side, len: number): SegGeom {
  switch (side) {
    case 'N': return { side, cx: -len / 2, cy: 0, len };
    case 'S': return { side, cx: -len / 2, cy: -1, len };
    case 'W': return { side, cx: 0, cy: -len / 2, len };
    case 'E': return { side, cx: -1, cy: -len / 2, len };
  }
}

/** Кусок кольца: в (in) и из (out) — метки прохода; шаг — сдвиг якоря курсора и новый курс по каждому курсу. */
interface RingPiece {
  info: Info;
  in: number;
  out: number;
  /** по курсу (индекс HEADS): сдвиг якоря и курс после куска */
  step: { d: [number, number]; h: number }[];
}

/** Детали колец и бесконечных участков биома: прямые куски (шаг без сдвига вбок), поворот направо и налево,
 *  развилка-тройник (две метки оси и боковая). */
interface RingKit {
  straights: RingPiece[];
  right: RingPiece | null;
  left: RingPiece | null;
  tee: { info: Info; a1: number; a2: number; side: number } | null;
}

class Stream implements StreamWorld {
  readonly settings: StreamSettings;
  startId: string | null = null;
  stale = false;
  readonly warnings: string[] = [];

  private readonly p: Project;
  private readonly cellM: number;
  private readonly root: Rng;
  private readonly gen: FoldGenSettings;
  private readonly ctx: Ctx;
  private readonly lay: Lay;
  private readonly infos: (Info | null)[];
  private readonly byRoom = new Map<string, Info>();
  /** комнаты, которые можно ставить ростом (вес > 0, max > 0) */
  private readonly cands: Info[];
  private readonly wt = new Map<Info, number>();
  private readonly prints = new Map<Info, string>();
  /** PVS: дальность и допуск в клетках (null — sightM = 0, PVS не считается) */
  private readonly pvsOpt: { reach: number; tol: number } | null;

  // состояние по экземплярам (индекс = order)
  private readonly addr: string[] = [];
  private readonly expandedF: boolean[] = [];
  /** на магистрали (её продолжение не бывает тупиком по шансу) */
  private readonly spine: boolean[] = [];
  /** нераскрытых экземпляров магистрали */
  private spinePending = 0;
  private readonly kids: Node[][] = [];
  private readonly byId = new Map<string, Node>();
  private readonly content: InstanceContent[] = [];
  private readonly dead = new Map<number, DeadWhy>();
  /** нераскрытые двери по линии (для петель); устаревшие записи вычищаются при чтении */
  private readonly loopIdx = new Map<string, DoorRef[]>();
  /** все экземпляры всех слоёв — для подсчёта пересечений в 3D */
  private readonly all = new Buckets();
  private readonly uniqueUsed = new Set<Info>();
  private totals: Record<string, number> = {};
  private growPending = 0;
  private overlaps = 0;
  private shifted = 0;
  private minW = 0;
  private maxW = 0;
  private grown = 0;
  private loops = 0;
  private deadChance = 0;
  private deadFail = 0;
  private best: { m: number; line: Run['sight']['line'] } = { m: 0, line: null };
  /** связи-переходы спец-локаций (kind 'descent' и 'lift'): отдельно от lay.links — индексы lay.links = индексы
   *  проёмов в пространстве лучей; в Run.links идут после дверей, в порядке создания */
  private readonly trans: Link[] = [];
  /** экземпляр локации (order) → комната-выход */
  private readonly exitBy = new Map<number, Node>();
  /** выход лифта: "order:этаж:сторона" → комната за выходом */
  private readonly liftBy = new Map<string, Node>();
  private readonly floorSet = new Set<number>([0]);
  private minFloor = 0;
  private maxFloor = 0;
  private readonly dirty = new Set<number>();
  private pvsRec: Record<string, string[]> = {};
  private ms = 0;
  private readonly times: number[] = [];
  private version = 0;
  private cache: { v: number; run: Run } | null = null;
  private readonly listeners = new Set<(ids: string[]) => void>();

  // режим квартир (settings.world)
  private readonly W: WorldSettings | null;
  private readonly clusters: Cluster[] = [];
  /** квартира экземпляра (order → id; −1 — вне квартир) */
  private readonly clusterOf: number[] = [];
  /** закрытый выход (dk) → квартира */
  private readonly exitDoors = new Map<number, number>();
  /** «исчезнувшие» двери: индексы lay.links */
  private readonly sealed = new Set<number>();
  /** комнаты, где игрок уже был (order) */
  private readonly visited = new Set<number>();
  private tr = { count: 0, resets: 0, pending: false };
  private readonly pools = new Map<string, Pool>();
  private richPass: Pass | null = null;
  // подвал
  /** стыковка ходов: без предела обзора и бесшовности — ходы длинные по замыслу */
  private readonly tctx: Ctx;
  /** метры хода от прошлого хаба (order → м; −1 — не ход) */
  private readonly tdist: number[] = [];
  private readonly kits = new Map<string, RingKit | null>();
  /** проект с правилами отделки биома поверх своих (наполнение комнат биома) */
  private readonly projs = new Map<string, Project>();
  private hubs = 0;
  private rings = 0;
  private wraps = 0;

  constructor(p: Project, settings: StreamSettings, save?: StreamSave) {
    this.p = p;
    const s = normStream(save ? save.settings : settings);
    this.settings = s;
    this.cellM = p.settings.cellM > 0 ? p.settings.cellM : 0.1;
    this.root = makeRng(seedKey(s.seed, s.mods));
    const lim = s.sightM > 0 ? sightLimits(s.sightM, this.cellM) : null;
    const reach = s.sightM / this.cellM, tol = PVS_TOL_M / this.cellM;
    this.pvsOpt = lim ? { reach, tol } : null;
    const { infos, pool, tooLong } = buildPool(p, s.match, s.sightM, this.cellM);
    this.infos = infos;
    for (const i of infos) if (i) this.byRoom.set(i.room.id, i);
    this.W = s.world;
    // режим квартир: спец-комнаты (лестница, лифт) обычным ростом не ставятся — только переходами
    this.cands = pool.filter((i) => i.weight > 0 && i.effMax > 0 && !(this.W && i.room.location));
    if (this.W) this.richPass = { id: '@rich', name: 'Богатая квартира', priceItemId: '', price: 0, tierBoost: this.W.richBoost, itemBoost: {}, note: '' };
    // веса выбора: ветвистость и модификаторы сида
    for (const i of this.cands) this.wt.set(i, Math.max(0, applyMods(s.mods, i.room, i.weight * branchMul(i.grow, s.branching))));
    this.gen = {
      seed: s.seed, count: 1, gap: s.gap, match: s.match, startRoomId: s.startRoomId, passId: null,
      sightM: s.sightM, fill: false, mode: 'fold', fold: s.fold,
      // режим квартир: ходы и хабы подвала — длинный обзор (validateFoldRun смотрит этот флаг прогона)
      ...(s.world ? { longSight: true } : {}),
    };
    this.ctx = {
      s: this.gen, f: s.fold, gap: s.gap, shapes: new Shapes(s.gap), pool, lim,
      seam: s.fold.seamless && lim ? { reach, tol } : null,
      long: !!s.world,
    };
    this.tctx = { ...this.ctx, lim: null, seam: null };
    this.lay = newLay(s.gap, true);
    if (save) {
      const bad = this.checkSave(save);
      if (bad.length === 0) {
        this.restore(save);
        return;
      }
      this.stale = true;
      this.warnings.push(`Сохранённый мир устарел: ${bad.slice(0, 8).join(', ')}${bad.length > 8 ? ' и др.' : ''} — сохранение отброшено, мир начат заново с того же сида.`);
    }
    if (tooLong.length) {
      this.warnings.push(`Предел обзора ${s.sightM} м: исключены комнаты, внутри которых обзор длиннее — ${tooLong.map((t) => `«${t.room.name}» (${t.m} м)`).join(', ')}.`);
    }
    this.begin();
  }

  // ───────── старт ─────────

  private begin(): void {
    const { p, settings: s } = this;
    let start: Info | null = null;
    if (s.startRoomId) {
      const i = p.rooms.findIndex((r) => r.id === s.startRoomId);
      if (i < 0) this.warnings.push(`Стартовая комната (id ${s.startRoomId}) не найдена — выбрана автоматически.`);
      else if (!this.infos[i]) this.warnings.push(`Стартовая комната «${p.rooms[i].name}» пуста — выбрана автоматически.`);
      else start = this.infos[i];
    }
    // режим квартир: старт — в стартовом биоме (комната с тегом start, растущая в нём, иначе по весам биома); в подвале —
    // хаб (через хабы в подвал входят). Заданная стартовая комната — только если она из тех, с которых биом начинается
    const biome = this.W ? startBiomeOf(this.W) : null;
    if (start && biome && !this.entryPool(biome.id).list.includes(start)) start = null;
    if (!start && biome) {
      const pool = this.entryPool(biome.id);
      const tagged = pool.list.filter((x) => x.room.tags.includes('start'));
      const S = this.root.sub('start');
      if (tagged.length) start = tagged[pickWeighted(S, tagged.map((x) => pool.weightOf(x)))];
      else if (pool.list.length) start = pool.list[pickWeighted(S, pool.list.map((x) => pool.weightOf(x)))];
    }
    if (!start) {
      const tagged = this.infos.filter((x): x is Info => !!x && x.room.tags.includes('start'));
      const S = this.root.sub('start');
      if (tagged.length) start = tagged[pickWeighted(S, tagged.map((x) => x.weight))];
      else if (this.cands.length) start = this.cands[pickWeighted(S, this.cands.map((x) => this.wt.get(x)!))];
    }
    if (!start) {
      this.warnings.push('Нет ни одной комнаты для генерации (нужны клетки и вес > 0).');
      return;
    }
    if (s.sightM > 0) {
      const sm = roomSightM(start.room, this.cellM);
      if (sm > s.sightM + 1e-9) this.warnings.push(`Стартовая комната «${start.room.name}» сама длиннее предела обзора (${sm} м > ${s.sightM} м) — поставлена всё равно.`);
    }
    const t0 = now();
    const n = place(this.ctx, this.lay, start, 0, 0, 0, 0, null);
    if (this.W) {
      const id = biome?.id ?? '';
      const cl = this.newCluster(id, id, !!biome?.rich);
      this.onPlaced(n, null, ROOT_ADDR, true, cl);
      this.beginCluster(cl);
    } else {
      this.onPlaced(n, null, ROOT_ADDR);
      this.setSpine(n);
    }
    this.startId = n.inst.id;
    this.ms += now() - t0;
  }

  // ───────── постановка и двери ─────────

  /** Учёт нового экземпляра (место, связь с родителем и PVS уже в Lay). portal = false — пришли не через дверь
   *  (комната-выход спец-локации, комната за выходом лифта): проёма к родителю нет. cl — квартира (режим квартир). */
  private onPlaced(n: Node, parent: Node | null, addr: string, portal = true, cl: Cluster | null = null): void {
    const lay = this.lay;
    const i = n.inst.order;
    this.addr[i] = addr;
    this.clusterOf[i] = cl ? cl.id : -1;
    if (cl) {
      cl.rooms.push(i);
      if (cl.entry < 0) cl.entry = i;
    }
    this.expandedF[i] = false;
    this.spine[i] = false;
    this.kids[i] = [];
    if (parent) this.kids[parent.inst.order].push(n);
    this.byId.set(n.inst.id, n);
    if (n.info.room.unique) this.uniqueUsed.add(n.info);
    n.conns.forEach((c, ci) => {
      if (c.len < 1 || n.linked[ci]) return;
      this.indexDoor(n, ci);
      // ростовые двери считаются только в прежнем росте (в режиме квартир все комнаты раскрыты сразу)
      if (n.info.grow[ci] && !this.W) this.growPending++;
    });
    // PVS: при бесшовности записан пробой кандидата, без неё — считаем по поставленной геометрии
    if (this.pvsOpt) {
      if ((parent && !this.ctx.seam) || !portal) addPvs(lay, i, computePvs(lay.sight, i, this.pvsOpt.reach, this.pvsOpt.tol));
      this.dirty.add(i);
      for (const m of lay.pvs[i]) this.dirty.add(m);
    }
    // обзор: новые линии — в новой комнате и сквозь её проём
    this.sightAdd(i, parent && portal ? lay.links.length - 1 : null);
    // пересечения в 3D со всеми слоями своего этажа
    this.overlaps += this.conflictsOf(n);
    this.all.add(n);
    if (n.w < this.minW) this.minW = n.w;
    if (n.w > this.maxW) this.maxW = n.w;
    this.addFloor(n.floor);
    if (parent && portal && n.w !== parent.w) this.shifted++;
    // подвал: метры хода от прошлого хаба; у хаба двери-марши наверх — сразу закрытые выходы (не «нераскрытые»)
    if (cl?.tunnels) {
      const hub = tunKind(n.info) === 'hub';
      this.tdist[i] = hub || !parent ? 0 : Math.max(0, this.tdist[parent.inst.order] ?? 0) + this.lenM(n.info);
      if (hub) {
        this.hubs++;
        n.conns.forEach((c, ci) => {
          if (c.len < 1 || n.linked[ci] || c.tag !== HUB_EXIT_TAG) return;
          const key = dk(i, ci);
          cl.exits.push(key);
          this.exitDoors.set(key, cl.id);
        });
      }
    } else this.tdist[i] = -1;
    this.content.push(this.rollFor(n, parent));
  }

  private addFloor(f: number): void {
    this.floorSet.add(f);
    if (f < this.minFloor) this.minFloor = f;
    if (f > this.maxFloor) this.maxFloor = f;
  }

  private conflictsOf(n: Node): number {
    let k = 0;
    this.all.some(n.x0, n.y0, n.x1, n.y1, this.settings.gap, (x) => {
      // другой этаж — над или под, не пересекаются
      if (x.floor === n.floor && this.ctx.shapes.conflict(n.body, x.body)) k++;
      return false;
    });
    return k;
  }

  /** Наполнение — от адреса экземпляра (не от порядка раскрытий). В богатой квартире элитность — с усилением. */
  private rollFor(n: Node, parent: Node | null): InstanceContent {
    const a = this.addr[n.inst.order];
    const cl = this.clusters[this.clusterOf[n.inst.order] ?? -1];
    const pass = cl?.rich ? this.richPass : null;
    const c = rollContent(this.projOf(cl?.biome ?? null), n.info.room, n.inst, this.root.sub(`content:${a}`), pass, this.root.sub(`finish:${a}`));
    c.dangerAcc = (parent ? this.content[parent.inst.order].dangerAcc : 0) + c.danger;
    for (const l of c.loot) this.totals[l.itemId] = (this.totals[l.itemId] ?? 0) + l.count;
    for (const sp of c.spots) if (sp.content && sp.content.kind === 'item') this.totals[sp.content.id] = (this.totals[sp.content.id] ?? 0) + 1;
    return c;
  }

  private sightAdd(room: number | null, portal: number | null): void {
    const S = this.lay.sight;
    for (const r of [room !== null ? S.scanRoom(room, this.cellM) : null, portal !== null ? S.scanPortal(portal, this.cellM) : null]) {
      // сравнение по округлённому значению — как Run.sight.maxM; так и восстановление из сохранения точное
      if (r && round3(r.m) > this.best.m) this.best = { m: round3(r.m), line: r.line };
    }
  }

  private indexDoor(n: Node, ci: number): void {
    const c = n.conns[ci];
    const k = lineKey(c.side, segLine(c));
    const list = this.loopIdx.get(k);
    if (list) list.push({ n, ci });
    else this.loopIdx.set(k, [{ n, ci }]);
  }

  /** Канонический порядок экземпляров: глубина от старта, затем адрес. */
  private canon(a: Node, b: Node): number {
    const d = a.inst.depth - b.inst.depth;
    if (d) return d;
    const x = this.addr[a.inst.order], y = this.addr[b.inst.order];
    return x < y ? -1 : x > y ? 1 : a.inst.order - b.inst.order;
  }

  /** Окрестность для правила max: MAX_WINDOW предков по дереву роста с их детьми (существуют всегда,
   *  когда раскрывается экземпляр, — не зависит от порядка ходьбы). */
  private windowCounts(P: Node): Map<Info, number> {
    const seen = new Set<Node>();
    const cnt = new Map<Info, number>();
    const add = (n: Node) => {
      if (seen.has(n)) return;
      seen.add(n);
      cnt.set(n.info, (cnt.get(n.info) ?? 0) + 1);
    };
    let a: Node | undefined = P;
    for (let k = 0; a && k <= MAX_WINDOW; k++) {
      add(a);
      for (const c of this.kids[a.inst.order]) add(c);
      a = a.inst.parent ? this.byId.get(a.inst.parent) : undefined;
    }
    return cnt;
  }

  /** Есть ли у экземпляра нераскрытая ростовая дверь (может продолжить магистраль). */
  private canGrow(n: Node): boolean {
    return n.conns.some((c, k) => c.len >= 1 && !n.linked[k] && n.info.grow[k]);
  }

  /**
   * Раскрыть экземпляр (§15.4 GENERATOR-4D.md). Если он на магистрали — сначала её продолжение: ростовые
   * двери в порядке room.connectors, повёрнутом на сдвиг root.sub("spine:" + адрес).int(0, k − 1); первая
   * дверь, за которой встала комната с ростовой дверью, передаёт магистраль ей. Затем остальные двери —
   * по порядку room.connectors.
   */
  private expandNode(P: Node): string[] {
    const i = P.inst.order;
    if (this.expandedF[i]) return [];
    const tcl = this.W ? this.clusters[this.clusterOf[i] ?? -1] : undefined;
    if (tcl?.tunnels) return this.expandTunnel(P, tcl);
    const t0 = now();
    this.expandedF[i] = true;
    const win = this.windowCounts(P);
    const out: string[] = [];
    const take = (child: Node | null) => {
      if (!child) return;
      out.push(child.inst.id);
      win.set(child.info, (win.get(child.info) ?? 0) + 1);
    };
    if (this.spine[i]) {
      this.spinePending--;
      const gd: number[] = [];
      P.conns.forEach((c, ci) => { if (c.len >= 1 && !P.linked[ci] && P.info.grow[ci]) gd.push(ci); });
      const off = gd.length > 1 ? this.root.sub(`spine:${this.addr[i]}`).int(0, gd.length - 1) : 0;
      for (let k = 0; k < gd.length; k++) {
        const ci = gd[(off + k) % gd.length];
        if (P.linked[ci] || this.dead.has(dk(i, ci))) continue;
        const child = this.resolve(P, ci, win, true);
        take(child);
        if (child && this.canGrow(child)) { this.setSpine(child); break; }
      }
    }
    for (let ci = 0; ci < P.conns.length; ci++) {
      if (P.conns[ci].len < 1 || P.linked[ci] || this.dead.has(dk(i, ci))) continue;
      take(this.resolve(P, ci, win, false));
    }
    if (this.growPending === 0) this.reopen();
    this.version++;
    const dt = now() - t0;
    this.ms += dt;
    this.times.push(dt);
    return out;
  }

  /**
   * Крайняя мера бесконечности: нераскрытых ростовых дверей не осталось (магистраль и резерв не помогли — подряд
   * не встало ни одной комнаты). Заколоченная по шансу ростовая дверь «расколачивается»: самая глубокая (при
   * равной глубине — с большим адресом); её экземпляр снова нераскрыт и становится магистралью.
   */
  private reopen(): void {
    let best: { n: Node; ci: number } | null = null;
    for (const [k, why] of this.dead) {
      const n = this.lay.nodes[Math.floor(k / 1024)], ci = k % 1024;
      if (why !== 'chance' || !n.info.grow[ci]) continue;
      if (!best || this.canon(n, best.n) > 0 || (n === best.n && ci > best.ci)) best = { n, ci };
    }
    if (!best) return;
    const { n, ci } = best;
    this.dead.delete(dk(n.inst.order, ci));
    this.deadChance--;
    this.expandedF[n.inst.order] = false;
    if (this.spine[n.inst.order]) this.spinePending++;
    else this.setSpine(n);
    this.growPending++;
    this.indexDoor(n, ci);
    this.warnings.push(`Ростовых дверей не осталось — расколочена дверь ${n.inst.id}/${n.info.room.connectors[ci].id} (крайняя мера бесконечности).`);
  }

  private setSpine(n: Node): void {
    this.spine[n.inst.order] = true;
    this.spinePending++;
  }

  /**
   * Решить судьбу двери ci экземпляра P (§15.4 GENERATOR-4D.md). Поток ГСЧ двери D = root.sub("door:" + адрес):
   * 1) D.next() < deadEndChance — тупик по шансу (бросок всегда — поток роста от статуса двери не зависит).
   *    Не применяется к двери магистрали и к ростовой двери при резерве (нераскрытых ростовых дверей в мире
   *    ≤ STREAM_RESERVE);
   * 2) петля: напротив в 3D стоит нераскрытая дверь другого экземпляра — связать (правила fold, без ГСЧ);
   *    у магистрали петель нет — она всегда ведёт в новую комнату;
   * 3) складчатая стыковка (growFrom) на потоке D; у магистрали и при резерве — сначала только комнаты,
   *    дающие рост;
   * 4) ничего не встало — тупик.
   */
  private resolve(P: Node, ci: number, win: Map<Info, number>, spine: boolean): Node | null {
    const grow = P.info.grow[ci];
    const daddr = childAddr(this.addr[P.inst.order], P.info.room.connectors[ci].id);
    const D = this.root.sub(`door:${daddr}`);
    const reserve = grow && this.growPending <= STREAM_RESERVE;
    const roll = D.next() < this.settings.deadEndChance;
    if (grow) this.growPending--;
    if (!spine) {
      if (roll && !reserve) {
        this.markDead(P, ci, 'chance');
        return null;
      }
      if (this.tryLoop(P, ci)) return null;
    }
    const { child, why } = this.grow(P, ci, D, spine || reserve, win);
    if (child) {
      this.grown++;
      this.onPlaced(child, P, daddr);
      // магистраль потеряна (ни одна дверь её комнаты не дала роста) — её подхватывает первая новая комната с ростом
      if (!spine && this.spinePending === 0 && this.canGrow(child)) this.setSpine(child);
      return child;
    }
    this.markDead(P, ci, why);
    return null;
  }

  private markDead(P: Node, ci: number, why: DeadWhy): void {
    this.dead.set(dk(P.inst.order, ci), why);
    if (why === 'chance') this.deadChance++;
    else {
      this.deadFail++;
      if (isWhy(why)) P.why[ci] = why;
    }
  }

  /** Петля к нераскрытой двери напротив (в любом слое); кандидаты — в каноническом порядке. cluster — только к
   *  дверям своей квартиры (режим квартир). */
  private tryLoop(P: Node, ci: number, cluster?: number, ctx: Ctx = this.ctx): boolean {
    const A = P.conns[ci];
    const gap = this.settings.gap;
    const list = this.loopIdx.get(lineKey(OPPOSITE[A.side], segLine(A) + gap * OUT_SIGN[A.side]));
    if (!list) return false;
    const found: DoorRef[] = [];
    let w = 0;
    for (const d of list) {
      if (d.n.linked[d.ci] || this.expandedF[d.n.inst.order]) continue; // дверь уже решена — вычистить
      list[w++] = d;
      const B = d.n.conns[d.ci];
      if (cluster !== undefined && this.clusterOf[d.n.inst.order] !== cluster) continue;
      if (d.n !== P && d.n.floor === P.floor && compatible(A, B, this.settings.match) && facing(A, B, gap)) found.push(d);
    }
    list.length = w;
    if (found.length === 0) return false;
    found.sort((a, b) => this.canon(a.n, b.n) || a.ci - b.ci);
    for (const d of found) {
      if (!tryLink(ctx, this.lay, P, ci, d.n, d.ci, ctx.seam ? null : this.pvsOpt)) continue;
      if (d.n.info.grow[d.ci]) this.growPending--;
      this.loops++;
      const x = P.inst.order, y = d.n.inst.order;
      if (P.w !== d.n.w) this.shifted++;
      this.sightAdd(null, this.lay.links.length - 1);
      if (this.pvsOpt) for (const z of [x, y, ...this.lay.pvs[x], ...this.lay.pvs[y]]) this.dirty.add(z);
      return true;
    }
    return false;
  }

  /** Кандидаты и складчатая стыковка к двери ci экземпляра P. pool — комнаты и веса биома (режим квартир). */
  /** growMin > 0 (режим квартир) — только комнаты, у которых кроме двери стыковки не меньше growMin дверей (запас под
   *  выходы квартиры), без отступления к любым. */
  private grow(P: Node, ci: number, D: Rng, growFirst: boolean, win: Map<Info, number>, pool: Pool | null = null, growMin = 0): { child: Node | null; why: Why } {
    const A = P.conns[ci];
    const match = this.settings.match;
    // все совместимые комнаты; запрещённые сейчас (unique уже стоит, max в окрестности) остаются в списке
    // весов и пропускаются, только если выпали, — выбор остальных от них не зависит
    const g = (pool ? pool.list : this.cands).filter((info) => info.room.connectors.some((b) => b.len >= 1 && compatible(A, b, match)));
    let skipped = 0;
    const skip = (info: Info) => {
      const no = (info.room.unique && this.uniqueUsed.has(info)) || (win.get(info) ?? 0) >= info.effMax;
      if (no) skipped++;
      return no;
    };
    const fails: Fails = { space: 0, rule: 0, sight: 0, seam: 0 };
    const opts = { weightOf: pool ? pool.weightOf : (x: Info) => this.wt.get(x) ?? x.weight, skip, stick: true };
    for (const growOnly of growMin > 0 ? [true] : growFirst ? [true, false] : [false]) {
      const okB = (info: Info, b: Room['connectors'][number], bi: number) =>
        b.len >= 1 && compatible(A, b, match) && (!growOnly || (growMin > 0 ? doorsBesides(info, bi) >= growMin : growOthers(info, bi) > 0));
      const group = growOnly ? g.filter((info) => info.room.connectors.some((b, bi) => okB(info, b, bi))) : g;
      const child = growFrom(this.ctx, this.lay, P, ci, [group], okB, D, fails, opts);
      if (child) return { child, why: 'space' };
    }
    const tried = fails.space + fails.rule + fails.sight + fails.seam > 0;
    const why: Why = tried
      ? fails.sight > 0 ? 'sight' : fails.seam > 0 ? 'seam' : fails.rule > 0 && fails.space === 0 ? 'rule' : 'space'
      : skipped > 0 ? 'max' : 'nomatch';
    return { child: null, why };
  }

  // ───────── публичное API ─────────

  private notify(ids: string[], v0: number): void {
    if (this.version === v0) return;
    for (const cb of [...this.listeners]) cb(ids.slice());
  }

  expand(instId: string): string[] {
    const n = this.byId.get(instId);
    if (!n) return [];
    const v0 = this.version;
    const out = this.expandNode(n);
    this.notify(out, v0);
    return out;
  }

  ensureAround(instId: string, doors: number = this.settings.aheadDoors): string[] {
    const n = this.byId.get(instId);
    const d = Math.floor(doors);
    if (!n || !(d >= 1)) return [];
    const v0 = this.version;
    const out: string[] = [];
    // каноническая очередь: из нераскрытых в окне (расстояние < doors по графу) — минимальный по (глубина,
    // адрес); после каждого раскрытия окно пересчитывается (в нём появились новые комнаты)
    for (;;) {
      let best: Node | null = null;
      for (const x of around(n, d - 1).keys()) if (!this.expandedF[x.inst.order] && (!best || this.canon(x, best) < 0)) best = x;
      if (!best) break;
      out.push(...this.expandNode(best));
    }
    this.notify(out, v0);
    return out;
  }

  ensureVisible(instId: string, reachM: number = viewHorizonM(this.settings.sightM)): string[] {
    const n = this.byId.get(instId);
    if (!n) return [];
    const i = n.inst.order;
    const reach = Number.isFinite(reachM) && reachM > 0 ? reachM / this.cellM : 0;
    // дальше PVS (sightM) — свой PVS с дальностью reach по текущей геометрии (он только растёт с миром)
    const wide = reach > (this.pvsOpt?.reach ?? 0) + 1e-9;
    if (!this.pvsOpt && !wide) return [];
    const v0 = this.version;
    const out: string[] = [];
    for (;;) {
      // 1) PVS экземпляра — как раньше: каждый раз минимальный по (глубина, адрес)
      let best: Node | null = null;
      if (this.pvsOpt) {
        for (const m of this.lay.pvs[i]) {
          const x = this.lay.nodes[m];
          if (!this.expandedF[m] && (!best || this.canon(x, best) < 0)) best = x;
        }
      }
      if (best) {
        out.push(...this.expandNode(best));
        continue;
      }
      if (!wide) break;
      // 2) дальний PVS: все нераскрытые в каноническом порядке, затем пересчёт (раскрытые добавили проёмы)
      const todo = computePvs(this.lay.sight, i, reach, PVS_TOL_M / this.cellM)
        .filter((m) => !this.expandedF[m])
        .map((m) => this.lay.nodes[m])
        .sort((a, b) => this.canon(a, b));
      if (!todo.length) break;
      for (const x of todo) out.push(...this.expandNode(x));
    }
    this.notify(out, v0);
    return out;
  }

  isExpanded(instId: string): boolean {
    const n = this.byId.get(instId);
    return !!n && this.expandedF[n.inst.order];
  }

  doorState(instId: string, connectorId: string): DoorState | null {
    const n = this.byId.get(instId);
    if (!n) return null;
    const ci = n.info.room.connectors.findIndex((c) => c.id === connectorId);
    if (ci < 0) return null;
    if (n.linked[ci]) {
      // «исчезнувшая» дверь (пропущенный переход) — глухая
      for (const li of this.sealed) {
        const l = this.lay.links[li];
        if ((l.a.inst === instId && l.a.connector === connectorId) || (l.b.inst === instId && l.b.connector === connectorId)) return 'dead';
      }
      return 'linked';
    }
    const key = dk(n.inst.order, ci);
    if (this.exitDoors.has(key)) return 'exit';
    return this.dead.has(key) ? 'dead' : 'pending';
  }

  addressOf(instId: string): string | null {
    const n = this.byId.get(instId);
    return n ? this.addr[n.inst.order] : null;
  }

  // ───────── спец-локации: переход вниз и выходы лифта ─────────

  locationOf(instId: string): LocationInfo | null {
    const n = this.byId.get(instId);
    const spec = n?.info.room.location;
    if (!n || !spec) return null;
    if (spec.kind === 'stairwell') return { kind: 'stairwell', spec, roll: this.rollOf(n, spec) };
    if (spec.kind === 'lift') return { kind: 'lift', spec, roll: rollLift(spec, this.locKey(n)) };
    return { kind: 'lair', spec, roll: null };
  }

  private locKey(n: Node): string {
    return locationSeedKey(seedKey(this.settings.seed, this.settings.mods), this.addr[n.inst.order]);
  }

  private rollOf(n: Node, spec: StairwellSpec): StairwellRoll {
    return rollStairwell(spec, this.locKey(n));
  }

  exitOf(instId: string): string | null {
    const n = this.byId.get(instId);
    return n ? this.exitBy.get(n.inst.order)?.inst.id ?? null : null;
  }

  descend(instId: string): string {
    const L = this.byId.get(instId);
    if (!L) throw new Error(`descend: нет экземпляра ${instId}`);
    const spec = L.info.room.location;
    if (!spec) throw new Error(`descend: у экземпляра ${instId} («${L.info.room.name}») нет спец-локации`);
    if (spec.kind !== 'stairwell') throw new Error(`descend: у экземпляра ${instId} («${L.info.room.name}») не лестница, а ${spec.kind}`);
    const had = this.exitBy.get(L.inst.order);
    if (had) return had.inst.id;
    const v0 = this.version;
    const t0 = now();
    const exit = this.placeExit(L, spec);
    // прошёл через переход — счётчик переходов с нуля
    this.resetTransitions();
    this.version++;
    this.ms += now() - t0;
    this.notify([exit.inst.id], v0);
    return exit.inst.id;
  }

  /**
   * Комната-выход локации L (docs/LOCATIONS.md, «Переход вниз»). Поток ГСЧ E = root.sub("descent:" + адрес L):
   * 1) k = rollStairwell(spec, locationSeedKey(seedKey, адрес L)).floorsDown — этаж выхода floor(L) − k;
   * 2) комната — pickExit(E): площадка/коридор с маршем (метка 'stair'), за которым есть куда расти; по весу;
   * 3) метка прихода — E.int по списку её маршей; поворот — E.int(0, 3) · 90°;
   * 4) место — центр выхода под центром L в плане; слой — первый свободный на этаже выхода: W(L), затем ±1, ±2…
   *    (при равном |ΔW| — сначала к 0); нет ни одного — то же по кольцам сдвигов в плане.
   * Метка прихода связана (связь kind 'descent', floors = k); адрес выхода — childAddr(адрес L, DESCENT_CONN);
   * выход — начало своей магистрали (ветка этажа ниже бесконечна сама по себе).
   */
  private placeExit(L: Node, spec: StairwellSpec): Node {
    const addr = this.addr[L.inst.order];
    const k = this.rollOf(L, spec).floorsDown;
    const floor = L.floor - k;
    const E = this.root.sub(`descent:${addr}`);
    const dest = this.W ? this.transitionTarget(L, `descent:${addr}`) : null;
    const pick = this.pickExit(E, ARRIVAL_TAG, dest ? this.entryPool(dest.biome) : null);
    if (!pick) throw new Error(`descend: в проекте нет комнаты-выхода для «${L.info.room.name}» (нужна комната с меткой)`);
    const { info, arrive } = pick;
    const ci = arrive[E.int(0, arrive.length - 1)];
    const rot = (E.int(0, 3) * 90) as Rot;
    const sh = this.ctx.shapes.get(info.room, rot);
    const cx = Math.round((L.x0 + L.x1 - sh.x0 - sh.x1) / 2), cy = Math.round((L.y0 + L.y1 - sh.y0 - sh.y1) / 2);
    const { dx, dy, w } = this.spotNear(info, rot, cx, cy, L.w, floor, 'descend');
    const n = place(this.ctx, this.lay, info, rot, dx, dy, w, L, floor);
    n.linked[ci] = true;
    this.trans.push({ a: { inst: L.inst.id, connector: '' }, b: { inst: n.inst.id, connector: info.room.connectors[ci].id }, kind: 'descent', floors: k });
    this.exitBy.set(L.inst.order, n);
    if (dest) {
      // режим квартир: за переходом — квартира другого биома, богатая квартира или подвал (хаб)
      const cl = this.newCluster(dest.biome, dest.home, dest.rich);
      this.onPlaced(n, L, childAddr(addr, DESCENT_CONN), false, cl);
      this.beginCluster(cl);
      return n;
    }
    this.onPlaced(n, L, childAddr(addr, DESCENT_CONN), false);
    if (this.canGrow(n)) this.setSpine(n);
    return n;
  }

  /**
   * Выбор комнаты-выхода (один взвешенный бросок): кандидаты — комнаты пула без спец-локации (unique — если ещё
   * не стоит), по ступеням, первая непустая:
   *  1) тег из EXIT_TAGS и метка прихода с тегом tag, кроме которой есть ростовая метка — приходят через неё
   *     (спуск: tag = ARRIVAL_TAG — марш; лифт: tag = LIFT_ARRIVAL_TAG — проём 1.3 м);
   *  2) то же без требования тега комнаты;
   *  3) тег из EXIT_TAGS или 'start' и ≥ 2 меток — приходят через любую, кроме которой есть ростовая;
   *  4) любая комната с меткой.
   * Вес — как при росте (weight × ветвистость × модификаторы). arrive — индексы меток прихода. pool — комнаты и веса
   * биома (режим квартир; в нём ступени 1–3 — из пула биома, 4 — любые).
   */
  private pickExit(E: Rng, tag: string, pool: Pool | null = null): { info: Info; arrive: number[] } | null {
    const ok = (i: Info) => !i.room.location && !(i.room.unique && this.uniqueUsed.has(i)) && i.room.connectors.some((c) => c.len >= 1);
    const tagged = (i: Info, extra: string[] = []) => i.room.tags.some((t) => EXIT_TAGS.includes(t) || extra.includes(t));
    // метки прихода ci: кроме ci есть ростовая метка (мир пойдёт дальше)
    const via = (i: Info, need: boolean) => i.room.connectors
      .map((c, ci) => (c.len >= 1 && (!need || c.tag === tag) && i.grow.some((g, j) => g && j !== ci) ? ci : -1))
      .filter((ci) => ci >= 0);
    const any = (i: Info) => {
      const v = via(i, false);
      return v.length ? v : i.room.connectors.map((c, ci) => (c.len >= 1 ? ci : -1)).filter((ci) => ci >= 0);
    };
    const all = this.infos.filter((x): x is Info => !!x);
    const cands = pool ? pool.list : this.cands;
    const tiers: [Info[], (i: Info) => number[]][] = [
      [cands.filter((i) => ok(i) && tagged(i)), (i) => via(i, true)],
      [cands.filter(ok), (i) => via(i, true)],
      [cands.filter((i) => ok(i) && tagged(i, ['start']) && i.room.connectors.filter((c) => c.len >= 1).length >= 2), (i) => via(i, false)],
      // в биоме — любая его комната с меткой (приходят через любую), затем любая комната вообще
      ...(pool ? [[cands.filter(ok), any] as [Info[], (i: Info) => number[]]] : []),
      [all.filter(ok), any],
    ];
    for (const [list, arr] of tiers) {
      const c = list.map((info) => ({ info, arrive: arr(info) })).filter((x) => x.arrive.length > 0);
      if (c.length === 0) continue;
      const wOf = (x: Info) => (pool && pool.weightOf(x) > 0 ? pool.weightOf(x) : this.wt.get(x) ?? x.weight);
      return c[pickWeighted(E, c.map((x) => wOf(x.info)))];
    }
    return null;
  }

  /**
   * Место и слой комнаты на этаже floor: сначала сдвиг (cx, cy) — слой w0, затем ±1, ±2… (при равном |ΔW| —
   * сначала к 0); если весь столбец слоёв занят — то же по кольцам сдвигов в плане (шаг — габарит комнаты + gap).
   * Спуск: (cx, cy) — центр выхода под центром лестницы; лифт — комната, пристыкованная к стороне шахты.
   */
  private spotNear(info: Info, rot: Rot, cx: number, cy: number, w0: number, floor: number, who: string): { dx: number; dy: number; w: number } {
    const sh = this.ctx.shapes.get(info.room, rot);
    const g = this.settings.gap;
    const M = this.settings.fold.maxLayer;
    const ws = [w0];
    for (let k = 1; k <= 2 * M + 1; k++) {
      const a = w0 <= 0 ? k : -k;
      ws.push(w0 + a, w0 - a);
    }
    const layers = ws.filter((w) => Math.abs(w) <= M);
    const sx = sh.x1 - sh.x0 + g, sy = sh.y1 - sh.y0 + g;
    const inside = (dx: number, dy: number) => sh.x0 + dx - g >= -LIMIT && sh.y0 + dy - g >= -LIMIT && sh.x1 + dx + g <= LIMIT && sh.y1 + dy + g <= LIMIT;
    for (let r = 0; r <= 64; r++) {
      for (let i = -r; i <= r; i++) {
        for (let j = -r; j <= r; j++) {
          if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
          const dx = cx + i * sx, dy = cy + j * sy;
          if (!inside(dx, dy)) continue;
          const body: Body = { sh, dx, dy };
          for (const w of layers) if (layerFree(this.ctx, this.lay, w, body, floor)) return { dx, dy, w };
        }
      }
    }
    throw new Error(`${who}: на этаже ${floor} нет места для «${info.room.name}»`);
  }

  // ───────── выходы лифта (ascend) ─────────

  /** Розыгрыш лифта L (ошибка, если L не лифт). */
  private liftOf(L: Node, who: string): LiftRoll {
    const spec = L.info.room.location;
    if (spec?.kind !== 'lift') {
      throw new Error(`${who}: у экземпляра ${L.inst.id} («${L.info.room.name}») ${spec ? `не лифт, а ${spec.kind}` : 'нет спец-локации'}`);
    }
    return rollLift(spec, this.locKey(L));
  }

  liftExitOf(instId: string, floor: number, side: LiftSide): string | null {
    const n = this.byId.get(instId);
    return n ? this.liftBy.get(`${n.inst.order}:${floor}:${side}`)?.inst.id ?? null : null;
  }

  ascend(instId: string, floor: number, side: LiftSide): string {
    const L = this.byId.get(instId);
    if (!L) throw new Error(`ascend: нет экземпляра ${instId}`);
    const roll = this.liftOf(L, 'ascend');
    if (side !== 'straight' && side !== 'right') throw new Error(`ascend: выход «${String(side)}» — бывает только 'straight' (прямо) или 'right' (направо)`);
    if (!Number.isInteger(floor) || floor === 0 || floor < -roll.down || floor > roll.floors) {
      throw new Error(`ascend: у лифта ${instId} этажи с выходами −${roll.down}…−1 и 1…${roll.floors}, а запрошен ${floor}`);
    }
    const had = this.liftBy.get(`${L.inst.order}:${floor}:${side}`);
    if (had) return had.inst.id;
    const v0 = this.version;
    const t0 = now();
    const exit = this.placeLiftExit(L, roll, floor, side);
    // прошёл через переход — счётчик переходов с нуля
    this.resetTransitions();
    this.version++;
    this.ms += now() - t0;
    this.notify([exit.inst.id], v0);
    return exit.inst.id;
  }

  /**
   * Комната за выходом side лифта L на этаже floor над входом (docs/LOCATIONS.md, «Переход вверх»). Поток ГСЧ
   * E = root.sub("lift:" + адрес L + ":" + floor + ":" + side) — свой на каждый выход, поэтому порядок вызовов для
   * разных (floor, side) ни на что не влияет:
   * 1) этаж комнаты — floor(L) + floor;
   * 2) комната: если (floor, side) — логово по розыгрышу (roll.lair) — pickLair(E); нет комнаты-логова в проекте —
   *    обычный выход (предупреждение). Обычный выход — pickExit(E, LIFT_ARRIVAL_TAG): коридор/площадка с проёмом
   *    1.3 м ('corridor'), кроме которого есть куда расти; по весу;
   * 3) метка прихода — E.int по списку меток прихода;
   * 4) место — комната пристыкована к стороне шахты (liftWall): метка прихода лицом к стороне, по её центру, через
   *    gap (как обычная стыковка); слой — первый свободный на этаже: W(L), затем ±1, ±2… (сначала к 0); весь
   *    столбец занят — кольца сдвигов вокруг пристыкованного места (тогда комната не у шахты — это допустимо:
   *    игрока всё равно переводит сцена лифта).
   * Метка прихода связана (связь kind 'lift', floors, side); адрес — childAddr(адрес L, liftConn(floor, side));
   * комната — ребёнок лифта, начало своей магистрали (если может расти).
   */
  private placeLiftExit(L: Node, roll: LiftRoll, floor: number, side: LiftSide): Node {
    const addr = this.addr[L.inst.order];
    const fl = L.floor + floor;
    const E = this.root.sub(`lift:${addr}:${floor}:${side}`);
    let pick: { info: Info; arrive: number[] } | null = null;
    if (isLair(roll, floor, side)) {
      pick = this.pickLair(E);
      if (!pick) {
        this.warnings.push(`Лифт ${L.inst.id} («${L.info.room.name}»): за выходом ${side === 'straight' ? 'прямо' : 'направо'} на этаже +${floor} ` +
          'по розыгрышу логово, но в проекте нет комнаты-логова (спец-локация «Логово босса» с меткой) — поставлен обычный выход.');
      }
    }
    const lair = !!pick;
    const dest = this.W ? this.transitionTarget(L, `lift:${addr}:${floor}:${side}`) : null;
    pick ??= this.pickExit(E, LIFT_ARRIVAL_TAG, dest ? this.entryPool(dest.biome) : null);
    if (!pick) throw new Error(`ascend: в проекте нет комнаты для выхода лифта «${L.info.room.name}» (нужна комната с меткой)`);
    const { info, arrive } = pick;
    const ci = arrive[E.int(0, arrive.length - 1)];
    // стыковка к стороне шахты: виртуальная метка на всю сторону, метка прихода — лицом к ней, по центру, через gap
    const wall = liftWall(L.conns, L.inst.rot, side);
    const rot = rotFor(info.room.connectors[ci].side, OPPOSITE[wall]);
    const sh = this.ctx.shapes.get(info.room, rot);
    const B = sh.conns[ci];
    const t = dockTarget(shaftSide(L, wall), B.len, this.settings.gap);
    const { dx, dy, w } = this.spotNear(info, rot, t.cx - B.cx, t.cy - B.cy, L.w, fl, 'ascend');
    const n = place(this.ctx, this.lay, info, rot, dx, dy, w, L, fl);
    n.linked[ci] = true;
    this.trans.push({ a: { inst: L.inst.id, connector: '' }, b: { inst: n.inst.id, connector: info.room.connectors[ci].id }, kind: 'lift', floors: floor, side });
    this.liftBy.set(`${L.inst.order}:${floor}:${side}`, n);
    if (dest) {
      // режим квартир: за выходом — квартира другого биома / богатая квартира; логово — тупик в биоме, откуда пришли
      const cl = lair ? this.newCluster(dest.home, dest.home, false, false) : this.newCluster(dest.biome, dest.home, dest.rich);
      this.onPlaced(n, L, childAddr(addr, liftConn(floor, side)), false, cl);
      this.beginCluster(cl);
      return n;
    }
    this.onPlaced(n, L, childAddr(addr, liftConn(floor, side)), false);
    if (this.canGrow(n)) this.setSpine(n);
    return n;
  }

  /**
   * Комната-логово: комнаты проекта со спец-локацией kind 'lair' (вес роста у них обычно 0 — сами не растут) и
   * меткой; unique — если ещё не стоит. Несколько — взвешенно по весу роста (у всех 0 — поровну), одна — без броска.
   * Метки прихода — с тегом LIFT_ARRIVAL_TAG, нет таких — любые.
   */
  private pickLair(E: Rng): { info: Info; arrive: number[] } | null {
    const c: { info: Info; arrive: number[] }[] = [];
    for (const info of this.infos) {
      if (!info || info.room.location?.kind !== 'lair' || (info.room.unique && this.uniqueUsed.has(info))) continue;
      const idx = (f: (x: Connector) => boolean) => info.room.connectors.map((x, i) => (x.len >= 1 && f(x) ? i : -1)).filter((i) => i >= 0);
      const tagged = idx((x) => x.tag === LIFT_ARRIVAL_TAG);
      const arrive = tagged.length ? tagged : idx(() => true);
      if (arrive.length) c.push({ info, arrive });
    }
    if (c.length <= 1) return c[0] ?? null;
    const ws = c.map((x) => x.info.weight);
    return c[pickWeighted(E, ws.some((v) => v > 0) ? ws : ws.map(() => 1))];
  }

  // ───────── режим квартир (docs/GENERATOR-4D.md §16) ─────────

  /** Комнаты биома и их веса: вес роста × ветвистость × модификаторы × множитель биома (0 — не растёт). Нет биома с
   *  таким id — все комнаты пула с прежними весами. */
  private biomePool(id: string): Pool {
    let p = this.pools.get(id);
    if (!p) {
      const b = this.W?.biomes.find((x) => x.id === id) ?? null;
      const w = new Map<Info, number>();
      for (const i of this.cands) {
        const v = (this.wt.get(i) ?? i.weight) * (b ? biomeMul(b, i.room) : 1);
        if (v > 0) w.set(i, v);
      }
      p = { list: [...w.keys()], weightOf: (x) => w.get(x) ?? 0 };
      this.pools.set(id, p);
    }
    return p;
  }

  /** tunnels — по умолчанию по биому (layout 'tunnels'); логово — всегда «квартира». */
  private newCluster(biome: string, home: string, rich: boolean, tunnels?: boolean): Cluster {
    const t = tunnels ?? isTunnels(this.W?.biomes.find((b) => b.id === biome));
    const cl: Cluster = { id: this.clusters.length, biome, home, rich, entry: -1, rooms: [], exits: [], opened: [], transition: null, tunnels: t };
    this.clusters.push(cl);
    return cl;
  }

  /** Квартира — вырастить целиком (fillCluster); подвал — растёт на ходу: от входа отсчёт метров до хаба. */
  private beginCluster(cl: Cluster): void {
    if (!cl.tunnels) {
      this.fillCluster(cl);
      return;
    }
    if (cl.entry >= 0 && (this.tdist[cl.entry] ?? -1) < 0) this.tdist[cl.entry] = 0;
  }

  /** Комнаты, которыми начинается квартира биома: в подвале — хабы (есть — только они), иначе весь пул биома. */
  private entryPool(biome: string): Pool {
    const b = this.W?.biomes.find((x) => x.id === biome);
    if (!isTunnels(b)) return this.biomePool(biome);
    const hubs = this.tunPool(biome, 'hub');
    return hubs.list.length ? hubs : this.biomePool(biome);
  }

  /**
   * Вырастить квартиру от её входной комнаты (уже поставлена). Поток ГСЧ квартиры C = root.sub("cluster:" + адрес входа):
   * N = C.int(clusterRooms), K = C.int(clusterExits). Открытые двери комнат квартиры — две очереди по порядку постановки:
   * внутренние (OUTER_TAGS нет) — первыми, чтобы квартиры достраивались; наружные — когда внутренних нет. Для двери:
   * петля к двери своей квартиры напротив — связать; иначе складчатая стыковка из пула биома на потоке двери (как обычный
   * рост); у наружной двери, когда наружных впереди меньше K + 1, — сначала комнаты, дающие рост. Запас под выходы:
   * открытых дверей (с текущей) не больше clusterExits[0] — за дверью встаёт только комната, дающая рост, петля не
   * замыкается (−2 двери); не встала — дверь остаётся под выход (стена 'cluster', см. ниже). Иначе замкнутая квартира
   * (все двери связаны, как у квартиры за входной дверью) осталась бы без выходов. Набрали N комнат —
   * оставшиеся внутренние двери — стены ('cluster'); из оставшихся наружных K (C.shuffle) — закрытые выходы, остальные —
   * стены. Выходов меньше clusterExits[0] — выходами становятся глухие двери квартиры (сначала наружные). Все комнаты
   * квартиры — раскрыты (ensureAround / ensureVisible их не трогают).
   */
  private fillCluster(cl: Cluster): void {
    const W = this.W!;
    const E = this.lay.nodes[cl.entry];
    const C = this.root.sub(`cluster:${this.addr[cl.entry]}`);
    const N = C.int(W.clusterRooms[0], W.clusterRooms[1]);
    const K = C.int(W.clusterExits[0], W.clusterExits[1]);
    const Kmin = W.clusterExits[0];
    const pool = this.biomePool(cl.biome);
    const win = this.windowCounts(E);
    const inner: DoorRef[] = [], outer: DoorRef[] = [];
    let ii = 0, oi = 0;
    const open = (n: Node, ci: number) => n.conns[ci].len >= 1 && !n.linked[ci] && !this.dead.has(dk(n.inst.order, ci)) && !this.exitDoors.has(dk(n.inst.order, ci));
    const push = (n: Node) => n.conns.forEach((c, ci) => { if (open(n, ci)) (OUTER_TAGS.includes(c.tag) ? outer : inner).push({ n, ci }); });
    push(E);
    /** открытых дверей в очередях, начиная с текущих позиций */
    const openLeft = () => {
      let k = 0;
      for (let j = ii; j < inner.length; j++) if (open(inner[j].n, inner[j].ci)) k++;
      for (let j = oi; j < outer.length; j++) if (open(outer[j].n, outer[j].ci)) k++;
      return k;
    };
    while (cl.rooms.length < N) {
      const isIn = ii < inner.length;
      if (!isIn && oi >= outer.length) break;
      const { n: P, ci } = isIn ? inner[ii] : outer[oi];
      if (!open(P, ci)) {
        if (isIn) ii++;
        else oi++;
        continue;
      }
      const left = openLeft();
      if (isIn) ii++;
      else oi++;
      const reserve = left <= Kmin;
      if (left - 2 >= Kmin && this.tryLoop(P, ci, cl.id)) continue;
      const daddr = childAddr(this.addr[P.inst.order], P.info.room.connectors[ci].id);
      const scarce = reserve || (!isIn && outer.length - oi < K + 1);
      const { child, why } = this.grow(P, ci, this.root.sub(`door:${daddr}`), scarce, win, pool, reserve ? 1 : 0);
      if (!child) {
        this.markDead(P, ci, reserve ? 'cluster' : why);
        continue;
      }
      this.grown++;
      this.onPlaced(child, P, daddr, true, cl);
      win.set(child.info, (win.get(child.info) ?? 0) + 1);
      push(child);
    }
    for (const { n, ci } of inner.slice(ii)) if (open(n, ci)) this.markDead(n, ci, 'cluster');
    const rest = outer.slice(oi).filter(({ n, ci }) => open(n, ci));
    const order = C.shuffle(rest.map((_, i) => i));
    const take = new Set(order.slice(0, K));
    rest.forEach(({ n, ci }, i) => {
      if (take.has(i)) {
        const key = dk(n.inst.order, ci);
        cl.exits.push(key);
        this.exitDoors.set(key, cl.id);
      } else this.markDead(n, ci, 'cluster');
    });
    // выходов меньше минимума (двери ушли на рост или за ними ничего не встало) — выходами становятся глухие двери
    // квартиры от входа: наружные неиспользованные, наружные, где не встало (при открытии пробуются снова, в т.ч. другие
    // слои), затем так же внутренние, — квартира без выходов остановила бы мир
    const need = W.clusterExits[0] - cl.exits.length;
    if (need > 0) {
      const lists: number[][] = [[], [], [], []];
      for (const i of cl.rooms) {
        const n = this.lay.nodes[i];
        n.conns.forEach((c, ci) => {
          const key = dk(i, ci);
          const why = this.dead.get(key);
          if (c.len < 1 || n.linked[ci] || why === undefined || why === 'vanished' || why === 'chance') return;
          lists[(OUTER_TAGS.includes(c.tag) ? 0 : 2) + (why === 'cluster' ? 0 : 1)].push(key);
        });
      }
      for (const key of lists.flat().slice(0, need)) {
        this.dead.delete(key);
        this.deadFail--;
        cl.exits.push(key);
        this.exitDoors.set(key, cl.id);
      }
    }
    for (const i of cl.rooms) this.expandedF[i] = true;
  }

  openDoor(instId: string, connectorId: string): string | null {
    if (!this.W) throw new Error('openDoor: мир без квартир (settings.world = null)');
    const n = this.byId.get(instId);
    if (!n) throw new Error(`openDoor: нет экземпляра ${instId}`);
    const ci = n.info.room.connectors.findIndex((c) => c.id === connectorId);
    const key = dk(n.inst.order, ci);
    const cid = ci < 0 ? undefined : this.exitDoors.get(key);
    if (cid === undefined) throw new Error(`openDoor: ${instId}/${connectorId} — не закрытый выход квартиры`);
    const cl = this.clusters[cid];
    const v0 = this.version;
    const t0 = now();
    // выпал переход — он прямо за этой дверью (100%); игрок из квартиры не ушёл: остальные выходы на месте, а если он
    // пойдёт через другой выход, не зайдя в переход, — переход исчезнет
    if (this.tr.pending) {
      const t = this.placeTransition(cl, [{ n, ci }]);
      if (t) {
        this.version++;
        this.ms += now() - t0;
        this.notify([t.inst.id], v0);
        return t.inst.id;
      }
    }
    const daddr = childAddr(this.addr[n.inst.order], connectorId);
    const win = this.windowCounts(n);
    this.exitDoors.delete(key);
    cl.exits = cl.exits.filter((e) => e !== key);
    // подвал: «Спуск в подвал» (выход с меткой хода) — в подвал, в хаб; выход хаба наверх — в квартиры
    const W = this.W;
    if (!cl.tunnels && n.conns[ci].tag === TUNNEL_TAG && tunnelBiomes(W).length) {
      const bs = tunnelBiomes(W);
      const target = bs[this.root.sub(`basement:${daddr}`).int(0, bs.length - 1)].id;
      const hubs = this.tunPool(target, 'hub');
      const D = () => this.root.sub(`door:${daddr}`);
      const child = this.grow(n, ci, D(), true, win, hubs).child ?? this.growLoose(n, ci, D(), win, hubs, 1);
      if (child) {
        const ncl = this.newCluster(target, cl.home, false, true);
        cl.opened.push(key);
        this.grown++;
        this.onPlaced(child, n, daddr, true, ncl);
        this.beginCluster(ncl);
        // выпавший, но не вставший за дверью переход встанет за ближайшим проходом хода (tunnelStep)
        const ids = [child.inst.id];
        this.vanishExits(cl);
        this.version++;
        const dt = now() - t0;
        this.ms += dt;
        this.times.push(dt);
        this.notify(ids, v0);
        return child.inst.id;
      }
    }
    // за дверью — квартира того же биома (у богатой квартиры — биома, откуда в неё пришли; из подвала — наверх, в квартиры
    // биома, откуда в подвал спустились). Вход — комната с запасом
    // дверей: сначала не меньше clusterExits[0] ростовых, потом хоть одна (из биома, затем из любых комнат), и только
    // потом любая — тупиковая комната за дверью (санузел, балкон) оставила бы квартиру без выходов
    // потом любая — тупиковая комната за дверью (санузел, балкон) оставила бы квартиру без выходов. По меткам с запасом
    // не встаёт (за дверью прихожая → комната — только комнаты-тупики) — вход стыкуется любой своей дверью (4D-шов, как
    // у перехода; связь loose): прихожая, площадка, коридор другой квартиры
    const up = cl.tunnels ? this.upBiome(cl, daddr) : cl.home;
    const ncl = this.newCluster(up, up, false);
    const home = this.biomePool(up);
    const Kmin = this.W.clusterExits[0];
    const D = () => this.root.sub(`door:${daddr}`);
    const tries: (() => Node | null)[] = [
      () => this.grow(n, ci, D(), true, win, home, Kmin + 2).child,
      () => this.growLoose(n, ci, D(), win, home, Kmin + 2),
      () => this.grow(n, ci, D(), true, win, home, Kmin).child,
      () => this.growLoose(n, ci, D(), win, home, Kmin),
      () => this.grow(n, ci, D(), true, win, null, Kmin).child,
      () => this.growLoose(n, ci, D(), win, null, Kmin),
      () => this.grow(n, ci, D(), true, win, home, 1).child,
      () => this.growLoose(n, ci, D(), win, home, 1),
      () => this.grow(n, ci, D(), true, win, null, 1).child,
      () => this.grow(n, ci, D(), true, win, home).child,
      () => this.grow(n, ci, D(), true, win, null).child,
    ];
    let child: Node | null = null;
    for (const t of tries) if ((child = t())) break;
    if (!child) {
      this.clusters.pop();
      this.markDead(n, ci, 'space');
      this.version++;
      this.ms += now() - t0;
      this.notify([], v0);
      return null;
    }
    cl.opened.push(key);
    this.grown++;
    this.onPlaced(child, n, daddr, true, ncl);
    this.fillCluster(ncl);
    const ids = ncl.rooms.map((i) => this.lay.instances[i].id);
    // переход не встал за дверью (нет места) — в новой квартире, поближе ко входу
    if (this.tr.pending) {
      const t = this.placeTransition(ncl, this.clusterDoors(ncl));
      if (t) ids.push(t.inst.id);
    }
    // остальные закрытые выходы старой квартиры исчезают, пропущенный в ней переход — тоже. Новая квартира вышла совсем
    // без выходов и перехода (вырожденный случай) — старые выходы остаются: мир не должен встать
    if (ncl.exits.length > 0 || ncl.transition !== null) this.vanishExits(cl);
    this.version++;
    const dt = now() - t0;
    this.ms += dt;
    this.times.push(dt);
    this.notify(ids, v0);
    return child.inst.id;
  }

  /** Вход новой квартиры через любую свою дверь (метки не сверяются): комната пула (null — все), у которой кроме неё
   *  не меньше minOthers дверей. Связь — loose (validateFoldRun не сверяет теги и ширину). */
  private growLoose(P: Node, ci: number, D: Rng, win: Map<Info, number>, pool: Pool | null, minOthers: number): Node | null {
    const okB = (info: Info, b: Connector, bi: number) => b.len >= 1 && doorsBesides(info, bi) >= minOthers;
    const list = (pool ? pool.list : this.cands).filter((info) => info.room.connectors.some((b, bi) => okB(info, b, bi)));
    if (!list.length) return null;
    const skip = (info: Info) => (info.room.unique && this.uniqueUsed.has(info)) || (win.get(info) ?? 0) >= info.effMax;
    const fails: Fails = { space: 0, rule: 0, sight: 0, seam: 0 };
    const weightOf = pool ? pool.weightOf : (x: Info) => this.wt.get(x) ?? x.weight;
    const child = growFrom(this.ctx, this.lay, P, ci, [list], okB, D, fails, { weightOf, skip, stick: true });
    if (child) this.lay.links[this.lay.links.length - 1].loose = true;
    return child;
  }

  /** Остальные закрытые выходы квартиры (подвала) исчезают, пропущенный в ней переход — тоже. */
  private vanishExits(cl: Cluster): void {
    for (const e of cl.exits) {
      this.exitDoors.delete(e);
      this.markDead(this.lay.nodes[Math.floor(e / 1024)], e % 1024, 'vanished');
    }
    cl.exits = [];
    this.sealSkipped(cl);
  }

  /** Куда ведут выходы подвала наверх: биом, откуда в подвал спустились; если и он подвал (старт в подвале, переход
   *  из подвала в подвал) — квартирный биом по броску. */
  private upBiome(cl: Cluster, daddr: string): string {
    const W = this.W!;
    const home = W.biomes.find((b) => b.id === cl.home);
    if (home && !isTunnels(home)) return home.id;
    const flats = apartmentBiomes(W);
    if (!flats.length) return cl.home;
    return flats[this.root.sub(`up:${daddr}`).int(0, flats.length - 1)].id;
  }

  /** Двери квартиры для перехода: от входа (по порядку комнат) — сначала неиспользованные проёмы-стены, потом
   *  закрытые выходы. */
  private clusterDoors(cl: Cluster): DoorRef[] {
    const walls: DoorRef[] = [], exits: DoorRef[] = [];
    for (const i of cl.rooms) {
      const n = this.lay.nodes[i];
      n.conns.forEach((c, ci) => {
        if (c.len < 1 || n.linked[ci]) return;
        const key = dk(i, ci);
        if (this.dead.get(key) === 'cluster') walls.push({ n, ci });
        else if (this.exitDoors.has(key)) exits.push({ n, ci });
      });
    }
    return [...walls, ...exits];
  }

  /**
   * Переход (выпал по счётчику): спец-комната (лестница, лифт — по весу роста, поток root.sub("transition:" + адрес
   * двери)) пристыковывается к первой из дверей doors, где встанет. Метка любая шириной от TRANSITION_MIN_LEN (переход
   * встаёт за дверью любого биома — проёмы разной ширины совмещаются по центру). Выход, за которым встал переход,
   * ведёт в него; стена становится проёмом. Не встал — переход ждёт следующей открытой двери.
   */
  private placeTransition(cl: Cluster, doors: DoorRef[]): Node | null {
    const specials = this.infos.filter((x): x is Info => !!x && (x.room.location?.kind === 'stairwell' || x.room.location?.kind === 'lift') && x.room.gen.weight > 0);
    if (!specials.length) return null;
    for (const { n: P, ci } of doors) {
      const A = P.conns[ci];
      if (A.len < TRANSITION_MIN_LEN) continue;
      const key = dk(P.inst.order, ci);
      const daddr = childAddr(this.addr[P.inst.order], P.info.room.connectors[ci].id);
      const R = this.root.sub(`transition:${daddr}`);
      const info = specials[pickWeighted(R, specials.map((x) => x.room.gen.weight))];
      const okB = (_: Info, b: Connector) => b.len >= 1;
      const fails: Fails = { space: 0, rule: 0, sight: 0, seam: 0 };
      // предел обзора и бесшовность — не для перехода: внутри спец-комнаты своя сцена, длинная лестница или шахта не
      // должны мешать ей встать за дверью
      const child = growFrom({ ...this.ctx, lim: null, seam: null }, this.lay, P, ci, [[info]], okB, R.sub(daddr), fails, { weightOf: () => 1, stick: true });
      if (!child) continue;
      if (this.exitDoors.has(key)) {
        this.exitDoors.delete(key);
        cl.exits = cl.exits.filter((e) => e !== key);
      } else if (this.dead.delete(key)) this.deadFail--;
      this.onPlaced(child, P, daddr, true, cl);
      // дверь в переход: метки любые (validateFoldRun не сверяет теги и ширину)
      this.lay.links[this.lay.links.length - 1].loose = true;
      this.expandedF[child.inst.order] = true;
      cl.transition = child.inst.order;
      this.tr.pending = false;
      return child;
    }
    return null;
  }

  /** Игрок уходит из квартиры: переход в ней, в который он не заходил, исчезает (дверь к нему — глухая). */
  private sealSkipped(cl: Cluster): void {
    const t = cl.transition;
    if (t === null || this.visited.has(t)) return;
    const id = this.lay.instances[t].id;
    this.lay.links.forEach((l, li) => {
      if (l.a.inst === id || l.b.inst === id) this.sealed.add(li);
    });
  }

  /**
   * Куда ведёт переход из спец-комнаты L (поток root.sub("trdest:" + ключ выхода)): с вероятностью trToBiome — в другой
   * обычный биом (равновероятно), иначе — в богатую квартиру (её выходы — в биом, откуда пришли). Нет другого биома —
   * богатая квартира; нет богатой — другой биом; нет ничего — тот же биом.
   */
  private transitionTarget(L: Node, key: string): { biome: string; home: string; rich: boolean } {
    const W = this.W!;
    const cur = this.clusters[this.clusterOf[L.inst.order] ?? -1];
    const here = cur?.home ?? startBiomeOf(W)?.id ?? '';
    const R = this.root.sub(`trdest:${key}`);
    const toBiome = R.next() < W.trToBiome;
    const others = plainBiomes(W).filter((b) => b.id !== here);
    const rich = W.biomes.filter((b) => b.rich);
    if ((toBiome || !rich.length) && others.length) {
      const b = others[R.int(0, others.length - 1)];
      return { biome: b.id, home: b.id, rich: false };
    }
    if (rich.length) {
      const b = rich[R.int(0, rich.length - 1)];
      return { biome: b.id, home: here, rich: true };
    }
    return { biome: here, home: here, rich: false };
  }

  /** Прошёл через переход — счётчик с нуля (новый поток бросков). */
  private resetTransitions(): void {
    if (!this.W) return;
    this.tr = { count: 0, resets: this.tr.resets + 1, pending: false };
  }

  enter(instId: string): EnterResult {
    const n = this.byId.get(instId);
    if (!this.W || !n) return { count: 0, chance: 0, pending: false, resets: 0, counted: false, triggered: false };
    const i = n.inst.order;
    const res = (counted: boolean, triggered: boolean): EnterResult => ({ ...this.transitionState()!, counted, triggered });
    if (this.visited.has(i)) return res(false, false);
    this.visited.add(i);
    // спец-комнаты (переходы) в счёт не идут
    if (n.info.room.location) return res(false, false);
    this.tr.count++;
    // сводка прогона (run().warnings) показывает счётчик — кэш прогона устарел
    this.version++;
    let triggered = false;
    const p = transitionChance(this.W, this.tr.count);
    if (!this.tr.pending && p > 0 && makeRng(`${seedKey(this.settings.seed, this.settings.mods)}#tr:${this.tr.resets}:${this.tr.count}`).next() < p) {
      this.tr.pending = true;
      triggered = true;
    }
    return res(true, triggered);
  }

  transitionState(): TransitionState | null {
    if (!this.W) return null;
    return { count: this.tr.count, chance: transitionChance(this.W, this.tr.count + 1), pending: this.tr.pending, resets: this.tr.resets };
  }

  clusterAt(instId: string): ClusterInfo | null {
    const n = this.byId.get(instId);
    const cl = n ? this.clusters[this.clusterOf[n.inst.order] ?? -1] : undefined;
    if (!this.W || !cl) return null;
    const b = (id: string) => this.W!.biomes.find((x) => x.id === id) ?? null;
    return {
      id: cl.id, biome: b(cl.biome), home: b(cl.home), rich: cl.rich, rooms: cl.rooms.length, exits: cl.exits.length,
      transition: cl.transition === null ? null : this.lay.instances[cl.transition].id,
      tunnels: cl.tunnels,
    };
  }

  // ───────── подвал: сеть ходов (docs/GENERATOR-4D.md §17) ─────────

  /** Длина куска по оси хода, м (больший габарит). */
  private lenM(info: Info): number {
    const sh = this.ctx.shapes.get(info.room, 0);
    return Math.max(sh.x1 - sh.x0, sh.y1 - sh.y0) * this.cellM;
  }

  /** Проект для наполнения комнат биома: правила отделки биома — поверх правил проекта. */
  private projOf(biome: string | null): Project {
    const b = biome ? this.W?.biomes.find((x) => x.id === biome) : undefined;
    if (!b?.finishRules?.length) return this.p;
    let p = this.projs.get(b.id);
    if (!p) {
      p = { ...this.p, finishRules: [...b.finishRules, ...(this.p.finishRules ?? [])] };
      this.projs.set(b.id, p);
    }
    return p;
  }

  /** Куски хода вида kind из пула биома (кладовые — kind 'storage': комнаты с дверью к ходу). */
  private tunPool(biome: string, kind: TunKind | 'storage'): Pool {
    const key = `${biome}|${kind}`;
    let p = this.pools.get(key);
    if (!p) {
      const base = this.biomePool(biome);
      const list = base.list.filter((x) => (kind === 'storage' ? x.room.connectors.some((c) => c.len >= 1 && c.tag === 'storage>basement') : tunKind(x) === kind));
      p = { list, weightOf: base.weightOf };
      this.pools.set(key, p);
    }
    return p;
  }

  /** Стыковка куска хода вида kind к двери ci (без предела обзора). */
  private growKind(P: Node, ci: number, D: Rng, pool: Pool, win: Map<Info, number>, fails: Fails): Node | null {
    const A = P.conns[ci];
    const match = this.settings.match;
    const okB = (_: Info, b: Connector) => b.len >= 1 && compatible(A, b, match);
    const list = pool.list.filter((info) => info.room.connectors.some((b) => okB(info, b)));
    if (!list.length) return null;
    const skip = (info: Info) => (info.room.unique && this.uniqueUsed.has(info)) || (win.get(info) ?? 0) >= info.effMax;
    return growFrom(this.tctx, this.lay, P, ci, [list], okB, D, fails, { weightOf: pool.weightOf, skip, stick: true });
  }

  /**
   * Раскрыть кусок подвала P (на ходу, как в §15.4, но по правилам ходов). Хаб: с шансом tunnels.ring — кольцо из одной
   * его свободной двери хода в другую (до остальных дверей). Затем двери по порядку room.connectors, поток двери
   * D = root.sub("door:" + адрес двери):
   *  • проход хода — tunnelStep;
   *  • дверь в кладовую — D.next() < tunnels.storage: кладовая из пула биома, иначе стена;
   *  • другая (служебка) — любая совместимая комната биома; не встала — стена.
   * Двери-марши хаба — закрытые выходы (поставлены при постановке хаба).
   */
  private expandTunnel(P: Node, cl: Cluster): string[] {
    const i = P.inst.order;
    this.expandedF[i] = true;
    const t0 = now();
    const T = this.W!.tunnels;
    const out: string[] = [];
    const win = this.windowCounts(P);
    const take = (n: Node | null) => {
      if (!n) return;
      out.push(n.inst.id);
      win.set(n.info, (win.get(n.info) ?? 0) + 1);
    };
    const open = (ci: number) => P.conns[ci].len >= 1 && !P.linked[ci] && !this.dead.has(dk(i, ci)) && !this.exitDoors.has(dk(i, ci));
    if (tunKind(P.info) === 'hub') {
      const free = P.conns.map((c, ci) => (c.tag === TUNNEL_TAG && open(ci) ? ci : -1)).filter((ci) => ci >= 0);
      const R = this.root.sub(`ring:${this.addr[i]}`);
      if (free.length >= 2 && R.next() < T.ring) {
        const a = free[R.int(0, free.length - 1)];
        const rest = free.filter((x) => x !== a);
        for (const n of this.buildRing(P, a, rest[R.int(0, rest.length - 1)], cl, R)) take(n);
      }
    }
    for (let ci = 0; ci < P.conns.length; ci++) {
      if (!open(ci)) continue;
      const tag = P.conns[ci].tag;
      const daddr = childAddr(this.addr[i], P.info.room.connectors[ci].id);
      const D = this.root.sub(`door:${daddr}`);
      if (tag === TUNNEL_TAG) {
        for (const n of this.tunnelStep(P, ci, cl, D, win, daddr)) take(n);
        continue;
      }
      const fails: Fails = { space: 0, rule: 0, sight: 0, seam: 0 };
      let child: Node | null = null;
      if (tag === 'basement>storage') {
        if (D.next() < T.storage) child = this.growKind(P, ci, D, this.tunPool(cl.biome, 'storage'), win, fails);
      } else child = this.growKind(P, ci, D, this.biomePool(cl.biome), win, fails);
      if (!child) {
        this.markDead(P, ci, 'cluster');
        continue;
      }
      this.grown++;
      this.onPlaced(child, P, daddr, true, cl);
      take(child);
    }
    this.version++;
    const dt = now() - t0;
    this.ms += dt;
    this.times.push(dt);
    return out;
  }

  /**
   * Продолжение хода за проходом ci куска P. По порядку: выпавший переход — прямо здесь (как за открытой дверью);
   * петля к проходу напротив; броски u = D.next(), v = D.next():
   *  • хаб — u < pHub, pHub = 0 ближе hubEvery[0] м хода от прошлого хаба, 1 дальше hubEvery[1], между — линейно;
   *  • иначе по v: [0, loop) — бесконечный прямой участок (не ближе LOOP_MIN_DIST м к хабу; не встал — дальше как
   *    развилка), затем развилка (branch), поворот (turn), остальное — прямой кусок.
   * Вид не встал — следующий из списка (прямой, поворот, развилка); ничего — стена.
   */
  private tunnelStep(P: Node, ci: number, cl: Cluster, D: Rng, win: Map<Info, number>, daddr: string): Node[] {
    const T = this.W!.tunnels;
    if (this.tr.pending) {
      const t = this.placeTransition(cl, [{ n: P, ci }]);
      if (t) return [t];
    }
    if (this.tryLoop(P, ci, cl.id, this.tctx)) return [];
    const dist = Math.max(0, this.tdist[P.inst.order] ?? 0);
    const u = D.next(), v = D.next();
    const [h0, h1] = T.hubEvery;
    const pHub = dist < h0 ? 0 : dist >= h1 ? 1 : (dist - h0) / Math.max(1e-9, h1 - h0);
    let kinds: TunKind[];
    if (u < pHub) kinds = ['hub', 'straight', 'turn', 'branch'];
    else {
      if (v < T.loop && dist >= LOOP_MIN_DIST && tunKind(P.info) !== 'hub') {
        const loop = this.buildWrapLoop(P, ci, cl, this.root.sub(`loop:${daddr}`));
        if (loop.length) return loop;
      }
      kinds = v < T.loop + T.branch ? ['branch', 'straight', 'turn']
        : v < T.loop + T.branch + T.turn ? ['turn', 'straight', 'branch']
        : ['straight', 'turn', 'branch'];
    }
    const fails: Fails = { space: 0, rule: 0, sight: 0, seam: 0 };
    for (const k of kinds) {
      const child = this.growKind(P, ci, D, this.tunPool(cl.biome, k), win, fails);
      if (!child) continue;
      this.grown++;
      this.onPlaced(child, P, daddr, true, cl);
      return [child];
    }
    this.markDead(P, ci, fails.space > 0 ? 'space' : 'nomatch');
    return [];
  }

  /** Детали колец биома (кэш): шаги кусков — пробной стыковкой к образцу двери по каждому курсу. */
  private ringKit(biome: string): RingKit | null {
    if (this.kits.has(biome)) return this.kits.get(biome)!;
    const g = this.settings.gap;
    const passes = (info: Info) => info.room.connectors.map((c, k) => (c.len >= 1 && c.tag === TUNNEL_TAG ? k : -1)).filter((k) => k >= 0);
    // сначала куски ходов (тег «ход»), из них — меньшие (проходы во всю ширину хода 1 м: тройник 1×2, поворот 1×1)
    const own = (list: Info[]) => [...list].sort((x, y) => Number(y.room.tags.includes('ход')) - Number(x.room.tags.includes('ход')) || x.room.cells.size - y.room.cells.size);
    const piece = (info: Info, a: number, b: number): RingPiece | null => {
      const len = info.room.connectors[a].len;
      if (info.room.connectors[b].len !== len) return null;
      const step: RingPiece['step'] = [];
      for (let h = 0; h < 4; h++) {
        const A = probeDoor(HEADS[h], len);
        const B0 = info.room.connectors[a];
        const rot = rotFor(B0.side, OPPOSITE[A.side]);
        const sh = this.ctx.shapes.get(info.room, rot);
        const t = dockTarget(A, sh.conns[a].len, g);
        const dx = t.cx - sh.conns[a].cx, dy = t.cy - sh.conns[a].cy;
        const o = sh.conns[b];
        const out = { side: o.side, cx: o.cx + dx, cy: o.cy + dy, len: o.len };
        step.push({ d: anchorOf(out), h: HEADS.indexOf(out.side) });
      }
      return { info, in: a, out: b, step };
    };
    const straights: RingPiece[] = [];
    for (const info of own(this.tunPool(biome, 'straight').list)) {
      const t = passes(info);
      const p = t.length === 2 ? piece(info, t[0], t[1]) : null;
      // по оси, без сдвига вбок (как шаг решётки колец)
      if (p && p.step.every((s, h) => s.h === h && (DIR[HEADS[h]][0] === 0 ? s.d[0] === 0 : s.d[1] === 0))) straights.push(p);
    }
    let right: RingPiece | null = null, left: RingPiece | null = null;
    for (const info of own(this.tunPool(biome, 'turn').list)) {
      const t = passes(info);
      if (t.length !== 2) continue;
      for (const [a, b] of [[t[0], t[1]], [t[1], t[0]]]) {
        const p = piece(info, a, b);
        if (!p) continue;
        if (p.step[0].h === 1 && !right) right = p;
        if (p.step[0].h === 3 && !left) left = p;
      }
      if (right && left) break;
    }
    let tee: RingKit['tee'] = null;
    for (const info of own(this.tunPool(biome, 'branch').list)) {
      const t = passes(info);
      if (t.length !== 3) continue;
      const cs = info.room.connectors;
      for (const s of t) {
        const ax = t.filter((x) => x !== s);
        if (cs[ax[0]].side === OPPOSITE[cs[ax[1]].side] && cs[s].side !== cs[ax[0]].side && cs[s].side !== cs[ax[1]].side) {
          tee = { info, a1: ax[0], a2: ax[1], side: s };
          break;
        }
      }
      if (tee) break;
    }
    const kit = straights.length ? { straights, right, left, tee } : null;
    this.kits.set(biome, kit);
    return kit;
  }

  /**
   * Поставить кусок info меткой bi к двери ci экземпляра P — как складчатая стыковка, но слой — ближайший к wPref
   * (не дальше maxShift от P): кольцо держится у слоя хаба, чтобы замкнуться. null — некуда (все слои заняты).
   */
  private placeFixed(P: Node, ci: number, info: Info, bi: number, wPref: number): Node | null {
    const A = P.conns[ci];
    const B0 = info.room.connectors[bi];
    const rot = rotFor(B0.side, OPPOSITE[A.side]);
    const sh = this.ctx.shapes.get(info.room, rot);
    const Bw = sh.conns[bi];
    const g = this.settings.gap;
    const t = dockTarget(A, Bw.len, g);
    const dx = t.cx - Bw.cx, dy = t.cy - Bw.cy;
    if (sh.x0 + dx - g < -LIMIT || sh.y0 + dy - g < -LIMIT || sh.x1 + dx + g > LIMIT || sh.y1 + dy + g > LIMIT) return null;
    const body: Body = { sh, dx, dy };
    const near = [...around(P, this.ctx.f.localRadius - 1).keys()];
    if (near.some((x) => x.floor === P.floor && this.ctx.shapes.conflict(body, x.body))) return null;
    const f = this.ctx.f;
    const ws: number[] = [];
    for (let k = 0; k <= 2 * f.maxShift + 1; k++) {
      const w = wPref + (k % 2 ? (k + 1) / 2 : -k / 2);
      if (Math.abs(w - P.w) <= f.maxShift && Math.abs(w) <= f.maxLayer && !ws.includes(w)) ws.push(w);
    }
    for (const w of ws) {
      if (!layerFree(this.ctx, this.lay, w, body, P.floor)) continue;
      const child = place(this.ctx, this.lay, info, rot, dx, dy, w, P);
      link(this.lay, P, ci, child, bi);
      return child;
    }
    return null;
  }

  /** Поставить цепочку кусков от двери ci экземпляра P; слой — к wPref. Возвращает поставленные и последнюю дверь. */
  private placeChain(P: Node, ci: number, chain: RingPiece[], cl: Cluster, wPref: number): { placed: Node[]; end: DoorRef | null } {
    const placed: Node[] = [];
    let cur: DoorRef = { n: P, ci };
    for (const pc of chain) {
      const daddr = childAddr(this.addr[cur.n.inst.order], cur.n.info.room.connectors[cur.ci].id);
      const child = this.placeFixed(cur.n, cur.ci, pc.info, pc.in, wPref);
      if (!child) return { placed, end: null };
      this.grown++;
      this.onPlaced(child, cur.n, daddr, true, cl);
      placed.push(child);
      cur = { n: child, ci: pc.out };
    }
    return { placed, end: cur };
  }

  /**
   * Кольцо из хаба (§17.4): от прохода a хаба H — по кругу — в его же проход b. Путь — прямые прогоны и n поворотов в
   * одну сторону (n = 1…4, чтобы последний курс смотрел в проход b); длины прогонов — суммы шагов прямых кусков
   * (1, 2, 4, 6, 8 м + порог — 11, 21, 41… клеток: любая длина от ~20 м складывается точно до клетки). Уравнение
   * замыкания — по двум осям; свободные прогоны — броски R, зависимые (последний по каждой оси) — из уравнения;
   * длина кольца — в tunnels.ringLen. Куски ставятся у слоя хаба (сквозь занятые места — в соседних слоях W), в конце
   * связь последнего прохода с b (tryLink: |dw| ≤ maxShift). Не вышло на любом шаге — поставленное остаётся обычным
   * ходом (его проходы растут дальше), проход b — тоже.
   */
  private buildRing(H: Node, a: number, b: number, cl: Cluster, R: Rng): Node[] {
    const kit = this.ringKit(cl.biome);
    const T = this.W!.tunnels;
    if (!kit || (!kit.right && !kit.left)) return [];
    const g = this.settings.gap;
    const S = H.conns[a], E = H.conns[b];
    const start = anchorOf(S);
    const ea = anchorOf(E);
    const goal: [number, number] = [ea[0] + g * DIR[E.side][0], ea[1] + g * DIR[E.side][1]];
    const h0 = HEADS.indexOf(S.side), hf = HEADS.indexOf(OPPOSITE[E.side]);
    // прогоны: длина (клетки) → куски (меньше кусков — лучше), до 1000 клеток
    const MAX = Math.min(1000, Math.round((T.ringLen[1] / this.cellM) * 0.8));
    const steps = kit.straights.map((p) => ({ p, s: Math.abs(p.step[0].d[1]) }));
    const best: (RingPiece[] | null)[] = new Array(MAX + 1).fill(null);
    best[0] = [];
    for (let x = 1; x <= MAX; x++) {
      for (const { p, s } of steps) {
        const prev = x - s >= 0 ? best[x - s] : null;
        if (prev && (!best[x] || prev.length + 1 < best[x]!.length)) best[x] = [...prev, p];
      }
    }
    const reach: number[] = [];
    for (let x = 0; x <= MAX; x++) if (best[x]) reach.push(x);
    const lo = T.ringLen[0] / this.cellM, hi = T.ringLen[1] / this.cellM;
    type Plan = { turn: RingPiece; heads: number[]; runs: number[] };
    let plan: Plan | null = null;
    const opts: { turn: RingPiece; d: number; n: number }[] = [];
    for (const [turn, d] of [[kit.right, 1], [kit.left, -1]] as const) {
      if (!turn) continue;
      for (let n = 1; n <= 4; n++) if ((((h0 + n * d) % 4) + 4) % 4 === hf) opts.push({ turn, d, n });
    }
    for (let tries = 0; tries < 600 && !plan && opts.length; tries++) {
      const { turn, d, n } = opts[R.int(0, opts.length - 1)];
      const heads: number[] = [];
      for (let k = 0; k <= n; k++) heads.push((((h0 + k * d) % 4) + 4) % 4);
      // сдвиг поворотов
      let tx = 0, ty = 0;
      for (let k = 0; k < n; k++) { tx += turn.step[heads[k]].d[0]; ty += turn.step[heads[k]].d[1]; }
      const need = [goal[0] - start[0] - tx, goal[1] - start[1] - ty];
      // по оси: последний прогон оси — зависимый, остальные — броски
      const runs = new Array(n + 1).fill(0);
      const axisOf = (h: number) => (h % 2 === 1 ? 0 : 1);
      const dep: (number | null)[] = [null, null];
      for (let k = n; k >= 0; k--) if (dep[axisOf(heads[k])] === null) dep[axisOf(heads[k])] = k;
      for (let k = 0; k <= n; k++) if (k !== dep[0] && k !== dep[1]) runs[k] = reach[R.int(0, reach.length - 1)];
      let ok = true;
      for (const ax of [0, 1]) {
        const k = dep[ax];
        let sum = 0;
        for (let j = 0; j <= n; j++) if (j !== k && axisOf(heads[j]) === ax) sum += runs[j] * DIR[HEADS[heads[j]]][ax];
        const rest = need[ax] - sum;
        if (k === null) { if (rest !== 0) ok = false; continue; }
        const r = rest / DIR[HEADS[heads[k]]][ax];
        if (!Number.isInteger(r) || r < 0 || r > MAX || !best[r]) { ok = false; continue; }
        runs[k] = r;
      }
      if (!ok) continue;
      const total = runs.reduce((s2, r) => s2 + r, 0) + n * 10;
      if (total < lo || total > hi) continue;
      plan = { turn, heads, runs };
    }
    if (!plan) return [];
    const chain: RingPiece[] = [];
    plan.runs.forEach((r, k) => {
      chain.push(...R.shuffle([...best[r]!]));
      if (k < plan!.runs.length - 1) chain.push(plan!.turn);
    });
    const { placed, end } = this.placeChain(H, a, chain, cl, H.w);
    if (!end || !facing(end.n.conns[end.ci], E, g)) return placed;
    if (!tryLink(this.tctx, this.lay, end.n, end.ci, H, b, this.pvsOpt)) return placed;
    this.loops++;
    this.rings++;
    if (end.n.w !== H.w) this.shifted++;
    this.sightAdd(null, this.lay.links.length - 1);
    if (this.pvsOpt) for (const z of [end.n.inst.order, H.inst.order, ...this.lay.pvs[end.n.inst.order], ...this.lay.pvs[H.inst.order]]) this.dirty.add(z);
    return placed;
  }

  /**
   * Бесконечный прямой участок (§17.5): тройник боком к проходу ci (вход сбоку), от одного его прохода оси — прямые
   * куски на tunnels.loopLen м (не меньше двух), последний проход сшит со вторым проходом оси тройника связью wrap
   * (сдвиг, при котором они стоят лицом к лицу): идёшь вдоль — и снова тот же тройник с проходом, откуда пришёл.
   */
  private buildWrapLoop(P: Node, ci: number, cl: Cluster, R: Rng): Node[] {
    const kit = this.ringKit(cl.biome);
    const T = this.W!.tunnels;
    if (!kit?.tee) return [];
    const tee = kit.tee;
    const tNode = this.placeFixed(P, ci, tee.info, tee.side, P.w);
    if (!tNode) return [];
    this.grown++;
    this.onPlaced(tNode, P, childAddr(this.addr[P.inst.order], P.info.room.connectors[ci].id), true, cl);
    const target = R.int(T.loopLen[0], T.loopLen[1]) / this.cellM;
    const chain: RingPiece[] = [];
    let total = 0;
    while (total < target || chain.length < 2) {
      const p = kit.straights[R.int(0, kit.straights.length - 1)];
      chain.push(p);
      total += Math.abs(p.step[0].d[1]);
    }
    const { placed, end } = this.placeChain(tNode, tee.a1, chain, cl, tNode.w);
    const all = [tNode, ...placed];
    if (!end || placed.length < 2) return all;
    const A = end.n.conns[end.ci], B = tNode.conns[tee.a2];
    if (B.side !== OPPOSITE[A.side]) return all;
    const t = dockTarget(A, B.len, this.settings.gap);
    const wrap: [number, number] = [t.cx - B.cx, t.cy - B.cy];
    end.n.linked[end.ci] = tNode.linked[tee.a2] = true;
    end.n.nb.push(tNode);
    tNode.nb.push(end.n);
    this.trans.push({
      a: { inst: end.n.inst.id, connector: A.id }, b: { inst: tNode.inst.id, connector: B.id }, dw: tNode.w - end.n.w, wrap,
    });
    this.wraps++;
    return all;
  }

  stats(): StreamStats {
    let pending = 0;
    for (const n of this.lay.nodes) {
      if (this.expandedF[n.inst.order]) continue;
      n.conns.forEach((c, ci) => { if (c.len >= 1 && !n.linked[ci]) pending++; });
    }
    // время раскрытия — по последним 500 раскрытиям (на большом мире интересно текущее, а не прогрев)
    const t = this.times.slice(-500).sort((a, b) => a - b);
    let lifts = 0;
    for (const l of this.trans) if (l.kind === 'lift') lifts++;
    return {
      instances: this.lay.nodes.length,
      expanded: this.expandedF.filter(Boolean).length,
      pending, pendingGrow: this.growPending,
      grown: this.grown, loops: this.loops, deadChance: this.deadChance, deadFail: this.deadFail,
      layers: this.lay.layers.size, minW: this.minW, maxW: this.maxW, overlaps: this.overlaps, shifted: this.shifted,
      expands: this.times.length,
      expandMsAvg: t.length ? t.reduce((a, b) => a + b, 0) / t.length : 0,
      expandMsP95: t.length ? t[Math.min(t.length - 1, Math.floor(t.length * 0.95))] : 0,
      expandMsMax: t.length ? t[t.length - 1] : 0,
      descents: this.trans.length - lifts,
      lifts,
      floors: this.floorSet.size,
      minFloor: this.minFloor,
      maxFloor: this.maxFloor,
      clusters: this.clusters.length,
      exitsOpen: this.exitDoors.size,
      transition: this.transitionState(),
      hubs: this.hubs,
      rings: this.rings,
      wraps: this.wraps,
    };
  }

  private summary(): string {
    const st = this.stats();
    const sg = (v: number) => (v > 0 ? `+${v}` : `${v}`);
    return `Бесконечный мир: комнат ${st.instances} (раскрыто ${st.expanded}), нераскрытых дверей ${st.pending} (ростовых ${st.pendingGrow}), ` +
      `тупиков ${st.deadChance + st.deadFail} (по шансу ${st.deadChance}, не встало ${st.deadFail}), петель ${st.loops}; ` +
      `слоёв ${st.layers} (W от ${sg(st.minW)} до ${sg(st.maxW)}), пар комнат в одном месте 3D — ${st.overlaps}.` +
      (st.descents || st.lifts
        ? ` Переходов на другие этажи: вниз из спец-локаций ${st.descents}, выходов лифтов ${st.lifts}; этажей ${st.floors} (от ${sg(st.minFloor)} до ${sg(st.maxFloor)}).`
        : '') +
      (this.W
        ? ` Квартир ${st.clusters}, закрытых выходов ${st.exitsOpen}; переходы: пройдено комнат ${st.transition!.count}` +
          `${st.transition!.pending ? ', переход выпал — за следующей открытой дверью' : `, шанс следующей ${Math.round(st.transition!.chance * 100)}%`}.` +
          (st.hubs ? ` Подвал: хабов ${st.hubs}, колец ${st.rings}, бесконечных участков ${st.wraps}.` : '') +
          (st.exitsOpen === 0 && st.instances > 0 && !this.clusters.some((c) => c.tunnels) ? ' Закрытых выходов не осталось — мир дальше не растёт (выходы исчезли или не встали).' : '')
        : st.pendingGrow === 0 && st.instances > 0 ? ' Мир заглох: ростовых дверей не осталось, заколоченных по шансу нет — все отказали по месту/обзору.' : '');
  }

  run(): Run {
    if (this.cache && this.cache.v === this.version) return this.cache.run;
    const lay = this.lay;
    if (this.pvsOpt) {
      for (const i of this.dirty) this.pvsRec[lay.instances[i].id] = [...lay.pvs[i]].sort((a, b) => a - b).map((j) => lay.instances[j].id);
    }
    this.dirty.clear();
    const openConnectors: Run['openConnectors'] = [];
    for (const n of lay.nodes) n.conns.forEach((c, ci) => { if (!n.linked[ci] && c.len >= 1) openConnectors.push({ inst: n.inst.id, connector: c.id }); });
    // проходимость: сколько вариантов спотов подменено, чтобы не перегораживать проход (src/gen/walk.ts)
    const walkW = walkWarning(this.content);
    const fold: FoldStats = { minW: this.minW, maxW: this.maxW, layers: lay.layers.size, overlaps: this.overlaps, shifted: this.shifted };
    const run: Run = {
      seed: this.settings.seed,
      settings: { ...this.gen, count: Math.max(1, lay.instances.length), fold: { ...this.settings.fold } },
      instances: lay.instances.slice(),
      // двери (их индексы = индексы проёмов), затем переходы спец-локаций и выходы лифтов; «исчезнувшие» двери помечены
      links: [...lay.links.map((l, li) => (this.sealed.has(li) ? { ...l, sealed: true as const } : l)), ...this.trans],
      openConnectors,
      content: this.content.slice(),
      totals: { ...this.totals },
      warnings: [...this.warnings, this.summary(), ...(walkW ? [walkW] : [])],
      sight: { maxM: this.best.m, line: this.best.line },
      ...(this.pvsOpt ? { pvs: { ...this.pvsRec } } : {}),
      fold,
      ms: Math.round(this.ms * 100) / 100,
    };
    this.cache = { v: this.version, run };
    return run;
  }

  private printOf(info: Info): string {
    let s = this.prints.get(info);
    if (s === undefined) this.prints.set(info, (s = roomPrint(info.room)));
    return s;
  }

  save(): StreamSave {
    const run = this.run();
    const lay = this.lay;
    const dead: string[] = [], deadWhy: string[] = [];
    for (const [k, why] of this.dead) {
      const n = lay.nodes[Math.floor(k / 1024)];
      dead.push(`${n.inst.id}/${n.info.room.connectors[k % 1024].id}`);
      deadWhy.push(why);
    }
    const rooms: Record<string, string> = {};
    for (const n of lay.nodes) rooms[n.info.room.id] ??= this.printOf(n.info);
    return {
      format: 'room-forge-world',
      version: 1,
      settings: { ...this.settings, mods: this.settings.mods.slice(), fold: { ...this.settings.fold } },
      // компактно: наполнение не хранится — оно выводится заново из адресов (детерминированно, тот же ГСЧ);
      // предупреждения — без строки-сводки (она пересчитывается)
      run: { ...run, content: [], totals: {}, warnings: this.warnings.slice() },
      expanded: lay.nodes.filter((n) => this.expandedF[n.inst.order]).map((n) => n.inst.id),
      dead,
      deadWhy,
      spine: lay.nodes.filter((n) => this.spine[n.inst.order]).map((n) => n.inst.id),
      rooms,
      ...(this.W ? { world: this.saveWorld() } : {}),
      savedAt: Date.now(),
    };
  }

  private saveWorld(): WorldSave {
    const lay = this.lay;
    const door = (k: number) => {
      const n = lay.nodes[Math.floor(k / 1024)];
      return `${n.inst.id}/${n.info.room.connectors[k % 1024].id}`;
    };
    return {
      clusters: this.clusters.map((c) => ({
        biome: c.biome, home: c.home, rich: c.rich, entry: lay.instances[c.entry].id, exits: c.exits.map(door), opened: c.opened.map(door),
        transition: c.transition === null ? null : lay.instances[c.transition].id,
        ...(c.tunnels ? { tunnels: true as const } : {}),
      })),
      clusterOf: lay.nodes.map((n) => this.clusterOf[n.inst.order] ?? -1),
      ...(this.clusters.some((c) => c.tunnels) ? { tdist: lay.nodes.map((n) => Math.round((this.tdist[n.inst.order] ?? -1) * 100) / 100) } : {}),
      sealed: [...this.sealed].sort((a, b) => a - b),
      visited: [...this.visited].sort((a, b) => a - b).map((i) => lay.instances[i].id),
      tr: { ...this.tr },
    };
  }

  onChange(cb: (newIds: string[]) => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  // ───────── восстановление ─────────

  /** Что в сохранении не сходится с проектом (пусто — можно восстанавливать). */
  private checkSave(sv: StreamSave): string[] {
    if (!sv || sv.format !== 'room-forge-world' || sv.version !== 1 || !sv.run || !Array.isArray(sv.run.instances)) return ['неизвестный формат сохранения'];
    const bad: string[] = [];
    if (!!this.W !== !!sv.world) return [this.W ? 'сохранение без квартир (мир до биомов и переходов)' : 'сохранение с квартирами'];
    if (sv.world && (!Array.isArray(sv.world.clusterOf) || sv.world.clusterOf.length !== sv.run.instances.length)) return ['квартиры сохранения не сходятся с комнатами'];
    const ids = new Set<string>();
    sv.run.instances.forEach((inst, k) => {
      if (inst.id !== `i${k}` || inst.order !== k) bad.push(`экземпляр ${inst.id} не на своём месте`);
      ids.add(inst.roomId);
    });
    for (const id of ids) {
      const info = this.byRoom.get(id);
      if (!info) bad.push(`комната ${id} удалена`);
      else if (sv.rooms && sv.rooms[id] !== undefined && sv.rooms[id] !== this.printOf(info)) bad.push(`комната «${info.room.name}» изменена`);
    }
    if (bad.length) return bad;
    const inst = new Map(sv.run.instances.map((i) => [i.id, i]));
    const locOf = (id: string) => {
      const i = inst.get(id);
      return i ? this.byRoom.get(i.roomId)!.room.location?.kind ?? null : null;
    };
    for (const l of sv.run.links) {
      // переход спец-локации / выход лифта: у локации метки нет, у выхода — метка прихода
      for (const e of l.kind === 'descent' || l.kind === 'lift' ? [l.b] : [l.a, l.b]) {
        const i = inst.get(e.inst);
        if (!i || !this.byRoom.get(i.roomId)!.room.connectors.some((c) => c.id === e.connector)) {
          bad.push(`связь ${e.inst}/${e.connector} ведёт в несуществующую метку`);
        }
      }
      if (l.kind === 'descent' && locOf(l.a.inst) !== 'stairwell') bad.push(`переход вниз из ${l.a.inst} — у комнаты больше нет спец-локации`);
      if (l.kind === 'lift') {
        if (locOf(l.a.inst) !== 'lift') bad.push(`выход лифта из ${l.a.inst} — у комнаты больше нет спец-локации лифта`);
        else if (!Number.isInteger(l.floors) || l.floors === 0 || (l.side !== 'straight' && l.side !== 'right')) {
          bad.push(`выход лифта из ${l.a.inst}: этаж ${l.floors}, выход ${l.side} — так не бывает`);
        }
      }
    }
    return bad;
  }

  /** Восстановить мир из сохранения без генерации: геометрия — из проекта по roomId + rot + dx + dy + w. */
  private restore(sv: StreamSave): void {
    const { ctx, lay } = this;
    const run = sv.run;
    // пересечения в 3D — из сводки (пересчёт на тысячах комнат — основная цена загрузки)
    const savedOverlaps = typeof run.fold?.overlaps === 'number' ? run.fold.overlaps : null;
    // комнаты — по порядку, затем связи — по порядку: индексы комнат и проёмов в пространстве лучей,
    // PVS и соседи — те же, что были в живом мире
    for (const inst of run.instances) {
      const parent = inst.parent ? this.byId.get(inst.parent) ?? null : null;
      const n = place(ctx, lay, this.byRoom.get(inst.roomId)!, inst.rot, inst.dx, inst.dy, inst.w ?? 0, parent, inst.floor ?? 0);
      this.byId.set(n.inst.id, n);
    }
    const parentConn = new Map<string, string>();
    for (const l of run.links) {
      const a = this.byId.get(l.a.inst)!, b = this.byId.get(l.b.inst)!;
      if (l.wrap) {
        // шов бесконечного прямого хода: обе метки заняты, соседи по графу, проёма в пространстве лучей нет
        a.linked[a.info.room.connectors.findIndex((c) => c.id === l.a.connector)] = true;
        b.linked[b.info.room.connectors.findIndex((c) => c.id === l.b.connector)] = true;
        a.nb.push(b);
        b.nb.push(a);
        this.trans.push({ a: { ...l.a }, b: { ...l.b }, dw: b.w - a.w, wrap: [l.wrap[0], l.wrap[1]] });
        this.wraps++;
        continue;
      }
      if (l.kind === 'descent' || l.kind === 'lift') {
        // переход спец-локации / выход лифта: метка прихода занята, проёма и соседства нет
        b.linked[b.info.room.connectors.findIndex((c) => c.id === l.b.connector)] = true;
        let conn: string;
        if (l.kind === 'descent') {
          this.trans.push({ a: { ...l.a }, b: { ...l.b }, kind: 'descent', floors: l.floors });
          this.exitBy.set(a.inst.order, b);
          conn = DESCENT_CONN;
        } else {
          const f = l.floors!, side = l.side!;
          this.trans.push({ a: { ...l.a }, b: { ...l.b }, kind: 'lift', floors: f, side });
          this.liftBy.set(`${a.inst.order}:${f}:${side}`, b);
          conn = liftConn(f, side);
        }
        if (b.inst.parent === a.inst.id && !parentConn.has(b.inst.id)) parentConn.set(b.inst.id, conn);
        continue;
      }
      const ai = a.info.room.connectors.findIndex((c) => c.id === l.a.connector);
      const bi = b.info.room.connectors.findIndex((c) => c.id === l.b.connector);
      a.linked[ai] = b.linked[bi] = true;
      a.nb.push(b);
      b.nb.push(a);
      lay.sight.addPortal(a.inst.order, a.conns[ai], b.inst.order, b.conns[bi]);
      lay.links.push({ a: { ...l.a }, b: { ...l.b }, dw: b.w - a.w, ...(l.loose ? { loose: true as const } : {}) });
      // связь дерева роста — первая связь родитель → ребёнок (петли всегда позже)
      if (b.inst.parent === a.inst.id && !parentConn.has(b.inst.id)) parentConn.set(b.inst.id, l.a.connector);
      if (a.w !== b.w) this.shifted++;
    }
    const nd = this.trans.length;
    this.loops = run.links.length - nd - Math.max(0, run.instances.length - 1 - nd);
    this.grown = Math.max(0, run.instances.length - 1 - nd);
    const exp = new Set(sv.expanded);
    const sp = new Set(sv.spine ?? []);
    const derive = !Array.isArray(run.content) || run.content.length !== run.instances.length;
    // режим квартир: квартиры — до наполнения (элитность богатой квартиры зависит от неё)
    if (sv.world && this.W) this.restoreWorld(sv.world);
    for (const n of lay.nodes) {
      const i = n.inst.order;
      const parent = n.inst.parent ? this.byId.get(n.inst.parent)! : null;
      this.addr[i] = parent ? childAddr(this.addr[parent.inst.order], parentConn.get(n.inst.id) ?? '') : ROOT_ADDR;
      this.expandedF[i] = exp.has(n.inst.id);
      this.spine[i] = sp.has(n.inst.id);
      if (this.spine[i] && !this.expandedF[i]) this.spinePending++;
      this.kids[i] = [];
      if (parent) this.kids[parent.inst.order].push(n);
      if (n.info.room.unique) this.uniqueUsed.add(n.info);
      if (!this.expandedF[i]) {
        n.conns.forEach((c, ci) => {
          if (c.len < 1 || n.linked[ci]) return;
          this.indexDoor(n, ci);
          if (n.info.grow[ci]) this.growPending++;
        });
      }
      if (savedOverlaps === null) this.overlaps += this.conflictsOf(n);
      this.all.add(n);
      if (n.w < this.minW) this.minW = n.w;
      if (n.w > this.maxW) this.maxW = n.w;
      this.addFloor(n.floor);
      if (derive) this.content.push(this.rollFor(n, parent));
    }
    if (savedOverlaps !== null) this.overlaps = savedOverlaps;
    if (!derive) {
      this.content.push(...run.content);
      this.totals = { ...run.totals };
    }
    const why = sv.deadWhy ?? [];
    sv.dead.forEach((key, k) => {
      const cut = key.lastIndexOf('/');
      const n = this.byId.get(key.slice(0, cut));
      const ci = n ? n.info.room.connectors.findIndex((c) => c.id === key.slice(cut + 1)) : -1;
      if (!n || ci < 0) return;
      const w = (why[k] ?? 'space') as DeadWhy;
      this.dead.set(dk(n.inst.order, ci), w);
      if (w === 'chance') this.deadChance++;
      else { this.deadFail++; if (isWhy(w)) n.why[ci] = w; }
    });
    if (this.pvsOpt && run.pvs) {
      const order = new Map(lay.instances.map((x) => [x.id, x.order]));
      for (const [id, list] of Object.entries(run.pvs)) {
        const i = order.get(id);
        if (i === undefined) continue;
        for (const m of list) { const j = order.get(m); if (j !== undefined) lay.pvs[i].add(j); }
      }
      this.pvsRec = { ...run.pvs };
    } else if (this.pvsOpt) {
      // PVS в сохранении нет — посчитать заново по восстановленной геометрии
      for (let i = 0; i < lay.nodes.length; i++) addPvs(lay, i, computePvs(lay.sight, i, this.pvsOpt.reach, this.pvsOpt.tol));
      for (let i = 0; i < lay.nodes.length; i++) this.dirty.add(i);
    }
    this.best = { m: run.sight?.maxM ?? 0, line: run.sight?.line ?? null };
    this.warnings.push(...(run.warnings ?? []));
    this.startId = lay.nodes.length ? lay.nodes[0].inst.id : null;
    this.ms = run.ms ?? 0;
  }

  /** Квартиры, выходы, исчезнувшие двери, посещённые комнаты и счётчик переходов — из сохранения. */
  private restoreWorld(ws: WorldSave): void {
    const key = (s: string): number | null => {
      const cut = s.lastIndexOf('/');
      const n = this.byId.get(s.slice(0, cut));
      const ci = n ? n.info.room.connectors.findIndex((c) => c.id === s.slice(cut + 1)) : -1;
      return n && ci >= 0 ? dk(n.inst.order, ci) : null;
    };
    const order = (id: string | null) => (id === null ? null : this.byId.get(id)?.inst.order ?? null);
    ws.clusterOf.forEach((c, i) => (this.clusterOf[i] = c));
    ws.clusters.forEach((c, id) => {
      const cl: Cluster = {
        id, biome: c.biome, home: c.home, rich: c.rich, entry: order(c.entry) ?? -1, rooms: [],
        exits: c.exits.map(key).filter((k): k is number => k !== null),
        opened: c.opened.map(key).filter((k): k is number => k !== null),
        transition: order(c.transition),
        tunnels: c.tunnels === true,
      };
      for (const k of cl.exits) this.exitDoors.set(k, id);
      this.clusters.push(cl);
    });
    ws.clusterOf.forEach((c, i) => { if (c >= 0 && this.clusters[c]) this.clusters[c].rooms.push(i); });
    for (const li of ws.sealed) this.sealed.add(li);
    for (const id of ws.visited) { const i = order(id); if (i !== null) this.visited.add(i); }
    ws.clusterOf.forEach((_, i) => (this.tdist[i] = Array.isArray(ws.tdist) && typeof ws.tdist[i] === 'number' ? ws.tdist[i] : -1));
    this.hubs = this.lay.nodes.filter((n) => this.clusters[this.clusterOf[n.inst.order] ?? -1]?.tunnels && tunKind(n.info) === 'hub').length;
    this.tr = { count: ws.tr.count, resets: ws.tr.resets, pending: ws.tr.pending };
  }
}

/** Создать мир (или восстановить из сохранения — тогда settings берутся из него). */
export function createStreamWorld(p: Project, settings: StreamSettings, save?: StreamSave): StreamWorld {
  return new Stream(p, settings, save);
}
