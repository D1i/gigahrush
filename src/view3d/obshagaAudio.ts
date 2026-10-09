// Звук биома «Общага» — процедурный WebAudio, без файлов (по образцу stairwellAudio.ts / snowAudio.ts).
//  • фон при свете: гул сети 50/100 Гц (трансформатор щитка), дребезжание люминесцентных трубок (доля трубок рядом —
//    `tubes`), всё следует за яркостью ламп (`light`): мигание = «рваный» гул; изредка — жизнь общаги за стенами, очень
//    тихо и глухо: радио (музыка или диктор), бубнёж голосов, смыв унитаза, далёкая дверь, стук по трубам;
//  • блэкаут: щелчок реле, гул срезается мгновенно, звон в ушах и тишина — только своё дыхание, низкий тон помещения
//    и редкий скрип дома; «общага за стенами» (радио, голоса) замирает вместе со светом. Свет вернулся — «пинги»
//    стартёров трубок, гул плавно нарастает, жизнь за стенами возвращается чуть позже;
//  • керосиновая лампа в руке — тихое шипение и трепет пламени у уха (справа), редкие щелчки;
//  • шаги: плитка/линолеум (темп — от скорости), в воде по пояс — плеск, толчок воды, бульки; капли с гулким эхом;
//  • двери: скрип фанерной двери и язычок замка; закрылась сама — мягкий щелчок (жуткий, потому что за спиной); упёрлась;
//  • ХВАТКА: внезапный тяжёлый удар, мясистый хват, одежда, сдавленный вдох — громко; фон глохнет; волочение по плитке
//    (drag каждый кадр); смерть — далёкий хлопок двери, низкий гул, тишина.
//
// ПРАВИЛО ДИЗАЙНА: у «Руки» НЕТ звука движения — ни шороха, ни шагов, ни дыхания. Единственный звук Руки — grab().
// Случайные скрипы дома (creak) сделаны намеренно не связанными с её появлением: ни по времени, ни по месту.
// Интеграции: дверь, из которой выползает Рука, открывать/закрывать БЕЗ doorOpen()/doorClose() (они — для дверей мира);
// на её движение не звать ничего. Только grab() в момент хватки и drag() каждый кадр волочения.
//
// AudioContext создаётся только по жесту пользователя (политика автоплея) — start() из клика / клавиши.
// Координаты — мировые Babylon (как у сцены; x вправо, z вперёд = −план.y), WebAudio правосторонний: z → −z.
// Слушатель: позиция глаз + yaw камеры (rotation.y, радианы): вперёд = (sin yaw, 0, cos yaw).
//
// ИНТЕГРАЦИЯ (кратко):
//   const a = new ObshagaAudio();             // вкл/выкл читает из localStorage 'room-forge/obshaga-sound'
//   a.start();                                // из обработчика клика / клавиши (можно повторно: resume)
//   a.update(dt, { inBiome, light, tubes, moving, speed, inWater, lantern, listener: {x,y,z,yaw}, dead }); // КАЖДЫЙ кадр
//   a.flickerTick(k) — на каждое моргание;   a.blackout() — свет погас;    a.lightsBack() — свет вернулся;
//   a.doorOpen(p) / doorClose(p) / doorBlocked(p) — p в мировых Babylon (центр двери);
//   a.pickupLantern();  a.grab();  a.drag(progress) — каждый кадр волочения;  a.death();  a.dispose().
//   a.setEnabled(on) — кнопка «звук» (сама пишет в localStorage); a.enabled — текущее состояние.

type V3 = { x: number; y: number; z: number };

/** Ключ localStorage: '0' — звук выключен, иначе включён. */
export const OBSHAGA_SOUND_KEY = 'room-forge/obshaga-sound';

export interface ObshagaAudioFrame {
  /** игрок в биоме «Общага»; false — всё плавно затихает */
  inBiome: boolean;
  /** яркость ламп рядом 0…1 (мигание → быстрые скачки; блэкаут → 0) */
  light: number;
  /** доля люминесцентных ламп (трубок) рядом 0…1 — остальные лампы накаливания */
  tubes: number;
  /** игрок идёт; speed — скорость, м/с */
  moving: boolean;
  speed: number;
  /** в воде (подвал по пояс) */
  inWater: boolean;
  /** керосиновая лампа в руках */
  lantern: boolean;
  /** глаза и взгляд (Babylon) */
  listener: { x: number; y: number; z: number; yaw: number };
  /** игрок мёртв — тишина */
  dead: boolean;
}

export interface ObshagaAudioCounters {
  flicker: number;
  blackout: number;
  back: number;
  doorOpen: number;
  doorClose: number;
  doorBlocked: number;
  pickup: number;
  grab: number;
  drag: number;
  death: number;
  step: number;
  dorm: number;
  creak: number;
  drip: number;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const clamp01 = (v: number) => clamp(v, 0, 1);
const pick = <T>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)];
/** NaN/Infinity из кадра не должны дойти до AudioParam (бросает исключение). */
const fin = (v: number, d = 0) => (Number.isFinite(v) ? v : d);

// ───────────────────────── чистые функции (тесты в obshagaAudio.test.ts) ─────────────────────────

/** Секунд между шагами: шаг ≈ 0.62 + 0.09·v м, но не чаще 3 шагов/с и не реже 1.25 с; в воде — на 40% реже. */
export function stepInterval(speed: number, inWater: boolean): number {
  const v = Math.max(0.1, fin(speed));
  const stride = Math.min(1.1, 0.62 + 0.09 * v);
  const t = clamp(stride / v, 0.32, 0.8);
  return inWater ? t * 1.4 : t;
}

/** Громкость шага от скорости (0.5…1.2). */
export function stepLoudness(speed: number): number {
  return clamp(0.5 + 0.2 * fin(speed), 0.5, 1.2);
}

/** Период дыхания, с: в темноте чаще (страх), на ходу ещё чаще. dark 0…1. */
export function breathPeriod(dark: number, speed: number): number {
  const base = lerp(4.2, 3.0, clamp01(dark));
  return clamp(fin(speed) > 0.15 ? base * 0.75 : base, 2.4, 5);
}

/** Плавное приближение к цели с разной постоянной времени вверх и вниз (tau ≤ 0 — мгновенно). */
export function smoothLevel(cur: number, target: number, dt: number, tauUp: number, tauDown: number): number {
  const tau = target > cur ? tauUp : tauDown;
  if (tau <= 0) return target;
  return target + (cur - target) * Math.exp(-Math.max(0, dt) / tau);
}

/** Панорама −1…1 источника p относительно слушателя (yaw Babylon: справа = (cos yaw, −sin yaw)). */
export function panOf(l: { x: number; z: number; yaw: number }, p: { x: number; z: number }): number {
  const dx = p.x - l.x, dz = p.z - l.z, d = Math.hypot(dx, dz);
  if (d < 1e-6) return 0;
  return clamp((dx * Math.cos(l.yaw) - dz * Math.sin(l.yaw)) / d, -1, 1);
}

export interface AmbientIn {
  /** сглаженный уровень «питания» 0…1 (1 — свет есть, 0 — блэкаут) */
  humK: number;
  tubes: number;
  dead: boolean;
  inWater: boolean;
  lantern: boolean;
}

