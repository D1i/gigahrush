// Квартиры других серий (II-49, 1-515, 1-447 со смежными комнатами, «распашонка») и
// варианты обстановки существующих типовых помещений (та же геометрия — другая мебель).
import type { Room } from '../model/types';
import { I, P, room } from './roomBuilder';

const C_SEAT = '#e9c46a';
const C_TABLE = '#f4a261';
const C_FLOOR = '#8ab17d';
const C_STASH = '#e76f51';
const C_ITEM = '#2a9d8f';

// ─────────────────────────────── II-49 (брежневка) ───────────────────────────────

function foyerII49(): Room {
  return room('foyer_ii49', 'Прихожая II-49 (коридор с поворотом)', {
    tags: ['прихожая'],
    gen: { weight: 3, min: 0, max: 99 },
    note:
      'II-49 (панельная 9-этажка, 1965–1985), 2–3-комн.: входная зона 1.4×2.2 м и коридор 3.2×1.0 м к кухне ' +
      '(6.3 м²). Двери у углов в шахматном порядке: ванная и туалет с одной стороны коридора, спальня и кладовка — с другой, кухня в торце.',
  })
    .rect(0, 0, 1.4, 2.2)
    .rect(1.4, 1.2, 3.2, 1.0)
    .open('W', 0.2, 'apt>landing', 'Входная дверь')
    .open('N', 0.3, 'hall>room', 'Большая комната')
    .open('N', 1.4, 'hall>bath', 'Ванная', 1.2)
    .open('N', 2.2, 'hall>wc', 'Туалет', 1.2)
    .open('S', 3.0, 'hall>room', 'Спальня')
    .open('S', 3.9, 'hall>closet', 'Кладовка')
    .open('E', 1.3, 'hall>kitchen', 'Кухня')
    .wall('p_coat_rack', 'S', 0.2)
    .wall('p_shoe_rack', 'N', 3.5, { at: 1.2 })
    .loot('it_matches', 0.25, 1, 2)
    .loot('it_kopeyki', 0.2, 1, 3)
    .build();
}

function kitchenII49(): Room {
  return room('kitchen_ii49', 'Кухня II-49', {
    tags: ['кухня'],
    gen: { weight: 3, min: 0, max: 99 },
    note:
      'II-49: кухня 2.6×2.8 м (7.2 м² за вычетом вентблока 0.3×0.4). Дверь 0.8 сбоку у угла, ' +
      'мойка-тумба-плита вдоль стены с вентблоком, холодильник «ЗИЛ», стол у окна.',
  })
    .rect(0, 0, 2.6, 2.8)
    .cut(0, 0, 0.3, 0.4)
    .open('W', 1.8, 'kitchen>hall', 'Дверь из прихожей')
    .wall('p_sink_kitchen', 'N', 0.4)
    .wall('p_kitchen_counter', 'N', 1.0)
    .wall('p_stove', 'N', 1.6)
    .wall('p_fridge_zil', 'E', 0.8)
    .wall('p_radiator', 'S', 1.3)
    .wall('p_table_kitchen', 'S', 1.2, { off: 0.2 })
    .spot('st1', 'Табурет 1', 1.4, 1.75, 0, 'stools')
    .spot('st2', 'Табурет 2', 1.9, 1.75, 0, 'stools')
    .spot('st3', 'Табурет 3', 0.95, 2.3, 0, 'stools')
    .spot('top', 'На столе', 1.65, 2.3, 0, 'bottles')
    .group('stools', 'Кухонный стол', C_SEAT, [
      [2, {}],
      [4, { st1: P('p_stool') }],
      [3, { st1: P('p_stool'), st3: P('p_stool') }],
      [1, { st1: P('p_stool'), st2: P('p_stool'), st3: P('p_stool') }],
    ])
    .group('bottles', 'Бутылки на столе', C_TABLE, [
      [85, {}],
      [15, { top: I('it_samogon') }],
    ])
    .loot('it_matches', 0.3, 1, 3)
    .loot('it_canned', 0.25, 1, 2)
    .build();
}

