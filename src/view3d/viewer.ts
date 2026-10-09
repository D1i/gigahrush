// Просмотрщик болванки на Babylon: движок, две камеры (облёт / от первого лица), свет, выбор комнаты,
// экспорт GLB. Без React — страница только вызывает методы и получает колбэки.
// Сцена — набор частей (ViewPart): обычно одна модель; складчатый прогон (src/view3d/fold.ts) ставит
// несколько — слои W «башней» друг над другом — или одну, но пересобирает её на каждом пороге.
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Viewport } from '@babylonjs/core/Maths/math.viewport';
import { Ray } from '@babylonjs/core/Culling/ray';
import { PointerEventTypes } from '@babylonjs/core/Events/pointerEvents';
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Material } from '@babylonjs/core/Materials/material';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import '@babylonjs/core/Collisions/collisionCoordinator';
import { buildBabylonBlockout, type BabylonBlockout, type BlockoutMeta } from '../blockout/babylon';
import { PropModels } from './propModels';
import { Posture, type Pose } from './posture';
import { Sprint } from './sprint';
import type { BlockoutModel, DeadEnd, Rect } from '../blockout/types';

export type CamMode = 'orbit' | 'fps';

export interface ViewerCallbacks {
  /** клик по полу/мебели в облёте: экземпляр или null */
  onPick?(inst: string | null): void;
  /** в режиме от первого лица — комната под ногами */
  onRoom?(inst: string | null): void;
  /** раз в ~0.5 с: кадры в секунду и draw calls */
  onStats?(fps: number, drawCalls: number): void;
  onPointerLock?(locked: boolean): void;
  /** догрузились модели предметов (props): болванки, построенные до этого, — с боксами; стоит пересобрать */
  onPropsReady?(): void;
  /** от первого лица: поза сменилась (C — на четвереньки / встать) или встать нельзя (note) */
  onPosture?(pose: Pose, note: string | null): void;
}

/** Глаза на 1.6 м: эллипсоид 0.3/0.85/0.3 с центром на 0.75 м ниже камеры → низ ровно у пола. */
const EYE = 1.6;
const ELLIPSOID = new Vector3(0.3, 0.85, 0.3);
const ELLIPSOID_OFFSET = new Vector3(0, ELLIPSOID.y * 2 - EYE, 0); // = 0.1 при EYE 1.6

/** Часть сцены: модель болванки, поднятая на y метров (Babylon Y). */
export interface ViewPart {
  model: BlockoutModel;
  y?: number;
  /** цвет панелей тупиков (BabylonBlockoutOptions.deadEndColor) */
  deadEndColor?: (d: DeadEnd) => string | null | undefined;
}

export interface ViewPartBuilt {
  model: BlockoutModel;
  bo: BabylonBlockout;
  y: number;
}

/** Своя сцена в том же движке (спец-локация, src/locations/): пока задана, рисуется вместо болванки. */
export interface ViewerOverlay {
  render(): void;
  /** включить/выключить своё управление (мышь, клавиши) */
  attach(): void;
  detach(): void;
}

export interface SetModelOptions {
  propTextures?: Record<string, string>;
  finishes?: boolean;
  spawnInst?: string | null;
  /** вписать облёт заново (и поставить игрока на спавн, если spawn не false) */
  refit?: boolean;
  spawn?: boolean;
}

export class BlockoutViewer {
  readonly engine: Engine;
  readonly scene: Scene;
  /** модели предметов из ассетов (подвал: стеллажи, трубы, лампочки…) — грузятся при создании просмотрщика */
  readonly props: PropModels;
  readonly orbit: ArcRotateCamera;
  readonly fps: UniversalCamera;
  /** поза от первого лица: стоя / скрючившись / на четвереньках (C) — src/view3d/posture.ts */
  readonly posture: Posture;
  /** бег (Shift) и выносливость от первого лица — src/view3d/sprint.ts; enabled ставит страница («Прогулка») */
  readonly sprint: Sprint;
  mode: CamMode = 'orbit';
  /** части сцены; bo и model — первая часть (для одной модели — она сама) */
  parts: ViewPartBuilt[] = [];
  bo: BabylonBlockout | null = null;
  model: BlockoutModel | null = null;

