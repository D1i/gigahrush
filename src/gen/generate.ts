// Генератор раскладки и розыгрыш наполнения (ТЗ: прогон, экземпляр; экономика — элитность).
// Контракт зафиксирован оркестратором; реализацию пишет агент генератора.
import type { GeneratorSettings, Project, Run } from '../model/types';

/** Сгенерировать прогон. Детерминирован по (проект, settings.seed). Не мутирует проект. */
export function generateRun(p: Project, overrides?: Partial<GeneratorSettings>): Run {
  throw new Error('TODO(gen) generateRun');
}
