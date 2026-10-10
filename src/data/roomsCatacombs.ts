// Катакомбы — сеть ходов под Петербургом (биом «Катакомбы», layout 'tunnels'; рост — src/gen4d/stream.ts, правила —
// docs/GENERATOR-4D.md §17 и раздел «Катакомбы»). Замысел заказчика: питерские катакомбы, которые периодически
// затапливает водой; надо место, чтобы прятаться от наводнения; проходы, тоннели, колонны станции обслуживания;
// советские части, имперские и смешанные (стены одного отваливаются — под ними более старые); трубы, через которые
// надо перелазить; квадратные маленькие проходы; без освещения; иногда валяются бутылки и мусор.
//
// Сеть (как подвал и завод): ходы стыкуются меткой 'catacombs' во всю ширину хода 2.0 м — прямые куски 1, 2, 4, 6, 8 м
// (имперская галерея — 9 м; с порогом-зазором шаги 11, 21, 41, 61, 81, 91 клетка: кольца добирают длину до клетки),
// поворот 2×2, тройник 2×4, крестовина 6×6; куски-«препятствия» с трубой поперёк хода. Три эпохи — второй тег, по нему
// и отделка (правил на 'катакомбы' нет):
//  • 'имперский' — кирпичный цилиндрический свод XIX в.: потолок 3.0 (Room.ceilM), своды-вкладыши p_cat_vault_1/_2
//    по всей длине прямых (подвесные, тег «потолок»: пята 2.0, замок 3.0), рейки уровня воды p_cat_mark, трубы по стене;
//  • 'советский' — бетон и зелёная масляная панель: потолок 2.6, кабельные лотки, разбитые плафоны, электрощиты,
//    трафареты, иногда гермодверь или затвор на стене (декор, закрыты);
//  • 'смешанный' — советская облицовка отваливается, под ней старый кирпич: потолок 3.0 (под облицовкой показался
//    кирпичный свод) или 2.6; в проломе стены сбоку хода (ниша по габариту завала, ~1.7×2.2 м) — завал кирпича и
//    штукатурки p_cat_rubble (2.2×1.65: в ходе 2.0 м он перегородил бы проход — поэтому только в проломе).
// Трубы поперёк хода (куски-препятствия, тег 'препятствие'): p_cat_pipe_low (ось 0.55 — перелезть, E), p_cat_pipe_mid
// (1.05 — перелезть или проползти под ней), p_cat_pipe_high (1.65 — пригнуться). Проходимость в плане их не считает
// (теги пропа 'перелаз' / 'пригнуться' — src/gen/walk.ts): через них перелезают или проходят под ними.
// Лазы 'лаз' — квадратные ходы 0.8×0.8 (метка 'cat_duct', ширина 0.8, потолок 0.85: только ползком) — прямые 1, 2, 4 м
// и поворот; устье лаза — кусок хода с 'catacombs' с одной стороны и 'cat_duct' с другой (дыра у пола в торце хода):
// прямой кусок для роста, он же выводит из лаза обратно в ход. Сеть изредка уходит в лаз и через пару кусков
// возвращается: вес устьев (1.2) против прямых хода (~22) — в лаз уходит ~1 прямой из 20, против прямых лаза (1.8) —
// из лаза выходят на ~40% прямых кусков.
//
// Наводнение (src/locations/catacombsFlood.ts): вода поднимается до 2.0 м над полом сети, сухо — только на площадках
// убежищ на отметке +2.1 (Room.stair: марш 14 ступеней по 0.15 и площадка pads[].z = 2.1). Сухое место есть у КАЖДОГО
// хаба (машинная площадка насосной, галерея колонного зала, антресоль зала-убежища) и в боковых нишах-убежищах
// (дверь хода 'catacombs>refuge' 0.9 м: за ней с шансом tunnels.storage — ниша 2×3.6–2×4 м с лестницей на полати,
// матрасом, огарками и бутылками, иначе проём заложен кирпичом). Все проходы сети — на z = 0: площадки не касаются
// меток (иначе connDz поднял бы соседей). У зала с лестницей стены и потолок выше на подъём (blockout liftPiece):
// Room.ceilM считается над площадкой — колонны станции (3.31 м) стоят на машинной площадке и упираются в свод.
// Хабы — с маршем наверх 'stair' (закрытый выход сети и приход бесконечной лестницей) и 3–4 ходами.
//
// Теги: первый — 'катакомбы' (группа спавна), затем эпоха или вид ('лаз', 'станция', 'убежище' — по нему отделка), вид
// куска сети — 'ход' / 'хаб' (+ 'поворот', 'развилка', 'устье', 'препятствие'). У всех — 'только-биом'
// (BIOME_ONLY_TAG): растут только в биоме «Катакомбы». Света нет ни одного (Biome.dark 1) — только фонарь игрока;
// огарки p_cat_candles не светятся. Мусор — споты с розыгрышем: в ходах редко (15–25%), в убежищах чаще (40–70%).
import { straightStair } from '../model/stairs';
import type { Room, RoomElite } from '../model/types';
import { PROP_BY_ID } from './props';
import { I, P, room, type Fill, type RoomBuilder } from './roomBuilder';

const C_JUNK = '#8a7a5a';
const C_STASH = '#e76f51';
const NONE: RoomElite[] = [];
const ONLY = 'только-биом';
/** ширина хода и лаза, м */
const COR = 2;
const DUCT = 0.8;
/** пролом стены с завалом сбоку хода, м: поперёк × вдоль хода — по габариту завала (повёрнут вдоль хода), с округлением
 *  до клетки вверх */
