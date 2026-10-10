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
  | 'lino_parquet' | 'lino_speckle' | 'herringbone' | 'metlakh' | 'boards' | 'tile_floor' | 'tile_panel'
  // metro
  | 'marble' | 'granite_floor' | 'tile_plinth' | 'soot' | 'soot_floor'
  // cellar
  | 'soil'
  // sanatorium
  | 'paint_panel' | 'plaster_cracked' | 'veneer' | 'tile_worn' | 'tile_mix' | 'lath_brick' | 'parquet_worn' | 'terrazzo'
  | 'boards_painted';

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

// ---------------------------------------------------------------- метро (metro)

/**
 * Прожилки мрамора: поле v = |sin 2π(m·x/W + p·y/H + amp·(шум − ½))| — периодично по построению (m, p целые, шум на
 * периодической решётке); прожилка — где v мало (ширина width), к цвету col с силой alpha. cells — крупность извивов.
 */
function veins(t: T, col: string, m: number, p: number, amp: number, width: number, alpha: number, cells: number): void {
  const { W, H } = t;
  const n = t.fbm(cells, cells, 4);
  const id = t.c.getImageData(0, 0, W, H);
  const d = id.data;
  const c = hex(col);
  for (let y = 0, q = 0; y < H; y++) {
    for (let x = 0; x < W; x++, q++) {
      const v = Math.abs(Math.sin(2 * Math.PI * ((m * x) / W + (p * y) / H + amp * (n[q] - 0.5))));
      if (v >= width) continue;
      const k = alpha * (1 - v / width) ** 2;
      const i = q * 4;
      for (let ch = 0; ch < 3; ch++) d[i + ch] += (c[ch] - d[i + ch]) * k;
    }
  }
  t.c.putImageData(id, 0, 0);
}

/** Швы плит n × n: тонкая тёмная линия со светлой кромкой (у края картинки — половина, при повторе целый шов). */
function slabJoints(t: T, n: number, dark: string, light: string): void {
  const { W, H } = t;
  const s = W / n, sy = H / n;
  for (let k = 0; k <= n; k++) {
    t.rect(k * s - 1, 0, 2, H, dark);
    t.rect(0, k * sy - 1, W, 2, dark);
    t.rect(k * s + 1, 0, 1, H, light);
    t.rect(0, k * sy + 1, W, 1, light);
  }
}

/**
 * Мрамор метро (стены зала, пилоны; тёмный — вестибюли и эскалаторы): плиты n × n с разницей тона, облака, прожилки
 * accent — крупные диагональные и тонкие волоски поперёк, тонкие швы плит.
 */
function drawMarble(t: T, o: FinishTexOpts): void {
  const base = o.base ?? '#e8e6e0';
  const vein = o.accent ?? '#868b91';
  const n = o.n ?? 2;
  const { W, H } = t;
  const s = W / n, sy = H / n;
  t.fill(base);
  // плиты из разных блоков: тон каждой чуть свой
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) t.rect(i * s, j * sy, s, sy, rgba(t.r() < 0.5 ? '#ffffff' : '#000000', t.u(0, 0.04)));
  t.modulate(t.fbm(3, 3, 4), 0.05);
  t.modulate(t.fbm(2, 2, 3), 0.35, mix(base, vein, 0.25)); // мягкие облака к цвету прожилок
  veins(t, vein, 1, 2, 2.4, 0.09, 0.55, 3);
  veins(t, vein, 2, -1, 3.2, 0.035, 0.45, 4);
  veins(t, mix(vein, base, 0.4), 1, -3, 4.0, 0.02, 0.35, 5);
  t.specks(220, [vein, shade(base, 0.3)], 0.4, 1.1, 0.25);
  slabJoints(t, n, rgba('#000000', 0.22), rgba('#ffffff', 0.18));
}

/** Зерно гранита: крапины тёмные, рыжие, светлые. */
function graniteGrain(t: T, base: string, count: number): void {
  t.specks(count, [shade(base, -0.45), shade(base, -0.25), mix(base, '#7a3a28', 0.5), shade(base, 0.32)], 0.4, 1.5, 0.5);
}

/** Ромб с центром (x, y) и полудиагональю r. */
function diamond(t: T, x: number, y: number, r: number, fill: string): void {
  const c = t.c;
  c.fillStyle = fill;
  c.beginPath();
  c.moveTo(x, y - r);
  c.lineTo(x + r, y);
  c.lineTo(x, y + r);
  c.lineTo(x - r, y);
  c.closePath();
  c.fill();
}

/**
 * Гранитный пол метро: бежевые плиты n × n (повтор картинки — 2 × 2 плиты по 0.6 м), швы — полосы серого гранита, в
 * узлах — ромбы через один: красные с бежевой серединкой и серые с красной (n чётное — узел на краю совпадает с узлом на
 * противоположном краю). Зерно гранита по всему полу, лёгкая неровность тона.
 */
function drawGraniteFloor(t: T, o: FinishTexOpts): void {
  const base = o.base ?? '#c9b89d';
  const red = o.accent ?? '#a23b2f';
  const grey = o.low ?? '#5d6064';
  const n = Math.max(2, Math.round((o.n ?? 2) / 2) * 2);
  const { W, H } = t;
  const s = W / n, sy = H / n;
  t.fill(base);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) t.rect(i * s, j * sy, s, sy, rgba(t.r() < 0.5 ? '#ffffff' : '#000000', t.u(0, 0.05)));
  graniteGrain(t, base, Math.round((W * H) / 90));
  // полосы серого гранита по швам плиток (0.05 м)
  const band = s * (0.05 / 0.6);
  for (let k = 0; k <= n; k++) {
    t.rect(k * s - band / 2, 0, band, H, grey);
    t.rect(0, k * sy - band / 2, W, band, grey);
  }
  // ромбы в узлах
  const r = s * 0.24;
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++) {
      const x = i * s, y = j * sy;
      const even = (i + j) % 2 === 0;
      diamond(t, x, y, r + 2, shade(grey, -0.35));
      diamond(t, x, y, r, even ? red : grey);
      diamond(t, x, y, r * 0.45, even ? base : red);
    }
  }
  // зерно и по полосам, и по ромбам; общая неровность тона
  graniteGrain(t, grey, Math.round((W * H) / 260));
  t.modulate(t.fbm(3, 3, 3), 0.05);
  slabJoints(t, n, rgba('#000000', 0.18), rgba('#ffffff', 0.08));
}

/**
 * Кафельная панель переходов метро: кремовый кафель 15×15 рядами снизу вверх над гранитным цоколем в две плитки высотой
 * (0.3 м: плита на всю ширину картинки, светлая фаска сверху). Картинка — на всю высоту панели (tileH отделки = высота
 * dado, низ картинки у пола), по X — n плиток с повтором; выше панели тот же кафель — ряды сходятся.
 */
