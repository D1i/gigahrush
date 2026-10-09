// Процедурные текстуры отделки: обои, кафель, краска, побелка, штукатурка, бетон, кирпич, ДВП, полы.
// Стиль — как у мебели (textures.ts): плоские заливки, тонкие тёмные линии, лёгкий скос, без фотошума.
//
// Бесшовность по построению:
//  • всё, что может пересечь край, рисуется ещё 8 раз со сдвигом на ±W/±H (wrap), с теми же
//    случайными параметрами — продолжение за правым краем совпадает с началом у левого;
//  • сетки (кафель, доски, ромбы) кратны размеру картинки;
//  • шум — на периодической решётке (целое число ячеек на сторону, индексы по модулю).
// Результат — JPEG без альфы; null, если нет document (тесты в node). Детерминированно по kind + opts.

export type FinishTexKind =
  | 'stripe' | 'flower' | 'rhomb' | 'rogozhka'
  | 'tile' | 'paint' | 'whitewash' | 'plaster' | 'concrete' | 'brick' | 'dvp'
  | 'lino_parquet' | 'lino_speckle' | 'herringbone' | 'metlakh' | 'boards' | 'tile_floor' | 'tile_panel';

export interface FinishTexOpts {
  /** основной цвет */
  base?: string;
  /** второй цвет (узор, швы, малые плитки) */
  accent?: string;
  /** число элементов по стороне (кафель) */
  n?: number;
  /** трещины и выбоины (бетон пола) */
  cracks?: boolean;
  /** кафельная панель (tile_panel): нижний ряд плитки и бордюр-полплитки сверху */
  low?: string;
  high?: string;
}

// ---------------------------------------------------------------- цвет и ГСЧ

type RGB = [number, number, number];

