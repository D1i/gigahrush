// Виды предметов «Прогулки»: как предмет лежит на полу (./worldItems.ts), как его держат в руке (./heldItem.ts) и его
// значок в хотбаре (HotbarHud) — одним реестром по id предмета. Модели лута «советский быт» — общий на сцену PropModels
// набора LOOT_PROPS_URL (./lootAssets.ts: узлы p_loot_*, стекло — applyLootGlass после загрузки).
//  • Реестр: registerItemLook(id, частичный вид) — поверх вида по умолчанию (лут — LOOT_LOOKS, прочее — коробка-посылка
//    на ладони); itemLookOf(id) — итог. Регистрировать можно до и после постройки WorldItems / HeldItem: они сверяют
//    lookRev() и пересобирают своё (сессия 36 — ключ it_key из своего файла).
//  • Значки: registerItemIcon(id, '<svg…' | url); itemIconOf(id) — зарегистрированный или WebP лута (lootIconUrl).
//  • Оси моделей (как у PropModels): пивот — центр низа, перед (надписи, стекло) — −Z, метры. Точки света — LOOT_ANCHORS.
//  • Позы на полу: 'stand' — как стоит модель; 'lie' — на боку (поворот на 90° вокруг z); 'flat' — лицом (−Z) вверх
//    (поворот на 90° вокруг x: коробок, карты, зиппа). front: 'toward' — перед к тому, кто бросил (по умолчанию: надпись
//    видна), 'along' — перед по yaw (П-2: туда светит линза).
//  • Мелочь (габарит меньше SMALL_M — копейка, лампочка) на полу чуть крупнее (≤ SMALL_MAX_SCALE) и с бликом под светом
//    (glint) — чтобы находилась; стопки (n) — горкой до pile.max штук.
//  • Свет на полу: горит ли и сколько — itemUse.lightOnFloor (горящие П-2 и керосинка), где источник — DropLight.
import type { Scene } from '@babylonjs/core/scene';
import type { Material } from '@babylonjs/core/Materials/material';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import { Constants } from '@babylonjs/core/Engines/constants';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { MultiMaterial } from '@babylonjs/core/Materials/multiMaterial';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Slot } from '../game/hotbar';
import { KEROLAMP_INTENSITY, UP_TUBE } from '../game/itemUse';
import { PropModels } from './propModels';
import { LOOT_ANCHORS, LOOT_MODEL_ITEMS, LOOT_PROPS_URL, applyLootGlass, lootIconUrl, lootPropId } from './lootAssets';
import { FLASH_COLOR, flashIntensity, sceneLitness } from './flashlight';

export type V3 = readonly [number, number, number];

// ───────────────────────── типы ─────────────────────────

/** Свет лежащего предмета: где источник и какой; горит ли и насколько — по itemUse.lightOnFloor(ячейка). */
export interface DropLight {
  /** 'spot' — луч вперёд (фонарь), 'point' — во все стороны (пламя) */
  kind: 'spot' | 'point';
  /** где источник в осях модели, м (у луча лежащего фонаря — от линзы, см. floorBeam) */
  at?: V3;
  /** луч лежащего фонаря: источник над линзой и позади, к полу перед ней, и светлая полоса на полу (worldItems) */
  floorBeam?: boolean;
  /** яркость при Light.intensity = 1: число или по сцене (фонарь — как в руке, по свету сцены) */
  base: number | ((scene: Scene) => number);
  /** дальность = Light.range × rangeMul (+ rangeAdd), м */
  rangeMul?: number;
  rangeAdd?: number;
  /** дрожь пламени: доля размаха (нет — ровный) */
  flicker?: number;
}

/** Как держат в руке (правая рука; левая — зеркально по x камеры). */
export interface HoldPose {
  /** кисть: 'fist' — кулак вокруг корпуса вдоль взгляда (фонарь), 'grip' — кулак вокруг стоящего (бутылка, зиппа),
   *  'palm' — на ладони, 'hang' — за дужку / ручку (висит под кулаком), 'pinch' — щепотью (спичка) */
  hand: 'fist' | 'grip' | 'palm' | 'hang' | 'pinch';
  /** где кисть (точка хвата) в осях камеры: x — вправо, y — вверх, z — вперёд, м */
  at: V3;
  /** точка хвата в осях модели, м */
  grip: V3;
  /** поворот модели в руке (Эйлер x, y, z, рад): 0 — перед модели (−Z) к игроку */
  rot: V3;
  /** масштаб модели в руке (1 — настоящий) */
  scale?: number;
  /** сколько штук стопки показать (копейки на ладони) */
  pile?: number;
}

