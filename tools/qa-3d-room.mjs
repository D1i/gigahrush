// Источник «Комната»: вписывание облёта в одну комнату.
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
const url = process.argv[2] ?? 'http://localhost:5190/';
const out = fileURLToPath(new URL('./qa/', import.meta.url));
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = [];
page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message));
await page.goto(url);
await page.waitForTimeout(1000);
const state = () => page.evaluate(() => {
  const v = window.__rf3d, o = v.orbit;
  return { mode: v.mode, a: +o.alpha.toFixed(2), b: +o.beta.toFixed(2), r: +o.radius.toFixed(2), t: [o.target.x, o.target.y, o.target.z].map((x) => +x.toFixed(2)), bounds: v.model?.bounds, lim: [o.lowerRadiusLimit, o.upperRadiusLimit] };
});
for (let k = 0; k < 4; k++) {
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.getByRole('button', { name: 'Комната', exact: true }).click();
  if (await page.waitForFunction(() => !!window.__rf3d?.bo, null, { timeout: 15000 }).then(() => true, () => false)) break;
}
await page.waitForTimeout(1500);
const s1 = await state();
await page.screenshot({ path: out + '3d-room-a.png' });
const room = process.argv[3];
if (room) {
  await page.locator('.v3-src select').selectOption({ label: room });
  await page.waitForTimeout(1500);
}
await page.getByRole('button', { name: 'От первого лица', exact: true }).click();
await page.waitForTimeout(1500);
await page.screenshot({ path: out + '3d-room-fps.png' });
await page.getByRole('button', { name: 'Облёт', exact: true }).click();
await page.waitForTimeout(1500);
const s2 = await state();
await page.screenshot({ path: out + '3d-room-b.png' });
console.log(JSON.stringify({ s1, s2, logs }, null, 1));
await browser.close();
