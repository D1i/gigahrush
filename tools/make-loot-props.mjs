// Лут «советский быт» (набор заказчика soviet_loot_lowpoly, каталог — src/data/itemsLoot.ts) —
// src/view3d/assets/loot_props.glb:
//
//  • Узел на предмет, имя узла = p_loot_<id предмета без «it_»> (src/view3d/lootAssets.ts lootPropId). 20 моделей
//    набора (tmp/loot_zip/soviet_loot_lowpoly/models/*.glb — только ЧИТАЮТСЯ: метры, Y вверх, низ — y = 0, надписи
//    смотрят на +Z) и две свои: p_loot_tube_ext — узлы «extension module» + «extension coupling» П-2, вынутые из фонаря
//    (p_loot_flashlight — без них, хвост закрыт этой же муфтой-кольцом и крышкой), p_loot_bulb — лампочка МН 2,5 В из
//    примитивов (колба ⌀22 мм, цоколь E10, высота 44 мм). Масштаб — настоящий (метры набора).
//  • Оси — как у болванки мебели (src/blockout/babylon.ts): перед — −Z (надписи, стекло П-2 и «Жучка» смотрят на −Z),
//    низ — y = 0, центр габарита на плане — в начале координат. Набор смотрит надписями на +Z, поэтому модели
//    повёрнуты на 180° вокруг Y — поворот, не зеркало: надписи читаются. Копейка и наклейка лежат лицом вверх (верх
//    надписи — к +Z: читается от игрока, стоящего на −Z). П-2 повёрнут вокруг своей оси на 180°: кнопка — сверху (в
//    наборе была снизу); его клеймо «П-2» (в наборе спрятано внутри корпуса) — новой выгнутой наклейкой на правом боку.
//  • Запись — в системе glTF; загрузчик Babylon переводит в левую систему (x → −x), и модель выглядит так же, как в
//    любом просмотрщике glTF. Координаты в таблице и ANCHORS — уже Babylon (локальные координаты шаблона PropModels).
//  • Материалы — свои loot_* (PropModels кладёт цвет PBR в StandardMaterial как есть, поэтому цвета набора переведены
//    из линейных в sRGB, металл — 0, ничего не светится: нить радиолампы — просто оранжевая). Надписи — WebP (длинная
//    сторона наклейки ≥ 4 см — 256 × 128, мельче — 128 × 64), clamp. Стекло — loot_glass_* (alphaMode BLEND, альфа — в
//    baseColor): PropModels альфу не переносит — её ставит applyLootGlass (lootAssets.ts) после загрузки.
//  • Нормали сглажены по углу 35° внутри материала (кольца, ободки, моток фитиля, колбы — weld затем сливает вершины);
//    коробки и 8-гранные бутылки остаются гранёными, как в наборе. Позиции — int16, нормали — int8
//    (KHR_mesh_quantization: загрузчик подключён в propModels.ts).
//  • Сверка по записанному файлу: узлы, габариты против EXPECT, точки света/крепления (ANCHORS — те же числа, что
//    LOOT_ANCHORS в lootAssets.ts), файл ≤ 450 КБ (сборка вшивает ассеты в одну HTML-страницу).
//
//   node tools/make-loot-props.mjs        → потом иконки: node tools/make-loot-icons.mjs, превью: node tools/loot-preview-shots.mjs
import { Document, NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { dedup, prune, quantize, weld } from '@gltf-transform/functions';
import sharp from 'sharp';
import { mkdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../src/view3d/assets/loot_props.glb', import.meta.url));
const KIT = fileURLToPath(new URL('../tmp/loot_zip/soviet_loot_lowpoly/models/', import.meta.url));
mkdirSync(fileURLToPath(new URL('../src/view3d/assets/', import.meta.url)), { recursive: true });
/** предел размера файла, байт */
const BUDGET = 450 * 1024;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = new Document();
doc.createExtension(EXTTextureWebP).setRequired(true);
const buffer = doc.createBuffer();
const scene = doc.createScene('loot');
// сцена по умолчанию: без неё загрузчик Babylon сцену не берёт (узлов нет)
doc.getRoot().setDefaultScene(scene);

// ───────── векторы ─────────
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const PI = Math.PI;
const DEG = PI / 180;
/** Точка через матрицу glTF (4 × 4 по столбцам). */
const xfPoint = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];
const xfDir = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2], m[1] * p[0] + m[5] * p[1] + m[9] * p[2], m[2] * p[0] + m[6] * p[1] + m[10] * p[2]];

// ───────── позы: набор (glTF) → наш glTF. Только повороты (det = +1) — без зеркала надписи читаются ─────────
/** перед набора (+Z) → −Z игры: поворот на 180° вокруг Y */
const FRONT = (p) => [-p[0], p[1], -p[2]];
/** лицом вверх: +Z набора → +Y, верх надписи (+Y) → +Z игры (от игрока, стоящего на −Z) */
const FLAT = (p) => [-p[0], p[2], p[1]];
/** П-2: ось фонаря — вдоль Z на высоте P2_AXIS; поворот вокруг неё на 180° (кнопка снизу → сверху), затем FRONT */
const P2_AXIS = 0.048;
const P2 = (p) => FRONT([-p[0], 2 * P2_AXIS - p[1], p[2]]);
/** то же для направлений (нормалей) — без переноса */
const dirOf = (pose) => (n) => sub(pose(n), pose([0, 0, 0]));

