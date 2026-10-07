// Выбор генератора по режиму проекта: евклидов (generateRun) или складчатый 4D (generateFoldRun).
// Без зависимостей от стора — используется и в UI, и в симуляции спавна.
import { generateRun } from '../gen/generate';
import { generateFoldRun } from '../gen4d/fold';
import type { GeneratorSettings, Project, Run } from '../model/types';

export const isFoldMode = (p: Project, overrides?: Partial<GeneratorSettings>) =>
  (overrides?.mode ?? p.generator.mode) === 'fold';

/** Сгенерировать прогон генератором, выбранным в настройках (с учётом overrides.mode). */
export function generateByMode(p: Project, overrides?: Partial<GeneratorSettings>): Run {
  return isFoldMode(p, overrides) ? generateFoldRun(p, overrides) : generateRun(p, overrides);
}

/** Прогон построен складчатым генератором. */
export const isFoldRun = (run: Run | null | undefined): boolean => !!run && (run.settings.mode === 'fold' || !!run.fold);
