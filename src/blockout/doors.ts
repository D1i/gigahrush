// Двери: каталог (какая дверь в какой локации), выбор по метке стыковки и тегам комнаты, процедурные модели.
// Без зависимостей от приложения и движка — как и всё в src/blockout/. Подробно — docs/DOORS.md.
//
// Ядро болванки (core.ts, BlockoutOptions.doors) ставит у меток слоты дверей (DoorSlot): где проём, куда смотрит,
// какая дверь, где петли, открыта ли. Модель двери — набор боксов (DoorPart) в своих координатах; адаптер движка
// (babylon.ts) переводит их в меши. Свои модели художника можно ставить по тем же слотам (docs/DOORS.md §5).
//
// Координаты двери (метры): начало — середина низа проёма на грани стены со стороны комнаты-владельца;
//   x — вдоль стены вправо (если стоять в комнате лицом к двери), y — вверх, z — В стену (комната — z < 0).
// Координаты полотна: начало — ось петель у пола (на передней грани полотна); x — от петель к свободному краю
//   (у правых петель — в минус: детали отражены), y — вверх, z — как у двери: тело полотна z ∈ [0, t],
//   передняя сторона (в комнату) — z < 0, задняя — z > t.
// Полотно закрыто — висит ПЕРЕД гранью стены и перекрывает проём с запасом: закрытая дверь выглядит одинаково,
// есть за ней проём (дверь связана) или глухая стена (выход ещё не открыт). Поэтому открытие двери бесшовно:
// пока полотно закрыто, под ним меняется стена на проём, и этого не видно (docs/DOORS.md §4).
// Открывается полотно к игроку — в комнату-владельца: оно всегда по свою сторону стены (портальный рендер рисует
// его вместе с этой комнатой).

import type { DoorRole } from './types';

export type { DoorRole };

/** Ручка — то, что двигается перед распахом: нажимная ручка, круглая ручка, штурвал, засов, щеколда-вертушка. */
export type HandleKind = 'lever' | 'knob' | 'wheel' | 'bolt' | 'latch' | 'none';

export type DoorGroup = 'хрущёвка' | 'общага' | 'подвал' | 'сарай' | 'погреб' | 'снег' | 'завод'
  // metro
  | 'метро'
  // catacombs
  | 'катакомбы'
  // sanatorium
  | 'санаторий';

/** Вид полотна — какой построитель модели. */
export type DoorLook = 'dermantin' | 'panel' | 'flat' | 'glazed' | 'metal' | 'planks' | 'slats' | 'hermetic' | 'corrugated'
  // metro: глухая фальш-стена во весь проём (не открывается)
  | 'blind'
  // catacombs: закладка проёма (кирпич или бетон) и ржавая решётка лаза — не двери, не открываются, не заколачиваются
  | 'bricked' | 'grate';

export interface DoorStyle {
  id: string;
  name: string;
  /** где стоит (метки и комнаты) — для списка дверей */
  where: string;
  group: DoorGroup;
  look: DoorLook;
  leaves: 1 | 2;
  /** толщина полотна, м */
  thick: number;
  /** высота полотна, м; ниже проёма — над дверью заполнение (доски, фрамуга) */
  leafH?: number;
  /** сквозь полотно видно (решётка, калитка) — закрытой дверью (выход, тупик) ставится closedAlt */
  seeThrough?: boolean;
  closedAlt?: string;
  /** распахнутая дверь в покое, градусы (± разброс по месту) */
  rest: number;
  /** открытие: ручка, сколько длится отпирание и распах, с */
  anim: { handle: HandleKind; unlatchS: number; swingS: number };
  /** дверь закрывается сама (общага): полотно подвижно у всех ролей и твёрдое (коллайдер) — позу задаёт игра
   *  (BabylonBlockoutOptions.doorPose); иначе подвижны только выходы */
  selfClosing?: true;
  /** цвета полотна по вариантам (вариант — по месту двери) */
  colors: string[];
  /** наличник (или коробка-уголок у железных): ширина, толщина, цвет; null — без */
  casing: { w: number; t: number; color: string } | null;
  /** короткое описание модели — для списка */
  model: string;
}