function hex(h: string): RGB {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (c: RGB) => '#' + c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');

/** Осветлить (k > 0) или затемнить (k < 0). */
function shade(h: string, k: number): string {
  const t = k < 0 ? 0 : 255, a = Math.abs(k);
  return toHex(hex(h).map((v) => v + (t - v) * a) as RGB);
}

function mix(a: string, b: string, t: number): string {
  const x = hex(a), y = hex(b);
  return toHex([0, 1, 2].map((i) => x[i] + (y[i] - x[i]) * t) as RGB);
}

const rgba = (h: string, a: number) => {
  const [r, g, b] = hex(h);
  return `rgba(${r},${g},${b},${a})`;
};

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 — детерминированные узоры. */
function makeRng(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- холст с повтором

class T {
  readonly r: () => number;
  constructor(readonly c: CanvasRenderingContext2D, readonly W: number, readonly H: number, seed: string) {
    this.r = makeRng(hashStr(seed));
    c.lineCap = 'round';
    c.lineJoin = 'round';
  }
  /** случайное в [a, b) */
  u(a: number, b: number): number {
    return a + (b - a) * this.r();
  }
  /** Нарисовать 9 раз со сдвигами ±W, ±H — для фигур на краю. */
  wrap(fn: (ox: number, oy: number) => void): void {
    for (const oy of [-this.H, 0, this.H]) for (const ox of [-this.W, 0, this.W]) fn(ox, oy);
  }
  fill(color: string): void {
    this.c.fillStyle = color;
    this.c.fillRect(0, 0, this.W, this.H);
  }
  /**
   * Периодический шум значений: cx × cy ячеек на картинку, сглаженная билинейная интерполяция,
   * индексы решётки по модулю — края сходятся. Значения 0..1.
   */
  noise(cx: number, cy: number): Float32Array {
    const { W, H } = this;
    const g = new Float32Array(cx * cy);
    for (let i = 0; i < g.length; i++) g[i] = this.r();
    const out = new Float32Array(W * H);
    const s = (t: number) => t * t * (3 - 2 * t);
    // индексы решётки и веса по осям — один раз на строку/столбец
    const axis = (n: number, cells: number) => {
      const i0 = new Int32Array(n), i1 = new Int32Array(n), tt = new Float32Array(n);
      for (let k = 0; k < n; k++) {
        const f = (k / n) * cells, fl = Math.floor(f);
        i0[k] = fl % cells;
        i1[k] = (fl + 1) % cells;
        tt[k] = s(f - fl);
      }
      return { i0, i1, tt };
    };
    const ax = axis(W, cx), ay = axis(H, cy);
    for (let y = 0; y < H; y++) {
      const r0 = ay.i0[y] * cx, r1 = ay.i1[y] * cx, ty = ay.tt[y];
      for (let x = 0; x < W; x++) {
        const i0 = ax.i0[x], i1 = ax.i1[x], tx = ax.tt[x];
        const a = g[r0 + i0] + (g[r0 + i1] - g[r0 + i0]) * tx;
        const b = g[r1 + i0] + (g[r1 + i1] - g[r1 + i0]) * tx;
        out[y * W + x] = a + (b - a) * ty;
      }
    }
    return out;
  }
  /** Фрактальный шум: октавы с удвоением числа ячеек, амплитуда ×0.5. */
  fbm(cx: number, cy: number, oct: number): Float32Array {
    const out = new Float32Array(this.W * this.H);
    let amp = 1, sum = 0;
    for (let k = 0; k < oct; k++) {
      const n = this.noise(cx << k, cy << k);
      for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
      sum += amp;
      amp *= 0.5;
    }
    for (let i = 0; i < out.length; i++) out[i] /= sum;
    return out;
  }
  /** Яркость · (1 + amp·(2n − 1)); tint — сдвиг к цвету вместо затемнения. */
  modulate(n: Float32Array, amp: number, tint?: string): void {
    const id = this.c.getImageData(0, 0, this.W, this.H);
    const d = id.data;
    const tc = tint ? hex(tint) : null;
    for (let i = 0, p = 0; p < n.length; i += 4, p++) {
      const k = amp * (2 * n[p] - 1);
      if (tc) {
        const t = Math.max(0, k);
        for (let ch = 0; ch < 3; ch++) d[i + ch] = d[i + ch] + (tc[ch] - d[i + ch]) * t;
      } else {
        for (let ch = 0; ch < 3; ch++) d[i + ch] = d[i + ch] * (1 + k);
      }
    }
    this.c.putImageData(id, 0, 0);
  }
  /** Мелкие точки (крапины, поры) с повтором через край. */
  specks(count: number, colors: string[], r0: number, r1: number, alpha: number): void {
    const c = this.c;
    for (let i = 0; i < count; i++) {
      const x = this.u(0, this.W), y = this.u(0, this.H), rr = this.u(r0, r1);
      const col = colors[Math.floor(this.r() * colors.length)];
      c.fillStyle = rgba(col, alpha * this.u(0.6, 1));
      this.wrap((ox, oy) => {
        if (x + ox < -rr || x + ox > this.W + rr || y + oy < -rr || y + oy > this.H + rr) return;
        c.beginPath();
        c.arc(x + ox, y + oy, rr, 0, Math.PI * 2);
        c.fill();
      });
    }
  }
  rect(x: number, y: number, w: number, h: number, fill: string): void {
    this.c.fillStyle = fill;
    this.c.fillRect(x, y, w, h);
  }
  line(x1: number, y1: number, x2: number, y2: number, color: string, w: number): void {
    const c = this.c;
    c.strokeStyle = color;
    c.lineWidth = w;
    c.beginPath();
    c.moveTo(x1, y1);
    c.lineTo(x2, y2);
    c.stroke();
  }
  /** Плитка: заливка, скос (светлая кромка сверху-слева, тень снизу-справа), опц. блик. */
  tileRect(x: number, y: number, w: number, h: number, fill: string, bev: number, gloss: number): void {
    const c = this.c;
    this.rect(x, y, w, h, fill);
    if (bev > 0) {
      this.rect(x, y, w, bev, shade(fill, 0.22));
      this.rect(x, y, bev, h, shade(fill, 0.14));
      this.rect(x, y + h - bev, w, bev, shade(fill, -0.16));
      this.rect(x + w - bev, y, bev, h, shade(fill, -0.1));
    }
    if (gloss > 0) {
      const g = c.createLinearGradient(x, y, x + w, y + h);
      g.addColorStop(0, `rgba(255,255,255,${gloss})`);
      g.addColorStop(0.45, 'rgba(255,255,255,0)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.fillRect(x + bev, y + bev, w - 2 * bev, h - 2 * bev);
    }
  }
}

// ---------------------------------------------------------------- обои

/** Бумага обоев: мягкие облака и вертикальное волокно. */
function paper(t: T, amp = 0.035): void {
  t.modulate(t.fbm(3, 3, 3), amp);
  t.modulate(t.noise(96, 3), amp * 0.5);
}

/** Обои в полоску: две одинаковые группы полос на раппорт (беж). */
function drawStripe(t: T, o: FinishTexOpts): void {
  const base = o.base ?? '#d6c49c';
  const acc = o.accent ?? '#a88f62';
  const { W, H } = t;
  t.fill(base);
  const P = W / 2; // период полос
  for (let k = 0; k < 2; k++) {
    const x = k * P;
    t.rect(x + 0.02 * P, 0, 0.34 * P, H, shade(base, 0.32)); // широкая светлая
    t.rect(x + 0.05 * P, 0, 0.012 * P + 1, H, rgba(acc, 0.8));
    t.rect(x + 0.31 * P, 0, 0.012 * P + 1, H, rgba(acc, 0.8));
    t.rect(x + 0.55 * P, 0, 0.16 * P, H, shade(base, -0.06)); // узкая тёмная
    t.rect(x + 0.84 * P, 0, 0.02 * P + 1, H, rgba(acc, 0.55));
    // столбик ромбиков в узкой полосе: шаг делит высоту
    const n = Math.round(H / (0.08 * P)), step = H / n, cx = x + 0.63 * P, s = 0.035 * P;
    t.c.fillStyle = shade(acc, 0.1);
    for (let i = 0; i < n; i++) {
      const cy = (i + 0.5) * step;
      t.c.beginPath();
      t.c.moveTo(cx, cy - s);
      t.c.lineTo(cx + s * 0.7, cy);
      t.c.lineTo(cx, cy + s);
      t.c.lineTo(cx - s * 0.7, cy);
      t.c.closePath();
      t.c.fill();
    }
    // точечный пунктир в светлой полосе
    const m = Math.round(H / (0.05 * P)), st = H / m;
    t.c.fillStyle = rgba(acc, 0.45);
    for (let i = 0; i < m; i++) {
      t.c.beginPath();
      t.c.arc(x + 0.19 * P, (i + 0.5) * st, 0.012 * P + 0.6, 0, Math.PI * 2);
      t.c.fill();
    }
  }
  paper(t);
}

/** Цветок: 5 лепестков, серединка, два листика. */
function flower(t: T, x: number, y: number, r: number, rot: number, petal: string, mid: string, leaf: string): void {
  const c = t.c;
  c.save();
  c.translate(x, y);
  c.rotate(rot);
  c.fillStyle = leaf;
  for (const a of [Math.PI * 0.75, Math.PI * 1.25]) {
    c.save();
    c.rotate(a);
    c.beginPath();
    c.ellipse(r * 1.55, 0, r * 0.75, r * 0.32, 0, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }
  c.fillStyle = petal;
  c.strokeStyle = shade(petal, -0.25);
  c.lineWidth = Math.max(0.8, r * 0.08);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    c.beginPath();
    c.ellipse(Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62, r * 0.5, r * 0.36, a, 0, Math.PI * 2);
    c.fill();
    c.stroke();
  }
  c.fillStyle = mid;
  c.beginPath();
  c.arc(0, 0, r * 0.3, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

/** Обои «цветочек»: россыпь мелких цветов в шахматном (half-drop) порядке, розоватый фон. */
function drawFlower(t: T, o: FinishTexOpts): void {
  const base = o.base ?? '#e8d0c6';
  const petal = o.accent ?? '#c47d84';
  const { W, H } = t;
  t.fill(base);
  // тонкие вертикальные полоски-«нитки» фона
  for (let k = 0; k < 8; k++) t.rect((k + 0.5) * (W / 8), 0, 1, H, rgba(shade(base, -0.2), 0.35));
  const n = 4, sx = W / n, sy = H / n, r = sx * 0.1;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = (i + 0.5) * sx, y = (j + 0.25 + (i % 2) * 0.5) * sy;
      const rot = t.u(0, Math.PI * 2);
      t.wrap((ox, oy) => {
        if (x + ox < -3 * r || x + ox > W + 3 * r || y + oy < -3 * r || y + oy > H + 3 * r) return;
        flower(t, x + ox, y + oy, r, rot, petal, '#e3b95c', '#7f9c70');
      });
      // мелкий бутон между цветами
      const bx = x + sx * 0.5, by = y + sy * 0.5, br = r * 0.45;
      t.wrap((ox, oy) => {
        if (bx + ox < -2 * br || bx + ox > W + 2 * br || by + oy < -2 * br || by + oy > H + 2 * br) return;
        t.c.fillStyle = shade(petal, 0.2);
        t.c.beginPath();
        t.c.arc(bx + ox, by + oy, br, 0, Math.PI * 2);
        t.c.fill();
        t.c.fillStyle = '#8aa67b';
        t.c.beginPath();
        t.c.ellipse(bx + ox, by + oy + br * 1.4, br * 0.9, br * 0.35, 0.5, 0, Math.PI * 2);
        t.c.fill();
      });
    }
  }
  paper(t, 0.03);
}

/** Обои «ромбик»: двойная диагональная сетка и цветок-крестик в каждом ромбе (голубые). */
function drawRhomb(t: T, o: FinishTexOpts): void {
  const base = o.base ?? '#bdd0dd';
  const acc = o.accent ?? '#6f8eab';
  const { W, H } = t;
  t.fill(base);
  const n = 8, s = W / n; // ромбов по стороне
  const c = t.c;
  for (const off of [-0.06 * s, 0.06 * s]) {
    for (let k = -n; k <= 2 * n; k++) {
      t.line(k * s + off, 0, k * s + off + H, H, rgba(acc, 0.55), 1.2);
      t.line(k * s + off, 0, k * s + off - H, H, rgba(acc, 0.55), 1.2);
    }
  }
  // узлы сетки — точки; центры ромбов — четырёхлепестковые цветки
  for (let p = 0; p <= 2 * n; p++) {
    for (let q = 0; q <= 2 * n; q++) {
      const x = (p * s) / 2, y = (q * s) / 2;
      if ((p + q) % 2 === 0) {
        c.fillStyle = shade(acc, -0.1);
        c.beginPath();
        c.arc(x, y, s * 0.06, 0, Math.PI * 2);
        c.fill();
      } else {
        const r = s * 0.13;
        c.fillStyle = rgba(acc, 0.9);
        for (let a = 0; a < 4; a++) {
          const an = (a * Math.PI) / 2;
          c.beginPath();
          c.ellipse(x + Math.cos(an) * r, y + Math.sin(an) * r, r * 0.75, r * 0.42, an, 0, Math.PI * 2);
          c.fill();
        }
        c.fillStyle = '#f2f5f7';
        c.beginPath();
        c.arc(x, y, r * 0.38, 0, Math.PI * 2);
        c.fill();
      }
    }
  }
  paper(t, 0.03);
}

/** Обои-рогожка: рельефное «плетение» корзинкой, по 2 нити на клетку (серые). */
function drawRogozhka(t: T, o: FinishTexOpts): void {
  const base = o.base ?? '#b3aea2';
  const { W, H } = t;
  t.fill(shade(base, -0.22));
  const n = 48, s = W / n, m = Math.round(H / s), sy = H / m;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      const x = i * s, y = j * sy;
      const k = t.u(-0.06, 0.06);
      const col = shade(base, k);
      if ((i + j) % 2 === 0) {
        for (const f of [0.08, 0.54]) {
          t.rect(x, y + f * sy, s, 0.38 * sy, col);
          t.rect(x, y + f * sy, s, 0.1 * sy, shade(col, 0.15));
        }
      } else {
        for (const f of [0.08, 0.54]) {
          t.rect(x + f * s, y, 0.38 * s, sy, shade(col, -0.03));
          t.rect(x + f * s, y, 0.1 * s, sy, shade(col, 0.12));
        }
      }
    }
  }
  t.modulate(t.fbm(4, 4, 3), 0.05);
}

// ---------------------------------------------------------------- стены

/** Кафель n×n: швы по краям клеток (по половине шва у края картинки — при повторе целый шов). */
function drawTile(t: T, o: FinishTexOpts, floor = false): void {
  const base = o.base ?? '#eef0ea';
  const grout = o.accent ?? '#bfc3bb';
  const n = o.n ?? 4;
  const { W, H } = t;
  t.fill(grout);
  const s = W / n, sy = H / n, g = Math.max(2, s * 0.035);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const col = shade(base, t.u(-0.035, 0.03));
      t.tileRect(i * s + g / 2, j * sy + g / 2, s - g, sy - g, col, Math.max(1, s * 0.025), floor ? 0 : 0.22);
      if (floor) {
        // крапчатый матовый кафель пола
        t.c.save();
        t.c.beginPath();
        t.c.rect(i * s + g / 2, j * sy + g / 2, s - g, sy - g);
        t.c.clip();
        for (let k = 0; k < 40; k++) {
          t.c.fillStyle = rgba(t.r() < 0.5 ? shade(base, -0.3) : shade(base, 0.25), 0.55);
          t.c.beginPath();
          t.c.arc(i * s + t.u(0, s), j * sy + t.u(0, sy), t.u(0.6, 1.6), 0, Math.PI * 2);
          t.c.fill();
        }
        t.c.restore();
      }
    }
  }
  t.modulate(t.fbm(3, 3, 2), floor ? 0.06 : 0.03);
}

