// Проверка: генератор с линией обзора, страница спавна с симуляцией, новые комнаты в редакторе.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const url = process.argv[2] ?? 'http://localhost:5190/';
const out = fileURLToPath(new URL('./qa/', import.meta.url));
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
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
await page.waitForTimeout(1500);
await shot('g1-generator');

await tab('Спавн');
await page.waitForTimeout(800);
const sim = page.getByRole('button', { name: /20/ }).first();
if (await sim.count()) await sim.click();
const run = page.getByRole('button', { name: /Прогнать/ }).first();
if (await run.count()) await run.click();
await page.waitForTimeout(6000);
await shot('s1-spawn');

await tab('Комнаты');
for (const [n, q] of [['r1', 'Красный уголок'], ['r2', 'Техподполье'], ['r3', 'Т-образный'], ['r4', 'Лестничная площадка 1-464']]) {
  const li = page.locator('.li', { hasText: q }).first();
  if (await li.count()) {
    await li.click();
    await page.waitForTimeout(500);
    await shot(n);
  } else errors.push('нет комнаты ' + q);
}
console.log(JSON.stringify({ errors }, null, 2));
await browser.close();
