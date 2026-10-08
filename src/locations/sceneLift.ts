// Сцена спец-локации «Ржавый лифт» (Babylon) — своя Scene в том же движке, что вкладка «3D»
// (src/view3d/viewer.ts рисует её вместо болванки, пока она задана). Механика — ./lift.ts (без движка): сцена
// подаёт ей время и положение игрока на площадке кабины, зовёт кабину на этаж и показывает/озвучивает события.
//
//  • Геометрия — ассет пользователя rusted_lift_v2 (оптимизированная копия assets/lift.glb, tools/optimize-lift.mjs):
//    шахта собирается из кусков «низ» (приямок, нижний этаж), «этаж» (повтор) и «верх» (последний этаж и привод) — на
//    любое число этажей −roll.down…roll.floors (0 — вход); модуль этажа (проёмы и оба коридора) — на каждом; кабина — каркас,
//    площадка и пост (у каретки каркаса нет); доска и дверь логова — из ассета.
//  • Оси: ассет загружается в левостороннюю сцену с отражением x (glTF +x → −x), поэтому в мире сцены узкий проём
//    («прямо», вход на этаже 0) — к +z, широкий («направо») — к −x. Для механики: x кабины = −x сцены, z = z.
//  • Игрок: свой контроллер — коллизии в плане (стены кабины с проёмами, когда кабина стоит у этажа, стены шахты и
//    коридоров), на площадке ноги — на её наклонённой плоскости, камера кренится вместе с площадкой (горизонт
//    показывает, какая сторона поднялась), в раскачке игрок сползает к опустившейся стороне (LIFT_SLIP).
//  • Доска: за полсекунды до точки заклинивания падает сверху (из позы ассета), застревает в зазоре — удар, пыль,
//    тряска; выпала — летит вниз по шахте. Клетка о стену — искры и пыль. Выброс с каретки — падение в шахту.
//  • Свет: фонарик игрока, лампочка кабины, натриевые трубки шахты (3 ближайших — настоящие PointLight), красный
//    отсвет логова. Туман прячет низ и верх шахты.
import { Scene } from '@babylonjs/core/scene';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { SpotLight } from '@babylonjs/core/Lights/spotLight';
import { Light } from '@babylonjs/core/Lights/light';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
// рендер частиц — отдельный компонент сцены (в ES-сборке Babylon без него частицы считаются, но не рисуются)
import '@babylonjs/core/Particles/particleSystemComponent';
import { PointerEventTypes } from '@babylonjs/core/Events/pointerEvents';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import type { Engine } from '@babylonjs/core/Engines/engine';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Material } from '@babylonjs/core/Materials/material';
import type { Texture } from '@babylonjs/core/Materials/Textures/texture';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import '@babylonjs/loaders/glTF/2.0/glTFLoader';
import '@babylonjs/loaders/glTF/2.0/Extensions/EXT_texture_webp';
import '@babylonjs/loaders/glTF/2.0/Extensions/KHR_mesh_quantization';
import '@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_emissive_strength';
import '@babylonjs/loaders/glTF/2.0/Extensions/ExtrasAsMetadata';
import liftUrl from './assets/lift.glb?url';
import type { LiftSide, LiftSpec } from '../model/types';
import {
  boardAhead, callLift, createLift, liftExits, liftFloorLabel, rollLift, stepLift, swingCoef,
  LIFT_CABLE, LIFT_FLOOR_M, LIFT_HALF_X, LIFT_HALF_Z, LIFT_SLIP, LIFT_TILT_DEG,
  type LiftAxis, type LiftEvent, type LiftExit, type LiftPhase, type LiftRoll, type LiftState,
} from './lift';
import { collide2, hash01, type Box2 } from './stairLoop';
import { LiftAudio } from './liftAudio';
import { numbersAtlas, puffTexture, scratchTexture, sparkTexture } from './liftTextures';

/** Механика (по умолчанию — ./lift; QA может подставить свою). */
export interface LiftMechanics {
  roll(spec: LiftSpec, seedKey: string): LiftRoll;
  create(roll: LiftRoll, attempt?: number, floor?: number): LiftState;
  call(s: LiftState, floor: number): LiftEvent[];
  step(spec: LiftSpec, s: LiftState, dt: number, player: { x: number; z: number }): LiftEvent[];
}

export const LIFT_MECHANICS: LiftMechanics = { roll: rollLift, create: createLift, call: callLift, step: stepLift };

/** Куда игрок вышел из лифта: на этаже 0 — назад, во вход; выше — «прямо» (узкий) или «направо» (широкий). */
export type LiftExitKind = 'entry' | LiftSide;

/** Состояние для HUD страницы (раз в ~0.12 с и на событиях). */
export interface LiftHud {
  loading: boolean;
  error: string | null;
  started: boolean;
  locked: boolean;
  sound: boolean;
  phase: LiftPhase;
  variant: 'cage' | 'carriage';
  /** этаж кабины (у которого стоит или последний пройденный) и куда едет; этажи шахты — −down…floors (0 — вход) */
  floor: number;
  target: number | null;
  floors: number;
  down: number;
  /** высота пола кабины, м */
  y: number;
  /** раскачка: крен, амплитуда (доли предела), доска держит (качает), износ троса клетки (доля обрыва); ось */
  phi: number;
  amp: number;
  stuck: boolean;
  wear: number;
  axis: LiftAxis | null;
  lair: { floor: number; side: LiftSide } | null;
  /** игрок в кабине; этаж под ногами вне кабины */
  inCage: boolean;
  level: number;
  attempt: number;
  deaths: number;
  /** thrown — выбросило с каретки; snap — оборвался трос клетки */
  dead: null | { reason: 'thrown' | 'snap' };
  /** подсказка у кнопок / двери логова */
  prompt: string | null;
  exits: LiftExit[];
}

export interface LiftSceneOptions {
  spec: LiftSpec;
  /** ключ сида экземпляра (розыгрыш, вариации вида) */
  seedKey: string;
  /** готовый розыгрыш (мир: StreamWorld.locationOf) */
  roll?: LiftRoll;
  mech?: LiftMechanics;
  sound?: boolean;
  attempt?: number;
  /** начать у этажа floor (возврат в лифт из комнаты за выходом), в коридоре стороны side; по умолчанию — вход */
  floor?: number;
  side?: LiftSide;
  onHud?(h: LiftHud): void;
  onExit?(kind: LiftExitKind, floor: number, lair: boolean): void;
}

// ───────────────────────── размеры (мир сцены, м) ─────────────────────────

const FM = LIFT_FLOOR_M;
const EYE = 1.62;
const BODY_R = 0.25;
const WALK = 1.5;
/** бег — не медленнее, чем рассчитана раскачка (LIFT_RUN = 3) */
const RUN = 3.2;
const TILT = (LIFT_TILT_DEG * Math.PI) / 180;
/** Кабина: края площадки (полуразмеры) и проёмы каркаса: спереди |x| < 0.55, справа (−x сцены) |z| < 1.27. */
const CX = LIFT_HALF_X, CZ = LIFT_HALF_Z;
const FRONT_GAP = 0.55, RIGHT_GAP = 1.27;
/** Шахта: внутренние грани стен (мир сцены). */
const SH_LEFT = 1.58, SH_RIGHT = -1.54, SH_FRONT = 1.93, SH_REAR = -1.4;
/** Узкий коридор («прямо», +z): проём |x| < 0.5, коридор |x| < 0.7 от z 2.0 до конца; широкий («направо», −x):
 *  проём |z| < 1.2, коридор |z| < 1.4 от x −1.7 до конца. Концы коридоров — двери в мир. */
const N_DOOR = 0.5, N_HALF = 0.7, N_END = 6.1;
const W_DOOR = 1.2, W_HALF = 1.4, W_END = -6.6;
/** Порог выхода: пересёк — вышел (в конце коридора, у его двери). */
const N_EXIT = 5.75, W_EXIT = -6.2;
/** Дверь логова в конце коридора: стоит здесь (плоскость створок). */
const N_LAIR = 5.95, W_LAIR = -6.5;
/** Пост с кнопками (мир сцены, локально в кабине). */
const PANEL = new Vector3(-1.0, 1.2, -1.35);
const SODIUM = new Color3(1, 0.72, 0.38);
const BULB = new Color3(1, 0.82, 0.55);
const LAIR_RED = new Color3(1, 0.12, 0.06);
const POOL = 3;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

interface Input {
  f: number;
  s: number;
  run: boolean;
}