function bathII49(): Room {
  return room('bath_ii49', 'Ванная II-49', {
    tags: ['санузел'],
    gen: { weight: 2, min: 0, max: 99 },
    note: 'II-49: ванная раздельного санузла 1.6×1.7 м (2.7 м²): ванна 1.5 м, раковина, «Вятка». Дверь 0.7.',
  })
    .rect(0, 0, 1.6, 1.7)
    .open('N', 0.1, 'bath>hall', 'Дверь')
    .wall('p_bath', 'S', 0.1)
    .wall('p_washbasin', 'W', 0.35)
    .wall('p_washer', 'E', 0.35)
    .loot('it_bandage', 0.2, 1, 2)
    .loot('it_medkit', 0.05, 1, 1)
    .build();
}

function wcII49(): Room {
  return room('wc_ii49', 'Туалет II-49', {
    tags: ['санузел'],
    gen: { weight: 2, min: 0, max: 99 },
    note: 'II-49: туалет 0.8×1.3 м (1.0 м²), дверь 0.7 во всю ширину стены.',
  })
    .rect(0, 0, 0.8, 1.3)
    .open('N', 0.1, 'wc>hall', 'Дверь')
    .wall('p_toilet', 'S', 0.22)
    .spot('tank', 'За бачком', 0.4, 1.2, 0, 'stash')
    .group('stash', 'Заначка', C_STASH, [
      [17, {}],
      [2, { tank: I('it_samogon') }],
      [1, { tank: I('it_kopeyki') }],
    ])
    .build();
}

function roomII49Big(): Room {
  return room('room_ii49_big', 'Большая комната II-49', {
    tags: ['жилая'],
    gen: { weight: 2, min: 0, max: 99 },
    note:
      'II-49: большая комната 3.4×5.4 м (18.4 м²), дверь 0.9 из прихожей, балконная дверь 0.8. ' +
      'Стенка, диван, круглый стол посреди комнаты, ковёр.',
  })
    .rect(0, 0, 3.4, 5.4)
    .open('N', 0.2, 'room>hall', 'Дверь из прихожей')
    .open('S', 2.4, 'room>balcony', 'Балконная дверь')
    .put('p_rug_big', 1.55, 2.8)
    .wall('p_stenka', 'W', 1.3)
    .wall('p_sofa', 'E', 1.6)
    .wall('p_radiator', 'S', 1.2)
    .wall('p_armchair', 'S', 0.2)
    // стол чуть ближе к дивану: между стенкой и столом остаётся проход 0.65 м
    .put('p_table_round', 1.65, 2.6)
    .spot('c1', 'Стул 1', 1.65, 1.7, 0, 'chairs')
    .spot('c2', 'Стул 2', 1.65, 3.5, 180, 'chairs')
    .group('chairs', 'Стулья у стола', C_SEAT, [
      [2, {}],
      [5, { c1: P('p_chair') }],
      [3, { c1: P('p_chair'), c2: P('p_chair') }],
    ])
    .loot('it_kopeyki', 0.3, 1, 4)
    .loot('it_matches', 0.2, 1, 2)
    .build();
}

function roomII49Bed(): Room {
  return room('room_ii49_bed', 'Спальня II-49', {
    tags: ['жилая'],
    gen: { weight: 3, min: 0, max: 99 },
    note: 'II-49: изолированная спальня 2.8×4.3 м (12.0 м²), дверь 0.9 у угла. Двуспальная кровать, шкаф, комод, трюмо.',
  })
    .rect(0, 0, 2.8, 4.3)
    .open('N', 1.7, 'room>hall', 'Дверь из прихожей')
    .wall('p_bed2', 'W', 1.2)
    .wall('p_wardrobe', 'N', 0.3)
    .wall('p_nightstand', 'W', 0.75)
    .wall('p_radiator', 'S', 1.0)
    .wall('p_komod', 'E', 2.0)
    .wall('p_trumo', 'E', 3.2)
    .spot('mat', 'Под матрасом', 1.0, 2.0, 0, 'stash')
    .group('stash', 'Заначка под матрасом', C_STASH, [
      [8, {}],
      [2, { mat: I('it_kopeyki') }],
    ])
    .loot('it_kopeyki', 0.25, 1, 3)
    .build();
}

// ─────────────────────────────── 1-515 ───────────────────────────────

