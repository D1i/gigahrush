// Предметы на полу мира «Прогулки» (WorldDrop, src/gen4d/stream.ts): модели, свет горящих фонарей и ламп, подсветка
// «E — подобрать», выбор предмета под взглядом и место, куда ляжет выброшенный.
//
// СИСТЕМА КООРДИНАТ WorldDrop (x, y, z, yaw) — мировая Babylon прогона: X = план x, Y — высота, Z = −план y; та же, в
// которой построены куски комнат (PieceCache: комната стоит на своём месте прогона, корень куска — в начале координат) и
// в которой стоит камера, пока игрок в этой комнате (портальный рендер на шве бесконечного хода переносит камеру на
// −shift — она всегда в системе текущей комнаты); так же шлёт своё положение кооп (PlayerState.p). y — высота
// поверхности, на которой лежит предмет (низ модели); yaw — поворот вокруг вертикали как у камеры (rotation.y):
// «вперёд» = (sin yaw, 0, cos yaw) — у фонаря туда смотрит линза.
// Почему не «локально к экземпляру с ребёнком корня комнаты»: в портальном рендере куски вытесняются из кэша (LRU) и
// пересобираются — дети корня куска пропали бы с ним, — а рисует он только свои меши и меши поставщиков
// (PortalRenderer.extraProviders), не обходя иерархию. Положения комнат в прогоне неизменны (dx, dy, z экземпляра), так
// что мировые числа так же устойчивы, совпадают у копий мира в кооп-лобби и не требуют пересчёта.
//
// КАК ЛЕЖИТ И СВЕТИТ — таблица ITEM_LOOKS (по id предмета; нет в ней — стоит как модель, без света): поза 'lie' (на
// боку: фонарь — своя модель на колпачке и ободке, модель предмета — повёрнута на бок) или 'stand' (как стоит модель —
// керосиновая лампа), радиус следа (отступ от стены, dropPose) и свет: 'spot' — луч по yaw (фонарь, горит при on),
// 'point' — во все стороны с дрожью пламени (лампа, горит, пока on не false). Источников у горящих — не больше LIT_MAX
// ближайших к камере, общий пул на все виды.
//
// ВИДИМОСТЬ по экземплярам (комнаты разных слоёв W стоят в одном месте 3D):
//  • портальный рендер активен — меши на слое PORTAL_LAYER (камера их не рисует) отдаются поставщиком extraProviders по
//    комнате: предмет рисуется вместе со своей комнатой — в её области стенсила, с её отсечением и сдвигом шва, то есть
//    ровно там, где видна его комната, и не виден в комнатах других слоёв W в том же месте. У проёма (ближе NEAR_PORTAL_M)
//    — ещё и с соседом за проёмом, как аватары кооп;
//  • иначе (набор PVS, обычная болванка) — обычные меши, включены, пока roomShown(inst) (по умолчанию — все);
//  • shown() = false (облёт, спец-локация поверх) — не видны.
// ДОСЯГАЕМОСТЬ (подобрать — nearest, светить — источники) в портальном рендере: текущая комната и соседи через проём (не
// шов: за швом комната нарисована сдвинутой, а не на своём месте); у соседа — только за плоскостью проёма и не над полом
// текущей (сосед другого слоя W может стоять в 3D на месте текущей: его часть по эту сторону проёма отсечена и не видна).
//
// ИНТЕГРАЦИЯ:
//   const items = new WorldItems(viewer.scene, { portal: () => driver?.portal ?? null, roomShown, shown, itemModel });
//   items.sync(walk.drops(), walk.dropsRev());    // каждый кадр или по смене dropsRev — без изменений ничего не делает
//   const d = items.nearest(cam.position, cam.getDirection(Vector3.Forward())); items.highlight(d?.id ?? null);
//   const p = dropPose(viewer.scene, viewer.fps, { inst: portal.current, portal, eye: viewer.posture.eye, item });
//   items.dispose();
// Покадровое (видимость, свет, пульс подсветки, модели, догрузившиеся после постройки) — сам, в
// scene.onBeforeRenderObservable.
import type { Scene } from '@babylonjs/core/scene';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Material } from '@babylonjs/core/Materials/material';
import type { Observer } from '@babylonjs/core/Misc/observable';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { Constants } from '@babylonjs/core/Engines/constants';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { MultiMaterial } from '@babylonjs/core/Materials/multiMaterial';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { SpotLight } from '@babylonjs/core/Lights/spotLight';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Ray } from '@babylonjs/core/Culling/ray';
import type { WorldDrop } from '../gen4d/stream';
import type { BlockoutMeta } from '../blockout/babylon';
import { buildItems } from '../data/items';
import { KEROLAMP_ITEM, LANTERN_LIGHT_R } from '../locations/obshaga';
import { PORTAL_LAYER, type PortalDef, type PortalPiece, type PortalRenderer } from './portal';
import { FLASH, FLASH_ANGLE, FLASH_COLOR, FLASH_EXP, FLASH_LIE, FlashlightModel, ensureLightSlots, flashIntensity, sceneLitness } from './flashlight';
import { LANTERN_COLOR } from './obshagaScene';

/** Предмет «фонарик» (src/data/items.ts). Керосиновая лампа — KEROLAMP_ITEM (../locations/obshaga; модель — prop
 *  p_obsh_lantern, её даёт itemModel). */
export const FLASHLIGHT_ITEM = 'it_flashlight';
/** обычный слой камер (всё, кроме PORTAL_LAYER) */
const SCENE_LAYER = 0x0fffffff;
/** Предмет ближе этого к проёму своей комнаты рисуется и с соседом за проёмом, м. */
const NEAR_PORTAL_M = 0.35;
/** Предмет соседа за проёмом досягаем, если середина не дальше этого по эту сторону плоскости проёма, м. */
const BEYOND_TOL = 0.03;
/** Горящих лежащих предметов со светом — не больше (ближайшие к камере), и не дальше, м. */
const LIT_MAX = 2;
const LIT_R = 20;
/** Свет лежащего фонаря: дальность, м, и доля яркости фонаря в руке. */
const DROP_RANGE = 12;
const DROP_I = 0.85;
/** Свет лежащего фонаря — не от самой линзы: она в 3 см над полом, и луч шёл бы по полу вскользь (N·L ≈ 0.03 — пятна на
 *  полу почти не видно, светится только стена впереди). Источник — над линзой на DROP_UP и позади на DROP_BACK, м, луч —
 *  по yaw и вниз (~14°), к полу в FLOOR_AIM м перед линзой: на полу — вытянутое пятно от линзы метра на два-три, на
 *  стене впереди — полоса у пола (как от настоящего фонаря на полу), дальше — светит вперёд. Сам фонарь — вне конуса. */
const DROP_UP = 0.35;
const DROP_BACK = 0.25;
const FLOOR_AIM = 1.3;
/** И светлая полоса на полу от линзы (без источника: аддитивная, по свету сцены — в темноте ярче): длина, ширина у
 *  дальнего края, м, яркость; стена ближе — короче (не торчит сквозь неё). Видно горящий фонарь издалека. */
