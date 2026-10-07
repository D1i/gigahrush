// Бесшовные текстуры отделки из фото/скана: плитка, которая повторяется без видимых швов.
// Используется инструментом tools/make-seamless.* (обои пользователя) и UI загрузки своих текстур.
//
// Метод — «кроссфейд со сдвигом»: плитка N×M берётся из исходника с запасом; в полосе шириной ox у
// левого края пиксель плитки плавно смешивается с пикселем исходника, сдвинутым на D ≈ N вправо
// (у верхнего края — на D ≈ M вниз). На краю плитки берётся «чужой» пиксель S(x + D), поэтому
// при повторе правый край S(N−1) переходит в S(D) ≈ S(N) — непрерывно, как в самом исходнике.
// Если у узора есть период (обои, кафель), D берётся кратным периоду: в полосе смешиваются
// совпадающие участки узора, и рисунок не двоится. Виньетку и пятна освещения снимает flatten.

export type ImageSrc = HTMLCanvasElement | HTMLImageElement | ImageBitmap;

export interface SeamlessOpts {
  /** область исходника, px: [x, y, w, h]; по умолчанию — всё без полей crop */
  rect?: [number, number, number, number];
  /** поля, срезаемые с каждого края (доля стороны), если rect не задан; по умолчанию 0.04 */
  crop?: number;
  /** период узора по X и Y, px исходника (дробный — можно): плитка = целое число периодов.
   *  'auto' — найти автокорреляцией; null/не задан — обычная сшивка без учёта узора. */
  period?: { x: number; y: number } | 'auto' | null;
  /** сколько периодов в плитке (при period); по умолчанию — сколько поместится с запасом на blend */
  repeats?: { x: number; y: number };
  /** ширина полосы кроссфейда в долях плитки, 0.05…0.5; по умолчанию 0.2 */
  blend?: number;
  /** снять виньетку и неровное освещение: 0 — нет, 1 — полностью; по умолчанию 0.7 */
  flatten?: number;
  /**
   * Заплатки (ретушь пятен, водяных знаков): область rect, px исходника, заменяется пикселями со сдвигом
   * from (для узора — кратным периоду) с мягким краем feather px. И область, и источник — внутри rect плитки.
   */
  patches?: { rect: [number, number, number, number]; from: [number, number]; feather?: number }[];
  /**
   * Ослабить непериодическую грязь (потёки, пятна) — только при известном периоде: эталон узора —
   * медиана копий кадра со сдвигами на целые периоды; из пикселя вычитается сглаженное отличие от
   * эталона с весом degrunge (0 — оставить как есть, 1 — убрать всю крупную грязь). Резкость не теряется.
   */
  degrunge?: number;
}

export interface SeamlessInfo {
  /** плитка в пикселях исходника (до масштабирования) */
  w: number;
  h: number;
  /** использованный сдвиг D (дробный, кратен периоду, если он есть) */
  dx: number;
  dy: number;
  period: { x: number; y: number } | null;
  /** сколько периодов в плитке */
  repeats: { x: number; y: number } | null;
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const smooth = (t: number) => {
  const u = clamp(t, 0, 1);
  return u * u * (3 - 2 * u);
};

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const x = c.getContext('2d', { willReadFrequently: true });
  if (!x) throw new Error('Canvas 2D недоступен');
  return x;
}

const srcW = (s: ImageSrc) => ('naturalWidth' in s ? s.naturalWidth : s.width);
const srcH = (s: ImageSrc) => ('naturalHeight' in s ? s.naturalHeight : s.height);

/** Область исходника в RGB float (0..255), без альфы. */
interface Plane {
  w: number;
  h: number;
  /** r, g, b подряд */
  d: Float32Array;
}

function readPlane(src: ImageSrc, rect: [number, number, number, number]): Plane {
  const [x, y, w, h] = rect;
  const c = canvas(w, h);
  const g = ctx2d(c);
  g.drawImage(src, x, y, w, h, 0, 0, c.width, c.height);
  const id = g.getImageData(0, 0, c.width, c.height).data;
  const d = new Float32Array(c.width * c.height * 3);
  for (let i = 0, j = 0; i < id.length; i += 4, j += 3) {
    d[j] = id[i];
    d[j + 1] = id[i + 1];
    d[j + 2] = id[i + 2];
  }
  return { w: c.width, h: c.height, d };
}

