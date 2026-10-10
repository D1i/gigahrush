// Сцена спец-локации «Ангар» (Babylon) — своя Scene в движке вкладки «3D» (BlockoutViewer.setOverlay), как
// sceneLift.ts. Механика — ./hangar.ts: падение (fallPose), табличка мини-босса, правило.
//
//  • Модели — набор пользователя «завод → болото» (assets/hangar.glb, tools/optimize-hangar.mjs): стены цеха 4 м
//    (в два яруса), полы 4×4 (у кучи — мокрые: с дыры капает), металлолом (куча, в которую падает игрок, — несколько
//    куч разного масштаба горкой), козловая таль (зона мини-босса), конвейеры, пресс, печь с ковшом и формами
//    (раскалённый металл — тепло снизу, отчего над ангаром подтаял снег), пара шестерён, маховик, вал, вентиляторы в
//    торцевой стене, трубы, бочки, шлагбаум в воротах. Крутится всё, что крутится в наборе (узлы moving_nodes).
//  • Крыша, фермы, лампы, снег в дыре, сугроб на куче — примитивы (в наборе их нет).
//  • Цех 16 × 28 м, стены 8 м, конёк 9.6 м; дыра в крыше над кучей. Ворота — в дальнем торце (z = +14): за ними тёмный
//    заснеженный двор; вышел за ворота — onExit (мир: StreamWorld.descend).
//  • Игрок: своя ходьба (WASD, мышь, Shift — бегом), коллизии в плане (коробки), высота пола — куча (конус) или 0.
//    Начало — падение (fallPose): пелена, полёт с крыши, удар, лежит, встаёт; управление — после.
//  • Свет: натриевые лампы под фермами, печь, слабый холодный свет из дыры, красный отсвет у тали.
//  • Звук — ./hangarAudio.ts: свист падения, удар о кучу и звон в ушах, гул машин, печь, вентиляторы, конвейер,
//    лязги, у тали — гул и скрип цепи, шаги (по куче — железо).
import { Scene } from '@babylonjs/core/scene';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { SpotLight } from '@babylonjs/core/Lights/spotLight';
import { Light } from '@babylonjs/core/Lights/light';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import '@babylonjs/core/Particles/particleSystemComponent';
import { PointerEventTypes } from '@babylonjs/core/Events/pointerEvents';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import type { Engine } from '@babylonjs/core/Engines/engine';
import type { AssetContainer } from '@babylonjs/core/assetContainer';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import '@babylonjs/loaders/glTF/2.0/glTFLoader';
import '@babylonjs/loaders/glTF/2.0/Extensions/EXT_texture_webp';
import '@babylonjs/loaders/glTF/2.0/Extensions/KHR_mesh_quantization';
import '@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_emissive_strength';
import hangarUrl from './assets/hangar.glb?url';
import { collide2, type Box2 } from './stairLoop';
import { puffTexture } from './liftTextures';
import { fallPose, hangarBossSign, rollHangar, FALL_BREAK_S, FALL_LAND_S, FALL_ROOF_M, FALL_LIE_EYE, FALL_TOTAL_S, type HangarRoll, type HangarSpec } from './hangar';
import { HangarAudio } from './hangarAudio';

export interface HangarHud {
  loading: boolean;
  error: string | null;
  started: boolean;
  locked: boolean;
  phase: 'fall' | 'walk' | 'exit';
  /** игрок в зоне мини-босса */
  boss: boolean;
  sign: string;
  prompt: string | null;
}

export interface HangarSceneOptions {
  spec: HangarSpec;
  seedKey: string;
  roll?: HangarRoll;
  /** начать сразу с падения (из «Прогулки» — пятно пробито); false — стоя у кучи (просмотр комнаты) */
  fall?: boolean;
  /** звук (по умолчанию — да) */
  sound?: boolean;
  onHud?(h: HangarHud): void;
  onExit?(): void;
}

interface Input {
  f: number;
  s: number;
  run: boolean;
}

// ───────────────────────── размеры (мир сцены, м) ─────────────────────────

/** цех: x ∈ [−HX, HX], z ∈ [−HZ, HZ] */
const HX = 8;
const HZ = 14;
const EAVES = 8;
const RIDGE = 9.6;
/** дыра в крыше и куча под ней */
const HOLE = { x: -1.6, z: -6, r: 0.8 };
const roofY = (x: number) => EAVES + (RIDGE - EAVES) * (1 - Math.abs(x) / HX);
/** верх кучи: от крыши у дыры вниз на высоту падения и глаз лёжа (fallPose начинается в берлоге над крышей) */
const HEAP_TOP = roofY(HOLE.x) - FALL_ROOF_M - FALL_LIE_EYE;
const HEAP_R = 3.4;
/** ворота: проём в дальнем торце */
const GATE = { x0: -2.2, x1: 2.2, h: 4 };
/** зона мини-босса — под талью у ворот */
const BOSS_Z = 7.5;
const EXIT_Z = HZ + 2.5;
const EYE = 1.6;
const BODY_R = 0.3;
const WALK = 1.6;
const RUN = 3.2;

