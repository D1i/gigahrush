// Анимация открытия дверей «Прогулки» (портальный рендер, src/view3d/portal.ts). Подробно — docs/DOORS.md §3–4.
//
//  1. Отпирание (style.anim.unlatchS): ручка нажимается (засов отодвигается, штурвал крутится), полотно ещё закрыто.
//     В это время мир растёт за дверью (world.openDoor), кусок комнаты пересобирается: глухая стена за полотном
//     становится проёмом. Полотно шире проёма и висит перед стеной — подмены не видно.
//  2. Ожидание: распах начинается, только когда комната за дверью построена и её меши готовы к отрисовке (ready),
//     — иначе в щели мелькнул бы цвет фона. Ручка всё это время нажата (до 3 с, потом распах всё равно).
//  3. Распах (style.anim.swingS): полотно идёт к игроку — медленный старт, разгон, лёгкий удар об упор (+3.5%) и
//     возврат в угол покоя; ручка отпускается. Угол покоя — тот же, что ядро ставит открытому выходу (restAngle),
//     поэтому после анимации пересобранный кусок встаёт ровно туда же.
//  Игрок в зоне распаха мягко отходит назад (полотно не проходит сквозь камеру; коллизий у дверей нет).
//  Кусок комнаты, пересобранный посреди анимации, берёт текущую позу (BabylonBlockoutOptions.doorPose).
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { Scene } from '@babylonjs/core/scene';
import type { TargetCamera } from '@babylonjs/core/Cameras/targetCamera';
import { poseDoor, type DoorMeshes, type DoorPose } from '../blockout/babylon';
import { DOOR_STYLE_BY_ID, restAngle, type DoorStyle } from '../blockout/doors';
import type { DoorSlot } from '../blockout/types';

/** Сколько ждать готовности комнаты за дверью, прежде чем распахнуть всё равно, с. */
const READY_WAIT_S = 3;
/** Неудача (за дверью ничего не встало): дребезг ручки и полотна, с. */
const FAIL_S = 0.9;
/** «Радиус» игрока для отхода от полотна, м (эллипсоид камеры 0.3 + запас). */
const PLAYER_R = 0.36;
/** Отход за кадр не больше, м. */
const PUSH_MAX = 0.05;

export type DoorAnimPhase = 'unlatch' | 'swing' | 'fail';

interface Anim {
  inst: string;
  connector: string;
  style: DoorStyle;
  /** угол покоя (куда распахнуть), градусы */
  to: number;
  t0: number;
  swingAt: number | null;
  failAt: number | null;
  ready: () => boolean;
}

export interface DoorAnimOptions {
  /** комната за дверью готова (мир вырос, её кусок построен и готов к отрисовке) — можно распахивать */
  ready?: () => boolean;
}

export interface DoorAnimHandle {
  /** за дверью ничего не встало — дребезг и остаётся закрытой */
  fail(): void;
  readonly phase: DoorAnimPhase | 'done';
}

const easeInOut = (u: number): number => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);

/** Кривая распаха 0…1 → доля угла: разгон и торможение до 1.035 (удар об упор), затем возврат к 1. */
export function swingCurve(s: number): number {
  if (s <= 0) return 0;
  if (s >= 1) return 1;
  const K = 0.78, OVER = 1.035;
  if (s < K) return OVER * easeInOut(s / K);
  const v = (s - K) / (1 - K);
  return OVER - (OVER - 1) * (1 - (1 - v) * (1 - v));
}

export class DoorAnimator {
  private anims = new Map<string, Anim>();
  private obs: Observer<Scene> | null;
  /** часы (QA может подменить) */
  now: () => number = () => performance.now();

  constructor(
    readonly scene: Scene,
    private readonly camera: TargetCamera,
    /** подвижная дверь в текущих кусках (null — кусок не построен) */
    private readonly find: (inst: string, connector: string) => DoorMeshes | null,
  ) {
    this.obs = scene.onBeforeRenderObservable.add(() => this.update());
  }

  /** Есть ли анимации (для QA и HUD). */
  get active(): number {
    return this.anims.size;
  }

  phaseOf(inst: string, connector: string): DoorAnimPhase | 'done' {
    const a = this.anims.get(`${inst}/${connector}`);
    return !a ? 'done' : a.failAt !== null ? 'fail' : a.swingAt !== null ? 'swing' : 'unlatch';
  }