const RUBBLE = PROP_BY_ID['p_cat_rubble'];
const up01 = (m: number) => Math.ceil(m * 10 - 1e-6) / 10;
const BREACH: [number, number] = [up01(RUBBLE.h), up01(RUBBLE.w)];
/** отметка сухой площадки убежища, м (пик воды — 2.0) */
const DRY_Z = 2.1;
/** потолки, м: имперский свод (замок), советский ход, лаз; станции, зал-убежище, ниша — над сухой площадкой */
const CEIL_IMP = 3.0;
const CEIL_SOV = 2.6;
const CEIL_DUCT = 0.85;
const CEIL_STATION = 3.3;
const CEIL_REFUGE = 2.4;
const CEIL_NICHE = 2.3;

type Era = 'imp' | 'sov' | 'mix';
const ERA_TAG: Record<Era, string> = { imp: 'имперский', sov: 'советский', mix: 'смешанный' };
const ERA_NAME: Record<Era, string> = { imp: 'Имперский', sov: 'Советский', mix: 'Смешанный' };

const meta = (tags: string[], weight: number, note: string) => ({
  tags: ['катакомбы', ...tags, ONLY], gen: { weight, min: 0, max: 99 }, elite: NONE, note,
});

/** Своя высота потолка комнаты (Room.ceilM). */
function ceil(r: Room, m: number): Room {
  r.ceilM = m;
  return r;
}

// ─────────────────────────────── мусор и находки ───────────────────────────────

/** Мусор у стены (вес, prop): бутылки, банки, газеты, тряпьё, сапог («россыпь» — под ногами, ходу не мешает). Куча
 *  хлама p_cat_trash — только в убежищах. */
const JUNK: Array<[number, string]> = [
  [3, 'p_cat_bottle'], [1.5, 'p_cat_bottles'], [2, 'p_cat_can'], [2, 'p_cat_paper'], [1.5, 'p_cat_rag'], [0.6, 'p_cat_boot'],
];
const JUNK_REFUGE: Array<[number, string]> = [...JUNK, [1.5, 'p_cat_trash']];

/** Спот мусора: с шансом chance — что-то из list, иначе пусто. */
function junk(b: RoomBuilder, key: string, x: number, y: number, rot: number, chance: number, list = JUNK): RoomBuilder {
  const sum = list.reduce((s, [w]) => s + w, 0);
  const vs: Array<[number, Record<string, Fill>]> = list.map(([w, p]) => [w, { [key]: P(p, rot) }]);
  if (chance < 1) vs.unshift([Math.round(((sum * (1 - chance)) / chance) * 10) / 10, {}]);
  return b.spot(key, 'Мусор', x, y, 0, key).group(key, 'Мусор', C_JUNK, vs);
}

/** Заначка в убежище: консервы, спички, бинт, батарейки — чаще, чем пусто. */
function stash(b: RoomBuilder, x: number, y: number, name: string): RoomBuilder {
  return b.spot('stash', name, x, y, 0, 'stash').group('stash', name, C_STASH, [
    [3, {}], [3, { stash: I('it_canned') }], [2, { stash: I('it_matches') }], [1, { stash: I('it_bandage') }], [1, { stash: I('it_batteries') }],
    [0.5, { stash: I('it_samogon') }],
  ]);
}

// ─────────────────────────────── своды и проломы ───────────────────────────────

/**
 * Кирпичный свод-вкладыш по оси хода (пролёт 2.0 — по w пропа, длина — по h): вдоль ns — центры по x = cx от y0 на len м,
 * вдоль ew — по y = cx от x = y0. Куски по 2 м, остаток — 1 м. Подвесные (тег «потолок»): висят под своим потолком.
 */
function vaults(b: RoomBuilder, y0: number, len: number, along: 'ns' | 'ew' = 'ns', cx = COR / 2): RoomBuilder {
  let t = 0;
  const at = (id: string, mid: number) => (along === 'ns' ? b.put(id, cx, y0 + mid, 0) : b.put(id, y0 + mid, cx, 90));
  while (len - t >= 2 - 1e-9) {
    at('p_cat_vault_2', t + 1);
    t += 2;
  }
  if (len - t >= 1 - 1e-9) at('p_cat_vault_1', t + 0.5);
  return b;
}

/** Пролом стены сбоку хода с завалом: ниша BREACH (поперёк × вдоль) от x0 на высоте y0, завал во всю нишу. */
function breach(b: RoomBuilder, x0: number, y0: number): RoomBuilder {
  const [w, l] = BREACH;
  return b.rect(x0, y0, w, l).put('p_cat_rubble', x0 + w / 2, y0 + l / 2, 90);
}

// ─────────────────────────────── прямые куски ───────────────────────────────

type SideDoor = ['W' | 'E', number];

interface StraightDef {
  id: string;
  era: Era;
  len: number;
  weight: number;
  note: string;
  /** двери в ниши-убежища: стена, начало, м */
  doors?: SideDoor[];
  /** пролом с завалом: стена и начало вдоль хода, м (западный — ход сдвинут на ширину пролома) */
  breach?: ['W' | 'E', number];
  /** свой потолок (смешанные); по умолчанию — эпохи */
  ceil?: number;
  /** своды-вкладыши по всей длине (имперские; смешанные с кирпичным сводом) */
  vault?: boolean;
  /** доп. теги вида куска ('препятствие') */
  extra?: string[];
  name?: string;
  /** обстановка; px — x западной стены хода (у пролома с запада — сдвиг) */
  dress?: (b: RoomBuilder, px: number) => void;
}

