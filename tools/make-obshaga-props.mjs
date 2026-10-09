// Модели биома «Общага» (советское общежитие) — из примитивов, без текстур (цвет — в материале):
//
//  • src/view3d/assets/obshaga_props.glb — узел на предмет, имя узла = id prop проекта (src/data/props.ts, p_obsh_*).
//  • Оси узла — как у болванки мебели (src/blockout/babylon.ts): ширина w — вдоль X, глубина (h плана) — вдоль Z,
//    центр габарита на плане — в начале координат, перед — −Z, стена — +Z (z = +глубина/2); низ — пол (y = 0).
//    Высоты настенного (радиатор, окно, раковина, часы, огнетушитель, доски, трубы) — от пола, как в комнате.
//    Подвесное (тег «потолок»: плафон, светильник ЛДС) — верх в y = 0: адаптер ставит модель под потолок (extras.ceil).
//  • Координаты в коде — как в игре (Babylon, левая система): смотришь на предмет спереди — +X справа. Загрузчик glTF
//    в Babylon зеркалит X (x → −x), поэтому при записи x → −x (с обратным обходом) — в игре выходит как здесь: часы идут
//    по часовой, ручки телевизора справа, перила марша справа при подъёме (+X).
//  • Вершинных цветов нет (PropModels их снимает) — цвет в материале; материалы по имени общие для всех наборов,
//    поэтому префикс obsh_. Светятся (emissive → StandardMaterial с disableLighting: виден ровно цвет emissive):
//    obsh_lamp_glow (плафон и лампа вахтёра — гаснут при отключении света), obsh_tube_glow (лампа ЛДС),
//    obsh_lantern_glow (керосиновая «летучая мышь»), obsh_tv_glow (экран «Рекорда»), obsh_window_night (ночь за окном).
//  • Обход граней выбирается по нормали (tri), после записи — сверка: узлы, габариты против таблицы EXPECT.
//  • Посмотреть, как в игре (через PropModels): node tools/obshaga-preview-shots.mjs → tools/qa/obsh-view*.png.
//
//   node tools/make-obshaga-props.mjs
import { Document, NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, quantize, weld } from '@gltf-transform/functions';
import { mkdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../src/view3d/assets/obshaga_props.glb', import.meta.url));
mkdirSync(fileURLToPath(new URL('../src/view3d/assets/', import.meta.url)), { recursive: true });

const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene('obshaga');
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
/** Базис вращения вокруг оси: (U, A, W) — правая тройка, как (X, Y, Z). */
const BASIS = {
  y: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  z: [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
  x: [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
};
/** Детерминированный «случай» (раскладка ключей, листков). */
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

// ───────── материалы ─────────
const hex = (h) => [1, 3, 5].map((k) => +(parseInt(h.slice(k, k + 2), 16) / 255).toFixed(4));
/** Цвет — как в болванке (#rrggbb без перевода в линейный: PropModels кладёт его в StandardMaterial как есть). */
function mat(name, color, o = {}) {
  const m = doc.createMaterial(name).setBaseColorFactor([...hex(color), 1]).setMetallicFactor(0).setRoughnessFactor(o.rough ?? 0.85);
  if (o.glow) m.setEmissiveFactor(hex(o.glow));
  // тюль и шторка видны с обеих сторон (PropModels: backFaceCulling = !doubleSided)
  if (o.two) m.setDoubleSided(true);
  return m;
}
const C = {
  tileBeige: mat('obsh_tile_beige', '#D9C7A0', { rough: 0.35 }),
  tileGreen: mat('obsh_tile_green', '#7FA37A', { rough: 0.35 }),
  tileDark: mat('obsh_tile_dkgreen', '#5E8A6E', { rough: 0.35 }),
  grout: mat('obsh_grout', '#8A8474'),
  enamel: mat('obsh_enamel', '#E8E4D8', { rough: 0.3 }),
  stain: mat('obsh_stain', '#B3A98E'),
  rust: mat('obsh_rust', '#8C4A2B'),
  iron: mat('obsh_iron', '#5A6670'),
  stripeDk: mat('obsh_mattress', '#8A8F95'),
  stripeLt: mat('obsh_mattress_lt', '#C9C5B5'),
  blanket: mat('obsh_blanket', '#5A4E48'),
  linen: mat('obsh_linen', '#D6D1C2'),
  wood: mat('obsh_wood', '#7A4A2A'),
  woodLt: mat('obsh_wood_lt', '#93603A'),
  woodDk: mat('obsh_wood_dk', '#4E2E1A'),
  doorPaint: mat('obsh_door_paint', '#7A3E22'),
  derm: mat('obsh_dermantine', '#5A3A2A', { rough: 0.5 }),
  alu: mat('obsh_alu', '#A9A9A0', { rough: 0.4 }),
  chrome: mat('obsh_chrome', '#C9CDCC', { rough: 0.2 }),
  zinc: mat('obsh_zinc', '#959B97', { rough: 0.5 }),
  concrete: mat('obsh_concrete', '#8D8B86'),
  concreteDk: mat('obsh_concrete_dk', '#73716C'),
  radiator: mat('obsh_radiator', '#D8D4C0', { rough: 0.6 }),
  fire: mat('obsh_fire_red', '#C0302A', { rough: 0.4 }),
  blue: mat('obsh_valve_blue', '#3A5A8A', { rough: 0.4 }),
  black: mat('obsh_black', '#262422', { rough: 0.5 }),
  paint: mat('obsh_white_paint', '#E2DDD0', { rough: 0.6 }),
  plaster: mat('obsh_plaster', '#CFC8B6'),
  tulle: mat('obsh_tulle', '#E6E3D6', { two: true }),
  curtain: mat('obsh_curtain', '#7E9A96', { two: true }),
  paper: mat('obsh_paper', '#E8E2CE'),
  paperOld: mat('obsh_paper_old', '#CDBF98'),
  oilLt: mat('obsh_oilcloth', '#DCD5C2', { rough: 0.4 }),
  oilRed: mat('obsh_oilcloth_red', '#A8463A', { rough: 0.4 }),
  mirror: mat('obsh_mirror', '#8D9DA4', { rough: 0.1 }),
  brass: mat('obsh_brass', '#B08A3A', { rough: 0.4 }),
  greenShade: mat('obsh_lamp_green', '#2F5E3C', { rough: 0.3 }),
  tvCase: mat('obsh_tv_case', '#4A3020', { rough: 0.5 }),
  suitcase: mat('obsh_suitcase', '#5C4632'),
  book: mat('obsh_book', '#34424E'),
  tea: mat('obsh_tea', '#6A3A16', { rough: 0.2 }),
  insul: mat('obsh_insulation', '#B9B19C'),
  pvc: mat('obsh_pvc', '#2A2522', { rough: 0.5 }),
  water: mat('obsh_water', '#5C6664', { rough: 0.1 }),
  rag: mat('obsh_rag', '#7D7A70'),
  hose: mat('obsh_hose', '#3C3D3A'),
  lanternMetal: mat('obsh_lantern_metal', '#3E4A3A', { rough: 0.6 }),
  // светящиеся
  lampGlow: mat('obsh_lamp_glow', '#FFE2B8', { glow: '#FFC27A' }),
  tubeGlow: mat('obsh_tube_glow', '#E8F0E6', { glow: '#DCE8DA' }),
  lanternGlow: mat('obsh_lantern_glow', '#E8B050', { glow: '#E8B050' }),
  tvGlow: mat('obsh_tv_glow', '#3A4A55', { glow: '#2E4254' }),
  windowNight: mat('obsh_window_night', '#1A2532', { glow: '#101A28' }),
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

/** Модель предмета: примитив на материал. */
class Model {
  constructor(id, o = {}) {
    this.id = id;
    this.ceil = !!o.ceil;
    this.extras = o.extras ?? {};
    this.parts = new Map();
    MODELS.push(this);
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
  /** Тело вращения: профиль [r, y] (снизу от оси — по внешней стороне — вверх: нормаль (dy, −dr) наружу) вокруг
   *  оси axis через c; sx, sz — сплющивание (овал); a0…a1 — часть оборота. Вдоль профиля гладко, где излом меньше
   *  crease (°, по умолчанию 40; smooth — всюду гладко): ряд вершин общий у соседних поясков. */
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
    // ряды: у точки профиля k — общий (гладко) или по ряду на каждый из двух соседних поясков (излом)
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
      // нормаль вершины i для ребра edge: сглажена с соседним ребром, если угол мал
      const other = edge === i ? (i - 1 + n) % n : (i + 1) % n;
      const a = en[edge], b = en[other];
      if (o.smooth && a[0] * b[0] + a[1] * b[1] > lim) return P([a[0] + b[0], a[1] + b[1]], 0);
      return P(a, 0);
    };
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, q = pts[i], r = pts[j];
      this.quad(m, P(q, a0), P(r, a0), P(r, a1), P(q, a1), null, [vn(i, i), vn(j, i), vn(j, i), vn(i, i)]);
    }
    const ax = P([0, 0], 1);
    const axv = axis === 'x' ? [1, 0, 0] : axis === 'y' ? [0, 1, 0] : [0, 0, 1];
    void ax;
    if (o.caps !== false) {
      this.poly(m, pts.map((q) => P(q, a0)), mul(axv, -1));
      this.poly(m, pts.map((q) => P(q, a1)), axv);
    }
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
  /** Прямоугольник в плоскости XY (лицом к −Z) в повёрнутой на ang системе с началом (cx, cy): локально x0…x1, y0…y1. */
  rq(m, cx, cy, z, ang, x0, y0, x1, y1) {
    const cs = Math.cos(ang), sn = Math.sin(ang);
    const P = (x, y) => [cx + x * cs - y * sn, cy + x * sn + y * cs, z];
    this.quad(m, P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1), [0, 0, -1]);
  }
}
const MODELS = [];

/** Скругленный прямоугольник (x, y) против часовой: rt — радиус верхних углов, rb — нижних. */
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

/** Табурет: квадрат s, высота h, центр (cx, cz). */
function stool(M, cx, cz, s, h, seat, leg) {
  const a = s / 2 - 0.035, l = 0.0175;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) M.box(leg, cx + sx * a - l, 0, cz + sz * a - l, cx + sx * a + l, h - 0.03, cz + sz * a + l, 'ny py');
  // царги под сиденьем (верх закрыт сиденьем, торцы — ножками) и две проножки
  for (const sz of [-1, 1]) M.box(leg, cx - a + l, h - 0.09, cz + sz * a - 0.01, cx + a - l, h - 0.03, cz + sz * a + 0.01, 'px nx py');
  for (const sx of [-1, 1]) M.box(leg, cx + sx * a - 0.01, h - 0.09, cz - a + l, cx + sx * a + 0.01, h - 0.03, cz + a - l, 'pz nz py');
  for (const sx of [-1, 1]) M.box(leg, cx + sx * a - 0.01, 0.1, cz - a + l, cx + sx * a + 0.01, 0.13, cz + a - l, 'pz nz');
  M.box(seat, cx - s / 2, h - 0.03, cz - s / 2, cx + s / 2, h, cz + s / 2);
  // прорезь для руки
  M.quad(C.black, [cx - 0.05, h + 0.001, cz - 0.012], [cx + 0.05, h + 0.001, cz - 0.012], [cx + 0.05, h + 0.001, cz + 0.012], [cx - 0.05, h + 0.001, cz + 0.012], [0, 1, 0]);
}

// ═════════════════════════ предметы ═════════════════════════

// ── кровать с панцирной сеткой: спинки-трубы с дугой (изголовье 0.95, изножье 0.75), сетка провисла, матрас в
//    полоску, серое одеяло с отворотом простыни, плоская подушка. Длинная сторона — вдоль X (1.9), изголовье — −X.
{
  const M = new Model('p_obsh_bed');
  const X = 0.92, Z = 0.37;
  const sag = (x, z) => 0.055 * (1 - (x / 0.95) ** 2) * (1 - 0.5 * (z / 0.4) ** 2);
  const yb = (x, z) => 0.385 - sag(x, z);
  const yt = (x, z) => 0.465 - 0.85 * sag(x, z);
  const end = (x, top, peak) => {
    const arc = (z) => top + (peak - top) * Math.cos(((z / Z) * PI) / 2);
    const pts = [[x, 0, -Z], [x, top - 0.05, -Z]];
    for (let k = 0; k <= 12; k++) {
      const z = -Z + (2 * Z * k) / 12;
      pts.push([x, arc(z), z]);
    }
    pts.push([x, top - 0.05, Z], [x, 0, Z]);
    M.tube(C.iron, pts, 0.016, { seg: 5, caps: true });
    M.tube(C.iron, [[x, 0.4, -Z], [x, 0.4, Z]], 0.011, { seg: 6 });
    for (const z of [-0.24, -0.12, 0, 0.12, 0.24]) M.tube(C.iron, [[x, 0.4, z], [x, arc(z) - 0.004, z]], 0.0075, { seg: 4 });
  };
  end(-X, 0.8, 0.95);
  end(X, 0.62, 0.75);
  for (const s of [-1, 1]) M.box(C.iron, -X, 0.355, s * Z - 0.012, X, 0.385, s * Z + 0.012);
  // сетка — низ матраса
  M.surface(C.iron, 6, 3, (u, v) => {
    const x = lerp(-0.89, 0.89, u), z = lerp(-0.355, 0.355, v);
    return [x, yb(x, z), z];
  }, [0, -1, 0]);
  // матрас в полоску: виден у изголовья (дальше — под одеялом)
  const XM = -0.89, XE = -0.48;
  for (let b = 0; b < 6; b++) {
    const z0 = -0.355 + (b * 0.71) / 6, z1 = z0 + 0.71 / 6;
    M.surface(b % 2 ? C.stripeLt : C.stripeDk, 2, 1, (u, v) => {
      const x = lerp(XM, XE, u), z = lerp(z0, z1, v);
      return [x, yt(x, z), z];
    }, [0, 1, 0]);
  }
  for (const s of [-1, 1]) {
    M.surface(C.stripeDk, 2, 1, (u, v) => {
      const x = lerp(XM, XE, u), z = s * 0.355;
      return [x, lerp(yb(x, z), yt(x, z), v), z];
    }, [0, 0, s]);
  }
  M.surface(C.stripeDk, 3, 1, (u, v) => {
    const z = lerp(-0.355, 0.355, u);
    return [XM, lerp(yb(XM, z), yt(XM, z), v), z];
  }, [-1, 0, 0]);
  // одеяло: верх, свес вперёд (до 0.27), назад, в ноги; отворот простыни
  const XB0 = -0.55, XB1 = 0.895, top = (x, z) => yt(x, z) + 0.018;
  M.surface(C.blanket, 6, 4, (u, v) => {
    const x = lerp(XB0, XB1, u), z = lerp(-0.37, 0.37, v);
    return [x, top(x, Math.max(-0.355, Math.min(0.355, z))), z];
  }, [0, 1, 0]);
  M.surface(C.blanket, 6, 2, (u, v) => {
    const x = lerp(XB0, XB1, u);
    return [x, lerp(top(x, -0.355), 0.27, v), -0.37 - 0.025 * v];
  }, [0, 0, -1]);
  M.surface(C.blanket, 6, 1, (u, v) => {
    const x = lerp(XB0, XB1, u);
    return [x, lerp(top(x, 0.355), yt(x, 0.355) - 0.04, v), 0.37 + 0.005 * v];
  }, [0, 0, 1]);
  M.surface(C.blanket, 4, 1, (u, v) => {
    const z = lerp(-0.37, 0.37, u);
    return [XB1 + 0.01 * v, lerp(top(XB1, Math.max(-0.355, Math.min(0.355, z))), 0.33, v), z];
  }, [1, 0, 0]);
  M.surface(C.linen, 1, 4, (u, v) => {
    const x = lerp(XB0 - 0.01, XB0 + 0.09, u), z = lerp(-0.372, 0.372, v);
    return [x, top(x, Math.max(-0.355, Math.min(0.355, z))) + 0.004, z];
  }, [0, 1, 0]);
  M.surface(C.linen, 1, 2, (u, v) => {
    const x = lerp(XB0 - 0.01, XB0 + 0.09, u);
    return [x, lerp(top(x, -0.355) + 0.004, 0.3, v), -0.374 - 0.025 * v];
  }, [0, 0, -1]);
  M.blob(C.linen, [-0.71, yt(-0.71, 0) + 0.04, 0], 0.16, 0.05, 0.29, 5, 10);
}

// ── тумбочка: цоколь, корпус, крышка, ящик и дверца с ручками
{
  const M = new Model('p_obsh_nightstand');
  M.box(C.woodDk, -0.18, 0, -0.17, 0.18, 0.05, 0.18, 'ny');
  M.box(C.wood, -0.2, 0.05, -0.19, 0.2, 0.68, 0.2, 'ny');
  M.box(C.wood, -0.205, 0.68, -0.205, 0.205, 0.7, 0.2, 'ny');
  M.box(C.woodLt, -0.185, 0.53, -0.2, 0.185, 0.665, -0.19, 'pz');
  M.box(C.woodLt, -0.185, 0.07, -0.2, 0.185, 0.515, -0.19, 'pz');
  M.box(C.alu, -0.05, 0.59, -0.214, 0.05, 0.606, -0.2, 'pz');
  M.box(C.alu, 0.135, 0.37, -0.212, 0.155, 0.42, -0.2, 'pz');
  // стакан на крышке
  M.lathe(C.chrome, [[0, 0.7], [0.03, 0.7], [0.034, 0.79], [0.031, 0.79], [0.027, 0.705], [0, 0.705]], { c: [-0.09, 0, 0.05], seg: 10 });
}

// ── стол под клеёнкой в клетку: ножки, царги, клеёнка со свесом
{
  const M = new Model('p_obsh_table');
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) M.box(C.wood, sx * 0.525 - 0.025, 0, sz * 0.275 - 0.025, sx * 0.525 + 0.025, 0.67, sz * 0.275 + 0.025, 'ny py');
  for (const sz of [-1, 1]) M.box(C.wood, -0.5, 0.58, sz * 0.275 - 0.012, 0.5, 0.67, sz * 0.275 + 0.012, 'py');
  for (const sx of [-1, 1]) M.box(C.wood, sx * 0.525 - 0.012, 0.58, -0.25, sx * 0.525 + 0.012, 0.67, 0.25, 'py');
  M.box(C.oilLt, -0.61, 0.665, -0.36, 0.61, 0.722, 0.36, 'ny');
  const nx = 8, nz = 5, w = 1.22 / nx, d = 0.72 / nz, y = 0.7225;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      if ((i + j) % 2) continue;
      const x0 = -0.61 + i * w, z0 = -0.36 + j * d;
      M.quad(C.oilRed, [x0, y, z0], [x0 + w, y, z0], [x0 + w, y, z0 + d], [x0, y, z0 + d], [0, 1, 0]);
    }
  }
  // красная кайма свеса спереди
  M.quad(C.oilRed, [-0.61, 0.665, -0.3605], [0.61, 0.665, -0.3605], [0.61, 0.685, -0.3605], [-0.61, 0.685, -0.3605], [0, 0, -1]);
}