function kitchen515(): Room {
  return room('kitchen_515', 'Кухня 1-515', {
    tags: ['кухня'],
    gen: { weight: 3, min: 0, max: 99 },
    note: '1-515 (панельная 5/9 эт.): кухня 2.4×2.9 м (6.8 м² за вычетом вентблока 0.3×0.4). Дверь 0.8, окно в торце.',
  })
    .rect(0, 0, 2.4, 2.9)
    .cut(2.1, 0, 0.3, 0.4)
    .open('N', 0.2, 'kitchen>hall', 'Дверь из прихожей')
    .wall('p_sink_kitchen', 'E', 0.4)
    .wall('p_kitchen_counter', 'E', 1.0)
    .wall('p_stove', 'E', 1.6)
    .wall('p_fridge_zil', 'W', 0.8)
    .wall('p_radiator', 'S', 0.75)
    .wall('p_table_kitchen', 'S', 0.7, { off: 0.2 })
    .spot('st1', 'Табурет 1', 0.95, 1.8, 0, 'stools')
    .spot('st2', 'Табурет 2', 1.45, 1.8, 0, 'stools')
    .spot('top', 'На столе', 1.15, 2.4, 0, 'bottles')
    .group('stools', 'Кухонный стол', C_SEAT, [
      [2, {}],
      [5, { st1: P('p_stool') }],
      [3, { st1: P('p_stool'), st2: P('p_stool') }],
    ])
    .group('bottles', 'Бутылки на столе', C_TABLE, [
      [85, {}],
      [15, { top: I('it_samogon') }],
    ])
    .loot('it_matches', 0.3, 1, 3)
    .loot('it_canned', 0.2, 1, 2)
    .build();
}

function foyer515(): Room {
  return room('foyer_515', 'Прихожая 1-515 (Г-образная)', {
    tags: ['прихожая'],
    gen: { weight: 3, min: 0, max: 99 },
    note:
      '1-515, 2-комн. с изолированными комнатами: Г-образная прихожая 1.3×2.8 + 1.8×1.0 м (5.4 м²). ' +
      'Двери у углов на разных стенах: входная 1.0, две комнаты 0.9, кухня 0.8, совмещённый санузел 0.7, кладовка 0.6.',
  })
    .rect(0, 0, 1.3, 2.8)
    .rect(1.3, 0, 1.8, 1.0)
    .open('S', 0.2, 'apt>landing', 'Входная дверь')
    .open('E', 0.1, 'hall>kitchen', 'Кухня')
    .open('N', 1.6, 'hall>bath', 'Санузел')
    .open('N', 2.4, 'hall>closet', 'Кладовка')
    .open('W', 1.0, 'hall>room', 'Большая комната')
    .open('E', 1.9, 'hall>room', 'Спальня', 1.3)
    .wall('p_coat_rack', 'N', 0.2)
    .loot('it_matches', 0.25, 1, 2)
    .build();
}

function loggia515(): Room {
  return room('loggia_515', 'Лоджия 1-515', {
    tags: ['балкон'],
    gen: { weight: 2, min: 0, max: 99 },
    note: '1-515/9: лоджия 3.0×1.2 м, утеплённая, с сушилкой для белья и коробками. Балконная дверь 0.8.',
  })
    .rect(0, 0, 3.0, 1.2)
    .open('S', 0.3, 'balcony>room', 'Балконная дверь')
    .wall('p_drying_rack', 'N', 1.3)
    .wall('p_boxes', 'N', 0.2)
    .spot('corner', 'У двери', 2.4, 0.95, 0, 'junk')
    .group('junk', 'Хлам', C_FLOOR, [
      [5, {}],
      [3, { corner: P('p_bottle_crate') }],
      [2, { corner: I('it_samogon') }],
    ])
    .build();
}

// ─────────────────────────────── Смежные комнаты, распашонка ───────────────────────────────

function living447Smezh(): Room {
  return room('living_447_smezh', 'Зал 1-447 (смежные комнаты)', {
    tags: ['жилая'],
    gen: { weight: 2, min: 0, max: 99 },
    note:
      '1-447, 2-комн. со смежными комнатами: проходная 3.1×5.2 м (16.1 м²), дверь 0.9 из прихожей в длинной стене у угла, ' +
      'дверь 0.9 в дальнюю комнату у противоположного угла, балконная дверь 0.8.',
  })
    .rect(0, 0, 3.1, 5.2)
    .open('W', 4.1, 'room>hall', 'Дверь из прихожей')
    .open('E', 0.4, 'living>bedroom', 'Дверь в смежную комнату')
    .open('N', 2.1, 'room>balcony', 'Балконная дверь')
    .wall('p_servant', 'W', 0.8)
    .wall('p_sofa', 'W', 2.1)
    .wall('p_tv', 'E', 1.4)
    .wall('p_armchair', 'E', 2.4)
    .wall('p_radiator', 'N', 0.6)
    // обеденный стол у окна: проходная комната — путь от прихожей к смежной двери свободен
    .put('p_table_round', 1.0, 0.95)
    .loot('it_kopeyki', 0.3, 1, 3)
    .build();
}

