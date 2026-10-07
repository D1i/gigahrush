// Калибровка веса «Ржавого лифта» (npm run test:perf -- src/gen4d/stream.lift.perf.test.ts): бот случайно бродит
// по миру «Прогулки» (настройки пресетов, ensureAround + ensureVisible на каждом шаге) и считает шаги до момента,
// когда лифт — сосед текущей комнаты по двери. LIFT_W='0.5,0.8,1.2' — свои веса; SEEDS=30 — сколько миров.
import { it } from 'vitest';
import { createDefaultProject } from '../data/presets';
import { makeRng } from '../model/rng';
import type { Project, Run } from '../model/types';
import { createStreamWorld, DEFAULT_STREAM, streamSettings, viewHorizonM } from './stream';

const env = ((globalThis as any).process?.env ?? {}) as Record<string, string | undefined>;
/** бот идёт столько шагов (дальше — «не встретился»), считая и все лифты-соседи по пути — плотность */
const MAX_STEPS = 200;

const doorNeighbors = (run: Run, id: string): string[] => {
  const out: string[] = [];
  for (const l of run.links) {
    if (l.kind === 'descent' || l.kind === 'lift') continue;
    if (l.a.inst === id) out.push(l.b.inst);
    if (l.b.inst === id) out.push(l.a.inst);
  }
  return out;
};

/** Шагов до первого лифта-соседа (MAX_STEPS + 1 — не встретился); сколько разных соседей по дверям бот повидал за
 *  MAX_STEPS шагов и сколько из них — лифты. */
function stepsToLift(p: Project, seed: string): { steps: number; doors: number; lifts: number } {
  const g = p.generator;
  const w = createStreamWorld(p, streamSettings(seed, {
    gap: g.gap, match: g.match, sightM: g.sightM > 0 ? g.sightM : DEFAULT_STREAM.sightM, startRoomId: g.startRoomId,
  }));
  const R = makeRng(`bot|${seed}`);
  let cur = w.startId!;
  const seen = new Set([cur]);
  const near = new Set<string>();
  let steps = MAX_STEPS + 1;
  for (let k = 0; k <= MAX_STEPS; k++) {
    w.ensureAround(cur);
    w.ensureVisible(cur, viewHorizonM(w.settings.sightM));
    const run = w.run();
    const nb = doorNeighbors(run, cur).sort();
    for (const x of nb) near.add(x);
    if (steps > MAX_STEPS && nb.some((x) => run.instances[+x.slice(1)].roomId === 'lift_rusty')) steps = k;
    if (nb.length === 0) break;
    const fresh = nb.filter((x) => !seen.has(x));
    const pool = fresh.length && R.next() < 0.8 ? fresh : nb;
    cur = pool[R.int(0, pool.length - 1)];
    seen.add(cur);
  }
  const run = w.run();
  const lifts = [...near].filter((x) => run.instances[+x.slice(1)].roomId === 'lift_rusty').length;
  return { steps, doors: near.size, lifts };
}

it('калибровка веса лифта', { timeout: 3_600_000 }, () => {
  const weights = (env.LIFT_W ?? '').split(',').map(Number).filter((x) => x > 0);
  const base = createDefaultProject();
  const preset = base.rooms.find((r) => r.id === 'lift_rusty')!.gen.weight;
  const n = Number(env.SEEDS) > 0 ? Number(env.SEEDS) : 30;
  for (const wt of weights.length ? weights : [preset]) {
    const p = createDefaultProject();
    p.finishes ??= [];
    p.finishRules ??= [];
    p.rooms.find((r) => r.id === 'lift_rusty')!.gen.weight = wt;
    const res = Array.from({ length: n }, (_, i) => stepsToLift(p, `lift-cal-${i}`));
    const st = res.map((r) => r.steps).sort((a, b) => a - b);
    const q = (f: number) => st[Math.min(st.length - 1, Math.floor(f * st.length))];
    const miss = st.filter((x) => x > MAX_STEPS).length;
    const doors = res.reduce((a, r) => a + r.doors, 0), lifts = res.reduce((a, r) => a + r.lifts, 0);
    console.log(`LIFT вес ${wt}: шагов до лифта — медиана ${q(0.5)}, четверти ${q(0.25)}…${q(0.75)}, мин ${st[0]}, ` +
      `не встретился за ${MAX_STEPS} — ${miss}/${n}; лифтов среди соседей пути ${lifts} на ${doors} (1 на ${(doors / Math.max(1, lifts)).toFixed(0)})`);
  }
});
