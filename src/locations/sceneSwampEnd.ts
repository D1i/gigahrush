// Сцена финала «Болото на крыше» (Babylon) — своя Scene в движке вкладки «3D» (BlockoutViewer.setOverlay), как
// sceneHangar.ts. Механика — ./swampEnd.ts: сценарий камеры (endPose), розыгрыш (номер войсковой части), титры.
//
//  • Зал цеха: пол затоплен (вода по щиколотку, по воде — гнилой настил от двери к шестерне), а вместо потолка — болото
//    вверх ногами на высоте END_CEIL_M: грязь, лужи, островки, свисающий камыш и сухие деревья, перевёрнутый настил; с
//    него капает грязью. Ржавые двутавры уходят в грязь; по краям в воде — вентиляторы, насосы, шестерни (крутятся,
//    src/view3d/propAnim.ts), бочки, металлолом; туман. Модели — набор пользователя «завод → болото»
//    (src/view3d/assets/factory_props.glb через PropModels).
//  • Посреди — огромная шестерня (24 зуба набора ×4: Ø 7.3 м), поднимается из воды, верхние зубья почти касаются грязи;
//    рядом малая в зацеплении. Проворачивается рывками на зуб за spec.toothS, правая сторона идёт вверх. Зона «встать
//    на зуб» — у правого края, где зуб чуть над водой: вошёл — сценарий (endPose), управления нет.
//  • Сценарий: шестерня дёргается, зуб рывками поднимает по дуге вверх (камера — на ободе, смотрит вверх, на грязь,
//    мимо свисающего камыша), вдавливает в грязь (бурая муть, темнота, сердце); в темноте сцена переходит к болоту у
//    военной части (тот же Scene, другое место): выныриваешь, капли на глазах, ползёшь к берегу; за камышом — забор
//    ПО-2 с колючей спиралью, ворота со звёздами, КПП, табличка «Войсковая часть N», вышка с прожектором, фонари.
//    Прожектор находит тебя — слепит — титры (HUD слоя).
//  • Назад — дверь за спиной в начале (onExit('back')).
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
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Constants } from '@babylonjs/core/Engines/constants';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import '@babylonjs/core/Particles/particleSystemComponent';
import { PointerEventTypes } from '@babylonjs/core/Events/pointerEvents';
import type { Engine } from '@babylonjs/core/Engines/engine';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { PropModels } from '../view3d/propModels';
import factoryUrl from '../view3d/assets/factory_props.glb?url';
// сырой бетон с плесенью набора пользователя (как стены «топи» в цехах завода)
import dampUrl from '../data/assets/basement/concrete_damp.jpg?url';
import { collide2, type Box2 } from './stairLoop';
import { SwampAudio } from './swampAudio';
import {
  END_CEIL_M, END_EMERGE_S, END_LIFT_S, END_LOOK_S, END_STEP_S, END_SWITCH_S, END_TITLE_S, END_UNDER_S,
  endPose, endTitles, rollSwamp, type EndPhase, type EndPose, type SwampRoll, type SwampSpec,
} from './swampEnd';

export interface SwampHud {
  loading: boolean;
  error: string | null;
  started: boolean;
  locked: boolean;
  phase: 'walk' | 'end' | 'exit';
  /** фаза сценария (null — ходишь по залу) */
  end: EndPhase | null;
  /** титры 0…1 */
  title: number;
  titles: { title: string; lines: string[] };
  prompt: string | null;
}

export interface SwampSceneOptions {
  spec: SwampSpec;
  seedKey: string;
  roll?: SwampRoll;
  /** звук (QA — без него) */
  audio?: boolean;
  onHud?(h: SwampHud): void;
  /** 'back' — вернулся в дверь (на завод) */
  onExit?(kind: 'back'): void;
}

interface Input {
  f: number;
  s: number;
  run: boolean;
}

// ───────────────────────── размеры (мир сцены, м) ─────────────────────────

/** зал: x ∈ [−HX, HX], z ∈ [HZ0, HZ1]; вода — y = 0 (пол под ней — WATER_Y), над головой — грязь на высоте CEIL */
const HX = 13;
const HZ0 = -4;
const HZ1 = 24;
const CEIL = END_CEIL_M;
const WATER_Y = -0.12;
/** стена с дверью, откуда пришёл (завод): по z = DOOR.z, проём |x| < DOOR.w высотой DOOR.h; за ней — темнота */
const DOOR = { z: -0.2, w: 0.6, h: 2.1 };
/** большая шестерня: масштаб набора, зубьев; центр — чтобы верхние зубья почти касались грязи */
const GEAR_SCALE = 4;
/** радиус по зубьям (набор: Ø 1.814 м) и толщина (0.32 м) */
const GEAR_R = (1.814 / 2) * GEAR_SCALE;
const GEAR_T = 0.32 * GEAR_SCALE;
const GEAR = { y: CEIL - GEAR_R - 0.3, z: 13, teeth: 24 };
/** зуб, на который встаёшь: верх — чуть над водой, справа (+x) — там зубья идут вверх; угол на ободе от +x */
const TOOTH_Y = 0.15;
const PHI0 = Math.asin((TOOTH_Y - GEAR.y) / GEAR_R);
const GEAR_EDGE = GEAR_R * Math.cos(PHI0);
/** зона «встать на зуб»: круг у правого края */
const STEP_ZONE = { x: GEAR_EDGE + 0.1, z: GEAR.z - 0.2, r: 0.8 };
/** стоя на зубе — лицом к оси шестерни (на −x) */
const HALL_YAW = -Math.PI / 2;
/** настил по воде от двери наискосок к правому краю шестерни: от, до (x, z) */
const WALK = { x0: 0.25, z0: 0.5, x1: GEAR_EDGE - 0.9, z1: GEAR.z - GEAR_T / 2 - 1.3 };
const WALK_LEN = Math.hypot(WALK.x1 - WALK.x0, WALK.z1 - WALK.z0);
const WALK_YAW = Math.atan2(WALK.x1 - WALK.x0, WALK.z1 - WALK.z0);
/** болото у военной части — далеко в стороне */
const BASE = new Vector3(400, 0, 0);
/** откуда всплываешь (от BASE) и где забор */
const EMERGE_Z = 0.4;
const FENCE_Z = 16;

const EYE = 1.6;
const BODY_R = 0.3;
const WADE = 1.25;
const BOARD = 1.6;

const SODIUM = new Color3(1, 0.62, 0.3);

// ───────────────────────── текстуры (canvas) ─────────────────────────

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dyn(name: string, w: number, h: number, scene: Scene, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void, alpha = false): DynamicTexture {
  const t = new DynamicTexture(name, { width: w, height: h }, scene, true);
  t.hasAlpha = alpha;
  const c = t.getContext() as CanvasRenderingContext2D;
  draw(c, w, h);
  t.update();
  return t;
}

/** Грязь: бурая с зеленью, пятна, тёмные лужицы. */
function mudTexture(scene: Scene): DynamicTexture {
  const t = dyn('swamp:mud', 512, 512, scene, (c, w, h) => {
    const R = rng(11);
    c.fillStyle = '#2b2416';
    c.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      const x = R() * w, y = R() * h, r = 4 + R() * 26;
      const g = R();
      c.fillStyle = g < 0.4 ? `rgba(58,52,30,${0.25 + R() * 0.3})` : g < 0.7 ? `rgba(24,20,12,${0.3 + R() * 0.3})` : `rgba(46,58,32,${0.2 + R() * 0.3})`;
      c.beginPath();
      c.ellipse(x, y, r, r * (0.5 + R() * 0.5), R() * Math.PI, 0, Math.PI * 2);
      c.fill();
    }
    for (let i = 0; i < 60; i++) {
      c.fillStyle = `rgba(70,80,70,${0.15 + R() * 0.2})`;
      c.beginPath();
      c.ellipse(R() * w, R() * h, 6 + R() * 20, 3 + R() * 8, R() * Math.PI, 0, Math.PI * 2);
      c.fill();
    }
  });
  t.wrapU = t.wrapV = Texture.WRAP_ADDRESSMODE;
  t.uScale = t.vScale = 10;
  return t;
}