function livingRaspash(): Room {
  return room('living_raspash', 'Зал-«распашонка» 1-335', {
    tags: ['жилая'],
    gen: { weight: 1, min: 0, max: 99 },
    note:
      '1-335, 3-комн. «распашонка»: проходная комната 3.2×5.6 м (17.9 м²) в центре, двери 0.9 в две изолированные ' +
      'комнаты на противоположных стенах у разных углов, дверь из прихожей и балкон.',
  })
    .rect(0, 0, 3.2, 5.6)
    .open('W', 2.8, 'room>hall', 'Дверь из прихожей')
    .open('W', 0.4, 'living>bedroom', 'Левая комната')
    .open('E', 3.9, 'living>bedroom', 'Правая комната')
    .open('N', 2.2, 'room>balcony', 'Балконная дверь')
    .put('p_rug', 1.6, 3.0)
    .wall('p_sofa', 'S', 0.6)
    .wall('p_stenka', 'E', 0.9)
    .wall('p_table_book', 'W', 4.5)
    .wall('p_radiator', 'N', 0.8)
    .loot('it_kopeyki', 0.3, 1, 3)
    .loot('it_matches', 0.2, 1, 2)
    .build();
}

function study(): Room {
  return room('study_room', 'Кабинет', {
    tags: ['жилая', 'кабинет'],
    gen: { weight: 1, min: 0, max: 99 },
    note: 'Малая изолированная комната 2.4×3.4 м (8.2 м²) 1-447/1-464, обставленная как кабинет: письменный стол, книжные шкафы, кресло.',
  })
    .rect(0, 0, 2.4, 3.4)
    .open('S', 0.2, 'room>hall', 'Дверь из прихожей')
    .wall('p_desk', 'E', 0.4)
    .wall('p_radiator', 'N', 0.3)
    .wall('p_bookshelf', 'W', 0.5)
    .wall('p_bookshelf', 'W', 1.4)
    .wall('p_armchair', 'S', 1.5)
    .spot('chair', 'Стул у стола', 1.55, 1.0, 270, 'chair')
    .spot('desk', 'На столе', 2.1, 0.8, 0, 'desk')
    .group('chair', 'Стул у стола', C_SEAT, [
      [2, {}],
      [8, { chair: P('p_chair') }],
    ])
    .group('desk', 'На столе', C_ITEM, [
      [6, {}],
      [2, { desk: I('it_batteries') }],
      [2, { desk: I('it_components') }],
    ])
    .loot('it_kopeyki', 0.25, 1, 3)
    .build();
}

function chulan(): Room {
  return room('closet_chulan', 'Чулан 1-447', {
    tags: ['кладовка'],
    gen: { weight: 2, min: 0, max: 99 },
    note: '1-447: чулан 1.2×1.4 м (1.7 м²) при прихожей, полки для банок. Дверь 0.6.',
  })
    .rect(0, 0, 1.2, 1.4)
    .open('S', 0.3, 'closet>hall', 'Дверь')
    .wall('p_shelf', 'N', 0.1)
    .spot('shelf', 'На полке', 0.6, 0.2, 0, 'shelf')
    .group('shelf', 'На полке', C_ITEM, [
      [4, {}],
      [4, { shelf: I('it_canned') }],
      [2, { shelf: I('it_matches') }],
    ])
    .build();
}

// ─────────────────────────────── Варианты обстановки ───────────────────────────────

