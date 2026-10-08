// Портальный рендер складчатого (4D) прогона от первого лица (docs/BLOCKOUT-BABYLON.md §12).
//
// Комнаты разных слоёв W стоят в одном месте 3D, поэтому «нарисовать набор комнат обычной сценой» можно
// только без пересечений в поле зрения. Здесь — как в настоящих портальных движках: каждая комната
// рисуется ТОЛЬКО внутри экранной области проёма, сквозь который её видно, рекурсивно по цепочкам
// проёмов. Тогда комнаты могут пересекаться в 3D даже прямо перед глазами — каждая видна только сквозь
// свой проём.
//
// Кадр (в onBeforeDrawPhase, после очистки кадра, до обычных групп рендера):
//  1. Текущая комната — обычно (стенсил = 0, тест глубины).
//  2. Проёмы комнаты, видимые в кадре (лицом к глазу, в пирамиде видимости):
//     а) маски всех проёмов — только глубина (тест с геометрией комнаты: ближняя стена закрывает
//        проём); при перекрытии проёмов на экране выигрывает ближний;
//     б) каждому проёму — свой номер стенсила: маска ещё раз с тестом глубины EQUAL (только там, где он
//        ближний) и операцией INVERT с маской записи ref ^ v: из ref получается ровно v;
//     в) для каждого проёма: в его области (стенсил = v) — заливка цветом фона с глубиной «далеко»,
//        затем комната за проёмом с тестом стенсила = v и плоскостью отсечения по проёму (её геометрия
//        перед плоскостью проёма не рисуется); её проёмы — в очередь (п. 2 с ref = v).
//  Очередь — в ширину: ближние уровни получают номера стенсила первыми (их 254 на кадр).
//  Маска проёма — коробка от плоскости проёма (середина толщины стены, там же граница кусков двух
//  комнат и место смены текущей комнаты) в сторону комнаты за ним на D, без ближней грани и без
//  отсечения граней: даже когда глаз в миллиметре от плоскости и ближняя плоскость камеры срезала бы
//  квадрат проёма, лучи сквозь проём упираются во внутренние грани коробки.
//  Тумана не нужно: проёмы открываются, пока видны в кадре. Горизонт (horizonM) — только предел работы:
//  проём дальше него ещё открывается, но комната за ним рисуется без своих проёмов (в них — цвет фона).
//  Если в сцене линейный туман (необязательная атмосфера), проём целиком дальше fogEnd не открывается —
//  туман там непрозрачен, за ним и так его цвет.
//
// Физика: коллизии только у текущей комнаты и у соседа, к проёму которого игрок ближе 0.8 м. Текущая
// комната — по полу (её пол + её половины проёмов) среди текущей и соседей: меняется ровно на плоскости
// проёма — там, где граница кусков.
import { Constants } from '@babylonjs/core/Engines/constants';
import { ShaderStore } from '@babylonjs/core/Engines/shaderStore';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { Plane } from '@babylonjs/core/Maths/math.plane';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { Scene } from '@babylonjs/core/scene';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import { buildBabylonBlockout, createBlockoutShared, type BabylonBlockout, type BlockoutShared } from '../blockout/babylon';
import { buildPiece, pieceFloorRects, piecePortals, type PiecePortal } from '../blockout/pieces';
import type { BlockoutModel, BlockoutOptions, Rect, RunExport } from '../blockout/types';

/** Слой мешей кусков: камеры его не рисуют — куски рисует только портальный рендер. */
export const PORTAL_LAYER = 0x10000000;
/** Плоскость отсечения «ничего не отсекает»: держим её всегда, пока рендер активен, — у материалов
 *  тогда всегда один и тот же набор defines (CLIPPLANE), без перекомпиляции и «неготовых» кадров. */
const NOOP_CLIP = new Plane(0, 0, 0, -1);
/** Глубина маски-коробки за плоскостью проёма, м (больше «радиуса» ближней плоскости камеры). */
const MASK_D = 0.3;
/** Запас маски-коробки внутрь стен, пола и перемычки, м (меньше полутолщины стены и плиты). */
const MASK_E = 0.002;
/** Глаз ближе этого к прямоугольнику проёма — маска глубокая, м. */
const MASK_NEAR = 0.25;
/** Плоскость отсечения комнаты за проёмом отступает от плоскости проёма назад, м. */
const CLIP_E = 0.001;
/** Насколько глаз может быть за плоскостью проёма (в сторону комнаты за ним), чтобы проём ещё открывался. */
const EYE_TOL = 0.03;
/** Игрок ближе этого к проёму — коллизии и у соседа за ним, м. */
const COLLIDE_NEAR = 0.8;
/** глубже — комната за проёмом рисуется без своих проёмов (как за горизонтом) */
const MAX_LEVEL = 24;
const MAX_STENCIL = 254;
/** номер стенсила «проём сверх предела номеров» — заливается цветом фона в конце кадра */
const CAP = 255;

// ───────────────────────── шейдеры масок и заливки ─────────────────────────

