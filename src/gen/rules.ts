// Человекочитаемые правила экономики — чтобы правило было понятно игроку («не типо мб 10 мб 25»).
// Контракт зафиксирован оркестратором; реализацию пишет агент генератора.
import type { LootStep, Project, Tier } from '../model/types';

/** "до 6 — 50%, иначе до 4 — 70%" */
export function stepsText(steps: LootStep[]): string {
  throw new Error('TODO(gen) stepsText');
}

/** Строки правил тира: опасность, лут по строкам, готовые предметы. */
export function tierRuleLines(p: Project, tier: Tier): string[] {
  throw new Error('TODO(gen) tierRuleLines');
}

/** Точная вероятность хоть какой-то находки по ступеням и матожидание количества. */
export function stepsStats(steps: LootStep[]): { pAny: number; mean: number } {
  throw new Error('TODO(gen) stepsStats');
}
