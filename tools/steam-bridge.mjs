// Кооп через Steam (docs/COOP.md §4): мост между игрой в браузере и Steamworks SDK (steamworks.js, AppID 480 — Spacewar,
// тестовое приложение Valve). Игра в браузере говорит с мостом по WebSocket на localhost, мост — со Steam.
//
//  • Хост («сервер»): `npm run steam -- host` — сервер лобби (хаб tools/coop-server.mjs) у себя и лобби Steam на
//    MAX_PLAYERS (4) места. Игра хоста подключается к хабу напрямую (ws://localhost:8787/coop), игроки — туннелем Steam.
//  • Игрок: `npm run steam -- join <id лобби Steam>` (или без id — и «Присоединиться к игре» у хоста в списке друзей Steam):
//    вход в лобби Steam, локальный ws://localhost:8787/coop — каждое соединение игры уходит туннелем к хосту.
//  • Туннель — P2P Steam (SteamNetworking, надёжные пакеты, ретрансляторы Steam: NAT и проброс портов не нужны). Кадр:
//    тип, номер соединения, часть/частей; сообщения больше PART режутся (у Steam предел пакета — 1 МБ, проект — ~2.6 МБ).
//    Протокол коопа поверх — тот же JSON, что по обычному WebSocket.
//  • Игре мост сообщает о себе: GET /steam (CORS) — роль, лобби Steam, код игрового лобби (хост публикует его в данных
//    лобби Steam: rf_lobby), — модалка «Онлайн» показывает кнопку «Создать / Подключиться через Steam».
//  • Мост отдаёт и собранную игру (dist/index.html) на / — можно играть с http://localhost:8787/.
// Запуск: Steam запущен и выполнен вход; `npm run steam -- host [--port 8787] [--friends] [--lan]`,
// `npm run steam -- join [<id>] [--port 8787] [--lan]`. Тесты туннеля без Steam — tools/steam-bridge.test.mjs.
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { COOP_PROTO, MAX_PLAYERS, attachWsServer, createCoopHub, hubConn } from './coop-server.mjs';

/** Spacewar — тестовое приложение Steamworks (свой AppID — когда игра будет в Steam). */
export const STEAM_APP_ID = 480;
/** Часть сообщения в пакете туннеля, байт (надёжный пакет Steam — до 1 МБ). */
export const PART = 256 * 1024;
/** Кадры туннеля. */
const T_OPEN = 1, T_DATA = 2, T_CLOSE = 3, T_PING = 4;
const HEAD = 9;
/** Пинг игрока хосту, мс; молчит дольше PEER_TIMEOUT_MS — соединения игрока закрываются. */
const PING_MS = 5000;
const PEER_TIMEOUT_MS = 30000;
/** Ключи данных лобби Steam. */
const K_TAG = 'rf', K_GAME = 'rf_lobby', K_HOST = 'rf_host', K_VER = 'rf_ver';

// ───────────────────────── кадры туннеля ─────────────────────────

function frame(type, conn, idx = 0, count = 1, payload = null) {
  const b = Buffer.alloc(HEAD + (payload?.length ?? 0));
  b[0] = type;
  b.writeUInt32BE(conn >>> 0, 1);
  b.writeUInt16BE(idx, 5);
  b.writeUInt16BE(count, 7);
  if (payload) payload.copy(b, HEAD);
  return b;
}

/** Текст → кадры данных (части по PART байт). */
export function dataFrames(conn, text) {
  const all = Buffer.from(text, 'utf8');
  const count = Math.max(1, Math.ceil(all.length / PART));
  if (count > 0xffff) throw new Error('сообщение слишком большое для туннеля');
  const out = [];
  for (let i = 0; i < count; i++) out.push(frame(T_DATA, conn, i, count, all.subarray(i * PART, (i + 1) * PART)));
  return out;
}

function parse(buf) {
  if (!buf || buf.length < HEAD) return null;
  return { type: buf[0], conn: buf.readUInt32BE(1), idx: buf.readUInt16BE(5), count: buf.readUInt16BE(7), payload: buf.subarray(HEAD) };
}

/** Сборка частей (пакеты надёжные и по порядку): часть idx — следующая; последняя — текст целиком. */
function assembler() {
  let parts = [];
  return (f) => {
    if (f.idx === 0) parts = [];
    parts.push(Buffer.from(f.payload));
    if (f.idx < f.count - 1) return null;
    const text = Buffer.concat(parts).toString('utf8');
    parts = [];
    return text;
  };
}

