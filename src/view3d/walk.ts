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
import { DEFAULT_STREAM, createStreamWorld, streamSettings, viewHorizonM, worldKey, type StreamSave, type StreamStats, type StreamWorld } from '../gen4d/stream';
import { exportRunJSON } from '../gen/world';
import type { Project } from '../model/types';
import type { RunExport, RunFinish, RunInstance } from '../blockout/types';

export interface WalkOptions {
  seed: string;
  /** вероятность, что нераскрытая дверь окажется заколоченной, 0…1 */
  deadEndChance: number;
  /** ветвистость (множитель веса развилок) */
  branching: number;
  /** на сколько дверей вперёд мир раскрыт */
  aheadDoors: number;
}

export const DEFAULT_WALK: WalkOptions = { seed: 'гигахрущ', deadEndChance: DEFAULT_STREAM.deadEndChance, branching: DEFAULT_STREAM.branching, aheadDoors: DEFAULT_STREAM.aheadDoors };

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
  private error: string | null = null;
  private disposed = false;

  constructor(
    private readonly p: Project,
    readonly opts: WalkOptions,
  ) {
    this.key = worldKey(opts.seed, []);
    let save: StreamSave | undefined;
    try {
      const s = localStorage.getItem(this.key);
      if (s) save = JSON.parse(s) as StreamSave;
    } catch {
      save = undefined;
    }
    const g = p.generator;
    const settings = streamSettings(opts.seed, {
      gap: g.gap,
      match: g.match,
      sightM: g.sightM > 0 ? g.sightM : DEFAULT_STREAM.sightM,
      startRoomId: g.startRoomId,
      deadEndChance: opts.deadEndChance,
      branching: opts.branching,
      aheadDoors: opts.aheadDoors,
    });
    this.world = createStreamWorld(p, settings, save);
    if (save && !this.world.stale) this.saved = { at: save.savedAt, bytes: 0 };
    this.tables = projectTables(p);
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
  enter(id: string) {
    setTimeout(() => {
      if (this.disposed) return;
      this.world.ensureAround(id);
      this.world.ensureVisible(id, viewHorizonM(this.world.settings.sightM));
    }, 0);
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
    // переходы спец-локаций (kind 'descent': локация → комната-выход этажом ниже) — не проёмы: в JSON
    // болванки их нет (иначе соседство по связям тянет локацию в куски выхода); метка прихода выхода — тупик
    const doors = run.links.filter((l) => l.kind !== 'descent');
    const linkBy = new Map<string, { inst: string; connector: string }>();
    for (const l of doors) {
      linkBy.set(`${l.a.inst}/${l.a.connector}`, l.b);
      linkBy.set(`${l.b.inst}/${l.b.connector}`, l.a);
    }
    const instances: RunInstance[] = [];
    for (const i of run.instances) {
      let e = this.exp.get(i.id)!;
      // подпись меток: связана / не раскрыта (проём в темноту) / заколочена
      let sig = '';
      for (const k of e.connectors) {
        const to = linkBy.get(`${i.id}/${k.id}`);
        sig += to ? 'L' : k.len >= 1 && this.world.doorState(i.id, k.id) === 'pending' ? 'P' : 'D';
      }
      if (this.sig.get(i.id) !== sig) {
        changed.push(i.id);
        e = {
          ...e,
          connectors: e.connectors.map((k, n) => {
            const to = linkBy.get(`${i.id}/${k.id}`) ?? null;
            const { cut: _c, ...rest } = k;
            return sig[n] === 'P' ? { ...rest, linkedTo: null, cut: true } : { ...rest, linkedTo: to ? { ...to } : null };
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
      links: doors.map((l) => ({ a: { ...l.a }, b: { ...l.b }, dw: l.dw ?? 0 })),
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
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.saveNow(), 400);
  }

  /** Сохранить мир сейчас (автосохранение — через 0.4 с после роста). */
  saveNow() {
    if (this.disposed) return;
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

  /** Стереть сохранение этого сида (мир и игрока). */
  static reset(seed: string) {
    const key = worldKey(seed, []);
    try {
      localStorage.removeItem(key);
      localStorage.removeItem(playerKey(key));
    } catch {}
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
