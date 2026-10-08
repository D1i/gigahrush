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

/**
 * «Ржавый лифт»: ржавая клетка на тросе или открытая каретка в шахте. Игрок едет вверх (рычаг); на каждом
 * этаже над входом два выхода — прямо и направо; за одним из них на одном из этажей — логово босса. При
 * подъёме может упасть доска: застревает между кабиной и стеной шахты, бьёт, пылит и раскачивает лифт —
 * гасить крен, перебегая к краю, который поднимается. С каретки сильный крен выбрасывает в шахту (смерть);
 * клетка бьётся о стены и стоит, пока раскачка не стихнет. Механика — src/locations/lift.ts.
 */
export interface LiftSpec {
  kind: 'lift';
  /** вероятность, что экземпляр — клетка (иначе каретка): 0 — всегда каретка, 1 — всегда клетка */
  cageChance: number;
  /** сколько этажей с выходами над входом (ход вверх): случайное целое в [min, max] */
  floorsUp: [number, number];
  /** сколько этажей с выходами под входом (ход вниз, 0 — вниз не ездит): случайное целое в [min, max] */
  floorsDown: [number, number];
  /** вероятность, что за одним из выходов лифта — логово босса */
  lairChance: number;
  /** скорость кабины, м/с */
  speed: number;
  /** вероятность, что на пролёте вверх (между этажами f и f + 1) упадёт доска */
  boardChance: number;
  /** первый подъём в попытке — доска всегда (на первом же пролёте вверх), дальше — по boardChance */
  boardFirst: boolean;
  /** удар доски: начальная амплитуда крена в долях предела */
  boardKick: number;
  /** сколько секунд застрявшая доска раскачивает лифт: случайно в [min, max] */
  boardPumpS: [number, number];
  /** период качания, с */
  swingPeriod: number;
  /** темнота 0..1 (1 — свет только от фонарика) */
  darkness: number;
}

/** Логово босса — заглушка: боссов в игре пока нет. Комната помечена для движка; в Room Forge — тёмная
 *  комната с табличкой. Ставится только как выход лифта (вес роста 0). */
export interface LairSpec {
  kind: 'lair';
  /** id босса для движка; пусто — «здесь будет босс» */
  boss: string;
  /** темнота 0..1 */
  darkness: number;
}

export type LocationSpec = StairwellSpec | LiftSpec | LairSpec;

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
  /** служебное (прогон бесконечного мира в режиме квартир): ходы и хабы подвала — длинный обзор, предел обзора на
   *  линии через них не действует (docs/GENERATOR-4D.md §17). В настройках проекта не задаётся */
  longSight?: boolean;
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
  /** 4D-складки не ближе стольких метров пути: комнаты, занимающие одно место в 3D, дальше друг от друга по ходьбе
   *  (через двери; внутри комнаты — по прямой между серединами проёмов). Нет / 0 — без проверки */
  localM?: number;
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
  /** бесконечный мир (4D, «Прогулка»): биомы, квартиры, переходы (docs/GENERATOR-4D.md §16) */
  world: WorldSettings;
}

/**
 * Биом бесконечного мира: какие комнаты в нём растут. Вес комнаты в биоме = её вес роста × наибольший множитель
 * среди её тегов (тега нет в списке — 0: комната в биоме не растёт). Спец-комнаты (Room.location) обычным ростом не
 * ставятся ни в каком биоме — только переходами.
 */
export interface Biome {
  id: string;
  name: string;
  /** цвет на плане и в HUD */
  color: string;
  tags: { tag: string; mul: number }[];
  /** богатая квартира: элитность её комнат разыгрывается с усилением WorldSettings.richBoost (как проходка);
   *  в такой биом ведёт часть переходов, стартом и «другим биомом» он не бывает */
  rich?: boolean;
  /** рост биома: нет поля — квартиры (кластеры с выходами); 'tunnels' — сеть ходов подвала (длинные ходы, редкие
   *  хабы, ответвления, кольца и бесконечные прямые участки — WorldSettings.tunnels, docs/GENERATOR-4D.md §17) */
  layout?: 'tunnels';
  /** отделка биома: правила поверх правил проекта (по тегу комнаты, как Project.finishRules) — у разных подвалов
   *  разные стены и полы при тех же комнатах */
  finishRules?: FinishRule[];
  /** свои параметры генератора биома поверх общих (WorldSettings): квартиры — у квартирных, ходы — у подвалов */
  apartments?: Partial<ApartmentSettings>;
  tunnels?: Partial<TunnelSettings>;
  note: string;
}