/** Каталог дверей. Порядок — по цепочке локаций (docs/DOORS.md §2). */
export const DOOR_STYLES: DoorStyle[] = [
  // ── хрущёвка ──
  {
    id: 'apt_dermantin', name: 'Входная квартирная, дерматин', group: 'хрущёвка', look: 'dermantin', leaves: 1, thick: 0.06,
    where: 'вход в квартиру: apt>landing (полотно со стороны прихожей)', rest: 96,
    anim: { handle: 'lever', unlatchS: 0.42, swingS: 1.25 }, colors: ['#4c2620', '#2e2925', '#5a3a24'],
    casing: { w: 0.07, t: 0.02, color: '#6b5a48' },
    model: 'обивка дерматином с валиком по краю, ромбы из шнура и обойных гвоздей; глазок, два замка, номер снаружи, нажимная ручка',
  },
  {
    id: 'apt_wood', name: 'Входная деревянная, крашеная', group: 'хрущёвка', look: 'panel', leaves: 1, thick: 0.05,
    where: 'вход в квартиру: apt>landing', rest: 95,
    anim: { handle: 'lever', unlatchS: 0.36, swingS: 1.15 }, colors: ['#6e4a2f', '#5b3b2a', '#7a5b3c'],
    casing: { w: 0.07, t: 0.02, color: '#5d4532' },
    model: 'филёнчатое полотно под коричневой краской, глазок, замок, номер снаружи',
  },
  {
    id: 'apt_metal90', name: 'Входная железная («девяностые»)', group: 'хрущёвка', look: 'metal', leaves: 1, thick: 0.07,
    where: 'вход в квартиру: apt>landing', rest: 94,
    anim: { handle: 'lever', unlatchS: 0.5, swingS: 1.45 }, colors: ['#5b4d42', '#3f3a36', '#4d3f37'],
    casing: { w: 0.05, t: 0.03, color: '#2f2a26' },
    model: 'стальной лист «под молотковую краску» снаружи, вагонка изнутри, коробка-уголок, два замка, глазок',
  },
  {
    id: 'int_dg', name: 'Межкомнатная ДГ (глухая)', group: 'хрущёвка', look: 'panel', leaves: 1, thick: 0.04,
    where: 'прихожая → комната, проходная → спальня: hall>room, living>bedroom (полотно в комнате)', rest: 92,
    anim: { handle: 'lever', unlatchS: 0.2, swingS: 0.95 }, colors: ['#e7e1d3', '#d9d2bf', '#e9e4da'],
    casing: { w: 0.07, t: 0.018, color: '#efe9dc' },
    model: 'две филёнки, белая масляная краска, алюминиевая нажимная ручка',
  },
  {
    id: 'int_do', name: 'Межкомнатная ДО (остеклённая)', group: 'хрущёвка', look: 'glazed', leaves: 1, thick: 0.04,
    where: 'кухня: hall>kitchen (полотно в кухне); иногда комнаты', rest: 92,
    anim: { handle: 'lever', unlatchS: 0.2, swingS: 0.95 }, colors: ['#e8e2d4', '#dcd6c6'],
    casing: { w: 0.07, t: 0.018, color: '#efe9dc' },
    model: 'верх — рифлёное стекло в три ряда, низ — филёнка; белая краска',
  },
  {
    id: 'int_bath', name: 'Санузел (ДГ гладкая)', group: 'хрущёвка', look: 'flat', leaves: 1, thick: 0.04,
    where: 'ванная и туалет: hall>bath, hall>wc (полотно в прихожей — открывается наружу)', rest: 90,
    anim: { handle: 'lever', unlatchS: 0.22, swingS: 0.9 }, colors: ['#dfe4df', '#e4dfd3'],
    casing: { w: 0.06, t: 0.018, color: '#ebe6da' },
    model: 'гладкое полотно, вентиляционная решётка внизу, шпингалет изнутри',
  },
  {
    id: 'int_closet', name: 'Кладовка (узкая)', group: 'хрущёвка', look: 'flat', leaves: 1, thick: 0.035,
    where: 'кладовка: hall>closet (полотно в прихожей)', rest: 88,
    anim: { handle: 'knob', unlatchS: 0.18, swingS: 0.8 }, colors: ['#e2dccd', '#d6cfbd'],
    casing: { w: 0.05, t: 0.016, color: '#ebe6da' },
    model: 'гладкое узкое полотно с круглой ручкой и крючком',
  },
  {
    id: 'int_double', name: 'Двустворчатая остеклённая (в зал)', group: 'хрущёвка', look: 'glazed', leaves: 2, thick: 0.04,
    where: 'прихожая → проходной зал 1-464: hall>living (полотна в зале)', rest: 92,
    anim: { handle: 'lever', unlatchS: 0.22, swingS: 1.05 }, colors: ['#e8e2d4', '#ddd6c5'],
    casing: { w: 0.07, t: 0.018, color: '#efe9dc' },
    model: 'две створки по 0.6 с переплётом 2×3 стекла, нащельник, ручка на одной створке',
  },
  {
    id: 'balcony', name: 'Балконный блок', group: 'хрущёвка', look: 'glazed', leaves: 1, thick: 0.05,
    where: 'комната → балкон: room>balcony (полотно в комнате)', rest: 90,
    anim: { handle: 'lever', unlatchS: 0.3, swingS: 1.0 }, colors: ['#ebe8df', '#e2ddd0'],
    casing: { w: 0.06, t: 0.02, color: '#efebe2' },
    model: 'высокое остекление в два ряда, внизу глухая филёнка, верхний шпингалет',
  },
  {
    id: 'tambour', name: 'Тамбурная / на лестницу, двустворчатая', group: 'хрущёвка', look: 'glazed', leaves: 2, thick: 0.045,
    where: 'тамбур, коридор малосемейки, дверь на марш: corridor, stair (закрытые выходы)', rest: 95,
    anim: { handle: 'none', unlatchS: 0.15, swingS: 1.1 }, colors: ['#6a4d36', '#5d5440', '#4f5a4c'],
    casing: { w: 0.07, t: 0.02, color: '#4d3a2b' },
    model: 'две створки, сверху армированное стекло, ручки-скобы',
  },
  {
    id: 'dorm_room', name: 'Комната общежития', group: 'хрущёвка', look: 'panel', leaves: 1, thick: 0.04,
    where: 'коридор общежития → комната: dorm>corridor (полотно в комнате)', rest: 92,
    anim: { handle: 'lever', unlatchS: 0.3, swingS: 1.0 }, colors: ['#7b5a3d', '#6a4c34'],
    casing: { w: 0.07, t: 0.02, color: '#5f4632' },
    model: 'лакированное полотно с филёнками, номер со стороны коридора, накладной замок',
  },
  {
    id: 'service_metal', name: 'Служебная металлическая', group: 'хрущёвка', look: 'metal', leaves: 1, thick: 0.05,
    where: 'щитовая, колясочная, ЖЭК, тепловой узел: corridor>service (полотно в коридоре)', rest: 94,
    anim: { handle: 'lever', unlatchS: 0.4, swingS: 1.3 }, colors: ['#56685a', '#5e6466', '#6b6a5a'],
    casing: { w: 0.05, t: 0.03, color: '#3c443d' },
    model: 'крашеный стальной лист с рамкой, табличка, проушины с навесным замком',
  },
  // ── общага ──
  {
    id: 'obshaga_room', name: 'Дверь комнаты общаги', group: 'общага', look: 'flat', leaves: 1, thick: 0.04,
    where: 'коридор общаги → комната, кухня, туалет, душевая, прачечная, вахтёрская: room>obshaga, common>obshaga, ' +
      'vahter>hall (полотно в комнате); закрытые двери комнат общаги', rest: 90,
    anim: { handle: 'lever', unlatchS: 0.3, swingS: 1.0 }, colors: ['#7a3e22', '#b5832f', '#d6c9a0'], selfClosing: true,
    casing: { w: 0.07, t: 0.02, color: '#5f4632' },
    model: 'гладкая фанерная крашеная, жестяной номерок со стороны коридора, накладной замок, нажимная ручка',
  },
  // ── подвал ──
  {
    id: 'basement_metal', name: 'Подвальная железная', group: 'подвал', look: 'metal', leaves: 1, thick: 0.06,
    where: '«Спуск в подвал» (выход с меткой basement), марш наверх из хаба подвала (stair)', rest: 95,
    anim: { handle: 'bolt', unlatchS: 0.55, swingS: 1.55 }, colors: ['#6b4a36', '#5a4a3e', '#4e4740'],
    casing: { w: 0.05, t: 0.03, color: '#33291f' },
    model: 'ржавый лист с рёбрами, засов, проушины с замком, табличка «Подвал»',
  },
  {
    id: 'storage_lattice', name: 'Решётчатая дверь кладовки', group: 'подвал', look: 'slats', leaves: 1, thick: 0.04,
    where: 'кладовки жильцов в ходах: storage>basement (полотно в кладовке)', rest: 100, seeThrough: true, closedAlt: 'basement_metal',
    anim: { handle: 'latch', unlatchS: 0.3, swingS: 0.9 }, colors: ['#8a7556', '#7c6a4e', '#937f60'],
    casing: null,
    model: 'рама из бруса, рейки с просветами, раскос, навесной замок',
  },
  // ── сарай ──
  {
    id: 'barn_plank', name: 'Дощатая дверь сарая', group: 'сарай', look: 'planks', leaves: 1, thick: 0.045,
    where: 'выход из хаба сарая наверх (stair), закрытые двери сарая', rest: 100,
    anim: { handle: 'latch', unlatchS: 0.35, swingS: 1.1 }, colors: ['#7a6047', '#6d553f', '#86694b'],
    casing: { w: 0.1, t: 0.025, color: '#5c4835' },
    model: 'доски внахлёст разной ширины, две планки и раскос (Z), кованые полосы-петли, вертушка',
  },
  {
    id: 'barn_gate', name: 'Калитка стойла', group: 'сарай', look: 'slats', leaves: 1, thick: 0.04,
    where: 'стойла, курятник, загородки: stall>barn (полотно в стойле)', rest: 105, seeThrough: true, closedAlt: 'barn_plank',
    anim: { handle: 'latch', unlatchS: 0.25, swingS: 0.9 }, colors: ['#7f6449', '#735a42'],
    casing: null,
    model: 'широкие доски с просветами, обвязка и раскос, щеколда',
  },
  // ── дальше по цепочке (биомов ещё нет — модели готовы) ──
  {
    id: 'cellar_low', name: 'Низкая дверь погреба (лаз)', group: 'погреб', look: 'planks', leaves: 1, thick: 0.05, leafH: 1.55,
    where: 'погреб: закрытые выходы в комнатах с тегом «погреб»; над дверью — доски', rest: 98,
    // cellar: старые сырые доски — тёмные, серо-бурые (под фонарём не светлеют до белого)
    anim: { handle: 'latch', unlatchS: 0.4, swingS: 1.2 }, colors: ['#463c32', '#3e352c'],
    casing: { w: 0.1, t: 0.03, color: '#33291f' },
    model: 'низкое полотно из старых тёмных досок: сырость снизу, потёки, две ржавые полосы на заклёпках; над дверью заложено досками',
  },
  {
    id: 'snow_iced', name: 'Обледенелая дверь', group: 'снег', look: 'planks', leaves: 1, thick: 0.05,
    where: 'снежные тоннели: закрытые выходы в комнатах с тегом «снег»', rest: 96,
    anim: { handle: 'latch', unlatchS: 0.7, swingS: 1.5 }, colors: ['#6c5a48', '#5d5246'],
    casing: { w: 0.09, t: 0.025, color: '#4e4236' },
    model: 'доски под наледью: иней по краям, налипший снег внизу, сосульки с наличника',
  },
  {
    id: 'factory_hermetic', name: 'Гермодверь со штурвалом', group: 'завод', look: 'hermetic', leaves: 1, thick: 0.13,
    where: 'завод: закрытые выходы в комнатах с тегом «завод»', rest: 92,
    anim: { handle: 'wheel', unlatchS: 1.1, swingS: 2.2 }, colors: ['#6f7a6e', '#7a7767'],
    casing: { w: 0.12, t: 0.04, color: '#4d554c' },
    model: 'толстая стальная плита с ободом, штурвал, четыре задрайки, красная полоса',
  },
  {
    id: 'factory_gate', name: 'Цеховые ворота с калиткой', group: 'завод', look: 'corrugated', leaves: 2, thick: 0.06,
    where: 'завод: закрытые проходы цехов (метка factory, 2 м)', rest: 95,
    anim: { handle: 'bolt', unlatchS: 0.6, swingS: 2.0 }, colors: ['#7c8279', '#6f7468'],
    casing: { w: 0.1, t: 0.04, color: '#3f433d' },
    model: 'две створки из профлиста с рамой, калитка в левой створке, засов',
  },
  // ── метро (metro) ──
  {
    id: 'metro_door', name: 'Маятниковая дверь метро', group: 'метро', look: 'glazed', leaves: 2, thick: 0.05,
    where: 'метро: «Выход в город» вестибюлей (stair), закрытые переходы (metro_per, hall>per, per>hall)', rest: 92,
    anim: { handle: 'none', unlatchS: 0.15, swingS: 1.2 }, colors: ['#5b3d26', '#4d3422', '#6a4a2e'],
    casing: { w: 0.08, t: 0.03, color: '#c9c4b8' },
    model: 'две тяжёлые створки: дубовая обвязка, большое стекло в три ряда, филёнка внизу, мраморный наличник',
  },
  {
    id: 'metro_wall', name: 'Глухая стена с панно (метро)', group: 'метро', look: 'blind', leaves: 1, thick: 0.12,
    where: 'метро: закрытые широкие проходы — ось зала станции (metro_hall, 17.6 м), торцы эскалатора (esc>hall)', rest: 90,
    anim: { handle: 'none', unlatchS: 0.2, swingS: 1.5 }, colors: ['#dcd9d2', '#d2cec5'],
    casing: null,
    model: 'фальш-стена из мраморных плит во весь проём с цоколем и карнизом, посередине мозаичное панно: круг-эмблема, ' +
      'ступенчатые треугольники, полосы красного, чёрного и белого камня; не открывается',
  },
  // ── катакомбы (catacombs) ──
  {
    id: 'cat_bricked', name: 'Закладка кирпичом (катакомбы)', group: 'катакомбы', look: 'bricked', leaves: 1, thick: 0.12,
    where: 'катакомбы: закрытые ходы (catacombs, 2 м) и проёмы ниш-убежищ (catacombs>refuge)', rest: 90,
    anim: { handle: 'none', unlatchS: 0.2, swingS: 1.5 }, colors: ['#7a3f2e', '#6b3a2c', '#80493a'],
    casing: null,
    model: 'проём заложен красным кирпичом вперевязку: швы раствора, кирпичи разного тона, внизу — тёмная полоса ила и ' +
      'высолов; не открывается',
  },
  {
    id: 'cat_concrete', name: 'Бетонная заглушка (катакомбы)', group: 'катакомбы', look: 'bricked', leaves: 1, thick: 0.12,
    where: 'катакомбы: закрытые ходы (catacombs, 2 м) — вперемешку с кирпичной закладкой', rest: 90,
    anim: { handle: 'none', unlatchS: 0.2, swingS: 1.5 }, colors: ['#7d7b74', '#6f6d66'],
    casing: null,
    model: 'бетонная заглушка во весь проём: следы щитов опалубки, потёки, тёмная полоса ила снизу; не открывается',
  },
  {
    id: 'cat_grate', name: 'Ржавая решётка лаза (катакомбы)', group: 'катакомбы', look: 'grate', leaves: 1, thick: 0.05,
    where: 'катакомбы: закрытые лазы (cat_duct, 0.8×0.8 м)', rest: 90,
    anim: { handle: 'none', unlatchS: 0.2, swingS: 1.0 }, colors: ['#6e4a32', '#5d4130'],
    casing: null,
    model: 'ржавая решётка из прутьев в раме на заклёпках, за ней — темнота короба (глухая чёрная плита); не открывается',
  },
  // ── санаторий (sanatorium) ──
  {
    id: 'sanatorium_door', name: 'Дверь палаты санатория', group: 'санаторий', look: 'glazed', leaves: 1, thick: 0.045,
    where: 'санаторий: палаты, комнаты в ремонте, процедурные, столовая — room>sanat, proc>sanat (полотно в комнате); ' +
      'закрытые двери палат и процедурных', rest: 92,
    anim: { handle: 'lever', unlatchS: 0.28, swingS: 1.0 }, colors: ['#ecebe4', '#e6e3d8', '#efeee6'],
    casing: { w: 0.08, t: 0.022, color: '#e9e6db' },
    model: 'филёнчатое полотно под белой эмалью: верхняя филёнка остеклена (матовое стекло в два ряда), нижняя — глухая; ' +
      'латунная нажимная ручка, латунная табличка-номер со стороны коридора',
  },
  {
    id: 'sanatorium_screen', name: 'Остеклённая перегородка санатория', group: 'санаторий', look: 'glazed', leaves: 2, thick: 0.05,
    where: 'санаторий: закрытый конец коридора (sanat, 3.0 м — во всю ширину и высоту), «Выход к корпусам» вестибюля (stair)',
    rest: 92,
    anim: { handle: 'none', unlatchS: 0.15, swingS: 1.2 }, colors: ['#9a6a3c', '#8d5f35', '#a5743f'],
    casing: { w: 0.09, t: 0.03, color: '#7d5530' },
    model: 'деревянная перегородка медового дуба с двустворчатой дверью: высокое стекло мелкой расстекловкой, фрамуга-брусок, ' +
      'глухая филёнка внизу, латунные ручки-скобы',
  },
];

