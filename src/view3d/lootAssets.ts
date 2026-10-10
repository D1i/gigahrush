// Ассеты лута «советский быт» (каталог — src/data/itemsLoot.ts): модели предметов — src/view3d/assets/loot_props.glb
// (tools/make-loot-props.mjs из набора заказчика soviet_loot_lowpoly; узел на предмет p_loot_<id без «it_»>, грузится
// PropModels, как остальные наборы: new PropModels(scene, [..., LOOT_PROPS_URL])), значки хотбара —
// src/view3d/assets/loot_icons/<id>.webp (tools/make-loot-icons.mjs: тот же GLB через PropModels, вид 3/4 спереди-справа,
// 96 × 96, прозрачный фон с мягкой тенью). Всё — через `?url`: сборка (vite-plugin-singlefile) вшивает data:-адресами.
//  • Оси моделей — как у мебели (src/blockout/babylon.ts): перед (надписи, стекло фонарей) — −Z, низ — y = 0, центр
//    габарита на плане — в начале координат; масштаб настоящий (метры). Копейка и наклейка лежат лицом вверх.
//  • Стекло (материалы loot_glass_*): PropModels переносит из PBR только цвет — прозрачность ставит applyLootGlass(scene)
//    после `models.loaded` (материалы у всех клонов общие — один вызов на сцену).
//  • LOOT_ANCHORS — точки света и крепления в локальных координатах шаблона (сверяются в make-loot-props.mjs).
import type { Scene } from '@babylonjs/core/scene';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import lootUrl from './assets/loot_props.glb?url';

/** GLB моделей лута (узлы p_loot_*). */
export const LOOT_PROPS_URL: string = lootUrl;

/** Предметы, у которых есть модель и значок (порядок — как в каталоге). */
export const LOOT_MODEL_ITEMS = [
  'it_kopeyki',
  'it_radiolamp',
  'it_cards',
  'it_wick',
  'it_kerosene',
  'it_sticker',
  'it_matches',
  'it_hunt_matches',
  'it_backpack',
  'it_briefcase',
  'it_sack',
  'it_bread',
  'it_flashlight',
  'it_tube_ext',
  'it_bulb',
  'it_bug_flash',
  'it_batteries',
  'it_zippo',
  'it_kerolamp',
  'it_preserves',
  'it_bubble',
  'it_yuzgram',
] as const;

const ITEMS: ReadonlySet<string> = new Set(LOOT_MODEL_ITEMS);

/** Id модели (узла GLB, ключ PropModels.get) по id предмета: it_x → p_loot_x; не из набора — null. */
export function lootPropId(itemId: string): string | null {
  return ITEMS.has(itemId) ? `p_loot_${itemId.slice(3)}` : null;
}

const ICONS = import.meta.glob<string>('./assets/loot_icons/*.webp', { query: '?url', import: 'default', eager: true });

/** Адрес значка предмета (WebP 96 × 96, прозрачный фон) или null — значка нет. */
export function lootIconUrl(itemId: string): string | null {
  return ICONS[`./assets/loot_icons/${itemId}.webp`] ?? null;
}

/** Прозрачность стекла по имени материала GLB (та же, что alpha baseColor в make-loot-props.mjs). */
export const LOOT_GLASS: Readonly<Record<string, number>> = {
  /** колба радиолампы, стекло П-2 и «Жучка», колпак керосинки */
  loot_glass_smoked: 0.3,
  /** колба лампочки */
  loot_glass_clear: 0.35,
  /** банка закрутки, бутылка «Пузыря» */
  loot_glass_green: 0.72,
  /** флакон «Юзграма» */
  loot_glass_amber: 0.8,
};

/** Сделать стекло лута прозрачным: StandardMaterial шаблонов PropModels (`propModel:loot_glass_*`) получают альфу и блик.
 *  Вызывать после `models.loaded`; повторный вызов безвреден. Возвращает, сколько материалов поправлено. */
export function applyLootGlass(scene: Scene): number {
  let n = 0;
  for (const m of scene.materials) {
    const a = LOOT_GLASS[m.name.replace(/^propModel:/, '')];
    if (a === undefined) continue;
    const s = m as StandardMaterial;
    s.alpha = a;
    // двустороннее стекло: сначала задние грани, потом передние — без каши сортировки внутри одной колбы
    s.separateCullingPass = true;
    if (s.specularColor) {
      s.specularColor.set(0.55, 0.55, 0.55);
      s.specularPower = 96;
    }
    n++;
  }
  return n;
}

type V3 = readonly [number, number, number];
/** Точки предметов в локальных координатах шаблона PropModels (м; перед — −Z). Для света в руке/на полу. */
export const LOOT_ANCHORS: {
  /** П-2: центр стекла и куда светит; лампочка в отражателе; куда ставится низ-центр p_loot_tube_ext (удлинение) */
  readonly flashlight: { readonly lens: V3; readonly lensDir: V3; readonly bulb: V3; readonly tubeExt: V3 };
  /** «Жучок»: центр стекла и куда светит */
  readonly bug_flash: { readonly lens: V3; readonly lensDir: V3 };
  /** зиппа (крышка открыта): верх фитиля и центр пламени */
  readonly zippo: { readonly wickTop: V3; readonly flame: V3 };
  /** керосинка: верх фитиля и центр пламени (внутри стеклянного колпака) */
  readonly kerolamp: { readonly wickTop: V3; readonly flame: V3 };
  /** лампочка: нить */
  readonly bulb: { readonly filament: V3 };
} = {
  flashlight: { lens: [0, 0.048, -0.1051], lensDir: [0, 0, -1], bulb: [0, 0.048, -0.0913], tubeExt: [0, 0.019, 0.1213] },
  bug_flash: { lens: [-0.0082, 0.0635, -0.0302], lensDir: [0, 0, -1] },
  zippo: { wickTop: [0.01, 0.0735, 0], flame: [0.01, 0.0835, 0] },
  kerolamp: { wickTop: [0, 0.104, 0], flame: [0, 0.116, 0] },
  bulb: { filament: [0, 0.0308, 0] },
};
