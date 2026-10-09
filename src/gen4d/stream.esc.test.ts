// Метро: сорвавшиеся дорожки эскалаторов в мире прогулки (StreamWorld.breakEscalator / escBroken, WorldSave.esc,
// WorldOp 'esc'): навсегда, кто первый — тот и сорвал, сохранение туда-обратно, мусор в сохранении, у двух копий мира
// (кооп) — одинаково; у экземпляра марш сломанной дорожки убран из лестницы, номер дорожки не съезжает (escLanes).
// Лестничный зал — общаги (марш один: дорожка 0), чтобы тест не зависел от комнат метро.
import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '../data/presets';
import type { Project, WorldSettings } from '../model/types';
import { escLanes } from '../locations/metroEscalator';
import { DEFAULT_WALK, WalkSession, type WorldOp } from '../view3d/walk';
import { newWorldSettings } from './biomes';
import { createStreamWorld, streamSettings, type StreamSave, type StreamWorld } from './stream';

const project = (): Project => {
  const p = createDefaultProject();
  p.finishes ??= [];
  p.finishRules ??= [];
  return p;
};
const p = project();
const world = (o: Partial<WorldSettings> = {}): WorldSettings => ({ ...newWorldSettings(), ...o });
const mk = (seed: string, save?: StreamSave) => createStreamWorld(p, streamSettings(seed, { world: world({ startBiome: 'obshaga', trAfter: 100000 }) }), save);
const roundtrip = (s: StreamSave): StreamSave => JSON.parse(JSON.stringify(s));
const noSavedAt = (s: StreamSave) => ({ ...s, savedAt: 0, run: { ...s.run, ms: 0 } });
const stairRoom = (id: string) => !!p.rooms.find((r) => r.id === id)?.stair;

/** Раскрывать мир в ширину, пока не встанет комната с лестницей; её id. */
function stairInst(w: StreamWorld): string {
  const seen = new Set<string>();
  const q = [w.startId!];
  while (q.length && w.run().instances.length < 400) {
    const id = q.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    w.expand(id);
    const hit = w.run().instances.find((i) => stairRoom(i.roomId));
    if (hit) return hit.id;
    for (const l of w.run().links) {
      if (l.kind === 'descent' || l.kind === 'lift' || l.sealed) continue;
      if (l.a.inst === id && !seen.has(l.b.inst)) q.push(l.b.inst);
      if (l.b.inst === id && !seen.has(l.a.inst)) q.push(l.a.inst);
    }
  }
  throw new Error('лестница не встала');
}

