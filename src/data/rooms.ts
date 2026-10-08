// Комнаты-компоненты: только реальные помещения типовых хрущёвок, размеры в свету.
// Координаты в метрах от левого верхнего угла габарита, север — вверх.
// Каждый проём = дверь + метка стыковки (см. TAG_LEN в roomBuilder.ts): «хозяин>гость» у прихожей,
// площадки, коридора, зала; зеркальная «гость>хозяин» у ведомого помещения.
import type { Room } from '../model/types';
import { I, P, room } from './roomBuilder';
import { buildFlatRooms } from './roomsFlats';
import { buildPublicRooms } from './roomsPublic';
import { buildBasementRooms } from './roomsBasement';
import { buildBarnRooms } from './roomsBarn';
import { buildSnowRooms } from './roomsSnow';
import { buildFactoryRooms } from './roomsFactory';
import { buildSpecialRooms } from './roomsSpecial';

// Цвета групп спотов
const C_SEAT = '#e9c46a';
const C_TABLE = '#f4a261';
const C_FLOOR = '#8ab17d';
const C_STASH = '#e76f51';
const C_ITEM = '#2a9d8f';

const COMMON = { elite: [] as Room['elite'] };

// ─────────────────────────── Лестница и общие коридоры ───────────────────────────

function landing1464(): Room {
  return room('landing_1464', 'Лестничная площадка 1-464 (Г-образная, 3 квартиры)', {
    tags: ['лестница', 'start'],
    gen: { weight: 1, min: 1, max: 1 },
    ...COMMON,
    note:
      'Этажная площадка 1-464 торцевой секции: площадка 2.4×1.4 м у маршей (два марша по 1.1 м с зазором 0.2 м) ' +
      'и карман 1.1×2.4 м к дальним квартирам, рядом с маршем — двустворчатая дверь 1.3 м в поэтажный тамбур. Входные двери 1.0 м у углов на разных стенах — ни одна не смотрит в марш.',
  })
    .rect(0, 0, 2.4, 1.4)
    .rect(2.4, 0, 1.1, 2.4)
    .open('N', 0.0, 'stair', 'Марш')
    .open('N', 1.1, 'corridor', 'Дверь в поэтажный тамбур')
    .open('W', 0.2, 'landing>apt', 'Кв. 1')
    .open('E', 1.3, 'landing>apt', 'Кв. 2')
    .open('S', 2.5, 'landing>apt', 'Кв. 3')
    .spot('floor', 'Мелочь на полу', 1.2, 0.7, 0, 'floor')
    .group('floor', 'Мелочь на полу', C_ITEM, [
      [7, {}],
      [2, { floor: I('it_matches') }],
      [1, { floor: I('it_kopeyki') }],
    ])
    .build();
}

function landing447(): Room {
  return room('landing_447', 'Лестничная площадка 1-447 (Г-образная, 3 квартиры)', {
    tags: ['лестница'],
    gen: { weight: 0.5, min: 0, max: 99 },
    ...COMMON,
    note:
      'Этажная площадка кирпичной 1-447: 2.6×1.4 м у марша (1.1 м) с дверью 1.3 м в поэтажный тамбур и карман 1.1×2.4 м сбоку. ' +
      'Три входные двери 1.0 м у углов, разнесены по разным стенам.',
  })
    .rect(0, 0, 1.1, 2.4)
    .rect(1.1, 0, 2.6, 1.4)
    .open('N', 1.2, 'stair', 'Марш')
    .open('N', 2.4, 'corridor', 'Дверь в поэтажный тамбур')
    .open('E', 0.2, 'landing>apt', 'Кв. 1')
    .open('W', 1.3, 'landing>apt', 'Кв. 2')
    .open('S', 0.1, 'landing>apt', 'Кв. 3')
    .spot('floor', 'Мелочь на полу', 2.4, 0.7, 0, 'floor')
    .group('floor', 'Мелочь на полу', C_ITEM, [
      [7, {}],
      [2, { floor: I('it_matches') }],
      [1, { floor: I('it_bandage') }],
    ])
    .build();
}

function landingMid(): Room {
  return room('landing_mid', 'Межэтажная площадка', {
    tags: ['лестница'],
    gen: { weight: 0.1, min: 0, max: 4 },
    ...COMMON,
    note:
      'Промежуточная площадка между этажами: 2.4×1.3 м, окно на лестницу, к южной стороне приходят ' +
      'два марша по 1.1 м (снизу и сверху). Курилка жильцов.',
  })
    .rect(0, 0, 2.4, 1.3)
    .open('S', 0.0, 'stair', 'Марш вниз')
    .open('S', 1.3, 'stair', 'Марш вверх')
    .wall('p_radiator', 'N', 0.8)
    .spot('smoke', 'Курилка', 0.4, 0.35, 0, 'smoke')
    .group('smoke', 'Курилка', C_FLOOR, [
      [5, {}],
      [3, { smoke: P('p_trash') }],
      [2, { smoke: P('p_bottle_crate') }],
    ])
    .loot('it_matches', 0.15, 1, 1)
    .build();
}

function stairFlight(): Room {
  return room('stair_flight', 'Лестничный марш', {
    tags: ['лестница'],
    gen: { weight: 0.2, min: 0, max: 6 },
    ...COMMON,
    note:
      'Марш из 9 ступеней 150×300 мм: ширина 1.1 м, горизонтальная проекция 2.7 м. ' +
      'Соединяет этажную и межэтажную площадки.',
  })
    .rect(0, 0, 1.1, 2.7)
    .open('N', 0, 'stair', 'Верх марша')
    .open('S', 0, 'stair', 'Низ марша')
    .spot('step', 'На ступеньках', 0.55, 1.35, 0, 'step')
    .group('step', 'На ступеньках', C_ITEM, [
      [17, {}],
      [2, { step: I('it_matches') }],
      [1, { step: I('it_samogon') }],
    ])
    .build();
}

