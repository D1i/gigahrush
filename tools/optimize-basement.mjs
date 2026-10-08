// Набор подвала пользователя (basement-3d-glb-blend.zip → basement-3d/glb/*.glb, textures/*.png) → ассеты проекта:
//
//  • src/view3d/assets/basement_props.glb — мебель и детали подвала одним файлом: узел на предмет, имя узла = id
//    prop проекта (p_bsm_*, src/data/props.ts). Мировые трансформы запекаются в вершины, примитивы сливаются по
//    материалу. Ось и «перед»: в ассете перед предмета смотрит на +Z (glTF; в Blender −Y) — здесь поворот на 180°,
//    чтобы перед смотрел на −Z, как у болванки мебели (src/blockout/babylon.ts: «перед = −Z локально»). Центр — по
//    габариту на плане (x, z), низ — на полу (y = 0). Подвесные (ceil) — верх в y = 0: адаптер вешает их под потолок.
//    Трубы и рейки — повёрнуты вдоль X (ставятся вдоль стены). Лампочка светится (emissive).
//  • src/data/assets/basement/*.jpg — шесть текстур отделок подвала (бесшовные, 512 px): кирпич с побелкой, пыльный
//    бетон, синяя облупленная штукатурка, старые доски, сырой бетон, вода (src/data/finishes.ts).
//
// Текстуры мебели — WebP 512 px (EXT_texture_webp), геометрия — квантование (KHR_mesh_quantization).
//
//   node tools/optimize-basement.mjs [папка basement-3d]
//
// По умолчанию вход — tmp/basement-3d (распакуйте туда архив пользователя).
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, quantize, textureCompress, weld } from '@gltf-transform/functions';
import sharp from 'sharp';
import { mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = resolve(process.argv[2] ?? 'tmp/basement-3d');
const outGlb = fileURLToPath(new URL('../src/view3d/assets/basement_props.glb', import.meta.url));
const outTex = fileURLToPath(new URL('../src/data/assets/basement/', import.meta.url));
mkdirSync(fileURLToPath(new URL('../src/view3d/assets/', import.meta.url)), { recursive: true });
mkdirSync(outTex, { recursive: true });

/** id prop → файл набора и правка: rot — доп. поворот вокруг Y, град (после разворота «перед → −Z»); ceil — подвесной;
 *  keep — не центровать (пивот ассета уже в центре корпуса: у открытого шкафа створка торчит вбок). */
const PROPS = [
  ['p_bsm_shelf_wood', 'shelf_wood'],
  ['p_bsm_shelf_jars', 'shelf_preserves'],
  ['p_bsm_shelf_metal', 'shelf_metal_rusted'],
  ['p_bsm_cabinet', 'cabinet_open', { keep: true }],
  ['p_bsm_locker', 'locker_metal'],
  ['p_bsm_workbench', 'workbench'],
  ['p_bsm_crate', 'crate_wood'],
  ['p_bsm_box', 'cardboard_box'],
  ['p_bsm_chair', 'chair_wood'],
  ['p_bsm_seats', 'cinema_seats_3'],
  ['p_bsm_radiator', 'radiator_8'],
  ['p_bsm_pipe', 'pipe_straight_2m', { rot: 90 }],
  ['p_bsm_pipe_high', 'pipe_straight_2m', { rot: 90, ceil: true }],
  ['p_bsm_valve', 'pipe_valve', { rot: 90 }],
  ['p_bsm_bulb', 'ceiling_bulb', { ceil: true }],
  ['p_bsm_rubble', 'rubble_cluster'],
  ['p_bsm_litter', 'litter_cluster'],
  ['p_bsm_trash', 'trash_bag'],
  ['p_bsm_puddle', 'puddle_irregular'],
  ['p_bsm_water', 'water_tile_2x2'],
  ['p_bsm_plank', 'loose_plank', { rot: 90 }],
  ['p_bsm_jar', 'jar_glass'],
  ['p_bsm_bottle', 'bottle_plastic'],
  ['p_bsm_slats', 'partition_slats_2m', { rot: 90 }],
  ['p_bsm_pillar', 'pillar_032'],
  ['p_bsm_door', 'door_plank_075'],
  ['p_bsm_stairs', 'stairs_5_steps'],
];

/** Текстуры отделок: файл набора → имя в проекте. */
const TEX = [
  ['01_dry_limewash_brick', 'brick_limewash'],
  ['02_dry_dusty_concrete', 'concrete_dusty'],
  ['03_abandoned_blue_plaster', 'plaster_blue'],
  ['04_abandoned_old_wood', 'wood_old'],
  ['05_flooded_damp_concrete', 'concrete_damp'],
  ['06_flooded_water_surface', 'water'],
];

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene('basement_props');
doc.getRoot().setDefaultScene(scene);

// ───────── материалы: один на имя (у файлов набора одинаковые: wood, rust, steel…), текстуры — по имени картинки ─────────
const mats = new Map();
const texs = new Map();
function material(m) {
  const name = m.getName();
  if (mats.has(name)) return mats.get(name);
  const out = doc.createMaterial(name)
    .setBaseColorFactor(m.getBaseColorFactor())
    .setMetallicFactor(m.getMetallicFactor())
    .setRoughnessFactor(m.getRoughnessFactor())
    .setEmissiveFactor(m.getEmissiveFactor())
    .setDoubleSided(m.getDoubleSided())
    .setAlphaMode(m.getAlphaMode());
  const t = m.getBaseColorTexture();
  if (t) {
    const key = t.getName() || t.getURI() || name;
    if (!texs.has(key)) texs.set(key, doc.createTexture(key).setImage(t.getImage()).setMimeType(t.getMimeType()));
    out.setBaseColorTexture(texs.get(key));
  }
  // лампочка светится: тёплый накал
  if (name === 'bulb') out.setEmissiveFactor([1, 0.72, 0.38]);
  mats.set(name, out);
  return out;
}

// ───────── матрицы (column-major 4×4, как в glTF) ─────────
const mul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
const rotY = (deg) => {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
};
const det3 = (m) => m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);

