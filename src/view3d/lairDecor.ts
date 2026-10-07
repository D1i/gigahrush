// Логово босса (заглушка, src/locations/lair.ts) в «Прогулке»: пока игрок в комнате с location.kind 'lair', сцена
// болванки темнеет (рассеянный свет просмотрщика гаснет до темноты логова), у дальней стены — табличка
// lairSign(spec) и красный пульсирующий свет. Комната логова — тупик за выходом лифта: соседей в кадре нет, поэтому
// общая темнота сцены = темнота комнаты.
import type { Scene } from '@babylonjs/core/scene';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import type { Light } from '@babylonjs/core/Lights/light';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Observer } from '@babylonjs/core/Misc/observable';

const RED = new Color3(1, 0.12, 0.06);

export class LairDecor {
  private sign: Mesh | null = null;
  private light: PointLight | null = null;
  private hemi: { light: Light; was: number } | null = null;
  private obs: Observer<Scene> | null = null;
  private key = '';

  constructor(private readonly scene: Scene) {}

  /** Показать в комнате: center — проём, через который пришли (на полу), u — внутрь комнаты, depth — до дальней стены. */
  show(key: string, center: Vector3, u: Vector3, depth: number, text: string, darkness: number) {
    if (key === this.key) return;
    this.hide();
    this.key = key;
    const scene = this.scene;
    const far = center.add(u.scale(Math.max(1, depth - 0.06)));
    // табличка: тёмная жесть, буквы краской
    const tex = new DynamicTexture('lair:signTex', { width: 512, height: 160 }, scene, true);
    const g = tex.getContext() as CanvasRenderingContext2D;
    g.fillStyle = '#1b1210';
    g.fillRect(0, 0, 512, 160);
    g.strokeStyle = '#5a2a1e';
    g.lineWidth = 8;
    g.strokeRect(8, 8, 496, 144);
    g.fillStyle = '#d8c3a0';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // кегль — чтобы надпись влезла в табличку с полями
    const label = text.toUpperCase();
    let px = 54;
    for (; px > 18; px -= 2) {
      g.font = `bold ${px}px "Arial Narrow", Arial, sans-serif`;
      if (g.measureText(label).width <= 440) break;
    }
    g.fillText(label, 256, 82);
    tex.update();
    const m = new StandardMaterial('lair:signMat', scene);
    m.diffuseTexture = tex;
    m.specularColor = Color3.Black();
    m.emissiveColor = new Color3(0.08, 0.05, 0.04);
    const sign = MeshBuilder.CreatePlane('lair:sign', { width: 1.6, height: 0.5 }, scene);
    sign.material = m;
    sign.position.set(far.x, center.y + 1.8, far.z);
    // лицевая сторона плоскости смотрит на −z: повернуть её нормаль к проёму (−u)
    sign.rotation.y = Math.atan2(u.x, u.z);
    sign.isPickable = false;
    this.sign = sign;
    const l = (this.light = new PointLight('lair:red', far.subtract(u.scale(0.6)).add(new Vector3(0, 0.6, 0)), scene));
    // материалы болванки — StandardMaterial: спад по дальности (range), яркость — тусклая
    l.range = 6;
    l.diffuse = RED;
    l.specular = RED.scale(0.3);
    // темнота: рассеянный свет просмотрщика — до (1 − darkness) от прежнего
    const hemi = scene.lights.find((x) => x.name === 'hemi');
    if (hemi) {
      this.hemi = { light: hemi, was: hemi.intensity };
      hemi.intensity = this.hemi.was * Math.max(0.04, 1 - darkness);
    }
    const t0 = performance.now();
    this.obs = scene.onBeforeRenderObservable.add(() => {
      const t = (performance.now() - t0) / 1000;
      l.intensity = 0.45 + 0.25 * Math.sin(t * 1.7) * Math.sin(t * 0.63);
    });
  }

  hide() {
    this.key = '';
    if (this.obs) this.scene.onBeforeRenderObservable.remove(this.obs);
    this.obs = null;
    if (this.sign) {
      (this.sign.material as StandardMaterial | null)?.diffuseTexture?.dispose();
      this.sign.material?.dispose();
      this.sign.dispose();
    }
    this.sign = null;
    this.light?.dispose();
    this.light = null;
    if (this.hemi) this.hemi.light.intensity = this.hemi.was;
    this.hemi = null;
  }
}
