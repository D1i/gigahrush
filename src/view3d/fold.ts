// Складчатый (4D) прогон во вкладке «3D». Весь прогон одной болванкой не строится — комнаты разных
// слоёв W занимают одно место в 3D. Поэтому сцена собирается по частям (src/blockout/subrun.ts):
//  • от первого лица (по умолчанию) — портальный рендер (./portal.ts): у каждой комнаты свой «кусок»
//    болванки (src/blockout/pieces.ts), текущая рисуется обычно, остальные — только сквозь проёмы
//    (стенсил), рекурсивно. Комнаты могут пересекаться в 3D даже в поле зрения — каждая видна только
//    сквозь свой проём. Текущая комната меняется на плоскости проёма; коллизии — текущая + сосед у порога;
//  • от первого лица, режим «набор (PVS)» — потенциально видимый набор текущей комнаты (RunExport.pvs:
//    всё, что видно из её пола и проёмов; без PVS — она + всё в ≤ depth дверях) одной болванкой.
//    Игрок шагнул на пол соседа — набор соседа (модели кэшируются и строятся заранее) готовится скрытым
//    и подменяет текущий целиком (бесшовно, только если в прогоне нет пересечений внутри PVS);
//  • облёт — «башня слоёв» (каждый слой — свой план, поднятый на W·(wallH + 1.5 м), пороги со сдвигом —
//    вертикальные линии), один слой или видимое множество выбранной комнаты;
//  • «Детектор 4D (отладка)» — контуры комнат других слоёв, стоящих в 3D там же, где текущая.
// Подробно — docs/GENERATOR-4D.md §6–10 и docs/BLOCKOUT-BABYLON.md §12.
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateLineSystem } from '@babylonjs/core/Meshes/Builders/linesBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { Scene } from '@babylonjs/core/scene';
import { BoxBatch } from '../blockout/babylon';
import { buildBlockoutModel } from '../blockout/core';
import { mergePieces } from '../blockout/pieces';
import { PieceCache, PortalRenderer, type PortalFrameStats } from './portal';
import { viewHorizonM } from '../gen4d/pvs';
import { hasPvs, layerOf, layerRun, layersOf, linkBetween, overlapIds, pvsIds, safeDepth, subRun, visibleIds } from '../blockout/subrun';
import type { BlockoutModel, BlockoutOptions, DeadEnd, RunExport } from '../blockout/types';
import type { BlockoutViewer, SetModelOptions, ViewPart, ViewPartBuilt } from './viewer';

export type FoldOrbitView = { kind: 'tower' } | { kind: 'layer'; w: number } | { kind: 'vis'; inst: string | null };
/** Рендер от первого лица: портальный (по комнатам сквозь проёмы) или набор (PVS) одной болванкой. */
export type FoldRender = 'portal' | 'pvs';

export interface FoldResume {
  center: string | null;
  fpsReady: boolean;
  orbitFitted: boolean;
  orbitView: FoldOrbitView;
  detector: boolean;
  render: FoldRender;
}

/** Что сейчас на сцене — для панелей страницы. */
export interface FoldState {
  /** «башня: 7 слоёв», «слой W = 2», «видимое множество i12» */
  label: string;
  models: BlockoutModel[];
  /** время последней сборки: модели ядра (0 — из кэша) и сцены Babylon, мс */
  msModel: number;
  msScene: number;
  /** от первого лица: центральная комната и её слой */
  center: string | null;
  w: number | null;
  /** последний переход через порог (seq растёт на каждом) */
  cross: { seq: number; from: string; to: string; fromW: number; toW: number } | null;
  /** детектор: комнаты других слоёв в том же месте 3D */
  ghosts: { inst: string; w: number; name: string }[];
  /** глубина видимого множества и localRadius прогона */
  depth: number;
  /** рендер от первого лица и (для портального) его горизонт, м — туман ему не нужен */
  render: FoldRender;
  horizonM: number | null;
}

/** Зазор между слоями башни, м (над потолком слоя). */
export const LAYER_GAP_M = 1.5;
const C_FOLD = '#f0a830'; // дверь в другой слой (башня)
const C_FAR = '#5f7fb4'; // дверь за границей видимого множества (от первого лица)
const CACHE_MAX = 48;
/** сколько кадров ждать готовности мешей нового набора, прежде чем подменить всё равно */
const MAX_WAIT = 30;

