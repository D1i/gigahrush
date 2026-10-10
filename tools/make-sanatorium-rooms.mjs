// Модели биома «Санаторий»: мебель и предметы помещений (палаты, процедурные, столовая, комнаты в ремонте) — из
// примитивов; узнаваемые поверхности (кафель, «мраморная» плитка ванны, панно, надпись светового короба, ковёр,
// полированный шпон) — текстурами, нарисованными здесь же (растр в памяти или SVG через sharp → WebP в glb):
//
//  • src/view3d/assets/sanatorium_rooms.glb — узел на предмет, имя узла = id prop проекта (src/data/props.ts,
//    блок «sanatorium: мебель», p_san_*). Архитектура, коридор, вестибюль, бассейн — другой набор
//    (tools/make-sanatorium-props.mjs → sanatorium_props.glb).
//  • Оси узла — как у болванки мебели (src/blockout/babylon.ts): ширина w — вдоль X, глубина (h плана) — вдоль Z,
//    центр габарита на плане — в начале координат, перед — −Z, стена — +Z (z = +глубина/2); низ — пол (y = 0).
//    Настенное (кафельная стена, панно, трубы с манометром, световой короб, моток провода, прислонённая лопата) —
//    высоты от пола, зад прижат к стене. Подвесное (провод с потолка) — верх в y = 0 (extras.ceil).
//  • Координаты в коде — как в игре (Babylon, левая система): смотришь на предмет спереди — +X справа. Загрузчик glTF
//    в Babylon зеркалит X (x → −x), поэтому при записи x → −x (с обратным обходом) — в игре выходит как здесь; UV при
//    этом не меняются (надпись и панно читаются слева направо).
//  • Материалы — по имени общие для всех наборов (src/view3d/propModels.ts кэширует по имени), поэтому префикс
//    san_rm_ (у sanatorium_props.glb — свои san_*). Текстурные материалы: цвет в игре — только текстура (PropModels
//    ставит diffuseColor белым). Светится один: san_rm_slogan_glow — лицо светового короба (emissive × текстура
//    надписи: в StandardMaterial с disableLighting цвет = emissive · текстура).
//  • Мебель на ножках (кровати, кушетка, столы) — с просветом под укрытие (src/blockout/core.ts, PROP_COVER):
//    кровать и кушетка — низ царги/покрывала ≥ 0.34 м (BED_CLEAR_M 0.3), столы — низ царги/скатерти ≥ 0.63 м
//    (TABLE_CLEAR_M 0.62).
//  • Обход граней выбирается по нормали (tri), после записи — сверка: узлы, габариты против таблицы EXPECT.
//  • Посмотреть: node tmp/sanatorium-wip/propsb/shots.mjs → tmp/sanatorium-wip/props-b-sheet.png.
//
//   node tools/make-sanatorium-rooms.mjs
import { Document, NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, quantize, textureCompress, weld } from '@gltf-transform/functions';
import sharp from 'sharp';
import { mkdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../src/view3d/assets/sanatorium_rooms.glb', import.meta.url));
mkdirSync(fileURLToPath(new URL('../src/view3d/assets/', import.meta.url)), { recursive: true });

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene('sanatorium_rooms');
// сцена по умолчанию: без неё загрузчик Babylon сцену не берёт (узлов нет)
doc.getRoot().setDefaultScene(scene);

// ───────── векторы ─────────
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const smooth = (a, b, t) => {
  const x = clamp01((t - a) / (b - a));
  return x * x * (3 - 2 * x);
};
const PI = Math.PI;
const DEG = PI / 180;
/** Базис вращения вокруг оси: (U, A, W) — правая тройка, как (X, Y, Z). */
const BASIS = {
  y: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  z: [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
  x: [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
};
/** Детерминированный «случай» (мусор, штукатурка, витки провода). */
let seed = 23;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const rr = (a, b) => a + (b - a) * rnd();

// ───────── повороты и переносы (3 × 3 по строкам + сдвиг) ─────────
const rot = (axis, a) => {
  const c = Math.cos(a), s = Math.sin(a);
  if (axis === 'x') return [1, 0, 0, 0, c, -s, 0, s, c];
  if (axis === 'y') return [c, 0, s, 0, 1, 0, -s, 0, c];
  return [c, -s, 0, s, c, 0, 0, 0, 1];
};
const mm3 = (A, B) => {
  const o = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c] += A[r * 3 + k] * B[k * 3 + c];
  return o;
};
const mv = (R, p) => [R[0] * p[0] + R[1] * p[1] + R[2] * p[2], R[3] * p[0] + R[4] * p[1] + R[5] * p[2], R[6] * p[0] + R[7] * p[1] + R[8] * p[2]];
const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
/** Перенос t после поворотов (применяются справа налево: последний в списке — первым). */
const TR = (t, ...rots) => ({ R: rots.reduce((R, [ax, a]) => mm3(R, rot(ax, a)), I3), t });

// ═════════════════════════ текстуры ═════════════════════════
// Растр в памяти (RGB 0…1) → PNG через sharp; textureCompress в конце переводит в WebP. Повторяющиеся (кафель,
// мрамор, дно ванны, шпон) — бесшовные: шум на периодической решётке, сетки кратны картинке.

const hexf = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16) / 255);
const mixc = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const scl = (a, k) => [a[0] * k, a[1] * k, a[2] * k];