// ───────── материалы ─────────
const lin2srgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const r4 = (v) => +v.toFixed(4);
/** Наши материалы по имени (общие для всех предметов: «Worn steel» набора — один loot_worn_steel). */
const MATS = new Map();
/** Стекло: альфа (та же таблица — LOOT_GLASS в lootAssets.ts). */
const GLASS = {
  'Smoked glass': ['loot_glass_smoked', 0.3],
  'Bottle green glass': ['loot_glass_green', 0.72],
  'Amber glass': ['loot_glass_amber', 0.8],
};
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
/** Простой материал: цвет sRGB 0…1, без металла. */
function plain(name, rgb, o = {}) {
  let m = MATS.get(name);
  if (m) return m;
  m = doc.createMaterial(name).setBaseColorFactor([...rgb.map(r4), o.alpha ?? 1]).setMetallicFactor(0).setRoughnessFactor(o.rough ?? 0.75);
  if (o.alpha !== undefined) m.setAlphaMode('BLEND').setDoubleSided(true);
  MATS.set(name, m);
  return m;
}
/** Наклейки: картинка набора → WebP; размер — по длинной стороне наклейки (м). */
async function labelMat(name, src, sideM) {
  const t = src.getBaseColorTexture();
  const [w, h] = sideM >= 0.04 ? [256, 128] : [128, 64];
  const webp = await sharp(Buffer.from(t.getImage())).resize(w, h, { fit: 'fill', kernel: 'lanczos3' }).webp({ quality: 88, smartSubsample: true }).toBuffer();
  const tex = doc.createTexture(name).setImage(webp).setMimeType('image/webp');
  const m = doc.createMaterial(name).setBaseColorFactor([1, 1, 1, 1]).setBaseColorTexture(tex).setMetallicFactor(0).setRoughnessFactor(0.8);
  // clamp: без подтёков с противоположного края на мипах
  m.getBaseColorTextureInfo().setWrapS(33071).setWrapT(33071);
  MATS.set(name, m);
  TEX_SIZE.set(name, [w, h, webp.byteLength]);
  return m;
}
const TEX_SIZE = new Map();
/** Материал набора → наш (наклейки — отдельно, labelMat). */
function kitMat(src) {
  const sn = src.getName();
  const f = src.getBaseColorFactor();
  const rgb = f.slice(0, 3).map(lin2srgb);
  if (GLASS[sn]) return plain(GLASS[sn][0], rgb, { alpha: GLASS[sn][1], rough: 0.2 });
  if (src.getAlphaMode() !== 'OPAQUE') throw new Error(`неизвестное стекло ${sn}`);
  return plain(`loot_${slug(sn)}`, rgb, { rough: src.getRoughnessFactor() });
}

// ───────── чтение набора ─────────
/** Треугольники файла набора по узлам: [{ node, src: материал набора, tris: [{ p: [3], n: [3], uv: [3] | null }] }]. */
async function readKit(file) {
  const d = await io.read(`${KIT}${file}.glb`);
  const parts = [];
  for (const node of d.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const W = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const P = prim.getAttribute('POSITION'), N = prim.getAttribute('NORMAL'), UV = prim.getAttribute('TEXCOORD_0'), idx = prim.getIndices();
      const count = idx ? idx.getCount() : P.getCount();
      const tris = [];
      for (let k = 0; k + 2 < count; k += 3) {
        const t = { p: [], n: [], uv: UV ? [] : null };
        for (let j = 0; j < 3; j++) {
          const i = idx ? idx.getScalar(k + j) : k + j;
          t.p.push(xfPoint(W, P.getElement(i, [0, 0, 0])));
          t.n.push(N ? norm(xfDir(W, N.getElement(i, [0, 0, 0]))) : null);
          if (UV) t.uv.push(UV.getElement(i, [0, 0]));
        }
        tris.push(t);
      }
      parts.push({ node: node.getName(), src: prim.getMaterial(), tris });
    }
  }
  return parts;
}

