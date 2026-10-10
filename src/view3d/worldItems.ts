// Предметы на полу мира «Прогулки» (WorldDrop, src/gen4d/stream.ts, и точки лута комнат «<inst>:L<k>» — в той же
// форме): модели, свет горящих фонарей и ламп, подсветка «E — подобрать», выбор предмета под взглядом и место, куда
// ляжет выброшенный.
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
// КАК ЛЕЖИТ И СВЕТИТ — реестр видов ./itemLooks.ts (itemLookOf): модель (лут — клон шаблона loot_props.glb; нет модели
// или не загрузилась — коробка-посылка, догрузилась — пересборка), поза ('stand' / 'lie' на боку / 'flat' лицом вверх),
// перед — к бросившему (надпись видна) или по yaw (П-2: линза), стопка n — горкой (копейки россыпью, батарейки рядком),
// мелочь — чуть крупнее и с бликом под светом. Свет — горящие по itemUse.lightOnFloor (П-2 — луч по yaw и полоса на полу,
// стекло светится; керосинка — тёплый точечный с дрожью и язычок пламени в колбе). Источников у горящих — не больше
// LIT_MAX ближайших к камере, общий пул на все виды. Реестр поменялся (lookRev) — всё пересобирается.
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
//   const items = new WorldItems(viewer.scene, { portal: () => driver?.portal ?? null, roomShown, shown });
//   items.sync([...walk.drops(), ...точкиЛута]);  // каждый кадр — тот же массив (или та же версия) ничего не делает
//   const d = items.nearest(cam.position, cam.getDirection(Vector3.Forward())); items.highlight(d?.id ?? null);
//   const p = dropPose(viewer.scene, viewer.fps, { inst: portal.current, portal, eye: viewer.posture.eye, item });
//   items.dispose();
// Покадровое (видимость, свет, пульс подсветки, блики, модели, догрузившиеся после постройки) — сам, в
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
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { SpotLight } from '@babylonjs/core/Lights/spotLight';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Ray } from '@babylonjs/core/Culling/ray';
import type { WorldDrop } from '../gen4d/stream';
import type { BlockoutMeta } from '../blockout/babylon';
import type { Slot } from '../game/hotbar';
import { lightOnFloor, type Light } from '../game/itemUse';
import { buildItems } from '../data/items';
import { PORTAL_LAYER, type PortalDef, type PortalPiece, type PortalRenderer } from './portal';
import { FLASH_ANGLE, FLASH_COLOR, FLASH_EXP, ensureLightSlots, sceneLitness } from './flashlight';
import {
  BOX_SIZE, copyMaterial, flameFlicker, flameMeshes, floorScale, glintMesh, itemLookOf, lensDisc, lookRev, lootFx, posedSize,
  type DropLight, type ItemLook, type V3,
} from './itemLooks';

export type { DropLight, ItemLook } from './itemLooks';

/** Предмет «фонарик П-2» (src/data/items.ts). */
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
/** Свет лежащего фонаря — не от самой линзы: она в 5 см над полом, и луч шёл бы по полу вскользь (N·L ≈ 0.03 — пятна на
 *  полу почти не видно, светится только стена впереди). Источник — над линзой на DROP_UP и позади на DROP_BACK, м, луч —
 *  по yaw и вниз (~14°), к полу в FLOOR_AIM м перед линзой: на полу — вытянутое пятно от линзы метра на два-три, на
 *  стене впереди — полоса у пола (как от настоящего фонаря на полу), дальше — светит вперёд. Сам фонарь — вне конуса. */
const DROP_UP = 0.35;
const DROP_BACK = 0.25;
const FLOOR_AIM = 1.3;
/** И светлая полоса на полу от линзы (без источника: аддитивная, по свету сцены — в темноте ярче): длина, ширина у
 *  дальнего края, м, яркость; стена ближе — короче (не торчит сквозь неё). Видно горящий фонарь издалека. */
