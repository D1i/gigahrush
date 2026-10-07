// Загрузка приложения: ошибки страницы со стеком (диагностика перед QA вкладки 3D).
import { chromium } from 'playwright-core';
const url = process.argv[2] ?? 'http://localhost:5205/';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message + ' @ ' + String(e.stack ?? '').split(/\n/).slice(1, 5).join(' | ')));
page.on('console', (m) => m.type() === 'error' && errs.push('console: ' + m.text().slice(0, 300)));
await page.goto(url);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForTimeout(3000);
console.log(JSON.stringify({ tabs: await page.locator('.tab').count(), errs }, null, 1));
await browser.close();