// ───────── модель предмета ─────────
/** Предмет: треугольники по материалам (в нашем glTF), после — центровка, сглаживание, запись. */
class Model {
  constructor(id) {
    this.id = id;
    /** материал → [{ p: [3], n: [3] | null, uv: [3] | null }] */
    this.parts = new Map();
    this.anchors = {};
  }
  tri(m, p, n, uv) {
    let a = this.parts.get(m);
    if (!a) this.parts.set(m, (a = []));
    a.push({ p, n, uv });
  }
  /** Габарит по всем треугольникам. */
  bounds() {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const a of this.parts.values()) for (const t of a) for (const p of t.p) for (let k = 0; k < 3; k++) (lo[k] = Math.min(lo[k], p[k])), (hi[k] = Math.max(hi[k], p[k]));
    return { lo, hi };
  }
  /** Центр габарита на плане — в начало, низ — в y = 0; сдвиг запоминается (точки ANCHORS двигаются с ним). */
  center() {
    const { lo, hi } = this.bounds();
    const d = [-(lo[0] + hi[0]) / 2, -lo[1], -(lo[2] + hi[2]) / 2];
    for (const a of this.parts.values()) for (const t of a) t.p = t.p.map((p) => add(p, d));
    for (const k of Object.keys(this.anchors)) if (this.anchors[k].length === 3 && !k.endsWith('Dir')) this.anchors[k] = add(this.anchors[k], d);
    this.shift = d;
    return d;
  }
}
const MODELS = [];

/** Обход по нормалям вершин (лицевая сторона — куда смотрят нормали набора); вырожденный — null. */
function orient(t) {
  const gn = cross(sub(t.p[1], t.p[0]), sub(t.p[2], t.p[0]));
  const area = len(gn);
  if (area < 1e-14) return null;
  const sn = t.n[0] ? add(add(t.n[0], t.n[1]), t.n[2]) : gn;
  if (dot(gn, sn) < 0) return { p: [t.p[0], t.p[2], t.p[1]], n: t.n && [t.n[0], t.n[2], t.n[1]], uv: t.uv && [t.uv[0], t.uv[2], t.uv[1]], fn: mul(gn, -1 / area), area };
  return { ...t, fn: mul(gn, 1 / area), area };
}

/** Сглаживание по углу: у вершин в одной точке с гранями того же материала, отличающимися меньше чем на deg, —
 *  общая нормаль (взвешенная площадью). */
function autoSmooth(tris, deg = 35) {
  const key = (p) => p.map((v) => Math.round(v * 2e5)).join(',');
  const at = new Map();
  tris.forEach((t, ti) =>
    t.p.forEach((p) => {
      const k = key(p);
      if (!at.has(k)) at.set(k, []);
      at.get(k).push(ti);
    }),
  );
  const lim = Math.cos(deg * DEG);
  return tris.map((t) => ({
    ...t,
    n: t.p.map((p) => {
      let s = [0, 0, 0];
      for (const o of at.get(key(p))) if (dot(tris[o].fn, t.fn) > lim) s = add(s, mul(tris[o].fn, tris[o].area));
      return norm(s);
    }),
  }));
}

/** Модель из файла набора: pose — поза, keep(node) — какие узлы брать, labels — сторона наклейки (м) для WebP. */
async function fromKit(id, file, o = {}) {
  const M = new Model(id);
  const pose = o.pose ?? FRONT;
  const pd = dirOf(pose);
  const parts = await readKit(file);
  for (const part of parts) {
    if (o.keep && !o.keep(part.node)) continue;
    let m;
    if (part.src.getBaseColorTexture()) {
      // наклейка: своя картинка; имя — по предмету (у карт их три)
      const k = [...MATS.keys()].filter((n) => n.startsWith(`loot_label_${id}`)).length;
      const name = `loot_label_${id}${k ? `_${k}` : ''}`;
      const ps = part.tris.flatMap((t) => t.p);
      const ext = [0, 1, 2].map((a) => Math.max(...ps.map((p) => p[a])) - Math.min(...ps.map((p) => p[a])));
      m = await labelMat(name, part.src, Math.max(...ext));
    } else m = kitMat(part.src);
    for (const t of part.tris) M.tri(m, t.p.map(pose), t.n.map((n) => n && norm(pd(n))), t.uv);
  }
  o.edit?.(M, parts, pose);
  MODELS.push(M);
  return M;
}

// ───────── примитивы (лампочка, крышка П-2, клеймо) ─────────
/** Тело вращения вокруг вертикали через c: профиль [[r, y], …] снизу вверх, seg сторон. */
function lathe(M, m, prof, seg, c = [0, 0, 0], axis = 'y') {
  const P = (r, y, a) => {
    const v = axis === 'y' ? [r * Math.cos(a), y, r * Math.sin(a)] : [r * Math.cos(a), r * Math.sin(a), y];
    return add(v, c);
  };
  for (let k = 0; k + 1 < prof.length; k++) {
    const [r0, y0] = prof[k], [r1, y1] = prof[k + 1];
    for (let s = 0; s < seg; s++) {
      const a0 = (s / seg) * 2 * PI, a1 = ((s + 1) / seg) * 2 * PI;
      const q = [P(r0, y0, a0), P(r0, y0, a1), P(r1, y1, a1), P(r1, y1, a0)];
      // нормаль наружу: от оси (у вырожденного конца — по образующей)
      const am = (a0 + a1) / 2;
      const dy = y1 - y0, dr = r1 - r0;
      const n = norm(axis === 'y' ? [dy * Math.cos(am), -dr, dy * Math.sin(am)] : [dy * Math.cos(am), dy * Math.sin(am), -dr]);
      // у полюса (r = 0) один из треугольников вырожден — orient() его выбросит
      M.tri(m, [q[0], q[2], q[1]], [n, n, n], null);
      M.tri(m, [q[0], q[3], q[2]], [n, n, n], null);
    }
  }
}
/** Гладкая трубка радиуса r по ломаной (кольца в точках, касательная — средняя; без торцов), seg сторон. Для плоских
 *  линий (моток фитиля лежит) рамка от вертикали — без перекрута. */