// ── табурет
{
  const M = new Model('p_obsh_stool');
  stool(M, 0, 0, 0.34, 0.45, C.woodLt, C.wood);
}

// ── шкаф с антресолью: две дверцы, две дверцы антресоли, чемодан сверху
{
  const M = new Model('p_obsh_wardrobe');
  M.box(C.woodDk, -0.38, 0, -0.23, 0.38, 0.07, 0.25, 'ny pz');
  M.box(C.wood, -0.4, 0.07, -0.24, 0.4, 1.98, 0.25, 'ny pz');
  M.box(C.woodDk, -0.41, 1.98, -0.255, 0.41, 2.0, 0.25, 'pz');
  M.box(C.woodDk, -0.4, 1.535, -0.248, 0.4, 1.55, -0.24, 'pz');
  for (const [x0, x1] of [[-0.39, -0.004], [0.004, 0.39]]) {
    M.box(C.woodLt, x0, 0.09, -0.25, x1, 1.52, -0.24, 'pz');
    M.box(C.woodLt, x0, 1.565, -0.25, x1, 1.965, -0.24, 'pz');
  }
  for (const x of [-0.03, 0.022]) {
    M.box(C.alu, x, 0.88, -0.262, x + 0.008, 1.04, -0.25, 'pz');
    M.box(C.alu, x, 1.71, -0.262, x + 0.008, 1.79, -0.25, 'pz');
  }
  M.quad(C.black, [0.04, 1.1, -0.2505], [0.048, 1.1, -0.2505], [0.048, 1.12, -0.2505], [0.04, 1.12, -0.2505], [0, 0, -1]);
  // чемодан: короб, ремни, ручка
  M.box(C.suitcase, -0.33, 2.0, -0.16, 0.25, 2.17, 0.22);
  for (const x of [-0.18, 0.1]) M.box(C.woodLt, x, 1.998, -0.163, x + 0.035, 2.173, 0.223);
  const h = [];
  for (let k = 0; k <= 6; k++) h.push([lerp(-0.12, 0.04, k / 6), 2.17 + 0.035 * Math.sin((k / 6) * PI), 0.03]);
  M.tube(C.black, h, 0.008, { seg: 5 });
}

