// Сцена спец-локации «Фрактальная станция» (Babylon) — своя Scene в движке вкладки «3D» (BlockoutViewer.setOverlay),
// как sceneHangar.ts. Станция-тессеракт под метро: ячейка P³ (./fractalCell.ts) повторяется во все стороны, все
// поверхности — полы, гравитация — к любой из 6 осей (упёрся в стену — она стала полом), сорвался — приземлился в повторе.
//
//  • Мир сцены = ячейка игрока [0, P)³; физика (./fractalPhysics.ts) оборачивает тело, при обёртке двигать нечего — всё
//    периодично; от абсолютной ячейки зависят только выходные копии (сверхпериод 3P) и напарники.
//  • Меши и копии — ./fractalView.ts; свои копии и напарники — ./fractalCopies.ts; звук — ./fractalAudio.ts.
//  • Камера — UniversalCamera без встроенного ввода (он предполагает Y-up): поворот — из базиса camPose (right, up, fwd),
//    тряска (удар, срыв) — шум позиции и крен. Мышь — свой mousemove при захвате, клавиши — свой набор (как ангар):
//    WASD/стрелки, Shift — бегом, E — перелезть через балюстраду.
//  • Свет — HemisphericLight по текущему up (за поворотом кадра мир «переосвещается»), туман LINEAR в чёрное, главный
//    свет — эмиссив световых линий и ядер (+ GlowLayer только на них; fps < 50 — выключается).
//  • Эскалаторы — ./fractalEsc.ts (срыв всего эскалатора во всех копиях); кооп — fx 'frPos' (поза ~10 Гц) и 'frEsc'
//    (срыв), без правок протокола и presence.
//  • Смерти нет: удар (тряска, оглушение, затемнение), страховка rescue — перенос на ближайшую стоячую точку.
import { Scene } from '@babylonjs/core/scene';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
import { GlowLayer } from '@babylonjs/core/Layers/glowLayer';
import '@babylonjs/core/Layers/effectLayerSceneComponent';
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
import { PointerEventTypes } from '@babylonjs/core/Events/pointerEvents';
import type { Engine } from '@babylonjs/core/Engines/engine';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { CoopSession } from '../coop/session';
import type { ViewerOverlay } from '../view3d/viewer';
import { PropModels } from '../view3d/propModels';
import metroUrl from '../view3d/assets/metro_props.glb?url';
import { hashSeed } from '../model/rng';
import { AXIS_VEC, FRAME, FR_ARRIVAL_CELL, axisIdx, axisSign, mod, opp, type Axis6, type V3 } from './fractalAxes';
import { axisRay, buildFractalCell, exitCopies, footVox, navPocket, standable, vidx, type FractalCell } from './fractalCell';
import { canHop, bodyPose, camPose, createBody, placeBody, pushShare, stepBody, yawToward, FRP, type FrBody, type FrEnv, type FrEvent, type FrInput } from './fractalPhysics';
import { collapsePose, createEscWorld, startCollapse, stepEscWorld, type FrEscEvent, type FrEscWorld } from './fractalEsc';
import { ESC } from './metroEscalator';
import { FractalView, LIGHT_R, boxCenter, type FrViewEsc } from './fractalView';
import { FractalCopies, SHIFTS, lineOfSight, nearestImage, yawFwd } from './fractalCopies';
import { FractalAudio, type FrAudioPt } from './fractalAudio';

export interface FractalHud {
  /** мышь захвачена */
  locked: boolean;
  /** всё загружено */
  ready: boolean;
  /** клик «войти» был (begin) */
  started: boolean;
  error: string | null;
  up: Axis6;
  cell: V3;
  ground: 'floor' | 'ramp' | 'air';
  /** 0…1 — упор в стену (кольцо-подсказка «стена становится полом») */
  pushing: number;
  ride: { kind: 'main' | 'pav' | 'exit'; dir: 1 | 0 | -1 } | null;
  /** срыв эскалатора под игроком / рядом */
  alarm: 'shudder' | 'runaway' | 'fall' | null;
  /** E — перелезть через балюстраду (runaway) */
  canHop: boolean;
  /** м до открытой ниши ближайшей выходной копии */
  exitNear: number | null;
  /** последний удар (~1 с) */
  landed: 0 | 1 | 2;
  hint: string | null;
  sound: boolean;
  fps: number;
  /** сколько копий себя сейчас видно */
  selfSeen: number;
  mates: number;
}

export interface FractalSceneOptions {
  /** = запрос слоя seedKey (locKey(s, id)) — одинаков у всех игроков мира */
  seedKey: string;
  /** не чаще 150 мс */
  onHud(h: FractalHud): void;
  /** вошёл в открытую нишу (один раз) */
  onExit(): void;
  sound: boolean;
  co?: CoopSession | null;
  /** цвет шинели своего аватара (PlayerInfo.slot) */
  slot?: number;
}

export interface FractalQaState {
  up: Axis6;
  cell: V3;
  pos: V3;
  ground: 'floor' | 'ramp' | 'air';
  ride: { esc: number; lane: number; s: number } | null;
  push: number;
  turn: { from: Axis6; to: Axis6; t: number } | null;
  stun: number;
  esc: { runs: { esc: number; stage: string; t: number }[]; broken: number[] };
  exitNear: number | null;
  fps: number;
  selfSeen: number;
  selfShifts: V3[];
  mates: number;
  exited: boolean;
  yaw: number;
  pitch: number;
  hud: FractalHud;
  /** переносов страховкой «застрял» (замкнутый карман — щель «станции 6») */
  pockets: number;
  /** кандидаты фонового срыва сейчас (без эскалатора, на котором едешь) */
  bgNear: number[];
  /** версия маски взгляда копий (+1 на снятый срыв) */
  sightVer: number;
}

