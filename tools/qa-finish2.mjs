// Взаимодействия UI отделки: явное назначение в инспекторе, переходы в библиотеку, каскадное удаление.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const url = process.argv[2] ?? 'http://localhost:5207/';
const out = fileURLToPath(new URL('./qa/', import.meta.url));
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
const log = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('dialog', (d) => {
  log.push('dialog: ' + d.message().split('\n')[0]);
  d.accept();
});
const shot = (n) => page.screenshot({ path: out + n + '.png' });
const tab = (name) => page.getByRole('button', { name, exact: true }).click();

await page.goto(url);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForTimeout(1500);

await tab('Комнаты');
await page.locator('.li', { hasText: /кухня/i }).first().click();
await page.waitForTimeout(300);
const sec = page.locator('.section', { hasText: 'Отделка' }).first();
// стены — явно «Обои ромбик»
await sec.locator('select').first().selectOption({ label: 'Обои «ромбик», голубые' });
await page.waitForTimeout(300);
await sec.scrollIntoViewIfNeeded();
await sec.screenshot({ path: out + 'g1-explicit.png' });
log.push('chips after explicit: ' + (await sec.locator('.pn-fin-chip').allInnerTexts()).join(' | '));

// клик по чипу — карточка отделки в библиотеке
await sec.locator('.pn-fin-chip').first().click();
await page.waitForTimeout(800);
log.push('lib tab: ' + (await page.locator('.lib-tab.on').innerText()));
log.push('card name: ' + (await page.locator('.lib-card input.input').first().inputValue()));
await shot('g2-from-chip');

// назад в редактор → «правила…»
await tab('Комнаты');
await page.waitForTimeout(300);
await page.locator('.section', { hasText: 'Отделка' }).first().getByRole('button', { name: 'правила…' }).click();
await page.waitForTimeout(500);
log.push('lib tab after правила: ' + (await page.locator('.lib-tab.on').innerText()));

// удаление ромбика с подтверждением: каскад
await page.locator('.lib-tab').nth(1).click();
await page.locator('.lib-li', { hasText: 'ромбик' }).first().click();
await page.waitForTimeout(300);
await page.locator('.lib-card-h .btn.danger').click();
await page.waitForTimeout(500);
log.push('toasts: ' + (await page.locator('.toast').allInnerTexts()).join(' | '));
await tab('Комнаты');
await page.waitForTimeout(300);
const sec2 = page.locator('.section', { hasText: 'Отделка' }).first();
log.push('wall select after delete: ' + (await sec2.locator('select').first().inputValue() || '(по правилу)'));
log.push('chips after delete: ' + (await sec2.locator('.pn-fin-chip').allInnerTexts()).join(' | '));

// undo возвращает
await page.keyboard.press('Control+z');
await page.waitForTimeout(400);
log.push('after undo: ' + (await page.locator('.section', { hasText: 'Отделка' }).first().locator('.pn-fin-chip').allInnerTexts()).join(' | '));

console.log(log.join('\n'));
console.log(JSON.stringify({ errors }, null, 2));
await browser.close();
