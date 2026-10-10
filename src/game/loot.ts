// Лут комнат «Прогулки» (контракт tmp/loot-wip/CONTRACT.md): ЧТО лежит в комнате — чистая функция сида мира, адреса
// экземпляра, биома, элитности и размера комнаты (rollRoomLoot); ГДЕ лежит (мировые координаты, как у WorldDrop) —
// src/gen4d/streamLoot.ts (lootOf).
//
//  • Случайный лут — по таблицам редкости каталога src/data/itemsLoot.ts: в биоме — предметы зоны 'any' и зоны биома
//    (ZONE_BIOMES: khrush, подвалы); 'unique' и зона 'obshaga' случайно не выпадают никогда (керосинка — со своих
//    спотов). Сначала класс редкости по весу RarityInfo.weight × (1 + 0.5·tier)^rank, затем предмет класса (поровну
//    или по LootEntry.weight). Сколько — по площади пола: квартиры ~0.6–1.2 на комнату, ходы сетей (подвал, сарай,
//    общага…) ~0.3–0.6; элитность tier добавляет ~0.4·tier. Штук в точке — LootDef.drop, керосин — q 0.5…1.
//  • Заявленное комнатой (строки лута Room.loot / тира, предметы на спотах) — только id из LOOT_DEFS (у прочих пока нет
//    модели и поведения), кроме 'unique'.
//  • Точки расширения для других сессий (регистрировать при загрузке модуля — одинаково у всех игроков кооп-лобби):
//    registerLootRoom(биом, хук) — хук комнаты: своя элитность и обязательные предметы (кладутся первыми);
//    registerLootEntry(биом, запись) — свои предметы в случайной таблице биома (их может не быть в LOOT_DEFS).
// ГСЧ — от сида мира и АДРЕСА экземпляра (не от id: в бесконечном мире id зависят от порядка обхода), независимые потоки
// на хук, заявленное и случайное — добавленный хук не сдвигает случайный лут.
import type { RunExport } from '../blockout/types';
import { LOOT_DEFS, RARITIES, ZONE_BIOMES, lootDef, rarityInfo, type LootRarity } from '../data/itemsLoot';
import { hashSeed, makeRng, type Rng } from '../model/rng';

/** Элитность комнаты для лута: 0 — обычная … 4 — самая богатая. */
export type LootTier = 0 | 1 | 2 | 3 | 4;

/** Предмет, разыгранный для комнаты. */
export interface LootRoll {
  item: string;
  /** штук (нет — 1) */
  n?: number;
  /** заряд/топливо 0…1 (керосин — остаток канистры); нет — 1 */
  q?: number;
  /** откуда: force — хук комнаты (registerLootRoom), room — заявлено комнатой, random — случайная таблица */
  src: 'force' | 'room' | 'random';
  /** где лежит заявленное: ITEM_SPOT + id спота — на своём споте, иначе id мебели строки тира с where (RunInstance.loot
   *  decorId: id декора или 'spot:<id>' — prop на споте); нет — свободное место (спот для предметов или пол) */
  at?: string;
}

/** Что знает хук о комнате. */
export interface LootRoomInfo {
  /** id экземпляра (зависит от порядка обхода — для ключей; ГСЧ — от addr/seed) */
  inst: string;
  /** адрес экземпляра (StreamWorld.addressOf) */
  addr: string;
  /** биом ('' — вне квартир) */
  biome: string;
  /** сид комнаты для ГСЧ хука (от сида мира и адреса) */
  seed: number;
  /** вид куска сети ходов (tunnelKind: hub / straight / turn / branch / storage); нет — не кусок хода */
  kind?: string;
  roomId?: string;
  tags?: readonly string[];
  /** JSON прогона, в котором комната (WalkSession.rx); null — вызов без мира (тесты rollRoomLoot). Хук обязан быть
   *  детерминированным: зависеть только от того, что одинаково у всех копий мира (адрес, порядок экземпляров…) */
  rx: RunExport | null;
}