// ── чугунный радиатор МС-140: 9 секций (две колонки, ниппели сверху и снизу), подводка в стену с краном
{
  const M = new Model('p_obsh_radiator');
  for (let k = 0; k < 9; k++) {
    const x = -0.32 + k * 0.08;
    M.box(C.radiator, x - 0.032, 0.09, -0.055, x + 0.032, 0.65, -0.012, 'ny');
    M.box(C.radiator, x - 0.032, 0.09, 0.0, x + 0.032, 0.65, 0.042, 'ny pz');
  }
  for (const y of [0.13, 0.61]) M.tube(C.radiator, [[-0.36, y, -0.006], [0.36, y, -0.006]], 0.022, { seg: 8, caps: true });
  for (const y of [0.13, 0.61]) M.tube(C.radiator, [[-0.36, y, -0.006], [-0.385, y, -0.006], [-0.385, y, 0.03], [-0.385, y, 0.06]], 0.013, { seg: 6 });
  M.tube(C.black, [[-0.385, 0.61, 0.0], [-0.385, 0.66, 0.0]], 0.006, { seg: 4 });
  M.box(C.fire, -0.4, 0.66, -0.008, -0.37, 0.67, 0.008);
}

// ── окно в стене: откосы, подоконник (верх 0.85), рама с форточкой, ночное стекло, шпингалеты, облупившаяся краска,
//    бумажные полоски на щелях (заклеено на зиму), тюль на карнизе
{
  const M = new Model('p_obsh_window');
  const Y0 = 0.85, Y1 = 2.35;
  M.box(C.plaster, -0.7, Y0, -0.05, -0.62, Y1, 0.05, 'pz ny');
  M.box(C.plaster, 0.62, Y0, -0.05, 0.7, Y1, 0.05, 'pz ny');
  M.box(C.plaster, -0.62, Y1 - 0.08, -0.05, 0.62, Y1, 0.05, 'pz');
  M.box(C.paint, -0.72, Y0 - 0.04, -0.17, 0.72, Y0, 0.05, 'pz');
  const F0 = 0.0, F1 = 0.045, top = Y1 - 0.08;
  M.box(C.paint, -0.62, Y0, F0, -0.56, top, F1, 'pz');
  M.box(C.paint, 0.56, Y0, F0, 0.62, top, F1, 'pz');
  M.box(C.paint, -0.56, top - 0.06, F0, 0.56, top, F1, 'pz');
  M.box(C.paint, -0.56, Y0, F0, 0.56, Y0 + 0.08, F1, 'pz');
  M.box(C.paint, -0.03, Y0 + 0.08, F0, 0.03, top - 0.06, F1, 'pz');
  M.box(C.paint, -0.56, 1.8, F0, -0.03, 1.85, F1, 'pz');
  M.box(C.paint, 0.03, 1.8, F0 + 0.01, 0.56, 1.84, F1, 'pz');
  M.quad(C.windowNight, [-0.56, Y0 + 0.08, 0.035], [0.56, Y0 + 0.08, 0.035], [0.56, top - 0.06, 0.035], [-0.56, top - 0.06, 0.035], [0, 0, -1]);
  // шпингалеты
  M.box(C.alu, -0.05, 1.35, -0.01, -0.035, 1.45, F0, 'pz');
  M.box(C.alu, 0.035, 1.35, -0.01, 0.05, 1.45, F0, 'pz');
  // облупилось
  for (const [x0, y0, x1, y1] of [[-0.615, 1.2, -0.57, 1.33], [0.2, Y0 + 0.02, 0.33, Y0 + 0.065], [-0.025, 1.95, 0.02, 2.04], [0.565, 1.55, 0.61, 1.62]]) {
    M.quad(C.grout, [x0, y0, F0 - 0.0008], [x1, y0, F0 - 0.0008], [x1, y1, F0 - 0.0008], [x0, y1, F0 - 0.0008], [0, 0, -1]);
  }
  M.quad(C.grout, [-0.5, Y0 + 0.0008, -0.12], [-0.32, Y0 + 0.0008, -0.12], [-0.32, Y0 + 0.0008, -0.04], [-0.5, Y0 + 0.0008, -0.04], [0, 1, 0]);
  // бумажные полоски по щелям
  M.quad(C.paperOld, [-0.016, Y0 + 0.08, F0 - 0.0012], [0.016, Y0 + 0.08, F0 - 0.0012], [0.016, top - 0.06, F0 - 0.0012], [-0.016, top - 0.06, F0 - 0.0012], [0, 0, -1]);
  M.quad(C.paperOld, [-0.56, 1.81, F0 - 0.0012], [-0.03, 1.81, F0 - 0.0012], [-0.03, 1.84, F0 - 0.0012], [-0.56, 1.84, F0 - 0.0012], [0, 0, -1]);
  // карниз-струна и тюль: слева — собран к краю, справа — узкий
  const YR = 2.43;
  M.tube(C.alu, [[-0.72, YR, -0.09], [0.72, YR, -0.09]], 0.006, { seg: 5, caps: true });
  const tulle = (xa, xb, edge, pleats) => {
    M.surface(C.tulle, pleats * 2, 3, (u, v) => {
      const k = Math.round(u * pleats * 2);
      const xt = lerp(xa, xb, u);
      const gather = v * v * 0.45;
      return [lerp(xt, edge, gather), lerp(YR - 0.01, Y0 + 0.04, v), -0.09 + (k % 2 ? 0.018 : -0.012) * (1 - 0.5 * v)];
    }, [0, 0, -1]);
  };
  tulle(-0.72, -0.28, -0.72, 6);
  tulle(0.42, 0.72, 0.72, 4);
}

// ── электроплита «Мечта»: эмаль, 4 чугунные конфорки, ручки, духовка с окошком и хромированной ручкой, кастрюля
{
  const M = new Model('p_obsh_stove');
  M.box(C.black, -0.24, 0, -0.27, 0.24, 0.06, 0.28, 'ny');
  M.box(C.enamel, -0.25, 0.06, -0.28, 0.25, 0.83, 0.3, 'ny pz');
  M.box(C.enamel, -0.25, 0.83, -0.3, 0.25, 0.85, 0.3, 'pz');
  M.box(C.enamel, -0.25, 0.74, -0.3, 0.25, 0.83, -0.28, 'pz');
  for (const x of [-0.18, -0.06, 0.06, 0.18]) M.tube(C.black, [[x, 0.785, -0.3], [x, 0.785, -0.322]], 0.017, { seg: 6, caps: 'end' });
  M.box(C.enamel, -0.235, 0.17, -0.295, 0.235, 0.72, -0.28, 'pz');
  M.quad(C.black, [-0.15, 0.33, -0.2955], [0.15, 0.33, -0.2955], [0.15, 0.56, -0.2955], [-0.15, 0.56, -0.2955], [0, 0, -1]);
  M.tube(C.chrome, [[-0.17, 0.675, -0.296], [-0.17, 0.675, -0.325], [0.17, 0.675, -0.325], [0.17, 0.675, -0.296]], 0.008, { seg: 6 });
  M.box(C.enamel, -0.235, 0.075, -0.295, 0.235, 0.155, -0.28, 'pz');
  M.box(C.chrome, -0.04, 0.11, -0.305, 0.04, 0.12, -0.295, 'pz');
  for (const [x, z, r] of [[-0.11, -0.12, 0.075], [0.11, -0.12, 0.075], [-0.11, 0.13, 0.062], [0.11, 0.13, 0.062]]) {
    M.lathe(C.black, [[r, 0.85], [r, 0.865], [0, 0.865]], { c: [x, 0, z], seg: 8 });
  }
  // сколы эмали
  M.quad(C.black, [0.2, 0.8505, 0.22], [0.225, 0.8505, 0.22], [0.225, 0.8505, 0.24], [0.2, 0.8505, 0.24], [0, 1, 0]);
  M.quad(C.black, [-0.22, 0.25, -0.2955], [-0.205, 0.25, -0.2955], [-0.205, 0.262, -0.2955], [-0.22, 0.262, -0.2955], [0, 0, -1]);
  // алюминиевая кастрюля с крышкой на передней левой конфорке
  M.lathe(C.chrome, [[0, 0.865], [0.075, 0.865], [0.08, 0.87], [0.08, 0.98], [0.083, 0.985], [0.072, 0.99], [0.025, 1.0], [0.012, 1.015], [0, 1.017]], { c: [-0.11, 0, -0.12], seg: 10 });
  for (const s of [-1, 1]) M.box(C.black, -0.11 + s * 0.08 - 0.015, 0.955, -0.135, -0.11 + s * 0.08 + 0.015, 0.968, -0.105);
}

// ── умывальник на кронштейнах (борт 0.8), сифон, кран из стены, зеркальце и полочка
{
  const M = new Model('p_obsh_sink');
  const T = 0.8, B = 0.66;
  M.box(C.enamel, -0.25, B, -0.2, 0.25, B + 0.02, 0.225, 'pz');
  M.box(C.enamel, -0.25, B, -0.2, 0.25, T, -0.18, '');
  M.box(C.enamel, -0.25, B, 0.2, 0.25, T, 0.225, 'pz');
  M.box(C.enamel, -0.25, B, -0.18, -0.23, T, 0.2, '');
  M.box(C.enamel, 0.23, B, -0.18, 0.25, T, 0.2, '');
  M.disc(C.black, [0, B + 0.021, 0.0], [0, 1, 0], 0.02, 10);
  M.disc(C.stain, [0, B + 0.0205, 0.0], [0, 1, 0], 0.07, 12, 1.4);
  for (const x of [-0.17, 0.17]) {
    M.box(C.black, x - 0.012, B - 0.04, -0.12, x + 0.012, B, 0.225, 'pz');
    M.tube(C.black, [[x, B - 0.03, -0.09], [x, B - 0.24, 0.215]], 0.009, { seg: 4 });
  }
  M.tube(C.black, [[0, B, 0], [0, 0.53, 0], [0, 0.48, 0.035], [0, 0.52, 0.08], [0, 0.53, 0.12], [0, 0.53, 0.225]], 0.02, { seg: 8 });
  M.tube(C.chrome, [[0, 0.98, 0.225], [0, 0.98, 0.11], [0, 0.955, 0.075], [0, 0.9, 0.07]], 0.011, { seg: 8, caps: 'end' });
  M.tube(C.chrome, [[0, 0.98, 0.16], [0, 1.03, 0.16]], 0.009, { seg: 6 });
  M.box(C.chrome, -0.035, 1.03, 0.152, 0.035, 1.04, 0.168);
  M.box(C.chrome, -0.21, 1.11, 0.214, 0.21, 1.63, 0.224, 'pz');
  M.box(C.mirror, -0.2, 1.12, 0.209, 0.2, 1.62, 0.214, 'pz');
  M.box(C.mirror, -0.2, 1.05, 0.15, 0.2, 1.058, 0.224, 'pz');
}