/** Плита ограждения ПО-2: серый бетон с рельефом «ромбами». */
function fenceTexture(scene: Scene): DynamicTexture {
  return dyn('swamp:po2', 512, 256, scene, (c, w, h) => {
    const R = rng(5);
    c.fillStyle = '#7d7a72';
    c.fillRect(0, 0, w, h);
    const n = 8, m = 4;
    const dw = w / n, dh = h / m;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < m; j++) {
        const cx = (i + 0.5) * dw, cy = (j + 0.5) * dh;
        // ромб: светлая верхняя грань, тёмная нижняя
        c.fillStyle = '#8f8b82';
        c.beginPath();
        c.moveTo(cx, cy - dh * 0.42);
        c.lineTo(cx + dw * 0.42, cy);
        c.lineTo(cx - dw * 0.42, cy);
        c.fill();
        c.fillStyle = '#5f5c55';
        c.beginPath();
        c.moveTo(cx, cy + dh * 0.42);
        c.lineTo(cx + dw * 0.42, cy);
        c.lineTo(cx - dw * 0.42, cy);
        c.fill();
      }
    }
    // грязь снизу и подтёки
    const g = c.createLinearGradient(0, h * 0.6, 0, h);
    g.addColorStop(0, 'rgba(40,36,24,0)');
    g.addColorStop(1, 'rgba(40,36,24,0.75)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) {
      const x = R() * w;
      c.fillStyle = `rgba(60,44,28,${0.12 + R() * 0.2})`;
      c.fillRect(x, R() * h * 0.3, 2 + R() * 4, h * (0.3 + R() * 0.6));
    }
  });
}

/** Створка ворот: зелёная, красная звезда в белом круге. */
function gateTexture(scene: Scene): DynamicTexture {
  return dyn('swamp:gate', 256, 256, scene, (c, w, h) => {
    c.fillStyle = '#2f4a2c';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = '#22361f';
    c.lineWidth = 6;
    c.strokeRect(8, 8, w - 16, h - 16);
    const cx = w / 2, cy = h / 2, R = 72;
    c.fillStyle = '#d9d4c4';
    c.beginPath();
    c.arc(cx, cy, R + 10, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#b3201a';
    c.beginPath();
    for (let k = 0; k < 10; k++) {
      const a = -Math.PI / 2 + (k * Math.PI) / 5;
      const r = k % 2 ? R * 0.42 : R;
      c.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
    }
    c.closePath();
    c.fill();
  });
}

function signTexture(scene: Scene, name: string, lines: string[], bg: string, fg: string, border: string): DynamicTexture {
  return dyn(name, 512, 192, scene, (c, w, h) => {
    c.fillStyle = bg;
    c.fillRect(0, 0, w, h);
    c.strokeStyle = border;
    c.lineWidth = 8;
    c.strokeRect(6, 6, w - 12, h - 12);
    c.fillStyle = fg;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const fs = lines.length > 1 ? 44 : 56;
    c.font = `bold ${fs}px sans-serif`;
    lines.forEach((l, i) => c.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * fs * 1.15));
  });
}

/** Капли на «объективе». */
function dropsTexture(scene: Scene): DynamicTexture {
  return dyn('swamp:drops', 512, 512, scene, (c, w, h) => {
    const R = rng(23);
    c.clearRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) {
      const x = R() * w, y = R() * h, r = 4 + R() * 22;
      const g = c.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
      g.addColorStop(0, 'rgba(120,110,80,0.15)');
      g.addColorStop(0.7, 'rgba(50,42,26,0.55)');
      g.addColorStop(1, 'rgba(30,24,14,0)');
      c.fillStyle = g;
      c.beginPath();
      c.ellipse(x, y, r * 0.8, r, 0, 0, Math.PI * 2);
      c.fill();
      // подтёк
      if (R() < 0.4) {
        c.fillStyle = 'rgba(40,32,20,0.35)';
        c.fillRect(x - 1.5, y, 3, r * (2 + R() * 4));
      }
    }
  }, true);
}

/** Капля дождя: вертикальный штрих. */
function rainTexture(scene: Scene): DynamicTexture {
  return dyn('swamp:rain', 16, 64, scene, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(200,210,220,0)');
    g.addColorStop(0.5, 'rgba(200,210,220,0.8)');
    g.addColorStop(1, 'rgba(200,210,220,0)');
    c.fillStyle = g;
    c.fillRect(w / 2 - 1, 0, 2, h);
  }, true);
}

// ───────────────────────── сцена ─────────────────────────

export class SwampScene {
  readonly scene: Scene;
  readonly camera: UniversalCamera;
  readonly spec: SwampSpec;
  readonly roll: SwampRoll;
  ready = false;
  error: string | null = null;

  pos = { x: 0, z: 0.6 };
  eyeY = EYE + WATER_Y;
  time = 0;
  /** время с шага на зуб (null — ходишь по залу) */
  endT: number | null = null;

