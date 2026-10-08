// Звук спец-локации «Ангар» — процедурный WebAudio, без файлов (по образцу liftAudio.ts):
//  • падение: свист воздуха нарастает, удар о кучу металлолома (негармонические обертоны, грохот, дребезг), звон в
//    ушах после удара;
//  • цех: гул машин (низкие пилы), роликовый конвейер (стук), вентиляторы (шум с биением лопастей), гудение натриевых
//    ламп, печь — рёв огня (громче рядом), редкие далёкие лязги железа; гулкое эхо цеха;
//  • зона мини-босса: низкий гул и скрип цепи качающегося крюка (громче под талью);
//  • шаги: бетон, по куче — железо.
// Источники — по расстоянию до игрока и стороне (панорама по направлению взгляда), без PannerNode.
// AudioContext — по жесту (клик / клавиша; удар по пятну — тоже жест).

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

type P2 = { x: number; z: number };

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

/** Цех: большой гулкий объём, хвост 2.4 с. */
function impulse(ctx: AudioContext, sec: number): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * sec);
  const b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.2) * 0.4;
  }
  return b;
}

/** Слой у источника: громкость по расстоянию, сторона по взгляду. */
interface Spot {
  at: P2;
  g: GainNode;
  pan: StereoPannerNode;
  base: number;
  /** расстояние, на котором громкость падает вдвое */
  half: number;
}

export interface HangarAudioFrame {
  pos: P2;
  yaw: number;
  /** фаза сцены: падение / цех */
  falling: boolean;
  /** 0…1 — доля падения (свист) */
  fallK: number;
  /** игрок идёт (м/с) и по чему */
  speed: number;
  metal: boolean;
  /** у тали (зона мини-босса) */
  boss: boolean;
}

export class HangarAudio {
  ctx: AudioContext | null = null;
  enabled: boolean;
  readonly counters = { clank: 0, step: 0, land: 0 };
  private master!: GainNode;
  private sfx!: GainNode;
  private wet!: GainNode;
  private noise!: AudioBuffer;
  private brown!: AudioBuffer;
  private spots: Spot[] = [];
  private whoosh: { g: GainNode; f: BiquadFilterNode } | null = null;
  private ring: GainNode | null = null;
  private drone: GainNode | null = null;
  private clankIn = rnd(2, 5);
  private chainIn = 1;
  private stepAcc = 0;
  private disposed = false;

  constructor(
    enabled = true,
    private readonly layout: { furnace: P2; fans: P2[]; conveyor: P2; hook: P2; machines: P2 } = {
      furnace: { x: 6, z: -1.5 }, fans: [{ x: -4.5, z: -14 }, { x: 4.5, z: -14 }], conveyor: { x: -5.6, z: 2 }, hook: { x: 0, z: 10.5 }, machines: { x: 5.6, z: -9 },
    },
  ) {
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
    if (this.ctx) this.master.gain.setTargetAtTime(on ? 0.8 : 0, this.ctx.currentTime, 0.1);
  }

