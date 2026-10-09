// Звук биома «Метро» — процедурный WebAudio, без файлов (по образцу obshagaAudio.ts / snowAudio.ts).
//  • фон: ровный гул ламп и дросселей (тихо); ветер-«поршень» — поезд гонит воздух по тоннелям: волна нарастает и спадает
//    раз в 40–90 с; дальний поезд — низкий рокот с перестуком колёс на стыках, приходит и уходит (раз в 50–120 с),
//    гулко — большое эхо зала;
//  • эскалатор: гул привода (мотор, редуктор) и мерный перестук ступеней — позиционно, у ближайшей работающей дорожки
//    (`esc`); на ленте — громче и у самых ног (`onBelt`);
//  • срыв: рывок — скрежет металла, удар, лента встаёт (shudder); хлопок цепи (snap); лента бежит вниз — грохот ступеней
//    нарастает со скоростью (`runaway` каждый кадр); обрыв — грохот падения в приямок, лязг, осыпь (crash);
//    выбросило внизу — удар о пол (thrown); погиб — удар, гул и тишина (death);
//  • шаги — по граниту и мрамору, гулко.
//
// AudioContext — только по жесту (start() из клавиши / клика). Координаты — мировые Babylon; WebAudio правосторонний:
// z → −z. Слушатель — глаза и yaw камеры.
//
// ИНТЕГРАЦИЯ:
//   const a = new MetroAudio();      // вкл/выкл — localStorage 'room-forge/metro-sound'
//   a.start();                       // по жесту
//   a.update(dt, { inBiome, moving, speed, esc, onBelt, runaway, listener, dead });   // КАЖДЫЙ кадр
//   a.shudder(p); a.snap(p); a.crash(p); a.thrown(); a.death(); a.reset(); a.setEnabled(on); a.dispose().

type V3 = { x: number; y: number; z: number };

/** Ключ localStorage: '0' — звук метро выключен. */
export const METRO_SOUND_KEY = 'room-forge/metro-sound';

export interface MetroAudioFrame {
  /** игрок в метро; false — всё плавно затихает */
  inBiome: boolean;
  /** идёт; скорость, м/с */
  moving: boolean;
  speed: number;
  /** ближайшая работающая дорожка: точка (Babylon) и громкость 0…1; null — рядом нет */
  esc: (V3 & { k: number }) | null;
  /** игрок стоит на ленте */
  onBelt: boolean;
  /** срыв рядом: точка ленты (Babylon) и |скорость| ленты, м/с; null — нет */
  runaway: (V3 & { v: number }) | null;
  listener: { x: number; y: number; z: number; yaw: number };
  dead: boolean;
}

export interface MetroAudioCounters {
  step: number;
  tick: number;
  train: number;
  shudder: number;
  snap: number;
  crash: number;
  thrown: number;
  death: number;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const clamp01 = (v: number) => clamp(v, 0, 1);
const fin = (v: number, d = 0) => (Number.isFinite(v) ? v : d);

// ───────────────────────── чистые функции ─────────────────────────

/** Шаг ступеней ленты, м: перестук — раз на ступень. */
export const ESC_PITCH = 0.4;

/** Перестук ступеней в секунду при скорости ленты v (м/с): одна ступень на ESC_PITCH, не чаще 22 в секунду. */
export function tickRate(v: number): number {
  return clamp(Math.abs(fin(v)) / ESC_PITCH, 0, 22);
}

/** Волна «поршня» в момент фазы ph (0…1 — от прихода поезда до ухода): нарастает быстро, спадает долго. */
export function pistonWave(ph: number): number {
  const p = clamp01(fin(ph));
  return p < 0.25 ? Math.sin((p / 0.25) * (Math.PI / 2)) ** 2 : Math.exp(-(p - 0.25) * 5);
}

export class MetroAudio {
  ctx: AudioContext | null = null;
  readonly counters: MetroAudioCounters = { step: 0, tick: 0, train: 0, shudder: 0, snap: 0, crash: 0, thrown: 0, death: 0 };
  private _enabled: boolean;
  private master!: GainNode;
  private fade!: GainNode;
  private analyser: AnalyserNode | null = null;
  private sfx!: GainNode;
  private amb!: GainNode;
  private wet!: GainNode;
  private noise!: AudioBuffer;
  private brown!: AudioBuffer;
  private listener = { x: 0, y: 1.6, z: 0, yaw: 0 };
  // непрерывные слои
  private humG: GainNode | null = null;
  private windG: GainNode | null = null;
  private windF: BiquadFilterNode | null = null;
  private escG: GainNode | null = null;
  private escPn: PannerNode | null = null;
  private runG: GainNode | null = null;
  private runF: BiquadFilterNode | null = null;
  private runPn: PannerNode | null = null;
  // состояние
  private wind = { ph: 1, dur: 30, wait: rnd(10, 30) };
  private trainIn = rnd(25, 60);
  private tickT = 0;
  private runTickT = 0;
  private stepT = 0;
  private foot = 0;
  private wasMoving = false;
  private hold = 0;
  private disposed = false;

