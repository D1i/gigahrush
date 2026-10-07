// Общие пространства гигахруща: извилистые коридоры, лифтовые холлы, служебные помещения,
// подвал и техэтаж, общежитие коридорного типа. Размеры — в свету, по типовым сериям.
import type { Room, RoomElite } from '../model/types';
import { I, P, room } from './roomBuilder';

const C_SEAT = '#e9c46a';
const C_FLOOR = '#8ab17d';
const C_STASH = '#e76f51';
const C_ITEM = '#2a9d8f';

const NONE: RoomElite[] = [];
/** Для контор и красного уголка: изредка «зажиточные». */
const ELITE_OFFICE: RoomElite[] = [
  { tierId: 'tier_1', weight: 70 },
  { tierId: 'tier_3', weight: 25 },
  { tierId: 'tier_5', weight: 5 },
];

// ─────────────────────────────── Коридоры ───────────────────────────────

function corrL(): Room {
  return room('corr_L', 'Г-образный коридор малосемейки', {
    tags: ['коридор'],
    gen: { weight: 2, min: 0, max: 99 },
    elite: NONE,
    note:
      'Малосемейка (1-464А/МС, 5–9 эт.): общий коридор 1.8 м с поворотом — короткие плечи 3.4 и 3.8 м. ' +
      'Двустворчатые двери 1.3 м в торцах плеч, 3 квартирные двери 1.0 м в шахматном порядке.',
  })
    .rect(0, 0, 1.8, 3.4)
    .rect(1.8, 1.6, 2.0, 1.8)
    .open('N', 0.2, 'corridor', 'Торец (север)')
    .open('E', 1.8, 'corridor', 'Торец (восток)')
    .open('W', 0.4, 'landing>apt', 'Кв. З1')
    .open('S', 1.8, 'landing>apt', 'Кв. Ю1')
    .open('N', 2.8, 'landing>apt', 'Кв. С1', 1.6)
    .spot('junk', 'У стены', 0.2, 2.6, 270, 'junk')
    .group('junk', 'Вещи жильцов', C_FLOOR, [
      [4, {}],
      [3, { junk: P('p_shoe_rack') }],
      [2, { junk: P('p_boxes') }],
      [1, { junk: P('p_bottle_crate') }],
    ])
    .loot('it_matches', 0.15, 1, 2)
    .build();
}

function corrT(): Room {
  return room('corr_T', 'Т-образный узел коридора', {
    tags: ['коридор'],
    gen: { weight: 1, min: 0, max: 99 },
    elite: NONE,
    note:
      'Узел общих коридоров секционной малосемейки: поперечный коридор 3.8×1.8 м и ответвление 1.8×2.0 м. ' +
      'Три двустворчатые двери 1.3 м (торец, боковая стена, ответвление), две квартирные двери у углов.',
  })
    .rect(0, 0, 3.8, 1.8)
    .rect(1.0, 1.8, 1.8, 2.0)
    .open('W', 0.2, 'corridor', 'Запад')
    .open('N', 2.4, 'corridor', 'Север')
    .open('S', 1.1, 'corridor', 'Юг')
    .open('N', 0.0, 'landing>apt', 'Кв. С1')
    .open('W', 2.7, 'landing>apt', 'Кв. З1', 1.0)
    .spot('floor', 'Мелочь на полу', 1.9, 1.0, 0, 'floor')
    .group('floor', 'Мелочь на полу', C_ITEM, [
      [7, {}],
      [2, { floor: I('it_matches') }],
      [1, { floor: I('it_kopeyki') }],
    ])
    .build();
}

function corrCross(): Room {
  return room('corr_cross', 'Узел коридоров (крестовина со смещёнными проходами)', {
    tags: ['коридор'],
    gen: { weight: 1, min: 0, max: 99 },
    elite: NONE,
    note:
      'Распределительный холл 3.0×3.0 м на стыке секций малосемейки: четыре двустворчатые двери 1.3 м, ' +
      'каждая у своего угла «вертушкой» — из любой двери взгляд упирается в стену.',
  })
    .rect(0, 0, 3.0, 3.0)
    .open('N', 0.1, 'corridor', 'Север')
    .open('E', 0.1, 'corridor', 'Восток')
    .open('S', 1.6, 'corridor', 'Юг')
    .open('W', 1.6, 'corridor', 'Запад')
    .spot('floor', 'Мелочь на полу', 1.5, 1.5, 0, 'floor')
    .group('floor', 'Мелочь на полу', C_ITEM, [
      [8, {}],
      [2, { floor: I('it_matches') }],
    ])
    .build();
}

function corrShort(): Room {
  return room('corr_short', 'Секция коридора с поворотом (4.0 м)', {
    tags: ['коридор'],
    gen: { weight: 2, min: 0, max: 99 },
    elite: NONE,
    note:
      'Короткая секция общего коридора малосемейки 1.8×4.0 м: вход с торца, выход через боковую стену (поворот), ' +
      'две квартирные двери у углов в шахматном порядке.',
  })
    .rect(0, 0, 1.8, 4.0)
    .open('N', 0.2, 'corridor', 'Торец')
    .open('E', 2.6, 'corridor', 'Боковой выход')
    .open('W', 1.5, 'landing>apt', 'Кв. З')
    .open('E', 0.2, 'landing>apt', 'Кв. В')
    .build();
}