interface Pose {
  t: [number, number, number];
  q: [number, number, number, number];
}

/** Поза из ассета (glTF, правосторонняя) → мир сцены (отражение x): позиция (−x, y, z), поворот (qx, −qy, −qz, qw). */
const mirrorPose = (p: Pose): { t: Vector3; q: Quaternion } => ({
  t: new Vector3(-p.t[0], p.t[1], p.t[2]),
  q: new Quaternion(p.q[0], -p.q[1], -p.q[2], p.q[3]),
});
/** Позы доски по умолчанию (если в GLB нет extras): из ролика ассета, относительно пола кабины. */
const BOARD_START: Pose = { t: [1.455, 7, 0.35], q: [0, 0, -0.07493, 0.99719] };
const BOARD_WEDGE: Pose = { t: [1.465, 1.6978, 0.35], q: [0.0521, 0.02643, 0.23665, 0.96984] };

export class LiftScene {
  readonly scene: Scene;
  readonly camera: UniversalCamera;
  readonly audio: LiftAudio;
  readonly spec: LiftSpec;
  readonly mech: LiftMechanics;
  roll!: LiftRoll;
  state!: LiftState;
  ready = false;
  error: string | null = null;

  // игрок (мир сцены)
  pos = { x: 0, z: 5.3 };
  vel = { x: 0, z: 0 };
  feet = 0;
  eyeY = EYE;
  bob = 0;
  stepPhase = 0;
  time = 0;
  inCage = false;

  private deaths = 0;
  private dead: LiftHud['dead'] = null;
  private fall: { t: number; from: Vector3; dir: Vector3 } | null = null;
  /** натяжение троса для звука (0…1) — последнее посчитанное */
  private strainNow = 0;
  /** клетка: трос оборвался — кабина с игроком падает (t — с обрыва, y0 — высота кабины в момент обрыва) */
  private drop: { t: number; y0: number } | null = null;
  private board: { phase: 'fall' | 'stuck' | 'drop'; t: number; side: LiftSide; segment: number; y0?: number } | null = null;
  private shake = 0;
  private flicker = 0;
  private started = false;
  private locked = false;
  private exited = false;
  private keys = new Set<string>();
  private pressed = new Set<string>();
  private hudAt = 0;
  private sideSign = { x: 1, z: 1 };
  private poseStart = mirrorPose(BOARD_START);
  private poseWedge = mirrorPose(BOARD_WEDGE);
  private pivotY = 3.62;

  // узлы
  private cage!: TransformNode;
  private cageBody!: TransformNode;
  private frameMeshes: Mesh[] = [];
  private boardSide!: TransformNode;
  private boardMesh: TransformNode | null = null;
  private cw!: TransformNode;
  private lairNode!: TransformNode;
  private rig!: TransformNode;
  private cables: Mesh[] = [];
  private flash!: SpotLight;
  private bulb!: PointLight;
  private bulbMat!: StandardMaterial;
  private hemi!: HemisphericLight;
  private pool: PointLight[] = [];
  private lairLight: PointLight | null = null;
  private dust!: ParticleSystem;
  private grit!: ParticleSystem;
  private sparks!: ParticleSystem;
  private mats = new Map<string, Material>();
  private built: AbstractMesh[] = [];

  /** QA: шаги только из qa.advance */
  manual = false;
  readonly log: { t: number; y: number; e: LiftEvent }[] = [];

  private disposed = false;
  private onKey = (e: KeyboardEvent) => this.key(e);
  private onBlur = () => this.keys.clear();
  private onLock = () => {
    this.locked = document.pointerLockElement === this.canvas;
    this.emitHud(true);
  };

  private constructor(
    readonly engine: Engine,
    readonly canvas: HTMLCanvasElement,
    private readonly opts: LiftSceneOptions,
  ) {
    this.spec = opts.spec;
    this.mech = opts.mech ?? LIFT_MECHANICS;
    const scene = (this.scene = new Scene(engine));
    scene.clearColor = new Color4(0.005, 0.005, 0.007, 1);
    scene.ambientColor = new Color3(0, 0, 0);
    scene.skipPointerMovePicking = true;
    scene.fogMode = Scene.FOGMODE_LINEAR;
    scene.fogColor = new Color3(0.005, 0.005, 0.007);
    scene.fogStart = 6;
    scene.fogEnd = 22;
    const ip = scene.imageProcessingConfiguration;
    ip.toneMappingEnabled = true;
    ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    ip.exposure = 1.3;
    ip.contrast = 1.12;
    ip.vignetteEnabled = true;
    ip.vignetteWeight = 2.4;
    ip.vignetteStretch = 0.6;
    ip.vignetteColor = new Color4(0, 0, 0, 0);
    ip.vignetteBlendMode = ImageProcessingConfiguration.VIGNETTEMODE_MULTIPLY;

    // камера — на «стойке» игрока: стойка кренится с площадкой, камера в ней — только рысканье и тангаж
    this.rig = new TransformNode('lift:rig', scene);
    this.rig.rotationQuaternion = Quaternion.Identity();
    const cam = (this.camera = new UniversalCamera('lift:eye', new Vector3(0, EYE, 0), scene));
    cam.parent = this.rig;
    cam.minZ = 0.03;
    cam.maxZ = 60;
    cam.fov = 1.2;
    cam.inertia = 0.45;
    cam.angularSensibility = 2200;
    cam.speed = 0;
    cam.inputs.removeByType('FreeCameraKeyboardMoveInput');
    scene.activeCamera = cam;

    this.hemi = new HemisphericLight('lift:amb', new Vector3(0.2, 1, -0.3), scene);
    this.hemi.diffuse = new Color3(0.5, 0.56, 0.62);
    this.hemi.groundColor = new Color3(0.1, 0.09, 0.08);
    this.hemi.specular = Color3.Black();

    const fl = (this.flash = new SpotLight('lift:flash', new Vector3(0.16, -0.22, 0.05), new Vector3(0, 0, 1), 1.05, 2, scene));
    fl.parent = cam;
    fl.falloffType = Light.FALLOFF_GLTF;
    fl.innerAngle = 0.36;
    fl.range = 16;
    fl.intensity = 22;
    fl.diffuse = new Color3(1, 0.93, 0.82);
    fl.specular = new Color3(0.4, 0.38, 0.34);
    for (let k = 0; k < POOL; k++) {
      const pl = new PointLight('lift:lamp' + k, new Vector3(0, -50, 0), scene);
      pl.falloffType = Light.FALLOFF_GLTF;
      pl.range = 7;
      pl.intensity = 0;
      pl.diffuse = SODIUM;
      pl.specular = SODIUM.scale(0.25);
      this.pool.push(pl);
    }

    // знаки осей механики: x кабины = −x сцены, z = z (ассет отражён по x при загрузке)
    this.sideSign = { x: -1, z: 1 };
    this.audio = new LiftAudio(opts.sound !== false);
    this.newAttempt(opts.attempt ?? 0, opts.floor ?? 0, opts.side);

    scene.onPointerObservable.add((pi) => {
      if (pi.type !== PointerEventTypes.POINTERDOWN) return;
      canvas.focus();
      void this.begin();
    });
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('pointerlockchange', this.onLock);
    scene.onBeforeRenderObservable.add(() => this.beforeRender());
  }

  static async create(engine: Engine, canvas: HTMLCanvasElement, opts: LiftSceneOptions): Promise<LiftScene> {
    const s = new LiftScene(engine, canvas, opts);
    s.emitHud(true);
    try {
      await s.load();
      s.ready = true;
    } catch (e) {
      console.error(e);
      s.error = 'Не удалось загрузить шахту лифта: ' + String((e as Error)?.message ?? e);
    }
    s.emitHud(true);
    return s;
  }

  attach() {
    this.camera.attachControl(true);
  }

  detach() {
    this.camera.detachControl();
    this.keys.clear();
  }

  async begin() {
    if (this.disposed) return;
    if (!this.dead && !this.engine.isPointerLock) this.engine.enterPointerlock();
    this.started = true;
    await this.audio.start();
    if (this.roll.lair) this.audio.setLair(this.lairWorld());
    this.emitHud(true);
  }

  render() {
    if (!this.disposed) this.scene.render();
  }

  // ───────────────────────── загрузка и сборка ─────────────────────────

