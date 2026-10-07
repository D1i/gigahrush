// Звук «Ржавого лифта» — процедурный WebAudio, без файлов (по образцу stairwellAudio.ts).
//  • фон: сквозняк в шахте (полоса шума с медленным завыванием), низкий рокот дома, капель сверху;
//  • лебёдка: мотор и вой редуктора сверху шахты, гул троса у крюка — пока кабина едет (громкость и высота —
//    по скорости), скрип троса время от времени; лязг при старте и остановке, глухой стук порогов этажей;
//  • раскачка: скрип строп/цепей на разворотах качания и звяканье — тем чаще и громче, чем больше амплитуда;
//  • доска: треск + удар + шипение пыли; пока застряла и качает — скрежет по стене (по скорости крена);
//    выпала — треск, свист падения вниз по шахте (источник уходит вниз) и далёкий удар со дна;
//  • клетка о стену — металлический удар (негармонические обертоны), дребезг решёток;
//  • логово: гул (низкие пилы + рычащий шум, «дыхание») — позиционный, из проёма логова;
//  • выброс с каретки: нарастающий свист воздуха, глухой удар, тишина;
//  • решётки — дребезг складной решётки, рычаг — щелчки храповика, шаги по доскам/железу/бетону.
// AudioContext создаётся только по жесту пользователя (политика автоплея) — start() из клика.
//
// Координаты — мировые Babylon сцены лифта (Y — вверх, этаж 0 — Y = 0); WebAudio правосторонний: z → −z.

type V3 = { x: number; y: number; z: number };

export interface LiftAudioCounters {
  depart: number;
  arrive: number;
  pass: number;
  board: number;
  freed: number;
  bang: number;
  creak: number;
  clink: number;
  gate: number;
  lever: number;
  step: number;
  thrown: number;
  drip: number;
}

