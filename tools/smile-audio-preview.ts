// Превью звука «Улыбки» (src/view3d/smileAudio.ts): кнопки на каждый звук, ползунки сердца / писка / поворота головы,
// сценарии «охота» и «ловушка»; «Записать всё» — каждый звук отдельно в OfflineAudioContext (с лимитером и без него):
// пик, RMS, громкость 50 мс, NaN, хвост; тут же плеер. ?auto=1 — записать сразу при загрузке (window.__smileAudioQA).
// Открыть: npx vite --config tools/vite.qa.config.ts --port 5363 → http://localhost:5363/tools/smile-audio-preview.html
// Рендер из node (playwright, свой порт и кэш vite): node tmp/smile-wip/smile-audio-render.mjs → tmp/smile-wip/audio/
import { SmileAudio, heartBpm } from '../src/view3d/smileAudio';

type V3 = { x: number; y: number; z: number };
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ───────────────────────── живой звук ─────────────────────────

const a = new SmileAudio();
const eye: V3 = { x: 0, y: 1.6, z: 0 };
let yaw = 0;
const t0 = performance.now();
/** точка относительно взгляда: вперёд / вправо / вверх */
const P = (fwd: number, right: number, up: number, y = yaw): V3 => ({ x: eye.x + Math.sin(y) * fwd + Math.cos(y) * right, y: eye.y + up, z: eye.z + Math.cos(y) * fwd - Math.sin(y) * right });
/** «красные зрачки» бегают вокруг: ~1.7 рад/с, радиус 1.6–2.2 м */
const eyesAround = (): V3 => {
  const t = (performance.now() - t0) / 1000;
  const r = 1.9 + 0.3 * Math.sin(t * 2.3);
  return { x: eye.x + Math.sin(t * 1.7) * r, y: 1.45, z: eye.z + Math.cos(t * 1.7) * r };
};