// ───────────────────────── хост: туннель → хаб ─────────────────────────

/**
 * Хост туннеля: соединения игроков (peer — их SteamID) — соединения хаба лобби. transport: { send(peer, buf),
 * onPacket(cb(peer, buf)) }. dropPeer(peer) — игрок ушёл (вышел из лобби Steam, сессия P2P оборвалась).
 */
export function createTunnelHost({ transport, hub, log = () => {}, now = Date.now }) {
  /** peer → (conn → { hub-соединение, сборка }) */
  const peers = new Map();
  const seen = new Map();
  const send = (peer, buf) => transport.send(peer, buf);
  const dropConn = (peer, id) => {
    const c = peers.get(peer)?.get(id);
    if (!c) return;
    peers.get(peer).delete(id);
    c.conn.drop();
  };
  transport.onPacket((peer, buf) => {
    const f = parse(buf);
    if (!f) return;
    seen.set(peer, now());
    if (f.type === T_PING) return;
    let m = peers.get(peer);
    if (f.type === T_OPEN) {
      if (!m) {
        peers.set(peer, (m = new Map()));
        log(`игрок ${peer} подключился через Steam`);
      }
      dropConn(peer, f.conn);
      const conn = hubConn(
        hub,
        (text) => {
          for (const b of dataFrames(f.conn, text)) send(peer, b);
        },
        () => {
          // хаб закрыл (ошибка, выход) — игроку «закрыто», у себя — забыть
          send(peer, frame(T_CLOSE, f.conn));
          if (m.get(f.conn)?.conn === conn) m.delete(f.conn);
        },
      );
      m.set(f.conn, { conn, add: assembler() });
      return;
    }
    const c = m?.get(f.conn);
    if (!c) return;
    if (f.type === T_DATA) {
      const text = c.add(f);
      if (text !== null) c.conn.receive(text);
    } else if (f.type === T_CLOSE) dropConn(peer, f.conn);
  });
  const dropPeer = (peer) => {
    seen.delete(peer);
    const m = peers.get(peer);
    if (!m) return;
    for (const id of [...m.keys()]) dropConn(peer, id);
    peers.delete(peer);
    log(`игрок ${peer} отключился`);
  };
  // молчит — ушёл (вылетел без выхода из лобби)
  const timer = setInterval(() => {
    const t = now();
    for (const [peer, at] of seen) if (t - at > PEER_TIMEOUT_MS) dropPeer(peer);
  }, 5000);
  timer.unref?.();
  return {
    dropPeer,
    get peers() {
      return peers.size;
    },
    close() {
      clearInterval(timer);
      for (const p of [...peers.keys()]) dropPeer(p);
    },
  };
}

// ───────────────────────── игрок: соединения игры → туннель ─────────────────────────

/**
 * Игрок туннеля: open() — новое соединение к хабу хоста (host — SteamID хоста): { send(text), close(), onmessage, onclose }.
 * hostGone() — хост пропал: все соединения закрываются (игра переподключится, когда хост вернётся / сменится).
 */
export function createTunnelClient({ transport, host, log = () => {} }) {
  const conns = new Map();
  let next = 1;
  transport.onPacket((peer, buf) => {
    if (peer !== host) return;
    const f = parse(buf);
    const c = f && conns.get(f.conn);
    if (!c) return;
    if (f.type === T_DATA) {
      const text = c.add(f);
      if (text !== null) c.v.onmessage?.(text);
    } else if (f.type === T_CLOSE) {
      conns.delete(f.conn);
      c.v.onclose?.();
    }
  });
  const ping = setInterval(() => transport.send(host, frame(T_PING, 0)), PING_MS);
  ping.unref?.();
  return {
    open() {
      const id = next++;
      const v = {
        onmessage: null,
        onclose: null,
        send(text) {
          if (!conns.has(id)) return;
          for (const b of dataFrames(id, text)) transport.send(host, b);
        },
        close() {
          if (!conns.delete(id)) return;
          transport.send(host, frame(T_CLOSE, id));
        },
      };
      conns.set(id, { v, add: assembler() });
      transport.send(host, frame(T_OPEN, id));
      return v;
    },
    hostGone() {
      for (const [id, c] of [...conns]) {
        conns.delete(id);
        c.v.onclose?.();
      }
      log('хост пропал — соединения игры закрыты');
    },
    /** открытых соединений игры */
    get size() {
      return conns.size;
    },
    close() {
      clearInterval(ping);
      for (const c of conns.values()) c.v.close();
    },
  };
}