// ── холодильник «ЗиЛ»: скруглённый верх, дверца со скруглением, решётка цоколя, рычаг-ручка, шильдик
{
  const M = new Model('p_obsh_fridge');
  M.prism(C.enamel, 'z', rrect(-0.29, 0.08, 0.29, 1.4, 0.14, 0, 5), -0.27, 0.3, { smooth: 25 });
  M.prism(C.enamel, 'z', rrect(-0.284, 0.12, 0.284, 1.375, 0.127, 0.01, 4), -0.3, -0.27, { smooth: 25 });
  M.box(C.black, -0.27, 0, -0.25, 0.27, 0.08, 0.28, 'ny');
  M.box(C.enamel, -0.285, 0.0, -0.272, 0.285, 0.08, -0.262, 'ny pz');
  for (const y of [0.025, 0.045, 0.065]) M.quad(C.black, [-0.2, y - 0.005, -0.2725], [0.2, y - 0.005, -0.2725], [0.2, y + 0.005, -0.2725], [-0.2, y + 0.005, -0.2725], [0, 0, -1]);
  M.box(C.chrome, 0.2, 0.96, -0.312, 0.25, 1.12, -0.3, 'pz');
  M.prism(C.chrome, 'x', [[-0.312, 0.98], [-0.312, 1.1], [-0.35, 1.08], [-0.35, 1.0]], 0.215, 0.235);
  M.box(C.chrome, -0.1, 1.23, -0.305, 0.1, 1.265, -0.3, 'pz');
  M.quad(C.fire, [-0.09, 1.237, -0.3055], [-0.05, 1.237, -0.3055], [-0.05, 1.258, -0.3055], [-0.09, 1.258, -0.3055], [0, 0, -1]);
}

// ── стиральная машина «Рига»: круглый бак на трёх ножках, крышка с ручкой, реле времени, хром-поясок, сливной шланг
{
  const M = new Model('p_obsh_washer');
  M.lathe(C.enamel, [[0, 0.1], [0.2, 0.1], [0.225, 0.13], [0.23, 0.2], [0.23, 0.78], [0.225, 0.81], [0.212, 0.82], [0, 0.82]], { seg: 14 });
  M.lathe(C.chrome, [[0.232, 0.75], [0.232, 0.765]], { seg: 14 });
  M.lathe(C.enamel, [[0.215, 0.818], [0.215, 0.832], [0.16, 0.86], [0.05, 0.868], [0, 0.868]], { seg: 14 });
  M.lathe(C.black, [[0, 0.866], [0.028, 0.866], [0.028, 0.892], [0.02, 0.9], [0, 0.9]], { seg: 10 });
  for (let k = 0; k < 3; k++) {
    const f = PI / 2 + (k * 2 * PI) / 3;
    M.tube(C.black, [[0.16 * Math.cos(f), 0, 0.16 * Math.sin(f)], [0.16 * Math.cos(f), 0.11, 0.16 * Math.sin(f)]], 0.02, { seg: 6, caps: 'start' });
  }
  M.box(C.enamel, -0.06, 0.6, -0.245, 0.06, 0.72, -0.2, 'pz');
  M.tube(C.black, [[0.0, 0.66, -0.245], [0.0, 0.66, -0.268]], 0.022, { seg: 10, caps: 'end' });
  M.box(C.black, -0.004, 0.64, -0.272, 0.004, 0.68, -0.266);
  M.tube(C.hose, [[0.17, 0.12, 0.13], [0.22, 0.2, 0.12], [0.245, 0.4, 0.1], [0.25, 0.6, 0.09], [0.265, 0.64, 0.085], [0.28, 0.6, 0.08], [0.285, 0.45, 0.08], [0.28, 0.3, 0.085]], 0.012, { seg: 6, caps: 'end' });
  M.box(C.chrome, 0.225, 0.6, 0.075, 0.25, 0.62, 0.1);
}

// ── оцинкованное корыто на табурете: рёбра, ручки, мыльная вода и бельё
{
  const M = new Model('p_obsh_tub');
  stool(M, 0, 0, 0.34, 0.4, C.wood, C.wood);
  const o = { seg: 12, sx: 1.45, c: [0, 0, 0] };
  M.lathe(C.zinc, [[0, 0.4], [0.13, 0.4], [0.195, 0.62], [0.2, 0.625], [0.188, 0.625], [0.182, 0.612], [0.125, 0.41], [0, 0.41]], o);
  for (const [r, y] of [[0.165, 0.51]]) M.lathe(C.zinc, [[r + 0.004, y - 0.006], [r + 0.007, y], [r + 0.004, y + 0.006]], { ...o, smooth: true });
  M.lathe(C.water, [[0.171, 0.57], [0, 0.57]], o);
  M.blob(C.linen, [0.06, 0.572, 0.02], 0.11, 0.03, 0.08, 4, 8);
  M.blob(C.linen, [-0.1, 0.575, -0.04], 0.08, 0.035, 0.07, 4, 8);
  for (const s of [-1, 1]) {
    const pts = [];
    for (let k = 0; k <= 6; k++) {
      const f = -PI / 2 + (PI * k) / 6;
      pts.push([s * (0.27 + 0.04 * Math.cos(f)), 0.6, 0.05 * Math.sin(f)]);
    }
    M.tube(C.zinc, pts, 0.006, { seg: 4 });
  }
}

// ── туалет: чаша Генуя на кафельном подиуме, высокий чугунный бачок на 1.8 м с цепочкой, смывная труба, газета на гвозде
{
  const M = new Model('p_obsh_toilet');
  M.box(C.tileBeige, -0.25, 0, -0.29, 0.25, 0.14, 0.3, 'ny pz');
  M.box(C.tileDark, -0.25, 0, -0.3, 0.25, 0.14, -0.29, 'ny pz');
  M.box(C.enamel, -0.205, 0.14, -0.27, 0.205, 0.155, 0.27, 'ny');
  M.disc(C.stain, [0, 0.1555, 0.06], [0, 1, 0], 0.13, 14, 0.75);
  M.disc(C.black, [0, 0.156, 0.13], [0, 1, 0], 0.045, 10, 1.1);
  const rim = [];
  for (let k = 0; k < 14; k++) {
    const f = (k / 14) * 2 * PI;
    rim.push([0.1 * Math.cos(f), 0.158, 0.06 + 0.135 * Math.sin(f)]);
  }
  M.tube(C.enamel, rim, 0.007, { seg: 4, closed: true });
  for (const x of [-0.11, 0.11]) {
    M.box(C.enamel, x - 0.05, 0.155, -0.25, x + 0.05, 0.168, -0.09, 'ny');
    for (const z of [-0.22, -0.18, -0.14, -0.1]) M.quad(C.stain, [x - 0.04, 0.1685, z], [x + 0.04, 0.1685, z], [x + 0.04, 0.1685, z + 0.012], [x - 0.04, 0.1685, z + 0.012], [0, 1, 0]);
  }
  // бачок, кронштейны, рычаг и цепочка с грушей
  M.box(C.black, -0.2, 1.8, 0.11, 0.2, 2.02, 0.3, 'pz');
  for (const x of [-0.15, 0.15]) M.box(C.black, x - 0.012, 1.74, 0.13, x + 0.012, 1.8, 0.3, 'pz');
  M.box(C.black, -0.27, 1.99, 0.14, -0.2, 2.005, 0.16);
  const chain = [];
  for (let k = 0; k <= 6; k++) chain.push([-0.262 + 0.004 * Math.sin(k * 1.3), lerp(1.99, 1.26, k / 6), 0.15]);
  M.tube(C.black, chain, 0.003, { seg: 4 });
  M.blob(C.black, [-0.262, 1.225, 0.15], 0.018, 0.038, 0.018, 4, 8);
  M.tube(C.rust, [[0.1, 1.8, 0.255], [0.1, 0.32, 0.255], [0.07, 0.22, 0.255], [0.02, 0.17, 0.25]], 0.017, { seg: 6 });
  M.box(C.black, 0.17, 0.72, 0.285, 0.18, 0.73, 0.3);
  M.box(C.paperOld, 0.13, 0.58, 0.29, 0.23, 0.72, 0.297, 'pz');
  M.quad(C.black, [0.14, 0.65, 0.2895], [0.22, 0.65, 0.2895], [0.22, 0.705, 0.2895], [0.14, 0.705, 0.2895], [0, 0, -1]);
}

// ── перегородка кабинки: кирпич в плитке 150×150 (низ зелёный, бордюр тёмный, верх беж), высота 1.8, швы.
//    Тонкая — вдоль X (0.05), длинная — вдоль Z: от стены (+Z) в комнату (−Z).
{
  const M = new Model('p_obsh_partition');
  const W = 0.025, L = 0.75;
  M.box(C.tileGreen, -W, 0, -L, W, 1.05, L, 'ny pz py');
  M.box(C.tileDark, -W, 1.05, -L, W, 1.2, L, 'ny pz py');
  M.box(C.tileBeige, -W, 1.2, -L, W, 1.78, L, 'ny pz py');
  M.box(C.tileBeige, -W - 0.004, 1.78, -L - 0.004, W + 0.004, 1.8, L, 'pz');
  const g = 0.004;
  for (const s of [-1, 1]) {
    const x = s * (W + 0.0008);
    for (let k = 1; k <= 11; k++) {
      const y = k * 0.15;
      M.quad(C.grout, [x, y - g, -L], [x, y - g, L], [x, y + g, L], [x, y + g, -L], [s, 0, 0]);
    }
    for (let k = 1; k <= 9; k++) {
      const z = -L + k * 0.15;
      M.quad(C.grout, [x, 0, z - g], [x, 1.78, z - g], [x, 1.78, z + g], [x, 0, z + g], [s, 0, 0]);
    }
  }
  for (let k = 1; k <= 11; k++) {
    const y = k * 0.15, z = -L - 0.0008;
    M.quad(C.grout, [-W, y - g, z], [W, y - g, z], [W, y + g, z], [-W, y + g, z], [0, 0, -1]);
  }
}

