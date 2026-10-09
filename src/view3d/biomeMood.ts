// Темнота биома в «Прогулке» (Biome.dark, docs/GENERATOR-4D.md §19.5): пока игрок в квартире (сети ходов) тёмного
// биома, рассеянный и направленный свет просмотрщика гаснет до (1 − dark). Светят светящиеся модели (гирлянды сарая,
// лампочки подвала — emissive) и тусклый тёплый свет у игрока: без него стены рядом в темноте не различить. Логово
// (lairDecor.ts) гасит свет поверх — запоминает текущий и возвращает его же.
// Поверх темноты — множитель и оттенок света (light): общага (src/view3d/obshagaWalk.ts) так гасит свет при отключении
// и делает его тусклым и тёплым, пока лампы горят. Владелец яркости hemi / sun — только этот класс: как было — одно
// запомненное значение, сколько бы раз ни менялись темнота и множитель.
import type { Scene } from '@babylonjs/core/scene';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import type { Light } from '@babylonjs/core/Lights/light';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Observer } from '@babylonjs/core/Misc/observable';

const WARM = new Color3(1, 0.7, 0.38);
/** свет у игрока: над головой, спад до range */
const LAMP_UP = 0.35;
const LAMP_RANGE = 4.5;
const LAMP_MAX = 0.6;

export class BiomeMood {
  /** как было до темноты и множителя: яркость и цвет hemi / sun (пусто — свет не тронут) */
  private was: { light: Light; intensity: number; diffuse: Color3 }[] = [];
  private lamp: PointLight | null = null;
  private obs: Observer<Scene> | null = null;
  private dark = 0;
  private mul = 1;
  private tint: Color3 | null = null;

  constructor(private readonly scene: Scene) {}

  /** Темнота 0…1 (0 — свет как был). */
  set(dark: number) {
    const d = Math.min(1, Math.max(0, Number.isFinite(dark) ? dark : 0));
    if (Math.abs(d - this.dark) < 1e-6) return;
    this.dark = d;
    this.apply();
    this.lamp?.dispose();
    this.lamp = null;
    if (this.obs) this.scene.onBeforeRenderObservable.remove(this.obs);
    this.obs = null;
    if (d <= 0) return;
    const lamp = (this.lamp = new PointLight('mood:lamp', Vector3.Zero(), this.scene));
    lamp.diffuse = WARM;
    lamp.specular = Color3.Black();
    lamp.range = LAMP_RANGE;
    lamp.intensity = LAMP_MAX * d;
    this.obs = this.scene.onBeforeRenderObservable.add(() => {
      const c = this.scene.activeCamera;
      if (c) lamp.position.set(c.globalPosition.x, c.globalPosition.y + LAMP_UP, c.globalPosition.z);
    });
  }

  /** Множитель света сцены поверх темноты биома (1 — нет) и оттенок (null — цвет как был). */
  light(mul: number, tint: Color3 | null = null) {
    const m = Math.max(0, Number.isFinite(mul) ? mul : 1);
    if (Math.abs(m - this.mul) < 1e-4 && (tint === this.tint || (!!tint && !!this.tint && tint.equals(this.tint)))) return;
    this.mul = m;
    this.tint = tint ? tint.clone() : null;
    this.apply();
  }

  /** hemi / sun: как было × (1 − темнота) × множитель, цвет × оттенок; всё снято — как было. */
  private apply() {
    const on = this.dark > 0 || Math.abs(this.mul - 1) > 1e-4 || !!this.tint;
    if (!on) {
      this.restore();
      return;
    }
    if (!this.was.length) {
      for (const name of ['hemi', 'sun']) {
        const l = this.scene.lights.find((x) => x.name === name);
        if (l) this.was.push({ light: l, intensity: l.intensity, diffuse: l.diffuse.clone() });
      }
    }
    for (const w of this.was) {
      w.light.intensity = w.intensity * (1 - this.dark) * this.mul;
      w.light.diffuse = this.tint ? w.diffuse.multiply(this.tint) : w.diffuse.clone();
    }
  }

  private restore() {
    for (const { light, intensity, diffuse } of this.was) {
      light.intensity = intensity;
      light.diffuse = diffuse.clone();
    }
    this.was = [];
  }

  dispose() {
    this.dark = 0;
    this.mul = 1;
    this.tint = null;
    this.restore();
    if (this.obs) this.scene.onBeforeRenderObservable.remove(this.obs);
    this.obs = null;
    this.lamp?.dispose();
    this.lamp = null;
  }
}