// ───────────────────────── локальный сервер для игры ─────────────────────────

const DIST = fileURLToPath(new URL('../dist/index.html', import.meta.url));

/**
 * HTTP на localhost: GET /steam — состояние моста для игры (CORS), / — собранная игра (если есть), WebSocket /coop —
 * onWs(ws). bind: '127.0.0.1' (только этот компьютер) или '0.0.0.0' (--lan).
 */
export async function startBridgeHttp({ port = 8787, bind = '127.0.0.1', status, onWs }) {
  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if (path === '/steam') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
      res.end(JSON.stringify(status()));
      return;
    }
    if ((path === '/' || path === '/index.html') && existsSync(DIST)) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(readFileSync(DIST));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`Room Forge — мост Steam (протокол ${COOP_PROTO}). Состояние: /steam, WebSocket: /coop${existsSync(DIST) ? '' : '. Игры здесь нет — npm run build или npm run dev'}\n`);
  });
  attachWsServer(server, '/coop', onWs);
  await new Promise((res, rej) => {
    server.once('error', rej);
    server.listen(port, bind, () => res());
  });
  return { server, port: server.address().port, close: () => new Promise((r) => server.close(() => r())) };
}

/** Хост без Steam (тесты, а в Steam — его хаб): хаб на MAX_PLAYERS, локальный WS — прямо в хаб. */
export function hostRelay(hub) {
  return (ws) => {
    const conn = hubConn(hub, (t) => ws.send(t), () => ws.close());
    ws.onmessage = (text) => conn.receive(text);
    ws.onclose = () => conn.drop();
  };
}

/** Игрок: каждое локальное соединение игры — соединение туннеля к хосту. */
export function clientRelay(getTunnel) {
  return (ws) => {
    const t = getTunnel();
    if (!t) {
      ws.close(1013);
      return;
    }
    const v = t.open();
    v.onmessage = (text) => ws.send(text);
    v.onclose = () => ws.close();
    ws.onmessage = (text) => v.send(text);
    ws.onclose = () => v.close();
  };
}

// ───────────────────────── тестовая сеть (без Steam) ─────────────────────────

/** Сеть из транспортов в одном процессе: peer(id) — транспорт узла; доставка — асинхронно, по порядку. */
export function createLoopbackNet() {
  const nodes = new Map();
  return {
    peer(id) {
      const handlers = [];
      nodes.set(id, handlers);
      return {
        me: id,
        send(to, buf) {
          const h = nodes.get(to);
          if (!h) return false;
          const copy = Buffer.from(buf);
          setImmediate(() => {
            for (const f of h) f(id, copy);
          });
          return true;
        },
        onPacket(cb) {
          handlers.push(cb);
        },
        close() {
          nodes.delete(id);
        },
      };
    },
  };
}

// ───────────────────────── Steam ─────────────────────────

/** steamworks.js и Steam: init(AppID 480). Ошибка — понятным текстом (Steam не запущен, нет пакета). */
function initSteam() {
  let sw;
  try {
    sw = createRequire(import.meta.url)('steamworks.js');
  } catch (e) {
    throw new Error(`нет пакета steamworks.js — выполните npm install (${String(e?.message ?? e).split('\n')[0]})`);
  }
  let client;
  try {
    client = sw.init(STEAM_APP_ID);
  } catch (e) {
    throw new Error(`Steam не отвечает — запустите Steam и войдите в аккаунт (${String(e?.message ?? e).split('\n')[0]})`);
  }
  return { client, SteamCallback: sw.SteamCallback };
}