function kitchen1464Reno(): Room {
  return room('kitchen_1464_reno', 'Кухня 1-464 — после ремонта', {
    tags: ['кухня'],
    gen: { weight: 1, min: 0, max: 99 },
    note: 'Та же кухня 1-464 (2.6×2.3 м, вентблок), но после ремонта: «Саратов», дополнительная тумба, стулья вместо табуретов.',
  })
    .rect(0, 0, 2.6, 2.3)
    .cut(2.2, 0, 0.4, 0.3)
    .open('N', 0.1, 'kitchen>hall', 'Дверь из прихожей')
    .wall('p_sink_kitchen', 'E', 0.3)
    .wall('p_kitchen_counter', 'E', 0.9)
    .wall('p_stove', 'E', 1.5)
    .wall('p_fridge_saratov', 'W', 0.8)
    .wall('p_kitchen_counter', 'W', 1.4)
    .wall('p_radiator', 'S', 0.8)
    .wall('p_table_kitchen', 'S', 0.8, { off: 0.2 })
    .spot('c1', 'Стул 1', 1.0, 1.2, 0, 'chairs')
    .spot('c2', 'Стул 2', 1.5, 1.2, 0, 'chairs')
    .group('chairs', 'Стулья', C_SEAT, [
      [2, {}],
      [4, { c1: P('p_chair') }],
      [4, { c1: P('p_chair'), c2: P('p_chair') }],
    ])
    .loot('it_canned', 0.3, 1, 2)
    .loot('it_matches', 0.25, 1, 2)
    .build();
}

function living1464Piano(): Room {
  return room('living_1464_piano', 'Зал 1-464 — с пианино', {
    tags: ['жилая'],
    gen: { weight: 1, min: 0, max: 99 },
    note: 'Тот же проходной зал 1-464 (3.2×5.4 м, двустворчатая дверь в длинной стене), но с пианино, сервантом и круглым столом.',
  })
    .rect(0, 0, 3.2, 5.4)
    .open('W', 3.9, 'living>hall', 'Двустворчатая из прихожей')
    .open('E', 0.3, 'living>bedroom', 'Дверь в спальню')
    .open('N', 2.2, 'room>balcony', 'Балконная дверь')
    .wall('p_armchair', 'N', 0.1)
    .wall('p_radiator', 'N', 1.1)
    .wall('p_piano', 'W', 1.6)
    .wall('p_servant', 'S', 0.3)
    .wall('p_sofa', 'E', 2.0)
    .wall('p_table_book', 'S', 2.2)
    // круглый стол у окна: между пианино и диваном — свободный путь из прихожей в спальню
    .put('p_table_round', 1.4, 0.95)
    .spot('stool', 'Табурет у пианино', 0.85, 2.3, 0, 'stool')
    .group('stool', 'Табурет у пианино', C_SEAT, [
      [3, {}],
      [7, { stool: P('p_stool') }],
    ])
    .loot('it_kopeyki', 0.35, 1, 4)
    .build();
}

function bedroom1464Kids(): Room {
  return room('bedroom_1464_kids', 'Спальня 1-464 — детская на двоих', {
    tags: ['жилая'],
    gen: { weight: 1, min: 0, max: 99 },
    note: 'Та же спальня 1-464 за залом (2.5×4.0 м с вырезом под шкаф), обставленная как детская: две кровати, письменный стол.',
  })
    .rect(0, 0, 2.5, 4.0)
    .cut(0, 2.9, 0.6, 1.1)
    .open('W', 0.2, 'bedroom>living', 'Дверь из зала')
    .put('p_bed1', 1.0, 1.2)
    .put('p_bed1', 2.05, 1.2)
    .wall('p_radiator', 'N', 0.8)
    .wall('p_desk', 'S', 1.2)
    .wall('p_bookshelf', 'W', 3.0, { at: 0.6 })
    .spot('chair', 'Стул у стола', 1.8, 3.1, 0, 'chair')
    .spot('toys', 'Игрушки', 1.3, 2.6, 0, 'toys')
    .group('chair', 'Стул у стола', C_SEAT, [
      [3, {}],
      [7, { chair: P('p_chair') }],
    ])
    .group('toys', 'Коробка с игрушками', C_FLOOR, [
      [5, {}],
      [5, { toys: P('p_boxes') }],
    ])
    .loot('it_batteries', 0.15, 1, 2)
    .build();
}

function room447Student(): Room {
  return room('room_447_student', 'Комната 1-447 — съёмная (студент)', {
    tags: ['жилая'],
    gen: { weight: 1, min: 0, max: 99 },
    note: 'Та же изолированная комната 1-447 (3.0×4.7 м), сдаётся студенту: кровать, стол, раскладушка для друга, бутылки.',
  })
    .rect(0, 0, 3.0, 4.7)
    .open('E', 0.2, 'room>hall', 'Дверь из прихожей')
    .open('W', 3.7, 'room>balcony', 'Балконная дверь')
    .wall('p_bed1', 'N', 1.2)
    .wall('p_desk', 'W', 0.4)
    // книжный шкаф ниже по стене: между кроватью и шкафом проход от двери
    .wall('p_bookshelf', 'E', 2.4)
    .wall('p_radiator', 'W', 2.5)
    .put('p_cot', 1.9, 4.35, 90)
    .spot('chair', 'Стул у стола', 0.85, 1.0, 90, 'chair')
    .spot('floor', 'Под столом', 1.5, 3.2, 0, 'floor')
    .group('chair', 'Стул у стола', C_SEAT, [
      [3, {}],
      [7, { chair: P('p_chair') }],
    ])
    .group('floor', 'Тара', C_FLOOR, [
      [4, {}],
      [4, { floor: P('p_bottle_crate') }],
      [2, { floor: P('p_boxes') }],
    ])
    .loot('it_samogon', 0.08, 1, 1)
    .loot('it_components', 0.1, 1, 1)
    .build();
}

