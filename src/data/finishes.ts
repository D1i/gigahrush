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
// набор подвала пользователя (basement-3d, tools/optimize-basement.mjs): бесшовные 512 px
import bsmBrickUrl from './assets/basement/brick_limewash.jpg?inline';
import bsmConcreteUrl from './assets/basement/concrete_dusty.jpg?inline';
import bsmPlasterUrl from './assets/basement/plaster_blue.jpg?inline';
import bsmWoodUrl from './assets/basement/wood_old.jpg?inline';
import bsmDampUrl from './assets/basement/concrete_damp.jpg?inline';
import bsmWaterUrl from './assets/basement/water.jpg?inline';
// набор сарая пользователя (barn-wall-*.png, tools/optimize-barn.mjs): бесшовные 512 px
import barnVerticalUrl from './assets/barn/planks_vertical.jpg?inline';
import barnRustUrl from './assets/barn/planks_rust.jpg?inline';
import barnHorizontalUrl from './assets/barn/planks_horizontal.jpg?inline';
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
  /** процедурная текстура: вид, размер картинки px, параметры; 'damask' — текстура пользователя; { url } — картинка */
  tex: { kind: FinishTexKind; w: number; h: number; opts?: FinishTexOpts } | 'damask' | { url: string } | null;
  dado?: { finishId: string; heightM: number };
}

// Общие текстуры двухцветных стен — те же, что у одноцветных (строка data:URI одна и та же).
const WHITEWASH = { kind: 'whitewash', w: 256, h: 256 } as const;
const PAINT_GREEN = { kind: 'paint', w: 256, h: 256, opts: { base: '#5a8463' } } as const;
const PAINT_BLUE = { kind: 'paint', w: 256, h: 256, opts: { base: '#4a6f96' } } as const;
const PAINT_PALE = { kind: 'paint', w: 256, h: 256, opts: { base: '#dfe3d6' } } as const;

/** Отделки подвала (набор пользователя). Повтор — по реальному размеру: кирпич 250×65 мм — ряд ~0.1 м в картинке
 *  из 10 рядов → 1 м; доски ~0.12 м (10 штук) → 1.2 м; бетон и вода без масштаба — 1.5 м. В биомах
 *  подвала — правила отделки биома (src/gen4d/biomes.ts): сухой — кирпич с побелкой, заброшенный — синяя
 *  штукатурка, затопленный — сырой бетон и вода на полу. */
const BASEMENT_FINISHES: FinishDef[] = [
  { id: 'f_bsm_brick', name: 'Подвал: кирпич с побелкой', surface: 'wall', color: '#a88f80', tileW: 1, tileH: 1, tags: ['подвал', 'кирпич'], tex: { url: bsmBrickUrl } },
  { id: 'f_bsm_plaster', name: 'Подвал: синяя облупленная штукатурка', surface: 'wall', color: '#4f6b80', tileW: 1, tileH: 1, tags: ['подвал', 'штукатурка'], tex: { url: bsmPlasterUrl } },
  { id: 'f_bsm_damp', name: 'Подвал: сырой бетон с плесенью', surface: 'wall', color: '#7a8270', tileW: 1.5, tileH: 1.5, tags: ['подвал', 'бетон', 'сырость'], tex: { url: bsmDampUrl } },
  { id: 'f_bsm_planks', name: 'Подвал: дощатая перегородка', surface: 'wall', color: '#6f6150', tileW: 1.2, tileH: 1.2, tags: ['подвал', 'доски'], tex: { url: bsmWoodUrl } },
  { id: 'f_bsm_concrete', name: 'Подвал: пыльный бетон (пол)', surface: 'floor', color: '#8c867c', tileW: 1.5, tileH: 1.5, tags: ['подвал', 'бетон'], tex: { url: bsmConcreteUrl } },
  { id: 'f_bsm_boards', name: 'Подвал: старые доски (пол)', surface: 'floor', color: '#6f6150', tileW: 1.2, tileH: 1.2, tags: ['подвал', 'доски'], tex: { url: bsmWoodUrl } },
  { id: 'f_bsm_damp_floor', name: 'Подвал: сырой бетон (пол)', surface: 'floor', color: '#737a68', tileW: 1.5, tileH: 1.5, tags: ['подвал', 'бетон', 'сырость'], tex: { url: bsmDampUrl } },
  { id: 'f_bsm_water', name: 'Подвал: вода по щиколотку (пол)', surface: 'floor', color: '#4a4a2a', tileW: 1.5, tileH: 1.5, tags: ['подвал', 'вода'], tex: { url: bsmWaterUrl } },
];