export const DOOR_STYLE_BY_ID: ReadonlyMap<string, DoorStyle> = new Map(DOOR_STYLES.map((s) => [s.id, s]));

// ───────────────────────── выбор двери ─────────────────────────

/** Чья сторона несёт полотно у пары направленных меток («хозяин>гость»): true — полотно в комнате с этой меткой
 *  (открывается в неё). У пары ровно одна сторона true. Симметричные метки (ходы, марши, секции коридора) —
 *  проходы без полотна. */
const LEAF_SIDE: Record<string, boolean> = {
  'apt>landing': true, 'landing>apt': false,
  'kitchen>hall': true, 'hall>kitchen': false,
  'hall>bath': true, 'bath>hall': false,
  'hall>wc': true, 'wc>hall': false,
  'room>hall': true, 'hall>room': false,
  'hall>closet': true, 'closet>hall': false,
  'living>hall': true, 'hall>living': false,
  'bedroom>living': true, 'living>bedroom': false,
  'room>balcony': true, 'balcony>room': false,
  'dorm>corridor': true, 'corridor>dorm': false,
  'corridor>service': true, 'service>corridor': false,
  'storage>basement': true, 'basement>storage': false,
  'stall>barn': true, 'barn>stall': false,
  // общага: комнаты и общие помещения — внутрь (у коридора только наличник)
  'room>obshaga': true, 'obshaga>room': false,
  'common>obshaga': true, 'obshaga>common': false,
  'vahter>hall': true, 'hall>vahter': false,
  // проём на лестничную клетку — без полотна (закрытый — тамбурная со стороны клетки)
  'stairs>obshaga': true, 'obshaga>stairs': false,
  // снежные ходы: боковой лаз в тупиковую берлогу — открытый без двери (стиля по метке нет), закрытый — обледенелая
  // дверь со стороны берлоги
  'den>snow': true, 'snow>den': false,
  // metro: проём из зала через пути и торцы эскалатора — без полотна (закрытые — по метке); служебные двери — в служебный
  // ход и в служебное помещение
  'per>hall': true, 'hall>per': false,
  'esc>hall': true, 'hall>esc': false,
  'slu>per': true, 'per>slu': false,
  'room>slu': true, 'slu>room': false,
  // cellar: щель хода в клетушку — открытая без полотна (стиля по метке нет); не выросла клетушка — низкая дверца
  // погреба со стороны клетушки
  'bin>cellar': true, 'cellar>bin': false,
  // catacombs: проём хода в нишу-убежище — без полотна (стиля по метке нет); не выросла ниша — закладка кирпичом
  'refuge>catacombs': true, 'catacombs>refuge': false,
  // sanatorium: палаты (комнаты в ремонте) и процедурные — внутрь (у коридора только наличник)
  'room>sanat': true, 'sanat>room': false,
  'proc>sanat': true, 'sanat>proc': false,
};

/** Дверь по метке (у пары — одна и та же); несколько — вариант по месту. */
const STYLE_BY_TAG: Record<string, string[]> = {
  'apt>landing': ['apt_dermantin', 'apt_dermantin', 'apt_wood', 'apt_metal90'],
  'landing>apt': ['apt_dermantin', 'apt_dermantin', 'apt_wood', 'apt_metal90'],
  'hall>kitchen': ['int_do'], 'kitchen>hall': ['int_do'],
  'hall>bath': ['int_bath'], 'bath>hall': ['int_bath'],
  'hall>wc': ['int_bath'], 'wc>hall': ['int_bath'],
  'hall>room': ['int_dg', 'int_dg', 'int_do'], 'room>hall': ['int_dg', 'int_dg', 'int_do'],
  'hall>closet': ['int_closet'], 'closet>hall': ['int_closet'],
  'hall>living': ['int_double'], 'living>hall': ['int_double'],
  'living>bedroom': ['int_dg'], 'bedroom>living': ['int_dg'],
  'room>balcony': ['balcony'], 'balcony>room': ['balcony'],
  'corridor>dorm': ['dorm_room'], 'dorm>corridor': ['dorm_room'],
  'corridor>service': ['service_metal'], 'service>corridor': ['service_metal'],
  'basement>storage': ['storage_lattice'], 'storage>basement': ['storage_lattice'],
  'barn>stall': ['barn_gate'], 'stall>barn': ['barn_gate'],
  'obshaga>room': ['obshaga_room'], 'room>obshaga': ['obshaga_room'],
  'obshaga>common': ['obshaga_room'], 'common>obshaga': ['obshaga_room'],
  'hall>vahter': ['obshaga_room'], 'vahter>hall': ['obshaga_room'],
  // metro: служебные двери — железные
  'per>slu': ['service_metal'], 'slu>per': ['service_metal'],
  'slu>room': ['service_metal'], 'room>slu': ['service_metal'],
  // sanatorium: палаты и процедурные — белая филёнчатая с остеклённой верхней филёнкой
  'sanat>room': ['sanatorium_door'], 'room>sanat': ['sanatorium_door'],
  'sanat>proc': ['sanatorium_door'], 'proc>sanat': ['sanatorium_door'],
};

/** Локация комнаты по её тегам (особые биомы — раньше квартирных тегов). */
export function doorContext(roomTags: readonly string[]): DoorGroup {
  if (roomTags.includes('завод')) return 'завод';
  if (roomTags.includes('снег')) return 'снег';
  if (roomTags.includes('погреб')) return 'погреб';
  if (roomTags.includes('сарай')) return 'сарай';
  if (roomTags.includes('подвал')) return 'подвал';
  if (roomTags.includes('общага')) return 'общага';
  // metro
  if (roomTags.includes('метро')) return 'метро';
  // catacombs
  if (roomTags.includes('катакомбы')) return 'катакомбы';
  // sanatorium
  if (roomTags.includes('санаторий')) return 'санаторий';
  return 'хрущёвка';
}

/** Закрытая дверь локации, если по метке не определилась (марши, ходы, неизвестные метки, особые биомы). */
const CLOSED_BY_CONTEXT: Record<DoorGroup, string> = {
  'хрущёвка': 'int_dg', 'общага': 'obshaga_room', 'подвал': 'basement_metal', 'сарай': 'barn_plank', 'погреб': 'cellar_low', 'снег': 'snow_iced', 'завод': 'factory_hermetic',
  // metro
  'метро': 'metro_door',
  // catacombs: марш наверх из хаба ('stair') и прочее — подвальная железная
  'катакомбы': 'basement_metal',
  // sanatorium
  'санаторий': 'sanatorium_door',
};

/** sanatorium: закрытые проходы санатория по метке (где бы ни стояли): конец коридора 3.0 м — деревянная остеклённая
 *  перегородка с двустворчатой дверью во всю ширину; «Выход к корпусам» вестибюля ('stair') — она же. */
const SAN_CLOSED: Record<string, string> = {
  sanat: 'sanatorium_screen',
};

/** catacombs: закрытые проходы катакомб по метке (где бы ни стояли): ход 2 м — закладка кирпичом или бетонная
 *  заглушка (вариант по месту), проём ниши — кирпичом, лаз — ржавая решётка. */
const CAT_CLOSED: Record<string, string[]> = {
  catacombs: ['cat_bricked', 'cat_bricked', 'cat_concrete'],
  'catacombs>refuge': ['cat_bricked'], 'refuge>catacombs': ['cat_bricked'],
  cat_duct: ['cat_grate'],
};

/** metro: закрытые проходы метро по метке (где бы ни стояли): широкие (ось зала, торцы эскалатора) — глухая стена с
 *  панно, переходы — маятниковая дверь, служебный ход — железная служебная. */
const METRO_CLOSED: Record<string, string> = {
  metro_hall: 'metro_wall', 'esc>hall': 'metro_wall', 'hall>esc': 'metro_wall',
  metro_per: 'metro_door', 'hall>per': 'metro_door', 'per>hall': 'metro_door',
  metro_slu: 'service_metal',
};

/** Полотно этой метки висит в её комнате (у прохода с меткой tag, если он не выход). */
export function leafHere(tag: string): boolean {
  return LEAF_SIDE[tag] === true;
}

/** Полотно висит не на своей стороне пары (закрытый выход с «чужой» стороны: дверь квартиры со стороны площадки,
 *  санузел изнутри) — лицевая и обратная стороны полотна меняются местами (номер, скважины, шпингалет). */
export function doorFlip(tag: string): boolean {
  return LEAF_SIDE[tag] === false;
}

/** FNV-1a: детерминированный выбор варианта и петель по месту двери. */
export function doorHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Дверь метки tag в комнате с тегами roomTags. closed — дверь, которая бывает закрытой (выход — и он же, открытый
 * игроком, — приход, тупик): такая есть всегда (у проходов — дверь локации), сквозная (решётка, калитка) заменяется на
 * closedAlt. Иначе (проход) — null у ходов подвала и сарая, маршей, секций коридора. seed — место двери
 * («inst/connector»).
 */
export function doorStyleFor(tag: string, roomTags: readonly string[], closed: boolean, seed: string): DoorStyle | null {
  const ctx = doorContext(roomTags);
  const list = STYLE_BY_TAG[tag];
  let id: string | null = null;
  // особые биомы (погреб, снег, завод) — закрытые двери свои, у какой бы метки ни стояли; проход цеха (factory, 2 м) —
  // ворота
  if (closed && ctx === 'завод' && tag === 'factory') id = 'factory_gate';
  else if (closed && (ctx === 'погреб' || ctx === 'снег' || ctx === 'завод')) id = CLOSED_BY_CONTEXT[ctx];
  // metro: закрытые проходы метро — по метке; «Выход в город» вестибюля ('stair') — маятниковая дверь
  else if (closed && (METRO_CLOSED[tag] || (ctx === 'метро' && tag === 'stair'))) id = METRO_CLOSED[tag] ?? 'metro_door';
  // catacombs: закрытые проходы катакомб — по метке; марш наверх хаба ('stair') — подвальная железная
  else if (closed && (CAT_CLOSED[tag] || (ctx === 'катакомбы' && tag === 'stair'))) {
    const l = CAT_CLOSED[tag] ?? [CLOSED_BY_CONTEXT['катакомбы']];
    id = l[doorHash(seed + '#style') % l.length];
  }
  // sanatorium: закрытый конец коридора — по метке; выход вестибюля к корпусам ('stair') — остеклённая перегородка
  else if (closed && (SAN_CLOSED[tag] || (ctx === 'санаторий' && tag === 'stair'))) id = SAN_CLOSED[tag] ?? 'sanatorium_screen';
  else if (list) id = list[doorHash(seed + '#style') % list.length];
  else if (closed) {
    if (tag === 'stair') id = ctx === 'подвал' ? 'basement_metal' : ctx === 'сарай' ? 'barn_plank' : 'tambour';
    else if (tag === 'corridor') id = ctx === 'хрущёвка' ? 'tambour' : CLOSED_BY_CONTEXT[ctx];
    else if (tag === 'basement') id = 'basement_metal';
    else if (tag === 'barn') id = 'barn_plank';
    // общага: закрытый конец коридора — тамбурная двустворчатая, хода подвала — железная
    else if (tag === 'obshaga' || tag === 'obshaga>stairs' || tag === 'stairs>obshaga') id = 'tambour';
    else if (tag === 'obshaga_bsm') id = 'basement_metal';
    else id = CLOSED_BY_CONTEXT[ctx];
  }
  if (!id) return null;
  let st = DOOR_STYLE_BY_ID.get(id) ?? null;
  if (st && closed && st.seeThrough && st.closedAlt) st = DOOR_STYLE_BY_ID.get(st.closedAlt) ?? st;
  return st;
}

