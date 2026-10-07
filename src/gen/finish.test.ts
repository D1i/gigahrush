import { describe, expect, it } from 'vitest';
import { makeRng } from '../model/rng';
import type { Finish, Project } from '../model/types';
import { generateRun, rollFinish } from './generate';
import { contentProject, hrushLike, ok } from './fixtures.test-util';
import { exportRunJSON } from './world';

const fin = (id: string, surface: Finish['surface'], extra: Partial<Finish> = {}): Finish => ({
  id, name: id, surface, color: '#888', tex: null, tileW: 0.5, tileH: 0.5, dado: null, tags: [], ...extra,
});

/** Отделки и правила поверх проекта: «жилая» — обои 1:3 и пол 1:1, «старт» — кафель. */
function withFinishes(p: Project): Project {
  p.finishes = [
    fin('wpA', 'wall', { tex: 'data:image/jpeg;base64,AAAA' }), fin('wpB', 'wall'), fin('tile', 'wall'),
    fin('two', 'wall', { dado: { finishId: 'tile', heightM: 1.5 } }), fin('lino', 'floor'), fin('parq', 'floor'),
  ];
  p.finishRules = [
    { tag: 'start', wall: [{ finishId: 'two', weight: 1 }], floor: [{ finishId: 'lino', weight: 1 }] },
    { tag: 'жилая', wall: [{ finishId: 'wpA', weight: 1 }, { finishId: 'wpB', weight: 3 }], floor: [{ finishId: 'lino', weight: 1 }, { finishId: 'parq', weight: 1 }] },
  ];
  for (const r of p.rooms) if (!r.tags.includes('start')) r.tags = ['жилая', ...r.tags];
  return p;
}

const noFinish = <T extends { content: { finish: unknown }[] }>(run: T) => ({
  ...run, ms: 0, content: run.content.map((c) => ({ ...c, finish: null })),
});