/** Низкочастотная составляющая (размытие с радиусом ~r px): уменьшить в r раз и растянуть обратно. */
function lowPass(pl: Plane, r: number): Plane {
  const c = canvas(pl.w, pl.h);
  const g = ctx2d(c);
  const img = g.createImageData(pl.w, pl.h);
  for (let i = 0, j = 0; j < pl.d.length; i += 4, j += 3) {
    img.data[i] = pl.d[j];
    img.data[i + 1] = pl.d[j + 1];
    img.data[i + 2] = pl.d[j + 2];
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // ступенчатое уменьшение (вдвое за шаг) — без муара от прореживания
  let cur = c;
  const tw = Math.max(2, Math.round(pl.w / r)), th = Math.max(2, Math.round(pl.h / r));
  while (cur.width / 2 > tw && cur.height / 2 > th) {
    const n = canvas(cur.width / 2, cur.height / 2);
    const ng = ctx2d(n);
    ng.imageSmoothingEnabled = true;
    ng.imageSmoothingQuality = 'high';
    ng.drawImage(cur, 0, 0, n.width, n.height);
    cur = n;
  }
  const small = canvas(tw, th);
  const sg = ctx2d(small);
  sg.imageSmoothingQuality = 'high';
  sg.drawImage(cur, 0, 0, tw, th);
  const big = canvas(pl.w, pl.h);
  const bg = ctx2d(big);
  bg.imageSmoothingEnabled = true;
  bg.imageSmoothingQuality = 'high';
  // растягиваем так, чтобы центры пикселей совпали (без сдвига на полпикселя)
  bg.drawImage(small, 0, 0, tw, th, 0, 0, pl.w, pl.h);
  const out = bg.getImageData(0, 0, pl.w, pl.h).data;
  const d = new Float32Array(pl.d.length);
  for (let i = 0, j = 0; j < d.length; i += 4, j += 3) {
    d[j] = out[i];
    d[j + 1] = out[i + 1];
    d[j + 2] = out[i + 2];
  }
  return { w: pl.w, h: pl.h, d };
}

/** Снять неровное освещение: пиксель · (среднее / местное среднее)^k, по каналам. */
function flattenPlane(pl: Plane, radius: number, k: number): void {
  if (k <= 0) return;
  const lo = lowPass(pl, radius);
  const mean = [0, 0, 0];
  const n = pl.w * pl.h;
  for (let j = 0; j < pl.d.length; j += 3) {
    mean[0] += pl.d[j];
    mean[1] += pl.d[j + 1];
    mean[2] += pl.d[j + 2];
  }
  for (let c = 0; c < 3; c++) mean[c] /= n;
  for (let j = 0; j < pl.d.length; j += 3) {
    for (let c = 0; c < 3; c++) {
      const f = Math.pow(mean[c] / Math.max(4, lo.d[j + c]), k);
      pl.d[j + c] = clamp(pl.d[j + c] * f, 0, 255);
    }
  }
}

/** Билинейная выборка канала c в точке (x, y) (с прижатием к краям). */
function sample(pl: Plane, x: number, y: number, c: number): number {
  const x0 = clamp(Math.floor(x), 0, pl.w - 1), y0 = clamp(Math.floor(y), 0, pl.h - 1);
  const x1 = Math.min(pl.w - 1, x0 + 1), y1 = Math.min(pl.h - 1, y0 + 1);
  const fx = clamp(x - x0, 0, 1), fy = clamp(y - y0, 0, 1);
  const d = pl.d, w = pl.w;
  const a = d[(y0 * w + x0) * 3 + c], b = d[(y0 * w + x1) * 3 + c];
  const e = d[(y1 * w + x0) * 3 + c], f = d[(y1 * w + x1) * 3 + c];
  return (a + (b - a) * fx) * (1 - fy) + (e + (f - e) * fx) * fy;
}

/** Заплатка: пиксели области ← пиксели со сдвигом from; маска плавно спадает за краем на feather px. */
function applyPatch(pl: Plane, pt: NonNullable<SeamlessOpts['patches']>[number], ox: number, oy: number): void {
  const [rx, ry, rw, rh] = pt.rect;
  const fe = Math.max(1, pt.feather ?? 8);
  const [fx, fy] = pt.from;
  const x0 = Math.max(0, Math.floor(rx - ox - fe)), x1 = Math.min(pl.w, Math.ceil(rx - ox + rw + fe));
  const y0 = Math.max(0, Math.floor(ry - oy - fe)), y1 = Math.min(pl.h, Math.ceil(ry - oy + rh + fe));
  const src = new Float32Array(pl.d); // читаем из копии — заплатки не наслаиваются сами на себя
  const from: Plane = { w: pl.w, h: pl.h, d: src };
  for (let y = y0; y < y1; y++) {
    const dy = Math.max(0, ry - oy - y, y - (ry - oy + rh));
    for (let x = x0; x < x1; x++) {
      const dx = Math.max(0, rx - ox - x, x - (rx - ox + rw));
      const m = smooth(1 - Math.hypot(dx, dy) / fe);
      if (m <= 0) continue;
      const o = (y * pl.w + x) * 3;
      for (let c = 0; c < 3; c++) pl.d[o + c] = pl.d[o + c] * (1 - m) + sample(from, x + fx, y + fy, c) * m;
    }
  }
}

/** Размытие одного float-поля коробкой радиуса r (два прохода — почти гаусс). */
function boxBlur(f: Float32Array, w: number, h: number, r: number): void {
  const tmp = new Float32Array(f.length);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < h; y++) {
      let acc = 0;
      for (let x = -r; x <= r; x++) acc += f[y * w + clamp(x, 0, w - 1)];
      for (let x = 0; x < w; x++) {
        tmp[y * w + x] = acc / (2 * r + 1);
        acc += f[y * w + clamp(x + r + 1, 0, w - 1)] - f[y * w + clamp(x - r, 0, w - 1)];
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += tmp[clamp(y, 0, h - 1) * w + x];
      for (let y = 0; y < h; y++) {
        f[y * w + x] = acc / (2 * r + 1);
        acc += tmp[clamp(y + r + 1, 0, h - 1) * w + x] - tmp[clamp(y - r, 0, h - 1) * w + x];
      }
    }
  }
}