const POOL = { len: 0.55, w: 0.34, em: 0.28 };
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
/** Блик мелочи: размер, м; виден ближе GLINT_R м; порог освещённости. */
const GLINT_S = 0.05;
const GLINT_R = 9;
const GLINT_MIN = 0.12;

// ───────────────────────── как лежит и светит ─────────────────────────

/** Как лежит и светит предмет item (реестр ./itemLooks.ts). */
export function itemLook(item: string): ItemLook {
  return itemLookOf(item);
}

/** Ячейка хотбара, которую изображает лежащий предмет (состояние — то же: on/n/q/w/u). */
export function slotOf(d: WorldDrop): Slot {
  const s: Slot = { item: d.item };
  if (d.on !== undefined) s.on = d.on;
  if (d.n !== undefined) s.n = d.n;
  if (d.q !== undefined) s.q = d.q;
  if (d.w !== undefined) s.w = d.w;
  if (d.u !== undefined) s.u = d.u;
  return s;
}

/** Свет лежащего (itemUse.lightOnFloor; у вида нет света — null). */
export function dropLight(d: WorldDrop, look: ItemLook = itemLookOf(d.item)): Light | null {
  return look.light ? lightOnFloor(slotOf(d)) : null;
}

/** Горит ли лежащий предмет. */
export function dropLit(d: WorldDrop): boolean {
  return !!dropLight(d);
}

/** Сколько штук стопки n показать горкой (не больше pile.max): 1, 2, 3, 4 (до 9), 5 (до 29), 6. */
export function pileCount(n: number | undefined, pile: ItemLook['pile']): number {
  const k = Math.max(1, Math.floor(n ?? 1));
  if (!pile || pile.max <= 1 || k <= 1) return 1;
  const c = k <= 3 ? k : k < 10 ? 4 : k < 30 ? 5 : 6;
  return Math.min(pile.max, c);
}

const hash01 = (s: string, salt = 0): number => {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
};

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
  /** шаблон модели предмета, у вида которого нет своей модели (реестр ./itemLooks.ts главнее): выключенный меш, как
   *  PropModels.get (пивот — центр низа, метры), или null — коробка (догрузилась — пересобирается) */
  itemModel?: (item: string) => Mesh | null;
}

interface Entry {
  d: WorldDrop;
  look: ItemLook;
  kind: 'model' | 'box';
  root: TransformNode;
  /** узлы поз штук стопки (модель или коробка в осях модели: поза, масштаб); [0] — главная (свет, навесное) */
  poses: TransformNode[];
  /** модель (то, что подсвечивается) — для поставщика портального рендера и подсветки */
  meshes: Mesh[];
  /** сколько штук горкой и навесное — при смене пересборка */
  copies: number;
  partsKey: string;
  /** фонарь: светлая полоса на полу перед линзой (включена, пока горит; не подсвечивается) */
  pool: Mesh | null;
  /** светящееся стекло (горит) */
  lens: Mesh | null;
  /** язычок пламени (горит) */
  flame: { node: TransformNode; meshes: Mesh[] } | null;
  /** блик мелочи */
  glint: Mesh | null;
  /** середина предмета (мировая), верх, радиус следа на полу, м */
  center: Vector3;
  top: number;
  foot: number;
  /** горит: свет по lightOnFloor и цвет */
  lit: boolean;
  light: Light | null;
  color: Color3;
  /** свет: откуда и куда (spot) — мировые; null — не светит */
  lightAt: Vector3 | null;
  lightDir: Vector3 | null;
  /** фаза дрожи пламени и блика */
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

/** Поворот и сдвиг узла позы: модель с габаритом [min, max] (оси модели) — низом на пол, серединой над пивотом. */
function poseOf(pose: ItemLook['pose'], min: Vector3, max: Vector3): { rot: V3; off: V3 } {
  const cx = (min.x + max.x) / 2, cy = (min.y + max.y) / 2, cz = (min.z + max.z) / 2;
  // на бок: +90° вокруг z — (x, y) → (−y, x): низ — min.x, по x середина −cy
  if (pose === 'lie') return { rot: [0, 0, Math.PI / 2], off: [cy, -min.x, -cz] };
  // лицом вверх: +90° вокруг x — (y, z) → (−z, y): низ — −max.z, по z середина cy
  if (pose === 'flat') return { rot: [Math.PI / 2, 0, 0], off: [-cx, max.z, -cy] };
  return { rot: [0, 0, 0], off: [-cx, -min.y, -cz] };
}

export class WorldItems {
  /** счётчики работы (тесты, HUD): построено, удалено, изменено на месте */
  readonly stats = { created: 0, disposed: 0, updated: 0 };
  private readonly entries = new Map<string, Entry>();
  private lastArr: readonly WorldDrop[] | null = null;
  private lastRev: number | null = null;
  private lookAt = lookRev();
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