  private started = false;
  private locked = false;
  private exited = false;
  private keys = new Set<string>();
  private hudAt = 0;
  private boxes: Box2[] = [];
  private props: PropModels;
  private audio: SwampAudio;
  private n = 0;
  private gear: Mesh | null = null;
  private gearSmall: Mesh | null = null;
  private gearAxis = new Vector3(0, 0, 1);
  private gearSmallAxis = new Vector3(0, 0, 1);
  private gearSign = 1;
  /** угол большой шестерни (рад) в момент шага на зуб — дальше её доворачивает подъём (зуб под ногами — под ногами) */
  private gearAt0 = 0;
  private gearAngle = 0;
  private lastTooth = -1;
  private stepAcc = 0;
  private fired = new Set<string>();
  private lamps: { light: PointLight; base: number; seed: number }[] = [];
  private overlay!: { mud: StandardMaterial; dark: StandardMaterial; drip: StandardMaterial; glare: StandardMaterial };
  private rain!: ParticleSystem;
  /** откуда сыплется: в зале — капли грязи с «потолка» над игроком, у части — морось над ним */
  private dripAt = new Vector3();
  private beam!: { pivot: TransformNode; light: SpotLight; cone: Mesh };
  private beamYaw = 0;
  private hallRoot!: TransformNode;
  private baseRoot!: TransformNode;
  private where: 'hall' | 'base' = 'hall';
  private eyeLamp: PointLight;
  private last = 0;

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
    private readonly opts: SwampSceneOptions,
  ) {
    this.spec = opts.spec;
    this.roll = opts.roll ?? rollSwamp(opts.spec, opts.seedKey);
    this.audio = new SwampAudio(opts.audio !== false);
    const scene = (this.scene = new Scene(engine));
    scene.clearColor = new Color4(0.02, 0.025, 0.022, 1);
    scene.ambientColor = new Color3(0, 0, 0);
    scene.skipPointerMovePicking = true;
    scene.fogMode = Scene.FOGMODE_EXP2;
    this.hallFog();
    const ip = scene.imageProcessingConfiguration;
    ip.toneMappingEnabled = true;
    ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    ip.exposure = 1.5;
    ip.contrast = 1.12;
    ip.vignetteEnabled = true;
    ip.vignetteWeight = 2.4;
    ip.vignetteColor = new Color4(0, 0, 0, 0);
    ip.vignetteBlendMode = ImageProcessingConfiguration.VIGNETTEMODE_MULTIPLY;

    const cam = (this.camera = new UniversalCamera('swamp:eye', new Vector3(this.pos.x, this.eyeY, this.pos.z), scene));
    cam.minZ = 0.03;
    cam.maxZ = 160;
    cam.fov = 1.15;
    cam.inertia = 0.45;
    cam.angularSensibility = 2200;
    cam.speed = 0;
    cam.inputs.removeByType('FreeCameraKeyboardMoveInput');
    cam.rotation.set(0.05, 0, 0);
    scene.activeCamera = cam;

    const hemi = new HemisphericLight('swamp:moon', new Vector3(-0.2, 1, 0.3), scene);
    hemi.diffuse = new Color3(0.55, 0.62, 0.66).scale(1 - 0.3 * this.spec.darkness);
    hemi.intensity = 1.0;
    // снизу — отсвет воды: перевёрнутое болото над головой (грань смотрит вниз) видно
    hemi.groundColor = new Color3(0.3, 0.28, 0.2).scale(1 - 0.3 * this.spec.darkness);
    hemi.specular = Color3.Black();

    // тусклый свет у глаза — пока зуб поднимает (иначе грязь и зубья рядом чёрные)
    const eye = (this.eyeLamp = new PointLight('swamp:eyeLamp', new Vector3(0, 0.2, 0.3), scene));
    eye.parent = cam;
    eye.diffuse = new Color3(1, 0.72, 0.45);
    eye.specular = Color3.Black();
    eye.range = 5;
    eye.intensity = 0;

    this.props = new PropModels(scene, [factoryUrl]);
    this.buildOverlay();

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

  static async create(engine: Engine, canvas: HTMLCanvasElement, opts: SwampSceneOptions): Promise<SwampScene> {
    const s = new SwampScene(engine, canvas, opts);
    s.emitHud(true);
    try {
      await s.props.loaded;
      if (s.props.error && !s.props.size) throw new Error(s.props.error);
      if (s.disposed) return s;
      s.build();
      s.ready = true;
    } catch (e) {
      console.error(e);
      s.error = 'Не удалось собрать зал: ' + String((e as Error)?.message ?? e);
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
    if (!this.engine.isPointerLock) this.engine.enterPointerlock();
    // вошли с уже захваченной мышью (шагнули из «Прогулки») — смены захвата (onLock) не будет
    this.locked = document.pointerLockElement === this.canvas;
    this.audio.start();
    this.started = true;
    this.emitHud(true);
  }

  render() {
    if (!this.disposed) this.scene.render();
  }

  private hallFog() {
    this.scene.fogColor = new Color3(0.085, 0.09, 0.075);
    this.scene.fogDensity = 0.045 + 0.03 * this.spec.darkness;
    this.scene.clearColor = new Color4(0.085, 0.09, 0.075, 1);
  }

  private baseFog() {
    this.scene.fogColor = new Color3(0.06, 0.07, 0.085);
    this.scene.fogDensity = 0.04;
    this.scene.clearColor = new Color4(0.06, 0.07, 0.085, 1);
  }

  // ───────────────────────── сборка ─────────────────────────

  /** Экземпляр модели набора (с подвижными частями — их крутит PropAnimator). */
  private put(id: string, x: number, y: number, z: number, rotY = 0, scale = 1, parent: TransformNode | null = null): Mesh | null {
    const t = this.props.get(id);
    if (!t) return null;
    const m = t.clone(`swamp:${id}:${this.n++}`, parent, false);
    m.setEnabled(true);
    m.isPickable = false;
    m.position.set(x, y, z);
    m.rotation.y = rotY;
    m.scaling.setAll(scale);
    return m;
  }

  private box(x0: number, z0: number, x1: number, z1: number) {
    this.boxes.push({ x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1) });
  }

  private mat(name: string, color: Color3, emissive?: Color3): StandardMaterial {
    const m = new StandardMaterial(name, this.scene);
    m.diffuseColor = color;
    m.specularColor = new Color3(0.04, 0.04, 0.04);
    if (emissive) m.emissiveColor = emissive;
    return m;
  }

  private cube(name: string, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: StandardMaterial, parent: TransformNode): Mesh {
    const b = MeshBuilder.CreateBox(name, { width: x1 - x0, height: y1 - y0, depth: z1 - z0 }, this.scene);
    b.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    b.material = mat;
    b.parent = parent;
    b.isPickable = false;
    return b;
  }

  private build() {
    this.hallRoot = new TransformNode('swamp:hall', this.scene);
    this.baseRoot = new TransformNode('swamp:base', this.scene);
    this.baseRoot.position.copyFrom(BASE);
    this.buildHall();
    this.buildBase();
    this.baseRoot.setEnabled(false);
    // в зале — капли грязи с перевёрнутого болота над игроком; у части (rainBase) — морось
    const rain = (this.rain = new ParticleSystem('swamp:rain', 1400, this.scene));
    rain.particleTexture = rainTexture(this.scene);
    rain.emitter = this.dripAt;
    rain.minEmitBox = new Vector3(-8, -0.05, -8);
    rain.maxEmitBox = new Vector3(8, 0, 8);
    rain.direction1 = new Vector3(-0.05, -4.5, 0.05);
    rain.direction2 = new Vector3(0.05, -6, -0.05);
    rain.gravity = new Vector3(0, -6, 0);
    rain.minSize = 0.03;
    rain.maxSize = 0.06;
    rain.minScaleY = 4;
    rain.maxScaleY = 7;
    rain.minLifeTime = 0.6;
    rain.maxLifeTime = 0.8;
    rain.emitRate = 260;
    rain.color1 = new Color4(0.42, 0.34, 0.2, 0.55);
    rain.color2 = new Color4(0.3, 0.25, 0.15, 0.4);
    rain.colorDead = new Color4(0.3, 0.25, 0.15, 0);
    rain.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    rain.billboardMode = ParticleSystem.BILLBOARDMODE_STRETCHED;
    rain.start();
    for (const m of this.scene.meshes) (m as AbstractMesh).isPickable = false;
    // в зале и у части — по 5–7 источников (у части свет зала выключен вместе с его корнем): без этого
    // StandardMaterial берёт только первые 4 и зубья у глаза остаются чёрными
    for (const m of this.scene.materials) (m as unknown as { maxSimultaneousLights: number }).maxSimultaneousLights = 8;
  }

  private buildHall() {
    const scene = this.scene;
    const root = this.hallRoot;
    const R = rng(this.roll.unit);
    const zc = (HZ0 + HZ1) / 2;
    // ── затопленный пол: тёмный бетон под водой набора
    const floorMat = this.mat('swamp:floorMat', new Color3(0.16, 0.16, 0.14));
    const floor = MeshBuilder.CreateGround('swamp:floor', { width: 2 * HX + 30, height: HZ1 - HZ0 + 30 }, scene);
    floor.position.set(0, WATER_Y, zc);
    floor.material = floorMat;
    floor.parent = root;
    const waterTpl = this.props.get('p_fac_water');
    const wsrc = waterTpl?.material instanceof StandardMaterial ? waterTpl.material.diffuseTexture : null;
    // текстура воды набора светлая — тёмная вода по щиколотку
    const wm = this.mat('swamp:hallWaterMat', new Color3(0.2, 0.22, 0.17));
    if (wsrc instanceof Texture) {
      const t = wsrc.clone();
      t.uScale = 14;
      t.vScale = 14;
      wm.diffuseTexture = t;
    }
    wm.specularColor = new Color3(0.22, 0.24, 0.2);
    wm.specularPower = 48;
    wm.alpha = 0.88;
    const water = MeshBuilder.CreateGround('swamp:hallWater', { width: 2 * HX + 30, height: HZ1 - HZ0 + 30 }, scene);
    water.position.set(0, 0, zc);
    water.material = wm;
    water.parent = root;

    // ── перевёрнутое болото над головой: грязь (лицом вниз), лужи, островки, камыш и сухие деревья вниз головой
    const mudMat = this.mat('swamp:ceilMudMat', new Color3(1, 1, 1));
    mudMat.diffuseTexture = mudTexture(scene);
    mudMat.specularColor = new Color3(0.1, 0.1, 0.08);
    const ceil = MeshBuilder.CreateGround('swamp:ceilMud', { width: 2 * HX + 30, height: HZ1 - HZ0 + 30 }, scene);
    ceil.rotation.x = Math.PI;
    ceil.position.set(0, CEIL, zc);
    ceil.material = mudMat;
    ceil.parent = root;
    /** модель вниз головой: её «пол» — грязь над головой */
    const hang = (id: string, x: number, z: number, rotY = 0, scale = 1, dy = 0): Mesh | null => {
      const m = this.put(id, x, CEIL + dy, z, rotY, scale, root);
      if (m) m.rotation.x = Math.PI;
      return m;
    };
    for (const [x, z, sc] of [[-6, 4, 1.4], [5.5, 6, 1.1], [-3, 12, 1.6], [6.5, 16, 1.3], [-8, 19, 1.5], [9, 22, 1.2], [2, 21, 1.4], [-10, 9, 1.0]] as const) {
      hang('p_fac_water', x, z, R() * Math.PI, sc, -0.003);
    }
    for (const [x, z, r] of [[-3.8, 7.5, 0.2], [4.8, 9.5, 1.1], [-7.5, 16.5, 2], [10.5, 14, 0.7], [-11, 3, 1.4], [1.5, 18, 2.6]] as const) hang('p_fac_mud', x, z, r, 1.3);
    // перевёрнутый настил — над настилом по воде
    for (let d = 1, k = 0; d < WALK_LEN; d += 2, k++) {
      const u = d / WALK_LEN;
      hang('p_fac_boardwalk', WALK.x0 + (WALK.x1 - WALK.x0) * u + 0.4, WALK.z0 + (WALK.z1 - WALK.z0) * u, -WALK_YAW + (k % 3 - 1) * 0.06, 1);
    }
    // камыш свисает гуще всего у шестерни — подъём идёт сквозь него
    for (let i = 0; i < 70; i++) {
      const x = (R() * 2 - 1) * (HX - 1), z = HZ0 + 4 + R() * (HZ1 - HZ0 - 5);
      if (Math.abs(x) < GEAR_R - 0.6 && Math.abs(z - GEAR.z) < 1.2) continue; // сквозь шестерню
      hang('p_fac_reeds', x, z, R() * Math.PI * 2, 1.0 + R() * 0.6, 0.05);
    }
    for (const [x, z] of [[GEAR_EDGE - 0.6, GEAR.z - 1.1], [GEAR_EDGE + 0.5, GEAR.z - 0.7], [GEAR_EDGE - 1.4, GEAR.z - 0.8], [GEAR_EDGE + 0.1, GEAR.z - 1.6]] as const) {
      hang('p_fac_reeds', x, z, R() * Math.PI * 2, 1.2, 0.05);
    }
    for (const [x, z, r, sc] of [[-5, 10, 0.3, 1.0], [7.5, 4.5, 1.9, 0.9], [9.5, 19, 0.8, 1.1], [-10, 17, 2.4, 1.0], [-2.5, 22, 1, 0.95], [-8.5, 5.5, 2.9, 0.85]] as const) {
      hang('p_fac_tree', x, z, r, sc, 0.1);
    }

    // ── стена с дверью, откуда пришёл: кирпич от воды до грязи, за проёмом — темнота
    const brick = this.mat('swamp:wallMat', new Color3(0.75, 0.75, 0.7));
    const damp = new Texture(dampUrl, scene);
    damp.uScale = 12;
    damp.vScale = 3;
    brick.diffuseTexture = damp;
    const concrete = this.mat('swamp:concrete', new Color3(0.36, 0.35, 0.33));
    const { z: dz, w: dw, h: dh } = DOOR;
    this.cube('swamp:wallL', -HX - 6, WATER_Y, dz - 0.3, -dw, CEIL + 0.3, dz, brick, root);
    this.cube('swamp:wallR', dw, WATER_Y, dz - 0.3, HX + 6, CEIL + 0.3, dz, brick, root);
    this.cube('swamp:lintel', -dw, dh, dz - 0.3, dw, CEIL + 0.3, dz, concrete, root);
    this.cube('swamp:doorDark', -dw - 0.3, WATER_Y, dz - 3.2, dw + 0.3, dh + 0.3, dz - 3.0, this.mat('swamp:void', Color3.Black()), root);
    for (const sx of [-1, 1]) this.cube('swamp:doorSide', sx * dw + (sx > 0 ? 0 : -0.3), WATER_Y, dz - 3.2, sx * dw + (sx > 0 ? 0.3 : 0), dh, dz - 0.3, concrete, root);
    this.box(-HX - 6, dz - 0.3, -dw - 0.02, dz);
    this.box(dw + 0.02, dz - 0.3, HX + 6, dz);
    this.box(-dw - 0.4, dz - 3.2, -dw, dz - 0.3);
    this.box(dw, dz - 3.2, dw + 0.4, dz - 0.3);
    this.box(-dw, dz - 3.4, dw, dz - 3.0);
    // границы зала (дальше — туман)
    this.box(-HX - 1, HZ0, -HX, HZ1 + 1);
    this.box(HX, HZ0, HX + 1, HZ1 + 1);
    this.box(-HX - 1, HZ1, HX + 1, HZ1 + 1);
    // лампа над дверью
    this.put('p_fac_lamp', 0, dh + 0.75, dz + 0.4, 0, 0.8, root);
    const doorLamp = new PointLight('swamp:doorLamp', new Vector3(0, dh + 0.3, dz + 1.8), scene);
    doorLamp.diffuse = SODIUM;
    doorLamp.specular = Color3.Black();
    doorLamp.falloffType = Light.FALLOFF_GLTF;
    doorLamp.range = 8;
    doorLamp.intensity = 1.3;
    doorLamp.parent = root;
    this.lamps.push({ light: doorLamp, base: 1.3, seed: 3 });

    // ── настил по воде от двери к шестерне
    for (let d = 1, k = 0; d < WALK_LEN; d += 2, k++) {
      const u = d / WALK_LEN;
      this.put('p_fac_boardwalk', WALK.x0 + (WALK.x1 - WALK.x0) * u, WATER_Y + 0.05, WALK.z0 + (WALK.z1 - WALK.z0) * u, WALK_YAW + (k % 3 - 1) * 0.04, 1, root);
    }

    // ── ржавые двутавры уходят в грязь
    for (const x of [-9, 9]) {
      for (const z of [4, 10, 16, 22]) {
        const c = this.put('p_fac_column', x, WATER_Y, z, 0, 1, root);
        if (c) c.scaling.set(1.4, (CEIL - WATER_Y + 0.2) / 2.5, 1.4);
        this.box(x - 0.2, z - 0.2, x + 0.2, z + 0.2);
      }
    }

    // ── большая шестерня: ротор набора, ось — вдоль z (лицом к игроку), поднимается из воды
    const rot = this.props.rotorsOf('p_fac_gear_large')[0];
    if (rot && rot.motion.kind === 'spin') {
      const holder = new TransformNode('swamp:gearHolder', scene);
      holder.parent = root;
      holder.position.set(0, GEAR.y, GEAR.z);
      holder.scaling.setAll(GEAR_SCALE);
      const g = (this.gear = rot.mesh.clone('swamp:bigGear', holder, true));
      g.makeGeometryUnique();
      const p = rot.motion.pivot;
      g.bakeTransformIntoVertices(Matrix.Translation(-p.x, -p.y, -p.z));
      g.setEnabled(true);
      g.position.setAll(0);
      g.rotationQuaternion = Quaternion.Identity();
      this.gearAxis = rot.motion.axis.clone();
      // знак: правая (+x мира) сторона обода должна идти вверх, к грязи
      holder.computeWorldMatrix(true);
      const W = holder.getWorldMatrix();
      const inv = W.clone().invert();
      const side = Vector3.TransformNormal(new Vector3(1, 0, 0), inv).normalize().scale(0.9);
      const q = Quaternion.RotationAxis(this.gearAxis, 0.02);
      const p0 = Vector3.TransformCoordinates(side, W), p1 = Vector3.TransformCoordinates(side.rotateByQuaternionToRef(q, new Vector3()), W);
      this.gearSign = p1.y > p0.y ? 1 : -1;
      // малая шестерня в зацеплении — слева от большой, крутится навстречу вдвое быстрее
      const rs = this.props.rotorsOf('p_fac_gear_small')[0];
      if (rs && rs.motion.kind === 'spin') {
        const h2 = new TransformNode('swamp:gearSmallHolder', scene);
        h2.parent = root;
        const r2 = (0.902 / 2) * GEAR_SCALE;
        h2.position.set(-(GEAR_R + r2 - 0.45), GEAR.y + 0.4, GEAR.z);
        h2.scaling.setAll(GEAR_SCALE);
        const g2 = (this.gearSmall = rs.mesh.clone('swamp:smallGear', h2, true));
        g2.makeGeometryUnique();
        const p2 = rs.motion.pivot;
        g2.bakeTransformIntoVertices(Matrix.Translation(-p2.x, -p2.y, -p2.z));
        g2.setEnabled(true);
        g2.position.setAll(0);
        g2.rotationQuaternion = Quaternion.Identity();
        this.gearSmallAxis = rs.motion.axis.clone();
      }
    }
    this.box(-GEAR_R - 2.0, GEAR.z - GEAR_T / 2 - 0.05, GEAR_EDGE - 0.55, GEAR.z + GEAR_T / 2 + 0.05);
    // рабочая лампа у шестерни — красноватая, мигает; столб стоит в воде
    const work = new PointLight('swamp:work', new Vector3(GEAR_EDGE + 1.6, 3.2, GEAR.z - 2.2), scene);
    work.diffuse = new Color3(1, 0.42, 0.22);
    work.specular = Color3.Black();
    work.falloffType = Light.FALLOFF_GLTF;
    work.range = 14;
    work.intensity = 8;
    work.parent = root;
    this.lamps.push({ light: work, base: 8, seed: 5 });
    const poleMat = this.mat('swamp:pole', new Color3(0.15, 0.15, 0.15));
    this.cube('swamp:workPole', GEAR_EDGE + 1.55, WATER_Y, GEAR.z - 2.25, GEAR_EDGE + 1.65, 3.3, GEAR.z - 2.15, poleMat, root);
    this.box(GEAR_EDGE + 1.4, GEAR.z - 2.4, GEAR_EDGE + 1.8, GEAR.z - 2.0);
    // ещё два фонаря на столбах в воде — тусклые, натриевые
    for (const [x, z, k] of [[-6.5, 7, 0.6], [7.5, 19, 0.5]] as const) {
      this.cube('swamp:lampPole', x - 0.05, WATER_Y, z - 0.05, x + 0.05, 3.0, z + 0.05, poleMat, root);
      this.put('p_fac_lamp', x, 3.6, z, 0, 0.8, root);
      const l = new PointLight('swamp:hallLamp', new Vector3(x, 2.85, z), scene);
      l.diffuse = SODIUM;
      l.specular = Color3.Black();
      l.falloffType = Light.FALLOFF_GLTF;
      l.range = 12;
      l.intensity = 9 * k;
      l.parent = root;
      this.lamps.push({ light: l, base: 9 * k, seed: 13 + x });
      this.box(x - 0.15, z - 0.15, x + 0.15, z + 0.15);
    }

    // ── механизмы в воде по краям (крутятся), бочки, металлолом
    for (const [x, z, r] of [[-HX + 0.6, 4, Math.PI / 2], [-HX + 0.6, 16, Math.PI / 2], [HX - 0.6, 10, -Math.PI / 2], [HX - 0.6, 22, -Math.PI / 2]] as const) {
      this.put('p_fac_fan', x, WATER_Y, z, r, 1.2, root);
      this.box(x - 0.4, z - 0.8, x + 0.4, z + 0.8);
    }
    this.put('p_fac_flywheel', -7, -0.35, 13, 0.4, 1.3, root);
    this.box(-8, 12.6, -6, 13.4);
    this.put('p_fac_gear_pair', 8.5, -0.5, 13, -0.6, 1.2, root);
    this.box(7, 12.2, 10, 13.8);
    this.put('p_fac_pump', -10.5, WATER_Y, 20, 0.3, 1, root);
    this.box(-11.6, 19.4, -9.4, 20.6);
    this.put('p_fac_shaft', 6, -0.15, 3, 0.3, 1, root);
    for (const [x, z, r] of [[-2.6, 2.4, 0.3], [3.2, 7.4, 1.2], [-4.4, 16.5, 2.1], [10.5, 5, 0.5], [-11.5, 23, 0]] as const) {
      this.put('p_fac_barrel', x, -0.3, z, r, 1, root);
      this.box(x - 0.32, z - 0.32, x + 0.32, z + 0.32);
    }
    for (const [x, z, r] of [[4.2, 1.6, 0.4], [-9, 2.5, 1.7], [11, 17, 2.6], [-3.5, 21, 0.9]] as const) this.put('p_fac_scrap', x, -0.2, z, r, 1.1, root);
    // течь — сверху, из грязи, в воду
    for (const [x, z] of [[-1.5, 5], [2.8, 10.5], [-5.5, 14], [5.5, 20]] as const) this.put('p_fac_leak', x, CEIL - 0.05, z, R() * Math.PI, 1, root);
  }

  private buildBase() {
    const scene = this.scene;
    const root = this.baseRoot;
    const R = rng(this.roll.unit + 7);
    // ── вода болота и берег
    const waterTpl = this.props.get('p_fac_water');
    const water = MeshBuilder.CreateGround('swamp:baseWater', { width: 60, height: 30 }, scene);
    water.position.set(0, 0, -12 + EMERGE_Z);
    water.parent = root;
    const wm = this.mat('swamp:baseWaterMat', new Color3(0.2, 0.23, 0.19));
    const wsrc = waterTpl?.material instanceof StandardMaterial ? waterTpl.material.diffuseTexture : null;
    if (wsrc instanceof Texture) {
      const t = wsrc.clone();
      t.uScale = 15;
      t.vScale = 7.5;
      wm.diffuseTexture = t;
      wm.diffuseColor = new Color3(0.22, 0.25, 0.2);
    }
    wm.specularColor = new Color3(0.25, 0.27, 0.25);
    wm.specularPower = 64;
    water.material = wm;
    const bankMat = this.mat('swamp:bankMat', new Color3(0.75, 0.82, 0.7));
    bankMat.diffuseTexture = mudTexture(scene);
    // склон берега от воды (z 1.5, y −0.5) до луга (z 6, y 0.35) и луг до забора и дальше
    const slope = MeshBuilder.CreateGround('swamp:bank', { width: 60, height: 4.6 }, scene);
    slope.position.set(0, -0.08, 3.8);
    slope.rotation.x = -Math.atan2(0.85, 4.5);
    slope.material = bankMat;
    slope.parent = root;
    const meadow = MeshBuilder.CreateGround('swamp:meadow', { width: 60, height: 34 }, scene);
    meadow.position.set(0, 0.35, 6 + 17);
    meadow.material = bankMat;
    meadow.parent = root;
    // камыш по берегу (впереди — прогал, сквозь который видна часть), сухие деревья, кочки
    for (let i = 0; i < 70; i++) {
      const x = (R() * 2 - 1) * 22, z = -8 + R() * 13;
      if (Math.abs(x) < 1.3 && z > -3) continue;
      this.put('p_fac_reeds', x, -0.1, z, R() * Math.PI * 2, 1.2 + R() * 0.6, root);
    }
    for (const [x, z] of [[-1.8, 2.2], [1.9, 2.6], [-2.6, 0.4], [2.4, -0.6]] as const) this.put('p_fac_reeds', x, -0.15, z, R() * 6, 1.5, root);
    for (const [x, z, r, s] of [[-7, -2, 0.4, 1.5], [6, -5, 1.4, 1.6], [-12, 3, 2.2, 1.4], [10, 1.5, 0.9, 1.5], [-4, -9, 2.6, 1.3]] as const) this.put('p_fac_tree', x, -0.2, z, r, s, root);
    for (const [x, z, r] of [[-4, -1.5, 0.2], [3.5, -3, 1.5], [7.5, 3, 0.4], [-9, -4.5, 2.4]] as const) this.put('p_fac_mud', x, -0.05, z, r, 1.4, root);

    // ── забор ПО-2 с колючей спиралью, ворота, КПП
    const fenceMat = this.mat('swamp:po2Mat', new Color3(1, 1, 1));
    fenceMat.diffuseTexture = fenceTexture(scene);
    const steel = this.mat('swamp:steel', new Color3(0.2, 0.22, 0.2));
    const PANEL = 4, PH = 2.5;
    for (let x = -30; x < 30; x += PANEL) {
      if (x + PANEL > -3 && x < 3) continue;
      const p = MeshBuilder.CreateBox('swamp:po2', { width: PANEL - 0.04, height: PH, depth: 0.16 }, scene);
      p.position.set(x + PANEL / 2, 0.35 + PH / 2, FENCE_Z);
      p.material = fenceMat;
      p.parent = root;
    }
    for (let x = -30; x <= 30; x += PANEL) {
      if (x > -3 && x < 3) continue;
      this.cube('swamp:post', x - 0.09, 0.35, FENCE_Z - 0.12, x + 0.09, 0.35 + PH + 0.5, FENCE_Z + 0.12, steel, root);
    }
    // колючая спираль: винтовая трубка вдоль верха забора (по обе стороны от ворот)
    const wireMat = this.mat('swamp:wire', new Color3(0.45, 0.46, 0.44));
    for (const [a, b] of [[-30, -3.2], [3.2, 30]] as const) {
      const path: Vector3[] = [];
      const turns = Math.round((b - a) / 0.22);
      for (let i = 0; i <= turns * 10; i++) {
        const u = i / 10, ang = u * Math.PI * 2;
        path.push(new Vector3(a + (u / turns) * (b - a) + 0.05 * Math.sin(ang), 0.35 + PH + 0.32 + 0.3 * Math.cos(ang), FENCE_Z + 0.3 * Math.sin(ang)));
      }
      const tube = MeshBuilder.CreateTube('swamp:wireCoil', { path, radius: 0.008, tessellation: 3 }, scene);
      tube.material = wireMat;
      tube.parent = root;
    }
    // ворота: две створки со звёздами, столбы
    const gm = this.mat('swamp:gateMat', new Color3(1, 1, 1));
    gm.diffuseTexture = gateTexture(scene);
    for (const s of [-1, 1]) {
      const leaf = MeshBuilder.CreateBox('swamp:gateLeaf', { width: 2.95, height: 2.5, depth: 0.08 }, scene);
      leaf.position.set(s * 1.5, 0.35 + 1.3, FENCE_Z);
      leaf.material = gm;
      leaf.parent = root;
      this.cube('swamp:gatePost', s * 3.05 - 0.15, 0.35, FENCE_Z - 0.15, s * 3.05 + 0.15, 0.35 + 3, FENCE_Z + 0.15, steel, root);
    }
    // КПП справа от ворот: будка с горящим окном
    const kpp = this.mat('swamp:kpp', new Color3(0.48, 0.5, 0.42));
    this.cube('swamp:kppBox', 3.4, 0.35, FENCE_Z - 0.6, 6.6, 3.1, FENCE_Z + 2.6, kpp, root);
    this.cube('swamp:kppRoof', 3.2, 3.1, FENCE_Z - 0.8, 6.8, 3.3, FENCE_Z + 2.8, steel, root);
    const win = MeshBuilder.CreatePlane('swamp:kppWindow', { width: 1.2, height: 0.8 }, scene);
    win.position.set(5, 1.9, FENCE_Z - 0.62);
    win.material = this.mat('swamp:kppWinMat', Color3.Black(), new Color3(0.95, 0.78, 0.42));
    win.parent = root;
    const kppLight = new PointLight('swamp:kppLight', new Vector3(5, 1.9, FENCE_Z - 1.4), scene);
    kppLight.diffuse = new Color3(1, 0.8, 0.5);
    kppLight.specular = Color3.Black();
    kppLight.range = 7;
    kppLight.intensity = 0.8;
    kppLight.parent = root;
    // таблички
    const plate = (name: string, tex: DynamicTexture, x: number, y: number, w: number, hgt: number) => {
      const m = this.mat(name + 'Mat', new Color3(1, 1, 1));
      m.diffuseTexture = tex;
      m.emissiveColor = new Color3(0.12, 0.12, 0.12);
      const pl = MeshBuilder.CreatePlane(name, { width: w, height: hgt }, scene);
      pl.position.set(x, y, FENCE_Z - 0.1);
      pl.material = m;
      pl.parent = root;
    };
    plate('swamp:unitSign', signTexture(scene, 'swamp:unitTex', ['ВОЙСКОВАЯ ЧАСТЬ', `№ ${this.roll.unit}`], '#1c2a1a', '#e8dcb0', '#c9a640'), -5, 1.75, 2.1, 0.8);
    plate('swamp:stopSign', signTexture(scene, 'swamp:stopTex', ['СТОЙ!', 'ЗАПРЕТНАЯ ЗОНА'], '#e8e2d0', '#b3201a', '#b3201a'), -13, 1.6, 1.6, 0.6);
    plate('swamp:stopSign2', signTexture(scene, 'swamp:stopTex2', ['СТОЙ!', 'ЗАПРЕТНАЯ ЗОНА'], '#e8e2d0', '#b3201a', '#b3201a'), 13, 1.6, 1.6, 0.6);
    // фонари за забором и над воротами
    for (const [x, z, k] of [[-9, FENCE_Z + 3, 0.6], [-1.2, FENCE_Z - 1.2, 0.7], [10, FENCE_Z + 3, 0.5], [-20, FENCE_Z + 3, 0.4], [-14, FENCE_Z - 1.2, 0.45]] as const) {
      this.cube('swamp:lampPole', x - 0.06, 0.35, z - 0.06, x + 0.06, 5.2, z + 0.06, steel, root);
      const bulb = MeshBuilder.CreateSphere('swamp:lampBulb', { diameter: 0.28, segments: 6 }, scene);
      bulb.position.set(x, 5.1, z - 0.3);
      bulb.material = this.mat('swamp:lampBulbMat', Color3.Black(), SODIUM);
      bulb.parent = root;
      const l = new PointLight('swamp:lamp', new Vector3(x, 5, z - 0.4), scene);
      l.diffuse = SODIUM;
      l.specular = Color3.Black();
      l.falloffType = Light.FALLOFF_GLTF;
      l.range = 16;
      l.intensity = 30 * k;
      l.parent = root;
      this.lamps.push({ light: l, base: 30 * k, seed: 11 + x });
    }
    // радиоточка — репродуктор на столбе у КПП
    this.cube('swamp:radioPole', 7.5, 0.35, FENCE_Z - 1.06, 7.62, 4.6, FENCE_Z - 0.94, steel, root);
    const horn = MeshBuilder.CreateCylinder('swamp:horn', { diameterTop: 0.08, diameterBottom: 0.5, height: 0.6, tessellation: 12 }, scene);
    horn.rotation.x = Math.PI / 2;
    horn.position.set(7.56, 4.4, FENCE_Z - 1.4);
    horn.material = this.mat('swamp:hornMat', new Color3(0.35, 0.38, 0.33));
    horn.parent = root;

    // ── вышка с прожектором
    const tw = { x: 11, z: FENCE_Z + 3 };
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) this.cube('swamp:towerLeg', tw.x + dx - 0.07, 0.35, tw.z + dz - 0.07, tw.x + dx + 0.07, 6.3, tw.z + dz + 0.07, steel, root);
    const cab = this.mat('swamp:cab', new Color3(0.3, 0.33, 0.27));
    this.cube('swamp:towerFloor', tw.x - 1.3, 6.2, tw.z - 1.3, tw.x + 1.3, 6.35, tw.z + 1.3, steel, root);
    this.cube('swamp:towerCabLow', tw.x - 1.2, 6.35, tw.z - 1.2, tw.x + 1.2, 7.3, tw.z + 1.2, cab, root);
    for (const [dx, dz] of [[-1.15, -1.15], [1.15, -1.15], [-1.15, 1.15], [1.15, 1.15]] as const) this.cube('swamp:towerPost', tw.x + dx - 0.05, 7.3, tw.z + dz - 0.05, tw.x + dx + 0.05, 8.3, tw.z + dz + 0.05, steel, root);
    const roofCone = MeshBuilder.CreateCylinder('swamp:towerRoof', { diameterTop: 0, diameterBottom: 3.6, height: 0.9, tessellation: 4 }, scene);
    roofCone.position.set(tw.x, 8.75, tw.z);
    roofCone.rotation.y = Math.PI / 4;
    roofCone.material = steel;
    roofCone.parent = root;
    const red = MeshBuilder.CreateSphere('swamp:towerRed', { diameter: 0.18, segments: 6 }, scene);
    red.position.set(tw.x, 9.3, tw.z);
    red.material = this.mat('swamp:redMat', Color3.Black(), new Color3(1, 0.1, 0.05));
    red.parent = root;
    // прожектор: поворотная голова, конус луча (без записи глубины, светится), сам свет
    const pivot = new TransformNode('swamp:beamPivot', scene);
    pivot.parent = root;
    pivot.position.set(tw.x, 7.6, tw.z - 1.3);
    const head = MeshBuilder.CreateCylinder('swamp:beamHead', { diameter: 0.5, height: 0.5, tessellation: 12 }, scene);
    head.rotation.x = Math.PI / 2;
    head.material = steel;
    head.parent = pivot;
    const lens = MeshBuilder.CreateDisc('swamp:beamLens', { radius: 0.22, tessellation: 16 }, scene);
    lens.position.z = -0.26;
    lens.rotation.y = Math.PI;
    lens.material = this.mat('swamp:lensMat', Color3.Black(), new Color3(1, 0.97, 0.85));
    lens.parent = pivot;
    const coneMat = new StandardMaterial('swamp:beamConeMat', scene);
    coneMat.disableLighting = true;
    coneMat.emissiveColor = new Color3(0.85, 0.85, 0.75);
    coneMat.alpha = 0.07;
    coneMat.disableDepthWrite = true;
    coneMat.backFaceCulling = false;
    coneMat.alphaMode = Constants.ALPHA_ADD;
    const cone = MeshBuilder.CreateCylinder('swamp:beamCone', { diameterTop: 5, diameterBottom: 0.4, height: 26, tessellation: 20, cap: Mesh.NO_CAP }, scene);
    cone.rotation.x = -Math.PI / 2;
    cone.position.z = -13.2;
    cone.material = coneMat;
    cone.parent = pivot;
    const spot = new SpotLight('swamp:beam', Vector3.Zero(), new Vector3(0, 0, -1), 0.28, 8, scene);
    spot.diffuse = new Color3(1, 0.97, 0.88);
    spot.specular = Color3.Black();
    spot.range = 45;
    spot.intensity = 1.5;
    spot.parent = pivot;
    this.beam = { pivot, light: spot, cone };
  }

  private buildOverlay() {
    const scene = this.scene;
    const plane = (name: string, mat: StandardMaterial, z: number, idx: number): Mesh => {
      const p = MeshBuilder.CreatePlane(name, { size: 2 }, scene);
      p.material = mat;
      p.parent = this.camera;
      p.position.set(0, 0, z);
      p.renderingGroupId = 1;
      p.alphaIndex = idx;
      p.isPickable = false;
      return p;
    };
    const flat = (name: string, c: Color3): StandardMaterial => {
      const m = new StandardMaterial(name, scene);
      m.disableLighting = true;
      m.emissiveColor = c;
      m.alpha = 0;
      m.disableDepthWrite = true;
      m.fogEnabled = false;
      return m;
    };
    const drip = flat('swamp:dripMat', new Color3(1, 1, 1));
    drip.diffuseTexture = dropsTexture(scene);
    drip.emissiveTexture = drip.diffuseTexture;
    drip.useAlphaFromDiffuseTexture = true;
    drip.opacityTexture = drip.diffuseTexture;
    const mud = flat('swamp:mudVeil', new Color3(0.15, 0.1, 0.045));
    mud.emissiveTexture = mudTexture(scene);
    (mud.emissiveTexture as Texture).uScale = (mud.emissiveTexture as Texture).vScale = 1.4;
    mud.emissiveColor = new Color3(0.45, 0.35, 0.2);
    const dark = flat('swamp:darkVeil', Color3.Black());
    const glare = flat('swamp:glareVeil', new Color3(1, 0.97, 0.86));
    glare.alphaMode = Constants.ALPHA_ADD;
    plane('swamp:drip', drip, 0.1, 1);
    plane('swamp:mudPlaneVeil', mud, 0.1, 2);
    plane('swamp:dark', dark, 0.1, 3);
    plane('swamp:glare', glare, 0.1, 4);
    this.overlay = { mud, dark, drip, glare };
  }

  // ───────────────────────── кадр ─────────────────────────

  private beforeRender() {
    const now = performance.now();
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 1 / 60;
    this.last = now;
    if (!this.manual && this.ready) this.simulate(dt);
    this.sync();
  }

  /** Угол шестерни по времени в зале: рывок на зуб в начале каждого периода. */
  private gearAngleAt(time: number): number {
    const T = this.spec.toothS;
    const n = Math.floor(time / T), f = (time - n * T) / T;
    const k = f < 0.35 ? (1 - Math.cos((f / 0.35) * Math.PI)) / 2 : 1;
    return this.gearSign * ((2 * Math.PI) / GEAR.teeth) * (n + k);
  }

  simulate(dt: number, input?: Input) {
    if (this.disposed || this.exited || !this.ready) return;
    this.time += dt;
    for (const l of this.lamps) {
      const f = Math.sin(this.time * (3 + l.seed) + l.seed * 7) * Math.sin(this.time * 0.37 * l.seed + l.seed);
      l.light.intensity = l.base * (f > 0.9 ? 0.3 : 1);
    }
    let gearPulse = 0;
    if (this.endT === null) {
      this.gearAngle = this.gearAngleAt(this.time);
      const tooth = Math.floor(this.time / this.spec.toothS);
      if (tooth !== this.lastTooth) {
        this.lastTooth = tooth;
        const d = Math.hypot(this.pos.x - GEAR_EDGE, this.pos.z - GEAR.z);
        this.audio.tooth(Math.max(0.15, 1 - d / 30));
      }
      gearPulse = Math.max(0, 1 - ((this.time / this.spec.toothS) % 1) / 0.35);
      if (this.started || this.manual) this.move(dt, input ?? this.readKeys());
      if (this.inStepZone() && !this.exited) this.startEnd();
      else if (this.pos.z < DOOR.z - 0.45 && Math.abs(this.pos.x) < DOOR.w) {
        this.exited = true;
        if (document.pointerLockElement === this.canvas) document.exitPointerLock();
        this.emitHud(true);
        this.opts.onExit?.('back');
        return;
      }
    } else {
      this.endT += dt;
      const p = endPose(this.endT, EYE);
      // зуб под ногами остаётся под ногами: шестерня доворачивается на столько, на сколько поднялся зуб по ободу
      this.gearAngle = this.gearAt0 + this.gearSign * (this.liftPhi(p.y) - PHI0);
      gearPulse = this.endT < END_LIFT_S ? 1 : 0;
      this.cues(this.endT, p);
      this.beamFrame(p);
    }
    if (this.gear) Quaternion.RotationAxisToRef(this.gearAxis, this.gearAngle, this.gear.rotationQuaternion!);
    if (this.gearSmall) Quaternion.RotationAxisToRef(this.gearSmallAxis, -2 * this.gearAngle + 0.13, this.gearSmall.rotationQuaternion!);
    const p = this.endT === null ? null : endPose(this.endT, EYE);
    this.audio.frame(dt, {
      muffle: p ? Math.max(p.mud, p.dark) : 0,
      heart: p && (p.phase === 'under' || p.phase === 'lift') ? Math.min(1, p.dark + 0.3) : p?.phase === 'emerge' ? 0.4 : 0,
      gear: gearPulse,
      radio: p && p.place === 'base' ? Math.min(1, (this.endT! - END_SWITCH_S) / 6) : 0,
    });
    if (performance.now() - this.hudAt > 150) this.emitHud();
  }

  /** Звуки и смена места по ходу сценария (каждое — один раз). */
  private cues(t: number, p: EndPose) {
    const once = (key: string, at: number, f: () => void) => {
      if (t >= at && !this.fired.has(key)) {
        this.fired.add(key);
        f();
      }
    };
    once('clunk', 0, () => this.audio.sfx('clunk'));
    once('press', END_STEP_S, () => this.audio.sfx('press'));
    once('squelch', END_STEP_S + 1.6, () => this.audio.sfx('squelch'));
    once('squelch2', END_LIFT_S - 0.4, () => this.audio.sfx('squelch'));
    once('switch', END_SWITCH_S, () => {
      this.where = 'base';
      this.hallRoot.setEnabled(false);
      this.baseRoot.setEnabled(true);
      this.baseFog();
      // у части — морось сверху, а не капли грязи
      this.rain.minEmitBox.set(-9, 6, -9);
      this.rain.maxEmitBox.set(9, 8, 9);
      this.rain.direction1.set(-0.4, -9, 0.3);
      this.rain.direction2.set(-0.2, -11, 0.5);
      this.rain.gravity.setAll(0);
      this.rain.minScaleY = 9;
      this.rain.maxScaleY = 14;
      this.rain.color1.set(0.7, 0.75, 0.8, 0.22);
      this.rain.color2.set(0.6, 0.66, 0.7, 0.14);
      this.rain.colorDead.set(0.5, 0.5, 0.5, 0);
      this.rain.emitRate = 600;
      this.audio.base();
      this.emitHud(true);
    });
    once('splash', END_UNDER_S + 0.9, () => this.audio.sfx('splash'));
    once('gasp', END_UNDER_S + 1.25, () => this.audio.sfx('gasp'));
    once('gasp2', END_UNDER_S + 2.3, () => this.audio.sfx('gasp'));
    for (let k = 0; k < 5; k++) once('paddle' + k, END_EMERGE_S + 0.3 + k * 1.1, () => this.audio.sfx('paddle'));
    once('beam', END_LOOK_S - 1.2, () => this.audio.sfx('beam'));
    once('title', END_LOOK_S + 0.8, () => this.emitHud(true));
    if (p.phase === 'done' && !this.fired.has('done')) {
      this.fired.add('done');
      this.emitHud(true);
    }
  }

  /** Прожектор: ходит по болоту, к концу находит игрока. */
  private beamFrame(p: EndPose) {
    if (!this.beam || this.where !== 'base') return;
    const t = this.endT!;
    const find = Math.min(1, Math.max(0, (t - (END_LOOK_S - 1.5)) / 1.6));
    // ходит по болоту перед вышкой (луч смотрит по −z головы: рысканье ψ — на (−sin ψ, −cos ψ))
    const sweep = 0.6 + 0.5 * Math.sin(t * 0.45);
    // на игрока: от головы прожектора к глазу (по позе, не по камере — та ставится после шага)
    const piv = this.beam.pivot.position;
    const dx = 0 - piv.x, dz = EMERGE_Z + p.z - piv.z, dy = p.y - piv.y;
    let toEye = Math.atan2(dx, dz) - Math.PI;
    if (toEye < -Math.PI) toEye += 2 * Math.PI;
    this.beamYaw = sweep * (1 - find) + toEye * find;
    const pitchTo = Math.atan2(-dy, Math.hypot(dx, dz));
    this.beam.pivot.rotation.set(-0.32 * (1 - find) - pitchTo * find, this.beamYaw, 0);
  }

  private inStepZone(): boolean {
    return Math.hypot(this.pos.x - STEP_ZONE.x, this.pos.z - STEP_ZONE.z) < STEP_ZONE.r;
  }

  /** Шаг на зуб: начало сценария. */
  startEnd() {
    if (this.endT !== null) return;
    this.endT = 0;
    this.gearAt0 = this.gearAngle;
    this.pos = { x: GEAR_EDGE, z: GEAR.z - 0.25 };
    this.camera.rotation.set(0, HALL_YAW, 0);
    this.keys.clear();
    this.emitHud(true);
  }

  /** Высота «пола» под ногами: настил, зуб у шестерни, иначе — пол под водой (по щиколотку). */
  ground(x: number, z: number): number {
    if (this.onWalk(x, z, 0.56)) return 0.32;
    if (Math.hypot(x - STEP_ZONE.x, z - STEP_ZONE.z) < STEP_ZONE.r + 0.3) return TOOTH_Y;
    return WATER_Y;
  }

  /** Угол на ободе зуба под ногами по высоте глаза (подъём сценария), рад от +x. */
  private liftPhi(eyeY: number): number {
    const s = Math.min(0.94, Math.max(-1, (eyeY - EYE - GEAR.y) / GEAR_R));
    return Math.asin(s);
  }

  /** Точка на настиле (полоса ширины 2·half вдоль пути от люка к шестерне). */
  onWalk(x: number, z: number, half: number): boolean {
    const dx = WALK.x1 - WALK.x0, dz = WALK.z1 - WALK.z0;
    const u = ((x - WALK.x0) * dx + (z - WALK.z0) * dz) / (WALK_LEN * WALK_LEN);
    if (u < -0.02 || u > 1.02) return false;
    return Math.abs((x - WALK.x0) * dz - (z - WALK.z0) * dx) / WALK_LEN < half;
  }

  private move(dt: number, inp: Input) {
    const yaw = this.camera.rotation.y;
    const g = this.ground(this.pos.x, this.pos.z);
    const sp = (g > 0.2 ? BOARD : WADE) * (inp.run ? 1.5 : 1);
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const dx = (fx * inp.f + fz * inp.s) * sp * dt, dz = (fz * inp.f - fx * inp.s) * sp * dt;
    const [x, z] = collide2(this.pos.x + dx, this.pos.z + dz, BODY_R, this.boxes);
    const moved = Math.hypot(x - this.pos.x, z - this.pos.z);
    this.pos.x = x;
    this.pos.z = z;
    this.stepAcc += moved;
    if (this.stepAcc > 0.75) {
      this.stepAcc = 0;
      this.audio.sfx(g > 0.2 ? 'step' : 'squelch');
    }
    const target = this.ground(x, z) + EYE + (g < 0 ? 0.03 * Math.sin(this.time * 7) * Math.min(1, moved / Math.max(1e-6, dt) / WADE) : 0);
    this.eyeY += (target - this.eyeY) * Math.min(1, dt * 8);
  }

  private sync() {
    const c = this.camera;
    const o = this.overlay;
    if (this.endT !== null) {
      const p = endPose(this.endT, EYE);
      const sh = p.shake * 0.06;
      const j = () => (Math.random() - 0.5) * sh;
      if (p.place === 'hall') c.position.set(GEAR_R * Math.cos(this.liftPhi(p.y)) + j(), p.y + j(), this.pos.z + j());
      else c.position.set(BASE.x + j(), BASE.y + p.y + j(), BASE.z + EMERGE_Z + p.z + j());
      if (p.phase !== 'done') {
        c.rotation.x = -p.pitch;
        c.rotation.y = (p.place === 'hall' ? HALL_YAW : 0) + p.yaw;
        c.rotation.z = p.roll;
      }
      o.mud.alpha = p.mud * 0.97;
      o.dark.alpha = p.dark;
      o.drip.alpha = p.drip * 0.9;
      o.glare.alpha = p.glare;
      this.eyeLamp.intensity = p.place === 'hall' ? 1.6 * (1 - p.mud) : 0;
      return;
    }
    o.mud.alpha = o.dark.alpha = o.drip.alpha = o.glare.alpha = 0;
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

  hud(): SwampHud {
    const p = this.endT === null ? null : endPose(this.endT, EYE);
    const dGear = Math.hypot(this.pos.x - STEP_ZONE.x, this.pos.z - STEP_ZONE.z);
    let prompt: string | null = null;
    if (!p) {
      if (dGear < 4.5) prompt = 'Встань на зуб шестерни — у самой грязи';
      else if (this.pos.z < 1.6 && Math.abs(this.pos.x) < 1.6) prompt = 'Назад — в дверь, на завод';
    }
    return {
      loading: !this.ready && !this.error,
      error: this.error,
      started: this.started,
      locked: this.locked,
      phase: this.exited ? 'exit' : p ? 'end' : 'walk',
      end: p ? p.phase : null,
      title: p ? p.title : 0,
      titles: endTitles(this.roll),
      prompt,
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
    this.pos = { x, z };
    this.eyeY = this.ground(x, z) + EYE;
    if (yaw !== undefined) this.camera.rotation.y = yaw;
    if (pitch !== undefined) this.camera.rotation.x = pitch;
    this.sync();
  }

  qaState() {
    return {
      pos: { ...this.pos },
      eyeY: this.eyeY,
      endT: this.endT,
      place: this.where,
      exited: this.exited,
      gearAngle: this.gearAngle,
      gearSign: this.gearSign,
      gearEdge: GEAR_EDGE,
      stepZone: { ...STEP_ZONE },
      hud: this.hud(),
      boxes: this.boxes.length,
      rotors: this.props.animated,
      models: this.props.size,
      audio: this.audio.counters,
      end: END_TITLE_S,
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
    this.rain?.dispose();
    this.props.dispose();
    this.scene.dispose();
  }
}