function sweep(M, m, pts, r, seg = 6, phase = 0) {
  const n = pts.length;
  const rings = pts.map((p, k) => {
    const T = norm(sub(pts[Math.min(n - 1, k + 1)], pts[Math.max(0, k - 1)]));
    const u = norm(cross(T, Math.abs(T[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
    const v = cross(T, u);
    return Array.from({ length: seg }, (_, s) => {
      const a = (s / seg) * 2 * PI + phase;
      const d = add(mul(u, Math.cos(a)), mul(v, Math.sin(a)));
      return { p: add(p, mul(d, r)), d };
    });
  });
  for (let k = 0; k + 1 < n; k++)
    for (let s = 0; s < seg; s++) {
      const A = rings[k][s], B = rings[k][(s + 1) % seg], C = rings[k + 1][(s + 1) % seg], D = rings[k + 1][s];
      M.tri(m, [A.p, B.p, C.p], [A.d, B.d, C.d], null);
      M.tri(m, [A.p, C.p, D.p], [A.d, C.d, D.d], null);
    }
}
/** Трубка радиуса r по ломаной (без торцов), seg сторон. */
function tube(M, m, pts, r, seg = 4) {
  for (let k = 0; k + 1 < pts.length; k++) {
    const a = pts[k], b = pts[k + 1];
    const T = norm(sub(b, a));
    const u = norm(cross(T, Math.abs(T[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
    const v = cross(T, u);
    for (let s = 0; s < seg; s++) {
      const q0 = (s / seg) * 2 * PI, q1 = ((s + 1) / seg) * 2 * PI;
      const d0 = add(mul(u, Math.cos(q0)), mul(v, Math.sin(q0))), d1 = add(mul(u, Math.cos(q1)), mul(v, Math.sin(q1)));
      const A = add(a, mul(d0, r)), B = add(a, mul(d1, r)), C = add(b, mul(d1, r)), D = add(b, mul(d0, r));
      M.tri(m, [A, B, C], [d0, d1, d1], null);
      M.tri(m, [A, C, D], [d0, d1, d0], null);
    }
  }
}

// ───────── предметы ─────────
await fromKit('kopeyki', '01_kopeck', { pose: FLAT });
await fromKit('radiolamp', '02_radiolamp');
await fromKit('cards', '03_cards');
await fromKit('wick', '04_wick_rope', {
  keep: (n) => n !== 'coiled wick',
  // моток: 240 звеньев шестигранной трубки (2880 тр. на 11 см верёвки) → ось по центрам звеньев, каждое 4-е звено,
  // та же шестигранная трубка того же радиуса (≈ 720 тр.); концы — продлены на ползвена (как у набора)
  edit(M, parts, pose) {
    const coil = parts.find((p) => p.node === 'coiled wick');
    const mids = [];
    for (let k = 0; k + 11 < coil.tris.length; k += 12) {
      const ps = coil.tris.slice(k, k + 12).flatMap((t) => t.p);
      mids.push(mul(ps.reduce(add, [0, 0, 0]), 1 / ps.length));
    }
    let r = 0;
    mids.forEach((c, k) => {
      const T = norm(sub(mids[Math.min(mids.length - 1, k + 1)], mids[Math.max(0, k - 1)]));
      for (const t of coil.tris.slice(k * 12, k * 12 + 12))
        for (const p of t.p) {
          const d = sub(p, c);
          r = Math.max(r, len(sub(d, mul(T, dot(d, T)))));
        }
    });
    const n = mids.length;
    const pts = [sub(mids[0], mul(sub(mids[1], mids[0]), 0.5))];
    for (let k = 0; k < n; k += 4) pts.push(mids[k]);
    if ((n - 1) % 4) pts.push(mids[n - 1]);
    pts.push(add(mids[n - 1], mul(sub(mids[n - 1], mids[n - 2]), 0.5)));
    sweep(M, kitMat(coil.src), pts.map(pose), r, 6, 0);
    M.coil = { links: n, r };
  },
});
await fromKit('kerosene', '05_kerosene');
await fromKit('sticker', '06_sticker', {
  pose: FLAT,
  // отогнутый уголок — один треугольник: двусторонним (копия с обратным обходом)
  edit(M) {
    for (const [m, a] of M.parts) {
      if (m.getName() !== 'loot_aged_paper') continue;
      const extra = [];
      for (const t of a) {
        const ys = t.p.map((p) => p[1]);
        // уголок торчит над бумагой (y > толщины подложки)
        if (Math.max(...ys) - Math.min(...ys) > 0.002 && a.length < 20) extra.push({ p: [t.p[0], t.p[2], t.p[1]], n: t.n.map((n) => n && mul(n, -1)), uv: null });
      }
      a.push(...extra);
    }
  },
});
await fromKit('matches', '07_matches');
await fromKit('hunt_matches', '08_hunting_matches');
await fromKit('backpack', '09_backpack');
await fromKit('briefcase', '10_briefcase');
await fromKit('sack', '11_sack');
await fromKit('bread', '12_bread');

// П-2: удлинение тубуса — отдельный предмет; хвост фонаря — та же муфта и крышка; клеймо — на правый бок
const EXT_NODES = new Set(['extension module', 'extension coupling']);
const p2 = await fromKit('flashlight', '13_flashlight_p2', {
  pose: P2,
  keep: (n) => !EXT_NODES.has(n) && n !== 'P2 stamp',
  async edit(M, parts, pose) {
    const pd = dirOf(pose);
    const steel = MATS.get('loot_worn_steel'), dark = MATS.get('loot_dark_oxidized_steel');
    // хвост корпуса: муфта набора (кольцо) + крышка-диск (у корпуса торец открыт)
    const coup = parts.find((p) => p.node === 'extension coupling');
    for (const t of coup.tris) M.tri(steel, t.p.map(pose), t.n.map((n) => n && norm(pd(n))), null);
    const zs = coup.tris.flatMap((t) => t.p.map((p) => p[2]));
    const zTail = Math.min(...zs);
    const rc = Math.max(...coup.tris.flatMap((t) => t.p.map((p) => Math.hypot(p[0], p[1] - P2_AXIS))));
    // крышка: диск чуть меньше муфты, смотрит назад (−Z набора)
    const capR = rc - 0.002, seg = 24;
    for (let s = 0; s < seg; s++) {
      const a0 = (s / seg) * 2 * PI, a1 = ((s + 1) / seg) * 2 * PI;
      const C = [0, P2_AXIS, zTail - 0.0004];
      const A = [capR * Math.cos(a0), P2_AXIS + capR * Math.sin(a0), zTail - 0.0004];
      const B = [capR * Math.cos(a1), P2_AXIS + capR * Math.sin(a1), zTail - 0.0004];
      const n = norm(pd([0, 0, -1]));
      M.tri(dark, [C, A, B].map(pose), [n, n, n], null);
    }
    // клеймо «П-2»: выгнутая наклейка на правом боку (+X игры), текст вдоль оси, верх — вверх; между кольцами корпуса
    const src = parts.find((p) => p.node === 'P2 stamp').src;
    const lab = await labelMat('loot_label_flashlight', src, 0.027);
    const barrel = parts.find((p) => p.node === 'battery barrel');
    const zc = -0.012, half = 0.0135, hh = 0.0075;
    // радиус корпуса: у токарного профиля вершины только на изломах — берутся все вершины цилиндрической части
    let rb = 0;
    for (const t of barrel.tris) for (const p of t.p) if (p[2] > -0.082 && p[2] < 0.063) rb = Math.max(rb, Math.hypot(p[0], p[1] - P2_AXIS));
    const R = rb + 0.0004, n = 4;
    M.anchors.p2BodyR = [rb];
    // строится сразу в нашем glTF (поза П-2 переворачивает y вокруг оси — текст встал бы вверх ногами): правый бок
    // игры (+X после загрузки) — x < 0 здесь; верх текста — вверх (+Y); вправо читающему сбоку — к хвосту (+Z)
    const zcG = pose([0, P2_AXIS, zc])[2];
    const ang = (v) => (0.5 - v) * ((2 * hh) / R); // v = 0 — верх наклейки
    const pt = (u, v) => [-R * Math.cos(ang(v)), P2_AXIS + R * Math.sin(ang(v)), zcG - half + 2 * half * u];
    const nn = (v) => [-Math.cos(ang(v)), Math.sin(ang(v)), 0];
    for (let k = 0; k < n; k++) {
      const v0 = k / n, v1 = (k + 1) / n;
      const q = [pt(0, v0), pt(1, v0), pt(1, v1), pt(0, v1)];
      const qn = [nn(v0), nn(v0), nn(v1), nn(v1)];
      const qu = [[0, v0], [1, v0], [1, v1], [0, v1]];
      M.tri(lab, [q[0], q[1], q[2]], [qn[0], qn[1], qn[2]], [qu[0], qu[1], qu[2]]);
      M.tri(lab, [q[0], q[2], q[3]], [qn[0], qn[2], qn[3]], [qu[0], qu[2], qu[3]]);
    }
    // точки: стекло (центр, наружу), лампочка внутри отражателя, куда встаёт удлинение
    const lens = parts.find((p) => p.node === 'lens');
    const lz = Math.max(...lens.tris.flatMap((t) => t.p.map((p) => p[2])));
    const bulb = parts.find((p) => p.node === 'bulb');
    const bz = bulb.tris.flatMap((t) => t.p.map((p) => p[2]));
    M.anchors.lens = pose([0, P2_AXIS, lz]);
    M.anchors.lensDir = pd([0, 0, 1]);
    M.anchors.bulb = pose([0, P2_AXIS, (Math.min(...bz) + Math.max(...bz)) / 2]);
    // удлинение: его низ-центр (как у p_loot_tube_ext после центровки) — в координатах фонаря
    const mod = parts.filter((p) => EXT_NODES.has(p.node)).flatMap((p) => p.tris.flatMap((t) => t.p.map(pose)));
    const lo = [0, 1, 2].map((a) => Math.min(...mod.map((p) => p[a]))), hi = [0, 1, 2].map((a) => Math.max(...mod.map((p) => p[a])));
    M.anchors.tubeExt = [(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2];
  },
});
await fromKit('tube_ext', '13_flashlight_p2', { pose: P2, keep: (n) => EXT_NODES.has(n) });

// лампочка МН 2,5 В (своя): цоколь E10 с резьбой, изолятор, контакт; колба ⌀22 мм с носиком; нить на держателях
{
  const M = new Model('bulb');
  const mm = (v) => v / 1000;
  const brass = MATS.get('loot_brass_exposed_edges');
  const steel = MATS.get('loot_worn_steel');
  const bake = MATS.get('loot_black_bakelite');
  const dark = MATS.get('loot_dark_oxidized_steel');
  const glass = plain('loot_glass_clear', [1, 1, 0.97], { alpha: 0.35, rough: 0.15 });
  const P = (a) => a.map(([r, y]) => [mm(r), mm(y)]);
  lathe(M, steel, P([[0, 0], [1.8, 0], [2.2, 0.8], [2.2, 2]]), 10);
  lathe(M, bake, P([[2.2, 2], [3.7, 2.2], [3.9, 3.4]]), 12);
  // резьба: зубцы 1.8 мм
  const thread = [[3.9, 3.4], [4.9, 3.6]];
  for (let y = 4.5; y < 13.5; y += 1.8) thread.push([5.3, y], [4.8, y + 0.9]);
  thread.push([5.4, 14.2], [5.4, 15.4], [3.6, 16]);
  lathe(M, brass, P(thread), 12);
  // колба: шейка в цоколе → сфера R 11, центр 31.5 → носик
  const R = 11, yc = 31.5;
  const glassProf = [[3.4, 15.2], [3.8, 18.5], [5.5, yc - Math.sqrt(R * R - 5.5 * 5.5)]];
  for (let f = -45; f < 90; f += 22.5) glassProf.push([R * Math.cos(f * DEG), yc + R * Math.sin(f * DEG)]);
  glassProf.push([1.2, yc + Math.sqrt(R * R - 1.2 * 1.2)], [0.7, 43.4], [0, 44]);
  lathe(M, glass, P(glassProf), 12);
  // держатели и нить (спиралька зигзагом)
  for (const s of [-1, 1]) tube(M, dark, [[mm(s * 1.2), mm(15.5), 0], [mm(s * 1.6), mm(24), 0], [mm(s * 2.6), mm(30.5), 0]], mm(0.3), 4);
  const coil = [];
  for (let k = 0; k <= 8; k++) coil.push([mm(-2.6 + (5.2 * k) / 8), mm(30.5 + (k % 2 ? 0.7 : 0)), mm(k % 2 ? 0.5 : -0.5)]);
  tube(M, dark, coil, mm(0.25), 4);
  M.anchors.filament = [0, mm(30.8), 0];
  MODELS.push(M);
}

await fromKit('bug_flash', '14_dynamo_flashlight', {
  edit(M, parts, pose) {
    const lens = parts.find((p) => p.node === 'lens').tris.flatMap((t) => t.p);
    const c = [0, 1, 2].map((a) => (Math.min(...lens.map((p) => p[a])) + Math.max(...lens.map((p) => p[a]))) / 2);
    c[2] = Math.max(...lens.map((p) => p[2]));
    M.anchors.lens = pose(c);
    M.anchors.lensDir = dirOf(pose)([0, 0, 1]);
  },
});
await fromKit('batteries', '15_battery_d');
await fromKit('zippo', '16_zill_lighter', {
  edit(M, parts, pose) {
    const w = parts.find((p) => p.node === 'wick').tris.flatMap((t) => t.p);
    const top = Math.max(...w.map((p) => p[1]));
    const cx = (Math.min(...w.map((p) => p[0])) + Math.max(...w.map((p) => p[0]))) / 2;
    const cz = (Math.min(...w.map((p) => p[2])) + Math.max(...w.map((p) => p[2]))) / 2;
    M.anchors.wickTop = pose([cx, top, cz]);
    // пламя зиппы ~2 см: центр — на 1 см выше фитиля
    M.anchors.flame = pose([cx, top + 0.01, cz]);
  },
});
await fromKit('kerolamp', '17_kerosene_lantern', {
  edit(M, parts, pose) {
    const w = parts.find((p) => p.node === 'wick').tris.flatMap((t) => t.p);
    const top = Math.max(...w.map((p) => p[1]));
    M.anchors.wickTop = pose([0, top, 0]);
    // язычок пламени ~2.5 см в стекле: центр — на 1.2 см выше фитиля
    M.anchors.flame = pose([0, top + 0.012, 0]);
  },
});
await fromKit('preserves', '18_preserves');
await fromKit('bubble', '19_bubble');
await fromKit('yuzgram', '20_yuzgram');

// ───────── сверка: ожидаемые габариты (Babylon: w — X, h — Y, d — Z; м) и точки ─────────
const EXPECT = {
  p_loot_kopeyki: [0.0243, 0.0025, 0.0243],
  p_loot_radiolamp: [0.036, 0.082, 0.036],
  p_loot_cards: [0.0888, 0.1446, 0.019],
  p_loot_wick: [0.1128, 0.0126, 0.07],
  p_loot_kerosene: [0.135, 0.2415, 0.0804],
  p_loot_sticker: [0.068, 0.0052, 0.06],
  p_loot_matches: [0.077, 0.0545, 0.0202],
  p_loot_hunt_matches: [0.089, 0.09, 0.0202],
  p_loot_backpack: [0.32, 0.4607, 0.307],
  p_loot_briefcase: [0.38, 0.3249, 0.1106],
  p_loot_sack: [0.306, 0.4, 0.306],
  p_loot_bread: [0.301, 0.101, 0.172],
  p_loot_flashlight: [0.096, 0.096, 0.2136],
  p_loot_tube_ext: [0.058, 0.058, 0.0367],
  p_loot_bulb: [0.022, 0.044, 0.022],
  p_loot_bug_flash: [0.0896, 0.0885, 0.0604],
  p_loot_batteries: [0.0344, 0.0635, 0.0344],
  p_loot_zippo: [0.062, 0.082, 0.014],
  p_loot_kerolamp: [0.1876, 0.4136, 0.152],
  p_loot_preserves: [0.116, 0.1695, 0.1164],
  p_loot_bubble: [0.074, 0.1946, 0.0742],
  p_loot_yuzgram: [0.046, 0.1031, 0.0464],
};
/** Точки (Babylon, локальные координаты шаблона, м) — те же, что LOOT_ANCHORS в src/view3d/lootAssets.ts. */
const ANCHORS = {
  flashlight: { lens: [0, 0.048, -0.1051], lensDir: [0, 0, -1], bulb: [0, 0.048, -0.0913], tubeExt: [0, 0.019, 0.1213] },
  bug_flash: { lens: [-0.0083, 0.0635, -0.0302], lensDir: [0, 0, -1] },
  zippo: { wickTop: [0.01, 0.0735, 0], flame: [0.01, 0.0835, 0] },
  kerolamp: { wickTop: [0, 0.104, 0], flame: [0, 0.116, 0] },
  bulb: { filament: [0, 0.0308, 0] },
};

// ───────── сборка ─────────
const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
/** glTF → Babylon (как загрузчик): x → −x */
const toB = (p) => [-p[0], p[1], p[2]];
let problems = 0;
for (const M of MODELS) {
  M.center();
  const mesh = doc.createMesh(`p_loot_${M.id}`);
  let verts = 0, tris = 0, flips = 0;
  for (const [m, raw] of M.parts) {
    const ot = [];
    for (const t of raw) {
      const o = orient(t);
      if (!o) continue;
      if (o.p[1] !== t.p[1]) flips++;
      ot.push(o);
    }
    const st = autoSmooth(ot, 35);
    const textured = !!m.getBaseColorTexture();
    const p = [], n = [], uv = [], idx = [];
    for (const t of st) {
      for (let j = 0; j < 3; j++) {
        p.push(...t.p[j]);
        n.push(...t.n[j]);
        if (textured) uv.push(...(t.uv ? t.uv[j] : [0, 0]));
        idx.push(idx.length);
      }
    }
    const prim = doc
      .createPrimitive()
      .setAttribute('POSITION', acc('VEC3', new Float32Array(p)))
      .setAttribute('NORMAL', acc('VEC3', new Float32Array(n)))
      .setIndices(acc('SCALAR', new Uint32Array(idx)))
      .setMaterial(m);
    if (textured) prim.setAttribute('TEXCOORD_0', acc('VEC2', new Float32Array(uv)));
    mesh.addPrimitive(prim);
    tris += st.length;
  }
  M.stats = { tris, mats: M.parts.size, flips };
  const { lo, hi } = M.bounds();
  const size = [0, 1, 2].map((a) => +(hi[a] - lo[a]).toFixed(4));
  const anchors = Object.fromEntries(Object.entries(M.anchors).filter(([k]) => k !== 'p2BodyR').map(([k, v]) => [k, toB(v).map(r4)]));
  M.anchorsB = anchors;
  const extras = { size };
  if (Object.keys(anchors).length) extras.anchors = anchors;
  scene.addChild(doc.createNode(`p_loot_${M.id}`).setMesh(mesh).setExtras(extras));
}

await doc.transform(
  weld(),
  dedup(),
  prune({ keepAttributes: true, keepLeaves: true, keepExtras: true }),
  // позиции — int16, нормали — int8; UV наклеек — 0…1 (int16 нормированные), индексы — uint16 после weld
  quantize({ quantizePosition: 14, quantizeNormal: 8, quantizeTexcoord: 12 }),
);
await io.write(out, doc);

// ───────── сверка по записанному файлу ─────────
const back = await io.read(out);
const nodes = back.getRoot().listScenes()[0].listChildren();
const seen = new Set();
const mmf = (v) => (v * 1000).toFixed(1);
console.log('узел                    w × h × d, мм (ожид.)                         верш.  тр.  мат.  стекло');
let totalV = 0, totalT = 0;
for (const node of nodes) {
  const id = node.getName();
  seen.add(id);
  const b = getBounds(node);
  const e = EXPECT[id];
  const M = MODELS.find((x) => `p_loot_${x.id}` === id);
  const s = [0, 1, 2].map((a) => b.max[a] - b.min[a]);
  let verts = 0;
  const glass = [];
  for (const prim of node.getMesh().listPrimitives()) {
    verts += prim.getAttribute('POSITION').getCount();
    const mn = prim.getMaterial().getName();
    if (mn.startsWith('loot_glass')) glass.push(mn.slice(11));
  }
  totalV += verts;
  totalT += M.stats.tris;
  let warn = '';
  if (!e) warn = ' ! нет в EXPECT';
  else {
    if (s.some((v, a) => Math.abs(v - e[a]) > Math.max(0.0015, e[a] * 0.03))) warn += ' ! габарит';
    if (Math.abs(b.min[1]) > 0.0003) warn += ` ! низ ${mmf(b.min[1])}`;
    if (Math.abs(b.min[0] + b.max[0]) > 0.0006 || Math.abs(b.min[2] + b.max[2]) > 0.0006) warn += ' ! не в центре';
  }
  if (warn) problems++;
  console.log(
    `${id.padEnd(22)} ${s.map(mmf).join(' × ').padEnd(20)} (${e ? e.map(mmf).join(' × ') : '-'})`.padEnd(70) +
      `${String(verts).padStart(5)} ${String(M.stats.tris).padStart(5)} ${String(M.stats.mats).padStart(4)}  ${glass.join(',')}${M.stats.flips ? `  (обход по нормалям: ${M.stats.flips})` : ''}${warn}`,
  );
}
for (const id of Object.keys(EXPECT)) if (!seen.has(id)) (problems++, console.log(`  ! нет узла ${id}`));
console.log('\nточки (Babylon, м):');
for (const [id, want] of Object.entries(ANCHORS)) {
  const got = MODELS.find((x) => x.id === id)?.anchorsB ?? {};
  for (const [k, v] of Object.entries(want)) {
    const g = got[k];
    const ok = g && g.every((x, a) => Math.abs(x - v[a]) < 0.001);
    if (!ok) problems++;
    console.log(`  ${id}.${k}: [${g?.join(', ')}]${ok ? '' : `  ! ожид. [${v.join(', ')}]`}`);
  }
}
const p2r = MODELS.find((x) => x.id === 'flashlight').anchors.p2BodyR;
console.log(`  (радиус корпуса П-2 под клеймом: ${mmf(p2r[0])} мм)`);
const size = statSync(out).size;
const texBytes = [...TEX_SIZE.values()].reduce((s, t) => s + t[2], 0);
console.log(
  `\n→ ${out}: ${(size / 1024).toFixed(1)} КБ (предел ${BUDGET / 1024}), предметов ${nodes.length}, вершин ${totalV}, треугольников ${totalT}, ` +
    `материалов ${back.getRoot().listMaterials().length}, текстур ${back.getRoot().listTextures().length} (${(texBytes / 1024).toFixed(1)} КБ: ` +
    `${[...TEX_SIZE].map(([n, t]) => `${n.slice(11)} ${t[0]}×${t[1]}`).join(', ')})`,
);
const glow = back.getRoot().listMaterials().filter((m) => m.getEmissiveFactor().some((v) => v > 0.01)).map((m) => m.getName());
const glassM = back.getRoot().listMaterials().filter((m) => m.getAlphaMode() === 'BLEND').map((m) => `${m.getName()} α ${m.getAlpha()}`);
console.log(`  светятся: ${glow.join(', ') || 'ничего'}; стекло: ${glassM.join(', ')}`);
if (size > BUDGET) (problems++, console.log(`  ! больше ${BUDGET / 1024} КБ`));
if (problems) {
  console.log(`  замечаний: ${problems}`);
  process.exitCode = 1;
}
