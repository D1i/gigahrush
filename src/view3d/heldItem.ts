// Предмет в руке «Прогулки» (любой из хотбара): модель лута у камеры справа внизу (левой рукой — зеркально), кисть в
// вязаной перчатке и рукав ватника, свет предмета и жесты. Заменяет фонарь (./flashlight.ts: Flashlight) и лампу общаги
// (./obshagaScene.ts: HeldLantern) в руке игрока; модель фонаря для аватаров кооп — FlashlightModel, там же.
//  • Как держат — реестр видов (./itemLooks.ts: ItemLook.hold): кисть 'fist' (фонари — кулак вдоль взгляда), 'grip'
//    (стоящее — бутылка, зиппа, батарейка), 'palm' (на ладони — хлеб, коробок, карты, копейки), 'hang' (за дужку —
//    керосинка, канистра: висит и качается), 'pinch' (щепотью — горящая спичка); где кисть в осях камеры, точка хвата и
//    поворот модели. Сумки (hold: null) в руке не видны. Модель ещё грузится — видно только свет, потом появляется.
//  • Как Flashlight: группа рендера 1 (поверх стен, не проваливается в стену вплотную), alwaysSelectAsActiveMesh,
//    isPickable = false, слой 0x0fffffff; покачивание на ходу (на бегу — размашисто), запаздывание за поворотом взгляда;
//    на четвереньках рука уходит вниз из кадра, свет остаётся. Материалы модели — свои копии (свечение «отражённого
//    света» в темноте не трогает лежащие на полу).
//  • Свет — по Light из itemUse.lightOf (каждый кадр через set): 'spot' — луч П-2 / «Жучка» (конус и спад — как у
//    Flashlight; у глаза, к прицелу в AIM_M; яркость — по свету сцены × Light.intensity, включение П-2 — щелчок и моргание,
//    стекло светится); 'point' — огонёк спички / зиппы / керосинки (тёплый, с дрожью; источник ближе к глазу, чем огонь, —
//    не уходит в стену) и язычок пламени на фитиле. Горящая спичка (set(…, { match })) — в руке спичка вместо ячейки.
//  • Жесты (gesture): 'eat' / 'drink' — поднести ко рту, 'strike' — чиркнуть, 'pump' — качнуть «Жучка», 'reload' —
//    опустить из кадра и вернуть.
//
// ИНТЕГРАЦИЯ (Inventory.frame, каждый кадр):
//   const held = new HeldItem(viewer);
//   held.set(руки ? slot : null, lightOf(slot, ctx, tr), { match: tr.match?.item ?? null });
//   held.update(dt, { speed, sprint, crawl, side });     // sprint / crawl — 0…1 или boolean; side −1 — левой рукой
//   held.gesture('eat');                                 // по действию
//   held.dispose();
import type { Scene } from '@babylonjs/core/scene';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import type { Material } from '@babylonjs/core/Materials/material';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { SpotLight } from '@babylonjs/core/Lights/spotLight';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Slot } from '../game/hotbar';
import { BUG, HUNT_MATCHES, KEROLAMP, MATCHES, MATCH_DEFS, P2, ZIPPO, type Light } from '../game/itemUse';
import { FLASH_ANGLE, FLASH_EXP, ensureLightSlots, flashIntensity, sceneLitness, switchClick, switchSoundOn } from './flashlight';
import { copyMaterial, flameFlicker, flameMeshes, itemLookOf, lensDisc, lookRev, lootFx, type HoldPose, type ItemLook, type V3 } from './itemLooks';

/** Что нужно от просмотрщика: сцена и камера от первого лица (BlockoutViewer подходит). */
export interface HeldHost {
  scene: Scene;
  fps: Camera;
}

/** Ход игрока на кадр (покачивание): скорость по горизонтали, м/с; бег и четвереньки — 0…1 или да/нет; рука. */
export interface HeldMotion {
  speed: number;
  sprint: boolean | number;
  crawl: boolean | number;
  /** 1 — правая (по умолчанию), −1 — левая (правая занята, погреб — боком) */
  side?: -1 | 1;
}

export type HeldGesture = 'eat' | 'drink' | 'strike' | 'pump' | 'reload';

export interface HeldSetOptions {
  /** горит спичка (id коробка: it_matches / it_hunt_matches) — в руке она, а не ячейка */
  match?: string | null;
}

export interface HeldItemOptions {
  /** щелчок выключателя П-2 (по умолчанию — localStorage FLASHLIGHT_SOUND_KEY не '0') */
  sound?: () => boolean;
}

// ───────────────────────── настройки ─────────────────────────

