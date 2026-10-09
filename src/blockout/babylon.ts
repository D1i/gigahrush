// Адаптер Babylon.js: BlockoutModel → меши сцены. Зависит только от @babylonjs/core и ./types.
//
// Как устроено:
//  • Твёрдые объёмы (стены, перегородки, перемычки, колонны) — свой батчер боксов в VertexData:
//    по одному мешу на вид, внутри меша — подмеши по тайлам TILE_M×TILE_M (отсечение по камере и
//    быстрые коллизии: коллайдер проверяет только тайлы рядом). merge: false — по мешу на бокс.
//  • Нормали плоские по граням, обход — лицевой для левой системы Babylon (backFaceCulling включён).
//    При слиянии внутренние грани (где объёмы касаются друг друга) не выпускаются — меньше
//    треугольников и ничего не просвечивает на стыках (стена | перемычка) при сглаживании.
//  • UV — мировые метры, планарно по грани: общая сетка-текстура 1 м идёт непрерывно по соседним боксам.
//  • Полы и потолки — по мешу на экземпляр (metadata.inst), пол/потолок проёмов — отдельными мешами.
//  • Мебель — меш на предмет: позиция в центре на полу, rotation.y = rot·π/180. Есть модель предмета (propModel —
//    шаблон из ассета, перед = −Z) — бокс остаётся невидимым коллайдером, видна модель; подвесное (тег «потолок») —
//    модель под потолком (верх модели в y = 0). Укрытие (PropBox.cover — кровать, стол на ножках): коллайдер — плита
//    от просвета clear до верха (metadata.cover / clear), под ней пролезают лёжа / на четвереньках; без модели видна
//    болванка «плита + 4 ножки».
//  • Отделка (обои, кафель, краска, полы): облицовка по model.faces — квады на 1.5 мм перед гранью
//    стены, один меш на отделку; dado делит грань по высоте. UV — метры / размер повтора (tileW, tileH).
//
// Координаты: план (x вправо, y вниз, z вверх) → Babylon X = x, Y = z, Z = −y.
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { SubMesh } from '@babylonjs/core/Meshes/subMesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture';
import { DOOR_STYLE_BY_ID, doorGeometry, type DoorLeafGeo, type DoorPart, type DoorStyle, type HandleKind } from './doors';
import { stairMeshes } from './stairs';
import type { BlockoutModel, DeadEnd, DoorSlot, PropCoverKind, Rect, RunFinish, Solid, SolidKind, Surface, WallFace } from './types';

export type BlockoutMaterialKey = 'wall' | 'partition' | 'lintel' | 'column' | 'floor' | 'portalFloor' | 'ceiling' | 'deadEnd';

export interface BabylonBlockoutOptions {
  /** включить checkCollisions у стен, полов, перемычек, колонн и мебели (для FreeCamera/персонажа) */
  collisions?: boolean;
  /** сливать стены в один меш на материал (меньше draw calls); по умолчанию true */
  merge?: boolean;
  /** PNG data:URI текстур вида сверху по propId — кладутся на верхнюю грань болванки мебели */
  propTextures?: Record<string, string>;
  /** цвета материалов (#rrggbb) */
  colors?: Partial<Record<BlockoutMaterialKey, string>>;
  /** отделка из модели (облицовка стен по faces, полы по Surface.finish); по умолчанию true.
   *  false — как без отделки: стены и полы с сеткой. */
  finishes?: boolean;
  /** цвет панели тупика (#rrggbb) или null — обычная панель. Панели с цветом — отдельный меш на цвет
   *  со своим слегка светящимся материалом: например, в складчатом прогоне «дверь в другой слой» или
   *  «дверь за границей видимого множества» (docs/BLOCKOUT-BABYLON.md §12). */
  deadEndColor?: (d: DeadEnd) => string | null | undefined;
  /** модель предмета по propId (шаблон: выключенный меш, перед = −Z, низ — пол, у подвесных верх — 0) или null —
   *  бокс болванки. Шаблон клонируется (геометрия и материалы общие). */
  propModel?: (propId: string) => Mesh | null;
  /** общие материалы и текстуры для многих болванок (createBlockoutShared): куски комнат портального
   *  рендера строятся десятками — без этого у каждого была бы своя сетка-текстура и свои материалы.
   *  dispose() болванки общее не трогает — его освобождает shared.dispose(). */
  shared?: BlockoutShared;
  /** двери (BlockoutModel.doors): поза полотна при постройке — угол (градусы) и ручка (0…1, нажата); null — из слота
   *  (закрыто / распахнуто в покое). Анимация открытия (src/view3d/doorAnim.ts) отдаёт текущую позу: кусок комнаты,
   *  пересобранный посреди анимации, встаёт в ту же позу — без скачка */
  doorPose?: (slot: DoorSlot) => DoorPose | null;
}

/** Поза двери: угол полотна (градусы, к комнате) и ручка (0 — отпущена, 1 — нажата / засов отодвинут / штурвал
 *  докручен). */
export interface DoorPose {
  angle: number;
  handle: number;
}

/** Полотно двери, которое можно двигать (выход, открытый выход): меш на оси петель, ручка — его ребёнок. */
export interface DoorLeafMesh {
  mesh: Mesh;
  handle: Mesh | null;
  geo: DoorLeafGeo;
  /** поворот двери в мире (RotationY), рад: полотно — yaw + sign·угол */
  yaw: number;
}

/** Подвижная дверь куска: слот, дверь из каталога, полотна. */
export interface DoorMeshes {
  slot: DoorSlot;
  style: DoorStyle;
  leaves: DoorLeafMesh[];
}

/** Общие материалы/текстуры нескольких болванок одной сцены (см. BabylonBlockoutOptions.shared). */
export interface BlockoutShared {
  readonly scene: Scene;
  readonly grid: DynamicTexture | null;
  readonly materials: Record<BlockoutMaterialKey, StandardMaterial>;
  readonly finishMaterials: Record<string, StandardMaterial>;
  /** внутреннее: материалы мебели, верхов мебели, панелей с цветом; все текстуры и доп. материалы */
  readonly propMats: Map<string, StandardMaterial>;
  readonly topMats: Map<string, StandardMaterial>;
  readonly tintMats: Map<string, StandardMaterial>;
  /** материал дверей (цвета — в вершинах) */
  readonly doorMats: Map<string, StandardMaterial>;
  readonly textures: BaseTexture[];
  readonly extraMats: StandardMaterial[];
  dispose(): void;
}

