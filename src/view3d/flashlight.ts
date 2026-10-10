// Фонарик «Прогулки»: модель карманного фонаря (советский, из примитивов) и свет.
//  • В руке (Flashlight): модель у камеры справа внизу, как керосиновая лампа общаги (HeldLantern, ./obshagaScene.ts) и
//    руки в снегу (CrawlHands, ./snowHands.ts): группа рендера 1 — Babylon перед ней очищает глубину и стенсил
//    (RenderingManager: autoClear у групп > 0 по умолчанию), поэтому модель рисуется поверх стен и не проваливается в
//    стену, к которой игрок подошёл вплотную; alwaysSelectAsActiveMesh, isPickable = false, слой 0x0fffffff (не
//    PORTAL_LAYER — её рисует сама камера). Кулак в вязаной перчатке и рукав ватника уходят за край кадра.
//    Покачивание на ходу (сильнее на бегу: рука «качает», луч прыгает по полу), запаздывание за поворотом взгляда;
//    на четвереньках фонарь уходит вниз из кадра (руки там — CrawlHands), свет остаётся.
//  • Свет — SpotLight от линзы вперёд (пятно ~34°, мягкий спад pow(cos, 16) до края конуса 69°, 16 м, тёплый #fff0d0): у камеры, ближе к
//    глазу, чем модель, — не уходит в стену; сходится к прицелу метрах в пяти. Яркость — по свету сцены: в тёмных
//    биомах (BiomeMood гасит hemi) — полная, в освещённых комнатах — слабее (не пересвечивает). Включение — щелчок
//    (WebAudio, без файлов) и короткое моргание лампочки, ползунок выключателя сдвигается.
//  • Лимит источников у материалов: у StandardMaterial по умолчанию maxSimultaneousLights = 4, а в сцене бывает больше
//    (hemi, sun, лампа биома 'mood:lamp', лампы общаги, фонарь, лежащие горящие фонари) — лишние источники молча
//    отбрасываются, и какой именно — зависит от порядка включения (Babylon дописывает включённый источник в конец списка
//    меша). ensureLightSlots поднимает предел у всех материалов сцены, в том числе созданных потом.
//  • FlashlightModel (размеры — FLASH) — фонарь у аватаров кооп (src/coop/presence.ts). Фонарь П-2 в руке игрока и на
//    полу — модель лута (./heldItem.ts, ./worldItems.ts; конус, спад и яркость по сцене — отсюда: FLASH_*,
//    flashIntensity, sceneLitness), щелчок — switchClick.
//
// ИНТЕГРАЦИЯ:
//   const f = new Flashlight(viewer.scene, viewer.fps);
//   f.setHeld(true);  f.setOn(!f.on);           // взял в руки (хотбар) / клавиша
//   f.update(dt, { speed, sprint, crawl });       // КАЖДЫЙ кадр (speed — м/с по горизонтали, sprint и crawl — 0…1)
//   f.setSide(-1);                                // в левую руку (правая занята: керосиновая лампа общаги)
//   f.dispose();
import type { Scene } from '@babylonjs/core/scene';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import type { Material } from '@babylonjs/core/Materials/material';
import type { Observer } from '@babylonjs/core/Misc/observable';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { SpotLight } from '@babylonjs/core/Lights/spotLight';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';

// ───────────────────────── свет ─────────────────────────

/** Цвет лампочки: тёплый белый #fff0d0. */
export const FLASH_COLOR = new Color3(1, 0.94, 0.816);
/** Конус (полный угол, рад), спад pow(cos, экспонента) и дальность, м. Пятно (половина яркости) — ~34°, край конуса
 *  (у StandardMaterial он резкий) — на 5% яркости, почти незаметен. */
export const FLASH_ANGLE = 1.2;
export const FLASH_EXP = 16;
export const FLASH_RANGE = 16;
/** Яркость в темноте и в освещённой комнате (hemi на полную). */
export const FLASH_I_DARK = 1.25;
export const FLASH_I_LIT = 0.5;
/** Яркость hemi просмотрщика «как было» (src/view3d/viewer.ts) — «полностью освещено». */
const HEMI_FULL = 0.85;
/** Сколько источников держат материалы сцены (hemi, sun, лампа биома, лампы общаги, фонарь, 2 лежащих фонаря). */
export const LIGHT_SLOTS = 8;
/** Ключ localStorage: '0' — щелчок выключателя без звука. */
export const FLASHLIGHT_SOUND_KEY = 'room-forge/flashlight-sound';

