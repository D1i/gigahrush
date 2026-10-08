// Биомы и настройки бесконечного мира (4D, «Прогулка»): квартиры (кластеры комнат), двери-выходы, переходы.
// Механика — src/gen4d/stream.ts (режим квартир), правила — docs/GENERATOR-4D.md §16.
//
// Биом — набор комнат по тегам: вес комнаты в биоме = вес роста × наибольший множитель среди её тегов
// (тега нет в списке — 0). Пресеты — по группам комнат (первый тег): хрущёвки (подъезд и квартиры), малосемейки
// (коридорный дом, гостинки), общежитие, подвал и «богатая квартира» (куда ведут переходы, с усилением элитности).
import type { Biome, Room, WorldSettings } from '../model/types';

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

/** Биомы по умолчанию (свежие объекты при каждом вызове). */
export function defaultBiomes(): Biome[] {
  return [
    B('khrush', 'Хрущёвки', '#c8a25a', [
      ['лестница', 1], ['лифт', 0.4], ['коридор', 0.3], ['прихожая', 1], ['кухня', 1], ['санузел', 1], ['жилая', 1],
      ['балкон', 1], ['кладовка', 1], ['служебное', 0.2],
    ], 'Подъезды пятиэтажек 1-464, 1-335, 1-447: площадки, марши, квартиры.'),
    B('malosem', 'Малосемейки', '#7fa7c9', [
      ['коридор', 2], ['лестница', 0.4], ['лифт', 1], ['прихожая', 0.8], ['кухня', 0.5], ['санузел', 0.8], ['жилая', 0.7],
      ['кладовка', 0.5], ['служебное', 1],
    ], 'Коридорные дома: длинные поэтажные коридоры, гостинки, служебные комнаты.'),
    B('dorm', 'Общежитие', '#9bbf6a', [
      ['общежитие', 3], ['коридор', 0.5], ['лестница', 0.3], ['служебное', 1], ['санузел', 0.2],
    ], 'Общежитие коридорного типа: вестибюль, коридоры, комнаты на двоих-троих, общие кухни и умывальные.'),
    B('basement', 'Подвал', '#8a7f74', [
      ['подвал', 3], ['кладовка', 1], ['служебное', 0.6], ['лестница', 0.2],
    ], 'Подвалы и технические этажи: ходы, клетушки, тепловые узлы.'),
    B('rich', 'Богатая квартира', '#d06a4e', [
      ['прихожая', 1], ['кухня', 1], ['санузел', 1], ['жилая', 1.5], ['балкон', 1], ['кладовка', 1], ['коридор', 0.2],
    ], 'Сюда ведут переходы: квартира с усиленной элитностью (richBoost), выходы — в обычные квартиры биома, откуда пришли.', true),
  ];
}

export const DEFAULT_WORLD: WorldSettings = {
  clusterRooms: [6, 15],
  clusterExits: [2, 10],
  trAfter: 50,
  trBase: 0.1,
  trStep: 0.01,
  trToBiome: 0.7,
  richBoost: 8,
  biomes: [],
  startBiome: 'khrush',
};

export function newWorldSettings(): WorldSettings {
  return { ...DEFAULT_WORLD, clusterRooms: [...DEFAULT_WORLD.clusterRooms], clusterExits: [...DEFAULT_WORLD.clusterExits], biomes: defaultBiomes() };
}

export function cloneWorld(w: WorldSettings): WorldSettings {
  return {
    ...w,
    clusterRooms: [w.clusterRooms[0], w.clusterRooms[1]],
    clusterExits: [w.clusterExits[0], w.clusterExits[1]],
    biomes: w.biomes.map((b) => ({ ...b, tags: b.tags.map((t) => ({ ...t })) })),
  };
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
  return {
    id: o.id,
    name: typeof o.name === 'string' && o.name ? o.name : o.id,
    color: typeof o.color === 'string' && /^#[0-9a-f]{6}$/i.test(o.color) ? o.color : '#9a9a9a',
    tags,
    ...(o.rich === true ? { rich: true as const } : {}),
    note: typeof o.note === 'string' ? o.note : '',
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
  return {
    clusterRooms: range(o.clusterRooms, D.clusterRooms, 1, CLUSTER_MAX),
    clusterExits: range(o.clusterExits, D.clusterExits, EXITS_LIM[0], EXITS_LIM[1]),
    trAfter: fin(o.trAfter) ? clampN(Math.round(o.trAfter), 0, 100000) : D.trAfter,
    trBase: fin(o.trBase) ? clampN(o.trBase, 0, 1) : D.trBase,
    trStep: fin(o.trStep) ? clampN(o.trStep, 0, 1) : D.trStep,
    trToBiome: fin(o.trToBiome) ? clampN(o.trToBiome, 0, 1) : D.trToBiome,
    richBoost: fin(o.richBoost) ? clampN(o.richBoost, 1, 1000) : D.richBoost,
    biomes,
    startBiome: start && biomes.some((b) => b.id === start) ? start : null,
  };
}

/** Множитель веса комнаты в биоме: наибольший среди её тегов (0 — комната в биоме не растёт). */
export function biomeMul(b: Biome, room: Room): number {
  let m = 0;
  for (const t of b.tags) if (room.tags.includes(t.tag) && t.mul > m) m = t.mul;
  return m;
}

/** Обычные (не «богатые») биомы. */
export function plainBiomes(w: WorldSettings): Biome[] {
  return w.biomes.filter((b) => !b.rich);
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
    `переход ведёт в другой биом (${pct(w.trToBiome)}) или в богатую квартиру.`;
}
