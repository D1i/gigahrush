// Сцена спец-локации «Бесконечная лестница» (Babylon) — своя Scene в том же движке, что вкладка «3D»
// (src/view3d/viewer.ts рисует её вместо болванки, пока она задана). Механика — ./stairwell.ts
// (без движка): сцена подаёт ей непрерывную высоту игрока и время и показывает/озвучивает события.
//
//  • Модуль подъезда — GLB пользователя (оптимизированная копия, tools/optimize-stairwell.mjs): меши
//    сливаются по материалам и ставятся тонкими экземплярами в 5 модулей окна (текущий ±2) по Y.
//  • Петля: глаза игрока держатся в среднем модуле; выйдя за него, игрок сдвигается на ∓3 м, а
//    развёрнутая высота для механики продолжается. Модули одинаковы, всё переменное (лампы, двери,
//    низ) — по развёрнутому этажу, туман непрозрачен раньше края окна → сдвиг невидим (QA пиксельно).
//  • Игрок: свой контроллер — коллизии в плане (./stairLoop.ts: стены, пролёт, дверь, тамбур) и высота
//    по лучам вниз в меши ступеней и площадок (подъём до 0.45 м — «stepOffset», ступень 0.15 м).
//  • Тьма: фонарик (SpotLight у камеры, мягкий край, дрожание) + лампы модулей: тусклые/мигающие/мёртвые
//    по развёрнутому этажу и darkness; 4 ближайшие горящие — настоящие PointLight (пул), остальные —
//    только светящийся плафон.
//  • Захват — ролик камеры (рывок вниз, волоком в пролёт, падение в темноту).
//  • Размыкание: в темноте первой вспышки лестница становится КОНЕЧНОЙ — этажи от низа (этаж под игроком,
//    плита пола, открытая дверь) до верха (+2 этажа, верхнее завершение TopCap из ассета), все модулями, без
//    сдвигов окна и без тумана; свет включается по всей шахте (плафоны + рассеянный + 4 ближайшие лампы).
import { Scene } from '@babylonjs/core/scene';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { SpotLight } from '@babylonjs/core/Lights/spotLight';
import { Light } from '@babylonjs/core/Lights/light';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
import { PointerEventTypes } from '@babylonjs/core/Events/pointerEvents';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import type { Engine } from '@babylonjs/core/Engines/engine';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Material } from '@babylonjs/core/Materials/material';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import '@babylonjs/loaders/glTF/2.0/glTFLoader';
import '@babylonjs/loaders/glTF/2.0/Extensions/EXT_texture_webp';
import '@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_emissive_strength';
// в GLB светильники — обязательное расширение; свои источники ставим сами, загруженные удаляются
import '@babylonjs/loaders/glTF/2.0/Extensions/KHR_lights_punctual';
import moduleUrl from './assets/stairwell_module.glb?url';
// верхнее завершение — только геометрия, материалы берутся у модуля по именам (tools/optimize-stairwell.mjs)
import capUrl from './assets/stairwell_topcap.glb?url';
import type { StairwellSpec } from '../model/types';
import {
  createStairwell, rollStairwell, stepStairwell,
  type StairPhase, type StairwellEvent, type StairwellRoll, type StairwellState,
} from './stairwell';
import {
  BODY_R, BOTTOM_BOX, CAP_BOX, DOOR_BOX, DOOR_H, DOOR_X, DOWN_PATH, EXIT_Z, EYE_M, FLOOR_M, IN_X, IN_Z, MID,
  SLOTS, STATIC_BOXES, UP_PATH, VEST_Z1, GroundField, collide2, groundY, hash01, lampKind, lampLevel,
  landingFloor, moduleFloor, unwrapY, wrapShift, type Box2, type LampKind,
} from './stairLoop';
import { StairAudio } from './stairwellAudio';

/** Механика (по умолчанию — ./stairwell; QA может подставить свою). */
export interface StairMechanics {
  roll(spec: StairwellSpec, seedKey: string): StairwellRoll;
  create(spec: StairwellSpec, roll: StairwellRoll, attempt?: number): StairwellState;
  step(spec: StairwellSpec, s: StairwellState, dt: number, y: number): StairwellEvent[];
}

export const STAIR_MECHANICS: StairMechanics = { roll: rollStairwell, create: createStairwell, step: stepStairwell };

/** Состояние для HUD страницы (раз в ~0.12 с и на событиях). */
export interface StairHud {
  loading: boolean;
  error: string | null;
  /** был клик: мышь захвачена хотя бы раз, звук запущен */
  started: boolean;
  locked: boolean;
  sound: boolean;
  phase: StairPhase;
  survived: number;
  needed: number;
  meter: number;
  /** этаж петли под ногами (развёрнутый; 0 — входной) */
  floor: number;
  y: number;
  attempt: number;
  deaths: number;
  /** экран смерти: показан после ролика захвата */
  dead: null | { reason: 'descended' | 'slow' };
  /** на сколько этажей вниз выводит разомкнутая лестница (розыгрыш) */
  floorsDown: number;
  /** низ разомкнутой лестницы — развёрнутый этаж (null — петля) */
  bottom: number | null;
  /** верхний этаж модулей разомкнутой лестницы (над ним — TopCap); null — петля */
  top: number | null;
  /** входная дверь открыта (можно уйти назад) */
  backOpen: boolean;
}

export type StairExit = 'back' | 'descend';

export interface StairwellSceneOptions {
  spec: StairwellSpec;
  /** ключ сида экземпляра (розыгрыш) */
  seedKey: string;
  /** готовый розыгрыш (мир: StreamWorld.locationOf) — тогда seedKey только для вариаций вида */
  roll?: StairwellRoll;
  mech?: StairMechanics;
  sound?: boolean;
  /** номер первой попытки (повторный вход — следующая) */
  attempt?: number;
  onHud?(h: StairHud): void;
  onExit?(kind: StairExit, floorsDown: number): void;
}

// ───────────────────────── константы вида ─────────────────────────

const WARM = new Color3(1, 0.8, 0.55);
/** Сила лампы (PointLight, glTF-спад) и её дальность, м. */
const LAMP_I = 7;
const LAMP_RANGE = 4.5;
const POOL = 4;
/** Туман: непрозрачен к FOG_END (< 6 м — расстояния от глаз до края окна): сдвиг петли невидим. */
const FOG_END = 5.6;
/** Лампы дальше этого от глаз не горят светом (только плафон) — свет из-за края окна не нужен. */
const POOL_R = 5.6;
/** Фонарик: сила (glTF-спад 1/d²). */
const FLASH_I = 26;
const FOG_START = 1.7;
const STEP_UP = 0.45;
const STEP_DOWN = 0.55;
const WALK = 1.45;
const RUN = 2.5;
const DOOR_OPEN = 1.4; // рад (~80°)
const HINGE_X = DOOR_X;
const HINGE_Z = 2.7;
/** Разомкнутая лестница: модулей над этажом игрока (над верхним — завершение TopCap). */
const TOP_ABOVE = 2;
/** Разомкнутая лестница, свет «шахты»: рассеянный (не убывает с расстоянием — дальние этажи не темнеют). */
const OPEN_AMB = 0.5;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => t * t * (3 - 2 * t);

