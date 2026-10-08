// Бесконечный мир: «Ржавый лифт» и выходы вверх (ascend) — этажи выше лифта, логово, стыковка к шахте.
import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '../data/presets';
import { strip } from '../gen/fixtures.test-util';
import { OUT_SIGN, segLine, segStart, turnSide } from '../gen/geom';
import { instanceWorld } from '../gen/world';
import { locationSeedKey } from '../locations/stairwell';
import { rollLift } from '../locations/lift';
import { OPPOSITE } from '../model/cells';
import { makeRng } from '../model/rng';
import type { LiftSide, Project, Rot, Run, Side } from '../model/types';
import { overlapPairs, validateFoldRun } from './fold';
import {
  childAddr, createStreamWorld, EXIT_TAGS, LIFT_ARRIVAL_TAG, liftConn, liftWall, seedKey, streamSettings,
  type StreamSave, type StreamSettings, type StreamWorld,
} from './stream';

/** Пресеты, где «Ржавый лифт» встречается часто (иначе его пришлось бы долго искать). */
function presets(weight = 50): Project {
  const p = createDefaultProject();
  p.finishes ??= [];
  p.finishRules ??= [];
  p.rooms.find((r) => r.id === 'lift_rusty')!.gen.weight = weight;
  return p;
}

const transit = (l: Run['links'][number]) => l.kind === 'descent' || l.kind === 'lift';

