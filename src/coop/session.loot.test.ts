// Кооп (docs/COOP.md §2.1): лут комнат и флаги мира через настоящий relay (tools/coop-server.mjs) — одну точку лута
// подбирают двое сразу: достаётся одному; флаг (отпертая дверь) — так же; копии, отпечатки и чекпойнт одинаковы.
import { describe, expect, it } from 'vitest';
import { startCoopServer } from '../../tools/coop-server.mjs';
import { createDefaultProject } from '../data/presets';
import type { Project } from '../model/types';
import type { StreamSave } from '../gen4d/stream';
import { DEFAULT_WALK } from '../view3d/walk';
import { CoopSession } from './session';

const project = (): Project => {
  const p = createDefaultProject();
  p.finishes ??= [];
  p.finishRules ??= [];
  return p;
};
/** без времени: момент сохранения и время генерации */
const noTime = (s: StreamSave) => ({ ...s, savedAt: 0, run: { ...s.run, ms: 0 } });

async function until(f: () => boolean, ms = 60000) {
  const t0 = Date.now();
  while (!f()) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 15));
  }
}

describe('coop: лут комнат', { timeout: 240000 }, () => {
  it("'loot' двоих сразу — подобрал один; 'flag' — так же; копии и чекпойнт одинаковы", async () => {
    const { hub, url, close } = await startCoopServer({ port: 0, host: '127.0.0.1' });
    const p = project();
    const lobby = '7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
    const mk = (id: string, create = false) =>
      new CoopSession({ url, lobby, player: { id, name: id, color: '#e8b04b' }, local: () => p, ...(create ? { create: { walk: { ...DEFAULT_WALK, seed: 'кооп-лут' }, project: p } } : {}) });
    const A = mk('A', true);
    await until(() => A.status === 'online');
    const B = mk('B');
    await until(() => B.status === 'online');
    const start = A.walk!.world.startId!;
    const id = `${start}:L0`;
    const [la, lb] = await Promise.all([A.request({ k: 'loot', id }), B.request({ k: 'loot', id })]);
    expect([la, lb].filter((x) => x === id)).toHaveLength(1);
    expect([la, lb].filter((x) => x === null)).toHaveLength(1);
    const flag = `unlock:${start}/door`;
    const [fa, fb] = await Promise.all([A.request({ k: 'flag', id: flag }), B.request({ k: 'flag', id: flag })]);
    expect([fa, fb].filter((x) => x === flag)).toHaveLength(1);
    await until(() => A.lastSeq === B.lastSeq);
    for (const s of [A, B]) {
      expect(s.walk!.world.lootTaken(id)).toBe(true);
      expect(s.walk!.world.flags()).toEqual([`loot:${id}`, flag]);
    }
    expect(B.walk!.fingerprint()).toBe(A.walk!.fingerprint());
    expect(noTime(B.walk!.world.save())).toEqual(noTime(A.walk!.world.save()));
    // опоздавший — из чекпойнта хоста: подобранное подобрано
    A.checkpointNow();
    await until(() => hub.lobbies.get(lobby)?.cp?.seq === A.lastSeq);
    const C = mk('C');
    await until(() => C.status === 'online' && C.lastSeq === A.lastSeq);
    expect(C.walk!.world.flags()).toEqual(A.walk!.world.flags());
    expect(await C.request({ k: 'loot', id })).toBeNull();
    expect(A.diverged + B.diverged + C.diverged).toBe(0);
    for (const s of [A, B, C]) s.leave();
    await close();
  });
});