/** Луч: у глаза со своей стороны (ближе к глазу, чем модель — не уходит в стену вплотную), к прицелу на AIM_M. */
const SPOT_AT = new Vector3(0.16, -0.14, 0.12);
const AIM_M = 5;
/** «Жучок»: конус уже и спад круче. */
const BUG_ANGLE = FLASH_ANGLE * 0.85;
const BUG_EXP = 18;
/** Огонёк: яркость при Light.intensity = 1; источник не дальше POINT_Z перед глазом (к центру — POINT_PULL). */
const POINT_BASE = 1.4;
const POINT_Z = 0.16;
const POINT_PULL: V3 = [0.6, 0.75, 1];
/** Плечо (конец рукава) в осях камеры — за краем кадра. */
const SHOULDER = new Vector3(0.3, -0.5, -0.05);
/** Скорость шага «как пешком», м/с, и путь за два шага (полный цикл покачивания), м. */
const WALK_V = 1.4;
const STRIDE_M = 1.47;
/** Моргание лампочки при включении, с. */
const FLICKER_S = 0.22;
/** Источник, ставший ненужным, выключается через, с (включение/выключение пересобирает шейдеры). */
const LIGHT_IDLE_S = 1.5;
/** Горящая спичка в руке: щепотью, чуть вперёд и влево; длина, толщина, головка, м. */
const MATCH = { len: 0.048, d: 0.0026, head: 0.006 };
const MATCH_HOLD: HoldPose = { hand: 'pinch', at: [0.15, -0.12, 0.34], grip: [0, 0.01, 0], rot: [0.35, 0, 0.35] };
/** Коробка-посылка в руке (предмет без модели), м. */
const PARCEL: V3 = [0.09, 0.045, 0.065];
/** Жесты: длительность, с. */
const GESTURE_S: Readonly<Record<HeldGesture, number>> = { eat: 0.9, drink: 1.1, strike: 0.3, pump: 0.22, reload: 0.8 };

const GLOVE = new Color3(0.17, 0.15, 0.13);
const SLEEVE = new Color3(0.2, 0.21, 0.17);

const hash01 = (n: number): number => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

const wrapPi = (a: number): number => {
  a %= Math.PI * 2;
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
};

const num01 = (v: boolean | number | undefined): number => (typeof v === 'number' ? Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0)) : v ? 1 : 0);

/** Плато жеста: быстро туда, держать, обратно (0…1 по доле p). */
const plateau = (p: number, a = 0.3): number => (p <= 0 || p >= 1 ? 0 : p < a ? Math.sin((p / a) * Math.PI * 0.5) : p > 1 - a ? Math.sin(((1 - p) / a) * Math.PI * 0.5) : 1);

/** Что показывать: предмет ячейки, горящая спичка или ничего. */
interface Shown {
  key: string;
  /** id вида (предмет) или null — спичка */
  item: string | null;
  match: string | null;
  look: ItemLook | null;
  hold: HoldPose;
  copies: number;
  parts: readonly { item: string; at: V3 }[];
}

export class HeldItem {
  private readonly scene: Scene;
  private readonly cam: Camera;
  private readonly sound: () => boolean;
  private holder: TransformNode | null = null;
  /** узел модели: поворот и масштаб (вокруг точки хвата) — качание висящего */
  private rotNode: TransformNode | null = null;
  private meshes: Mesh[] = [];
  private nodes: TransformNode[] = [];
  private flame: { node: TransformNode; meshes: Mesh[]; h: number } | null = null;
  private lens: Mesh | null = null;
  private lensMat: StandardMaterial | null = null;
  /** огонь в осях камеры (без покачивания) — от него свет огонька */
  private flameCam: Vector3 | null = null;
  private skin: StandardMaterial[] = [];
  /** свои копии материалов модели (по исходному) и их «отражённый свет» */
  private own = new Map<Material, Material>();
  private ownList: Material[] = [];
  private bounce: { mat: StandardMaterial; em: Color3; dif: Color3 }[] = [];
  private stickMats: StandardMaterial[] = [];
  private spot: SpotLight | null = null;
  private point: PointLight | null = null;
  private spotIdle = 0;
  private pointIdle = 0;
  private cur: Shown | null = null;
  private key = '';
  private pending = false;
  private slot: Slot | null = null;
  private lt: Light | null = null;
  private ltColor = new Color3(1, 1, 1);
  private ltHex = '';
  /** яркость лампочки луча 0…1 (с морганием) */
  private level = 0;
  private flick = 0;
  private spotWas = false;
  private t = 0;
  private phase = 0;
  private amp = 0;
  private sprintK = 0;
  private crawlK = 0;
  private lagYaw = 0;
  private lagPitch = 0;
  private swing = 0;
  private swingV = 0;
  private lastYaw: number | null = null;
  private lastPitch = 0;
  private side: 1 | -1 = 1;
  private gest: { kind: HeldGesture; t: number; dur: number } | null = null;
  private readonly dir0 = new Vector3(0, 0, 1);
  private readonly q = new Quaternion();
  private readonly tmp = new Vector3();
  private disposed = false;