/** Состояние кадра для непрерывных слоёв. */
export interface LiftAudioFrame {
  /** скорость кабины, доля от номинала 0…1 (мотор) */
  moving: number;
  /** амплитуда качания 0…1+ (цепи, скрип) */
  sway: number;
  /** dφ/dt в долях ω: знак — для скрипа на развороте */
  swayVel: number;
  /** крюк (верх кабины) и верх шахты (лебёдка), мировые */
  hook: V3;
  top: V3;
  /** застрявшая доска: точка и сила скрежета 0…1 (null — нет) */
  board: { at: V3; scrape: number } | null;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export class LiftAudio {
  ctx: AudioContext | null = null;
  enabled: boolean;
  readonly counters: LiftAudioCounters = { depart: 0, arrive: 0, pass: 0, board: 0, freed: 0, bang: 0, creak: 0, clink: 0, gate: 0, lever: 0, step: 0, thrown: 0, drip: 0 };
  private master!: GainNode;
  private analyser: AnalyserNode | null = null;
  private sfx!: GainNode;
  private amb!: GainNode;
  private wet!: GainNode;
  private noise!: AudioBuffer;
  private brown!: AudioBuffer;
  private listener: V3 = { x: 0, y: 1.6, z: 0 };
  /** лебёдка: мотор сверху шахты и гул троса у крюка */
  private motor: { pan: PannerNode; gain: GainNode; whine: OscillatorNode; saw: OscillatorNode; cable: GainNode; cablePan: PannerNode } | null = null;
  /** скрежет доски о стену */
  private scrape: { pan: PannerNode; gain: GainNode; flt: BiquadFilterNode } | null = null;
  /** гул логова (позиционный) */
  private lair: { pan: PannerNode; gain: GainNode } | null = null;
  private lairAt: V3 | null = null;
  private drift: GainNode | null = null;
  private dripIn = 4;
  private creakIn = 1;
  private clinkIn = 0.5;
  private lastVel = 0;
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

  /** Где логово (мировые координаты проёма) — гул оттуда; null — у лифта логова нет. */
  setLair(p: V3 | null) {
    this.lairAt = p;
    if (this.ctx && p && !this.lair) this.makeLair(p);
  }

  private build() {
    const ctx = this.ctx!;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 0.75 : 0;
    this.master.connect(comp);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    comp.connect(this.analyser);
    // шахта: длинная гулкая труба — отклик 3.2 с, ранние отражения от близких стен (2.6 м)
    const conv = ctx.createConvolver();
    conv.buffer = impulse(ctx, 3.2);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.6;
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
    this.makeMotor();
    this.makeScrape();
    if (this.lairAt) this.makeLair(this.lairAt);
  }

  /** Сквозняк в шахте (завывание), рокот дома. */
  private ambience() {
    const ctx = this.ctx!;
    // сквозняк: полоса шума, частота и громкость медленно «дышат»
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 520;
    bp.Q.value = 2.2;
    const g = (this.drift = ctx.createGain());
    g.gain.value = 0.03;
    s.connect(bp).connect(g).connect(this.amb);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lg = ctx.createGain();
    lg.gain.value = 230;
    lfo.connect(lg).connect(bp.frequency);
    const lfo2 = ctx.createOscillator();
    lfo2.frequency.value = 0.13;
    const lg2 = ctx.createGain();
    lg2.gain.value = 0.018;
    lfo2.connect(lg2).connect(g.gain);
    s.start();
    lfo.start();
    lfo2.start();
    // рокот дома
    this.loop(this.brown, 'lowpass', 90, 0.7, 0.1).connect(this.amb);
    // шорох высоко
    this.loop(this.noise, 'highpass', 4200, 0.5, 0.004).connect(this.amb);
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

  /** Лебёдка: мотор (пила 47 Гц + вой редуктора) сверху; гул троса у крюка. Громкость — в update по скорости. */
  private makeMotor() {
    const ctx = this.ctx!;
    const pan = this.panner({ x: 0, y: 30, z: 0 }, 8, 0.7);
    this.out(pan, 1);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(pan);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    const saw = ctx.createOscillator();
    saw.type = 'sawtooth';
    saw.frequency.value = 47;
    const saw2 = ctx.createOscillator();
    saw2.type = 'sawtooth';
    saw2.frequency.value = 94.6;
    const g2 = ctx.createGain();
    g2.gain.value = 0.5;
    saw.connect(lp);
    saw2.connect(g2).connect(lp);
    lp.connect(gain);
    const whine = ctx.createOscillator();
    whine.type = 'sine';
    whine.frequency.value = 380;
    const wg = ctx.createGain();
    wg.gain.value = 0.18;
    whine.connect(wg).connect(gain);
    // трос: шум узкой полосой у крюка
    const cablePan = this.panner({ x: 0, y: 3, z: 0 }, 1.5, 1);
    this.out(cablePan, 0.4);
    const cable = ctx.createGain();
    cable.gain.value = 0;
    cable.connect(cablePan);
    const cs = ctx.createBufferSource();
    cs.buffer = this.noise;
    cs.loop = true;
    const cf = ctx.createBiquadFilter();
    cf.type = 'bandpass';
    cf.frequency.value = 900;
    cf.Q.value = 3;
    cs.connect(cf).connect(cable);
    saw.start();
    saw2.start();
    whine.start();
    cs.start();
    this.motor = { pan, gain, whine, saw, cable, cablePan };
  }

  private makeScrape() {
    const ctx = this.ctx!;
    const pan = this.panner({ x: 0, y: 0, z: 0 }, 1.2, 1);
    this.out(pan, 0.7);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(pan);
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    const flt = ctx.createBiquadFilter();
    flt.type = 'bandpass';
    flt.frequency.value = 1300;
    flt.Q.value = 7;
    // зернистость скрежета — дрожание громкости
    const tr = ctx.createOscillator();
    tr.type = 'square';
    tr.frequency.value = 23;
    const tg = ctx.createGain();
    tg.gain.value = 0.3;
    const g2 = ctx.createGain();
    g2.gain.value = 0.7;
    tr.connect(tg).connect(g2.gain);
    s.connect(flt).connect(g2).connect(gain);
    s.start();
    tr.start();
    this.scrape = { pan, gain, flt };
  }

  /** Гул логова: низкие пилы, рычащий шум и медленное «дыхание»; источник — в проёме логова. */
  private makeLair(p: V3) {
    const ctx = this.ctx!;
    const pan = this.panner(p, 2.2, 1.3);
    this.out(pan, 1.1);
    const gain = ctx.createGain();
    gain.gain.value = 0.55;
    gain.connect(pan);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 150;
    lp.connect(gain);
    for (const [f, d] of [[36, 0], [54.3, 6], [72.5, -5]] as const) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = d;
      const og = ctx.createGain();
      og.gain.value = f < 40 ? 0.6 : 0.3;
      o.connect(og).connect(lp);
      o.start();
    }
    const growl = this.loop(this.brown, 'bandpass', 210, 1.6, 0.6);
    growl.connect(gain);
    // дыхание: громкость качается 0.18 Гц
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.18;
    const lg = ctx.createGain();
    lg.gain.value = 0.3;
    lfo.connect(lg).connect(gain.gain);
    lfo.start();
    this.lair = { pan, gain };
  }

  /** Источник в точке p: HRTF-панорама, громкость спадает с расстоянием. */
  private panner(p: V3, ref = 1.5, rolloff = 1.2): PannerNode {
    const ctx = this.ctx!;
    const pn = ctx.createPanner();
    pn.panningModel = 'HRTF';
    pn.distanceModel = 'inverse';
    pn.refDistance = ref;
    pn.rolloffFactor = rolloff;
    pn.maxDistance = 300;
    setPos(pn, p);
    return pn;
  }

  /** Выход эффекта: сухой и в эхо шахты. */
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
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
    return { o, g, t };
  }

