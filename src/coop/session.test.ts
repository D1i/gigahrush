// Кооп (docs/COOP.md): копии мира у игроков лобби одинаковы — операции через настоящий relay (tools/coop-server.mjs),
// вперемешку от разных игроков, чекпойнт хоста, новичок с другим проектом (скачивает проект лобби).
import { describe, expect, it } from 'vitest';
import { startCoopServer } from '../../tools/coop-server.mjs';
import { createDefaultProject } from '../data/presets';
import type { Project } from '../model/types';
import type { StreamSave } from '../gen4d/stream';
import { DEFAULT_WALK } from '../view3d/walk';
import { CoopSession } from './session';

const LOBBY = '5d1e8c2a-7f3b-4a9e-8c6d-0e1f2a3b4c5d';

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

/** Закрытые выходы копии мира: [экземпляр, метка]. */
function exits(co: CoopSession): [string, string][] {
  const w = co.walk!.world;
  const out: [string, string][] = [];
  for (const i of w.run().instances) {
    const room = co.project!.rooms.find((r) => r.id === i.roomId)!;
    for (const c of room.connectors) if (w.doorState(i.id, c.id) === 'exit') out.push([i.id, c.id]);
  }
  return out;
}

describe('coop: копии мира у игроков лобби', { timeout: 240000 }, () => {
  it('операции разных игроков вперемешку, одна дверь двумя сразу, чекпойнт, новичок с чужим проектом — миры одинаковы', async () => {
    const { hub, url, close } = await startCoopServer({ port: 0, host: '127.0.0.1' });
    const p = project();
    const mk = (id: string, local: Project, create = false) =>
      new CoopSession({ url, lobby: LOBBY, player: { id, name: id, color: '#e8b04b' }, local: () => local, ...(create ? { create: { walk: { ...DEFAULT_WALK, seed: 'кооп-тест' }, project: p } } : {}) });

    const A = mk('A', p, true);
    await until(() => A.status === 'online');
    expect(A.isHost).toBe(true);
    const B = mk('B', p);
    await until(() => B.status === 'online');
    expect(B.walk!.world.startId).toBe(A.walk!.world.startId);
    expect([...A.players.keys()]).toEqual(['B']);

    // оба входят в стартовую; одну и ту же дверь открывают оба сразу — второму та же комната
    const start = A.walk!.world.startId!;
    await Promise.all([A.request({ k: 'enter', id: start }), B.request({ k: 'enter', id: start })]);
    const [i0, c0] = exits(A)[0];
    const [ra, rb] = await Promise.all([A.request({ k: 'door', inst: i0, conn: c0 }), B.request({ k: 'door', inst: i0, conn: c0 })]);
    expect(ra).toBeTruthy();
    expect(rb).toBe(ra);
    // разные двери и входы вперемешку
    await Promise.all([A.request({ k: 'enter', id: ra! }), B.request({ k: 'enter', id: ra! })]);
    const more = exits(B);
    expect(more.length).toBeGreaterThan(0);
    const rc = await B.request({ k: 'door', inst: more[0][0], conn: more[0][1] });
    expect(rc).toBeTruthy();
    await Promise.all([B.request({ k: 'enter', id: rc! }), A.request({ k: 'enter', id: start })]);
    await until(() => A.lastSeq === B.lastSeq && A.lastSeq >= 8);
    expect(noTime(B.walk!.world.save())).toEqual(noTime(A.walk!.world.save()));
    expect(B.walk!.fingerprint()).toBe(A.walk!.fingerprint());
    expect(B.walk!.openedList().sort()).toEqual(A.walk!.openedList().sort());

    // чекпойнт хоста; дальше — ещё операции
    A.checkpointNow();
    await until(() => hub.lobbies.get(LOBBY)?.cp?.seq === A.lastSeq);
    const tail = exits(A);
    const rd = await A.request({ k: 'door', inst: tail[0][0], conn: tail[0][1] });
    if (rd) await A.request({ k: 'enter', id: rd });

    // новичок с изменённым проектом: хэш не совпал — скачивает проект лобби; мир — чекпойнт + хвост журнала
    const pc = project();
    pc.rooms[0].name += ' (правка)';
    const C = mk('C', pc);
    await until(() => C.status === 'online' && C.lastSeq === A.lastSeq && B.lastSeq === A.lastSeq);
    expect(C.project!.rooms[0].name).toBe(p.rooms[0].name);
    expect(noTime(C.walk!.world.save())).toEqual(noTime(A.walk!.world.save()));
    expect(noTime(B.walk!.world.save())).toEqual(noTime(A.walk!.world.save()));
    expect(C.walk!.fingerprint()).toBe(A.walk!.fingerprint());
    expect(A.diverged + B.diverged + C.diverged).toBe(0);
    // новичок рядом с другим игроком (их положения сервер помнит)
    A.sendState({ room: rc!, p: [1, 1.6, -2], yaw: 0.5, pitch: 0, loc: null, fps: true });
    const D = mk('D', p);
    await until(() => D.status === 'online');
    expect(D.spawnPoint()).toMatchObject({ room: rc, pos: [1, 1.6, -2] });

    // хост вышел — хостом стал следующий; его чекпойнт принимается
    A.leave();
    await until(() => B.isHost);
    await B.request({ k: 'enter', id: start });
    B.checkpointNow();
    await until(() => hub.lobbies.get(LOBBY)?.cp?.seq === B.lastSeq);
    for (const s of [B, C, D]) s.leave();
    await close();
  });
});
