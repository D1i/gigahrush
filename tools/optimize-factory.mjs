// Набор пользователя «завод → болото» (factory-to-swamp-glb-blend.zip → factory-3d/glb/*.glb) → модели биома «Завод»
// и сцены финала «Болото на крыше»: src/view3d/assets/factory_props.glb.
//
//  • Узел на предмет, имя узла = id prop проекта (p_fac_*, src/data/props.ts), как у подвала (optimize-basement.mjs):
//    мировые трансформы запекаются в вершины, примитивы сливаются по материалу; перед предмета смотрит на −Z (в наборе —
//    на +Z: поворот на 180°), центр — по габариту на плане, низ — на полу; подвесные (ceil) — верх в y = 0.
//  • Высота стен «Прогулки» — 2.5 м: высокие модели уменьшены (scale) — печь, таль, пресс, сухое дерево.
//  • Подвижные узлы набора (manifest.json → moving_nodes: шестерни, маховик, вал, вентилятор, ролики конвейера, пресс,
//    дверца печи, ковш, таль, поршень насоса, поворотный круг, шлагбаум, вентиль, капли) — дочерние узлы предмета
//    (`<id>:<k>`) со своим мешем в той же системе (поза покоя) и движением в extras.anim — как двигать меш относительно
//    покоя (в системе предмета, glTF):
//      { spin: [ax, ay, az], pivot: [x, y, z], turns, period } — равномерное вращение вокруг оси через точку;
//      { period, n, p: [x, y, z]×n, q: [x, y, z, w]×n, s?: [x, y, z]×n } — n выборок за период (линейно, сферически).
//    Движок (src/view3d/propAnim.ts) крутит клоны этих мешей; клипы glTF не сохраняются.
//  • Детали, которых нет в наборе, — из примитивов: двутавровая колонна у стены, лампа-«тарелка» под потолком (светится).
//  • Текстуры — WebP 512 px, геометрия — квантование.
//
//   node tools/optimize-factory.mjs [папка factory-3d]
//
// По умолчанию вход — tmp/factory/factory-3d (распакуйте туда архив пользователя).
import { Document, MathUtils, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, quantize, textureCompress, weld } from '@gltf-transform/functions';
import sharp from 'sharp';
import { mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = resolve(process.argv[2] ?? 'tmp/factory/factory-3d');
const outGlb = fileURLToPath(new URL('../src/view3d/assets/factory_props.glb', import.meta.url));
mkdirSync(fileURLToPath(new URL('../src/view3d/assets/', import.meta.url)), { recursive: true });

/** id prop → файл набора и правка: rot — доп. поворот вокруг Y, град (после «перед → −Z»); ceil — подвесной; scale;
 *  flip — вверх ногами (перевёрнутое болото: камыш и грязь свисают с потолка). */
const PROPS = [
  // ── машинный цех: всё крутится ──
  ['p_fac_gear_large', 'gear_large_24T'],
  ['p_fac_gear_small', 'gear_small_12T'],
  ['p_fac_gear_pair', 'gear_pair_24T_12T'],
  ['p_fac_flywheel', 'flywheel'],
  ['p_fac_shaft', 'shaft_bearing_2m'],
  ['p_fac_fan', 'ventilation_fan'],
  ['p_fac_conveyor', 'roller_conveyor_3m', { rot: 90 }],
  ['p_fac_press', 'hydraulic_press', { scale: 0.9 }],
  ['p_fac_pump', 'reciprocating_pump'],
  ['p_fac_platform', 'rotating_platform'],
  ['p_fac_gate', 'swing_gate'],
  // ── сталелитейка ──
  ['p_fac_furnace', 'smelting_furnace', { scale: 0.64 }],
  ['p_fac_ladle', 'tilting_ladle'],
  ['p_fac_mold', 'casting_mold'],
  ['p_fac_hoist', 'gantry_hoist', { scale: 0.6 }],
  // ── трубы и течь ──
  ['p_fac_pipe', 'pipe_3m', { rot: 90, ceil: true }],
  ['p_fac_valve', 'pipe_valve_animated', { rot: 90 }],
  ['p_fac_leak', 'leaking_pipe', { ceil: true }],
  // ── прочее цеха ──
  ['p_fac_barrel', 'rust_barrel'],
  ['p_fac_scrap', 'scrap_heap'],
  ['p_fac_railing', 'railing_2m', { rot: 90 }],
  ['p_fac_walkway', 'steel_walkway_2m'],
  ['p_fac_stairs', 'industrial_stairs'],
  // ── болото ──
  ['p_fac_water', 'swamp_water_4x4'],
  ['p_fac_mud', 'mud_island'],
  ['p_fac_reeds', 'reeds_cluster'],
  ['p_fac_tree', 'dead_tree', { scale: 0.8 }],
  ['p_fac_boardwalk', 'swamp_boardwalk_2m'],
  // ── перевёрнутое болото: свисает с потолка мокрых цехов (финал — вверх, в болото над головой)
  ['p_fac_reeds_hang', 'reeds_cluster', { flip: true, ceil: true, scale: 0.75 }],
  ['p_fac_mud_hang', 'mud_island', { flip: true, ceil: true, scale: 0.8 }],
];

/** Сколько выборок движения за период (у неравномерных: пресс, капли, ковш…). */
const SAMPLES = 32;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene('factory_props');
doc.getRoot().setDefaultScene(scene);

// ───────── материалы: один на имя (у файлов набора одинаковые: rust, steel, darksteel…) ─────────
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
  mats.set(name, out);
  return out;
}
function plainMaterial(name, color, emissive = [0, 0, 0]) {
  if (mats.has(name)) return mats.get(name);
  const out = doc.createMaterial(name).setBaseColorFactor([...color, 1]).setMetallicFactor(0.6).setRoughnessFactor(0.6).setEmissiveFactor(emissive);
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
const rotX = (deg) => {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
};
const scaleM = (k) => [k, 0, 0, 0, 0, k, 0, 0, 0, 0, k, 0, 0, 0, 0, 1];
const transM = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
const det3 = (m) => m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
function invert(m) {
  const inv = new Array(16);
  inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
  inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
  inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
  inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
  inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
  inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
  inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
  inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
  inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
  inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
  inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
  inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
  inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
  inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
  inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
  inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];
  const det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
  return inv.map((v) => v / det);
}