ShaderStore.ShadersStore['rfPortalMaskVertexShader'] = `precision highp float;
attribute vec3 position;
uniform mat4 viewProjection;
varying vec3 vW;
void main(void) { vW = position; gl_Position = viewProjection * vec4(position, 1.0); }`;
ShaderStore.ShadersStore['rfPortalMaskFragmentShader'] = `precision highp float;
uniform vec4 uClip;
varying vec3 vW;
void main(void) { if (dot(uClip.xyz, vW) + uClip.w > 0.0) discard; gl_FragColor = vec4(1.0); }`;
ShaderStore.ShadersStore['rfPortalFillVertexShader'] = `precision highp float;
attribute vec3 position;
void main(void) { gl_Position = vec4(position.xy, 0.9999999, 1.0); }`;
ShaderStore.ShadersStore['rfPortalFillFragmentShader'] = `precision highp float;
uniform vec4 uColor;
void main(void) { gl_FragColor = uColor; }`;

// ───────────────────────── куски комнат (Babylon) ─────────────────────────

/** Проём куска, готовый к рендеру: маска, плоскости, углы. */
export interface PortalDef extends PiecePortal {
  /** ключ связи (одинаков у обеих сторон проёма) */
  key: string;
  /** маска глубокая (глаз у проёма) и тонкая */
  mask: Mesh;
  thin: Mesh;
  /** Babylon: точка на плоскости и единичное направление в комнату to */
  p0: Vector3;
  u: Vector3;
  /** углы проёма (Babylon) по кругу и центр */
  corners: Vector3[];
  center: Vector3;
  /** отсечение для комнаты to: остаётся только её сторона плоскости (Babylon: discard при n·p + d > 0) */
  clip: Plane;
  /** шов бесконечного хода: комната to видна сдвинутой на shiftB (Babylon); null — обычный проём */
  shiftB: Vector3 | null;
}

export interface PortalPiece {
  id: string;
  /** кусок комнаты (pieceOf) */
  model: BlockoutModel;
  bo: BabylonBlockout;
  meshes: Mesh[];
  /** меши, у которых при включённой физике checkCollisions */
  collidable: Mesh[];
  /** пол для определения текущей комнаты (с половинами проёмов), план */
  floor: Rect[];
  portals: PortalDef[];
  bytes: number;
  collide: boolean;
  ms: { model: number; scene: number };
}

export interface PieceCacheOptions {
  blockout: Partial<BlockoutOptions>;
  propTextures?: Record<string, string>;
  /** модели предметов (src/view3d/propModels.ts) */
  propModel?: (propId: string) => Mesh | null;
  finishes?: boolean;
  /** предел памяти мешей кусков, байт (по умолчанию 96 МБ) и число кусков (по умолчанию 80) */
  limitBytes?: number;
  maxPieces?: number;
  /** метки комнаты с флагом cut (нераскрытые двери бесконечного мира) — проём в темноту, а не стена */
  openCut?: boolean;
}

const now = (): number => performance.now();

/** Кэш кусков комнат: модель ядра (данные) и меши Babylon; LRU с пределом памяти мешей. */
export class PieceCache {
  private readonly pieces = new Map<string, PortalPiece>();
  private readonly models = new Map<string, BlockoutModel>();
  readonly shared: BlockoutShared;
  private readonly limit: number;
  private readonly maxPieces: number;
  private bytes = 0;
  private maskMat: ShaderMaterial;
  /** сколько кусков построено с начала (для HUD/QA) */
  built = 0;
  evicted = 0;

  constructor(
    readonly scene: Scene,
    public run: RunExport,
    private readonly opts: PieceCacheOptions,
  ) {
    this.shared = createBlockoutShared(scene);
    this.limit = opts.limitBytes ?? 96 * 1024 * 1024;
    this.maxPieces = opts.maxPieces ?? 80;
    const m = (this.maskMat = new ShaderMaterial('rf:portalMask', scene, { vertex: 'rfPortalMask', fragment: 'rfPortalMask' }, {
      attributes: ['position'],
      uniforms: ['viewProjection', 'uClip'],
    }));
    m.backFaceCulling = false;
    m.setVector4('uClip', { x: 0, y: 0, z: 0, w: -1 } as never);
  }

  get maskMaterial(): ShaderMaterial {
    return this.maskMat;
  }

  /** Модель куска (данные; кэш без предела — она маленькая). */
  model(id: string): { model: BlockoutModel; ms: number } {
    const hit = this.models.get(id);
    if (hit) return { model: hit, ms: 0 };
    const t0 = now();
    const model = buildPiece(this.run, id, this.opts.blockout, !!this.opts.openCut);
    this.models.set(id, model);
    return { model, ms: now() - t0 };
  }

  /** Пересобрать все куски (например, догрузились модели предметов). */
  rebuildAll() {
    for (const [id, p] of [...this.pieces]) this.drop(id, p);
    this.models.clear();
  }

  /** Прогон вырос (бесконечный мир): у комнат changed (новые связи, раскрытые двери) кусок — заново. */
  setRun(run: RunExport, changed: Iterable<string>) {
    this.run = run;
    for (const id of changed) {
      this.models.delete(id);
      const p = this.pieces.get(id);
      if (p) this.drop(id, p);
    }
  }

  has(id: string): boolean {
    return this.pieces.has(id);
  }