/** Чистка непериодической грязи в области rect (см. SeamlessOpts.degrunge). */
function degrunge(pl: Plane, period: { x: number; y: number }, rect: [number, number, number, number], k: number): void {
  const [rx, ry, rw, rh] = rect;
  const m = 2; // поле от края кадра, где копии не берутся (там прижатие)
  const shifts: [number, number][] = [];
  for (let b = -6; b <= 6; b++) for (let a = -6; a <= 6; a++) shifts.push([a * period.x, b * period.y]);
  const diff = [new Float32Array(rw * rh), new Float32Array(rw * rh), new Float32Array(rw * rh)];
  const vals: number[] = [];
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const X = rx + x, Y = ry + y;
      const ok = shifts.filter(([sx, sy]) => X + sx >= m && X + sx < pl.w - m - 1 && Y + sy >= m && Y + sy < pl.h - m - 1);
      if (ok.length < 5) continue;
      for (let c = 0; c < 3; c++) {
        vals.length = 0;
        for (const [sx, sy] of ok) vals.push(sample(pl, X + sx, Y + sy, c));
        vals.sort((p, q) => p - q);
        const h = vals.length >> 1;
        const med = vals.length % 2 ? vals[h] : (vals[h - 1] + vals[h]) / 2;
        diff[c][y * rw + x] = pl.d[(Y * pl.w + X) * 3 + c] - med;
      }
    }
  }
  // отличие от эталона сглаживается: убираем пятна и потёки, а мелкая фактура (переплетение бумаги) остаётся
  const r = Math.max(2, Math.round(Math.min(period.x, period.y) / 24));
  for (let c = 0; c < 3; c++) {
    boxBlur(diff[c], rw, rh, r);
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        const o = ((ry + y) * pl.w + rx + x) * 3 + c;
        pl.d[o] = clamp(pl.d[o] - k * diff[c][y * rw + x], 0, 255);
      }
    }
  }
}

/** Яркость с вычтенным фоном — для поиска периода. */
function detail(pl: Plane, radius: number): Float32Array {
  const lo = lowPass(pl, radius);
  const g = new Float32Array(pl.w * pl.h);
  for (let i = 0, j = 0; i < g.length; i++, j += 3) {
    const y = 0.299 * pl.d[j] + 0.587 * pl.d[j + 1] + 0.114 * pl.d[j + 2];
    const m = 0.299 * lo.d[j] + 0.587 * lo.d[j + 1] + 0.114 * lo.d[j + 2];
    g[i] = y - m;
  }
  return g;
}

