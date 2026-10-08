// Набор пользователя snow-models (snow-models.zip: 01-snow-tunnel, 02-snow-den, 03-snow-collapse) → ассеты снежных
// ходов:
//
//  • src/view3d/assets/snow_chunks.glb — глыбы обвала (Fallen_snow_00…06 из 03-snow-collapse): узел на глыбу
//    (chunk_0…chunk_6), центр — по габариту, низ — на y = 0; материал набора (матовый снег, цвет вершин). Ими
//    засыпает лаз при обвале (src/view3d/snowWalk.ts).
//  • Оболочки (01, 02) в игру не идут: полость каждого куска строится по его проёмам (src/view3d/snowMesh.ts), но
//    профиль устья лаза (арка 1.1 × 0.9 м: полуэллипс 0.55 × 0.8 на высоте 0.1, пол чуть вогнут — у стен 0.108) и
//    размеры берлоги (~2.1 × 1.37 м) сняты с них — этот скрипт их проверяет (сечение торца 01 — по вершинам z = 0).
//
//   node tools/optimize-snow.mjs [папка с GLB набора]   (по умолчанию — tmp/snow-models)
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, quantize, weld } from '@gltf-transform/functions';
import { mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = resolve(process.argv[2] ?? 'tmp/snow-models');
const out = fileURLToPath(new URL('../src/view3d/assets/snow_chunks.glb', import.meta.url));
mkdirSync(fileURLToPath(new URL('../src/view3d/assets/', import.meta.url)), { recursive: true });
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

// ── проверка профиля устья по 01-snow-tunnel
const tun = await io.read(`${src}/01-snow-tunnel.glb`);
const P = tun.getRoot().listMeshes()[0].listPrimitives()[0].getAttribute('POSITION');
let half = 0, top = 0, wallFloor = 0;
for (let i = 0, v = [0, 0, 0]; i < P.getCount(); i++) {
  P.getElement(i, v);
  if (Math.abs(v[2]) > 1e-4 || v[1] < -1e-3 || Math.abs(v[0]) > 0.551) continue; // внутреннее кольцо торца
  if (Math.abs(v[0]) < 0.1 && v[1] < 1) top = Math.max(top, v[1]); // свод внутри (снаружи у оси — выше 1.1 м)
  if (v[1] < 0.15) {
    half = Math.max(half, Math.abs(v[0]));
    if (Math.abs(v[0]) > 0.54) wallFloor = Math.max(wallFloor, v[1]);
  }
}
console.log(`устье 01: полуширина ${half.toFixed(3)} м (в коде 0.55), высота ${top.toFixed(3)} м (0.9), пол у стены ${wallFloor.toFixed(3)} м (0.108)`);

// ── глыбы обвала
const col = await io.read(`${src}/03-snow-collapse.glb`);
const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene('snow_chunks');
doc.getRoot().setDefaultScene(scene);
const mat = doc.createMaterial('snow').setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.98).setMetallicFactor(0);
let k = 0;
for (const node of col.getRoot().listNodes()) {
  if (!/^Fallen_snow_/.test(node.getName())) continue;
  const prim = node.getMesh().listPrimitives()[0];
  const pos = prim.getAttribute('POSITION'), nor = prim.getAttribute('NORMAL'), clr = prim.getAttribute('COLOR_0'), idx = prim.getIndices();
  const n = pos.getCount();
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0, v = [0, 0, 0]; i < n; i++) {
    pos.getElement(i, v);
    for (let a = 0; a < 3; a++) (mn[a] = Math.min(mn[a], v[a])), (mx[a] = Math.max(mx[a], v[a]));
  }
  const c = [(mn[0] + mx[0]) / 2, mn[1], (mn[2] + mx[2]) / 2];
  const p = new Float32Array(n * 3), nn = new Float32Array(n * 3), cc = new Float32Array(n * 4);
  for (let i = 0, v = [0, 0, 0], w = [0, 0, 0], q = [1, 1, 1, 1]; i < n; i++) {
    pos.getElement(i, v);
    nor.getElement(i, w);
    if (clr) clr.getElement(i, q);
    p.set([v[0] - c[0], v[1] - c[1], v[2] - c[2]], i * 3);
    nn.set(w, i * 3);
    cc.set([q[0], q[1], q[2], 1], i * 4);
  }
  const I = new Uint32Array(idx.getCount());
  for (let i = 0; i < I.length; i++) I[i] = idx.getScalar(i);
  const np = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(p).setBuffer(buffer))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(nn).setBuffer(buffer))
    .setAttribute('COLOR_0', doc.createAccessor().setType('VEC4').setArray(cc).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(I).setBuffer(buffer))
    .setMaterial(mat);
  scene.addChild(doc.createNode(`chunk_${k++}`).setMesh(doc.createMesh(`chunk_${k - 1}`).addPrimitive(np)));
}
await doc.transform(weld(), dedup(), prune(), quantize());
await io.write(out, doc);
console.log(`${out}: глыб ${k}, ${(statSync(out).size / 1024).toFixed(0)} КБ`);