/** Соседи по дверям (переходы спец-локаций и выходы лифтов — не двери). */
const doorNeighbors = (run: Run, id: string): string[] => {
  const out: string[] = [];
  for (const l of run.links) {
    if (transit(l)) continue;
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

const SIDES: LiftSide[] = ['straight', 'right'];

/** Лифт на этаже floor, у которого ещё нет выходов. */
const liftIn = (w: StreamWorld, floor = 0) => (): string | null =>
  w.run().instances.find((i) => i.roomId === 'lift_rusty' && (i.floor ?? 0) === floor &&
    !w.run().links.some((l) => l.kind === 'lift' && l.a.inst === i.id))?.id ?? null;

/** Мир, в котором уже стоит лифт: его id. */
function withLift(p: Project, s: StreamSettings): { w: StreamWorld; L: string } {
  const w = createStreamWorld(p, s);
  const { found } = walk(w, w.startId!, 400, 'find', liftIn(w));
  if (!found) throw new Error('лифт не встретился');
  return { w, L: found };
}

const inst = (run: Run, id: string) => run.instances.find((i) => i.id === id)!;

/** Розыгрыш лифта экземпляра (ошибка, если там не лифт). */
function liftRoll(w: StreamWorld, id: string) {
  const L = w.locationOf(id);
  if (L?.kind !== 'lift') throw new Error(`${id} — не лифт`);
  return L.roll;
}

/** Все выходы лифта: [этаж, сторона] по порядку этажей — снизу (−down) вверх (floors), без входного 0. */
const exitsOf = (r: { floors: number; down: number }): [number, LiftSide][] => {
  const out: [number, LiftSide][] = [];
  for (let f = -r.down; f <= r.floors; f++) if (f !== 0) for (const s of SIDES) out.push([f, s]);
  return out;
};

const CW: Record<Side, Side> = { N: 'E', E: 'S', S: 'W', W: 'N' };

describe('бесконечный мир: «Ржавый лифт» и выходы вверх и вниз', { timeout: 300000 }, () => {
  const p = presets();
  const s = streamSettings('lift');

  it('liftWall: прямо — над входом (та же стена), направо — правая рука (войдя в кабину лицом от входа), при любом повороте', () => {
    // пресет: вход S в осях комнаты; поворот экземпляра поворачивает и вход, и выходы
    const cases: [Rot, Side, Side, Side][] = [[0, 'S', 'S', 'E'], [90, 'W', 'W', 'S'], [180, 'N', 'N', 'W'], [270, 'E', 'E', 'N']];
    for (const [rot, entry, straight, right] of cases) {
      expect(turnSide('S', rot)).toBe(entry);
      expect(liftWall([{ side: entry, len: 13 }], rot, 'straight')).toBe(straight);
      expect(liftWall([{ side: entry, len: 13 }], rot, 'right')).toBe(right);
      // без меток с длиной — вход считается стороной S, повёрнутой на rot
      expect(liftWall([{ side: 'N', len: 0 }], rot, 'straight')).toBe(straight);
    }
  });

  it('лифт сам вверх не раскрывается; розыгрыш — тот же, что у движка; ascend проверяет аргументы', () => {
    const { w, L } = withLift(p, s);
    w.expand(L);
    w.ensureAround(L, 4);
    w.ensureVisible(L);
    const run = w.run();
    expect(run.instances.every((i) => (i.floor ?? 0) === 0)).toBe(true);
    expect(run.links.some((l) => l.kind === 'lift')).toBe(false);
    expect(w.liftExitOf(L, 1, 'straight')).toBeNull();
    expect(w.stats()).toMatchObject({ lifts: 0, descents: 0, floors: 1, minFloor: 0, maxFloor: 0 });
    // у лифта одна метка — вход, она связана с коридором/площадкой
    expect(doorNeighbors(run, L)).toHaveLength(1);
    const loc = w.locationOf(L)!;
    if (loc.kind !== 'lift') throw new Error('не лифт');
    expect(loc.roll).toEqual(rollLift(loc.spec, locationSeedKey(seedKey(s.seed, s.mods), w.addressOf(L)!)));
    expect(loc.roll.lair).not.toBeNull(); // lairChance 1 у пресета
    // ошибки: не лифт, этаж вне −down…floors или вход (0), чужая сторона
    expect(() => w.ascend(w.startId!, 1, 'straight')).toThrow(/нет спец-локации|не лифт/);
    expect(() => w.ascend('нет', 1, 'straight')).toThrow();
    expect(loc.roll.down).toBeGreaterThanOrEqual(1); // пресет: 1–2 этажа вниз
    for (const f of [0, -loc.roll.down - 1, loc.roll.floors + 1, 1.5, NaN]) expect(() => w.ascend(L, f, 'straight')).toThrow(/этаж/);
    expect(() => w.ascend(L, 1, 'left' as LiftSide)).toThrow(/straight/);
    expect(() => w.descend(L)).toThrow(/не лестница/);
    expect(w.run().instances.length).toBe(run.instances.length);
  });

  it('ascend: этаж ±floor, связь lift, логово ровно на roll.lair, повтор — тот же id, детерминизм', () => {
    const play = (order: (x: [number, LiftSide][]) => [number, LiftSide][]) => {
      const { w, L } = withLift(p, s);
      const got: string[][] = [];
      w.onChange((ids) => got.push(ids));
      const ids = new Map<string, string>();
      for (const [f, side] of order(exitsOf(liftRoll(w, L)))) ids.set(`${f}:${side}`, w.ascend(L, f, side));
      return { w, L, ids, got };
    };
    const { w, L, ids, got } = play((x) => x);
    const roll = liftRoll(w, L);
    expect(roll.floors).toBeGreaterThanOrEqual(3);
    expect(roll.floors).toBeLessThanOrEqual(6);
    expect(roll.down).toBeGreaterThanOrEqual(1);
    expect(roll.down).toBeLessThanOrEqual(2);
    const n = 2 * (roll.floors + roll.down);
    expect(got).toEqual([...ids.values()].map((id) => [id]));
    const run = w.run();
    const li = inst(run, L);
    const lifts = run.links.filter((l) => l.kind === 'lift');
    expect(lifts).toHaveLength(n);
    let lairs = 0;
    for (const [f, side] of exitsOf(roll)) {
      const id = ids.get(`${f}:${side}`)!;
      // повторный вызов и liftExitOf — тот же id, мир не меняется
      expect(w.ascend(L, f, side)).toBe(id);
      expect(w.liftExitOf(L, f, side)).toBe(id);
      const ex = inst(run, id);
      expect(ex.floor).toBe((li.floor ?? 0) + f);
      expect(ex.parent).toBe(L);
      expect(ex.depth).toBe(li.depth + 1);
      expect(w.addressOf(id)).toBe(childAddr(w.addressOf(L)!, liftConn(f, side)));
      const l = lifts.find((x) => x.b.inst === id)!;
      expect(l).toEqual({ a: { inst: L, connector: '' }, b: { inst: id, connector: l.b.connector }, kind: 'lift', floors: f, side });
      expect(w.doorState(id, l.b.connector)).toBe('linked');
      expect(run.openConnectors.some((o) => o.inst === id && o.connector === l.b.connector)).toBe(false);
      const room = p.rooms.find((r) => r.id === ex.roomId)!;
      expect(room.connectors.find((c) => c.id === l.b.connector)!.tag).toBe(LIFT_ARRIVAL_TAG);
      const lair = roll.lair!.floor === f && roll.lair!.side === side;
      if (lair) {
        lairs++;
        expect(room.location?.kind).toBe('lair');
        expect(w.locationOf(id)).toMatchObject({ kind: 'lair', roll: null });
      } else {
        expect(room.location).toBeFalsy();
        expect(room.tags.some((t) => EXIT_TAGS.includes(t))).toBe(true);
      }
    }
    expect(lairs).toBe(1);
    expect(got.length).toBe(n); // повторные вызовы ничего не меняют
    // этажи — своё измерение занятости: выходы над и под лифтом не пересекаются ни с ним, ни друг с другом между этажами
    const pairs = overlapPairs(p, run);
    for (const [a, b] of pairs) expect(inst(run, a).floor ?? 0).toBe(inst(run, b).floor ?? 0);
    expect(validateFoldRun(p, run)).toEqual([]);
    const lf = li.floor ?? 0;
    expect(w.stats()).toMatchObject({ lifts: n, descents: 0, floors: 1 + roll.floors + roll.down, minFloor: Math.min(0, lf - roll.down), maxFloor: lf + roll.floors });
    expect(run.warnings.some((x) => x.includes(`выходов лифтов ${n}`))).toBe(true);
    // тот же сид и те же действия — тот же мир
    const b = play((x) => x);
    expect(strip(b.w.run())).toEqual(strip(run));
    // обратный порядок вызовов: комната, метка прихода, поворот, этаж и адрес каждого выхода — те же
    const c = play((x) => x.slice().reverse());
    const crun = c.w.run();
    for (const [key, id] of ids) {
      const x = inst(run, id), y = inst(crun, c.ids.get(key)!);
      expect([y.roomId, y.rot, y.floor, y.parent]).toEqual([x.roomId, x.rot, x.floor, x.parent]);
      expect(c.w.addressOf(y.id)).toBe(w.addressOf(x.id));
      const lb = (r: Run, i: string) => r.links.find((l) => l.kind === 'lift' && l.b.inst === i)!.b.connector;
      expect(lb(crun, y.id)).toBe(lb(run, x.id));
    }
  });

  it('стыковка: комната за выходом прижата к стороне шахты (прямо — напротив входа, направо — правая рука)', () => {
    const { w, L } = withLift(p, s);
    const roll = liftRoll(w, L);
    const gap = s.gap;
    let docked = 0;
    for (let f = 1; f <= roll.floors; f++) {
      // по одному выходу на свободный этаж, стороны через этаж (обе стороны одного этажа — ниже)
      const side: LiftSide = f % 2 ? 'straight' : 'right';
      const id = w.ascend(L, f, side);
      const run = w.run();
      const Lw = instanceWorld(p, inst(run, L));
      const Ew = instanceWorld(p, inst(run, id));
      const entry = Lw.connectors[0].side;
      const wall = side === 'straight' ? entry : CW[OPPOSITE[entry]];
      const conn = run.links.find((l) => l.kind === 'lift' && l.b.inst === id)!.b.connector;
      const B = Ew.connectors.find((c) => c.id === conn)!;
      expect(B.side).toBe(OPPOSITE[wall]);
      // линия метки прихода — сторона шахты + gap; центр метки — центр стороны (±0.5 клетки)
      const b = Lw.bbox;
      const line = wall === 'N' ? b.y0 : wall === 'S' ? b.y1 : wall === 'W' ? b.x0 : b.x1;
      expect(segLine(B)).toBe(line + gap * OUT_SIGN[wall]);
      const mid = wall === 'N' || wall === 'S' ? (b.x0 + b.x1) / 2 : (b.y0 + b.y1) / 2;
      expect(Math.abs(segStart(B) + B.len / 2 - mid)).toBeLessThanOrEqual(0.5);
      expect(inst(run, id).w ?? 0).toBe(inst(run, L).w ?? 0);
      docked++;
    }
    expect(docked).toBe(roll.floors);
    // и этаж ниже входа: та же стыковка, этаж лифта − 1
    const idDown = w.ascend(L, -1, 'straight');
    const rd = w.run();
    expect(inst(rd, idDown).floor).toBe((inst(rd, L).floor ?? 0) - 1);
    expect(rd.links.find((l) => l.kind === 'lift' && l.b.inst === idDown)).toMatchObject({ floors: -1, side: 'straight' });
    const Bd = instanceWorld(p, inst(rd, idDown)).connectors.find((c) => c.id === rd.links.find((l) => l.kind === 'lift' && l.b.inst === idDown)!.b.connector)!;
    expect(Bd.side).toBe(OPPOSITE[instanceWorld(p, inst(rd, L)).connectors[0].side]);
    // обе стороны одного этажа: вторая тоже лицом к своей стороне шахты (в своём слое, если углы комнат сошлись)
    const id2 = w.ascend(L, 1, 'right');
    const run = w.run();
    const Lw = instanceWorld(p, inst(run, L));
    const B = instanceWorld(p, inst(run, id2)).connectors.find((c) => c.id === run.links.find((l) => l.kind === 'lift' && l.b.inst === id2)!.b.connector)!;
    expect(B.side).toBe(OPPOSITE[CW[OPPOSITE[Lw.connectors[0].side]]]);
    expect(validateFoldRun(p, run)).toEqual([]);
  });

  it('мир растёт от выхода: двери не меняют этаж, гарантии и проверка целы; выше — снова лифт и ещё выше', () => {
    const { w, L } = withLift(p, s);
    const roll = liftRoll(w, L);
    // обычный (не логово) выход на верхнем этаже лифта
    const side: LiftSide = roll.lair!.floor === roll.floors && roll.lair!.side === 'straight' ? 'right' : 'straight';
    const id = w.ascend(L, roll.floors, side);
    const f = inst(w.run(), id).floor!;
    expect(f).toBe(roll.floors);
    const n0 = w.run().instances.length;
    const fresh = w.ensureAround(id);
    expect(fresh.length).toBeGreaterThan(0);
    for (const x of fresh) expect(inst(w.run(), x).floor).toBe(f);
    const { found, seen } = walk(w, id, 600, 'above', liftIn(w, f));
    const run = w.run();
    expect(run.instances.length).toBeGreaterThan(n0 + 20);
    for (const x of seen) expect(inst(run, x).floor).toBe(f);
    for (const l of run.links) if (!transit(l)) expect(inst(run, l.a.inst).floor ?? 0).toBe(inst(run, l.b.inst).floor ?? 0);
    expect(validateFoldRun(p, run)).toEqual([]);
    // на этаже выше — ещё один лифт: с него ещё выше
    expect(found).not.toBeNull();
    const id2 = w.ascend(found!, 1, 'straight');
    expect(inst(w.run(), id2).floor).toBe(f + 1);
    w.ensureAround(id2);
    expect(validateFoldRun(p, w.run())).toEqual([]);
    expect(w.stats()).toMatchObject({ lifts: 2, floors: 3, minFloor: 0, maxFloor: f + 1 });
  });

  it('логово: комнаты-логова в проекте нет — обычный выход и предупреждение', () => {
    const q: Project = { ...p, rooms: p.rooms.filter((r) => r.id !== 'boss_lair') };
    const { w, L } = withLift(q, s);
    const { floor, side } = liftRoll(w, L).lair!;
    const id = w.ascend(L, floor, side);
    expect(q.rooms.find((r) => r.id === inst(w.run(), id).roomId)!.location).toBeFalsy();
    expect(w.warnings.some((x) => x.includes('нет комнаты-логова'))).toBe(true);
    expect(validateFoldRun(q, w.run())).toEqual([]);
  });

  it('сохранение → JSON → загрузка: выходы на месте, продолжение — то же, что без сохранения', () => {
    const { w: A, L } = withLift(p, s);
    const { floor, side } = liftRoll(A, L).lair!;
    const lair = A.ascend(L, floor, side);
    const other: LiftSide = side === 'straight' ? 'right' : 'straight';
    const id = A.ascend(L, floor, other);
    const { cur } = walk(A, id, 120, 'first');
    const saved: StreamSave = JSON.parse(JSON.stringify(A.save()));
    expect(saved.run.links.filter((l) => l.kind === 'lift').length).toBe(2);
    const B = createStreamWorld(p, s, saved);
    expect(B.stale).toBe(false);
    expect(strip(B.run())).toEqual(strip(A.run()));
    expect(B.stats()).toMatchObject({ ...A.stats(), expandMsAvg: expect.any(Number), expandMsP95: expect.any(Number), expandMsMax: expect.any(Number), expands: expect.any(Number) });
    expect(B.liftExitOf(L, floor, side)).toBe(lair);
    expect(B.ascend(L, floor, other)).toBe(id);
    expect(B.addressOf(id)).toBe(A.addressOf(id));
    // продолжение: новый выход, ветка выше и этаж старта
    const top = liftRoll(A, L).floors;
    expect(B.ascend(L, top, 'straight')).toBe(A.ascend(L, top, 'straight'));
    for (const [from, seed] of [[cur, 'second'], [A.startId!, 'third']] as const) {
      walk(A, from, 100, seed);
      walk(B, from, 100, seed);
    }
    expect(strip(B.run())).toEqual(strip(A.run()));
    const noTime = (sv: StreamSave) => ({ ...sv, savedAt: 0, run: strip(sv.run) });
    expect(noTime(B.save())).toEqual(noTime(A.save()));
    expect(validateFoldRun(p, B.run())).toEqual([]);
    // у комнаты убрали спец-локацию лифта (или сменили вид) — выходам в сохранении не к чему: мир устарел
    for (const loc of [null, { kind: 'lair' as const, boss: '', darkness: 1 }]) {
      const plain: Project = { ...p, rooms: p.rooms.map((r) => (r.id === 'lift_rusty' ? { ...r, location: loc } : r)) };
      const C = createStreamWorld(plain, s, saved);
      expect(C.stale).toBe(true);
      expect(C.warnings.some((x) => x.includes('спец-локации лифта'))).toBe(true);
    }
    // испорченная связь в сохранении — тоже
    const bad: StreamSave = JSON.parse(JSON.stringify(saved));
    bad.run.links.find((l) => l.kind === 'lift')!.side = 'left' as LiftSide;
    expect(createStreamWorld(p, s, bad).stale).toBe(true);
  });

  it('проверка ловит испорченный выход лифта: этаж, не из лифта, сторона, дверь между этажами', () => {
    const { w, L } = withLift(p, s);
    // обычный выход (не логово — у того дверей дальше нет)
    const lair = liftRoll(w, L).lair!;
    const id = w.ascend(L, 1, lair.floor === 1 && lair.side === 'straight' ? 'right' : 'straight');
    w.ensureAround(id);
    const run = w.run();
    const bad = (fn: (r: Run) => void) => {
      const r: Run = JSON.parse(JSON.stringify(run));
      fn(r);
      return validateFoldRun(p, r).join('\n');
    };
    const lift = (r: Run) => r.links.find((l) => l.kind === 'lift')!;
    expect(bad((r) => { lift(r).floors! += 1; })).toMatch(/этаж/);
    expect(bad((r) => { lift(r).floors = 0; })).toMatch(/floors = 0/);
    expect(bad((r) => { lift(r).a.inst = r.instances[0].id; })).toMatch(/не из лифта/);
    expect(bad((r) => { lift(r).side = 'left' as LiftSide; })).toMatch(/side/);
    expect(bad((r) => { lift(r).kind = 'descent'; })).toMatch(/не из спец-локации|этаж/);
    expect(bad((r) => {
      const l = r.links.find((x) => !transit(x) && x.a.inst === id)!;
      r.instances.find((i) => i.id === l.b.inst)!.floor = 7;
    })).toMatch(/дверь между этажами/);
  });
});
