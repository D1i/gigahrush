// Подвал — сеть ходов (биомы «Подвал», «Подвал заброшенный», «Подвал затопленный», layout 'tunnels'; рост —
// src/gen4d/stream.ts, правила — docs/GENERATOR-4D.md §17). Мебель и детали — набор пользователя basement-3d
// (в 3D — модели src/view3d/assets/basement_props.glb).
//
// Ход — 1.0 м в свету (как в наборе), стены — зазор gap между комнатами. Ходы стыкуются меткой 'basement' (проём 1.0 м
// во всю ширину хода): прямые куски 1, 2, 4, 6, 8 м (с порогом-зазором — шаг 1.1, 2.1, 4.1, 6.1, 8.1 м: из них
// складывается любая длина кольца с точностью до клетки), поворот 1×1 м, развилка, перекрёсток. Хабы — редкие залы:
// три–четыре хода и дверь-марш наверх ('stair', закрытый выход в квартиры). Кладовые — за боковыми дверями ходов
// ('basement>storage', решётчатая дверь 0.7 м).
//
// Теги: первый — 'подвал' (группа спавна и отделка: у подвалов — свои правила отделки биома), затем вид куска для
// роста ходов: 'ход' (прямой), 'поворот', 'развилка', 'хаб'.
import type { Room, RoomElite } from '../model/types';
import { I, P, room } from './roomBuilder';

const C_FLOOR = '#8ab17d';
const C_STASH = '#e76f51';
const C_ITEM = '#2a9d8f';
const NONE: RoomElite[] = [];

/** Мелочь на полу хода: лужа или доска вдоль хода по середине (плоское — проход не перегораживает), бутылка у стены.
 *  Споты: f — середина хода, повёрнут вдоль хода (90°); w — у стены. */
const FLOOR_BITS: Array<[number, Record<string, ReturnType<typeof P>>]> = [
  [6, {}],
  [3, { f: P('p_bsm_puddle') }],
  [2, { f: P('p_bsm_plank') }],
  [1, { w: P('p_bsm_bottle') }],
];

// ─────────────────────────────── Прямые куски ───────────────────────────────

function tunnel1(): Room {
  return room('bsm_tun_1', 'Ход подвала, 1 м', {
    tags: ['подвал', 'ход'],
    gen: { weight: 0.3, min: 0, max: 99 },
    elite: NONE,
    note: 'Короткая вставка хода 1.0×1.0 м: ею кольца ходов добирают длину до клетки.',
  })
    .rect(0, 0, 1, 1)
    .open('N', 0, 'basement', 'Ход (север)')
    .open('S', 0, 'basement', 'Ход (юг)')
    .build();
}

function tunnel2(): Room {
  return room('bsm_tun_2', 'Ход подвала, 2 м', {
    tags: ['подвал', 'ход'],
    gen: { weight: 1.5, min: 0, max: 99 },
    elite: NONE,
    note: 'Ход 1.0×2.0 м (модуль набора): труба отопления у пола вдоль стены, лампочка под потолком.',
  })
    .rect(0, 0, 1, 2)
    .open('N', 0, 'basement', 'Ход (север)')
    .open('S', 0, 'basement', 'Ход (юг)')
    .wall('p_bsm_valve', 'E', 0.65)
    .put('p_bsm_bulb', 0.5, 1.0)
    .build();
}

function tunnel4(): Room {
  return room('bsm_tun_4', 'Ход подвала, 4 м, с кладовой', {
    tags: ['подвал', 'ход'],
    gen: { weight: 2, min: 0, max: 99 },
    elite: NONE,
    note: 'Ход 1.0×4.0 м: решётчатая дверь в кладовую слева, трубы под потолком справа, лампочка.',
  })
    .rect(0, 0, 1, 4)
    .open('N', 0, 'basement', 'Ход (север)')
    .open('S', 0, 'basement', 'Ход (юг)')
    .open('W', 1.6, 'basement>storage', 'Кладовая')
    .wall('p_bsm_pipe_high', 'E', 0)
    .wall('p_bsm_pipe_high', 'E', 2)
    .put('p_bsm_bulb', 0.5, 2.0)
    .spot('f', 'На полу', 0.5, 3.0, 90, 'floor')
    .spot('w', 'У стены', 0.15, 3.0, 0, 'floor')
    .group('floor', 'На полу', C_FLOOR, FLOOR_BITS)
    .loot('it_matches', 0.08, 1, 1)
    .build();
}

