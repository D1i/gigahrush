// «Прогулка» во вкладке «3D»: бесконечный складчатый мир (src/gen4d/stream.ts) от первого лица.
//
//  • Мир растёт по мере ходьбы: при входе в комнату — ensureAround (двери вперёд) и ensureVisible с
//    дальностью горизонта рендера (всё, что может попасть в кадр, — окончательно), поэтому новые комнаты
//    появляются за дверями заранее, до того как их видно; тумана, который прятал бы край, нет.
//  • Рендер — портальный (./portal.ts через FoldDriver): мир собран с seamless = false, комнаты в поле
//    зрения могут пересекаться в 3D. Ещё не раскрытая дверь — проём в темноту (метка с флагом cut),
//    заколоченная — дверь-панель.
//  • JSON прогона для болванки (RunExport) собирается по мере роста: экземпляр экспортируется один раз
//    (экземпляры мира не меняются), у старых меняются только связи меток и «раскрыта ли дверь».
//  • Автосохранение мира в localStorage по worldKey (сид + модификаторы) и отдельно — позиции игрока:
//    после перезагрузки страницы прогулка продолжается с того же места.
//  • Режим квартир (WalkOptions.clusters, настройки — Project.world, docs/GENERATOR-4D.md §16): мир растёт квартирами,
//    закрытый выход квартиры — дверь-панель (метка с флагом exit), её открывает игрок (openDoor); исчезнувшие двери и
//    лишние проёмы квартиры — стены; вход в комнату — счётчик переходов (world.enter).
//  • Двери (docs/DOORS.md): открытые игроком выходы помнятся (метка с флагом opened — полотно остаётся у этой комнаты,
//    распахнутым); список — в localStorage рядом с позицией игрока.
//  • Биом старта (WalkOptions.biome): мир начинается в выбранном биоме (WorldSettings.startBiome поверх проекта); у
//    каждого биома — свой мир сида и своё сохранение (ключ с модификатором «биом:id»), переключение — без потери прогулки.
//  • Операции мира (WorldOp: вход в комнату, открыть дверь, спуск, выход лифта) — через request(op): в одиночной игре
//    применяются сразу, в коопе (docs/COOP.md, src/coop/) уходят на сервер лобби (sink) и применяются apply(op) у всех
//    игроков в одном порядке — копии мира одинаковы. Кооп-мир не пишется в localStorage (WalkSource).
import {
  DEFAULT_STREAM, DEFAULT_STREAM_FOLD, createStreamWorld, streamSettings, viewHorizonM, worldKey,
  type EnterResult, type StreamSave, type StreamSettings, type StreamStats, type StreamWorld,
} from '../gen4d/stream';
import { exportRunJSON } from '../gen/world';
import { startBiomeOf } from '../gen4d/biomes';
import type { LiftSide, Project, WorldSettings } from '../model/types';
import type { RunExport, RunFinish, RunInstance } from '../blockout/types';

/** Операция, меняющая мир прогулки. Детерминирована: тот же мир + та же операция → тот же мир. */
export type WorldOp =
  /** игрок вошёл в комнату: счётчик переходов, раскрыть двери вперёд и всё, что может попасть в кадр */
  | { k: 'enter'; id: string }
  /** открыть закрытый выход квартиры → id комнаты за дверью */
  | { k: 'door'; inst: string; conn: string }
  /** спуск из спец-локации (лестница) → id комнаты-выхода */
  | { k: 'descend'; id: string }
  /** выход лифта → id комнаты за выходом */
  | { k: 'ascend'; id: string; floor: number; side: LiftSide }
  /** обвал снежного хода у метки (src/locations/snowCollapse.ts) → inst, если завалило */
  | { k: 'collapse'; inst: string; conn: string };

/** Мир не из localStorage (кооп): снимок лобби, открытые двери; key — ключ позиции игрока в localStorage. */
export interface WalkSource {
  save: StreamSave | null;
  opened: string[];
  key: string;
}