function drawTilePlinth(t: T, o: FinishTexOpts): void {
  const base = o.base ?? '#ead9b7';
  const grout = o.accent ?? '#a89e8a';
  const plinth = o.low ?? '#45413e';
  const n = o.n ?? 4;
  const { W, H } = t;
  const s = W / n, g = Math.max(2, s * 0.035), bev = Math.max(1, s * 0.025);
  const ph = 2 * s;
  t.fill(grout);
  for (let y = H - ph - s; y > -s; y -= s) {
    for (let i = 0; i < n; i++) t.tileRect(i * s + g / 2, y + g / 2, s - g, s - g, shade(base, t.u(-0.035, 0.03)), bev, 0.22);
  }
  // цоколь: тёмный гранит с зерном, фаска сверху, тень под кафелем, шов плиты у края картинки
  t.rect(0, H - ph, W, ph, plinth);
  t.c.save();
  t.c.beginPath();
  t.c.rect(0, H - ph, W, ph);
  t.c.clip();
  graniteGrain(t, plinth, Math.round((W * ph) / 60));
  t.c.restore();
  t.rect(0, H - ph, W, 3, shade(plinth, 0.3));
  t.rect(0, H - ph - 2, W, 2, rgba('#000000', 0.25));
  t.rect(0, H - ph, 1, ph, shade(plinth, -0.4));
  t.rect(W - 1, H - ph, 1, ph, shade(plinth, -0.4));
  t.modulate(t.fbm(3, 3, 2), 0.03);
}

/** Мрамор в копоти (сгоревший зал): белый мрамор, поверх — пятна и потёки копоти accent вверх, хлопья сажи. */
function drawSoot(t: T, o: FinishTexOpts): void {
  const soot = o.accent ?? '#1b1918';
  drawMarble(t, { base: o.base ?? '#d9d6cf', accent: '#868b91', n: o.n ?? 2 });
  t.modulate(t.fbm(2, 2, 4), 1.1, soot);
  t.modulate(t.fbm(4, 4, 3), 0.45, soot);
  // потёки копоти вверх (дым) — с повтором через край
  const c = t.c;
  for (let k = 0; k < 14; k++) {
    const x = t.u(0, t.W), w = t.u(4, 18), y0 = t.u(0, t.H), len = t.u(t.H * 0.3, t.H * 0.9);
    t.wrap((ox, oy) => {
      if (x + ox < -w || x + ox > t.W + w || y0 + oy < 0 || y0 + oy - len > t.H) return;
      const gr = c.createLinearGradient(0, y0 + oy, 0, y0 + oy - len);
      gr.addColorStop(0, rgba(soot, 0.5));
      gr.addColorStop(1, rgba(soot, 0));
      c.fillStyle = gr;
      c.fillRect(x + ox - w / 2, y0 + oy - len, w, len);
    });
  }
  t.specks(500, [soot, '#3a2f28'], 0.6, 2.4, 0.5);
}

/** Гранитный пол в пепле и копоти: тот же узор, сверху тёмные разводы, серый пепел и угольки. */
function drawSootFloor(t: T, o: FinishTexOpts): void {
  const soot = o.accent ?? '#1b1918';
  drawGraniteFloor(t, { base: o.base, accent: '#8e3a2e', low: o.low, n: o.n });
  t.modulate(t.fbm(2, 2, 4), 1.0, soot);
  t.modulate(t.fbm(5, 5, 3), 0.5, '#4a4541');
  t.specks(900, ['#9c968e', '#7d776f'], 0.5, 1.8, 0.45);
  t.specks(400, [soot, '#2b2420'], 0.6, 2.2, 0.6);
}

// ---------------------------------------------------------------- погреб (cellar)

/** Извилистая линия-полилиния с повтором через край: n шагов длиной step, поворот на ±turn за шаг. */
function wander(t: T, x: number, y: number, a: number, n: number, step: number, turn: number): [number, number][] {
  const pts: [number, number][] = [[x, y]];
  for (let i = 0; i < n; i++) {
    a += t.u(-turn, turn);
    const [px, py] = pts[pts.length - 1];
    pts.push([px + Math.cos(a) * step, py + Math.sin(a) * step]);
  }
  return pts;
}

function strokeWrapped(t: T, pts: [number, number][], color: string, width: number): void {
  const c = t.c;
  t.wrap((ox, oy) => {
    c.strokeStyle = color;
    c.lineWidth = width;
    c.beginPath();
    pts.forEach(([x, y], i) => (i ? c.lineTo(x + ox, y + oy) : c.moveTo(x + ox, y + oy)));
    c.stroke();
  });
}

/**
 * Чёрная рыхлая земля погреба: бурая основа (base), комья и впадины (фрактальный шум), мелкие крошки — тёмные и с
 * бликом; редкие полосы глины (accent) и тонкие бледные корешки (low) с отростками. cracks — утоптанный пол: комья
 * ниже, корешков меньше, пыль.
 */
function drawSoil(t: T, o: FinishTexOpts): void {
  const base = o.base ?? '#2a2119';
  const clay = o.accent ?? '#6e4a2c';
  const root = o.low ?? '#a39072';
  const floor = !!o.cracks;
  const { W, H } = t;
  t.fill(base);
  t.modulate(t.fbm(3, 3, 5), floor ? 0.16 : 0.24);
  t.modulate(t.fbm(4, 4, 3), floor ? 0.3 : 0.45, shade(base, -0.55)); // тёмные впадины
  // глина: 1–2 размытые полосы вдоль пласта
  for (let k = 0; k < (floor ? 1 : 2); k++) {
    const pts = wander(t, t.u(0, W), t.u(0, H), t.u(-0.4, 0.4) + (t.r() < 0.5 ? 0 : Math.PI), 14, W * 0.035, 0.35);
    strokeWrapped(t, pts, rgba(clay, 0.16), t.u(W * 0.025, W * 0.05));
    strokeWrapped(t, pts, rgba(clay, 0.28), t.u(W * 0.006, W * 0.012));
  }
  // крошки: тени и сколы с бликом
  const area = W * H;
  t.specks(Math.round(area / 45), ['#120e0a', '#18130e', '#0e0b08'], 0.6, 2.3, 0.7);
  t.specks(Math.round(area / 140), [shade(base, 0.22), shade(base, 0.35)], 0.5, 1.5, 0.55);
  t.specks(Math.round(area / 2600), [clay], 0.8, 1.8, 0.6);
  if (floor) t.specks(Math.round(area / 90), ['#4a4036', '#3d342b'], 0.4, 1.2, 0.3); // пыль
  // корешки: бледные, тонкие, с отростками
  for (let k = 0; k < (floor ? 1 : 4); k++) {
    const pts = wander(t, t.u(0, W), t.u(0, H), t.u(0, Math.PI * 2), Math.round(t.u(10, 22)), W * 0.025, 0.5);
    strokeWrapped(t, pts, rgba('#000000', 0.35), 2.2);
    strokeWrapped(t, pts, rgba(root, 0.7), t.u(0.9, 1.5));
    for (let j = 2; j < pts.length - 2; j += 4) {
      if (t.r() < 0.5) continue;
      const side = wander(t, pts[j][0], pts[j][1], t.u(0, Math.PI * 2), Math.round(t.u(3, 6)), W * 0.015, 0.7);
      strokeWrapped(t, side, rgba(root, 0.5), 0.7);
    }
  }
  t.modulate(t.fbm(6, 6, 2), 0.06);
}