function bath1464Laundry(): Room {
  return room('bath_1464_laundry', 'Совмещённый санузел 1-464 — стирка', {
    tags: ['санузел'],
    gen: { weight: 1, min: 0, max: 99 },
    note: 'Тот же санузел 1-464 (1.5×1.8 м), «Малютка» стоит постоянно, в ванне замочено бельё.',
  })
    .rect(0, 0, 1.5, 1.8)
    .cut(1.3, 0, 0.2, 0.3)
    .open('N', 0.1, 'bath>hall', 'Дверь')
    .wall('p_bath', 'S', 0)
    .wall('p_toilet', 'E', 0.35)
    .wall('p_washbasin', 'W', 0.35)
    .put('p_malyutka', 0.6, 0.85)
    .spot('tub', 'В ванне', 0.75, 1.45, 0, 'tub')
    .group('tub', 'В ванне', C_ITEM, [
      [7, {}],
      [3, { tub: I('it_bandage') }],
    ])
    .loot('it_bandage', 0.2, 1, 2)
    .build();
}

function foyer335Clutter(): Room {
  return room('foyer_335_clutter', 'Прихожая 1-335 — заставленная', {
    tags: ['прихожая'],
    gen: { weight: 1, min: 0, max: 99 },
    note: 'Та же прихожая однушки 1-335 (1.3×2.4 м с карманом к кухне), заставленная: комод у входа, вешалка напротив кармана — проход 0.85 м.',
  })
    .rect(0, 0, 1.3, 2.4)
    .rect(1.3, 0, 1.0, 1.0)
    .open('S', 0.2, 'apt>landing', 'Входная дверь')
    .open('W', 0.2, 'hall>room', 'Комната')
    .open('N', 1.4, 'hall>kitchen', 'Кухня')
    .open('E', 1.4, 'hall>bath', 'Санузел', 1.3)
    // комод у западной стены, вешалка (0.3 м) — у северной: в карман к кухне остаётся проход
    .wall('p_komod', 'W', 1.2)
    .wall('p_coat_rack', 'N', 0.35)
    .spot('top', 'На комоде', 0.2, 1.65, 0, 'top')
    .group('top', 'На комоде', C_ITEM, [
      [5, {}],
      [3, { top: I('it_kopeyki') }],
      [2, { top: I('it_matches') }],
    ])
    .build();
}

function closet1464Stash(): Room {
  return room('closet_1464_stash', 'Кладовка 1-464 — заначка деда', {
    tags: ['кладовка'],
    gen: { weight: 1, min: 0, max: 99 },
    note: 'Та же кладовка 1-464 (0.9×1.1 м с антресолью), только вместо коробок — ящик с бутылками.',
  })
    .rect(0, 0, 0.9, 1.1)
    .open('S', 0.2, 'closet>hall', 'Дверь')
    .wall('p_bottle_crate', 'N', 0.15)
    .spot('shelf', 'Антресоль', 0.45, 0.7, 0, 'shelf')
    .group('shelf', 'На антресоли', C_STASH, [
      [4, {}],
      [4, { shelf: I('it_samogon') }],
      [2, { shelf: I('it_canned') }],
    ])
    .build();
}

export function buildFlatRooms(): Room[] {
  return [
    foyerII49(), kitchenII49(), bathII49(), wcII49(), roomII49Big(), roomII49Bed(),
    kitchen515(), foyer515(), loggia515(),
    living447Smezh(), livingRaspash(), study(), chulan(),
    kitchen1464Reno(), living1464Piano(), bedroom1464Kids(), room447Student(),
    bath1464Laundry(), foyer335Clutter(), closet1464Stash(),
  ];
}
