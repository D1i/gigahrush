// Набор погреба пользователя (earth-cellar-3d: GLB/*.glb — плоские PBR-цвета без UV и текстур, manifest.json —
// материалы и размеры, build_cellar.py — рецепт генерации) → src/view3d/assets/cellar_props.glb: предметы погреба одним
// файлом, узел на предмет, имя узла = id prop проекта (p_cel_*, src/data/props.ts), extras { size }.
//
//  • Из набора берутся только мелкие модели: 13_storage_shelf (стеллаж: доски — из набора, банки — свои), 12_loose_soil_heap
//    (куча рыхлой земли), 11_earth_wall (земляная стенка → оползень у стены). Модули 01–09 (ходы, комнаты, лестница) —
//    нет: по 32–66 тыс. треугольников, сетка 1 м и стены 1.7 м — оболочку погреба строит движок по плану комнаты
//    (src/view3d/cellarMesh.ts). 10_timber_support (0.42 × 1.63 м) низок: перемычка на уровне глаз (1.6 м) резала бы
//    камеру — крепь строится здесь по тому же рецепту (две стойки и перемычка), но под наши ходы: p_cel_frame — над
//    ходом 0.6 м, стойки на 2 см из стен (в свету 0.56 м: комья оболочки, до 1.8 см внутрь, не «натекают» на стойки),
//    p_cel_frame_narrow — над щелью 0.4 м, стойки по стенам (в свету 0.4 м); низ перемычки 1.78 м. Бревно не по
//    линейке: стойки чуть завалены, перемычка одним концом осела и сдвинута вбок.
//  • Банки стеллажа набора — «яйца» (UV-сфера на 120 треугольников) — заменены своими на тех же местах: тело вращения,
//    содержимое тёмное (огурцы / помидоры сквозь стекло), над ним стекло (пустое место, плечи, горло), ржавая крышка.
//  • Мешок p_cel_sack — тоже здесь (в моделях набора мешка нет): тело вращения с неровностью, мешковина, бечёвка.
//  • Прореживание без meshoptimizer: крошки (мелкие несвязные капли, ≤ 7 см) заменяются октаэдрами (8 треугольников) и
//    остаются только самые крупные (maxCrumbs); крупные части (капля кучи, бугристый брус стенки) — как есть. Всё, что
//    ниже пола, прижато к y = 0, лежащие на полу треугольники выброшены. Нормали — сглаженные (излом > 80° — резкий).
//  • Цвета (LOOK): Babylon кладёт baseColorFactor в diffuseColor как есть (src/view3d/propModels.ts), т. е. цвет — в
//    гамме. Цвета набора, переведённые в гамму (c^(1/2.2)), под фонарём выходили бледным серо-бежевым пластиком — здесь
//    свои, под земляную оболочку (#3a2e24…#54422f, cellarMesh.ts): тёмное сырое дерево, земля в тон стен, тёмные банки.
//    Текстуры — из шума, бесшовные (sharp → PNG, в GLB — WebP, EXT_texture_webp): старый брус (волокна, годичные слои,
//    трещины-усушки, сучки, сырость), земля, мешковина; у материала с текстурой цвет — в ней (фактор белый: propModels
//    тогда берёт белый diffuseColor). UV — коробкой: брус — вдоль волокон (1 м на повтор), торцы — свой тёмный материал
//    без текстуры; земля — проекцией на ближнюю грань (0.5 м на повтор, как у оболочки). Свечения нет (emissive 0:
//    светящийся предмет в propModels.ts — без света сцены, а в погребе света нет); блик стекла банок — propModels.ts
//    по имени cel_jar_*. Имена материалов — с префиксом cel_ (кэш материалов PropModels — по имени, общий для наборов).
//  • Ось и «перед»: перед предмета смотрит на −Z (glTF; болванка мебели — src/blockout/babylon.ts, «перед = −Z
//    локально»), центр — по габариту на плане (x, z), низ — на полу (y = 0). Оползень наклонён верхом назад (+Z) — к
//    стене, у которой стоит.
//
//   node tools/optimize-cellar.mjs [папка earth-cellar-3d]
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, quantize, textureCompress, weld } from '@gltf-transform/functions';
import sharp from 'sharp';
import { mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = resolve(process.argv[2] ?? 'C:/Users/Maxim/Documents/Codex/2026-10-09/new-chat/outputs/earth-cellar-3d');
const outGlb = fileURLToPath(new URL('../src/view3d/assets/cellar_props.glb', import.meta.url));
mkdirSync(fileURLToPath(new URL('../src/view3d/assets/', import.meta.url)), { recursive: true });

/** Предел треугольников на предмет (проверка в конце). */
const MAX_TRIS = 2500;
/** Крошка — компонента связности не больше этого по любой оси, м. */
const CRUMB_M = 0.07;
/** Нормали: соседние грани с углом больше этого — излом. */
const CREASE = Math.cos((80 * Math.PI) / 180);
/** UV: метров на повтор текстуры — бруса поперёк и вдоль волокон, земли и мешковины. */
const WOOD_U = 0.5;
const WOOD_V = 1.0;
const SOIL_M = 0.5;
const BURLAP_M = 0.25;

// квантование пишет KHR_mesh_quantization — расширения нужно зарегистрировать
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene('cellar_props');
doc.getRoot().setDefaultScene(scene);

/** Детерминированный ГСЧ (mulberry32). */
function rng(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hex = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16) / 255);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ───────── текстуры: бесшовные, из шума ─────────

