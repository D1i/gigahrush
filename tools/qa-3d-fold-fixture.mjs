// Складчатый (4D) прогон для examples/babylon-demo: генерирует в странице dev-сервера (модули приложения)
// и пишет JSON прогона без текстур (отделка — средним цветом).
// node tools/qa-3d-fold-fixture.mjs [url] [seed] [count]
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const url = process.argv[2] ?? 'http://localhost:5209/';
const seed = process.argv[3] ?? 'hrush-001';
const count = Number(process.argv[4] ?? 40);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage();
await page.goto(url);
await page.evaluate(() => localStorage.clear());
await page.reload();
const json = await page.evaluate(
  async ({ seed, count }) => {
    const { generateFoldRun, validateFoldRun } = await import('/src/gen4d/fold.ts');
    const { exportRunJSON } = await import('/src/gen/world.ts');
    const { createDefaultProject } = await import('/src/data/presets.ts');
    const p = createDefaultProject();
    const run = generateFoldRun(p, { seed, count, fold: { shiftChance: 0.3, maxShift: 2, localRadius: 2, maxLayer: 12 } });
    const errs = validateFoldRun(p, run);
    if (errs.length) throw new Error(errs.join('\n'));
    return JSON.stringify(exportRunJSON(p, run));
  },
  { seed, count },
);
const file = fileURLToPath(new URL(`../examples/babylon-demo/run-fold-${count}.json`, import.meta.url));
writeFileSync(file, json);
console.log(file, (json.length / 1024).toFixed(0) + ' KB');
await browser.close();
