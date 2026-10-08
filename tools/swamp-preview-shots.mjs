// Скриншоты превью финала «Болото на крыше»: node tools/swamp-preview-shots.mjs "имя:параметры" … → tools/qa/swamp-<имя>.png
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const PORT = 5241;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const server = spawn(`npx vite --port ${PORT} --strictPort`, { cwd: ROOT, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
server.stdout.on('data', (d) => (log += d));
server.stderr.on('data', (d) => (log += d));
for (let k = 0; k < 120 && !/ready in|Local:/.test(log); k++) await new Promise((r) => setTimeout(r, 500));
const shots = process.argv.slice(2).length ? process.argv.slice(2) : ['hatch:x=0&z=0.6&yaw=0&pitch=-0.05', 'gear:x=0.6&z=9&yaw=-0.1&pitch=-0.25', 'side:x=-7&z=13&yaw=1.2&pitch=-0.12', 'press:t=2.2', 'under:t=4.5', 'emerge:t=8.4', 'crawl:t=12', 'look:t=16.5', 'title:t=19.5'];
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && console.log('console', m.text().slice(0, 300)));
for (const sh of shots) {
  const [name, params] = sh.split(':');
  await page.goto(`http://localhost:${PORT}/tools/swamp-preview.html?${params}`, { timeout: 120000 });
  await page.waitForFunction(() => !!window.__swamp, null, { timeout: 120000 });
  await page.waitForTimeout(2500);
  const info = await page.evaluate(() => window.__swamp);
  await page.screenshot({ path: fileURLToPath(new URL(`./qa/swamp-${name}.png`, import.meta.url)) });
  console.log(name, JSON.stringify(info));
}
await browser.close();
if (process.platform === 'win32') spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { shell: true });
else server.kill();