  private ro: ResizeObserver;
  private instr: SceneInstrumentation;
  private hl: { mesh: AbstractMesh; mat: Material | null } | null = null;
  private hlMat: StandardMaterial | null = null;
  private label: { el: HTMLElement; at: Vector3; inst: string } | null = null;
  private hlInst: string | null = null;
  private roomTimer = 0;
  private statTimer = 0;
  private lastRoom: string | null = null;
  private spawnInst: string | null = null;
  private disposed = false;
  /** спец-локация поверх: пока задана, движок рисует её, а камеры болванки не слушают ввод */
  private overlay: ViewerOverlay | null = null;
  private onLock = () => this.cb.onPointerLock?.(document.pointerLockElement === this.canvas);
  /** C — на четвереньки / встать (от первого лица, без спец-сцены поверх) */
  private onPoseKey = (e: KeyboardEvent) => {
    if (e.code !== 'KeyC' || e.repeat || e.ctrlKey || e.metaKey || e.altKey || this.mode !== 'fps' || this.overlay) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    this.posture.toggle();
  };

  constructor(
    private canvas: HTMLCanvasElement,
    readonly host: HTMLElement,
    private cb: ViewerCallbacks = {},
  ) {
    this.engine = new Engine(canvas, true, { stencil: true, preserveDrawingBuffer: false }, true);
    const scene = (this.scene = new Scene(this.engine));
    scene.clearColor = Color4.FromHexString('#0d0e10ff');
    scene.ambientColor = new Color3(0.12, 0.12, 0.12);
    scene.collisionsEnabled = true;
    scene.gravity = new Vector3(0, -9.81 / 60, 0);
    this.props = new PropModels(scene);
    void this.props.loaded.then(() => {
      if (!this.disposed && this.props.size) this.cb.onPropsReady?.();
    });
    // ховер-пикинг на каждое движение мыши не нужен: на 150 комнатах это ~1000 мешей
    scene.skipPointerMovePicking = true;

    // свет: мягкий «небесный» сверху + слабый направленный, чтобы грани стен различались
    const hemi = new HemisphericLight('hemi', new Vector3(0.15, 1, -0.25), scene);
    hemi.intensity = 0.85;
    hemi.groundColor = new Color3(0.62, 0.6, 0.58); // потолки и нижние грани освещены снизу
    hemi.specular = Color3.Black();
    const sun = new DirectionalLight('sun', new Vector3(-0.45, -1, 0.3), scene);
    sun.intensity = 0.38;
    sun.specular = Color3.Black();

    // облёт
    const orbit = (this.orbit = new ArcRotateCamera('orbit', -Math.PI / 2 - 0.45, 0.85, 30, Vector3.Zero(), scene));
    orbit.minZ = 0.5; // облицовка в 1.5 мм от стены: ближняя плоскость дальше — точнее глубина издалека
    orbit.maxZ = 4000;
    orbit.lowerRadiusLimit = 1;
    orbit.lowerBetaLimit = 0.02;
    orbit.upperBetaLimit = Math.PI / 2 - 0.02;
    orbit.wheelDeltaPercentage = 0.02;
    orbit.pinchDeltaPercentage = 0.002;
    orbit.inertia = 0.75;

    // от первого лица: WASD/стрелки + мышь, коллизии + гравитация
    const fps = (this.fps = new UniversalCamera('fps', new Vector3(0, EYE, 0), scene));
    fps.minZ = 0.05;
    fps.maxZ = 1000;
    fps.fov = 1.15;
    fps.speed = 0.22;
    fps.inertia = 0.6;
    fps.angularSensibility = 2200;
    fps.keysUp = [87, 38];
    fps.keysDown = [83, 40];
    fps.keysLeft = [65, 37];
    fps.keysRight = [68, 39];
    fps.ellipsoid = ELLIPSOID.clone();
    fps.ellipsoidOffset = ELLIPSOID_OFFSET.clone();
    fps.checkCollisions = true;
    fps.applyGravity = true;
    this.posture = new Posture(scene, fps, () => this.mode === 'fps' && !this.overlay);
    this.posture.onChange = (p, note) => this.cb.onPosture?.(p, note);
    // бег — после позы: её наблюдатель кадра раньше (cam.speed позы → ×бег)
    this.sprint = new Sprint(scene, fps, this.posture, () => this.mode === 'fps' && !this.overlay);
    window.addEventListener('keydown', this.onPoseKey);

    scene.activeCamera = orbit;
    orbit.attachControl(true);

    this.instr = new SceneInstrumentation(scene);
    this.instr.captureFrameTime = false;

    // клик по полу в облёте → подпись комнаты; клик в FPS → захват мыши
    scene.onPointerObservable.add((pi) => {
      if (pi.type === PointerEventTypes.POINTERDOWN) canvas.focus();
      if (pi.type !== PointerEventTypes.POINTERTAP || this.overlay) return;
      if (this.mode === 'fps') {
        if (!this.engine.isPointerLock) this.engine.enterPointerlock();
        return;
      }
      const hit = scene.pick(scene.pointerX, scene.pointerY, (m) => m.isVisible && m.isEnabled() && !!m.metadata);
      const inst = hit?.hit ? (this.bo?.instOf(hit.pickedMesh) ?? null) : null;
      this.highlight(inst);
      this.cb.onPick?.(inst);
    });
    document.addEventListener('pointerlockchange', this.onLock);

    scene.onAfterRenderObservable.add(() => this.afterRender());
    this.engine.runRenderLoop(() => {
      if (this.overlay) {
        this.overlay.render();
        this.overlayStats();
      } else if (scene.activeCamera) scene.render();
    });

    this.ro = new ResizeObserver(() => this.engine.resize());
    this.ro.observe(host);
  }