// ---------------------------------------------------------------- санаторий (sanatorium)

/** Сглаженная ступенька: 0 до a, 1 после b. */
function smoothstep(a: number, b: number, x: number): number {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
}

/** Пятна: к цвету col с силой alpha там, где шум n выше порога (мягкий край lo..hi). */
function blotch(t: T, n: Float32Array, lo: number, hi: number, col: string, alpha: number): void {
  const id = t.c.getImageData(0, 0, t.W, t.H);
  const d = id.data;
  const c = hex(col);
  for (let p = 0, i = 0; p < n.length; p++, i += 4) {
    const k = alpha * smoothstep(lo, hi, n[p]);
    if (k <= 0) continue;
    for (let ch = 0; ch < 3; ch++) d[i + ch] += (c[ch] - d[i + ch]) * k;
  }
  t.c.putImageData(id, 0, 0);
}

/** Неровный многоугольник (скол, крошка, клякса) вокруг нуля: nv вершин, радиус r·(0.6…1.15), по Y сжат в squash. */
function chipPoly(t: T, r: number, nv: number, squash = 1): [number, number][] {
  const a0 = t.u(0, Math.PI * 2);
  return Array.from({ length: nv }, (_, k) => {
    const a = a0 + (k / nv) * Math.PI * 2 + t.u(-0.35, 0.35), rr = r * t.u(0.6, 1.15);
    return [Math.cos(a) * rr, Math.sin(a) * rr * squash] as [number, number];
  });
}

function fillPoly(t: T, x: number, y: number, pts: [number, number][], fill: string): void {
  const c = t.c;
  c.fillStyle = fill;
  c.beginPath();
  pts.forEach(([px, py], i) => (i ? c.lineTo(x + px, y + py) : c.moveTo(x + px, y + py)));
  c.closePath();
  c.fill();
}

/** Подтёк сверху вниз: полоса ширины w, к низу сужается и бледнеет; повтор через край по X (wrapY — и по Y). */
function drip(t: T, x: number, y0: number, len: number, w: number, col: string, a: number, wrapY: boolean): void {
  const c = t.c;
  const draw = (ox: number, oy: number) => {
    const X = x + ox, Y = y0 + oy;
    if (X < -w || X > t.W + w || Y > t.H || Y + len < 0) return;
    const gr = c.createLinearGradient(0, Y, 0, Y + len);
    gr.addColorStop(0, rgba(col, a));
    gr.addColorStop(0.2, rgba(col, a * 0.75));
    gr.addColorStop(1, rgba(col, 0));
    c.fillStyle = gr;
    c.beginPath();
    c.moveTo(X - w / 2, Y);
    c.lineTo(X + w / 2, Y);
    c.lineTo(X + w * 0.12, Y + len);
    c.lineTo(X - w * 0.12, Y + len);
    c.closePath();
    c.fill();
  };
  if (wrapY) t.wrap(draw);
  else for (const ox of [-t.W, 0, t.W]) draw(ox, 0);
}

/**
 * Масляная панель стены до dado (коридоры и кабинеты санатория, реф. 3): краска base с горизонтальными мазками кисти и
 * выгоревшими разводами; сверху — бордюр accent (~2 см) с тенью и светлой отбивкой, снизу — деревянный плинтус low
 * (~7 см) с тенью над ним; у пола — серые следы обуви и швабры, краска сбита до светлого грунта, выше — редкие сколы и
 * царапины. Картинка — на всю высоту панели (tileH отделки = высота dado, низ картинки у пола), повтор только по X.
 */
function drawPaintPanel(t: T, o: FinishTexOpts): void {
  const base = o.base ?? '#5f9e94';
  const border = o.accent ?? shade(base, -0.4);
  const plinth = o.low ?? '#4d3a2c';
  const { W, H } = t;
  const c = t.c;
  const bh = Math.max(3, Math.round(H * 0.017)), ph = Math.round(H * 0.06), py = H - ph;
  t.fill(base);
  t.modulate(t.noise(4, 120), 0.022); // мазки кисти
  t.modulate(t.fbm(3, 3, 3), 0.045);
  t.modulate(t.fbm(2, 2, 3), 0.2, shade(base, 0.16)); // выгоревшие разводы
  // следы обуви и швабры у пола — вытянутые серые пятна
  for (let k = 0; k < 26; k++) {
    const x = t.u(0, W), y = py - t.u(2, H * 0.22), rx = t.u(6, 30), ry = t.u(1.5, 5), a = t.u(0.05, 0.16), rot = t.u(-0.15, 0.15);
    for (const ox of [-W, 0, W]) {
      if (x + ox < -rx || x + ox > W + rx) continue;
      c.fillStyle = rgba('#2c2a26', a);
      c.beginPath();
      c.ellipse(x + ox, y, rx, ry, rot, 0, Math.PI * 2);
      c.fill();
    }
  }
  // сколы до грунта (чаще внизу): тёмная кромка слоя краски, светлый грунт
  for (let k = 0; k < 9; k++) {
    const low = k < 5;
    const x = t.u(0, W), y = low ? py - t.u(6, H * 0.25) : t.u(bh + 6, py - 6);
    const r = low ? t.u(2, 6) : t.u(1.2, 3.5);
    const pts = chipPoly(t, r, 6 + Math.floor(t.r() * 3), t.u(0.5, 0.9));
    const primer = mix('#c4c2b6', base, t.u(0, 0.35));
    for (const ox of [-W, 0, W]) {
      if (x + ox < -2 * r || x + ox > W + 2 * r) continue;
      fillPoly(t, x + ox + 0.8, y + 0.8, pts, rgba('#1d2a27', 0.3));
      fillPoly(t, x + ox, y, pts, primer);
    }
  }
  // царапины
  for (let k = 0; k < 14; k++) {
    const x = t.u(0, W), y = t.u(H * 0.3, py - 4), len = t.u(8, 40), a = t.u(-0.3, 0.3);
    const dx = Math.cos(a) * len, dy = Math.sin(a) * len;
    for (const ox of [-W, 0, W]) t.line(x + ox, y, x + ox + dx, y + dy, rgba('#e6e2d4', 0.25), 0.8);
  }
  // бордюр с тенью и отбивкой
  t.rect(0, 0, W, bh, border);
  t.rect(0, 0, W, 1, rgba(shade(border, 0.3), 0.7));
  t.rect(0, bh, W, 1, rgba('#000000', 0.25));
  t.rect(0, bh + 1, W, 1, rgba(shade(base, 0.35), 0.6));
  // плинтус: тень на стене, доска с волокнами, скруглённая кромка
  const gr = c.createLinearGradient(0, py - 6, 0, py);
  gr.addColorStop(0, 'rgba(0,0,0,0)');
  gr.addColorStop(1, 'rgba(0,0,0,0.22)');
  c.fillStyle = gr;
  c.fillRect(0, py - 6, W, 6);
  t.rect(0, py, W, ph, plinth);
  grain(t, 0, py, W, ph, plinth, 'x', 4, t.r, true);
  t.rect(0, py, W, 2, shade(plinth, 0.3));
  t.rect(0, py + 2, W, 1, shade(plinth, 0.12));
  t.rect(0, H - 2, W, 2, shade(plinth, -0.35));
  t.modulate(t.fbm(4, 4, 2), 0.025);
}

