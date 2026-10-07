// Ассет «Ржавого лифта» пользователя (rusted_lift_v2_package.zip → rusted_lift_shaft.glb, 16 МБ, 609 мешей) →
// src/locations/assets/lift.glb для сцены src/locations/sceneLift.ts. Геометрия не перестраивается, а
// перекладывается: мировые трансформы запекаются в вершины, меши группы сливаются по материалу, шахта режется по
// высоте на три куска, чтобы собирать её на любое число этажей:
//
//   LIFT_SHAFT_BOTTOM — приямок и этаж 0 (y < 4.2);  LIFT_SHAFT_MID — один этаж (4.2 ≤ y < 8.4, сдвинут к 0),
//   повторяется;  LIFT_SHAFT_TOP — верхний этаж и привод (y ≥ 8.4, сдвинут к 0). Стены, направляющие, трещины,
//   потёки — всё режется по плоскостям y (треугольники клипуются, атрибуты интерполируются).
//   LIFT_LEVEL — проёмы этажа и оба коридора (узлы уровня 4.2 ассета, сдвинуты к 0): FRONT/RIGHT стены у проёмов,
//   NARROW/WIDE коридоры и обрамления.
//   LIFT_CAGE_FRAME — прутья, рейки, углы, решётки, крыша, обрамления проёмов клетки (у каретки — скрыт);
//   LIFT_CAGE_DECK — площадка, подрамник, стропы, проушина, ролики; LIFT_PANEL — пост с кнопками. Начало координат
//   кабины — центр пола (в ассете — y 0 в покое), точка подвеса — y = pivotY.
//   LIFT_BOARD — доска (в своей системе: как узел EVENT_BOARD); LIFT_COUNTERWEIGHT — грузы противовеса;
//   LIFT_LAIR_DOOR — дверь логова (кладка, перемычка, створки, полосы, кольца, табличка) — начало в центре проёма
//   на полу, плоскость двери — x = 0, проход — к −x.
//   Тросы и пыль не переносятся (тросы сцена строит сама, пыль — частицы). Анимация не переносится: из неё взяты
//   только позы доски (extras.boardStart / boardWedge — относительно пола кабины).
//
// Текстуры — WebP (EXT_texture_webp), геометрия — квантование (KHR_mesh_quantization); Babylon 9.29 грузит оба.
//
//   node tools/optimize-lift.mjs [rusted_lift_shaft.glb] [--out файл]
//
// По умолчанию вход — tmp/lift_assets/rusted_lift_shaft.glb (распакуйте туда архив пользователя).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, join, prune, quantize, textureCompress, weld } from '@gltf-transform/functions';
import sharp from 'sharp';
import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--out');
const src = resolve(positional[0] ?? 'tmp/lift_assets/rusted_lift_shaft.glb');
const out = resolve(opt('--out') ?? fileURLToPath(new URL('../src/locations/assets/lift.glb', import.meta.url)));

/** Высота этажа ассета, м. */
const FLOOR = 4.2;
/** Время, когда доска уже застряла (кадр ~92 из 192 при 24 к/с), и когда она ещё не падала. */
const T_WEDGE = 3.9;
const T_START = 2.5;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
const root = doc.getRoot();
const scene = root.listScenes()[0];
const buffer = root.listBuffers()[0];
const top = scene.listChildren();
const topBy = (re) => top.filter((n) => re.test(n.getName()));
const one = (re) => {
  const n = topBy(re)[0];
  if (!n) throw new Error('нет узла ' + re);
  return n;
};

// ───────── матрицы (column-major 4×4, как в glTF) ─────────
const mul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
const inv = (m) => {
  // общий 4×4 (аффинный): через 3×3 и перенос
  const [a, b, c, d, e, f, g, h, i] = [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const r = [
    A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
    C / det, -(a * h - b * g) / det, (a * e - b * d) / det,
  ];
  const t = [m[12], m[13], m[14]];
  const o = [r[0], r[3], r[6], 0, r[1], r[4], r[7], 0, r[2], r[5], r[8], 0, 0, 0, 0, 1];
  o[12] = -(o[0] * t[0] + o[4] * t[1] + o[8] * t[2]);
  o[13] = -(o[1] * t[0] + o[5] * t[1] + o[9] * t[2]);
  o[14] = -(o[2] * t[0] + o[6] * t[1] + o[10] * t[2]);
  return o;
};
const translate = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
const det3 = (m) => m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);