/** Прямой кусок хода 2.0 × len м (север — юг): проходы 'catacombs' во всю ширину, двери ниш по бокам. */
function straight(d: StraightDef): Room {
  const px = d.breach?.[0] === 'W' ? BREACH[0] : 0;
  const b = room(d.id, d.name ?? `${ERA_NAME[d.era]} ход, ${d.len} м`, meta([ERA_TAG[d.era], 'ход', ...(d.extra ?? [])], d.weight, d.note))
    .rect(px, 0, COR, d.len)
    .open('N', px, 'catacombs', 'Ход (север)')
    .open('S', px, 'catacombs', 'Ход (юг)');
  (d.doors ?? []).forEach(([side, at], k) => b.open(side, at, 'catacombs>refuge', `Ниша-убежище ${k + 1}`, side === 'W' ? px : px + COR));
  if (d.breach) breach(b, d.breach[0] === 'W' ? 0 : COR, d.breach[1]);
  if (d.vault ?? d.era === 'imp') vaults(b, 0, d.len, 'ns', px + COR / 2);
  d.dress?.(b, px);
  return ceil(b.build(), d.ceil ?? (d.era === 'imp' ? CEIL_IMP : CEIL_SOV));
}

const imperial = (): Room[] => [
  straight({
    id: 'cat_imp_1', era: 'imp', len: 1, weight: 0.25,
    note: 'Вставка имперского хода 2.0×1.0 м под кирпичным сводом: ею кольца ходов добирают длину до клетки.',
  }),
  straight({
    id: 'cat_imp_2', era: 'imp', len: 2, weight: 1,
    note: 'Имперский ход 2.0×2.0 м: кирпичный цилиндрический свод XIX века, плиты известняка, на стене — рейка уровня воды с годами наводнений.',
    dress: (b) => b.wall('p_cat_mark', 'W', 0.75),
  }),
  straight({
    id: 'cat_imp_4', era: 'imp', len: 4, weight: 1.6, doors: [['W', 1.55]],
    note: 'Имперский ход 2.0×4.0 м под сводом: старая чугунная труба по стене, слева — низкий проём в нишу-убежище (или заложенный кирпичом).',
    dress: (b) => {
      b.wall('p_cat_pipe_wall', 'E', 0.4).wall('p_cat_mark', 'E', 3.0);
      junk(b, 'j1', 0.2, 3.2, 30, 0.2);
    },
  }),
  straight({
    id: 'cat_imp_5', era: 'imp', len: 5, weight: 0.8, doors: [['E', 2.05]],
    note: 'Имперский ход 2.0×5.0 м под сводом: старая труба на опорах вдоль стены, рейка уровня воды, справа — проём в нишу-убежище.',
    dress: (b) => b.wall('p_cat_pipe_wall', 'W', 0.5).wall('p_cat_pipe_wall', 'W', 2.5).wall('p_cat_mark', 'E', 3.6),
  }),
  straight({
    id: 'cat_imp_6', era: 'imp', len: 6, weight: 1.8, doors: [['E', 2.55]],
    note: 'Имперский ход 2.0×6.0 м: свод во всю длину, трубы на опорах по западной стене, скобы-лестница, рейка уровня воды, справа — проём в нишу-убежище.',
    dress: (b) => {
      b.wall('p_cat_pipe_wall', 'W', 0.6).wall('p_cat_pipe_wall', 'W', 2.6).wall('p_cat_mark', 'W', 5.0).wall('p_cat_ladder', 'E', 0.8);
      junk(b, 'j1', 1.8, 4.8, 120, 0.2);
    },
  }),
  straight({
    id: 'cat_imp_8', era: 'imp', len: 8, weight: 1.4, doors: [['W', 1.2], ['E', 5.3]],
    note: 'Длинный имперский ход 2.0×8.0 м под сводом: проёмы в ниши-убежища по обе стороны вразбежку, трубы по стене, рейки уровня воды.',
    dress: (b) => {
      b.wall('p_cat_pipe_wall', 'E', 0.6).wall('p_cat_pipe_wall', 'E', 2.6).wall('p_cat_mark', 'W', 4.2).wall('p_cat_mark', 'E', 7.0);
      junk(b, 'j1', 0.2, 6.6, 75, 0.15);
      junk(b, 'j2', 1.8, 0.7, 200, 0.15);
    },
  }),
  straight({
    id: 'cat_imp_9', era: 'imp', len: 9, weight: 0.8, doors: [['W', 4.05]], name: 'Имперская галерея, 9 м',
    note: 'Самый длинный кусок — имперская галерея 2.0×9.0 м: свод во всю длину, скобы-лестница на стене, рейки уровня воды, посередине — проём в нишу.',
    dress: (b) => {
      b.wall('p_cat_ladder', 'E', 1.4).wall('p_cat_mark', 'E', 4.4).wall('p_cat_pipe_wall', 'W', 0.7).wall('p_cat_pipe_wall', 'W', 6.3);
      junk(b, 'j1', 1.8, 7.5, 160, 0.15);
    },
  }),
  straight({
    id: 'cat_imp_pipe', era: 'imp', len: 4, weight: 0.7, extra: ['препятствие'], name: 'Имперский ход с трубой поперёк',
    note: 'Имперский ход 2.0×4.0 м: поперёк хода низко лежит магистраль на опорах (ось 0.55 м) — через неё надо перелезть.',
    dress: (b) => b.put('p_cat_pipe_low', COR / 2, 2.0, 0).wall('p_cat_mark', 'W', 0.4),
  }),
];

