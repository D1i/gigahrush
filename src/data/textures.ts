// Процедурные текстуры мебели «вид сверху» для Room Forge.
// Стиль: чертёжный план с цветом — плоские заливки, тонкий тёмный контур,
// лёгкий скос (светлая кромка сверху-слева, тень снизу-справа).
// Соглашение: «передняя» сторона предмета — НИЖНЯЯ грань картинки.

export type TextureKind =
  | 'sofa' | 'bed_single' | 'bed_double' | 'wardrobe' | 'sideboard' | 'wall_unit'
  | 'table_rect' | 'table_round' | 'desk' | 'chair' | 'stool' | 'armchair'
  | 'fridge' | 'stove' | 'sink_kitchen' | 'kitchen_counter' | 'boiler' | 'bathtub'
  | 'toilet' | 'washbasin' | 'washing_machine' | 'rug' | 'tv_stand' | 'radio'
  | 'workbench' | 'shelf' | 'tool_cabinet' | 'coat_rack' | 'shoe_rack' | 'nightstand'
  | 'dresser' | 'piano' | 'radiator' | 'plant' | 'boxes' | 'moonshine_still'
  | 'bottle_crate' | 'trash' | 'pipe' | 'mattress' | 'sewing_machine' | 'bookshelf' | 'cot'
  | 'elevator' | 'mailboxes' | 'bench' | 'locker' | 'office_desk' | 'shower' | 'sink_row'
  | 'drying_rack' | 'electrical_panel' | 'pipes' | 'boiler_tank' | 'stroller' | 'bicycle'
  | 'lenin_bust' | 'chess_table' | 'coat_hooks' | 'hatch';

export const TEXTURE_KINDS: TextureKind[] = [
  'sofa', 'bed_single', 'bed_double', 'wardrobe', 'sideboard', 'wall_unit',
  'table_rect', 'table_round', 'desk', 'chair', 'stool', 'armchair',
  'fridge', 'stove', 'sink_kitchen', 'kitchen_counter', 'boiler', 'bathtub',
  'toilet', 'washbasin', 'washing_machine', 'rug', 'tv_stand', 'radio',
  'workbench', 'shelf', 'tool_cabinet', 'coat_rack', 'shoe_rack', 'nightstand',
  'dresser', 'piano', 'radiator', 'plant', 'boxes', 'moonshine_still',
  'bottle_crate', 'trash', 'pipe', 'mattress', 'sewing_machine', 'bookshelf', 'cot',
  'elevator', 'mailboxes', 'bench', 'locker', 'office_desk', 'shower', 'sink_row',
  'drying_rack', 'electrical_panel', 'pipes', 'boiler_tank', 'stroller', 'bicycle',
  'lenin_bust', 'chess_table', 'coat_hooks', 'hatch',
];

// ---------------------------------------------------------------- палитра

const INK = '#2b241f';
const K = {
  walnut: '#7a4a2c', walnutD: '#5a331d', walnutL: '#9c6a42',
  cherry: '#6e2c25', cherryL: '#8c4234',
  dsp: '#cfb48a', pine: '#d8b97f',
  cream: '#eee4c8', creamD: '#d6c7a2',
  enamel: '#e8eff1', enamelD: '#c6d4da', water: '#a9c9d8',
  velourG: '#5c6c44', velourGL: '#72845a', velourB: '#7c4f35', velourBL: '#946347',
  carpet: '#7c2432', carpetD: '#5c1824', gold: '#d2a95a', navy: '#2f3b5e',
  steel: '#8d959c', steelD: '#5f676e', steelL: '#b5bdc3', chrome: '#d5dbdf',
  copper: '#b86f3c', copperL: '#d9955f',
  bottle: '#3e6b3c', bottleL: '#79a569', brownGlass: '#6b4424',
  black: '#2d2a29', glass: '#aac8d0',
  leaf: '#3c6b35', leafL: '#5a8f47', terracotta: '#b0603c',
  cardboard: '#c29c64', paper: '#f1ece0', sheet: '#ece6d6',
  vinyl: '#8a4a30', plaid: '#a6443a', canvas: '#7a8454', metalGreen: '#6c786c',
  alu: '#c1c7cb',
};

// ---------------------------------------------------------------- утилиты цвета и RNG

function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

/** Осветлить (k>0) или затемнить (k<0) hex-цвет; результат — снова hex. */
function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const t = k < 0 ? 0 : 255;
  const a = Math.abs(k);
  const ch = (v: number) => Math.round(v + (t - v) * a);
  const r = ch((n >> 16) & 255), g = ch((n >> 8) & 255), b = ch(n & 255);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 — детерминированный генератор для узоров. */
