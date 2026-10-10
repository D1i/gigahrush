// Модель игрока для кооп-аватара (src/coop/presence.ts, docs/COOP.md): «забинтованный в шинели» — набор пользователя
// bandaged_man (src/coop/assets/bandaged_man.glb, собирает tools/optimize-avatar.mjs). Low-poly, рост ~2 м с пилоткой,
// скелет 19 костей (Hips … Head, Hand.L/R), четыре клипа на месте: Idle_Standing, Walk, Idle_Crawl, Crawl.
//
//  • Модель грузится один раз на сцену (AvatarModels), каждому напарнику — своя копия со своим скелетом и клипами
//    (AssetContainer.instantiateModelsToScene). Материалы PBR набора — в StandardMaterial (как у пропов,
//    src/view3d/propModels.ts): одноцветные, цвета набора (линейные) — в гамму, чуть свечения, чтобы в тёмных биомах
//    напарник читался.
//  • Шинель (материалы «Field wool» и «Worn seams») — по месту игрока в лобби (PlayerInfo.slot): у первого — как в
//    наборе, у второго — слегка перекрашена (бурее), у третьего — синее, у четвёртого — рыжее (COAT_TINTS).
//  • Поза — по высоте глаз (PlayerState.eye) и скорости (postureWeights): стоя 1.6 м — клипы стоя; скрючившись (до
//    1.1) — те же клипы, поверх — согнутые колени и наклон корпуса (CROUCH), ноги — на пол по щиколотке; ниже — к
//    клипам ползком (на четвереньках 0.5, лёжа 0.22 — ниже модели, сплюснута по высоте). В клипах ползком набора
//    носки уходят в пол — ступни довёрнуты носками назад (CRAWL_FOOT), модель чуть приподнята (CRAWL_LIFT). На ходу —
//    Walk / Crawl, темп клипа — по скорости. Голова — по наклону взгляда (pitch).
//  • Портальный рендер рисует меши аватара сам (m.render), минуя выбор активных мешей сцены, — поэтому скелет и матрицы
//    узлов обновляются здесь, в update (после анимаций кадра).
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF/2.0/glTFLoader';
import '@babylonjs/loaders/glTF/2.0/Extensions/KHR_mesh_quantization';
import '@babylonjs/core/Animations/animatable';
import '@babylonjs/core/Animations/animationGroup';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { AssetContainer, InstantiatedEntries } from '@babylonjs/core/assetContainer';
import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import type { Material } from '@babylonjs/core/Materials/material';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import modelUrl from './assets/bandaged_man.glb?url';

/** Клипы набора. */
export const CLIPS = ['Idle_Standing', 'Walk', 'Idle_Crawl', 'Crawl'] as const;
export type Clip = (typeof CLIPS)[number];

/** Глаз (голова модели, кость Head) над ногами, м: стоя / скрючившись (Posture: 1.6 / 1.1). */
export const EYE_STAND = 1.6;
export const EYE_CROUCH = 1.1;
/** Скрючившись — поверх клипов стоя, град (вокруг оси X кости): бедро вперёд, колено согнуто, ступня — ровно по полу,
 *  поясница и грудь вперёд. Голова — на 1.10 м над подошвами, вперёд на HEAD_CROUCH_FWD (tmp-замер по модели). */
const CROUCH = { thigh: 55, shin: 100, spine: 25, chest: 20 } as const;
export const HEAD_CROUCH_FWD = 0.29;
/** Щиколотка (кость Foot) над подошвой стоя, м: скрючившись — модель опускается, пока нижняя щиколотка не на ней. */
const ANKLE = 0.13;
/** Ползком: голова над ногами (с подъёмом CRAWL_LIFT) и вперёд от них, м; ступни — носками назад, град; подъём — м
 *  (кулаки в клипе набора — ниже кисти: так они уходят в пол на ~2 см, колени — над полом). */
export const HEAD_CRAWL = 0.724;
export const HEAD_CRAWL_FWD = 0.33;
const CRAWL_FOOT = 40;
const CRAWL_LIFT = 0.05;
/** Ниже модели ползком (лаз, под кроватью) — сплюснута по высоте, но не меньше стольких от роста. */
const MIN_SQUASH = 0.35;
/** Скорость, при которой клип идёт в своём темпе, м/с: шаг стоя (цикл 1.07 с) и ползком (1.6 с). */
const WALK_MPS = 1.4;
const CRAWL_MPS = 0.45;
/** Медленнее этого — стоит на месте, быстрее (+ HALF) — идёт в полную, м/с. */
const MOVE_MPS = 0.12;
const MOVE_HALF = 0.35;
/** Голова наклоняется на такую долю наклона взгляда. */
const HEAD_PITCH = 0.6;
/** Свечение материалов — доля их цвета (в тёмных биомах напарника видно). */
const EMISSIVE = 0.12;