// ───────── сбор и запекание ─────────
/** Треугольники группы по материалам: material → { p: [], n: [], uv: [] } (без индексов, по 3 вершины). */
function newBucket() {
  return new Map();
}

/** Добавить меши поддерева node в ведро: вершины в систему base (base⁻¹ · world), обрезка по y ∈ [y0, y1) в системе
 *  base, затем сдвиг по y на dy. skip(name) — не брать узел (и его поддерево). */
function bake(bucket, node, base, { y0 = -Infinity, y1 = Infinity, dy = 0, skip = () => false } = {}) {
  const B = inv(base);
  node.traverse((n) => {
    if (skip(n.getName())) return;
    for (let p = n.getParentNode(); p; p = p.getParentNode()) if (skip(p.getName())) return;
    const mesh = n.getMesh();
    if (!mesh) return;
    const M = mul(B, n.getWorldMatrix());
    const flip = det3(M) < 0;
    // нормали — обратная транспонированная 3×3
    const Mi = inv(M);
    const N = [Mi[0], Mi[4], Mi[8], Mi[1], Mi[5], Mi[9], Mi[2], Mi[6], Mi[10]];
    for (const prim of mesh.listPrimitives()) {
      const P = prim.getAttribute('POSITION'), Nn = prim.getAttribute('NORMAL'), U = prim.getAttribute('TEXCOORD_0');
      const idx = prim.getIndices();
      const count = idx ? idx.getCount() : P.getCount();
      const mat = prim.getMaterial();
      if (!bucket.has(mat)) bucket.set(mat, { p: [], n: [], uv: [] });
      const out = bucket.get(mat);
      const vert = (k) => {
        const i = idx ? idx.getScalar(k) : k;
        const v = P.getElement(i, [0, 0, 0]);
        const x = M[0] * v[0] + M[4] * v[1] + M[8] * v[2] + M[12];
        const y = M[1] * v[0] + M[5] * v[1] + M[9] * v[2] + M[13];
        const z = M[2] * v[0] + M[6] * v[1] + M[10] * v[2] + M[14];
        let nx = 0, ny = 1, nz = 0;
        if (Nn) {
          const w = Nn.getElement(i, [0, 0, 0]);
          nx = N[0] * w[0] + N[3] * w[1] + N[6] * w[2];
          ny = N[1] * w[0] + N[4] * w[1] + N[7] * w[2];
          nz = N[2] * w[0] + N[5] * w[1] + N[8] * w[2];
          const l = Math.hypot(nx, ny, nz) || 1;
          nx /= l, ny /= l, nz /= l;
        }
        const uv = U ? U.getElement(i, [0, 0]) : [0, 0];
        return { p: [x, y, z], n: [nx, ny, nz], uv: [uv[0], uv[1]] };
      };
      for (let k = 0; k + 2 < count; k += 3) {
        let tri = [vert(k), vert(k + 1), vert(k + 2)];
        if (flip) tri = [tri[0], tri[2], tri[1]];
        let poly = clip(tri, (v) => v.p[1] - y0);
        poly = clip(poly, (v) => y1 - v.p[1]);
        for (let j = 1; j + 1 < poly.length; j++) {
          for (const v of [poly[0], poly[j], poly[j + 1]]) {
            out.p.push(v.p[0], v.p[1] + dy, v.p[2]);
            out.n.push(...v.n);
            out.uv.push(...v.uv);
          }
        }
      }
    }
  });
}

