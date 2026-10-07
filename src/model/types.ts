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
  /**
   * Порог в складчатом (4D) генераторе: может ли этот проём сдвигать координату W.
   * 'auto' (по умолчанию) — по настройкам генератора; 'always' — всегда сдвиг (напр. входные
   * двери квартир: за каждой — своё измерение); 'never' — обычный порог. Евклидов генератор игнорирует.
   */
  shift?: ShiftMode;
}

export type ShiftMode = 'auto' | 'always' | 'never';

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
  /** Отделка, заданная комнате явно (id из Project.finishes); null — по правилам FinishRule. */
  finish: { wall: string | null; floor: string | null };
  /** Спец-локация: вход в эту комнату переводит игрока в особую сцену со своей механикой
   *  (см. src/locations/). Нет поля / null — обычная комната. */
  location?: LocationSpec | null;
}

/**
 * «Бесконечная лестница»: зацикленный тёмный подъезд. Спуск по петле бесконечен. Время от времени
 * снизу раздаётся страшный звук — нужно подняться на этаж, потом можно снова вниз; шаг вниз после
 * звука — Хвататель утаскивает вглубь подъезда (смерть). Чем дольше медлишь после звука, тем ближе
 * Хвататель и тем меньше времени. Пережил подряд нужное число звуков — петля размыкается,
 * лестница становится обычной и выводит на этаж(и) ниже.
 */
export interface StairwellSpec {
  kind: 'stairwell';
  /** сколько звуков подряд нужно пережить: случайное целое в [min, max] (по сиду экземпляра) */
  sounds: [number, number];
  /** пауза между звуками, с: случайно в [min, max] */
  interval: [number, number];
  /** «база»: за сколько секунд Хвататель дошёл бы до игрока без ускорения. С ускорением, если после звука
   *  стоять на месте, — за t* = accelS·(√(1 + 2·grabS/accelS) − 1) (по умолчанию 9 и 6 → 6 с), см. grabTime */
  grabS: number;
  /** ускорение приближения: темп растёт как (1 + t / accelS), t — время после звука */
  accelS: number;
  /** на сколько этажей ниже выводит разомкнутая лестница: случайное целое в [min, max] */
  floorsDown: [number, number];
  /** темнота 0..1 (1 — свет только от фонарика) */
  darkness: number;
}

export type LocationSpec = StairwellSpec;

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
  /**
   * Предел дальности прямой видимости, м; 0 — без ограничения.
   * Самая длинная прямая линия обзора по проходимому пространству (пол комнат + проёмы связанных
   * дверей) — по горизонтали, вертикали и диагоналям 45°. Чем меньше предел, тем извилистее карта.
   */
  sightM: number;
  /**
   * Достраивать тупики: после набора count закрыть оставшиеся открытые метки «листовыми»
   * комнатами (без ростовых меток — кухни, санузлы, жилые, балконы), чтобы квартиры не
   * обрывались на прихожей. Хабы при этом не ставятся; count может быть превышен.
   */
  fill: boolean;
  /** 'euclid' (по умолчанию) — обычный генератор; 'fold' — складчатый 4D (см. FoldSettings) */
  mode?: GeneratorMode;
  /** настройки складчатого генератора (используются при mode = 'fold') */
  fold?: FoldSettings;
}

export type GeneratorMode = 'euclid' | 'fold';

/**
 * Складчатый (4D) генератор: у каждой комнаты есть координата W («слой»). Пороги могут сдвигать W,
 * поэтому комнаты разных слоёв занимают одно и то же место в 3D. Гарантии:
 *  • в одном слое комнаты не пересекаются (каждый слой — обычный евклидов план, по нему можно
 *    считать физику);
 *  • комнаты на расстоянии ≤ localRadius по графу связей не пересекаются в 3D, в каком бы слое
 *    ни были, — поэтому «текущая комната + соседи за дверями» всегда выглядят непротиворечиво.
 */
