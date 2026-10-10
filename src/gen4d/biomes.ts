// Биомы и настройки бесконечного мира (4D, «Прогулка»): квартиры (кластеры комнат), двери-выходы, переходы, сеть
// ходов подвала и сарая. Механика — src/gen4d/stream.ts (режим квартир), правила — docs/GENERATOR-4D.md §16–17, §19.
//
// Биом — набор комнат по тегам: вес комнаты в биоме = вес роста × наибольший множитель среди её тегов
// (тега нет в списке — 0). Пресеты — по группам комнат (первый тег): хрущёвки (подъезд и квартиры), малосемейки
// (коридорный дом, гостинки), общежитие, «богатая квартира» (куда ведут переходы, с усилением элитности) и три
// подвала — сеть ходов (layout 'tunnels') с одними комнатами и разной отделкой: сухой, заброшенный, затопленный;
// сарай — тоже сеть ходов, но из своих комнат (проходы 1.5 м, стойла, сеновал); общага — сеть длинных коридоров с
// комнатами по бокам (src/data/roomsObshaga.ts, docs/GENERATOR-4D.md §22).
// catacombs: катакомбы — тёмная сеть ходов трёх эпох с лазами, трубами и сухими площадками убежищ от наводнения
// (src/data/roomsCatacombs.ts, docs/GENERATOR-4D.md, раздел «Катакомбы»).
import type { ApartmentSettings, Biome, FinishRule, Room, TunnelSettings, WalkGenSettings, WorldSettings } from '../model/types';
import { DEFAULT_WET, normWet } from './wet';
import { STORY_PLACEHOLDER, STORY_START, storyBiomes, storyStep } from '../game/story';

/** Предел комнат в квартире (из правил заказчика). */
export const CLUSTER_MAX = 15;
/** Пределы числа выходов квартиры. */
export const EXITS_LIM: readonly [number, number] = [1, 10];

const B = (id: string, name: string, color: string, tags: [string, number][], note: string, rich = false): Biome => ({
  id,
  name,
  color,
  tags: tags.map(([tag, mul]) => ({ tag, mul })),
  ...(rich ? { rich: true as const } : {}),
  note,
});

type Rows = [string, number][];
const rule = (tag: string, wall: Rows, floor: Rows): FinishRule => ({
  tag,
  wall: wall.map(([finishId, weight]) => ({ finishId, weight })),
  floor: floor.map(([finishId, weight]) => ({ finishId, weight })),
});

/** Подвал — сеть ходов: те же комнаты (ходы, повороты, развилки, хабы, кладовые), своя отделка. */
const TUNNEL_TAGS: [string, number][] = [['подвал', 1], ['кладовка', 1], ['служебное', 0.3]];
/** Сарай — сеть проходов из своих комнат (src/data/roomsBarn.ts). */
const BARN_TAGS: [string, number][] = [['сарай', 1]];
/** Завод — сеть цехов из своих комнат (src/data/roomsFactory.ts). */
const FACTORY_TAGS: [string, number][] = [['завод', 1]];

/** Завод: сеть цехов с влажностью (src/gen4d/wet.ts) — порядок полей как у normBiome (wet — перед note). */
function factoryBiome(): Biome {
  const { note, ...rest } = T('factory', 'Завод', '#b0703a', [
    rule('сухо', [['f_bsm_brick', 4], ['f_concrete', 1]], [['f_bsm_concrete', 1]]),
    rule('сыро', [['f_bsm_brick', 3], ['f_bsm_damp', 2]], [['f_bsm_concrete', 2], ['f_bsm_damp_floor', 1]]),
    rule('течь', [['f_bsm_damp', 4], ['f_bsm_brick', 1]], [['f_bsm_damp_floor', 3], ['f_bsm_water', 1]]),
    rule('топь', [['f_bsm_damp', 1]], [['f_bsm_water', 3], ['f_bsm_damp_floor', 1]]),
  ], 'Завод: цеха из шестерёнок, сталелитейки и кручения всего подряд — проходы 2 м между рядами станков за перилами, ' +
    'хабы — машинный зал, литейный цех, насосная, затопленный цех. Выход один — болото: иди туда, где влажнее (на ' +
    'развилке один проход ведёт к сырости), дошёл — лестница на крышу, финал игры.', FACTORY_TAGS,
  { hubEvery: [30, 70], turn: 0.14, branch: 0.3, ring: 0, loop: 0 }, 0.45);
  return { ...rest, wet: { ...DEFAULT_WET }, note };
}
/** Общага — сеть коридоров из своих комнат (src/data/roomsObshaga.ts). */
const OBSHAGA_TAGS: [string, number][] = [['общага', 1]];

/** Общага (§22): длинные коридоры 2 м в кафеле, по бокам — двери тупиковых комнат, общие кухни, туалеты, душевые,
 *  прачечные; лестницы между этажами и спуск в затопленный подвал; хаб — вестибюль с вахтой. Не агрессивно
 *  неевклидова: повороты и развилки редки (прямые коридоры), кольца из вахты редкие и длинные, бесконечные участки —
 *  почти никогда. */
function obshagaBiome(): Biome {
  const { note, ...rest } = T('obshaga', 'Общага', '#c9b98a', [
    rule('коридор', [['f_obsh_corridor', 1]], [['f_obsh_lino_brown', 3], ['f_metlakh', 1]]),
    rule('вахта', [['f_obsh_corridor', 3], ['f_two_entrance', 1]], [['f_metlakh', 3], ['f_obsh_lino_brown', 1]]),
    rule('лестница', [['f_obsh_corridor', 2], ['f_two_entrance', 1]], [['f_concrete_floor', 2], ['f_metlakh', 1]]),
    rule('комната', [['f_obsh_paint_beige', 3], ['f_obsh_paint_green', 2], ['f_wp_rogozhka', 1]], [['f_obsh_lino_brown', 3], ['f_boards', 2], ['f_lino_gray', 1]]),
    rule('вахтёрская', [['f_obsh_paint_green', 2], ['f_obsh_paint_beige', 1]], [['f_obsh_lino_brown', 1]]),
    rule('кухня', [['f_two_kitchen', 3], ['f_obsh_corridor', 2]], [['f_metlakh', 2], ['f_obsh_lino_brown', 1]]),
    rule('туалет', [['f_two_bath', 1]], [['f_metlakh', 1]]),
    rule('душ', [['f_tile_white', 2], ['f_tile_blue', 1]], [['f_tile_floor', 2], ['f_metlakh', 1]]),
    rule('прачечная', [['f_two_bath', 2], ['f_obsh_paint_green', 1]], [['f_metlakh', 2], ['f_tile_floor', 1]]),
    rule('подвал', [['f_bsm_damp', 4], ['f_concrete', 1]], [['f_bsm_water', 1]]),
  ], 'Общага: длинные коридоры 2 м в бежевом и зелёном кафеле, по бокам через 3.3–3.6 м двери бедных комнат на 2–3 ' +
    'кровати (тупик, одна дверь-створка — закрывается сама), общие кухни, туалеты, душевая-улитка, прачечная; лестницы ' +
    'на этажи (подъём — модуль лестниц) и спуск в подвал, затопленный по пояс. Хаб — огромный вестибюль с вахтой и ' +
    'комнатой вахтёра (там всегда керосиновая лампа), выход — двери на улицу. Не агрессивно неевклидова: повороты и ' +
    'развилки редки, кольца редкие и длинные.',
  OBSHAGA_TAGS,
  // прямые коридоры: поворот 4%, развилка 3% на кусок; хаб через 90–200 м; 80% дверей комнат открываются (остальные
  // заперты); кольцо из вахты — 8%, длинное (40–90 м: наложение в 4D далеко от входа); бесконечный участок — 1%, не
  // ближе 30 м к хабу
  { hubEvery: [90, 200], turn: 0.04, branch: 0.03, storage: 0.8, ring: 0.08, ringLen: [40, 90], loop: 0.01, loopLen: [24, 40], loopMinDist: 30 });
  // обзор 45 м: коридор в 30–40 м с дверями виден до конца (по пределу обзора — 27 м); порядок полей — как у normBiome
  return { ...rest, viewM: 45, note };
}