  constructor() {
    let on = true;
    try {
      if (typeof localStorage !== 'undefined') on = localStorage.getItem(METRO_SOUND_KEY) !== '0';
    } catch {}
    this._enabled = on;
  }

  get enabled(): boolean {
    return this._enabled;
  }

  get running(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Запуск по жесту пользователя (клик / клавиша). Повторный вызов — resume. */
  start(): void {
    if (this.disposed) return;
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

  /** Текущий уровень (RMS) на выходе, 0…1 — для QA. */
  level(): number {
    const a = this.analyser;
    if (!a) return 0;
    const d = new Float32Array(a.fftSize);
    a.getFloatTimeDomainData(d);
    let s = 0;
    for (const v of d) s += v * v;
    return Math.sqrt(s / d.length);
  }

  setEnabled(on: boolean): void {
    this._enabled = on;
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(METRO_SOUND_KEY, on ? '1' : '0');
    } catch {}
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(on ? 0.7 : 0, t, 0.08);
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
    const clip = ctx.createWaveShaper();
    clip.curve = softClip();
    clip.oversample = '2x';
    comp.connect(clip).connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = this._enabled ? 0.7 : 0;
    this.master.connect(comp);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    comp.connect(this.analyser);
    this.fade = ctx.createGain();
    this.fade.gain.value = 0;
    this.fade.connect(this.master);
    // зал станции: большой каменный объём — редкие ранние отражения и длинный хвост 3.2 с
    const conv = ctx.createConvolver();
    conv.buffer = hallImpulse(ctx, 3.2);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.55;
    this.wet.connect(conv);
    conv.connect(this.fade);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.fade);
    this.amb = ctx.createGain();
    this.amb.connect(this.fade);
    this.noise = noiseBuffer(ctx, 4, false);
    this.brown = noiseBuffer(ctx, 5, true);
    this.ambience();
  }