/** Создать общий набор материалов (цвета — как BabylonBlockoutOptions.colors). */
export function createBlockoutShared(scene: Scene, colors?: Partial<Record<BlockoutMaterialKey, string>>): BlockoutShared {
  const cols = { ...BLOCKOUT_COLORS, ...(colors ?? {}) };
  const textures: BaseTexture[] = [];
  const grid = createGridTexture(scene);
  if (grid) textures.push(grid);
  const materials = {} as Record<BlockoutMaterialKey, StandardMaterial>;
  for (const k of Object.keys(BLOCKOUT_COLORS) as BlockoutMaterialKey[]) {
    const m = new StandardMaterial('blockout:' + k, scene);
    m.diffuseColor = safeColor(cols[k]);
    m.specularColor = new Color3(0.03, 0.03, 0.03);
    if (grid && k !== 'deadEnd') m.diffuseTexture = grid;
    materials[k] = m;
  }
  const extraMats: StandardMaterial[] = [];
  let disposed = false;
  return {
    scene,
    grid,
    materials,
    finishMaterials: {},
    propMats: new Map(),
    topMats: new Map(),
    tintMats: new Map(),
    doorMats: new Map(),
    textures,
    extraMats,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const m of [...Object.values(materials), ...extraMats]) m.dispose(false, false);
      for (const t of textures) t.dispose();
    },
  };
}

export interface BabylonBlockout {
  root: TransformNode;
  walls: Mesh[];
  floors: Mesh[];
  ceilings: Mesh[];
  props: Mesh[];
  deadEnds: Mesh[];
  /** двери: наличники и неподвижные полотна (один меш), подвижные полотна — в doorLeaves */
  doors: Mesh[];
  /** подвижные двери (выходы и открытые выходы) по «inst/connector» */
  doorLeaves: Map<string, DoorMeshes>;
  /** общие материалы по видам — можно перекрасить или заменить текстуру (см. docs/BLOCKOUT-BABYLON.md) */
  materials: Record<BlockoutMaterialKey, StandardMaterial>;
  /** облицовка стен: по мешу на отделку (metadata.kind = 'facing', finishId) */
  facings: Mesh[];
  /** материалы отделок по id (облицовка и полы); текстура — одна на отделку */
  finishMaterials: Record<string, StandardMaterial>;
  /** id экземпляра по мешу (пол/потолок/мебель), иначе null */
  instOf(mesh: { metadata?: unknown } | null | undefined): string | null;
  /** показать/скрыть потолки (например, для вида сверху) */
  setCeilingsVisible(v: boolean): void;
  dispose(): void;
}

/** metadata каждого меша болванки. */
export interface BlockoutMeta {
  kind: SolidKind | 'floor' | 'portalFloor' | 'ceiling' | 'portalCeiling' | 'prop' | 'propTop' | 'deadEnd' | 'facing' | 'door' | 'doorLeaf' | 'doorHandle' | 'stair';
  /** экземпляр комнаты (полы, потолки, мебель, тупики при merge: false) */
  inst?: string;
  propId?: string;
  name?: string;
  connector?: string;
  /** отделка (облицовка, пол с отделкой) */
  finishId?: string;
  /** укрытие (PropBox.cover) — только у меша-коллайдера предмета: под кровать пролезают лёжа, под стол — на
   *  четвереньках (src/view3d/posture.ts ищет его среди коллайдеров) */
  cover?: PropCoverKind;
  /** просвет укрытия: низ плиты коллайдера над его началом координат (полом предмета), м */
  clear?: number;
}

/** Цвета по умолчанию: бетон, штукатурка, янтарные перемычки, «подъездный» пол проёмов. */
export const BLOCKOUT_COLORS: Record<BlockoutMaterialKey, string> = {
  wall: '#b9b3a7',
  partition: '#d9ccab',
  lintel: '#c8955a',
  column: '#8f8b83',
  floor: '#8c7b67',
  portalFloor: '#5fa596',
  ceiling: '#dedad2',
  deadEnd: '#8a4630',
};

/** Сторона тайла подмешей у слитых стен, м. */
const TILE_M = 16;
/** Дверная панель тупика: толщина и насколько утоплена в стену, м. */
const PANEL_T = 0.04;
const PANEL_IN = 0.025;
/** Облицовка отстоит от грани стены внутрь комнаты, м (плюс zOffset материала — без мерцания издалека). */
const FACING_OFF = 0.0015;

// ───────────────────────── батчер геометрии ─────────────────────────

type UVFn = (x: number, y: number, z: number) => [number, number];

/** Накопитель вершин: осевые грани и боксы с плоскими нормалями и мировыми UV. */
export class BoxBatch {
  readonly p: number[] = [];
  readonly n: number[] = [];
  readonly uv: number[] = [];
  readonly i: number[] = [];
  readonly c: number[] | null;
  /** цвет вершин для следующих граней (если батч с цветами) */
  color: [number, number, number, number] = [1, 1, 1, 1];

  constructor(withColors = false) {
    this.c = withColors ? [] : null;
  }

  get verts(): number {
    return this.p.length / 3;
  }

  /** Грань в плоскости «ось ax = at» (0 — X, 1 — Y, 2 — Z), s — знак внешней нормали.
   *  [a0, a1] × [b0, b1] — диапазоны по осям (ax+1)%3 и (ax+2)%3. */
  face(ax: 0 | 1 | 2, s: 1 | -1, at: number, a0: number, a1: number, b0: number, b1: number, uvf?: UVFn) {
    const ia = (ax + 1) % 3;
    const ib = (ax + 2) % 3;
    const base = this.verts;
    const v = [0, 0, 0];
    const corners = [a0, b0, a1, b0, a1, b1, a0, b1];
    for (let k = 0; k < 8; k += 2) {
      v[ax] = at;
      v[ia] = corners[k];
      v[ib] = corners[k + 1];
      this.p.push(v[0], v[1], v[2]);
      this.n.push(ax === 0 ? s : 0, ax === 1 ? s : 0, ax === 2 ? s : 0);
      if (uvf) this.uv.push(...uvf(v[0], v[1], v[2]));
      // мировые метры: X-грани → (Z, Y), Y-грани → (X, Z), Z-грани → (X, Y)
      else if (ax === 0) this.uv.push(v[2], v[1]);
      else if (ax === 1) this.uv.push(v[0], v[2]);
      else this.uv.push(v[0], v[1]);
      if (this.c) this.c.push(...this.color);
    }
    // Babylon (левая система) считает лицевым треугольник, у которого cross(p1−p0, p2−p0) смотрит
    // ПРОТИВ внешней нормали. Обход углов (a0,b0)→(a1,b0)→(a1,b1) даёт cross по +ax.
    if (s > 0) this.i.push(base, base + 2, base + 1, base, base + 3, base + 2);
    else this.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** Осевой бокс в координатах Babylon. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, uvf?: UVFn) {
    this.face(0, -1, x0, y0, y1, z0, z1, uvf);
    this.face(0, 1, x1, y0, y1, z0, z1, uvf);
    this.face(1, -1, y0, z0, z1, x0, x1, uvf);
    this.face(1, 1, y1, z0, z1, x0, x1, uvf);
    this.face(2, -1, z0, x0, x1, y0, y1, uvf);
    this.face(2, 1, z1, x0, x1, y0, y1, uvf);
  }