const soviet = (): Room[] => [
  straight({
    id: 'cat_sov_1', era: 'sov', len: 1, weight: 0.25,
    note: 'Вставка советского хода 2.0×1.0 м: бетон, зелёная панель; ею кольца добирают длину до клетки.',
  }),
  straight({
    id: 'cat_sov_2', era: 'sov', len: 2, weight: 1,
    note: 'Советский ход 2.0×2.0 м: бетонные стены с зелёной масляной панелью, электрощит, разбитый плафон без лампы.',
    dress: (b) => b.wall('p_cat_box', 'W', 0.75).wall('p_cat_lamp_dead', 'E', 0.85),
  }),
  straight({
    id: 'cat_sov_3', era: 'sov', len: 3, weight: 0.8,
    note: 'Советский ход 2.0×3.0 м: кабельные лотки по стене, трафарет «ОТСЕК 4», разбитый плафон над головой.',
    dress: (b) => b.wall('p_cat_cables', 'W', 0.5).wall('p_cat_sign', 'E', 1.2).wall('p_cat_lamp_dead', 'E', 2.2),
  }),
  straight({
    id: 'cat_sov_4', era: 'sov', len: 4, weight: 1.6, doors: [['E', 1.55]],
    note: 'Советский ход 2.0×4.0 м: кабельные лотки по стене, электрощит, трафарет «ОТСЕК», разбитый плафон, справа — дверной проём в нишу-убежище.',
    dress: (b) => {
      b.wall('p_cat_cables', 'W', 0.6).wall('p_cat_box', 'W', 3.0).wall('p_cat_sign', 'E', 3.0).wall('p_cat_lamp_dead', 'E', 0.5);
      junk(b, 'j1', 1.8, 3.3, 60, 0.2);
    },
  }),
  straight({
    id: 'cat_sov_6', era: 'sov', len: 6, weight: 1.8, doors: [['W', 3.55]],
    note: 'Советский ход 2.0×6.0 м: кабели по восточной стене, труба и электрощит по западной, разбитый плафон, слева — проём в нишу-убежище.',
    dress: (b) => {
      b.wall('p_cat_cables', 'E', 0.6).wall('p_cat_cables', 'E', 2.6)
        .wall('p_cat_pipe_wall', 'W', 0.6).wall('p_cat_box', 'W', 5.0).wall('p_cat_lamp_dead', 'W', 2.9);
      junk(b, 'j1', 1.75, 5.4, 210, 0.2);
    },
  }),
  straight({
    id: 'cat_sov_8', era: 'sov', len: 8, weight: 1.4, doors: [['E', 5.0]],
    note: 'Длинный советский ход 2.0×8.0 м: на стене — закрытая гермодверь отсека, кабельные лотки, электрощит, трафарет «ГО», справа — проём в нишу.',
    dress: (b) => {
      b.wall('p_cat_hermo', 'W', 1.8).wall('p_cat_cables', 'E', 0.4).wall('p_cat_cables', 'E', 2.4)
        .wall('p_cat_sign', 'W', 4.6).wall('p_cat_box', 'W', 6.6).wall('p_cat_lamp_dead', 'E', 7.0);
      junk(b, 'j1', 0.25, 0.6, 90, 0.15);
      junk(b, 'j2', 1.75, 4.6, 300, 0.15);
    },
  }),
  straight({
    id: 'cat_sov_gate', era: 'sov', len: 6, weight: 0.6, name: 'Советский ход у затвора',
    note: 'Советский ход 2.0×6.0 м у старого затвора: на стене закрытый щитовой затвор водовода, трафарет, рейка уровня воды, кабели.',
    dress: (b) => {
      b.wall('p_cat_gate', 'E', 1.8).wall('p_cat_mark', 'W', 0.6).wall('p_cat_sign', 'W', 2.2).wall('p_cat_cables', 'W', 3.4);
      junk(b, 'j1', 1.8, 0.6, 15, 0.2);
    },
  }),
  straight({
    id: 'cat_sov_pipe_mid', era: 'sov', len: 4, weight: 0.7, extra: ['препятствие'], name: 'Советский ход с трубой на уровне пояса',
    note: 'Советский ход 2.0×4.0 м: поперёк хода труба на уровне пояса (ось 1.05 м) — перелезть или проползти под ней на четвереньках.',
    dress: (b) => b.put('p_cat_pipe_mid', COR / 2, 2.0, 0).wall('p_cat_box', 'W', 0.6).wall('p_cat_lamp_dead', 'E', 3.0).wall('p_cat_sign', 'E', 0.5),
  }),
  straight({
    id: 'cat_sov_pipe_high', era: 'sov', len: 4, weight: 0.7, extra: ['препятствие'], name: 'Советский ход с трубой над головой',
    note: 'Советский ход 2.0×4.0 м: поперёк хода труба на высоте груди (ось 1.65 м) — пройти под ней, пригнувшись; электрощит, плафон.',
    dress: (b) => b.put('p_cat_pipe_high', COR / 2, 2.0, 0).wall('p_cat_box', 'W', 2.8).wall('p_cat_lamp_dead', 'E', 0.6),
  }),
];