const now = (): number => performance.now();
/** Цвет слоя W для детектора и подписей: разные слои — разные оттенки. */
export function layerColor(w: number): string {
  const h = (((w * 67 + 190) % 360) + 360) % 360;
  return `hsl(${h} 85% 64%)`;
}
function hslToColor3(css: string): Color3 {
  const m = /hsl\((\d+(?:\.\d+)?) (\d+)% (\d+)%\)/.exec(css);
  if (!m) return new Color3(0.5, 0.9, 1);
  const h = +m[1] / 360, s = +m[2] / 100, l = +m[3] / 100;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t: number) => {
    t = (t + 1) % 1;
    return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
  };
  return new Color3(f(h + 1 / 3), f(h), f(h - 1 / 3));
}

interface Tag {
  el: HTMLElement;
  /** точка плана (м) и высота */
  x: number;
  y: number;
  z: number;
}

export class FoldDriver {
  readonly depth: number;
  layers: number[];
  readonly start: string | null;
  private readonly wOf = new Map<string, number>();
  private readonly nameOf = new Map<string, string>();
  /** метки, связанные во всём прогоне (у части они могут стать тупиками — «дверь дальше») */
  private readonly linked = new Set<string>();
  private readonly cache = new Map<string, BlockoutModel>();
  private readonly overlapCache = new Map<string, string[]>();
  private center: string | null;
  private orbitView: FoldOrbitView = { kind: 'tower' };
  private detector = false;
  private fpsReady: boolean;
  private orbitFitted = false;
  private extras: { dispose(): void }[] = [];
  private tags: Tag[] = [];
  private obs: Observer<Scene> | null = null;
  private prefetchTimer = 0;
  private state: FoldState;
  private seq = 0;
  private disposed = false;
  /** в прогоне есть PVS (RunExport.pvs) — рендер по нему, связи наружу набора — проёмы в темноту */
  readonly pvs: boolean;
  /** определять текущую комнату по полу под игроком (QA выключает, чтобы сравнить кадры до/после) */
  autoCross = true;
  /** комната, чей набор на сцене */
  private shownCenter: string | null = null;
  /** набор, построенный скрытым и ждущий готовности мешей */
  private pending: {
    center: string;
    built: ViewPartBuilt[];
    model: BlockoutModel;
    ms: number;
    msBuild: number;
    frames: number;
    cross: NonNullable<FoldState['cross']>;
  } | null = null;
  private waiters: (() => void)[] = [];
  /** рендер от первого лица */
  private render: FoldRender = 'portal';
  /** портальный рендер: кэш кусков комнат и рендер (создаются при первом входе от первого лица) */
  private pieces: PieceCache | null = null;
  portal: PortalRenderer | null = null;
  /** горизонт портального рендера, м (viewHorizonM: проёмы открываются, пока видны; дальше — без рекурсии) */
  readonly horizonM: number;

  constructor(
    private v: BlockoutViewer,
    private rx: RunExport,
    private opts: BlockoutOptions,
    private build: SetModelOptions,
    private cb: {
      onState?(s: FoldState): void;
      /** от первого лица игрок оказался в комнате (старт, переход, телепорт) — бесконечный мир раскрывает окрестность */
      onEnter?(id: string): void;
    } = {},
    /** вид облёта, детектор и (при пересборке того же прогона, например при смене настроек болванки) —
     *  комната и состояние камер, с которых продолжить */
    resume?: Partial<FoldResume>,
    /** портальный рендер: метки с флагом cut (нераскрытые двери бесконечного мира) — проёмы в темноту */
    private openCut = false,
  ) {
    this.depth = safeDepth(rx);
    this.pvs = hasPvs(rx);
    const sight = Number(rx.settings?.sightM) || 0;
    this.horizonM = viewHorizonM(sight);
    this.layers = layersOf(rx);
    this.index(rx);
    const s = rx.instances.find((i) => i.parent == null) ?? rx.instances[0];
    this.start = s?.id ?? null;
    const ok = (id: string | null | undefined) => !!id && this.wOf.has(id);
    this.center = ok(resume?.center) ? resume!.center! : this.start;
    this.fpsReady = !!resume?.fpsReady && ok(resume.center);
    this.orbitFitted = !!resume?.orbitFitted;
    if (resume?.orbitView) this.orbitView = resume.orbitView;
    if (resume?.detector !== undefined) this.detector = resume.detector;
    if (resume?.render) this.render = resume.render;
    this.state = { label: '', models: [], msModel: 0, msScene: 0, center: null, w: null, cross: null, ghosts: [], depth: this.depth, render: this.render, horizonM: null };
    this.obs = v.scene.onAfterRenderObservable.add(() => this.tick());
  }