function hash2(i, j, s) {
  let h = (i * 374761393 + j * 668265263 + s * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
/** Value-noise, период px × py клеток. */
function vnoise(x, y, px, py, s) {
  const i0 = Math.floor(x), j0 = Math.floor(y), fx = x - i0, fy = y - j0;
  const w = (t) => t * t * (3 - 2 * t);
  const g = (i, j) => hash2(((i % px) + px) % px, ((j % py) + py) % py, s);
  return lerp(lerp(g(i0, j0), g(i0 + 1, j0), w(fx)), lerp(g(i0, j0 + 1), g(i0 + 1, j0 + 1), w(fx)), w(fy));
}
/** Фрактальный шум по (u, v) ∈ [0, 1): бесшовен по обеим осям; cx × cy — клеток у первой октавы. */
function fbm(u, v, cx, cy, oct, s) {
  let sum = 0, amp = 0.5, tot = 0;
  for (let o = 0; o < oct; o++) {
    const kx = cx * 2 ** o, ky = cy * 2 ** o;
    sum += amp * vnoise(u * kx, v * ky, kx, ky, s + o * 17);
    tot += amp;
    amp *= 0.5;
  }
  return sum / tot;
}

class Img {
  constructor(w, h, bg = [1, 1, 1]) {
    this.w = w;
    this.h = h;
    this.d = new Float32Array(w * h * 3);
    for (let k = 0; k < w * h; k++) this.d.set(bg, 3 * k);
  }
  static fromRaw(data, w, h, ch) {
    const im = new Img(w, h);
    for (let k = 0; k < w * h; k++) for (let c = 0; c < 3; c++) im.d[3 * k + c] = data[ch * k + c] / 255;
    return im;
  }
  get(x, y) {
    x = ((Math.round(x) % this.w) + this.w) % this.w;
    y = ((Math.round(y) % this.h) + this.h) % this.h;
    const k = 3 * (y * this.w + x);
    return [this.d[k], this.d[k + 1], this.d[k + 2]];
  }
  /** Пиксель с переносом через край (бесшовность), a — непрозрачность. */
  set(x, y, c, a = 1) {
    x = ((Math.round(x) % this.w) + this.w) % this.w;
    y = ((Math.round(y) % this.h) + this.h) % this.h;
    const k = 3 * (y * this.w + x);
    for (let i = 0; i < 3; i++) this.d[k + i] = lerp(this.d[k + i], c[i], a);
  }
  /** Каждый пиксель: fn(x, y, цвет) → новый цвет. */
  map(fn) {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const k = 3 * (y * this.w + x);
        const c = fn(x, y, [this.d[k], this.d[k + 1], this.d[k + 2]]);
        this.d[k] = c[0];
        this.d[k + 1] = c[1];
        this.d[k + 2] = c[2];
      }
    }
  }
  /** Подтёк: сверху (x, y) вниз на len пикселей, ширина w, цвет c; густой вверху, сходит на нет. */
  streak(x, y, len, w, c, a0 = 0.7) {
    for (let k = 0; k < len; k++) {
      const t = k / len, ww = w * (1 - 0.6 * t) * (0.8 + 0.4 * Math.sin(k * 0.21 + x));
      const xc = x + Math.sin(k * 0.05 + y) * 1.5;
      for (let i = -Math.ceil(ww); i <= Math.ceil(ww); i++) {
        const e = 1 - Math.abs(i) / (ww + 0.5);
        if (e > 0) this.set(xc + i, y + k, c, a0 * e * (1 - t) ** 1.4);
      }
    }
  }
  async png() {
    const u8 = new Uint8Array(this.w * this.h * 3);
    for (let k = 0; k < u8.length; k++) u8[k] = Math.max(0, Math.min(255, Math.round(this.d[k] * 255)));
    return sharp(Buffer.from(u8.buffer), { raw: { width: this.w, height: this.h, channels: 3 } }).png().toBuffer();
  }
}
async function svgImg(svg) {
  const { data, info } = await sharp(Buffer.from(svg)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return Img.fromRaw(data, info.width, info.height, info.channels);
}

/** Кафельная сетка поверх картинки: шаг s пикселей, шов g, лёгкий разброс тона плиток, фаска-тень снизу-справа. */
function tileGrid(im, s, g, grout, o = {}) {
  const jit = o.jit ?? 0.04, sd = o.seed ?? 1;
  im.map((x, y, c) => {
    const i = Math.floor(x / s), j = Math.floor(y / s), fx = x - i * s, fy = y - j * s;
    if (fx < g || fy < g) return grout;
    const k = 1 + jit * (hash2(i, j, sd) * 2 - 1);
    let cc = scl(c, k);
    // фаска: светлее у верхнего-левого края, темнее у нижнего-правого
    if (fx < g + 2 || fy < g + 2) cc = mixc(cc, [1, 1, 1], 0.18);
    else if (fx > s - 3 || fy > s - 3) cc = scl(cc, 0.9);
    // блик глазури — пятно в верхней трети плитки
    const hx = (fx - s * 0.35) / s, hy = (fy - s * 0.3) / s;
    cc = mixc(cc, [1, 1, 1], (o.gloss ?? 0.08) * Math.max(0, 1 - (hx * hx + hy * hy) * 9));
    return cc;
  });
}

async function makeTextures() {
  const T = {};
  // ── белый кафель 150 × 150 (повтор 0.6 м = 4 × 4 плитки, 256 px): бортик и стенки ванны, кромки стены ──
  {
    const im = new Img(256, 256, hexf('#e9ebe5'));
    im.map((x, y, c) => scl(mixc(c, hexf('#d8d3c2'), fbm(x / 256, y / 256, 4, 4, 3, 5) * 0.5), 1 + 0.03 * (fbm(x / 256, y / 256, 16, 16, 2, 9) - 0.5)));
    tileGrid(im, 64, 2, hexf('#a8a496'), { seed: 3, gloss: 0.1 });
    // ржавые подтёки (переносятся по Y — бесшовно) и бурые пятна
    for (const [x, y, l, w] of [[40, 10, 150, 4], [150, 200, 120, 3], [205, 90, 90, 5], [100, 150, 60, 2]]) im.streak(x, y, l, w, hexf('#8a5a2c'), 0.55);
    im.map((x, y, c) => mixc(c, hexf('#9c7a4e'), 0.35 * smooth(0.62, 0.8, fbm(x / 256, y / 256, 3, 3, 3, 31))));
    T.tile = doc.createTexture('san_rm_tile').setImage(await im.png()).setMimeType('image/png');
  }
  // ── кафель ванны (8 × 6 плиток = 1.2 × 0.9 м, 512 × 384 px; по горизонтали — повтор, по вертикали — на всю высоту
  //    борта): верх — бортик в бурых разводах, от него вниз — ржавые потёки, у пола — грязь ──
  {
    const W = 512, H = 384;
    const im = new Img(W, H, hexf('#e8e9e2'));
    im.map((x, y, c) => {
      const u = x / W, v = y / H;
      let cc = mixc(c, hexf('#d6cfb9'), 0.55 * fbm(u, v, 4, 3, 3, 111));
      cc = mixc(cc, hexf('#8f6b44'), 0.75 * smooth(0.5, 0.72, fbm(u, v, 5, 3, 4, 113)) * (1 - smooth(0.05, 0.4, v)));
      cc = mixc(cc, hexf('#9a8a6e'), 0.5 * smooth(0.7, 1, v) * fbm(u, v, 10, 6, 3, 117));
      return cc;
    });
    tileGrid(im, 64, 2, hexf('#a49e8e'), { seed: 19, gloss: 0.1 });
    for (let k = 0; k < 22; k++) im.streak(rr(0, W), rr(0, 20), rr(60, 300), rr(2, 6), hexf(rnd() < 0.5 ? '#7e4a22' : '#6b4526'), rr(0.45, 0.8));
    T.tileBath = doc.createTexture('san_rm_tile_bath').setImage(await im.png()).setMimeType('image/png');
  }
  // ── кафельная стена 3.0 × 2.4 (20 × 16 плиток, 960 × 768 px — картинка на всю стену, не повтор): белая глазурь,
  //    рыжие потёки сверху (из-под реек), грязь у пола, несколько отбитых плиток, трещины ──
  {
    const W = 960, H = 768, S = 48;
    const im = new Img(W, H, hexf('#eceee9'));
    im.map((x, y, c) => {
      const n = fbm(x / W, y / H, 5, 4, 4, 41);
      let cc = mixc(c, hexf('#dcd6c4'), 0.6 * n);
      cc = mixc(cc, hexf('#a99d84'), 0.45 * smooth(0.55, 1, y / H) * fbm(x / W, y / H, 12, 6, 3, 43));
      return cc;
    });
    tileGrid(im, S, 2, hexf('#a9a598'), { seed: 7, gloss: 0.12 });
    for (let k = 0; k < 26; k++) {
      const x = rr(10, W - 10), y = rr(0, 60), len = rr(80, 520);
      im.streak(x, y, len, rr(2, 6), hexf(rnd() < 0.6 ? '#8a5428' : '#6e4a2a'), rr(0.35, 0.7));
    }
    // потёки ниже труб (справа) — гуще
    for (let k = 0; k < 7; k++) im.streak(rr(760, 900), rr(380, 520), rr(150, 260), rr(3, 7), hexf('#7a4a22'), 0.7);
    // отбитые плитки: серый цемент с бороздами
    for (const [i, j] of [[2, 13], [3, 13], [17, 2], [11, 15], [12, 15], [6, 9]]) {
      for (let y = j * S + 2; y < (j + 1) * S; y++) {
        for (let x = i * S + 2; x < (i + 1) * S; x++) {
          const n = fbm(x / W, y / H, 40, 32, 2, 51);
          im.set(x, y, mixc(hexf('#8d877b'), hexf('#6f6a60'), n), 1);
          if ((x + y * 0.3) % 9 < 1) im.set(x, y, hexf('#5f5a52'), 0.5);
        }
      }
    }
    // трещины — ломаные тёмные линии
    for (let k = 0; k < 9; k++) {
      let x = rr(0, W), y = rr(0, H), a = rr(0, 2 * PI);
      for (let s = 0; s < rr(60, 180); s++) {
        a += rr(-0.35, 0.35);
        x += Math.cos(a);
        y += Math.sin(a);
        im.set(x, y, hexf('#55524c'), 0.75);
      }
    }
    T.tileWall = doc.createTexture('san_rm_tile_wall').setImage(await im.png()).setMimeType('image/png');
  }
  // ── «мраморная» плитка ванны 300 × 300 (повтор 0.6 м = 2 × 2, 256 px): чёрная с белыми рваными пятнами, как на
  //    фото водолечебницы ──
  {
    const im = new Img(256, 256);
    const dark = hexf('#1b1d20'), grey = hexf('#5d6166'), white = hexf('#d9dbd9');
    im.map((x, y) => {
      const i = Math.floor(x / 128), j = Math.floor(y / 128);
      const u = x / 256, v = y / 256, sd = 100 + i * 7 + j * 13;
      // рваные края пятен: крупный шум + мелкий
      const n = fbm(u, v, 8, 8, 5, sd) + 0.22 * (fbm(u, v, 48, 48, 2, sd + 3) - 0.5);
      const vein = Math.abs(fbm(u, v, 4, 4, 4, sd + 50) - 0.5);
      let c = mixc(dark, grey, smooth(0.4, 0.52, n) * 0.7);
      c = mixc(c, white, smooth(0.5, 0.56, n));
      c = mixc(c, white, 0.8 * (1 - smooth(0.0, 0.02, vein)));
      return mixc(c, dark, 0.3 * smooth(0.55, 0.8, fbm(u, v, 24, 24, 2, sd + 9)));
    });
    tileGrid(im, 128, 2, hexf('#8d8b85'), { seed: 11, jit: 0.02, gloss: 0.12 });
    T.marble = doc.createTexture('san_rm_marble').setImage(await im.png()).setMimeType('image/png');
  }
  // ── дно ванны: бурая плитка 300 × 300 с осадком и пылью (повтор 0.6 м) ──
  {
    const im = new Img(256, 256, hexf('#4c4239'));
    im.map((x, y, c) => {
      const u = x / 256, v = y / 256;
      let cc = mixc(c, hexf('#2a241f'), 0.8 * smooth(0.5, 0.7, fbm(u, v, 3, 3, 4, 61)));
      cc = mixc(cc, hexf('#8a8173'), 0.6 * smooth(0.6, 0.78, fbm(u, v, 5, 5, 3, 67)));
      return scl(cc, 0.92 + 0.16 * fbm(u, v, 32, 32, 2, 69));
    });
    tileGrid(im, 128, 2, hexf('#2e2924'), { seed: 13, jit: 0.05, gloss: 0.03 });
    T.bathFloor = doc.createTexture('san_rm_bath_floor').setImage(await im.png()).setMimeType('image/png');
  }
  // ── полированный шпон (повтор 0.8 м, 256 px): красно-бурый орех, волокна вертикально (по U), лаковый блеск ──
  {
    const im = new Img(256, 256);
    const a = hexf('#7a4126'), b = hexf('#a8673c'), c2 = hexf('#5a2c18');
    im.map((x, y) => {
      const u = x / 256, v = y / 256;
      const warp = fbm(u, v, 2, 1, 3, 71) * 1.6;
      const g = 0.5 + 0.5 * Math.sin(2 * PI * (u * 5 + warp));
      const fine = 0.5 + 0.5 * Math.sin(2 * PI * (u * 47 + warp * 3));
      let c = mixc(a, b, 0.25 + 0.3 * g);
      c = mixc(c, c2, 0.15 * fine * fbm(u, v, 8, 2, 2, 73));
      return scl(c, 0.94 + 0.12 * fbm(u, v, 4, 16, 2, 79));
    });
    T.wood = doc.createTexture('san_rm_wood').setImage(await im.png()).setMimeType('image/png');
  }
  // ── панно «озеро и деревья» (11 × 7 плиток 150 мм = 1.65 × 1.05 м, 704 × 448 px): небо, дальний лес, песчаный
  //    обрыв справа, озеро с отражением, берег с травой, дерево слева и ветви сверху справа; сверху — кафельная
  //    сетка, разброс глазури, ржавые пятна ──
  {
    const W = 704, H = 448;
    let blobs = '';
    const cluster = (cx, cy, rx, ry, n, cols, r0, r1) => {
      for (let k = 0; k < n; k++) {
        const a = rr(0, 2 * PI), d = Math.sqrt(rnd());
        blobs += `<ellipse cx="${(cx + Math.cos(a) * d * rx).toFixed(1)}" cy="${(cy + Math.sin(a) * d * ry).toFixed(1)}" rx="${rr(r0, r1).toFixed(1)}" ry="${rr(r0 * 0.7, r1 * 0.8).toFixed(1)}" fill="${cols[k % cols.length]}" opacity="${rr(0.75, 1).toFixed(2)}"/>`;
      }
    };
    const leaves = ['#2f4a2c', '#3d5d36', '#4d6f3f', '#5f7f48', '#28402a'];
    cluster(95, 90, 110, 90, 140, leaves, 10, 26);
    cluster(30, 220, 50, 70, 40, leaves, 8, 20);
    cluster(640, 25, 110, 45, 90, leaves, 8, 20);
    let grass = '';
    for (let k = 0; k < 260; k++) {
      const x = rr(0, W), y = rr(350, H), h = rr(8, 22);
      grass += `<path d="M${x.toFixed(1)} ${y.toFixed(1)} q ${rr(-3, 3).toFixed(1)} ${(-h / 2).toFixed(1)} ${rr(-6, 6).toFixed(1)} ${(-h).toFixed(1)}" stroke="${['#4c6a34', '#6f8c45', '#3b5428', '#8a9a55'][k % 4]}" stroke-width="${rr(1.2, 2.5).toFixed(1)}" fill="none"/>`;
    }
    let forest = 'M0 238';
    for (let x = 0; x <= W; x += 8) forest += ` L${x} ${(222 - 10 * Math.abs(Math.sin(x * 0.07)) - 6 * Math.abs(Math.sin(x * 0.19 + 1)) - (x < 300 ? 0 : (x - 300) * 0.02)).toFixed(1)}`;
    forest += ` L${W} 252 L0 252 Z`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
<defs>
 <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#86a9c8"/><stop offset="0.6" stop-color="#cbdbe2"/><stop offset="1" stop-color="#e9ece2"/></linearGradient>
 <linearGradient id="wat" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4f7890"/><stop offset="0.5" stop-color="#7097a9"/><stop offset="1" stop-color="#9dbcc4"/></linearGradient>
 <linearGradient id="sand" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#dcc79a"/><stop offset="1" stop-color="#b89a63"/></linearGradient>
 <filter id="b1"><feGaussianBlur stdDeviation="1.2"/></filter>
 <filter id="b3"><feGaussianBlur stdDeviation="3"/></filter>
 <filter id="b8"><feGaussianBlur stdDeviation="9"/></filter>
</defs>
<rect width="${W}" height="${H}" fill="url(#sky)"/>
<g filter="url(#b8)" fill="#ffffff" opacity="0.75"><ellipse cx="300" cy="70" rx="120" ry="22"/><ellipse cx="420" cy="110" rx="90" ry="16"/><ellipse cx="230" cy="140" rx="70" ry="12"/></g>
<path d="${forest}" fill="#58724f" filter="url(#b1)"/>
<path d="M0 244 L${W} 246 L${W} 254 L0 254 Z" fill="#46603f" filter="url(#b1)"/>
<rect x="0" y="252" width="${W}" height="120" fill="url(#wat)"/>
<path d="${forest}" fill="#3f5a4c" opacity="0.45" filter="url(#b3)" transform="matrix(1 0 0 -0.6 0 395)"/>
<g fill="#e6eeec" opacity="0.55" filter="url(#b1)"><ellipse cx="260" cy="300" rx="90" ry="2"/><ellipse cx="420" cy="322" rx="120" ry="2.5"/><ellipse cx="180" cy="342" rx="70" ry="2"/><ellipse cx="350" cy="283" rx="60" ry="1.5"/></g>
<path d="M${W} 150 C 650 165 610 190 570 214 C 540 232 505 250 470 262 L ${W} 266 Z" fill="url(#sand)"/>
<path d="M${W} 150 C 650 165 610 190 570 214 L 585 220 C 625 196 660 176 ${W} 168 Z" fill="#6d8a4f"/>
<path d="M 560 238 C 600 230 640 236 ${W} 232 L ${W} 266 L 470 262 Z" fill="#a78a57" opacity="0.6"/>
<path d="M0 360 C 120 345 260 352 380 362 C 500 372 600 356 ${W} 350 L ${W} ${H} L 0 ${H} Z" fill="#6a8644"/>
<path d="M0 395 C 150 385 300 400 ${W} 392 L ${W} ${H} L 0 ${H} Z" fill="#587538"/>
${grass}
<path d="M 92 ${H} C 88 360 70 260 80 120 L 92 120 C 88 250 104 350 112 ${H} Z" fill="#4a3a2a"/>
<path d="M 84 200 C 120 170 150 160 190 150" stroke="#4a3a2a" stroke-width="5" fill="none"/>
<path d="M 82 160 C 60 140 40 130 15 128" stroke="#4a3a2a" stroke-width="4" fill="none"/>
<path d="M ${W} 30 C 650 40 610 55 560 80" stroke="#3e3226" stroke-width="4" fill="none"/>
${blobs}
</svg>`;
    const im = await svgImg(svg);
    // кафель: 64 px на плитку, светлый шов, разброс тона, редкие сколы и ржавчина внизу
    tileGrid(im, 64, 2, hexf('#c9c6bb'), { seed: 17, jit: 0.05, gloss: 0.1 });
    im.map((x, y, c) => mixc(c, hexf('#8f6a40'), 0.5 * smooth(0.64, 0.8, fbm(x / W, y / H, 6, 4, 3, 91)) * smooth(0.6, 1, y / H)));
    for (let k = 0; k < 5; k++) im.streak(rr(20, W - 20), rr(H * 0.55, H * 0.8), rr(40, 100), rr(2, 4), hexf('#7d5230'), 0.5);
    T.mural = doc.createTexture('san_rm_mural').setImage(await im.png()).setMimeType('image/png');
  }
  // ── световой короб: «…С верой, надеждой, любовью…» тёмно-красным курсивом на молочном рассеивателе (1024 × 192 =
  //    1.6 × 0.3 м), к краям — желтизна и тени мёртвых мух внутри ──
  {
    const W = 1024, H = 192;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
<defs><radialGradient id="g" cx="0.5" cy="0.5" r="0.62"><stop offset="0" stop-color="#ffffff"/><stop offset="0.8" stop-color="#f3f2ee"/><stop offset="1" stop-color="#dcdad2"/></radialGradient></defs>
<rect width="${W}" height="${H}" fill="url(#g)"/>
<text x="${W / 2}" y="117" font-family="Georgia, 'Times New Roman', serif" font-style="italic" font-size="58" fill="#8c1c16" text-anchor="middle">…С верой, надеждой, любовью…</text>
</svg>`;
    const im = await svgImg(svg);
    for (let k = 0; k < 30; k++) {
      const x = rnd() < 0.5 ? rr(20, 160) : rr(W - 170, W - 20), y = rr(30, H - 30), r = rr(1.5, 4);
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) im.set(x + dx, y + dy, hexf('#6b5a40'), 0.5);
    }
    im.map((x, y, c) => mixc(c, hexf('#cfc6b0'), 0.18 * smooth(0.55, 0.8, fbm(x / W, y / H, 8, 2, 3, 97))));
    T.slogan = doc.createTexture('san_rm_slogan').setImage(await im.png()).setMimeType('image/png');
  }
  // ── ковёр 2 × 3 м (384 × 576 px): бордовое поле с решёткой ромбов и центральным медальоном, кайма — тёмно-зелёная
  //    с бежевыми зубцами и ромбами, бежевые бордюрчики; потёртости ──
  {
    const W = 384, H = 576;
    let el = '';
    const dia = (cx, cy, rx, ry, fill, extra = '') => (el += `<polygon points="${cx},${cy - ry} ${cx + rx},${cy} ${cx},${cy + ry} ${cx - rx},${cy}" fill="${fill}" ${extra}/>`);
    // решётка поля
    for (let y = 70; y <= H - 70; y += 28) for (let x = 70 + ((y / 28) % 2) * 14; x <= W - 70; x += 28) dia(x, y, 6, 8, '#5d1418');
    // медальон
    dia(W / 2, H / 2, 110, 150, '#d6c49a');
    dia(W / 2, H / 2, 102, 140, '#22403f');
    dia(W / 2, H / 2, 84, 118, '#8c2228');
    dia(W / 2, H / 2, 48, 68, '#d6c49a');
    dia(W / 2, H / 2, 40, 58, '#22403f');
    dia(W / 2, H / 2, 16, 24, '#c8a85a');
    for (const [dx, dy] of [[0, -95], [0, 95], [-60, 0], [60, 0]]) dia(W / 2 + dx, H / 2 + dy, 10, 14, '#d6c49a');
    // угловые четверти
    for (const [cx, cy] of [[52, 52], [W - 52, 52], [52, H - 52], [W - 52, H - 52]]) {
      dia(cx, cy, 34, 34, '#22403f');
      dia(cx, cy, 20, 20, '#d6c49a');
    }
    // кайма: зубцы
    let zig = '';
    for (let x = 14; x <= W - 14; x += 16) zig += `<polygon points="${x},22 ${x + 8},30 ${x},38 ${x - 8},30" fill="#d6c49a"/><polygon points="${x},${H - 38} ${x + 8},${H - 30} ${x},${H - 22} ${x - 8},${H - 30}" fill="#d6c49a"/>`;
    for (let y = 14; y <= H - 14; y += 16) zig += `<polygon points="22,${y} 30,${y + 8} 38,${y} 30,${y - 8}" fill="#d6c49a"/><polygon points="${W - 38},${y} ${W - 30},${y + 8} ${W - 22},${y} ${W - 30},${y - 8}" fill="#d6c49a"/>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
<rect width="${W}" height="${H}" fill="#2b1a17"/>
<rect x="6" y="6" width="${W - 12}" height="${H - 12}" fill="#22403f"/>
${zig}
<rect x="44" y="44" width="${W - 88}" height="${H - 88}" fill="#d6c49a"/>
<rect x="50" y="50" width="${W - 100}" height="${H - 100}" fill="#7c1e22"/>
${el}
</svg>`;
    const im = await svgImg(svg);
    im.map((x, y, c) => {
      const u = x / W, v = y / H;
      let cc = scl(c, 0.9 + 0.2 * fbm(u, v, 48, 72, 2, 101));
      cc = mixc(cc, hexf('#9a7a6a'), 0.35 * smooth(0.6, 0.8, fbm(u, v, 4, 6, 3, 103)));
      return cc;
    });
    T.rug = doc.createTexture('san_rm_rug').setImage(await im.png()).setMimeType('image/png');
  }
  return T;
}
const TEX = await makeTextures();

// ───────── материалы ─────────
const hex = (h) => [1, 3, 5].map((k) => +(parseInt(h.slice(k, k + 2), 16) / 255).toFixed(4));
/** Текстурные материалы: UV по функции (p, n) → [u, v] или проекцией по нормали (tile — повтор, м; org — начало). */
const MAT_UV = new Map();
/** Цвет — как в болванке (#rrggbb без перевода в линейный: PropModels кладёт его в StandardMaterial как есть). */
function mat(name, color, o = {}) {
  const m = doc.createMaterial(name).setBaseColorFactor([...hex(color), 1]).setMetallicFactor(0).setRoughnessFactor(o.rough ?? 0.85);
  if (o.glow) m.setEmissiveFactor(hex(o.glow));
  if (o.two) m.setDoubleSided(true);
  if (o.tex) {
    m.setBaseColorTexture(o.tex);
    MAT_UV.set(m, o.uv ?? { tile: o.tile ?? 1, org: o.org ?? [0, 0, 0] });
  }
  return m;
}
const C = {
  // дерево: полированный шпон (текстура), тёмное (ножки, гнутые стулья), светлое (рама панно, стремянка, черенок,
  // дранка), лакированное светлое (кровать без белья — то же, что шпон)
  wood: mat('san_rm_wood', '#8a5232', { tex: TEX.wood, tile: 0.8, rough: 0.35 }),
  woodDk: mat('san_rm_wood_dk', '#4b2c1c', { rough: 0.5 }),
  woodLt: mat('san_rm_wood_lt', '#b48654', { rough: 0.6 }),
  // ткани: бельё, покрывало, обивка (бордовый дерматин), обивка кресел (бирюзово-зелёная), клеёнка кушеток
  linen: mat('san_rm_linen', '#ebe9e1'),
  spread: mat('san_rm_spread', '#9a8156'),
  uphol: mat('san_rm_uphol', '#6e2a24', { rough: 0.5 }),
  fabric: mat('san_rm_fabric', '#5e7d70'),
  oilcloth: mat('san_rm_oilcloth', '#5b3226', { rough: 0.4 }),
  baize: mat('san_rm_baize', '#3c5c44'),
  // металл: белая эмаль (мед. мебель, ножки кушетки, весы), сталь/хром (поручни, кран), тёмное железо (вентили,
  // станины), крашеные ржавые трубы, ржавчина, латунь, алюминий (посуда, ковш)
  enamel: mat('san_rm_enamel', '#e4e4dc', { rough: 0.4 }),
  steel: mat('san_rm_steel', '#b9bdbc', { rough: 0.25 }),
  iron: mat('san_rm_iron', '#3e4144', { rough: 0.6 }),
  pipe: mat('san_rm_pipe', '#7c6b5b', { rough: 0.7 }),
  rust: mat('san_rm_rust', '#7a4824', { rough: 0.9 }),
  brass: mat('san_rm_brass', '#b08a3e', { rough: 0.35 }),
  alu: mat('san_rm_alu', '#a3a6a4', { rough: 0.4 }),
  // цвет: красный (маховики, крест, полосы мешков), чёрное (резина, шкалы), бумага/циферблат, оранжевая эмаль
  red: mat('san_rm_red', '#a3271e', { rough: 0.5 }),
  black: mat('san_rm_black', '#1d1d1d', { rough: 0.6 }),
  paper: mat('san_rm_paper', '#f0eee6'),
  orange: mat('san_rm_orange', '#d9622a', { rough: 0.35 }),
  // кафель и плитка (текстуры)
  tile: mat('san_rm_tile', '#e9ebe5', { tex: TEX.tile, tile: 0.6 }),
  tileBath: mat('san_rm_tile_bath', '#e2ddd0', {
    tex: TEX.tileBath,
    // борт — на всю высоту картинки (верх — бортик), вдоль — повтор 1.2 м; бортик сверху — та же картинка в плане
    uv: (p, n) => {
      if (Math.abs(n[1]) > 0.5) return [(p[0] + 1.5) / 1.2, (p[2] + 0.8) / 0.9];
      const u = Math.abs(n[0]) > Math.abs(n[2]) ? p[2] * Math.sign(n[0]) : -p[0] * Math.sign(n[2]);
      return [(u + 1.5) / 1.2, (0.9 - p[1]) / 0.9];
    },
  }),
  tileWall: mat('san_rm_tile_wall', '#e4e2da', { tex: TEX.tileWall, uv: (p) => [(p[0] + 1.5) / 3.0, (2.4 - p[1]) / 2.4] }),
  marble: mat('san_rm_marble', '#55585b', { tex: TEX.marble, tile: 0.6, org: [-1.3, 0.9, -0.6], rough: 0.3 }),
  bathFloor: mat('san_rm_bath_floor', '#4a4038', { tex: TEX.bathFloor, tile: 0.6, org: [-1.3, 0, -0.6] }),
  mural: mat('san_rm_mural', '#8aa7a8', { tex: TEX.mural, uv: (p) => [(p[0] + 0.825) / 1.65, (2.125 - p[1]) / 1.05] }),
  rug: mat('san_rm_rug', '#7c1e22', { tex: TEX.rug, uv: (p) => [(p[0] + 1.0) / 2.0, (p[2] + 1.5) / 3.0] }),
  // светится: лицо светового короба (emissive × текстура надписи)
  sloganGlow: mat('san_rm_slogan_glow', '#f6f1e2', { tex: TEX.slogan, glow: '#f4efe2', uv: (p) => [(p[0] + 0.8) / 1.6, (2.45 - p[1]) / 0.3] }),
  // манекен
  skin: mat('san_rm_skin', '#d8b59b', { rough: 0.45 }),
  hair: mat('san_rm_hair', '#3a291d'),
  // ремонт и мусор: штукатурка, пыль/цемент, кирпич, тёмная пустота под полом, жёлтые доски, линолеум, крафт-мешки
  plaster: mat('san_rm_plaster', '#d8d3c6', { rough: 0.95 }),
  dust: mat('san_rm_dust', '#a59f91', { rough: 0.95 }),
  brick: mat('san_rm_brick', '#8e4a36', { rough: 0.9 }),
  void: mat('san_rm_void', '#100d0a', { rough: 1 }),
  fill: mat('san_rm_fill', '#2e261f', { rough: 1 }),
  joist: mat('san_rm_joist', '#6e5234', { rough: 0.9 }),
  board: mat('san_rm_board_yellow', '#c99a2e', { rough: 0.6 }),
  lino: mat('san_rm_lino', '#b9b39f', { rough: 0.6 }),
  kraft: mat('san_rm_kraft', '#b39767', { rough: 0.9 }),
  mud: mat('san_rm_mud', '#3a3029', { rough: 0.3 }),
  // стекло (непрозрачное: прозрачности PropModels не переносит): светлое, зелёное, бурое
  glass: mat('san_rm_glass', '#a9c2c2', { rough: 0.1 }),
  glassGreen: mat('san_rm_glass_green', '#4d7a58', { rough: 0.15 }),
  glassBrown: mat('san_rm_glass_brown', '#5c3519', { rough: 0.15 }),
};