/** Белая штукатурка (палаты, вестибюль, столовая): неровная затирка, желтоватые пятна, потёки сверху, волосяные трещины. */
function drawPlasterCracked(t: T, o: FinishTexOpts): void {
  const base = o.base ?? '#e6e3da';
  const { W, H } = t;
  t.fill(base);
  t.modulate(t.fbm(3, 3, 4), 0.05);
  t.modulate(t.fbm(8, 8, 2), 0.02); // мелкая неровность затирки
  t.modulate(t.fbm(2, 2, 3), 0.22, '#cfc6b0'); // желтоватые пятна
  for (let k = 0; k < 7; k++) drip(t, t.u(0, W), t.u(0, H), t.u(H * 0.15, H * 0.5), t.u(3, 14), t.r() < 0.6 ? '#b3a88f' : '#9c9a92', t.u(0.1, 0.22), true);
  // трещины: тёмная линия, светлая кромка снизу-справа, ответвления
  for (let k = 0; k < 3; k++) {
    const pts = wander(t, t.u(0, W), t.u(0, H), t.u(0, Math.PI * 2), Math.round(t.u(10, 24)), W * 0.022, 0.3);
    strokeWrapped(t, pts.map(([x, y]) => [x + 1, y + 1] as [number, number]), rgba('#ffffff', 0.35), 1);
    strokeWrapped(t, pts, rgba('#5a5448', 0.55), t.u(0.7, 1.1));
    for (let j = 3; j < pts.length - 2; j += 3) {
      if (t.r() < 0.55) continue;
      const side = wander(t, pts[j][0], pts[j][1], t.u(0, Math.PI * 2), Math.round(t.u(3, 8)), W * 0.012, 0.7);
      strokeWrapped(t, side, rgba('#5a5448', 0.4), 0.6);
    }
  }
  t.specks(120, ['#8f897c', '#c9c3b5'], 0.4, 1.2, 0.3);
}

/**
 * Светлый шпон панелями (водолечебница, реф. 1): n вертикальных панелей на картинку, у каждой свой тон и «соборный»
 * рисунок тангенциального распила — годовые кольца как линии уровня F = m·y/H − A·u² + шум (u — от оси панели, ось не
 * по центру; m целое и шум периодичный — по Y повтор сходится), к концу кольца поздняя древесина accent темнее; поверх —
 * тонкие продольные волокна, пятна потемневшего лака; швы панелей — тёмная щель и светлая фаска (у края — половина).
 */
function drawVeneer(t: T, o: FinishTexOpts): void {
  const base = o.base ?? '#c6a36a';
  const late = hex(o.accent ?? shade(base, -0.32));
  const n = o.n ?? 2;
  const { W, H } = t;
  const pw = W / n;
  const warp = t.fbm(3, 4, 3), fine = t.fbm(6, 8, 2), fib = t.noise(Math.max(8, Math.round(W / 4)), 4);
  const id = t.c.getImageData(0, 0, W, H);
  const d = id.data;
  for (let i = 0; i < n; i++) {
    const tone = hex(shade(base, t.u(-0.08, 0.06)));
    const cx = (i + 0.5 + t.u(-0.15, 0.15)) * pw;
    const A = t.u(5, 9), m = Math.round(t.u(16, 24)), ph = t.u(0, 1), amp = t.u(1, 1.8);
    // у каждого кольца свой контраст и ширина поздней древесины (по номеру кольца mod m — по Y сходится)
    const ringK = Array.from({ length: m }, () => t.u(0.25, 1)), ringW = Array.from({ length: m }, () => t.u(0.2, 0.5));
    const x0 = Math.round(i * pw), x1 = Math.round((i + 1) * pw);
    for (let y = 0; y < H; y++) {
      for (let x = x0; x < x1; x++) {
        const q = y * W + x;
        const u = (x + 0.5 - cx) / (pw * 0.5);
        const F = (m * y) / H - A * u * u + amp * 2 * (warp[q] - 0.5) + 0.35 * (fine[q] - 0.5) + ph;
        const fl = Math.floor(F), v = F - fl, r = ((fl % m) + m) % m;
        const v2 = 4 * F - Math.floor(4 * F); // тонкие кольца между крупными
        const ring = 0.55 * ringK[r] * smoothstep(1 - ringW[r], 1, v) + 0.12 * smoothstep(0.7, 1, v2);
        const f = 1 + 0.07 * (2 * fib[q] - 1);
        const p = q * 4;
        for (let ch = 0; ch < 3; ch++) d[p + ch] = (tone[ch] + (late[ch] - tone[ch]) * ring) * f;
        d[p + 3] = 255;
      }
    }
  }
  t.c.putImageData(id, 0, 0);
  t.modulate(t.fbm(2, 3, 3), 0.22, shade(base, -0.18)); // потемневший лак пятнами
  t.modulate(t.fbm(3, 3, 2), 0.035);
  for (let i = 0; i <= n; i++) {
    const x = i * pw;
    t.rect(x - 2.5, 0, 1, H, rgba('#000000', 0.15));
    t.rect(x - 1.5, 0, 3, H, '#3b2a18');
    t.rect(x + 1.5, 0, 1, H, rgba(shade(base, 0.35), 0.7));
  }
}

/**
 * Белый кафель санатория (душ, грязелечебница; реф. 1): n × n плиток, тона партий чуть голубее и теплее, грязь в
 * затирке, сколы углов до цементной подложки, редкие трещины через плитку, ржавые подтёки с струйками (повтор и по Y).
 */
