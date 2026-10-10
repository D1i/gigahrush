// Бег (Shift) от первого лица — «Прогулка» (View3DPage включает только там: sprint.enabled). Спец-локации (лифт,
// лестница, ангар, болото) бегают сами — пока их сцена поверх, бег молчит (live()).
//  • Бег — Shift + вперёд (W / ↑), стоя, не заморожен, и игрок реально идёт (сдвиг камеры за кадр). Выносливость —
//    src/game/stamina.ts (чистая логика): тает на бегу, выдохся — бега нет, пока не отдышится.
//  • Скорость ×RUN_MUL, разгон и сброс плавно (~0.25 с) — через Posture.speedMul (поза пишет cam.speed каждый кадр).
//    Предметы (src/view3d/inventory.ts) множат её на extraMul: еда-бафф, сумка-мешок; лежит (обморок) — 0, бега нет.
//    Еда — refill() (стамина до полной), «Жучок» — spend(v) (качать — тратит стамину).
//  • Видно: шире угол обзора (+8%), на бегу — качание головы (вверх-вниз по шагу и лёгкий крен); выдохся — грудь
//    ходит в такт тяжёлому дыханию (и слышно: WebAudio-шум, своя кнопка-ключ BREATH_SOUND_KEY).
//    Угол, качание и крен — ТОЛЬКО на время рисования кадра: ставятся после всех onBeforeRender (поза, общага,
//    снег — видят чистые значения) и снимаются сдвигом назад в onAfterRender. Ни физика, ни глаз позы, ни захват
//    угла обзора рукой общаги (obshagaWalk: drag.fov) их не видят.
// Babylon: камера (ввод, ход, коллизии) обновляется ДО onBeforeRenderObservable — cam.speed из кадра N работает в N+1;
// матрицы вида/проекции — после onBeforeRenderTargetsRenderObservable.
import type { Scene } from '@babylonjs/core/scene';
import type { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { Posture } from './posture';
import { newStamina, stepStamina, STAMINA, STAMINA_MAX_DT, type Stamina } from '../game/stamina';

/** Во сколько раз быстрее бегом. */
export const RUN_MUL = 1.7;
/** Разгон / сброс, с. */
const EASE_T = 0.25;
/** Шире угол обзора на бегу, доля. */
const FOV_KICK = 0.08;
/** Качание головы на бегу: вверх-вниз, м; крен, рад; путь за цикл (два шага), м. */
const BOB_Y = 0.035;
const BOB_ROLL = 0.008;
const STRIDE = 1.5;
/** «Идёт» — быстрее, м/с (шаг стоя ≈ 1.7 м/с). */
const MOVE_MIN = 0.4;
/** Сдвиг за кадр больше — перенос (шов, телепорт), не ход. */
const TELEPORT = 1.5;
/** Выдохся: грудь ходит, м. */
const PANT_Y = 0.008;

/** Ключ localStorage: '0' — дыхание без звука. */
export const BREATH_SOUND_KEY = 'room-forge/breath-sound';

export interface SprintState {
  /** выносливость 0…1 */
  v: number;
  sprinting: boolean;
  exhausted: boolean;
  /** множитель скорости сейчас (1…RUN_MUL, плавно) */
  mul: number;
}

const FWD = new Set(['KeyW', 'ArrowUp']);
const isShift = (e: KeyboardEvent) => e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.key === 'Shift';
const isFwd = (e: KeyboardEvent) => FWD.has(e.code) || e.keyCode === 87 || e.keyCode === 38;
const typing = (e: Event) => {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
};
const smooth = (k: number) => k * k * (3 - 2 * k);

export class Sprint {
  /** бег разрешён (View3DPage: только «Прогулка») */
  enabled = true;
  /** множитель скорости от предметов (Inventory: эффекты еды × сумка; 0 — лежит: ни хода, ни бега) — к posture.speedMul */
  extraMul = 1;
  private readonly st: SprintState = { v: 1, sprinting: false, exhausted: false, mul: 1 };
  private sta: Stamina = newStamina();
  private shift = false;
  private fwd = new Set<string>();
  /** разгон 0…1 (линейно; в дело — smooth(k)) */
  private k = 0;
  private speedS = 0;
  private lastX: number | null = null;
  private lastZ = 0;
  private phase = 0;
  /** выдохся: сила (0…1) и фаза дыхания */
  private pant = 0;
  private pantPhase = 0.98;
  /** поставленное на время кадра — снять в onAfterRender */
  private applied: { fov: number; y: number; rz: number } | null = null;
  private obs: Observer<Scene>[] = [];
  private audio = new BreathAudio();

  constructor(
    private readonly scene: Scene,
    private readonly cam: UniversalCamera,
    private readonly posture: Posture,
    /** бег действует (от первого лица, без своей сцены поверх) */
    private readonly live: () => boolean,
  ) {
    this.obs.push(scene.onBeforeRenderObservable.add(() => this.frame()));
    this.obs.push(scene.onBeforeRenderTargetsRenderObservable.add(() => this.view()));
    this.obs.push(scene.onAfterRenderObservable.add(() => this.unview()));
    window.addEventListener('keydown', this.onDown);
    window.addEventListener('keyup', this.onUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('pointerlockchange', this.onLock);
  }

  /** Снимок кадра (только чтение; объект один и тот же). */
  get state(): Readonly<SprintState> {
    return this.st;
  }

  /** Стамина до полной (еда): выдохся — больше нет. */
  refill() {
    this.sta = { ...this.sta, v: 1, exhausted: false };
    this.st.v = 1;
    this.st.exhausted = false;
  }

  /** Потратить v стамины (доля шкалы; «Жучок» — качать): до нуля — выдохся; восстановление — заново после паузы. */
  spend(v: number) {
    if (!(v > 0) || !Number.isFinite(v)) return;
    const left = Math.max(0, this.sta.v - v);
    this.sta = { ...this.sta, v: left, exhausted: this.sta.exhausted || left <= 0, rest: 0 };
    this.st.v = left;
    this.st.exhausted = this.sta.exhausted;
  }

  /** Звук дыхания (localStorage BREATH_SOUND_KEY). */
  get sound(): boolean {
    return this.audio.enabled;
  }
  setSound(on: boolean) {
    this.audio.setEnabled(on);
  }

  private onDown = (e: KeyboardEvent) => {
    if (typing(e)) return;
    if (isShift(e)) {
      if (e.repeat) return;
      this.shift = true;
      // жест пользователя: звук дыхания можно завести (политика автоплея)
      if (this.live() && this.enabled) this.audio.start();
      return;
    }
    if (isFwd(e)) this.fwd.add(e.code);
    // Shift зажали, пока фокус был в поле ввода / вне окна, или потеряли его отпускание — верим модификатору
    this.shift = e.shiftKey;
  };

  private onUp = (e: KeyboardEvent) => {
    if (isShift(e) || !e.shiftKey) this.shift = false;
    if (isFwd(e)) this.fwd.delete(e.code);
  };

  private onBlur = () => {
    this.shift = false;
    this.fwd.clear();
  };

  private onLock = () => {
    if (!document.pointerLockElement) this.shift = false;
  };

  private frame() {
    const live = this.live();
    // шаг — как у выносливости: медленный кадр (~4 кадра/с) — целиком, зависшая вкладка — не больше STAMINA_MAX_DT
    const dt = Math.min(STAMINA_MAX_DT, this.scene.getEngine().getDeltaTime() / 1000 || 1 / 60);
    // ход: сдвиг по горизонтали за кадр (переносы — не ход)
    const c = this.cam.position;
    let step = 0;
    if (live && this.lastX !== null) {
      const d = Math.hypot(c.x - this.lastX, c.z - this.lastZ);
      if (d < TELEPORT) step = d;
    }
    this.lastX = live ? c.x : null;
    this.lastZ = c.z;
    this.speedS += (step / dt - this.speedS) * Math.min(1, dt * 15);
    const moving = live && this.speedS > MOVE_MIN;
    const extra = Number.isFinite(this.extraMul) ? Math.max(0, this.extraMul) : 1;
    const canRun = live && this.enabled && this.posture.pose === 'stand' && !this.posture.frozen && !this.posture.rising && !this.posture.side && extra > 0; // side — боком в щели погреба; extra 0 — лежит
    this.sta = stepStamina(this.sta, dt, { want: this.shift && this.fwd.size > 0, moving, canRun });
    // разгон / сброс; позу сменили или заморозили — сброс втрое быстрее
    const rate = (dt / EASE_T) * (canRun ? 1 : 3);
    this.k = this.sta.sprinting ? Math.min(1, this.k + rate) : Math.max(0, this.k - rate);
    const e = smooth(this.k);
    const mul = 1 + (RUN_MUL - 1) * e;
    this.posture.speedMul = live ? mul * extra : 1;
    this.phase += (step / STRIDE) * Math.PI * 2;
    // выдохся — тяжёлое дыхание, слабеет к recoverAt; на излёте бега — тише
    const s = this.sta;
    const pantWant = s.exhausted ? 1 - 0.6 * Math.min(1, s.v / STAMINA.recoverAt) : s.sprinting && s.v < 0.3 ? 0.35 * (1 - s.v / 0.3) : 0;
    // отдышался — дыхание стихает не сразу (~3 с); облёт — сразу
    this.pant = live ? this.pant + (pantWant - this.pant) * Math.min(1, dt * (pantWant > this.pant ? 6 : 0.8)) : 0;
    if (this.pant > 0.02) {
      const period = 1.3 - 0.45 * this.pant;
      const before = this.pantPhase;
      this.pantPhase = (this.pantPhase + dt / period) % 1;
      if (this.pantPhase < before) this.audio.breath(this.pant, period);
    } else this.pantPhase = 0.98; // первый вдох — сразу, как выдохся
    this.st.v = s.v;
    this.st.sprinting = s.sprinting;
    this.st.exhausted = s.exhausted;
    this.st.mul = live ? mul : 1;
  }

  /** Перед матрицами кадра: шире угол, качание головы, крен — только на время рисования. */
  private view() {
    this.unview(); // прошлый кадр не дошёл до onAfterRender (исключение в рендере) — не копить
    if (!this.live() || this.scene.activeCamera !== this.cam) return;
    const e = smooth(this.k);
    const dy = e * BOB_Y * (Math.abs(Math.sin(this.phase)) - 0.5) + this.pant * PANT_Y * Math.sin(this.pantPhase * Math.PI * 2);
    const rz = e * BOB_ROLL * Math.sin(this.phase);
    const df = this.cam.fov * FOV_KICK * e;
    if (!dy && !rz && !df) return;
    this.cam.fov += df;
    this.cam.position.y += dy;
    this.cam.rotation.z += rz;
    this.applied = { fov: df, y: dy, rz };
  }

  /** После кадра — снять ровно то, что добавили (шов портала сдвигает камеру в кадре — сдвиг остаётся). */
  private unview() {
    const a = this.applied;
    if (!a) return;
    this.applied = null;
    this.cam.fov -= a.fov;
    this.cam.position.y -= a.y;
    this.cam.rotation.z -= a.rz;
  }

  dispose() {
    this.unview();
    for (const o of this.obs) o.remove();
    this.obs = [];
    window.removeEventListener('keydown', this.onDown);
    window.removeEventListener('keyup', this.onUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('pointerlockchange', this.onLock);
    this.audio.dispose();
  }
}

/** Тяжёлое дыхание (выдохся): шумовые вдох-выдох у самого уха, процедурно, без файлов. Контекст — по жесту (Shift). */
class BreathAudio {
  enabled: boolean;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private disposed = false;

  constructor() {
    let on = true;
    try {
      on = localStorage.getItem(BREATH_SOUND_KEY) !== '0';
    } catch {}
    this.enabled = on;
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    try {
      localStorage.setItem(BREATH_SOUND_KEY, on ? '1' : '0');
    } catch {}
  }

  start() {
    if (this.disposed || !this.enabled) return;
    if (!this.ctx) {
      const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
      const AC = w.AudioContext ?? w.webkitAudioContext;
      if (!AC) return;
      try {
        const ctx = (this.ctx = new AC());
        this.master = ctx.createGain();
        this.master.gain.value = 0.7;
        this.master.connect(ctx.destination);
        const n = Math.floor(ctx.sampleRate * 1.5);
        const b = (this.noise = ctx.createBuffer(1, n, ctx.sampleRate));
        const d = b.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      } catch {
        this.ctx = null;
        return;
      }
    }
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
  }

  /** Вдох (выше, с присвистом) и выдох (ниже, громче); k — сила 0…1, period — длина цикла, с. */
  breath(k: number, period: number) {
    const ctx = this.ctx;
    if (!ctx || !this.enabled || this.disposed || ctx.state !== 'running') return;
    const t = ctx.currentTime + 0.01;
    this.puff(t, 0.36 * period, 1150, 1700, 1.3, 0.22 * k, 0.4);
    this.puff(t + 0.42 * period, 0.5 * period, 900, 480, 0.8, 0.34 * k, 0.12);
  }

  private puff(t: number, dur: number, f0: number, f1: number, q: number, peak: number, attack: number) {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    s.playbackRate.value = 0.9 + Math.random() * 0.2;
    const flt = ctx.createBiquadFilter();
    flt.type = 'bandpass';
    flt.Q.value = q;
    flt.frequency.setValueAtTime(f0, t);
    flt.frequency.linearRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + dur * attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(flt).connect(g).connect(this.master!);
    s.start(t, Math.random() * Math.max(0, 1.5 - dur - 0.05));
    s.stop(t + dur + 0.05);
  }

  dispose() {
    this.disposed = true;
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}
