// Сериализация и разбор (ТЗ §3, §4). Внутреннее представление (Set клеток) и внешний формат
// (сжатые строки) меняются независимо — вся конверсия только здесь.
import type {
  Assign,
  FoldSettings,
  Connector,
  Decor,
  Door,
  Economy,
  Finish,
  FinishRule,
  FinishSurface,
  GeneratorSettings,
  Item,
  LootRow,
  LootStep,
  MatchMode,
  Pass,
  Project,
  Prop,
  Room,
  RoomElite,
  Segment,
  Shop,
  ShopOffer,
  Side,
  Spot,
  SpotGroup,
  Tier,
  TierLootRow,
  Variant,
} from './types';
import { cloneWorld, newWorldSettings, normWorld } from '../gen4d/biomes';
import { areaM2, decodeCells, encodeCells } from './cells';
import { uid } from './ops';
import { cloneLocation, parseLocation } from '../locations/stairwell';
import { cloneStair, parseStair } from './stairs';

export const FORMAT = 'room-forge';
export const FORMAT_VERSION = 1;

/** Внешний вид комнаты: cells — string[] сжатых рядов, плюс вычисленное areaM2. */
export type RoomJSON = Omit<Room, 'cells'> & { cells: string[]; areaM2: number };

export type ProjectJSON = Omit<Project, 'rooms'> & {
  format: typeof FORMAT;
  version: number;
  rooms: RoomJSON[];
};

/** Глубокая копия JSON-подобного значения. Строки (в т.ч. data:URI текстур) не копируются —
 *  они неизменяемы, переносится только ссылка. */
function clone<T>(v: T): T {
  if (Array.isArray(v)) return v.map(clone) as T;
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const k in v) o[k] = clone((v as Record<string, unknown>)[k]);
    return o as T;
  }
  return v;
}

/** Проект → JSON-совместимый объект (без Set). Не мутирует. */
export function serializeProject(p: Project): ProjectJSON {
  return {
    format: FORMAT,
    version: FORMAT_VERSION,
    settings: clone(p.settings),
    props: clone(p.props),
    items: clone(p.items),
    rooms: p.rooms.map((r) => serializeRoom(r, p.settings.cellM)),
    generator: clone(p.generator),
    economy: clone(p.economy),
    // явный порядок полей — экспорт читаем и не зависит от того, как отделку создали
    finishes: (p.finishes ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      surface: f.surface,
      color: f.color,
      tex: f.tex,
      tileW: f.tileW,
      tileH: f.tileH,
      dado: f.dado ? { finishId: f.dado.finishId, heightM: f.dado.heightM } : null,
      tags: [...f.tags],
    })),
    finishRules: (p.finishRules ?? []).map((r) => ({
      tag: r.tag,
      wall: r.wall.map((x) => ({ finishId: x.finishId, weight: x.weight })),
      floor: r.floor.map((x) => ({ finishId: x.finishId, weight: x.weight })),
    })),
    world: cloneWorld(p.world ?? newWorldSettings()),
  };
}

export function serializeRoom(r: Room, cellM: number): RoomJSON {
  // явный порядок полей — для читаемого экспорта
  return {
    id: r.id,
    name: r.name,
    tags: [...r.tags],
    unique: r.unique,
    gen: { ...r.gen },
    cells: encodeCells(r.cells),
    areaM2: areaM2(r.cells, cellM),
    doors: clone(r.doors),
    connectors: clone(r.connectors),
    decor: clone(r.decor),
    spots: clone(r.spots),
    spotGroups: clone(r.spotGroups),
    loot: clone(r.loot),
    elite: clone(r.elite),
    note: r.note,
    finish: { wall: r.finish?.wall ?? null, floor: r.finish?.floor ?? null },
    // спец-локация (src/locations/): поле пишется, только если задано у комнаты
    ...(r.location !== undefined ? { location: cloneLocation(r.location) } : {}),
    // лестница с перепадом высоты (src/model/stairs.ts): тоже только если задана
    ...(r.stair ? { stair: cloneStair(r.stair) } : {}),
    // своя высота потолка (залы метро): тоже только если задана
    ...(r.ceilM !== undefined ? { ceilM: r.ceilM } : {}),
  };
}

// ───────────── Толерантный разбор ─────────────