/** Хэш клетки → 0…1. */
function hash(i, j, s) {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(s, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Бесшовный шум значений: pu × pv клеток на текстуру (по модулю — повтор без шва), 0…1. */
function noise(u, v, pu, pv, s) {
  const x = u * pu, y = v * pv;
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const c = (a, b) => hash((((xi + a) % pu) + pu) % pu, (((yi + b) % pv) + pv) % pv, s);
  return (c(0, 0) * (1 - sx) + c(1, 0) * sx) * (1 - sy) + (c(0, 1) * (1 - sx) + c(1, 1) * sx) * sy;
}

/** Разность на торе (повтор текстуры): −0.5…0.5. */
const wrap = (d) => d - Math.round(d);

/** Бесшовный клеточный шум (Ворли), p клеток на текстуру: F1 (в долях клетки) и номер ближайшей точки 0…1. */
function worley(u, v, p, s) {
  const x = u * p, y = v * p;
  const xi = Math.floor(x), yi = Math.floor(y);
  const m = (i) => ((i % p) + p) % p;
  let f1 = 9, id = 0;
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      const i = xi + di, j = yi + dj;
      const d = Math.hypot(i + 0.1 + 0.8 * hash(m(i), m(j), s) - x, j + 0.1 + 0.8 * hash(m(i), m(j), s + 1) - y);
      if (d < f1) {
        f1 = d;
        id = hash(m(i), m(j), s + 2);
      }
    }
  }
  return [f1, id];
}

/** Текстура W × H: fn(u, v, x, y) → [r, g, b]; средний цвет приводится к mean (sRGB). */
async function texture(name, W, H, mean, fn) {
  const f = new Float32Array(W * H * 3);
  const sum = [0, 0, 0];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = fn((x + 0.5) / W, (y + 0.5) / H, x, y);
      for (let k = 0; k < 3; k++) {
        f[(y * W + x) * 3 + k] = c[k];
        sum[k] += c[k];
      }
    }
  }
  const m = hex(mean);
  const gain = sum.map((s, k) => m[k] / (s / (W * H) || 1));
  // загрузчик glTF Babylon читает baseColorTexture через sRGB-буфер (useSRGBBuffers: при выборке цвет уже линейный), а
  // StandardMaterial (propModels.ts) берёт его как гамму — картинка темнела бы до чёрного; поэтому в файл — sRGB-код
  // нужного цвета: после выборки получается он сам
  const enc = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
  const px = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    for (let k = 0; k < 3; k++) px[i * 4 + k] = Math.round(enc(Math.max(0, Math.min(1, f[i * 3 + k] * gain[k]))) * 255);
    px[i * 4 + 3] = 255;
  }
  const png = await sharp(px, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
  return doc.createTexture(name).setImage(png).setMimeType('image/png').setURI(`${name}.png`);
}

/** Старый брус: 0.5 м поперёк волокон (u) × 1 м вдоль (v), 5 пикс/см, как у земли оболочки. Волокна петляют и обтекают
 *  сучки, годичные слои — тонкие тёмные полосы, продольные трещины-усушки, пятна сырости, посеревшие места. */
