// DSL для описания типовых помещений в метрах. Внутри всё переводится в клетки (0.1 м).
// Начало координат — левый верхний угол габарита комнаты, X вправо (восток), Y вниз (юг).
import type {
  Assign, CellKey, Connector, Decor, Door, LootRow, Room, RoomElite, RoomGen, Side, Spot, SpotGroup, Variant,
} from '../model/types';
import { bbox, cellKey, parseKey, SIDE_DELTA } from '../model/cells';
import { PROP_BY_ID } from './props';

export const CELL_M = 0.1;
/** метры → клетки */
export const cells = (m: number): number => Math.round(m / CELL_M + 1e-9);

/**
 * Метки стыковки: tag → длина проёма в клетках. Направленная метка «хозяин>гость» стыкуется
 * только с зеркальной «гость>хозяин» (tagsCompatible в model/segments.ts); простая метка
 * без «>» — только с такой же. Длина одна на пару: режим 'exact' сверяет и длину.
 * Ширины — проём в свету под типовые полотна ГОСТ 6629 (полотно + ~0.07–0.1 м коробки).
 */
export const TAG_LEN = {
  // входная дверь квартиры (полотно 0.9 → 1.0): площадка / коридор / тамбур ↔ прихожая
  'landing>apt': 10,
  'apt>landing': 10,
  // прихожая → кухня (полотно 0.7 → 0.8)
  'hall>kitchen': 8,
  'kitchen>hall': 8,
  // прихожая → ванная / совмещённый санузел (полотно 0.6 → 0.7)
  'hall>bath': 7,
  'bath>hall': 7,
  // прихожая → туалет (полотно 0.6 → 0.7)
  'hall>wc': 7,
  'wc>hall': 7,
  // прихожая → жилая комната (полотно 0.8 → 0.9)
  'hall>room': 9,
  'room>hall': 9,
  // прихожая → кладовка (полотно 0.5 → 0.6)
  'hall>closet': 6,
  'closet>hall': 6,
  // прихожая → проходной зал 1-464: двустворчатая остеклённая 2×0.6 → 1.3
  'hall>living': 13,
  'living>hall': 13,
  // проходная комната → изолированная за ней (полотно 0.8 → 0.9)
  'living>bedroom': 9,
  'bedroom>living': 9,
  // комната → балкон: балконный блок 0.7 → 0.8
  'room>balcony': 8,
  'balcony>room': 8,
  // коридор / вестибюль общежития → комнаты, общая кухня, умывальная, душевая (полотно 0.8 → 0.9)
  'corridor>dorm': 9,
  'dorm>corridor': 9,
  // коридор / холл / подвальный узел → служебное помещение (колясочная, щитовая, ЖЭК…), полотно 0.8 → 0.9
  'corridor>service': 9,
  'service>corridor': 9,
  // подвальный ход → кладовка-клетушка (решётчатая дверь 0.6 → 0.7)
  'basement>storage': 7,
  'storage>basement': 7,
  // симметричная: площадка ↔ марш ↔ площадка (марш 1.1 м)
  stair: 11,
  // симметричная: секции коридора малосемейки / тамбур / площадка (двустворчатая 1.3)
  corridor: 13,
  // симметричная: подвальные и технические ходы между собой (проход 1.0 в ходе 1.0–1.2)
  basement: 10,
  // симметричная: проходы сарая между собой (во всю ширину прохода 1.5 м)
  barn: 15,
  // симметричная: лазы снежных ходов между собой (арка 1.1 м в проёме 1.2)
  snow: 12,
  // лаз → тупиковая берлога сбоку (тот же лаз 1.2)
  'snow>den': 12,
  'den>snow': 12,
  // симметричная: проходы цехов завода между собой (во всю ширину прохода 2.0 м)
  factory: 20,
  // общага (src/data/roomsObshaga.ts): коридоры между собой — во всю ширину коридора 2.0 м
  obshaga: 20,
  // общага: затопленный подвал — ходы между собой (во всю ширину хода 1.6 м); с коридорами не стыкуются
  obshaga_bsm: 16,
  // коридор общаги → жилая комната (полотно 0.8 → 0.9; дверь-створка, закрывается сама — src/locations/obshaga.ts)
  'obshaga>room': 9,
  'room>obshaga': 9,
  // коридор общаги → общая кухня, туалет, душевая, прачечная (полотно 0.8 → 0.9)
  'obshaga>common': 9,
  'common>obshaga': 9,
  // коридор общаги → лестничная клетка сбоку (проём во всю ширину марша 2.0 м, без полотна)
  'obshaga>stairs': 20,
  'stairs>obshaga': 20,
  // вестибюль-вахта → комната вахтёра (полотно 0.8 → 0.9)
  'hall>vahter': 9,
  'vahter>hall': 9,
  // metro (src/data/roomsMetro.ts): ось зала станции — во всю ширину зала 17.6 м (пролёты стыкуются торцами)
  metro_hall: 176,
  // метро: переходы между собой (во всю ширину перехода 3.0 м)
  metro_per: 30,
  // метро: служебные ходы между собой (во всю ширину хода 1.6 м)
  metro_slu: 16,
  // метро: торец эскалаторного тоннеля ↔ зал у эскалатора (5.2 м — три дорожки с балюстрадами); направленная — два
  // тоннеля и два зала у эскалатора друг к другу не встают
  'esc>hall': 52,
  'hall>esc': 52,
  // метро: зал станции → переход (проём 3.0 м в путевой стене, через пути)
  'hall>per': 30,
  'per>hall': 30,
  // метро: переход → служебный ход (служебная дверь, полотно 0.8 → 0.9)
  'per>slu': 9,
  'slu>per': 9,
  // метро: служебный ход → служебное помещение (дежурная, щитовая, машинный зал, комната отдыха; полотно 0.8 → 0.9)
  'slu>room': 9,
  'room>slu': 9,
  // cellar (src/data/roomsCellar.ts): земляные ходы погреба между собой — во всю ширину хода 0.6 м (лицом вперёд —
  // впритирку плечами)
  cellar: 6,
  // погреб: ход → боковая клетушка через щель 0.4 м (без полотна; протиснуться только боком)
  'cellar>bin': 4,
  'bin>cellar': 4,
  // catacombs (src/data/roomsCatacombs.ts): ходы катакомб между собой — во всю ширину хода 2.0 м
  catacombs: 20,
  // катакомбы: квадратный лаз 0.8×0.8 м (только ползком) — лазы между собой и устье лаза в торце хода
  cat_duct: 8,
  // катакомбы: ход → боковая ниша-убежище (проём 0.9 м без полотна; не выросла — заложен кирпичом)
  'catacombs>refuge': 9,
  'refuge>catacombs': 9,
  // sanatorium (src/data/roomsSanatorium.ts): коридоры, галереи и хабы санатория между собой — во всю ширину коридора 3.0 м
  sanat: 30,
  // санаторий: коридор → палата / комната в ремонте (филёнчатая дверь, полотно 0.8 → 0.9; за дверью с шансом
  // tunnels.storage — комната, иначе дверь заперта)
  'sanat>room': 9,
  'room>sanat': 9,
  // санаторий: коридор → процедурная или общее помещение (водолечебница, кабинет, душ Шарко, столовая…; растёт всегда)
  'sanat>proc': 9,
  'proc>sanat': 9,
} as const;

