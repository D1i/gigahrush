// Звук «Улыбки» — моба общаги (tmp/smile-wip/CONTRACT.md §1, §6). Процедурный WebAudio, без файлов: всё, что сложнее
// писка, синтезируется по сэмплам в JS (формантный голос, моды-резонаторы, трение «stick-slip», зёрна шума) и играется
// буфером; непрерывное (писк в ушах) — узлами. По образцу obshagaAudio.ts (граф выхода, HRTF, слушатель) и
// catacombsAudio.ts (сердце, удушье).
//  • сердце (setHeart): «лаб-даб» + низкий толчок в грудь; темп и громкость плавно идут за уровнем (0.35 ≈ 75 уд/мин
//    глухо, 0.6 ≈ 110, 1 ≈ 170 — громко, с перегрузом, толчком крови «в горле» и шумом в ушах); удары планируются
//    из update() на 0.3 с вперёд;
//  • писк в ушах (setRing): тонкие синусы 6–10 кГц парами с биениями, в ушах разные, чуть шума, медленно плавает;
//    глушит мир (до −3 дБ и срез верха) — сердце, своё удушье и стингер не глушит;
//  • хруст вдалеке (crunch): трески кости (моды), хвост мелкого треска, мокрое хлюпанье, глухой удар; HRTF в точке,
//    обратный закон, верх срезан, эхо коридора — посыл ДО расстояния (вдали эха больше, чем прямого звука);
//  • разрыв лица (tear): кожа тянется (трение), мокрый густой треск рвущейся плоти, щелчок вывихнутой челюсти, капли;
//  • дверь-ловушка (creakShut): тихий долгий скрип (срывы трения по модам полотна), стук о косяк, язычок, ключ, засов;
//  • лампочки (shatter): 2–3 хлопка над головой (треск нити, хлопок колбы, звон), осколки звенят об пол через ~0.7 с;
//  • смех (laugh): девичье хихиканье «хи-хи-хи» / «ха-ха» — формантный голос 350–450 Гц с джиттером и придыханием,
//    иногда шёпотом или дрожащим «хиииии», между очередями — всхлип-вдох; каждая очередь — в точке around() на момент
//    очереди и едет дальше со скоростью этой точки;
//  • удушье (choke): сдавленные попытки вдоха (стридор с обрывом «гк»), бульканье, щелчки горла — всё слабее и реже;
//  • бросок (pounce): визг-выдох и удар в тело (+ свой короткий выдох); еда (eat): чавканье, рвущаяся плоть, хлюпанье,
//    сопение; стингер (sting): удар, кластер «смычков» секундами и четвертьтонами, низкий кластер, шумовой нарост.
// Выход: мир → (глушение писком) → затухание → мастер → компрессор → мягкий клип (≈ −2.4 дБFS). NaN/Infinity не доходят
// до AudioParam, исключения наружу не летят. AudioContext свой — создаётся в resume() по жесту (паузу ставит
// pauseAudio.ts сам). Координаты — мировые Babylon (x вправо, z вперёд = −план.y), WebAudio правосторонний: z → −z.
// Слушатель: глаза + yaw камеры (rotation.y): вперёд = (sin yaw, 0, cos yaw).
//
// ИНТЕГРАЦИЯ:
//   const sa = new SmileAudio();   sa.resume() — из клика / клавиши (до этого все вызовы — тихие no-op, уровни
//   setHeart/setRing запоминаются);   sa.update(eye, yaw, dt) — КАЖДЫЙ кадр (слушатель, плавное сердце, планировщик
//   ударов / смеха / удушья / еды);   sa.setHeart(view.heart); sa.setRing(view.ring) — можно каждый кадр;
//   события — по SmileEvent (crunch/tear/creakShut/shatter/laugh/choke/pounce/eat/sting);
//   sa.fade(false) — ушли из биома (плавно в тишину, сердце и очереди стоп), sa.fade(true) — вернулись;  sa.dispose().
//   pounce(p?) / eat(durS, p?) — без точки звучат «у самого слушателя» (жертва), с точкой — в мире (для остальных).
//   Проверка: tools/smile-audio-preview.html (кнопки, ползунки, «записать всё» — OfflineAudioContext: пики/RMS/NaN).

type V3 = { readonly x: number; readonly y: number; readonly z: number };

const TAU = Math.PI * 2;
/** громкость мастера (как у остальных модулей звука) */
const MASTER = 0.8;
/** на сколько вперёд планировать удары сердца и очереди смеха / удушья / еды, с */
const LOOKAHEAD = 0.3;

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
/** целое a…b включительно */
const irnd = (a: number, b: number) => Math.min(b, Math.floor(rnd(a, b + 1)));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const clamp01 = (v: number) => clamp(v, 0, 1);
/** NaN/Infinity не должны дойти до AudioParam (бросает исключение). */
const fin = (v: number, d = 0) => (Number.isFinite(v) ? v : d);
const nz = () => Math.random() * 2 - 1;
const okV = (p: V3 | null | undefined): p is V3 => !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);

// ───────────────────────── чистые функции ─────────────────────────

/** Темп сердца, уд/мин, по уровню 0…1 (кусочно-линейно): 0 → 62, 0.35 → 75, 0.6 → 110, 1 → 170. */
export function heartBpm(level: number): number {
  const l = clamp01(fin(level));
  if (l <= 0.35) return lerp(62, 75, l / 0.35);
  if (l <= 0.6) return lerp(75, 110, (l - 0.35) / 0.25);
  return lerp(110, 170, (l - 0.6) / 0.4);
}

/** Громкость удара сердца 0…1 по уровню (< 0.02 — не бьётся): 0.35 — глухо (≈ −12 дБ от полного), 0.6 ≈ −6 дБ. */
export function heartGain(level: number): number {
  const l = clamp01(fin(level));
  return l < 0.02 ? 0 : Math.pow(l, 1.3);
}

/** Амплитуда писка (главная пара синусов) по уровню: 0.25 — еле слышно (≈ −44 дБ), 0.6 — пронзительно (≈ −30 дБ). */
export function ringGain(level: number): number {
  return 0.085 * Math.pow(clamp01(fin(level)), 1.9);
}

/** Плавное приближение к цели с разной постоянной времени вверх и вниз (tau ≤ 0 — мгновенно). */
export function smoothLevel(cur: number, target: number, dt: number, tauUp: number, tauDown: number): number {
  const tau = target > cur ? tauUp : tauDown;
  if (tau <= 0) return target;
  return target + (cur - target) * Math.exp(-Math.max(0, dt) / tau);
}

// ───────────────────────── синтез по сэмплам ─────────────────────────

