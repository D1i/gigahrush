// Набор погреба пользователя (earth-cellar-3d: GLB/*.glb — плоские PBR-цвета без UV и текстур, manifest.json —
// материалы и размеры, build_cellar.py — рецепт генерации) → src/view3d/assets/cellar_props.glb: предметы погреба одним
// файлом, узел на предмет, имя узла = id prop проекта (p_cel_*, src/data/props.ts), extras { size }.
//
//  • Из набора берутся только мелкие модели: 13_storage_shelf (стеллаж с банками), 12_loose_soil_heap (куча рыхлой
//    земли), 11_earth_wall (земляная стенка → оползень у стены). Модули 01–09 (ходы, комнаты, лестница) — нет: по
//    32–66 тыс. треугольников, сетка 1 м и стены 1.7 м — оболочку погреба строит движок по плану комнаты
//    (src/view3d/cellarMesh.ts). 10_timber_support (0.42 × 1.63 м) низок: перемычка на уровне глаз (1.6 м) резала бы
//    камеру — крепь строится здесь по тому же рецепту (стойки 0.065 × 0.09 м, перемычка 0.07 м, цвет Old_wood), но под
//    наши ходы: p_cel_frame — в свету 0.6 м (ход), p_cel_frame_narrow — 0.4 м (щель), низ перемычки 1.78 м.
//  • Мешок p_cel_sack — тоже здесь (цвет Sack набора, в моделях набора мешка нет): тело вращения с неровностью.
//  • Прореживание без meshoptimizer: крошки (мелкие несвязные капли, ≤ 7 см) заменяются октаэдрами (8 треугольников) и
//    остаются только самые крупные (maxCrumbs); крупные части (капля кучи, бугристый брус стенки) — как есть. Всё, что
//    ниже пола, прижато к y = 0, лежащие на полу треугольники выброшены. Нормали — сглаженные (излом > 80° — резкий).
//  • Цвета: Babylon кладёт baseColorFactor в diffuseColor без гаммы (src/view3d/propModels.ts) — цвета набора (линейные
//    0.016–0.28) были бы чёрными; здесь они переведены в гамму (c^(1/2.2)). Свечения нет (emissive 0: светящийся предмет
//    в propModels.ts — без света сцены, а в погребе света нет). Имена материалов — с префиксом cel_ (кэш материалов
//    PropModels — по имени, общий для всех наборов).
//  • Ось и «перед»: перед предмета смотрит на −Z (glTF; болванка мебели — src/blockout/babylon.ts, «перед = −Z
//    локально»), центр — по габариту на плане (x, z), низ — на полу (y = 0). Оползень наклонён верхом назад (+Z) — к
//    стене, у которой стоит.
//
//   node tools/optimize-cellar.mjs [папка earth-cellar-3d]
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, quantize, weld } from '@gltf-transform/functions';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
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

// ───────── материалы набора (manifest.json): линейный цвет → гамма ─────────
const manifest = JSON.parse(readFileSync(`${src}/manifest.json`, 'utf8'));
const MAT_SRC = new Map(manifest.materials.map((m) => [m.name, m]));

// квантование пишет KHR_mesh_quantization — расширения нужно зарегистрировать
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene('cellar_props');
doc.getRoot().setDefaultScene(scene);

const gamma = (c) => Math.pow(Math.max(0, Math.min(1, c)), 1 / 2.2);
const mats = new Map();
function material(name) {
  if (mats.has(name)) return mats.get(name);
  const m = MAT_SRC.get(name);
  if (!m) throw new Error(`нет материала ${name} в manifest.json`);
  const out = doc.createMaterial(`cel_${name.toLowerCase()}`)
    .setBaseColorFactor([...m.color.map(gamma), 1])
    .setMetallicFactor(0)
    .setRoughnessFactor(m.roughness ?? 1)
    .setEmissiveFactor([0, 0, 0])
    .setDoubleSided(false);
  mats.set(name, out);
  return out;
}

// ───────── треугольники: { mat, p: [x0,y0,z0, x1,y1,z1, x2,y2,z2] } ─────────

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
    return { mat: t.mat, p };
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
    out.push({ mat: t.mat, p });
  }
  return out;
}

function cross(p) {
  const ux = p[3] - p[0], uy = p[4] - p[1], uz = p[5] - p[2];
  const vx = p[6] - p[0], vy = p[7] - p[1], vz = p[8] - p[2];
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}
const area = (p) => Math.hypot(...cross(p)) / 2;

function bounds(tris) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) for (let j = 0; j < 9; j++) (lo[j % 3] = Math.min(lo[j % 3], t.p[j])), (hi[j % 3] = Math.max(hi[j % 3], t.p[j]));
  return { lo, hi };
}

/** Центр по плану (x, z), низ на y = 0. */
function center(tris) {
  const { lo, hi } = bounds(tris);
  const dx = -(lo[0] + hi[0]) / 2, dy = -lo[1], dz = -(lo[2] + hi[2]) / 2;
  return tris.map((t) => ({ mat: t.mat, p: t.p.map((v, j) => v + [dx, dy, dz][j % 3]) }));
}

// ───────── процедурные: крепь и мешок ─────────

