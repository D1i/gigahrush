// Звук биома «Катакомбы» — процедурный WebAudio, без файлов (по образцу obshagaAudio.ts / snowAudio.ts / metroAudio.ts).
// Питерские катакомбы, темнота, только фонарь (tmp/catacombs-wip/CONTRACT.md; часы прилива — catacombsFlood.ts):
//  • штиль: гулкая пустота кирпичного хода — низкий бурый шум с резонансом свода и «воздухом» хода, эхо (ConvolverNode,
//    синтетический отклик: ранние отражения от свода, хлопки эха вдоль хода, тёмный хвост 3.4 с); редкая капель с эхом
//    (интервал и высота случайны, далёкие — глуше и «мокрее»); далёкий стук и скрип металла в трубах (гребенчатый
//    резонанс — звучит полой трубой); изредка шорох и писк крыс; еле слышный сквозняк;
//  • угроза (warn 0…1): нарастает низкий рокот (суб 31/43.5/58 Гц + полосовой бурый шум ~70 Гц), далёкий рёв воды
//    (фильтр открывается с угрозой), бульканье и «вздохи» в трубах чаще, сквозняк с медленной модуляцией, капель
//    чаще, крысы бегут; cue('warn') — тяжёлый удар металла в трубах, долгий стон и гул по ходу;
//  • подъём / пик: рёв потока рядом (широкая полоса, громче и ярче с уровнем), плеск о стены, бурление (пузыри,
//    «блорпы»); пик — максимум; спад — поток откатывается, сток всасывает и глотает, остаются стекающие струи и частая
//    капель (струи гаснут медленно, уже в штиле);
//  • шаги: мокрый камень (лужи штиля), по щиколотку — шлёп, по колено/бедро — ногу тянет сквозь воду, по пояс — медленный
//    напор, глубже — гребки; ползком — шорох одежды, колено, ладонь (по воде — шлепок). Темп — от скорости, глубже —
//    реже и тяжелее;
//  • под водой: весь «мир» через двойной низкий фильтр ~400 Гц, глухое гудение и пузыри у лица; сердце слышно, воздух
//    < 0.3 (или мало здоровья) — чаще и громче. cue: 'gasp' — вдох и вода смыкается над головой; 'choke' — захлёб,
//    кашель пузырями; 'hurt' — глухой удар и стон; 'dead' — последние пузыри, гул вниз, всё затухает; 'breathe' — жадный
//    вдох при всплытии, кашель, одышка; 'climb' — одежда скребёт по трубе, звон металла, труба гудит; 'clink' — задетая
//    бутылка звякнула и катится (в воде — глухо булькнула).
//
// AudioContext — только по жесту пользователя (политика автоплея): start() из клика / клавиши; до start() — тишина.
// Позиций источников нет (катакомбы «вокруг»): случайные звуки раскладываются стереопанорамой. Мастер — компрессор и
// мягкий клиппер (наводнение и десятки пузырей не перегрузят выход).
//
// ИНТЕГРАЦИЯ:
//   const a = new CatacombsAudio();   // вкл/выкл — localStorage 'room-forge/catacombs-sound' ('0' — выкл)
//   a.start();                        // по жесту (повторно — resume)
//   a.update({ dt, inside, warn, phase, level, depth, under, moving, speed, crawling, breath, hp });   // КАЖДЫЙ кадр
//   a.cue('warn' | 'rise' | 'peak' | 'ebb' | 'calm')         — входы в фазы (события stepFlood);
//   a.cue('gasp' | 'choke' | 'hurt' | 'dead' | 'breathe')   — события stepLungs;
//   a.cue('climb') — перелаз через трубу;   a.cue('clink') — задел бутылку;
//   a.on / a.setSound(on) — кнопка «звук»;   a.dispose() — всё остановить и закрыть контекст.
import { CATACOMBS, FLOOD_PHASES, type FloodPhase } from '../locations/catacombsFlood';

/** Ключ localStorage: '0' — звук катакомб выключен, иначе включён. */
export const CATACOMBS_SOUND_KEY = 'room-forge/catacombs-sound';

export interface CatacombsAudioFrame {
  /** шаг кадра, с */
  dt: number;
  /** игрок в катакомбах; false — всё плавно затихает */
  inside: boolean;
  /** нарастание угрозы 0…1 (floodWarn) */
  warn: number;
  phase: FloodPhase;
  /** уровень воды над полом сети, м (floodLevel) */
  level: number;
  /** глубина у ног игрока, м */
  depth: number;
  /** голова под водой */
  under: boolean;
  /** игрок идёт; speed — скорость, м/с */
  moving: boolean;
  speed: number;
  /** ползком (лаз, под трубой) */
  crawling: boolean;
  /** воздух 0…1 */
  breath: number;
  /** здоровье 0…100 (0 — мёртв) */
  hp: number;
}

export type CatacombsCue = 'warn' | 'rise' | 'peak' | 'ebb' | 'calm' | 'gasp' | 'choke' | 'hurt' | 'dead' | 'breathe' | 'climb' | 'clink';

export interface CatacombsAudioCounters {
  step: number;
  drip: number;
  pipe: number;
  rat: number;
  churn: number;
  slap: number;
  bubble: number;
  heart: number;
  cue: number;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const clamp01 = (v: number) => clamp(v, 0, 1);
const pick = <T>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)];
/** NaN/Infinity из кадра не должны дойти до AudioParam (бросает исключение). */
const fin = (v: number, d = 0) => (Number.isFinite(v) ? v : d);
const isPhase = (p: unknown): p is FloodPhase => FLOOD_PHASES.includes(p as FloodPhase);

/** Громкость мастера при включённом звуке. */
const MASTER = 0.75;
/** Срез «мира» над водой (фильтр открыт) и под водой, Гц. */
const OPEN_HZ = 18000;
export const UNDER_HZ = 400;

// ───────────────────────── чистые функции (тесты в catacombsAudio.test.ts) ─────────────────────────

/** Доля затопления 0…1: от луж штиля (calmM) до пика (peakM). */
export function floodK(level: number): number {
  return clamp01((fin(level, CATACOMBS.calmM) - CATACOMBS.calmM) / (CATACOMBS.peakM - CATACOMBS.calmM));
}

/** Шаг по глубине у ног: мокрый камень (лужи штиля), шлёп по щиколотку, вброд по колено/бедро, по пояс, вплавь;
 *  ползком — по сухому / по воде. */
export type StepKind = 'stone' | 'splash' | 'wade' | 'deep' | 'swim' | 'crawl' | 'crawlWet';

export function stepKind(depth: number, crawling: boolean): StepKind {
  const d = Math.max(0, fin(depth));
  if (crawling) return d > 0.03 ? 'crawlWet' : 'crawl';
  if (d < 0.1) return 'stone';
  if (d < 0.35) return 'splash';
  if (d < 0.9) return 'wade';
  if (d < 1.3) return 'deep';
  return 'swim';
}

/** Секунд между шагами: шаг ≈ 0.62 + 0.09·v м (0.32…0.8 с); глубже — реже (по пояс в 1.6 раза, вплавь до 1.9);
 *  ползком — «рука-колено» каждые ~0.36 м (0.3…0.95 с). */
export function stepInterval(speed: number, depth: number, crawling: boolean): number {
  const v = Math.max(0.1, fin(speed));
  if (crawling) return clamp(0.36 / v, 0.3, 0.95);
  const stride = Math.min(1.1, 0.62 + 0.09 * v);
  const t = clamp(stride / v, 0.32, 0.8);
  return t * (1 + 0.6 * clamp(fin(depth), 0, 1.5));
}

/** Громкость шага от скорости (0.5…1.2). */
export function stepLoudness(speed: number): number {
  return clamp(0.5 + 0.2 * fin(speed), 0.5, 1.2);
}

export interface LayerIn {
  warn: number;
  phase: FloodPhase;
  level: number;
  depth: number;
  under: boolean;
  crawling: boolean;
  /** мёртв (или только что утонул) — тишина */
  dead: boolean;
}

export interface LayerOut {
  /** гулкая пустота хода */
  room: number;
  /** рокот угрозы (суб + полосовой бурый шум) */
  rumble: number;
  /** рёв воды (далёкий → близкий) и срез его фильтра, Гц: далеко — глухо, вода рядом — ярко */
  roar: number;
  roarHz: number;
  /** поток рядом: широкая полоса, турбулентность */
  flow: number;
  /** сквозняк */
  draft: number;
  /** плеск у ног и о стены */
  lap: number;
  /** стекающие струи */
  trickle: number;
  /** глухое гудение под водой */
  uw: number;
  /** срез фильтра «мира», Гц (под водой UNDER_HZ) */
  muffleHz: number;
  /** посыл в эхо хода */
  wet: number;
}