function corrNiche(): Room {
  return room('corr_niche', 'Коридор с нишей', {
    tags: ['коридор'],
    gen: { weight: 2, min: 0, max: 99 },
    elite: NONE,
    note:
      'Отрезок общего коридора 1.8×5.6 м с нишей 0.8×1.6 м в уступе стены (там держат велосипеды и санки). ' +
      'Двери 1.3 м в соседние коридоры — в боковых стенах у разных концов, две квартиры.',
  })
    .rect(0, 0, 1.8, 5.6)
    .rect(1.8, 2.0, 0.8, 1.6)
    .open('W', 0.2, 'corridor', 'Выход (запад)')
    .open('E', 4.2, 'corridor', 'Выход (восток)', 1.8)
    .open('W', 3.0, 'landing>apt', 'Кв. З')
    .open('N', 0.4, 'landing>apt', 'Кв. в торце')
    .wall('p_bicycle', 'E', 2.0)
    .spot('niche', 'Перед нишей', 1.3, 2.8, 90, 'niche')
    .group('niche', 'Хлам у ниши', C_FLOOR, [
      [5, {}],
      [3, { niche: P('p_stroller') }],
      [2, { niche: P('p_boxes') }],
    ])
    .build();
}

function corrTurn(): Room {
  return room('corr_turn', 'Переход с поворотом', {
    tags: ['коридор'],
    gen: { weight: 1, min: 0, max: 99 },
    elite: NONE,
    note:
      'Узкий переход 1.4 м между секциями дома с поворотом (плечи 4.0 и 3.6 м), батарея под окном. ' +
      'Двери 1.3 м в концах, дверь 0.9 в служебное помещение.',
  })
    .rect(0, 0, 1.4, 4.0)
    .rect(1.4, 2.6, 2.2, 1.4)
    .open('N', 0.1, 'corridor', 'Север')
    .open('E', 2.7, 'corridor', 'Восток')
    .open('S', 1.8, 'corridor>service', 'Служебная дверь')
    .wall('p_radiator', 'W', 1.0)
    .build();
}

// ─────────────────────────────── Лифты, подъезд ───────────────────────────────

function liftII49(): Room {
  return room('lift_ii49', 'Лифтовой холл II-49 (2 лифта)', {
    tags: ['лифт'],
    gen: { weight: 3, min: 0, max: 99 },
    elite: NONE,
    note:
      'II-49 (панельная 9–12 эт.): лифтовой холл 3.4×3.2 м, пассажирский и грузовой лифт в одной стене. ' +
      'Выход на лестницу, двустворчатая дверь 1.3 м в квартирный коридор, две квартиры — все двери у углов.',
  })
    .rect(0, 0, 3.4, 3.2)
    .open('S', 0.2, 'corridor', 'В квартирный коридор')
    .open('W', 1.6, 'stair', 'На лестницу')
    .open('E', 0.3, 'landing>apt', 'Кв. 1')
    .open('S', 2.2, 'landing>apt', 'Кв. 2')
    // шахты от западного угла, между ними стенка 0.2 м — к двери Кв. 1 за лифтами проход 0.8 м
    .wall('p_lift', 'N', 0)
    .wall('p_lift', 'N', 1.4)
    .spot('floor', 'Мелочь на полу', 1.7, 2.3, 0, 'floor')
    .group('floor', 'Мелочь на полу', C_FLOOR, [
      [6, {}],
      [2, { floor: P('p_trash') }],
      [2, { floor: I('it_matches') }],
    ])
    .build();
}

function lift515(): Room {
  return room('lift_515', 'Лифтовой холл 1-515/9 (1 лифт)', {
    tags: ['лифт'],
    gen: { weight: 3, min: 0, max: 99 },
    elite: NONE,
    note: '1-515/9: лифтовой холл 2.2×3.0 м с одним пассажирским лифтом, две квартиры (двери у разных углов) и выход на лестницу 1.1 м.',
  })
    .rect(0, 0, 2.2, 3.0)
    .open('S', 0.5, 'stair', 'На лестницу')
    .open('W', 1.6, 'landing>apt', 'Кв. 1')
    .open('E', 0.3, 'landing>apt', 'Кв. 2')
    // шахта ближе к западу — к двери Кв. 2 за лифтом проход 0.8 м
    .wall('p_lift', 'N', 0.2)
    .build();
}