describe('метро: сорвавшиеся дорожки эскалатора', { timeout: 120000 }, () => {
  it('сорвать: навсегда, второй раз — false; нет экземпляра / марша — false; onChange — этот экземпляр', () => {
    const w = mk('esc-a');
    const id = stairInst(w);
    const n = p.rooms.find((r) => r.id === w.run().instances.find((i) => i.id === id)!.roomId)!.stair!.flights.length;
    expect(w.escBroken(id)).toEqual([]);
    const calls: string[][] = [];
    w.onChange((ids) => calls.push(ids));
    for (const bad of [-1, n, 0.5, NaN, Infinity]) expect(w.breakEscalator(id, bad), String(bad)).toBe(false);
    expect(w.breakEscalator('i99999', 0)).toBe(false);
    expect(w.breakEscalator(w.startId!, 0)).toBe(stairRoom(w.run().instances[0].roomId));
    expect(calls).toEqual([]);
    expect(w.breakEscalator(id, 0)).toBe(true);
    expect(w.breakEscalator(id, 0)).toBe(false);
    expect(w.escBroken(id)).toEqual([0]);
    expect(calls).toEqual([[id]]);
  });

  it('сохранение: «inst/lane» в WorldSave.esc только если есть; туда и обратно — то же; мусор отброшен', () => {
    const A = mk('esc-b');
    const id = stairInst(A);
    expect('esc' in A.save().world!).toBe(false);
    A.breakEscalator(id, 0);
    const sv = roundtrip(A.save());
    expect(sv.world!.esc).toEqual([`${id}/0`]);
    const B = mk('esc-b', sv);
    expect(B.stale).toBe(false);
    expect(B.escBroken(id)).toEqual([0]);
    expect(B.breakEscalator(id, 0)).toBe(false);
    expect(noSavedAt(B.save())).toEqual(noSavedAt(A.save()));
    const junk = { ...sv, world: { ...sv.world!, esc: [`${id}/0`, `${id}/0`, `${id}/7`, `${id}/x`, 'i99999/0', '/0', 5, null, `${id}/-1`] as unknown as string[] } };
    const C = mk('esc-b', junk);
    expect(C.stale).toBe(false);
    expect(C.escBroken(id)).toEqual([0]);
    expect(C.save().world!.esc).toEqual([`${id}/0`]);
    for (const bad of ['x', 5, { a: 1 }, null]) {
      const D = mk('esc-b', { ...sv, world: { ...sv.world!, esc: bad as unknown as string[] } });
      expect(D.stale).toBe(false);
      expect(D.escBroken(id)).toEqual([]);
    }
  });

  it("WorldOp 'esc': у двух копий (кооп) — одинаково, второй — null; у экземпляра марш убран, номер дорожки — escLanes", async () => {
    const opts = { ...DEFAULT_WALK, seed: 'esc-coop', biome: 'obshaga' };
    const A = new WalkSession(p, opts, { save: null, opened: [], key: 'test/A' });
    const B = new WalkSession(p, opts, { save: null, opened: [], key: 'test/B' });
    const id = stairInst(A.world);
    stairInst(B.world);
    await Promise.resolve();
    const before = A.rx.instances.find((i) => i.id === id)!;
    expect(before.stair!.flights.length).toBeGreaterThan(0);
    expect(before.escBroken).toBeUndefined();
    const changed: string[][] = [];
    A.onUpdate = (_rx, ch) => changed.push(ch);
    const ops: WorldOp[] = [
      { k: 'esc', inst: id, lane: 0 },
      { k: 'esc', inst: id, lane: 0 },
      { k: 'esc', inst: id, lane: 99 },
      { k: 'esc', inst: 'i99999', lane: 0 },
    ];
    const ra = ops.map((op) => A.apply(op));
    const rb = ops.map((op) => B.apply(op));
    expect(ra).toEqual([id, null, null, null]);
    expect(rb).toEqual(ra);
    await Promise.resolve();
    await Promise.resolve();
    expect(changed.flat()).toContain(id);
    const after = A.rx.instances.find((i) => i.id === id)!;
    expect(after.escBroken).toEqual([0]);
    expect(after.escLanes).toEqual(before.stair!.flights);
    expect(after.stair!.flights).toEqual(before.stair!.flights.slice(1));
    expect(after.stair!.pads).toEqual(before.stair!.pads);
    expect(B.rx.instances.find((i) => i.id === id)!.escBroken).toEqual([0]);
    expect(noSavedAt(B.world.save())).toEqual(noSavedAt(A.world.save()));
    // дорожки (механика метро) по такому экземпляру: номер — индекс марша до поломки
    const lanes = escLanes({ ...after, roomTags: ['метро', 'эскалатор'] }, 0.1, 'k');
    expect(lanes.map((l) => [l.lane, l.broken])).toEqual(before.stair!.flights.map((_, n) => [n, n === 0]));
    // опоздавший — из сохранения (чекпойнт): та же лестница
    const C = new WalkSession(p, opts, { save: roundtrip(A.world.save()), opened: [], key: 'test/C' });
    const c = C.rx.instances.find((i) => i.id === id)!;
    expect(c.escBroken).toEqual([0]);
    expect(c.stair!.flights).toEqual(after.stair!.flights);
    for (const s of [A, B, C]) s.dispose();
  });
});