  peek(id: string): PortalPiece | null {
    return this.pieces.get(id) ?? null;
  }

  /** Кусок комнаты (строится синхронно, если его нет). null — комнаты нет в прогоне. */
  get(id: string): PortalPiece | null {
    const hit = this.pieces.get(id);
    if (hit) {
      // LRU: свежий — в конец
      this.pieces.delete(id);
      this.pieces.set(id, hit);
      return hit;
    }
    if (!(this.run.instances ?? []).some((i) => i.id === id)) return null;
    const { model, ms } = this.model(id);
    const t0 = now();
    const bo = buildBabylonBlockout(this.scene, model, {
      collisions: true,
      propTextures: this.opts.propTextures,
      finishes: this.opts.finishes !== false,
      shared: this.shared,
      propModel: this.opts.propModel,
    });
    bo.setCeilingsVisible(true);
    const all = bo.root.getChildMeshes(false) as Mesh[];
    // рисуются только видимые (невидимые — коллайдеры, например бокс под моделью предмета)
    const meshes = all.filter((m) => m.isVisible);
    const collidable: Mesh[] = [];
    let bytes = 0;
    for (const m of all) {
      if (m.checkCollisions) collidable.push(m);
      m.checkCollisions = false;
      m.layerMask = PORTAL_LAYER;
      m.isPickable = false;
      m.freezeWorldMatrix();
      // рамки — сейчас: Babylon обновляет их лениво (getBoundingInfo меша), а drawRoom проверяет подмеши напрямую
      // (subMesh.isInFrustum). У модели предмета подмешей несколько (по материалам) — без этого их рамки остаются в
      // координатах шаблона, и модель пропадает, когда начало координат комнаты уходит из обзора
      m.getBoundingInfo();
      const n = m.getTotalVertices();
      bytes += n * 4 * (3 + 3 + 2 + 4) + m.getTotalIndices() * 4;
    }
    const pp = piecePortals(this.run, model, id);
    // две двери вплотную (в одной плоскости, без простенка) — маски не расширять друг в друга
    const touch = (p: PiecePortal, at: number) => pp.some((q) => q !== p && q.axis === p.axis && Math.abs(q.at - p.at) < 1e-6 && (Math.abs(q.lo - at) < 1e-6 || Math.abs(q.hi - at) < 1e-6));
    const portals = pp.map((p) => this.portalDef(p, touch(p, p.lo), touch(p, p.hi)));
    for (const p of portals) bytes += 24 * 12;
    const piece: PortalPiece = {
      id,
      model,
      bo,
      meshes,
      collidable,
      floor: pieceFloorRects(model, id),
      portals,
      bytes,
      collide: false,
      ms: { model: ms, scene: now() - t0 },
    };
    this.pieces.set(id, piece);
    this.bytes += bytes;
    this.built++;
    return piece;
  }

  /** Готовы ли меши куска к отрисовке (шейдеры, текстуры). */
  ready(p: PortalPiece): boolean {
    for (const m of p.meshes) if (!m.isReady(true)) return false;
    for (const q of p.portals) if (!q.mask.isReady(true) || !q.thin.isReady(true)) return false;
    return true;
  }

  /** Освободить старые куски сверх предела памяти, кроме protect. */
  trim(protect: Set<string>) {
    // предел и по памяти, и по числу кусков: каждый меш сцены Babylon перебирает в каждом кадре (даже
    // невидимый слой), так что тысячи мешей кэша стоили бы времени кадра
    const over = () => this.bytes > this.limit || this.pieces.size > this.maxPieces;
    if (!over()) return;
    for (const [id, p] of this.pieces) {
      if (!over()) break;
      if (protect.has(id)) continue;
      this.drop(id, p);
    }
  }

  private drop(id: string, p: PortalPiece) {
    this.pieces.delete(id);
    this.bytes -= p.bytes;
    for (const q of p.portals) {
      q.mask.dispose(false, false);
      q.thin.dispose(false, false);
    }
    p.bo.dispose();
    this.evicted++;
  }

  get memory(): { pieces: number; bytes: number; models: number } {
    return { pieces: this.pieces.size, bytes: this.bytes, models: this.models.size };
  }