/** Снежные тоннели — сеть лазов из своих комнат (src/data/roomsSnow.ts). */
const SNOW_TAGS: [string, number][] = [['снег', 1]];
const T = (id: string, name: string, color: string, rules: FinishRule[], note: string, tags = TUNNEL_TAGS, tunnels?: Partial<TunnelSettings>, dark?: number): Biome => {
  const { note: n, ...rest } = B(id, name, color, tags, note);
  // порядок полей — как у normBiome (сохранение → загрузка без изменений)
  return { ...rest, layout: 'tunnels', finishRules: rules, ...(tunnels ? { tunnels } : {}), ...(dark ? { dark } : {}), note: n };
};

// metro
/** Метро — три сети (зал, переходы, служебные ходы) и эскалаторы из своих комнат (src/data/roomsMetro.ts). */
const METRO_TAGS: [string, number][] = [['метро', 1]];

/** Метро (§24): бесконечная колонная станция — пролёты зала 18 м стыкуются торцами, из путевых стен — переходы, из
 *  переходов — служебные ходы, эскалаторы на три этажа вверх и вниз; станции поменьше в переходах, крошечные — в
 *  служебных ходах. Отделка — по тегу помещения (правила 'метро' нет). Залы до 18×18 м и тоннель 19 м: свой предел
 *  обзора 28 м; обзор вдаль 70 м. */
function metroBiome(): Biome {
  const { note, ...rest } = T('metro', 'Метро', '#b8423a', [
    rule('зал', [['f_metro_marble', 1]], [['f_metro_granite', 1]]),
    rule('вестибюль', [['f_metro_marble_dark', 1]], [['f_metro_granite', 1]]),
    rule('эскалатор', [['f_metro_marble_dark', 1]], [['f_metro_granite', 1]]),
    rule('переход', [['f_metro_tile', 1]], [['f_metro_granite', 1]]),
    rule('служебное', [['f_metro_slu', 1]], [['f_concrete_floor', 1]]),
    rule('сгоревший', [['f_metro_soot', 1]], [['f_metro_soot_floor', 1]]),
  ], 'Метро: бесконечная колонная станция — белый мрамор, пилоны, гранитный пол с красно-серыми ромбами, кессоны со ' +
    'световыми полосами, мозаичные панно на путевых стенах. Пролёты зала стыкуются без конца; из путевых стен — проходы ' +
    'через пути в переходы, из переходов — служебные ходы и эскалаторы на три этажа вверх или вниз (с малым шансом ' +
    'дорожка срывается). Станции внутри станций: поменьше — в переходах, крошечная — в служебных ходах. Хабы — ' +
    'вестибюли и аванзалы с выходом в город.',
  METRO_TAGS,
  // залы и переходы — длинные прямые с частыми бесконечными участками (10%, 27–54 м, не ближе 30 м к вестибюлю) и
  // кольцами из вестибюлей (30%, 40–90 м); развилка 14%, поворот 6% на кусок; вестибюль через 140–300 м; 55% дверей
  // служебных помещений открываются
  { hubEvery: [140, 300], turn: 0.06, branch: 0.14, storage: 0.55, ring: 0.3, ringLen: [40, 90], loop: 0.1, loopLen: [27, 54], loopMinDist: 30 });
  // обзор 70 м (зал растворяется во тьме вдали), свой предел обзора 28 м; порядок полей — как у normBiome
  return { ...rest, viewM: 70, sightM: 28, note };
}

// cellar
/** Погреб — сеть земляных ходов из своих комнат (src/data/roomsCellar.ts). */
const CELLAR_TAGS: [string, number][] = [['погреб', 1]];

/** Погреб (§25): нора-лабиринт под сараем — ходы 0.6 м в чёрной земле, щели 0.4 м (только боком), крошечные камеры и
 *  клетушки, крепь; света нет совсем (dark 1 — только фонарь). Выход — камера с дверью в снег (хаб со спец-локацией:
 *  переходов по счётчику нет). */
function cellarBiome(): Biome {
  const { note, ...rest } = T('cellar', 'Погреб', '#6e5640', [
    rule('погреб', [['f_cel_soil', 1]], [['f_cel_floor', 5], ['f_cel_boards', 1]]),
  ], 'Земляной погреб: узкие ходы 0.6 м в чёрной земле, крепь из старых брёвен, со свода сыплется земля; щели 0.4 м — ' +
    'только боком; крошечные камеры и клетушки за щелями (банки, мешки, осыпи). Света нет — только фонарь, пыль. Вход — ' +
    'люком из сарая (лаз наверх камеры); выход — камера с низкой дверью в снег (через 40–100 м ходами): за ней снег, ' +
    'обвал засыпает, откопался — снежные тоннели.',
  CELLAR_TAGS,
  // нора: поворот 26%, развилка 20% на кусок, короткие кольца из камер (20%, 12–30 м) и редкие бесконечные участки;
  // камера — через 40–100 м ходами (среди камер чаще всего — с дверью в снег); 60% щелей ведут в клетушку
  { hubEvery: [40, 100], turn: 0.26, branch: 0.2, storage: 0.6, ring: 0.2, ringLen: [12, 30], loop: 0.02, loopLen: [8, 16], loopMinDist: 10 }, 1);
  // свой предел обзора 6 м (клетушки крошечные; ходы и камеры — длинный обзор, им предел не мешает); порядок полей — как
  // у normBiome
  return { ...rest, sightM: 6, note };
}