/**
 * Кафельная панель стены (коридоры общаги): плитка 15×15 рядами снизу вверх — нижний ряд low (тёмно-зелёный), выше
 * ряды плитки base (три оттенка вразнобой, 3–5% со сколами), сверху — бордюр high в полплитки; подтёки ржавчины.
 * Картинка — на всю высоту панели (tileH отделки = высота dado: низ картинки у пола), по X — n плиток с повтором; по Y
 * не повторяется (рисуется без сдвигов ±H).
 */
function drawTilePanel(t: T, o: FinishTexOpts): void {
  const base = o.base ?? '#d9c7a0';
  const grout = o.accent ?? '#8e8a7c';
  const low = o.low ?? '#5e8a6e';
  const high = o.high ?? '#7fa37a';
  const n = o.n ?? 4;
  const { W, H } = t;
  const s = W / n, g = Math.max(2, s * 0.035), bev = Math.max(1, s * 0.025);
  // оттенки бежевой плитки: основной и два партии (темнее, светлее)
  const tones = [base, base, mix(base, '#b39a68', 0.45), mix(base, '#f4ead2', 0.5)];
  t.fill(grout);
  const rows = Math.max(1, Math.floor((H - s / 2) / s + 1e-6));
  let y = H;
  for (let r = 0; r < rows; r++) {
    y -= s;
    for (let i = 0; i < n; i++) {
      const col = shade(r === 0 ? low : tones[Math.floor(t.r() * tones.length)], t.u(-0.03, 0.03));
      t.tileRect(i * s + g / 2, y + g / 2, s - g, s - g, col, bev, 0.22);
      // скол угла: плитка отбита до цементной подложки
      if (r > 0 && t.r() < 0.04) {
        const cx = i * s + g / 2 + (t.r() < 0.5 ? 0 : s - g), cy = y + g / 2 + (t.r() < 0.5 ? 0 : s - g);
        const dx = (cx > i * s + s / 2 ? -1 : 1) * t.u(0.18, 0.4) * s, dy = (cy > y + s / 2 ? -1 : 1) * t.u(0.15, 0.35) * s;
        t.c.fillStyle = '#b7ae9a';
        t.c.beginPath();
        t.c.moveTo(cx, cy);
        t.c.lineTo(cx + dx, cy);
        t.c.lineTo(cx + dx * 0.45, cy + dy * 0.55);
        t.c.lineTo(cx, cy + dy);
        t.c.closePath();
        t.c.fill();
      }
    }
  }
  // бордюр — оставшаяся полоса сверху (полплитки)
  if (y > g) for (let i = 0; i < n; i++) t.tileRect(i * s + g / 2, g / 2, s - g, y - g, shade(high, t.u(-0.03, 0.03)), bev, 0.25);
  // подтёки ржавчины от швов вниз (по X — с повтором через край)
  for (let k = 0; k < 3; k++) {
    const x = t.u(0, W), y0 = t.u(H * 0.1, H * 0.5), len = t.u(H * 0.15, H * 0.4), w = t.u(1.5, 3.5);
    for (const ox of [-W, 0, W]) {
      if (x + ox < -w || x + ox > W + w) continue;
      const gr = t.c.createLinearGradient(0, y0, 0, y0 + len);
      gr.addColorStop(0, 'rgba(138,90,42,0.35)');
      gr.addColorStop(1, 'rgba(138,90,42,0)');
      t.c.fillStyle = gr;
      t.c.fillRect(x + ox - w / 2, y0, w, len);
    }
  }
  t.modulate(t.fbm(3, 3, 2), 0.03);
}

