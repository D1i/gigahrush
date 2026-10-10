// Лут «советский быт» (набор заказчика soviet_loot_lowpoly, 2026-10-09): каталог предметов Прогулки — редкость, где
// попадается, стек, цена у торговца. Поведение (свет, еда, сумки) — src/game/itemUse.ts, эффекты — src/game/effects.ts,
// раскладка по комнатам — src/game/loot.ts. Строки Item для общего списка — buildLootItems() (src/data/items.ts берёт
// из него только новые id; у старых id — it_kopeyki, it_matches, it_batteries, it_flashlight, it_kerolamp — строки
// остаются в items.ts, здесь у них только лутовые поля).
import type { Item } from '../model/types';

/** Редкость по возрастанию: Базовый < Редкий < Очень редкий < Дефицитный < Крайне дефицитный < Уникальный. */
export type LootRarity = 'base' | 'rare' | 'vrare' | 'deficit' | 'xdeficit' | 'unique';

export interface RarityInfo {
  id: LootRarity;
  /** ранг 0…5 — для сдвига редкости элитными комнатами */
  rank: number;
  name: string;
  /** цвет рамки значка и подписи */
  color: string;
  /** вес случайного выпадения (unique — 0: только со своих спотов) */
  weight: number;
}

export const RARITIES: readonly RarityInfo[] = [
  { id: 'base', rank: 0, name: 'Базовый', color: '#b8b2a2', weight: 100 },
  { id: 'rare', rank: 1, name: 'Редкий', color: '#7fb069', weight: 28 },
  { id: 'vrare', rank: 2, name: 'Очень редкий', color: '#5fa8d3', weight: 9 },
  { id: 'deficit', rank: 3, name: 'Дефицитный', color: '#b388eb', weight: 3.5 },
  { id: 'xdeficit', rank: 4, name: 'Крайне дефицитный', color: '#f0a04b', weight: 1 },
  { id: 'unique', rank: 5, name: 'Уникальный', color: '#e85d5d', weight: 0 },
];

const RARITY_BY_ID = new Map(RARITIES.map((r) => [r.id, r]));
export function rarityInfo(r: LootRarity): RarityInfo {
  return RARITY_BY_ID.get(r)!;
}

/** Где попадается: any — везде; khrush — Хрущёвка; obshaga — только со спотов общаги; basement — подвалы. */
export type LootZone = 'any' | 'khrush' | 'obshaga' | 'basement';

/** Биомы зоны (id из src/gen4d/biomes.ts). any — пустой список: подходит любой биом. */
export const ZONE_BIOMES: Record<LootZone, readonly string[]> = {
  any: [],
  khrush: ['khrush'],
  obshaga: ['obshaga'],
  basement: ['basement', 'basement_blue', 'basement_wet'],
};

/** Род предмета — как им пользоваться (src/game/itemUse.ts). */
export type LootKind =
  | 'currency' // копейка, радиолампа
  | 'trade' // только продать: наклейка
  | 'cards' // дурак с напарником — лечит
  | 'fuel' // керосин
  | 'wick' // шпонная верёвка
  | 'match' // спички, охотничьи спички
  | 'bag' // рюкзак, портфель, мешок
  | 'food' // хлеб, закрутка, пузырь, юзграм
  | 'light' // П-2, жучок, зиппа, керосинка
  | 'battery' // батарейка D
  | 'part'; // удлинение тубуса, лампочка

export interface LootDef {
  id: string;
  name: string;
  rarity: LootRarity;
  zone: LootZone;
  kind: LootKind;
  /** предел стека в одной ячейке (1 — не складывается) */
  stack: number;
  /** цена у торговца в копейках; null — продать нельзя */
  price: number | null;
  /** цвет предмета (значок-заглушка, общий список) */
  color: string;
  /** теги общего списка предметов */
  tags: string[];
  note: string;
  /** сколько штук кладётся в точку лута [от, до] (по умолчанию 1) */
  drop?: [number, number];
  /** вместимость сумки (kind 'bag') */
  bagSlots?: number;
  /** множитель скорости, пока сумка надета */
  bagSpeed?: number;
}