/** Нормированная корреляция детали с собой при сдвиге (sx, sy). */
function corrAt(g: Float32Array, w: number, h: number, sx: number, sy: number, step = 2): number {
  let sab = 0, saa = 0, sbb = 0;
  const x0 = Math.max(0, -sx), x1 = Math.min(w, w - sx);
  const y0 = Math.max(0, -sy), y1 = Math.min(h, h - sy);
  if (x1 - x0 < 8 || y1 - y0 < 8) return -1;
  for (let y = y0; y < y1; y += step) {
    const r = y * w, r2 = (y + sy) * w + sx;
    for (let x = x0; x < x1; x += step) {
      const a = g[r + x], b = g[r2 + x];
      sab += a * b;
      saa += a * a;
      sbb += b * b;
    }
  }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : -1;
}

/**
 * Период узора вдоль оси автокорреляцией (px исходника, дробный — уточняется параболой по пику).
 * Возвращает наименьший сдвиг из [min, max], корреляция которого не ниже 85% лучшей, и её значение.
 */
export function findPeriod(src: ImageSrc, axis: 'x' | 'y', min: number, max: number, rect?: [number, number, number, number]): { period: number; corr: number } {
  const r = rect ?? [0, 0, srcW(src), srcH(src)];
  const pl = readPlane(src, r);
  const g = detail(pl, Math.max(8, min / 2));
  const cs: number[] = [];
  for (let s = 0; s <= max + 1; s++) cs.push(s < min - 1 ? -1 : axis === 'x' ? corrAt(g, pl.w, pl.h, s, 0) : corrAt(g, pl.w, pl.h, 0, s));
  let best = -1;
  for (let s = min; s <= max; s++) best = Math.max(best, cs[s]);
  let at = -1;
  for (let s = min; s <= max; s++) {
    // локальный максимум, близкий к лучшему — основной период (а не его кратное)
    if (cs[s] >= best * 0.85 && cs[s] >= cs[s - 1] && cs[s] >= cs[s + 1]) {
      at = s;
      break;
    }
  }
  if (at < 0) return { period: 0, corr: -1 };
  const a = cs[at - 1], b = cs[at], c = cs[at + 1];
  const den = a - 2 * b + c;
  const off = den < 0 ? clamp((0.5 * (a - c)) / den, -0.5, 0.5) : 0;
  return { period: at + off, corr: b };
}

/**
 * Бесшовная плитка из области исходника (см. описание метода вверху файла).
 * Возвращает canvas плитки в пикселях исходника (без масштабирования) и сведения о ней.
 */