// ───────────────────────── петли и угол ─────────────────────────

/** Зазоры модели: полотно заходит за проём на OV с боков и сверху, отстоит от стены на GAP; наличник — на CAS_GAP
 *  от края проёма. Полотно шире проёма — закрытое целиком его закрывает. */
export const DOOR_OV = 0.012;
export const DOOR_GAP = 0.003;
export const DOOR_CAS_GAP = 0.015;

/** Высота комингса гермодвери, м: полотно стоит на нём. */
export const HERMETIC_SILL = 0.1;

/** Ширина полотна (у двустворчатой — одной створки), м. */
export function leafWidth(style: DoorStyle, widthM: number): number {
  return style.leaves === 2 ? widthM / 2 + DOOR_OV - 0.001 : widthM + 2 * DOOR_OV;
}

/**
 * Петли: слева или справа (если стоять в комнате лицом к двери). space — сколько стены (м) слева и справа от
 * проёма до угла: петли — со стороны, где полотну есть куда лечь; иначе — по месту двери.
 */
export function chooseHinge(seed: string, space: [number, number] | null): 'left' | 'right' {
  const byHash: 'left' | 'right' = doorHash(seed + '#hinge') % 2 ? 'right' : 'left';
  if (!space) return byHash;
  const [l, r] = space;
  const NEED = 0.1;
  if (l < NEED && r >= NEED) return 'right';
  if (r < NEED && l >= NEED) return 'left';
  return byHash;
}

/** Угол распахнутой двери в покое, градусы: из каталога ± разброс по месту; у стены вплотную (угол комнаты у
 *  петель) — не больше 90° (полотно не уходит в соседнюю стену). */
export function restAngle(style: DoorStyle, seed: string, widthM: number, hingeSpace: number | null): number {
  const jitter = (doorHash(seed + '#rest') % 1000) / 1000;
  let a = style.rest - 4 + jitter * 8;
  const lw = leafWidth(style, widthM);
  if (hingeSpace !== null && a > 90) {
    // полотно за 90° заходит на стену у петель на lw·cos(a) — столько стены там должно быть
    const need = lw * Math.cos(((180 - a) * Math.PI) / 180) + 0.03;
    if (hingeSpace < need) a = 90;
  }
  return Math.round(Math.min(110, Math.max(60, a)) * 10) / 10;
}

// ───────────────────────── модель: боксы ─────────────────────────

/** Бокс модели: центр, размеры по осям, поворот в плоскости двери (вокруг z), цвет #rrggbb. */
export interface DoorPart {
  c: [number, number, number];
  s: [number, number, number];
  rz?: number;
  color: string;
}

/** Ручка — отдельная деталь полотна, двигается при отпирании (поворот вокруг оси, перпендикулярной полотну, или
 *  сдвиг засова вдоль полотна). Детали — относительно оси (pivot). */
export interface DoorHandleGeo {
  kind: HandleKind;
  pivot: [number, number, number];
  parts: DoorPart[];
}

export interface DoorLeafGeo {
  hinge: 'left' | 'right';
  /** ось петель в координатах двери: [x, z]; низ полотна — на высоте y0 */
  axis: [number, number];
  y0: number;
  /** знак поворота при открытии к комнате (Babylon RotationY, левая система): +1 у левых петель, −1 у правых;
   *  ручка: нажатие — поворот sign·угол вокруг z (рычаг смотрит к петлям) */
  sign: 1 | -1;
  width: number;
  height: number;
  parts: DoorPart[];
  handle: DoorHandleGeo | null;
}

export interface DoorGeometry {
  /** неподвижное: наличник, порог, заполнение над низкой дверью, доски заколоченной */
  frame: DoorPart[];
  leaves: DoorLeafGeo[];
}

export interface DoorGeometryInput {
  style: DoorStyle;
  widthM: number;
  heightM: number;
  hinge: 'left' | 'right';
  role: DoorRole;
  /** есть ли полотно (у прохода без полотна — только наличник) */
  leaf: boolean;
  /** стена слева и справа от проёма до угла, м (наличник обрезается); null — не ограничено */
  space?: [number, number] | null;
  /** место двери — вариант цвета, разброс досок */
  seed: string;
  /** метка: полотно не на своей стороне пары (doorFlip) — стороны полотна меняются местами */
  tag?: string;
}

const P = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: string, rz?: number): DoorPart => ({
  c: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2],
  s: [Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)],
  ...(rz ? { rz } : {}),
  color,
});

/** Полоса между двумя точками в плоскости двери (x, y) толщиной w по плоскости и z0..z1 по глубине. */
const bar = (xa: number, ya: number, xb: number, yb: number, w: number, z0: number, z1: number, color: string): DoorPart => {
  const len = Math.hypot(xb - xa, yb - ya);
  return { c: [(xa + xb) / 2, (ya + yb) / 2, (z0 + z1) / 2], s: [len, w, Math.abs(z1 - z0)], rz: Math.atan2(yb - ya, xb - xa), color };
};