  /** Бокс по прямоугольнику плана и отметкам z (план → Babylon). */
  planBox(r: Rect, z0: number, z1: number, uvf?: UVFn) {
    this.box(r.x0, z0, -r.y1, r.x1, z1, -r.y0, uvf);
  }

  /** Горизонтальная плоскость по прямоугольнику плана: up — нормаль вверх (пол) или вниз (потолок). */
  planQuad(r: Rect, z: number, up: boolean, uvf?: UVFn) {
    this.face(1, up ? 1 : -1, z, -r.y1, -r.y0, r.x0, r.x1, uvf);
  }

  /** Облицовка грани стены: вертикальный квад в плоскости грани f, на off перед ней (по нормали внутрь
   *  комнаты), по длине — от a0 до a1 (координата плана вдоль линии: y для грани x = const, x для
   *  y = const), по высоте — z0..z1. UV: u — мировая координата вдоль грани слева направо (если
   *  смотреть на стену из комнаты) / tileW, v — высота от пола base / tileH (низ картинки у пола). */
  facing(f: WallFace, a0: number, a1: number, z0: number, z1: number, tileW: number, tileH: number, base: number, off = FACING_OFF) {
    const [nx, ny] = f.normal;
    if (Math.abs(nx) >= Math.abs(ny)) {
      // плоскость x = const; Babylon-нормаль ±X, «вправо» для смотрящего на неё: +X → +Z, −X → −Z
      const s = nx > 0 ? 1 : -1;
      this.face(0, s, f.line[0] + s * off, z0, z1, -a1, -a0, (_x, y, z) => [(s * z) / tileW, (y - base) / tileH]);
    } else {
      // плоскость y = const; Babylon-нормаль Z = −ny, «вправо»: +Z → −X, −Z → +X
      const bn = ny > 0 ? -1 : 1;
      this.face(2, bn, -(f.line[1] + ny * off), a0, a1, z0, z1, (x, y) => [(-bn * x) / tileW, (y - base) / tileH]);
    }
  }

  toVertexData(): VertexData {
    const vd = new VertexData();
    vd.positions = new Float32Array(this.p);
    vd.normals = new Float32Array(this.n);
    vd.uvs = new Float32Array(this.uv);
    if (this.c) vd.colors = new Float32Array(this.c);
    vd.indices = this.verts > 65535 ? new Uint32Array(this.i) : new Uint16Array(this.i);
    return vd;
  }

  toMesh(name: string, scene: Scene): Mesh {
    const m = new Mesh(name, scene);
    if (this.i.length) this.toVertexData().applyToMesh(m, false);
    return m;
  }
}

// ───────────────────────── сетка «прототипного» блокаута ─────────────────────────

/** Текстура-сетка на 1 м: тонкие линии каждые 0.1 м, толстые на границе метра. Белая основа —
 *  оттенок задаёт diffuseColor материала. null — нет canvas (например, NullEngine без полифила). */
export function createGridTexture(scene: Scene, size = 512): DynamicTexture | null {
  try {
    const t = new DynamicTexture('blockout:grid', { width: size, height: size }, scene, true);
    const c = t.getContext() as unknown as CanvasRenderingContext2D;
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, size, size);
    const step = size / 10;
    const thin = Math.max(1, Math.round(size / 256));
    c.fillStyle = 'rgba(0,0,0,0.16)';
    for (let k = 1; k < 10; k++) {
      const q = Math.round(k * step - thin / 2);
      c.fillRect(q, 0, thin, size);
      c.fillRect(0, q, size, thin);
    }
    // метровая линия — по половине у каждого края, чтобы на стыке плиток была цельной
    const thick = Math.max(2, Math.round(size / 170));
    c.fillStyle = 'rgba(0,0,0,0.42)';
    for (const q of [0, size - thick]) {
      c.fillRect(q, 0, thick, size);
      c.fillRect(0, q, size, thick);
    }
    t.update(false);
    t.wrapU = Texture.WRAP_ADDRESSMODE;
    t.wrapV = Texture.WRAP_ADDRESSMODE;
    t.anisotropicFilteringLevel = 8;
    return t;
  } catch {
    return null;
  }
}

// ───────────────────────── сборка ─────────────────────────

const meta = (m: { metadata: unknown }, md: BlockoutMeta) => (m.metadata = md);
const deg = Math.PI / 180;