/** Настройки складчатого (4D) генератора; по умолчанию — «много складок» под портальный рендер. */
function parseFold(v: unknown): FoldSettings {
  const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const n = (x: unknown, d: number, lo: number, hi: number, isInt = false) =>
    typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, isInt ? Math.round(x) : x)) : d;
  return {
    shiftChance: n(o.shiftChance, 0.2, 0, 1),
    maxShift: n(o.maxShift, 2, 0, 16, true),
    localRadius: n(o.localRadius, 2, 1, 6, true),
    maxLayer: n(o.maxLayer, 12, 0, 1000, true),
    seamless: typeof o.seamless === 'boolean' ? o.seamless : false,
  };
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const objs = (v: unknown): Obj[] => arr(v).filter(isObj);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const num = (v: unknown, d: number, min = -Infinity, max = Infinity): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d;
const int = (v: unknown, d: number, min = -Infinity, max = Infinity): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : d;
const bool = (v: unknown, d = false): boolean => (typeof v === 'boolean' ? v : d);
const strs = (v: unknown): string[] => arr(v).filter((x): x is string => typeof x === 'string');
const isSide = (v: unknown): v is Side => v === 'N' || v === 'S' || v === 'E' || v === 'W';
const MATCH: MatchMode[] = ['exact', 'tag', 'len'];

/** Выдаёт id: исходный, если он непустая строка и ещё не занят в seen, иначе новый. */
function idIn(v: unknown, prefix: string, seen: Set<string>): string {
  let id = typeof v === 'string' && v ? v : '';
  if (!id || seen.has(id)) {
    do id = uid(prefix);
    while (seen.has(id));
  }
  seen.add(id);
  return id;
}

/** Ссылки, по которым чистится комната; null — не проверять (parseRoom без проекта). */
interface RefCtx {
  props: Set<string>;
  items: Set<string>;
  tiers: Set<string>;
  /** id отделки → поверхность */
  finishes: Map<string, FinishSurface>;
}

function parseSegment(o: Obj, seen: Set<string>, prefix: string): Segment | null {
  if (!isSide(o.side)) return null;
  return {
    id: idIn(o.id, prefix, seen),
    cx: int(o.cx, 0),
    cy: int(o.cy, 0),
    side: o.side,
    len: int(o.len, 1, 1),
  };
}

function parseAssign(o: unknown, ctx: RefCtx | null): Assign | null {
  if (!isObj(o)) return null;
  if (o.kind !== 'prop' && o.kind !== 'item') return null;
  if (typeof o.id !== 'string') return null;
  if (ctx && !(o.kind === 'prop' ? ctx.props : ctx.items).has(o.id)) return null;
  return { kind: o.kind, id: o.id, rot: num(o.rot, 0) };
}