/** Масляная краска: ровный цвет, следы кисти (вертикальные), лёгкие пятна. */
function drawPaint(t: T, o: FinishTexOpts): void {
  t.fill(o.base ?? '#5a8463');
  t.modulate(t.noise(64, 4), 0.03); // мазки кисти
  t.modulate(t.fbm(3, 3, 3), 0.06);
  t.specks(40, ['#2b2b2b'], 0.5, 1.2, 0.2);
}

/** Побелка: неровный белый, мазки кисти, крапины. */
function drawWhitewash(t: T, o: FinishTexOpts): void {
  t.fill(o.base ?? '#e7e4d9');
  t.modulate(t.fbm(3, 3, 4), 0.05);
  t.modulate(t.noise(48, 6), 0.015);
  t.modulate(t.fbm(2, 2, 3), 0.15, '#d3cbb6'); // желтоватые разводы
  t.specks(70, ['#8d877a', '#b3ab98'], 0.5, 1.4, 0.35);
}

/** Затирка дугами (штукатурка). */
function trowel(t: T, count: number, rMin: number, rMax: number): void {
  const c = t.c;
  for (let i = 0; i < count; i++) {
    const x = t.u(0, t.W), y = t.u(0, t.H), r = t.u(rMin, rMax);
    const a0 = t.u(0, Math.PI * 2), a1 = a0 + t.u(0.6, 1.6);
    const light = t.r() < 0.5;
    const w = t.u(r * 0.15, r * 0.35);
    t.wrap((ox, oy) => {
      if (x + ox < -2 * r || x + ox > t.W + 2 * r || y + oy < -2 * r || y + oy > t.H + 2 * r) return;
      c.strokeStyle = light ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.035)';
      c.lineWidth = w;
      c.beginPath();
      c.arc(x + ox, y + oy, r, a0, a1);
      c.stroke();
    });
  }
}

