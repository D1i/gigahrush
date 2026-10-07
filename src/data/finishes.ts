// Отделка советского быта: обои, кафель, масляная краска, побелка, бетон, кирпич, ДВП; полы — линолеум,
// паркет, метлахская плитка, крашеная доска. Плюс правила по первому тегу комнаты (группа спавна):
// у жилых — разные обои (разыгрываются по весам, у разных квартир разные), санузел — кафель до 1.5 м,
// подъезд — зелёная масляная панель до 1.5 м и побелка выше, подвал — бетон и кирпич.
//
// tileW × tileH — реальный размер одного повтора текстуры, м: рулон обоев 0.53 м, кафель 15×15 см
// (в текстуре 4×4 плитки — повтор 0.6 м), кирпич 250×65 + шов 10 мм, ёлочка из планок 6×30 см.
// Пропорции картинки совпадают с tileW:tileH.
import type { Finish, FinishRule, FinishSurface } from '../model/types';
import damaskUrl from './assets/wallpaper-damask.jpg?inline';
import { makeFinishTexture, type FinishTexKind, type FinishTexOpts } from './finishTextures';

/** Текстура пользователя: зелёные обои «Дамаск» (фото → бесшовная плитка, см. tools/make-seamless.html).
 *  В плитке 4 × 3 раппорта; вертикальный раппорт мотива — 0.20 м. */
const DAMASK = { url: damaskUrl as string, tileW: 0.6215, tileH: 0.6, color: '#798654' };

interface FinishDef {
  id: string;
  name: string;
  surface: FinishSurface;
  color: string;
  tileW: number;
  tileH: number;
  tags: string[];
  /** процедурная текстура: вид, размер картинки px, параметры; 'damask' — текстура пользователя */
  tex: { kind: FinishTexKind; w: number; h: number; opts?: FinishTexOpts } | 'damask' | null;
  dado?: { finishId: string; heightM: number };
}

// Общие текстуры двухцветных стен — те же, что у одноцветных (строка data:URI одна и та же).
const WHITEWASH = { kind: 'whitewash', w: 256, h: 256 } as const;
const PAINT_GREEN = { kind: 'paint', w: 256, h: 256, opts: { base: '#5a8463' } } as const;
const PAINT_BLUE = { kind: 'paint', w: 256, h: 256, opts: { base: '#4a6f96' } } as const;
const PAINT_PALE = { kind: 'paint', w: 256, h: 256, opts: { base: '#dfe3d6' } } as const;

