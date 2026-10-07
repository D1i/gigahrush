// Тексты для игрока поверх экспорта прогона: карточка тира при заходе в комнату, инвентарь, опасность.
// Строки правил тира — та же функция, что в редакторе (src/gen/rules.ts tierRuleLines): игрок видит то же,
// что геймдизайнер настроил во вкладке «Экономика».
import type { RunExport } from '../blockout/types';
import { tierRuleLines, type RuleTables } from '../gen/rules';
import type { LootStep, TierLootRow } from '../model/types';
import type { GameState } from './types';

/** Карточка тира при заходе в комнату. */
export interface TierCardInfo {
  tierId: string | null;
  /** «Элитность 3 — Зажиточная квартира»; без тира — «Обычная комната» */
  title: string;
  /** уровень элитности (0 — без тира) */
  level: number;
  color: string;
  /** прирост опасности за первый проход */
  danger: number;
  /** правило: «Проход: опасность +5», «Копейки: до 10 — 50%, иначе до 6 — 80% (в среднем 4.6)», … */
  lines: string[];
  /** заметка геймдизайнера к тиру (может быть пустой) */
  note: string;
}

export const NO_TIER_TITLE = 'Обычная комната';
const NO_TIER_COLOR = '#9aa0a6';

type AnyRec = Record<string, unknown>;
const isRec = (v: unknown): v is AnyRec => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Строки лута тира из экспорта (у неполных таблиц — например, без loot — пусто). */
function lootRows(t: AnyRec): TierLootRow[] {
  if (!Array.isArray(t.loot)) return [];
  const out: TierLootRow[] = [];
  for (const r of t.loot) {
    if (!isRec(r) || !isRec(r.source) || !Array.isArray(r.steps)) continue;
    const kind = r.source.kind === 'shop' ? 'shop' : r.source.kind === 'item' ? 'item' : null;
    if (!kind) continue;
    const steps: LootStep[] = r.steps.filter(isRec).map((s) => ({ upTo: num(s.upTo), chance: num(s.chance) }));
    out.push({ id: str(r.id), source: { kind, id: str(r.source.id) }, steps, where: str(r.where) });
  }
  return out;
}

/** Таблицы имён для правил: предметы и магазины экспорта. */
function tablesOf(run: RunExport): RuleTables {
  const shops = Array.isArray(run.shops) ? run.shops.filter(isRec).map((s) => ({ id: str(s.id), name: str(s.name, str(s.id)) })) : [];
  return { items: run.items ?? [], economy: { shops } };
}

/**
 * Карточка тира для HUD: заголовок, цвет, правило строками. tierId null или неизвестный — «Обычная комната».
 * Нужны полные тиры в экспорте (exportRunJSON кладёт их целиком, с loot) и shops; без них — только опасность.
 */
export function tierCardInfo(run: RunExport, tierId: string | null): TierCardInfo {
  const raw = tierId ? (run.tiers ?? []).find((t) => t.id === tierId) : undefined;
  if (!raw) {
    return { tierId: null, title: NO_TIER_TITLE, level: 0, color: NO_TIER_COLOR, danger: 0, lines: ['Проход: опасность не растёт'], note: '' };
  }
  const t = raw as unknown as AnyRec;
  const danger = num(t.danger);
  return {
    tierId: raw.id,
    title: str(t.name, raw.id),
    level: num(t.level),
    color: str(t.color, NO_TIER_COLOR),
    danger,
    lines: tierRuleLines(tablesOf(run), { danger, loot: lootRows(t) }),
    note: str(t.note),
  };
}

/** Карточка тира строками: заголовок, затем правило (опасность, лут). */
export function tierCard(run: RunExport, tierId: string | null): string[] {
  const c = tierCardInfo(run, tierId);
  return [c.title, ...c.lines];
}

/** Строка инвентаря. */
export interface InventoryRow {
  itemId: string;
  name: string;
  count: number;
  color: string;
  /** валюта (тег currency): копейки, компоненты, самогонка */
  currency: boolean;
  tags: string[];
}

type ItemTable = RunExport['items'];

/**
 * Инвентарь для HUD: сначала валюты (тег currency), потом товары — в порядке таблицы предметов;
 * предметы, которых нет в таблице, — в конце (имя = id). Нулевые количества не показываются.
 */
export function inventoryView(src: RunExport | ItemTable, state: Pick<GameState, 'inventory'>): InventoryRow[] {
  const items: ItemTable = Array.isArray(src) ? src : (src.items ?? []);
  const order = new Map(items.map((x, i) => [x.id, i] as const));
  const rows: (InventoryRow & { ord: number })[] = [];
  for (const [itemId, count] of Object.entries(state.inventory)) {
    if (!(count > 0)) continue;
    const it = items.find((x) => x.id === itemId);
    const tags = it?.tags ?? [];
    rows.push({
      itemId,
      name: it?.name ?? itemId,
      count,
      color: it?.color ?? '#888888',
      currency: tags.includes('currency'),
      tags: [...tags],
      ord: order.get(itemId) ?? Infinity,
    });
  }
  rows.sort((a, b) => Number(b.currency) - Number(a.currency) || a.ord - b.ord || (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));
  return rows.map(({ ord: _o, ...r }) => r);
}

/** Порог опасности из экспорта (exportRunJSON кладёт economy.dangerLimit); нет — fallback. */
export function dangerLimitOf(run: RunExport, fallback = 0): number {
  return num(run.dangerLimit, fallback);
}

const fmt = (x: number) => String(Number(x.toFixed(1)));

/** «Опасность 34 из 100», «Опасность 112 из 100 — уровень горит», без порога — «Опасность 34». */
export function dangerText(state: Pick<GameState, 'danger'>, limit: number): string {
  if (!(limit > 0)) return `Опасность ${fmt(state.danger)}`;
  const over = state.danger > limit;
  return `Опасность ${fmt(state.danger)} из ${fmt(limit)}${over ? ' — уровень горит' : ''}`;
}