export interface AmbientOut {
  /** гул сети (трансформатор) */
  mains: number;
  /** дребезжание трубок */
  tube: number;
  /** шипение балласта */
  hiss: number;
  /** низкий тон помещения */
  tone: number;
  /** своё дыхание */
  breath: number;
  /** шипение пламени лампы */
  lantern: number;
  /** плеск воды у ног */
  lap: number;
  /** играет ли «жизнь за стенами» */
  dorm: boolean;
  /** интервал между скрипами дома, с */
  creakEvery: [number, number];
}

/** Целевые громкости непрерывных слоёв по состоянию кадра. Мёртвый — тишина; без света — только дыхание и тон. */
export function ambientTargets(a: AmbientIn): AmbientOut {
  if (a.dead) return { mains: 0, tube: 0, hiss: 0, tone: 0, breath: 0, lantern: 0, lap: 0, dorm: false, creakEvery: [20, 40] };
  const lit = clamp01(a.humK), dark = 1 - lit, tubes = clamp01(a.tubes);
  return {
    mains: 0.016 * lit * (1 - 0.3 * tubes),
    tube: 0.03 * lit * tubes,
    hiss: 0.0035 * lit * tubes,
    tone: 0.012 + 0.012 * dark,
    breath: lerp(0.05, 0.3, dark),
    lantern: a.lantern ? 0.035 * (0.5 + 0.5 * dark) : 0,
    lap: a.inWater ? 0.05 : 0,
    dorm: lit > 0.6,
    creakEvery: dark > 0.5 ? [4, 10] : [14, 32],
  };
}

// ───────────────────────── класс ─────────────────────────

export class ObshagaAudio {
  ctx: AudioContext | null = null;
  readonly counters: ObshagaAudioCounters = { flicker: 0, blackout: 0, back: 0, doorOpen: 0, doorClose: 0, doorBlocked: 0, pickup: 0, grab: 0, drag: 0, death: 0, step: 0, dorm: 0, creak: 0, drip: 0 };
  private _enabled: boolean;
  private master!: GainNode;
  private fade!: GainNode;
  private analyser: AnalyserNode | null = null;
  private sfx!: GainNode;
  private amb!: GainNode;
  private wet!: GainNode;
  /** шина «электричества»: радио и жизнь за стенами — гаснет вместе со светом */
  private pwr!: GainNode;
  private noise!: AudioBuffer;
  private brown!: AudioBuffer;
  private listener = { x: 0, y: 1.6, z: 0, yaw: 0 };
  // непрерывные слои
  private mainsG: GainNode | null = null;
  private tubeG: GainNode | null = null;
  private hissG: GainNode | null = null;
  private toneG: GainNode | null = null;
  private breathBus: GainNode | null = null;
  private lanternG: GainNode | null = null;
  private lanternPan: StereoPannerNode | null = null;
  private lapG: GainNode | null = null;
  private ringG: GainNode | null = null;
  private drg: { out: GainNode; flt: BiquadFilterNode; chop: OscillatorNode } | null = null;
  // состояние
  private humK = 1;
  private slowUp = 0;
  private blackedOut = false;
  private lowT = 0;
  private litT = 0;
  private wasDead = false;
  private wasMoving = false;
  private stepT = 0;
  private foot = 0;
  private breathIn = 1.5;
  private dormIn = rnd(4, 9);
  private creakIn = rnd(8, 16);
  private dripIn = 1;
  private sparkIn = 1;
  private grabHold = 0;
  private dragLast = -1;
  private dragThump = 0;
  private disposed = false;

  constructor() {
    let on = true;
    try {
      if (typeof localStorage !== 'undefined') on = localStorage.getItem(OBSHAGA_SOUND_KEY) !== '0';
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
      if (typeof localStorage !== 'undefined') localStorage.setItem(OBSHAGA_SOUND_KEY, on ? '1' : '0');
    } catch {}
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(on ? 0.7 : 0, t, 0.08);
  }

  /** Контекст жив и звук включён — иначе одноразовые эффекты не строим. */
  private on(): boolean {
    return !!this.ctx && !this.disposed && this._enabled && this.ctx.state === 'running';
  }