/** Все треугольники файла в системе R · world: material → { p, n, uv }. */
function bake(file, R) {
  const bucket = new Map();
  for (const n of file.getRoot().listNodes()) {
    const mesh = n.getMesh();
    if (!mesh) continue;
    const M = mul(R, n.getWorldMatrix());
    const flip = det3(M) < 0;
    for (const prim of mesh.listPrimitives()) {
      const P = prim.getAttribute('POSITION'), Nn = prim.getAttribute('NORMAL'), U = prim.getAttribute('TEXCOORD_0');
      const idx = prim.getIndices();
      const count = idx ? idx.getCount() : P.getCount();
      const mat = material(prim.getMaterial());
      if (!bucket.has(mat)) bucket.set(mat, { p: [], n: [], uv: [] });
      const out = bucket.get(mat);
      const vert = (k) => {
        const i = idx ? idx.getScalar(k) : k;
        const v = P.getElement(i, [0, 0, 0]);
        const w = Nn ? Nn.getElement(i, [0, 0, 0]) : [0, 1, 0];
        // поворот и перенос — без масштаба (у набора его нет): нормали — той же 3×3
        const nx = M[0] * w[0] + M[4] * w[1] + M[8] * w[2], ny = M[1] * w[0] + M[5] * w[1] + M[9] * w[2], nz = M[2] * w[0] + M[6] * w[1] + M[10] * w[2];
        const l = Math.hypot(nx, ny, nz) || 1;
        return {
          p: [M[0] * v[0] + M[4] * v[1] + M[8] * v[2] + M[12], M[1] * v[0] + M[5] * v[1] + M[9] * v[2] + M[13], M[2] * v[0] + M[6] * v[1] + M[10] * v[2] + M[14]],
          n: [nx / l, ny / l, nz / l],
          uv: U ? U.getElement(i, [0, 0]) : [0, 0],
        };
      };
      for (let k = 0; k + 2 < count; k += 3) {
        const tri = flip ? [vert(k), vert(k + 2), vert(k + 1)] : [vert(k), vert(k + 1), vert(k + 2)];
        for (const v of tri) {
          out.p.push(...v.p);
          out.n.push(...v.n);
          out.uv.push(...v.uv);
        }
      }
    }
  }
  return bucket;
}

/** Сдвинуть вершины ведра. */
function shift(bucket, dx, dy, dz) {
  for (const d of bucket.values()) for (let i = 0; i < d.p.length; i += 3) (d.p[i] += dx), (d.p[i + 1] += dy), (d.p[i + 2] += dz);
}

function bounds(bucket) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const d of bucket.values()) for (let i = 0; i < d.p.length; i += 3) for (let k = 0; k < 3; k++) (lo[k] = Math.min(lo[k], d.p[i + k])), (hi[k] = Math.max(hi[k], d.p[i + k]));
  return { lo, hi };
}

const cache = new Map();
for (const [id, file, o = {}] of PROPS) {
  if (!cache.has(file)) cache.set(file, await io.read(`${src}/glb/${file}.glb`));
  const b = bake(cache.get(file), rotY(180 + (o.rot ?? 0)));
  let { lo, hi } = bounds(b);
  if (!o.keep) shift(b, -(lo[0] + hi[0]) / 2, 0, -(lo[2] + hi[2]) / 2);
  if (o.ceil) shift(b, 0, -hi[1], 0);
  ({ lo, hi } = bounds(b));
  const mesh = doc.createMesh(id);
  let tris = 0;
  for (const [mat, d] of b) {
    const n = d.p.length / 3;
    if (!n) continue;
    tris += n / 3;
    mesh.addPrimitive(doc.createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(d.p)).setBuffer(buffer))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(d.n)).setBuffer(buffer))
      .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(d.uv)).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(n > 65535 ? Uint32Array.from({ length: n }, (_, i) => i) : Uint16Array.from({ length: n }, (_, i) => i)).setBuffer(buffer))
      .setMaterial(mat));
  }
  const size = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]].map((v) => +v.toFixed(3));
  scene.addChild(doc.createNode(id).setMesh(mesh).setExtras({ size, ceil: !!o.ceil }));
  console.log(`  ${id.padEnd(20)} ${file.padEnd(20)} ${size.join(' × ')} м, треугольников ${tris}`);
}

await doc.transform(
  weld(),
  dedup(),
  // атрибуты не трогать: у примитивов узла один набор (POSITION, NORMAL, TEXCOORD_0) — Babylon сливает их в один меш
  prune({ keepAttributes: true }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [512, 512], quality: 80 }),
  quantize(),
);
await io.write(outGlb, doc);
console.log(`→ ${outGlb}: ${(statSync(outGlb).size / 1024).toFixed(0)} КБ`);

for (const [file, name] of TEX) {
  const out = `${outTex}${name}.jpg`;
  await sharp(`${src}/textures/${file}.png`).resize(512, 512).jpeg({ quality: 80, mozjpeg: true }).toFile(out);
  console.log(`→ ${out}: ${(statSync(out).size / 1024).toFixed(0)} КБ`);
}