/** Транспорт туннеля поверх P2P Steam: надёжные пакеты, приём сессии — только от тех, кого пускает accept(peer). */
function steamTransport(client, SteamCallback, accept, log) {
  const handlers = [];
  const RELIABLE = 2;
  const pending = new Map();
  const handle = client.callback.register(SteamCallback.P2PSessionRequest, ({ remote }) => {
    const peer = String(remote);
    // участник лобби мог ещё не дойти до списка — подождать до 10 с
    const tryAccept = (k) => {
      if (accept(peer)) {
        client.networking.acceptP2PSession(BigInt(peer));
        pending.delete(peer);
      } else if (k < 20) pending.set(peer, setTimeout(() => tryAccept(k + 1), 500));
      else {
        pending.delete(peer);
        log(`отклонён P2P от ${peer} (не в лобби)`);
      }
    };
    if (!pending.has(peer)) tryAccept(0);
  });
  const poll = setInterval(() => {
    for (let k = 0; k < 1000; k++) {
      const n = client.networking.isP2PPacketAvailable();
      if (!n) break;
      const p = client.networking.readP2PPacket(n);
      const peer = String(p.steamId.steamId64);
      for (const h of handlers) h(peer, p.data);
    }
  }, 4);
  return {
    send: (peer, buf) => client.networking.sendP2PPacket(BigInt(peer), RELIABLE, buf),
    onPacket: (cb) => handlers.push(cb),
    close() {
      clearInterval(poll);
      handle.disconnect();
      for (const t of pending.values()) clearTimeout(t);
    },
  };
}

const ts = () => new Date().toLocaleTimeString();

