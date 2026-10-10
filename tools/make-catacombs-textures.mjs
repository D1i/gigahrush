// Текстуры отделок биома «Катакомбы» (src/data/finishes.ts, f_cat_*) — процедурные, бесшовные, 512 × 512 px:
//
//  • src/data/assets/catacombs/*.jpg — кирпич имперский (цепная перевязка, высолы, потёки), путиловская плита (пол,
//    ил в швах), советский бетон (следы опалубки, отверстия стяжек, потёки), зелёная масляная панель (облупленная,
//    отбивка поверху, след воды понизу — картинка на всю высоту панели 1.3 м), «смешанная» стена (штукатурка
//    отвалилась пятнами — под ней тот же кирпич), бетонный пол (мокрый, трещины, ил), ил после наводнения (рябь).
//  • Шум — периодический (решётка значений с повтором по краю картинки, октавы — кратные периоды), раскладки кирпича
//    и плит — кратны размеру повтора, поэтому края сходятся. Проверка: разница через шов (последний столбец/ряд против
//    первого) против средней разницы соседних столбцов/рядов — отношение ≈ 1.
//  • Яркость — не ниже ~90 (из 255) в среднем: в катакомбах нет света, кроме фонаря, тёмная текстура под ним — чёрная.
//  • Размер повтора (tileW × tileH, м) — в комментариях у генераторов; он же — в finishes.ts.
//  • Лист для просмотра (каждая текстура 2 × 2 повтора): tmp/catacombs-wip/tex-sheet.png.
//
//   node tools/make-catacombs-textures.mjs [brick,stone,…]
import sharp from 'sharp';
import { mkdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const N = 512;
const outDir = fileURLToPath(new URL('../src/data/assets/catacombs/', import.meta.url));
const wipDir = fileURLToPath(new URL('../tmp/catacombs-wip/', import.meta.url));
mkdirSync(outDir, { recursive: true });
mkdirSync(wipDir, { recursive: true });

// ───────── случай и шум ─────────
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Хэш целого → 0…1 (цвет кирпича, плиты). */
const hash = (i) => {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const mix3 = (c, d, t) => [lerp(c[0], d[0], t), lerp(c[1], d[1], t), lerp(c[2], d[2], t)];
const mul3 = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
/** Расстояние по кругу 0…1 (для повтора). */
const wrapD = (a, b) => {
  const d = Math.abs(a - b) % 1;
  return Math.min(d, 1 - d);
};

/** Периодический шум значений: u, v ∈ [0, 1) — повтор по краю; P — клеток решётки на повтор. */
class Noise {
  constructor(seed) {
    this.r = rng(seed);
    this.lat = new Map();
  }
  grid(P) {
    let a = this.lat.get(P);
    if (!a) {
      a = new Float32Array(P * P);
      for (let i = 0; i < a.length; i++) a[i] = this.r();
      this.lat.set(P, a);
    }
    return a;
  }
  val(u, v, P) {
    const a = this.grid(P);
    let x = (u * P) % P, y = (v * P) % P;
    if (x < 0) x += P;
    if (y < 0) y += P;
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10), sy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const x1 = (ix + 1) % P, y1 = (iy + 1) % P;
    const a00 = a[iy * P + ix], a10 = a[iy * P + x1], a01 = a[y1 * P + ix], a11 = a[y1 * P + x1];
    return lerp(lerp(a00, a10, sx), lerp(a01, a11, sx), sy);
  }
  /** Сумма октав: периоды P, 2P, 4P …; 0…1. */
  fbm(u, v, P, oct = 4, gain = 0.5) {
    let s = 0, amp = 1, n = 0;
    for (let k = 0; k < oct; k++) {
      s += amp * this.val(u, v, P << k);
      n += amp;
      amp *= gain;
    }
    return s / n;
  }
}

// ───────── кирпичная кладка (общая для кирпича и «смешанной» стены) ─────────
// Повтор 1.2 × 1.2 м: старый петербургский кирпич ~290 × 65 + шов 10 мм; крестовая перевязка — ряд ложков (4 по
// 0.3 м, через ряд сдвиг на полкирпича), ряд тычков (8 по 0.15 м, сдвиг на четверть) — 16 рядов по 0.075 м.
const BRICK_T = 1.2;
const COURSES = 16;
const CH = BRICK_T / COURSES;
const JH = 0.0055;
/** Кирпич в точке (м, в пределах повтора): id, расстояние до края (< 0 — шов), положение внутри. */
function brickAt(xm, ym) {
  const row = Math.floor(ym / CH) % COURSES;
  const yIn = ym - Math.floor(ym / CH) * CH;
  const stretch = row % 2 === 0;
  const len = stretch ? BRICK_T / 4 : BRICK_T / 8;
  const off = stretch ? (row % 4 === 0 ? 0 : len / 2) : len / 2;
  let xx = (xm - off) % BRICK_T;
  if (xx < 0) xx += BRICK_T;
  const col = Math.floor(xx / len);
  const xIn = xx - col * len;
  const d = Math.min(xIn - JH, len - JH - xIn, yIn - JH, CH - JH - yIn);
  return { id: row * 17 + col + 1, d, xIn, yIn, len };
}
/** Палитра обожжённого кирпича: красно-бурый, тёмный пережжённый, оранжевый недожог, лиловый, бледный. */
const BRICK_COLS = [
  [150, 80, 62], [134, 70, 56], [158, 94, 70], [118, 66, 58], [142, 88, 72], [106, 60, 56], [164, 112, 88], [128, 82, 70],
];
function makeBrickSampler(seed) {
  const nFace = new Noise(seed + 1), nChip = new Noise(seed + 2), nDirt = new Noise(seed + 3), nSalt = new Noise(seed + 4);
  const nWarp = new Noise(seed + 5), nMortar = new Noise(seed + 6), nStreak = new Noise(seed + 7);
  const r = rng(seed + 8);
  const streaks = Array.from({ length: 9 }, () => ({ x: r(), w: 0.008 + r() * 0.025, k: 0.08 + r() * 0.12, rust: r() < 0.3 }));
  return (u, v) => {
    const xm = u * BRICK_T, ym = v * BRICK_T;
    const b = brickAt(xm, ym);
    const h = hash(b.id + seed * 101);
    // скол кромки: край кирпича «съеден» на 0…7 мм по шуму
    const chip = 0.002 + 0.009 * smooth(0.4, 0.85, nChip.fbm(u, v, 32, 3));
    let c;
    if (b.d > chip) {
      const base = BRICK_COLS[Math.floor(h * BRICK_COLS.length)];
      const tint = 0.86 + 0.24 * hash(b.id * 7 + seed);
      c = mul3(base, tint);
      // закопчённые и выветренные кирпичи: темнее или серее
      const age = hash(b.id * 13 + seed * 3);
      if (age < 0.12) c = mul3(c, 0.72);
      else if (age > 0.9) c = mix3(c, [150, 130, 116], 0.45);
      // лицо кирпича: пятнистость, поры, слегка темнее к кромке
      const f = nFace.fbm(u, v, 64, 4);
      c = mul3(c, 0.82 + 0.36 * f);
      const pore = nFace.val(u + 0.37, v + 0.11, 256);
      if (pore > 0.86) c = mul3(c, 0.8);
      c = mul3(c, 0.9 + 0.1 * smooth(chip, chip + 0.012, b.d));
    } else {
      // известковый раствор: серо-бежевый, утоплен — темнее у кирпича (тень)
      const m = nMortar.fbm(u, v, 64, 3);
      c = mix3([104, 98, 86], [140, 134, 118], m);
      const depth = smooth(-JH, chip, b.d); // 0 — середина шва, 1 — у кромки
      c = mul3(c, 0.78 + 0.12 * (1 - depth));
    }
    // высолы: белая корка пятнами, по швам — гуще
    const wu = u + 0.06 * (nWarp.fbm(u, v, 4, 3) - 0.5), wv = v + 0.06 * (nWarp.fbm(u + 0.5, v + 0.5, 4, 3) - 0.5);
    let salt = smooth(0.56, 0.72, nSalt.fbm(wu, wv, 4, 5));
    if (b.d <= chip) salt = Math.min(1, salt * 1.6 + 0.08 * smooth(0.5, 0.7, nSalt.fbm(u, v, 8, 3)));
    salt *= 0.55 + 0.45 * nSalt.val(u, v, 128);
    c = mix3(c, [212, 208, 196], clamp(salt) * 0.85);
    // потёки сверху вниз: тёмные мокрые и рыжие
    for (const s of streaks) {
      const dx = wrapD(u + 0.004 * (nStreak.val(u, v, 16) - 0.5), s.x);
      if (dx > s.w * 3) continue;
      const along = smooth(0.35, 0.75, nStreak.fbm(s.x * 7.3, v, 4, 3));
      const k = Math.exp(-((dx / s.w) ** 2)) * along * s.k * 2;
      c = s.rust ? mix3(c, [120, 70, 40], k * 0.8) : mul3(c, 1 - k);
    }
    // общая грязь и сырость крупными пятнами
    const dirt = nDirt.fbm(u, v, 2, 5);
    c = mul3(c, 0.78 + 0.34 * dirt);
    // серая пыль-налёт поверх всего (старая кладка теряет цвет)
    c = mix3(c, [128, 120, 110], 0.18 + 0.14 * nDirt.fbm(u + 0.5, v, 8, 3));
    return c;
  };
}

// ───────── генераторы (u, v ∈ [0, 1), v — сверху вниз по картинке) ─────────

/** f_cat_brick, повтор 1.2 × 1.2 м. */
const brick = makeBrickSampler(11);

/** f_cat_stone (пол), повтор 1.5 × 1.5 м: путиловская плита — ряды по 0.5 м, плиты разной длины, ил в швах. */
function makeStone(seed) {
  const T = 1.5;
  const r = rng(seed);
  // ряды: 3 по 0.5 м; в ряду — длины плит, в сумме 1.5, сдвиг ряда
  const rows = [0, 1, 2].map(() => {
    const cuts = [];
    let x = 0;
    while (x < T - 0.35) {
      const l = 0.35 + r() * 0.4;
      if (x + l > T - 0.3) break;
      x += l;
      cuts.push(x);
    }
    return { cuts: [0, ...cuts], off: r() * T };
  });
  const nS = new Noise(seed + 1), nL = new Noise(seed + 2), nW = new Noise(seed + 3), nJ = new Noise(seed + 4), nP = new Noise(seed + 5), nE = new Noise(seed + 6);
  return (u, v) => {
    const ym = v * T;
    const ri = Math.floor(ym / 0.5) % 3;
    const row = rows[ri];
    let xx = (u * T - row.off) % T;
    if (xx < 0) xx += T;
    let k = 0;
    while (k + 1 < row.cuts.length && xx >= row.cuts[k + 1]) k++;
    const x0 = row.cuts[k], x1 = k + 1 < row.cuts.length ? row.cuts[k + 1] : T;
    const yIn = ym - ri * 0.5;
    // шов 12…22 мм, кромки неровные (сколы)
    const jw = 0.006 + 0.005 * nJ.fbm(u, v, 16, 3);
    const ragged = 0.012 * (nE.fbm(u, v, 32, 3) - 0.5);
    const d = Math.min(xx - x0, x1 - xx, yIn, 0.5 - yIn) + ragged - jw;
    const id = ri * 13 + k + 1;
    const h = hash(id + seed * 31);
    let c;
    if (d > 0) {
      // известняк: серо-жёлтый с зеленцой, слоистый (тонкие полосы вдоль ряда), выбоины
      c = mix3([150, 142, 116], [176, 168, 140], h);
      const lam = nL.val(u + h, v * 6 + 0.3 * nL.val(u, v, 8), 16);
      c = mul3(c, 0.88 + 0.16 * lam);
      c = mul3(c, 0.8 + 0.3 * nS.fbm(u, v, 16, 4));
      if (nP.val(u, v, 256) > 0.88) c = mul3(c, 0.72);
      // кромка плиты стёрта и темнее (влага держится у шва)
      c = mul3(c, 0.84 + 0.16 * smooth(0, 0.03, d));
    } else {
      // ил в шве: бурый, с зеленью
      c = mix3([62, 56, 40], [86, 80, 58], nJ.fbm(u + 0.3, v, 32, 3));
    }
    // мокро: тёмные пятна-лужицы, ил плёнкой
    const wet = smooth(0.52, 0.7, nW.fbm(u, v, 2, 5));
    c = mix3(c, mul3([96, 92, 74], 0.95), wet * 0.55);
    const silt = smooth(0.6, 0.78, nW.fbm(u + 0.41, v + 0.27, 4, 4));
    c = mix3(c, [104, 92, 66], silt * 0.6);
    return c;
  };
}

/** f_cat_concrete, повтор 1.5 × 1.5 м: доски опалубки по 0.15 м (10 на повтор), стяжки через 0.75 м, потёки. */
function makeConcrete(seed, o = {}) {
  const T = 1.5;
  const r = rng(seed);
  const nB = new Noise(seed + 1), nG = new Noise(seed + 2), nD = new Noise(seed + 3), nP = new Noise(seed + 4), nS = new Noise(seed + 5), nW = new Noise(seed + 6);
  const tone = Array.from({ length: 10 }, () => 0.9 + r() * 0.16);
  const streaks = Array.from({ length: 7 }, () => ({ x: r(), w: 0.01 + r() * 0.025, k: 0.03 + r() * 0.06 }));
  const base = o.base ?? [146, 144, 136];
  return (u, v) => {
    // доски сдвинуты на полдоски: край повтора — посередине доски
    const ym = v * T + 0.075;
    const bi = Math.floor(ym / 0.15) % 10;
    const yIn = ym - Math.floor(ym / 0.15) * 0.15;
    let c = mul3(base, tone[bi]);
    // волокна доски — вытянутый вдоль шум
    const grain = nG.val(u * 1 + bi * 0.13, v * 40 + 0.4 * nG.val(u, v, 8), 32);
    c = mul3(c, 0.93 + 0.1 * grain);
    c = mul3(c, 0.84 + 0.26 * nB.fbm(u, v, 8, 4));
    // стык досок: гребешок раствора (светлая) и щель (тёмная)
    const seam = Math.min(yIn, 0.15 - yIn);
    if (seam < 0.005) c = mul3(c, yIn < 0.075 ? 1.14 : 0.7);
    else if (seam < 0.009 && yIn > 0.075) c = mul3(c, 0.9);
    // раковины-поры
    if (nP.val(u, v, 256) > 0.9) c = mul3(c, 0.66);
    // отверстия стяжек: через 0.75 м по обеим осям, посередине доски, с ржавым ореолом
    for (const cx of [0.25, 0.75]) {
      for (const cy of [0.25 + 0.05 / 1.5, 0.75 + 0.05 / 1.5]) {
        const dx = wrapD(u, cx) * T, dy = wrapD(v, cy) * T;
        const dd = Math.hypot(dx, dy);
        if (dd < 0.012) c = mul3(c, 0.45);
        else if (dd < 0.04) c = mix3(c, [126, 84, 56], 0.45 * (1 - dd / 0.04) * (0.6 + 0.4 * nS.val(u, v, 64)));
        // ржавый подтёк из стяжки вниз (вниз по картинке — v растёт), сужается и бледнеет
        const below = (v - cy + 1) % 1;
        if (below > 0 && below < 0.2) {
          const t = below / 0.2, w = 0.006 + 0.004 * (1 - t);
          const k = Math.exp(-((dx / w) ** 2)) * (1 - t) * (0.5 + 0.5 * nS.val(u, v, 32));
          c = mix3(c, [120, 80, 50], k * 0.55);
        }
      }
    }
    // потёки вниз (тёмные мокрые, рыжие от арматуры)
    for (const s of streaks) {
      const dx = wrapD(u + 0.005 * (nS.val(u, v, 16) - 0.5), s.x);
      if (dx > s.w * 3) continue;
      const along = smooth(0.3, 0.7, nS.fbm(s.x * 5.1, v, 4, 3));
      const k = Math.exp(-((dx / s.w) ** 2)) * along * s.k * 2;
      c = mul3(c, 1 - k);
    }
    // сырость пятнами, грязь
    const damp = smooth(0.55, 0.75, nW.fbm(u, v, 2, 5));
    c = mix3(c, mul3(c, 0.72), damp);
    c = mul3(c, 0.88 + 0.18 * nD.fbm(u, v, 2, 4));
    return c;
  };
}

/** f_cat_green_panel (dado 1.3 м), повтор 1.3 × 1.3 м — картинка на всю высоту панели (низ картинки у пола):
 *  зелёная масляная краска, облупилась пятнами (под ней серая штукатурка и старый слой охры), поверху — тёмная
 *  отбивка 2 см, понизу — след воды и полосы уровней. По горизонтали — бесшовно. */
function makeGreen(seed) {
  const H = 1.3;
  const nP = new Noise(seed + 1), nF = new Noise(seed + 2), nU = new Noise(seed + 3), nD = new Noise(seed + 4), nT = new Noise(seed + 5), nW = new Noise(seed + 6);
  return (u, v) => {
    const hm = (1 - v) * H; // высота от пола, м
    // краска: выцветший казённый зелёный, разводы кисти по вертикали
    let c = [92, 128, 100];
    const brush = nP.val(u * 1, v * 3 + 0.2 * nP.val(u, v, 4), 128);
    c = mul3(c, 0.9 + 0.12 * brush);
    c = mul3(c, 0.86 + 0.24 * nP.fbm(u, v, 4, 4));
    // облупилось: сильнее внизу (вода) и пятнами выше
    const wu = u + 0.03 * (nF.fbm(u, v, 8, 3) - 0.5);
    const f = nF.fbm(wu, v * 1.0, 8, 5);
    const thr = 0.66 - 0.16 * smooth(0.55, 0.0, hm);
    const peel = f - thr;
    if (peel > 0) {
      // под краской: старый слой охры местами, иначе штукатурка
      const under = nU.fbm(u, v, 4, 3) > 0.55 ? [176, 150, 98] : [158, 154, 142];
      c = mul3(under, 0.85 + 0.25 * nU.fbm(u, v, 32, 3));
      // штукатурка в глубине пятна темнее
      if (peel > 0.07) c = mul3(c, 0.88);
    } else if (peel > -0.012) {
      // кромка отставшей краски: светлый задир
      c = mix3(c, [150, 176, 150], 0.5);
    }
    // отбивка поверху (тёмно-зелёная) 2 см
    if (hm > H - 0.022) c = mul3([46, 66, 52], 0.9 + 0.2 * nT.val(u, v, 64));
    else if (hm > H - 0.026) c = mul3(c, 0.8);
    // след воды: темнее до 0.35 м, линии уровней (неровные)
    const tide = smooth(0.42, 0.18, hm + 0.04 * (nW.fbm(u, 0.5, 8, 3) - 0.5));
    c = mix3(c, mul3(c, 0.62), tide * 0.6);
    for (const [y, k] of [[0.38, 0.35], [0.24, 0.25], [0.62, 0.15]]) {
      const yy = y + 0.03 * (nW.fbm(u + y, 0.3, 8, 3) - 0.5);
      const dk = Math.abs(hm - yy);
      if (dk < 0.012) c = mix3(c, [96, 84, 62], k * (1 - dk / 0.012));
    }
    // грязь
    c = mul3(c, 0.88 + 0.16 * nD.fbm(u, v, 2, 4));
    return c;
  };
}

/** f_cat_peel, повтор 1.2 × 1.2 м (кладка та же, что у кирпича): советская штукатурка (серо-бежевая, грязная, в
 *  трещинках и потёках) закрывает ~2/3 стены; в рваных пятнах разного размера отвалилась — там старая кладка: по краю
 *  пятна — светлый излом (толщина слоя), под верхней кромкой — тень, у края на кирпиче — крошка и остатки раствора. */
function makePeel(seed) {
  const br = makeBrickSampler(seed);
  const nA = new Noise(seed + 11), nB = new Noise(seed + 12), nPl = new Noise(seed + 13), nR = new Noise(seed + 14);
  const nD = new Noise(seed + 15), nE = new Noise(seed + 16), nC = new Noise(seed + 17);
  const warp = (u, v) => [u + 0.05 * (nE.fbm(u, v, 6, 3) - 0.5), v + 0.05 * (nE.fbm(u + 0.31, v + 0.57, 6, 3) - 0.5)];
  // пороги — по квантилям: крупные пятна ~24% стены, мелкие выбоины ~8% (вместе ~30%: штукатурки — ~2/3)
  const q = (f, share) => {
    const a = [];
    for (let j = 0; j < 96; j++) for (let i = 0; i < 96; i++) a.push(f(...warp(i / 96, j / 96)));
    a.sort((x, y) => x - y);
    return a[Math.floor(a.length * (1 - share))];
  };
  const tBig = q((u, v) => nA.fbm(u, v, 3, 4), 0.24), tSmall = q((u, v) => nB.fbm(u, v, 8, 3), 0.08);
  /** > 0 — штукатурка отвалилась: крупные пятна и мелкие выбоины, края рваные. */
  const hole = (u, v) => {
    const [wu, wv] = warp(u, v);
    const big = nA.fbm(wu, wv, 3, 4) - tBig;
    const small = nB.fbm(wu, wv, 8, 3) - tSmall;
    return Math.max(big, small) + 0.035 * (nE.val(u, v, 96) - 0.5);
  };
  const eps = 1 / N;
  const streaks = [0.13, 0.41, 0.66, 0.88];
  return (u, v) => {
    const h = hole(u, v);
    if (h <= 0) {
      // штукатурка: серо-бежевая, затёртая, пятна сырости, волосяные трещины, потёки
      let c = mix3([170, 164, 148], [146, 141, 128], nPl.fbm(u, v, 6, 4));
      c = mul3(c, 0.9 + 0.12 * nPl.val(u, v, 160));
      const cr = Math.abs(nC.fbm(u, v, 6, 4) - 0.5);
      if (cr < 0.004) c = mul3(c, 0.72);
      for (const sx of streaks) {
        const dx = wrapD(u, sx);
        if (dx < 0.03) c = mul3(c, 1 - 0.14 * Math.exp(-((dx / 0.012) ** 2)) * smooth(0.35, 0.7, nD.fbm(sx * 3, v, 4, 3)));
      }
      c = mix3(c, mul3(c, 0.8), smooth(0.55, 0.72, nD.fbm(u, v, 2, 4)));
      // кромка отвала: светлый излом слоя, чуть дальше — трещинка вдоль края
      if (h > -0.014) c = mix3(c, [206, 200, 186], 0.65);
      else if (h > -0.022) c = mul3(c, 0.86);
      return c;
    }
    let c = br(u, v);
    // остатки раствора и крошка штукатурки у края пятна
    if (nR.val(u, v, 64) > 0.8) c = mix3(c, [172, 166, 150], 0.45);
    if (h < 0.035 && nR.val(u + 0.5, v, 200) > 0.72) c = mix3(c, [188, 182, 166], 0.8);
    // тень под верхней кромкой (штукатурка выше — v меньше) и полутень по бокам
    if (hole(u, v - eps * 3) <= 0) c = mul3(c, 0.58);
    else if (hole(u, v - eps * 7) <= 0) c = mul3(c, 0.78);
    else if (hole(u - eps * 3, v) <= 0 || hole(u + eps * 3, v) <= 0) c = mul3(c, 0.88);
    return c;
  };
}

/** f_cat_floor, повтор 1.5 × 1.5 м: советский бетонный пол — мокрый, трещины, ил по низинам, шов. */
function makeFloor(seed) {
  const nB = new Noise(seed + 1), nC = new Noise(seed + 2), nW = new Noise(seed + 3), nS = new Noise(seed + 4), nP = new Noise(seed + 5), nT = new Noise(seed + 6);
  return (u, v) => {
    let c = [134, 132, 124];
    c = mul3(c, 0.84 + 0.26 * nB.fbm(u, v, 4, 5));
    // затирка: дуги мастерка — слабые
    const tr = nT.val(u + 0.2 * nT.val(u, v, 4), v + 0.2 * nT.val(v, u, 4), 64);
    c = mul3(c, 0.95 + 0.07 * tr);
    // трещины: рёбра шума
    // трещины: изолиния плавного шума с изломами — длинные, редкие (только где маска)
    const cr = Math.abs(nC.fbm(u + 0.03 * nC.val(u, v, 16), v + 0.03 * nC.val(v, u, 16), 3, 3) - 0.5);
    const crMask = smooth(0.45, 0.6, nC.fbm(u + 0.3, v + 0.7, 2, 3));
    if (cr < 0.0035 * crMask) c = mul3(c, 0.5);
    else if (cr < 0.007 * crMask) c = mul3(c, 0.86);
    // поры и камешки
    const p = nP.val(u, v, 256);
    if (p > 0.9) c = mul3(c, 0.7);
    else if (p < 0.06) c = mul3(c, 1.15);
    // деформационный шов по краю повтора (поперёк)
    const dj = wrapD(v, 0) * 1.5;
    if (dj < 0.005) c = mul3(c, 0.5);
    else if (dj < 0.009) c = mul3(c, 0.85);
    // мокро и ил
    const wet = smooth(0.48, 0.68, nW.fbm(u, v, 2, 5));
    c = mix3(c, mul3(c, 0.66), wet);
    const silt = smooth(0.58, 0.76, nS.fbm(u, v, 4, 4));
    c = mix3(c, mul3([110, 96, 70], 0.9 + 0.2 * nS.val(u, v, 64)), silt * 0.75);
    return c;
  };
}

/** f_cat_silt, повтор 1.5 × 1.5 м: ил и наносы после воды — рябь течения, мусоринки, подсохшие края. */
function makeSilt(seed) {
  const r = rng(seed);
  const nB = new Noise(seed + 1), nR = new Noise(seed + 2), nD = new Noise(seed + 3), nP = new Noise(seed + 4), nW = new Noise(seed + 5);
  const twigs = Array.from({ length: 26 }, () => ({ x: r(), y: r(), a: r() * Math.PI, l: 0.006 + r() * 0.025, dark: r() < 0.6 }));
  return (u, v) => {
    let c = mix3([104, 96, 74], [126, 118, 92], nB.fbm(u, v, 4, 5));
    // рябь: волны поперёк течения (вдоль v), искривлены шумом; на гребне светлее, во впадине — вода темнее
    const ph = 9 * v + 1.2 * nR.fbm(u, v, 2, 3) + 0.5 * nR.val(u, v, 8);
    const w = Math.sin(2 * Math.PI * ph);
    c = mul3(c, 0.92 + 0.12 * w);
    if (w < -0.55) c = mix3(c, [70, 70, 58], 0.35 * smooth(-0.55, -0.95, w));
    // подсохло: светлые корки пятнами
    const dry = smooth(0.6, 0.74, nD.fbm(u, v, 4, 4));
    c = mix3(c, [150, 142, 118], dry * 0.55);
    // камешки и ракушечник
    const p = nP.val(u, v, 256);
    if (p > 0.92) c = mul3(c, 0.7);
    else if (p < 0.04) c = mix3(c, [170, 162, 140], 0.6);
    // веточки, щепки
    for (const t of twigs) {
      const dx0 = (u - t.x + 1.5) % 1 - 0.5, dy0 = (v - t.y + 1.5) % 1 - 0.5;
      const ca = Math.cos(t.a), sa = Math.sin(t.a);
      const along = dx0 * ca + dy0 * sa, across = -dx0 * sa + dy0 * ca;
      if (Math.abs(along) < t.l && Math.abs(across) < 0.0018) c = t.dark ? [58, 46, 32] : [128, 108, 78];
    }
    // мокрые тёмные пятна
    c = mul3(c, 0.84 + 0.22 * nW.fbm(u, v, 2, 4));
    return c;
  };
}

// ───────── запись и проверка швов ─────────
const LIST = [
  ['brick', brick, 'f_cat_brick: кирпич имперский, 1.2 × 1.2 м'],
  ['stone', makeStone(23), 'f_cat_stone: путиловская плита (пол), 1.5 × 1.5 м'],
  ['concrete', makeConcrete(37), 'f_cat_concrete: советский бетон, 1.5 × 1.5 м'],
  ['green', makeGreen(41), 'f_cat_green_panel: зелёная масляная панель (dado 1.3 м), 1.3 × 1.3 м', { vSeam: false }],
  ['peel', makePeel(53), 'f_cat_peel: штукатурка, местами отвалилась до кирпича, 1.2 × 1.2 м'],
  ['floor', makeFloor(61), 'f_cat_floor: советский бетонный пол, 1.5 × 1.5 м'],
  ['silt', makeSilt(71), 'f_cat_silt: ил после наводнения (пол), 1.5 × 1.5 м'],
];

function render(f) {
  const buf = Buffer.alloc(N * N * 3);
  // 2 × 2 подвыборки на пиксель — без зубцов на швах кладки
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let r = 0, g = 0, b = 0;
      for (const [sx, sy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
        const c = f((x + sx) / N, (y + sy) / N);
        r += c[0];
        g += c[1];
        b += c[2];
      }
      const i = (y * N + x) * 3;
      buf[i] = clamp(Math.round(r / 4), 0, 255);
      buf[i + 1] = clamp(Math.round(g / 4), 0, 255);
      buf[i + 2] = clamp(Math.round(b / 4), 0, 255);
    }
  }
  return buf;
}