// ── душ: эмалированный поддон с трапом (ржавый подтёк), смеситель с вентилями, стояк, лейка на 2.1 м,
//    Г-образная штанга со шторкой, собранной в угол
{
  const M = new Model('p_obsh_shower');
  const H = 0.1;
  M.box(C.enamel, -0.43, 0, -0.43, 0.43, 0.04, 0.43, 'ny');
  M.box(C.enamel, -0.43, 0.04, -0.43, 0.43, H, -0.39, 'ny');
  M.box(C.enamel, -0.43, 0.04, 0.39, 0.43, H, 0.43, 'ny');
  M.box(C.enamel, -0.43, 0.04, -0.39, -0.39, H, 0.39, 'ny');
  M.box(C.enamel, 0.39, 0.04, -0.39, 0.43, H, 0.39, 'ny');
  M.disc(C.rust, [0, 0.0405, 0], [0, 1, 0], 0.09, 12, 1.3);
  M.disc(C.chrome, [0, 0.041, 0], [0, 1, 0], 0.04, 12);
  M.disc(C.black, [0, 0.0415, 0], [0, 1, 0], 0.032, 12);
  // трубы из стены, смеситель, вентили
  for (const x of [0.21, 0.39]) M.tube(C.chrome, [[x, 1.05, 0.45], [x, 1.05, 0.405]], 0.012, { seg: 6 });
  M.tube(C.chrome, [[0.18, 1.1, 0.4], [0.42, 1.1, 0.4]], 0.018, { seg: 8, caps: true });
  for (const [x, m] of [[0.21, C.fire], [0.39, C.blue]]) {
    M.tube(C.chrome, [[x, 1.1, 0.4], [x, 1.1, 0.36]], 0.008, { seg: 6 });
    M.box(m, x - 0.03, 1.094, 0.35, x + 0.03, 1.106, 0.362);
    M.box(m, x - 0.006, 1.07, 0.35, x + 0.006, 1.13, 0.362);
  }
  M.tube(C.chrome, [[0.3, 1.1, 0.4], [0.3, 2.13, 0.4], [0.3, 2.16, 0.37], [0.3, 2.16, 0.24], [0.3, 2.14, 0.21]], 0.011, { seg: 6 });
  M.lathe(C.chrome, [[0, 2.06], [0.06, 2.06], [0.062, 2.07], [0.014, 2.135], [0, 2.14]], { c: [0.3, 0, 0.21], seg: 12 });
  M.disc(C.black, [0.3, 2.0595, 0.21], [0, -1, 0], 0.05, 12);
  // штанга для шторки и шторка
  M.tube(C.chrome, [[0.43, 2.0, -0.42], [-0.42, 2.0, -0.42], [-0.42, 2.0, 0.45]], 0.008, { seg: 5 });
  M.tube(C.chrome, [[0.43, 2.0, -0.42], [0.43, 2.0, -0.44]], 0.008, { seg: 5 });
  M.surface(C.curtain, 10, 3, (u, v) => {
    const k = Math.round(u * 10);
    const amp = (k % 2 ? 0.035 : -0.035) * (1 - 0.3 * v);
    return [-0.42 + amp, lerp(1.985, 0.3, v), lerp(-0.42, -0.06, u) + 0.06 * v * (u - 0.5)];
  }, [1, 0, 0]);
}

// ── скамья из реек на двух козлах
{
  const M = new Model('p_obsh_bench');
  for (const z of [-0.1, 0, 0.1]) M.box(C.wood, -0.5, 0.42, z - 0.04, 0.5, 0.45, z + 0.04);
  for (const x of [-0.38, 0.38]) {
    for (const z of [-0.11, 0.11]) M.box(C.woodDk, x - 0.022, 0, z - 0.022, x + 0.022, 0.38, z + 0.022, 'ny py');
    M.box(C.woodDk, x - 0.025, 0.38, -0.145, x + 0.025, 0.42, 0.145, '');
    M.box(C.woodDk, x - 0.015, 0.1, -0.09, x + 0.015, 0.14, 0.09, '');
  }
  M.box(C.woodDk, -0.36, 0.1, -0.015, 0.36, 0.14, 0.015, 'px nx');
}

// ── стол вахтёра: тумба с ящиками, бакелитовый телефон с диском, лампа с зелёным абажуром (внутри светится —
//    obsh_lamp_glow), журнал регистрации с ручкой, стакан чая в подстаканнике. Вахтёр сидит спереди (−Z).
{
  const M = new Model('p_obsh_vahter_desk');
  const T = 0.75;
  M.box(C.woodLt, -0.6, 0.72, -0.3, 0.6, T, 0.3);
  M.box(C.wood, 0.13, 0, -0.27, 0.57, 0.03, 0.27, 'ny');
  M.box(C.wood, 0.12, 0.03, -0.28, 0.58, 0.72, 0.28, 'ny py');
  for (const [y0, y1] of [[0.5, 0.7], [0.28, 0.48], [0.05, 0.26]]) {
    M.box(C.woodLt, 0.135, y0, -0.29, 0.565, y1, -0.28, 'pz');
    M.box(C.alu, 0.31, (y0 + y1) / 2 - 0.008, -0.302, 0.39, (y0 + y1) / 2 + 0.008, -0.29, 'pz');
  }
  M.box(C.wood, -0.585, 0, -0.28, -0.55, 0.72, 0.28, 'py');
  M.box(C.wood, -0.55, 0.25, 0.25, 0.12, 0.72, 0.27, 'py');
  // телефон: корпус с наклонной передней гранью, диск, рычаг, трубка, шнур
  M.prism(C.black, 'x', [[0.02, T], [0.22, T], [0.22, T + 0.07], [0.16, T + 0.09], [0.02, T + 0.05]], -0.42, -0.22);
  const sl = Math.atan2(0.04, 0.14), nd = [0, Math.cos(sl), -Math.sin(sl)], dc = [-0.32, T + 0.07, 0.09];
  M.tube(C.paper, [dc, add(dc, mul(nd, 0.008))], 0.045, { seg: 10, caps: 'end' });
  M.disc(C.black, add(dc, mul(nd, 0.0085)), nd, 0.016, 10);
  for (const x of [-0.4, -0.24]) M.box(C.black, x - 0.012, T + 0.09, 0.17, x + 0.012, T + 0.105, 0.2);
  M.box(C.black, -0.42, T + 0.112, 0.168, -0.22, T + 0.13, 0.198);
  for (const x of [-0.41, -0.23]) M.lathe(C.black, [[0, T + 0.095], [0.032, T + 0.095], [0.034, T + 0.11], [0.022, T + 0.125], [0, T + 0.125]], { c: [x, 0, 0.183], seg: 8 });
  M.tube(C.black, [[-0.44, T + 0.1, 0.183], [-0.47, T + 0.04, 0.16], [-0.46, T + 0.01, 0.1], [-0.43, T + 0.02, 0.06], [-0.42, T + 0.03, 0.05]], 0.004, { seg: 4 });
  // лампа: латунное основание, стойка, полуцилиндр-абажур (снаружи зелёный, внутри светится), лампочка
  M.box(C.brass, 0.18, T, 0.06, 0.42, T + 0.02, 0.2);
  M.tube(C.brass, [[0.3, T + 0.02, 0.15], [0.3, T + 0.26, 0.15], [0.3, T + 0.29, 0.12]], 0.008, { seg: 6 });
  const sc = [0.3, T + 0.29, 0.1];
  M.lathe(C.greenShade, [[0, -0.15], [0.07, -0.15], [0.07, 0.15], [0, 0.15]], { axis: 'x', c: sc, a0: 0, a1: PI, seg: 8 });
  M.lathe(C.lampGlow, [[0.066, 0.147], [0.066, -0.147]], { axis: 'x', c: sc, a0: 0, a1: PI, seg: 8 });
  M.blob(C.lampGlow, [0.3, T + 0.28, 0.1], 0.06, 0.022, 0.022, 4, 8);
  // журнал регистрации: обложка, две страницы со строками, ручка
  M.box(C.book, -0.27, T, -0.26, 0.17, T + 0.008, 0.06, 'ny');
  for (const [x0, x1] of [[-0.265, -0.055], [-0.045, 0.165]]) {
    M.box(C.paper, x0, T + 0.008, -0.255, x1, T + 0.017, 0.055, 'ny');
    for (let k = 0; k < 6; k++) {
      const z = -0.22 + k * 0.045, len = x1 - x0 - 0.04 - (k === 5 && x0 > -0.1 ? 0.1 : 0);
      M.quad(C.black, [x0 + 0.02, T + 0.0175, z], [x0 + 0.02 + len, T + 0.0175, z], [x0 + 0.02 + len, T + 0.0175, z + 0.004], [x0 + 0.02, T + 0.0175, z + 0.004], [0, 1, 0]);
    }
  }
  M.tube(C.black, [[0.12, T + 0.022, -0.22], [0.2, T + 0.022, -0.08]], 0.004, { seg: 4, caps: true });
  // стакан в подстаканнике
  const gc = [-0.5, 0, -0.08];
  M.lathe(C.alu, [[0, T], [0.034, T], [0.031, T + 0.02], [0.034, T + 0.065], [0.037, T + 0.07]], { c: gc, seg: 8 });
  M.lathe(C.tea, [[0.033, T + 0.07], [0.035, T + 0.1], [0.032, T + 0.1], [0, T + 0.098]], { c: gc, seg: 8 });
  M.tube(C.alu, [[-0.465, T + 0.06, -0.08], [-0.44, T + 0.058, -0.08], [-0.44, T + 0.025, -0.08], [-0.468, T + 0.022, -0.08]], 0.004, { seg: 4 });
}