  private async load() {
    const scene = this.scene;
    const c = await LoadAssetContainerAsync(liftUrl, scene, { pluginExtension: '.glb' });
    if (this.disposed) {
      c.dispose();
      return;
    }
    c.addAllToScene();
    for (const m of c.materials) {
      this.mats.set(m.name, m);
      (m as unknown as { maxSimultaneousLights: number }).maxSimultaneousLights = 8;
    }
    // меши по группам (узел glTF LIFT_*; многоматериальный — дети _primitiveN); мировой трансформ — в вершины
    const groups = new Map<string, Mesh[]>();
    const meta = new Map<string, Record<string, unknown>>();
    for (const n of [...c.transformNodes, ...c.meshes]) {
      const ex = (n.metadata as { gltf?: { extras?: Record<string, unknown> } } | null)?.gltf?.extras;
      if (ex && n.name.startsWith('LIFT_')) meta.set(n.name, ex);
    }
    for (const m of c.meshes) m.computeWorldMatrix(true);
    for (const m of c.meshes) {
      if (!(m instanceof Mesh) || m.getTotalVertices() === 0) continue;
      let g: AbstractMesh | TransformNode | null = m;
      while (g && !g.name.startsWith('LIFT_')) g = g.parent as AbstractMesh | TransformNode | null;
      const name = (g?.name ?? m.name).replace(/_primitive\d+$/, '');
      const W = m.computeWorldMatrix(true).clone();
      m.setParent(null);
      m.position.setAll(0);
      m.rotationQuaternion = null;
      m.rotation.setAll(0);
      m.scaling.setAll(1);
      m.bakeTransformIntoVertices(W);
      m.isPickable = false;
      let list = groups.get(name);
      if (!list) groups.set(name, (list = []));
      list.push(m);
    }
    for (const n of c.transformNodes) n.dispose();
    for (const m of c.meshes) if (!m.isDisposed() && m.getTotalVertices() === 0) m.dispose();
    const ex = meta.get('LIFT_BOARD') ?? {};
    if (ex.boardStart) this.poseStart = mirrorPose(ex.boardStart as Pose);
    if (ex.boardWedge) this.poseWedge = mirrorPose(ex.boardWedge as Pose);
    const deckEx = meta.get('LIFT_CAGE_DECK') ?? {};
    if (typeof deckEx.pivotY === 'number') this.pivotY = deckEx.pivotY;

    const F = this.roll.floors, D = this.roll.down;
    const mat = (y: number) => Matrix.Translation(0, y, 0);
    const thin = (list: Mesh[] | undefined, ys: number[]) => {
      for (const m of list ?? []) {
        if (!ys.length) {
          m.setEnabled(false);
          continue;
        }
        const buf = new Float32Array(16 * ys.length);
        ys.forEach((y, i) => mat(y).copyToArray(buf, 16 * i));
        m.thinInstanceSetBuffer('matrix', buf, 16, true);
        m.alwaysSelectAsActiveMesh = true;
        m.freezeWorldMatrix();
        this.built.push(m);
      }
    };
    // шахта: низ (нижний этаж −D и приямок), этажи −D+1…F−1, верх (этаж F и привод); модуль этажа — на каждом
    thin(groups.get('LIFT_SHAFT_BOTTOM'), [-D * FM]);
    thin(groups.get('LIFT_SHAFT_MID'), Array.from({ length: Math.max(0, F + D - 1) }, (_, k) => (k + 1 - D) * FM));
    thin(groups.get('LIFT_SHAFT_TOP'), [F * FM]);
    thin(groups.get('LIFT_LEVEL'), Array.from({ length: F + D + 1 }, (_, k) => (k - D) * FM));

    // кабина: поворот — вокруг центра пола (площадка кренится, как доска на опоре), подвес — над ней
    this.cage = new TransformNode('lift:cage', scene);
    this.cage.rotationQuaternion = Quaternion.Identity();
    this.cageBody = new TransformNode('lift:cageBody', scene);
    this.cageBody.parent = this.cage;
    const own = (list: Mesh[] | undefined, parent: TransformNode) => {
      for (const m of list ?? []) {
        m.parent = parent;
        m.alwaysSelectAsActiveMesh = true;
        this.built.push(m);
      }
    };
    this.frameMeshes = groups.get('LIFT_CAGE_FRAME') ?? [];
    own(this.frameMeshes, this.cageBody);
    own(groups.get('LIFT_CAGE_DECK'), this.cageBody);
    own(groups.get('LIFT_PANEL'), this.cageBody);
    for (const m of this.frameMeshes) m.setEnabled(this.roll.variant === 'cage');
    // лампочка кабины (в ассете её нет): под крышей, тёплая, мерцает
    this.bulbMat = new StandardMaterial('lift:bulbMat', scene);
    this.bulbMat.disableLighting = true;
    this.bulbMat.emissiveColor = BULB;
    const bulbMesh = MeshBuilder.CreateSphere('lift:bulb', { diameter: 0.09, segments: 8 }, scene);
    bulbMesh.material = this.bulbMat;
    bulbMesh.parent = this.cageBody;
    bulbMesh.position.set(0.15, 2.62, 0.4);
    bulbMesh.isPickable = false;
    this.bulb = new PointLight('lift:bulbLight', new Vector3(0.15, 2.5, 0.4), scene);
    this.bulb.parent = this.cageBody;
    this.bulb.falloffType = Light.FALLOFF_GLTF;
    this.bulb.range = 6;
    this.bulb.diffuse = BULB;
    this.bulb.specular = BULB.scale(0.3);

    // доска: сторона (правый зазор — как в ассете; передний — поворот на 90° и сдвиг к стене)
    this.boardSide = new TransformNode('lift:boardSide', scene);
    this.boardSide.parent = this.cageBody;
    const bl = groups.get('LIFT_BOARD') ?? [];
    if (bl.length) {
      const bn = new TransformNode('lift:board', scene);
      bn.parent = this.boardSide;
      bn.rotationQuaternion = Quaternion.Identity();
      for (const m of bl) {
        // вершины доски — в её системе (как узел ассета), отражены по x вместе со сценой
        m.parent = bn;
        m.alwaysSelectAsActiveMesh = true;
      }
      bn.setEnabled(false);
      this.boardMesh = bn;
    }

    // противовес: идёт навстречу кабине
    this.cw = new TransformNode('lift:cw', scene);
    own(groups.get('LIFT_COUNTERWEIGHT'), this.cw);

    // тросы: от проушины кабины и от противовеса — к барабану привода
    const steel = this.mats.get('PBR | oily machine steel') ?? null;
    for (const [i, x] of [[0, -0.05], [1, 0.05], [2, 0.12], [3, -0.12]] as const) {
      const cyl = MeshBuilder.CreateCylinder('lift:cable' + i, { height: 1, diameter: i < 2 ? 0.024 : 0.02, tessellation: 6 }, scene);
      cyl.material = steel;
      cyl.isPickable = false;
      cyl.alwaysSelectAsActiveMesh = true;
      cyl.metadata = { x };
      this.cables.push(cyl);
    }

    // дверь логова и концы коридоров
    this.lairNode = new TransformNode('lift:lair', scene);
    own(groups.get('LIFT_LAIR_DOOR'), this.lairNode);
    this.buildEnds();
    this.buildBoards0();
    this.buildNumbers();
    this.layoutLair();
    this.sync();
    await new Promise<void>((res) => scene.executeWhenReady(() => res()));
    // частицы — после: их эффекты собираются на первом кадре, и executeWhenReady ждал бы их вечно
    this.buildParticles();
  }