function drawPlaster(t: T, o: FinishTexOpts): void {
  t.fill(o.base ?? '#a7a296');
  t.modulate(t.fbm(3, 3, 4), 0.1);
  trowel(t, 40, t.W * 0.05, t.W * 0.16);
  t.specks(160, ['#6f6b62', '#d2cec4'], 0.5, 1.3, 0.45);
}

/** Бетон: облака, поры, у пола — трещины. */
function drawConcrete(t: T, o: FinishTexOpts): void {
  const base = o.base ?? '#8e8b84';
  t.fill(base);
  t.modulate(t.fbm(3, 3, 5), 0.12);
  t.modulate(t.fbm(2, 2, 2), 0.3, shade(base, -0.25)); // тёмные пятна
  t.specks(260, ['#4f4c47'], 0.6, 2.2, 0.4);
  t.specks(90, ['#c4c0b7'], 0.5, 1.2, 0.35);
  if (o.cracks) {
    const c = t.c;
    for (let k = 0; k < 2; k++) {
      const pts: [number, number][] = [[t.u(0, t.W), t.u(0, t.H)]];
      let a = t.u(0, Math.PI * 2);
      for (let i = 0; i < 9; i++) {
        a += t.u(-0.7, 0.7);
        const [px, py] = pts[pts.length - 1];
        pts.push([px + Math.cos(a) * t.W * 0.04, py + Math.sin(a) * t.H * 0.04]);
      }
      t.wrap((ox, oy) => {
        c.strokeStyle = 'rgba(40,38,35,0.3)';
        c.lineWidth = 1;
        c.beginPath();
        pts.forEach(([x, y], i) => (i ? c.lineTo(x + ox, y + oy) : c.moveTo(x + ox, y + oy)));
        c.stroke();
      });
    }
  }
}