export interface WalkOptions {
  seed: string;
  /** вероятность, что нераскрытая дверь окажется заколоченной, 0…1 */
  deadEndChance: number;
  /** ветвистость (множитель веса развилок) */
  branching: number;
  /** на сколько дверей вперёд мир раскрыт */
  aheadDoors: number;
  /** режим квартир: биомы, квартиры с дверями-выходами, переходы (настройки — Project.world); false — прежний рост */
  clusters: boolean;
  /** режим квартир: биом, в котором начинается мир (id); null — стартовый биом проекта (Project.world.startBiome) */
  biome: string | null;
}

/** Биом старта прогулки, отличный от стартового биома проекта (он и есть в проекте), иначе null — мир проекта как есть. */
export function walkBiome(p: Project, opts: Pick<WalkOptions, 'biome' | 'clusters'>): string | null {
  const w = p.world;
  if (!opts.clusters || !w || !opts.biome || !w.biomes.some((b) => b.id === opts.biome && !b.rich)) return null;
  return opts.biome === startBiomeOf(w)?.id ? null : opts.biome;
}

/** Мир прогулки: настройки проекта, старт — в выбранном биоме. */
function walkWorld(p: Project, opts: Pick<WalkOptions, 'biome' | 'clusters'>): WorldSettings | null {
  if (!opts.clusters || !p.world) return null;
  const b = walkBiome(p, opts);
  return b ? { ...p.world, startBiome: b } : p.world;
}

/** Модификаторы ключа сохранения: у мира с квартирами — «квартиры», у старта в другом биоме — ещё «биом:id». */
function walkMods(p: Project, opts: Pick<WalkOptions, 'biome' | 'clusters'>): string[] {
  if (!opts.clusters) return [];
  const b = walkBiome(p, opts);
  return b ? ['квартиры', `биом:${b}`] : ['квартиры'];
}

/**
 * Настройки бесконечного мира «Прогулки»: зазор, стыковка, стартовая комната — из «Генератора»; складки 4D, предел
 * обзора и «вперёд дверей» — из «Бесконечного мира» (Project.world.walk); в прежнем росте (без квартир) «вперёд дверей»,
 * тупики и ветвистость — из панели прогулки.
 */
export function walkStreamSettings(p: Project, opts: Pick<WalkOptions, 'seed' | 'deadEndChance' | 'branching' | 'aheadDoors' | 'clusters'> & Partial<Pick<WalkOptions, 'biome'>>): StreamSettings {
  const g = p.generator;
  const wk = p.world?.walk;
  return streamSettings(opts.seed, {
    gap: g.gap,
    match: g.match,
    sightM: wk ? wk.sightM : g.sightM > 0 ? g.sightM : DEFAULT_STREAM.sightM,
    startRoomId: g.startRoomId,
    deadEndChance: opts.deadEndChance,
    branching: opts.branching,
    aheadDoors: opts.clusters && wk ? wk.aheadDoors : opts.aheadDoors,
    ...(wk ? { fold: { ...DEFAULT_STREAM_FOLD, shiftChance: wk.shiftChance, maxShift: wk.maxShift, localRadius: wk.localRadius, localM: wk.localM, maxLayer: wk.maxLayer } } : {}),
    world: walkWorld(p, { clusters: opts.clusters, biome: opts.biome ?? null }),
  });
}

export const DEFAULT_WALK: WalkOptions = {
  seed: 'гигахрущ', deadEndChance: DEFAULT_STREAM.deadEndChance, branching: DEFAULT_STREAM.branching, aheadDoors: DEFAULT_STREAM.aheadDoors, clusters: true, biome: null,
};

const WALK_KEY = 'room-forge/walk';

/** Настройки прогулки и «была ли открыта» (переживают перезагрузку страницы). */
export function readWalk(): WalkOptions & { on: boolean } {
  try {
    const o = JSON.parse(localStorage.getItem(WALK_KEY) || '{}');
    return {
      seed: typeof o.seed === 'string' && o.seed ? o.seed : DEFAULT_WALK.seed,
      deadEndChance: Number.isFinite(o.deadEndChance) ? o.deadEndChance : DEFAULT_WALK.deadEndChance,
      branching: Number.isFinite(o.branching) ? o.branching : DEFAULT_WALK.branching,
      aheadDoors: Number.isFinite(o.aheadDoors) ? o.aheadDoors : DEFAULT_WALK.aheadDoors,
      clusters: typeof o.clusters === 'boolean' ? o.clusters : DEFAULT_WALK.clusters,
      biome: typeof o.biome === 'string' && o.biome ? o.biome : null,
      on: o.on === true,
    };
  } catch {
    return { ...DEFAULT_WALK, on: false };
  }
}