/** Отделки сарая (набор пользователя): в плитке ~8 досок по 0.18 м → повтор 1.5 м. Стены — вертикальная серая доска,
 *  выцветшая с ржавыми подтёками от гвоздей, горизонтальная тёмная; пол — те же доски. В биоме «Сарай» — свои правила
 *  отделки (src/gen4d/biomes.ts). */
const BARN_FINISHES: FinishDef[] = [
  { id: 'f_barn_vertical', name: 'Сарай: вертикальные серые доски', surface: 'wall', color: '#6e6255', tileW: 1.5, tileH: 1.5, tags: ['сарай', 'доски'], tex: { url: barnVerticalUrl } },
  { id: 'f_barn_rust', name: 'Сарай: выцветшие доски, ржавые гвозди', surface: 'wall', color: '#6f675d', tileW: 1.5, tileH: 1.5, tags: ['сарай', 'доски'], tex: { url: barnRustUrl } },
  { id: 'f_barn_horizontal', name: 'Сарай: горизонтальные тёмные доски', surface: 'wall', color: '#4a3a2c', tileW: 1.5, tileH: 1.5, tags: ['сарай', 'доски'], tex: { url: barnHorizontalUrl } },
  { id: 'f_barn_floor', name: 'Сарай: тёмные половые доски (пол)', surface: 'floor', color: '#4a3a2c', tileW: 1.5, tileH: 1.5, tags: ['сарай', 'доски'], tex: { url: barnHorizontalUrl } },
  { id: 'f_barn_floor_grey', name: 'Сарай: серые трухлявые доски (пол)', surface: 'floor', color: '#6f675d', tileW: 1.5, tileH: 1.5, tags: ['сарай', 'доски'], tex: { url: barnRustUrl } },
  // снежные ходы (src/data/roomsSnow.ts): в «Прогулке» стен нет — оболочка снега (src/view3d/snowMesh.ts); отделка — для
  // болванки и движка без полости
  { id: 'f_snow', name: 'Снег: утрамбованные стены лаза', surface: 'wall', color: '#dfe6ef', tileW: 0.8, tileH: 0.8, tags: ['снег'], tex: WHITEWASH },
  { id: 'f_snow_floor', name: 'Снег: пол лаза (пол)', surface: 'floor', color: '#d6dde8', tileW: 0.8, tileH: 0.8, tags: ['снег'], tex: WHITEWASH },
];

/** Отделки общаги (src/data/roomsObshaga.ts): коридоры — бежевый кафель 15×15 с тёмно-зелёным нижним рядом и
 *  светло-зелёным бордюром в полплитки до 1.425 м (9.5 рядов), выше побелка; комнаты — масляная краска (бежевая,
 *  серо-зелёная); пол — коричневый крапчатый линолеум. В биоме «Общага» — свои правила по тегу помещения
 *  (src/gen4d/biomes.ts), у проекта — правила тегов, которых нет у других групп (комната, вахта, туалет, душ…). */
const OBSHAGA_FINISHES: FinishDef[] = [
  {
    id: 'f_obsh_tile_panel', name: 'Общага: кафельная панель 1.425 м (бежевый, зелёный ряд и бордюр)', surface: 'wall', color: '#d4c39c',
    tileW: 0.6, tileH: 1.425, tags: ['кафель', 'общага'],
    tex: { kind: 'tile_panel', w: 256, h: 608, opts: { base: '#d9c7a0', accent: '#8e8a7c', low: '#5e8a6e', high: '#7fa37a', n: 4 } },
  },
  {
    id: 'f_obsh_corridor', name: 'Общага: кафель до 1.4 м + побелка', surface: 'wall', color: '#d8d0b5', tileW: 1, tileH: 1,
    tags: ['общага', 'двухцветная'], tex: { kind: 'whitewash', w: 256, h: 256, opts: { base: '#d8d0b5' } }, dado: { finishId: 'f_obsh_tile_panel', heightM: 1.425 },
  },
  { id: 'f_obsh_paint_beige', name: 'Общага: масляная краска бежевая', surface: 'wall', color: '#cfc3a0', tileW: 1, tileH: 1, tags: ['краска', 'общага'], tex: { kind: 'paint', w: 256, h: 256, opts: { base: '#cfc3a0' } } },
  { id: 'f_obsh_paint_green', name: 'Общага: масляная краска серо-зелёная', surface: 'wall', color: '#a9b79a', tileW: 1, tileH: 1, tags: ['краска', 'общага'], tex: { kind: 'paint', w: 256, h: 256, opts: { base: '#a9b79a' } } },
  { id: 'f_obsh_lino_brown', name: 'Общага: линолеум коричневый крапчатый', surface: 'floor', color: '#6e3f2e', tileW: 1, tileH: 1, tags: ['линолеум', 'общага'], tex: { kind: 'lino_speckle', w: 256, h: 256, opts: { base: '#6e3f2e' } } },
];