function woodFn(W) {
  const R = rng(4242);
  const cracks = Array.from({ length: 9 }, () => ({ u: R(), v: R(), len: 0.12 + R() * 0.5, w: 0.7 + R() * 1.8 }));
  const knots = Array.from({ length: 3 }, () => ({ u: R(), v: R(), r: 0.007 + R() * 0.009 }));
  const wet = hex('#3f2f20'), dry = hex('#5a5249');
  return (u, v) => {
    let uu = u + 0.03 * (noise(u, v, 3, 2, 1) - 0.5) + 0.01 * (noise(u, v, 9, 6, 2) - 0.5);
    let knot = 0;
    for (const k of knots) {
      // в метрах; сучок вытянут вдоль волокон, волокна его обтекают
      const du = wrap(u - k.u) * WOOD_U, dv = wrap(v - k.v) * WOOD_V;
      const e = Math.hypot(du, dv * 0.55) / k.r;
      uu += (0.02 * Math.sign(du) * Math.exp(-e * 0.8)) / (1 + Math.abs(dv) * 30);
      if (e < 1) knot = Math.max(knot, 1 - e * e);
    }
    // годичные слои: шаг неровный (фаза плывёт), поздняя древесина — тонкие тёмные линии разной силы
    const ring = 0.5 + 0.5 * Math.sin(2 * Math.PI * (uu * 34 + 2.2 * noise(u, v, 5, 2, 8) + 0.8 * noise(u, v, 13, 3, 10)));
    const late = Math.pow(ring, 7) * (0.35 + 0.9 * noise(u, v, 24, 3, 9));
    // волокна: штрихи вдоль, местами светлые задиры
    const fib = 0.5 * noise(u, v, 96, 5, 3) + 0.3 * noise(u, v, 256, 14, 4) + 0.2 * noise(u, v, 256, 40, 12);
    const damp = 0.6 * noise(u, v, 3, 2, 5) + 0.4 * noise(u, v, 8, 5, 6);
    const grey = smooth(0.45, 0.8, 0.7 * noise(u, v, 4, 3, 7) + 0.3 * noise(u, v, 16, 6, 11));
    let k = (0.7 + 0.55 * fib) * (1 - 0.42 * late) * (1.25 - 0.55 * damp);
    for (const c of cracks) {
      const dv = v - c.v - Math.floor(v - c.v);
      if (dv > c.len) continue;
      const half = (c.w * Math.sin((Math.PI * dv) / c.len)) / W;
      const du = Math.abs(wrap(u - c.u - 0.003 * Math.sin(dv * 37)));
      if (du < half) k *= 0.2 + 0.8 * (du / half) ** 2;
      else if (du < half + 2 / W) k *= 0.88;
    }
    k *= 1 - 0.65 * knot;
    return [0, 1, 2].map((i) => lerp(wet[i], dry[i], grey) * k);
  };
}

/** Земля куч и оползня (0.5 м на повтор) — как текстура оболочки (src/view3d/cellarView.ts soilTextures): комочки
 *  1…3 см (клеточный шум двух размеров, у комочка свои радиус, высота и оттенок), поры между ними, пятна, охристые
 *  прожилки, редкие светлые песчинки. */
function soilFn() {
  const oct = [[14, 0.7, 21], [34, 0.45, 22]];
  return (u0, v0, x, y) => {
    const u = u0 + 0.018 * (noise(u0, v0, 10, 10, 51) - 0.5) + 0.008 * (noise(u0, v0, 30, 30, 52) - 0.5);
    const v = v0 + 0.018 * (noise(u0, v0, 10, 10, 53) - 0.5) + 0.008 * (noise(u0, v0, 30, 30, 54) - 0.5);
    let hh = 0, tint = 0, cover = 0;
    for (const [p, w, s] of oct) {
      const [f1, id] = worley(u, v, p, s);
      const r = 0.45 + 0.4 * hash(Math.floor(id * 9973), 7, s + 5);
      const kk = 0.35 + 0.65 * hash(Math.floor(id * 7919), 3, s + 9);
      const t = Math.min(1, f1 / r);
      cover = Math.max(cover, 1 - t);
      const dome = w * kk * (1 - t * t) * (1 - t * t);
      if (dome > hh) {
        hh = dome;
        tint = (id - 0.5) * 2;
      }
    }
    const g1 = noise(u0, v0, 64, 64, 41), g2 = noise(u0, v0, 128, 128, 42);
    const blot = noise(u0, v0, 5, 5, 43) * 0.6 + noise(u0, v0, 16, 16, 44) * 0.4;
    hh += 0.16 * g1 + 0.1 * g2;
    const pore = 1 - Math.min(1, cover * 2.5);
    const speck = hash(x, y, 31) > 0.99 ? 0.25 : hash(x, y, 33) > 0.985 ? -0.2 : 0;
    const a = 0.66 + 0.16 * Math.min(1, hh) - 0.12 * pore + 0.07 * tint + 0.18 * (blot - 0.5) + 0.1 * (g2 - 0.5) + speck;
    const clay = smooth(0.68, 0.84, noise(u0, v0, 6, 6, 15)) * 0.3;
    return [a * (1.04 + 0.25 * clay), a * (1 + 0.1 * clay), a * (0.94 - 0.12 * clay)];
  };
}

/** Мешковина (0.25 м на повтор, 20 нитей): полотняное переплетение, нити неровной толщины и тона, грязь пятнами. */
function burlapFn() {
  const N = 20;
  // нить: толщина плывёт по длине, у каждой свой тон
  const thread = (f, w) => Math.sin(Math.PI * Math.max(0, Math.min(1, (f - 0.5) / w + 0.5)));
  return (u, v) => {
    const x = u * N, y = v * N;
    const i = Math.floor(x), j = Math.floor(y);
    const wi = 0.78 + 0.2 * noise(u, v, N, 6, 24), wj = 0.78 + 0.2 * noise(u, v, 6, N, 25);
    const a = thread(x - i, wi) * (0.8 + 0.2 * Math.sin(Math.PI * (y - j))) * (0.85 + 0.3 * hash(i % N, 0, 26));
    const b = thread(y - j, wj) * (0.8 + 0.2 * Math.sin(Math.PI * (x - i))) * (0.85 + 0.3 * hash(0, j % N, 27));
    const h = (i + j) % 2 === 0 ? Math.max(a, 0.75 * b) : Math.max(b, 0.75 * a);
    const yarn = 0.85 + 0.3 * noise(u, v, N * 4, N, 21);
    const dirt = 0.6 * noise(u, v, 3, 3, 22) + 0.4 * noise(u, v, 9, 9, 23);
    const k = (0.4 + 0.6 * h) * yarn * (1.3 - 0.6 * dirt);
    return [k, k * 0.84, k * 0.63];
  };
}