// ───────── сборка сетки ─────────
/** Треугольник: обход — по нормалям вершин (лицевая сторона — куда смотрят нормали); вырожденный — пропуск. */
function tri(g, a, b, c) {
  const P = (i) => [g.p[3 * i], g.p[3 * i + 1], g.p[3 * i + 2]];
  const N = (i) => [g.n[3 * i], g.n[3 * i + 1], g.n[3 * i + 2]];
  const gn = cross(sub(P(b), P(a)), sub(P(c), P(a)));
  if (Math.hypot(gn[0], gn[1], gn[2]) < 1e-12) return;
  if (dot(gn, add(add(N(a), N(b)), N(c))) < 0) g.i.push(a, c, b);
  else g.i.push(a, b, c);
}
/** UV проекцией по нормали (м / повтор; v вниз — у glTF v = 0 верх картинки): смотришь на грань — u вправо. */
function boxUV(p, q, { tile, org }) {
  const x = p[0] - org[0], y = p[1] - org[1], z = p[2] - org[2];
  const ax = Math.abs(q[0]), ay = Math.abs(q[1]), az = Math.abs(q[2]);
  let uv;
  if (ax >= ay && ax >= az) uv = [z * Math.sign(q[0] || 1), -y];
  else if (ay >= az) uv = [z, x];
  else uv = [-x * Math.sign(q[2] || 1), -y];
  return [uv[0] / tile, uv[1] / tile];
}

/** Модель предмета: части по материалу; T — текущий перенос (at). */
class Model {
  constructor(id, o = {}) {
    this.id = id;
    this.ceil = !!o.ceil;
    this.extras = o.extras ?? {};
    this.parts = new Map();
    this.T = null;
    MODELS.push(this);
  }
  g(m) {
    let x = this.parts.get(m);
    if (!x) this.parts.set(m, (x = { p: [], n: [], uv: [], i: [] }));
    return x;
  }
  /** Рисовать fn в системе t (поверх текущей). */
  at(t, fn) {
    const prev = this.T;
    this.T = prev ? { R: mm3(prev.R, t.R), t: add(mv(prev.R, t.t), prev.t) } : t;
    fn();
    this.T = prev;
  }
  vert(m, g, p, n, uv) {
    if (this.T) {
      p = add(mv(this.T.R, p), this.T.t);
      n = mv(this.T.R, n);
    }
    g.p.push(p[0], p[1], p[2]);
    const q = norm(n);
    g.n.push(q[0], q[1], q[2]);
    const spec = MAT_UV.get(m);
    if (!uv && spec) uv = typeof spec === 'function' ? spec(p, q) : boxUV(p, q, spec);
    g.uv.push(uv ? uv[0] : 0, uv ? uv[1] : 0);
    return g.p.length / 3 - 1;
  }
  /** Четырёхугольник a-b-c-d (по кругу), нормаль n (одна) или ns (на вершину). */
  quad(m, a, b, c, d, n, ns) {
    const g = this.g(m);
    n ??= cross(sub(b, a), sub(c, a));
    const i = [a, b, c, d].map((p, k) => this.vert(m, g, p, ns ? ns[k] : n));
    tri(g, i[0], i[1], i[2]);
    tri(g, i[0], i[2], i[3]);
  }
  /** Выпуклый многоугольник веером, нормаль n. */
  poly(m, pts, n) {
    const g = this.g(m);
    const i = pts.map((p) => this.vert(m, g, p, n));
    for (let k = 1; k + 1 < i.length; k++) tri(g, i[0], i[k], i[k + 1]);
  }
  /** Бокс; skip — грани, которых не видно: 'px nx py ny pz nz'. */
  box(m, x0, y0, z0, x1, y1, z1, skip = '') {
    const F = {
      px: [[1, 0, 0], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]],
      nx: [[-1, 0, 0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]],
      py: [[0, 1, 0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]],
      ny: [[0, -1, 0], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
      pz: [[0, 0, 1], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
      nz: [[0, 0, -1], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]],
    };
    for (const [k, [n, a, b, c, d]] of Object.entries(F)) if (!skip.includes(k)) this.quad(m, a, b, c, d, n);
  }
  /** Повёрнутый бокс: центр c, оси [U, V, W] (единичные), полуразмеры hu, hv, hw. */
  obox(m, c, [U, V, W], hu, hv, hw, skip = '') {
    const P = (a, b, d) => add(c, add(mul(U, a * hu), add(mul(V, b * hv), mul(W, d * hw))));
    const F = {
      px: [U, P(1, -1, -1), P(1, 1, -1), P(1, 1, 1), P(1, -1, 1)],
      nx: [mul(U, -1), P(-1, -1, -1), P(-1, -1, 1), P(-1, 1, 1), P(-1, 1, -1)],
      py: [V, P(-1, 1, -1), P(-1, 1, 1), P(1, 1, 1), P(1, 1, -1)],
      ny: [mul(V, -1), P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1)],
      pz: [W, P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)],
      nz: [mul(W, -1), P(-1, -1, -1), P(-1, 1, -1), P(1, 1, -1), P(1, -1, -1)],
    };
    for (const [k, [n, a, b, cc, d]] of Object.entries(F)) if (!skip.includes(k)) this.quad(m, a, b, cc, d, n);
  }
  /** Брус сечением w × h от точки a до b; up — куда смотрит сторона h. */
  beam(m, a, b, w, h, up = [0, 1, 0], skip = '') {
    const W = norm(sub(b, a));
    let U = cross(up, W);
    if (Math.hypot(...U) < 1e-6) U = cross([1, 0, 0], W);
    U = norm(U);
    const V = cross(W, U);
    this.obox(m, mul(add(a, b), 0.5), [U, V, W], w / 2, h / 2, Math.hypot(...sub(b, a)) / 2, skip);
  }
  /** Трубка радиуса r по ломаной (рамка переносится параллельно); caps: true | 'start' | 'end'. */
  tube(m, pts, r, o = {}) {
    const seg = o.seg ?? 6, closed = !!o.closed, g = this.g(m), n = pts.length;
    const T = pts.map((_, k) => {
      if (closed) return norm(sub(pts[(k + 1) % n], pts[(k - 1 + n) % n]));
      return norm(sub(pts[Math.min(n - 1, k + 1)], pts[Math.max(0, k - 1)]));
    });
    let u = norm(cross(T[0], Math.abs(T[0][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
    const rings = [], dirs = [];
    for (let k = 0; k < n; k++) {
      if (k > 0) u = norm(sub(u, mul(T[k], dot(u, T[k]))));
      const v = cross(T[k], u);
      const ring = [], dr = [];
      for (let s = 0; s < seg; s++) {
        const q = (s / seg) * 2 * PI;
        const d = add(mul(u, Math.cos(q)), mul(v, Math.sin(q)));
        ring.push(this.vert(m, g, add(pts[k], mul(d, r)), d));
        dr.push(d);
      }
      rings.push(ring);
      dirs.push(dr);
    }
    for (let k = 0; k < (closed ? n : n - 1); k++) {
      const A = rings[k], B = rings[(k + 1) % n];
      for (let s = 0; s < seg; s++) {
        const s1 = (s + 1) % seg;
        tri(g, A[s], A[s1], B[s]);
        tri(g, A[s1], B[s1], B[s]);
      }
    }
    const caps = closed ? '' : o.caps === true ? 'both' : (o.caps ?? '');
    for (const [k, sign] of [[0, -1], [n - 1, 1]]) {
      if (!(caps === 'both' || (caps === 'start' && k === 0) || (caps === 'end' && k === n - 1))) continue;
      this.poly(m, dirs[k].map((d) => add(pts[k], mul(d, r))), mul(T[k], sign));
    }
  }
  /** Тело вращения: профиль [r, y] вокруг оси axis через c; гладко, где излом меньше crease (°). */
  lathe(m, prof, o = {}) {
    const seg = o.seg ?? 12, c = o.c ?? [0, 0, 0], [U, A, W] = BASIS[o.axis ?? 'y'];
    const sx = o.sx ?? 1, sz = o.sz ?? 1, a0 = o.a0 ?? 0, a1 = o.a1 ?? 2 * PI, g = this.g(m);
    const segN = [];
    for (let k = 0; k + 1 < prof.length; k++) {
      const dr = prof[k + 1][0] - prof[k][0], dy = prof[k + 1][1] - prof[k][1];
      const l = Math.hypot(dr, dy) || 1;
      segN.push([dy / l, -dr / l]);
    }
    const row = (r, y, nr, ny) => {
      const ids = [];
      for (let j = 0; j <= seg; j++) {
        const f = a0 + ((a1 - a0) * j) / seg, cs = Math.cos(f), sn = Math.sin(f);
        const p = add(add(add(c, mul(U, r * cs * sx)), mul(A, y)), mul(W, r * sn * sz));
        const nn = add(add(mul(U, (nr * cs) / sx), mul(A, ny)), mul(W, (nr * sn) / sz));
        ids.push(this.vert(m, g, p, nn));
      }
      return ids;
    };
    const band = (R0, R1) => {
      for (let j = 0; j < seg; j++) {
        tri(g, R0[j], R1[j], R0[j + 1]);
        tri(g, R0[j + 1], R1[j], R1[j + 1]);
      }
    };
    const lim = o.smooth ? -2 : Math.cos(((o.crease ?? 40) * PI) / 180);
    const start = [], end = [];
    prof.forEach(([r, y], k) => {
      const a = segN[k - 1], b = segN[k];
      if (a && b && a[0] * b[0] + a[1] * b[1] > lim) {
        const nr = a[0] + b[0], ny = a[1] + b[1], l = Math.hypot(nr, ny) || 1;
        end[k - 1] = start[k] = row(r, y, nr / l, ny / l);
        return;
      }
      if (a) end[k - 1] = row(r, y, a[0], a[1]);
      if (b) start[k] = row(r, y, b[0], b[1]);
    });
    for (let k = 0; k < segN.length; k++) band(start[k], end[k]);
  }
  /** Эллипсоид (rx, ry, rz) с центром c. */
  blob(m, c, rx, ry, rz, lat = 6, seg = 10) {
    const prof = [];
    for (let k = 0; k <= lat; k++) {
      const f = -PI / 2 + (PI * k) / lat;
      prof.push([Math.cos(f), Math.sin(f) * ry]);
    }
    this.lathe(m, prof, { c, seg, sx: rx, sz: rz, smooth: true });
  }
  /** Круг радиуса r с центром c, нормаль n. */
  disc(m, c, n, r, seg = 12) {
    n = norm(n);
    const u = norm(cross(n, Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), v = cross(n, u);
    const pts = [];
    for (let s = 0; s < seg; s++) {
      const f = (s / seg) * 2 * PI;
      pts.push(add(c, add(mul(u, Math.cos(f) * r), mul(v, Math.sin(f) * r))));
    }
    this.poly(m, pts, n);
  }
  /** Призма: выпуклый многоугольник pts поперёк оси ('x' — точки (z, y), 'y' — (x, z), 'z' — (x, y)), от a0 до a1;
   *  smooth — угол (°), меньше которого рёбра сглажены; caps: false | 'a0' | 'a1' | true. */
  prism(m, axis, pts, a0, a1, o = {}) {
    const P = (q, a) => (axis === 'x' ? [a, q[1], q[0]] : axis === 'y' ? [q[0], a, q[1]] : [q[0], q[1], a]);
    const n = pts.length;
    const cx = pts.reduce((s, q) => s + q[0], 0) / n, cy = pts.reduce((s, q) => s + q[1], 0) / n;
    const en = pts.map((q, i) => {
      const r = pts[(i + 1) % n];
      let e = [r[1] - q[1], -(r[0] - q[0])];
      const l = Math.hypot(e[0], e[1]) || 1;
      e = [e[0] / l, e[1] / l];
      const mx = (q[0] + r[0]) / 2 - cx, my = (q[1] + r[1]) / 2 - cy;
      return e[0] * mx + e[1] * my < 0 ? [-e[0], -e[1]] : e;
    });
    const lim = Math.cos(((o.smooth ?? 0) * PI) / 180);
    const vn = (i, edge) => {
      const other = edge === i ? (i - 1 + n) % n : (i + 1) % n;
      const a = en[edge], b = en[other];
      if (o.smooth && a[0] * b[0] + a[1] * b[1] > lim) return P([a[0] + b[0], a[1] + b[1]], 0);
      return P(a, 0);
    };
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, q = pts[i], r = pts[j];
      if (Math.hypot(r[0] - q[0], r[1] - q[1]) < 1e-9) continue;
      this.quad(m, P(q, a0), P(r, a0), P(r, a1), P(q, a1), null, [vn(i, i), vn(j, i), vn(j, i), vn(i, i)]);
    }
    const axv = axis === 'x' ? [1, 0, 0] : axis === 'y' ? [0, 1, 0] : [0, 0, 1];
    const caps = o.caps ?? true;
    if (caps === true || caps === 'a0') this.poly(m, pts.map((q) => P(q, a0)), mul(axv, a1 > a0 ? -1 : 1));
    if (caps === true || caps === 'a1') this.poly(m, pts.map((q) => P(q, a1)), mul(axv, a1 > a0 ? 1 : -1));
  }
  /** Поверхность по сетке nu × nv: f(u, v) → точка; нормаль — по направлению hint. */
  surface(m, nu, nv, f, hint) {
    const g = this.g(m), e = 1e-4, ids = [];
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) {
        const u = i / nu, v = j / nv, p = f(u, v);
        const du = sub(f(Math.min(1, u + e), v), f(Math.max(0, u - e), v));
        const dv = sub(f(u, Math.min(1, v + e)), f(u, Math.max(0, v - e)));
        let n = cross(du, dv);
        if (dot(n, typeof hint === 'function' ? hint(u, v, p) : hint) < 0) n = mul(n, -1);
        ids.push(this.vert(m, g, p, n));
      }
    }
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
        tri(g, ids[a], ids[b], ids[d]);
        tri(g, ids[a], ids[d], ids[c]);
      }
    }
  }
  /** Камешек — низкий четырёхгранник с гранёной заливкой: центр c на полу, размер r, высота h. */
  pebble(m, c, r, h, ang) {
    const pts = [0, 1, 2].map((k) => {
      const f = ang + (k * 2 * PI) / 3 + rr(-0.4, 0.4);
      const q = r * rr(0.7, 1.1);
      return [c[0] + q * Math.cos(f), c[1], c[2] + q * Math.sin(f)];
    });
    const top = [c[0] + rr(-0.3, 0.3) * r, c[1] + h, c[2] + rr(-0.3, 0.3) * r];
    for (let k = 0; k < 3; k++) {
      const a = pts[k], b = pts[(k + 1) % 3];
      let n = cross(sub(b, a), sub(top, a));
      const mid = mul(add(add(a, b), top), 1 / 3);
      if (dot(n, sub(mid, c)) < 0) n = mul(n, -1);
      this.poly(m, [a, b, top], n);
    }
  }
}
const MODELS = [];

