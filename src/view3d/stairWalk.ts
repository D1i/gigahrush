// Опора игрока на марше лестницы (src/blockout/stairs.ts, Room.stair).
//
// Стоя опора — гравитация Babylon: постоянные −16 см за кадр к шагу (≈3 см за кадр), а эллипсоид на наклонном полу
// скользит вдоль него — по маршу 27–37° стоящего игрока стаскивало бы вниз, подняться нельзя. Поэтому на марше текущей
// комнаты опора своя: гравитация на кадр выключена, ноги — на линии носков ступеней (+ зазор, эллипсоид не цепляет
// пандус): вверх — сразу, вниз — плавно (до 3 м/с). Ушёл с марша — снова гравитация (поза её включает каждый кадр).
// Оказался внутри площадки (телепорт, спавн у верхней двери) — на её пол. Скрючившись и ползком опора — у позы
// (src/view3d/posture.ts: луч вниз в коллайдеры — невидимый пандус и площадки).
// Наблюдатель кадра добавлен позже позы — видит её applyGravity этого кадра и может его перекрыть.
import type { Scene } from '@babylonjs/core/scene';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import type { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import type { Observer } from '@babylonjs/core/Misc/observable';
import { stairFloorAt } from '../blockout/stairs';
import type { StairGeo } from '../blockout/types';

/** Ноги над линией носков, м: эллипсоид 0.3 × 0.85 на марше до ~48° не касается пандуса. */
const GAP = 0.06;
/** Скорость опускания вслед за маршем, м/с. */
const DOWN = 3;
/** Выше линии носков больше чем на столько — падение (гравитация), а не шаг по маршу, м. */
const CATCH = 0.7;

export class StairSupport {
  /** игрок на марше (опора своя) в последнем кадре — для HUD и QA */
  onFlight = false;
  private obs: Observer<Scene> | null;

  constructor(
    private readonly scene: Scene,
    private readonly cam: Camera,
    /** лестницы текущей комнаты (кусок портального рендера) */
    private readonly stairs: () => readonly StairGeo[] | undefined,
  ) {
    this.obs = scene.onBeforeRenderObservable.add(() => this.frame());
  }

  private frame() {
    this.onFlight = false;
    const cam = this.cam as FreeCamera;
    // стоя (гравитация Babylon включена позой), камера от первого лица с коллизиями
    if (!cam.applyGravity || !cam.checkCollisions || this.scene.activeCamera !== cam) return;
    const g = this.stairs();
    if (!g?.length) return;
    const pos = cam.position;
    const f = stairFloorAt(g, pos.x, -pos.z);
    if (!f) return;
    // низ эллипсоида: центр = позиция − ellipsoid.y + ellipsoidOffset
    const feet = pos.y - 2 * cam.ellipsoid.y + cam.ellipsoidOffset.y;
    if (f.flight) {
      const target = f.z + GAP;
      if (feet > target + CATCH) return;
      cam.applyGravity = false;
      this.onFlight = true;
      const dt = Math.min(0.1, this.scene.getEngine().getDeltaTime() / 1000 || 1 / 60);
      if (feet < target) pos.y += target - feet;
      else pos.y -= Math.min(feet - target, DOWN * dt);
    } else if (feet < f.z - 0.02 && feet > f.z - 3.5) {
      pos.y += f.z + 0.01 - feet;
    }
  }

  dispose() {
    if (this.obs) this.scene.onBeforeRenderObservable.remove(this.obs);
    this.obs = null;
  }
}