function drawTileWorn(t: T, o: FinishTexOpts): void {
  const base = o.base ?? '#e9edee';
  const grout = o.accent ?? '#a2aaaa';
  const n = o.n ?? 8;
  const { W, H } = t;
  const c = t.c;
  t.fill(grout);
  t.modulate(t.fbm(4, 4, 3), 0.5, shade(grout, -0.4)); // грязь в швах
  const s = W / n, sy = H / n, g = Math.max(2, s * 0.05), bev = Math.max(1, s * 0.03);
  const tones = [base, base, base, base, mix(base, '#dde5e6', 0.5), mix(base, '#f2efe6', 0.5)];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = i * s + g / 2, y = j * sy + g / 2, w = s - g, h = sy - g;
      t.tileRect(x, y, w, h, shade(tones[Math.floor(t.r() * tones.length)], t.u(-0.025, 0.015)), bev, 0.2);
      if (t.r() < 0.04) {
        const right = t.r() < 0.5, bottom = t.r() < 0.5;
        const cx = right ? x + w : x, cy = bottom ? y + h : y;
        const dx = (right ? -1 : 1) * t.u(0.12, 0.3) * w, dy = (bottom ? -1 : 1) * t.u(0.12, 0.28) * h;
        c.fillStyle = '#b3ab9a';
        c.beginPath();
        c.moveTo(cx, cy);
        c.lineTo(cx + dx, cy);
        c.lineTo(cx + dx * 0.4, cy + dy * 0.5);
        c.lineTo(cx, cy + dy);
        c.closePath();
        c.fill();
        c.strokeStyle = rgba('#5c564a', 0.5);
        c.lineWidth = 0.8;
        c.beginPath();
        c.moveTo(cx + dx, cy);
        c.lineTo(cx + dx * 0.4, cy + dy * 0.5);
        c.lineTo(cx, cy + dy);
        c.stroke();
      }
      if (t.r() < 0.05) {
        const pts: [number, number][] = [0, t.u(0.25, 0.5), t.u(0.5, 0.8), 1].map((k) => [x + t.u(0.1, 0.9) * w, y + k * h]);
        c.strokeStyle = rgba('#4d4b45', 0.55);
        c.lineWidth = 0.9;
        c.beginPath();
        pts.forEach(([px, py], q) => (q ? c.lineTo(px, py) : c.moveTo(px, py)));
        c.stroke();
      }
    }
  }
  for (let k = 0; k < 6; k++) {
    const x = t.u(0, W), y0 = t.u(0, H), len = t.u(H * 0.15, H * 0.55), w = t.u(3, 12);
    drip(t, x, y0, len, w, k % 3 ? '#9a6430' : '#7d4f2a', t.u(0.18, 0.35), true);
    drip(t, x + t.u(-w * 0.3, w * 0.3), y0, len * t.u(1, 1.3), Math.max(1.2, w * 0.25), '#8a4f22', t.u(0.25, 0.4), true);
  }
  t.modulate(t.fbm(3, 3, 2), 0.035);
  t.modulate(t.fbm(2, 2, 3), 0.18, '#c9c2ae'); // желтоватый налёт
}

/**
 * Кафель «партиями» (бассейн, реф. 2): n плиток по ширине, тон каждой — из партий base (светлее, темнее, бирюзовее,
 * почти белая), затирка accent светлая. Пол (без low/high): квадратная сетка, матовый блеск, известковые разводы.
 * Панель (задан high или low): ряды снизу вверх, как у tile_panel, — нижний ряд low, оставшаяся полоса сверху — бордюр
 * high, тон ровнее; картинка — на всю высоту панели.
 */
function drawTileMix(t: T, o: FinishTexOpts): void {
  const base = o.base ?? '#a8d0d8';
  const grout = o.accent ?? '#e2ebe9';
  const n = o.n ?? 6;
  const panel = !!(o.low || o.high);
  const { W, H } = t;
  const s = W / n, g = Math.max(2, s * 0.06), bev = Math.max(1, s * 0.03);
  const tones = panel
    ? [base, base, base, shade(base, 0.07), shade(base, -0.05)]
    : [base, base, base, shade(base, 0.12), shade(base, -0.06), mix(base, '#5fa9bd', 0.25), mix(base, '#ffffff', 0.35), mix(base, '#9fb8b0', 0.25)];
  const pick = () => shade(tones[Math.floor(t.r() * tones.length)], t.u(-0.025, 0.025));
  const tile = (x: number, y: number, w: number, h: number, col: string) => t.tileRect(x + g / 2, y + g / 2, w - g, h - g, col, bev, panel ? 0.24 : 0.1);
  t.fill(grout);
  t.modulate(t.fbm(4, 4, 2), 0.12);
  if (!panel) {
    const sy = H / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) tile(i * s, j * sy, s, sy, pick());
    t.modulate(t.fbm(2, 2, 3), 0.3, '#eef4f2'); // известковые разводы, высохшие лужи
    t.specks(Math.round((W * H) / 300), [shade(base, -0.3), '#ffffff'], 0.4, 1.1, 0.3);
  } else {
    const rows = Math.max(1, Math.floor((H - s / 2) / s + 1e-6));
    let y = H;
    for (let r = 0; r < rows; r++) {
      y -= s;
      for (let i = 0; i < n; i++) tile(i * s, y, s, s, r === 0 && o.low ? shade(o.low, t.u(-0.03, 0.03)) : pick());
    }
    if (y > g) for (let i = 0; i < n; i++) tile(i * s, 0, s, y, shade(o.high ?? shade(base, -0.3), t.u(-0.03, 0.03)));
  }
  t.modulate(t.fbm(3, 3, 2), 0.03);
}

/**
 * Ободранная стена (комната в ремонте, реф. 4) — три слоя, открытые по зонам; картинка — на всю высоту стены (W : H =
 * 1 : R, R целое; для 1.5 × 3.0 м — 1 : 2, низ картинки у пола). Слои: кирпич (модуль 0.25 × 0.075 м — 6 кирпичей по
 * ширине, перевязка в полкирпича, разнотонный, выбоины, рваные мазки раствора и клочки побелки); дранка — вертикальные
 * доски со щелями, поверх две косые решётки реек ±45° (20 шагов по ширине), в ячейках — комки штукатурки; штукатурка —
 * в глубине под побелкой base, у скола серая high (побелка отбита дальше края), с тенью от толщи слоя (свет сверху-
 * слева). Зоны: поверху (выше ~0.73 высоты) штукатурка держится, понизу (~0.08) — рваные остатки, посередине — дранка с
 * пятнами кирпича (двумерный шум), между ними рваная полоса и островки штукатурки. Шум периодичный, решётки кратны
 * картинке — края сходятся (по Y стык — внутри штукатурки). accent — кирпич, low — дерево реек.
 */