const POOL = { len: 0.55, w: 0.34, em: 0.28 };
/** Коробка-посылка для предметов без модели: ширина, высота, глубина, м. */
const BOX = { w: 0.17, h: 0.075, d: 0.12 };
const KRAFT = '#b08d57';
/** Модели предметов, не догруженные при постройке (PropModels грузит наборы асинхронно): коробка проверяется раз в, мс. */
const MODEL_RETRY_MS = 1000;
/** nearest: конус взгляда (половина угла, рад; ближе PICK_WIDE м — шире, до PICK_CONE_NEAR: под ноги смотрят круто вниз),
 *  «под ногами» — без направления, м; по высоте — ниже глаза / выше, м. */
const PICK_CONE = (40 * Math.PI) / 180;
const PICK_CONE_NEAR = (58 * Math.PI) / 180;
const PICK_WIDE = 1.2;
const PICK_NEAR = 0.6;
const PICK_BELOW = 2.4;
const PICK_ABOVE = 0.6;
/** Подсветка: цвет и пульс. */
const HL_COLOR = new Color3(1, 0.78, 0.4);

// ───────────────────────── как лежит и светит ─────────────────────────

/** Свет лежащего предмета. */
export interface DropLight {
  /** 'spot' — луч вперёд по yaw (конус фонаря FLASH_ANGLE), 'point' — во все стороны */
  kind: 'spot' | 'point';
  color: Color3;
  /** дальность, м */
  range: number;
  /** яркость: число или по сцене (фонарь — как в руке, по свету сцены) */
  intensity: number | ((scene: Scene) => number);
  /** дрожь пламени: доля размаха (0 / нет — ровный свет) */
  flicker?: number;
  /** горит, когда WorldDrop.on не задан (лампа); иначе — только при on: true (фонарь) */
  litByDefault?: boolean;
  /** где источник в осях модели (пивот — центр низа, z — вперёд), м; у фонаря — сам, от линзы (DROP_UP, DROP_BACK) */
  at?: readonly [number, number, number];
}

/** Как предмет лежит в мире и светит ли. */
export interface ItemLook {
  /** 'lie' — на боку (фонарь — своя модель; модель предмета — повёрнута на бок), 'stand' — как стоит модель */
  pose: 'lie' | 'stand';
  /** радиус следа на полу, м: отступ от стены (dropPose) */
  foot: number;
  /** свет горящего; null — не светит */
  light: DropLight | null;
}

/** Предметы с особой позой или светом (остальные — DEFAULT_LOOK). */
export const ITEM_LOOKS: Readonly<Record<string, ItemLook>> = {
  [FLASHLIGHT_ITEM]: {
    pose: 'lie',
    foot: 0.12,
    light: { kind: 'spot', color: FLASH_COLOR, range: DROP_RANGE, intensity: (sc) => flashIntensity(sceneLitness(sc)) * DROP_I },
  },
  // «летучая мышь» стоит на бачке; огонь — в колбе (модель p_obsh_lantern: extras.light = [0, 0.15, 0]), как у лампы в
  // руке (HeldLantern, ./obshagaScene.ts): тёплый точечный свет, радиус LANTERN_LIGHT_R, дрожь пламени
  [KEROLAMP_ITEM]: {
    pose: 'stand',
    foot: 0.14,
    light: { kind: 'point', color: LANTERN_COLOR, range: LANTERN_LIGHT_R + 0.5, intensity: 0.9, flicker: 1, litByDefault: true, at: [0, 0.15, 0] },
  },
};
const DEFAULT_LOOK: ItemLook = { pose: 'stand', foot: 0.13, light: null };

/** Как лежит и светит предмет item. */
export function itemLook(item: string): ItemLook {
  return ITEM_LOOKS[item] ?? DEFAULT_LOOK;
}

/** Горит ли лежащий предмет (есть свет и on — или on не задан, а свет «горит по умолчанию»). */
export function dropLit(d: WorldDrop): boolean {
  const l = itemLook(d.item).light;
  return !!l && (d.on ?? !!l.litByDefault);
}

const hash01 = (s: string, salt = 0): number => {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
};

const hashN = (n: number): number => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/** Дрожь пламени (как у лампы в руке, HeldLantern): множитель яркости около 0.92, размах amp. */
function flame(t: number, ph: number, amp: number): number {
  const k = 0.92 + 0.05 * Math.sin(t * 11.3 + ph) + 0.03 * Math.sin(t * 27.1 + 0.7 + ph * 2) + 0.02 * (hashN(Math.floor(t * 14) + ph * 100) - 0.5);
  return 1 - amp * (1 - k);
}

let itemColors: Map<string, string> | null = null;
/** Цвет предмета по таблице src/data/items.ts. */
function defaultColor(item: string): string | null {
  itemColors ??= new Map(buildItems().map((i) => [i.id, i.color]));
  return itemColors.get(item) ?? null;
}

export interface WorldItemsOptions {
  /** портальный рендер «Прогулки» (FoldDriver.portal); рисует предметы, пока активен */
  portal?: () => PortalRenderer | null;
  /** без портального рендера: видна ли комната (набор PVS — её набор содержит inst); не задано — все */
  roomShown?: (inst: string) => boolean;
  /** показывать ли предметы вообще (облёт, спец-локация поверх — нет); не задано — да */
  shown?: () => boolean;
  /** камера игрока (ближайшие горящие фонари) — по умолчанию scene.activeCamera */
  camera?: () => Camera | null;
  /** цвет предмета '#rrggbb' — по умолчанию из src/data/items.ts */
  itemColor?: (item: string) => string | null | undefined;
  /** шаблон модели предмета (выключенный меш, как PropModels.get: пивот — центр низа, метры) или null — коробка (пока
   *  модели нет — коробка, догрузилась — пересобирается); фонарик — всегда своя модель */
  itemModel?: (item: string) => Mesh | null;
}

interface Entry {
  d: WorldDrop;
  look: ItemLook;
  kind: 'flash' | 'model' | 'box';
  root: TransformNode;
  /** узел модели предмета (поза 'lie' — повёрнут на бок); null — фонарь, коробка */
  pose: TransformNode | null;
  /** всё, что рисуется (для поставщика портального рендера) */
  meshes: Mesh[];
  flash: FlashlightModel | null;
  /** фонарь: светлая полоса на полу перед линзой (включена, пока горит; не подсвечивается) */
  pool: Mesh | null;
  /** середина предмета (мировая) и радиус следа на полу, м */
  center: Vector3;
  foot: number;
  /** горит (look.light и on) */
  lit: boolean;
  /** свет: откуда и куда (spot) — мировые; null — не светит */
  lightAt: Vector3 | null;
  lightDir: Vector3 | null;
  /** фаза дрожи пламени */
  ph: number;
  /** соседи у проёма (портальный рендер) и кусок, по которому посчитаны */
  near: string[];
  nearOf: PortalPiece | null | undefined;
  shown: boolean;
}

interface Lamp {
  l: SpotLight | PointLight;
  kind: DropLight['kind'];
  e: Entry | null;
  idle: number;
}

/** Досягаемое в портальном рендере: текущая комната, её пол и проёмы к соседям (без швов) по соседу. */
interface Reach {
  cur: string;
  floor: readonly { x0: number; y0: number; x1: number; y1: number }[];
  via: Map<string, PortalDef[]>;
}

/** Копия материала для подсветки: что подставить, свечение «как было» и что создано здесь (только это и удалять). */
interface Variant {
  m: Material;
  base: { mat: StandardMaterial; em: Color3 }[];
  own: Material[];
}