const TEX = new Map([
  ['cel_wood', await texture('cel_wood', 256, 512, '#4a3d30', woodFn(256))],
  ['cel_soil', await texture('cel_soil', 256, 256, '#45362a', soilFn())],
  ['cel_burlap', await texture('cel_burlap', 256, 256, '#5b4a37', burlapFn())],
]);

// ───────── материалы ─────────

/** Свои цвета (sRGB — в гамме) или текстура (цвет в ней, фактор белый); roughness — для glTF-просмотрщиков. */
const LOOK = {
  // брус крепи и доски стеллажа; торцы — темнее, без текстуры
  Old_wood: { tex: 'cel_wood', roughness: 0.95 },
  Wood_end: { color: '#2d2219', roughness: 1 },
  // земля в тон оболочки: тело кучи — текстурой, крошки — плоским цветом
  Black_soil: { tex: 'cel_soil', roughness: 1 },
  Soil_crumbs: { color: '#4a3b2c', roughness: 1 },
  Soil_dark: { color: '#2f261d', roughness: 1 },
  // банки: стекло над содержимым, содержимое сквозь стекло; крышки — ржавая жесть
  Jar_glass: { color: '#4b5944', roughness: 0.15 },
  Jar_pickles: { color: '#29301c', roughness: 0.2 },
  Jar_tomato: { color: '#3d241a', roughness: 0.2 },
  Lid: { color: '#4a4037', roughness: 0.7 },
  // мешок и бечёвка
  Sack: { tex: 'cel_burlap', roughness: 1 },
  Twine: { color: '#3b3127', roughness: 1 },
};

const mats = new Map();
function material(name) {
  if (mats.has(name)) return mats.get(name);
  const L = LOOK[name];
  if (!L) throw new Error(`нет материала ${name} в LOOK`);
  const out = doc.createMaterial(`cel_${name.toLowerCase()}`)
    .setBaseColorFactor(L.tex ? [1, 1, 1, 1] : [...hex(L.color), 1])
    .setMetallicFactor(0)
    .setRoughnessFactor(L.roughness ?? 1)
    .setEmissiveFactor([0, 0, 0])
    .setDoubleSided(false);
  if (L.tex) out.setBaseColorTexture(TEX.get(L.tex));
  mats.set(name, out);
  return out;
}

// ───────── треугольники: { mat, p: [x0,y0,z0, x1,y1,z1, x2,y2,z2], uv?: [u0,v0, u1,v1, u2,v2] } ─────────

/** Все треугольники файла набора (мировые трансформы узлов запечены). */
async function readTris(file) {
  const d = await io.read(`${src}/GLB/${file}.glb`);
  const out = [];
  for (const n of d.getRoot().listNodes()) {
    const mesh = n.getMesh();
    if (!mesh) continue;
    const M = n.getWorldMatrix();
    const at = (v) => [
      M[0] * v[0] + M[4] * v[1] + M[8] * v[2] + M[12],
      M[1] * v[0] + M[5] * v[1] + M[9] * v[2] + M[13],
      M[2] * v[0] + M[6] * v[1] + M[10] * v[2] + M[14],
    ];
    for (const prim of mesh.listPrimitives()) {
      const P = prim.getAttribute('POSITION');
      const idx = prim.getIndices();
      const count = idx ? idx.getCount() : P.getCount();
      const mat = prim.getMaterial()?.getName() ?? 'Black_soil';
      for (let k = 0; k + 2 < count; k += 3) {
        const p = [];
        for (let j = 0; j < 3; j++) p.push(...at(P.getElement(idx ? idx.getScalar(k + j) : k + j, [0, 0, 0])));
        out.push({ mat, p });
      }
    }
  }
  return out;
}

/** Компоненты связности (общие вершины с точностью 0.1 мм). */
function components(tris) {
  const parent = tris.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const seen = new Map();
  tris.forEach((t, i) => {
    for (let j = 0; j < 3; j++) {
      const key = `${Math.round(t.p[j * 3] * 1e4)},${Math.round(t.p[j * 3 + 1] * 1e4)},${Math.round(t.p[j * 3 + 2] * 1e4)}`;
      const o = seen.get(key);
      if (o === undefined) seen.set(key, i);
      else parent[find(i)] = find(o);
    }
  });
  const groups = new Map();
  tris.forEach((t, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(t);
  });
  return [...groups.values()];
}

