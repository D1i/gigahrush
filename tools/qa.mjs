// Интеграционная проверка: открывает приложение в headless Chrome, проходит по вкладкам,
// собирает ошибки консоли и снимает скриншоты в tools/qa/.
// Запуск: node tools/qa.mjs [url]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const url = process.argv[2] ?? 'http://localhost:5190/';
const out = fileURLToPath(new URL('./qa/', import.meta.url));
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text() + ' @ ' + (m.location()?.url ?? '')));
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));

await page.goto(url);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForTimeout(1500);
const shot = (n) => page.screenshot({ path: out + n + '.png' });
await shot('1-editor');

for (const [i, name] of [['2', 'Библиотеки'], ['3', 'Экономика'], ['4', 'Генератор'], ['5', 'Данные / JSON']]) {
  await page.getByRole('button', { name, exact: true }).click();
  await page.waitForTimeout(1200);
  await shot(`${i}-${name.split(' ')[0]}`);
}
console.log(JSON.stringify({ errors }, null, 2));
await browser.close();