  /** Металлический удар: негармонические обертоны с разным затуханием (ржавое железо — глухо). */
  private clang(dest: AudioNode, base: number, peak: number, dur: number, at = 0) {
    for (const [k, d] of [[1, 1], [2.31, 0.7], [3.94, 0.5], [6.37, 0.35], [8.9, 0.22]] as const) {
      this.tone('sine', base * k, base * k * 0.985, dur * d, (peak * 0.5) / Math.sqrt(k), dest, at, 0.002);
    }
    this.burst(this.noise, 0.06, 'bandpass', base * 6, 2, peak * 0.5, dest, at, 0.001);
  }

  // ───────────────────────── кадр ─────────────────────────

  /** Каждый кадр: слушатель (глаза, взгляд), непрерывные слои, фоновые случайные звуки. */
  update(dt: number, eye: V3, fwd: V3, up: V3, f: LiftAudioFrame) {
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
      L.upX.setTargetAtTime(up.x, t, 0.02);
      L.upY.setTargetAtTime(up.y, t, 0.02);
      L.upZ.setTargetAtTime(-up.z, t, 0.02);
    } else {
      (L as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(eye.x, eye.y, -eye.z);
      (L as unknown as { setOrientation(...a: number[]): void }).setOrientation(fwd.x, fwd.y, -fwd.z, up.x, up.y, -up.z);
    }
    if (!this.running) return;
    const m = this.motor;
    if (m) {
      setPos(m.pan, f.top);
      setPos(m.cablePan, f.hook);
      m.gain.gain.setTargetAtTime(0.32 * f.moving, t, 0.12);
      m.whine.frequency.setTargetAtTime(300 + 140 * f.moving, t, 0.2);
      m.saw.frequency.setTargetAtTime(40 + 9 * f.moving, t, 0.2);
      m.cable.gain.setTargetAtTime(0.05 * f.moving + 0.03 * clamp01(f.sway), t, 0.1);
    }
    const sc = this.scrape;
    if (sc) {
      const s = f.board ? f.board.scrape : 0;
      if (f.board) setPos(sc.pan, f.board.at);
      sc.gain.gain.setTargetAtTime(0.5 * s, t, 0.05);
      sc.flt.frequency.setTargetAtTime(900 + 900 * s, t, 0.05);
    }
    // скрип строп/цепей на развороте качания (смена знака скорости крена) и звяканье
    if (f.sway > 0.04 && Math.sign(f.swayVel) !== Math.sign(this.lastVel) && this.lastVel !== 0) this.creak(f.hook, clamp01(f.sway));
    this.lastVel = f.swayVel;
    if (f.sway > 0.08) {
      this.clinkIn -= dt * (0.5 + 4 * clamp01(f.sway));
      if (this.clinkIn <= 0) {
        this.clinkIn = rnd(0.5, 1.2);
        this.clink({ x: f.hook.x + rnd(-1, 1), y: f.hook.y - rnd(0, 2), z: f.hook.z + rnd(-1, 1) }, clamp01(f.sway));
      }
    }
    // скрип троса в движении
    if (f.moving > 0.2) {
      this.creakIn -= dt;
      if (this.creakIn <= 0) {
        this.creakIn = rnd(1.2, 3.5);
        this.creak(f.hook, 0.3);
      }
    }
    // капель и шорохи сверху
    this.dripIn -= dt;
    if (this.dripIn <= 0) {
      this.dripIn = rnd(2.5, 7);
      this.drip({ x: rnd(-1.2, 1.2), y: eye.y + rnd(-6, 8), z: rnd(-1.2, 1.2) });
    }
  }