/** Вид предмета: на полу, в руке, свет. */
export interface ItemLook {
  /** поза на полу: 'stand' — как стоит модель, 'lie' — на боку, 'flat' — лицом вверх */
  pose: 'lie' | 'stand' | 'flat';
  /** радиус следа на полу, м (отступ от стены — dropPose) */
  foot: number;
  /** свет на полу; null — не светит */
  light: DropLight | null;
  /** шаблон модели (выключенный меш, пивот — центр низа, метры) или null — ещё нет (коробка, потом пересборка) */
  model?: (scene: Scene) => Mesh | null;
  /** габарит модели (x, y, z), м — для позы и следа до загрузки */
  size?: V3;
  /** масштаб на полу (нет — по размеру: мелочь крупнее, см. SMALL_M) */
  scale?: number;
  /** перед на полу: к бросившему ('toward') или по yaw ('along' — линза фонаря) */
  front?: 'toward' | 'along';
  /** стопка n — горкой: не больше max штук; 'scatter' — россыпью, 'row' — рядком, 'stack' — внахлёст */
  pile?: { max: number; mode: 'scatter' | 'row' | 'stack' } | null;
  /** блик под светом (мелочь) */
  glint?: boolean;
  /** стекло, которое светится, когда горит: центр (оси модели), радиус, куда смотрит */
  lens?: { at: V3; r: number; dir: V3 } | null;
  /** язычок пламени, когда горит: центр (оси модели) и высота, м */
  flame?: { at: V3; h: number } | null;
  /** в руке; null — не держат (сумки), нет — на ладони по умолчанию */
  hold?: HoldPose | null;
  /** навесные части по состоянию ячейки (удлинение тубуса на П-2): модель предмета item низом-центром в точке at */
  parts?: (slot: Slot) => readonly { item: string; at: V3 }[];
}

/** Источник шаблонов моделей лута (PropModels или подмена в тестах). */
export interface LootModelSource {
  get(propId: string): Mesh | null;
}

// ───────────────────────── модели лута ─────────────────────────

const sources = new WeakMap<Scene, LootModelSource>();
const NONE: LootModelSource = { get: () => null };

/** Металл лута — с бликом (PropModels ставит всем 0.05): под фонарём копейка и сталь блестят. */
const SHINE: Readonly<Record<string, readonly [number, number, number, number]>> = {
  loot_aged_brass: [0.42, 0.36, 0.2, 40],
  loot_brass_exposed_edges: [0.5, 0.44, 0.26, 48],
  loot_worn_steel: [0.34, 0.34, 0.33, 48],
  loot_dark_oxidized_steel: [0.14, 0.14, 0.14, 32],
  loot_black_bakelite: [0.12, 0.12, 0.12, 28],
};

/** Блик металла (после загрузки; повторно — безвредно). */
export function applyLootShine(scene: Scene): number {
  let n = 0;
  for (const m of scene.materials) {
    const s = SHINE[m.name.replace(/^propModel:/, '')];
    if (!s || !(m instanceof StandardMaterial)) continue;
    m.specularColor.set(s[0], s[1], s[2]);
    m.specularPower = s[3];
    n++;
  }
  return n;
}

/**
 * Модели лута сцены: один PropModels на LOOT_PROPS_URL (заводится при первом вызове), шаблоны — только когда набор
 * загружен и стекло прозрачное (applyLootGlass), до того get → null. Без XMLHttpRequest (тесты на NullEngine) —
 * пустой источник (setLootModels — подмена).
 */
