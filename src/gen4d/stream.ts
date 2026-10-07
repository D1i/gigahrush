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
// Спец-локации (Room.location, src/locations/): экземпляр локации вниз сам не раскрывается — переход на этаж(и)
// ниже создаёт только descend() (комната-выход на этаже floor − k и связь kind 'descent'); этаж — ещё одно
// измерение занятости, как W (docs/LOCATIONS.md, docs/GENERATOR-4D.md §15.14).
import { OPPOSITE } from '../model/cells';
import { hashSeed, makeRng, type Rng } from '../model/rng';
import type {
  FoldSettings, FoldStats, InstanceContent, LairSpec, LiftSide, LiftSpec, Link, LocationSpec, MatchMode, Project, Room, Rot, Run, StairwellSpec,
} from '../model/types';
import { locationSeedKey, rollStairwell, type StairwellRoll } from '../locations/stairwell';
import { rollLift, type LiftRoll } from '../locations/lift';
import { rollContent } from '../gen/generate';
import { walkWarning } from '../gen/walk';
import { compatible, facing, OUT_SIGN, segLine } from '../gen/geom';
import { sightLimits } from '../gen/sight';
import {
  addPvs, around, buildPool, growFrom, growOthers, layerFree, LIMIT, newLay, normFold, pickWeighted, place, PVS_TOL_M, RESERVE_MAX, tryLink,
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
}

/** Состояние двери экземпляра: связана / заколочена (тупик) / ещё не раскрыта. */
export type DoorState = 'linked' | 'dead' | 'pending';

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
  /** переходов вниз из спец-локаций (descend); этажей с комнатами; самый нижний этаж */
  descents: number;
  floors: number;
  minFloor: number;
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
   *  выходом side на этаже floor(лифта) + floor (1…roll.floors) и связь kind 'lift' (floors, side); если это
   *  логово по розыгрышу (roll.lair) — комнату с location.kind 'lair'. Повторный вызов — тот же id. Ошибка, если
   *  экземпляр не лифт или этаж вне 1…roll.floors */
  ascend(instId: string, floor: number, side: LiftSide): string;
  /** комната за выходом лифта, если ascend уже был; иначе null */
  liftExitOf(instId: string, floor: number, side: LiftSide): string | null;
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

type DeadWhy = 'chance' | Why;

