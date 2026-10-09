// Звук земляного погреба — процедурный WebAudio, без файлов (по образцу ./snowAudio.ts):
//  • фон: очень низкий глухой гул толщи земли (бурый шум, низкий фильтр, медленное «дыхание»), изредка — где-то
//    оседает земля (мягкий глухой «вумф»);
//  • шаги — глухо по утоптанной земле; боком в щели — шарканье приставного шага, плечо скребёт по стене (шорох по
//    шагу), дыхание тяжелее и чаще (в тесноте), со стороны щели;
//  • осыпь: шипение струйки земли и дробь комочков — со стороны осыпи; комок — глухой шлепок;
//  • обвал: скрип крепей (дерево), треск — щелчки учащаются к обвалу, низкий стон толщи; со стороны места обвала;
//    обвал — тяжёлый глухой удар и сыплется; засыпан — всё глохнет (низкий фильтр на выходе), сердце и дыхание;
//    откопка — хруст земли под руками.
// AudioContext — только по жесту пользователя (политика автоплея): start() из нажатия клавиши / клика.
// Выключить — localStorage 'room-forge/cellar-sound' = '0' (CELLAR_SOUND_KEY).

export const CELLAR_SOUND_KEY = 'room-forge/cellar-sound';

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

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

/** Земляная нора: очень короткий глухой отклик (земля глушит, эха нет). */
function impulse(ctx: AudioContext, sec: number): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * sec);
  const b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 5) * 0.3;
  }
  return b;
}

/** Кадр звука: что делает игрок. */
export interface CellarSoundFrame {
  /** пройдено за кадр, м */
  moved: number;
  /** боком в щели */
  side: boolean;
  /** начался приставной шаг (боком) */
  step: boolean;
  /** засыпан */
  buried: boolean;
  /** треск перед обвалом 0…1 (null — нет) и сторона (−1 слева … 1 справа) */
  crack: number | null;
  crackPan: number;
}