export function lootModels(scene: Scene): LootModelSource {
  const hit = sources.get(scene);
  if (hit) return hit;
  if (typeof XMLHttpRequest === 'undefined') {
    sources.set(scene, NONE);
    return NONE;
  }
  const models = new PropModels(scene, [LOOT_PROPS_URL]);
  let ready = false;
  void models.loaded.then(() => {
    if (scene.isDisposed) return;
    applyLootGlass(scene);
    applyLootShine(scene);
    ready = true;
  });
  scene.onDisposeObservable.addOnce(() => models.dispose());
  const src: LootModelSource = { get: (id) => (ready ? models.get(id) : null) };
  sources.set(scene, src);
  return src;
}

/** Подменить источник моделей лута сцены (тесты, превью); null — снова свой (PropModels при следующем вызове). */
export function setLootModels(scene: Scene, src: LootModelSource | null) {
  if (src) sources.set(scene, src);
  else sources.delete(scene);
}

/** Шаблон модели лута по id предмета (null — не лут или не загружен). */
export function lootModel(scene: Scene, item: string): Mesh | null {
  const p = lootPropId(item);
  return p ? lootModels(scene).get(p) : null;
}

// ───────────────────────── вид по умолчанию ─────────────────────────

/** Мелочь: габарит меньше этого (м) на полу крупнее — до SMALL_M, но не больше SMALL_MAX_SCALE. */
export const SMALL_M = 0.06;
export const SMALL_MAX_SCALE = 1.6;

/** Габариты моделей лута (x, y, z), м — как в loot_props.glb (tools/make-loot-props.mjs, EXPECT). */
const LOOT_SIZE: Readonly<Record<string, V3>> = {
  it_kopeyki: [0.024, 0.0025, 0.024],
  it_radiolamp: [0.036, 0.082, 0.036],
  it_cards: [0.089, 0.145, 0.019],
  it_wick: [0.113, 0.013, 0.07],
  it_kerosene: [0.135, 0.241, 0.08],
  it_sticker: [0.068, 0.005, 0.06],
  it_matches: [0.077, 0.055, 0.02],
  it_hunt_matches: [0.089, 0.09, 0.02],
  it_backpack: [0.32, 0.461, 0.307],
  it_briefcase: [0.38, 0.325, 0.111],
  it_sack: [0.306, 0.4, 0.306],
  it_bread: [0.301, 0.101, 0.172],
  it_flashlight: [0.096, 0.096, 0.214],
  it_tube_ext: [0.058, 0.058, 0.037],
  it_bulb: [0.022, 0.044, 0.022],
  it_bug_flash: [0.09, 0.088, 0.061],
  it_batteries: [0.034, 0.064, 0.034],
  it_zippo: [0.062, 0.082, 0.014],
  it_kerolamp: [0.188, 0.414, 0.152],
  it_preserves: [0.116, 0.169, 0.117],
  it_bubble: [0.074, 0.195, 0.074],
  it_yuzgram: [0.046, 0.103, 0.046],
};

/** Коробка-посылка для предметов без модели (worldItems), м. */
export const BOX_SIZE: V3 = [0.17, 0.075, 0.12];

const PI = Math.PI;
const A = LOOT_ANCHORS;
/** Свет лежащего П-2: доля яркости фонаря в руке и дальности. */
const DROP_I = 0.85;
const DROP_RANGE_MUL = 12 / 18;

/** Ладонь по умолчанию (что-то небольшое: низ — на ладони). */
const PALM: HoldPose = { hand: 'palm', at: [0.19, -0.2, 0.44], grip: [0, 0, 0], rot: [0, 0.5, 0] };