export type ConnTag = keyof typeof TAG_LEN;

/**
 * Высота проёма по метке стыковки: tag → верх проёма в м от пола проёма; перемычка — от него до потолка комнаты.
 * Метки нет в таблице — doorHeightM. Высокие проходы метро (зал — проём на всю высоту, переходы, эскалаторы)
 * добавляются своим блоком в конец.
 */
export const TAG_OPEN_H: Record<string, number> = {
  // metro: зал — проём на всю высоту зала 4.5 (шва между пролётами не видно); переходы и проём из зала через пути —
  // 2.9; торцы эскалатора — 3.2; служебные двери — по умолчанию
  metro_hall: 4.5,
  metro_per: 2.9,
  'hall>per': 2.9,
  'per>hall': 2.9,
  'esc>hall': 3.2,
  'hall>esc': 3.2,
  // catacombs: ход — проём 2.4 (над ним перемычка до свода 3.0 или потолка 2.6 — подпружная арка на стыке кусков);
  // лаз — квадратный 0.8
  catacombs: 2.4,
  cat_duct: 0.8,
  // sanatorium: проход сети — на всю высоту коридора 3.3 (шва между кусками нет); двери палат и процедурных — по
  // умолчанию
  sanat: 3.3,
};

export const ELITE_NORMAL: RoomElite[] = [
  { tierId: 'tier_1', weight: 60 },
  { tierId: 'tier_3', weight: 25 },
  { tierId: 'tier_5', weight: 10 },
  { tierId: 'tier_8', weight: 4 },
  { tierId: 'tier_12', weight: 1 },
];

