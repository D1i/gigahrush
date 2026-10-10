// Звук «Фрактальной станции» (./sceneFractal.ts) — процедурный WebAudio, без файлов (как metroAudio / hangarAudio).
//  • Метро как оно есть — src/view3d/metroAudio.ts (MetroAudio): гул ламп, далёкий поезд и «поршень», гул и перестук
//    эскалатора у ближайшей дорожки, звуки срыва (рывок, хлопок цепи, обрыв). Её слушатель — Y-up с yaw, поэтому все точки
//    ей — в КАДРЕ ИГРОКА (x — вправо, y — вверх, z — вперёд от глаза), слушатель — в нуле с yaw 0: панорама верна при
//    любой гравитации. Свои шаги метро не играет (moving: false) — шаги здесь, с эхом.
//  • Своё (свой AudioContext): эхо шагов — сухой щелчок по граниту, свёртка (процедурный отклик 3.5 с) и линия задержки
//    2·d/343 (d — до стены впереди по взгляду, 0.08…0.4 с) с обратной связью 0.35 через ФНЧ 2 кГц — «шаги копий»;
//    поворот гравитации — низкий «вжух» и каменный скрежет; удар о пол — глухой, по силе, при сильном — звон в ушах;
//    ветер из открытой ниши ближайшей выходной копии (точка в кадре игрока); свист падения; фон — низкий гул пустоты.
//
// AudioContext — только по жесту (start() из клика / клавиши). Пауза страницы глушит все контексты сама
// (src/view3d/pauseAudio.ts).
import { MetroAudio, METRO_SOUND_KEY } from '../view3d/metroAudio';

/** Точка в кадре игрока: x — вправо, y — вверх, z — вперёд (м от глаза). */
export interface FrAudioPt {
  x: number;
  y: number;
  z: number;
}

export interface FractalAudioFrame {
  /** скорость по плоскости пола, м/с */
  speed: number;
  ground: 'floor' | 'ramp' | 'air';
  /** скорость падения вдоль −up, м/с (свист) */
  fallV: number;
  /** до твёрдого впереди по взгляду, м (null — дальше предела): задержка эха шагов */
  echoM: number | null;
  /** ближайшая работающая дорожка и громкость 0…1 */
  esc: (FrAudioPt & { k: number }) | null;
  /** игрок на ленте */
  onBelt: boolean;
  /** срыв рядом: точка и |скорость| ленты */
  runaway: (FrAudioPt & { v: number }) | null;
  /** ниша ближайшей выходной копии: точка; null — далеко */
  wind: FrAudioPt | null;
}

export interface FractalAudioCounters {
  step: number;
  land: number;
  turn: number;
  ring: number;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const fin = (v: number, d = 0) => (Number.isFinite(v) ? v : d);

// ───────────────────────── чистые функции ─────────────────────────

/** Задержка эха шагов, с: туда и обратно до стены d м (звук 343 м/с); нет стены — самая длинная. */
export function echoDelay(d: number | null): number {
  if (d === null || !Number.isFinite(d)) return 0.4;
  return clamp((2 * d) / 343, 0.08, 0.4);
}

/** Громкость ветра из ниши по расстоянию, 0…1: слышно с ~90 м, у самой ниши — полная. */
export function windGain(d: number): number {
  if (!Number.isFinite(d)) return 0;
  return clamp(1 - d / 90, 0, 1) ** 1.6;
}

export class FractalAudio {
  ctx: AudioContext | null = null;
  readonly metro = new MetroAudio();
  readonly counters: FractalAudioCounters = { step: 0, land: 0, turn: 0, ring: 0 };
  private _enabled: boolean;
  private master!: GainNode;
  private sfx!: GainNode;
  private wet!: GainNode;
  private echoIn!: GainNode;
  private delay!: DelayNode;
  private noise!: AudioBuffer;
  private brown!: AudioBuffer;
  private windG: GainNode | null = null;
  private windPn: PannerNode | null = null;
  private airG: GainNode | null = null;
  private airF: BiquadFilterNode | null = null;
  private droneG: GainNode | null = null;
  private foot = 0;
  private disposed = false;

  constructor(enabled = true) {
    this._enabled = enabled;
  }

  get enabled(): boolean {
    return this._enabled;
  }