export class CellarAudio {
  ctx: AudioContext | null = null;
  enabled: boolean;
  /** счётчики событий (QA) */
  readonly counters = { step: 0, scrape: 0, breath: 0, trickle: 0, clod: 0, creak: 0, crack: 0, fall: 0, dig: 0, settle: 0 };
  private master!: GainNode;
  private muffle!: BiquadFilterNode;
  private sfx!: GainNode;
  private wet!: GainNode;
  private amb!: GainNode;
  private noise!: AudioBuffer;
  private brown!: AudioBuffer;
  private groan: { osc: OscillatorNode; g: GainNode; pan: StereoPannerNode } | null = null;
  private walked = 0;
  private breathIn = 0;
  private heartIn = 0;
  private settleIn = rnd(8, 18);
  private crackIn = 0;
  private creakIn = 0;
  /** теснота 0…1 (сглажено): дыхание тяжелее */
  private tight = 0;
  private inCellar = false;
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
    try {
      localStorage.setItem(CELLAR_SOUND_KEY, on ? '1' : '0');
    } catch {}
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(on && this.inCellar ? 0.85 : 0, this.ctx.currentTime, 0.1);
  }

  /** Игрок в погребе / вне его (вне — тишина, контекст живёт). */
  setInCellar(on: boolean) {
    if (on === this.inCellar) return;
    this.inCellar = on;
    if (this.ctx) this.master.gain.setTargetAtTime(on && this.enabled ? 0.85 : 0, this.ctx.currentTime, on ? 0.6 : 0.25);
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
    conv.buffer = impulse(ctx, 0.3);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.3;
    this.wet.connect(conv);
    conv.connect(this.master);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.sfx.connect(this.wet);
    this.amb = ctx.createGain();
    this.amb.connect(this.master);
    this.noise = noiseBuffer(ctx, 3, false);
    this.brown = noiseBuffer(ctx, 4, true);
    // гул толщи земли: очень низко, глухо, медленно «дышит»
    const s = ctx.createBufferSource();
    s.buffer = this.brown;
    s.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 85;
    const g = ctx.createGain();
    g.gain.value = 0.2;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.035;
    const lg = ctx.createGain();
    lg.gain.value = 0.07;
    lfo.connect(lg).connect(g.gain);
    s.connect(lp).connect(g).connect(this.amb);
    s.start();
    lfo.start();
    this.setEnabled(this.enabled);
  }

  /** Короткий шум через фильтр: тип, частота, добротность, громкость, длительность, выход, панорама, задержка. */
  private burst(buf: AudioBuffer, type: BiquadFilterType, f: number, q: number, gain: number, dur: number, out: AudioNode = this.sfx, pan = 0, at = 0, f1?: number) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + at;
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.playbackRate.value = rnd(0.85, 1.15);
    const flt = ctx.createBiquadFilter();
    flt.type = type;
    flt.frequency.setValueAtTime(f, t);
    if (f1) flt.frequency.exponentialRampToValueAtTime(f1, t + dur);
    flt.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + Math.min(0.012, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    s.connect(flt).connect(g).connect(p).connect(out);
    s.start(t, rnd(0, Math.max(0, buf.duration - dur - 0.05)));
    s.stop(t + dur + 0.05);
  }

  /** Шумовой «пуф» с плавной атакой: вдох / выдох, шорох. */
  private puff(t0: number, dur: number, f0: number, f1: number, q: number, peak: number, attack: number, pan = 0, out: AudioNode = this.master) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + t0;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    s.playbackRate.value = rnd(0.9, 1.1);
    const flt = ctx.createBiquadFilter();
    flt.type = 'bandpass';
    flt.Q.value = q;
    flt.frequency.setValueAtTime(f0, t);
    flt.frequency.linearRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + dur * attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    s.connect(flt).connect(g).connect(p).connect(out);
    s.start(t, rnd(0, Math.max(0, this.noise.duration - dur - 0.05)));
    s.stop(t + dur + 0.05);
  }

  /** Кадр: шаги, шарканье и дыхание боком, треск перед обвалом, засыпан. */
  update(dt: number, f: CellarSoundFrame) {
    if (!this.running || !this.inCellar) return;
    const ctx = this.ctx!;
    this.tight += ((f.side ? 1 : 0) - this.tight) * Math.min(1, dt * (f.side ? 1.5 : 0.4));
    // шаги: прямо — глухо по земле каждые 0.62 м; боком — шарканье на каждый приставной шаг + плечо по стене
    if (!f.buried) {
      if (f.side) {
        this.walked = 0;
        if (f.step) {
          this.counters.step++;
          this.counters.scrape++;
          this.burst(this.noise, 'bandpass', rnd(380, 520), 1.1, 0.16, 0.2, this.sfx, rnd(-0.15, 0.15));
          // плечо (ватник) по сырой земле: шорох со сдвигом частоты
          this.burst(this.noise, 'bandpass', rnd(1300, 1700), 1.4, 0.07, 0.32, this.sfx, rnd(-0.5, 0.5), 0.04, rnd(700, 900));
        }
      } else if (f.moved > 0) {
        this.walked += f.moved;
        if (this.walked >= 0.62) {
          this.walked = 0;
          this.counters.step++;
          this.burst(this.noise, 'bandpass', rnd(240, 360), 0.9, 0.2, 0.14, this.sfx, rnd(-0.2, 0.2));
          this.burst(this.noise, 'highpass', rnd(2400, 3600), 0.8, 0.025, 0.06, this.sfx, rnd(-0.3, 0.3), 0.02);
        }
      }
    }
    // дыхание: в тесноте — тяжелее и чаще; засыпан — своё (с сердцем)
    if (this.tight > 0.05 && !f.buried) {
      this.breathIn -= dt;
      if (this.breathIn <= 0) {
        const k = this.tight;
        const period = 2.4 - 0.7 * k * (f.moved > 0 ? 1 : 0.6);
        this.breathIn = period;
        this.counters.breath++;
        this.puff(0.01, 0.36 * period, 1050, 1500, 1.2, 0.06 + 0.1 * k, 0.45);
        this.puff(0.01 + 0.45 * period, 0.48 * period, 820, 460, 0.8, 0.09 + 0.14 * k, 0.15);
      }
    }
    // где-то оседает земля
    this.settleIn -= dt;
    if (this.settleIn <= 0) {
      this.settleIn = rnd(9, 22);
      this.counters.settle++;
      this.burst(this.brown, 'lowpass', 110, 0.7, 0.32, 1.1, this.amb, rnd(-0.8, 0.8));
      for (let i = 0; i < 3; i++) this.burst(this.noise, 'bandpass', rnd(1800, 3200), 1.4, 0.015, 0.05, this.amb, rnd(-0.8, 0.8), 0.3 + i * rnd(0.1, 0.3));
    }
    // треск крепей: щелчки учащаются к обвалу, скрип дерева, низкий стон толщи
    if (f.crack !== null) {
      this.crackIn -= dt;
      if (this.crackIn <= 0) {
        this.crackIn = Math.max(0.05, 0.4 * (1 - f.crack) + rnd(0, 0.1));
        this.counters.crack++;
        this.burst(this.noise, 'bandpass', rnd(900, 1800), 2.2, 0.16 + 0.35 * f.crack, 0.035, this.sfx, f.crackPan);
      }
      this.creakIn -= dt;
      if (this.creakIn <= 0) {
        this.creakIn = rnd(0.5, 0.9) * (1 - 0.5 * f.crack);
        this.creak(f.crackPan, 0.5 + 0.5 * f.crack);
      }
      if (!this.groan) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = 38;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 140;
        const g = ctx.createGain();
        g.gain.value = 0;
        const pan = ctx.createStereoPanner();
        osc.connect(lp).connect(g).connect(pan).connect(this.sfx);
        osc.start();
        this.groan = { osc, g, pan };
      }
      this.groan.g.gain.setTargetAtTime(0.05 + 0.13 * f.crack, ctx.currentTime, 0.1);
      this.groan.osc.frequency.setTargetAtTime(38 + 18 * f.crack, ctx.currentTime, 0.2);
      this.groan.pan.pan.setTargetAtTime(f.crackPan, ctx.currentTime, 0.1);
    } else if (this.groan) {
      const gr = this.groan;
      this.groan = null;
      gr.g.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
      gr.osc.stop(ctx.currentTime + 0.4);
    }
    // засыпан: всё глохнет, сердце и дыхание
    this.muffle.frequency.setTargetAtTime(f.buried ? 260 : 18000, ctx.currentTime, f.buried ? 0.05 : 0.4);
    if (f.buried) {
      this.heartIn -= dt;
      if (this.heartIn <= 0) {
        this.heartIn = 0.8;
        this.thump(0, 0.5);
        this.thump(0.18, 0.35);
        this.puff(0.3, 0.5, 520, 480, 0.9, 0.07, 0.4);
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

  /** Скрип крепи (дерево под нагрузкой): пила через полосовой фильтр, высота «плавает». */
  private creak(pan: number, k: number) {
    const ctx = this.ctx!;
    this.counters.creak++;
    const t = ctx.currentTime;
    const dur = rnd(0.35, 0.8);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const f0 = rnd(95, 170);
    o.frequency.setValueAtTime(f0, t);
    o.frequency.linearRampToValueAtTime(f0 * rnd(0.8, 1.25), t + dur * 0.5);
    o.frequency.linearRampToValueAtTime(f0 * rnd(0.75, 1.1), t + dur);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = rnd(600, 1100);
    bp.Q.value = 4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05 * k, t + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    o.connect(bp).connect(g).connect(p).connect(this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** Осыпь: шипение струйки земли и дробь комочков (k — сила 0…1, pan — сторона). */
  trickle(pan: number, k = 1) {
    if (!this.running || !this.inCellar) return;
    this.counters.trickle++;
    const dur = rnd(0.7, 1.4);
    this.puff(0, dur, rnd(3200, 4200), rnd(2200, 2800), 0.7, 0.035 * k, 0.25, pan, this.sfx);
    const n = 4 + Math.round(6 * k);
    for (let i = 0; i < n; i++) this.burst(this.noise, 'bandpass', rnd(1400, 2800), 1.6, 0.03 * k, 0.03, this.sfx, pan + rnd(-0.2, 0.2), rnd(0.05, dur));
  }

  /** Комок земли упал: глухой шлепок. */
  clod(pan: number) {
    if (!this.running || !this.inCellar) return;
    this.counters.clod++;
    this.burst(this.noise, 'lowpass', 420, 0.8, 0.22, 0.12, this.sfx, pan);
    this.burst(this.noise, 'bandpass', rnd(1500, 2300), 1.2, 0.05, 0.05, this.sfx, pan, 0.03);
  }

  /** Обвал: тяжёлый глухой удар толщи, сыплется земля, комья. */
  fall(pan: number, near: boolean) {
    if (!this.running) return;
    this.counters.fall++;
    const k = near ? 1 : 0.6;
    this.burst(this.brown, 'lowpass', 90, 0.8, 0.95 * k, 1.5, this.sfx, pan);
    this.burst(this.noise, 'bandpass', 520, 0.7, 0.32 * k, 0.8, this.sfx, pan, 0.05);
    this.puff(0.15, 2.2, 3000, 1800, 0.6, 0.06 * k, 0.15, pan, this.sfx);
    for (let i = 0; i < 9; i++) this.burst(this.noise, 'lowpass', rnd(350, 600), 0.8, 0.12 * k, 0.1, this.sfx, pan + rnd(-0.3, 0.3), 0.2 + i * rnd(0.08, 0.22));
  }

  /** Откопка: хруст земли под руками. */
  dig() {
    if (!this.running) return;
    this.counters.dig++;
    this.burst(this.noise, 'bandpass', rnd(500, 800), 1, 0.3, 0.2);
    this.burst(this.noise, 'bandpass', rnd(1800, 2600), 1.4, 0.06, 0.08, this.sfx, rnd(-0.3, 0.3), 0.05);
  }

  dispose() {
    this.disposed = true;
    void this.ctx?.close();
    this.ctx = null;
  }
}