/** Лут: поза, свет, в руке (что не задано — по умолчанию). */
const LOOT_LOOKS: Readonly<Record<string, Partial<ItemLook>>> = {
  it_kopeyki: { pile: { max: 6, mode: 'scatter' }, glint: true, hold: { hand: 'palm', at: [0.17, -0.17, 0.36], grip: [0, 0, 0], rot: [-0.55, 0.3, 0], pile: 3 } },
  it_radiolamp: { pose: 'lie', pile: { max: 3, mode: 'row' }, hold: { hand: 'grip', at: [0.18, -0.17, 0.4], grip: [0, 0.022, 0], rot: [0, 0.4, -0.12] } },
  it_cards: { pose: 'flat', hold: { hand: 'palm', at: [0.18, -0.19, 0.42], grip: [0, 0.07, 0.0095], rot: [PI / 2 - 0.75, 0.25, 0] } },
  it_wick: { pile: { max: 2, mode: 'stack' }, hold: { hand: 'palm', at: [0.18, -0.19, 0.42], grip: [0, 0, 0], rot: [-0.5, 0.3, 0] } },
  it_kerosene: { hold: { hand: 'hang', at: [0.25, -0.06, 0.52], grip: [0, 0.232, 0], rot: [0, 0.35, 0] } },
  it_sticker: { pile: { max: 3, mode: 'stack' }, hold: { hand: 'palm', at: [0.17, -0.18, 0.38], grip: [0, 0, 0], rot: [-0.6, 0.2, 0] } },
  it_matches: { pose: 'flat', hold: { hand: 'palm', at: [0.18, -0.18, 0.4], grip: [0, 0.019, 0.01], rot: [PI / 2 - 0.7, 0.3, 0] } },
  it_hunt_matches: { pose: 'flat', hold: { hand: 'palm', at: [0.18, -0.19, 0.41], grip: [0, 0.045, 0.01], rot: [PI / 2 - 0.7, 0.3, 0] } },
  it_backpack: { hold: null },
  it_briefcase: { hold: null },
  it_sack: { hold: null },
  it_bread: { hold: { hand: 'palm', at: [0.2, -0.22, 0.48], grip: [0, 0, 0], rot: [-0.25, 0.85, 0] } },
  it_flashlight: {
    front: 'along',
    light: { kind: 'spot', floorBeam: true, base: (sc) => flashIntensity(sceneLitness(sc)) * DROP_I, rangeMul: DROP_RANGE_MUL },
    lens: { at: A.flashlight.lens, r: 0.037, dir: A.flashlight.lensDir },
    hold: { hand: 'fist', at: [0.22, -0.18, 0.46], grip: [0, 0.048, 0.045], rot: [0, PI - 0.05, 0] },
    parts: (s) => ((s.u ?? 0) & UP_TUBE ? [{ item: 'it_tube_ext', at: A.flashlight.tubeExt }] : []),
  },
  it_tube_ext: { hold: { hand: 'palm', at: [0.18, -0.18, 0.4], grip: [0, 0, 0], rot: [0, 0.6, 0] } },
  it_bulb: { pose: 'lie', pile: { max: 3, mode: 'row' }, glint: true, hold: { hand: 'pinch', at: [0.17, -0.15, 0.36], grip: [0, 0.012, 0], rot: [0, 0, -0.2] } },
  it_bug_flash: {
    lens: { at: A.bug_flash.lens, r: 0.02, dir: A.bug_flash.lensDir },
    hold: { hand: 'fist', at: [0.21, -0.18, 0.44], grip: [0.004, 0.035, 0.004], rot: [0, PI - 0.08, 0] },
  },
  it_batteries: { pose: 'lie', pile: { max: 4, mode: 'row' }, hold: { hand: 'grip', at: [0.18, -0.18, 0.4], grip: [0, 0.03, 0], rot: [0, 0.5, -0.15] } },
  it_zippo: { pose: 'flat', flame: { at: A.zippo.flame, h: 0.022 }, hold: { hand: 'grip', at: [0.18, -0.17, 0.4], grip: [0, 0.02, 0], rot: [0, 0.35, 0] } },
  it_kerolamp: {
    light: { kind: 'point', at: A.kerolamp.flame, base: 0.9 / KEROLAMP_INTENSITY, rangeAdd: 0.5, flicker: 1 },
    flame: { at: A.kerolamp.flame, h: 0.026 },
    hold: { hand: 'hang', at: [0.27, -0.03, 0.6], grip: [0, 0.405, 0], rot: [0, 0.5, 0] },
  },
  it_preserves: { hold: { hand: 'palm', at: [0.19, -0.23, 0.48], grip: [0, 0, 0], rot: [-0.2, 0.4, 0] } },
  it_bubble: { hold: { hand: 'grip', at: [0.2, -0.2, 0.46], grip: [0, 0.075, 0], rot: [0, 0.3, -0.1] } },
  it_yuzgram: { hold: { hand: 'grip', at: [0.18, -0.18, 0.42], grip: [0, 0.04, 0], rot: [0, 0.4, -0.1] } },
};

const BASE: ItemLook = { pose: 'stand', foot: 0.13, light: null, hold: PALM };