/** Отсечение многоугольника полупространством d(v) ≥ 0 (Сазерленд — Ходжман), атрибуты — линейно. */
function clip(poly, d) {
  if (!poly.length) return poly;
  const lerp = (a, b, t) => ({
    p: a.p.map((x, i) => x + (b.p[i] - x) * t),
    n: a.n.map((x, i) => x + (b.n[i] - x) * t),
    uv: a.uv.map((x, i) => x + (b.uv[i] - x) * t),
  });
  const res = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const da = d(a), db = d(b);
    if (da >= 0) res.push(a);
    if (da >= 0 !== db >= 0 && Number.isFinite(da) && Number.isFinite(db)) res.push(lerp(a, b, da / (da - db)));
  }
  return res;
}

/** Ведро → узел с одним мешем (примитив на материал; join позже сольёт, что можно). */
function emit(name, bucket, extras) {
  const mesh = doc.createMesh(name);
  let tris = 0;
  for (const [mat, d] of bucket) {
    const n = d.p.length / 3;
    if (!n) continue;
    tris += n / 3;
    const prim = doc.createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(d.p)).setBuffer(buffer))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(d.n)).setBuffer(buffer))
      .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(d.uv)).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(n > 65535 ? Uint32Array.from({ length: n }, (_, i) => i) : Uint16Array.from({ length: n }, (_, i) => i)).setBuffer(buffer))
      .setMaterial(mat);
    mesh.addPrimitive(prim);
  }
  const node = doc.createNode(name).setMesh(mesh);
  if (extras) node.setExtras(extras);
  console.log(`  ${name.padEnd(22)} треугольников ${tris}`);
  return node;
}

// ───────── позы доски из анимации ─────────
function sample(nodeRe, path, t) {
  const an = root.listAnimations()[0];
  const ch = an.listChannels().find((c) => nodeRe.test(c.getTargetNode().getName()) && c.getTargetPath() === path);
  const s = ch.getSampler(), I = s.getInput(), O = s.getOutput();
  let k = 0;
  while (k + 1 < I.getCount() && I.getScalar(k + 1) <= t) k++;
  return O.getElement(k, []);
}
const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const LIFT_RE = /^LIFT_ROOT/, BOARD_RE = /^EVENT_BOARD/;
const liftRoot = one(LIFT_RE);
const pivotY = liftRoot.getTranslation()[1]; // начало LIFT_ROOT — точка подвеса; пол кабины в покое — y 0
const boardPose = (t) => {
  const ly = sample(LIFT_RE, 'translation', t)[1] - pivotY; // пол кабины в момент t
  const bt = sample(BOARD_RE, 'translation', t), bq = sample(BOARD_RE, 'rotation', t);
  const lq = sample(LIFT_RE, 'rotation', t);
  // поза доски относительно пола кабины (поворот кабины в момент заклинивания ≈ 0 — учитываем только перенос)
  void qmul, void lq;
  return { t: [bt[0], bt[1] - ly, bt[2]].map((x) => +x.toFixed(4)), q: Array.from(bq, (x) => +x.toFixed(5)) };
};
const POSES = { boardStart: boardPose(T_START), boardWedge: boardPose(T_WEDGE) };