/** Множитель цвета шинели (в гамме) по месту игрока в лобби: первый — как в наборе, второй — чуть бурее, дальше —
 *  синее и рыжее. Мест больше — по кругу. */
export const COAT_TINTS: readonly Color3[] = [
  new Color3(1, 1, 1),
  new Color3(1.12, 0.92, 0.8),
  new Color3(0.9, 0.93, 1.16),
  new Color3(1.15, 0.84, 0.82),
];

/** Материалы шинели (перекрашиваются по месту): сукно и швы. */
const isCoat = (name: string): boolean => /Field wool|Worn seams/i.test(name);

export const coatTint = (slot: number | undefined): Color3 =>
  COAT_TINTS[(((slot ?? 0) % COAT_TINTS.length) + COAT_TINTS.length) % COAT_TINTS.length];

export interface PostureWeights {
  /** веса клипов (в сумме 1) */
  w: Record<Clip, number>;
  /** насколько скрючен 0…1 (поверх клипов стоя; к ползку — сходит на нет) */
  crouch: number;
  /** доля клипов ползком 0…1 */
  crawl: number;
  /** сплющивание по высоте (1 — нет) */
  squash: number;
  /** голова вперёд от ног, м */
  headFwd: number;
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** Поза по высоте глаз над полом (м) и скорости (м/с): стоя → скрючившись (1.6 → 1.1) — сгиб поверх клипов стоя,
 *  дальше → ползком (1.1 → HEAD_CRAWL) — клипы ползком, ниже — сплющивание; на месте ↔ на ходу — по скорости. */
export function postureWeights(eye: number, speed: number): PostureWeights {
  const k = clamp01((EYE_STAND - eye) / (EYE_STAND - EYE_CROUCH));
  const c = clamp01((EYE_CROUCH - eye) / (EYE_CROUCH - HEAD_CRAWL));
  const m = clamp01((speed - MOVE_MPS) / MOVE_HALF);
  return {
    w: { Idle_Standing: (1 - c) * (1 - m), Walk: (1 - c) * m, Idle_Crawl: c * (1 - m), Crawl: c * m },
    crouch: k * (1 - c),
    crawl: c,
    squash: Math.max(MIN_SQUASH, Math.min(1, eye / HEAD_CRAWL)),
    headFwd: HEAD_CROUCH_FWD * k * (1 - c) + HEAD_CRAWL_FWD * c,
  };
}

/** Состояние аватара на кадр: глаза (x, y, z — Babylon), их высота над полом, поворот, наклон взгляда, скорость. */
export interface BodyPose {
  x: number;
  y: number;
  z: number;
  eye: number;
  yaw: number;
  pitch: number;
  speed: number;
}

/** Копия модели у одного напарника. */
export class AvatarBody {
  /** ноги на полу, поворот — по взгляду */
  readonly root: TransformNode;
  readonly meshes: Mesh[];
  readonly hand: { L: TransformNode; R: TransformNode };
  readonly head: TransformNode;
  /** кости, которые гнёт поза поверх клипов */
  private readonly bones: Record<'thighL' | 'thighR' | 'shinL' | 'shinR' | 'footL' | 'footR' | 'spine' | 'chest', TransformNode>;
  private readonly nodes: TransformNode[];
  private readonly groups = new Map<Clip, AnimationGroup>();
  private readonly tilt = new Quaternion();
  /** поворот кости от клипа и наш поверх него (bend) — с прошлого кадра */
  private readonly bent = new Map<TransformNode, { clip: Quaternion; mine: Quaternion }>();

  constructor(
    private readonly scene: Scene,
    private readonly entries: InstantiatedEntries,
    name: string,
  ) {
    this.root = new TransformNode(`${name}:root`, scene);
    for (const n of entries.rootNodes) n.parent = this.root;
    const all = this.root.getDescendants(false) as TransformNode[];
    const node = (id: string): TransformNode => {
      const n = all.find((x) => x.name === `${name}:${id}`);
      if (!n) throw new Error(`модель игрока: нет узла ${id}`);
      return n;
    };
    this.hand = { L: node('Hand.L'), R: node('Hand.R') };
    this.head = node('Head');
    this.bones = {
      thighL: node('Thigh.L'),
      thighR: node('Thigh.R'),
      shinL: node('Shin.L'),
      shinR: node('Shin.R'),
      footL: node('Foot.L'),
      footR: node('Foot.R'),
      spine: node('Spine'),
      chest: node('Chest'),
    };
    // по порядку обхода: родитель раньше детей (матрицы мира — сверху вниз)
    this.nodes = [this.root, ...all];
    this.meshes = all.filter((n): n is Mesh => 'subMeshes' in n && !!(n as AbstractMesh).getTotalVertices?.());
    for (const m of this.meshes) {
      m.isPickable = false;
      m.checkCollisions = false;
      // скелет двигает вершины дальше габарита позы покоя — не отсекать по нему
      m.alwaysSelectAsActiveMesh = true;
    }
    for (const g of entries.animationGroups) {
      // клон клипа — с префиксом имени копии (nameFunction)
      const clip = CLIPS.find((c) => g.name === c || g.name.endsWith(`:${c}`));
      if (!clip) continue;
      g.stop();
      g.weight = clip === 'Idle_Standing' ? 1 : 0;
      g.play(true);
      this.groups.set(clip, g);
    }
    this.root.setEnabled(false);
  }