  get running(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Запуск по жесту. Повторный вызов — resume. */
  start(): void {
    if (this.disposed) return;
    // звук метро выключали в метро — тут он часть локации (вкл/выкл — общий ключ сцены): включить, ключ не трогать
    if (!this.metro.enabled) {
      let prev: string | null = null;
      try {
        prev = localStorage.getItem(METRO_SOUND_KEY);
      } catch {}
      this.metro.setEnabled(true);
      try {
        if (prev === null) localStorage.removeItem(METRO_SOUND_KEY);
        else localStorage.setItem(METRO_SOUND_KEY, prev);
      } catch {}
    }
    this.metro.start();
    if (!this.ctx) {
      const w = (typeof window === 'undefined' ? undefined : window) as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext } | undefined;
      const AC = w?.AudioContext ?? w?.webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC();
        this.build();
      } catch {
        this.ctx = null;
        return;
      }
    }
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
  }

  setEnabled(on: boolean): void {
    this._enabled = on;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(on ? 0.75 : 0, t, 0.08);
  }

  private on(): boolean {
    return !!this.ctx && !this.disposed && this._enabled && this.ctx.state === 'running';
  }

  private build() {
    const ctx = this.ctx!;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    comp.attack.value = 0.002;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = this._enabled ? 0.75 : 0;
    this.master.connect(comp);
    this.noise = noiseBuffer(ctx, 4, false);
    this.brown = noiseBuffer(ctx, 5, true);
    // огромный каменный объём: отклик 3.5 с
    const conv = ctx.createConvolver();
    conv.buffer = voidImpulse(ctx, 3.5);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.6;
    this.wet.connect(conv);
    conv.connect(this.master);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    // «шаги копий»: задержка с обратной связью через ФНЧ 2 кГц
    this.echoIn = ctx.createGain();
    this.echoIn.gain.value = 0.55;
    this.delay = ctx.createDelay(1);
    this.delay.delayTime.value = 0.3;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2000;
    const fb = ctx.createGain();
    fb.gain.value = 0.35;
    this.echoIn.connect(this.delay);
    this.delay.connect(lp);
    lp.connect(fb).connect(this.delay);
    lp.connect(this.master);
    const lw = ctx.createGain();
    lw.gain.value = 0.4;
    lp.connect(lw).connect(this.wet);
    // фон: гул пустоты — два низких тона с биением и бурый шум
    const drone = (this.droneG = ctx.createGain());
    drone.gain.value = 0;
    const dl = ctx.createBiquadFilter();
    dl.type = 'lowpass';
    dl.frequency.value = 140;
    for (const [f, g] of [[37, 0.5], [41.3, 0.4], [55.5, 0.15]] as const) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = g;
      o.connect(og).connect(dl);
      o.start();
    }
    this.loop(this.brown, 'lowpass', 110, 0.6, 0.9).connect(dl);
    dl.connect(drone).connect(this.master);
    const dw = ctx.createGain();
    dw.gain.value = 0.3;
    drone.connect(dw).connect(this.wet);
    // ветер из ниши выхода: бурый шум, точка — в нише
    const wind = (this.windG = ctx.createGain());
    wind.gain.value = 0;
    this.windPn = this.panner({ x: 0, y: 0, z: 10 }, 6, 0.8);
    this.loop(this.brown, 'lowpass', 700, 0.5, 1.2).connect(wind);
    this.loop(this.noise, 'bandpass', 900, 0.8, 0.12).connect(wind);
    wind.connect(this.windPn).connect(this.master);
    const ww = ctx.createGain();
    ww.gain.value = 0.5;
    this.windPn.connect(ww).connect(this.wet);
    // свист падения: шум, полоса растёт со скоростью
    const air = (this.airG = ctx.createGain());
    air.gain.value = 0;
    const af = (this.airF = ctx.createBiquadFilter());
    af.type = 'bandpass';
    af.frequency.value = 500;
    af.Q.value = 0.7;
    this.loop(this.noise, 'highpass', 200, 0.5, 0.6).connect(af);
    af.connect(air).connect(this.master);
  }

  private loop(buf: AudioBuffer, type: BiquadFilterType, f: number, q: number, gain: number): GainNode {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    const flt = ctx.createBiquadFilter();
    flt.type = type;
    flt.frequency.value = f;
    flt.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = gain;
    s.connect(flt).connect(g);
    s.start(0, Math.random() * 0.5);
    return g;
  }

  private panner(p: FrAudioPt, ref = 1.5, rolloff = 1.2): PannerNode {
    const pn = this.ctx!.createPanner();
    pn.panningModel = 'HRTF';
    pn.distanceModel = 'inverse';
    pn.refDistance = ref;
    pn.rolloffFactor = rolloff;
    pn.maxDistance = 300;
    setPos(pn, p);
    return pn;
  }

  private burst(buf: AudioBuffer, dur: number, type: BiquadFilterType, f: number, q: number, peak: number, dest: AudioNode, at = 0, attack = 0.005, f1?: number) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + at;
    const s = ctx.createBufferSource();
    s.buffer = buf;
    const flt = ctx.createBiquadFilter();
    flt.type = type;
    flt.frequency.setValueAtTime(f, t);
    if (f1 !== undefined) flt.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    flt.Q.value = q;
    const g = ctx.createGain();
    const a = Math.min(attack, dur * 0.5);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(flt).connect(g).connect(dest);
    s.start(t, Math.random() * Math.max(0, buf.duration - dur - 0.05));
    s.stop(t + dur + 0.05);
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, peak: number, dest: AudioNode, at = 0, attack = 0.01) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain();
    const a = Math.min(attack, dur * 0.5);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // ───────────────────────── кадр ─────────────────────────

  update(dt: number, f: FractalAudioFrame): void {
    dt = clamp(fin(dt, 0.016), 0, 0.25);
    // метро: точки уже в кадре игрока, слушатель — в нуле
    this.metro.update(dt, {
      inBiome: this._enabled,
      moving: false,
      speed: 0,
      esc: f.esc,
      onBelt: f.onBelt,
      runaway: f.runaway,
      listener: { x: 0, y: 0, z: 0, yaw: 0 },
      dead: false,
    });
    if (!this.ctx || this.disposed || !this.running) return;
    const t = this.ctx.currentTime;
    this.delay.delayTime.setTargetAtTime(echoDelay(f.echoM), t, 0.15);
    this.droneG!.gain.setTargetAtTime(0.16, t, 1.5);
    const w = f.wind;
    if (w) setPosT(this.windPn!, w, t);
    this.windG!.gain.setTargetAtTime(w ? 0.5 * windGain(Math.hypot(w.x, w.y, w.z)) : 0, t, 0.6);
    const fv = f.ground === 'air' ? Math.abs(fin(f.fallV)) : 0;
    this.airG!.gain.setTargetAtTime(Math.min(0.5, Math.max(0, fv - 3) * 0.03), t, 0.1);
    this.airF!.frequency.setTargetAtTime(400 + fv * 90, t, 0.1);
  }

  /** Шаг (событие физики): гранит, гулко, с эхом. На ленте — рифлёный металл. */
  step(metal = false, loud = 1): void {
    if (!this.on()) return;
    this.counters.step++;
    this.foot ^= 1;
    const pn = this.panner({ x: this.foot ? 0.12 : -0.12, y: -1.5, z: 0.1 }, 1, 1);
    pn.connect(this.sfx);
    const w = this.ctx!.createGain();
    w.gain.value = 0.7;
    pn.connect(w).connect(this.wet);
    pn.connect(this.echoIn);
    loud = clamp(loud, 0.3, 1.3);
    this.burst(this.noise, 0.05, 'bandpass', metal ? 2600 : rnd(1550, 1850), 1.6, 0.17 * loud, pn, 0, 0.002);
    this.burst(this.brown, 0.09, 'lowpass', 300, 0.7, 0.3 * loud, pn, 0.004, 0.003);
    if (metal) this.tone('triangle', 900, 820, 0.06, 0.03 * loud, pn, 0.003, 0.001);
  }

  /** Удар о пол: 1 — глухой, 2 — тяжёлый и звон в ушах. */
  land(power: 1 | 2): void {
    if (!this.on()) return;
    this.counters.land++;
    const pn = this.panner({ x: 0, y: -1.4, z: 0.2 }, 1, 1);
    pn.connect(this.sfx);
    const w = this.ctx!.createGain();
    w.gain.value = 0.9;
    pn.connect(w).connect(this.wet);
    pn.connect(this.echoIn);
    const k = power === 2 ? 1.3 : 0.75;
    this.tone('sine', 72, 30, 0.5, 0.9 * k, pn, 0, 0.003);
    this.burst(this.brown, 0.4, 'lowpass', 340, 0.7, 0.9 * k, pn, 0, 0.002);
    this.burst(this.noise, 0.12, 'bandpass', 1200, 1, 0.25 * k, pn, 0.01, 0.002);
    if (power === 2) {
      this.counters.ring++;
      // звон в ушах — посередине головы, сухо
      this.tone('sine', 3520, 3480, 3.2, 0.05, this.sfx, 0.15, 0.25);
      this.tone('sine', 5270, 5200, 2.4, 0.02, this.sfx, 0.2, 0.3);
    }
  }

  /** Поворот гравитации: низкий «вжух» (шум, полоса вверх-вниз) и каменный скрежет. */
  turn(): void {
    if (!this.on()) return;
    this.counters.turn++;
    const pn = this.panner({ x: 0, y: 0, z: 0.6 }, 1, 1);
    pn.connect(this.sfx);
    const w = this.ctx!.createGain();
    w.gain.value = 0.8;
    pn.connect(w).connect(this.wet);
    this.burst(this.brown, 0.6, 'lowpass', 120, 0.9, 0.9, pn, 0, 0.18, 520);
    this.burst(this.noise, 0.55, 'bandpass', 260, 1.2, 0.18, pn, 0.05, 0.2, 90);
    this.tone('sine', 55, 32, 0.6, 0.35, pn, 0, 0.12);
    // скрежет камня: короткие шершавые всплески
    for (let k = 0; k < 6; k++) this.burst(this.noise, rnd(0.04, 0.09), 'bandpass', rnd(500, 1300), 3, rnd(0.04, 0.09), pn, 0.12 + k * rnd(0.04, 0.07), 0.004);
  }

  /** Срыв эскалатора (точка — в кадре игрока): переадресовано в звук метро. */
  shudder(p: FrAudioPt): void {
    this.metro.shudder(p);
  }

  snap(p: FrAudioPt): void {
    this.metro.snap(p);
  }

  crash(p: FrAudioPt): void {
    this.metro.crash(p);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.metro.dispose();
    const c = this.ctx;
    this.ctx = null;
    if (c) c.close().catch(() => {});
  }
}

