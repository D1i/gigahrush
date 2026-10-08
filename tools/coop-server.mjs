// Кооп «Прогулки» (docs/COOP.md): relay-сервер лобби. Без зависимостей — свой WebSocket (RFC 6455).
//
//  • Лобби — по UUID. Создатель присылает мету мира (сид, настройки прогулки), проект (JSON) и его хэш; остальные
//    входят по UUID (проект скачивают, только если их собственный не совпал по хэшу).
//  • Операции мира (вход в комнату, открыть дверь, спуск по лестнице, выход лифта) сервер нумерует (seq) и рассылает
//    ВСЕМ, включая автора: каждый клиент применяет их к своей копии мира в одном порядке — миры одинаковы (генерация
//    детерминирована по сиду и истории раскрытий). Свою операцию автор тоже применяет, только когда она вернулась.
//  • Чекпойнт: хост (первый из подключённых) раз в ~20 с присылает сохранение мира на seq — журнал до него сервер
//    забывает; новичок получает чекпойнт + журнал после него. Отпечаток мира на seq уходит остальным — сверка копий.
//  • Положения игроков ретранслируются как есть (последнее помнится — для новичков и переподключений).
//  • Обрыв связи: клиент переподключается с since = последний seq — получает только пропущенное.
//  • Лобби без игроков живёт ttl (30 мин), потом забывается.
//
// Запуск отдельно: `npm run coop-server` (node tools/coop-server.mjs [--port 8787]) — relay на /coop и, если есть
// собранный dist/index.html, сама игра на /. В `npm run dev` тот же relay висит на пути /coop dev-сервера (vite.config.ts).
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Версия протокола (src/coop/protocol.ts — COOP_PROTO). */
export const COOP_PROTO = 1;
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
/** Предел сообщения: проект с текстурами ~1.5 МБ, сохранение мира — сотни КБ. */
const MAX_MSG = 64 * 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLOR_RE = /^#[0-9a-f]{6}$/i;
const MAX_OP = 4096;
const MAX_STATE = 2048;

const str = (v, max) => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null);

/**
 * Лобби и их журналы — без сокетов (тесты гоняют его напрямую). connect(send, close) — новое соединение: send(obj)
 * отправляет сообщение, close() закрывает; возвращает { receive(obj), drop() } — входящее сообщение и обрыв.
 */
