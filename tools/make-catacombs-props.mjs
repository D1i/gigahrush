// Модели биома «Катакомбы» (питерские катакомбы с наводнениями) — src/view3d/assets/catacombs_props.glb:
//
//  • Узел на предмет, имя узла = id prop проекта (src/data/props.ts, p_cat_*). Оси — как у болванки мебели
//    (src/blockout/babylon.ts): ширина w — вдоль X, глубина (h плана) — вдоль Z, центр габарита на плане — в начале
//    координат, перед — −Z, стена — +Z (z = +глубина/2); низ — пол (y = 0). Настенное — высоты от пола, как в комнате.
//    Подвесное (тег «потолок»: своды-вкладыши) — верх в y = 0: адаптер ставит модель под потолок (extras.ceil).
//  • Из набора заказчика (tmp/catacombs-zip/Petersburg_Catacombs/GLB, Y вверх, пол y = 0, центр модуля — начало;
//    без UV, одноцветные материалы, doubleSided) читаются колонны, задвижка, насос, завал, затвор, лестница; материалы
//    набора заменены своими cat_* (осветлены: StandardMaterial берёт цвет как есть; односторонние; Water и Warm_lamp не
//    используются — ничего не светится и не прозрачно), нормали сглажены по углу (трубы, круглая колонна). Трубы-
//    препятствия, труба вдоль стены, рейка уровня воды — пересобраны под ход 2.0 м по образцу набора (труба r 0.22).
//    Свод-вкладыш, мусор, вещи убежища, советское — из примитивов.
//  • Кирпич — текстурой (та же картинка, что у отделки f_cat_brick: src/data/assets/catacombs/brick.jpg, повтор
//    1.2 м, в GLB — WebP): свод, кирпичная колонна, кирпичные обломки завала, кирпич под огарками. UV — в метрах:
//    у свода u — вдоль хода, v — по дуге (ряды кладки идут вдоль хода), у боксов — проекция по нормали грани.
//  • Координаты в коде — как в игре (Babylon, левая система): смотришь на предмет спереди — +X справа. Загрузчик glTF
//    в Babylon зеркалит X (x → −x), поэтому при записи x → −x (с обратным обходом) — надписи читаются. Модели набора
//    (glTF) при чтении — тоже x → −x (в игре выглядят как в просмотрщике набора).
//  • Обход граней выбирается по нормали (tri), после записи — сверка: узлы, габариты против таблицы EXPECT.
//  • Посмотреть: node tmp/catacombs-wip/cat-preview-shots.mjs → tmp/catacombs-wip/cat-view*.png.
//
//   node tools/make-catacombs-props.mjs
import { Document, NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, quantize, textureCompress, weld } from '@gltf-transform/functions';
import sharp from 'sharp';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../src/view3d/assets/catacombs_props.glb', import.meta.url));
const KIT = fileURLToPath(new URL('../tmp/catacombs-zip/Petersburg_Catacombs/GLB/', import.meta.url));
const BRICK_JPG = fileURLToPath(new URL('../src/data/assets/catacombs/brick.jpg', import.meta.url));
mkdirSync(fileURLToPath(new URL('../src/view3d/assets/', import.meta.url)), { recursive: true });

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene('catacombs');
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
const PI = Math.PI;
const DEG = PI / 180;
/** Базис вращения вокруг оси: (U, A, W) — правая тройка, как (X, Y, Z). */
const BASIS = {
  y: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  z: [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
  x: [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
};
/** Детерминированный «случай». */
let seed = 11;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const rr = (a, b) => a + (b - a) * rnd();

// ───────── повороты и переносы (3 × 3 по строкам + сдвиг) ─────────
const rot = (axis, a) => {
  const c = Math.cos(a), s = Math.sin(a);
  if (axis === 'x') return [1, 0, 0, 0, c, -s, 0, s, c];
  if (axis === 'y') return [c, 0, s, 0, 1, 0, -s, 0, c];
  return [c, -s, 0, s, c, 0, 0, 0, 1];
};
const mm = (A, B) => {
  const o = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c] += A[r * 3 + k] * B[k * 3 + c];
  return o;
};
const mv = (R, p) => [R[0] * p[0] + R[1] * p[1] + R[2] * p[2], R[3] * p[0] + R[4] * p[1] + R[5] * p[2], R[6] * p[0] + R[7] * p[1] + R[8] * p[2]];
const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
/** Перенос t после поворотов (применяются справа налево: последний в списке — первым). */
const T = (t, ...rots) => ({ R: rots.reduce((R, [ax, a]) => mm(R, rot(ax, a)), I3), t });

// ───────── материалы ─────────
const hex = (h) => [1, 3, 5].map((k) => +(parseInt(h.slice(k, k + 2), 16) / 255).toFixed(4));
/** Текстура кирпича — та же картинка, что у отделки (в GLB станет WebP). */
const brickTex = doc.createTexture('cat_brick').setImage(readFileSync(BRICK_JPG)).setMimeType('image/jpeg');
/** Цвет — как в болванке (#rrggbb без перевода в линейный: PropModels кладёт его в StandardMaterial как есть).
 *  o.tex — текстура с повтором tile (м): UV проекцией по нормали, если не заданы. Ничего не светится. */
function mat(name, color, o = {}) {
  const m = doc.createMaterial(name).setBaseColorFactor([...hex(color), 1]).setMetallicFactor(0).setRoughnessFactor(o.rough ?? 0.9);
  if (o.tex) m.setBaseColorTexture(o.tex);
  if (o.two) m.setDoubleSided(true);
  MAT_TILE.set(m, o.tex ? (o.tile ?? 1.2) : 0);
  return m;
}
const MAT_TILE = new Map();
const C = {
  // кладка и камень
  brick: mat('cat_brick', '#ffffff', { tex: brickTex, tile: 1.2 }),
  limestone: mat('cat_limestone', '#aaa38a'),
  concrete: mat('cat_concrete', '#8f948f'),
  concreteDk: mat('cat_concrete_dk', '#73776f'),
  plaster: mat('cat_plaster', '#b4ad94'),
  dust: mat('cat_rubble_dust', '#86776a'),
  // металл
  rust: mat('cat_rust', '#80502f'),
  rustDk: mat('cat_rust_dk', '#5e3c28'),
  iron: mat('cat_pipe_iron', '#6a4f3d'),
  steel: mat('cat_steel', '#5f6866'),
  steelLt: mat('cat_steel_lt', '#8b9390'),
  galv: mat('cat_galvanized', '#959b98'),
  black: mat('cat_black', '#2c2b29'),
  // краска
  green: mat('cat_soviet_green', '#4f7b63'),
  greenDk: mat('cat_green_dk', '#3c5a49'),
  grayGreen: mat('cat_gray_green', '#6c7e72'),
  hermo: mat('cat_hermo_paint', '#68776c'),
  redPaint: mat('cat_red_paint', '#923026'),
  yellow: mat('cat_yellow_paint', '#c2a032'),
  whiteEnamel: mat('cat_white_enamel', '#d2cdbf'),
  signWhite: mat('cat_sign_white', '#d0cab6'),
  lamp: mat('cat_lamp_green', '#55695d'),
  dial: mat('cat_dial', '#d9d4c2'),
  lampRed: mat('cat_lamp_red', '#8c2c24'),
  lampGreen: mat('cat_lamp_green_cap', '#3d6b42'),
  // стекло (непрозрачное: альфа не переносится)
  glassGreen: mat('cat_glass_green', '#3e7a48', { rough: 0.3 }),
  glassClear: mat('cat_glass_clear', '#b4c8bf', { rough: 0.3 }),
  glassBrown: mat('cat_glass_brown', '#734222', { rough: 0.3 }),
  glassFrost: mat('cat_glass_frost', '#c9cfc4', { rough: 0.4 }),
  // дерево, ткань, бумага, резина
  wood: mat('cat_wood', '#7d5d3e'),
  woodDk: mat('cat_wood_dk', '#5b4330'),
  woodGray: mat('cat_wood_gray', '#857868'),
  rag: mat('cat_rag', '#6f685c'),
  rag2: mat('cat_rag_purple', '#5d4c54'),
  bagBlack: mat('cat_bag_black', '#363634'),
  bagBlue: mat('cat_bag_blue', '#4f6680'),
  bagWhite: mat('cat_bag_white', '#a9a8a0'),
  paper: mat('cat_paper', '#bfb79c'),
  print: mat('cat_print', '#5e594e'),
  label: mat('cat_label', '#c7b484'),
  tin: mat('cat_tin', '#959289'),
  canBlue: mat('cat_can_blue', '#3d5678'),
  alu: mat('cat_alu', '#a7abab'),
  boot: mat('cat_boot', '#4b413a'),
  rubber: mat('cat_rubber', '#2f2c2a'),
  mattress: mat('cat_mattress', '#9a947d'),
  mattressStripe: mat('cat_mattress_stripe', '#6f7476'),
  stain: mat('cat_stain', '#6b5c42'),
  wax: mat('cat_wax', '#d6cba8'),
  dirt: mat('cat_dirt', '#6f6352'),
  cable: mat('cat_cable', '#30302d'),
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

/** Модель предмета: примитив на материал; T — текущее преобразование (вложенные at()). */
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
  /** Рисовать fn в системе T (поверх текущей). */
  at(t, fn) {
    const prev = this.T;
    this.T = prev ? { R: mm(prev.R, t.R), t: add(mv(prev.R, t.t), prev.t) } : t;
    fn();
    this.T = prev;
  }
  vert(g, m, p, n, uv) {
    if (this.T) {
      p = add(mv(this.T.R, p), this.T.t);
      n = mv(this.T.R, n);
    }
    g.p.push(p[0], p[1], p[2]);
    const q = norm(n);
    g.n.push(q[0], q[1], q[2]);
    const tile = MAT_TILE.get(m);
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
    const i = [a, b, c, d].map((p, k) => this.vert(g, m, p, ns ? ns[k] : n, uvs?.[k]));
    tri(g, i[0], i[1], i[2]);
    tri(g, i[0], i[2], i[3]);
  }
  /** Выпуклый многоугольник веером, нормаль n. */
  poly(m, pts, n) {
    const g = this.g(m);
    const i = pts.map((p) => this.vert(g, m, p, n));
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
  /** Бокс по центру и размерам. */
  cbox(m, c, s, skip = '') {
    this.box(m, c[0] - s[0] / 2, c[1] - s[1] / 2, c[2] - s[2] / 2, c[0] + s[0] / 2, c[1] + s[1] / 2, c[2] + s[2] / 2, skip);
  }
  /** Трубка радиуса r по ломаной (рамка переносится параллельно — без перекрута); caps: 'both' | 'start' | 'end'. */
  tube(m, pts, r, o = {}) {
    const seg = o.seg ?? 6, closed = !!o.closed, g = this.g(m), n = pts.length;
    const T = pts.map((_, k) => {
      if (closed) return norm(sub(pts[(k + 1) % n], pts[(k - 1 + n) % n]));
      return norm(sub(pts[Math.min(n - 1, k + 1)], pts[Math.max(0, k - 1)]));
    });
    let u = norm(cross(T[0], Math.abs(T[0][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
    const rings = [];
    const dirs = [];
    for (let k = 0; k < n; k++) {
      if (k > 0) u = norm(sub(u, mul(T[k], dot(u, T[k]))));
      const v = cross(T[k], u);
      const ring = [], dr = [];
      const rk = Array.isArray(r) ? r[k] : r;
      for (let s = 0; s < seg; s++) {
        const q = (s / seg) * 2 * PI + (o.phase ?? 0);
        const d = add(mul(u, Math.cos(q)), mul(v, Math.sin(q)));
        ring.push(this.vert(g, m, add(pts[k], mul(d, rk)), d));
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
      const rk = Array.isArray(r) ? r[k] : r;
      this.poly(m, dirs[k].map((d) => add(pts[k], mul(d, rk))), mul(T[k], sign));
    }
  }
  /** Тело вращения: профиль [r, y] (снизу вверх по внешней стороне: нормаль (dy, −dr) наружу) вокруг оси axis через
   *  c; sx, sz — сплющивание; a0…a1 — часть оборота. Вдоль профиля гладко, где излом меньше crease (°; smooth — всюду). */
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
        ids.push(this.vert(g, m, p, nn));
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
  disc(m, c, n, r, seg = 12, sx = 1) {
    n = norm(n);
    const u = norm(cross(n, Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), v = cross(n, u);
    const pts = [];
    for (let s = 0; s < seg; s++) {
      const f = (s / seg) * 2 * PI;
      pts.push(add(c, add(mul(u, Math.cos(f) * r * sx), mul(v, Math.sin(f) * r))));
    }
    this.poly(m, pts, n);
  }
  /** Цилиндр вдоль оси axis ('x' | 'y' | 'z') от a0 до a1 через центр c (две другие координаты), радиус r. */
  cyl(m, axis, c, a0, a1, r, seg = 12, caps = true) {
    const P = (a) => (axis === 'x' ? [a, c[1], c[2]] : axis === 'y' ? [c[0], a, c[2]] : [c[0], c[1], a]);
    this.tube(m, [P(a0), P(a1)], r, { seg, caps: caps ? 'both' : '' });
  }
  /** Призма: выпуклый многоугольник pts поперёк оси (для 'x' — точки (z, y), 'y' — (x, z), 'z' — (x, y)), от a0 до
   *  a1 вдоль оси; smooth — угол (°), меньше которого рёбра сглажены. */
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
      this.quad(m, P(q, a0), P(r, a0), P(r, a1), P(q, a1), null, [vn(i, i), vn(j, i), vn(j, i), vn(i, i)]);
    }
    const axv = axis === 'x' ? [1, 0, 0] : axis === 'y' ? [0, 1, 0] : [0, 0, 1];
    if (o.caps !== false) {
      this.poly(m, pts.map((q) => P(q, a0)), mul(axv, -1));
      this.poly(m, pts.map((q) => P(q, a1)), axv);
    }
  }
  /** Поверхность по сетке nu × nv: f(u, v) → точка; нормаль — по направлению hint; uvf(u, v) → UV (иначе проекция). */
  surface(m, nu, nv, f, hint, uvf) {
    const g = this.g(m), e = 1e-4, ids = [];
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) {
        const u = i / nu, v = j / nv, p = f(u, v);
        const du = sub(f(Math.min(1, u + e), v), f(Math.max(0, u - e), v));
        const dv = sub(f(u, Math.min(1, v + e)), f(u, Math.max(0, v - e)));
        let n = cross(du, dv);
        if (dot(n, typeof hint === 'function' ? hint(u, v) : hint) < 0) n = mul(n, -1);
        ids.push(this.vert(g, m, p, n, uvf?.(u, v)));
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
  /** Треугольники набора (уже в координатах игры): tris — [{ m, p: [a, b, c], n: [na, nb, nc] }]. */
  addTris(tris) {
    for (const t of tris) {
      const g = this.g(t.m);
      const ids = t.p.map((p, k) => this.vert(g, t.m, p, t.n[k]));
      tri(g, ids[0], ids[1], ids[2]);
    }
  }
}
const MODELS = [];

/** Скруглённый прямоугольник (x, y) против часовой: rt — радиус верхних углов, rb — нижних. */
function rrect(x0, y0, x1, y1, rt, rb = 0, n = 5) {
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

// ───────── набор заказчика ─────────
const KIT_CACHE = new Map();
/** Треугольники модуля набора в координатах игры (x → −x): [{ km: имя материала набора, p: [3], n: [3] }]. */
async function kitTris(name) {
  if (KIT_CACHE.has(name)) return KIT_CACHE.get(name);
  const d = await io.read(`${KIT}${name}.glb`);
  const out = [];
  for (const mesh of d.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const km = prim.getMaterial()?.getName() ?? '';
      const P = prim.getAttribute('POSITION'), Nn = prim.getAttribute('NORMAL'), idx = prim.getIndices();
      const count = idx ? idx.getCount() : P.getCount();
      for (let k = 0; k + 2 < count; k += 3) {
        const p = [], n = [];
        for (let j = 0; j < 3; j++) {
          const i = idx ? idx.getScalar(k + j) : k + j;
          const v = P.getElement(i, [0, 0, 0]), w = Nn ? Nn.getElement(i, [0, 1, 0]) : [0, 1, 0];
          p.push([-v[0], v[1], v[2]]);
          n.push([-w[0], w[1], w[2]]);
        }
        out.push({ km, p, n });
      }
    }
  }
  KIT_CACHE.set(name, out);
  return out;
}
/** Материалы набора → свои (осветлённые; Water / Warm_lamp — нет). */
const KIT_MAT = {
  Concrete: C.concrete, Old_brick: C.brick, Limestone: C.limestone, Soviet_green: C.green, Rust: C.rust, Steel: C.steel,
  Damp: C.greenDk, Plaster: C.plaster,
};
/** Нормали по углу: у вершин в одной точке с гранями, отличающимися меньше чем на deg, — общая (гладкие трубы). */
function autoSmooth(tris, deg = 35) {
  const key = (p) => p.map((v) => Math.round(v * 2e3)).join(',');
  const fn = tris.map((t) => norm(cross(sub(t.p[1], t.p[0]), sub(t.p[2], t.p[0]))).map((v, k) => v * Math.sign(dot(cross(sub(t.p[1], t.p[0]), sub(t.p[2], t.p[0])), t.n[0]) || 1)));
  const at = new Map();
  tris.forEach((t, ti) => t.p.forEach((p) => {
    const k = key(p);
    if (!at.has(k)) at.set(k, new Set());
    at.get(k).add(ti);
  }));
  const lim = Math.cos(deg * DEG);
  return tris.map((t, ti) => ({
    ...t,
    n: t.p.map((p) => {
      let s = [0, 0, 0];
      for (const o of at.get(key(p))) if (tris[o].m === t.m && dot(fn[o], fn[ti]) > lim) s = add(s, fn[o]);
      return norm(s);
    }),
  }));
}
/** Модуль набора в модель: map(km, центр треугольника) → материал (null — пропустить); xf — точка, nf — нормаль. */
async function kit(M, name, o = {}) {
  const src = await kitTris(name);
  const xf = o.xf ?? ((p) => p), nf = o.nf ?? ((n) => n);
  const tris = [];
  for (const t of src) {
    const c = mul(add(add(t.p[0], t.p[1]), t.p[2]), 1 / 3);
    const m = o.map ? o.map(t.km, c) : KIT_MAT[t.km];
    if (!m) continue;
    tris.push({ m, p: t.p.map(xf), n: t.n.map((n) => norm(nf(n))) });
  }
  M.addTris(o.smooth === false ? tris : autoSmooth(tris, o.smooth ?? 35));
}

// ───────── пиксельный шрифт 3 × 5 (трафарет): цифры и буквы надписей ─────────
const FONT = {
  0: ['111', '101', '101', '101', '111'], 1: ['010', '110', '010', '010', '111'], 2: ['111', '001', '111', '100', '111'],
  3: ['111', '001', '111', '001', '111'], 4: ['101', '101', '111', '001', '001'], 5: ['111', '100', '111', '001', '111'],
  6: ['111', '100', '111', '101', '111'], 7: ['111', '001', '010', '010', '010'], 8: ['111', '101', '111', '101', '111'],
  9: ['111', '101', '111', '001', '111'], О: ['111', '101', '101', '101', '111'], Т: ['111', '010', '010', '010', '010'],
  С: ['111', '100', '100', '100', '111'], Е: ['111', '100', '110', '100', '111'], К: ['101', '101', '110', '101', '101'],
  Г: ['111', '100', '100', '100', '100'], Н: ['101', '101', '111', '101', '101'], А: ['111', '101', '111', '101', '101'],
  '-': ['000', '000', '111', '000', '000'], ' ': ['000', '000', '000', '000', '000'], '№': ['101', '111', '111', '101', '101'],
};
/** Надпись на плоскости z = z0 лицом к −Z: левый верх (x0, y0), пиксель px, выступ dz; ряды пикселей — полосами. */
function text(M, m, s, x0, y0, z0, px, dz = 0.002) {
  let x = x0;
  for (const ch of s) {
    const gl = FONT[ch];
    if (!gl) throw new Error(`нет буквы «${ch}»`);
    gl.forEach((row, r) => {
      for (let c = 0; c < 3; ) {
        if (row[c] !== '1') {
          c++;
          continue;
        }
        let e = c;
        while (e < 3 && row[e] === '1') e++;
        M.box(m, x + c * px, y0 - (r + 1) * px, z0 - dz, x + e * px, y0 - r * px, z0, 'pz');
        c = e;
      }
    });
    x += 4 * px;
  }
}
const textW = (s, px) => s.length * 4 * px - px;

// ═════════════════════════ из набора: колонны станции ═════════════════════════

// колонны 0.8 × 0.8 × 3.31 (зал станции ≈ 3.3 м): база и капитель из известняка; у квадратной — зелёная панель (вперёд,
// −Z), у кирпичной — кладка текстурой и вставка под капителью (в наборе — щель 10 см), у разрушенной — бетон отвалился
// снизу, торчит ржавая арматура, у базы — куски бетона
{
  const M = new Model('p_cat_column_square');
  await kit(M, 'column_square', { xf: (p) => [-p[0], p[1], -p[2]], nf: (n) => [-n[0], n[1], -n[2]] });
}
{
  const M = new Model('p_cat_column_round');
  await kit(M, 'column_round');
}
{
  const M = new Model('p_cat_column_brick');
  await kit(M, 'column_brick');
  M.box(C.brick, -0.3, 2.99, -0.3, 0.3, 3.09, 0.3, 'ny py');
}
{
  const M = new Model('p_cat_column_damaged');
  await kit(M, 'column_damaged', { map: (km, c) => (km === 'Concrete' && c[1] < 3.0 ? C.concreteDk : KIT_MAT[km]) });
  seed = 5;
  for (let k = 0; k < 7; k++) {
    const a = rr(0, 2 * PI), r = rr(0.42, 0.62), s = rr(0.06, 0.16);
    M.at(T([r * Math.cos(a), s * 0.3, r * Math.sin(a)], ['y', rr(0, PI)], ['x', rr(-0.4, 0.4)], ['z', rr(-0.4, 0.4)]), () => M.cbox(C.concreteDk, [0, 0, 0], [s, s * 0.6, s * 0.8]));
  }
}

// ═════════════════════════ трубы ═════════════════════════

/** Фланцевый стык трубы радиуса R вдоль X в точке x: два фланца и болты. */
function flange(M, x, y, z, R, Rf) {
  for (const [a, b] of [[x - 0.03, x], [x, x + 0.03]]) M.cyl(C.rust, 'x', [0, y, z], a, b, Rf, 20);
  for (let k = 0; k < 8; k++) {
    const f = ((k + 0.5) / 8) * 2 * PI;
    M.cyl(C.steel, 'x', [0, y + (Rf - 0.022) * Math.cos(f), z + (Rf - 0.022) * Math.sin(f)], x - 0.045, x + 0.045, 0.011, 6);
  }
}

/** Труба поперёк хода 2.0 м на оси axis: концы уходят в стены (x = ±1.03), у стен — кронштейны (пластина на стене,
 *  полка под трубой, подкос, хомут), фланцевый стык со сдвигом от середины. */
function pipeAcross(id, axis) {
  const M = new Model(id);
  const R = 0.22, Rf = 0.26;
  M.cyl(C.iron, 'x', [0, axis, 0], -1.03, 1.03, R, 24);
  flange(M, -0.35, axis, 0, R, Rf);
  // пояса ржавчины и смоляной обмотки
  M.cyl(C.rustDk, 'x', [0, axis, 0], 0.18, 0.42, R + 0.004, 24, false);
  for (const s of [-1, 1]) {
    const xw = s * 1.0; // плоскость стены
    // пластина на стене с анкерами
    M.box(C.steel, Math.min(xw, xw - s * 0.012), axis - 0.44, -0.12, Math.max(xw, xw - s * 0.012), axis + 0.06, 0.12);
    for (const [yy, zz] of [[axis - 0.38, -0.08], [axis - 0.38, 0.08], [axis + 0.0, -0.08], [axis + 0.0, 0.08]]) {
      M.cyl(C.steelLt, 'x', [0, yy, zz], xw - s * 0.03, xw - s * 0.012, 0.014, 6);
    }
    // полка-уголок под трубой
    const xa = xw - s * 0.012, xb = xw - s * 0.3;
    M.box(C.steel, Math.min(xa, xb), axis - R - 0.035, -0.09, Math.max(xa, xb), axis - R, 0.09);
    M.box(C.steel, Math.min(xa, xb), axis - R - 0.1, -0.012, Math.max(xa, xb), axis - R - 0.035, 0.012);
    // подкос от пластины к краю полки
    M.tube(C.steel, [[xw - s * 0.02, axis - 0.42, 0], [xb + s * 0.02, axis - R - 0.08, 0]], 0.016, { seg: 4, caps: true });
    // хомут поверх трубы
    const xc = xw - s * 0.16, pts = [];
    for (let k = 0; k <= 12; k++) {
      const f = (k / 12) * PI;
      pts.push([xc, axis + (R + 0.01) * Math.sin(f), (R + 0.01) * Math.cos(f)]);
    }
    M.tube(C.steelLt, [[xc, axis - R - 0.035, R + 0.01], ...pts, [xc, axis - R - 0.035, -R - 0.01]], 0.009, { seg: 5 });
  }
}
pipeAcross('p_cat_pipe_low', 0.55);
pipeAcross('p_cat_pipe_mid', 1.05);
pipeAcross('p_cat_pipe_high', 1.65);

// ── труба вдоль стены 2.0 м: ось на 0.45 м, в 5 см от стены; фланцы на концах (стыкуются с соседней), две опоры:
//    пластина на стене, консоль под трубой, хомут
{
  const M = new Model('p_cat_pipe_wall');
  const R = 0.13, y = 0.45, D = 0.34, zw = D / 2, za = zw - 0.05 - R;
  M.cyl(C.iron, 'x', [0, y, za], -1.0, 1.0, R, 20);
  for (const s of [-1, 1]) {
    M.cyl(C.rust, 'x', [0, y, za], s > 0 ? 0.96 : -1.0, s > 0 ? 1.0 : -0.96, 0.16, 20);
    const xb = s * 0.55;
    M.box(C.steel, xb - 0.06, 0.12, zw - 0.012, xb + 0.06, 0.62, zw);
    M.box(C.steel, xb - 0.03, y - R - 0.04, za - 0.1, xb + 0.03, y - R, zw - 0.012);
    M.tube(C.steel, [[xb, 0.16, zw - 0.015], [xb, y - R - 0.04, za - 0.06]], 0.012, { seg: 4, caps: true });
    const pts = [];
    for (let k = 0; k <= 12; k++) {
      const f = (k / 12) * PI;
      pts.push([xb, y + (R + 0.008) * Math.sin(f), za + (R + 0.008) * Math.cos(f)]);
    }
    M.tube(C.steelLt, [[xb, y - R - 0.04, za + R + 0.008], ...pts, [xb, y - R - 0.04, za - R - 0.008]], 0.007, { seg: 5 });
  }
  M.cyl(C.rustDk, 'x', [0, y, za], -0.3, -0.05, R + 0.004, 20, false);
}

// ── задвижка (набор: pipe_valve, труба вдоль X): маховик выкрашен красным, под трубой — бетонные опоры
{
  const M = new Model('p_cat_valve');
  const rotP = (p) => [p[2], p[1], -p[0]];
  await kit(M, 'pipe_valve', { xf: rotP, nf: rotP, map: (km, c) => (km === 'Rust' && c[1] > 1.0 ? C.redPaint : KIT_MAT[km]) });
  for (const s of [-1, 1]) M.box(C.concreteDk, s * 0.7 - 0.13, 0, -0.16, s * 0.7 + 0.13, 0.28, 0.16, 'ny');
}

// ── насосный агрегат (набор: pump_unit) — как есть
{
  const M = new Model('p_cat_pump');
  await kit(M, 'pump_unit');
}

// ── завал (набор: rubble_pile — 40 брусков кирпича и бетона) на осыпи из пыли и мелкого боя: бруски легли на
//    осыпь и наклонены вразнобой
{
  const M = new Model('p_cat_rubble');
  const src = await kitTris('rubble_pile');
  // центр набора — по брускам
  const cx = 0.02, cz = -0.12;
  const mound = (x, z) => {
    const q = ((x - cx) / 1.0) ** 2 + ((z - cz) / 0.7) ** 2;
    if (q >= 1) return 0;
    return 0.26 * (1 - q) ** 0.8 * (1 + 0.18 * Math.sin(x * 9.1 + z * 4.3) * Math.sin(z * 7.7 - x * 2.1));
  };
  M.surface(C.dust, 20, 14, (u, v) => {
    const x = cx + lerp(-1.02, 1.02, u), z = cz + lerp(-0.72, 0.72, v);
    return [x, Math.max(0.002, mound(x, z)), z];
  }, [0, 1, 0]);
  seed = 25;
  // бруски набора: по 12 треугольников подряд в каждом материале
  const byMat = new Map();
  for (const t of src) {
    if (!byMat.has(t.km)) byMat.set(t.km, []);
    byMat.get(t.km).push(t);
  }
  for (const [km, list] of byMat) {
    for (let b = 0; b + 12 <= list.length; b += 12) {
      const chunk = list.slice(b, b + 12);
      const ps = chunk.flatMap((t) => t.p);
      const lo = [0, 1, 2].map((a) => Math.min(...ps.map((p) => p[a]))), hi = [0, 1, 2].map((a) => Math.max(...ps.map((p) => p[a])));
      const c = mul(add(lo, hi), 0.5), h = hi[1] - lo[1];
      // лечь на осыпь: низ — на поверхности, утоплен на треть высоты; наклон и поворот вразнобой
      const y = mound(c[0], c[2]) + h * 0.2;
      const R = mm(mm(rot('y', rr(0, PI)), rot('x', rr(-0.45, 0.45))), rot('z', rr(-0.45, 0.45)));
      const m = KIT_MAT[km];
      M.addTris(chunk.map((t) => ({ m, p: t.p.map((p) => add(mv(R, sub(p, c)), [c[0], y, c[2]])), n: t.n.map((n) => mv(R, n)) })));
    }
  }
}

// ── затвор (набор: flood_gate, 2.3 × 2.9 м) — у стены, закрыт: сжат до 1.6 × 2.0 м (ниже пяты свода), рёбрами
//    вперёд (−Z), спиной к стене; на правой стойке — маховик подъёмного винта
{
  const M = new Model('p_cat_gate');
  const sx = 0.7, sy = 2.0 / 2.9, dz = 0.0175;
  await kit(M, 'flood_gate', {
    xf: (p) => [-p[0] * sx, p[1] * sy, -p[2] + dz],
    nf: (n) => [-n[0] / sx, n[1] / sy, -n[2]],
    smooth: false,
    map: (km) => (km === 'Steel' ? C.steel : C.rust),
  });
  const x = 0.735, y = 1.15, z = -0.095;
  M.cyl(C.steel, 'z', [x, y, 0], z - 0.06, z, 0.02, 8);
  const ring = [];
  for (let k = 0; k < 16; k++) ring.push([x + 0.12 * Math.cos((k / 16) * 2 * PI), y + 0.12 * Math.sin((k / 16) * 2 * PI), z - 0.06]);
  M.tube(C.redPaint, ring, 0.012, { seg: 6, closed: true });
  for (let k = 0; k < 3; k++) {
    const f = (k / 3) * 2 * PI + 0.3;
    M.tube(C.redPaint, [[x, y, z - 0.06], [x + 0.12 * Math.cos(f), y + 0.12 * Math.sin(f), z - 0.06]], 0.008, { seg: 4 });
  }
}

// ── рейка уровня воды (по образцу набора: штукатурная доска с рисками), 2.0 м — пик наводнения в игре; метки
//    наводнений 1824, 1924, 1955, 1975 (высоты — по настоящим отметкам в масштабе: 421, 380, 293, 281 см над
//    ординаром → 1.95 … 0.97 м): красная черта поперёк рейки и табличка с годом — слева и справа по очереди
{
  const M = new Model('p_cat_mark');
  const D = 0.05, zw = D / 2;
  M.box(C.plaster, -0.08, 0, zw - 0.025, 0.08, 2.0, zw);
  for (let k = 1; k < 20; k++) {
    const y = k * 0.1, long = k % 5 === 0;
    M.box(C.black, -0.08, y - 0.006, zw - 0.027, long ? 0.04 : -0.01, y + 0.006, zw - 0.025, 'pz');
  }
  const marks = [[1824, 421], [1924, 380], [1955, 293], [1975, 281]];
  marks.forEach(([year, cm], k) => {
    const y = 0.4 + (cm - 200) * 0.007;
    const s = k % 2 ? 1 : -1;
    M.box(C.redPaint, -0.1, y - 0.008, zw - 0.03, 0.1, y + 0.008, zw - 0.025);
    // табличка: светлая с тёмной рамкой, год — трафаретом
    const px = 0.0075, tw = textW(String(year), px), pw = tw + 0.03, x0 = s > 0 ? 0.1 : -0.1 - pw;
    M.box(C.signWhite, x0, y - 0.005, zw - 0.012, x0 + pw, y + 0.05, zw);
    M.box(C.black, x0, y - 0.005, zw - 0.013, x0 + pw, y - 0.001, zw - 0.012, 'pz');
    text(M, C.black, String(year), x0 + 0.015, y + 0.0425, zw - 0.012, px);
  });
}

// ── скобы-лестница (набор: ladder_3m) на стене: 2.4 м (ниже пяты свода не уходит — пролёт свода там выше), отнесена
//    от стены на кронштейнах
{
  const M = new Model('p_cat_ladder');
  const W = 0.0925, zr = W - 0.15, sy = 0.8;
  await kit(M, 'ladder_3m', { xf: (p) => [p[0], p[1] * sy, p[2] + zr], nf: (n) => [n[0], n[1] / sy, n[2]], map: () => C.rust });
  for (const y of [0.35, 1.25, 2.15]) {
    for (const s of [-1, 1]) {
      M.tube(C.rustDk, [[s * 0.3, y, zr], [s * 0.3, y, W - 0.01]], 0.014, { seg: 6 });
      M.box(C.steel, s * 0.3 - 0.04, y - 0.05, W - 0.01, s * 0.3 + 0.04, y + 0.05, W);
    }
  }
}

// ═════════════════════════ своды-вкладыши ═════════════════════════

/** Цилиндрический свод под плоским потолком: пролёт S (вдоль X — поперёк хода), длина L (вдоль Z — по ходу), подъём f
 *  (полуциркульный при f = S/2, иначе лучковый); верх (замок) — y = 0, пята — y = −f. Кирпич — текстурой, UV в метрах
 *  (u — по ходу, v — по дуге). Пазухи (между дугой и плоским потолком) закрыты торцами — видно на конце хода. Вдоль пят —
 *  карниз-импост из известняка; rib — подпружная арка посередине (кирпич, на пятах — известняковые камни). */
function vault(id, S, L, f, o = {}) {
  const M = new Model(id, { ceil: true });
  const half = S / 2;
  const R = (half * half + f * f) / (2 * f), yc = -R;
  const t0 = Math.acos(half / R);
  const nA = o.seg ?? 24;
  const arc = (k, r = R) => {
    const t = t0 + ((PI - 2 * t0) * k) / nA;
    return { x: r * Math.cos(t), y: yc + r * Math.sin(t), s: R * (t - t0), t };
  };
  const tile = 1.2;
  // внутренняя поверхность (нормали — к оси)
  for (let k = 0; k < nA; k++) {
    const a = arc(k), b = arc(k + 1);
    const na = [-Math.cos(a.t), -Math.sin(a.t), 0], nb = [-Math.cos(b.t), -Math.sin(b.t), 0];
    M.quad(C.brick, [a.x, a.y, -L / 2], [b.x, b.y, -L / 2], [b.x, b.y, L / 2], [a.x, a.y, L / 2], null, [na, nb, nb, na], [
      [-L / 2 / tile, a.s / tile], [-L / 2 / tile, b.s / tile], [L / 2 / tile, b.s / tile], [L / 2 / tile, a.s / tile],
    ]);
  }
  // торцы пазух: полосы от дуги до потолка
  for (const s of [-1, 1]) {
    for (let k = 0; k < nA; k++) {
      const a = arc(k), b = arc(k + 1);
      if (a.y > -0.002 && b.y > -0.002) continue;
      M.quad(C.brick, [a.x, a.y, s * L / 2], [b.x, b.y, s * L / 2], [b.x, 0, s * L / 2], [a.x, 0, s * L / 2], [0, 0, s]);
    }
  }
  // импост вдоль пят
  for (const s of [-1, 1]) M.box(C.limestone, Math.min(s * half, s * (half - 0.05)), -f - 0.07, -L / 2, Math.max(s * half, s * (half - 0.05)), -f, L / 2, s > 0 ? 'px' : 'nx');
  if (o.rib) {
    const w = 0.19, t = 0.07;
    for (let k = 0; k < nA; k++) {
      const a = arc(k, R - t), b = arc(k + 1, R - t), A = arc(k), B = arc(k + 1);
      const na = [-Math.cos(a.t), -Math.sin(a.t), 0], nb = [-Math.cos(b.t), -Math.sin(b.t), 0];
      M.quad(C.brick, [a.x, a.y, -w], [b.x, b.y, -w], [b.x, b.y, w], [a.x, a.y, w], null, [na, nb, nb, na], [
        [-w / tile, a.s / tile], [-w / tile, b.s / tile], [w / tile, b.s / tile], [w / tile, a.s / tile],
      ]);
      for (const s of [-1, 1]) M.quad(C.brick, [a.x, a.y, s * w], [b.x, b.y, s * w], [B.x, B.y, s * w], [A.x, A.y, s * w], [0, 0, s]);
    }
    for (const s of [-1, 1]) M.box(C.limestone, Math.min(s * half, s * (half - 0.13)), -f - 0.18, -w - 0.03, Math.max(s * half, s * (half - 0.13)), -f + 0.02, w + 0.03, s > 0 ? 'px' : 'nx');
  }
}
vault('p_cat_vault_1', 2.0, 1.0, 1.0);
vault('p_cat_vault_2', 2.0, 2.0, 1.0, { rib: true });
vault('p_cat_vault_4x', 4.0, 2.0, 1.0, { rib: true, seg: 32 });

// ═════════════════════════ мусор ═════════════════════════

/** Бутылка 0.5 л («поллитровка») вдоль локальной оси +Y от донышка y = 0: стекло m, этикетка (label — часть оборота). */
function bottle(M, m, o = {}) {
  const prof = [[0, 0], [0.03, 0.001], [0.035, 0.008], [0.036, 0.02], [0.036, 0.155], [0.032, 0.178], [0.02, 0.2], [0.014, 0.214], [0.0135, 0.242], [0.016, 0.246], [0.016, 0.256], [0.011, 0.258], [0, 0.258]];
  M.lathe(m, o.broken ? prof.slice(0, 5).concat([[0.033, 0.1], [0, 0.1]]) : prof, { seg: 14, crease: 50 });
  if (o.label && !o.broken) M.lathe(C.label, [[0.0365, 0.05], [0.0365, 0.12]], { seg: 14, a0: 0.3, a1: 0.3 + 2 * PI * 0.8 });
}
/** Лежащая бутылка: центр (x, z), поворот a вокруг Y; донышко — −X. */
const lying = (x, z, a) => T([x, 0.036, z], ['y', a], ['z', -PI / 2], ['y', 0]);
const lyingAt = (x, z, a) => ({ R: lying(x, z, a).R, t: add(lying(x, z, a).t, mv(lying(x, z, a).R, [0, -0.13, 0])) });

// ── бутылка зелёная, лежит (вдоль X)
{
  const M = new Model('p_cat_bottle');
  M.at(lyingAt(0, 0, 0), () => bottle(M, C.glassGreen, { label: true }));
}
// ── кучка бутылок: зелёные, прозрачная, коричневая; две стоят, одна разбита (донце и горлышко рядом)
{
  const M = new Model('p_cat_bottles');
  M.at(lyingAt(-0.12, -0.09, 0.35), () => bottle(M, C.glassGreen, { label: true }));
  M.at(lyingAt(0.02, 0.06, -0.6), () => bottle(M, C.glassClear));
  M.at(lyingAt(0.16, -0.13, 1.9), () => bottle(M, C.glassGreen));
  M.at(T([0.2, 0, 0.12]), () => bottle(M, C.glassBrown, { label: true }));
  M.at(T([-0.21, 0, 0.13]), () => bottle(M, C.glassGreen));
  M.at(T([-0.02, 0, -0.17], ['z', 0.08]), () => bottle(M, C.glassGreen, { broken: true }));
  // горлышко отбитой — лежит
  M.at(T([0.05, 0.016, -0.04], ['y', 2.4], ['z', -PI / 2], ['y', 0]), () => M.lathe(C.glassGreen, [[0, 0.17], [0.03, 0.17], [0.032, 0.178], [0.02, 0.2], [0.014, 0.214], [0.0135, 0.242], [0.016, 0.246], [0.016, 0.256], [0, 0.258]].map(([r, y]) => [r, y - 0.17]), { seg: 12, crease: 50 }));
}
// ── банки: ржавая консервная (крышка отогнута) и мятая пивная (лежит)
{
  const M = new Model('p_cat_can');
  const cx = -0.07;
  M.lathe(C.tin, [[0, 0], [0.048, 0], [0.05, 0.005], [0.05, 0.012], [0.048, 0.016], [0.048, 0.088], [0.05, 0.092], [0.05, 0.1], [0.044, 0.102]], { c: [cx, 0, 0], seg: 18, crease: 30 });
  M.lathe(C.rust, [[0.0482, 0.02], [0.0482, 0.05]], { c: [cx, 0, 0], seg: 18, a0: 1, a1: 4 });
  M.lathe(C.label, [[0.0485, 0.03], [0.0485, 0.08]], { c: [cx, 0, 0], seg: 18, a0: 4.2, a1: 6.6 });
  M.disc(C.rustDk, [cx, 0.094, 0], [0, 1, 0], 0.046, 16);
  // крышка на шарнире у края — отогнута вверх
  M.at(T([cx - 0.046, 0.1, 0], ['z', -1.1]), () => {
    M.disc(C.tin, [0.046, 0.001, 0], [0, 1, 0], 0.046, 16);
    M.disc(C.rust, [0.046, -0.001, 0], [0, -1, 0], 0.046, 16);
  });
  // пивная: смята посередине
  M.at(T([0.09, 0.033, 0.03], ['y', 0.5]), () => {
    M.surface(C.canBlue, 16, 8, (u, v) => {
      const x = lerp(-0.06, 0.06, v), f = u * 2 * PI;
      const squash = 1 - 0.55 * Math.exp(-(((x - 0.008) / 0.025) ** 2));
      return [x, 0.033 * Math.sin(f) * squash, 0.033 * Math.cos(f) * (2 - squash) * 0.5 + 0.033 * Math.cos(f) * 0.5];
    }, (u) => [0, Math.sin(u * 2 * PI), Math.cos(u * 2 * PI)]);
    M.disc(C.alu, [-0.06, 0, 0], [-1, 0, 0], 0.033, 14);
    M.disc(C.alu, [0.06, 0, 0], [1, 0, 0], 0.033, 14);
  });
}

/** Газетный лист w × d, чуть покороблен; полосы текста (колонки) и заголовок. */
function newspaper(M, w, d, o = {}) {
  const curl = o.curl ?? 0.012;
  const h = (x, z) => 0.003 + curl * (Math.sin((x / w) * PI * 1.3 + 0.4) * 0.5 + 0.5) * (1 - Math.abs(z / d)) + 0.006 * Math.max(0, x / w - 0.3);
  M.surface(C.paper, 6, 4, (u, v) => {
    const x = lerp(-w / 2, w / 2, u), z = lerp(-d / 2, d / 2, v);
    return [x, h(x, z), z];
  }, [0, 1, 0]);
  const cols = 4, mg = 0.02, cw = (w - 2 * mg) / cols;
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < 9; r++) {
      const x0 = -w / 2 + mg + c * cw + 0.004, x1 = x0 + cw - 0.008, z0 = -d / 2 + mg + 0.05 + r * ((d - 2 * mg - 0.05) / 9), z1 = z0 + 0.012;
      if ((c * 7 + r * 3) % 5 === 0) continue;
      M.surface(C.print, 2, 1, (u, v) => {
        const x = lerp(x0, x1, u), z = lerp(z0, z1, v);
        return [x, h(x, z) + 0.001, z];
      }, [0, 1, 0]);
    }
  }
  M.surface(C.print, 2, 1, (u, v) => {
    const x = lerp(-w / 2 + mg, w / 2 - mg, u), z = lerp(-d / 2 + mg, -d / 2 + mg + 0.03, v);
    return [x, h(x, z) + 0.001, z];
  }, [0, 1, 0]);
}
/** Тряпка: мятое полотно w × d со складками, высота складок hh. */
function rag(M, m, w, d, hh, ph = 0) {
  M.surface(m, 12, 9, (u, v) => {
    const x = lerp(-w / 2, w / 2, u), z = lerp(-d / 2, d / 2, v);
    const edge = Math.min(1, 4 * Math.min(u, 1 - u, v, 1 - v));
    const fold = 0.5 + 0.25 * Math.sin(u * 9 + ph + v * 3) + 0.25 * Math.sin(v * 7 - u * 4 + ph * 2);
    return [x + 0.02 * Math.sin(v * 5 + ph), 0.003 + hh * edge * fold, z + 0.015 * Math.sin(u * 6 + ph)];
  }, [0, 1, 0]);
}
/** Пакет с мусором: мятый эллипсоид и узел сверху. */
function bag(M, m, c, rx, ry, rz) {
  M.blob(m, [c[0], c[1] + ry * 0.8, c[2]], rx, ry, rz, 6, 10);
  M.blob(m, [c[0] + rx * 0.2, c[1] + ry * 1.75, c[2]], rx * 0.18, ry * 0.25, rz * 0.18, 4, 6);
}

// ── куча: грязь с тряпьём, пакеты, газеты, бутылка, банка
{
  const M = new Model('p_cat_trash');
  M.surface(C.dirt, 14, 10, (u, v) => {
    const x = lerp(-0.5, 0.5, u), z = lerp(-0.34, 0.34, v);
    const q = (x / 0.5) ** 2 + (z / 0.34) ** 2;
    return [x, Math.max(0.003, 0.09 * (1 - q) * (1 + 0.3 * Math.sin(x * 23) * Math.sin(z * 17))), z];
  }, [0, 1, 0]);
  bag(M, C.bagBlack, [-0.18, 0.02, 0.06], 0.17, 0.11, 0.14);
  bag(M, C.bagBlue, [0.16, 0.03, 0.08], 0.13, 0.09, 0.12);
  bag(M, C.bagWhite, [0.02, 0.05, -0.1], 0.1, 0.07, 0.09);
  M.at(T([0.25, 0.02, -0.2], ['y', 0.4]), () => newspaper(M, 0.34, 0.24, { curl: 0.02 }));
  M.at(T([-0.3, 0.03, -0.18], ['y', -0.3], ['z', 0.08]), () => rag(M, C.rag, 0.3, 0.2, 0.05, 1.3));
  M.at(T([0.05, 0.06, 0.2], ['y', 1.2]), () => rag(M, C.rag2, 0.26, 0.18, 0.04, 2.1));
  M.at({ R: lyingAt(-0.35, 0.22, 2.6).R, t: add(lyingAt(-0.35, 0.22, 2.6).t, [0, 0.01, 0]) }, () => bottle(M, C.glassBrown));
  M.at(T([0.38, 0.0, 0.15], ['z', 0.3]), () => M.lathe(C.tin, [[0, 0], [0.04, 0], [0.04, 0.08], [0, 0.08]], { seg: 12 }));
}
// ── тряпьё: мятая ветошь и кусок мешковины
{
  const M = new Model('p_cat_rag');
  rag(M, C.rag, 0.42, 0.3, 0.05, 0.5);
  M.at(T([0.06, 0.02, 0.03], ['y', 0.9]), () => rag(M, C.rag2, 0.22, 0.16, 0.04, 2.4));
}
// ── газеты: три листа веером
{
  const M = new Model('p_cat_paper');
  M.at(T([-0.08, 0, -0.04], ['y', 0.25]), () => newspaper(M, 0.42, 0.3));
  M.at(T([0.1, 0.004, 0.05], ['y', -0.35]), () => newspaper(M, 0.42, 0.3, { curl: 0.02 }));
  M.at(T([0.0, 0.008, -0.05], ['y', 1.4]), () => newspaper(M, 0.3, 0.21, { curl: 0.006 }));
}
// ── кирзовый сапог: лежит на боку (сшит стоя — подошва, носок, голенище — и повёрнут)
{
  const M = new Model('p_cat_boot');
  M.at(T([0, 0.055, -0.12], ['x', -PI / 2 + 0.08]), () => {
    M.prism(C.rubber, 'y', rrect(-0.14, -0.05, 0.16, 0.05, 0.045, 0.04, 4), 0, 0.022, { smooth: 50 });
    M.box(C.rubber, -0.14, 0.022, -0.045, -0.06, 0.045, 0.045);
    M.blob(C.boot, [0.04, 0.05, 0], 0.13, 0.055, 0.052, 6, 12);
    M.blob(C.boot, [0.1, 0.045, 0], 0.065, 0.045, 0.05, 5, 10);
    M.lathe(C.boot, [[0.062, 0.03], [0.064, 0.1], [0.06, 0.2], [0.062, 0.3], [0.066, 0.36]], { c: [-0.075, 0, 0], seg: 14, sx: 1, sz: 0.85, smooth: true });
    // складки голенища
    for (const y of [0.15, 0.24]) M.lathe(C.rubber, [[0.063, y - 0.006], [0.066, y], [0.063, y + 0.006]], { c: [-0.075, 0, 0], seg: 14, sz: 0.86, smooth: true });
    M.disc(C.black, [-0.075, 0.355, 0], [0, 1, 0], 0.058, 14, 1);
  });
}

// ═════════════════════════ убежище ═════════════════════════

// ── матрас грязный, полосатый (тик), 1.9 × 0.8 × 0.12, пятна
{
  const M = new Model('p_cat_mattress');
  const X = 0.95, Z = 0.4, H = 0.12;
  const top = (x, z) => H - 0.012 * Math.sin((x / X) * 2.3 + 0.5) ** 2 - 0.01 * (1 - (z / Z) ** 2) * Math.sin(x * 4) ** 2;
  const bands = 12;
  for (let b = 0; b < bands; b++) {
    const z0 = -Z + 0.02 + (b * (2 * Z - 0.04)) / bands, z1 = z0 + (2 * Z - 0.04) / bands;
    M.surface(b % 2 ? C.mattressStripe : C.mattress, 10, 1, (u, v) => {
      const x = lerp(-X + 0.02, X - 0.02, u), z = lerp(z0, z1, v);
      return [x, top(x, z), z];
    }, [0, 1, 0]);
  }
  // бока со скруглением кромки
  const side = (f, n) => M.surface(C.mattress, 10, 3, f, n);
  side((u, v) => {
    const x = lerp(-X + 0.02, X - 0.02, u), a = v * PI / 2;
    return [x, lerp(0.005, top(x, -Z + 0.02), Math.sin(a)) - 0.0, -Z + 0.02 - 0.02 * Math.cos(a)];
  }, [0, 0.3, -1]);
  side((u, v) => {
    const x = lerp(-X + 0.02, X - 0.02, u), a = v * PI / 2;
    return [x, lerp(0.005, top(x, Z - 0.02), Math.sin(a)), Z - 0.02 + 0.02 * Math.cos(a)];
  }, [0, 0.3, 1]);
  side((u, v) => {
    const z = lerp(-Z + 0.02, Z - 0.02, u), a = v * PI / 2;
    return [-X + 0.02 - 0.02 * Math.cos(a), lerp(0.005, top(-X + 0.02, z), Math.sin(a)), z];
  }, [-1, 0.3, 0]);
  side((u, v) => {
    const z = lerp(-Z + 0.02, Z - 0.02, u), a = v * PI / 2;
    return [X - 0.02 + 0.02 * Math.cos(a), lerp(0.005, top(X - 0.02, z), Math.sin(a)), z];
  }, [1, 0.3, 0]);
  // углы — столбики
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) M.cyl(C.mattress, 'y', [sx * (X - 0.02), 0, sz * (Z - 0.02)], 0.005, top(sx * (X - 0.02), sz * (Z - 0.02)), 0.02, 6, false);
  // пятна
  seed = 31;
  for (let k = 0; k < 6; k++) {
    const cx = rr(-0.75, 0.75), cz = rr(-0.28, 0.28), rx = rr(0.06, 0.17), rz = rr(0.05, 0.12);
    const pts = [];
    for (let s = 0; s < 12; s++) {
      const f = (s / 12) * 2 * PI, k2 = 0.8 + 0.25 * Math.sin(f * 3 + k);
      const x = cx + rx * k2 * Math.cos(f), z = cz + rz * k2 * Math.sin(f);
      pts.push([x, top(x, z) + 0.0015, z]);
    }
    M.poly(C.stain, pts, [0, 1, 0]);
  }
}
// ── лавка: две доски на козлах, 1.4 × 0.32 × 0.45
{
  const M = new Model('p_cat_bench');
  M.box(C.wood, -0.7, 0.41, -0.15, 0.7, 0.45, -0.01);
  M.box(C.woodGray, -0.69, 0.41, 0.005, 0.68, 0.45, 0.15);
  for (const x of [-0.52, 0.52]) {
    // козлы: две ноги врастопырку, перекладина под сиденьем и связь
    for (const s of [-1, 1]) {
      M.at(T([x, 0, s * 0.11], ['x', s * 0.12]), () => M.box(C.woodDk, -0.025, 0, -0.022, 0.025, 0.4, 0.022));
    }
    M.box(C.woodDk, x - 0.03, 0.36, -0.16, x + 0.03, 0.41, 0.16);
    M.box(C.woodDk, x - 0.02, 0.14, -0.13, x + 0.02, 0.18, 0.13);
  }
  // гвозди
  for (const x of [-0.52, 0.52]) for (const z of [-0.08, 0.08]) M.cyl(C.steel, 'y', [x, 0, z], 0.45, 0.452, 0.006, 6, true);
}
// ── ящик дощатый с крышкой 0.6 × 0.4 × 0.38, трафарет «ГО-3»
{
  const M = new Model('p_cat_crate');
  const X = 0.3, Z = 0.2, H = 0.38;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) M.box(C.woodDk, sx * X - (sx > 0 ? 0.035 : 0), 0, sz * Z - (sz > 0 ? 0.035 : 0), sx * X + (sx < 0 ? 0.035 : 0), H - 0.02, sz * Z + (sz < 0 ? 0.035 : 0));
  // доски боков с щелями
  for (let k = 0; k < 4; k++) {
    const y0 = 0.02 + k * 0.085, y1 = y0 + 0.075;
    const m = k % 2 ? C.wood : C.woodGray;
    M.box(m, -X + 0.035, y0, -Z, X - 0.035, y1, -Z + 0.018);
    M.box(m, -X + 0.035, y0, Z - 0.018, X - 0.035, y1, Z);
    M.box(m, -X, y0, -Z + 0.035, -X + 0.018, y1, Z - 0.035);
    M.box(m, X - 0.018, y0, -Z + 0.035, X, y1, Z - 0.035);
  }
  // крышка: три доски, одна сдвинута
  M.box(C.wood, -X - 0.005, H - 0.02, -Z - 0.005, X + 0.005, H, -0.07);
  M.box(C.woodGray, -X - 0.005, H - 0.02, -0.065, X + 0.005, H, 0.065);
  M.at(T([0.03, 0, 0], ['y', 0.06]), () => M.box(C.wood, -X - 0.005, H - 0.02, 0.07, X + 0.005, H, Z + 0.005));
  M.box(C.woodDk, -X, 0, -Z, X, 0.012, Z, 'py');
  text(M, C.black, 'ГО-3', -textW('ГО-3', 0.018) / 2, 0.27, -Z, 0.018, 0.001);
}
// ── огарки: на кирпиче три свечи разной высоты, наплывы воска; две у кирпича на полу; коробок спичек
{
  const M = new Model('p_cat_candles');
  M.box(C.brick, -0.13, 0, -0.03, 0.13, 0.065, 0.09);
  const candle = (x, y, z, h, r) => {
    M.lathe(C.wax, [[0, 0], [r * 2.2, 0], [r * 2.4, 0.003], [r * 1.3, 0.008], [r, 0.014], [r, h - 0.006], [r * 0.85, h - 0.002], [r * 0.4, h]], { c: [x, y, z], seg: 12, crease: 35 });
    M.tube(C.black, [[x, y + h - 0.002, z], [x + 0.002, y + h + 0.01, z]], 0.0015, { seg: 4 });
    // потёк по боку
    M.blob(C.wax, [x + r * 0.9, y + h * 0.55, z], 0.004, h * 0.35, 0.004, 4, 6);
  };
  candle(-0.07, 0.065, 0.03, 0.06, 0.012);
  candle(0.0, 0.065, 0.02, 0.035, 0.013);
  candle(0.065, 0.065, 0.045, 0.022, 0.014);
  candle(0.12, 0, -0.07, 0.03, 0.012);
  candle(-0.15, 0, -0.06, 0.018, 0.013);
  M.box(C.yellow, 0.02, 0, -0.1, 0.07, 0.015, -0.065);
  M.box(C.label, 0.025, 0.0151, -0.095, 0.065, 0.0155, -0.07, 'ny');
}

// ═════════════════════════ советское ═════════════════════════

// ── кабельные лотки на стене: два оцинкованных лотка 2.0 м (1.5 и 1.82 м), стойки-консоли, кабели с провисом;
//    один кабель выпал петлёй
{
  const M = new Model('p_cat_cables');
  const D = 0.3, zw = D / 2;
  for (const x of [-0.75, 0.75]) M.box(C.galv, x - 0.025, 1.3, zw - 0.03, x + 0.025, 1.98, zw);
  const trays = [[1.5, 4], [1.82, 3]];
  seed = 41;
  for (const [y, n] of trays) {
    const z0 = zw - 0.03, z1 = zw - 0.28;
    M.box(C.galv, -1.0, y - 0.004, z1, 1.0, y, z0);
    M.box(C.galv, -1.0, y - 0.004, z1 - 0.003, 1.0, y + 0.05, z1);
    M.box(C.galv, -1.0, y - 0.004, z0, 1.0, y + 0.05, z0 + 0.003);
    for (const x of [-0.75, 0.75]) M.box(C.galv, x - 0.02, y - 0.04, z1, x + 0.02, y - 0.004, zw - 0.03);
    for (let k = 0; k < n; k++) {
      const r = rr(0.011, 0.02), z = lerp(z1 + 0.03, z0 - 0.03, (k + 0.5) / n), pts = [];
      for (let s = 0; s <= 10; s++) {
        const x = lerp(-1.0, 1.0, s / 10);
        pts.push([x, y + r + 0.002 + 0.006 * Math.sin(s * 1.7 + k), z + 0.012 * Math.sin(s * 0.9 + k * 2)]);
      }
      M.tube(C.cable, pts, r, { seg: 6 });
    }
  }
  // выпавший кабель: из нижнего лотка петлёй вниз
  const loop = [];
  for (let s = 0; s <= 14; s++) {
    const t = s / 14, x = lerp(0.2, 0.62, t);
    loop.push([x, 1.53 - 0.42 * Math.sin(t * PI) ** 1.4, zw - 0.27 - 0.03 * Math.sin(t * PI)]);
  }
  M.tube(C.cable, loop, 0.014, { seg: 6 });
}
// ── разбитый плафон «колпак» на кронштейне: пластина на стене, трубка-кронштейн, эмалированный колпак, патрон,
//    решётка-клетка погнута, стекла нет (осколки на ободке); не светится
{
  const M = new Model('p_cat_lamp_dead');
  const D = 0.34, zw = D / 2, y = 1.95, zc = zw - 0.2;
  M.box(C.lamp, -0.06, y - 0.05, zw - 0.015, 0.06, y + 0.09, zw);
  M.tube(C.lamp, [[0, y + 0.04, zw - 0.015], [0, y + 0.04, zc + 0.04], [0, y + 0.0, zc]], 0.014, { seg: 6 });
  // колпак: снаружи зелёная эмаль, внутри белая
  const prof = [[0.17, y - 0.12], [0.15, y - 0.09], [0.09, y - 0.04], [0.04, y - 0.01], [0.0, y - 0.005]];
  M.lathe(C.lamp, prof.map(([r, yy]) => [r, yy]).reverse().map(([r, yy]) => [r, yy]), { c: [0, 0, zc], seg: 18, crease: 50 });
  M.lathe(C.whiteEnamel, prof.map(([r, yy]) => [r - 0.004, yy - 0.004]), { c: [0, 0, zc], seg: 18, crease: 50 });
  M.cyl(C.black, 'y', [0, 0, zc], y - 0.08, y - 0.01, 0.022, 10);
  // клетка: обод и 4 погнутые дуги
  const ring = [];
  for (let k = 0; k < 16; k++) ring.push([0.165 * Math.cos((k / 16) * 2 * PI), y - 0.12, zc + 0.165 * Math.sin((k / 16) * 2 * PI)]);
  M.tube(C.steel, ring, 0.005, { seg: 4, closed: true });
  for (let k = 0; k < 4; k++) {
    const f = (k / 4) * 2 * PI + 0.4, bent = k === 1 ? 0.06 : 0;
    const pts = [];
    for (let s = 0; s <= 8; s++) {
      const t = s / 8, r = 0.165 * Math.cos(t * PI / 2) + bent * Math.sin(t * PI);
      pts.push([r * Math.cos(f), y - 0.12 - 0.13 * Math.sin(t * PI / 2) + bent * 0.4 * Math.sin(t * PI), zc + r * Math.sin(f)]);
    }
    M.tube(C.steel, pts, 0.004, { seg: 4 });
  }
  // осколки стекла на ободке
  seed = 51;
  for (let k = 0; k < 5; k++) {
    const f = rr(0, 2 * PI), r = 0.15, h = rr(0.025, 0.06), w = rr(0.025, 0.05);
    const a = [r * Math.cos(f), y - 0.12, zc + r * Math.sin(f)], b = [r * Math.cos(f + w / r), y - 0.12, zc + r * Math.sin(f + w / r)];
    const c = [(r - 0.02) * Math.cos(f + w / r / 2), y - 0.12 - h, zc + (r - 0.02) * Math.sin(f + w / r / 2)];
    M.poly(C.glassFrost, [a, b, c], cross(sub(b, a), sub(c, a)));
    M.poly(C.glassFrost, [a, c, b], mul(cross(sub(b, a), sub(c, a)), -1));
  }
}
// ── табличка-трафарет: «ОТСЕК 4» чёрным и «ГО» красным на светлой жести в красной рамке, на заклёпках
{
  const M = new Model('p_cat_sign');
  const D = 0.02, zw = D / 2, y = 1.6, W = 0.25, H = 0.15;
  M.box(C.signWhite, -W, y - H, zw - 0.006, W, y + H, zw);
  const f = zw - 0.006;
  M.box(C.redPaint, -W + 0.012, y + H - 0.03, f - 0.001, W - 0.012, y + H - 0.018, f, 'pz');
  M.box(C.redPaint, -W + 0.012, y - H + 0.018, f - 0.001, W - 0.012, y - H + 0.03, f, 'pz');
  M.box(C.redPaint, -W + 0.012, y - H + 0.018, f - 0.001, -W + 0.024, y + H - 0.018, f, 'pz');
  M.box(C.redPaint, W - 0.024, y - H + 0.018, f - 0.001, W - 0.012, y + H - 0.018, f, 'pz');
  text(M, C.black, 'ОТСЕК 4', -textW('ОТСЕК 4', 0.016) / 2, y + 0.085, f, 0.016);
  text(M, C.redPaint, 'ГО', -textW('ГО', 0.014) / 2, y - 0.03, f, 0.014);
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) M.cyl(C.steelLt, 'z', [sx * (W - 0.008), y + sy * (H - 0.008), 0], f - 0.003, f, 0.004, 6);
}
// ── электрощит: шкаф 0.5 × 0.7 на высоте 1.0, дверца с ручкой и петлями, знак «молния», трубы-кабелепроводы вверх
//    и вниз
{
  const M = new Model('p_cat_box');
  const D = 0.24, zw = D / 2, y0 = 1.0, y1 = 1.7, X = 0.25, zf = zw - 0.22;
  M.box(C.grayGreen, -X, y0, zf, X, y1, zw);
  M.box(C.grayGreen, -X + 0.02, y0 + 0.02, zf - 0.012, X - 0.02, y1 - 0.02, zf, 'pz');
  M.box(C.black, X - 0.06, y0 + 0.31, zf - 0.03, X - 0.04, y0 + 0.4, zf - 0.012);
  for (const yy of [y0 + 0.1, y1 - 0.1]) M.cyl(C.steel, 'y', [-X + 0.02, 0, zf - 0.012], yy - 0.04, yy + 0.04, 0.01, 6);
  // знак: жёлтый треугольник с чёрной каймой и молнией
  const tc = [0, y0 + 0.5], tr = 0.075, zt = zf - 0.012;
  const triP = (r, dz) => [0, 1, 2].map((k) => [tc[0] + r * Math.cos(PI / 2 + (k * 2 * PI) / 3), tc[1] - 0.02 + r * Math.sin(PI / 2 + (k * 2 * PI) / 3), zt - dz]);
  M.poly(C.black, triP(tr, 0.001), [0, 0, -1]);
  M.poly(C.yellow, triP(tr - 0.012, 0.002), [0, 0, -1]);
  M.poly(C.black, [[0.004, tc[1] + 0.03, zt - 0.003], [-0.016, tc[1] - 0.012, zt - 0.003], [-0.002, tc[1] - 0.006, zt - 0.003]], [0, 0, -1]);
  M.poly(C.black, [[0.002, tc[1] - 0.004, zt - 0.003], [0.012, tc[1] - 0.002, zt - 0.003], [-0.006, tc[1] - 0.05, zt - 0.003]], [0, 0, -1]);
  // кабелепроводы
  for (const x of [-0.12, 0.0, 0.12]) M.cyl(C.steel, 'y', [x, 0, zw - 0.04], y1, 2.0, 0.018, 8, false);
  M.tube(C.steel, [[0.1, y0, zw - 0.05], [0.1, 0.42, zw - 0.05], [0.1, 0.34, zw - 0.02], [0.1, 0.32, zw]], 0.02, { seg: 8 });
}
// ── гермодверь (закрыта, декор): рама-уголок в стене, полотно 0.8 × 1.75 со скруглёнными углами, петли слева,
//    задрайки справа и сверху/снизу, табличка
{
  const M = new Model('p_cat_hermo');
  const D = 0.2, zw = D / 2;
  // рама
  const fr = (x0, y0, x1, y1) => M.box(C.steelLt, x0, y0, zw - 0.06, x1, y1, zw, 'pz');
  fr(-0.55, 0, -0.45, 2.0);
  fr(0.45, 0, 0.55, 2.0);
  fr(-0.45, 1.9, 0.45, 2.0);
  M.box(C.concreteDk, -0.45, 0, zw - 0.03, 0.45, 0.04, zw, 'pz');
  // полотно
  M.prism(C.hermo, 'z', rrect(-0.4, 0.08, 0.4, 1.83, 0.12, 0.12, 5), zw - 0.14, zw - 0.06, { smooth: 30 });
  // рёбра-усиления по полотну
  for (const yy of [0.5, 0.95, 1.4]) M.box(C.hermo, -0.33, yy - 0.025, zw - 0.16, 0.33, yy + 0.025, zw - 0.14, 'pz');
  // петли
  for (const yy of [0.35, 1.55]) {
    M.cyl(C.steel, 'y', [-0.45, 0, zw - 0.12], yy - 0.11, yy + 0.11, 0.035, 10);
    M.box(C.steel, -0.45, yy - 0.08, zw - 0.135, -0.33, yy + 0.08, zw - 0.105, 'pz');
  }
  // задрайки: ступица, рычаг вниз-наружу, шар на конце
  const lever = (x, y, a) => {
    M.cyl(C.steel, 'z', [x, y, 0], zw - 0.18, zw - 0.14, 0.035, 10);
    const e = [x + 0.2 * Math.cos(a), y + 0.2 * Math.sin(a), zw - 0.19];
    M.tube(C.steelLt, [[x, y, zw - 0.18], e], 0.012, { seg: 6 });
    M.blob(C.black, e, 0.022, 0.022, 0.022, 4, 8);
  };
  lever(0.3, 0.45, -PI / 2 + 0.25);
  lever(0.3, 1.0, -PI / 2 + 0.25);
  lever(0.3, 1.55, -PI / 2 + 0.25);
  lever(0.0, 1.72, 0.0);
  // табличка «ГО» над задрайкой
  M.box(C.signWhite, -0.08, 1.2, zw - 0.164, 0.08, 1.3, zw - 0.16, 'pz');
  text(M, C.redPaint, 'ГО', -textW('ГО', 0.014) / 2, 1.285, zw - 0.164, 0.014);
}
// ── пульт насосной: тумба с наклонным столом (лампы, тумблеры, ручка), над ней приборная доска (три манометра),
//    табличка «НС-1»
{
  const M = new Model('p_cat_panel');
  const X = 0.6, Z = 0.25;
  M.box(C.grayGreen, -X, 0, -Z + 0.05, X, 0.75, Z, 'ny');
  M.box(C.black, -X + 0.01, 0, -Z + 0.04, X - 0.01, 0.08, -Z + 0.05, 'ny pz');
  // наклонный стол: от 0.78 спереди до 0.95 сзади
  const zA = -Z, zB = Z - 0.12, yA = 0.8, yB = 0.95;
  M.prism(C.grayGreen, 'x', [[zA, 0.75], [zB, 0.75], [zB, yB], [zA, yA]], -X, X);
  const slope = (t) => [lerp(zA, zB, t), lerp(yA, yB, t)];
  const sn = norm([0, zB - zA, -(yB - yA)]);
  const on = (x, t, h) => { const [z, yy] = slope(t); return [x, yy + h * sn[1], z + h * sn[2]]; };
  // кнопки-лампы и тумблеры рядами
  for (let k = 0; k < 6; k++) {
    const x = -0.45 + k * 0.18;
    M.disc(k % 2 ? C.lampGreen : C.lampRed, on(x, 0.7, 0.008), sn, 0.018, 10);
    M.cyl(C.black, 'y', [0, 0, 0], 0, 0, 0, 3, false);
    const b = on(x, 0.35, 0.0);
    M.at(T(b, ['x', Math.atan2(zB - zA, yB - yA) * 0 + Math.atan2(-(yB - yA), zB - zA)]), () => {
      M.cyl(C.steelLt, 'y', [0, 0, 0], 0, 0.012, 0.014, 8);
      M.at(T([0, 0.012, 0], ['x', 0.4]), () => M.cyl(C.black, 'y', [0, 0, 0], 0, 0.04, 0.004, 6));
    });
  }
  // ручка регулятора
  M.at(T(on(0.42, 0.35, 0), ['x', Math.atan2(-(yB - yA), zB - zA)]), () => M.cyl(C.black, 'y', [0, 0, 0], 0, 0.03, 0.03, 12));
  // приборная доска
  M.box(C.grayGreen, -X, 0.95, Z - 0.12, X, 1.35, Z);
  for (const x of [-0.35, 0, 0.35]) {
    const c = [x, 1.16, Z - 0.12];
    M.cyl(C.black, 'z', c, Z - 0.155, Z - 0.12, 0.085, 18);
    M.disc(C.dial, [x, 1.16, Z - 0.156], [0, 0, -1], 0.072, 18);
    const a = -0.6 + x * 2;
    M.box(C.black, 0, 0, 0, 0, 0, 0);
    M.poly(C.black, [[x, 1.16, Z - 0.158], [x + 0.06 * Math.cos(a + PI / 2) + 0.003, 1.16 + 0.06 * Math.sin(a + PI / 2), Z - 0.158], [x + 0.06 * Math.cos(a + PI / 2) - 0.003, 1.16 + 0.06 * Math.sin(a + PI / 2), Z - 0.158]], [0, 0, -1]);
    for (let k = 0; k <= 6; k++) {
      const f = PI * 1.25 - (k / 6) * PI * 1.5;
      M.box(C.black, x + 0.062 * Math.cos(f) - 0.002, 1.16 + 0.062 * Math.sin(f) - 0.002, Z - 0.1575, x + 0.062 * Math.cos(f) + 0.002, 1.16 + 0.062 * Math.sin(f) + 0.002, Z - 0.156, 'pz');
    }
  }
  M.box(C.signWhite, -0.1, 0.99, Z - 0.124, 0.1, 1.04, Z - 0.12, 'pz');
  text(M, C.black, 'НС-1', -textW('НС-1', 0.008) / 2, 1.035, Z - 0.124, 0.008);
}
// ── кабельный барабан на ребре: щёки из досок Ø 0.9, сердечник, остаток кабеля, конец кабеля на полу, клинья
{
  const M = new Model('p_cat_drum');
  const Rf = 0.45, yc = Rf, xs = 0.25;
  for (const s of [-1, 1]) {
    M.cyl(C.wood, 'x', [0, yc, 0], s > 0 ? xs : -xs - 0.04, s > 0 ? xs + 0.04 : -xs, Rf, 24);
    // доски щеки — тёмные швы снаружи
    for (const z of [-0.27, -0.09, 0.09, 0.27]) {
      const hh = Math.sqrt(Rf * Rf - z * z) - 0.01;
      const xo = s * (xs + 0.0405);
      M.box(C.woodDk, Math.min(xo, xo + s * 0.001), yc - hh, z - 0.004, Math.max(xo, xo + s * 0.001), yc + hh, z + 0.004);
    }
    M.disc(C.black, [s * (xs + 0.0415), yc, 0], [s, 0, 0], 0.05, 12);
    // стяжные болты
    for (let k = 0; k < 6; k++) {
      const f = (k / 6) * 2 * PI;
      M.cyl(C.steel, 'x', [0, yc + 0.2 * Math.sin(f), 0.2 * Math.cos(f)], s * (xs + 0.04), s * (xs + 0.05), 0.012, 6);
    }
  }
  M.cyl(C.woodGray, 'x', [0, yc, 0], -xs, xs, 0.22, 20, false);
  M.cyl(C.cable, 'x', [0, yc, 0], -xs, xs, 0.33, 24, false);
  // витки — поясками
  for (let k = 0; k < 7; k++) M.lathe(C.cable, [[0.33, -xs + 0.035 + k * 0.07 - 0.03], [0.338, -xs + 0.035 + k * 0.07], [0.33, -xs + 0.035 + k * 0.07 + 0.03]], { axis: 'x', c: [0, yc, 0], seg: 24, smooth: true });
  // конец кабеля — свисает и уходит по полу вперёд
  const pts = [[0.15, yc - 0.15, -0.33], [0.16, yc - 0.32, -0.38], [0.18, 0.1, -0.44], [0.2, 0.02, -0.5], [0.15, 0.015, -0.62], [0.05, 0.015, -0.7]];
  M.tube(C.cable, pts, 0.018, { seg: 6, caps: 'end' });
  // клинья под барабаном
  for (const s of [-1, 1]) M.prism(C.woodDk, 'x', [[s * 0.2, 0], [s * 0.42, 0], [s * 0.2, 0.08]].map(([z, yy]) => [z, yy]), -0.1, 0.1);
}
// ── стальная стойка 2.1 м под площадкой убежища: труба Ø 0.1 с опорными пластинами, косынки, анкеры
{
  const M = new Model('p_cat_post');
  M.cyl(C.rust, 'y', [0, 0, 0], 0.012, 2.09, 0.05, 14, false);
  M.box(C.steel, -0.1, 0, -0.1, 0.1, 0.012, 0.1, 'ny');
  M.box(C.steel, -0.1, 2.09, -0.1, 0.1, 2.1, 0.1);
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    M.prism(C.steel, dx ? 'z' : 'x', dx ? [[dx * 0.05, 0.012], [dx * 0.1, 0.012], [dx * 0.05, 0.1]] : [[dz * 0.05, 0.012], [dz * 0.1, 0.012], [dz * 0.05, 0.1]], -0.004, 0.004);
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) M.cyl(C.steelLt, 'y', [sx * 0.075, 0, sz * 0.075], 0.012, 0.03, 0.009, 6);
}

// ═════════════════════════ запись и сверка ═════════════════════════

/** План w × d (м) и верх модели над полом, м (у подвесных — насколько спускается от потолка). */
const EXPECT = {
  p_cat_column_square: [0.8, 0.8, 3.31],
  p_cat_column_round: [0.8, 0.8, 3.31],
  p_cat_column_brick: [0.8, 0.8, 3.31],
  p_cat_column_damaged: [0.8, 0.8, 3.31],
  p_cat_pipe_low: [2.0, 0.52, 0.81],
  p_cat_pipe_mid: [2.0, 0.52, 1.31],
  p_cat_pipe_high: [2.0, 0.52, 1.91],
  p_cat_pipe_wall: [2.0, 0.34, 0.61],
  p_cat_valve: [2.0, 0.65, 1.13],
  p_cat_pump: [2.0, 1.6, 1.7],
  p_cat_rubble: [2.2, 1.5, 0.45],
  p_cat_gate: [1.61, 0.29, 2.0],
  p_cat_mark: [0.48, 0.05, 2.0],
  p_cat_ladder: [0.67, 0.19, 2.4],
  p_cat_vault_1: [2.0, 1.0, 1.07],
  p_cat_vault_2: [2.0, 2.0, 1.18],
  p_cat_vault_4x: [4.0, 2.0, 1.18],
  p_cat_bottle: [0.26, 0.07, 0.07],
  p_cat_bottles: [0.6, 0.45, 0.26],
  p_cat_can: [0.3, 0.2, 0.13],
  p_cat_trash: [1.0, 0.7, 0.25],
  p_cat_rag: [0.5, 0.35, 0.07],
  p_cat_paper: [0.6, 0.45, 0.03],
  p_cat_boot: [0.32, 0.38, 0.12],
  p_cat_mattress: [1.9, 0.8, 0.12],
  p_cat_bench: [1.4, 0.32, 0.45],
  p_cat_crate: [0.6, 0.4, 0.38],
  p_cat_candles: [0.35, 0.2, 0.14],
  p_cat_cables: [2.0, 0.3, 1.98],
  p_cat_lamp_dead: [0.34, 0.34, 2.04],
  p_cat_sign: [0.5, 0.02, 1.75],
  p_cat_box: [0.5, 0.24, 2.0],
  p_cat_hermo: [1.1, 0.2, 2.0],
  p_cat_panel: [1.2, 0.5, 1.35],
  p_cat_drum: [0.58, 0.9, 0.9],
  p_cat_post: [0.2, 0.2, 2.1],
};

/** Центровка на плане: центр габарита (x, z) — в начало (у настенных — по плану тоже; спина у стены — расчёт выше). */
function bounds(M) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const g of M.parts.values()) for (let k = 0; k < g.p.length; k += 3) for (let a = 0; a < 3; a++) (lo[a] = Math.min(lo[a], g.p[k + a])), (hi[a] = Math.max(hi[a], g.p[k + a]));
  return { lo, hi };
}
for (const M of MODELS) {
  const { lo, hi } = bounds(M);
  const dx = -(lo[0] + hi[0]) / 2, dz = -(lo[2] + hi[2]) / 2;
  // мелкий сдвиг центра (свес кронштейна, ручки) — оставить, где модель задана от стены; большой — центровать
  if (Math.abs(dx) > 0.004 || Math.abs(dz) > 0.004) {
    for (const g of M.parts.values()) for (let k = 0; k < g.p.length; k += 3) (g.p[k] += dx), (g.p[k + 2] += dz);
    M.shifted = [dx, dz];
  }
  // низ — на пол (у подвесных — верх в 0)
  const dy = M.ceil ? -hi[1] : lo[1] < -0.002 || lo[1] > 0.002 ? -lo[1] : 0;
  if (dy) for (const g of M.parts.values()) for (let k = 1; k < g.p.length; k += 3) g.p[k] += dy;
}

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
    // UV — только у текстурных (кирпич); остальным PropModels допишет нули
    if (MAT_TILE.get(m)) prim.setAttribute('TEXCOORD_0', acc('VEC2', new Float32Array(g.uv)));
    mesh.addPrimitive(prim);
    verts += g.p.length / 3;
    tris += g.i.length / 3;
  }
  const { lo, hi } = bounds(M);
  const size = [0, 1, 2].map((a) => +(hi[a] - lo[a]).toFixed(3));
  M.stats = { verts, tris, mats: M.parts.size };
  scene.addChild(doc.createNode(M.id).setMesh(mesh).setExtras({ size, ceil: M.ceil, ...M.extras }));
}

