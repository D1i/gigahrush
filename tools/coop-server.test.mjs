// Relay-сервер кооп-лобби (tools/coop-server.mjs): хаб лобби без сокетов и настоящий WebSocket (клиент — WebSocket Node).
import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { COOP_PROTO, attachCoopRelay, createCoopHub } from './coop-server.mjs';

const LOBBY = '0b3c1f6e-2d4a-4c8e-9f10-a1b2c3d4e5f6';
const meta = { seed: 'кооп', walk: { clusters: true }, by: 'A', created: 1 };

/** Клиент хаба: что пришло, закрыт ли. */
function client(hub) {
  const c = { got: [], closed: false };
  c.conn = hub.connect((m) => c.got.push(m), () => (c.closed = true));
  c.send = (m) => c.conn.receive(m);
  c.last = (t) => [...c.got].reverse().find((m) => m.t === t);
  c.all = (t) => c.got.filter((m) => m.t === t);
  return c;
}
const hello = (id, o = {}) => ({ t: 'hello', v: COOP_PROTO, lobby: LOBBY, player: { id, name: id, color: '#112233' }, ...o });
const create = { meta, project: '{"p":1}', projectHash: 'h1' };

describe('coop: хаб лобби', () => {
  it('создать, войти, операции — по порядку всем (и автору), состояние — остальным', () => {
    const hub = createCoopHub();
    const a = client(hub);
    a.send(hello('A', { create }));
    const wa = a.last('welcome');
    expect(wa).toMatchObject({ you: 'A', host: 'A', meta, projectHash: 'h1', seq: 0, checkpoint: null, ops: [], players: [] });
    const b = client(hub);
    b.send(hello('B'));
    expect(b.last('welcome')).toMatchObject({ you: 'B', host: 'A', players: [{ id: 'A', name: 'A' }] });
    expect(a.last('join').player.id).toBe('B');

    a.send({ t: 'op', req: 1, op: { k: 'enter', id: 'i0' } });
    b.send({ t: 'op', req: 7, op: { k: 'door', inst: 'i0', conn: 'c1' } });
    a.send({ t: 'op', req: 2, op: { k: 'enter', id: 'i1' } });
    for (const c of [a, b]) {
      expect(c.all('op').map((o) => [o.seq, o.from, o.req, o.op.k])).toEqual([
        [1, 'A', 1, 'enter'],
        [2, 'B', 7, 'door'],
        [3, 'A', 2, 'enter'],
      ]);
    }
    a.send({ t: 'state', s: { room: 'i1', p: [1, 1.6, 2], yaw: 0, pitch: 0, loc: null, fps: true } });
    expect(b.last('state')).toMatchObject({ id: 'A', s: { room: 'i1' } });
    expect(a.last('state')).toBeUndefined();
    // адресное действие — только адресату
    const c = client(hub);
    c.send(hello('C'));
    a.send({ t: 'act', to: 'B', a: 'dig' });
    expect(b.last('act')).toEqual({ t: 'act', from: 'A', a: 'dig' });
    expect(c.last('act')).toBeUndefined();
    expect(a.last('act')).toBeUndefined();
    a.send({ t: 'act', to: 'A', a: 'dig' });
    a.send({ t: 'act', to: 'нет-такого', a: 'dig' });
    expect(a.last('act')).toBeUndefined();
    // временное событие (fx) — всем остальным, без журнала; больше 2 КБ — отбрасывается
    b.send({ t: 'fx', k: 'blink', d: { phase: 2 } });
    expect(a.last('fx')).toEqual({ t: 'fx', from: 'B', k: 'blink', d: { phase: 2 } });
    expect(c.last('fx')).toEqual({ t: 'fx', from: 'B', k: 'blink', d: { phase: 2 } });
    expect(b.last('fx')).toBeUndefined();
    b.send({ t: 'fx', k: 'big', d: 'x'.repeat(3000) });
    b.send({ t: 'fx', k: 'слишком-длинный-вид-события', d: 1 });
    expect(a.all('fx').length).toBe(1);
    expect(hub.lobbies.get(LOBBY).ops.length).toBe(3);
    // мусор — молча мимо
    a.send({ t: 'op', op: 'x' });
    a.send({ t: 'nope' });
    a.send(null);
    expect(b.all('op').length).toBe(3);
  });

  it('ошибки: нет лобби, уже есть, версия, не UUID', () => {
    const hub = createCoopHub();
    const x = client(hub);
    x.send(hello('X'));
    expect(x.last('error').code).toBe('no-lobby');
    expect(x.closed).toBe(true);
    const a = client(hub);
    a.send(hello('A', { create }));
    const b = client(hub);
    b.send(hello('B', { create }));
    expect(b.last('error').code).toBe('exists');
    const c = client(hub);
    c.send({ ...hello('C'), v: 999 });
    expect(c.last('error').code).toBe('version');
    const d = client(hub);
    d.send({ ...hello('D'), lobby: 'не-uuid' });
    expect(d.last('error').code).toBe('bad');
  });

  it('чекпойнт: только от хоста, журнал до него забывается, новичку — чекпойнт + хвост; отпечаток — остальным', () => {
    const hub = createCoopHub();
    const a = client(hub);
    a.send(hello('A', { create }));
    const b = client(hub);
    b.send(hello('B'));
    for (let i = 0; i < 5; i++) a.send({ t: 'op', req: i, op: { k: 'enter', id: 'i' + i } });
    // не хост — не принимается
    b.send({ t: 'checkpoint', seq: 3, save: '{}', opened: [], fp: 'f' });
    expect(hub.lobbies.get(LOBBY).cp).toBeNull();
    a.send({ t: 'checkpoint', seq: 3, save: '{"w":3}', opened: ['i0/c1'], fp: 'fp3' });
    expect(b.last('sync')).toEqual({ t: 'sync', seq: 3, fp: 'fp3' });
    expect(hub.lobbies.get(LOBBY).ops.map((o) => o.seq)).toEqual([4, 5]);
    // старый или будущий seq — нет
    a.send({ t: 'checkpoint', seq: 2, save: '{}', opened: [], fp: 'x' });
    a.send({ t: 'checkpoint', seq: 9, save: '{}', opened: [], fp: 'x' });
    expect(hub.lobbies.get(LOBBY).cp.seq).toBe(3);
    const c = client(hub);
    c.send(hello('C'));
    const w = c.last('welcome');
    expect(w.resumed).toBe(false);
    expect(w.checkpoint).toEqual({ seq: 3, save: '{"w":3}', opened: ['i0/c1'], fp: 'fp3' });
    expect(w.ops.map((o) => o.seq)).toEqual([4, 5]);
    // проект — по запросу
    c.send({ t: 'project' });
    expect(c.last('project').json).toBe('{"p":1}');
  });

  it('обрыв и возврат: since — только пропущенное; since до чекпойнта — чекпойнт; хост переходит к следующему', () => {
    const hub = createCoopHub();
    const a = client(hub);
    a.send(hello('A', { create }));
    const b = client(hub);
    b.send(hello('B'));
    a.send({ t: 'op', req: 1, op: { k: 'enter', id: 'i0' } });
    // хост ушёл — хостом стал B
    a.conn.drop();
    expect(b.last('leave').id).toBe('A');
    expect(b.last('host').id).toBe('B');
    b.send({ t: 'op', req: 1, op: { k: 'enter', id: 'i1' } });
    b.send({ t: 'op', req: 2, op: { k: 'enter', id: 'i2' } });
    const a2 = client(hub);
    a2.send(hello('A', { since: 1 }));
    const w = a2.last('welcome');
    expect(w).toMatchObject({ resumed: true, checkpoint: null, host: 'B' });
    expect(w.ops.map((o) => o.seq)).toEqual([2, 3]);
    // чекпойнт на 3 — у кого since 1, тот получает чекпойнт
    b.send({ t: 'checkpoint', seq: 3, save: '{}', opened: [], fp: 'f' });
    a2.conn.drop();
    const a3 = client(hub);
    a3.send(hello('A', { since: 1 }));
    expect(a3.last('welcome')).toMatchObject({ resumed: false, checkpoint: { seq: 3 }, ops: [] });
  });

  it('тот же игрок из второго окна — первое закрывается; пустое лобби забывается через ttl', () => {
    let t = 0;
    const hub = createCoopHub({ now: () => t, ttlMs: 1000 });
    const a = client(hub);
    a.send(hello('A', { create }));
    const a2 = client(hub);
    a2.send(hello('A'));
    expect(a.last('error').code).toBe('replaced');
    expect(a.closed).toBe(true);
    expect(a2.last('welcome').you).toBe('A');
    a2.send({ t: 'bye' });
    t = 500;
    hub.gc();
    expect(hub.lobbies.has(LOBBY)).toBe(true);
    t = 2000;
    hub.gc();
    expect(hub.lobbies.has(LOBBY)).toBe(false);
  });
});