// ───────────────────────── реестр ─────────────────────────

const registered = new Map<string, Partial<ItemLook>>();
const resolved = new Map<string, ItemLook>();
const icons = new Map<string, { kind: 'svg' | 'url'; src: string }>();
let rev = 0;

/** Номер версии реестра видов: растёт при каждой регистрации (WorldItems / HeldItem пересобирают своё). */
export function lookRev(): number {
  return rev;
}

/** Вид предмета id поверх вида по умолчанию (повторно — заменяет прежний частичный вид). Вернёт «отменить». */
export function registerItemLook(id: string, look: Partial<ItemLook>): () => void {
  registered.set(id, look);
  resolved.clear();
  rev++;
  return () => {
    if (registered.get(id) !== look) return;
    registered.delete(id);
    resolved.clear();
    rev++;
  };
}

/** Габарит после позы на полу (x, y, z). */
export function posedSize(size: V3, pose: ItemLook['pose']): V3 {
  if (pose === 'lie') return [size[1], size[0], size[2]];
  if (pose === 'flat') return [size[0], size[2], size[1]];
  return size;
}

/** Масштаб на полу: задан — он; мелочь (габарит < SMALL_M) — крупнее, до SMALL_MAX_SCALE. */
export function floorScale(look: ItemLook): number {
  if (look.scale && look.scale > 0) return look.scale;
  const s = look.size;
  if (!s) return 1;
  const m = Math.max(s[0], s[1], s[2]);
  return m > 0 && m < SMALL_M ? Math.min(SMALL_MAX_SCALE, SMALL_M / m) : 1;
}

/** Вид предмета id (итог: по умолчанию ← лут ← зарегистрированный). */
export function itemLookOf(id: string): ItemLook {
  const hit = resolved.get(id);
  if (hit) return hit;
  const loot = lootPropId(id) ? LOOT_LOOKS[id] : undefined;
  const reg = registered.get(id);
  const look: ItemLook = { ...BASE };
  if (lootPropId(id)) {
    look.model = (sc) => lootModel(sc, id);
    look.size = LOOT_SIZE[id];
  }
  Object.assign(look, loot, reg);
  // след: задан — он; иначе по габариту после позы (с масштабом мелочи), не меньше 5 см
  if (reg?.foot === undefined && loot?.foot === undefined && look.size) {
    const p = posedSize(look.size, look.pose);
    look.foot = Math.max(0.05, (Math.max(p[0], p[2]) / 2) * floorScale(look) + 0.03);
  }
  resolved.set(id, look);
  return look;
}

/** Значок предмета для хотбара: inline '<svg…' (viewBox 0 0 32 32) или адрес картинки. */
export function registerItemIcon(id: string, svgOrUrl: string): () => void {
  const v = { kind: /^\s*<svg[\s>]/i.test(svgOrUrl) ? ('svg' as const) : ('url' as const), src: svgOrUrl };
  icons.set(id, v);
  return () => {
    if (icons.get(id) === v) icons.delete(id);
  };
}

/** Значок предмета: зарегистрированный, иначе WebP лута; нет — null (HUD рисует свой знак). */
export function itemIconOf(id: string): { kind: 'svg' | 'url'; src: string } | null {
  const r = icons.get(id);
  if (r) return r;
  const u = lootIconUrl(id);
  return u ? { kind: 'url', src: u } : null;
}

/** Все предметы с моделью лута (порядок каталога). */
export const LOOK_ITEMS: readonly string[] = LOOT_MODEL_ITEMS;

// ───────────────────────── материалы ─────────────────────────

/** Копия стандартного материала (текстуры — общие, не копии): для подсветки и своих материалов руки. */
export function copyStd(src: StandardMaterial, name: string): StandardMaterial {
  const v = new StandardMaterial(name, src.getScene());
  v.diffuseColor = src.diffuseColor.clone();
  v.diffuseTexture = src.diffuseTexture;
  v.specularColor = src.specularColor.clone();
  v.specularPower = src.specularPower;
  v.emissiveColor = src.emissiveColor.clone();
  v.emissiveTexture = src.emissiveTexture;
  v.opacityTexture = src.opacityTexture;
  v.useAlphaFromDiffuseTexture = src.useAlphaFromDiffuseTexture;
  v.disableLighting = src.disableLighting;
  v.backFaceCulling = src.backFaceCulling;
  v.separateCullingPass = src.separateCullingPass;
  v.alpha = src.alpha;
  v.alphaMode = src.alphaMode;
  v.transparencyMode = src.transparencyMode;
  v.disableDepthWrite = src.disableDepthWrite;
  v.zOffset = src.zOffset;
  v.maxSimultaneousLights = src.maxSimultaneousLights;
  return v;
}

