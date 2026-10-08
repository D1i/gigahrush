// Бесконечный мир в режиме квартир (docs/GENERATOR-4D.md §16): квартиры, двери-выходы, биомы, переходы.
import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '../data/presets';
import { strip } from '../gen/fixtures.test-util';
import type { Project, Run, WorldSettings } from '../model/types';
import { biomeMul, newWorldSettings, transitionChance } from './biomes';
import { validateFoldRun } from './fold';
import { createStreamWorld, streamSettings, type StreamSave, type StreamWorld } from './stream';

const project = (): Project => {
  const p = createDefaultProject();
  p.finishes ??= [];
  p.finishRules ??= [];
  return p;
};
// переходы здесь — спец-комнаты (лестница, лифт); площадки-переходы — stream.barn.test.ts
const world = (o: Partial<WorldSettings> = {}): WorldSettings => ({ ...newWorldSettings(), trLanding: 0, ...o });
const settings = (seed: string, w: Partial<WorldSettings> = {}) => streamSettings(seed, { world: world(w) });

const inst = (run: Run, id: string) => run.instances.find((i) => i.id === id)!;

/** Закрытые выходы мира: [экземпляр, метка]. */
function exitsOf(w: StreamWorld): [string, string][] {
  const out: [string, string][] = [];
  const p = w as unknown as { p: Project };
  for (const i of w.run().instances) {
    const room = p.p.rooms.find((r) => r.id === i.roomId)!;
    for (const c of room.connectors) if (w.doorState(i.id, c.id) === 'exit') out.push([i.id, c.id]);
  }
  return out;
}

/** Закрытые выходы шириной от 0.7 м (за такими переход встаёт прямо за дверью; за кладовочной 0.6 м — в новой
 *  квартире у входа). */
function wideExits(w: StreamWorld): [string, string][] {
  const pp = (w as unknown as { p: Project }).p;
  return exitsOf(w).filter(([i, c]) => {
    const room = pp.rooms.find((r) => r.id === w.run().instances.find((x) => x.id === i)!.roomId)!;
    return room.connectors.find((x) => x.id === c)!.len >= 7;
  });
}

/** Комнаты квартиры экземпляра. */
const roomsOf = (w: StreamWorld, cid: number) => w.run().instances.filter((i) => w.clusterAt(i.id)?.id === cid);