  /** Показать / скрыть (клипы идут и у скрытого — дёшево, а показанный не замирает на миг). */
  setEnabled(on: boolean) {
    if (this.root.isEnabled(false) !== on) this.root.setEnabled(on);
  }

  get enabled(): boolean {
    return this.root.isEnabled(false);
  }

  /** Веса клипов (для QA). */
  get weights(): Partial<Record<Clip, number>> {
    const o: Partial<Record<Clip, number>> = {};
    for (const [c, g] of this.groups) o[c] = g.weight;
    return o;
  }

  /** Поза кадра: веса и темп клипов, сгиб поверх клипов (скрючившись, ступни ползком, голова по взгляду), положение
   *  (голова — у глаз, ноги — на полу); затем матрицы и скелет. Звать после анимаций кадра (onBeforeRenderObservable):
   *  клипы уже записали повороты костей. */
  update(p: BodyPose) {
    const pw = postureWeights(p.eye, p.speed);
    for (const [c, g] of this.groups) {
      g.weight = pw.w[c];
      const nominal = c === 'Walk' ? WALK_MPS : c === 'Crawl' ? CRAWL_MPS : 0;
      g.speedRatio = nominal ? Math.min(2.2, Math.max(0.6, p.speed / nominal)) : 1;
    }
    const k = pw.crouch, c = pw.crawl, b = this.bones;
    this.bend(b.thighL, -CROUCH.thigh * k);
    this.bend(b.thighR, -CROUCH.thigh * k);
    this.bend(b.shinL, CROUCH.shin * k);
    this.bend(b.shinR, CROUCH.shin * k);
    const foot = -(CROUCH.shin - CROUCH.thigh) * k + CRAWL_FOOT * c;
    this.bend(b.footL, foot);
    this.bend(b.footR, foot);
    this.bend(b.spine, CROUCH.spine * k);
    this.bend(b.chest, CROUCH.chest * k);
    this.bend(this.head, (p.pitch * HEAD_PITCH * 180) / Math.PI);
    const feet = p.y - p.eye;
    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
    const fwd = pw.headFwd;
    this.root.position.set(p.x - fx * fwd, feet, p.z - fz * fwd);
    this.root.rotation.set(0, p.yaw, 0);
    this.root.scaling.set(1, 1, 1);
    for (const n of this.nodes) n.computeWorldMatrix(true);
    // скрючившись — ноги на пол: нижняя щиколотка на высоту стоя (колени согнуты — без этого ступни в воздухе)
    let lift = CRAWL_LIFT * c;
    if (k > 0) {
      const ankle = Math.min(b.footL.getAbsolutePosition().y, b.footR.getAbsolutePosition().y) - feet;
      lift += (ANKLE - ankle) * Math.min(1, k * 4);
    }
    this.root.position.y = feet + lift * pw.squash;
    this.root.scaling.set(1, pw.squash, 1);
    for (const n of this.nodes) n.computeWorldMatrix(true);
    for (const s of this.entries.skeletons) s.prepare(true);
  }

  /** Повернуть кость поверх клипа на deg вокруг её оси X. Клип пишет поворот каждый кадр анимаций; не записал (кадр
   *  без анимаций) — поворот ещё наш с прошлого раза: сгиб — от поворота клипа, не копится. */
  private bend(n: TransformNode, deg: number) {
    const q = n.rotationQuaternion;
    if (!q) return;
    let b = this.bent.get(n);
    if (!b) this.bent.set(n, (b = { clip: q.clone(), mine: q.clone() }));
    else if (q.equalsWithEpsilon(b.mine, 1e-7)) q.copyFrom(b.clip);
    b.clip.copyFrom(q);
    if (Math.abs(deg) > 1e-3) {
      Quaternion.RotationAxisToRef(Vector3.Right(), (deg * Math.PI) / 180, this.tilt);
      q.multiplyInPlace(this.tilt);
    }
    b.mine.copyFrom(q);
  }

