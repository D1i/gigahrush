// Набор сарая пользователя (папка outputs: barn-wall-*.png — бесшовные доски 1254 px; barn-kit/*.png и
// barn-concept.png — референсы модулей и мебели, моделей в наборе нет) → текстуры отделок проекта:
//
//  • src/data/assets/barn/*.jpg — три текстуры досок (бесшовные, 512 px): вертикальные серые, вертикальные выцветшие с
//    ржавыми подтёками гвоздей, горизонтальные тёмные (src/data/finishes.ts, биом «Сарай» — src/gen4d/biomes.ts).
//
// Скрипт заодно меряет шов: средняя разница яркости через край плитки (последний столбец/строка → первый) против
// разницы соседних пикселей внутри — у бесшовной плитки они одного порядка.
//
//   node tools/optimize-barn.mjs [папка outputs]
import sharp from 'sharp';
import { mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = resolve(process.argv[2] ?? 'C:/Users/Maxim/Documents/Codex/2026-10-08/new-chat-2/outputs');
const outTex = fileURLToPath(new URL('../src/data/assets/barn/', import.meta.url));
mkdirSync(outTex, { recursive: true });

/** Текстуры отделок: файл набора → имя в проекте. */
const TEX = [
  ['barn-wall-vertical', 'planks_vertical'],
  ['barn-wall-rust-muted', 'planks_rust'],
  ['barn-wall-horizontal', 'planks_horizontal'],
];

/** Разница яркости через шов и внутри (по горизонтали и вертикали). */
async function seam(file) {
  const { data, info } = await sharp(file).greyscale().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const at = (x, y) => data[y * w + x];
  let sx = 0, ix = 0, sy = 0, iy = 0;
  for (let y = 0; y < h; y++) {
    sx += Math.abs(at(w - 1, y) - at(0, y));
    ix += Math.abs(at(w >> 1, y) - at((w >> 1) + 1, y));
  }
  for (let x = 0; x < w; x++) {
    sy += Math.abs(at(x, h - 1) - at(x, 0));
    iy += Math.abs(at(x, h >> 1) - at(x, (h >> 1) + 1));
  }
  return { x: [sx / h, ix / h], y: [sy / w, iy / w] };
}

for (const [file, name] of TEX) {
  const inp = `${src}/${file}.png`;
  const s = await seam(inp);
  const out = `${outTex}${name}.jpg`;
  await sharp(inp).resize(512, 512).jpeg({ quality: 82, mozjpeg: true }).toFile(out);
  const f = (v) => v.toFixed(1);
  console.log(`→ ${out}: ${(statSync(out).size / 1024).toFixed(0)} КБ; шов по X ${f(s.x[0])} (внутри ${f(s.x[1])}), по Y ${f(s.y[0])} (внутри ${f(s.y[1])})`);
}
