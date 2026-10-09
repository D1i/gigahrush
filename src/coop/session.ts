// Кооп «Прогулки» (docs/COOP.md): клиент лобби — соединение с relay-сервером и копия мира.
//
//  • Копия мира — WalkSession в режиме WalkSource (не из localStorage): чекпойнт лобби (или мир сида с нуля) + журнал
//    операций. Операции мира (WorldOp) игрок не применяет сам: request → сервер нумерует → приходят всем, включая
//    автора, → apply по порядку seq. Генерация детерминирована по сиду и истории раскрытий — копии одинаковы.
//  • Проект: у лобби — проект создателя (JSON) и хэш. Свой совпал по хэшу — берётся свой, иначе скачивается.
//  • Хост (первый из подключённых) раз в 20 с шлёт чекпойнт — сохранение мира на seq; его отпечаток сервер рассылает
//    остальным: не совпал со своим на том же seq — копия разошлась, пересборка из чекпойнта.
//  • Обрыв: переподключение с since = последний seq (сервер присылает пропущенное); не вышло продолжить — копия
//    собирается заново из чекпойнта (worldVer растёт — страница пересоздаёт сцену).
import { parseProject, serializeProject } from '../model/serialize';
import type { Project } from '../model/types';
import { WalkSession, type WalkOptions, type WorldOp } from '../view3d/walk';
import { COOP_PROTO, hashText, type ClientMsg, type LobbyMeta, type PlayerAct, type PlayerInfo, type PlayerState, type SeqOp, type ServerMsg, type Welcome } from './protocol';

export type CoopStatus = 'connecting' | 'syncing' | 'online' | 'reconnecting' | 'closed' | 'error';

export interface CoopPlayer {
  id: string;
  name: string;
  color: string;
}

export interface CoopStartOptions {
  url: string;
  lobby: string;
  player: CoopPlayer;
  /** создать лобби: мир — эти настройки прогулки и этот проект (иначе — войти в существующее) */
  create?: { walk: WalkOptions; project: Project };
  /** свой проект — для сверки с проектом лобби по хэшу */
  local: () => Project;
  /** для тестов (Node) */
  WebSocket?: typeof WebSocket;
}

/** Операция мира, пришедшая с сервера: mine — своя. */
export interface CoopOpEvent {
  seq: number;
  op: WorldOp;
  from: string;
  mine: boolean;
}

/** Чекпойнт — раз в столько, мс (если с прошлого были операции). */
const CHECKPOINT_MS = 20000;
/** Отпечатки мира по seq — столько последних (сверка с чекпойнтом хоста). */
const FP_KEEP = 400;
/** Ошибки сервера, после которых не переподключаемся. */
const FATAL = new Set(['version', 'bad', 'exists', 'no-lobby', 'replaced', 'full']);

/** Проект в JSON — так же, как его видит лобби (хэш — по этой строке). */
export const projectJSON = (p: Project): string => JSON.stringify(serializeProject(p));

export class CoopSession {
  status: CoopStatus = 'connecting';
  error: string | null = null;
  readonly lobby: string;
  readonly url: string;
  readonly me: CoopPlayer;
  meta: LobbyMeta | null = null;
  /** проект лобби (мир строится по нему) и его хэш */
  project: Project | null = null;
  private projectHash: string | null = null;
  /** копия мира (null — ещё не собрана) */
  walk: WalkSession | null = null;
  /** растёт при каждой пересборке копии мира */
  worldVer = 0;
  host: string | null = null;
  /** другие игроки в лобби (подключённые) */
  readonly players = new Map<string, PlayerInfo>();
  /** последний применённый seq */
  lastSeq = 0;
  /** сколько раз копия расходилась с хостом (сверка по чекпойнту) — для QA */
  diverged = 0;
  readonly beforeOp = new Set<(e: CoopOpEvent) => void>();
  readonly afterOp = new Set<(e: CoopOpEvent, res: string | null) => void>();
  /** другой игрок сделал что-то со мной (act: dig — откапывает засыпанного) */
  readonly onAct = new Set<(from: string, a: PlayerAct) => void>();
  /** временное событие от другого игрока (fx): k — вид, d — данные (JSON ≤ 2 КБ) */
  readonly onFx = new Set<(from: string, k: string, d: unknown) => void>();