function tunnel4Pipes(): Room {
  return room('bsm_tun_4p', 'Ход подвала, 4 м, трубы', {
    tags: ['подвал', 'ход'],
    gen: { weight: 1.5, min: 0, max: 99 },
    elite: NONE,
    note: 'Ход 1.0×4.0 м вдоль магистрали отопления: трубы у пола с задвижкой, трубы под потолком.',
  })
    .rect(0, 0, 1, 4)
    .open('N', 0, 'basement', 'Ход (север)')
    .open('S', 0, 'basement', 'Ход (юг)')
    .wall('p_bsm_pipe', 'W', 0.35)
    .wall('p_bsm_valve', 'W', 2.6)
    .wall('p_bsm_pipe_high', 'E', 0)
    .wall('p_bsm_pipe_high', 'E', 2)
    .put('p_bsm_bulb', 0.5, 1.2)
    .build();
}

function tunnel6(): Room {
  return room('bsm_tun_6', 'Ход подвала, 6 м, кладовые', {
    tags: ['подвал', 'ход'],
    gen: { weight: 2.5, min: 0, max: 99 },
    elite: NONE,
    note: 'Ход 1.0×6.0 м вдоль кладовых жильцов: решётчатые двери по обе стороны, трубы под потолком, две лампочки.',
  })
    .rect(0, 0, 1, 6)
    .open('N', 0, 'basement', 'Ход (север)')
    .open('S', 0, 'basement', 'Ход (юг)')
    .open('W', 1.0, 'basement>storage', 'Кладовая слева')
    .open('E', 3.6, 'basement>storage', 'Кладовая справа')
    .wall('p_bsm_pipe_high', 'W', 3.0)
    .wall('p_bsm_pipe_high', 'E', 0.6)
    .put('p_bsm_bulb', 0.5, 1.5)
    .put('p_bsm_bulb', 0.5, 4.5)
    .spot('f', 'На полу', 0.5, 2.6, 90, 'floor')
    .spot('w', 'У стены', 0.85, 2.0, 0, 'floor')
    .group('floor', 'На полу', C_FLOOR, FLOOR_BITS)
    .loot('it_matches', 0.1, 1, 1)
    .build();
}

function tunnel8(): Room {
  return room('bsm_tun_8', 'Длинный ход подвала, 8 м', {
    tags: ['подвал', 'ход'],
    gen: { weight: 2, min: 0, max: 99 },
    elite: NONE,
    note: 'Ход 1.0×8.0 м: трубы под потолком во всю длину, кладовые слева и справа, две лампочки — свет пятнами.',
  })
    .rect(0, 0, 1, 8)
    .open('N', 0, 'basement', 'Ход (север)')
    .open('S', 0, 'basement', 'Ход (юг)')
    .open('W', 2.0, 'basement>storage', 'Кладовая слева')
    .open('E', 5.2, 'basement>storage', 'Кладовая справа')
    .wall('p_bsm_pipe_high', 'E', 0)
    .wall('p_bsm_pipe_high', 'E', 2)
    .wall('p_bsm_pipe_high', 'W', 4)
    .wall('p_bsm_pipe_high', 'W', 6)
    .put('p_bsm_bulb', 0.5, 2.0)
    .put('p_bsm_bulb', 0.5, 6.0)
    .spot('f', 'На полу', 0.5, 4.0, 90, 'floor')
    .spot('w', 'У стены', 0.15, 3.6, 0, 'floor')
    .group('floor', 'На полу', C_FLOOR, FLOOR_BITS)
    .loot('it_canned', 0.06, 1, 1)
    .build();
}

// ─────────────────────────────── Повороты и развилки ───────────────────────────────

function turn(): Room {
  return room('bsm_tun_turn', 'Поворот хода', {
    tags: ['подвал', 'ход', 'поворот'],
    gen: { weight: 1, min: 0, max: 99 },
    elite: NONE,
    note: 'Поворот хода под прямым углом: 1.0×1.0 м, проёмы во всю ширину на соседних стенах (налево и направо — та же комната, другой стороной).',
  })
    .rect(0, 0, 1, 1)
    .open('S', 0, 'basement', 'Ход (юг)')
    .open('E', 0, 'basement', 'Ход (восток)')
    .put('p_bsm_bulb', 0.5, 0.5)
    .build();
}

function tee(): Room {
  return room('bsm_tun_T', 'Развилка хода', {
    tags: ['подвал', 'ход', 'развилка'],
    gen: { weight: 1, min: 0, max: 99 },
    elite: NONE,
    note: 'Ответвление: ход 1.0×2.0 м, сбоку — проём 1.0 м в боковой ход.',
  })
    .rect(0, 0, 1, 2)
    .open('N', 0, 'basement', 'Ход (север)')
    .open('S', 0, 'basement', 'Ход (юг)')
    .open('E', 0.5, 'basement', 'Ответвление')
    .put('p_bsm_bulb', 0.5, 1.0)
    .build();
}