export function writeWalk(o: WalkOptions & { on: boolean }) {
  try {
    localStorage.setItem(WALK_KEY, JSON.stringify(o));
  } catch {}
}

/** Позиция игрока в мире: комната (её ведут по порогам) и камера. */
export interface WalkPlayer {
  room: string;
  /** Babylon: позиция и поворот камеры */
  pos: [number, number, number];
  rot: [number, number, number];
  at: number;
}

export interface WalkStatus {
  rooms: number;
  /** заколоченных дверей (по шансу + «не встало») */
  dead: number;
  pending: number;
  layers: number;
  /** последнее сохранение мира: время и размер; error — не удалось (место в localStorage) */
  saved: { at: number; bytes: number } | null;
  error: string | null;
  stale: boolean;
  stats: StreamStats;
}

const playerKey = (key: string): string => key + '/player';
/** открытые игроком выходы («inst/connector») — их двери остаются у комнаты выхода */
const doorsKey = (key: string): string => key + '/doors';

export class WalkSession {
  readonly world: StreamWorld;
  readonly key: string;
  rx: RunExport;
  /** вызывается после роста мира: новый JSON прогона и комнаты, у которых изменились связи/двери */
  onUpdate: ((rx: RunExport, changed: string[]) => void) | null = null;
  private exp = new Map<string, RunInstance>();
  private sig = new Map<string, string>();
  private tables: Pick<RunExport, 'props' | 'items' | 'finishes'> & { tiers: NonNullable<RunExport['tiers']> };
  private unsub: () => void;
  private queued = false;
  private saveTimer = 0;
  private saved: WalkStatus['saved'] = null;
  /** выходы, открытые игроком («inst/connector») */
  private opened = new Set<string>();
  private error: string | null = null;
  private disposed = false;
  /** мир пишется в localStorage (одиночная игра); кооп-мир живёт на сервере лобби */
  private readonly persist: boolean;
  /** кооп: операции уходят сюда (на сервер), результат — когда операция вернулась и применена; null — сразу */
  sink: ((op: WorldOp) => Promise<string | null>) | null = null;

  constructor(
    private readonly p: Project,
    readonly opts: WalkOptions,
    src?: WalkSource,
  ) {
    // режим квартир — свой ключ сохранения (у сида разные миры: без квартир, с квартирами, со стартом в другом биоме)
    this.key = src ? src.key : worldKey(opts.seed, walkMods(p, opts));
    this.persist = !src;
    let save: StreamSave | undefined;
    if (src) save = src.save ?? undefined;
    else {
      try {
        const s = localStorage.getItem(this.key);
        if (s) save = JSON.parse(s) as StreamSave;
      } catch {
        save = undefined;
      }
    }
    const settings = walkStreamSettings(p, opts);
    this.world = createStreamWorld(p, settings, save);
    if (save && !this.world.stale && this.persist) this.saved = { at: save.savedAt, bytes: 0 };
    this.tables = projectTables(p);
    if (!this.world.stale) {
      if (src) for (const k of src.opened) this.opened.add(k);
      else {
        try {
          const list = JSON.parse(localStorage.getItem(doorsKey(this.key)) || '[]');
          if (Array.isArray(list)) for (const k of list) if (typeof k === 'string') this.opened.add(k);
        } catch {}
      }
    }
    this.rx = this.assemble().rx;
    this.unsub = this.world.onChange(() => {
      // раскрытие может сообщать по частям — собрать один раз после всех
      if (this.queued) return;
      this.queued = true;
      queueMicrotask(() => {
        this.queued = false;
        this.refresh();
      });
    });
  }