  /** Маски-коробки проёма: от плоскости (середина стены) в сторону комнаты to — глубокая (MASK_D, когда
   *  глаз у самого проёма) и тонкая (MASK_E); без ближней грани. План (x, y↓) → Babylon (X = x, Y = z, Z = −y). */
  private portalDef(p: PiecePortal, openLo = false, openHi = false): PortalDef {
    const h = p.h;
    // в Babylon: ось прохода и направление
    const u = p.axis === 'x' ? new Vector3(p.dir, 0, 0) : new Vector3(0, 0, -p.dir);
    const p0 = p.axis === 'x' ? new Vector3(p.at, 0, 0) : new Vector3(0, 0, -p.at);
    // углы квадрата проёма в плоскости: (поперёк, высота)
    const at = (t: number, y: number, off: number): Vector3 =>
      p.axis === 'x' ? new Vector3(p.at + p.dir * off, y, -t) : new Vector3(t, y, -(p.at + p.dir * off));
    const corners = [at(p.lo, 0, 0), at(p.hi, 0, 0), at(p.hi, h, 0), at(p.lo, h, 0)];
    const center = at((p.lo + p.hi) / 2, h / 2, 0);
    // Коробка чуть шире проёма (на MASK_E в откосы, пол и перемычку): её боковые грани утоплены ВНУТРЬ
    // стен — граница области проёма на экране задаётся краем видимой геометрии своей комнаты (откос, пол,
    // перемычка обрываются на плоскости проёма), а не краем маски; иначе на общем ребре «откос — маска»
    // при растеризации остаются щели в пиксель, разные до и после смены комнаты.
    const e = MASK_E;
    const lo = p.lo - (openLo ? 0 : e), hi = p.hi + (openHi ? 0 : e);
    const box = [at(lo, -e, 0), at(hi, -e, 0), at(hi, h + e, 0), at(lo, h + e, 0)];
    const build = (depth: number, tag: string): Mesh => {
      const far = box.map((c) => c.add(u.scale(depth)));
      const pos: number[] = [];
      const idx: number[] = [];
      const quad = (a: Vector3, b: Vector3, c: Vector3, d: Vector3) => {
        const k = pos.length / 3;
        for (const v of [a, b, c, d]) pos.push(v.x, v.y, v.z);
        idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
      };
      quad(far[0], far[1], far[2], far[3]); // дальняя грань
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        quad(box[i], box[j], far[j], far[i]); // боковые (и пол, и верх)
      }
      const vd = new VertexData();
      vd.positions = pos;
      vd.indices = idx;
      const m = new Mesh(`portalMask${tag}:${p.from}>${p.to}:${p.a.connector}`, this.scene);
      vd.applyToMesh(m, false);
      m.material = this.maskMat;
      m.layerMask = PORTAL_LAYER;
      m.isPickable = false;
      m.freezeWorldMatrix();
      return m;
    };
    // Глубокая — когда глаз ближе MASK_NEAR к проёму: ближняя плоскость камеры срезала бы тонкую. Тонкая —
    // в остальных случаях: глубокая ловила бы и лучи, прошедшие плоскость в соседнем проёме вплотную
    // (две двери рядом без простенка), — они уже в другой комнате.
    const mask = build(MASK_D, '');
    const thin = build(MASK_E, 'Thin');
    // отсечение: оставить сторону to → discard, где (p − p0)·u < −CLIP_E → n = −u, d = u·p0 − CLIP_E.
    // Плоскость чуть (CLIP_E) ПЕРЕД проёмом: откос, пол и перемычка комнаты to начинаются ровно на
    // плоскости — отсечение точно по ней резало бы их край по точности интерполяции (пунктир щелей).
    const clip = new Plane(-u.x, -u.y, -u.z, Vector3.Dot(u, p0) - CLIP_E);
    const key = `${p.a.inst}/${p.a.connector}|${p.b.inst}/${p.b.connector}`;
    const shiftB = p.shift ? new Vector3(p.shift[0], 0, -p.shift[1]) : null;
    return { ...p, key, mask, thin, p0, u, corners, center, clip, shiftB };
  }

  dispose() {
    for (const [id, p] of [...this.pieces]) this.drop(id, p);
    this.models.clear();
    this.maskMat.dispose(true, false);
    this.shared.dispose();
  }
}

// ───────────────────────── рендер ─────────────────────────

export interface PortalFrameStats {
  /** комнаты, нарисованные в кадре (с повторами через разные цепочки), и уникальные */
  rooms: number;
  unique: number;
  portals: number;
  levels: number;
  /** проёмы за горизонтом (или глубже MAX_LEVEL): комната за ними нарисована без своих проёмов */
  far: number;
  /** проёмы, не открытые из-за предела номеров стенсила (залиты цветом фона) */
  capped: number;
  ms: number;
}

export interface PortalRendererOptions {
  /**
   * Горизонт, м: проёмы открываются, пока видны в кадре; проём дальше горизонта ещё открывается, но
   * комната за ним рисуется без своих проёмов (предел работы на кадр, а не туман). 0 — без предела
   * (тогда только MAX_LEVEL и 254 номера стенсила). Рекомендуется viewHorizonM(sightM) из src/gen4d/pvs.ts.
   */
  horizonM: number;
  /** игрок перешёл в соседнюю комнату (по полу) */
  onCross?(from: string, to: string): void;
}

interface Cand {
  q: PortalDef;
  /** маска этого кадра (глубокая у глаза, иначе тонкая) */
  m: Mesh;
  v: number;
  /** за горизонтом: комнату за проёмом рисуем, её проёмы — нет */
  far: boolean;
}

/** Комната в очереди кадра: её область (стенсил ref), отсечение, пирамида видимости. */
interface Job {
  p: PortalPiece;
  ref: number;
  clip: Plane;
  planes: Plane[];
  level: number;
  /** связь, сквозь которую в неё вошли (назад сквозь неё не смотрим) */
  came: string | null;
  /** сдвиг сцены (за швами бесконечного хода): комната рисуется на своём месте + off; clip и planes — в её системе */
  off: Vector3;
}

/** Scene.FOGMODE_LINEAR (без импорта класса сцены) */
const FOGMODE_LINEAR = 3;

