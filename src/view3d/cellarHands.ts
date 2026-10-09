// Руки от первого лица в щели погреба (src/view3d/cellarWalk.ts): протискиваешься боком лицом к стене — обе ладони
// в вязаных перчатках плашмя на стене перед лицом, пальцами вверх, рукава ватника уходят вниз за край кадра. Без
// ассетов: примитивы (как CrawlHands, ./snowHands.ts).
//
// Приставной шаг — фаза по пути вбок (src/locations/cellarSqueeze.ts stepShuffle): ладони по очереди перехватывают
// стену — та, что идёт в сторону хода, чуть отрывается от стены и уходит вперёд, упёртая — остаётся на месте (в кадре
// уходит назад, тело ползёт мимо неё). Стоит — ладони на стене, лёгкое дыхание. Стена под углом (в щели можно
// повернуться на ~±53°) — ладони на её плоскости, развёрнуты вдоль неё. Рисуются поверх стен (группа рендера 1).
// Узел рук — у глаза и по повороту взгляда, без наклона и крена камеры: стена вертикальна, ладони на ней тоже —
// посмотрел вниз или качнулась голова — руки остаются на стене.
import type { Scene } from '@babylonjs/core/scene';
import type { TargetCamera } from '@babylonjs/core/Cameras/targetCamera';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';

/** Ладони: от середины в стороны, м (оси камеры); ход перехвата вбок, м; высота (ниже глаза), м. */
export const PALM_X = 0.1;
export const PALM_SLIDE = 0.035;
export const PALM_Y = -0.075;
/** Ладонь ближе стольких м / дальше — не на стене (z камеры). */
export const PALM_Z_MIN = 0.1;
export const PALM_Z_MAX = 0.42;
/** Стена дальше стольких м или под углом больше WALL_MAX_DELTA — рук на стене нет. */
export const WALL_FAR = 0.5;
export const WALL_MAX_DELTA = 1.05;

export interface PalmPose {
  /** середина ладони в осях взгляда без наклона (x вправо, y вверх, z вперёд по горизонтали; начало — глаз) */
  x: number;
  y: number;
  z: number;
  /** поворот ладони вдоль стены (рад, вокруг вертикали камеры) */
  yaw: number;
  /** 0…1 — оторвана от стены (идёт вперёд) */
  lift: number;
}

/**
 * Поза ладони side (−1 левая, 1 правая) у стены: phase — фаза приставного шага (рад), dir — сторона хода (1 — вправо),
 * dist — до стены по её нормали от глаза (м), delta — угол от взгляда до направления на стену (рад, + — стена правее).
 */
export function wallPalm(phase: number, side: -1 | 1, dir: 1 | -1, dist: number, delta: number, breathe = 0): PalmPose {
  const ph = phase + (side > 0 ? 0 : Math.PI);
  const lift = Math.max(0, Math.cos(ph));
  const x = side * PALM_X + dir * PALM_SLIDE * Math.sin(ph);
  const s = Math.sin(delta), c = Math.max(0.2, Math.cos(delta));
  // на плоскости стены: (x, z)·(sin δ, cos δ) = dist − толщина ладони − отрыв
  const d = dist - 0.014 - 0.012 * lift;
  const z = Math.min(PALM_Z_MAX, Math.max(PALM_Z_MIN, (d - x * s) / c));
  return { x, y: PALM_Y + 0.012 * lift + breathe, z, yaw: delta, lift };
}

const smooth = (t: number) => t * t * (3 - 2 * t);

export class WallHands {
  readonly root: TransformNode;
  private hands: { node: TransformNode; arm: Mesh; side: -1 | 1 }[] = [];
  private mats: StandardMaterial[] = [];
  /** видны 0…1 (появляются и прячутся плавно — уходят вниз) */
  private shown = 0;
  private t = 0;
  /** стена: последняя известная (рук нет — держать, пока прячутся) */
  private dist = 0.25;
  private delta = 0;