export function makeSeamlessEx(src: ImageSrc, opts: SeamlessOpts = {}): { canvas: HTMLCanvasElement; info: SeamlessInfo } {
  const SW = srcW(src), SH = srcH(src);
  const crop = clamp(opts.crop ?? 0.04, 0, 0.3);
  const rect: [number, number, number, number] = opts.rect ?? [
    Math.round(SW * crop), Math.round(SH * crop), Math.round(SW * (1 - 2 * crop)), Math.round(SH * (1 - 2 * crop)),
  ];
  const blend = clamp(opts.blend ?? 0.2, 0.05, 0.5);
  const [rx, ry, rw, rh] = rect;

  let period: { x: number; y: number } | null = null;
  if (opts.period === 'auto') {
    const px = findPeriod(src, 'x', 16, Math.floor(rw / 3), rect);
    const py = findPeriod(src, 'y', 16, Math.floor(rh / 3), rect);
    if (px.corr > 0.3 && py.corr > 0.3) period = { x: px.period, y: py.period };
  } else if (opts.period) period = opts.period;

  // обработка — по всему кадру (заплаткам и чистке нужны соседние раппорты), плитка — из rect
  const pl = readPlane(src, [0, 0, SW, SH]);
  // снять освещение: радиус — пара периодов узора или ~1/6 области
  const flat = clamp(opts.flatten ?? 0.7, 0, 1);
  const rad = period ? 1.5 * Math.max(period.x, period.y) : Math.max(rw, rh) / 6;
  flattenPlane(pl, rad, flat);
  for (const pt of opts.patches ?? []) applyPatch(pl, pt, 0, 0);
  if (period && (opts.degrunge ?? 0) > 0) degrunge(pl, period, rect, opts.degrunge!);

  // сдвиг D и размер плитки: D·(1 + blend) должно поместиться в область
  let dx: number, dy: number, reps: { x: number; y: number } | null = null;
  if (period) {
    const fit = (len: number, p: number) => Math.max(1, Math.floor((len - 2) / (p * (1 + blend))));
    reps = opts.repeats ?? { x: fit(rw, period.x), y: fit(rh, period.y) };
    dx = reps.x * period.x;
    dy = reps.y * period.y;
  } else {
    dx = Math.floor((rw - 2) / (1 + blend));
    dy = Math.floor((rh - 2) / (1 + blend));
  }
  const N = Math.max(1, Math.round(dx)), M = Math.max(1, Math.round(dy));
  const ox = Math.max(1, Math.round(N * blend)), oy = Math.max(1, Math.round(M * blend));
  if (dx + ox + 1 > rw || dy + oy + 1 > rh || rx + rw > SW || ry + rh > SH) {
    throw new Error('Мало исходника для плитки: уменьшите blend или число повторов');
  }

  const out = canvas(N, M);
  const g = ctx2d(out);
  const img = g.createImageData(N, M);
  for (let y = 0; y < M; y++) {
    const ay = y < oy ? smooth(y / oy) : 1;
    for (let x = 0; x < N; x++) {
      const ax = x < ox ? smooth(x / ox) : 1;
      const o = (y * N + x) * 4;
      const X = rx + x, Y = ry + y;
      for (let c = 0; c < 3; c++) {
        // свой пиксель, сдвинутый по X, по Y и по обоим — смешиваются у левого и верхнего краёв
        const s00 = sample(pl, X, Y, c);
        const s10 = ax < 1 ? sample(pl, X + dx, Y, c) : 0;
        const s01 = ay < 1 ? sample(pl, X, Y + dy, c) : 0;
        const s11 = ax < 1 && ay < 1 ? sample(pl, X + dx, Y + dy, c) : 0;
        const top = s00 * ax + s10 * (1 - ax);
        const bot = s01 * ax + s11 * (1 - ax);
        img.data[o + c] = top * ay + bot * (1 - ay);
      }
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return { canvas: out, info: { w: N, h: M, dx, dy, period, repeats: reps } };
}

/** Бесшовная плитка (canvas в пикселях исходника). */
export function makeSeamless(src: ImageSrc, opts: SeamlessOpts = {}): HTMLCanvasElement {
  return makeSeamlessEx(src, opts).canvas;
}

/** Масштабирование плитки с учётом повтора: края фильтруются по соседним копиям, шов не появляется. */
export function resizeWrapped(src: HTMLCanvasElement, w: number, h: number): HTMLCanvasElement {
  w = Math.max(1, Math.round(w));
  h = Math.max(1, Math.round(h));
  if (w === src.width && h === src.height) return src;
  const pad = 8;
  const W = src.width, H = src.height;
  const big = canvas(W + 2 * pad, H + 2 * pad);
  const bg = ctx2d(big);
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) bg.drawImage(src, pad + i * W, pad + j * H);
  // ступенчатое уменьшение вдвое — чище, чем один большой шаг
  let cur = big;
  let cw = W, ch = H, cp = pad;
  while (cw / 2 >= w && ch / 2 >= h) {
    const n = canvas(cur.width / 2, cur.height / 2);
    const ng = ctx2d(n);
    ng.imageSmoothingQuality = 'high';
    ng.drawImage(cur, 0, 0, n.width, n.height);
    cur = n;
    cw /= 2;
    ch /= 2;
    cp /= 2;
  }
  const out = canvas(w, h);
  const og = ctx2d(out);
  og.imageSmoothingEnabled = true;
  og.imageSmoothingQuality = 'high';
  const sx = w / cw, sy = h / ch;
  og.drawImage(cur, -cp * sx, -cp * sy, cur.width * sx, cur.height * sy);
  return out;
}

/** Средний цвет (hex) — для Finish.color. */
export function averageColor(c: HTMLCanvasElement): string {
  const d = ctx2d(c).getImageData(0, 0, c.width, c.height).data;
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < d.length; i += 4) {
    r += d[i];
    g += d[i + 1];
    b += d[i + 2];
  }
  const n = d.length / 4;
  const hx = (v: number) => Math.round(v / n).toString(16).padStart(2, '0');
  return `#${hx(r)}${hx(g)}${hx(b)}`;
}