const slotsOf = new WeakMap<Scene, { n: number; obs: Observer<Material> }>();

/**
 * Поднять maxSimultaneousLights у всех материалов сцены до n — сейчас и у новых (onNewMaterialAddedObservable: Babylon
 * оповещает на следующем тике, когда материал уже собран). Понижать не будет. Повторный вызов — дёшево.
 */
export function ensureLightSlots(scene: Scene, n = LIGHT_SLOTS) {
  const bump = (m: Material) => {
    const x = m as Material & { maxSimultaneousLights?: number };
    if (typeof x.maxSimultaneousLights === 'number' && x.maxSimultaneousLights < n) x.maxSimultaneousLights = n;
  };
  const s = slotsOf.get(scene);
  if (s && s.n >= n) return;
  for (const m of scene.materials) bump(m);
  if (s) {
    s.n = n;
    scene.onNewMaterialAddedObservable.remove(s.obs);
  }
  const obs = scene.onNewMaterialAddedObservable.add((m) => bump(m));
  slotsOf.set(scene, { n, obs });
}

/** Насколько освещена сцена 0…1 (по hemi просмотрщика; нет его — темно). */
export function sceneLitness(scene: Scene): number {
  const h = scene.getLightByName('hemi');
  if (!h || !h.isEnabled()) return 0;
  return Math.min(1, Math.max(0, h.intensity / HEMI_FULL));
}

/** Яркость фонаря при освещённости сцены lit 0…1. */
export function flashIntensity(lit: number): number {
  return FLASH_I_DARK + (FLASH_I_LIT - FLASH_I_DARK) * Math.min(1, Math.max(0, lit));
}

// ───────────────────────── модель ─────────────────────────

/**
 * Размеры фонаря, м. Оси модели: z — вперёд (к линзе), y — вверх (выключатель сверху), начало — на оси, середина
 * корпуса (там его держат).
 */
export const FLASH = {
  /** задний край колпачка и кольцо темляка */
  tailZ: -0.078,
  ringZ: -0.083,
  /** корпус (батарейки), раструб, голова, ободок */
  bodyZ0: -0.07,
  bodyZ1: 0.03,
  bodyR: 0.0165,
  tailR: 0.0155,
  headZ0: 0.046,
  headZ1: 0.066,
  headR: 0.0235,
  bezelZ1: 0.073,
  bezelR: 0.025,
  /** линза (передняя плоскость) и её радиус */
  lensZ: 0.0733,
  lensR: 0.02,
  /** ползунок выключателя: z при выкл / вкл */
  knobOff: 0.001,
  knobOn: 0.015,
} as const;

/** Фонарь лежит на боку: опоры — колпачок и ободок; ось поднята к голове на угол tilt, над полом в начале — axisY. */
export const FLASH_LIE = (() => {
  const tilt = Math.atan((FLASH.bezelR - FLASH.tailR) / (FLASH.bezelZ1 - FLASH.tailZ));
  // нижняя точка обода колпачка после наклона: −r·cos(tilt) + tailZ·sin(tilt) — на полу
  return { tilt, axisY: FLASH.tailR * Math.cos(tilt) - FLASH.tailZ * Math.sin(tilt) };
})();

interface FlashKit {
  refs: number;
  mats: StandardMaterial[];
  lensOff: StandardMaterial;
  lensOn: StandardMaterial;
  tex: RawTexture;
  /** шаблоны частей (выключены): корпус, металл, наклейка, ползунок, линза */
  parts: { body: Mesh; metal: Mesh; label: Mesh; knob: Mesh; lens: Mesh };
}

const kits = new WeakMap<Scene, FlashKit>();