  constructor(v: HeldHost, opts: HeldItemOptions = {}) {
    this.scene = v.scene;
    this.cam = v.fps;
    this.sound = opts.sound ?? switchSoundOn;
    ensureLightSlots(this.scene);
  }

  /** Что сейчас в руке: id предмета, 'match:<id>' — горящая спичка, null — пусто (или сумка). */
  get shown(): string | null {
    return this.cur ? (this.cur.match ? 'match:' + this.cur.match : this.cur.item) : null;
  }

  /** Модель видна (загружена и рука не спрятана). */
  get visible(): boolean {
    return !!this.holder && this.holder.isEnabled() && this.meshes.length > 0;
  }

  /** Источники (тесты, QA): луч и огонёк — null, пока не понадобились. */
  get spotLight(): SpotLight | null {
    return this.spot;
  }

  get pointLight(): PointLight | null {
    return this.point;
  }

  /** Рука: 1 — правая, −1 — левая. */
  get handSide(): 1 | -1 {
    return this.side;
  }

  /**
   * Что в руке и его свет (null — не светит). Каждый кадр; дёшево, если не менялось. Горящая спичка (o.match) — в руке
   * спичка, что бы ни было в ячейке.
   */
  set(slot: Slot | null, light: Light | null, o: HeldSetOptions = {}) {
    if (this.disposed) return;
    const s = this.pick(slot, o.match ?? null);
    const prevItem = this.cur?.item ?? null;
    if (!s) {
      if (this.cur) this.teardown();
      this.cur = null;
      this.key = '';
    } else if (s.key !== this.key || (this.pending && this.template(s))) {
      this.cur = s;
      this.key = s.key;
      this.rebuild();
    }
    this.slot = slot;
    // луч П-2: включили — моргание и щелчок, выключили — щелчок (сменили предмет — без щелчка)
    const spotOn = light?.kind === 'spot';
    const same = (this.cur?.item ?? null) === prevItem;
    if (spotOn && !same) {
      // взял в руку горящий — сразу светит
      this.level = 1;
      this.flick = 0;
    } else if (spotOn && !this.spotWas) {
      this.flick = FLICKER_S;
      if (this.cur?.item === P2 && this.sound()) switchClick(true);
    } else if (!spotOn && this.spotWas && same && this.cur?.item === P2 && this.sound()) switchClick(false);
    if (!same && !spotOn) this.level = 0;
    this.spotWas = spotOn;
    this.lt = light;
    if (light && light.color !== this.ltHex) {
      this.ltHex = light.color;
      const c = /^#[0-9a-f]{6}$/i.test(light.color) ? Color3.FromHexString(light.color) : new Color3(1, 0.85, 0.6);
      this.ltColor.copyFrom(c);
    }
  }

  /** Поза-жест (поднести ко рту, чиркнуть, качнуть, перезарядить) — короткая анимация поверх покачивания. */
  gesture(kind: HeldGesture) {
    if (this.disposed) return;
    this.gest = { kind, t: 0, dur: GESTURE_S[kind] };
  }

  /** Идёт ли жест. */
  get gesturing(): HeldGesture | null {
    return this.gest?.kind ?? null;
  }

  private pick(slot: Slot | null, match: string | null): Shown | null {
    const rev = lookRev();
    if (match) {
      return { key: `match:${match}|${this.side}|${rev}`, item: null, match, look: null, hold: MATCH_HOLD, copies: 1, parts: [] };
    }
    if (!slot) return null;
    const look = itemLookOf(slot.item);
    if (look.hold === null) return null;
    const hold = look.hold ?? itemLookOf('').hold!;
    const copies = Math.max(1, Math.min(hold.pile ?? 1, Math.floor(slot.n ?? 1)));
    const parts = look.parts?.(slot) ?? [];
    const key = `${slot.item}|${this.side}|${copies}|${parts.map((p) => p.item).join(',')}|${rev}`;
    return { key, item: slot.item, match: null, look, hold, copies, parts };
  }

  private template(s: Shown): Mesh | null {
    return s.look?.model ? s.look.model(this.scene) : null;
  }

  // ───────────────────────── сборка ─────────────────────────

