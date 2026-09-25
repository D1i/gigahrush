// Модель данных Room Forge (ТЗ §4). Внутреннее представление в памяти.
// Внешний формат (JSON) — см. serialize.ts: там cells сжимаются в строки "y:x1-x2,x3".
//
// Соглашения:
//  • Единица длины — клетка (settings.cellM = 0.1 м). Ось Y направлена вниз.
//  • Стороны: N — вверх (y-1), S — вниз (y+1), E — вправо (x+1), W — влево (x-1).
//  • Клетка (x,y) — квадрат [x, x+1] × [y, y+1] в клеточных координатах.
//  • Позиции декора и спотов (x, y) — точки в клеточных координатах, допускаются
//    половинные значения (центр клетки (3,4) — точка (3.5, 4.5)).
//  • Поворот rot — градусы по часовой стрелке (при оси Y вниз это визуально по часовой).
//  • Габариты декора w (вдоль X при rot=0) и h (вдоль Y при rot=0) — в метрах.
//    «Передняя» грань декора при rot=0 — нижняя (сторона S).

export type Side = 'N' | 'S' | 'E' | 'W';

/** Ключ клетки "x,y". */
export type CellKey = string;

export interface Settings {
  cellM: number;
}

export interface Prop {
  id: string;
  name: string;
  /** ширина, м (по X при rot=0) */
  w: number;
  /** глубина, м (по Y при rot=0) */
  h: number;
  color: string;
  /** PNG data:URI вида сверху, длинная сторона ≤ 512 px, либо null */
  tex: string | null;
  tags: string[];
}

export interface Item {
  id: string;
  name: string;
  color: string;
  tags: string[];
  note: string;
}

export interface RoomGen {
  /** вес выбора комнаты генератором */
  weight: number;
  /** минимум копий в прогоне */
  min: number;
  /** максимум копий в прогоне (unique ⇒ фактически 1) */
  max: number;
}

/**
 * Отрезок на границе комнаты.
 * (cx, cy) — первая клетка комнаты, прилегающая к отрезку; side — сторона этой клетки,
 * на которой лежит отрезок; len — длина в клетках.
 * Для side N/S отрезок идёт вдоль +X: клетки (cx..cx+len-1, cy).
 * Для side E/W отрезок идёт вдоль +Y: клетки (cx, cy..cy+len-1).
 * Корректный отрезок: все его клетки принадлежат комнате, а соседние клетки
 * в направлении side — нет.
 */
export interface Segment {
  id: string;
  cx: number;
  cy: number;
  side: Side;
  len: number;
}

export type Door = Segment;

export interface Connector extends Segment {
  name: string;
  /** текстовая метка стыковки */
  tag: string;
}

export interface Decor {
  id: string;
  propId: string;
  x: number;
  y: number;
  rot: number;
}

export interface Spot {
  id: string;
  name: string;
  x: number;
  y: number;
  rot: number;
  /** null — спот без группы, в генерации не участвует */
  groupId: string | null;
}

export type AssignKind = 'prop' | 'item';

export interface Assign {
  kind: AssignKind;
  id: string;
  /** дополнительный поворот содержимого относительно спота, градусы */
  rot: number;
}

export interface Variant {
  id: string;
  weight: number;
  /** spotId → содержимое. Отсутствие ключа = спот пуст. Пустой объект = весь вариант пуст. */
  assign: Record<string, Assign>;
}

export interface SpotGroup {
  id: string;
  name: string;
  color: string;
  variants: Variant[];
}

export interface LootRow {
  id: string;
  itemId: string;
  /** 0..1 */
  chance: number;
  min: number;
  max: number;
}

/** Вес элитности для комнаты: какой тир может выпасть при заходе в эту комнату. */
export interface RoomElite {
  tierId: string;
  weight: number;
}

export interface Room {
  id: string;
  name: string;
  tags: string[];
  unique: boolean;
  gen: RoomGen;
  /** В памяти — Set ключей "x,y". */
  cells: Set<CellKey>;
  doors: Door[];
  connectors: Connector[];
  decor: Decor[];
  spots: Spot[];
  spotGroups: SpotGroup[];
  loot: LootRow[];
  /**
   * Расширение под игровую экономику: розыгрыш элитности при заходе.
   * Пустой массив — комната всегда базовая (без тира).
   */
  elite: RoomElite[];
  /** Заметка автора (тип квартиры, серия дома и т.п.) */
  note: string;
}

export type MatchMode =
  /** стыкуются метки с одинаковым tag и одинаковой длиной */
  | 'exact'
  /** одинаковый tag, длина может отличаться (центры совмещаются) */
  | 'tag'
  /** любые метки одинаковой длины */
  | 'len';

export interface GeneratorSettings {
  seed: string;
  /** целевое число экземпляров комнат */
  count: number;
  /** зазор между комнатами в клетках (толщина стены), обычно 1 */
  gap: number;
  match: MatchMode;
  /** id комнаты-старта; null — стартовая выбирается по тегу "start", иначе по весу */
  startRoomId: string | null;
  /** активная проходка (Economy.passes) или null */
  passId: string | null;
}