/** Отражатель за стеклом: лампочка в центре, кольца рефлектора, тёмный край — RGBA n×n. */
function lensPixels(n = 64): Uint8Array {
  const a = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const u = ((x + 0.5) / n) * 2 - 1, v = ((y + 0.5) / n) * 2 - 1;
      const r = Math.hypot(u, v);
      const bulb = Math.exp(-((r / 0.17) ** 2));
      let k = 0.42 + 0.3 * (1 - r) + 0.1 * Math.cos(r * 21) + 0.75 * bulb;
      if (r > 0.92) k *= 0.45;
      k = Math.min(1, Math.max(0, k));
      const i = (y * n + x) * 4;
      a[i] = Math.round(255 * k);
      a[i + 1] = Math.round(255 * k * 0.96);
      a[i + 2] = Math.round(255 * k * (0.84 + 0.16 * bulb));
      a[i + 3] = 255;
    }
  return a;
}

function mat(scene: Scene, name: string, diffuse: Color3, spec: number, power = 32): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = diffuse;
  m.specularColor = new Color3(spec, spec, spec * 0.95);
  m.specularPower = power;
  return m;
}

/** Часть фонаря вдоль оси z: от z0 до z1, радиусы у заднего (r0) и переднего (r1) края. */
function axial(scene: Scene, z0: number, z1: number, r0: number, r1: number, seg = 18): Mesh {
  const m = CreateCylinder('flash:part', { height: z1 - z0, diameterBottom: r0 * 2, diameterTop: r1 * 2, tessellation: seg }, scene);
  // ось цилиндра y → z (RotationX(π/2) переводит +y в +z)
  m.rotation.x = Math.PI / 2;
  m.position.z = (z0 + z1) / 2;
  return m;
}

function merged(parts: Mesh[], name: string, material: Material): Mesh {
  const m = parts.length === 1 ? parts[0] : Mesh.MergeMeshes(parts, true, true)!;
  if (parts.length === 1) {
    // одна часть — запечь её трансформацию в вершины, как у слитых
    m.bakeCurrentTransformIntoVertices();
  }
  m.name = name;
  m.material = material;
  m.isPickable = false;
  m.checkCollisions = false;
  m.setEnabled(false);
  return m;
}

function acquireKit(scene: Scene): FlashKit {
  const hit = kits.get(scene);
  if (hit && !hit.parts.body.isDisposed()) {
    hit.refs++;
    return hit;
  }
  const F = FLASH;
  const plastic = mat(scene, 'flash:plastic', new Color3(0.12, 0.135, 0.115), 0.16, 24);
  plastic.emissiveColor = new Color3(0.012, 0.013, 0.011);
  const metal = mat(scene, 'flash:metal', new Color3(0.5, 0.5, 0.47), 0.75, 72);
  metal.emissiveColor = new Color3(0.03, 0.03, 0.028);
  const label = mat(scene, 'flash:label', new Color3(0.46, 0.15, 0.1), 0.08, 16);
  const knob = mat(scene, 'flash:knob', new Color3(0.55, 0.12, 0.07), 0.25, 32);
  const tex = RawTexture.CreateRGBATexture(lensPixels(), 64, 64, scene, false, false, Texture.BILINEAR_SAMPLINGMODE);
  tex.name = 'flash:lensTex';
  const lensOff = mat(scene, 'flash:lensOff', new Color3(0.62, 0.62, 0.58), 0.9, 96);
  lensOff.diffuseTexture = tex;
  lensOff.emissiveColor = new Color3(0.02, 0.02, 0.018);
  const lensOn = new StandardMaterial('flash:lensOn', scene);
  lensOn.diffuseColor = Color3.Black();
  lensOn.specularColor = Color3.Black();
  lensOn.emissiveTexture = tex;
  lensOn.emissiveColor = FLASH_COLOR.scale(0.95);
  lensOn.disableLighting = true;

  const body = merged(
    [
      axial(scene, F.bodyZ0, F.bodyZ1, F.bodyR, F.bodyR),
      axial(scene, F.bodyZ1, F.headZ0, F.bodyR, F.headR), // раструб
      axial(scene, F.headZ0, F.headZ1, F.headR, F.headR),
    ],
    'flash:body',
    plastic,
  );
  // металл: колпачок, ободок, кольцо темляка, направляющая выключателя
  const ring = CreateTorus('flash:part', { diameter: 0.012, thickness: 0.0025, tessellation: 10 }, scene);
  ring.rotation.z = Math.PI / 2;
  ring.position.set(0, 0, F.ringZ);
  const rail = CreateBox('flash:part', { width: 0.009, height: 0.003, depth: 0.028 }, scene);
  rail.position.set(0, F.bodyR + 0.0012, 0.008);
  const metalM = merged(
    [axial(scene, F.tailZ, F.bodyZ0, F.tailR, F.tailR), axial(scene, F.headZ1, F.bezelZ1, F.bezelR, F.bezelR), ring, rail],
    'flash:metal',
    metal,
  );
  const labelM = merged([axial(scene, -0.042, -0.018, F.bodyR + 0.0004, F.bodyR + 0.0004)], 'flash:label', label);
  // ползунок: начало — на оси, сдвигается по z (FLASH.knobOff / knobOn)
  const k = CreateBox('flash:part', { width: 0.0075, height: 0.0055, depth: 0.009 }, scene);
  k.position.set(0, F.bodyR + 0.0045, 0);
  const knobM = merged([k], 'flash:knob', knob);
  // линза: диск лицом вперёд (+z)
  const disc = CreateDisc('flash:part', { radius: F.lensR, tessellation: 24 }, scene);
  disc.rotation.y = Math.PI;
  disc.position.z = F.lensZ;
  const lens = merged([disc], 'flash:lens', lensOff);
  const kit: FlashKit = { refs: 1, mats: [plastic, metal, label, knob, lensOff, lensOn], lensOff, lensOn, tex, parts: { body, metal: metalM, label: labelM, knob: knobM, lens } };
  kits.set(scene, kit);
  return kit;
}

