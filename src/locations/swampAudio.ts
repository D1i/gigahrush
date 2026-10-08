// Звук финала «Болото на крыше» — процедурный WebAudio, без файлов (по образцу liftAudio.ts).
//  • крыша: морось (полоса шума), далёкий гул завода снизу, стон огромной шестерни — рывок на каждый зуб (низкая пила
//    с биением + скрежет), бульканье грязи;
//  • сценарий: лязг под ногами, скрежет и хлюп, когда зуб давит; под грязью — всё глохнет (фильтр), сердце; всплытие —
//    плеск и судорожный вдох; ползком — шлепки по воде;
//  • у части: лягушки, ветер в камыше, далёкая радиоточка (простой позывной сквозь треск), гул прожектора.
// AudioContext создаётся только по жесту пользователя (политика автоплея) — start() из клика.

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export type SwampSfx = 'step' | 'clunk' | 'press' | 'squelch' | 'splash' | 'gasp' | 'paddle' | 'beam';

export class SwampAudio {
  ctx: AudioContext | null = null;
  readonly counters: Record<SwampSfx | 'tooth' | 'heart', number> = { step: 0, clunk: 0, press: 0, squelch: 0, splash: 0, gasp: 0, paddle: 0, beam: 0, tooth: 0, heart: 0 };
  private master!: GainNode;
  /** «глушилка» — всё, кроме сердца, идёт через неё (под грязью — низы) */
  private muffle!: BiquadFilterNode;
  private bus!: GainNode;
  private noise!: AudioBuffer;
  private roofAmb: GainNode | null = null;
  private baseAmb: GainNode | null = null;
  private radio: GainNode | null = null;
  private gearGain: GainNode | null = null;
  private heartIn = 0;
  private heartRate = 0;
  private frogIn = 1;
  private radioStep = 0;
  private radioIn = 0;
  private disposed = false;

  constructor(readonly enabled = true) {}

  start() {
    if (!this.enabled || this.disposed) return;
    // контекст без жеста пользователя создаётся приостановленным — будим при каждом клике
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(ctx.destination);
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 18000;
    this.muffle.connect(this.master);
    this.bus = ctx.createGain();
    this.bus.connect(this.muffle);
    const n = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    this.roof();
  }

  private loopNoise(type: BiquadFilterType, freq: number, q: number, gain: number, out: AudioNode): GainNode {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(f).connect(g).connect(out);
    src.start();
    return g;
  }

  /** Крыша: морось, гул завода, шестерня. */
  roof() {
    const ctx = this.ctx;
    if (!ctx || this.roofAmb) return;
    const amb = (this.roofAmb = ctx.createGain());
    amb.gain.value = 1;
    amb.connect(this.bus);
    this.loopNoise('highpass', 2600, 0.4, 0.05, amb); // морось
    this.loopNoise('bandpass', 900, 0.8, 0.02, amb); // капли по железу
    this.loopNoise('lowpass', 120, 0.7, 0.35, amb); // гул завода снизу
    const hum = ctx.createOscillator();
    hum.type = 'sawtooth';
    hum.frequency.value = 47;
    const hf = ctx.createBiquadFilter();
    hf.type = 'lowpass';
    hf.frequency.value = 160;
    const hg = (this.gearGain = ctx.createGain());
    hg.gain.value = 0.05;
    hum.connect(hf).connect(hg).connect(amb);
    hum.start();
  }

  /** У части: лягушки, ветер, радиоточка. Крыша гаснет. */
  base() {
    const ctx = this.ctx;
    if (!ctx || this.baseAmb) return;
    const t = ctx.currentTime;
    if (this.roofAmb) {
      this.roofAmb.gain.setTargetAtTime(0, t, 0.2);
      const old = this.roofAmb;
      setTimeout(() => old.disconnect(), 2000);
      this.roofAmb = null;
    }
    const amb = (this.baseAmb = ctx.createGain());
    amb.gain.value = 0;
    amb.gain.setTargetAtTime(1, t, 0.8);
    amb.connect(this.bus);
    this.loopNoise('bandpass', 420, 0.6, 0.05, amb); // ветер в камыше
    this.loopNoise('highpass', 3200, 0.5, 0.015, amb); // морось
    const radio = (this.radio = ctx.createGain());
    radio.gain.value = 0.0;
    radio.connect(amb);
    this.loopNoise('bandpass', 1800, 2.5, 0.012, radio); // треск эфира
  }