/** Октаэдр в габарите (центр c, полуоси r) — замена крошки. */
function octa(mat, c, r) {
  const v = [
    [c[0] + r[0], c[1], c[2]], [c[0] - r[0], c[1], c[2]],
    [c[0], c[1] + r[1], c[2]], [c[0], c[1] - r[1], c[2]],
    [c[0], c[1], c[2] + r[2]], [c[0], c[1], c[2] - r[2]],
  ];
  // грани: (±x, ±y, ±z), обход — наружу
  const F = [[0, 2, 4], [0, 4, 3], [0, 3, 5], [0, 5, 2], [1, 4, 2], [1, 3, 4], [1, 5, 3], [1, 2, 5]];
  return F.map(([a, b, d]) => ({ mat, p: [...v[a], ...v[b], ...v[d]] }));
}

/** Прореживание: крупные компоненты — как есть, крошки — октаэдры, только maxCrumbs самых крупных. */
function decimate(tris, maxCrumbs) {
  const big = [];
  const crumbs = [];
  for (const g of components(tris)) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const t of g) for (let j = 0; j < 9; j++) (lo[j % 3] = Math.min(lo[j % 3], t.p[j])), (hi[j % 3] = Math.max(hi[j % 3], t.p[j]));
    const size = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
    if (Math.max(...size) > CRUMB_M) big.push(...g);
    else {
      // октаэдр меньше капли того же габарита — полуоси чуть больше половины габарита
      const r = size.map((s) => (s / 2) * 1.15);
      crumbs.push({ mat: g[0].mat, c: lo.map((v, k) => (v + hi[k]) / 2), r, vol: r[0] * r[1] * r[2], n: g.length });
    }
  }
  crumbs.sort((a, b) => b.vol - a.vol || a.c[0] - b.c[0] || a.c[2] - b.c[2]);
  const kept = crumbs.slice(0, maxCrumbs);
  return { tris: [...big, ...kept.flatMap((k) => octa(k.mat, k.c, k.r))], crumbs: crumbs.length, kept: kept.length };
}

/** Преобразование вершин: масштаб s, наклон вокруг X на tilt (град; верх → +Z при tilt > 0), поворот вокруг Y. */
function transform(tris, { s = 1, tilt = 0, rotY = 0 } = {}) {
  const a = (tilt * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
  const b = (rotY * Math.PI) / 180, cb = Math.cos(b), sb = Math.sin(b);
  return tris.map((t) => {
    const p = [];
    for (let j = 0; j < 3; j++) {
      let x = t.p[j * 3] * s, y = t.p[j * 3 + 1] * s, z = t.p[j * 3 + 2] * s;
      // наклон: y' = y·cos − z·sin… верх уходит на +Z
      [y, z] = [y * ca - z * sa, y * sa + z * ca];
      [x, z] = [x * cb + z * sb, -x * sb + z * cb];
      p.push(x, y, z);
    }
    return { ...t, p };
  });
}

/** Низ — на пол: ниже пола прижать к y = 0; лежащие на полу и вырожденные — выбросить. */
function onFloor(tris) {
  const out = [];
  for (const t of tris) {
    const p = t.p.slice();
    for (let j = 1; j < 9; j += 3) if (p[j] < 0) p[j] = 0;
    if (p[1] <= 1e-4 && p[4] <= 1e-4 && p[7] <= 1e-4) continue;
    if (area(p) < 1e-9) continue;
    out.push({ ...t, p });
  }
  return out;
}

function cross(p) {
  const ux = p[3] - p[0], uy = p[4] - p[1], uz = p[5] - p[2];
  const vx = p[6] - p[0], vy = p[7] - p[1], vz = p[8] - p[2];
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}
const area = (p) => Math.hypot(...cross(p)) / 2;
/** Ось, к которой ближе нормаль треугольника (0 x, 1 y, 2 z). */
const mainAxis = (p) => {
  const n = cross(p).map(Math.abs);
  return n.indexOf(Math.max(...n));
};

function bounds(tris) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) for (let j = 0; j < 9; j++) (lo[j % 3] = Math.min(lo[j % 3], t.p[j])), (hi[j % 3] = Math.max(hi[j % 3], t.p[j]));
  return { lo, hi };
}

/** Центр по плану (x, z), низ на y = 0. */
function center(tris) {
  const { lo, hi } = bounds(tris);
  const dx = -(lo[0] + hi[0]) / 2, dy = -lo[1], dz = -(lo[2] + hi[2]) / 2;
  return tris.map((t) => ({ ...t, p: t.p.map((v, j) => v + [dx, dy, dz][j % 3]) }));
}

// ───────── UV коробкой ─────────

/** Доски из набора: у каждой (компонента связности) волокна — вдоль самого длинного габарита; грани поперёк волокон —
 *  торцы (Wood_end), остальные — текстура бруса со своим сдвигом. */