/** Параметры роста квартир (общие — в WorldSettings, свои — Biome.apartments). */
export interface ApartmentSettings {
  /** комнат в квартире [min, max], max ≤ 15 */
  clusterRooms: [number, number];
  /** дверей-выходов из квартиры [min, max] (1…10); K — бросок в диапазоне */
  clusterExits: [number, number];
  /** проходимость: при росте держать открытыми max(min, K · exitReserve) дверей — за ними встают только проходные
   *  комнаты; 1 — K дверей (меньше тупиковых комнат), 0 — только минимум (обычные квартиры, больше кухонь и санузлов) */
  exitReserve: number;
  /** вход новой квартиры — комната, у которой кроме двери входа не меньше min + entrySpare дверей (первые попытки) */
  entrySpare: number;
  /** стыковка 4D-швом: по меткам за выходом ничего не встаёт — вход стыкуется любой своей дверью (связь loose) */
  seamEntries: boolean;
}

/** 4D и обзор «Прогулки» (бесконечный мир): складки, предел обзора, сколько строить вперёд. */
export interface WalkGenSettings {
  /** шанс сдвига слоя W на пороге и наибольший сдвиг */
  shiftChance: number;
  maxShift: number;
  /** соседи в пределах стольких дверей не пересекаются в 3D (1 — только соседи по порогу) */
  localRadius: number;
  /** 4D-складки не ближе стольких метров пути (FoldSettings.localM; 0 — без проверки) */
  localM: number;
  /** наибольший |W| */
  maxLayer: number;
  /** предел обзора по порталам, м (0 — без предела); ходы и хабы подвала им не ограничены */
  sightM: number;
  /** на сколько дверей вперёд мир строится заранее */
  aheadDoors: number;
}

/**
 * Сеть ходов подвала (биом с layout = 'tunnels'): ходы шириной 1 м растут на ходу, как игрок идёт; хабы — редкие залы,
 * через них в подвал входят и выходят (дверь-марш наверх — закрытый выход, ведёт в квартиры). Длины — по оси хода, м.
 */
export interface TunnelSettings {
  /** хаб — не ближе hubEvery[0] м хода от прошлого хаба, к hubEvery[1] м — наверняка (шанс растёт линейно) */
  hubEvery: [number, number];
  /** на каждый кусок хода: шанс поворота и развилки (остальное — прямой кусок) */
  turn: number;
  branch: number;
  /** боковая дверь хода в кладовую: шанс, что за ней кладовая (иначе стена) */
  storage: number;
  /** ход из хаба замыкается кольцом (через слои W — кольца проходят сквозь другие ходы): шанс и длина, м */
  ring: number;
  ringLen: [number, number];
  /** бесконечный прямой участок: развилка, прямой ход и шов — дошёл до конца и снова в начале. Шанс на кусок хода
   *  (не ближе loopMinDist м к хабу) и длина участка, м */
  loop: number;
  loopLen: [number, number];
  loopMinDist: number;
  /** частота кусков подвала: множитель веса роста по id комнаты (нет — 1, 0 — не ставится) */
  pieceWeights: Record<string, number>;
}

/**
 * Бесконечный мир (4D, «Прогулка») — квартиры, переходы, биомы (docs/GENERATOR-4D.md §16).
 * Мир растёт квартирами — кластерами комнат: в квартире clusterRooms комнат (не больше 15) и clusterExits закрытых
 * дверей-выходов. Открыл выход — за ним новая квартира, остальные неоткрытые выходы исчезают (назад через открытую
 * дверь можно). Переход (спец-комната: лестница, лифт) появляется рядом с игроком: после trAfter пройденных комнат
 * каждая следующая новая комната даёт шанс trBase, +trStep за каждую следующую; выпал — переход будет за следующей
 * открытой дверью (не встал за ней — в новой квартире рядом со входом). Пропустил (ушёл из квартиры, не зайдя) — исчезает. Прошёл через
 * переход — счётчик с нуля; переход ведёт в другой биом (trToBiome) или в богатую квартиру.
 */