// ── ключница на стене (1.2–2.0 м): фанерный щит в рамке, табличка, 4 × 5 крючков с номерками, ключи на бирках
{
  const M = new Model('p_obsh_keyboard');
  const Z0 = 0.015, ZW = 0.04;
  M.box(C.woodLt, -0.3, 1.2, Z0, 0.3, 2.0, ZW, 'pz');
  for (const [x0, y0, x1, y1] of [[-0.3, 1.2, -0.275, 2.0], [0.275, 1.2, 0.3, 2.0], [-0.275, 1.2, 0.275, 1.225], [-0.275, 1.975, 0.275, 2.0]]) M.box(C.woodDk, x0, y0, Z0 - 0.008, x1, y1, ZW, 'pz');
  M.box(C.paper, -0.14, 1.915, Z0 - 0.002, 0.14, 1.955, Z0, 'pz');
  for (let k = 0; k < 5; k++) M.quad(C.black, [-0.1 + k * 0.045, 1.925, Z0 - 0.0025], [-0.07 + k * 0.045, 1.925, Z0 - 0.0025], [-0.07 + k * 0.045, 1.945, Z0 - 0.0025], [-0.1 + k * 0.045, 1.945, Z0 - 0.0025], [0, 0, -1]);
  let keys = 0;
  for (let r = 0; r < 5; r++) {
    const y = 1.84 - r * 0.14;
    for (let c = 0; c < 4; c++) {
      const x = -0.195 + c * 0.13;
      // крючок — штырь (видны торец, верх и бока), номерок над ним
      M.box(C.alu, x - 0.004, y - 0.004, Z0 - 0.028, x + 0.004, y + 0.004, Z0, 'pz ny px nx');
      M.quad(C.paper, [x - 0.022, y + 0.018, Z0 - 0.0005], [x + 0.022, y + 0.018, Z0 - 0.0005], [x + 0.022, y + 0.04, Z0 - 0.0005], [x - 0.022, y + 0.04, Z0 - 0.0005], [0, 0, -1]);
      if (rnd() < 0.35) continue;
      keys++;
      // бирка (лицо и бока) и ключ (лицо)
      const tag = rnd() < 0.2 ? C.fire : C.woodDk;
      M.box(tag, x - 0.013, y - 0.075, Z0 - 0.024, x + 0.013, y - 0.012, Z0 - 0.014, 'pz py ny');
      M.quad(C.brass, [x + 0.014, y - 0.06, Z0 - 0.022], [x + 0.022, y - 0.06, Z0 - 0.022], [x + 0.022, y - 0.006, Z0 - 0.022], [x + 0.014, y - 0.006, Z0 - 0.022], [0, 0, -1]);
    }
  }
  M.extras.keys = keys;
}

// ── доска объявлений (1.0–1.7 м): фанера в рамке, красная шапка «ОБЪЯВЛЕНИЯ», листки (один — «пропал человек»
//    с фото), строчки, кнопки
{
  const M = new Model('p_obsh_noticeboard');
  const ZB = 0.005, ZW = 0.025;
  M.box(C.woodLt, -0.5, 1.0, ZB, 0.5, 1.7, ZW, 'pz');
  for (const [x0, y0, x1, y1] of [[-0.5, 1.0, -0.48, 1.7], [0.48, 1.0, 0.5, 1.7], [-0.48, 1.0, 0.48, 1.02], [-0.48, 1.68, 0.48, 1.7]]) M.box(C.woodDk, x0, y0, ZB - 0.008, x1, y1, ZW, 'pz');
  M.box(C.fire, -0.42, 1.6, ZB - 0.003, 0.42, 1.665, ZB, 'pz');
  for (let k = 0; k < 10; k++) {
    const x = -0.36 + k * 0.08;
    M.quad(C.paper, [x - 0.022, 1.612, ZB - 0.0035], [x + 0.022, 1.612, ZB - 0.0035], [x + 0.022, 1.653, ZB - 0.0035], [x - 0.022, 1.653, ZB - 0.0035], [0, 0, -1]);
  }
  const sheets = [
    [-0.33, 1.36, 0.21, 0.29, -0.03, C.paper, 7, false],
    [-0.08, 1.45, 0.2, 0.15, 0.025, C.paperOld, 3, false],
    [-0.08, 1.2, 0.18, 0.2, -0.05, C.paper, 4, false],
    [0.17, 1.36, 0.21, 0.29, 0.015, C.paperOld, 4, true],
    [0.39, 1.47, 0.12, 0.16, 0.06, C.paper, 3, false],
    [0.37, 1.16, 0.14, 0.12, -0.02, C.paper, 2, false],
    [-0.37, 1.1, 0.13, 0.09, 0.04, C.paperOld, 1, false],
  ];
  sheets.forEach(([cx, cy, w, h, a, m, lines, photo], k) => {
    const z = ZB - 0.001 - k * 0.0004;
    M.rq(m, cx, cy, z, a, -w / 2, -h / 2, w / 2, h / 2);
    const zl = z - 0.0002;
    let y = h / 2 - 0.03;
    if (photo) {
      M.rq(C.black, cx, cy, zl, a, -0.07, h / 2 - 0.035, 0.07, h / 2 - 0.02);
      M.rq(C.black, cx, cy, zl, a, -0.05, h / 2 - 0.15, 0.05, h / 2 - 0.045);
      y = h / 2 - 0.17;
    }
    for (let i = 0; i < lines; i++, y -= 0.024) {
      const len = (w - 0.04) * (i === lines - 1 ? 0.5 : 0.8 + 0.2 * rnd());
      M.rq(C.black, cx, cy, zl, a, -w / 2 + 0.02, y - 0.003, -w / 2 + 0.02 + len, y + 0.003);
    }
    M.rq(C.fire, cx, cy, zl - 0.0002, a, -0.005, h / 2 - 0.012, 0.005, h / 2 - 0.002);
  });
}

// ── диван дерматиновый трёхместный: ножки, рама, три подушки сиденья и три спинки (швы между), подлокотники
//    с деревянными накладками
{
  const M = new Model('p_obsh_sofa');
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) M.box(C.woodDk, sx * 0.82 - 0.025, 0, sz * 0.32 - 0.025, sx * 0.82 + 0.025, 0.1, sz * 0.32 + 0.025, 'ny py');
  M.box(C.woodDk, -0.86, 0.1, -0.36, 0.86, 0.2, 0.38);
  const seat = [[-0.38, 0.2], [0.2, 0.2], [0.2, 0.42], [-0.35, 0.43], [-0.385, 0.4]];
  const back = [[0.2, 0.2], [0.38, 0.2], [0.4, 0.86], [0.37, 0.9], [0.28, 0.9], [0.24, 0.87]];
  for (const [x0, x1] of [[-0.8, -0.27], [-0.265, 0.265], [0.27, 0.8]]) {
    M.prism(C.derm, 'x', seat, x0, x1, { smooth: 35 });
    M.prism(C.derm, 'x', back, x0, x1, { smooth: 35 });
    for (const t of [0.35, 0.65]) M.disc(C.black, [lerp(x0, x1, t), 0.7, 0.2948 - 0.006], [0, 0.03, -1], 0.009, 6);
  }
  for (const s of [-1, 1]) {
    M.box(C.derm, s > 0 ? 0.805 : -0.895, 0.1, -0.38, s > 0 ? 0.895 : -0.805, 0.58, 0.38);
    M.box(C.woodLt, s > 0 ? 0.8 : -0.9, 0.58, -0.39, s > 0 ? 0.9 : -0.8, 0.61, 0.39);
  }
}

// ── стул деревянный: передние ножки, задние ножки-стойки до 0.88, сиденье, царги, две планки спинки
{
  const M = new Model('p_obsh_chair');
  for (const sx of [-1, 1]) {
    M.box(C.wood, sx * 0.18 - 0.0175, 0, -0.195, sx * 0.18 + 0.0175, 0.43, -0.16, 'ny py');
    M.box(C.wood, sx * 0.18 - 0.0175, 0, 0.16, sx * 0.18 + 0.0175, 0.88, 0.195, 'ny');
    M.box(C.wood, sx * 0.18 - 0.01, 0.15, -0.16, sx * 0.18 + 0.01, 0.18, 0.16, 'px nx'.replace(sx > 0 ? 'nx' : 'px', ''));
  }
  for (const [z0, z1] of [[-0.19, -0.17], [0.17, 0.19]]) M.box(C.wood, -0.16, 0.37, z0, 0.16, 0.43, z1);
  for (const sx of [-1, 1]) M.box(C.wood, sx * 0.18 - 0.01, 0.37, -0.16, sx * 0.18 + 0.01, 0.43, 0.16);
  M.box(C.woodLt, -0.21, 0.43, -0.21, 0.21, 0.46, 0.2);
  for (const [y0, y1] of [[0.6, 0.68], [0.77, 0.86]]) M.box(C.woodLt, -0.1625, y0, 0.168, 0.1625, y1, 0.188);
}

// ── телевизор «Рекорд» на ножках: подставка (ножки враспор, полка), корпус под дерево, выпуклый экран (светится
//    чуть-чуть — obsh_tv_glow), ручки, решётка динамика, задняя крышка кинескопа, антенна-«рога»
{
  const M = new Model('p_obsh_tv');
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) M.tube(C.woodDk, [[sx * 0.19, 0.5, sz * 0.16], [sx * 0.225, 0, sz * 0.2]], 0.013, { seg: 5, caps: 'start' });
  M.box(C.wood, -0.24, 0.5, -0.21, 0.24, 0.53, 0.21);
  M.box(C.wood, -0.205, 0.17, -0.175, 0.205, 0.19, 0.175);
  M.box(C.tvCase, -0.24, 0.53, -0.2, 0.24, 0.93, 0.13, 'ny');
  M.box(C.tvCase, -0.17, 0.58, 0.13, 0.17, 0.88, 0.21, 'ny nz');
  M.box(C.black, -0.215, 0.565, -0.205, 0.095, 0.895, -0.2, 'pz');
  M.surface(C.tvGlow, 4, 4, (u, v) => [lerp(-0.2, 0.08, u), lerp(0.578, 0.882, v), -0.206 - 0.012 * Math.sin(PI * u) * Math.sin(PI * v)], [0, 0, -1]);
  M.quad(C.alu, [0.105, 0.565, -0.2005], [0.225, 0.565, -0.2005], [0.225, 0.895, -0.2005], [0.105, 0.895, -0.2005], [0, 0, -1]);
  M.tube(C.black, [[0.165, 0.82, -0.2], [0.165, 0.82, -0.225]], 0.03, { seg: 10, caps: 'end' });
  M.box(C.alu, 0.161, 0.795, -0.228, 0.169, 0.845, -0.224);
  for (const x of [0.135, 0.195]) M.tube(C.black, [[x, 0.73, -0.2], [x, 0.73, -0.215]], 0.014, { seg: 8, caps: 'end' });
  for (let k = 0; k < 5; k++) {
    const y = 0.6 + k * 0.018;
    M.quad(C.black, [0.12, y, -0.201], [0.21, y, -0.201], [0.21, y + 0.008, -0.201], [0.12, y + 0.008, -0.201], [0, 0, -1]);
  }
  M.box(C.black, -0.04, 0.93, -0.03, 0.04, 0.95, 0.03, 'ny');
  for (const s of [-1, 1]) M.tube(C.alu, [[s * 0.01, 0.95, 0], [s * 0.19, 1.18, 0.04]], 0.003, { seg: 4, caps: 'end' });
}