export class PortalRenderer {
  current: string | null = null;
  /** определять текущую комнату по полу под глазом (QA выключает — чтобы сравнить кадры до/после смены) */
  autoTrack = true;
  /** рисовать проёмы (QA «призраков» выключает — остаётся только текущая комната) */
  openPortals = true;
  horizonM: number;
  readonly stats: PortalFrameStats = { rooms: 0, unique: 0, portals: 0, levels: 0, far: 0, capped: 0, ms: 0 };
  /** отладка: цепочки открытых проёмов последнего кадра (включить — присвоить []) */
  trace: string[] | null = null;
  /** комнаты последнего кадра (для предзагрузки и защиты кэша) */
  readonly lastRooms = new Set<string>();
  private active = false;
  private obs: Observer<Scene> | null = null;
  private fill: Mesh;
  private fillMat: ShaderMaterial;
  private stencilNext = 1;
  private capUsed = false;
  /** дальность непрозрачного тумана в этом кадре, м (0 — тумана нет) */
  private fogM = 0;
  private engine: AbstractEngine;
  private collideSet = new Set<string>();
  private onCross?: (from: string, to: string) => void;
  /** колбэки «кадр с текущей комнатой отрисован» (crossTo в QA) */
  private frameWaiters: (() => void)[] = [];
  /** матрицы камеры кадра и текущий сдвиг сцены */
  private view0 = new Matrix();
  private proj0 = new Matrix();
  private offNow = new Vector3();
  /** игрок прошёл шов бесконечного хода: камеру перенесли на −shift (колбэк — драйверу) */
  onWrap?: (shift: Vector3) => void;

  constructor(
    readonly scene: Scene,
    readonly camera: Camera,
    readonly cache: PieceCache,
    opts: PortalRendererOptions,
  ) {
    this.engine = scene.getEngine();
    this.horizonM = opts.horizonM;
    this.onCross = opts.onCross;
    const fm = (this.fillMat = new ShaderMaterial('rf:portalFill', scene, { vertex: 'rfPortalFill', fragment: 'rfPortalFill' }, {
      attributes: ['position'],
      uniforms: ['uColor'],
    }));
    fm.backFaceCulling = false;
    const f = (this.fill = new Mesh('portalFill', scene));
    const vd = new VertexData();
    vd.positions = [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0];
    vd.indices = [0, 1, 2, 0, 2, 3];
    vd.applyToMesh(f, false);
    f.material = fm;
    f.layerMask = PORTAL_LAYER;
    f.isPickable = false;
    f.alwaysSelectAsActiveMesh = false;
    f.freezeWorldMatrix();
  }

  /** Включить/выключить (облёт — выключен: куски не рисуются, коллизий нет, плоскость отсечения снята). */
  setActive(on: boolean) {
    if (on === this.active) return;
    this.active = on;
    if (on) {
      this.scene.clipPlane = NOOP_CLIP;
      this.obs = this.scene.onBeforeDrawPhaseObservable.add(() => this.frame());
    } else {
      if (this.obs) this.scene.onBeforeDrawPhaseObservable.remove(this.obs);
      this.obs = null;
      this.scene.clipPlane = null;
      this.setCollide(new Set());
      this.flushWaiters();
    }
  }

  get isActive(): boolean {
    return this.active;
  }

  setCurrent(id: string | null) {
    this.current = id;
  }

  /** Promise — после следующего отрисованного кадра. */
  nextFrame(): Promise<void> {
    return new Promise((res) => this.frameWaiters.push(res));
  }

  private flushWaiters() {
    const w = this.frameWaiters;
    this.frameWaiters = [];
    for (const f of w) f();
  }

  /** Все ли куски, нужные кадру (по последнему кадру), готовы. */
  allReady(): boolean {
    for (const id of this.lastRooms) {
      const p = this.cache.peek(id);
      if (!p || !this.cache.ready(p)) return false;
    }
    return this.fillMat.isReady(this.fill) && this.cache.maskMaterial.isReady();
  }

  // ───────────────────────── кадр ─────────────────────────