  /** Глушилка 0…1 (1 — под грязью) и рывок шестерни 0…1. */
  frame(dt: number, f: { muffle: number; heart: number; gear: number; radio: number }) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.muffle.frequency.setTargetAtTime(18000 * Math.pow(1 - clamp01(f.muffle) * 0.985, 2) + 140, t, 0.08);
    if (this.gearGain) this.gearGain.gain.setTargetAtTime(0.04 + 0.22 * clamp01(f.gear), t, 0.1);
    // сердце: удар-пара «тук-тук», темп от 0 (нет) до 1 (часто)
    this.heartRate = f.heart;
    if (f.heart > 0.01) {
      this.heartIn -= dt;
      if (this.heartIn <= 0) {
        this.heartIn = 60 / (58 + 70 * f.heart);
        this.heartbeat(0.5 + 0.5 * f.heart);
      }
    }
    if (this.radio) {
      this.radio.gain.setTargetAtTime(0.9 * clamp01(f.radio), t, 0.5);
      this.radioIn -= dt;
      if (f.radio > 0.05 && this.radioIn <= 0) this.radioNote();
    }
    if (this.baseAmb) {
      this.frogIn -= dt;
      if (this.frogIn <= 0) {
        this.frogIn = rnd(0.25, 1.4);
        this.frog();
      }
    }
  }

  /** Рывок шестерни на зуб (на крыше): стон + скрежет. */
  tooth(gain = 1) {
    const ctx = this.ctx;
    if (!ctx || !this.roofAmb) return;
    this.counters.tooth++;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(38, t);
    o.frequency.linearRampToValueAtTime(31, t + 0.9);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 260;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.35 * gain, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
    o.connect(f).connect(g).connect(this.roofAmb);
    o.start(t);
    o.stop(t + 1.2);
    this.burst('bandpass', 1400, 3, 0.09 * gain, 0.5, this.roofAmb);
  }

  sfx(kind: SwampSfx) {
    const ctx = this.ctx;
    if (!ctx) return;
    this.counters[kind]++;
    const t = ctx.currentTime;
    switch (kind) {
      case 'step':
        this.burst('lowpass', 500, 0.7, 0.12, 0.18);
        break;
      case 'clunk': {
        // лязг железа под ногами — негармонические обертоны
        for (const [fr, a] of [[180, 0.3], [431, 0.18], [977, 0.1]] as const) {
          const o = ctx.createOscillator();
          o.frequency.value = fr;
          const g = ctx.createGain();
          g.gain.setValueAtTime(a, t);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
          o.connect(g).connect(this.bus);
          o.start(t);
          o.stop(t + 1);
        }
        break;
      }
      case 'press':
        this.burst('lowpass', 220, 0.9, 0.6, 2.2);
        this.burst('bandpass', 700, 4, 0.12, 1.8);
        break;
      case 'squelch':
        this.burst('lowpass', 380, 3, 0.4, 0.5);
        break;
      case 'splash':
        this.burst('highpass', 900, 0.5, 0.35, 0.8);
        this.burst('lowpass', 300, 1, 0.3, 0.5);
        break;
      case 'gasp': {
        // судорожный вдох: шум полосой, частота растёт
        const src = ctx.createBufferSource();
        src.buffer = this.noise;
        const f = ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.Q.value = 2.2;
        f.frequency.setValueAtTime(700, t);
        f.frequency.linearRampToValueAtTime(1900, t + 0.55);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.32, t + 0.12);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
        src.connect(f).connect(g).connect(this.bus);
        src.start(t);
        src.stop(t + 0.8);
        break;
      }
      case 'paddle':
        this.burst('bandpass', rnd(500, 900), 1.2, 0.12, 0.3);
        break;
      case 'beam': {
        const o = ctx.createOscillator();
        o.type = 'square';
        o.frequency.value = 100;
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 400;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.08, t + 0.3);
        g.gain.setTargetAtTime(0.05, t + 0.3, 1);
        o.connect(f).connect(g).connect(this.bus);
        o.start(t);
        o.stop(t + 8);
        break;
      }
    }
  }

  private burst(type: BiquadFilterType, freq: number, q: number, gain: number, dur: number, out: AudioNode = this.bus) {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = rnd(0.8, 1.2);
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + Math.min(0.04, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  /** Сердце — мимо глушилки (его слышно изнутри). */
  private heartbeat(a: number) {
    const ctx = this.ctx!;
    this.counters.heart++;
    for (const [dt, k] of [[0, 1], [0.24, 0.7]] as const) {
      const t = ctx.currentTime + dt;
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(62, t);
      o.frequency.exponentialRampToValueAtTime(38, t + 0.18);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.55 * a * k, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
      o.connect(g).connect(this.master);
      o.start(t);
      o.stop(t + 0.3);
    }
  }

  private frog() {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const n = Math.floor(rnd(2, 5));
    const base = rnd(320, 520);
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = base;
      const am = ctx.createOscillator();
      am.frequency.value = rnd(28, 40);
      const amg = ctx.createGain();
      amg.gain.value = 0.5;
      const g = ctx.createGain();
      const t0 = t + i * rnd(0.09, 0.14);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.03, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.09);
      am.connect(amg).connect(g.gain);
      o.connect(g).connect(this.baseAmb!);
      o.start(t0);
      am.start(t0);
      o.stop(t0 + 0.12);
      am.stop(t0 + 0.12);
    }
  }

  /** Радиоточка: простой позывной квадратной волной сквозь полосу (как из уличного репродуктора), по кругу. */
  private radioNote() {
    const ctx = this.ctx!;
    // ноты (полутоны от ля первой октавы) и длительности, доли такта
    const tune: Array<[number, number]> = [[-2, 1], [3, 1], [3, 1], [5, 0.5], [7, 0.5], [3, 2], [-2, 1], [3, 1], [5, 1], [7, 1], [8, 2], [0, 2]];
    const [st, len] = tune[this.radioStep % tune.length];
    this.radioStep++;
    const beat = 0.42;
    this.radioIn = len * beat + (this.radioStep % tune.length === 0 ? 2.5 : 0);
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = 440 * Math.pow(2, st / 12);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1100;
    f.Q.value = 1.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.03);
    g.gain.setTargetAtTime(0.0, t + len * beat * 0.8, 0.05);
    o.connect(f).connect(g).connect(this.radio!);
    o.start(t);
    o.stop(t + len * beat + 0.2);
  }

  /** Для QA: громкость сердца (0 — нет). */
  get heart(): number {
    return this.heartRate;
  }

  dispose() {
    this.disposed = true;
    void this.ctx?.close();
    this.ctx = null;
  }
}
