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
} as const;

export type ConnTag = keyof typeof TAG_LEN;

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

  constructor(readonly id: string, readonly name: string, private meta: RoomMeta) {}

  /** Добавить прямоугольник пола (м). */
  rect(x: number, y: number, w: number, h: number): this {
    for (let cy = cells(y); cy < cells(y + h); cy++)
      for (let cx = cells(x); cx < cells(x + w); cx++) this.cellSet.add(cellKey(cx, cy));
    return this;
  }

  /** Вырезать прямоугольник (вентблок, короб стояка, встроенный шкаф соседнего помещения). */
  cut(x: number, y: number, w: number, h: number): this {
    for (let cy = cells(y); cy < cells(y + h); cy++)
      for (let cx = cells(x); cx < cells(x + w); cx++) this.cellSet.delete(cellKey(cx, cy));
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
    const all = [...this.cellSet].map(parseKey);
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
    const bb = bbox(this.cellSet)!;
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