let last = performance.now();
const meter = document.querySelector('#meter i') as HTMLElement;
function frame(now: number) {
  const dt = (now - last) / 1000;
  last = now;
  a.update(eye, yaw, dt);
  meter.style.width = `${Math.min(100, a.level() * 400).toFixed(1)}%`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

const heart = $<HTMLInputElement>('heart'), ring = $<HTMLInputElement>('ring'), yawS = $<HTMLInputElement>('yaw');
function setHeart(v: number) {
  heart.value = String(v);
  a.setHeart(v);
  $('heartV').textContent = v > 0.02 ? `${v.toFixed(2)} · ${Math.round(heartBpm(v))} уд/мин` : '0 · тихо';
}
function setRing(v: number) {
  ring.value = String(v);
  a.setRing(v);
  $('ringV').textContent = v.toFixed(2);
}
heart.oninput = () => (a.resume(), setHeart(Number(heart.value)));
ring.oninput = () => (a.resume(), setRing(Number(ring.value)));
yawS.oninput = () => {
  yaw = (Number(yawS.value) * Math.PI) / 180;
  $('yawV').textContent = `${yawS.value}°`;
};

const log = (s: string) => ($('log').textContent = s);

function button(parent: string, label: string, f: () => void, cls = '') {
  const b = document.createElement('button');
  b.textContent = label;
  if (cls) b.className = cls;
  b.onclick = () => {
    a.resume();
    f();
  };
  $(parent).appendChild(b);
}

button('events', 'хруст вдалеке (18 м)', () => a.crunch(P(18, (Math.random() - 0.5) * 12, 0)));
button('events', 'разрыв лица (1.4 м)', () => a.tear(P(1.4, 0.2, 0.05)));
button('events', 'дверь закрылась (2.4 с)', () => a.creakShut(P(-2.2, 0.6, -0.3), 2.4));
button('events', 'лампочки', () => a.shatter());
button('events', 'смех 4 с (кружит)', () => a.laugh(4, eyesAround));
button('events', 'смех 4 с (сам)', () => a.laugh(4));
button('events', 'удушье 3 с', () => a.choke(3));
button('events', 'бросок', () => a.pounce());
button('events', 'еда 3.5 с', () => a.eat(3.5));
button('events', 'еда 3.5 с (в 3 м)', () => a.eat(3.5, P(3, -1, -1.1)));
button('events', 'стингер', () => a.sting());
let faded = false;
button('events', 'fade вкл/выкл', () => {
  faded = !faded;
  a.fade(!faded);
  log(faded ? 'fade(false): тишина' : 'fade(true): снова слышно');
});

/** сценарий: [секунда, действие, подпись] */
function scene(steps: [number, () => void, string][]) {
  for (const [t, f, s] of steps)
    setTimeout(() => {
      f();
      log(`${t.toFixed(1)} с — ${s}`);
    }, t * 1000);
}
button('scenes', 'Охота: стадии 1 → 3, бросок', () =>
  scene([
    [0, () => (setHeart(0), setRing(0.25)), 'стадия 1: писк 0.25'],
    [1.4, () => a.crunch(P(20, 6, 0)), 'хруст вдалеке'],
    [4, () => (setRing(0.4), setHeart(0.35)), 'стадия 2: писк 0.4, сердце 0.35'],
    [7, () => (setHeart(0.6), a.tear(P(4, 1, 0.1))), 'досмотрел: разрыв лица, сердце 0.6'],
    [9, () => (a.sting(), setHeart(1), setRing(0.6)), 'провокация: стингер, сердце 1, писк 0.6'],
    [14, () => a.pounce(), 'бросок'],
    [14.45, () => a.eat(3.5), 'ест'],
    [18.2, () => (setHeart(0), setRing(0)), 'конец'],
  ]),
);
button('scenes', 'Ловушка: дверь → лампы → смех → удушье', () =>
  scene([
    [0, () => (setHeart(0), setRing(0), a.creakShut(P(-2.2, 0.5, -0.3), 2.4)), 'дверь закрывается'],
    [2.6, () => a.shatter(), 'лампочки'],
    [3.3, () => a.laugh(4, eyesAround), 'зрачки и смех'],
    [7.3, () => (setHeart(1), a.choke(3)), 'сердце и удушье'],
    [10.6, () => setHeart(0), 'смерть'],
  ]),
);
button('scenes', 'тишина', () => (setHeart(0), setRing(0), log('тихо')));

// ───────────────────────── офлайн-проверка ─────────────────────────

const SR = 48000;
const EYE0: V3 = { x: 0, y: 1.6, z: 0 };
const Q = (fwd: number, right: number, up: number) => P(fwd, right, up, 0);
interface Case {
  name: string;
  sec: number;
  run(a: SmileAudio, off: OfflineAudioContext): void;
}
/** в момент t записи (OfflineAudioContext.suspend) */
const later = (off: OfflineAudioContext, t: number, f: () => void) => {
  off.suspend(t).then(() => {
    f();
    off.resume();
  });
};
const CASES: Case[] = [
  { name: 'crunch 18m', sec: 4, run: (s) => s.crunch({ x: 6, y: 1.6, z: 17 }) },
  { name: 'tear 1.4m', sec: 2.6, run: (s) => s.tear(Q(1.4, 0.2, 0.05)) },
  { name: 'creakShut 2.4s', sec: 5, run: (s) => s.creakShut(Q(-2.2, 0.6, -0.3), 2.4) },
  { name: 'shatter', sec: 4, run: (s) => s.shatter() },
  {
    name: 'laugh 4s',
    sec: 6,
    run: (s) => {
      let k = 0;
      s.laugh(4, () => {
        const ang = ++k * 1.3;
        return { x: Math.sin(ang) * 1.9, y: 1.45, z: Math.cos(ang) * 1.9 };
      });
    },
  },
  { name: 'choke 3s', sec: 4.5, run: (s) => s.choke(3) },
  { name: 'pounce', sec: 3, run: (s) => s.pounce() },
  { name: 'eat 3.5s', sec: 5, run: (s) => s.eat(3.5) },
  { name: 'eat 3.5s @3m', sec: 5, run: (s) => s.eat(3.5, Q(3, -1, -1.1)) },
  { name: 'sting', sec: 3.5, run: (s) => s.sting() },
  { name: 'heart 0.35', sec: 4, run: (s) => (s.setHeart(0.35), s.prime(3.6)) },
  { name: 'heart 0.6', sec: 4, run: (s) => (s.setHeart(0.6), s.prime(3.6)) },
  { name: 'heart 1', sec: 4, run: (s) => (s.setHeart(1), s.prime(3.6)) },
  { name: 'ring 0.25', sec: 2.5, run: (s) => s.setRing(0.25) },
  { name: 'ring 0.6', sec: 2.5, run: (s) => s.setRing(0.6) },
  { name: 'ring 1', sec: 2.5, run: (s) => s.setRing(1) },
  {
    name: 'trap mix',
    sec: 11.5,
    run: (s, off) => {
      s.creakShut(Q(-2.2, 0.5, -0.3), 2.4);
      later(off, 2.6, () => s.shatter());
      let k = 0;
      later(off, 3.3, () => s.laugh(4, () => ({ x: Math.sin(++k * 1.4) * 1.9, y: 1.45, z: Math.cos(k * 1.4) * 1.9 })));
      later(off, 7.3, () => (s.setHeart(1), s.prime(3.4), s.choke(3)));
    },
  },
  {
    name: 'hunt mix',
    sec: 12,
    run: (s, off) => {
      s.setRing(0.4);
      s.setHeart(0.6);
      s.prime(3);
      s.tear(Q(4, 1, 0.1));
      later(off, 3, () => (s.sting(), s.setRing(0.6), s.setHeart(1), s.prime(5)));
      later(off, 7.5, () => (s.pounce(), s.prime(4)));
      later(off, 7.95, () => s.eat(3.5));
    },
  },
];

interface Row {
  name: string;
  sec: number;
  peak: number;
  rms: number;
  loud: number;
  rawPeak: number;
  nan: number;
  tail: number;
  dc: number;
  ms: number;
  /** доли энергии по полосам BANDS, % */
  bands: number[];
  centroid: number;
  /** высота голоса (только смех): медиана [10%…90%], Гц */
  f0: string;
}

async function render(c: Case, limiter: boolean): Promise<AudioBuffer> {
  const off = new OfflineAudioContext({ numberOfChannels: 2, length: Math.ceil(SR * c.sec), sampleRate: SR });
  const s = new SmileAudio({ context: off, limiter });
  s.update(EYE0, 0, 0);
  c.run(s, off);
  return off.startRendering();
}

function stats(b: AudioBuffer) {
  const chs = Array.from({ length: b.numberOfChannels }, (_, c) => b.getChannelData(c));
  const W = Math.floor(b.sampleRate * 0.05), tailN = Math.floor(b.sampleRate * 0.02);
  let peak = 0, s2 = 0, nan = 0, tail = 0, dc = 0, w2 = 0, loud = 0;
  for (let i = 0; i < b.length; i++) {
    let fr = 0;
    for (const d of chs) {
      const v = d[i];
      if (!Number.isFinite(v)) {
        nan++;
        continue;
      }
      const av = Math.abs(v);
      if (av > peak) peak = av;
      if (i >= b.length - tailN && av > tail) tail = av;
      s2 += v * v;
      dc += v;
      fr += v * v;
    }
    w2 += fr / chs.length;
    if (i % W === W - 1) {
      loud = Math.max(loud, Math.sqrt(w2 / W));
      w2 = 0;
    }
  }
  const n = b.length * chs.length;
  return { peak, rms: Math.sqrt(s2 / n), loud, nan, tail, dc: dc / n };
}

const db = (v: number) => (v > 1e-9 ? (20 * Math.log10(v)).toFixed(1) : '−∞');

/** БПФ на месте (radix-2), длина — степень двойки. */
function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

/** границы полос, Гц: <150 · 150–600 · 600–2k · 2k–6k · >6k */
const BANDS = [150, 600, 2000, 6000];

/** Средний спектр (окна Ханна по 2048): доли энергии по полосам BANDS, %, и центроид, Гц. */
function spectrum(b: AudioBuffer): { bands: number[]; centroid: number } {
  const N = 2048, chs = Array.from({ length: b.numberOfChannels }, (_, c) => b.getChannelData(c));
  const pw = new Float64Array(N / 2);
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let o = 0; o + N <= b.length; o += N) {
    for (let i = 0; i < N; i++) {
      let s = 0;
      for (const d of chs) s += d[o + i];
      re[i] = (s / chs.length) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k < N / 2; k++) pw[k] += re[k] * re[k] + im[k] * im[k];
  }
  const bands = [0, 0, 0, 0, 0];
  let tot = 0, cen = 0;
  for (let k = 1; k < N / 2; k++) {
    const f = (k * b.sampleRate) / N;
    let j = 0;
    while (j < BANDS.length && f >= BANDS[j]) j++;
    bands[j] += pw[k];
    tot += pw[k];
    cen += f * pw[k];
  }
  return { bands: bands.map((v) => (tot > 0 ? (100 * v) / tot : 0)), centroid: tot > 0 ? cen / tot : 0 };
}