/** Построить болванку в сцене. Координаты: X = x, Y = z, Z = −y (см. types.ts). */
export function buildBabylonBlockout(scene: Scene, model: BlockoutModel, opts: BabylonBlockoutOptions = {}): BabylonBlockout {
  const merge = opts.merge !== false;
  const coll = !!opts.collisions;
  const colors = { ...BLOCKOUT_COLORS, ...(opts.colors ?? {}) };
  const slab = Math.max(0, model.options?.slabM ?? 0);

  const root = new TransformNode('blockout', scene);
  const allMeshes: Mesh[] = [];
  // материалы и текстуры: свои (освобождаются в dispose) или общие (opts.shared — не трогаем)
  const sh = opts.shared ?? createBlockoutShared(scene, colors);
  const ownShared = !opts.shared;
  const { textures, extraMats, materials, finishMaterials } = sh;

  // ── отделки: материал (и текстура) — один на id ──
  const useFin = opts.finishes !== false;
  const finById = new Map<string, RunFinish>((model.finishes ?? []).map((f) => [f.id, f]));
  const finishMat = (id: string | null | undefined): { mat: StandardMaterial; fin: RunFinish } | null => {
    const fin = id && useFin ? finById.get(id) : undefined;
    if (!fin) return null;
    let m = finishMaterials[fin.id];
    if (!m) {
      m = finishMaterials[fin.id] = new StandardMaterial('blockout:finish:' + fin.id, scene);
      if (fin.tex && fin.tex.startsWith('data:')) {
        const t = new Texture(fin.tex, scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
        t.wrapU = t.wrapV = Texture.WRAP_ADDRESSMODE;
        t.anisotropicFilteringLevel = 8;
        textures.push(t);
        m.diffuseTexture = t;
        m.diffuseColor = Color3.White();
      } else m.diffuseColor = safeColor(fin.color);
      // лёгкая матовость: слабый широкий блик
      m.specularColor = new Color3(0.05, 0.05, 0.05);
      m.specularPower = 24;
      // облицовка лежит в 1.5 мм от стены — сдвиг глубины убирает мерцание при взгляде издалека
      if (fin.surface !== 'floor') m.zOffset = -1;
      extraMats.push(m);
    }
    return { mat: m, fin };
  };
  const tileOf = (f: RunFinish): [number, number] => [f.tileW > 0 ? f.tileW : 1, f.tileH > 0 ? f.tileH : 1];

  const add = (m: Mesh, md: BlockoutMeta, mat: StandardMaterial, collide: boolean): Mesh => {
    m.parent = root;
    m.material = mat;
    meta(m, md);
    m.checkCollisions = coll && collide;
    allMeshes.push(m);
    return m;
  };

  // ── твёрдые объёмы ──
  const walls: Mesh[] = [];
  const touch = touchIndex(model.solids);
  const KINDS: SolidKind[] = ['wall', 'partition', 'lintel', 'column'];
  for (const kind of KINDS) {
    const list = model.solids.filter((s) => s.kind === kind);
    if (!list.length) continue;
    if (!merge) {
      list.forEach((s, idx) => {
        const g = new BoxBatch();
        g.planBox(s.rect, s.z0, s.z1);
        walls.push(add(g.toMesh(`${kind}:${idx}`, scene), { kind }, materials[kind], true));
      });
      continue;
    }
    // раскладка по тайлам: подмеш на тайл — отсечение по камере и коллизии только с ближними тайлами
    const tiles = new Map<string, typeof list>();
    for (const s of list) {
      const key = `${Math.floor((s.rect.x0 + s.rect.x1) / 2 / TILE_M)},${Math.floor((s.rect.y0 + s.rect.y1) / 2 / TILE_M)}`;
      const t = tiles.get(key);
      if (t) t.push(s);
      else tiles.set(key, [s]);
    }
    const g = new BoxBatch();
    const ranges: [number, number, number, number][] = [];
    for (const t of tiles.values()) {
      const v0 = g.verts;
      const i0 = g.i.length;
      for (const s of t) emitOuterFaces(g, s, touch);
      ranges.push([v0, g.verts - v0, i0, g.i.length - i0]);
    }
    const m = g.toMesh(kind, scene);
    if (ranges.length > 1) {
      m.releaseSubMeshes();
      for (const [v0, vc, i0, ic] of ranges) new SubMesh(0, v0, vc, i0, ic, m);
    }
    walls.push(add(m, { kind }, materials[kind], true));
  }

  // ── полы и потолки: меш на экземпляр, проёмы (inst = null) — отдельно ──
  const floorZ = new Map<string, number>();
  const byInst = (list: Surface[]) => {
    const map = new Map<string | null, Surface[]>();
    for (const s of list) {
      const a = map.get(s.inst);
      if (a) a.push(s);
      else map.set(s.inst, [s]);
    }
    return map;
  };
  const floors: Mesh[] = [];
  for (const [inst, list] of byInst(model.floors)) {
    const portal = inst == null;
    // пол с отделкой: UV = метры / размер повтора (линолеум, паркет, плитка), иначе — сетка
    const fm = portal ? null : finishMat(list.find((s) => s.finish)?.finish);
    let uvf: UVFn | undefined;
    if (fm) {
      const [tw, th] = tileOf(fm.fin);
      uvf = (x, _y, z) => [x / tw, z / th];
    }
    const g = new BoxBatch();
    for (const s of list) for (const r of s.rects) slab > 0 ? g.planBox(r, s.z - slab, s.z, uvf) : g.planQuad(r, s.z, true, uvf);
    if (inst != null) floorZ.set(inst, list[0].z);
    const m = g.toMesh(portal ? 'portalFloor' : `floor:${inst}`, scene);
    const md: BlockoutMeta = portal ? { kind: 'portalFloor' } : { kind: 'floor', inst: inst! };
    if (fm) md.finishId = fm.fin.id;
    floors.push(add(m, md, fm ? fm.mat : materials[portal ? 'portalFloor' : 'floor'], true));
  }
  const ceilings: Mesh[] = [];
  for (const [inst, list] of byInst(model.ceilings)) {
    const g = new BoxBatch();
    for (const s of list) for (const r of s.rects) slab > 0 ? g.planBox(r, s.z, s.z + slab) : g.planQuad(r, s.z, false);
    const portal = inst == null;
    const m = g.toMesh(portal ? 'portalCeiling' : `ceiling:${inst}`, scene);
    ceilings.push(add(m, portal ? { kind: 'portalCeiling' } : { kind: 'ceiling', inst }, materials.ceiling, false));
  }

  // ── облицовка: квады по faces, батч по отделке; dado — низ грани до heightM другой отделкой ──
  const facings: Mesh[] = [];
  if (useFin && model.faces?.length) {
    const parts = new Map<string, { f: WallFace; z0: number; z1: number }[]>();
    const push = (id: string, f: WallFace, z0: number, z1: number) => {
      if (z1 - z0 < 1e-4 || !finById.has(id)) return;
      const a = parts.get(id);
      if (a) a.push({ f, z0, z1 });
      else parts.set(id, [{ f, z0, z1 }]);
    };
    for (const f of model.faces) {
      const fin = f.finish ? finById.get(f.finish) : undefined;
      if (!fin) continue;
      const base = floorZ.get(f.inst) ?? 0;
      const dado = fin.dado && finById.has(fin.dado.finishId) && fin.dado.heightM > 0 ? fin.dado : null;
      const cut = dado ? base + dado.heightM : -Infinity;
      if (dado) push(dado.finishId, f, f.z0, Math.min(f.z1, cut));
      push(fin.id, f, Math.max(f.z0, cut), f.z1);
    }
    // Концы граней. Облицовка стоит на FACING_OFF перед стеной, поэтому на выпуклом углу (колонна,
    // торец у проёма) соседние облицовки не сходятся — конец продлеваем на FACING_OFF. Но если в той же
    // плоскости к концу примыкает другая грань (ядро режет стену на участки, над дверью — перемычка),
    // продление легло бы на неё внахлёст и замерцало: там конец не трогаем, а на высоту, которую сосед
    // не закрывает (стена рядом с перемычкой — до низа перемычки), кладём узкую полоску.
    // Плоскость — по комнате: грани разных комнат не смыкаются (между ними стена gap или перегородка t),
    // а общий ключ резал бы облицовку комнаты по отметкам dado чужих комнат — и разрезка зависела бы от
    // состава модели (в подпрогонах складчатого прогона это дало бы разные рёбра на одной стене).
    const geo = (f: WallFace) => {
      const vx = Math.abs(f.normal[0]) >= Math.abs(f.normal[1]);
      const [x1, y1, x2, y2] = f.line;
      return {
        key: f.inst + '|' + (vx ? 'x' : 'y') + (vx ? Math.sign(f.normal[0]) : Math.sign(f.normal[1])) + ':' + Math.round((vx ? x1 : y1) * 1e4),
        a0: vx ? Math.min(y1, y2) : Math.min(x1, x2),
        a1: vx ? Math.max(y1, y2) : Math.max(x1, x2),
      };
    };
    const byPlane = new Map<string, WallFace[]>();
    // отметки z плоскости: границы граней и высоты dado — по ним режутся все квады этой плоскости, чтобы
    // у соседей совпадали вершины (без T-стыков, по которым при сглаживании просвечивает стена)
    const zMarks = new Map<string, number[]>();
    for (const f of model.faces) {
      const fin = f.finish ? finById.get(f.finish) : undefined;
      if (!fin) continue;
      const k = geo(f).key;
      const a = byPlane.get(k);
      if (a) a.push(f);
      else byPlane.set(k, [f]);
      const zs = zMarks.get(k) ?? [];
      zs.push(f.z0, f.z1);
      if (fin.dado) zs.push((floorZ.get(f.inst) ?? 0) + fin.dado.heightM);
      zMarks.set(k, zs);
    }
    /** z-интервалы соседей в той же плоскости, примыкающих к концу грани: к началу (end = 0) — те, что
     *  там заканчиваются, к концу (end = 1) — те, что там начинаются. */
    const coverAt = (f: WallFace, end: 0 | 1): [number, number][] => {
      const me = geo(f);
      return (byPlane.get(me.key) ?? [])
        .filter((g) => g !== f && (end === 0 ? Math.abs(geo(g).a1 - me.a0) < 1e-4 : Math.abs(geo(g).a0 - me.a1) < 1e-4))
        .map((g) => [g.z0, g.z1]);
    };
    /** [z0, z1] минус объединение covers. */
    const uncovered = (z0: number, z1: number, covers: [number, number][]): [number, number][] => {
      let out: [number, number][] = [[z0, z1]];
      for (const [c0, c1] of covers)
        out = out.flatMap(([a, b]): [number, number][] => (c1 <= a || c0 >= b ? [[a, b]] : ([[a, Math.min(b, c0)], [Math.max(a, c1), b]] as [number, number][]).filter(([p, q]) => q - p > 1e-4)));
      return out;
    };
    for (const [id, list] of parts) {
      const fm = finishMat(id)!;
      const [tw, th] = tileOf(fm.fin);
      const g = new BoxBatch();
      for (const { f, z0, z1 } of list) {
        const { key, a0, a1 } = geo(f);
        const base = floorZ.get(f.inst) ?? 0;
        const marks = zMarks.get(key) ?? [];
        // квад от b0 до b1 по длине и p..q по высоте, разрезанный по отметкам плоскости
        const quad = (b0: number, b1: number, p: number, q: number) => {
          const cuts = [p, ...marks.filter((z) => z > p + 1e-4 && z < q - 1e-4).sort((x, y) => x - y), q].filter((z, i, a) => i === 0 || z - a[i - 1] > 1e-6);
          for (let i = 1; i < cuts.length; i++) g.facing(f, b0, b1, cuts[i - 1], cuts[i], tw, th, base);
        };
        const lo = coverAt(f, 0);
        const hi = coverAt(f, 1);
        quad(lo.length ? a0 : a0 - FACING_OFF, hi.length ? a1 : a1 + FACING_OFF, z0, z1);
        if (lo.length) for (const [p, q] of uncovered(z0, z1, lo)) quad(a0 - FACING_OFF, a0, p, q);
        if (hi.length) for (const [p, q] of uncovered(z0, z1, hi)) quad(a1, a1 + FACING_OFF, p, q);
      }
      facings.push(add(g.toMesh('facing:' + id, scene), { kind: 'facing', finishId: id, name: fm.fin.name }, fm.mat, false));
    }
  }

  // ── двери (BlockoutModel.doors): закрытые — вместо панели тупика ──
  const doorClosed = new Set((model.doors ?? []).filter((d) => d.leaf && d.role !== 'open' && d.role !== 'opened').map((d) => `${d.inst}/${d.connector}`));
  const { doors, doorLeaves } = buildDoors(scene, model, floorZ, opts.doorPose, (m, md, collide = false) => add(m, md, doorMaterial(sh), collide));

  // ── тупики: дверная панель, утопленная в стену, с ручкой ──
  const deadEnds: Mesh[] = [];
  if ((model.options?.deadEnds === 'panel' || model.options?.cutEnds === 'panel') && model.deadEnds.length) {
    const shared = merge ? new BoxBatch(true) : null;
    // панели с цветом (opts.deadEndColor): батч и материал на цвет
    const tinted = new Map<string, BoxBatch>();
    const tintMats = sh.tintMats;
    const tintMat = (hex: string): StandardMaterial => {
      let m = tintMats.get(hex);
      if (!m) {
        m = new StandardMaterial('blockout:deadEnd:' + hex, scene);
        m.diffuseColor = safeColor(hex);
        m.emissiveColor = safeColor(hex).scale(0.45);
        m.specularColor = new Color3(0.03, 0.03, 0.03);
        tintMats.set(hex, m);
        extraMats.push(m);
      }
      return m;
    };
    for (const d of model.deadEnds) {
      // закрытая дверь из каталога вместо панели
      if (doorClosed.has(`${d.inst}/${d.connector}`)) continue;
      const tint = opts.deadEndColor?.(d);
      const hex = tint && /^#[0-9a-f]{6}$/i.test(tint) ? tint.toLowerCase() : null;
      let g: BoxBatch;
      if (hex && merge) {
        g = tinted.get(hex) ?? new BoxBatch(true);
        tinted.set(hex, g);
      } else g = (!hex && shared) || new BoxBatch(true);
      const [x1, y1, x2, y2] = d.line;
      const [nx, ny] = d.normal;
      const len = Math.hypot(x2 - x1, y2 - y1) || 1;
      const tx = (x2 - x1) / len;
      const ty = (y2 - y1) / len;
      const z = d.z ?? floorZ.get(d.inst) ?? 0;
      const span = (pts: number[][]): Rect => ({
        x0: Math.min(...pts.map((p) => p[0])),
        y0: Math.min(...pts.map((p) => p[1])),
        x1: Math.max(...pts.map((p) => p[0])),
        y1: Math.max(...pts.map((p) => p[1])),
      });
      // полотно: PANEL_IN внутри стены, остальное выступает в комнату
      const back = -PANEL_IN;
      const front = PANEL_T - PANEL_IN;
      g.color = [1, 1, 1, 1];
      g.planBox(
        span([
          [x1 + nx * back, y1 + ny * back],
          [x2 + nx * front, y2 + ny * front],
        ]),
        z,
        z + Math.max(0.1, d.heightM),
      );
      // ручка-кубик у «правого» края полотна на высоте ~1 м
      const hx = x2 - tx * Math.min(0.12, len / 4);
      const hy = y2 - ty * Math.min(0.12, len / 4);
      const hz = z + Math.min(1, d.heightM * 0.48);
      g.color = [0.22, 0.2, 0.18, 1];
      g.planBox(
        span([
          [hx - tx * 0.025 + nx * front, hy - ty * 0.025 + ny * front],
          [hx + tx * 0.025 + nx * (front + 0.05), hy + ty * 0.025 + ny * (front + 0.05)],
        ]),
        hz - 0.06,
        hz + 0.06,
      );
      if (!merge) deadEnds.push(add(g.toMesh(`deadEnd:${d.inst}:${d.connector}`, scene), { kind: 'deadEnd', inst: d.inst, connector: d.connector }, hex ? tintMat(hex) : materials.deadEnd, false));
    }
    if (shared && shared.verts > 0) deadEnds.push(add(shared.toMesh('deadEnds', scene), { kind: 'deadEnd' }, materials.deadEnd, false));
    for (const [hex, g] of tinted) deadEnds.push(add(g.toMesh('deadEnds:' + hex, scene), { kind: 'deadEnd' }, tintMat(hex), false));
  }

  // ── мебель: бокс w×d×h, пивот в центре на полу, перед = −Z локально (план +y при rot 0) ──
  // Укрытие (PropBox.cover — кровать, стол на ножках): бокс-коллайдер — плита от просвета clear до h, под ней пролезают
  // (src/view3d/posture.ts), у него metadata.cover / clear. Без модели коллайдер невидим, а видна дочерняя болванка
  // «плита + 4 ножки» без коллизий — вызов отрисовки по-прежнему один на предмет.
  const props: Mesh[] = [];
  const propMats = sh.propMats;
  const topMats = sh.topMats;
  /** тёмная полоска у низа передней грани (низ бокса — y0) — видно, куда предмет смотрит */
  const stripe = (g: BoxBatch, w: number, d: number, y0: number, h: number) => {
    g.color = [0.13, 0.12, 0.11, 1];
    const s = Math.min(0.08, (h - y0) * 0.3);
    g.face(2, -1, -d / 2 - 0.006, -w / 2 + 0.01, w / 2 - 0.01, y0 + 0.015, y0 + 0.015 + s);
  };
  for (const p of model.props) {
    const w = Math.max(0.02, p.w);
    const d = Math.max(0.02, p.d);
    const h = Math.max(0.02, p.h);
    // просвет укрытия; плита тоньше 2 см — уже не укрытие, бокс от пола
    const clear = p.cover && p.clear != null && p.clear > 0 && p.clear <= h - 0.02 ? p.clear : 0;
    const g = new BoxBatch(true);
    g.box(-w / 2, clear, -d / 2, w / 2, h, d / 2);
    if (!clear) stripe(g, w, d, 0, h);
    const key = p.propId + '|' + p.color;
    let mat = propMats.get(key);
    if (!mat) {
      mat = new StandardMaterial('blockout:prop:' + p.propId, scene);
      mat.diffuseColor = safeColor(p.color);
      mat.specularColor = new Color3(0.05, 0.05, 0.05);
      propMats.set(key, mat);
      extraMats.push(mat);
    }
    const md = (): BlockoutMeta => ({ kind: 'prop', inst: p.inst, propId: p.propId, name: p.name });
    const m = add(g.toMesh(`prop:${p.inst}:${p.propId}`, scene), clear ? { ...md(), cover: p.cover, clear } : md(), mat, true);
    m.position.set(p.x, p.z ?? floorZ.get(p.inst) ?? 0, -p.y);
    m.rotation.y = (p.rot || 0) * deg;
    props.push(m);
    const tpl = opts.propModel?.(p.propId) ?? null;
    if (tpl) {
      // модель вместо бокса: бокс — коллайдер (невидимый), модель — его ребёнок
      m.isVisible = false;
      // с детьми: у шаблона дети — подвижные части (шестерни, капли… — src/view3d/propAnim.ts их крутит)
      const v = tpl.clone(`propModel:${p.inst}:${p.propId}`, m, false);
      v.setEnabled(true);
      v.isVisible = true;
      v.isPickable = false;
      v.checkCollisions = false;
      if (p.tags.includes('потолок')) v.position.y = model.options.wallHeightM;
      meta(v, md());
      allMeshes.push(v);
      continue;
    }
    if (clear) {
      // укрытие без модели: плита-коллайдер невидима, видна болванка «плита + ножки» (ребёнок, без коллизий)
      m.isVisible = false;
      const vg = new BoxBatch(true);
      vg.box(-w / 2, clear, -d / 2, w / 2, h, d / 2);
      stripe(vg, w, d, clear, h);
      // ножки по углам: 5 см, отступ 3 см от края (у маленького предмета — тоньше)
      vg.color = [0.7, 0.68, 0.65, 1];
      const t = Math.min(0.05, w / 4, d / 4);
      const e = Math.min(0.03, w / 8, d / 8);
      for (const x0 of [-w / 2 + e, w / 2 - e - t]) for (const z0 of [-d / 2 + e, d / 2 - e - t]) vg.box(x0, 0, z0, x0 + t, clear, z0 + t);
      const v = vg.toMesh(`propBox:${p.inst}:${p.propId}`, scene);
      v.parent = m;
      v.material = mat;
      v.checkCollisions = false;
      meta(v, md());
      allMeshes.push(v);
    }

    // текстура вида сверху — отдельная плоскость чуть выше верха (+ zOffset), без z-fighting
    const uri = opts.propTextures?.[p.propId];
    if (uri && uri.startsWith('data:')) {
      let tm = topMats.get(p.propId);
      if (!tm) {
        tm = new StandardMaterial('blockout:propTop:' + p.propId, scene);
        const tex = new Texture(uri, scene, false, true);
        tex.hasAlpha = true;
        tex.wrapU = tex.wrapV = Texture.CLAMP_ADDRESSMODE;
        textures.push(tex);
        tm.diffuseTexture = tex;
        tm.specularColor = new Color3(0.03, 0.03, 0.03);
        tm.zOffset = -2;
        topMats.set(p.propId, tm);
        extraMats.push(tm);
      }
      const tg = new BoxBatch();
      // картинка: верх = зад предмета (+Z локально), низ = перед (−Z), лево = −X
      tg.face(1, 1, h + 0.003, -d / 2, d / 2, -w / 2, w / 2, (x, _y, z) => [(x + w / 2) / w, (z + d / 2) / d]);
      const top = tg.toMesh(`propTop:${p.inst}:${p.propId}`, scene);
      top.material = tm;
      top.parent = m;
      meta(top, { kind: 'propTop', inst: p.inst, propId: p.propId, name: p.name });
      allMeshes.push(top);
    }
  }

  // ── лестницы (src/blockout/stairs.ts): ступени и перила — без коллизий, площадки — с ними, пандус по линии носков и
  // стенки перил — невидимый коллайдер ──
  if (model.stairs?.length) {
    const sm = stairMeshes(model.stairs);
    for (const [g, name, collide, visible] of [[sm.visible, 'stairs', false, true], [sm.pads, 'stairPads', true, true], [sm.collider, 'stairCollider', true, false]] as const) {
      if (g.empty) continue;
      const vd = new VertexData();
      vd.positions = g.p;
      vd.normals = g.n;
      vd.uvs = g.uv;
      vd.colors = g.c;
      vd.indices = g.i;
      const m = new Mesh(name, scene);
      vd.applyToMesh(m, false);
      walls.push(add(m, { kind: 'stair' }, doorMaterial(sh), collide));
      m.isVisible = visible;
    }
  }

  let disposed = false;
  return {
    root,
    walls,
    floors,
    ceilings,
    props,
    deadEnds,
    doors,
    doorLeaves,
    materials,
    facings,
    finishMaterials,
    instOf(mesh) {
      const md = mesh?.metadata as BlockoutMeta | undefined;
      return md && typeof md.inst === 'string' ? md.inst : null;
    },
    setCeilingsVisible(v) {
      for (const m of ceilings) m.isVisible = v;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const m of allMeshes) m.dispose(false, false);
      root.dispose();
      if (ownShared) sh.dispose();
    },
  };
}