// ── часы настенные на 2.2 м: корпус, циферблат, деления, стрелки (без двадцати четыре), секундная
{
  const M = new Model('p_obsh_clock');
  const Y = 2.2, ZW = 0.03, ZF = -0.02, R = 0.165;
  M.tube(C.black, [[0, Y, ZW], [0, Y, ZF]], R, { seg: 20 });
  M.disc(C.black, [0, Y, ZF], [0, 0, -1], R, 20);
  M.disc(C.paper, [0, Y, ZF - 0.0005], [0, 0, -1], R - 0.018, 20);
  for (let k = 0; k < 12; k++) {
    const a = PI / 2 - (k * PI) / 6, big = k % 3 === 0;
    M.rq(C.black, 0, Y, ZF - 0.001, a, R - 0.05, big ? -0.006 : -0.003, R - (big ? 0.025 : 0.03), big ? 0.006 : 0.003);
  }
  const hand = (m, ang, len, w, z) => M.rq(m, 0, Y, z, PI / 2 - ang, -0.015, -w, len, w);
  hand(C.black, (3 + 40 / 60) * (PI / 6), 0.075, 0.006, ZF - 0.0015);
  hand(C.black, 40 * (PI / 30), 0.115, 0.004, ZF - 0.002);
  hand(C.fire, 9 * (PI / 30), 0.12, 0.0012, ZF - 0.0025);
  M.disc(C.black, [0, Y, ZF - 0.003], [0, 0, -1], 0.008, 8);
}

// ── огнетушитель ОП на кронштейне (хомут на 1.25 м): баллон, этикетка, головка с рычагом, шланг с насадкой
{
  const M = new Model('p_obsh_fire_ext');
  const c = [0, 0, -0.005];
  M.lathe(C.fire, [[0, 0.95], [0.065, 0.95], [0.07, 0.96], [0.07, 1.36], [0.062, 1.395], [0.04, 1.415], [0.02, 1.42], [0, 1.42]], { c, seg: 12 });
  M.lathe(C.black, [[0, 1.418], [0.021, 1.418], [0.021, 1.455], [0.026, 1.46], [0.026, 1.48], [0, 1.48]], { c, seg: 10 });
  M.box(C.alu, -0.009, 1.48, -0.075, 0.009, 1.492, 0.02);
  M.box(C.alu, -0.007, 1.462, -0.072, 0.007, 1.47, -0.02);
  M.lathe(C.paper, [[0.0705, 1.1], [0.0705, 1.24]], { c, a0: -PI / 2 - 0.55, a1: -PI / 2 + 0.55, seg: 4 });
  M.tube(C.black, [[0.022, 1.445, -0.005], [0.06, 1.44, -0.01], [0.085, 1.38, -0.02], [0.085, 1.15, -0.025], [0.08, 1.06, -0.025]], 0.007, { seg: 5 });
  M.tube(C.black, [[0.08, 1.06, -0.025], [0.08, 1.0, -0.025]], 0.011, { seg: 6, caps: 'end' });
  const ring = [];
  for (let k = 0; k < 12; k++) {
    const f = (k / 12) * 2 * PI;
    ring.push([0.075 * Math.cos(f), 1.25, -0.005 + 0.075 * Math.sin(f)]);
  }
  M.tube(C.black, ring, 0.006, { seg: 4, closed: true });
  M.box(C.black, -0.04, 1.14, 0.068, 0.04, 1.32, 0.075, 'pz');
}

// ── оцинкованное ведро с водой, дужкой с деревянной ручкой и швабра с тряпкой, прислонённая к стене
{
  const M = new Model('p_obsh_bucket');
  M.lathe(C.zinc, [[0, 0], [0.105, 0], [0.135, 0.27], [0.14, 0.275], [0.132, 0.275], [0.128, 0.268], [0.1, 0.02], [0, 0.02]], { seg: 12 });
  M.lathe(C.zinc, [[0.117, 0.1], [0.121, 0.106], [0.117, 0.112]], { seg: 12, smooth: true });
  M.lathe(C.water, [[0.12, 0.17], [0, 0.17]], { seg: 12 });
  for (const s of [-1, 1]) M.box(C.zinc, s * 0.137 - 0.006, 0.235, -0.012, s * 0.137 + 0.006, 0.265, 0.012);
  const bail = [], tilt = (70 * PI) / 180, R = 0.138;
  for (let k = 0; k <= 10; k++) {
    const f = (PI * k) / 10;
    bail.push([R * Math.cos(f), 0.25 + R * Math.sin(f) * Math.cos(tilt), R * Math.sin(f) * Math.sin(tilt)]);
  }
  M.tube(C.iron, bail, 0.003, { seg: 4 });
  const mid = (f) => [R * Math.cos(f), 0.25 + R * Math.sin(f) * Math.cos(tilt), R * Math.sin(f) * Math.sin(tilt)];
  M.tube(C.wood, [mid(PI / 2 - 0.3), mid(PI / 2), mid(PI / 2 + 0.3)], 0.01, { seg: 6, caps: true });
  M.tube(C.wood, [[0.02, 0.12, -0.01], [0.06, 1.25, 0.125]], 0.014, { seg: 6, caps: 'end' });
  M.blob(C.rag, [-0.06, 0.27, -0.07], 0.08, 0.03, 0.06, 4, 8);
  M.blob(C.rag, [-0.09, 0.2, -0.125], 0.05, 0.075, 0.022, 4, 8);
}

// ── трубы по стене (1.6–2.1 м), отрезок 2 м вдоль X — соседние стыкуются: в изоляции (бандажи), ржавая с красным
//    вентилем, чугунная канализационная с раструбами; хомуты на полосе
{
  const M = new Model('p_obsh_pipes');
  const L = 1.0;
  M.tube(C.insul, [[-L, 1.98, 0.02], [L, 1.98, 0.02]], 0.08, { seg: 8, caps: true });
  for (const x of [-0.75, -0.25, 0.25, 0.75]) M.tube(C.black, [[x - 0.008, 1.98, 0.02], [x + 0.008, 1.98, 0.02]], 0.083, { seg: 8 });
  M.tube(C.rust, [[-L, 1.8, 0.065], [L, 1.8, 0.065]], 0.03, { seg: 8, caps: true });
  M.tube(C.black, [[0.3, 1.8, 0.065], [0.4, 1.8, 0.065]], 0.042, { seg: 8, caps: true });
  M.tube(C.black, [[0.35, 1.8, 0.065], [0.35, 1.8, -0.06]], 0.011, { seg: 6 });
  const wheel = [];
  for (let k = 0; k < 12; k++) {
    const f = (k / 12) * 2 * PI;
    wheel.push([0.35 + 0.05 * Math.cos(f), 1.8 + 0.05 * Math.sin(f), -0.06]);
  }
  M.tube(C.fire, wheel, 0.007, { seg: 5, closed: true });
  for (let k = 0; k < 3; k++) {
    const f = (k * 2 * PI) / 3 + 0.3;
    M.tube(C.fire, [[0.35, 1.8, -0.06], [0.35 + 0.048 * Math.cos(f), 1.8 + 0.048 * Math.sin(f), -0.06]], 0.005, { seg: 4 });
  }
  M.tube(C.black, [[-L, 1.665, 0.065], [L, 1.665, 0.065]], 0.052, { seg: 8, caps: true });
  for (const x of [-0.5, 0.5]) M.tube(C.black, [[x, 1.665, 0.065], [x + 0.08, 1.665, 0.065]], 0.064, { seg: 8, caps: true });
  for (const x of [-0.65, 0.65]) {
    M.box(C.black, x - 0.015, 1.6, 0.115, x + 0.015, 2.075, 0.125, 'pz');
    for (const [y, r, z] of [[1.665, 0.052, 0.065], [1.8, 0.03, 0.065], [1.98, 0.08, 0.02]]) M.box(C.black, x - 0.012, y - r - 0.012, z, x + 0.012, y - r, 0.115, 'pz');
  }
}

// ── плафон-шар на шнуре (подвесной: верх — 0, низ шара — −0.35): чашка у потолка, шнур, держатель, молочный шар
//    (светится — obsh_lamp_glow)
{
  const M = new Model('p_obsh_plafond', { ceil: true });
  M.lathe(C.enamel, [[0, -0.025], [0.06, -0.025], [0.066, -0.015], [0.066, 0]], { seg: 12 });
  M.tube(C.black, [[0, -0.025, 0], [0, -0.135, 0]], 0.004, { seg: 5 });
  M.lathe(C.alu, [[0.05, -0.168], [0.047, -0.145], [0.014, -0.133], [0.008, -0.13]], { seg: 12 });
  const prof = [];
  for (let k = 0; k <= 8; k++) {
    const f = -PI / 2 + ((PI / 2 + 1.1) * k) / 8;
    prof.push([0.1 * Math.cos(f), -0.25 + 0.1 * Math.sin(f)]);
  }
  prof.push([0.04, -0.152]);
  M.lathe(C.lampGlow, prof, { seg: 12, smooth: true });
}

// ── светильник ЛДС на потолке (подвесной: верх — 0): белый короб-швеллер, патроны, трубка (светится — obsh_tube_glow)
{
  const M = new Model('p_obsh_tube', { ceil: true });
  M.box(C.enamel, -0.6, -0.055, -0.065, 0.6, 0, 0.065, 'py');
  for (const s of [-1, 1]) M.box(C.alu, s > 0 ? 0.565 : -0.595, -0.095, -0.025, s > 0 ? 0.595 : -0.565, -0.055, 0.025, 'py');
  M.tube(C.tubeGlow, [[-0.565, -0.078, 0], [0.565, -0.078, 0]], 0.013, { seg: 8, caps: true });
}

