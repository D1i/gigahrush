// Набор пользователя «завод → болото» (factory-to-swamp-glb-blend.zip → factory-3d/glb/*.glb) → ассет спец-локации
// «Ангар» (src/locations/assets/hangar.glb, сцена — src/locations/sceneHangar.ts):
//
//  • в один файл — модели, нужные ангару: стена цеха 4 м, полы 4×4 (сухой, мокрый), металлолом (куча, в которую падает
//    игрок), козловая таль (зона мини-босса), бочка, труба, вентилятор, лестница, настил, перила, шлагбаум (ворота),
//    конвейер, пресс, плавильная печь (тепло снизу — почему над ангаром подтаял снег), ковш, форма, вал;
//  • каждая модель — узел верхнего уровня с именем-ключом (wall, floor_dry, scrap…); подвижные узлы набора
//    (fan_rotor, hoist_trolley…, manifest.json → moving_nodes) сохраняются по имени — сцена крутит их сама;
//    анимации glTF удалены (сцена анимирует узлы кодом);
//  • текстуры — WebP 512 px, геометрия — квантование.
//
//   node tools/optimize-hangar.mjs [папка factory-3d/glb]
//
// По умолчанию вход — tmp/factory/factory-3d/glb (распакуйте туда архив пользователя).
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, mergeDocuments, prune, quantize, textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';
import { mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = resolve(process.argv[2] ?? 'tmp/factory/factory-3d/glb');
const out = fileURLToPath(new URL('../src/locations/assets/hangar.glb', import.meta.url));
mkdirSync(fileURLToPath(new URL('../src/locations/assets/', import.meta.url)), { recursive: true });

/** ключ узла → файл набора */
const ASSETS = [
  ['wall', 'factory_wall_4m'],
  ['floor_dry', 'floor_dry_4x4'],
  ['floor_wet', 'floor_wet_4x4'],
  ['scrap', 'scrap_heap'],
  ['hoist', 'gantry_hoist'],
  ['barrel', 'rust_barrel'],
  ['pipe', 'pipe_3m'],
  ['fan', 'ventilation_fan'],
  ['stairs', 'industrial_stairs'],
  ['walkway', 'steel_walkway_2m'],
  ['railing', 'railing_2m'],
  ['gate', 'swing_gate'],
  ['conveyor', 'roller_conveyor_3m'],
  ['press', 'hydraulic_press'],
  ['furnace', 'smelting_furnace'],
  ['ladle', 'tilting_ladle'],
  ['mold', 'casting_mold'],
  ['shaft', 'shaft_bearing_2m'],
  ['gears', 'gear_pair_24T_12T'],
  ['flywheel', 'flywheel'],
];

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = new Document();
doc.createBuffer();
const scene = doc.createScene('hangar');
doc.getRoot().setDefaultScene(scene);

for (const [key, file] of ASSETS) {
  const part = await io.read(`${src}/${file}.glb`);
  for (const a of part.getRoot().listAnimations()) a.dispose();
  const map = mergeDocuments(doc, part);
  const holder = doc.createNode(key);
  for (const s of part.getRoot().listScenes()) {
    const t = map.get(s);
    for (const n of t.listChildren()) {
      t.removeChild(n);
      holder.addChild(n);
    }
    t.dispose();
  }
  scene.addChild(holder);
}
// один буфер
const [first, ...rest] = doc.getRoot().listBuffers();
for (const b of rest) {
  for (const a of doc.getRoot().listAccessors()) if (a.getBuffer() === b) a.setBuffer(first);
  b.dispose();
}
await doc.transform(
  dedup(),
  prune({ keepLeaves: true }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [512, 512], quality: 80 }),
  quantize(),
);
await io.write(out, doc);
console.log(`${out}: ${(statSync(out).size / 1024).toFixed(0)} КБ, узлов верхнего уровня ${scene.listChildren().length}`);