interface Lamp {
  /** развёрнутый этаж, на котором стоит (меняется при раскладке) */
  floor: number;
  j: number;
  mesh: Mesh;
  mat: StandardMaterial;
  /** точка света (локально в модуле) */
  at: Vector3;
}

interface Input {
  f: number;
  s: number;
  run: boolean;
}

export class StairwellScene {
  readonly scene: Scene;
  readonly camera: UniversalCamera;
  readonly audio: StairAudio;
  readonly spec: StairwellSpec;
  readonly mech: StairMechanics;
  roll!: StairwellRoll;
  state!: StairwellState;
  ready = false;
  error: string | null = null;

  // окно и игрок (локально в окне)
  base = 0;
  feet = 0;
  vy = 0;
  pos = { x: 0, z: 2.15 };
  vel = { x: 0, z: 0 };
  eyeY = EYE_M;
  bob = 0;
  stepPhase = 0;
  /** время сцены, с (лампы, фонарик) */
  time = 0;
  /** низ разомкнутой лестницы (развёрнутый этаж) */
  bottom: number | null = null;
  /** разомкнутая лестница конечна: этажи модулей bottom…top (развёрнутые), над top — TopCap; null — петля */
  finite: { bottom: number; top: number } | null = null;
  /** угол двери по развёрнутому этажу (0 — закрыта) */
  private doors = new Map<number, number>();
  private backOpen = false;
  private deaths = 0;
  private dead: StairHud['dead'] = null;
  private grab: { t: number; from: Vector3; yaw: number; pitch: number; to: Vector3 } | null = null;
  private opening: number | null = null;
  /** звук: провал света (с) */
  private dip = 0;
  private started = false;
  private locked = false;
  private exited = false;
  private keys = new Set<string>();
  private hudAt = 0;
  private seedN = 0;

  // меши
  private bodies: Mesh[] = [];
  /** опора: карта высот ступеней и площадок модуля (из меша бетона) */
  field = new GroundField();
  private leaf: Mesh | null = null;
  private lamps: Lamp[] = [];
  /** образцы плафонов (j = 0 у двери, 1 у промежуточной площадки) и точка света в модуле */
  private lampSrc: { mesh: Mesh; at: Vector3 }[] = [];
  private slab: Mesh | null = null;
  /** верхнее завершение (TopCap): меши по материалам и его карта высот опоры */
  private cap: Mesh[] = [];
  capField = new GroundField();
  private pool: PointLight[] = [];
  private flash!: SpotLight;
  private hemi!: HemisphericLight;
  /** буферы матриц тонких экземпляров (Babylon хранит ссылку — меняем на месте; размер — по числу этажей) */
  private bufs = new Map<Mesh, Float32Array>();

