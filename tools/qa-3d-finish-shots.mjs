// Скриншоты синтетической QA-страницы отделки: node tools/qa-3d-finish-shots.mjs [url]
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
const url = process.argv[2] ?? 'http://localhost:5205/';
const out = fileURLToPath(new URL('./qa/', import.meta.url));
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)));
const only = process.argv[3] ? process.argv[3].split(',').map(Number) : [0, 1, 2, 3, 4, 5];
for (const v of only) {
  await page.goto(new URL(`tools/qa-3d-finish.html?view=${v}${process.argv[4] ?? ''}`, url).href);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 }).catch(() => errors.push('не готово ' + v));
  await page.waitForTimeout(500);
  await page.screenshot({ path: out + `fin-${v}.png` });
}
console.log(JSON.stringify({ errors }, null, 1));
await browser.close();