export class WorldItems {
  /** счётчики работы (тесты, HUD): построено, удалено, изменено на месте */
  readonly stats = { created: 0, disposed: 0, updated: 0 };
  private readonly entries = new Map<string, Entry>();
  private lastArr: readonly WorldDrop[] | null = null;
  private lastRev: number | null = null;
  private byRoom = new Map<string, Mesh[]>();
  private roomsDirty = true;
  private roomsAt = 0;
  private visDirty = true;
  private visAt = 0;
  private retryAt = 0;
  private attached: PortalRenderer | null = null;
  private lastOn = true;
  private layer = SCENE_LAYER;
  private obs: Observer<Scene> | null;
  private lamps: Lamp[] = [];
  private hlId: string | null = null;
  private hlOrig = new Map<Mesh, Material | null>();
  /** копии материалов для подсветки (по исходному) */
  private hlVariants = new Map<Material, Variant>();
  /** что пульсирует сейчас (материалы подсвеченного) */
  private hlPulse: { mat: StandardMaterial; em: Color3 }[] = [];
  private glow: Mesh | null = null;
  private glowTex: RawTexture | null = null;
  private boxTpl: { box: Mesh; twine: Mesh; twineMat: StandardMaterial; mats: Map<string, StandardMaterial> } | null = null;
  private poolTpl: { mesh: Mesh; mat: StandardMaterial; tex: RawTexture } | null = null;
  private last = performance.now();
  private t = 0;
  private disposed = false;
  private readonly provider = (room: string): readonly Mesh[] | undefined => this.byRoom.get(room);

  constructor(
    private readonly scene: Scene,
    private readonly opts: WorldItemsOptions = {},
  ) {
    this.obs = scene.onBeforeRenderObservable.add(() => this.update());
  }

  /** Лежащих предметов (построенных). */
  get size(): number {
    return this.entries.size;
  }

  /** Построены ли меши предмета id. */
  has(id: string): boolean {
    return this.entries.has(id);
  }

  /**
   * Привести меши к списку предметов: новые — построить, пропавшие — удалить, изменившиеся — поправить (другой
   * предмет — пересобрать). rev (StreamWorld.dropsRev) тот же или тот же массив — ничего не делает. true — что-то
   * изменилось.
   */
  sync(drops: readonly WorldDrop[], rev?: number): boolean {
    if (this.disposed) return false;
    if (rev !== undefined && rev === this.lastRev) return false;
    if (drops === this.lastArr) {
      if (rev !== undefined) this.lastRev = rev;
      return false;
    }
    this.lastArr = drops;
    if (rev !== undefined) this.lastRev = rev;
    // подсветку — снять до правок (place меняет материалы — линза зажглась; снятие после вернуло бы прежние) и
    // наложить заново после: подсвеченный пересобран, сдвинут, включён или только что появился
    let hl: string | null = null;
    const unhl = () => {
      if (hl === null && this.hlId) {
        hl = this.hlId;
        this.highlight(null);
      }
    };
    let changed = false;
    const ids = new Set<string>();
    for (const d of drops) ids.add(d.id);
    for (const [id, e] of this.entries) {
      if (ids.has(id)) continue;
      unhl();
      this.drop(e);
      this.entries.delete(id);
      changed = true;
    }
    for (const d of drops) {
      const e = this.entries.get(d.id);
      if (e) {
        if (e.d === d || same(e.d, d)) {
          e.d = d;
          continue;
        }
        unhl();
        changed = true;
        if (e.d.item !== d.item) {
          this.drop(e);
          this.entries.set(d.id, this.build(d));
        } else {
          this.place(e, d);
          this.stats.updated++;
        }
        continue;
      }
      unhl();
      this.entries.set(d.id, this.build(d));
      changed = true;
    }
    if (changed) this.roomsDirty = this.visDirty = true;
    if (hl !== null) this.highlight(hl);
    return changed;
  }

  // ───────────────────────── модели ─────────────────────────

  private build(d: WorldDrop): Entry {
    const sc = this.scene;
    const look = itemLook(d.item);
    const root = new TransformNode(`drop:${d.id}`, sc);
    root.setEnabled(false);
    let kind: Entry['kind'];
    let meshes: Mesh[];
    let flash: FlashlightModel | null = null;
    let pose: TransformNode | null = null;
    let pool: Mesh | null = null;
    const tpl = d.item === FLASHLIGHT_ITEM ? null : (this.opts.itemModel?.(d.item) ?? null);
    if (d.item === FLASHLIGHT_ITEM) {
      kind = 'flash';
      // на боку: опоры — колпачок и ободок (ось чуть поднята к голове), поворот вокруг оси — по id (ползунок не снизу)
      flash = new FlashlightModel(sc, `drop:${d.id}:flash`, root);
      flash.root.position.y = FLASH_LIE.axisY;
      flash.root.rotation.set(-FLASH_LIE.tilt, 0, (hash01(d.id) - 0.5) * 2.4);
      meshes = flash.meshes;
      pool = this.poolKit().mesh.clone(`drop:${d.id}:pool`, root, true);
      pool.isPickable = false;
      pool.checkCollisions = false;
      pool.layerMask = this.layer;
      pool.setEnabled(false);
    } else if (tpl) {
      kind = 'model';
      pose = new TransformNode(`drop:${d.id}:pose`, sc);
      pose.parent = root;
      const c = tpl.clone(`drop:${d.id}:model`, pose, false);
      meshes = [c, ...(c.getChildMeshes(false) as Mesh[])].filter((m) => m.getTotalVertices() > 0);
      for (const m of [c, ...c.getChildMeshes(false)]) {
        m.setEnabled(true);
        m.isVisible = true;
      }
      if (look.pose === 'lie') layOnSide(pose);
    } else {
      kind = 'box';
      const t = this.boxKit();
      const box = t.box.clone(`drop:${d.id}:box`, root, true);
      box.material = this.boxMat(d.item);
      const twine = t.twine.clone(`drop:${d.id}:twine`, root, true);
      meshes = [box, twine];
      for (const m of meshes) m.setEnabled(true);
    }
    for (const m of meshes) {
      m.isPickable = false;
      m.checkCollisions = false;
      m.layerMask = this.layer;
      m.receiveShadows = false;
    }
    const e: Entry = {
      d,
      look,
      kind,
      root,
      pose,
      meshes,
      flash,
      pool,
      center: new Vector3(),
      foot: look.foot,
      lit: false,
      lightAt: null,
      lightDir: null,
      ph: hash01(d.id, 3) * Math.PI * 2,
      near: [],
      nearOf: undefined,
      shown: false,
    };
    this.place(e, d);
    this.stats.created++;
    return e;
  }