  private frame() {
    const t0 = now();
    const st = this.stats;
    st.rooms = st.portals = st.levels = st.far = st.capped = 0;
    if (this.trace) this.trace = [];
    this.lastRooms.clear();
    const sc = this.scene;
    this.view0.copyFrom(sc.getViewMatrix());
    this.proj0.copyFrom(sc.getProjectionMatrix());
    this.offNow.setAll(0);
    const eye = this.camera.globalPosition.clone();
    // прошёл шов бесконечного хода — камера перенесена на −shift; этот кадр (матрицы — до переноса) рисуется со
    // сдвигом +shift: картинка та же, что за швом
    const wrapped = this.autoTrack ? this.track(eye) : null;
    const root = wrapped ?? new Vector3();
    const cur = this.current ? this.cache.get(this.current) : null;
    if (!cur) {
      st.ms = now() - t0;
      return;
    }
    this.updateCollisions(cur, eye.subtract(root));
    const e = this.engine;
    this.stencilNext = 1;
    e.setAlphaMode(Constants.ALPHA_DISABLE);
    e.setDepthBuffer(true);
    e.setStencilBuffer(true);
    e.setStencilFunctionMask(0xff);
    const rootPlanes = movePlanes(sc.frustumPlanes, root.negate());
    this.setOffset(root);
    this.drawRoom(cur, 0, NOOP_CLIP, rootPlanes);
    this.capUsed = false;
    // туман — необязательная атмосфера: если он есть, за его пределом проёмы не открываем
    this.fogM = sc.fogEnabled && sc.fogMode === FOGMODE_LINEAR && sc.fogEnd > 0 ? sc.fogEnd : 0;
    if (this.openPortals && this.fillMat.isReady(this.fill) && this.cache.maskMaterial.isReady()) {
      // очередь в ширину: ближние уровни первыми получают номера стенсила
      const queue: Job[] = [{ p: cur, ref: 0, clip: NOOP_CLIP, planes: rootPlanes, level: 1, came: null, off: root }];
      for (let k = 0; k < queue.length; k++) this.portals(queue[k], eye, queue);
      if (this.capUsed) this.fillRegion(CAP);
    }
    this.setOffset(new Vector3());
    // вернуть состояние, которого ждёт Babylon (и чтобы очистка кадра чистила весь стенсил)
    e.setStencilMask(0xff);
    e.setStencilBuffer(false);
    e.setStencilFunction(Constants.ALWAYS);
    e.setStencilBackFunction(Constants.ALWAYS);
    e.setStencilOperationPass(Constants.REPLACE);
    e.setStencilBackOperationPass(Constants.REPLACE);
    e.setStencilOperationFail(Constants.KEEP);
    e.setStencilBackOperationFail(Constants.KEEP);
    e.setStencilOperationDepthFail(Constants.KEEP);
    e.setStencilBackOperationDepthFail(Constants.KEEP);
    e.setDepthFunction(Constants.LEQUAL);
    e.setDepthWrite(true);
    e.setColorWrite(true);
    sc.clipPlane = NOOP_CLIP;
    sc.resetCachedMaterial();
    st.unique = this.lastRooms.size;
    st.ms = now() - t0;
    this.flushWaiters();
  }

  /** Сдвиг сцены: вид = перенос на off · вид камеры (комнаты за швами бесконечного хода рисуются со своих мест). */
  private setOffset(off: Vector3) {
    if (off.equalsWithEpsilon(this.offNow, 1e-9)) return;
    this.offNow.copyFrom(off);
    const v = Matrix.Translation(off.x, off.y, off.z).multiply(this.view0);
    this.scene.setTransformMatrix(v, this.proj0);
  }

  /** Стенсил: тест func(ref), операции при прохождении, маска записи. */
  private stencil(func: number, ref: number, pass: number, writeMask: number) {
    const e = this.engine;
    e.setStencilFunction(func);
    e.setStencilBackFunction(func);
    e.setStencilFunctionReference(ref);
    e.setStencilOperationFail(Constants.KEEP);
    e.setStencilBackOperationFail(Constants.KEEP);
    e.setStencilOperationDepthFail(Constants.KEEP);
    e.setStencilBackOperationDepthFail(Constants.KEEP);
    e.setStencilOperationPass(pass);
    e.setStencilBackOperationPass(pass);
    e.setStencilMask(writeMask);
  }

  /** Комната в области стенсила ref, с отсечением clip; меши — по пирамиде planes. */
  private drawRoom(p: PortalPiece, ref: number, clip: Plane, planes: Plane[]) {
    const e = this.engine;
    this.stencil(Constants.EQUAL, ref, Constants.KEEP, 0x00);
    e.setDepthFunction(Constants.LEQUAL);
    e.setDepthWrite(true);
    e.setColorWrite(true);
    this.scene.clipPlane = clip;
    this.scene.resetCachedMaterial();
    for (const m of p.meshes) {
      if (!m.subMeshes) continue;
      for (const sm of m.subMeshes) {
        if (!sm.isInFrustum(planes)) continue;
        m.render(sm, false);
      }
    }
    this.stats.rooms++;
    this.lastRooms.add(p.id);
  }

  private drawMask(m: Mesh, clip: Plane) {
    const mat = this.cache.maskMaterial;
    mat.setVector4('uClip', { x: clip.normal.x, y: clip.normal.y, z: clip.normal.z, w: clip.d } as never);
    this.scene.resetCachedMaterial();
    const sm = m.subMeshes?.[0];
    if (sm) m.render(sm, false);
  }