/** Скруглённый прямоугольник (x, y) против часовой, радиус r углов. */
function rrect(x0, y0, x1, y1, r, n = 4) {
  const pts = [];
  const corner = (cx, cy, f0) => {
    for (let k = 0; k <= n; k++) {
      const f = f0 + ((PI / 2) * k) / n;
      pts.push([cx + r * Math.cos(f), cy + r * Math.sin(f)]);
    }
  };
  corner(x1 - r, y0 + r, -PI / 2);
  corner(x1 - r, y1 - r, 0);
  corner(x0 + r, y1 - r, PI / 2);
  corner(x0 + r, y0 + r, PI);
  return pts;
}
/** Точки окружности: центр c, радиус r (или [rx, ry]), плоскость 'xy' | 'xz' | 'yz'. */
function ring(c, r, n = 16, plane = 'xz', a0 = 0) {
  const [rx, ry] = Array.isArray(r) ? r : [r, r];
  const pts = [];
  for (let k = 0; k < n; k++) {
    const f = a0 + (k / n) * 2 * PI, a = Math.cos(f) * rx, b = Math.sin(f) * ry;
    pts.push(plane === 'xy' ? [c[0] + a, c[1] + b, c[2]] : plane === 'xz' ? [c[0] + a, c[1], c[2] + b] : [c[0], c[1] + b, c[2] + a]);
  }
  return pts;
}
/** Манометр лицом к −Z: центр c, радиус r, корпус глубиной dz к +Z; латунный обод, белая шкала с рисками, красная
 *  стрелка; ang — положение стрелки (рад от вертикали, по часовой). */
function gauge(M, c, r, dz, ang = 0.6) {
  M.lathe(C.iron, [[r, 0.004], [r, dz * 0.4], [r * 0.98, dz], [0, dz]], { c, axis: 'z', seg: 16 });
  M.tube(C.brass, ring([c[0], c[1], c[2] + 0.002], r - 0.004, 16, 'xy'), 0.006, { closed: true, seg: 5 });
  M.disc(C.paper, [c[0], c[1], c[2] + 0.004], [0, 0, -1], r * 0.9, 16);
  const zf = c[2] + 0.0025;
  for (let k = 0; k <= 10; k++) {
    const f = -0.75 * PI + (1.5 * PI * k) / 10, s = Math.sin(f), co = Math.cos(f);
    const r0 = r * (k % 5 === 0 ? 0.62 : 0.7), r1 = r * 0.82, w = r * (k % 5 === 0 ? 0.035 : 0.02);
    const p0 = [c[0] + s * r0, c[1] + co * r0], p1 = [c[0] + s * r1, c[1] + co * r1];
    M.quad(C.black, [p0[0] - co * w, p0[1] + s * w, zf], [p1[0] - co * w, p1[1] + s * w, zf], [p1[0] + co * w, p1[1] - s * w, zf], [p0[0] + co * w, p0[1] - s * w, zf], [0, 0, -1]);
  }
  const s = Math.sin(ang), co = Math.cos(ang), w = r * 0.035, L = r * 0.75, zn = c[2] + 0.0015;
  M.poly(C.red, [[c[0] - co * w, c[1] + s * w, zn], [c[0] + s * L, c[1] + co * L, zn], [c[0] + co * w, c[1] - s * w, zn], [c[0] - s * w * 2, c[1] - co * w * 2, zn]], [0, 0, -1]);
  M.disc(C.black, [c[0], c[1], c[2] + 0.001], [0, 0, -1], r * 0.08, 8);
}
/** Маховик вентиля лицом к −Z: обод, четыре спицы, ступица. */
function handwheel(M, m, c, r) {
  M.tube(m, ring(c, r, 14, 'xy'), r * 0.12, { closed: true, seg: 5 });
  for (let k = 0; k < 4; k++) {
    const f = (k * PI) / 2 + PI / 4;
    M.tube(m, [c, [c[0] + Math.cos(f) * r, c[1] + Math.sin(f) * r, c[2]]], r * 0.07, { seg: 4 });
  }
  M.lathe(C.iron, [[0, -0.012], [r * 0.25, -0.012], [r * 0.25, 0.015]], { c, axis: 'z', seg: 8 });
}
/** Наклонная стойка-брус с горизонтальными торцами: низ — прямоугольник w0 × d0 (по X × Z) с центром a, верх —
 *  w1 × d1 с центром b (сужается, косой параллелепипед: торцы ровно на полу и под столешницей). */
function strut(M, m, a, b, w0, d0, w1 = w0, d1 = d0, caps = 'a') {
  const B = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => [a[0] + (sx * w0) / 2, a[1], a[2] + (sz * d0) / 2]);
  const T = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => [b[0] + (sx * w1) / 2, b[1], b[2] + (sz * d1) / 2]);
  const ctr = mul(add(a, b), 0.5);
  for (let k = 0; k < 4; k++) {
    const k1 = (k + 1) % 4;
    const mid = mul(add(add(B[k], B[k1]), add(T[k], T[k1])), 0.25);
    let n = cross(sub(B[k1], B[k]), sub(T[k], B[k]));
    if (dot(n, sub(mid, ctr)) < 0) n = mul(n, -1);
    M.quad(m, B[k], B[k1], T[k1], T[k], n);
  }
  if (caps.includes('a')) M.poly(m, B, [0, -1, 0]);
  if (caps.includes('b')) M.poly(m, T, [0, 1, 0]);
}
/** Ножка мебели: от пола (x, z) до (x2, y2, z2), квадрат s0 внизу → s1 вверху. */
const leg = (M, m, x, z, x2, y2, z2, s0, s1 = s0) => strut(M, m, [x, 0, z], [x2, y2, z2], s0, s0, s1, s1);

// ═════════════════════════ предметы ═════════════════════════

// ── кровать деревянная (0.9 × 2.0, изголовье 0.85 у стены +Z, изножье −Z): ножки-стойки, царги 0.34…0.45 (под
//    кроватью — просвет BED_CLEAR_M), матрас в белой простыне, покрывало свисает до 0.38, отвёрнутая простыня, подушка
//    «парусом» — уголком вверх, как стелили в санатории; frame — без матраса: голые ламели, одной нет, одна сломана ──
function bed(M, frame) {
  const hx = 0.45, hz = 1.0;
  // стойки: у изголовья до 0.85, у изножья до 0.62
  for (const sx of [-1, 1]) {
    M.box(C.wood, sx > 0 ? hx - 0.05 : -hx, 0, hz - 0.05, sx > 0 ? hx : -hx + 0.05, 0.85, hz, '');
    M.box(C.wood, sx > 0 ? hx - 0.05 : -hx, 0, -hz, sx > 0 ? hx : -hx + 0.05, 0.62, -hz + 0.05, '');
    // царга
    M.box(C.wood, sx > 0 ? 0.41 : -0.44, 0.34, -hz + 0.05, sx > 0 ? 0.44 : -0.41, 0.45, hz - 0.05, '');
  }
  // изголовье: филёнка и верхний брус
  M.box(C.wood, -0.4, 0.36, 0.96, 0.4, 0.8, 0.985, '');
  M.box(C.woodDk, -0.32, 0.44, 0.955, 0.32, 0.72, 0.96, 'pz');
  M.box(C.wood, -hx, 0.8, 0.945, hx, 0.85, hz, '');
  // изножье
  M.box(C.wood, -0.4, 0.36, -0.985, 0.4, 0.56, -0.96, '');
  M.box(C.wood, -hx, 0.56, -hz, hx, 0.62, -0.945, '');
  if (!frame) {
    // матрас в простыне, покрывало, отвёрнутая простыня, подушка
    M.box(C.linen, -0.41, 0.45, -0.95, 0.41, 0.57, 0.95, 'ny');
    M.box(C.spread, -0.447, 0.38, -0.955, 0.447, 0.585, 0.45, '');
    M.box(C.linen, -0.449, 0.585, 0.3, 0.449, 0.593, 0.45, 'ny');
    M.box(C.linen, -0.449, 0.5, 0.445, 0.449, 0.593, 0.452, '');
    M.prism(C.linen, 'z', [[-0.32, 0.57], [0.32, 0.57], [0.08, 0.83], [0, 0.84], [-0.08, 0.83]], 0.7, 0.84, { smooth: 50 });
    return;
  }
  // без матраса: опорные бруски по царгам и ламели
  for (const sx of [-1, 1]) M.box(C.woodDk, sx > 0 ? 0.38 : -0.41, 0.4, -0.95, sx > 0 ? 0.41 : -0.38, 0.43, 0.95, 'ny');
  for (let k = 0; k < 9; k++) {
    const z = -0.85 + k * 0.21;
    if (k === 3) continue;
    if (k === 6) {
      // сломанная — один конец провалился на пол
      M.beam(C.woodLt, [0.4, 0.43, z], [-0.15, 0.03, z + 0.12], 0.07, 0.018, [0, 1, 0]);
      continue;
    }
    M.box(C.woodLt, -0.41, 0.43, z - 0.035, 0.41, 0.448, z + 0.035, 'ny');
  }
  // упавшая ламель под кроватью
  M.box(C.woodLt, -0.38, 0, 0.1, 0.42, 0.018, 0.17, 'ny');
}
bed(new Model('p_san_bed'), false);
bed(new Model('p_san_bed_frame'), true);

// ── тумбочка (0.45 × 0.4 × 0.6): ящик и дверца, латунные ручки, низкие ножки ──
{
  const M = new Model('p_san_nightstand');
  for (const [x, z] of [[-0.2, -0.17], [0.2, -0.17], [-0.2, 0.17], [0.2, 0.17]]) M.box(C.woodDk, x - 0.02, 0, z - 0.02, x + 0.02, 0.06, z + 0.02, 'ny');
  M.box(C.wood, -0.225, 0.06, -0.19, 0.225, 0.58, 0.2, 'ny');
  M.box(C.wood, -0.232, 0.58, -0.2, 0.232, 0.6, 0.205, 'ny');
  // щели ящика и дверцы, ручки
  M.box(C.black, -0.21, 0.452, -0.192, 0.21, 0.458, -0.19, 'pz');
  M.box(C.black, -0.005, 0.08, -0.192, 0.005, 0.44, -0.19, 'pz');
  M.lathe(C.brass, [[0, -0.02], [0.014, -0.012], [0.012, 0], [0, 0]], { c: [0, 0.515, -0.19], axis: 'z', seg: 8 });
  M.box(C.brass, 0.02, 0.25, -0.2, 0.03, 0.32, -0.19, 'pz');
  M.box(C.brass, -0.03, 0.25, -0.2, -0.02, 0.32, -0.19, 'pz');
}

// ── шкаф платяной полированный (1.0 × 0.55 × 2.0): цоколь, две створки, антресоль, карниз, латунные ручки ──
{
  const M = new Model('p_san_wardrobe');
  M.box(C.woodDk, -0.48, 0, -0.25, 0.48, 0.08, 0.27, 'ny');
  M.box(C.wood, -0.5, 0.08, -0.275, 0.5, 1.95, 0.275, 'ny');
  M.box(C.wood, -0.51, 1.95, -0.285, 0.51, 2.0, 0.28, 'ny');
  const zf = -0.277;
  // щели створок и антресоли
  M.box(C.black, -0.004, 0.1, zf - 0.001, 0.004, 1.93, zf + 0.002, 'pz');
  M.box(C.black, -0.48, 1.6, zf - 0.001, 0.48, 1.607, zf + 0.002, 'pz');
  for (const sx of [-1, 1]) {
    M.box(C.black, sx * 0.48 - 0.002, 0.1, zf - 0.001, sx * 0.48 + 0.002, 1.93, zf + 0.002, 'pz');
    // ручки-скобы
    M.tube(C.brass, [[sx * 0.04, 0.98, zf], [sx * 0.04, 0.98, zf - 0.03], [sx * 0.04, 1.2, zf - 0.03], [sx * 0.04, 1.2, zf]], 0.006, { seg: 5 });
    M.lathe(C.brass, [[0, -0.016], [0.012, -0.01], [0.01, 0], [0, 0]], { c: [sx * 0.06, 1.76, zf], axis: 'z', seg: 8 });
  }
  // накладная филёнка-рамка на створках
  for (const sx of [-1, 1]) {
    const x0 = sx > 0 ? 0.08 : -0.42, x1 = sx > 0 ? 0.42 : -0.08;
    M.box(C.woodDk, x0, 0.2, zf - 0.006, x1, 0.22, zf, 'pz');
    M.box(C.woodDk, x0, 1.46, zf - 0.006, x1, 1.48, zf, 'pz');
    M.box(C.woodDk, x0, 0.22, zf - 0.006, x0 + 0.02, 1.46, zf, 'pz');
    M.box(C.woodDk, x1 - 0.02, 0.22, zf - 0.006, x1, 1.46, zf, 'pz');
  }
}

// ── стол (0.9 × 0.6 × 0.75) на четырёх разведённых ножках, царга 0.64…0.72 (под столом — просвет TABLE_CLEAR_M);
//    на столе — салфетка, графин с пробкой и гранёный стакан ──
{
  const M = new Model('p_san_table');
  M.box(C.wood, -0.45, 0.72, -0.3, 0.45, 0.75, 0.3, '');
  M.box(C.woodDk, -0.4, 0.64, -0.255, 0.4, 0.72, -0.235, '');
  M.box(C.woodDk, -0.4, 0.64, 0.235, 0.4, 0.72, 0.255, '');
  M.box(C.woodDk, -0.4, 0.64, -0.235, -0.38, 0.72, 0.235, '');
  M.box(C.woodDk, 0.38, 0.64, -0.235, 0.4, 0.72, 0.235, '');
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) leg(M, C.woodDk, sx * 0.425, sz * 0.27, sx * 0.39, 0.72, sz * 0.245, 0.03, 0.045);
  M.disc(C.linen, [0.18, 0.7515, 0.05], [0, 1, 0], 0.16, 16);
  // графин: тулово, горло, пробка-шар
  M.lathe(C.glass, [[0, 0], [0.055, 0], [0.065, 0.04], [0.06, 0.1], [0.025, 0.15], [0.02, 0.21], [0.026, 0.22], [0, 0.22]], { c: [0.22, 0.752, 0.08], seg: 12, crease: 60 });
  M.blob(C.glass, [0.22, 0.752 + 0.24, 0.08], 0.022, 0.025, 0.022, 4, 8);
  M.lathe(C.glass, [[0, 0], [0.03, 0], [0.036, 0.1], [0, 0.1]], { c: [0.1, 0.752, -0.02], seg: 8 });
}

// ── стул гнутый (0.45 × 0.45 × 0.9): тёмное гнутое дерево — ножки, кольца, спинка петлёй и внутренний овал; сиденье
//    обито бордовым дерматином ──
{
  const M = new Model('p_san_chair');
  const r = 0.014;
  // сиденье — скруглённая подушка
  const seat = rrect(-0.205, -0.21, 0.205, 0.18, 0.08, 4).map(([x, z]) => [x, z]);
  M.prism(C.uphol, 'y', seat, 0.43, 0.47, { smooth: 40 });
  M.tube(C.woodDk, rrect(-0.2, -0.205, 0.2, 0.175, 0.08, 4).map(([x, z]) => [x, 0.425, z]), 0.012, { closed: true, seg: 5 });
  // передние ножки
  for (const sx of [-1, 1]) M.tube(C.woodDk, [[sx * 0.175, 0, -0.205], [sx * 0.16, 0.43, -0.17]], r, { seg: 6, caps: 'start' });
  // задние ножки + спинка одной петлёй
  const back = [];
  const side = (sx) => [[sx * 0.17, 0, 0.21], [sx * 0.155, 0.43, 0.165], [sx * 0.158, 0.62, 0.19], [sx * 0.162, 0.78, 0.215]];
  back.push(...side(-1));
  for (let k = 1; k < 8; k++) {
    const f = PI - (PI * k) / 8;
    back.push([Math.cos(f) * 0.162, 0.78 + Math.sin(f) * 0.105, 0.215 + Math.sin(f) * 0.012]);
  }
  back.push(...side(1).reverse());
  M.tube(C.woodDk, back, r, { seg: 6, caps: true });
  // внутренний овал спинки
  M.tube(C.woodDk, ring([0, 0.67, 0.2], [0.095, 0.12], 16, 'xy').map(([x, y, z]) => [x, y, z + (y - 0.67) * 0.18]), 0.01, { closed: true, seg: 5 });
  // кольцо-царга у ножек
  M.tube(C.woodDk, rrect(-0.17, -0.185, 0.17, 0.185, 0.07, 3).map(([x, z]) => [x, 0.2, z]), 0.009, { closed: true, seg: 5 });
}