// ───────────────────────── двери ─────────────────────────

/** Материал дверей: белый, цвет — в вершинах, лёгкий блик (крашеное дерево, металл). */
function doorMaterial(sh: BlockoutShared): StandardMaterial {
  let m = sh.doorMats.get('door');
  if (!m) {
    m = new StandardMaterial('blockout:door', sh.scene);
    m.diffuseColor = Color3.White();
    m.specularColor = new Color3(0.07, 0.07, 0.07);
    m.specularPower = 28;
    sh.doorMats.set('door', m);
    sh.extraMats.push(m);
  }
  return m;
}

const rgbCache = new Map<string, [number, number, number, number]>();
function rgba(hex: string): [number, number, number, number] {
  let c = rgbCache.get(hex);
  if (!c) {
    const col = safeColor(hex);
    c = [col.r, col.g, col.b, 1];
    rgbCache.set(hex, c);
  }
  return c;
}

const scratch = new BoxBatch();
const tv = new Vector3();
const tn = new Vector3();

/** Боксы модели двери (DoorPart) — в батч с цветами, через матрицу M (null — как есть). */
export function emitDoorParts(g: BoxBatch, parts: DoorPart[], M: Matrix | null) {
  for (const p of parts) {
    const [sx, sy, sz] = p.s;
    if (!(sx > 0 && sy > 0 && sz > 0)) continue;
    scratch.p.length = scratch.n.length = scratch.uv.length = scratch.i.length = 0;
    scratch.box(-sx / 2, -sy / 2, -sz / 2, sx / 2, sy / 2, sz / 2);
    let m = Matrix.Translation(p.c[0], p.c[1], p.c[2]);
    if (p.rz) m = Matrix.RotationZ(p.rz).multiply(m);
    if (M) m = m.multiply(M);
    const base = g.verts;
    const col = rgba(p.color);
    const n = scratch.verts;
    for (let i = 0; i < n; i++) {
      Vector3.TransformCoordinatesFromFloatsToRef(scratch.p[3 * i], scratch.p[3 * i + 1], scratch.p[3 * i + 2], m, tv);
      Vector3.TransformNormalFromFloatsToRef(scratch.n[3 * i], scratch.n[3 * i + 1], scratch.n[3 * i + 2], m, tn);
      tn.normalize();
      g.p.push(tv.x, tv.y, tv.z);
      g.n.push(tn.x, tn.y, tn.z);
      g.uv.push(scratch.uv[2 * i], scratch.uv[2 * i + 1]);
      g.c?.push(col[0], col[1], col[2], col[3]);
    }
    for (const k of scratch.i) g.i.push(base + k);
  }
}