export const LOOT_DEFS: readonly LootDef[] = [
  // ── Общий лут ──
  {
    id: 'it_kopeyki', name: 'Копейка', rarity: 'base', zone: 'any', kind: 'currency', stack: 999, price: 1,
    color: '#d4a017', tags: ['currency', 'деньги'], drop: [1, 12],
    note: 'Платёжная валюта.',
  },
  {
    id: 'it_radiolamp', name: 'Радиолампа 6П3С', rarity: 'vrare', zone: 'any', kind: 'currency', stack: 10, price: 150,
    color: '#7a8b8f', tags: ['валюта', 'электроника', 'радиолампа'],
    note: 'Спасает от некоторых существ и открывает некоторые комнаты. Очень ценная валюта.',
  },
  {
    id: 'it_cards', name: 'Пачка карт', rarity: 'rare', zone: 'any', kind: 'cards', stack: 1, price: 40,
    color: '#a52a2a', tags: ['карты', 'на продажу'],
    note: 'Партия в дурака с напарником восстанавливает здоровье обоим. Можно продать торговцу.',
  },
  {
    id: 'it_wick', name: 'Шпонная верёвка', rarity: 'rare', zone: 'any', kind: 'wick', stack: 5, price: 15,
    color: '#b08a5a', tags: ['расходник', 'фитиль'], drop: [1, 3],
    note: 'Фитиль для заправки зиппы и керосинки.',
  },
  {
    id: 'it_kerosene', name: 'Керосин 1 л', rarity: 'rare', zone: 'any', kind: 'fuel', stack: 1, price: 30,
    color: '#5b6b3a', tags: ['топливо'],
    note: 'Топливо для зиппы и керосинки. Канистры хватает на четыре заправки.',
  },
  {
    id: 'it_sticker', name: 'Наклейка «Космос-1980»', rarity: 'rare', zone: 'any', kind: 'trade', stack: 20, price: 25,
    color: '#2f4f6f', tags: ['на продажу'],
    note: 'Только для продажи.',
  },
  {
    id: 'it_matches', name: 'Спички', rarity: 'rare', zone: 'any', kind: 'match', stack: 40, price: 5,
    color: '#e4572e', tags: ['свет', 'расходник'], drop: [3, 10],
    note: 'Спичка светит 6 секунд, и то плохо. Гаснет на бегу и в воде.',
  },
  {
    id: 'it_hunt_matches', name: 'Охотничьи спички', rarity: 'vrare', zone: 'any', kind: 'match', stack: 20, price: 40,
    color: '#6b7a3a', tags: ['свет', 'расходник'], drop: [2, 6],
    note: 'Горят 15 секунд, не гаснут ни от воды, ни на бегу. Свет ужасно слабый. Торговцы их ценят.',
  },
  {
    id: 'it_backpack', name: 'Походный рюкзак', rarity: 'deficit', zone: 'any', kind: 'bag', stack: 1, price: 120,
    color: '#5f6b3c', tags: ['сумка'], bagSlots: 10,
    note: 'Надевается на спину: 10 ячеек не быстрого доступа (Tab).',
  },
  {
    id: 'it_briefcase', name: 'Портфель', rarity: 'vrare', zone: 'any', kind: 'bag', stack: 1, price: 60,
    color: '#5a2e1c', tags: ['сумка'], bagSlots: 5,
    note: '5 ячеек не быстрого доступа (Tab).',
  },
  {
    id: 'it_sack', name: 'Мешок', rarity: 'rare', zone: 'any', kind: 'bag', stack: 1, price: 10,
    color: '#7d7f55', tags: ['сумка'], bagSlots: 3, bagSpeed: 0.85,
    note: '3 ячейки не быстрого доступа (Tab). Тяжёлый: с ним идёшь на 15% медленнее.',
  },
  {
    id: 'it_bread', name: 'Хлеб', rarity: 'rare', zone: 'any', kind: 'food', stack: 1, price: 20,
    color: '#8b4513', tags: ['еда'],
    note: 'Восстанавливает здоровье и полностью — стамину.',
  },
  // ── Хрущёвка ──
  {
    id: 'it_flashlight', name: 'Фонарик П-2', rarity: 'xdeficit', zone: 'khrush', kind: 'light', stack: 1, price: 300,
    color: '#ffd166', tags: ['свет', 'электроника'],
    note:
      'Хороший свет. Нужны батарейки D (R — заменить): чем они слабее, тем тусклее. ' +
      'Лампочка накаливания перегорает каждые 15 минут света — нужна запасная.',
  },
  {
    id: 'it_tube_ext', name: 'Удлинение тубуса', rarity: 'deficit', zone: 'khrush', kind: 'part', stack: 1, price: 80,
    color: '#4f5d3a', tags: ['улучшение'],
    note: 'Улучшение П-2: ещё одна батарейка в тубусе — +5 минут света. Держи П-2 в руке и используй (ЛКМ).',
  },
  {
    id: 'it_bulb', name: 'Лампочка МН 2,5 В', rarity: 'rare', zone: 'khrush', kind: 'part', stack: 5, price: 15,
    color: '#e8e2c8', tags: ['запчасть', 'электроника'],
    note: 'Запасная лампочка для П-2: вкручивается взамен перегоревшей (R).',
  },
  {
    id: 'it_bug_flash', name: 'Фонарик «Жучок»', rarity: 'deficit', zone: 'khrush', kind: 'light', stack: 1, price: 90,
    color: '#9aa0a0', tags: ['свет'],
    note:
      'Динамо: каждое нажатие F — 2 секунды света, чем чаще жмёшь — тем ярче и тем больше уходит стамины. ' +
      'Очень шумный. Лампочка перегорает за 15 минут и не меняется.',
  },
  {
    id: 'it_batteries', name: 'Батарейка D «Элемент 373»', rarity: 'rare', zone: 'khrush', kind: 'battery', stack: 6,
    price: 10, color: '#8d99ae', tags: ['товар', 'электроника'], drop: [1, 2],
    note: 'Питание электрических приборов: П-2 берёт две (с удлинением тубуса — три).',
  },
  {
    id: 'it_zippo', name: 'Зиппа «ЗИЛЛ»', rarity: 'deficit', zone: 'khrush', kind: 'light', stack: 1, price: 70,
    color: '#a8a8a0', tags: ['свет'],
    note:
      'Плохой свет. Нужны шпонная верёвка и керосин (R — заправить). На ходу тускнеет, на бегу гаснет. ' +
      'В тоннелях из-за неё обвалы вдвое чаще.',
  },
  // ── Общежитие ──
  {
    id: 'it_kerolamp', name: 'Керосинка', rarity: 'unique', zone: 'obshaga', kind: 'light', stack: 1, price: null,
    color: '#e39b3a', tags: ['свет', 'находка'],
    note: 'Питается шпонной верёвкой и керосином (R — заправить). Пока горит, рука общаги не подходит ближе метра. Продать нельзя.',
  },
  // ── Подвал ──
  {
    id: 'it_preserves', name: 'Закрутка', rarity: 'vrare', zone: 'basement', kind: 'food', stack: 1, price: 50,
    color: '#2e6b3a', tags: ['еда'],
    note: 'Банка огурцов: здоровье и стамина, а потом 2 минуты бегаешь быстрее.',
  },
  {
    id: 'it_bubble', name: 'Пузырь', rarity: 'deficit', zone: 'basement', kind: 'food', stack: 1, price: 80,
    color: '#2f6b3f', tags: ['алкоголь'],
    note:
      'Здоровье, стамина и минута двойной скорости. Но ты — избранная цель тварей, и вокруг чаще случается плохое. ' +
      'Второй пузырь подряд валит с ног на 15 секунд — охаешь на всю карту.',
  },
  {
    id: 'it_yuzgram', name: 'Юзграм', rarity: 'xdeficit', zone: 'basement', kind: 'food', stack: 1, price: 200,
    color: '#8a4b1c', tags: ['аптека'],
    note: 'Теряешь сознание на 10 секунд — и всё это время неуязвим.',
  },
];

const DEF_BY_ID = new Map(LOOT_DEFS.map((d) => [d.id, d]));

/** Лутовая запись предмета или null (предмет не из набора). */
export function lootDef(id: string): LootDef | null {
  return DEF_BY_ID.get(id) ?? null;
}

/** Предел стека: из каталога, иначе 1. */
export function stackOf(id: string): number {
  return DEF_BY_ID.get(id)?.stack ?? 1;
}

/** id, у которых строки Item уже есть в src/data/items.ts (имя/заметку там правим вручную). */
export const LEGACY_IDS: ReadonlySet<string> = new Set([
  'it_kopeyki',
  'it_matches',
  'it_batteries',
  'it_flashlight',
  'it_kerolamp',
]);

/** Строки общего списка предметов для НОВЫХ id набора (старые — в items.ts). */
export function buildLootItems(): Item[] {
  return LOOT_DEFS.filter((d) => !LEGACY_IDS.has(d.id)).map((d) => ({
    id: d.id,
    name: d.name,
    color: d.color,
    tags: [...d.tags, 'лут'],
    note: d.note,
  }));
}
