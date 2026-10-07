// Интерактивная проверка редактора: выбор комнаты, выделение, модалка вариантов, ввод в инспекторе.
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
page.on('console', (m) => m.type() === 'error' && !m.text().includes('favicon') && errors.push(m.text()));
const shot = (n) => page.screenshot({ path: out + n + '.png' });
const log = [];

await page.goto(url);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForTimeout(1200);

// кухня
await page.locator('.li', { hasText: 'Кухня 1-464' }).first().click();
await page.waitForTimeout(500);
await shot('e1-kitchen');

// клик по центру холста инструментом выбор — что-то выделится?
const cv = page.locator('.stage canvas').first();
const box = await cv.boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await page.waitForTimeout(300);
await shot('e2-click-center');

// открыть варианты первой группы
const vb = page.getByRole('button', { name: /варианты/ }).first();
if (await vb.count()) {
  await vb.click();
  await page.waitForTimeout(500);
  await shot('e3-variants');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
} else log.push('нет кнопки «варианты»');

// ввод в поле названия + Delete: комната не должна потерять выделенный объект
const before = await page.evaluate(() => JSON.parse(localStorage.getItem('room-forge/project/v1') || '{}').rooms?.length);
const name = page.locator('.side.right input.input').first();
await name.click();
await page.keyboard.press('End');
await page.keyboard.type(' тест');
await page.keyboard.press('Backspace');
await page.keyboard.press('Delete');
await page.waitForTimeout(800);
log.push('rooms before/after: ' + before + '/' + (await page.evaluate(() => JSON.parse(localStorage.getItem('room-forge/project/v1') || '{}').rooms?.length)));

// инструмент прямоугольник: вычесть кусок с Shift
await page.keyboard.press('Escape');
await cv.click({ position: { x: 5, y: 5 } }).catch(() => {});
await page.keyboard.press('2');
await page.keyboard.down('Shift');
await page.mouse.move(box.x + box.width / 2 - 40, box.y + box.height / 2 - 40);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 40, { steps: 5 });
await shot('e4-rect-sub-drag');
await page.mouse.up();
await page.keyboard.up('Shift');
await page.waitForTimeout(300);
await shot('e5-rect-sub-done');

// зал 1-464
await page.locator('.li', { hasText: 'Зал' }).first().click();
await page.waitForTimeout(500);
await shot('e6-living');
// радиолюбитель
await page.locator('.li', { hasText: 'радиолюб' }).first().click();
await page.waitForTimeout(500);
await shot('e7-radio');

console.log(JSON.stringify({ errors, log }, null, 2));
await browser.close();