const mixed = (): Room[] => [
  straight({
    id: 'cat_mix_2', era: 'mix', len: 2, weight: 0.9, ceil: CEIL_IMP, vault: true,
    note: 'Смешанный ход 2.0×2.0 м: советская облицовка отвалилась — под ней кирпичный свод и старая кладка, на стене рейка уровня воды.',
    dress: (b) => b.wall('p_cat_mark', 'W', 0.75),
  }),
  straight({
    id: 'cat_mix_4', era: 'mix', len: 4, weight: 1.4, doors: [['W', 2.4]], breach: ['E', 0.9],
    note: 'Смешанный ход 2.0×4.0 м: бетон пятнами отвалился до кирпича, справа стена проломлена — в проломе завал кирпича и ' +
      'штукатурки; обрывки кабеля, слева — проём в нишу-убежище.',
    dress: (b) => {
      b.wall('p_cat_cables', 'W', 0.3);
      junk(b, 'j1', 0.25, 3.6, 250, 0.2);
    },
  }),
  straight({
    id: 'cat_mix_6', era: 'mix', len: 6, weight: 1.6, doors: [['E', 0.9]], breach: ['W', 1.2], ceil: CEIL_IMP, vault: true,
    note: 'Смешанный ход 2.0×6.0 м: под отвалившейся облицовкой — имперский свод; слева пролом с завалом штукатурки и кирпича, ' +
      'рейка уровня воды, труба, справа — проём в нишу.',
    dress: (b, px) => {
      b.wall('p_cat_mark', 'E', 4.6).wall('p_cat_pipe_wall', 'E', 2.3);
      junk(b, 'j1', px + 0.25, 5.3, 40, 0.2);
    },
  }),
  straight({
    id: 'cat_mix_8', era: 'mix', len: 8, weight: 1.2, doors: [['W', 1.0], ['E', 5.6]], breach: ['E', 1.0],
    note: 'Длинный смешанный ход 2.0×8.0 м: облицовка отваливается кусками, под ней кирпич; пролом с завалом у стены, остатки ' +
      'кабелей, проёмы в ниши по обе стороны.',
    dress: (b) => {
      b.wall('p_cat_cables', 'E', 3.5, { at: COR }).wall('p_cat_lamp_dead', 'W', 3.6);
      junk(b, 'j1', 1.75, 7.0, 130, 0.15);
      junk(b, 'j2', 0.25, 4.6, 20, 0.15);
    },
  }),
  straight({
    id: 'cat_mix_pipes', era: 'mix', len: 6, weight: 0.6, extra: ['препятствие'], name: 'Смешанный ход с двумя трубами',
    note: 'Смешанный ход 2.0×6.0 м: две трубы поперёк хода — сначала над головой (пригнуться), дальше низкая (перелезть); облицовка в ' +
      'пятнах, остатки кабелей.',
    dress: (b) => b.put('p_cat_pipe_high', COR / 2, 1.5, 0).put('p_cat_pipe_low', COR / 2, 4.5, 0).wall('p_cat_mark', 'W', 2.6).wall('p_cat_cables', 'E', 2.0),
  }),
];

// ─────────────────────────────── повороты, развилки ───────────────────────────────

/** Поворот хода 2×2 м: вход с юга, выход на восток (налево — та же комната другой стороной). */
function turn(era: Era, weight: number, note: string, dress: (b: RoomBuilder) => void): Room {
  const b = room(`cat_${era}_turn`, `${ERA_NAME[era]} поворот хода`, meta([ERA_TAG[era], 'ход', 'поворот'], weight, note))
    .rect(0, 0, COR, COR)
    .open('S', 0, 'catacombs', 'Ход (юг)')
    .open('E', 0, 'catacombs', 'Ход (восток)');
  dress(b);
  return ceil(b.build(), era === 'imp' ? CEIL_IMP : CEIL_SOV);
}

/** Тройник 2×4 м: ход север — юг (от x = px), с востока — боковой ход 2.0 м. */
function tee(era: Era, weight: number, note: string, dress: (b: RoomBuilder) => void, px = 0): Room {
  const b = room(`cat_${era}_T`, `${ERA_NAME[era]} тройник ходов`, meta([ERA_TAG[era], 'ход', 'развилка'], weight, note))
    .rect(px, 0, COR, 4)
    .open('N', px, 'catacombs', 'Ход (север)')
    .open('S', px, 'catacombs', 'Ход (юг)')
    .open('E', 1, 'catacombs', 'Боковой ход');
  dress(b);
  return ceil(b.build(), era === 'imp' ? CEIL_IMP : CEIL_SOV);
}

/** Крестовина 6×6 м: плечи 2 м во все стороны, посередине — площадка 2×2. */
function cross(era: Era, weight: number, note: string, dress: (b: RoomBuilder) => void): Room {
  const b = room(`cat_${era}_X`, `${ERA_NAME[era]} перекрёсток ходов`, meta([ERA_TAG[era], 'ход', 'развилка'], weight, note))
    .rect(2, 0, COR, 6)
    .rect(0, 2, 6, COR)
    .open('N', 2, 'catacombs', 'Ход (север)')
    .open('S', 2, 'catacombs', 'Ход (юг)')
    .open('W', 2, 'catacombs', 'Ход (запад)')
    .open('E', 2, 'catacombs', 'Ход (восток)');
  dress(b);
  return ceil(b.build(), era === 'imp' ? CEIL_IMP : CEIL_SOV);
}