/** Отпустить именно тот набор, что брали (у сцены мог завестись новый: старый пересобран после dispose шаблонов). */
function releaseKit(scene: Scene, kit: FlashKit) {
  if (--kit.refs > 0) return;
  if (kits.get(scene) === kit) kits.delete(scene);
  for (const m of Object.values(kit.parts)) m.dispose(false, false);
  for (const m of kit.mats) m.dispose(false, false);
  kit.tex.dispose();
}

/** Модель фонаря: клоны шаблонов сцены (геометрия общая) под своим узлом. */
export class FlashlightModel {
  readonly root: TransformNode;
  readonly meshes: Mesh[];
  readonly lens: Mesh;
  readonly knob: Mesh;
  private readonly kit: FlashKit;
  private disposed = false;

  constructor(
    private readonly scene: Scene,
    name: string,
    parent: TransformNode | Camera | null = null,
    /** материал линзы (null — общий: выключенная) */
    lensMat: Material | null = null,
  ) {
    const kit = (this.kit = acquireKit(scene));
    this.root = new TransformNode(name, scene);
    if (parent) this.root.parent = parent;
    const p = kit.parts;
    const clone = (m: Mesh, tag: string) => {
      const c = m.clone(`${name}:${tag}`, this.root, true);
      c.setEnabled(true);
      c.isVisible = true;
      c.isPickable = false;
      c.checkCollisions = false;
      return c;
    };
    this.lens = clone(p.lens, 'lens');
    if (lensMat) this.lens.material = lensMat;
    this.knob = clone(p.knob, 'knob');
    this.meshes = [clone(p.body, 'body'), clone(p.metal, 'metal'), clone(p.label, 'label'), this.knob, this.lens];
    this.setKnob(false);
  }

  /** Ползунок выключателя: вперёд — включён. */
  setKnob(on: boolean) {
    this.knob.position.z = on ? FLASH.knobOn : FLASH.knobOff;
  }

  /** Линза светится (общие материалы сцены) — у лежащих фонарей. */
  setLensLit(on: boolean) {
    this.lens.material = on ? this.kit.lensOn : this.kit.lensOff;
  }

