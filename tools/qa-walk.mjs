// Проверка слоя «Проходимость» в редакторе: заливка, маркеры проёмов, подпись в HUD, пересчёт при перетаскивании.
// Запуск: npx vite --port 5210 --strictPort, затем node tools/qa-walk.mjs [url]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const url = process.argv[2] ?? 'http://localhost:5210/';
const out = fileURLToPath(new URL('./qa/', import.meta.url));
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
page.on('console', (m) => m.type() === 'error' && !m.text().includes('favicon') && errors.push(m.text()));
const shot = (n) => page.screenshot({ path: out + n + '.png' });
const hud = () => page.locator('.rc-hud').innerText();
const log = [];

await page.goto(url);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForTimeout(1200);

// зал с пианино: слой включён — всё проходимо
await page.locator('.li', { hasText: 'Зал 1-464 — с пианино' }).first().click();
await page.waitForTimeout(400);
await page.locator('.lt-item', { hasText: 'Проходимость' }).click();
await page.waitForTimeout(400);
await shot('w1-piano');
log.push('piano: ' + (await hud()));

// прихожая 1-464: варианты «Хлам» поперёк прохода
await page.locator('.li', { hasText: 'Прихожая 1-464' }).first().click();
await page.waitForTimeout(400);
await shot('w2-foyer');
log.push('foyer: ' + (await hud()));

// лифтовой холл: перетащить лифт к восточной стене — Кв. 1 отрезана
await page.locator('.li', { hasText: 'Лифтовой холл II-49' }).first().click();
await page.waitForTimeout(500);
await shot('w3-lift-ok');
log.push('lift before: ' + (await hud()));
const cv = page.locator('.stage canvas').first();
const box = await cv.boundingBox();
// найти экранную позицию второго лифта (центр 2.0 × 0.65 м) через перебор точек: ищем курсор move
const target = await page.evaluate(() => {
  const p = JSON.parse(localStorage.getItem('room-forge/project/v1') || '{}');
  return p.rooms?.find((r) => r.id === 'lift_ii49')?.decor ?? null;
});
log.push('lift decor: ' + JSON.stringify(target));
// лифт B (правый): ищем справа налево точку с курсором move и тянем вправо на ~0.5 м
let grabbed = false;
for (let dx = 200; dx >= -200 && !grabbed; dx -= 20) {
  for (let dy = -250; dy <= -60 && !grabbed; dy += 20) {
    const x = box.x + box.width / 2 + dx, y = box.y + box.height / 2 + dy;
    await page.mouse.move(x, y);
    const cur = await cv.evaluate((el) => el.style.cursor);
    if (cur === 'move') {
      await page.mouse.down();
      await page.mouse.move(x + 50, y, { steps: 6 });
      await page.mouse.move(x + 110, y, { steps: 6 });
      await page.waitForTimeout(200);
      await shot('w4-lift-drag');
      log.push('lift during drag: ' + (await hud()));
      await page.mouse.up();
      grabbed = true;
    }
  }
}
await page.waitForTimeout(300);
await shot('w5-lift-after');
log.push('lift after: ' + (await hud()));

console.log(JSON.stringify({ errors, log }, null, 2));
await browser.close();
