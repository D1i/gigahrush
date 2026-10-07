// Бесконечный мир: спец-локации и переход вниз (descend) — этажи как измерение занятости.
import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '../data/presets';
import { strip } from '../gen/fixtures.test-util';
import { locationSeedKey, rollStairwell } from '../locations/stairwell';
import { makeRng } from '../model/rng';
import type { Project, Run } from '../model/types';
import { overlapPairs, validateFoldRun } from './fold';
import {
  childAddr, createStreamWorld, DESCENT_CONN, EXIT_TAGS, seedKey, streamSettings,
  type StreamSave, type StreamSettings, type StreamWorld,
} from './stream';

/** Пресеты, где «Бесконечная лестница» встречается часто (иначе её пришлось бы долго искать). */
function presets(weight = 50): Project {
  const p = createDefaultProject();
  p.finishes ??= [];
  p.finishRules ??= [];
  p.rooms.find((r) => r.id === 'stair_loop')!.gen.weight = weight;
  return p;
}

/** Соседи по дверям (переходы спец-локаций — не двери). */
const doorNeighbors = (run: Run, id: string): string[] => {
  const out: string[] = [];
  for (const l of run.links) {
    if (l.kind === 'descent') continue;
    if (l.a.inst === id) out.push(l.b.inst);
    if (l.b.inst === id) out.push(l.a.inst);
  }
  return out;
};

/** Блуждание по дверям с ensureAround; until — остановиться, когда вернёт id. */
function walk(w: StreamWorld, from: string, steps: number, seed: string, until?: () => string | null): { cur: string; found: string | null; seen: Set<string> } {
  const R = makeRng(seed);
  let cur = from;
  const seen = new Set([cur]);
  w.ensureAround(cur);
  for (let k = 0; k < steps; k++) {
    const hit = until?.();
    if (hit) return { cur, found: hit, seen };
    const nb = doorNeighbors(w.run(), cur).sort((a, b) => (w.addressOf(a)! < w.addressOf(b)! ? -1 : 1));
    if (nb.length === 0) break;
    const fresh = nb.filter((x) => !seen.has(x));
    const pool = fresh.length && R.next() < 0.8 ? fresh : nb;
    cur = pool[R.int(0, pool.length - 1)];
    seen.add(cur);
    w.ensureAround(cur);
  }
  return { cur, found: until?.() ?? null, seen };
}

const loopIn = (w: StreamWorld, floor = 0) => (): string | null =>
  w.run().instances.find((i) => i.roomId === 'stair_loop' && (i.floor ?? 0) === floor && !w.exitOf(i.id))?.id ?? null;

/** Мир, в котором уже стоит «Бесконечная лестница»: её id. */
function withLoop(p: Project, s: StreamSettings): { w: StreamWorld; L: string } {
  const w = createStreamWorld(p, s);
  const { found } = walk(w, w.startId!, 400, 'find', loopIn(w));
  if (!found) throw new Error('лестница не встретилась');
  return { w, L: found };
}

const inst = (run: Run, id: string) => run.instances.find((i) => i.id === id)!;

/** Розыгрыш «Бесконечной лестницы» экземпляра (ошибка, если там не лестница). */
function stairRoll(w: StreamWorld, id: string) {
  const L = w.locationOf(id);
  if (L?.kind !== 'stairwell') throw new Error(`${id} — не лестница`);
  return L.roll;
}