export interface LootRoomResult {
  /** элитность вместо элитности экземпляра */
  tier?: LootTier;
  /** обязательные предметы — кладутся первыми (любые id, не только из LOOT_DEFS) */
  force?: { item: string; n?: number }[];
}

export type LootRoomHook = (r: LootRoomInfo) => LootRoomResult | null;

/** Запись случайной таблицы биома (registerLootEntry): предмет может быть не из LOOT_DEFS. */
export interface LootEntry {
  item: string;
  rarity: LootRarity;
  /** штук в точке [от, до] (нет — 1) */
  drop?: [number, number];
  /** вес внутри класса редкости (нет — 1) */
  weight?: number;
}

/** Плотность: ожидаемое число случайных предметов = clamp(base + perM2·площадь, min, max) + tierAdd·tier. */
export const LOOT_DENSITY = {
  apt: { base: 0.3, perM2: 0.045, min: 0.4, max: 1.5 },
  tunnels: { base: 0.2, perM2: 0.012, min: 0.25, max: 0.6 },
  tierAdd: 0.4,
  /** случайных предметов в комнате — не больше */
  max: 6,
} as const;

/** LootRoll.at предмета, выпавшего на спот комнаты: ITEM_SPOT + id спота (не путать с decorId 'spot:<id>' — мебель на
 *  споте). */
export const ITEM_SPOT = 'item@';

/** Предел строк (id предмета) — как у WorldDrop. */
const STR = 64;
/** Предел штук в точке. */
const N_MAX = 999;

// ───────────────────────── реестр (другие сессии) ─────────────────────────

const roomHooks = new Map<string, LootRoomHook[]>();
const extraEntries = new Map<string, LootEntry[]>();
const tableCache = new Map<string, LootClass[]>();

/** Хук комнат биома: своя элитность и обязательные предметы. Возвращает «снять регистрацию». */
export function registerLootRoom(biome: string, hook: LootRoomHook): () => void {
  const list = roomHooks.get(biome) ?? [];
  list.push(hook);
  roomHooks.set(biome, list);
  return () => {
    const l = roomHooks.get(biome);
    const i = l ? l.indexOf(hook) : -1;
    if (i >= 0) l!.splice(i, 1);
  };
}

/** Свой предмет в случайной таблице биома (с редкостью каталога). Возвращает «снять регистрацию». */
export function registerLootEntry(biome: string, e: LootEntry): () => void {
  const entry: LootEntry = { ...e, ...(e.drop ? { drop: [e.drop[0], e.drop[1]] as [number, number] } : {}) };
  const list = extraEntries.get(biome) ?? [];
  list.push(entry);
  extraEntries.set(biome, list);
  tableCache.delete(biome);
  return () => {
    const l = extraEntries.get(biome);
    const i = l ? l.indexOf(entry) : -1;
    if (i >= 0) l!.splice(i, 1);
    tableCache.delete(biome);
  };
}

// ───────────────────────── таблицы редкости ─────────────────────────

/** Класс редкости случайной таблицы биома. */
export interface LootClass {
  rarity: LootRarity;
  rank: number;
  /** вес класса без элитности (RarityInfo.weight) */
  weight: number;
  items: readonly LootEntry[];
}

/** Случайная таблица биома (null / '' — вне квартир: только зона 'any'): непустые классы с весом > 0 по рангу. */
export function lootTable(biome: string | null): readonly LootClass[] {
  const b = biome ?? '';
  const hit = tableCache.get(b);
  if (hit) return hit;
  const by = new Map<LootRarity, LootEntry[]>();
  const add = (e: LootEntry) => {
    if (rarityInfo(e.rarity)?.weight > 0) by.set(e.rarity, [...(by.get(e.rarity) ?? []), e]);
  };
  for (const d of LOOT_DEFS) {
    if (d.zone === 'obshaga') continue;
    if (d.zone !== 'any' && !ZONE_BIOMES[d.zone].includes(b)) continue;
    add({ item: d.id, rarity: d.rarity, ...(d.drop ? { drop: d.drop } : {}) });
  }
  for (const e of extraEntries.get(b) ?? []) if (typeof e.item === 'string' && e.item && e.item.length <= STR) add(e);
  const out: LootClass[] = RARITIES.filter((r) => by.has(r.id)).map((r) => ({ rarity: r.id, rank: r.rank, weight: r.weight, items: by.get(r.id)! }));
  tableCache.set(b, out);
  return out;
}