export const FINISH_DEFS: FinishDef[] = [
  // ── Стены: обои ──
  { id: 'f_wp_damask', name: 'Обои «Дамаск», зелёные', surface: 'wall', color: DAMASK.color, tileW: DAMASK.tileW, tileH: DAMASK.tileH, tags: ['обои', 'жилая'], tex: 'damask' },
  { id: 'f_wp_stripe', name: 'Обои в полоску, бежевые', surface: 'wall', color: '#d5c5a0', tileW: 0.53, tileH: 0.53, tags: ['обои'], tex: { kind: 'stripe', w: 384, h: 384 } },
  { id: 'f_wp_flower', name: 'Обои «цветочек», розоватые', surface: 'wall', color: '#e4ccc1', tileW: 0.53, tileH: 0.53, tags: ['обои'], tex: { kind: 'flower', w: 384, h: 384 } },
  { id: 'f_wp_rhomb', name: 'Обои «ромбик», голубые', surface: 'wall', color: '#acc2d2', tileW: 0.5, tileH: 0.5, tags: ['обои'], tex: { kind: 'rhomb', w: 384, h: 384 } },
  { id: 'f_wp_rogozhka', name: 'Обои-рогожка, серые', surface: 'wall', color: '#aaa69b', tileW: 0.5, tileH: 0.5, tags: ['обои'], tex: { kind: 'rogozhka', w: 384, h: 384 } },
  // ── Стены: кафель, краска, побелка ──
  { id: 'f_tile_white', name: 'Кафель белый 15×15', surface: 'wall', color: '#e7eae3', tileW: 0.6, tileH: 0.6, tags: ['кафель', 'санузел'], tex: { kind: 'tile', w: 384, h: 384, opts: { base: '#eef0ea', accent: '#bfc3bb', n: 4 } } },
  { id: 'f_tile_blue', name: 'Кафель голубой 15×15', surface: 'wall', color: '#96bacf', tileW: 0.6, tileH: 0.6, tags: ['кафель', 'санузел'], tex: { kind: 'tile', w: 384, h: 384, opts: { base: '#8fb8cf', accent: '#dde4e4', n: 4 } } },
  { id: 'f_paint_green', name: 'Краска масляная зелёная (подъезд)', surface: 'wall', color: '#5b8362', tileW: 1, tileH: 1, tags: ['краска', 'подъезд'], tex: PAINT_GREEN },
  { id: 'f_paint_blue', name: 'Краска масляная синяя', surface: 'wall', color: '#4a6f95', tileW: 1, tileH: 1, tags: ['краска'], tex: PAINT_BLUE },
  { id: 'f_whitewash', name: 'Побелка', surface: 'wall', color: '#e5e3d7', tileW: 1, tileH: 1, tags: ['побелка'], tex: WHITEWASH },
  { id: 'f_plaster', name: 'Штукатурка серая', surface: 'wall', color: '#a39f93', tileW: 1, tileH: 1, tags: ['штукатурка'], tex: { kind: 'plaster', w: 256, h: 256 } },
  { id: 'f_concrete', name: 'Бетон', surface: 'wall', color: '#8e8b84', tileW: 1.2, tileH: 1.2, tags: ['бетон', 'подвал'], tex: { kind: 'concrete', w: 256, h: 256 } },
  { id: 'f_brick', name: 'Кирпич красный', surface: 'wall', color: '#985d47', tileW: 0.52, tileH: 0.6, tags: ['кирпич', 'подвал', 'балкон'], tex: { kind: 'brick', w: 312, h: 360 } },
  { id: 'f_dvp', name: 'Панели ДВП «под дерево»', surface: 'wall', color: '#825533', tileW: 0.8, tileH: 0.8, tags: ['панели', 'прихожая'], tex: { kind: 'dvp', w: 384, h: 384 } },
  // ── Стены: двухцветные (нижняя панель — dado) ──
  {
    id: 'f_two_entrance', name: 'Подъезд: зелёная панель 1.5 м + побелка', surface: 'wall', color: '#e5e3d7', tileW: 1, tileH: 1,
    tags: ['подъезд', 'двухцветная'], tex: WHITEWASH, dado: { finishId: 'f_paint_green', heightM: 1.5 },
  },
  {
    id: 'f_two_bath', name: 'Санузел: кафель 1.5 м + краска', surface: 'wall', color: '#e1e5d7', tileW: 1, tileH: 1,
    tags: ['санузел', 'двухцветная'], tex: PAINT_PALE, dado: { finishId: 'f_tile_white', heightM: 1.5 },
  },
  {
    id: 'f_two_kitchen', name: 'Кухня: масляная краска 1.2 м + побелка', surface: 'wall', color: '#e5e3d7', tileW: 1, tileH: 1,
    tags: ['кухня', 'двухцветная'], tex: WHITEWASH, dado: { finishId: 'f_paint_blue', heightM: 1.2 },
  },
  // ── Полы ──
  { id: 'f_lino_parquet', name: 'Линолеум «под паркет»', surface: 'floor', color: '#9e7247', tileW: 0.6, tileH: 0.6, tags: ['линолеум'], tex: { kind: 'lino_parquet', w: 384, h: 384 } },
  { id: 'f_lino_gray', name: 'Линолеум серый', surface: 'floor', color: '#90928f', tileW: 1, tileH: 1, tags: ['линолеум'], tex: { kind: 'lino_speckle', w: 256, h: 256 } },
  { id: 'f_parquet', name: 'Паркет ёлочкой', surface: 'floor', color: '#a77c4a', tileW: 0.6, tileH: 0.6, tags: ['паркет', 'жилая'], tex: { kind: 'herringbone', w: 400, h: 400 } },
  { id: 'f_metlakh', name: 'Метлахская плитка', surface: 'floor', color: '#b4926d', tileW: 0.4, tileH: 0.4, tags: ['плитка', 'подъезд', 'санузел'], tex: { kind: 'metlakh', w: 384, h: 384 } },
  { id: 'f_concrete_floor', name: 'Бетон (пол)', surface: 'floor', color: '#807d76', tileW: 1.2, tileH: 1.2, tags: ['бетон', 'подвал'], tex: { kind: 'concrete', w: 256, h: 256, opts: { base: '#7f7c76', cracks: true } } },
  { id: 'f_boards', name: 'Крашеная доска (сурик)', surface: 'floor', color: '#873f2b', tileW: 1.2, tileH: 0.6, tags: ['доска'], tex: { kind: 'boards', w: 512, h: 256 } },
  { id: 'f_tile_floor', name: 'Кафель (пол) 20×20', surface: 'floor', color: '#b2aa99', tileW: 0.6, tileH: 0.6, tags: ['кафель', 'санузел'], tex: { kind: 'tile_floor', w: 384, h: 384, opts: { base: '#b7ae9c', accent: '#6f685d', n: 3 } } },
];

