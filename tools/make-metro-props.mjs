// Модели биома «Метро» (советская колонная станция 1970-х) — из примитивов, без текстур (цвет — в материале):
//
//  • src/view3d/assets/metro_props.glb — узел на предмет, имя узла = id prop проекта (src/data/props.ts, p_metro_*).
//  • Оси узла — как у болванки мебели (src/blockout/babylon.ts): ширина w — вдоль X, глубина (h плана) — вдоль Z,
//    центр габарита на плане — в начале координат, перед — −Z, стена — +Z (z = +глубина/2); низ — пол (y = 0).
//    Настенное (панно, часы-интервал, кабели) — высоты от пола, зад прижат к стене. Подвесное (тег «потолок»: кессон
//    со светом, полоса света, указатель) — верх в y = 0: адаптер ставит модель под потолок комнаты (extras.ceil).
//  • Пути и кромка платформы — накладное на пол (пути в метро «на уровне пола»: декор, проходимы): рельсы вдоль Z,
//    контактный рельс под жёлтым кожухом — на −X (у путевой стены при rot 0), платформа — на +X.
//  • Координаты в коде — как в игре (Babylon, левая система): смотришь на предмет спереди — +X справа. Загрузчик glTF
//    в Babylon зеркалит X (x → −x), поэтому при записи x → −x (с обратным обходом) — в игре выходит как здесь.
//  • Подвижные части (шестерни привода эскалатора) — дочерние узлы `<id>:<k>` в позе покоя, движение — extras.anim
//    { spin, pivot, turns, period } в системе glTF (как у tools/optimize-factory.mjs; крутит src/view3d/propAnim.ts).
//  • Вершинных цветов нет — цвет в материале; материалы по имени общие для всех наборов, поэтому префикс metro_.
//    Каждый материал предмета — отдельный вызов отрисовки: палитра маленькая, материалы переиспользуются.
//    Светятся (emissive → StandardMaterial с disableLighting): metro_light_glow (кессоны, полосы света, свет будки),
//    metro_sign_glow (указатели, вывеска кассы), metro_clock_glow (цифры часов-интервала), metro_go_glow (зелёные
//    огни турникета и пульта).
//  • Обход граней выбирается по нормали (tri), после записи — сверка: узлы, габариты против таблицы EXPECT.
//  • Посмотреть, как в игре (через PropModels): node tools/metro-preview-shots.mjs → tools/qa/metro-view*.png.
//
//   node tools/make-metro-props.mjs
import { Document, NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, quantize, weld } from '@gltf-transform/functions';
import { mkdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../src/view3d/assets/metro_props.glb', import.meta.url));
mkdirSync(fileURLToPath(new URL('../src/view3d/assets/', import.meta.url)), { recursive: true });

const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene('metro');
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
const TAN30 = Math.tan(PI / 6);
/** Базис вращения вокруг оси: (U, A, W) — правая тройка, как (X, Y, Z). */
const BASIS = {
  y: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  z: [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
  x: [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
};
/** Оси, повёрнутые на yaw (вокруг Y), pitch (вокруг X), roll (вокруг Z), рад: [U, V, W] — образы X, Y, Z. */
function axes(yaw = 0, pitch = 0, roll = 0) {
  const rx = (v) => [v[0], v[1] * Math.cos(pitch) - v[2] * Math.sin(pitch), v[1] * Math.sin(pitch) + v[2] * Math.cos(pitch)];
  const rz = (v) => [v[0] * Math.cos(roll) - v[1] * Math.sin(roll), v[0] * Math.sin(roll) + v[1] * Math.cos(roll), v[2]];
  const ry = (v) => [v[0] * Math.cos(yaw) + v[2] * Math.sin(yaw), v[1], -v[0] * Math.sin(yaw) + v[2] * Math.cos(yaw)];
  const f = (v) => ry(rx(rz(v)));
  return [f([1, 0, 0]), f([0, 1, 0]), f([0, 0, 1])];
}
/** Детерминированный «случай» (щебень, обломки). */
let seed = 11;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const rr = (a, b) => a + (b - a) * rnd();

// ───────── материалы ─────────
const hex = (h) => [1, 3, 5].map((k) => +(parseInt(h.slice(k, k + 2), 16) / 255).toFixed(4));
/** Цвет — как в болванке (#rrggbb без перевода в линейный: PropModels кладёт его в StandardMaterial как есть). */
function mat(name, color, o = {}) {
  const m = doc.createMaterial(name).setBaseColorFactor([...hex(color), 1]).setMetallicFactor(0).setRoughnessFactor(o.rough ?? 0.85);
  if (o.glow) m.setEmissiveFactor(hex(o.glow));
  if (o.two) m.setDoubleSided(true);
  return m;
}
const C = {
  // камень: белый мрамор (облицовка, кромка, торцы скамей), серый мрамор (полосы панно, швы, прилавок), красный и
  // чёрный камень (панно, рамы), золотая смальта (панно)
  marble: mat('metro_marble', '#E6E1D6', { rough: 0.3 }),
  marbleGrey: mat('metro_marble_grey', '#8F928C', { rough: 0.35 }),
  red: mat('metro_stone_red', '#A0352A', { rough: 0.4 }),
  black: mat('metro_stone_black', '#232221', { rough: 0.35 }),
  gold: mat('metro_smalt_gold', '#C9A04A', { rough: 0.3 }),
  // металл: бронза (рамы, накладки), алюминий (светильники, стойки, кант), сталь (головка рельса, валы), железо
  // (кронштейны, станины, обгорелый каркас)
  bronze: mat('metro_bronze', '#8E6A36', { rough: 0.35 }),
  alu: mat('metro_alu', '#B7BBBB', { rough: 0.35 }),
  steel: mat('metro_steel', '#C8C8C2', { rough: 0.25 }),
  iron: mat('metro_iron', '#4D5357', { rough: 0.6 }),
  rust: mat('metro_rust', '#463C36', { rough: 0.8 }), // обгорелое железо
  plaster: mat('metro_plaster', '#ECE9E1', { rough: 0.8 }),
  wood: mat('metro_wood', '#87532C', { rough: 0.6 }),
  // пути
  ballast: mat('metro_ballast', '#3E3C39', { rough: 0.95 }),
  sleeper: mat('metro_sleeper', '#4A3B2F', { rough: 0.9 }),
  rail: mat('metro_rail', '#5A524B', { rough: 0.7 }),
  yellow: mat('metro_yellow', '#D9AE22', { rough: 0.5 }),
  // крашеный металл (турникеты, будка), тёмное (резина, кабели, корпуса, проёмы), стекло (тёмное, непрозрачное)
  paint: mat('metro_paint', '#D5CFBD', { rough: 0.55 }),
  dark: mat('metro_dark', '#262729', { rough: 0.5 }),
  glass: mat('metro_glass', '#3C4A50', { rough: 0.1 }),
  green: mat('metro_machine_green', '#4C6A56', { rough: 0.55 }),
  // гарь: уголь (обугленное дерево, копоть), пепел
  char: mat('metro_char', '#161412', { rough: 0.95 }),
  ash: mat('metro_ash', '#67625A', { rough: 0.95 }),
  // светящиеся
  lightGlow: mat('metro_light_glow', '#F3F1E8', { glow: '#F2EFE4' }),
  signGlow: mat('metro_sign_glow', '#EEF2F4', { glow: '#E4EBF0' }),
  clockGlow: mat('metro_clock_glow', '#FF7A2A', { glow: '#FF6A1E' }),
  goGlow: mat('metro_go_glow', '#3BD16A', { glow: '#2EC25C' }),
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

/** Геометрия: примитив на материал. */
class Geo {
  constructor() {
    this.parts = new Map();
  }
  g(m) {
    let x = this.parts.get(m);
    if (!x) this.parts.set(m, (x = { p: [], n: [], i: [] }));
    return x;
  }
  vert(g, p, n) {
    g.p.push(p[0], p[1], p[2]);
    const q = norm(n);
    g.n.push(q[0], q[1], q[2]);
    return g.p.length / 3 - 1;
  }
  /** Четырёхугольник a-b-c-d (по кругу), нормаль n (одна) или ns (на вершину). */
  quad(m, a, b, c, d, n, ns) {
    const g = this.g(m);
    n ??= cross(sub(b, a), sub(c, a));
    const i = [a, b, c, d].map((p, k) => this.vert(g, p, ns ? ns[k] : n));
    tri(g, i[0], i[1], i[2]);
    tri(g, i[0], i[2], i[3]);
  }
  /** Выпуклый многоугольник веером, нормаль n. */
  poly(m, pts, n) {
    const g = this.g(m);
    const i = pts.map((p) => this.vert(g, p, n));
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
    const rings = [];
    const dirs = [];
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
  /** Полуэллипсоид-куча (rx, ry, rz) на полу: основание в c. */
  dome(m, c, rx, ry, rz, lat = 4, seg = 10) {
    const prof = [];
    for (let k = 0; k <= lat; k++) {
      const f = ((PI / 2) * k) / lat;
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
  /** Плашка на стене: выпуклый многоугольник pts (x, y) лицом к −Z, лицо на z, толщина t (вглубь, к +Z). */
  plate(m, pts, z, t) {
    this.prism(m, 'z', pts, z, z + t, { caps: 'a0' });
  }
  /** Поверхность по сетке nu × nv: f(u, v) → точка; нормаль — по направлению hint. */
  surface(m, nu, nv, f, hint) {
    const g = this.g(m), e = 1e-4, ids = [];
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) {
        const u = i / nu, v = j / nv, p = f(u, v);
        const du = sub(f(Math.min(1, u + e), v), f(Math.max(0, u - e), v));
        const dv = sub(f(u, Math.min(1, v + e)), f(u, Math.max(0, v - e)));
        let n = cross(du, dv);
        if (dot(n, hint) < 0) n = mul(n, -1);
        ids.push(this.vert(g, p, n));
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
  /** Камешек — низкий четырёхгранник с гранёной (плоской) заливкой: центр c на полу, размер r, высота h. */
  pebble(m, c, r, h, ang) {
    const pts = [0, 1, 2].map((k) => {
      const f = ang + (k * 2 * PI) / 3 + rr(-0.4, 0.4);
      const q = r * rr(0.7, 1.1);
      return [c[0] + q * Math.cos(f), c[1], c[2] + q * Math.sin(f)];
    });
    const top = [c[0] + rr(-0.3, 0.3) * r, c[1] + h, c[2] + rr(-0.3, 0.3) * r];
    for (let k = 0; k < 3; k++) {
      const a = pts[k], b = pts[(k + 1) % 3];
      let n = cross(sub(b, a), sub(top, a));
      // наружу — от центра основания
      const mid = mul(add(add(a, b), top), 1 / 3);
      if (dot(n, sub(mid, c)) < 0) n = mul(n, -1);
      this.poly(m, [a, b, top], n);
    }
  }
}

/** Модель предмета; kid(anim) — подвижная часть (свой узел `<id>:<k>`, поза покоя — в системе предмета). */
class Model extends Geo {
  constructor(id, o = {}) {
    super();
    this.id = id;
    this.ceil = !!o.ceil;
    this.extras = o.extras ?? {};
    this.kids = [];
    MODELS.push(this);
  }
  /** Подвижная часть: вращение вокруг оси axis через pivot (игровые координаты), turns оборотов за period с. */
  kid(axis, pivot, turns, period) {
    const k = new Geo();
    // в glTF: x → −x у оси и точки; угол в Babylon — с обратным знаком (src/view3d/propAnim.ts babylonMotion)
    k.anim = { spin: [-axis[0], axis[1], axis[2]], pivot: [-pivot[0], pivot[1], pivot[2]], turns: -turns, period };
    this.kids.push(k);
    return k;
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
/** Многоугольник-круг (x, y) радиуса r с центром (cx, cy). */
function circle(cx, cy, r, seg = 24, a0 = 0) {
  const pts = [];
  for (let k = 0; k < seg; k++) {
    const f = a0 + (k / seg) * 2 * PI;
    pts.push([cx + r * Math.cos(f), cy + r * Math.sin(f)]);
  }
  return pts;
}
/** Кольцо в плоскости XY лицом к −Z на z (сектор a0…a1 или полное): rIn…rOut, толщина t вглубь. */
function ringXY(M, m, cx, cy, z, rIn, rOut, t, seg = 24) {
  for (let k = 0; k < seg; k++) {
    const f0 = (k / seg) * 2 * PI, f1 = ((k + 1) / seg) * 2 * PI;
    const P = (r, f) => [cx + r * Math.cos(f), cy + r * Math.sin(f)];
    M.plate(m, [P(rIn, f0), P(rOut, f0), P(rOut, f1), P(rIn, f1)], z, t);
  }
}

// ═════════════════════════ предметы ═════════════════════════

// ── пути (s — масштаб поперёк и по высоте: 1 — зал, 0.5 — станция поменьше, 0.25 — крошечная): насыпь тёмного
//    щебня (пологий бугор + камешки), деревянные шпалы (на 9 м — 16/s штук, кусок стыкуется с соседним торцами),
//    два рельса (колея 1.52·s, подошва, шейка, головка — накатанный верх светлее) на подкладках, контактный рельс на
//    кронштейнах с изоляторами под жёлтым кожухом — на −X (у путевой стены); платформа — на +X
function track(M, s) {
  const W = 3.0 * s, L = 9.0, hw = W / 2;
  // насыпь: сходит на нет к краям, бугры периодичны по Z (период 9 м — стык с соседним куском)
  const bump = (x, z) => 0.012 * Math.sin((2 * PI * 3 * (z + 4.5)) / 9 + x * 3.1) + 0.008 * Math.sin((2 * PI * 7 * (z + 4.5)) / 9 + 1.7 + x * 5.3);
  const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
  const top = (x, z) => s * smooth((hw - Math.abs(x)) / (0.35 * s)) * (0.06 + bump(x / s, z));
  M.surface(C.ballast, Math.max(6, Math.round(12 * s)), 36, (u, v) => {
    const x = lerp(-hw, hw, u), z = lerp(-L / 2, L / 2, v);
    return [x, top(x, z) + 0.001, z];
  }, [0, 1, 0]);
  // щебень россыпью: гранёные камешки (не на шпалах)
  const n = Math.round(260 * s);
  const pitch = 9 / Math.round(16 / Math.max(s, 0.5));
  for (let k = 0; k < n; k++) {
    const x = rr(-hw + 0.15 * s, hw - 0.15 * s), z = rr(-L / 2 + 0.03, L / 2 - 0.03);
    const ph = (((z + L / 2) / pitch) % 1 + 1) % 1;
    if (Math.abs(ph - 0.5) < 0.26 && Math.abs(x - 0.04 * s) < 1.36 * s) continue;
    const r = rr(0.025, 0.05) * Math.sqrt(s);
    M.pebble(C.ballast, [x, top(x, z) - 0.004 * s, z], r, r * rr(0.6, 1.0), rnd() * 2 * PI);
  }
  // шпалы
  // у крошечной станции шпалы реже (как у мини), без подкладок и изоляторов — меньше вершин
  const nSl = Math.round(16 / Math.max(s, 0.5)), fine = s >= 0.5;
  const sx0 = -1.32 * s, sx1 = 1.40 * s, sy0 = 0.03 * s, sy1 = 0.105 * s, sw = 0.24 * s;
  const cx = 0.08 * s, gauge = 0.76 * s;
  const crx = -1.12 * s;
  for (let k = 0; k < nSl; k++) {
    const z = -L / 2 + pitch * (k + 0.5);
    M.box(C.sleeper, sx0, sy0, z - sw / 2, sx1, sy1, z + sw / 2, 'ny');
    // подкладки под рельсы
    if (fine) for (const rx of [cx - gauge, cx + gauge]) M.box(C.rail, rx - 0.1 * s, sy1, z - 0.085 * s, rx + 0.1 * s, sy1 + 0.014 * s, z + 0.085 * s, 'ny');
    // кронштейн контактного рельса — на каждой второй шпале: стойка, изолятор, лапа над рельсом
    if (k % 2 === 0) {
      const bx = crx - 0.15 * s;
      M.box(C.rail, bx - 0.025 * s, sy1, z - 0.04 * s, bx + 0.025 * s, 0.335 * s, z + 0.04 * s, 'ny');
      M.box(C.rail, bx - 0.025 * s, 0.30 * s, z - 0.035 * s, crx + 0.03 * s, 0.335 * s, z + 0.035 * s, 'px');
      // изолятор (бурый фарфор) на стойке
      if (fine) M.lathe(C.sleeper, [[0.025 * s, 0.15 * s], [0.045 * s, 0.15 * s], [0.045 * s, 0.165 * s], [0.034 * s, 0.18 * s], [0.045 * s, 0.195 * s], [0.045 * s, 0.215 * s], [0.034 * s, 0.23 * s], [0.025 * s, 0.23 * s]], { c: [bx, 0, z], seg: 8 });
    }
  }
  // рельсы: подошва, шейка, головка; верх головки — накатанная сталь
  for (const rx of [cx - gauge, cx + gauge]) {
    const y0 = sy1 + 0.014 * s;
    M.box(C.rail, rx - 0.065 * s, y0, -L / 2, rx + 0.065 * s, y0 + 0.012 * s, L / 2, 'ny pz nz');
    M.box(C.rail, rx - 0.009 * s, y0 + 0.012 * s, -L / 2, rx + 0.009 * s, y0 + 0.11 * s, L / 2, 'ny pz nz');
    M.box(C.rail, rx - 0.036 * s, y0 + 0.11 * s, -L / 2, rx + 0.036 * s, y0 + 0.15 * s, L / 2, 'py pz nz');
    M.quad(C.steel, [rx - 0.036 * s, y0 + 0.15 * s, -L / 2], [rx + 0.036 * s, y0 + 0.15 * s, -L / 2], [rx + 0.036 * s, y0 + 0.15 * s, L / 2], [rx - 0.036 * s, y0 + 0.15 * s, L / 2], [0, 1, 0]);
  }
  // контактный рельс (снизу — токосъём) и кожух: верхняя доска и наклонный щиток к стене
  M.box(C.steel, crx - 0.04 * s, 0.205 * s, -L / 2, crx + 0.04 * s, 0.24 * s, L / 2, 'py pz nz');
  M.box(C.rail, crx - 0.03 * s, 0.24 * s, -L / 2, crx + 0.03 * s, 0.30 * s, L / 2, 'pz nz');
  M.prism(C.yellow, 'z', [[crx - 0.1 * s, 0.335 * s], [crx + 0.09 * s, 0.335 * s], [crx + 0.09 * s, 0.353 * s], [crx - 0.08 * s, 0.357 * s]], -L / 2, L / 2, { caps: false });
  M.prism(C.yellow, 'z', [[crx - 0.115 * s, 0.24 * s], [crx - 0.1 * s, 0.24 * s], [crx - 0.08 * s, 0.357 * s], [crx - 0.1 * s, 0.357 * s]], -L / 2, L / 2, { caps: false });
}
track(new Model('p_metro_track'), 1);
track(new Model('p_metro_mini_track'), 0.5);
track(new Model('p_metro_micro_track'), 0.25);

// ── кромка платформы: плиты светлого гранита (швы через 0.9 м серым) со скруглённым носиком к путям (−X), жёлтая
//    предупредительная линия
function edge(M, s) {
  const W = 0.4 * s, L = 9.0, hw = W / 2, H = 0.025 * Math.max(s, 0.4);
  M.prism(C.marble, 'z', [[-hw, 0], [hw, 0], [hw, H], [-hw + 0.035 * s, H], [-hw + 0.01 * s, H * 0.78], [-hw, H * 0.45]], -L / 2, L / 2, { caps: false, smooth: 50 });
  const y = H + 0.0008;
  M.quad(C.yellow, [-hw + 0.13 * s, y, -L / 2], [-hw + 0.21 * s, y, -L / 2], [-hw + 0.21 * s, y, L / 2], [-hw + 0.13 * s, y, L / 2], [0, 1, 0]);
  for (let k = 0; k <= 10; k++) {
    const z = -L / 2 + k * 0.9;
    const z0 = Math.max(-L / 2, z - 0.004), z1 = Math.min(L / 2, z + 0.004);
    M.quad(C.marbleGrey, [-hw + 0.035 * s, y - 0.0003, z0], [hw, y - 0.0003, z0], [hw, y - 0.0003, z1], [-hw + 0.035 * s, y - 0.0003, z1], [0, 1, 0]);
  }
}
edge(new Model('p_metro_edge'), 1);
edge(new Model('p_metro_mini_edge'), 0.5);
edge(new Model('p_metro_micro_edge'), 0.25);

// ── мозаичное панно путевой стены (флорентийская мозаика из камня): рама чёрного камня, поле белого мрамора; в центре
//    круг-эмблема (чёрное кольцо, красный круг, золотой поясок, белая звезда), золотые лучи, две «орбиты»; внизу —
//    клинья-треугольники красного, чёрного и серого камня и полосы красного/чёрного/серого; вверху — малые круги и
//    золотая нить. s — масштаб, y0 — низ панно, zb — стена (зад модели), сверху вниз слои выступают к −Z
function panel(M, s, y0, zb) {
  // габарит с рамой — 2.4·s × 2.6·s; поле внутри рамы шириной fw, рисунок (u −1.2…1.2, v 0…2.6) ужат в поле
  const fw = 0.06 * s, hw = 1.2 * s - fw, H = 2.6 * s - 2 * fw, t = 0.03 * s, ks = 0.95;
  const zf = zb - t; // лицо поля
  const yF = y0 + fw; // низ поля
  const X = (u) => u * s * ks, Y = (v) => yF + v * s * (H / (2.6 * s)), R = (r) => r * s * ks;
  const P = (u, v) => [X(u), Y(v)];
  const L = [zf - 0.002 * s, zf - 0.004 * s, zf - 0.006 * s, zf - 0.008 * s, zf - 0.01 * s];
  // поле
  M.box(C.marble, -hw, yF, zf, hw, yF + H, zb, 'pz');
  // рама: выступает на 1.5 см
  const fz = zf - 0.015 * s;
  M.box(C.black, -hw - fw, y0, fz, hw + fw, yF, zb, 'pz');
  M.box(C.black, -hw - fw, yF + H, fz, hw + fw, yF + H + fw, zb, 'pz');
  M.box(C.black, -hw - fw, yF, fz, -hw, yF + H, zb, 'pz py ny');
  M.box(C.black, hw, yF, fz, hw + fw, yF + H, zb, 'pz py ny');
  // полосы внизу
  M.plate(C.black, [P(-1.2, 0.1), P(1.2, 0.1), P(1.2, 0.2), P(-1.2, 0.2)], L[0], 0.002 * s);
  M.plate(C.red, [P(-1.2, 0.2), P(1.2, 0.2), P(1.2, 0.3), P(-1.2, 0.3)], L[0], 0.002 * s);
  M.plate(C.marbleGrey, [P(-1.2, 0.33), P(1.2, 0.33), P(1.2, 0.38), P(-1.2, 0.38)], L[0], 0.002 * s);
  // пояс ромбов — красные и чёрные вперемешку (перекликается с узором гранитного пола)
  for (let k = 0; k < 16; k++) {
    const u = -1.125 + k * 0.15;
    M.plate(k % 2 ? C.black : C.red, [P(u - 0.065, 0.415), P(u, 0.385), P(u + 0.065, 0.415), P(u, 0.445)], L[0], 0.002 * s);
  }
  // клинья
  M.plate(C.red, [P(-1.2, 0.45), P(-0.15, 0.45), P(-1.2, 1.55)], L[1], 0.004 * s);
  M.plate(C.black, [P(1.2, 0.45), P(0.2, 0.45), P(1.2, 1.25)], L[1], 0.004 * s);
  M.plate(C.marbleGrey, [P(-0.55, 0.45), P(0.62, 0.45), P(0.05, 0.98)], L[2], 0.006 * s);
  M.plate(C.gold, [P(-1.2, 0.45), P(-0.8, 0.45), P(-1.2, 0.87)], L[2], 0.006 * s);
  // лучи от эмблемы — длинные и короткие вперемешку
  const cx = 0, cy = 1.62;
  for (let k = 0; k < 16; k++) {
    const f = (k / 16) * 2 * PI + PI / 32;
    const r0 = 0.66, r1 = k % 2 ? 0.86 : 1.02, dw = 0.035;
    const d = [Math.cos(f), Math.sin(f)], nn = [-d[1], d[0]];
    const a = [cx + d[0] * r0 + nn[0] * dw, cy + d[1] * r0 + nn[1] * dw];
    const b = [cx + d[0] * r0 - nn[0] * dw, cy + d[1] * r0 - nn[1] * dw];
    const c = [cx + d[0] * r1, cy + d[1] * r1];
    if (c[1] > 2.55 || c[1] < 0.5) continue;
    M.plate(C.gold, [P(...a), P(...b), P(...c)], L[1], 0.004 * s);
  }
  // эмблема: чёрное кольцо, красный круг, золотой поясок, красная серёдка, белая звезда
  M.plate(C.black, circle(X(cx), Y(cy), R(0.64), 32), L[2], 0.006 * s);
  M.plate(C.red, circle(X(cx), Y(cy), R(0.57), 32), L[3], 0.002 * s);
  ringXY(M, C.gold, X(cx), Y(cy), L[4], R(0.4), R(0.45), 0.002 * s, 32);
  // звезда: пятиугольник + пять лучей
  const star = (R, r) => {
    const outer = [], inner = [];
    for (let k = 0; k < 5; k++) {
      const f = PI / 2 + (k * 2 * PI) / 5;
      outer.push([X(cx + R * Math.cos(f)), Y(cy + R * Math.sin(f))]);
      const g = f + PI / 5;
      inner.push([X(cx + r * Math.cos(g)), Y(cy + r * Math.sin(g))]);
    }
    const z = L[4] - 0.002 * s;
    M.plate(C.marble, inner, z, 0.004 * s);
    for (let k = 0; k < 5; k++) M.plate(C.marble, [inner[(k + 4) % 5], outer[k], inner[k]], z, 0.004 * s);
  };
  star(0.3, 0.12);
  // орбиты — тонкие трубки-эллипсы вокруг эмблемы
  for (const tilt of [0.42, -0.42]) {
    const pts = [];
    for (let k = 0; k < 40; k++) {
      const f = (k / 40) * 2 * PI;
      const ex = 0.98 * Math.cos(f), ey = 0.3 * Math.sin(f);
      pts.push([X(cx + ex * Math.cos(tilt) - ey * Math.sin(tilt)), Y(cy + ex * Math.sin(tilt) + ey * Math.cos(tilt)), L[4] - 0.008 * s]);
    }
    M.tube(C.gold, pts, 0.011 * s, { seg: 4, closed: true });
  }
  // малые круги-«планеты» и золотая нить вверху
  M.plate(C.black, circle(X(-0.86), Y(2.22), R(0.13), 16), L[1], 0.004 * s);
  M.plate(C.red, circle(X(0.9), Y(2.18), R(0.09), 16), L[1], 0.004 * s);
  M.plate(C.gold, circle(X(0.66), Y(2.38), R(0.05), 12), L[1], 0.004 * s);
  M.plate(C.gold, [P(-1.2, 2.47), P(1.2, 2.47), P(1.2, 2.5), P(-1.2, 2.5)], L[0], 0.002 * s);
  M.plate(C.marbleGrey, [P(-1.2, 2.52), P(-0.3, 2.52), P(-0.3, 2.56), P(-1.2, 2.56)], L[0], 0.002 * s);
}
// зал: панно 2.4 × 2.6 на 1.0…3.6 м; глубина плана 0.06, зад выступает к стене до +0.05 (снап wall() — 5 см)
panel(new Model('p_metro_panel'), 1, 1.0, 0.05);
panel(new Model('p_metro_mini_panel'), 0.5, 0.9, 0.05);
panel(new Model('p_metro_micro_panel'), 0.25, 0.75, 0.05);

// ── кессон потолка 3.0 × 4.5 (подвесной: верх — 0): рёбра по краю (соседние кессоны складываются в ребро 16 см),
//    внутренняя ступень, две полосы света в алюминиевых коробах вдоль Z (светится — metro_light_glow)
{
  const M = new Model('p_metro_light', { ceil: true });
  const hx = 1.5, hz = 2.25, D = 0.3;
  // рёбра — половина ширины ребра на каждом краю
  M.box(C.plaster, -hx, -D, -hz, -hx + 0.08, 0, hz, 'py');
  M.box(C.plaster, hx - 0.08, -D, -hz, hx, 0, hz, 'py');
  M.box(C.plaster, -hx + 0.08, -D, -hz, hx - 0.08, 0, -hz + 0.08, 'py px nx');
  M.box(C.plaster, -hx + 0.08, -D, hz - 0.08, hx - 0.08, 0, hz, 'py px nx');
  // ступень
  const s0 = 0.08, s1 = 0.2, d2 = 0.17;
  M.box(C.plaster, -hx + s0, -d2, -hz + s0, -hx + s1, 0, hz - s0, 'py nx pz nz');
  M.box(C.plaster, hx - s1, -d2, -hz + s0, hx - s0, 0, hz - s0, 'py px pz nz');
  M.box(C.plaster, -hx + s1, -d2, -hz + s0, hx - s1, 0, -hz + s1, 'py px nx nz');
  M.box(C.plaster, -hx + s1, -d2, hz - s1, hx - s1, 0, hz - s0, 'py px nx pz');
  // полосы света
  for (const x of [-0.55, 0.55]) {
    M.box(C.alu, x - 0.13, -0.09, -hz + 0.36, x + 0.13, 0, hz - 0.36, 'py');
    M.prism(C.lightGlow, 'z', [[x - 0.1, -0.09], [x + 0.1, -0.09], [x + 0.07, -0.11], [x - 0.07, -0.11]], -hz + 0.4, hz - 0.4, { caps: false, smooth: 60 });
    for (const z of [-hz + 0.4, hz - 0.4]) M.box(C.alu, x - 0.1, -0.112, z - 0.012, x + 0.1, -0.09, z + 0.012);
  }
}

// ── полоса света 0.3 × 4.5 (подвесной: верх — 0): алюминиевый короб и светящийся рассеиватель
{
  const M = new Model('p_metro_light_strip', { ceil: true });
  const hz = 2.25;
  M.box(C.alu, -0.15, -0.09, -hz, 0.15, 0, hz, 'py');
  M.prism(C.lightGlow, 'z', [[-0.12, -0.09], [0.12, -0.09], [0.09, -0.12], [-0.09, -0.12]], -hz + 0.04, hz - 0.04, { caps: false, smooth: 60 });
  for (const z of [-hz + 0.04, hz - 0.04]) M.box(C.alu, -0.12, -0.122, z - 0.012, 0.12, -0.09, z + 0.012);
}

// ── скамья двусторонняя 2.4 × 0.9: торцы белого мрамора (трапеция с высокой серединой, бронзовая накладка-круг),
//    деревянные сиденья из реек на обе стороны, спинка — доска посередине с рейками с обеих сторон, тёмные балки
{
  const M = new Model('p_metro_bench');
  const ends = [[-0.45, 0], [0.45, 0], [0.45, 0.44], [0.16, 1.0], [-0.16, 1.0], [-0.45, 0.44]];
  for (const sx of [-1, 1]) {
    const x0 = sx < 0 ? -1.2 : 1.08, x1 = sx < 0 ? -1.08 : 1.2;
    M.prism(C.marble, 'x', ends, x0, x1, { smooth: 0 });
    // бронзовая накладка на наружной грани торца и кант по верху
    const xo = sx < 0 ? -1.2 - 0.004 : 1.2 + 0.004;
    M.disc(C.bronze, [xo, 0.66, 0], [sx, 0, 0], 0.075, 16);
    M.box(C.bronze, x0 - 0.004, 1.0, -0.16, x1 + 0.004, 1.012, 0.16, 'ny');
  }
  // балки под сиденьями
  for (const sz of [-1, 1]) M.box(C.dark, -1.08, 0.3, sz * 0.32 - 0.03, 1.08, 0.4, sz * 0.32 + 0.03, 'px nx');
  M.box(C.dark, -1.08, 0.08, -0.04, 1.08, 0.16, 0.04, 'px nx');
  // сиденья: 5 реек на сторону
  for (const sz of [-1, 1]) {
    for (let k = 0; k < 5; k++) {
      const z = sz * (0.13 + k * 0.066);
      M.box(C.wood, -1.08, 0.4, z - 0.028, 1.08, 0.44, z + 0.028, 'px nx');
    }
  }
  // спинка: средняя доска и по три рейки с каждой стороны, чуть откинуты
  M.box(C.wood, -1.08, 0.44, -0.025, 1.08, 0.96, 0.025, 'px nx');
  for (const sz of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const y = 0.56 + k * 0.14, z = sz * (0.05 + k * 0.015);
      M.box(C.wood, -1.08, y, z - 0.022, 1.08, y + 0.09, z + 0.022, 'px nx');
    }
  }
}

// ── указатель подвесной 1.6 × 0.15 (верх — 0, низ — −0.75): две трубки-подвеса, световой короб — алюминиевый кант,
//    тёмное лицо с обеих сторон: «М» в светлом круге слева, две «строки» светящихся полосок, стрелка вверх справа
//    (с обратной стороны — так же, как видно оттуда)
{
  const M = new Model('p_metro_sign', { ceil: true });
  for (const x of [-0.6, 0.6]) {
    M.tube(C.alu, [[x, 0, 0], [x, -0.36, 0]], 0.012, { seg: 6 });
    M.lathe(C.alu, [[0, -0.012], [0.04, -0.012], [0.045, 0]], { c: [x, 0, 0], seg: 10 });
  }
  M.box(C.alu, -0.8, -0.75, -0.06, 0.8, -0.35, 0.06);
  for (const sz of [-1, 1]) {
    const z = sz * 0.0605, zz = sz * 0.062, zzz = sz * 0.0635;
    const X = (x) => x * -sz; // с обратной стороны — зеркально: «М» и там слева
    const face = (m, pts, zf) => M.poly(m, pts.map(([x, y]) => [X(x), y, zf]), [0, 0, sz]);
    face(C.dark, [[-0.77, -0.72], [0.77, -0.72], [0.77, -0.38], [-0.77, -0.38]], z);
    // «М» в круге
    face(C.signGlow, circle(-0.6, -0.55, 0.13, 20), zz);
    const m = [[-0.68, -0.62], [-0.65, -0.62], [-0.65, -0.48], [-0.68, -0.48]];
    const mR = m.map(([x, y]) => [-1.2 - x, y]);
    face(C.red, m, zzz);
    face(C.red, mR, zzz);
    face(C.red, [[-0.68, -0.48], [-0.65, -0.48], [-0.595, -0.57], [-0.605, -0.585]], zzz);
    face(C.red, [[-0.52, -0.48], [-0.55, -0.48], [-0.605, -0.57], [-0.595, -0.585]], zzz);
    // «строки»
    let x = -0.38;
    for (const w of [0.16, 0.1, 0.22]) {
      face(C.signGlow, [[x, -0.53], [x + w, -0.53], [x + w, -0.47], [x, -0.47]], zz);
      x += w + 0.05;
    }
    x = -0.38;
    for (const w of [0.12, 0.19, 0.08, 0.1]) {
      face(C.signGlow, [[x, -0.63], [x + w, -0.63], [x + w, -0.595], [x, -0.595]], zz);
      x += w + 0.04;
    }
    // стрелка вверх
    face(C.signGlow, [[0.565, -0.68], [0.635, -0.68], [0.635, -0.52], [0.565, -0.52]], zz);
    face(C.signGlow, [[0.5, -0.53], [0.7, -0.53], [0.6, -0.42]], zz);
  }
}

// ── турникет АКП-73 (одна тумба) 0.2 × 1.3: светлый крашеный корпус со скруглёнными концами по ходу (Z), тёмный
//    цоколь, алюминиевые отбойники, на входе (−Z) — тёмная голова с жетоноприёмником и зелёным огнём, на боках у
//    выхода — щели створок (створки убраны — проход открыт)
{
  const M = new Model('p_metro_turnstile');
  const hx = 0.09;
  M.prism(C.paint, 'x', rrect(-0.6, 0.06, 0.6, 0.9, 0.14, 0, 4), -hx, hx, { smooth: 30 });
  M.box(C.dark, -hx + 0.01, 0, -0.55, hx - 0.01, 0.06, 0.55, 'ny');
  // голова на входе: наклонная крышка с прорезью и огнями
  M.prism(C.dark, 'x', [[-0.65, 0.78], [-0.3, 0.78], [-0.3, 1.0], [-0.42, 1.0], [-0.65, 0.88]], -hx - 0.01, hx + 0.01, { smooth: 0 });
  M.box(C.alu, -0.03, 0.999, -0.4, 0.03, 1.003, -0.34);
  M.box(C.dark, -0.012, 1.003, -0.385, 0.012, 1.004, -0.355);
  // огни на скосе головы (скос от (z −0.65, y 0.88) к (z −0.42, y 1.0)): зелёный горит, красный — нет
  const n = norm([0, 0.23, -0.12]);
  M.disc(C.goGlow, add([0, 0.916, -0.581], mul(n, 0.003)), n, 0.022, 10);
  M.disc(C.red, add([0, 0.964, -0.489], mul(n, 0.003)), n, 0.018, 10);
  // отбойники и щели створок
  for (const sx of [-1, 1]) {
    M.box(C.alu, sx < 0 ? -hx - 0.012 : hx, 0.5, -0.5, sx < 0 ? -hx : hx + 0.012, 0.53, 0.55);
    const x = sx * (hx + 0.0008);
    M.quad(C.dark, [x, 0.38, 0.18], [x, 0.38, 0.44], [x, 0.74, 0.44], [x, 0.74, 0.18], [sx, 0, 0]);
  }
  M.box(C.alu, -hx - 0.005, 0.9, -0.3, hx + 0.005, 0.915, 0.48);
}

// ── касса 2.4 × 1.2 (задом к стене): мраморные бока и низ, прилавок серого мрамора, два окошка в тёмном остеклении с
//    бронзовыми переплётами, над ними световая полоса с тёмными «буквами», бронзовый карниз
{
  const M = new Model('p_metro_kassa');
  const hx = 1.2, z0 = -0.6, z1 = 0.6;
  M.box(C.marble, -hx, 0, z0, hx, 1.0, z0 + 0.12, 'pz');
  M.box(C.marble, -hx, 0, z0, -hx + 0.12, 2.45, z1, 'pz');
  M.box(C.marble, hx - 0.12, 0, z0, hx, 2.45, z1, 'pz');
  M.box(C.marbleGrey, -hx + 0.08, 1.0, z0 - 0.1, hx - 0.08, 1.05, z0 + 0.14, 'pz');
  // остекление: тёмное стекло чуть в глубине, окошки — проёмы в нём, за ними тёмное нутро
  const zg = z0 + 0.08;
  const win = [[-0.75, -0.35], [0.35, 0.75]];
  const gx = [-hx + 0.12, win[0][0], win[0][1], win[1][0], win[1][1], hx - 0.12];
  for (let k = 0; k + 1 < gx.length; k += 2) M.quad(C.glass, [gx[k], 1.05, zg], [gx[k + 1], 1.05, zg], [gx[k + 1], 1.4, zg], [gx[k], 1.4, zg], [0, 0, -1]);
  M.quad(C.glass, [-hx + 0.12, 1.4, zg], [hx - 0.12, 1.4, zg], [hx - 0.12, 2.05, zg], [-hx + 0.12, 2.05, zg], [0, 0, -1]);
  for (const [a, b] of win) {
    // нутро окошка — ниша, грани смотрят внутрь
    const zn = zg + 0.3;
    M.quad(C.dark, [a, 1.05, zg], [b, 1.05, zg], [b, 1.05, zn], [a, 1.05, zn], [0, 1, 0]);
    M.quad(C.dark, [a, 1.4, zg], [b, 1.4, zg], [b, 1.4, zn], [a, 1.4, zn], [0, -1, 0]);
    M.quad(C.dark, [a, 1.05, zg], [a, 1.4, zg], [a, 1.4, zn], [a, 1.05, zn], [1, 0, 0]);
    M.quad(C.dark, [b, 1.05, zg], [b, 1.4, zg], [b, 1.4, zn], [b, 1.05, zn], [-1, 0, 0]);
    M.quad(C.dark, [a, 1.05, zn], [b, 1.05, zn], [b, 1.4, zn], [a, 1.4, zn], [0, 0, -1]);
    // бронзовая рамка окошка
    M.box(C.bronze, a - 0.03, 1.4, zg - 0.03, b + 0.03, 1.43, zg);
    for (const x of [a - 0.03, b]) M.box(C.bronze, x, 1.05, zg - 0.03, x + 0.03, 1.4, zg);
  }
  // переплёты: стойки и ригели
  for (const x of [-hx + 0.12, -0.05, 0.05, hx - 0.12]) M.box(C.bronze, x - 0.02, 1.05, zg - 0.025, x + 0.02, 2.05, zg, 'pz');
  for (const y of [1.6, 2.05]) M.box(C.bronze, -hx + 0.12, y - 0.02, zg - 0.025, hx - 0.12, y + 0.02, zg, 'pz');
  // мраморный фриз за вывеской (между остеклением и карнизом), световая полоса с «буквами»
  M.box(C.marble, -hx + 0.12, 2.05, zg, hx - 0.12, 2.45, z1, 'pz px nx');
  M.box(C.signGlow, -hx + 0.12, 2.07, zg - 0.01, hx - 0.12, 2.36, zg + 0.1, 'pz');
  // «КАССЫ» — тёмные штрихи по светящемуся полю (буква 0.13 × 0.17, штрих 0.028)
  const zl = zg - 0.012, lw = 0.028;
  const stroke = (a, b) => {
    const d = norm(sub([b[0], b[1], 0], [a[0], a[1], 0])), n = [-d[1] * lw / 2, d[0] * lw / 2];
    M.quad(C.dark, [a[0] + n[0], a[1] + n[1], zl], [b[0] + n[0], b[1] + n[1], zl], [b[0] - n[0], b[1] - n[1], zl], [a[0] - n[0], a[1] - n[1], zl], [0, 0, -1]);
  };
  const LW = 0.13, LH = 0.17, yb = 2.13, yt = yb + LH, ym = yb + LH / 2;
  const glyph = {
    К: (x) => { stroke([x + lw / 2, yb], [x + lw / 2, yt]); stroke([x + lw, ym], [x + LW, yt]); stroke([x + lw, ym], [x + LW, yb]); },
    А: (x) => { stroke([x, yb], [x + LW / 2, yt]); stroke([x + LW / 2, yt], [x + LW, yb]); stroke([x + LW * 0.24, yb + LH * 0.36], [x + LW * 0.76, yb + LH * 0.36]); },
    С: (x) => { stroke([x + lw / 2, yb], [x + lw / 2, yt]); stroke([x, yt - lw / 2], [x + LW, yt - lw / 2]); stroke([x, yb + lw / 2], [x + LW, yb + lw / 2]); },
    Ы: (x) => { stroke([x + lw / 2, yb], [x + lw / 2, yt]); stroke([x, ym + 0.01], [x + LW * 0.62, ym + 0.01]); stroke([x, yb + lw / 2], [x + LW * 0.62, yb + lw / 2]); stroke([x + LW * 0.62 - lw / 2, yb], [x + LW * 0.62 - lw / 2, ym + 0.01 + lw / 2]); stroke([x + LW - lw / 2, yb], [x + LW - lw / 2, yt]); },
  };
  const word = 'КАССЫ', gap = 0.06;
  let lx = -(word.length * LW + (word.length - 1) * gap) / 2;
  for (const ch of word) {
    glyph[ch](lx);
    lx += LW + gap;
  }
  // карниз
  M.box(C.bronze, -hx - 0.03, 2.45, z0 - 0.05, hx + 0.03, 2.6, z1, 'pz');
}

// ── будка дежурной у эскалатора 1.3 × 1.1: низ — крашеные стенки до 1.0, верх — остекление (стекло условно: алюминиевые
//    переплёты и блики), крыша с карнизом, под ней светильник (metro_light_glow); внутри — наклонный пульт с кнопками
//    (зелёные горят), телефон, микрофон на гибкой ножке, табурет. Перед (пульт) — к −Z, дверь — сбоку (+X)
{
  const M = new Model('p_metro_esc_booth');
  const hx = 0.65, z0 = -0.55, z1 = 0.55, t = 0.04;
  M.box(C.dark, -hx, 0, z0, hx, 0.08, z1);
  // нижние стенки
  M.box(C.paint, -hx, 0.08, z0, hx, 1.0, z0 + t);
  M.box(C.paint, -hx, 0.08, z1 - t, hx, 1.0, z1);
  M.box(C.paint, -hx, 0.08, z0 + t, -hx + t, 1.0, z1 - t);
  M.box(C.paint, hx - t, 0.08, z0 + t, hx, 1.0, z1 - t);
  // дверь сбоку: шов и ручка
  M.quad(C.dark, [hx + 0.001, 0.1, -0.1], [hx + 0.001, 0.1, -0.09], [hx + 0.001, 0.98, -0.09], [hx + 0.001, 0.98, -0.1], [1, 0, 0]);
  M.box(C.alu, hx, 0.85, 0.32, hx + 0.03, 0.87, 0.42);
  // подоконник по периметру
  M.box(C.alu, -hx - 0.02, 1.0, z0 - 0.02, hx + 0.02, 1.03, z0 + t);
  M.box(C.alu, -hx - 0.02, 1.0, z1 - t, hx + 0.02, 1.03, z1 + 0.02);
  M.box(C.alu, -hx - 0.02, 1.0, z0 + t, -hx + t, 1.03, z1 - t, 'pz nz');
  M.box(C.alu, hx - t, 1.0, z0 + t, hx + 0.02, 1.03, z1 - t, 'pz nz');
  // стойки по углам и посередине длинных сторон, верхний ригель
  for (const x of [-hx, hx - 0.04]) for (const z of [z0, z1 - 0.04]) M.box(C.alu, x, 1.03, z, x + 0.04, 2.12, z + 0.04);
  for (const z of [z0, z1 - 0.04]) M.box(C.alu, -0.02, 1.03, z, 0.02, 2.12, z + 0.04);
  M.box(C.alu, -hx, 2.08, z0, hx, 2.12, z1, 'ny');
  // ригель остекления и глухой фриз под крышей по периметру
  M.box(C.alu, -hx, 1.62, z0, hx, 1.645, z0 + 0.03);
  for (const x of [-hx, hx - 0.03]) M.box(C.alu, x, 1.62, z0, x + 0.03, 1.645, z1);
  M.box(C.paint, -hx, 1.92, z0, hx, 2.08, z0 + t);
  M.box(C.paint, -hx, 1.92, z1 - t, hx, 2.08, z1);
  M.box(C.paint, -hx, 1.92, z0 + t, -hx + t, 2.08, z1 - t, 'pz nz');
  M.box(C.paint, hx - t, 1.92, z0 + t, hx, 2.08, z1 - t, 'pz nz');
  // крыша и светильник под ней
  M.box(C.paint, -hx - 0.04, 2.12, z0 - 0.04, hx + 0.04, 2.3, z1 + 0.04);
  M.box(C.alu, -hx - 0.05, 2.12, z0 - 0.05, hx + 0.05, 2.15, z1 + 0.05, 'py');
  M.box(C.lightGlow, -0.35, 2.095, -0.2, 0.35, 2.12, 0.2, 'py');
  // пульт: наклонная панель вдоль передней стенки
  M.prism(C.dark, 'x', [[z0 + t, 0.08], [z0 + 0.45, 0.08], [z0 + 0.45, 0.8], [z0 + 0.2, 0.95], [z0 + t, 0.95]], -hx + t, hx - t, { caps: true });
  const nn = norm([0, 0.25, 0.15]);
  const onPanel = (x, k) => {
    const z = z0 + 0.24 + k * 0.07;
    const y = 0.95 - ((z - (z0 + 0.2)) / 0.25) * 0.15;
    return [x, y, z];
  };
  for (let k = 0; k < 3; k++) {
    for (let j = 0; j < 7; j++) {
      const p = onPanel(-0.45 + j * 0.15, k);
      const m = (j + k) % 3 === 0 ? C.goGlow : (j + 2 * k) % 4 === 1 ? C.red : C.alu;
      M.disc(m, add(p, mul(nn, 0.006)), nn, 0.018, 8);
    }
  }
  // телефон и микрофон на ножке
  M.box(C.dark, 0.3, 0.95, z0 + 0.06, 0.48, 1.02, z0 + 0.19);
  M.tube(C.dark, [[0.31, 1.045, z0 + 0.09], [0.39, 1.055, z0 + 0.125], [0.47, 1.045, z0 + 0.16]], 0.022, { seg: 6, caps: true });
  M.tube(C.dark, [[-0.25, 0.9, z0 + 0.3], [-0.25, 1.08, z0 + 0.28], [-0.22, 1.2, z0 + 0.18], [-0.2, 1.22, z0 + 0.12]], 0.007, { seg: 5 });
  M.blob(C.dark, [-0.2, 1.22, z0 + 0.1], 0.025, 0.025, 0.035, 4, 8);
  // табурет
  M.lathe(C.dark, [[0, 0.62], [0.17, 0.62], [0.17, 0.66], [0, 0.66]], { c: [0, 0, 0.18], seg: 12 });
  M.tube(C.alu, [[0, 0.08, 0.18], [0, 0.62, 0.18]], 0.025, { seg: 8 });
  M.lathe(C.alu, [[0, 0.08], [0.18, 0.08], [0.17, 0.1], [0, 0.1]], { c: [0, 0, 0.18], seg: 10 });
}

// ── обгоревший эскалатор (как на фото Кингс-Кросс) 6.0 × 3.6: низ трёх дорожек — нижняя площадка на −Z, к +Z
//    подъём под 30°. Деревянные ступени выгорели: от лент остались железные косоуры и оси, редкие обугленные
//    проступи и подступёнки (часть просела, часть рухнула на площадку); балюстрады — обшивка из досок вдоль уклона,
//    выгоревшая сверху сильнее (уголь и седой пепел вперемешку), сквозь дыры — стойки каркаса; крышки балюстрад
//    кусками, направляющие поручней провисли, клочья поручня свисают; на широких балюстрадах — погнутые торшеры;
//    на площадке — копоть, пепел, гребёнки
{
  const M = new Model('p_metro_esc_wreck');
  seed = 2024;
  const Z0 = -1.8, Z1 = 1.8, ZI = -0.6; // начало наклона
  const deck = (z) => (z <= ZI ? 0.12 : 0.12 + (z - ZI) * TAN30);
  const lanes = [-2.0, 0, 2.0];
  const bal = [[-2.8, 0.4], [-1.0, 0.8], [1.0, 0.8], [2.8, 0.4]]; // центр, ширина
  // копоть на полу: перекрывающиеся тёмные пятна
  for (let k = 0; k < 9; k++) {
    const r = rr(0.4, 0.6), sx = rr(1.0, 1.3);
    const c = [rr(-3.0 + r, 3.0 - r), 0.002 + k * 0.0002, rr(-1.75 + r * sx, -0.3)];
    M.disc(C.char, c, [0, 1, 0], r, 10, sx);
  }
  /** Уголь или пепел (седой налёт на обгоревшем дереве). */
  const burnt = (p = 0.3) => (rnd() < p ? C.ash : C.char);
  // ── дорожки
  for (const x of lanes) {
    // входная площадка (железо) и гребёнка, местами вздыбленная
    M.box(C.rust, x - 0.6, 0, Z0 + 0.25, x + 0.6, 0.1, ZI - 0.75, 'ny');
    const lift = rr(0.05, 0.3);
    const [U, V, W] = axes(rr(-0.06, 0.06), -lift, rr(-0.05, 0.05));
    M.obox(C.rust, [x, 0.12 + lift * 0.15, ZI - 0.68], [U, V, W], 0.56, 0.012, 0.09);
    // косоуры вдоль уклона и оси поперёк
    for (const sx of [-0.52, 0.52]) {
      const a = [x + sx, 0.1, ZI - 0.7], b = [x + sx, 0.1, ZI - 0.1], c = [x + sx, deck(Z1) - 0.2, Z1];
      M.beam(C.rust, a, b, 0.06, 0.18, [0, 1, 0]);
      M.beam(C.rust, b, c, 0.06, 0.18, [0, 1, 0]);
    }
    for (let k = 0; k < 5; k++) {
      const z = ZI - 0.1 + k * 0.5;
      const y = Math.max(0.12, deck(z) - 0.18);
      M.tube(C.rust, [[x - 0.55, y, z], [x + 0.55, y + rr(-0.02, 0.02), z]], 0.025, { seg: 6 });
    }
    // ступени: две плоские у входа, дальше — по уклону; проступь — у носка на линии deck, подступёнок — за ней
    const steps = [];
    for (let z = ZI - 0.66; z < Z1 - 0.3; z += 0.4) steps.push(z);
    steps.forEach((z, i) => {
      const flat = z + 0.4 <= ZI;
      if (rnd() < (flat ? 0.3 : 0.4)) return;
      const y = Math.max(0.1, deck(z) + 0.01 - (i > 1 && rnd() < 0.4 ? rr(0.04, 0.14) : 0));
      const w = rr(0.3, 0.52), dx = rr(-0.5 + w, 0.5 - w);
      const [U, V, W] = axes(rr(-0.05, 0.05), rr(-0.06, 0.06), rr(-0.08, 0.08));
      M.obox(burnt(0.25), [x + dx, y, z + 0.19], [U, V, W], w, 0.022, 0.18);
      if (!flat && rnd() < 0.6) {
        const h = 0.4 * TAN30;
        M.obox(C.char, [x + dx * 0.8, y + h / 2 - 0.02, z + 0.38], [U, V, W], w * rr(0.6, 0.95), h / 2, 0.012);
      }
    });
    // рухнувшие ступени — на площадке, вповалку
    for (let k = 0; k < 3; k++) {
      const c = [x + rr(-0.4, 0.4), 0.13 + k * 0.035, rr(Z0 + 0.4, ZI - 0.85)];
      const [U, V, W] = axes(rr(-0.6, 0.6), rr(-0.1, 0.1), rr(-0.08, 0.08));
      M.obox(burnt(0.3), c, [U, V, W], rr(0.25, 0.42), 0.022, 0.17);
    }
  }
  // ── балюстрады: профиль — скруглённый низ у площадки, горизонталь, затем вдоль уклона
  const hh = 0.85;
  const z0b = Z0 + 0.3;
  /** Верх балюстрады над полом в точке z (до начала наклона — горизонталь, низ — скругление). */
  const topAt = (z) => {
    if (z < z0b + 0.3) return 0.25 + (hh - 0.13) * Math.sin(((Math.max(z, z0b) - z0b) / 0.3) * (PI / 2));
    return deck(z) + hh;
  };
  for (const [bx, bw] of bal) {
    // каркас (обшивка выгорела — он на виду): продольные брусья по низу и верху профиля, стойки, раскосы
    const prof = (z, f) => [0, lerp(z < ZI ? 0.06 : deck(z) - 0.06, topAt(z) - 0.06, f), z];
    for (const sx of bw > 0.5 ? [-0.25, 0.25] : [0]) {
      for (const f of [0, 1]) {
        const pts = [];
        for (let k = 0; k <= 14; k++) {
          const z = lerp(f ? z0b + 0.05 : z0b + 0.3, Z1 - 0.02, k / 14);
          const p = prof(z, f);
          pts.push([bx + sx, p[1], z]);
        }
        M.tube(C.rust, pts, 0.022, { seg: 4, phase: PI / 4 });
      }
      let bay = 0;
      for (let z = z0b + 0.3; z < Z1 - 0.1; z += 0.5, bay++) {
        const a = prof(z, 0), b = prof(z, 1);
        M.box(C.rust, bx + sx - 0.018, Math.min(a[1], 0.01), z - 0.018, bx + sx + 0.018, b[1], z + 0.018);
        if (bay % 2 === 0 && z + 0.5 < Z1) M.beam(C.rust, [bx + sx, a[1], z], [bx + sx, prof(z + 0.5, 1)[1], z + 0.5], 0.02, 0.02, [1, 0, 0]);
      }
    }
    // обшивка — редкие уцелевшие доски вдоль уклона (внизу целее) и обугленные обрубки досок у пола
    for (const sx of [-1, 1]) {
      const x = bx + (sx * bw) / 2 - sx * 0.015;
      for (const f of [0.18, 0.42, 0.66]) {
        let z = z0b + 0.35 + rr(0, 0.3);
        while (z < Z1 - 0.3) {
          const len = rr(0.5, 1.3), zB = Math.min(Z1 - 0.05, z + len);
          if (rnd() < 0.75 - f * 0.6) {
            const yA = prof(z, f)[1], yB = prof(zB, f)[1];
            M.beam(burnt(0.3), [x, yA, z], [x, yB, zB], 0.025, rr(0.12, 0.2), [0, 1, 0]);
          }
          z = zB + rr(0.15, 0.6);
        }
      }
      for (let z = z0b + 0.1; z < Z1 - 0.1; z += rr(0.12, 0.3)) {
        if (rnd() < 0.5) continue;
        M.box(burnt(0.2), x - 0.012, 0.01, z, x + 0.012, rr(0.12, 0.35) + (z < ZI ? 0 : (deck(z) - 0.12) * 0.5), z + rr(0.07, 0.11));
      }
      // нижний закруглённый торец — уцелевший кусок обшивки
      if (rnd() < 0.7) M.box(C.char, x - 0.012, 0.02, z0b, x + 0.012, rr(0.35, 0.6), z0b + 0.3);
    }
    // крышка широкой балюстрады — пара длинных обгоревших кусков
    if (bw > 0.5) {
      for (let k = 0; k < 2; k++) {
        const zA = lerp(z0b + 0.4, Z1 - 1.2, k) + rr(-0.2, 0.2), zB = zA + rr(0.6, 1.0);
        M.beam(burnt(0.2), [bx + rr(-0.05, 0.05), topAt(zA) + 0.01, zA], [bx, topAt(zB) + 0.01 - rr(0, 0.08), zB], bw * rr(0.6, 0.95), 0.03, [0, 1, 0]);
      }
    }
    // направляющие поручней (со стороны дорожек): провисли посередине; клочья поручня свисают
    for (const sx of [-1, 1]) {
      if (Math.abs(bx + sx * bw) > 3) continue;
      const xr = bx + sx * (bw / 2 - 0.03);
      const pts = [];
      for (let k = 0; k <= 12; k++) {
        const z = lerp(z0b + 0.1, Z1, k / 12);
        const sag = k > 4 && k < 11 ? Math.sin(((k - 4) / 7) * PI) * rr(0.18, 0.3) : 0;
        pts.push([xr + sx * sag * 0.25, topAt(z) + 0.06 - sag, z]);
      }
      M.tube(C.rust, pts, 0.018, { seg: 5 });
      for (const k of [3, 9]) {
        if (rnd() < 0.4) continue;
        const p = pts[k];
        M.tube(C.char, [p, add(p, [sx * 0.04, -0.22, 0.04]), add(p, [sx * rr(0.02, 0.1), -rr(0.4, 0.55), rr(-0.04, 0.1)])], 0.028, { seg: 5, caps: 'end' });
      }
    }
    // торшер на широкой балюстраде: погнутая стойка и разбитый плафон
    if (bw > 0.5) {
      for (const z of [-0.4, 0.6]) {
        const b = [bx, topAt(z) + 0.03, z];
        const top = add(b, [rr(-0.18, 0.18), rr(0.45, 0.55), rr(0.1, 0.25)]);
        M.tube(C.rust, [b, add(b, [0, 0.3, 0.01]), top], 0.022, { seg: 6 });
        M.lathe(C.char, [[0.02, -0.02], [0.09, 0.03], [0.1, 0.09], [0.06, 0.1]], { c: top, seg: 8 });
      }
    }
  }
  // пепел кучками на площадке
  for (let k = 0; k < 8; k++) M.dome(C.ash, [rr(-2.7, 2.7), 0, rr(Z0 + 0.35, ZI - 0.2)], rr(0.15, 0.32), rr(0.05, 0.1), rr(0.12, 0.25), 3, 8);
}

// ── обломки 1.2 × 1.0: пепел, куски мраморной облицовки, обугленные доски, гнутая труба поручня
{
  const M = new Model('p_metro_debris');
  seed = 77;
  M.dome(C.ash, [0, 0, 0], 0.5, 0.14, 0.38, 3, 10);
  M.dome(C.ash, [0.3, 0, 0.18], 0.22, 0.09, 0.2, 3, 8);
  for (let k = 0; k < 4; k++) {
    const [U, V, W] = axes(rr(0, 2 * PI), rr(-0.35, 0.35), rr(-0.3, 0.3));
    M.obox(C.marble, [rr(-0.4, 0.4), rr(0.1, 0.16), rr(-0.3, 0.3)], [U, V, W], rr(0.1, 0.2), 0.015, rr(0.08, 0.15));
  }
  for (let k = 0; k < 4; k++) {
    const [U, V, W] = axes(rr(0, 2 * PI), rr(-0.25, 0.25), rr(-0.2, 0.2));
    M.obox(C.char, [rr(-0.3, 0.3), rr(0.12, 0.2), rr(-0.25, 0.25)], [U, V, W], rr(0.25, 0.38), 0.02, 0.05);
  }
  M.tube(C.iron, [[-0.52, 0.04, -0.3], [-0.2, 0.18, -0.2], [0.1, 0.24, 0.05], [0.25, 0.3, 0.35]], 0.02, { seg: 6, caps: true });
}

// ── часы-интервал 0.8 × 0.2 на кронштейне (корпус 2.15…2.45): чёрный корпус с алюминиевым кантом, тёмное табло,
//    семисегментные цифры «02:47» (светится — metro_clock_glow)
{
  const M = new Model('p_metro_clock');
  const Y0 = 2.15, Y1 = 2.45, zf = -0.06, zb = 0.06;
  M.box(C.dark, -0.36, Y0, zf, 0.36, Y1, zb);
  // кронштейн к стене
  for (const x of [-0.2, 0.2]) M.box(C.iron, x - 0.02, Y0 + 0.08, zb, x + 0.02, Y1 - 0.08, 0.1, 'pz');
  M.box(C.iron, -0.26, Y0 + 0.12, 0.09, 0.26, Y1 - 0.12, 0.1, 'pz');
  // кант
  M.box(C.alu, -0.37, Y0 - 0.01, zf - 0.006, 0.37, Y0 + 0.005, zf + 0.01);
  M.box(C.alu, -0.37, Y1 - 0.005, zf - 0.006, 0.37, Y1 + 0.01, zf + 0.01);
  for (const x of [-0.37, 0.355]) M.box(C.alu, x, Y0 + 0.005, zf - 0.006, x + 0.015, Y1 - 0.005, zf + 0.01, 'py ny');
  // цифры: семь сегментов a b c d e f g
  const SEG = {
    0: 'abcdef', 2: 'abged', 4: 'fgbc', 7: 'abc',
  };
  const z = zf - 0.002;
  const dw = 0.085, dh = 0.17, th = 0.018, cy = (Y0 + Y1) / 2;
  const digit = (x0, d) => {
    const yb = cy - dh / 2, ym = cy, yt = cy + dh / 2;
    const S = {
      a: [x0 + th, yt - th, x0 + dw - th, yt],
      d: [x0 + th, yb, x0 + dw - th, yb + th],
      g: [x0 + th, ym - th / 2, x0 + dw - th, ym + th / 2],
      f: [x0, ym + th / 2, x0 + th, yt - th],
      b: [x0 + dw - th, ym + th / 2, x0 + dw, yt - th],
      e: [x0, yb + th, x0 + th, ym - th / 2],
      c: [x0 + dw - th, yb + th, x0 + dw, ym - th / 2],
    };
    for (const k of SEG[d]) {
      const [a, b, c, e] = S[k];
      M.quad(C.clockGlow, [a, b, z], [c, b, z], [c, e, z], [a, e, z], [0, 0, -1]);
    }
  };
  const xs = [-0.225, -0.12, 0.035, 0.14];
  [0, 2, 4, 7].forEach((d, k) => digit(xs[k], d));
  for (const y of [cy - 0.04, cy + 0.04]) M.quad(C.clockGlow, [-0.011, y - 0.011, z], [0.011, y - 0.011, z], [0.011, y + 0.011, z], [-0.011, y + 0.011, z], [0, 0, -1]);
}

// ── привод эскалатора 2.0 × 1.0: станина из швеллеров, зелёный электродвигатель (ось вдоль Z) с рёбрами и лапами,
//    тормозной шкив, подшипниковые стойки, большое зубчатое колесо (40 зубьев, спицы) и шестерня (12 зубьев) —
//    крутятся (extras.anim spin, большое — 1 оборот за 12 с), за большим колесом — звёздочка тяговой цепи на том же валу
{
  const M = new Model('p_metro_gears');
  // станина
  for (const z of [-0.42, 0.42]) M.box(C.iron, -0.98, 0, z - 0.05, 0.98, 0.14, z + 0.05);
  for (const x of [-0.9, 0, 0.9]) M.box(C.iron, x - 0.05, 0.02, -0.37, x + 0.05, 0.12, 0.37, 'ny');
  const G1 = { c: [0.25, 0.86], R: 0.66, N: 40 }, G2 = { N: 12 };
  G2.R = (G1.R * G2.N) / G1.N;
  const ang = (200 * PI) / 180;
  G2.c = [G1.c[0] + (G1.R + G2.R) * Math.cos(ang), G1.c[1] + (G1.R + G2.R) * Math.sin(ang)];
  // двигатель на оси шестерни, позади неё
  const mc = [G2.c[0], G2.c[1]];
  M.lathe(C.green, [[0, -0.08], [0.2, -0.08], [0.23, -0.05], [0.23, 0.4], [0.2, 0.43], [0.08, 0.45], [0, 0.45]], { axis: 'z', c: [mc[0], mc[1], 0], seg: 16 });
  for (let k = 0; k < 6; k++) M.lathe(C.green, [[0.23, k * 0.07], [0.255, k * 0.07 + 0.01], [0.255, k * 0.07 + 0.025], [0.23, k * 0.07 + 0.035]], { axis: 'z', c: [mc[0], mc[1], 0], seg: 16 });
  for (const z of [-0.02, 0.35]) M.box(C.green, mc[0] - 0.2, 0.14, z - 0.04, mc[0] + 0.2, mc[1] - 0.12, z + 0.04);
  // клеммная коробка
  M.box(C.green, mc[0] - 0.08, mc[1] + 0.2, 0.08, mc[0] + 0.08, mc[1] + 0.3, 0.24);
  // подшипниковые стойки большого вала
  for (const z of [-0.12, 0.38]) {
    M.box(C.iron, G1.c[0] - 0.12, 0.14, z - 0.06, G1.c[0] + 0.12, G1.c[1] - 0.06, z + 0.06);
    M.lathe(C.iron, [[0, -0.07], [0.1, -0.07], [0.1, 0.07], [0, 0.07]], { axis: 'z', c: [G1.c[0], G1.c[1], z], seg: 12 });
  }
  // стойка вала шестерни (позади неё)
  M.box(C.iron, G2.c[0] - 0.1, 0.14, -0.24, G2.c[0] + 0.1, G2.c[1] - 0.035, -0.14);
  /** Зубчатое колесо (ось Z) в части k: обод, зубья (трапеции), ступица, спицы. */
  const gear = (K, c, R, N, z0, z1, off, spokes) => {
    const m = C.iron, rIn = R - 0.05, hub = Math.max(0.06, R * 0.18);
    // обод: кольцо (лицо, тыл, наружная и внутренняя стенки)
    for (let k = 0; k < N * 2; k++) {
      const f0 = (k / (N * 2)) * 2 * PI, f1 = ((k + 1) / (N * 2)) * 2 * PI;
      const P = (r, f, z) => [c[0] + r * Math.cos(f), c[1] + r * Math.sin(f), z];
      K.quad(m, P(rIn, f0, z0), P(R, f0, z0), P(R, f1, z0), P(rIn, f1, z0), [0, 0, -1]);
      K.quad(m, P(rIn, f0, z1), P(R, f0, z1), P(R, f1, z1), P(rIn, f1, z1), [0, 0, 1]);
      const fm = (f0 + f1) / 2;
      K.quad(m, P(R, f0, z0), P(R, f1, z0), P(R, f1, z1), P(R, f0, z1), [Math.cos(fm), Math.sin(fm), 0]);
      if (spokes) K.quad(m, P(rIn, f0, z0), P(rIn, f1, z0), P(rIn, f1, z1), P(rIn, f0, z1), [-Math.cos(fm), -Math.sin(fm), 0]);
    }
    // зубья
    const tp = (2 * PI) / N, hd = 0.045;
    for (let k = 0; k < N; k++) {
      const f = off + k * tp;
      const P2 = (r, a) => [c[0] + r * Math.cos(f + a), c[1] + r * Math.sin(f + a)];
      K.prism(m, 'z', [P2(R - 0.004, -tp * 0.27), P2(R - 0.004, tp * 0.27), P2(R + hd, tp * 0.14), P2(R + hd, -tp * 0.14)], z0, z1, { caps: true });
    }
    // ступица
    K.lathe(C.steel, [[0, z0 - 0.04], [hub, z0 - 0.04], [hub, z1 + 0.04], [0, z1 + 0.04]], { axis: 'z', c: [c[0], c[1], 0], seg: 12 });
    if (spokes) {
      for (let k = 0; k < spokes; k++) {
        const f = (k / spokes) * 2 * PI + 0.2;
        const a = [c[0] + hub * Math.cos(f), c[1] + hub * Math.sin(f), (z0 + z1) / 2];
        const b = [c[0] + (rIn + 0.01) * Math.cos(f), c[1] + (rIn + 0.01) * Math.sin(f), (z0 + z1) / 2];
        K.beam(m, a, b, 0.07, (z1 - z0) * 0.6, [0, 0, 1]);
      }
    } else {
      // сплошной диск шестерни
      K.lathe(m, [[hub, z0], [rIn + 0.001, z0]], { axis: 'z', c: [c[0], c[1], 0], seg: N * 2 });
      K.lathe(m, [[rIn + 0.001, z1], [hub, z1]], { axis: 'z', c: [c[0], c[1], 0], seg: N * 2 });
    }
  };
  const P1 = 12;
  // большое колесо и звёздочка тяговой цепи на его валу
  const k1 = M.kid([0, 0, 1], [G1.c[0], G1.c[1], 0], 1, P1);
  gear(k1, G1.c, G1.R, G1.N, -0.34, -0.27, ang + PI / G1.N, 6);
  k1.tube(C.steel, [[G1.c[0], G1.c[1], -0.4], [G1.c[0], G1.c[1], 0.46]], 0.045, { seg: 10, caps: true });
  gear(k1, G1.c, 0.42, 16, 0.08, 0.2, 0, 0);
  // шестерня на валу двигателя: зуб — в сторону колеса
  const k2 = M.kid([0, 0, 1], [G2.c[0], G2.c[1], 0], -G1.N / G2.N, P1);
  gear(k2, G2.c, G2.R, G2.N, -0.35, -0.26, ang - PI, 0);
  k2.tube(C.steel, [[G2.c[0], G2.c[1], -0.36], [G2.c[0], G2.c[1], -0.08]], 0.035, { seg: 8, caps: 'start' });
}

// ── кабели по стене служебного хода 2.0 × 0.1 (1.75…2.2 м): полосы-стойки на стене через 1 м с полками, на полках —
//    по два кабеля (чёрные и серые свинцовые, разной толщины), провисают между стойками; отрезки стыкуются торцами по X
{
  const M = new Model('p_metro_cable');
  const zw = 0.05;
  const shelves = [1.78, 1.9, 2.02, 2.14];
  for (const x of [-0.5, 0.5]) {
    M.box(C.iron, x - 0.02, 1.75, zw - 0.008, x + 0.02, 2.2, zw, 'pz');
    for (const y of shelves) M.box(C.iron, x - 0.015, y - 0.006, -0.048, x + 0.015, y, zw - 0.008, 'pz');
  }
  const cables = [
    [1.78, 0.024, 0.016, C.dark, 0.04], [1.78, 0.014, -0.028, C.iron, 0.03],
    [1.9, 0.02, 0.02, C.iron, 0.035], [1.9, 0.018, -0.022, C.dark, 0.045],
    [2.02, 0.022, 0.018, C.dark, 0.03], [2.02, 0.015, -0.026, C.dark, 0.04],
    [2.14, 0.018, 0.02, C.dark, 0.025], [2.14, 0.012, -0.024, C.iron, 0.03],
  ];
  for (const [y, r, z, m, amp] of cables) {
    const pts = [];
    for (let k = 0; k <= 16; k++) {
      const x = -1 + k / 8;
      const sag = (amp * (1 - Math.cos(2 * PI * (x - 0.5)))) / 2;
      pts.push([x, y + r - sag, z]);
    }
    M.tube(m, pts, r, { seg: 6 });
  }
}

// ═════════════════════════ запись и сверка ═════════════════════════

/** План w × d (м) и верх модели над полом, м (у подвесных — насколько спускается от потолка). */
const EXPECT = {
  p_metro_track: [3.0, 9.0, 0.357],
  p_metro_mini_track: [1.5, 9.0, 0.179],
  p_metro_micro_track: [0.75, 9.0, 0.089],
  p_metro_edge: [0.4, 9.0, 0.025],
  p_metro_mini_edge: [0.2, 9.0, 0.013],
  p_metro_micro_edge: [0.1, 9.0, 0.01],
  p_metro_panel: [2.4, 0.06, 3.6],
  p_metro_mini_panel: [1.2, 0.1, 2.2],
  p_metro_micro_panel: [0.6, 0.1, 1.4],
  p_metro_light: [3.0, 4.5, 0.3],
  p_metro_light_strip: [0.3, 4.5, 0.122],
  p_metro_bench: [2.4, 0.9, 1.012],
  p_metro_sign: [1.6, 0.15, 0.75],
  p_metro_turnstile: [0.2, 1.3, 1.004],
  p_metro_kassa: [2.4, 1.2, 2.6],
  p_metro_esc_booth: [1.3, 1.1, 2.3],
  p_metro_esc_wreck: [6.0, 3.6, 2.45],
  p_metro_debris: [1.2, 1.0, 0.33],
  p_metro_clock: [0.8, 0.2, 2.46],
  p_metro_gears: [2.0, 1.0, 1.57],
  p_metro_cable: [2.0, 0.1, 2.2],
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
/** Меш из частей геометрии (игровые координаты → glTF: x → −x, обход — обратный). */
function meshOf(name, geo, stats) {
  const mesh = doc.createMesh(name);
  for (const [m, g] of geo.parts) {
    if (!g.i.length) continue;
    const bad = windingErrors(g);
    if (bad) {
      problems++;
      console.log(`  ! ${name} / ${m.getName()}: обход ${bad} треугольников против нормалей`);
    }
    for (let k = 0; k < g.p.length; k += 3) {
      g.p[k] = -g.p[k];
      g.n[k] = -g.n[k];
    }
    for (let t = 0; t < g.i.length; t += 3) [g.i[t + 1], g.i[t + 2]] = [g.i[t + 2], g.i[t + 1]];
    const big = g.p.length / 3 > 65535;
    mesh.addPrimitive(
      doc
        .createPrimitive()
        .setAttribute('POSITION', acc('VEC3', new Float32Array(g.p)))
        .setAttribute('NORMAL', acc('VEC3', new Float32Array(g.n)))
        .setIndices(acc('SCALAR', big ? new Uint32Array(g.i) : new Uint16Array(g.i)))
        .setMaterial(m),
    );
    stats.verts += g.p.length / 3;
    stats.tris += g.i.length / 3;
    stats.mats.add(m.getName());
  }
  return mesh;
}
for (const M of MODELS) {
  const stats = { verts: 0, tris: 0, mats: new Set() };
  const node = doc.createNode(M.id).setMesh(meshOf(M.id, M, stats));
  M.kids.forEach((k, i) => {
    node.addChild(doc.createNode(`${M.id}:${i}`).setMesh(meshOf(`${M.id}:${i}`, k, stats)).setExtras({ anim: k.anim }));
  });
  M.stats = stats;
  scene.addChild(node.setExtras({ ceil: M.ceil, ...M.extras }));
}

await doc.transform(
  weld(),
  dedup(),
  prune({ keepAttributes: true, keepLeaves: true, keepExtras: true }),
  // позиции — int16, нормали — int8 (KHR_mesh_quantization: загрузчик Babylon подключён в propModels.ts)
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
    // свес за план допускается немного (рама панно, кант, ручка) — до 0.12 м
    if (w > e[0] + 0.12 || d > e[1] + 0.12) warn += ' ! шире плана';
    if (w < e[0] - 0.2 || d < e[1] - 0.2) warn += ' ! уже плана';
    if (Math.abs(h - e[2]) > 0.03) warn += ` ! верх ${h.toFixed(3)} ≠ ${e[2]}`;
    if (M.ceil && Math.abs(b.max[1]) > 0.002) warn += ' ! подвесной: верх не в 0';
    if (!M.ceil && b.min[1] < -0.002) warn += ' ! ниже пола';
    if (Math.abs((b.min[0] + b.max[0]) / 2) > 0.06) warn += ' ! не по центру X';
  }
  if (warn) problems++;
  const kids = M.kids.length ? ` +${M.kids.length} подв.` : '';
  console.log(
    `${id.padEnd(22)} ${(e ? `${w.toFixed(2)} × ${d.toFixed(2)} (${e[0]} × ${e[1]})` : '').padEnd(27)} ${f(0)}  ${f(1)}  ${f(2)}  ${String(M.stats.verts).padStart(5)} ${String(M.stats.tris).padStart(5)} ${String(M.stats.mats.size).padStart(3)}${kids}${warn}`,
  );
}
for (const id of Object.keys(EXPECT)) if (!seen.has(id)) (problems++, console.log(`  ! нет узла ${id}`));
const glow = back.getRoot().listMaterials().filter((m) => m.getEmissiveFactor().some((v) => v > 0.01)).map((m) => m.getName());
const total = MODELS.reduce((s, M) => s + M.stats.verts, 0);
console.log(`→ ${out}: ${(statSync(out).size / 1024).toFixed(0)} КБ, предметов ${nodes.length}, вершин ${total}, материалов ${back.getRoot().listMaterials().length}`);
console.log(`  светятся: ${glow.join(', ')}`);
if (problems) {
  console.log(`  замечаний: ${problems}`);
  process.exitCode = 1;
}