// catacombs
/** Катакомбы — сеть ходов из своих комнат (src/data/roomsCatacombs.ts). */
const CATACOMB_TAGS: [string, number][] = [['катакомбы', 1]];

/** Катакомбы: питерские подземные ходы трёх эпох — имперский кирпичный свод, советский бетон с зелёной панелью,
 *  смешанные (облицовка отваливается до кирпича); лазы 0.8×0.8, трубы поперёк хода, насосные станции; периодически
 *  затапливает до 2.0 м (src/locations/catacombsFlood.ts) — сухо только на площадках убежищ на +2.1: у каждого хаба и в
 *  боковых нишах. Отделка — по эпохе и виду (правила 'катакомбы' нет — иначе оно бы победило). Света нет (dark 1). */
function catacombsBiome(): Biome {
  return T('catacombs', 'Катакомбы', '#5e6b58', [
    rule('имперский', [['f_cat_brick', 1]], [['f_cat_stone', 3], ['f_cat_silt', 1]]),
    rule('советский', [['f_cat_green', 3], ['f_cat_concrete', 2]], [['f_cat_floor', 3], ['f_cat_silt', 1]]),
    rule('смешанный', [['f_cat_peel', 1]], [['f_cat_silt', 2], ['f_cat_stone', 1]]),
    rule('лаз', [['f_cat_concrete', 2], ['f_cat_brick', 1]], [['f_cat_silt', 1]]),
    rule('станция', [['f_cat_green', 2], ['f_cat_concrete', 1]], [['f_cat_floor', 1]]),
    rule('убежище', [['f_cat_brick', 2], ['f_cat_peel', 1]], [['f_cat_floor', 1], ['f_cat_stone', 1]]),
  ], 'Питерские катакомбы: тёмные ходы 2 м трёх эпох — имперский кирпичный свод XIX века, советский бетон с зелёной ' +
    'панелью, кабелями и гермодверями, смешанные, где облицовка отваливается до старого кирпича; трубы поперёк хода ' +
    '(перелезть, проползти, пригнуться), квадратные лазы 0.8×0.8 только ползком, насосные станции с колоннами. Света нет ' +
    '— только фонарь. Ходы периодически затапливает до 2 метров: спасает только сухое место на +2.1 — машинная площадка ' +
    'или антресоль хаба, полати в боковой нише-убежище; услышал воду — беги наверх. Вход — бесконечной лестницей или ' +
    'переходом, выход — марш наверх хаба или переход.',
  CATACOMB_TAGS,
  // хаб (всегда с сухой площадкой) — через 24–48 м хода: до сухого места не дальше ~50 м, а с нишами (75% боковых
  // проёмов — ниша-убежище) обычно 10–20 м; повороты 12%, развилки 14% на кусок; кольца из хабов умеренно (12%, 30–70 м),
  // бесконечный участок — редко (2%, 16–28 м, не ближе 16 м к хабу)
  { hubEvery: [24, 48], turn: 0.12, branch: 0.14, storage: 0.75, ring: 0.12, ringLen: [30, 70], loop: 0.02, loopLen: [16, 28], loopMinDist: 16 }, 1);
}

// sanatorium
/** Санаторий — сеть коридоров из своих комнат (src/data/roomsSanatorium.ts). */
const SANATORIUM_TAGS: [string, number][] = [['санаторий', 1]];

/** Санаторий: обычное трёхмерное здание без 4D (Biome.flat) — коридоры-галереи 3 м с красной дорожкой и окнами в тюле,
 *  палаты, процедурные (водолечебница, грязи, душ Шарко, массаж), столовая, комнаты в ремонте; хабы — вестибюль (вход и
 *  выход — двери к корпусам 'stair') и зал бассейна. Отделка — по тегу помещения (правила 'санаторий' нет — иначе оно бы
 *  победило). Залы до 18×14 м: без предела обзора (sightM 0 — складок нет, обзор ничему не мешает). */
function sanatoriumBiome(): Biome {
  const { note, ...rest } = T('sanatorium', 'Санаторий', '#7fb3a6', [
    rule('коридор', [['f_san_wall_teal', 1]], [['f_san_parquet', 1]]),
    rule('вестибюль', [['f_san_plaster', 1]], [['f_san_terrazzo', 1]]),
    rule('бассейн', [['f_san_pool_wall', 1]], [['f_san_pool_floor', 1]]),
    rule('палата', [['f_san_plaster', 3], ['f_san_wall_teal', 1]], [['f_san_parquet', 1]]),
    rule('ремонт', [['f_san_reno_wall', 1]], [['f_san_boards_yellow', 1]]),
    rule('водолечебница', [['f_san_wood_panel', 1]], [['f_metlakh', 1]]),
    rule('грязелечебница', [['f_san_tile_white', 1]], [['f_metlakh', 1]]),
    rule('душ', [['f_san_tile_white', 1]], [['f_metlakh', 1]]),
    rule('кабинет', [['f_san_wall_teal', 1]], [['f_san_parquet', 1]]),
    rule('столовая', [['f_san_plaster', 1]], [['f_san_parquet', 1]]),
  ], 'Санаторий: обычное трёхмерное здание без 4D-сдвигов — пошёл налево, ещё налево и ещё — вернёшься, только если ' +
    'коридоры по-настоящему сомкнулись. Длинные коридоры-галереи 3 м: красная ковровая дорожка по паркету «ёлочкой», ' +
    'окна в белом тюле с бирюзовыми ламбрекенами, фикусы и пальмы в кадках, банкетки; палаты, процедурные — водолечебница ' +
    'с кафельной ванной, грязелечебница, душ Шарко, массаж; столовая; комнаты в ремонте. Хабы — вестибюль с регистратурой ' +
    '(вход и выход — двери к корпусам) и огромный зал бассейна под бетонными сводами.',
  SANATORIUM_TAGS,
  // длинные прямые: поворот 10%, развилка 8% на кусок; хаб через 60–140 м; 75% дверей палат открываются; колец и
  // бесконечных участков нет (flat гарантирует это и сам)
  { hubEvery: [60, 140], turn: 0.1, branch: 0.08, storage: 0.75, ring: 0, ringLen: [30, 60], loop: 0, loopLen: [16, 30], loopMinDist: 30 });
  // обзор 50 м, без предела обзора, евклидов рост (flat); порядок полей — как у normBiome
  return { ...rest, viewM: 50, sightM: 0, flat: true, note };
}