  /** Проёмы комнаты задания j (её область — стенсил j.ref): комнаты за ними рисуются сейчас, их проёмы —
   *  в очередь. Назад сквозь проём, которым вошли (j.came), не смотрим (оттуда видна своя же сторона). */
  private portals(j: Job, eyeW: Vector3, queue: Job[]) {
    const e = this.engine;
    const { ref, clip, planes, level } = j;
    // всё — в системе комнаты задания: глаз без сдвига сцены
    const eye = eyeW.subtract(j.off);
    this.setOffset(j.off);
    const cands: Cand[] = [];
    for (const q of j.p.portals) {
      if (q.key === j.came) continue;
      const dist = rectDistance(q, eye);
      // туман (если включён) непрозрачен дальше fogEnd — проём целиком там закрыт им полностью
      if (this.fogM > 0 && dist >= this.fogM) continue;
      const m = dist < MASK_NEAR ? q.mask : q.thin;
      if (this.eligible(q, m, clip, planes, eye, level)) cands.push({ q, m, v: 0, far: (this.horizonM > 0 && dist >= this.horizonM) || level >= MAX_LEVEL });
    }
    if (!cands.length) return;
    // а) маски — только глубина: ближний проём выигрывает пиксель
    this.stencil(Constants.EQUAL, ref, Constants.KEEP, 0x00);
    e.setDepthFunction(Constants.LEQUAL);
    e.setDepthWrite(true);
    e.setColorWrite(false);
    for (const c of cands) this.drawMask(c.m, clip);
    // б) номера стенсила: INVERT с маской ref ^ v там, где маска — ближняя (глубина EQUAL)
    e.setDepthFunction(Constants.EQUAL);
    e.setDepthWrite(false);
    for (const c of cands) {
      // номера кончились: проём всё равно отмечается — номером CAP, в конце кадра цвет фона
      if (this.stencilNext > MAX_STENCIL) {
        c.v = -1;
        this.stats.capped++;
        this.capUsed = true;
      } else c.v = this.stencilNext++;
      this.stencil(Constants.EQUAL, ref, Constants.INVERT, ref ^ (c.v < 0 ? CAP : c.v));
      this.drawMask(c.m, clip);
    }
    // в) области проёмов: заливка (цвет фона, глубина «далеко»), комната за проёмом; её проёмы — в очередь
    for (const c of cands) {
      if (c.v < 0) continue;
      const q = c.q;
      this.stats.portals++;
      if (c.far) this.stats.far++;
      if (this.trace) this.trace.push(`${'  '.repeat(level - 1)}${q.from}→${q.to} v${c.v}${c.far ? ' (за горизонтом)' : ''}`);
      this.stats.levels = Math.max(this.stats.levels, level);
      this.fillRegion(c.v);
      const next = this.cache.get(q.to);
      if (!next) continue;
      let sub = planes.concat(portalPlanes(q, eye));
      let qclip = q.clip;
      let off = j.off;
      if (q.shiftB) {
        // шов: комната to — на своём месте, сцена сдвинута ещё на shiftB; плоскости — в её систему (p = p' + shiftB)
        off = j.off.add(q.shiftB);
        sub = movePlanes(sub, q.shiftB.negate());
        qclip = movePlanes([q.clip], q.shiftB.negate())[0];
      }
      this.setOffset(off);
      this.drawRoom(next, c.v, qclip, sub);
      this.setOffset(j.off);
      // за горизонтом комната видна целиком, но её проёмы не открываются (в них — цвет фона)
      if (!c.far) queue.push({ p: next, ref: c.v, clip: qclip, planes: sub, level: level + 1, came: q.key, off });
    }
  }

  private fillRegion(v: number) {
    const e = this.engine;
    this.stencil(Constants.EQUAL, v, Constants.KEEP, 0x00);
    e.setDepthFunction(Constants.ALWAYS);
    e.setDepthWrite(true);
    e.setColorWrite(true);
    const c = this.scene.clearColor;
    this.fillMat.setVector4('uColor', { x: c.r, y: c.g, z: c.b, w: 1 } as never);
    this.scene.resetCachedMaterial();
    const sm = this.fill.subMeshes?.[0];
    if (sm) this.fill.render(sm, false);
  }

  /** Открывать ли проём (виден ли в кадре): глаз со стороны комнаты (с допуском), хоть часть — за
   *  текущей плоскостью отсечения и в пирамиде видимости. */
  private eligible(q: PortalDef, mask: Mesh, clip: Plane, planes: Plane[], eye: Vector3, level: number): boolean {
    // сторона: глаз — со стороны комнаты (на самой плоскости — тоже: так видна соседняя дверь вплотную);
    // у проёмов текущей комнаты — с допуском EYE_TOL за плоскость
    // (смена комнаты — на самой плоскости; глаз в миллиметре за ней ещё видит комнату, из которой вышел)
    const s = (eye.x - q.p0.x) * q.u.x + (eye.y - q.p0.y) * q.u.y + (eye.z - q.p0.z) * q.u.z;
    if (s >= (level === 1 ? EYE_TOL : 1e-4)) return false;
    // коробка маски хоть частью строго по сохраняемую сторону отсечения (n·p + d < 0)
    const box = mask.getBoundingInfo().boundingBox.vectorsWorld;
    let keep = false;
    for (const c of box) if (clip.normal.x * c.x + clip.normal.y * c.y + clip.normal.z * c.z + clip.d < -1e-4) keep = true;
    if (!keep) return false;
    // пирамида: коробка маски целиком снаружи какой-то плоскости — не видна
    for (const pl of planes) {
      let inside = false;
      for (const v of box) if (pl.dotCoordinate(v) >= -1e-6) { inside = true; break; }
      if (!inside) return false;
    }
    return true;
  }

  // ───────────────────────── текущая комната и физика ─────────────────────────