// ───────── группы ─────────
const nodes = [];
const ID = translate(0, 0, 0);
const staticRoot = one(/^STATIC_SHAFT_ROOT/);
const MOVING = /^(Live hoist cable|Counterweight cable|Stacked counterweight|Floor number 0)/;
console.log('Сборка групп:');
for (const [name, y0, y1] of [['LIFT_SHAFT_BOTTOM', -Infinity, FLOOR], ['LIFT_SHAFT_MID', FLOOR, 2 * FLOOR], ['LIFT_SHAFT_TOP', 2 * FLOOR, Infinity]]) {
  const b = newBucket();
  const dy = name === 'LIFT_SHAFT_MID' ? -FLOOR : name === 'LIFT_SHAFT_TOP' ? -2 * FLOOR : 0;
  bake(b, staticRoot, ID, { y0, y1, dy, skip: (n) => MOVING.test(n) });
  nodes.push(emit(name, b));
}
{
  // этаж: узлы уровня 4.2 (центр по y в [4.2, 8.4)) — стены у проёмов, коридоры, обрамления
  const b = newBucket();
  for (const n of topBy(/^(FRONT|RIGHT|NARROW|WIDE) /)) {
    let lo = Infinity, hi = -Infinity;
    n.traverse((x) => {
      const m = x.getMesh();
      if (!m) return;
      const W = x.getWorldMatrix();
      for (const p of m.listPrimitives()) {
        const P = p.getAttribute('POSITION');
        for (let i = 0; i < P.getCount(); i++) {
          const v = P.getElement(i, [0, 0, 0]);
          const y = W[1] * v[0] + W[5] * v[1] + W[9] * v[2] + W[13];
          lo = Math.min(lo, y), hi = Math.max(hi, y);
        }
      }
    });
    const cy = (lo + hi) / 2;
    if (cy >= FLOOR && cy < 2 * FLOOR) bake(b, n, ID, { dy: -FLOOR });
  }
  nodes.push(emit('LIFT_LEVEL', b));
}
{
  const FRAME = /(prison bar|horizontal cage rail|Cage corner angle|Front jamb grille|Open roof|Roof beam|doorway jamb|doorway lintel|Corner rivet|Danger plate)/;
  const PANEL = /^Call (box|buttons)/;
  // кабина: в системе «центр пола в покое» = мир (в покое пол кабины на y 0)
  const frame = newBucket(), deck = newBucket(), panel = newBucket();
  for (const c of liftRoot.listChildren()) {
    const nm = c.getName();
    bake(PANEL.test(nm) ? panel : FRAME.test(nm) ? frame : deck, c, ID);
  }
  nodes.push(emit('LIFT_CAGE_FRAME', frame));
  nodes.push(emit('LIFT_CAGE_DECK', deck, { pivotY: +pivotY.toFixed(4) }));
  nodes.push(emit('LIFT_PANEL', panel));
}
{
  const board = one(BOARD_RE);
  const b = newBucket();
  bake(b, board, board.getWorldMatrix());
  nodes.push(emit('LIFT_BOARD', b, POSES));
}
{
  const b = newBucket();
  for (const c of staticRoot.listChildren()) if (/^Stacked counterweight/.test(c.getName())) bake(b, c, ID);
  nodes.push(emit('LIFT_COUNTERWEIGHT', b));
}
{
  // дверь логова: начало — центр проёма на полу (x плоскости створок 6.5, пол 4.2), проход к −x
  const b = newBucket();
  for (const n of topBy(/^(Boss |Door reinforcing strap)/)) bake(b, n, translate(6.5, FLOOR, 0));
  nodes.push(emit('LIFT_LAIR_DOOR', b));
}

// старое — прочь из сцены; новое — в сцену
for (const n of top) scene.removeChild(n);
for (const n of nodes) scene.addChild(n);
for (const a of root.listAnimations()) a.dispose();
root.setExtras({
  ...root.getExtras(),
  source: 'rusted_lift_v2_package.zip / rusted_lift_shaft.glb (tools/optimize-lift.mjs)',
  floorM: FLOOR,
  pivotY: +pivotY.toFixed(4),
  ...POSES,
});

await doc.transform(
  prune({ keepLeaves: false, keepAttributes: false }),
  dedup(),
  join({ keepNamed: true }),
  weld(),
  quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 }),
);
// текстуры: бетон стен — 1024 (большие поверхности), остальное — 512; нормали — качество выше
for (const [re, size, quality] of [
  [/^concrete_(base|normal)$/, 1024, 82],
  [/^(?!concrete_(base|normal)$).*_normal$/, 512, 88],
  [/^(?!concrete_(base|normal)$).*_base$/, 512, 82],
  [/_rough$/, 256, 85],
]) {
  await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [size, size], quality, pattern: re }));
}
await io.write(out, doc);
const mb = (b) => (b / 1024 / 1024).toFixed(2) + ' МБ';
console.log(`${src} → ${out}: ${mb(statSync(src).size)} → ${mb(statSync(out).size)}`);
for (const t of root.listTextures()) console.log(`   ${t.getName().padEnd(16)} ${t.getMimeType().padEnd(11)} ${t.getSize()?.join('×')}  ${((t.getImage()?.byteLength ?? 0) / 1024).toFixed(0)} КБ`);