  /** Концы коридоров: стена с дверным проёмом в темноту — дверь в мир (кроме конца с логовом: там дверь логова). */
  private buildEnds() {
    const scene = this.scene;
    const concrete = this.mats.get('PBR | damp pitted concrete') ?? null;
    const black = new StandardMaterial('lift:void', scene);
    black.disableLighting = true;
    black.emissiveColor = Color3.Black();
    black.diffuseColor = Color3.Black();
    const F = this.roll.floors, D = this.roll.down;
    const box = (name: string, w: number, h: number, d: number, x: number, y: number, z: number, m: Material | null) => {
      const b = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
      b.position.set(x, y + h / 2, z);
      b.material = m;
      b.isPickable = false;
      b.freezeWorldMatrix();
      this.built.push(b);
      return b;
    };
    for (let k = -D; k <= F; k++) {
      const y = k * FM;
      const lairHere = this.roll.lair?.floor === k ? this.roll.lair.side : null;
      // узкий: проём 1.0 × 2.1 по центру
      if (lairHere !== 'straight') {
        box(`lift:endN${k}a`, 0.4, 3, 0.2, -0.7, y, N_END + 0.1, concrete);
        box(`lift:endN${k}b`, 0.4, 3, 0.2, 0.7, y, N_END + 0.1, concrete);
        box(`lift:endN${k}c`, 1.8, 0.9, 0.2, 0, y + 2.1, N_END + 0.1, concrete);
        box(`lift:voidN${k}`, 1.2, 2.2, 0.05, 0, y, N_END + 0.6, black);
      }
      // широкий: проём 1.3 × 2.2 (на входном этаже 0 широкий заколочен — конец не нужен)
      if (k !== 0 && lairHere !== 'right') {
        box(`lift:endW${k}a`, 0.2, 3, 1.15, W_END - 0.1, y, 1.225, concrete);
        box(`lift:endW${k}b`, 0.2, 3, 1.15, W_END - 0.1, y, -1.225, concrete);
        box(`lift:endW${k}c`, 0.2, 0.8, 1.4, W_END - 0.1, y + 2.2, 0, concrete);
        box(`lift:voidW${k}`, 0.05, 2.3, 1.5, W_END - 0.6, y, 0, black);
      }
    }
  }

  /** Этаж 0: широкий проём заколочен досками (вход — только узкий). */
  private buildBoards0() {
    const wood = this.mats.get('PBR | splintered old timber') ?? null;
    for (let i = 0; i < 5; i++) {
      const b = MeshBuilder.CreateBox('lift:plank0_' + i, { width: 0.05, height: 0.2, depth: 2.7 }, this.scene);
      b.position.set(SH_RIGHT - 0.32, 0.35 + i * 0.42, 0);
      b.rotation.x = (i % 2 ? 1 : -1) * (0.08 + 0.05 * hash01(i, 3));
      b.material = wood;
      b.isPickable = false;
      b.freezeWorldMatrix();
      this.built.push(b);
    }
  }

  /** Номера этажей на табличках задней стены (по трафарету). */
  private buildNumbers() {
    const F = this.roll.floors, D = this.roll.down;
    // ячейка атласа i — этаж i − D (снизу вверх): −2, −1, 1, 2, 3…
    const labels = Array.from({ length: F + D + 1 }, (_, i) => liftFloorLabel(i - D));
    const { tex, cells } = numbersAtlas(this.scene, labels);
    const m = new StandardMaterial('lift:num', this.scene);
    m.diffuseTexture = tex;
    m.useAlphaFromDiffuseTexture = true;
    m.specularColor = Color3.Black();
    for (let k = -D; k <= F; k++) {
      const p = MeshBuilder.CreatePlane('lift:numPlane' + k, { width: 0.26, height: 0.26 }, this.scene);
      // своя ячейка атласа: u → (k + D + u) / cells (одна текстура на все таблички)
      const uv = p.getVerticesData('uv')!;
      for (let i = 0; i < uv.length; i += 2) uv[i] = (k + D + uv[i]) / cells;
      p.setVerticesData('uv', uv);
      p.material = m;
      // табличка ассета: glTF x −1.44…−1.27, y +1.66…+1.88, z −1.9 → мир сцены x ≈ +1.355
      p.position.set(1.34, k * FM + 1.77, -1.885);
      p.rotation.y = Math.PI;
      p.isPickable = false;
      p.freezeWorldMatrix();
      this.built.push(p);
    }
  }

  private buildParticles() {
    const scene = this.scene;
    const puff = puffTexture(scene);
    const mk = (name: string, cap: number, tex: Texture) => {
      const ps = new ParticleSystem(name, cap, scene);
      ps.particleTexture = tex;
      ps.emitter = Vector3.Zero();
      ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
      ps.manualEmitCount = 0;
      ps.minEmitPower = 0.2;
      ps.maxEmitPower = 1.2;
      ps.updateSpeed = 1 / 60;
      return ps;
    };
    const dust = (this.dust = mk('lift:dust', 400, puff));
    dust.color1 = new Color4(0.55, 0.5, 0.44, 0.55);
    dust.color2 = new Color4(0.4, 0.36, 0.3, 0.4);
    dust.colorDead = new Color4(0.3, 0.28, 0.25, 0);
    dust.minSize = 0.25;
    dust.maxSize = 0.9;
    dust.minLifeTime = 1.2;
    dust.maxLifeTime = 3.2;
    dust.gravity = new Vector3(0, -0.35, 0);
    dust.minEmitBox = new Vector3(-0.3, -0.4, -0.3);
    dust.maxEmitBox = new Vector3(0.3, 0.4, 0.3);
    dust.direction1 = new Vector3(-1, -0.3, -1);
    dust.direction2 = new Vector3(1, 0.6, 1);
    dust.minAngularSpeed = -0.6;
    dust.maxAngularSpeed = 0.6;
    dust.emitRate = 0;
    dust.start();
    const grit = (this.grit = mk('lift:grit', 300, puff));
    grit.color1 = new Color4(0.45, 0.42, 0.38, 0.35);
    grit.color2 = new Color4(0.35, 0.32, 0.28, 0.3);
    grit.colorDead = new Color4(0.2, 0.2, 0.2, 0);
    grit.minSize = 0.04;
    grit.maxSize = 0.12;
    grit.minLifeTime = 1.5;
    grit.maxLifeTime = 2.5;
    grit.gravity = new Vector3(0, -3, 0);
    grit.minEmitBox = new Vector3(-1.2, 0, -1.6);
    grit.maxEmitBox = new Vector3(1.2, 0, 1.6);
    grit.direction1 = new Vector3(-0.1, -1, -0.1);
    grit.direction2 = new Vector3(0.1, -0.5, 0.1);
    grit.emitRate = 0;
    grit.start();
    const sp = (this.sparks = mk('lift:sparks', 120, sparkTexture(scene)));
    sp.blendMode = ParticleSystem.BLENDMODE_ADD;
    sp.color1 = new Color4(1, 0.8, 0.45, 1);
    sp.color2 = new Color4(1, 0.55, 0.2, 1);
    sp.colorDead = new Color4(0.6, 0.2, 0.05, 0);
    sp.minSize = 0.02;
    sp.maxSize = 0.06;
    sp.minLifeTime = 0.2;
    sp.maxLifeTime = 0.6;
    sp.minEmitPower = 1.5;
    sp.maxEmitPower = 4;
    sp.gravity = new Vector3(0, -9.8, 0);
    sp.direction1 = new Vector3(-1, 0.2, -1);
    sp.direction2 = new Vector3(1, 1, 1);
    sp.emitRate = 0;
    sp.start();
  }

  /** Логово: дверь из ассета в конце нужного коридора, красный отсвет, царапины на стенах коридора. */
  private layoutLair() {
    const L = this.roll.lair;
    this.lairNode.setEnabled(!!L);
    if (!L) return;
    const y = L.floor * FM;
    if (L.side === 'right') {
      // ассет: дверь в конце широкого коридора, проход — к шахте (+x сцены)
      this.lairNode.position.set(W_LAIR, y, 0);
      this.lairNode.rotation.set(0, 0, 0);
      this.lairNode.scaling.set(1, 1, 1);
    } else {
      // узкий коридор: та же дверь, повёрнутая проходом к шахте (−z) и сжатая по ширине вдвое
      this.lairNode.position.set(0, y, N_LAIR);
      this.lairNode.rotation.set(0, Math.PI / 2, 0);
      this.lairNode.scaling.set(1, 1, 0.5);
    }
    const p = this.lairWorld();
    const red = (this.lairLight = new PointLight('lift:lairLight', new Vector3(p.x, p.y + 1.2, p.z), this.scene));
    red.falloffType = Light.FALLOFF_GLTF;
    red.range = 7;
    red.intensity = 6;
    red.diffuse = LAIR_RED;
    red.specular = LAIR_RED.scale(0.4);
    // царапины: две полосы декалей вдоль стен коридора логова
    const sm = new StandardMaterial('lift:scratchMat', this.scene);
    sm.diffuseTexture = scratchTexture(this.scene);
    sm.diffuseTexture.hasAlpha = true;
    sm.useAlphaFromDiffuseTexture = true;
    sm.specularColor = Color3.Black();
    const decal = (x: number, z: number, ry: number, w: number) => {
      const pl = MeshBuilder.CreatePlane('lift:scratch', { width: w, height: 1.8 }, this.scene);
      pl.material = sm;
      pl.position.set(x, y + 1.2, z);
      pl.rotation.y = ry;
      pl.isPickable = false;
      pl.freezeWorldMatrix();
      this.built.push(pl);
    };
    if (L.side === 'right') {
      decal(-4.4, W_HALF - 0.01, 0, 3);
      decal(-4.8, -W_HALF + 0.01, Math.PI, 3);
    } else {
      decal(-N_HALF + 0.01, 4.3, -Math.PI / 2, 2.6);
      decal(N_HALF - 0.01, 4.6, Math.PI / 2, 2.6);
    }
  }

