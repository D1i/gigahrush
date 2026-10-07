// Звук «бесконечной лестницы» — процедурный WebAudio, без файлов.
//  • фон: гул (сеть 50 Гц и трансформатор щитка), низкий рокот дома, шорох воздуха, капель с эхом
//    подъезда, изредка — далёкий лифт за стеной;
//  • «страшный звук» — снизу, из пролёта: удар, скрежет металла по бетону и низкий стон (PannerNode
//    ниже игрока, HRTF);
//  • Хвататель после звука: тяжёлое дыхание и шарканье, всё ближе (meter 0…1 — дистанция, темп,
//    громкость), при survived — уходит вниз и стихает; захват — рёв, волочение, удар, тишина;
//  • размыкание — щелчки дросселей ламп, гул сети; двери — скрип и хлопок; шаги игрока по бетону.
// AudioContext создаётся только по жесту пользователя (политика автоплея) — start() из клика.
//
// Координаты — локальные Babylon (как у сцены), WebAudio правосторонний: z → −z.

type V3 = { x: number; y: number; z: number };

export interface AudioCounters {
  sound: number;
  approach: number;
  survived: number;
  grab: number;
  opened: number;
  door: number;
  drip: number;
  lift: number;
  step: number;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export class StairAudio {
  ctx: AudioContext | null = null;
  enabled: boolean;
  readonly counters: AudioCounters = { sound: 0, approach: 0, survived: 0, grab: 0, opened: 0, door: 0, drip: 0, lift: 0, step: 0 };
  private master!: GainNode;
  private analyser: AnalyserNode | null = null;
  private sfx!: GainNode;
  private amb!: GainNode;
  private wet!: GainNode;
  private noise!: AudioBuffer;
  private brown!: AudioBuffer;
  private listener: V3 = { x: 0, y: 1.6, z: 0 };
  private hum: GainNode | null = null;
  private dripIn = 3;
  private liftIn = 25;
  /** Хвататель: свой узел панорамы и громкость; дыхание и шаги планируются в update */
  private grabber: { pan: PannerNode; gain: GainNode; growl: GainNode; osc: OscillatorNode; breathAt: number; stepAt: number; dist: number; leaving: number } | null = null;
  private disposed = false;

  constructor(enabled = true) {
    this.enabled = enabled;
  }

  get running(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Запуск по жесту пользователя (клик). Повторный вызов — resume. */
  async start(): Promise<void> {
    if (this.disposed) return;
    if (!this.ctx) {
      const AC = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.build();
    }
    if (this.ctx.state !== 'running') {
      try {
        await this.ctx.resume();
      } catch {}
    }
  }

  /** Текущий уровень (RMS) на выходе, 0…1. */
  level(): number {
    const a = this.analyser;
    if (!a) return 0;
    const d = new Float32Array(a.fftSize);
    a.getFloatTimeDomainData(d);
    let s = 0;
    for (const v of d) s += v * v;
    return Math.sqrt(s / d.length);
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(on ? 0.75 : 0, t, 0.08);
  }

  private build() {
    const ctx = this.ctx!;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 0.75 : 0;
    this.master.connect(comp);
    // уровень на выходе — для QA (звук действительно идёт)
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    comp.connect(this.analyser);
    // эхо подъезда: свёртка с синтетическим откликом (шум с затуханием ~2.6 с, ранние отражения)
    const conv = ctx.createConvolver();
    conv.buffer = impulse(ctx, 2.6);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.55;
    this.wet.connect(conv);
    conv.connect(this.master);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.amb = ctx.createGain();
    this.amb.gain.value = 1;
    this.amb.connect(this.master);
    this.noise = noiseBuffer(ctx, 3, false);
    this.brown = noiseBuffer(ctx, 4, true);
    this.ambience();
  }

  /** Постоянный фон: гул, рокот, воздух. */
  private ambience() {
    const ctx = this.ctx!;
    const hum = (this.hum = ctx.createGain());
    hum.gain.value = 0.02;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 160;
    const o1 = ctx.createOscillator();
    o1.type = 'sawtooth';
    o1.frequency.value = 50;
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = 100.3;
    const g2 = ctx.createGain();
    g2.gain.value = 0.6;
    o1.connect(lp);
    o2.connect(g2).connect(lp);
    lp.connect(hum).connect(this.amb);
    // медленное «дыхание» гула
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.11;
    const lg = ctx.createGain();
    lg.gain.value = 0.007;
    lfo.connect(lg).connect(hum.gain);
    o1.start();
    o2.start();
    lfo.start();
    // рокот дома
    const r = this.loop(this.brown, 'lowpass', 85, 0.7, 0.11);
    r.connect(this.amb);
    // воздух
    const a = this.loop(this.noise, 'bandpass', 2600, 0.6, 0.006);
    a.connect(this.amb);
  }

  private loop(buf: AudioBuffer, type: BiquadFilterType, f: number, q: number, gain: number): GainNode {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.loopStart = Math.random() * 0.5;
    const flt = ctx.createBiquadFilter();
    flt.type = type;
    flt.frequency.value = f;
    flt.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = gain;
    s.connect(flt).connect(g);
    s.start();
    return g;
  }

  /** Источник в точке p (локальные Babylon): HRTF-панорама, громкость спадает с расстоянием. */
  private panner(p: V3, ref = 1.5, rolloff = 1.2): PannerNode {
    const ctx = this.ctx!;
    const pn = ctx.createPanner();
    pn.panningModel = 'HRTF';
    pn.distanceModel = 'inverse';
    pn.refDistance = ref;
    pn.rolloffFactor = rolloff;
    pn.maxDistance = 200;
    setPos(pn, p);
    return pn;
  }

  /** Выход эффекта: в мастер (сухой) и в эхо. */
  private out(node: AudioNode, wet = 0.6) {
    node.connect(this.sfx);
    if (wet > 0) {
      const w = this.ctx!.createGain();
      w.gain.value = wet;
      node.connect(w).connect(this.wet);
    }
  }

  private burst(buf: AudioBuffer, dur: number, type: BiquadFilterType, f: number, q: number, peak: number, dest: AudioNode, at = 0, attack = 0.005) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + at;
    const s = ctx.createBufferSource();
    s.buffer = buf;
    const flt = ctx.createBiquadFilter();
    flt.type = type;
    flt.frequency.value = f;
    flt.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(flt).connect(g).connect(dest);
    s.start(t, Math.random() * (buf.duration - dur - 0.05));
    s.stop(t + dur + 0.05);
    return { s, flt, g, t };
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, peak: number, dest: AudioNode, at = 0, attack = 0.01) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
    return { o, g, t };
  }

