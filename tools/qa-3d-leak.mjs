// Утечки: многократная перестройка сцены и уход/возврат на вкладку «3D».
import { chromium } from 'playwright-core';
const url = process.argv[2] ?? 'http://localhost:5205/';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)));
await page.goto(url);
await page.waitForTimeout(800);
for (let k = 0; k < 4; k++) {
  await page.getByRole('button', { name: '3D', exact: true }).click();
  const g = page.getByRole('button', { name: 'Сгенерировать', exact: true });
  if (await g.count()) await g.first().click();
  if (await page.waitForFunction(() => !!window.__rf3d?.bo, null, { timeout: 15000 }).then(() => true, () => false)) break;
}
const counts = () => page.evaluate(() => {
  const s = window.__rf3d.scene;
  return { meshes: s.meshes.length, mats: s.materials.length, tex: s.textures.length, geo: s.geometries.length, tn: s.transformNodes.length };
});
const a = await counts();
// перестройка через UI: переключаем потолки туда-обратно 3 раза + выбор комнаты по клику
for (let k = 0; k < 3; k++) {
  await page.getByText('потолки', { exact: true }).click();
  await page.waitForTimeout(500);
  await page.getByText('потолки', { exact: true }).click();
  await page.waitForTimeout(500);
}
await page.evaluate(() => window.__rf3d.highlight(window.__rf3d.model.rooms[0].inst));
await page.getByText('потолки', { exact: true }).click();
await page.waitForTimeout(500);
await page.getByText('потолки', { exact: true }).click();
await page.waitForTimeout(800);
const b = await counts();
// уход и возврат
await page.getByRole('button', { name: 'Генератор', exact: true }).click();
await page.waitForTimeout(800);
const gone = await page.evaluate(() => ({ rf: !!window.__rf3d, canvases: document.querySelectorAll('canvas').length }));
await page.getByRole('button', { name: '3D', exact: true }).click();
await page.waitForFunction(() => !!window.__rf3d?.bo, null, { timeout: 15000 });
const c = await counts();
console.log(JSON.stringify({ before: a, afterRebuilds: b, afterReturn: c, gone, errors }, null, 1));
await browser.close();