function stairwellLift(): Room {
  return room('stairwell_lift', 'Лестничная клетка 9-этажки с лифтом и мусоропроводом', {
    tags: ['лестница', 'лифт'],
    gen: { weight: 0.2, min: 0, max: 99 },
    elite: NONE,
    note:
      '1-515/9: лифт в лестничной клетке. Площадка 2.6×1.4 м у марша (1.1 м) с дверью 1.3 м в поэтажный коридор и проход 1.0×1.4 м вдоль ' +
      'шахты лифта (шахта 1.6×1.4 м — вырез в плане), ствол мусоропровода, две квартиры у разных углов.',
  })
    .rect(0, 0, 2.6, 2.8)
    .cut(1.0, 1.4, 1.6, 1.4)
    .open('N', 0.1, 'stair', 'Марш')
    .open('N', 1.3, 'corridor', 'Дверь в поэтажный коридор')
    .open('E', 0.2, 'landing>apt', 'Кв. 1')
    .open('W', 1.6, 'landing>apt', 'Кв. 2')
    .wall('p_chute', 'S', 0.4)
    // карман у ствола узкий (1.0 м) — мешки оставляют на площадке у стены шахты, не доносят
    .spot('bags', 'Мешки у шахты лифта', 1.3, 1.15, 0, 'bags')
    .group('bags', 'Мешки на площадке', C_FLOOR, [
      [5, {}],
      [5, { bags: P('p_trash') }],
    ])
    .build();
}

function mailHall(): Room {
  return room('mail_hall', 'Почтовый холл 1-го этажа', {
    tags: ['коридор', 'подъезд'],
    gen: { weight: 1, min: 0, max: 1 },
    elite: NONE,
    note:
      'Первый этаж подъезда (1-464, II-49): холл 3.0×3.2 м с почтовыми ящиками, выход к входному тамбуру (1.3 м), ' +
      'марш на этаж, квартира и колясочная — двери у разных углов.',
  })
    .rect(0, 0, 3.0, 3.2)
    .open('N', 1.8, 'stair', 'Марш на этаж')
    .open('S', 0.2, 'corridor', 'Входной тамбур')
    .open('E', 0.4, 'landing>apt', 'Кв. 1')
    .open('W', 2.0, 'corridor>service', 'Колясочная')
    .wall('p_mailboxes', 'W', 0.3)
    .wall('p_radiator', 'E', 2.2)
    .spot('box', 'Под ящиками', 0.35, 1.7, 0, 'mail')
    .group('mail', 'Выпавшая почта', C_ITEM, [
      [7, {}],
      [2, { box: I('it_kopeyki') }],
      [1, { box: I('it_batteries') }],
    ])
    .build();
}

// ─────────────────────────────── Служебное ───────────────────────────────

function svcStroller(): Room {
  return room('svc_stroller', 'Колясочная', {
    tags: ['служебное'],
    gen: { weight: 2, min: 0, max: 99 },
    elite: NONE,
    note: 'Колясочная на первом этаже подъезда 2.0×2.8 м: коляски, велосипед, санки. Дверь 0.9.',
  })
    .rect(0, 0, 2.0, 2.8)
    .open('S', 0.2, 'service>corridor', 'Дверь')
    .wall('p_stroller', 'N', 0.2)
    .wall('p_stroller', 'N', 0.9)
    .wall('p_bicycle', 'E', 1.0)
    .spot('corner', 'В углу', 0.4, 1.7, 0, 'junk')
    .group('junk', 'Хлам', C_FLOOR, [
      [5, {}],
      [3, { corner: P('p_boxes') }],
      [2, { corner: P('p_stroller') }],
    ])
    .loot('it_matches', 0.15, 1, 2)
    .loot('it_batteries', 0.1, 1, 1)
    .build();
}

function svcTrash(): Room {
  return room('svc_trash', 'Мусорокамера', {
    tags: ['служебное'],
    gen: { weight: 2, min: 0, max: 99 },
    elite: NONE,
    note: 'Мусорокамера 9-этажки под стволом мусоропровода: 1.8×2.4 м, баки, дверь 0.9.',
  })
    .rect(0, 0, 1.8, 2.4)
    .open('S', 0.5, 'service>corridor', 'Дверь')
    .wall('p_chute', 'N', 0.65)
    .wall('p_trash', 'W', 0.7)
    .wall('p_trash', 'E', 0.7)
    .spot('pile', 'Куча', 0.9, 1.5, 0, 'pile')
    .group('pile', 'Куча мусора', C_FLOOR, [
      [3, {}],
      [5, { pile: P('p_trash') }],
      [2, { pile: P('p_bottle_crate') }],
    ])
    .loot('it_samogon', 0.03, 1, 1)
    .loot('it_canned', 0.15, 1, 1)
    .build();
}

function svcElectric(): Room {
  return room('svc_electric', 'Электрощитовая', {
    tags: ['служебное'],
    gen: { weight: 2, min: 0, max: 99 },
    elite: NONE,
    note: 'Электрощитовая подъезда 2.0×2.6 м: вводно-распределительное устройство и этажные щиты. Дверь 0.9, обита железом.',
  })
    .rect(0, 0, 2.0, 2.6)
    .open('S', 0.2, 'service>corridor', 'Дверь')
    .wall('p_vru', 'N', 0.2)
    .wall('p_panel', 'E', 0.8)
    .spot('key', 'На щите', 0.8, 0.8, 0, 'key')
    .group('key', 'Забытое на щите', C_ITEM, [
      [6, {}],
      [2, { key: I('it_key_panel') }],
      [2, { key: I('it_components') }],
    ])
    .loot('it_components', 0.2, 1, 2)
    .build();
}