function timberUV(tris, seed) {
  const R = rng(seed);
  return components(tris).flatMap((g) => {
    const { lo, hi } = bounds(g);
    const s = [0, 1, 2].map((k) => hi[k] - lo[k]);
    const grain = s.indexOf(Math.max(...s));
    const off = [R() * 2, R() * 2];
    return g.map((t) => {
      const a = mainAxis(t.p);
      if (a === grain) return { mat: 'Wood_end', p: t.p, uv: [0, 0, 0, 0, 0, 0] };
      const ua = 3 - a - grain;
      const uv = [];
      for (let j = 0; j < 3; j++) uv.push(off[0] + t.p[j * 3 + ua] / WOOD_U, off[1] + t.p[j * 3 + grain] / WOOD_V);
      return { ...t, uv };
    });
  });
}

/** Земля: проекция на грань, к которой ближе нормаль (0.5 м на повтор); только материал mat. */
function soilUV(tris, mat) {
  return tris.map((t) => {
    if (t.mat !== mat) return t;
    const a = mainAxis(t.p);
    const [ua, va] = a === 0 ? [2, 1] : a === 1 ? [0, 2] : [0, 1];
    const uv = [];
    for (let j = 0; j < 3; j++) uv.push(t.p[j * 3 + ua] / SOIL_M, t.p[j * 3 + va] / SOIL_M);
    return { ...t, uv };
  });
}

// ───────── процедурные: крепь, банки, мешок ─────────

/** Брус по 8 углам P[ix + 2·iy + 4·iz] (ix, iy, iz ∈ {0, 1} — по осям x, y, z), size — номинальные размеры по осям, м;
 *  g — ось волокон. Грани поперёк волокон — торцы (Wood_end), прочие — текстура бруса: v вдоль волокон, u поперёк,
 *  off — свой кусок текстуры. */
function beam(P, size, g, off) {
  const out = [];
  for (let a = 0; a < 3; a++) {
    const b = (a + 1) % 3, c = (a + 2) % 3;
    for (const side of [0, 1]) {
      // обход (b, c): (0,0) (1,0) (1,1) (0,1) — нормаль +a (b × c = a); у грани −a — обратный
      const q = side ? [[0, 0], [1, 0], [1, 1], [0, 1]] : [[0, 1], [1, 1], [1, 0], [0, 0]];
      const loc = q.map(([ib, ic]) => {
        const l = [0, 0, 0];
        l[a] = side;
        l[b] = ib;
        l[c] = ic;
        return l;
      });
      const pts = loc.map((l) => P[l[0] + 2 * l[1] + 4 * l[2]]);
      const end = a === g;
      const ua = 3 - a - g;
      const uv = loc.map((l) => (end ? [0, 0] : [off[0] + (l[ua] * size[ua]) / WOOD_U, off[1] + (l[g] * size[g]) / WOOD_V]));
      const mat = end ? 'Wood_end' : 'Old_wood';
      for (const [i, j, k] of [[0, 1, 2], [0, 2, 3]]) out.push({ mat, p: [...pts[i], ...pts[j], ...pts[k]], uv: [...uv[i], ...uv[j], ...uv[k]] });
    }
  }
  return out;
}

/** Крепь по рецепту набора (portal в build_cellar.py): две стойки pw × 0.09 м по краям прохода в свету clear (от
 *  внутренних граней наружу — в землю стен хода) и перемычка 0.075 × 0.10 м с низом на 1.78 м. Не по линейке: верх стоек
 *  завален вдоль хода (±1 см), у широкой (wide) — ещё и внутрь хода (0.4…1 см: стойка не уходит в землю); перемычка
 *  одним концом осела (до 1.2 см) и сдвинута вбок. */
function frame(clear, pw, wide, seed) {
  const R = rng(seed);
  const lintel = 1.78, lh = 0.075, ld = 0.1, pd = 0.09;
  const yTop = lintel + lh / 2;
  const out = [];
  for (const side of [-1, 1]) {
    const lean = (R() - 0.5) * 0.02;
    const inward = wide ? 0.004 + R() * 0.006 : 0;
    // ix растёт с x мира (обход граней — наружу и у левой стойки)
    const xs = side > 0 ? [clear / 2, clear / 2 + pw] : [-clear / 2 - pw, -clear / 2];
    const P = [];
    for (let iz = 0; iz < 2; iz++) {
      for (let iy = 0; iy < 2; iy++) {
        for (let ix = 0; ix < 2; ix++) P[ix + 2 * iy + 4 * iz] = [xs[ix] - (iy ? side * inward : 0), iy ? yTop : 0, (iz ? pd / 2 : -pd / 2) + (iy ? lean : 0)];
      }
    }
    out.push(...beam(P, [pw, yTop, pd], 1, [R() * 2, R() * 2]));
  }
  const half = clear / 2 + pw + 0.005;
  const shift = (R() - 0.5) * (wide ? 0.016 : 0.009);
  const dy = [-R() * 0.012, -R() * 0.012];
  const tz = (R() - 0.5) * 0.01;
  const P = [];
  for (let iz = 0; iz < 2; iz++) {
    for (let iy = 0; iy < 2; iy++) {
      for (let ix = 0; ix < 2; ix++) P[ix + 2 * iy + 4 * iz] = [(ix ? half : -half) + shift, lintel + dy[ix] + (iy ? lh : 0), (iz ? ld / 2 : -ld / 2) + tz];
    }
  }
  out.push(...beam(P, [2 * half, lh, ld], 0, [R() * 2, R() * 2]));
  return out;
}