/** Бокс (центр, размер) — 12 треугольников наружу. */
function box(mat, c, s) {
  const h = s.map((v) => v / 2);
  const P = (sx, sy, sz) => [c[0] + sx * h[0], c[1] + sy * h[1], c[2] + sz * h[2]];
  const quads = [
    [P(1, -1, -1), P(1, 1, -1), P(1, 1, 1), P(1, -1, 1)],
    [P(-1, -1, 1), P(-1, 1, 1), P(-1, 1, -1), P(-1, -1, -1)],
    [P(-1, 1, -1), P(-1, 1, 1), P(1, 1, 1), P(1, 1, -1)],
    [P(-1, -1, 1), P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1)],
    [P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)],
    [P(1, -1, -1), P(-1, -1, -1), P(-1, 1, -1), P(1, 1, -1)],
  ];
  return quads.flatMap(([a, b, d, e]) => [{ mat, p: [...a, ...b, ...d] }, { mat, p: [...a, ...d, ...e] }]);
}

/** Крепь по рецепту набора (portal в build_cellar.py): две стойки 0.065 × 0.09 по краям прохода в свету clear (их
 *  внутренние грани — по стенам хода), перемычка 0.07 × 0.10 шире прохода на 0.14; низ перемычки — lintel. */
function frame(clear, lintel = 1.78) {
  const top = lintel + 0.035;
  const out = [];
  for (const side of [-1, 1]) out.push(...box('Old_wood', [side * (clear / 2 + 0.0325), top / 2, 0], [0.065, top, 0.09]));
  out.push(...box('Old_wood', [0, top, 0], [clear + 0.14, 0.07, 0.1]));
  return out;
}

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

/** Мешок: тело вращения (профиль r(y)), сплюснут спереди-назад, неровный; перевязка горловины — тёмная полоса. */
function sack() {
  const R = rng(1729);
  const prof = [[0.15, 0], [0.19, 0.05], [0.205, 0.15], [0.2, 0.26], [0.17, 0.36], [0.11, 0.44], [0.055, 0.5], [0.045, 0.53], [0.05, 0.56], [0.075, 0.6], [0.05, 0.635], [0, 0.645]];
  const seg = 12;
  const jit = prof.map(() => Array.from({ length: seg }, () => 1 + (R() - 0.5) * 0.12));
  const v = (k, i) => {
    const a = (2 * Math.PI * (i % seg)) / seg;
    const r = prof[k][0] * jit[k][i % seg];
    return [Math.cos(a) * r, prof[k][1], Math.sin(a) * r * 0.75];
  };
  const out = [];
  for (let k = 0; k + 1 < prof.length; k++) {
    const mat = k >= 6 && k <= 7 ? 'Wood_end' : 'Sack';
    for (let i = 0; i < seg; i++) {
      const a = v(k, i), b = v(k, i + 1), c = v(k + 1, i + 1), d = v(k + 1, i);
      out.push({ mat, p: [...a, ...c, ...b] }, { mat, p: [...a, ...d, ...c] });
    }
  }
  return out;
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
  const byMat = new Map();
  tris.forEach((t, i) => {
    if (!byMat.has(t.mat)) byMat.set(t.mat, { p: [], n: [] });
    const d = byMat.get(t.mat);
    d.p.push(...t.p);
    d.n.push(...ns[i]);
  });
  const mesh = doc.createMesh(id);
  for (const [mat, d] of [...byMat].sort(([a], [b]) => a.localeCompare(b))) {
    const n = d.p.length / 3;
    mesh.addPrimitive(doc.createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(d.p)).setBuffer(buffer))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(d.n)).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(n > 65535 ? Uint32Array.from({ length: n }, (_, i) => i) : Uint16Array.from({ length: n }, (_, i) => i)).setBuffer(buffer))
      .setMaterial(material(mat)));
  }
  const { lo, hi } = bounds(tris);
  const size = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]].map((v) => +v.toFixed(3));
  scene.addChild(doc.createNode(id).setMesh(mesh).setExtras({ size }));
  const ok = tris.length <= MAX_TRIS ? '' : `  ← больше ${MAX_TRIS}!`;
  console.log(`  ${id.padEnd(20)} ${size.join(' × ').padEnd(22)} м, треугольников ${String(tris.length).padStart(4)}${note ? `  (${note})` : ''}${ok}`);
  return tris.length;
}

const shelf = await readTris('13_storage_shelf');
const heap = await readTris('12_loose_soil_heap');
const wall = await readTris('11_earth_wall');

const report = (src, d) => `из ${src.length}: крошек ${d.crumbs} → ${d.kept} октаэдров`;
let total = 0;
total += addProp('p_cel_shelf', center(onFloor(shelf)), `как в наборе, ${shelf.length}`);
{
  const d = decimate(heap, 200);
  total += addProp('p_cel_heap', center(onFloor(d.tris)), report(heap, d));
}
{
  const d = decimate(heap, 90);
  total += addProp('p_cel_heap_small', center(onFloor(transform(d.tris, { s: 0.55 }))), report(heap, d) + ', ×0.55');
}
{
  const d = decimate(wall, 170);
  total += addProp('p_cel_slump', center(onFloor(transform(d.tris, { tilt: 6 }))), report(wall, d) + ', наклон 6° к стене');
}
total += addProp('p_cel_frame', center(frame(0.6)), 'крепь хода: в свету 0.6 м, перемычка 1.78 м');
total += addProp('p_cel_frame_narrow', center(frame(0.4)), 'крепь щели: в свету 0.4 м');
total += addProp('p_cel_sack', center(onFloor(sack())), 'мешок');

await doc.transform(
  weld(),
  dedup(),
  // атрибуты не трогать: у примитивов узла один набор (POSITION, NORMAL) — Babylon сливает их в один меш
  prune({ keepAttributes: true }),
  quantize(),
);
await io.write(outGlb, doc);
console.log(`→ ${outGlb}: ${(statSync(outGlb).size / 1024).toFixed(0)} КБ, треугольников всего ${total}`);