const junctions = (): Room[] => [
  turn('imp', 0.7, 'Поворот имперского хода 2.0×2.0 м под прямым углом: кирпичные стены, плоский кирпичный потолок на 3.0 м, рейка уровня воды в торце.',
    (b) => b.wall('p_cat_mark', 'N', 0.75)),
  turn('sov', 0.7, 'Поворот советского хода 2.0×2.0 м: бетон, зелёная панель, в торце — электрощит и разбитый плафон.',
    (b) => b.wall('p_cat_box', 'N', 0.4).wall('p_cat_lamp_dead', 'W', 0.8)),
  turn('mix', 0.6, 'Поворот смешанного хода 2.0×2.0 м: облицовка в углу обвалилась до кирпича, рейка уровня воды, под ногами мусор.',
    (b) => {
      b.wall('p_cat_mark', 'N', 0.6);
      junk(b, 'j1', 0.3, 0.35, 45, 0.25);
    }),
  tee('imp', 0.7, 'Развилка имперских ходов 2.0×4.0 м: свод обрывается над боковым проходом 2.0 м, в торцах — кирпичные своды, рейка уровня воды.',
    (b) => vaults(b, 0, 1).put('p_cat_vault_1', COR / 2, 3.5, 0).wall('p_cat_mark', 'W', 1.75)),
  tee('sov', 0.7, 'Развилка советских ходов 2.0×4.0 м: боковой ход 2.0 м, напротив — кабели и трафарет со стрелкой, плафон.',
    (b) => b.wall('p_cat_cables', 'W', 1.0).wall('p_cat_sign', 'W', 0.4).wall('p_cat_lamp_dead', 'E', 3.3)),
  tee('mix', 0.6, 'Развилка смешанных ходов 2.0×4.0 м: напротив бокового хода стена проломлена — в проломе завал кирпича и штукатурки.',
    (b) => breach(b, 0, 0.9), BREACH[0]),
  cross('imp', 0.35, 'Перекрёсток имперских ходов 6.0×6.0 м: четыре плеча 2 м под сводами, посередине — плоский кирпичный потолок, рейка уровня воды.',
    (b) => {
      vaults(b, 0, 2, 'ns', 3).put('p_cat_vault_2', 3, 5, 0);
      vaults(b, 0, 2, 'ew', 3).put('p_cat_vault_2', 5, 3, 90);
      b.wall('p_cat_mark', 'N', 0.6, { at: 2 });
    }),
  cross('sov', 0.35, 'Перекрёсток советских ходов 6.0×6.0 м: четыре плеча, в углах — электрощит и разбитый плафон, мусор.',
    (b) => {
      b.wall('p_cat_box', 'N', 0.6, { at: 2 }).wall('p_cat_lamp_dead', 'S', 4.6, { at: 4 });
      junk(b, 'j1', 2.3, 2.25, 10, 0.2);
    }),
];

// ─────────────────────────────── лазы ───────────────────────────────

/** Прямой лаз 0.8 × len м: квадратный ход 0.8×0.8 (потолок 0.85) — только ползком. */
function duct(len: number, weight: number, note: string): Room {
  const r = room(`cat_duct_${len}`, `Лаз, ${len} м`, meta(['лаз', 'ход'], weight, note))
    .rect(0, 0, DUCT, len)
    .open('N', 0, 'cat_duct', 'Лаз (север)')
    .open('S', 0, 'cat_duct', 'Лаз (юг)')
    .build();
  return ceil(r, CEIL_DUCT);
}

const ducts = (): Room[] => [
  duct(1, 0.2, 'Вставка лаза 0.8×1.0 м: квадратный бетонный короб 0.8×0.8, на дне — ил; ею кольца лазов добирают длину.'),
  duct(2, 0.6, 'Лаз 0.8×2.0 м: квадратный короб 0.8×0.8 м, ползти на четвереньках по илу, сверху капает.'),
  duct(4, 1.0, 'Лаз 0.8×4.0 м: длинный квадратный короб 0.8×0.8 м — только ползком, в конце виден следующий ход или поворот.'),
  ceil(room('cat_duct_turn', 'Поворот лаза', meta(['лаз', 'ход', 'поворот'], 0.5,
    'Поворот лаза 0.8×0.8 м под прямым углом: короб 0.8×0.8 м, ползком; налево и направо — та же комната другой стороной.'))
    .rect(0, 0, DUCT, DUCT)
    .open('S', 0, 'cat_duct', 'Лаз (юг)')
    .open('E', 0, 'cat_duct', 'Лаз (восток)')
    .build(), CEIL_DUCT),
];

/** Устье лаза 2.0×2.0: с юга — ход 'catacombs' во всю ширину, в северном торце у пола — квадратная дыра лаза 0.8. */
function mouth(era: Era, weight: number, note: string, dress: (b: RoomBuilder) => void): Room {
  const b = room(`cat_${era}_mouth`, `${ERA_NAME[era]} ход с лазом`, meta([ERA_TAG[era], 'ход', 'устье'], weight, note))
    .rect(0, 0, COR, COR)
    .open('S', 0, 'catacombs', 'Ход (юг)')
    .open('N', (COR - DUCT) / 2, 'cat_duct', 'Лаз');
  dress(b);
  return ceil(b.build(), era === 'imp' ? CEIL_IMP : CEIL_SOV);
}

const mouths = (): Room[] => [
  mouth('imp', 0.6, 'Тупик имперского хода 2.0×2.0 м под сводом: в торцевой кладке у самого пола — квадратная дыра лаза 0.8×0.8 м, дальше только ползком.',
    (b) => vaults(b, 0, 2).wall('p_cat_mark', 'N', 0.05)),
  mouth('sov', 0.6, 'Тупик советского хода 2.0×2.0 м: в бетонной стене у пола — квадратный вентиляционный лаз 0.8×0.8 м, рядом трафарет и щит.',
    (b) => b.wall('p_cat_sign', 'N', 1.45).wall('p_cat_box', 'W', 0.6)),
];

// ─────────────────────────────── хабы ───────────────────────────────

/** Хаб 8.4×6.3 м: обзор внутри — по оси 8.4, по диагонали 6.3·√2 = 8.9 (предел «Прогулки» 9 м). */
const HUB_W = 8.4;
const HUB_H = 6.3;

/**
 * Насосная станция: северная полоса 2.4 м — машинная площадка на +2.1 (сухое место) с колоннами до свода и насосными
 * агрегатами, к ней марш 14 ступеней посередине зала; внизу, в приямке, — задвижка, пульт, кабельный барабан. Ходы —
 * запад, восток, юг (обход под маршем — полоса 1.1 м у южной стены); марш наверх — юг (закрытый выход сети).
 */