  /** Текстура отражателя за стеклом (общая у сцены). */
  get lensTexture(): RawTexture {
    return this.kit.tex;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const m of this.meshes) m.dispose(false, false);
    this.root.dispose(false, false);
    releaseKit(this.scene, this.kit);
  }
}

// ───────────────────────── щелчок ─────────────────────────

let clickCtx: AudioContext | null = null;
let clickNoise: AudioBuffer | null = null;

/** Звук щелчка включён (localStorage FLASHLIGHT_SOUND_KEY не '0'). */
export function switchSoundOn(): boolean {
  try {
    return typeof localStorage === 'undefined' || localStorage.getItem(FLASHLIGHT_SOUND_KEY) !== '0';
  } catch {
    return true;
  }
}

/** Щелчок выключателя фонаря (WebAudio, без файлов; один контекст на страницу): шум через полосовой фильтр + глухой
 *  «тук» корпуса, через 35 мс — защёлка, тише. Без окна / WebAudio — тихо. */
export function switchClick(on: boolean) {
  if (typeof window === 'undefined') return;
  try {
    const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const AC = w.AudioContext ?? w.webkitAudioContext;
    if (!AC) return;
    const ctx = (clickCtx ??= new AC());
    if (ctx.state === 'suspended') void ctx.resume();
    if (!clickNoise) {
      const n = Math.ceil(ctx.sampleRate * 0.03);
      const b = (clickNoise = ctx.createBuffer(1, n, ctx.sampleRate));
      const ch = b.getChannelData(0);
      for (let i = 0; i < n; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / n);
    }
    const noise = clickNoise;
    const t0 = ctx.currentTime + 0.005;
    const tick = (at: number, vol: number, f: number) => {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = 1.4;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(vol, at + 0.0015);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.022);
      src.connect(bp).connect(g).connect(ctx.destination);
      src.start(at);
      src.stop(at + 0.03);
    };
    tick(t0, 0.5, on ? 3400 : 2700);
    tick(t0 + 0.035, 0.18, on ? 4200 : 3600);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(on ? 210 : 170, t0);
    o.frequency.exponentialRampToValueAtTime(90, t0 + 0.04);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.22, t0 + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.045);
    o.connect(g).connect(ctx.destination);
    o.start(t0);
    o.stop(t0 + 0.05);
  } catch {
    // звук — необязателен
  }
}

// ───────────────────────── в руке ─────────────────────────

/** Где держат (середина корпуса) в осях камеры: x вправо, y вверх, z вперёд. */
const HOLD = new Vector3(0.22, -0.17, 0.5);
/** Поворот фонаря в руке: чуть внутрь (луч и модель смотрят к прицелу). */
const HOLD_YAW = -0.05;
/** Свет: ближе к глазу, чем модель, — не уходит в стену вплотную. Направление — к прицелу на AIM_M. */
const LIGHT_AT = new Vector3(0.16, -0.14, 0.12);
const AIM_M = 5;
/** Плечо (конец рукава) в осях камеры — за краем кадра. */
const SHOULDER = new Vector3(0.3, -0.5, -0.05);
/** Скорость шага «как пешком», м/с, и путь за два шага (полный цикл покачивания), м. */
const WALK_V = 1.4;
const STRIDE_M = 1.47;
/** Время моргания при включении, с. */
const FLICKER_S = 0.22;

/** Ход игрока на кадр (для покачивания). */
export interface FlashMotion {
  /** скорость по горизонтали, м/с */
  speed: number;
  /** бег 0…1 */
  sprint: number;
  /** на четвереньках 0…1 */
  crawl: number;
}

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

export interface FlashlightOptions {
  /** звук щелчка выключателя (по умолчанию — localStorage FLASHLIGHT_SOUND_KEY не '0') */
  sound?: () => boolean;
}