function landingMalosem(): Room {
  return room('landing_malosem', 'Этажная площадка малосемейки', {
    tags: ['лестница'],
    gen: { weight: 0.15, min: 0, max: 99 },
    ...COMMON,
    note:
      'Лестничная клетка малосемейки: площадка 2.6×1.4 м у марша и карман 1.2×1.4 м с мусоропроводом. ' +
      'Двустворчатая дверь 1.3 м в общий коридор сбоку, квартиры у марша и в кармане.',
  })
    .rect(0, 0, 2.6, 1.4)
    .rect(0, 1.4, 1.2, 1.4)
    .open('N', 0.1, 'stair', 'Марш')
    .open('N', 1.5, 'landing>apt', 'Квартира у марша')
    .open('E', 0.1, 'corridor', 'Дверь в общий коридор')
    .open('W', 1.6, 'landing>apt', 'Квартира у лестницы')
    .wall('p_chute', 'S', 0.4)
    // мешки у восточной стены кармана, рядом со стволом: к двери «Квартира у лестницы» остаётся проход
    .spot('bags', 'Мешки у мусоропровода', 0.95, 2.05, 0, 'bags')
    .group('bags', 'Мешки у мусоропровода', C_FLOOR, [
      [4, {}],
      [6, { bags: P('p_trash') }],
    ])
    .build();
}

function corridorLong(): Room {
  // Прямой коридор 18 м сломан поворотом; двери в соседние коридоры — в боковых стенах,
  // квартирные двери в шахматном порядке, чтобы взгляд из любой двери упирался в стену.
  const r = room('corr_malosem_long', 'Общий коридор малосемейки (с поворотом)', {
    tags: ['коридор'],
    gen: { weight: 0.5, min: 0, max: 1 },
    ...COMMON,
    note:
      'Общий коридор этажа малосемейки / гостинки шириной 1.8 м с поворотом под прямым углом: плечи 9.0 и 8.4 м. ' +
      '8 квартирных дверей 1.0 м в шахматном порядке, двустворчатые двери 1.3 м в соседние коридоры — в боковых стенах.',
  })
    .rect(0, 0, 1.8, 9.0)
    .rect(1.8, 7.2, 6.6, 1.8)
    .open('W', 0.2, 'corridor', 'Выход (запад)')
    .open('N', 7.0, 'corridor', 'Выход (север)', 7.2);
  [3.2, 6.2].forEach((y, i) => r.open('W', y, 'landing>apt', `Кв. З${i + 1}`));
  [1.6, 5.0].forEach((y, i) => r.open('E', y, 'landing>apt', `Кв. В${i + 1}`, 1.8));
  [2.6, 4.6].forEach((x, i) => r.open('N', x, 'landing>apt', `Кв. С${i + 1}`, 7.2));
  [3.6, 5.8].forEach((x, i) => r.open('S', x, 'landing>apt', `Кв. Ю${i + 1}`));
  return r
    .spot('e1', 'У стены В1', 1.6, 3.8, 90, 'junk')
    .spot('e2', 'У стены на повороте', 6.3, 7.4, 0, 'junk')
    .spot('w1', 'У стены З1', 0.2, 2.4, 270, 'junk')
    .spot('w2', 'У стены З2', 0.2, 5.2, 270, 'junk')
    .group('junk', 'Вещи жильцов в коридоре', C_FLOOR, [
      [2, {}],
      [3, { e1: P('p_shoe_rack'), w2: P('p_shoe_rack') }],
      [2, { e2: P('p_bicycle'), w1: P('p_trash') }],
      [1, { e1: P('p_shoe_rack'), e2: P('p_boxes'), w1: P('p_bottle_crate'), w2: P('p_stroller') }],
    ])
    .loot('it_matches', 0.15, 1, 2)
    .loot('it_kopeyki', 0.2, 1, 3)
    .build();
}

function corridorShort(): Room {
  return room('corr_malosem_short', 'Коридор малосемейки (секция 5.6 м)', {
    tags: ['коридор'],
    gen: { weight: 2, min: 0, max: 99 },
    ...COMMON,
    note:
      'Отрезок общего коридора малосемейки 1.8×5.6 м. Двустворчатые двери 1.3 м в соседние коридоры — в боковых ' +
      'стенах у противоположных концов (коридор идёт уступом), две квартиры в шахматном порядке.',
  })
    .rect(0, 0, 1.8, 5.6)
    .open('W', 0.2, 'corridor', 'Выход (запад)')
    .open('E', 4.1, 'corridor', 'Выход (восток)')
    .open('E', 1.8, 'landing>apt', 'Кв. В')
    .open('W', 3.0, 'landing>apt', 'Кв. З')
    .spot('e1', 'У стены В', 1.6, 3.4, 90, 'junk')
    .spot('w1', 'У стены З', 0.2, 4.8, 270, 'junk')
    .group('junk', 'Вещи жильцов в коридоре', C_FLOOR, [
      [3, {}],
      [2, { e1: P('p_shoe_rack') }],
      [1, { w1: P('p_boxes'), e1: P('p_trash') }],
    ])
    .build();
}

function tambour(): Room {
  return room('tambour_3', 'Тамбур на 3 квартиры', {
    tags: ['коридор'],
    gen: { weight: 2, min: 0, max: 99 },
    ...COMMON,
    note:
      'Квартирный тамбур малосемейки 2.4×2.0 м: двустворчатая дверь 1.3 м из общего коридора у одного угла, ' +
      'три входные двери 1.0 м у других углов — ни одна не напротив другой.',
  })
    .rect(0, 0, 2.4, 2.0)
    .open('N', 0.1, 'corridor', 'Дверь в коридор')
    .open('S', 1.4, 'landing>apt', 'Кв. 1')
    .open('W', 0.0, 'landing>apt', 'Кв. 2')
    .open('E', 1.0, 'landing>apt', 'Кв. 3')
    .spot('floor', 'Мелочь на полу', 1.2, 1.0, 0, 'floor')
    .group('floor', 'Мелочь на полу', C_ITEM, [
      [7, {}],
      [2, { floor: I('it_matches') }],
      [1, { floor: I('it_kopeyki') }],
    ])
    .build();
}

