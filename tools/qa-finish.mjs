// Проверка UI отделки: библиотека (список, карточка с предпросмотром стены, загрузка текстуры),
// правила, инспектор кухни, холст генератора.
// node tools/qa-finish.mjs http://localhost:5207/
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const url = process.argv[2] ?? 'http://localhost:5207/';
const out = fileURLToPath(new URL('./qa/', import.meta.url));
const damask = fileURLToPath(new URL('../tmp/wallpaper-damask-src.png', import.meta.url));
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('dialog', (d) => {
  console.log('DIALOG:\n' + d.message());
  d.dismiss();
});
const shot = (n) => page.screenshot({ path: out + n + '.png' });
const tab = (name) => page.getByRole('button', { name, exact: true }).click();

await page.goto(url);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForTimeout(1500);

await tab('Библиотеки');
await page.waitForTimeout(300);
await page.locator('.lib-tab').nth(1).click();
await page.waitForTimeout(500);
await shot('f1-list');

// дамаск (или первая отделка стен)
let li = page.locator('.lib-li', { hasText: /дамаск/i }).first();
if (!(await li.count())) {
  errors.push('нет отделки «дамаск»');
  li = page.locator('.lib-li').first();
}
await li.click();
await page.waitForTimeout(1200);
await shot('f2-damask');
await page.locator('.fin-stage-bar .check').click();
await page.waitForTimeout(500);
await shot('f3-damask-seams');
await page.locator('.fin-stage-bar .check').click();

// отделка с нижней панелью, если есть
const withDado = page.locator('.lib-li', { hasText: /панель/i }).first();
if (await withDado.count()) {
  await withDado.click();
  await page.waitForTimeout(800);
  await shot('f4-dado');
}
// пол
await page.locator('.lib-seg button').nth(2).click();
await page.waitForTimeout(200);
await page.locator('.lib-li').first().click();
await page.waitForTimeout(800);
await shot('f5-floor');
await page.locator('.lib-seg button').nth(0).click();

// новая отделка стен + загрузка исходника обоев
await page.getByRole('button', { name: '+ отделка стен' }).first().click();
await page.waitForTimeout(300);
await page.locator('.lib-card input[type=file]').setInputFiles(damask);
await page.waitForTimeout(6000);
await shot('f6-upload');

// удаление (confirm отклоняется — текст в лог)
await li.click();
await page.waitForTimeout(300);
await page.locator('.lib-card-h .btn.danger').click();
await page.waitForTimeout(300);

// правила
await page.locator('.lib-tab').nth(2).click();
await page.waitForTimeout(500);
await shot('f7-rules');
const rb = page.locator('.fin-rooms-btn').first();
if (await rb.count()) {
  await rb.click();
  await page.waitForTimeout(300);
  await shot('f8-rules-open');
}

// инспектор кухни
await tab('Комнаты');
await page.waitForTimeout(500);
const kitchen = page.locator('.li', { hasText: /кухня/i }).first();
if (await kitchen.count()) {
  await kitchen.click();
  await page.waitForTimeout(500);
  const sec = page.locator('.section', { hasText: 'Отделка' }).first();
  await sec.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await shot('f9-kitchen');
  await sec.screenshot({ path: out + 'f9b-kitchen-section.png' });
} else errors.push('нет кухни');

// генератор: пол — цвет отделки
await tab('Генератор');
await page.waitForTimeout(2500);
await shot('f10-generator');
await page.mouse.move(700, 450);
for (let i = 0; i < 6; i++) {
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(80);
}
await page.waitForTimeout(500);
await shot('f11-generator-zoom');

console.log(JSON.stringify({ errors }, null, 2));
await browser.close();