  /** Непрерывные слои; громкости — в update(). */
  private ambience() {
    const ctx = this.ctx!;
    // лампы: 50/100 Гц и шипение дросселей — очень тихо
    const hum = (this.humG = ctx.createGain());
    hum.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220;
    const o1 = ctx.createOscillator();
    o1.type = 'sawtooth';
    o1.frequency.value = 50;
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = 100.2;
    const g2 = ctx.createGain();
    g2.gain.value = 0.5;
    o1.connect(lp);
    o2.connect(g2).connect(lp);
    lp.connect(hum);
    this.loop(this.noise, 'bandpass', 7200, 1.5, 0.05).connect(hum);
    hum.connect(this.amb);
    o1.start();
    o2.start();
    // ветер-«поршень»: бурый шум, полоса гуляет с волной
    const wind = (this.windG = ctx.createGain());
    wind.gain.value = 0;
    const wf = (this.windF = ctx.createBiquadFilter());
    wf.type = 'lowpass';
    wf.frequency.value = 300;
    wf.Q.value = 0.6;
    this.loop(this.brown, 'lowpass', 900, 0.5, 1.4).connect(wf);
    this.loop(this.noise, 'bandpass', 650, 0.7, 0.18).connect(wf);
    wf.connect(wind).connect(this.amb);
    const ww = ctx.createGain();
    ww.gain.value = 0.5;
    wind.connect(ww).connect(this.wet);
    // гул эскалатора: мотор 48 Гц, редуктор, рокот цепи — позиционно
    const esc = (this.escG = ctx.createGain());
    esc.gain.value = 0;
    const pn = (this.escPn = this.panner({ x: 0, y: 0, z: 0 }, 3, 0.9));
    const el = ctx.createBiquadFilter();
    el.type = 'lowpass';
    el.frequency.value = 160;
    const m1 = ctx.createOscillator();
    m1.type = 'sawtooth';
    m1.frequency.value = 48;
    const m2 = ctx.createOscillator();
    m2.type = 'triangle';
    m2.frequency.value = 96.5;
    const mg = ctx.createGain();
    mg.gain.value = 0.35;
    m1.connect(el);
    m2.connect(mg).connect(el);
    el.connect(esc);
    this.loop(this.brown, 'bandpass', 260, 0.9, 0.9).connect(esc);
    esc.connect(pn);
    this.out(pn, 0.5, this.amb);
    m1.start();
    m2.start();
    // лента бежит вниз: грохот, полоса растёт со скоростью
    const run = (this.runG = ctx.createGain());
    run.gain.value = 0;
    const rf = (this.runF = ctx.createBiquadFilter());
    rf.type = 'bandpass';
    rf.frequency.value = 200;
    rf.Q.value = 0.8;
    this.loop(this.brown, 'lowpass', 1400, 0.5, 2).connect(rf);
    this.loop(this.noise, 'bandpass', 1800, 0.8, 0.25).connect(rf);
    const rpn = (this.runPn = this.panner({ x: 0, y: 0, z: 0 }, 3, 0.8));
    rf.connect(run).connect(rpn);
    this.out(rpn, 0.6);
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

  // ───────────────────────── узлы-помощники ─────────────────────────

  private rel(fwd: number, right: number, up: number): V3 {
    const L = this.listener, s = Math.sin(L.yaw), c = Math.cos(L.yaw);
    return { x: L.x + s * fwd + c * right, y: L.y + up, z: L.z + c * fwd - s * right };
  }

  private panner(p: V3, ref = 1.5, rolloff = 1.2): PannerNode {
    const pn = this.ctx!.createPanner();
    pn.panningModel = 'HRTF';
    pn.distanceModel = 'inverse';
    pn.refDistance = ref;
    pn.rolloffFactor = rolloff;
    pn.maxDistance = 200;
    setPos(pn, p);
    return pn;
  }

  /** Выход: сухой и в эхо зала. */
  private out(node: AudioNode, wet = 0.5, to: AudioNode = this.sfx) {
    node.connect(to);
    if (wet > 0) {
      const w = this.ctx!.createGain();
      w.gain.value = wet;
      node.connect(w).connect(this.wet);
    }
  }

  /** Разовый позиционный выход в точке p. */
  private at(p: V3, wet = 0.6, ref = 2): PannerNode {
    const pn = this.panner(p, ref, 1);
    this.out(pn, wet);
    return pn;
  }

  private burst(buf: AudioBuffer, dur: number, type: BiquadFilterType, f: number, q: number, peak: number, dest: AudioNode, at = 0, attack = 0.005) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + at;
    const s = ctx.createBufferSource();
    s.buffer = buf;
    const flt = ctx.createBiquadFilter();
    flt.type = type;
    flt.frequency.setValueAtTime(f, t);
    flt.Q.value = q;
    const g = ctx.createGain();
    const a = Math.min(attack, dur * 0.5);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(flt).connect(g).connect(dest);
    s.start(t, Math.random() * Math.max(0, buf.duration - dur - 0.05));
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
    const a = Math.min(attack, dur * 0.5);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** Металл: негармонические обертоны с разным затуханием. */
  private clang(dest: AudioNode, base: number, peak: number, dur: number, at = 0) {
    for (const [k, d] of [[1, 1], [2.31, 0.7], [3.94, 0.5], [6.37, 0.35], [8.9, 0.22]] as const) {
      this.tone('sine', base * k, base * k * 0.985, dur * d, (peak * 0.5) / Math.sqrt(k), dest, at, 0.002);
    }
    this.burst(this.noise, 0.05, 'bandpass', Math.min(9000, base * 6), 2, peak * 0.4, dest, at, 0.001);
  }

  /** Скрежет: пила с дрожащей высотой через полосовой фильтр. */
  private screech(dest: AudioNode, f0: number, f1: number, dur: number, peak: number, at = 0) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const n = 32;
    const curve = new Float32Array(n);
    let j = 0;
    for (let i = 0; i < n; i++) {
      j = j * 0.5 + (Math.random() * 2 - 1) * 0.09;
      curve[i] = (f0 + (f1 - f0) * (i / (n - 1))) * (1 + j);
    }
    o.frequency.setValueCurveAtTime(curve, t, dur);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = Math.max(f0, f1) * 2.5;
    bp.Q.value = 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.04);
    g.gain.setValueAtTime(peak, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(bp).connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
    this.burst(this.noise, dur, 'highpass', 2500, 0.7, peak * 0.3, dest, at, 0.03);
  }