export class Flashlight {
  readonly light: SpotLight;
  private holder: TransformNode | null = null;
  private model: FlashlightModel | null = null;
  private hand: Mesh[] = [];
  private lensMat: StandardMaterial | null = null;
  private skinMats: StandardMaterial[] = [];
  private isHeld = false;
  private isOn = false;
  /** яркость лампочки 0…1 (с морганием) */
  private level = 0;
  private flick = 0;
  private t = 0;
  private phase = 0;
  private amp = 0;
  private sprintK = 0;
  private crawlK = 0;
  private lagYaw = 0;
  private lagPitch = 0;
  private lastYaw: number | null = null;
  private lastPitch = 0;
  private readonly dir0 = new Vector3();
  /** рука: 1 — правая, −1 — левая (модель, кулак, рукав и свет — зеркально по x камеры) */
  private side: 1 | -1 = 1;
  private readonly q = new Quaternion();
  private readonly tmp = new Vector3();
  private readonly sound: () => boolean;
  private disposed = false;

  constructor(
    private readonly scene: Scene,
    private readonly cam: Camera,
    opts: FlashlightOptions = {},
  ) {
    ensureLightSlots(scene);
    this.sound = opts.sound ?? switchSoundOn;
    const l = (this.light = new SpotLight('flash:light', LIGHT_AT.clone(), new Vector3(0, 0, 1), FLASH_ANGLE, FLASH_EXP, scene));
    this.aim();
    l.parent = cam;
    l.diffuse = FLASH_COLOR.clone();
    l.specular = FLASH_COLOR.scale(0.3);
    l.range = FLASH_RANGE;
    l.intensity = 0;
    l.setEnabled(false);
  }

  get on(): boolean {
    return this.isOn;
  }

  get held(): boolean {
    return this.isHeld;
  }

  /** Взять в руку / убрать (модель и свет — только в руке; включён ли — помнит). */
  setHeld(b: boolean) {
    if (b === this.isHeld || this.disposed) return;
    this.isHeld = b;
    if (b && !this.holder) this.build();
    this.holder?.setEnabled(b);
    // источник включён, пока фонарь в руке (выключенный — яркость 0): вкл/выкл кнопкой не пересобирает шейдеры
    this.light.setEnabled(b);
    if (!b) this.light.intensity = 0;
    this.lastYaw = null;
  }

  /** Включить / выключить (щелчок, при включении — моргание). */
  setOn(b: boolean) {
    if (b === this.isOn || this.disposed) return;
    this.isOn = b;
    this.flick = b ? FLICKER_S : 0;
    this.model?.setKnob(b);
    if (this.isHeld) this.click(b);
  }

  toggle(): boolean {
    this.setOn(!this.isOn);
    return this.isOn;
  }

  /** Рука: 1 — правая, −1 — левая. */
  get handSide(): 1 | -1 {
    return this.side;
  }

  /** Переложить в другую руку (правая занята — керосиновая лампа общаги): модель пересобирается зеркально. */
  setSide(s: 1 | -1) {
    if (s === this.side || this.disposed) return;
    this.side = s;
    this.aim();
    if (!this.holder) return;
    this.teardown();
    this.build();
    this.lastYaw = null;
  }

  /** Свет у глаза со своей стороны, к прицелу на AIM_M: из LIGHT_AT в (0, 0, AIM_M). */
  private aim() {
    const x = LIGHT_AT.x * this.side;
    this.light.position.set(x, LIGHT_AT.y, LIGHT_AT.z);
    this.dir0.set(-x, -LIGHT_AT.y, AIM_M - LIGHT_AT.z).normalize();
    this.light.direction.copyFrom(this.dir0);
  }