  /** Игрок в комнате id: раскрыть двери вперёд и всё, что из неё может попасть в кадр (после кадра):
   *  дальность — горизонт портального рендера (viewHorizonM), тумана нет — нераскрытая дверь в кадре была
   *  бы дырой в пустоту. */
  enter(id: string): EnterResult | null {
    // кооп: вход — операция мира, применится у всех по порядку сервера (с раскрытием — синхронно, см. apply)
    if (this.sink) {
      void this.sink({ k: 'enter', id });
      return null;
    }
    setTimeout(() => {
      if (this.disposed) return;
      this.world.ensureAround(id);
      this.world.ensureVisible(id, viewHorizonM(this.world.settings.sightM));
    }, 0);
    // режим квартир: счётчик переходов (впервые в комнате — +1, после trAfter — бросок)
    const r = this.world.enter(id);
    if (r.counted) this.scheduleSave();
    return r;
  }

  /** Открыть закрытый выход квартиры (режим квартир): за ним — новая квартира или переход. null — не вышло. */
  openDoor(inst: string, connector: string): string | null {
    // кооп: дверь уже открыл другой игрок (его операция пришла раньше) — за ней та же комната
    if (this.world.doorState(inst, connector) === 'linked') return this.linkedTo(inst, connector);
    // до роста мира: связь появится уже с флагом opened (дверь останется у этой комнаты — без скачка)
    const key = `${inst}/${connector}`;
    this.opened.add(key);
    let id: string | null = null;
    try {
      id = this.world.openDoor(inst, connector);
    } catch (e) {
      console.error(e);
    }
    if (!id) this.opened.delete(key);
    this.saveDoors();
    return id;
  }

  /** Операция мира: в одиночной игре — сразу, в коопе — через сервер лобби (sink): результат придёт, когда операция
   *  вернётся и применится у всех. Результат — id комнаты (дверь, спуск, лифт) или null (не вышло; вход в комнату). */
  request(op: WorldOp): Promise<string | null> {
    if (this.sink) return this.sink(op);
    if (op.k === 'enter') {
      this.enter(op.id);
      return Promise.resolve(null);
    }
    return Promise.resolve(this.apply(op));
  }

  /** Применить операцию сразу и целиком (кооп: в порядке сервера — у всех игроков одинаково). Ошибка мира — null. */
  apply(op: WorldOp): string | null {
    try {
      switch (op.k) {
        case 'enter': {
          // раскрытие — синхронно: отложенное легло бы между операциями других игроков по-разному у разных копий
          const r = this.world.enter(op.id);
          this.world.ensureAround(op.id);
          this.world.ensureVisible(op.id, viewHorizonM(this.world.settings.sightM));
          if (r.counted) this.scheduleSave();
          return null;
        }
        case 'door':
          return this.openDoor(op.inst, op.conn);
        case 'descend':
          return this.world.descend(op.id);
        case 'ascend':
          return this.world.ascend(op.id, op.floor, op.side);
        case 'collapse':
          return this.world.collapse(op.inst, op.conn) ? op.inst : null;
      }
    } catch (e) {
      console.error(e);
    }
    return null;
  }

  /** Комната за связанной дверью метки connector комнаты inst (null — не связана). */
  private linkedTo(inst: string, connector: string): string | null {
    for (const l of this.world.run().links) {
      if (l.kind === 'descent' || l.kind === 'lift' || l.sealed) continue;
      if (l.a.inst === inst && l.a.connector === connector) return l.b.inst;
      if (l.b.inst === inst && l.b.connector === connector) return l.a.inst;
    }
    return null;
  }

  /** Открытые выходы («inst/connector») — для чекпойнта кооп-лобби. */
  openedList(): string[] {
    return [...this.opened];
  }

  /** Отпечаток мира — сверка копий у игроков кооп-лобби. Только то, что однозначно задано состоянием мира (и так же
   *  восстанавливается из сохранения): счётчики экземпляров, связей, раскрытых, тупиков, квартир, переходов и место
   *  последней комнаты — у разошедшихся копий почти наверняка разные. */
  fingerprint(): string {
    const run = this.world.run();
    const s = this.world.stats();
    const tr = s.transition;
    const last = run.instances[run.instances.length - 1];
    return [
      run.instances.length, run.links.length, s.expanded, s.pending, s.deadChance + s.deadFail, s.clusters, s.exitsOpen,
      tr ? `${tr.count}.${tr.pending ? 1 : 0}` : '-', this.opened.size,
      last ? `${last.id}:${last.roomId}:${last.rot}:${last.dx},${last.dy},${last.w ?? 0},${last.floor ?? 0}` : '-',
    ].join('/');
  }