// metro
/** Отделки метро (src/data/roomsMetro.ts): залы — белый мрамор с серыми прожилками (плиты 0.6 м, повтор 1.2 м; пилоны
 *  — тем же: у комнаты одна отделка стен), вестибюли и эскалаторы — серо-зелёный мрамор; пол — бежевый гранит с
 *  красно-серым узором (плитка 0.6 м, швы-полосы серого гранита, в узлах красные и серые ромбы; повтор 1.2 м — длиннее
 *  не даёт предел повтора 1.5 м); переходы — кремовый кафель 15×15 с гранитным цоколем 0.3 м (панель 1.5 м, выше тот же
 *  кафель — ряды сходятся); служебные — зелёная масляная краска над той же панелью; сгоревший зал — мрамор и гранит в
 *  копоти и пепле. В биоме «Метро» — свои правила по тегу помещения (src/gen4d/biomes.ts), у проекта — правила тегов,
 *  которых нет у других групп (зал, переход, эскалатор). */
const METRO_FINISHES: FinishDef[] = [
  { id: 'f_metro_marble', name: 'Метро: белый мрамор с серыми прожилками', surface: 'wall', color: '#e2e0da', tileW: 1.2, tileH: 1.2, tags: ['мрамор', 'метро'], tex: { kind: 'marble', w: 512, h: 512, opts: { base: '#e8e6e0', accent: '#868b91', n: 2 } } },
  { id: 'f_metro_marble_dark', name: 'Метро: серо-зелёный мрамор', surface: 'wall', color: '#617066', tileW: 1.2, tileH: 1.2, tags: ['мрамор', 'метро'], tex: { kind: 'marble', w: 512, h: 512, opts: { base: '#5f6f66', accent: '#d3dad0', n: 2 } } },
  { id: 'f_metro_granite', name: 'Метро: гранитный пол — бежевый, красно-серые ромбы и полосы', surface: 'floor', color: '#bba98e', tileW: 1.2, tileH: 1.2, tags: ['гранит', 'метро'], tex: { kind: 'granite_floor', w: 512, h: 512, opts: { base: '#c9b89d', accent: '#a23b2f', low: '#5d6064', n: 2 } } },
  {
    id: 'f_metro_tile_panel', name: 'Метро: кремовый кафель 15×15 с гранитным цоколем, панель 1.5 м', surface: 'wall', color: '#d9cbb0',
    tileW: 0.6, tileH: 1.5, tags: ['кафель', 'метро'], tex: { kind: 'tile_plinth', w: 384, h: 960, opts: { base: '#ead9b7', accent: '#a89e8a', low: '#45413e', n: 4 } },
  },
  {
    id: 'f_metro_tile', name: 'Метро: кремовый кафель с гранитным цоколем (переходы)', surface: 'wall', color: '#e6d6b6', tileW: 0.6, tileH: 0.6,
    tags: ['кафель', 'метро', 'двухцветная'], tex: { kind: 'tile', w: 384, h: 384, opts: { base: '#ead9b7', accent: '#a89e8a', n: 4 } }, dado: { finishId: 'f_metro_tile_panel', heightM: 1.5 },
  },
  {
    id: 'f_metro_slu', name: 'Метро: зелёная масляная краска над кафелем (служебные)', surface: 'wall', color: '#5c7c64', tileW: 1, tileH: 1,
    tags: ['краска', 'метро', 'двухцветная'], tex: { kind: 'paint', w: 256, h: 256, opts: { base: '#5a7b63' } }, dado: { finishId: 'f_metro_tile_panel', heightM: 1.5 },
  },
  { id: 'f_metro_soot', name: 'Метро: мрамор в копоти (сгоревший зал)', surface: 'wall', color: '#4a4643', tileW: 1.2, tileH: 1.2, tags: ['мрамор', 'копоть', 'метро'], tex: { kind: 'soot', w: 512, h: 512, opts: { base: '#d9d6cf', accent: '#1b1918', n: 2 } } },
  { id: 'f_metro_soot_floor', name: 'Метро: гранитный пол в пепле и копоти', surface: 'floor', color: '#6b6258', tileW: 1.2, tileH: 1.2, tags: ['гранит', 'копоть', 'метро'], tex: { kind: 'soot_floor', w: 512, h: 512, opts: { base: '#c2b196', accent: '#1b1918', low: '#5d6064', n: 2 } } },
];

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
  ...BASEMENT_FINISHES,
  ...BARN_FINISHES,
  ...OBSHAGA_FINISHES,
  // metro
  ...METRO_FINISHES,
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
  // сарай — доски набора пользователя (в биоме «Сарай» — свои правила поверх этих)
  ['сарай', [['f_barn_vertical', 5], ['f_barn_rust', 3], ['f_barn_horizontal', 2]], [['f_barn_floor', 3], ['f_barn_floor_grey', 2]]],
  // снежные ходы — снег (в «Прогулке» вместо стен — оболочка снега)
  ['снег', [['f_snow', 1]], [['f_snow_floor', 1]]],
  // завод — по ступени влажности (тег после 'завод' и 'ход' / 'хаб'; правила 'завод' нет — иначе оно бы победило):
  // кирпич с побелкой и пыльный бетон → сырой бетон → вода по полу (текстуры набора пользователя, как у подвала)
  ['сухо', [['f_bsm_brick', 4], ['f_concrete', 1]], [['f_bsm_concrete', 1]]],
  ['сыро', [['f_bsm_brick', 3], ['f_bsm_damp', 2]], [['f_bsm_concrete', 2], ['f_bsm_damp_floor', 1]]],
  ['течь', [['f_bsm_damp', 4], ['f_bsm_brick', 1]], [['f_bsm_damp_floor', 3], ['f_bsm_water', 1]]],
  ['топь', [['f_bsm_damp', 1]], [['f_bsm_water', 3], ['f_bsm_damp_floor', 1]]],
  // общага — по тегу помещения (тег после 'общага'; правила 'общага' нет — иначе оно бы победило): здесь — теги, которых
  // нет у других групп; коридор, кухня, лестница, подвал общаги в биоме «Общага» — по правилам биома (biomes.ts)
  ['комната', [['f_obsh_paint_beige', 3], ['f_obsh_paint_green', 2], ['f_wp_rogozhka', 1]], [['f_obsh_lino_brown', 3], ['f_boards', 2], ['f_lino_gray', 1]]],
  ['вахта', [['f_obsh_corridor', 3], ['f_two_entrance', 1]], [['f_metlakh', 3], ['f_obsh_lino_brown', 1]]],
  ['вахтёрская', [['f_obsh_paint_green', 2], ['f_obsh_paint_beige', 1]], [['f_obsh_lino_brown', 1]]],
  ['туалет', [['f_two_bath', 1]], [['f_metlakh', 1]]],
  ['душ', [['f_tile_white', 2], ['f_tile_blue', 1]], [['f_tile_floor', 2], ['f_metlakh', 1]]],
  ['прачечная', [['f_two_bath', 2], ['f_obsh_paint_green', 1]], [['f_metlakh', 2], ['f_tile_floor', 1]]],
  // metro — по тегу помещения (правила 'метро' нет — иначе оно бы победило): теги, которых нет у других групп;
  // вестибюль, служебные, сгоревший зал в биоме «Метро» — по правилам биома (biomes.ts)
  ['зал', [['f_metro_marble', 1]], [['f_metro_granite', 1]]],
  ['переход', [['f_metro_tile', 1]], [['f_metro_granite', 1]]],
  ['эскалатор', [['f_metro_marble_dark', 1]], [['f_metro_granite', 1]]],
];

function texOf(d: FinishDef): string | null {
  if (d.tex === 'damask') return DAMASK.url || null;
  if (!d.tex) return null;
  if ('url' in d.tex) return d.tex.url || null;
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