/** Биомы по умолчанию (свежие объекты при каждом вызове). */
export function defaultBiomes(): Biome[] {
  return [
    B('khrush', 'Хрущёвки', '#c8a25a', [
      ['лестница', 1], ['лифт', 0.4], ['коридор', 0.3], ['прихожая', 1], ['кухня', 1], ['санузел', 1], ['жилая', 1],
      ['балкон', 1], ['кладовка', 1], ['служебное', 0.2], ['спуск', 0.5],
    ], 'Подъезды пятиэтажек 1-464, 1-335, 1-447: площадки, марши, квартиры. «Спуск в подвал» — вход в подвал.'),
    B('malosem', 'Малосемейки', '#7fa7c9', [
      ['коридор', 2], ['лестница', 0.4], ['лифт', 1], ['прихожая', 0.8], ['кухня', 0.5], ['санузел', 0.8], ['жилая', 0.7],
      ['кладовка', 0.5], ['служебное', 1], ['спуск', 0.4],
    ], 'Коридорные дома: длинные поэтажные коридоры, гостинки, служебные комнаты.'),
    B('dorm', 'Общежитие', '#9bbf6a', [
      ['общежитие', 3], ['коридор', 0.5], ['лестница', 0.3], ['служебное', 1], ['санузел', 0.2], ['спуск', 0.3],
    ], 'Общежитие коридорного типа: вестибюль, коридоры, комнаты на двоих-троих, общие кухни и умывальные.'),
    T('basement', 'Подвал', '#a8876a', [
      rule('подвал', [['f_bsm_brick', 5], ['f_concrete', 1]], [['f_bsm_concrete', 1]]),
      rule('кладовка', [['f_bsm_planks', 3], ['f_bsm_brick', 2]], [['f_bsm_boards', 2], ['f_bsm_concrete', 1]]),
      rule('служебное', [['f_bsm_brick', 2], ['f_whitewash', 1]], [['f_bsm_concrete', 1]]),
    ], 'Сухой подвал: длинные ходы в кирпиче с побелкой, кладовые жильцов, редкие узлы. Вход и выход — через хабы.'),
    T('basement_blue', 'Подвал заброшенный', '#5f7f95', [
      rule('подвал', [['f_bsm_plaster', 5], ['f_bsm_brick', 1]], [['f_bsm_concrete', 3], ['f_bsm_boards', 1]]),
      rule('кладовка', [['f_bsm_planks', 3], ['f_bsm_plaster', 2]], [['f_bsm_boards', 1]]),
      rule('служебное', [['f_bsm_plaster', 2], ['f_bsm_brick', 1]], [['f_bsm_concrete', 1]]),
    ], 'Брошенный подвал: синяя облупленная штукатурка, строительный мусор, обломки.'),
    T('basement_wet', 'Подвал затопленный', '#6f8a5c', [
      rule('подвал', [['f_bsm_damp', 5], ['f_bsm_brick', 1]], [['f_bsm_water', 3], ['f_bsm_damp_floor', 2]]),
      rule('кладовка', [['f_bsm_damp', 3], ['f_bsm_planks', 1]], [['f_bsm_damp_floor', 2], ['f_bsm_boards', 1]]),
      rule('служебное', [['f_bsm_damp', 1]], [['f_bsm_damp_floor', 1]]),
    ], 'Затопленный подвал: сырой бетон с плесенью, вода по полу, лужи, настилы.'),
    T('barn', 'Сарай', '#9a7a4a', [
      rule('сарай', [['f_barn_vertical', 5], ['f_barn_rust', 3], ['f_barn_horizontal', 2]], [['f_barn_floor', 3], ['f_barn_floor_grey', 2]]),
    ], 'Бесконечный трухлявый сарай: длинные тёмные проходы 1.5 м — гирлянда по одной стене, с другой ряд открытых стойл ' +
      '(перегородки, ясли), иногда вместо стойла проход дальше. Хабы — двор, верхняя комната, конюшня. Вход — переходом, ' +
      'выход — лестницей хаба наверх.', BARN_TAGS, { hubEvery: [60, 140], turn: 0.06, branch: 0.12 }, 0.85),
    factoryBiome(),
    T('snow', 'Снежные тоннели', '#c9d6e6', [rule('снег', [['f_snow', 1]], [['f_snow_floor', 1]])],
      'Лазы под снегом: ползком, ходы виляют влево-вправо, ныряют вниз и лезут вверх, много развилок, вдаль не видно. ' +
      'Берлоги — стоять скрючившись. Обвалы заваливают лазы навсегда. Выход — подтаявший снег в полу редкой берлоги ' +
      '(через 60–150 м ползком): пробить — провалишься в ангар. Вход — переходом.',
      SNOW_TAGS, { hubEvery: [60, 150], turn: 0.32, branch: 0.24, storage: 0.4, ring: 0.3, ringLen: [24, 60], loop: 0.02 }, 0.9),
    obshagaBiome(),
    // metro
    metroBiome(),
    // cellar
    cellarBiome(),
    // catacombs
    catacombsBiome(),
    // sanatorium
    sanatoriumBiome(),
    B('rich', 'Богатая квартира', '#d06a4e', [
      ['прихожая', 1], ['кухня', 1], ['санузел', 1], ['жилая', 1.5], ['балкон', 1], ['кладовка', 1], ['коридор', 0.2],
    ], 'Сюда ведут переходы: квартира с усиленной элитностью (richBoost), выходы — в обычные квартиры биома, откуда пришли.', true),
  ];
}

export const DEFAULT_TUNNELS: TunnelSettings = {
  hubEvery: [40, 100],
  turn: 0.12,
  branch: 0.1,
  storage: 0.45,
  ring: 0.4,
  ringLen: [30, 80],
  loop: 0.05,
  loopLen: [16, 30],
  loopMinDist: 12,
  pieceWeights: {},
};

/** Метки «наружу» по умолчанию: входная дверь квартиры, двустворчатые двери коридоров и площадок, марши, ходы подвала. */
export const DEFAULT_OUTER_TAGS: readonly string[] = ['landing>apt', 'apt>landing', 'corridor', 'stair', 'basement'];

/** 4D и обзор «Прогулки» по умолчанию: складок много (бесшовность даёт портальный рендер), соседи по порогу не
 *  пересекаются, слоёв сколько угодно, предел обзора 9 м («давящее» пространство), вперёд — 2 двери. */
export const DEFAULT_WALK_GEN: WalkGenSettings = {
  shiftChance: 0.8,
  maxShift: 4,
  localRadius: 1,
  localM: 6,
  maxLayer: 1000,
  sightM: 9,
  aheadDoors: 2,
};

export const DEFAULT_WORLD: WorldSettings = {
  clusterRooms: [6, 15],
  clusterExits: [2, 10],
  exitReserve: 1,
  entrySpare: 2,
  seamEntries: true,
  outerTags: [...DEFAULT_OUTER_TAGS],
  trAfter: 50,
  trBase: 0.1,
  trStep: 0.01,
  trToBiome: 0.7,
  trLanding: 0.4,
  transitionMinLen: 0.7,
  richBoost: 8,
  biomes: [],
  startBiome: 'khrush',
  tunnels: DEFAULT_TUNNELS,
  walk: DEFAULT_WALK_GEN,
};

