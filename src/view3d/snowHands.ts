// Руки от первого лица в снежных ходах (src/view3d/snowWalk.ts): ползёшь на четвереньках — внизу кадра по очереди
// выбрасываются вперёд и упираются в снег руки в варежках и рукавах ватника. Без ассетов: примитивы.
//
// Ход ползком — цикл по пройденному пути (CRAWL_CYCLE м на два шага рук): рука в воздухе идёт вперёд (поднята),
// упёртая — уходит назад (тело ползёт над ней); правая — в противофазе с левой. Стоит — руки упёрты, лёгкое дыхание.
// Рисуются поверх снега (группа рендера 1, как «руки» в шутерах): в стену лаза не проваливаются.
import type { Scene } from '@babylonjs/core/scene';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';

/** Путь ползком за полный цикл (левая + правая рука), м. */
export const CRAWL_CYCLE = 0.62;

/** Поза руки в осях камеры (x вправо, y вверх, z вперёд) по фазе p (рад): в воздухе при sin p > 0. */
export function handPose(p: number, side: -1 | 1, breathe = 0): { x: number; y: number; z: number; lift: number } {
  const lift = Math.max(0, Math.sin(p));
  return {
    x: side * (0.15 + 0.02 * lift),
    y: -0.25 + 0.07 * lift + breathe,
    z: 0.45 - 0.11 * Math.cos(p),
    lift,
  };
}

export class CrawlHands {
  readonly root: TransformNode;
  private hands: { node: TransformNode; arm: Mesh; side: -1 | 1 }[] = [];
  private shown = 0;
  private t = 0;

  constructor(scene: Scene, camera: Camera) {
    this.root = new TransformNode('snow:hands', scene);
    this.root.parent = camera;
    const sleeve = new StandardMaterial('snow:sleeve', scene);
    sleeve.diffuseColor = new Color3(0.2, 0.21, 0.17);
    sleeve.specularColor = new Color3(0.02, 0.02, 0.02);
    const mitten = new StandardMaterial('snow:mitten', scene);
    mitten.diffuseColor = new Color3(0.36, 0.33, 0.3);
    mitten.specularColor = new Color3(0.03, 0.03, 0.03);
    const cuff = new StandardMaterial('snow:cuff', scene);
    cuff.diffuseColor = new Color3(0.55, 0.53, 0.5);
    cuff.specularColor = Color3.Black();
    for (const side of [-1, 1] as const) {
      const node = new TransformNode(`snow:hand${side}`, scene);
      node.parent = this.root;
      // варежка: ладонь (сплюснутый эллипсоид) и большой палец
      const palm = MeshBuilder.CreateSphere('snow:palm', { diameter: 1, segments: 8 }, scene);
      palm.scaling.set(0.085, 0.045, 0.12);
      palm.position.set(0, 0, 0.02);
      palm.material = mitten;
      palm.parent = node;
      const thumb = MeshBuilder.CreateSphere('snow:thumb', { diameter: 1, segments: 6 }, scene);
      thumb.scaling.set(0.032, 0.03, 0.06);
      thumb.position.set(-side * 0.042, 0.004, 0.01);
      thumb.rotation.y = -side * 0.5;
      thumb.material = mitten;
      thumb.parent = node;
      const band = MeshBuilder.CreateCylinder('snow:cuff', { diameter: 0.075, height: 0.04, tessellation: 10 }, scene);
      band.rotation.x = Math.PI / 2;
      band.position.set(0, 0.005, -0.06);
      band.material = cuff;
      band.parent = node;
      // рукав ватника: от запястья к плечу (вниз и назад, за край кадра) — ориентируется каждый кадр
      const arm = MeshBuilder.CreateCylinder('snow:sleeve', { diameterTop: 0.085, diameterBottom: 0.11, height: 1, tessellation: 10 }, scene);
      arm.material = sleeve;
      arm.parent = this.root;
      for (const m of [palm, thumb, band, arm]) {
        m.isPickable = false;
        m.renderingGroupId = 1;
        m.alwaysSelectAsActiveMesh = true;
      }
      this.hands.push({ node, arm, side });
    }
    this.root.setEnabled(false);
  }

  /**
   * Кадр: phase — фаза хода (рад, растёт с путём), k — 0…1 насколько ползком (0 — стоит скрючившись: рук не видно),
   * dt — с. Руки видны при k > 0.3, появляются и прячутся плавно (уходят вниз).
   */
  update(phase: number, k: number, dt: number) {
    this.t += dt;
    this.shown += ((k > 0.3 ? 1 : 0) - this.shown) * Math.min(1, dt * 6);
    const on = this.shown > 0.02;
    if (on !== this.root.isEnabled()) this.root.setEnabled(on);
    if (!on) return;
    const breathe = 0.006 * Math.sin(this.t * 1.7);
    const hide = (1 - this.shown) * 0.25;
    for (const h of this.hands) {
      const p = handPose(phase + (h.side > 0 ? Math.PI : 0), h.side, breathe);
      h.node.position.set(p.x, p.y - hide, p.z);
      h.node.rotation.set(0.25 - 0.35 * p.lift, -h.side * 0.12, h.side * 0.15);
      // рукав: от запястья к плечу
      const wrist = new Vector3(p.x, p.y - hide + 0.005, p.z - 0.07);
      const shoulder = new Vector3(h.side * 0.21, -0.4 - hide, -0.1);
      const d = shoulder.subtract(wrist);
      const len = d.length();
      h.arm.position.copyFrom(wrist.add(d.scale(0.5)));
      h.arm.scaling.set(1, len, 1);
      // ось цилиндра (y) — вдоль руки
      const yAxis = d.normalize();
      const pitch = Math.acos(Math.max(-1, Math.min(1, yAxis.y)));
      const yaw = Math.atan2(yAxis.x, yAxis.z);
      h.arm.rotation.set(pitch, yaw, 0);
    }
  }

  dispose() {
    for (const m of this.root.getChildMeshes(false)) m.material?.dispose();
    this.root.dispose(false, true);
  }
}
