// Протокол кооп-лобби (docs/COOP.md): сообщения клиент ↔ relay-сервер (tools/coop-server.mjs), JSON по WebSocket.
import type { WalkOptions, WorldOp } from '../view3d/walk';

/** Версия протокола — та же, что COOP_PROTO сервера (tools/coop-server.mjs: hello с другой — ошибка version).
 *  2 — операции мира drop/pick (предметы на полу), суффикс отпечатка мира, PlayerState.torch. */
export const COOP_PROTO = 2;

/** Мир лобби: сид и настройки прогулки создателя (проект — отдельно, по хэшу). */
export interface LobbyMeta {
  seed: string;
  walk: Omit<WalkOptions, 'seed'>;
  /** кто и когда создал */
  by: string;
  created: number;
}

/** Где игрок: комната мира (её ведёт портальный рендер), камера (Babylon), спец-локация (своя сцена) или null. */
export interface PlayerState {
  room: string | null;
  /** позиция камеры (глаза), Babylon */
  p: [number, number, number];
  yaw: number;
  pitch: number;
  /** в сцене спец-локации (лифт, лестница…) — её вид; аватар в мире не показывается */
  loc: string | null;
  /** от первого лица (в облёте аватар стоит, где был) */
  fps: boolean;
  /** глаза над полом, м (нет — 1.6: стоя; в снежных лазах — ползком ~0.5, скрючившись ~1.15) */
  eye?: number;
  /** засыпан обвалом в снегу — напарник рядом может откапывать (E) */
  buried?: boolean;
  /** держит горящий фонарь (биом «Общага»: свет у аватара, защитное поле вокруг p) */
  lamp?: 1;
  /** в руке горящий фонарик (хотбар «Прогулки», src/view3d/inventory.ts): у аватара — фонарь и луч по взгляду */
  torch?: 1;
  /** погиб (утащила рука и т. п.) — аватар не показывается, до возрождения */
  dead?: 1;
  /** «меченый» (лут: пузырь, Inventory.fx.marked) — твари выбирают его первым (общага: агро руки) */
  mk?: 1;
}

/** Действие игрока над другим игроком (адресное, без журнала мира): dig — откапывать засыпанного, durak — сыграть в
 *  дурака (карты, src/view3d/inventory.ts: у обоих партия, потом лечение). */
export type PlayerAct = 'dig' | 'durak';

export interface PlayerInfo {
  id: string;
  name: string;
  color: string;
  /** место в лобби (0…3, наименьшее свободное при входе; сервер постарше — нет): цвет шинели аватара */
  slot?: number;
  state: PlayerState | null;
}

/** Операция мира с номером сервера: from — id игрока, req — номер запроса у автора. */
export interface SeqOp {
  seq: number;
  from: string;
  req: number;
  op: WorldOp;
}

/** Сохранение мира лобби на seq (StreamSave в JSON), открытые выходы и отпечаток мира. */
export interface Checkpoint {
  seq: number;
  save: string;
  opened: string[];
  fp: string;
}

export type ClientMsg =
  | {
      t: 'hello';
      v: number;
      lobby: string;
      player: { id: string; name: string; color: string };
      /** создать лобби (иначе — войти в существующее) */
      create?: { meta: LobbyMeta; project: string; projectHash: string };
      /** переподключение: последний применённый seq — сервер пришлёт только пропущенное */
      since?: number;
    }
  | { t: 'op'; req: number; op: WorldOp }
  | { t: 'state'; s: PlayerState }
  /** действие над игроком to (сервер передаёт только ему) */
  | { t: 'act'; to: string; a: PlayerAct }
  /** событие для всех остальных в лобби — без номера и журнала (мигание света, рука, позы дверей); опоздавшим не
   *  досылается — шлющий (обычно хост) повторяет состояние сам */
  | { t: 'fx'; k: string; d: unknown }
  | { t: 'checkpoint'; seq: number; save: string; opened: string[]; fp: string }
  | { t: 'project' }
  | { t: 'bye' };

