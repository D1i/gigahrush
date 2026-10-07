// Холст «Генератора», режим «Глазами игрока» для складчатого прогона с PVS: снимок и подписи.
// node tools/qa-3d-fold-preview.mjs [url]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const url = process.argv[2] ?? 'http://localhost:5209/';
const out = fileURLToPath(new URL('./qa/', import.meta.url));
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 300)));
await page.goto(url);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForTimeout(800);
await page.getByRole('button', { name: 'Генератор', exact: true }).click();
await page.waitForTimeout(500);
const info = await page.evaluate(async () => {
  const { generateFoldRun } = await import('/src/gen4d/fold.ts');
  const { getProject } = await import('/src/model/store.ts');
  const { setUI } = await import('/src/model/ui.ts');
  const run = generateFoldRun(getProject(), { seed: 'hrush-001', count: 40 });
  setUI({ run, runInst: null });
  return { pvs: !!run.pvs, n: run.instances.length };
});
await page.waitForTimeout(800);
await page.getByRole('button', { name: 'Глазами игрока', exact: true }).click();
await page.waitForTimeout(1200);
await page.screenshot({ path: out + 'fold-preview-player.png' });
const legend = await page.locator('.pv-legend').first().innerText().catch(() => '');
const hud = await page.locator('.hint', { hasText: 'видимый набор' }).first().innerText().catch(() => '');
console.log(JSON.stringify({ info, legend, hud, errors }, null, 2));
await browser.close();
