// Эффекты предметов «Прогулки» в кадре (src/view3d/inventory.ts): «лежит» — обморок юзграма и пьяное падение (камера
// валится на пол и лежит, пелена), голос игрока — стон, пока лежит пьяным, и злой рык, когда пьяный ругается на тварь.
//  • Лежит (DownCam): камера падает на бок к полу за DOWN_FALL_S, лежит, встаёт за DOWN_RISE_S до конца таймера.
//    Сдвиг (глаз вниз, крен, наклон) — ТОЛЬКО на время рисования кадра, как качание бега (src/view3d/sprint.ts): ставится
//    после всех onBeforeRender и снимается в onAfterRender — поза, физика, общага, снег видят чистую камеру, и после
//    подъёма она ровно та же. Взгляд держится (поворот мышью на время лежания отменяется каждый кадр), ход — 0
//    (Sprint.extraMul = 0 у контроллера рук), posture.frozen — пока лежит (если его не держит кто-то другой).
//  • Пелена — downPose: обморок — почти чёрная с размытием, пьяное падение — мутная полутень (HUD рисует по black/blur).
//  • Голос (VoiceAudio) — WebAudio-синтез без файлов, контекст по жесту; '0' в BREATH_SOUND_KEY — молчит (как дыхание).
import type { Scene } from '@babylonjs/core/scene';
import type { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import type { Observer } from '@babylonjs/core/Misc/observable';
import { BREATH_SOUND_KEY } from './sprint';

/** Падение на пол и подъём, с. */
export const DOWN_FALL_S = 0.7;
export const DOWN_RISE_S = 1.3;
/** Глаз лёжа над ногами, м. */
export const DOWN_EYE = 0.2;
/** Крен лёжа (на боку), рад. */
const DOWN_ROLL = 1.3;

/** Отчего лежит: обморок (юзграм) или пьяное падение (второй пузырь). */
export type DownKind = 'faint' | 'collapse';

/** Поза «лежит» в момент t: drop — доля пути глаза к полу 0…1, roll / pitch — добавочные крен и наклон, рад; пелена —
 *  чернота 0…1 и размытие, px. */
export interface DownPose {
  drop: number;
  roll: number;
  pitch: number;
  black: number;
  blur: number;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Поза лежащего: t — с начала падения, left — сколько ещё лежать (подъём — последние DOWN_RISE_S), side — на какой бок. */
export function downPose(t: number, left: number, kind: DownKind, side: 1 | -1): DownPose {
  const fall = smooth(clamp01(t / DOWN_FALL_S));
  const rise = smooth(clamp01(left / DOWN_RISE_S));
  const k = Math.min(fall, rise);
  // удар о пол: короткий отскок крена после падения
  const land = t > DOWN_FALL_S ? Math.exp(-(t - DOWN_FALL_S) * 6) * Math.sin((t - DOWN_FALL_S) * 22) * 0.06 : 0;
  // пьяный — мир плывёт
  const sway = kind === 'collapse' ? 0.05 * Math.sin(t * 1.3) + 0.025 * Math.sin(t * 2.9 + 1) : 0;
  const roll = side * (DOWN_ROLL * k + land * k) + sway * k;
  const pitch = -0.18 * k + (kind === 'collapse' ? 0.04 * Math.sin(t * 0.9) * k : 0);
  if (kind === 'faint') {
    // темнеет после удара, светлеет к подъёму
    const dark = smooth(clamp01((t - 0.25) / 1.1)) * smooth(clamp01((left - 0.2) / 1.6));
    return { drop: k, roll, pitch, black: 0.93 * dark, blur: 7 * Math.max(dark, 0.6 * k) };
  }
  return { drop: k, roll, pitch, black: 0.38 * k, blur: (2.5 + 1.5 * Math.sin(t * 1.7)) * k };
}

/** Камера лежащего (см. шапку): start → step каждый кадр (left — сколько ещё лежать) → сама заканчивается на left ≤ 0. */
export class DownCam {
  private on: { kind: DownKind; t: number; side: 1 | -1; yaw: number; pitch: number } | null = null;
  private pose: DownPose | null = null;
  /** поставленное на время кадра — снять в onAfterRender */
  private applied: { y: number; rz: number; rx: number } | null = null;
  /** frozen позы поставили мы (снять при подъёме) */
  private froze = false;
  private obs: Observer<Scene>[] = [];

  constructor(
    private readonly scene: Scene,
    private readonly cam: UniversalCamera,
    private readonly posture: { eye: number; frozen: boolean },
  ) {
    this.obs.push(scene.onBeforeRenderTargetsRenderObservable.add(() => this.view()));
    this.obs.push(scene.onAfterRenderObservable.add(() => this.unview()));
  }

  get active(): boolean {
    return this.on !== null;
  }

  get kind(): DownKind | null {
    return this.on?.kind ?? null;
  }

  /** Поза этого кадра (для пелены HUD); не лежит — null. */
  get now(): DownPose | null {
    return this.pose;
  }

  /** Упал: взгляд запоминается (держится, пока лежит). Уже лежит — только вид (обморок главнее). */
  start(kind: DownKind) {
    if (this.on) {
      if (kind === 'faint') this.on.kind = kind;
      return;
    }
    const c = this.cam;
    this.on = { kind, t: 0, side: Math.random() < 0.5 ? -1 : 1, yaw: c.rotation.y, pitch: c.rotation.x };
    // ход — сразу (поза и бег подхватят только через кадр-два)
    c.speed = 0;
    c.cameraDirection.setAll(0);
    if (!this.posture.frozen) {
      this.posture.frozen = true;
      this.froze = true;
    }
  }

  /** Кадр: dt, сколько ещё лежать. Держит взгляд и ход; left ≤ 0 — встал (взгляд — тот, что был до падения). */
  step(dt: number, left: number): DownPose | null {
    const o = this.on;
    if (!o) return null;
    const c = this.cam;
    c.rotation.y = o.yaw;
    c.rotation.x = o.pitch;
    c.cameraRotation.set(0, 0);
    c.cameraDirection.setAll(0);
    // Babylon 8+: инерция поворота и хода живёт в camera.movement — её тоже погасить (иначе после подъёма доворот)
    const m = (c as unknown as { movement?: { resetRotationVelocity?(): void; resetPanVelocity?(): void } }).movement;
    m?.resetRotationVelocity?.();
    m?.resetPanVelocity?.();
    if (left <= 0) {
      this.stop();
      return null;
    }
    o.t += Math.max(0, Math.min(0.1, dt));
    c.speed = 0;
    if (!this.posture.frozen) {
      this.posture.frozen = true;
      this.froze = true;
    }
    this.pose = downPose(o.t, left, o.kind, o.side);
    return this.pose;
  }

  /** Встать сразу (облёт, конец эффекта). */
  stop() {
    this.on = null;
    this.pose = null;
    if (this.froze) {
      this.posture.frozen = false;
      this.froze = false;
    }
  }

  /** Перед матрицами кадра: глаз к полу, крен, наклон — только на время рисования. */
  private view() {
    this.unview();
    const p = this.pose;
    if (!p || this.scene.activeCamera !== this.cam) return;
    const y = -p.drop * Math.max(0, this.posture.eye - DOWN_EYE);
    this.cam.position.y += y;
    this.cam.rotation.z += p.roll;
    this.cam.rotation.x += p.pitch;
    this.applied = { y, rz: p.roll, rx: p.pitch };
  }

  private unview() {
    const a = this.applied;
    if (!a) return;
    this.applied = null;
    this.cam.position.y -= a.y;
    this.cam.rotation.z -= a.rz;
    this.cam.rotation.x -= a.rx;
  }

  dispose() {
    this.unview();
    this.stop();
    for (const o of this.obs) o.remove();
    this.obs = [];
  }
}

/** Голос игрока: стон (пьяное падение) и злой рык (ругань). Процедурно: пила через две форманты гласной + шум дыхания. */
export class VoiceAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private disposed = false;

  private enabled(): boolean {
    try {
      return typeof localStorage === 'undefined' || localStorage.getItem(BREATH_SOUND_KEY) !== '0';
    } catch {
      return true;
    }
  }

  private ensure(): AudioContext | null {
    if (this.disposed || !this.enabled() || typeof window === 'undefined') return null;
    if (!this.ctx) {
      const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
      const AC = w.AudioContext ?? w.webkitAudioContext;
      if (!AC) return null;
      try {
        const ctx = (this.ctx = new AC());
        this.master = ctx.createGain();
        this.master.gain.value = 0.55;
        this.master.connect(ctx.destination);
        const n = Math.floor(ctx.sampleRate * 1.2);
        const b = (this.noise = ctx.createBuffer(1, n, ctx.sampleRate));
        const d = b.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      } catch {
        this.ctx = null;
        return null;
      }
    }
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  /** Голос: dur с, высота f0 → f1 Гц, форманты (Гц), пик громкости, атака (доля), дрожь (Гц). */
  private voice(dur: number, f0: number, f1: number, formants: readonly number[], peak: number, attack: number, vib: number) {
    const ctx = this.ensure();
    if (!ctx || ctx.state !== 'running' || !this.master) return;
    const t = ctx.currentTime + 0.01;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = vib;
    const lg = ctx.createGain();
    lg.gain.value = f0 * 0.025;
    lfo.connect(lg).connect(osc.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + dur * attack);
    g.gain.setValueAtTime(peak, t + dur * Math.max(attack, 0.55));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(this.master);
    for (const f of formants) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f * (0.95 + Math.random() * 0.1);
      bp.Q.value = 6;
      osc.connect(bp).connect(g);
    }
    // выдох сквозь голос
    if (this.noise) {
      const s = ctx.createBufferSource();
      s.buffer = this.noise;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1200;
      bp.Q.value = 0.8;
      const ng = ctx.createGain();
      ng.gain.value = 0.25;
      s.connect(bp).connect(ng).connect(g);
      s.start(t, Math.random() * 0.1);
      s.stop(t + dur + 0.05);
    }
    osc.start(t);
    lfo.start(t);
    osc.stop(t + dur + 0.05);
    lfo.stop(t + dur + 0.05);
  }

  /** Стон «о-ох» (~1.3 с), высота чуть разная. */
  groan() {
    const f = 120 + Math.random() * 30;
    this.voice(1.1 + Math.random() * 0.5, f, f * 0.72, [450, 780], 0.5, 0.25, 4.5);
  }

  /** Короткий злой рык (ругань). */
  grunt() {
    const f = 170 + Math.random() * 30;
    this.voice(0.32, f, f * 0.7, [700, 1220], 0.7, 0.12, 9);
  }

  dispose() {
    this.disposed = true;
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}