  private index(rx: RunExport) {
    for (const i of rx.instances) {
      this.wOf.set(i.id, layerOf(i));
      this.nameOf.set(i.id, i.roomName || i.roomId);
    }
    for (const l of rx.links) {
      this.linked.add(`${l.a.inst}/${l.a.connector}`);
      this.linked.add(`${l.b.inst}/${l.b.connector}`);
    }
  }

  /**
   * Прогон вырос (бесконечный мир, src/view3d/walk.ts): новые комнаты и связи. changed — комнаты, у
   * которых изменились связи или двери (куски портального рендера — заново); старые модели облёта
   * сбрасываются, облёт перестраивается.
   */
  setRun(rx: RunExport, changed: Iterable<string>) {
    if (this.disposed) return;
    this.rx = rx;
    this.layers = layersOf(rx);
    this.index(rx);
    this.cache.clear();
    this.overlapCache.clear();
    this.pieces?.setRun(rx, changed);
    if (this.v.mode === 'orbit') this.apply(false);
    else if (this.center) this.prefetchPieces(this.center);
  }

  /** Прогон (для QA и страницы). */
  get run(): RunExport {
    return this.rx;
  }

  get snapshot(): FoldResume {
    return { center: this.center, fpsReady: this.fpsReady, orbitFitted: this.orbitFitted, orbitView: this.orbitView, detector: this.detector, render: this.render };
  }

  // ───────────────────────── модели (ядро, кэш) ─────────────────────────

  /**
   * Опции ядра для частей. Настоящие тупики — панели (если пользователь не выбрал глухую стену).
   * Связи наружу набора (RunConnector.cut): у PVS — проёмы в темноту (их по построению не видно, а если
   * видно — это ошибка PVS, и пусть будет темнота, а не дверь, которая «появится» на пороге); без PVS
   * и у слоёв — панели (синие «дальняя дверь» / янтарные «в другой слой»).
   */
  private partOpts(kind: 'vis' | 'layer'): Partial<BlockoutOptions> {
    const dead = this.opts.deadEnds === 'wall' ? 'wall' : 'panel';
    return { ...this.opts, deadEnds: dead, cutEnds: kind === 'vis' && this.pvs ? 'open' : dead };
  }

  /** Набор, который рендерится, стоя в комнате id: PVS, а без него — видимое множество глубины depth. */
  setOf(id: string): Set<string> {
    return pvsIds(this.rx, id, this.depth);
  }

