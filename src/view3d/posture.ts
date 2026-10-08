// Поза игрока от первого лица (вкладка «3D», все источники: «Прогулка», «Прогон», «Комната», «Файл»): стоя,
// скрючившись, на четвереньках. Клавиша C — на четвереньки / встать (во весь рост, если над головой есть место, иначе —
// скрючившись; совсем низко — «здесь не встать»). Снежные ходы (src/view3d/snowWalk.ts) сажают на четвереньки сами.
//
//  • Поза — высота глаза, эллипсоид коллизий (у четверенек — низкий: пролезает в лаз 0.9 м) и скорость. Эллипсоид
//    меняется сразу (ноги на месте), глаз — плавно: игрок опускается и встаёт за ~0.4 с.
//  • На четвереньках — ход: толчок на каждый шаг рукой и покачивание плеч, внизу кадра по очереди выбрасываются вперёд
//    руки (src/view3d/snowHands.ts). Скрючившись — лёгкое покачивание, рук нет.
//  • Опора: стоя — гравитация Babylon, как была. Скрючившись и на четвереньках — своя: луч вниз до пола (коллайдеры
//    рядом), ноги — на пол (вниз — плавно, падение до 3 м/с; вверх по склону — сразу), коллизии — только стены. Гравитация
//    Babylon — постоянные −16 см за кадр к шагу: на наклонном полу (чаша берлоги, горки лаза) она стаскивает низкий
//    эллипсоид по склону сильнее, чем шаг ползком (4–10 мм за кадр при 60–144 к/с), — игрок не мог проползти.
//  • Камера Babylon: центр эллипсоида = позиция − ellipsoid.y + ellipsoidOffset; глаз над ногами eye ⇒
//    ellipsoidOffset.y = 2·ellipsoid.y − eye (низ эллипсоида — у ног).
import type { Scene } from '@babylonjs/core/scene';
import type { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Ray } from '@babylonjs/core/Culling/ray';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CrawlHands, CRAWL_CYCLE } from './snowHands';

export type Pose = 'stand' | 'crouch' | 'crawl';

export interface PoseDef {
  /** глаз над ногами, м */
  eye: number;
  /** полуоси эллипсоида коллизий */
  ell: [number, number, number];
  /** скорость камеры (UniversalCamera.speed) */
  speed: number;
}

export const POSES: Record<Pose, PoseDef> = {
  stand: { eye: 1.6, ell: [0.3, 0.85, 0.3], speed: 0.22 },
  crouch: { eye: 1.1, ell: [0.28, 0.6, 0.28], speed: 0.11 },
  crawl: { eye: 0.5, ell: [0.25, 0.28, 0.25], speed: 0.075 },
};

/** Над головой нужно (от ног) — встать во весь рост / скрючившись, м. */
export const ROOM_STAND = 1.8;
export const ROOM_CROUCH = 1.25;

export const POSE_NAME: Record<Pose, string> = { stand: 'стоя', crouch: 'скрючившись', crawl: 'на четвереньках' };