const SODIUM = new Color3(1, 0.62, 0.3);
const COLD = new Color3(0.62, 0.74, 1);

/** Высота пола под игроком: куча (гладкий конус) или 0. */
export function hangarGround(x: number, z: number): number {
  const r = Math.hypot(x - HOLE.x, z - HOLE.z) / HEAP_R;
  if (r >= 1) return 0;
  const k = 1 - r * r;
  return HEAP_TOP * k * k * (1 + 0.3 * r);
}

export class HangarScene {
  readonly scene: Scene;
  readonly camera: UniversalCamera;
  readonly spec: HangarSpec;
  roll: HangarRoll;
  ready = false;
  error: string | null = null;

  pos = { x: HOLE.x, z: HOLE.z };
  yaw = 0;
  eyeY = HEAP_TOP + EYE;
  time = 0;
  /** время с начала падения (null — не падает) */
  fallT: number | null = null;

  private started = false;
  private locked = false;
  private exited = false;
  private bossSeen = false;
  private keys = new Set<string>();
  private hudAt = 0;
  private boxes: Box2[] = [];
  private spin: { node: TransformNode; axis: 'x' | 'y' | 'z'; speed: number }[] = [];
  private hook: TransformNode | null = null;
  private lamps: { light: PointLight; base: number; seed: number }[] = [];
  private white!: Mesh;
  private whiteMat!: StandardMaterial;
  private snow!: ParticleSystem;
  private bossLight!: PointLight;
  private container: AssetContainer | null = null;
  private templates = new Map<string, TransformNode>();