await doc.transform(
  weld(),
  dedup(),
  prune({ keepAttributes: true, keepLeaves: true, keepExtras: true }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [512, 512], quality: 80 }),
  // позиции — int16, нормали — int8 (KHR_mesh_quantization: загрузчик Babylon подключён в propModels.ts); UV вне 0…1
  // остаются float
  quantize({ quantizeNormal: 8 }),
);
await io.write(out, doc);

// сверка по записанному файлу: узлы и габариты (с трансформами квантования)
const back = await io.read(out);
const nodes = back.getRoot().listScenes()[0].listChildren();
const seen = new Set();
console.log('узел                      план w × d (ожид.)          верх (ожид.)   X: от … до       Z: от … до      верш.  тр.  мат.');
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
    if (Math.abs(w - e[0]) > 0.06 || Math.abs(d - e[1]) > 0.06) warn += ' ! план';
    if (Math.abs(h - e[2]) > 0.03) warn += ` ! верх ${h.toFixed(2)} ≠ ${e[2]}`;
    if (M.ceil && Math.abs(b.max[1]) > 0.002) warn += ' ! подвесной: верх не в 0';
    if (!M.ceil && Math.abs(b.min[1]) > 0.002) warn += ' ! низ не на полу';
  }
  if (warn) problems++;
  console.log(
    `${id.padEnd(22)} ${(e ? `${w.toFixed(2)} × ${d.toFixed(2)} (${e[0]} × ${e[1]})` : '').padEnd(27)} ${h.toFixed(2).padStart(5)} (${e?.[2] ?? '-'})`.padEnd(66) +
      `${f(0)}  ${f(2)}  ${String(M.stats.verts).padStart(5)} ${String(M.stats.tris).padStart(5)} ${String(M.stats.mats).padStart(3)}${M.shifted ? `  (центр сдвинут ${M.shifted.map((v) => v.toFixed(3)).join(', ')})` : ''}${warn}`,
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
