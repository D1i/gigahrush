// Завод — сеть цехов (биом «Завод», layout 'tunnels'; рост — src/gen4d/stream.ts, правила — docs/GENERATOR-4D.md §21).
// Замысел заказчика: завод из шестерёнок, сталелитейных комплексов и «кручения всего подряд»; чтобы пройти игру, надо
// идти туда, где влажнее, — там начнётся болото; встал на шестерню — она зубом вдавливает в грязь на крыше, и ты
// вылезаешь из болота рядом с военной частью (финал — src/locations/swampEnd.ts).
//
// Кусок цеха — пролёт: проход 2 м посередине (метка 'factory' во всю ширину прохода, с подвалом и сараем не стыкуется),
// по сторонам — ряды станков по 1.5 м за перилами, двутавровые колонны у стен. Станки — споты с розыгрышем (каждый
// экземпляр пролёта свой): места по 2 м, пара мест — или два станка, или один длинный (пара шестерён, конвейер, насос).
// Модели — набор пользователя factory-to-swamp (tools/optimize-factory.mjs → src/view3d/assets/factory_props.glb),
// подвижные части крутятся (src/view3d/propAnim.ts). Отделка — текстуры того же набора (= подвальные f_bsm_*).
//
// Ступени влажности (src/gen4d/wet.ts, тег после 'ход' / 'хаб' — по нему и отделка биома):
//  • сухо — машинный цех: шестерни, маховики, валы, вентиляторы, прессы; лампы-«тарелки»; пыльный бетон, побелка;
//  • сыро — сталелитейка: печи, ковши, формы с расплавом (светятся), тали, конденсат; трубы под потолком;
//  • течь — насосы, вентили, течь с потолка (капли в проходе), лужи, сырой бетон;
//  • топь — вода по полу, грязевые островки, камыш, сухие деревья сквозь пол, ржавые шестерни.
// Каждая ступень — полный набор: прямые 4, 6, 8 м, повороты 2 × 2 м (направо, налево), тройник, крестовина, цех-хаб.
// Комната-финал «Лестница на крышу» (спец-локация 'swamp') ставится не ростом, а правилом влажности (w ≥ 1).
//
// Теги: первый — 'завод' (группа спавна; двери гермодверью — src/blockout/doors.ts), затем 'ход' / 'хаб', ступень,
// 'только-биом' (BIOME_ONLY_TAG: только в биоме бесконечного мира).
import type { Room, RoomElite } from '../model/types';
import { newSwamp } from '../locations/swampEnd';
import { I, P, room, type Fill, type RoomBuilder } from './roomBuilder';
import { WET_TAGS } from '../gen4d/wet';

const C_MACH = '#e9a23b';
const C_ITEM = '#2a9d8f';
const C_FLOOR = '#4a7a8a';
const NONE: RoomElite[] = [];
const ONLY = 'только-биом';
/** ряд станков, проход, ширина пролёта, м */
const ZONE = 1.5;
const AISLE = 2;
const SPAN = ZONE + AISLE + ZONE;

type Lv = 0 | 1 | 2 | 3;
type Rows = Array<[number, string | null]>;