  /** Поставить на место (x, y, z, yaw) и включить/выключить свет; мировые точки — заново, матрицы заморожены. */
  private place(e: Entry, d: WorldDrop) {
    e.d = d;
    const r = e.root;
    for (const m of e.meshes) m.unfreezeWorldMatrix();
    r.position.set(d.x, d.y, d.z);
    // посылку бросили как попало; фонарь — точно по взгляду (туда светит)
    r.rotation.y = d.yaw + (e.kind === 'flash' ? 0 : (hash01(d.id, 7) - 0.5) * 0.6);
    r.computeWorldMatrix(true);
    const L = e.look.light;
    e.lit = dropLit(d);
    e.lightAt = e.lightDir = null;
    if (e.flash) {
      e.flash.setKnob(!!d.on);
      e.flash.setLensLit(!!d.on);
      const w = e.flash.root.computeWorldMatrix(true);
      Vector3.TransformCoordinatesToRef(Vector3.Zero(), w, e.center);
      const lens = Vector3.TransformCoordinates(new Vector3(0, 0, FLASH.lensZ + 0.012), w);
      // источник — над линзой и позади, луч — к полу в FLOOR_AIM перед линзой (см. DROP_UP)
      const fx = Math.sin(r.rotation.y), fz = Math.cos(r.rotation.y);
      const at = new Vector3(lens.x - fx * DROP_BACK, lens.y + DROP_UP, lens.z - fz * DROP_BACK);
      const run = DROP_BACK + FLOOR_AIM;
      e.lightAt = at;
      e.lightDir = new Vector3(fx * run, d.y - at.y, fz * run).normalize();
      e.foot = e.look.foot;
      if (e.pool) {
        // полоса — от линзы вперёд (в осях корня: z — по yaw); стена ближе — до неё
        const p = e.pool;
        p.unfreezeWorldMatrix();
        const lz = (lens.x - d.x) * fx + (lens.z - d.z) * fz - 0.012;
        let len = POOL.len;
        const hit = this.scene.pickWithRay(new Ray(new Vector3(lens.x, d.y + 0.05, lens.z), new Vector3(fx, 0, fz), POOL.len), solid);
        if (hit?.hit) len = Math.max(0.04, hit.distance - 0.01);
        p.scaling.set(1, 1, len / POOL.len);
        p.position.set(0, 0.003, lz + len / 2);
        p.setEnabled(e.lit);
        p.computeWorldMatrix(true);
        p.freezeWorldMatrix();
      }
    } else if (e.kind === 'box') {
      Vector3.TransformCoordinatesToRef(new Vector3(0, BOX.h / 2, 0), r.getWorldMatrix(), e.center);
      e.foot = 0.13;
    } else {
      const { min, max } = r.getHierarchyBoundingVectors(true);
      if (Number.isFinite(min.x) && Number.isFinite(max.x) && min.x <= max.x) {
        e.center.set((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2);
        e.foot = Math.max(0.1, Math.max(max.x - min.x, max.z - min.z) / 2 + 0.06);
      } else e.center.set(d.x, d.y + 0.05, d.z);
    }
    if (L && !e.flash) {
      // источник — в осях модели (коробка вместо модели — от её корня)
      const w = (e.pose ?? r).computeWorldMatrix(true);
      const a = L.at ?? [0, 0, 0];
      e.lightAt = Vector3.TransformCoordinates(new Vector3(a[0], a[1], a[2]), w);
      if (L.kind === 'spot') e.lightDir = Vector3.TransformNormal(new Vector3(0, 0, 1), w).normalize();
    }
    // статичны: мировые матрицы — один раз (модели предметов с подвижными частями — без заморозки)
    if (e.kind !== 'model') for (const m of e.meshes) m.freezeWorldMatrix();
    e.nearOf = undefined;
    this.roomsDirty = true;
  }

  private drop(e: Entry) {
    if (this.hlId === e.d.id) {
      this.hlOrig.clear();
      this.hlPulse = [];
      this.glow?.setEnabled(false);
    }
    for (const l of this.lamps) if (l.e === e) l.e = null;
    if (e.flash) e.flash.dispose();
    else for (const m of e.meshes) m.dispose(false, false);
    e.root.dispose(false, false);
    this.stats.disposed++;
  }

  /** Коробки предметов, чья модель догрузилась после постройки (PropModels — асинхронно), — пересобрать моделью. */
  private retryModels() {
    const get = this.opts.itemModel;
    if (!get) return;
    let hl: string | null = null;
    for (const [id, e] of this.entries) {
      if (e.kind !== 'box' || !get(e.d.item)) continue;
      if (hl === null && this.hlId) {
        hl = this.hlId;
        this.highlight(null);
      }
      this.drop(e);
      this.entries.set(id, this.build(e.d));
      this.roomsDirty = this.visDirty = true;
    }
    if (hl !== null) this.highlight(hl);
  }

  private boxKit() {
    if (this.boxTpl) return this.boxTpl;
    const sc = this.scene;
    const box = CreateBox('drop:boxTpl', { width: BOX.w, height: BOX.h, depth: BOX.d }, sc);
    box.position.y = BOX.h / 2;
    box.bakeCurrentTransformIntoVertices();
    // бечёвка крест-накрест
    const a = CreateBox('drop:twinePart', { width: BOX.w + 0.003, height: BOX.h + 0.003, depth: 0.009 }, sc);
    const b = CreateBox('drop:twinePart', { width: 0.009, height: BOX.h + 0.003, depth: BOX.d + 0.003 }, sc);
    a.position.y = b.position.y = BOX.h / 2;
    const twine = Mesh.MergeMeshes([a, b], true, true)!;
    twine.name = 'drop:twineTpl';
    const twineMat = new StandardMaterial('drop:twine', sc);
    twineMat.diffuseColor = new Color3(0.36, 0.3, 0.2);
    twineMat.specularColor = new Color3(0.02, 0.02, 0.02);
    twine.material = twineMat;
    for (const m of [box, twine]) {
      m.isPickable = false;
      m.setEnabled(false);
    }
    return (this.boxTpl = { box, twine, twineMat, mats: new Map() });
  }

  /** Шаблон полосы света лежащего фонаря: плоскость на полу (z — от линзы вперёд), прозрачность — конус, ярче у линзы. */
  private poolKit() {
    if (this.poolTpl) return this.poolTpl;
    const sc = this.scene;
    const n = 64;
    const px = new Uint8Array(n * n * 4);
    for (let y = 0; y < n; y++) {
      // строка текстуры — v: 0 у линзы (ближний край плоскости), 1 — дальний
      const v = (y + 0.5) / n;
      const half = 0.3 + 0.7 * v;
      const along = Math.min(1, v / 0.1) * Math.pow(1 - v, 1.5);
      for (let x = 0; x < n; x++) {
        const u = ((x + 0.5) / n) * 2 - 1;
        const k = Math.max(0, 1 - (u / half) ** 2);
        const i = (y * n + x) * 4;
        px[i] = px[i + 1] = px[i + 2] = 255;
        px[i + 3] = Math.round(255 * Math.min(1, along * k * k * 1.25));
      }
    }
    const tex = RawTexture.CreateRGBATexture(px, n, n, sc, false, false, Texture.BILINEAR_SAMPLINGMODE);
    tex.name = 'drop:poolTex';
    tex.hasAlpha = true;
    tex.wrapU = tex.wrapV = Texture.CLAMP_ADDRESSMODE;
    const mat = new StandardMaterial('drop:pool', sc);
    mat.diffuseColor = Color3.Black();
    mat.specularColor = Color3.Black();
    mat.emissiveColor = FLASH_COLOR.scale(POOL.em);
    mat.opacityTexture = tex;
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    mat.disableDepthWrite = true;
    mat.alphaMode = Constants.ALPHA_ADD;
    mat.zOffset = -2;
    // плоскость XZ лицом вверх; v растёт с z
    const mesh = CreateGround('drop:poolTpl', { width: POOL.w, height: POOL.len }, sc);
    mesh.material = mat;
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    mesh.setEnabled(false);
    return (this.poolTpl = { mesh, mat, tex });
  }

  private boxMat(item: string): StandardMaterial {
    const kit = this.boxKit();
    const raw = (this.opts.itemColor ?? defaultColor)(item) ?? KRAFT;
    const hex = /^#[0-9a-f]{6}$/i.test(raw) ? raw.toLowerCase() : KRAFT;
    let m = kit.mats.get(hex);
    if (!m) {
      m = new StandardMaterial('drop:box:' + hex, this.scene);
      // крашеный картон: цвет предмета, чуть приглушённый
      m.diffuseColor = Color3.Lerp(Color3.FromHexString(hex), Color3.FromHexString(KRAFT), 0.2).scale(0.9);
      m.specularColor = new Color3(0.04, 0.04, 0.04);
      kit.mats.set(hex, m);
    }
    return m;
  }

  // ───────────────────────── кадр ─────────────────────────

  /** Кадр (вызывается сам перед каждым рендером сцены): видимость, поставщик портального рендера, подсветка, свет. */
  update() {
    if (this.disposed) return;
    const now = performance.now();
    const dt = Math.min(0.25, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.t += dt;
    if (now - this.retryAt > MODEL_RETRY_MS) {
      this.retryAt = now;
      this.retryModels();
    }
    const on = this.opts.shown?.() ?? true;
    if (on !== this.lastOn) {
      this.lastOn = on;
      this.visDirty = true;
    }
    const p = this.opts.portal?.() ?? null;
    const portal = on && p && p.isActive ? p : null;
    if (this.attached !== portal) {
      this.attached?.extraProviders.delete(this.provider);
      portal?.extraProviders.add(this.provider);
      this.attached = portal;
      this.roomsDirty = this.visDirty = true;
    }
    const layer = portal ? PORTAL_LAYER : SCENE_LAYER;
    if (layer !== this.layer) {
      this.layer = layer;
      for (const e of this.entries.values()) {
        for (const m of e.meshes) m.layerMask = layer;
        if (e.pool) e.pool.layerMask = layer;
      }
      if (this.glow) this.glow.layerMask = layer;
      this.visDirty = true;
    }
    // видимость: портальный рендер рисует сам (по комнатам), иначе — по roomShown
    if (this.visDirty || now - this.visAt > 250) {
      this.visDirty = false;
      this.visAt = now;
      const shownRoom = this.opts.roomShown;
      for (const e of this.entries.values()) {
        const v = on && (portal ? true : shownRoom ? shownRoom(e.d.inst) : true);
        if (v !== e.shown) {
          e.shown = v;
          e.root.setEnabled(v);
        }
      }
    }
    if (portal && (this.roomsDirty || now - this.roomsAt > 500)) this.rebuildRooms(portal);
    else if (!portal && this.byRoom.size) this.byRoom = new Map();
    this.pulse(portal);
    this.lights(dt, portal);
  }

  /** Меши по комнатам для портального рендера: своя комната и соседи у проёма; подсветка — с подсвеченным. */
  private rebuildRooms(portal: PortalRenderer) {
    this.roomsDirty = false;
    this.roomsAt = performance.now();
    const by = new Map<string, Mesh[]>();
    const push = (room: string, ms: readonly Mesh[]) => {
      let l = by.get(room);
      if (!l) by.set(room, (l = []));
      for (const m of ms) l.push(m);
    };
    const hl = this.hlId ? this.entries.get(this.hlId) : undefined;
    for (const e of this.entries.values()) {
      this.nearOf(e, portal);
      // полоса света — после модели (прозрачная, аддитивная); портальный рендер рисует всё отданное, включено оно или
      // нет, — погашенного фонаря не отдавать
      let ms: readonly Mesh[] = e.meshes;
      if (e.pool && e.lit) ms = [...ms, e.pool];
      if (e === hl && this.glow) ms = [...ms, this.glow];
      push(e.d.inst, ms);
      for (const r of e.near) push(r, ms);
    }
    this.byRoom = by;
  }

  /** Соседи у проёма (рисуется и с ними) — по текущему куску своей комнаты. */
  private nearOf(e: Entry, portal: PortalRenderer) {
    const piece = portal.cache.peek(e.d.inst);
    if (e.nearOf === piece) return;
    e.nearOf = piece;
    e.near = [];
    for (const q of piece?.portals ?? []) {
      if (q.shiftB || q.to === e.d.inst || e.near.includes(q.to)) continue;
      if (rectDist(q.rect, e.center.x, -e.center.z) < NEAR_PORTAL_M + e.foot) e.near.push(q.to);
    }
  }

  // ───────────────────────── досягаемость ─────────────────────────

  /** Текущая комната портального рендера и проёмы к соседям (без швов); null — текущей нет. */
  private reach(portal: PortalRenderer): Reach | null {
    const cur = portal.current;
    if (!cur) return null;
    const p = portal.cache.peek(cur);
    const via = new Map<string, PortalDef[]>();
    for (const q of p?.portals ?? []) {
      if (q.shiftB || q.to === cur) continue;
      let l = via.get(q.to);
      if (!l) via.set(q.to, (l = []));
      l.push(q);
    }
    return { cur, floor: p?.floor ?? [], via };
  }

  /**
   * Досягаем ли (видим на своём месте) предмет: в текущей комнате; у проёма соседа — рисуется и с текущей; у соседа
   * через проём — середина за плоскостью проёма (в стороне соседа) и не над полом текущей: сосед другого слоя W может
   * стоять в 3D на месте текущей — его часть по эту сторону проёма отсечена и не видна, луч взгляда её не ловит.
   */
  private inReach(e: Entry, r: Reach | null, portal: PortalRenderer): boolean {
    if (!r) return false;
    if (e.d.inst === r.cur) return true;
    const qs = r.via.get(e.d.inst);
    if (!qs) return false;
    this.nearOf(e, portal);
    if (e.near.includes(r.cur)) return true;
    const x = e.center.x, y = -e.center.z;
    if (inRects(r.floor, x, y)) return false;
    for (const q of qs) if (((q.axis === 'x' ? x : y) - q.at) * q.dir > -BEYOND_TOL) return true;
    return false;
  }

  // ───────────────────────── подсветка ─────────────────────────

  /** Подсветить предмет, который подберёт E (null — снять): тёплое пульсирующее свечение и пятно света под ним. */
  highlight(id: string | null) {
    if (this.disposed || id === this.hlId) return;
    for (const [m, mat] of this.hlOrig) if (!m.isDisposed()) m.material = mat;
    this.hlOrig.clear();
    this.hlPulse = [];
    this.hlId = id;
    this.roomsDirty = true;
    const e = id ? this.entries.get(id) : undefined;
    if (!e) {
      this.glow?.setEnabled(false);
      return;
    }
    for (const m of e.meshes) {
      const src = m.material;
      this.hlOrig.set(m, src);
      if (!src) continue;
      m.material = this.variant(src);
      for (const b of this.hlVariants.get(src)?.base ?? []) if (!this.hlPulse.includes(b)) this.hlPulse.push(b);
    }
    const g = this.glowMesh();
    g.position.set(e.d.x, e.d.y + 0.004, e.d.z);
    g.scaling.setAll(e.foot * 2.2);
    g.layerMask = this.layer;
    g.setEnabled(true);
  }

  /** Подсвеченный предмет (id) или null. */
  get highlighted(): string | null {
    return this.hlId && this.entries.has(this.hlId) ? this.hlId : null;
  }

  /** Копия материала для подсветки (текстуры — общие, не копии); у MultiMaterial — по подматериалам; не Standard —
   *  как есть (без свечения). Созданное здесь — в own: удаляется только оно, исходные — общие, их не трогать. */
  private variant(m: Material): Material {
    const hit = this.hlVariants.get(m);
    if (hit) return hit.m;
    const base: Variant['base'] = [];
    const own: Material[] = [];
    const one = (src: Material | null): Material | null => {
      if (!(src instanceof StandardMaterial)) return src;
      const v = new StandardMaterial(src.name + ':hl', this.scene);
      v.diffuseColor = src.diffuseColor.clone();
      v.diffuseTexture = src.diffuseTexture;
      v.specularColor = src.specularColor.clone();
      v.specularPower = src.specularPower;
      v.emissiveColor = src.emissiveColor.clone();
      v.emissiveTexture = src.emissiveTexture;
      v.disableLighting = src.disableLighting;
      v.backFaceCulling = src.backFaceCulling;
      v.alpha = src.alpha;
      v.maxSimultaneousLights = src.maxSimultaneousLights;
      base.push({ mat: v, em: src.emissiveColor.clone() });
      own.push(v);
      return v;
    };
    let out: Material;
    if (m instanceof MultiMaterial) {
      const mm = new MultiMaterial(m.name + ':hl', this.scene);
      mm.subMaterials = m.subMaterials.map((s) => one(s));
      own.push(mm);
      out = mm;
    } else out = one(m) ?? m;
    this.hlVariants.set(m, { m: out, base, own });
    return out;
  }

  private glowMesh(): Mesh {
    if (this.glow) return this.glow;
    const sc = this.scene;
    const n = 64;
    const px = new Uint8Array(n * n * 4);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const r = Math.hypot(((x + 0.5) / n) * 2 - 1, ((y + 0.5) / n) * 2 - 1);
        const a = r < 1 ? (1 - r) * (1 - r) : 0;
        const i = (y * n + x) * 4;
        px[i] = px[i + 1] = px[i + 2] = 255;
        px[i + 3] = Math.round(255 * a);
      }
    const tex = (this.glowTex = RawTexture.CreateRGBATexture(px, n, n, sc, false, false, Texture.BILINEAR_SAMPLINGMODE));
    tex.hasAlpha = true;
    const m = new StandardMaterial('drop:glow', sc);
    m.diffuseColor = Color3.Black();
    m.specularColor = Color3.Black();
    m.emissiveColor = HL_COLOR.clone();
    m.opacityTexture = tex;
    m.disableLighting = true;
    m.backFaceCulling = false;
    // диск лежит в плоскости XY лицом к −Z: повернуть лицом вверх; радиус 0.5 → масштаб = диаметр пятна
    const g = (this.glow = CreateDisc('drop:glow', { radius: 0.5, tessellation: 24 }, sc));
    g.rotation.x = Math.PI / 2;
    g.material = m;
    g.isPickable = false;
    g.checkCollisions = false;
    g.layerMask = this.layer;
    g.setEnabled(false);
    return g;
  }

  private pulse(portal: PortalRenderer | null) {
    const e = this.hlId ? this.entries.get(this.hlId) : undefined;
    if (!e) return;
    const k = 0.5 + 0.5 * Math.sin(this.t * 4.2);
    const a = 0.1 + 0.12 * k;
    for (const b of this.hlPulse) b.mat.emissiveColor.copyFromFloats(b.em.r + HL_COLOR.r * a, b.em.g + HL_COLOR.g * a, b.em.b + HL_COLOR.b * a);
    const g = this.glow;
    if (g) {
      const mat = g.material as StandardMaterial;
      mat.alpha = 0.22 + 0.22 * k;
      const v = !!portal || e.shown;
      if (g.isEnabled() !== v) g.setEnabled(v);
    }
  }

  // ───────────────────────── свет горящих ─────────────────────────

  /**
   * Не больше LIT_MAX ближайших к камере горящих предметов светят (пул источников: SpotLight — фонари, PointLight —
   * лампы). В портальном рендере — только досягаемые (inReach): источник стоит в мировых координатах, а комната за швом
   * нарисована сдвинутой, и свет соседа другого слоя W лёг бы на текущую комнату в том же месте 3D.
   */
  private lights(dt: number, portal: PortalRenderer | null) {
    const cam = this.opts.camera?.() ?? this.scene.activeCamera;
    const pick: { e: Entry; d2: number }[] = [];
    if (cam) {
      const c = cam.globalPosition;
      const r = portal ? this.reach(portal) : null;
      for (const e of this.entries.values()) {
        if (!e.lit || !e.lightAt || !e.look.light) continue;
        if (portal ? !this.inReach(e, r, portal) : !e.shown) continue;
        const d2 = Vector3.DistanceSquared(c, e.lightAt);
        if (d2 > LIT_R * LIT_R) continue;
        pick.push({ e, d2 });
      }
      pick.sort((a, b) => a.d2 - b.d2);
      pick.length = Math.min(pick.length, LIT_MAX);
    }
    // полоса света фонарей на полу: в темноте ярче, в освещённой комнате — едва (общий материал)
    if (this.poolTpl) FLASH_COLOR.scaleToRef(POOL.em * (1 - 0.65 * sceneLitness(this.scene)), this.poolTpl.mat.emissiveColor);
    const want = pick.map((p) => p.e);
    // кто уже светит нужному — остаётся; свободные — новым того же вида
    const free: Lamp[] = [];
    for (const l of this.lamps) if (!l.e || !want.includes(l.e) || l.kind !== l.e.look.light?.kind) free.push(l);
    for (const e of want) {
      const L = e.look.light!;
      let l = this.lamps.find((x) => x.e === e && x.kind === L.kind);
      if (!l) {
        const i = free.findIndex((x) => x.kind === L.kind);
        if (i >= 0) l = free.splice(i, 1)[0];
        else {
          // свободного этого вида нет: лишний включённый другого вида — выключить сразу (предел источников у материалов)
          if (this.lamps.filter((x) => x.l.isEnabled()).length >= LIT_MAX) {
            const o = free.find((x) => x.l.isEnabled());
            if (o) {
              o.e = null;
              o.l.intensity = 0;
              o.l.setEnabled(false);
            }
          }
          l = this.newLamp(L.kind);
        }
        l.e = e;
        l.l.diffuse.copyFrom(L.color);
        L.color.scaleToRef(0.3, l.l.specular);
        l.l.range = L.range;
      }
      l.l.position.copyFrom(e.lightAt!);
      if (l.l instanceof SpotLight && e.lightDir) l.l.direction.copyFrom(e.lightDir);
      l.idle = 0;
      const base = typeof L.intensity === 'function' ? L.intensity(this.scene) : L.intensity;
      l.l.intensity = base * (L.flicker ? flame(this.t, e.ph, L.flicker) : 1);
      if (!l.l.isEnabled()) l.l.setEnabled(true);
    }
    for (const l of free) {
      l.e = null;
      l.l.intensity = 0;
      l.idle += dt;
      // источник выключается не сразу: включение/выключение пересобирает шейдеры у мешей
      if (l.idle > 1.5 && l.l.isEnabled()) l.l.setEnabled(false);
    }
  }

  private newLamp(kind: DropLight['kind']): Lamp {
    ensureLightSlots(this.scene);
    const name = `drop:lamp${this.lamps.length}`;
    const l = kind === 'spot' ? new SpotLight(name, new Vector3(), new Vector3(0, 0, 1), FLASH_ANGLE, FLASH_EXP, this.scene) : new PointLight(name, new Vector3(), this.scene);
    l.intensity = 0;
    const lamp: Lamp = { l, kind, e: null, idle: 0 };
    this.lamps.push(lamp);
    return lamp;
  }

  /** Сколько источников горящих предметов сейчас включено (тесты, HUD). */
  get litCount(): number {
    return this.lamps.filter((l) => l.e && l.l.isEnabled()).length;
  }

  /** Какие предметы сейчас светят (id; тесты, HUD). */
  get litIds(): string[] {
    return this.lamps.filter((l) => l.e && l.l.isEnabled()).map((l) => l.e!.d.id);
  }

  // ───────────────────────── что подобрать ─────────────────────────

  /**
   * Предмет, который подберёт игрок: видимый, ближе maxDist по горизонтали (по высоте — от PICK_BELOW ниже глаза до
   * PICK_ABOVE выше), в конусе взгляда ±40° (ближе 1.2 м — шире, до ±58°: лежащее у ног видно круто вниз; ближе PICK_NEAR —
   * в любую сторону), не за стеной (луч от глаза до предмета не задевает твёрдые меши: включены и с коллизиями). В
   * портальном рендере — только досягаемые (inReach: текущая комната и соседи через проём, у соседа — за плоскостью
   * проёма): в комнатах других слоёв W в том же месте 3D — нет. Из подходящих — ближний, с поправкой на угол (что перед
   * глазами — раньше). from — глаз (позиция камеры), forward — взгляд (единичный).
   */
  nearest(from: Vector3, forward: Vector3, maxDist = 1.6): WorldDrop | null {
    if (this.disposed || !this.entries.size) return null;
    const on = this.opts.shown?.() ?? true;
    if (!on) return null;
    const p = this.opts.portal?.() ?? null;
    const portal = p && p.isActive ? p : null;
    const reach = portal ? this.reach(portal) : null;
    const fl = forward.length() || 1;
    let best: Entry | null = null;
    let bestScore = Infinity;
    for (const e of this.entries.values()) {
      if (portal ? !this.inReach(e, reach, portal) : !e.shown) continue;
      const vx = e.center.x - from.x, vy = e.center.y - from.y, vz = e.center.z - from.z;
      if (vy < -PICK_BELOW || vy > PICK_ABOVE) continue;
      const h = Math.hypot(vx, vz);
      if (h > maxDist + e.foot * 0.5) continue;
      const len = Math.hypot(vx, vy, vz) || 1e-6;
      const cos = (vx * forward.x + vy * forward.y + vz * forward.z) / (len * fl);
      const ang = Math.acos(Math.max(-1, Math.min(1, cos)));
      const cone = PICK_CONE + (PICK_CONE_NEAR - PICK_CONE) * Math.min(1, Math.max(0, (PICK_WIDE - h) / (PICK_WIDE - PICK_NEAR)));
      if (ang > cone && h > PICK_NEAR) continue;
      const score = len + 0.6 * ang;
      if (score >= bestScore) continue;
      if (this.blocked(from, e)) continue;
      best = e;
      bestScore = score;
    }
    return best ? best.d : null;
  }

  /** Луч от глаза к предмету упирается в твёрдое (стена, мебель). */
  private blocked(from: Vector3, e: Entry): boolean {
    const dir = e.center.subtract(from);
    const len = dir.length();
    if (len < 0.1) return false;
    const ray = new Ray(from.clone(), dir.scale(1 / len), Math.max(0, len - 0.08));
    const hit = this.scene.pickWithRay(ray, solid, true);
    return !!hit?.hit;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.obs) this.scene.onBeforeRenderObservable.remove(this.obs);
    this.obs = null;
    this.attached?.extraProviders.delete(this.provider);
    this.attached = null;
    // подсвеченному — исходные материалы (копии подсветки удаляются ниже)
    for (const [m, mat] of this.hlOrig) if (!m.isDisposed()) m.material = mat;
    this.hlOrig.clear();
    this.hlPulse = [];
    for (const e of this.entries.values()) this.drop(e);
    this.entries.clear();
    this.byRoom.clear();
    for (const l of this.lamps) l.l.dispose();
    this.lamps = [];
    // только копии подсветки (и подматериалы-копии MultiMaterial); исходные — общие (шаблоны моделей, наборы фонаря)
    for (const v of this.hlVariants.values()) for (const m of v.own) m.dispose(false, false);
    this.hlVariants.clear();
    this.hlOrig.clear();
    if (this.glow) {
      this.glow.material?.dispose(false, false);
      this.glow.dispose(false, false);
    }
    this.glowTex?.dispose();
    this.glow = null;
    this.glowTex = null;
    if (this.boxTpl) {
      this.boxTpl.box.dispose(false, false);
      this.boxTpl.twine.dispose(false, false);
      this.boxTpl.twineMat.dispose(false, false);
      for (const m of this.boxTpl.mats.values()) m.dispose(false, false);
      this.boxTpl = null;
    }
    if (this.poolTpl) {
      this.poolTpl.mesh.dispose(false, false);
      this.poolTpl.mat.dispose(false, false);
      this.poolTpl.tex.dispose();
      this.poolTpl = null;
    }
  }
}