describe('бесконечный мир: квартиры, биомы, переходы', { timeout: 300000 }, () => {
  const p = project();

  it('старт: квартира стартового биома — до 15 комнат, 2–10 закрытых выходов, всё раскрыто, спец-комнат нет', () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const w = createStreamWorld(p, settings(seed));
      const run = w.run();
      const cl = w.clusterAt(w.startId!)!;
      expect(cl.id).toBe(0);
      expect(cl.biome?.id).toBe('khrush');
      expect(cl.rooms).toBe(run.instances.length);
      expect(cl.rooms).toBeLessThanOrEqual(15);
      expect(cl.rooms).toBeGreaterThanOrEqual(2);
      const exits = exitsOf(w);
      expect(exits.length).toBe(cl.exits);
      expect(exits.length).toBeGreaterThanOrEqual(1);
      expect(exits.length).toBeLessThanOrEqual(10);
      // биом: каждая комната в нём растёт; спец-комнаты обычным ростом не ставятся
      for (const i of run.instances) {
        const room = p.rooms.find((r) => r.id === i.roomId)!;
        expect(room.location ?? null).toBeNull();
        expect(biomeMul(cl.biome!, room)).toBeGreaterThan(0);
        expect(w.isExpanded(i.id)).toBe(true);
      }
      // раскрывать нечего: квартира целиком
      expect(w.ensureAround(w.startId!, 4)).toEqual([]);
      expect(w.ensureVisible(w.startId!)).toEqual([]);
      expect(validateFoldRun(p, run)).toEqual([]);
    }
  });

  it('openDoor: за выходом — новая квартира, остальные выходы старой исчезают, открытая дверь — проём (назад можно)', () => {
    const w = createStreamWorld(p, settings('door'));
    const exits = exitsOf(w);
    expect(exits.length).toBeGreaterThanOrEqual(2);
    const [a, c] = exits[0];
    expect(() => w.openDoor(w.startId!, 'нет')).toThrow(/не закрытый выход/);
    const id = w.openDoor(a, c)!;
    expect(id).toBeTruthy();
    expect(w.doorState(a, c)).toBe('linked');
    for (const [x, y] of exits.slice(1)) expect(w.doorState(x, y)).toBe('dead');
    const cl = w.clusterAt(id)!;
    expect(cl.id).toBe(1);
    expect(cl.biome?.id).toBe('khrush');
    expect(inst(w.run(), id).parent).toBe(a);
    expect(w.clusterAt(w.startId!)!.exits).toBe(0);
    // новые выходы — только у новой квартиры
    for (const [x] of exitsOf(w)) expect(w.clusterAt(x)!.id).toBe(1);
    expect(() => w.openDoor(a, c)).toThrow(/не закрытый выход/);
    expect(validateFoldRun(p, w.run())).toEqual([]);
  });

  it('каждая квартира — не меньше clusterExits[0] выходов, и за входной дверью квартиры (замкнутой) тоже: мир не встаёт', () => {
    for (const [seed, ex] of [['chain', [2, 10]], ['qa-world-a', [3, 6]], ['chain3', [3, 3]]] as const) {
      const w = createStreamWorld(p, settings(seed, { clusterExits: [ex[0], ex[1]], trAfter: 100000 }));
      let id = w.startId!;
      for (let k = 0; k < 25; k++) {
        const cl = w.clusterAt(id)!;
        // подвал («Спуск в подвал» привёл в хаб): выходы — марши хабов, не квартирное правило
        if (cl.tunnels) expect(cl.exits, `${seed}: подвал ${cl.id}`).toBeGreaterThanOrEqual(1);
        else {
          expect(cl.exits, `${seed}: квартира ${cl.id} (${cl.rooms} комн.)`).toBeGreaterThanOrEqual(ex[0]);
          expect(cl.exits).toBeLessThanOrEqual(ex[1]);
        }
        const exits = exitsOf(w).filter(([x]) => w.clusterAt(x)!.id === cl.id);
        const [a, c] = exits[k % exits.length];
        const next = w.openDoor(a, c);
        expect(next, `${seed}: дверь ${a}/${c} не открылась`).toBeTruthy();
        id = next!;
      }
      expect(validateFoldRun(p, w.run())).toEqual([]);
    }
  });

  it('шанс перехода: до trAfter комнат — 0, затем trBase и +trStep за каждую следующую', () => {
    const W = world();
    expect([1, 50].map((k) => transitionChance(W, k))).toEqual([0, 0]);
    expect(transitionChance(W, 51)).toBeCloseTo(0.1, 9);
    expect(transitionChance(W, 52)).toBeCloseTo(0.11, 9);
    expect(transitionChance(W, 60)).toBeCloseTo(0.19, 9);
    expect(transitionChance(W, 500)).toBe(1);
  });

  it('enter: первый вход засчитан, повторный — нет; после trAfter — бросок; выпал — переход прямо за следующей открытой дверью', () => {
    const w = createStreamWorld(p, settings('tr', { trAfter: 2, trBase: 1, trStep: 0 }));
    const ids = w.run().instances.map((i) => i.id);
    expect(w.enter(ids[0])).toMatchObject({ counted: true, count: 1, triggered: false, pending: false });
    expect(w.enter(ids[0])).toMatchObject({ counted: false, count: 1 });
    expect(w.enter(ids[1])).toMatchObject({ counted: true, count: 2, triggered: false });
    expect(w.enter(ids[2])).toMatchObject({ counted: true, count: 3, triggered: true, pending: true });
    expect(w.transitionState()).toMatchObject({ pending: true, count: 3 });
    const exits = wideExits(w);
    const [a, c] = exits[0];
    const id = w.openDoor(a, c)!;
    // за дверью — спец-комната перехода; игрок из квартиры не ушёл: остальные выходы на месте
    const t = inst(w.run(), id);
    const room = p.rooms.find((r) => r.id === t.roomId)!;
    expect(['stairwell', 'lift']).toContain(room.location?.kind);
    expect(w.clusterAt(id)!.id).toBe(0);
    expect(w.clusterAt(w.startId!)!.transition).toBe(id);
    expect(w.transitionState()!.pending).toBe(false);
    expect(w.doorState(a, c)).toBe('linked');
    for (const [x, y] of exits.slice(1)) expect(w.doorState(x, y)).toBe('exit');
    const link = w.run().links.find((l) => !l.kind && (l.a.inst === t.id || l.b.inst === t.id))!;
    expect(link).toMatchObject({ a: { inst: a, connector: c } });
    expect(link.sealed).toBeUndefined();
    // вход в спец-комнату в счёт не идёт
    expect(w.enter(t.id)).toMatchObject({ counted: false });
    expect(validateFoldRun(p, w.run())).toEqual([]);
  });

  it('пропущенный переход исчезает (дверь к нему — глухая), зашёл — остаётся', () => {
    for (const visit of [false, true]) {
      const w = createStreamWorld(p, settings('skip', { trAfter: 0, trBase: 1, trStep: 0 }));
      w.enter(w.startId!);
      const exits = wideExits(w);
      expect(exits.length).toBeGreaterThanOrEqual(2);
      const t = w.openDoor(exits[0][0], exits[0][1])!;
      expect(w.clusterAt(w.startId!)!.transition).toBe(t);
      if (visit) w.enter(t);
      // ушёл через другой выход — в новую квартиру
      w.openDoor(exits[1][0], exits[1][1]);
      const link = w.run().links.find((l) => !l.kind && (l.a.inst === t || l.b.inst === t))!;
      const side = link.a.inst === t ? link.b : link.a;
      if (visit) {
        expect(link.sealed).toBeUndefined();
        expect(w.doorState(side.inst, side.connector)).toBe('linked');
      } else {
        expect(link.sealed).toBe(true);
        expect(w.doorState(side.inst, side.connector)).toBe('dead');
      }
    }
  });

  it('прошёл через переход — счётчик с нуля; переход ведёт в другой биом (trToBiome 1) или в богатую квартиру (0)', () => {
    for (const toBiome of [1, 0]) {
      const w = createStreamWorld(p, settings('pass', { trAfter: 0, trBase: 1, trStep: 0, trToBiome: toBiome }));
      w.enter(w.startId!);
      const [a, c] = wideExits(w)[0];
      const t = w.openDoor(a, c)!;
      const loc = w.locationOf(t)!;
      const exit = loc.kind === 'stairwell' ? w.descend(t) : loc.kind === 'lift' ? w.ascend(t, 1, 'straight') : null;
      expect(exit).toBeTruthy();
      expect(w.transitionState()).toMatchObject({ count: 0, pending: false, resets: 1 });
      const cl = w.clusterAt(exit!)!;
      if (toBiome === 1) {
        expect(cl.rich).toBe(false);
        expect(cl.biome?.id).not.toBe('khrush');
        expect(cl.home?.id).toBe(cl.biome?.id);
      } else if (cl.biome?.id === 'rich') {
        // логово лифта — тупик в биоме, откуда пришли; иначе — богатая квартира, выходы — в хрущёвки
        expect(cl.rich).toBe(true);
        expect(cl.home?.id).toBe('khrush');
      }
      expect(validateFoldRun(p, w.run())).toEqual([]);
    }
  });

  it('богатая квартира: элитность с усилением (тиры ≥ 2 выпадают чаще)', () => {
    const level = (pp: Project, id: string) => pp.economy.tiers.find((x) => x.id === id)?.level ?? 0;
    let rich = 0, richHi = 0, plain = 0, plainHi = 0;
    for (const seed of ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8']) {
      const w = createStreamWorld(p, settings(seed, { trAfter: 0, trBase: 1, trStep: 0, trToBiome: 0 }));
      w.enter(w.startId!);
      const [a, c] = wideExits(w)[0];
      const t = w.openDoor(a, c)!;
      const loc = w.locationOf(t)!;
      if (loc.kind === 'stairwell') w.descend(t);
      else if (loc.kind === 'lift') for (const f of [1, -1]) w.ascend(t, f, 'right');
      const run = w.run();
      run.instances.forEach((i, k) => {
        // усиление — у тиров уровня ≥ 2 (как у проходки); считаются комнаты с элитностью
        const tier = run.content[k].tierId;
        if (!tier) return;
        const hi = level(p, tier) >= 2;
        if (w.clusterAt(i.id)?.rich) { rich++; if (hi) richHi++; } else { plain++; if (hi) plainHi++; }
      });
    }
    expect(rich).toBeGreaterThan(5);
    expect(richHi / rich).toBeGreaterThan(plainHi / Math.max(1, plain) + 0.2);
  });

  it('сохранение → загрузка: квартиры, выходы, счётчик; продолжение — то же, что без сохранения', () => {
    const s = settings('save', { trAfter: 3, trBase: 0.5, trStep: 0.1 });
    const play = (w: StreamWorld, steps: number) => {
      for (let k = 0; k < steps; k++) {
        for (const i of w.run().instances) w.enter(i.id);
        const ex = exitsOf(w);
        if (!ex.length) break;
        w.openDoor(ex[ex.length - 1][0], ex[ex.length - 1][1]);
      }
    };
    const A = createStreamWorld(p, s);
    play(A, 3);
    const saved: StreamSave = JSON.parse(JSON.stringify(A.save()));
    expect(saved.world).toBeTruthy();
    const B = createStreamWorld(p, s, saved);
    expect(B.stale).toBe(false);
    expect(strip(B.run())).toEqual(strip(A.run()));
    expect(B.transitionState()).toEqual(A.transitionState());
    expect(exitsOf(B)).toEqual(exitsOf(A));
    play(A, 2);
    play(B, 2);
    expect(strip(B.run())).toEqual(strip(A.run()));
  });

  it('тот же сид и те же действия — тот же мир; без режима квартир — прежний рост', () => {
    const s = settings('det');
    const run = (w: StreamWorld) => {
      const ex = exitsOf(w);
      w.openDoor(ex[0][0], ex[0][1]);
      return strip(w.run());
    };
    expect(run(createStreamWorld(p, s))).toEqual(run(createStreamWorld(p, s)));
    const classic = createStreamWorld(p, streamSettings('det'));
    expect(classic.clusterAt(classic.startId!)).toBeNull();
    expect(classic.transitionState()).toBeNull();
    expect(classic.enter(classic.startId!)).toMatchObject({ counted: false });
    expect(() => classic.openDoor(classic.startId!, 'x')).toThrow(/без квартир/);
  });
});