  private drip(p: V3) {
    this.counters.drip++;
    const pn = this.panner(p, 1, 0.9);
    this.out(pn, 1);
    const f = rnd(1200, 2400);
    this.tone('sine', f, f * 0.55, rnd(0.08, 0.15), 0.07, pn);
  }

  /** Скрип стропы/троса: узкая полоса шума с глиссандо и дрожью. */
  private creak(p: V3, k: number) {
    if (!this.ctx) return;
    this.counters.creak++;
    const pn = this.panner(p, 1.5, 1);
    this.out(pn, 0.6);
    const dur = rnd(0.35, 0.8);
    const f0 = rnd(380, 700);
    const c = this.burst(this.noise, dur, 'bandpass', f0, 22, 0.18 + 0.4 * k, pn, 0, dur * 0.3);
    c.flt.frequency.linearRampToValueAtTime(f0 * rnd(1.3, 1.8), c.t + dur);
    const tr = this.ctx.createOscillator();
    tr.type = 'square';
    tr.frequency.value = rnd(28, 45);
    const tg = this.ctx.createGain();
    tg.gain.value = 0.25;
    tr.connect(tg).connect(c.g.gain);
    tr.start(c.t);
    tr.stop(c.t + dur);
  }

  /** Звяканье цепи / решётки. */
  private clink(p: V3, k: number) {
    this.counters.clink++;
    const pn = this.panner(p, 1.2, 1);
    this.out(pn, 0.5);
    this.clang(pn, rnd(700, 1400), 0.06 + 0.12 * k, 0.25);
  }

  // ───────────────────────── события механики ─────────────────────────

  /** Тронулся: рывок, лязг троса — мотор поднимается сам (update). */
  depart(at: V3) {
    if (!this.ctx) return;
    this.counters.depart++;
    const pn = this.panner(at, 1.5, 1);
    this.out(pn, 0.7);
    this.tone('sine', 62, 40, 0.4, 0.5, pn);
    this.burst(this.brown, 0.3, 'lowpass', 400, 0.7, 0.4, pn);
    this.clang(pn, 210, 0.25, 0.6, 0.05);
  }

  /** Остановка у этажа: тяжёлый стук, короткий визг тормоза. */
  arrive(at: V3) {
    if (!this.ctx) return;
    this.counters.arrive++;
    const pn = this.panner(at, 1.5, 1);
    this.out(pn, 0.8);
    this.tone('sine', 70, 38, 0.5, 0.7, pn);
    this.burst(this.brown, 0.35, 'lowpass', 500, 0.7, 0.6, pn);
    this.clang(pn, 180, 0.3, 0.8, 0.02);
    this.tone('sine', 1250, 880, 0.35, 0.05, pn, 0, 0.05);
  }

  /** Проехал этаж: глухой стук порога. */
  pass(at: V3) {
    if (!this.ctx) return;
    this.counters.pass++;
    const pn = this.panner(at, 1.5, 1);
    this.out(pn, 0.6);
    this.tone('sine', 80, 50, 0.25, 0.25, pn);
    this.burst(this.noise, 0.1, 'bandpass', 1500, 3, 0.05, pn, 0.02);
  }