function hubPump(): Room {
  const b = room('cat_hub_pump', 'Насосная станция', meta(['станция', 'советский', 'хаб'], 1,
    'Хаб: насосная станция обслуживания 8.4×6.3 м — машинная площадка на +2.1 м над полом (выше пика наводнения) с ' +
    'колоннами до свода и двумя насосными агрегатами, марш к ней посередине зала; в приямке — задвижка на трубе, пульт, ' +
    'кабельный барабан. Три хода (запад, восток, юг) и марш наверх.'))
    .rect(0, 0, HUB_W, HUB_H)
    .open('W', 3.4, 'catacombs', 'Ход (запад)')
    .open('E', 3.4, 'catacombs', 'Ход (восток)')
    .open('S', 0.6, 'catacombs', 'Ход (юг)')
    .open('S', 6.0, 'stair', 'Марш наверх')
    // машинная площадка (+2.1): колонны до свода, насосы между ними; середина у верха марша свободна
    .put('p_cat_column_square', 0.6, 0.6)
    .put('p_cat_column_round', 4.2, 0.6)
    .put('p_cat_column_square', 7.8, 0.6)
    .put('p_cat_pump', 2.3, 1.2)
    .put('p_cat_pump', 6.1, 1.2)
    // приямок: задвижка вдоль площадки, пульт и барабан у восточного хода
    .put('p_cat_valve', 1.2, 2.75, 180)
    .put('p_cat_panel', 6.0, 2.7, 180)
    .put('p_cat_drum', 7.6, 2.9)
    .wall('p_cat_mark', 'W', 2.5)
    .wall('p_cat_sign', 'E', 2.6)
    .wall('p_cat_lamp_dead', 'S', 4.2);
  stash(b, 4.2, 1.6, 'На машинной площадке');
  junk(b, 'j1', 0.3, 5.9, 70, 0.3);
  const r = ceil(b.build(), CEIL_STATION);
  r.stair = straightStair({ w: HUB_W, l: 5.2, up: 'N', rise: DRY_Z, landing: 0, top: 2.4, flightW: 1.2, offset: 3.6 });
  return r;
}

/**
 * Колонный зал: западная полоса 2.4 м — галерея на +2.1 с кирпичными колоннами до свода, марш к ней поперёк зала;
 * ходы — север, восток, юг; марш наверх — север. На галерее следы тех, кто пережидал воду.
 */
function hubVault(): Room {
  const b = room('cat_hub_vault', 'Колонный зал', meta(['имперский', 'станция', 'хаб'], 1,
    'Хаб: имперский колонный зал станции 8.4×6.3 м — вдоль западной стены галерея на +2.1 м (сухое место) с кирпичными ' +
    'колоннами до свода, к ней марш поперёк зала; на галерее огарки и бутылки — здесь пережидали воду. На стенах — ' +
    'закрытый затвор водовода, задвижка, рейка уровня воды. Три хода (север, восток, юг) и марш наверх.'))
    .rect(0, 0, HUB_W, HUB_H)
    .open('N', 5.6, 'catacombs', 'Ход (север)')
    .open('E', 2.15, 'catacombs', 'Ход (восток)')
    .open('S', 5.6, 'catacombs', 'Ход (юг)')
    .open('N', 3.0, 'stair', 'Марш наверх')
    // галерея (+2.1): колонны до свода у стены, у верха марша свободно
    .put('p_cat_column_brick', 1.0, 0.8)
    .put('p_cat_column_damaged', 1.0, 3.15)
    .put('p_cat_column_brick', 1.0, 5.5)
    .put('p_cat_candles', 0.35, 2.0)
    .put('p_cat_bottles', 0.4, 4.3)
    // зал: затвор, задвижка, труба, рейка уровня воды
    .wall('p_cat_gate', 'S', 2.7)
    .wall('p_cat_valve', 'E', 0.1)
    .wall('p_cat_pipe_wall', 'E', 4.3)
    .wall('p_cat_mark', 'N', 4.4);
  stash(b, 1.9, 2.0, 'На галерее');
  junk(b, 'j1', 7.9, 5.9, 200, 0.3);
  const r = ceil(b.build(), CEIL_STATION);
  r.stair = straightStair({ w: HUB_H, l: 5.2, up: 'W', rise: DRY_Z, landing: 0, top: 2.4, flightW: 1.2, offset: 2.55 });
  return r;
}

/**
 * Зал-убежище: в северо-восточном углу — антресоль на стойках на +2.1 (лавка, матрас, огарки, бутылки, ящик), к ней марш
 * вдоль северной стены; четыре хода (запад, север, восток, юг) и марш наверх — юг.
 */
function hubRefuge(): Room {
  const b = room('cat_hub_refuge', 'Зал-убежище', meta(['убежище', 'советский', 'хаб'], 1.2,
    'Хаб: зал-убежище ГО 8.4×6.3 м — в углу антресоль на стальных стойках на +2.1 м (сухое место: лавка, грязный матрас, ' +
    'огарки свечей, бутылки, ящик), к ней марш вдоль северной стены. Внизу — закрытая гермодверь, трафарет «ГО», мусор. ' +
    'Четыре хода и марш наверх.'))
    .rect(0, 0, HUB_W, HUB_H)
    .open('W', 2.15, 'catacombs', 'Ход (запад)')
    .open('N', 0.2, 'catacombs', 'Ход (север)')
    .open('E', 3.6, 'catacombs', 'Ход (восток)')
    .open('S', 3.2, 'catacombs', 'Ход (юг)')
    .open('S', 0.8, 'stair', 'Марш наверх')
    // антресоль (+2.1): x 5.4…8.4, y 0…2.4 — у верха марша (x 5.4, y 0…1.2) свободно
    .put('p_cat_mattress', 7.95, 1.2, 90)
    .put('p_cat_bench', 6.8, 0.2)
    .put('p_cat_crate', 6.0, 2.0)
    .put('p_cat_candles', 6.9, 1.0)
    .put('p_cat_bottles', 7.0, 2.0)
    // стойки под краем антресоли
    .put('p_cat_post', 5.6, 2.5)
    .put('p_cat_post', 7.0, 2.5)
    .put('p_cat_post', 8.3, 2.5)
    // внизу: гермодверь, трафарет, плафон, рейка уровня воды
    .wall('p_cat_hermo', 'W', 4.6)
    .wall('p_cat_sign', 'S', 5.6)
    .wall('p_cat_lamp_dead', 'E', 5.8)
    .wall('p_cat_mark', 'W', 0.6);
  stash(b, 6.3, 0.9, 'На антресоли');
  junk(b, 'j1', 2.3, 5.95, 140, 0.6, JUNK_REFUGE);
  junk(b, 'j2', 7.6, 5.9, 20, 0.5, JUNK_REFUGE);
  junk(b, 'j3', 4.9, 1.9, 300, 0.4, JUNK_REFUGE);
  const r = ceil(b.build(), CEIL_REFUGE);
  r.stair = straightStair({ w: 2.4, l: 6.0, up: 'E', rise: DRY_Z, landing: 0, top: 3.0, flightW: 1.2, offset: 0, x: 2.4, y: 0 });
  return r;
}