interface DoorRef { n: Node; ci: number }

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
  /** связи-переходы спец-локаций (kind 'descent'): отдельно от lay.links — индексы lay.links = индексы проёмов в
   *  пространстве лучей; в Run.links идут после дверей */
  private readonly descents: Link[] = [];
  /** экземпляр локации (order) → комната-выход */
  private readonly exitBy = new Map<number, Node>();
  private readonly floorSet = new Set<number>([0]);
  private minFloor = 0;
  private readonly dirty = new Set<number>();
  private pvsRec: Record<string, string[]> = {};
  private ms = 0;
  private readonly times: number[] = [];
  private version = 0;
  private cache: { v: number; run: Run } | null = null;
  private readonly listeners = new Set<(ids: string[]) => void>();

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
    this.cands = pool.filter((i) => i.weight > 0 && i.effMax > 0);
    // веса выбора: ветвистость и модификаторы сида
    for (const i of this.cands) this.wt.set(i, Math.max(0, applyMods(s.mods, i.room, i.weight * branchMul(i.grow, s.branching))));
    this.gen = {
      seed: s.seed, count: 1, gap: s.gap, match: s.match, startRoomId: s.startRoomId, passId: null,
      sightM: s.sightM, fill: false, mode: 'fold', fold: s.fold,
    };
    this.ctx = {
      s: this.gen, f: s.fold, gap: s.gap, shapes: new Shapes(s.gap), pool, lim,
      seam: s.fold.seamless && lim ? { reach, tol } : null,
    };
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
    this.onPlaced(n, null, ROOT_ADDR);
    this.setSpine(n);
    this.startId = n.inst.id;
    this.ms += now() - t0;
  }

  // ───────── постановка и двери ─────────

  /** Учёт нового экземпляра (место, связь с родителем и PVS уже в Lay). portal = false — пришли не через дверь
   *  (комната-выход спец-локации): проёма к родителю нет. */
  private onPlaced(n: Node, parent: Node | null, addr: string, portal = true): void {
    const lay = this.lay;
    const i = n.inst.order;
    this.addr[i] = addr;
    this.expandedF[i] = false;
    this.spine[i] = false;
    this.kids[i] = [];
    if (parent) this.kids[parent.inst.order].push(n);
    this.byId.set(n.inst.id, n);
    if (n.info.room.unique) this.uniqueUsed.add(n.info);
    n.conns.forEach((c, ci) => {
      if (c.len < 1 || n.linked[ci]) return;
      this.indexDoor(n, ci);
      if (n.info.grow[ci]) this.growPending++;
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
    this.floorSet.add(n.floor);
    if (n.floor < this.minFloor) this.minFloor = n.floor;
    if (parent && portal && n.w !== parent.w) this.shifted++;
    this.content.push(this.rollFor(n, parent));
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

  /** Наполнение — от адреса экземпляра (не от порядка раскрытий). */
  private rollFor(n: Node, parent: Node | null): InstanceContent {
    const a = this.addr[n.inst.order];
    const c = rollContent(this.p, n.info.room, n.inst, this.root.sub(`content:${a}`), null, this.root.sub(`finish:${a}`));
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
      P.why[ci] = why;
    }
  }

  /** Петля к нераскрытой двери напротив (в любом слое); кандидаты — в каноническом порядке. */
  private tryLoop(P: Node, ci: number): boolean {
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
      if (d.n !== P && d.n.floor === P.floor && compatible(A, B, this.settings.match) && facing(A, B, gap)) found.push(d);
    }
    list.length = w;
    if (found.length === 0) return false;
    found.sort((a, b) => this.canon(a.n, b.n) || a.ci - b.ci);
    for (const d of found) {
      if (!tryLink(this.ctx, this.lay, P, ci, d.n, d.ci, this.ctx.seam ? null : this.pvsOpt)) continue;
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

  /** Кандидаты и складчатая стыковка к двери ci экземпляра P. */
  private grow(P: Node, ci: number, D: Rng, growFirst: boolean, win: Map<Info, number>): { child: Node | null; why: Why } {
    const A = P.conns[ci];
    const match = this.settings.match;
    // все совместимые комнаты; запрещённые сейчас (unique уже стоит, max в окрестности) остаются в списке
    // весов и пропускаются, только если выпали, — выбор остальных от них не зависит
    const g = this.cands.filter((info) => info.room.connectors.some((b) => b.len >= 1 && compatible(A, b, match)));
    let skipped = 0;
    const skip = (info: Info) => {
      const no = (info.room.unique && this.uniqueUsed.has(info)) || (win.get(info) ?? 0) >= info.effMax;
      if (no) skipped++;
      return no;
    };
    const fails: Fails = { space: 0, rule: 0, sight: 0, seam: 0 };
    const opts = { weightOf: (x: Info) => this.wt.get(x) ?? x.weight, skip, stick: true };
    for (const growOnly of growFirst ? [true, false] : [false]) {
      const okB = (info: Info, b: Room['connectors'][number], bi: number) =>
        b.len >= 1 && compatible(A, b, match) && (!growOnly || growOthers(info, bi) > 0);
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
    if (n.linked[ci]) return 'linked';
    return this.dead.has(dk(n.inst.order, ci)) ? 'dead' : 'pending';
  }

  addressOf(instId: string): string | null {
    const n = this.byId.get(instId);
    return n ? this.addr[n.inst.order] : null;
  }

  // ───────── спец-локации: переход вниз ─────────

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

  ascend(instId: string, floor: number, side: LiftSide): string {
    void instId, floor, side;
    throw new Error('ascend: TODO(логика лифта) — ещё не реализовано');
  }

  liftExitOf(instId: string, floor: number, side: LiftSide): string | null {
    void instId, floor, side;
    return null;
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
    const pick = this.pickExit(E);
    if (!pick) throw new Error(`descend: в проекте нет комнаты-выхода для «${L.info.room.name}» (нужна комната с меткой)`);
    const { info, arrive } = pick;
    const ci = arrive[E.int(0, arrive.length - 1)];
    const rot = (E.int(0, 3) * 90) as Rot;
    const { dx, dy, w } = this.exitSpot(L, info, rot, floor);
    const n = place(this.ctx, this.lay, info, rot, dx, dy, w, L, floor);
    n.linked[ci] = true;
    this.descents.push({ a: { inst: L.inst.id, connector: '' }, b: { inst: n.inst.id, connector: info.room.connectors[ci].id }, kind: 'descent', floors: k });
    this.exitBy.set(L.inst.order, n);
    this.onPlaced(n, L, childAddr(addr, DESCENT_CONN), false);
    if (this.canGrow(n)) this.setSpine(n);
    return n;
  }

  /**
   * Выбор комнаты-выхода (один взвешенный бросок): кандидаты — комнаты пула без спец-локации (unique — если ещё
   * не стоит), по ступеням, первая непустая:
   *  1) тег из EXIT_TAGS и марш (метка ARRIVAL_TAG), кроме которого есть ростовая метка — приходят по маршу;
   *  2) то же без требования тега;
   *  3) тег из EXIT_TAGS или 'start' и ≥ 2 меток — приходят через любую, кроме которой есть ростовая;
   *  4) любая комната с меткой.
   * Вес — как при росте (weight × ветвистость × модификаторы). arrive — индексы меток прихода.
   */
  private pickExit(E: Rng): { info: Info; arrive: number[] } | null {
    const ok = (i: Info) => !i.room.location && !(i.room.unique && this.uniqueUsed.has(i)) && i.room.connectors.some((c) => c.len >= 1);
    const tagged = (i: Info, extra: string[] = []) => i.room.tags.some((t) => EXIT_TAGS.includes(t) || extra.includes(t));
    // метки прихода ci: кроме ci есть ростовая метка (мир пойдёт дальше)
    const via = (i: Info, stair: boolean) => i.room.connectors
      .map((c, ci) => (c.len >= 1 && (!stair || c.tag === ARRIVAL_TAG) && i.grow.some((g, j) => g && j !== ci) ? ci : -1))
      .filter((ci) => ci >= 0);
    const any = (i: Info) => {
      const v = via(i, false);
      return v.length ? v : i.room.connectors.map((c, ci) => (c.len >= 1 ? ci : -1)).filter((ci) => ci >= 0);
    };
    const all = this.infos.filter((x): x is Info => !!x);
    const tiers: [Info[], (i: Info) => number[]][] = [
      [this.cands.filter((i) => ok(i) && tagged(i)), (i) => via(i, true)],
      [this.cands.filter(ok), (i) => via(i, true)],
      [this.cands.filter((i) => ok(i) && tagged(i, ['start']) && i.room.connectors.filter((c) => c.len >= 1).length >= 2), (i) => via(i, false)],
      [all.filter(ok), any],
    ];
    for (const [list, arr] of tiers) {
      const c = list.map((info) => ({ info, arrive: arr(info) })).filter((x) => x.arrive.length > 0);
      if (c.length === 0) continue;
      return c[pickWeighted(E, c.map((x) => this.wt.get(x.info) ?? x.info.weight))];
    }
    return null;
  }

  /** Место и слой комнаты-выхода: центр — под центром локации; слой — первый свободный на этаже floor. */
  private exitSpot(L: Node, info: Info, rot: Rot, floor: number): { dx: number; dy: number; w: number } {
    const sh = this.ctx.shapes.get(info.room, rot);
    const g = this.settings.gap;
    const M = this.settings.fold.maxLayer;
    const ws = [L.w];
    for (let k = 1; k <= 2 * M + 1; k++) {
      const a = L.w <= 0 ? k : -k;
      ws.push(L.w + a, L.w - a);
    }
    const layers = ws.filter((w) => Math.abs(w) <= M);
    const cx = Math.round((L.x0 + L.x1 - sh.x0 - sh.x1) / 2), cy = Math.round((L.y0 + L.y1 - sh.y0 - sh.y1) / 2);
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
    throw new Error(`descend: на этаже ${floor} нет места для «${info.room.name}»`);
  }

  stats(): StreamStats {
    let pending = 0;
    for (const n of this.lay.nodes) {
      if (this.expandedF[n.inst.order]) continue;
      n.conns.forEach((c, ci) => { if (c.len >= 1 && !n.linked[ci]) pending++; });
    }
    // время раскрытия — по последним 500 раскрытиям (на большом мире интересно текущее, а не прогрев)
    const t = this.times.slice(-500).sort((a, b) => a - b);
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
      descents: this.descents.length,
      floors: this.floorSet.size,
      minFloor: this.minFloor,
    };
  }

  private summary(): string {
    const st = this.stats();
    const sg = (v: number) => (v > 0 ? `+${v}` : `${v}`);
    return `Бесконечный мир: комнат ${st.instances} (раскрыто ${st.expanded}), нераскрытых дверей ${st.pending} (ростовых ${st.pendingGrow}), ` +
      `тупиков ${st.deadChance + st.deadFail} (по шансу ${st.deadChance}, не встало ${st.deadFail}), петель ${st.loops}; ` +
      `слоёв ${st.layers} (W от ${sg(st.minW)} до ${sg(st.maxW)}), пар комнат в одном месте 3D — ${st.overlaps}.` +
      (st.descents ? ` Переходов вниз из спец-локаций ${st.descents}, этажей ${st.floors} (нижний ${st.minFloor}).` : '') +
      (st.pendingGrow === 0 && st.instances > 0 ? ' Мир заглох: ростовых дверей не осталось, заколоченных по шансу нет — все отказали по месту/обзору.' : '');
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
      // двери (их индексы = индексы проёмов), затем переходы спец-локаций
      links: [...lay.links, ...this.descents],
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
      savedAt: Date.now(),
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
    for (const l of sv.run.links) {
      // переход спец-локации: у локации метки нет, у выхода — метка прихода
      for (const e of l.kind === 'descent' ? [l.b] : [l.a, l.b]) {
        const i = inst.get(e.inst);
        if (!i || !this.byRoom.get(i.roomId)!.room.connectors.some((c) => c.id === e.connector)) {
          bad.push(`связь ${e.inst}/${e.connector} ведёт в несуществующую метку`);
        }
      }
      if (l.kind === 'descent') {
        const i = inst.get(l.a.inst);
        if (!i || !this.byRoom.get(i.roomId)!.room.location) bad.push(`переход вниз из ${l.a.inst} — у комнаты больше нет спец-локации`);
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
      if (l.kind === 'descent') {
        // переход спец-локации: метка прихода выхода занята, проёма и соседства нет
        b.linked[b.info.room.connectors.findIndex((c) => c.id === l.b.connector)] = true;
        this.descents.push({ a: { ...l.a }, b: { ...l.b }, kind: 'descent', floors: l.floors });
        this.exitBy.set(a.inst.order, b);
        if (b.inst.parent === a.inst.id && !parentConn.has(b.inst.id)) parentConn.set(b.inst.id, DESCENT_CONN);
        continue;
      }
      const ai = a.info.room.connectors.findIndex((c) => c.id === l.a.connector);
      const bi = b.info.room.connectors.findIndex((c) => c.id === l.b.connector);
      a.linked[ai] = b.linked[bi] = true;
      a.nb.push(b);
      b.nb.push(a);
      lay.sight.addPortal(a.inst.order, a.conns[ai], b.inst.order, b.conns[bi]);
      lay.links.push({ a: { ...l.a }, b: { ...l.b }, dw: b.w - a.w });
      // связь дерева роста — первая связь родитель → ребёнок (петли всегда позже)
      if (b.inst.parent === a.inst.id && !parentConn.has(b.inst.id)) parentConn.set(b.inst.id, l.a.connector);
      if (a.w !== b.w) this.shifted++;
    }
    const nd = this.descents.length;
    this.loops = run.links.length - nd - Math.max(0, run.instances.length - 1 - nd);
    this.grown = Math.max(0, run.instances.length - 1 - nd);
    const exp = new Set(sv.expanded);
    const sp = new Set(sv.spine ?? []);
    const derive = !Array.isArray(run.content) || run.content.length !== run.instances.length;
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
      this.floorSet.add(n.floor);
      if (n.floor < this.minFloor) this.minFloor = n.floor;
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
      else { this.deadFail++; n.why[ci] = w; }
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
}

/** Создать мир (или восстановить из сохранения — тогда settings берутся из него). */
export function createStreamWorld(p: Project, settings: StreamSettings, save?: StreamSave): StreamWorld {
  return new Stream(p, settings, save);
}