  private saveDoors() {
    if (!this.persist) return;
    try {
      localStorage.setItem(doorsKey(this.key), JSON.stringify([...this.opened]));
    } catch {}
  }

  private refresh() {
    if (this.disposed) return;
    const { rx, changed } = this.assemble();
    this.rx = rx;
    if (changed.length) this.onUpdate?.(rx, changed);
    this.scheduleSave();
  }

  /** JSON прогона по текущему миру: новые экземпляры экспортируются, у старых — связи и двери. */
  private assemble(): { rx: RunExport; changed: string[] } {
    const run = this.world.run();
    const changed: string[] = [];
    const fresh = run.instances.filter((i) => !this.exp.has(i.id));
    if (fresh.length) {
      const part = exportRunJSON(this.p, { ...run, instances: fresh }, { withTex: false }) as RunExport;
      for (const i of part.instances) this.exp.set(i.id, i);
    }
    // переходы спец-локаций (kind 'descent': локация → комната-выход этажом ниже; 'lift': лифт → комната за
    // выходом этажом выше) — не проёмы: в JSON болванки их нет (иначе соседство по связям тянет локацию в куски
    // выхода); метка прихода выхода — тупик
    // «исчезнувшие» двери (пропущенный переход) — тоже: обе метки — тупики
    const doors = run.links.filter((l) => l.kind !== 'descent' && l.kind !== 'lift' && !l.sealed);
    const linkBy = new Map<string, { inst: string; connector: string }>();
    for (const l of doors) {
      linkBy.set(`${l.a.inst}/${l.a.connector}`, l.b);
      linkBy.set(`${l.b.inst}/${l.b.connector}`, l.a);
    }
    // метки прихода переходов — панели (у них игрок выходит из локации и через них возвращается), даже когда прочие
    // тупики — стены (режим квартир)
    const arrival = new Set(run.links.filter((l) => (l.kind === 'descent' || l.kind === 'lift') && !l.sealed).map((l) => `${l.b.inst}/${l.b.connector}`));
    const instances: RunInstance[] = [];
    for (const i of run.instances) {
      let e = this.exp.get(i.id)!;
      // подпись меток: связана / не раскрыта (проём в темноту) / закрытый выход квартиры (дверь) / приход перехода /
      // заколочена
      let sig = '';
      for (const k of e.connectors) {
        const to = linkBy.get(`${i.id}/${k.id}`);
        const st = to || k.len < 1 ? null : this.world.doorState(i.id, k.id);
        sig += to ? (this.opened.has(`${i.id}/${k.id}`) ? 'O' : 'L') : st === 'pending' ? 'P' : st === 'exit' ? 'X' : st === 'collapsed' ? 'C' : arrival.has(`${i.id}/${k.id}`) ? 'A' : 'D';
      }
      if (this.sig.get(i.id) !== sig) {
        changed.push(i.id);
        e = {
          ...e,
          connectors: e.connectors.map((k, n) => {
            const to = linkBy.get(`${i.id}/${k.id}`) ?? null;
            const { cut: _c, exit: _x, arrival: _a, opened: _o, collapsed: _k, ...rest } = k;
            if (sig[n] === 'P') return { ...rest, linkedTo: null, cut: true };
            if (sig[n] === 'X') return { ...rest, linkedTo: null, exit: true };
            if (sig[n] === 'A') return { ...rest, linkedTo: null, arrival: true };
            // завал снежного лаза (StreamWorld.collapse): тупик навсегда, у оболочки снега — пробка
            if (sig[n] === 'C') return { ...rest, linkedTo: null, collapsed: true };
            if (sig[n] === 'O') return { ...rest, linkedTo: to ? { ...to } : null, opened: true };
            return { ...rest, linkedTo: to ? { ...to } : null };
          }),
        };
        this.exp.set(i.id, e);
        this.sig.set(i.id, sig);
      }
      instances.push(e);
    }
    const rx: RunExport = {
      format: 'room-forge-run',
      version: 1,
      seed: run.seed,
      cellM: this.p.settings.cellM,
      settings: { ...run.settings, mode: 'fold' },
      ...this.tables,
      instances,
      // шов бесконечного хода подвала (wrap, клетки): куски портального рендера открывают его как проём со сдвигом
      links: doors.map((l) => ({ a: { ...l.a }, b: { ...l.b }, dw: l.dw ?? 0, ...(l.wrap ? { wrap: [l.wrap[0], l.wrap[1]] as [number, number] } : {}) })),
      openConnectors: run.openConnectors.map((o) => ({ ...o })),
      mode: 'fold',
      fold: run.fold ?? null,
      sight: run.sight,
      pvs: run.pvs ?? null,
    };
    return { rx, changed };
  }