  /**
   * Начать открытие двери-выхода slot (закрытой, в текущем куске). Угол покоя — как у ядра для открытого выхода
   * (restAngle по месту двери). null — двери нет в кусках или её модели нет в каталоге.
   */
  open(slot: DoorSlot, opts: DoorAnimOptions = {}): DoorAnimHandle | null {
    const style = DOOR_STYLE_BY_ID.get(slot.style);
    if (!style) return null;
    const key = `${slot.inst}/${slot.connector}`;
    const a: Anim = {
      inst: slot.inst,
      connector: slot.connector,
      style,
      to: restAngle(style, slot.seed, slot.widthM, slot.hinge === 'left' ? slot.space[0] : slot.space[1]),
      t0: this.now(),
      swingAt: null,
      failAt: null,
      ready: opts.ready ?? (() => true),
    };
    this.anims.set(key, a);
    const self = this;
    return {
      fail() {
        if (self.anims.get(key) === a && a.swingAt === null) a.failAt = self.now();
      },
      get phase() {
        return self.anims.get(key) === a ? self.phaseOf(a.inst, a.connector) : 'done';
      },
    };
  }

  /** Поза двери сейчас (для постройки куска посреди анимации); null — дверь не анимируется. */
  pose(slot: DoorSlot): DoorPose | null {
    const a = this.anims.get(`${slot.inst}/${slot.connector}`);
    return a ? this.poseOf(a, this.now()).pose : null;
  }

  private poseOf(a: Anim, t: number): { pose: DoorPose; done: boolean } {
    const st = a.style.anim;
    const el = (t - a.t0) / 1000;
    if (a.failAt !== null) {
      const f = (t - a.failAt) / 1000;
      if (f >= FAIL_S) return { pose: { angle: 0, handle: 0 }, done: true };
      // ручку дёргают, полотно дребезжит в коробке
      const k = 1 - f / FAIL_S;
      return { pose: { angle: Math.max(0, Math.sin(f * 38) * 0.8 * k), handle: 0.5 + 0.5 * Math.abs(Math.sin(f * 9)) * k }, done: false };
    }
    if (a.swingAt === null) {
      // отпирание: ручка доходит до упора к 60% времени и держится
      const u = st.unlatchS > 0 ? Math.min(1, el / (st.unlatchS * 0.6)) : 1;
      return { pose: { angle: 0, handle: easeInOut(u) }, done: false };
    }
    const s = (t - a.swingAt) / 1000 / Math.max(0.05, st.swingS);
    if (s >= 1) return { pose: { angle: a.to, handle: 0 }, done: true };
    return { pose: { angle: a.to * swingCurve(s), handle: Math.max(0, 1 - s / 0.25) }, done: false };
  }

  private update() {
    if (!this.anims.size) return;
    const t = this.now();
    for (const [key, a] of [...this.anims]) {
      if (a.swingAt === null && a.failAt === null) {
        const el = (t - a.t0) / 1000;
        if (el >= a.style.anim.unlatchS && (a.ready() || el >= a.style.anim.unlatchS + READY_WAIT_S)) a.swingAt = t;
      }
      const { pose, done } = this.poseOf(a, t);
      const d = this.find(a.inst, a.connector);
      if (d) {
        poseDoor(d, pose.angle, pose.handle);
        if (a.swingAt !== null && !done) this.pushPlayer(d, pose.angle);
      }
      if (done) this.anims.delete(key);
    }
  }

  /** Игрок в зоне распаха — отходит назад (вдоль нормали двери, с коллизиями камеры), пока полотно его не задело. */
  private pushPlayer(d: DoorMeshes, angle: number) {
    const cam = this.camera;
    const th = (angle * Math.PI) / 180;
    for (const lf of d.leaves) {
      const P = lf.mesh.position;
      const s = lf.geo.sign;
      // вдоль закрытого полотна (от петель к свободному краю) и «в комнату» — в мире
      const e = new Vector3(s * Math.cos(lf.yaw), 0, -s * Math.sin(lf.yaw));
      const o = new Vector3(-Math.sin(lf.yaw), 0, -Math.cos(lf.yaw));
      const dx = cam.position.x - P.x, dz = cam.position.z - P.z;
      const t = dx * e.x + dz * e.z;
      const n = dx * o.x + dz * o.z;
      const W = lf.geo.width;
      const r = Math.hypot(t, n);
      if (r >= W + PLAYER_R || n < -0.05 || t < -PLAYER_R) continue;
      const delta = Math.asin(Math.min(1, PLAYER_R / Math.max(r, PLAYER_R)));
      const lead = th + delta + 0.2;
      if (Math.atan2(n, t) > lead) continue;
      const n1 = lead < Math.PI / 2 - 0.01 && t > 0 ? t * Math.tan(lead) : Infinity;
      const n2 = Math.sqrt(Math.max(0, (W + PLAYER_R) ** 2 - t * t));
      const need = Math.min(n1, n2);
      if (n >= need) continue;
      const step = Math.min(PUSH_MAX, need - n);
      cam.cameraDirection.addInPlace(o.scale(step));
    }
  }

  /** Остановить всё (двери остаются в текущей позе). */
  clear() {
    this.anims.clear();
  }

  dispose() {
    if (this.obs) this.scene.onBeforeRenderObservable.remove(this.obs);
    this.obs = null;
    this.anims.clear();
  }
}