/** Плитка, повторённая nx×ny раз, — для проверки швов глазами. */
export function tilePreview(c: HTMLCanvasElement, nx = 3, ny = 3): HTMLCanvasElement {
  const out = canvas(c.width * nx, c.height * ny);
  const g = ctx2d(out);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) g.drawImage(c, i * c.width, j * c.height);
  return out;
}

/** JPEG data:URI без альфы (подложка — средний цвет, чтобы прозрачность не стала чёрной). */
export function toJpeg(c: HTMLCanvasElement, quality = 0.82): string {
  const out = canvas(c.width, c.height);
  const g = ctx2d(out);
  g.fillStyle = averageColor(c);
  g.fillRect(0, 0, out.width, out.height);
  g.drawImage(c, 0, 0);
  return out.toDataURL('image/jpeg', quality);
}

/** Уменьшить изображение до длинной стороны ≤ maxSide (ступенями вдвое); меньшее — копия как есть. */
function downscale(img: ImageSrc, maxSide: number): HTMLCanvasElement {
  const W = srcW(img), H = srcH(img);
  let cur = canvas(W, H);
  ctx2d(cur).drawImage(img, 0, 0);
  const k = Math.min(1, maxSide / Math.max(W, H));
  if (k >= 1) return cur;
  const tw = Math.round(W * k), th = Math.round(H * k);
  while (cur.width / 2 >= tw && cur.height / 2 >= th) {
    const n = canvas(cur.width / 2, cur.height / 2);
    const g = ctx2d(n);
    g.imageSmoothingQuality = 'high';
    g.drawImage(cur, 0, 0, n.width, n.height);
    cur = n;
  }
  const out = canvas(tw, th);
  const g = ctx2d(out);
  g.imageSmoothingQuality = 'high';
  g.drawImage(cur, 0, 0, tw, th);
  return out;
}

function loadImage(file: Blob | string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = typeof file === 'string' ? file : URL.createObjectURL(file);
    img.onload = () => {
      if (typeof file !== 'string') URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      if (typeof file !== 'string') URL.revokeObjectURL(url);
      reject(new Error('Не удалось прочитать изображение'));
    };
    img.src = url;
  });
}

export interface LoadTextureOpts {
  /** длинная сторона результата, px; по умолчанию 1024 (меньше не растягивается) */
  maxSide?: number;
  /** сделать бесшовной: true — с настройками по умолчанию; объект — свои настройки; false — как есть */
  seamless?: boolean | SeamlessOpts;
  /** качество JPEG, по умолчанию 0.82 */
  quality?: number;
}

/** Загрузить текстуру отделки: data:URI JPEG + размеры и средний цвет. */
export async function loadFinishTextureEx(
  file: Blob | string,
  opts: LoadTextureOpts = {},
): Promise<{ url: string; w: number; h: number; color: string; info: SeamlessInfo | null }> {
  const img = await loadImage(file);
  const max = opts.maxSide ?? 1024;
  let c: HTMLCanvasElement;
  let info: SeamlessInfo | null = null;
  if (opts.seamless) {
    const so = opts.seamless === true ? {} : opts.seamless;
    // большое фото сначала уменьшаем до рабочего размера (поиск периода и чистка — квадратичны по размеру);
    // если заданы rect/patches/period в пикселях исходника — работаем в исходном размере
    const pixelOpts = so.rect || so.patches || (so.period && so.period !== 'auto');
    const work = pixelOpts ? img : downscale(img, Math.max(512, Math.round(max * 1.3)));
    const r = makeSeamlessEx(work, so);
    c = r.canvas;
    info = r.info;
  } else {
    c = canvas(img.naturalWidth, img.naturalHeight);
    ctx2d(c).drawImage(img, 0, 0);
  }
  const k = Math.min(1, max / Math.max(c.width, c.height));
  if (k < 1) c = resizeWrapped(c, c.width * k, c.height * k);
  return { url: toJpeg(c, opts.quality ?? 0.82), w: c.width, h: c.height, color: averageColor(c), info };
}

/** Загрузить текстуру отделки (файл или data:URI) → data:URI JPEG, длинная сторона ≤ maxSide. */
export async function loadFinishTexture(file: Blob | string, opts: LoadTextureOpts = {}): Promise<string> {
  return (await loadFinishTextureEx(file, opts)).url;
}
