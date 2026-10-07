// Воспроизведение: старый проект (v1-пресеты), у лестниц макс 1, цель 150 → диагностика и починка.
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const url = process.argv[2] ?? 'http://localhost:5190/';
const out = fileURLToPath(new URL('./qa/', import.meta.url));
mkdirSync(out, { recursive: true });
const old = JSON.parse(readFileSync(fileURLToPath(new URL('../tmp/old_v1.json', import.meta.url)), 'utf8'));
for (const r of old.rooms) if (r.tags[0] === 'лестница') r.gen.max = 1;
Object.assign(old.generator, { count: 150, gap: 0, sightM: 9, fill: false });

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('dialog', (d) => d.accept());
const shot = (n) => page.screenshot({ path: out + n + '.png' });
const tab = (name) => page.getByRole('button', { name, exact: true }).click();

await page.goto(url);
await page.evaluate((p) => localStorage.setItem('room-forge/project/v1', JSON.stringify(p)), old);
await page.reload();
await page.waitForTimeout(1500);
await tab('Генератор');
await page.waitForTimeout(1500);
await shot('d1-old-generator');
const info = await page.evaluate(() => document.querySelector('.stopdx')?.innerText ?? 'нет блока');
console.log(info);

await page.getByRole('button', { name: 'Обновить пресеты…' }).first().click();
await page.waitForTimeout(500);
await page.getByRole('button', { name: /Сгенерировать/ }).first().click();
await page.waitForTimeout(2000);
await shot('d2-after-update');
const counts = await page.evaluate(() => [...document.querySelectorAll('.stat .v')].slice(0, 3).map((e) => e.textContent));
console.log('после обновления:', counts, 'блок:', await page.evaluate(() => !!document.querySelector('.stopdx')));
console.log(JSON.stringify({ errors }, null, 2));
await browser.close();