/** Модель предмета — на бок: поворот на 90° вокруг z (вперёд), снизу — бывший бок, середина — над пивотом. */
function layOnSide(pose: TransformNode) {
  // границы модели в её осях (корень предмета ещё в начале координат, без поворота)
  pose.position.setAll(0);
  pose.rotation.setAll(0);
  const { min, max } = pose.getHierarchyBoundingVectors(true);
  pose.rotation.z = Math.PI / 2;
  if (!(Number.isFinite(min.x) && Number.isFinite(max.x) && min.x <= max.x)) return;
  // поворот на +90° вокруг z: (x, y) → (−y, x) — низ теперь min.x, по x середина −(min.y + max.y)/2
  pose.position.set((min.y + max.y) / 2, -min.x, 0);
}

function same(a: WorldDrop, b: WorldDrop): boolean {
  return a.id === b.id && a.item === b.item && a.inst === b.inst && a.x === b.x && a.y === b.y && a.z === b.z && a.yaw === b.yaw && !!a.on === !!b.on && (a.on === undefined) === (b.on === undefined);
}

function rectDist(r: { x0: number; y0: number; x1: number; y1: number }, x: number, y: number): number {
  return Math.hypot(Math.max(0, r.x0 - x, x - r.x1), Math.max(0, r.y0 - y, y - r.y1));
}