const cloneTunnels = <T extends Partial<TunnelSettings>>(t: T): T => ({
  ...t,
  ...(t.hubEvery ? { hubEvery: [t.hubEvery[0], t.hubEvery[1]] } : {}),
  ...(t.ringLen ? { ringLen: [t.ringLen[0], t.ringLen[1]] } : {}),
  ...(t.loopLen ? { loopLen: [t.loopLen[0], t.loopLen[1]] } : {}),
  ...(t.pieceWeights ? { pieceWeights: { ...t.pieceWeights } } : {}),
});
const cloneApt = <T extends Partial<ApartmentSettings>>(a: T): T => ({
  ...a,
  ...(a.clusterRooms ? { clusterRooms: [a.clusterRooms[0], a.clusterRooms[1]] } : {}),
  ...(a.clusterExits ? { clusterExits: [a.clusterExits[0], a.clusterExits[1]] } : {}),
});
const cloneRule = (r: FinishRule): FinishRule => ({ tag: r.tag, wall: r.wall.map((x) => ({ ...x })), floor: r.floor.map((x) => ({ ...x })) });
export const cloneBiome = (b: Biome): Biome => ({
  ...b,
  tags: b.tags.map((t) => ({ ...t })),
  ...(b.finishRules ? { finishRules: b.finishRules.map(cloneRule) } : {}),
  ...(b.apartments ? { apartments: cloneApt(b.apartments) } : {}),
  ...(b.tunnels ? { tunnels: cloneTunnels(b.tunnels) } : {}),
  ...(b.wet ? { wet: { ...b.wet } } : {}),
});

export function newWorldSettings(): WorldSettings {
  return {
    ...cloneApt(DEFAULT_WORLD),
    outerTags: [...DEFAULT_OUTER_TAGS],
    biomes: defaultBiomes(),
    tunnels: cloneTunnels(DEFAULT_TUNNELS),
    walk: { ...DEFAULT_WALK_GEN },
  };
}

export function cloneWorld(w: WorldSettings): WorldSettings {
  return {
    ...cloneApt(w),
    outerTags: [...w.outerTags],
    biomes: w.biomes.map(cloneBiome),
    tunnels: cloneTunnels(w.tunnels),
    walk: { ...w.walk },
  };
}

/** Тег комнат «Спуск в подвал» (выход квартиры прямо в подвал — в обход бесконечной лестницы). */
const DESCENT_TAG = 'спуск';

/**
 * Мир сюжета (режим «Запустить без отладки», src/game/story.ts): story — true, старт — STORY_START. Биомы — только те,
 * что нужны сюжету (storyBiomes), в его порядке: свои из w (правки автора), недостающие — из пресетов; заглушка
 * (STORY_PLACEHOLDER: погреб — подвал) — копия биома-образца со своим id и названием шага, только если биома с этим id
 * нет ни в w, ни в пресетах (настоящий биом заглушку заменяет; presets — пресеты, по умолчанию defaultBiomes()). Богатых квартир и прочих биомов нет — переходы ведут только по сюжету (StreamWorld: storyNext), лестничных
 * площадок-переходов тоже (trLanding 0). У квартир нет «Спуска в подвал» (тег 'спуск'): в подвал — только бесконечной
 * лестницей. Остальные параметры (квартиры, счётчик переходов, ходы, 4D) — из w. w не меняется.
 */
export function storyWorld(w: WorldSettings, presetBiomes: readonly Biome[] = defaultBiomes()): WorldSettings {
  const base = cloneWorld(w);
  const own = new Map(base.biomes.map((b) => [b.id, b] as const));
  const presets = new Map(presetBiomes.map((b) => [b.id, cloneBiome(b)] as const));
  const biomes: Biome[] = [];
  for (const id of storyBiomes()) {
    let b = own.get(id) ?? presets.get(id);
    const ph = STORY_PLACEHOLDER[id];
    if (!b && ph) {
      const src = own.get(ph) ?? presets.get(ph);
      if (src) {
        b = {
          ...cloneBiome(src), id, name: storyStep(id)?.title ?? id, color: '#7a5c3e',
          note: `Заглушка сюжета: пока растёт комнатами и отделкой биома «${src.name}». ${src.note}`,
        };
      }
    }
    if (!b || b.rich) continue;
    biomes.push(isTunnels(b) ? b : { ...b, tags: b.tags.filter((t) => t.tag !== DESCENT_TAG) });
  }
  return { ...base, story: true, startBiome: STORY_START, trLanding: 0, biomes };
}

/** Параметры квартир биома: свои (Biome.apartments) поверх общих. */
export function aptOf(w: WorldSettings, biome: string | null | undefined): ApartmentSettings {
  const o = biome ? w.biomes.find((b) => b.id === biome)?.apartments : undefined;
  return {
    clusterRooms: o?.clusterRooms ?? w.clusterRooms,
    clusterExits: o?.clusterExits ?? w.clusterExits,
    exitReserve: o?.exitReserve ?? w.exitReserve,
    entrySpare: o?.entrySpare ?? w.entrySpare,
    seamEntries: o?.seamEntries ?? w.seamEntries,
  };
}

/** Параметры ходов подвала биома: свои (Biome.tunnels) поверх общих; множители кусков — свои поверх общих. */
export function tunOf(w: WorldSettings, biome: string | null | undefined): TunnelSettings {
  const o = biome ? w.biomes.find((b) => b.id === biome)?.tunnels : undefined;
  if (!o) return w.tunnels;
  return { ...w.tunnels, ...o, pieceWeights: { ...w.tunnels.pieceWeights, ...(o.pieceWeights ?? {}) } };
}

