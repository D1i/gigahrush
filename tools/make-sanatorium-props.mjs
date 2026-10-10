// Модели биома «Санаторий»: архитектура, коридор-галерея, вестибюль, бассейн (мебель и предметы помещений — другой
// набор, tools/make-sanatorium-rooms.mjs) — из примитивов:
//
//  • src/view3d/assets/sanatorium_props.glb — узел на предмет, имя узла = id prop проекта (src/data/props.ts, блок
//    «// sanatorium: архитектура», p_san_*).
//  • Оси узла — как у болванки мебели (src/blockout/babylon.ts): ширина w — вдоль X, глубина (h плана) — вдоль Z,
//    центр габарита на плане — в начале координат, перед — −Z, стена — +Z (z = +глубина/2); низ — пол (y = 0).
//    Настенное — высоты от пола, зад прижат к стене: окно со шторами 0…2.9 (низкое — 0…2.45), стенд «Распорядок дня»
//    1.0…1.9, часы 2.0…2.4, арочное окно бассейна 0…6.6, батарея 0.1…0.6. Подвесное (тег «потолок»: плафон, люстра,
//    свод-оболочка) — верх в y = 0 (extras.ceil): адаптер ставит модель под потолок своей комнаты (Room.ceilM:
//    коридор 3.3, вестибюль 4.2, бассейн 7.0 — низ свода на 7.0 − 2.6 = 4.4).
//  • Координаты в коде — как в игре (Babylon, левая система): смотришь на предмет спереди — +X справа. Загрузчик glTF
//    в Babylon зеркалит X (x → −x), поэтому при записи x → −x (с обратным обходом); UV не зеркалятся — надписи читаются.
//  • Цвет — в материале (префикс san_: имена материалов общие для всех наборов). Текстуры — только там, где без них не
//    узнать: дорожка с каймой, профнастил свода, кафель, мозаика дна, рябь воды, складки тюля, стенд, циферблат,
//    табличка регистратуры (SVG → PNG через sharp, в GLB — WebP). UV — в метрах (проекция по нормали / повтор tile)
//    или явные (картинка на грань); у остальных примитивов UV нет (PropModels допишет нули).
//  • Свет — только emissive (PropModels: StandardMaterial с disableLighting): san_lamp_glow (плафоны, люстра),
//    san_lamp_warm (лампа регистратуры), san_daylight_glow (стёкла окон — холодный белый, «за окном туман»),
//    san_tulle_glow (тюль на просвет: складки — текстурой, светится ровно картинкой).
//  • Вода бассейна san_pool_water — сетка ряби с альфа-тестом (alphaMode MASK): куски Прогулки рисуются без
//    смешивания (src/view3d/portal.ts drawRoom), а альфа-тест работает и так; сквозь просветы видно мозаику дна. Сцена
//    может гнать рябь, сдвигая UV текстуры у материала propModel:san_pool_water (uOffset/vOffset).
//  • Обход граней выбирается по нормали (tri), после записи — сверка: узлы, габариты против таблицы EXPECT.
//  • Посмотреть, как в игре (через PropModels): node tmp/sanatorium-wip/props-a-shots.mjs →
//    tmp/sanatorium-wip/props-a-sheet.png.
//
//   node tools/make-sanatorium-props.mjs
import { Document, NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, quantize, textureCompress, weld } from '@gltf-transform/functions';
import sharp from 'sharp';
import { mkdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../src/view3d/assets/sanatorium_props.glb', import.meta.url));
mkdirSync(fileURLToPath(new URL('../src/view3d/assets/', import.meta.url)), { recursive: true });

const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene('sanatorium');
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
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const PI = Math.PI;
/** Базис вращения вокруг оси: (U, A, W) — правая тройка, как (X, Y, Z). */
const BASIS = {
  y: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  z: [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
  x: [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
};
/** Детерминированный «случай» (листья, мозаика). */
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const rr = (a, b) => a + (b - a) * rnd();

// ───────── текстуры: SVG → PNG ─────────
/** SVG → PNG (sharp); rgb — залить этим цветом все пиксели (альфа — из рисунка): края прозрачного не темнеют в мипах. */
async function svgPng(svg, rgb) {
  if (!rgb) return sharp(Buffer.from(svg)).png().toBuffer();
  const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgb[0];
    data[i + 1] = rgb[1];
    data[i + 2] = rgb[2];
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}
const texture = async (name, svg, rgb) => doc.createTexture(name).setImage(await svgPng(svg, rgb)).setMimeType('image/png');
const svgOpen = (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;

/** Ковровая дорожка 1.2 × 3.0 м (256 × 640): красное поле, по краям — бежевая кайма с ромбами-розетками (зелёный, красный,
 *  синий), тёмная кромка; орнамент повторяется через 64 px (0.3 м) — дорожки встык (1–3 подряд) без шва. */
function runnerSvg() {
  const W = 256, H = 640;
  let s = svgOpen(W, H) + `<rect width="${W}" height="${H}" fill="#A3231D"/>`;
  for (const x0 of [0, W - 9]) s += `<rect x="${x0}" y="0" width="9" height="${H}" fill="#661410"/>`;
  for (const [a, b] of [[12, 52], [W - 52, W - 12]]) {
    s += `<rect x="${a}" y="0" width="${b - a}" height="${H}" fill="#D8C8A0"/>`;
    s += `<rect x="${a}" y="0" width="3" height="${H}" fill="#2F5A45"/><rect x="${b - 3}" y="0" width="3" height="${H}" fill="#2F5A45"/>`;
    const cx = (a + b) / 2;
    for (let k = -1; k <= 10; k++) {
      const cy = 32 + 64 * k;
      s += `<polygon points="${cx},${cy - 23} ${cx + 14},${cy} ${cx},${cy + 23} ${cx - 14},${cy}" fill="#4A7A58"/>`;
      s += `<polygon points="${cx},${cy - 13} ${cx + 8},${cy} ${cx},${cy + 13} ${cx - 8},${cy}" fill="#B3352A"/>`;
      s += `<circle cx="${cx}" cy="${cy}" r="3.2" fill="#2E3F6E"/>`;
      // между розетками: две синие точки, красный «бутон», зелёные листики
      s += `<circle cx="${cx - 10}" cy="${cy + 32}" r="2.8" fill="#2E3F6E"/><circle cx="${cx + 10}" cy="${cy + 32}" r="2.8" fill="#2E3F6E"/>`;
      s += `<ellipse cx="${cx}" cy="${cy + 32}" rx="3" ry="6" fill="#B3352A"/>`;
      s += `<ellipse cx="${cx}" cy="${cy + 23.5}" rx="5" ry="2" fill="#4A7A58"/><ellipse cx="${cx}" cy="${cy + 40.5}" rx="5" ry="2" fill="#4A7A58"/>`;
    }
  }
  for (const x0 of [58, W - 61]) s += `<rect x="${x0}" y="0" width="3" height="${H}" fill="#741612"/>`;
  return s + '</svg>';
}

/** Профнастил под сводом (128 × 128 = 0.6 м): гофры вдоль свода — светлый гребень, тень в канавке. */
function profSvg() {
  let s = svgOpen(128, 128) + `<rect width="128" height="128" fill="#D9DAD5"/>`;
  for (let k = 0; k < 8; k++) {
    const x = k * 16;
    s += `<rect x="${x + 1}" y="0" width="6" height="128" fill="#E8E9E4"/><rect x="${x + 9}" y="0" width="3" height="128" fill="#BABBB6"/>`;
    s += `<rect x="${x + 7}" y="0" width="2" height="128" fill="#CACBC6"/>`;
  }
  return s + '</svg>';
}

/** Кафель: n × n плиток по px, затирка grout, плитки чуть разного тона. */
function tileSvg(n, px, colors, grout) {
  let s = svgOpen(n * px, n * px) + `<rect width="${n * px}" height="${n * px}" fill="${grout}"/>`;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    s += `<rect x="${i * px + 1}" y="${j * px + 1}" width="${px - 2}" height="${px - 2}" fill="${colors[Math.floor(rnd() * colors.length)]}"/>`;
  }
  return s + '</svg>';
}

/** Мозаика дна (512 × 512 = 4 м, плитка 6.25 см) — как видна сквозь воду: бирюза, «ковры» тёмно-синей мозаики
 *  (рамки и шашка), зигзаг-полоса, редкие тёмные плитки; всё периодично — повтор без шва. */
function mosaicSvg() {
  const n = 64, px = 8;
  const pal = ['#3FA6B3', '#47AFBB', '#38A0AE', '#52B6C1', '#43AAB7', '#4DB3BE'];
  const dark = ['#226E86', '#1D6580', '#2A7890'];
  const wrap = (a, c) => {
    const d = Math.abs(a - c) % n;
    return Math.min(d, n - d);
  };
  let s = svgOpen(n * px, n * px) + `<rect width="${n * px}" height="${n * px}" fill="#9FD3D8"/>`;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    let dk = rnd() < 0.03;
    for (const [ci, cj, r] of [[14, 18, 7], [44, 46, 9], [50, 12, 5]]) {
      const di = wrap(i, ci), dj = wrap(j, cj), m = Math.max(di, dj);
      if (m === r || m === r - 2 || (m <= r - 4 && (di + dj) % 2 === 0)) dk = true;
    }
    const zig = i % 8 < 4 ? i % 8 : 8 - (i % 8);
    if (wrap(j, 32 + zig) === 0) dk = true;
    const col = dk ? dark[Math.floor(rnd() * dark.length)] : pal[Math.floor(rnd() * pal.length)];
    s += `<rect x="${i * px + 1}" y="${j * px + 1}" width="${px - 2}" height="${px - 2}" fill="${col}"/>`;
  }
  return s + '</svg>';
}

/** Рябь воды (256 × 256 = 1.5 м, альфа): сетка волнистых линий-бликов; периодична по обеим осям. */
function rippleSvg() {
  const W = 256;
  let s = svgOpen(W, W);
  const path = (pts) => 'M' + pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' L');
  for (const axis of [0, 1]) {
    for (let k = 0; k < 4; k++) {
      const c0 = ((k + rr(0.1, 0.7)) * W) / 4, a = rr(5, 10), f = 1 + (k % 3), ph = rr(0, 2 * PI), a2 = rr(2, 5), f2 = f + 2, ph2 = rr(0, 2 * PI);
      const w = rr(1.1, 1.9);
      for (const off of [-W, 0, W]) {
        const pts = [];
        for (let t = 0; t <= W; t += 4) {
          const q = c0 + off + a * Math.sin((2 * PI * f * t) / W + ph) + a2 * Math.sin((2 * PI * f2 * t) / W + ph2);
          pts.push(axis ? [q, t] : [t, q]);
        }
        s += `<path d="${path(pts)}" fill="none" stroke="#fff" stroke-width="${w.toFixed(2)}" stroke-linecap="round"/>`;
      }
    }
  }
  return s + '</svg>';
}

/** Тюль на просвет (128 × 256 = 0.3 × 1.2 м): вертикальные складки светлее/темнее, редкие поперечные нити. */
function tulleSvg() {
  let s = svgOpen(128, 256);
  for (let x = 0; x < 128; x++) {
    const f = 0.5 + 0.5 * Math.sin((2 * PI * x * 3) / 128);
    const g = 0.5 + 0.5 * Math.sin((2 * PI * x * 7) / 128 + 1.3);
    const L = 0.87 + 0.1 * f + 0.025 * g;
    const c = Math.round(255 * L);
    s += `<rect x="${x}" y="0" width="1" height="256" fill="rgb(${c - 4},${c},${Math.min(255, c + 1)})"/>`;
  }
  for (let y = 0; y < 256; y += 4) s += `<rect x="0" y="${y}" width="128" height="1" fill="#ffffff" fill-opacity="0.08"/>`;
  return s + '</svg>';
}

/** Стенд «Распорядок дня» (672 × 492 = 1.12 × 0.82 м). */
function boardSvg() {
  const rows = [
    ['7.30', 'Подъём'],
    ['7.45 – 8.15', 'Утренняя гимнастика'],
    ['8.30', 'Завтрак'],
    ['9.00 – 13.00', 'Лечебные процедуры'],
    ['13.30', 'Обед'],
    ['14.00 – 16.00', 'Тихий час'],
    ['16.30', 'Полдник'],
    ['17.00 – 19.00', 'Прогулка, терренкур'],
    ['19.00', 'Ужин'],
    ['20.00', 'Кинофильм, танцы'],
    ['22.00', 'Отбой'],
  ];
  let s = svgOpen(672, 492) + `<rect width="672" height="492" fill="#EEE5CC"/>`;
  s += `<rect x="16" y="14" width="640" height="464" fill="none" stroke="#8C2A22" stroke-width="3"/>`;
  s += `<rect x="24" y="22" width="624" height="448" fill="none" stroke="#8C2A22" stroke-width="1"/>`;
  s += `<text x="336" y="82" text-anchor="middle" font-family="Times New Roman, serif" font-weight="bold" font-size="52" fill="#9E2A20">РАСПОРЯДОК ДНЯ</text>`;
  s += `<rect x="150" y="96" width="372" height="3" fill="#9E2A20"/>`;
  rows.forEach(([t, w], k) => {
    const y = 136 + k * 30;
    s += `<text x="66" y="${y}" font-family="Arial, sans-serif" font-weight="bold" font-size="23" fill="#2A2622">${t}</text>`;
    s += `<text x="250" y="${y}" font-family="Arial, sans-serif" font-size="23" fill="#2A2622">${w}</text>`;
    s += `<rect x="250" y="${y + 6}" width="360" height="1" fill="#B9AE92"/>`;
  });
  s += `<text x="610" y="460" text-anchor="end" font-family="Times New Roman, serif" font-style="italic" font-size="20" fill="#5A4A3A">Администрация санатория</text>`;
  return s + '</svg>';
}

/** Циферблат (256 × 256): риски минут и часов, цифры, «Янтарь». */
function dialSvg() {
  let s = svgOpen(256, 256) + `<rect width="256" height="256" fill="#F3F0E6"/>`;
  s += `<circle cx="128" cy="128" r="122" fill="none" stroke="#2A2622" stroke-width="3"/>`;
  for (let k = 0; k < 60; k++) {
    const f = (k / 60) * 2 * PI, big = k % 5 === 0;
    const r0 = big ? 100 : 108, r1 = 116;
    s += `<line x1="${128 + r0 * Math.sin(f)}" y1="${128 - r0 * Math.cos(f)}" x2="${128 + r1 * Math.sin(f)}" y2="${128 - r1 * Math.cos(f)}" stroke="#2A2622" stroke-width="${big ? 5 : 1.6}"/>`;
  }
  for (let h = 1; h <= 12; h++) {
    const f = (h / 12) * 2 * PI;
    s += `<text x="${128 + 82 * Math.sin(f)}" y="${128 - 82 * Math.cos(f) + 9}" text-anchor="middle" font-family="Arial, sans-serif" font-size="25" fill="#2A2622">${h}</text>`;
  }
  s += `<text x="128" y="92" text-anchor="middle" font-family="Times New Roman, serif" font-size="15" fill="#6A1E1A">ЯНТАРЬ</text>`;
  s += `<text x="128" y="182" text-anchor="middle" font-family="Arial, sans-serif" font-size="9" fill="#5A544C">СДЕЛАНО В СССР</text>`;
  return s + '</svg>';
}

/** Табличка «РЕГИСТРАТУРА» (512 × 64): золото по тёмно-красному. */
function plaqueSvg() {
  let s = svgOpen(512, 64) + `<rect width="512" height="64" fill="#5C1A17"/>`;
  s += `<rect x="4" y="4" width="504" height="56" fill="none" stroke="#C9A24E" stroke-width="2"/>`;
  s += `<text x="256" y="45" text-anchor="middle" font-family="Times New Roman, serif" font-weight="bold" font-size="38" letter-spacing="6" fill="#D9B45C">РЕГИСТРАТУРА</text>`;
  return s + '</svg>';
}

const TX = {
  runner: await texture('san_runner', runnerSvg()),
  prof: await texture('san_profnastil', profSvg()),
  tileWhite: await texture('san_tile_white', tileSvg(4, 32, ['#EEEEE8', '#EAEAE3', '#F1F1EC', '#E7E7E0'], '#C6C5BD')),
  poolTile: await texture('san_pool_tile', tileSvg(4, 32, ['#9ACFD7', '#A3D5DC', '#93C9D2', '#A9D9DF'], '#D9EEEF')),
  mosaic: await texture('san_pool_mosaic', mosaicSvg()),
  ripple: await texture('san_pool_water', rippleSvg(), [182, 230, 234]),
  tulle: await texture('san_tulle', tulleSvg()),
  board: await texture('san_noticeboard', boardSvg()),
  dial: await texture('san_clock_dial', dialSvg()),
  plaque: await texture('san_plaque', plaqueSvg()),
};

// ───────── материалы ─────────
const hex = (h) => [1, 3, 5].map((k) => +(parseInt(h.slice(k, k + 2), 16) / 255).toFixed(4));
/** Повтор текстуры материала, м (0 — без текстуры): UV проекцией по нормали, если не заданы явно. */
const MAT_TILE = new Map();
/** Цвет — как в болванке (#rrggbb без перевода в линейный: PropModels кладёт его в StandardMaterial как есть).
 *  o.tex — текстура (цвет материала тогда белый), o.tile — её повтор, м; o.mask — альфа-тест по текстуре. */
function mat(name, color, o = {}) {
  const m = doc.createMaterial(name).setBaseColorFactor([...hex(color), 1]).setMetallicFactor(0).setRoughnessFactor(o.rough ?? 0.85);
  if (o.glow) m.setEmissiveFactor(hex(o.glow));
  if (o.two) m.setDoubleSided(true);
  if (o.tex) m.setBaseColorTexture(o.tex);
  if (o.mask) m.setAlphaMode('MASK').setAlphaCutoff(0.5);
  MAT_TILE.set(m, o.tex ? (o.tile ?? 1) : 0);
  return m;
}
const C = {
  // дерево: светлое (банкетки, стойка, перегородка, рамы), тёмное (ножки, цоколь, карниз, накладки)
  wood: mat('san_wood_light', '#B8834E', { rough: 0.55 }),
  woodDark: mat('san_wood_dark', '#6E4527', { rough: 0.6 }),
  // белая эмаль рам и подоконника, штукатурка откосов
  paint: mat('san_paint_white', '#ECEAE2', { rough: 0.5 }),
  plaster: mat('san_plaster_reveal', '#E2DFD4', { rough: 0.9 }),
  // ткани: бирюзовые портьеры и ламбрекен, красная подушка, бордовый дерматин
  drape: mat('san_drape_teal', '#4E9D91', { rough: 0.9, two: true }),
  cushion: mat('san_cushion_red', '#9C2620', { rough: 0.8 }),
  leather: mat('san_leather_bordo', '#6A2026', { rough: 0.45 }),
  leatherDark: mat('san_leather_dark', '#3E1216', { rough: 0.5 }),
  // металл
  brass: mat('san_brass', '#B38E46', { rough: 0.35 }),
  chrome: mat('san_chrome', '#CDD2D4', { rough: 0.2 }),
  enamel: mat('san_enamel', '#E9E7E1', { rough: 0.4 }),
  black: mat('san_black', '#1E1D1C', { rough: 0.5 }),
  castIron: mat('san_radiator', '#D6D0C0', { rough: 0.6 }),
  frame: mat('san_window_frame', '#46504C', { rough: 0.5 }),
  // бетон свода и опор
  concrete: mat('san_concrete', '#BDBAB2', { rough: 0.9 }),
  // растения и кадки
  terracotta: mat('san_terracotta', '#B4653E', { rough: 0.8 }),
  soil: mat('san_soil', '#3B2C20', { rough: 0.95 }),
  leaf: mat('san_leaf', '#2F5B2C', { rough: 0.7, two: true }),
  leafDark: mat('san_leaf_dark', '#234726', { rough: 0.7, two: true }),
  frond: mat('san_frond', '#4D7E3A', { rough: 0.7, two: true }),
  stem: mat('san_stem', '#6A5A3C', { rough: 0.8 }),
  frondStem: mat('san_frond_stem', '#55702F', { rough: 0.8 }),
  // пластик стульев, матовое стекло перегородки, хрусталь люстры, зелёный абажур, бумага
  plastic: mat('san_plastic_white', '#F0F0EB', { rough: 0.5, two: true }),
  glass: mat('san_glass_frosted', '#A9C0BD', { rough: 0.15 }),
  crystal: mat('san_crystal', '#DCE6EA', { rough: 0.1 }),
  shade: mat('san_shade_green', '#2F6B48', { rough: 0.3, two: true }),
  paper: mat('san_paper', '#EFEBDF', { rough: 0.9 }),
  // текстурные
  runner: mat('san_runner', '#FFFFFF', { tex: TX.runner, rough: 0.95 }),
  runnerEdge: mat('san_runner_edge', '#7A1A15', { rough: 0.95 }),
  profnastil: mat('san_profnastil', '#FFFFFF', { tex: TX.prof, tile: 0.6, rough: 0.6 }),
  tile: mat('san_tile_white', '#FFFFFF', { tex: TX.tileWhite, tile: 0.6, rough: 0.3 }),
  poolTile: mat('san_pool_tile', '#FFFFFF', { tex: TX.poolTile, tile: 0.4, rough: 0.3 }),
  mosaic: mat('san_pool_mosaic', '#FFFFFF', { tex: TX.mosaic, tile: 4.0, rough: 0.3 }),
  water: mat('san_pool_water', '#FFFFFF', { tex: TX.ripple, tile: 1.5, rough: 0.1, mask: true }),
  board: mat('san_noticeboard', '#FFFFFF', { tex: TX.board, rough: 0.9 }),
  dial: mat('san_clock_dial', '#FFFFFF', { tex: TX.dial, rough: 0.4 }),
  plaque: mat('san_plaque', '#FFFFFF', { tex: TX.plaque, rough: 0.35 }),
  // светящиеся
  lampGlow: mat('san_lamp_glow', '#F4F2EA', { glow: '#F2F0E6' }),
  lampWarm: mat('san_lamp_warm', '#FFE2A8', { glow: '#F6D79A' }),
  daylight: mat('san_daylight_glow', '#E3ECEE', { glow: '#DCE7EA' }),
  tulle: mat('san_tulle_glow', '#FFFFFF', { glow: '#E8ECE8', tex: TX.tulle, two: true }),
};

// ───────── сборка сетки ─────────
/** Треугольник: обход — по нормалям вершин (лицевая сторона — куда смотрят нормали); вырожденный — пропуск. */
function tri(g, a, b, c) {
  const P = (i) => [g.p[3 * i], g.p[3 * i + 1], g.p[3 * i + 2]];
  const N = (i) => [g.n[3 * i], g.n[3 * i + 1], g.n[3 * i + 2]];
  const gn = cross(sub(P(b), P(a)), sub(P(c), P(a)));
  if (Math.hypot(gn[0], gn[1], gn[2]) < 1e-10) return;
  if (dot(gn, add(add(N(a), N(b)), N(c))) < 0) g.i.push(a, c, b);
  else g.i.push(a, b, c);
}

/** Геометрия: примитив на материал (позиции, нормали, UV, индексы). */
class Geo {
  constructor() {
    this.parts = new Map();
  }
  g(m) {
    let x = this.parts.get(m);
    if (!x) this.parts.set(m, (x = { m, p: [], n: [], uv: [], i: [] }));
    return x;
  }
  vert(g, p, n, uv) {
    g.p.push(p[0], p[1], p[2]);
    const q = norm(n);
    g.n.push(q[0], q[1], q[2]);
    const tile = MAT_TILE.get(g.m);
    if (!uv && tile) {
      // проекция по нормали, м / повтор; v вниз (glTF: v = 0 — верх картинки)
      const ax = Math.abs(q[0]), ay = Math.abs(q[1]), az = Math.abs(q[2]);
      uv = ax >= ay && ax >= az ? [p[2] * Math.sign(q[0]), -p[1]] : ay >= az ? [p[0], p[2]] : [-p[0] * Math.sign(q[2]), -p[1]];
      uv = [uv[0] / tile, uv[1] / tile];
    }
    g.uv.push(uv ? uv[0] : 0, uv ? uv[1] : 0);
    return g.p.length / 3 - 1;
  }
  /** Четырёхугольник a-b-c-d (по кругу), нормаль n (одна) или ns (на вершину), uvs — UV вершин. */
  quad(m, a, b, c, d, n, ns, uvs) {
    const g = this.g(m);
    n ??= cross(sub(b, a), sub(c, a));
    const i = [a, b, c, d].map((p, k) => this.vert(g, p, ns ? ns[k] : n, uvs?.[k]));
    tri(g, i[0], i[1], i[2]);
    tri(g, i[0], i[2], i[3]);
  }
  /** Выпуклый многоугольник веером, нормаль n. */
  poly(m, pts, n, uvs) {
    const g = this.g(m);
    const i = pts.map((p, k) => this.vert(g, p, n, uvs?.[k]));
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
  /** Повёрнутый бокс: центр c, оси [U, V, W] (единичные), полуразмеры hu, hv, hw; skip — как у box (по осям U V W). */
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
  /** Трубка радиуса r по ломаной (рамка переносится параллельно — без перекрута); caps: 'both' | 'start' | 'end'. */
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
        const q = (s / seg) * 2 * PI + (o.phase ?? 0);
        const d = add(mul(u, Math.cos(q)), mul(v, Math.sin(q)));
        ring.push(this.vert(g, add(pts[k], mul(d, r)), d));
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
  /** Тело вращения: профиль [r, y] (нормаль (dy, −dr) — наружу) вокруг оси axis через c; a0…a1 — часть оборота.
   *  Вдоль профиля гладко, где излом меньше crease (°, по умолчанию 40; smooth — всюду гладко). */
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
        ids.push(this.vert(g, p, nn));
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
  /** Круглая картинка лицом к −Z: центр c, радиус r, UV — картинка целиком (верх картинки — вверх). */
  discUV(m, c, r, seg = 32) {
    const g = this.g(m);
    const mid = this.vert(g, c, [0, 0, -1], [0.5, 0.5]);
    const ids = [];
    for (let s = 0; s < seg; s++) {
      const f = (s / seg) * 2 * PI;
      ids.push(this.vert(g, [c[0] + r * Math.cos(f), c[1] + r * Math.sin(f), c[2]], [0, 0, -1], [0.5 + 0.5 * Math.cos(f), 0.5 - 0.5 * Math.sin(f)]));
    }
    for (let s = 0; s < seg; s++) tri(g, mid, ids[s], ids[(s + 1) % seg]);
  }
  /** Картинка на прямоугольник лицом к −Z: x0…x1, y0…y1 на глубине z. */
  picture(m, x0, y0, x1, y1, z) {
    this.quad(m, [x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], [0, 0, -1], null, [[0, 1], [1, 1], [1, 0], [0, 0]]);
  }
  /** Призма: выпуклый многоугольник pts поперёк оси (для 'x' — точки (z, y), 'y' — (x, z), 'z' — (x, y)), от a0 до
   *  a1 вдоль оси; smooth — угол (°), меньше которого рёбра сглажены; caps: false | 'a0' | 'a1' | true. */
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
  /** Поверхность по сетке nu × nv: f(u, v) → точка; нормаль — по направлению hint; uvf(u, v, p) → UV (иначе проекция). */
  surface(m, nu, nv, f, hint, uvf) {
    const g = this.g(m), e = 1e-4, ids = [];
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) {
        const u = i / nu, v = j / nv, p = f(u, v);
        const du = sub(f(Math.min(1, u + e), v), f(Math.max(0, u - e), v));
        const dv = sub(f(u, Math.min(1, v + e)), f(u, Math.max(0, v - e)));
        let n = cross(du, dv);
        if (Math.hypot(...n) < 1e-14) n = hint;
        if (dot(n, hint) < 0) n = mul(n, -1);
        ids.push(this.vert(g, p, n, uvf?.(u, v, p)));
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
}

/** Модель предмета (узел glb). */
class Model extends Geo {
  constructor(id, o = {}) {
    super();
    this.id = id;
    this.ceil = !!o.ceil;
    this.extras = o.extras ?? {};
    MODELS.push(this);
  }
}
const MODELS = [];

/** Скругленный прямоугольник (x, y) против часовой: rt — радиус верхних углов, rb — нижних. */
function rrect(x0, y0, x1, y1, rt, rb = 0, n = 4) {
  const pts = [];
  const corner = (cx, cy, r, f0) => {
    if (r <= 0) return pts.push([cx, cy]);
    for (let k = 0; k <= n; k++) {
      const f = f0 + ((PI / 2) * k) / n;
      pts.push([cx + r * Math.cos(f), cy + r * Math.sin(f)]);
    }
  };
  corner(rb ? x1 - rb : x1, rb ? y0 + rb : y0, rb, -PI / 2);
  corner(rt ? x1 - rt : x1, rt ? y1 - rt : y1, rt, 0);
  corner(rt ? x0 + rt : x0, rt ? y1 - rt : y1, rt, PI / 2);
  corner(rb ? x0 + rb : x0, rb ? y0 + rb : y0, rb, PI);
  return pts;
}
/** Отрезок прямой (px, py) + t·(dx, dy) внутри прямоугольника [x0, x1] × [y0, y1] или null. */
function clipLine(px, py, dx, dy, x0, y0, x1, y1) {
  let t0 = -Infinity, t1 = Infinity;
  for (const [p, d, a, b] of [[px, dx, x0, x1], [py, dy, y0, y1]]) {
    if (Math.abs(d) < 1e-9) {
      if (p < a || p > b) return null;
      continue;
    }
    let ta = (a - p) / d, tb = (b - p) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
  }
  if (t1 - t0 < 0.02) return null;
  return [[px + dx * t0, py + dy * t0], [px + dx * t1, py + dy * t1]];
}

// ═════════════════════════ предметы ═════════════════════════

// ── ковровая дорожка 1.2 × 3.0 (реф. 3): красное поле, кайма с орнаментом; толщина 8 мм; встык 1–3 подряд
{
  const M = new Model('p_san_runner');
  const hw = 0.6, hl = 1.5, H = 0.008;
  // верх — картинка целиком: u поперёк (слева направо), v вдоль (от +Z к −Z)
  M.quad(C.runner, [-hw, H, hl], [hw, H, hl], [hw, H, -hl], [-hw, H, -hl], [0, 1, 0], null, [[0, 0], [1, 0], [1, 1], [0, 1]]);
  M.box(C.runnerEdge, -hw, 0, -hl, hw, H, hl, 'py ny');
}

// ── окно со шторами (реф. 3): откосы, стекло-свечение «туман за окном», белая рама с импостом и фрамугой,
//    подоконник; карниз во всю ширину; тюль на просвет (две половины, посередине щель — видно стекло); бирюзовые
//    портьеры по краям, подхвачены на 1.05 м шнуром с кистью; ламбрекен — основа, три сваги-фестона с бахромой и
//    каскады по краям. T — верх карниза (2.9 — коридор 3.3; 2.45 — комната с потолком 2.5)
function curtainWindow(M, T) {
  const D = 0.125, X = 0.7, hi = T > 2.7;
  const Y0 = hi ? 0.9 : 0.85, Y1 = T - (hi ? 0.28 : 0.22);
  // проём: откосы и перемычка — штукатурка (выступ 0.1 от стены)
  M.box(C.plaster, -X - 0.08, Y0, D - 0.1, -X, Y1 + 0.08, D, 'pz ny');
  M.box(C.plaster, X, Y0, D - 0.1, X + 0.08, Y1 + 0.08, D, 'pz ny');
  M.box(C.plaster, -X, Y1, D - 0.1, X, Y1 + 0.08, D, 'pz nx px');
  // стекло
  M.quad(C.daylight, [-X, Y0, D - 0.012], [X, Y0, D - 0.012], [X, Y1, D - 0.012], [-X, Y1, D - 0.012], [0, 0, -1]);
  // рама: коробка, импост, фрамуга
  const F0 = D - 0.075, F1 = D - 0.03, b = 0.055, YT = Y1 - (hi ? 0.42 : 0.34);
  M.box(C.paint, -X, Y0, F0, -X + b, Y1, F1, 'pz');
  M.box(C.paint, X - b, Y0, F0, X, Y1, F1, 'pz');
  M.box(C.paint, -X + b, Y1 - b, F0, X - b, Y1, F1, 'pz');
  M.box(C.paint, -X + b, Y0, F0, X - b, Y0 + b, F1, 'pz');
  M.box(C.paint, -0.03, Y0 + b, F0, 0.03, Y1 - b, F1, 'pz');
  M.box(C.paint, -X + b, YT - 0.025, F0, X - b, YT + 0.025, F1, 'pz');
  // подоконник
  M.box(C.paint, -X - 0.12, Y0 - 0.045, D - 0.19, X + 0.12, Y0, D, 'pz');
  // карниз — доска во всю ширину, от стены
  M.box(C.woodDark, -0.9, T - 0.06, -D, 0.9, T, D, 'pz');
  // тюль: складки — волной по z, на просвет — текстурой
  const YR = T - 0.07;
  const tulle = (xa, xb, pleats) =>
    M.surface(C.tulle, pleats * 4, 2, (u, v) => [lerp(xa, xb, u), lerp(YR, 0.03, v), -0.086 + 0.013 * Math.sin(u * pleats * 2 * PI)], [0, 0, -1], (u, v, p) => [p[0] / 0.3, (T - p[1]) / 1.2]);
  tulle(-0.64, -0.1, 5);
  tulle(0.1, 0.64, 5);
  // портьеры: сверху во всю ширину полотна, у подхвата сжаты, книзу расходятся; три глубокие складки
  const tie = hi ? 1.05 : 1.0;
  for (const s of [-1, 1]) {
    const top = T - 0.07;
    const width = (y) => (y > tie ? lerp(0.15, 0.32, smooth((y - tie) / (top - tie))) : lerp(0.15, 0.27, smooth((tie - y) / (tie - 0.02))));
    M.surface(C.drape, 24, 16, (u, v) => {
      const y = lerp(top, 0.02, v), w = width(y);
      return [s * (0.9 - w * (1 - u)), y, -0.1 + 0.022 * Math.sin(u * 6 * PI)];
    }, [0, 0, -1]);
    // подхват: шнур вокруг полотна и кисть
    const xi = s * (0.9 - 0.17);
    M.tube(C.brass, [[xi, tie, -0.07], [xi, tie, -0.128], [s * 0.82, tie + 0.01, -0.132], [s * 0.9, tie, -0.128], [s * 0.905, tie, -0.06]], 0.007, { seg: 5 });
    M.tube(C.brass, [[s * 0.8, tie, -0.132], [s * 0.8, tie - 0.06, -0.134]], 0.005, { seg: 4 });
    M.lathe(C.brass, [[0.004, tie - 0.06], [0.02, tie - 0.09], [0.024, tie - 0.13], [0.0, tie - 0.135]].map(([r, y]) => [r, y]).reverse(), { c: [s * 0.8, 0, -0.134], seg: 8, smooth: true });
  }
  // ламбрекен: основа-полоса под карнизом
  M.box(C.drape, -0.9, T - 0.14, -D - 0.01, 0.9, T - 0.06, -D + 0.005, 'pz py');
  const DROP = hi ? 0.3 : 0.22;
  const swag = (xc, span, z0) => {
    const f = (u, v) => {
      const dr = 0.05 + DROP * Math.pow(Math.sin(PI * u), 0.8);
      return [
        xc + (u - 0.5) * span * (1 - 0.12 * v),
        T - 0.08 - v * dr,
        z0 - 0.04 * Math.sin(PI * u) * Math.sin(PI * Math.min(1, v * 1.1)) - 0.008 * Math.sin(v * 5 * PI) * Math.sin(PI * u),
      ];
    };
    M.surface(C.drape, 16, 10, f, [0, 0, -1]);
    const hem = [];
    for (let k = 0; k <= 16; k++) hem.push(add(f(k / 16, 1), [0, -0.004, 0]));
    M.tube(C.brass, hem, 0.007, { seg: 4 });
  };
  swag(-0.56, 0.74, -0.135);
  swag(0.56, 0.74, -0.135);
  swag(0, 0.76, -0.145);
  // каскады: зигзаг-складки, низ косой — длиннее у края
  for (const s of [-1, 1]) {
    M.surface(C.drape, 12, 6, (u, v) => {
      const len = lerp(0.42, 0.85, u) * (hi ? 1 : 0.8);
      const k = u * 6, zig = Math.abs((k % 2) - 1);
      return [s * lerp(0.7, 0.92, u), T - 0.08 - v * len, -0.15 - 0.028 * zig];
    }, [0, 0, -1]);
  }
}
curtainWindow(new Model('p_san_window_curtain'), 2.9);
curtainWindow(new Model('p_san_window_low'), 2.45);

// ── банкетка (реф. 3): светлое дерево — боковины, ящик-основание с филёнками, утопленный цоколь; красная подушка;
//    спинка — рама с решёткой из косых реек
{
  const M = new Model('p_san_bench');
  const hw = 0.8, z0 = -0.25, z1 = 0.25, t = 0.045;
  // боковины (торцы) — до подлокотника 0.5
  for (const s of [-1, 1]) {
    const xa = s < 0 ? -hw : hw - t, xb = s < 0 ? -hw + t : hw;
    M.box(C.wood, xa, 0, z0, xb, 0.5, z1);
  }
  // ящик-основание и цоколь
  M.box(C.wood, -hw + t, 0.06, z0 + 0.02, hw - t, 0.36, z1 - 0.06, 'ny nx px');
  M.box(C.woodDark, -hw + t, 0, z0 + 0.05, hw - t, 0.06, z1 - 0.08, 'ny nx px');
  // филёнки на фасаде: две рамки
  for (const [xa, xb] of [[-hw + 0.1, -0.03], [0.03, hw - 0.1]]) {
    for (const [a, b] of [[[xa, 0.1], [xb, 0.1]], [[xa, 0.31], [xb, 0.31]], [[xa, 0.1], [xa, 0.31]], [[xb, 0.1], [xb, 0.31]]]) {
      M.beam(C.woodDark, [a[0], a[1], z0 + 0.012], [b[0], b[1], z0 + 0.012], 0.022, 0.016, [0, 0, 1]);
    }
  }
  // подушка
  M.prism(C.cushion, 'x', rrect(z0 + 0.005, 0.355, z1 - 0.065, 0.46, 0.035, 0.012, 3), -hw + t + 0.003, hw - t - 0.003, { smooth: 50 });
  // спинка: стойки, верхний и нижний брус, решётка
  const zb = z1 - 0.025;
  for (const s of [-1, 1]) M.box(C.wood, s < 0 ? -hw + t : hw - t - 0.05, 0.36, z1 - 0.05, s < 0 ? -hw + t + 0.05 : hw - t, 0.75, z1);
  M.box(C.wood, -hw + t, 0.69, z1 - 0.055, hw - t, 0.75, z1);
  M.box(C.wood, -hw + t, 0.44, z1 - 0.05, hw - t, 0.49, z1);
  const xa = -hw + t + 0.05, xb = hw - t - 0.05, ya = 0.49, yb = 0.69;
  for (const [dir, dz] of [[[1, 1], -0.006], [[1, -1], 0.006]]) {
    for (let c = xa - (yb - ya) - 0.2; c < xb + 0.2; c += 0.1) {
      const sgm = clipLine(c, ya, dir[0], dir[1], xa, ya, xb, yb);
      if (!sgm) continue;
      M.beam(C.wood, [sgm[0][0], sgm[0][1], zb + dz], [sgm[1][0], sgm[1][1], zb + dz], 0.018, 0.014, [0, 0, 1]);
    }
  }
}

// ── растения: кадка (терракота, валик по верху, поддон, земля); листва строится списком, затем вписывается в габарит
//    (верх, радиус) и рисуется
function pot(M, R, H) {
  M.lathe(C.terracotta, [[R * 0.78, 0.0], [R * 0.86, 0.0], [R * 0.9, 0.03], [R * 0.84, 0.03], [R * 0.8, 0.012]], { seg: 20 });
  M.lathe(C.terracotta, [[R * 0.66, 0.025], [R * 0.8, H * 0.5], [R * 0.9, H * 0.86], [R * 0.9, H * 0.88], [R, H * 0.9], [R, H], [R * 0.88, H], [R * 0.86, H * 0.93]], { seg: 20, crease: 35 });
  M.disc(C.soil, [0, H * 0.93, 0], [0, 1, 0], R * 0.87, 20);
}
/** Лист: ромб от основания c в направлении dir. */
function leafQuad(c, dir, len, wid) {
  dir = norm(dir);
  let side = cross(dir, [0, 1, 0]);
  if (Math.hypot(...side) < 1e-3) side = [1, 0, 0];
  side = norm(side);
  const tip = add(c, mul(dir, len)), mid = add(c, mul(dir, len * 0.42));
  return [c, add(mid, mul(side, wid / 2)), tip, add(mid, mul(side, -wid / 2))];
}
/** Вписать листву в габарит: подъём над base — до top, радиус — не больше rmax; нарисовать. */
function drawFoliage(M, ops, base, top, rmax) {
  let ymax = -Infinity, rm = 0;
  for (const o of ops) for (const p of o.pts) {
    ymax = Math.max(ymax, p[1] + (o.r ?? 0));
    rm = Math.max(rm, Math.hypot(p[0], p[2]) + (o.r ?? 0));
  }
  const sy = (top - base) / (ymax - base), sr = Math.min(1, rmax / rm);
  const T = (p) => [p[0] * sr, base + (p[1] - base) * sy, p[2] * sr];
  for (const o of ops) {
    const pts = o.pts.map(T);
    if (o.r) M.tube(o.m, pts, o.r, { seg: o.seg ?? 4 });
    else {
      let n = norm(cross(sub(pts[1], pts[0]), sub(pts[3], pts[0])));
      if (n[1] < 0) n = mul(n, -1);
      M.quad(o.m, pts[0], pts[1], pts[2], pts[3], n);
    }
  }
}

// ── фикус в кадке (реф. 3): ствол, ветки, облако мелких тёмных листьев
{
  const M = new Model('p_san_ficus');
  const PR = 0.25, PH = 0.42, base = PH * 0.93;
  pot(M, PR, PH);
  const ops = [];
  ops.push({ m: C.stem, r: 0.017, seg: 6, pts: [[0, base, 0], [0.015, 0.8, 0.01], [-0.01, 1.15, 0.02], [0.01, 1.45, -0.005], [0, 1.7, 0.01]] });
  for (let k = 0; k < 8; k++) {
    const a = k * 2.4 + rr(-0.3, 0.3), y = 0.95 + k * 0.09;
    const p1 = [Math.cos(a) * 0.17, y + 0.16, Math.sin(a) * 0.17];
    ops.push({ m: C.stem, r: 0.007, pts: [[0, y, 0], [p1[0] * 0.5, y + 0.1, p1[2] * 0.5], p1] });
  }
  const cc = [0, 1.42, 0], R3 = [0.26, 0.42, 0.26];
  for (let k = 0; k < 640; k++) {
    const zz = rr(-1, 1), f = rr(0, 2 * PI), q = Math.sqrt(1 - zz * zz);
    const d = [q * Math.cos(f), zz, q * Math.sin(f)];
    const r = 0.45 + 0.55 * Math.sqrt(rnd());
    const c = [cc[0] + d[0] * R3[0] * r, cc[1] + d[1] * R3[1] * r, cc[2] + d[2] * R3[2] * r];
    const dir = add(d, [rr(-0.4, 0.4), -0.3 + rr(-0.3, 0.3), rr(-0.4, 0.4)]);
    ops.push({ m: rnd() < 0.55 ? C.leaf : C.leafDark, pts: leafQuad(c, dir, rr(0.075, 0.1), rr(0.036, 0.05)) });
  }
  drawFoliage(M, ops, base, 1.9, 0.36);
}

// ── пальма (кентия) в кадке: дуги перистых вай от земли, листочки свисают
{
  const M = new Model('p_san_palm');
  const PR = 0.27, PH = 0.45, base = PH * 0.93;
  pot(M, PR, PH);
  const ops = [];
  const NF = 13;
  for (let k = 0; k < NF; k++) {
    const a = (k / NF) * 2 * PI + rr(-0.25, 0.25);
    const tall = [1, 0.86, 0.74][k % 3] * rr(0.95, 1.05);
    const reach = rr(0.3, 0.4) * (1.15 - 0.4 * (tall - 0.74));
    const P0 = [0.02, base], P1 = [reach * 0.45, base + 1.2 * tall], P2 = [reach, base + 0.55 * tall];
    const at = (t) => [lerp(lerp(P0[0], P1[0], t), lerp(P1[0], P2[0], t), t), lerp(lerp(P0[1], P1[1], t), lerp(P1[1], P2[1], t), t)];
    const W = (q) => [q[0] * Math.cos(a), q[1], q[0] * Math.sin(a)];
    const rach = [];
    for (let i = 0; i <= 12; i++) rach.push(W(at(i / 12)));
    ops.push({ m: C.frondStem, r: 0.006, pts: rach });
    const side = [-Math.sin(a), 0, Math.cos(a)];
    for (let i = 0; i < 22; i++) {
      const t = 0.16 + (0.82 * i) / 21;
      const p = W(at(t)), tg = norm(sub(W(at(t + 0.01)), p));
      const len = 0.05 + 0.17 * Math.sin((PI * (t - 0.1)) / 0.95);
      for (const s of [-1, 1]) {
        const dir = add(add(mul(side, s * 0.9), mul(tg, 0.5)), [0, -0.18, 0]);
        ops.push({ m: C.frond, pts: leafQuad(p, dir, len, 0.032) });
      }
    }
  }
  drawFoliage(M, ops, base, 1.7, 0.41);
}

// ── плоский круглый плафон под потолком (подвесной: верх — 0, низ — −0.12): эмалированное основание, хромированный
//    поясок, молочный купол (светится — san_lamp_glow)
{
  const M = new Model('p_san_ceiling_lamp', { ceil: true });
  M.lathe(C.enamel, [[0.236, -0.032], [0.25, -0.026], [0.25, 0]], { seg: 28 });
  M.lathe(C.chrome, [[0.232, -0.04], [0.242, -0.036], [0.242, -0.026]], { seg: 28 });
  M.lathe(C.lampGlow, [[0, -0.12], [0.08, -0.116], [0.15, -0.1], [0.2, -0.077], [0.233, -0.04]], { seg: 28, smooth: true });
}

// ── люстра вестибюля (подвесной: верх — 0, низ — −0.9): латунная чаша у потолка, штанга, тело-ваза, восемь рожков
//    S-изгибом с розетками и матовыми тюльпанами (светятся), хрустальные подвески, нижний наконечник с каплей
{
  const M = new Model('p_san_chandelier', { ceil: true });
  M.lathe(C.brass, [[0.03, -0.08], [0.09, -0.03], [0.1, -0.006], [0.1, 0]], { seg: 16 });
  M.tube(C.brass, [[0, -0.08, 0], [0, -0.43, 0]], 0.012, { seg: 8 });
  M.lathe(C.brass, [[0, -0.62], [0.05, -0.6], [0.09, -0.545], [0.1, -0.5], [0.075, -0.462], [0.025, -0.435], [0.012, -0.425]], { seg: 16, smooth: true });
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * 2 * PI;
    const W = (r, y) => [r * Math.cos(a), y, r * Math.sin(a)];
    const arm = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      arm.push(W(lerp(0.08, 0.5, t), -0.52 - 0.1 * Math.sin(PI * t * 0.9) + 0.06 * t * t));
    }
    arm.push(W(0.5, -0.48));
    M.tube(C.brass, arm, 0.009, { seg: 6 });
    const c = W(0.5, 0);
    M.lathe(C.brass, [[0.012, -0.5], [0.05, -0.49], [0.05, -0.48], [0.014, -0.475]], { c, seg: 12 });
    M.lathe(C.lampGlow, [[0.022, -0.475], [0.05, -0.45], [0.072, -0.39], [0.076, -0.33]], { c, seg: 12, smooth: true });
    // подвеска-капля под серединой рожка
    const h = W(0.3, -0.61);
    M.tube(C.brass, [h, add(h, [0, -0.025, 0])], 0.002, { seg: 3 });
    M.lathe(C.crystal, [[0, -0.715], [0.014, -0.69], [0.016, -0.665], [0.0, -0.635]], { c: [h[0], 0, h[2]], seg: 6, crease: 30 });
  }
  M.lathe(C.brass, [[0, -0.8], [0.02, -0.76], [0.035, -0.7], [0.03, -0.65], [0.045, -0.62]], { seg: 12, smooth: true });
  M.lathe(C.crystal, [[0, -0.9], [0.025, -0.86], [0.028, -0.83], [0.0, -0.8]], { seg: 8, crease: 30 });
}

// ── стойка регистратуры 3.0 × 0.8 (выс. 1.1): светлое дерево, фасад с вертикальными накладками, табличка
//    «РЕГИСТРАТУРА», полка-барьер; внутри — стол на 0.76, лампа с зелёным абажуром (светится тёпло), телефон, журнал
{
  const M = new Model('p_san_reception');
  const X = 1.5, ZF = -0.38;
  for (const s of [-1, 1]) M.box(C.wood, s < 0 ? -X : X - 0.04, 0, -0.4, s < 0 ? -X + 0.04 : X, 1.05, 0.4);
  M.box(C.wood, -X + 0.04, 0.06, ZF, X - 0.04, 1.05, ZF + 0.04, 'nx px');
  M.box(C.woodDark, -X + 0.04, 0, ZF + 0.02, X - 0.04, 0.06, ZF + 0.06, 'nx px py');
  // накладки: вертикальные, мимо таблички
  for (let x = -X + 0.15; x < X - 0.1; x += 0.2) {
    if (Math.abs(x) < 0.62) continue;
    M.box(C.woodDark, x - 0.015, 0.12, ZF - 0.012, x + 0.015, 0.92, ZF, 'pz');
  }
  M.box(C.woodDark, -X + 0.04, 0.96, ZF - 0.015, X - 0.04, 0.99, ZF, 'pz');
  M.box(C.woodDark, -X + 0.04, 0.08, ZF - 0.01, X - 0.04, 0.1, ZF, 'pz');
  M.picture(C.plaque, -0.55, 0.8, 0.55, 0.92, ZF - 0.0105);
  M.box(C.woodDark, -0.57, 0.785, ZF - 0.008, 0.57, 0.935, ZF - 0.002, 'pz');
  // барьер и стол
  M.box(C.wood, -X - 0.02, 1.05, -0.44, X + 0.02, 1.1, -0.12);
  M.box(C.wood, -X + 0.04, 0.88, ZF + 0.04, X - 0.04, 0.9, -0.12, 'nx px');
  M.box(C.wood, -X + 0.04, 0.72, ZF + 0.04, X - 0.04, 0.76, 0.4, 'nx px');
  // лампа
  const L = [1.0, 0.76, 0.16];
  M.lathe(C.brass, [[0.07, 0], [0.07, 0.015], [0.04, 0.03], [0.012, 0.035]].map(([r, y]) => [r, y + L[1]]), { c: [L[0], 0, L[2]], seg: 12 });
  M.tube(C.brass, [[L[0], L[1] + 0.03, L[2]], [L[0], L[1] + 0.23, L[2]]], 0.008, { seg: 6 });
  M.lathe(C.shade, [[0.12, 0.985], [0.1, 1.03], [0.05, 1.075], [0.02, 1.085]], { c: [L[0], 0, L[2]], seg: 16, smooth: true });
  M.blob(C.lampWarm, [L[0], 1.005, L[2]], 0.035, 0.03, 0.035, 4, 8);
  // телефон
  M.box(C.black, -1.05, 0.76, 0.05, -0.83, 0.82, 0.25);
  M.tube(C.black, [[-1.04, 0.85, 0.1], [-0.84, 0.85, 0.1]], 0.022, { seg: 6, caps: true });
  M.disc(C.paper, [-0.94, 0.8205, 0.18], [0, 1, 0], 0.045, 12);
  // журнал раскрытый
  M.obox(C.paper, [-0.2, 0.765, 0.15], [[0.996, 0.087, 0], [-0.087, 0.996, 0], [0, 0, 1]], 0.16, 0.005, 0.12);
  M.obox(C.paper, [0.12, 0.765, 0.15], [[0.996, -0.087, 0], [0.087, 0.996, 0], [0, 0, 1]], 0.16, 0.005, 0.12);
}

// ── диван дерматиновый бордовый 2.0 × 0.8: ножки-конусы, две подушки сиденья, спинка с пуговицами, подлокотники с
//    деревянными накладками
{
  const M = new Model('p_san_sofa');
  for (const x of [-0.9, 0.9]) for (const z of [-0.32, 0.3]) M.lathe(C.woodDark, [[0.018, 0], [0.025, 0.12]], { c: [x, 0, z], seg: 8 });
  M.box(C.leather, -0.88, 0.12, -0.38, 0.88, 0.3, 0.36, 'ny');
  for (const [xa, xb] of [[-0.87, -0.006], [0.006, 0.87]]) M.prism(C.leather, 'x', rrect(-0.41, 0.29, 0.18, 0.46, 0.05, 0.02, 3), xa, xb, { smooth: 50 });
  const back = [[0.16, 0.44], [0.38, 0.44], [0.395, 0.8], [0.365, 0.85], [0.24, 0.85], [0.19, 0.815]];
  M.prism(C.leather, 'x', back, -0.87, 0.87, { smooth: 45 });
  for (const y of [0.6, 0.74]) for (let x = -0.75; x <= 0.76; x += 0.25) {
    const z = lerp(0.16, 0.19, (y - 0.44) / 0.375) - 0.004;
    M.disc(C.leatherDark, [x, y, z], [0, 0.08, -1], 0.012, 8);
  }
  for (const s of [-1, 1]) {
    M.box(C.leather, s < 0 ? -1.0 : 0.87, 0.12, -0.4, s < 0 ? -0.87 : 1.0, 0.6, 0.38);
    M.box(C.woodDark, s < 0 ? -1.0 : 0.86, 0.6, -0.42, s < 0 ? -0.86 : 1.0, 0.63, 0.38);
  }
}

// ── стенд «Распорядок дня» (настенный: 1.0…1.9): деревянная рама, лист под ней
{
  const M = new Model('p_san_noticeboard');
  const X = 0.6, Y0 = 1.0, Y1 = 1.9, Z0 = -0.025, Z1 = 0.025, f = 0.04;
  M.box(C.wood, -X, Y0, Z0, X, Y0 + f, Z1, 'pz');
  M.box(C.wood, -X, Y1 - f, Z0, X, Y1, Z1, 'pz');
  M.box(C.wood, -X, Y0 + f, Z0, -X + f, Y1 - f, Z1, 'pz py ny');
  M.box(C.wood, X - f, Y0 + f, Z0, X, Y1 - f, Z1, 'pz py ny');
  M.picture(C.board, -X + f, Y0 + f, X - f, Y1 - f, -0.008);
}

// ── часы настенные (центр 2.2 м, Ø 0.4): корпус-обод, циферблат картинкой, стрелки — 10:08
{
  const M = new Model('p_san_clock');
  const c = [0, 2.2, 0];
  M.lathe(C.woodDark, [[0.176, -0.02], [0.176, -0.03], [0.19, -0.03], [0.2, -0.022], [0.2, 0.03]], { c, axis: 'z', seg: 32 });
  M.discUV(C.dial, [0, 2.2, -0.02], 0.177, 36);
  const hand = (deg, len, w, z) => {
    const f = (deg * PI) / 180, V = [Math.sin(f), Math.cos(f), 0], U = [Math.cos(f), -Math.sin(f), 0];
    M.obox(C.black, add(c, add(mul(V, len / 2 - 0.02), [0, 0, z])), [U, V, [0, 0, 1]], w / 2, len / 2 + 0.02, 0.0015);
  };
  hand(((10 + 8 / 60) / 12) * 360, 0.09, 0.012, -0.024);
  hand((8 / 60) * 360, 0.14, 0.008, -0.027);
  M.lathe(C.black, [[0.012, -0.03], [0.0, -0.031]].reverse(), { c, axis: 'z', seg: 10 });
}

// ── перегородка деревянная остеклённая 0.9 × 0.12, до потолка коридора 3.3 (реф. 3, торец галереи): видна с обеих
//    сторон — стойки, филёнка внизу с раскладкой, средник, матовое стекло в переплёте
{
  const M = new Model('p_san_glass_screen');
  const X = 0.45, P = 0.06, H = 3.3;
  for (const s of [-1, 1]) M.box(C.wood, s < 0 ? -X : X - P, 0, -0.06, s < 0 ? -X + P : X, H, 0.06, 'py ny');
  M.box(C.wood, -X + P, 0, -0.025, X - P, 0.9, 0.025, 'nx px ny');
  M.box(C.woodDark, -X + P, 0, -0.04, X - P, 0.1, 0.04, 'nx px ny');
  for (const zf of [-0.031, 0.031]) {
    const zz = zf + (zf < 0 ? 0.0 : 0.0);
    for (const [a, b] of [[[-0.31, 0.18], [0.31, 0.18]], [[-0.31, 0.82], [0.31, 0.82]], [[-0.31, 0.18], [-0.31, 0.82]], [[0.31, 0.18], [0.31, 0.82]]]) {
      M.beam(C.woodDark, [a[0], a[1], zz], [b[0], b[1], zz], 0.024, 0.012, [0, 0, 1]);
    }
  }
  M.box(C.wood, -X + P, 0.9, -0.05, X - P, 1.0, 0.05, 'nx px');
  for (const y of [1.98, 2.63]) M.box(C.wood, -X + P, y - 0.03, -0.035, X - P, y + 0.03, 0.035, 'nx px');
  M.box(C.wood, -X + P, H - 0.1, -0.06, X - P, H, 0.06, 'nx px py');
  M.box(C.wood, -0.02, 1.0, -0.03, 0.02, H - 0.1, 0.03, 'py ny');
  M.box(C.glass, -X + P, 1.0, -0.004, X - P, H - 0.1, 0.004, 'nx px py ny');
}

// ── арочное окно зала бассейна 3.0 × 0.3 (выс. 6.6, реф. 2): кафельный парапет 0.48, стекло-свечение до пят арки 4.2 и
//    параболическая голова до 6.6 (вписана под торец свода p_san_vault: низ свода 4.4 при потолке 7.0), тёмный
//    стальной переплёт — рама по контуру, 5 стоек и 5 ригелей
{
  const M = new Model('p_san_arch_window');
  const HW = 1.5, YS = 4.2, TOP = 6.6, P0 = 0.48;
  M.box(C.tile, -HW, 0, -0.15, HW, P0, 0.15, 'pz ny');
  const gi = HW - 0.06, gTop = TOP - 0.06;
  const yi = (x) => YS + (gTop - YS) * (1 - (x / gi) ** 2);
  const zg = 0.14;
  const glass = [[-gi, P0, zg], [gi, P0, zg]];
  for (let k = 0; k <= 24; k++) {
    const x = gi - (2 * gi * k) / 24;
    glass.push([x, yi(x), zg]);
  }
  M.poly(C.daylight, glass, [0, 0, -1]);
  // рама по контуру: средняя линия, брус 0.08 × 0.1
  const hc = HW - 0.04, cTop = TOP - 0.04, zc = 0.08;
  const yc = (x) => YS + (cTop - YS) * (1 - (x / hc) ** 2);
  const path = [[-hc, P0 + 0.04], [-hc, YS]];
  for (let k = 1; k <= 18; k++) {
    const x = -hc + (2 * hc * k) / 18;
    path.push([x, yc(x)]);
  }
  path.push([hc, P0 + 0.04], [-hc, P0 + 0.04]);
  for (let k = 0; k + 1 < path.length; k++) {
    const a = path[k], b = path[k + 1];
    M.beam(C.frame, [a[0], a[1], zc], [b[0], b[1], zc], 0.08, 0.1, [0, 0, 1]);
  }
  for (const x of [-0.95, -0.475, 0, 0.475, 0.95]) M.beam(C.frame, [x, P0 + 0.08, 0.085], [x, yi(x) - 0.01, 0.085], 0.045, 0.07, [0, 0, 1]);
  for (const y of [1.55, 2.65, 3.75, 4.85, 5.75]) {
    const xr = y <= YS ? gi : gi * Math.sqrt(Math.max(0, (gTop - y) / (gTop - YS)));
    M.beam(C.frame, [-xr + 0.01, y, 0.085], [xr - 0.01, y, 0.085], 0.045, 0.07, [0, 0, 1]);
  }
}

// ── свод-оболочка зала бассейна 4.2 × 14.0 (подвесной: верх — 0, низ — −2.6; реф. 2): тонкая бетонная оболочка
//    параболического сечения поперёк X, снизу профнастил (гофры вдоль свода), поперечные рёбра через 1.75 м, торцевые
//    рёбра 0.22 (обрамляют арочные окна), три продольных ребра, бортовые балки по низу. Ширина 4.2 = шаг окон зала:
//    соседние оболочки смыкаются пятами над ногами p_san_vault_leg (раскладка ROOMS: центры над окнами через 4.2)
{
  const M = new Model('p_san_vault', { ceil: true });
  const L = 7, NU = 28;
  const Po = (u) => [2.1 * u, -2.6 * u * u];
  const Pi = (u) => [2.0 * u, -0.12 - 2.48 * u * u];
  const Pr = (u) => [1.92 * u, -0.2 - 2.4 * u * u];
  /** Нормаль профиля к залу (вниз-внутрь). */
  const nIn = (P, u) => {
    const e = 1e-4, a = P(u - e), b = P(u + e);
    let n = [b[1] - a[1], -(b[0] - a[0])];
    if (n[1] > 0) n = [-n[0], -n[1]];
    const l = Math.hypot(n[0], n[1]);
    return [n[0] / l, n[1] / l, 0];
  };
  const us = Array.from({ length: NU + 1 }, (_, k) => -1 + (2 * k) / NU);
  const sArc = [0];
  for (let k = 1; k <= NU; k++) {
    const a = Pi(us[k - 1]), b = Pi(us[k]);
    sArc.push(sArc[k - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  for (let k = 0; k < NU; k++) {
    const a = Pi(us[k]), b = Pi(us[k + 1]), na = nIn(Pi, us[k]), nb = nIn(Pi, us[k + 1]);
    const u0 = sArc[k] / 0.6, u1 = sArc[k + 1] / 0.6;
    M.quad(C.profnastil, [a[0], a[1], -L], [b[0], b[1], -L], [b[0], b[1], L], [a[0], a[1], L], null, [na, nb, nb, na], [[u0, -L / 0.6], [u1, -L / 0.6], [u1, L / 0.6], [u0, L / 0.6]]);
    const oa = Po(us[k]), ob = Po(us[k + 1]), ma = mul(nIn(Po, us[k]), -1), mb = mul(nIn(Po, us[k + 1]), -1);
    M.quad(C.concrete, [oa[0], oa[1], -L], [ob[0], ob[1], -L], [ob[0], ob[1], L], [oa[0], oa[1], L], null, [ma, mb, mb, ma]);
  }
  const rib = (z0, z1, endFace) => {
    for (let k = 0; k < NU; k++) {
      const u0 = us[k], u1 = us[k + 1];
      const a = Pr(u0), b = Pr(u1), na = nIn(Pr, u0), nb = nIn(Pr, u1), ia = Pi(u0), ib = Pi(u1);
      M.quad(C.concrete, [a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1], null, [na, nb, nb, na]);
      if (endFace >= 0) M.quad(C.concrete, [ia[0], ia[1], z0], [ib[0], ib[1], z0], [b[0], b[1], z0], [a[0], a[1], z0], [0, 0, -1]);
      if (endFace <= 0) M.quad(C.concrete, [ia[0], ia[1], z1], [ib[0], ib[1], z1], [b[0], b[1], z1], [a[0], a[1], z1], [0, 0, 1]);
      if (endFace) {
        const oa = Po(u0), ob = Po(u1), zf = endFace > 0 ? z1 : z0;
        M.quad(C.concrete, [oa[0], oa[1], zf], [ob[0], ob[1], zf], [b[0], b[1], zf], [a[0], a[1], zf], [0, 0, endFace]);
      }
    }
  };
  rib(-L, -L + 0.22, -1);
  rib(L - 0.22, L, 1);
  for (let k = 1; k < 8; k++) rib(-L + 1.75 * k - 0.05, -L + 1.75 * k + 0.05, 0);
  for (const u of [-0.5, 0, 0.5]) {
    const p = Pi(u), n = nIn(Pi, u), c = [p[0] + n[0] * 0.03, p[1] + n[1] * 0.03];
    M.beam(C.concrete, [c[0], c[1], -L + 0.22], [c[0], c[1], L - 0.22], 0.07, 0.06, n, 'pz nz');
  }
  for (const s of [-1, 1]) M.box(C.concrete, s < 0 ? -2.1 : 1.88, -2.6, -L, s < 0 ? -1.88 : 2.1, -2.42, L);
}

// ── наклонная опора свода 0.6 × 0.6 (выс. 7.0): бетонный столб, внизу узкий (0.26), к пятам свода (4.4) расширяется и
//    чуть наклоняется к стене (+Z); цоколь
{
  const M = new Model('p_san_vault_leg');
  const S = [[0, -0.04, 0.13, 0.13], [4.4, 0.04, 0.3, 0.24], [7.0, 0.05, 0.3, 0.24]]; // y, cz, hx, hz
  const ring = ([y, cz, hx, hz]) => [[-hx, y, cz - hz], [hx, y, cz - hz], [hx, y, cz + hz], [-hx, y, cz + hz]];
  for (let s = 0; s + 1 < S.length; s++) {
    const A = ring(S[s]), B = ring(S[s + 1]);
    const cA = [0, S[s][0], S[s][1]];
    for (let j = 0; j < 4; j++) {
      const j1 = (j + 1) % 4;
      let n = norm(cross(sub(A[j1], A[j]), sub(B[j], A[j])));
      const mid = mul(add(add(A[j], A[j1]), add(B[j], B[j1])), 0.25);
      if (dot(n, sub(mid, add(cA, [0, mid[1] - cA[1], 0]))) < 0) n = mul(n, -1);
      M.quad(C.concrete, A[j], A[j1], B[j1], B[j], n);
    }
  }
  M.box(C.concrete, -0.17, 0, -0.21, 0.17, 0.12, 0.13, 'ny');
}

// ── бассейн-«почка» 12.0 × 7.0 (выс. 0.3, реф. 2): контур — суперэллипс с вмятиной на южной (−Z) стороне; белый
//    кафельный бортик 0.4 со скруглёнными кромками (верх 0.3), внутри — голубой кафель стенок, мозаика дна (0.02) и
//    вода (0.22): сетка бликов с альфа-тестом, сквозь просветы — дно. Вмятина «почки» — с юга (−Z, перед): северный
//    край ровный и касается грани габарита — там встают лесенки (раскладка ROOMS: x центр ∓ 2.1)
{
  const M = new Model('p_san_pool');
  const A = 5.6, BL = 3.1, NE = 4, DENT = 0.95, SD = 1.9, CURB = 0.4;
  const YT = 0.3, YW = 0.22, YB = 0.02, BEV = 0.03;
  const outline = (BH) => {
    const pts = [];
    for (let k = 0; k < 2400; k++) {
      const t = (k / 2400) * 2 * PI, c = Math.cos(t), s = Math.sin(t);
      const x = A * Math.sign(c) * Math.abs(c) ** (2 / NE);
      let z = (s < 0 ? BH : BL) * Math.sign(s) * Math.abs(s) ** (2 / NE);
      if (z < 0) z += DENT * Math.exp(-((x / SD) ** 2)) * (z / BH) ** 2;
      pts.push([x, z]);
    }
    return pts;
  };
  // южная половина: подобрать полуось так, чтобы с вмятиной контур доходил до −3.1 (габарит 7.0 по Z)
  let BH = BL;
  for (let it = 0; it < 10; it++) BH += BL + Math.min(...outline(BH).map((p) => p[1]));
  const dense = outline(BH);
  // равномерно по длине
  const K = 180, cum = [0];
  for (let k = 1; k <= dense.length; k++) {
    const a = dense[k - 1], b = dense[k % dense.length];
    cum.push(cum[k - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = cum[dense.length], P = [];
  for (let k = 0, j = 0; k < K; k++) {
    const s = (k * total) / K;
    while (cum[j + 1] < s) j++;
    const a = dense[j], b = dense[(j + 1) % dense.length], t = (s - cum[j]) / (cum[j + 1] - cum[j] || 1);
    P.push([lerp(a[0], b[0], t), lerp(a[1], b[1], t)]);
  }
  const Nn = P.map((_, k) => {
    const a = P[(k - 1 + K) % K], b = P[(k + 1) % K];
    const tx = b[0] - a[0], tz = b[1] - a[1], l = Math.hypot(tx, tz);
    return [tz / l, -tx / l];
  });
  const S = P.map((_, k) => (k * total) / K);
  // бортик и стенка чаши: профиль поперёк (смещение наружу по нормали, высота)
  const prof = [[0, YB], [0, YT - BEV], [BEV, YT], [CURB - BEV, YT], [CURB, YT - BEV], [CURB, 0]];
  const mats = [C.poolTile, C.tile, C.tile, C.tile, C.tile];
  const at = (k, j) => [P[k][0] + Nn[k][0] * prof[j][0], prof[j][1], P[k][1] + Nn[k][1] * prof[j][0]];
  for (let j = 0; j + 1 < prof.length; j++) {
    const dO = prof[j + 1][0] - prof[j][0], dY = prof[j + 1][1] - prof[j][1];
    const vertical = Math.abs(dO) < 1e-9, tile = vertical ? MAT_TILE.get(mats[j]) : 0;
    for (let k = 0; k < K; k++) {
      const k1 = (k + 1) % K;
      const n = (q) => norm([Nn[q][0] * -dY, dO, Nn[q][1] * -dY]);
      const s0 = S[k], s1 = k1 ? S[k1] : total;
      const uvs = vertical
        ? [[s0 / tile, -prof[j][1] / tile], [s1 / tile, -prof[j][1] / tile], [s1 / tile, -prof[j + 1][1] / tile], [s0 / tile, -prof[j + 1][1] / tile]]
        : undefined;
      M.quad(mats[j], at(k, j), at(k1, j), at(k1, j + 1), at(k, j + 1), null, [n(k), n(k1), n(k1), n(k)], uvs);
    }
  }
  // дно и вода — веером из точки, из которой виден весь контур
  const O = [0, 0.6];
  for (let k = 0; k < K; k++) {
    const a = P[k], b = P[(k + 1) % K];
    M.poly(C.mosaic, [[O[0], YB, O[1]], [a[0], YB, a[1]], [b[0], YB, b[1]]], [0, 1, 0]);
    M.poly(C.water, [[O[0], YW, O[1]], [a[0], YW, a[1]], [b[0], YW, b[1]]], [0, 1, 0]);
  }
}

// ── лесенка бассейна 0.7 × 0.5 (выс. 1.1): два поручня-дуги из нержавейки с фланцами у пола, ступень в воде. Центр
//    лесенки — на середине бортика (0.4), перед (−Z) — к воде: поручни встают с пола за бортиком (z +0.22),
//    перекидываются через него и уходят в воду у внутренней кромки (z −0.24)
{
  const M = new Model('p_san_pool_ladder');
  const R = 0.022;
  for (const x of [-0.3, 0.3]) {
    const rc = 0.23, yc = 1.1 - R - rc, zc = -0.01;
    const pts = [[x, 0.0, 0.22]];
    for (let k = 0; k <= 12; k++) {
      const f = (PI * k) / 12;
      pts.push([x, yc + rc * Math.sin(f), zc + rc * Math.cos(f)]);
    }
    pts.push([x, 0.6, -0.24], [x, 0.03, -0.24]);
    M.tube(C.chrome, pts, R, { seg: 8, caps: 'end' });
    M.lathe(C.chrome, [[0.045, 0], [0.045, 0.01], [0.024, 0.022]], { c: [x, 0, 0.22], seg: 10 });
  }
  M.box(C.chrome, -0.29, 0.1, -0.27, 0.29, 0.12, -0.2);
}

// ── белый пластиковый стул-моноблок 0.55 × 0.55 (выс. 0.8): сиденье со скруглёнными углами, расставленные ножки,
//    спинка из выгнутых полос, подлокотники
{
  const M = new Model('p_san_plastic_chair');
  const SY = 0.42;
  M.prism(C.plastic, 'y', rrect(-0.235, -0.25, 0.235, 0.17, 0.06, 0.06, 3), SY - 0.03, SY, { smooth: 50 });
  for (const s of [-1, 1]) {
    M.tube(C.plastic, [[s * 0.215, SY - 0.02, -0.2], [s * 0.25, 0.008, -0.255]], 0.022, { seg: 8, caps: 'end' });
    M.tube(C.plastic, [[s * 0.215, SY - 0.02, 0.13], [s * 0.25, 0.008, 0.255]], 0.022, { seg: 8, caps: 'end' });
    M.tube(C.plastic, [[s * 0.215, SY - 0.02, 0.13], [s * 0.222, 0.78, 0.2]], 0.019, { seg: 8, caps: 'end' });
    M.tube(C.plastic, [[s * 0.222, 0.66, 0.17], [s * 0.245, 0.64, -0.05], [s * 0.24, 0.6, -0.17], [s * 0.225, SY - 0.01, -0.2]], 0.018, { seg: 6 });
  }
  const back = (u, v) => [lerp(-0.222, 0.222, u), lerp(0.5, 0.788, v), lerp(0.16, 0.205, v) - 0.035 * (2 * u - 1) ** 2];
  for (const [v0, v1] of [[0, 0.17], [0.27, 0.45], [0.55, 0.73], [0.82, 1]]) {
    M.surface(C.plastic, 8, 2, (u, v) => back(u, lerp(v0, v1, v)), [0, 0.2, -1]);
  }
  const rim = [];
  for (let k = 0; k <= 10; k++) rim.push(back(k / 10, 1));
  M.tube(C.plastic, rim, 0.012, { seg: 6 });
}

// ── батарея чугунная МС-140 1.0 × 0.12 (0.1…0.6): 11 секций, ниппели, подводка в стену, кронштейны
{
  const M = new Model('p_san_radiator');
  const n = 11, pitch = 0.088;
  for (let k = 0; k < n; k++) {
    const x = (k - (n - 1) / 2) * pitch;
    M.box(C.castIron, x - 0.036, 0.1, -0.06, x + 0.036, 0.6, -0.015, 'ny');
    M.box(C.castIron, x - 0.036, 0.1, -0.005, x + 0.036, 0.6, 0.04, 'ny pz');
  }
  for (const y of [0.14, 0.56]) M.tube(C.castIron, [[-0.47, y, -0.01], [0.47, y, -0.01]], 0.022, { seg: 8, caps: true });
  for (const y of [0.14, 0.56]) M.tube(C.castIron, [[0.47, y, -0.01], [0.488, y, -0.01], [0.488, y, 0.06]], 0.012, { seg: 6 });
  for (const x of [-0.3, 0.3]) M.box(C.castIron, x - 0.01, 0.3, 0.04, x + 0.01, 0.34, 0.06, 'pz');
}

// ═════════════════════════ запись и сверка ═════════════════════════

/** План w × d (м) и верх модели над полом, м (у подвесных — насколько спускается от потолка). */
const EXPECT = {
  p_san_runner: [1.2, 3.0, 0.01],
  p_san_window_curtain: [1.8, 0.25, 2.9],
  p_san_window_low: [1.8, 0.25, 2.45],
  p_san_bench: [1.6, 0.5, 0.75],
  p_san_ficus: [0.6, 0.6, 1.9],
  p_san_palm: [0.7, 0.7, 1.7],
  p_san_ceiling_lamp: [0.5, 0.5, 0.12],
  p_san_chandelier: [1.2, 1.2, 0.9],
  p_san_reception: [3.0, 0.8, 1.1],
  p_san_sofa: [2.0, 0.8, 0.85],
  p_san_noticeboard: [1.2, 0.05, 1.9],
  p_san_clock: [0.4, 0.06, 2.4],
  p_san_glass_screen: [0.9, 0.12, 3.3],
  p_san_arch_window: [3.0, 0.3, 6.6],
  p_san_vault: [4.2, 14.0, 2.6],
  p_san_vault_leg: [0.6, 0.6, 7.0],
  p_san_pool: [12.0, 7.0, 0.3],
  p_san_pool_ladder: [0.7, 0.5, 1.1],
  p_san_plastic_chair: [0.55, 0.55, 0.8],
  p_san_radiator: [1.0, 0.12, 0.6],
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
  const stats = { verts: 0, tris: 0, mats: new Set() };
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
    if (MAT_TILE.get(m)) prim.setAttribute('TEXCOORD_0', acc('VEC2', new Float32Array(g.uv)));
    mesh.addPrimitive(prim);
    stats.verts += g.p.length / 3;
    stats.tris += g.i.length / 3;
    stats.mats.add(m.getName());
  }
  M.stats = stats;
  scene.addChild(doc.createNode(M.id).setMesh(mesh).setExtras({ ceil: M.ceil, ...M.extras }));
}

await doc.transform(
  weld(),
  dedup(),
  prune({ keepAttributes: true, keepLeaves: true, keepExtras: true }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 88 }),
  // позиции — int16, нормали — int8 (KHR_mesh_quantization: загрузчик Babylon подключён в propModels.ts); UV вне 0…1
  // остаются float
  quantize({ quantizeNormal: 8 }),
);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await io.write(out, doc);

// сверка по записанному файлу: узлы и габариты (с трансформами квантования)
const back = await io.read(out);
const nodes = back.getRoot().listScenes()[0].listChildren();
const seen = new Set();
console.log('узел                      план w × d (ожид.)          X: от … до       Y: от … до       Z: от … до      верш.  тр.  мат.');
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
    // свес за план допускается немного (ламбрекен, рама, кромка) — до 0.12 м
    if (w > e[0] + 0.12 || d > e[1] + 0.12) warn += ' ! шире плана';
    if (w < e[0] - 0.2 || d < e[1] - 0.2) warn += ' ! уже плана';
    if (Math.abs(h - e[2]) > 0.03) warn += ` ! верх ${h.toFixed(3)} ≠ ${e[2]}`;
    if (M.ceil && Math.abs(b.max[1]) > 0.002) warn += ' ! подвесной: верх не в 0';
    if (!M.ceil && b.min[1] < -0.002) warn += ' ! ниже пола';
    if (Math.abs((b.min[0] + b.max[0]) / 2) > 0.06) warn += ' ! не по центру X';
  }
  if (warn) problems++;
  console.log(
    `${id.padEnd(22)} ${(e ? `${w.toFixed(2)} × ${d.toFixed(2)} (${e[0]} × ${e[1]})` : '').padEnd(27)} ${f(0)}  ${f(1)}  ${f(2)}  ${String(M.stats.verts).padStart(5)} ${String(M.stats.tris).padStart(5)} ${String(M.stats.mats.size).padStart(3)}${warn}`,
  );
}
for (const id of Object.keys(EXPECT)) if (!seen.has(id)) (problems++, console.log(`  ! нет узла ${id}`));
const glow = back.getRoot().listMaterials().filter((m) => m.getEmissiveFactor().some((v) => v > 0.01)).map((m) => m.getName());
const total = MODELS.reduce((s, M) => s + M.stats.verts, 0);
console.log(`→ ${out}: ${(statSync(out).size / 1024).toFixed(0)} КБ, предметов ${nodes.length}, вершин ${total}, материалов ${back.getRoot().listMaterials().length}, текстур ${back.getRoot().listTextures().length}`);
console.log(`  светятся: ${glow.join(', ')}`);
if (problems) {
  console.log(`  замечаний: ${problems}`);
  process.exitCode = 1;
}