// ───────── анимация glTF: значение канала в момент t ─────────
const nlerpQ = (a, b, k) => {
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const s = d < 0 ? -1 : 1;
  const q = [0, 1, 2, 3].map((i) => a[i] * (1 - k) + s * b[i] * k);
  const l = Math.hypot(...q) || 1;
  return q.map((v) => v / l);
};
function sampleChannel(ch, t) {
  const s = ch.getSampler();
  const inp = s.getInput().getArray(), out = s.getOutput().getArray();
  const k = s.getOutput().getElementSize();
  const at = (i) => Array.from(out.slice(i * k, i * k + k));
  if (t <= inp[0]) return at(0);
  if (t >= inp[inp.length - 1]) return at(inp.length - 1);
  let i = 0;
  while (i + 1 < inp.length && inp[i + 1] < t) i++;
  const f = (t - inp[i]) / Math.max(1e-9, inp[i + 1] - inp[i]);
  if (s.getInterpolation() === 'STEP') return at(i);
  const a = at(i), b = at(i + 1);
  return ch.getTargetPath() === 'rotation' ? nlerpQ(a, b, f) : a.map((v, j) => v * (1 - f) + b[j] * f);
}

/** Мировая матрица узла при текущих TRS (своя, без кэша: TRS меняются по ходу выборки). */
function worldOf(n) {
  let m = n.getMatrix();
  for (let p = n.getParentNode(); p; p = p.getParentNode()) m = mul(p.getMatrix(), m);
  return m;
}

/** Узлы под node (включая), кроме поддеревьев stop. */
function* subtree(node, stop) {
  yield node;
  for (const c of node.listChildren()) if (!stop.has(c)) yield* subtree(c, stop);
}

/** Капли течи: в наборе — материал болотной воды с текстурой, а UV у капель нулевые (один тёмный тексель) — свой
 *  светлый материал со свечением (PropModels рисует его без света сцены), чтобы капли в тёмном цеху блестели. */
const isDrop = (n) => /^droplet_/.test(n.getName());