describe('генератор: отделка', { timeout: 60000 }, () => {
  it('отдельный поток: правила отделки не меняют раскладку и остальное наполнение', () => {
    for (const seed of ['a', 'b', 'хрущ']) {
      const plain = generateRun(hrushLike(), { seed, count: 25, fill: true });
      const fancy = generateRun(withFinishes(hrushLike()), { seed, count: 25, fill: true });
      expect(noFinish(fancy)).toEqual(noFinish(plain));
      expect(plain.content.every((c) => c.finish.wall === null && c.finish.floor === null)).toBe(true);
      expect(fancy.content.some((c) => c.finish.wall !== null)).toBe(true);
    }
  });

  it('детерминизм и порядок бросков: F = root.sub("finish:" + inst.id), сначала стены, потом пол', () => {
    const p = withFinishes(hrushLike());
    const a = generateRun(p, { seed: 'det', count: 20 });
    const b = generateRun(p, { seed: 'det', count: 20 });
    expect(a.content.map((c) => c.finish)).toEqual(b.content.map((c) => c.finish));
    // независимая реализация по документу (§5.6 GENERATOR.md)
    const root = makeRng('det');
    for (const inst of a.instances) {
      const room = p.rooms.find((r) => r.id === inst.roomId)!;
      const rule = room.tags.includes('start') ? p.finishRules[0] : p.finishRules[1];
      const F = root.sub(`finish:${inst.id}`);
      const wall = rule.wall[F.weightedIndex(rule.wall.map((x) => x.weight))].finishId;
      const floor = rule.floor[F.weightedIndex(rule.floor.map((x) => x.weight))].finishId;
      expect(a.content.find((c) => c.inst === inst.id)!.finish).toEqual({ wall, floor });
    }
  });

  it('частоты ≈ w/Σw, стены и пол независимы', () => {
    const p = withFinishes(contentProject());
    const room = p.rooms[0];
    room.tags = ['жилая'];
    const N = 4000;
    let b = 0, parq = 0, both = 0;
    for (let i = 0; i < N; i++) {
      const f = rollFinish(p, room, makeRng(`f${i}`));
      ok(f.wall === 'wpA' || f.wall === 'wpB', 'wall');
      ok(f.floor === 'lino' || f.floor === 'parq', 'floor');
      if (f.wall === 'wpB') b++;
      if (f.floor === 'parq') parq++;
      if (f.wall === 'wpB' && f.floor === 'parq') both++;
    }
    const sd = (q: number) => Math.sqrt((q * (1 - q)) / N);
    expect(Math.abs(b / N - 0.75)).toBeLessThan(4 * sd(0.75));
    expect(Math.abs(parq / N - 0.5)).toBeLessThan(4 * sd(0.5));
    expect(Math.abs(both / N - 0.375)).toBeLessThan(4 * sd(0.375));
  });

  it('явное назначение побеждает правило (без броска); висячее и чужой поверхности — не считается', () => {
    const p = withFinishes(contentProject());
    const room = p.rooms[0];
    room.tags = ['жилая'];
    room.finish = { wall: 'tile', floor: null };
    for (let i = 0; i < 200; i++) expect(rollFinish(p, room, makeRng(`x${i}`)).wall).toBe('tile');
    // стена задана — пол берёт первый бросок потока
    const F = makeRng('y');
    expect(rollFinish(p, room, makeRng('y')).floor).toBe(['lino', 'parq'][F.weightedIndex([1, 1])]);
    room.finish = { wall: 'lino', floor: 'нет' }; // пол на стене и несуществующая — по правилу
    const f = rollFinish(p, room, makeRng('z'));
    expect(['wpA', 'wpB']).toContain(f.wall);
    expect(['lino', 'parq']).toContain(f.floor);
    // нет правила и назначения — null без бросков
    room.tags = ['кладовка'];
    room.finish = { wall: null, floor: null };
    expect(rollFinish(p, room, makeRng('z'))).toEqual({ wall: null, floor: null });
    // строки с нулевым весом и на удалённые отделки не выпадают
    room.tags = ['жилая'];
    p.finishRules[1].wall = [{ finishId: 'нет', weight: 5 }, { finishId: 'wpA', weight: 0 }];
    expect(rollFinish(p, room, makeRng('z')).wall).toBeNull();
  });

  it('экспорт: instances[].finish и таблица finishes (с dado), tex — только с withTex', () => {
    const p = withFinishes(hrushLike());
    const run = generateRun(p, { seed: 'exp', count: 15 });
    const json = exportRunJSON(p, run) as any;
    expect(JSON.parse(JSON.stringify(json))).toEqual(json);
    json.instances.forEach((ji: any, i: number) => expect(ji.finish).toEqual(run.content[i].finish));
    const used = new Set<string>();
    for (const c of run.content) for (const id of [c.finish.wall, c.finish.floor]) if (id) used.add(id);
    expect(used.has('two')).toBe(true); // старт — двухцветная
    used.add('tile'); // её нижняя панель
    expect(json.finishes.map((f: any) => f.id).sort()).toEqual([...used].sort());
    const two = json.finishes.find((f: any) => f.id === 'two');
    expect(two).toEqual({
      id: 'two', name: 'two', surface: 'wall', color: '#888', tex: null, hasTex: false, tileW: 0.5, tileH: 0.5,
      dado: { finishId: 'tile', heightM: 1.5 },
    });
    const wpA = json.finishes.find((f: any) => f.id === 'wpA');
    if (wpA) expect(wpA).toMatchObject({ tex: null, hasTex: true });
    const withTex = exportRunJSON(p, run, { withTex: true }) as any;
    const t = withTex.finishes.find((f: any) => f.id === 'wpA');
    if (t) expect(t.tex).toMatch(/^data:image\/jpeg/);
    // проект без отделок — пустая таблица, у экземпляров null
    const bare = hrushLike();
    const j2 = exportRunJSON(bare, generateRun(bare, { seed: 'exp', count: 5 })) as any;
    expect(j2.finishes).toEqual([]);
    expect(j2.instances[0].finish).toEqual({ wall: null, floor: null });
  });
});