/** Станки на место 2 м (вес, prop; null — пусто). */
const SINGLE: Record<Lv, Rows> = {
  0: [[3, 'p_fac_gear_large'], [1.5, 'p_fac_gear_small'], [2, 'p_fac_flywheel'], [1.5, 'p_fac_shaft'], [1.5, 'p_fac_fan'], [1.5, 'p_fac_press'], [0.5, 'p_fac_stairs'], [0.5, 'p_fac_scrap'], [0.4, null]],
  1: [[2.5, 'p_fac_furnace'], [2, 'p_fac_ladle'], [1.5, 'p_fac_mold'], [1.5, 'p_fac_hoist'], [1.2, 'p_fac_press'], [1, 'p_fac_gear_large'], [0.8, 'p_fac_flywheel'], [0.5, 'p_fac_barrel']],
  2: [[2, 'p_fac_valve'], [1.5, 'p_fac_barrel'], [1.5, 'p_fac_gear_small'], [1, 'p_fac_flywheel'], [1, 'p_fac_scrap'], [0.8, 'p_fac_gate'], [0.8, 'p_fac_gear_large'], [0.5, null]],
  3: [[3, 'p_fac_reeds'], [2, 'p_fac_mud'], [1.5, 'p_fac_tree'], [1, 'p_fac_barrel'], [1, 'p_fac_gear_large'], [1, 'p_fac_scrap'], [0.5, null]],
};
/** Длинные станки на пару мест (4 м). */
const DOUBLE: Record<Lv, Rows> = {
  0: [[2, 'p_fac_gear_pair'], [2, 'p_fac_conveyor']],
  1: [[2, 'p_fac_conveyor'], [1, 'p_fac_gear_pair']],
  2: [[2.5, 'p_fac_pump'], [1, 'p_fac_conveyor']],
  3: [[1, 'p_fac_gear_pair']],
};
/** Доля «длинный станок» у пары мест. */
const DOUBLE_SHARE: Record<Lv, number> = { 0: 0.35, 1: 0.35, 2: 0.4, 3: 0.15 };

/** Что лежит у станка (спот в проходе у ряда). */
const LOOT: Array<[number, string | null]> = [[7, null], [2, 'it_components'], [1, 'it_batteries'], [1, 'it_matches']];

/** Над проходом: что висит через каждые 2 м (вес, prop). */
const OVER: Record<Lv, Rows> = {
  0: [[3, 'p_fac_lamp'], [1, null]],
  1: [[1.5, 'p_fac_lamp'], [1, 'p_fac_leak'], [1.5, null]],
  2: [[3, 'p_fac_leak'], [0.6, 'p_fac_lamp'], [0.6, null]],
  3: [[2.5, 'p_fac_leak'], [1.5, null]],
};
/** На полу прохода (лужи). */
const FLOOR: Record<Lv, Rows> = {
  0: [],
  1: [[1, 'p_bsm_puddle'], [5, null]],
  2: [[3, 'p_bsm_puddle'], [1, null]],
  3: [[2, 'p_fac_mud'], [2, null]],
};

const LV_NAME: Record<Lv, string> = { 0: 'сухой', 1: 'сырой', 2: 'течёт', 3: 'топь' };
const tags = (kind: 'ход' | 'хаб', lv: Lv, extra: string[] = []): string[] => ['завод', kind, WET_TAGS[lv], ...extra, ONLY];

const fills = (rows: Rows, key: string, rot = 0): Array<[number, Record<string, Fill>]> =>
  rows.map(([w, prop]) => [w, prop ? { [key]: P(prop, rot) } : {}]);

/**
 * Ряд станков у стены side ('W' — x 0…1.5, 'E' — x 3.5…5) на участке y ∈ [y0, y0 + n·2): места по 2 м; пары мест —
 * группа «два станка или один длинный». Перед станка — к проходу. Перила по краю прохода, у станка — спот находки.
 */