export interface FractalQa {
  state(): FractalQaState;
  place(at: V3, up: Axis6, yaw?: number, cell?: V3): void;
  turnTo(up: Axis6): boolean;
  forceCollapse(esc?: number): number | null;
  /** к открытой нише ближайшей выходной копии (на площадку, лицом к нише) */
  toExit(): void;
  /** в известную точку, откуда видна своя копия, лицом к ней */
  seeSelf(): boolean;
  stats(): { meshes: number; drawCalls: number; tris: number; thin: number; props: number; propIds: number; missingProps: string[]; escNear: number; glow: boolean; fps: number; trisBy: Record<string, number> };
  /** шаги только отсюда: s секунд с вводом (по умолчанию — без ввода) */
  advance(s: number, inp?: Partial<FrInput>): void;
  /** вернуть живой цикл (после advance) */
  live(): void;
  /** зажать клавиши (QA: «зажатой W») — коды KeyboardEvent.code */
  hold(codes: string[]): void;
  look(yaw: number, pitch: number): void;
  setGlow(on: boolean): void;
  cell(): FractalCell;
}

/** Мышь: рад на пиксель (как angularSensibility прогулки 2200). */
const MOUSE_K = 1 / 2200;
/** Тряска камеры: шум позиции на единицу тряски, м; крен, рад. */
const SHAKE_POS = 0.04;
const SHAKE_ROLL = (2 * Math.PI) / 180;
/** Кооп: поза — раз в столько с; напарник без пакетов — убрать (в fractalCopies). */
const NET_S = 0.1;
/** LOOK: туман EXP в чёрное, плотность на метр (было LINEAR 0.15·P…1.95·P — повторы тонули за ячейку): длинный хвост —
 *  20 м 0.84, 54 м 0.63, 108 м 0.4, 162 м 0.25; каркас дальних копий — та же кривая со своим гашением к краю (fractalView). */