  /** Точка логова (у двери, мир сцены). */
  private lairWorld(): { x: number; y: number; z: number } {
    const L = this.roll.lair!;
    return L.side === 'right' ? { x: W_LAIR + 0.6, y: L.floor * FM, z: 0 } : { x: 0, y: L.floor * FM, z: N_LAIR - 0.6 };
  }

  // ───────────────────────── попытка ─────────────────────────

  private newAttempt(attempt: number, floor = 0, side?: LiftSide) {
    this.roll = this.opts.roll ?? this.mech.roll(this.spec, this.opts.seedKey);
    this.state = this.mech.create(this.roll, attempt, floor);
    const f = this.state.floor;
    // игрок — в коридоре у двери в мир, лицом к шахте
    if (f > 0 && side === 'right') {
      this.pos = { x: W_EXIT + 0.55, z: 0 };
      this.camera.rotation.set(0.08, Math.PI / 2, 0);
    } else {
      this.pos = { x: 0, z: N_EXIT - 0.45 };
      this.camera.rotation.set(0.08, Math.PI, 0);
    }
    this.camera.cameraRotation.set(0, 0);
    this.vel = { x: 0, z: 0 };
    this.feet = f * FM;
    this.eyeY = EYE;
    this.inCage = false;
    this.board = null;
    this.fall = null;
    this.drop = null;
    this.dead = null;
    this.shake = 0;
    this.flicker = 0;
    this.exited = false;
    this.camera.fov = 1.2;
    this.scene.imageProcessingConfiguration.exposure = 1.3;
    this.boardMesh?.setEnabled(false);
  }

  retry() {
    this.newAttempt(this.state.attempt + 1, 0);
    this.audio.reset();
    this.emitHud(true);
    if (!this.engine.isPointerLock) this.engine.enterPointerlock();
  }

  // ───────────────────────── кадр ─────────────────────────

  private last = 0;

  private beforeRender() {
    const now = performance.now();
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 1 / 60;
    this.last = now;
    if (!this.manual && this.ready) this.simulate(dt);
    this.sync();
  }

  /** Шаг: ввод → игрок → механика → доска → звук. */
  simulate(dt: number, input?: Input) {
    if (this.disposed || this.exited || !this.ready) return;
    this.time += dt;
    this.shake = Math.max(0, this.shake - dt * 1.6);
    this.flicker = Math.max(0, this.flicker - dt);
    const g = this.fall ?? this.drop;
    if (g) {
      g.t += dt;
      if (g.t > 2.6 && !this.dead) {
        this.dead = { reason: this.drop ? 'snap' : 'thrown' };
        this.deaths++;
        if (document.pointerLockElement === this.canvas) document.exitPointerLock();
        this.emitHud(true);
      }
      return;
    }
    if (!this.started && !this.manual) return;
    this.buttons();
    this.move(dt, input ?? this.readKeys());
    const s = this.state;
    const lp = this.inCage ? { x: this.sideSign.x * this.pos.x, z: this.sideSign.z * this.pos.z } : { x: 0, z: 0 };
    const ev = this.mech.step(this.spec, s, dt, lp);
    for (const e of ev) this.onEvent(e);
    this.boardStep(dt);
    this.checkExit();
    const sw = s.swing;
    const co = swingCoef(this.spec);
    const eye = this.camera.globalPosition;
    const fwd = this.camera.getDirection(Vector3.Forward());
    const up = this.camera.getDirection(Vector3.Up());
    const cageY = s.y;
    // натяжение троса: доска держит кабину, лебёдка тянет; клетка — растёт с износом до обрыва
    this.strainNow = s.phase === 'jammed' && sw?.stuck ? (this.roll.variant === 'cage' ? 0.3 + 0.7 * Math.min(1, s.wear / LIFT_CABLE) : 0.35) : 0;
    this.audio.update(dt, { x: eye.x, y: eye.y, z: eye.z }, { x: fwd.x, y: fwd.y, z: fwd.z }, { x: up.x, y: up.y, z: up.z }, {
      moving: s.phase === 'moving' ? 1 : 0,
      sway: sw?.amp ?? 0,
      swayVel: sw ? sw.vel / co.w : 0,
      hook: { x: 0, y: cageY + this.pivotY, z: 0 },
      top: { x: 0, y: this.roll.floors * FM + 4.6, z: 0 },
      board: this.board?.phase === 'stuck' && sw ? { at: this.boardWorld(), scrape: clamp(Math.abs(sw.vel) / co.w, 0, 1) * (sw.stuck ? 1 : 0.3) } : null,
      strain: this.strainNow,
    });
    if (performance.now() - this.hudAt > 120) this.emitHud();
  }

  private readKeys(): Input {
    const k = this.keys;
    const f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const s = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    return { f, s, run: k.has('ShiftLeft') || k.has('ShiftRight') };
  }

  private key(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    if (e.type === 'keydown') {
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    } else this.keys.delete(e.code);
  }

  /** Кнопки поста: E — вверх на этаж, Q — вниз (в кабине); E у двери логова — войти. */
  private buttons() {
    const p = this.pressed;
    if (!p.size) return;
    const up = p.has('KeyE'), down = p.has('KeyQ');
    p.clear();
    if (this.nearLairDoor()) {
      if (up) this.exit(this.roll.lair!.side, this.roll.lair!.floor, true);
      return;
    }
    if (!this.inCage || (!up && !down)) return;
    this.press(up ? 'up' : 'down');
  }

  /** Нажать кнопку поста (QA тоже): этаж — следующий от того, где кабина стоит или куда едет. */
  press(dir: 'up' | 'down') {
    const s = this.state;
    const at = s.phase === 'moving' && s.target !== null ? s.target : s.floor;
    const to = clamp(at + (dir === 'up' ? 1 : -1), -this.roll.down, this.roll.floors);
    const ev = to === at ? [] : this.mech.call(s, to);
    const panel = this.panelWorld();
    this.audio.lever(panel, ev.length === 0);
    for (const e of ev) this.onEvent(e);
  }

  private panelWorld() {
    const p = Vector3.TransformCoordinates(PANEL, this.cageBody.computeWorldMatrix(true));
    return { x: p.x, y: p.y, z: p.z };
  }

  private nearLairDoor(): boolean {
    const L = this.roll.lair;
    if (!L || this.inCage || this.level() !== L.floor) return false;
    return L.side === 'right' ? this.pos.x < W_LAIR + 1.3 && Math.abs(this.pos.z) < W_HALF : this.pos.z > N_LAIR - 1.3 && Math.abs(this.pos.x) < N_HALF;
  }

  /** Этаж под ногами вне кабины. */
  private level(): number {
    return Math.round(this.feet / FM);
  }