export type TunnelKind = 'hub' | 'straight' | 'turn' | 'branch' | 'storage';
/** Проход хода подвала — метка ('basement', 1.0 м); «Спуск в подвал» — выход квартиры с этой меткой. */
export const TUNNEL_TAG = 'basement';
// metro: метки сетей метро (src/data/roomsMetro.ts, §24). Проходы — ось зала, переходы, служебные ходы и торцы
// эскалатора (направленная пара: тоннель встаёт только между залами у эскалатора); дверь служебного помещения — как
// кладовая (шанс storage); проёмы между сетями (зал ↔ переход через пути, переход ↔ служебный ход) — растут всегда
const METRO_PASS = ['metro_hall', 'metro_per', 'metro_slu', 'esc>hall', 'hall>esc'];
const METRO_STORE = ['room>slu'];
const METRO_SIDE = ['slu>room'];
const METRO_DOORS = ['hall>per', 'per>hall', 'per>slu', 'slu>per'];
// cellar: метки погреба (src/data/roomsCellar.ts, §25): ходы 0.6 м между собой; щель 0.4 м из хода в клетушку — как
// кладовая подвала (шанс storage)
const CELLAR_PASS = ['cellar'];
const CELLAR_STORE = ['bin>cellar'];
const CELLAR_SIDE = ['cellar>bin'];
// catacombs: метки катакомб (src/data/roomsCatacombs.ts): ходы 2.0 м и лазы 0.8 м — одна сеть (устье лаза — кусок с
// обеими метками); проём хода в нишу-убежище — как кладовая подвала (шанс storage)
const CAT_PASS = ['catacombs', 'cat_duct'];
const CAT_STORE = ['refuge>catacombs'];
const CAT_SIDE = ['catacombs>refuge'];
// sanatorium: метки санатория (src/data/roomsSanatorium.ts): проход сети — коридоры и хабы 'sanat' (3.0 м); дверь палаты
// (комнаты в ремонте) — как кладовая подвала (шанс storage); дверь процедурной / общего помещения 'sanat>proc' — растёт
// всегда (любой совместимой комнатой биома, как служебка)
const SAN_PASS = ['sanat'];
const SAN_STORE = ['room>sanat'];
const SAN_SIDE = ['sanat>room'];
const SAN_DOORS = ['sanat>proc'];
/** Проходы сетей ходов: подвал — 'basement' (1.0 м), сарай — 'barn' (1.5 м), снег — 'snow' (лаз 1.2 м), завод —
 *  'factory' (2.0 м), общага — коридоры 'obshaga' (2.0 м) и ходы затопленного подвала 'obshaga_bsm' (1.6 м). Сети друг
 *  с другом не стыкуются. */
export const TUNNEL_PASS_TAGS: ReadonlySet<string> = new Set([TUNNEL_TAG, 'barn', 'snow', 'factory', 'obshaga', 'obshaga_bsm', ...METRO_PASS, ...CELLAR_PASS, ...CAT_PASS, ...SAN_PASS]);
/** Дверь бокового помещения (кладовая подвала, комната общаги) — со стороны помещения: по ней кусок — «кладовая». */
export const TUNNEL_STORE_TAGS: ReadonlySet<string> = new Set(['storage>basement', 'den>snow', 'room>obshaga', ...METRO_STORE, ...CELLAR_STORE, ...CAT_STORE, ...SAN_STORE]);
/** Дверь хода в боковое помещение (кладовая, комната общаги) — со стороны хода: за ней с шансом tunnels.storage —
 *  помещение, иначе дверь заперта (тупик). */
export const TUNNEL_SIDE_TAGS: ReadonlySet<string> = new Set(['basement>storage', 'snow>den', 'obshaga>room', ...METRO_SIDE, ...CELLAR_SIDE, ...CAT_SIDE, ...SAN_SIDE]);
/** Метки кусков роста ходов (кроме хабов): проходы, двери в боковые помещения, дверь в служебку, двери коридора общаги
 *  в общее помещение (кухня, туалет, душевая, прачечная) и на лестничную клетку — растут всегда, как служебка. */
const TUNNEL_DOORS: ReadonlySet<string> = new Set([...TUNNEL_PASS_TAGS, ...TUNNEL_SIDE_TAGS, 'corridor>service', 'obshaga>common', 'obshaga>stairs', ...METRO_DOORS, ...SAN_DOORS]);

/** Вид комнаты в сети ходов: хаб (тег «хаб»), кладовая (дверь к ходу 'storage>basement'), прямой (два
 *  прохода на противоположных стенах), поворот (на соседних), развилка (три и больше); null — не кусок хода. */
export function tunnelKind(room: Room): TunnelKind | null {
  if (room.tags.includes('хаб')) return 'hub';
  if (room.connectors.some((c) => c.len >= 1 && TUNNEL_STORE_TAGS.has(c.tag))) return 'storage';
  if (!room.connectors.every((c) => c.len < 1 || TUNNEL_DOORS.has(c.tag))) return null;
  const t = room.connectors.filter((c) => c.len >= 1 && TUNNEL_PASS_TAGS.has(c.tag));
  if (t.length >= 3) return 'branch';
  if (t.length !== 2) return null;
  const opp: Record<string, string> = { N: 'S', S: 'N', E: 'W', W: 'E' };
  return t[0].side === opp[t[1].side] ? 'straight' : 'turn';
}

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clampN = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function range(v: unknown, d: readonly [number, number], lo: number, hi: number): [number, number] {
  if (!Array.isArray(v) || v.length < 2 || !fin(v[0]) || !fin(v[1])) return [d[0], d[1]];
  const a = clampN(Math.round(v[0]), lo, hi), b = clampN(Math.round(v[1]), lo, hi);
  return a <= b ? [a, b] : [b, a];
}

/** Толерантный разбор биома: без id — null. */
export function normBiome(v: unknown): Biome | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== 'string' || !o.id) return null;
  const tags = Array.isArray(o.tags)
    ? o.tags
        .filter((t): t is { tag: unknown; mul: unknown } => !!t && typeof t === 'object')
        .map((t) => ({ tag: String(t.tag ?? '').trim(), mul: fin(t.mul) ? clampN(t.mul, 0, 100) : 1 }))
        .filter((t) => t.tag)
    : [];
  const rows = (v: unknown) =>
    Array.isArray(v)
      ? v
          .filter((x): x is { finishId: unknown; weight: unknown } => !!x && typeof x === 'object')
          .map((x) => ({ finishId: String(x.finishId ?? ''), weight: fin(x.weight) ? Math.max(0, x.weight) : 1 }))
          .filter((x) => x.finishId)
      : [];
  const finishRules = Array.isArray(o.finishRules)
    ? o.finishRules
        .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object' && typeof (r as { tag?: unknown }).tag === 'string')
        .map((r) => ({ tag: String(r.tag), wall: rows(r.wall), floor: rows(r.floor) }))
    : null;
  const apartments = normApt(o.apartments, true);
  const tunnels = normTunnelsPart(o.tunnels);
  return {
    id: o.id,
    name: typeof o.name === 'string' && o.name ? o.name : o.id,
    color: typeof o.color === 'string' && /^#[0-9a-f]{6}$/i.test(o.color) ? o.color : '#9a9a9a',
    tags,
    ...(o.rich === true ? { rich: true as const } : {}),
    ...(o.layout === 'tunnels' ? { layout: 'tunnels' as const } : {}),
    ...(finishRules && finishRules.length ? { finishRules } : {}),
    ...(Object.keys(apartments).length ? { apartments } : {}),
    ...(Object.keys(tunnels).length ? { tunnels } : {}),
    ...(fin(o.dark) && o.dark > 0 ? { dark: clampN(o.dark, 0, 1) } : {}),
    ...(normWet(o.wet) ? { wet: normWet(o.wet)! } : {}),
    ...(fin(o.viewM) && o.viewM > 0 ? { viewM: clampN(o.viewM, 1, 200) } : {}),
    // свой предел обзора: 0 — без предела (в отличие от viewM ноль — значение, а не «нет поля»)
    ...(fin(o.sightM) && o.sightM >= 0 ? { sightM: clampN(o.sightM, 0, 200) } : {}),
    // sanatorium: евклидов рост без 4D-сдвигов — только true (нет поля / мусор — как раньше)
    ...(o.flat === true ? { flat: true } : {}),
    note: typeof o.note === 'string' ? o.note : '',
  };
}

