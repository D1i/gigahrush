// Бездонный эскалатор в «Прогулке» (tmp/metro-wip/FRACTAL.md §6.3) — клей, по образцу liftTimer (View3DPage.tsx):
//  • комната под ногами с тегом «бездна» (src/locations/fractalEntry.ts) — по высоте ступней над её низом затемнение
//    (onVeil 0…1 → CSS-вуаль поверх канваса; туманом метро управляет MetroWalk — с ним не спорим);
//  • опустился до ABYSS.enterAt подъёма (и не поднимается) — onEnter(id) один раз на заход: страница открывает слой
//    «Фрактальной станции». Сброс — когда игрок ушёл из комнаты или поднялся выше начала вуали.
// Ход по дорожкам, их направления и отсутствие срыва — модуль метро (src/view3d/metroWalk.ts).
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { Scene } from '@babylonjs/core/scene';
import type { RunExport, RunInstance } from '../blockout/types';
import { ABYSS, abyssEnter, abyssVeil, isAbyss } from '../locations/fractalEntry';
import type { FoldDriver } from './fold';
import type { BlockoutViewer } from './viewer';

export interface AbyssHost {
  viewer: BlockoutViewer;
  driver: () => FoldDriver | null;
  /** прогулка идёт: первое лицо, нет слоя спец-локации, не пауза */
  live: () => boolean;
  /** затемнение 0…1 (зовётся только при изменении) */
  onVeil(v: number): void;
  /** пора во «Фрактальную станцию»: id экземпляра бездны */
  onEnter(instId: string): void;
}

/** Подъём лестницы экземпляра над его низом, м (самая высокая площадка / верх марша). */
function riseOf(inst: RunInstance): number {
  let z = 0;
  for (const f of inst.escLanes ?? inst.stair?.flights ?? []) z = Math.max(z, f.z0, f.z1);
  for (const p of inst.stair?.pads ?? []) z = Math.max(z, p.z);
  return z;
}

export class AbyssWalk {
  private readonly obs: Observer<Scene> | null;
  private idx: { rx: RunExport | null; by: Map<string, RunInstance> } = { rx: null, by: new Map() };
  private veil = 0;
  /** бездна, в которую уже вошли (до ухода из комнаты / подъёма выше вуали) */
  private entered: string | null = null;
  private feetPrev = NaN;
  private room: string | null = null;
  private disposed = false;

  constructor(private readonly host: AbyssHost) {
    const scene = host.viewer.scene;
    this.obs = scene.onBeforeRenderObservable.add(() => this.tick(Math.min(0.1, scene.getEngine().getDeltaTime() / 1000 || 1 / 60)));
  }

  private instOf(rx: RunExport, id: string | null): RunInstance | null {
    if (!id) return null;
    if (this.idx.rx !== rx) this.idx = { rx, by: new Map(rx.instances.map((i) => [i.id, i])) };
    return this.idx.by.get(id) ?? null;
  }

  private setVeil(v: number) {
    const q = Math.round(v * 200) / 200;
    if (q === this.veil) return;
    this.veil = q;
    this.host.onVeil(q);
  }

  /** Раз в кадр (сам, из onBeforeRender сцены прогулки): вуаль и вход. */
  tick(_dt: number): void {
    if (this.disposed) return;
    const d = this.host.driver();
    // слой спец-локации / облёт / пауза: ничего не трогать (вуаль снята при входе)
    if (!d || !this.host.live()) return;
    const portal = d.portal?.isActive ? d.portal : null;
    const room = portal?.current ?? d.current.center ?? null;
    // комната на миг не определилась (мир пересобирается) — подождать
    if (!room) return;
    this.room = room;
    const inst = this.instOf(d.run, room);
    if (!inst || !isAbyss(inst.roomTags)) {
      this.setVeil(0);
      this.entered = null;
      this.feetPrev = NaN;
      return;
    }
    const v = this.host.viewer;
    const feet = v.fps.position.y - v.posture.eye;
    const z0 = inst.z ?? 0, rise = riseOf(inst);
    const rising = Number.isFinite(this.feetPrev) && feet > this.feetPrev + 1e-3;
    this.feetPrev = feet;
    // вошли — вуаль не трогать (INTEGRATE): между onEnter и overlay слоя (рендер React) прогулка ещё «живая» несколько
    // кадров, и вуаль снова вставала в 1 — чёрный div поверх всей станции (QA qa-fr-chain п. 3)
    if (this.entered === inst.id) {
      if (rise > 0 && (feet - z0) / rise > ABYSS.veilFrom) this.entered = null;
      return;
    }
    this.setVeil(abyssVeil(feet, z0, rise));
    if (!rising && abyssEnter(feet, z0, rise)) {
      this.entered = inst.id;
      // вуаль — только на спуске: слой станции рисует в тот же канвас под ней
      this.veil = 0;
      this.host.onVeil(0);
      this.host.onEnter(inst.id);
    }
  }

  /** QA (DEV): window.__rfAbyss. */
  qa() {
    return {
      state: () => ({ room: this.room, veil: this.veil, entered: this.entered }),
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.obs) this.host.viewer.scene.onBeforeRenderObservable.remove(this.obs);
    if (this.veil) this.host.onVeil(0);
    this.veil = 0;
  }
}