/** Треугольники узлов nodes в системе R · world (покой): material → { p, n, uv }. */
function bake(nodes, R, bucket = new Map()) {
  for (const n of nodes) {
    const mesh = n.getMesh();
    if (!mesh) continue;
    const M = mul(R, n.getWorldMatrix());
    const flip = det3(M) < 0;
    for (const prim of mesh.listPrimitives()) {
      const P = prim.getAttribute('POSITION'), Nn = prim.getAttribute('NORMAL'), U = prim.getAttribute('TEXCOORD_0');
      const idx = prim.getIndices();
      const count = idx ? idx.getCount() : P.getCount();
      const mat = isDrop(n) ? plainMaterial('drop', [0.55, 0.66, 0.72], [0.42, 0.52, 0.6]) : material(prim.getMaterial());
      if (!bucket.has(mat)) bucket.set(mat, { p: [], n: [], uv: [] });
      const out = bucket.get(mat);
      const vert = (k) => {
        const i = idx ? idx.getScalar(k) : k;
        const v = P.getElement(i, [0, 0, 0]);
        const w = Nn ? Nn.getElement(i, [0, 0, 0]) : [0, 1, 0];
        // нормали — той же 3×3 (масштаб равномерный — после нормировки верно)
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

function shift(bucket, dx, dy, dz) {
  for (const d of bucket.values()) for (let i = 0; i < d.p.length; i += 3) (d.p[i] += dx), (d.p[i + 1] += dy), (d.p[i + 2] += dz);
}

function bounds(buckets) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const b of buckets) for (const d of b.values()) for (let i = 0; i < d.p.length; i += 3) for (let k = 0; k < 3; k++) (lo[k] = Math.min(lo[k], d.p[i + k])), (hi[k] = Math.max(hi[k], d.p[i + k]));
  return { lo, hi };
}

function meshOf(name, bucket) {
  const mesh = doc.createMesh(name);
  let tris = 0;
  for (const [mat, d] of bucket) {
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
  return { mesh, tris };
}

const r5 = (v) => Math.round(v * 1e5) / 1e5;

/**
 * Движение подвижного узла: D(t) = A · W(t) · W(0)⁻¹ · A⁻¹ (A — перенос в систему предмета: поворот, масштаб, сдвиг),
 * т. е. как сдвинуть его меш из покоя. Только вращение с постоянной осью и скоростью — spin, иначе выборки.
 */
function motionOf(node, anim, A) {
  const chans = anim.listChannels();
  const period = Math.max(...chans.map((c) => c.getSampler().getInput().getArray().at(-1))) - Math.min(...chans.map((c) => c.getSampler().getInput().getArray()[0]));
  const t0 = Math.min(...chans.map((c) => c.getSampler().getInput().getArray()[0]));
  const rest = new Map(chans.map((c) => [c.getTargetNode(), { t: c.getTargetNode().getTranslation(), r: c.getTargetNode().getRotation(), s: c.getTargetNode().getScale() }]));
  const W0 = worldOf(node);
  const Ainv = invert(A);
  const at = (t) => {
    for (const c of chans) {
      const n = c.getTargetNode(), v = sampleChannel(c, t0 + t);
      if (c.getTargetPath() === 'translation') n.setTranslation(v);
      else if (c.getTargetPath() === 'rotation') n.setRotation(v);
      else if (c.getTargetPath() === 'scale') n.setScale(v);
    }
    const D = mul(mul(A, mul(worldOf(node), invert(W0))), Ainv);
    for (const [n, r] of rest) n.setTranslation(r.t).setRotation(r.r).setScale(r.s);
    return D;
  };
  const own = chans.filter((c) => c.getTargetNode() === node);
  const onlyRot = own.length === chans.length && own.every((c) => c.getTargetPath() === 'rotation');
  const n = SAMPLES;
  const ps = [], qs = [], ss = [];
  let scaled = false;
  for (let k = 0; k < n; k++) {
    const D = at((k / n) * period);
    const p = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1];
    MathUtils.decompose(D, p, q, s);
    ps.push(p);
    qs.push(q);
    ss.push(s);
    if (s.some((v) => Math.abs(v - 1) > 1e-4)) scaled = true;
  }
  if (onlyRot && !scaled) {
    // ось — по первой заметной выборке, обороты — сумма углов между соседними (со знаком вдоль оси)
    const fine = 240;
    let axis = null, total = 0;
    let prev = at(0);
    for (let k = 1; k <= fine; k++) {
      const D = at((k / fine) * period - (k === fine ? 1e-6 : 0));
      const rel = mul(D, invert(prev));
      const q = [0, 0, 0, 1];
      MathUtils.decompose(rel, [0, 0, 0], q, [1, 1, 1]);
      const ang = 2 * Math.atan2(Math.hypot(q[0], q[1], q[2]), q[3]);
      if (ang > 1e-6) {
        const ax = [q[0], q[1], q[2]].map((v) => v / Math.hypot(q[0], q[1], q[2]));
        if (!axis) axis = ax;
        const sgn = Math.sign(ax[0] * axis[0] + ax[1] * axis[1] + ax[2] * axis[2]) || 1;
        total += sgn * (ang > Math.PI ? ang - 2 * Math.PI : ang);
      }
      prev = D;
    }
    const turns = total / (2 * Math.PI);
    if (axis && Math.abs(turns - Math.round(turns)) < 0.02 && Math.round(turns) !== 0) {
      // точка на оси: D(t)·c = c — из выборки на четверти оборота: (I − R)·c = p
      const D = at(period / (4 * Math.abs(Math.round(turns))));
      const M3 = [[1 - D[0], -D[4], -D[8]], [-D[1], 1 - D[5], -D[9]], [-D[2], -D[6], 1 - D[10]]];
      const rhs = [D[12], D[13], D[14]];
      // наименьшие квадраты: (MᵀM + εI) c = Mᵀ p (матрица вырождена вдоль оси — ε держит c ближе к началу)
      const MtM = [0, 1, 2].map((i) => [0, 1, 2].map((j) => M3[0][i] * M3[0][j] + M3[1][i] * M3[1][j] + M3[2][i] * M3[2][j] + (i === j ? 1e-6 : 0)));
      const Mtp = [0, 1, 2].map((i) => M3[0][i] * rhs[0] + M3[1][i] * rhs[1] + M3[2][i] * rhs[2]);
      const c = solve3(MtM, Mtp);
      return { spin: axis.map(r5), pivot: c.map(r5), turns: Math.round(turns), period: r5(period) };
    }
  }
  return {
    period: r5(period),
    n,
    p: ps.flat().map(r5),
    q: qs.flat().map(r5),
    ...(scaled ? { s: ss.flat().map(r5) } : {}),
  };
}

function solve3(A, b) {
  const m = A.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < 3; i++) {
    let p = i;
    for (let r = i + 1; r < 3; r++) if (Math.abs(m[r][i]) > Math.abs(m[p][i])) p = r;
    [m[i], m[p]] = [m[p], m[i]];
    for (let r = 0; r < 3; r++) {
      if (r === i) continue;
      const f = m[r][i] / m[i][i];
      for (let c = i; c < 4; c++) m[r][c] -= f * m[i][c];
    }
  }
  return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
}

const cache = new Map();
for (const [id, file, o = {}] of PROPS) {
  if (!cache.has(file)) cache.set(file, await io.read(`${src}/glb/${file}.glb`));
  const part = cache.get(file);
  const root = part.getRoot();
  const anims = root.listAnimations();
  // подвижные узлы — цели каналов анимации (по одному клипу на узел или общий клип)
  const moving = [...new Set(anims.flatMap((a) => a.listChannels().map((c) => c.getTargetNode())))];
  const stop = new Set(moving);
  const tops = root.listScenes()[0].listChildren();
  let R = mul(rotY(180 + (o.rot ?? 0)), mul(o.flip ? rotX(180) : scaleM(1), scaleM(o.scale ?? 1)));
  const staticB = bake(tops.flatMap((t) => [...subtree(t, stop)]), R);
  const movB = moving.map((m) => bake([...subtree(m, new Set(moving.filter((x) => x !== m)))], R));
  let { lo, hi } = bounds([staticB, ...movB]);
  const dx = -(lo[0] + hi[0]) / 2, dz = -(lo[2] + hi[2]) / 2;
  const dy = o.ceil ? -hi[1] : 0;
  for (const b of [staticB, ...movB]) shift(b, dx, dy, dz);
  R = mul(transM(dx, dy, dz), R);
  ({ lo, hi } = bounds([staticB, ...movB]));
  const { mesh, tris } = meshOf(id, staticB);
  const size = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]].map((v) => +v.toFixed(3));
  const node = doc.createNode(id).setExtras({ size, ceil: !!o.ceil });
  if (mesh.listPrimitives().length) node.setMesh(mesh);
  let movTris = 0;
  const kinds = [];
  moving.forEach((m, k) => {
    const anim = anims.find((a) => a.listChannels().some((c) => c.getTargetNode() === m));
    const r = meshOf(`${id}:${k}`, movB[k]);
    if (!r.mesh.listPrimitives().length) return;
    movTris += r.tris;
    const motion = motionOf(m, anim, R);
    kinds.push(motion.spin ? `${m.getName()} ×${motion.turns}` : `${m.getName()} ~`);
    node.addChild(doc.createNode(`${id}:${k}`).setMesh(r.mesh).setExtras({ anim: motion, from: m.getName() }));
  });
  scene.addChild(node);
  console.log(`  ${id.padEnd(18)} ${file.padEnd(22)} ${size.join(' × ').padEnd(22)} м, треугольников ${tris + movTris}${kinds.length ? ` · ${kinds.join(', ')}` : ''}`);
}

