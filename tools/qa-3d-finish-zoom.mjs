// Крупный фрагмент вида QA-страницы отделки (deviceScaleFactor 3): node tools/qa-3d-finish-zoom.mjs view x y w h [suffix]
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
const [view = '1', x = '480', y = '200', w = '240', h = '140', suf = ''] = process.argv.slice(2);
const out = fileURLToPath(new URL('./qa/', import.meta.url));
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 3 });
await page.goto(`http://localhost:5205/tools/qa-3d-finish.html?view=${view}${suf}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
await page.waitForTimeout(500);
await page.screenshot({ path: out + `fin-zoom-${view}.png`, clip: { x: +x, y: +y, width: +w, height: +h } });
await browser.close();