/** Целевые громкости непрерывных слоёв по кадру. Мёртвый — тишина и глухо. */
export function layerTargets(a: LayerIn): LayerOut {
  if (a.dead) return { room: 0, rumble: 0, roar: 0, roarHz: 250, flow: 0, draft: 0, lap: 0, trickle: 0, uw: 0, muffleHz: 250, wet: 0.2 };
  const w = clamp01(fin(a.warn));
  const fk = floodK(a.level);
  const d = Math.max(0, fin(a.depth));
  const ph = isPhase(a.phase) ? a.phase : 'calm';
  // поток: в подъём бурлит сильнее всего, на пике вода стоит, на спаде уходит
  const surge = ph === 'rise' ? 1 : ph === 'peak' ? 0.85 : ph === 'ebb' ? 0.6 : 0.3;
  // сквозняк гонит воздух перед водой: сильнее всего в предупреждение
  const gust = ph === 'calm' || ph === 'warn' ? 1 : ph === 'rise' ? 0.7 : 0.35;
  // плеск: вода у ног (глубже — громче) или, если игрок на сухом (убежище), — о стены внизу
  const lap = a.under ? 0 : d > 0.12 ? 0.012 + 0.04 * Math.min(1, d / 1.2) : fk > 0.05 ? 0.03 * fk : 0;
  return {
    room: 0.03 * (1 - 0.6 * fk),
    rumble: 0.075 * w ** 1.4,
    roar: 0.004 + 0.06 * w ** 1.2,
    roarHz: 220 + 500 * w + 900 * fk,
    flow: 0.13 * fk ** 0.7 * surge,
    draft: 0.008 + 0.03 * w * gust,
    lap,
    trickle: ph === 'ebb' ? 0.03 : ph === 'calm' ? 0.004 : ph === 'warn' ? 0.007 : 0,
    uw: a.under ? 0.07 : 0,
    muffleHz: a.under ? UNDER_HZ : OPEN_HZ,
    wet: a.under ? 0.12 : a.crawling ? 0.3 : 0.55,
  };
}

/** Значение диапазона r по доле u ∈ [0, 1) (u — из Math.random или сида). */
export function nextIn(r: readonly [number, number], u: number): number {
  return lerp(r[0], r[1], clamp01(fin(u)));
}

/** Интервал капели, с: штиль — редкая; предупреждение — чаще с угрозой; подъём/пик — тонет в рёве; спад — всё течёт. */
export function dripEvery(phase: FloodPhase, warn: number): [number, number] {
  const w = clamp01(fin(warn));
  switch (phase) {
    case 'warn':
      return [lerp(1.6, 0.6, w), lerp(5.5, 2, w)];
    case 'rise':
    case 'peak':
      return [2.5, 6];
    case 'ebb':
      return [0.35, 1.4];
    default:
      return [1.6, 5.5];
  }
}

/** Интервал звуков в трубах, с: в штиль — изредка, в предупреждение — часто. */
export function pipeEvery(phase: FloodPhase, warn: number): [number, number] {
  switch (phase) {
    case 'warn':
      return [lerp(6, 2.5, clamp01(fin(warn))), lerp(14, 7, clamp01(fin(warn)))];
    case 'rise':
      return [5, 12];
    case 'peak':
      return [8, 18];
    case 'ebb':
      return [10, 24];
    default:
      return [14, 36];
  }
}

export type PipeKind = 'knock' | 'creak' | 'gurgle' | 'sigh';

/** Что звучит в трубах (u ∈ [0, 1)): в штиль — стук и скрип, перед водой и в воде — бульканье и «вздохи». */
export function pipeKind(phase: FloodPhase, u: number): PipeKind {
  const x = clamp01(fin(u));
  const [knock, creak, gurgle] =
    phase === 'calm' ? [0.5, 0.88, 1] : phase === 'peak' ? [0.3, 0.55, 0.8] : phase === 'ebb' ? [0.25, 0.4, 0.85] : [0.2, 0.4, 0.72];
  return x < knock ? 'knock' : x < creak ? 'creak' : x < gurgle ? 'gurgle' : 'sigh';
}

/** Интервал шороха крыс, с; null — крыс нет (вода высоко). В предупреждение крысы бегут — часто. */
export function ratEvery(phase: FloodPhase): [number, number] | null {
  switch (phase) {
    case 'calm':
      return [22, 55];
    case 'warn':
      return [5, 12];
    case 'ebb':
      return [40, 80];
    default:
      return null;
  }
}

/** Интервал бурления, с: подъём/пик — пузыри в толще (чаще с уровнем); спад — глотки стоков; иначе null. */
export function churnEvery(phase: FloodPhase, level: number): [number, number] | null {
  const fk = floodK(level);
  if (phase === 'rise' || phase === 'peak') return fk < 0.03 ? null : [lerp(0.7, 0.12, fk), lerp(1.6, 0.5, fk)];
  if (phase === 'ebb') return [0.6, 1.8];
  return null;
}

/** Сердцебиение: период, с, и громкость 0…1; null — не слышно. Под водой слышно всегда (глухо, ~0.95 с); воздух < 0.3
 *  или здоровье < 40 — чаще (до 0.38 с) и громче. Мёртвый — null. */
export function heartbeat(under: boolean, breath: number, hp: number): { every: number; k: number } | null {
  const h = fin(hp, CATACOMBS.hp);
  if (h <= 0) return null;
  const b = clamp01(fin(breath, 1));
  const panic = b < 0.3 ? (0.3 - b) / 0.3 : 0;
  const weak = h < 40 ? (40 - h) / 40 : 0;
  const x = clamp01(Math.max(panic, weak));
  if (!under && x <= 0) return null;
  return { every: lerp(0.95, 0.38, x), k: 0.35 + 0.65 * x };
}

/**
 * Отклик кирпичного хода (2 канала, sec секунд): плотные ранние отражения от свода (3–25 мс), «хлопки» эха вдоль
 * длинного хода (каждые ~95 мс, каналы чуть разнесены — шире), тёмный хвост: шум через двойной однополюсный фильтр,
 * срез которого уходит вниз со временем (кирпич и вода съедают верх).
 */
export function tunnelImpulse(sr: number, sec: number, rand: () => number = Math.random): Float32Array<ArrayBuffer>[] {
  const n = Math.max(1, Math.floor(sr * sec));
  const out: Float32Array<ArrayBuffer>[] = [];
  for (let c = 0; c < 2; c++) {
    const d = new Float32Array(n);
    let l1 = 0;
    let l2 = 0;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      const a = 0.5 - 0.38 * u;
      l1 += a * (rand() * 2 - 1 - l1);
      l2 += a * (l1 - l2);
      // хвост вступает мягко (~12 мс), спадает к концу
      d[i] = l2 * Math.pow(1 - u, 2.6) * (1 - Math.exp(-i / (sr * 0.012))) * 1.4;
    }
    // ранние отражения от свода
    for (let k = 0; k < 14; k++) {
      const i = Math.floor(sr * (0.003 + rand() * 0.022));
      if (i < n) d[i] += (rand() < 0.5 ? -1 : 1) * 0.35 * (0.6 + 0.4 * rand()) * Math.pow(0.9, k);
    }
    // эхо вдоль хода: слегка размытые хлопки
    const gap = 0.095 + c * 0.007;
    for (let k = 1; k <= 8; k++) {
      const i0 = Math.floor(sr * gap * k);
      if (i0 >= n) break;
      const amp = 0.3 * Math.pow(0.62, k);
      for (let j = 0; j < 48 && i0 + j < n; j++) d[i0 + j] += amp * (rand() * 2 - 1) * Math.exp(-j / 12);
    }
    out.push(d);
  }
  return out;
}

// ───────────────────────── класс ─────────────────────────

type LayerKey = 'room' | 'rumble' | 'roar' | 'flow' | 'draft' | 'lap' | 'trickle' | 'uw';