function machines(b: RoomBuilder, side: 'W' | 'E', y0: number, n: number, lv: Lv, rail = true): void {
  const x = side === 'W' ? ZONE / 2 : SPAN - ZONE / 2;
  const rot = side === 'W' ? 270 : 90;
  // перила — у края ряда, не на линии проёма прохода (проём — x 1.5…3.5)
  const xr = side === 'W' ? ZONE - 0.06 : SPAN - ZONE + 0.06;
  let k = 0;
  while (k < n) {
    const pair = n - k >= 2 && DOUBLE[lv].length > 0;
    const y = y0 + k * 2;
    const g = `${side}${k}`;
    const a = `${g}a`, c = `${g}c`;
    b.spot(a, `Станок ${side}${k + 1}`, x, y + 1, rot, g);
    if (pair) {
      const d = `${g}d`;
      b.spot(c, `Станок ${side}${k + 2}`, x, y + 3, rot, g);
      b.spot(d, `Длинный станок ${side}${k + 1}–${k + 2}`, x, y + 2, rot, g);
      const singles = SINGLE[lv];
      const sum = singles.reduce((s, [w]) => s + w, 0);
      const share = DOUBLE_SHARE[lv];
      const variants: Array<[number, Record<string, Fill>]> = [];
      // два станка: пары «станок i — станок i + 1 / i + 3» (веса — произведение), чтобы рядом не стояли одинаковые
      for (let i = 0; i < singles.length; i++) for (const off of [1, 3]) {
        const [w1, p1] = singles[i], [w2, p2] = singles[(i + off) % singles.length];
        const f: Record<string, Fill> = {};
        if (p1) f[a] = P(p1);
        if (p2) f[c] = P(p2);
        variants.push([((1 - share) * w1 * w2) / (sum * sum), f]);
      }
      const dsum = DOUBLE[lv].reduce((s, [w]) => s + w, 0);
      for (const [w, p] of DOUBLE[lv]) if (p) variants.push([(share * w) / dsum, { [d]: P(p) }]);
      b.group(g, side === 'W' ? 'Станки (запад)' : 'Станки (восток)', C_MACH, variants.map(([w, f]) => [Math.round(w * 1e4) / 1e4, f]));
      k += 2;
    } else {
      b.group(g, side === 'W' ? 'Станок (запад)' : 'Станок (восток)', C_MACH, fills(SINGLE[lv], a));
      k += 1;
    }
  }
  for (let j = 0; j < n; j++) {
    if (rail) b.put('p_fac_railing', xr, y0 + j * 2 + 1, 90);
    if (j > 0) b.put('p_fac_column', side === 'W' ? 0.1 : SPAN - 0.1, y0 + j * 2);
  }
  // находка — у одного из станков ряда, на полу прохода
  const lx = side === 'W' ? ZONE + 0.3 : SPAN - ZONE - 0.3;
  const key = `l${side}${y0}`;
  b.spot(key, 'У станка', lx, y0 + Math.max(1, n) - 0.5, 0, key);
  b.group(key, 'У станка', C_ITEM, LOOT.map(([w, it]) => [w, it ? { [key]: I(it) } : {}]));
}

/** Над проходом x = cx, через 2 м от y0 (n штук): лампы / течь; на полу — лужи. */
function aisle(b: RoomBuilder, cx: number, y0: number, n: number, lv: Lv, along: 'ns' | 'ew' = 'ns'): void {
  for (let j = 0; j < n; j++) {
    const [x, y] = along === 'ns' ? [cx, y0 + j * 2 + 1] : [y0 + j * 2 + 1, cx];
    const o = `o${along}${j}`;
    b.spot(o, 'Под потолком', x, y, along === 'ns' ? 90 : 0, o);
    b.group(o, 'Под потолком', C_FLOOR, fills(OVER[lv], o));
    if (FLOOR[lv].length) {
      const f = `f${along}${j}`;
      b.spot(f, 'На полу', x + (along === 'ns' ? 0.2 : 0), y + (along === 'ns' ? 0 : 0.2), j % 2 ? 90 : 0, f);
      b.group(f, 'На полу', C_FLOOR, fills(FLOOR[lv], f));
    }
  }
}

/** Трубы под потолком над рядами (сыро и мокрее) — вдоль пролёта. */
function pipes(b: RoomBuilder, len: number, lv: Lv): void {
  if (lv < 1 || len < 3) return;
  for (let y = 1.5; y + 1.5 <= len; y += 3) {
    b.put('p_fac_pipe', 0.35, y, 90);
    if (lv >= 2) b.put('p_fac_pipe', SPAN - 0.35, y, 90);
  }
}

// ─────────────────────────────── Пролёты ───────────────────────────────