/** Простой ГСЧ по месту двери (для досок, ржавчины) — mulberry32. */
function rngOf(seed: string): () => number {
  let a = doorHash(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Цвет темнее/светлее: k < 1 — темнее. */
export function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  const r = ch((n >> 16) & 255), g = ch((n >> 8) & 255), b = ch(n & 255);
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

// металл, стекло, фурнитура
const ALU = '#b9b6ad';
const BRASS = '#b39257';
const STEEL_DARK = '#2c2b29';
const GLASS = '#c5d0d2';
const GLASS_WIRED = '#a7b4b3';
const RUST = '#8a5532';

/**
 * Построитель полотна в его координатах (без отражения): x ∈ [0, w] от петель, y ∈ [0, h], тело z ∈ [0, t];
 * front — сторона комнаты-владельца (z < 0), back — обратная (z > t).
 */
class Leaf {
  readonly parts: DoorPart[] = [];
  handle: DoorHandleGeo | null = null;
  constructor(readonly w: number, readonly h: number, readonly t: number) {}
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: string, rz?: number) {
    this.parts.push(P(x0, y0, z0, x1, y1, z1, color, rz));
  }
  /** деталь на обе стороны: d — выступ, z считается от грани */
  both(x0: number, y0: number, x1: number, y1: number, d: number, color: string) {
    this.box(x0, y0, -d, x1, y1, 0, color);
    this.box(x0, y0, this.t, x1, y1, this.t + d, color);
  }
  front(x0: number, y0: number, x1: number, y1: number, d: number, color: string, z = 0) {
    this.box(x0, y0, z - d, x1, y1, z, color);
  }
  back(x0: number, y0: number, x1: number, y1: number, d: number, color: string, z = this.t) {
    this.box(x0, y0, z, x1, y1, z + d, color);
  }
  /** рамка-раскладка (штапик, молдинг) по прямоугольнику с обеих сторон */
  frameBoth(x0: number, y0: number, x1: number, y1: number, bw: number, d: number, color: string) {
    this.both(x0, y0, x1, y0 + bw, d, color);
    this.both(x0, y1 - bw, x1, y1, d, color);
    this.both(x0, y0 + bw, x0 + bw, y1 - bw, d, color);
    this.both(x1 - bw, y0 + bw, x1, y1 - bw, d, color);
  }
  /** нажимная ручка у свободного края на высоте y: розетки с обеих сторон (на полотне), рычаги — подвижная деталь */
  lever(y: number, color: string, kind: HandleKind = 'lever') {
    const x = this.w - Math.min(0.075, this.w * 0.2);
    const t = this.t;
    // розетки — неподвижны
    this.front(x - 0.022, y - 0.05, x + 0.022, y + 0.05, 0.008, color);
    this.back(x - 0.022, y - 0.05, x + 0.022, y + 0.05, 0.008, color);
    const parts: DoorPart[] = [];
    if (kind === 'knob') {
      // шейка и «шар» (крест из двух боксов) с обеих сторон
      for (const [n0, n1, k0, k1] of [[-0.03, -0.008, -0.05, -0.03], [t + 0.008, t + 0.03, t + 0.03, t + 0.05]] as const) {
        parts.push(P(-0.012, -0.012, n0, 0.012, 0.012, n1, color));
        parts.push(P(-0.027, -0.027, k0, 0.027, 0.027, k1, color));
        parts.push(P(-0.02, -0.033, k0 + 0.003, 0.02, 0.033, k1 - 0.003, color));
        parts.push(P(-0.033, -0.02, k0 + 0.003, 0.033, 0.02, k1 - 0.003, color));
      }
    } else {
      // рычаг смотрит к петлям (−x): шейка + рукоять
      for (const side of [-1, 1] as const) {
        const z0 = side < 0 ? -0.05 : t + 0.03;
        const z1 = side < 0 ? -0.03 : t + 0.05;
        parts.push(P(-0.01, -0.01, side < 0 ? -0.05 : t + 0.008, 0.01, 0.01, side < 0 ? -0.008 : t + 0.05, color));
        parts.push(P(-0.125, -0.011, z0, 0.006, 0.011, z1, color));
      }
    }
    this.handle = { kind, pivot: [x, y, 0], parts };
  }
  /** замочная скважина / накладка */
  keyhole(y: number, side: 'front' | 'back', color = BRASS) {
    const x = this.w - Math.min(0.075, this.w * 0.2);
    if (side === 'front') this.front(x - 0.018, y - 0.035, x + 0.018, y + 0.035, 0.005, color);
    else this.back(x - 0.018, y - 0.035, x + 0.018, y + 0.035, 0.005, color);
    // скважина — тёмная прорезь на 1 мм перед накладкой
    const z = side === 'front' ? -0.006 : this.t + 0.005;
    this.box(x - 0.004, y - 0.012, z, x + 0.004, y + 0.006, z + 0.001, STEEL_DARK);
  }
  peephole(y: number) {
    const x = this.w / 2;
    this.front(x - 0.016, y - 0.016, x + 0.016, y + 0.016, 0.018, ALU);
    this.back(x - 0.012, y - 0.012, x + 0.012, y + 0.012, 0.01, ALU);
  }
  /** номер квартиры: латунная табличка с «цифрами» */
  number(y: number, side: 'front' | 'back', seed: string) {
    const x = this.w / 2;
    const d = 0.004;
    if (side === 'front') this.front(x - 0.055, y - 0.035, x + 0.055, y + 0.035, d, BRASS);
    else this.back(x - 0.055, y - 0.035, x + 0.055, y + 0.035, d, BRASS);
    const n = 2 + (doorHash(seed + '#num') % 2);
    const z = side === 'front' ? -d - 0.002 : this.t + d;
    for (let k = 0; k < n; k++) {
      const cx = x + (k - (n - 1) / 2) * 0.026;
      this.box(cx - 0.007, y - 0.022, z, cx + 0.007, y + 0.022, z + 0.002, '#2b2118');
    }
  }
}

/** Филёнки: прямоугольники молдинга (доли высоты полотна снизу вверх). */
function panels(L: Leaf, rows: [number, number][], color: string, inset = 0.09) {
  for (const [a, b] of rows) L.frameBoth(inset, a, L.w - inset, b, 0.022, 0.005, color);
}

/** Остеклённая часть: переплёт cols × rows в прямоугольнике [x0, x1] × [y0, y1] (стекло — посередине толщины). */
function glazing(L: Leaf, x0: number, y0: number, x1: number, y1: number, cols: number, rows: number, wood: string, glass: string, wired = false) {
  const t = L.t;
  const bw = 0.028;
  // стекло во всю область, бруски переплёта поверх — на всю толщину
  L.box(x0, y0, t / 2 - 0.003, x1, y1, t / 2 + 0.003, glass);
  for (let i = 1; i < cols; i++) {
    const x = x0 + ((x1 - x0) * i) / cols;
    L.box(x - bw / 2, y0, 0, x + bw / 2, y1, t, wood);
  }
  for (let j = 1; j < rows; j++) {
    const y = y0 + ((y1 - y0) * j) / rows;
    L.box(x0, y - bw / 2, 0, x1, y + bw / 2, t, wood);
  }
  // штапик вокруг стекла с обеих сторон (между гранью полотна и стеклом)
  const d = t / 2 - 0.004;
  for (const [za, zb] of [[0, d], [t - d, t]] as const) {
    L.box(x0, y0, za, x1, y0 + 0.012, zb, wood);
    L.box(x0, y1 - 0.012, za, x1, y1, zb, wood);
    L.box(x0, y0 + 0.012, za, x0 + 0.012, y1 - 0.012, zb, wood);
    L.box(x1 - 0.012, y0 + 0.012, za, x1, y1 - 0.012, zb, wood);
  }
  if (wired) {
    // армированное стекло: редкая сетка проволоки на передней стороне стекла (на 1.5 мм перед ним)
    const zc = t / 2 - 0.0045;
    for (let x = x0 + 0.05; x < x1 - 0.02; x += 0.05) L.box(x - 0.0012, y0, zc, x + 0.0012, y1, zc + 0.0015, '#5b6563');
    for (let y = y0 + 0.05; y < y1 - 0.02; y += 0.05) L.box(x0, y - 0.0012, zc, x1, y + 0.0012, zc + 0.0015, '#5b6563');
  }
}

/** Тело полотна с проёмом под стекло: обвязка вокруг прямоугольника [gx0, gx1] × [gy0, gy1]. */
function bodyWithHole(L: Leaf, gx0: number, gy0: number, gx1: number, gy1: number, color: string) {
  const t = L.t;
  L.box(0, 0, 0, L.w, gy0, t, color);
  L.box(0, gy1, 0, L.w, L.h, t, color);
  L.box(0, gy0, 0, gx0, gy1, t, color);
  L.box(gx1, gy0, 0, L.w, gy1, t, color);
}

function buildLeaf(st: DoorStyle, w: number, h: number, seed: string, k: number): Leaf {
  const L = new Leaf(w, h, st.thick);
  const rnd = rngOf(seed + '#leaf' + k);
  const col = st.colors[doorHash(seed + '#color') % st.colors.length];
  const t = st.thick;
  switch (st.look) {
    case 'dermantin': {
      L.box(0, 0, 0, w, h, t, col);
      const welt = shade(col, 0.82);
      const studs = BRASS;
      // валик по краю
      L.frameBoth(0.012, 0.012, w - 0.012, h - 0.012, 0.035, 0.012, welt);
      // ромбы: шнур и гвозди на пересечениях (с обеих сторон)
      const x0 = 0.07, x1 = w - 0.07, y0 = 0.08, y1 = h - 0.08;
      const nx = Math.max(2, Math.round((x1 - x0) / 0.21));
      const ny = Math.max(4, Math.round((y1 - y0) / 0.28));
      const ax = (x1 - x0) / nx, ay = (y1 - y0) / ny;
      const pt = (i: number, j: number): [number, number] => [x0 + i * ax, y0 + j * ay];
      for (let i = 0; i <= nx; i++) {
        for (let j = 0; j <= ny; j++) {
          if ((i + j) % 2) continue;
          const [x, y] = pt(i, j);
          L.both(x - 0.008, y - 0.008, x + 0.008, y + 0.008, 0.009, studs);
          for (const dj of [1, -1]) {
            if (i + 1 > nx || j + dj < 0 || j + dj > ny) continue;
            const [xb, yb] = pt(i + 1, j + dj);
            L.parts.push(bar(x, y, xb, yb, 0.006, -0.004, 0, '#8a7347'));
            L.parts.push(bar(x, y, xb, yb, 0.006, t, t + 0.004, '#8a7347'));
          }
        }
      }
      L.peephole(1.52);
      // изнутри (front) — вертушка замка, снаружи (back) — две скважины и номер
      const xl = w - 0.075;
      L.front(xl - 0.02, 1.27, xl + 0.02, 1.33, 0.006, ALU);
      L.front(xl - 0.006, 1.285, xl + 0.006, 1.315, 0.022, ALU);
      L.keyhole(1.3, 'back');
      L.keyhole(0.88, 'back');
      L.number(1.72, 'back', seed);
      L.lever(1.02, ALU);
      break;
    }
    case 'panel': {
      L.box(0, 0, 0, w, h, t, col);
      const mold = shade(col, st.id === 'int_dg' ? 0.93 : 0.85);
      const inset = Math.min(0.09, w * 0.13);
      if (st.id === 'apt_wood' || st.id === 'dorm_room') panels(L, [[0.12, 0.78], [0.92, h - 0.12]], mold, inset);
      else panels(L, [[0.1, h * 0.36], [h * 0.42, h - 0.1]], mold, inset);
      if (st.id === 'apt_wood') {
        L.peephole(1.52);
        L.keyhole(1.25, 'back');
        L.keyhole(1.25, 'front', ALU);
        L.number(1.75, 'back', seed);
        L.lever(1.0, '#3a3836');
      } else if (st.id === 'dorm_room') {
        L.number(1.6, 'back', seed);
        // накладной замок изнутри
        const xl = w - 0.08;
        L.front(xl - 0.045, 1.08, xl + 0.035, 1.2, 0.025, '#6b6b66');
        L.keyhole(1.0, 'back');
        L.lever(0.98, ALU);
      } else L.lever(1.0, ALU, doorHash(seed + '#knob') % 4 === 0 ? 'knob' : 'lever');
      break;
    }
    case 'flat': {
      L.box(0, 0, 0, w, h, t, col);
      if (st.id === 'obshaga_room') {
        // общага: жестяной номерок со стороны коридора (обратная сторона полотна в комнате), накладной замок изнутри
        // smile: номерок — табличкой с настоящим номером (src/view3d/obshagaRoomsView.ts; 75% комнат — без номера)
        const xl = w - 0.08;
        L.front(xl - 0.045, 1.08, xl + 0.035, 1.2, 0.025, '#6b6b66');
        L.keyhole(1.0, 'back');
        L.lever(0.98, ALU);
      } else if (st.id === 'int_bath') {
        // вентрешётка внизу (с обеих сторон), шпингалет с обратной стороны (в ванной)
        const gx0 = w / 2 - 0.15, gx1 = w / 2 + 0.15;
        L.both(gx0, 0.1, gx1, 0.22, 0.004, '#a6aba6');
        for (let y = 0.115; y < 0.215; y += 0.02) L.both(gx0 + 0.01, y, gx1 - 0.01, y + 0.008, 0.008, '#8c918c');
        L.back(w - 0.11, 1.3, w - 0.03, 1.33, 0.012, ALU);
        L.lever(0.98, ALU);
      } else {
        // кладовка: крючок и круглая ручка
        L.front(w - 0.05, 1.42, w - 0.04, 1.47, 0.01, STEEL_DARK);
        L.lever(0.95, ALU, 'knob');
      }
      break;
    }
    case 'glazed': {
      const wood = col;
      if (st.id === 'balcony') {
        const g0 = 0.78, g1 = h - 0.1;
        bodyWithHole(L, 0.09, g0, w - 0.09, g1, wood);
        glazing(L, 0.09, g0, w - 0.09, g1, 1, 2, wood, GLASS);
        panels(L, [[0.1, g0 - 0.1]], shade(wood, 0.92), 0.09);
        // верхний шпингалет
        L.front(w - 0.06, h - 0.32, w - 0.035, h - 0.06, 0.012, ALU);
        L.lever(1.05, ALU);
      } else if (st.id === 'tambour') {
        const g0 = h * 0.5, g1 = h - 0.12;
        bodyWithHole(L, 0.1, g0, w - 0.1, g1, wood);
        glazing(L, 0.1, g0, w - 0.1, g1, 1, 1, shade(wood, 0.9), GLASS_WIRED, true);
        panels(L, [[0.12, g0 - 0.1]], shade(wood, 0.85), 0.1);
        // ручки-скобы с обеих сторон
        const x = w - 0.08;
        for (const z of [-0.045, t + 0.02]) {
          L.box(x - 0.012, 0.95, z, x + 0.012, 1.25, z + 0.025, ALU);
          L.box(x - 0.012, 0.95, z < 0 ? z + 0.025 : t, x + 0.012, 0.98, z < 0 ? 0 : z, ALU);
          L.box(x - 0.012, 1.22, z < 0 ? z + 0.025 : t, x + 0.012, 1.25, z < 0 ? 0 : z, ALU);
        }
      } else if (st.id === 'sanatorium_door') {
        // sanatorium: белая эмаль; верхняя филёнка — матовое стекло в два ряда, нижняя — глухая филёнка; латунная ручка,
        // табличка-номер со стороны коридора (обратная сторона полотна в комнате)
        const gx = Math.min(0.11, w * 0.16);
        const g0 = Math.max(1.12, h * 0.56), g1 = h - 0.12;
        bodyWithHole(L, gx, g0, w - gx, g1, wood);
        glazing(L, gx, g0, w - gx, g1, 1, 2, shade(wood, 0.97), '#dde3e0');
        panels(L, [[0.12, g0 - 0.26]], shade(wood, 0.9), gx);
        L.number(g0 - 0.13, 'back', seed);
        L.keyhole(0.9, 'back');
        L.lever(1.0, BRASS);
      } else if (st.id === 'sanatorium_screen') {
        // sanatorium: остеклённая деревянная перегородка — высокое стекло мелкой расстекловкой (фрамуга — брусок поперёк на
        // ~2.3 м), глухая филёнка внизу, латунные ручки-скобы с обеих сторон
        const gx = Math.min(0.1, w * 0.12);
        const g0 = Math.min(0.85, h * 0.3), g1 = h - 0.1;
        bodyWithHole(L, gx, g0, w - gx, g1, wood);
        const cols = Math.max(1, Math.round((w - 2 * gx) / 0.45));
        const rows = Math.max(2, Math.round((g1 - g0) / 0.45));
        glazing(L, gx, g0, w - gx, g1, cols, rows, wood, GLASS);
        if (g1 - g0 > 1.8) L.box(gx, g0 + 1.45, -0.006, w - gx, g0 + 1.52, t + 0.006, shade(wood, 0.92));
        panels(L, [[0.12, g0 - 0.1]], shade(wood, 0.86), gx);
        const x = w - 0.08;
        for (const z of [-0.045, t + 0.02]) {
          L.box(x - 0.012, 0.95, z, x + 0.012, 1.25, z + 0.025, BRASS);
          L.box(x - 0.012, 0.95, z < 0 ? z + 0.025 : t, x + 0.012, 0.98, z < 0 ? 0 : z, BRASS);
          L.box(x - 0.012, 1.22, z < 0 ? z + 0.025 : t, x + 0.012, 1.25, z < 0 ? 0 : z, BRASS);
        }
      } else {
        // ДО и двустворчатая в зал: стекло сверху, филёнка снизу
        const g0 = h * (st.id === 'int_double' ? 0.38 : 0.42), g1 = h - 0.1;
        const gx = Math.min(0.09, w * 0.16);
        bodyWithHole(L, gx, g0, w - gx, g1, wood);
        glazing(L, gx, g0, w - gx, g1, st.id === 'int_double' ? 2 : 1, 3, wood, GLASS);
        panels(L, [[0.1, g0 - 0.08]], shade(wood, 0.93), gx);
        if (k === 0 || st.leaves === 1) L.lever(1.0, ALU);
      }
      break;
    }
    case 'metal': {
      L.box(0, 0, 0, w, h, t, col);
      const rim = shade(col, 0.8);
      if (st.id === 'apt_metal90') {
        // снаружи (back) — рамка и «молотковая» краска, изнутри (front) — вагонка
        L.back(0.03, 0.03, w - 0.03, 0.07, 0.006, rim);
        L.back(0.03, h - 0.07, w - 0.03, h - 0.03, 0.006, rim);
        L.back(0.03, 0.07, 0.07, h - 0.07, 0.006, rim);
        L.back(w - 0.07, 0.07, w - 0.03, h - 0.07, 0.006, rim);
        const vag = ['#b58a5a', '#a87e50'];
        let i = 0;
        for (let y = 0.02; y < h - 0.02; y += 0.095) L.front(0.02, y, w - 0.02, Math.min(h - 0.02, y + 0.09), 0.012, vag[i++ % 2]);
        L.peephole(1.52);
        L.keyhole(1.3, 'back', '#c9c6be');
        L.keyhole(0.85, 'back', '#c9c6be');
        L.keyhole(1.3, 'front', '#c9c6be');
        L.number(1.75, 'back', seed);
        L.lever(1.05, '#1f1e1d');
      } else if (st.id === 'service_metal') {
        L.frameBoth(0.04, 0.04, w - 0.04, h - 0.04, 0.04, 0.006, rim);
        // табличка «не входить»: красная с белой полосой — со стороны коридора (front)
        L.front(w / 2 - 0.13, 1.5, w / 2 + 0.13, 1.66, 0.004, '#b8352b');
        L.front(w / 2 - 0.1, 1.56, w / 2 + 0.1, 1.6, 0.006, '#e8e4dc');
        // проушины и навесной замок
        const x = w - 0.06;
        L.front(x - 0.03, 1.15, x + 0.01, 1.2, 0.02, STEEL_DARK);
        L.front(x - 0.022, 1.06, x + 0.012, 1.12, 0.03, '#4a4844');
        L.lever(0.98, '#2b2a28');
      } else {
        // подвальная: рёбра, ржавчина, засов, табличка
        for (const y of [0.35, h / 2, h - 0.35]) L.both(0.03, y - 0.025, w - 0.03, y + 0.025, 0.01, rim);
        L.both(0.03, 0.03, 0.08, h - 0.03, 0.01, rim);
        L.both(w - 0.08, 0.03, w - 0.03, h - 0.03, 0.01, rim);
        for (let i = 0; i < 9; i++) {
          const x = 0.1 + rnd() * (w - 0.3), y = 0.1 + rnd() * (h - 0.4), s = 0.04 + rnd() * 0.12;
          const front = rnd() < 0.6;
          if (front) L.front(x, y, Math.min(w - 0.02, x + s * 1.4), Math.min(h - 0.02, y + s), 0.002, RUST);
          else L.back(x, y, Math.min(w - 0.02, x + s * 1.4), Math.min(h - 0.02, y + s), 0.002, RUST);
        }
        L.front(w / 2 - 0.14, 1.62, w / 2 + 0.14, 1.76, 0.004, '#d9d4c4');
        for (let i = 0; i < 3; i++) L.front(w / 2 - 0.1 + i * 0.075, 1.66, w / 2 - 0.05 + i * 0.075, 1.72, 0.006, '#2e2a26');
        // ручка-скоба
        L.front(w - 0.09, 0.85, w - 0.07, 1.15, 0.04, STEEL_DARK);
        L.back(w - 0.09, 0.85, w - 0.07, 1.15, 0.04, STEEL_DARK);
        // засов: подвижная полоса со стороны комнаты, на скобах
        const y = 1.22;
        L.front(w - 0.32, y - 0.03, w - 0.29, y + 0.03, 0.03, STEEL_DARK);
        L.front(w - 0.16, y - 0.03, w - 0.13, y + 0.03, 0.03, STEEL_DARK);
        L.handle = {
          kind: 'bolt',
          pivot: [w - 0.2, y, 0],
          parts: [P(-0.16, -0.014, -0.028, 0.24, 0.014, -0.01, '#3b3935'), P(0.02, 0.014, -0.03, 0.04, 0.07, -0.012, '#3b3935')],
        };
      }
      break;
    }
    case 'planks': {
      // доски вертикально, разной ширины и тона; щели — тёмными полосками на поверхности (сквозь не видно)
      const tones = [col, shade(col, 0.9), shade(col, 1.08), shade(col, 0.95)];
      let x = 0;
      while (x < w - 0.001) {
        const bw = Math.min(w - x, 0.11 + rnd() * 0.07);
        const c = tones[Math.floor(rnd() * tones.length)];
        L.box(x, 0, 0, x + bw, h, t, c);
        if (x + bw < w - 0.001) L.both(x + bw - 0.003, 0, x + bw + 0.003, h, 0.0015, '#2a2119');
        x += bw;
      }
      const batten = shade(col, 0.85);
      if (st.id === 'cellar_low') {
        // cellar: старые сырые доски (сторона комнаты) — низ потемнел от сырости, потёки; слои по выступу: сырость
        // 1 мм, потёки 1.25 мм, щели 1.5 мм; две ржавые полосы на заклёпках, под ручкой — железная накладка
        L.front(0.004, 0, w - 0.004, 0.2 + rnd() * 0.1, 0.001, shade(col, 0.72));
        for (let i = 0; i < 6; i++) {
          const xx = 0.03 + rnd() * (w - 0.1), y1 = 0.35 + rnd() * (h - 0.5);
          L.front(xx, Math.max(0.05, y1 - 0.2 - rnd() * 0.3), xx + 0.012 + rnd() * 0.025, y1, 0.00125, shade(col, rnd() < 0.5 ? 0.86 : 0.92));
        }
        for (const y of [0.3, h - 0.28]) {
          L.front(0.012, y - 0.028, w - 0.012, y + 0.028, 0.004, '#3b2b21');
          for (let xx = 0.045; xx < w - 0.03; xx += 0.105) L.front(xx - 0.006, y - 0.006, xx + 0.006, y + 0.006, 0.004, '#4b3e33', -0.004);
        }
        L.front(w - 0.08 - 0.035, 0.86, w - 0.08 + 0.035, 1.25, 0.003, '#2f2924');
        // обвязка — с обратной стороны
        L.back(0.03, 0.15, w - 0.03, 0.27, 0.025, batten);
        L.back(0.03, h - 0.27, w - 0.03, h - 0.15, 0.025, batten);
        L.parts.push(bar(0.08, 0.27, w - 0.08, h - 0.27, 0.1, t, t + 0.025, batten));
      } else {
        // планки и раскос (Z) — со стороны комнаты; полосы-петли поверх планок
        const yb = [0.22, h - 0.22];
        for (const y of yb) L.front(0.02, y - 0.07, w - 0.02, y + 0.07, 0.025, batten);
        L.parts.push(bar(0.09, yb[0] + 0.07, w - 0.09, yb[1] - 0.07, 0.12, -0.025, 0, batten));
        for (const y of yb) {
          L.front(-0.01, y - 0.025, w * 0.6, y + 0.025, 0.006, STEEL_DARK, -0.025);
          L.back(-0.01, y - 0.025, 0.12, y + 0.025, 0.006, STEEL_DARK);
          for (const xx of [0.05, w * 0.3, w * 0.55]) L.front(xx - 0.007, y - 0.007, xx + 0.007, y + 0.007, 0.006, '#46423c', -0.031);
        }
        if (st.id === 'snow_iced') {
          // иней по краям и налипший снег внизу (с обеих сторон)
          const frost = '#dfe8ee';
          L.both(0, 0, w, 0.18 + rnd() * 0.08, 0.012, '#eef3f6');
          L.both(0, h - 0.06, w, h, 0.006, frost);
          L.both(0, 0.2, 0.05, h - 0.06, 0.006, frost);
          L.both(w - 0.05, 0.2, w, h - 0.06, 0.006, frost);
          for (let i = 0; i < 7; i++) {
            const xx = rnd() * (w - 0.2), yy = 0.3 + rnd() * (h - 0.6), s = 0.06 + rnd() * 0.14;
            L.front(xx, yy, xx + s * 1.3, yy + s, 0.003, frost, -0.025);
          }
        }
      }
      // ручка-кольцо и вертушка (подвижная)
      const xh = w - 0.08;
      L.front(xh - 0.03, 0.98, xh + 0.03, 1.04, 0.012, STEEL_DARK, st.id === 'cellar_low' ? -0.003 : 0);
      L.front(xh - 0.006, 0.9, xh + 0.006, 0.98, 0.03, STEEL_DARK, st.id === 'cellar_low' ? -0.003 : 0);
      L.back(xh - 0.03, 0.98, xh + 0.03, 1.04, 0.012, STEEL_DARK);
      const zl = st.id === 'cellar_low' ? -0.003 : 0;
      L.handle = {
        kind: 'latch',
        pivot: [xh, 1.2, zl],
        parts: [P(-0.012, -0.012, -0.03, 0.012, 0.012, 0, '#3a2f24'), P(-0.11, -0.016, -0.05, 0.03, 0.016, -0.03, shade(col, 0.8))],
      };
      break;
    }
    case 'slats': {
      // рама и рейки с просветами
      const frame = shade(col, 0.88);
      const fw = 0.06;
      L.box(0, 0, 0, fw, h, t, frame);
      L.box(w - fw, 0, 0, w, h, t, frame);
      L.box(fw, 0, 0, w - fw, 0.09, t, frame);
      L.box(fw, h - 0.09, 0, w - fw, h, t, frame);
      if (st.id === 'barn_gate') L.box(fw, h * 0.5 - 0.045, 0, w - fw, h * 0.5 + 0.045, t, frame);
      const sw = st.id === 'barn_gate' ? 0.11 : 0.045;
      const gapW = st.id === 'barn_gate' ? 0.035 : 0.032;
      const inner = w - 2 * fw;
      const n = Math.max(1, Math.floor((inner + gapW) / (sw + gapW)));
      const step = (inner - n * sw) / Math.max(1, n - 1 + 2);
      for (let i = 0; i < n; i++) {
        const x = fw + step + i * (sw + step);
        L.box(x, 0.09, t * 0.25, x + sw, h - 0.09, t * 0.75, rnd() < 0.5 ? col : shade(col, 1.07));
      }
      L.parts.push(bar(fw, 0.09, w - fw, st.id === 'barn_gate' ? h * 0.5 - 0.045 : h - 0.09, 0.08, -0.012, 0, frame));
      // навесной замок / щеколда
      const xh = w - 0.035;
      L.front(xh - 0.02, 1.02, xh + 0.02, 1.08, 0.015, STEEL_DARK);
      if (st.id === 'storage_lattice') L.front(xh - 0.025, 0.93, xh + 0.02, 1.0, 0.03, '#5a5650', -0.015);
      L.handle = {
        kind: 'latch',
        pivot: [xh, 1.2, 0],
        parts: [P(-0.01, -0.01, -0.025, 0.01, 0.01, 0, STEEL_DARK), P(-0.09, -0.012, -0.04, 0.02, 0.012, -0.025, STEEL_DARK)],
      };
      break;
    }
    case 'hermetic': {
      L.box(0, 0, 0, w, h, t, col);
      const rim = shade(col, 0.78);
      L.frameBoth(0.02, 0.02, w - 0.02, h - 0.02, 0.06, 0.02, rim);
      // красная полоса и задрайки
      L.front(0.08, 1.75, w - 0.08, 1.85, 0.004, '#a33a2c');
      L.back(0.08, 1.75, w - 0.08, 1.85, 0.004, '#a33a2c');
      for (const [x, y] of [[0.05, 0.4], [0.05, h - 0.4], [w - 0.05, 0.4], [w - 0.05, h - 0.4]] as const) {
        L.front(x - 0.02, y - 0.06, x + 0.02, y + 0.06, 0.05, STEEL_DARK);
        L.back(x - 0.02, y - 0.06, x + 0.02, y + 0.06, 0.05, STEEL_DARK);
      }
      // штурвал: обод из 16 отрезков, 4 спицы, ступица — вращается вокруг оси полотна
      const R0 = Math.min(0.24, w * 0.28);
      const parts: DoorPart[] = [];
      const segs = 16;
      for (let i = 0; i < segs; i++) {
        const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
        parts.push(bar(R0 * Math.cos(a0), R0 * Math.sin(a0), R0 * Math.cos(a1), R0 * Math.sin(a1), 0.028, -0.11, -0.08, '#2f3330'));
      }
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        parts.push(bar(0, 0, R0 * Math.cos(a), R0 * Math.sin(a), 0.022, -0.1, -0.085, '#3a3f3b'));
      }
      parts.push(P(-0.045, -0.045, -0.11, 0.045, 0.045, 0, '#2a2d2b'));
      L.handle = { kind: 'wheel', pivot: [w / 2, 1.2, 0], parts };
      break;
    }
    case 'corrugated': {
      L.box(0, 0, 0, w, h, t, col);
      const rib = shade(col, 1.08);
      for (let x = 0.06; x < w - 0.04; x += 0.085) L.both(x, 0.06, x + 0.035, h - 0.06, 0.012, rib);
      const fr = shade(col, 0.75);
      L.frameBoth(0, 0, w, h, 0.06, 0.016, fr);
      if (k === 0) {
        // калитка: контур и ручка
        const kx0 = w * 0.25, kx1 = Math.min(w - 0.12, kx0 + 0.85), ky1 = Math.min(h - 0.15, 1.95);
        L.front(kx0, 0.04, kx0 + 0.04, ky1, 0.02, fr, -0.012);
        L.front(kx1 - 0.04, 0.04, kx1, ky1, 0.02, fr, -0.012);
        L.front(kx0, ky1 - 0.04, kx1, ky1, 0.02, fr, -0.012);
        L.front(kx1 - 0.1, 0.95, kx1 - 0.07, 1.15, 0.05, STEEL_DARK, -0.012);
      }
      // засов на правой створке (k = 1) — подвижный
      if (k === 1 || st.leaves === 1) {
        L.handle = { kind: 'bolt', pivot: [w - 0.25, 1.3, 0], parts: [P(-0.2, -0.02, -0.05, 0.3, 0.02, -0.02, '#2c2e2b')] };
        L.front(w - 0.45, 1.26, w - 0.4, 1.34, 0.055, STEEL_DARK);
      }
      break;
    }
    // metro: глухая фальш-стена во весь проём (широкие проходы метро) — мраморные плиты со швами, цоколь тёмного
    // гранита, карниз; посередине мозаичное панно: рама чёрного камня, белый фон, полосы красного и чёрного камня внизу,
    // круг-эмблема (диск из повёрнутых квадратов и обод), ступенчатые треугольники по сторонам. Ручки нет.
    case 'blind': {
      const RED = '#a8322b', BLACK = '#1f1d1c';
      L.box(0, 0, 0, w, h, t, col);
      const joint = shade(col, 0.82);
      const nx = Math.max(1, Math.round(w / 1.2)), ny = Math.max(1, Math.round((h - 0.5) / 1.2));
      for (let i = 1; i < nx; i++) L.front((i * w) / nx - 0.003, 0.3, (i * w) / nx + 0.003, h - 0.2, 0.002, joint);
      for (let j = 1; j < ny; j++) {
        const y = 0.3 + (j * (h - 0.5)) / ny;
        L.front(0, y - 0.003, w, y + 0.003, 0.002, joint);
      }
      L.both(0, 0, w, 0.3, 0.02, '#45413e');
      L.both(0, h - 0.2, w, h, 0.04, shade(col, 0.9));
      const pw = Math.min(4, w * 0.7), ph = Math.min(2.6, h - 0.9);
      if (pw > 0.6 && ph > 0.6) {
        const x0 = (w - pw) / 2, y0 = Math.max(0.5, (h - ph) / 2 + 0.1), x1 = x0 + pw, y1 = y0 + ph;
        L.front(x0 - 0.06, y0 - 0.06, x1 + 0.06, y1 + 0.06, 0.012, BLACK);
        L.front(x0, y0, x1, y1, 0.012, '#e6e1d6', -0.012);
        const sh = ph * 0.07;
        [RED, BLACK, RED].forEach((c, i) => L.front(x0, y0 + sh * (i * 1.4 + 0.3), x1, y0 + sh * (i * 1.4 + 1.3), 0.008, c, -0.024));
        const cx = (x0 + x1) / 2, cy = y0 + ph * 0.6, R = Math.min(pw, ph) * 0.24;
        for (let a = 0; a < 3; a++) L.parts.push({ c: [cx, cy, -0.03], s: [R * 1.42, R * 1.42, 0.008], rz: (a * Math.PI) / 6, color: RED });
        for (let i = 0; i < 16; i++) {
          const a0 = (i / 16) * Math.PI * 2, a1 = ((i + 1) / 16) * Math.PI * 2, r = R * 1.2;
          L.parts.push(bar(cx + r * Math.cos(a0), cy + r * Math.sin(a0), cx + r * Math.cos(a1), cy + r * Math.sin(a1), 0.05, -0.034, -0.026, BLACK));
        }
        for (const sx of [-1, 1]) {
          const bx = cx + sx * pw * 0.34, tw = pw * 0.18, th = ph * 0.35, n = 5;
          for (let k = 0; k < n; k++) {
            const ww = tw * (1 - k / n), yb = cy - th / 2 + (k * th) / n;
            L.front(bx - ww / 2, yb, bx + ww / 2, yb + th / n, 0.008, k % 2 ? BLACK : RED, -0.024);
          }
        }
      }
      break;
    }
    // catacombs: закладка проёма — кирпич вперевязку (полосы по два ряда разного тона, швы раствора, вертикальные швы
    // со сдвигом) или бетонная заглушка (швы щитов опалубки, потёки); внизу — тёмная полоса ила и высолы. Ручки нет.
    case 'bricked': {
      L.box(0, 0, 0, w, h, t, col);
      const SILT = '#3b3328', SALT = '#c9c2b0';
      if (st.id === 'cat_concrete') {
        const seam = shade(col, 0.8);
        for (let y = 0.5; y < h - 0.05; y += 0.5) L.front(0, y - 0.006, w, y + 0.006, 0.003, seam);
        for (let x = 1.0; x < w - 0.05; x += 1.0) L.front(x - 0.006, 0, x + 0.006, h, 0.003, seam);
        for (let i = 0; i < 4; i++) {
          const x = 0.1 + rnd() * Math.max(0.05, w - 0.25);
          L.front(x, 0.3, x + 0.04 + rnd() * 0.05, 0.6 + rnd() * (h - 0.8), 0.002, shade(col, 0.72));
        }
      } else {
        const mortar = '#a59a86';
        const BH = 0.15;
        for (let k = 0, y = 0; y < h - 1e-6; k++, y += BH) {
          const y1 = Math.min(h, y + BH);
          L.front(0, y, w, y1 - 0.012, 0.006, rnd() < 0.5 ? col : shade(col, 0.88 + rnd() * 0.24));
          L.front(0, y1 - 0.012, w, y1, 0.003, mortar);
          for (let x = k % 2 ? 0.26 : 0.52; x < w - 0.05; x += 0.52) L.front(x - 0.006, y, x + 0.006, y1 - 0.012, 0.007, mortar);
        }
        for (let i = 0; i < 3; i++) {
          const x = rnd() * Math.max(0.05, w - 0.4);
          L.front(x, 0.3, x + 0.2 + rnd() * 0.2, 0.42 + rnd() * 0.25, 0.008, SALT);
        }
      }
      L.front(0, 0, w, 0.3, 0.01, SILT);
      break;
    }
    // catacombs: ржавая решётка лаза — рама и прутья на заклёпках перед глухой чёрной плитой (за решёткой — темнота
    // короба: одинаково, есть за ней проём или стена). Ручки нет.
    case 'grate': {
      L.box(0, 0, t - 0.01, w, h, t, '#0b0b0a');
      const fw = 0.04, dark = shade(col, 0.8);
      L.box(0, 0, 0, fw, h, 0.03, dark);
      L.box(w - fw, 0, 0, w, h, 0.03, dark);
      L.box(fw, 0, 0, w - fw, fw, 0.03, dark);
      L.box(fw, h - fw, 0, w - fw, h, 0.03, dark);
      const n = Math.max(2, Math.round((w - 2 * fw) / 0.1));
      for (let i = 1; i < n; i++) {
        const x = fw + (i * (w - 2 * fw)) / n;
        L.box(x - 0.008, fw, 0.005, x + 0.008, h - fw, 0.025, rnd() < 0.5 ? col : shade(col, 1.1));
      }
      for (const y of [h / 3, (2 * h) / 3]) L.box(fw, y - 0.012, 0, w - fw, y + 0.012, 0.03, dark);
      for (const [x, y] of [[fw / 2, fw / 2], [w - fw / 2, fw / 2], [fw / 2, h - fw / 2], [w - fw / 2, h - fw / 2]] as const) {
        L.front(x - 0.012, y - 0.012, x + 0.012, y + 0.012, 0.01, STEEL_DARK);
      }
      break;
    }
  }
  return L;
}