export class CatacombsAudio {
  ctx: AudioContext | null = null;
  readonly counters: CatacombsAudioCounters = { step: 0, drip: 0, pipe: 0, rat: 0, churn: 0, slap: 0, bubble: 0, heart: 0, cue: 0 };
  private _on: boolean;
  private master!: GainNode;
  /** вне катакомб — тишина (плавно) */
  private fade!: GainNode;
  /** «мир»: всё, что вокруг игрока, — через двойной низкий фильтр (под водой глухо) */
  private world!: GainNode;
  private muf: BiquadFilterNode[] = [];
  private amb!: GainNode;
  private sfx!: GainNode;
  /** посыл в эхо хода (громкость — по кадру) */
  private wet!: GainNode;
  /** свои звуки у самого уха (дыхание, сердце, пузыри у лица, гудение под водой) — мимо фильтра «мира» */
  private self!: GainNode;
  private analyser: AnalyserNode | null = null;
  private noise!: AudioBuffer;
  private brown!: AudioBuffer;
  private lay: Record<LayerKey, GainNode> | null = null;
  private roarF: BiquadFilterNode | null = null;
  /** входы «труб» (гребенчатый резонанс) */
  private pipes: GainNode[] = [];
  // кадр
  private phase: FloodPhase = 'calm';
  private warn = 0;
  private lvl = CATACOMBS.calmM;
  private depth = 0;
  private under = false;
  private hp: number = CATACOMBS.hp;
  // состояние
  private trickleT = 0;
  private trickleTau = 1.5;
  private wasDead = false;
  private deadT = 0;
  private reviveT = 0;
  private wasMoving = false;
  private stepT = 0;
  private foot = 0;
  private heartT = 0.3;
  private pantN = 0;
  private pantIn = 0;
  private hurtAt = -1;
  private dripIn = rnd(1, 3);
  private pipeIn = rnd(6, 14);
  private ratIn = rnd(12, 30);
  private churnIn = 0.5;
  private slapIn = 1;
  private bubbleIn = 0.4;
  private disposed = false;

  constructor() {
    let on = true;
    try {
      if (typeof localStorage !== 'undefined') on = localStorage.getItem(CATACOMBS_SOUND_KEY) !== '0';
    } catch {}
    this._on = on;
  }

