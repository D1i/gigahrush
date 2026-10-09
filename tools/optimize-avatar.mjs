// Набор пользователя «Забинтованный мужчина в шинели» (bandaged_man.glb из bandaged_zip: Blender-экспорт, 741 КБ, из
// них ~655 КБ — float-вершины) → src/coop/assets/bandaged_man.glb — аватар напарника в кооп-прогулке (его GLB
// инлайнится в один HTML сборки, поэтому важен размер):
//
//  • сохраняется всё, на что опирается игра: скин (19 костей с прежними именами — Hips…Hand.L/R, Head, Foot.L/R),
//    узлы BandagedMan_Rig / BandagedMan_Mesh, 4 клипа Idle_Standing / Walk / Idle_Crawl / Crawl (на месте, 30 к/с),
//    8 примитивов — по одному на материал (имена и baseColor / metallic / roughness те же);
//  • TEXCOORD_0 выкидывается (текстур нет); сшивать почти нечего — затенение плоское, вершины разделены по граням
//    (12196 на 5934 треугольника; после квантования совпадают побитно ещё 8);
//  • ключи анимации, выводимые из соседних (линейно / slerp) с допуском 1e-5, убираются (resample) — голова в позах
//    смещается на сотые доли мм (при 1e-4 — до 0.7 мм при амплитуде «дыхания» в стойке ~3 мм, поэтому строже);
//  • вершины квантуются (KHR_mesh_quantization — расширение в игре подключено): позиция 14 бит в int16 (шаг ~0.12 мм
//    на габарит 2 м; сдвиг/масштаб объёма уходит в inverse bind matrices скина — узел скинованного меша по glTF не
//    трансформирует), нормаль 8 бит, веса 8 бит (с нормировкой суммы); draco/meshopt не используются — их декодеров
//    в сборке нет.
//
// Проверка (скин в позах всех клипов, оригинал против результата, Babylon + NullEngine): tmp/scripts/check-avatar.mjs.
//
//   node tools/optimize-avatar.mjs [папка с bandaged_man.glb]   (по умолчанию — tmp/bandaged_zip)
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, getSceneVertexCount, prune, quantize, resample, VertexCountMethod, weld } from '@gltf-transform/functions';
import { mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = resolve(process.argv[2] ?? 'tmp/bandaged_zip');
const src = `${srcDir}/bandaged_man.glb`;
const out = fileURLToPath(new URL('../src/coop/assets/bandaged_man.glb', import.meta.url));
mkdirSync(fileURLToPath(new URL('../src/coop/assets/', import.meta.url)), { recursive: true });
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

const doc = await io.read(src);
const root = doc.getRoot();
const scene = root.getDefaultScene() ?? root.listScenes()[0];
const nodeNames = () => root.listNodes().map((n) => n.getName()).sort().join('|');
const matSig = () => root.listMaterials().map((m) =>
  `${m.getName()}:${m.getBaseColorFactor().join(',')}:${m.getMetallicFactor()}:${m.getRoughnessFactor()}`).sort().join('|');
const primSig = () => root.listMeshes().flatMap((m) => m.listPrimitives().map((p) => p.getMaterial()?.getName())).join('|');
const animSig = () => root.listAnimations().map((a) => `${a.getName()}:${a.listChannels().length}`).join('|');
const skinSig = () => root.listSkins().map((s) => s.listJoints().map((j) => j.getName()).join(',')).join('|');
const before = { nodes: nodeNames(), mats: matSig(), prims: primSig(), anims: animSig(), skin: skinSig() };
const vBefore = getSceneVertexCount(scene, VertexCountMethod.UPLOAD);
const keysOf = () => root.listAnimations().reduce((s, a) => s + a.listSamplers().reduce((t, x) => t + x.getInput().getCount(), 0), 0);
const kBefore = keysOf();

// UV не нужны (ни одной текстуры)
if (root.listTextures().length) throw new Error('в наборе появились текстуры — TEXCOORD_0 выкидывать нельзя');
for (const mesh of root.listMeshes())
  for (const prim of mesh.listPrimitives())
    for (const sem of prim.listSemantics()) if (sem.startsWith('TEXCOORD_')) prim.setAttribute(sem, null);

await doc.transform(
  dedup({ keepUniqueNames: true }),
  resample({ tolerance: 1e-5 }),
  prune({ keepLeaves: true }),
  quantize({ quantizePosition: 14, quantizeNormal: 8, quantizeWeight: 8 }),
  weld(), // после квантования — побитно совпавшие вершины
  prune({ keepLeaves: true }),
);

const after = { nodes: nodeNames(), mats: matSig(), prims: primSig(), anims: animSig(), skin: skinSig() };
for (const k of Object.keys(before))
  if (before[k] !== after[k]) throw new Error(`изменилось ${k}:\n  было  ${before[k]}\n  стало ${after[k]}`);

await io.write(out, doc);
const vAfter = getSceneVertexCount(scene, VertexCountMethod.UPLOAD);
console.log(`${src}: ${(statSync(src).size / 1024).toFixed(0)} КБ, вершин ${vBefore}, ключей анимации ${kBefore}`);
console.log(`${out}: ${(statSync(out).size / 1024).toFixed(0)} КБ, вершин ${vAfter}, ключей анимации ${keysOf()}`);
console.log(`сохранено: костей ${root.listSkins()[0].listJoints().length}, клипов ${root.listAnimations().length} (${root.listAnimations().map((a) => a.getName()).join(', ')}), ` +
  `примитивов ${root.listMeshes()[0].listPrimitives().length}, материалов ${root.listMaterials().length}`);