  /** Доска упала и застряла: треск, удар, шипение пыли, дрожь кабины. */
  board(at: V3) {
    if (!this.ctx) return;
    this.counters.board++;
    const ctx = this.ctx;
    const pn = this.panner(at, 2, 0.8);
    const g = ctx.createGain();
    g.gain.value = 1.5;
    g.connect(pn);
    this.out(pn, 1.1);
    // треск дерева: короткие щелчки
    for (let k = 0; k < 6; k++) this.burst(this.noise, rnd(0.02, 0.06), 'highpass', rnd(1800, 3500), 0.8, 0.8, g, k * rnd(0.008, 0.025), 0.001);
    this.tone('square', 1900, 500, 0.05, 0.25, g);
    // удар
    this.tone('sine', 68, 30, 0.9, 1, g, 0.01, 0.003);
    this.burst(this.brown, 0.5, 'lowpass', 380, 0.7, 0.9, g, 0.01);
    // железо кабины отзывается
    this.clang(g, 160, 0.45, 1.2, 0.02);
    // шипение и шорох пыли
    const d = this.burst(this.noise, 2.2, 'highpass', 2600, 0.5, 0.12, g, 0.08, 0.12);
    d.flt.frequency.linearRampToValueAtTime(5200, d.t + 2.2);
    this.burst(this.noise, 1.4, 'bandpass', 700, 0.8, 0.08, g, 0.15, 0.3);
  }

  /** Доска выпала: треск, свист вниз по шахте (источник уходит вниз), далёкий удар со дна. */
  freed(at: V3, depth: number) {
    if (!this.ctx) return;
    this.counters.freed++;
    const ctx = this.ctx;
    const pn = this.panner(at, 2, 0.9);
    this.out(pn, 1);
    for (let k = 0; k < 4; k++) this.burst(this.noise, 0.05, 'highpass', 2600, 0.8, 0.6, pn, k * 0.02, 0.001);
    // падающая доска: источник уходит вниз
    const fall = Math.sqrt((2 * Math.max(2, depth)) / 9.81);
    const fp = this.panner(at, 1.5, 1.2);
    this.out(fp, 1);
    const t = ctx.currentTime;
    if (fp.positionY) {
      fp.positionY.setValueAtTime(at.y, t);
      fp.positionY.linearRampToValueAtTime(at.y - depth, t + fall);
    }
    const wh = this.burst(this.noise, fall + 0.2, 'bandpass', 900, 3, 0.25, fp, 0.05, 0.2);
    wh.flt.frequency.exponentialRampToValueAtTime(300, wh.t + fall);
    // стук о стены по пути
    for (let k = 1; k < 4; k++) this.burst(this.brown, 0.15, 'lowpass', 600, 0.7, 0.35 / k, fp, (fall * k) / 4, 0.003);
    // дно — далеко, глухо, в эхо
    const low = this.panner({ x: at.x, y: at.y - depth, z: at.z }, 3, 0.7);
    this.out(low, 1.4);
    this.tone('sine', 55, 30, 0.8, 0.5, low, fall);
    this.burst(this.brown, 0.4, 'lowpass', 300, 0.7, 0.5, low, fall);
  }

  /** Клетка ударилась о стену шахты: металл, дребезг решёток, глухой бетон. */
  bang(at: V3, strength: number) {
    if (!this.ctx) return;
    this.counters.bang++;
    const k = clamp01(0.35 + strength);
    const pn = this.panner(at, 1.8, 0.9);
    this.out(pn, 1);
    this.clang(pn, rnd(120, 150), 0.9 * k, 1.6);
    this.tone('sine', 60, 32, 0.6, 0.8 * k, pn);
    this.burst(this.brown, 0.4, 'lowpass', 450, 0.7, 0.7 * k, pn);
    // дребезг решёток
    for (let i = 0; i < 7; i++) this.clang(pn, rnd(900, 1700), 0.12 * k, 0.15, 0.05 + i * rnd(0.03, 0.07));
    this.burst(this.noise, 0.8, 'highpass', 3000, 0.6, 0.08 * k, pn, 0.05, 0.05);
  }

  /** Выброс с каретки: нарастающий свист воздуха, удар, тишина (фон гаснет). */
  thrown(fall: number) {
    if (!this.ctx) return;
    this.counters.thrown++;
    const ctx = this.ctx;
    const e = this.listener;
    const pn = this.panner({ x: e.x, y: e.y + 0.3, z: e.z }, 1, 0.5);
    this.out(pn, 0.5);
    const w = this.burst(this.noise, fall + 0.6, 'bandpass', 400, 1.2, 0.7, pn, 0, fall * 0.8);
    w.flt.frequency.exponentialRampToValueAtTime(1600, w.t + fall);
    this.tone('sine', 52, 26, 1.2, 1, pn, fall + 0.25, 0.003);
    this.burst(this.brown, 0.6, 'lowpass', 300, 0.7, 1, pn, fall + 0.25, 0.003);
    const t = ctx.currentTime;
    this.amb.gain.cancelScheduledValues(t);
    this.amb.gain.setValueAtTime(1, t);
    this.amb.gain.linearRampToValueAtTime(0.0001, t + fall + 0.5);
    if (this.motor) this.motor.gain.gain.setTargetAtTime(0, t, 0.3);
    if (this.lair) this.lair.gain.gain.setTargetAtTime(0, t + fall, 0.2);
  }