// ── кресло (0.75 × 0.75 × 0.85): разведённые ножки, царга, подушки сиденья и спинки, деревянные подлокотники на
//    обитых боковинах ──
{
  const M = new Model('p_san_armchair');
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) leg(M, C.woodDk, sx * 0.34, sz * 0.34, sx * 0.3, 0.2, sz * 0.3, 0.03, 0.045);
  M.box(C.woodDk, -0.33, 0.2, -0.33, 0.33, 0.28, 0.33, '');
  M.prism(C.fabric, 'x', rrect(-0.35, 0.28, 0.27, 0.43, 0.05, 3), -0.27, 0.27, { smooth: 40 });
  // спинка — наклонная подушка
  M.at(TR([0, 0.31, 0.25], ['x', 12 * DEG]), () => {
    M.prism(C.fabric, 'x', rrect(-0.06, 0, 0.06, 0.53, 0.05, 3), -0.29, 0.29, { smooth: 40 });
  });
  for (const sx of [-1, 1]) {
    M.box(C.fabric, sx > 0 ? 0.27 : -0.33, 0.28, -0.3, sx > 0 ? 0.33 : -0.27, 0.55, 0.36, '');
    M.box(C.wood, sx > 0 ? 0.265 : -0.375, 0.55, -0.37, sx > 0 ? 0.375 : -0.265, 0.585, 0.37, '');
  }
}

// ── ковёр 2 × 3 м с орнаментом, бахрома по коротким сторонам ──
{
  const M = new Model('p_san_rug');
  M.box(C.uphol, -1.0, 0, -1.5, 1.0, 0.007, 1.5, 'ny py');
  M.quad(C.rug, [-1.0, 0.007, -1.5], [1.0, 0.007, -1.5], [1.0, 0.007, 1.5], [-1.0, 0.007, 1.5], [0, 1, 0]);
  for (const sz of [-1, 1]) {
    for (let k = 0; k < 40; k++) {
      const x = -0.975 + k * 0.05;
      M.quad(C.linen, [x - 0.006, 0.004, sz * 1.5], [x + 0.006, 0.004, sz * 1.5], [x + 0.006 + rr(-0.005, 0.005), 0.003, sz * (1.5 + rr(0.035, 0.05))], [x - 0.006, 0.003, sz * (1.5 + 0.04)], [0, 1, 0]);
    }
  }
}

// ── ванна водолечебницы (3.0 × 1.6 × 0.9; реф. 1): встроенная кафельная — снаружи и по бортику белый кафель 150 мм с
//    ржавыми потёками, внутри стенки в тёмной «мраморной» плитке, дно — бурая плитка с осадком; стальные поручни на
//    стойках с фланцами (вдоль задней стенки ровный, вдоль передней — наклонный, к сиденью), кафельное сиденье у торца,
//    форсунка; на дне — мусор: штукатурка, обрезок трубы, доска, осколок бутылки, бумага и голова манекена ──
{
  const M = new Model('p_san_hydro_bath');
  const X = 1.5, Z = 0.8, x = 1.3, z = 0.6, H = 0.9, B = 0.06;
  // снаружи
  M.quad(C.tileBath, [-X, 0, -Z], [-X, H, -Z], [X, H, -Z], [X, 0, -Z], [0, 0, -1]);
  M.quad(C.tileBath, [-X, 0, Z], [X, 0, Z], [X, H, Z], [-X, H, Z], [0, 0, 1]);
  M.quad(C.tileBath, [X, 0, -Z], [X, H, -Z], [X, H, Z], [X, 0, Z], [1, 0, 0]);
  M.quad(C.tileBath, [-X, 0, -Z], [-X, 0, Z], [-X, H, Z], [-X, H, -Z], [-1, 0, 0]);
  // бортик
  M.quad(C.tileBath, [-X, H, -Z], [X, H, -Z], [X, H, -z], [-X, H, -z], [0, 1, 0]);
  M.quad(C.tileBath, [-X, H, z], [X, H, z], [X, H, Z], [-X, H, Z], [0, 1, 0]);
  M.quad(C.tileBath, [-X, H, -z], [-x, H, -z], [-x, H, z], [-X, H, z], [0, 1, 0]);
  M.quad(C.tileBath, [x, H, -z], [X, H, -z], [X, H, z], [x, H, z], [0, 1, 0]);
  // внутри: стенки и дно
  M.quad(C.marble, [-x, B, -z], [x, B, -z], [x, H, -z], [-x, H, -z], [0, 0, 1]);
  M.quad(C.marble, [-x, B, z], [-x, H, z], [x, H, z], [x, B, z], [0, 0, -1]);
  M.quad(C.marble, [x, B, -z], [x, B, z], [x, H, z], [x, H, -z], [-1, 0, 0]);
  M.quad(C.marble, [-x, B, -z], [-x, H, -z], [-x, H, z], [-x, B, z], [1, 0, 0]);
  M.quad(C.bathFloor, [-x, B, -z], [-x, B, z], [x, B, z], [x, B, -z], [0, 1, 0]);
  // поручни: задний — ровный на 0.55, передний — наклонный от бортика у +X к сиденью у −X
  const rail = (a, b, posts) => {
    M.tube(C.steel, [a, b], 0.019, { seg: 8 });
    for (const p of [a, b]) M.blob(C.steel, p, 0.021, 0.021, 0.021, 3, 8);
    for (const [p, zw] of posts) {
      M.tube(C.steel, [p, [p[0], p[1], zw]], 0.013, { seg: 6 });
      M.disc(C.steel, [p[0], p[1], zw + (zw > 0 ? -0.004 : 0.004)], [0, 0, zw > 0 ? -1 : 1], 0.035, 10);
      const sg = zw > 0 ? -1 : 1;
      M.lathe(C.steel, sg > 0 ? [[0.035, 0], [0.035, 0.004], [0.016, 0.012]] : [[0.016, -0.012], [0.035, -0.004], [0.035, 0]], { c: [p[0], p[1], zw], axis: 'z', seg: 10 });
    }
  };
  rail([-1.15, 0.55, z - 0.07], [1.15, 0.55, z - 0.07], [[[-1.05, 0.55, z - 0.07], z], [[0, 0.55, z - 0.07], z], [[1.05, 0.55, z - 0.07], z]]);
  const fa = [1.2, 0.8, -z + 0.07], fb = [-0.8, 0.32, -z + 0.07];
  rail(fa, fb, [[fa, -z], [fb, -z], [[0.2, lerp(fa[1], fb[1], 0.5), -z + 0.07], -z]]);
  // форсунка на торцевой стенке −X
  M.disc(C.steel, [-x + 0.004, 0.4, 0.25], [1, 0, 0], 0.05, 12);
  M.tube(C.steel, [[-x, 0.4, 0.25], [-x + 0.06, 0.4, 0.25]], 0.022, { seg: 8, caps: 'end' });
  M.disc(C.black, [-x + 0.0605, 0.4, 0.25], [1, 0, 0], 0.012, 8);
  // кафельное сиденье у торца −X
  M.box(C.marble, -x, B, 0.12, -0.9, 0.48, z, 'nx ny pz');
  // осадок: тёмные пятна на дне
  for (const [cx, cz, rx, rz] of [[0.3, -0.2, 0.35, 0.18], [-0.5, 0.25, 0.25, 0.15], [0.9, 0.3, 0.2, 0.12]]) {
    const pts = [];
    for (let k = 0; k < 12; k++) {
      const f = (k / 12) * 2 * PI, q = rr(0.75, 1.1);
      pts.push([cx + Math.cos(f) * rx * q, B + 0.0015, cz + Math.sin(f) * rz * q]);
    }
    M.poly(C.mud, pts, [0, 1, 0]);
  }
  // штукатурка и камешки
  for (let k = 0; k < 34; k++) {
    const px = rr(-1.2, 1.2), pz = rr(-0.5, 0.5), r = rr(0.015, 0.05);
    M.pebble(k % 3 ? C.plaster : C.dust, [px, B, pz], r, r * rr(0.4, 0.9), rnd() * 2 * PI);
  }
  // обрезок ржавой трубы, доска, осколок бутылки, бумага
  M.tube(C.rust, [[0.35, B + 0.035, 0.32], [0.95, B + 0.035, 0.1]], 0.035, { seg: 8, caps: true });
  M.beam(C.woodLt, [-0.2, B + 0.012, -0.45], [0.55, B + 0.03, -0.3], 0.1, 0.024, [0, 1, 0]);
  M.at(TR([0.65, B + 0.035, -0.1], ['y', 0.7], ['z', PI / 2]), () => M.lathe(C.glassGreen, [[0, 0], [0.035, 0], [0.035, 0.12], [0.012, 0.16], [0.012, 0.2], [0, 0.2]], { seg: 8, a0: 0, a1: PI * 1.3 }));
  M.poly(C.paper, [[-0.95, B + 0.003, -0.35], [-0.72, B + 0.003, -0.4], [-0.68, B + 0.003, -0.2], [-0.9, B + 0.003, -0.16]], [0, 1, 0]);
  // голова манекена на боку: лицо (нос, глаза, губы), волосы, шея со сколом
  M.at(TR([-0.3, B + 0.062, -0.05], ['y', 0.5], ['z', 1.45]), () => {
    M.blob(C.skin, [0, 0.17, 0], 0.08, 0.11, 0.092, 7, 14);
    M.blob(C.hair, [0, 0.195, 0.022], 0.086, 0.105, 0.088, 7, 14);
    M.blob(C.skin, [0, 0.165, -0.092], 0.012, 0.022, 0.016, 4, 8);
    for (const sx of [-1, 1]) M.blob(C.hair, [sx * 0.03, 0.19, -0.083], 0.012, 0.007, 0.006, 3, 8);
    M.blob(C.red, [0, 0.122, -0.084], 0.02, 0.007, 0.008, 3, 8);
    M.lathe(C.skin, [[0.04, -0.02], [0.045, 0.02], [0.042, 0.08], [0.02, 0.1]], { seg: 12 });
    M.disc(C.dust, [0, -0.02, 0], [0, -1, 0], 0.04, 12);
  });
}

// ── кафельная стена (3.0 × 0.05 × 2.4; настенное): белый кафель 150 мм с ржавыми потёками, отбитыми плитками и
//    трещинами — картинка на всю стену; кромки — тот же кафель ──
{
  const M = new Model('p_san_tile_wall');
  const zf = -0.025, zb = 0.025;
  M.quad(C.tileWall, [-1.5, 0, zf], [-1.5, 2.4, zf], [1.5, 2.4, zf], [1.5, 0, zf], [0, 0, -1]);
  M.box(C.tile, -1.5, 0, zf, 1.5, 2.4, zb, 'nz pz ny');
}

// ── панно «озеро, деревья» (1.8 × 0.08, 1.0…2.2 м; настенное): кафельное поле 11 × 7 плиток в деревянной раме с
//    фаской; поле на 0.055 от стены — перед кафельной стеной (её лицо — 0.05) ──
{
  const M = new Model('p_san_tile_mural');
  const y0 = 1.0, y1 = 2.2, X = 0.9, fw = 0.075, zb = 0.04, zp = -0.015, zf = -0.04;
  M.quad(C.mural, [-0.825, y0 + fw, zp], [-0.825, y1 - fw, zp], [0.825, y1 - fw, zp], [0.825, y0 + fw, zp], [0, 0, -1]);
  // рама: брусья с фаской внутрь
  const bar = (x0, yA, x1, yB) => M.box(C.woodLt, x0, yA, zf + 0.01, x1, yB, zb, 'pz');
  bar(-X, y0, X, y0 + fw);
  bar(-X, y1 - fw, X, y1);
  bar(-X, y0 + fw, -X + fw, y1 - fw);
  bar(X - fw, y0 + fw, X, y1 - fw);
  // лицевая планка рамы (выступает) и фаска к полю
  const fz = zf;
  M.quad(C.wood, [-X, y0, fz], [-X, y1, fz], [-X + 0.04, y1 - 0.04, fz], [-X + 0.04, y0 + 0.04, fz], [0, 0, -1]);
  M.quad(C.wood, [X - 0.04, y0 + 0.04, fz], [X - 0.04, y1 - 0.04, fz], [X, y1, fz], [X, y0, fz], [0, 0, -1]);
  M.quad(C.wood, [-X, y0, fz], [-X + 0.04, y0 + 0.04, fz], [X - 0.04, y0 + 0.04, fz], [X, y0, fz], [0, 0, -1]);
  M.quad(C.wood, [-X + 0.04, y1 - 0.04, fz], [-X, y1, fz], [X, y1, fz], [X - 0.04, y1 - 0.04, fz], [0, 0, -1]);
  const i0 = 0.825;
  M.quad(C.woodLt, [-X + 0.04, y0 + 0.04, fz], [-i0, y0 + fw, zp], [i0, y0 + fw, zp], [X - 0.04, y0 + 0.04, fz]);
  M.quad(C.woodLt, [-X + 0.04, y1 - 0.04, fz], [X - 0.04, y1 - 0.04, fz], [i0, y1 - fw, zp], [-i0, y1 - fw, zp]);
  M.quad(C.woodLt, [-X + 0.04, y0 + 0.04, fz], [-X + 0.04, y1 - 0.04, fz], [-i0, y1 - fw, zp], [-i0, y0 + fw, zp]);
  M.quad(C.woodLt, [X - 0.04, y0 + 0.04, fz], [i0, y0 + fw, zp], [i0, y1 - fw, zp], [X - 0.04, y1 - 0.04, fz]);
}

// ── трубы с вентилями и манометром (0.8 × 0.2 × 1.6; настенное): два стояка и тонкая подводка, коллектор на 1.35 уходит
//    в стену, задвижки с красными маховиками, кран внизу, манометр на отводе, хомуты ──
{
  const M = new Model('p_san_pipes_gauge');
  const zp = 0.03, zw = 0.1, hy = 1.35;
  // стояки → колено → коллектор → колено в стену
  M.tube(C.pipe, [[-0.28, 0, zp], [-0.28, hy - 0.05, zp], [-0.27, hy - 0.01, zp], [-0.23, hy, zp], [0.3, hy, zp], [0.34, hy, zp + 0.01], [0.35, hy, zp + 0.04], [0.35, hy, zw]], 0.03, { seg: 10 });
  M.tube(C.pipe, [[-0.12, 0, zp], [-0.12, hy - 0.03, zp]], 0.026, { seg: 10 });
  M.tube(C.pipe, [[0.2, 0.55, zw], [0.2, 0.55, zp + 0.02], [0.2, 0.6, zp], [0.2, hy - 0.02, zp]], 0.016, { seg: 8 });
  // муфты на стыках
  for (const [x, y, r] of [[-0.28, 0.25, 0.036], [-0.12, 0.25, 0.031], [-0.28, 1.15, 0.036], [0.05, hy, 0.036]]) {
    if (x === 0.05) M.lathe(C.pipe, [[r, -0.03], [r, 0.03]], { c: [x, y, zp], axis: 'x', seg: 10 });
    else M.lathe(C.pipe, [[r, y - 0.03], [r, y + 0.03]], { c: [x, 0, zp], seg: 10 });
  }
  // задвижки: корпус, шток, маховик
  for (const [x, y] of [[-0.28, 0.9], [-0.12, 0.75]]) {
    M.lathe(C.iron, [[0.03, -0.06], [0.05, -0.04], [0.05, 0.04], [0.03, 0.06]], { c: [x, y, zp], seg: 10 });
    M.box(C.iron, x - 0.03, y - 0.03, zp - 0.07, x + 0.03, y + 0.03, zp, '');
    M.tube(C.iron, [[x, y, zp - 0.07], [x, y, zp - 0.11]], 0.008, { seg: 6 });
    handwheel(M, C.red, [x, y, zp - 0.115], 0.055);
  }
  // кран-«бабочка» внизу на правом стояке (к раковине) с изливом
  M.tube(C.pipe, [[-0.12, 0.42, zp], [-0.06, 0.42, zp], [-0.04, 0.42, zp - 0.02], [-0.04, 0.42, zp - 0.07], [-0.04, 0.38, zp - 0.09]], 0.012, { seg: 8 });
  M.box(C.red, -0.075, 0.445, zp - 0.05, -0.005, 0.455, zp - 0.035, '');
  // манометр на отводе с петлёй-сифоном
  M.tube(C.pipe, [[0.12, hy, zp], [0.12, hy + 0.04, zp], [0.12, hy + 0.06, zp - 0.02], [0.12, hy + 0.08, zp - 0.02]], 0.008, { seg: 6 });
  gauge(M, [0.12, 1.522, zp - 0.04], 0.075, 0.045, 0.9);
  // хомуты к стене
  for (const [x, y, r] of [[-0.28, 0.5, 0.03], [-0.12, 0.5, 0.026], [-0.28, 1.25, 0.03], [0.2, 1.0, 0.016]]) {
    M.tube(C.iron, ring([x, y, zp], r + 0.004, 10, 'xz'), 0.005, { closed: true, seg: 4 });
    M.box(C.iron, x - 0.008, y - 0.008, zp + r, x + 0.008, y + 0.008, zw, 'pz');
  }
}