  /**
   * Показать свою сцену (спец-локацию) вместо болванки или вернуть болванку (null). Камера болванки на
   * это время отключается от ввода; сцена болванки не рисуется и не обновляется (физика стоит).
   */
  setOverlay(o: ViewerOverlay | null) {
    if (o === this.overlay || this.disposed) return;
    const cam = this.mode === 'fps' ? this.fps : this.orbit;
    if (this.overlay) this.overlay.detach();
    if (o && !this.overlay) cam.detachControl();
    this.overlay = o;
    if (o) o.attach();
    else {
      cam.attachControl(true);
      this.fps.cameraDirection.setAll(0);
      this.fps.cameraRotation.set(0, 0);
    }
    this.canvas.focus();
  }

  get hasOverlay(): boolean {
    return !!this.overlay;
  }

  private overlayStats() {
    const now = performance.now();
    if (now - this.statTimer > 500) {
      this.statTimer = now;
      this.cb.onStats?.(this.engine.getFps(), 0);
    }
  }

  /** Перестроить сцену по модели. refit — заново вписать камеру и поставить игрока на спавн. */
  setModel(model: BlockoutModel | null, o: SetModelOptions = {}) {
    this.setParts(model ? [{ model }] : [], o);
  }

  /**
   * Перестроить сцену по частям. Новые меши строятся ДО удаления старых: текстуры отделки и мебели
   * (data:URI) берутся из кэша движка готовыми — при пересборке на пороге стены не мигают.
   * Без refit камера и игрок остаются на месте, подсветка и подпись — если комната есть в новых частях.
   */
  setParts(parts: ViewPart[], o: SetModelOptions = {}) {
    this.commitParts(this.prepareParts(parts, o), o);
  }