// WebAudio правосторонний: вперёд кадра (+z) — это −z слушателя по умолчанию
function setPos(pn: PannerNode, p: FrAudioPt) {
  if (pn.positionX) {
    pn.positionX.value = fin(p.x);
    pn.positionY.value = fin(p.y);
    pn.positionZ.value = -fin(p.z);
  } else (pn as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(fin(p.x), fin(p.y), -fin(p.z));
}

function setPosT(pn: PannerNode, p: FrAudioPt, t: number) {
  if (pn.positionX) {
    pn.positionX.setTargetAtTime(fin(p.x), t, 0.08);
    pn.positionY.setTargetAtTime(fin(p.y), t, 0.08);
    pn.positionZ.setTargetAtTime(-fin(p.z), t, 0.08);
  } else setPos(pn, p);
}

function noiseBuffer(ctx: AudioContext, sec: number, brown: boolean): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * sec);
  const b = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    } else d[i] = w;
  }
  return b;
}

/** Отклик пустоты: редкие далёкие отражения (плиты, станции в станциях) и длинный тёмный хвост. */
function voidImpulse(ctx: AudioContext, sec: number): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * sec);
  const b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      lp += 0.18 * ((Math.random() * 2 - 1) - lp);
      d[i] = lp * Math.pow(1 - i / n, 2) * 0.5;
    }
    // отражения через ~период ячейки (54 м туда-обратно ≈ 0.31 с) и его доли
    for (let k = 1; k < 10; k++) {
      const i = Math.floor(((31 * k + rnd(-8, 8)) / 1000 + (k > 4 ? 0.1 * (k - 4) : 0)) * ctx.sampleRate) + c * 13;
      if (i < n) d[i] += (Math.random() < 0.5 ? -1 : 1) * 0.3 * Math.pow(0.8, k);
    }
  }
  return b;
}