/** Кирпич: 2 кирпича × 8 рядов, перевязка в полкирпича; шов 10 мм. */
function drawBrick(t: T, o: FinishTexOpts): void {
  const mortar = o.accent ?? '#b2a999';
  const pal = [o.base ?? '#9a4a33', '#a85a3c', '#8c4430', '#b0623f', '#93503a', '#7f3f2c'];
  const { W, H } = t;
  t.fill(mortar);
  t.modulate(t.fbm(6, 6, 2), 0.08);
  const rows = 8, bw = W / 2, bh = H / rows, j = bh * (10 / 75); // шов: 10 из 75 мм ряда
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < 2; i++) {
      const x = i * bw + (r % 2) * (bw / 2) + j / 2, y = r * bh + j / 2;
      const col = shade(pal[Math.floor(t.r() * pal.length)], t.u(-0.06, 0.06));
      const dots = Array.from({ length: 10 }, () => [t.u(0.05, 0.95), t.u(0.1, 0.9), t.u(0.6, 1.6)] as const);
      t.wrap((ox, oy) => {
        if (x + ox > W || x + ox + bw < 0 || y + oy > H || y + oy + bh < 0) return;
        t.tileRect(x + ox, y + oy, bw - j, bh - j, col, 1.5, 0);
        t.c.fillStyle = rgba(shade(col, -0.35), 0.5);
        for (const [dx, dy, rr] of dots) {
          t.c.beginPath();
          t.c.arc(x + ox + dx * (bw - j), y + oy + dy * (bh - j), rr, 0, Math.PI * 2);
          t.c.fill();
        }
      });
    }
  }
  t.modulate(t.fbm(3, 3, 3), 0.08);
}

/** Панели ДВП «под дерево»: вертикальные «доски» с канавками, волокна — периодические синусоиды. */
function drawDvp(t: T, o: FinishTexOpts): void {
  const base = o.base ?? '#8a5a35';
  const { W, H } = t;
  const n = 4, s = W / n;
  const c = t.c;
  for (let i = 0; i < n; i++) {
    const col = shade(base, t.u(-0.07, 0.07));
    t.rect(i * s, 0, s, H, col);
    for (let k = 0; k < 9; k++) {
      const x0 = i * s + t.u(0.08, 0.92) * s;
      const amp = t.u(1, s * 0.06), f = 1 + Math.floor(t.u(0, 3)), ph = t.u(0, Math.PI * 2);
      c.strokeStyle = rgba(shade(col, -0.3), t.u(0.18, 0.35));
      c.lineWidth = t.u(0.8, 2.2);
      c.beginPath();
      for (let y = 0; y <= H; y += 4) {
        const x = x0 + amp * Math.sin((y / H) * Math.PI * 2 * f + ph);
        if (y) c.lineTo(x, y);
        else c.moveTo(x, y);
      }
      c.stroke();
    }
    // канавка между панелями: тёмная линия и светлая кромка (у края картинки — половина, при повторе целая)
    t.rect(i * s, 0, 1.5, H, '#3d2614');
    t.rect(i * s + 1.5, 0, 1, H, shade(col, 0.18));
    t.rect((i + 1) * s - 1, 0, 1, H, '#3d2614');
  }
  t.modulate(t.noise(64, 2), 0.03);
  t.modulate(t.fbm(2, 3, 2), 0.04);
}

// ---------------------------------------------------------------- полы