function parseRoomWith(json: unknown, ctx: RefCtx | null, roomId: string): Room {
  if (!isObj(json)) throw new Error('Комната: ожидался объект');
  const o = json;
  const g = isObj(o.gen) ? o.gen : {};

  const doorIds = new Set<string>();
  const doors: Door[] = [];
  for (const d of objs(o.doors)) {
    const s = parseSegment(d, doorIds, 'door');
    if (s) doors.push(s);
  }
  const conIds = new Set<string>();
  const connectors: Connector[] = [];
  for (const c of objs(o.connectors)) {
    const s = parseSegment(c, conIds, 'con');
    if (s) {
      const con: Connector = { ...s, name: str(c.name), tag: str(c.tag) };
      // порог складчатого генератора: хранится только отличный от 'auto'
      if (c.shift === 'always' || c.shift === 'never') con.shift = c.shift;
      connectors.push(con);
    }
  }

  const decorIds = new Set<string>();
  const decor: Decor[] = [];
  for (const d of objs(o.decor)) {
    if (typeof d.propId !== 'string') continue;
    if (ctx && !ctx.props.has(d.propId)) continue;
    decor.push({ id: idIn(d.id, 'dec', decorIds), propId: d.propId, x: num(d.x, 0), y: num(d.y, 0), rot: num(d.rot, 0) });
  }

  // группы — раньше спотов, чтобы проверить spot.groupId
  const groupIds = new Set<string>();
  const rawGroups = objs(o.spotGroups).map((gr) => ({ gr, id: idIn(gr.id, 'grp', groupIds) }));

  const spotIds = new Set<string>();
  const spots: Spot[] = objs(o.spots).map((s) => ({
    id: idIn(s.id, 'spot', spotIds),
    name: str(s.name),
    x: num(s.x, 0),
    y: num(s.y, 0),
    rot: num(s.rot, 0),
    groupId: typeof s.groupId === 'string' && groupIds.has(s.groupId) ? s.groupId : null,
  }));

  const varIds = new Set<string>();
  const spotGroups: SpotGroup[] = rawGroups.map(({ gr, id }) => {
    const own = new Set(spots.filter((s) => s.groupId === id).map((s) => s.id));
    const variants: Variant[] = objs(gr.variants).map((v) => {
      const assign: Record<string, Assign> = {};
      if (isObj(v.assign)) {
        for (const [spotId, a] of Object.entries(v.assign)) {
          if (!own.has(spotId)) continue;
          const pa = parseAssign(a, ctx);
          if (pa) assign[spotId] = pa;
        }
      }
      return { id: idIn(v.id, 'var', varIds), weight: num(v.weight, 1, 0), assign };
    });
    return { id, name: str(gr.name, 'Группа'), color: str(gr.color, '#6aa0d8'), variants };
  });

  const lootIds = new Set<string>();
  const loot: LootRow[] = [];
  for (const l of objs(o.loot)) {
    if (typeof l.itemId !== 'string') continue;
    if (ctx && !ctx.items.has(l.itemId)) continue;
    const min = int(l.min, 1, 0);
    loot.push({ id: idIn(l.id, 'loot', lootIds), itemId: l.itemId, chance: num(l.chance, 1, 0, 1), min, max: int(l.max, min, min) });
  }

  const elite: RoomElite[] = [];
  for (const e of objs(o.elite)) {
    if (typeof e.tierId !== 'string') continue;
    if (ctx && !ctx.tiers.has(e.tierId)) continue;
    elite.push({ tierId: e.tierId, weight: num(e.weight, 1, 0) });
  }

  // явная отделка: ссылка на существующую отделку своей поверхности, иначе null (по правилу)
  const fo = isObj(o.finish) ? o.finish : {};
  const fin = (v: unknown, s: FinishSurface): string | null =>
    typeof v === 'string' && v && (!ctx || ctx.finishes.get(v) === s) ? v : null;

  const min = int(g.min, 0, 0);
  return {
    id: roomId,
    name: str(o.name, 'Комната'),
    tags: strs(o.tags),
    unique: bool(o.unique),
    gen: { weight: num(g.weight, 1, 0), min, max: int(g.max, 99, 0) },
    // areaM2 во входе игнорируется — это вычисляемое значение
    cells: decodeCells(strs(o.cells)),
    doors,
    connectors,
    decor,
    spots,
    spotGroups,
    loot,
    elite,
    note: str(o.note),
    finish: { wall: fin(fo.wall, 'wall'), floor: fin(fo.floor, 'floor') },
    // спец-локация: нет поля — обычная комната; некорректная — null, диапазоны нормализуются
    ...('location' in o ? { location: parseLocation(o.location) } : {}),
    ...(parseStair(o.stair) ? { stair: parseStair(o.stair) } : {}),
    // своя высота потолка, м: мусор и неположительное — нет поля (wallHeightM)
    ...(typeof o.ceilM === 'number' && Number.isFinite(o.ceilM) && o.ceilM > 0 ? { ceilM: Math.min(50, o.ceilM) } : {}),
  };
}

export function parseRoom(json: unknown): Room {
  if (!isObj(json)) throw new Error('Это не комната Room Forge: ожидался JSON-объект');
  return parseRoomWith(json, null, idIn(json.id, 'room', new Set()));
}