  /** Собрать руку и модель заново (сменился предмет, рука, стопка; модель догрузилась). */
  private rebuild() {
    this.teardown();
    const s = this.cur;
    if (!s) return;
    const sc = this.scene;
    const sd = this.side;
    const H = s.hold;
    const h = (this.holder = new TransformNode('held:holder', sc));
    h.parent = this.cam;
    h.position.set(H.at[0] * sd, H.at[1], H.at[2]);
    const rot = (this.rotNode = new TransformNode('held:rot', sc));
    rot.parent = h;
    rot.rotation.set(H.rot[0], H.rot[1] * sd, H.rot[2] * sd);
    rot.scaling.setAll(H.scale ?? 1);
    const grip = new TransformNode('held:grip', sc);
    grip.parent = rot;
    grip.position.set(-H.grip[0], -H.grip[1], -H.grip[2]);
    this.nodes = [h, rot, grip];
    this.pending = false;
    // модель: горящая спичка — своя; предмет — клон шаблона (ещё грузится — пусто, повтор в set); нет модели — посылка
    if (s.match) this.buildMatch(grip, s.match);
    else {
      const tpl = this.template(s);
      if (tpl) {
        for (let k = 0; k < s.copies; k++) {
          const c = tpl.clone(`held:model${k ? ':' + k : ''}`, grip, false);
          if (k) {
            // стопка на ладони: внахлёст, чуть вразброс
            const bb = tpl.getBoundingInfo().boundingBox;
            c.position.set((hash01(k * 3.1) - 0.5) * 0.008, k * (bb.maximum.y - bb.minimum.y) * 1.05, (hash01(k * 7.7) - 0.5) * 0.008);
            c.rotation.y = hash01(k * 5.3) * 6.28;
          }
          this.adopt(c);
        }
        for (const p of s.parts) {
          const pt = itemLookOf(p.item).model?.(sc) ?? null;
          if (!pt) continue;
          const c = pt.clone(`held:part:${p.item}`, grip, false);
          c.position.set(p.at[0], p.at[1], p.at[2]);
          this.adopt(c);
        }
      } else if (s.look?.model) this.pending = true;
      else {
        const b = CreateBox('held:parcel', { width: PARCEL[0], height: PARCEL[1], depth: PARCEL[2] }, sc);
        b.position.y = PARCEL[1] / 2;
        b.parent = grip;
        const m = new StandardMaterial('held:parcelMat', sc);
        m.diffuseColor = Color3.FromHexString('#b08d57').scale(0.9);
        m.specularColor = new Color3(0.04, 0.04, 0.04);
        b.material = m;
        this.stickMats.push(m);
        this.meshes.push(b);
      }
      // светится: стекло фонаря (своя копия материала — по яркости), язычок пламени на фитиле
      const L = s.look;
      if (L?.lens && !this.pending) {
        const lm = (this.lensMat = new StandardMaterial('held:lens', sc));
        lm.diffuseColor = Color3.Black();
        lm.specularColor = Color3.Black();
        lm.emissiveColor = Color3.Black();
        lm.disableLighting = true;
        lm.emissiveTexture = lm.opacityTexture = lootFx(sc).reflector;
        this.lens = lensDisc(sc, 'held:lens', grip, L.lens, lm);
        this.meshes.push(this.lens);
      }
      if (L?.flame && !this.pending) this.addFlame(grip, L.flame.at, L.flame.h);
    }
    // огонь в осях камеры: кисть + поворот × (огонь − хват) × масштаб
    if (this.flame) {
      const f = this.flame.node.position;
      const v = new Vector3(f.x - H.grip[0], f.y - H.grip[1], f.z - H.grip[2]).scale(H.scale ?? 1);
      const r = Quaternion.RotationYawPitchRoll(H.rot[1] * sd, H.rot[0], H.rot[2] * sd);
      this.flameCam = v.rotateByQuaternionToRef(r, new Vector3()).addInPlace(h.position);
    } else this.flameCam = null;
    // модель ещё грузится — пустую руку не показывать (свет — уже)
    if (this.meshes.length) this.buildHand(h, H.hand);
    for (const m of this.meshes) this.prep(m);
    h.setEnabled(this.crawlK < 0.9);
    this.lastYaw = null;
  }

  /** Клон шаблона — в руку: свои копии материалов, всё включено. */
  private adopt(c: Mesh) {
    for (const m of [c, ...c.getChildMeshes(false)]) {
      m.setEnabled(true);
      m.isVisible = true;
      if (!(m instanceof Mesh)) continue;
      if (m.material) m.material = this.ownMat(m.material);
      if (m.getTotalVertices() > 0) this.meshes.push(m);
    }
  }

  private ownMat(src: Material): Material {
    const hit = this.own.get(src);
    if (hit) return hit;
    const c = copyMaterial(src, ':held', this.ownList, (m, s) => {
      this.bounce.push({ mat: m, em: s.emissiveColor.clone(), dif: s.diffuseTexture ? new Color3(0.8, 0.8, 0.8) : s.diffuseColor.clone() });
    });
    this.own.set(src, c);
    return c;
  }

  private addFlame(parent: TransformNode, at: V3, hgt: number) {
    const f = flameMeshes(this.scene, 'held:flame', parent, hgt);
    f.node.position.set(at[0], at[1], at[2]);
    this.flame = { ...f, h: hgt };
    for (const m of f.meshes) {
      this.meshes.push(m);
      m.setEnabled(false);
    }
  }