  private ws: WebSocket | null = null;
  private readonly WS: typeof WebSocket;
  private readonly create: { meta: LobbyMeta; json: string; hash: string } | null;
  private readonly local: () => Project;
  private welcomed = false;
  private fresh = false;
  private retry = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private cpTimer: ReturnType<typeof setInterval> | null = null;
  private reqSeq = 0;
  private readonly pending = new Map<number, (r: string | null) => void>();
  private outbox: ClientMsg[] = [];
  /** операции, пришедшие во время сборки копии */
  private queue: SeqOp[] = [];
  private syncing = false;
  private projectWait: ((json: string) => void) | null = null;
  private readonly fps = new Map<number, string>();
  private cpSeq = 0;
  private closed = false;

  constructor(
    o: CoopStartOptions,
    private readonly changed: () => void = () => {},
  ) {
    this.lobby = o.lobby.trim().toLowerCase();
    this.url = o.url;
    this.me = { ...o.player };
    this.local = o.local;
    this.WS = o.WebSocket ?? WebSocket;
    if (o.create) {
      const { seed, ...walk } = o.create.walk;
      const json = projectJSON(o.create.project);
      this.create = { meta: { seed, walk, by: o.player.name, created: Date.now() }, json, hash: hashText(json) };
    } else this.create = null;
    this.connect();
    this.cpTimer = setInterval(() => this.checkpointNow(), CHECKPOINT_MS);
  }

  /** Хост ли этот игрок (его чекпойнты принимает сервер). */
  get isHost(): boolean {
    return this.host === this.me.id;
  }

  // ───────────────────────── соединение ─────────────────────────