  /** QA: шаги только из advance */
  manual = false;
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
    private readonly opts: HangarSceneOptions,
  ) {
    this.spec = opts.spec;
    this.roll = opts.roll ?? rollHangar(opts.spec, opts.seedKey);
    this.audio = new HangarAudio(opts.sound !== false);
    const scene = (this.scene = new Scene(engine));
    scene.clearColor = new Color4(0.01, 0.01, 0.012, 1);
    scene.ambientColor = new Color3(0, 0, 0);
    scene.skipPointerMovePicking = true;
    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogColor = new Color3(0.02, 0.018, 0.016);
    scene.fogDensity = 0.035 + 0.04 * this.spec.darkness;
    const ip = scene.imageProcessingConfiguration;
    ip.toneMappingEnabled = true;
    ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    ip.exposure = 1.45;
    ip.contrast = 1.1;
    ip.vignetteEnabled = true;
    ip.vignetteWeight = 2.2;
    ip.vignetteColor = new Color4(0, 0, 0, 0);
    ip.vignetteBlendMode = ImageProcessingConfiguration.VIGNETTEMODE_MULTIPLY;

    const cam = (this.camera = new UniversalCamera('hangar:eye', new Vector3(this.pos.x, this.eyeY, this.pos.z), scene));
    cam.minZ = 0.03;
    cam.maxZ = 120;
    cam.fov = 1.2;
    cam.inertia = 0.45;
    cam.angularSensibility = 2200;
    cam.speed = 0;
    cam.inputs.removeByType('FreeCameraKeyboardMoveInput');
    cam.rotation.set(0, 0, 0);
    scene.activeCamera = cam;

    const hemi = new HemisphericLight('hangar:amb', new Vector3(0.1, 1, 0.2), scene);
    hemi.diffuse = new Color3(0.75, 0.72, 0.68).scale(1 - 0.6 * this.spec.darkness);
    hemi.groundColor = new Color3(0.08, 0.07, 0.06);
    hemi.specular = Color3.Black();

    // белая пелена (снег в лицо при провале) — плашка перед камерой
    this.whiteMat = new StandardMaterial('hangar:white', scene);
    this.whiteMat.disableLighting = true;
    this.whiteMat.emissiveColor = new Color3(0.92, 0.95, 1);
    this.whiteMat.alpha = 0;
    this.whiteMat.disableDepthWrite = true;
    this.white = MeshBuilder.CreatePlane('hangar:whiteout', { size: 2 }, scene);
    this.white.material = this.whiteMat;
    this.white.parent = cam;
    this.white.position.set(0, 0, 0.1);
    this.white.renderingGroupId = 1;
    this.white.isPickable = false;

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
    if (opts.fall !== false) this.fallT = 0;
    else {
      this.pos = { x: HOLE.x + 1.2, z: HOLE.z + HEAP_R + 0.8 };
      this.eyeY = EYE;
    }
  }

  static async create(engine: Engine, canvas: HTMLCanvasElement, opts: HangarSceneOptions): Promise<HangarScene> {
    const s = new HangarScene(engine, canvas, opts);
    s.emitHud(true);
    try {
      await s.load();
      s.ready = true;
    } catch (e) {
      console.error(e);
      s.error = 'Не удалось загрузить ангар: ' + String((e as Error)?.message ?? e);
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

  /** звук сцены; запускается по жесту (begin) */
  audio!: HangarAudio;

  setSound(on: boolean) {
    this.audio.setEnabled(on);
    if (on) void this.audio.start();
  }

  async begin() {
    if (this.disposed) return;
    if (!this.engine.isPointerLock) this.engine.enterPointerlock();
    // провалились с уже захваченной мышью (снег «Прогулки») — смены захвата (onLock) не будет, а подсказка — по locked
    this.locked = document.pointerLockElement === this.canvas;
    this.started = true;
    void this.audio.start();
    this.emitHud(true);
  }

  render() {
    if (!this.disposed) this.scene.render();
  }

  // ───────────────────────── сборка ─────────────────────────

  private async load() {
    const scene = this.scene;
    const c = (this.container = await LoadAssetContainerAsync(hangarUrl, scene, { pluginExtension: '.glb' }));
    if (this.disposed) return;
    c.addAllToScene();
    for (const m of c.materials) {
      (m as unknown as { maxSimultaneousLights: number }).maxSimultaneousLights = 8;
      // без карты окружения металл PBR — чёрный: ржавое железо цеха матовее
      if (m instanceof PBRMaterial) {
        m.metallic = Math.min(m.metallic ?? 1, 0.35);
        m.roughness = Math.max(m.roughness ?? 0.5, 0.55);
        if (/molten/.test(m.name)) m.emissiveIntensity = 2.2;
      }
    }
    // шаблоны — узлы верхнего уровня (под __root__ загрузчика: он отражает z — правосторонний glTF в левой сцене)
    const root = c.transformNodes.find((n) => n.name === '__root__') ?? c.meshes.find((n) => n.name === '__root__');
    for (const n of [...c.transformNodes, ...c.meshes]) {
      if (n.parent && n.parent === root) this.templates.set(n.name, n as TransformNode);
    }
    if (root) root.setEnabled(false);
    this.build();
  }

  /** Экземпляр модели набора: позиция, поворот вокруг y (рад), масштаб. */
  private put(key: string, x: number, y: number, z: number, rotY = 0, scale = 1): TransformNode | null {
    const t = this.templates.get(key);
    if (!t) return null;
    const holder = new TransformNode(`hangar:${key}`, this.scene);
    holder.position.set(x, y, z);
    holder.rotation.y = rotY;
    holder.scaling.setAll(scale);
    const mirror = new TransformNode(`hangar:${key}:m`, this.scene);
    mirror.parent = holder;
    mirror.scaling.z = -1;
    // клоны с общей геометрией (экземпляры InstancedMesh не рисуются, пока шаблон выключен)
    const inst = t.instantiateHierarchy(mirror, { doNotInstantiate: true });
    if (inst) inst.setEnabled(true);
    for (const m of holder.getChildMeshes(false)) m.isPickable = false;
    return holder;
  }

  private find(holder: TransformNode | null, name: string): TransformNode | null {
    if (!holder) return null;
    return (holder.getDescendants(false).find((n) => n.name.endsWith(name)) as TransformNode | undefined) ?? null;
  }

  private box(x0: number, z0: number, x1: number, z1: number) {
    this.boxes.push({ x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1) } as Box2);
  }

  private build() {
    const scene = this.scene;
    // ── пол: плиты 4×4, у кучи — мокрые
    for (let x = -HX + 2; x < HX; x += 4) {
      for (let z = -HZ + 2; z < HZ; z += 4) {
        const wet = Math.hypot(x - HOLE.x, z - HOLE.z) < 5;
        this.put(wet ? 'floor_wet' : 'floor_dry', x, 0, z);
      }
    }
    // ── стены: два яруса панелей 4 м; в дальнем торце — проём ворот (нижний ярус посередине)
    for (let k = 0; k < 2; k++) {
      const y = k * 4;
      for (let z = -HZ + 2; z < HZ; z += 4) {
        this.put('wall', -HX, y, z, Math.PI / 2);
        this.put('wall', HX, y, z, -Math.PI / 2);
      }
      for (let x = -HX + 2; x < HX; x += 4) {
        this.put('wall', x, y, -HZ, 0);
        if (k === 0 && Math.abs(x) < 3) continue;
        this.put('wall', x, y, HZ, Math.PI);
      }
    }
    // над воротами — перемычка
    const darkSteel = new StandardMaterial('hangar:steel', scene);
    darkSteel.diffuseColor = new Color3(0.16, 0.16, 0.17);
    darkSteel.specularColor = new Color3(0.1, 0.1, 0.1);
    const lintel = MeshBuilder.CreateBox('hangar:lintel', { width: 8, height: 0.5, depth: 0.4 }, scene);
    lintel.position.set(0, 3.85, HZ);
    lintel.material = darkSteel;
    // стены — коллизии (в воротах — проход)
    this.box(-HX - 1, -HZ - 1, -HX + 0.25, HZ + 1);
    this.box(HX - 0.25, -HZ - 1, HX + 1, HZ + 1);
    this.box(-HX, -HZ - 1, HX, -HZ + 0.25);
    this.box(-HX, HZ - 0.25, GATE.x0, HZ + 0.3);
    this.box(GATE.x1, HZ - 0.25, HX, HZ + 0.3);
    // за воротами — двор: стены забора по краям
    this.box(-HX, HZ + 0.3, -4.5, EXIT_Z + 4);
    this.box(4.5, HZ + 0.3, HX, EXIT_Z + 4);

    // ── крыша: двускатная, профлист (тёмный), с дырой над кучей
    const sheet = new StandardMaterial('hangar:roof', scene);
    sheet.diffuseColor = new Color3(0.2, 0.19, 0.18);
    sheet.specularColor = new Color3(0.05, 0.05, 0.05);
    sheet.backFaceCulling = false;
    const slope = Math.atan2(RIDGE - EAVES, HX);
    const slab = (name: string, side: -1 | 1, z0: number, z1: number, x0 = 0, x1 = HX) => {
      // полоса ската side от |x| = x0 до x1 по z ∈ [z0, z1]
      const w = (x1 - x0) / Math.cos(slope);
      const m = MeshBuilder.CreateBox(name, { width: w, height: 0.06, depth: z1 - z0 }, scene);
      const xm = side * (x0 + x1) / 2;
      m.position.set(xm, roofY(xm) + 0.05, (z0 + z1) / 2);
      m.rotation.z = side * -slope;
      m.material = sheet;
      m.isPickable = false;
      return m;
    };
    const hz0 = HOLE.z - HOLE.r, hz1 = HOLE.z + HOLE.r, hx0 = -HOLE.x - HOLE.r, hx1 = -HOLE.x + HOLE.r;
    slab('roof:e', 1, -HZ - 0.3, HZ + 0.3);
    slab('roof:w1', -1, -HZ - 0.3, hz0);
    slab('roof:w2', -1, hz1, HZ + 0.3);
    slab('roof:w3', -1, hz0, hz1, 0, hx0);
    slab('roof:w4', -1, hz0, hz1, hx1, HX);
    // фермы: нижний пояс, стропила, стойки — каждые 4 м; одним мешем
    const parts: Mesh[] = [];
    for (let z = -HZ + 2; z <= HZ - 2; z += 4) {
      const chord = MeshBuilder.CreateBox('t', { width: 2 * HX, height: 0.22, depth: 0.16 }, scene);
      chord.position.set(0, EAVES - 0.3, z);
      parts.push(chord);
      for (const side of [-1, 1] as const) {
        const len = Math.hypot(HX, RIDGE - EAVES);
        const raf = MeshBuilder.CreateBox('t', { width: len, height: 0.2, depth: 0.14 }, scene);
        raf.position.set((side * HX) / 2, (EAVES + RIDGE) / 2 - 0.15, z);
        raf.rotation.z = side * -slope;
        parts.push(raf);
        for (let k = 1; k < 4; k++) {
          const x = (side * HX * k) / 4;
          const hgt = roofY(x) - (EAVES - 0.3);
          const post = MeshBuilder.CreateBox('t', { width: 0.1, height: hgt, depth: 0.1 }, scene);
          post.position.set(x, EAVES - 0.3 + hgt / 2, z);
          parts.push(post);
        }
      }
    }
    const truss = Mesh.MergeMeshes(parts, true, true);
    if (truss) {
      truss.name = 'hangar:truss';
      truss.material = darkSteel;
      truss.isPickable = false;
    }

    // ── дыра: рваный край снега над крышей и сугроб на куче; снег сыплется; холодный свет сверху
    const snowMat = new StandardMaterial('hangar:snow', scene);
    snowMat.diffuseColor = new Color3(0.88, 0.91, 0.96);
    snowMat.emissiveColor = new Color3(0.08, 0.09, 0.11);
    snowMat.specularColor = new Color3(0.05, 0.05, 0.06);
    // в дыре — толща снега, подсвеченная сверху (холодное свечение, как у снежных ходов)
    const holeMat = new StandardMaterial('hangar:holeSnow', scene);
    holeMat.diffuseColor = new Color3(0.85, 0.9, 1);
    holeMat.emissiveColor = new Color3(0.42, 0.48, 0.6);
    holeMat.backFaceCulling = false;
    const rim = MeshBuilder.CreateTorus('hangar:holeRim', { diameter: HOLE.r * 2.2, thickness: 0.5, tessellation: 18 }, scene);
    rim.position.set(HOLE.x, roofY(HOLE.x) + 0.25, HOLE.z);
    rim.scaling.y = 0.7;
    rim.material = snowMat;
    const shaft = MeshBuilder.CreateCylinder('hangar:holeShaft', { diameterTop: HOLE.r * 1.6, diameterBottom: HOLE.r * 2, height: 1.4, tessellation: 16, sideOrientation: Mesh.DOUBLESIDE }, scene);
    shaft.position.set(HOLE.x, roofY(HOLE.x) + 0.9, HOLE.z);
    shaft.material = holeMat;
    const cap = MeshBuilder.CreateDisc('hangar:holeCap', { radius: HOLE.r * 0.8, tessellation: 16 }, scene);
    cap.position.set(HOLE.x, roofY(HOLE.x) + 1.6, HOLE.z);
    cap.rotation.x = Math.PI / 2;
    cap.material = holeMat;
    const mound = MeshBuilder.CreateSphere('hangar:mound', { diameter: 2.2, segments: 10 }, scene);
    mound.scaling.set(1, 0.32, 1.1);
    mound.position.set(HOLE.x + 0.2, HEAP_TOP - 0.15, HOLE.z + 0.1);
    mound.material = snowMat;
    for (const m of [rim, shaft, cap, mound, lintel]) m.isPickable = false;
    const sky = new SpotLight('hangar:holeLight', new Vector3(HOLE.x, roofY(HOLE.x) + 1.2, HOLE.z), new Vector3(0, -1, 0), 0.7, 2, scene);
    sky.diffuse = COLD;
    sky.specular = Color3.Black();
    sky.intensity = 2.2;
    sky.range = 14;
    const snow = (this.snow = new ParticleSystem('hangar:snowfall', 400, scene));
    snow.particleTexture = puffTexture(scene);
    snow.emitter = new Vector3(HOLE.x, roofY(HOLE.x) + 0.2, HOLE.z);
    snow.minEmitBox = new Vector3(-HOLE.r * 0.7, 0, -HOLE.r * 0.7);
    snow.maxEmitBox = new Vector3(HOLE.r * 0.7, 0, HOLE.r * 0.7);
    snow.direction1 = new Vector3(-0.15, -1, -0.15);
    snow.direction2 = new Vector3(0.15, -1, 0.15);
    snow.minEmitPower = 0.6;
    snow.maxEmitPower = 1.6;
    snow.gravity = new Vector3(0, -2.2, 0);
    snow.minSize = 0.02;
    snow.maxSize = 0.07;
    snow.minLifeTime = 2.5;
    snow.maxLifeTime = 3.6;
    snow.emitRate = 70;
    snow.color1 = new Color4(0.9, 0.93, 1, 0.9);
    snow.color2 = new Color4(0.8, 0.85, 0.95, 0.7);
    snow.colorDead = new Color4(0.8, 0.85, 0.95, 0);
    snow.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    snow.start();

    // ── куча: металлолом горкой (кучи набора разного масштаба), бочки
    const R = (k: number) => {
      const x = Math.sin(k * 12.9898) * 43758.5453;
      return x - Math.floor(x);
    };
    for (let k = 0; k < 16; k++) {
      const a = R(k) * Math.PI * 2, r = (k < 4 ? 0.4 : 1.1 + R(k + 50) * 1.9) * (k < 4 ? R(k + 9) : 1);
      const x = HOLE.x + Math.cos(a) * r, z = HOLE.z + Math.sin(a) * r;
      const s = k < 4 ? 2.8 : 1.4 + R(k + 30) * 1.4;
      this.put('scrap', x, hangarGround(x, z) - 0.25 * s, z, R(k + 70) * 6.28, s);
    }
    for (const [x, z, r] of [[-4.6, -9.5, 0], [-4.0, -9.8, 0.6], [-4.4, -10.4, 1.3], [5.8, 2.5, 0], [6.2, 3.1, 1], [-6.5, 11.5, 0.4]] as [number, number, number][]) {
      this.put('barrel', x, 0, z, r);
      this.box(x - 0.3, z - 0.3, x + 0.3, z + 0.3);
    }

    // ── машины: всё крутится
    const spinOf = (h: TransformNode | null, name: string, axis: 'x' | 'y' | 'z', speed: number) => {
      const n = this.find(h, name);
      if (n) this.spin.push({ node: n, axis, speed });
    };
    // конвейеры вдоль западной стены
    for (const z of [0.5, 3.6]) {
      const h = this.put('conveyor', -5.6, 0, z, 0);
      for (let k = 0; k < 12; k++) spinOf(h, `roller_${String(k).padStart(2, '0')}`, 'x', 3);
    }
    this.box(-6.3, -2.6, -4.9, 3.7);
    this.put('press', -5.6, 0, 6.3, Math.PI / 2);
    this.box(-6.6, 5.4, -4.6, 7.2);
    // печь с ковшом и формами — у восточной стены (раскалённое — светится)
    this.put('furnace', 6.4, 0, -1.5, -Math.PI / 2);
    this.box(5.3, -2.8, HX, -0.2);
    this.put('ladle', 4.4, 0, 0.6, -Math.PI / 2);
    this.box(3.7, -0.4, 5.1, 1.6);
    for (const z of [2.6, 4.0]) {
      this.put('mold', 4.6, 0, z, 0);
      this.box(3.8, z - 0.45, 5.4, z + 0.45);
    }
    const heat = new PointLight('hangar:furnace', new Vector3(5.2, 1.2, -1.5), scene);
    heat.diffuse = new Color3(1, 0.42, 0.12);
    heat.specular = Color3.Black();
    heat.intensity = 1.6;
    heat.range = 9;
    this.lamps.push({ light: heat, base: 1.6, seed: 7 });
    // передача: шестерни, маховик, вал — у восточной стены за кучей
    const gears = this.put('gears', 5.6, 0, -8.6, -Math.PI / 2);
    spinOf(gears, 'drive_rotor', 'z', 1.2);
    spinOf(gears, 'driven_rotor', 'z', -2.4);
    this.box(4.9, -9.8, 6.4, -7.4);
    spinOf(this.put('flywheel', 5.8, 0, -11.2, -Math.PI / 2), 'flywheel_rotor', 'z', 0.9);
    this.box(5.4, -12.1, 6.2, -10.3);
    spinOf(this.put('shaft', 6.9, 0, -5.6, -Math.PI / 2), 'shaft_rotor', 'x', 2);
    this.box(6.6, -6.7, HX, -4.5);
    // вентиляторы в торцевой стене
    for (const x of [-4.5, 4.5]) spinOf(this.put('fan', x, 4.6, -HZ + 0.35, 0), 'fan_rotor', 'z', 4.5);
    // трубы по стенам под фермами
    for (let z = -HZ + 1; z < HZ - 2; z += 3) {
      this.put('pipe', -HX + 0.45, 6.4, z + 3, 0);
      this.put('pipe', HX - 0.45, 5.9, z + 3, 0);
    }

    // ── зона мини-босса: козловая таль над проходом к воротам, крюк качается, красный отсвет, табличка
    const hoist = this.put('hoist', 0, 0, BOSS_Z + 3, 0, 1.6);
    this.hook = this.find(hoist, 'hoist_hook');
    this.box(-2.75, BOSS_Z + 1.6, -2.25, BOSS_Z + 4.4);
    this.box(2.25, BOSS_Z + 1.6, 2.75, BOSS_Z + 4.4);
    const red = (this.bossLight = new PointLight('hangar:boss', new Vector3(0, 2.2, BOSS_Z + 3), scene));
    red.diffuse = new Color3(1, 0.12, 0.08);
    red.specular = Color3.Black();
    red.intensity = 0.0;
    red.range = 9;
    const signTex = new DynamicTexture('hangar:signTex', { width: 512, height: 128 }, scene, true);
    signTex.hasAlpha = true;
    const ctx = signTex.getContext() as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, 512, 128);
    ctx.fillStyle = 'rgba(20,6,6,0.85)';
    ctx.fillRect(0, 0, 512, 128);
    ctx.strokeStyle = '#a3261c';
    ctx.lineWidth = 6;
    ctx.strokeRect(4, 4, 504, 120);
    ctx.fillStyle = '#e6c9b8';
    ctx.font = 'bold 44px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(hangarBossSign(this.spec), 256, 66);
    signTex.update();
    const signMat = new StandardMaterial('hangar:signMat', scene);
    signMat.diffuseTexture = signTex;
    signMat.emissiveTexture = signTex;
    signMat.useAlphaFromDiffuseTexture = true;
    signMat.disableLighting = true;
    signMat.backFaceCulling = false;
    const sign = MeshBuilder.CreatePlane('hangar:sign', { width: 2.4, height: 0.6 }, scene);
    sign.material = signMat;
    sign.position.set(0, 5.1, BOSS_Z + 3);
    sign.isPickable = false;

    // ── ворота: шлагбаум (поднят наполовину), за ними двор под снегом
    const gate = this.put('gate', -1.8, 0, HZ + 0.6, 0);
    const arm = this.find(gate, 'gate_hinge');
    if (arm) arm.rotation.z = 0.5;
    const yard = MeshBuilder.CreateGround('hangar:yard', { width: 2 * HX, height: 10 }, scene);
    yard.position.set(0, 0.02, HZ + 5);
    yard.material = snowMat;
    yard.isPickable = false;
    for (const x of [-4.6, 4.6]) {
      const f = MeshBuilder.CreateBox('hangar:fence', { width: 0.12, height: 2.4, depth: 9 }, scene);
      f.position.set(x, 1.2, HZ + 4.8);
      f.material = darkSteel;
      f.isPickable = false;
    }

    // ── лампы: натриевые под фермами (часть мигает), конус-абажур и светящаяся колба
    const shade = new StandardMaterial('hangar:shade', scene);
    shade.diffuseColor = new Color3(0.12, 0.13, 0.12);
    const bulb = new StandardMaterial('hangar:bulb', scene);
    bulb.disableLighting = true;
    bulb.emissiveColor = SODIUM;
    const spots: [number, number, number][] = [[2, -10, 1], [-2, -2, 0.75], [2, 2.5, 1.1], [-2, 10, 0.5], [3, -5.5, 0.95]];
    spots.forEach(([x, z, base], k) => {
      const y = EAVES - 1.1;
      const cone = MeshBuilder.CreateCylinder('hangar:lampShade', { diameterTop: 0.12, diameterBottom: 0.6, height: 0.3, tessellation: 12 }, scene);
      cone.position.set(x, y, z);
      cone.material = shade;
      const b = MeshBuilder.CreateSphere('hangar:lampBulb', { diameter: 0.16, segments: 6 }, scene);
      b.position.set(x, y - 0.14, z);
      b.material = bulb;
      const wire = MeshBuilder.CreateCylinder('hangar:lampWire', { diameter: 0.015, height: EAVES - 0.3 - y }, scene);
      wire.position.set(x, (EAVES - 0.3 + y) / 2, z);
      wire.material = shade;
      for (const m of [cone, b, wire]) m.isPickable = false;
      const l = new PointLight('hangar:lamp' + k, new Vector3(x, y - 0.3, z), scene);
      l.falloffType = Light.FALLOFF_GLTF;
      l.diffuse = SODIUM;
      l.specular = SODIUM.scale(0.2);
      l.range = 14;
      l.intensity = 24 * base;
      this.lamps.push({ light: l, base: 24 * base, seed: k + 1 });
    });
    for (const m of scene.meshes) (m as AbstractMesh).isPickable = false;
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

  simulate(dt: number, input?: Input) {
    if (this.disposed || this.exited || !this.ready) return;
    this.time += dt;
    for (const s of this.spin) s.node.rotation[s.axis] += s.speed * dt;
    if (this.hook) this.hook.rotation.x = Math.sin(this.time * 0.7) * 0.12;
    for (const l of this.lamps) {
      // мигание: редкие провалы яркости (у каждой лампы своё)
      const f = Math.sin(this.time * (3 + l.seed) + l.seed * 7) * Math.sin(this.time * 0.37 * l.seed + l.seed);
      l.light.intensity = l.base * (f > 0.93 ? 0.25 : 1);
    }
    const was = { x: this.pos.x, z: this.pos.z };
    if (this.fallT !== null) {
      const t0 = this.fallT;
      this.fallT += dt;
      if (t0 < FALL_LAND_S && this.fallT >= FALL_LAND_S) this.audio.land();
      if (this.fallT >= FALL_TOTAL_S) {
        this.fallT = null;
        this.eyeY = HEAP_TOP + EYE;
        this.emitHud(true);
      }
    } else if (this.started || this.manual) this.move(dt, input ?? this.readKeys());
    const inBoss = this.pos.z > BOSS_Z;
    const ft = this.fallT;
    this.audio.update(dt, {
      pos: { x: this.pos.x, z: this.pos.z },
      yaw: this.camera.rotation.y,
      falling: ft !== null,
      fallK: ft !== null && ft > FALL_BREAK_S && ft < FALL_LAND_S ? (ft - FALL_BREAK_S) / (FALL_LAND_S - FALL_BREAK_S) : 0,
      speed: dt > 0 ? Math.hypot(this.pos.x - was.x, this.pos.z - was.z) / dt : 0,
      metal: hangarGround(this.pos.x, this.pos.z) > 0.2,
      boss: inBoss,
    });
    this.bossLight.intensity = (inBoss ? 1.4 : 0.5) * (0.75 + 0.25 * Math.sin(this.time * 2.1));
    if (inBoss && !this.bossSeen) {
      this.bossSeen = true;
      this.emitHud(true);
    }
    if (this.pos.z > EXIT_Z && !this.exited) {
      this.exited = true;
      if (document.pointerLockElement === this.canvas) document.exitPointerLock();
      this.emitHud(true);
      this.opts.onExit?.();
      return;
    }
    if (performance.now() - this.hudAt > 150) this.emitHud();
  }

  private move(dt: number, inp: Input) {
    const yaw = this.camera.rotation.y;
    const sp = inp.run ? RUN : WALK;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    let dx = (fx * inp.f + fz * inp.s) * sp * dt, dz = (fz * inp.f - fx * inp.s) * sp * dt;
    // по куче — медленнее (железо под ногами)
    if (hangarGround(this.pos.x, this.pos.z) > 0.2) {
      dx *= 0.6;
      dz *= 0.6;
    }
    const [x, z] = collide2(this.pos.x + dx, this.pos.z + dz, BODY_R, this.boxes);
    this.pos.x = x;
    this.pos.z = z;
    const target = hangarGround(x, z) + EYE;
    this.eyeY += (target - this.eyeY) * Math.min(1, dt * 10);
  }

  private sync() {
    const c = this.camera;
    if (this.fallT !== null) {
      const p = fallPose(this.fallT, EYE);
      const sh = p.shake * 0.08;
      c.position.set(this.pos.x + (Math.random() - 0.5) * sh, HEAP_TOP + p.y + (Math.random() - 0.5) * sh, this.pos.z + (Math.random() - 0.5) * sh);
      c.rotation.x = -p.pitch;
      c.rotation.z = p.roll;
      this.whiteMat.alpha = p.white;
      return;
    }
    this.whiteMat.alpha = 0;
    c.rotation.z = 0;
    c.position.set(this.pos.x, this.eyeY, this.pos.z);
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

  hud(): HangarHud {
    const near = this.pos.z > BOSS_Z;
    return {
      loading: !this.ready && !this.error,
      error: this.error,
      started: this.started,
      locked: this.locked,
      phase: this.exited ? 'exit' : this.fallT !== null ? 'fall' : 'walk',
      boss: near,
      sign: hangarBossSign(this.spec),
      prompt: near ? `${hangarBossSign(this.spec)} · ворота — дальше` : null,
    };
  }

  private emitHud(force = false) {
    if (!force && performance.now() - this.hudAt < 150) return;
    this.hudAt = performance.now();
    this.opts.onHud?.(this.hud());
  }

  // ───────────────────────── QA ─────────────────────────

  advance(sec: number, input: Input = { f: 0, s: 0, run: false }) {
    this.manual = true;
    for (let t = 0; t < sec - 1e-9; t += 1 / 60) this.simulate(Math.min(1 / 60, sec - t), input);
    this.sync();
  }

  place(x: number, z: number, yaw?: number, pitch?: number) {
    this.fallT = null;
    this.pos = { x, z };
    this.eyeY = hangarGround(x, z) + EYE;
    if (yaw !== undefined) this.camera.rotation.y = yaw;
    if (pitch !== undefined) this.camera.rotation.x = pitch;
    this.sync();
  }

  qaState() {
    return { pos: { ...this.pos }, eyeY: this.eyeY, fallT: this.fallT, exited: this.exited, heapTop: HEAP_TOP, hud: this.hud(), boxes: this.boxes.length, spin: this.spin.length };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('pointerlockchange', this.onLock);
    this.snow?.dispose();
    this.audio.dispose();
    this.scene.dispose();
    this.container = null;
  }
}