// ───────────────────────── Экономика (расширение ТЗ по переписке) ─────────────────────────
//
// Валюты — обычные предметы (Item) с тегом "currency". Каждая валюта кормит свою ветку закупки
// (магазин). Элитность комнаты разыгрывается при заходе и определяет тир лута, наличие готовых
// предметов и прирост опасности. Проходка (за самогонку) повышает шанс элитных тиров и спавн
// конкретного компонента.

/** Ступень «до N с шансом P». Ступени проверяются от большей upTo к меньшей;
 *  первая сработавшая задаёт количество: случайное целое в [1, upTo]. */
export interface LootStep {
  upTo: number;
  chance: number;
}

export type TierLootSource =
  | { kind: 'item'; id: string }
  /** случайный товар из магазина (готовый предмет) */
  | { kind: 'shop'; id: string };

export interface TierLootRow {
  id: string;
  source: TierLootSource;
  steps: LootStep[];
  /** тег декора, в котором лежит находка (напр. "сервант"). Пусто — без привязки.
   *  Если в комнате нет декора с таким тегом, строка не разыгрывается. */
  where: string;
}

export interface Tier {
  id: string;
  name: string;
  /** уровень элитности, 1..N */
  level: number;
  /** на сколько растёт опасность уровня после прохода через комнату этого тира */
  danger: number;
  color: string;
  note: string;
  loot: TierLootRow[];
}

export interface ShopOffer {
  id: string;
  itemId: string;
  price: number;
}

export interface Shop {
  id: string;
  name: string;
  /** валюта магазина — id предмета с тегом currency */
  currencyItemId: string;
  offers: ShopOffer[];
  note: string;
}

export interface Pass {
  id: string;
  name: string;
  /** чем платим (обычно самогонка) */
  priceItemId: string;
  price: number;
  /** множитель весов тиров с level ≥ 2 */
  tierBoost: number;
  /** множитель шансов для конкретного предмета (itemId → mult) */
  itemBoost: Record<string, number>;
  note: string;
}

export interface Economy {
  tiers: Tier[];
  shops: Shop[];
  passes: Pass[];
  /** Порог опасности, после которого уровень считается «горящим» — понятное игроку правило */
  dangerLimit: number;
}

export interface Project {
  settings: Settings;
  props: Prop[];
  items: Item[];
  rooms: Room[];
  generator: GeneratorSettings;
  economy: Economy;
}

// ───────────────────────── Прогон (результат генерации) ─────────────────────────

export type Rot = 0 | 90 | 180 | 270;

export interface Instance {
  /** id экземпляра, уникален в прогоне: "i0", "i1", … */
  id: string;
  roomId: string;
  rot: Rot;
  /** смещение в клетках, применяется после поворота */
  dx: number;
  dy: number;
  /** шаг роста (0 — стартовая) */
  order: number;
  /** экземпляр-родитель, через который пришли (null у стартовой) */
  parent: string | null;
  /** глубина по графу от старта */
  depth: number;
}

export interface Link {
  a: { inst: string; connector: string };
  b: { inst: string; connector: string };
}

export interface SpawnedSpot {
  spotId: string;
  /** мировые координаты, клетки */
  x: number;
  y: number;
  rot: number;
  groupId: string;
  variantId: string;
  content: Assign | null;
}

export interface SpawnedLoot {
  itemId: string;
  count: number;
  /** источник: строка лута комнаты или строка тира */
  from: 'room' | 'tier';
  rowId: string;
  /** для строк тира с where — id экземпляра декора (в комнате), куда положено */
  decorId?: string;
  /** для shop-строк — id магазина */
  shopId?: string;
}

export interface InstanceContent {
  inst: string;
  /** id тира или null (базовая комната) */
  tierId: string | null;
  /** прирост опасности за проход */
  danger: number;
  /** накопленная опасность по пути от старта (включая эту комнату) */
  dangerAcc: number;
  groups: { groupId: string; variantId: string }[];
  spots: SpawnedSpot[];
  loot: SpawnedLoot[];
}

export interface Run {
  seed: string;
  settings: GeneratorSettings;
  instances: Instance[];
  links: Link[];
  /** незадействованные метки: тупики */
  openConnectors: { inst: string; connector: string }[];
  content: InstanceContent[];
  /** сводка: itemId → суммарное количество по прогону */
  totals: Record<string, number>;
  /** предупреждения генератора (не выполнен min, не хватило места и т.п.) */
  warnings: string[];
  /** время генерации, мс */
  ms: number;
}

// ───────────────────────── Состояние интерфейса (не сериализуется) ─────────────────────────

export type Tool =
  | 'select'
  | 'rect'
  | 'ellipse'
  | 'brush'
  | 'door'
  | 'connector'
  | 'decor'
  | 'spot';

export type LayerKey = 'grid' | 'doors' | 'connectors' | 'decor' | 'spots';

export type Selection =
  | { kind: 'decor' | 'spot' | 'door' | 'connector'; id: string }
  | null;

export type Page = 'editor' | 'library' | 'economy' | 'generator' | 'data';