  /** Горящая спичка: палочка, обгоревшая головка, язычок (оси модели: низ палочки — 0, вверх — головка). */
  private buildMatch(parent: TransformNode, match: string) {
    const sc = this.scene;
    const hunt = match === HUNT_MATCHES;
    const wood = new StandardMaterial('held:matchWood', sc);
    wood.diffuseColor = hunt ? new Color3(0.62, 0.5, 0.32) : new Color3(0.78, 0.66, 0.45);
    wood.specularColor = new Color3(0.03, 0.03, 0.03);
    const head = new StandardMaterial('held:matchHead', sc);
    head.diffuseColor = new Color3(0.09, 0.06, 0.05);
    head.emissiveColor = new Color3(0.35, 0.09, 0.02);
    head.specularColor = new Color3(0.05, 0.05, 0.05);
    this.stickMats.push(wood, head);
    const stick = CreateCylinder('held:matchStick', { height: MATCH.len, diameter: MATCH.d * (hunt ? 1.25 : 1), tessellation: 6 }, sc);
    stick.position.y = MATCH.len / 2;
    stick.material = wood;
    stick.parent = parent;
    const hd = CreateSphere('held:matchHead', { diameter: 1, segments: 6 }, sc);
    hd.scaling.set(MATCH.head * 0.75, MATCH.head * (hunt ? 1.6 : 1.05), MATCH.head * 0.75);
    hd.position.y = MATCH.len + MATCH.head * 0.25;
    hd.material = head;
    hd.parent = parent;
    this.meshes.push(stick, hd);
    this.addFlame(parent, [0, MATCH.len + MATCH.head * (hunt ? 1.6 : 1.3), 0], hunt ? 0.014 : 0.017);
  }

  /** Кисть в вязаной перчатке и рукав ватника к плечу за краем кадра — по виду хвата (начало узла — точка хвата). */
  private buildHand(h: TransformNode, kind: HoldPose['hand']) {
    const sc = this.scene;
    const sd = this.side;
    const glove = new StandardMaterial('held:glove', sc);
    glove.diffuseColor = GLOVE.clone();
    glove.specularColor = new Color3(0.02, 0.02, 0.02);
    const sleeve = new StandardMaterial('held:sleeve', sc);
    sleeve.diffuseColor = SLEEVE.clone();
    sleeve.specularColor = new Color3(0.02, 0.02, 0.02);
    this.skin = [glove, sleeve];
    const blob = (name: string, s: V3, p: V3, r: V3 = [0, 0, 0]) => {
      const m = CreateSphere(name, { diameter: 1, segments: 10 }, sc);
      m.scaling.set(s[0], s[1], s[2]);
      m.position.set(p[0] * sd, p[1], p[2]);
      m.rotation.set(r[0], r[1] * sd, r[2] * sd);
      m.material = glove;
      m.parent = h;
      this.meshes.push(m);
      return m;
    };
    let wrist: V3;
    if (kind === 'fist') {
      // кулак вокруг корпуса вдоль взгляда, большой палец сверху
      blob('held:fist', [0.078, 0.07, 0.086], [0.008, -0.01, -0.012]);
      blob('held:thumb', [0.022, 0.02, 0.05], [-0.02, 0.022, 0.016], [0, 0.25, 0]);
      wrist = [0.014, -0.016, -0.06];
    } else if (kind === 'grip') {
      // кулак вокруг стоящего: тыл ладони справа, большой палец — со стороны игрока
      blob('held:fist', [0.062, 0.072, 0.064], [0.016, -0.004, 0.006]);
      blob('held:thumb', [0.02, 0.019, 0.044], [-0.014, 0.014, -0.022], [0, -0.9, 0.2]);
      wrist = [0.03, -0.05, -0.03];
    } else if (kind === 'palm') {
      // ладонь снизу, пальцы вперёд, большой палец слева
      blob('held:palm', [0.088, 0.026, 0.1], [0.004, -0.014, -0.004]);
      blob('held:fingers', [0.08, 0.03, 0.04], [0.008, -0.006, 0.046], [-0.3, 0, 0]);
      blob('held:thumb', [0.02, 0.019, 0.046], [-0.046, -0.004, 0.0], [0, -0.55, 0]);
      wrist = [0.008, -0.022, -0.064];
    } else if (kind === 'hang') {
      // кулак сжимает дужку сверху
      blob('held:fist', [0.068, 0.064, 0.072], [0.006, 0.01, 0]);
      blob('held:thumb', [0.02, 0.019, 0.044], [-0.018, 0.022, -0.012], [0, 0.4, 0]);
      wrist = [0.016, 0.012, -0.062];
    } else {
      // щепоть: кулачок, большой и указательный держат палочку
      blob('held:fist', [0.056, 0.05, 0.062], [0.014, -0.026, -0.012]);
      blob('held:thumb', [0.017, 0.016, 0.042], [-0.008, -0.006, 0.006], [-0.5, 0.35, 0]);
      blob('held:index', [0.016, 0.016, 0.048], [0.008, -0.002, 0.012], [-0.35, -0.2, 0]);
      wrist = [0.022, -0.046, -0.05];
    }
    // манжета и рукав — от запястья к плечу (в осях кисти)
    const w = new Vector3(wrist[0] * sd, wrist[1], wrist[2]);
    const sh = new Vector3(SHOULDER.x * sd, SHOULDER.y, SHOULDER.z).subtract(h.position);
    const d = sh.subtract(w);
    const len = d.length();
    const ax = d.scale(1 / len);
    const pitch = Math.acos(Math.max(-1, Math.min(1, ax.y)));
    const yaw = Math.atan2(ax.x, ax.z);
    const cuff = CreateCylinder('held:cuff', { diameter: 0.07, height: 0.03, tessellation: 12 }, sc);
    cuff.position.copyFrom(w.add(ax.scale(0.012)));
    cuff.rotation.set(pitch, yaw, 0);
    cuff.material = glove;
    cuff.parent = h;
    const arm = CreateCylinder('held:sleeve', { diameterBottom: 0.078, diameterTop: 0.11, height: len, tessellation: 12 }, sc);
    arm.position.copyFrom(w.add(d.scale(0.5)));
    arm.rotation.set(pitch, yaw, 0);
    arm.material = sleeve;
    arm.parent = h;
    this.meshes.push(cuff, arm);
  }