/** Вес класса с элитностью tier: weight × (1 + 0.5·tier)^rank. */
export function classWeight(c: Pick<LootClass, 'weight' | 'rank'>, tier: number): number {
  return c.weight * Math.pow(1 + 0.5 * tier, c.rank);
}

/** Ожидаемое число случайных предметов в комнате площадью areaM2 (ходы сетей — реже). */
export function lootExpect(areaM2: number, tunnels: boolean, tier: number): number {
  const d = tunnels ? LOOT_DENSITY.tunnels : LOOT_DENSITY.apt;
  const a = Number.isFinite(areaM2) && areaM2 > 0 ? areaM2 : 0;
  return Math.min(d.max, Math.max(d.min, d.base + d.perM2 * a)) + LOOT_DENSITY.tierAdd * normTier(tier);
}

const normTier = (t: unknown): LootTier => (typeof t === 'number' && Number.isFinite(t) ? (Math.max(0, Math.min(4, Math.round(t))) as LootTier) : 0);
const r2 = (v: number) => Math.round(v * 100) / 100;
const clampN = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(1, Math.min(N_MAX, Math.round(v))) : 1);

/** Штук в точке по диапазону drop (нет — 1), не больше стека. */
function rollN(rng: Rng, drop: readonly [number, number] | undefined, stack: number): number {
  if (!drop) return 1;
  const lo = Math.max(1, Math.floor(Math.min(drop[0], drop[1]))), hi = Math.max(lo, Math.floor(Math.max(drop[0], drop[1])));
  return Math.min(Math.max(1, stack), rng.int(lo, hi));
}

/** Готовая запись: n только если > 1; керосин — остаток q 0.5…1. */
function roll(item: string, n: number, rng: Rng, src: LootRoll['src'], at?: string): LootRoll {
  const def = lootDef(item);
  return {
    item,
    ...(n > 1 ? { n } : {}),
    ...(def?.kind === 'fuel' ? { q: r2(0.5 + 0.5 * rng.next()) } : {}),
    src,
    ...(at ? { at } : {}),
  };
}

// ───────────────────────── розыгрыш комнаты ─────────────────────────

export interface LootRoomSpec {
  /** строка сида мира (seedKey(seed, mods) из src/gen4d/stream.ts) */
  seed: string;
  inst: string;
  /** адрес экземпляра — от него ГСЧ */
  addr: string;
  /** биом (id, null — вне квартир) */
  biome: string | null;
  /** элитность экземпляра 0…4 (хук может заменить) */
  tier?: number;
  /** площадь пола, м² */
  areaM2: number;
  /** кусок сети ходов (подвал, сарай, общага…) — лута меньше */
  tunnels?: boolean;
  kind?: string;
  roomId?: string;
  tags?: readonly string[];
  /** заявлено комнатой: строки лута (count, at — decorId) и предметы на спотах (at ITEM_SPOT + id, count 1); в итог —
   *  только LOOT_DEFS */
  declared?: readonly { item: string; count: number; at?: string }[];
  /** JSON прогона для хука (LootRoomInfo.rx) */
  rx?: RunExport | null;
}

/** Сид хука комнаты (LootRoomInfo.seed). */
export function lootRoomSeed(seed: string, addr: string): number {
  return hashSeed(`${seed}#lootroom:${addr}`);
}

/**
 * Что лежит в комнате: сначала обязательное хуков биома (force), затем заявленное комнатой (только id из LOOT_DEFS,
 * не 'unique'), затем случайное по таблице биома. Детерминировано: те же входы (и те же хуки/записи) — тот же список.
 */