export interface FoldSettings {
  /** вероятность сдвига на пороге 'auto', даже когда место в слое есть (0..1) */
  shiftChance: number;
  /** максимальный |ΔW| одного порога */
  maxShift: number;
  /** радиус локальной евклидовости по графу (1 — только соседи; 2 — безопасно для рендера «комната + соседи») */
  localRadius: number;
  /** допустимый диапазон слоёв: |W| ≤ maxLayer */
  maxLayer: number;
  /**
   * Запрет пересечений внутри видимого набора (по умолчанию false). Нужен, только если движок рисует
   * потенциально видимый набор (PVS) комнаты целиком: тогда комнаты одного PVS не пересекаются в 3D
   * и смена набора на пороге незаметна. С портальным рендером (каждая комната видна только сквозь
   * свой проём) пересечения в поле зрения допустимы — складок больше, переходы всё равно бесшовны.
   */
  seamless?: boolean;
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

// ───────────────────────── Отделка (обои, кафель, покраска, полы) ─────────────────────────

export type FinishSurface = 'wall' | 'floor';

export interface Finish {
  id: string;
  name: string;
  /** где применима: стены или пол */
  surface: FinishSurface;
  /** цвет без текстуры / средний цвет текстуры (для превью и простых движков) */
  color: string;
  /** бесшовная текстура (JPEG/PNG data:URI, длинная сторона ≤ 1024) или null */
  tex: string | null;
  /** размер одного повтора текстуры на поверхности, м (обои: ширина ~0.5–1.4, кафель 0.15) */
  tileW: number;
  tileH: number;
  /** нижняя панель стены: другая отделка до высоты heightM (подъезд — краска до 1.5 м, санузел — кафель до 1.5 м) */
  dado: { finishId: string; heightM: number } | null;
  tags: string[];
}

/** Правило по тегу комнаты: какие отделки разыгрываются (по весам) для стен и пола. */
export interface FinishRule {
  /** тег комнаты; правило берётся по первому тегу комнаты, у которого есть правило */
  tag: string;
  wall: { finishId: string; weight: number }[];
  floor: { finishId: string; weight: number }[];
}

export interface Project {
  settings: Settings;
  props: Prop[];
  items: Item[];
  rooms: Room[];
  generator: GeneratorSettings;
  economy: Economy;
  finishes: Finish[];
  finishRules: FinishRule[];
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
  /** координата W (слой) — только в складчатом генераторе; нет поля — 0 */
  w?: number;
  /** этаж (0 — этаж старта, вниз — отрицательные); меняется только переходом спец-локации */
  floor?: number;
}

export interface Link {
  a: { inst: string; connector: string };
  b: { inst: string; connector: string };
  /** сдвиг порога по W: w(b) − w(a); нет поля — 0 (обычный порог) */
  dw?: number;
  /** 'descent' — переход спец-локации на этаж(и) ниже: без геометрической стыковки, меток лицом
   *  к лицу нет (a — экземпляр локации, b — комната, куда выводит). Нет поля — обычная дверь. */
  kind?: 'door' | 'descent';
  /** для 'descent': на сколько этажей вниз */
  floors?: number;
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
  /** fallback — выпавший вариант перегораживал проход и был подменён (см. src/gen/walk.ts) */
  groups: { groupId: string; variantId: string; fallback?: true }[];
  spots: SpawnedSpot[];
  loot: SpawnedLoot[];
  /** разыгранная отделка экземпляра (id отделок или null — нет правила) */
  finish: { wall: string | null; floor: string | null };
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
  /** самая длинная линия прямой видимости в прогоне: длина в метрах и отрезок в мировых клетках */
  sight: { maxM: number; line: [number, number, number, number] | null };
  /** диагностика остановки роста — есть, только если count не набран */
  stop?: RunStop;
  /** сводка складчатого генератора (только mode = 'fold') */
  fold?: FoldStats;
  /** потенциально видимые наборы: id экземпляра → id экземпляров, которые надо рендерить, стоя в нём
   *  (включая его самого). Только складчатый режим с seamless и sightM > 0. */
  pvs?: Record<string, string[]>;
  /** время генерации, мс */
  ms: number;
}

export interface FoldStats {
  /** диапазон занятых слоёв */
  minW: number;
  maxW: number;
  /** сколько разных слоёв занято */
  layers: number;
  /** пар экземпляров, пересекающихся в 3D (они всегда в разных слоях и дальше localRadius по графу) */
  overlaps: number;
  /** порогов со сдвигом W (dw ≠ 0) */
  shifted: number;
}

/** Почему рост остановился раньше count: тупиковые метки по причинам последней неудачи. */
export interface RunStop {
  /** всего открытых меток (тупиков) */
  open: number;
  /** нет ни одной совместимой комнаты в пуле */
  noMatch: number;
  /** совместимые комнаты есть, но все упёрлись в max */
  atMax: number;
  /** совместимые комнаты не помещаются (коллизии) */
  noSpace: number;
  /** помещаются, но нарушают предел обзора */
  sight: number;
  /** id комнат, упёршихся в max на тупиках */
  maxRooms: string[];
  /** теги тупиковых меток, для которых нет совместимых комнат */
  noMatchTags: string[];
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

export type LayerKey = 'grid' | 'doors' | 'connectors' | 'decor' | 'spots' | 'walk';

export type Selection =
  | { kind: 'decor' | 'spot' | 'door' | 'connector'; id: string }
  | null;

export type Page = 'editor' | 'library' | 'economy' | 'spawn' | 'generator' | 'view3d' | 'data';
