// Контракт генератора «болванок» (blockout): JSON прогона Room Forge → чистая 3D-геометрия
// стен, полов, потолков и проёмов, без наложений.
//
// Папка src/blockout/ самодостаточна: core.ts и types.ts не импортируют ничего из приложения,
// babylon.ts зависит только от @babylonjs/core. Её можно скопировать в прототип игры как есть.
//
// Системы координат:
//  • План (вход и BlockoutModel): метры, x вправо, y ВНИЗ (как на плане редактора), z — высота вверх.
//    Клетка плана (cx, cy) = квадрат [cx·cellM, (cx+1)·cellM] × [cy·cellM, (cy+1)·cellM].
//  • Babylon (только в babylon.ts): X = x, Y = z, Z = −y. Тогда вид сверху совпадает с планом,
//    а поворот плана rot° (по часовой при y вниз) = rotation.y = rot·π/180 (левая система Babylon).

// ───────────────────────── Вход: экспорт прогона (src/gen/world.ts → exportRunJSON) ─────────────────────────

export type Side = 'N' | 'S' | 'E' | 'W';

/** Отрезок на границе: (cx, cy) — первая клетка комнаты, side — её сторона, len — длина в клетках;
 *  N/S идут вдоль +x, E/W — вдоль +y. line = [x1, y1, x2, y2] в клетках (углы клеток). */
export interface RunSegment {
  id: string;
  cx: number;
  cy: number;
  side: Side;
  len: number;
  line: [number, number, number, number];
}

export interface RunConnector extends RunSegment {
  name: string;
  tag: string;
  /** с чем связана метка; null — тупик (проём закрыт) */
  linkedTo: { inst: string; connector: string } | null;
  /** связь срезана подпрогоном (subrun.ts): во всём прогоне метка связана, но партнёра в части нет.
   *  Такой тупик ядро делает по BlockoutOptions.cutEnds (например, проёмом в темноту), а не по deadEnds. */
  cut?: boolean;
  /** бесконечный мир: закрытая дверь-выход из квартиры (её можно открыть) — тупик всегда с дверной панелью
   *  ('panel'), какими бы ни были deadEnds */
  exit?: boolean;
  /** бесконечный мир: метка прихода перехода (комната за выходом лифта, за спуском лестницы) — у неё игрок выходит из
   *  локации и через неё возвращается: тупик всегда панелью (как и метки прихода по связям-переходам в links) */
  arrival?: boolean;
}

export interface RunInstance {
  id: string;
  roomId: string;
  roomName: string;
  roomTags: string[];
  rot: number;
  dx: number;
  dy: number;
  depth: number;
  parent: string | null;
  /** слой W складчатого (4D) генератора; нет поля / 0 — обычный прогон */
  w?: number;
  /** этаж (0 — этаж старта, ниже — отрицательные, выше — положительные): меняется только переходом спец-локации
   *  (links[].kind = 'descent' — вниз, 'lift' — выход лифта вверх) */
  floor?: number;
  /** спец-локация комнаты (Room Forge: src/locations/, docs/LOCATIONS.md) или null — обычная комната */
  location?: { kind: string; [k: string]: unknown } | null;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  /** сжатые ряды клеток "y:x1-x2,x3" в мировых клетках */
  cells: string[];
  doors: RunSegment[];
  connectors: RunConnector[];
  decor: { id: string; propId: string; x: number; y: number; rot: number }[];
  spots: {
    id: string;
    name: string;
    x: number;
    y: number;
    rot: number;
    groupId: string | null;
    variantId: string | null;
    content: { kind: 'prop' | 'item'; id: string; rot: number } | null;
    contentRot: number | null;
  }[];
  tier: string | null;
  danger: number;
  dangerAcc: number;
  loot: { itemId: string; count: number; from: string; rowId: string; decorId?: string; shopId?: string }[];
  /** разыгранная отделка (id из RunExport.finishes); нет поля / null — без отделки (сетка) */
  finish?: { wall: string | null; floor: string | null };
}

/** Отделка поверхности (обои, кафель, покраска, линолеум…). */
export interface RunFinish {
  id: string;
  name: string;
  surface: 'wall' | 'floor';
  /** средний цвет — если текстуры нет или движок её не грузит */
  color: string;
  /** бесшовная текстура data:URI (есть при экспорте с текстурами) или null */
  tex: string | null;
  hasTex: boolean;
  /** размер одного повтора на поверхности, м */
  tileW: number;
  tileH: number;
  /** нижняя панель: другая отделка до высоты heightM */
  dado: { finishId: string; heightM: number } | null;
}