export function rollRoomLoot(r: LootRoomSpec): LootRoll[] {
  const biome = r.biome ?? '';
  const root = makeRng(`${r.seed}#loot:${r.addr}`);
  let tier = normTier(r.tier);
  const out: LootRoll[] = [];

  // 1. хуки биома: элитность и обязательные предметы
  const hooks = roomHooks.get(biome);
  if (hooks?.length) {
    const info: LootRoomInfo = {
      inst: r.inst, addr: r.addr, biome, seed: lootRoomSeed(r.seed, r.addr),
      ...(r.kind ? { kind: r.kind } : {}),
      ...(r.roomId ? { roomId: r.roomId } : {}),
      ...(r.tags ? { tags: r.tags } : {}),
      rx: r.rx ?? null,
    };
    const fr = root.sub('force');
    for (const h of hooks.slice()) {
      let res: LootRoomResult | null = null;
      try {
        res = h(info);
      } catch (e) {
        console.error(e);
      }
      if (!res) continue;
      if (res.tier !== undefined && typeof res.tier === 'number' && Number.isFinite(res.tier)) tier = normTier(res.tier);
      for (const f of Array.isArray(res.force) ? res.force : []) {
        if (!f || typeof f.item !== 'string' || !f.item || f.item.length > STR) continue;
        // предмет каталога — не больше его стека
        out.push(roll(f.item, Math.min(lootDef(f.item)?.stack ?? N_MAX, clampN(f.n ?? 1)), fr, 'force'));
      }
    }
  }

  // 2. заявленное комнатой: валюта — count штук; складываемое — count раз по drop (не больше стека); штучное — до 3 точек.
  // одно и то же в одном месте (копейки нескольких ступеней строки тира, несколько строк спичек) — одной кучкой
  const dr = root.sub('room');
  const merged = new Map<string, { item: string; count: number; at?: string }>();
  for (const d of r.declared ?? []) {
    if (!d || typeof d.item !== 'string' || !lootDef(d.item)) continue;
    const key = `${d.item}\n${d.at ?? ''}`;
    const m = merged.get(key);
    if (m) m.count += clampN(d.count);
    else merged.set(key, { item: d.item, count: clampN(d.count), ...(d.at ? { at: d.at } : {}) });
  }
  for (const d of merged.values()) {
    const def = lootDef(d.item);
    if (!def || def.rarity === 'unique') continue;
    const count = clampN(d.count);
    if (def.kind === 'currency') out.push(roll(def.id, Math.min(def.stack, count), dr, 'room', d.at));
    else if (def.stack > 1) {
      let n = 0;
      for (let i = 0; i < count && n < def.stack; i++) n += rollN(dr, def.drop, def.stack);
      out.push(roll(def.id, Math.min(def.stack, n), dr, 'room', d.at));
    } else for (let i = 0; i < Math.min(3, count); i++) out.push(roll(def.id, 1, dr, 'room', d.at));
  }

  // 3. случайное: сколько — по площади и элитности, класс редкости по весу с элитностью, предмет класса
  const table = lootTable(biome);
  if (table.length) {
    const cr = root.sub('count'), pr = root.sub('pick');
    const e = lootExpect(r.areaM2, r.tunnels === true, tier);
    const k = Math.min(LOOT_DENSITY.max, Math.floor(e) + (cr.next() < e - Math.floor(e) ? 1 : 0));
    const cw = table.map((c) => classWeight(c, tier));
    for (let i = 0; i < k; i++) {
      const ci = pr.weightedIndex(cw);
      if (ci < 0) break;
      const items = table[ci].items;
      const ii = pr.weightedIndex(items.map((x) => (typeof x.weight === 'number' && x.weight >= 0 ? x.weight : 1)));
      if (ii < 0) continue;
      const it = items[ii];
      out.push(roll(it.item, rollN(pr, it.drop, lootDef(it.item)?.stack ?? N_MAX), pr, 'random'));
    }
  }
  return out;
}