/** Волокна древесины вдоль планки (в её локальных координатах). */
function grain(t: T, x: number, y: number, w: number, h: number, col: string, along: 'x' | 'y', lines: number, seed: () => number, wholeWaves = false): void {
  const c = t.c;
  c.save();
  c.beginPath();
  c.rect(x, y, w, h);
  c.clip();
  const L = along === 'x' ? w : h, S = along === 'x' ? h : w;
  for (let k = 0; k < lines; k++) {
    // wholeWaves — целое число волн на длину (планка во всю картинку должна сойтись с собой через край)
    const p = seed() * S, amp = seed() * S * 0.12, f0 = 0.5 + seed() * 1.5, ph = seed() * 6.28;
    const f = wholeWaves ? Math.max(1, Math.round(f0)) : f0;
    c.strokeStyle = rgba(shade(col, -0.28), 0.18 + seed() * 0.2);
    c.lineWidth = 0.7 + seed();
    c.beginPath();
    for (let q = 0; q <= L; q += 3) {
      const v = p + amp * Math.sin((q / L) * Math.PI * 2 * f + ph);
      const [px, py] = along === 'x' ? [x + q, y + v] : [x + v, y + q];
      if (q) c.lineTo(px, py);
      else c.moveTo(px, py);
    }
    c.stroke();
  }
  c.restore();
}

/** Линолеум «под паркет»: квадраты-«шашки» по 4 планки, направление чередуется. */
function drawLinoParquet(t: T, o: FinishTexOpts): void {
  const pal = [o.base ?? '#9b6c40', '#a87b4c', '#8f6138', '#b08350'];
  const { W, H } = t;
  const n = 2, s = W / n, sy = H / n, k = 4;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const horiz = (i + j) % 2 === 0;
      for (let q = 0; q < k; q++) {
        const col = shade(pal[Math.floor(t.r() * pal.length)], t.u(-0.04, 0.04));
        const [x, y, w, h] = horiz ? [i * s, j * sy + (q * sy) / k, s, sy / k] : [i * s + (q * s) / k, j * sy, s / k, sy];
        t.rect(x, y, w, h, col);
        grain(t, x, y, w, h, col, horiz ? 'x' : 'y', 4, t.r);
        t.c.strokeStyle = 'rgba(60,35,18,0.55)';
        t.c.lineWidth = 1;
        t.c.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      }
    }
  }
  t.modulate(t.fbm(3, 3, 3), 0.05);
}

/** Линолеум серый «под мрамор»: мягкие облака и крапины. */
function drawLinoSpeckle(t: T, o: FinishTexOpts): void {
  const base = o.base ?? '#8d908c';
  t.fill(base);
  t.modulate(t.fbm(3, 3, 3), 0.07);
  t.modulate(t.fbm(2, 2, 2), 0.35, shade(base, 0.25));
  t.specks(900, [shade(base, 0.35), shade(base, -0.35)], 0.5, 1.4, 0.5);
}

/**
 * Паркет «ёлочкой»: планки 1×5 в единицах ширины, решётка повтора (1,1) и (5,−5);
 * прямоугольный период — 10×10 единиц (картинка). Случайность планки — по её положению по модулю периода.
 */
function drawHerringbone(t: T, o: FinishTexOpts): void {
  const pal = [o.base ?? '#b0834d', '#a57745', '#bc8e57', '#9c6f3f', '#b88a50'];
  const { W, H } = t;
  const n = 5, P = 2 * n, u = W / P, v = H / P;
  const mod = (a: number) => ((a % P) + P) % P;
  const plank = (x: number, y: number, w: number, h: number, key: string, along: 'x' | 'y') => {
    if (x * u > W || (x + w) * u < 0 || y * v > H || (y + h) * v < 0) return;
    const r = makeRng(hashStr(key));
    const col = shade(pal[Math.floor(r() * pal.length)], (r() - 0.5) * 0.1);
    const X = x * u, Y = y * v, Wp = w * u, Hp = h * v;
    t.rect(X, Y, Wp, Hp, col);
    grain(t, X, Y, Wp, Hp, col, along, 5, r);
    t.c.strokeStyle = 'rgba(55,32,15,0.7)';
    t.c.lineWidth = 1.2;
    t.c.strokeRect(X + 0.6, Y + 0.6, Wp - 1.2, Hp - 1.2);
    t.rect(X + 1.2, Y + 1.2, Wp - 2.4, 1, rgba(shade(col, 0.3), 0.6));
  };
  for (let m = -3; m <= 3; m++) {
    for (let k = -2 * P; k <= 2 * P; k++) {
      const bx = k + n * m, by = k - n * m;
      plank(bx, by, n, 1, `h${mod(bx)},${mod(by)}`, 'x');
      plank(bx + n, by - (n - 1), 1, n, `v${mod(bx)},${mod(by)}`, 'y');
    }
  }
  t.modulate(t.fbm(3, 3, 3), 0.05);
}