// ─────────────────────────────────── Прихожие ───────────────────────────────────

function foyer1464(): Room {
  return room('foyer_1464', 'Прихожая 1-464 (Г-образная)', {
    tags: ['прихожая'],
    gen: { weight: 3, min: 0, max: 99 },
    note:
      '1-464, 2-комн. квартира с проходным залом. Г-образная прихожая: коридор 2.6×1.1 м + колено 1.0×1.2 м к кухне. ' +
      'Двери у углов: входная 1.0, двустворчатая остеклённая в зал 1.3, кладовка 0.6, кухня 0.8 и санузел 0.7 в колене.',
  })
    .rect(0, 0, 2.6, 1.1)
    .rect(1.6, 1.1, 1.0, 1.2)
    .open('W', 0.1, 'apt>landing', 'Входная дверь')
    .open('S', 0.0, 'hall>living', 'Двустворчатая в зал')
    .open('N', 1.3, 'hall>closet', 'Кладовка')
    .open('E', 1.3, 'hall>kitchen', 'Кухня')
    .open('S', 1.9, 'hall>bath', 'Санузел')
    .wall('p_coat_rack', 'N', 0.3)
    .wall('p_shoe_rack', 'W', 1.2, { at: 1.6 })
    // в северо-восточном углу, на повороте в колено — не на пути к кухне и санузлу
    .spot('junk', 'Вещи в прихожей', 2.3, 0.25, 0, 'junk')
    .group('junk', 'Вещи в прихожей', C_FLOOR, [
      [5, {}],
      [3, { junk: P('p_boxes') }],
      [2, { junk: P('p_trash') }],
    ])
    .loot('it_matches', 0.25, 1, 2)
    .loot('it_kopeyki', 0.2, 1, 3)
    .build();
}

function foyer447(): Room {
  return room('foyer_447', 'Прихожая-коридор 1-447', {
    tags: ['прихожая'],
    gen: { weight: 3, min: 0, max: 99 },
    note:
      '1-447 (кирпичная), 1–2-комн. с раздельным санузлом. Тамбур у входа 1.2×1.6 м и коридор 2.4×1.0 м. ' +
      'Двери у углов, в шахматном порядке: входная 1.0, комната 0.9, ванная 0.7 и кухня 0.8 с одной стороны коридора, туалет 0.7 — с другой.',
  })
    .rect(0, 0, 1.2, 1.6)
    .rect(1.2, 0.6, 2.4, 1.0)
    .open('W', 0.1, 'apt>landing', 'Входная дверь')
    .open('N', 0.2, 'hall>room', 'Комната')
    .open('N', 2.0, 'hall>bath', 'Ванная', 0.6)
    .open('N', 2.8, 'hall>kitchen', 'Кухня', 0.6)
    .open('S', 1.3, 'hall>wc', 'Туалет')
    .wall('p_coat_rack', 'S', 0.2)
    // обувница — в конце коридора у южной стены: на стыке тамбура и коридора остаётся проход
    .wall('p_shoe_rack', 'S', 2.9)
    .spot('junk', 'Вещи в коридоре', 3.3, 1.1, 0, 'junk')
    .group('junk', 'Вещи в коридоре', C_ITEM, [
      [6, {}],
      [3, { junk: I('it_matches') }],
      [1, { junk: I('it_batteries') }],
    ])
    .loot('it_kopeyki', 0.25, 1, 3)
    .build();
}

function foyer335(): Room {
  return room('foyer_335', 'Прихожая однушки 1-335', {
    tags: ['прихожая'],
    gen: { weight: 3, min: 0, max: 99 },
    note:
      '1-335, 1-комн. квартира: прихожая 1.3×2.4 м с карманом 1.0×1.0 м к кухне (4.1 м²). ' +
      'Двери у углов на разных стенах: входная 1.0, комната 0.9, кухня 0.8 из кармана, совмещённый санузел 0.7.',
  })
    .rect(0, 0, 1.3, 2.4)
    .rect(1.3, 0, 1.0, 1.0)
    .open('S', 0.2, 'apt>landing', 'Входная дверь')
    .open('W', 0.2, 'hall>room', 'Комната')
    .open('N', 1.4, 'hall>kitchen', 'Кухня')
    .open('E', 1.4, 'hall>bath', 'Санузел', 1.3)
    .wall('p_coat_rack', 'W', 1.2)
    .wall('p_shoe_rack', 'N', 0.4)
    .loot('it_matches', 0.25, 1, 2)
    .loot('it_kopeyki', 0.2, 1, 3)
    .build();
}

function foyerGost(): Room {
  return room('foyer_gost', 'Прихожая гостинки', {
    tags: ['прихожая'],
    gen: { weight: 2, min: 0, max: 99 },
    note: 'Малосемейка / гостинка: крохотная прихожая 1.2×1.8 м. Входная 1.0, комната 0.9 и санузел 0.7 — у разных углов.',
  })
    .rect(0, 0, 1.2, 1.8)
    .open('S', 0.1, 'apt>landing', 'Входная дверь')
    .open('W', 0.2, 'hall>room', 'Комната')
    .open('E', 1.1, 'hall>bath', 'Санузел')
    .wall('p_coat_rack', 'N', 0.3)
    .loot('it_matches', 0.2, 1, 2)
    .build();
}

// ──────────────────────────────────── Кухни ────────────────────────────────────