function parseEconomy(json: unknown, items: Set<string>): Economy {
  const o = isObj(json) ? json : {};

  const shopIds = new Set<string>();
  const shops: Shop[] = [];
  for (const s of objs(o.shops)) {
    if (typeof s.currencyItemId !== 'string' || !items.has(s.currencyItemId)) continue;
    const offerIds = new Set<string>();
    const offers: ShopOffer[] = [];
    for (const f of objs(s.offers)) {
      if (typeof f.itemId !== 'string' || !items.has(f.itemId)) continue;
      offers.push({ id: idIn(f.id, 'offer', offerIds), itemId: f.itemId, price: num(f.price, 1, 0) });
    }
    shops.push({
      id: idIn(s.id, 'shop', shopIds),
      name: str(s.name, 'Магазин'),
      currencyItemId: s.currencyItemId,
      offers,
      note: str(s.note),
    });
  }

  const passIds = new Set<string>();
  const passes: Pass[] = [];
  for (const p of objs(o.passes)) {
    if (typeof p.priceItemId !== 'string' || !items.has(p.priceItemId)) continue;
    const itemBoost: Record<string, number> = {};
    if (isObj(p.itemBoost)) {
      for (const [k, v] of Object.entries(p.itemBoost)) {
        if (items.has(k) && typeof v === 'number' && Number.isFinite(v)) itemBoost[k] = v;
      }
    }
    passes.push({
      id: idIn(p.id, 'pass', passIds),
      name: str(p.name, 'Проходка'),
      priceItemId: p.priceItemId,
      price: num(p.price, 1, 0),
      tierBoost: num(p.tierBoost, 1, 0),
      itemBoost,
      note: str(p.note),
    });
  }

  const tierIds = new Set<string>();
  const tiers: Tier[] = objs(o.tiers).map((t) => {
    const rowIds = new Set<string>();
    const loot: TierLootRow[] = [];
    for (const r of objs(t.loot)) {
      const src = isObj(r.source) ? r.source : null;
      if (!src || typeof src.id !== 'string') continue;
      if (src.kind === 'item' ? !items.has(src.id) : src.kind === 'shop' ? !shopIds.has(src.id) : true) continue;
      const steps: LootStep[] = objs(r.steps).map((st) => ({ upTo: int(st.upTo, 1, 1), chance: num(st.chance, 0, 0, 1) }));
      loot.push({
        id: idIn(r.id, 'tl', rowIds),
        source: { kind: src.kind as 'item' | 'shop', id: src.id },
        steps,
        where: str(r.where),
      });
    }
    return {
      id: idIn(t.id, 'tier', tierIds),
      name: str(t.name, 'Тир'),
      level: int(t.level, 1, 1),
      danger: num(t.danger, 0),
      color: str(t.color, '#c9a227'),
      note: str(t.note),
      loot,
    };
  });

  return { tiers, shops, passes, dangerLimit: num(o.dangerLimit, 100, 0) };
}

/** Размер повтора текстуры, м: > 0, иначе 0.5. */
const tile = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(v, 100) : 0.5);

/**
 * Отделки и правила. Висячие ссылки вычищаются: dado — только на существующую стеновую отделку
 * (не на себя) и только у стен; строки правил — только на существующую отделку своей поверхности;
 * правила без тега и повторы тега (берётся первое) отбрасываются.
 */
function parseFinishes(jf: unknown, jr: unknown): { finishes: Finish[]; finishRules: FinishRule[] } {
  const ids = new Set<string>();
  const raw = objs(jf).map((f) => ({ f, id: idIn(f.id, 'fin', ids) }));
  const surf = new Map<string, FinishSurface>();
  for (const { f, id } of raw) surf.set(id, f.surface === 'floor' ? 'floor' : 'wall');
  const finishes: Finish[] = raw.map(({ f, id }) => {
    const surface = surf.get(id)!;
    const d = isObj(f.dado) ? f.dado : null;
    const dadoOk = surface === 'wall' && d && typeof d.finishId === 'string' && d.finishId !== id && surf.get(d.finishId) === 'wall';
    return {
      id,
      name: str(f.name, 'Отделка'),
      surface,
      color: str(f.color, surface === 'wall' ? '#b9b29c' : '#8c7a62'),
      tex: typeof f.tex === 'string' && f.tex ? f.tex : null,
      tileW: tile(f.tileW),
      tileH: tile(f.tileH),
      dado: dadoOk ? { finishId: d!.finishId as string, heightM: num(d!.heightM, 1.5) > 0 ? num(d!.heightM, 1.5) : 1.5 } : null,
      tags: strs(f.tags),
    };
  });
  const rows = (v: unknown, s: FinishSurface) =>
    objs(v)
      .filter((x) => typeof x.finishId === 'string' && surf.get(x.finishId) === s)
      .map((x) => ({ finishId: x.finishId as string, weight: num(x.weight, 1, 0) }));
  const tags = new Set<string>();
  const finishRules: FinishRule[] = [];
  for (const r of objs(jr)) {
    if (typeof r.tag !== 'string' || !r.tag || tags.has(r.tag)) continue;
    tags.add(r.tag);
    finishRules.push({ tag: r.tag, wall: rows(r.wall, 'wall'), floor: rows(r.floor, 'floor') });
  }
  return { finishes, finishRules };
}