/** Метлахская плитка: восьмиугольники и малые квадраты-«вставки» в углах (подъезд, санузел). */
function drawMetlakh(t: T, o: FinishTexOpts): void {
  const base = o.base ?? '#c9a77a';
  const dot = o.accent ?? '#5b2f23';
  const { W, H } = t;
  const n = o.n ?? 4, s = W / n, sy = H / n, cut = 0.3, g = Math.max(1.5, s * 0.025);
  const c = t.c;
  t.fill('#8a7f70');
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = i * s + g / 2, y = j * sy + g / 2, w = s - g, h = sy - g, cx = cut * w, cy = cut * h;
      const col = shade(base, t.u(-0.06, 0.05));
      c.fillStyle = col;
      c.beginPath();
      c.moveTo(x + cx, y);
      c.lineTo(x + w - cx, y);
      c.lineTo(x + w, y + cy);
      c.lineTo(x + w, y + h - cy);
      c.lineTo(x + w - cx, y + h);
      c.lineTo(x + cx, y + h);
      c.lineTo(x, y + h - cy);
      c.lineTo(x, y + cy);
      c.closePath();
      c.fill();
      c.strokeStyle = rgba(shade(col, 0.25), 0.8);
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(x + 1, y + h - cy);
      c.lineTo(x + 1, y + cy);
      c.lineTo(x + cx, y + 1);
      c.lineTo(x + w - cx, y + 1);
      c.stroke();
    }
  }
  // вставки — ромбы в узлах сетки; узел на краю — тот же, что на противоположном (оттенок по модулю n)
  const tone = Array.from({ length: n * n }, () => t.u(-0.05, 0.05));
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++) {
      const x = i * s, y = j * sy, rx = cut * (s - g) - g * 0.7, ry = cut * (sy - g) - g * 0.7;
      c.fillStyle = shade(dot, tone[(i % n) * n + (j % n)]);
      c.beginPath();
      c.moveTo(x, y - ry);
      c.lineTo(x + rx, y);
      c.lineTo(x, y + ry);
      c.lineTo(x - rx, y);
      c.closePath();
      c.fill();
    }
  }
  t.specks(500, [shade(base, -0.35), shade(base, 0.3)], 0.5, 1.2, 0.35);
  t.modulate(t.fbm(3, 3, 3), 0.08);
}

/** Крашеная доска (сурик): доски вдоль X, торцевые стыки вразбежку, потёртости. */
function drawBoards(t: T, o: FinishTexOpts): void {
  const base = o.base ?? '#8a3e2a';
  const { W, H } = t;
  const n = 4, bh = H / n;
  for (let r = 0; r < n; r++) {
    const col = shade(base, t.u(-0.05, 0.05));
    t.rect(0, r * bh, W, bh, col);
    grain(t, 0, r * bh, W, bh, col, 'x', 5, t.r, true);
    // щель между досками: у края картинки — половина, при повторе целая
    t.rect(0, r * bh, W, 1, '#2e140c');
    t.rect(0, (r + 1) * bh - 1, W, 1, '#3a1a10');
    t.rect(0, r * bh + 1, W, 1, rgba(shade(col, 0.25), 0.6));
    // торцевой стык доски (одна на ряд — длина доски = ширине картинки)
    const jx = ((r * 0.37 + 0.11) % 1) * W;
    t.wrap((ox) => {
      if (jx + ox < -2 || jx + ox > W + 2) return;
      t.rect(jx + ox - 1, r * bh, 2, bh, '#2e140c');
    });
  }
  t.modulate(t.fbm(4, 2, 3), 0.35, '#a87457'); // протёртая краска
  t.modulate(t.fbm(3, 3, 3), 0.06);
}

// ---------------------------------------------------------------- публичный API

const DRAW: Record<FinishTexKind, (t: T, o: FinishTexOpts) => void> = {
  stripe: drawStripe,
  flower: drawFlower,
  rhomb: drawRhomb,
  rogozhka: drawRogozhka,
  tile: (t, o) => drawTile(t, o, false),
  tile_floor: (t, o) => drawTile(t, o, true),
  tile_panel: drawTilePanel,
  paint: drawPaint,
  whitewash: drawWhitewash,
  plaster: drawPlaster,
  concrete: drawConcrete,
  brick: drawBrick,
  dvp: drawDvp,
  lino_parquet: drawLinoParquet,
  lino_speckle: drawLinoSpeckle,
  herringbone: drawHerringbone,
  metlakh: drawMetlakh,
  boards: drawBoards,
};

const cache = new Map<string, string>();

/**
 * Бесшовная текстура отделки W×H px → JPEG data:URI (качество 0.8), или null без document.
 * Пропорции W:H должны совпадать с tileW:tileH отделки.
 */
export function makeFinishTexture(kind: FinishTexKind, W: number, H: number, opts: FinishTexOpts = {}): string | null {
  if (typeof document === 'undefined') return null;
  const key = `${kind}:${W}x${H}:${JSON.stringify(opts)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  DRAW[kind](new T(ctx, W, H, key), opts);
  const url = cv.toDataURL('image/jpeg', 0.8);
  cache.set(key, url);
  return url;
}