  /** Модель по ключу: vis:<id> — набор комнаты (PVS), layer:<w> — слой, ghost:<id> — одна комната. */
  private model(key: string): { model: BlockoutModel; ms: number } {
    const hit = this.cache.get(key);
    if (hit) {
      this.cache.delete(key);
      this.cache.set(key, hit);
      return { model: hit, ms: 0 };
    }
    const t0 = now();
    const [kind, arg] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
    let model: BlockoutModel;
    if (kind === 'vis') model = buildBlockoutModel(subRun(this.rx, this.setOf(arg)), this.partOpts('vis'));
    else if (kind === 'layer') model = buildBlockoutModel(layerRun(this.rx, Number(arg)), this.partOpts('layer'));
    else model = buildBlockoutModel(subRun(this.rx, [arg]), { ...this.opts, deadEnds: 'wall', cutEnds: 'wall', props: false, ceilings: false });
    this.cache.set(key, model);
    while (this.cache.size > CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
    return { model, ms: now() - t0 };
  }

  private farColor = (d: DeadEnd): string | null => (this.linked.has(`${d.inst}/${d.connector}`) ? C_FAR : null);
  private foldColor = (d: DeadEnd): string | null => (this.linked.has(`${d.inst}/${d.connector}`) ? C_FOLD : null);

  private visLabel(id: string, model: BlockoutModel): string {
    return this.pvs ? `видимый набор (PVS) ${id} · ${model.rooms.length} комн.` : `видимое множество ${id}`;
  }

  private wallH(): number {
    return this.opts.wallHeightM > 0 ? this.opts.wallHeightM : 2.5;
  }

  // ───────────────────────── управление ─────────────────────────

  setOrbitView(view: FoldOrbitView, refit = true) {
    this.orbitView = view;
    if (this.v.mode === 'orbit') this.apply(refit);
  }

  /** Рендер от первого лица: портальный или набор (PVS). */
  setRender(r: FoldRender) {
    if (r === this.render) return;
    this.render = r;
    if (this.v.mode === 'fps') this.apply(false);
    else this.emit({});
  }

  /** Статистика последнего кадра портального рендера (null — не он). */
  get portalStats(): PortalFrameStats | null {
    return this.portal?.isActive ? this.portal.stats : null;
  }

  setDetector(on: boolean) {
    if (on === this.detector) return;
    this.detector = on;
    if (this.v.mode === 'fps') {
      this.buildGhosts();
      this.emit({});
    }
  }

  /** Вернуться в стартовую комнату (от первого лица). */
  toStart() {
    if (this.start) this.goTo(this.start);
  }

  /** Перенести игрока в комнату inst (от первого лица — сразу, иначе при входе в режим). */
  goTo(inst: string) {
    if (!this.wOf.has(inst)) return;
    this.center = inst;
    this.fpsReady = false;
    if (this.v.mode === 'fps') this.apply(false);
  }

  /**
   * Поставить игрока (от первого лица, портальный рендер) в комнату inst у проёма в комнату toward,
   * лицом от проёма — возврат из спец-локации (src/locations/) через её входную дверь. Нет такого
   * проёма — просто в комнату (на её спавн). false — не вышло (не от первого лица / нет комнаты).
   */
  placeAtDoor(inst: string, toward: string | null): boolean {
    if (!this.wOf.has(inst) || this.v.mode !== 'fps') return false;
    if (this.render !== 'portal') {
      this.goTo(inst);
      return true;
    }
    const piece = this.ensurePortal() && this.pieces!.get(inst);
    const q = piece && toward ? piece.portals.find((p) => p.to === toward) : undefined;
    if (!piece || !q) {
      this.goTo(inst);
      return true;
    }
    if (inst !== this.center) this.onPortalCross(this.center ?? inst, inst);
    const z = piece.model.floors.find((f) => f.inst === inst)?.z ?? 0;
    const p = q.center.subtract(q.u.scale(0.8));
    const c = this.v.fps;
    c.position.set(p.x, z + 1.65, p.z);
    c.rotation.set(0.05, Math.atan2(-q.u.x, -q.u.z), 0);
    c.cameraDirection.setAll(0);
    c.cameraRotation.set(0, 0);
    return true;
  }

  /**
   * Сменить текущую комнату так же, как при шаге на её пол (камера не трогается): набор строится
   * скрытым и подменяется, когда готов. Promise — после подмены (следующий кадр — уже новый набор).
   * Для QA-проверки бесшовности (вместе с autoCross = false).
   */
  crossTo(inst: string): Promise<void> {
    if (!this.wOf.has(inst) || this.v.mode !== 'fps') return Promise.resolve();
    if (this.portal?.isActive) {
      // портальный рендер: смена текущей комнаты — со следующего кадра (куски строятся сразу)
      if (inst !== this.center) this.onPortalCross(this.center!, inst);
      return this.portal.nextFrame();
    }
    return new Promise((res) => {
      this.waiters.push(res);
      if (inst !== this.center) this.cross(inst);
      else this.tryCommit();
    });
  }

  /** Комната, чей набор сейчас на сцене (во время подготовки нового — ещё старая). */
  get shown(): string | null {
    return this.portal?.isActive ? this.portal.current : this.shownCenter;
  }

  /** Последнее состояние (то же, что уходит в onState). */
  get current(): FoldState {
    return this.state;
  }

  /** Построить сцену под текущий режим камеры. refit — вписать облёт заново. */
  apply(refit = false) {
    if (this.disposed) return;
    this.clearExtras();
    this.discardPending();
    if (this.v.mode === 'fps' && this.render === 'portal') {
      if (!this.center) return;
      this.applyPortal();
      return;
    }
    this.portal?.setActive(false);
    if (this.v.mode === 'fps') {
      if (!this.center) return;
      const t0 = now();
      const { model, ms } = this.model('vis:' + this.center);
      const respawn = !this.fpsReady;
      // облёт не вписываем — он остаётся на башне; игрока ставим на спавн только при первом входе
      this.v.setParts([{ model, deadEndColor: this.farColor }], { ...this.build, spawnInst: this.center, refit: false });
      this.shownCenter = this.center;
      if (respawn) this.v.spawn();
      this.fpsReady = true;
      this.buildGhosts();
      this.emit({ label: this.visLabel(this.center, model), models: [model], msModel: ms, msScene: now() - t0 - ms });
      this.prefetch(this.center);
      return;
    }
    this.shownCenter = null;
    const t0 = now();
    let msModel = 0;
    const parts: ViewPart[] = [];
    let label = '';
    const view = this.orbitView;
    if (view.kind === 'tower') {
      const step = this.wallH() + LAYER_GAP_M;
      for (const w of this.layers) {
        const { model, ms } = this.model('layer:' + w);
        msModel += ms;
        parts.push({ model, y: w * step, deadEndColor: this.foldColor });
      }
      label = `башня: ${this.layers.length} слоёв`;
    } else if (view.kind === 'layer') {
      const w = this.layers.includes(view.w) ? view.w : this.layers.includes(0) ? 0 : (this.layers[0] ?? 0);
      const { model, ms } = this.model('layer:' + w);
      msModel += ms;
      parts.push({ model, deadEndColor: this.foldColor });
      label = `слой W = ${w}`;
    } else {
      const inst = view.inst && this.wOf.has(view.inst) ? view.inst : (this.center ?? this.start);
      if (inst) {
        const { model, ms } = this.model('vis:' + inst);
        msModel += ms;
        parts.push({ model, deadEndColor: this.farColor });
        label = this.visLabel(inst, model);
      }
    }
    // игрока не трогаем: он остаётся там, где был от первого лица
    this.v.setParts(parts, { ...this.build, refit: refit || !this.orbitFitted, spawn: false });
    this.orbitFitted = true;
    if (view.kind === 'tower') this.buildTower();
    this.emit({ label, models: parts.map((p) => p.model), msModel, msScene: now() - t0 - msModel, ghosts: [] });
  }

  // ───────────────────────── от первого лица: портальный рендер ─────────────────────────

  private ensurePortal(): PortalRenderer {
    if (!this.pieces) this.pieces = new PieceCache(this.v.scene, this.rx, { blockout: this.partOpts('vis'), propTextures: this.build.propTextures, finishes: this.build.finishes, openCut: this.openCut });
    if (!this.portal) {
      this.portal = new PortalRenderer(this.v.scene, this.v.fps, this.pieces, {
        horizonM: this.horizonM,
        onCross: (from, to) => this.onPortalCross(from, to, true),
      });
    }
    return this.portal;
  }

  /** От первого лица — портальный рендер: обычная болванка убирается, текущая комната — центр. */
  private applyPortal() {
    const t0 = now();
    const r = this.ensurePortal();
    const builtBefore = this.pieces!.built;
    // обычных частей нет — всё рисует портальный рендер
    this.v.setParts([], { ...this.build, refit: false, spawn: false });
    const piece = this.pieces!.get(this.center!);
    if (!piece) return;
    r.setCurrent(this.center);
    r.autoTrack = this.autoCross;
    r.setActive(true);
    this.shownCenter = this.center;
    if (!this.fpsReady) this.v.spawnIn(piece.model, this.center!);
    this.fpsReady = true;
    this.buildGhosts();
    const built = this.pieces!.built > builtBefore;
    this.emit({ label: this.portalLabel(this.center!), models: [mergePieces([piece.model])], msModel: built ? piece.ms.model : 0, msScene: built ? piece.ms.scene : now() - t0 });
    this.prefetchPieces(this.center!);
    this.cb.onEnter?.(this.center!);
  }

  private portalLabel(id: string): string {
    return 'порталы: комната ' + id;
  }

  /** Переход в соседнюю комнату (по полу — из рендера, или crossTo). */
  private onPortalCross(from: string, to: string, fromRenderer = false) {
    const fromW = this.wOf.get(from) ?? 0;
    const dw = linkBetween(this.rx, from, to)?.dw ?? (this.wOf.get(to) ?? 0) - fromW;
    this.center = to;
    this.shownCenter = to;
    if (!fromRenderer) this.portal?.setCurrent(to);
    const piece = this.pieces?.get(to);
    this.buildGhosts();
    this.emit({
      label: this.portalLabel(to),
      models: piece ? [mergePieces([piece.model])] : [],
      msModel: piece?.ms.model ?? 0,
      msScene: piece?.ms.scene ?? 0,
      cross: { seq: ++this.seq, from, to, fromW, toW: fromW + dw },
    });
    this.prefetchPieces(to);
    this.cb.onEnter?.(to);
  }

  /** Куски вокруг комнаты — заранее, по нескольку за тик (≤ 8 мс): соседи, соседи соседей и PVS комнаты
   *  (если есть). Старые куски сверх предела памяти освобождаются (кроме нужных сейчас и нарисованных в
   *  прошлом кадре). */
  private prefetchPieces(center: string) {
    clearTimeout(this.prefetchTimer);
    const cache = this.pieces;
    if (!cache) return;
    const want = [...new Set([...visibleIds(this.rx, center, 2), ...(this.rx.pvs?.[center] ?? [])])];
    const protect = new Set([...want, ...(this.portal?.lastRooms ?? [])]);
    cache.trim(protect);
    const queue = want.filter((id) => !cache.has(id));
    const step = () => {
      if (this.disposed || this.pieces !== cache) return;
      const t0 = now();
      while (queue.length && now() - t0 < 8) cache.get(queue.shift()!);
      if (queue.length) this.prefetchTimer = window.setTimeout(step, 16);
    };
    this.prefetchTimer = window.setTimeout(step, 30);
  }

  // ───────────────────────── от первого лица: переход через порог (набор PVS) ─────────────────────────

  private tick() {
    if (this.disposed) return;
    if (this.portal?.isActive) {
      this.portal.autoTrack = this.autoCross;
      this.placeTags();
      return;
    }
    if (this.pending) this.tryCommit();
    // текущая комната — та из показанного набора, чей пол под игроком (полы набора не пересекаются)
    if (this.autoCross && this.v.mode === 'fps' && this.center && this.v.model) {
      const p = this.v.fps.position;
      const to = floorAt(this.v.model, p.x, -p.z);
      if (to && to !== this.center) this.cross(to);
    }
    this.placeTags();
  }

  /**
   * Игрок встал на пол соседа: набор вокруг него строится скрытым (модель обычно уже в кэше) и
   * подменяет текущий целиком, когда все меши готовы к отрисовке. Камера, скорость и гравитация игрока
   * не трогаются. Общая часть двух наборов даёт одинаковую геометрию, а всё видимое с порога есть в
   * обоих (PVS) — поэтому в кадре ничего не появляется и не исчезает.
   */
  private cross(to: string) {
    const from = this.center!;
    const fromW = this.wOf.get(from) ?? 0;
    const toW = this.wOf.get(to) ?? 0;
    this.center = to;
    this.discardPending();
    const t0 = now();
    const { model, ms } = this.model('vis:' + to);
    const built = this.v.prepareParts([{ model, deadEndColor: this.farColor }], this.build);
    const dw = linkBetween(this.rx, from, to)?.dw ?? toW - fromW;
    this.pending = {
      center: to,
      built,
      model,
      ms,
      msBuild: now() - t0 - ms,
      frames: 0,
      cross: { seq: ++this.seq, from, to, fromW, toW: fromW + dw },
    };
    this.tryCommit();
  }

  /** Подменить набор, если меши готовы (не дольше MAX_WAIT кадров ожидания). */
  private tryCommit() {
    const p = this.pending;
    if (!p) {
      this.flushWaiters();
      return;
    }
    if (!this.v.partsReady(p.built) && p.frames++ < MAX_WAIT) return;
    this.pending = null;
    const t0 = now();
    this.clearExtras();
    this.v.commitParts(p.built, { ...this.build, refit: false });
    this.shownCenter = p.center;
    this.buildGhosts();
    this.emit({ label: this.visLabel(p.center, p.model), models: [p.model], msModel: p.ms, msScene: p.msBuild + now() - t0, cross: p.cross });
    this.prefetch(p.center);
    this.flushWaiters();
  }

  private discardPending() {
    if (!this.pending) return;
    this.v.discardParts(this.pending.built);
    this.pending = null;
  }

  private flushWaiters() {
    const w = this.waiters;
    this.waiters = [];
    for (const f of w) f();
  }

  /** Модели видимых множеств соседей — заранее, по одной за тик (на пороге останется только сцена). */
  private prefetch(center: string) {
    clearTimeout(this.prefetchTimer);
    const queue = [...visibleIds(this.rx, center, 1)].filter((id) => id !== center && !this.cache.has('vis:' + id));
    const step = () => {
      if (this.disposed) return;
      const id = queue.shift();
      if (!id) return;
      this.model('vis:' + id);
      this.prefetchTimer = window.setTimeout(step, 16);
    };
    this.prefetchTimer = window.setTimeout(step, 60);
  }

  // ───────────────────────── дополнительные меши ─────────────────────────

  private clearExtras() {
    for (const e of this.extras) e.dispose();
    this.extras = [];
    for (const t of this.tags) t.el.remove();
    this.tags = [];
  }

  private tag(text: string, color: string, x: number, y: number, z: number, cls = 'v3-tag') {
    const el = document.createElement('div');
    el.className = cls;
    el.textContent = text;
    el.style.setProperty('--c', color);
    el.style.display = 'none';
    this.v.host.appendChild(el);
    this.tags.push({ el, x, y, z });
  }

  private placeTags() {
    if (!this.tags.length) return;
    const w = this.v.host.clientWidth, h = this.v.host.clientHeight;
    for (const t of this.tags) {
      const p = this.v.projectPlan(t.x, t.y, t.z);
      const vis = !!p && p[0] > -40 && p[0] < w + 40 && p[1] > -40 && p[1] < h + 40;
      t.el.style.display = vis ? '' : 'none';
      if (p) t.el.style.transform = `translate(${Math.round(p[0])}px, ${Math.round(p[1])}px)`;
    }
  }

  /** Башня: вертикальные линии между проёмами порогов со сдвигом и подписи слоёв. */
  private buildTower() {
    const scene = this.v.scene;
    const step = this.wallH() + LAYER_GAP_M;
    const c = this.rx.cellM > 0 ? this.rx.cellM : 0.1;
    const doorMid = Math.min(this.opts.doorHeightM, this.wallH()) * 0.55;
    const conn = new Map<string, [number, number, number, number]>();
    for (const i of this.rx.instances) for (const k of i.connectors ?? []) conn.set(`${i.id}/${k.id}`, k.line);
    const lines: Vector3[][] = [];
    for (const l of this.rx.links) {
      const dw = typeof l.dw === 'number' ? l.dw : 0;
      if (!dw) continue;
      const a = conn.get(`${l.a.inst}/${l.a.connector}`), b = conn.get(`${l.b.inst}/${l.b.connector}`);
      if (!a || !b) continue;
      // середина проёма: между серединами двух меток (они смотрят друг на друга через стену gap)
      const x = ((a[0] + a[2]) / 2 + (b[0] + b[2]) / 2) / 2 * c;
      const y = ((a[1] + a[3]) / 2 + (b[1] + b[3]) / 2) / 2 * c;
      const ya = (this.wOf.get(l.a.inst) ?? 0) * step + doorMid;
      const yb = (this.wOf.get(l.b.inst) ?? 0) * step + doorMid;
      lines.push([new Vector3(x, ya, -y), new Vector3(x, yb, -y)]);
      // засечки у проёмов
      for (const yy of [ya, yb]) lines.push([new Vector3(x - 0.25, yy, -y), new Vector3(x + 0.25, yy, -y)], [new Vector3(x, yy, -y - 0.25), new Vector3(x, yy, -y + 0.25)]);
    }
    if (lines.length) {
      const ls = CreateLineSystem('fold:links', { lines }, scene);
      ls.color = Color3.FromHexString('#ffc451');
      ls.isPickable = false;
      this.extras.push(ls);
    }
    // подписи слоёв — у северо-западного угла каждого слоя
    this.v.parts.forEach((p) => {
      const w = Math.round(p.y / step);
      const b = p.model.bounds;
      const n = p.model.rooms.length;
      this.tag(`W ${w > 0 ? '+' + w : w} · ${n} комн.`, layerColor(w), b.x0, b.y0, p.y + this.wallH() + 0.2, 'v3-tag layer');
    });
  }

  /** Детектор: контуры комнат других слоёв, пересекающихся с текущей в 3D (поверх всего, рентгеном). */
  private buildGhosts() {
    for (const e of this.extras) e.dispose();
    this.extras = [];
    for (const t of this.tags) t.el.remove();
    this.tags = [];
    const ghosts: FoldState['ghosts'] = [];
    if (this.detector && this.v.mode === 'fps' && this.center) {
      let ids = this.overlapCache.get(this.center);
      if (!ids) this.overlapCache.set(this.center, (ids = overlapIds(this.rx, this.center)));
      const scene = this.v.scene;
      const H = this.wallH();
      for (const id of ids) {
        const w = this.wOf.get(id) ?? 0;
        const css = layerColor(w);
        const col = hslToColor3(css);
        const { model } = this.model('ghost:' + id);
        const lines: Vector3[][] = [];
        for (const f of model.faces) {
          if (f.part !== 'wall') continue;
          const [x1, y1, x2, y2] = f.line;
          lines.push([new Vector3(x1, 0.03, -y1), new Vector3(x2, 0.03, -y2)], [new Vector3(x1, H - 0.03, -y1), new Vector3(x2, H - 0.03, -y2)], [new Vector3(x1, 0.03, -y1), new Vector3(x1, H - 0.03, -y1)]);
        }
        if (lines.length) {
          const ls = CreateLineSystem('ghost:' + id, { lines }, scene);
          ls.color = col;
          ls.alpha = 0.9;
          ls.isPickable = false;
          ls.renderingGroupId = 1; // поверх геометрии — детектор «видит» сквозь стены
          this.extras.push(ls);
        }
        // пол-призрак
        const g = new BoxBatch();
        for (const s of model.floors) if (s.inst) for (const r of s.rects) g.planQuad(r, 0.025, true);
        const fm = g.toMesh('ghostFloor:' + id, scene);
        const mat = new StandardMaterial('ghost:' + id, scene);
        mat.disableLighting = true;
        mat.emissiveColor = col;
        mat.alpha = 0.16;
        mat.backFaceCulling = false;
        fm.material = mat;
        fm.isPickable = false;
        fm.renderingGroupId = 1;
        this.extras.push(fm, mat);
        const r = model.rooms[0];
        const name = this.nameOf.get(id) ?? id;
        if (r) this.tag(`W=${w} · ${name}`, css, r.anchor[0], r.anchor[1], 1.5, 'v3-tag ghost');
        ghosts.push({ inst: id, w, name });
      }
    }
    this.state = { ...this.state, ghosts };
  }

  private emit(patch: Partial<FoldState>) {
    const center = this.v.mode === 'fps' ? this.center : null;
    const portal = this.v.mode === 'fps' && this.render === 'portal';
    this.state = { ...this.state, ...patch, center, w: center ? (this.wOf.get(center) ?? 0) : null, render: this.render, horizonM: portal ? this.horizonM : null };
    this.cb.onState?.(this.state);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.prefetchTimer);
    this.discardPending();
    this.flushWaiters();
    if (this.obs) this.v.scene.onAfterRenderObservable.remove(this.obs);
    this.obs = null;
    this.clearExtras();
    this.cache.clear();
    this.portal?.dispose();
    this.portal = null;
    this.pieces?.dispose();
    this.pieces = null;
  }
}

/** Комната, чей пол (в плане) содержит точку; null — проём, стена, вне пола. */
export function floorAt(model: BlockoutModel, x: number, y: number): string | null {
  for (const f of model.floors) {
    if (!f.inst) continue;
    for (const r of f.rects) if (x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1) return f.inst;
  }
  return null;
}
