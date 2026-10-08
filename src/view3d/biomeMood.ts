// Темнота биома в «Прогулке» (Biome.dark, docs/GENERATOR-4D.md §19.5): пока игрок в квартире (сети ходов) тёмного
// биома, рассеянный и направленный свет просмотрщика гаснет до (1 − dark). Светят светящиеся модели (гирлянды сарая,
// лампочки подвала — emissive) и тусклый тёплый свет у игрока: без него стены рядом в темноте не различить. Логово
// (lairDecor.ts) гасит свет поверх — запоминает текущий и возвращает его же.
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
  private was: { light: Light; intensity: number }[] = [];
  private lamp: PointLight | null = null;
  private obs: Observer<Scene> | null = null;
  private dark = 0;

  constructor(private readonly scene: Scene) {}

  /** Темнота 0…1 (0 — свет как был). */
  set(dark: number) {
    const d = Math.min(1, Math.max(0, Number.isFinite(dark) ? dark : 0));
    if (Math.abs(d - this.dark) < 1e-6) return;
    this.restore();
    if (d <= 0) return;
    this.dark = d;
    for (const name of ['hemi', 'sun']) {
      const l = this.scene.lights.find((x) => x.name === name);
      if (!l) continue;
      this.was.push({ light: l, intensity: l.intensity });
      l.intensity *= 1 - d;
    }
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

  private restore() {
    for (const { light, intensity } of this.was) light.intensity = intensity;
    this.was = [];
    if (this.obs) this.scene.onBeforeRenderObservable.remove(this.obs);
    this.obs = null;
    this.lamp?.dispose();
    this.lamp = null;
    this.dark = 0;
  }

  dispose() {
    this.restore();
  }
}
