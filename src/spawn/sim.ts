// Симуляция N прогонов генератора порциями (не вешая UI) + кэш результата до изменения проекта.
import { useSyncExternalStore } from 'react';
import { generateByMode } from '../preview/genMode';
import { getProject, getVersion } from '../model/store';
import type { RunStop } from '../model/types';
import { aggStops, type StopAgg } from '../ui/StopDiagnosis';

export interface SimResult {
  /** версия проекта, на которой считали */
  version: number;
  runs: number;
  target: number;
  avgCount: number;
  avgDeadEnds: number;
  /** null — генератор не отдаёт run.sight */
  avgSight: number | null;
  maxSight: number | null;
  /** roomId → среднее число экземпляров на прогон */
  perRoom: Record<string, number>;
  /** roomId → в скольких прогонах min не выполнен */
  minFails: Record<string, number>;
  /** сколько прогонов с хотя бы одним невыполненным min */
  runsWithMinFail: number;
  /** причины недобора count по всем прогонам */
  stops: StopAgg;
  ms: number;
}

interface SimState {
  running: boolean;
  done: number;
  total: number;
  result: SimResult | null;
  error: string | null;
}

let state: SimState = { running: false, done: 0, total: 0, result: null, error: null };
let cancelFlag = false;
const listeners = new Set<() => void>();
const set = (patch: Partial<SimState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

export function useSim(): SimState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export function cancelSim() {
  cancelFlag = true;
}

/** Запустить N прогонов: сиды seed#0..seed#N-1, остальные настройки — текущие project.generator. */
export function runSim(n: number) {
  if (state.running) return;
  cancelFlag = false;
  const p = getProject();
  const version = getVersion();
  const seed = p.generator.seed;
  const t0 = performance.now();
  const counts: Record<string, number> = {};
  const minFails: Record<string, number> = {};
  let sumCount = 0;
  let sumDead = 0;
  let sumSight = 0;
  let sightN = 0;
  let maxSight = 0;
  let runsWithMinFail = 0;
  const stops: (RunStop | undefined)[] = [];
  const reached: number[] = [];
  let i = 0;
  set({ running: true, done: 0, total: n, error: null });

  const step = () => {
    if (cancelFlag) {
      set({ running: false });
      return;
    }
    const until = performance.now() + 30; // порция ~30 мс, затем отдаём управление браузеру
    try {
      while (i < n && performance.now() < until) {
        const run = generateByMode(p, { seed: `${seed}#${i}` });
        sumCount += run.instances.length;
        stops.push(run.instances.length < run.settings.count ? run.stop : undefined);
        reached.push(run.instances.length);
        sumDead += run.openConnectors.length;
        // в складчатом прогоне обзор не считается (слои накладываются) — не портим среднее нулями
        const sm = (run as { sight?: { maxM?: number } }).sight?.maxM;
        if (typeof sm === 'number' && Number.isFinite(sm)) {
          sumSight += sm;
          sightN++;
          if (sm > maxSight) maxSight = sm;
        }
        const per: Record<string, number> = {};
        for (const inst of run.instances) per[inst.roomId] = (per[inst.roomId] ?? 0) + 1;
        for (const [k, v] of Object.entries(per)) counts[k] = (counts[k] ?? 0) + v;
        let failed = false;
        for (const r of p.rooms) {
          if (r.cells.size === 0) continue;
          const effMax = r.unique ? 1 : Math.max(0, Math.floor(r.gen.max));
          const effMin = Math.min(Math.max(0, Math.floor(r.gen.min)), effMax);
          if ((per[r.id] ?? 0) < effMin) {
            minFails[r.id] = (minFails[r.id] ?? 0) + 1;
            failed = true;
          }
        }
        if (failed) runsWithMinFail++;
        i++;
      }
    } catch (e) {
      set({ running: false, error: String((e as Error)?.message ?? e) });
      return;
    }
    set({ done: i });
    if (i < n) {
      setTimeout(step, 0);
      return;
    }
    const perRoom: Record<string, number> = {};
    for (const [k, v] of Object.entries(counts)) perRoom[k] = v / n;
    set({
      running: false,
      result: {
        version,
        runs: n,
        target: p.generator.count,
        avgCount: sumCount / n,
        avgDeadEnds: sumDead / n,
        avgSight: sightN ? sumSight / sightN : null,
        maxSight: sightN ? maxSight : null,
        perRoom,
        minFails,
        runsWithMinFail,
        stops: aggStops(stops, reached, p.generator.count),
        ms: performance.now() - t0,
      },
    });
  };
  setTimeout(step, 0);
}