  /** Новая попытка: фон и гул логова обратно. */
  reset() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.amb.gain.cancelScheduledValues(t);
    this.amb.gain.setTargetAtTime(1, t, 0.4);
    if (this.lair) {
      this.lair.gain.gain.cancelScheduledValues(t);
      this.lair.gain.gain.setTargetAtTime(0.55, t, 0.6);
    }
  }

  /** Складная решётка: дребезг звеньев и скрежет; закрылась — лязг. */
  gate(open: boolean, at: V3) {
    if (!this.ctx) return;
    this.counters.gate++;
    const pn = this.panner(at, 1.3, 1);
    this.out(pn, 0.6);
    for (let k = 0; k < 9; k++) this.burst(this.noise, 0.025, 'bandpass', rnd(2000, 3200), 4, 0.12, pn, k * rnd(0.04, 0.06), 0.001);
    const sc = this.burst(this.noise, 0.5, 'bandpass', 1100, 6, 0.08, pn, 0, 0.1);
    sc.flt.frequency.linearRampToValueAtTime(open ? 1500 : 800, sc.t + 0.5);
    if (!open) this.clang(pn, 260, 0.3, 0.5, 0.5);
  }

  /** Рычаг: щелчки храповика, лязг. */
  lever(at: V3, stuck = false) {
    if (!this.ctx) return;
    this.counters.lever++;
    const pn = this.panner(at, 1, 1);
    this.out(pn, 0.5);
    for (let k = 0; k < 3; k++) this.burst(this.noise, 0.02, 'bandpass', 2600, 3, 0.2, pn, k * 0.05, 0.001);
    this.clang(pn, stuck ? 340 : 420, 0.18, 0.35, 0.16);
    if (stuck) this.tone('sine', 90, 60, 0.2, 0.3, pn, 0.16);
  }

  /** Шаг: по доскам каретки (полый стук, иногда скрип), по железу клетки (лязг) или по бетону. */
  step(p: V3, loud = 1, surface: 'wood' | 'metal' | 'concrete' = 'concrete') {
    if (!this.ctx || !this.running) return;
    this.counters.step++;
    const pn = this.panner(p, 1, 1);
    this.out(pn, 0.5);
    if (surface === 'wood') {
      this.burst(this.brown, 0.14, 'bandpass', rnd(240, 340), 1.5, 0.28 * loud, pn);
      if (Math.random() < 0.3) {
        const c = this.burst(this.noise, 0.25, 'bandpass', rnd(500, 800), 18, 0.06 * loud, pn, 0.03, 0.06);
        c.flt.frequency.linearRampToValueAtTime(rnd(900, 1200), c.t + 0.25);
      }
    } else if (surface === 'metal') {
      this.burst(this.brown, 0.1, 'lowpass', 500, 0.7, 0.2 * loud, pn);
      this.clang(pn, rnd(300, 420), 0.05 * loud, 0.18);
    } else {
      this.burst(this.brown, 0.12, 'lowpass', rnd(380, 520), 0.7, 0.16 * loud, pn);
      this.burst(this.noise, 0.05, 'highpass', 3000, 0.7, 0.012 * loud, pn);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.motor = null;
    this.scrape = null;
    this.lair = null;
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

/** Отклик шахты: частые ранние отражения от близких стен (труба 2.6 м) и длинный хвост вверх-вниз. */
function impulse(ctx: AudioContext, sec: number): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * sec);
  const b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < n; i++) {
      const t = i / n;
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.6) * 0.5;
    }
    // флаттер-эхо между стенами шахты (≈ 7.6 мс) — металлический призвук трубы
    for (let k = 1; k < 24; k++) {
      const i = Math.floor(((7.6 * k) / 1000) * ctx.sampleRate) + c * 5;
      if (i < n) d[i] += (k % 2 ? -1 : 1) * 0.45 * Math.pow(0.86, k);
    }
  }
  return b;
}