/** Содержимое спота в варианте: prop или item. */
export type Fill = { prop: string; rot?: number } | { item: string; rot?: number };
export const P = (prop: string, rot = 0): Fill => ({ prop, rot });
export const I = (item: string, rot = 0): Fill => ({ item, rot });

export interface RoomMeta {
  tags: string[];
  note: string;
  gen: RoomGen;
  unique?: boolean;
  elite?: RoomElite[];
}

interface WallOpts {
  /** координата линии стены, м (по умолчанию — край габарита) */
  at?: number;
  /** отступ от стены, м */
  off?: number;
}

/** Округление к ближайшей половине клетки. */
const half = (c: number) => Math.round(c * 2 + 1e-6) / 2;

export class RoomBuilder {
  private cellSet = new Set<CellKey>();
  private doors: Door[] = [];
  private conns: Connector[] = [];
  private decor: Decor[] = [];
  private spots: Spot[] = [];
  private groups: SpotGroup[] = [];
  private lootRows: LootRow[] = [];
  private nOpen = 0;
  /** разобранные клетки и габарит для open / wall (большие залы метро — десятки тысяч клеток): сброс в rect / cut */
  private parsed: [number, number][] | null = null;
  private box: ReturnType<typeof bbox> | null = null;

  constructor(readonly id: string, readonly name: string, private meta: RoomMeta) {}

  /** Добавить прямоугольник пола (м). */
  rect(x: number, y: number, w: number, h: number): this {
    for (let cy = cells(y); cy < cells(y + h); cy++)
      for (let cx = cells(x); cx < cells(x + w); cx++) this.cellSet.add(cellKey(cx, cy));
    this.parsed = this.box = null;
    return this;
  }

  /** Вырезать прямоугольник (вентблок, короб стояка, встроенный шкаф соседнего помещения). */
  cut(x: number, y: number, w: number, h: number): this {
    for (let cy = cells(y); cy < cells(y + h); cy++)
      for (let cx = cells(x); cx < cells(x + w); cx++) this.cellSet.delete(cellKey(cx, cy));
    this.parsed = this.box = null;
    return this;
  }

  private has(x: number, y: number) {
    return this.cellSet.has(cellKey(x, y));
  }

  /**
   * Проём с дверью и меткой стыковки.
   * side — стена; from — начало проёма вдоль стены, м (X для N/S, Y для E/W);
   * at — координата линии стены, м (нужна для внутренних стен Г-образных помещений).
   */
  open(side: Side, from: number, tag: ConnTag, name: string, at?: number): this {
    const len = TAG_LEN[tag];
    const a = cells(from);
    let cx: number, cy: number;
    const all = (this.parsed ??= [...this.cellSet].map(parseKey));
    if (side === 'N' || side === 'S') {
      cx = a;
      if (at !== undefined) cy = side === 'N' ? cells(at) : cells(at) - 1;
      else {
        const ys = all.filter(([x]) => x === a).map(([, y]) => y);
        cy = side === 'N' ? Math.min(...ys) : Math.max(...ys);
      }
    } else {
      cy = a;
      if (at !== undefined) cx = side === 'W' ? cells(at) : cells(at) - 1;
      else {
        const xs = all.filter(([, y]) => y === a).map(([x]) => x);
        cx = side === 'W' ? Math.min(...xs) : Math.max(...xs);
      }
    }
    // проверка семантики Segment
    const [dx, dy] = SIDE_DELTA[side];
    for (let i = 0; i < len; i++) {
      const x = side === 'N' || side === 'S' ? cx + i : cx;
      const y = side === 'N' || side === 'S' ? cy : cy + i;
      if (!this.has(x, y) || this.has(x + dx, y + dy))
        throw new Error(`${this.id}: проём «${name}» (${side} ${from}м) не лежит на стене`);
    }
    this.nOpen++;
    const geo = { cx, cy, side, len };
    this.doors.push({ id: `${this.id}_d${this.nOpen}`, ...geo });
    this.conns.push({ id: `${this.id}_c${this.nOpen}`, name, tag, ...geo });
    return this;
  }

  private addDecor(propId: string, x: number, y: number, rot: number) {
    if (!PROP_BY_ID[propId]) throw new Error(`${this.id}: нет prop ${propId}`);
    this.decor.push({ id: `${this.id}_f${this.decor.length + 1}`, propId, x, y, rot });
  }