/** Тело вращения: профиль prof[k] = [r, y, mat полосы k−1…k], seg граней, центр c; сплюснуто по z на flat; jitter —
 *  неровность радиуса (по вершинам). uv: u — вокруг (uTiles повторов), v — высота / vM. */
function lathe(prof, seg, c, { flat = 1, jitter = null, uTiles = 1, vM = 1 } = {}) {
  const at = (k, i) => {
    const a = (2 * Math.PI * (i % seg)) / seg;
    const r = prof[k][0] * (jitter ? jitter[k][i % seg] : 1);
    return [c[0] + Math.cos(a) * r, c[1] + prof[k][1], c[2] + Math.sin(a) * r * flat];
  };
  const uvAt = (k, i) => [(i / seg) * uTiles, prof[k][1] / vM];
  const out = [];
  for (let k = 0; k + 1 < prof.length; k++) {
    const mat = prof[k + 1][2];
    for (let i = 0; i < seg; i++) {
      const a = at(k, i), b = at(k, i + 1), d = at(k + 1, i + 1), e = at(k + 1, i);
      const ua = uvAt(k, i), ub = uvAt(k, i + 1), ud = uvAt(k + 1, i + 1), ue = uvAt(k + 1, i);
      out.push({ mat, p: [...a, ...d, ...b], uv: [...ua, ...ud, ...ub] }, { mat, p: [...a, ...e, ...d], uv: [...ua, ...ue, ...ud] });
    }
  }
  // вырожденные (r = 0 на полюсе, кольцо на одной высоте с тем же радиусом) — выбросить
  return out.filter((t) => area(t.p) > 1e-10);
}

/** Банка радиуса r, высоты h (с крышкой), дно в c: содержимое fill до уровня, выше — стекло (пустое место, плечи,
 *  горло), сверху — крышка (жесть). 150 треугольников. */
function jar(c, r, h, fill, R) {
  const level = 0.58 + R() * 0.12;
  return lathe([
    [r * 0.88, 0],
    [r, 0.03 * h, fill],
    [r, level * h, fill],
    [r, 0.74 * h, 'Jar_glass'],
    [r * 0.74, 0.84 * h, 'Jar_glass'],
    [r * 0.7, 0.88 * h, 'Jar_glass'],
    // крышка: снизу кольцо от горла, бортик, верх
    [r * 0.78, 0.88 * h, 'Lid'],
    [r * 0.78, h, 'Lid'],
    [0, h, 'Lid'],
  ], 10, c);
}