export function createCoopHub(o = {}) {
  const now = o.now ?? Date.now;
  const ttl = o.ttlMs ?? 30 * 60 * 1000;
  const log = o.log ?? (() => {});
  /** @type {Map<string, any>} */
  const lobbies = new Map();

  const connected = (L) => [...L.players.values()].filter((p) => p.conn);
  const info = (p) => ({ id: p.id, name: p.name, color: p.color, state: p.state });
  const broadcast = (L, msg, except = null) => {
    for (const p of L.players.values()) if (p.conn && p !== except) p.conn.send(msg);
  };
  /** Хост — первый по порядку входа из подключённых (его чекпойнты принимаются). */
  const pickHost = (L) => {
    const cur = L.host && L.players.get(L.host);
    if (cur?.conn) return;
    const next = connected(L).sort((a, b) => a.order - b.order)[0] ?? null;
    L.host = next?.id ?? null;
    if (next) broadcast(L, { t: 'host', id: next.id });
  };

  function connect(send, close) {
    let L = null;
    let me = null;
    const conn = { send };
    const fail = (code, text) => {
      send({ t: 'error', code, text });
      close();
    };

    function hello(m) {
      if (m.v !== COOP_PROTO) return fail('version', `Версия протокола клиента ${m.v}, сервера ${COOP_PROTO} — обновите страницу/сервер`);
      const lobby = str(m.lobby, 64);
      if (!lobby || !UUID_RE.test(lobby)) return fail('bad', 'Код лобби — UUID вида xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx');
      const id = str(m.player?.id, 64);
      if (!id) return fail('bad', 'Нет id игрока');
      const name = (str(m.player?.name, 200) ?? 'Игрок').trim().slice(0, 40) || 'Игрок';
      const color = COLOR_RE.test(m.player?.color ?? '') ? m.player.color : '#e8b04b';
      const key = lobby.toLowerCase();
      let lob = lobbies.get(key);
      if (m.create) {
        if (lob) return fail('exists', 'Лобби с таким UUID уже есть — подключитесь к нему');
        const c = m.create;
        if (!c.meta || typeof c.meta !== 'object' || typeof c.meta.seed !== 'string') return fail('bad', 'Нет меты мира');
        if (typeof c.project !== 'string' || typeof c.projectHash !== 'string') return fail('bad', 'Нет проекта');
        lob = { id: key, meta: c.meta, project: c.project, projectHash: c.projectHash, seq: 0, ops: [], cp: null, players: new Map(), host: null, emptyAt: null, orders: 0, created: now() };
        lobbies.set(key, lob);
        log(`лобби ${key} создано (${name}), сид «${c.meta.seed}», проект ${(c.project.length / 1024).toFixed(0)} КБ`);
      } else if (!lob) return fail('no-lobby', 'Лобби не найдено (UUID неверный или сервер перезапускался)');
      const old = lob.players.get(id);
      if (old?.conn && old.conn !== conn) {
        // тот же игрок с другой вкладки / после обрыва, который сервер ещё не заметил — старое соединение закрыть
        old.conn.send({ t: 'error', code: 'replaced', text: 'Вы вошли в это лобби из другого окна' });
        old.conn.kick?.();
        old.conn = null;
      }
      me = old ?? { id, order: lob.orders++, state: null };
      me.name = name;
      me.color = color;
      me.conn = conn;
      lob.players.set(id, me);
      lob.emptyAt = null;
      L = lob;
      pickHost(L);
      const base = L.cp?.seq ?? 0;
      const since = Number.isInteger(m.since) ? m.since : -1;
      const resumed = since >= base && since <= L.seq;
      send({
        t: 'welcome',
        you: id,
        host: L.host,
        lobby: L.id,
        meta: L.meta,
        projectHash: L.projectHash,
        seq: L.seq,
        resumed,
        checkpoint: resumed ? null : L.cp,
        ops: resumed ? L.ops.filter((x) => x.seq > since) : L.ops,
        players: connected(L).filter((p) => p !== me).map(info),
      });
      broadcast(L, { t: 'join', player: info(me) }, me);
      log(`лобби ${L.id}: ${name} ${old ? 'вернулся' : 'вошёл'} (${connected(L).length} в игре)`);
    }

    function leave(bye) {
      if (!L || !me || me.conn !== conn) return;
      me.conn = null;
      if (bye) L.players.delete(me.id);
      broadcast(L, { t: 'leave', id: me.id });
      if (L.host === me.id) pickHost(L);
      if (!connected(L).length) L.emptyAt = now();
      log(`лобби ${L.id}: ${me.name} вышел (${connected(L).length} в игре)`);
    }

    conn.receive = (m) => {
      if (!m || typeof m !== 'object' || typeof m.t !== 'string') return;
      if (m.t === 'hello') {
        if (!L) hello(m);
        return;
      }
      if (!L || !me || me.conn !== conn) return;
      switch (m.t) {
        case 'op': {
          if (!m.op || typeof m.op !== 'object' || typeof m.op.k !== 'string' || JSON.stringify(m.op).length > MAX_OP) return;
          const rec = { seq: ++L.seq, from: me.id, req: Number.isInteger(m.req) ? m.req : 0, op: m.op };
          L.ops.push(rec);
          broadcast(L, { t: 'op', ...rec });
          return;
        }
        case 'state': {
          if (!m.s || typeof m.s !== 'object' || JSON.stringify(m.s).length > MAX_STATE) return;
          me.state = m.s;
          broadcast(L, { t: 'state', id: me.id, s: m.s }, me);
          return;
        }
        case 'checkpoint': {
          if (L.host !== me.id || !Number.isInteger(m.seq) || m.seq <= (L.cp?.seq ?? 0) || m.seq > L.seq) return;
          if (typeof m.save !== 'string' || !Array.isArray(m.opened) || typeof m.fp !== 'string') return;
          L.cp = { seq: m.seq, save: m.save, opened: m.opened.filter((x) => typeof x === 'string'), fp: m.fp };
          L.ops = L.ops.filter((x) => x.seq > m.seq);
          broadcast(L, { t: 'sync', seq: m.seq, fp: m.fp }, me);
          return;
        }
        case 'project':
          send({ t: 'project', json: L.project });
          return;
        case 'bye':
          leave(true);
          close();
          return;
      }
    };
    conn.drop = () => leave(false);
    conn.kick = close;
    return conn;
  }

  /** Забыть лобби, где никого нет дольше ttl. */
  function gc() {
    const t = now();
    for (const [id, L] of lobbies) {
      if (L.emptyAt !== null && t - L.emptyAt > ttl) {
        lobbies.delete(id);
        log(`лобби ${id} забыто (пусто ${Math.round((t - L.emptyAt) / 60000)} мин)`);
      }
    }
  }

  return { connect, gc, lobbies };
}