export interface RunExport {
  format: 'room-forge-run';
  version: number;
  seed: string;
  cellM: number;
  settings: { gap: number; [k: string]: unknown };
  props: { id: string; name: string; w: number; h: number; color: string; tags: string[]; hasTex: boolean; tex: string | null }[];
  items: { id: string; name: string; color: string; tags: string[] }[];
  tiers?: { id: string; name: string; level: number; color: string; danger: number }[];
  instances: RunInstance[];
  /** dw — сдвиг порога по W в складчатом прогоне: w(b) − w(a) */
  /** kind = 'descent' — переход спец-локации на этаж(и) ниже (floors), 'lift' — выход лифта на floors этажей выше
   *  (side — 'straight' / 'right'): не проёмы, геометрии нет (a.connector пуст) */
  links: {
    a: { inst: string; connector: string }; b: { inst: string; connector: string }; dw?: number;
    kind?: 'door' | 'descent' | 'lift'; floors?: number; side?: 'straight' | 'right';
    /** бесконечный мир: «исчезнувшая» дверь (пропущенный переход) — не проём; дверь в переход — метки любые */
    sealed?: true; loose?: true;
    /** бесконечный прямой ход: шов со сдвигом — b, сдвинутый на wrap (клетки плана: [dx, dy]), стоит лицом к a. В модели
     *  целиком — не проём (обе метки — тупики); куски портального рендера сдвигают соседа и открывают проём
     *  (src/blockout/pieces.ts, src/view3d/portal.ts) */
    wrap?: [number, number];
  }[];
  openConnectors: { inst: string; connector: string }[];
  /** складчатый прогон с бесшовной видимостью: id экземпляра → id экземпляров его PVS (включая его) */
  pvs?: Record<string, string[]> | null;
  /** таблица отделок, на которые ссылаются instances[].finish */
  finishes?: RunFinish[];
  [k: string]: unknown;
}

// ───────────────────────── Настройки ─────────────────────────

/** Что делать с тупиковыми проёмами (метка/дверь без пары). */
export type DeadEndMode =
  /** глухая стена */
  | 'wall'
  /** стена + утопленная дверная панель-заглушка («заколоченная дверь») */
  | 'panel'
  /** оставить проём открытым наружу (для предпросмотра одной комнаты) */
  | 'open';

export interface BlockoutOptions {
  /** высота от пола до потолка, м (хрущёвка ≈ 2.5) */
  wallHeightM: number;
  /** высота дверного проёма, м (блоки ДГ 21-х → ≈ 2.07–2.1) */
  doorHeightM: number;
  /** толщина обвязки — наружных стен вокруг пола, в клетках; внутренние стены = зазор генератора */
  outerWallCells: number;
  /** толщина перегородки, если комнаты стоят вплотную (gap = 0), м */
  partitionM: number;
  /** толщина плиты пола и потолка, м (0 — плоскости без толщины) */
  slabM: number;
  ceilings: boolean;
  /** болванки мебели: бокс по габаритам prop с высотой по тегам */
  props: boolean;
  /** выпавшее на спотах (props) тоже ставить */
  spotProps: boolean;
  deadEnds: DeadEndMode;
  /** тупики меток со срезанной связью (RunConnector.cut — подпрогон складчатого прогона); нет — как deadEnds.
   *  'open' — проём в темноту: при рендере потенциально видимого набора (PVS) их по построению не видно */
  cutEnds?: DeadEndMode;
  /** замкнутые пустоты, не связанные с внешним пространством (дыры/колонны, щели между стенами), заполнять массой */
  fillVoids: boolean;
  /**
   * Владение (для портального рендера складчатого прогона, docs/BLOCKOUT.md §10): каждый твёрдый объём
   * получает владельца Solid.inst — стеновая масса делится между ближайшими полами (Воронов по
   * полуклеткам, расстояние Чебышёва, ничья — экземпляр раньше в списке), стена между комнатами —
   * ровно по середине, проём (пол, перемычка) — по середине, перегородка gap = 0 — по ребру. Полы
   * проёмов — по половинам (Surface.owner). Тогда «кусок» комнаты = её собственные объёмы, полы,
   * облицовка, мебель, тупики — и куски соседей стыкуются без щелей и наложений. Нет поля — выкл.
   */
  ownership?: boolean;
}

export const DEFAULT_BLOCKOUT: BlockoutOptions = {
  wallHeightM: 2.5,
  doorHeightM: 2.1,
  outerWallCells: 2,
  partitionM: 0.08,
  slabM: 0.2,
  ceilings: true,
  props: true,
  spotProps: true,
  deadEnds: 'panel',
  fillVoids: true,
};

// ───────────────────────── Выход: модель болванки (план, метры) ─────────────────────────

/** Прямоугольник плана, м; x0 < x1, y0 < y1. */
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type SolidKind =
  /** стеновая масса (наружная обвязка, стены между комнатами, заполненные пустоты) */
  | 'wall'
  /** тонкая перегородка между комнатами вплотную (gap = 0) */
  | 'partition'
  /** надпроёмная перемычка над связанным проёмом: от doorHeight до wallHeight */
  | 'lintel'
  /** колонна/заполнение замкнутой пустоты внутри комнаты */
  | 'column';