  private connect() {
    if (this.closed) return;
    let ws: WebSocket;
    try {
      ws = new this.WS(this.url);
    } catch (e) {
      this.fail(`Неверный адрес сервера ${this.url}: ${String((e as Error)?.message ?? e)}`);
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      const resume = this.welcomed && !!this.walk && !this.fresh;
      this.raw({
        t: 'hello',
        v: COOP_PROTO,
        lobby: this.lobby,
        player: this.me,
        // лобби создаётся один раз; при переподключении — уже вход
        ...(this.create && !this.welcomed ? { create: { meta: this.create.meta, project: this.create.json, projectHash: this.create.hash } } : {}),
        ...(resume ? { since: this.lastSeq } : {}),
      });
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      let m: ServerMsg;
      try {
        m = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      this.handle(m);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.onClose();
    };
    ws.onerror = () => {};
  }

  private onClose() {
    if (this.closed) return;
    if (!this.welcomed) {
      this.fail(`Нет связи с сервером ${this.url} — запущен ли он? (npm run dev или npm run coop-server)`);
      return;
    }
    this.status = 'reconnecting';
    this.changed();
    const ms = Math.min(10000, 500 * 2 ** this.retry++);
    this.retryTimer = setTimeout(() => this.connect(), ms);
  }

  private fail(text: string) {
    this.error = text;
    this.status = 'error';
    this.stop();
    this.changed();
  }

  private raw(m: ClientMsg): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1) return false;
    ws.send(JSON.stringify(m));
    return true;
  }

  /** Копия разошлась (или пропуск в журнале) — переподключиться и собрать копию из чекпойнта заново. */
  private resync() {
    this.fresh = true;
    const ws = this.ws;
    this.ws = null;
    try {
      ws?.close();
    } catch {}
    this.status = 'reconnecting';
    this.changed();
    this.connect();
  }

  // ───────────────────────── сообщения ─────────────────────────

  private handle(m: ServerMsg) {
    switch (m.t) {
      case 'welcome':
        void this.onWelcome(m);
        return;
      case 'op':
        if (this.syncing) this.queue.push(m);
        else this.applyOp(m);
        return;
      case 'state': {
        const p = this.players.get(m.id);
        if (p) p.state = m.s;
        return;
      }
      case 'act':
        for (const f of this.onAct) f(m.from, m.a);
        return;
      case 'fx':
        for (const f of this.onFx) f(m.from, m.k, m.d);
        return;
      case 'join':
        this.players.set(m.player.id, m.player);
        this.changed();
        return;
      case 'leave':
        this.players.delete(m.id);
        this.changed();
        return;
      case 'host':
        this.host = m.id;
        this.changed();
        return;
      case 'sync': {
        const mine = this.fps.get(m.seq);
        if (mine !== undefined && mine !== m.fp && !this.syncing) {
          console.warn(`coop: копия мира разошлась с хостом на seq ${m.seq} (${mine} ≠ ${m.fp}) — пересборка из чекпойнта`);
          this.diverged++;
          this.resync();
        }
        return;
      }
      case 'project':
        this.projectWait?.(m.json);
        this.projectWait = null;
        return;
      case 'error':
        if (FATAL.has(m.code)) this.fail(m.text);
        else console.warn('coop:', m.text);
        return;
    }
  }

  private async onWelcome(w: Welcome) {
    this.welcomed = true;
    this.retry = 0;
    this.host = w.host;
    this.meta = w.meta;
    this.players.clear();
    for (const p of w.players) this.players.set(p.id, p);
    if (w.resumed && this.walk && !this.fresh) {
      // продолжение: пропущенные операции и всё, что накопилось без связи
      for (const op of w.ops) this.applyOp(op);
      const out = this.outbox;
      this.outbox = [];
      for (const m of out) this.raw(m);
      this.status = 'online';
      this.changed();
      return;
    }
    // копия — заново: чекпойнт + журнал (операции во время сборки — в очередь)
    this.fresh = false;
    this.syncing = true;
    this.queue = [...w.ops];
    this.status = 'syncing';
    this.changed();
    for (const r of this.pending.values()) r(null);
    this.pending.clear();
    this.outbox = [];
    try {
      if (!this.project || this.projectHash !== w.projectHash) {
        const json = await this.projectFor(w.projectHash);
        if (this.closed) return;
        this.project = parseProject(JSON.parse(json));
        this.projectHash = w.projectHash;
      }
      const cp = w.checkpoint;
      const { seed, ...rest } = w.meta.walk as WalkOptions;
      void seed;
      const walk = new WalkSession(this.project, { ...rest, seed: w.meta.seed }, { save: cp ? JSON.parse(cp.save) : null, opened: cp?.opened ?? [], key: `room-forge/coop/${this.lobby}` });
      if (walk.world.stale) {
        walk.dispose();
        throw new Error('мир лобби не собрался по его проекту: ' + walk.world.warnings.join(' '));
      }
      this.walk?.dispose();
      this.walk = walk;
      walk.sink = (op) => this.request(op);
      this.lastSeq = cp?.seq ?? 0;
      this.fps.clear();
      this.fps.set(this.lastSeq, walk.fingerprint());
      if (cp && cp.fp !== this.fps.get(this.lastSeq)) console.warn(`coop: мир из чекпойнта ${cp.seq} — отпечаток ${this.fps.get(this.lastSeq)}, у хоста ${cp.fp}`);
      this.cpSeq = this.lastSeq;
      this.syncing = false;
      const q = this.queue.sort((a, b) => a.seq - b.seq);
      this.queue = [];
      for (const op of q) this.applyOp(op);
      this.worldVer++;
      this.status = 'online';
      this.changed();
    } catch (e) {
      console.error(e);
      this.syncing = false;
      this.fail('Не удалось собрать мир лобби: ' + String((e as Error)?.message ?? e));
    }
  }

  /** Проект лобби: свой (по хэшу) или скачанный. */
  private projectFor(hash: string): Promise<string> {
    if (this.create && this.create.hash === hash) return Promise.resolve(this.create.json);
    const own = projectJSON(this.local());
    if (hashText(own) === hash) return Promise.resolve(own);
    return new Promise((res) => {
      this.projectWait = res;
      this.raw({ t: 'project' });
    });
  }

  private applyOp(rec: SeqOp) {
    const walk = this.walk;
    if (!walk || rec.seq <= this.lastSeq) return;
    if (rec.seq !== this.lastSeq + 1) {
      console.warn(`coop: пропуск в журнале (${this.lastSeq} → ${rec.seq}) — пересборка`);
      this.resync();
      return;
    }
    const e: CoopOpEvent = { seq: rec.seq, op: rec.op, from: rec.from, mine: rec.from === this.me.id };
    for (const f of this.beforeOp) f(e);
    const res = walk.apply(rec.op);
    this.lastSeq = rec.seq;
    this.fps.set(rec.seq, walk.fingerprint());
    if (this.fps.size > FP_KEEP) this.fps.delete(this.fps.keys().next().value!);
    if (e.mine) {
      this.pending.get(rec.req)?.(res);
      this.pending.delete(rec.req);
    }
    for (const f of this.afterOp) f(e, res);
  }

  // ───────────────────────── для игры ─────────────────────────

  /** Операция мира через сервер: результат — когда она вернулась и применена (null — не вышло / нет связи). */
  request(op: WorldOp): Promise<string | null> {
    if (this.closed || this.status === 'error') return Promise.resolve(null);
    const req = ++this.reqSeq;
    const msg: ClientMsg = { t: 'op', req, op };
    return new Promise((res) => {
      this.pending.set(req, res);
      if (this.status !== 'online' || !this.raw(msg)) this.outbox.push(msg);
    });
  }

  /** Действие над другим игроком (dig — откапывать засыпанного); без связи — не уходит. */
  act(to: string, a: PlayerAct) {
    if (this.status === 'online') this.raw({ t: 'act', to, a });
  }

  /** Временное событие всем остальным в лобби (без журнала мира и без досылки опоздавшим): k ≤ 16 символов, d — JSON
   *  ≤ 2 КБ (больше — сервер отбросит). Без связи — не уходит. */
  fx(k: string, d: unknown) {
    if (this.status === 'online') this.raw({ t: 'fx', k, d });
  }

  /** Положение своего игрока (ретранслируется остальным). */
  sendState(s: PlayerState) {
    if (this.status === 'online') this.raw({ t: 'state', s });
  }

  /** Хост: сохранение мира на последнем seq (если с прошлого были операции); само — раз в CHECKPOINT_MS. */
  checkpointNow() {
    const walk = this.walk;
    if (!walk || this.status !== 'online' || !this.isHost || this.lastSeq <= this.cpSeq) return;
    try {
      const save = JSON.stringify(walk.world.save());
      if (this.raw({ t: 'checkpoint', seq: this.lastSeq, save, opened: walk.openedList(), fp: this.fps.get(this.lastSeq) ?? walk.fingerprint() })) this.cpSeq = this.lastSeq;
    } catch (e) {
      console.error(e);
    }
  }

  /** Где стать при входе: своё место в этом лобби (после перезагрузки) или рядом с другим игроком; null — старт мира. */
  spawnPoint(): { room: string; pos: [number, number, number]; rot: [number, number, number] } | null {
    const walk = this.walk;
    if (!walk) return null;
    const own = walk.loadPlayer();
    if (own) return own;
    const has = (id: string) => walk.rx.instances.some((i) => i.id === id);
    for (const p of this.players.values()) {
      const s = p.state;
      if (s?.room && !s.loc && has(s.room)) return { room: s.room, pos: [...s.p], rot: [s.pitch, s.yaw, 0] };
    }
    return null;
  }

  private stop() {
    this.closed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.cpTimer) clearInterval(this.cpTimer);
    this.retryTimer = this.cpTimer = null;
    for (const r of this.pending.values()) r(null);
    this.pending.clear();
    this.projectWait = null;
    const ws = this.ws;
    this.ws = null;
    try {
      ws?.close();
    } catch {}
  }

  /** Выйти из лобби: хост напоследок сохраняет мир на сервере (остальные продолжат с него). */
  leave() {
    if (this.closed) return;
    if (this.status === 'online') {
      this.checkpointNow();
      this.raw({ t: 'bye' });
    }
    this.stop();
    this.walk?.dispose();
    this.walk = null;
    if (this.status !== 'error') this.status = 'closed';
    this.changed();
  }
}