/** Шов: средняя |разница| через край против средней разницы соседей внутри (по столбцам и рядам). */
function seamRatio(buf) {
  const px = (x, y, k) => buf[(y * N + x) * 3 + k];
  let inX = 0, edgeX = 0, inY = 0, edgeY = 0;
  for (let a = 0; a < N; a++) for (let k = 0; k < 3; k++) {
    edgeX += Math.abs(px(N - 1, a, k) - px(0, a, k));
    edgeY += Math.abs(px(a, N - 1, k) - px(a, 0, k));
    for (let b = 0; b + 1 < N; b++) {
      inX += Math.abs(px(b, a, k) - px(b + 1, a, k));
      inY += Math.abs(px(a, b, k) - px(a, b + 1, k));
    }
  }
  return [(edgeX * (N - 1)) / inX, (edgeY * (N - 1)) / inY];
}

// node tools/make-catacombs-textures.mjs [имена через запятую] — только эти (для подбора)
const only = process.argv[2]?.split(',');
const sheet = [];
let bad = 0;
console.log('текстура        средн. R G B  яркость  шов X  шов Y   КБ');
for (const [name, f, note, o = {}] of LIST) {
  if (only && !only.includes(name)) continue;
  const buf = render(f);
  const out = `${outDir}${name}.jpg`;
  await sharp(buf, { raw: { width: N, height: N, channels: 3 } }).jpeg({ quality: 80, mozjpeg: true }).toFile(out);
  let R = 0, G = 0, B = 0;
  for (let i = 0; i < buf.length; i += 3) (R += buf[i]), (G += buf[i + 1]), (B += buf[i + 2]);
  const n = N * N;
  const lum = (0.2126 * R + 0.7152 * G + 0.0722 * B) / n;
  const [sx, sy] = seamRatio(buf);
  const warn = [];
  if (sx > 1.6) warn.push('шов по X');
  if (o.vSeam !== false && sy > 1.6) warn.push('шов по Y');
  if (lum < 85) warn.push('темно');
  if (warn.length) bad++;
  console.log(
    `${name.padEnd(10)} ${[R, G, B].map((s) => String(Math.round(s / n)).padStart(4)).join('')}   ${lum.toFixed(0).padStart(5)}   ${sx.toFixed(2)}   ${sy.toFixed(2)}  ${(statSync(out).size / 1024).toFixed(0).padStart(4)}  ${note}${warn.length ? '  ! ' + warn.join(', ') : ''}`,
  );
  sheet.push({ name, buf });
}

// лист просмотра: каждая — 2 × 2 повтора по 256 px (видно швы), в ряд по 4
const S = 256, cols = 4, rows = Math.ceil(sheet.length / cols);
const W = cols * 2 * S, Hh = rows * 2 * S;
const big = Buffer.alloc(W * Hh * 3, 20);
for (let k = 0; k < sheet.length; k++) {
  const small = await sharp(sheet[k].buf, { raw: { width: N, height: N, channels: 3 } }).resize(S, S).raw().toBuffer();
  const ox = (k % cols) * 2 * S, oy = Math.floor(k / cols) * 2 * S;
  for (let ty = 0; ty < 2; ty++) for (let tx = 0; tx < 2; tx++) for (let y = 0; y < S; y++) {
    small.copy(big, ((oy + ty * S + y) * W + ox + tx * S) * 3, y * S * 3, (y + 1) * S * 3);
  }
}
await sharp(big, { raw: { width: W, height: Hh, channels: 3 } }).png().toFile(`${wipDir}tex-sheet.png`);
console.log(`→ ${outDir}*.jpg; лист: ${wipDir}tex-sheet.png`);
if (bad) process.exitCode = 1;