/** Высота голоса: медиана и разброс (10–90%) по озвученным окнам 40 мс (автокорреляция 230…700 Гц, ≥ 0.55). */
function pitch(b: AudioBuffer): { med: number; lo: number; hi: number; frames: number } {
  const sr = b.sampleRate, N = Math.floor(sr * 0.04), d = b.getChannelData(0);
  const lagLo = Math.floor(sr / 700), lagHi = Math.ceil(sr / 230);
  let peak = 0;
  for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  const f0s: number[] = [];
  for (let o = 0; o + N + lagHi < d.length; o += N >> 1) {
    let e = 0;
    for (let i = 0; i < N; i++) e += d[o + i] * d[o + i];
    if (Math.sqrt(e / N) < peak * 0.08) continue;
    let best = 0, bl = 0;
    for (let lag = lagLo; lag <= lagHi; lag++) {
      let s = 0, e2 = 0;
      for (let i = 0; i < N; i++) {
        s += d[o + i] * d[o + i + lag];
        e2 += d[o + i + lag] * d[o + i + lag];
      }
      const r = s / Math.sqrt(e * e2 + 1e-12);
      if (r > best) {
        best = r;
        bl = lag;
      }
    }
    if (best >= 0.55) f0s.push(sr / bl);
  }
  f0s.sort((x, y) => x - y);
  const q = (p: number) => (f0s.length ? f0s[Math.min(f0s.length - 1, Math.floor(p * f0s.length))] : 0);
  return { med: q(0.5), lo: q(0.1), hi: q(0.9), frames: f0s.length };
}