function bay(lv: Lv, len: 4 | 6 | 8, weight: number): Room {
  const id = `fac_bay_${lv}_${len}`;
  const n = len / 2;
  const b = room(id, `Пролёт цеха, ${len} м (${LV_NAME[lv]})`, {
    tags: tags('ход', lv),
    gen: { weight, min: 0, max: 99 },
    elite: NONE,
    note: `Пролёт ${SPAN}×${len} м: проход 2 м между двумя рядами станков по 1.5 м за перилами (${n} места с каждой ` +
      `стороны, станки разыгрываются). Ступень влажности — «${WET_TAGS[lv]}».`,
  })
    .rect(0, 0, SPAN, len)
    .open('N', ZONE, 'factory', 'Проход (север)')
    .open('S', ZONE, 'factory', 'Проход (юг)');
  machines(b, 'W', 0, n, lv);
  machines(b, 'E', 0, n, lv);
  aisle(b, SPAN / 2, 0, n, lv);
  pipes(b, len, lv);
  return b.build();
}

/** Поворот прохода 2 × 2 м: вход с юга, выход на восток (направо) или на запад (налево). */
function turn(lv: Lv, right: boolean): Room {
  const b = room(`fac_turn_${lv}_${right ? 'r' : 'l'}`, `Поворот цеха ${right ? 'направо' : 'налево'} (${LV_NAME[lv]})`, {
    tags: tags('ход', lv, ['поворот']),
    gen: { weight: 0.6, min: 0, max: 99 },
    elite: NONE,
    note: `Г-образный поворот прохода 2×2 м: вход с юга, выход ${right ? 'на восток' : 'на запад'}; колонна в углу.`,
  })
    .rect(0, 0, AISLE, AISLE)
    .open('S', 0, 'factory', 'Проход (юг)')
    .open(right ? 'E' : 'W', 0, 'factory', right ? 'Проход (восток)' : 'Проход (запад)')
    .put('p_fac_column', right ? 0.1 : AISLE - 0.1, 0.1);
  aisle(b, AISLE / 2, 0, 1, lv);
  return b.build();
}

/** Тройник: проход север — юг, вместо ряда станков на западе — боковой проход (y 1…3); крестовина — и на востоке. */
function tee(lv: Lv, cross: boolean): Room {
  const id = `fac_${cross ? 'cross' : 'tee'}_${lv}`;
  const b = room(id, `${cross ? 'Перекрёсток' : 'Развилка'} цеха (${LV_NAME[lv]})`, {
    tags: tags('ход', lv, ['развилка']),
    gen: { weight: cross ? 0.6 : 1, min: 0, max: 99 },
    elite: NONE,
    note: cross
      ? `Перекрёсток ${SPAN}×4 м: проход север — юг и поперечный проход 2 м сквозь оба ряда станков.`
      : `Развилка ${SPAN}×4 м: с запада вместо станков — боковой проход 2 м, с востока — ряд станков.`,
  })
    .rect(0, 0, SPAN, 4)
    .open('N', ZONE, 'factory', 'Проход (север)')
    .open('S', ZONE, 'factory', 'Проход (юг)')
    .open('W', 1, 'factory', 'Боковой проход (запад)');
  if (cross) b.open('E', 1, 'factory', 'Боковой проход (восток)');
  else machines(b, 'E', 0, 2, lv);
  // колонны по углам бокового прохода
  for (const x of cross ? [0.1, SPAN - 0.1] : [0.1]) for (const y of [0.4, 3.6]) b.put('p_fac_column', x, y);
  aisle(b, SPAN / 2, 0, 2, lv);
  return b.build();
}

// ─────────────────────────────── Цеха-хабы ───────────────────────────────

interface HubDef {
  id: string;
  name: string;
  note: string;
  w: number;
  h: number;
  /** проходы: стена, начало, м */
  doors: Array<['N' | 'S' | 'E' | 'W', number]>;
  dress(b: RoomBuilder): void;
}

function hub(lv: Lv, d: HubDef): Room {
  const b = room(d.id, d.name, { tags: tags('хаб', lv), gen: { weight: 1, min: 0, max: 99 }, elite: NONE, note: d.note }).rect(0, 0, d.w, d.h);
  d.doors.forEach(([side, from], k) => b.open(side, from, 'factory', `Проход ${k + 1}`));
  d.dress(b);
  b.spot('h_loot', 'В цеху', d.w / 2 + 1.2, d.h / 2 + 1.2, 0, 'h_loot');
  b.group('h_loot', 'В цеху', C_ITEM, [[4, {}], [3, { h_loot: I('it_components') }], [1, { h_loot: I('it_batteries') }], [1, { h_loot: I('it_flashlight') }]]);
  return b.build();
}