/** Стеллаж набора: доски — как есть (UV бруса), банки-«яйца» и их крышки — свои банки на тех же местах. */
function shelf(tris) {
  const wood = timberUV(tris.filter((t) => t.mat === 'Old_wood'), 913);
  const R = rng(1013);
  const jars = components(tris.filter((t) => t.mat === 'Jar_green')).map((g) => bounds(g));
  jars.sort((a, b) => a.lo[1] - b.lo[1] || a.lo[0] - b.lo[0]);
  const out = [...wood];
  for (const { lo, hi } of jars) {
    const r = (Math.min(hi[0] - lo[0], hi[2] - lo[2]) / 2) * 0.9;
    out.push(...jar([(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2], r, hi[1] - lo[1] + 0.005, R() < 0.6 ? 'Jar_pickles' : 'Jar_tomato', R));
  }
  return { tris: out, jars: jars.length, boards: components(tris.filter((t) => t.mat === 'Old_wood')).length };
}

/** Мешок: тело вращения (профиль r(y)), сплюснут спереди-назад, неровный; перевязка горловины — бечёвка. */
function sack() {
  const R = rng(1729);
  const prof = [[0.15, 0], [0.19, 0.05], [0.205, 0.15], [0.2, 0.26], [0.17, 0.36], [0.11, 0.44], [0.055, 0.5], [0.045, 0.53], [0.05, 0.56], [0.075, 0.6], [0.05, 0.635], [0, 0.645]]
    .map(([r, y], k) => [r, y, k >= 7 && k <= 8 ? 'Twine' : 'Sack']);
  const seg = 12;
  const jitter = prof.map(() => Array.from({ length: seg }, () => 1 + (R() - 0.5) * 0.12));
  return lathe(prof, seg, [0, 0, 0], { flat: 0.75, jitter, uTiles: 5, vM: BURLAP_M });
}

// ───────── нормали и запись ─────────

/** Сглаженные нормали: на вершине — среднее нормалей граней у той же точки, кроме граней под углом больше излома. */
function normals(tris) {
  const fn = tris.map((t) => {
    const n = cross(t.p);
    const l = Math.hypot(...n) || 1;
    return n.map((x) => x / l);
  });
  const at = new Map();
  const key = (t, j) => `${Math.round(t.p[j * 3] * 1e4)},${Math.round(t.p[j * 3 + 1] * 1e4)},${Math.round(t.p[j * 3 + 2] * 1e4)}`;
  tris.forEach((t, i) => {
    for (let j = 0; j < 3; j++) {
      const k = key(t, j);
      if (!at.has(k)) at.set(k, []);
      at.get(k).push(i);
    }
  });
  return tris.map((t, i) => {
    const out = [];
    for (let j = 0; j < 3; j++) {
      const s = [0, 0, 0];
      for (const f of at.get(key(t, j))) {
        const d = fn[f][0] * fn[i][0] + fn[f][1] * fn[i][1] + fn[f][2] * fn[i][2];
        if (d < CREASE) continue;
        for (let c = 0; c < 3; c++) s[c] += fn[f][c];
      }
      const l = Math.hypot(...s) || 1;
      out.push(...s.map((x) => x / l));
    }
    return out;
  });
}

function addProp(id, tris, note) {
  const ns = normals(tris);
  // UV — у всех примитивов узла, если хоть у одного текстура (один набор атрибутов: Babylon сливает их в один меш)
  const withUV = tris.some((t) => t.uv);
  const byMat = new Map();
  tris.forEach((t, i) => {
    if (!byMat.has(t.mat)) byMat.set(t.mat, { p: [], n: [], uv: [] });
    const d = byMat.get(t.mat);
    d.p.push(...t.p);
    d.n.push(...ns[i]);
    if (withUV) d.uv.push(...(t.uv ?? [0, 0, 0, 0, 0, 0]));
  });
  const mesh = doc.createMesh(id);
  for (const [mat, d] of [...byMat].sort(([a], [b]) => a.localeCompare(b))) {
    const n = d.p.length / 3;
    const prim = doc.createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(d.p)).setBuffer(buffer))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(d.n)).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(n > 65535 ? Uint32Array.from({ length: n }, (_, i) => i) : Uint16Array.from({ length: n }, (_, i) => i)).setBuffer(buffer))
      .setMaterial(material(mat));
    if (withUV) prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(d.uv)).setBuffer(buffer));
    mesh.addPrimitive(prim);
  }
  const { lo, hi } = bounds(tris);
  const size = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]].map((v) => +v.toFixed(3));
  scene.addChild(doc.createNode(id).setMesh(mesh).setExtras({ size }));
  const ok = tris.length <= MAX_TRIS ? '' : `  ← больше ${MAX_TRIS}!`;
  console.log(`  ${id.padEnd(20)} ${size.join(' × ').padEnd(22)} м, треугольников ${String(tris.length).padStart(4)}${note ? `  (${note})` : ''}${ok}`);
  return tris.length;
}

const shelfSrc = await readTris('13_storage_shelf');
const heap = await readTris('12_loose_soil_heap');
const wall = await readTris('11_earth_wall');

const report = (src, d) => `из ${src.length}: крошек ${d.crumbs} → ${d.kept} октаэдров`;
let total = 0;
{
  const s = shelf(shelfSrc);
  total += addProp('p_cel_shelf', center(onFloor(s.tris)), `доски набора (${s.boards}), банок ${s.jars} — свои`);
}
{
  const d = decimate(heap, 200);
  total += addProp('p_cel_heap', soilUV(center(onFloor(d.tris)), 'Black_soil'), report(heap, d));
}
{
  const d = decimate(heap, 90);
  total += addProp('p_cel_heap_small', soilUV(center(onFloor(transform(d.tris, { s: 0.55 }))), 'Black_soil'), report(heap, d) + ', ×0.55');
}
{
  const d = decimate(wall, 170);
  total += addProp('p_cel_slump', soilUV(center(onFloor(transform(d.tris, { tilt: 6 }))), 'Black_soil'), report(wall, d) + ', наклон 6° к стене');
}
total += addProp('p_cel_frame', center(frame(0.56, 0.07, true, 31)), 'крепь хода: стойки на 2 см из стен (в свету 0.56 м), перемычка 1.78 м');
total += addProp('p_cel_frame_narrow', center(frame(0.4, 0.065, false, 37)), 'крепь щели: стойки по стенам (в свету 0.4 м)');
total += addProp('p_cel_sack', center(onFloor(sack())), 'мешок');

await doc.transform(
  weld(),
  dedup(),
  // атрибуты не трогать: у примитивов узла один набор (POSITION, NORMAL[, TEXCOORD_0]) — Babylon сливает их в один меш
  prune({ keepAttributes: true }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 82 }),
  // UV повторяются (за пределами 0…1) — без квантования
  quantize({ pattern: /^(POSITION|NORMAL)$/ }),
);
await io.write(outGlb, doc);
const texKB = doc.getRoot().listTextures().map((t) => `${t.getName()} ${t.getSize()?.join('×')} ${(t.getImage().byteLength / 1024).toFixed(0)} КБ`);
console.log(`  текстуры: ${texKB.join(', ')}`);
console.log(`→ ${outGlb}: ${(statSync(outGlb).size / 1024).toFixed(0)} КБ, треугольников всего ${total}`);