// ── раковина оранжевая на деревянной тумбе (0.6 × 0.45; реф. 1): чаша прямоугольная с бортиком, слив, кран из стены
//    над чашей (верх 1.0) ──
{
  const M = new Model('p_san_sink');
  M.box(C.woodDk, -0.27, 0, -0.18, 0.27, 0.06, 0.22, 'ny');
  M.box(C.wood, -0.28, 0.06, -0.2, 0.28, 0.7, 0.225, 'ny');
  M.box(C.black, -0.003, 0.1, -0.201, 0.003, 0.66, -0.199, 'pz');
  for (const sx of [-1, 1]) M.box(C.brass, sx * 0.02 - 0.005, 0.5, -0.21, sx * 0.02 + 0.005, 0.58, -0.2, 'pz');
  // чаша: наружные стенки, бортик, внутренние скошенные стенки, дно
  const X = 0.3, Zf = -0.225, Zb = 0.225, y0 = 0.7, y1 = 0.85, t = 0.035, yb = 0.73;
  M.box(C.orange, -X, y0, Zf, X, y1 - 0.001, Zb, 'py');
  const ix = X - t, izf = Zf + t, izb = Zb - t, bx = ix - 0.04, bzf = izf + 0.04, bzb = izb - 0.03;
  M.quad(C.orange, [-X, y1, Zf], [X, y1, Zf], [ix, y1, izf], [-ix, y1, izf], [0, 1, 0]);
  M.quad(C.orange, [-ix, y1, izb], [ix, y1, izb], [X, y1, Zb], [-X, y1, Zb], [0, 1, 0]);
  M.quad(C.orange, [-X, y1, Zf], [-ix, y1, izf], [-ix, y1, izb], [-X, y1, Zb], [0, 1, 0]);
  M.quad(C.orange, [ix, y1, izf], [X, y1, Zf], [X, y1, Zb], [ix, y1, izb], [0, 1, 0]);
  M.quad(C.orange, [-ix, y1, izf], [ix, y1, izf], [bx, yb, bzf], [-bx, yb, bzf], [0, 0.6, 1]);
  M.quad(C.orange, [-bx, yb, bzb], [bx, yb, bzb], [ix, y1, izb], [-ix, y1, izb], [0, 0.6, -1]);
  M.quad(C.orange, [-ix, y1, izf], [-bx, yb, bzf], [-bx, yb, bzb], [-ix, y1, izb], [1, 0.6, 0]);
  M.quad(C.orange, [bx, yb, bzf], [ix, y1, izf], [ix, y1, izb], [bx, yb, bzb], [-1, 0.6, 0]);
  M.quad(C.orange, [-bx, yb, bzf], [bx, yb, bzf], [bx, yb, bzb], [-bx, yb, bzb], [0, 1, 0]);
  M.disc(C.steel, [0, yb + 0.001, 0.01], [0, 1, 0], 0.025, 10);
  M.disc(C.black, [0, yb + 0.002, 0.01], [0, 1, 0], 0.012, 8);
  // кран из стены: излив и два вентиля-«звёздочки»
  M.tube(C.steel, [[0, 0.95, Zb], [0, 0.95, 0.12], [0, 0.94, 0.08], [0, 0.9, 0.06]], 0.011, { seg: 8, caps: 'end' });
  for (const sx of [-1, 1]) {
    M.tube(C.steel, [[sx * 0.07, 0.96, Zb], [sx * 0.07, 0.96, Zb - 0.05]], 0.01, { seg: 6 });
    M.lathe(C.steel, [[0, -0.012], [0.02, -0.012], [0.022, 0], [0, 0.012]], { c: [sx * 0.07, 0.985, Zb - 0.05], seg: 6, crease: 30 });
  }
}

// ── световой короб «…С верой, надеждой, любовью…» (1.6 × 0.12 × 0.3, 2.15…2.45 м; настенное): корпус-пенал со
//    скруглёнными углами, светящееся лицо с надписью (san_rm_slogan_glow), металлический кант ──
{
  const M = new Model('p_san_slogan');
  const y0 = 2.15, y1 = 2.45, zb = 0.06, zf = -0.05;
  const outline = rrect(-0.8, y0, 0.8, y1, 0.07, 5);
  M.prism(C.enamel, 'z', outline, zf, zb, { smooth: 40, caps: false });
  M.poly(C.sloganGlow, outline.map(([x, y]) => [x, y, zf - 0.0005]), [0, 0, -1]);
  M.tube(C.alu, rrect(-0.8, y0, 0.8, y1, 0.07, 5).map(([x, y]) => [x, y, zf]), 0.006, { closed: true, seg: 5 });
}

// ── кушетка медицинская (0.7 × 1.9 × 0.7): белые трубчатые ножки, рама на 0.42…0.48 (под ней — просвет), тюфяк в
//    коричневой клеёнке, приподнятое изголовье у +Z ──
{
  const M = new Model('p_san_couch');
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) M.tube(C.enamel, [[sx * 0.31, 0, sz * 0.9], [sx * 0.31, 0.48, sz * 0.9]], 0.016, { seg: 8, caps: true });
  for (const sx of [-1, 1]) M.box(C.enamel, sx > 0 ? 0.3 : -0.33, 0.42, -0.93, sx > 0 ? 0.33 : -0.3, 0.48, 0.93, '');
  for (const sz of [-1, 1]) M.box(C.enamel, -0.3, 0.42, sz > 0 ? 0.9 : -0.93, 0.3, 0.48, sz > 0 ? 0.93 : -0.9, '');
  M.prism(C.oilcloth, 'z', rrect(-0.345, 0.48, 0.345, 0.6, 0.035, 3), -0.95, 0.5, { smooth: 40 });
  M.at(TR([0, 0.6, 0.5], ['x', -14 * DEG]), () => M.prism(C.oilcloth, 'z', rrect(-0.345, -0.12, 0.345, 0, 0.035, 3), 0, 0.44, { smooth: 40 }));
  // подголовник-валик и простынка
  M.box(C.linen, -0.3, 0.6, -0.6, 0.3, 0.604, 0.45, 'ny');
}

// ── чан с лечебной грязью (1.0 × 0.8 × 0.9): эмалированный бак на уголках, завальцованный борт, грязь бугром почти до
//    края, ковш, потёки грязи по борту, сливной кран ──
{
  const M = new Model('p_san_mud_tank');
  const X0 = 0.46, Z0 = 0.36, X1 = 0.49, Z1 = 0.39, y0 = 0.14, y1 = 0.885;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) M.box(C.iron, sx * 0.44 - 0.025, 0, sz * 0.34 - 0.025, sx * 0.44 + 0.025, y0, sz * 0.34 + 0.025, 'ny');
  M.box(C.iron, -0.45, 0.1, -0.35, 0.45, y0, 0.35, '');
  // стенки чуть расширяются кверху
  const P = (sx, sz, top) => [sx * (top ? X1 : X0), top ? y1 : y0, sz * (top ? Z1 : Z0)];
  const walls = [[[-1, -1], [1, -1], [0, 0, -1]], [[1, -1], [1, 1], [1, 0, 0]], [[1, 1], [-1, 1], [0, 0, 1]], [[-1, 1], [-1, -1], [-1, 0, 0]]];
  for (const [[ax, az], [bx, bz], n] of walls) {
    M.quad(C.enamel, P(ax, az, false), P(bx, bz, false), P(bx, bz, true), P(ax, az, true), n);
    const t = (0.74 - y0) / (y1 - y0), Q = (sx, sz) => [sx * lerp(X0, X1, t), 0.74, sz * lerp(Z0, Z1, t)];
    M.quad(C.enamel, Q(ax, az), Q(bx, bz), P(bx, bz, true), P(ax, az, true), mul(n, -1));
  }
  M.box(C.enamel, -X0, y0 - 0.005, -Z0, X0, y0, Z0, 'py');
  M.tube(C.enamel, [[-X1, y1, -Z1], [X1, y1, -Z1], [X1, y1, Z1], [-X1, y1, Z1]], 0.012, { closed: true, seg: 6 });
  // грязь — бугристая поверхность
  M.surface(C.mud, 14, 12, (u, v) => {
    const x = lerp(-X1 + 0.012, X1 - 0.012, u), z = lerp(-Z1 + 0.012, Z1 - 0.012, v);
    const e = Math.min(u, 1 - u, v, 1 - v);
    return [x, 0.83 + 0.02 * Math.sin(x * 9 + 1) * Math.cos(z * 11) + 0.025 * smooth(0, 0.3, e) * fbm(u, v, 3, 3, 2, 7), z];
  }, [0, 1, 0]);
  // ковш: черпак в грязи, ручка на бортике
  M.lathe(C.alu, [[0, 0], [0.06, 0.005], [0.075, 0.07], [0.072, 0.07], [0.055, 0.008]], { c: [-0.15, 0.81, 0.05], seg: 12 });
  M.tube(C.alu, [[-0.08, 0.85, 0.05], [0.25, 0.884, 0.02], [0.47, 0.888, -0.05]], 0.01, { seg: 6, caps: true });
  // грязь перевалилась через борт: комья на бортике
  for (const [px, pz] of [[-0.3, -Z1], [0.15, -Z1], [X1, 0.1], [-0.42, Z1]]) M.blob(C.mud, [px, y1 + 0.004, pz], 0.05, 0.012, 0.035, 3, 8);
  // сливной кран
  M.tube(C.iron, [[0.3, 0.2, -Z0], [0.3, 0.2, -Z0 - 0.06], [0.3, 0.17, -Z0 - 0.08]], 0.018, { seg: 8, caps: 'end' });
  M.box(C.red, 0.26, 0.225, -Z0 - 0.05, 0.34, 0.235, -Z0 - 0.035, '');
}

// ── стол врача (1.2 × 0.7 × 0.76) на четырёх ножках, царга с ящиком 0.64…0.73 (просвет TABLE_CLEAR_M), вставка
//    зелёного сукна; на столе — лампа с зелёным абажуром, стопка карточек, папка, стакан с ручками ──
{
  const M = new Model('p_san_desk');
  M.box(C.wood, -0.6, 0.73, -0.35, 0.6, 0.76, 0.35, '');
  M.quad(C.baize, [-0.5, 0.7605, -0.25], [-0.5, 0.7605, 0.27], [0.5, 0.7605, 0.27], [0.5, 0.7605, -0.25], [0, 1, 0]);
  M.box(C.woodDk, -0.56, 0.64, -0.32, 0.56, 0.73, -0.3, '');
  M.box(C.woodDk, -0.56, 0.64, 0.3, 0.56, 0.73, 0.32, '');
  M.box(C.woodDk, -0.56, 0.64, -0.3, -0.54, 0.73, 0.3, '');
  M.box(C.woodDk, 0.54, 0.64, -0.3, 0.56, 0.73, 0.3, '');
  M.box(C.wood, -0.24, 0.648, -0.327, 0.24, 0.722, -0.32, 'pz');
  M.box(C.brass, -0.05, 0.68, -0.335, 0.05, 0.69, -0.327, 'pz');
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) leg(M, C.woodDk, sx * 0.56, sz * 0.31, sx * 0.55, 0.73, sz * 0.31, 0.035, 0.05);
  // лампа: основание, стойка, колено, абажур
  M.lathe(C.black, [[0, 0], [0.08, 0], [0.075, 0.025], [0.02, 0.035], [0, 0.035]], { c: [-0.4, 0.76, 0.16], seg: 12 });
  M.tube(C.brass, [[-0.4, 0.795, 0.16], [-0.4, 1.05, 0.16], [-0.33, 1.1, 0.1]], 0.008, { seg: 6 });
  M.lathe(C.baize, [[0.105, -0.03], [0.1, -0.02], [0.06, 0.03], [0.025, 0.06]], { c: [-0.3, 1.1, 0.07], seg: 14, crease: 60 });
  M.disc(C.paper, [-0.3, 1.071, 0.07], [0, -1, 0], 0.09, 12);
  // карточки, папка, стакан с ручками
  M.box(C.paper, 0.05, 0.761, -0.15, 0.3, 0.81, 0.02, 'ny');
  M.box(C.kraft, 0.05, 0.81, -0.15, 0.3, 0.813, 0.02, 'ny');
  M.at(TR([0.0, 0.761, 0.15], ['y', 0.25]), () => M.box(C.kraft, -0.15, 0, -0.1, 0.15, 0.01, 0.1, 'ny'));
  M.lathe(C.glass, [[0, 0], [0.03, 0], [0.033, 0.1], [0, 0.1]], { c: [0.45, 0.761, 0.18], seg: 8 });
  for (const [dx, dz, c] of [[0.005, 0, C.black], [-0.01, 0.01, C.red], [0.01, -0.01, C.black]]) M.tube(c, [[0.45 + dx, 0.79, 0.18 + dz], [0.45 + dx * 3, 0.91, 0.18 + dz * 3]], 0.004, { seg: 4, caps: true });
}

// ── шкаф медицинский (0.8 × 0.4 × 1.8): белая эмаль, низ — глухие дверцы с красным крестом, верх — переплёты
//    дверец без стёкол (прозрачности нет) и молочные боковые стёкла, стеклянные полки с флаконами и банками ──
{
  const M = new Model('p_san_med_cabinet');
  const X = 0.4, Zf = -0.2, Zb = 0.2;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) M.box(C.enamel, sx * 0.37 - 0.02, 0, sz * 0.17 - 0.02, sx * 0.37 + 0.02, 0.1, sz * 0.17 + 0.02, 'ny');
  M.box(C.enamel, -X, 0.1, Zf, X, 0.62, Zb, '');
  M.box(C.black, -0.003, 0.13, Zf - 0.001, 0.003, 0.6, Zf + 0.002, 'pz');
  // красный крест на левой дверце
  M.box(C.red, -0.24, 0.33, Zf - 0.002, -0.16, 0.35, Zf, 'pz');
  M.box(C.red, -0.21, 0.30, Zf - 0.002, -0.19, 0.38, Zf, 'pz');
  // верх: стойки, полки, крышка, задняя стенка
  M.box(C.enamel, -X, 1.75, Zf, X, 1.8, Zb, 'ny');
  M.box(C.enamel, -X, 0.62, Zb - 0.01, X, 1.75, Zb, '');
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) M.box(C.enamel, sx > 0 ? X - 0.025 : -X, 0.62, sz > 0 ? Zb - 0.025 : Zf, sx > 0 ? X : -X + 0.025, 1.75, sz > 0 ? Zb : Zf + 0.025, '');
    // молочные боковые стёкла
    M.box(C.glass, sx > 0 ? X - 0.012 : -X + 0.008, 0.62, Zf + 0.025, sx > 0 ? X - 0.008 : -X + 0.012, 1.75, Zb - 0.025, '');
    // переплёт дверцы
    const x0 = sx > 0 ? 0.005 : -X + 0.025, x1 = sx > 0 ? X - 0.025 : -0.005;
    M.box(C.enamel, x0, 0.62, Zf - 0.01, x1, 0.66, Zf + 0.01, '');
    M.box(C.enamel, x0, 1.71, Zf - 0.01, x1, 1.75, Zf + 0.01, '');
    M.box(C.enamel, sx > 0 ? x0 : x1 - 0.03, 0.66, Zf - 0.01, sx > 0 ? x0 + 0.03 : x1, 1.71, Zf + 0.01, '');
    M.box(C.enamel, sx > 0 ? x1 - 0.03 : x0, 0.66, Zf - 0.01, sx > 0 ? x1 : x0 + 0.03, 1.71, Zf + 0.01, '');
    M.box(C.enamel, x0 + 0.03, 1.175, Zf - 0.008, x1 - 0.03, 1.195, Zf + 0.008, '');
    M.box(C.steel, sx * 0.03 - 0.006, 1.1, Zf - 0.025, sx * 0.03 + 0.006, 1.2, Zf - 0.01, '');
  }
  for (const y of [0.9, 1.18, 1.46]) M.box(C.glass, -X + 0.025, y - 0.006, Zf + 0.03, X - 0.025, y, Zb - 0.01, '');
  // флаконы и банки
  const items = [[0.62, -0.3], [0.62, -0.18], [0.62, 0.05], [0.62, 0.22], [0.9, -0.28], [0.9, -0.1], [0.9, 0.12], [0.9, 0.28], [1.18, -0.25], [1.18, 0.0], [1.18, 0.2], [1.46, -0.2], [1.46, 0.15]];
  items.forEach(([y, x], k) => {
    const z = rr(-0.05, 0.08), h = rr(0.08, 0.17), r = rr(0.022, 0.04);
    const m = [C.glassBrown, C.paper, C.glass, C.glassBrown, C.enamel][k % 5];
    M.lathe(m, [[0, 0], [r, 0], [r, h * 0.75], [r * 0.45, h * 0.85], [r * 0.45, h], [0, h]], { c: [x, y + (y === 0.62 ? 0.0 : 0.0), z], seg: 8 });
  });
  M.box(C.paper, 0.05, 0.62, -0.05, 0.2, 0.7, 0.1, 'ny');
  M.box(C.kraft, -0.1, 1.46, -0.04, 0.05, 1.5, 0.12, 'ny');
}

