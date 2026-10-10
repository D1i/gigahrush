// «Фрактальная станция»: процедурные текстуры облицовки (canvas → DynamicTexture), без файлов. Любая грань тут — пол
// для одной гравитации и стена или потолок для других, поэтому рисунок квадратно-симметричный и читается с любой стороны.
//  • hallTexture — грани атриума (плиты ячейки, площадки, подложки): модуль 6 × 6 м — поле из четырёх плит светлого
//    мрамора 2.5 м с тонкими швами, по краю модуля — пояс красного гранита (0.5 м между модулями) с латунной жилкой, в
//    узлах пояса — чёрные квадраты с белым ромбом, в центре поля — ромб-вставка. Ободья дыр (18, 36 при P = 54) — на
//    границах модулей: пояс обрамляет пропасть. Издали — сетка «членений» 6 м, а не кафель 1.2 м.
//  • slabTexture — «станция 18» и пилоны: модуль 3 × 3 м — две плиты белого мрамора 1.5 × 3 м с прожилками и швами.
//  • cofferTexture — кессон-светильник (плоский: стоит на грани, которая для кого-то пол): рама, ступень, две полосы света.
//  • haloTexture — мягкое пятно света (огонёк копии, отсвет торшера на камне): радиальный градиент в прозрачность.
// Рисунок детерминирован (свой ГПСЧ), швы бесшовные (точки у краёв повторяются по модулю).
import type { Scene } from '@babylonjs/core/scene';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';

type Ctx = CanvasRenderingContext2D;

const rng = (seed: number) => {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
};

/** Точки-зёрна по прямоугольнику (x0, y0, w, h) с повтором по краям холста (бесшовно). */
function speckle(g: Ctx, R: () => number, S: number, x0: number, y0: number, w: number, h: number, n: number, cols: string[], r0: number, r1: number) {
  for (let k = 0; k < n; k++) {
    const x = x0 + R() * w, y = y0 + R() * h, r = r0 + R() * (r1 - r0);
    g.fillStyle = cols[Math.floor(R() * cols.length)];
    for (const dx of [0, -S, S]) for (const dy of [0, -S, S]) {
      const X = x + dx, Y = y + dy;
      if (X < -r || Y < -r || X > S + r || Y > S + r) continue;
      g.fillRect(X - r, Y - r, 2 * r, 2 * r);
    }
  }
}

/** Прожилки мрамора: ломаные с плавным изгибом, полупрозрачные, в пределах прямоугольника. */
function veins(g: Ctx, R: () => number, x0: number, y0: number, w: number, h: number, n: number, col: string, wd: number) {
  g.save();
  g.beginPath();
  g.rect(x0, y0, w, h);
  g.clip();
  g.strokeStyle = col;
  g.lineCap = 'round';
  for (let k = 0; k < n; k++) {
    let x = x0 + R() * w, y = y0 + R() * h;
    let a = R() * Math.PI * 2;
    g.lineWidth = wd * (0.4 + R());
    g.beginPath();
    g.moveTo(x, y);
    const steps = 8 + Math.floor(R() * 10);
    for (let s = 0; s < steps; s++) {
      a += (R() - 0.5) * 0.9;
      const L = (0.04 + R() * 0.08) * Math.max(w, h);
      const cx = x + Math.cos(a) * L * 0.5 + (R() - 0.5) * L * 0.4, cy = y + Math.sin(a) * L * 0.5 + (R() - 0.5) * L * 0.4;
      x += Math.cos(a) * L;
      y += Math.sin(a) * L;
      g.quadraticCurveTo(cx, cy, x, y);
    }
    g.stroke();
  }
  g.restore();
}