function svcHeat(): Room {
  return room('svc_heat', 'Тепловой узел (бойлерная)', {
    tags: ['служебное', 'подвал'],
    gen: { weight: 1, min: 0, max: 2 },
    elite: NONE,
    note: 'Индивидуальный тепловой пункт в подвале: 3.6×3.0 м, баки-теплообменники, пучок труб. Двери в коридор (0.9) и в подвальный ход (1.0).',
  })
    .rect(0, 0, 3.6, 3.0)
    .open('W', 1.8, 'service>corridor', 'Дверь в коридор')
    .open('S', 2.2, 'basement', 'Подвальный ход')
    .wall('p_boiler_tank', 'N', 0.3)
    .wall('p_boiler_tank', 'N', 1.4)
    .wall('p_pipes', 'E', 0.5)
    .spot('floor', 'У бака', 1.2, 1.6, 0, 'floor')
    .group('floor', 'У бака', C_ITEM, [
      [7, {}],
      [3, { floor: I('it_matches') }],
    ])
    .build();
}

function svcRedCorner(): Room {
  return room('svc_red_corner', 'Красный уголок', {
    tags: ['служебное'],
    gen: { weight: 1, min: 0, max: 1 },
    elite: ELITE_OFFICE,
    note: 'Красный уголок ЖЭКа на первом этаже: 4.2×5.0 м (21 м²), бюст Ленина, стол президиума, скамьи, шахматы. Дверь 0.9.',
  })
    .rect(0, 0, 4.2, 5.0)
    .open('S', 0.3, 'service>corridor', 'Дверь')
    .wall('p_lenin', 'N', 1.85)
    .wall('p_office_desk', 'N', 1.5, { off: 0.6 })
    .put('p_bench', 1.2, 2.3, 180)
    .put('p_bench', 3.0, 2.3, 180)
    .put('p_bench', 1.2, 3.2, 180)
    .put('p_bench', 3.0, 3.2, 180)
    .put('p_chess', 3.6, 4.4)
    .wall('p_radiator', 'W', 0.5)
    .wall('p_bookshelf', 'E', 0.4)
    .spot('desk', 'На столе президиума', 2.1, 0.95, 0, 'desk')
    .group('desk', 'На столе президиума', C_ITEM, [
      [6, {}],
      [3, { desk: I('it_kopeyki') }],
      [1, { desk: I('it_samogon') }],
    ])
    .loot('it_kopeyki', 0.3, 1, 4)
    .build();
}

function svcZhek(): Room {
  return room('svc_zhek', 'Кабинет ЖЭК', {
    tags: ['служебное'],
    gen: { weight: 1, min: 0, max: 1 },
    elite: ELITE_OFFICE,
    note: 'Кабинет техника-смотрителя ЖЭКа: 3.0×4.0 м, канцелярский стол, шкафчики, инструменты. Дверь 0.9.',
  })
    .rect(0, 0, 3.0, 4.0)
    .open('S', 0.2, 'service>corridor', 'Дверь')
    .wall('p_office_desk', 'W', 1.0)
    .wall('p_locker', 'E', 0.3)
    .wall('p_locker', 'E', 0.9)
    .wall('p_tool_cab', 'E', 2.0)
    .wall('p_shelf', 'N', 0.8)
    .spot('chair', 'Стул техника', 0.95, 1.6, 270, 'chair')
    .spot('keys', 'Ключи на столе', 0.35, 1.3, 0, 'keys')
    .group('chair', 'Стул', C_SEAT, [
      [2, {}],
      [8, { chair: P('p_chair') }],
    ])
    .group('keys', 'Ключи на столе', C_ITEM, [
      [6, {}],
      [4, { keys: I('it_key_panel') }],
    ])
    .loot('it_kopeyki', 0.3, 1, 3)
    .loot('it_key_panel', 0.1, 1, 1)
    .build();
}

function svcLaundry(): Room {
  return room('svc_laundry', 'Прачечная-сушилка', {
    tags: ['служебное'],
    gen: { weight: 1, min: 0, max: 99 },
    elite: NONE,
    note: 'Общая прачечная-сушилка на техническом этаже / в общежитии: 3.2×4.4 м, три «Вятки», ряд раковин, сушилки. Дверь 0.9.',
  })
    .rect(0, 0, 3.2, 4.4)
    .open('S', 0.2, 'service>corridor', 'Дверь')
    .wall('p_washer', 'N', 0.2)
    .wall('p_washer', 'N', 0.9)
    .wall('p_washer', 'N', 1.6)
    .wall('p_sink_row', 'E', 0.3)
    .put('p_drying_rack', 1.3, 2.4)
    .put('p_drying_rack', 1.3, 3.4)
    .loot('it_bandage', 0.15, 1, 2)
    .build();
}

// ─────────────────────────────── Подвал и техэтаж ───────────────────────────────