function kitchen1464(): Room {
  return room('kitchen_1464', 'Кухня 1-464', {
    tags: ['кухня'],
    gen: { weight: 3, min: 0, max: 99 },
    note:
      '1-464: кухня 2.6 м по окну × 2.3 м, 5.9 м² за вычетом вентблока 0.4×0.3 в углу у санузла. ' +
      'Дверь 0.8 из колена прихожей. Мойка у стояка, стол у окна.',
  })
    .rect(0, 0, 2.6, 2.3)
    .cut(2.2, 0, 0.4, 0.3)
    .open('N', 0.1, 'kitchen>hall', 'Дверь из прихожей')
    .wall('p_sink_kitchen', 'E', 0.3)
    .wall('p_kitchen_counter', 'E', 0.9)
    .wall('p_stove', 'E', 1.5)
    .wall('p_radiator', 'S', 0.8)
    .wall('p_table_kitchen', 'S', 0.8, { off: 0.2 })
    .wall('p_fridge_zil', 'W', 0.8)
    .spot('st1', 'Табурет 1', 1.0, 1.25, 0, 'stools')
    .spot('st2', 'Табурет 2', 1.5, 1.25, 0, 'stools')
    .spot('st3', 'Табурет 3', 0.45, 1.85, 0, 'stools')
    .spot('top', 'На столе', 1.25, 1.85, 0, 'bottles')
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
    .loot('it_canned', 0.2, 1, 2)
    .build();
}

function kitchen447(): Room {
  return room('kitchen_447', 'Кухня 1-447 с колонкой', {
    tags: ['кухня'],
    gen: { weight: 3, min: 0, max: 99 },
    note:
      '1-447 (кирпичная): кухня 2.4×2.6 м, 6.2 м² минус короб стояка 0.3×0.3. Горячей воды нет — газовая колонка на стене. ' +
      'Дверь 0.8 в торце коридора.',
  })
    .rect(0, 0, 2.4, 2.6)
    .cut(2.1, 0, 0.3, 0.3)
    .open('N', 0.1, 'kitchen>hall', 'Дверь из коридора')
    .wall('p_boiler', 'N', 1.4)
    .wall('p_sink_kitchen', 'E', 0.3)
    .wall('p_kitchen_counter', 'E', 0.9)
    .wall('p_stove', 'E', 1.5)
    .wall('p_fridge_saratov', 'W', 0.9)
    .wall('p_radiator', 'S', 0.75)
    .wall('p_table_kitchen', 'S', 0.7, { off: 0.2 })
    .spot('st1', 'Табурет 1', 0.9, 1.55, 0, 'stools')
    .spot('st2', 'Табурет 2', 1.4, 1.55, 0, 'stools')
    .spot('st3', 'Табурет 3', 0.4, 2.15, 0, 'stools')
    .spot('top', 'На столе', 1.15, 2.15, 0, 'bottles')
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
    .loot('it_matches', 0.35, 1, 3)
    .loot('it_canned', 0.2, 1, 2)
    .build();
}