function drawLathBrick(t: T, o: FinishTexOpts): void {
  const white = o.base ?? '#e8e5dc';
  const brickCol = o.accent ?? '#a65a42';
  const wood = o.low ?? '#c48b55';
  const plaster = o.high ?? '#b9b2a4';
  const { W, H } = t;
  const R = Math.max(1, Math.round(H / W));
  const c = t.c;
  // ── слой 1: кирпич
  t.fill('#9f988a');
  t.modulate(t.noise(8, 8 * R), 0.12);
  const per = 6, rows = Math.round(per * R * (10 / 3)), bw = W / per, bh = H / rows, j = Math.max(2, bh * (10 / 75));
  const pal = [brickCol, shade(brickCol, 0.12), shade(brickCol, -0.14), mix(brickCol, '#c8825f', 0.5), mix(brickCol, '#6e3b2c', 0.55), mix(brickCol, '#4a302a', 0.6), mix(brickCol, '#b9a08a', 0.35)];
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < per; i++) {
      const x = i * bw + (r % 2) * (bw / 2) + j / 2, y = r * bh + j / 2;
      const col = shade(pal[Math.floor(t.r() * pal.length)], t.u(-0.05, 0.05));
      const pits = Array.from({ length: 14 }, () => [t.u(0.03, 0.97), t.u(0.08, 0.92), t.u(0.5, 2)] as const);
      const chip = t.r() < 0.35 ? { cx: t.u(0, 1), r: t.u(0.15, 0.4) } : null;
      t.wrap((ox, oy) => {
        if (x + ox > W || x + ox + bw < 0 || y + oy > H || y + oy + bh < 0) return;
        t.tileRect(x + ox, y + oy, bw - j, bh - j, col, 1.5, 0);
        c.fillStyle = rgba(shade(col, -0.4), 0.5);
        for (const [dx, dy, rr] of pits) {
          c.beginPath();
          c.arc(x + ox + dx * (bw - j), y + oy + dy * (bh - j), rr, 0, Math.PI * 2);
          c.fill();
        }
        if (chip) {
          // отбитый край — выемка от верхней грани
          c.fillStyle = rgba(shade(col, -0.3), 0.8);
          c.beginPath();
          c.ellipse(x + ox + chip.cx * (bw - j), y + oy, chip.r * bh * 1.6, chip.r * bh, 0, 0, Math.PI);
          c.fill();
        }
      });
    }
  }
  // остатки раствора и побелки — рваные: крупный шум с мелким «зерном», края зернистые, не облака
  const gritty = (a: Float32Array, cells: number, k: number) => {
    const g = t.noise(cells, cells * R);
    for (let i = 0; i < a.length; i++) a[i] = a[i] * (1 - k) + g[i] * k;
    return a;
  };
  blotch(t, gritty(t.fbm(6, 6 * R, 3), 48, 0.35), 0.59, 0.62, '#b4ad9f', 0.6); // серые мазки раствора
  blotch(t, gritty(t.fbm(8, 8 * R, 3), 64, 0.3), 0.675, 0.69, white, 0.85); // клочки побелки
  const brick = c.getImageData(0, 0, W, H);
  // ── слой 2: дранка
  t.fill('#21180f');
  const nb = 10, sb = W / nb, board = mix(wood, '#8a6a4c', 0.3);
  for (let i = 0; i < nb; i++) {
    const col = shade(board, t.u(-0.1, 0.06));
    const x = i * sb + sb * 0.05, w = sb * 0.9;
    t.rect(x, 0, w, H, col);
    grain(t, x, 0, w, H, col, 'y', 6 * R, t.r, true);
  }
  const N = 20, d = W / N;
  // комки штукатурки в ячейках решётки (рейки ложатся поверх): период решётки ячеек — сдвиги (N, N) и (−RN, RN), его
  // основная область — k ∈ [0, N), l ∈ [0, 2RN); центр — по модулю картинки
  for (let k = 0; k < N; k++) {
    for (let l = 0; l < 2 * R * N; l++) {
      if (t.r() > 0.6) continue;
      const cx = ((((k + l + 1) * d) / 2) % W + W) % W, cy = ((((l - k) * d) / 2) % H + H) % H;
      const pts = chipPoly(t, (d / 2) * t.u(0.55, 1.0), 6);
      const col = shade(mix(plaster, white, t.u(0, 0.6)), t.u(-0.12, 0.04));
      t.wrap((ox, oy) => {
        if (cx + ox < -d || cx + ox > W + d || cy + oy < -d || cy + oy > H + d) return;
        fillPoly(t, cx + ox, cy + oy, pts, col);
      });
    }
  }
  // рейки: линии x − dir·y = k·d; цвет по k mod N (сдвиг на W переводит k в k ± N, на H — в k ± RN)
  const sw = d * 0.34;
  const strips = (dir: 1 | -1) => {
    const cols = Array.from({ length: N }, () => shade(wood, t.u(-0.06, 0.05)));
    const hx = (dir * sw * 0.3) / Math.SQRT2, hy = (-sw * 0.3) / Math.SQRT2;
    for (let k = -R * N; k <= (1 + R) * N; k++) {
      const ya = -sw, yb = H + sw, xa = k * d + dir * ya, xb = k * d + dir * yb;
      if (Math.max(xa, xb) < -sw || Math.min(xa, xb) > W + sw) continue;
      const col = cols[((k % N) + N) % N];
      t.line(xa + 2, ya + 2.5, xb + 2, yb + 2.5, rgba('#000000', 0.4), sw);
      t.line(xa, ya, xb, yb, col, sw);
      t.line(xa + hx, ya + hy, xb + hx, yb + hy, rgba(shade(col, 0.3), 0.6), sw * 0.2);
      t.line(xa - hx, ya - hy, xb - hx, yb - hy, rgba(shade(col, -0.3), 0.5), sw * 0.15);
    }
  };
  strips(1);
  strips(-1);
  t.modulate(t.noise(96, 96 * R), 0.05);
  blotch(t, gritty(t.fbm(4, 4 * R, 2), 64, 0.4), 0.56, 0.62, '#cfc9bb', 0.4); // известковая пыль на дранке
  const lath = c.getImageData(0, 0, W, H);
  // ── слой 3: серая штукатурка (побелка поверх — по зонам ниже)
  t.fill(plaster);
  t.modulate(t.fbm(4, 4 * R, 3), 0.1);
  trowel(t, 40 * R, W * 0.03, W * 0.1);
  t.specks(Math.round((W * H) / 160), [shade(plaster, -0.3), shade(plaster, 0.2)], 0.5, 1.4, 0.45);
  const plast = c.getImageData(0, 0, W, H);
  // ── зоны: 0 — побелка, 3 — серая штукатурка у скола, 1 — кирпич, 2 — дранка; мелкий шум jag рвёт края
  const zn = t.fbm(3, 3 * R, 3), zb = t.fbm(2, 2 * R, 3), jag = t.fbm(20, 20 * R, 3), isl = t.fbm(5, 5 * R, 3), yel = t.fbm(2, 2 * R, 2);
  const zone = new Uint8Array(W * H);
  for (let y = 0, q = 0; y < H; y++) {
    const h = 1 - y / H; // доля высоты от пола
    for (let x = 0; x < W; x++, q++) {
      const j2 = jag[q] - 0.5, n2 = zn[q] - 0.5;
      const z = zb[q] - 0.53 + 0.12 * j2; // > 0 — кирпич, < 0 — дранка
      const depth = Math.max(
        (h - 0.73) * 0.8 + 0.25 * n2 + 0.3 * j2, // поверху
        (0.08 - h) * 0.8 - 0.15 * n2 + 0.3 * j2, // понизу
        0.04 - Math.abs(z) + 0.3 * j2, // между кирпичом и дранкой
        isl[q] - 0.7 + 0.3 * j2, // островки
      );
      zone[q] = depth > 0.03 ? 0 : depth > 0 ? 3 : z > 0 ? 1 : 2;
    }
  }
  const P = plast.data, B = brick.data, L = lath.data, wc = hex(white), yc = hex('#d2c7ab');
  const at = (x: number, y: number) => zone[(((y % H) + H) % H) * W + (((x % W) + W) % W)];
  const solid = (z: number) => z === 0 || z === 3;
  for (let y = 0, q = 0; y < H; y++) {
    for (let x = 0; x < W; x++, q++) {
      const zq = zone[q], i = q * 4;
      if (solid(zq)) {
        if (zq === 0) {
          const yk = 0.6 * Math.max(0, 2 * yel[q] - 1); // желтизна побелки
          for (let ch = 0; ch < 3; ch++) {
            const v = P[i + ch] + (wc[ch] - P[i + ch]) * 0.8;
            P[i + ch] = v + (yc[ch] - v) * yk;
          }
        }
        // кромка скола: к свету светлее, снизу-справа темнее; под краем побелки — тень на серой штукатурке
        let k = !solid(at(x - 2, y - 2)) ? 1.14 : !solid(at(x + 1, y + 1)) ? 0.8 : 1;
        if (zq === 3 && at(x - 2, y - 2) === 0) k *= 0.86;
        if (k !== 1) for (let ch = 0; ch < 3; ch++) P[i + ch] = Math.min(255, P[i + ch] * k);
        continue;
      }
      const S = zq === 1 ? B : L;
      let sh = 1; // тень от толщи штукатурки
      for (let st = 1; st <= 5; st++) {
        if (solid(at(x - st, y - st))) {
          sh = 0.55 + 0.09 * (st - 1);
          break;
        }
      }
      for (let ch = 0; ch < 3; ch++) P[i + ch] = S[i + ch] * sh;
    }
  }
  c.putImageData(plast, 0, 0);
  t.specks(Math.round((W * H) / 400), ['#efece4', '#8a8478'], 0.5, 1.6, 0.4); // пыль, крошка
  t.modulate(t.noise(5, 5 * R), 0.05);
}