/** Копия материала (MultiMaterial — по подматериалам); не Standard — как есть. own — созданное здесь. */
export function copyMaterial(m: Material, suffix: string, own: Material[], each?: (c: StandardMaterial, src: StandardMaterial) => void): Material {
  const one = (src: Material | null): Material | null => {
    if (!(src instanceof StandardMaterial)) return src;
    const c = copyStd(src, src.name + suffix);
    each?.(c, src);
    own.push(c);
    return c;
  };
  if (m instanceof MultiMaterial) {
    const mm = new MultiMaterial(m.name + suffix, m.getScene());
    mm.subMaterials = m.subMaterials.map((s) => one(s));
    own.push(mm);
    return mm;
  }
  return one(m) ?? m;
}

// ───────────────────────── свечение: линза, пламя, блик ─────────────────────────

interface FxKit {
  reflector: RawTexture;
  lensOn: StandardMaterial;
  flameOuter: StandardMaterial;
  flameCore: StandardMaterial;
  glintTex: RawTexture;
  glint: StandardMaterial;
}
const fxKits = new WeakMap<Scene, FxKit>();

/** Отражатель за стеклом: лампочка в центре, кольца рефлектора, тёмный край — RGBA n×n (как у FlashlightModel). */
function reflectorPixels(n = 64): Uint8Array {
  const a = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const u = ((x + 0.5) / n) * 2 - 1, v = ((y + 0.5) / n) * 2 - 1;
      const r = Math.hypot(u, v);
      const bulb = Math.exp(-((r / 0.17) ** 2));
      let k = 0.42 + 0.3 * (1 - r) + 0.1 * Math.cos(r * 21) + 0.75 * bulb;
      if (r > 0.92) k *= 0.45;
      if (r > 1) k = 0;
      k = Math.min(1, Math.max(0, k));
      const i = (y * n + x) * 4;
      a[i] = Math.round(255 * k);
      a[i + 1] = Math.round(255 * k * 0.96);
      a[i + 2] = Math.round(255 * k * (0.84 + 0.16 * bulb));
      a[i + 3] = r > 1 ? 0 : 255;
    }
  return a;
}

/** Блик: четырёхлучевая звёздочка с мягким ядром (альфа). */
function glintPixels(n = 64): Uint8Array {
  const a = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const u = ((x + 0.5) / n) * 2 - 1, v = ((y + 0.5) / n) * 2 - 1;
      const r = Math.hypot(u, v);
      const core = Math.exp(-((r / 0.16) ** 2));
      const rays = Math.exp(-((u / 0.05) ** 2)) * Math.max(0, 1 - Math.abs(v)) ** 2 + Math.exp(-((v / 0.05) ** 2)) * Math.max(0, 1 - Math.abs(u)) ** 2;
      const k = Math.min(1, core + 0.7 * rays);
      const i = (y * n + x) * 4;
      a[i] = a[i + 1] = a[i + 2] = 255;
      a[i + 3] = Math.round(255 * k);
    }
  return a;
}