function makeRng(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- «художник»

type Ctx = CanvasRenderingContext2D;
type PathFn = (inset: number, dx: number, dy: number) => void;

interface Opt {
  /** Радиус скругления в долях меньшей стороны картинки; массив — [tl, tr, br, bl]. */
  r?: number | number[];
  /** Скос: true — авто, число — в пикселях. */
  bv?: number | boolean;
  /** Утопленная форма (раковина, чаша): тень сверху-слева. */
  sunk?: boolean;
  /** Цвет контура; false — без контура. */
  s?: string | false;
  /** Толщина контура, px. */
  sw?: number;
}

function rrPath(c: Ctx, x: number, y: number, w: number, h: number, r: number[]): void {
  const m = Math.max(0, Math.min(w, h) / 2);
  const [tl, tr, br, bl] = r.map((v) => clamp(v, 0, m));
  c.beginPath();
  c.moveTo(x + tl, y);
  c.lineTo(x + w - tr, y);
  if (tr) c.arcTo(x + w, y, x + w, y + tr, tr); else c.lineTo(x + w, y);
  c.lineTo(x + w, y + h - br);
  if (br) c.arcTo(x + w, y + h, x + w - br, y + h, br); else c.lineTo(x + w, y + h);
  c.lineTo(x + bl, y + h);
  if (bl) c.arcTo(x, y + h, x, y + h - bl, bl); else c.lineTo(x, y + h);
  c.lineTo(x, y + tl);
  if (tl) c.arcTo(x, y, x + tl, y, tl); else c.lineTo(x, y);
  c.closePath();
}

/**
 * Рисует в нормализованных координатах: (0,0) — левый верхний угол габарита,
 * (1,1) — правый нижний. Поля по краю = половина контура, чтобы он не обрезался.
 */
class P {
  readonly pad: number;
  readonly iw: number;
  readonly ih: number;
  /** Меньшая сторона рабочей области, px. */
  readonly m: number;
  /** Базовая толщина контура, px (≈2 на 256). */
  readonly lw: number;
  constructor(
    readonly c: Ctx,
    readonly W: number,
    readonly H: number,
    readonly wM: number,
    readonly hM: number,
  ) {
    this.lw = Math.max(1.25, Math.max(W, H) / 128);
    this.pad = this.lw / 2;
    this.iw = W - 2 * this.pad;
    this.ih = H - 2 * this.pad;
    this.m = Math.min(this.iw, this.ih);
    c.lineJoin = 'round';
    c.lineCap = 'round';
  }
  X(f: number): number { return this.pad + f * this.iw; }
  Y(f: number): number { return this.pad + f * this.ih; }
  /** Доля ширины, соответствующая px пикселям. */
  fx(px: number): number { return px / this.iw; }
  fy(px: number): number { return px / this.ih; }
  /** Доля ширины/высоты, соответствующая метрам. */
  mx(m: number): number { return m / this.wM; }
  my(m: number): number { return m / this.hM; }

  private paint(path: PathFn, fill: string, o: Opt, minSide: number): void {
    const c = this.c;
    const b = o.bv === true ? clamp(minSide * 0.1, 1.5, 7) : typeof o.bv === 'number' ? o.bv : 0;
    if (b > 0 && minSide > 5) {
      const dark = shade(fill, o.sunk ? -0.3 : -0.25);
      const light = shade(fill, 0.22);
      c.save();
      path(0, 0, 0);
      c.clip();
      c.fillStyle = o.sunk ? light : dark;
      path(0, 0, 0);
      c.fill();
      c.fillStyle = o.sunk ? dark : light;
      if (o.sunk) path(0.8 * b, -0.2 * b, -0.2 * b);
      else path(0.5 * b, -0.5 * b, -0.5 * b);
      c.fill();
      c.fillStyle = fill;
      if (o.sunk) path(0.8 * b, 0.4 * b, 0.4 * b);
      else path(0.7 * b, -0.3 * b, -0.3 * b);
      c.fill();
      c.restore();
    } else {
      c.fillStyle = fill;
      path(0, 0, 0);
      c.fill();
    }
    if (o.s !== false) {
      c.lineWidth = o.sw ?? this.lw;
      c.strokeStyle = o.s ?? INK;
      path(0, 0, 0);
      c.stroke();
    }
  }

  rect(x: number, y: number, w: number, h: number, fill: string, o: Opt = {}): void {
    const X0 = this.X(x), Y0 = this.Y(y), wp = w * this.iw, hp = h * this.ih;
    const rr = o.r ?? 0;
    const r = (Array.isArray(rr) ? rr : [rr, rr, rr, rr]).map((v) => v * this.m);
    this.paint(
      (i, dx, dy) => rrPath(this.c, X0 + dx + i, Y0 + dy + i, Math.max(0.1, wp - 2 * i), Math.max(0.1, hp - 2 * i), r.map((v) => Math.max(0, v - i))),
      fill, o, Math.min(wp, hp),
    );
  }

  /** Эллипс, вписанный в долях ширины/высоты (растягивается вместе с габаритом). */
  ell(cx: number, cy: number, rx: number, ry: number, fill: string, o: Opt = {}): void {
    this.ellPx(this.X(cx), this.Y(cy), rx * this.iw, ry * this.ih, fill, o);
  }

  /** Круг радиусом r в долях меньшей стороны (не растягивается). */
  circ(cx: number, cy: number, r: number, fill: string, o: Opt = {}): void {
    this.ellPx(this.X(cx), this.Y(cy), r * this.m, r * this.m, fill, o);
  }

  ellPx(X0: number, Y0: number, rx: number, ry: number, fill: string, o: Opt = {}): void {
    const c = this.c;
    this.paint((i, dx, dy) => {
      c.beginPath();
      c.ellipse(X0 + dx, Y0 + dy, Math.max(0.1, rx - i), Math.max(0.1, ry - i), 0, 0, Math.PI * 2);
    }, fill, o, 2 * Math.min(rx, ry));
  }

  /** Многоугольник (точки парами в долях). */
  poly(pts: number[], fill: string, o: Opt = {}): void {
    const c = this.c;
    this.paint((_i, dx, dy) => {
      c.beginPath();
      for (let k = 0; k < pts.length; k += 2) {
        const x = this.X(pts[k]) + dx, y = this.Y(pts[k + 1]) + dy;
        if (k === 0) c.moveTo(x, y); else c.lineTo(x, y);
      }
      c.closePath();
    }, fill, { ...o, bv: 0 }, 99);
  }

  /** Ломаная (точки парами в долях), толщина в px. */
  line(pts: number[], color: string, w: number, cap: CanvasLineCap = 'round'): void {
    const c = this.c;
    c.beginPath();
    for (let k = 0; k < pts.length; k += 2) {
      const x = this.X(pts[k]), y = this.Y(pts[k + 1]);
      if (k === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.lineCap = cap;
    c.lineWidth = w;
    c.strokeStyle = color;
    c.stroke();
    c.lineCap = 'round';
  }

  /** Выполнить fn, обрезав рисование прямоугольником (доли). */
  clip(x: number, y: number, w: number, h: number, r: number, fn: () => void): void {
    const c = this.c;
    c.save();
    rrPath(c, this.X(x), this.Y(y), w * this.iw, h * this.ih, [r, r, r, r].map((v) => v * this.m));
    c.clip();
    fn();
    c.restore();
  }

  /** Древесные волокна: несколько плавных линий вдоль длинной стороны прямоугольника. */
  grain(x: number, y: number, w: number, h: number, color: string, seed: number): void {
    const rnd = makeRng(seed);
    const hor = w * this.iw >= h * this.ih;
    const across = hor ? h * this.ih : w * this.iw;
    const n = clamp(Math.round(across / 11), 2, 9);
    this.clip(x, y, w, h, 0, () => {
      const c = this.c;
      c.strokeStyle = color;
      c.lineWidth = Math.max(1, this.lw * 0.6);
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5 + (rnd() - 0.5) * 0.6) / n;
        const amp = (rnd() * 0.5 + 0.2) * (across / n);
        const ph = rnd() * 6.28;
        c.beginPath();
        const steps = 6;
        for (let s = 0; s <= steps; s++) {
          const u = s / steps;
          const off = Math.sin(u * 5 + ph) * amp * 0.5;
          const px = hor ? this.X(x + u * w) : this.X(x + t * w) + off;
          const py = hor ? this.Y(y + t * h) + off : this.Y(y + u * h);
          if (s === 0) c.moveTo(px, py); else c.lineTo(px, py);
        }
        c.stroke();
      }
    });
  }
}

// ---------------------------------------------------------------- общие элементы

/** Прямоугольник в долях: x, y, w, h. */
type Box = [number, number, number, number];

interface CabOpt {
  body: string;
  top?: string;
  front?: string;
  doors?: number;
  handle?: 'knob' | 'bar' | 'none';
  glass?: boolean;
  grain?: boolean;
  seed?: number;
}

/** Корпусная мебель: столешница-крышка + фасадная полоса с дверцами и ручками у нижней кромки. */
function cabinet(p: P, o: CabOpt, x = 0, y = 0, w = 1, h = 1): Box {
  const hp = h * p.ih;
  const fh = clamp(Math.max(6, hp * 0.2), 0, hp * 0.4);
  const ff = p.fy(fh);
  p.rect(x, y, w, h, o.body, { bv: true, r: 0.025 });
  // крышка
  const ix = p.fx(clamp(hp * 0.07, 2.5, 6)), iy = p.fy(clamp(hp * 0.07, 2.5, 6));
  const top = o.top ?? shade(o.body, 0.1);
  p.rect(x + ix, y + iy, w - 2 * ix, h - ff - iy, top, { s: shade(o.body, -0.4), sw: 1 });
  if (o.grain !== false) p.grain(x + ix, y + iy, w - 2 * ix, h - ff - iy, shade(top, -0.13), o.seed ?? 7);
  // фасад
  const fy0 = y + h - ff;
  const front = o.front ?? shade(o.body, -0.12);
  p.rect(x, fy0, w, ff, o.glass ? K.glass : front, { bv: 2 });
  const doors = o.doors ?? 1;
  if (o.glass) {
    for (let d = 0; d < doors; d++) {
      const gx = x + (w * (d + 0.3)) / doors;
      p.line([gx, fy0 + ff * 0.85, gx + p.fx(fh * 0.6), fy0 + ff * 0.2], '#e9f3f5', Math.max(1.2, p.lw * 0.8));
    }
  }
  for (let d = 1; d < doors; d++) {
    const dx = x + (w * d) / doors;
    p.line([dx, fy0, dx, y + h], INK, Math.max(1, p.lw * 0.7), 'butt');
  }
  const hs = clamp(fh * 0.28, 2, 6);
  for (let d = 0; d < doors; d++) {
    const cx = x + (w * (d + 0.5)) / doors;
    const cy = fy0 + ff * 0.55;
    if (o.handle === 'knob') {
      p.ellPx(p.X(cx), p.Y(cy), hs * 0.8, hs * 0.8, K.chrome, { sw: 1 });
    } else if (o.handle !== 'none') {
      const bw = clamp((w * p.iw) / doors * 0.25, 6, 26);
      p.rect(cx - p.fx(bw / 2), cy - p.fy(hs * 0.45), p.fx(bw), p.fy(hs * 0.9), K.chrome, { sw: 1, r: 0.05 });
    }
  }
  return [x + ix, y + iy, w - 2 * ix, h - ff - iy];
}

/** Чемодан (на шкафу) — фибровый, с уголками и ручкой к переднему краю. */
function suitcase(p: P, x: number, y: number, w: number, h: number): void {
  const col = '#56697a';
  p.rect(x, y, w, h, col, { bv: 2, r: 0.04 });
  // ремни поперёк и металлические уголки
  for (const t of [0.25, 0.75]) p.rect(x + w * t - p.fx(2.5), y, p.fx(5), h, '#8a5a36', { sw: 1 });
  const cx = p.fx(5), cy = p.fy(5);
  for (const [ax, ay] of [[x, y], [x + w - cx, y], [x, y + h - cy], [x + w - cx, y + h - cy]]) {
    p.rect(ax, ay, cx, cy, K.chrome, { sw: 1 });
  }
  // ручка у передней кромки
  p.rect(x + w * 0.4, y + h - p.fy(3), w * 0.2, p.fy(6), '#3a2a20', { sw: 1, r: 0.05 });
}

/** Вытянутая вязаная дорожка-салфетка. */
function runner(p: P, x: number, y: number, w: number, h: number): void {
  p.rect(x, y, w, h, '#f1ebdd', { s: '#b8ad96', sw: 1, r: 0.04 });
  p.rect(x + w * 0.06, y + h * 0.2, w * 0.88, h * 0.6, 'rgba(0,0,0,0)', { s: '#cfc4ab', sw: 1, r: 0.03 });
}

/** Мягкая мебель: спинка сверху, подлокотники, подушки сиденья снизу. */
function upholstered(p: P, base: string, light: string, seats: number | null): void {
  const armW = clamp(p.fx(p.ih * 0.2), 0.05, 0.24);
  const backH = 0.3;
  // спинка
  p.rect(0, 0, 1, backH + 0.06, base, { bv: true, r: 0.12 });
  // гобеленовый узор — ряд ромбиков по спинке
  const dh = backH * p.ih * 0.28;
  const cnt = Math.max(1, Math.floor(((1 - 2 * armW) * p.iw) / (dh * 2.4)));
  for (let i = 0; i < cnt; i++) {
    const cx = armW + ((i + 0.5) / cnt) * (1 - 2 * armW);
    const cy = backH * 0.5;
    const rx = p.fx(dh * 0.8), ry = p.fy(dh);
    p.poly([cx, cy - ry, cx + rx, cy, cx, cy + ry, cx - rx, cy], shade(base, 0.2), { s: false });
  }
  // подлокотники с деревянными накладками
  for (const ax of [0, 1 - armW]) {
    p.rect(ax, 0.05, armW, 0.95, base, { bv: true, r: 0.1 });
    p.rect(ax + armW * 0.2, 0.1, armW * 0.6, 0.84, K.walnut, { bv: 2, r: 0.08 });
  }
  // подушки сиденья
  const sx = armW, sw = 1 - 2 * armW, sy = backH, sh = 0.98 - sy;
  const n = seats ?? Math.max(1, Math.round((sw * p.iw) / (sh * p.ih * 1.1)));
  const g = p.fx(1);
  for (let i = 0; i < n; i++) {
    p.rect(sx + (i * sw) / n + g, sy, sw / n - 2 * g, sh, light, { bv: true, r: 0.1 });
  }
}

/** Эмалированный корпус (плита, холодильник, стиралка). */
function enamelBody(p: P, color = K.cream, r = 0.06): void {
  p.rect(0, 0, 1, 1, color, { bv: true, r });
}

// ---------------------------------------------------------------- отдельные предметы

type Draw = (p: P, rnd: () => number) => void;

function bed(p: P, dbl: boolean): void {
  p.rect(0, 0, 1, 1, K.walnut, { bv: true, r: 0.04 });
  const hb = clamp(p.fy(10), 0.04, 0.14);
  p.rect(0, 0, 1, hb, K.walnutD, { bv: 2, r: 0.04 });
  const ix = clamp(p.fx(6), 0.03, 0.1);
  const sy = hb + p.fy(2);
  p.rect(ix, sy, 1 - 2 * ix, 0.985 - sy - p.fy(3), K.sheet, { sw: 1 });
  // подушки
  const ph = clamp(p.my(0.42), 0.1, 0.3);
  const py = sy + p.fy(4);
  const pills = dbl ? 2 : 1;
  const pw = (1 - 2 * ix - 0.06) / pills;
  for (let i = 0; i < pills; i++) {
    const x0 = ix + 0.03 + i * pw + 0.01;
    p.rect(x0, py, pw - 0.02, ph, '#f6f3ea', { bv: true, r: 0.12 });
    p.line([x0 + (pw - 0.02) * 0.5, py + ph * 0.2, x0 + (pw - 0.02) * 0.5, py + ph * 0.8], '#d8d2c2', 1.2);
  }
  // одеяло в пододеяльнике с ромбовидным вырезом
  const by = py + ph + p.fy(6);
  const bh = 0.985 - by;
  p.rect(ix - p.fx(2), by, 1 - 2 * ix + p.fx(4), bh, '#f0ebe0', { bv: true, r: 0.04 });
  const fold = clamp(p.my(0.22), 0.05, 0.15);
  p.rect(ix - p.fx(2), by, 1 - 2 * ix + p.fx(4), fold, '#faf7f0', { bv: 2, r: 0.04 });
  const cx = 0.5, cy = by + fold + (bh - fold) * 0.5;
  const rx = Math.min(0.28, p.fx((bh - fold) * p.ih * 0.3)) * (dbl ? 1.1 : 1);
  const ry = Math.min((bh - fold) * 0.34, p.fy(rx * p.iw * 1.3));
  const dia = [cx, cy - ry, cx + rx, cy, cx, cy + ry, cx - rx, cy];
  p.poly(dia, K.plaid, { sw: 1.5 });
  // клетка пледа внутри ромба
  p.c.save();
  p.c.beginPath();
  for (let k = 0; k < 8; k += 2) p.c.lineTo(p.X(dia[k]), p.Y(dia[k + 1]));
  p.c.clip();
  const st = Math.max(6, rx * p.iw * 0.35);
  p.c.strokeStyle = '#d9b36a';
  p.c.lineWidth = 2;
  for (let v = -3; v <= 3; v++) {
    p.c.beginPath();
    p.c.moveTo(p.X(cx) + v * st, 0); p.c.lineTo(p.X(cx) + v * st, p.H);
    p.c.moveTo(0, p.Y(cy) + v * st); p.c.lineTo(p.W, p.Y(cy) + v * st);
    p.c.stroke();
  }
  p.c.restore();
  p.poly(dia, 'rgba(0,0,0,0)', { sw: 1.5 });
}

function rug(p: P): void {
  const c = p.c;
  const hor = p.iw >= p.ih;
  const fr = 0.035;
  const x0 = hor ? fr : 0, y0 = hor ? 0 : fr;
  const w = hor ? 1 - 2 * fr : 1, h = hor ? 1 : 1 - 2 * fr;
  // бахрома по коротким сторонам
  const fringe = '#e6dbc0';
  const step = 4;
  if (hor) {
    for (let y = p.Y(0.03); y < p.Y(0.97); y += step) {
      p.c.strokeStyle = fringe; c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(p.X(0), y); c.lineTo(p.X(x0 + 0.01), y); c.moveTo(p.X(1 - fr - 0.01), y); c.lineTo(p.X(1), y); c.stroke();
    }
  } else {
    for (let x = p.X(0.03); x < p.X(0.97); x += step) {
      c.strokeStyle = fringe; c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(x, p.Y(0)); c.lineTo(x, p.Y(y0 + 0.01)); c.moveTo(x, p.Y(1 - fr - 0.01)); c.lineTo(x, p.Y(1)); c.stroke();
    }
  }
  p.rect(x0, y0, w, h, K.carpet, { sw: p.lw * 0.8 });
  const bx = p.X(x0), by = p.Y(y0), bw = w * p.iw, bh = h * p.ih;
  const m = Math.min(bw, bh);
  const e1 = m * 0.045, e2 = m * 0.15;
  // кайма
  c.fillStyle = K.navy;
  c.fillRect(bx + e1, by + e1, bw - 2 * e1, bh - 2 * e1);
  c.fillStyle = K.carpet;
  c.fillRect(bx + e2, by + e2, bw - 2 * e2, bh - 2 * e2);
  c.strokeStyle = K.gold;
  c.lineWidth = Math.max(1.2, m * 0.015);
  c.strokeRect(bx + e1, by + e1, bw - 2 * e1, bh - 2 * e1);
  c.strokeRect(bx + e2, by + e2, bw - 2 * e2, bh - 2 * e2);
  // ромбики в кайме
  const bandMid = (e1 + e2) / 2, dr = (e2 - e1) * 0.3;
  const diamond = (x: number, y: number, rx: number, ry: number) => {
    c.beginPath(); c.moveTo(x, y - ry); c.lineTo(x + rx, y); c.lineTo(x, y + ry); c.lineTo(x - rx, y); c.closePath();
  };
  c.fillStyle = K.gold;
  const sp = dr * 3.2;
  for (let t = bandMid + sp; t < bw - bandMid - sp * 0.5; t += sp) {
    diamond(bx + t, by + bandMid, dr, dr); c.fill();
    diamond(bx + t, by + bh - bandMid, dr, dr); c.fill();
  }
  for (let t = bandMid + sp; t < bh - bandMid - sp * 0.5; t += sp) {
    diamond(bx + bandMid, by + t, dr, dr); c.fill();
    diamond(bx + bw - bandMid, by + t, dr, dr); c.fill();
  }
  // поле с решёткой из ромбов
  const fx0 = bx + e2, fy0 = by + e2, fw = bw - 2 * e2, fh = bh - 2 * e2;
  c.save();
  c.beginPath(); c.rect(fx0, fy0, fw, fh); c.clip();
  const s = Math.max(10, m * 0.16);
  c.strokeStyle = K.carpetD;
  c.lineWidth = Math.max(1.5, m * 0.02);
  c.beginPath();
  for (let k = -fh; k < fw + fh; k += s) {
    c.moveTo(fx0 + k, fy0); c.lineTo(fx0 + k + fh, fy0 + fh);
    c.moveTo(fx0 + k, fy0 + fh); c.lineTo(fx0 + k + fh, fy0);
  }
  c.stroke();
  c.restore();
  // центральный медальон
  const cx = fx0 + fw / 2, cy = fy0 + fh / 2;
  const mrx = fw * 0.36, mry = fh * 0.38;
  diamond(cx, cy, mrx, mry); c.fillStyle = K.navy; c.fill();
  c.strokeStyle = K.gold; c.lineWidth = Math.max(1.5, m * 0.02); c.stroke();
  diamond(cx, cy, mrx * 0.62, mry * 0.62); c.fillStyle = K.carpet; c.fill(); c.stroke();
  diamond(cx, cy, mrx * 0.25, mry * 0.25); c.fillStyle = K.gold; c.fill();
  // уголки поля
  c.fillStyle = K.navy;
  for (const [ux, uy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const ax = fx0 + ux * fw, ay = fy0 + uy * fh;
    c.beginPath(); c.moveTo(ax, ay); c.lineTo(ax + (ux ? -1 : 1) * fw * 0.14, ay); c.lineTo(ax, ay + (uy ? -1 : 1) * fh * 0.2); c.closePath(); c.fill();
  }
}

function plant(p: P, rnd: () => number): void {
  const c = p.c;
  const cx = p.X(0.5), cy = p.Y(0.5), RX = p.iw / 2, RY = p.ih / 2;
  // горшок
  p.ellPx(cx, cy, RX * 0.5, RY * 0.5, K.terracotta, { bv: true });
  p.ellPx(cx, cy, RX * 0.4, RY * 0.4, '#4a3526', { s: false });
  // листья фикуса: заострённые эллипсы по кругу
  const n = 9;
  const leaf = (a: number, len: number, wid: number, col: string) => {
    const ux = Math.cos(a), uy = Math.sin(a);
    const vx = -uy, vy = ux;
    const map = (u: number, v: number): [number, number] => [cx + (ux * u + vx * v) * RX, cy + (uy * u + vy * v) * RY];
    const b = map(0.12, 0), t = map(len, 0);
    const l = map((len + 0.12) / 2, wid), r = map((len + 0.12) / 2, -wid);
    c.beginPath();
    c.moveTo(b[0], b[1]);
    c.quadraticCurveTo(l[0], l[1], t[0], t[1]);
    c.quadraticCurveTo(r[0], r[1], b[0], b[1]);
    c.closePath();
    c.fillStyle = col; c.fill();
    c.strokeStyle = INK; c.lineWidth = p.lw * 0.8; c.stroke();
    c.beginPath(); c.moveTo(b[0], b[1]);
    const mt = map(len * 0.85, 0);
    c.lineTo(mt[0], mt[1]);
    c.strokeStyle = shade(col, 0.35); c.lineWidth = 1.2; c.stroke();
  };
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.3;
    leaf(a, 0.9 + rnd() * 0.08, 0.26, K.leaf);
  }
  for (let i = 0; i < 6; i++) {
    const a = ((i + 0.5) / 6) * Math.PI * 2 + rnd() * 0.3;
    leaf(a, 0.62 + rnd() * 0.1, 0.2, K.leafL);
  }
  p.ellPx(cx, cy, RX * 0.1, RY * 0.1, '#5a4030', { s: false });
}

// ---------------------------------------------------------------- набор 2: подъезд, подвал, общага

/** Рисование «вдоль длинной стороны»: u — вдоль, v — поперёк. Для вертикального габарита
 *  u идёт сверху вниз, так что конец u=1 — нижняя (передняя) грань. */
function axis(p: P) {
  const hor = p.iw >= p.ih;
  const sw = (a: number[]) => {
    const r: number[] = [];
    for (let k = 0; k < a.length; k += 2) r.push(a[k + 1], a[k]);
    return r;
  };
  return {
    hor,
    along: hor ? p.iw : p.ih,
    across: hor ? p.ih : p.iw,
    R: (u: number, v: number, du: number, dv: number, col: string, o: Opt = {}) =>
      hor ? p.rect(u, v, du, dv, col, o) : p.rect(v, u, dv, du, col, o),
    L: (pts: number[], col: string, w: number, cap?: CanvasLineCap) => p.line(hor ? pts : sw(pts), col, w, cap),
    C: (u: number, v: number, r: number, col: string, o: Opt = {}) => (hor ? p.circ(u, v, r, col, o) : p.circ(v, u, r, col, o)),
    E: (u: number, v: number, ru: number, rv: number, col: string, o: Opt = {}) =>
      hor ? p.ell(u, v, ru, rv, col, o) : p.ell(v, u, rv, ru, col, o),
  };
}

/** Пальто на крючке (вид сверху): плечи, воротник, планка с пуговицами. */
function coat(p: P, cx: number, top: number, cw: number, ch: number, col: string): void {
  p.rect(cx - cw / 2, top, cw, ch, col, { bv: true, r: [0.5, 0.5, 0.25, 0.25] });
  p.ell(cx, top + ch * 0.12, cw * 0.22, ch * 0.16, shade(col, -0.35), { sw: 1 });
  p.line([cx, top + ch * 0.25, cx, top + ch * 0.96], shade(col, -0.4), 1.5, 'butt');
  for (const t of [0.45, 0.7]) p.circ(cx + p.fx(3), top + ch * t, 0.04, shade(col, 0.4), { s: false });
}

/** Маховик вентиля: красное колесо со спицами. */
function valve(p: P, X: number, Y: number, r: number): void {
  p.ellPx(X, Y, r, r, '#b8433a', { sw: 1 });
  p.ellPx(X, Y, r * 0.62, r * 0.62, '#34332f', { s: false });
  const c = p.c;
  c.strokeStyle = '#b8433a';
  c.lineWidth = Math.max(1.2, r * 0.22);
  c.beginPath();
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI;
    c.moveTo(X - Math.cos(a) * r * 0.7, Y - Math.sin(a) * r * 0.7);
    c.lineTo(X + Math.cos(a) * r * 0.7, Y + Math.sin(a) * r * 0.7);
  }
  c.stroke();
  p.ellPx(X, Y, r * 0.2, r * 0.2, K.steelD, { s: false });
}