  // ───────────────────────── кадр ─────────────────────────

  /** Каждый кадр: слушатель (глаза, взгляд), фон, Хвататель. */
  update(dt: number, eye: V3, fwd: V3) {
    if (!this.ctx || this.disposed) return;
    this.listener = eye;
    const L = this.ctx.listener;
    const t = this.ctx.currentTime;
    if (L.positionX) {
      L.positionX.setTargetAtTime(eye.x, t, 0.02);
      L.positionY.setTargetAtTime(eye.y, t, 0.02);
      L.positionZ.setTargetAtTime(-eye.z, t, 0.02);
      L.forwardX.setTargetAtTime(fwd.x, t, 0.02);
      L.forwardY.setTargetAtTime(fwd.y, t, 0.02);
      L.forwardZ.setTargetAtTime(-fwd.z, t, 0.02);
      L.upX.value = 0;
      L.upY.value = 1;
      L.upZ.value = 0;
    } else {
      (L as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(eye.x, eye.y, -eye.z);
      (L as unknown as { setOrientation(...a: number[]): void }).setOrientation(fwd.x, fwd.y, -fwd.z, 0, 1, 0);
    }
    if (!this.running) return;
    // капель
    this.dripIn -= dt;
    if (this.dripIn <= 0) {
      this.dripIn = rnd(1.8, 6.5);
      this.drip({ x: rnd(-1.2, 1.2), y: eye.y + rnd(-7, 4), z: rnd(-2.4, 2.4) });
    }
    // далёкий лифт
    this.liftIn -= dt;
    if (this.liftIn <= 0) {
      this.liftIn = rnd(35, 80);
      this.lift({ x: -4.5, y: eye.y + rnd(-6, 6), z: rnd(-2, 2) });
    }
    this.updateGrabber(dt, eye);
  }

  private drip(p: V3) {
    this.counters.drip++;
    const pn = this.panner(p, 1, 0.9);
    this.out(pn, 0.9);
    const f = rnd(1300, 2600);
    this.tone('sine', f, f * 0.55, rnd(0.08, 0.16), 0.08, pn);
  }

  private lift(p: V3) {
    this.counters.lift++;
    const ctx = this.ctx!;
    const pn = this.panner(p, 3, 1);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 260;
    lp.connect(pn);
    this.out(pn, 1.2);
    const dur = rnd(5, 8);
    const m = this.tone('sawtooth', 52, 66, dur, 0.05, lp, 0.6, 1.2);
    m.g.gain.setValueAtTime(0.05, m.t + dur - 1.5);
    this.burst(this.noise, 0.5, 'bandpass', 1400, 9, 0.08, pn, 0);
    this.burst(this.noise, 0.6, 'bandpass', 1100, 9, 0.09, pn, dur + 0.4);
    this.tone('sine', 70, 45, 0.5, 0.12, lp, dur + 0.45);
  }

  // ───────────────────────── события механики ─────────────────────────

  /** «Страшный звук» снизу: удар, скрежет, стон. */
  scarySound() {
    if (!this.ctx) return;
    this.counters.sound++;
    const ctx = this.ctx;
    const e = this.listener;
    const pn = this.panner({ x: 0, y: e.y - 8, z: -0.3 }, 3, 0.8);
    const g = ctx.createGain();
    g.gain.value = 1.4;
    g.connect(pn);
    this.out(pn, 1.1);
    // глухой удар
    this.tone('sine', 52, 30, 1.1, 0.7, g);
    this.burst(this.brown, 0.6, 'lowpass', 300, 0.7, 0.5, g);
    // скрежет: узкая полоса шума, частота сползает с дрожью
    const sc = this.burst(this.noise, 1.9, 'bandpass', 1700, 14, 0.5, g, 0.25, 0.08);
    const curve = new Float32Array(48);
    for (let i = 0; i < curve.length; i++) curve[i] = lerp(1900, 420, i / (curve.length - 1)) * rnd(0.85, 1.15);
    sc.flt.frequency.setValueCurveAtTime(curve, sc.t, 1.8);
    // зернистость скрежета
    const tr = ctx.createOscillator();
    tr.type = 'square';
    tr.frequency.value = 27;
    const tg = ctx.createGain();
    tg.gain.value = 0.25;
    tr.connect(tg).connect(sc.g.gain);
    tr.start(sc.t);
    tr.stop(sc.t + 2);
    // стон: две пилы через «гласные» полосы, высота сползает вниз, вибрато
    const t0 = ctx.currentTime + 0.9;
    const dur = 3.2;
    const vg = ctx.createGain();
    vg.gain.setValueAtTime(0, t0);
    vg.gain.linearRampToValueAtTime(0.42, t0 + 0.7);
    vg.gain.setValueAtTime(0.42, t0 + dur - 1.2);
    vg.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.Q.value = 5;
    f1.frequency.setValueAtTime(420, t0);
    f1.frequency.linearRampToValueAtTime(300, t0 + dur);
    const f2 = ctx.createBiquadFilter();
    f2.type = 'bandpass';
    f2.Q.value = 6;
    f2.frequency.setValueAtTime(820, t0);
    f2.frequency.linearRampToValueAtTime(560, t0 + dur);
    f1.connect(vg);
    f2.connect(vg);
    vg.connect(g);
    const vib = ctx.createOscillator();
    vib.frequency.value = 4.6;
    const vibg = ctx.createGain();
    vibg.gain.value = 3;
    vib.connect(vibg);
    for (const [f, d] of [[74, 0], [111, 4]] as const) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f, t0);
      o.frequency.exponentialRampToValueAtTime(f * 0.72, t0 + dur);
      o.detune.value = d;
      vibg.connect(o.frequency);
      o.connect(f1);
      o.connect(f2);
      o.start(t0);
      o.stop(t0 + dur + 0.1);
    }
    vib.start(t0);
    vib.stop(t0 + dur + 0.1);
    // гул сети проседает — свет «вздрагивает» вместе со звуком
    if (this.hum) {
      const h = this.hum.gain;
      const t = ctx.currentTime;
      h.cancelScheduledValues(t);
      h.setValueAtTime(0.02, t);
      h.linearRampToValueAtTime(0.004, t + 0.15);
      h.linearRampToValueAtTime(0.02, t + 2.5);
    }
  }

  /** Близость Хвателя 0…1 (каждое событие approach). */
  approach(meter: number) {
    if (!this.ctx) return;
    this.counters.approach++;
    if (!this.grabber) this.grabber = this.makeGrabber();
    this.grabber.dist = lerp(11, 0.9, Math.max(0, Math.min(1, meter)));
    this.grabber.leaving = 0;
  }

  private makeGrabber() {
    const ctx = this.ctx!;
    const e = this.listener;
    const pan = this.panner({ x: 0, y: e.y - 11, z: -0.3 }, 2.5, 1);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(pan);
    this.out(pan, 0.7);
    // низкое рычание — нарастает к концу
    const growl = ctx.createGain();
    growl.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 180;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 38;
    osc.connect(lp).connect(growl).connect(gain);
    osc.start();
    return { pan, gain, growl, osc, breathAt: 0, stepAt: 0.3, dist: 11, leaving: 0 };
  }

  private updateGrabber(dt: number, eye: V3) {
    const g = this.grabber;
    if (!g || !this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    if (g.leaving > 0) {
      g.leaving += dt;
      g.dist += dt * 7;
      if (g.leaving > 3.5) {
        this.dropGrabber();
        return;
      }
    }
    const near = Math.max(0, Math.min(1, (11 - g.dist) / 10.1));
    setPos(g.pan, { x: 0.05 * Math.sin(t * 0.7), y: eye.y - g.dist, z: -0.3 + (near > 0.8 ? 0.4 : 0) });
    const vol = (g.leaving > 0 ? Math.max(0, 1 - g.leaving / 3) : 1) * lerp(0.8, 1.9, near);
    g.gain.gain.setTargetAtTime(vol, t, 0.15);
    g.growl.gain.setTargetAtTime(near * near * 0.22, t, 0.3);
    if (g.leaving > 0) return;
    // дыхание: вдох-выдох, темп растёт с близостью
    g.breathAt -= dt;
    if (g.breathAt <= 0) {
      const period = lerp(2.5, 1.05, near);
      g.breathAt = period;
      const inh = this.burst(this.noise, period * 0.45, 'bandpass', 900, 1.4, 0.45, g.gain, 0, period * 0.3);
      inh.flt.frequency.linearRampToValueAtTime(1300, inh.t + period * 0.4);
      const exh = this.burst(this.noise, period * 0.5, 'bandpass', 520, 1.1, 0.6, g.gain, period * 0.48, 0.04);
      exh.flt.frequency.linearRampToValueAtTime(380, exh.t + period * 0.5);
    }
    // шарканье
    g.stepAt -= dt;
    if (g.stepAt <= 0) {
      g.stepAt = lerp(1.5, 0.5, near) * rnd(0.7, 1.3);
      this.burst(this.brown, 0.32, 'lowpass', 700, 0.8, 0.75, g.gain, 0, 0.06);
      this.burst(this.noise, 0.18, 'bandpass', 2400, 3, 0.07, g.gain, 0.05, 0.02);
    }
  }

  private dropGrabber() {
    const g = this.grabber;
    if (!g) return;
    this.grabber = null;
    try {
      g.osc.stop();
    } catch {}
    setTimeout(() => {
      g.gain.disconnect();
      g.pan.disconnect();
    }, 400);
  }

  /** Переждал: Хвататель уходит вниз и стихает, разочарованный выдох. */
  survived() {
    if (!this.ctx) return;
    this.counters.survived++;
    const g = this.grabber;
    if (!g) return;
    g.leaving = 0.001;
    this.burst(this.noise, 1.6, 'bandpass', 420, 1.2, 0.35, g.gain, 0.1, 0.2);
  }

  /** Захват: рёв, волочение, удар — потом тишина (фон стихает). */
  grab() {
    if (!this.ctx) return;
    this.counters.grab++;
    const ctx = this.ctx;
    const e = this.listener;
    const pn = this.panner({ x: 0, y: e.y - 0.6, z: -0.4 }, 1, 0.6);
    const g = ctx.createGain();
    g.gain.value = 1.3;
    g.connect(pn);
    this.out(pn, 0.9);
    const ws = ctx.createWaveShaper();
    ws.curve = distortion(60);
    ws.connect(g);
    this.tone('sawtooth', 70, 38, 1.5, 0.9, ws, 0, 0.02);
    this.burst(this.noise, 1.2, 'bandpass', 600, 1, 0.8, ws, 0, 0.02);
    // волочение по ступеням: удары и шорох
    for (let k = 0; k < 7; k++) this.burst(this.brown, 0.18, 'lowpass', 500, 0.7, 0.9, g, 0.35 + k * 0.17 + rnd(-0.03, 0.03), 0.005);
    const drag = this.burst(this.noise, 1.4, 'bandpass', 900, 2, 0.25, g, 0.35, 0.1);
    drag.flt.frequency.linearRampToValueAtTime(300, drag.t + 1.4);
    this.tone('sine', 55, 28, 0.9, 1, g, 1.85, 0.005);
    this.dropGrabber();
    const t = ctx.currentTime;
    this.amb.gain.cancelScheduledValues(t);
    this.amb.gain.setValueAtTime(1, t);
    this.amb.gain.linearRampToValueAtTime(0.0001, t + 2.2);
  }

  /** Новая попытка: фон обратно. */
  reset() {
    if (!this.ctx) return;
    this.dropGrabber();
    const t = this.ctx.currentTime;
    this.amb.gain.cancelScheduledValues(t);
    this.amb.gain.setTargetAtTime(1, t, 0.4);
  }

  /** Размыкание: щелчки дросселей, гул сети, далёкий лязг замка. */
  opened() {
    if (!this.ctx) return;
    this.counters.opened++;
    this.dropGrabber();
    const e = this.listener;
    const pn = this.panner({ x: 0.3, y: e.y + 1, z: -1 }, 2, 0.6);
    this.out(pn, 0.8);
    for (let k = 0; k < 5; k++) this.tone('square', rnd(1800, 2600), 1500, 0.04, 0.05, pn, 0.05 + k * rnd(0.12, 0.3));
    const low = this.panner({ x: 0, y: e.y - 7, z: 2.6 }, 2, 0.8);
    this.out(low, 1.2);
    this.burst(this.noise, 0.5, 'bandpass', 1200, 8, 0.2, low, 1.3);
    this.tone('sine', 90, 50, 0.4, 0.25, low, 1.32);
    if (this.hum) {
      const t = this.ctx.currentTime;
      this.hum.gain.cancelScheduledValues(t);
      this.hum.gain.setValueAtTime(0.004, t);
      this.hum.gain.linearRampToValueAtTime(0.035, t + 1.6);
    }
  }

  /** Дверь: скрип при открытии, хлопок при закрытии. */
  door(open: boolean, p: V3) {
    if (!this.ctx) return;
    this.counters.door++;
    const pn = this.panner(p, 1.5, 1);
    this.out(pn, 0.8);
    if (open) {
      const c = this.burst(this.noise, 1.1, 'bandpass', 620, 18, 0.3, pn, 0, 0.15);
      const curve = new Float32Array(32);
      for (let i = 0; i < curve.length; i++) curve[i] = lerp(560, 980, i / 31) * rnd(0.92, 1.08);
      c.flt.frequency.setValueCurveAtTime(curve, c.t, 1);
    } else {
      this.tone('sine', 75, 40, 0.5, 0.6, pn);
      this.burst(this.brown, 0.35, 'lowpass', 500, 0.7, 0.6, pn);
      this.burst(this.noise, 0.12, 'bandpass', 2000, 4, 0.15, pn, 0.02);
    }
  }

  /** Шаг игрока по бетону. */
  step(p: V3, loud = 1) {
    if (!this.ctx || !this.running) return;
    this.counters.step++;
    const pn = this.panner(p, 1, 1);
    this.out(pn, 0.5);
    this.burst(this.brown, 0.12, 'lowpass', rnd(380, 520), 0.7, 0.16 * loud, pn);
    this.burst(this.noise, 0.05, 'highpass', 3000, 0.7, 0.012 * loud, pn);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.grabber = null;
    const c = this.ctx;
    this.ctx = null;
    if (c) c.close().catch(() => {});
  }
}

function setPos(pn: PannerNode, p: V3) {
  if (pn.positionX) {
    pn.positionX.value = p.x;
    pn.positionY.value = p.y;
    pn.positionZ.value = -p.z;
  } else (pn as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(p.x, p.y, -p.z);
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

/** Отклик подъезда: ранние отражения от бетонных стен и длинный хвост. */
function impulse(ctx: AudioContext, sec: number): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * sec);
  const b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < n; i++) {
      const t = i / n;
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 3.2) * 0.6;
    }
    for (const ms of [11, 19, 31, 47, 62, 83]) {
      const i = Math.floor((ms / 1000) * ctx.sampleRate) + c * 7;
      if (i < n) d[i] += (Math.random() < 0.5 ? -1 : 1) * 0.5;
    }
  }
  return b;
}

function distortion(k: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    c[i] = ((3 + k) * x * 20 * (Math.PI / 180)) / (Math.PI + k * Math.abs(x));
  }
  return c;
}