  /** Удар тяжёлым: низкий тон и бурый шум. */
  private thud(dest: AudioNode, peak: number, at = 0, f = 70) {
    this.tone('sine', f, f * 0.45, 0.45, peak, dest, at, 0.003);
    this.burst(this.brown, 0.35, 'lowpass', 320, 0.7, peak * 0.9, dest, at, 0.002);
  }

  // ───────────────────────── кадр ─────────────────────────

  update(dt: number, f: MetroAudioFrame): void {
    if (!this.ctx || this.disposed) return;
    dt = clamp(fin(dt, 0.016), 0, 0.25);
    const ls = f.listener;
    const L = this.listener;
    L.x = fin(ls.x);
    L.y = fin(ls.y, 1.6);
    L.z = fin(ls.z);
    L.yaw = fin(ls.yaw);
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const al = ctx.listener;
    const fx = Math.sin(L.yaw), fz = Math.cos(L.yaw);
    if (al.positionX) {
      al.positionX.setTargetAtTime(L.x, t, 0.02);
      al.positionY.setTargetAtTime(L.y, t, 0.02);
      al.positionZ.setTargetAtTime(-L.z, t, 0.02);
      al.forwardX.setTargetAtTime(fx, t, 0.02);
      al.forwardY.setTargetAtTime(0, t, 0.02);
      al.forwardZ.setTargetAtTime(-fz, t, 0.02);
      al.upX.value = 0;
      al.upY.value = 1;
      al.upZ.value = 0;
    } else {
      (al as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(L.x, L.y, -L.z);
      (al as unknown as { setOrientation(...a: number[]): void }).setOrientation(fx, 0, -fz, 0, 1, 0);
    }
    if (!this.running) return;
    this.fade.gain.setTargetAtTime(f.inBiome ? 1 : 0, t, f.inBiome ? 0.6 : 0.5);
    if (!f.inBiome) return;
    this.hold = Math.max(0, this.hold - dt);
    const duck = f.dead || this.hold > 0;
    this.amb.gain.setTargetAtTime(duck ? 0.15 : 1, t, duck ? 0.05 : 1.2);
    // ── лампы
    this.humG!.gain.setTargetAtTime(f.dead ? 0 : 0.035, t, 0.5);
    // ── поршень: волна раз в 40–90 с
    const w = this.wind;
    if (w.ph < 1) w.ph = Math.min(1, w.ph + dt / w.dur);
    else if ((w.wait -= dt) <= 0) {
      w.ph = 0;
      w.dur = rnd(14, 26);
      w.wait = rnd(40, 90);
    }
    const wk = pistonWave(w.ph);
    this.windG!.gain.setTargetAtTime(f.dead ? 0 : 0.05 + 0.32 * wk, t, 0.4);
    this.windF!.frequency.setTargetAtTime(260 + 900 * wk, t, 0.5);
    // ── дальний поезд
    this.trainIn -= dt;
    if (this.trainIn <= 0) {
      this.trainIn = rnd(50, 120);
      if (!f.dead) this.train();
    }
    // ── эскалатор рядом: гул и перестук ступеней
    const e = f.esc;
    const ek = e && !f.dead ? clamp01(e.k) * (f.onBelt ? 1 : 0.7) : 0;
    if (e) setPosT(this.escPn!, e, t);
    this.escG!.gain.setTargetAtTime(0.32 * ek, t, 0.25);
    if (ek > 0.05) {
      this.tickT += dt * tickRate(0.75);
      while (this.tickT >= 1) {
        this.tickT -= 1;
        this.tick(e!, f.onBelt ? 0.12 : 0.06 * ek);
      }
    }
    // ── срыв: лента бежит вниз
    const r = f.runaway;
    const rv = r && !f.dead ? Math.abs(fin(r.v)) : 0;
    if (r) setPosT(this.runPn!, r, t);
    this.runG!.gain.setTargetAtTime(Math.min(1.2, rv * 0.17), t, 0.08);
    this.runF!.frequency.setTargetAtTime(160 + rv * 120, t, 0.1);
    if (rv > 0.3) {
      this.runTickT += dt * tickRate(rv);
      while (this.runTickT >= 1) {
        this.runTickT -= 1;
        this.tick(r!, 0.1 + 0.03 * rv, 0.8 + rv * 0.08);
      }
    } else this.runTickT = 0;
    if (f.dead) return;
    // ── шаги по граниту
    const speed = fin(f.speed);
    const walking = f.moving && speed > 0.15;
    if (walking) {
      const iv = clamp(Math.min(1.1, 0.62 + 0.09 * speed) / Math.max(0.1, speed), 0.3, 0.8);
      if (!this.wasMoving) this.stepT = iv * 0.65;
      this.stepT += dt;
      if (this.stepT >= iv) {
        this.stepT = 0;
        this.step(clamp(0.5 + 0.2 * speed, 0.5, 1.2), f.onBelt);
      }
    }
    this.wasMoving = walking;
  }

  /** Перестук ступени (стык гребёнки): короткий металлический щелчок в точке p. */
  private tick(p: V3, peak: number, pitch = 1) {
    if (!this.on()) return;
    this.counters.tick++;
    const pn = this.at(p, 0.3, 2.5);
    this.burst(this.noise, 0.03, 'bandpass', 1300 * pitch * rnd(0.9, 1.1), 3, peak, pn, 0, 0.001);
    this.tone('triangle', 420 * pitch, 380 * pitch, 0.05, peak * 0.25, pn, 0, 0.001);
  }

  private step(loud: number, metal: boolean) {
    if (!this.on()) return;
    this.counters.step++;
    this.foot ^= 1;
    const pn = this.at(this.rel(0.1, this.foot ? 0.12 : -0.12, -1.5), 0.7, 1);
    // гранит: сухой щелчок каблука и глухой низ; на ленте — рифлёный металл
    this.burst(this.noise, 0.05, 'bandpass', metal ? 2600 : 1700, 1.6, 0.16 * loud, pn, 0, 0.002);
    this.burst(this.brown, 0.09, 'lowpass', 300, 0.7, 0.3 * loud, pn, 0.004, 0.003);
    if (metal) this.tone('triangle', 900, 820, 0.06, 0.03 * loud, pn, 0.003, 0.001);
  }

  /** Дальний поезд: рокот приходит и уходит (10 с), перестук колёс на стыках, далеко и гулко. */
  private train() {
    if (!this.on()) return;
    this.counters.train++;
    const ctx = this.ctx!;
    const t0 = ctx.currentTime;
    const side = Math.random() < 0.5 ? -1 : 1;
    const pn = this.panner(this.rel(rnd(-10, 10), side * rnd(25, 45), -3), 8, 1);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    lp.connect(pn);
    this.out(pn, 1.2, this.amb);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.9, t0 + 4);
    g.gain.setValueAtTime(0.9, t0 + 6);
    g.gain.linearRampToValueAtTime(0.0001, t0 + 11);
    g.connect(lp);
    const s = ctx.createBufferSource();
    s.buffer = this.brown;
    s.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 160;
    s.connect(f).connect(g);
    s.start(t0);
    s.stop(t0 + 11.2);
    // колёса: «та-дам» на стыках, чаще в середине
    for (let at = 1.5; at < 9.5; at += rnd(0.55, 0.8)) {
      const k = Math.sin(((at - 1.5) / 8) * Math.PI);
      this.thud(lp, 0.12 * k, at, 95);
      this.thud(lp, 0.1 * k, at + 0.13, 90);
    }
  }

