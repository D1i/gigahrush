// Звук снежных ходов — процедурный WebAudio, без файлов (по образцу src/locations/liftAudio.ts):
//  • фон: глухой ветер над толщей снега (бурый шум, низкий фильтр, медленное «дыхание»), изредка — оседает снег
//    (мягкий «вумф» где-то в толще);
//  • ползком — хруст утрамбованного снега под руками и коленями (чаще и тише), скрючившись — шаг глубже и реже;
//  • обвал: треск свода — щелчки, учащаются к обвалу, низкий стон; со стороны места обвала; обвал — тяжёлый глухой
//    удар, сыплется; засыпан — всё глохнет (низкий фильтр на выходе), слышно своё сердце и дыхание; откопка — хруст;
//  • подтаявший снег: капли (чем ближе к пятну, тем громче), удар по пятну — ледяной треск и хлюпанье, пробил — треск,
//    провал и свист.
// AudioContext — только по жесту пользователя (политика автоплея): start() из нажатия клавиши / клика.

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

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

/** Полость в снегу: короткий плотный отклик без «звона» (снег глушит). */
function impulse(ctx: AudioContext, sec: number): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * sec);
  const b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 4) * 0.35;
  }
  return b;
}

export class SnowAudio {
  ctx: AudioContext | null = null;
  enabled: boolean;
  /** счётчики событий (QA) */
  readonly counters = { crunch: 0, crack: 0, fall: 0, dig: 0, drip: 0, strike: 0, breakIn: 0, settle: 0 };
  private master!: GainNode;
  private muffle!: BiquadFilterNode;
  private sfx!: GainNode;
  private wet!: GainNode;
  private amb!: GainNode;
  private noise!: AudioBuffer;
  private brown!: AudioBuffer;
  private groan: { osc: OscillatorNode; g: GainNode; pan: StereoPannerNode } | null = null;
  private heart = 0;
  private breath = 0;
  private dripIn = 0;
  private settleIn = rnd(5, 12);
  private crackIn = 0;
  private inSnow = false;
  private disposed = false;

  constructor(enabled = true) {
    this.enabled = enabled;
  }

  get running(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  async start(): Promise<void> {
    if (this.disposed) return;
    if (!this.ctx) {
      const AC = (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext;
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

  setEnabled(on: boolean) {
    this.enabled = on;
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(on && this.inSnow ? 0.8 : 0, this.ctx.currentTime, 0.1);
  }

  /** Игрок в снегу / вне его (вне — тишина, контекст живёт). */
  setInSnow(on: boolean) {
    this.inSnow = on;
    if (this.ctx) this.master.gain.setTargetAtTime(on && this.enabled ? 0.8 : 0, this.ctx.currentTime, on ? 0.6 : 0.25);
  }

  private build() {
    const ctx = this.ctx!;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 18000;
    this.muffle.connect(comp);
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(this.muffle);
    const conv = ctx.createConvolver();
    conv.buffer = impulse(ctx, 0.5);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.35;
    this.wet.connect(conv);
    conv.connect(this.master);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.sfx.connect(this.wet);
    this.amb = ctx.createGain();
    this.amb.connect(this.master);
    this.noise = noiseBuffer(ctx, 3, false);
    this.brown = noiseBuffer(ctx, 4, true);
    // ветер над толщей снега: глухо, «дышит»
    const s = ctx.createBufferSource();
    s.buffer = this.brown;
    s.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 160;
    const g = ctx.createGain();
    g.gain.value = 0.16;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const lg = ctx.createGain();
    lg.gain.value = 0.08;
    lfo.connect(lg).connect(g.gain);
    s.connect(lp).connect(g).connect(this.amb);
    s.start();
    lfo.start();
    this.setEnabled(this.enabled);
  }

  /** Короткий шум через фильтр: тип, частота, добротность, громкость, длительность, атака. */
  private burst(buf: AudioBuffer, type: BiquadFilterType, f: number, q: number, gain: number, dur: number, out: AudioNode = this.sfx, pan = 0, at = 0) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + at;
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.playbackRate.value = rnd(0.85, 1.15);
    const flt = ctx.createBiquadFilter();
    flt.type = type;
    flt.frequency.value = f;
    flt.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + Math.min(0.012, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    s.connect(flt).connect(g).connect(p).connect(out);
    s.start(t, rnd(0, buf.duration - dur - 0.05));
    s.stop(t + dur + 0.05);
  }

  /** Кадр: dt, проползено за кадр (м), поза, засыпан, треск 0…1 и сторона обвала (−1 слева … 1 справа), близость к
   *  подтаявшему пятну 0…1 (0 — его нет). */
  update(dt: number, f: { moved: number; crouch: boolean; buried: boolean; crack: number | null; crackPan: number; thaw: number }) {
    if (!this.running || !this.inSnow) return;
    const ctx = this.ctx!;
    // хруст: по пройденному пути (ползком — каждые 0.16 м, скрючившись — 0.45 м)
    if (f.moved > 0 && !f.buried) {
      this.heart += f.moved;
      const step = f.crouch ? 0.45 : 0.16;
      if (this.heart >= step) {
        this.heart = 0;
        this.counters.crunch++;
        if (f.crouch) this.burst(this.noise, 'bandpass', rnd(900, 1300), 1.2, 0.22, 0.16, this.sfx, rnd(-0.2, 0.2));
        else this.burst(this.noise, 'bandpass', rnd(1800, 2800), 1.6, 0.12, 0.07, this.sfx, rnd(-0.35, 0.35));
      }
    }
    // оседает снег где-то в толще
    this.settleIn -= dt;
    if (this.settleIn <= 0) {
      this.settleIn = rnd(7, 16);
      this.counters.settle++;
      this.burst(this.brown, 'lowpass', 140, 0.7, 0.35, 0.9, this.amb, rnd(-0.8, 0.8));
    }
    // треск свода: щелчки учащаются к обвалу, низкий стон
    if (f.crack !== null) {
      this.crackIn -= dt;
      if (this.crackIn <= 0) {
        this.crackIn = Math.max(0.04, 0.35 * (1 - f.crack) + rnd(0, 0.08));
        this.counters.crack++;
        this.burst(this.noise, 'highpass', rnd(1400, 2600), 0.8, 0.18 + 0.4 * f.crack, 0.03, this.sfx, f.crackPan);
      }
      if (!this.groan) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = 48;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 180;
        const g = ctx.createGain();
        g.gain.value = 0;
        const pan = ctx.createStereoPanner();
        osc.connect(lp).connect(g).connect(pan).connect(this.sfx);
        osc.start();
        this.groan = { osc, g, pan };
      }
      this.groan.g.gain.setTargetAtTime(0.05 + 0.12 * f.crack, ctx.currentTime, 0.1);
      this.groan.osc.frequency.setTargetAtTime(48 + 22 * f.crack, ctx.currentTime, 0.2);
      this.groan.pan.pan.setTargetAtTime(f.crackPan, ctx.currentTime, 0.1);
    } else if (this.groan) {
      const gr = this.groan;
      this.groan = null;
      gr.g.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
      gr.osc.stop(ctx.currentTime + 0.4);
    }
    // засыпан: всё глохнет, сердце и дыхание
    this.muffle.frequency.setTargetAtTime(f.buried ? 320 : 18000, ctx.currentTime, f.buried ? 0.05 : 0.4);
    if (f.buried) {
      this.breath -= dt;
      if (this.breath <= 0) {
        this.breath = 0.85;
        // сердце — два глухих удара; дыхание — шум у самого уха
        this.thump(0, 0.5);
        this.thump(0.18, 0.35);
        this.burst(this.noise, 'bandpass', 520, 0.9, 0.08, 0.5, this.master, 0, 0.3);
      }
    }
    // капли у подтаявшего пятна
    if (f.thaw > 0) {
      this.dripIn -= dt;
      if (this.dripIn <= 0) {
        this.dripIn = rnd(0.35, 1.1);
        this.counters.drip++;
        this.plink(0.05 + 0.12 * f.thaw, rnd(-0.5, 0.5));
      }
    }
  }

  private thump(at: number, gain: number) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(70, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.15);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.25);
  }

  /** Капля: короткий тон с падающей высотой. */
  private plink(gain: number, pan: number) {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const f0 = rnd(1300, 2100);
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.55, t + 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    o.connect(g).connect(p).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.15);
  }