  /** Стены для текущего положения: кабина (проёмы — когда стоит у этажа и выход есть), шахта, коридоры этажа. */
  private boxes(): Box2[] {
    const s = this.state;
    const out: Box2[] = [];
    const B = (x0: number, z0: number, x1: number, z1: number) => out.push({ x0, z0, x1, z1 });
    const exits = liftExits(s);
    const frontOpen = exits.some((e) => e.side === 'straight' || e.side === 'entry');
    const rightOpen = exits.some((e) => e.side === 'right');
    const T = 0.12;
    // кабина: левая (+x) и задняя — глухие; передняя (+z) и правая (−x) — с проёмами
    B(CX - 0.05, -CZ - T, CX + T, CZ + T);
    B(-CX - T, -CZ - T, CX + T, -CZ + 0.08);
    if (frontOpen) {
      B(-CX - T, CZ - 0.08, -FRONT_GAP, CZ + T);
      B(FRONT_GAP, CZ - 0.08, CX + T, CZ + T);
    } else B(-CX - T, CZ - 0.08, CX + T, CZ + T);
    if (rightOpen) {
      B(-CX - T, -CZ - T, -CX + 0.05, -RIGHT_GAP);
      B(-CX - T, RIGHT_GAP, -CX + 0.05, CZ + T);
    } else B(-CX - T, -CZ - T, -CX + 0.05, CZ + T);
    if (!this.inCage || frontOpen || rightOpen) {
      // шахта и коридоры этажа (игрок у этажа)
      B(SH_LEFT, -2.4, SH_LEFT + 0.3, 2.4);
      B(-2, SH_REAR - 0.3, 2, SH_REAR);
      B(-2, SH_FRONT, -N_DOOR, SH_FRONT + 0.32);
      B(N_DOOR, SH_FRONT, 2, SH_FRONT + 0.32);
      B(SH_RIGHT - 0.32, -2.4, SH_RIGHT, -W_DOOR);
      B(SH_RIGHT - 0.32, W_DOOR, SH_RIGHT, 2.4);
      // зазор кабина — стена у проёмов: «порожки»
      B(-N_DOOR - 0.2, CZ, -N_DOOR, SH_FRONT);
      B(N_DOOR, CZ, N_DOOR + 0.2, SH_FRONT);
      B(SH_RIGHT, -W_DOOR - 0.2, -CX, -W_DOOR);
      B(SH_RIGHT, W_DOOR, -CX, W_DOOR + 0.2);
      // коридоры
      B(-N_HALF - 0.3, 2.0, -N_HALF, N_END + 1);
      B(N_HALF, 2.0, N_HALF + 0.3, N_END + 1);
      B(W_END - 1, W_HALF, -1.7, W_HALF + 0.3);
      B(W_END - 1, -W_HALF - 0.3, -1.7, -W_HALF);
      const lv = this.level();
      // этаж 0: широкий заколочен
      if (lv === 0) B(SH_RIGHT - 0.4, -W_DOOR, SH_RIGHT - 0.2, W_DOOR);
      // дверь логова — глухая (войти — E)
      const L = this.roll.lair;
      if (L && L.floor === lv) {
        if (L.side === 'right') B(W_LAIR - 0.3, -W_HALF, W_LAIR + 0.05, W_HALF);
        else B(-N_HALF, N_LAIR - 0.05, N_HALF, N_LAIR + 0.3);
      }
    }
    return out;
  }

  private move(dt: number, inp: Input) {
    const yaw = this.camera.rotation.y;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    let dx = fx * inp.f + fz * inp.s;
    let dz = fz * inp.f - fx * inp.s;
    const len = Math.hypot(dx, dz);
    if (len > 1) {
      dx /= len;
      dz /= len;
    }
    const sp = inp.run ? RUN : WALK;
    const k = 1 - Math.exp(-dt * 9);
    this.vel.x = lerp(this.vel.x, dx * sp, k);
    this.vel.z = lerp(this.vel.z, dz * sp, k);
    // в раскачке игрока тянет к опустившейся стороне площадки
    let sx = 0, sz = 0;
    const sw = this.state.swing;
    if (this.inCage && sw) {
      const v = LIFT_SLIP * sw.phi;
      if (sw.axis === 'x') sx = this.sideSign.x * v;
      else sz = this.sideSign.z * v;
    }
    const nx = this.pos.x + (this.vel.x + sx) * dt;
    const nz = this.pos.z + (this.vel.z + sz) * dt;
    const [cx, cz] = collide2(nx, nz, BODY_R, this.boxes());
    if (dt > 0) {
      this.vel.x = (cx - this.pos.x) / dt - sx;
      this.vel.z = (cz - this.pos.z) / dt - sz;
    }
    this.pos.x = cx;
    this.pos.z = cz;
    this.inCage = Math.abs(cx) <= CX + 0.02 && Math.abs(cz) <= CZ + 0.02;
    // ноги: на площадке — пол кабины (крен учтёт стойка камеры), вне её — пол этажа
    const s = this.state;
    if (this.inCage) this.feet = s.y + 0.05;
    else this.feet = this.level() * FM;
    const speed = Math.hypot(this.vel.x, this.vel.z);
    const bobAmp = clamp(speed / WALK, 0, 1.6) * 0.022;
    this.stepPhase += speed * dt * (Math.PI / 0.72);
    const nb = Math.sin(this.stepPhase) * bobAmp;
    if (speed > 0.3 && Math.sin(this.stepPhase) < -0.95 && this.bob >= -0.95 * bobAmp) {
      this.audio.step({ x: this.pos.x, y: this.feet, z: this.pos.z }, inp.run ? 1.4 : 1, this.inCage ? (this.roll.variant === 'carriage' ? 'wood' : 'metal') : 'concrete');
    }
    this.bob = nb;
  }

  private checkExit() {
    if (this.exited || this.inCage) return;
    const lv = this.level();
    const L = this.roll.lair;
    if (this.pos.z > N_EXIT && !(L && L.floor === lv && L.side === 'straight')) {
      this.exit(lv === 0 ? 'entry' : 'straight', lv, false);
    } else if (this.pos.x < W_EXIT && lv > 0 && !(L && L.floor === lv && L.side === 'right')) {
      this.exit('right', lv, false);
    }
  }

  private exit(kind: LiftExitKind, floor: number, lair: boolean) {
    this.exited = true;
    this.keys.clear();
    this.opts.onExit?.(kind, floor, lair);
  }

  // ───────────────────────── события механики ─────────────────────────

  private onEvent(e: LiftEvent) {
    this.log.push({ t: this.state.t, y: this.state.y, e });
    if (this.log.length > 400) this.log.splice(0, 100);
    const at = { x: 0, y: this.state.y + 1.2, z: 0 };
    switch (e.type) {
      case 'depart':
        this.audio.depart(at);
        break;
      case 'pass':
        this.audio.pass(at);
        break;
      case 'arrive':
        this.audio.arrive(at);
        this.shake = Math.max(this.shake, 0.25);
        break;
      case 'board': {
        // доска могла не успеть показаться (большой шаг, QA) — сразу в зазор
        if (!this.board || this.board.segment !== e.segment) this.board = { phase: 'fall', t: 0.5, side: e.side, segment: e.segment };
        this.board.phase = 'stuck';
        this.board.t = 0;
        this.placeBoard(1);
        const p = this.boardWorld();
        this.audio.board(p);
        this.burst(this.dust, p, 160);
        this.shake = 1;
        this.flicker = 0.8;
        break;
      }
      case 'bang': {
        const sw = this.state.swing;
        const p = this.edgeWorld(sw?.axis ?? 'x', e.dir);
        this.audio.bang(p, e.strength);
        this.burst(this.sparks, p, 30 + Math.round(40 * Math.min(1, e.strength)));
        this.burst(this.dust, p, 40);
        this.shake = Math.max(this.shake, 0.4 + 0.5 * Math.min(1, e.strength));
        this.flicker = Math.max(this.flicker, 0.3);
        break;
      }
      case 'freed':
        if (this.board) {
          this.board.phase = 'drop';
          this.board.t = 0;
          this.board.y0 = this.state.y;
          this.audio.freed(this.boardWorld(), this.state.y + 4);
        }
        break;
      case 'steady':
        break;
      case 'thrown':
        this.startFall(e.axis, e.dir);
        break;
      case 'kick': {
        // клетка: игрок подбежал к доске и спихнул её — удар по дереву, треск, пыль; дальше freed (доска летит вниз)
        const p = this.boardWorld();
        this.audio.kick(p);
        this.burst(this.dust, p, 90);
        this.shake = Math.max(this.shake, 0.5);
        break;
      }
      case 'fray': {
        // трос трещит: лопнула прядь у проушины — звон, искры, рывок
        const p = this.hookWorld();
        this.audio.bang(p, 0.25 + 0.35 * e.wear);
        this.burst(this.sparks, p, 25 + Math.round(30 * e.wear));
        this.shake = Math.max(this.shake, 0.5 + 0.4 * e.wear);
        this.flicker = Math.max(this.flicker, 0.5);
        break;
      }
      case 'snap': {
        const p = this.hookWorld();
        this.audio.bang(p, 1);
        this.burst(this.sparks, p, 90);
        this.burst(this.dust, p, 60);
        this.shake = 1;
        this.flicker = 1;
        this.drop = { t: 0, y0: this.state.y };
        this.audio.thrown(this.state.y + this.roll.down * FM + 4);
        break;
      }
    }
    this.emitHud(true);
  }

