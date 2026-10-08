// Модели сарая, которых нет в наборе пользователя (barn-kit — только референсы), — собираются из примитивов:
//
//  • src/view3d/assets/barn_props.glb — узел на предмет, имя узла = id prop проекта (src/data/props.ts):
//    p_barn_garland — гирлянда на стене: провод с провисом между гвоздями через метр и две лампочки накаливания
//    (светятся сами — emissive; правая тусклая — по стене каждая вторая горит вполсилы). Сегмент 1 м вдоль X, у стены (z = 0 — середина
//    болванки 0.1 м), подвесной (тег «потолок»): верх в y = 0 — адаптер вешает её под потолок. Соседние сегменты
//    сходятся концами — по стене тянется одна гирлянда.
//    p_barn_stall_div — перегородка открытого стойла (как в конюшне: столб с шаром у прохода, жердь, доски понизу):
//    2.4 м вдоль X, у задней стены — −X, у прохода — +X; низ на полу.
//    p_barn_manger — ясли у задней стены стойла: дощатое корыто с сеном и решётка-кормушка над ним, наклонённая от
//    стены. 1.2 м вдоль X; перед — −Z, стена — +Z (как у болванки мебели); низ на полу.
//
//   node tools/make-barn-props.mjs
import { Document, NodeIO } from '@gltf-transform/core';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../src/view3d/assets/barn_props.glb', import.meta.url));
mkdirSync(fileURLToPath(new URL('../src/view3d/assets/', import.meta.url)), { recursive: true });

const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene('barn');
// сцена по умолчанию: без неё загрузчик Babylon сцену не берёт (узлов нет)
doc.getRoot().setDefaultScene(scene);

/** Сетка: позиции, нормали, индексы → примитив с материалом. */
function prim(geo, mat) {
  const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
  return doc
    .createPrimitive()
    .setAttribute('POSITION', acc('VEC3', new Float32Array(geo.p)))
    .setAttribute('NORMAL', acc('VEC3', new Float32Array(geo.n)))
    .setIndices(acc('SCALAR', new Uint16Array(geo.i)))
    .setMaterial(mat);
}

/** Трубка радиуса r по ломаной pts ([x, y, z]), seg граней по окружности; сечение — в плоскости, перпендикулярной
 *  касательной. */
function tube(pts, r, seg = 6) {
  const g = { p: [], n: [], i: [] };
  const norm = (v) => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  for (let k = 0; k < pts.length; k++) {
    const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)];
    const t = norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
    // опорная ось — не параллельная касательной
    const ref = Math.abs(t[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const u = norm(cross(t, ref)), v = cross(t, u);
    for (let s = 0; s < seg; s++) {
      const q = (s / seg) * Math.PI * 2, c = Math.cos(q), sn = Math.sin(q);
      const d = [u[0] * c + v[0] * sn, u[1] * c + v[1] * sn, u[2] * c + v[2] * sn];
      g.p.push(pts[k][0] + d[0] * r, pts[k][1] + d[1] * r, pts[k][2] + d[2] * r);
      g.n.push(d[0], d[1], d[2]);
    }
  }
  for (let k = 0; k < pts.length - 1; k++) {
    for (let s = 0; s < seg; s++) {
      const a = k * seg + s, b = k * seg + ((s + 1) % seg), c = a + seg, d = b + seg;
      g.i.push(a, c, b, b, c, d);
    }
  }
  return g;
}

/** Бокс от (x0, y0, z0) до (x1, y1, z1): по 4 вершины на грань, нормали граней. */
function box(x0, y0, z0, x1, y1, z1) {
  const g = { p: [], n: [], i: [] };
  const faces = [
    [[1, 0, 0], [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]]],
    [[-1, 0, 0], [[x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0]]],
    [[0, 1, 0], [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]]],
    [[0, -1, 0], [[x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1]]],
    [[0, 0, 1], [[x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [x0, y0, z1]]],
    [[0, 0, -1], [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]]],
  ];
  for (const [n, vs] of faces) {
    const b = g.p.length / 3;
    for (const v of vs) {
      g.p.push(...v);
      g.n.push(...n);
    }
    g.i.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  return g;
}

/** Слить сетки в одну (один материал). */
function join(...gs) {
  const g = { p: [], n: [], i: [] };
  for (const x of gs) {
    const b = g.p.length / 3;
    g.p.push(...x.p);
    g.n.push(...x.n);
    g.i.push(...x.i.map((k) => k + b));
  }
  return g;
}

/** Эллипсоид (rx, ry, rz) с центром c: lat × lon. */
function blob(c, rx, ry, rz, lat = 6, lon = 8) {
  const g = { p: [], n: [], i: [] };
  for (let a = 0; a <= lat; a++) {
    const th = (a / lat) * Math.PI;
    for (let b = 0; b <= lon; b++) {
      const ph = (b / lon) * Math.PI * 2;
      const x = Math.sin(th) * Math.cos(ph), y = Math.cos(th), z = Math.sin(th) * Math.sin(ph);
      g.p.push(c[0] + x * rx, c[1] + y * ry, c[2] + z * rz);
      const l = Math.hypot(x / rx, y / ry, z / rz) || 1;
      g.n.push(x / rx / l, y / ry / l, z / rz / l);
    }
  }
  for (let a = 0; a < lat; a++) {
    for (let b = 0; b < lon; b++) {
      const i0 = a * (lon + 1) + b, i1 = i0 + lon + 1;
      g.i.push(i0, i1, i0 + 1, i0 + 1, i1, i1 + 1);
    }
  }
  return g;
}