/** Твёрдый объём: прямоугольник плана × высота. Объёмы модели НЕ пересекаются друг с другом. */
export interface Solid {
  kind: SolidKind;
  rect: Rect;
  z0: number;
  z1: number;
  /** владелец объёма (только при BlockoutOptions.ownership) — экземпляр, чьему полу объём ближе */
  inst?: string;
}

/** Пол или потолок одной комнаты (или проёма) — набор непересекающихся прямоугольников. */
export interface Surface {
  /** экземпляр; null — пол/потолок проёма между комнатами */
  inst: string | null;
  /** у пола/потолка проёма (inst = null) при BlockoutOptions.ownership — чья это половина проёма */
  owner?: string;
  rects: Rect[];
  /** отделка пола (id из BlockoutModel.finishes); у потолков и полов проёмов — null */
  finish?: string | null;
  /** отметка верхней грани пола / нижней грани потолка, м */
  z: number;
}

/** Связанный проём: сквозное отверстие в стене между двумя комнатами. */
export interface Opening {
  a: { inst: string; connector: string };
  b: { inst: string; connector: string };
  /** прямоугольник проёма в плане (на всю толщину стены; при gap = 0 — толщина перегородки) */
  rect: Rect;
  /** ось прохода: 'x' — проходят вдоль x (стена вертикальная на плане), 'y' — вдоль y */
  axis: 'x' | 'y';
  /** ширина в свету, м */
  widthM: number;
  heightM: number;
}

/** Тупиковый проём, закрытый стеной (deadEnds = 'panel' → у стены рисуется дверная панель). */
export interface DeadEnd {
  inst: string;
  connector: string;
  /** линия проёма по грани стены со стороны комнаты, м */
  line: [number, number, number, number];
  /** нормаль внутрь комнаты на плане */
  normal: [number, number];
  widthM: number;
  heightM: number;
  /** откуда тупик: несвязанная метка (connector — id метки) или дверь без метки (connector — id двери) */
  source?: 'connector' | 'door';
}

/**
 * Облицовка: видимая из комнаты грань стены, куда клеятся обои/кафель/краска. Лежит в плоскости
 * грани твёрдого объёма (стены, перегородки, колонны, перемычки), объёмы не меняет — адаптер
 * рисует её тонким слоем со смещением 1–2 мм внутрь комнаты.
 * Грани разбиты по комнатам: одна облицовка — одна комната, прямая, без проёмов внутри.
 */
export interface WallFace {
  inst: string;
  /** линия грани на плане, м: от (x1, y1) к (x2, y2) */
  line: [number, number, number, number];
  /** нормаль внутрь комнаты (единичная, по осям) */
  normal: [number, number];
  z0: number;
  z1: number;
  /** что за поверхность: стена на всю высоту или участок над проёмом (перемычка) */
  part: 'wall' | 'lintel';
  /** id отделки (BlockoutModel.finishes) или null */
  finish: string | null;
}

export interface PropBox {
  inst: string;
  /** 'decor' — фиксированный декор, 'spot' — выпало на споте */
  source: 'decor' | 'spot';
  propId: string;
  name: string;
  /** центр на плане, м */
  x: number;
  y: number;
  /** поворот по часовой (план, y вниз), градусы */
  rot: number;
  /** ширина (по x при rot 0), глубина (по y при rot 0), высота — м */
  w: number;
  d: number;
  h: number;
  color: string;
  tags: string[];
}

export interface RoomInfo3D {
  inst: string;
  roomId: string;
  name: string;
  tags: string[];
  bbox: Rect;
  /** точка для подписи / спавна камеры: центр самой большой прямоугольной части пола */
  anchor: [number, number];
  tier: string | null;
  floorAreaM2: number;
  finish: { wall: string | null; floor: string | null };
}

export interface BlockoutModel {
  format: 'room-forge-blockout';
  version: 1;
  units: 'm';
  axes: 'plan: x right, y down, z up';
  cellM: number;
  options: BlockoutOptions;
  bounds: Rect;
  solids: Solid[];
  floors: Surface[];
  ceilings: Surface[];
  openings: Opening[];
  deadEnds: DeadEnd[];
  /** облицовка стен по комнатам (строится всегда; без отделки — finish: null) */
  faces: WallFace[];
  /** отделки, на которые ссылаются faces / floors / rooms (копия RunExport.finishes) */
  finishes: RunFinish[];
  props: PropBox[];
  rooms: RoomInfo3D[];
  stats: {
    floorCells: number;
    wallCells: number;
    solids: number;
    openings: number;
    deadEnds: number;
    ms: number;
  };
  /** найденные и исправленные/неисправимые проблемы входа (по-русски) */
  issues: string[];
}