export interface WorldSettings extends ApartmentSettings {
  /** метки «наружу»: только такие двери квартиры бывают выходами в первую очередь (входная, коридор, марш, ход) */
  outerTags: string[];
  /** переход встаёт за дверью шириной от стольких метров */
  transitionMinLen: number;
  /** 4D и обзор «Прогулки» */
  walk: WalkGenSettings;
  /** переходы: после стольких пройденных (впервые) комнат — шанс trBase, затем +trStep за каждую следующую */
  trAfter: number;
  trBase: number;
  trStep: number;
  /** куда ведёт переход: доля «в другой биом», остальное — в богатую квартиру */
  trToBiome: number;
  /** богатая квартира: множитель весов тиров элитности ≥ 2 (как Pass.tierBoost) */
  richBoost: number;
  biomes: Biome[];
  /** стартовый биом (id); null — первый не «богатый» */
  startBiome: string | null;
  /** сеть ходов подвала (биомы с layout = 'tunnels') */
  tunnels: TunnelSettings;
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
  /** этаж (0 — этаж старта, вниз — отрицательные, вверх — положительные); меняется только переходом спец-локации
   *  (вниз — «Бесконечная лестница», вверх — выход «Ржавого лифта») */
  floor?: number;
}

export interface Link {
  a: { inst: string; connector: string };
  b: { inst: string; connector: string };
  /** сдвиг порога по W: w(b) − w(a); нет поля — 0 (обычный порог) */
  dw?: number;
  /** 'descent' — переход спец-локации на этаж(и) ниже: без геометрической стыковки, меток лицом
   *  к лицу нет (a — экземпляр локации, b — комната, куда выводит). 'lift' — выход лифта на этаже выше
   *  (a — лифт, b — комната за выходом). Нет поля — обычная дверь. */
  kind?: 'door' | 'descent' | 'lift';
  /** для 'descent': на сколько этажей вниз; для 'lift': на сколько этажей выше лифта (отрицательное — ниже) */
  floors?: number;
  /** для 'lift': какой выход кабины — прямо (напротив входа) или направо */
  side?: LiftSide;
  /** бесконечный мир: дверь «исчезла» (пропущенный переход) — проёма больше нет, обе метки — тупики */
  sealed?: true;
  /** бесконечный мир: дверь в переход (спец-комнату) — метки любые (теги и ширина могут не совпадать), проём — их
   *  общая часть, совмещены по центру */
  loose?: true;
  /** бесконечный мир: вход квартиры b встал ближе FoldSettings.localM пути (за выходом иначе ничего не вставало — мир не
   *  должен упереться в стену); складки с b validateFoldRun по метрам не меряет */
  close?: true;
  /** бесконечный прямой ход подвала — шов: метка b стоит лицом к метке a, если экземпляр b сдвинуть на wrap
   *  (клетки плана [dx, dy]). Проём — портал со сдвигом сцены: за ним виден b (и дальше) сдвинутым на wrap; шагнул —
   *  игрок переносится на −wrap. В 3D комнаты не соседи (docs/GENERATOR-4D.md §17.6) */
  wrap?: [number, number];
}

/** Выход лифта на этаже выше или ниже входа (по ассету rusted_lift_v2): «прямо» — узкий проём 1.0 м в передней стене
 *  шахты, над (под) входом этажа 0; «направо» — широкий проём 2.4 м в правой стене, если войти в кабину и стоять лицом
 *  от входа.
 *  В плане комнаты-пресета (вход — сторона S): прямо — S, направо — E (с учётом поворота экземпляра). */
export type LiftSide = 'straight' | 'right';

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