  private build() {
    const sc = this.scene;
    // левая рука — всё зеркально по x камеры
    const sd = this.side;
    const hold = new Vector3(HOLD.x * sd, HOLD.y, HOLD.z);
    const h = (this.holder = new TransformNode('flash:held', sc));
    h.parent = this.cam;
    h.position.copyFrom(hold);
    // своя линза: светится по яркости лампочки (с морганием)
    const lens = (this.lensMat = new StandardMaterial('flash:heldLens', sc));
    lens.diffuseColor = new Color3(0.3, 0.3, 0.28);
    lens.specularColor = new Color3(0.6, 0.6, 0.55);
    lens.emissiveColor = Color3.Black();
    const m = (this.model = new FlashlightModel(sc, 'flash:heldModel', h, lens));
    lens.diffuseTexture = lens.emissiveTexture = m.lensTexture;
    m.root.rotation.y = HOLD_YAW * sd;
    m.setKnob(this.isOn);
    // кулак в вязаной перчатке, большой палец сверху у ползунка, рукав ватника — к плечу за краем кадра
    const glove = new StandardMaterial('flash:glove', sc);
    glove.diffuseColor = new Color3(0.17, 0.15, 0.13);
    glove.specularColor = new Color3(0.02, 0.02, 0.02);
    const sleeve = new StandardMaterial('flash:sleeve', sc);
    sleeve.diffuseColor = new Color3(0.2, 0.21, 0.17);
    sleeve.specularColor = new Color3(0.02, 0.02, 0.02);
    this.skinMats = [glove, sleeve];
    const fist = CreateSphere('flash:fist', { diameter: 1, segments: 10 }, sc);
    fist.scaling.set(0.064, 0.052, 0.078);
    fist.position.set(0.006 * sd, -0.007, -0.016);
    fist.material = glove;
    const thumb = CreateSphere('flash:thumb', { diameter: 1, segments: 8 }, sc);
    thumb.scaling.set(0.021, 0.019, 0.046);
    thumb.position.set(-0.017 * sd, 0.013, 0.012);
    thumb.rotation.y = 0.25 * sd;
    thumb.material = glove;
    const cuff = CreateCylinder('flash:cuff', { diameter: 0.07, height: 0.03, tessellation: 12 }, sc);
    const wrist = new Vector3(0.012 * sd, -0.012, -0.058);
    const sh = new Vector3(SHOULDER.x * sd, SHOULDER.y, SHOULDER.z).subtract(hold);
    const d = sh.subtract(wrist);
    const len = d.length();
    const ax = d.scale(1 / len);
    const pitch = Math.acos(Math.max(-1, Math.min(1, ax.y)));
    const yaw = Math.atan2(ax.x, ax.z);
    cuff.position.copyFrom(wrist.add(ax.scale(0.012)));
    cuff.rotation.set(pitch, yaw, 0);
    cuff.material = glove;
    const arm = CreateCylinder('flash:sleeve', { diameterBottom: 0.078, diameterTop: 0.11, height: len, tessellation: 12 }, sc);
    arm.position.copyFrom(wrist.add(d.scale(0.5)));
    arm.rotation.set(pitch, yaw, 0);
    arm.material = sleeve;
    this.hand = [fist, thumb, cuff, arm];
    for (const x of this.hand) x.parent = h;
    for (const x of [...m.meshes, ...this.hand]) {
      x.isPickable = false;
      x.checkCollisions = false;
      x.renderingGroupId = 1;
      x.alwaysSelectAsActiveMesh = true;
      x.layerMask = 0x0fffffff;
    }
    h.setEnabled(this.isHeld);
  }

