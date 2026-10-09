// Типы relay-сервера кооп-лобби (tools/coop-server.mjs) — для тестов на TypeScript.
// http.Server — без @types/node: достаточно on(...)
type Server = { on(ev: string, cb: (...a: any[]) => void): unknown };

export declare const COOP_PROTO: number;

export interface CoopConn {
  send(msg: unknown): void;
  receive(msg: unknown): void;
  drop(): void;
}

export interface CoopHub {
  connect(send: (msg: any) => void, close: () => void): CoopConn;
  gc(): void;
  lobbies: Map<string, any>;
}

export declare const MAX_PLAYERS: number;
export declare function createCoopHub(o?: { now?: () => number; ttlMs?: number; log?: (s: string) => void; maxPlayers?: number; onLobby?: (lobby: any) => void }): CoopHub;
export declare function attachCoopRelay(server: Server, o?: { path?: string; hub?: CoopHub; log?: (s: string) => void }): CoopHub;

export declare function startCoopServer(o?: { port?: number; host?: string; log?: (s: string) => void }): Promise<{
  hub: CoopHub;
  port: number;
  url: string;
  game: string | null;
  close(): Promise<void>;
}>;