  /** QA: шаги механики/физики только из qa.advance (рендер — без них) */
  manual = false;
  /** QA: отключить сворачивание окна (для пиксельного сравнения до/после) */
  noWrap = false;
  /** QA: число сдвигов окна */
  wraps = 0;
  /** события механики (журнал для QA/отладки) */
  readonly log: { t: number; y: number; e: StairwellEvent }[] = [];

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
    private readonly opts: StairwellSceneOptions,
  ) {
    this.spec = opts.spec;
    this.mech = opts.mech ?? STAIR_MECHANICS;
    const scene = (this.scene = new Scene(engine));
    scene.clearColor = new Color4(0.004, 0.004, 0.006, 1);
    scene.ambientColor = new Color3(0, 0, 0);
    scene.skipPointerMovePicking = true;
    scene.fogMode = Scene.FOGMODE_LINEAR;
    scene.fogColor = new Color3(0.004, 0.004, 0.006);
    scene.fogStart = FOG_START;
    scene.fogEnd = FOG_END;
    const ip = scene.imageProcessingConfiguration;
    ip.toneMappingEnabled = true;
    ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    ip.exposure = 1.35;
    ip.contrast = 1.1;
    ip.vignetteEnabled = true;
    ip.vignetteWeight = 2.2;
    ip.vignetteStretch = 0.6;
    ip.vignetteColor = new Color4(0, 0, 0, 0);
    ip.vignetteBlendMode = ImageProcessingConfiguration.VIGNETTEMODE_MULTIPLY;

    const cam = (this.camera = new UniversalCamera('stair:eye', new Vector3(0, EYE_M, 2.15), scene));
    cam.minZ = 0.03;
    cam.maxZ = 40;
    cam.fov = 1.2;
    cam.inertia = 0.45;
    cam.angularSensibility = 2200;
    cam.speed = 0;
    cam.inputs.removeByType('FreeCameraKeyboardMoveInput');
    cam.rotation.set(0.12, Math.PI, 0);
    scene.activeCamera = cam;

    this.hemi = new HemisphericLight('stair:amb', new Vector3(0.2, 1, -0.3), scene);
    this.hemi.diffuse = new Color3(0.55, 0.62, 0.66);
    this.hemi.groundColor = new Color3(0.12, 0.12, 0.13);
    this.hemi.specular = Color3.Black();
    this.hemi.intensity = 0.02;

    // фонарик: у правой руки, чуть ниже глаз; мягкий край (glTF-спад: внутренний и внешний конус)
    const fl = (this.flash = new SpotLight('stair:flash', new Vector3(0.16, -0.22, 0.05), new Vector3(0, 0, 1), 1.05, 2, scene));
    fl.parent = cam;
    fl.falloffType = Light.FALLOFF_GLTF;
    fl.innerAngle = 0.36;
    fl.range = 14;
    fl.intensity = FLASH_I;
    fl.diffuse = new Color3(1, 0.93, 0.82);
    fl.specular = new Color3(0.4, 0.38, 0.34);
    for (let k = 0; k < POOL; k++) {
      const pl = new PointLight('stair:lamp' + k, new Vector3(0, -50, 0), scene);
      pl.falloffType = Light.FALLOFF_GLTF;
      pl.range = LAMP_RANGE;
      pl.intensity = 0;
      pl.diffuse = WARM;
      pl.specular = WARM.scale(0.3);
      this.pool.push(pl);
    }

    this.audio = new StairAudio(opts.sound !== false);
    this.seedN = Math.floor(hash01(...[...opts.seedKey].map((c) => c.charCodeAt(0))) * 2 ** 31);
    this.newAttempt(opts.attempt ?? 0);

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

  /** Создать сцену и загрузить модуль (GLB). Ошибка загрузки — в hud.error, сцена остаётся (тьма). */
  static async create(engine: Engine, canvas: HTMLCanvasElement, opts: StairwellSceneOptions): Promise<StairwellScene> {
    const s = new StairwellScene(engine, canvas, opts);
    s.emitHud(true);
    try {
      await s.load();
      s.ready = true;
    } catch (e) {
      console.error(e);
      s.error = 'Не удалось загрузить модуль подъезда: ' + String((e as Error)?.message ?? e);
    }
    s.emitHud(true);
    return s;
  }

  /** Активировать управление (камера слушает мышь). */
  attach() {
    this.camera.attachControl(true);
  }

  detach() {
    this.camera.detachControl();
    this.keys.clear();
  }

  /** Клик: захват мыши и запуск звука (жест пользователя). */
  async begin() {
    if (this.disposed) return;
    if (!this.dead && !this.engine.isPointerLock) this.engine.enterPointerlock();
    // вошли с уже захваченной мышью (шагнули из «Прогулки») — смены захвата (onLock) не будет
    this.locked = document.pointerLockElement === this.canvas;
    this.started = true;
    await this.audio.start();
    this.emitHud(true);
  }

  render() {
    if (!this.disposed) this.scene.render();
  }

  // ───────────────────────── загрузка и сборка ─────────────────────────

  private async load() {
    const scene = this.scene;
    const c = await LoadAssetContainerAsync(moduleUrl, scene, { pluginExtension: '.glb' });
    if (this.disposed) {
      c.dispose();
      return;
    }
    c.addAllToScene();
    for (const l of c.lights) l.dispose();
    const mats = new Map<string, Material>();
    for (const m of c.materials) {
      mats.set(m.name, m);
      (m as unknown as { maxSimultaneousLights: number }).maxSimultaneousLights = 2 + POOL;
    }
    const meshes = c.meshes.filter((m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0);
    for (const m of c.meshes) m.computeWorldMatrix(true);
    const base = (m: AbstractMesh) => {
      let n: AbstractMesh | null = m;
      // примитивы многоматериального меша glTF — дети узла с его именем
      while (n && /_primitive\d+$/.test(n.name)) n = n.parent as AbstractMesh | null;
      return (n?.name ?? m.name).replace(/_primitive\d+$/, '');
    };
    const groups = new Map<string, Mesh[]>();
    const leafParts: Mesh[] = [];
    const lampMeshes: Mesh[] = [];
    let wallMat: Material | null = null;
    for (const m of meshes) {
      const name = base(m);
      const mat = m.material;
      if (!mat) continue;
      if (name === 'Wall_Front') {
        wallMat = mat;
        continue; // своя передняя стена — с проёмом
      }
      if (name === 'DoorFrame') continue; // свой наличник-рамка
      if (name === 'ClosedDoor' || name === 'DoorInset' || name === 'DoorHandle') {
        leafParts.push(m);
        continue;
      }
      if (mat.name === '08_Warm_Lamp_Diffuser') {
        lampMeshes.push(m);
        continue;
      }
      // сигнатура вершин: сливаются только одинаковые наборы атрибутов
      const key = mat.name + '|' + m.getVerticesDataKinds().sort().join(',');
      let g = groups.get(key);
      if (!g) groups.set(key, (g = []));
      g.push(m);
    }
    const concrete = mats.get('02_Worn_Concrete') ?? null;
    const plaster = mats.get('05_White_Plaster') ?? null;
    const hardware = mats.get('07_Dark_Hardware') ?? null;
    wallMat ??= mats.get('01_Peeling_Turquoise') ?? null;

    for (const [key, list] of groups) {
      const merged = Mesh.MergeMeshes(list, true, true);
      if (!merged) continue;
      merged.name = 'stair:' + key.split('|')[0];
      this.bodies.push(merged);
      if (merged.material === concrete) this.addGround(merged);
    }
    // полотно двери: ручка, накладка, полотно — один меш, вершины от оси петель
    if (leafParts.length) {
      const leaf = Mesh.MergeMeshes(leafParts, true, true, undefined, false, true);
      if (leaf) {
        leaf.name = 'stair:doorLeaf';
        leaf.bakeTransformIntoVertices(Matrix.Translation(-HINGE_X, 0, -HINGE_Z));
        this.leaf = leaf;
      }
    }
    // своя геометрия: передняя стена с проёмом, рамка, тамбур
    if (wallMat) this.bodies.push(this.frontWall(wallMat));
    if (hardware) this.bodies.push(this.frame(hardware));
    const vest = this.vestibule(concrete, plaster, wallMat);
    for (const m of vest) this.bodies.push(m);
    // плафоны ламп: по два в модуле, свои материалы (яркость по этажу)
    lampMeshes.forEach((src) => {
      const W = src.computeWorldMatrix(true).clone();
      const c0 = src.getBoundingInfo().boundingBox.centerWorld.clone();
      src.parent = null;
      src.position.setAll(0);
      src.rotationQuaternion = null;
      src.rotation.setAll(0);
      src.scaling.setAll(1);
      src.bakeTransformIntoVertices(W);
      src.setEnabled(false);
      const j = c0.z > 0 ? 0 : 1;
      this.lampSrc[j] = { mesh: src, at: new Vector3(c0.x, c0.y - 0.06, c0.z + (j === 0 ? -0.22 : 0.22)) };
    });
    // пустые узлы glTF (корень, пустышки) больше не нужны
    for (const n of c.transformNodes) n.dispose();
    for (const m of c.meshes) if (!m.isDisposed() && m.getTotalVertices() === 0) m.dispose();
    // низ разомкнутой лестницы: плита пола на месте марша, уходившего вниз
    if (concrete) {
      const slab = this.box('stair:bottomSlab', -IN_X, -0.2, -IN_Z, IN_X, 0, IN_Z - 1.6, concrete);
      slab.setEnabled(false);
      slab.isPickable = false;
      this.slab = slab;
      await concrete.forceCompilationAsync(slab);
    }
    for (const m of [...this.bodies, ...(this.leaf ? [this.leaf] : [])]) {
      m.alwaysSelectAsActiveMesh = true;
      m.isPickable = false;
      if (m !== this.leaf) m.freezeWorldMatrix();
    }
    await this.loadCap(mats);
    this.layout();
    // шейдеры — заранее, чтобы первый кадр не был пустым
    await new Promise<void>((res) => this.scene.executeWhenReady(() => res()));
  }

  /** Верхнее завершение (TopCap): геометрия из своего GLB, материалы — модуля по именам; меши по материалам,
   *  скрыты до размыкания. Пол верхней площадки — в свою карту высот. */
  private async loadCap(mats: Map<string, Material>) {
    const c = await LoadAssetContainerAsync(capUrl, this.scene, { pluginExtension: '.glb' });
    if (this.disposed) {
      c.dispose();
      return;
    }
    c.addAllToScene();
    for (const m of c.meshes) m.computeWorldMatrix(true);
    const groups = new Map<string, Mesh[]>();
    for (const m of c.meshes) {
      if (!(m instanceof Mesh) || m.getTotalVertices() === 0 || !m.material) continue;
      const key = m.material.name + '|' + m.getVerticesDataKinds().sort().join(',');
      let g = groups.get(key);
      if (!g) groups.set(key, (g = []));
      g.push(m);
    }
    for (const [key, list] of groups) {
      const name = key.split('|')[0];
      const merged = Mesh.MergeMeshes(list, true, true);
      if (!merged) continue;
      merged.name = 'stair:cap:' + name;
      merged.material = mats.get(name) ?? merged.material;
      merged.isPickable = false;
      merged.alwaysSelectAsActiveMesh = true;
      merged.setEnabled(false);
      this.cap.push(merged);
      if (name === '02_Worn_Concrete') this.addGround(merged, this.capField);
    }
    // шейдеры завершения — заранее (иначе первый кадр после размыкания ждёт их сборки)
    await Promise.all(this.cap.map((m) => m.material?.forceCompilationAsync(m)));
    // свои материалы GLB (без текстур) не нужны
    const keep = new Set(mats.values());
    for (const m of c.materials) if (!keep.has(m)) m.dispose();
    for (const n of c.transformNodes) n.dispose();
    for (const m of c.meshes) if (!m.isDisposed() && m.getTotalVertices() === 0) m.dispose();
  }

  /** Верхние грани ступеней и площадок меша (координаты модуля) — в карту высот опоры. */
  private addGround(m: Mesh, field = this.field) {
    const pos = m.getVerticesData('position');
    const nrm = m.getVerticesData('normal');
    const idx = m.getIndices();
    if (!pos || !nrm || !idx) return;
    for (let t = 0; t + 2 < idx.length; t += 3) {
      const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
      if ((nrm[a + 1] + nrm[b + 1] + nrm[c + 1]) / 3 < 0.7) continue;
      field.addTriangle(pos[a], pos[a + 1], pos[a + 2], pos[b], pos[b + 1], pos[b + 2], pos[c], pos[c + 1], pos[c + 2]);
    }
  }

  /** Прямоугольный параллелепипед (вершины в своих координатах), UV — по метрам. */
  private box(name: string, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: Material): Mesh {
    const q = new QuadBuilder();
    const ux = (p: Vector3) => [p.x / 2, p.z / 2] as [number, number];
    q.quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], [0, 1, 0], ux); // верх
    q.quad([x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0], [0, -1, 0], ux);
    const m = q.mesh(name, this.scene);
    m.material = mat;
    return m;
  }

  /** Передняя стена: внутренняя грань с проёмом двери и откосы (UV — как у стен модуля: u = −x/2, v = (3 − y)/3). */
  private frontWall(mat: Material): Mesh {
    const q = new QuadBuilder();
    const z = IN_Z;
    const uvIn = (p: Vector3) => [-p.x / 2, (3 - p.y) / 3] as [number, number];
    const n = [0, 0, -1] as const;
    q.quad([-IN_X, 0, z], [-DOOR_X, 0, z], [-DOOR_X, 3, z], [-IN_X, 3, z], n, uvIn);
    q.quad([DOOR_X, 0, z], [IN_X, 0, z], [IN_X, 3, z], [DOOR_X, 3, z], n, uvIn);
    q.quad([-DOOR_X, DOOR_H, z], [DOOR_X, DOOR_H, z], [DOOR_X, 3, z], [-DOOR_X, 3, z], n, uvIn);
    const m = q.mesh('stair:frontWall', this.scene);
    m.material = mat;
    return m;
  }

  /** Рамка (наличник) вокруг проёма — вместо сплошной плиты DoorFrame модуля. */
  private frame(mat: Material): Mesh {
    const q = new QuadBuilder();
    const z0 = IN_Z - 0.052, z1 = IN_Z;
    const W = 0.06, top = DOOR_H + 0.085;
    const uv = (p: Vector3) => [p.x + p.z, p.y] as [number, number];
    const slab = (x0: number, y0: number, x1: number, y1: number) => {
      q.quad([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [0, 0, -1], uv);
      q.quad([x0, y0, z1], [x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [-1, 0, 0], uv);
      q.quad([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], [1, 0, 0], uv);
      q.quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], [0, 1, 0], uv);
      q.quad([x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0], [0, -1, 0], uv);
    };
    slab(-DOOR_X - W, 0, -DOOR_X, top);
    slab(DOOR_X, 0, DOOR_X + W, top);
    slab(-DOOR_X, DOOR_H, DOOR_X, top);
    const m = q.mesh('stair:doorFrame', this.scene);
    m.material = mat;
    return m;
  }

  /** Тамбур за дверью: пол, потолок, стенки (они же откосы проёма), торец со слабым светом «оттуда». */
  private vestibule(floorMat: Material | null, ceilMat: Material | null, wallMat: Material | null): Mesh[] {
    const out: Mesh[] = [];
    const z0 = IN_Z, z1 = VEST_Z1, h = DOOR_H, x = DOOR_X;
    if (floorMat) {
      const q = new QuadBuilder();
      q.quad([-x, 0, z0], [x, 0, z0], [x, 0, z1], [-x, 0, z1], [0, 1, 0], (p) => [p.x / 2, p.z / 2]);
      const m = q.mesh('stair:vestFloor', this.scene);
      m.material = floorMat;
      out.push(m);
    }
    if (ceilMat) {
      const q = new QuadBuilder();
      q.quad([-x, h, z1], [x, h, z1], [x, h, z0], [-x, h, z0], [0, -1, 0], (p) => [p.x / 2, p.z / 2]);
      const m = q.mesh('stair:vestCeil', this.scene);
      m.material = ceilMat;
      out.push(m);
    }
    if (wallMat) {
      const q = new QuadBuilder();
      const uv = (p: Vector3) => [p.z / 2, (3 - p.y) / 3] as [number, number];
      q.quad([-x, 0, z1], [-x, 0, z0], [-x, h, z0], [-x, h, z1], [1, 0, 0], uv);
      q.quad([x, 0, z0], [x, 0, z1], [x, h, z1], [x, h, z0], [-1, 0, 0], uv);
      const m = q.mesh('stair:vestWalls', this.scene);
      m.material = wallMat;
      out.push(m);
    }
    // торец: тусклый тёплый свет из мира за дверью
    const q = new QuadBuilder();
    q.quad([x, 0, z1], [-x, 0, z1], [-x, h, z1], [x, h, z1], [0, 0, -1], (p) => [p.x, p.y]);
    const end = q.mesh('stair:vestEnd', this.scene);
    const em = new StandardMaterial('stair:vestEndMat', this.scene);
    em.disableLighting = true;
    em.emissiveColor = new Color3(0.55, 0.47, 0.36);
    em.fogEnabled = true;
    em.backFaceCulling = false;
    end.material = em;
    out.push(end);
    return out;
  }

  // ───────────────────────── окно петли ─────────────────────────

  /** Этажи (развёрнутые), стоящие на сцене: петля — окно base ± 2; разомкнутая — все от низа до верха. */
  get floors(): number[] {
    const out: number[] = [];
    const [a, b] = this.finite ? [this.finite.bottom, this.finite.top] : [this.base - MID, this.base + SLOTS - 1 - MID];
    for (let f = a; f <= b; f++) out.push(f);
    return out;
  }

  /** Локальная высота пола этажа f. */
  private floorY(f: number): number {
    return (f - this.base) * FLOOR_M;
  }

  /** Буфер матриц тонких экземпляров меша на n штук (пересоздаётся при смене числа этажей). */
  private buffer(m: Mesh, n: number): Float32Array {
    let buf = this.bufs.get(m);
    if (!buf || buf.length !== 16 * n) {
      buf = new Float32Array(16 * n);
      this.bufs.set(m, buf);
      m.thinInstanceSetBuffer('matrix', buf, 16, false);
    }
    return buf;
  }

  /** Раскладка этажей: модули (тонкие экземпляры), плафоны, плита низа, верхнее завершение. */
  private layout() {
    const fl = this.floors;
    const n = fl.length;
    for (const m of this.bodies) {
      const buf = this.buffer(m, n);
      fl.forEach((f, i) => Matrix.TranslationToRef(0, this.floorY(f), 0, TMP).copyToArray(buf, i * 16));
      m.thinInstanceBufferUpdated('matrix');
      m.thinInstanceRefreshBoundingInfo(false);
    }
    if (this.leaf) this.buffer(this.leaf, n);
    // плафоны: по два на этаж (копии образцов со своими материалами), лишние — выключены
    for (let k = this.lamps.length; k < 2 * n; k++) {
      const j = k % 2;
      const src = this.lampSrc[j];
      if (!src) break;
      const m = src.mesh.clone(`stair:lamp${j}:${k >> 1}`, null)!;
      const mat = new StandardMaterial(`stair:lampMat${j}:${k >> 1}`, this.scene);
      mat.disableLighting = true;
      mat.emissiveColor = WARM.scale(0.05);
      m.material = mat;
      m.isPickable = false;
      this.lamps.push({ floor: 0, j, mesh: m, mat, at: src.at });
    }
    this.lamps.forEach((l, k) => {
      const i = k >> 1;
      const on = i < n;
      l.mesh.setEnabled(on);
      if (!on) return;
      l.floor = fl[i];
      l.mesh.position.y = this.floorY(l.floor);
    });
    if (this.slab) {
      this.slab.setEnabled(this.bottom !== null);
      if (this.bottom !== null) this.slab.position.y = this.floorY(this.bottom);
    }
    for (const m of this.cap) {
      m.setEnabled(!!this.finite);
      if (this.finite) m.position.y = this.floorY(this.finite.top + 1);
    }
  }

  /**
   * Размыкание: лестница становится конечной — низ на этаж ниже игрока (не выше −1), верх — на TOP_ABOVE
   * этажей выше, над ним TopCap. Все этажи между ними ставятся модулями; окно больше не сдвигается
   * (base замораживается — координаты игрока не меняются, скачка нет), туман снимается. Вызывается в
   * темноте первой вспышки, когда кадр и так тёмный.
   */
  private makeFinite() {
    const f = moduleFloor(this.feetU);
    this.bottom = Math.min(-1, f - 1);
    this.finite = { bottom: this.bottom, top: f + TOP_ABOVE };
    // туман — далеко за пределами лестницы (режим тот же: шейдеры не пересобираются в момент размыкания)
    this.scene.fogStart = 1e4;
    this.scene.fogEnd = 2e4;
    this.camera.maxZ = 400;
    this.layout();
  }

  /** Сдвинуть окно на k модулей (игрок — на −3k м); всё, что к нему привязано, — тоже. */
  shiftWindow(k: number) {
    if (!k) return;
    const d = k * FLOOR_M;
    this.base += k;
    this.feet -= d;
    this.eyeY -= d;
    if (this.grab) {
      this.grab.from.y -= d;
      this.grab.to.y -= d;
    }
    this.wraps++;
    this.layout();
  }

  /** Сдвиг, если глаза вышли из среднего модуля. */
  applyWrap(): number {
    if (this.noWrap || this.grab || this.finite) return 0;
    const k = wrapShift(this.eyeY);
    this.shiftWindow(k);
    return k;
  }

  /** Развёрнутая высота ног (вход механики). */
  get feetU(): number {
    return unwrapY(this.feet, this.base);
  }

  // ───────────────────────── попытки ─────────────────────────

  private newAttempt(attempt: number) {
    this.roll = this.opts.roll ?? this.mech.roll(this.spec, this.opts.seedKey);
    this.state = this.mech.create(this.spec, this.roll, attempt);
    this.base = 0;
    this.feet = 0;
    this.vy = 0;
    this.pos = { x: 0, z: 2.15 };
    this.vel = { x: 0, z: 0 };
    this.eyeY = EYE_M;
    this.bottom = null;
    this.finite = null;
    this.scene.fogStart = FOG_START;
    this.scene.fogEnd = FOG_END;
    this.camera.maxZ = 40;
    this.hemi.groundColor.set(0.12, 0.12, 0.13);
    this.doors.clear();
    this.doors.set(0, DOOR_OPEN);
    this.backOpen = true;
    this.grab = null;
    this.opening = null;
    this.dip = 0;
    this.dead = null;
    this.camera.rotation.set(0.12, Math.PI, 0);
    this.camera.cameraRotation.set(0, 0);
    this.camera.fov = 1.2;
    this.flash.intensity = FLASH_I;
    this.hemi.intensity = this.ambient();
    if (this.ready) this.layout();
  }

  /** «Ещё раз» после смерти: новая попытка у входа. */
  retry() {
    this.newAttempt(this.state.attempt + 1);
    this.audio.reset();
    this.emitHud(true);
    if (!this.engine.isPointerLock) this.engine.enterPointerlock();
  }

  private ambient(): number {
    const d = clamp(this.spec.darkness, 0, 1);
    return 0.03 + 0.12 * (1 - d) * (1 - d);
  }

  // ───────────────────────── кадр ─────────────────────────

  private last = 0;

  private beforeRender() {
    const now = performance.now();
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 1 / 60;
    this.last = now;
    if (!this.manual && this.ready) {
      this.simulate(dt);
      this.applyWrap();
    }
    this.sync();
  }

  /** Шаг: ввод → физика игрока → механика → ролики. */
  simulate(dt: number, input?: Input) {
    if (this.disposed || this.exited || !this.ready) return;
    this.time += dt;
    this.dip = Math.max(0, this.dip - dt);
    if (this.grab) {
      this.grab.t += dt;
      if (this.grab.t > 2.5 && !this.dead) {
        this.dead = { reason: this.state.grabbedBy ?? 'descended' };
        this.deaths++;
        if (document.pointerLockElement === this.canvas) document.exitPointerLock();
        this.emitHud(true);
      }
      return;
    }
    if (!this.started && !this.manual) return;
    this.move(dt, input ?? this.readKeys());
    this.doorsStep(dt);
    if (this.state.phase !== 'grabbed') {
      const ev = this.mech.step(this.spec, this.state, dt, this.feetU);
      for (const e of ev) this.onEvent(e);
    }
    if (this.opening !== null) {
      this.opening += dt;
      // первая темнота размыкания — в ней лестница становится конечной (низ, верх, все этажи)
      if (!this.finite && this.opening > 0.05) this.makeFinite();
    }
    this.checkExit();
    this.audio.update(dt, { x: this.pos.x, y: this.eyeY, z: this.pos.z }, this.forward());
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
    if (e.type === 'keydown') this.keys.add(e.code);
    else this.keys.delete(e.code);
  }

  private forward(): { x: number; y: number; z: number } {
    const r = this.camera.rotation;
    return { x: Math.sin(r.y) * Math.cos(r.x), y: -Math.sin(r.x), z: Math.cos(r.y) * Math.cos(r.x) };
  }

  /** Прямоугольники коллизий для текущей высоты: дверь своей площадки, низ разомкнутой лестницы. */
  private boxes(): Box2[] {
    const out: Box2[] = [...STATIC_BOXES];
    const lf = landingFloor(this.feetU);
    const a = this.doors.get(lf) ?? 0;
    if (a < 1.0) out.push(DOOR_BOX);
    if (a > 0.25) {
      // открытое полотно в тамбуре вдоль стенки со стороны петель
      out.push({ x0: HINGE_X - 0.06 - Math.cos(a) * 0.94, z0: HINGE_Z, x1: HINGE_X + 0.05, z1: HINGE_Z + Math.sin(a) * 0.94 });
    }
    if (this.bottom !== null && Math.abs(this.feetU - this.bottom * FLOOR_M) < 1.2) out.push(BOTTOM_BOX);
    // верхняя площадка: ограждение неиспользуемого марша вверх
    if (this.finite && Math.abs(this.feetU - (this.finite.top + 1) * FLOOR_M) < 0.6) out.push(CAP_BOX);
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
    const nx = this.pos.x + this.vel.x * dt;
    const nz = this.pos.z + this.vel.z * dt;
    const [cx, cz] = collide2(nx, nz, BODY_R, this.boxes());
    // упёрлись — скорость по нормали гасится
    if (dt > 0) {
      this.vel.x = (cx - this.pos.x) / dt;
      this.vel.z = (cz - this.pos.z) / dt;
    }
    this.pos.x = cx;
    this.pos.z = cz;
    // высота: лучи вниз в ступени и площадки (центр и 4 точки по краю стопы — плавный подъём)
    const g = this.groundAt(this.pos.x, this.pos.z, this.feet);
    if (g !== null && g >= this.feet - STEP_DOWN) {
      this.feet = g;
      this.vy = 0;
    } else {
      this.vy -= 9.81 * dt;
      this.feet += this.vy * dt;
      if (g !== null && this.feet < g) {
        this.feet = g;
        this.vy = 0;
      }
    }
    // глаза догоняют ноги (ступени 0.15 м не дёргают камеру), покачивание при ходьбе
    const speed = Math.hypot(this.vel.x, this.vel.z);
    this.stepPhase += speed * dt * (Math.PI / 0.72);
    const target = this.feet + EYE_M;
    this.eyeY = lerp(this.eyeY, target, 1 - Math.exp(-dt * 14));
    if (Math.abs(this.eyeY - target) > 0.6) this.eyeY = target - Math.sign(target - this.eyeY) * 0.6;
    const bobAmp = clamp(speed / WALK, 0, 1.4) * 0.022;
    const nb = Math.sin(this.stepPhase) * bobAmp;
    // шаг — в нижней точке покачивания
    if (speed > 0.3 && Math.sin(this.stepPhase) < -0.95 && this.bob >= -0.95 * bobAmp) {
      this.audio.step({ x: this.pos.x, y: this.feet, z: this.pos.z }, inp.run ? 1.4 : 1);
    }
    this.bob = nb;
  }

  /** Высота опоры под стопой (локально в окне): самая высокая поверхность не выше ног + STEP_UP в
   *  центре и по краю стопы (плавный подъём на ступень); null — пустота. */
  groundAt(x: number, z: number, feet: number): number | null {
    const top = unwrapY(feet, this.base) + STEP_UP;
    const fin = this.finite;
    const vis = (k: number) => !fin || (k >= fin.bottom && k <= fin.top);
    const capY = fin ? (fin.top + 1) * FLOOR_M : 0;
    let best: number | null = null;
    const r = 0.13;
    for (const [ox, oz] of FOOT) {
      const px = x + ox * r, pz = z + oz * r;
      const y = groundY(this.field, px, pz, top, vis, this.bottom);
      if (y !== null && (best === null || y > best)) best = y;
      // пол верхней площадки (TopCap)
      if (fin) for (const h of this.capField.heights(px, pz)) if (capY + h <= top && (best === null || capY + h > best)) best = capY + h;
    }
    return best === null ? null : best - this.base * FLOOR_M;
  }

  // ───────────────────────── двери ─────────────────────────

  private doorsStep(dt: number) {
    const fu = this.feetU;
    const calm = this.state.phase === 'calm' || this.state.phase === 'open';
    // входная: открыта, пока спокойно и игрок у входного этажа (с запасом — без дребезга)
    // в конечной лестнице входной этаж может оказаться выше верха (там глухая стена завершения)
    const hasEntrance = !this.finite || (this.finite.bottom <= 0 && this.finite.top >= 0);
    if (this.backOpen) {
      if (!calm || !hasEntrance || fu < -1.05 || fu > 2.2) this.backOpen = false;
    } else if (calm && hasEntrance && fu > -0.6 && fu < 1.6) this.backOpen = true;
    const want = new Map<number, number>([[0, this.backOpen ? DOOR_OPEN : 0]]);
    if (this.bottom !== null && this.state.phase === 'open') want.set(this.bottom, DOOR_OPEN);
    for (const f of new Set([...this.doors.keys(), ...want.keys()])) {
      const cur = this.doors.get(f) ?? 0;
      const to = want.get(f) ?? 0;
      if (Math.abs(cur - to) < 1e-4) {
        if (to === 0) this.doors.delete(f);
        continue;
      }
      const sp = to > cur ? 1.6 : 3.2;
      const next = to > cur ? Math.min(to, cur + sp * dt) : Math.max(to, cur - sp * dt);
      // звук — у двери этажа f (локально)
      const at = { x: 0, y: f * FLOOR_M - this.base * FLOOR_M + 1.2, z: IN_Z };
      if (cur === 0 && next > 0) this.audio.door(true, at);
      if (next === 0 && cur > 0) this.audio.door(false, at);
      if (next === 0) this.doors.delete(f);
      else this.doors.set(f, next);
    }
  }

  private checkExit() {
    if (this.exited || this.pos.z < EXIT_Z) return;
    const lf = landingFloor(this.feetU);
    if ((this.doors.get(lf) ?? 0) < 0.6) return;
    if (lf === 0 && this.state.phase !== 'open') this.exit('back');
    else if (this.bottom !== null && lf === this.bottom) this.exit('descend');
    else if (lf === 0) this.exit('back');
  }

  /** Выход за дверь: мышь не отпускаем — в «Прогулке» игрок идёт дальше (страница решает сама). */
  private exit(kind: StairExit) {
    this.exited = true;
    this.keys.clear();
    this.opts.onExit?.(kind, this.roll.floorsDown);
  }

  // ───────────────────────── события механики ─────────────────────────

  private onEvent(e: StairwellEvent) {
    this.log.push({ t: this.state.t, y: this.feetU, e });
    if (this.log.length > 400) this.log.splice(0, 100);
    switch (e.type) {
      case 'sound':
        this.dip = 1.6;
        this.audio.scarySound();
        break;
      case 'approach':
        this.audio.approach(e.meter);
        break;
      case 'survived':
        this.audio.survived();
        break;
      case 'grabbed':
        this.startGrab();
        break;
      case 'opened':
        this.opening = 0;
        this.audio.opened();
        break;
    }
    this.emitHud(true);
  }

  private startGrab() {
    const c = this.camera;
    const from = new Vector3(this.pos.x, this.eyeY + this.bob, this.pos.z);
    // в пролёт между маршами (X = 0), на уровень ног
    const to = new Vector3(0, this.eyeY - 1.5, clamp(this.pos.z, -1.35, 0.85));
    this.grab = { t: 0, from, yaw: c.rotation.y, pitch: c.rotation.x, to };
    this.audio.grab();
  }

  // ───────────────────────── вид ─────────────────────────

  /** Камера, лампы, фонарик, двери, туман — из состояния (время не идёт). */
  sync() {
    const c = this.camera;
    const t = this.time;
    const g = this.grab;
    if (g) this.syncGrab(g);
    else {
      c.rotation.x = clamp(c.rotation.x, -1.45, 1.45);
      c.position.set(this.pos.x, this.eyeY + this.bob, this.pos.z);
    }
    // размыкание: вспышки, затем свет
    const op = this.opening;
    const opened = op !== null && op > 1.25;
    const meter = this.state.threat?.meter ?? 0;
    const lampMul = op !== null ? (op < 0.18 ? 0 : op < 1.25 ? (hash01(Math.floor(op * 14), 5) > 0.45 ? 1 : 0.05) : 1) : this.dip > 0 ? 0.25 + 0.75 * (hash01(Math.floor(t * 18), 9) > 0.6 ? 1 : 0.2) : 1 - 0.5 * meter;
    // лампы
    const eye = c.position;
    const cand: { l: Lamp; lvl: number; d: number; p: Vector3 }[] = [];
    const darkness = opened ? 0 : this.spec.darkness;
    for (const l of this.lamps) {
      if (!l.mesh.isEnabled()) continue;
      const f = l.floor;
      const kind: LampKind = opened ? 'dim' : lampKind(this.seedN, f, l.j, darkness);
      let lvl = opened ? 1 : lampLevel(kind, this.seedN, f, l.j, t);
      lvl *= lampMul;
      l.mat.emissiveColor.copyFrom(WARM).scaleInPlace(0.04 + 1.5 * lvl);
      if (lvl <= 0.02) continue;
      const p = new Vector3(l.at.x, l.at.y + this.floorY(f), l.at.z);
      const d = Vector3.Distance(p, eye);
      // в петле — только из-под тумана (свет из-за края окна не нужен); в конечной — ближайшие любые
      if (d < POOL_R || this.finite) cand.push({ l, lvl, d, p });
    }
    cand.sort((a, b) => a.d - b.d || a.l.floor - b.l.floor || a.l.j - b.l.j);
    for (let k = 0; k < POOL; k++) {
      const pl = this.pool[k];
      const cc = cand[k];
      if (cc) {
        pl.position.copyFrom(cc.p);
        pl.intensity = LAMP_I * cc.lvl * (opened ? 1.35 : 1);
      } else pl.intensity = 0;
    }
    // фонарик: мягкое дрожание руки, в угрозе — сбои
    const sway = Math.sin(this.stepPhase * 0.5) * 0.02;
    const jx = Math.sin(t * 1.3) * 0.012 + Math.sin(t * 3.7) * 0.005 + sway;
    const jy = Math.sin(t * 1.9 + 1) * 0.01 + Math.cos(t * 4.3) * 0.004 + Math.abs(sway) * 0.5;
    this.flash.direction.set(jx, jy - 0.03, 1);
    let fi = FLASH_I * (0.96 + 0.04 * Math.sin(t * 23));
    if (meter > 0.35 && hash01(Math.floor(t * 12), 3) < (meter - 0.35) * 0.5) fi *= 0.15;
    if (this.dip > 1.2) fi *= hash01(Math.floor(t * 20), 4) > 0.5 ? 1 : 0.1;
    if (op !== null && op < 0.18) fi *= 0.1;
    if (g) fi *= g.t < 1.4 ? (hash01(Math.floor(g.t * 16), 6) > 0.35 ? 1 : 0.05) : Math.max(0, 1 - (g.t - 1.4) * 2);
    this.flash.intensity = fi;
    // свет «включился»: рассеянный свет шахты (не убывает с расстоянием — дальние этажи не темнеют),
    // снизу подсвечены и потолки/низ маршей; тумана в конечной лестнице нет (makeFinite)
    const amb = opened ? OPEN_AMB : this.ambient();
    this.hemi.intensity = lerp(this.hemi.intensity, amb, 0.08);
    if (opened) this.hemi.groundColor.set(0.5, 0.48, 0.45);
    // виньетка: в угрозе — темнее и краснее; на обычной лестнице — едва
    const ip = this.scene.imageProcessingConfiguration;
    const red = g ? Math.min(1, g.t / 1.5) : meter;
    ip.vignetteWeight = (opened ? 1 : 2.2) + 4 * red;
    ip.vignetteColor.set(0.35 * red, 0, 0, 0);
    // двери (по развёрнутым этажам)
    if (this.leaf) {
      const buf = this.bufs.get(this.leaf);
      const fl = this.floors;
      if (buf && buf.length === 16 * fl.length) {
        fl.forEach((f, i) => {
          const a = this.doors.get(f) ?? 0;
          Matrix.ComposeToRef(ONE, Quaternion.RotationAxisToRef(Vector3.UpReadOnly, a, TQ), new Vector3(HINGE_X, this.floorY(f), HINGE_Z), TMP);
          TMP.copyToArray(buf, i * 16);
        });
        this.leaf.thinInstanceBufferUpdated('matrix');
      }
    }
  }

  /** Ролик захвата: рывок вниз, волоком в пролёт, падение в темноту. */
  private syncGrab(g: NonNullable<StairwellScene['grab']>) {
    const c = this.camera;
    const t = g.t;
    const shake = (a: number) => (hash01(Math.floor(t * 40), 11) - 0.5) * a;
    if (t < 0.3) {
      const k = smooth(t / 0.3);
      c.position.set(g.from.x + shake(0.05), g.from.y - 0.55 * k + shake(0.05), g.from.z);
      c.rotation.set(lerp(g.pitch, 0.95, k), g.yaw + shake(0.15), shake(0.2));
    } else if (t < 1.1) {
      // волоком в пролёт; взгляд быстро запрокидывается вверх — над головой уходят марши
      const k = smooth((t - 0.3) / 0.8);
      const kl = smooth(Math.min(1, (t - 0.3) / 0.35));
      const p = Vector3.Lerp(new Vector3(g.from.x, g.from.y - 0.55, g.from.z), g.to, k);
      c.position.set(p.x + shake(0.03), p.y + shake(0.03), p.z);
      c.rotation.set(lerp(0.95, -1.32, kl), g.yaw + k * 0.6, lerp(0, 0.35, k) + shake(0.08));
    } else {
      // падение вглубь пролёта, в темноту за краем окна
      const s = t - 1.1;
      c.position.set(g.to.x + shake(0.02), g.to.y - 0.5 * 9 * s * s, g.to.z);
      c.rotation.set(-1.35 + shake(0.04), g.yaw + 0.6 + s * 0.5, 0.35 + s * 0.3);
    }
    c.fov = lerp(1.2, 1.45, Math.min(1, t / 1.2));
  }

  // ───────────────────────── HUD ─────────────────────────

  get hud(): StairHud {
    const s = this.state;
    return {
      loading: !this.ready && !this.error,
      error: this.error,
      started: this.started,
      locked: this.locked,
      sound: this.audio.enabled,
      phase: s.phase,
      survived: s.survived,
      needed: s.roll.sounds,
      meter: s.threat?.meter ?? 0,
      floor: moduleFloor(this.feetU),
      y: this.feetU,
      attempt: s.attempt,
      deaths: this.deaths,
      dead: this.dead,
      floorsDown: this.roll.floorsDown,
      bottom: this.bottom,
      top: this.finite?.top ?? null,
      backOpen: this.backOpen,
    };
  }

  private emitHud(force = false) {
    if (!force && performance.now() - this.hudAt < 120) return;
    this.hudAt = performance.now();
    this.opts.onHud?.(this.hud);
  }

  setSound(on: boolean) {
    this.audio.setEnabled(on);
    this.emitHud(true);
  }

  // ───────────────────────── QA ─────────────────────────

  /** QA: начать без клика (звук — если контекст разрешён). */
  qaStart() {
    this.started = true;
    this.manual = true;
    void this.audio.start();
  }

  /** QA: шагнуть симуляцию на sec секунд с вводом (шаг 1/60). */
  advance(sec: number, input: Input = { f: 0, s: 0, run: false }) {
    const n = Math.max(1, Math.round(sec * 60));
    for (let k = 0; k < n && !this.exited; k++) {
      this.simulate(1 / 60, input);
      this.applyWrap();
    }
  }

  /** QA: идти к точке плана (локально), смотря по ходу; true — дошли. */
  walkTo(x: number, z: number, maxSec = 12, run = false, pitch = 0.15): boolean {
    for (let k = 0; k < maxSec * 60; k++) {
      const dx = x - this.pos.x, dz = z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.06) return true;
      this.camera.rotation.y = Math.atan2(dx, dz);
      this.camera.rotation.x = pitch;
      this.simulate(1 / 60, { f: Math.min(1, d / 0.3), s: 0, run });
      if (this.exited || this.grab) return false;
      this.applyWrap();
    }
    return false;
  }

  /** QA: спуститься (или подняться) на n этажей по маршруту. */
  walkFloors(n: number, run = false): boolean {
    const path = n < 0 ? UP_PATH : DOWN_PATH;
    for (let f = 0; f < Math.abs(n); f++) for (const [x, z] of path) if (!this.walkTo(x, z, 12, run)) return false;
    return true;
  }

  /** QA: место и состояние. */
  qaState() {
    return {
      feetU: this.feetU,
      feet: this.feet,
      eye: this.eyeY,
      base: this.base,
      pos: { ...this.pos },
      phase: this.state.phase,
      survived: this.state.survived,
      needed: this.state.roll.sounds,
      meter: this.state.threat?.meter ?? 0,
      wraps: this.wraps,
      bottom: this.bottom,
      top: this.finite?.top ?? null,
      floors: this.floors.length,
      fogEnd: this.scene.fogEnd,
      doors: [...this.doors.entries()],
      grab: this.grab?.t ?? null,
      dead: this.dead,
      exited: this.exited,
      t: this.state.t,
      nextSoundIn: this.state.nextSoundIn,
      audio: { ...this.audio.counters, running: this.audio.running },
    };
  }

  /** QA: отрисовать кадр и прочитать пиксели (RGBA). */
  async pixels(): Promise<Uint8Array> {
    this.scene.render();
    const w = this.engine.getRenderWidth(), h = this.engine.getRenderHeight();
    const data = await this.engine.readPixels(0, 0, w, h, true, true);
    return new Uint8Array((data as Uint8Array).buffer.slice(0));
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('pointerlockchange', this.onLock);
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.camera.detachControl();
    this.audio.dispose();
    this.scene.dispose();
  }
}