  /** Кадр: моргание, яркость по свету сцены, покачивание, запаздывание за взглядом, четвереньки. */
  update(dt: number, motion: FlashMotion) {
    if (this.disposed) return;
    dt = Math.min(0.1, Math.max(0, Number.isFinite(dt) ? dt : 0));
    this.t += dt;
    const t = this.t;
    // лампочка: включение — моргание FLICKER_S, выключение — быстро гаснет
    if (this.isOn) {
      if (this.flick > 0) {
        this.flick = Math.max(0, this.flick - dt);
        const k = 1 - this.flick / FLICKER_S;
        const blink = hash01(Math.floor(t * 40)) < 0.45 + 0.5 * k ? 1 : 0.12;
        this.level = Math.min(1, k * 1.6) * blink;
      } else this.level += (1 - this.level) * Math.min(1, dt * 30);
    } else this.level = Math.max(0, this.level - dt * 14);
    if (!this.isHeld) return;

    const speed = Math.max(0, Number.isFinite(motion.speed) ? motion.speed : 0);
    const sprint = Math.min(1, Math.max(0, motion.sprint || 0));
    const crawl = Math.min(1, Math.max(0, motion.crawl || 0));
    const e = (r: number) => Math.min(1, dt * r);
    this.amp += (Math.min(1.6, speed / WALK_V) - this.amp) * e(6);
    this.sprintK += (sprint - this.sprintK) * e(5);
    this.crawlK += (crawl - this.crawlK) * e(5);
    this.phase += (speed * dt * Math.PI * 2) / STRIDE_M;
    // запаздывание за поворотом взгляда (рука догоняет)
    const f = this.cam.getDirection(Vector3.Forward());
    const yaw = Math.atan2(f.x, f.z);
    const pitchV = Math.asin(Math.max(-1, Math.min(1, f.y)));
    if (this.lastYaw !== null && dt > 0) {
      const wy = wrapPi(yaw - this.lastYaw) / dt;
      const wp = (pitchV - this.lastPitch) / dt;
      this.lagYaw += (Math.max(-0.08, Math.min(0.08, -wy * 0.012)) - this.lagYaw) * e(10);
      this.lagPitch += (Math.max(-0.06, Math.min(0.06, wp * 0.01)) - this.lagPitch) * e(10);
    }
    this.lastYaw = yaw;
    this.lastPitch = pitchV;

    const a = this.amp, s = this.sprintK, c = this.crawlK, ph = this.phase;
    const breathe = 0.003 * Math.sin(t * 1.3);
    // ход: вбок раз за два шага, вниз-вверх — каждый шаг; бег — размашисто, ниже, луч ныряет к полу
    const sx = (0.009 + 0.012 * s) * Math.sin(ph) * a;
    const sy = (0.007 + 0.012 * s) * Math.cos(ph * 2) * a + breathe;
    const rx = (0.025 + 0.1 * s) * Math.sin(ph + 0.6) * a + 0.16 * s + this.lagPitch + 0.01 * Math.sin(t * 1.1);
    const ry = 0.03 * Math.sin(ph) * a + this.lagYaw + 0.008 * Math.sin(t * 0.8);
    const rz = (0.05 + 0.06 * s) * Math.sin(ph) * a * this.side;
    const h = this.holder;
    if (h) {
      // на четвереньках — вниз из кадра (руки там — CrawlHands), почти спрятан — выключен
      h.position.set(HOLD.x * this.side + sx - this.lagYaw * 0.15, HOLD.y + sy - 0.035 * s - 0.34 * c, HOLD.z - 0.03 * s - 0.1 * c);
      h.rotation.set(rx, ry, rz);
      const vis = c < 0.9;
      if (vis !== h.isEnabled()) h.setEnabled(vis);
    }
    // свет: вслед за фонарём (без крена), на четвереньках — прямо
    const k = 0.85 * (1 - c);
    Quaternion.RotationYawPitchRollToRef(ry * k, rx * k, 0, this.q);
    this.dir0.rotateByQuaternionToRef(this.q, this.tmp);
    this.light.direction.copyFrom(this.tmp);
    const lit = sceneLitness(this.scene);
    const wobble = 0.97 + 0.03 * Math.sin(t * 2.3) * Math.sin(t * 0.7);
    this.light.intensity = this.level * flashIntensity(lit) * wobble;
    // линза светится, рука чуть подсвечена отражённым от стен светом
    if (this.lensMat) this.lensMat.emissiveColor.copyFromFloats(FLASH_COLOR.r * this.level, FLASH_COLOR.g * this.level, FLASH_COLOR.b * this.level);
    const bounce = 0.05 * this.level * (1 - lit);
    for (const m of this.skinMats) m.emissiveColor.set(bounce, bounce * 0.95, bounce * 0.85);
  }

  /** Щелчок выключателя (общий звук фонарей — switchClick). */
  private click(on: boolean) {
    if (this.sound()) switchClick(on);
  }

  /** Модель в руке, кулак и рукав — убрать (свет остаётся). */
  private teardown() {
    for (const m of this.hand) m.dispose(false, false);
    this.model?.dispose();
    this.holder?.dispose(false, false);
    this.lensMat?.dispose(false, false);
    for (const m of this.skinMats) m.dispose(false, false);
    this.hand = [];
    this.skinMats = [];
    this.model = null;
    this.holder = null;
    this.lensMat = null;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.light.dispose();
    this.teardown();
  }
}