// ── лестничный марш (декор): 10 ступеней 0.15 × 0.30, подъём к +Z (от переда к стене), проступи светлее подступёнков;
//    перила на +X (справа при подъёме): стойки, металлический поручень с ПВХ-накладкой на 0.9 м, нижняя тяга
{
  const M = new Model('p_obsh_stair_flight');
  const W = 0.6, Z0 = -1.5, R = 0.15, D = 0.3;
  for (let k = 0; k < 10; k++) {
    const z0 = Z0 + k * D, z1 = z0 + D, y0 = k * R, y1 = y0 + R;
    M.quad(C.concrete, [-W, y1, z0], [W, y1, z0], [W, y1, z1], [-W, y1, z1], [0, 1, 0]);
    M.quad(C.concreteDk, [-W, y0, z0], [W, y0, z0], [W, y1, z0], [-W, y1, z0], [0, 0, -1]);
    for (const s of [-1, 1]) M.quad(C.concreteDk, [s * W, 0, z0], [s * W, 0, z1], [s * W, y1, z1], [s * W, y1, z0], [s, 0, 0]);
  }
  M.quad(C.concreteDk, [-W, 0, -Z0], [W, 0, -Z0], [W, 1.5, -Z0], [-W, 1.5, -Z0], [0, 0, 1]);
  // линия носиков проступей yn(z); стойки — у носика каждой ступени; поручень кончается над последней (верх < 2.5)
  const XR = 0.55, yn = (z) => R + 0.5 * (z - Z0), ZE = Z0 + 9 * D + 0.1;
  for (let k = 0; k < 10; k++) {
    const z = Z0 + k * D + 0.08;
    M.tube(C.iron, [[XR, (k + 1) * R, z], [XR, yn(z) + 0.88, z]], 0.008, { seg: 4, phase: PI / 4 });
  }
  M.tube(C.iron, [[XR, yn(Z0) + 0.1, Z0], [XR, yn(ZE) + 0.1, ZE]], 0.008, { seg: 4, phase: PI / 4, caps: true });
  M.tube(C.iron, [[XR, yn(Z0) + 0.88, Z0], [XR, yn(ZE) + 0.88, ZE]], 0.01, { seg: 4, phase: PI / 4, caps: true });
  M.tube(C.pvc, [[XR, yn(Z0) + 0.905, Z0], [XR, yn(ZE) + 0.905, ZE]], 0.024, { seg: 6, caps: true });
}

// ── керосиновая лампа «летучая мышь»: бачок, горелка с винтом фитиля, стекло-колба (светится — obsh_lantern_glow),
//    проволочная защита, колпак, боковые трубки, дужка-ручка. Начало — середина низа бачка; ручка — y ≈ 0.34.
//    Узел нужен и сам по себе (лампа в руке, на полу как находка): PropModels.get('p_obsh_lantern').
{
  const M = new Model('p_obsh_lantern', { extras: { grip: [0, 0.34, 0], light: [0, 0.15, 0] } });
  const m = C.lanternMetal;
  M.lathe(m, [[0, 0], [0.068, 0], [0.075, 0.012], [0.075, 0.045], [0.06, 0.062], [0.035, 0.066], [0, 0.066]], { seg: 12 });
  M.lathe(m, [[0.036, 0.064], [0.036, 0.088], [0, 0.09]], { seg: 10 });
  M.tube(m, [[0.036, 0.075, 0], [0.055, 0.075, 0]], 0.004, { seg: 4 });
  M.tube(m, [[0.055, 0.075, -0.008], [0.055, 0.075, 0.008]], 0.009, { seg: 8, caps: true });
  M.lathe(C.lanternGlow, [[0, 0.086], [0.034, 0.086], [0.05, 0.115], [0.056, 0.15], [0.05, 0.19], [0.036, 0.215], [0.03, 0.222], [0, 0.222]], { seg: 10, smooth: true });
  for (let k = 0; k < 4; k++) {
    const f = PI / 4 + (k * PI) / 2, cs = Math.cos(f), sn = Math.sin(f);
    const bow = [[0.06, 0.07], [0.068, 0.11], [0.07, 0.15], [0.064, 0.19], [0.05, 0.22]].map(([r, y]) => [r * cs, y, r * sn]);
    M.tube(m, bow, 0.0025, { seg: 3 });
  }
  M.lathe(m, [[0.03, 0.218], [0.05, 0.225], [0.05, 0.245], [0.03, 0.26], [0.014, 0.275], [0, 0.278]], { seg: 10 });
  for (const s of [-1, 1]) M.tube(m, [[s * 0.075, 0.03, 0], [s * 0.08, 0.06, 0], [s * 0.08, 0.215, 0], [s * 0.05, 0.24, 0]], 0.006, { seg: 5 });
  const bail = [];
  for (let k = 0; k <= 10; k++) {
    const f = (PI * k) / 10;
    bail.push([0.082 * Math.cos(f), 0.215 + 0.125 * Math.sin(f), 0]);
  }
  M.tube(m, bail, 0.003, { seg: 4 });
  M.tube(C.woodDk, [[-0.018, 0.336, 0], [0.018, 0.336, 0]], 0.007, { seg: 6, caps: true });
}

// ═════════════════════════ запись и сверка ═════════════════════════

/** План w × d (м) и верх модели над полом, м (у подвесных — насколько спускается от потолка). */
const EXPECT = {
  p_obsh_bed: [1.9, 0.8, 0.95],
  p_obsh_nightstand: [0.4, 0.4, 0.79],
  p_obsh_table: [1.2, 0.7, 0.75],
  p_obsh_stool: [0.35, 0.35, 0.45],
  p_obsh_wardrobe: [0.8, 0.5, 2.21],
  p_obsh_radiator: [0.8, 0.12, 0.67],
  p_obsh_window: [1.4, 0.1, 2.44],
  p_obsh_stove: [0.5, 0.6, 1.02],
  p_obsh_sink: [0.55, 0.45, 1.63],
  p_obsh_fridge: [0.6, 0.6, 1.4],
  p_obsh_washer: [0.5, 0.5, 0.9],
  p_obsh_tub: [0.6, 0.4, 0.63],
  p_obsh_toilet: [0.5, 0.6, 2.02],
  p_obsh_partition: [0.05, 1.5, 1.8],
  p_obsh_shower: [0.9, 0.9, 2.17],
  p_obsh_bench: [1.0, 0.3, 0.45],
  p_obsh_vahter_desk: [1.2, 0.6, 1.11],
  p_obsh_keyboard: [0.6, 0.08, 2.0],
  p_obsh_noticeboard: [1.0, 0.05, 1.7],
  p_obsh_sofa: [1.8, 0.8, 0.9],
  p_obsh_chair: [0.45, 0.45, 0.88],
  p_obsh_tv: [0.5, 0.45, 1.18],
  p_obsh_clock: [0.35, 0.06, 2.37],
  p_obsh_fire_ext: [0.2, 0.15, 1.5],
  p_obsh_bucket: [0.3, 0.3, 1.26],
  p_obsh_pipes: [2.0, 0.25, 2.07],
  p_obsh_plafond: [0.3, 0.3, 0.35],
  p_obsh_tube: [1.2, 0.15, 0.095],
  p_obsh_stair_flight: [1.2, 3.0, 2.48],
  p_obsh_lantern: [0.25, 0.25, 0.35],
};

/** Обход: геометрическая нормаль каждого треугольника смотрит туда же, что нормали его вершин. */
function windingErrors(g) {
  let bad = 0;
  for (let t = 0; t < g.i.length; t += 3) {
    const [a, b, c] = [g.i[t], g.i[t + 1], g.i[t + 2]];
    const P = (i) => [g.p[3 * i], g.p[3 * i + 1], g.p[3 * i + 2]];
    const N = (i) => [g.n[3 * i], g.n[3 * i + 1], g.n[3 * i + 2]];
    const gn = cross(sub(P(b), P(a)), sub(P(c), P(a)));
    if (dot(gn, add(add(N(a), N(b)), N(c))) <= 0) {
      bad++;
    }
  }
  return bad;
}

const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
let problems = 0;
for (const M of MODELS) {
  const mesh = doc.createMesh(M.id);
  let verts = 0, tris = 0;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
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
    mesh.addPrimitive(
      doc
        .createPrimitive()
        .setAttribute('POSITION', acc('VEC3', new Float32Array(g.p)))
        .setAttribute('NORMAL', acc('VEC3', new Float32Array(g.n)))
        .setIndices(acc('SCALAR', big ? new Uint32Array(g.i) : new Uint16Array(g.i)))
        .setMaterial(m),
    );
    verts += g.p.length / 3;
    tris += g.i.length / 3;
    for (let k = 0; k < g.p.length; k += 3) {
      for (let a = 0; a < 3; a++) {
        lo[a] = Math.min(lo[a], g.p[k + a]);
        hi[a] = Math.max(hi[a], g.p[k + a]);
      }
    }
  }
  const size = [0, 1, 2].map((a) => +(hi[a] - lo[a]).toFixed(3));
  M.stats = { verts, tris, mats: M.parts.size, lo, hi };
  scene.addChild(doc.createNode(M.id).setMesh(mesh).setExtras({ size, ceil: M.ceil, ...M.extras }));
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
console.log('узел                      план w × d (ожид.)       X: от … до       Y: от … до       Z: от … до      верш.  тр.  мат.');
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
    // свес за план допускается немного (подоконник, тюль, рычаг бачка) — до 0.12 м
    if (w > e[0] + 0.12 || d > e[1] + 0.12) warn += ' ! шире плана';
    if (Math.abs(h - e[2]) > 0.03) warn += ` ! верх ${h.toFixed(2)} ≠ ${e[2]}`;
    if (M.ceil && Math.abs(b.max[1]) > 0.002) warn += ' ! подвесной: верх не в 0';
    if (!M.ceil && Math.abs(b.min[1]) > 0.002 && b.min[1] < 0) warn += ' ! ниже пола';
    if (Math.abs((b.min[0] + b.max[0]) / 2) > 0.06) warn += ' ! не по центру X';
  }
  if (warn) problems++;
  console.log(
    `${id.padEnd(22)} ${(e ? `${w.toFixed(2)} × ${d.toFixed(2)} (${e[0]} × ${e[1]})` : '').padEnd(24)} ${f(0)}  ${f(1)}  ${f(2)}  ${String(M.stats.verts).padStart(5)} ${String(M.stats.tris).padStart(5)} ${String(M.stats.mats).padStart(3)}${warn}`,
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