/** Хост: хаб + лобби Steam (Public — по id может войти любой; --friends — только друзья) + туннель. */
async function runHost(o) {
  const { client, SteamCallback } = initSteam();
  const me = client.localplayer.getName();
  const log = (s) => console.log(ts(), s);
  let lobby = null;
  const lastGame = () => [...hub.lobbies.values()].sort((a, b) => b.created - a.created)[0]?.id ?? null;
  const status = () => ({
    app: 'room-forge-steam', v: COOP_PROTO, role: 'host', ready: !!lobby, error: null, ws: '/coop',
    steam: { lobby: lobby ? String(lobby.id) : null, me, host: me, members: lobby ? Number(lobby.getMemberCount()) : 1, max: MAX_PLAYERS },
    game: { lobby: lastGame() },
  });
  const hub = createCoopHub({
    log,
    maxPlayers: MAX_PLAYERS,
    onLobby: (L) => {
      // код игрового лобби — в данные лобби Steam: мосты игроков покажут его игре
      lobby?.setData(K_GAME, L.id);
      log(`игровое лобби ${L.id} опубликовано в лобби Steam`);
    },
  });
  const http = await startBridgeHttp({ port: o.port, bind: o.bind, onWs: hostRelay(hub), status });
  lobby = await client.matchmaking.createLobby(o.friends ? 1 : 2, MAX_PLAYERS);
  lobby.mergeFullData({ [K_TAG]: '1', [K_VER]: String(COOP_PROTO), [K_HOST]: me });
  const isMember = (peer) => lobby.getMembers().some((m) => String(m.steamId64) === peer);
  const transport = steamTransport(client, SteamCallback, isMember, log);
  const tunnel = createTunnelHost({ transport, hub, log });
  client.callback.register(SteamCallback.LobbyChatUpdate, (e) => {
    if (String(e.lobby) !== String(lobby.id)) return;
    // 0 — вошёл; 1 — вышел, 2 — отключился, 3/4 — выгнан
    if (e.member_state_change !== 0) tunnel.dropPeer(String(e.user_changed));
    else log(`в лобби Steam вошёл ${e.user_changed} (${lobby.getMemberCount()}/${MAX_PLAYERS})`);
  });
  client.localplayer.setRichPresence('status', 'Room Forge — хост кооп-лобби');
  console.log(`\n  Room Forge · сервер через Steam (Spacewar, AppID ${STEAM_APP_ID}), до ${MAX_PLAYERS} игроков`);
  console.log(`  Лобби Steam: ${lobby.id}${o.friends ? ' (только друзья)' : ''}`);
  console.log(`  Друзьям: npm run steam -- join ${lobby.id}   (или «Присоединиться к игре» у вас в списке друзей Steam)`);
  console.log(`  Себе: игра → «3D» → «Подключить онлайн» → «Steam» → «Создать лобби через Steam»`);
  console.log(`  Мост: http://localhost:${http.port}/steam${existsSync(DIST) ? ` · игра: http://localhost:${http.port}/` : ''}\n`);
  return () => {
    tunnel.close();
    transport.close();
    lobby.leave();
    return http.close();
  };
}

/** Игрок: войти в лобби Steam (по id или по приглашению «Присоединиться к игре»), туннель к его владельцу. */
async function runJoin(o) {
  const { client, SteamCallback } = initSteam();
  const me = client.localplayer.getName();
  const log = (s) => console.log(ts(), s);
  let lobby = null;
  let host = null;
  let tunnel = null;
  let transport = null;
  let error = null;
  const status = () => ({
    app: 'room-forge-steam', v: COOP_PROTO, role: 'client', ready: !!tunnel, error, ws: '/coop',
    steam: { lobby: lobby ? String(lobby.id) : null, me, host: lobby?.getData(K_HOST) ?? null, members: lobby ? Number(lobby.getMemberCount()) : 0, max: MAX_PLAYERS },
    game: { lobby: lobby?.getData(K_GAME) || null },
  });
  const http = await startBridgeHttp({ port: o.port, bind: o.bind, onWs: clientRelay(() => tunnel), status });
  const join = async (id) => {
    try {
      tunnel?.hostGone();
      tunnel?.close();
      transport?.close();
      lobby?.leave();
      lobby = await client.matchmaking.joinLobby(BigInt(id));
      if (lobby.getData(K_TAG) !== '1') log('внимание: это не лобби Room Forge (нет метки rf) — подключаюсь всё равно');
      if (lobby.getData(K_VER) && lobby.getData(K_VER) !== String(COOP_PROTO)) log(`внимание: протокол хоста ${lobby.getData(K_VER)}, у вас ${COOP_PROTO} — обновите игру`);
      host = String(lobby.getOwner().steamId64);
      transport = steamTransport(client, SteamCallback, (peer) => peer === host, log);
      tunnel = createTunnelClient({ transport, host, log });
      error = null;
      log(`вошёл в лобби Steam ${lobby.id}, хост — ${lobby.getData(K_HOST) ?? host} (${lobby.getMemberCount()}/${MAX_PLAYERS})`);
      console.log(`  Игра → «3D» → «Подключить онлайн» → «Steam» → «Подключиться через Steam»`);
    } catch (e) {
      error = `не удалось войти в лобби Steam ${id}: ${String(e?.message ?? e)}`;
      log(error);
    }
  };
  client.callback.register(SteamCallback.LobbyChatUpdate, (e) => {
    if (!lobby || String(e.lobby) !== String(lobby.id)) return;
    if (String(e.user_changed) === host && e.member_state_change !== 0) {
      error = 'хост вышел из лобби Steam';
      log(error);
      tunnel?.hostGone();
    }
  });
  client.callback.register(SteamCallback.P2PSessionConnectFail, (e) => {
    if (String(e.remote) !== host) return;
    log(`связь с хостом оборвалась (код ${e.error}) — игра переподключится сама`);
    tunnel?.hostGone();
  });
  // «Присоединиться к игре» в списке друзей Steam
  client.callback.register(SteamCallback.GameLobbyJoinRequested, (e) => void join(String(e.lobby_steam_id)));
  client.localplayer.setRichPresence('status', 'Room Forge — кооп');
  console.log(`\n  Room Forge · игрок через Steam (Spacewar, AppID ${STEAM_APP_ID}) · мост: http://localhost:${http.port}/steam`);
  if (o.lobby) await join(o.lobby);
  else console.log('  Жду приглашения: в Steam — список друзей → хост → «Присоединиться к игре» (или перезапустите с id лобби)\n');
  return () => {
    tunnel?.close();
    transport?.close();
    lobby?.leave();
    return http.close();
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const flag = (k) => args.includes(k);
  const opt = (k) => {
    const i = args.indexOf(k);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const mode = args[0];
  const o = {
    port: Number(opt('--port') ?? process.env.COOP_PORT ?? 8787),
    bind: flag('--lan') ? '0.0.0.0' : '127.0.0.1',
    friends: flag('--friends'),
    lobby: mode === 'join' && args[1] && !args[1].startsWith('--') ? args[1] : null,
  };
  if (mode !== 'host' && mode !== 'join') {
    console.log('Мост Steam для кооп-лобби Room Forge:\n  npm run steam -- host [--port 8787] [--friends] [--lan]\n  npm run steam -- join [<id лобби Steam>] [--port 8787] [--lan]');
    process.exit(2);
  }
  try {
    const stop = await (mode === 'host' ? runHost(o) : runJoin(o));
    const bye = async () => {
      await stop();
      process.exit(0);
    };
    process.on('SIGINT', bye);
    process.on('SIGTERM', bye);
  } catch (e) {
    console.error(`Мост Steam: ${String(e?.message ?? e)}`);
    if (e?.code === 'EADDRINUSE') console.error(`Порт ${o.port} занят — другой мост или сервер уже запущен (--port N — другой)`);
    process.exit(1);
  }
}