/** Цех-хаб — 6.3 × 6.3 м: внутри комнаты обзор не длиннее предела «Прогулки» 9 м (иначе генератор её исключит). */
const HUB = 6.3;
/** Проход хаба посередине стены. */
const MID = (HUB - AISLE) / 2;

const HUBS: Record<Lv, HubDef> = {
  0: {
    id: 'fac_hub_0',
    name: 'Машинный зал (сухой)',
    note: 'Хаб: машинный зал 6.3×6.3 м — посередине поворотный круг в полу, по углам шестерни, маховик, вал, вентиляторы, ' +
      'всё крутится; лампы-«тарелки». Четыре прохода посередине стен.',
    w: HUB,
    h: HUB,
    doors: [['S', MID], ['N', MID], ['W', MID], ['E', MID]],
    dress: (b) => {
      b.put('p_fac_platform', HUB / 2, HUB / 2, 0)
        .wall('p_fac_gear_large', 'N', 0.2)
        .wall('p_fac_flywheel', 'N', 4.4)
        .wall('p_fac_fan', 'S', 0.4)
        .wall('p_fac_gear_small', 'S', 4.6)
        .wall('p_fac_gear_small', 'W', 0.6)
        .wall('p_fac_gear_large', 'W', 4.3)
        .wall('p_fac_fan', 'E', 0.5)
        .wall('p_fac_shaft', 'E', 4.25);
      for (const [x, y] of [[1.6, 1.6], [4.7, 1.6], [1.6, 4.7], [4.7, 4.7]]) b.put('p_fac_lamp', x, y);
    },
  },
  1: {
    id: 'fac_hub_1',
    name: 'Сталелитейный цех (сырой)',
    note: 'Хаб: литейный цех 6.3×6.3 м — у северной стены две плавильные печи и наклонный ковш, перед ними формы с ' +
      'расплавом (светятся), козловая таль, бочки; трубы под потолком, с потолка подтекает. Три прохода.',
    w: HUB,
    h: HUB,
    doors: [['S', MID], ['W', MID], ['E', MID]],
    dress: (b) => {
      b.wall('p_fac_furnace', 'N', 0.3)
        .wall('p_fac_ladle', 'N', 2.2)
        .wall('p_fac_furnace', 'N', 4.5)
        .put('p_fac_mold', 1.25, 2.0, 0)
        .put('p_fac_mold', 3.15, 2.0, 0)
        .put('p_fac_mold', 5.05, 2.0, 0)
        .wall('p_fac_hoist', 'W', 4.4)
        .wall('p_fac_barrel', 'S', 4.4)
        .wall('p_fac_barrel', 'S', 5.05)
        .wall('p_fac_barrel', 'E', 4.6)
        .put('p_fac_leak', 3.15, 4.2, 0);
      for (const y of [1.6, 4.7]) b.put('p_fac_pipe', 0.35, y, 90).put('p_fac_pipe', HUB - 0.35, y, 90);
    },
  },
  2: {
    id: 'fac_hub_2',
    name: 'Насосная (течёт)',
    note: 'Хаб: насосная 6.3×6.3 м — насосы с поршнями, вентили на трубах, с потолка течёт в трёх местах, лужи по полу, ' +
      'ржавые бочки, шлагбаум. Три прохода.',
    w: HUB,
    h: HUB,
    doors: [['S', MID], ['N', MID], ['E', MID]],
    dress: (b) => {
      b.wall('p_fac_pump', 'W', 0.2)
        .wall('p_fac_pump', 'W', 3.9)
        .wall('p_fac_valve', 'N', 1.0)
        .wall('p_fac_valve', 'N', 4.4)
        .wall('p_fac_barrel', 'S', 1.1)
        .wall('p_fac_barrel', 'S', 4.5)
        .wall('p_fac_flywheel', 'E', 0.4)
        .wall('p_fac_gate', 'E', 4.4)
        .put('p_bsm_puddle', 3.15, 3.15, 0)
        .put('p_bsm_puddle', 2.0, 4.6, 90)
        .put('p_fac_leak', 3.15, 3.15, 0)
        .put('p_fac_leak', 1.8, 1.8, 90)
        .put('p_fac_leak', 4.5, 4.6, 0);
      for (const x of [1.6, 4.7]) b.put('p_fac_pipe', x, 0.35, 0).put('p_fac_pipe', x, HUB - 0.35, 0);
    },
  },
  3: {
    id: 'fac_hub_3',
    name: 'Затопленный цех (топь)',
    note: 'Хаб: затопленный цех 6.3×6.3 м — вода по полу, грязевые островки и камыш, сквозь пол проросло сухое дерево, ' +
      'по воде — деревянный настил; ржавая шестерня и поворотный круг ещё крутятся. Три прохода.',
    w: HUB,
    h: HUB,
    doors: [['S', MID], ['N', MID], ['W', MID]],
    dress: (b) => {
      b.put('p_fac_boardwalk', HUB / 2, 5.3, 0)
        .put('p_fac_boardwalk', HUB / 2, 1.0, 0)
        .put('p_fac_mud', 1.2, 1.1, 0)
        .put('p_fac_mud', 5.2, 5.0, 90)
        .put('p_fac_reeds', 0.7, 5.5, 0)
        .put('p_fac_reeds', 1.7, 5.0, 90)
        .put('p_fac_reeds', 5.6, 1.0, 0)
        .put('p_fac_tree', 5.4, 2.6, 90)
        .wall('p_fac_gear_large', 'E', 4.2)
        .put('p_fac_platform', 1.6, HUB / 2, 0)
        .put('p_fac_leak', HUB / 2, 3.0, 0)
        .put('p_fac_leak', 4.4, 5.0, 90);
    },
  },
};