function inRects(rects: readonly { x0: number; y0: number; x1: number; y1: number }[], x: number, y: number): boolean {
  for (const r of rects) if (x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1) return true;
  return false;
}

/** Твёрдое: включено и с коллизиями (в портальном рендере — текущая комната и сосед у порога; коллайдеры мебели —
 *  невидимые боксы — тоже). */
const solid = (m: AbstractMesh): boolean => m.checkCollisions && m.isEnabled();

// ───────────────────────── куда ляжет выброшенный ─────────────────────────

/** След выброшенного по умолчанию (предмет не задан), м, и зазор до стены сверх следа, м. */
const DROP_FOOT = 0.16;
const WALL_GAP = 0.04;

export interface DropPoseOptions {
  /** комната игрока (портальный рендер — portal.current; иначе — комната под ногами) */
  inst: string;
  /** портальный рендер: комната точки — по полу кусков (текущая или сосед через проём), как у самого рендера */
  portal?: PortalRenderer | null;
  /** глаз над ногами, м (Posture.eye); не задано — по эллипсоиду камеры */
  eye?: number;
  /** на сколько вперёд класть, м (0.7) */
  dist?: number;
  /** что кладут: отступ от стены — по следу предмета (ITEM_LOOKS.foot) */
  item?: string;
  /** радиус следа, м (важнее item; по умолчанию DROP_FOOT) */
  foot?: number;
}