/** Плита полированного камня: заливка с лёгким градиентом тона, прожилки, зерно. */
function stoneSlab(g: Ctx, R: () => number, S: number, x0: number, y0: number, w: number, h: number, base: [number, number, number], vein: string, grains: string[]) {
  const j = (R() - 0.5) * 14;
  const c = (d: number) => `rgb(${Math.round(base[0] + j + d)},${Math.round(base[1] + j + d)},${Math.round(base[2] + j + d * 0.9)})`;
  const gr = g.createLinearGradient(x0, y0, x0 + w, y0 + h);
  gr.addColorStop(0, c(5));
  gr.addColorStop(0.5, c(-3));
  gr.addColorStop(1, c(4));
  g.fillStyle = gr;
  g.fillRect(x0, y0, w, h);
  veins(g, R, x0, y0, w, h, 5, vein, Math.max(1, w / 260));
  speckle(g, R, S, x0, y0, w, h, Math.round((w * h) / 700), grains, 0.4, 1.1);
}

function mkTex(scene: Scene, name: string, px: number, draw: (g: Ctx, S: number) => void): DynamicTexture {
  const t = new DynamicTexture(name, { width: px, height: px }, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
  const g = t.getContext() as unknown as Ctx;
  draw(g, px);
  t.update(true);
  t.wrapU = t.wrapV = Texture.WRAP_ADDRESSMODE;
  t.anisotropicFilteringLevel = 8;
  return t;
}

/** Модуль атриума, м. */
export const HALL_M = 6;
/** Модуль облицовки станции 18 и пилонов, м. */
export const SLAB_M = 3;

/** Грани атриума: модуль 6 × 6 м (uv в метрах → uScale = 1 / HALL_M). */
export function hallTexture(scene: Scene, px = 1024): DynamicTexture {
  return mkTex(scene, 'fr:hallTex', px, (g, S) => {
    const R = rng(0x6a11);
    const m = S / HALL_M; // пикселей на метр
    const band = 0.25 * m; // половина пояса у каждого края
    // пояс красного гранита (весь модуль, поле — поверх)
    g.fillStyle = '#4c1f1b';
    g.fillRect(0, 0, S, S);
    speckle(g, R, S, 0, 0, S, S, Math.round(S * S * 0.004), ['#7a3a30', '#3e1a17', '#8c5546', '#2a1412'], 0.5, 1.4);
    // латунная жилка посреди пояса (на краях модуля — у соседей своя половина)
    g.fillStyle = '#b08a4a';
    const lw = Math.max(1, 0.035 * m);
    for (const p of [0, S]) {
      g.fillRect(0, p - lw / 2, S, lw);
      g.fillRect(p - lw / 2, 0, lw, S);
    }
    // поле: 4 плиты светлого мрамора 2.5 м, шов 6 мм
    const f0 = band, fw = S - 2 * band, half = fw / 2, seam = Math.max(1, 0.012 * m);
    g.fillStyle = '#3a3633';
    g.fillRect(f0, f0, fw, fw);
    for (const [ix, iy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      stoneSlab(g, R, S, f0 + ix * half + seam / 2, f0 + iy * half + seam / 2, half - seam, half - seam, [150, 144, 135], 'rgba(205,198,188,0.28)', ['#7c766d', '#a59e93', '#5f5a53']);
    }
    // тонкая тёмная обводка поля (притвор к поясу)
    g.strokeStyle = '#231816';
    g.lineWidth = Math.max(1, 0.03 * m);
    g.strokeRect(f0, f0, fw, fw);
    // в узлах пояса — чёрный квадрат с белым ромбом (по четвертинке на каждом углу модуля)
    const sq = 0.32 * m;
    for (const [cx, cy] of [[0, 0], [S, 0], [0, S], [S, S]]) {
      g.fillStyle = '#141212';
      g.fillRect(cx - sq, cy - sq, 2 * sq, 2 * sq);
      g.fillStyle = '#d9d4ca';
      g.beginPath();
      g.moveTo(cx, cy - sq * 0.7);
      g.lineTo(cx + sq * 0.7, cy);
      g.lineTo(cx, cy + sq * 0.7);
      g.lineTo(cx - sq * 0.7, cy);
      g.closePath();
      g.fill();
    }
    // в центре поля — ромб-вставка: чёрный, внутри красный
    const c = S / 2, r1 = 0.42 * m, r2 = 0.26 * m;
    for (const [r, col] of [[r1, '#161414'], [r2, '#8e2f26']] as const) {
      g.fillStyle = col;
      g.beginPath();
      g.moveTo(c, c - r);
      g.lineTo(c + r, c);
      g.lineTo(c, c + r);
      g.lineTo(c - r, c);
      g.closePath();
      g.fill();
    }
  });
}

/** Станция 18 и пилоны: модуль 3 × 3 м — две плиты белого мрамора 1.5 × 3 м (uScale = 1 / SLAB_M). */
export function slabTexture(scene: Scene, px = 512): DynamicTexture {
  return mkTex(scene, 'fr:slabTex', px, (g, S) => {
    const R = rng(0x51ab);
    const m = S / SLAB_M, seam = Math.max(1, 0.01 * m);
    g.fillStyle = '#5a5650';
    g.fillRect(0, 0, S, S);
    for (const ix of [0, 1]) {
      stoneSlab(g, R, S, ix * (S / 2) + seam / 2, seam / 2, S / 2 - seam, S - seam, [184, 180, 172], 'rgba(100,102,108,0.42)', ['#a39e95', '#cbc6bd', '#8a857d']);
    }
  });
}

/** Модуль тёмного мрамора (ободья дыр, «станция 6», стержни), м. */
export const DARK_M = 2;

/** Серо-зелёный мрамор ободьев дыр, «станции 6» и стержней: модуль 2 × 2 м — четыре плиты 1 м со светлыми прожилками
 *  (свой рисунок — не зависеть от общих finishTextures.ts, их правят другие сессии). */
export function darkMarbleTexture(scene: Scene, px = 512): DynamicTexture {
  return mkTex(scene, 'fr:darkTex', px, (g, S) => {
    const R = rng(0xd4c3);
    const half = S / 2, seam = Math.max(1, (0.01 * S) / DARK_M);
    g.fillStyle = '#1d2420';
    g.fillRect(0, 0, S, S);
    for (const [ix, iy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      stoneSlab(g, R, S, ix * half + seam / 2, iy * half + seam / 2, half - seam, half - seam, [88, 106, 96], 'rgba(205,218,206,0.3)', ['#4b5c52', '#6f8579', '#39463f']);
    }
  });
}

/** Кессон-светильник 3 × 4.5 м (картинка на прямоугольник; светится — как emissiveTexture). */
export function cofferTexture(scene: Scene): DynamicTexture {
  const t = new DynamicTexture('fr:cofferTex', { width: 256, height: 384 }, scene, true);
  const g = t.getContext() as unknown as Ctx;
  const W = 256, H = 384;
  // рама и ступень (гипс в тени) — тёмные, свечение — только полосы
  g.fillStyle = '#1a1917';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#2b2925';
  g.fillRect(10, 10, W - 20, H - 20);
  g.fillStyle = '#3a3731';
  g.fillRect(22, 22, W - 44, H - 44);
  for (const x of [W * 0.32, W * 0.68]) {
    const gr = g.createLinearGradient(x - 22, 0, x + 22, 0);
    gr.addColorStop(0, 'rgba(255,240,215,0)');
    gr.addColorStop(0.3, 'rgba(255,240,215,0.75)');
    gr.addColorStop(0.5, 'rgba(255,250,238,1)');
    gr.addColorStop(0.7, 'rgba(255,240,215,0.75)');
    gr.addColorStop(1, 'rgba(255,240,215,0)');
    g.fillStyle = gr;
    g.fillRect(x - 22, 36, 44, H - 72);
  }
  t.update(true);
  return t;
}

/** Мягкое пятно света: белый центр → прозрачный край (альфа в текстуре). */
export function haloTexture(scene: Scene, name = 'fr:haloTex'): DynamicTexture {
  const t = new DynamicTexture(name, { width: 128, height: 128 }, scene, true);
  t.hasAlpha = true;
  const g = t.getContext() as unknown as Ctx;
  g.clearRect(0, 0, 128, 128);
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.18, 'rgba(255,255,255,0.75)');
  gr.addColorStop(0.45, 'rgba(255,255,255,0.22)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  t.update(true);
  return t;
}
