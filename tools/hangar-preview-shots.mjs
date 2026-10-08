// Скриншоты превью ангара: node tools/hangar-preview-shots.mjs "имя:параметры" … → tools/qa/hangar-<имя>.png
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const PORT = 5232;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const server = spawn(`npx vite --port ${PORT} --strictPort`, { cwd: ROOT, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
server.stdout.on('data', (d) => (log += d));
server.stderr.on('data', (d) => (log += d));
for (let k = 0; k < 120 && !/ready in|Local:/.test(log); k++) await new Promise((r) => setTimeout(r, 500));
const shots = process.argv.slice(2).length ? process.argv.slice(2) : ['stand:x=-1.6&z=1&yaw=3.14', 'fall:fall=1&t=0.9', 'lie:fall=1&t=2.4'];
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && console.log('console', m.text().slice(0, 300)));
for (const sh of shots) {
  const [name, params] = sh.split(':');
  await page.goto(`http://localhost:${PORT}/tools/hangar-preview.html?${params}`, { timeout: 120000 });
  await page.waitForFunction(() => !!window.__hangar, null, { timeout: 120000 });
  await page.waitForTimeout(2500);
  const info = await page.evaluate(() => window.__hangar);
  await page.screenshot({ path: fileURLToPath(new URL(`./qa/hangar-${name}.png`, import.meta.url)) });
  console.log(name, JSON.stringify(info));
}
await browser.close();
if (process.platform === 'win32') spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { shell: true });
else server.kill();