  /** Доска: за полсекунды до точки заклинивания — падает сверху; застряла — в зазоре; выпала — вниз по шахте. */
  private boardStep(dt: number) {
    const s = this.state;
    if (!this.board && s.phase === 'moving' && s.target !== null && s.target * FM > s.y) {
      const seg = Math.floor(s.y / FM + 1e-9);
      // та же доска, что возьмёт механика (по шансу; первый подъём — всегда)
      const b = boardAhead(this.spec, s, seg);
      if (b) {
        const by = (seg + b.frac) * FM;
        const speed = this.spec.speed > 0 ? this.spec.speed : 0.6;
        if (by > s.y && (by - s.y) / speed < 0.5) this.board = { phase: 'fall', t: 0.5 - (by - s.y) / speed, side: b.side, segment: seg };
      }
    }
    const b = this.board;
    if (!b) return;
    b.t += dt;
    if (b.phase === 'fall') {
      // кабину развернули до удара — доска пролетает мимо вниз
      if (s.phase !== 'moving' && s.phase !== 'jammed') b.phase = 'drop';
      else if (s.target !== null && s.target * FM < s.y) {
        b.phase = 'drop';
        b.t = 0;
        b.y0 = s.y;
      } else this.placeBoard(clamp(b.t / 0.5, 0, 1));
    }
    if (b.phase === 'drop') {
      const fallen = 0.5 * 9.81 * b.t * b.t;
      this.placeBoard(1, -fallen - (s.y - (b.y0 ?? s.y)));
      if (b.t > 3) {
        this.board = null;
        this.boardMesh?.setEnabled(false);
      }
    }
  }

  /** Поза доски: k — доля падения сверху к зазору (1 — застряла), dy — смещение вниз (выпала). */
  private placeBoard(k: number, dy = 0) {
    const bn = this.boardMesh;
    const b = this.board;
    if (!bn || !b) return;
    bn.setEnabled(true);
    // сторона: правый зазор — как в ассете; передний — поворот на 90° вокруг вертикали и сдвиг к передней стене
    if (b.side === 'right') {
      this.boardSide.rotation.set(0, 0, 0);
      this.boardSide.position.set(0, 0, 0);
    } else {
      this.boardSide.rotation.set(0, Math.PI / 2, 0);
      this.boardSide.position.set(0, 0, 0.27);
    }
    const e = k * k;
    const S = this.poseStart, W = this.poseWedge;
    bn.position.set(lerp(S.t.x, W.t.x, k), lerp(S.t.y, W.t.y, e) + dy, lerp(S.t.z, W.t.z, k));
    Quaternion.SlerpToRef(S.q, W.q, clamp(k, 0, 1), bn.rotationQuaternion!);
    if (dy < 0) bn.rotationQuaternion!.multiplyInPlace(Quaternion.RotationAxis(Vector3.Right(), -dy * 0.15));
  }

  private boardWorld(): { x: number; y: number; z: number } {
    const bn = this.boardMesh;
    if (!bn) return { x: -1.4, y: this.state.y + 1.7, z: 0.35 };
    // поза только что выставлена — мировые матрицы цепочки ещё старые (пересчёт — при рендере)
    for (const n of [this.cage, this.cageBody, this.boardSide, bn]) n.computeWorldMatrix(true);
    const p = bn.getAbsolutePosition();
    return { x: p.x, y: p.y, z: p.z };
  }

  /** Край площадки по оси качания (dir — какой, в осях механики), мир сцены. */
  private edgeWorld(axis: LiftAxis, dir: 1 | -1): { x: number; y: number; z: number } {
    const y = this.state.y + 1.3;
    return axis === 'x' ? { x: this.sideSign.x * dir * (CX + 0.4), y, z: 0 } : { x: 0, y, z: this.sideSign.z * dir * (CZ + 0.35) };
  }

  private burst(ps: ParticleSystem, p: { x: number; y: number; z: number }, n: number) {
    (ps.emitter as Vector3).set(p.x, p.y, p.z);
    ps.manualEmitCount = (ps.manualEmitCount > 0 ? ps.manualEmitCount : 0) + n;
  }

  /** Проушина троса над кабиной, мир сцены. */
  private hookWorld(): { x: number; y: number; z: number } {
    return { x: this.cage?.position.x ?? 0, y: this.state.y + this.pivotY, z: this.cage?.position.z ?? 0 };
  }

  /** Сколько клетка пролетела после обрыва троса, м: свободное падение до дна шахты (нижний этаж − 0.5 м). */
  private dropY(): number {
    const d = this.drop;
    if (!d) return 0;
    return Math.min(d.y0 + this.roll.down * FM + 0.5, 0.5 * 9.81 * d.t * d.t);
  }

  private startFall(axis: LiftAxis, dir: 1 | -1) {
    const e = this.edgeWorld(axis, dir);
    const from = this.camera.globalPosition.clone();
    const d = new Vector3(e.x - this.pos.x, 0, e.z - this.pos.z);
    if (d.lengthSquared() < 1e-6) d.set(axis === 'x' ? -dir : 0, 0, axis === 'z' ? dir : 0);
    d.normalize();
    this.fall = { t: 0, from, dir: d };
    this.audio.thrown(this.state.y + 6);
  }

  // ───────────────────────── вид ─────────────────────────

  /** Крен площадки (кватернион) по состоянию: φ·TILT вокруг горизонтальной оси, край +оси механики — вниз. */
  private tiltQuat(out: Quaternion): Quaternion {
    const sw = this.state?.swing;
    if (!sw) return out.copyFromFloats(0, 0, 0, 1);
    const a = sw.phi * TILT;
    // ось x механики (−x сцены) — поворот вокруг z сцены; ось z — вокруг x сцены. Знак — чтобы край +оси опускался.
    if (sw.axis === 'x') Quaternion.RotationAxisToRef(new Vector3(0, 0, 1), a * this.sideSign.x, out);
    else Quaternion.RotationAxisToRef(new Vector3(1, 0, 0), a * this.sideSign.z, out);
    return out;
  }

  private tq = new Quaternion();

