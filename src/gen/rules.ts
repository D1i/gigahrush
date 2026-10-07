// Человекочитаемые правила экономики — чтобы правило было понятно игроку («не типо мб 10 мб 25»).
// Правило ступеней (то же, что в генераторе): ступени проверяются от большего «до N» к меньшему,
// первая сработавшая даёт случайное количество от 1 до N; не сработала ни одна — ничего.
import type { Item, LootStep, Shop, Tier } from '../model/types';
import { sortedSteps } from './generate';

const clamp01 = (p: number) => (p > 1 ? 1 : p > 0 ? p : 0);

/** "70", "5", "2.5", "0.25" — проценты без лишних нулей. */
export function fmtPct(p: number): string {
  return String(Number((clamp01(p) * 100).toFixed(2)));
}

/** Ступени, которые реально проверяются: по убыванию upTo, после гарантированной (100%) — обрыв. */
function effective(steps: LootStep[]): LootStep[] {
  const out: LootStep[] = [];
  for (const s of sortedSteps(steps)) {
    if (clamp01(s.chance) <= 0) continue;
    out.push(s);
    if (clamp01(s.chance) >= 1) break;
  }
  return out;
}

/** "до 6 — 50%, иначе до 4 — 70%"; одна ступень «до 1» — просто "5%". */
export function stepsText(steps: LootStep[]): string {
  const eff = effective(steps);
  if (eff.length === 0) return 'не выпадает';
  if (eff.length === 1 && eff[0].upTo === 1) return `${fmtPct(eff[0].chance)}%`;
  return eff
    .map((s) => `${s.upTo === 1 ? '1 шт.' : `до ${s.upTo}`} — ${fmtPct(s.chance)}%`)
    .join(', иначе ');
}

/** Точная вероятность хоть какой-то находки по ступеням и матожидание количества. */
export function stepsStats(steps: LootStep[]): { pAny: number; mean: number } {
  let miss = 1;
  let mean = 0;
  for (const s of sortedSteps(steps)) {
    const p = clamp01(s.chance);
    mean += miss * p * (1 + s.upTo) / 2;
    miss *= 1 - p;
  }
  return { pAny: 1 - miss, mean };
}

const fmtNum = (x: number) => String(Number(x.toFixed(1)));

/** Что правилам нужно от проекта — имена предметов и магазинов. Подходит Project и таблицы экспорта прогона. */
export interface RuleTables {
  items: readonly Pick<Item, 'id' | 'name'>[];
  economy: { shops: readonly Pick<Shop, 'id' | 'name'>[] };
}

/** Строки правил тира: опасность, лут по строкам, готовые предметы. */
export function tierRuleLines(p: RuleTables, tier: Pick<Tier, 'danger' | 'loot'>): string[] {
  const lines: string[] = [];
  if (tier.danger > 0) lines.push(`Проход: опасность +${fmtNum(tier.danger)}`);
  else if (tier.danger < 0) lines.push(`Проход: опасность −${fmtNum(-tier.danger)}`);
  else lines.push('Проход: опасность не растёт');

  for (const row of tier.loot) {
    const eff = effective(row.steps);
    if (eff.length === 0) continue;
    const place = row.where ? ` в «${row.where}»` : '';
    let head: string;
    if (row.source.kind === 'shop') {
      const shopId = row.source.id;
      const shop = p.economy.shops.find((s) => s.id === shopId);
      head = `Готовый предмет из «${shop ? shop.name : shopId}»${place}`;
    } else {
      const itemId = row.source.id;
      const item = p.items.find((i) => i.id === itemId);
      head = `${item ? item.name : itemId}${place}`;
    }
    const many = eff.some((s) => s.upTo > 1);
    const tail = many ? ` (в среднем ${fmtNum(stepsStats(row.steps).mean)})` : '';
    lines.push(`${head}: ${stepsText(row.steps)}${tail}`);
  }
  return lines;
}