function bsmStairs(): Room {
  return room('bsm_stairs', 'Спуск в подвал', {
    tags: ['подвал'],
    gen: { weight: 0.7, min: 0, max: 99 },
    elite: NONE,
    note: 'Марш в подвал из-под лестницы первого этажа (1.1 м) и нижняя площадка 2.4×1.2 м с дверью в подвальный ход.',
  })
    .rect(0, 0, 1.1, 2.6)
    .rect(0, 2.6, 2.4, 1.2)
    .open('N', 0, 'stair', 'Марш наверх')
    .open('E', 2.7, 'basement', 'Дверь в подвал')
    // в углу площадки у подножия марша, а не перед дверью в подвал
    .spot('floor', 'В углу площадки', 0.3, 3.5, 0, 'floor')
    .group('floor', 'На площадке', C_FLOOR, [
      [6, {}],
      [3, { floor: P('p_trash') }],
      [1, { floor: P('p_bottle_crate') }],
    ])
    .build();
}

function bsmPassageL(): Room {
  return room('bsm_passage_L', 'Подвальный ход Г-образный', {
    tags: ['подвал'],
    gen: { weight: 0.4, min: 0, max: 99 },
    elite: NONE,
    note: 'Подвал пятиэтажки: ход 1.1 м вдоль клетушек жильцов, поворот под прямым углом (плечи 4.0 и 4.5 м).',
  })
    .rect(0, 0, 1.1, 4.0)
    .rect(1.1, 2.9, 3.4, 1.1)
    .open('N', 0.1, 'basement', 'Ход (север)')
    .open('E', 3.0, 'basement', 'Ход (восток)')
    .open('W', 0.6, 'basement>storage', 'Клетушка 1')
    .open('E', 1.6, 'basement>storage', 'Клетушка 2', 1.1)
    .open('S', 1.8, 'basement>storage', 'Клетушка 3')
    .open('N', 2.6, 'basement>storage', 'Клетушка 4', 2.9)
    .spot('floor', 'На полу', 0.55, 2.2, 0, 'floor')
    .group('floor', 'На полу', C_ITEM, [
      [7, {}],
      [2, { floor: I('it_matches') }],
      [1, { floor: I('it_canned') }],
    ])
    .build();
}

function bsmNode(): Room {
  return room('bsm_node', 'Подвальный узел с колонной', {
    tags: ['подвал'],
    gen: { weight: 0.3, min: 0, max: 99 },
    elite: NONE,
    note: 'Развилка подвальных ходов 3.0×3.0 м вокруг колонны 0.4×0.4 м: три хода и дверь в служебку, «вертушкой» у разных углов.',
  })
    .rect(0, 0, 3.0, 3.0)
    .cut(1.3, 1.3, 0.4, 0.4)
    .open('N', 0.1, 'basement', 'Север')
    .open('E', 0.1, 'basement', 'Восток')
    .open('W', 1.9, 'basement', 'Запад')
    .open('S', 1.9, 'corridor>service', 'Служебка')
    // у северной грани колонны: кольцо вокруг неё сужается до 0.8 м, створы дверей свободны
    .spot('corner', 'У колонны', 1.5, 1.05, 0, 'junk')
    .group('junk', 'Хлам у колонны', C_FLOOR, [
      [5, {}],
      [3, { corner: P('p_boxes') }],
      [2, { corner: P('p_trash') }],
    ])
    .build();
}

function bsmColumns(): Room {
  return room('bsm_columns', 'Техподполье с колоннами', {
    tags: ['подвал'],
    gen: { weight: 0.3, min: 0, max: 99 },
    elite: NONE,
    note: 'Техподполье панельного дома: 5.0×4.2 м, две колонны 0.4×0.4 м, трубы отопления вдоль стены, три клетушки.',
  })
    .rect(0, 0, 5.0, 4.2)
    .cut(1.5, 1.9, 0.4, 0.4)
    .cut(3.3, 1.9, 0.4, 0.4)
    .open('W', 0.3, 'basement', 'Запад')
    .open('E', 2.8, 'basement', 'Восток')
    .open('N', 0.3, 'basement>storage', 'Клетушка 1')
    .open('N', 4.0, 'basement>storage', 'Клетушка 2')
    .open('S', 2.2, 'basement>storage', 'Клетушка 3')
    .wall('p_pipes', 'S', 0.2)
    .wall('p_pipes', 'S', 3.0)
    .spot('b1', 'У колонны 1', 1.0, 1.2, 0, 'junk')
    .spot('b2', 'У колонны 2', 2.6, 1.2, 0, 'junk')
    .group('junk', 'Хлам', C_FLOOR, [
      [4, {}],
      [3, { b1: P('p_boxes') }],
      [3, { b1: P('p_boxes'), b2: P('p_trash') }],
    ])
    .loot('it_matches', 0.15, 1, 2)
    .build();
}

function bsmStorage(): Room {
  return room('bsm_storage', 'Подвальная клетушка', {
    tags: ['кладовка', 'подвал'],
    gen: { weight: 0.8, min: 0, max: 99 },
    note: 'Сарайка жильца в подвале: 1.4×2.0 м за решётчатой дверью 0.7. Стеллаж с банками, коробки.',
  })
    .rect(0, 0, 1.4, 2.0)
    .open('S', 0.3, 'storage>basement', 'Решётчатая дверь')
    .wall('p_shelf', 'N', 0.2)
    .wall('p_boxes', 'W', 0.6)
    .spot('shelf', 'На стеллаже', 0.7, 0.2, 0, 'stash')
    .group('stash', 'Заначка', C_STASH, [
      [4, {}],
      [3, { shelf: I('it_canned') }],
      [2, { shelf: I('it_batteries') }],
      [1, { shelf: I('it_samogon') }],
    ])
    .loot('it_matches', 0.2, 1, 2)
    .build();
}