/**
 * Разбор (из localStorage или импорта). Толерантен: недостающие поля заполняются значениями
 * по умолчанию, висячие ссылки (декор на несуществующий prop, assign на несуществующий
 * спот/предмет, loot на несуществующий item, тиры и т.п.) вычищаются.
 * Бросает Error с человекочитаемым текстом, если это вообще не проект.
 */
export function parseProject(json: unknown): Project {
  if (!isObj(json)) throw new Error('Это не проект Room Forge: ожидался JSON-объект');
  if (json.format !== undefined && json.format !== FORMAT) {
    throw new Error(`Это не проект Room Forge: неизвестный формат «${String(json.format)}»`);
  }
  if (json.format === undefined && !Array.isArray(json.rooms)) {
    throw new Error('Это не проект Room Forge: нет поля format и списка комнат rooms');
  }
  if (json.rooms !== undefined && !Array.isArray(json.rooms)) {
    throw new Error('Проект повреждён: поле rooms должно быть массивом');
  }
  const def = emptyProject();
  const st = isObj(json.settings) ? json.settings : {};
  const settings = { cellM: num(st.cellM, def.settings.cellM) > 0 ? num(st.cellM, def.settings.cellM) : def.settings.cellM };

  const propIds = new Set<string>();
  const props: Prop[] = objs(json.props).map((p) => ({
    id: idIn(p.id, 'prop', propIds),
    name: str(p.name, 'Декор'),
    w: num(p.w, 1) > 0 ? num(p.w, 1) : 1,
    h: num(p.h, 0.5) > 0 ? num(p.h, 0.5) : 0.5,
    color: str(p.color, '#8a7a5c'),
    tex: typeof p.tex === 'string' && p.tex ? p.tex : null,
    tags: strs(p.tags),
  }));

  const itemIds = new Set<string>();
  const items: Item[] = objs(json.items).map((it) => ({
    id: idIn(it.id, 'item', itemIds),
    name: str(it.name, 'Предмет'),
    color: str(it.color, '#c9a227'),
    tags: strs(it.tags),
    note: str(it.note),
  }));

  const economy = parseEconomy(json.economy, itemIds);
  const { finishes, finishRules } = parseFinishes(json.finishes, json.finishRules);
  const ctx: RefCtx = {
    props: propIds,
    items: itemIds,
    tiers: new Set(economy.tiers.map((t) => t.id)),
    finishes: new Map(finishes.map((f) => [f.id, f.surface])),
  };

  const roomIds = new Set<string>();
  const rooms: Room[] = [];
  for (const r of arr(json.rooms)) {
    if (!isObj(r)) continue;
    rooms.push(parseRoomWith(r, ctx, idIn(r.id, 'room', roomIds)));
  }

  const g = isObj(json.generator) ? json.generator : {};
  const dg = def.generator;
  const generator: GeneratorSettings = {
    seed: str(g.seed, dg.seed),
    count: int(g.count, dg.count, 1),
    gap: int(g.gap, dg.gap, 0),
    match: MATCH.includes(g.match as MatchMode) ? (g.match as MatchMode) : dg.match,
    startRoomId: typeof g.startRoomId === 'string' && roomIds.has(g.startRoomId) ? g.startRoomId : null,
    passId: typeof g.passId === 'string' && economy.passes.some((p) => p.id === g.passId) ? g.passId : null,
    sightM: num(g.sightM, dg.sightM, 0, 1000),
    fill: bool(g.fill, dg.fill),
    mode: g.mode === 'fold' ? 'fold' : 'euclid',
    fold: parseFold(g.fold),
  };

  // бесконечный мир (4D): биомы, квартиры, переходы; в старых проектах нет — по умолчанию
  const world = normWorld(json.world);

  return { settings, props, items, rooms, generator, economy, finishes, finishRules, world };
}

/** Пустой проект со значениями по умолчанию (без пресетов). */
export function emptyProject(): Project {
  return {
    settings: { cellM: 0.1 },
    props: [],
    items: [],
    rooms: [],
    generator: { seed: 'hrush-001', count: 30, gap: 1, match: 'exact', startRoomId: null, passId: null, sightM: 0, fill: false, mode: 'euclid', fold: { shiftChance: 0.5, maxShift: 3, localRadius: 1, maxLayer: 12, seamless: false } },
    economy: { tiers: [], shops: [], passes: [], dangerLimit: 100 },
    finishes: [],
    finishRules: [],
    world: newWorldSettings(),
  };
}