const cableMat = doc.createMaterial('barn_cable').setBaseColorFactor([0.06, 0.05, 0.045, 1]).setMetallicFactor(0).setRoughnessFactor(0.9);
const socketMat = doc.createMaterial('barn_socket').setBaseColorFactor([0.16, 0.12, 0.08, 1]).setMetallicFactor(0).setRoughnessFactor(0.8);
const bulbMat = doc.createMaterial('barn_bulb').setBaseColorFactor([1, 0.8, 0.5, 1]).setEmissiveFactor([1, 0.62, 0.26]);
const dimMat = doc.createMaterial('barn_bulb_dim').setBaseColorFactor([0.5, 0.3, 0.15, 1]).setEmissiveFactor([0.32, 0.16, 0.05]);

/** Провод: гвозди на концах (x = ±0.5, y = −0.07), провис до −0.2 посередине. */
const cableY = (x) => -0.07 - 0.13 * (1 - (2 * x) ** 2);
const cable = [];
for (let k = 0; k <= 20; k++) {
  const x = -0.5 + k / 20;
  cable.push([x, cableY(x), 0]);
}

const mesh = doc.createMesh('p_barn_garland');
mesh.addPrimitive(prim(tube(cable, 0.005), cableMat));
// две лампочки на метр: патрон на проводе, колба под ним; правая — тусклая
for (const [x, mat] of [[-0.25, bulbMat], [0.25, dimMat]]) {
  const y = cableY(x);
  mesh.addPrimitive(prim(tube([[x, y, 0], [x, y - 0.035, 0]], 0.011, 8), socketMat));
  mesh.addPrimitive(prim(blob([x, y - 0.065, 0], 0.022, 0.032, 0.022), mat));
}
scene.addChild(doc.createNode('p_barn_garland').setMesh(mesh).setExtras({ size: [1, 0.25, 0.05], ceil: true }));

const woodMat = doc.createMaterial('barn_wood').setBaseColorFactor([0.3, 0.21, 0.13, 1]).setMetallicFactor(0).setRoughnessFactor(0.95);
const postMat = doc.createMaterial('barn_post').setBaseColorFactor([0.2, 0.14, 0.09, 1]).setMetallicFactor(0).setRoughnessFactor(0.9);
const hayMat = doc.createMaterial('barn_hay').setBaseColorFactor([0.52, 0.42, 0.2, 1]).setMetallicFactor(0).setRoughnessFactor(1);

// перегородка стойла: задний столб у стены (−X), передний с шаром у прохода (+X), три доски понизу, жердь сверху
const div = doc.createMesh('p_barn_stall_div');
div.addPrimitive(prim(join(
  box(-1.2, 0, -0.04, -1.12, 1.45, 0.04),
  box(1.08, 0, -0.06, 1.2, 1.6, 0.06),
), postMat));
div.addPrimitive(prim(blob([1.14, 1.67, 0], 0.075, 0.075, 0.075), postMat));
div.addPrimitive(prim(join(
  box(-1.12, 0.06, -0.02, 1.08, 0.38, 0.02),
  box(-1.12, 0.41, -0.02, 1.08, 0.73, 0.02),
  box(-1.12, 0.76, -0.02, 1.08, 1.08, 0.02),
  tube([[-1.12, 1.36, 0], [1.08, 1.36, 0]], 0.035, 8),
), woodMat));
scene.addChild(doc.createNode('p_barn_stall_div').setMesh(div).setExtras({ size: [2.4, 1.75, 0.12] }));

// ясли: корыто (перед −Z, стена +Z) с сеном, над ним решётка для сена — рейки наклонены от стены в стойло
const man = doc.createMesh('p_barn_manger');
const slats = [];
for (let k = 0; k <= 8; k++) {
  const x = -0.5 + k * 0.125;
  slats.push(tube([[x, 0.85, 0.22], [x, 1.6, -0.12]], 0.014, 6));
}
man.addPrimitive(prim(join(
  box(-0.6, 0, -0.25, 0.6, 0.72, -0.21),
  box(-0.6, 0, -0.21, -0.56, 0.72, 0.25),
  box(0.56, 0, -0.21, 0.6, 0.72, 0.25),
  box(-0.56, 0.3, -0.21, 0.56, 0.35, 0.25),
  tube([[-0.58, 0.85, 0.22], [0.58, 0.85, 0.22]], 0.025, 8),
  tube([[-0.58, 1.6, -0.12], [0.58, 1.6, -0.12]], 0.025, 8),
  ...slats,
), woodMat));
man.addPrimitive(prim(box(-0.56, 0.35, -0.21, 0.56, 0.6, 0.25), hayMat));
scene.addChild(doc.createNode('p_barn_manger').setMesh(man).setExtras({ size: [1.2, 1.65, 0.5] }));

await new NodeIO().write(out, doc);
console.log(`→ ${out}`);