function cross(): Room {
  return room('bsm_tun_X', 'Перекрёсток ходов', {
    tags: ['подвал', 'ход', 'развилка'],
    gen: { weight: 0.5, min: 0, max: 99 },
    elite: NONE,
    note: 'Пересечение двух ходов: крест 3.0×3.0 м с плечами 1.0 м, четыре проёма во всю ширину.',
  })
    .rect(1, 0, 1, 3)
    .rect(0, 1, 3, 1)
    .open('N', 1, 'basement', 'Ход (север)')
    .open('S', 1, 'basement', 'Ход (юг)')
    .open('W', 1, 'basement', 'Ход (запад)')
    .open('E', 1, 'basement', 'Ход (восток)')
    .put('p_bsm_bulb', 1.5, 1.5)
    .build();
}

// ─────────────────────────────── Хабы ───────────────────────────────

function hubColumns(): Room {
  return room('bsm_hub_columns', 'Подвальный узел с колоннами', {
    tags: ['подвал', 'хаб'],
    gen: { weight: 1, min: 0, max: 99 },
    elite: NONE,
    note:
      'Хаб: зал 6.0×5.0 м на двух кирпичных столбах. Три хода (запад, восток, север) и марш наверх (юг) — закрытая ' +
      'дверь в квартиры. Стеллажи жильцов, верстак, шкафчик.',
  })
    .rect(0, 0, 6, 5)
    .open('W', 2.0, 'basement', 'Ход (запад)')
    .open('E', 2.0, 'basement', 'Ход (восток)')
    .open('N', 2.5, 'basement', 'Ход (север)')
    .open('S', 2.4, 'stair', 'Марш наверх')
    .put('p_bsm_pillar', 2.0, 1.7)
    .put('p_bsm_pillar', 4.0, 1.7)
    .wall('p_bsm_shelf_jars', 'N', 0.3)
    .wall('p_bsm_shelf_wood', 'N', 4.4)
    .wall('p_bsm_workbench', 'S', 0.3)
    .wall('p_bsm_locker', 'S', 4.7)
    .put('p_bsm_bulb', 1.5, 1.5)
    .put('p_bsm_bulb', 4.5, 1.5)
    .put('p_bsm_bulb', 3.0, 3.6)
    .spot('bench', 'На верстаке', 1.05, 4.6, 0, 'bench')
    .group('bench', 'На верстаке', C_ITEM, [
      [4, {}],
      [3, { bench: I('it_components') }],
      [2, { bench: I('it_batteries') }],
      [1, { bench: I('it_matches') }],
    ])
    .build();
}

function hubCinema(): Room {
  return room('bsm_hub_cinema', 'Подвальный клуб (кинозал)', {
    tags: ['подвал', 'хаб'],
    gen: { weight: 0.8, min: 0, max: 99 },
    elite: NONE,
    note:
      'Хаб: подвальный клуб 6.0×6.0 м — три ряда кресел из кинотеатра с проходом посередине. Ходы — запад и восток у ' +
      'стены экрана, марш наверх — юг, по проходу.',
  })
    .rect(0, 0, 6, 6)
    .open('W', 0.4, 'basement', 'Ход (запад)')
    .open('E', 0.4, 'basement', 'Ход (восток)')
    .open('S', 2.45, 'stair', 'Марш наверх')
    .put('p_bsm_seats', 1.45, 2.2, 180)
    .put('p_bsm_seats', 4.55, 2.2, 180)
    .put('p_bsm_seats', 1.45, 3.4, 180)
    .put('p_bsm_seats', 4.55, 3.4, 180)
    .put('p_bsm_seats', 1.45, 4.6, 180)
    .put('p_bsm_seats', 4.55, 4.6, 180)
    .wall('p_bsm_cabinet', 'N', 2.55)
    .put('p_bsm_bulb', 1.5, 1.0)
    .put('p_bsm_bulb', 4.5, 1.0)
    .put('p_bsm_bulb', 3.0, 4.0)
    .spot('seat', 'На кресле', 1.0, 3.4, 0, 'seat')
    .group('seat', 'Забыто на кресле', C_ITEM, [
      [5, {}],
      [2, { seat: I('it_samogon') }],
      [2, { seat: I('it_kopeyki') }],
      [1, { seat: I('it_bandage') }],
    ])
    .build();
}

