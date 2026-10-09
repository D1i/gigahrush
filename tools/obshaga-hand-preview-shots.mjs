// Скриншоты превью руки общаги: node tools/obshaga-hand-preview-shots.mjs [кадры через запятую] [доп. параметры через &]
// → tools/qa/obsh-hand-<кадр>.png (кадры — см. tools/obshaga-hand-preview.ts: lit, dark, grab, emerge, door, top, side, close).
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const PORT = 5247;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const server = spawn(`npx vite --port ${PORT} --strictPort`, { cwd: ROOT, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
server.stdout.on('data', (d) => (log += d));
server.stderr.on('data', (d) => (log += d));
for (let k = 0; k < 120 && !/ready in|Local:/.test(log); k++) await new Promise((r) => setTimeout(r, 500));
const views = (process.argv[2] ?? 'lit,dark,grab,emerge').split(',');
const extra = process.argv[3] ?? '';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('console', m.text().slice(0, 300)));
try {
  for (const v of views) {
    await page.goto(`http://localhost:${PORT}/tools/obshaga-hand-preview.html?view=${v}&${extra}`, { timeout: 120000 });
    await page.waitForFunction(() => !!window.__hand, null, { timeout: 120000 });
    await page.waitForTimeout(300);
    const info = await page.evaluate(() => window.__hand);
    const tag = extra ? `-${extra.replace(/[^a-z0-9]+/gi, '_')}` : '';
    await page.screenshot({ path: fileURLToPath(new URL(`./qa/obsh-hand-${v}${tag}.png`, import.meta.url)) });
    console.log('view', v, JSON.stringify(info));
  }
} finally {
  await browser.close();
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { shell: true });
  else server.kill();
}