const ONE = new Vector3(1, 1, 1);
const TMP = new Matrix();
const TQ = new Quaternion();
const FOOT: [number, number][] = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Сборщик плоских четырёхугольников (позиции, нормали, UV) → Mesh. */
class QuadBuilder {
  private p: number[] = [];
  private n: number[] = [];
  private uv: number[] = [];
  private i: number[] = [];

  quad(a: readonly number[], b: readonly number[], c: readonly number[], d: readonly number[], nrm: readonly number[], uv: (p: Vector3) => number[]) {
    const k = this.p.length / 3;
    for (const v of [a, b, c, d]) {
      this.p.push(v[0], v[1], v[2]);
      this.n.push(nrm[0], nrm[1], nrm[2]);
      const [u, w] = uv(new Vector3(v[0], v[1], v[2]));
      this.uv.push(u, w);
    }
    // обход — по нормали (материалы модуля двусторонние, но так верно и для односторонних)
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const same = cr[0] * nrm[0] + cr[1] * nrm[1] + cr[2] * nrm[2] > 0;
    // Babylon (левосторонний) по умолчанию лицевые — по часовой при взгляде с нормали
    if (same) this.i.push(k, k + 2, k + 1, k, k + 3, k + 2);
    else this.i.push(k, k + 1, k + 2, k, k + 2, k + 3);
  }

  mesh(name: string, scene: Scene): Mesh {
    const vd = new VertexData();
    vd.positions = this.p;
    vd.normals = this.n;
    vd.uvs = this.uv;
    vd.indices = this.i;
    const m = new Mesh(name, scene);
    vd.applyToMesh(m, false);
    return m;
  }
}