describe('бесконечный мир: спец-локации и переход вниз', { timeout: 300000 }, () => {
  const p = presets();
  const s = streamSettings('descent');

  it('спец-локация сама вниз не раскрывается: ensureAround / ensureVisible / expand выхода не создают', () => {
    const { w, L } = withLoop(p, s);
    w.expand(L);
    w.ensureAround(L, 4);
    w.ensureVisible(L);
    const run = w.run();
    expect(run.instances.every((i) => (i.floor ?? 0) === 0)).toBe(true);
    expect(run.links.some((l) => l.kind === 'descent')).toBe(false);
    expect(w.exitOf(L)).toBeNull();
    expect(w.stats()).toMatchObject({ descents: 0, floors: 1, minFloor: 0 });
    // розыгрыш локации — тот же, что посчитает движок сам
    const loc = w.locationOf(L)!;
    expect(loc.spec.kind).toBe('stairwell');
    if (loc.kind !== 'stairwell') throw new Error('не лестница');
    expect(loc.roll).toEqual(rollStairwell(loc.spec, locationSeedKey(seedKey(s.seed, s.mods), w.addressOf(L)!)));
    expect(w.locationOf(w.startId!)).toBeNull();
    expect(() => w.descend(w.startId!)).toThrow(/нет спец-локации/);
    expect(() => w.descend('нет')).toThrow();
  });

  it('descend: выход на k этажей ниже, связь descent, повторный вызов — тот же id, детерминизм', () => {
    const play = () => {
      const { w, L } = withLoop(p, s);
      const got: string[][] = [];
      w.onChange((ids) => got.push(ids));
      const id = w.descend(L);
      return { w, L, id, got };
    };
    const { w, L, id, got } = play();
    expect(got).toEqual([[id]]);
    expect(w.descend(L)).toBe(id);
    expect(got.length).toBe(1); // повторный вызов ничего не меняет
    expect(w.exitOf(L)).toBe(id);
    const k = stairRoll(w, L).floorsDown;
    expect(k).toBeGreaterThanOrEqual(1);
    expect(k).toBeLessThanOrEqual(3);
    const run = w.run();
    const li = inst(run, L), ex = inst(run, id);
    expect(ex.floor).toBe((li.floor ?? 0) - k);
    expect(ex.parent).toBe(L);
    expect(ex.depth).toBe(li.depth + 1);
    expect(w.addressOf(id)).toBe(childAddr(w.addressOf(L)!, DESCENT_CONN));
    // связь-переход: без метки у локации; у выхода — марш, через который приходят сверху
    const d = run.links.filter((l) => l.kind === 'descent');
    expect(d).toEqual([{ a: { inst: L, connector: '' }, b: { inst: id, connector: d[0].b.connector }, kind: 'descent', floors: k }]);
    const room = p.rooms.find((r) => r.id === ex.roomId)!;
    expect(room.location).toBeFalsy();
    expect(room.tags.some((t) => EXIT_TAGS.includes(t))).toBe(true);
    expect(room.connectors.find((c) => c.id === d[0].b.connector)!.tag).toBe('stair');
    expect(w.doorState(id, d[0].b.connector)).toBe('linked');
    expect(run.openConnectors.some((o) => o.inst === id && o.connector === d[0].b.connector)).toBe(false);
    // этаж — своё измерение занятости: выход стоит под лестницей (в плане пересекаются, слой тот же), это не пересечение
    expect(ex.w).toBe(li.w);
    expect(overlapPairs(p, run).some(([a, b]) => [a, b].includes(L) && [a, b].includes(id))).toBe(false);
    expect(validateFoldRun(p, run)).toEqual([]);
    expect(w.stats()).toMatchObject({ descents: 1, floors: 2, minFloor: -k });
    // тот же сид и те же действия — тот же мир
    const b = play();
    expect(b.id).toBe(id);
    expect(strip(b.w.run())).toEqual(strip(run));
  });

  it('мир растёт от выхода: двери не меняют этаж, гарантии и проверка целы; ниже — снова лестница и ещё ниже', () => {
    const { w, L } = withLoop(p, s);
    const id = w.descend(L);
    const f = inst(w.run(), id).floor!;
    const n0 = w.run().instances.length;
    const fresh = w.ensureAround(id);
    expect(fresh.length).toBeGreaterThan(0);
    for (const x of fresh) expect(inst(w.run(), x).floor).toBe(f);
    // ветка этажа ниже: блуждание по дверям от выхода — всё на этаже выхода, мир растёт
    const { found, seen } = walk(w, id, 600, 'below', loopIn(w, f));
    const run = w.run();
    expect(run.instances.length).toBeGreaterThan(n0 + 20);
    for (const x of seen) expect(inst(run, x).floor).toBe(f);
    for (const l of run.links) if (l.kind !== 'descent') expect(inst(run, l.a.inst).floor ?? 0).toBe(inst(run, l.b.inst).floor ?? 0);
    expect(validateFoldRun(p, run)).toEqual([]);
    // на этаже ниже — ещё одна лестница: спуск с неё ещё ниже
    expect(found).not.toBeNull();
    const id2 = w.descend(found!);
    const k2 = stairRoll(w, found!).floorsDown;
    expect(inst(w.run(), id2).floor).toBe(f - k2);
    w.ensureAround(id2);
    expect(validateFoldRun(p, w.run())).toEqual([]);
    expect(w.stats()).toMatchObject({ descents: 2, floors: 3, minFloor: f - k2 });
  });

  it('сохранение → JSON → загрузка: этажи и переходы на месте, продолжение — то же, что без сохранения', () => {
    const { w: A, L } = withLoop(p, s);
    const id = A.descend(L);
    const { cur } = walk(A, id, 120, 'first');
    const saved: StreamSave = JSON.parse(JSON.stringify(A.save()));
    expect(saved.run.links.filter((l) => l.kind === 'descent').length).toBe(1);
    const B = createStreamWorld(p, s, saved);
    expect(B.stale).toBe(false);
    expect(strip(B.run())).toEqual(strip(A.run()));
    expect(B.stats()).toMatchObject({ ...A.stats(), expandMsAvg: expect.any(Number), expandMsP95: expect.any(Number), expandMsMax: expect.any(Number), expands: expect.any(Number) });
    expect(B.exitOf(L)).toBe(id);
    expect(B.descend(L)).toBe(id);
    expect(B.addressOf(id)).toBe(A.addressOf(id));
    // продолжение: по ветке ниже и по этажу старта
    for (const [from, seed] of [[cur, 'second'], [A.startId!, 'third']] as const) {
      walk(A, from, 100, seed);
      walk(B, from, 100, seed);
    }
    expect(strip(B.run())).toEqual(strip(A.run()));
    const noTime = (sv: StreamSave) => ({ ...sv, savedAt: 0, run: strip(sv.run) });
    expect(noTime(B.save())).toEqual(noTime(A.save()));
    expect(validateFoldRun(p, B.run())).toEqual([]);
    // у комнаты убрали спец-локацию — переход в сохранении больше не к чему: мир устарел
    const plain: Project = { ...p, rooms: p.rooms.map((r) => (r.id === 'stair_loop' ? { ...r, location: null } : r)) };
    const C = createStreamWorld(plain, s, saved);
    expect(C.stale).toBe(true);
    expect(C.warnings.some((x) => x.includes('спец-локации'))).toBe(true);
  });

  it('проверка ловит испорченный переход: этаж не сходится, переход не из локации, дверь между этажами', () => {
    const { w, L } = withLoop(p, s);
    const id = w.descend(L);
    w.ensureAround(id);
    const run = w.run();
    const bad = (fn: (r: Run) => void) => {
      const r: Run = JSON.parse(JSON.stringify(run));
      fn(r);
      return validateFoldRun(p, r).join('\n');
    };
    expect(bad((r) => { r.links.find((l) => l.kind === 'descent')!.floors! += 1; })).toMatch(/этаж/);
    expect(bad((r) => { r.links.find((l) => l.kind === 'descent')!.a.inst = r.instances[0].id; })).toMatch(/не из спец-локации/);
    expect(bad((r) => {
      const l = r.links.find((x) => x.kind !== 'descent' && x.a.inst === id)!;
      r.instances.find((i) => i.id === l.b.inst)!.floor = 7;
    })).toMatch(/дверь между этажами/);
  });
});