  private build() {
    const ctx = this.ctx!;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 0.8 : 0;
    this.master.connect(comp);
    const conv = ctx.createConvolver();
    conv.buffer = impulse(ctx, 2.4);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.45;
    this.wet.connect(conv);
    conv.connect(this.master);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.sfx.connect(this.wet);
    this.noise = noiseBuffer(ctx, 3, false);
    this.brown = noiseBuffer(ctx, 4, true);
    const L = this.layout;
    // гул машин: две низкие пилы (50 и 100 Гц) через низкий фильтр — у передачи
    {
      const out = this.spot(L.machines, 0.09, 9);
      for (const [f, gg] of [[50, 1], [100.7, 0.5]] as const) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 220;
        const g = ctx.createGain();
        g.gain.value = gg;
        o.connect(lp).connect(g).connect(out);
        o.start();
      }
    }
    // печь: рёв огня
    this.loopTo(this.brown, 'lowpass', 300, 0.7, 1, this.spot(L.furnace, 0.32, 3.5));
    // вентиляторы: полоса шума с биением лопастей
    for (const p of L.fans) {
      const out = this.spot(p, 0.12, 5);
      const g = this.loopTo(this.noise, 'bandpass', 900, 0.9, 1, out);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 22;
      const lg = ctx.createGain();
      lg.gain.value = 0.45;
      lfo.connect(lg).connect(g.gain);
      lfo.start();
    }
    // конвейер: частый стук роликов
    {
      const out = this.spot(L.conveyor, 0.08, 4);
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = 9;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 600;
      bp.Q.value = 3;
      o.connect(bp).connect(out);
      o.start();
    }
    // натриевые лампы: тихое гудение 100 Гц по всему цеху
    {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = 100;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 400;
      const g = ctx.createGain();
      g.gain.value = 0.006;
      o.connect(lp).connect(g).connect(this.master);
      o.start();
    }
    // зона мини-босса: низкий гул (вступает у тали)
    {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 36;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 140;
      const g = (this.drone = ctx.createGain());
      g.gain.value = 0;
      o.connect(lp).connect(g).connect(this.master);
      o.start();
    }
  }

  private spot(at: P2, base: number, half: number): GainNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = 0;
    const pan = ctx.createStereoPanner();
    g.connect(pan).connect(this.master);
    pan.connect(this.wet);
    this.spots.push({ at, g, pan, base, half });
    return g;
  }

  private loopTo(buf: AudioBuffer, type: BiquadFilterType, f: number, q: number, gain: number, out: AudioNode): GainNode {
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
    s.connect(flt).connect(g).connect(out);
    s.start(0, Math.random() * buf.duration);
    return g;
  }

  private burst(buf: AudioBuffer, type: BiquadFilterType, f: number, q: number, gain: number, dur: number, pan = 0, at = 0) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + at;
    const s = ctx.createBufferSource();
    s.buffer = buf;
    const flt = ctx.createBiquadFilter();
    flt.type = type;
    flt.frequency.value = f;
    flt.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + Math.min(0.01, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    s.connect(flt).connect(g).connect(p).connect(this.sfx);
    s.start(t, rnd(0, buf.duration - dur - 0.05));
    s.stop(t + dur + 0.05);
  }

  /** Металл: негармонические обертоны с быстрым затуханием. */
  private metal(gain: number, f0: number, dur: number, pan = 0, at = 0) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + at;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(this.sfx);
    for (const [k, a] of [[1, 1], [2.76, 0.6], [5.4, 0.4], [8.93, 0.25]] as const) {
      const o = ctx.createOscillator();
      o.frequency.value = f0 * k * rnd(0.98, 1.02);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain * a, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur / k ** 0.3);
      o.connect(g).connect(p);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  private panOf(at: P2, f: HangarAudioFrame): number {
    const dx = at.x - f.pos.x, dz = at.z - f.pos.z, l = Math.hypot(dx, dz) || 1;
    return (dx / l) * Math.cos(f.yaw) - (dz / l) * Math.sin(f.yaw);
  }

  update(dt: number, f: HangarAudioFrame) {
    if (!this.running) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    for (const s of this.spots) {
      const d = Math.hypot(s.at.x - f.pos.x, s.at.z - f.pos.z);
      s.g.gain.setTargetAtTime(s.base / (1 + (d / s.half) ** 2) * (f.falling ? 0.5 : 1), t, 0.1);
      s.pan.pan.setTargetAtTime(this.panOf(s.at, f) * 0.8, t, 0.1);
    }
    // свист падения
    if (f.falling && f.fallK > 0) {
      if (!this.whoosh) {
        const s = ctx.createBufferSource();
        s.buffer = this.noise;
        s.loop = true;
        const flt = ctx.createBiquadFilter();
        flt.type = 'bandpass';
        flt.Q.value = 0.8;
        const g = ctx.createGain();
        g.gain.value = 0;
        s.connect(flt).connect(g).connect(this.master);
        s.start();
        this.whoosh = { g, f: flt };
      }
      this.whoosh.g.gain.setTargetAtTime(0.05 + 0.3 * f.fallK, t, 0.05);
      this.whoosh.f.frequency.setTargetAtTime(500 + 2500 * f.fallK, t, 0.05);
    } else if (this.whoosh) {
      this.whoosh.g.gain.setTargetAtTime(0, t, 0.03);
      this.whoosh = null;
    }
    // далёкие лязги
    this.clankIn -= dt;
    if (this.clankIn <= 0 && !f.falling) {
      this.clankIn = rnd(3, 9);
      this.counters.clank++;
      this.metal(rnd(0.04, 0.1), rnd(180, 420), rnd(1.2, 2.2), rnd(-0.9, 0.9));
    }
    // мини-босс: гул и скрип цепи крюка
    if (this.drone) this.drone.gain.setTargetAtTime(f.boss ? 0.12 : 0, t, 0.6);
    if (f.boss) {
      this.chainIn -= dt;
      if (this.chainIn <= 0) {
        this.chainIn = rnd(1.4, 2.6);
        const pan = this.panOf(this.layout.hook, f);
        this.burst(this.noise, 'bandpass', rnd(1800, 2600), 6, 0.06, 0.5, pan);
        this.metal(0.03, rnd(900, 1300), 0.4, pan, 0.1);
      }
    }
    // шаги
    if (f.speed > 0.2 && !f.falling) {
      this.stepAcc += f.speed * dt;
      if (this.stepAcc >= 0.75) {
        this.stepAcc = 0;
        this.counters.step++;
        if (f.metal) {
          this.metal(0.05, rnd(320, 520), 0.35, rnd(-0.2, 0.2));
          this.burst(this.noise, 'bandpass', 2400, 1, 0.05, 0.08);
        } else this.burst(this.noise, 'bandpass', rnd(500, 800), 1.2, 0.12, 0.09, rnd(-0.2, 0.2));
      }
    }
  }

  /** Удар о кучу: грохот, железо, дребезг, звон в ушах. */
  land() {
    if (!this.running) return;
    this.counters.land++;
    this.burst(this.brown, 'lowpass', 140, 0.8, 1, 0.9);
    this.metal(0.35, 140, 1.8, -0.2);
    this.metal(0.25, 230, 1.4, 0.3, 0.03);
    for (let i = 0; i < 7; i++) this.metal(0.08, rnd(400, 900), 0.5, rnd(-0.7, 0.7), 0.08 + i * rnd(0.05, 0.15));
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.value = 3900;
    const g = (this.ring = ctx.createGain());
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.025, t + 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 4);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 4.1);
  }

  dispose() {
    this.disposed = true;
    void this.ctx?.close();
    this.ctx = null;
  }
}