/** Общие материалы свечения сцены (линза горящего фонаря, пламя, блик): заводятся при первом вызове. */
export function lootFx(scene: Scene): FxKit {
  const hit = fxKits.get(scene);
  if (hit && scene.materials.includes(hit.lensOn)) return hit;
  const reflector = RawTexture.CreateRGBATexture(reflectorPixels(), 64, 64, scene, false, false, Texture.BILINEAR_SAMPLINGMODE);
  reflector.name = 'loot:reflector';
  reflector.hasAlpha = true;
  const lensOn = new StandardMaterial('loot:lensOn', scene);
  lensOn.diffuseColor = Color3.Black();
  lensOn.specularColor = Color3.Black();
  lensOn.emissiveTexture = reflector;
  lensOn.opacityTexture = reflector;
  lensOn.emissiveColor = FLASH_COLOR.scale(0.95);
  lensOn.disableLighting = true;
  const flame = (name: string, c: Color3, alpha: number) => {
    const m = new StandardMaterial(name, scene);
    m.diffuseColor = Color3.Black();
    m.specularColor = Color3.Black();
    m.emissiveColor = c;
    m.disableLighting = true;
    m.alpha = alpha;
    m.alphaMode = Constants.ALPHA_ADD;
    m.disableDepthWrite = true;
    m.backFaceCulling = true;
    return m;
  };
  const flameOuter = flame('loot:flameOuter', new Color3(1, 0.52, 0.14), 0.55);
  const flameCore = flame('loot:flameCore', new Color3(1, 0.88, 0.58), 0.95);
  const glintTex = RawTexture.CreateRGBATexture(glintPixels(), 64, 64, scene, false, false, Texture.BILINEAR_SAMPLINGMODE);
  glintTex.name = 'loot:glintTex';
  glintTex.hasAlpha = true;
  const glint = flame('loot:glint', new Color3(1, 0.95, 0.82), 1);
  glint.opacityTexture = glintTex;
  glint.backFaceCulling = false;
  const kit: FxKit = { reflector, lensOn, flameOuter, flameCore, glintTex, glint };
  fxKits.set(scene, kit);
  return kit;
}

/** Светящийся отражатель за стеклом: диск радиуса r в точке at (оси модели) лицом по dir (−Z — как у моделей лута). */
export function lensDisc(scene: Scene, name: string, parent: TransformNode, lens: NonNullable<ItemLook['lens']>, mat: Material): Mesh {
  const d = CreateDisc(name, { radius: lens.r, tessellation: 20 }, scene);
  // диск смотрит на −Z (лицевая сторона); dir — ±Z: +Z — развернуть; чуть внутрь стекла
  const back = lens.dir[2] > 0 ? -1 : 1;
  if (back < 0) d.rotation.y = Math.PI;
  d.position.set(lens.at[0], lens.at[1], lens.at[2] + back * 0.0025);
  d.parent = parent;
  d.material = mat;
  d.isPickable = false;
  d.checkCollisions = false;
  return d;
}

/** Язычок пламени высотой h: внешний оранжевый и ядро (аддитивно), центр — в начале узла; дрожь — scaling узла. */
export function flameMeshes(scene: Scene, name: string, parent: TransformNode, h: number): { node: TransformNode; meshes: Mesh[] } {
  const kit = lootFx(scene);
  const node = new TransformNode(name, scene);
  node.parent = parent;
  const outer = CreateSphere(name + ':outer', { diameter: 1, segments: 8 }, scene);
  outer.scaling.set(h * 0.42, h, h * 0.42);
  outer.position.y = 0;
  outer.material = kit.flameOuter;
  const core = CreateSphere(name + ':core', { diameter: 1, segments: 6 }, scene);
  core.scaling.set(h * 0.22, h * 0.5, h * 0.22);
  core.position.y = -h * 0.2;
  core.material = kit.flameCore;
  const meshes = [outer, core];
  for (const m of meshes) {
    m.parent = node;
    m.isPickable = false;
    m.checkCollisions = false;
  }
  return { node, meshes };
}

/** Блик (плоскость лицом к камере), размер s, м. */
export function glintMesh(scene: Scene, name: string, s: number): Mesh {
  const p = CreatePlane(name, { size: s }, scene);
  p.billboardMode = Mesh.BILLBOARDMODE_ALL;
  p.material = lootFx(scene).glint;
  p.isPickable = false;
  p.checkCollisions = false;
  return p;
}

/** Дрожь пламени (как у лампы в руке): множитель около 0.92, размах amp; ph — фаза. */
export function flameFlicker(t: number, ph: number, amp = 1): number {
  const h = (n: number) => {
    const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const k = 0.92 + 0.05 * Math.sin(t * 11.3 + ph) + 0.03 * Math.sin(t * 27.1 + 0.7 + ph * 2) + 0.02 * (h(Math.floor(t * 14) + ph * 100) - 0.5);
  return 1 - amp * (1 - k);
}
