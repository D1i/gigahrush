// Мост Steam (tools/steam-bridge.mjs) без Steam: туннель поверх тестовой сети (createLoopbackNet) вместо P2P Steam,
// настоящие локальные WebSocket-мосты и настоящие клиенты коопа (src/coop/session.ts).
import { describe, expect, it } from 'vitest';
import { createCoopHub } from './coop-server.mjs';
import { PART, clientRelay, createLoopbackNet, createTunnelClient, createTunnelHost, dataFrames, hostRelay, startBridgeHttp } from './steam-bridge.mjs';
import { createDefaultProject } from '../src/data/presets';
import { DEFAULT_WALK } from '../src/view3d/walk';
import { CoopSession } from '../src/coop/session';

const LOBBY = '7c2e9a10-4b3d-4e5f-8a6b-1c2d3e4f5a6b';

async function until(f, ms = 60000) {
  const t0 = Date.now();
  while (!f()) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 15));
  }
}
const project = () => {
  const p = createDefaultProject();
  p.finishes ??= [];
  p.finishRules ??= [];
  return p;
};
const noTime = (s) => ({ ...s, savedAt: 0, run: { ...s.run, ms: 0 } });

/** Закрытые выходы копии мира. */
function exits(co) {
  const w = co.walk.world;
  const out = [];
  for (const i of w.run().instances) {
    const room = co.project.rooms.find((r) => r.id === i.roomId);
    for (const c of room.connectors) if (w.doorState(i.id, c.id) === 'exit') out.push([i.id, c.id]);
  }
  return out;
}

describe('мост Steam: туннель', { timeout: 240000 }, () => {
  it('кадры: большое сообщение режется на части по PART и собирается обратно', () => {
    const text = 'ж'.repeat(Math.round(PART * 1.3));
    const fr = dataFrames(7, text);
    expect(fr.length).toBe(3);
    expect(fr.every((b) => b.length <= PART + 16)).toBe(true);
    expect(dataFrames(7, '{}').length).toBe(1);
  });

  it('хост + 3 игрока через туннель: миры одинаковы, проект 2.6 МБ кусками, пятому — «лобби заполнено», уход и обрыв', async () => {
    const net = createLoopbackNet();
    const hub = createCoopHub();
    const host = await startBridgeHttp({ port: 0, onWs: hostRelay(hub), status: () => ({ app: 'room-forge-steam', role: 'host' }) });
    const th = createTunnelHost({ transport: net.peer('H'), hub });
    const clients = [];
    for (const id of ['C1', 'C2', 'C3']) {
      const tc = createTunnelClient({ transport: net.peer(id), host: 'H' });
      const http = await startBridgeHttp({ port: 0, onWs: clientRelay(() => tc), status: () => ({ role: 'client' }) });
      clients.push({ id, tc, http, url: `ws://127.0.0.1:${http.port}/coop` });
    }
    // состояние моста — игре (CORS)
    const st = await fetch(`http://127.0.0.1:${host.port}/steam`);
    expect(st.headers.get('access-control-allow-origin')).toBe('*');
    expect(await st.json()).toMatchObject({ app: 'room-forge-steam', role: 'host' });

    const p = project();
    const mk = (id, url, local = p, create = false) =>
      new CoopSession({ url, lobby: LOBBY, player: { id, name: id, color: '#e8b04b' }, local: () => local, ...(create ? { create: { walk: { ...DEFAULT_WALK, seed: 'steam-тест' }, project: p } } : {}) });

    // хост — прямо в хаб; игроки — каждый через свой мост и туннель
    const A = mk('A', `ws://127.0.0.1:${host.port}/coop`, p, true);
    await until(() => A.status === 'online');
    const B = mk('B', clients[0].url);
    // C с другим проектом — скачает проект лобби (~2.6 МБ) через туннель частями
    const pc = project();
    pc.rooms[0].name += ' (правка)';
    const C = mk('C', clients[1].url, pc);
    const D = mk('D', clients[2].url);
    await until(() => [B, C, D].every((s) => s.status === 'online'));
    expect(C.project.rooms[0].name).toBe(p.rooms[0].name);
    expect(th.peers).toBe(3);

    // операции от разных игроков вперемешку
    const start = A.walk.world.startId;
    await Promise.all([A.request({ k: 'enter', id: start }), B.request({ k: 'enter', id: start }), D.request({ k: 'enter', id: start })]);
    const [i0, c0] = exits(C)[0];
    const [ra, rc] = await Promise.all([A.request({ k: 'door', inst: i0, conn: c0 }), C.request({ k: 'door', inst: i0, conn: c0 })]);
    expect(ra).toBeTruthy();
    expect(rc).toBe(ra);
    await Promise.all([B.request({ k: 'enter', id: ra }), C.request({ k: 'enter', id: ra })]);
    await until(() => [B, C, D].every((s) => s.lastSeq === A.lastSeq) && A.lastSeq >= 6);
    for (const s of [B, C, D]) expect(noTime(s.walk.world.save())).toEqual(noTime(A.walk.world.save()));
    // положение — через туннель
    B.sendState({ room: ra, p: [1, 1.6, 2], yaw: 0, pitch: 0, loc: null, fps: true });
    await until(() => A.players.get('B')?.state?.room === ra);

    // пятый (второе окно игрока D) — мест нет
    const E = mk('E', clients[2].url);
    await until(() => E.status === 'error');
    expect(E.error).toMatch(/заполнено/);
    expect(A.players.size).toBe(3);

    // игрок вышел из лобби Steam — у остальных пропал
    th.dropPeer('C1');
    await until(() => !A.players.has('B'));
    // связь с хостом оборвалась (P2P) — игра переподключается сама, мир продолжается
    clients[1].tc.hostGone();
    await until(() => C.status === 'reconnecting' || C.status === 'online');
    await A.request({ k: 'enter', id: ra });
    await until(() => C.status === 'online' && C.lastSeq === A.lastSeq, 30000);
    expect(noTime(C.walk.world.save())).toEqual(noTime(A.walk.world.save()));

    for (const s of [A, B, C, D, E]) s.leave();
    th.close();
    for (const c of clients) {
      c.tc.close();
      await c.http.close();
    }
    await host.close();
  });
});
