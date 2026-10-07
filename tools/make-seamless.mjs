// Бесшовная плитка обоев «Дамаск» из фото пользователя → src/data/assets/wallpaper-damask.jpg.
// Рецепт (период узора, участок, заплатка на водяной знак) — в tools/make-seamless.html, обработка — src/render/seamless.ts.
// Нужен dev-сервер: npx vite --port 5206 --strictPort
// node tools/make-seamless.mjs [url] [--gallery]   (скриншоты сведения 3×3 — в tools/qa/seamless-*.png)
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const gallery = args.includes('--gallery');
const base = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:5206/tools/make-seamless.html';
const url = base + (gallery ? (base.includes('?') ? '&' : '?') + 'gallery' : '');
const qa = fileURLToPath(new URL('./qa/', import.meta.url));
const dst = fileURLToPath(new URL('../src/data/assets/wallpaper-damask.jpg', import.meta.url));
mkdirSync(qa, { recursive: true });
mkdirSync(fileURLToPath(new URL('../src/data/assets/', import.meta.url)), { recursive: true });

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => (errors.push('PAGEERROR ' + e.message), console.error('PAGEERROR', e.message)));
page.on('console', (m) => m.type() === 'error' && (errors.push(m.text()), console.error(m.text())));
await page.goto(url);
await page.waitForFunction(() => window.__result, null, { timeout: 60000 });
const res = await page.evaluate(() => window.__result);
const b64 = res.jpeg.slice(res.jpeg.indexOf(',') + 1);
writeFileSync(dst, Buffer.from(b64, 'base64'));
await page.screenshot({ path: qa + 'seamless-damask.png', fullPage: true });
if (gallery) await page.locator('#gallery').screenshot({ path: qa + 'seamless-gallery.png' });
console.log(JSON.stringify({ saved: dst, ...res.info, errors }, null, 1));
await browser.close();