function kitchen335(): Room {
  return room('kitchen_335', 'Кухня 1-335', {
    tags: ['кухня'],
    gen: { weight: 3, min: 0, max: 99 },
    note:
      '1-335: кухня 2.6×2.4 м (6.2 м²) минус короб стояка 0.3×0.3, окно в торце. ' +
      'Дверь 0.8 сбоку из прихожей, плита-тумба-мойка вдоль глухой стены, стол у окна.',
  })
    .rect(0, 0, 2.6, 2.4)
    .cut(2.3, 0, 0.3, 0.3)
    .open('W', 0.1, 'kitchen>hall', 'Дверь из прихожей')
    .wall('p_stove', 'N', 0.3)
    .wall('p_kitchen_counter', 'N', 0.9)
    .wall('p_sink_kitchen', 'N', 1.5)
    .wall('p_radiator', 'E', 1.2)
    .wall('p_table_kitchen', 'E', 1.1, { off: 0.2 })
    .wall('p_fridge_zil', 'S', 0.2)
    .spot('st1', 'Табурет 1', 1.6, 1.3, 0, 'stools')
    .spot('st2', 'Табурет 2', 1.6, 1.8, 0, 'stools')
    .spot('st3', 'Табурет 3', 2.15, 2.2, 0, 'stools')
    .spot('top', 'На столе', 2.15, 1.55, 0, 'bottles')
    .group('stools', 'Кухонный стол', C_SEAT, [
      [2, {}],
      [4, { st1: P('p_stool') }],
      [3, { st1: P('p_stool'), st2: P('p_stool') }],
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

function kitchenSamogon(): Room {
  return room('kitchen_samogon', 'Кухня самогонщика', {
    tags: ['кухня', 'самогон'],
    unique: true,
    gen: { weight: 1, min: 0, max: 1 },
    elite: [{ tierId: 'tier_8', weight: 100 }],
    note:
      'Тематическая: кухня 1-464 (2.6×2.3 м, вентблок 0.4×0.3), переделанная под самогоноварение. ' +
      'Аппарат у плиты, ящики с тарой вдоль стены. Всегда «Закрома» (элитность 8).',
  })
    .rect(0, 0, 2.6, 2.3)
    .cut(2.2, 0, 0.4, 0.3)
    .open('N', 0.1, 'kitchen>hall', 'Дверь из прихожей')
    .wall('p_sink_kitchen', 'E', 0.3)
    .wall('p_stove', 'E', 0.9)
    .wall('p_moonshine', 'E', 1.5)
    .wall('p_bottle_crate', 'W', 0.8)
    .wall('p_bottle_crate', 'W', 1.5)
    .wall('p_radiator', 'S', 0.8)
    .wall('p_table_kitchen', 'S', 0.8, { off: 0.2 })
    .spot('st1', 'Табурет 1', 1.0, 1.25, 0, 'stools')
    .spot('st2', 'Табурет 2', 1.5, 1.25, 0, 'stools')
    .spot('b1', 'Бутылка 1', 1.05, 1.85, 0, 'bottles')
    .spot('b2', 'Бутылка 2', 1.45, 1.85, 0, 'bottles')
    .group('stools', 'Кухонный стол', C_SEAT, [
      [1, {}],
      [2, { st1: P('p_stool') }],
      [2, { st1: P('p_stool'), st2: P('p_stool') }],
    ])
    .group('bottles', 'Бутылки на столе', C_TABLE, [
      [3, {}],
      [5, { b1: I('it_samogon') }],
      [2, { b1: I('it_samogon'), b2: I('it_samogon') }],
    ])
    .loot('it_samogon', 0.4, 1, 2)
    .loot('it_matches', 0.3, 1, 3)
    .build();
}

// ─────────────────────────────────── Санузлы ───────────────────────────────────

function bath1464(): Room {
  return room('bath_1464', 'Совмещённый санузел 1-464', {
    tags: ['санузел'],
    gen: { weight: 3, min: 0, max: 99 },
    note:
      '1-464: санкабина 1.5×1.8 м (2.6 м²) с коробом стояка 0.2×0.3 в углу. Ванна 1.5 м во всю ширину, ' +
      'унитаз у стояка, раковина напротив. Дверь 0.7.',
  })
    .rect(0, 0, 1.5, 1.8)
    .cut(1.3, 0, 0.2, 0.3)
    .open('N', 0.1, 'bath>hall', 'Дверь')
    .wall('p_bath', 'S', 0)
    .wall('p_toilet', 'E', 0.35)
    .wall('p_washbasin', 'W', 0.35)
    .spot('wm', 'Место под стиралку', 0.6, 0.85, 0, 'wash')
    .group('wash', 'Стирка', C_FLOOR, [
      [6, {}],
      [4, { wm: P('p_malyutka') }],
    ])
    .loot('it_bandage', 0.2, 1, 2)
    .loot('it_medkit', 0.05, 1, 1)
    .build();
}

function bath335(): Room {
  return room('bath_335', 'Совмещённый санузел 1-335', {
    tags: ['санузел'],
    gen: { weight: 3, min: 0, max: 99 },
    note:
      '1-335: совмещённый санузел 1.7×2.1 м (3.5 м²), короб стояка 0.2×0.3 в углу у унитаза. ' +
      'Ванна 1.5 м вдоль длинной стены, дверь 0.7.',
  })
    .rect(0, 0, 1.7, 2.1)
    .cut(0, 1.8, 0.2, 0.3)
    .open('W', 0.1, 'bath>hall', 'Дверь')
    .wall('p_bath', 'E', 0.6)
    .wall('p_toilet', 'S', 0.3)
    .wall('p_washbasin', 'N', 0.4)
    .wall('p_malyutka', 'N', 1.1)
    .spot('tank', 'За бачком', 0.5, 1.95, 0, 'stash')
    .group('stash', 'Заначка в бачке', C_STASH, [
      [17, {}],
      [1, { tank: I('it_samogon') }],
      [2, { tank: I('it_batteries') }],
    ])
    .loot('it_bandage', 0.2, 1, 2)
    .loot('it_medkit', 0.05, 1, 1)
    .build();
}

function bathGost(): Room {
  return room('bath_gost', 'Санузел гостинки с сидячей ванной', {
    tags: ['санузел'],
    gen: { weight: 2, min: 0, max: 99 },
    note: 'Малосемейка: совмещённый санузел 1.3×1.6 м (2.1 м²), сидячая ванна 1.2 м, унитаз и раковина. Дверь 0.7.',
  })
    .rect(0, 0, 1.3, 1.6)
    .open('N', 0.1, 'bath>hall', 'Дверь')
    .wall('p_bath_sit', 'S', 0.1)
    .wall('p_toilet', 'E', 0.3)
    .wall('p_washbasin', 'W', 0.35)
    .loot('it_bandage', 0.15, 1, 1)
    .build();
}

function bath447(): Room {
  return room('bath_447', 'Ванная 1-447 (раздельный санузел)', {
    tags: ['санузел'],
    gen: { weight: 2, min: 0, max: 99 },
    note: '1-447: ванная комната 1.5×1.7 м (2.6 м²) при раздельном санузле: ванна 1.5 м, раковина, «Малютка». Дверь 0.7.',
  })
    .rect(0, 0, 1.5, 1.7)
    .open('N', 0.1, 'bath>hall', 'Дверь')
    .wall('p_bath', 'S', 0)
    .wall('p_washbasin', 'E', 0.35)
    .wall('p_malyutka', 'W', 0.4)
    .spot('shelf', 'Полочка у зеркала', 1.3, 0.6, 0, 'shelf')
    .group('shelf', 'Полочка у зеркала', C_ITEM, [
      [7, {}],
      [3, { shelf: I('it_bandage') }],
    ])
    .loot('it_medkit', 0.05, 1, 1)
    .build();
}

function wc447(): Room {
  return room('wc_447', 'Туалет 1-447 (раздельный санузел)', {
    tags: ['санузел'],
    gen: { weight: 2, min: 0, max: 99 },
    note: '1-447: отдельный туалет 0.9×1.3 м (1.2 м²), стояк в углу за унитазом. Дверь 0.7 (полотно 0.6).',
  })
    .rect(0, 0, 0.9, 1.3)
    .open('N', 0.1, 'wc>hall', 'Дверь')
    .wall('p_toilet', 'S', 0.27)
    .put('p_riser', 0.8, 1.2)
    .spot('tank', 'За бачком', 0.45, 1.2, 0, 'stash')
    .group('stash', 'Заначка', C_STASH, [
      [17, {}],
      [2, { tank: I('it_samogon') }],
      [1, { tank: I('it_kopeyki') }],
    ])
    .build();
}

// ──────────────────────────────────── Жилые ────────────────────────────────────

function living1464(): Room {
  return room('living_1464', 'Зал 1-464 (проходной)', {
    tags: ['жилая'],
    gen: { weight: 3, min: 0, max: 99 },
    note:
      '1-464, 2-комн.: большая проходная комната 3.2×5.4 м (17.3 м²). Двустворчатая остеклённая дверь 1.3 из прихожей ' +
      'в длинной стене у угла, дверь 0.9 в изолированную спальню у окна, балконная дверь 0.8. Стенка, диван-книжка, ковёр.',
  })
    .rect(0, 0, 3.2, 5.4)
    .open('W', 3.9, 'living>hall', 'Двустворчатая из прихожей')
    .open('E', 0.3, 'living>bedroom', 'Дверь в спальню')
    .open('N', 2.2, 'room>balcony', 'Балконная дверь')
    .put('p_rug_big', 1.45, 2.95)
    .wall('p_armchair', 'N', 0.1)
    .wall('p_radiator', 'N', 1.1)
    .wall('p_stenka', 'W', 1.0)
    .wall('p_sofa', 'E', 2.0)
    .wall('p_table_book', 'S', 1.2)
    .spot('arm2', 'Второе кресло', 2.8, 4.55, 90, 'extra')
    // раскладушка вдоль стенки: проход от прихожей к спальне — между ней и диваном
    .spot('cot', 'Раскладушка для гостей', 0.85, 1.95, 0, 'extra')
    .group('extra', 'Гости', C_SEAT, [
      [5, {}],
      [3, { arm2: P('p_armchair') }],
      [2, { cot: P('p_cot') }],
    ])
    .loot('it_matches', 0.2, 1, 2)
    .loot('it_kopeyki', 0.3, 1, 4)
    .build();
}

function bedroom1464(): Room {
  return room('bedroom_1464', 'Спальня 1-464 (за залом)', {
    tags: ['жилая'],
    gen: { weight: 2, min: 0, max: 99 },
    note:
      '1-464, 2-комн.: изолированная спальня за проходным залом, 2.5×4.0 м с вырезом 0.6×1.1 под встроенный шкаф ' +
      '(9.3 м²). Дверь 0.9 из зала, окно в торце.',
  })
    .rect(0, 0, 2.5, 4.0)
    .cut(0, 2.9, 0.6, 1.1)
    .open('W', 0.2, 'bedroom>living', 'Дверь из зала')
    .wall('p_bed2', 'N', 0.75)
    .wall('p_nightstand', 'N', 0.3)
    .wall('p_radiator', 'E', 2.3)
    .wall('p_wardrobe', 'S', 1.3)
    .wall('p_komod', 'W', 3.0, { at: 0.6 })
    .spot('mat', 'Под матрасом', 1.55, 1.0, 0, 'stash')
    .spot('floor', 'Вещи на полу', 1.6, 2.6, 0, 'floor')
    .group('stash', 'Заначка под матрасом', C_STASH, [
      [8, {}],
      [1, { mat: I('it_kopeyki') }],
      [1, { mat: I('it_samogon') }],
    ])
    .group('floor', 'Вещи на полу', C_FLOOR, [
      [6, {}],
      [3, { floor: P('p_boxes') }],
      [1, { floor: P('p_trash') }],
    ])
    .loot('it_kopeyki', 0.25, 1, 3)
    .build();
}

function room447(): Room {
  return room('room_447', 'Комната 1-447 (изолированная)', {
    tags: ['жилая'],
    gen: { weight: 3, min: 0, max: 99 },
    note:
      '1-447 (кирпичная): изолированная комната 3.0×4.7 м (14.1 м²), дверь 0.9 из прихожей, балконная дверь 0.8 ' +
      'в торцевой стене. Сервант, диван, письменный стол у окна.',
  })
    .rect(0, 0, 3.0, 4.7)
    .open('E', 0.2, 'room>hall', 'Дверь из прихожей')
    .open('W', 3.7, 'room>balcony', 'Балконная дверь')
    .put('p_rug', 1.5, 2.6)
    .wall('p_servant', 'N', 0.3)
    .wall('p_sofa', 'S', 0.8)
    .wall('p_wardrobe', 'E', 1.4)
    .wall('p_desk', 'W', 1.0)
    .wall('p_radiator', 'W', 2.5)
    .spot('chair', 'Стул у стола', 0.85, 1.6, 90, 'chair')
    .spot('floor', 'Вещи на полу', 1.6, 3.3, 0, 'floor')
    .group('chair', 'Стул у стола', C_SEAT, [
      [3, {}],
      [7, { chair: P('p_chair') }],
    ])
    .group('floor', 'Вещи на полу', C_FLOOR, [
      [6, {}],
      [2, { floor: P('p_boxes') }],
      [1, { floor: P('p_trash') }],
    ])
    .loot('it_kopeyki', 0.3, 1, 3)
    .loot('it_matches', 0.2, 1, 2)
    .build();
}

function room335(): Room {
  return room('room_335', 'Комната однушки 1-335', {
    tags: ['жилая'],
    gen: { weight: 3, min: 0, max: 99 },
    note:
      '1-335, 1-комн.: единственная комната 3.3×5.6 м (18.5 м²), дверь 0.9 из прихожей, балконная дверь 0.8 у окна. ' +
      'Диван-книжка, стенка, пианино, стол-книжка.',
  })
    .rect(0, 0, 3.3, 5.6)
    .open('S', 0.2, 'room>hall', 'Дверь из прихожей')
    .open('N', 2.3, 'room>balcony', 'Балконная дверь')
    .put('p_rug_big', 1.65, 2.8)
    .wall('p_armchair', 'N', 0.1)
    .wall('p_radiator', 'N', 1.0)
    .wall('p_sofa', 'W', 1.5)
    .wall('p_stenka', 'E', 1.4)
    .wall('p_table_book', 'W', 4.0)
    .wall('p_piano', 'S', 1.4)
    // раскладушка вплотную к дивану: между ней и стенкой проход 1.25 м
    .spot('cot', 'Раскладушка для гостей', 1.2, 2.45, 0, 'guest')
    .group('guest', 'Гость на раскладушке', C_SEAT, [
      [8, {}],
      [2, { cot: P('p_cot') }],
    ])
    .loot('it_kopeyki', 0.3, 1, 4)
    .loot('it_matches', 0.2, 1, 2)
    .build();
}

function kids468(): Room {
  return room('kids_468', 'Детская 1-468', {
    tags: ['жилая'],
    gen: { weight: 2, min: 0, max: 99 },
    note:
      '1-468, 3-комн. смежно-изолированная: маленькая комната за проходной, 2.2×3.2 м (7.0 м²). ' +
      'Дверь 0.9 из большой комнаты. Кровать, письменный стол у окна, книжный шкаф.',
  })
    .rect(0, 0, 2.2, 3.2)
    .open('S', 0.2, 'bedroom>living', 'Дверь из большой комнаты')
    .wall('p_radiator', 'N', 0.4)
    .wall('p_bed1', 'N', 1.3)
    .wall('p_desk', 'W', 0.8)
    .wall('p_bookshelf', 'S', 1.3)
    .spot('chair', 'Стул у стола', 0.8, 1.4, 90, 'chair')
    .spot('toys', 'Игрушки', 1.0, 2.5, 0, 'toys')
    .group('chair', 'Стул у стола', C_SEAT, [
      [3, {}],
      [7, { chair: P('p_chair') }],
    ])
    .group('toys', 'Коробка с игрушками', C_FLOOR, [
      [5, {}],
      [5, { toys: P('p_boxes') }],
    ])
    .loot('it_batteries', 0.1, 1, 2)
    .loot('it_matches', 0.15, 1, 1)
    .build();
}

function roomGost(): Room {
  return room('room_gost', 'Комната гостинки с кухонной нишей', {
    tags: ['жилая', 'кухня-ниша'],
    gen: { weight: 2, min: 0, max: 99 },
    note:
      'Малосемейка / гостинка: жилая комната 3.2×3.8 м + кухонная ниша 1.6×1.4 м (всего 14.4 м²). ' +
      'Дверь 0.9 из прихожей. В нише плита и мойка, холодильник «Саратов» в комнате.',
  })
    .rect(0, 0, 3.2, 3.8)
    .rect(1.6, 3.8, 1.6, 1.4)
    .open('S', 0.2, 'room>hall', 'Дверь из прихожей')
    .wall('p_radiator', 'N', 1.2)
    .wall('p_sofa', 'W', 0.6)
    .wall('p_wardrobe', 'E', 0.3)
    .wall('p_fridge_saratov', 'E', 2.9)
    .wall('p_table_kitchen', 'W', 2.6)
    .wall('p_sink_kitchen', 'S', 1.7)
    .wall('p_stove', 'S', 2.4)
    .spot('st1', 'Табурет 1', 0.8, 2.85, 0, 'stools')
    .spot('st2', 'Табурет 2', 0.8, 3.3, 0, 'stools')
    .group('stools', 'Кухонный стол', C_SEAT, [
      [3, {}],
      [5, { st1: P('p_stool') }],
      [2, { st1: P('p_stool'), st2: P('p_stool') }],
    ])
    .loot('it_matches', 0.3, 1, 2)
    .loot('it_canned', 0.25, 1, 2)
    .build();
}

function roomBabushka(): Room {
  return room('room_babushka', 'Бабушкина комната', {
    tags: ['жилая', 'бабушка'],
    unique: true,
    gen: { weight: 1, min: 0, max: 1 },
    elite: [{ tierId: 'tier_3', weight: 100 }],
    note:
      'Тематическая: изолированная комната 1-464, 2.8×4.2 м (11.8 м²). Сервант с хрусталём, кровать с подзором, ' +
      'трюмо, швейная машинка, фикус. Всегда «Зажиточная» (элитность 3): в серванте бывает самогонка.',
  })
    .rect(0, 0, 2.8, 4.2)
    .open('S', 0.2, 'room>hall', 'Дверь из прихожей')
    .put('p_rug', 1.35, 2.3)
    .wall('p_bed1', 'N', 0)
    .wall('p_radiator', 'N', 1.0)
    .wall('p_plant', 'N', 2.2)
    .wall('p_servant', 'E', 1.0)
    .wall('p_armchair', 'E', 2.4)
    .wall('p_trumo', 'S', 1.5)
    .wall('p_sewing', 'W', 2.3)
    .spot('jar', 'Банка в серванте', 2.55, 1.6, 0, 'stash')
    .spot('under', 'Под кроватью', 0.45, 1.0, 0, 'under')
    .group('stash', 'Бабушкина заначка', C_STASH, [
      [5, {}],
      [4, { jar: I('it_kopeyki') }],
      [1, { jar: I('it_samogon') }],
    ])
    .group('under', 'Под кроватью', C_ITEM, [
      [7, {}],
      [3, { under: I('it_canned') }],
    ])
    .loot('it_kopeyki', 0.5, 2, 6)
    .loot('it_bandage', 0.3, 1, 2)
    .loot('it_matches', 0.3, 1, 2)
    .build();
}

function roomRadio(): Room {
  return room('room_radio', 'Спец. квартира радиолюбителя', {
    tags: ['жилая', 'радио'],
    unique: true,
    gen: { weight: 1, min: 0, max: 1 },
    elite: [{ tierId: 'tier_15', weight: 100 }],
    note:
      'Тематическая: большая комната 1-464, 3.2×5.3 м (17 м²), превращённая в мастерскую: верстак у окна, ' +
      'стеллажи с деталями, шкафчик инструментов, радиола. Всегда элитность 15 — схемы почти гарантированы.',
  })
    .rect(0, 0, 3.2, 5.3)
    .open('S', 0.2, 'room>hall', 'Дверь из прихожей')
    .open('N', 2.2, 'room>balcony', 'Балконная дверь')
    .wall('p_radiator', 'N', 0.9)
    .wall('p_workbench', 'W', 0.6)
    .wall('p_shelf', 'W', 2.2)
    .wall('p_shelf', 'W', 3.3)
    .wall('p_tool_cab', 'E', 0.6)
    .wall('p_bookshelf', 'E', 1.6)
    .wall('p_bed1', 'E', 3.0)
    .wall('p_radio', 'S', 1.4)
    .spot('stool', 'Табурет у верстака', 0.95, 1.3, 0, 'stool')
    .spot('bench', 'Детали на верстаке', 0.35, 1.3, 0, 'bench')
    .spot('b1', 'Коробка 1', 2.6, 4.4, 0, 'boxes')
    .spot('b2', 'Коробка 2', 1.5, 4.5, 0, 'boxes')
    .group('stool', 'Табурет у верстака', C_SEAT, [
      [1, {}],
      [4, { stool: P('p_stool') }],
    ])
    .group('bench', 'Детали на верстаке', C_ITEM, [
      [4, {}],
      [6, { bench: I('it_components') }],
    ])
    .group('boxes', 'Коробки с деталями', C_FLOOR, [
      [3, {}],
      [4, { b1: P('p_boxes') }],
      [3, { b1: P('p_boxes'), b2: P('p_boxes') }],
    ])
    .loot('it_components', 0.5, 1, 3)
    .loot('it_batteries', 0.3, 1, 2)
    .loot('it_matches', 0.2, 1, 2)
    .build();
}

// ──────────────────────────────── Кладовки, балконы ────────────────────────────────

function closet1464(): Room {
  return room('closet_1464', 'Кладовка 1-464 (с антресолью)', {
    tags: ['кладовка'],
    gen: { weight: 2, min: 0, max: 99 },
    note: '1-464: встроенная кладовка 0.9×1.1 м (1 м²) из прихожей, над ней антресоль. Дверь 0.6.',
  })
    .rect(0, 0, 0.9, 1.1)
    .open('S', 0.2, 'closet>hall', 'Дверь')
    .wall('p_boxes', 'N', 0.15)
    .spot('shelf', 'Полка', 0.45, 0.7, 0, 'shelf')
    .group('shelf', 'На полке', C_ITEM, [
      [4, {}],
      [3, { shelf: I('it_canned') }],
      [2, { shelf: I('it_batteries') }],
      [1, { shelf: I('it_samogon') }],
    ])
    .loot('it_matches', 0.2, 1, 3)
    .build();
}

function balcony1464(): Room {
  return room('balcony_1464', 'Балкон 1-464', {
    tags: ['балкон'],
    gen: { weight: 2, min: 0, max: 99 },
    note: '1-464: балконная плита 2.8×0.8 м с металлическим ограждением. Балконная дверь 0.8.',
  })
    .rect(0, 0, 2.8, 0.8)
    .open('S', 0.2, 'balcony>room', 'Балконная дверь')
    .spot('m', 'Середина', 1.5, 0.25, 0, 'junk')
    .spot('e', 'Край балкона', 2.45, 0.3, 0, 'junk')
    .group('junk', 'Хлам на балконе', C_FLOOR, [
      [3, {}],
      [3, { e: P('p_boxes') }],
      [2, { e: P('p_bottle_crate') }],
      [2, { m: P('p_boxes'), e: P('p_bottle_crate') }],
    ])
    .loot('it_matches', 0.1, 1, 1)
    .build();
}

function balcony447(): Room {
  return room('balcony_447', 'Балкон 1-447 (кирпичный, с хламом)', {
    tags: ['балкон'],
    gen: { weight: 2, min: 0, max: 99 },
    note: '1-447: балкон 3.0×0.9 м, забитый хламом: ящик с пустыми бутылками и коробки. Балконная дверь 0.8.',
  })
    .rect(0, 0, 3.0, 0.9)
    .open('S', 2.0, 'balcony>room', 'Балконная дверь')
    .wall('p_bottle_crate', 'N', 0.1)
    .wall('p_boxes', 'N', 0.8)
    .spot('s', 'Угол у двери', 1.7, 0.35, 0, 'junk')
    .group('junk', 'Хлам', C_FLOOR, [
      [5, {}],
      [3, { s: P('p_trash') }],
      [2, { s: P('p_boxes') }],
    ])
    .loot('it_samogon', 0.03, 1, 1)
    .build();
}

/** Все комнаты стартового проекта (свежие объекты при каждом вызове). */
export function buildRooms(): Room[] {
  return [
    landing1464(),
    landing447(),
    landingMid(),
    stairFlight(),
    landingMalosem(),
    corridorLong(),
    corridorShort(),
    tambour(),
    foyer1464(),
    foyer447(),
    foyer335(),
    foyerGost(),
    kitchen1464(),
    kitchen447(),
    kitchen335(),
    kitchenSamogon(),
    bath1464(),
    bath335(),
    bathGost(),
    bath447(),
    wc447(),
    living1464(),
    bedroom1464(),
    room447(),
    room335(),
    kids468(),
    roomGost(),
    roomBabushka(),
    roomRadio(),
    closet1464(),
    balcony1464(),
    balcony447(),
    ...buildPublicRooms(),
    ...buildBasementRooms(),
    ...buildBarnRooms(),
    ...buildSnowRooms(),
    ...buildFactoryRooms(),
    ...buildFlatRooms(),
    ...buildSpecialRooms(),
  ];
}

export const START_ROOM_ID = 'landing_1464';