// ───────── детали из примитивов ─────────

/** Ведро из коробок [x0, y0, z0, x1, y1, z1] одного материала. */
function boxes(mat, list, bucket = new Map()) {
  if (!bucket.has(mat)) bucket.set(mat, { p: [], n: [], uv: [] });
  const out = bucket.get(mat);
  for (const [x0, y0, z0, x1, y1, z1] of list) {
    const faces = [
      [[1, 0, 0], [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]]],
      [[-1, 0, 0], [[x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0]]],
      [[0, 1, 0], [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]]],
      [[0, -1, 0], [[x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1]]],
      [[0, 0, 1], [[x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [x0, y0, z1]]],
      [[0, 0, -1], [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]]],
    ];
    for (const [nrm, q] of faces) {
      for (const i of [0, 1, 2, 0, 2, 3]) {
        out.p.push(...q[i]);
        out.n.push(...nrm);
        out.uv.push(0, 0);
      }
    }
  }
  return bucket;
}

/** Конус-абажур (n граней) от радиуса r0 на y0 до r1 на y1, нормали — наружу. */
function cone(mat, r0, y0, r1, y1, n, bucket) {
  if (!bucket.has(mat)) bucket.set(mat, { p: [], n: [], uv: [] });
  const out = bucket.get(mat);
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * 2 * Math.PI, a1 = ((i + 1) / n) * 2 * Math.PI;
    const P = (r, y, a) => [r * Math.cos(a), y, r * Math.sin(a)];
    const q = [P(r0, y0, a0), P(r0, y0, a1), P(r1, y1, a1), P(r1, y1, a0)];
    const am = (a0 + a1) / 2, slope = (r0 - r1) / Math.max(1e-6, y1 - y0);
    const nl = Math.hypot(1, slope);
    const nrm = [Math.cos(am) / nl, slope / nl, Math.sin(am) / nl];
    for (const i2 of [0, 2, 1, 0, 3, 2]) {
      out.p.push(...q[i2]);
      out.n.push(...nrm);
      out.uv.push(0, 0);
    }
  }
  return bucket;
}