// ── весы медицинские с ростомером (0.5 × 0.6 × 2.0): чугунная платформа с резиновым ковриком, белая колонка, коромысло
//    со шкалой и гирями, планка ростомера до 2.0 с подвижной головной планкой ──
{
  const M = new Model('p_san_scale');
  M.box(C.iron, -0.25, 0, -0.3, 0.25, 0.08, 0.18, '');
  M.box(C.black, -0.21, 0.08, -0.27, 0.21, 0.086, 0.12, 'ny');
  M.box(C.iron, -0.08, 0, 0.18, 0.08, 0.1, 0.3, '');
  M.box(C.enamel, -0.035, 0.1, 0.2, 0.035, 1.3, 0.27, 'ny');
  // голова с коромыслом
  M.box(C.enamel, -0.07, 1.3, 0.18, 0.07, 1.45, 0.29, '');
  M.box(C.paper, -0.25, 1.36, 0.17, 0.2, 1.4, 0.19, '');
  for (let k = 0; k <= 18; k++) M.box(C.black, -0.24 + k * 0.024, 1.385, 0.169, -0.24 + k * 0.024 + 0.003, 1.4, 0.17, 'pz');
  M.box(C.iron, -0.12, 1.355, 0.16, -0.09, 1.405, 0.195, '');
  M.box(C.iron, 0.04, 1.37, 0.165, 0.055, 1.395, 0.19, '');
  M.box(C.enamel, 0.2, 1.33, 0.165, 0.24, 1.43, 0.2, '');
  // ростомер: планка со шкалой, головная планка
  M.box(C.woodLt, -0.025, 0.1, 0.27, 0.025, 2.0, 0.29, '');
  for (let y = 0.5; y < 1.98; y += 0.05) M.box(C.black, -0.025, y, 0.2695, y % 0.1 < 0.05 ? 0.01 : -0.005, y + 0.004, 0.27, 'pz');
  M.box(C.enamel, -0.04, 1.72, 0.26, 0.04, 1.78, 0.3, '');
  M.box(C.enamel, -0.06, 1.745, 0.02, 0.06, 1.758, 0.26, '');
}

// ── пульт душа Шарко (1.2 × 0.6 × 1.2): кафельная тумба, наклонная стальная панель с вентилями и рычагами, задний щит
//    с двумя манометрами и термометром, шланги (чёрный и красный) петлями до пола, латунный брандспойт на крюке ──
{
  const M = new Model('p_san_charcot_desk');
  const X = 0.6, Zf = -0.3, Zb = 0.3;
  M.box(C.tile, -X, 0, Zf + 0.05, X, 0.95, Zb, 'ny');
  M.box(C.iron, -X + 0.02, 0, Zf + 0.04, X - 0.02, 0.08, Zf + 0.05, 'ny');
  // наклонная панель
  const a = [-X, 0.95, Zf + 0.02], b = [X, 0.95, Zf + 0.02], c = [X, 1.02, 0.15], d = [-X, 1.02, 0.15];
  M.quad(C.steel, a, b, c, d, [0, 0.95, -0.3]);
  M.quad(C.steel, a, b, [X, 0.92, Zf + 0.02], [-X, 0.92, Zf + 0.02], [0, 0, -1]);
  for (const [p, q, n] of [[a, d, [-1, 0, 0]], [b, c, [1, 0, 0]]]) M.poly(C.steel, [p, q, [p[0], 0.95, 0.15]], n);
  // щит с манометрами
  M.box(C.iron, -X + 0.05, 0.95, 0.15, X - 0.05, 1.2, 0.2, '');
  gauge(M, [-0.25, 1.1, 0.115], 0.08, 0.04, -0.4);
  gauge(M, [0.15, 1.1, 0.115], 0.08, 0.04, 0.7);
  // термометр
  M.box(C.paper, 0.38, 0.98, 0.143, 0.44, 1.18, 0.15, '');
  M.box(C.red, 0.405, 1.0, 0.141, 0.415, 1.11, 0.143, '');
  // вентили на панели (маховики, наклонённые с панелью) и рычаги
  const tilt = Math.atan2(0.07, 0.43);
  for (const x of [-0.4, -0.1, 0.2]) {
    M.at(TR([x, 0.966, -0.18], ['x', PI / 2 - tilt]), () => {
      M.tube(C.iron, [[0, 0, 0], [0, 0, -0.05]], 0.01, { seg: 6 });
      handwheel(M, C.red, [0, 0, -0.055], 0.045);
    });
  }
  for (const x of [0.42, 0.5]) M.tube(C.black, [[x, 0.98, -0.12], [x, 1.1, -0.2]], 0.01, { seg: 6, caps: true });
  // шланги из передней кромки: петлями до пола, к крюку сбоку (+X)
  const hose = (m, x0, sag, dz) => {
    const pts = [];
    for (let k = 0; k <= 16; k++) {
      const t = k / 16;
      const x = lerp(x0, X + 0.04, t), y = lerp(0.9, 0.75, t) - sag * Math.sin(PI * t) ** 1.3;
      pts.push([x, Math.max(0.025, y), Zf - 0.03 + dz * Math.sin(PI * t)]);
    }
    M.tube(m, pts, 0.02, { seg: 8 });
  };
  M.tube(C.black, [[-0.2, 0.93, Zf + 0.02], [-0.2, 0.9, Zf - 0.03]], 0.02, { seg: 8 });
  M.tube(C.red, [[0.0, 0.93, Zf + 0.02], [0.0, 0.9, Zf - 0.03]], 0.02, { seg: 8 });
  hose(C.black, -0.2, 0.85, -0.04);
  hose(C.red, 0.0, 0.7, 0.03);
  // крюк на боку и брандспойт
  M.tube(C.iron, [[X, 0.78, 0.05], [X + 0.05, 0.78, 0.05], [X + 0.06, 0.82, 0.05]], 0.008, { seg: 5 });
  M.tube(C.black, [[X + 0.04, 0.75, Zf - 0.03], [X + 0.05, 0.8, -0.12], [X + 0.05, 0.81, 0.0], [X + 0.05, 0.74, 0.05]], 0.02, { seg: 8 });
  M.at(TR([X + 0.05, 0.74, 0.05], ['x', PI]), () => M.lathe(C.brass, [[0.022, 0], [0.018, 0.12], [0.008, 0.2], [0, 0.2]], { seg: 10 }));
  // трубы в пол позади
  for (const x of [-0.45, 0.45]) M.tube(C.pipe, [[x, 0, 0.27], [x, 0.95, 0.27]], 0.02, { seg: 8 });
}

// ── стол обеденный со скатертью (1.2 × 0.8 × 0.76): белая скатерть складками до 0.63 от пола (просвет
//    TABLE_CLEAR_M), ножки под ней; салфетница, солонка, вазочка с веточкой ──
{
  const M = new Model('p_san_dining_table');
  const X = 0.6, Z = 0.4, top = 0.762, hem = 0.63;
  M.box(C.woodDk, -0.55, 0.725, -0.35, 0.55, 0.757, 0.35, 'py');
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) leg(M, C.woodDk, sx * 0.5, sz * 0.3, sx * 0.5, 0.725, sz * 0.3, 0.035, 0.045);
  M.quad(C.linen, [-X, top, -Z], [-X, top, Z], [X, top, Z], [X, top, -Z], [0, 1, 0]);
  // свес складками: по стороне — синусоида, на углах складки сходятся в 0
  const sides = [[[-X, -Z], [X, -Z], [0, 0, -1]], [[X, -Z], [X, Z], [1, 0, 0]], [[X, Z], [-X, Z], [0, 0, 1]], [[-X, Z], [-X, -Z], [-1, 0, 0]]];
  for (const [[ax, az], [bx, bz], n] of sides) {
    const L = Math.hypot(bx - ax, bz - az), folds = Math.round(L / 0.2);
    M.surface(C.linen, folds * 6, 3, (u, v) => {
      const off = 0.004 + 0.014 * v * Math.sin(PI * folds * u) ** 2;
      return [lerp(ax, bx, u) + n[0] * off, lerp(top, hem, v) + (v > 0.99 ? 0.004 * Math.sin(PI * folds * u * 2) : 0), lerp(az, bz, u) + n[2] * off];
    }, n);
  }
  // салфетница: две пластины веером и салфетки
  M.at(TR([0, top, 0], ['y', 0.3]), () => {
    M.box(C.enamel, -0.06, 0, -0.025, 0.06, 0.012, 0.025, 'ny');
    for (const s of [-1, 1]) M.at(TR([0, 0.012, s * 0.02], ['x', s * 0.18]), () => M.box(C.enamel, -0.06, 0, -0.003, 0.06, 0.09, 0.003, ''));
    for (const s of [-1, 0, 1]) M.at(TR([0, 0.012, s * 0.006], ['x', s * 0.12]), () => M.box(C.paper, -0.055, 0, -0.002, 0.055, 0.1, 0.002, ''));
  });
  M.lathe(C.paper, [[0, 0], [0.018, 0], [0.018, 0.05], [0.012, 0.065], [0, 0.07]], { c: [0.15, top, -0.08], seg: 8 });
  M.lathe(C.glass, [[0, 0], [0.03, 0], [0.04, 0.05], [0.02, 0.12], [0.025, 0.15], [0, 0.15]], { c: [-0.18, top, 0.06], seg: 10, crease: 60 });
  M.tube(C.glassGreen, [[-0.18, top + 0.13, 0.06], [-0.17, top + 0.25, 0.07], [-0.14, top + 0.33, 0.06]], 0.004, { seg: 4 });
  for (const [dx, dy, dz] of [[0.03, 0.22, 0.02], [-0.02, 0.27, 0.0], [0.04, 0.31, -0.01]]) M.blob(C.glassGreen, [-0.18 + dx, top + dy, 0.06 + dz], 0.025, 0.006, 0.014, 2, 6);
}

// ── раздаточная стойка столовой (2.4 × 0.6 × 1.0): корпус в шпоне, стальная столешница на 0.9, на переде — трубчатые
//    направляющие для подносов, сзади — полка на стойках (верх 1.0); подносы, гранёные стаканы, бак с крышкой ──
{
  const M = new Model('p_san_buffet');
  const X = 1.2;
  M.box(C.woodDk, -X + 0.03, 0, -0.1, X - 0.03, 0.08, 0.28, 'ny');
  M.box(C.wood, -X, 0.08, -0.12, X, 0.88, 0.3, 'ny');
  for (let k = 1; k < 4; k++) M.box(C.black, -X + k * 0.6 - 0.003, 0.1, -0.122, -X + k * 0.6 + 0.003, 0.86, -0.12, 'pz');
  M.box(C.steel, -X, 0.88, -0.15, X, 0.9, 0.3, '');
  // направляющие для подносов
  for (const z of [-0.2, -0.245, -0.29]) M.tube(C.steel, [[-X, 0.8, z], [X, 0.8, z]], 0.012, { seg: 6, caps: true });
  for (const x of [-1.1, -0.4, 0.4, 1.1]) M.box(C.steel, x - 0.01, 0.78, -0.3, x + 0.01, 0.795, -0.12, '');
  // полка сзади
  for (const x of [-1.15, 0, 1.15]) M.tube(C.steel, [[x, 0.9, 0.26], [x, 0.99, 0.26]], 0.01, { seg: 6 });
  M.box(C.glass, -X, 0.985, 0.18, X, 1.0, 0.3, '');
  // стопка подносов на направляющих у края
  for (let k = 0; k < 6; k++) M.box(C.alu, -1.15, 0.812 + k * 0.012, -0.3, -0.75, 0.82 + k * 0.012, -0.13, '');
  // гранёные стаканы на подносе
  M.box(C.alu, -0.4, 0.9, -0.05, 0.1, 0.908, 0.22, 'ny');
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) M.lathe(C.glass, [[0, 0], [0.03, 0], [0.036, 0.105], [0, 0.105]], { c: [-0.33 + i * 0.12, 0.908, 0.01 + j * 0.08], seg: 8 });
  // бак с крышкой и ручками
  M.lathe(C.alu, [[0, 0], [0.17, 0], [0.17, 0.26], [0, 0.26]], { c: [0.7, 0.9, 0.06], seg: 16 });
  M.lathe(C.alu, [[0.175, 0], [0.12, 0.02], [0.02, 0.03], [0.02, 0.05], [0, 0.05]], { c: [0.7, 1.16, 0.06], seg: 16, crease: 30 });
  for (const s of [-1, 1]) M.tube(C.alu, [[0.7 + s * 0.17, 1.1, 0.06], [0.7 + s * 0.21, 1.1, 0.06], [0.7 + s * 0.21, 1.08, 0.06]], 0.008, { seg: 5 });
}

// ── вскрытый пол (0.8 × 4.0 × 0.02; накладное): тёмная щель — сняты доски до лаг: поперечные лаги, засыпка с мусором,
//    по краям — торцы жёлтых крашеных досок с обломанными концами ──
{
  const M = new Model('p_san_floor_gap');
  const X = 0.4, Z = 2.0, hx = 0.33, top = 0.02;
  // дно — засыпка (тёмная земля), у кромок — густая тень (кажется глубже)
  M.quad(C.fill, [-hx, 0.001, -Z + 0.04], [-hx, 0.001, Z - 0.04], [hx, 0.001, Z - 0.04], [hx, 0.001, -Z + 0.04], [0, 1, 0]);
  for (const s of [-1, 1]) {
    const a = s * hx, b = s * (hx - 0.07);
    M.quad(C.void, [Math.min(a, b), 0.0015, -Z + 0.04], [Math.min(a, b), 0.0015, Z - 0.04], [Math.max(a, b), 0.0015, Z - 0.04], [Math.max(a, b), 0.0015, -Z + 0.04], [0, 1, 0]);
  }
  // лаги поперёк: светлый верх, тёмные бока
  for (let k = 0; k < 7; k++) {
    const z = -1.8 + k * 0.6;
    M.box(C.joist, -hx, 0.002, z - 0.045, hx, 0.01, z + 0.045, 'ny');
  }
  // засыпка: редкие камешки и обломки кирпича
  for (let k = 0; k < 22; k++) {
    const px = rr(-hx + 0.08, hx - 0.08), pz = rr(-Z + 0.1, Z - 0.1), r = rr(0.012, 0.03);
    M.pebble(k % 3 === 0 ? C.brick : C.dust, [px, 0.002, pz], r, r * 0.4, rnd() * 2 * PI);
  }
  // края: доски по длинным сторонам, торцы и обломанные концы
  for (const s of [-1, 1]) {
    const x0 = s * hx, x1 = s * X;
    M.box(C.board, Math.min(x0, x1), 0.001, -Z, Math.max(x0, x1), top, Z, 'ny');
    M.quad(C.woodDk, [x0, 0.001, -Z], [x0, top, -Z], [x0, top, Z], [x0, 0.001, Z], [-s, 0, 0]);
    // обломки досок, торчащие в щель
    for (const [z, len] of [[-1.4, 0.12], [-0.3, 0.07], [0.9, 0.15], [1.6, 0.06]]) {
      const zz = z + (s > 0 ? 0.25 : 0);
      M.poly(C.board, [[x0, top, zz - 0.05], [x0, top, zz + 0.05], [x0 - s * len, top - 0.004, zz + 0.02], [x0 - s * len * 0.6, top - 0.004, zz - 0.05]], [0, 1, 0]);
    }
  }
  // торцы по коротким сторонам — поперечная доска-порог
  for (const s of [-1, 1]) M.box(C.board, -hx, 0.001, s > 0 ? Z - 0.04 : -Z, hx, top, s > 0 ? Z : -Z + 0.04, 'ny');
}

// ── рулон линолеума (2.0 × 0.3 × 0.3): цилиндр вдоль X, торцы с витками, тёмная середина ──
{
  const M = new Model('p_san_lino_roll');
  const r = 0.14, L = 1.0;
  M.lathe(C.lino, [[r, -L], [r, L]], { c: [0, r, 0], axis: 'x', seg: 18 });
  for (const s of [-1, 1]) {
    M.disc(C.dust, [s * L, r, 0], [s, 0, 0], r, 18);
    for (let k = 1; k <= 6; k++) M.tube(C.lino, ring([s * L + s * 0.001, r, 0], r * (k / 7), 18, 'yz'), 0.003, { closed: true, seg: 3 });
    M.disc(C.void, [s * (L + 0.002), r, 0], [s, 0, 0], 0.03, 10);
  }
  // кромка последнего витка (чуть отстала) и следы-полосы рисунка
  M.box(C.lino, -L, 0.002, 0.0, L, 0.006, 0.13, 'ny');
  for (const f of [0.6, 1.9, 3.4]) M.tube(C.dust, [[-L, r + Math.sin(f) * (r + 0.0005), Math.cos(f) * (r + 0.0005)], [L, r + Math.sin(f) * (r + 0.0005), Math.cos(f) * (r + 0.0005)]], 0.0025, { seg: 3 });
}

// ── лопата, прислонённая к стене (0.3 × 0.2 × 1.4; настенное): штык внизу у пола, черенок к стене ──
{
  const M = new Model('p_san_shovel');
  const lean = Math.atan2(0.17, 1.35);
  M.at(TR([0, 0, -0.075], ['x', lean]), () => {
    // штык: слегка выгнутое полотно с плечиками и острым низом
    M.surface(C.iron, 6, 6, (u, v) => {
      const x = lerp(-0.11, 0.11, u) * (1 - 0.35 * (1 - v) ** 3), y = lerp(0.0, 0.3, v);
      return [x, y + (1 - v) * 0.03 * (1 - Math.abs(2 * u - 1)), -0.012 * Math.cos(PI * (u - 0.5))];
    }, [0, 0, -1]);
    M.surface(C.rust, 6, 6, (u, v) => {
      const x = lerp(-0.11, 0.11, u) * (1 - 0.35 * (1 - v) ** 3), y = lerp(0.0, 0.3, v);
      return [x, y + (1 - v) * 0.03 * (1 - Math.abs(2 * u - 1)), -0.012 * Math.cos(PI * (u - 0.5)) + 0.002];
    }, [0, 0, 1]);
    M.tube(C.iron, [[0, 0.25, -0.01], [0, 0.42, -0.01]], 0.022, { seg: 8 });
    M.tube(C.woodLt, [[0, 0.4, -0.01], [0, 1.395, -0.01]], 0.018, { seg: 8, caps: 'end' });
  });
}