function bsmStorageMoon(): Room {
  return room('bsm_storage_moon', 'Клетушка самогонщика', {
    tags: ['кладовка', 'подвал', 'самогон'],
    unique: true,
    gen: { weight: 1, min: 0, max: 1 },
    elite: [{ tierId: 'tier_8', weight: 100 }],
    note: 'Тематическая: подвальная сарайка 1.4×2.0 м, где хранят продукт — ящики с бутылками. Всегда «Закрома» (элитность 8).',
  })
    .rect(0, 0, 1.4, 2.0)
    .open('S', 0.3, 'storage>basement', 'Решётчатая дверь')
    .wall('p_bottle_crate', 'N', 0.1)
    .wall('p_bottle_crate', 'W', 0.6)
    .wall('p_bottle_crate', 'E', 0.6)
    .loot('it_samogon', 0.5, 1, 2)
    .build();
}

function attic(): Room {
  return room('attic_tech', 'Техэтаж 9-этажки', {
    tags: ['подвал', 'чердак'],
    gen: { weight: 1, min: 0, max: 1 },
    elite: NONE,
    note: 'Технический этаж (1-515/9, II-49): 5.0×3.6 м, колонны 0.4×0.4 м, трубы и расширительный бак. Выход с лестницы и лаз в техходы — у разных углов.',
  })
    .rect(0, 0, 5.0, 3.6)
    .cut(1.6, 1.6, 0.4, 0.4)
    .cut(3.2, 1.6, 0.4, 0.4)
    .open('W', 0.2, 'stair', 'Выход с лестницы')
    .open('E', 2.4, 'basement', 'Лаз в техходы')
    .wall('p_pipes', 'N', 0.3)
    .wall('p_pipes', 'N', 2.7)
    .wall('p_boiler_tank', 'S', 0.4)
    .spot('floor', 'У бака', 2.5, 3.0, 0, 'floor')
    .group('floor', 'У бака', C_ITEM, [
      [6, {}],
      [3, { floor: I('it_components') }],
      [1, { floor: I('it_samogon') }],
    ])
    .build();
}

// ─────────────────────────────── Общежитие ───────────────────────────────

function dormVestibule(): Room {
  return room('dorm_vestibule', 'Вестибюль общежития с вахтой', {
    tags: ['общежитие'],
    gen: { weight: 2, min: 0, max: 4 },
    elite: NONE,
    note: 'Общежитие коридорного типа (1-447С, 1-464А): вестибюль 4.0×3.6 м, стол вахтёра, вешалка, скамья. Входные двери, коридор этажа и лестница — у разных углов.',
  })
    .rect(0, 0, 4.0, 3.6)
    .open('S', 2.6, 'corridor', 'Входные двери')
    .open('N', 0.1, 'corridor', 'В коридор этажа')
    .open('E', 1.2, 'stair', 'Лестница')
    .wall('p_office_desk', 'W', 1.2)
    .wall('p_coat_hooks', 'N', 2.2)
    .wall('p_bench', 'S', 0)
    .spot('chair', 'Вахтёр', 0.95, 1.8, 270, 'chair')
    .group('chair', 'Стул вахтёра', C_SEAT, [
      [2, {}],
      [8, { chair: P('p_chair') }],
    ])
    .loot('it_key_panel', 0.05, 1, 1)
    .build();
}

function dormCorrL(): Room {
  return room('dorm_corr_L', 'Коридор общежития с поворотом', {
    tags: ['общежитие'],
    gen: { weight: 1, min: 0, max: 99 },
    elite: NONE,
    note: 'Коридор общежития 2.0 м с поворотом (плечи 4.0 и 4.4 м): двери 0.9 в жилые комнаты, кухню, умывальную и служебка — в шахматном порядке.',
  })
    .rect(0, 0, 2.0, 4.0)
    .rect(2.0, 2.0, 2.4, 2.0)
    .open('N', 0.3, 'corridor', 'Торец (север)')
    .open('E', 2.3, 'corridor', 'Торец (восток)')
    .open('W', 0.1, 'corridor>dorm', 'Комната 1')
    .open('E', 1.0, 'corridor>service', 'Служебка', 2.0)
    .open('S', 2.2, 'corridor>dorm', 'Комната 2')
    .open('N', 3.2, 'corridor>dorm', 'Комната 3', 2.0)
    .spot('bike', 'У стены', 0.25, 2.8, 270, 'junk')
    .group('junk', 'Вещи в коридоре', C_FLOOR, [
      [4, {}],
      [3, { bike: P('p_bicycle') }],
      [3, { bike: P('p_shoe_rack') }],
    ])
    .loot('it_matches', 0.15, 1, 2)
    .build();
}