// ─────────────────────────────── Финал ───────────────────────────────

/** «Лестница на крышу» — спец-локация 'swamp': болото на крыше завода и шестерня, которая вдавливает в грязь. */
function roofStairs(): Room {
  const r = room('fac_swamp_roof', 'Лестница на крышу (болото)', {
    tags: ['завод', WET_TAGS[3], 'болото', ONLY],
    gen: { weight: 1, min: 0, max: 99 },
    elite: NONE,
    note:
      'Спец-локация «Болото на крыше» — финал игры: топкая комната 4×4 м с железной лестницей наверх, вода по колено, ' +
      'камыш, с потолка течёт. Ставится правилом влажности, когда мокрый ход дошёл до болота (w = 1). Вход — своя сцена: ' +
      'крыша завода заросла болотом, посреди — огромная шестерня; встал на неё — зуб вдавливает в грязь, и ты ' +
      'вылезаешь из болота рядом с военной частью.',
  })
    .rect(0, 0, 4, 4)
    .open('S', 1, 'factory', 'Проход (юг)')
    .put('p_fac_stairs', 2, 1.1, 180)
    .put('p_fac_reeds', 0.6, 0.7, 0)
    .put('p_fac_reeds', 3.4, 3.2, 90)
    .put('p_fac_mud', 3.2, 1.2, 90)
    .put('p_fac_leak', 2, 2.6, 0)
    .put('p_fac_column', 0.1, 0.1)
    .put('p_fac_column', 3.9, 0.1)
    .build();
  r.location = newSwamp();
  return r;
}

export function buildFactoryRooms(): Room[] {
  const out: Room[] = [];
  for (const lv of [0, 1, 2, 3] as Lv[]) {
    out.push(bay(lv, 4, 1.5), bay(lv, 6, 2), bay(lv, 8, 1.5), turn(lv, true), turn(lv, false), tee(lv, false), tee(lv, true), hub(lv, HUBS[lv]));
  }
  out.push(roofStairs());
  return out;
}
