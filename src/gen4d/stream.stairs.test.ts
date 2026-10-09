// Лестницы с перепадом высоты в бесконечном мире (Room.stair, src/model/stairs.ts): комната за маршем — на этаж выше
// или ниже, подъёмы складываются, спуск со старта — в минус; полы у двух меток каждого проёма вровень; сохранение и
// загрузка высоты не теряют. Залы — тестовые (src/model/stairs.test-util.ts), не пресеты игры.
import { describe, expect, it } from 'vitest';
import { connDz, STOREY_M } from '../model/stairs';
import { stairHall, stairProject } from '../model/stairs.test-util';
import type { Run } from '../model/types';
import { validateFoldRun } from './fold';
import { createStreamWorld, roomPrint, streamSettings, type StreamSave, type StreamWorld } from './stream';

const hall = stairHall('t_stair');
const p = stairProject([hall]);
const roomOf = (id: string) => p.rooms.find((r) => r.id === id)!;

/** «Пройти» мир: раскрыть экземпляры в ширину от from, пока комнат меньше n. */
function walk(w: StreamWorld, n: number, from = w.startId!): void {
  const seen = new Set<string>();
  const q = [from];
  while (q.length && w.run().instances.length < n) {
    const id = q.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    w.expand(id);
    for (const l of w.run().links) {
      if (l.kind === 'descent' || l.kind === 'lift') continue;
      if (l.a.inst === id && !seen.has(l.b.inst)) q.push(l.b.inst);
      if (l.b.inst === id && !seen.has(l.a.inst)) q.push(l.a.inst);
    }
  }
}

/** Высота пола у метки экземпляра, м. */
function doorZ(run: Run, inst: string, conn: string): number {
  const i = run.instances.find((x) => x.id === inst)!;
  const r = roomOf(i.roomId);
  return (i.z ?? 0) + connDz(r, r.connectors.findIndex((c) => c.id === conn));
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

describe('лестницы: высота комнат за маршем', { timeout: 120000 }, () => {
  it('метки зала: верх — этаж, низ — 0', () => {
    expect(connDz(hall, 0)).toBeCloseTo(STOREY_M, 9);
    expect(connDz(hall, 1)).toBe(0);
  });

  it('старт — зал: за верхней меткой этаж выше, за нижней — тот же', () => {
    let checked = 0;
    // сиды перебором: за дверью иногда ничего не встаёт (пул пресетов меняется) — нужны оба соседа
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const w = createStreamWorld(p, streamSettings(seed, { startRoomId: 't_stair', deadEndChance: 0 }));
      w.expand(w.startId!);
      const run = w.run();
      const by = (conn: string) => {
        const l = run.links.find((x) => (x.a.inst === w.startId && x.a.connector === conn) || (x.b.inst === w.startId && x.b.connector === conn));
        return l ? run.instances.find((i) => i.id === (l.a.inst === w.startId ? l.b.inst : l.a.inst))! : null;
      };
      const up = by(hall.connectors[0].id), down = by(hall.connectors[1].id);
      if (up) expect(up.z, seed).toBeCloseTo(STOREY_M, 9), checked++;
      if (down) expect(down.z ?? 0, seed).toBe(0), checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(4);
  });

  for (const seed of ['st-1', 'st-2', 'st-3']) {
    it(`мир ${seed}: подъёмы складываются, спуск — в минус, полы у проёмов вровень, validateFoldRun чист`, () => {
      const w = createStreamWorld(p, streamSettings(seed));
      walk(w, 200);
      const run = w.run();
      const zs = run.instances.map((i) => i.z ?? 0);
      // высоты — целые этажи (одна лестница — STOREY_M), в мире есть комнаты на другой высоте
      for (const z of zs) expect(near(z / STOREY_M, Math.round(z / STOREY_M)), `z = ${z}`).toBe(true);
      expect(zs.some((z) => z !== 0)).toBe(true);
      // у стартовой — 0
      expect(run.instances[0].z ?? 0).toBe(0);
      for (const l of run.links) {
        if (l.kind === 'descent' || l.kind === 'lift') continue;
        expect(near(doorZ(run, l.a.inst, l.a.connector), doorZ(run, l.b.inst, l.b.connector)), `${l.a.inst}/${l.a.connector} – ${l.b.inst}/${l.b.connector}`).toBe(true);
      }
      expect(validateFoldRun(p, run)).toEqual([]);
    });
  }

  it('несколько миров: и вверх, и вниз (подвал), и два марша подряд', () => {
    const all: number[] = [];
    for (const seed of ['st-1', 'st-2', 'st-3']) {
      const w = createStreamWorld(p, streamSettings(seed));
      walk(w, 200);
      all.push(...w.run().instances.map((i) => i.z ?? 0));
    }
    expect(Math.max(...all)).toBeGreaterThanOrEqual(STOREY_M - 1e-9);
    expect(Math.min(...all)).toBeLessThanOrEqual(-2 * STOREY_M + 1e-9);
  });

  it('сохранение: высоты те же после загрузки (через JSON), мир растёт дальше так же', () => {
    const settings = streamSettings('st-2');
    const a = createStreamWorld(p, settings);
    walk(a, 120);
    const sv = JSON.parse(JSON.stringify(a.save())) as StreamSave;
    const b = createStreamWorld(p, settings, sv);
    expect(b.stale).toBe(false);
    const za = a.run().instances.map((i) => i.z ?? 0);
    expect(b.run().instances.map((i) => i.z ?? 0)).toEqual(za);
    // дальше — одинаково: раскрыть всё ещё не раскрытое
    const pend = a.run().instances.filter((i) => !a.isExpanded(i.id)).map((i) => i.id).slice(0, 30);
    for (const id of pend) {
      a.expand(id);
      b.expand(id);
    }
    expect(b.run().instances.map((i) => [i.roomId, i.z ?? 0])).toEqual(a.run().instances.map((i) => [i.roomId, i.z ?? 0]));
    expect(validateFoldRun(p, b.run())).toEqual([]);
  });

  it('validateFoldRun ловит проём между разными высотами', () => {
    const w = createStreamWorld(p, streamSettings('st-1'));
    walk(w, 60);
    const run = w.run();
    const bad: Run = { ...run, instances: run.instances.map((i, k) => (k === run.instances.length - 1 ? { ...i, z: (i.z ?? 0) + 1 } : i)) };
    expect(validateFoldRun(p, bad).some((e) => e.includes('разной высоте'))).toBe(true);
  });

  it('отпечаток комнаты: без лестницы прежний, лестница в нём учтена', () => {
    const plain = { ...hall, stair: undefined };
    const flat = { ...hall, stair: { ...hall.stair!, flights: hall.stair!.flights.map((f) => ({ ...f, z1: 3 })) } };
    expect(roomPrint(plain)).not.toBe(roomPrint(hall));
    expect(roomPrint(flat)).not.toBe(roomPrint(hall));
    const { stair: _s, ...noField } = hall;
    expect(roomPrint(noField as typeof hall)).toBe(roomPrint(plain));
  });
});