  private build() {
    const ctx = this.ctx!;
    // выход: лимитер-компрессор (внезапная хватка не клипует)
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 6;
    comp.attack.value = 0.002;
    // мягкий клиппер после компрессора: десятки одновременных событий не перегрузят выход (до ≈ −2.4 дБFS)
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
    // вне биома — тишина (плавно)
    this.fade = ctx.createGain();
    this.fade.gain.value = 0;
    this.fade.connect(this.master);
    // коридор: длинная узкая труба, плиточные стены — флаттер-эхо и тёмный хвост 2 с
    const conv = ctx.createConvolver();
    conv.buffer = impulse(ctx, 2.0);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.4;
    this.wet.connect(conv);
    conv.connect(this.fade);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.fade);
    this.amb = ctx.createGain();
    this.amb.connect(this.fade);
    this.pwr = ctx.createGain();
    this.pwr.connect(this.sfx);
    const pw = ctx.createGain();
    pw.gain.value = 0.8;
    this.pwr.connect(pw).connect(this.wet);
    this.noise = noiseBuffer(ctx, 4, false);
    this.brown = noiseBuffer(ctx, 5, true);
    this.ambience();
    this.buildDrag();
  }

  /** Непрерывные слои; громкости ставит update() по состоянию кадра. */
  private ambience() {
    const ctx = this.ctx!;
    // гул сети: пила 50 + синус 100 Гц через низкий фильтр
    const mains = (this.mainsG = ctx.createGain());
    mains.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 170;
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
    lp.connect(mains).connect(this.amb);
    o1.start();
    o2.start();
    // трубки: нечётные и чётные гармоники 100 Гц в полосе ~1.2 кГц — «жужжание» дросселя
    const tube = (this.tubeG = ctx.createGain());
    tube.gain.value = 0;
    const tbp = ctx.createBiquadFilter();
    tbp.type = 'bandpass';
    tbp.frequency.value = 1150;
    tbp.Q.value = 0.8;
    for (const [type, f, a] of [['sawtooth', 100.1, 1], ['sawtooth', 200.4, 0.5], ['square', 300.2, 0.25]] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = a;
      o.connect(og).connect(tbp);
      o.start();
    }
    tbp.connect(tube).connect(this.amb);
    // шипение балласта, пульсирует на 100 Гц
    const hiss = (this.hissG = ctx.createGain());
    hiss.gain.value = 0;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 5200;
    const hs = ctx.createBufferSource();
    hs.buffer = this.noise;
    hs.loop = true;
    const am = ctx.createGain();
    am.gain.value = 0.6;
    const alfo = ctx.createOscillator();
    alfo.frequency.value = 100;
    const alg = ctx.createGain();
    alg.gain.value = 0.4;
    alfo.connect(alg).connect(am.gain);
    hs.connect(hp).connect(am).connect(hiss).connect(this.amb);
    hs.start();
    alfo.start();
    // низкий тон помещения (пустое здание): бурый шум, очень глухо, слабое «дыхание»
    const tone = (this.toneG = ctx.createGain());
    tone.gain.value = 0;
    const tmod = ctx.createGain();
    tmod.gain.value = 0.75;
    const tlfo = ctx.createOscillator();
    tlfo.frequency.value = 0.07;
    const tlg = ctx.createGain();
    tlg.gain.value = 0.25;
    tlfo.connect(tlg).connect(tmod.gain);
    tlfo.start();
    this.loop(this.brown, 'lowpass', 70, 0.7, 1).connect(tmod).connect(tone);
    tone.connect(this.amb);
    // дыхание: шина, куда update() кладёт вдохи/выдохи
    this.breathBus = ctx.createGain();
    this.breathBus.gain.value = 0;
    this.breathBus.connect(this.amb);
    // лампа: шипение пламени + низкое «тело» огня, трепет; справа у бедра
    const lg = (this.lanternG = ctx.createGain());
    lg.gain.value = 0;
    const lp2 = (this.lanternPan = ctx.createStereoPanner());
    lp2.pan.value = 0.35;
    const fl = ctx.createGain();
    fl.gain.value = 0.6;
    const f1 = ctx.createOscillator();
    f1.frequency.value = 8.7;
    const f1g = ctx.createGain();
    f1g.gain.value = 0.18;
    f1.connect(f1g).connect(fl.gain);
    const f2 = ctx.createOscillator();
    f2.frequency.value = 2.3;
    const f2g = ctx.createGain();
    f2g.gain.value = 0.15;
    f2.connect(f2g).connect(fl.gain);
    f1.start();
    f2.start();
    this.loop(this.noise, 'bandpass', 1900, 0.6, 1).connect(fl);
    fl.connect(lg);
    this.loop(this.brown, 'lowpass', 280, 0.7, 0.9).connect(lg);
    lg.connect(lp2).connect(this.amb);
    // вода у ног: тихий плеск, медленно «качается»
    const lap = (this.lapG = ctx.createGain());
    lap.gain.value = 0;
    const wmod = ctx.createGain();
    wmod.gain.value = 0.6;
    const wlfo = ctx.createOscillator();
    wlfo.frequency.value = 0.27;
    const wlg = ctx.createGain();
    wlg.gain.value = 0.4;
    wlfo.connect(wlg).connect(wmod.gain);
    wlfo.start();
    this.loop(this.brown, 'bandpass', 230, 0.8, 1).connect(wmod).connect(lap);
    lap.connect(this.amb);
    // звон в ушах после блэкаута (включается в blackout())
    const ring = (this.ringG = ctx.createGain());
    ring.gain.value = 0;
    for (const f of [5100, 6350]) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = f === 5100 ? 1 : 0.5;
      o.connect(og).connect(ring);
      o.start();
    }
    ring.connect(this.fade);
  }

  /** Волочение: шорох тела и одежды по плитке, «рывки», низкий скрежет; громкость и тембр — drag(). */
  private buildDrag() {
    const ctx = this.ctx!;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(this.sfx);
    const w = ctx.createGain();
    w.gain.value = 0.3;
    out.connect(w).connect(this.wet);
    const flt = ctx.createBiquadFilter();
    flt.type = 'bandpass';
    flt.frequency.value = 900;
    flt.Q.value = 1.2;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    const mod = ctx.createGain();
    mod.gain.value = 0.65;
    const chop = ctx.createOscillator();
    chop.type = 'triangle';
    chop.frequency.value = 5;
    const cg = ctx.createGain();
    cg.gain.value = 0.35;
    chop.connect(cg).connect(mod.gain);
    const body = ctx.createGain();
    body.gain.value = 1.5;
    s.connect(flt).connect(mod).connect(body).connect(out);
    this.loop(this.brown, 'lowpass', 220, 0.7, 1.1).connect(out);
    this.loop(this.noise, 'highpass', 3000, 0.6, 0.1).connect(out);
    s.start();
    chop.start();
    this.drg = { out, flt, chop };
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
    s.start(0, Math.random() * 0.5);
    return g;
  }

  // ───────────────────────── узлы-помощники ─────────────────────────

  /** Точка относительно слушателя: вперёд / вправо / вверх (по взгляду) → мировые координаты. */
  private rel(fwd: number, right: number, up: number): V3 {
    const L = this.listener, s = Math.sin(L.yaw), c = Math.cos(L.yaw);
    return { x: L.x + s * fwd + c * right, y: L.y + up, z: L.z + c * fwd - s * right };
  }

  /** Источник в точке p: HRTF-панорама, громкость спадает с расстоянием. */
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

  /** Выход эффекта: сухой и в эхо коридора. */
  private out(node: AudioNode, wet = 0.5, to: AudioNode = this.sfx) {
    node.connect(to);
    if (wet > 0) {
      const w = this.ctx!.createGain();
      w.gain.value = wet;
      node.connect(w).connect(this.wet);
    }
  }

  /** Дешёвый «местный» выход: панорама по yaw на момент события (шаги, щелчки ламп), без HRTF. */
  private local(pan: number, wet = 0.3): StereoPannerNode {
    const p = this.ctx!.createStereoPanner();
    p.pan.value = clamp(fin(pan), -1, 1);
    this.out(p, wet);
    return p;
  }

  private burst(buf: AudioBuffer, dur: number, type: BiquadFilterType, f: number, q: number, peak: number, dest: AudioNode, at = 0, attack = 0.005) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + at;
    const s = ctx.createBufferSource();
    s.buffer = buf;
    const flt = ctx.createBiquadFilter();
    flt.type = type;
    flt.frequency.value = f;
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
    return { o, g, t };
  }

  /** Металл: негармонические обертоны с разным затуханием. */
  private clang(dest: AudioNode, base: number, peak: number, dur: number, at = 0) {
    for (const [k, d] of [[1, 1], [2.31, 0.7], [3.94, 0.5], [6.37, 0.35], [8.9, 0.22]] as const) {
      this.tone('sine', base * k, base * k * 0.985, dur * d, (peak * 0.5) / Math.sqrt(k), dest, at, 0.002);
    }
    this.burst(this.noise, 0.05, 'bandpass', Math.min(9000, base * 6), 2, peak * 0.4, dest, at, 0.001);
  }

  /** Прерыватель громкости (stick-slip скрипа, трепет): вход → gain, модулируемый квадратной волной. */
  private chop(dest: AudioNode, hz: number, depth: number, at: number, dur: number): GainNode {
    const ctx = this.ctx!;
    const t = ctx.currentTime + at;
    const m = ctx.createGain();
    m.gain.value = 1 - depth;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = hz;
    const og = ctx.createGain();
    og.gain.value = depth;
    o.connect(og).connect(m.gain);
    m.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
    return m;
  }

  /** Скрип: пила с дрожащей высотой через «формантный» полосовой фильтр, прерывистый (stick-slip). */
  private squeak(dest: AudioNode, f0: number, f1: number, dur: number, peak: number, at = 0, jitter = 0.07, hz = 30) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const n = 28;
    const curve = new Float32Array(n);
    let j = 0;
    for (let i = 0; i < n; i++) {
      j = j * 0.5 + (Math.random() * 2 - 1) * jitter;
      curve[i] = lerp(f0, f1, i / (n - 1)) * (1 + j);
    }
    o.frequency.setValueCurveAtTime(curve, t, dur);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = Math.max(f0, f1) * 2.2;
    bp.Q.value = 2.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + dur * 0.3);
    g.gain.setValueAtTime(peak, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(bp).connect(this.chop(g, hz * rnd(0.8, 1.25), 0.35, at, dur));
    g.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** Язычок замка / защёлка: два сухих щелчка с металлическим призвуком. */
  private latch(dest: AudioNode, at: number, k = 1) {
    this.burst(this.noise, 0.012, 'bandpass', 2300, 4, 0.25 * k, dest, at, 0.001);
    this.tone('triangle', 1700, 1500, 0.04, 0.03 * k, dest, at + 0.001, 0.001);
    this.burst(this.noise, 0.02, 'bandpass', 1100, 3, 0.2 * k, dest, at + rnd(0.05, 0.09), 0.001);
  }

  // ───────────────────────── кадр ─────────────────────────

  /** Каждый кадр: слушатель, непрерывные слои, шаги, случайные звуки общаги. */
  update(dt: number, f: ObshagaAudioFrame): void {
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
    // вне биома — всё затихает
    this.fade.gain.setTargetAtTime(f.inBiome ? 1 : 0, t, f.inBiome ? 0.6 : 0.5);
    if (!f.inBiome) return;

    // ── питание и свет ──
    if (f.dead) {
      this.grabHold = 0;
    } else if (this.wasDead) {
      this.slowUp = 1.5; // воскрес: фон возвращается мягко
    }
    this.wasDead = f.dead;
    const light = clamp01(fin(f.light, 1));
    this.lowT = light < 0.03 ? this.lowT + dt : 0;
    this.litT = light > 0.5 ? this.litT + dt : 0;
    if (this.blackedOut && this.litT > 1.5) {
      // lightsBack() не позвали — свет давно горит: отпускаем сами
      this.blackedOut = false;
      this.slowUp = 1.5;
    }
    const powered = !this.blackedOut && this.lowT < 0.5;
    const target = this.blackedOut ? 0 : light;
    this.slowUp = Math.max(0, this.slowUp - dt);
    this.humK = smoothLevel(this.humK, target, dt, this.slowUp > 0 ? 0.9 : 0.04, 0.012);
    this.pwr.gain.setTargetAtTime(powered ? 1 : 0, t, powered ? 0.8 : 0.02);

    // ── непрерывные слои ──
    const k = ambientTargets({ humK: this.humK, tubes: fin(f.tubes), dead: f.dead, inWater: f.inWater, lantern: f.lantern });
    this.mainsG!.gain.setTargetAtTime(k.mains, t, 0.015);
    this.tubeG!.gain.setTargetAtTime(k.tube, t, 0.015);
    this.hissG!.gain.setTargetAtTime(k.hiss, t, 0.015);
    this.toneG!.gain.setTargetAtTime(k.tone, t, 0.4);
    this.breathBus!.gain.setTargetAtTime(k.breath, t, 0.5);
    this.lanternG!.gain.setTargetAtTime(k.lantern, t, 0.3);
    this.lapG!.gain.setTargetAtTime(k.lap, t, 0.4);
    this.wet.gain.setTargetAtTime(f.inWater ? 0.75 : 0.4, t, 0.6);
    // хватка / смерть: фон глохнет мгновенно, возвращается медленно
    this.grabHold = Math.max(0, this.grabHold - dt);
    const duck = f.dead || this.grabHold > 0;
    this.amb.gain.setTargetAtTime(duck ? 0 : 1, t, duck ? 0.03 : 0.9);
    // волочение умолкает, если drag() давно не звали
    if (this.drg && t - this.dragLast > 0.2) this.drg.out.gain.setTargetAtTime(0, t, 0.06);
    if (f.dead) return;

    // ── шаги ──
    const speed = fin(f.speed);
    const walking = f.moving && speed > 0.15 && this.grabHold <= 0;
    if (walking) {
      const iv = stepInterval(speed, f.inWater);
      if (!this.wasMoving) this.stepT = iv * 0.65;
      this.stepT += dt;
      if (this.stepT >= iv) {
        this.stepT = 0;
        this.step(stepLoudness(speed), f.inWater);
      }
    }
    this.wasMoving = walking;

    // ── случайные звуки ──
    const dark = this.humK < 0.3;
    this.creakIn -= dt;
    if (this.creakIn <= 0) {
      this.creakIn = rnd(k.creakEvery[0], k.creakEvery[1]);
      if (this.grabHold <= 0) this.creak(dark ? 1 : 0.4);
    }
    if (k.dorm && powered) {
      this.dormIn -= dt;
      if (this.dormIn <= 0) {
        this.dormIn = rnd(7, 18);
        this.dormLife();
      }
    }
    if (f.inWater) {
      this.dripIn -= dt;
      if (this.dripIn <= 0) {
        this.dripIn = rnd(1.4, 4.5);
        this.drip();
      }
    }
    if (f.lantern) {
      this.sparkIn -= dt;
      if (this.sparkIn <= 0) {
        this.sparkIn = rnd(0.4, 2.2);
        if (this.on()) this.burst(this.noise, 0.012, 'highpass', 3500, 0.7, 0.05, this.lanternPan!, 0, 0.001);
      }
    }
    // дыхание
    if (k.breath > 0.005 && this.grabHold <= 0) {
      this.breathIn -= dt;
      if (this.breathIn <= 0) {
        this.breathIn = breathPeriod(1 - this.humK, speed);
        this.breath();
      }
    }
  }

  /** Свой вдох-выдох у самого уха (громкость — шина breathBus). */
  private breath() {
    if (!this.on()) return;
    const bus = this.breathBus!;
    const inh = this.burst(this.noise, 0.9, 'bandpass', 900, 1.1, 0.55, bus, 0, 0.35);
    inh.flt.frequency.linearRampToValueAtTime(1400, inh.t + 0.9);
    const exh = this.burst(this.noise, 1.0, 'bandpass', 650, 0.9, 0.65, bus, 1.05, 0.12);
    exh.flt.frequency.linearRampToValueAtTime(400, exh.t + 1.0);
  }

  /** Шаг игрока: плитка / линолеум, в воде — плеск. */
  private step(loud: number, water: boolean) {
    if (!this.on()) return;
    this.counters.step++;
    this.foot ^= 1;
    const pn = this.local((this.foot ? 1 : -1) * rnd(0.08, 0.2), water ? 0.5 : 0.35);
    if (water) {
      // вода по пояс: ногу тянет через воду (плеск нарастает), толчок воды о тело, бульки, мелкая рябь
      const sp = this.burst(this.noise, 0.4, 'bandpass', 380, 0.9, 0.22 * loud, pn, 0, 0.13);
      sp.flt.frequency.linearRampToValueAtTime(950, sp.t + 0.4);
      this.burst(this.brown, 0.32, 'lowpass', 260, 0.7, 0.3 * loud, pn, 0.04, 0.08);
      for (let i = 0; i < 2 + Math.floor(Math.random() * 2); i++) {
        const fb = rnd(280, 700);
        this.tone('sine', fb, fb * 1.7, rnd(0.07, 0.14), 0.05 * loud, pn, 0.1 + i * rnd(0.05, 0.1), 0.01);
      }
      this.burst(this.noise, 0.25, 'highpass', 3000, 0.6, 0.03 * loud, pn, 0.12, 0.05);
      return;
    }
    // каблук о плитку: глухой удар + сухой стук подошвы + гулкость плитки
    this.tone('sine', rnd(130, 180), 75, 0.09, 1.1 * loud, pn, 0, 0.003);
    this.burst(this.noise, 0.07, 'lowpass', rnd(700, 1000), 0.7, 0.6 * loud, pn, 0, 0.002);
    this.burst(this.noise, 0.04, 'bandpass', rnd(2400, 3600), 1.2, 0.28 * loud, pn, 0.003, 0.002);
    if (Math.random() < 0.06) this.tone('sine', rnd(1800, 2400), rnd(2500, 3000), 0.07, 0.03 * loud, pn, 0.02, 0.02); // писк линолеума
  }

  // ───────────────────────── случайные звуки ─────────────────────────

  /** Скрип здания: низкая «балка» с рывками. Случайный и независимый от Руки. */
  private creak(k: number) {
    if (!this.on()) return;
    this.counters.creak++;
    const a = Math.random() * Math.PI * 2, d = rnd(3, 10), L = this.listener;
    const pn = this.panner({ x: L.x + Math.sin(a) * d, y: L.y + rnd(-1, 1.5), z: L.z + Math.cos(a) * d }, 2, 1.1);
    this.out(pn, 0.8);
    const lp = this.ctx!.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    lp.connect(pn);
    const f0 = rnd(70, 150);
    this.squeak(lp, f0, f0 * rnd(0.7, 1.5), rnd(1.0, 2.4), 0.22 * k + 0.06, 0, 0.1, rnd(9, 16));
  }

  /** Капля в воде: звонкий плюх, три затухающих эха от стен подвала. */
  private drip() {
    if (!this.on()) return;
    this.counters.drip++;
    const a = Math.random() * Math.PI * 2, d = rnd(3, 11), L = this.listener;
    const pn = this.panner({ x: L.x + Math.sin(a) * d, y: L.y - rnd(0.8, 1.4), z: L.z + Math.cos(a) * d }, 1.5, 1);
    this.out(pn, 1.3);
    const f = rnd(1100, 2300);
    this.tone('sine', f, f * 0.5, rnd(0.08, 0.14), 0.9, pn, 0, 0.004);
    let at = 0;
    for (let i = 1; i <= 3; i++) {
      at += rnd(0.26, 0.4);
      this.tone('sine', f * 0.9, f * 0.45, 0.09, 0.9 * 0.42 ** i, pn, at, 0.004);
    }
  }

  /** Жизнь за стенами: одно из событий, очень тихо и глухо. */
  private dormLife() {
    if (!this.on()) return;
    this.counters.dorm++;
    const a = Math.random() * Math.PI * 2, d = rnd(5, 13), L = this.listener;
    const p = { x: L.x + Math.sin(a) * d, y: L.y + rnd(-0.6, 0.8), z: L.z + Math.cos(a) * d };
    const r = Math.random();
    if (r < 0.28) this.radio(p);
    else if (r < 0.58) this.murmur(p);
    else if (r < 0.72) this.flush(p);
    else if (r < 0.84) this.farDoor(p);
    else this.pipes(p);
  }

  /** Вход «из-за стены»: фильтры вырезают верх, источник — HRTF в точке p, питание от шины. */
  private wallBus(p: V3, cutoff: number, gain: number): GainNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = gain;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 130;
    const l1 = ctx.createBiquadFilter();
    l1.type = 'lowpass';
    l1.frequency.value = cutoff;
    l1.Q.value = 0.6;
    const l2 = ctx.createBiquadFilter();
    l2.type = 'lowpass';
    l2.frequency.value = cutoff * 1.25;
    g.connect(hp).connect(l1).connect(l2).connect(this.panner(p, 3, 1.3)).connect(this.pwr);
    return g;
  }

  /** Радио через стену: мелодия минорной гаммой («аккордеон») или невнятный диктор. */
  private radio(p: V3) {
    const ctx = this.ctx!;
    const dur = rnd(7, 16);
    const t0 = ctx.currentTime + 0.05;
    const bus = this.wallBus(p, rnd(520, 800), 0.2);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(1, t0 + 0.8);
    env.gain.setValueAtTime(1, t0 + dur - 1);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    env.connect(bus);
    // шипение динамика
    const hs = ctx.createBufferSource();
    hs.buffer = this.noise;
    hs.loop = true;
    const hf = ctx.createBiquadFilter();
    hf.type = 'highpass';
    hf.frequency.value = 3000;
    const hg = ctx.createGain();
    hg.gain.value = 0.04;
    hs.connect(hf).connect(hg).connect(env);
    hs.start(t0);
    hs.stop(t0 + dur + 0.1);
    if (Math.random() < 0.55) {
      const root = pick([175, 196, 220, 247]);
      const scale = [0, 2, 3, 5, 7, 8, 10, 12];
      const phrase = Array.from({ length: Math.floor(rnd(5, 9)) }, () => ({ f: root * 2 ** (pick(scale) / 12), len: pick([0.22, 0.33, 0.44, 0.66]) }));
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1900;
      const ng = ctx.createGain();
      ng.gain.value = 0;
      const vib = ctx.createOscillator();
      vib.frequency.value = 5.5;
      const vg = ctx.createGain();
      vg.gain.value = 16;
      vib.connect(vg);
      const oscs = [ctx.createOscillator(), ctx.createOscillator()];
      oscs[0].type = 'sawtooth';
      oscs[1].type = 'triangle';
      for (const o of oscs) {
        vg.connect(o.detune);
        o.connect(lp);
      }
      lp.connect(ng).connect(env);
      let t = t0 + 0.2;
      for (let i = 0; t < t0 + dur - 0.3; i++) {
        const n = phrase[i % phrase.length];
        oscs[0].frequency.setValueAtTime(n.f, t);
        oscs[1].frequency.setValueAtTime(n.f / 2, t);
        ng.gain.setValueAtTime(0.0001, t);
        ng.gain.exponentialRampToValueAtTime(0.4, t + 0.03);
        ng.gain.exponentialRampToValueAtTime(0.0001, t + n.len * 0.92);
        t += n.len;
      }
      for (const o of oscs) {
        o.start(t0);
        o.stop(t0 + dur + 0.1);
      }
      vib.start(t0);
      vib.stop(t0 + dur + 0.1);
    } else {
      this.babble(env, t0 + 0.2, dur - 0.5, rnd(105, 130), 0.9);
    }
  }

  /** Бубнёж голосов за стеной: один-два невнятных «говорящих» в разной тесситуре. */
  private murmur(p: V3) {
    const dur = rnd(3.5, 8);
    const bus = this.wallBus(p, rnd(420, 650), 1.0);
    const t0 = this.ctx!.currentTime + 0.05;
    this.babble(bus, t0, dur, rnd(100, 140), 0.8);
    if (Math.random() < 0.7) this.babble(bus, t0 + rnd(0.6, 1.6), dur - 0.8, rnd(180, 230), 0.6);
  }

  /** Речеподобный лепет: пила с контуром высоты через два формантных фильтра, слоги и паузы, согласные шипят. */
  private babble(dest: AudioNode, t0: number, dur: number, f0: number, amp: number) {
    const ctx = this.ctx!;
    const end = t0 + Math.max(0.5, dur);
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.Q.value = 6;
    const f2 = ctx.createBiquadFilter();
    f2.type = 'bandpass';
    f2.Q.value = 8;
    const env = ctx.createGain();
    env.gain.value = 0;
    osc.connect(f1).connect(env);
    osc.connect(f2).connect(env);
    env.connect(dest);
    const ns = ctx.createBufferSource();
    ns.buffer = this.noise;
    ns.loop = true;
    const nf = ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = 3600;
    nf.Q.value = 1;
    const fg = ctx.createGain();
    fg.gain.value = 0;
    ns.connect(nf).connect(fg).connect(dest);
    const vowels = [[700, 1100], [500, 900], [500, 1800], [300, 2200], [320, 800]] as const;
    let t = t0;
    while (t < end - 0.3) {
      const n = Math.floor(rnd(3, 8));
      for (let i = 0; i < n && t < end - 0.3; i++) {
        const syl = rnd(0.13, 0.26);
        const v = pick(vowels);
        osc.frequency.setValueAtTime(f0 * rnd(0.92, 1.15), t);
        osc.frequency.linearRampToValueAtTime(f0 * rnd(0.85, 1.1), t + syl);
        f1.frequency.setValueAtTime(v[0] * rnd(0.9, 1.1), t);
        f2.frequency.setValueAtTime(v[1] * rnd(0.9, 1.1), t);
        env.gain.setValueAtTime(0.0001, t);
        env.gain.exponentialRampToValueAtTime(rnd(0.5, 1) * amp, t + syl * 0.3);
        env.gain.exponentialRampToValueAtTime(0.0001, t + syl * 0.95);
        if (Math.random() < 0.6) {
          fg.gain.setValueAtTime(0.0001, t - 0.03);
          fg.gain.exponentialRampToValueAtTime(0.1 * amp, t + 0.01);
          fg.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
        }
        t += syl + rnd(0.02, 0.06);
      }
      t += rnd(0.35, 1.2);
    }
    osc.start(t0);
    osc.stop(end + 0.1);
    ns.start(t0);
    ns.stop(end + 0.1);
  }

  /** Смыв унитаза за стеной: шум воды, бульканье, долив бачка. */
  private flush(p: V3) {
    const bus = this.wallBus(p, rnd(700, 1000), 0.45);
    const rush = this.burst(this.noise, 2.6, 'bandpass', 600, 0.8, 0.5, bus, 0, 0.4);
    rush.flt.frequency.linearRampToValueAtTime(1500, rush.t + 2.6);
    this.burst(this.brown, 3.0, 'lowpass', 160, 0.7, 0.45, bus, 0.1, 0.5);
    for (let i = 0; i < 5; i++) {
      const fb = rnd(180, 330);
      this.tone('sine', fb, fb * 1.4, rnd(0.1, 0.16), 0.15, bus, 2.2 + i * rnd(0.12, 0.3), 0.01);
    }
    const refill = this.burst(this.noise, 3.0, 'highpass', 2200, 0.5, 0.12, bus, 2.6, 0.3);
    refill.flt.frequency.linearRampToValueAtTime(3600, refill.t + 3);
  }

  /** Далёкая дверь (хлопок) за стеной. */
  private farDoor(p: V3) {
    const bus = this.wallBus(p, 520, 1.8);
    this.tone('sine', 82, 40, 0.45, 0.55, bus, 0, 0.004);
    this.burst(this.brown, 0.3, 'lowpass', 300, 0.8, 0.5, bus, 0, 0.003);
    this.burst(this.noise, 0.05, 'bandpass', 900, 1.5, 0.3, bus, 0, 0.001);
  }

  /** Стук по трубам отопления: гулкие металлические удары. */
  private pipes(p: V3) {
    const bus = this.wallBus(p, 900, 0.45);
    let at = 0;
    const base = rnd(240, 340);
    for (let i = 0; i < Math.floor(rnd(2, 5)); i++) {
      this.clang(bus, base * rnd(0.97, 1.03), 0.16, 0.8, at);
      at += rnd(0.35, 0.8);
    }
  }

  // ───────────────────────── события ─────────────────────────

  /** Моргание лампы: щелчок дросселя / стартёра, треск дуги. intensity 0…1 — сила (громкость). */
  flickerTick(intensity = 0.5): void {
    if (!this.on()) return;
    this.counters.flicker++;
    const k = clamp01(fin(intensity, 0.5));
    // лампа — над головой чуть впереди, сторона случайная
    const p = this.rel(rnd(0, 4), rnd(-1.5, 1.5), 1.1);
    const pn = this.local(panOf(this.listener, p) * 0.85, 0.2);
    this.burst(this.noise, 0.012, 'highpass', 3200, 0.7, 0.14 + 0.35 * k, pn, 0, 0.001);
    this.tone('square', rnd(1800, 2600), 900, 0.03, 0.03 + 0.07 * k, pn, 0.004, 0.001);
    for (let i = 0, n = 1 + Math.floor(k * 3); i < n; i++) this.burst(this.noise, 0.006, 'bandpass', rnd(4000, 7000), 0.5, 0.08 + 0.14 * k, pn, 0.012 + i * rnd(0.01, 0.03), 0.001);
  }

  /** Свет погас: тяжёлый щелчок реле, гул срезан мгновенно, звон в ушах и тишина. */
  blackout(): void {
    if (this.disposed) return;
    this.blackedOut = true;
    this.humK = 0;
    this.slowUp = 0;
    this.creakIn = rnd(6, 11);
    this.sparkIn = 1;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // гул — в ноль в этот же сэмпл (update не вернёт: blackedOut держит цель 0)
    for (const g of [this.mainsG, this.tubeG, this.hissG]) {
      if (!g) continue;
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(0, t);
    }
    if (this.pwr) {
      this.pwr.gain.cancelScheduledValues(t);
      this.pwr.gain.setValueAtTime(this.pwr.gain.value, t);
      this.pwr.gain.linearRampToValueAtTime(0, t + 0.03);
    }
    if (!this.on()) return;
    this.counters.blackout++;
    // реле/автомат в щитке: низкий удар, сухой металлический щелчок, дребезг контактов
    const pn = this.panner(this.rel(rnd(2.5, 5), rnd(-3, 3), 0.3), 2.5, 0.8);
    this.out(pn, 0.9);
    this.tone('sine', 98, 46, 0.3, 1.6, pn, 0, 0.002);
    this.burst(this.noise, 0.12, 'lowpass', 600, 0.8, 0.8, pn, 0, 0.002);
    this.burst(this.noise, 0.025, 'bandpass', 1900, 3, 1.4, pn, 0, 0.001);
    this.clang(pn, 230, 0.6, 0.4, 0.01);
    for (let i = 0; i < 3; i++) this.burst(this.noise, 0.01, 'bandpass', rnd(2400, 3600), 3, 0.35, pn, 0.05 + i * rnd(0.025, 0.05), 0.001);
    // звон в ушах: тихий, быстро нарастает и долго тает
    const ring = this.ringG;
    if (ring) {
      ring.gain.cancelScheduledValues(t);
      ring.gain.setValueAtTime(0.0001, t);
      ring.gain.exponentialRampToValueAtTime(0.011, t + 0.35);
      ring.gain.exponentialRampToValueAtTime(0.0001, t + 7);
    }
  }

  /** Свет вернулся: «пинги» стартёров трубок, гул плавно нарастает, жизнь за стенами — позже. */
  lightsBack(): void {
    if (this.disposed) return;
    this.blackedOut = false;
    this.lowT = 0;
    this.slowUp = 2;
    this.dormIn = rnd(5, 10);
    if (!this.ctx) return;
    if (this.ringG) this.ringG.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
    if (!this.on()) return;
    this.counters.back++;
    // реле включилось (мягче, чем выключилось)
    const pr = this.panner(this.rel(rnd(4, 9), rnd(-3, 3), 0.3), 2.5, 0.8);
    this.out(pr, 0.8);
    this.tone('sine', 85, 55, 0.22, 0.3, pr, 0, 0.003);
    this.burst(this.noise, 0.02, 'bandpass', 1700, 3, 0.3, pr, 0, 0.001);
    // стартёры: серия звонких «тинь» на разных лампах
    let at = 0.12;
    for (let i = 0, n = 3 + Math.floor(Math.random() * 3); i < n; i++) {
      const p = this.rel(rnd(-1, 6), rnd(-2, 2), 1.1);
      const pn = this.local(panOf(this.listener, p) * 0.85, 0.5);
      const fb = rnd(1500, 2300);
      this.tone('triangle', fb, fb * 0.97, rnd(0.05, 0.09), 0.05, pn, at, 0.001);
      this.burst(this.noise, 0.01, 'highpass', 3500, 0.7, 0.14, pn, at, 0.001);
      at += rnd(0.18, 0.42);
    }
  }

  /** Дверь открывают: язычок замка и скрип фанерной двери, гул панели, в конце — мягкий упор. */
  doorOpen(p: V3): void {
    if (!this.on()) return;
    this.counters.doorOpen++;
    const pn = this.panner(p, 1.5, 1);
    this.out(pn, 0.7);
    const dur = rnd(0.8, 1.3);
    this.latch(pn, 0, 1);
    this.squeak(pn, rnd(300, 420), rnd(560, 760), dur, 0.55, 0.1, 0.07, rnd(24, 38));
    this.squeak(pn, rnd(520, 640), rnd(800, 1000), dur * 0.7, 0.2, 0.2, 0.09, rnd(30, 44));
    this.burst(this.brown, 0.4, 'bandpass', 170, 2, 0.28, pn, 0.12, 0.05);
    this.tone('sine', 115, 62, 0.14, 0.2, pn, 0.1 + dur, 0.004);
    this.burst(this.brown, 0.12, 'lowpass', 420, 0.7, 0.18, pn, 0.1 + dur, 0.003);
  }

  /** Дверь закрылась сама: тихий ход, мягкий стук, щелчок защёлки — и никого. */
  doorClose(p: V3): void {
    if (!this.on()) return;
    this.counters.doorClose++;
    const pn = this.panner(p, 1.5, 1.1);
    this.out(pn, 1);
    const swing = rnd(0.25, 0.45);
    this.burst(this.noise, swing + 0.1, 'lowpass', 520, 0.5, 0.05, pn, 0, swing * 0.8);
    this.tone('sine', 125, 72, 0.16, 0.17, pn, swing, 0.004);
    this.burst(this.brown, 0.15, 'lowpass', 360, 0.7, 0.15, pn, swing, 0.003);
    this.burst(this.noise, 0.011, 'bandpass', 2200, 5, 0.2, pn, swing + 0.015, 0.001);
    this.tone('triangle', 1650, 1500, 0.05, 0.03, pn, swing + 0.016, 0.001);
    this.burst(this.noise, 0.006, 'bandpass', 3100, 4, 0.1, pn, swing + 0.06, 0.001);
  }

  /** Дверь упёрлась: два глухих удара по дереву и дребезг ручки. */
  doorBlocked(p: V3): void {
    if (!this.on()) return;
    this.counters.doorBlocked++;
    const pn = this.panner(p, 1.5, 1);
    this.out(pn, 0.5);
    for (let i = 0; i < 2; i++) {
      const at = i * rnd(0.15, 0.24);
      this.tone('sine', 140, 80, 0.1, 0.3 * (1 - 0.3 * i), pn, at, 0.003);
      this.burst(this.brown, 0.1, 'lowpass', 420, 0.7, 0.3, pn, at, 0.002);
      this.burst(this.noise, 0.04, 'bandpass', 700, 2, 0.22, pn, at, 0.002);
    }
    for (let i = 0; i < 4; i++) this.burst(this.noise, 0.012, 'bandpass', rnd(2400, 3600), 3, 0.08, pn, 0.03 + i * rnd(0.018, 0.035), 0.001);
  }

  /** Подобрали лампу: дужка звякнула о корпус, стекло, плеск керосина, чирк и вспышка фитиля. */
  pickupLantern(): void {
    if (!this.on()) return;
    this.counters.pickup++;
    const pn = this.panner(this.rel(0.45, 0.35, -0.4), 0.6, 1);
    this.out(pn, 0.35);
    this.clang(pn, 1900, 0.25, 0.25);
    this.clang(pn, 1400, 0.15, 0.2, 0.09);
    this.tone('sine', 3300, 3260, 0.35, 0.09, pn, 0.01, 0.002);
    this.tone('sine', 5100, 5050, 0.25, 0.05, pn, 0.01, 0.002);
    this.burst(this.noise, 0.2, 'bandpass', 500, 1.2, 0.1, pn, 0.05, 0.03);
    this.burst(this.noise, 0.12, 'highpass', 2800, 0.7, 0.14, pn, 0.35, 0.03);
    const w = this.burst(this.noise, 0.35, 'bandpass', 900, 0.8, 0.2, pn, 0.5, 0.06);
    w.flt.frequency.linearRampToValueAtTime(2000, w.t + 0.35);
    this.tone('sine', 80, 60, 0.2, 0.2, pn, 0.5, 0.01);
  }

  /** ХВАТКА — внезапно и громко: удар, мясистый хват, одежда, сдавленный вдох. Фон тут же глохнет. */
  grab(at?: V3): void {
    if (!this.on()) return;
    this.counters.grab++;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    this.grabHold = 4;
    this.amb.gain.cancelScheduledValues(t);
    this.amb.gain.setTargetAtTime(0, t, 0.02);
    this.pwr.gain.setTargetAtTime(0, t, 0.02);
    if (this.drg) this.drg.out.gain.setTargetAtTime(0, t, 0.02);
    const pn = this.panner(at ?? this.rel(0.5, 0.15, -0.5), 0.8, 0.5);
    const g = ctx.createGain();
    g.gain.value = 1.25;
    g.connect(pn);
    this.out(pn, 0.45);
    // удар: низ, бурый плотный бас, хлопок, пила через дисторшн
    this.tone('sine', 64, 24, 1.0, 1.0, g, 0, 0.002);
    this.burst(this.brown, 0.6, 'lowpass', 260, 0.7, 0.9, g, 0, 0.002);
    this.burst(this.noise, 0.05, 'bandpass', 1500, 1.5, 0.7, g, 0, 0.001);
    const ws = ctx.createWaveShaper();
    ws.curve = distortion(60);
    ws.connect(g);
    this.tone('sawtooth', 110, 45, 0.35, 0.45, ws, 0, 0.002);
    // хват: мокрые мясистые сжатия, с каждым ниже по тону
    for (let k = 0, at2 = 0.06; k < 4; k++) {
      const sq = this.burst(this.noise, 0.16, 'bandpass', 1300, 3, 0.35, g, at2, 0.01);
      sq.flt.frequency.exponentialRampToValueAtTime(320, sq.t + 0.16);
      this.burst(this.brown, 0.14, 'lowpass', 380, 0.8, 0.5, g, at2, 0.005);
      at2 += rnd(0.07, 0.13);
    }
    this.squeak(g, 180, 320, 0.5, 0.2, 0.15, 0.1, 18);
    // одежда
    const cl = this.burst(this.noise, 0.5, 'bandpass', 2400, 0.8, 0.28, g, 0.02, 0.06);
    cl.flt.frequency.linearRampToValueAtTime(1500, cl.t + 0.5);
    this.burst(this.noise, 0.25, 'bandpass', 3000, 0.8, 0.14, g, 0.3, 0.04);
    this.burst(this.noise, 0.2, 'bandpass', 2000, 0.8, 0.1, g, 0.5, 0.04);
    // сдавленный вдох игрока: резкий вдох обрывается на полуслове
    const gt = t + 0.18;
    const ge = ctx.createGain();
    ge.gain.setValueAtTime(0, gt);
    ge.gain.linearRampToValueAtTime(0.75, gt + 0.05);
    ge.gain.setValueAtTime(0.75, gt + 0.26);
    ge.gain.linearRampToValueAtTime(0, gt + 0.285);
    const gp = ctx.createStereoPanner();
    ge.connect(gp);
    this.out(gp, 0.25);
    const gs = ctx.createBufferSource();
    gs.buffer = this.noise;
    const gb = ctx.createBiquadFilter();
    gb.type = 'bandpass';
    gb.Q.value = 1.2;
    gb.frequency.setValueAtTime(800, gt);
    gb.frequency.linearRampToValueAtTime(1700, gt + 0.28);
    gs.connect(gb).connect(ge);
    gs.start(gt, Math.random() * 2);
    gs.stop(gt + 0.3);
    const go = ctx.createOscillator();
    go.type = 'sawtooth';
    go.frequency.setValueAtTime(160, gt);
    go.frequency.linearRampToValueAtTime(240, gt + 0.28);
    const gv = ctx.createGain();
    gv.gain.value = 0.35;
    for (const fr of [700, 1100]) {
      const fb = ctx.createBiquadFilter();
      fb.type = 'bandpass';
      fb.frequency.value = fr;
      fb.Q.value = 5;
      go.connect(fb).connect(gv);
    }
    gv.connect(ge);
    go.start(gt);
    go.stop(gt + 0.3);
    this.burst(this.noise, 0.04, 'bandpass', 600, 5, 0.3, gp, 0.5, 0.003); // «гк» — горло
  }

  /** Волочение по плитке; звать КАЖДЫЙ кадр, пока тащат. progress 0…1 — путь до двери (быстрее и резче к концу). */
  drag(progress = 0.5): void {
    if (!this.ctx || this.disposed) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const p = clamp01(fin(progress));
    this.grabHold = Math.max(this.grabHold, 0.6);
    const d = this.drg;
    if (!d || !this.running) return;
    if (this.dragLast < 0 || t - this.dragLast > 0.3) this.counters.drag++; // начало волочения
    const dtd = this.dragLast < 0 ? 0 : clamp(t - this.dragLast, 0, 0.1);
    this.dragLast = t;
    d.out.gain.setTargetAtTime(0.2 + 0.22 * p, t, 0.05);
    d.flt.frequency.setTargetAtTime(700 + 700 * p, t, 0.1);
    d.chop.frequency.setTargetAtTime(4 + 4 * p, t, 0.1);
    // стыки плитки под телом: глухие толчки, чаще к концу
    this.dragThump -= dtd;
    if (this.dragThump <= 0 && this.on()) {
      this.dragThump = lerp(0.55, 0.3, p) * rnd(0.8, 1.2);
      const pn = this.local(rnd(-0.1, 0.1), 0.4);
      this.tone('sine', 95, 55, 0.12, 0.13 + 0.12 * p, pn, 0, 0.004);
      this.burst(this.brown, 0.13, 'lowpass', 300, 0.7, 0.18 + 0.1 * p, pn, 0, 0.003);
      if (Math.random() < 0.2) this.squeak(pn, 700, 1100, 0.18, 0.1, 0.02, 0.1, 30); // подошва скрипнула по плитке
    }
  }

  /** Смерть: далёкий хлопок двери, низкий гул, потом тишина (дальше — по f.dead). */
  death(): void {
    if (!this.on()) return;
    this.counters.death++;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    this.grabHold = 8;
    this.amb.gain.cancelScheduledValues(t);
    this.amb.gain.setTargetAtTime(0, t, 0.15);
    if (this.drg) this.drg.out.gain.setTargetAtTime(0, t, 0.3);
    // хлопок далеко впереди по коридору, гулко
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 650;
    const pn = this.panner(this.rel(22, rnd(-3, 3), -0.4), 4, 1);
    lp.connect(pn);
    this.out(pn, 1.5);
    this.tone('sine', 82, 38, 0.7, 1, lp, 0.15, 0.003);
    this.burst(this.brown, 0.5, 'lowpass', 260, 0.7, 0.9, lp, 0.15, 0.003);
    this.burst(this.noise, 0.07, 'bandpass', 1100, 1.5, 0.7, lp, 0.15, 0.001);
    this.clang(lp, 190, 0.25, 0.9, 0.16);
    // низкий гул — и тишина
    this.burst(this.brown, 3.4, 'lowpass', 70, 0.7, 1, this.sfx, 0.25, 0.6);
    const lo = ctx.createBiquadFilter();
    lo.type = 'lowpass';
    lo.frequency.value = 90;
    lo.connect(this.sfx);
    this.tone('sawtooth', 34, 28, 3.4, 0.3, lo, 0.3, 0.8);
  }

  /** Новая попытка: сбросить внутреннее состояние (необязательно — update сам отпустит). */
  reset(): void {
    this.blackedOut = false;
    this.grabHold = 0;
    this.dragLast = -1;
    this.humK = 0;
    this.slowUp = 1.5;
    this.wasMoving = false;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.amb.gain.cancelScheduledValues(t);
    this.amb.gain.setTargetAtTime(1, t, 0.4);
    if (this.ringG) this.ringG.gain.setTargetAtTime(0, t, 0.2);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.drg = null;
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

/** Отклик коридора: частое флаттер-эхо между плиточными стенами (~9 мс) и тёмный хвост 2 с. */
function impulse(ctx: AudioContext, sec: number): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * sec);
  const b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      // тёмный хвост: шум пропущен через однополюсный низкий фильтр
      lp += 0.35 * ((Math.random() * 2 - 1) - lp);
      d[i] = lp * Math.pow(1 - i / n, 3) * 0.7;
    }
    for (let k = 1; k < 20; k++) {
      const i = Math.floor(((9 * k) / 1000) * ctx.sampleRate) + c * 6;
      if (i < n) d[i] += (k % 2 ? -1 : 1) * 0.4 * Math.pow(0.86, k);
    }
  }
  return b;
}

/** Кривая tanh: единичное усиление у нуля, потолок ≈ 0.76 (−2.4 дБFS). */
function softClip(): Float32Array<ArrayBuffer> {
  const n = 2048;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = Math.tanh((i * 2) / (n - 1) - 1);
  return c;
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
