// Оптимизация ассетов подъезда (Stairwell_Unity пользователя) для веба: исходный модуль ~60 МБ из-за
// 15 PNG 2048² внутри GLB. Геометрия не трогается (только dedup/prune/weld без потери вершин по
// атрибутам), текстуры — уменьшение и сжатие в WebP (EXT_texture_webp; Babylon 9.29 его грузит).
//
//   node tools/optimize-stairwell.mjs [папка-исходников] [--out папка] [--cap-textures] [--all]
//
// По умолчанию: исходники — папка Stairwell_Unity пользователя, результат — src/locations/assets/:
//  • stairwell_module.glb — повторяемый этаж (текстуры WebP);
//  • stairwell_topcap.glb — верхнее завершение БЕЗ текстур: материалы те же по именам, что у модуля, и сцена
//    берёт их у модуля (одни текстуры на всё). --cap-textures — со своими текстурами (для отдельного использования).
// --all — заодно демо из 3 этажей (в приложении не используется).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';
import { mkdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_SRC = 'C:/Users/Maxim/Documents/Codex/2026-10-07/cltkfq/outputs/Stairwell_Unity';
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--out');
const src = resolve(positional[0] ?? DEFAULT_SRC);
const out = resolve(opt('--out') ?? fileURLToPath(new URL('../src/locations/assets/', import.meta.url)));
mkdirSync(out, { recursive: true });

const FILES = [
  ['Stairwell_Module_3m.glb', 'stairwell_module.glb'],
  ['Stairwell_TopCap.glb', 'stairwell_topcap.glb', !flag('--cap-textures')],
  ...(flag('--all') ? [['Stairwell_Demo_3Floors.glb', 'stairwell_demo3.glb']] : []),
];

/**
 * Разрешение и качество по текстурам. Большие поверхности (стены, бетон ступеней и площадок) — 1024,
 * мелкие детали (штукатурка низа маршей, кромки, сталь) и все ORM (шероховатость/металл почти
 * однородны) — 512. Нормали — WebP с высоким качеством (артефакты сжатия на нормалях заметнее).
 */
const RULES = [
  { pattern: /^(Wall|Concrete)_BaseColor/, size: 1024, quality: 82 },
  { pattern: /^(Wall|Concrete)_Normal/, size: 1024, quality: 88 },
  { pattern: /_BaseColor/, size: 512, quality: 82 },
  { pattern: /_Normal/, size: 512, quality: 88 },
  { pattern: /_ORM/, size: 512, quality: 85 },
];

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const kb = (b) => (b / 1024).toFixed(0) + ' КБ';
const mb = (b) => (b / 1024 / 1024).toFixed(2) + ' МБ';

for (const [from, to, noTextures] of FILES) {
  const inPath = join(src, from);
  if (!existsSync(inPath)) {
    console.error('нет файла', inPath);
    process.exitCode = 1;
    continue;
  }
  const doc = await io.read(inPath);
  const root = doc.getRoot();
  const tris = () => root.listMeshes().reduce((s, m) => s + m.listPrimitives().reduce((a, p) => a + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0), 0);
  const t0 = tris();
  // имя текстуры (Wall_BaseColor…) — по нему правила; у некоторых экспортёров имя пустое, тогда по URI
  for (const t of root.listTextures()) if (!t.getName()) t.setName(t.getURI().replace(/\.[a-z]+$/i, ''));
  if (noTextures) {
    // текстуры — общие с модулем (сцена подменяет материалы по именам); факторы материалов остаются
    for (const m of root.listMaterials()) {
      m.setBaseColorTexture(null).setNormalTexture(null).setMetallicRoughnessTexture(null).setOcclusionTexture(null).setEmissiveTexture(null);
    }
    root.setExtras({ ...root.getExtras(), textures: 'shared with stairwell_module.glb by material name' });
  }
  // без текстур материалы одинаковы по свойствам — их нельзя сливать (сцена берёт их по именам);
  // у модуля одинаковые нормали разных наборов сливаются
  await doc.transform(dedup({ keepUniqueNames: !!noTextures }), prune({ keepLeaves: true, keepAttributes: true }), weld());
  const done = new Set();
  for (const r of RULES) {
    const names = root.listTextures().filter((t) => r.pattern.test(t.getName()) && !done.has(t));
    if (!names.length) continue;
    names.forEach((t) => done.add(t));
    const re = new RegExp('^(' + names.map((t) => t.getName().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')$');
    await doc.transform(
      textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [r.size, r.size], quality: r.quality, pattern: re }),
    );
  }
  const t1 = tris();
  if (t1 !== t0) throw new Error(`${from}: изменилось число треугольников ${t0} → ${t1}`);
  const outPath = join(out, to);
  await io.write(outPath, doc);
  const before = statSync(inPath).size;
  const after = statSync(outPath).size;
  console.log(`${from} → ${to}: ${mb(before)} → ${mb(after)} (треугольников ${t1})`);
  for (const t of root.listTextures()) {
    const s = t.getSize();
    console.log(`   ${t.getName().padEnd(20)} ${t.getMimeType().padEnd(11)} ${s ? s.join('×') : '?'}  ${kb(t.getImage()?.byteLength ?? 0)}`);
  }
}