export const FR_FOG = 0.0085;
/** Страховка «застрял» (INTEGRATE): узлов меньше — замкнутый карман графа ходьбы; столько с в нём — перенос. */
const POCKET_CAP = 400;
const POCKET_S = 2.5;
const HINTS = {
  push: 'Упрись в стену — она станет полом',
  fall: 'Сорвёшься — упадёшь в повтор',
  hop: 'E — перелезть через балюстраду',
} as const;

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export class FractalScene implements ViewerOverlay {
  readonly scene: Scene;
  readonly camera: UniversalCamera;
  ready = false;
  error: string | null = null;
  cell!: FractalCell;
  env!: FrEnv;
  escW!: FrEscWorld;
  body!: FrBody;
  view: FractalView | null = null;
  copies: FractalCopies | null = null;
  props: PropModels | null = null;
  readonly audio: FractalAudio;
  /** QA: шаги только из advance */
  manual = false;

  private glow: GlowLayer | null = null;
  private glowAuto = true;
  private hemi: HemisphericLight;
  private dark: Mesh;
  private darkMat: StandardMaterial;
  /** затемнение: удар (0.25 с + спад), перенос (rescue) */
  private darkT = 0;
  private darkK = 0;
  private instr: SceneInstrumentation;
  private started = false;
  private locked = false;
  private exited = false;
  private keys = new Set<string>();
  private held: string[] = [];
  private mdx = 0;
  private mdy = 0;
  private hudAt = 0;
  private last = 0;
  private time = 0;
  private turns = 0;
  private turnedAt = -1;
  private landed: 0 | 1 | 2 = 0;
  private landedAt = -10;
  private rideStart: { esc: number; lane: number } | null = null;
  private remoteStarts = new Set<number>();
  private netAt = 0;
  private echoAt = 0;
  private echoM: number | null = null;
  private fpsLow = 0;
  /** страховка «застрял»: узел ступни (vidx·6 + up) и число сломанных, для которых считан карман */
  private pocketNode = -1;
  private pocketBroken = -1;
  private pocketHit = false;
  private pocketT = 0;
  private pockets = 0;
  private readonly q = new Quaternion();
  private readonly vr = new Vector3();
  private readonly vu = new Vector3();
  private readonly vf = new Vector3();
  private readonly seedTag: string;
  private disposed = false;
  private onKey = (e: KeyboardEvent) => this.key(e);
  private onBlur = () => this.keys.clear();
  private onLock = () => {
    this.locked = document.pointerLockElement === this.canvas;
    if (!this.locked) {
      this.mdx = this.mdy = 0;
      this.keys.clear();
    }
    this.emitHud(true);
  };
  private onMouse = (e: MouseEvent) => {
    if (!this.locked) return;
    this.mdx += e.movementX || 0;
    this.mdy += e.movementY || 0;
  };
  private onFx = (from: string, k: string, d: unknown) => this.fx(from, k, d);

  private constructor(
    readonly engine: Engine,
    readonly canvas: HTMLCanvasElement,
    private readonly opts: FractalSceneOptions,
  ) {
    this.seedTag = (hashSeed(opts.seedKey) >>> 0).toString(36);
    this.audio = new FractalAudio(opts.sound !== false);
    const scene = (this.scene = new Scene(engine));
    scene.clearColor = new Color4(0, 0, 0, 1);
    scene.ambientColor = new Color3(0, 0, 0);
    scene.skipPointerMovePicking = true;
    scene.fogMode = Scene.FOGMODE_EXP;
    scene.fogDensity = FR_FOG;
    scene.fogColor = new Color3(0, 0, 0);
    const ip = scene.imageProcessingConfiguration;
    ip.toneMappingEnabled = true;
    ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    // LOOK: экспозиция 1.35 → 1.6, виньетка 1.8 → 1.15 (края кадра были чёрными — средняя яркость 22–52 из 255)
    ip.exposure = 1.6;
    ip.contrast = 1.12;
    ip.vignetteEnabled = true;
    ip.vignetteWeight = 1.15;
    ip.vignetteColor = new Color4(0, 0, 0, 0);
    ip.vignetteBlendMode = ImageProcessingConfiguration.VIGNETTEMODE_MULTIPLY;

    const cam = (this.camera = new UniversalCamera('fr:eye', new Vector3(0, FRP.eye, 0), scene));
    cam.inputs.clear();
    cam.minZ = 0.05;
    cam.maxZ = 160;
    cam.fov = 1.15;
    cam.speed = 0;
    cam.rotationQuaternion = Quaternion.Identity();
    scene.activeCamera = cam;

    this.hemi = new HemisphericLight('fr:amb', new Vector3(0, 1, 0), scene);
    // LOOK: 0.55 → 0.76, чуть теплее (торшеры, бронза); низ — 0.24 → 0.42 тёплый «отсвет пола»: над головой полмира, и
    // низы станций и коробов были плоскими чёрными плитами
    this.hemi.diffuse = new Color3(0.76, 0.73, 0.69);
    this.hemi.groundColor = new Color3(0.42, 0.39, 0.36);
    this.hemi.specular = Color3.Black();

    // затемнение — плашка перед камерой
    this.darkMat = new StandardMaterial('fr:dark', scene);
    this.darkMat.disableLighting = true;
    this.darkMat.emissiveColor = Color3.Black();
    this.darkMat.diffuseColor = Color3.Black();
    this.darkMat.alpha = 0;
    this.darkMat.disableDepthWrite = true;
    this.dark = MeshBuilder.CreatePlane('fr:darkout', { size: 2 }, scene);
    this.dark.material = this.darkMat;
    this.dark.parent = cam;
    this.dark.position.set(0, 0, 0.1);
    this.dark.renderingGroupId = 1;
    this.dark.isPickable = false;
    this.dark.applyFog = false;
    this.dark.setEnabled(false);

    this.instr = new SceneInstrumentation(scene);
    this.instr.captureFrameTime = false;

    scene.onPointerObservable.add((pi) => {
      if (pi.type !== PointerEventTypes.POINTERDOWN) return;
      canvas.focus();
      void this.begin();
    });
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('pointerlockchange', this.onLock);
    document.addEventListener('mousemove', this.onMouse);
    scene.onBeforeRenderObservable.add(() => this.beforeRender());
  }

  static async create(engine: Engine, canvas: HTMLCanvasElement, opts: FractalSceneOptions): Promise<FractalScene> {
    const s = new FractalScene(engine, canvas, opts);
    s.emitHud(true);
    try {
      await s.load();
      s.ready = !s.disposed;
    } catch (e) {
      console.error(e);
      s.error = 'Не удалось собрать станцию: ' + String((e as Error)?.message ?? e);
    }
    s.emitHud(true);
    return s;
  }

  private async load() {
    // кадр чёрной заглушки — до тяжёлой сборки
    await new Promise((r) => setTimeout(r, 0));
    if (this.disposed) return;
    const cell = (this.cell = buildFractalCell(this.opts.seedKey));
    const P = cell.P;
    // LOOK: туман EXP (FR_FOG): ближние и дальние копии читаются тускнеющими силуэтами, кольцо |k| = 3 гаснет к краю;
    // свет (линии, ядра, струны) — без тумана, своя кривая до LIGHT_R ячеек (fractalFade.ts)
    this.camera.maxZ = (LIGHT_R + 0.3) * P;
    this.escW = createEscWorld(cell, this.opts.seedKey);
    this.env = { cell, esc: this.escW };
    this.body = createBody(cell.arrival, FR_ARRIVAL_CELL);
    const view = (this.view = new FractalView(this.scene, cell));
    view.setCell(this.body.cell);
    // свечение — только линии, ядра, ниша, плафоны
    // свечение: линии, ядра, ниша; ближняя геометрия — заслон (чёрным), иначе ядра всех копий светят сквозь стены
    const glow = (this.glow = new GlowLayer('fr:glow', this.scene, { mainTextureRatio: 0.5, blurKernelSize: 24 }));
    glow.intensity = 0.55;
    const lit = new Set(view.glowMeshes.map((m) => m.uniqueId));
    glow.customEmissiveColorSelector = (mesh, _sub, mat, res) => {
      // metadata.glow — у мешей с картинкой в emissiveTexture (ниша, табличка): их emissiveColor чёрный (fractalView)
      const e = lit.has(mesh.uniqueId) ? ((mat?.metadata as { glow?: Color3 } | null)?.glow ?? (mat as StandardMaterial | null)?.emissiveColor) : null;
      if (e) res.set(e.r, e.g, e.b, 1);
      else res.set(0, 0, 0, 1);
    };
    this.glowSync();
    // кооп
    this.opts.co?.onFx.add(this.onFx);
    this.copies = new FractalCopies(this.scene, cell, this.opts.slot);
    this.props = new PropModels(this.scene, [metroUrl]);
    await Promise.all([
      this.props.loaded.then(() => {
        if (!this.disposed && this.props) view.setProps(this.props);
      }),
      this.copies.loaded,
    ]);
    if (this.disposed) return;
    for (const m of this.scene.meshes) (m as AbstractMesh).isPickable = false;
    this.sync(0);
  }

  // ───────────────────────── ViewerOverlay ─────────────────────────

  attach() {}

  detach() {
    this.keys.clear();
    this.mdx = this.mdy = 0;
  }

  render() {
    if (!this.disposed) this.scene.render();
  }

  begin() {
    if (this.disposed) return;
    if (!this.engine.isPointerLock) this.engine.enterPointerlock();
    this.locked = document.pointerLockElement === this.canvas;
    this.started = true;
    this.audio.start();
    this.emitHud(true);
  }

  setSound(on: boolean) {
    this.audio.setEnabled(on);
    if (on) this.audio.start();
    this.emitHud(true);
  }

  // ───────────────────────── кадр ─────────────────────────

  private beforeRender() {
    const now = performance.now();
    const gap = this.last ? (now - this.last) / 1000 : 1 / 60;
    // после паузы страницы / долгого кадра — не скакать
    const dt = gap > 0.25 ? 1 / 60 : Math.min(0.1, gap);
    this.last = now;
    if (!this.ready || this.disposed) return;
    if (!this.manual) this.simulate(dt, this.readInput());
    this.sync(dt);
  }

  private readInput(): FrInput {
    const k = this.keys;
    const on = this.locked || this.held.length > 0;
    const fwd = on ? (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) : 0;
    const side = on ? (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) : 0;
    const inp: FrInput = {
      fwd,
      side,
      run: on && (k.has('ShiftLeft') || k.has('ShiftRight')),
      dYaw: this.mdx * MOUSE_K,
      dPitch: -this.mdy * MOUSE_K,
      use: on && k.has('KeyE'),
    };
    this.mdx = this.mdy = 0;
    return inp;
  }

  /** Шаг мира: тело, эскалаторы, события. */
  simulate(dt: number, inp: FrInput) {
    if (this.disposed || !this.ready || this.exited) return;
    this.time += dt;
    const b = this.body;
    for (const e of stepBody(this.env, b, inp, dt)) this.onBody(e);
    if (this.exited) return;
    this.stuck(dt);
    const ride = b.ride ? { esc: b.ride.esc, lane: b.ride.lane, s: b.ride.s } : null;
    for (const e of stepEscWorld(this.escW, dt, { rideStart: this.rideStart, near: this.nearEsc(), ride })) this.onEsc(e);
    this.rideStart = null;
  }

  private onBody(e: FrEvent) {
    const b = this.body;
    switch (e.k) {
      case 'step':
        this.audio.step(b.ground === 'ramp', 0.7 + 0.1 * Math.hypot(b.vel[0], b.vel[1], b.vel[2]));
        break;
      case 'land':
        if (e.power === 0) this.audio.step(false, 1.1);
        else {
          this.audio.land(e.power);
          this.landed = e.power;
          this.landedAt = this.time;
          if (e.power === 2) this.darken(0.25, 0.6);
        }
        break;
      case 'turn':
        this.audio.turn();
        break;
      case 'turned':
        this.turns++;
        this.turnedAt = this.time;
        break;
      case 'wrap':
        this.view?.setCell(b.cell);
        this.copies?.shift(e.d);
        break;
      case 'ride':
        this.rideStart = { esc: e.esc, lane: e.lane };
        break;
      case 'exit':
        if (this.exited) break;
        this.exited = true;
        if (document.pointerLockElement === this.canvas) document.exitPointerLock();
        this.emitHud(true);
        this.opts.onExit();
        break;
      case 'rescue':
        this.rescue();
        break;
      case 'off':
        break;
    }
  }

  private onEsc(e: FrEscEvent) {
    const pt = this.escPoint(e.esc);
    if (e.k === 'start') {
      if (this.remoteStarts.has(e.esc)) this.remoteStarts.delete(e.esc);
      else {
        const co = this.opts.co;
        if (co && co.status === 'online') co.fx('frEsc', { s: this.seedTag, esc: e.esc, lane: e.lane });
      }
      if (pt) this.audio.shudder(pt);
    } else if (e.k === 'stage') {
      if (e.stage === 'runaway' && pt) this.audio.snap(pt);
      if (e.stage === 'fall' && pt) this.audio.crash(pt);
    }
  }

  /** Страховка «застрял» (INTEGRATE): ступня в замкнутом кармане графа ходьбы дольше POCKET_S — rescue. При P = 54 это
   *  щель 1 м между оболочкой и ядром «станции 6»/павильона: шагнул в дыру — стоишь на ядре головой в дыре, ступеней
   *  1 м нет, стены для поворота нет (notes-fr-gen п. 9). Обход navPocket — только при смене узла или поломок. */
  private stuck(dt: number) {
    const b = this.body;
    if (b.ground !== 'floor' || b.turn || b.ride) {
      this.pocketT = 0;
      return;
    }
    const P = this.cell.P, f = footVox(b.pos, b.up);
    const node = vidx(P, mod(f[0], P), mod(f[1], P), mod(f[2], P)) * 6 + b.up;
    const nb = this.escW.broken.size;
    if (node !== this.pocketNode || nb !== this.pocketBroken) {
      this.pocketNode = node;
      this.pocketBroken = nb;
      this.pocketHit = navPocket(this.cell, b.pos, b.up, this.escW.broken, POCKET_CAP) < POCKET_CAP;
    }
    this.pocketT = this.pocketHit ? this.pocketT + dt : 0;
    if (this.pocketT < POCKET_S) return;
    this.pocketT = 0;
    this.pocketNode = -1;
    this.pockets++;
    this.rescue();
  }

  /** Страховка: на ближайшую стоячую точку той же ячейки, с затемнением. */
  private rescue() {
    const b = this.body;
    let best = this.cell.arrival, bd = Infinity;
    for (const s of [this.cell.arrival, ...this.cell.spots]) {
      const d = Math.hypot(...sub(s.at, b.pos));
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    placeBody(b, best.at, best.up, yawToward(best.up, best.fwd));
    this.darken(0.15, 0.8);
  }

  private darken(hold: number, fade: number) {
    this.darkT = hold + fade;
    this.darkK = fade;
  }

  /** Эскалаторы в кадре ≤ ESC.bgM (ближайший образ) — для фонового срыва. Тот, на котором едешь, — не фон (как в метро:
   *  metroWalk.ts, rideKey): под игроком срывает только бросок при входе (rideRoll). */
  private nearEsc(): number[] {
    const v = this.view;
    if (!v) return [];
    const cp = camPose(this.body);
    const riding = this.body.ride?.esc ?? -1;
    const out: number[] = [];
    for (const e of this.cell.esc) {
      if (e.kind === 'exit' || e.i === riding) continue;
      const c = v.escCenter(e.i);
      if (!c) continue;
      const p = nearestImage(c, cp.eye, this.cell.P);
      const d = sub(p, cp.eye);
      const L = Math.hypot(...d);
      if (L > ESC.bgM + 10) continue;
      if (L > 6 && dot(d, cp.fwd) / L < 0.6) continue;
      out.push(e.i);
    }
    return out;
  }

  /** Середина эскалатора (ближайший образ) в кадре игрока — для звука. */
  private escPoint(i: number): FrAudioPt | null {
    const c = this.view?.escCenter(i);
    if (!c) return null;
    const cp = camPose(this.body);
    return this.toFrame(nearestImage(c, cp.eye, this.cell.P), cp);
  }

  private toFrame(p: V3, cp: { eye: V3; right: V3; up: V3; fwd: V3 }): FrAudioPt {
    const d = sub(p, cp.eye);
    return { x: dot(d, cp.right), y: dot(d, cp.up), z: dot(d, cp.fwd) };
  }

  /** Списки свечения: светящиеся и заслоны (подложки пересобираются при срыве). */
  private glowVer = -1;
  private glowSync() {
    const v = this.view, g = this.glow;
    if (!v || !g || this.glowVer === v.meshVer) return;
    this.glowVer = v.meshVer;
    for (const m of [...v.glowMeshes, ...v.occluders()]) g.addIncludedOnlyMesh(m);
  }

  /** Камера, свет, меши, копии, звук, кооп, HUD. */
  private sync(dt: number) {
    if (!this.ready && dt > 0) return;
    const b = this.body, v = this.view;
    if (!b || !v) return;
    const cp = camPose(b);
    // тряска: удар и срыв рядом
    let sh = b.shake;
    for (const [i] of this.escW.runs) {
      const p = collapsePose(this.escW, i);
      if (!p || p.shake <= 0) continue;
      const c = v.escCenter(i);
      if (!c) continue;
      const d = Math.hypot(...sub(nearestImage(c, cp.eye, this.cell.P), cp.eye));
      const k = b.ride?.esc === i ? 1 : Math.max(0, 1 - d / 30);
      sh = Math.max(sh, Math.min(1.5, p.shake) * k);
    }
    const roll = sh > 0 ? (Math.random() - 0.5) * 2 * SHAKE_ROLL * sh : 0;
    const cr = Math.cos(roll), sr = Math.sin(roll);
    this.vr.set(cp.right[0] * cr + cp.up[0] * sr, cp.right[1] * cr + cp.up[1] * sr, cp.right[2] * cr + cp.up[2] * sr);
    this.vu.set(cp.up[0] * cr - cp.right[0] * sr, cp.up[1] * cr - cp.right[1] * sr, cp.up[2] * cr - cp.right[2] * sr);
    this.vf.set(cp.fwd[0], cp.fwd[1], cp.fwd[2]);
    Quaternion.RotationQuaternionFromAxisToRef(this.vr, this.vu, this.vf, this.q);
    this.camera.rotationQuaternion!.copyFrom(this.q);
    const n = SHAKE_POS * sh;
    this.camera.position.set(cp.eye[0] + (Math.random() - 0.5) * n, cp.eye[1] + (Math.random() - 0.5) * n, cp.eye[2] + (Math.random() - 0.5) * n);
    this.hemi.direction.set(cp.up[0], cp.up[1], cp.up[2]);
    // затемнение
    if (this.darkT > 0) {
      this.darkT = Math.max(0, this.darkT - dt);
      this.darkMat.alpha = this.darkK > 0 ? Math.min(1, this.darkT / this.darkK) : 0;
    } else this.darkMat.alpha = 0;
    this.dark.setEnabled(this.darkMat.alpha > 0.002);
    // меши: ленты, срывы, отбор копий
    const escV: FrViewEsc = {
      broken: this.escW.broken,
      belt: (i, l) => this.escW.belt(i, l),
      stage: (i) => this.escW.stage(i),
      pose: (i) => collapsePose(this.escW, i),
    };
    v.update(dt, cp.eye, cp.fwd, escV);
    // нити «струн» — не тоньше ~0.6 пикселя (м на пиксель на метр дальности)
    v.setPixelScale((2 * Math.tan(this.camera.fov / 2)) / Math.max(1, this.engine.getRenderHeight()));
    this.glowSync();
    // свои копии и напарники
    const bp = bodyPose(b);
    this.copies?.update(dt, { feet: bp.feet, up: bp.up, fwd: bp.fwd, pitch: b.pitch, speed: bp.speed }, cp.eye, cp.fwd, this.escW.broken);
    // свечение: на слабой машине — прочь
    const fps = this.engine.getFps();
    if (this.glow && this.glowAuto && this.time > 3) {
      this.fpsLow = fps < 50 ? this.fpsLow + dt : 0;
      if (this.fpsLow > 3) {
        this.glow.isEnabled = false;
        this.glowAuto = false;
      }
    }
    if (dt > 0) {
      this.net(dt, bp.speed);
      this.sound(dt, cp, bp.speed);
    }
    if (performance.now() - this.hudAt > 150) this.emitHud();
  }

  private sound(dt: number, cp: ReturnType<typeof camPose>, speed: number) {
    const b = this.body, v = this.view!;
    const P = this.cell.P;
    // эхо: до стены впереди по главной оси взгляда (раз в 0.2 с)
    if (this.time - this.echoAt > 0.2) {
      this.echoAt = this.time;
      const f = cp.fwd;
      const ax = Math.abs(f[0]) >= Math.abs(f[1]) && Math.abs(f[0]) >= Math.abs(f[2]) ? 0 : Math.abs(f[1]) >= Math.abs(f[2]) ? 1 : 2;
      const dir = (ax * 2 + (f[ax] < 0 ? 1 : 0)) as Axis6;
      try {
        this.echoM = axisRay(this.cell, cp.eye, dir, 2 * P);
      } catch {
        this.echoM = null;
      }
    }
    // ближайшая работающая дорожка и срыв рядом
    let esc: (FrAudioPt & { k: number }) | null = null;
    let run: (FrAudioPt & { v: number }) | null = null;
    let bestD = Infinity;
    for (const e of this.cell.esc) {
      if (this.escW.broken.has(e.i)) continue;
      const c = v.escCenter(e.i);
      if (!c) continue;
      const img = nearestImage(c, cp.eye, P);
      const shift = sub(img, c);
      const o: V3 = [e.o[0] + shift[0], e.o[1] + shift[1], e.o[2] + shift[2]];
      const f = AXIS_VEC[e.fwd], u = AXIS_VEC[e.up];
      const s = Math.max(0, Math.min(e.run, dot(sub(cp.eye, o), f as V3)));
      const p: V3 = [o[0] + f[0] * s + u[0] * (s * Math.tan(Math.PI / 6) + 0.5), o[1] + f[1] * s + u[1] * (s * Math.tan(Math.PI / 6) + 0.5), o[2] + f[2] * s + u[2] * (s * Math.tan(Math.PI / 6) + 0.5)];
      const d = Math.hypot(...sub(p, cp.eye));
      const st = this.escW.stage(e.i);
      if (st === 'runaway' && d < 40) {
        const vv = Math.abs(this.escW.belt(e.i, 0));
        if (!run || vv > run.v) run = { ...this.toFrame(p, cp), v: vv };
      }
      if (st || d >= bestD || d > 28) continue;
      bestD = d;
      esc = { ...this.toFrame(p, cp), k: Math.max(0, 1 - d / 28) };
    }
    // ветер из открытой ниши ближайшей выходной копии
    const near = this.exitNearest(cp.eye);
    this.audio.update(dt, {
      speed,
      ground: b.ground,
      fallV: b.fallV,
      echoM: this.echoM,
      esc,
      onBelt: b.ground === 'ramp',
      runaway: run,
      wind: near && near.d < 110 ? this.toFrame(near.p, cp) : null,
    });
  }

  /** Ближайшая открытая ниша (выходная копия): точка в координатах ячейки и расстояние от p. */
  private exitNearest(p: V3): { p: V3; d: number } | null {
    const P = this.cell.P;
    const c0 = boxCenter(this.cell.exit.arch);
    let best: { p: V3; d: number } | null = null;
    let ks: V3[];
    try {
      ks = exitCopies(this.body.cell, 1);
    } catch {
      return null;
    }
    for (const k of ks) {
      const q: V3 = [c0[0] + k[0] * P, c0[1] + k[1] * P, c0[2] + k[2] * P];
      const d = Math.hypot(...sub(q, p));
      if (!best || d < best.d) best = { p: q, d };
    }
    return best;
  }

  // ───────────────────────── кооп ─────────────────────────

  private net(dt: number, speed: number) {
    const co = this.opts.co;
    if (!co || co.status !== 'online') return;
    this.netAt += dt;
    if (this.netAt < NET_S) return;
    this.netAt = 0;
    const b = this.body;
    const r = (x: number, k = 100) => Math.round(x * k) / k;
    co.fx('frPos', { s: this.seedTag, c: [...b.cell], p: [r(b.pos[0]), r(b.pos[1]), r(b.pos[2])], u: b.up, y: r(b.yaw), h: r(b.pitch), v: r(speed, 10) });
  }

  private fx(from: string, k: string, d: unknown) {
    if (!this.ready || this.disposed || !d || typeof d !== 'object') return;
    const o = d as Record<string, unknown>;
    if (o.s !== this.seedTag) return;
    if (k === 'frPos') {
      const c = o.c, p = o.p, u = o.u;
      if (!Array.isArray(c) || c.length !== 3 || !c.every(fin)) return;
      if (!Array.isArray(p) || p.length !== 3 || !p.every(fin)) return;
      if (!fin(u) || u < 0 || u > 5 || Math.floor(u) !== u) return;
      if (!fin(o.y) || !fin(o.h) || !fin(o.v)) return;
      const P = this.cell.P, me = this.body;
      const feet: V3 = [(c[0] - me.cell[0]) * P + p[0], (c[1] - me.cell[1]) * P + p[1], (c[2] - me.cell[2]) * P + p[2]];
      const up = AXIS_VEC[u as Axis6] as V3;
      const slot = this.opts.co?.players.get(from)?.slot;
      this.copies?.mate(from, slot, feet, [...up] as V3, yawFwd(u as Axis6, o.y), o.h, o.v, me.pos);
    } else if (k === 'frEsc') {
      if (!fin(o.esc) || !fin(o.lane)) return;
      if (startCollapse(this.escW, o.esc, o.lane, false)) this.remoteStarts.add(o.esc);
    }
  }

  // ───────────────────────── клавиши ─────────────────────────

  private key(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    if (e.type === 'keydown') this.keys.add(e.code);
    else if (!this.held.includes(e.code)) this.keys.delete(e.code);
  }

  // ───────────────────────── HUD ─────────────────────────

  hud(): FractalHud {
    const b = this.body;
    const ok = this.ready && !!b;
    const ride = ok && b.ride ? this.cell.esc[b.ride.esc] : null;
    let alarm: FractalHud['alarm'] = null;
    if (ok) {
      const pick = (st: string | null) => (st === 'shudder' || st === 'runaway' || st === 'fall' ? st : null);
      if (b.ride) alarm = pick(this.escW.stage(b.ride.esc));
      if (!alarm && this.view) {
        const eye = camPose(b).eye;
        for (const [i] of this.escW.runs) {
          const c = this.view.escCenter(i);
          if (c && Math.hypot(...sub(nearestImage(c, eye, this.cell.P), eye)) < 30) alarm = pick(this.escW.stage(i)) ?? alarm;
        }
      }
    }
    const hop = ok && b.ride ? canHop(this.env, b) : false;
    const near = ok ? this.exitNearest(camPose(b).eye) : null;
    const landed = ok && this.time - this.landedAt < 1 ? this.landed : 0;
    let hint: string | null = null;
    if (ok && this.started) {
      if (hop) hint = HINTS.hop;
      else if (this.turns === 0) hint = HINTS.push;
      else if (this.time - this.turnedAt < 8 && this.turns <= 2) hint = HINTS.fall;
    }
    return {
      locked: this.locked,
      ready: this.ready,
      started: this.started,
      error: this.error,
      up: ok ? b.up : 2,
      cell: ok ? [...b.cell] as V3 : [0, 0, 0],
      ground: ok ? b.ground : 'floor',
      pushing: ok ? pushShare(b) : 0,
      ride: ride && b.ride ? { kind: ride.kind, dir: ride.lanes[b.ride.lane]?.dir ?? 0 } : null,
      alarm,
      canHop: hop,
      exitNear: near ? Math.round(near.d) : null,
      landed,
      hint,
      sound: this.audio.enabled,
      fps: Math.round(this.engine.getFps()),
      selfSeen: this.copies?.selfSeen ?? 0,
      mates: this.copies?.mateCount ?? 0,
    };
  }

  private emitHud(force = false) {
    if (!force && performance.now() - this.hudAt < 150) return;
    this.hudAt = performance.now();
    try {
      this.opts.onHud(this.hud());
    } catch (e) {
      console.error(e);
    }
  }

  // ───────────────────────── QA ─────────────────────────

  /** Поставить тело: ступни at, гравитация up, взгляд yaw; cell — абсолютная ячейка (по умолчанию — та же). */
  place(at: V3, up: Axis6, yaw = 0, cell?: V3) {
    const b = this.body;
    const was: V3 = [...b.cell];
    placeBody(b, at, up, yaw, cell ?? b.cell, this.cell.P);
    const d = sub(b.cell, was);
    if (d[0] || d[1] || d[2]) {
      this.view?.setCell(b.cell);
      this.copies?.shift(d);
    }
    this.sync(0);
  }

  /** Стоячее место под глазом вдоль новой гравитации (QA: «потолок» и т. п.). */
  turnTo(up: Axis6): boolean {
    const b = this.body;
    const eye = camPose(b).eye;
    const d = axisRay(this.cell, eye, opp(up), 2 * this.cell.P);
    if (d !== null) {
      const U = AXIS_VEC[up];
      const at: V3 = [eye[0] - U[0] * d, eye[1] - U[1] * d, eye[2] - U[2] * d];
      const ua = axisIdx(up);
      // у самой поверхности: ступни на грани вокселя
      at[ua] = Math.round(at[ua]);
      const x = Math.floor(at[0] + U[0] * 0.5), y = Math.floor(at[1] + U[1] * 0.5), z = Math.floor(at[2] + U[2] * 0.5);
      if (standable(this.cell, x, y, z, up)) {
        this.place(at, up, 0);
        return true;
      }
    }
    const s = this.cell.spots.find((p) => p.up === up);
    if (!s) return false;
    this.place(s.at, up, yawToward(up, s.fwd));
    return true;
  }

  /** Начать срыв (QA): esc — индекс (по умолчанию — под игроком или ближайший). */
  forceCollapse(esc?: number): number | null {
    const b = this.body;
    let i = esc ?? b.ride?.esc ?? -1;
    if (i < 0) {
      const eye = camPose(b).eye;
      let bd = Infinity;
      for (const e of this.cell.esc) {
        if (e.kind === 'exit' || this.escW.broken.has(e.i)) continue;
        const c = this.view?.escCenter(e.i);
        if (!c) continue;
        const d = Math.hypot(...sub(nearestImage(c, eye, this.cell.P), eye));
        if (d < bd) {
          bd = d;
          i = e.i;
        }
      }
    }
    if (i < 0) return null;
    const lane = b.ride?.esc === i ? b.ride.lane : 0;
    return startCollapse(this.escW, i, lane, false) ? i : null;
  }

  /** На площадку эскалатора выхода в ближайшей выходной копии, лицом к нише. */
  toExit() {
    const b = this.body;
    let ks: V3[] = exitCopies(b.cell, 1);
    if (!ks.length) ks = [[0, 0, 0]];
    const c0 = boxCenter(this.cell.exit.arch);
    const P = this.cell.P;
    ks.sort((a, z) => Math.hypot(...sub([c0[0] + a[0] * P, c0[1] + a[1] * P, c0[2] + a[2] * P], b.pos)) - Math.hypot(...sub([c0[0] + z[0] * P, c0[1] + z[1] * P, c0[2] + z[2] * P], b.pos)));
    const k = ks[0];
    const a = this.cell.arrival, x = this.cell.exit;
    const e = this.cell.esc[x.esc];
    // по средней дорожке — напротив ниши (прибытие — на дорожке «вниз», сбоку от неё)
    const at: V3 = [...a.at];
    for (let i = 0; i < 3; i++) if (i !== axisIdx(a.up) && i !== axisIdx(x.facing)) at[i] = c0[i];
    this.place(at, a.up, yawToward(a.up, e ? e.fwd : opp(a.fwd)), [b.cell[0] + k[0], b.cell[1] + k[1], b.cell[2] + k[2]]);
  }

  /** Найти стоячую точку, откуда видна своя копия, и встать лицом к ней. */
  seeSelf(): boolean {
    const P = this.cell.P;
    const tries: { at: V3; up: Axis6 }[] = [this.cell.arrival, ...this.cell.spots].map((s) => ({ at: s.at, up: s.up }));
    // + детерминированная выборка стоячих вокселей
    let r = 12345;
    const rnd = () => ((r = (r * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let n = 0; n < 6000 && tries.length < 1500; n++) {
      const x = Math.floor(rnd() * P), y = Math.floor(rnd() * P), z = Math.floor(rnd() * P), up = Math.floor(rnd() * 6) as Axis6;
      if (!standable(this.cell, x, y, z, up)) continue;
      const at: V3 = [x + 0.5, y + 0.5, z + 0.5];
      const ua = axisIdx(up);
      at[ua] = axisSign(up) > 0 ? [x, y, z][ua] : [x, y, z][ua] + 1;
      tries.push({ at, up });
    }
    for (const t of tries) {
      const U = AXIS_VEC[t.up];
      const eye: V3 = [t.at[0] + U[0] * FRP.eye, t.at[1] + U[1] * FRP.eye, t.at[2] + U[2] * FRP.eye];
      let best: { k: V3; d: number; tgt: V3 } | null = null;
      for (const k of SHIFTS) {
        const tgt: V3 = [t.at[0] + k[0] * P + U[0] * 1.2, t.at[1] + k[1] * P + U[1] * 1.2, t.at[2] + k[2] * P + U[2] * 1.2];
        const d = Math.hypot(...sub(tgt, eye));
        if (d > 95) continue;
        if (!(this.copies ? this.copies.los(eye, tgt, this.escW.broken) : lineOfSight(this.cell, eye, tgt, this.escW.broken))) continue;
        if (!best || d < best.d) best = { k, d, tgt };
      }
      if (!best) continue;
      const dir = sub(best.tgt, eye).map((x) => x / best!.d) as V3;
      const fr = FRAME[t.up];
      const R = AXIS_VEC[fr.right] as V3, F = AXIS_VEC[fr.fwd] as V3;
      const yaw = Math.atan2(dot(dir, R), dot(dir, F));
      this.place(t.at, t.up, yaw);
      this.body.pitch = Math.max(-FRP.pitchMax, Math.min(FRP.pitchMax, Math.asin(Math.max(-1, Math.min(1, dot(dir, U as V3))))));
      this.sync(0);
      return true;
    }
    return false;
  }

  advance(sec: number, inp: Partial<FrInput> = {}) {
    this.manual = true;
    const full: FrInput = { fwd: 0, side: 0, run: false, dYaw: 0, dPitch: 0, use: false, ...inp };
    let t = 0;
    while (t < sec - 1e-9) {
      const h = Math.min(1 / 60, sec - t);
      this.simulate(h, { ...full, dYaw: t === 0 ? full.dYaw : 0, dPitch: t === 0 ? full.dPitch : 0 });
      this.sync(h);
      t += h;
    }
  }

  stats() {
    const v = this.view?.stats();
    return {
      meshes: v?.meshes ?? 0,
      drawCalls: this.instr.drawCallsCounter.current,
      tris: Math.round(this.scene.getActiveIndices() / 3),
      thin: v?.thin ?? 0,
      props: v?.props ?? 0,
      propIds: v?.propIds ?? 0,
      missingProps: v?.missingProps ?? [],
      escNear: v?.escNear ?? 0,
      glow: !!this.glow?.isEnabled,
      fps: Math.round(this.engine.getFps()),
      trisBy: v?.tris ?? {},
    };
  }

  qa(): FractalQa {
    return {
      state: () => {
        const b = this.body;
        return {
          up: b.up,
          cell: [...b.cell] as V3,
          pos: [...b.pos] as V3,
          ground: b.ground,
          ride: b.ride ? { ...b.ride } : null,
          push: b.push,
          turn: b.turn ? { from: b.turn.from, to: b.turn.to, t: b.turn.t } : null,
          stun: b.stun,
          esc: { runs: [...this.escW.runs].map(([esc, r]) => ({ esc, stage: r.stage, t: r.t })), broken: [...this.escW.broken] },
          exitNear: this.exitNearest(camPose(b).eye)?.d ?? null,
          fps: Math.round(this.engine.getFps()),
          selfSeen: this.copies?.selfSeen ?? 0,
          selfShifts: this.copies?.selfShifts.map((k) => [...k] as V3) ?? [],
          mates: this.copies?.mateCount ?? 0,
          exited: this.exited,
          yaw: b.yaw,
          pitch: b.pitch,
          hud: this.hud(),
          pockets: this.pockets,
          bgNear: this.nearEsc(),
          sightVer: this.copies?.sightVer ?? 0,
        };
      },
      place: (at, up, yaw, cell) => this.place(at, up, yaw, cell),
      turnTo: (up) => this.turnTo(up),
      forceCollapse: (esc) => this.forceCollapse(esc),
      toExit: () => this.toExit(),
      seeSelf: () => this.seeSelf(),
      stats: () => this.stats(),
      advance: (s, inp) => this.advance(s, inp),
      live: () => {
        this.manual = false;
      },
      hold: (codes) => {
        for (const c of this.held) this.keys.delete(c);
        this.held = [...codes];
        for (const c of codes) this.keys.add(c);
      },
      look: (yaw, pitch) => {
        this.body.yaw = yaw;
        this.body.pitch = Math.max(-FRP.pitchMax, Math.min(FRP.pitchMax, pitch));
        this.sync(0);
      },
      setGlow: (on) => {
        this.glowAuto = false;
        if (this.glow) this.glow.isEnabled = on;
      },
      cell: () => this.cell,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('pointerlockchange', this.onLock);
    document.removeEventListener('mousemove', this.onMouse);
    this.opts.co?.onFx.delete(this.onFx);
    this.audio.dispose();
    this.copies?.dispose();
    this.view?.dispose();
    this.props?.dispose();
    this.glow?.dispose();
    this.instr.dispose();
    this.scene.dispose();
  }
}
