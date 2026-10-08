// Скриншоты превью снежных ходов: node tools/snow-preview-shots.mjs [параметры через &] → tools/qa/snow-view*.png
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const PORT = 5231;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const server = spawn(`npx vite --port ${PORT} --strictPort`, { cwd: ROOT, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
server.stdout.on('data', (d) => (log += d));
server.stderr.on('data', (d) => (log += d));
for (let k = 0; k < 120 && !/ready in|Local:/.test(log); k++) await new Promise((r) => setTimeout(r, 500));
const extra = process.argv[2] ?? '';
const views = (process.argv[3] ?? '0,1,2,3,4').split(',');
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('console', m.text().slice(0, 300)));
for (const v of views) {
  await page.goto(`http://localhost:${PORT}/tools/snow-preview.html?view=${v}&${extra}`, { timeout: 120000 });
  await page.waitForFunction(() => !!window.__snow, null, { timeout: 120000 });
  await page.waitForTimeout(1500);
  const info = await page.evaluate(() => window.__snow);
  await page.screenshot({ path: fileURLToPath(new URL(`./qa/snow-view${v}.png`, import.meta.url)) });
  console.log('view', v, JSON.stringify(info));
}
await browser.close();
if (process.platform === 'win32') spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { shell: true });
else server.kill();