function dormCorr(): Room {
  return room('dorm_corr', 'Коридор общежития (секция 5 м)', {
    tags: ['общежитие'],
    gen: { weight: 2, min: 0, max: 99 },
    elite: NONE,
    note: 'Секция коридора общежития 2.0×5.0 м: выходы 1.3 м в соседние секции в боковых стенах (уступом), две двери 0.9 в комнаты и служебка в торце.',
  })
    .rect(0, 0, 2.0, 5.0)
    .open('W', 0.2, 'corridor', 'Выход (запад)')
    .open('E', 3.6, 'corridor', 'Выход (восток)')
    .open('W', 2.6, 'corridor>dorm', 'Комната 1')
    .open('E', 1.6, 'corridor>dorm', 'Комната 2')
    .open('S', 1.0, 'corridor>service', 'Служебка')
    .spot('w', 'У стены', 0.25, 2.1, 270, 'junk')
    .group('junk', 'Вещи в коридоре', C_FLOOR, [
      [5, {}],
      [3, { w: P('p_shoe_rack') }],
      [2, { w: P('p_boxes') }],
    ])
    .build();
}

function dormRoom2(): Room {
  return room('dorm_room2', 'Комната общежития на двоих', {
    tags: ['общежитие', 'жилая'],
    gen: { weight: 4, min: 0, max: 99 },
    note: 'Жилая комната общежития 2.8×4.3 м (12 м², норма на двоих): две кровати вдоль стен, стол у окна, шкаф. Дверь 0.9 из коридора.',
  })
    .rect(0, 0, 2.8, 4.3)
    .open('S', 0.2, 'dorm>corridor', 'Дверь в коридор')
    .put('p_bed1', 0.45, 1.3)
    .put('p_bed1', 2.35, 1.3)
    .wall('p_radiator', 'N', 1.0)
    .wall('p_table_kitchen', 'N', 0.95, { off: 0.2 })
    .wall('p_wardrobe', 'S', 1.6)
    .wall('p_bookshelf', 'W', 2.5)
    .spot('st1', 'Табурет 1', 1.4, 1.2, 0, 'stools')
    .spot('st2', 'Табурет 2', 1.4, 1.65, 0, 'stools')
    .spot('top', 'На столе', 1.4, 0.5, 0, 'table')
    .group('stools', 'Табуреты', C_SEAT, [
      [2, {}],
      [5, { st1: P('p_stool') }],
      [3, { st1: P('p_stool'), st2: P('p_stool') }],
    ])
    .group('table', 'На столе', C_ITEM, [
      [6, {}],
      [2, { top: I('it_canned') }],
      [2, { top: I('it_samogon') }],
    ])
    .loot('it_matches', 0.3, 1, 2)
    .loot('it_kopeyki', 0.25, 1, 3)
    .build();
}

function dormRoom3(): Room {
  return room('dorm_room3', 'Комната общежития на троих', {
    tags: ['общежитие', 'жилая'],
    gen: { weight: 2, min: 0, max: 99 },
    note: 'Комната общежития 3.0×5.2 м (15.6 м²) на троих: три кровати, стол, шкаф. Дверь 0.9 из коридора.',
  })
    .rect(0, 0, 3.0, 5.2)
    .open('S', 0.2, 'dorm>corridor', 'Дверь в коридор')
    .put('p_bed1', 0.45, 1.2)
    .put('p_bed1', 0.45, 3.4)
    .put('p_bed1', 2.55, 1.2)
    .wall('p_radiator', 'N', 1.1)
    .wall('p_table_kitchen', 'E', 2.8)
    .wall('p_wardrobe', 'S', 1.9)
    .spot('st1', 'Табурет', 1.95, 3.25, 0, 'stools')
    .group('stools', 'Табуреты', C_SEAT, [
      [3, {}],
      [7, { st1: P('p_stool') }],
    ])
    .loot('it_matches', 0.3, 1, 2)
    .loot('it_kopeyki', 0.3, 1, 3)
    .build();
}

function dormKitchen(): Room {
  return room('dorm_kitchen', 'Общая кухня общежития', {
    tags: ['общежитие', 'кухня-общая'],
    gen: { weight: 2, min: 0, max: 99 },
    note: 'Общая кухня на этаж общежития: 3.0×4.2 м, три газовые плиты, две мойки, общий стол. Дверь 0.9 из коридора.',
  })
    .rect(0, 0, 3.0, 4.2)
    .open('S', 0.2, 'dorm>corridor', 'Дверь в коридор')
    .wall('p_stove', 'E', 0.3)
    .wall('p_stove', 'E', 0.9)
    .wall('p_stove', 'E', 1.5)
    .wall('p_sink_kitchen', 'N', 0.3)
    .wall('p_sink_kitchen', 'N', 1.0)
    .wall('p_table_kitchen', 'W', 2.0)
    .spot('pot', 'На плите', 2.7, 1.15, 0, 'pot')
    .spot('st1', 'Табурет 1', 0.85, 2.25, 0, 'stools')
    .spot('st2', 'Табурет 2', 0.85, 2.7, 0, 'stools')
    .group('pot', 'Кастрюля на плите', C_ITEM, [
      [6, {}],
      [4, { pot: I('it_canned') }],
    ])
    .group('stools', 'Табуреты', C_SEAT, [
      [3, {}],
      [4, { st1: P('p_stool') }],
      [3, { st1: P('p_stool'), st2: P('p_stool') }],
    ])
    .loot('it_matches', 0.35, 1, 3)
    .loot('it_canned', 0.3, 1, 2)
    .build();
}