/**
 * Паркет «ёлочкой» санатория (реф. 3): планки 1 × 5 (решётка повтора (1,1), (5,−5)); картинка — 4n × 4n единиц, два
 * периода узора: случайность планки — по её положению по модулю 4n (разнообразнее, чем у herringbone); тона медового
 * дуба от base, лак вытерт пятнами до серо-бежевого accent, царапины, грязь в стыках.
 */
function drawParquetWorn(t: T, o: FinishTexOpts): void {
  const base = o.base ?? '#b08b5a';
  const worn = o.accent ?? '#c4b496';
  const pal = [base, base, shade(base, 0.05), shade(base, -0.06), mix(base, '#c49a62', 0.3), mix(base, '#9a7548', 0.25), mix(base, worn, 0.25)];
  const { W, H } = t;
  const c = t.c;
  const n = 5, P = 4 * n, u = W / P, v = H / P;
  const mod = (a: number) => ((a % P) + P) % P;
  const plank = (x: number, y: number, w: number, h: number, key: string, along: 'x' | 'y') => {
    if (x * u > W || (x + w) * u < 0 || y * v > H || (y + h) * v < 0) return;
    const r = makeRng(hashStr('san' + key));
    const col = shade(pal[Math.floor(r() * pal.length)], (r() - 0.5) * 0.08);
    const X = x * u, Y = y * v, Wp = w * u, Hp = h * v;
    t.rect(X, Y, Wp, Hp, col);
    grain(t, X, Y, Wp, Hp, col, along, 6, r);
    c.strokeStyle = rgba('#3a2412', 0.5);
    c.lineWidth = 1.3;
    c.strokeRect(X + 0.65, Y + 0.65, Wp - 1.3, Hp - 1.3);
    t.rect(X + 1.3, Y + 1.3, Wp - 2.6, 1, rgba(shade(col, 0.28), 0.5));
  };
  for (let m = -4; m <= 4; m++) {
    for (let k = -2 * P; k <= 2 * P; k++) {
      const bx = k + n * m, by = k - n * m;
      plank(bx, by, n, 1, `h${mod(bx)},${mod(by)}`, 'x');
      plank(bx + n, by - (n - 1), 1, n, `v${mod(bx)},${mod(by)}`, 'y');
    }
  }
  blotch(t, t.fbm(2, 2, 3), 0.5, 0.68, worn, 0.4); // вытертый лак
  t.modulate(t.fbm(5, 5, 2), 0.05);
  for (let k = 0; k < 90; k++) {
    const x = t.u(0, W), y = t.u(0, H), a = t.u(0, Math.PI), len = t.u(6, 26), al = t.u(0.12, 0.28);
    const dx = Math.cos(a) * len, dy = Math.sin(a) * len;
    t.wrap((ox, oy) => {
      if (x + ox < -len || x + ox > W + len || y + oy < -len || y + oy > H + len) return;
      t.line(x + ox, y + oy, x + ox + dx, y + oy + dy, rgba('#efe4cc', al), 0.7);
    });
  }
  t.specks(Math.round((W * H) / 900), ['#3b2a1a'], 0.5, 1.4, 0.35);
}

/**
 * Терраццо (вестибюль): бежево-серая цементная основа base, мраморная крошка — неровные многоугольники (белые, серые,
 * чёрные, рыжие, охристые, розоватые; ~15% крупных), мелкий песок, полировка пятнами; латунные жилы accent по квадратам
 * n × n на картинку (у края — половина жилы, при повторе целая).
 */
