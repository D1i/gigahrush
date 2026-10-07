// Прогоны пресетов для тестов игровой логики: обычный, складчатый (4D) и бесконечный мир — в виде RunExport.
import { createDefaultProject } from '../data/presets';
import { generateRun } from '../gen/generate';
import { exportRunJSON } from '../gen/world';
import { generateFoldRun } from '../gen4d/fold';
import { createStreamWorld, streamSettings, type StreamWorld } from '../gen4d/stream';
import type { RunExport } from '../blockout/types';
import type { Project } from '../model/types';

export function presets(): Project {
  const p = createDefaultProject();
  p.finishes ??= [];
  p.finishRules ??= [];
  return p;
}

/** Мир прогулки, раскрытый на несколько дверей от старта. */
export function streamWorld(p: Project, seed: string, rounds = 2): StreamWorld {
  const w = createStreamWorld(p, streamSettings(seed, { sightM: 9 }));
  let ids = [w.startId!];
  for (let r = 0; r < rounds; r++) {
    const next: string[] = [];
    for (const id of ids) next.push(...w.ensureAround(id));
    ids = next.length ? next : ids;
  }
  return w;
}

/** Набор прогонов пресетов: евклидовы, складчатый и потоковый. */
export function presetRuns(p: Project): [string, RunExport][] {
  const out: [string, RunExport][] = [];
  for (const seed of ['hrush-001', 'game-a', 'game-b']) out.push([`euclid ${seed}`, exportRunJSON(p, generateRun(p, { seed, count: 40 })) as RunExport]);
  const fold = generateFoldRun(p, {
    seed: 'fold-b', count: 70, gap: 1, sightM: 9,
    fold: { shiftChance: 0.3, maxShift: 2, localRadius: 1, maxLayer: 12, seamless: false },
  });
  out.push(['fold fold-b', exportRunJSON(p, fold) as RunExport]);
  out.push(['stream game-s', exportRunJSON(p, streamWorld(p, 'game-s').run()) as RunExport]);
  return out;
}