// ───────────────────────── WebSocket (RFC 6455, только то, что нужно) ─────────────────────────

/** Серверный конец WebSocket поверх сокета после рукопожатия: текстовые сообщения, ping/pong, close. */
function wrapSocket(socket, head) {
  const ws = { onmessage: null, onclose: null, send, close };
  let chunks = head && head.length ? [Buffer.from(head)] : [];
  let total = chunks[0]?.length ?? 0;
  let frag = null;
  let closed = false;
  let alive = true;
  socket.setNoDelay(true);

  const finish = () => {
    if (closed) return;
    closed = true;
    clearInterval(ping);
    socket.destroy();
    ws.onclose?.();
  };
  // живость: ping раз в 25 с; не ответил на прошлый — соединение мёртвое
  const ping = setInterval(() => {
    if (!alive) return finish();
    alive = false;
    frame(0x9, Buffer.alloc(0));
  }, 25000);
  ping.unref?.();

  function frame(op, payload) {
    if (closed || socket.destroyed) return;
    const n = payload.length;
    const h = n < 126 ? Buffer.alloc(2) : n < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
    h[0] = 0x80 | op;
    if (n < 126) h[1] = n;
    else if (n < 65536) {
      h[1] = 126;
      h.writeUInt16BE(n, 2);
    } else {
      h[1] = 127;
      h.writeBigUInt64BE(BigInt(n), 2);
    }
    socket.cork();
    socket.write(h);
    if (n) socket.write(payload);
    socket.uncork();
  }
  function send(text) {
    frame(0x1, Buffer.from(text, 'utf8'));
  }
  function close(code = 1000) {
    if (closed) return;
    const b = Buffer.alloc(2);
    b.writeUInt16BE(code, 0);
    frame(0x8, b);
    socket.end();
    setTimeout(finish, 500).unref?.();
  }
  /** Первый кусок буфера — не короче n байт (склеить начало, не весь буфер: большие сообщения склеиваются один раз). */
  function headBytes(n) {
    if (chunks[0].length >= n || chunks.length === 1) return chunks[0];
    let k = 0, s = 0;
    while (k < chunks.length && s < n) s += chunks[k++].length;
    const merged = Buffer.concat(chunks.slice(0, k), s);
    chunks.splice(0, k, merged);
    return merged;
  }
  function take(n) {
    const buf = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, total);
    const rest = buf.subarray(n);
    chunks = rest.length ? [rest] : [];
    total = rest.length;
    return buf.subarray(0, n);
  }
  function parse() {
    while (!closed && total >= 2) {
      const h = headBytes(14);
      const fin = (h[0] & 0x80) !== 0, op = h[0] & 0x0f, masked = (h[1] & 0x80) !== 0;
      let len = h[1] & 0x7f, off = 2;
      if (len === 126) {
        if (h.length < 4) return;
        len = h.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (h.length < 10) return;
        const big = h.readBigUInt64BE(2);
        if (big > BigInt(MAX_MSG)) return close(1009);
        len = Number(big);
        off = 10;
      }
      // кадры клиента обязаны быть замаскированы
      if (!masked) return close(1002);
      if (len > MAX_MSG) return close(1009);
      const need = off + 4 + len;
      if (total < need) return;
      const f = take(need);
      const mask = f.subarray(off, off + 4);
      const data = Buffer.from(f.subarray(off + 4));
      for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
      onFrame(fin, op, data);
    }
  }
  function onFrame(fin, op, data) {
    alive = true;
    if (op === 0x8) return close(data.length >= 2 ? data.readUInt16BE(0) : 1000);
    if (op === 0x9) return frame(0xa, data);
    if (op === 0xa) return;
    if (op === 0x1 || op === 0x2) {
      if (frag) return close(1002);
      if (fin) return deliver(data);
      frag = { parts: [data], size: data.length };
      return;
    }
    if (op === 0x0) {
      if (!frag) return close(1002);
      frag.parts.push(data);
      frag.size += data.length;
      if (frag.size > MAX_MSG) return close(1009);
      if (fin) {
        const all = Buffer.concat(frag.parts, frag.size);
        frag = null;
        deliver(all);
      }
      return;
    }
    close(1002);
  }
  function deliver(buf) {
    try {
      ws.onmessage?.(buf.toString('utf8'));
    } catch (e) {
      console.error('coop: ошибка обработки сообщения', e);
    }
  }
  socket.on('data', (d) => {
    chunks.push(d);
    total += d.length;
    parse();
  });
  socket.on('close', finish);
  socket.on('error', finish);
  socket.on('end', () => setTimeout(finish, 0));
  queueMicrotask(parse);
  return ws;
}