/** Поворот двери в мире (RotationY, рад) по нормали слота: z двери (в стену) = −нормаль. План (x, y↓) → Babylon. */
export function doorYaw(slot: DoorSlot): number {
  return Math.atan2(-slot.normal[0], slot.normal[1]);
}

/** Матрица «координаты двери → мир»: поворот и середина проёма на полу комнаты. */
export function doorMatrix(slot: DoorSlot, floorZ: number): Matrix {
  const [x1, y1, x2, y2] = slot.line;
  return Matrix.RotationY(doorYaw(slot)).multiply(Matrix.Translation((x1 + x2) / 2, floorZ, -(y1 + y2) / 2));
}

/** Поставить ручку в позу h (0…1): нажимная и щеколда — поворот к петлям, круглая — поворот, штурвал — два оборота,
 *  засов — сдвиг к петлям на 10 см. */
export function poseHandle(mesh: Mesh, kind: HandleKind, sign: 1 | -1, pivotX: number, h: number) {
  const k = Math.max(0, Math.min(1, h));
  if (kind === 'lever') mesh.rotation.z = sign * k * 0.7;
  else if (kind === 'latch') mesh.rotation.z = sign * k * 1.4;
  else if (kind === 'knob') mesh.rotation.z = k * 1.2;
  else if (kind === 'wheel') mesh.rotation.z = k * Math.PI * 4;
  else if (kind === 'bolt') mesh.position.x = pivotX - sign * k * 0.1;
}