  private prep(m: Mesh) {
    m.isPickable = false;
    m.checkCollisions = false;
    m.receiveShadows = false;
    m.renderingGroupId = 1;
    m.alwaysSelectAsActiveMesh = true;
    m.layerMask = 0x0fffffff;
  }

  /** Модель, кисть, рукав — убрать (свет остаётся; копии материалов — для следующего раза). */
  private teardown() {
    for (const m of this.meshes) m.dispose(false, false);
    this.flame?.node.dispose(false, false);
    for (const n of this.nodes.reverse()) n.dispose(false, false);
    for (const m of [...this.skin, ...this.stickMats]) m.dispose(false, false);
    this.lensMat?.dispose(false, false);
    this.meshes = [];
    this.nodes = [];
    this.skin = [];
    this.stickMats = [];
    this.flame = null;
    this.lens = null;
    this.lensMat = null;
    this.flameCam = null;
    this.holder = null;
    this.rotNode = null;
  }

  // ───────────────────────── свет ─────────────────────────

  private spotLightOf(): SpotLight {
    if (this.spot) return this.spot;
    const l = (this.spot = new SpotLight('held:spot', SPOT_AT.clone(), new Vector3(0, 0, 1), FLASH_ANGLE, FLASH_EXP, this.scene));
    l.parent = this.cam;
    l.intensity = 0;
    l.specular = new Color3(0.3, 0.28, 0.24);
    return l;
  }

  private pointLightOf(): PointLight {
    if (this.point) return this.point;
    const l = (this.point = new PointLight('held:point', new Vector3(0.12, -0.2, 0.14), this.scene));
    l.parent = this.cam;
    l.intensity = 0;
    l.specular = new Color3(0.2, 0.15, 0.08);
    return l;
  }

  /** Какие источники нужны предмету (держать включёнными, пока он в руке: вкл/выкл — без пересборки шейдеров). */
  private wants(): { spot: boolean; point: boolean } {
    const it = this.cur?.item;
    const k = this.lt?.kind;
    return {
      spot: k === 'spot' || it === P2 || it === BUG,
      point: k === 'point' || !!this.cur?.match || it === ZIPPO || it === KEROLAMP || it === MATCHES || it === HUNT_MATCHES,
    };
  }

  // ───────────────────────── кадр ─────────────────────────