export class Posture {
  pose: Pose = 'stand';
  /** глаз над ногами сейчас (поза + ход) */
  eye = POSES.stand.eye;
  /** не двигаться (засыпало) */
  frozen = false;
  /** смена позы и отказ («здесь не встать») — для HUD */
  onChange: ((pose: Pose, note: string | null) => void) | null = null;
  private base = POSES.stand.eye;
  private bob = 0;
  private phase = 0;
  private last: Vector3 | null = null;
  private hands: CrawlHands | null = null;
  private obs: Observer<Scene> | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly cam: UniversalCamera,
    /** поза действует (от первого лица, без своей сцены поверх) */
    private readonly live: () => boolean,
  ) {
    this.obs = scene.onBeforeRenderObservable.add(() => this.frame());
  }

  /** Ноги (высота), м. */
  get feet(): number {
    return this.cam.position.y - this.eye;
  }

  /** Пол под игроком: луч вниз от глаза в коллайдеры рядом (до 1.5 м ниже ног); null — пола нет. */
  floorAt(): number | null {
    const c = this.cam.position;
    const ray = new Ray(new Vector3(c.x, c.y, c.z), Vector3.Down(), this.eye + 1.5);
    let best: number | null = null;
    for (const m of this.scene.meshes) {
      if (!m.checkCollisions || !m.isEnabled()) continue;
      const b = m.getBoundingInfo().boundingBox;
      if (c.x < b.minimumWorld.x - 0.3 || c.x > b.maximumWorld.x + 0.3 || c.z < b.minimumWorld.z - 0.3 || c.z > b.maximumWorld.z + 0.3) continue;
      const hit = ray.intersectsMesh(m as Mesh, false);
      if (hit.hit && (best === null || hit.distance < best)) best = hit.distance;
    }
    return best === null ? null : c.y - best;
  }

  /** Сколько места над ногами (луч вверх в коллайдеры рядом), м; 3 — потолка нет. */
  headroom(): number {
    const c = this.cam.position;
    const feet = c.y - this.eye;
    const ray = new Ray(new Vector3(c.x, feet + 0.25, c.z), Vector3.Up(), 3);
    let best = 3;
    for (const m of this.scene.meshes) {
      if (!m.checkCollisions || !m.isEnabled()) continue;
      const b = m.getBoundingInfo().boundingBox;
      if (c.x < b.minimumWorld.x - 0.5 || c.x > b.maximumWorld.x + 0.5 || c.z < b.minimumWorld.z - 0.5 || c.z > b.maximumWorld.z + 0.5) continue;
      const hit = ray.intersectsMesh(m as Mesh, false);
      if (hit.hit && hit.distance + 0.25 < best) best = hit.distance + 0.25;
    }
    return best;
  }

  /** Поза сразу (снежные ходы: на четвереньки; выход из снега — стоя). Эллипсоид — сейчас, глаз — плавно. */
  set(pose: Pose, note: string | null = null) {
    if (pose === this.pose) return;
    this.pose = pose;
    const d = POSES[pose];
    this.cam.ellipsoid.set(d.ell[0], d.ell[1], d.ell[2]);
    this.cam.ellipsoidOffset.y = 2 * d.ell[1] - this.eye;
    this.last = null;
    this.onChange?.(pose, note);
  }

  /** C: на четвереньки ↔ встать (во весь рост / скрючившись — по месту над головой). false — встать негде. */
  toggle(): boolean {
    if (this.pose !== 'crawl') {
      this.set('crawl');
      return true;
    }
    const room = this.headroom();
    if (room >= ROOM_STAND) this.set('stand');
    else if (room >= ROOM_CROUCH) this.set('crouch');
    else {
      this.onChange?.(this.pose, 'Здесь не встать — низко');
      return false;
    }
    return true;
  }

  private frame() {
    if (!this.live()) {
      this.hands?.update(0, 0, 0.016);
      return;
    }
    const dt = Math.min(0.1, this.scene.getEngine().getDeltaTime() / 1000 || 1 / 60);
    const c = this.cam.position;
    const d = POSES[this.pose];
    // глаз — плавно к позе
    this.base += (d.eye - this.base) * Math.min(1, dt * 7);
    // ход: фаза — по пути
    const p = new Vector3(c.x, 0, c.z);
    const moved = this.last ? Vector3.Distance(p, this.last) : 0;
    this.last = p;
    const step = moved > 0.5 ? 0 : moved;
    this.phase += (step / CRAWL_CYCLE) * Math.PI * 2;
    const k = this.pose === 'crawl' ? Math.min(1, Math.max(0, (1.0 - this.base) / 0.45)) : 0;
    const bobWant = this.pose === 'stand' ? 0 : k * 0.03 * (Math.abs(Math.sin(this.phase)) - 0.5) + (1 - k) * 0.012 * Math.abs(Math.sin(this.phase * 0.8));
    this.bob += (bobWant - this.bob) * Math.min(1, dt * 12);
    const eye = this.base + this.bob;
    c.y += eye - this.eye;
    this.eye = eye;
    // опора: стоя — гравитация Babylon; низко — своя (ноги на пол по лучу вниз)
    const own = this.pose !== 'stand';
    this.cam.applyGravity = !own;
    if (own) {
      const floor = this.floorAt();
      const feet = c.y - eye;
      if (floor === null) c.y -= 3 * dt;
      else {
        const target = floor + 0.012;
        if (feet > target) c.y -= Math.min(feet - target, 3 * dt);
        else c.y += target - feet;
      }
    }
    this.cam.ellipsoidOffset.y = 2 * this.cam.ellipsoid.y - eye;
    this.cam.speed = this.frozen ? 0 : d.speed;
    // покачивание плеч (крен) — только ползком; тряска (обвал) — поверх, от снега (roll)
    this.sway = k * 0.03 * Math.sin(this.phase);
    this.cam.rotation.z = this.sway + this.roll;
    if (k > 0.3 && !this.hands) this.hands = new CrawlHands(this.scene, this.cam);
    this.hands?.update(this.phase, this.frozen ? 0 : k, dt);
  }

  /** крен хода (рад) */
  sway = 0;
  /** добавочный крен (тряска обвала в снегу), рад */
  roll = 0;

  dispose() {
    if (this.obs) this.scene.onBeforeRenderObservable.remove(this.obs);
    this.hands?.dispose();
    this.hands = null;
  }
}