const steel = mats.get('darksteel') ?? plainMaterial('darksteel', [0.16, 0.17, 0.18]);
const yellow = mats.get('yellow') ?? plainMaterial('yellow', [0.75, 0.55, 0.12]);
// двутавр у стены: полки 0.2 м, стенка 0.02, высота 2.5 (до потолка «Прогулки»), перед — к −Z
{
  const H = 2.5;
  const b = boxes(steel, [
    [-0.1, 0, 0.08, 0.1, H, 0.1],
    [-0.1, 0, -0.1, 0.1, H, -0.08],
    [-0.012, 0, -0.08, 0.012, H, 0.08],
  ]);
  boxes(yellow, [[-0.105, 1.0, -0.105, 0.105, 1.08, 0.105]], b);
  const { mesh } = meshOf('p_fac_column', b);
  scene.addChild(doc.createNode('p_fac_column').setMesh(mesh).setExtras({ size: [0.2, H, 0.2], ceil: false }));
  console.log('  p_fac_column       (примитивы)            0.2 × 2.5 × 0.2 м');
}
// лампа-«тарелка» под потолком: шнур, эмалированный абажур, тёплая лампа (светится)
{
  const shade = plainMaterial('lamp_shade', [0.2, 0.26, 0.22]);
  const bulb = plainMaterial('lamp_bulb', [1, 0.8, 0.5], [1, 0.62, 0.3]);
  const b = boxes(steel, [[-0.01, -0.45, -0.01, 0.01, 0, 0.01]]);
  cone(shade, 0.3, -0.62, 0.06, -0.45, 12, b);
  cone(shade, 0.06, -0.45, 0.02, -0.44, 12, b);
  boxes(bulb, [[-0.05, -0.62, -0.05, 0.05, -0.53, 0.05]], b);
  const { mesh } = meshOf('p_fac_lamp', b);
  scene.addChild(doc.createNode('p_fac_lamp').setMesh(mesh).setExtras({ size: [0.6, 0.62, 0.6], ceil: true }));
  console.log('  p_fac_lamp         (примитивы)            0.6 × 0.62 × 0.6 м, светится');
}

await doc.transform(
  weld(),
  dedup(),
  // атрибуты не трогать: у примитивов узла один набор (POSITION, NORMAL, TEXCOORD_0) — Babylon сливает их в один меш
  prune({ keepAttributes: true, keepLeaves: true, keepExtras: true }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [512, 512], quality: 80 }),
  quantize(),
);
await io.write(outGlb, doc);
console.log(`${outGlb}: ${(statSync(outGlb).size / 1024).toFixed(0)} КБ, предметов ${scene.listChildren().length}`);