  /**
   * Построить части СКРЫТЫМИ (root выключен): их можно подменить позже через commitParts, когда
   * partsReady — так на пороге складчатого прогона новый набор появляется целиком в одном кадре.
   */
  prepareParts(parts: ViewPart[], o: SetModelOptions = {}): ViewPartBuilt[] {
    return parts.map((p) => {
      const bo = buildBabylonBlockout(this.scene, p.model, {
        collisions: true,
        propTextures: o.propTextures,
        finishes: o.finishes !== false,
        deadEndColor: p.deadEndColor,
        propModel: (id) => this.props.get(id),
      });
      const y = p.y ?? 0;
      bo.root.position.y = y;
      bo.root.computeWorldMatrix(true);
      bo.setCeilingsVisible(this.mode === 'fps');
      // статичная геометрия — мировые матрицы не пересчитываем каждый кадр
      for (const m of bo.root.getChildMeshes(false)) m.freezeWorldMatrix();
      bo.root.setEnabled(false);
      return { model: p.model, bo, y };
    });
  }

  /** Готовы ли меши частей к отрисовке (шейдеры собраны, текстуры загружены). Не готовый меш Babylon
   *  пропускает в кадре — при подмене набора он бы «появился» на кадр позже остальных. */
  partsReady(built: ViewPartBuilt[]): boolean {
    for (const p of built) for (const m of p.bo.root.getChildMeshes(false)) if (!m.isReady(true)) return false;
    return true;
  }

  /** Удалить подготовленные, но не показанные части. */
  discardParts(built: ViewPartBuilt[]) {
    for (const p of built) p.bo.dispose();
  }

  /** Показать подготовленные части вместо текущих (старые удаляются после включения новых). */
  commitParts(built: ViewPartBuilt[], o: SetModelOptions = {}) {
    for (const p of built) p.bo.root.setEnabled(true);
    const hl = this.hlInst;
    const label = this.label;
    this.clearModel();
    this.parts = built;
    this.bo = built[0]?.bo ?? null;
    this.model = built[0]?.model ?? null;
    if (!built.length) return;
    if (o.spawnInst !== undefined) this.spawnInst = o.spawnInst;
    if (o.refit !== false) {
      this.fit();
      if (o.spawn !== false) this.spawn();
    } else {
      if (hl) this.highlight(hl);
      if (label) this.setLabel(label.el, label.inst);
    }
  }

  private clearModel() {
    this.highlight(null);
    this.label = null;
    this.hlMat?.dispose();
    this.hlMat = null;
    for (const p of this.parts) p.bo.dispose();
    this.parts = [];
    this.bo = null;
    this.model = null;
    this.lastRoom = null;
  }

  /** Часть сцены, в которой есть комната inst. */
  partOf(inst: string | null): ViewPartBuilt | null {
    if (!inst) return null;
    return this.parts.find((p) => p.model.rooms.some((r) => r.inst === inst)) ?? null;
  }

  /** дальность тумана, м (0 — без тумана); действует только от первого лица */
  private fogDist = 0;

  /**
   * Туман на дальности обзора: взгляд «вязнет» к пределу sightM — пространство будто само не даёт
   * смотреть вдаль. Необязательная атмосфера (по умолчанию страница его не включает); обязателен только
   * для рендера «Набор (PVS)»: набор отсекает всё дальше sightM, а косые линии обзора бывают длиннее —
   * за пределом должно быть непрозрачно. Плотнеет с 45% дальности до полной темноты РОВНО на пределе.
   * Цвет тумана = цвет фона (clearColor), поэтому туман и «темнота» открытых проёмов на краю PVS — одно
   * и то же. Портальный рендер сам видит туман сцены и не открывает проёмы за ним. В облёте выключен.
   */
  setFog(distM: number) {
    this.fogDist = distM > 0 ? distM : 0;
    this.applyFog();
  }

  private applyFog() {
    const s = this.scene;
    if (this.mode === 'fps' && this.fogDist > 0) {
      s.fogMode = Scene.FOGMODE_LINEAR;
      s.fogStart = this.fogDist * 0.45;
      s.fogEnd = this.fogDist;
      const c = s.clearColor;
      s.fogColor = new Color3(c.r, c.g, c.b);
    } else {
      s.fogMode = Scene.FOGMODE_NONE;
    }
  }