  /** Сколько штук стопки нарисовано у предмета id (0 — нет такого). */
  copiesOf(id: string): number {
    return this.entries.get(id)?.poses.length ?? 0;
  }

  /** Модель (true) или коробка-заглушка (false) у предмета id; нет такого — null. */
  modelOf(id: string): boolean | null {
    const e = this.entries.get(id);
    return e ? e.kind === 'model' : null;
  }

  /**
   * Привести меши к списку предметов: новые — построить, пропавшие — удалить, изменившиеся — поправить (другой
   * предмет, другая горка или навесное — пересобрать). rev (StreamWorld.dropsRev) тот же или тот же массив — ничего не
   * делает. true — что-то изменилось.
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
        if (e.d.item !== d.item || pileCount(d.n, e.look.pile) !== e.copies || partsKey(e.look, d) !== e.partsKey) {
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

  /** Шаблон модели предмета: из реестра видов (лут), иначе opts.itemModel; null — пока коробка. */
  private template(item: string, look: ItemLook): Mesh | null {
    if (look.model) return look.model(this.scene);
    return this.opts.itemModel?.(item) ?? null;
  }

  private build(d: WorldDrop): Entry {
    const sc = this.scene;
    const look = itemLookOf(d.item);
    const root = new TransformNode(`drop:${d.id}`, sc);
    root.setEnabled(false);
    const tpl = this.template(d.item, look);
    const kind: Entry['kind'] = tpl ? 'model' : 'box';
    const copies = pileCount(d.n, look.pile);
    const s = tpl ? floorScale(look) : 1;
    const poses: TransformNode[] = [];
    const meshes: Mesh[] = [];
    let rot: V3 = [0, 0, 0], off: V3 = [0, 0, 0];
    let size: V3 = BOX_SIZE;
    for (let k = 0; k < copies; k++) {
      const tag = copies > 1 ? `:${k}` : '';
      const node = new TransformNode(`drop:${d.id}:copy${tag}`, sc);
      node.parent = root;
      const pose = new TransformNode(`drop:${d.id}:pose${tag}`, sc);
      pose.parent = node;
      poses.push(pose);
      if (tpl) {
        const c = tpl.clone(`drop:${d.id}:model${tag}`, pose, false);
        const all = [c, ...c.getChildMeshes(false)];
        for (const m of all) {
          m.setEnabled(true);
          m.isVisible = true;
        }
        for (const m of all) if (m instanceof Mesh && m.getTotalVertices() > 0) meshes.push(m);
      } else {
        const t = this.boxKit();
        const box = t.box.clone(`drop:${d.id}:box${tag}`, pose, true);
        box.material = this.boxMat(d.item);
        const twine = t.twine.clone(`drop:${d.id}:twine${tag}`, pose, true);
        for (const m of [box, twine]) {
          m.setEnabled(true);
          meshes.push(m);
        }
      }
      if (k === 0) {
        // габарит модели в её осях (корень ещё в начале координат, без поворота): поза — по нему
        if (tpl) {
          const { min, max } = pose.getHierarchyBoundingVectors(true);
          if (Number.isFinite(min.x) && Number.isFinite(max.x) && min.x <= max.x) {
            ({ rot, off } = poseOf(look.pose, min, max));
            size = posedSize([max.x - min.x, max.y - min.y, max.z - min.z], look.pose);
          }
        } else ({ rot, off } = poseOf('stand', new Vector3(-BOX_SIZE[0] / 2, 0, -BOX_SIZE[2] / 2), new Vector3(BOX_SIZE[0] / 2, BOX_SIZE[1], BOX_SIZE[2] / 2)));
      }
      pose.rotation.set(rot[0], rot[1], rot[2]);
      pose.position.set(off[0] * s, off[1] * s, off[2] * s);
      pose.scaling.setAll(s);
      // перед: к бросившему (модели смотрят на −Z) или по yaw (линза фонаря); штуки горки — вразброс
      const along = look.front === 'along';
      const j = (salt: number) => hash01(d.id, 31 * k + salt) - 0.5;
      const w = size[0] * s, h = size[1] * s, dp = size[2] * s;
      const mode = look.pile?.mode ?? 'scatter';
      let ox = 0, oy = 0, oz = 0, yaw = 0;
      if (k > 0 || copies > 1) {
        if (mode === 'row') {
          ox = (k - (copies - 1) / 2) * w * 1.08;
          oz = j(1) * dp * 0.3;
          yaw = j(2) * 0.24;
        } else if (mode === 'stack') {
          ox = j(1) * w * 0.25;
          oz = j(2) * dp * 0.25;
          oy = k * h * 1.02;
          yaw = j(3) * 0.8;
        } else if (k > 0) {
          // россыпь: спираль Фогеля, шаг — чуть больше габарита, повороты — любые
          const r = Math.max(w, dp) * 0.66 * Math.sqrt(k);
          const a = k * 2.39996 + hash01(d.id, 5) * 6.283;
          ox = Math.cos(a) * r;
          oz = Math.sin(a) * r;
          oy = k * 0.0004;
          yaw = j(3) * 6.283;
        } else yaw = j(3) * 6.283;
      }
      node.position.set(ox, oy, oz);
      node.rotation.y = (along ? Math.PI : 0) + yaw;
    }
    // навесное (удлинение тубуса на П-2): модель предмета низом-центром в точке at главной штуки
    const pk = partsKey(look, d);
    if (tpl && look.parts) {
      for (const p of look.parts(slotOf(d))) {
        const pl = itemLookOf(p.item);
        const pt = this.template(p.item, pl);
        if (!pt) continue;
        const c = pt.clone(`drop:${d.id}:part:${p.item}`, poses[0], false);
        c.position.set(p.at[0], p.at[1], p.at[2]);
        for (const m of [c, ...c.getChildMeshes(false)]) {
          m.setEnabled(true);
          m.isVisible = true;
          if (m instanceof Mesh && m.getTotalVertices() > 0) meshes.push(m);
        }
      }
    }
    for (const m of meshes) {
      m.isPickable = false;
      m.checkCollisions = false;
      m.layerMask = this.layer;
      m.receiveShadows = false;
    }
    // свечение: линза, пламя, полоса луча, блик
    const fx = (m: Mesh) => {
      m.isPickable = false;
      m.checkCollisions = false;
      m.layerMask = this.layer;
      m.setEnabled(false);
      return m;
    };
    const lens = tpl && look.lens && look.light ? fx(lensDisc(sc, `drop:${d.id}:lens`, poses[0], look.lens, lootFx(sc).lensOn)) : null;
    let flame: Entry['flame'] = null;
    if (tpl && look.flame && look.light) {
      flame = flameMeshes(sc, `drop:${d.id}:flame`, poses[0], look.flame.h);
      flame.node.position.set(look.flame.at[0], look.flame.at[1], look.flame.at[2]);
      for (const m of flame.meshes) fx(m);
    }
    let pool: Mesh | null = null;
    if (look.light?.floorBeam) {
      pool = fx(this.poolKit().mesh.clone(`drop:${d.id}:pool`, root, true));
    }
    const glint = look.glint ? fx(glintMesh(sc, `drop:${d.id}:glint`, GLINT_S)) : null;
    if (glint) glint.alwaysSelectAsActiveMesh = true;
    const e: Entry = {
      d,
      look,
      kind,
      root,
      poses,
      meshes,
      copies,
      partsKey: pk,
      pool,
      lens,
      flame,
      glint,
      center: new Vector3(),
      top: 0,
      foot: look.foot,
      lit: false,
      light: null,
      color: new Color3(1, 1, 1),
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

  /** Меши свечения предмета, которые сейчас включены (рисуются после модели). */
  private extras(e: Entry): Mesh[] {
    const out: Mesh[] = [];
    if (e.lit) {
      if (e.lens) out.push(e.lens);
      if (e.flame) out.push(...e.flame.meshes);
      if (e.pool) out.push(e.pool);
    }
    if (e.glint) out.push(e.glint);
    return out;
  }

  /** Поставить на место (x, y, z, yaw) и включить/выключить свет; мировые точки — заново, матрицы заморожены. */
  private place(e: Entry, d: WorldDrop) {
    e.d = d;
    const r = e.root;
    for (const m of e.meshes) m.unfreezeWorldMatrix();
    r.position.set(d.x, d.y, d.z);
    // бросили как попало; фонарь — точно по взгляду (туда светит)
    r.rotation.y = d.yaw + (e.look.front === 'along' ? 0 : (hash01(d.id, 7) - 0.5) * 0.6);
    // матрицы — по цепочке сверху (родитель в том же кадре отдал бы прежнюю)
    r.computeWorldMatrix(true);
    for (const p of e.poses) {
      (p.parent as TransformNode).computeWorldMatrix(true);
      p.computeWorldMatrix(true);
    }
    const L = e.look.light;
    e.light = dropLight(d, e.look);
    e.lit = !!e.light;
    if (e.light) e.color = Color3.FromHexString(e.light.color);
    e.lightAt = e.lightDir = null;
    // середина и след — по модели (без свечения)
    const set = new Set<AbstractMesh>(e.meshes);
    const { min, max } = r.getHierarchyBoundingVectors(true, (m) => set.has(m));
    if (Number.isFinite(min.x) && Number.isFinite(max.x) && min.x <= max.x) {
      e.center.set((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2);
      e.top = max.y;
      e.foot = Math.max(e.look.foot, Math.max(max.x - min.x, max.z - min.z) / 2 + 0.03);
    } else {
      e.center.set(d.x, d.y + 0.05, d.z);
      e.top = d.y + 0.1;
      e.foot = e.look.foot;
    }
    const w0 = e.poses[0].getWorldMatrix();
    if (L && L.floorBeam) {
      // луч лежащего фонаря: линза — по точке вида (или середина), перед — по yaw
      const la = L.at ?? e.look.lens?.at ?? [0, 0.05, -0.1];
      const lens = Vector3.TransformCoordinates(new Vector3(la[0], la[1], la[2]), w0);
      const fx = Math.sin(r.rotation.y), fz = Math.cos(r.rotation.y);
      // источник — над линзой и позади, луч — к полу в FLOOR_AIM перед линзой (см. DROP_UP)
      const at = new Vector3(lens.x - fx * DROP_BACK, lens.y + DROP_UP, lens.z - fz * DROP_BACK);
      const run = DROP_BACK + FLOOR_AIM;
      e.lightAt = at;
      e.lightDir = new Vector3(fx * run, d.y - at.y, fz * run).normalize();
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
    } else if (L) {
      // источник — в осях модели (коробка вместо модели — от её узла позы)
      const a = L.at ?? [0, 0.1, 0];
      e.lightAt = Vector3.TransformCoordinates(new Vector3(a[0], a[1], a[2]), w0);
      if (L.kind === 'spot') e.lightDir = Vector3.TransformNormal(new Vector3(0, 0, -1), w0).normalize();
    }
    e.lens?.setEnabled(e.lit);
    if (e.flame) for (const m of e.flame.meshes) m.setEnabled(e.lit);
    if (e.glint) {
      e.glint.position.set(e.center.x, e.top + 0.012, e.center.z);
      e.glint.setEnabled(e.shown);
      e.glint.visibility = 0;
    }
    // статичны: мировые матрицы — один раз
    for (const m of e.meshes) m.freezeWorldMatrix();
    e.lens?.freezeWorldMatrix();
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
    for (const m of e.meshes) m.dispose(false, false);
    for (const m of [e.pool, e.lens, e.glint, ...(e.flame?.meshes ?? [])]) m?.dispose(false, false);
    e.flame?.node.dispose(false, false);
    e.root.dispose(false, false);
    this.stats.disposed++;
  }

  /** Пересобрать: коробки, чья модель догрузилась (PropModels — асинхронно), или всё (реестр видов поменялся). */
  private rebuild(all: boolean) {
    let hl: string | null = null;
    for (const [id, e] of this.entries) {
      if (!all && (e.kind !== 'box' || !this.template(e.d.item, e.look))) continue;
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
    const [bw, bh, bd] = BOX_SIZE;
    const box = CreateBox('drop:boxTpl', { width: bw, height: bh, depth: bd }, sc);
    box.position.y = bh / 2;
    box.bakeCurrentTransformIntoVertices();
    // бечёвка крест-накрест
    const a = CreateBox('drop:twinePart', { width: bw + 0.003, height: bh + 0.003, depth: 0.009 }, sc);
    const b = CreateBox('drop:twinePart', { width: 0.009, height: bh + 0.003, depth: bd + 0.003 }, sc);
    a.position.y = b.position.y = bh / 2;
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
    if (this.lookAt !== lookRev()) {
      // реестр видов поменялся (сессия зарегистрировала свой предмет) — всё заново
      this.lookAt = lookRev();
      this.rebuild(true);
    } else if (now - this.retryAt > MODEL_RETRY_MS) {
      this.retryAt = now;
      this.rebuild(false);
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
        for (const m of [e.pool, e.lens, e.glint, ...(e.flame?.meshes ?? [])]) if (m) m.layerMask = layer;
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
          // свечение — без родителя-корня (блик) или с ним; включение блика — по свету
          if (e.glint) e.glint.setEnabled(v);
        }
      }
    }
    if (portal && (this.roomsDirty || now - this.roomsAt > 500)) this.rebuildRooms(portal);
    else if (!portal && this.byRoom.size) this.byRoom = new Map();
    this.pulse(portal);
    this.lights(dt, portal);
    this.flames();
    this.glints(portal);
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
      // свечение — после модели (прозрачное, аддитивное); портальный рендер рисует всё отданное, включено оно или нет,
      // — погашенного не отдавать
      let ms: readonly Mesh[] = [...e.meshes, ...this.extras(e)];
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
    g.position.set(e.center.x, e.d.y + 0.004, e.center.z);
    g.scaling.setAll(Math.max(0.16, e.foot * 2.2));
    g.layerMask = this.layer;
    g.setEnabled(true);
  }

  /** Подсвеченный предмет (id) или null. */
  get highlighted(): string | null {
    return this.hlId && this.entries.has(this.hlId) ? this.hlId : null;
  }

  /** Копия материала для подсветки (текстуры — общие, не копии; стекло — с прозрачностью); у MultiMaterial — по
   *  подматериалам; не Standard — как есть (без свечения). Созданное здесь — в own: удаляется только оно, исходные —
   *  общие (шаблоны моделей), их не трогать. */
  private variant(m: Material): Material {
    const hit = this.hlVariants.get(m);
    if (hit) return hit.m;
    const base: Variant['base'] = [];
    const own: Material[] = [];
    const out = copyMaterial(m, ':hl', own, (c, src) => base.push({ mat: c, em: src.emissiveColor.clone() }));
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
      const Lt = e.light!;
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
      }
      l.l.diffuse.copyFrom(e.color);
      e.color.scaleToRef(0.3, l.l.specular);
      l.l.range = Lt.range * (L.rangeMul ?? 1) + (L.rangeAdd ?? 0);
      l.l.position.copyFrom(e.lightAt!);
      if (l.l instanceof SpotLight && e.lightDir) l.l.direction.copyFrom(e.lightDir);
      l.idle = 0;
      const base = typeof L.base === 'function' ? L.base(this.scene) : L.base;
      l.l.intensity = base * Lt.intensity * (L.flicker ? flameFlicker(this.t, e.ph, L.flicker) : 1);
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

  /** Язычки пламени горящих (керосинка на полу) — дрожат. */
  private flames() {
    for (const e of this.entries.values()) {
      if (!e.flame || !e.lit || !e.shown) continue;
      const k = flameFlicker(this.t * 1.3, e.ph, 2.2);
      e.flame.node.scaling.set(0.94 + 0.06 * k, 0.82 + 0.18 * k + 0.05 * Math.sin(this.t * 17 + e.ph), 0.94 + 0.06 * k);
    }
  }

  /** Освещённость точки 0…1: свет сцены и включённые источники (луч фонаря — в его конусе). */
  private illum(p: Vector3): number {
    let k = sceneLitness(this.scene) * 0.6;
    for (const l of this.scene.lights) {
      if (!l.isEnabled() || l.intensity <= 0) continue;
      if (l instanceof SpotLight) {
        const pos = (l.parent ? l.transformedPosition : null) ?? l.position;
        const dir = (l.parent ? l.transformedDirection : null) ?? l.direction;
        const v = p.subtract(pos);
        const d = v.length();
        if (d < 1e-3 || d > l.range) continue;
        const c = Vector3.Dot(v, dir) / (d * (dir.length() || 1));
        const cc = Math.cos(l.angle / 2);
        if (c < cc) continue;
        k += l.intensity * Math.pow(Math.max(0, c), Math.min(16, l.exponent)) * (1 - d / l.range) * 1.4;
      } else if (l instanceof PointLight) {
        const d = Vector3.Distance(p, l.getAbsolutePosition());
        if (d < l.range) k += l.intensity * (1 - d / l.range) * 0.5;
      }
    }
    return Math.min(1, k);
  }

  /** Блики мелочи под светом: короткие вспышки (по времени и сдвигу камеры — «играет», когда идёшь), в темноте — нет. */
  private glints(portal: PortalRenderer | null) {
    const cam = this.opts.camera?.() ?? this.scene.activeCamera;
    if (!cam) return;
    const c = cam.globalPosition;
    for (const e of this.entries.values()) {
      const g = e.glint;
      if (!g) continue;
      if (!(portal || e.shown)) continue;
      let v = 0;
      if (Vector3.DistanceSquared(c, e.center) < GLINT_R * GLINT_R) {
        const lit = this.illum(e.center);
        if (lit > GLINT_MIN) {
          const s = Math.max(0, Math.sin(this.t * 1.25 + e.ph + c.x * 2.3 + c.z * 1.9));
          const tw = Math.pow(s, 18);
          v = Math.min(1, lit * 1.4) * (0.1 + 0.9 * tw);
          g.scaling.setAll(0.55 + 0.6 * tw);
        }
      }
      g.visibility = v;
    }
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
    // только копии подсветки (и подматериалы-копии MultiMaterial); исходные — общие (шаблоны моделей)
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

function same(a: WorldDrop, b: WorldDrop): boolean {
  return (
    a.id === b.id && a.item === b.item && a.inst === b.inst && a.x === b.x && a.y === b.y && a.z === b.z && a.yaw === b.yaw &&
    a.on === b.on && a.n === b.n && a.q === b.q && a.w === b.w && a.u === b.u
  );
}

/** Ключ навесного (пересборка, когда поменялся). */
function partsKey(look: ItemLook, d: WorldDrop): string {
  return look.parts ? look.parts(slotOf(d)).map((p) => p.item).join(',') : '';
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