/** Параметры квартир: part — только заданные поля (свои у биома), иначе — все с умолчаниями. */
function normApt(v: unknown, part: true): Partial<ApartmentSettings>;
function normApt(v: unknown, part?: false): ApartmentSettings;
function normApt(v: unknown, part = false): Partial<ApartmentSettings> {
  const D = DEFAULT_WORLD;
  const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const out: Partial<ApartmentSettings> = {};
  if (!part || o.clusterRooms !== undefined) out.clusterRooms = range(o.clusterRooms, D.clusterRooms, 1, CLUSTER_MAX);
  if (!part || o.clusterExits !== undefined) out.clusterExits = range(o.clusterExits, D.clusterExits, EXITS_LIM[0], EXITS_LIM[1]);
  if (!part || o.exitReserve !== undefined) out.exitReserve = fin(o.exitReserve) ? clampN(o.exitReserve, 0, 1) : D.exitReserve;
  if (!part || o.entrySpare !== undefined) out.entrySpare = fin(o.entrySpare) ? clampN(Math.round(o.entrySpare), 0, 8) : D.entrySpare;
  if (!part || o.seamEntries !== undefined) out.seamEntries = typeof o.seamEntries === 'boolean' ? o.seamEntries : D.seamEntries;
  return out;
}

/** Множители кусков: id → число ≥ 0. */
function normWeights(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (k && fin(x)) out[k] = clampN(x, 0, 100);
  return out;
}

/** Свои параметры ходов биома: только заданные поля. */
function normTunnelsPart(v: unknown): Partial<TunnelSettings> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const o = v as Record<string, unknown>;
  const full = normTunnels(v);
  const out: Partial<TunnelSettings> = {};
  for (const k of Object.keys(full) as (keyof TunnelSettings)[]) if (o[k] !== undefined) (out as Record<string, unknown>)[k] = full[k];
  return out;
}

/** Толерантный разбор 4D и обзора прогулки. */
export function normWalkGen(v: unknown): WalkGenSettings {
  const D = DEFAULT_WALK_GEN;
  const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const n = (x: unknown, d: number, lo: number, hi: number, int = false) => (fin(x) ? clampN(int ? Math.round(x) : x, lo, hi) : d);
  return {
    shiftChance: n(o.shiftChance, D.shiftChance, 0, 1),
    maxShift: n(o.maxShift, D.maxShift, 0, 64, true),
    localRadius: n(o.localRadius, D.localRadius, 1, 16, true),
    localM: n(o.localM, D.localM, 0, 100),
    maxLayer: n(o.maxLayer, D.maxLayer, 0, 1000, true),
    sightM: n(o.sightM, D.sightM, 0, 200),
    aheadDoors: n(o.aheadDoors, D.aheadDoors, 0, 16, true),
  };
}

/** Толерантный разбор настроек ходов: мусор — по умолчанию, длины ≥ 4 м, упорядочены; шансы — 0…1. */
export function normTunnels(v: unknown): TunnelSettings {
  const D = DEFAULT_TUNNELS;
  const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const p = (x: unknown, d: number) => (fin(x) ? clampN(x, 0, 1) : d);
  return {
    hubEvery: range(o.hubEvery, D.hubEvery, 4, 10000),
    turn: p(o.turn, D.turn),
    branch: p(o.branch, D.branch),
    storage: p(o.storage, D.storage),
    ring: p(o.ring, D.ring),
    ringLen: range(o.ringLen, D.ringLen, 8, 1000),
    loop: p(o.loop, D.loop),
    loopLen: range(o.loopLen, D.loopLen, 6, 200),
    loopMinDist: fin(o.loopMinDist) ? clampN(o.loopMinDist, 0, 1000) : D.loopMinDist,
    pieceWeights: normWeights(o.pieceWeights),
  };
}

/**
 * Толерантный разбор настроек мира (загрузка проекта, сохранение мира): мусор и пропуски — по умолчанию; комнат в
 * квартире 1…15, выходов 1…10 (целые, упорядочены); шансы — 0…1; биомов нет — пресеты.
 */
export function normWorld(v: unknown): WorldSettings {
  const D = DEFAULT_WORLD;
  if (!v || typeof v !== 'object' || Array.isArray(v)) return newWorldSettings();
  const o = v as Record<string, unknown>;
  const seen = new Set<string>();
  const biomes = Array.isArray(o.biomes)
    ? o.biomes.map(normBiome).filter((b): b is Biome => !!b && !seen.has(b.id) && !!seen.add(b.id))
    : defaultBiomes();
  const start = typeof o.startBiome === 'string' ? o.startBiome : o.startBiome === null ? null : D.startBiome;
  const tags = Array.isArray(o.outerTags) ? [...new Set(o.outerTags.map((t) => String(t).trim()).filter(Boolean))] : [...DEFAULT_OUTER_TAGS];
  return {
    ...normApt(o),
    outerTags: tags,
    trAfter: fin(o.trAfter) ? clampN(Math.round(o.trAfter), 0, 100000) : D.trAfter,
    trBase: fin(o.trBase) ? clampN(o.trBase, 0, 1) : D.trBase,
    trStep: fin(o.trStep) ? clampN(o.trStep, 0, 1) : D.trStep,
    trToBiome: fin(o.trToBiome) ? clampN(o.trToBiome, 0, 1) : D.trToBiome,
    trLanding: fin(o.trLanding) ? clampN(o.trLanding, 0, 1) : D.trLanding,
    transitionMinLen: fin(o.transitionMinLen) ? clampN(o.transitionMinLen, 0.1, 10) : D.transitionMinLen,
    richBoost: fin(o.richBoost) ? clampN(o.richBoost, 1, 1000) : D.richBoost,
    biomes,
    startBiome: start && biomes.some((b) => b.id === start) ? start : null,
    tunnels: normTunnels(o.tunnels),
    walk: normWalkGen(o.walk),
    // сюжет — только если включён (мир «Прогулки» без поля — прежний)
    ...(o.story === true ? { story: true } : {}),
  };
}