  /** Рывок: скрежет металла, тяжёлый удар, лента встаёт. */
  shudder(p: V3): void {
    if (!this.on()) return;
    this.counters.shudder++;
    const pn = this.at(p, 0.8, 3);
    this.thud(pn, 1, 0, 60);
    this.screech(pn, 520, 210, 1.1, 0.35, 0.02);
    this.clang(pn, 150, 0.5, 1.2, 0.05);
    this.tone('sawtooth', 48, 20, 0.9, 0.2, pn, 0, 0.01);
  }

  /** Хлопок цепи: лента пошла вниз. */
  snap(p: V3): void {
    if (!this.on()) return;
    this.counters.snap++;
    const pn = this.at(p, 0.9, 3);
    this.clang(pn, 430, 0.8, 1.4);
    this.burst(this.noise, 0.12, 'highpass', 1500, 0.7, 0.7, pn, 0, 0.001);
    this.thud(pn, 0.7, 0.02, 80);
    this.screech(pn, 300, 900, 0.8, 0.22, 0.08);
  }

  /** Обрыв: лента падает в приямок — грохот, лязг, осыпь. */
  crash(p: V3): void {
    if (!this.on()) return;
    this.counters.crash++;
    this.hold = Math.max(this.hold, 1.2);
    const pn = this.at(p, 1.1, 4);
    this.burst(this.brown, 2.6, 'lowpass', 520, 0.6, 1.3, pn, 0, 0.01);
    this.thud(pn, 1.2, 0, 50);
    this.thud(pn, 1, 0.7, 45);
    for (let k = 0; k < 7; k++) this.clang(pn, rnd(110, 520), rnd(0.25, 0.55), rnd(0.6, 1.4), rnd(0, 1.1));
    for (let k = 0; k < 18; k++) this.burst(this.noise, rnd(0.03, 0.09), 'bandpass', rnd(900, 4000), 2, rnd(0.08, 0.2), pn, 0.6 + rnd(0, 1.6), 0.002);
  }