describe('coop: WebSocket', () => {
  it('рукопожатие, текстовые кадры (в т. ч. 2 МБ), рассылка операций двум клиентам', async () => {
    const server = createServer();
    attachCoopRelay(server);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const url = `ws://127.0.0.1:${server.address().port}/coop`;
    const open = (id, extra) =>
      new Promise((res, rej) => {
        const ws = new WebSocket(url);
        const got = [];
        ws.onmessage = (e) => got.push(JSON.parse(e.data));
        ws.onerror = rej;
        ws.onopen = () => {
          ws.send(JSON.stringify(hello(id, extra)));
          res({ ws, got });
        };
      });
    const until = async (f, ms = 5000) => {
      const t0 = Date.now();
      while (!f()) {
        if (Date.now() - t0 > ms) throw new Error('timeout');
        await new Promise((r) => setTimeout(r, 10));
      }
    };
    const big = JSON.stringify({ blob: 'ж'.repeat(1024 * 1024) });
    const a = await open('A', { create: { meta, project: big, projectHash: 'hb' } });
    await until(() => a.got.some((m) => m.t === 'welcome'));
    const b = await open('B');
    await until(() => b.got.some((m) => m.t === 'welcome'));
    b.ws.send(JSON.stringify({ t: 'project' }));
    await until(() => b.got.some((m) => m.t === 'project'));
    expect(b.got.find((m) => m.t === 'project').json).toBe(big);
    a.ws.send(JSON.stringify({ t: 'op', req: 5, op: { k: 'enter', id: 'i0' } }));
    await until(() => a.got.some((m) => m.t === 'op') && b.got.some((m) => m.t === 'op'));
    expect(b.got.find((m) => m.t === 'op')).toMatchObject({ seq: 1, from: 'A', req: 5 });
    a.ws.close();
    await until(() => b.got.some((m) => m.t === 'leave'));
    b.ws.close();
    await new Promise((r) => server.close(r));
  });

  it('чужой путь (HMR Vite) не трогает', async () => {
    const server = createServer();
    attachCoopRelay(server);
    let other = 0;
    server.on('upgrade', (req, socket) => {
      if (req.url !== '/coop') {
        other++;
        socket.destroy();
      }
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/hmr`);
    await new Promise((r) => {
      ws.onerror = r;
      ws.onclose = r;
    });
    expect(other).toBe(1);
    await new Promise((r) => server.close(r));
  });
});