  /** Текущая комната по полу под глазом: своя или соседа (граница — плоскость проёма). Шов бесконечного хода: глаз
   *  за плоскостью шва (в его проёме) — камера переносится на −shift, текущая — комната за швом; возвращает shift. */
  private track(eye: Vector3): Vector3 | null {
    if (!this.current) return null;
    const cur = this.cache.get(this.current);
    if (!cur) return null;
    for (const q of cur.portals) {
      if (!q.shiftB) continue;
      const s = (eye.x - q.p0.x) * q.u.x + (eye.z - q.p0.z) * q.u.z;
      const t = q.axis === 'x' ? -eye.z : eye.x;
      if (s <= 0 || s > 0.6 || t < q.lo || t > q.hi) continue;
      const cam = this.camera as Camera & { position?: Vector3 };
      if (!cam.position) continue;
      cam.position.subtractInPlace(q.shiftB);
      this.camera.computeWorldMatrix();
      const from = this.current;
      this.current = q.to;
      this.onWrap?.(q.shiftB);
      this.onCross?.(from, q.to);
      return q.shiftB.clone();
    }
    const x = eye.x, y = -eye.z;
    if (inRects(cur.floor, x, y)) return null;
    for (const q of cur.portals) {
      if (q.shiftB) continue;
      const n = this.cache.get(q.to);
      if (n && inRects(n.floor, x, y)) {
        const from = this.current;
        this.current = q.to;
        this.onCross?.(from, q.to);
        return null;
      }
    }
    return null;
  }

  private updateCollisions(cur: PortalPiece, eye: Vector3) {
    const x = eye.x, y = -eye.z;
    let best: string | null = null;
    let bd = COLLIDE_NEAR;
    for (const q of cur.portals) {
      // за швом соседа нет рядом (он на своём месте) — его коллизии не нужны
      if (q.shiftB) continue;
      const r = q.rect;
      const d = Math.hypot(Math.max(0, r.x0 - x, x - r.x1), Math.max(0, r.y0 - y, y - r.y1));
      if (d < bd) {
        bd = d;
        best = q.to;
      }
    }
    const want = new Set<string>([cur.id]);
    if (best) want.add(best);
    this.setCollide(want);
  }

  private setCollide(want: Set<string>) {
    for (const id of this.collideSet) {
      if (want.has(id)) continue;
      const p = this.cache.peek(id);
      if (p) {
        for (const m of p.collidable) m.checkCollisions = false;
        p.collide = false;
      }
    }
    for (const id of want) {
      const p = this.cache.get(id);
      if (!p || p.collide) continue;
      for (const m of p.collidable) m.checkCollisions = true;
      p.collide = true;
    }
    this.collideSet = want;
  }

  /** Комнаты с коллизиями сейчас. */
  get colliding(): string[] {
    return [...this.collideSet];
  }

  dispose() {
    this.setActive(false);
    this.fill.dispose(false, false);
    this.fillMat.dispose(true, false);
  }
}

/** Боковые плоскости пирамиды «глаз — проём» (+ сама плоскость проёма); внутрь — положительно.
 *  Глаз почти на плоскости — без боковых (пирамида вырождается). */
function portalPlanes(q: PortalDef, eye: Vector3): Plane[] {
  const out: Plane[] = [];
  const s = Vector3.Dot(eye.subtract(q.p0), q.u);
  // плоскость проёма: дальше неё — внутри (n = u)
  out.push(new Plane(q.u.x, q.u.y, q.u.z, -Vector3.Dot(q.u, q.p0)));
  // глаз на плоскости или за ней (допуск у текущей комнаты) — боковых нет: пирамида вырождается
  if (s > -1e-4) return out;
  const c = q.corners;
  for (let i = 0; i < 4; i++) {
    const a = c[i].subtract(eye), b = c[(i + 1) % 4].subtract(eye);
    const n = Vector3.Cross(a, b);
    const len = n.length();
    if (len < 1e-9) continue;
    n.scaleInPlace(1 / len);
    if (Vector3.Dot(n, q.center.subtract(eye)) < 0) n.scaleInPlace(-1);
    out.push(new Plane(n.x, n.y, n.z, -Vector3.Dot(n, eye)));
  }
  return out;
}

/** Плоскости, перенесённые на d (точки p → p + d): n·(p − d) + c = 0 → свободный член c − n·d. */
function movePlanes(planes: Plane[], d: Vector3): Plane[] {
  if (d.x === 0 && d.y === 0 && d.z === 0) return planes;
  return planes.map((pl) => new Plane(pl.normal.x, pl.normal.y, pl.normal.z, pl.d - Vector3.Dot(pl.normal, d)));
}

/** Расстояние от точки до прямоугольника проёма (в его плоскости), м. */
function rectDistance(q: PortalDef, eye: Vector3): number {
  // проём: поперёк — [lo, hi] (план), высота [0, h], плоскость at
  const t = q.axis === 'x' ? -eye.z : eye.x;
  const dt = Math.max(0, q.lo - t, t - q.hi);
  const dy = Math.max(0, -eye.y, eye.y - q.h);
  const dn = q.axis === 'x' ? eye.x - q.at : -eye.z - q.at;
  return Math.hypot(dt, dy, dn);
}

function inRects(rects: Rect[], x: number, y: number): boolean {
  for (const r of rects) if (x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1) return true;
  return false;
}