  // ───────────────────────── сохранение ─────────────────────────

  private scheduleSave() {
    if (!this.persist) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.saveNow(), 400);
  }

  /** Сохранить мир сейчас (автосохранение — через 0.4 с после роста). */
  saveNow() {
    if (this.disposed || !this.persist) return;
    clearTimeout(this.saveTimer);
    try {
      const text = JSON.stringify(this.world.save());
      localStorage.setItem(this.key, text);
      this.saved = { at: Date.now(), bytes: text.length };
      this.error = null;
    } catch (e) {
      this.error = 'не сохранено: ' + String((e as Error)?.message ?? e);
    }
  }

  savePlayer(pl: WalkPlayer) {
    try {
      localStorage.setItem(playerKey(this.key), JSON.stringify(pl));
    } catch {}
  }

  loadPlayer(): WalkPlayer | null {
    try {
      const pl = JSON.parse(localStorage.getItem(playerKey(this.key)) || 'null') as WalkPlayer | null;
      if (!pl || typeof pl.room !== 'string' || !this.exp.has(pl.room)) return null;
      return pl;
    } catch {
      return null;
    }
  }

  /** Стереть сохранение этого сида (мир и игрока; с квартирами — и миры со стартом в биомах biomes). */
  static reset(seed: string, biomes: string[] = []) {
    for (const key of [worldKey(seed, []), worldKey(seed, ['квартиры']), ...biomes.map((b) => worldKey(seed, ['квартиры', `биом:${b}`]))]) {
      try {
        localStorage.removeItem(key);
        localStorage.removeItem(playerKey(key));
        localStorage.removeItem(doorsKey(key));
      } catch {}
    }
  }

  status(): WalkStatus {
    const st = this.world.stats();
    return {
      rooms: st.instances,
      dead: st.deadChance + st.deadFail,
      pending: st.pending,
      layers: st.layers,
      saved: this.saved,
      error: this.error,
      stale: this.world.stale,
      stats: st,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.saveNow();
    this.disposed = true;
    clearTimeout(this.saveTimer);
    this.unsub();
  }
}

/** Таблицы предметов и отделок — все из проекта (мир может поставить любую комнату). */
function projectTables(p: Project): Pick<RunExport, 'props' | 'items' | 'finishes'> & { tiers: NonNullable<RunExport['tiers']> } {
  const finById = new Map((p.finishes ?? []).map((f) => [f.id, f] as const));
  const finishes: RunFinish[] = (p.finishes ?? []).map((f) => ({
    id: f.id,
    name: f.name,
    surface: f.surface,
    color: f.color,
    tex: f.tex ?? null,
    hasTex: !!f.tex,
    tileW: f.tileW,
    tileH: f.tileH,
    dado: f.dado && finById.has(f.dado.finishId) ? { finishId: f.dado.finishId, heightM: f.dado.heightM } : null,
  }));
  return {
    props: p.props.map((x) => ({ id: x.id, name: x.name, w: x.w, h: x.h, color: x.color, tags: x.tags, hasTex: !!x.tex, tex: x.tex ?? null })),
    items: p.items.map((x) => ({ id: x.id, name: x.name, color: x.color, tags: x.tags })),
    tiers: p.economy.tiers.map((t) => ({ id: t.id, name: t.name, level: (t as { level?: number }).level ?? 0, color: t.color, danger: (t as { danger?: number }).danger ?? 0 })),
    finishes,
  };
}