function dormWashroom(): Room {
  return room('dorm_washroom', 'Умывальная общежития', {
    tags: ['общежитие', 'умывальная'],
    gen: { weight: 2, min: 0, max: 99 },
    note: 'Умывальная на этаж общежития 2.4×3.6 м: два ряда раковин вдоль стен. Дверь 0.9 из коридора.',
  })
    .rect(0, 0, 2.4, 3.6)
    .open('S', 0.2, 'dorm>corridor', 'Дверь в коридор')
    .wall('p_sink_row', 'W', 0.3)
    .wall('p_sink_row', 'E', 0.3)
    .loot('it_bandage', 0.15, 1, 1)
    .build();
}

function dormShower(): Room {
  return room('dorm_shower', 'Душевая общежития', {
    tags: ['общежитие', 'душевая'],
    gen: { weight: 1, min: 0, max: 99 },
    note: 'Душевая общежития 2.4×3.0 м: три кабинки 0.9×0.9 м, скамья для одежды. Дверь 0.9.',
  })
    .rect(0, 0, 2.4, 3.0)
    .open('S', 0.2, 'dorm>corridor', 'Дверь в коридор')
    .wall('p_shower', 'N', 0.2)
    .wall('p_shower', 'N', 1.3)
    .wall('p_shower', 'E', 1.3)
    .wall('p_bench', 'W', 1.2)
    .loot('it_bandage', 0.1, 1, 1)
    .build();
}

// ─────────────────────── Поэтажные хабы (рост вширь, а не по маршам) ───────────────────────

function tambour2(): Room {
  return room('tambour_2', 'Тамбур на 2 квартиры', {
    tags: ['коридор'],
    gen: { weight: 3, min: 0, max: 99 },
    elite: NONE,
    note:
      'Поэтажный тамбур хрущёвки / 9-этажки 1.8×2.0 м, отгороженный жильцами от площадки: двустворчатая дверь 1.3 м ' +
      'у угла и две входные двери 1.0 м на боковых стенах со сдвигом.',
  })
    .rect(0, 0, 1.8, 2.0)
    .open('N', 0.1, 'corridor', 'Дверь на площадку')
    .open('W', 1.0, 'landing>apt', 'Кв. 1')
    .open('E', 0.0, 'landing>apt', 'Кв. 2')
    .build();
}

function floorCorrII49(): Room {
  return room('floor_corr_ii49', 'Поэтажный коридор II-49 (секция 5 м)', {
    tags: ['коридор'],
    gen: { weight: 2, min: 0, max: 99 },
    elite: NONE,
    note:
      'II-49: квартирный коридор 1.6×5.0 м за лифтовым холлом. Двустворчатые двери 1.3 м в боковых стенах у разных концов, ' +
      'три квартиры в шахматном порядке (одна в торце).',
  })
    .rect(0, 0, 1.6, 5.0)
    .open('W', 0.2, 'corridor', 'Выход (запад)')
    .open('E', 3.7, 'corridor', 'Выход (восток)')
    .open('W', 2.6, 'landing>apt', 'Кв. З')
    .open('E', 1.5, 'landing>apt', 'Кв. В')
    .open('N', 0.3, 'landing>apt', 'Кв. в торце')
    .spot('w', 'У стены', 0.2, 1.9, 270, 'junk')
    .group('junk', 'Вещи жильцов', C_FLOOR, [
      [5, {}],
      [3, { w: P('p_shoe_rack') }],
      [2, { w: P('p_boxes') }],
    ])
    .build();
}

function liftHallCorr(): Room {
  return room('lift_hall_corr', 'Лифтовой холл 1-515/9 (выход в коридор)', {
    tags: ['лифт'],
    gen: { weight: 2, min: 0, max: 99 },
    elite: NONE,
    note:
      '1-515/9, секция с лифтом в холле: холл 2.4×2.8 м, пассажирский лифт, двустворчатая дверь 1.3 м в поэтажный ' +
      'коридор и две квартиры у разных углов. Лестница — через коридор.',
  })
    .rect(0, 0, 2.4, 2.8)
    .open('S', 0.1, 'corridor', 'В поэтажный коридор')
    .open('W', 1.5, 'landing>apt', 'Кв. 1')
    .open('E', 0.3, 'landing>apt', 'Кв. 2')
    .wall('p_lift', 'N', 0.6)
    .build();
}

export function buildPublicRooms(): Room[] {
  return [
    corrL(), corrT(), corrCross(), corrShort(), corrNiche(), corrTurn(),
    tambour2(), floorCorrII49(), liftHallCorr(),
    liftII49(), lift515(), stairwellLift(), mailHall(),
    svcStroller(), svcTrash(), svcElectric(), svcHeat(), svcRedCorner(), svcZhek(), svcLaundry(),
    bsmStairs(), bsmPassageL(), bsmNode(), bsmColumns(), bsmStorage(), bsmStorageMoon(), attic(),
    dormVestibule(), dormCorrL(), dormCorr(), dormRoom2(), dormRoom3(), dormKitchen(), dormWashroom(), dormShower(),
  ];
}
