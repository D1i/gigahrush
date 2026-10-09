// Скриншоты превью моделей общаги: node tools/obshaga-preview-shots.mjs [кадры через запятую] [доп. параметры через &]
// → tools/qa/obsh-view*.png (кадры — VIEWS в tools/obshaga-preview.ts).
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const PORT = 5253;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const server = spawn(`npx vite --port ${PORT} --strictPort`, { cwd: ROOT, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
server.stdout.on('data', (d) => (log += d));
server.stderr.on('data', (d) => (log += d));
for (let k = 0; k < 120 && !/ready in|Local:/.test(log); k++) await new Promise((r) => setTimeout(r, 500));
const views = (process.argv[2] ?? '0,1,2,3,4,5,6,7,8,9,10,11,12').split(',');
const extra = process.argv[3] ?? '';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('console', m.text().slice(0, 300)));
try {
  for (const v of views) {
    await page.goto(`http://localhost:${PORT}/tools/obshaga-preview.html?view=${v}&${extra}`, { timeout: 120000 });
    await page.waitForFunction(() => !!window.__obsh, null, { timeout: 120000 });
    await page.waitForTimeout(500);
    const info = await page.evaluate(() => window.__obsh);
    const tag = extra ? `-${extra.replace(/[^a-z0-9]+/gi, '_')}` : '';
    await page.screenshot({ path: fileURLToPath(new URL(`./qa/obsh-view${v}${tag}.png`, import.meta.url)) });
    console.log('view', v, JSON.stringify(info));
  }
} finally {
  await browser.close();
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { shell: true });
  else server.kill();
}