  /** Выбросило внизу: удар о пол, выдох. */
  thrown(): void {
    if (!this.on()) return;
    this.counters.thrown++;
    const pn = this.at(this.rel(0.2, 0, -1.3), 0.6, 1);
    this.thud(pn, 0.9, 0, 75);
    this.burst(this.noise, 0.25, 'bandpass', 700, 1, 0.25, pn, 0.05, 0.02);
  }

  /** Погиб: удар о дно, гул — и тишина (фон — по f.dead). */
  death(): void {
    if (!this.on()) return;
    this.counters.death++;
    this.hold = 8;
    const pn = this.at(this.rel(0, 0, -0.3), 0.8, 1);
    this.thud(pn, 1.3, 0, 55);
    this.burst(this.brown, 3.2, 'lowpass', 80, 0.7, 0.9, this.sfx, 0.2, 0.6);
    this.tone('sawtooth', 36, 28, 3.2, 0.25, pn, 0.25, 0.8);
  }

  /** Новая попытка: фон возвращается. */
  reset(): void {
    this.hold = 0;
    this.wasMoving = false;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.amb.gain.cancelScheduledValues(t);
    this.amb.gain.setTargetAtTime(1, t, 0.6);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
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

/** Плавно — для источников, что движутся каждый кадр. */
function setPosT(pn: PannerNode, p: V3, t: number) {
  if (pn.positionX) {
    pn.positionX.setTargetAtTime(fin(p.x), t, 0.05);
    pn.positionY.setTargetAtTime(fin(p.y), t, 0.05);
    pn.positionZ.setTargetAtTime(-fin(p.z), t, 0.05);
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

/** Отклик зала станции: редкие ранние отражения от колонн и свода, длинный тёмный хвост. */
function hallImpulse(ctx: AudioContext, sec: number): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * sec);
  const b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      lp += 0.25 * ((Math.random() * 2 - 1) - lp);
      d[i] = lp * Math.pow(1 - i / n, 2.4) * 0.6;
    }
    for (let k = 1; k < 14; k++) {
      const i = Math.floor(((23 * k + rnd(-6, 6)) / 1000) * ctx.sampleRate) + c * 9;
      if (i < n) d[i] += (Math.random() < 0.5 ? -1 : 1) * 0.35 * Math.pow(0.82, k);
    }
  }
  return b;
}

function softClip(): Float32Array<ArrayBuffer> {
  const n = 2048;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = Math.tanh((i * 2) / (n - 1) - 1);
  return c;
}