  /** Кабина, игрок, камера, свет — из состояния. */
  sync() {
    if (!this.ready || !this.cage) return;
    const s = this.state;
    const t = this.time;
    const tilt = this.tiltQuat(this.tq);
    // проверка знака крена (один раз на кадр, дёшево): край +x механики (−x сцены) должен уйти вниз при φ > 0
    const sw = s.swing;
    if (sw && Math.abs(sw.phi) > 1e-3) {
      const edge = sw.axis === 'x' ? new Vector3(this.sideSign.x, 0, 0) : new Vector3(0, 0, this.sideSign.z);
      const y = edge.rotateByQuaternionToRef(tilt, new Vector3()).y;
      if (Math.sign(y) === Math.sign(sw.phi)) tilt.copyFromFloats(-tilt.x, -tilt.y, -tilt.z, tilt.w);
    }
    const sway = sw ? sw.phi * 0.1 : 0;
    const shake = this.shake * this.shake * 0.04;
    const jx = shake * (hash01(Math.floor(t * 40), 1) - 0.5), jz = shake * (hash01(Math.floor(t * 40), 2) - 0.5);
    // трос оборвался — кабина падает, тросы остаются висеть, где была проушина
    const dy = this.dropY();
    this.cage.position.set((sw?.axis === 'x' ? this.sideSign.x * sway : 0) + jx, s.y - dy + jz * 0.5, (sw?.axis === 'z' ? this.sideSign.z * sway : 0) + jz);
    this.cage.rotationQuaternion!.copyFrom(tilt);
    // противовес — навстречу кабине; тросы — от проушины и противовеса к барабану
    const top = this.roll.floors * FM + 4.6;
    // в покое (ассет) грузы внизу шахты, кабина — на этаже 0 нижнего куска; кабина наверху — грузы внизу
    this.cw.position.y = (this.roll.floors - this.roll.down) * FM - s.y;
    const hook = Vector3.TransformCoordinates(new Vector3(0, this.pivotY, 0), this.cage.computeWorldMatrix(true));
    hook.y += dy;
    this.cables.forEach((c, i) => {
      const x = (c.metadata as { x: number }).x;
      const y0 = i < 2 ? hook.y : this.cw.position.y + 1.9;
      const h = Math.max(0.1, top - y0);
      c.position.set(i < 2 ? hook.x + x : x, y0 + h / 2, i < 2 ? hook.z : -1.6);
      c.scaling.y = h;
    });
    // игрок: стойка в точке ног; на площадке — с креном, вне — ровно
    const g = this.fall;
    if (g) this.syncFall(g);
    else {
      const p = new Vector3(this.pos.x, this.feet, this.pos.z);
      if (this.inCage) {
        // точка на наклонённой площадке: (x, пол, z) кабины → мир
        const local = new Vector3(this.pos.x - this.cage.position.x, 0.05, this.pos.z - this.cage.position.z);
        const w = local.rotateByQuaternionToRef(tilt, new Vector3());
        p.set(this.cage.position.x + w.x, s.y - dy + w.y, this.cage.position.z + w.z);
        Quaternion.SlerpToRef(this.rig.rotationQuaternion!, tilt, 0.5, this.rig.rotationQuaternion!);
      } else Quaternion.SlerpToRef(this.rig.rotationQuaternion!, Quaternion.Identity(), 0.2, this.rig.rotationQuaternion!);
      this.rig.position.copyFrom(p);
      this.camera.position.set(jx * 0.5, this.eyeY + this.bob, jz * 0.5);
      this.camera.rotation.x = clamp(this.camera.rotation.x, -1.45, 1.45);
      // падение с оборванным тросом: удар о дно — темнота
      if (this.drop) this.scene.imageProcessingConfiguration.exposure = 1.3 * Math.max(0, 1 - Math.max(0, this.drop.t - 0.9) / 1.4);
    }
    // свет: лампочка кабины (мерцает, гаснет в рывках), трубки шахты у ближайших этажей, логово, фонарик
    const d = clamp(this.spec.darkness, 0, 1);
    const fl = this.flicker > 0 ? (hash01(Math.floor(t * 22), 7) > 0.5 ? 1 : 0.08) : hash01(Math.floor(t * 9), 11) > 0.97 ? 0.4 : 1;
    const bulbI = (0.9 + 2.2 * (1 - d)) * fl;
    this.bulb.intensity = bulbI;
    this.bulbMat.emissiveColor.copyFrom(BULB).scaleInPlace(0.25 + 0.75 * fl);
    this.hemi.intensity = 0.02 + 0.1 * (1 - d) * (1 - d);
    const eyeY = this.camera.globalPosition.y;
    const near = Math.round(eyeY / FM);
    this.pool.forEach((pl, i) => {
      const k = near + (i === 0 ? 0 : i === 1 ? 1 : -1);
      if (k < -this.roll.down || k > this.roll.floors) {
        pl.intensity = 0;
        return;
      }
      // трубка ассета: glTF x −1.29, y +2.5, z −1.72 → мир сцены (+1.29, …); чуть впереди трубки
      pl.position.set(1.1, k * FM + 2.45, -1.55);
      const dead = hash01(k, 3, 7) < 0.25 * d;
      const blink = hash01(Math.floor(t * 7) + k * 13, 5) > 0.93 ? 0.25 : 1;
      pl.intensity = dead ? 0 : (0.6 + 2.4 * (1 - d)) * blink * (this.flicker > 0 ? 0.3 : 1);
    });
    if (this.lairLight) this.lairLight.intensity = 4 + 2.5 * Math.sin(t * 1.7) * Math.sin(t * 0.63);
    // в раскачке сверху сыплется сор (шахта над кабиной)
    if (sw && sw.amp > 0.25 && this.grit) {
      (this.grit.emitter as Vector3).set(this.cage.position.x, s.y + 3.4, this.cage.position.z);
      if (hash01(Math.floor(t * 30), 17) < sw.amp * 0.6) this.grit.manualEmitCount = Math.max(0, this.grit.manualEmitCount) + 2;
    }
    this.flash.intensity = 22 * (this.flicker > 0 && hash01(Math.floor(t * 30), 13) > 0.7 ? 0.5 : 1);
  }

  /** Выброс: сползание к краю, затем падение в шахту, темнота. */
  private syncFall(g: NonNullable<LiftScene['fall']>) {
    const c = this.camera;
    const t = g.t;
    const slide = Math.min(1, t / 0.5);
    const drop = t > 0.4 ? 0.5 * 9.81 * (t - 0.4) * (t - 0.4) : 0;
    const p = g.from.add(g.dir.scale(0.9 * slide)).add(new Vector3(0, -drop, 0));
    this.rig.rotationQuaternion!.copyFromFloats(0, 0, 0, 1);
    this.rig.position.set(p.x, p.y - this.eyeY, p.z);
    c.position.set(0, this.eyeY, 0);
    c.rotation.x = lerp(c.rotation.x, 1.2, Math.min(1, t * 1.5));
    this.scene.imageProcessingConfiguration.exposure = 1.3 * Math.max(0, 1 - Math.max(0, t - 0.9) / 1.4);
  }

  private emitHud(force = false) {
    if (!force && performance.now() - this.hudAt < 120) return;
    this.hudAt = performance.now();
    this.opts.onHud?.(this.hud());
  }

  hud(): LiftHud {
    const s = this.state;
    const sw = s.swing;
    let prompt: string | null = null;
    if (this.ready && !this.dead && !this.fall && !this.drop) {
      if (this.nearLairDoor()) prompt = 'E — открыть дверь';
      else if (this.inCage) {
        if (s.phase === 'jammed') prompt = 'кнопки не отвечают';
        else {
          const at = s.phase === 'moving' && s.target !== null ? s.target : s.floor;
          const up = at < this.roll.floors ? `E — вверх (${liftFloorLabel(at + 1)})` : null;
          const down = at > -this.roll.down ? `Q — вниз (${liftFloorLabel(at - 1)})` : null;
          prompt = [up, down].filter(Boolean).join(' · ') || null;
        }
      }
    }
    return {
      loading: !this.ready && !this.error,
      error: this.error,
      started: this.started,
      locked: this.locked,
      sound: this.audio.enabled,
      phase: s.phase,
      variant: this.roll.variant,
      floor: s.floor,
      target: s.target,
      floors: this.roll.floors,
      down: this.roll.down,
      y: s.y,
      phi: sw?.phi ?? 0,
      amp: sw?.amp ?? 0,
      stuck: !!sw?.stuck,
      wear: this.roll.variant === 'cage' ? Math.min(1, s.wear / LIFT_CABLE) : 0,
      axis: sw?.axis ?? null,
      lair: this.roll.lair,
      inCage: this.inCage,
      level: this.level(),
      attempt: s.attempt,
      deaths: this.deaths,
      dead: this.dead,
      prompt,
      exits: liftExits(s),
    };
  }

  setSound(on: boolean) {
    this.audio.setEnabled(on);
    this.emitHud(true);
  }

  // ───────────────────────── QA ─────────────────────────

  /** QA: без захвата мыши — шаги только из advance. */
  qaStart() {
    this.manual = true;
    this.started = true;
  }

  /** QA: прогнать сек секунд с вводом (шаг 1/60). */
  advance(sec: number, input: Input = { f: 0, s: 0, run: false }) {
    const n = Math.max(1, Math.round(sec * 60));
    for (let i = 0; i < n; i++) {
      this.simulate(1 / 60, input);
      this.sync();
    }
  }

  /** QA: поставить игрока (мир сцены) и повернуть взгляд. */
  place(x: number, z: number, yaw?: number, pitch?: number) {
    this.pos = { x, z };
    this.vel = { x: 0, z: 0 };
    this.inCage = Math.abs(x) <= CX && Math.abs(z) <= CZ;
    if (yaw !== undefined) this.camera.rotation.y = yaw;
    if (pitch !== undefined) this.camera.rotation.x = pitch;
    this.sync();
  }

  /** QA: звук — натяжение троса и счётчики событий. */
  qaAudio() {
    return { strain: this.strainNow, counters: { ...this.audio.counters } };
  }

  qaState() {
    const s = this.state;
    return {
      phase: s.phase, y: +s.y.toFixed(3), floor: s.floor, target: s.target, variant: this.roll.variant, floors: this.roll.floors,
      lair: this.roll.lair, swing: s.swing ? { axis: s.swing.axis, phi: +s.swing.phi.toFixed(3), amp: +s.swing.amp.toFixed(3), stuck: s.swing.stuck } : null, wear: +s.wear.toFixed(2),
      pos: { x: +this.pos.x.toFixed(2), z: +this.pos.z.toFixed(2) }, feet: +this.feet.toFixed(2), inCage: this.inCage, board: this.board?.phase ?? null,
      dead: this.dead, exited: this.exited, attempt: s.attempt, events: this.log.slice(-12).map((l) => l.e.type),
      meshes: this.scene.meshes.length, active: this.scene.getActiveMeshes().length,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('pointerlockchange', this.onLock);
    this.audio.dispose();
    this.scene.dispose();
  }
}