type Kind2 =
  | 'elevator' | 'mailboxes' | 'bench' | 'locker' | 'office_desk' | 'shower' | 'sink_row'
  | 'drying_rack' | 'electrical_panel' | 'pipes' | 'boiler_tank' | 'stroller' | 'bicycle'
  | 'lenin_bust' | 'chess_table' | 'coat_hooks';

const DRAW2: Record<Kind2, Draw> = {
  elevator: (p) => {
    // бетонная шахта, крыша кабины, раздвижные двери и кнопка вызова у нижней кромки
    p.rect(0, 0, 1, 1, '#9b978d', { bv: true, r: 0.02 });
    const t = p.fx(Math.max(6, p.m * 0.07)), tv = p.fy(Math.max(6, p.m * 0.07));
    const dh = p.fy(Math.max(9, p.ih * 0.14));
    const cab = '#7a6d5c', ch = 1 - tv - dh;
    p.rect(t, tv, 1 - 2 * t, ch, cab, { bv: true, r: 0.02 });
    p.rect(0.22, tv + ch * 0.18, 0.3, ch * 0.4, shade(cab, -0.18), { sw: 1, r: 0.02 });
    for (let i = 0; i < 5; i++) p.line([0.62, tv + ch * (0.2 + i * 0.09), 0.8, tv + ch * (0.2 + i * 0.09)], shade(cab, -0.35), 1.5);
    // тросы
    p.circ(0.5, tv + ch * 0.78, 0.06, K.steelL, { sw: 1 });
    p.line([0.5, tv + ch * 0.78, 0.5, tv], K.steelD, 1.5);
    // двери
    const dy = 1 - dh;
    p.rect(0.16, dy, 0.64, dh, K.steelD, { bv: 2 });
    p.rect(0.18, dy + dh * 0.2, 0.3, dh * 0.8, K.steelL, { sw: 1 });
    p.rect(0.48, dy + dh * 0.2, 0.3, dh * 0.8, K.steelL, { sw: 1 });
    // кнопка вызова
    p.rect(0.85, dy + dh * 0.1, 0.1, dh * 0.8, '#55524d', { sw: 1, r: 0.03 });
    p.ellPx(p.X(0.9), p.Y(dy + dh * 0.5), Math.max(2, dh * p.ih * 0.25), Math.max(2, dh * p.ih * 0.25), '#e8803a', { sw: 1 });
  },
  mailboxes: (p, rnd) => {
    const col = '#5f7384';
    const n = Math.max(2, Math.round(p.wM / 0.2));
    p.rect(0, 0, 1, 1, col, { bv: true, r: 0.03 });
    const ff = 0.5;
    const ix = p.fx(4), iy = p.fy(4);
    p.rect(ix, iy, 1 - 2 * ix, 1 - ff - iy, shade(col, 0.12), { s: shade(col, -0.4), sw: 1 });
    // дверцы с прорезью, номером и замочком
    const c = p.c;
    const start = 40 + Math.floor(rnd() * 60);
    const g = p.fx(1.5);
    for (let i = 0; i < n; i++) {
      const x = i / n + g, w = 1 / n - 2 * g;
      p.rect(x, 1 - ff + p.fy(1.5), w, ff - p.fy(3), shade(col, -0.05), { bv: 2, sw: 1 });
      p.rect(x + w * 0.15, 1 - ff + ff * 0.18, w * 0.7, ff * 0.1, '#262a2e', { s: false });
      const fs = Math.max(6, Math.min(w * p.iw * 0.34, ff * p.ih * 0.36));
      c.font = `bold ${Math.round(fs)}px sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillStyle = '#f1ebdd';
      c.fillText(String(start + i), p.X(x + w * 0.45), p.Y(1 - ff * 0.42));
      p.ellPx(p.X(x + w * 0.85), p.Y(1 - ff * 0.42), 1.8, 1.8, K.chrome, { s: false });
    }
  },
  bench: (p) => {
    const iron = '#3a3634', wood = '#b0743e';
    const side = clamp(p.fx(p.m * 0.1), 0.03, 0.08);
    // рейки: две — спинка сверху, остальные — сиденье снизу
    const seatN = Math.max(3, Math.round((p.hM * 0.6) / 0.07));
    const g = p.fy(2);
    for (let i = 0; i < 2; i++) p.rect(0, 0.02 + i * 0.11, 1, 0.09 - g, shade(wood, -0.18), { bv: 2, r: 0.1 });
    const sy = 0.4, sh = (0.98 - sy) / seatN;
    for (let i = 0; i < seatN; i++) p.rect(0.01, sy + i * sh, 0.98, sh - g, shade(wood, 0.06), { bv: 2, r: 0.1 });
    // чугунные боковины на всю глубину
    for (const x of [0.06, 0.94 - side]) {
      p.rect(x, 0, side, 1, iron, { bv: 2, r: 0.1 });
      p.line([x + side / 2, 0.05, x + side / 2, 0.95], shade(iron, 0.25), 1.2);
    }
  },
  locker: (p) => {
    const n = clamp(Math.round(p.wM / 0.35), 1, 3);
    const col = '#7a8f9c';
    for (let i = 0; i < n; i++) {
      const [x, y, w, h] = cabinet(p, { body: col, top: shade(col, 0.12), doors: 1, handle: 'bar', grain: false }, i / n, 0, 1 / n, 1);
      // вентиляционные прорези и табличка с номером
      for (let k = 0; k < 4; k++) {
        const yy = y + h * (0.55 + k * 0.1);
        p.line([x + w * 0.25, yy, x + w * 0.75, yy], shade(col, -0.45), Math.max(1.5, p.lw), 'butt');
      }
      p.rect(x + w * 0.35, y + h * 0.14, w * 0.3, h * 0.22, '#efe9dc', { sw: 1 });
      p.line([x + w * 0.42, y + h * 0.25, x + w * 0.58, y + h * 0.25], '#555', 1.5);
    }
  },
  office_desk: (p) => {
    const top = '#a87c52';
    p.rect(0, 0, 1, 1, top, { bv: true, r: 0.03 });
    p.grain(0.02, 0.03, 0.96, 0.94, shade(top, -0.12), 91);
    // стопка бумаг и папка «Дело» у переднего края
    p.rect(0.36, 0.44, 0.24, 0.46, '#e4dfd2', { sw: 1 });
    p.rect(0.33, 0.48, 0.24, 0.46, K.paper, { sw: 1 });
    for (let k = 0; k < 4; k++) p.line([0.36, 0.58 + k * 0.08, 0.53 - (k % 2) * 0.05, 0.58 + k * 0.08], '#9aa0a8', 1);
    p.rect(0.64, 0.46, 0.22, 0.42, '#d8c08e', { sw: 1, r: 0.02 });
    p.line([0.75, 0.46, 0.75, 0.88], '#8a7a58', 1);
    // счёты у дальнего края слева
    const aw = Math.min(0.34, p.mx(0.32)), ah = Math.min(0.36, p.my(0.24));
    const ax = 0.04, ay = 0.06;
    p.rect(ax, ay, aw, ah, K.walnutD, { bv: 2, r: 0.03 });
    const rows = 5, rh = (ah * 0.84) / rows;
    const br = Math.max(1.5, rh * p.ih * 0.4);
    for (let r = 0; r < rows; r++) {
      const yy = ay + ah * 0.08 + (r + 0.5) * rh;
      p.line([ax + aw * 0.06, yy, ax + aw * 0.94, yy], K.steelL, 1);
      const left = 2 + ((r * 3) % 5);
      for (let b = 0; b < 10; b++) {
        const bx = b < left ? ax + aw * 0.1 + b * p.fx(br * 2) : ax + aw * 0.9 - (9 - b) * p.fx(br * 2);
        p.ellPx(p.X(bx), p.Y(yy), br, br * 0.9, b === 4 || b === 5 ? K.black : '#d8b98a', { s: false });
      }
    }
    // дисковый телефон справа
    const pw = Math.min(0.24, p.mx(0.22)), ph = Math.min(0.4, p.my(0.24));
    const px = 0.96 - pw, py = 0.06;
    p.rect(px, py + ph * 0.18, pw, ph * 0.82, '#2c2a2a', { bv: true, r: 0.12 });
    const dr = Math.min(pw * p.iw, ph * p.ih) * 0.26;
    p.ellPx(p.X(px + pw / 2), p.Y(py + ph * 0.62), dr, dr, '#e8e2d2', { sw: 1 });
    p.ellPx(p.X(px + pw / 2), p.Y(py + ph * 0.62), dr * 0.35, dr * 0.35, '#b8433a', { s: false });
    // трубка-«гантель» поверх рычагов
    p.rect(px + pw * 0.1, py + ph * 0.02, pw * 0.8, ph * 0.14, '#1f1e1e', { sw: 1, r: 0.05 });
    for (const ex of [px + pw * 0.12, px + pw * 0.88]) p.ellPx(p.X(ex), p.Y(py + ph * 0.09), pw * p.iw * 0.14, ph * p.ih * 0.13, '#1f1e1e', { sw: 1 });
    // карандаш
    p.line([0.1, 0.8, 0.26, 0.66], '#c9a24c', Math.max(2, p.m * 0.03));
  },
  shower: (p) => {
    p.rect(0, 0, 1, 1, K.enamel, { bv: true, r: 0.06 });
    p.rect(0.07, 0.07, 0.86, 0.86, '#dbe7ec', { bv: true, sunk: true, r: 0.05, sw: 1.5 });
    // рифление поддона
    for (let r = 0; r < 4; r++) for (let q = 0; q < 4; q++) {
      if ((r === 1 || r === 2) && (q === 1 || q === 2)) continue;
      const x = 0.18 + q * 0.2, y = 0.22 + r * 0.19;
      p.line([x, y, x + 0.1, y], '#b9c9d0', 2);
    }
    // трап
    p.circ(0.5, 0.56, 0.1, K.steel, { bv: 2 });
    for (const d of [-0.04, 0, 0.04]) p.line([0.5 + d, 0.56 - 0.06, 0.5 + d, 0.56 + 0.06], K.steelD, 1.5);
    // смеситель и лейка у стены
    p.line([0.5, 0.02, 0.5, 0.2], K.chrome, Math.max(3, p.m * 0.04));
    p.line([0.5, 0.02, 0.5, 0.2], INK, 0.8);
    p.circ(0.36, 0.05, 0.05, '#b8433a', { sw: 1 });
    p.circ(0.64, 0.05, 0.05, '#3f6aa8', { sw: 1 });
    p.circ(0.5, 0.24, 0.1, K.chrome, { bv: 2 });
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      p.ellPx(p.X(0.5) + Math.cos(a) * p.m * 0.05, p.Y(0.24) + Math.sin(a) * p.m * 0.05, 1.2, 1.2, K.steelD, { s: false });
    }
    // шторка на карнизе вдоль открытой (передней) стороны, собрана слева
    p.line([0.03, 0.97, 0.97, 0.97], K.steelD, 2);
    const pts: number[] = [0.03, 0.93];
    for (let k = 0; k <= 6; k++) pts.push(0.05 + k * 0.045, k % 2 ? 0.9 : 0.99);
    pts.push(0.32, 0.99, 0.03, 0.99);
    p.poly(pts, '#9fc3d6', { sw: 1 });
  },
  sink_row: (p) => {
    const n = Math.max(1, Math.round(p.wM / 0.6));
    // общая труба вдоль стены
    p.rect(0, 0.02, 1, 0.08, K.steelD, { bv: 2 });
    for (let i = 0; i < n; i++) {
      const x = i / n, w = 1 / n, g = p.fx(3);
      p.rect(x + g, 0.06, w - 2 * g, 0.92, K.enamel, { bv: true, r: [0.06, 0.06, 0.4, 0.4] });
      p.ell(x + w / 2, 0.58, w * 0.36, 0.3, '#dbe7ec', { bv: true, sunk: true, sw: 1.5 });
      p.circ(x + w / 2, 0.62, 0.05, K.steelD, { sw: 1 });
      // один холодный кран
      p.rect(x + w / 2 - p.fx(p.m * 0.06), 0.02, p.fx(p.m * 0.12), 0.12, K.chrome, { sw: 1, r: 0.05 });
      p.line([x + w / 2, 0.1, x + w / 2, 0.36], K.chrome, Math.max(3, p.m * 0.05));
      p.line([x + w / 2, 0.1, x + w / 2, 0.36], INK, 0.8);
      p.circ(x + w / 2 + p.fx(p.m * 0.12), 0.08, 0.05, '#3f6aa8', { sw: 1 });
    }
  },
  drying_rack: (p, rnd) => {
    const A = axis(p);
    const tube = Math.max(3, p.m * 0.035);
    // алюминиевая рама и торцевые перекладины
    A.R(0, 0, 1, 1, 'rgba(0,0,0,0)', { s: K.alu, sw: tube, r: 0.04 });
    A.R(0, 0, 1, 1, 'rgba(0,0,0,0)', { s: INK, sw: 1, r: 0.04 });
    const ropes = Math.max(4, Math.round((A.hor ? p.hM : p.wM) / 0.07));
    const cols = ['#f1ece0', '#9fc3d6', '#d99a9a', '#e6cf7a', '#8fae86', '#f1ece0', '#b7a3cf'];
    for (let r = 0; r < ropes; r++) {
      const v = (r + 0.5) / ropes;
      A.L([0.02, v, 0.98, v], '#8d8a82', 1);
      // бельё на верёвке
      let u = 0.05 + rnd() * 0.08;
      while (u < 0.9) {
        const len = 0.1 + rnd() * 0.22;
        if (u + len > 0.95) break;
        if (rnd() < 0.8) {
          const col = cols[Math.floor(rnd() * cols.length)];
          A.R(u, v - 0.34 / ropes, len, 0.68 / ropes, col, { sw: 1, r: 0.05 });
          if (rnd() < 0.35) A.L([u + len * 0.2, v, u + len * 0.8, v], shade(col, -0.25), 1.5);
        }
        u += len + 0.03 + rnd() * 0.05;
      }
    }
  },
  electrical_panel: (p) => {
    const col = '#8d9488';
    p.rect(0, 0, 1, 1, col, { bv: true, r: 0.03 });
    const fh = p.fy(Math.max(6, p.ih * 0.18));
    const ix = p.fx(4), iy = p.fy(4);
    const ih = 1 - fh - iy - p.fy(2);
    p.rect(ix, iy, 1 - 2 * ix, ih, '#3b3f3d', { bv: 2, sunk: true, sw: 1 });
    // счётчики
    const n = Math.max(1, Math.round(p.wM / 0.22));
    const mw = (1 - 2 * ix) / n;
    for (let i = 0; i < n; i++) {
      const x = ix + i * mw + mw * 0.12, w = mw * 0.5;
      p.rect(x, iy + ih * 0.1, w, ih * 0.62, '#26282a', { sw: 1, r: 0.04 });
      p.rect(x + w * 0.12, iy + ih * 0.18, w * 0.76, ih * 0.3, '#b9cdd2', { sw: 1 });
      p.rect(x + w * 0.2, iy + ih * 0.26, w * 0.6, ih * 0.1, '#f1ece0', { s: false });
      // пробки
      const fx = x + w + mw * 0.16;
      for (const t of [0.3, 0.62]) p.circ(fx, iy + ih * t, Math.min(0.1, (mw * p.iw * 0.13) / p.m), '#efe9dc', { sw: 1 });
    }
    // провода от стояка
    p.line([0.08, 0, 0.08, iy + ih * 0.9, 0.92, iy + ih * 0.9], '#b8433a', 1.5);
    p.line([0.12, 0, 0.12, iy + ih * 0.84, 0.92, iy + ih * 0.84], '#3f6aa8', 1.5);
    // дверца с замком и знаком «молния»
    p.rect(0, 1 - fh, 1, fh, shade(col, -0.08), { bv: 2 });
    p.ellPx(p.X(0.88), p.Y(1 - fh / 2), 2, 2, K.black, { s: false });
    const tx = 0.5, ty = 1 - fh / 2, ts = fh * p.ih * 0.42;
    p.poly([tx, ty - p.fy(ts), tx + p.fx(ts), ty + p.fy(ts * 0.8), tx - p.fx(ts), ty + p.fy(ts * 0.8)], '#e8c23a', { sw: 1 });
  },
  pipes: (p, rnd) => {
    const A = axis(p);
    const n = clamp(Math.round((A.hor ? p.hM : p.wM) / 0.1), 2, 4);
    const kinds = [
      { c: K.steelL, ins: false },
      { c: '#d8d2c2', ins: true }, // в изоляции
      { c: '#7d8a6e', ins: false },
      { c: '#9b6a44', ins: false },
    ];
    const band = 1 / n;
    for (let i = 0; i < n; i++) {
      const k = kinds[i % kinds.length];
      const d = band * (0.55 + ((i * 37) % 3) * 0.1);
      const v0 = i * band + (band - d) / 2;
      A.R(0, v0, 1, d, k.c, { bv: true });
      const dpx = d * A.across;
      if (k.ins) {
        for (let u = 0.03; u < 1; u += Math.max(0.03, 14 / A.along)) A.L([u, v0 + d * 0.1, u, v0 + d * 0.9], shade(k.c, -0.25), 1);
      }
      // муфты
      const joints = Math.max(2, Math.round(A.along / 120));
      for (let j = 0; j < joints; j++) {
        const u = (j + 0.5) / joints;
        A.R(u - 3 / A.along, v0 - d * 0.1, 6 / A.along, d * 1.2, K.steel, { bv: 1.5 });
      }
      // вентиль на трубе
      const u = 0.15 + ((i * 0.37 + rnd() * 0.2) % 0.7);
      const X = A.hor ? p.X(u) : p.X(v0 + d / 2), Y = A.hor ? p.Y(v0 + d / 2) : p.Y(u);
      valve(p, X, Y, Math.min(dpx * 0.9, band * A.across * 0.5));
    }
  },
  boiler_tank: (p) => {
    // патрубки у стены
    p.rect(0.28, 0, 0.08, 0.2, K.copper, { sw: 1 });
    p.rect(0.64, 0, 0.08, 0.2, K.steelD, { sw: 1 });
    p.ell(0.5, 0.52, 0.46, 0.44, '#8e979c', { bv: true });
    p.ell(0.5, 0.52, 0.34, 0.32, 'rgba(0,0,0,0)', { s: shade('#8e979c', -0.3), sw: 1.5 });
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2;
      p.ellPx(p.X(0.5 + Math.cos(a) * 0.4), p.Y(0.52 + Math.sin(a) * 0.38), 1.6, 1.6, K.steelL, { s: false });
    }
    p.ell(0.5, 0.52, 0.14, 0.13, K.steelL, { bv: 2 });
    valve(p, p.X(0.16), p.Y(0.14), p.m * 0.09);
    // манометр спереди
    p.circ(0.5, 0.88, 0.11, K.black, { sw: 1 });
    p.circ(0.5, 0.88, 0.085, '#f4efe3', { s: false });
    const r = p.m * 0.07;
    p.c.strokeStyle = '#c0392b'; p.c.lineWidth = 1.6;
    p.c.beginPath(); p.c.moveTo(p.X(0.5), p.Y(0.88)); p.c.lineTo(p.X(0.5) + r * 0.7, p.Y(0.88) - r * 0.7); p.c.stroke();
  },
  stroller: (p) => {
    const body = '#4d6f8f';
    // колёса (вид сверху — узкие шины) и оси
    for (const [y, h] of [[0.06, 0.22], [0.6, 0.28]] as const) {
      p.line([0.06, y + h / 2, 0.94, y + h / 2], K.steelD, 2);
      p.rect(0.02, y, 0.08, h, '#2b2a2a', { r: 0.2 });
      p.rect(0.9, y, 0.08, h, '#2b2a2a', { r: 0.2 });
    }
    // люлька: полог-фартук сверху, откидной верх с рёбрами — к ручке (передняя сторона)
    p.rect(0.12, 0.04, 0.76, 0.84, body, { bv: true, r: 0.3 });
    p.rect(0.18, 0.1, 0.64, 0.36, shade(body, 0.2), { sw: 1, r: 0.15 });
    for (const [x, y] of [[0.3, 0.2], [0.7, 0.2], [0.3, 0.36], [0.7, 0.36]]) p.circ(x, y, 0.025, K.chrome, { s: false });
    p.rect(0.14, 0.48, 0.72, 0.4, shade(body, -0.2), { bv: 2, r: [0.05, 0.05, 0.3, 0.3] });
    for (const t of [0.58, 0.68, 0.78]) p.line([0.17, t, 0.83, t], shade(body, -0.45), 1.5);
    // ручка
    p.line([0.24, 0.86, 0.24, 0.96, 0.76, 0.96, 0.76, 0.86], INK, Math.max(4, p.m * 0.04) + 2);
    p.line([0.24, 0.86, 0.24, 0.96, 0.76, 0.96, 0.76, 0.86], K.chrome, Math.max(4, p.m * 0.04));
  },
  bicycle: (p) => {
    // «Урал» вдоль длинной стороны; руль — на конце u=1
    const A = axis(p);
    const frame = '#6b1f24';
    const tw = Math.max(0.06, 5 / A.across);
    for (const [u0, u1] of [[0.02, 0.4], [0.6, 0.98]]) {
      A.R(u0, 0.5 - tw / 2, u1 - u0, tw, '#2b2a2a', { r: 0.5, sw: 1 });
      A.L([u0 + 0.04, 0.5, u1 - 0.04, 0.5], frame, Math.max(1.5, A.across * 0.03));
    }
    // багажник над задним колесом
    A.R(0.06, 0.4, 0.2, 0.2, 'rgba(0,0,0,0)', { s: K.steelL, sw: 2 });
    A.L([0.06, 0.5, 0.26, 0.5], K.steelL, 1.5);
    // рама
    const fw = Math.max(3, A.across * 0.07);
    A.L([0.2, 0.5, 0.8, 0.5], INK, fw + 2);
    A.L([0.2, 0.5, 0.8, 0.5], frame, fw);
    // шатуны и педали
    A.L([0.46, 0.24, 0.46, 0.76], K.steelD, Math.max(2, A.across * 0.035));
    A.R(0.43, 0.14, 0.06, 0.12, K.black, { sw: 1 });
    A.R(0.43, 0.74, 0.06, 0.12, K.black, { sw: 1 });
    A.E(0.46, 0.58, 0.06, 0.08, K.steelL, { sw: 1 }); // звезда
    A.R(0.3, 0.56, 0.16, 0.07, frame, { sw: 1 }); // щиток цепи
    // седло
    A.R(0.29, 0.41, 0.12, 0.18, K.black, { bv: 2, r: 0.4 });
    // руль с ручками и фара
    A.L([0.82, 0.5, 0.86, 0.5], K.chrome, fw);
    A.L([0.84, 0.08, 0.86, 0.5, 0.84, 0.92], INK, Math.max(3, A.across * 0.04) + 2);
    A.L([0.84, 0.08, 0.86, 0.5, 0.84, 0.92], K.chrome, Math.max(3, A.across * 0.04));
    A.L([0.84, 0.06, 0.84, 0.18], K.black, Math.max(4, A.across * 0.06));
    A.L([0.84, 0.82, 0.84, 0.94], K.black, Math.max(4, A.across * 0.06));
    A.C(0.95, 0.5, 0.06, K.chrome, { sw: 1 });
  },
  lenin_bust: (p) => {
    // тумба, задрапированная кумачом, с золотой бахромой
    const red = '#a3232b';
    p.rect(0, 0, 1, 1, red, { bv: true, r: 0.03 });
    for (const [x0, y0, x1, y1] of [[0.02, 0.02, 0.2, 0.2], [0.98, 0.02, 0.8, 0.2], [0.02, 0.98, 0.2, 0.8], [0.98, 0.98, 0.8, 0.8]]) {
      p.line([x0, y0, x1, y1], shade(red, -0.35), 2);
    }
    const f = p.fx(4), fy = p.fy(4);
    p.rect(f, fy, 1 - 2 * f, 1 - 2 * fy, 'rgba(0,0,0,0)', { s: K.gold, sw: 1.5 });
    // бронзовый бюст на плите: плечи с лацканами, голова, бородка к передней стороне
    p.rect(0.2, 0.2, 0.6, 0.6, '#5a4a3a', { bv: 2, r: 0.03 });
    const br = '#9a7440';
    p.rect(0.12, 0.36, 0.76, 0.34, br, { bv: true, r: [0.1, 0.1, 0.16, 0.16] });
    p.line([0.3, 0.7, 0.5, 0.52, 0.7, 0.7], shade(br, -0.4), 1.5);
    const R = p.m * 0.17;
    const hx = p.X(0.5), hy = p.Y(0.46);
    p.ellPx(hx - R * 0.98, hy, R * 0.2, R * 0.3, br, { sw: 1 });
    p.ellPx(hx + R * 0.98, hy, R * 0.2, R * 0.3, br, { sw: 1 });
    p.poly([0.5 - p.fx(R * 0.5), 0.46 + p.fy(R * 0.5), 0.5 + p.fx(R * 0.5), 0.46 + p.fy(R * 0.5), 0.5, 0.46 + p.fy(R * 1.6)], shade(br, -0.25), { sw: 1 });
    p.ellPx(hx, hy, R, R * 1.08, br, { bv: true });
    p.ellPx(hx - R * 0.2, hy - R * 0.3, R * 0.45, R * 0.4, shade(br, 0.35), { s: false });
  },
  chess_table: (p) => {
    p.rect(0, 0, 1, 1, K.walnut, { bv: true, r: 0.04 });
    const S = Math.min(p.iw, p.ih) * 0.8;
    const cs = S / 8;
    const x0 = p.X(0.5) - S / 2, y0 = p.Y(0.5) - S / 2;
    const c = p.c;
    c.fillStyle = K.walnutD;
    c.fillRect(x0 - 3, y0 - 3, S + 6, S + 6);
    for (let r = 0; r < 8; r++) for (let q = 0; q < 8; q++) {
      c.fillStyle = (r + q) % 2 ? '#7a4a2c' : '#e3c894';
      c.fillRect(Math.round(x0 + q * cs), Math.round(y0 + r * cs), Math.ceil(cs), Math.ceil(cs));
    }
    c.strokeStyle = INK; c.lineWidth = 1;
    c.strokeRect(x0 - 3, y0 - 3, S + 6, S + 6);
    // фигуры: белые снизу (передняя сторона), чёрные сверху
    const pcs: [number, number, boolean, number][] = [
      [4, 7, true, 0.4], [3, 6, true, 0.3], [5, 6, true, 0.3], [2, 5, true, 0.33], [6, 7, true, 0.35],
      [4, 0, false, 0.4], [3, 1, false, 0.3], [6, 2, false, 0.3], [5, 3, false, 0.33], [1, 0, false, 0.35],
    ];
    for (const [q, r, w, k] of pcs) {
      p.ellPx(x0 + (q + 0.5) * cs, y0 + (r + 0.5) * cs, cs * k, cs * k, w ? '#f3ede0' : '#2b2828', { sw: 1, s: w ? INK : '#8a8580' });
    }
  },
  coat_hooks: (p) => {
    const bh = clamp(p.fy(7), 0.12, 0.3);
    p.rect(0, 0, 1, bh, K.walnut, { bv: 2, r: 0.1 });
    const n = Math.max(2, Math.round(p.wM / 0.25));
    const top = bh * 0.6, ch = 0.98 - top;
    for (let i = 0; i < n; i++) {
      const cx = (i + 0.5) / n, w = 0.8 / n;
      const t = i % 4;
      if (t === 0) coat(p, cx, top, w, ch, '#5d4130');
      else if (t === 1) {
        // шапка-ушанка
        p.ell(cx, top + ch * 0.45, w * 0.42, ch * 0.42, '#6b5040', { bv: true });
        p.ell(cx, top + ch * 0.45, w * 0.26, ch * 0.26, '#8a6a52', { sw: 1 });
        p.ell(cx - w * 0.42, top + ch * 0.6, w * 0.1, ch * 0.24, '#6b5040', { sw: 1 });
        p.ell(cx + w * 0.42, top + ch * 0.6, w * 0.1, ch * 0.24, '#6b5040', { sw: 1 });
      } else if (t === 2) {
        // авоська с апельсинами
        p.ell(cx, top + ch * 0.55, w * 0.4, ch * 0.4, 'rgba(0,0,0,0)', { s: '#6f7a4a', sw: 1.5 });
        const rr = Math.min(w * p.iw, ch * p.ih) * 0.14;
        for (const [dx, dy] of [[-0.15, 0.45], [0.12, 0.5], [-0.02, 0.7]]) {
          p.ellPx(p.X(cx + w * dx), p.Y(top + ch * dy), rr, rr, '#e08a2e', { sw: 1 });
        }
        p.line([cx - w * 0.3, top + ch * 0.3, cx + w * 0.3, top + ch * 0.85], '#6f7a4a', 1);
        p.line([cx + w * 0.3, top + ch * 0.3, cx - w * 0.3, top + ch * 0.85], '#6f7a4a', 1);
      } else {
        // полосатый шарф
        p.rect(cx - w * 0.14, top, w * 0.28, ch * 0.96, '#9a3a3a', { sw: 1, r: 0.05 });
        for (let k = 1; k < 5; k++) p.rect(cx - w * 0.14, top + ch * k * 0.19, w * 0.28, ch * 0.06, '#e8dcc0', { s: false });
      }
    }
    for (let i = 0; i < n; i++) p.circ((i + 0.5) / n, bh * 0.45, 0.07, K.chrome, { sw: 1 });
  },
};

const DRAW: Record<TextureKind, Draw> = {
  sofa: (p) => upholstered(p, K.velourG, K.velourGL, null),
  armchair: (p) => upholstered(p, K.velourB, K.velourBL, 1),
  bed_single: (p) => bed(p, false),
  bed_double: (p) => bed(p, true),

  wardrobe: (p) => {
    const [x, y, w, h] = cabinet(p, { body: K.walnut, doors: Math.max(2, Math.round(p.wM / 0.55)), handle: 'bar', seed: 11 });
    // на шкафу — неизменный чемодан
    const sw = Math.min(w * 0.55, p.mx(0.65));
    suitcase(p, x + w * 0.08, y + h * 0.12, sw, h * 0.72);
  },
  sideboard: (p) => {
    const [x, y, w, h] = cabinet(p, { body: K.cherry, top: K.cherryL, doors: Math.max(2, Math.round(p.wM / 0.5)), glass: true, handle: 'knob', seed: 12 });
    // дорожка и семь слоников по убыванию
    runner(p, x + w * 0.06, y + h * 0.2, w * 0.88, h * 0.6);
    const n = 7, base = Math.min(h * p.ih * 0.26, (w * p.iw * 0.7) / 16);
    let ex = x + w * 0.14;
    for (let i = 0; i < n; i++) {
      const r = base * (1 - i * 0.08);
      const cx = p.X(ex) + r, cy = p.Y(y + h * 0.5);
      p.ellPx(cx, cy, r, r * 0.62, '#8f9296', { sw: 1 });
      p.ellPx(cx - r * 0.9, cy, r * 0.32, r * 0.26, '#8f9296', { sw: 1 });
      ex += p.fx(r * 2 + base * 0.45);
    }
  },
  nightstand: (p) => {
    const [x, y, w, h] = cabinet(p, { body: K.walnut, doors: 1, handle: 'knob', seed: 13 });
    // салфетка и книга
    p.ell(x + w * 0.5, y + h * 0.5, w * 0.38, h * 0.4, '#f1ebdd', { s: '#b8ad96', sw: 1 });
    p.rect(x + w * 0.3, y + h * 0.26, w * 0.34, h * 0.46, '#7a2b2b', { bv: 2, r: 0.03 });
    p.rect(x + w * 0.3, y + h * 0.26, w * 0.07, h * 0.46, '#5a1f1f', { s: false });
  },
  dresser: (p) => {
    const [x, y, w, h] = cabinet(p, { body: K.walnutL, doors: Math.max(2, Math.round(p.wM / 0.45)), handle: 'bar', seed: 14 });
    // дорожка-салфетка и ваза
    runner(p, x + w * 0.1, y + h * 0.28, w * 0.8, h * 0.44);
    const r = Math.min(w * p.iw * 0.1, h * p.ih * 0.3);
    p.ellPx(p.X(x + w * 0.72), p.Y(y + h * 0.5), r, r, '#3d6f8a', { bv: 2 });
    p.ellPx(p.X(x + w * 0.72), p.Y(y + h * 0.5), r * 0.45, r * 0.45, '#223d4c', { s: false });
  },
  tool_cabinet: (p) => {
    const [x, y, w, h] = cabinet(p, { body: K.metalGreen, doors: Math.max(1, Math.round(p.wM / 0.45)), handle: 'bar', grain: false });
    // заклёпки по углам крышки
    const ix = p.fx(5), iy = p.fy(5);
    for (const [ax, ay] of [[x + ix, y + iy], [x + w - ix, y + iy], [x + ix, y + h - iy], [x + w - ix, y + h - iy]]) {
      p.ellPx(p.X(ax), p.Y(ay), 2, 2, K.steelL, { sw: 1 });
    }
    // гаечный ключ на крышке
    const k = Math.max(3, p.m * 0.07);
    const x0 = x + w * 0.22, x1 = x + w * 0.7, yy = y + h * 0.5;
    p.line([x0, yy, x1, yy], K.steelL, k * 0.8, 'butt');
    p.line([x0, yy, x1, yy], INK, 0.8, 'butt');
    for (const ex of [x0, x1]) {
      p.ellPx(p.X(ex), p.Y(yy), k * 1.1, k * 1.1, K.steelL, { sw: 1 });
      p.ellPx(p.X(ex) + (ex === x0 ? -k * 0.6 : k * 0.6), p.Y(yy), k * 0.55, k * 0.45, K.metalGreen, { s: false });
    }
  },
  kitchen_counter: (p) => {
    const [x, y, w, h] = cabinet(p, { body: '#b7ad98', top: '#ddd6c3', front: K.alu, doors: Math.max(1, Math.round(p.wM / 0.5)), handle: 'bar', grain: false });
    // кафельный фартук у стены
    const th = p.fy(Math.max(4, h * p.ih * 0.14));
    const tiles = Math.max(3, Math.round((w * p.iw) / (th * p.ih * 1.6)));
    for (let i = 0; i < tiles; i++) p.rect(x + (i * w) / tiles, y, w / tiles, th, '#f2f4f2', { s: '#9eaaa8', sw: 1 });
    // разделочная доска и эмалированный чайник
    p.rect(x + w * 0.08, y + h * 0.3, w * 0.3, h * 0.55, K.pine, { bv: 2, r: 0.06 });
    p.ellPx(p.X(x + w * 0.23), p.Y(y + h * 0.4), 2.5, 2.5, '#ddd6c3', { sw: 1 });
    const r = Math.min(w * p.iw * 0.13, h * p.ih * 0.3);
    const kx = p.X(x + w * 0.68), ky = p.Y(y + h * 0.58);
    p.c.lineCap = 'round';
    p.c.strokeStyle = INK; p.c.lineWidth = r * 0.28 + 2;
    p.c.beginPath(); p.c.moveTo(kx, ky); p.c.lineTo(kx - r * 1.45, ky - r * 0.3); p.c.stroke(); // носик
    p.c.strokeStyle = '#b8433a'; p.c.lineWidth = r * 0.28;
    p.c.stroke();
    p.ellPx(kx, ky, r, r, '#b8433a', { bv: true });
    p.ellPx(kx, ky, r * 0.4, r * 0.4, '#f1ebdd', { sw: 1 });
    p.line([x + w * 0.68, y + h * 0.58 - p.fy(r * 0.95), x + w * 0.68, y + h * 0.58 + p.fy(r * 0.95)], '#2d2a29', Math.max(1.5, r * 0.15));
  },
  wall_unit: (p) => {
    const n = Math.max(2, Math.round(p.wM / 0.6));
    const tones = [K.walnut, K.walnutL, K.walnut, K.walnutD];
    for (let i = 0; i < n; i++) {
      const glass = n >= 3 && i === Math.floor(n / 2);
      cabinet(p, { body: tones[i % tones.length], doors: i % 2 === 0 ? 2 : 1, glass, handle: glass ? 'knob' : 'bar', seed: 20 + i }, i / n, 0, 1 / n, 1);
    }
  },

  table_rect: (p) => {
    p.rect(0, 0, 1, 1, K.walnutL, { bv: true, r: 0.05 });
    p.grain(0.02, 0.03, 0.96, 0.94, shade(K.walnutL, -0.12), 31);
    // вязаная салфетка
    const rx = Math.min(0.28, p.fx(p.m * 0.32)), ry = Math.min(0.3, p.fy(p.m * 0.3));
    doily(p, 0.5, 0.5, rx, ry);
  },
  table_round: (p) => {
    p.ell(0.5, 0.5, 0.5, 0.5, K.walnutL, { bv: true });
    p.ell(0.5, 0.5, 0.44, 0.44, 'rgba(0,0,0,0)', { s: shade(K.walnutL, -0.25), sw: 1.2 });
    doily(p, 0.5, 0.5, 0.2, 0.2);
  },
  desk: (p) => {
    p.rect(0, 0, 1, 1, K.walnutL, { bv: true, r: 0.03 });
    p.grain(0.02, 0.03, 0.96, 0.94, shade(K.walnutL, -0.12), 41);
    // сукно у переднего края
    p.rect(0.2, 0.4, 0.5, 0.5, '#3f6a4c', { bv: 2, r: 0.03 });
    p.rect(0.28, 0.46, 0.26, 0.36, K.paper, { sw: 1 });
    p.line([0.31, 0.54, 0.5, 0.54], '#9aa0a8', 1);
    p.line([0.31, 0.62, 0.48, 0.62], '#9aa0a8', 1);
    // настольная лампа у дальнего края
    p.circ(0.85, 0.28, 0.2, '#3d6b4a', { bv: true });
    p.circ(0.85, 0.28, 0.07, '#f3dc8a', { sw: 1 });
    // чернильница
    p.circ(0.1, 0.2, 0.07, '#303a60', { sw: 1 });
  },
  chair: (p) => {
    // спинка (гнутая планка) сверху, сиденье снизу
    p.rect(0.08, 0.26, 0.84, 0.72, K.vinyl, { bv: true, r: 0.14 });
    p.rect(0.18, 0.36, 0.64, 0.52, shade(K.vinyl, 0.1), { s: shade(K.vinyl, -0.35), sw: 1, r: 0.1 });
    p.rect(0.0, 0.03, 1, 0.2, K.walnut, { bv: true, r: 0.1 });
    p.rect(0.02, 0.0, 0.12, 0.3, K.walnutD, { bv: 2, r: 0.04 });
    p.rect(0.86, 0.0, 0.12, 0.3, K.walnutD, { bv: 2, r: 0.04 });
  },
  stool: (p) => {
    p.ell(0.5, 0.5, 0.5, 0.5, K.pine, { bv: true });
    p.ell(0.5, 0.5, 0.36, 0.36, 'rgba(0,0,0,0)', { s: shade(K.pine, -0.2), sw: 1.2 });
    p.rect(0.36, 0.45, 0.28, 0.1, '#4a3322', { r: 0.1, sw: 1 });
  },

  fridge: (p) => {
    // решётка конденсатора у стены
    p.rect(0.08, 0, 0.84, 0.1, K.steelD, { sw: 1 });
    for (let i = 1; i < 8; i++) p.line([0.08 + (0.84 * i) / 8, 0.01, 0.08 + (0.84 * i) / 8, 0.09], '#3a4046', 1);
    p.rect(0, 0.07, 1, 0.83, K.cream, { bv: true, r: [0.1, 0.1, 0.3, 0.3] });
    // скруглённая «покатая» крышка ЗИЛа: блик по центру
    p.line([0.2, 0.22, 0.8, 0.22], shade(K.cream, 0.5), Math.max(2, p.m * 0.04));
    // хромированная полоса и знаменитая ручка-рычаг
    p.line([0.06, 0.86, 0.94, 0.86], K.steel, 2);
    p.rect(0.52, 0.84, 0.36, 0.14, K.chrome, { bv: 2, r: 0.08 });
    p.rect(0.15, 0.78, 0.14, 0.05, '#c8a24c', { sw: 1 });
  },
  stove: (p) => {
    enamelBody(p, K.enamel, 0.04);
    p.rect(0, 0, 1, 0.1, K.enamelD, { bv: 2, r: 0.04 });
    const cols = p.wM / p.hM > 1.3 ? 3 : 2;
    const rows = 2;
    const top = 0.14, bot = 0.8;
    const cw = 1 / cols, ch = (bot - top) / rows;
    const R = Math.min(cw * p.iw, ch * p.ih) * 0.36;
    for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
      const cx = p.X((q + 0.5) * cw), cy = p.Y(top + (r + 0.5) * ch);
      const rr = R * (((r + q) % 2) ? 0.85 : 1);
      p.ellPx(cx, cy, rr, rr, K.black, { sw: 1 });
      p.ellPx(cx, cy, rr * 0.55, rr * 0.55, '#595552', { s: false });
      p.c.strokeStyle = '#5b5755'; p.c.lineWidth = Math.max(1.5, rr * 0.12);
      p.c.beginPath();
      p.c.moveTo(cx - rr, cy); p.c.lineTo(cx + rr, cy); p.c.moveTo(cx, cy - rr); p.c.lineTo(cx, cy + rr);
      p.c.stroke();
      p.ellPx(cx, cy, rr * 0.22, rr * 0.22, '#2a2827', { s: false });
    }
    // панель ручек спереди
    p.rect(0, 0.82, 1, 0.18, K.enamelD, { bv: 2, r: [0, 0, 0.04, 0.04] });
    const kn = cols * rows + 1;
    for (let i = 0; i < kn; i++) {
      const x = (i + 0.5) / kn;
      p.circ(x, 0.91, 0.055, K.black, { sw: 1 });
      p.line([x, 0.91, x, 0.91 - p.fy(p.m * 0.05)], '#e8e2d2', 1.5);
    }
  },
  sink_kitchen: (p) => {
    p.rect(0, 0, 1, 1, K.steelL, { bv: true, r: 0.04 });
    const wide = p.wM / p.hM > 1.3;
    const bx = wide ? 0.06 : 0.12, bw = wide ? 0.5 : 0.76;
    p.rect(bx, 0.24, bw, 0.64, K.steel, { bv: true, sunk: true, r: 0.12 });
    p.circ(bx + bw / 2, 0.6, 0.06, '#3f454a', { sw: 1 });
    if (wide) for (let i = 0; i < 6; i++) {
      const x = 0.62 + i * 0.055;
      p.line([x, 0.28, x, 0.84], shade(K.steelL, -0.18), 2);
    }
    // смеситель у стены
    const fx = bx + bw / 2;
    p.rect(fx - 0.12, 0.02, 0.24, 0.1, K.chrome, { bv: 2, r: 0.1 });
    p.line([fx, 0.08, fx, 0.4], K.chrome, Math.max(3, p.m * 0.05));
    p.line([fx, 0.08, fx, 0.4], INK, 0.8);
    p.circ(fx - 0.14, 0.07, 0.05, '#b8433a', { sw: 1 });
    p.circ(fx + 0.14, 0.07, 0.05, '#3f6aa8', { sw: 1 });
  },
  boiler: (p) => {
    // газовая колонка: корпус, дымоход, окошко пламени и ручки спереди
    p.rect(0.04, 0, 0.92, 1, K.enamel, { bv: true, r: 0.1 });
    p.circ(0.2, 0.1, 0.07, K.copper, { sw: 1 });
    p.circ(0.8, 0.1, 0.07, K.copper, { sw: 1 });
    p.circ(0.5, 0.38, 0.26, K.steel, { bv: true });
    p.circ(0.5, 0.38, 0.17, '#3c4247', { sunk: true, bv: 2 });
    p.rect(0.04, 0.74, 0.92, 0.26, K.enamelD, { bv: 2, r: [0, 0, 0.1, 0.1] });
    p.rect(0.4, 0.8, 0.2, 0.12, '#e88a34', { sw: 1, r: 0.05 });
    p.circ(0.2, 0.87, 0.07, K.black, { sw: 1 });
    p.circ(0.8, 0.87, 0.07, K.black, { sw: 1 });
  },
  bathtub: (p) => {
    p.rect(0, 0, 1, 1, K.enamel, { bv: true, r: 0.22 });
    p.rect(0.05, 0.14, 0.9, 0.76, '#dbe7ec', { bv: true, sunk: true, r: [0.25, 0.4, 0.4, 0.25], sw: 1.5 });
    // слив и перелив у торца со смесителем
    p.circ(0.12, 0.52, 0.06, K.steelD, { sw: 1 });
    p.circ(0.075, 0.52, 0.035, K.steel, { sw: 1 });
    // смеситель на стене сверху
    p.rect(0.06, 0.0, 0.22, 0.09, K.chrome, { bv: 2, r: 0.05 });
    p.line([0.17, 0.05, 0.17, 0.3], K.chrome, Math.max(3, p.m * 0.06));
    p.line([0.17, 0.05, 0.17, 0.3], INK, 0.8);
    p.circ(0.08, 0.045, 0.05, '#b8433a', { sw: 1 });
    p.circ(0.26, 0.045, 0.05, '#3f6aa8', { sw: 1 });
  },
  toilet: (p) => {
    // бачок у стены, чаша — к передней грани
    p.rect(0.3, 0.24, 0.4, 0.14, K.enamelD, { sw: 1 });
    p.rect(0.06, 0.0, 0.88, 0.28, K.enamel, { bv: true, r: 0.08 });
    p.circ(0.5, 0.14, 0.09, K.chrome, { sw: 1 });
    p.ell(0.5, 0.65, 0.44, 0.34, K.enamel, { bv: true });
    p.ell(0.5, 0.66, 0.4, 0.3, '#e7dcc0', { bv: 2, sw: 1.5 });
    p.ell(0.5, 0.67, 0.25, 0.21, K.water, { bv: true, sunk: true, sw: 1.5 });
  },
  washbasin: (p) => {
    p.rect(0, 0, 1, 1, K.enamel, { bv: true, r: [0.08, 0.08, 0.5, 0.5] });
    p.ell(0.5, 0.58, 0.36, 0.3, '#dbe7ec', { bv: true, sunk: true, sw: 1.5 });
    p.circ(0.5, 0.62, 0.05, K.steelD, { sw: 1 });
    p.rect(0.32, 0.03, 0.36, 0.13, K.chrome, { bv: 2, r: 0.08 });
    p.line([0.5, 0.1, 0.5, 0.38], K.chrome, Math.max(3, p.m * 0.06));
    p.line([0.5, 0.1, 0.5, 0.38], INK, 0.8);
    p.circ(0.3, 0.09, 0.06, '#b8433a', { sw: 1 });
    p.circ(0.7, 0.09, 0.06, '#3f6aa8', { sw: 1 });
  },
  washing_machine: (p) => {
    enamelBody(p, K.enamel, 0.1);
    // панель управления у стены
    p.rect(0.04, 0.03, 0.92, 0.2, K.enamelD, { bv: 2, r: 0.06 });
    p.circ(0.2, 0.13, 0.07, K.black, { sw: 1 });
    p.circ(0.8, 0.13, 0.07, K.black, { sw: 1 });
    p.rect(0.38, 0.09, 0.24, 0.08, '#6a8fa0', { sw: 1 });
    // крышка бака
    p.circ(0.5, 0.6, 0.33, K.chrome, { bv: true });
    p.circ(0.5, 0.6, 0.26, K.enamel, { bv: true });
    p.rect(0.42, 0.86, 0.16, 0.05, K.steelD, { sw: 1, r: 0.03 });
  },
  rug: (p) => rug(p),
  tv_stand: (p) => {
    cabinet(p, { body: K.walnut, doors: 2, handle: 'knob', seed: 51 });
    // телевизор — трапеция кинескопа, экран к передней грани
    const tw = Math.min(0.62, p.fx(p.ih * 1.2));
    const x0 = 0.5 - tw / 2;
    p.poly([x0 + tw * 0.2, 0.12, x0 + tw * 0.8, 0.12, x0 + tw, 0.7, x0, 0.7], '#4a3b33', { sw: p.lw });
    p.rect(x0, 0.64, tw, 0.1, '#2c2c2e', { bv: 2, r: 0.02 });
    p.rect(x0 + tw * 0.08, 0.67, tw * 0.84, 0.04, '#7d9aa0', { s: false });
    // антенна «рога»
    p.line([0.5, 0.2, 0.5 - tw * 0.55, 0.03], K.chrome, 2);
    p.line([0.5, 0.2, 0.5 + tw * 0.55, 0.03], K.chrome, 2);
    p.circ(0.5, 0.2, 0.05, K.black, { sw: 1 });
  },
  radio: (p) => {
    p.rect(0, 0, 1, 1, K.walnut, { bv: true, r: 0.08 });
    p.rect(0.06, 0.08, 0.88, 0.5, K.walnutL, { s: shade(K.walnut, -0.4), sw: 1, r: 0.05 });
    p.grain(0.06, 0.08, 0.88, 0.5, shade(K.walnutL, -0.13), 61);
    // тканевая решётка громкоговорителя и шкала у передней грани
    p.rect(0.04, 0.62, 0.6, 0.34, '#d8c79c', { bv: 2, r: 0.04 });
    for (let i = 1; i < 8; i++) p.line([0.04 + i * 0.075, 0.66, 0.04 + i * 0.075, 0.92], '#b8a47a', 1);
    p.rect(0.68, 0.64, 0.28, 0.14, '#f2d27a', { sw: 1 });
    p.circ(0.74, 0.88, 0.07, K.black, { sw: 1 });
    p.circ(0.9, 0.88, 0.07, K.black, { sw: 1 });
    p.circ(0.82, 0.71, 0.035, '#5fd07a', { sw: 1 });
  },
  workbench: (p) => {
    p.rect(0, 0, 1, 0.9, K.pine, { bv: true, r: 0.02 });
    const planks = Math.max(3, Math.round(p.hM / 0.15));
    for (let i = 1; i < planks; i++) p.line([0.01, (0.9 * i) / planks, 0.99, (0.9 * i) / planks], shade(K.pine, -0.3), 1.2);
    p.grain(0.01, 0.01, 0.98, 0.88, shade(K.pine, -0.12), 71);
    // уголки стального каркаса
    for (const x of [0, 0.97]) p.rect(x, 0, 0.03, 0.9, K.steelD, { s: false });
    // тиски на передней кромке
    p.rect(0.06, 0.66, 0.2, 0.26, K.steel, { bv: true, r: 0.05 });
    p.rect(0.06, 0.88, 0.2, 0.06, K.steelD, { sw: 1 });
    p.line([0.08, 0.97, 0.24, 0.97], K.steelD, Math.max(2.5, p.m * 0.04));
    p.line([0.16, 0.9, 0.16, 0.97], K.steelD, Math.max(2, p.m * 0.03));
    // молоток
    p.line([0.55, 0.62, 0.78, 0.3], K.walnutL, Math.max(3, p.m * 0.05));
    p.poly([0.74, 0.24, 0.84, 0.32, 0.81, 0.36, 0.71, 0.28], K.steelD, { sw: 1 });
  },
  // люк в полу (крышка погреба): тёмный проём по краю, доски поперёк, две кованые полосы, кольцо-ручка
  hatch: (p) => {
    const wood = '#6a5038';
    p.rect(0, 0, 1, 1, '#1e1812', { r: 0.02 });
    const e = 0.04, n = Math.max(4, Math.round(p.hM / 0.16));
    for (let i = 0; i < n; i++) p.rect(e, e + (i * (1 - 2 * e)) / n, 1 - 2 * e, (1 - 2 * e) / n, shade(wood, i % 2 ? -0.06 : 0.04), { bv: 2, sw: 1 });
    p.grain(e, e, 1 - 2 * e, 1 - 2 * e, shade(wood, -0.18), 53);
    for (const x of [0.22, 0.7]) p.rect(x, e, 0.08, 1 - 2 * e, K.steelD, { bv: 2, sw: 1 });
    p.circ(0.5, 0.5, 0.09, 'rgba(0,0,0,0)', { s: K.steelD, sw: Math.max(2, p.m * 0.025) });
  },
  shelf: (p, rnd) => {
    p.rect(0, 0, 1, 1, K.walnutL, { bv: true, r: 0.05 });
    p.rect(0, 0.84, 1, 0.16, shade(K.walnutL, 0.12), { s: false });
    // банки и книги на полке
    let x = 0.03;
    const cols = ['#7a2b2b', '#2f4466', '#4e6a3a', '#c79b3f', '#6b4b3a'];
    let i = 0;
    while (x < 0.94) {
      if (i % 3 === 2) {
        const r = Math.min(0.3, 0.36 * p.ih / p.m) * p.m;
        const cx = x + p.fx(r);
        if (cx + p.fx(r) > 0.97) break;
        p.ellPx(p.X(cx), p.Y(0.45), r, r, '#b9d0c8', { sw: 1 });
        p.ellPx(p.X(cx), p.Y(0.45), r * 0.7, r * 0.7, '#e2c04a', { s: false });
        x = cx + p.fx(r) + 0.02;
      } else {
        const bw = p.fx(p.ih * (0.1 + rnd() * 0.08));
        if (x + bw > 0.97) break;
        p.rect(x, 0.12, bw, 0.68, cols[i % cols.length], { sw: 1 });
        x += bw + p.fx(1);
      }
      i++;
    }
  },
  coat_rack: (p) => {
    const bh = clamp(p.fy(9), 0.1, 0.25);
    const n = Math.max(2, Math.round(p.wM / 0.28));
    const cols = ['#5d4130', '#646a70', '#3e4f3e', '#a58c66', '#2f3448'];
    p.rect(0, 0, 1, bh, K.walnut, { bv: 2, r: 0.1 });
    // пальто на крючках: плечи, воротник и планка с пуговицами к передней стороне
    for (let i = 0; i < n; i++) {
      const cx = (i + 0.5) / n;
      const col = cols[i % cols.length];
      const cw = Math.min(0.62 / n + 0.06, 0.96), top = bh * 0.6, ch = 0.98 - top;
      p.rect(cx - cw / 2, top, cw, ch, col, { bv: true, r: [0.5, 0.5, 0.25, 0.25] });
      p.ell(cx, top + ch * 0.12, cw * 0.22, ch * 0.16, shade(col, -0.35), { sw: 1 });
      p.line([cx, top + ch * 0.25, cx, top + ch * 0.96], shade(col, -0.4), 1.5, 'butt');
      for (const t of [0.45, 0.7]) p.circ(cx + p.fx(3), top + ch * t, 0.04, shade(col, 0.4), { s: false });
    }
    for (let i = 0; i < n; i++) p.circ((i + 0.5) / n, bh * 0.45, 0.06, K.chrome, { sw: 1 });
  },
  shoe_rack: (p) => {
    p.rect(0, 0, 1, 1, K.walnutL, { bv: true, r: 0.05 });
    for (let i = 1; i < 5; i++) p.rect(0.03, (i * 0.9) / 5 - 0.05, 0.94, 0.08, shade(K.walnutL, -0.25), { s: false });
    const pairs = Math.max(1, Math.round(p.wM / 0.3));
    const cols = ['#2d2a29', '#6b4228', '#7d7d78'];
    const c = p.c;
    // ботинки носками к передней грани: силуэт = пятка + носок (объединение через толстый контур)
    const sw = Math.min(p.mx(0.1), 0.4 / pairs);
    const len = Math.min(p.my(0.28), 0.86);
    for (let i = 0; i < pairs; i++) {
      const cx = (i + 0.5) / pairs;
      const col = cols[i % 3];
      for (const s of [-1, 1]) {
        const x = p.X(cx + s * sw * 0.62), rx = sw * p.iw * 0.5;
        const y0 = p.Y(0.5 - len / 2), y1 = p.Y(0.5 + len / 2), L = y1 - y0;
        const shape = () => {
          c.beginPath();
          c.ellipse(x, y0 + L * 0.24, rx * 0.8, L * 0.24, 0, 0, Math.PI * 2);
          c.ellipse(x, y1 - L * 0.3, rx, L * 0.3, 0, 0, Math.PI * 2);
          c.rect(x - rx * 0.8, y0 + L * 0.24, rx * 1.6, L * 0.46);
        };
        shape(); c.strokeStyle = INK; c.lineWidth = p.lw * 2; c.stroke();
        shape(); c.fillStyle = col; c.fill();
        p.ellPx(x, y0 + L * 0.3, rx * 0.5, L * 0.18, shade(col, -0.45), { s: false });
        p.ellPx(x - rx * 0.3, y1 - L * 0.22, rx * 0.25, L * 0.1, shade(col, 0.25), { s: false });
      }
    }
  },
  piano: (p) => {
    const body = '#3a2420';
    p.rect(0, 0, 1, 0.64, body, { bv: true, r: 0.04 });
    p.line([0.06, 0.12, 0.94, 0.12], shade(body, 0.3), 2);
    p.line([0.3, 0.3, 0.7, 0.3], shade(body, 0.18), 1.5);
    const cw = clamp(p.mx(0.05), 0.03, 0.08);
    const kx = cw, kw = 1 - 2 * cw, ky = 0.6, kh = 0.3;
    p.rect(kx, ky, kw, kh, '#f1ead6', { sw: 1 });
    const nw = clamp(Math.floor((kw * p.iw) / 5), 14, 52);
    const kwp = kw / nw;
    for (let j = 1; j < nw; j++) p.line([kx + j * kwp, ky, kx + j * kwp, ky + kh], '#9d9482', 1, 'butt');
    for (let j = 0; j < nw - 1; j++) {
      if ([0, 1, 3, 4, 5].includes(j % 7)) {
        p.rect(kx + (j + 1) * kwp - kwp * 0.32, ky, kwp * 0.64, kh * 0.6, '#1d1a19', { s: false });
      }
    }
    p.rect(0, 0.5, cw, 0.5, body, { bv: 2, r: 0.03 });
    p.rect(1 - cw, 0.5, cw, 0.5, body, { bv: 2, r: 0.03 });
    p.rect(kx, ky + kh, kw, 1 - ky - kh, shade(body, 0.08), { sw: 1 });
  },
  radiator: (p) => {
    const n = Math.max(3, Math.round(p.wM / 0.09));
    // подводки от стояка
    p.rect(0.0, 0, p.fx(p.m * 0.28), 0.4, K.steelD, { sw: 1 });
    const x0 = p.fx(p.m * 0.14), w = 1 - x0;
    p.rect(x0, 0.3, w, 0.38, K.steelD, { s: false });
    const g = p.fx(1.2);
    for (let i = 0; i < n; i++) {
      p.rect(x0 + (i * w) / n + g, 0.18, w / n - 2 * g, 0.8, K.steelL, { bv: 2, r: 0.3 });
    }
  },
  plant: (p, rnd) => plant(p, rnd),
  boxes: (p, rnd) => {
    const box = (x: number, y: number, w: number, h: number, col: string) => {
      p.rect(x, y, w, h, col, { bv: true, r: 0.02 });
      const hor = w * p.iw >= h * p.ih;
      if (hor) {
        p.line([x + 0.01, y + h / 2, x + w - 0.01, y + h / 2], shade(col, -0.3), 1.2);
        p.rect(x + w * 0.42, y + 0.01, w * 0.16, h - 0.02, '#d9c28e', { s: false });
      } else {
        p.line([x + w / 2, y + 0.01, x + w / 2, y + h - 0.01], shade(col, -0.3), 1.2);
        p.rect(x + 0.01, y + h * 0.42, w - 0.02, h * 0.16, '#d9c28e', { s: false });
      }
    };
    box(0.0, 0.0, 0.58, 0.64, K.cardboard);
    box(0.5, 0.18, 0.5, 0.82, shade(K.cardboard, -0.08));
    box(0.04 + rnd() * 0.02, 0.6, 0.44, 0.4, shade(K.cardboard, 0.08));
  },
  moonshine_still: (p) => {
    // перегонный куб, змеевик в баке с водой, банка-приёмник спереди
    p.ell(0.3, 0.45, 0.28, 0.42, K.copper, { bv: true });
    p.ell(0.3, 0.45, 0.2, 0.3, K.copperL, { s: shade(K.copper, -0.4), sw: 1 });
    p.circ(0.3, 0.45, 0.08, K.copper, { bv: 2 });
    p.ell(0.78, 0.4, 0.21, 0.34, K.steel, { bv: true });
    p.ell(0.78, 0.4, 0.16, 0.27, '#8fb2c0', { sunk: true, bv: 2, sw: 1 });
    for (const k of [0.2, 0.13, 0.06]) p.ell(0.78, 0.4, k * 0.8, k * 1.3, 'rgba(0,0,0,0)', { s: K.copper, sw: 2.5 });
    p.line([0.36, 0.45, 0.62, 0.4], K.copper, Math.max(3, p.m * 0.05));
    p.line([0.78, 0.6, 0.78, 0.86], K.copper, Math.max(2.5, p.m * 0.04));
    p.circ(0.78, 0.88, 0.1, '#cfe3dd', { sw: 1.2 });
    p.circ(0.78, 0.88, 0.065, '#e8eef0', { s: false });
  },
  bottle_crate: (p, rnd) => {
    p.rect(0, 0, 1, 1, '#a8824f', { bv: true, r: 0.04 });
    // гнездо ≈9 см, но не больше ~36 бутылок (крупнее и легче PNG на нетипичных габаритах)
    const cell = Math.max(0.09, Math.sqrt((p.wM * p.hM) / 36));
    const cols = Math.max(2, Math.round(p.wM / cell));
    const rows = Math.max(2, Math.round(p.hM / cell));
    const ix = p.fx(4), iy = p.fy(4);
    p.rect(ix, iy, 1 - 2 * ix, 1 - 2 * iy, '#6b4f30', { sw: 1 });
    const cw = (1 - 2 * ix) / cols, ch = (1 - 2 * iy) / rows;
    const r = Math.min(cw * p.iw, ch * p.ih) * 0.4;
    for (let a = 1; a < cols; a++) p.line([ix + a * cw, iy, ix + a * cw, 1 - iy], '#a8824f', 2, 'butt');
    for (let b = 1; b < rows; b++) p.line([ix, iy + b * ch, 1 - ix, iy + b * ch], '#a8824f', 2, 'butt');
    for (let a = 0; a < cols; a++) for (let b = 0; b < rows; b++) {
      const v = rnd();
      if (v < 0.12) continue; // пустое гнездо
      const glass = v < 0.75 ? K.bottle : K.brownGlass;
      const cx = p.X(ix + (a + 0.5) * cw), cy = p.Y(iy + (b + 0.5) * ch);
      p.ellPx(cx, cy, r, r, glass, { sw: 1 });
      p.ellPx(cx, cy, r * 0.5, r * 0.5, v < 0.4 ? '#d9c37a' : shade(glass, 0.35), { sw: 1 });
    }
  },
  trash: (p) => {
    // ведро без крышки: обод, мусор внутри, дужка откинута к передней стороне
    const c = p.c;
    p.ell(0.5, 0.46, 0.42, 0.42, '#5f7d66', { bv: true });
    p.ell(0.5, 0.46, 0.34, 0.34, '#34332f', { sunk: true, bv: 2, sw: 1 });
    // мусор: газета, консервная банка, очистки
    p.poly([0.24, 0.4, 0.38, 0.22, 0.54, 0.3, 0.48, 0.5, 0.3, 0.52], K.paper, { sw: 1 });
    p.line([0.32, 0.36, 0.46, 0.32], '#9aa0a8', 1);
    p.line([0.33, 0.42, 0.44, 0.39], '#9aa0a8', 1);
    p.ell(0.64, 0.4, 0.1, 0.1, K.steelL, { sw: 1 });
    p.ell(0.64, 0.4, 0.06, 0.06, K.steel, { s: false });
    p.poly([0.4, 0.6, 0.52, 0.54, 0.66, 0.6, 0.58, 0.68, 0.44, 0.68], '#b58a4e', { sw: 1 });
    // дужка откинута к передней стороне
    c.beginPath();
    c.ellipse(p.X(0.5), p.Y(0.5), p.iw * 0.47, p.ih * 0.47, 0, 0.08 * Math.PI, 0.92 * Math.PI);
    c.strokeStyle = INK; c.lineWidth = Math.max(4, p.m * 0.05); c.stroke();
    c.strokeStyle = K.chrome; c.lineWidth = Math.max(2, p.m * 0.05 - 2); c.stroke();
    for (const x of [0.07, 0.93]) p.rect(x - 0.035, 0.5, 0.07, 0.08, K.steelD, { sw: 1 });
  },
  pipe: (p, rnd) => {
    const hor = p.iw >= p.ih;
    // рисуем как горизонтальную; вертикальную — транспонируем координаты
    const R = (x: number, y: number, w: number, h: number, col: string, o: Opt = {}) =>
      hor ? p.rect(x, y, w, h, col, o) : p.rect(y, x, h, w, col, o);
    const along = hor ? p.iw : p.ih;
    R(0, 0.18, 1, 0.64, K.steelL, { bv: true });
    const spots = Math.max(1, Math.round(along / 80));
    for (let i = 0; i < spots; i++) {
      const x = (i + 0.3 + rnd() * 0.4) / spots;
      R(x - 0.04, 0.3, 0.08, 0.3, '#9b6a44', { s: false, r: 0.3 });
    }
    const joints = Math.max(2, Math.round(along / 110) + 1);
    const jw = (Math.max(6, (hor ? p.ih : p.iw) * 0.4)) / along;
    for (let i = 0; i < joints; i++) {
      const x = joints === 1 ? 0.5 : i / (joints - 1) * (1 - jw);
      R(x, 0.04, jw, 0.92, K.steel, { bv: 2, r: 0.1 });
    }
  },
  mattress: (p) => {
    const hor = p.iw >= p.ih;
    p.rect(0, 0, 1, 1, '#e8e2d2', { bv: true, r: 0.08 });
    p.clip(0.01, 0.01, 0.98, 0.98, 0.07, () => {
      const across = hor ? p.ih : p.iw;
      const n = Math.max(4, Math.round(across / 14));
      for (let i = 0; i < n; i++) {
        const t = (i + 0.3) / n;
        const w = 0.3 / n;
        if (hor) p.rect(0, t, 1, w, '#6e7f9c', { s: false });
        else p.rect(t, 0, w, 1, '#6e7f9c', { s: false });
      }
    });
    // пуговицы-стёжки
    for (let a = 1; a < 3; a++) for (let b = 1; b < 5; b++) {
      const u = a / 3, v = b / 5;
      p.circ(hor ? v : u, hor ? u : v, 0.03, '#d6cdb8', { sw: 1 });
    }
    p.rect(0.02, 0.02, 0.96, 0.96, 'rgba(0,0,0,0)', { s: '#8e8672', sw: 1, r: 0.07 });
  },
  sewing_machine: (p) => {
    p.rect(0, 0, 1, 1, K.walnut, { bv: true, r: 0.04 });
    p.grain(0.02, 0.03, 0.96, 0.94, shade(K.walnut, -0.13), 81);
    // станина-платформа и рукав машинки
    p.rect(0.14, 0.26, 0.66, 0.42, '#252322', { bv: true, r: 0.06 });
    p.rect(0.2, 0.44, 0.1, 0.16, K.chrome, { sw: 1 });
    p.rect(0.26, 0.3, 0.5, 0.18, '#333030', { bv: 2, r: 0.2 });
    p.line([0.3, 0.39, 0.7, 0.39], '#c9a24c', 1.5);
    p.circ(0.55, 0.36, 0.05, '#b8433a', { sw: 1 });
    // маховик справа
    p.ell(0.86, 0.38, 0.06, 0.2, K.chrome, { bv: 2 });
    // ткань у передней кромки
    p.poly([0.16, 0.62, 0.38, 0.6, 0.42, 0.95, 0.12, 0.97], '#b85a4a', { sw: 1 });
    p.line([0.2, 0.7, 0.4, 0.69], '#e8d7b0', 1);
  },
  bookshelf: (p, rnd) => {
    // открытый стеллаж в разрезе: задняя стенка сверху, корешки книг к передней грани
    p.rect(0, 0, 1, 1, K.walnut, { bv: true, r: 0.03 });
    const sw = p.fx(Math.max(4, p.ih * 0.08));
    const back = p.fy(Math.max(3, p.ih * 0.12));
    p.rect(sw, back, 1 - 2 * sw, 1 - back - p.fy(3), '#3a2618', { s: false });
    const cols = ['#7a2b2b', '#2f4466', '#4e6a3a', '#b88a3a', '#5a3f5e', '#8a8a80', '#6b4b3a'];
    let x = sw + p.fx(1);
    let i = 0;
    while (true) {
      const bw = p.fx(p.ih * (0.1 + rnd() * 0.1));
      if (x + bw > 1 - sw - p.fx(1)) break;
      const depth = 0.66 + rnd() * 0.16;
      const col = cols[Math.floor(rnd() * cols.length)];
      const y1 = 1 - p.fy(4);
      p.rect(x, y1 - depth, bw, depth, col, { sw: 1 });
      p.rect(x + p.fx(1), y1 - depth + p.fy(2), bw - p.fx(2), p.fy(3), '#efe6cf', { s: false });
      x += bw + (i % 5 === 4 ? p.fx(3) : 0);
      i++;
    }
    p.rect(0, 1 - p.fy(4), 1, p.fy(4), K.walnutL, { s: false });
  },
  cot: (p) => {
    const tube = Math.max(3, p.m * 0.05);
    p.rect(0, 0, 1, 1, 'rgba(0,0,0,0)', { s: K.alu, sw: tube, r: 0.08 });
    p.rect(0, 0, 1, 1, 'rgba(0,0,0,0)', { s: INK, sw: 1, r: 0.08 });
    const ix = p.fx(tube * 3), iy = p.fy(tube * 3);
    p.rect(ix, iy, 1 - 2 * ix, 1 - 2 * iy, K.canvas, { bv: true, r: 0.04 });
    // пружинки
    const hor = p.iw >= p.ih;
    const len = hor ? p.iw : p.ih;
    const n = Math.max(4, Math.round(len / 18));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      if (hor) {
        p.line([t, p.fy(tube / 2), t, iy + p.fy(1)], K.steelD, 1.2);
        p.line([t, 1 - p.fy(tube / 2), t, 1 - iy - p.fy(1)], K.steelD, 1.2);
      } else {
        p.line([p.fx(tube / 2), t, ix + p.fx(1), t], K.steelD, 1.2);
        p.line([1 - p.fx(tube / 2), t, 1 - ix - p.fx(1), t], K.steelD, 1.2);
      }
    }
    // шов-перегиб у изголовья
    if (hor) p.line([0.25, iy, 0.25, 1 - iy], shade(K.canvas, -0.3), 1.5);
    else p.line([ix, 0.25, 1 - ix, 0.25], shade(K.canvas, -0.3), 1.5);
  },
  ...DRAW2,
};

/** Вязаная салфетка: круг с зубчатым краем. */
function doily(p: P, cx: number, cy: number, rx: number, ry: number): void {
  const n = 14;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    p.ellPx(p.X(cx + Math.cos(a) * rx), p.Y(cy + Math.sin(a) * ry), rx * p.iw * 0.2, ry * p.ih * 0.2, '#f4efe3', { sw: 1, s: '#b8ad96' });
  }
  p.ell(cx, cy, rx, ry, '#f4efe3', { s: false });
  p.ell(cx, cy, rx * 0.6, ry * 0.6, 'rgba(0,0,0,0)', { s: '#cfc4ab', sw: 1.2 });
  p.ell(cx, cy, rx * 0.25, ry * 0.25, 'rgba(0,0,0,0)', { s: '#cfc4ab', sw: 1.2 });
}

// ---------------------------------------------------------------- компактный PNG
// canvas.toDataURL отдаёт RGBA и сжимает посредственно (сглаженные края дороги).
// Поэтому сами квантуем в палитру ≤256 цветов и кодируем PNG (color type 3 + tRNS)
// простым deflate: LZ77 с хеш-цепочками + фиксированные коды Хаффмана.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

class BitWriter {
  buf: Uint8Array;
  pos = 0;
  private acc = 0;
  private nb = 0;
  constructor(size: number) { this.buf = new Uint8Array(Math.max(1024, size)); }
  /** Записать n бит значения v, младшими вперёд (как требует deflate). */
  put(v: number, n: number): void {
    this.acc |= v << this.nb;
    this.nb += n;
    while (this.nb >= 8) {
      if (this.pos >= this.buf.length) {
        const nb = new Uint8Array(this.buf.length * 2);
        nb.set(this.buf);
        this.buf = nb;
      }
      this.buf[this.pos++] = this.acc & 255;
      this.acc >>>= 8;
      this.nb -= 8;
    }
  }
  /** Код Хаффмана пишется старшим битом вперёд. */
  putCode(code: number, len: number): void {
    let r = 0;
    for (let i = 0; i < len; i++) { r = (r << 1) | (code & 1); code >>= 1; }
    this.put(r, len);
  }
  finish(): Uint8Array {
    if (this.nb > 0) this.put(0, 8 - this.nb);
    return this.buf.subarray(0, this.pos);
  }
}

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

function putLit(w: BitWriter, v: number): void {
  if (v < 144) w.putCode(0x30 + v, 8);
  else if (v < 256) w.putCode(0x190 + v - 144, 9);
  else if (v < 280) w.putCode(v - 256, 7);
  else w.putCode(0xc0 + v - 280, 8);
}

function deflateFixed(data: Uint8Array): Uint8Array {
  const n = data.length;
  const w = new BitWriter(n >> 2);
  w.put(1, 1); // BFINAL
  w.put(1, 2); // BTYPE = 01, фиксированные коды
  const HS = 1 << 15, WIN = 32768;
  const head = new Int32Array(HS).fill(-1);
  const prev = new Int32Array(WIN).fill(-1);
  const hash = (i: number) => ((data[i] << 10) ^ (data[i + 1] << 5) ^ data[i + 2]) & (HS - 1);
  const insert = (j: number) => {
    if (j + 2 < n) { const h = hash(j); prev[j & (WIN - 1)] = head[h]; head[h] = j; }
  };
  let i = 0;
  while (i < n) {
    let best = 0, dist = 0;
    if (i + 2 < n) {
      const maxLen = Math.min(258, n - i);
      let j = head[hash(i)];
      let chain = 48;
      while (j >= 0 && i - j <= WIN && chain-- > 0) {
        if (data[j + best] === data[i + best]) {
          let l = 0;
          while (l < maxLen && data[j + l] === data[i + l]) l++;
          if (l > best) { best = l; dist = i - j; if (l === maxLen) break; }
        }
        j = prev[j & (WIN - 1)];
      }
    }
    if (best >= 3) {
      let s = LEN_BASE.length - 1;
      while (LEN_BASE[s] > best) s--;
      putLit(w, 257 + s);
      if (LEN_EXTRA[s]) w.put(best - LEN_BASE[s], LEN_EXTRA[s]);
      let d = DIST_BASE.length - 1;
      while (DIST_BASE[d] > dist) d--;
      w.putCode(d, 5);
      if (DIST_EXTRA[d]) w.put(dist - DIST_BASE[d], DIST_EXTRA[d]);
      for (let k = 0; k < best; k++) insert(i + k);
      i += best;
    } else {
      putLit(w, data[i]);
      insert(i);
      i++;
    }
  }
  putLit(w, 256);
  return w.finish();
}

function zlib(data: Uint8Array): Uint8Array {
  const def = deflateFixed(data);
  let a = 1, b = 0;
  for (let i = 0; i < data.length; i++) { a = (a + data[i]) % 65521; b = (b + a) % 65521; }
  const out = new Uint8Array(def.length + 6);
  out[0] = 0x78; out[1] = 0x01;
  out.set(def, 2);
  const ad = ((b << 16) | a) >>> 0;
  out[out.length - 4] = ad >>> 24; out[out.length - 3] = (ad >>> 16) & 255;
  out[out.length - 2] = (ad >>> 8) & 255; out[out.length - 1] = ad & 255;
  return out;
}

/** Квантование RGBA → индексы палитры; шаг постеризации растёт, пока цветов > 256. */
function quantize(d: Uint8ClampedArray, W: number, H: number): { rows: Uint8Array; pal: number[] } {
  for (let sh = 3; ; sh++) {
    const map = new Map<number, number>();
    const keys = new Uint8Array(W * H);
    const sums: number[] = [0, 0, 0, 0, 0];
    let over = false;
    for (let p = 0, i = 0; p < W * H; p++, i += 4) {
      const al = Math.round((d[i + 3] * 4) / 255);
      if (al === 0) { keys[p] = 0; continue; }
      const key = (al << 24) | ((d[i] >> sh) << 16) | ((d[i + 1] >> sh) << 8) | (d[i + 2] >> sh);
      let idx = map.get(key);
      if (idx === undefined) {
        idx = map.size + 1;
        if (idx > 255) { over = true; break; }
        map.set(key, idx);
        sums.push(0, 0, 0, al, 0);
      }
      keys[p] = idx;
      const o = idx * 5;
      sums[o] += d[i]; sums[o + 1] += d[i + 1]; sums[o + 2] += d[i + 2]; sums[o + 4]++;
    }
    if (over && sh < 7) continue;
    const cnt = map.size + 1;
    const pal: number[] = [];
    for (let k = 0; k < cnt; k++) {
      const o = k * 5, c = sums[o + 4] || 1;
      pal.push(Math.round(sums[o] / c), Math.round(sums[o + 1] / c), Math.round(sums[o + 2] / c), k === 0 ? 0 : Math.round((sums[o + 3] * 255) / 4));
    }
    const rows = new Uint8Array(H * (W + 1));
    for (let y = 0; y < H; y++) {
      rows[y * (W + 1)] = 0; // фильтр None — лучший для палитры
      rows.set(keys.subarray(y * W, y * W + W), y * (W + 1) + 1);
    }
    return { rows, pal };
  }
}

function encodePng(d: Uint8ClampedArray, W: number, H: number): string {
  const { rows, pal } = quantize(d, W, H);
  const n = pal.length / 4;
  const plte = new Uint8Array(n * 3), trns = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    plte[k * 3] = pal[k * 4]; plte[k * 3 + 1] = pal[k * 4 + 1]; plte[k * 3 + 2] = pal[k * 4 + 2];
    trns[k] = pal[k * 4 + 3];
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, W); dv.setUint32(4, H);
  ihdr[8] = 8; ihdr[9] = 3; // 8 бит, индексированный цвет
  const parts: Uint8Array[] = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])];
  const chunk = (type: string, body: Uint8Array) => {
    const c = new Uint8Array(body.length + 12);
    const v = new DataView(c.buffer);
    v.setUint32(0, body.length);
    for (let k = 0; k < 4; k++) c[4 + k] = type.charCodeAt(k);
    c.set(body, 8);
    v.setUint32(8 + body.length, crc32(c.subarray(4, 8 + body.length)));
    parts.push(c);
  };
  chunk('IHDR', ihdr);
  chunk('PLTE', plte);
  chunk('tRNS', trns);
  chunk('IDAT', zlib(rows));
  chunk('IEND', new Uint8Array(0));
  let s = '';
  for (const part of parts) {
    for (let i = 0; i < part.length; i += 0x2000) s += String.fromCharCode.apply(null, Array.from(part.subarray(i, i + 0x2000)));
  }
  return 'data:image/png;base64,' + btoa(s);
}

// ---------------------------------------------------------------- публичный API

const cache = new Map<string, string>();

/** PNG data:URI вида сверху с прозрачностью; длинная сторона 256 px; пропорции = wM:hM.
 *  null, если нет document (тесты в node). */
export function makeTexture(kind: TextureKind, wM: number, hM: number): string | null {
  if (typeof document === 'undefined') return null;
  const w = wM > 0 && isFinite(wM) ? wM : 1;
  const h = hM > 0 && isFinite(hM) ? hM : 1;
  let W: number, H: number;
  if (w >= h) { W = 256; H = Math.max(16, Math.round((256 * h) / w)); }
  else { H = 256; W = Math.max(16, Math.round((256 * w) / h)); }
  // к ключу добавлена ширина в см: число дверок/секций зависит от реального габарита
  const key = `${kind}:${W}x${H}:${Math.round(w * 100)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const draw = DRAW[kind];
  if (!draw) return null;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  draw(new P(ctx, W, H, w, h), makeRng(hashStr(kind)));
  let url: string;
  try {
    url = encodePng(ctx.getImageData(0, 0, W, H).data, W, H);
  } catch {
    url = cv.toDataURL('image/png'); // запасной путь
  }
  cache.set(key, url);
  return url;
}
