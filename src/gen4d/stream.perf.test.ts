import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '../data/presets';
import { makeRng } from '../model/rng';
import type { Run } from '../model/types';
import { createStreamWorld, streamSettings, type StreamStats, type StreamWorld } from './stream';

// Замеры скорости бесконечного мира — отдельным файлом (свой воркер, без влияния тяжёлых проверок).

function adjOf(run: Run): Map<string, string[]> {
  const adj = new Map<string, string[]>(run.instances.map((i) => [i.id, []]));
  for (const l of run.links) { adj.get(l.a.inst)!.push(l.b.inst); adj.get(l.b.inst)!.push(l.a.inst); }
  return adj;
}

/**
 * Игрок-исследователь: выбирает случайную нераскрытую комнату и идёт к ней кратчайшим путём; в каждой комнате
 * по пути — ensureAround (и при visible — ensureVisible). Самый жёсткий режим для бесконечности: съедает фронт
 * роста. Возвращает число шагов; бросает, если идти некуда.
 */
function explore(w: StreamWorld, until: number, seed: string, from: string, visible = false): { steps: number; cur: string } {
  const R = makeRng(seed);
  let cur = from;
  let n = w.run().instances.length + w.ensureAround(cur).length;
  let path: string[] = [];
  let steps = 0;
  while (n < until) {
    if (!path.length) {
      const run = w.run();
      const cand = run.instances.filter((i) => !w.isExpanded(i.id)).map((i) => i.id);
      if (!cand.length) throw new Error(`некуда идти: мир кончился на ${n} комнатах`);
      const target = cand[R.int(0, cand.length - 1)];
      const adj = adjOf(run);
      const prev = new Map<string, string>([[cur, '']]);
      const q = [cur];
      for (let h = 0; h < q.length && !prev.has(target); h++) for (const y of adj.get(q[h])!) if (!prev.has(y)) { prev.set(y, q[h]); q.push(y); }
      const p: string[] = [];
      for (let x = target; x !== cur; x = prev.get(x)!) p.push(x);
      path = p.reverse();
    }
    cur = path.shift()!;
    n += w.ensureAround(cur).length;
    if (visible) n += w.ensureVisible(cur).length;
    steps++;
  }
  return { steps, cur };
}

const row = (steps: number, st: StreamStats) => {
  const res = st.grown + st.loops + st.deadChance + st.deadFail;
  return `шагов ${steps}, комнат ${st.instances}, слоёв ${st.layers}, пар в одном месте 3D ${st.overlaps}, ` +
    `тупиков ${(100 * (st.deadChance + st.deadFail) / res).toFixed(1)}%, раскрытие мс: ср ${st.expandMsAvg.toFixed(2)} / p95 ${st.expandMsP95.toFixed(2)} / макс ${st.expandMsMax.toFixed(2)}`;
};

describe('бесконечный мир: скорость', { timeout: 600000 }, () => {
  const p = createDefaultProject();

  it('раскрытие экземпляра на мире 1000–3000 комнат — быстрее 20 мс; мир не кончается', () => {
    const lines: string[] = [];
    for (const [seed, visible] of [['perf-1', false], ['perf-2', false], ['perf-3', true]] as const) {
      const w = createStreamWorld(p, streamSettings(seed));
      const a = explore(w, 1000, `${seed}-a`, w.startId!, visible);
      const s1 = w.stats();
      lines.push(`${seed}${visible ? ' (+ensureVisible)' : ''} 1000: ${row(a.steps, s1)}`);
      expect(s1.expandMsAvg).toBeLessThan(20);
      expect(s1.expandMsP95).toBeLessThan(20);
      const b = explore(w, 3000, `${seed}-b`, a.cur, visible);
      const s2 = w.stats();
      lines.push(`${seed}${visible ? ' (+ensureVisible)' : ''} 3000: ${row(a.steps + b.steps, s2)}`);
      expect(s2.expandMsAvg).toBeLessThan(20);
      expect(s2.expandMsP95).toBeLessThan(20);
      expect(s2.pendingGrow).toBeGreaterThan(0);
      // сохранение и загрузка большого мира
      const t0 = performance.now();
      const json = JSON.stringify(w.save());
      const t1 = performance.now();
      const back = createStreamWorld(p, w.settings, JSON.parse(json));
      const t2 = performance.now();
      expect(back.stale).toBe(false);
      expect(back.run().instances.length).toBe(s2.instances);
      lines.push(`${seed} сохранение ${(json.length / 1024).toFixed(0)} КБ: save ${(t1 - t0).toFixed(0)} мс, загрузка ${(t2 - t1).toFixed(0)} мс`);
    }
    // случайное блуждание (как ходит живой игрок)
    const w = createStreamWorld(p, streamSettings('perf-walk'));
    const R = makeRng('walk');
    let cur = w.startId!;
    w.ensureAround(cur);
    for (let k = 0; k < 2000; k++) {
      const nb: string[] = [];
      for (const l of w.run().links) { if (l.a.inst === cur) nb.push(l.b.inst); if (l.b.inst === cur) nb.push(l.a.inst); }
      cur = nb.sort()[R.int(0, nb.length - 1)];
      w.ensureAround(cur);
    }
    lines.push(`случайное блуждание: ${row(2000, w.stats())}`);
    console.log(`[stream perf]\n  ${lines.join('\n  ')}`);
  });
});
