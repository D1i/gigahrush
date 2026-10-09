// Скриншоты превью моделей метро: node tools/metro-preview-shots.mjs [запрос …]
// Запрос — параметры tools/metro-preview.html (`view=3&yaw=40`, `hall=0`, `hall=1&dark=1`); по умолчанию — все кадры
// предметов и макета зала. → tools/qa/metro-<запрос>.png
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const PORT = 5263;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const server = spawn(`npx vite --port ${PORT} --strictPort`, { cwd: ROOT, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
server.stdout.on('data', (d) => (log += d));
server.stderr.on('data', (d) => (log += d));
for (let k = 0; k < 120 && !/ready in|Local:/.test(log); k++) await new Promise((r) => setTimeout(r, 500));
const shots = process.argv.length > 2 ? process.argv.slice(2) : [...Array.from({ length: 12 }, (_, k) => `view=${k}`), 'hall=0', 'hall=1', 'hall=2', 'hall=3'];
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('console', m.text().slice(0, 300)));
try {
  for (const s of shots) {
    await page.goto(`http://localhost:${PORT}/tools/metro-preview.html?${s}`, { timeout: 120000 });
    await page.waitForFunction(() => !!window.__metro, null, { timeout: 120000 });
    await page.waitForTimeout(500);
    const info = await page.evaluate(() => window.__metro);
    await page.screenshot({ path: fileURLToPath(new URL(`./qa/metro-${s.replace(/[^a-z0-9.]+/gi, '_')}.png`, import.meta.url)) });
    console.log(s, JSON.stringify(info));
  }
} finally {
  await browser.close();
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { shell: true });
  else server.kill();
}