export interface DropPose {
  inst: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** Глаз над ногами по эллипсоиду камеры (стоя — 1.6; ниже — Posture.eye точнее). */
function eyeOf(cam: Camera): number {
  const c = cam as Camera & { ellipsoid?: Vector3; ellipsoidOffset?: Vector3 };
  if (!c.ellipsoid || !c.ellipsoidOffset) return 1.6;
  const e = 2 * c.ellipsoid.y - c.ellipsoidOffset.y;
  return Number.isFinite(e) && e > 0.2 ? e : 1.6;
}

/**
 * Куда ляжет выброшенный предмет (WorldDrop без id/item): на dist перед игроком по взгляду (по горизонтали); стена
 * ближе — к ней, и от неё по нормали на след предмета с зазором (вскользь вдоль стены отступ по лучу оставил бы центр у
 * самой стены — предмет ушёл бы в неё); отодвинутое упёрлось в другую стену (угол) — под ноги. Высота — луч вниз на
 * твёрдое (пол, верх мебели, ступень); впереди его нет (провал, лестничный пролёт) — под ноги; нет и под ногами
 * (твёрдого нет вовсе) — вперёд, на уровне ног (глаз − eye). yaw — взгляд игрока. Портальный рендер: точка не на полу текущей комнаты и не у соседа через проём —
 * кладётся под ноги. null — камера в негодном положении.
 */
export function dropPose(scene: Scene, cam: Camera, o: DropPoseOptions): DropPose | null {
  const eye = cam.globalPosition;
  if (!Number.isFinite(eye.x) || !Number.isFinite(eye.y) || !Number.isFinite(eye.z)) return null;
  const f = cam.getDirection(Vector3.Forward());
  const yaw = Math.hypot(f.x, f.z) > 1e-6 ? Math.atan2(f.x, f.z) : ((cam as Camera & { rotation?: Vector3 }).rotation?.y ?? 0);
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const eyeH = o.eye && o.eye > 0 ? o.eye : eyeOf(cam);
  const feet = eye.y - eyeH;
  const clear = (o.foot && o.foot > 0 ? o.foot : o.item ? itemLook(o.item).foot : DROP_FOOT) + WALL_GAP;
  const d0 = Math.max(0, o.dist ?? 0.7);
  let x = eye.x + fx * d0, z = eye.z + fz * d0;
  // стена впереди: луч на высоте пояса (на четвереньках — ниже глаза); длиннее dist — стена вскользь, ближе следа
  // к точке по нормали, тоже ловится
  if (d0 > 0) {
    const probeY = feet + Math.min(0.9, Math.max(0.25, eyeH - 0.5));
    const from = new Vector3(eye.x, probeY, eye.z);
    const hit = scene.pickWithRay(new Ray(from, new Vector3(fx, 0, fz), d0 + 1), solid);
    if (hit?.hit && hit.pickedPoint) {
      const d = Math.min(d0, hit.distance);
      x = eye.x + fx * d;
      z = eye.z + fz * d;
      // нормаль стены по горизонтали, к игроку (нет или почти вертикальна — навстречу взгляду)
      const n = hit.getNormal(true, false);
      let nx = -fx, nz = -fz;
      const nl = n ? Math.hypot(n.x, n.z) : 0;
      if (n && nl >= 0.3) {
        nx = n.x / nl;
        nz = n.z / nl;
        if (nx * fx + nz * fz > 0) {
          nx = -nx;
          nz = -nz;
        }
      }
      const s = (x - hit.pickedPoint.x) * nx + (z - hit.pickedPoint.z) * nz;
      if (s < clear) {
        x += nx * (clear - s);
        z += nz * (clear - s);
      }
      // отодвинутое — за другой стеной (угол): под ноги
      const dx = x - eye.x, dz = z - eye.z;
      const dl = Math.hypot(dx, dz);
      if (dl > 1e-3) {
        const back = scene.pickWithRay(new Ray(from, new Vector3(dx / dl, 0, dz / dl), dl + clear * 0.5), solid);
        if (back?.hit) {
          x = eye.x;
          z = eye.z;
        }
      }
    }
  }
  const land = (px: number, pz: number): { y: number; inst: string | null } | null => {
    const top = feet + Math.min(eyeH, 1.3);
    const hit = scene.pickWithRay(new Ray(new Vector3(px, top, pz), new Vector3(0, -1, 0), top - feet + 1.2), solid);
    if (!hit?.hit || !hit.pickedPoint) return null;
    const md = hit.pickedMesh?.metadata as BlockoutMeta | null | undefined;
    return { y: hit.pickedPoint.y, inst: md && typeof md.inst === 'string' ? md.inst : null };
  };
  let inst = o.inst;
  let at = land(x, z);
  const portal = o.portal && o.portal.isActive ? o.portal : null;
  // комната — по полу кусков: текущая или сосед через проём (не шов); вне их — под ноги
  const room = portal ? roomAt(portal, o.inst, x, z) : null;
  if (portal && !room) {
    x = eye.x;
    z = eye.z;
    at = land(x, z);
  } else if (!at) {
    // впереди опоры нет: провал — под ноги (там она есть); нет и там (твёрдого нет вовсе) — вперёд, на уровне ног
    const under = land(eye.x, eye.z);
    if (under) {
      x = eye.x;
      z = eye.z;
      at = under;
    } else if (room) inst = room;
  } else if (room) inst = room;
  if (!portal && at?.inst) inst = at.inst;
  const y = at ? at.y : feet;
  return { inst, x, y, z, yaw };
}

/** Комната точки (Babylon x, z) среди текущей и её соседей через проёмы (без швов) — по полу кусков; null — вне. */
function roomAt(portal: PortalRenderer, cur: string, x: number, z: number): string | null {
  const p = portal.cache.peek(cur);
  if (!p) return null;
  const px = x, py = -z;
  if (inRects(p.floor, px, py)) return cur;
  for (const q of p.portals) {
    if (q.shiftB) continue;
    const n = portal.cache.peek(q.to);
    if (n && inRects(n.floor, px, py)) return q.to;
  }
  return null;
}
