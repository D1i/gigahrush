// Действия с прогоном, общие для страниц «Генератор» и «Данные».
import { exportRunJSON } from '../gen/world';
import { getProject, getVersion } from '../model/store';
import type { Run } from '../model/types';
import { getUI, notify, setUI } from '../model/ui';
import { copyText, downloadText, safeName } from './util';
import { generateByMode } from './genMode';

/** Версия проекта, с которой построен текущий прогон (для пометки «устарел»). */
let runVersion = -1;
export const getRunVersion = () => runVersion;

/** Сгенерировать по текущим настройкам проекта (евклидов или складчатый — по generator.mode) и положить в ui.run. */
export function generateNow(opts: { quiet?: boolean } = {}): Run | null {
  const p = getProject();
  try {
    const run = generateByMode(p);
    runVersion = getVersion();
    const keep = getUI().runInst;
    setUI({ run, runInst: keep && run.instances.some((i) => i.id === keep) ? keep : null });
    if (!opts.quiet && run.warnings.length) notify(`Прогон «${run.seed}»: предупреждений — ${run.warnings.length}`, 'warn');
    return run;
  } catch (e: any) {
    console.error(e);
    notify('Генерация не удалась: ' + String(e?.message ?? e), 'error');
    return null;
  }
}

export function runJSONText(run: Run): string {
  return JSON.stringify(exportRunJSON(getProject(), run), null, 2);
}

export function downloadRun(run: Run) {
  try {
    downloadText(`run-${safeName(run.seed)}.json`, runJSONText(run));
  } catch (e: any) {
    notify('Экспорт прогона не удался: ' + String(e?.message ?? e), 'error');
  }
}

export function copyRun(run: Run) {
  try {
    copyText(runJSONText(run), 'JSON прогона');
  } catch (e: any) {
    notify('Экспорт прогона не удался: ' + String(e?.message ?? e), 'error');
  }
}