/**
 * Повесить relay на http-сервер (свой или dev-сервер Vite): WebSocket-апгрейды на path обслуживает хаб, остальные
 * (HMR Vite) не трогаются. Возвращает хаб.
 */
export function attachCoopRelay(server, o = {}) {
  const path = o.path ?? '/coop';
  const hub = o.hub ?? createCoopHub({ log: o.log });
  server.on('upgrade', (req, socket, head) => {
    let url;
    try {
      url = new URL(req.url ?? '/', 'http://x');
    } catch {
      return;
    }
    if (url.pathname !== path) return;
    const key = req.headers['sec-websocket-key'];
    if (String(req.headers.upgrade ?? '').toLowerCase() !== 'websocket' || typeof key !== 'string') {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }
    const accept = createHash('sha1').update(key + GUID).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const ws = wrapSocket(socket, head);
    const conn = hub.connect(
      (m) => ws.send(JSON.stringify(m)),
      () => ws.close(),
    );
    ws.onmessage = (text) => {
      let m;
      try {
        m = JSON.parse(text);
      } catch {
        return;
      }
      conn.receive(m);
    };
    ws.onclose = () => conn.drop();
  });
  if (!hub.gcTimer) {
    hub.gcTimer = setInterval(() => hub.gc(), 60000);
    hub.gcTimer.unref?.();
  }
  return hub;
}

// ───────────────────────── отдельный запуск ─────────────────────────

const DIST = fileURLToPath(new URL('../dist/index.html', import.meta.url));

/**
 * Relay на своём http-сервере: WebSocket на /coop и, если есть собранный dist/index.html, сама игра на / (друзья
 * открывают http://<ваш IP>:порт/). Порт 0 — любой свободный (тесты, QA).
 */
export async function startCoopServer(o = {}) {
  const host = o.host ?? '0.0.0.0';
  const server = createServer((req, res) => {
    if ((req.url === '/' || req.url === '/index.html') && existsSync(DIST)) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(readFileSync(DIST));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`Room Forge coop relay (протокол ${COOP_PROTO}). WebSocket: /coop${existsSync(DIST) ? '' : '. Игры здесь нет — соберите её: npm run build'}
`);
  });
  const hub = attachCoopRelay(server, { log: o.log });
  await new Promise((r) => server.listen(o.port ?? 8787, host, () => r()));
  const port = server.address().port;
  const local = host === '0.0.0.0' ? 'localhost' : host;
  return {
    hub,
    port,
    url: `ws://${local}:${port}/coop`,
    game: existsSync(DIST) ? `http://${local}:${port}/` : null,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (k) => {
    const i = process.argv.indexOf(k);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const s = await startCoopServer({ port: Number(arg('--port') ?? process.env.COOP_PORT ?? 8787), log: (t) => console.log(new Date().toLocaleTimeString(), t) });
  console.log(`coop relay: ${s.url}${s.game ? ` · игра: ${s.game}` : ''}`);
}