/** Поставить подвижную дверь в позу (угол — градусы к комнате, ручка 0…1). Замороженные матрицы пересчитываются. */
export function poseDoor(d: DoorMeshes, angle: number, handle: number) {
  const a = (angle * Math.PI) / 180;
  for (const lf of d.leaves) {
    lf.mesh.rotation.y = lf.yaw + lf.geo.sign * a;
    if (lf.mesh.isWorldMatrixFrozen) lf.mesh.freezeWorldMatrix();
    else lf.mesh.computeWorldMatrix(true);
    if (lf.handle && lf.geo.handle) {
      poseHandle(lf.handle, lf.geo.handle.kind, lf.geo.sign, lf.geo.handle.pivot[0], handle);
      if (lf.handle.isWorldMatrixFrozen) lf.handle.freezeWorldMatrix();
      else lf.handle.computeWorldMatrix(true);
    }
  }
}

/**
 * Двери модели: наличники, доски заколоченных и неподвижные полотна — один меш с цветами в вершинах; подвижные полотна
 * (выход, открытый выход) — меш на полотно (начало — ось петель), ручка — его ребёнок. Коллизий у дверей нет: закрытую
 * дверь держит стена за ней, распахнутая стоит у стены. Самозакрывающиеся (DoorStyle.selfClosing, общага) — подвижны при
 * любой роли, полотно — коллайдер (проём открыт, держит само полотно).
 */