function drawTerrazzo(t: T, o: FinishTexOpts): void {
  const base = o.base ?? '#c8beac';
  const brass = o.accent ?? '#b48d3e';
  const n = o.n ?? 1;
  const { W, H } = t;
  t.fill(base);
  t.modulate(t.fbm(4, 4, 3), 0.06);
  const chips = ['#f1eee8', '#f1eee8', '#e3ded3', '#d6cfc2', '#b7b1a7', '#8f8a82', '#66615b', '#34312d', '#9c6044', '#c49a64', '#caa69b', '#a9a39a'];
  const count = Math.round((W * H) / 95);
  for (let i = 0; i < count; i++) {
    const x = t.u(0, W), y = t.u(0, H);
    const r = t.r() < 0.15 ? t.u(4, 9) : t.u(1.2, 3.8);
    const pts = chipPoly(t, r, 4 + Math.floor(t.r() * 4), t.u(0.6, 1));
    const col = shade(chips[Math.floor(t.r() * chips.length)], t.u(-0.06, 0.05));
    t.wrap((ox, oy) => {
      if (x + ox < -2 * r || x + ox > W + 2 * r || y + oy < -2 * r || y + oy > H + 2 * r) return;
      fillPoly(t, x + ox, y + oy, pts, col);
    });
  }
  t.specks(Math.round((W * H) / 70), ['#7d776e', '#e9e4da', '#a29a8c'], 0.3, 0.9, 0.45);
  t.modulate(t.fbm(2, 2, 3), 0.2, shade(base, 0.18)); // полировка пятнами
  t.modulate(t.fbm(3, 3, 3), 0.04);
  const s = W / n, sy = H / n, bw = Math.max(2.5, W * 0.006);
  for (let k = 0; k <= n; k++) {
    t.rect(k * s - bw / 2, 0, bw, H, brass);
    t.rect(0, k * sy - bw / 2, W, bw, brass);
  }
  for (let k = 0; k <= n; k++) {
    t.rect(k * s - bw / 2, 0, 1, H, rgba('#f6dc9a', 0.6));
    t.rect(0, k * sy - bw / 2, W, 1, rgba('#f6dc9a', 0.6));
    t.rect(k * s + bw / 2, 0, 1, H, rgba('#3d2e14', 0.35));
    t.rect(0, k * sy + bw / 2, W, 1, rgba('#3d2e14', 0.35));
  }
}

/**
 * Жёлтые крашеные доски (комната в ремонте, реф. 4): n досок вдоль X на картинку, по одному торцевому стыку в ряду;
 * охра base поверх дерева accent — краска вытерта до дерева полосами вдоль досок и у щелей (у каждой доски своя
 * степень), белые кляксы шпаклёвки и побелки high, известковая пыль.
 */
function drawBoardsPainted(t: T, o: FinishTexOpts): void {
  const paint = o.base ?? '#c99a2e';
  const wood = o.accent ?? '#c99b6b';
  const putty = o.high ?? '#e7e2d5';
  const n = o.n ?? 5;
  const { W, H } = t;
  const c = t.c;
  const bh = H / n;
  for (let r = 0; r < n; r++) {
    const col = shade(wood, t.u(-0.07, 0.05));
    t.rect(0, r * bh, W, bh, col);
    grain(t, 0, r * bh, W, bh, col, 'x', 7, t.r, true);
  }
  t.modulate(t.fbm(4, 4, 2), 0.06);
  const woodImg = c.getImageData(0, 0, W, H);
  for (let r = 0; r < n; r++) t.rect(0, r * bh, W, bh, shade(paint, t.u(-0.05, 0.04)));
  t.modulate(t.noise(4, n * 14), 0.035); // мазки кисти вдоль досок
  t.modulate(t.fbm(3, 3, 3), 0.06);
  const pd = c.getImageData(0, 0, W, H);
  // вытертость: шум, вытянутый вдоль досок, + у щелей сильнее + своя степень у доски
  const wn = t.fbm(3, 3 * n, 3), br = t.fbm(8, 4, 3);
  const rowOff = Array.from({ length: n }, () => t.u(-0.05, 0.05));
  const Pd = pd.data, Wd = woodImg.data;
  for (let y = 0, q = 0; y < H; y++) {
    const r = Math.min(n - 1, Math.floor(y / bh)), fy = (y - r * bh) / bh;
    const edge = Math.max(0, 1 - Math.min(fy, 1 - fy) / 0.18);
    for (let x = 0; x < W; x++, q++) {
      const k = 0.92 * smoothstep(0.53, 0.59, 0.8 * wn[q] + 0.2 * br[q] + 0.12 * edge + rowOff[r]);
      if (k <= 0) continue;
      const i = q * 4;
      for (let ch = 0; ch < 3; ch++) Pd[i + ch] += (Wd[i + ch] - Pd[i + ch]) * k;
    }
  }
  c.putImageData(pd, 0, 0);
  // щели (у края картинки — половина) и торцевые стыки
  for (let r = 0; r < n; r++) {
    t.rect(0, r * bh, W, 1.2, '#2a1a0c');
    t.rect(0, (r + 1) * bh - 1.2, W, 1.2, '#3a2412');
    t.rect(0, r * bh + 1.2, W, 1, rgba('#fff3d0', 0.25));
    const jx = ((r * 0.41 + 0.17) % 1) * W;
    for (const ox of [-W, 0, W]) if (jx + ox > -3 && jx + ox < W + 3) t.rect(jx + ox - 1, r * bh, 2, bh, '#2a1a0c');
  }
  // шпаклёвка и побелка кляксами
  for (let k = 0; k < 70; k++) {
    const x = t.u(0, W), y = t.u(0, H);
    const big = t.r() < 0.2;
    const r = big ? t.u(6, 16) : t.u(1.5, 5);
    const pts = chipPoly(t, r, 7 + Math.floor(t.r() * 4), t.u(0.5, 1));
    const a = big ? t.u(0.35, 0.6) : t.u(0.6, 0.9);
    t.wrap((ox, oy) => {
      if (x + ox < -2 * r || x + ox > W + 2 * r || y + oy < -2 * r || y + oy > H + 2 * r) return;
      fillPoly(t, x + ox, y + oy, pts, rgba(putty, a));
    });
  }
  blotch(t, t.fbm(3, 2, 3), 0.56, 0.7, '#dcd6c8', 0.35); // известковая пыль
  t.specks(Math.round((W * H) / 250), [putty, '#b8ad98'], 0.4, 1.3, 0.45);
  t.modulate(t.fbm(3, 3, 3), 0.04);
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
  // metro
  marble: drawMarble,
  granite_floor: drawGraniteFloor,
  tile_plinth: drawTilePlinth,
  soot: drawSoot,
  soot_floor: drawSootFloor,
  // cellar
  soil: drawSoil,
  // sanatorium
  paint_panel: drawPaintPanel,
  plaster_cracked: drawPlasterCracked,
  veneer: drawVeneer,
  tile_worn: drawTileWorn,
  tile_mix: drawTileMix,
  lath_brick: drawLathBrick,
  parquet_worn: drawParquetWorn,
  terrazzo: drawTerrazzo,
  boards_painted: drawBoardsPainted,
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