  setMode(mode: CamMode) {
    if (mode === this.mode) return;
    const from = mode === 'fps' ? this.orbit : this.fps;
    const to = mode === 'fps' ? this.fps : this.orbit;
    from.detachControl();
    if (mode === 'orbit' && document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.mode = mode;
    this.scene.activeCamera = to;
    to.attachControl(true);
    for (const p of this.parts) p.bo.setCeilingsVisible(mode === 'fps');
    if (mode === 'fps') {
      this.highlight(null);
      this.label = null;
    } else this.lastRoom = null;
    this.applyFog();
    this.canvas.focus();
  }

  /** Вписать облёт в габариты модели (всех частей, с их высотой). */
  fit() {
    const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    let z0 = Infinity, z1 = -Infinity;
    for (const p of this.parts) {
      const m = p.model.bounds;
      if (!(m.x1 > m.x0)) continue;
      b.x0 = Math.min(b.x0, m.x0);
      b.y0 = Math.min(b.y0, m.y0);
      b.x1 = Math.max(b.x1, m.x1);
      b.y1 = Math.max(b.y1, m.y1);
      z0 = Math.min(z0, p.y);
      z1 = Math.max(z1, p.y + p.model.options.wallHeightM);
    }
    if (b.x0 === Infinity) return;
    const w = b.x1 - b.x0;
    const d = b.y1 - b.y0;
    const h = z1 - z0;
    // башня слоёв: смотрим сбоку на середину высоты
    const tall = h > 2 * this.parts[0].model.options.wallHeightM;
    const small = Math.max(w, d) < 10 && !tall;
    const r = 0.5 * Math.hypot(w, d, h);
    const aspect = this.engine.getAspectRatio(this.orbit) || 1;
    const half = Math.min(this.orbit.fov / 2, Math.atan(Math.tan(this.orbit.fov / 2) * aspect));
    // сфера консервативна для плоской карты под наклоном — для больших карт поджимаем
    const radius = (r / Math.sin(half)) * (small ? 1 : 0.88);
    this.orbit.setTarget(new Vector3((b.x0 + b.x1) / 2, tall ? (z0 + z1) / 2 : small ? z0 + h / 2 : z0, -(b.y0 + b.y1) / 2));
    this.orbit.alpha = -Math.PI / 2 - 0.45;
    // одну комнату — почти сверху, иначе стены 2.5 м закрывают пол; башню — сбоку
    this.orbit.beta = small ? 0.35 : tall ? 1.15 : 0.85;
    this.orbit.radius = radius;
    this.orbit.upperRadiusLimit = radius * 4;
    this.orbit.panningSensibility = Math.max(4, 900 / radius);
  }

  /** Поставить игрока в стартовую комнату: свободная точка у anchor, взгляд на ближайший проём. */
  spawn() {
    if (this.model) this.spawnIn(this.model, this.spawnInst);
  }

  /** То же по заданной модели (портальный рендер: кусок комнаты, обычных частей на сцене нет). */
  spawnIn(m: BlockoutModel, inst: string | null) {
    if (!m.rooms.length) return;
    const room = m.rooms.find((r) => r.inst === inst) ?? m.rooms[0];
    const floor = m.floors.filter((f) => f.inst === room.inst);
    const rects = floor.flatMap((f) => f.rects);
    const z = floor[0]?.z ?? 0;
    const props = m.props
      .filter((p) => p.inst === room.inst)
      .map((p) => {
        const q = Math.abs(Math.round(p.rot / 90)) % 2 === 1;
        const hw = (q ? p.d : p.w) / 2 + 0.35;
        const hd = (q ? p.w : p.d) / 2 + 0.35;
        return { x0: p.x - hw, y0: p.y - hd, x1: p.x + hw, y1: p.y + hd };
      });
    const free = (x: number, y: number) =>
      rects.some((r) => x > r.x0 + 0.35 && x < r.x1 - 0.35 && y > r.y0 + 0.35 && y < r.y1 - 0.35) &&
      !props.some((r) => x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1);
    let [sx, sy] = room.anchor;
    if (!free(sx, sy)) {
      let best: [number, number] | null = null;
      let bd = Infinity;
      for (const r of rects)
        for (let x = r.x0 + 0.4; x < r.x1 - 0.35; x += 0.2)
          for (let y = r.y0 + 0.4; y < r.y1 - 0.35; y += 0.2) {
            const dd = Math.hypot(x - sx, y - sy);
            if (dd < bd && free(x, y)) {
              bd = dd;
              best = [x, y];
            }
          }
      if (best) [sx, sy] = best;
    }
    this.fps.position.set(sx, z + this.posture.eye + 0.05, -sy);
    // смотреть на ближайший проём комнаты, иначе через всю комнату — на самую дальнюю точку пола
    const op = m.openings
      .filter((o) => o.a.inst === room.inst || o.b.inst === room.inst)
      .map((o) => center(o.rect))
      .sort((a, b) => Math.hypot(a[0] - sx, a[1] - sy) - Math.hypot(b[0] - sx, b[1] - sy))[0];
    const far = rects
      .flatMap((r): [number, number][] => [center(r), [r.x0 + 0.3, r.y0 + 0.3], [r.x1 - 0.3, r.y0 + 0.3], [r.x0 + 0.3, r.y1 - 0.3], [r.x1 - 0.3, r.y1 - 0.3]])
      .sort((a, b) => Math.hypot(b[0] - sx, b[1] - sy) - Math.hypot(a[0] - sx, a[1] - sy))[0];
    const look = op ?? far ?? [sx + 1, sy];
    this.fps.setTarget(new Vector3(look[0], z + this.posture.eye - 0.1, -look[1]));
    this.fps.cameraDirection.setAll(0);
  }

  /** Выбранный экземпляр: подсветка пола и подпись над anchor. */
  highlight(inst: string | null) {
    if (this.hl) {
      this.hl.mesh.material = this.hl.mat;
      this.hl = null;
    }
    this.hlInst = inst;
    const part = this.partOf(inst);
    if (!inst || !part) return;
    const mesh = part.bo.floors.find((f) => part.bo.instOf(f) === inst);
    if (!mesh) return;
    // материал подсветки — по текущему материалу пола (сетка или отделка); не clone(): он копирует
    // текстуру, а она потом утекает — делим ту же
    const src = mesh.material as StandardMaterial | null;
    this.hlMat?.dispose();
    const hm = (this.hlMat = new StandardMaterial('blockout:floorHL', this.scene));
    if (src) {
      hm.diffuseColor = src.diffuseColor.clone();
      hm.diffuseTexture = src.diffuseTexture;
      hm.specularColor = src.specularColor.clone();
    }
    hm.emissiveColor = new Color3(0.6, 0.38, 0.06);
    this.hl = { mesh, mat: mesh.material };
    mesh.material = this.hlMat;
  }

  /** Точка плана (м) → пиксели холста (CSS). null — за камерой. */
  projectPlan(x: number, y: number, z = 0): [number, number] | null {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const p = Vector3.Project(new Vector3(x, z, -y), Matrix.IdentityReadOnly, this.scene.getTransformMatrix(), new Viewport(0, 0, w, h));
    return p.z > 0 && p.z < 1 ? [p.x, p.y] : null;
  }

  /** Подписать комнату: el позиционируется над anchor каждый кадр. */
  setLabel(el: HTMLElement | null, inst: string | null) {
    const part = this.partOf(inst);
    const r = part?.model.rooms.find((x) => x.inst === inst);
    if (!el || !part || !r || !inst) {
      this.label = null;
      if (el) el.style.display = 'none';
      return;
    }
    const z = part.model.floors.find((f) => f.inst === inst)?.z ?? 0;
    this.label = { el, at: new Vector3(r.anchor[0], part.y + z + 0.3, -r.anchor[1]), inst };
  }

  private afterRender() {
    const now = performance.now();
    if (this.label && this.mode === 'orbit') {
      const a = this.label.at;
      const p = this.projectPlan(a.x, -a.z, a.y);
      const w = this.canvas.clientWidth;
      const h = this.canvas.clientHeight;
      const vis = !!p && p[0] > -50 && p[0] < w + 50 && p[1] > -50 && p[1] < h + 50;
      this.label.el.style.display = vis ? '' : 'none';
      if (p) this.label.el.style.transform = `translate(${Math.round(p[0])}px, ${Math.round(p[1])}px)`;
    }
    if (this.mode === 'fps' && now - this.roomTimer > 250) {
      this.roomTimer = now;
      const ray = new Ray(this.fps.position.clone(), new Vector3(0, -1, 0), 5);
      const hit = this.scene.pickWithRay(ray, (m) => (m.metadata as BlockoutMeta | null)?.kind === 'floor');
      const inst = hit?.hit ? (this.bo?.instOf(hit.pickedMesh) ?? null) : null;
      if (inst !== this.lastRoom) {
        this.lastRoom = inst;
        this.cb.onRoom?.(inst);
      }
    }
    if (now - this.statTimer > 500) {
      this.statTimer = now;
      this.cb.onStats?.(this.engine.getFps(), this.instr.drawCallsCounter.current);
    }
  }

  /** GLB только болванки (все части сцены, без камер и света), metadata → glTF extras. */
  async exportGLB(name = 'blockout'): Promise<Blob> {
    const parts = this.parts.slice();
    if (!parts.length) throw new Error('Сцена пуста');
    const { GLTF2Export } = await import('@babylonjs/serializers/glTF/2.0/glTFSerializer');
    await warmUpImageEncoder();
    const hl = this.hlInst;
    this.highlight(null);
    for (const p of parts) p.bo.setCeilingsVisible(true);
    const roots = parts.map((p) => p.bo.root);
    try {
      const data = await GLTF2Export.GLBAsync(this.scene, name, {
        shouldExportNode: (n) => roots.some((r) => n === r || n.isDescendantOf(r)),
        metadataSelector: (md: BlockoutMeta | null) => (md && md.kind ? { ...md } : undefined),
      });
      const blob = data.files[name + '.glb'];
      if (!(blob instanceof Blob)) throw new Error('экспорт не вернул .glb');
      return blob;
    } finally {
      for (const p of this.parts) p.bo.setCeilingsVisible(this.mode === 'fps');
      if (hl) this.highlight(hl);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    document.removeEventListener('pointerlockchange', this.onLock);
    window.removeEventListener('keydown', this.onPoseKey);
    this.sprint.dispose();
    this.posture.dispose();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.ro.disconnect();
    this.engine.stopRenderLoop();
    this.overlay = null;
    this.clearModel();
    this.instr.dispose();
    this.props.dispose();
    this.scene.dispose();
    this.engine.dispose();
  }
}

const center = (r: Rect): [number, number] => [(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2];

/** Экспортёр glTF кодирует текстуры в PNG через служебный движок dumpTools; в Babylon 9.29 при
 *  точечных импортах его шейдер не готов («reading 'program'»). Регистрируем шейдер и прогреваем 1×1. */
async function warmUpImageEncoder() {
  // вершинный шейдер служебного прохода не регистрируется сам — без него Babylon пытается скачать .fx
  await import('@babylonjs/core/Shaders/postprocess.vertex');
  const { EncodeImageAsync } = await import('@babylonjs/core/Misc/dumpTools');
  for (let k = 0; k < 20; k++) {
    try {
      await EncodeImageAsync(new Uint8Array([255, 255, 255, 255]), 1, 1, 'image/png');
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
}