// ─────────────────────────────── ниши-убежища ───────────────────────────────

/**
 * Ниша-убежище 2.0 × len м за боковой дверью хода (проём 'refuge>catacombs' 0.9 м в южной стене): в дальнем конце —
 * полати на +2.1 (pad м глубиной), к ним марш 14 ступеней вдоль восточной стены (flip — западной), проём — рядом с его
 * низом. На полатях — матрас или лавка, огарки, бутылки; внизу — ящик, заначка, мусор.
 */
function niche(id: string, name: string, len: number, pad: number, flip: boolean, weight: number, note: string, dress: (b: RoomBuilder, fx: (x: number) => number) => void): Room {
  const fx = (x: number) => (flip ? COR - x : x);
  const b = room(id, name, meta(['убежище'], weight, note))
    .rect(0, 0, COR, len)
    .open('S', flip ? COR - 0.1 - 0.9 : 0.1, 'refuge>catacombs', 'Проём в ход');
  dress(b, fx);
  const r = ceil(b.build(), CEIL_NICHE);
  r.stair = straightStair({ w: COR, l: len, up: 'N', rise: DRY_Z, landing: 0, top: pad, flightW: 1.0, offset: flip ? 0 : 1.0 });
  return r;
}

const niches = (): Room[] => [
  niche('cat_niche_a', 'Ниша-убежище с полатями', 4, 1.2, false, 1,
    'Ниша-убежище 2.0×4.0 м за проёмом хода: у дальней стены полати на +2.1 м (выше пика наводнения) — грязный матрас, ' +
    'огарки, бутылки; к ним крутая лестница вдоль стены; внизу — дощатый ящик.',
    (b, fx) => {
      b.put('p_cat_mattress', 1.0, 0.5).put('p_cat_candles', fx(0.2), 1.05).put('p_cat_bottles', fx(0.75), 1.05);
      b.put('p_cat_crate', fx(0.35), 1.55);
      stash(b, fx(0.35), 2.2, 'У ящика');
      junk(b, 'j1', fx(0.25), 3.2, 80, 0.5, JUNK_REFUGE);
    }),
  niche('cat_niche_b', 'Ниша-убежище с полатями (зеркальная)', 4, 1.2, true, 1,
    'Ниша-убежище 2.0×4.0 м за проёмом хода, лестница у другой стены: полати на +2.1 м с матрасом, огарками и банками, ' +
    'внизу — ящик, тряпьё.',
    (b, fx) => {
      b.put('p_cat_mattress', 1.0, 0.5).put('p_cat_candles', fx(0.25), 1.05).put('p_cat_can', fx(0.75), 1.05);
      b.put('p_cat_crate', fx(0.35), 1.55);
      stash(b, fx(0.4), 2.25, 'У ящика');
      junk(b, 'j1', fx(0.25), 3.3, 200, 0.6, JUNK_REFUGE);
    }),
  niche('cat_niche_c', 'Тесная ниша-убежище', 3.6, 1.0, false, 0.8,
    'Тесная ниша-убежище 2.0×3.6 м: узкие полати на +2.1 м — лавка, огарки, бутылки; крутая лестница вдоль стены, внизу — ' +
    'куча хлама.',
    (b, fx) => {
      b.put('p_cat_bench', 1.0, 0.3).put('p_cat_candles', fx(1.75), 0.75).put('p_cat_bottles', fx(0.35), 0.75);
      stash(b, fx(0.4), 1.4, 'На полу');
      junk(b, 'j1', fx(0.3), 2.7, 30, 0.7, JUNK_REFUGE);
    }),
];

/** Порядок важен для колец и бесконечных участков: их детали (ringKit, stream.ts) — первые по размеру куски сети, при
 *  равном размере — по порядку здесь. Вставки 1 м — советские (перемычка проёма 2.4 под потолком 2.6 — шов почти не
 *  виден), 2 м — смешанные, поворот — смешанный; длинные куски колец — имперские. */
export function buildCatacombRooms(): Room[] {
  const jn = junctions();
  const turnsFirst = [...jn.filter((r) => r.id === 'cat_mix_turn'), ...jn.filter((r) => r.id !== 'cat_mix_turn')];
  const [sov, mix] = [soviet(), mixed()];
  return [
    ...sov.filter((r) => r.id === 'cat_sov_1'), ...mix.filter((r) => r.id === 'cat_mix_2'),
    ...imperial(), ...sov.filter((r) => r.id !== 'cat_sov_1'), ...mix.filter((r) => r.id !== 'cat_mix_2'),
    ...turnsFirst,
    ...ducts(), ...mouths(),
    hubPump(), hubVault(), hubRefuge(),
    ...niches(),
  ];
}