  /** Кадр: моргание, свет, покачивание, запаздывание за взглядом, четвереньки, жест, дрожь пламени. */
  update(dt: number, m: HeldMotion) {
    if (this.disposed) return;
    dt = Math.min(0.1, Math.max(0, Number.isFinite(dt) ? dt : 0));
    this.t += dt;
    const t = this.t;
    const side = m.side === -1 ? -1 : 1;
    if (side !== this.side) {
      this.side = side;
      if (this.cur) {
        // ключ — с рукой: пересобрать зеркально
        const s = this.pick(this.slot, this.cur.match);
        if (s) {
          this.cur = s;
          this.key = s.key;
          this.rebuild();
        }
      }
    }
    const L = this.lt;
    // лампочка луча: включение — моргание FLICKER_S, выключение — быстро гаснет
    if (L?.kind === 'spot') {
      if (this.flick > 0) {
        this.flick = Math.max(0, this.flick - dt);
        const k = 1 - this.flick / FLICKER_S;
        const blink = hash01(Math.floor(t * 40)) < 0.45 + 0.5 * k ? 1 : 0.12;
        this.level = Math.min(1, k * 1.6) * blink;
      } else this.level += (1 - this.level) * Math.min(1, dt * 30);
    } else this.level = Math.max(0, this.level - dt * 14);

    const speed = Math.max(0, Number.isFinite(m.speed) ? m.speed : 0);
    const sprint = num01(m.sprint);
    const crawl = num01(m.crawl);
    const e = (r: number) => Math.min(1, dt * r);
    this.amp += (Math.min(1.6, speed / WALK_V) - this.amp) * e(6);
    this.sprintK += (sprint - this.sprintK) * e(5);
    this.crawlK += (crawl - this.crawlK) * e(5);
    this.phase += (speed * dt * Math.PI * 2) / STRIDE_M;
    // запаздывание за поворотом взгляда (рука догоняет)
    const f = this.cam.getDirection(Vector3.Forward());
    const yaw = Math.atan2(f.x, f.z);
    const pitchV = Math.asin(Math.max(-1, Math.min(1, f.y)));
    let wy = 0;
    if (this.lastYaw !== null && dt > 0) {
      wy = wrapPi(yaw - this.lastYaw) / dt;
      const wp = (pitchV - this.lastPitch) / dt;
      this.lagYaw += (Math.max(-0.08, Math.min(0.08, -wy * 0.012)) - this.lagYaw) * e(10);
      this.lagPitch += (Math.max(-0.06, Math.min(0.06, wp * 0.01)) - this.lagPitch) * e(10);
    }
    this.lastYaw = yaw;
    this.lastPitch = pitchV;

    const a = this.amp, s = this.sprintK, c = this.crawlK, ph = this.phase;
    const sd = this.side;
    const breathe = 0.003 * Math.sin(t * 1.3);
    // ход: вбок раз за два шага, вниз-вверх — каждый шаг; бег — размашисто, ниже, луч ныряет к полу
    const sx = (0.009 + 0.012 * s) * Math.sin(ph) * a;
    const sy = (0.007 + 0.012 * s) * Math.cos(ph * 2) * a + breathe;
    let rx = (0.025 + 0.1 * s) * Math.sin(ph + 0.6) * a + 0.16 * s + this.lagPitch + 0.01 * Math.sin(t * 1.1);
    let ry = 0.03 * Math.sin(ph) * a + this.lagYaw + 0.008 * Math.sin(t * 0.8);
    let rz = (0.05 + 0.06 * s) * Math.sin(ph) * a * sd;
    // жест
    let gx = 0, gy = 0, gz = 0;
    const H = this.cur?.hold;
    if (this.gest) {
      const g = this.gest;
      g.t += dt;
      const p = g.t / g.dur;
      if (p >= 1) this.gest = null;
      else if (H) {
        const at = H.at;
        if (g.kind === 'eat' || g.kind === 'drink') {
          // ко рту: к середине кадра снизу, ближе к лицу; пьют — запрокинуть
          const k = plateau(p);
          const to: V3 = g.kind === 'eat' ? [0.05, -0.1, 0.24] : [0.035, -0.05, 0.21];
          gx = (to[0] - at[0]) * sd * k;
          gy = (to[1] - at[1]) * k + (g.kind === 'eat' ? 0.006 * Math.sin(g.t * 22) * k : 0);
          gz = (to[2] - at[2]) * k;
          rx += (g.kind === 'eat' ? -0.35 : -0.95) * k;
          ry += -0.25 * sd * k;
        } else if (g.kind === 'strike') {
          const k = Math.sin(Math.PI * p);
          gx = -0.035 * sd * k;
          gy = -0.018 * k;
          gz = 0.02 * k;
          rz += 0.35 * sd * k;
        } else if (g.kind === 'pump') {
          const k = Math.sin(Math.PI * p);
          gy = -0.012 * k;
          rx += 0.1 * k;
        } else {
          const k = plateau(p, 0.35);
          gx = 0.04 * sd * k;
          gy = -0.34 * k;
          rx += 0.4 * k;
        }
      }
    }
    const hd = this.holder;
    if (hd && H) {
      // на четвереньках — вниз из кадра (руки там — CrawlHands), почти спрятан — выключен
      hd.position.set(H.at[0] * sd + sx - this.lagYaw * 0.15 + gx, H.at[1] + sy - 0.035 * s - 0.34 * c + gy, H.at[2] - 0.03 * s - 0.1 * c + gz);
      hd.rotation.set(rx, ry, rz);
      const vis = c < 0.9;
      if (vis !== hd.isEnabled()) hd.setEnabled(vis);
      // висящее (лампа, канистра) качается маятником: от хода и поворота взгляда
      if (H.hand === 'hang' && this.rotNode) {
        const push = -0.6 * Math.sin(ph * 0.5) * a * 0.12 + wy * 0.02;
        this.swingV += (-this.swing * 38 - this.swingV * 4.5 + push * 30) * dt;
        this.swing = Math.max(-0.35, Math.min(0.35, this.swing + this.swingV * dt));
        this.rotNode.rotation.z = H.rot[2] * sd + this.swing;
        this.rotNode.rotation.x = H.rot[0] + 0.4 * this.swing * Math.cos(ph * 0.5);
      }
    }
    // свет
    const want = this.wants();
    const lit = sceneLitness(this.scene);
    if (want.spot || this.spot) {
      const l = this.spotLightOf();
      if (want.spot) {
        this.spotIdle = 0;
        if (!l.isEnabled()) l.setEnabled(true);
        const bug = this.cur?.item === BUG;
        l.angle = bug ? BUG_ANGLE : FLASH_ANGLE;
        l.exponent = bug ? BUG_EXP : FLASH_EXP;
        // у глаза со своей стороны, к прицелу; вслед за рукой (без крена), на четвереньках — прямо
        const x = SPOT_AT.x * sd;
        l.position.set(x, SPOT_AT.y, SPOT_AT.z);
        this.dir0.set(-x, -SPOT_AT.y, AIM_M - SPOT_AT.z).normalize();
        const k = 0.85 * (1 - c);
        Quaternion.RotationYawPitchRollToRef(ry * k, rx * k, 0, this.q);
        this.dir0.rotateByQuaternionToRef(this.q, this.tmp);
        l.direction.copyFrom(this.tmp);
        const wobble = 0.97 + 0.03 * Math.sin(t * 2.3) * Math.sin(t * 0.7);
        const sp = L?.kind === 'spot' ? L : null;
        l.intensity = sp ? this.level * flashIntensity(lit) * sp.intensity * wobble : 0;
        if (sp) {
          l.range = sp.range;
          l.diffuse.copyFrom(this.ltColor);
        }
      } else {
        l.intensity = 0;
        this.spotIdle += dt;
        if (this.spotIdle > LIGHT_IDLE_S && l.isEnabled()) l.setEnabled(false);
      }
    }
    let flameK = 0;
    if (want.point || this.point) {
      const l = this.pointLightOf();
      const pt = L?.kind === 'point' ? L : null;
      if (want.point) {
        this.pointIdle = 0;
        if (!l.isEnabled()) l.setEnabled(true);
        const fc = this.flameCam ?? new Vector3(0.16 * sd, -0.18, 0.4);
        l.position.set(fc.x * POINT_PULL[0] + sx, fc.y * POINT_PULL[1] + sy - 0.34 * c, Math.min(POINT_Z, fc.z));
        const fl = flameFlicker(t, 0.7, 1.4);
        l.intensity = pt ? POINT_BASE * pt.intensity * fl : 0;
        if (pt) {
          l.range = pt.range;
          l.diffuse.copyFrom(this.ltColor);
          flameK = pt.intensity;
        }
      } else {
        l.intensity = 0;
        this.pointIdle += dt;
        if (this.pointIdle > LIGHT_IDLE_S && l.isEnabled()) l.setEnabled(false);
      }
    }
    // язычок: горит — виден, размер — по яркости (догорающая спичка меньше), дрожит
    if (this.flame) {
      const on = flameK > 0.01;
      for (const x of this.flame.meshes) if (x.isEnabled() !== on) x.setEnabled(on);
      if (on) {
        const base = this.cur?.match ? (MATCH_DEFS[this.cur.match]?.intensity ?? 0.5) : this.cur?.item === ZIPPO ? 0.45 : 0.8;
        const size = Math.min(1.15, Math.sqrt(Math.min(1.5, flameK / base)));
        const k = flameFlicker(t * 1.3, 1.9, 2.4);
        // огонь тянется вверх и чуть отстаёт от руки на ходу
        this.flame.node.scaling.set(size * (0.92 + 0.08 * k), size * (0.8 + 0.2 * k + 0.06 * Math.sin(t * 19)), size * (0.92 + 0.08 * k));
        this.flame.node.rotation.set(-rx * 0.5 + 0.05 * Math.sin(t * 7), 0, -rz * 0.6 + 0.04 * Math.sin(t * 5.3));
      }
    }
    // стекло фонаря светится по яркости луча
    if (this.lensMat) this.lensMat.emissiveColor.copyFromFloats(this.ltColor.r * this.level, this.ltColor.g * this.level, this.ltColor.b * this.level);
    // рука и модель чуть подсвечены отражённым от стен светом (в темноте; огонёк — ещё и сам светит на них)
    const amb = 0.012 + (0.05 * this.level + 0.03 * Math.min(1, flameK * 2)) * (1 - lit);
    for (const sk of this.skin) sk.emissiveColor.set(amb * 1.6, amb * 1.5, amb * 1.35);
    for (const b of this.bounce) b.mat.emissiveColor.set(b.em.r + b.dif.r * amb, b.em.g + b.dif.g * amb, b.em.b + b.dif.b * amb);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.teardown();
    for (const m of this.ownList) m.dispose(false, false);
    this.ownList = [];
    this.own.clear();
    this.bounce = [];
    this.spot?.dispose();
    this.point?.dispose();
    this.spot = this.point = null;
    this.cur = null;
  }
}