function hubBoiler(): Room {
  return room('bsm_hub_boiler', 'Тепловой узел', {
    tags: ['подвал', 'хаб'],
    gen: { weight: 1, min: 0, max: 99 },
    elite: NONE,
    note:
      'Хаб: тепловой узел 5.0×5.0 м — бак-теплообменник, магистрали у пола и под потолком с задвижками, радиаторы. ' +
      'Три хода и марш наверх в углу.',
  })
    .rect(0, 0, 5, 5)
    .open('N', 2.0, 'basement', 'Ход (север)')
    .open('W', 2.0, 'basement', 'Ход (запад)')
    .open('E', 2.0, 'basement', 'Ход (восток)')
    .open('S', 0.3, 'stair', 'Марш наверх')
    .put('p_boiler_tank', 3.9, 3.9)
    .wall('p_bsm_pipe', 'N', 0)
    .wall('p_bsm_valve', 'N', 3.6)
    .wall('p_bsm_pipe_high', 'W', 0)
    .wall('p_bsm_pipe_high', 'W', 3)
    .wall('p_bsm_radiator', 'S', 1.8)
    .wall('p_bsm_radiator', 'E', 0.4)
    .put('p_bsm_bulb', 2.5, 2.5)
    .put('p_bsm_bulb', 1.0, 4.0)
    .spot('tank', 'У бака', 2.9, 4.4, 0, 'tank')
    .group('tank', 'У бака', C_ITEM, [
      [5, {}],
      [3, { tank: I('it_components') }],
      [2, { tank: I('it_matches') }],
    ])
    .build();
}

function hubStorage(): Room {
  return room('bsm_hub_storage', 'Зал кладовых жильцов', {
    tags: ['подвал', 'хаб'],
    gen: { weight: 0.8, min: 0, max: 99 },
    elite: NONE,
    note:
      'Хаб: зал 6.0×4.0 м вдоль кладовых жильцов — решётчатые двери и перегородка из реек по северной стене, стеллажи с ' +
      'банками у южной. Ходы — запад и восток, марш наверх — юг.',
  })
    .rect(0, 0, 6, 4)
    .open('W', 1.5, 'basement', 'Ход (запад)')
    .open('E', 1.5, 'basement', 'Ход (восток)')
    .open('S', 2.5, 'stair', 'Марш наверх')
    .open('N', 0.4, 'basement>storage', 'Кладовая 1')
    .open('N', 4.9, 'basement>storage', 'Кладовая 2')
    .wall('p_bsm_slats', 'N', 1.9)
    .wall('p_bsm_shelf_jars', 'S', 0.4)
    .wall('p_bsm_shelf_metal', 'S', 4.4)
    .put('p_bsm_bulb', 1.5, 2.0)
    .put('p_bsm_bulb', 4.5, 2.0)
    .spot('box', 'У перегородки', 3.0, 0.5, 0, 'junk')
    .group('junk', 'Хлам у перегородки', C_FLOOR, [
      [4, {}],
      [3, { box: P('p_bsm_crate') }],
      [2, { box: P('p_bsm_box') }],
      [1, { box: P('p_bsm_trash') }],
    ])
    .build();
}

// ─────────────────────────────── Кладовые ───────────────────────────────

function storageJars(): Room {
  return room('bsm_storage_jars', 'Кладовая с заготовками', {
    tags: ['кладовка', 'подвал'],
    gen: { weight: 0.8, min: 0, max: 99 },
    note: 'Кладовая жильца 1.4×2.0 м за решётчатой дверью: стеллаж с банками заготовок, ящик.',
  })
    .rect(0, 0, 1.4, 2.0)
    .open('S', 0.35, 'storage>basement', 'Решётчатая дверь')
    .wall('p_bsm_shelf_jars', 'N', 0.12)
    .wall('p_bsm_crate', 'W', 0.7)
    .spot('shelf', 'На стеллаже', 0.7, 0.3, 0, 'stash')
    .group('stash', 'Заначка', C_STASH, [
      [4, {}],
      [4, { shelf: I('it_canned') }],
      [1, { shelf: I('it_samogon') }],
    ])
    .loot('it_canned', 0.3, 1, 2)
    .build();
}

function storageJunk(): Room {
  return room('bsm_storage_junk', 'Кладовая с хламом', {
    tags: ['кладовка', 'подвал'],
    gen: { weight: 0.7, min: 0, max: 99 },
    note: 'Кладовая 1.6×2.2 м: ржавый стеллаж, коробки, мешок с мусором, старый стул.',
  })
    .rect(0, 0, 1.6, 2.2)
    .open('S', 0.45, 'storage>basement', 'Решётчатая дверь')
    .wall('p_bsm_shelf_metal', 'N', 0.2)
    .wall('p_bsm_box', 'W', 0.7)
    .wall('p_bsm_trash', 'E', 0.7)
    .spot('shelf', 'На стеллаже', 0.8, 0.3, 0, 'stash')
    .group('stash', 'На стеллаже', C_STASH, [
      [4, {}],
      [3, { shelf: I('it_components') }],
      [2, { shelf: I('it_batteries') }],
    ])
    .build();
}

export function buildBasementRooms(): Room[] {
  return [
    tunnel1(), tunnel2(), tunnel4(), tunnel4Pipes(), tunnel6(), tunnel8(),
    turn(), tee(), cross(),
    hubColumns(), hubCinema(), hubBoiler(), hubStorage(),
    storageJars(), storageJunk(),
  ];
}
