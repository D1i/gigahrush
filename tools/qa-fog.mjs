// Проверка: складчатый прогон с пределом обзора 7 м — план с линией обзора и 3D от первого лица
// с туманом на дальности обзора и без него. Запуск: node tools/qa-fog.mjs [url]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const url = process.argv[2] ?? 'http://localhost:5190/';
const out = fileURLToPath(new URL('./qa/', import.meta.url));
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const shot = (n) => page.screenshot({ path: out + n + '.png' });
const tab = (name) => page.getByRole('button', { name, exact: true }).click();

await page.goto(url);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForTimeout(1500);
await tab('Генератор');
await page.waitForTimeout(1200);
await page.getByText('Складчатый (4D)').first().click();
await page.waitForTimeout(800);
await page.getByRole('button', { name: '7', exact: true }).first().click();
await page.waitForTimeout(2000);
await shot('fog-1-plan');
const summary = await page.evaluate(() => document.querySelector('.side')?.innerText.match(/Макс\. обзор[^\n]*\n?[^\n]*/)?.[0] ?? '');

await tab('3D');
await page.waitForTimeout(3500);
await page.getByRole('button', { name: 'От первого лица', exact: true }).first().click();
await page.waitForTimeout(2500);
await shot('fog-2-fps');
const fogOn = await page.evaluate(() => { const s = window.__rfViewer?.scene; return s ? { mode: s.fogMode, start: s.fogStart, end: s.fogEnd } : null; });
await page.getByText(/туман на дальности обзора/).first().click();
await page.waitForTimeout(1200);
await shot('fog-3-fps-nofog');
const fogOff = await page.evaluate(() => { const s = window.__rfViewer?.scene; return s ? { mode: s.fogMode } : null; });
console.log(JSON.stringify({ summary, fogOn, fogOff, errors }, null, 2));
await browser.close();
