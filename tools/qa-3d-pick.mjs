// Клик по полу в облёте → подпись комнаты.
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
const url = process.argv[2] ?? 'http://localhost:5190/';
const out = new URL('./qa/', import.meta.url);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = [];
page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message));
page.on('console', (m) => m.type() === 'error' && logs.push(m.text().slice(0, 300)));
await page.goto(url);
await page.waitForTimeout(1000);
for (let k = 0; k < 4; k++) {
  await page.getByRole('button', { name: '3D', exact: true }).click();
  const g = page.getByRole('button', { name: 'Сгенерировать', exact: true });
  if (await g.count()) await g.first().click();
  if (await page.waitForFunction(() => !!window.__rf3d?.bo, null, { timeout: 15000 }).then(() => true, () => false)) break;
}
await page.evaluate(() => {
  const v = window.__rf3d;
  v.fit();
  v.orbit.beta = 0.35;
});
await page.waitForTimeout(1500);
const box = await page.locator('.v3-stage canvas').boundingBox();
const r = await page.evaluate(() => {
  const v = window.__rf3d;
  const big = [...v.model.rooms].sort((a, b) => b.floorAreaM2 - a.floorAreaM2)[0];
  return { name: big.name, at: v.projectPlan(big.anchor[0], big.anchor[1], 0) };
});
await page.mouse.click(box.x + r.at[0], box.y + r.at[1]);
await page.waitForTimeout(1200);
await page.screenshot({ path: fileURLToPath(new URL('3d-pick-top.png', out)) });
const label = await page.locator('.v3-label').innerText().catch(() => '');
console.log(JSON.stringify({ want: r.name, label, logs }, null, 2));
await browser.close();