  /** Точка в руке (мир). */
  handPos(side: 'L' | 'R'): Vector3 {
    return this.hand[side].getAbsolutePosition();
  }

  dispose() {
    for (const g of this.groups.values()) g.stop();
    this.entries.dispose();
    this.root.dispose(false, false);
  }
}

interface PbrLike extends Material {
  albedoColor?: Color3;
  metallic?: number | null;
}

/** Модель игрока сцены: грузится один раз, копии — make. Пока не загрузилась (или не смогла) — make даёт null. */
export class AvatarModels {
  private container: AssetContainer | null = null;
  /** материалы набора в StandardMaterial (шинель — как в наборе) */
  private readonly base = new Set<StandardMaterial>();
  /** шинель по множителю цвета: «материал|номер в COAT_TINTS» */
  private readonly coats = new Map<string, StandardMaterial>();
  private disposed = false;
  private n = 0;
  error: unknown = null;
  readonly loaded: Promise<void>;

  constructor(
    private readonly scene: Scene,
    url: string = modelUrl,
  ) {
    this.loaded = this.load(url);
  }

  get ready(): boolean {
    return !!this.container;
  }

  private async load(url: string) {
    try {
      const c = await LoadAssetContainerAsync(url, this.scene, { pluginExtension: '.glb' });
      if (this.disposed) {
        c.dispose();
        return;
      }
      for (const g of c.animationGroups) g.stop();
      // PBR набора → StandardMaterial до копий: instantiateModelsToScene добавляет материалы мешей в сцену
      const conv = new Map<Material, StandardMaterial>();
      for (const m of c.meshes) {
        if (!m.material) continue;
        let s = conv.get(m.material);
        if (!s) conv.set(m.material, (s = this.convert(m.material)));
        m.material = s;
      }
      for (const m of c.materials) m.dispose();
      c.materials.length = 0;
      this.container = c;
    } catch (e) {
      this.error = e;
      console.warn('модель игрока не загрузилась', e);
    }
  }

  /** Копия модели напарнику: id — для имён, slot — место в лобби (цвет шинели). */
  make(id: string, slot: number | undefined): AvatarBody | null {
    const c = this.container;
    if (!c || this.disposed) return null;
    const name = `coop:avatar:${id}:${this.n++}`;
    const entries = c.instantiateModelsToScene((src) => `${name}:${src}`, false, { doNotInstantiate: true });
    const body = new AvatarBody(this.scene, entries, name);
    for (const m of body.meshes) {
      const s = m.material as StandardMaterial | null;
      if (s && isCoat(s.name)) m.material = this.coat(s, slot);
    }
    return body;
  }

  /** Материал набора → StandardMaterial: цвет (линейный в наборе) — в гамму, металл — с бликом, чуть свечения. */
  private convert(m: Material): StandardMaterial {
    const p = m as PbrLike;
    const col = (p.albedoColor ?? new Color3(0.5, 0.5, 0.5)).toGammaSpace();
    const s = new StandardMaterial(`coop:avatar:${m.name}`, this.scene);
    s.diffuseColor = col;
    const metal = (p.metallic ?? 0) > 0.3;
    s.specularColor = metal ? new Color3(0.35, 0.32, 0.25) : new Color3(0.04, 0.04, 0.04);
    s.specularPower = metal ? 48 : 16;
    s.emissiveColor = col.scale(EMISSIVE);
    s.backFaceCulling = m.backFaceCulling;
    this.base.add(s);
    return s;
  }

  /** Шинель места slot: первое — материал набора, остальные — его копия с множителем цвета (одна на сцену). */
  private coat(base: StandardMaterial, slot: number | undefined): StandardMaterial {
    const i = COAT_TINTS.indexOf(coatTint(slot));
    if (i === 0) return base;
    const key = `${base.name}|${i}`;
    let s = this.coats.get(key);
    if (!s) {
      s = base.clone(key);
      s.diffuseColor = base.diffuseColor.multiply(COAT_TINTS[i]);
      s.emissiveColor = s.diffuseColor.scale(EMISSIVE);
      this.coats.set(key, s);
    }
    return s;
  }

  /** Цвет сукна шинели места slot (для QA и тестов); null — модель не загружена. */
  coatColor(slot: number | undefined): Color3 | null {
    const wool = [...this.base].find((s) => /Field wool/i.test(s.name));
    return wool ? wool.diffuseColor.multiply(coatTint(slot)) : null;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.container?.dispose();
    this.container = null;
    for (const s of this.base) s.dispose();
    for (const s of this.coats.values()) s.dispose();
    this.base.clear();
    this.coats.clear();
  }
}