/** Поменять стороны полотна толщиной t (отражение по z относительно середины толщины). */
function flipZ(parts: DoorPart[], t: number): DoorPart[] {
  return parts.map((p) => ({ ...p, c: [p.c[0], p.c[1], t - p.c[2]] as [number, number, number] }));
}

/** Отразить детали полотна по x (правые петли). */
function mirror(parts: DoorPart[]): DoorPart[] {
  return parts.map((p) => ({ ...p, c: [-p.c[0], p.c[1], p.c[2]] as [number, number, number], ...(p.rz ? { rz: -p.rz } : {}) }));
}

/** Модель двери: неподвижная часть в координатах двери и полотна (у двустворчатой — два) в своих координатах. */
export function doorGeometry(inp: DoorGeometryInput): DoorGeometry {
  const st = inp.style;
  const W = inp.widthM, H = inp.heightM;
  const frame: DoorPart[] = [];
  const space = inp.space ?? null;
  const fr = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: string, rz?: number) => frame.push(P(x0, y0, z0, x1, y1, z1, color, rz));
  const leafTop = Math.min(H + DOOR_OV, st.leafH ?? Infinity);
  const t = st.thick;
  const zf = -(DOOR_GAP + t); // передняя грань полотна (координаты двери)
  // ── наличник: слева, справа, сверху (обрезан стеной до угла) ──
  const cas = st.casing;
  const top = H + DOOR_CAS_GAP;
  if (cas) {
    const wl = Math.max(0, Math.min(cas.w, (space ? space[0] : Infinity) - DOOR_CAS_GAP - 0.003));
    const wr = Math.max(0, Math.min(cas.w, (space ? space[1] : Infinity) - DOOR_CAS_GAP - 0.003));
    const xl = -W / 2 - DOOR_CAS_GAP, xr = W / 2 + DOOR_CAS_GAP;
    if (wl > 0.005) fr(xl - wl, 0, -cas.t, xl, top + cas.w, 0, cas.color);
    if (wr > 0.005) fr(xr, 0, -cas.t, xr + wr, top + cas.w, 0, cas.color);
    fr(xl, top, -cas.t, xr, top + cas.w, 0, cas.color);
    // фаска-полоска на наличнике (рельеф)
    if (cas.w >= 0.06) {
      const c2 = shade(cas.color, 0.9);
      if (wl > 0.04) fr(xl - wl + 0.015, 0, -cas.t - 0.004, xl - wl + 0.025, top + cas.w - 0.015, -cas.t, c2);
      if (wr > 0.04) fr(xr + wr - 0.025, 0, -cas.t - 0.004, xr + wr - 0.015, top + cas.w - 0.015, -cas.t, c2);
    }
    // у железных — коробка-уголок ещё и в откосе
    if (st.look === 'metal' || st.look === 'hermetic') {
      fr(xl, 0, -0.006, xl + 0.012, top, 0.001, cas.color);
      fr(xr - 0.012, 0, -0.006, xr, top, 0.001, cas.color);
    }
  }
  // ── заполнение над низкой дверью (погреб): доски горизонтально ──
  if (leafTop < H + DOOR_OV - 1e-6) {
    // cellar: доски — в тон полотна cellar_low (серо-бурые, тёмные)
    const fill = '#41372d';
    for (let y = leafTop + DOOR_GAP; y < H + DOOR_CAS_GAP - 1e-6; y += 0.12) {
      fr(-W / 2 - DOOR_CAS_GAP, y, -0.025, W / 2 + DOOR_CAS_GAP, Math.min(H + DOOR_CAS_GAP, y + 0.115), -0.002, doorHash(inp.seed + y.toFixed(2)) % 2 ? fill : shade(fill, 1.12));
    }
    // перекладина над полотном
    fr(-W / 2 - DOOR_CAS_GAP, leafTop + DOOR_GAP, zf - 0.02, W / 2 + DOOR_CAS_GAP, leafTop + DOOR_GAP + 0.06, -0.025, '#3b2e22');
  }
  // ── комингс гермодвери (полотно — над ним) ──
  const y0 = st.look === 'hermetic' ? HERMETIC_SILL : 0;
  if (y0 > 0) fr(-W / 2 - DOOR_CAS_GAP, 0, zf - 0.04, W / 2 + DOOR_CAS_GAP, y0 - 0.004, 0, cas?.color ?? '#4d554c');
  // ── сосульки (снег) ──
  if (st.id === 'snow_iced' && cas) {
    const rnd = rngOf(inp.seed + '#ice');
    for (let x = -W / 2 - 0.05; x < W / 2 + 0.05; x += 0.05 + rnd() * 0.06) {
      const len = 0.05 + rnd() * 0.16;
      fr(x - 0.008, top - len, -cas.t - 0.02, x + 0.008, top + 0.01, -cas.t - 0.004, '#d8e6ee');
    }
    fr(-W / 2 - DOOR_CAS_GAP - cas.w, top + cas.w, -cas.t - 0.01, W / 2 + DOOR_CAS_GAP + cas.w, top + cas.w + 0.04, 0.0, '#eef3f6');
  }
  const leaves: DoorLeafGeo[] = [];
  if (inp.leaf) {
    const hl = leafTop - y0;
    const lw = leafWidth(st, W);
    const mk = (hinge: 'left' | 'right', k: number): DoorLeafGeo => {
      const L = buildLeaf(st, lw, hl, inp.seed, k);
      const right = hinge === 'right';
      // стороны: полотно с «чужой» стороны пары — лицом в эту комнату его обратная сторона
      const flip = !!inp.tag && doorFlip(inp.tag);
      let lp = flip ? flipZ(L.parts, t) : L.parts;
      let hp = L.handle ? (flip ? L.handle.parts.map((p) => ({ ...p, c: [p.c[0], p.c[1], -p.c[2]] as [number, number, number] })) : L.handle.parts) : [];
      if (right) {
        lp = mirror(lp);
        hp = mirror(hp);
      }
      const parts = lp;
      const handle = L.handle
        ? {
            kind: L.handle.kind,
            pivot: [right ? -L.handle.pivot[0] : L.handle.pivot[0], L.handle.pivot[1], flip ? t - L.handle.pivot[2] : L.handle.pivot[2]] as [number, number, number],
            parts: hp,
          }
        : null;
      const x = W / 2 + DOOR_OV;
      return { hinge, axis: [right ? x : -x, zf], y0, sign: right ? -1 : 1, width: lw, height: hl, parts, handle };
    };
    if (st.leaves === 2) {
      leaves.push(mk('left', 0), mk('right', 1));
      // нащельник на правой створке (закрывает щель посередине)
      const r = leaves[1];
      r.parts.push(P(-lw - 0.004, 0.01, -0.006, -lw + 0.03, r.height - 0.01, 0, shade(st.colors[0], 0.9)));
    } else leaves.push(mk(inp.hinge, 0));
  }
  // ── заколоченная (тупик): доски наискось поверх полотна и наличника — на брусках, гвозди. Самозакрывающаяся (общага)
  // не заколочена — просто заперта: её распахивает рука, полотно ходит ──
  // (глухая стена метро — не дверь: без досок; катакомбы: закладка и решётка лаза — тоже)
  if (inp.role === 'dead' && !st.selfClosing && st.look !== 'blind' && st.look !== 'bricked' && st.look !== 'grate') {
    const rnd = rngOf(inp.seed + '#boards');
    // перед самой выступающей деталью полотна (ручка, штурвал)
    let front = zf;
    for (const lf of leaves) {
      for (const p of lf.parts) front = Math.min(front, zf + p.c[2] - p.s[2] / 2);
      if (lf.handle) for (const p of lf.handle.parts) front = Math.min(front, zf + lf.handle.pivot[2] + p.c[2] - p.s[2] / 2);
    }
    const BT = 0.025;
    const zb = front - 0.004 - BT;
    const span = W + 2 * (DOOR_CAS_GAP + (cas ? Math.min(cas.w, 0.06) : 0));
    const ys = [0.55 + rnd() * 0.2, 1.15 + rnd() * 0.15, 1.7 + rnd() * 0.15].filter((y) => y < H - 0.1);
    ys.forEach((y, i) => {
      const a = (rnd() * 2 - 1) * 0.12 + (i === 1 ? 0 : i === 0 ? 0.1 : -0.1);
      const len = span / Math.cos(a);
      const c = rnd() < 0.5 ? '#7c6750' : '#6b5843';
      frame.push({ c: [0, y, zb + BT / 2], s: [len, 0.12, BT], rz: a, color: c });
      for (const sx of [-1, 1]) {
        const xn = sx * (span / 2 - 0.04), yn = y + Math.tan(a) * xn;
        // брусок под концом доски (до наличника / стены) и гвоздь
        fr(xn - 0.03, yn - 0.04, zb + BT, xn + 0.03, yn + 0.04, cas ? -cas.t : 0, '#5a4936');
        frame.push(P(xn - 0.007, yn - 0.007, zb - 0.004, xn + 0.007, yn + 0.007, zb, '#2a2a2a'));
      }
    });
  }
  return { frame, leaves };
}