  /** Обвал: тяжёлый глухой удар и сыплется. */
  fall(pan: number, near: boolean) {
    if (!this.running) return;
    this.counters.fall++;
    const k = near ? 1 : 0.6;
    this.burst(this.brown, 'lowpass', 110, 0.8, 0.9 * k, 1.3, this.sfx, pan);
    this.burst(this.noise, 'bandpass', 700, 0.7, 0.35 * k, 0.6, this.sfx, pan, 0.05);
    for (let i = 0; i < 6; i++) this.burst(this.noise, 'bandpass', rnd(1500, 3000), 1.2, 0.08 * k, 0.08, this.sfx, pan + rnd(-0.3, 0.3), 0.2 + i * rnd(0.08, 0.2));
  }

  dig() {
    if (!this.running) return;
    this.counters.dig++;
    this.burst(this.noise, 'bandpass', rnd(700, 1100), 1, 0.3, 0.18);
  }

  /** Удар по подтаявшему пятну: ледяной треск и хлюпанье (stage 0…1 — сильнее). */
  strike(stage: number) {
    if (!this.running) return;
    this.counters.strike++;
    this.burst(this.noise, 'highpass', 2200, 0.7, 0.25 + 0.2 * stage, 0.05);
    this.burst(this.noise, 'bandpass', 420, 1.4, 0.3, 0.22, this.sfx, 0, 0.02);
    for (let i = 0; i < 2 + Math.round(stage * 3); i++) this.plink(0.08, rnd(-0.4, 0.4));
  }

  /** Пробил: треск, провал, свист. */
  breakIn() {
    if (!this.running) return;
    this.counters.breakIn++;
    this.burst(this.noise, 'highpass', 1800, 0.6, 0.6, 0.12);
    this.burst(this.brown, 'lowpass', 160, 0.8, 0.8, 0.8, this.sfx, 0, 0.05);
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.5;
    bp.frequency.setValueAtTime(400, t);
    bp.frequency.exponentialRampToValueAtTime(2400, t + 1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3, t + 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    s.connect(bp).connect(g).connect(this.master);
    s.start(t);
    s.stop(t + 1.3);
  }

  dispose() {
    this.disposed = true;
    void this.ctx?.close();
    this.ctx = null;
  }
}