  constructor(
    scene: Scene,
    private readonly camera: TargetCamera,
  ) {
    this.root = new TransformNode('cellar:hands', scene);
    // вязаная перчатка и рукав ватника — как у фонаря в руке (./flashlight.ts)
    const glove = new StandardMaterial('cellar:glove', scene);
    glove.diffuseColor = new Color3(0.2, 0.175, 0.15);
    glove.specularColor = new Color3(0.02, 0.02, 0.02);
    const sleeve = new StandardMaterial('cellar:sleeve', scene);
    sleeve.diffuseColor = new Color3(0.2, 0.21, 0.17);
    sleeve.specularColor = new Color3(0.02, 0.02, 0.02);
    const cuff = new StandardMaterial('cellar:cuff', scene);
    cuff.diffuseColor = new Color3(0.3, 0.27, 0.23);
    cuff.specularColor = Color3.Black();
    this.mats = [glove, sleeve, cuff];
    for (const side of [-1, 1] as const) {
      const node = new TransformNode(`cellar:hand${side}`, scene);
      node.parent = this.root;
      // ладонь плашмя (тонкая по z), пальцами вверх; большой палец — к середине, отставлен
      const palm = MeshBuilder.CreateSphere('cellar:palm', { diameter: 1, segments: 10 }, scene);
      palm.scaling.set(0.086, 0.16, 0.03);
      palm.position.set(0, 0.01, 0);
      palm.rotation.z = side * 0.12;
      palm.material = glove;
      palm.parent = node;
      const thumb = MeshBuilder.CreateSphere('cellar:thumb', { diameter: 1, segments: 8 }, scene);
      thumb.scaling.set(0.026, 0.07, 0.026);
      thumb.position.set(-side * 0.046, -0.03, -0.004);
      thumb.rotation.z = side * 0.75;
      thumb.material = glove;
      thumb.parent = node;
      const band = MeshBuilder.CreateCylinder('cellar:cuff', { diameter: 0.07, height: 0.04, tessellation: 12 }, scene);
      band.position.set(side * 0.004, -0.075, -0.012);
      band.rotation.x = -0.35;
      band.material = cuff;
      band.parent = node;
      // рукав: от запястья к плечу (вниз, назад, наружу — за край кадра) — ориентируется каждый кадр
      const arm = MeshBuilder.CreateCylinder('cellar:sleeve', { diameterTop: 0.08, diameterBottom: 0.115, height: 1, tessellation: 12 }, scene);
      arm.material = sleeve;
      arm.parent = this.root;
      for (const m of [palm, thumb, band, arm]) {
        m.isPickable = false;
        m.checkCollisions = false;
        m.renderingGroupId = 1;
        m.alwaysSelectAsActiveMesh = true;
        m.layerMask = 0x0fffffff;
      }
      this.hands.push({ node, arm, side });
    }
    this.root.setEnabled(false);
  }

  /** Видны ли сейчас (QA). */
  get visible(): boolean {
    return this.root.isEnabled();
  }

  /**
   * Кадр: on — руки на стене (боком в щели), phase / dir — приставной шаг, wall — стена перед лицом (dist — по её
   * нормали от глаза, delta — угол от взгляда; null — нет), dt — с, lit — 0…1 отсвет фонаря на перчатках.
   */
  update(on: boolean, phase: number, dir: 1 | -1, wall: { dist: number; delta: number } | null, dt: number, lit = 0) {
    this.t += dt;
    const can = on && !!wall && wall.dist < WALL_FAR && Math.abs(wall.delta) < WALL_MAX_DELTA;
    if (can && wall) {
      // стена «прыгает» (угол, другая стена) — ладони переходят к ней плавно
      const k = Math.min(1, dt * 14);
      this.dist += (wall.dist - this.dist) * k;
      this.delta += (wall.delta - this.delta) * k;
    }
    this.shown = Math.min(1, Math.max(0, this.shown + (can ? dt : -dt) / 0.28));
    const vis = this.shown > 0.01;
    if (vis !== this.root.isEnabled()) this.root.setEnabled(vis);
    if (!vis) return;
    // у глаза, по повороту взгляда (без наклона и крена)
    this.root.position.copyFrom(this.camera.position);
    this.root.rotation.set(0, this.camera.rotation.y, 0);
    const f = smooth(this.shown);
    const hide = 1 - f;
    const breathe = 0.004 * Math.sin(this.t * 1.9);
    const glow = 0.018 + 0.05 * Math.min(1, Math.max(0, lit));
    for (const m of this.mats) m.emissiveColor.set(glow, glow * 0.92, glow * 0.8);
    for (const h of this.hands) {
      const s = h.side;
      const p = wallPalm(phase, s, dir, this.dist, this.delta, breathe * (s > 0 ? 1 : 0.7));
      // прячутся — вниз и к себе
      const x = p.x * (1 - 0.3 * hide), y = p.y - 0.22 * hide, z = p.z - 0.06 * hide;
      h.node.position.set(x, y, z);
      h.node.rotation.set(-0.25 * p.lift, p.yaw, 0);
      // рукав: от запястья к плечу за краем кадра
      const wrist = new Vector3(x + s * 0.004, y - 0.085, z - 0.02);
      const end = new Vector3(s * 0.2, -0.38 - 0.1 * hide, -0.04);
      const d = end.subtract(wrist);
      const len = d.length();
      h.arm.position.copyFrom(wrist.add(d.scale(0.5)));
      h.arm.scaling.set(1, len, 1);
      const ax = d.normalize();
      h.arm.rotation.set(Math.acos(Math.max(-1, Math.min(1, ax.y))), Math.atan2(ax.x, ax.z), 0);
    }
  }

  dispose() {
    for (const m of this.mats) m.dispose();
    this.root.dispose(false, true);
  }
}