function buildDoors(
  scene: Scene,
  model: BlockoutModel,
  floorZ: Map<string, number>,
  pose: BabylonBlockoutOptions['doorPose'],
  add: (m: Mesh, md: BlockoutMeta, collide?: boolean) => Mesh,
): { doors: Mesh[]; doorLeaves: Map<string, DoorMeshes> } {
  const doors: Mesh[] = [];
  const doorLeaves = new Map<string, DoorMeshes>();
  if (!model.doors?.length) return { doors, doorLeaves };
  const g = new BoxBatch(true);
  for (const slot of model.doors) {
    const style = DOOR_STYLE_BY_ID.get(slot.style);
    if (!style) continue;
    const geo = doorGeometry({ style, widthM: slot.widthM, heightM: slot.heightM, hinge: slot.hinge, role: slot.role, leaf: slot.leaf, space: slot.space, seed: slot.seed, tag: slot.tag });
    const D = doorMatrix(slot, slot.z ?? floorZ.get(slot.inst) ?? 0);
    const yaw = doorYaw(slot);
    emitDoorParts(g, geo.frame, D);
    const p = pose?.(slot) ?? null;
    const angle = p ? p.angle : slot.angle;
    // самозакрывающаяся (общага) — подвижна при любой роли, полотно твёрдое
    const movable = slot.role === 'exit' || slot.role === 'opened' || (style.selfClosing === true && slot.leaf);
    const key = `${slot.inst}/${slot.connector}`;
    const moving: DoorLeafMesh[] = [];
    for (const lf of geo.leaves) {
      const hinge = Vector3.TransformCoordinates(new Vector3(lf.axis[0], lf.y0, lf.axis[1]), D);
      // полотно: поворот вокруг оси петель (вместе с поворотом двери), затем перенос на ось
      const rot = yaw + (lf.sign * angle * Math.PI) / 180;
      if (!movable) {
        // неподвижное — в общий меш, сразу в позе слота
        const M = Matrix.RotationY(rot).multiply(Matrix.Translation(hinge.x, hinge.y, hinge.z));
        emitDoorParts(g, lf.parts, M);
        if (lf.handle) emitDoorParts(g, lf.handle.parts, Matrix.Translation(lf.handle.pivot[0], lf.handle.pivot[1], lf.handle.pivot[2]).multiply(M));
        continue;
      }
      const lg = new BoxBatch(true);
      emitDoorParts(lg, lf.parts, null);
      const name = `doorLeaf:${key}:${lf.hinge}`;
      const mesh = add(lg.toMesh(name, scene), { kind: 'doorLeaf', inst: slot.inst, connector: slot.connector, name: style.name }, style.selfClosing === true);
      mesh.position.copyFrom(hinge);
      mesh.rotation.y = rot;
      let handle: Mesh | null = null;
      if (lf.handle) {
        const hb = new BoxBatch(true);
        emitDoorParts(hb, lf.handle.parts, null);
        handle = add(hb.toMesh(name + ':handle', scene), { kind: 'doorHandle', inst: slot.inst, connector: slot.connector });
        handle.parent = mesh;
        handle.position.set(lf.handle.pivot[0], lf.handle.pivot[1], lf.handle.pivot[2]);
        poseHandle(handle, lf.handle.kind, lf.sign, lf.handle.pivot[0], p ? p.handle : 0);
      }
      moving.push({ mesh, handle, geo: lf, yaw });
    }
    if (moving.length) doorLeaves.set(key, { slot, style, leaves: moving });
  }
  if (g.verts > 0) doors.push(add(g.toMesh('doors', scene), { kind: 'door' }));
  return { doors, doorLeaves };
}

// ───────────────────────── внутренние грани объёмов ─────────────────────────

type Box3 = { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number };
type Rect2 = [number, number, number, number];
const EPS = 1e-6;
const rk = (v: number) => Math.round(v * 1e5);
const box3 = (s: Solid): Box3 => ({ x0: s.rect.x0, y0: s.rect.y0, z0: s.z0, x1: s.rect.x1, y1: s.rect.y1, z1: s.z1 });

/** Индекс объёмов по координатам граней: lo[ax] — «у кого начало по оси ax равно v», hi[ax] — конец. */
interface TouchIndex {
  lo: Map<number, Box3[]>[];
  hi: Map<number, Box3[]>[];
}
function touchIndex(solids: Solid[]): TouchIndex {
  const idx: TouchIndex = { lo: [new Map(), new Map(), new Map()], hi: [new Map(), new Map(), new Map()] };
  const put = (m: Map<number, Box3[]>, k: number, b: Box3) => {
    const a = m.get(k);
    if (a) a.push(b);
    else m.set(k, [b]);
  };
  for (const s of solids) {
    const b = box3(s);
    const l = [b.x0, b.y0, b.z0];
    const h = [b.x1, b.y1, b.z1];
    for (let ax = 0; ax < 3; ax++) {
      put(idx.lo[ax], rk(l[ax]), b);
      put(idx.hi[ax], rk(h[ax]), b);
    }
  }
  return idx;
}

/** rects минус cut (прямоугольники в одной плоскости: [u0, u1, v0, v1]). */
function subtractRect(rects: Rect2[], c: Rect2): Rect2[] {
  const out: Rect2[] = [];
  for (const r of rects) {
    const [u0, u1, v0, v1] = r;
    if (c[1] <= u0 + EPS || c[0] >= u1 - EPS || c[3] <= v0 + EPS || c[2] >= v1 - EPS) {
      out.push(r);
      continue;
    }
    const cu0 = Math.max(u0, c[0]);
    const cu1 = Math.min(u1, c[1]);
    if (c[2] > v0 + EPS) out.push([u0, u1, v0, c[2]]);
    if (c[3] < v1 - EPS) out.push([u0, u1, c[3], v1]);
    const vv0 = Math.max(v0, c[2]);
    const vv1 = Math.min(v1, c[3]);
    if (cu0 > u0 + EPS) out.push([u0, cu0, vv0, vv1]);
    if (cu1 < u1 - EPS) out.push([cu1, u1, vv0, vv1]);
  }
  return out;
}

/** Грани объёма s без участков, которыми он касается соседних объёмов (план → Babylon). */
function emitOuterFaces(g: BoxBatch, s: Solid, idx: TouchIndex) {
  const b = box3(s);
  // ось плана 0 = x, 1 = y, 2 = z; для грани — две другие оси (u, v)
  const lo3 = [b.x0, b.y0, b.z0];
  const hi3 = [b.x1, b.y1, b.z1];
  for (let ax = 0; ax < 3; ax++) {
    const u = ax === 0 ? 1 : 0;
    const v = ax === 2 ? 1 : 2;
    const base: Rect2 = [lo3[u], hi3[u], lo3[v], hi3[v]];
    for (const side of [-1, 1] as const) {
      const at = side < 0 ? lo3[ax] : hi3[ax];
      // соседи по ту сторону грани: их противоположная грань лежит в той же плоскости
      const nb = (side < 0 ? idx.hi[ax] : idx.lo[ax]).get(rk(at)) ?? [];
      let rects: Rect2[] = [base];
      for (const t of nb) {
        const tl = [t.x0, t.y0, t.z0];
        const th = [t.x1, t.y1, t.z1];
        rects = subtractRect(rects, [tl[u], th[u], tl[v], th[v]]);
        if (!rects.length) break;
      }
      for (const [u0, u1, v0, v1] of rects) {
        if (ax === 0) g.face(0, side, at, v0, v1, -u1, -u0); // плоскость x: u = y, v = z → Babylon (Y = z, Z = −y)
        else if (ax === 1) g.face(2, side < 0 ? 1 : -1, -at, u0, u1, v0, v1); // плоскость y: u = x, v = z
        else g.face(1, side, at, -v1, -v0, u0, u1); // плоскость z: u = x, v = y
      }
    }
  }
}

function safeColor(hex: string): Color3 {
  return /^#[0-9a-f]{6}$/i.test(hex) ? Color3.FromHexString(hex) : new Color3(0.6, 0.6, 0.6);
}