/** Двухполюсный резонатор Клатта (единичное усиление на нуле) — форманты голоса. */
class Rz {
  private a = 1;
  private b = 0;
  private c = 0;
  private y1 = 0;
  private y2 = 0;
  set(sr: number, f: number, bw: number) {
    const r = Math.exp((-Math.PI * Math.max(10, bw)) / sr);
    this.c = -r * r;
    this.b = 2 * r * Math.cos((TAU * clamp(f, 20, sr * 0.45)) / sr);
    this.a = 1 - this.b - this.c;
  }
  run(x: number) {
    const y = this.a * x + this.b * this.y1 + this.c * this.y2;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/** Мода: импульс 1 → затухающий синус амплитуды ≈ 1 (dec — спад в e раз, с). Полотно двери, кость, стекло. */
class Md {
  private s = 0;
  private b = 0;
  private c = 0;
  private y1 = 0;
  private y2 = 0;
  set(sr: number, f: number, dec: number): this {
    const w = (TAU * clamp(f, 20, sr * 0.45)) / sr, r = Math.exp(-1 / (Math.max(1e-4, dec) * sr));
    this.s = Math.sin(w);
    this.b = 2 * r * Math.cos(w);
    this.c = -r * r;
    return this;
  }
  run(x: number) {
    const y = this.s * x + this.b * this.y1 + this.c * this.y2;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/** Биквад RBJ: полоса (0 дБ на центре), низкие, высокие. */
class Bq {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  constructor(private readonly sr: number) {}
  private w(f: number) {
    return (TAU * clamp(fin(f, 1000), 5, this.sr * 0.45)) / this.sr;
  }
  bp(f: number, q: number): this {
    const w = this.w(f), al = Math.sin(w) / (2 * Math.max(0.05, q)), a0 = 1 + al;
    this.b0 = al / a0;
    this.b1 = 0;
    this.b2 = -al / a0;
    this.a1 = (-2 * Math.cos(w)) / a0;
    this.a2 = (1 - al) / a0;
    return this;
  }
  hp(f: number, q = 0.707): this {
    const w = this.w(f), al = Math.sin(w) / (2 * q), c = Math.cos(w), a0 = 1 + al;
    this.b0 = (1 + c) / 2 / a0;
    this.b1 = -(1 + c) / a0;
    this.b2 = this.b0;
    this.a1 = (-2 * c) / a0;
    this.a2 = (1 - al) / a0;
    return this;
  }
  run(x: number) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/** Однополюсный низкий фильтр. */
class Op {
  private k = 0;
  private y = 0;
  constructor(sr: number, f: number) {
    this.k = 1 - Math.exp((-TAU * clamp(f, 1, sr * 0.45)) / sr);
  }
  run(x: number) {
    return (this.y += this.k * (x - this.y));
  }
}

/** Множитель, приводящий белый шум после полосы f/q к той же RMS (≈ 0.58), что и сам шум. */
const bpNorm = (sr: number, f: number, q: number) => 1 / Math.sqrt(Math.max(1e-6, ((Math.PI / 2) * (f / Math.max(0.05, q))) / (sr / 2)));

/** Низкий шум (два однополюсника на fc), RMS ≈ как у белого. */
class LpN {
  private a: Op;
  private b: Op;
  private g: number;
  constructor(sr: number, fc: number) {
    this.a = new Op(sr, fc);
    this.b = new Op(sr, fc);
    this.g = 1 / Math.sqrt(Math.max(1e-6, (Math.PI * fc) / 4 / (sr / 2)));
  }
  run() {
    return this.g * this.b.run(this.a.run(nz()));
  }
}

/** «Зёрна»: случайные (Пуассон) всплески rate/с со спадом dec — огибающая мокрых и рвущихся текстур (≈ 0…1.5). */
class Grains {
  private v = 0;
  private k: number;
  private p: number;
  constructor(private readonly sr: number, rate: number, dec: number) {
    this.k = Math.exp(-1 / (Math.max(1e-4, dec) * sr));
    this.p = rate / sr;
  }
  rate(r: number) {
    this.p = Math.max(0, r) / this.sr;
  }
  run() {
    if (Math.random() < this.p) this.v += rnd(0.3, 1);
    this.v *= this.k;
    return this.v;
  }
}

/** атака a / спад d (экспоненты), 0 до t = 0 */
const ad = (t: number, a: number, d: number) => (t <= 0 ? 0 : (1 - Math.exp(-t / a)) * Math.exp(-t / d));
const sstep = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
/** окно: плавный подъём за a от t0, плавный спад за r к t1 */
const win = (t: number, t0: number, t1: number, a: number, r: number) => sstep((t - t0) / Math.max(1e-4, a)) * sstep((t1 - t) / Math.max(1e-4, r));

const buf = (sr: number, sec: number) => new Float32Array(Math.max(1, Math.ceil(sr * Math.max(0, fin(sec)))));

/** К пику peak; NaN/Infinity или тишина — буфер обнуляется. */
function norm(d: Float32Array, peak: number): Float32Array {
  let m = 0, s = 0;
  for (let i = 0; i < d.length; i++) {
    const v = d[i];
    s += v;
    const a = v < 0 ? -v : v;
    if (a > m) m = a;
  }
  if (!Number.isFinite(s) || !(m > 1e-9)) {
    d.fill(0);
    return d;
  }
  const k = peak / m;
  for (let i = 0; i < d.length; i++) d[i] *= k;
  return d;
}

/** Края буфера — к нулю (без щелчков в начале и в конце). */
function edges(d: Float32Array, sr: number, sec = 0.003): Float32Array {
  const n = Math.min(d.length >> 1, Math.ceil(sr * sec));
  for (let i = 0; i < n; i++) {
    const k = i / n;
    d[i] *= k;
    d[d.length - 1 - i] *= k;
  }
  return d;
}

function mix(dst: Float32Array, src: Float32Array, at: number, gain = 1) {
  const i0 = Math.max(0, Math.round(at));
  const n = Math.min(src.length, dst.length - i0);
  for (let i = 0; i < n; i++) dst[i0 + i] += src[i] * gain;
}

/** Мода с момента t0, с: amp·sin·e^(−t/dec). */
function addMode(d: Float32Array, sr: number, t0: number, f: number, dec: number, amp: number) {
  if (f >= sr * 0.45 || f <= 0) return;
  const i0 = Math.max(0, Math.round(t0 * sr));
  const n = Math.min(d.length - i0, Math.ceil(dec * 7 * sr));
  const w = (TAU * f) / sr, k = Math.exp(-1 / (Math.max(1e-5, dec) * sr));
  let e = amp;
  for (let j = 0; j < n; j++) {
    d[i0 + j] += e * Math.sin(w * j) * (j < 12 ? j / 12 : 1);
    e *= k;
  }
}

/** Широкий щелчок: белый шум со спадом dec. */
function addClick(d: Float32Array, sr: number, t0: number, dec: number, amp: number) {
  const i0 = Math.max(0, Math.round(t0 * sr));
  const n = Math.min(d.length - i0, Math.ceil(dec * 6 * sr));
  const k = Math.exp(-1 / (Math.max(1e-5, dec) * sr));
  let e = amp;
  for (let j = 0; j < n; j++) {
    d[i0 + j] += e * nz() * (j < 4 ? j / 4 : 1);
    e *= k;
  }
}

/** Глухой удар: синус с падающей высотой f0 → f1 и низкий шум, спад dec. */
function addThud(d: Float32Array, sr: number, t0: number, f0: number, f1: number, dec: number, amp: number) {
  const i0 = Math.max(0, Math.round(t0 * sr));
  const n = Math.min(d.length - i0, Math.ceil(dec * 6 * sr));
  const ln = new LpN(sr, 170);
  let ph = 0;
  for (let j = 0; j < n; j++) {
    const t = j / sr;
    ph += (TAU * (f1 + (f0 - f1) * Math.exp(-t / (dec * 0.5)))) / sr;
    d[i0 + j] += amp * ad(t, 0.002, dec) * (Math.sin(ph) + 0.35 * ln.run() * Math.exp(-t / (dec * 0.4)));
  }
}

/** Пузырь / хлюп: синус, высота растёт f0 → f1, быстрый подъём и спад. */
function addChirp(d: Float32Array, sr: number, t0: number, f0: number, f1: number, dur: number, amp: number) {
  const i0 = Math.max(0, Math.round(t0 * sr));
  const n = Math.min(d.length - i0, Math.ceil(dur * sr));
  let ph = 0;
  for (let j = 0; j < n; j++) {
    const u = j / Math.max(1, n);
    ph += (TAU * f0 * Math.pow(f1 / f0, u)) / sr;
    d[i0 + j] += amp * sstep(u * 6) * (1 - u) * (1 - u) * Math.sin(ph);
  }
}

/** Шум через полосу f0 → f1 (экспоненциально), окно win(a, r), × (base + зёрна), если зёрна заданы. */
function addNoise(d: Float32Array, sr: number, t0: number, dur: number, f0: number, f1: number, q: number, amp: number, att: number, rel: number, gr: Grains | null = null, base = 1) {
  const i0 = Math.max(0, Math.round(t0 * sr));
  const n = Math.min(d.length - i0, Math.ceil(dur * sr));
  const bq = new Bq(sr);
  let g = 1;
  for (let j = 0; j < n; j++) {
    if ((j & 31) === 0) {
      const f = f0 * Math.pow(f1 / f0, j / Math.max(1, n));
      bq.bp(f, q);
      g = bpNorm(sr, f, q);
    }
    const t = j / sr;
    d[i0 + j] += amp * g * win(t, 0, dur, att, rel) * (gr ? base + gr.run() : 1) * bq.run(nz());
  }
}

/** Низкий шум (fc) с окном. */
function addLpNoise(d: Float32Array, sr: number, t0: number, dur: number, fc: number, amp: number, att: number, rel: number) {
  const i0 = Math.max(0, Math.round(t0 * sr));
  const n = Math.min(d.length - i0, Math.ceil(dur * sr));
  const ln = new LpN(sr, fc);
  for (let j = 0; j < n; j++) d[i0 + j] += amp * win(j / sr, 0, dur, att, rel) * ln.run();
}

/** Мелкий треск: Пуассон rate/с (густота спадает с постоянной decT), каждый — короткая мода fLo…fHi. */
function addCrackle(d: Float32Array, sr: number, t0: number, dur: number, rate: number, fLo: number, fHi: number, amp: number, decT: number) {
  let t = 0;
  for (let guard = 0; guard < 4000; guard++) {
    t += -Math.log(1 - Math.random() * 0.999) / Math.max(1, rate);
    if (t >= dur) break;
    const k = Math.exp(-t / Math.max(1e-3, decT));
    if (Math.random() > k) continue;
    addMode(d, sr, t0 + t, rnd(fLo, fHi), rnd(0.0006, 0.002), amp * rnd(0.2, 1));
  }
}

/**
 * Трение «stick-slip»: срывы с частотой rateAt(t) (джиттер ±15%), сила envAt(t), каждый срыв бьёт по модам [f, спад, вес]
 * и даёт короткий шорох. Скрип двери, растяжение кожи.
 */
function stickSlip(d: Float32Array, sr: number, t0: number, dur: number, rateAt: (t: number) => number, envAt: (t: number) => number, modes: readonly (readonly [number, number, number])[], hiss = 0.15) {
  const i0 = Math.max(0, Math.round(t0 * sr));
  const n = Math.min(d.length - i0, Math.ceil((dur + 0.1) * sr));
  const md = modes.map(([f, dec]) => new Md().set(sr, f, dec));
  const w = modes.map((m) => m[2]);
  const hk = Math.exp(-1 / (0.0004 * sr));
  let next = 0, gr = 0;
  for (let j = 0; j < n; j++) {
    const t = j / sr;
    let x = 0;
    if (t >= next && t < dur) {
      const r = Math.max(5, fin(rateAt(t), 40));
      // частые срывы отдают модам больше энергии — сила ∝ 1/√частоты
      x = fin(envAt(t)) * rnd(0.6, 1) * Math.min(1, Math.sqrt(60 / r));
      next = t + rnd(0.85, 1.15) / r;
      gr = x;
    }
    let y = 0;
    for (let k = 0; k < md.length; k++) y += w[k] * md[k].run(x);
    gr *= hk;
    d[i0 + j] += y + hiss * gr * nz();
  }
}

/** Рвущаяся плоть: густеющий мокрый треск (моды 0.7–3.8 кГц), полоса шума вверх с дрожью, мокрый низ по зёрнам. */
function rip(d: Float32Array, sr: number, t0: number, dur: number, amp: number, wet: number) {
  const i0 = Math.max(0, Math.round(t0 * sr));
  const n = Math.min(d.length - i0, Math.ceil(dur * sr));
  const band = new Bq(sr), flut = new Grains(sr, 70, 0.006), wg = new Grains(sr, 30, 0.015), wl = new LpN(sr, 520);
  const bank = [new Md().set(sr, rnd(650, 800), 0.002), new Md().set(sr, rnd(1200, 1500), 0.0015), new Md().set(sr, rnd(2000, 2500), 0.0012), new Md().set(sr, rnd(3100, 3800), 0.0009)];
  let bg = 1;
  for (let j = 0; j < n; j++) {
    const t = j / sr, u = t / dur;
    // рвётся всё быстрее, в конце — обрыв
    const dens = sstep(u / 0.18) * (u < 0.8 ? 0.7 + (0.3 * u) / 0.8 : sstep((1 - u) / 0.2));
    if ((j & 31) === 0) {
      const fc = lerp(900, 2400, u);
      band.bp(fc, 2.2);
      bg = bpNorm(sr, fc, 2.2);
      flut.rate(40 + 120 * u);
    }
    const sel = Math.random() < ((250 + 850 * dens) * dens) / sr ? Math.floor(Math.random() * 4) : -1;
    const x = sel >= 0 ? rnd(0.25, 1) * (Math.random() < 0.5 ? -1 : 1) : 0;
    let y = 0;
    for (let k = 0; k < 4; k++) y += bank[k].run(k === sel ? x : 0);
    y *= 0.8;
    y += 0.3 * dens * band.run(nz()) * bg * (0.3 + flut.run());
    y += wet * 0.45 * dens * wl.run() * (0.25 + wg.run());
    d[i0 + j] += amp * y;
  }
}

/** Щелчок челюсти: сухой «клац», костяной стук, низкий толчок. */
function jaw(d: Float32Array, sr: number, t: number, k: number) {
  addMode(d, sr, t, rnd(1800, 2100), 0.0035, k);
  addMode(d, sr, t, rnd(3100, 3500), 0.002, 0.6 * k);
  addMode(d, sr, t, rnd(850, 950), 0.006, 0.5 * k);
  addMode(d, sr, t, rnd(150, 190), 0.025, 0.5 * k);
  addClick(d, sr, t, 0.0006, 0.6 * k);
}

/** Осколок стекла: негармонические обертоны с коротким спадом + щелчок. */
function tink(d: Float32Array, sr: number, t: number, base: number, amp: number) {
  const r = [1, rnd(2.3, 2.9), rnd(4.0, 5.1), rnd(6.3, 7.7)], a = [1, 0.55, 0.35, 0.2], dk = [1, 0.6, 0.4, 0.3];
  const dec = rnd(0.015, 0.06);
  for (let k = 0; k < 4; k++) addMode(d, sr, t, base * r[k], dec * dk[k], amp * a[k]);
  addClick(d, sr, t, 0.0003, amp * 0.4);
}

// ── голос ──

interface Vp {
  f0: number;
  /** громкость голоса (связки) */
  v: number;
  /** громкость придыхания (шум) */
  a: number;
  F: readonly number[];
  B: readonly number[];
}
interface VoiceOpt {
  /** доля открытой фазы связок (больше — мягче, с придыханием) */
  oq?: number;
  jitter?: number;
  shimmer?: number;
  /** «двоение» периода (хрип, визг) 0…1 */
  rough?: number;
  /** доля шума «х» мимо тракта (полоса ~1.5–6 кГц) */
  hiss?: number;
  /** предыскажение (подъём верха, излучение ртом) 0…0.95: без него голос глухой */
  pre?: number;
}

/**
 * Голос (формантный синтез): источник — производная импульса Розенберга с джиттером / шиммером / «двоением»; шум
 * придыхания (модулирован потоком через связки); каскад резонаторов Клатта по формантам. at(t) зовётся раз в 32 сэмпла.
 */
function voice(sr: number, dur: number, at: (t: number) => Vp, o: VoiceOpt = {}): Float32Array {
  const d = buf(sr, dur);
  const oq = clamp(o.oq ?? 0.7, 0.2, 0.95), tp = oq * 0.72, tn = oq * 0.28;
  const jit = o.jitter ?? 0.015, shim = o.shimmer ?? 0.08, rough = o.rough ?? 0, hissK = o.hiss ?? 0.6, pre = clamp(o.pre ?? 0.8, 0, 0.95);
  const rs = [new Rz(), new Rz(), new Rz(), new Rz(), new Rz()];
  const hp = new Bq(sr).hp(110, 0.7), hiss = new Bq(sr).bp(3200, 0.8);
  let ph = 0, pm = 1, am = 1, odd = false, nf = 0, prev = 0;
  let p = at(0);
  for (let i = 0; i < d.length; i++) {
    if ((i & 31) === 0) {
      p = at(i / sr);
      nf = Math.min(rs.length, p.F.length);
      for (let k = 0; k < nf; k++) rs[k].set(sr, p.F[k], p.B[k] ?? 150);
    }
    ph += (Math.max(15, fin(p.f0, 200)) * pm) / sr;
    if (ph >= 1) {
      ph -= Math.floor(ph);
      odd = !odd;
      pm = 1 + nz() * jit + (rough > 0 ? (odd ? 0.22 : -0.22) * rough : 0);
      am = (1 + nz() * shim) * (rough > 0 && odd ? 1 - 0.55 * rough : 1);
    }
    let fl = 0, dfl = 0;
    if (ph < tp) {
      const x = (Math.PI * ph) / tp;
      fl = 0.5 * (1 - Math.cos(x));
      dfl = ((0.5 * Math.PI) / tp) * Math.sin(x);
    } else if (ph < tp + tn) {
      const x = (Math.PI * (ph - tp)) / (2 * tn);
      fl = Math.cos(x);
      dfl = (-Math.PI / (2 * tn)) * Math.sin(x);
    }
    const n = nz();
    let y = dfl * ((2 * tn) / Math.PI) * p.v * am + n * p.a * (p.v > 0.02 ? 0.35 + 0.65 * fl : 1);
    for (let k = 0; k < nf; k++) y = rs[k].run(y);
    const yo = hp.run(y);
    d[i] = yo - pre * prev + hissK * p.a * hiss.run(n);
    prev = yo;
  }
  return d;
}

/** Гласные девушки: форманты и полосы, Гц. inh — вдох-всхлип (широкие форманты). */
const VW: Record<'i' | 'I' | 'e' | 'a' | 'inh', { F: readonly number[]; B: readonly number[] }> = {
  i: { F: [400, 2800, 3500, 4600, 5600], B: [80, 160, 240, 320, 400] },
  I: { F: [480, 2450, 3200, 4400, 5500], B: [90, 160, 240, 320, 400] },
  e: { F: [620, 2300, 3050, 4300, 5500], B: [90, 150, 240, 320, 400] },
  a: { F: [920, 1500, 2850, 4200, 5400], B: [120, 140, 240, 320, 400] },
  inh: { F: [560, 2200, 3300, 4500, 5600], B: [220, 260, 320, 400, 480] },
};

interface GiggleOpt {
  /** слогов в очереди */
  n: number;
  f0: number;
  vw: 'i' | 'I' | 'e' | 'a';
  /** шёпотом (без связок) */
  whisper: boolean;
  /** всхлип-вдох в конце */
  inhale: boolean;
  /** одно дрожащее «хиииии» вместо очереди */
  long: boolean;
}

/** Очередь хихиканья: «х» придыхания → короткая гласная; высота к концу очереди падает; в конце — вдох. Пик 1. */
function synthGiggle(sr: number, o: GiggleOpt): Float32Array {
  type Syl = { t0: number; h: number; v: number; f: number; amp: number; fk: number };
  const syl: Syl[] = [];
  let t = 0.012;
  if (o.long) {
    const s: Syl = { t0: t, h: 0.06, v: rnd(0.42, 0.6), f: o.f0 * rnd(1.2, 1.35), amp: 1, fk: 1 };
    syl.push(s);
    t += s.h + s.v + 0.05;
  } else {
    for (let i = 0; i < o.n; i++) {
      const u = o.n > 1 ? i / (o.n - 1) : 0;
      const h = rnd(0.022, 0.04) * (i === 0 ? 1.5 : 1);
      const v = rnd(0.05, 0.078) * (i === 0 ? 1.25 : 1) * (i === o.n - 1 ? 1.5 : 1);
      syl.push({ t0: t, h, v, f: o.f0 * (1.07 - 0.25 * u) * rnd(0.97, 1.03), amp: (i === 0 ? 1 : rnd(0.72, 1)) * (1 - 0.35 * u), fk: rnd(0.97, 1.03) });
      t += h + v + rnd(0.03, 0.06);
    }
  }
  let i0 = 0, i1 = 0, sqT = -1, sqF = 0;
  if (o.inhale) {
    i0 = t + rnd(0.03, 0.08);
    i1 = i0 + rnd(0.16, 0.26);
    t = i1;
    if (Math.random() < 0.35) {
      sqT = lerp(i0, i1, rnd(0.35, 0.6));
      sqF = rnd(720, 950);
    }
  }
  const base = VW[o.vw];
  const F = [0, 0, 0, 0, 0];
  const out: Vp = { f0: o.f0, v: 0, a: 0, F, B: base.B };
  const d = voice(
    sr,
    t + 0.05,
    (tt) => {
      let v = 0, a = 0, f0 = o.f0, fk = 1, inh = false;
      for (const s of syl) {
        const tv = s.t0 + s.h, te = tv + s.v;
        if (tt < s.t0 - 0.002 || tt > te + 0.03) continue;
        a = s.amp * (0.5 * win(tt, s.t0, tv + 0.012, 0.008, 0.02) + 0.13 * win(tt, tv, te, 0.01, 0.03)) * (o.whisper ? 2.4 : 1);
        v = o.whisper ? 0 : s.amp * win(tt, tv - 0.004, te, 0.012, 0.028);
        const u = clamp01((tt - tv) / s.v);
        f0 = s.f * (o.long ? (1 - 0.28 * u) * (1 + 0.05 * Math.sin(TAU * 8.5 * tt)) : 1 + 0.07 * Math.sin(Math.PI * u) - 0.1 * Math.max(0, u - 0.55));
        fk = s.fk;
      }
      if (o.inhale && tt >= i0 - 0.01 && tt <= i1 + 0.01) {
        inh = true;
        a = 0.32 * win(tt, i0, i1, 0.05, 0.08);
        if (sqT > 0) {
          v = 0.3 * win(tt, sqT - 0.035, sqT + 0.035, 0.012, 0.02);
          f0 = sqF * (1 + (0.1 * (tt - sqT)) / 0.035);
        }
      }
      const src = inh ? VW.inh : base;
      for (let k = 0; k < 5; k++) F[k] = src.F[k] * (inh ? 1 : fk);
      out.f0 = f0;
      out.v = v;
      out.a = a;
      out.B = src.B;
      return out;
    },
    { oq: 0.66, jitter: 0.018, shimmer: 0.1, hiss: 1.0, pre: 0.9 },
  );
  return edges(norm(d, 1), sr);
}

// ── сердце ──

/** Один удар «лаб-даб» по уровню 0…1 (период — для зазора до «даб»); громкость уже учтена (heartGain). */
function synthBeat(sr: number, level: number, period: number): Float32Array {
  const L = clamp01(level), k = clamp01((L - 0.45) / 0.55);
  const gap = clamp(period * 0.34, 0.11, 0.3);
  const d = buf(sr, gap + 0.3);
  const n1 = new LpN(sr, 110), n2 = new LpN(sr, 130), wl = new LpN(sr, 260);
  const thr = new Bq(sr).bp(rnd(300, 380), 2.2), thrK = bpNorm(sr, 340, 2.2);
  let p1 = 0, p2 = 0, p3 = 0, p4 = 0, p5 = 0;
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    // «лаб»: 66 → 38 Гц
    p1 += (TAU * (38 + 28 * Math.exp(-t / 0.035))) / sr;
    let y = Math.sin(p1) * ad(t, 0.004, 0.06);
    // щелчок клапана: короткий толчок 120 → 75 Гц (слышно и на маленьких динамиках)
    p5 += (TAU * (75 + 45 * Math.exp(-t / 0.02))) / sr;
    y += 0.3 * Math.sin(p5) * ad(t, 0.002, 0.028);
    // грудь: 44 → 28 Гц, дольше
    p2 += (TAU * (28 + 16 * Math.exp(-t / 0.06))) / sr;
    y += 0.55 * (0.5 + 0.5 * L) * Math.sin(p2) * ad(t, 0.008, 0.11);
    // удар (низкий шум)
    y += 0.25 * n1.run() * ad(t, 0.002, 0.025);
    // «даб»: выше и короче
    const td = t - gap;
    if (td > 0) {
      p3 += (TAU * (46 + 30 * Math.exp(-td / 0.03))) / sr;
      y += 0.72 * Math.sin(p3) * ad(td, 0.003, 0.045) + 0.18 * n2.run() * ad(td, 0.002, 0.018);
    }
    // «в горле» (уровень > 0.45): толчок крови ~150 Гц и полоса 300 Гц
    const tt = t - 0.025;
    const th = thr.run(nz());
    if (k > 0 && tt > 0) {
      p4 += (TAU * (150 - 30 * Math.min(1, tt / 0.08))) / sr;
      y += k * (0.8 * Math.sin(p4) * ad(tt, 0.006, 0.055) + 0.2 * thrK * th * ad(tt, 0.01, 0.05));
    }
    // шум крови в ушах
    if (L > 0.25) y += (L - 0.25) * 0.35 * wl.run() * ad(t - 0.02, 0.04, 0.12);
    d[i] = y;
  }
  norm(d, 1);
  // перегруз растёт с уровнем; глухо при низком уровне — срез верха
  const drive = 1.8 + 3.5 * k * k, td = Math.tanh(drive);
  const fc = lerp(380, 1800, Math.pow(L, 1.5));
  const a = new Op(sr, fc), b = new Op(sr, fc);
  const g = heartGain(L) * 0.72;
  for (let i = 0; i < d.length; i++) d[i] = g * b.run(a.run(Math.tanh(drive * d[i]) / td));
  return edges(d, sr, 0.004);
}

// ── хруст, разрыв, дверь, лампочки ──

/** Далёкий хруст: 2–3 «укуса» — удар, трески кости, хвост мелкого треска, мокрое хлюпанье. Пик 1. */
function synthCrunch(sr: number): Float32Array {
  const ev = [0.03, 0.03 + rnd(0.28, 0.42)];
  if (Math.random() < 0.65) ev.push(ev[1] + rnd(0.22, 0.36));
  const d = buf(sr, ev[ev.length - 1] + 0.7);
  ev.forEach((te, k) => {
    const s = k === 0 ? 1 : rnd(0.6, 0.9);
    addThud(d, sr, te, rnd(85, 105), 42, 0.07, 0.36 * s);
    // главный треск: 2–4 щелчка за ~60 мс
    let tc = te + rnd(0, 0.012);
    for (let i = 0, n = irnd(2, 4); i < n; i++) {
      const a = s * rnd(0.6, 1);
      addMode(d, sr, tc, rnd(1100, 1600), 0.004, 0.9 * a);
      addMode(d, sr, tc, rnd(2200, 2900), 0.0028, 0.6 * a);
      addMode(d, sr, tc, rnd(3400, 4400), 0.0018, 0.4 * a);
      addClick(d, sr, tc, 0.0008, 0.5 * a);
      tc += rnd(0.008, 0.025);
    }
    // волокна, хрящ
    addCrackle(d, sr, te + 0.01, 0.22, 380, 1400, 5200, 0.3 * s, 0.07);
    // мокрое
    addNoise(d, sr, te + 0.015, rnd(0.22, 0.32), 1000, 320, 1.6, 0.3 * s, 0.01, 0.12, new Grains(sr, 60, 0.012), 0.35);
    for (let i = 0, n = irnd(1, 3); i < n; i++) addChirp(d, sr, te + rnd(0.05, 0.25), rnd(180, 320), rnd(500, 800), rnd(0.02, 0.04), 0.18 * s);
  });
  return edges(norm(d, 1), sr);
}

/** Разрыв лица: кожа тянется, мокрый разрыв, щелчок челюсти (и второй, тише), капли. Пик 1. */
function synthTear(sr: number): Float32Array {
  const d = buf(sr, 1.35);
  stickSlip(d, sr, 0, 0.32, (t) => lerp(55, 150, t / 0.32), (t) => 0.35 * win(t, 0, 0.32, 0.12, 0.06), [
    [rnd(380, 450), 0.02, 1],
    [rnd(950, 1150), 0.012, 0.5],
  ]);
  rip(d, sr, 0.2, rnd(0.55, 0.7), 1, 0.9);
  const tj = rnd(0.7, 0.8);
  jaw(d, sr, tj, 1);
  jaw(d, sr, tj + rnd(0.03, 0.05), 0.45);
  for (let i = 0; i < 3; i++) addChirp(d, sr, tj + rnd(0.12, 0.45), rnd(500, 900), rnd(900, 1500), 0.03, 0.08);
  return edges(norm(d, 1), sr);
}

/**
 * Дверь закрывается сама: долгий скрип durS (частота срывов бродит 24…150 Гц, изредка визг 220…360 Гц, к концу
 * замедляется), стук о косяк, язычок, через ~0.45 с — ключ (два щелчка), ~0.75 с — засов. Пик 1.
 */
function synthCreakShut(sr: number, durS: number): Float32Array {
  const cd = Math.max(0.3, durS);
  const d = buf(sr, cd + 1.15);
  let rate = rnd(30, 50), target = rate, tgtT = 0, sw = 0.7, swTo = 0.7, swT = 0;
  stickSlip(
    d,
    sr,
    0,
    cd - 0.02,
    (t) => {
      if (t >= tgtT) {
        tgtT = t + rnd(0.12, 0.4);
        target = Math.random() < 0.14 ? rnd(220, 360) : rnd(24, 150);
      }
      rate += (target - rate) * 0.12;
      const u = t / cd;
      return u > 0.85 ? rate * (1 - (u - 0.85) * 2.5) : rate;
    },
    (t) => {
      if (t >= swT) {
        swT = t + rnd(0.1, 0.3);
        swTo = rnd(0.35, 1);
      }
      sw += (swTo - sw) * 0.15;
      return sw * sstep(t / 0.25) * sstep((cd - 0.02 - t) / 0.06);
    },
    [
      [rnd(380, 470), 0.035, 1],
      [rnd(900, 1100), 0.022, 0.7],
      [rnd(1900, 2300), 0.012, 0.4],
      [rnd(3100, 3500), 0.006, 0.18],
    ],
    0.12,
  );
  // стук о косяк и язычок
  addThud(d, sr, cd, rnd(100, 120), 55, 0.05, 0.55);
  addLpNoise(d, sr, cd, 0.08, 400, 0.25, 0.002, 0.06);
  addMode(d, sr, cd + 0.012, 2300, 0.004, 0.45);
  addMode(d, sr, cd + 0.013, 3700, 0.003, 0.25);
  addMode(d, sr, cd + 0.06, 1900, 0.005, 0.3);
  addClick(d, sr, cd + 0.012, 0.0005, 0.3);
  // ключ: два сухих щелчка
  const tk = cd + rnd(0.4, 0.5);
  for (let i = 0; i < 2; i++) {
    addMode(d, sr, tk + i * 0.09, rnd(2900, 3300), 0.003, 0.28);
    addMode(d, sr, tk + i * 0.09, rnd(4300, 4800), 0.002, 0.16);
    addClick(d, sr, tk + i * 0.09, 0.0004, 0.18);
  }
  // засов: проехал — и лязгнул
  const tb = cd + rnd(0.7, 0.8);
  addNoise(d, sr, tb - 0.1, 0.1, 2300, 2800, 1.5, 0.08, 0.03, 0.01);
  addMode(d, sr, tb, rnd(1100, 1200), 0.02, 0.5);
  addMode(d, sr, tb, rnd(1850, 1950), 0.012, 0.4);
  addMode(d, sr, tb, rnd(2900, 3000), 0.008, 0.3);
  addMode(d, sr, tb, 160, 0.03, 0.35);
  addNoise(d, sr, tb, 0.03, 1400, 1200, 1.2, 0.3, 0.001, 0.025);
  return edges(norm(d, 1), sr);
}

/** Лопнувшая лампочка: треск нити, хлопок, звон колбы, осколки о плафон. Пик 1. */
function synthPop(sr: number): Float32Array {
  const d = buf(sr, 0.5);
  const tp = rnd(0.03, 0.07);
  for (let t = 0.004; t < tp; t += rnd(0.0008, 0.004)) addMode(d, sr, t, rnd(2500, 6000), 0.0005, rnd(0.05, 0.18) * (0.5 + 0.5 * Math.sin(TAU * 100 * t) ** 2));
  addClick(d, sr, tp, 0.0009, 1);
  addThud(d, sr, tp, rnd(200, 260), 100, 0.018, 0.25);
  addNoise(d, sr, tp, 0.06, 3500, 2500, 0.8, 0.25, 0.001, 0.05);
  tink(d, sr, tp + 0.001, rnd(3800, 5200), 0.45);
  for (let i = 0, n = irnd(4, 8); i < n; i++) tink(d, sr, tp + rnd(0.01, 0.2), rnd(2800, 7000), rnd(0.08, 0.25));
  return edges(norm(d, 1), sr);
}

/** Осколки об пол: густой звон в начале, потом редкие отскоки, шорох. Пик 1. */
function synthShards(sr: number): Float32Array {
  const d = buf(sr, 1.4);
  const n = irnd(18, 32);
  for (let i = 0; i < n; i++) {
    const t = 0.005 + (i < n * 0.6 ? -Math.log(1 - Math.random() * 0.98) * 0.05 : rnd(0.12, 0.85));
    tink(d, sr, t, rnd(2400, 7500), rnd(0.15, 1) * Math.exp(-t / 0.4));
  }
  addNoise(d, sr, 0, 0.25, 6000, 4500, 1, 0.12, 0.002, 0.2);
  return edges(norm(d, 1), sr);
}

// ── удушье ──

type ChokeKind = 'gasp' | 'gurgle' | 'retch' | 'rattle';
const CHOKE_F = [480, 1650, 2550, 3500], CHOKE_B = [70, 100, 160, 220];
const FRY_F = [520, 1300, 2400, 3300], FRY_B = [110, 130, 220, 280];

/** Одна попытка: gasp — сдавленный вдох-стридор с обрывом «гк»; gurgle — бульканье и хрип; retch — толчок выдоха;
 *  rattle — слабый хрип в конце. k — сила 0…1 (тембр); громкость ставит вызывающий. Пик ≤ 1. */
function synthChokeAttempt(sr: number, kind: ChokeKind, k: number): Float32Array {
  let d: Float32Array;
  if (kind === 'gasp') {
    const dur = rnd(0.22, 0.42) * (0.75 + 0.25 * k);
    const f0 = rnd(480, 760), trem = rnd(14, 24);
    const v = voice(
      sr,
      dur + 0.02,
      (t) => ({ f0: f0 * (1 + (0.18 * t) / dur) * (1 + 0.04 * Math.sin(TAU * 6 * t)), v: 0.55 * win(t, 0, dur, 0.03, 0.008) * (0.75 + 0.25 * Math.sin(TAU * trem * t)), a: 0.9 * win(t, 0, dur, 0.02, 0.008), F: CHOKE_F, B: CHOKE_B }),
      { oq: 0.5, jitter: 0.07, shimmer: 0.25, rough: 0.45, hiss: 0.5, pre: 0.6 },
    );
    d = buf(sr, dur + 0.12);
    mix(d, norm(v, 0.9), 0);
    // смычка горла: щелчок
    addMode(d, sr, dur + 0.004, rnd(1500, 2300), 0.0018, 0.5);
    addMode(d, sr, dur + 0.004, rnd(600, 800), 0.004, 0.3);
  } else if (kind === 'retch') {
    const dur = rnd(0.15, 0.26);
    d = buf(sr, dur + 0.08);
    addClick(d, sr, 0.003, 0.0008, 0.4);
    addNoise(d, sr, 0, dur, 900, 700, 1, 0.5, 0.008, dur * 0.6);
    const f0 = rnd(65, 90);
    mix(d, norm(voice(sr, dur, (t) => ({ f0, v: win(t, 0, dur, 0.01, dur * 0.6), a: 0.2, F: FRY_F, B: FRY_B }), { oq: 0.35, jitter: 0.15, rough: 0.6 }), 0.6), 0);
  } else {
    const weak = kind === 'rattle';
    const dur = weak ? rnd(0.5, 0.8) : rnd(0.3, 0.6);
    d = buf(sr, dur + 0.08);
    const f0 = weak ? rnd(18, 30) : rnd(28, 55);
    const fry = voice(sr, dur, (t) => ({ f0, v: win(t, 0, dur, weak ? 0.1 : 0.03, weak ? 0.25 : 0.08), a: weak ? 0.25 : 0.12, F: FRY_F, B: FRY_B }), { oq: 0.32, jitter: 0.3, shimmer: 0.3, rough: 0.5 });
    mix(d, norm(fry, weak ? 0.45 : 0.7), 0);
    // пузыри: кровь / слюна в горле
    let t = rnd(0, 0.03);
    const rate = weak ? 8 : 22;
    while (t < dur) {
      const f = rnd(160, 320);
      addChirp(d, sr, t, f, f * rnd(1.8, 2.6), rnd(0.015, 0.035), rnd(0.15, 0.4) * (weak ? 0.6 : 1));
      t += -Math.log(1 - Math.random() * 0.98) / rate;
    }
    addNoise(d, sr, 0, dur, 600, 450, 1.2, weak ? 0.15 : 0.25, 0.02, 0.06, new Grains(sr, 20, 0.02), 0.2);
  }
  // щелчки горла
  for (let i = 0, n = irnd(0, 2); i < n; i++) addMode(d, sr, rnd(0, d.length / sr - 0.02), rnd(1300, 2600), 0.0015, rnd(0.2, 0.45));
  return edges(norm(d, 0.9 + 0.1 * clamp01(k)), sr);
}

// ── еда ──

/** Чавк: мокрое сжатие по зёрнам, низ рта, иногда язык / хрящ / пузырь. */
function synthChew(sr: number): Float32Array {
  const dur = rnd(0.15, 0.24);
  const d = buf(sr, dur + 0.06);
  addNoise(d, sr, 0, dur, rnd(500, 1100), rnd(350, 700), 1.3, 0.55, 0.012, dur * 0.6, new Grains(sr, 140, 0.004), 0.25);
  addLpNoise(d, sr, 0, dur, 260, 0.6, 0.015, dur * 0.5);
  if (Math.random() < 0.5) addMode(d, sr, rnd(0, dur), rnd(1500, 3000), 0.0012, 0.3);
  if (Math.random() < 0.35) addCrackle(d, sr, rnd(0.01, dur * 0.5), 0.05, 260, 1800, 4500, 0.5, 0.03);
  if (Math.random() < 0.3) {
    const f = rnd(300, 600);
    addChirp(d, sr, rnd(0, dur), f, f * 2, 0.025, 0.2);
  }
  return edges(norm(d, rnd(0.6, 1)), sr);
}

/** Хлюп-всасывание: полоса вверх по зёрнам, пузыри. */
function synthSlurp(sr: number): Float32Array {
  const dur = rnd(0.28, 0.48);
  const d = buf(sr, dur + 0.08);
  addNoise(d, sr, 0, dur, 380, rnd(1800, 2600), 3, 0.6, 0.04, 0.06, new Grains(sr, 35, 0.012), 0.3);
  for (let i = 0, n = irnd(5, 10); i < n; i++) {
    const f = rnd(250, 600);
    addChirp(d, sr, rnd(0, dur), f, f * rnd(1.6, 2.4), rnd(0.015, 0.035), rnd(0.12, 0.3));
  }
  return edges(norm(d, rnd(0.6, 0.9)), sr);
}

/** Отрывает кусок: рвущаяся плоть, рывок. */
function synthEatRip(sr: number): Float32Array {
  const dur = rnd(0.22, 0.4);
  const d = buf(sr, dur + 0.1);
  rip(d, sr, 0, dur, 1, 1.2);
  addThud(d, sr, 0.01, 90, 50, 0.06, 0.3);
  return edges(norm(d, 0.9), sr);
}

/** Сопение носом. */
function synthSnort(sr: number): Float32Array {
  const d = buf(sr, 0.28);
  addNoise(d, sr, 0, 0.22, 1100, 800, 0.8, 0.5, 0.03, 0.12);
  addLpNoise(d, sr, 0, 0.22, 300, 0.4, 0.02, 0.1);
  return edges(norm(d, 0.4), sr);
}

// ── бросок ──

const SHRIEK_F = [1000, 1850, 3000, 4300, 5500], SHRIEK_B = [170, 210, 300, 400, 500];

/** Визг-выдох: хриплое «хаааа» вверх и вниз (560 → 1080 → 700 Гц), с шипением. Пик 1. */
function synthShriek(sr: number): Float32Array {
  const dur = rnd(0.42, 0.52);
  const v = voice(
    sr,
    dur + 0.05,
    (t) => {
      const u = t / dur;
      const f = u < 0.25 ? lerp(560, 1080, u / 0.25) : lerp(1080, 700, (u - 0.25) / 0.75);
      return { f0: f * (1 + 0.03 * Math.sin(TAU * 11 * t)), v: win(t, 0.02, dur, 0.05, 0.12), a: 0.9 * win(t, 0, dur, 0.015, 0.15), F: SHRIEK_F, B: SHRIEK_B };
    },
    { oq: 0.55, jitter: 0.045, shimmer: 0.2, rough: 0.5, hiss: 0.9, pre: 0.9 },
  );
  return edges(norm(v, 1), sr);
}

/** Удар в тело: тяжёлый толчок, мокрый шлепок, одежда, удар об пол, свой выдох «ых». Пик 1. */
function synthImpact(sr: number): Float32Array {
  const d = buf(sr, 0.9);
  addThud(d, sr, 0, 78, 30, 0.16, 1);
  addClick(d, sr, 0, 0.0012, 0.6);
  addNoise(d, sr, 0, 0.03, 1400, 900, 1, 0.8, 0.001, 0.025);
  addNoise(d, sr, 0.005, 0.28, 2400, 1600, 0.8, 0.22, 0.01, 0.2);
  addThud(d, sr, rnd(0.14, 0.2), 62, 28, 0.12, 0.7);
  const g = voice(sr, 0.22, (t) => ({ f0: lerp(165, 100, t / 0.2), v: win(t, 0, 0.2, 0.01, 0.08), a: 0.35 * win(t, 0, 0.2, 0.01, 0.1), F: [650, 1150, 2500, 3400], B: [100, 120, 200, 260] }), { oq: 0.5, jitter: 0.03, rough: 0.3 });
  mix(d, norm(g, 0.45), sr * 0.025);
  return edges(norm(d, 1), sr);
}

// ───────────────────────── узлы ─────────────────────────

function noiseBuffer(ctx: BaseAudioContext, sec: number): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * sec);
  const b = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = nz();
  return b;
}

/** Отклик коридора общаги: предзадержка 12 мс, флаттер-эхо плитки, редкие поздние «хлопки», тёмный хвост ~2.4 с. */
function impulse(ctx: BaseAudioContext, sec: number): AudioBuffer {
  const sr = ctx.sampleRate, n = Math.floor(sr * sec), b = ctx.createBuffer(2, n, sr);
  const pre = Math.floor(0.012 * sr);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    let l1 = 0, l2 = 0;
    for (let i = pre; i < n; i++) {
      const u = (i - pre) / (n - pre);
      // срез уходит вниз со временем: стены съедают верх
      const k = 0.5 - 0.42 * u;
      l1 += k * (nz() - l1);
      l2 += k * (l1 - l2);
      d[i] = l2 * Math.pow(1 - u, 2.6) * (1 - Math.exp(-(i - pre) / (0.004 * sr)));
    }
    for (let k = 1; k < 16; k++) {
      const i = pre + Math.floor((0.011 * k + c * 0.0007) * sr);
      if (i < n) d[i] += (k % 2 ? -1 : 1) * 0.25 * Math.pow(0.84, k);
    }
    for (const [ts, a] of [[0.085, 0.18], [0.17, 0.1], [0.26, 0.06]] as const) {
      const i = Math.floor((ts + c * 0.003) * sr);
      if (i < n) d[i] += a;
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

function setPos(pn: PannerNode, p: V3) {
  if (pn.positionX) {
    pn.positionX.value = p.x;
    pn.positionY.value = p.y;
    pn.positionZ.value = -p.z;
  } else (pn as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(p.x, p.y, -p.z);
}

// ───────────────────────── класс ─────────────────────────

export interface SmileAudioOptions {
  /** готовый контекст (OfflineAudioContext — проверка рендером); без него — свой AudioContext в resume() */
  context?: BaseAudioContext;
  /** false — без компрессора и клиппера на выходе (замер «сырых» пиков) */
  limiter?: boolean;
}

export interface SmileAudioCounters {
  beat: number;
  crunch: number;
  tear: number;
  creak: number;
  shatter: number;
  laugh: number;
  giggle: number;
  choke: number;
  pounce: number;
  eat: number;
  sting: number;
}

/** Растянутое во времени событие (смех, удушье, еда): step(at) играет очередной кусок в момент at и
 *  возвращает время следующего (Infinity — хватит). Куски строятся по мере надобности (LOOKAHEAD) — в смехе так
 *  точка around() берётся на момент очереди. */
interface Job {
  kind: 'laugh' | 'choke' | 'eat';
  end: number;
  next: number;
  step(at: number): number;
}

export class SmileAudio {
  ctx: BaseAudioContext | null = null;
  readonly counters: SmileAudioCounters = { beat: 0, crunch: 0, tear: 0, creak: 0, shatter: 0, laugh: 0, giggle: 0, choke: 0, pounce: 0, eat: 0, sting: 0 };
  /** контекст свой (закрыть в dispose) */
  private own = false;
  private offline = false;
  private readonly limiter: boolean;
  private master: GainNode | null = null;
  private fadeG!: GainNode;
  /** глушение мира писком */
  private duck!: GainNode;
  private duckLp!: BiquadFilterNode;
  /** мир: позиционные звуки */
  private world!: GainNode;
  /** вход эха коридора */
  private wetIn!: GainNode;
  /** у самого слушателя: сердце, удушье, удар */
  private selfBus!: GainNode;
  /** стингер (не глушится) */
  private music!: GainNode;
  private ringBus!: GainNode;
  private ringOsc: { o: OscillatorNode; f: number }[] = [];
  private noise!: AudioBuffer;
  private analyser: AnalyserNode | null = null;
  private readonly L = { x: 0, y: 1.6, z: 0, yaw: 0 };
  private heartTarget = 0;
  private heartLvl = 0;
  private nextBeat = 0;
  private ringLvl = 0;
  /** применённые к узлам уровни писка (чтобы не плодить автоматизацию каждый кадр) */
  private ringSet = -1;
  private fadeOn = true;
  private jobs: Job[] = [];
  private disposed = false;

  constructor(opts: SmileAudioOptions = {}) {
    this.limiter = opts.limiter !== false;
    if (opts.context) {
      try {
        this.ctx = opts.context;
        this.offline = 'startRendering' in opts.context;
        this.build();
      } catch {
        this.ctx = null;
      }
    }
  }

  /** Контекст есть и играет (или запишется). */
  get running(): boolean {
    return !!this.ctx && !this.disposed && (this.offline || this.ctx.state === 'running');
  }

  /** По жесту пользователя (клик / клавиша): создать контекст (один раз) и запустить. Повторно — resume. */
  resume(): void {
    if (this.disposed) return;
    try {
      if (!this.ctx) {
        const w = (typeof window === 'undefined' ? undefined : window) as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext } | undefined;
        const AC = w?.AudioContext ?? w?.webkitAudioContext;
        if (!AC) return;
        const c = new AC({ latencyHint: 'interactive' });
        this.ctx = c;
        this.own = true;
        try {
          this.build();
        } catch {
          this.ctx = null;
          c.close().catch(() => {});
          return;
        }
      }
      const c = this.ctx as AudioContext;
      if (!this.offline && c.state === 'suspended' && typeof c.resume === 'function') c.resume().catch(() => {});
    } catch {
      /* без звука */
    }
  }

  /** Текущий уровень (RMS) на выходе, 0…1 — для QA. */
  level(): number {
    const a = this.analyser;
    if (!a || !this.ctx) return 0;
    const d = new Float32Array(a.fftSize);
    a.getFloatTimeDomainData(d);
    let s = 0;
    for (const v of d) s += v * v;
    return Math.sqrt(s / d.length);
  }

  private build() {
    const ctx = this.ctx!;
    const master = (this.master = ctx.createGain());
    master.gain.value = MASTER;
    if (this.limiter) {
      // выход: компрессор-лимитер + мягкий клиппер (бросок и сердце на 1 не клипуют)
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.knee.value = 6;
      comp.ratio.value = 6;
      comp.attack.value = 0.002;
      comp.release.value = 0.25;
      const clip = ctx.createWaveShaper();
      clip.curve = softClip();
      clip.oversample = '2x';
      master.connect(comp).connect(clip).connect(ctx.destination);
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      clip.connect(this.analyser);
    } else master.connect(ctx.destination);
    this.fadeG = ctx.createGain();
    this.fadeG.gain.value = this.fadeOn ? 1 : 0;
    this.fadeG.connect(master);
    this.duck = ctx.createGain();
    this.duck.connect(this.fadeG);
    this.duckLp = ctx.createBiquadFilter();
    this.duckLp.type = 'lowpass';
    this.duckLp.frequency.value = 18000;
    this.duckLp.Q.value = 0.5;
    this.duckLp.connect(this.duck);
    this.world = ctx.createGain();
    this.world.connect(this.duckLp);
    const conv = ctx.createConvolver();
    conv.buffer = impulse(ctx, 2.4);
    this.wetIn = ctx.createGain();
    this.wetIn.connect(conv);
    conv.connect(this.duckLp);
    this.selfBus = ctx.createGain();
    this.selfBus.connect(this.fadeG);
    this.music = ctx.createGain();
    this.music.connect(this.fadeG);
    this.noise = noiseBuffer(ctx, 3);
    this.buildRing();
    this.applyRing(true);
    this.heartLvl = this.offline ? this.heartTarget : 0;
    this.listen(true);
  }

  /** Писк: пары синусов с биениями (в ушах разные), медленный дрейф высоты и громкости, узкая полоса шума. */
  private buildRing() {
    const ctx = this.ctx!;
    const bus = (this.ringBus = ctx.createGain());
    bus.gain.value = 0;
    bus.connect(this.fadeG);
    const am = ctx.createGain();
    am.gain.value = 0.82;
    am.connect(bus);
    const wob = ctx.createOscillator();
    wob.frequency.value = 0.37;
    const wg = ctx.createGain();
    wg.gain.value = 0.18;
    wob.connect(wg).connect(am.gain);
    // дрейф высоты — общий для пары (биения сохраняются), центы
    const drift = ctx.createOscillator();
    drift.frequency.value = 0.11;
    const dg = ctx.createGain();
    dg.gain.value = 9;
    drift.connect(dg);
    for (const [f, beat, pan, w] of [[6150, 5.5, -0.5, 1], [7380, 3.2, 0.55, 0.55], [9850, 7.3, 0.15, 0.22]] as const) {
      const sp = ctx.createStereoPanner();
      sp.pan.value = pan;
      sp.connect(am);
      for (const ff of [f, f + beat]) {
        const o = ctx.createOscillator();
        o.frequency.value = ff;
        dg.connect(o.detune);
        const g = ctx.createGain();
        g.gain.value = w * 0.5;
        o.connect(g).connect(sp);
        o.start();
        this.ringOsc.push({ o, f: ff });
      }
    }
    const ns = ctx.createBufferSource();
    ns.buffer = this.noise;
    ns.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 6600;
    bp.Q.value = 14;
    const ng = ctx.createGain();
    ng.gain.value = 0.5;
    ns.connect(bp).connect(ng).connect(am);
    ns.start();
    wob.start();
    drift.start();
  }

  private applyRing(now = false) {
    const ctx = this.ctx;
    if (!ctx || !this.ringBus) return;
    const l = this.ringLvl;
    if (!now && Math.abs(l - this.ringSet) < 0.002) return;
    this.ringSet = l;
    const t = ctx.currentTime;
    const set = (p: AudioParam, v: number, tau: number) => {
      if (now || this.offline) {
        p.cancelScheduledValues(t);
        p.setValueAtTime(v, t);
      } else p.setTargetAtTime(v, t, tau);
    };
    set(this.ringBus.gain, ringGain(l), 0.35);
    set(this.duck.gain, 1 - 0.3 * l, 0.5);
    set(this.duckLp.frequency, lerp(18000, 4500, l * l), 0.5);
    for (const r of this.ringOsc) set(r.o.frequency, r.f * (0.96 + 0.08 * l), 0.8);
  }

  /** Слушатель WebAudio по глазам и yaw (Babylon z → WebAudio −z). */
  private listen(now = false) {
    const ctx = this.ctx!;
    const L = this.L, t = ctx.currentTime, al = ctx.listener;
    const fx = Math.sin(L.yaw), fz = Math.cos(L.yaw);
    if (al.positionX) {
      const set = (p: AudioParam, v: number) => (now || this.offline ? p.setValueAtTime(v, t) : p.setTargetAtTime(v, t, 0.02));
      set(al.positionX, L.x);
      set(al.positionY, L.y);
      set(al.positionZ, -L.z);
      set(al.forwardX, fx);
      set(al.forwardY, 0);
      set(al.forwardZ, -fz);
      al.upX.value = 0;
      al.upY.value = 1;
      al.upZ.value = 0;
    } else {
      (al as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(L.x, L.y, -L.z);
      (al as unknown as { setOrientation(...a: number[]): void }).setOrientation(fx, 0, -fz, 0, 1, 0);
    }
  }

  /** Можно строить события: контекст есть, не закрыт, не в затухании. */
  private ready(): boolean {
    return !!this.ctx && !this.disposed && this.fadeOn && this.ctx.state !== 'closed';
  }

  /** Тело события под try: звук не должен ронять игру. */
  private safe(f: () => void) {
    try {
      f();
    } catch {
      /* без звука */
    }
  }

  // ───────────────────────── кадр ─────────────────────────

  /** Каждый кадр: слушатель (глаза Babylon + yaw), плавное сердце, планирование ударов и очередей. */
  update(eye: V3, yaw: number, dt: number): void {
    if (!this.ctx || this.disposed) return;
    this.safe(() => {
      const L = this.L;
      if (eye) {
        L.x = fin(eye.x, L.x);
        L.y = fin(eye.y, L.y);
        L.z = fin(eye.z, L.z);
      }
      L.yaw = fin(yaw, L.yaw);
      this.listen();
      const d = clamp(fin(dt, 0.016), 0, 0.25);
      this.heartLvl = this.offline ? this.heartTarget : smoothLevel(this.heartLvl, this.heartTarget, d, 1.1, 2.2);
      this.pumpHeart(LOOKAHEAD);
      this.pumpJobs(this.offline ? 1e6 : LOOKAHEAD);
    });
  }

  /** Сердце: 0 — тихо; 0.35 ≈ 75 уд/мин глухо; 0.6 ≈ 110; 1 ≈ 170, громко, «в горле». Темп/громкость — плавно. */
  setHeart(level: number): void {
    this.heartTarget = clamp01(fin(level));
    if (this.offline) this.heartLvl = this.heartTarget;
  }

  /** Писк в ушах 0…1 (тонкий, с биениями); глушит остальной мир. */
  setRing(level: number): void {
    this.ringLvl = clamp01(fin(level));
    if (this.ctx && !this.disposed) this.safe(() => this.applyRing());
  }

  /** QA (OfflineAudioContext): заранее расписать удары сердца на sec секунд вперёд по текущему уровню. */
  prime(sec: number): void {
    if (!this.ctx || this.disposed) return;
    this.safe(() => {
      this.heartLvl = this.heartTarget;
      this.pumpHeart(clamp(fin(sec), 0, 120));
    });
  }

  private pumpHeart(h: number) {
    const ctx = this.ctx!;
    const now = ctx.currentTime, lvl = this.heartLvl;
    if (lvl < 0.02 || !this.fadeOn) {
      this.nextBeat = 0;
      return;
    }
    if (this.nextBeat < now) this.nextBeat = now + 0.03;
    for (let guard = 0; this.nextBeat < now + h && guard < 600; guard++) {
      const period = 60 / heartBpm(lvl);
      this.play(synthBeat(ctx.sampleRate, lvl, period), this.selfBus, this.nextBeat);
      this.counters.beat++;
      // живой ритм: ±2.5%
      this.nextBeat += period * rnd(0.975, 1.025);
    }
  }

  private pumpJobs(h: number) {
    if (!this.jobs.length) return;
    const now = this.ctx!.currentTime;
    for (const j of this.jobs) {
      for (let guard = 0; j.next < j.end && j.next < now + h && guard < 400; guard++) {
        const at = Math.max(j.next, now + 0.005);
        const nx = j.step(at);
        j.next = Number.isFinite(nx) ? Math.max(nx, at + 0.02) : Infinity;
      }
    }
    this.jobs = this.jobs.filter((j) => j.next < j.end);
  }

  private addJob(j: Job) {
    this.jobs = this.jobs.filter((o) => o.kind !== j.kind);
    this.jobs.push(j);
    this.pumpJobs(this.offline ? 1e6 : LOOKAHEAD);
  }

  // ───────────────────────── узлы-помощники ─────────────────────────

  /** Точка относительно слушателя: вперёд / вправо / вверх (по взгляду) → мировые координаты. */
  private rel(fwd: number, right: number, up: number): V3 {
    const L = this.L, s = Math.sin(L.yaw), c = Math.cos(L.yaw);
    return { x: L.x + s * fwd + c * right, y: L.y + up, z: L.z + c * fwd - s * right };
  }

  /** Источник в точке p: HRTF, обратный закон расстояния → мир; wet — посыл в эхо после расстояния, pre — до него. */
  private at(p: V3, ref: number, roll: number, wet: number, pre = 0): { g: GainNode; pn: PannerNode } {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    const pn = ctx.createPanner();
    pn.panningModel = 'HRTF';
    pn.distanceModel = 'inverse';
    pn.refDistance = ref;
    pn.rolloffFactor = roll;
    pn.maxDistance = 300;
    setPos(pn, p);
    g.connect(pn).connect(this.world);
    if (wet > 0) {
      const w = ctx.createGain();
      w.gain.value = wet;
      pn.connect(w).connect(this.wetIn);
    }
    if (pre > 0) {
      const w = ctx.createGain();
      w.gain.value = pre;
      g.connect(w).connect(this.wetIn);
    }
    return { g, pn };
  }

  /** У самого слушателя (своё тело): лёгкая панорама, чуть эха. */
  private self(pan: number, wet: number): AudioNode {
    const ctx = this.ctx!;
    const sp = ctx.createStereoPanner();
    sp.pan.value = clamp(fin(pan), -1, 1);
    sp.connect(this.selfBus);
    if (wet > 0) {
      const w = ctx.createGain();
      w.gain.value = wet;
      sp.connect(w).connect(this.wetIn);
    }
    return sp;
  }

  /** Сыграть сэмплы в момент when (абсолютное время контекста). */
  private play(data: Float32Array, dest: AudioNode, when: number, gain = 1) {
    const ctx = this.ctx!;
    const b = ctx.createBuffer(1, data.length, ctx.sampleRate);
    b.getChannelData(0).set(data);
    const s = ctx.createBufferSource();
    s.buffer = b;
    if (gain !== 1) {
      const g = ctx.createGain();
      g.gain.value = fin(gain, 0);
      s.connect(g).connect(dest);
    } else s.connect(dest);
    s.start(Math.max(fin(when, 0), ctx.currentTime));
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, peak: number, dest: AudioNode, t: number, attack = 0.01) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + Math.min(attack, dur * 0.5));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // ───────────────────────── события ─────────────────────────

  /** Далёкий хруст плоти и костей с хлюпаньем: позиционно, верх срезан, много эха. */
  crunch(p: V3): void {
    if (!this.ready() || !okV(p)) return;
    this.safe(() => {
      const ctx = this.ctx!;
      this.counters.crunch++;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 3200;
      lp.Q.value = 0.5;
      lp.connect(this.at(p, 3, 1, 0.2, 0.32).g);
      this.play(synthCrunch(ctx.sampleRate), lp, ctx.currentTime + 0.01, 0.9);
    });
  }

  /** Мокрый разрыв лица + щелчок челюсти, рядом (p — голова). */
  tear(p: V3): void {
    if (!this.ready() || !okV(p)) return;
    this.safe(() => {
      const ctx = this.ctx!;
      this.counters.tear++;
      this.play(synthTear(ctx.sampleRate), this.at(p, 1.5, 1, 0.35).g, ctx.currentTime + 0.005, 0.8);
    });
  }

  /** Тихий долгий скрип закрывающейся двери (durS) и щелчок замка + засов в конце. p — центр двери. */
  creakShut(p: V3, durS: number): void {
    if (!this.ready() || !okV(p)) return;
    this.safe(() => {
      const ctx = this.ctx!;
      this.counters.creak++;
      const d = synthCreakShut(ctx.sampleRate, clamp(fin(durS, 2.4), 0.3, 12));
      this.play(d, this.at(p, 1.5, 1, 0.55).g, ctx.currentTime + 0.005, 0.3);
    });
  }

  /** 2–3 лопнувшие лампочки над головой: хлопок, звон колбы; осколки падают и звенят об пол. */
  shatter(): void {
    if (!this.ready()) return;
    this.safe(() => {
      const ctx = this.ctx!, sr = ctx.sampleRate, now = ctx.currentTime + 0.005;
      this.counters.shatter++;
      let at = 0;
      for (let i = 0, n = irnd(2, 3); i < n; i++) {
        const p = this.rel(rnd(-1.5, 2.5), rnd(-1.8, 1.8), rnd(0.9, 1.1));
        this.play(synthPop(sr), this.at(p, 1.2, 1, 0.45).g, now + at, 0.85);
        // осколки с ~2.7 м долетают до пола за ~0.7 с
        const floor = { x: p.x + rnd(-0.3, 0.3), y: this.L.y - 1.5, z: p.z + rnd(-0.3, 0.3) };
        this.play(synthShards(sr), this.at(floor, 1.2, 1, 0.5).g, now + at + rnd(0.6, 0.72), 0.7);
        at += rnd(0.18, 0.45);
      }
    });
  }

  /**
   * Девичий смешок / хихиканье durS секунд: очереди «хи-хи-хи» (иногда «ха», шёпотом, дрожащее «хиии»), между ними —
   * всхлипы-вдохи. Каждая очередь — в точке around() (берётся за ~0.3 с до очереди) и едет со скоростью этой точки;
   * без around — кружит вокруг слушателя в 1.6–2.6 м. Новый вызов заменяет идущий смех.
   */
  laugh(durS: number, around?: () => V3): void {
    if (!this.ready()) return;
    this.safe(() => {
      const ctx = this.ctx!, sr = ctx.sampleRate, now = ctx.currentTime;
      const dur = clamp(fin(durS, 3), 0.3, 60);
      this.counters.laugh++;
      let ang = Math.random() * TAU;
      let last: { p: V3; t: number } | null = null;
      const where = (): V3 => {
        if (around) {
          try {
            const p = around();
            if (okV(p)) return { x: p.x, y: p.y, z: p.z };
          } catch {
            /* своя точка */
          }
        }
        ang += rnd(0.8, 1.6) * (Math.random() < 0.8 ? 1 : -1);
        const L = this.L, r = rnd(1.6, 2.6);
        return { x: L.x + Math.sin(ang) * r, y: L.y - rnd(0, 0.25), z: L.z + Math.cos(ang) * r };
      };
      const vows: GiggleOpt['vw'][] = ['i', 'i', 'i', 'I', 'I', 'e', 'a', 'a'];
      const job: Job = {
        kind: 'laugh',
        end: now + dur,
        next: now + 0.01,
        step: (at) => {
          const left = job.end - at;
          if (left < 0.3) return Infinity;
          const o: GiggleOpt = { n: irnd(3, 7), f0: rnd(355, 430), vw: vows[Math.floor(Math.random() * vows.length)], whisper: Math.random() < 0.15, inhale: Math.random() < 0.7, long: Math.random() < 0.12 && left > 0.9 };
          let d = synthGiggle(sr, o);
          if (d.length / sr > left + 0.1) {
            // не влезает в остаток — очередь короче, без вдоха
            o.n = Math.max(2, Math.floor((o.n * left) / (d.length / sr)));
            o.long = false;
            o.inhale = false;
            d = synthGiggle(sr, o);
          }
          const len = d.length / sr;
          const p = where();
          const wall = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
          // скорость точки между очередями (≤ 6 м/с) — очередь «едет» дальше в ту же сторону
          let vx = 0, vy = 0, vz = 0;
          if (last && wall - last.t > 0.05) {
            const k = 1 / (wall - last.t);
            vx = (p.x - last.p.x) * k;
            vy = (p.y - last.p.y) * k;
            vz = (p.z - last.p.z) * k;
            const s = Math.hypot(vx, vy, vz);
            if (s > 6) {
              vx *= 6 / s;
              vy *= 6 / s;
              vz *= 6 / s;
            }
          }
          last = { p, t: wall };
          const { g, pn } = this.at(p, 1.2, 1, 0.35);
          if (pn.positionX && (vx || vy || vz)) {
            const e = at + len;
            pn.positionX.setValueAtTime(p.x, at);
            pn.positionY.setValueAtTime(p.y, at);
            pn.positionZ.setValueAtTime(-p.z, at);
            pn.positionX.linearRampToValueAtTime(p.x + vx * len, e);
            pn.positionY.linearRampToValueAtTime(p.y + vy * len, e);
            pn.positionZ.linearRampToValueAtTime(-(p.z + vz * len), e);
          }
          this.play(d, g, at, rnd(0.45, 0.72));
          this.counters.giggle++;
          return at + len + rnd(0.1, 0.42);
        },
      };
      this.addJob(job);
    });
  }

  /** Удушье слушателя durS секунд: сдавленные вдохи, бульканье, щелчки горла — всё слабее и реже. */
  choke(durS: number): void {
    if (!this.ready()) return;
    this.safe(() => {
      const ctx = this.ctx!, sr = ctx.sampleRate;
      const dur = clamp(fin(durS, 3), 0.4, 30);
      this.counters.choke++;
      const out = this.self(0, 0.1);
      const t0 = ctx.currentTime + 0.01;
      let first = true;
      const job: Job = {
        kind: 'choke',
        end: t0 + dur,
        next: t0,
        step: (at) => {
          const left = job.end - at;
          if (left < 0.15) return Infinity;
          const u = clamp01((at - t0) / dur), k = 0.85 * Math.pow(1 - u, 0.65) + 0.15 * (1 - u);
          const r = Math.random();
          const kind: ChokeKind = first ? 'gasp' : u < 0.72 ? (r < 0.55 ? 'gasp' : r < 0.85 ? 'gurgle' : 'retch') : r < 0.55 ? 'gurgle' : 'rattle';
          first = false;
          const d = synthChokeAttempt(sr, kind, k);
          this.play(d, out, at, 0.25 + 0.75 * k);
          // паузы растут: сил всё меньше
          return at + (d.length / sr) * rnd(0.75, 0.95) + rnd(0.04, 0.2) * (1 + 2 * u);
        },
      };
      this.addJob(job);
    });
  }

  /** Бросок: визг-выдох и удар. Без p — на слушателя (визг спереди, удар — в само тело); с p — всё в точке p. */
  pounce(p?: V3): void {
    if (!this.ready()) return;
    this.safe(() => {
      const ctx = this.ctx!, sr = ctx.sampleRate, now = ctx.currentTime + 0.005;
      this.counters.pounce++;
      const has = okV(p);
      const sp = has ? p : this.rel(1.0, rnd(-0.2, 0.2), -0.05);
      this.play(synthShriek(sr), this.at(sp, 1, 1, 0.3).g, now, 0.85);
      this.play(synthImpact(sr), has ? this.at(p, 1.2, 1, 0.3).g : this.self(0, 0.15), now + 0.4, 1);
    });
  }

  /** Еда durS секунд: чавканье, рвущаяся плоть, хлюпанье, сопение. Без p — у шеи слушателя (жертва), с p — в мире. */
  eat(durS: number, p?: V3): void {
    if (!this.ready()) return;
    this.safe(() => {
      const ctx = this.ctx!, sr = ctx.sampleRate;
      const dur = clamp(fin(durS, 3.5), 0.3, 60);
      this.counters.eat++;
      const out = okV(p) ? this.at(p, 1.2, 1, 0.3).g : this.self(0.3, 0.12);
      const t0 = ctx.currentTime + 0.01;
      const job: Job = {
        kind: 'eat',
        end: t0 + dur,
        next: t0,
        step: (at) => {
          const r = Math.random();
          const d = r < 0.16 ? synthEatRip(sr) : r < 0.3 ? synthSlurp(sr) : synthChew(sr);
          this.play(d, out, at);
          if (Math.random() < 0.22) this.play(synthSnort(sr), out, at + rnd(0.05, 0.2), 0.6);
          return at + rnd(0.26, 0.45);
        },
      };
      this.addJob(job);
    });
  }

  /** Резкий короткий стингер: удар, кластер «смычков» (секунды, четвертьтоны) с подъёмом, низкий кластер, шумовой нарост. */
  sting(): void {
    if (!this.ready()) return;
    this.safe(() => {
      const ctx = this.ctx!, t = ctx.currentTime + 0.005, end = t + 2.6;
      this.counters.sting++;
      const out = ctx.createGain();
      out.gain.value = 0.7;
      out.connect(this.music);
      const w = ctx.createGain();
      w.gain.value = 0.6;
      out.connect(w).connect(this.wetIn);
      // удар
      this.tone('sine', 62, 27, 1.4, 0.55, out, t, 0.003);
      const hit = buf(ctx.sampleRate, 0.3);
      addClick(hit, ctx.sampleRate, 0, 0.002, 0.8);
      addLpNoise(hit, ctx.sampleRate, 0, 0.25, 700, 0.5, 0.002, 0.2);
      this.play(edges(hit, ctx.sampleRate), out, t, 0.7);
      // высокий кластер: пилы через полосу, вибрато, подъём на полтона к концу
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 450;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 2300;
      bp.Q.value = 0.45;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(1, t + 0.015);
      env.gain.exponentialRampToValueAtTime(0.35, t + 0.5);
      env.gain.exponentialRampToValueAtTime(0.0001, t + 2.0);
      hp.connect(bp).connect(env).connect(out);
      const vib = ctx.createOscillator();
      vib.frequency.value = 6.3;
      const vg = ctx.createGain();
      vg.gain.value = 14;
      vib.connect(vg);
      vib.start(t);
      vib.stop(end);
      for (const f of [1046.5, 1108.7, 1141.0, 1174.7, 1244.5, 1318.5, 2489]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f * rnd(0.996, 1.004);
        vg.connect(o.detune);
        o.detune.setValueAtTime(0, t);
        o.detune.linearRampToValueAtTime(rnd(40, 90), t + 1.8);
        const g = ctx.createGain();
        g.gain.value = f > 2000 ? 0.04 : 0.075;
        o.connect(g).connect(hp);
        o.start(t);
        o.stop(end);
      }
      // низкий кластер
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 420;
      const env2 = ctx.createGain();
      env2.gain.setValueAtTime(0, t);
      env2.gain.linearRampToValueAtTime(1, t + 0.02);
      env2.gain.exponentialRampToValueAtTime(0.0001, t + 2.3);
      lp.connect(env2).connect(out);
      for (const f of [61.7, 65.4, 87.3, 92.5]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        const g = ctx.createGain();
        g.gain.value = 0.09;
        o.connect(g).connect(lp);
        o.start(t);
        o.stop(end);
      }
      // шумовой нарост
      const ns = ctx.createBufferSource();
      ns.buffer = this.noise;
      const nb = ctx.createBiquadFilter();
      nb.type = 'bandpass';
      nb.Q.value = 1.3;
      nb.frequency.setValueAtTime(1100, t);
      nb.frequency.exponentialRampToValueAtTime(5600, t + 0.55);
      const ne = ctx.createGain();
      ne.gain.setValueAtTime(0, t);
      ne.gain.linearRampToValueAtTime(0.5, t + 0.42);
      ne.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
      ns.connect(nb).connect(ne).connect(out);
      ns.start(t, Math.random() * 1.2);
      ns.stop(t + 1.4);
    });
  }

  /** Уход из биома: fade(false) — плавно в тишину (сердце, смех, удушье, еда — стоп); fade(true) — снова слышно. */
  fade(on: boolean): void {
    this.fadeOn = !!on;
    if (!on) {
      this.jobs = [];
      this.nextBeat = 0;
    }
    const ctx = this.ctx;
    if (!ctx || this.disposed || !this.master) return;
    this.safe(() => {
      const t = ctx.currentTime;
      this.fadeG.gain.cancelScheduledValues(t);
      this.fadeG.gain.setTargetAtTime(on ? 1 : 0, t, on ? 0.6 : 0.5);
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.jobs = [];
    const c = this.ctx;
    this.ctx = null;
    if (!c) return;
    try {
      if (this.own) (c as AudioContext).close().catch(() => {});
      else this.master?.disconnect();
    } catch {
      /* уже закрыт */
    }
  }
}