  /** Декор по центру (м), с поворотом. */
  put(propId: string, x: number, y: number, rot = 0): this {
    this.addDecor(propId, half(x / CELL_M), half(y / CELL_M), rot);
    return this;
  }

  /**
   * Декор задней стороной к стене, передней гранью в комнату.
   * from — где начинается предмет вдоль стены, м (X для N/S, Y для E/W).
   */
  wall(propId: string, side: Side, from: number, opts: WallOpts = {}): this {
    const p = PROP_BY_ID[propId];
    if (!p) throw new Error(`${this.id}: нет prop ${propId}`);
    const bb = (this.box ??= bbox(this.cellSet))!;
    const off = opts.off ?? 0;
    const along = half((from + p.w / 2) / CELL_M);
    // перпендикулярная координата: округляем «от стены», чтобы не залезть в стену
    const inward = (v: number) => Math.ceil(v * 2 - 1e-6) / 2;
    const outward = (v: number) => Math.floor(v * 2 + 1e-6) / 2;
    switch (side) {
      case 'N': {
        const at = opts.at ?? bb.y0 * CELL_M;
        this.addDecor(propId, along, inward((at + off + p.h / 2) / CELL_M), 0);
        break;
      }
      case 'S': {
        const at = opts.at ?? bb.y1 * CELL_M;
        this.addDecor(propId, along, outward((at - off - p.h / 2) / CELL_M), 180);
        break;
      }
      case 'W': {
        const at = opts.at ?? bb.x0 * CELL_M;
        this.addDecor(propId, inward((at + off + p.h / 2) / CELL_M), along, 270);
        break;
      }
      case 'E': {
        const at = opts.at ?? bb.x1 * CELL_M;
        this.addDecor(propId, outward((at - off - p.h / 2) / CELL_M), along, 90);
        break;
      }
    }
    return this;
  }

  /** Спот (точка, м). group — ключ группы в этой комнате или null. */
  spot(key: string, name: string, x: number, y: number, rot = 0, group: string | null = null): this {
    this.spots.push({
      id: `${this.id}_s_${key}`,
      name,
      x: half(x / CELL_M),
      y: half(y / CELL_M),
      rot,
      groupId: group === null ? null : `${this.id}_g_${group}`,
    });
    return this;
  }

  /** Группа спотов: варианты [вес, { ключСпота: содержимое }]. */
  group(key: string, name: string, color: string, variants: Array<[number, Record<string, Fill>]>): this {
    const gid = `${this.id}_g_${key}`;
    const vs: Variant[] = variants.map(([weight, fills], i) => {
      const assign: Record<string, Assign> = {};
      for (const [sk, f] of Object.entries(fills)) {
        assign[`${this.id}_s_${sk}`] =
          'prop' in f ? { kind: 'prop', id: f.prop, rot: f.rot ?? 0 } : { kind: 'item', id: f.item, rot: f.rot ?? 0 };
      }
      return { id: `${gid}_v${i + 1}`, weight, assign };
    });
    this.groups.push({ id: gid, name, color, variants: vs });
    return this;
  }

  loot(itemId: string, chance: number, min: number, max: number): this {
    this.lootRows.push({ id: `${this.id}_l${this.lootRows.length + 1}`, itemId, chance, min, max });
    return this;
  }

  build(): Room {
    return {
      id: this.id,
      name: this.name,
      tags: [...this.meta.tags],
      unique: this.meta.unique ?? false,
      gen: { ...this.meta.gen },
      cells: new Set(this.cellSet),
      doors: this.doors.map((d) => ({ ...d })),
      connectors: this.conns.map((c) => ({ ...c })),
      decor: this.decor.map((d) => ({ ...d })),
      spots: this.spots.map((s) => ({ ...s })),
      spotGroups: this.groups.map((g) => ({ ...g, variants: g.variants.map((v) => ({ ...v, assign: { ...v.assign } })) })),
      loot: this.lootRows.map((l) => ({ ...l })),
      elite: (this.meta.elite ?? ELITE_NORMAL).map((e) => ({ ...e })),
      note: this.meta.note,
      // отделка пресетов — по правилам тегов (data/finishes.ts)
      finish: { wall: null, floor: null },
    };
  }
}

export const room = (id: string, name: string, meta: RoomMeta) => new RoomBuilder(id, name, meta);