// ── моток провода на гвозде (0.5 × 0.15, 1.0…1.75 м; настенное): гвоздь, витки белого провода висят петлями, конец
//    свисает вниз ──
{
  const M = new Model('p_san_wire_coil');
  const nail = [0, 1.72, 0.0];
  M.tube(C.iron, [[0, 1.72, 0.075], [0, 1.72, -0.005]], 0.003, { seg: 4, caps: 'end' });
  M.disc(C.iron, [0, 1.72, -0.005], [0, 0, -1], 0.007, 6);
  for (let k = 0; k < 11; k++) {
    const rx = rr(0.17, 0.22), ry = rr(0.2, 0.24), z0 = 0.04 - k * 0.0035, tilt = rr(-0.1, 0.1);
    const pts = [];
    for (let s = 0; s < 22; s++) {
      const f = PI / 2 + (s / 22) * 2 * PI;
      const x = Math.cos(f) * rx, y = Math.sin(f) * ry;
      pts.push([nail[0] + x + y * tilt, nail[1] - ry + y + 0.004, z0 + 0.02 * Math.cos(f)]);
    }
    M.tube(k % 4 === 3 ? C.dust : C.linen, pts, 0.0035, { closed: true, seg: 4 });
  }
  M.tube(C.linen, [[0.12, 1.3, 0.035], [0.15, 1.2, 0.04], [0.13, 1.1, 0.05], [0.16, 1.02, 0.06], [0.2, 1.0, 0.06]], 0.0035, { seg: 4 });
}

// ── провод с потолка (0.2 × 0.2, свисает на 0.6; подвесное): розетка-чашка, чёрный и белый провода, у одного —
//    зачищенный медный конец ──
{
  const M = new Model('p_san_hanging_wire', { ceil: true });
  M.lathe(C.plaster, [[0, -0.022], [0.03, -0.022], [0.05, -0.012], [0.05, 0]], { seg: 12 });
  M.tube(C.black, [[0, -0.02, 0], [0.005, -0.12, 0.01], [0.03, -0.3, 0.03], [0.06, -0.42, 0.05], [0.07, -0.5, 0.04], [0.06, -0.56, 0.02]], 0.004, { seg: 5 });
  M.tube(C.linen, [[0.005, -0.02, 0], [0.0, -0.15, -0.01], [-0.03, -0.32, -0.04], [-0.05, -0.45, -0.06], [-0.04, -0.58, -0.07]], 0.004, { seg: 5 });
  M.tube(C.brass, [[-0.04, -0.58, -0.07], [-0.038, -0.6, -0.072]], 0.0018, { seg: 4, caps: 'end' });
  M.tube(C.brass, [[0.06, -0.56, 0.02], [0.055, -0.575, 0.018]], 0.0018, { seg: 4, caps: 'end' });
}

// ── мешки с цементом (0.6 × 0.4 × 0.3): нижний — крафт, верхний — белый с красной полосой, рваный угол, просыпанный
//    серый порошок ──
{
  const M = new Model('p_san_cement_bag');
  const sack = (m, cx, cy, cz, L, W, H, yaw) => M.at(TR([cx, cy, cz], ['y', yaw]), () => {
    M.surface(m, 12, 8, (u, v) => {
      // «подушка»: сечение — суперэллипс, к торцам сплющивается
      const f = u * 2 * PI, e = 1 - Math.abs(2 * v - 1) ** 3;
      const cy2 = Math.sin(f), cz2 = Math.cos(f);
      const sy = Math.sign(cy2) * Math.abs(cy2) ** 0.6, sz2 = Math.sign(cz2) * Math.abs(cz2) ** 0.4;
      return [lerp(-L / 2, L / 2, v), H / 2 + sy * (H / 2) * (0.25 + 0.75 * e), sz2 * (W / 2) * (0.85 + 0.15 * e)];
    }, (u, v, p) => [0, p[1] - H / 2, p[2]]);
  });
  sack(C.kraft, 0, 0, 0.02, 0.56, 0.36, 0.15, 0.05);
  sack(C.paper, 0.02, 0.13, 0.0, 0.52, 0.34, 0.15, -0.12);
  M.at(TR([0.02, 0.13, 0.0], ['y', -0.12]), () => {
    M.surface(C.red, 2, 2, (u, v) => [lerp(-0.08, 0.04, u), 0.153, lerp(-0.13, 0.13, v)], [0, 1, 0]);
  });
  // просыпанный цемент
  const pts = [];
  for (let k = 0; k < 12; k++) {
    const f = (k / 12) * 2 * PI, q = rr(0.8, 1.15);
    pts.push([-0.22 + Math.cos(f) * 0.07 * q, 0.002, -0.15 + Math.sin(f) * 0.045 * q]);
  }
  M.poly(C.dust, pts, [0, 1, 0]);
}

// ── стремянка деревянная (0.6 × 1.2 × 1.8), раскрытая: передние тетивы со ступенями, задние опоры, площадка наверху,
//    распорки; брызги белой краски ──
{
  const M = new Model('p_san_ladder');
  const zf = -0.58, zb = 0.58, top = 1.78;
  for (const s of [-1, 1]) {
    strut(M, C.woodLt, [s * 0.27, 0, zf + 0.035], [s * 0.21, top - 0.02, -0.06], 0.035, 0.07);
    strut(M, C.woodLt, [s * 0.27, 0, zb - 0.025], [s * 0.21, top - 0.02, 0.06], 0.035, 0.05);
    // распорка
    M.beam(C.iron, [s * 0.255, 0.75, lerp(zf, -0.06, 0.42)], [s * 0.255, 0.75, lerp(zb, 0.06, 0.42)], 0.01, 0.025, [0, 1, 0]);
  }
  for (let k = 1; k <= 5; k++) {
    const t = k / 6.2, y = lerp(0, top, t), z = lerp(zf, -0.06, t), hw = lerp(0.27, 0.21, t) - 0.015;
    M.box(C.woodLt, -hw, y - 0.012, z - 0.05, hw, y + 0.012, z + 0.05, '');
  }
  M.box(C.woodLt, -0.24, top - 0.02, -0.12, 0.24, top + 0.02, 0.12, '');
  // брызги краски
  for (let k = 0; k < 14; k++) {
    const t = rr(0.1, 0.9), s = rnd() < 0.5 ? -1 : 1;
    const p = [lerp(s * 0.27, s * 0.21, t) - s * 0.0185, lerp(0, top, t), lerp(zf, -0.06, t)];
    M.disc(C.paper, p, [-s, 0, 0], rr(0.005, 0.012), 6);
  }
  for (let k = 0; k < 6; k++) M.disc(C.paper, [rr(-0.2, 0.2), top + 0.0205, rr(-0.1, 0.1)], [0, 1, 0], rr(0.008, 0.02), 6);
}

// ── мусор и штукатурка (1.2 × 1.0 × 0.1; накладное): пятна пыли, куски штукатурки, обломки кирпича, обрывки дранки ──
{
  const M = new Model('p_san_debris');
  for (const [cx, cz, rx, rz] of [[0, 0, 0.55, 0.45], [-0.3, 0.2, 0.25, 0.2], [0.3, -0.25, 0.2, 0.18]]) {
    const pts = [];
    for (let k = 0; k < 14; k++) {
      const f = (k / 14) * 2 * PI, q = rr(0.8, 1.05);
      pts.push([cx + Math.cos(f) * rx * q, 0.0015 + (cx ? 0.0005 : 0), cz + Math.sin(f) * rz * q]);
    }
    M.poly(cx ? C.plaster : C.dust, pts, [0, 1, 0]);
  }
  for (let k = 0; k < 40; k++) {
    const px = rr(-0.5, 0.5), pz = rr(-0.42, 0.42), r = rr(0.015, 0.06);
    M.pebble(k % 5 === 0 ? C.brick : k % 3 ? C.plaster : C.dust, [px, 0.001, pz], r, Math.min(0.09, r * rr(0.4, 1.1)), rnd() * 2 * PI);
  }
  for (let k = 0; k < 5; k++) {
    const a = rr(0, PI), cx = rr(-0.35, 0.35), cz = rr(-0.3, 0.3), L = rr(0.25, 0.45);
    const p0 = [cx - Math.cos(a) * L / 2, 0.008, cz - Math.sin(a) * L / 2], p1 = [cx + Math.cos(a) * L / 2, 0.012 + rr(0, 0.03), cz + Math.sin(a) * L / 2];
    M.beam(C.woodLt, p0, p1, 0.025, 0.008, [0, 1, 0]);
  }
  for (let k = 0; k < 3; k++) M.box(C.brick, -0.4 + k * 0.3, 0.001, 0.25 - k * 0.2, -0.4 + k * 0.3 + 0.12, 0.065, 0.25 - k * 0.2 + 0.06, 'ny');
}

// ═════════════════════════ запись и сверка ═════════════════════════

/** План w × d (м) и верх модели над полом, м (у подвесных — насколько спускается от потолка). */
const EXPECT = {
  p_san_bed: [0.9, 2.0, 0.85],
  p_san_bed_frame: [0.9, 2.0, 0.85],
  p_san_nightstand: [0.45, 0.4, 0.6],
  p_san_wardrobe: [1.0, 0.55, 2.0],
  p_san_table: [0.9, 0.6, 1.016], // графин на столе; столешница — 0.75
  p_san_chair: [0.45, 0.45, 0.9],
  p_san_armchair: [0.75, 0.75, 0.85],
  p_san_rug: [2.0, 3.0, 0.007],
  p_san_hydro_bath: [3.0, 1.6, 0.9],
  p_san_tile_wall: [3.0, 0.05, 2.4],
  p_san_tile_mural: [1.8, 0.08, 2.2],
  p_san_pipes_gauge: [0.8, 0.2, 1.6],
  p_san_sink: [0.6, 0.45, 0.997], // кран из стены над чашей; чаша — 0.85
  p_san_slogan: [1.6, 0.12, 2.456],
  p_san_couch: [0.7, 1.9, 0.7],
  p_san_mud_tank: [1.0, 0.8, 0.897],
  p_san_desk: [1.2, 0.7, 1.16], // лампа на столе; столешница — 0.76
  p_san_med_cabinet: [0.8, 0.4, 1.8],
  p_san_scale: [0.5, 0.6, 2.0],
  p_san_charcot_desk: [1.2, 0.6, 1.2],
  p_san_dining_table: [1.2, 0.8, 1.096], // вазочка с веточкой; скатерть — 0.762
  p_san_buffet: [2.4, 0.6, 1.21], // бак с крышкой на стойке; столешница 0.9, полка 1.0
  p_san_floor_gap: [0.8, 4.0, 0.02],
  p_san_lino_roll: [2.0, 0.3, 0.28],
  p_san_shovel: [0.3, 0.2, 1.4],
  p_san_wire_coil: [0.5, 0.15, 1.73],
  p_san_hanging_wire: [0.2, 0.2, 0.6],
  p_san_cement_bag: [0.6, 0.4, 0.28],
  p_san_ladder: [0.6, 1.2, 1.8],
  p_san_debris: [1.2, 1.0, 0.065], // мусор низкий (контракт — до 0.1)
};

/** Обход: геометрическая нормаль каждого треугольника смотрит туда же, что нормали его вершин. */
function windingErrors(g) {
  let bad = 0;
  for (let t = 0; t < g.i.length; t += 3) {
    const [a, b, c] = [g.i[t], g.i[t + 1], g.i[t + 2]];
    const P = (i) => [g.p[3 * i], g.p[3 * i + 1], g.p[3 * i + 2]];
    const N = (i) => [g.n[3 * i], g.n[3 * i + 1], g.n[3 * i + 2]];
    const gn = cross(sub(P(b), P(a)), sub(P(c), P(a)));
    if (dot(gn, add(add(N(a), N(b)), N(c))) <= 0) bad++;
  }
  return bad;
}

const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
let problems = 0;
for (const M of MODELS) {
  const mesh = doc.createMesh(M.id);
  let verts = 0, tris = 0;
  for (const [m, g] of M.parts) {
    if (!g.i.length) continue;
    const bad = windingErrors(g);
    if (bad) {
      problems++;
      console.log(`  ! ${M.id} / ${m.getName()}: обход ${bad} треугольников против нормалей`);
    }
    // игровые координаты → glTF: x → −x, обход — обратный (загрузчик Babylon зеркалит обратно)
    for (let k = 0; k < g.p.length; k += 3) {
      g.p[k] = -g.p[k];
      g.n[k] = -g.n[k];
    }
    for (let t = 0; t < g.i.length; t += 3) [g.i[t + 1], g.i[t + 2]] = [g.i[t + 2], g.i[t + 1]];
    const big = g.p.length / 3 > 65535;
    const prim = doc
      .createPrimitive()
      .setAttribute('POSITION', acc('VEC3', new Float32Array(g.p)))
      .setAttribute('NORMAL', acc('VEC3', new Float32Array(g.n)))
      .setIndices(acc('SCALAR', big ? new Uint32Array(g.i) : new Uint16Array(g.i)))
      .setMaterial(m);
    // UV — только у текстурных; остальным PropModels допишет нули
    if (MAT_UV.has(m)) prim.setAttribute('TEXCOORD_0', acc('VEC2', new Float32Array(g.uv)));
    mesh.addPrimitive(prim);
    verts += g.p.length / 3;
    tris += g.i.length / 3;
  }
  M.stats = { verts, tris, mats: M.parts.size };
  scene.addChild(doc.createNode(M.id).setMesh(mesh).setExtras({ ceil: M.ceil, ...M.extras }));
}

await doc.transform(
  weld(),
  dedup(),
  prune({ keepAttributes: true, keepLeaves: true, keepExtras: true }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 86 }),
  // позиции — int16, нормали — int8 (KHR_mesh_quantization: загрузчик Babylon подключён в propModels.ts)
  quantize({ quantizeNormal: 8 }),
);
await io.write(out, doc);

// сверка по записанному файлу: узлы и габариты (с трансформами квантования)
const back = await io.read(out);
const nodes = back.getRoot().listScenes()[0].listChildren();
const seen = new Set();
console.log('узел                    план w × d (ожид.)           верх (ожид.)    X: от … до       Z: от … до      верш.  тр.  мат.');
for (const n of nodes) {
  const id = n.getName();
  seen.add(id);
  const b = getBounds(n);
  const e = EXPECT[id];
  const M = MODELS.find((x) => x.id === id);
  const w = b.max[0] - b.min[0], d = b.max[2] - b.min[2], h = M.ceil ? -b.min[1] : b.max[1];
  const f = (a) => `${b.min[a].toFixed(2).padStart(6)} … ${b.max[a].toFixed(2).padStart(5)}`;
  let warn = '';
  if (!e) warn = ' ! нет в EXPECT';
  else {
    // свес за план допускается немного (бахрома, кант, ручки, карниз) — до 0.12 м
    if (w > e[0] + 0.12 || d > e[1] + 0.12) warn += ' ! шире плана';
    if (w < e[0] - 0.2 || d < e[1] - 0.2) warn += ' ! уже плана';
    if (Math.abs(h - e[2]) > 0.03) warn += ` ! верх ${h.toFixed(3)} ≠ ${e[2]}`;
    if (M.ceil && Math.abs(b.max[1]) > 0.002) warn += ' ! подвесной: верх не в 0';
    if (!M.ceil && b.min[1] < -0.002) warn += ' ! ниже пола';
    if (Math.abs((b.min[0] + b.max[0]) / 2) > 0.06) warn += ' ! не по центру X';
    if (Math.abs((b.min[2] + b.max[2]) / 2) > 0.08) warn += ' ! не по центру Z';
  }
  if (warn) problems++;
  console.log(
    `${id.padEnd(22)} ${(e ? `${w.toFixed(2)} × ${d.toFixed(2)} (${e[0]} × ${e[1]})` : '').padEnd(28)} ${h.toFixed(3).padStart(6)} (${e?.[2] ?? '-'})`.padEnd(70) +
      `${f(0)}  ${f(2)}  ${String(M.stats.verts).padStart(5)} ${String(M.stats.tris).padStart(5)} ${String(M.stats.mats).padStart(3)}${warn}`,
  );
}
for (const id of Object.keys(EXPECT)) if (!seen.has(id)) (problems++, console.log(`  ! нет узла ${id}`));
const glow = back.getRoot().listMaterials().filter((m) => m.getEmissiveFactor().some((v) => v > 0.01)).map((m) => m.getName());
const total = MODELS.reduce((s, M) => s + M.stats.verts, 0);
console.log(`→ ${out}: ${(statSync(out).size / 1024).toFixed(0)} КБ, предметов ${nodes.length}, вершин ${total}, материалов ${back.getRoot().listMaterials().length}, текстур ${back.getRoot().listTextures().length}`);
console.log(`  светятся: ${glow.join(', ') || 'ничего'}`);
if (problems) {
  console.log(`  замечаний: ${problems}`);
  process.exitCode = 1;
}