/** Тег комнаты «только в биоме» (= BIOME_ONLY_TAG, src/gen/generate.ts; здесь строкой — без зависимости от генератора). */
const ONLY_TAG = 'только-биом';

/** Множитель веса комнаты в биоме: наибольший среди её тегов (0 — комната в биоме не растёт). Комната «только в биоме»
 *  растёт лишь в биомах её группы (первый тег в списке биома): коридор общаги (теги «общага», «коридор») не попадает в
 *  малосемейки по тегу «коридор», её подвал — в подвалы. */
export function biomeMul(b: Biome, room: Room): number {
  if (room.tags.includes(ONLY_TAG) && !b.tags.some((t) => t.tag === room.tags[0] && t.mul > 0)) return 0;
  let m = 0;
  for (const t of b.tags) if (room.tags.includes(t.tag) && t.mul > m) m = t.mul;
  return m;
}

/** Предел обзора биома, м (Biome.sightM): нет поля — общий sightM мира (WalkGenSettings.sightM); 0 — без предела. */
export function biomeSightM(b: Biome | null | undefined, sightM: number): number {
  return b && fin(b.sightM) && b.sightM >= 0 ? b.sightM : sightM;
}

/** Есть ли в мире биом со своим пределом обзора, отличным от общего (нет — пул и рост в точности прежние). */
export const ownSightBiomes = (w: WorldSettings | null | undefined, sightM: number): boolean =>
  !!w && w.biomes.some((b) => biomeSightM(b, sightM) !== sightM);

/**
 * Предел обзора комнаты в мире, м (0 — без предела): самый мягкий из пределов мест, где она растёт, — биомов, где её
 * множитель > 0 (biomeMul; свой Biome.sightM или общий), и общего sightM, если комната не «только в биоме» (она растёт
 * и запасным ростом «из всех комнат»). Комната «только в биоме», не растущая ни в одном биоме, — общий предел. У биомов
 * без своего предела — общий sightM у всех комнат (как раньше).
 */
export function roomSightLimit(w: WorldSettings, room: Room, sightM: number): number {
  let lim = room.tags.includes(ONLY_TAG) ? -1 : sightM;
  for (const b of w.biomes) {
    if (biomeMul(b, room) <= 0) continue;
    const v = biomeSightM(b, sightM);
    if (!(v > 0)) return 0;
    lim = lim < 0 ? v : lim === 0 ? 0 : Math.max(lim, v);
  }
  return lim < 0 ? sightM : lim;
}

/** Обычные (не «богатые») биомы — квартирные и подвалы. */
export function plainBiomes(w: WorldSettings): Biome[] {
  return w.biomes.filter((b) => !b.rich);
}

/** Биом растёт сетью ходов (подвал). */
export const isTunnels = (b: Biome | null | undefined): boolean => b?.layout === 'tunnels';

/** sanatorium: сеть ходов биома растёт евклидово, без 4D-сдвигов (Biome.flat; квартирные биомы флаг не меняет). */
export const isFlat = (b: Biome | null | undefined): boolean => b?.flat === true && isTunnels(b);

/** Подвалы мира (биомы с сетью ходов). */
export function tunnelBiomes(w: WorldSettings): Biome[] {
  return w.biomes.filter((b) => isTunnels(b) && !b.rich);
}

/** Куда ведёт «Спуск в подвал» (выход квартиры с меткой хода tag): биомы-ходы, у которых есть хаб с проходом этой
 *  метки (подвалы — да, сарай с проходами 'barn' — нет). */
export function descentBiomes(w: WorldSettings, rooms: readonly Room[], tag: string): Biome[] {
  return tunnelBiomes(w).filter((b) => rooms.some((r) => r.gen.weight > 0 && biomeMul(b, r) > 0 && tunnelKind(r) === 'hub' && r.connectors.some((c) => c.len >= 1 && c.tag === tag)));
}

/** Квартирные обычные биомы (куда ведут выходы из подвала, если не знаем, откуда в него пришли). */
export function apartmentBiomes(w: WorldSettings): Biome[] {
  return w.biomes.filter((b) => !isTunnels(b) && !b.rich);
}

/** Стартовый биом: заданный, иначе первый обычный, иначе первый любой; null — биомов нет. */
export function startBiomeOf(w: WorldSettings): Biome | null {
  return w.biomes.find((b) => b.id === w.startBiome) ?? plainBiomes(w)[0] ?? w.biomes[0] ?? null;
}

/** Шанс перехода для count-й пройденной комнаты: до trAfter включительно — 0, затем trBase + trStep·(k − 1), ≤ 1. */
export function transitionChance(w: WorldSettings, count: number): number {
  if (count <= w.trAfter) return 0;
  return Math.min(1, w.trBase + w.trStep * (count - w.trAfter - 1));
}

/** Строка правила для интерфейса. */
export function worldRule(w: WorldSettings): string {
  const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
  const [r0, r1] = w.clusterRooms, [e0, e1] = w.clusterExits;
  return `Квартира — ${r0 === r1 ? r0 : `${r0}–${r1}`} комнат и ${e0 === e1 ? e0 : `${e0}–${e1}`} закрытых выходов; открыл выход — новая квартира, ` +
    `остальные выходы исчезают. После ${w.trAfter} пройденных комнат каждая новая даёт шанс перехода ${pct(w.trBase)} и +${pct(w.trStep)} за следующую; ` +
    `выпал — переход будет прямо за следующей открытой дверью. Пропустил — исчезнет. Прошёл — счёт с нуля; ` +
    `переход ведёт в другой биом (${pct(w.trToBiome)}) или в богатую квартиру. Переход — лестничная площадка ` +
    `(${pct(w.trLanding)}: любая её дверь — туда) или спец-комната (лестница, лифт).` +
    (tunnelBiomes(w).length ? ' Подвалы растут ходами (правило подвала — отдельно).' : '');
}

/** Строка правила подвала для интерфейса. */
export function tunnelRule(t: TunnelSettings): string {
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const r = (a: [number, number]) => (a[0] === a[1] ? `${a[0]}` : `${a[0]}–${a[1]}`);
  return `Подвал — длинные ходы: хаб не ближе ${t.hubEvery[0]} м от прошлого (к ${t.hubEvery[1]} м — наверняка), поворот ${pct(t.turn)}, ` +
    `развилка ${pct(t.branch)}, кладовая за боковой дверью ${pct(t.storage)}. Из хаба ход кольцом ${pct(t.ring)} (${r(t.ringLen)} м, сквозь ` +
    `другие ходы в 4D), бесконечный прямой участок ${pct(t.loop)} (${r(t.loopLen)} м: дошёл до конца — снова в начале). ` +
    `В подвал — через «Спуск в подвал» или переход, наверх — дверью-маршем хаба.`;
}