export interface Welcome {
  t: 'welcome';
  you: string;
  host: string | null;
  lobby: string;
  meta: LobbyMeta;
  projectHash: string;
  seq: number;
  /** true — пришли только операции после since (мир копии продолжается); false — чекпойнт + журнал после него */
  resumed: boolean;
  checkpoint: Checkpoint | null;
  ops: SeqOp[];
  players: PlayerInfo[];
}

export type ServerMsg =
  | Welcome
  | ({ t: 'op' } & SeqOp)
  | { t: 'state'; id: string; s: PlayerState }
  | { t: 'act'; from: string; a: PlayerAct }
  | { t: 'fx'; from: string; k: string; d: unknown }
  | { t: 'join'; player: PlayerInfo }
  | { t: 'leave'; id: string }
  | { t: 'host'; id: string }
  | { t: 'sync'; seq: number; fp: string }
  | { t: 'project'; json: string }
  | { t: 'error'; code: string; text: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Код лобби — UUID. */
export const isLobbyId = (s: string): boolean => UUID_RE.test(s.trim());

export function newLobbyId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  // без crypto.randomUUID (страница не из безопасного контекста) — UUID v4 из getRandomValues / Math.random
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Хэш строки (cyrb53, 53 бита) — отпечаток проекта: совпал — свой проект годится, иначе скачать у лобби. */
export function hashText(s: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0') + ':' + s.length.toString(36);
}

/** Мост Steam (tools/steam-bridge.mjs) — GET /steam: хост (сервер лобби у себя) или игрок (туннель к хосту). */
export interface SteamBridgeStatus {
  app: 'room-forge-steam';
  v: number;
  role: 'host' | 'client';
  /** лобби Steam есть (хост создал / игрок вошёл) */
  ready: boolean;
  error: string | null;
  steam: { lobby: string | null; me: string; host: string | null; members: number; max: number };
  /** игровое лобби (UUID) — хост публикует его в данных лобби Steam */
  game: { lobby: string | null };
}

/** Где искать мост Steam: адрес из поля «Сервер» (мост с --port N), страница с него самого и localhost:8787. */
export function steamBridgeBases(server = ''): string[] {
  const out: string[] = [];
  if (server.trim()) {
    try {
      const u = new URL(normServerUrl(server));
      out.push(`${u.protocol === 'wss:' ? 'https' : 'http'}://${u.host}`);
    } catch {}
  }
  const l = typeof location !== 'undefined' ? location : null;
  if (l && (l.protocol === 'http:' || l.protocol === 'https:') && !out.includes(`${l.protocol}//${l.host}`)) out.push(`${l.protocol}//${l.host}`);
  if (!out.includes('http://localhost:8787')) out.push('http://localhost:8787');
  return out;
}

/** WebSocket коопа моста по его http-адресу. */
export const bridgeWsUrl = (base: string): string => base.replace(/^http/, 'ws') + '/coop';

/** Адрес relay по умолчанию: dev-сервер / сервер, с которого открыта игра (путь /coop); из файла — localhost:8787. */
export function defaultServerUrl(): string {
  const l = typeof location !== 'undefined' ? location : null;
  if (l && (l.protocol === 'http:' || l.protocol === 'https:')) return `${l.protocol === 'https:' ? 'wss' : 'ws'}://${l.host}/coop`;
  return 'ws://localhost:8787/coop';
}

/** «ws://host:port/coop» из того, что ввёл игрок: «host:port», «http://host:port» и т. п. */
export function normServerUrl(s: string): string {
  let u = s.trim();
  if (!u) return defaultServerUrl();
  if (/^https?:\/\//i.test(u)) u = u.replace(/^http/i, 'ws');
  if (!/^wss?:\/\//i.test(u)) u = 'ws://' + u;
  try {
    const url = new URL(u);
    if (url.pathname === '/' || url.pathname === '') url.pathname = '/coop';
    return url.toString();
  } catch {
    return u;
  }
}