function wav(b: AudioBuffer): Uint8Array<ArrayBuffer> {
  const ch = b.numberOfChannels, n = b.length, bytes = 44 + n * ch * 2;
  const buf = new ArrayBuffer(bytes), v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, bytes - 8, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, ch, true);
  v.setUint32(24, b.sampleRate, true);
  v.setUint32(28, b.sampleRate * ch * 2, true);
  v.setUint16(32, ch * 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, n * ch * 2, true);
  const data = Array.from({ length: ch }, (_, c) => b.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++)
    for (let c = 0; c < ch; c++) {
      const x = Math.max(-1, Math.min(1, Number.isFinite(data[c][i]) ? data[c][i] : 0));
      v.setInt16(o, Math.round(x * 32767), true);
      o += 2;
    }
  return new Uint8Array(buf);
}

function b64(u: Uint8Array): string {
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}

async function renderOne(name: string): Promise<{ row: Row; wav: string; blob: Blob }> {
  const c = CASES.find((k) => k.name === name);
  if (!c) throw new Error(`нет случая ${name}`);
  const t = performance.now();
  const lim = await render(c, true);
  const ms = performance.now() - t;
  const raw = await render(c, false);
  const st = stats(lim), sr = stats(raw), sp = spectrum(raw);
  let f0 = '';
  if (name.startsWith('laugh')) {
    const p = pitch(raw);
    f0 = `${p.med.toFixed(0)} [${p.lo.toFixed(0)}…${p.hi.toFixed(0)}] n=${p.frames}`;
  }
  const w = wav(lim);
  return { row: { name, sec: c.sec, ...st, nan: st.nan + sr.nan, rawPeak: sr.peak, ms, bands: sp.bands, centroid: sp.centroid, f0 }, wav: b64(w), blob: new Blob([w], { type: 'audio/wav' }) };
}

function rowHtml(r: Row, url: string) {
  const cls = (ok: boolean, warn = false) => (ok ? 'ok' : warn ? 'warn' : 'bad');
  return `<tr><td>${r.name}</td><td>${r.sec}</td><td class="${cls(r.peak < 0.8)}">${db(r.peak)}</td><td>${db(r.rms)}</td><td>${db(r.loud)}</td><td class="${cls(r.rawPeak < 1, r.rawPeak < 1.6)}">${db(r.rawPeak)}</td><td class="${cls(r.nan === 0)}">${r.nan}</td><td class="${/^(heart|ring)|mix/.test(r.name) ? '' : cls(r.tail < 0.01, r.tail < 0.05)}">${db(r.tail)}</td><td>${r.dc.toExponential(1)}</td><td>${r.bands.map((v) => v.toFixed(0)).join(' · ')}</td><td>${r.centroid.toFixed(0)}</td><td>${r.f0}</td><td><audio controls src="${url}"></audio></td></tr>`;
}

const HEAD =
  '<tr><th>звук</th><th>с</th><th>пик дБ</th><th>RMS дБ</th><th>50 мс дБ</th><th>сырой пик</th><th>NaN</th><th>хвост</th><th>DC</th><th>энергия % &lt;150·600·2k·6k·выше</th><th>центроид Гц</th><th>f0 голоса</th><th></th></tr>';

async function renderAll(): Promise<Row[]> {
  const tbl = $('tbl');
  tbl.innerHTML = HEAD;
  const rows: Row[] = [];
  for (const c of CASES) {
    const r = await renderOne(c.name);
    rows.push(r.row);
    tbl.insertAdjacentHTML('beforeend', rowHtml(r.row, URL.createObjectURL(r.blob)));
  }
  return rows;
}

$('renderAll').onclick = () => void renderAll();

declare global {
  interface Window {
    __smileAudioQA?: Row[] | { error: string };
    __smileCases?: string[];
    __smileRenderOne?: (name: string) => Promise<{ row: Row; wav: string }>;
  }
}
window.__smileCases = CASES.map((c) => c.name);
window.__smileRenderOne = async (name) => {
  const r = await renderOne(name);
  if (!$('tbl').innerHTML) $('tbl').innerHTML = HEAD;
  $('tbl').insertAdjacentHTML('beforeend', rowHtml(r.row, URL.createObjectURL(r.blob)));
  return { row: r.row, wav: r.wav };
};
if (new URLSearchParams(location.search).get('auto') === '1')
  renderAll().then(
    (rows) => (window.__smileAudioQA = rows),
    (e) => (window.__smileAudioQA = { error: String(e) }),
  );
