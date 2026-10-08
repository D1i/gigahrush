// Биомы и настройки бесконечного мира (4D, «Прогулка»): квартиры (кластеры комнат), двери-выходы, переходы, сеть
// ходов подвала. Механика — src/gen4d/stream.ts (режим квартир), правила — docs/GENERATOR-4D.md §16–17.
//
// Биом — набор комнат по тегам: вес комнаты в биоме = вес роста × наибольший множитель среди её тегов
// (тега нет в списке — 0). Пресеты — по группам комнат (первый тег): хрущёвки (подъезд и квартиры), малосемейки
// (коридорный дом, гостинки), общежитие, «богатая квартира» (куда ведут переходы, с усилением элитности) и три
// подвала — сеть ходов (layout 'tunnels') с одними комнатами и разной отделкой: сухой, заброшенный, затопленный.
import type { Biome, FinishRule, Room, TunnelSettings, WorldSettings } from '../model/types';

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
const T = (id: string, name: string, color: string, rules: FinishRule[], note: string): Biome => {
  const { note: n, ...rest } = B(id, name, color, TUNNEL_TAGS, note);
  // порядок полей — как у normBiome (сохранение → загрузка без изменений)
  return { ...rest, layout: 'tunnels', finishRules: rules, note: n };
};

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
};

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
  tunnels: DEFAULT_TUNNELS,
};

const cloneTunnels = (t: TunnelSettings): TunnelSettings => ({
  ...t,
  hubEvery: [t.hubEvery[0], t.hubEvery[1]],
  ringLen: [t.ringLen[0], t.ringLen[1]],
  loopLen: [t.loopLen[0], t.loopLen[1]],
});
const cloneRule = (r: FinishRule): FinishRule => ({ tag: r.tag, wall: r.wall.map((x) => ({ ...x })), floor: r.floor.map((x) => ({ ...x })) });
export const cloneBiome = (b: Biome): Biome => ({
  ...b,
  tags: b.tags.map((t) => ({ ...t })),
  ...(b.finishRules ? { finishRules: b.finishRules.map(cloneRule) } : {}),
});

export function newWorldSettings(): WorldSettings {
  return {
    ...DEFAULT_WORLD,
    clusterRooms: [...DEFAULT_WORLD.clusterRooms],
    clusterExits: [...DEFAULT_WORLD.clusterExits],
    biomes: defaultBiomes(),
    tunnels: cloneTunnels(DEFAULT_TUNNELS),
  };
}

export function cloneWorld(w: WorldSettings): WorldSettings {
  return {
    ...w,
    clusterRooms: [w.clusterRooms[0], w.clusterRooms[1]],
    clusterExits: [w.clusterExits[0], w.clusterExits[1]],
    biomes: w.biomes.map(cloneBiome),
    tunnels: cloneTunnels(w.tunnels),
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
  return {
    id: o.id,
    name: typeof o.name === 'string' && o.name ? o.name : o.id,
    color: typeof o.color === 'string' && /^#[0-9a-f]{6}$/i.test(o.color) ? o.color : '#9a9a9a',
    tags,
    ...(o.rich === true ? { rich: true as const } : {}),
    ...(o.layout === 'tunnels' ? { layout: 'tunnels' as const } : {}),
    ...(finishRules && finishRules.length ? { finishRules } : {}),
    note: typeof o.note === 'string' ? o.note : '',
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
    tunnels: normTunnels(o.tunnels),
  };
}

/** Множитель веса комнаты в биоме: наибольший среди её тегов (0 — комната в биоме не растёт). */
export function biomeMul(b: Biome, room: Room): number {
  let m = 0;
  for (const t of b.tags) if (room.tags.includes(t.tag) && t.mul > m) m = t.mul;
  return m;
}

/** Обычные (не «богатые») биомы — квартирные и подвалы. */
export function plainBiomes(w: WorldSettings): Biome[] {
  return w.biomes.filter((b) => !b.rich);
}

/** Биом растёт сетью ходов (подвал). */
export const isTunnels = (b: Biome | null | undefined): boolean => b?.layout === 'tunnels';

/** Подвалы мира (биомы с сетью ходов). */
export function tunnelBiomes(w: WorldSettings): Biome[] {
  return w.biomes.filter((b) => isTunnels(b) && !b.rich);
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
    `переход ведёт в другой биом (${pct(w.trToBiome)}) или в богатую квартиру.` +
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