/** Правила по тегу (первому тегу комнаты из групп спавна): варианты стен и пола с весами. */
const RULES: [string, [string, number][], [string, number][]][] = [
  // жилые: 5 обоев, дамаск — самый частый; пол — линолеум, паркет, доска
  ['жилая', [['f_wp_damask', 5], ['f_wp_stripe', 3], ['f_wp_flower', 3], ['f_wp_rhomb', 2], ['f_wp_rogozhka', 2]], [['f_lino_parquet', 4], ['f_parquet', 3], ['f_boards', 2]]],
  ['прихожая', [['f_wp_rogozhka', 3], ['f_dvp', 3], ['f_wp_damask', 2], ['f_wp_stripe', 2]], [['f_lino_parquet', 3], ['f_lino_gray', 3], ['f_boards', 1]]],
  ['кухня', [['f_two_kitchen', 5], ['f_wp_rhomb', 2], ['f_wp_stripe', 1]], [['f_lino_gray', 3], ['f_lino_parquet', 2], ['f_metlakh', 2]]],
  ['санузел', [['f_two_bath', 5], ['f_tile_blue', 2], ['f_paint_blue', 1]], [['f_metlakh', 4], ['f_tile_floor', 3]]],
  ['лестница', [['f_two_entrance', 6], ['f_plaster', 1]], [['f_concrete_floor', 4], ['f_metlakh', 3]]],
  ['коридор', [['f_two_entrance', 5], ['f_paint_blue', 2], ['f_plaster', 1]], [['f_metlakh', 3], ['f_lino_gray', 2], ['f_concrete_floor', 2]]],
  ['лифт', [['f_two_entrance', 4], ['f_paint_green', 2]], [['f_metlakh', 3], ['f_concrete_floor', 2]]],
  ['подвал', [['f_concrete', 4], ['f_brick', 3], ['f_whitewash', 1]], [['f_concrete_floor', 1]]],
  ['служебное', [['f_plaster', 3], ['f_paint_green', 2], ['f_whitewash', 2], ['f_concrete', 1]], [['f_concrete_floor', 2], ['f_metlakh', 2], ['f_lino_gray', 1]]],
  // общежитие — одно правило на все его помещения (первый тег), поэтому «казённые» панели и линолеум
  ['общежитие', [['f_two_entrance', 3], ['f_two_kitchen', 2], ['f_wp_rogozhka', 1], ['f_wp_stripe', 1]], [['f_lino_gray', 3], ['f_metlakh', 2], ['f_boards', 1]]],
  ['балкон', [['f_brick', 4], ['f_concrete', 2], ['f_plaster', 1]], [['f_concrete_floor', 1]]],
  // кладовка — и в квартире, и клетушка в подвале
  ['кладовка', [['f_whitewash', 5], ['f_plaster', 2], ['f_dvp', 1]], [['f_boards', 3], ['f_concrete_floor', 2], ['f_lino_gray', 1]]],
];

function texOf(d: FinishDef): string | null {
  if (d.tex === 'damask') return DAMASK.url || null;
  if (!d.tex) return null;
  return makeFinishTexture(d.tex.kind, d.tex.w, d.tex.h, d.tex.opts ?? {});
}

/** Отделки для проекта; процедурные текстуры рисуются, если есть document (дамаск — всегда). */
export function buildFinishes(): Finish[] {
  return FINISH_DEFS.map((d) => ({
    id: d.id,
    name: d.name,
    surface: d.surface,
    color: d.color,
    tex: texOf(d),
    tileW: d.tileW,
    tileH: d.tileH,
    dado: d.dado ? { ...d.dado } : null,
    tags: [...d.tags],
  }));
}

export function buildFinishRules(): FinishRule[] {
  return RULES.map(([tag, wall, floor]) => ({
    tag,
    wall: wall.map(([finishId, weight]) => ({ finishId, weight })),
    floor: floor.map(([finishId, weight]) => ({ finishId, weight })),
  }));
}

/** Для галереи tools/make-seamless.html?gallery. */
export const finishGallery = buildFinishes;