  /** Звук включён (кнопка «звук»). */
  get on(): boolean {
    return this._on;
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
        const c = this.ctx as AudioContext | null;
        this.ctx = null;
        this.lay = null;
        if (c) c.close().catch(() => {});
        return;
      }
    }
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
  }

  /** Вкл/выкл звук; пишет в localStorage ('1' / '0'). */
  setSound(on: boolean): void {
    this._on = on;
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(CATACOMBS_SOUND_KEY, on ? '1' : '0');
    } catch {}
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(on ? MASTER : 0, t, 0.08);
  }

  /** Текущий уровень (RMS) на выходе, 0…1 — для QA. */
  rms(): number {
    const a = this.analyser;
    if (!a) return 0;
    const d = new Float32Array(a.fftSize);
    a.getFloatTimeDomainData(d);
    let s = 0;
    for (const v of d) s += v * v;
    return Math.sqrt(s / d.length);
  }

  /** Контекст жив, играет и звук включён — иначе одноразовые эффекты не строим. */
  private live(): boolean {
    return !!this.ctx && !this.disposed && this._on && this.ctx.state === 'running' && !!this.lay;
  }

  private build() {
    const ctx = this.ctx!;
    // выход: компрессор-лимитер + мягкий клиппер (до ≈ −2.4 дБFS)
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 8;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    const clip = ctx.createWaveShaper();
    clip.curve = softClip();
    clip.oversample = '2x';
    comp.connect(clip).connect(ctx.destination);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    clip.connect(this.analyser);
    this.master = ctx.createGain();
    this.master.gain.value = this._on ? MASTER : 0;
    this.master.connect(comp);
    this.fade = ctx.createGain();
    this.fade.gain.value = 0;
    this.fade.connect(this.master);
    // «мир» → двойной низкий фильтр (под водой 24 дБ/окт на 400 Гц, над водой открыт)
    this.world = ctx.createGain();
    let node: AudioNode = this.world;
    for (let i = 0; i < 2; i++) {
      const b = ctx.createBiquadFilter();
      b.type = 'lowpass';
      b.frequency.value = OPEN_HZ;
      b.Q.value = 0;
      node.connect(b);
      node = b;
      this.muf.push(b);
    }
    node.connect(this.fade);
    // эхо кирпичного хода
    const conv = ctx.createConvolver();
    const ir = tunnelImpulse(ctx.sampleRate, 3.4);
    const buf = ctx.createBuffer(2, ir[0].length, ctx.sampleRate);
    buf.copyToChannel(ir[0], 0);
    buf.copyToChannel(ir[1], 1);
    conv.buffer = buf;
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.55;
    this.wet.connect(conv);
    conv.connect(this.world);
    this.amb = ctx.createGain();
    this.amb.connect(this.world);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.world);
    this.self = ctx.createGain();
    this.self.connect(this.fade);
    this.noise = noiseBuffer(ctx, 6, false);
    this.brown = noiseBuffer(ctx, 6, true);
    this.ambience();
    this.buildPipes();
  }

  /** Непрерывные слои; громкости ставит update() по кадру (layerTargets). */
  private ambience() {
    const ctx = this.ctx!;
    const layer = (wet: number, to: AudioNode = this.amb) => {
      const g = ctx.createGain();
      g.gain.value = 0;
      this.out(g, wet, to);
      return g;
    };
    // пустота хода: бурый шум ниже 95 Гц, резонанс свода ~142 Гц, «воздух» хода ~420 Гц; медленно дышит
    const room = layer(0.7);
    const rw = this.wobble([0.05, 0.25], [0.13, 0.1]);
    this.loop(this.brown, 'lowpass', 95, 0, 1.6).connect(rw);
    this.loop(this.brown, 'bandpass', 142, 5, 3).connect(rw);
    this.loop(this.noise, 'bandpass', 420, 2.5, 0.35).connect(rw);
    rw.connect(room);
    // рокот угрозы: суб 31 / 43.5 Гц и треугольник 58 Гц (его обертоны слышны и в ноутбуке) + бурый шум ~70 Гц
    const rumble = layer(0.35);
    const rbw = this.wobble([0.13, 0.25], [3.1, 0.12]);
    const sub = ctx.createBiquadFilter();
    sub.type = 'lowpass';
    sub.frequency.value = 160;
    sub.Q.value = 0;
    for (const [type, f, a] of [['sine', 31, 1], ['sine', 43.5, 0.7], ['triangle', 58, 0.35]] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = a;
      o.connect(og).connect(sub);
      o.start();
    }
    sub.connect(rbw);
    this.loop(this.brown, 'bandpass', 72, 1.2, 2.2).connect(rbw);
    rbw.connect(rumble);
    // далёкий рёв воды: белый шум через «открывающийся» низкий фильтр + бурая масса
    const roar = layer(0.9);
    const rrw = this.wobble([0.09, 0.2], [0.37, 0.12]);
    const rf = (this.roarF = ctx.createBiquadFilter());
    rf.type = 'lowpass';
    rf.frequency.value = 250;
    rf.Q.value = 0;
    const rg = ctx.createGain();
    rg.gain.value = 1.6;
    this.src(this.noise).connect(rf).connect(rg).connect(rrw);
    this.loop(this.brown, 'lowpass', 300, 0, 1.2).connect(rrw);
    rrw.connect(roar);
    // поток рядом: широкая полоса, шипение брызг, масса воды; турбулентность — быстрые неровные модуляции
    const flow = layer(0.5);
    const fw = this.wobble([0.6, 0.22], [5.3, 0.1], [7.9, 0.08]);
    this.loop(this.noise, 'bandpass', 1300, 0.35, 1).connect(fw);
    this.loop(this.noise, 'highpass', 4500, 0, 0.22).connect(fw);
    this.loop(this.brown, 'lowpass', 260, 0, 1.6).connect(fw);
    fw.connect(flow);
    // сквозняк: полоса гуляет 400–900 Гц, громкость «дышит»
    const draft = layer(0.5);
    const dbp = ctx.createBiquadFilter();
    dbp.type = 'bandpass';
    dbp.frequency.value = 650;
    dbp.Q.value = 0.9;
    const dl = ctx.createOscillator();
    dl.frequency.value = 0.07;
    const dlg = ctx.createGain();
    dlg.gain.value = 250;
    dl.connect(dlg).connect(dbp.frequency);
    dl.start();
    const dw = this.wobble([0.11, 0.45], [0.23, 0.2]);
    const dg = ctx.createGain();
    dg.gain.value = 3;
    this.src(this.noise).connect(dbp).connect(dw).connect(dg).connect(draft);
    // плеск у ног и о стены: медленно «качается»
    const lap = layer(0.45);
    const lw = this.wobble([0.27, 0.4], [0.71, 0.15]);
    this.loop(this.brown, 'bandpass', 230, 0.8, 1).connect(lw);
    this.loop(this.noise, 'bandpass', 950, 1, 0.12).connect(lw);
    lw.connect(lap);
    // стекающие струи: журчание в полосах 1.7 и 2.8 кГц, быстрая неровная модуляция; далеко — мокрое эхо
    const trickle = layer(1);
    const tw = this.wobble([13, 0.3], [21.7, 0.2], [0.4, 0.2]);
    this.loop(this.noise, 'bandpass', 2800, 2, 1.4).connect(tw);
    this.loop(this.noise, 'bandpass', 1700, 3, 1).connect(tw);
    tw.connect(trickle);
    // под водой: давление в ушах — глухой бурый шум и низкий тон (мимо фильтра «мира»)
    const uw = layer(0, this.self);
    const um = this.wobble([0.17, 0.3]);
    this.loop(this.brown, 'lowpass', 170, 0, 1.6).connect(um);
    const uo = ctx.createOscillator();
    uo.frequency.value = 52;
    const uog = ctx.createGain();
    uog.gain.value = 0.12;
    uo.connect(uog).connect(um);
    uo.start();
    um.connect(uw);
    this.lay = { room, rumble, roar, flow, draft, lap, trickle, uw };
  }

  /** Две «трубы» разного калибра: гребенчатый резонанс (задержка с обратной связью через низкий фильтр) — стук, стон
   *  и бульканье в них звучат полым металлом. Слева потоньше, справа потолще. */
  private buildPipes() {
    const ctx = this.ctx!;
    for (const [hz, pan] of [[176, -0.55], [113, 0.5]] as const) {
      const inp = ctx.createGain();
      const sum = ctx.createGain();
      const dl = ctx.createDelay(0.05);
      dl.delayTime.value = 1 / hz;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2200;
      lp.Q.value = 0;
      const fb = ctx.createGain();
      fb.gain.value = 0.62;
      inp.connect(sum);
      sum.connect(dl).connect(lp).connect(fb).connect(sum);
      const og = ctx.createGain();
      og.gain.value = 0.5;
      const pn = ctx.createStereoPanner();
      pn.pan.value = pan;
      sum.connect(og).connect(pn);
      this.out(pn, 1.1);
      this.pipes.push(inp);
    }
  }

  // ───────────────────────── узлы-помощники ─────────────────────────

  private src(buf: AudioBuffer): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.start(0, Math.random() * (buf.duration * 0.5));
    return s;
  }

  private loop(buf: AudioBuffer, type: BiquadFilterType, f: number, q: number, gain: number): GainNode {
    const ctx = this.ctx!;
    const flt = ctx.createBiquadFilter();
    flt.type = type;
    flt.frequency.value = f;
    flt.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = gain;
    this.src(buf).connect(flt).connect(g);
    return g;
  }

  /** Модулятор громкости: gain = 1 + Σ depth·sin(2π·hz·t) (медленные «дыхания» и турбулентность слоя). */
  private wobble(...lfos: [hz: number, depth: number][]): GainNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = 1;
    for (const [hz, depth] of lfos) {
      const o = ctx.createOscillator();
      o.frequency.value = hz * rnd(0.9, 1.1);
      const og = ctx.createGain();
      og.gain.value = depth;
      o.connect(og).connect(g.gain);
      o.start();
    }
    return g;
  }

  /** Выход эффекта: сухой (to) и в эхо хода. */
  private out(node: AudioNode, wet = 0.5, to: AudioNode = this.sfx) {
    node.connect(to);
    if (wet > 0) {
      const w = this.ctx!.createGain();
      w.gain.value = wet;
      node.connect(w).connect(this.wet);
    }
  }

  /** Стереопанорама события (−1…1) и выход. */
  private pan(p: number, wet = 0.4, to: AudioNode = this.sfx): StereoPannerNode {
    const pn = this.ctx!.createStereoPanner();
    pn.pan.value = clamp(fin(p), -1, 1);
    this.out(pn, wet, to);
    return pn;
  }

  /** Низкий фильтр перед dest (глуше — дальше / под водой). */
  private lowpass(f: number, dest: AudioNode): BiquadFilterNode {
    const b = this.ctx!.createBiquadFilter();
    b.type = 'lowpass';
    b.frequency.value = f;
    b.Q.value = 0;
    b.connect(dest);
    return b;
  }

  /** Свой звук у уха; над водой — немного в эхо хода. */
  private selfOut(wet: number): GainNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.connect(this.self);
    if (wet > 0 && !this.under) {
      const w = ctx.createGain();
      w.gain.value = wet;
      g.connect(w).connect(this.wet);
    }
    return g;
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
    g.gain.linearRampToValueAtTime(Math.max(0, peak), t + a);
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
    o.frequency.setValueAtTime(Math.max(1, f0), t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain();
    const a = Math.min(attack, dur * 0.5);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(Math.max(0, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
    return { o, g, t };
  }

  /** Пузырёк (резонанс Миннарта): синус, высота быстро растёт, короткое затухание. */
  private bubble(dest: AudioNode, f: number, dur: number, peak: number, at = 0) {
    this.tone('sine', f, f * rnd(1.6, 2.4), dur, peak, dest, at, 0.003);
  }

  /** Металл: негармонические обертоны с разным затуханием + удар. */
  private clang(dest: AudioNode, base: number, peak: number, dur: number, at = 0) {
    for (const [k, d] of [[1, 1], [2.31, 0.7], [3.94, 0.5], [6.37, 0.35], [8.9, 0.22]] as const) {
      this.tone('sine', base * k, base * k * 0.985, dur * d, (peak * 0.5) / Math.sqrt(k), dest, at, 0.002);
    }
    this.burst(this.noise, 0.05, 'bandpass', Math.min(9000, base * 6), 2, peak * 0.4, dest, at, 0.001);
  }

  /** Стекло бутылки: высокие негармонические обертоны, короткий «тинь». */
  private glass(dest: AudioNode, base: number, k: number, at = 0) {
    for (const [r, d] of [[1, 0.4], [2.32, 0.26], [4.25, 0.16], [6.63, 0.1]] as const) {
      this.tone('sine', base * r, base * r * 0.998, d, (0.07 * k) / Math.sqrt(r), dest, at, 0.001);
    }
    this.burst(this.noise, 0.012, 'highpass', 5000, 0, 0.05 * k, dest, at, 0.0005);
  }

  /** Прерыватель громкости (stick-slip трения, перекаты): вход → gain, модулируемый квадратной волной. */
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

  /** Скрип / стон металла: пила с дрожащей высотой через «формантный» полосовой фильтр, прерывисто (stick-slip). */
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
      curve[i] = Math.max(1, lerp(f0, f1, i / (n - 1)) * (1 + j));
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

  /** «Голос» вдоха / стона / кашля: пила через две форманты. */
  private voice(dest: AudioNode, f0: number, f1: number, dur: number, peak: number, at: number, formants: readonly [number, number], attack = 0.03) {
    const ctx = this.ctx!;
    const vin = ctx.createGain();
    formants.forEach((fr, i) => {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = fr;
      bp.Q.value = 4;
      const fg = ctx.createGain();
      fg.gain.value = i ? 0.6 : 1;
      vin.connect(bp).connect(fg).connect(dest);
    });
    this.tone('sawtooth', f0, f1, dur, peak, vin, at, attack);
  }

  // ───────────────────────── кадр ─────────────────────────

  /** Каждый кадр: непрерывные слои по фазе / уровню / глубине, шаги, сердце, случайные звуки. */
  update(f: CatacombsAudioFrame): void {
    if (!this.ctx || this.disposed) return;
    const dt = clamp(fin(f.dt, 0.016), 0, 0.25);
    const wasUnder = this.under;
    this.phase = isPhase(f.phase) ? f.phase : 'calm';
    this.warn = clamp01(fin(f.warn));
    this.lvl = Math.max(0, fin(f.level, CATACOMBS.calmM));
    this.depth = Math.max(0, fin(f.depth));
    this.under = !!f.under;
    this.hp = fin(f.hp, CATACOMBS.hp);
    if (!this.running || !this.lay) return;
    const t = this.ctx.currentTime;
    const inside = !!f.inside;
    this.fade.gain.setTargetAtTime(inside ? 1 : 0, t, inside ? 0.8 : 0.5);
    if (!inside) {
      this.wasMoving = false;
      return;
    }

    // ── смерть и «Ещё раз» ──
    this.deadT = Math.max(0, this.deadT - dt);
    const dead = this.hp <= 0 || this.deadT > 0;
    if (!dead && this.wasDead) {
      this.reviveT = 2; // воскрес: фон возвращается мягко
      this.pantN = 0;
      this.heartT = 0.3;
    }
    this.wasDead = dead;
    this.reviveT = Math.max(0, this.reviveT - dt);

    // ── непрерывные слои ──
    const crawling = !!f.crawling;
    const k = layerTargets({ warn: this.warn, phase: this.phase, level: this.lvl, depth: this.depth, under: this.under, crawling, dead });
    const slow = dead ? 0.9 : this.reviveT > 0 ? 1.2 : 0;
    const L = this.lay;
    const set = (g: GainNode, v: number, tau: number) => g.gain.setTargetAtTime(v, t, Math.max(tau, slow));
    set(L.room, k.room, 0.6);
    set(L.rumble, k.rumble, 0.5);
    set(L.roar, k.roar, 0.5);
    set(L.flow, k.flow, 0.35);
    set(L.draft, k.draft, 0.8);
    set(L.lap, k.lap, 0.4);
    if (k.trickle !== this.trickleT) {
      // струи появляются за ~1.5 с, а гаснут долго — ещё стекают в штиле
      this.trickleTau = k.trickle < this.trickleT ? 8 : 1.5;
      this.trickleT = k.trickle;
    }
    set(L.trickle, k.trickle, this.trickleTau);
    set(L.uw, k.uw, this.under ? 0.08 : 0.2);
    this.roarF!.frequency.setTargetAtTime(k.roarHz, t, 0.8);
    for (const b of this.muf) b.frequency.setTargetAtTime(k.muffleHz, t, this.under || dead ? 0.05 : 0.12);
    this.wet.gain.setTargetAtTime(k.wet, t, 0.3);
    if (dead) {
      this.wasMoving = false;
      return;
    }
    if (wasUnder && !this.under) this.surface();

    // ── шаги ──
    const speed = fin(f.speed);
    const walking = !!f.moving && speed > 0.12;
    if (walking) {
      const iv = stepInterval(speed, this.depth, crawling);
      if (!this.wasMoving) this.stepT = iv * 0.6;
      this.stepT += dt;
      if (this.stepT >= iv) {
        this.stepT = 0;
        this.step(stepKind(this.depth, crawling), stepLoudness(speed));
      }
    }
    this.wasMoving = walking;

    // ── сердце, одышка ──
    const hb = heartbeat(this.under, fin(f.breath, 1), this.hp);
    if (hb) {
      this.heartT -= dt;
      if (this.heartT <= 0) {
        this.heartT = hb.every;
        this.beat(hb.k, hb.every);
      }
    } else this.heartT = 0.3;
    if (this.pantN > 0 && !this.under) {
      this.pantIn -= dt;
      if (this.pantIn <= 0) {
        this.pantN--;
        this.pantIn = rnd(1.0, 1.3) + (3 - this.pantN) * 0.15;
        this.pant(0.4 + 0.15 * this.pantN);
      }
    }

    // ── случайные звуки ──
    const ph = this.phase;
    this.dripIn -= dt;
    if (this.dripIn <= 0) {
      this.dripIn = nextIn(dripEvery(ph, this.warn), Math.random());
      this.drip();
    }
    this.pipeIn -= dt;
    if (this.pipeIn <= 0) {
      this.pipeIn = nextIn(pipeEvery(ph, this.warn), Math.random());
      this.pipe(pipeKind(ph, Math.random()));
    }
    const re = ratEvery(ph);
    if (re && this.lvl < 0.3) {
      this.ratIn = Math.min(this.ratIn, re[1]);
      this.ratIn -= dt;
      if (this.ratIn <= 0) {
        this.ratIn = nextIn(re, Math.random());
        this.rats();
      }
    }
    const ce = churnEvery(ph, this.lvl);
    if (ce) {
      this.churnIn -= dt;
      if (this.churnIn <= 0) {
        this.churnIn = nextIn(ce, Math.random());
        this.churn();
      }
    }
    if (k.lap > 0.012) {
      this.slapIn -= dt;
      if (this.slapIn <= 0) {
        this.slapIn = rnd(0.5, 2.0);
        this.slap(k.lap);
      }
    }
    if (this.under) {
      this.bubbleIn -= dt;
      if (this.bubbleIn <= 0) {
        this.bubbleIn = rnd(0.3, 1.3);
        this.bubbles(1 + Math.floor(Math.random() * 3), 0.05);
      }
    }
  }

  // ───────────────────────── шаги и тело ─────────────────────────

  /** Шаг / гребок / перехват ползком по глубине у ног. */
  private step(kind: StepKind, loud: number) {
    if (!this.live()) return;
    this.counters.step++;
    this.foot ^= 1;
    const p = this.pan((this.foot ? 1 : -1) * rnd(0.06, 0.18), kind === 'stone' || kind === 'crawl' ? 0.45 : 0.5);
    switch (kind) {
      case 'stone': {
        // мокрый камень: глухой удар каблука, сухой «тык» подошвы, чавк воды в лужице / иле
        this.tone('sine', rnd(110, 150), 65, 0.08, 0.45 * loud, p, 0, 0.003);
        this.burst(this.noise, 0.06, 'lowpass', rnd(800, 1100), 0, 0.3 * loud, p, 0, 0.002);
        this.burst(this.noise, 0.03, 'bandpass', rnd(2600, 3600), 1.2, 0.12 * loud, p, 0.004, 0.002);
        const w = this.burst(this.noise, 0.09, 'bandpass', rnd(1200, 1800), 1.5, 0.1 * loud, p, 0.03, 0.01);
        w.flt.frequency.linearRampToValueAtTime(rnd(2400, 3200), w.t + 0.09);
        if (Math.random() < 0.35) this.bubble(p, rnd(700, 1300), 0.04, 0.03 * loud, 0.05);
        return;
      }
      case 'splash': {
        // по щиколотку: шлёп, брызги, пара бульков
        const s = this.burst(this.noise, 0.2, 'bandpass', 700, 0.9, 0.3 * loud, p, 0, 0.012);
        s.flt.frequency.linearRampToValueAtTime(1500, s.t + 0.2);
        this.burst(this.brown, 0.15, 'lowpass', 300, 0, 0.25 * loud, p, 0, 0.01);
        this.burst(this.noise, 0.16, 'highpass', 3000, 0, 0.06 * loud, p, 0.03, 0.01);
        for (let i = 0; i < 1 + Math.floor(Math.random() * 2); i++) this.bubble(p, rnd(400, 900), rnd(0.04, 0.08), 0.04 * loud, 0.06 + i * rnd(0.04, 0.09));
        return;
      }
      case 'wade': {
        // по колено — бедро: ногу тянет сквозь воду (плеск нарастает), толчок воды, бульки, рябь
        const s = this.burst(this.noise, 0.45, 'bandpass', 380, 0.9, 0.24 * loud, p, 0, 0.15);
        s.flt.frequency.linearRampToValueAtTime(950, s.t + 0.45);
        this.burst(this.brown, 0.36, 'lowpass', 260, 0, 0.34 * loud, p, 0.04, 0.09);
        for (let i = 0; i < 2 + Math.floor(Math.random() * 2); i++) {
          const fb = rnd(280, 700);
          this.tone('sine', fb, fb * 1.7, rnd(0.07, 0.14), 0.05 * loud, p, 0.1 + i * rnd(0.05, 0.1), 0.01);
        }
        this.burst(this.noise, 0.25, 'highpass', 3000, 0, 0.03 * loud, p, 0.12, 0.05);
        return;
      }
      case 'deep': {
        // по пояс — грудь: медленный напор воды телом, глухо; отошедшая волна шлёпает о стену
        this.burst(this.brown, 0.7, 'lowpass', 240, 0, 0.42 * loud, p, 0, 0.25);
        const w = this.burst(this.noise, 0.65, 'bandpass', 320, 0.8, 0.16 * loud, p, 0.05, 0.25);
        w.flt.frequency.linearRampToValueAtTime(700, w.t + 0.65);
        for (let i = 0; i < 2 + Math.floor(Math.random() * 2); i++) this.bubble(p, rnd(200, 500), rnd(0.06, 0.12), 0.05 * loud, 0.2 + i * rnd(0.06, 0.14));
        this.burst(this.noise, 0.2, 'bandpass', 900, 0.9, 0.05 * loud, this.pan(rnd(-0.6, 0.6), 0.8), 0.5, 0.05);
        return;
      }
      case 'swim': {
        // вплавь: гребок — шелест руки сквозь воду, напор, плеск на выносе, бульки
        const st = this.burst(this.noise, 0.4, 'bandpass', 550, 0.9, 0.2 * loud, p, 0, 0.12);
        st.flt.frequency.linearRampToValueAtTime(1300, st.t + 0.4);
        this.burst(this.brown, 0.4, 'lowpass', 220, 0, 0.3 * loud, p, 0.05, 0.1);
        this.burst(this.noise, 0.14, 'highpass', 2600, 0, 0.06 * loud, p, 0.32, 0.01);
        for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) this.bubble(p, rnd(250, 700), rnd(0.04, 0.09), 0.05 * loud, 0.1 + i * rnd(0.03, 0.08));
        return;
      }
      case 'crawl': {
        // ползком по сухому: шорох одежды, глухо колено, шлепок ладони о камень, песок под ладонью
        this.burst(this.noise, 0.22, 'bandpass', rnd(900, 1400), 0.8, 0.09 * loud, p, 0, 0.07);
        this.tone('sine', rnd(85, 110), 55, 0.09, 0.22 * loud, p, 0.1, 0.004);
        this.burst(this.noise, 0.035, 'lowpass', 1600, 0, 0.14 * loud, p, 0.02, 0.002);
        this.burst(this.noise, 0.12, 'highpass', 4000, 0, 0.02 * loud, p, 0.04, 0.03);
        return;
      }
      case 'crawlWet': {
        // ползком по воде: ладонь шлёпает, колено тянет воду, мокрая одежда
        this.burst(this.noise, 0.2, 'bandpass', 800, 0.8, 0.05 * loud, p, 0, 0.06);
        this.burst(this.noise, 0.09, 'bandpass', rnd(1100, 1700), 1, 0.2 * loud, p, 0, 0.004);
        this.bubble(p, rnd(500, 1000), 0.05, 0.03 * loud, 0.04);
        const s = this.burst(this.noise, 0.25, 'bandpass', 500, 0.9, 0.12 * loud, p, 0.12, 0.08);
        s.flt.frequency.linearRampToValueAtTime(1100, s.t + 0.25);
        this.burst(this.brown, 0.2, 'lowpass', 260, 0, 0.12 * loud, p, 0.12, 0.05);
        return;
      }
    }
  }

  /** Удар сердца «тук-тук» (глухо, у самого уха); dub — через долю периода. */
  private beat(k: number, every: number, at = 0) {
    if (!this.live()) return;
    this.counters.heart++;
    const lp = this.lowpass(170, this.self);
    const gap = Math.min(0.28, every * 0.36);
    this.tone('sine', 64, 40, 0.16, 0.42 * k, lp, at, 0.006);
    this.burst(this.brown, 0.1, 'lowpass', 120, 0, 0.35 * k, lp, at, 0.004);
    this.tone('sine', 58, 38, 0.13, 0.28 * k, lp, at + gap, 0.006);
  }

  /** Вдох-выдох у самого уха (одышка после всплытия). */
  private pant(k: number) {
    if (!this.live()) return;
    const p = this.selfOut(0.15);
    const inh = this.burst(this.noise, 0.4, 'bandpass', 800, 1.1, 0.35 * k, p, 0, 0.15);
    inh.flt.frequency.linearRampToValueAtTime(1500, inh.t + 0.4);
    const exh = this.burst(this.noise, 0.5, 'bandpass', 700, 0.9, 0.38 * k, p, 0.48, 0.06);
    exh.flt.frequency.linearRampToValueAtTime(380, exh.t + 0.5);
  }

  /** Пузыри у лица (под водой). */
  private bubbles(n: number, amp: number) {
    if (!this.live()) return;
    this.counters.bubble++;
    const lp = this.lowpass(1800, this.self);
    let at = 0;
    for (let i = 0; i < n; i++) {
      this.bubble(lp, rnd(280, 900), rnd(0.03, 0.08), amp * rnd(0.5, 1), at);
      at += rnd(0.02, 0.15);
    }
  }

  /** Голова вынырнула (без cue: и после короткого нырка) — вода стекает, плеск у ушей. */
  private surface() {
    if (!this.live()) return;
    const p = this.selfOut(0.2);
    const s = this.burst(this.noise, 0.25, 'bandpass', 700, 0.9, 0.12, p, 0, 0.02);
    s.flt.frequency.linearRampToValueAtTime(1500, s.t + 0.25);
    this.burst(this.noise, 0.5, 'highpass', 2400, 0, 0.035, p, 0.05, 0.03);
  }

  // ───────────────────────── случайные звуки ─────────────────────────

  /** Капля: звонкий «плинк» в лужу (или «плюп» в стоячую воду), эхо вдоль хода; высота и даль — случайные. */
  private drip() {
    if (!this.live()) return;
    this.counters.drip++;
    const far = Math.random();
    const deep = this.lvl > 0.25;
    const dest = this.lowpass(lerp(9000, 2500, far), this.pan(rnd(-0.85, 0.85), lerp(0.9, 2, far)));
    const amp = lerp(0.2, 0.05, far) * rnd(0.7, 1.15);
    const f = deep ? rnd(450, 1000) : rnd(1100, 2700);
    // удар капли: пузырёк-резонанс (высота растёт), сверху — короткий «тик»
    this.tone('sine', f, f * (deep ? 1.9 : 1.45), deep ? rnd(0.1, 0.16) : rnd(0.06, 0.12), amp, dest, 0, 0.002);
    this.burst(this.noise, 0.015, 'highpass', 4000, 0, amp * 0.25, dest, 0, 0.001);
    // эхо: дальние стены хода — 2–3 повтора, тише
    let at = 0;
    for (let i = 1; i <= 3; i++) {
      at += rnd(0.17, 0.33);
      this.tone('sine', f * 0.97, f * 1.35, 0.08, amp * 0.38 ** i, dest, at, 0.003);
    }
  }

  /** Звук в трубах: стук (тепловой «тук-тук»), стон-скрип, бульканье, «вздох» воздуха. Через резонанс трубы. */
  private pipe(kind: PipeKind) {
    if (!this.live()) return;
    this.counters.pipe++;
    const far = rnd(0.4, 1);
    const inp = this.lowpass(rnd(900, 2600), pick(this.pipes));
    switch (kind) {
      case 'knock': {
        const n = 1 + Math.floor(Math.random() * 3);
        const base = rnd(140, 320);
        let at = 0;
        for (let i = 0; i < n; i++) {
          this.clang(inp, base * rnd(0.97, 1.03), 0.09 * far, rnd(0.5, 1.1), at);
          this.burst(this.brown, 0.06, 'lowpass', 300, 0, 0.15 * far, inp, at, 0.002);
          at += rnd(0.12, 0.45);
        }
        return;
      }
      case 'creak': {
        const f0 = rnd(48, 110);
        this.squeak(this.lowpass(650, inp), f0, f0 * rnd(0.7, 1.45), rnd(1.2, 2.8), 0.1 * far, 0, 0.12, rnd(7, 14));
        return;
      }
      case 'gurgle': {
        const n = 4 + Math.floor(Math.random() * 6);
        let at = 0;
        for (let i = 0; i < n; i++) {
          this.bubble(inp, rnd(110, 360), rnd(0.05, 0.12), 0.11 * far, at);
          at += rnd(0.05, 0.22);
        }
        this.burst(this.brown, at + 0.2, 'lowpass', 300, 0, 0.06 * far, inp, 0, 0.1);
        return;
      }
      case 'sigh': {
        const d = rnd(1.2, 2.2);
        const s = this.burst(this.noise, d, 'bandpass', rnd(700, 1000), 3, 0.12 * far, inp, 0, d * 0.4);
        s.flt.frequency.exponentialRampToValueAtTime(rnd(260, 380), s.t + d);
        this.tone('sine', 72, 54, d, 0.03 * far, inp, 0, d * 0.4);
        return;
      }
    }
  }

  /** Крысы: торопливые коготки по камню и мусору (пробегают слева направо или наоборот), шорох, писк. */
  private rats() {
    if (!this.live()) return;
    this.counters.rat++;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const k = rnd(0.5, 1) * (this.phase === 'warn' ? 1.3 : 1);
    const n = 7 + Math.floor(Math.random() * 10);
    const times: number[] = [];
    let at = 0;
    for (let i = 0; i < n; i++) {
      times.push(at);
      at += rnd(0.025, 0.09);
    }
    const a = rnd(-0.9, 0.9);
    const pn = ctx.createStereoPanner();
    pn.pan.setValueAtTime(a, t);
    pn.pan.linearRampToValueAtTime(clamp(a + rnd(-0.8, 0.8), -1, 1), t + at);
    this.out(pn, 0.8);
    const lp = this.lowpass(rnd(3500, 7000), pn);
    for (const ti of times) this.burst(this.noise, rnd(0.008, 0.02), 'bandpass', rnd(2500, 5500), 1.5, 0.05 * k * rnd(0.5, 1), lp, ti, 0.001);
    this.burst(this.noise, at + 0.1, 'bandpass', 1800, 0.8, 0.012 * k, lp, 0, 0.05);
    if (Math.random() < 0.6) {
      for (let j = 0; j < 1 + Math.floor(Math.random() * 3); j++) {
        const f = rnd(3600, 6200);
        this.tone('sine', f, f * rnd(0.85, 1.15), rnd(0.05, 0.13), 0.012 * k, lp, rnd(0, at), 0.01);
      }
    }
  }

  /** Бурление: подъём/пик — пузыри и «блорпы» в толще (громче с уровнем); спад — сток глотает, всасывает. */
  private churn() {
    if (!this.live()) return;
    this.counters.churn++;
    const p = this.pan(rnd(-0.8, 0.8), 0.6);
    if (this.phase === 'ebb') {
      const n = 2 + Math.floor(Math.random() * 4);
      const f = rnd(120, 220);
      let at = 0;
      for (let i = 0; i < n; i++) {
        this.bubble(p, f * (1 - 0.08 * i), rnd(0.08, 0.16), 0.09, at);
        this.burst(this.brown, 0.12, 'lowpass', 250, 0, 0.12, p, at, 0.01);
        at += rnd(0.12, 0.3);
      }
      if (Math.random() < 0.4) {
        const s = this.burst(this.noise, 1.2, 'bandpass', 600, 2, 0.03, p, 0, 0.4);
        s.flt.frequency.exponentialRampToValueAtTime(220, s.t + 1.2);
      }
      return;
    }
    const amp = 0.04 + 0.08 * floodK(this.lvl);
    const n = 2 + Math.floor(Math.random() * 5);
    let at = 0;
    for (let i = 0; i < n; i++) {
      this.bubble(p, rnd(90, 320), rnd(0.04, 0.1), amp * rnd(0.5, 1), at);
      at += rnd(0.02, 0.12);
    }
    if (Math.random() < 0.3) this.burst(this.brown, rnd(0.25, 0.5), 'lowpass', 220, 0, amp * 1.8, p, 0, 0.04);
  }

  /** Плеск воды о стены / о ноги. */
  private slap(k: number) {
    if (!this.live()) return;
    this.counters.slap++;
    const p = this.pan(rnd(-0.7, 0.7), 0.6);
    const d = rnd(0.12, 0.28);
    const s = this.burst(this.noise, d, 'bandpass', rnd(500, 800), 0.9, k * rnd(1.2, 2.2), p, 0, d * 0.35);
    s.flt.frequency.linearRampToValueAtTime(rnd(1100, 1600), s.t + d);
    this.burst(this.noise, d * 0.7, 'highpass', 3200, 0, k * 0.5, p, d * 0.3, 0.01);
    if (Math.random() < 0.5) this.bubble(p, rnd(250, 600), 0.06, k * 1.2, d * 0.5);
  }

  // ───────────────────────── события ─────────────────────────

  /** Разовый звук: вход в фазу наводнения, событие дыхания, перелаз, бутылка. До start() / при выключенном — ничего. */
  cue(k: CatacombsCue): void {
    if (!this.live()) return;
    this.counters.cue++;
    switch (k) {
      case 'warn':
        return this.cueWarn();
      case 'rise':
        return this.cueRise();
      case 'peak':
        return this.cuePeak();
      case 'ebb':
        return this.cueEbb();
      case 'calm':
        return this.cueCalm();
      case 'gasp':
        return this.gasp();
      case 'choke':
        return this.choke();
      case 'hurt':
        return this.hurt();
      case 'dead':
        return this.dead();
      case 'breathe':
        return this.breathe();
      case 'climb':
        return this.climb();
      case 'clink':
        return this.clink();
    }
  }

  /** Предупреждение: где-то в трубах тяжёлый удар металла, долгий стон, по ходу прокатывается гул. */
  private cueWarn() {
    const lp = this.lowpass(900, pick(this.pipes));
    this.clang(lp, rnd(48, 66), 0.35, 3.2, 0);
    this.burst(this.brown, 0.6, 'lowpass', 160, 0, 0.6, lp, 0, 0.005);
    const f0 = rnd(42, 60);
    this.squeak(lp, f0, f0 * rnd(1.25, 1.6), rnd(2.4, 3.4), 0.22, 0.6, 0.05, rnd(5, 9));
    this.burst(this.brown, 4, 'lowpass', 120, 0, 0.5, this.lowpass(140, this.pan(rnd(-0.5, 0.5), 1.2)), 0.2, 1.6);
    this.pipeIn = Math.min(this.pipeIn, rnd(2, 4));
  }

  /** Вода пошла: где-то прорвало затвор — лязг, удар напора, издалека нарастает шум потока, хлещет из трубы. */
  private cueRise() {
    const p = this.pan(rnd(-0.6, 0.6), 1.3);
    const far = this.lowpass(1200, p);
    this.clang(far, rnd(85, 120), 0.18, 2, 0);
    this.burst(this.brown, 0.8, 'lowpass', 180, 0, 0.6, far, 0.05, 0.01);
    const s = this.burst(this.noise, 5, 'lowpass', 300, 0, 0.35, p, 0.1, 3.5);
    s.flt.frequency.exponentialRampToValueAtTime(1800, s.t + 4.5);
    this.burst(this.noise, 3.5, 'bandpass', 900, 0.6, 0.12, pick(this.pipes), 0.4, 0.3);
  }

  /** Пик: тяжёлая волна ударяет в своды, снизу бурлит, стонут трубы. */
  private cuePeak() {
    const p = this.pan(rnd(-0.4, 0.4), 1);
    this.burst(this.brown, 2.6, 'lowpass', 160, 0, 0.7, p, 0, 0.5);
    this.burst(this.noise, 1.8, 'bandpass', 600, 0.6, 0.14, p, 0.2, 0.4);
    let at = 0.3;
    for (let i = 0; i < 10; i++) {
      this.bubble(p, rnd(80, 260), rnd(0.06, 0.14), 0.09, at);
      at += rnd(0.03, 0.12);
    }
    const f0 = rnd(55, 75);
    this.squeak(this.lowpass(700, pick(this.pipes)), f0, f0 * 0.75, 2.2, 0.12, 0.8, 0.06, 7);
  }

  /** Спад: вода уходит — шум потока откатывается, стоки глубоко всасывают и глотают, вздыхает труба. */
  private cueEbb() {
    const p = this.pan(rnd(-0.5, 0.5), 1.1);
    const s = this.burst(this.noise, 4, 'lowpass', 1600, 0, 0.18, p, 0, 0.4);
    s.flt.frequency.exponentialRampToValueAtTime(250, s.t + 4);
    const f = rnd(95, 150);
    let at = 0.5;
    for (let i = 0; i < 6; i++) {
      this.bubble(p, f * (1 - 0.07 * i), 0.14, 0.12, at);
      this.burst(this.brown, 0.14, 'lowpass', 240, 0, 0.14, p, at, 0.01);
      at += rnd(0.2, 0.45);
    }
    this.pipe('sigh');
  }

  /** Штиль: последний глоток стока, где-то встал на место затвор; остаются капли и струи. */
  private cueCalm() {
    const p = this.pan(rnd(-0.6, 0.6), 1.2);
    this.bubble(p, rnd(90, 130), 0.25, 0.12, 0);
    this.bubble(p, rnd(120, 160), 0.18, 0.08, 0.3);
    this.clang(this.lowpass(900, p), rnd(90, 130), 0.08, 1.4, 1.2);
    this.dripIn = Math.min(this.dripIn, 0.4);
  }

  /** Вдох перед погружением — и вода смыкается над головой (глухой «бульк», пузыри). */
  private gasp() {
    const p = this.selfOut(0.25);
    const d = 0.38;
    const s = this.burst(this.noise, d, 'bandpass', 650, 1.3, 0.6, p, 0, 0.14);
    s.flt.frequency.exponentialRampToValueAtTime(2100, s.t + d);
    this.voice(p, 210, 260, d * 0.9, 0.05, 0.03, [850, 1400], 0.12);
    const lp = this.lowpass(900, this.self);
    this.burst(this.brown, 0.45, 'lowpass', 300, 0, 0.45, lp, d + 0.02, 0.02);
    this.burst(this.noise, 0.3, 'bandpass', 500, 0.8, 0.12, lp, d + 0.02, 0.01);
    let at = d + 0.08;
    for (let i = 0; i < 6; i++) {
      this.bubble(lp, rnd(250, 800), rnd(0.03, 0.07), 0.07, at);
      at += rnd(0.02, 0.08);
    }
    this.bubbleIn = Math.max(this.bubbleIn, at + 0.3);
  }

  /** Воздух кончился: захлёб — глухой кашель, каждый толчок выбивает пузыри. */
  private choke() {
    const lp = this.lowpass(this.under ? 650 : 2200, this.self);
    const n = 3 + Math.floor(Math.random() * 2);
    let at = 0;
    for (let i = 0; i < n; i++) {
      this.burst(this.brown, 0.14, 'lowpass', 500, 0, 0.5, lp, at, 0.01);
      this.burst(this.noise, 0.12, 'bandpass', 900, 1, 0.25, lp, at, 0.008);
      this.voice(lp, rnd(120, 150), rnd(85, 100), 0.14, 0.06, at, [550, 1000], 0.01);
      let bt = at + 0.03;
      for (let j = 0; j < 4 + Math.floor(Math.random() * 5); j++) {
        this.bubble(lp, rnd(220, 1100), rnd(0.03, 0.08), 0.08, bt);
        bt += rnd(0.012, 0.05);
      }
      at += rnd(0.22, 0.38);
    }
  }

  /** Урон: глухой удар в груди и стон сквозь зубы (под водой — глухо, с пузырями). Не чаще раза в 0.3 с. */
  private hurt() {
    const now = this.ctx!.currentTime;
    if (now - this.hurtAt < 0.3) return;
    this.hurtAt = now;
    const lp = this.lowpass(this.under ? 700 : 2400, this.self);
    this.tone('sine', rnd(70, 82), 36, 0.32, 0.5, lp, 0, 0.004);
    this.burst(this.brown, 0.28, 'lowpass', 220, 0, 0.5, lp, 0, 0.004);
    this.voice(lp, rnd(100, 120), rnd(78, 90), rnd(0.35, 0.55), 0.07, 0.04, [480, 900], 0.05);
    if (this.under) {
      let at = 0.05;
      for (let i = 0; i < 4; i++) {
        this.bubble(lp, rnd(250, 700), rnd(0.03, 0.07), 0.06, at);
        at += rnd(0.02, 0.07);
      }
    }
  }

  /** Утонул: последние редкие пузыри, медленный удар сердца, гул уходит вниз — и всё затухает (update держит тишину). */
  private dead() {
    this.deadT = 4;
    this.pantN = 0;
    const lp = this.lowpass(500, this.self);
    let at = 0.1;
    for (let i = 0; i < 5; i++) {
      this.bubble(lp, rnd(200, 500), rnd(0.05, 0.1), 0.06 * (1 - i / 6), at);
      at += rnd(0.25, 0.6);
    }
    this.beat(0.8, 1.4, 0.5);
    this.beat(0.45, 1.8, 2.1);
    this.tone('sawtooth', 46, 24, 4, 0.25, this.lowpass(110, this.self), 0.05, 0.6);
    this.burst(this.brown, 3.5, 'lowpass', 90, 0, 0.6, this.self, 0, 0.3);
  }

  /** Всплыл после долгого нырка: жадный хриплый вдох, вода стекает с головы, кашель, потом одышка. */
  private breathe() {
    const p = this.selfOut(0.35);
    const d = 0.6;
    const s = this.burst(this.noise, d, 'bandpass', 600, 1.2, 0.75, p, 0, 0.06);
    s.flt.frequency.exponentialRampToValueAtTime(1900, s.t + d);
    this.voice(p, 180, 250, d, 0.07, 0.02, [800, 1300], 0.05);
    this.burst(this.noise, 0.7, 'highpass', 2200, 0, 0.06, p, 0, 0.02);
    this.burst(this.noise, 0.3, 'bandpass', 900, 0.8, 0.08, p, 0, 0.01);
    let at = d + 0.15;
    for (let i = 0; i < 1 + Math.floor(Math.random() * 2); i++) {
      this.burst(this.noise, 0.12, 'bandpass', 1100, 0.9, 0.3, p, at, 0.006);
      this.voice(p, rnd(140, 170), rnd(100, 115), 0.13, 0.06, at, [600, 1200], 0.008);
      at += rnd(0.25, 0.4);
    }
    this.pantN = 4;
    this.pantIn = at + 0.6;
  }

  /** Перелаз через трубу: одежда скребёт по металлу (stick-slip), звякнула пряжка, ботинок стукнул — труба гудит. */
  private climb() {
    const p = this.pan(rnd(-0.15, 0.15), 0.5);
    const d = rnd(0.6, 0.9);
    const s = this.burst(this.noise, d, 'bandpass', rnd(1400, 1900), 1.3, 0.22, this.chop(p, rnd(24, 38), 0.5, 0, d), 0, d * 0.25);
    s.flt.frequency.linearRampToValueAtTime(rnd(2200, 2800), s.t + d);
    this.burst(this.noise, d * 0.8, 'bandpass', 800, 0.7, 0.1, p, 0.05, 0.08);
    this.clang(p, rnd(380, 560), 0.05, 1.1, rnd(0.1, 0.3));
    this.clang(pick(this.pipes), rnd(120, 170), 0.09, 1.4, rnd(0.35, 0.55));
    this.burst(this.brown, 0.08, 'lowpass', 300, 0, 0.25, p, 0.4, 0.003);
  }

  /** Задел бутылку: звяк, отскок и долгий перекат по камню с мелкими «тинь» — пока не упрётся в стену.
   *  В воде (по щиколотку и глубже) — глухой звяк и «бульк». */
  private clink() {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const a = rnd(-0.5, 0.5);
    const pn = ctx.createStereoPanner();
    pn.pan.value = a;
    this.out(pn, 0.6);
    const base = rnd(1150, 1750);
    if (this.depth > 0.15) {
      const lp = this.lowpass(1400, pn);
      this.glass(lp, base, 0.7);
      this.bubble(lp, rnd(160, 260), 0.12, 0.12, 0.05);
      this.bubble(lp, rnd(300, 480), 0.07, 0.07, 0.16);
      this.burst(this.noise, 0.18, 'bandpass', 700, 0.9, 0.06, lp, 0.02, 0.01);
      return;
    }
    this.glass(pn, base, 1);
    this.glass(pn, base, 0.45, rnd(0.09, 0.14));
    // перекат: шорох стекла по камню с биением оборотов (обороты замедляются), панорама уезжает
    const t0 = 0.15;
    const dur = rnd(1.4, 2.4);
    pn.pan.setValueAtTime(a, t + t0);
    pn.pan.linearRampToValueAtTime(clamp(a + rnd(-0.6, 0.6), -0.9, 0.9), t + t0 + dur);
    const ch = ctx.createGain();
    ch.gain.value = 0.6;
    const lfo = ctx.createOscillator();
    lfo.type = 'triangle';
    lfo.frequency.setValueAtTime(rnd(8, 11), t + t0);
    lfo.frequency.linearRampToValueAtTime(2.5, t + t0 + dur);
    const lg = ctx.createGain();
    lg.gain.value = 0.4;
    lfo.connect(lg).connect(ch.gain);
    lfo.start(t + t0);
    lfo.stop(t + t0 + dur + 0.1);
    ch.connect(pn);
    const r = this.burst(this.noise, dur, 'bandpass', rnd(2300, 3200), 3, 0.05, ch, t0, 0.05);
    r.flt.frequency.linearRampToValueAtTime(1800, r.t + dur);
    this.burst(this.brown, dur, 'lowpass', 400, 0, 0.06, ch, t0, 0.05);
    for (let i = 0; i < 3 + Math.floor(Math.random() * 4); i++) this.glass(pn, base * rnd(0.97, 1.03), rnd(0.08, 0.2), t0 + rnd(0.05, dur));
    this.glass(pn, base, 0.3, t0 + dur);
  }

  /** Всё остановить и закрыть контекст (повторный вызов — ничего). */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.lay = null;
    this.roarF = null;
    this.pipes = [];
    this.muf = [];
    const c = this.ctx;
    this.ctx = null;
    if (c) c.close().catch(() => {});
  }
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

/** Кривая tanh: единичное усиление у нуля, потолок ≈ 0.76 (−2.4 дБFS). */
function softClip(): Float32Array<ArrayBuffer> {
  const n = 2048;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = Math.tanh((i * 2) / (n - 1) - 1);
  return c;
}
