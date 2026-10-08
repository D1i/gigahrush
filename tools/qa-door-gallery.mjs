// Скриншот галереи дверей: node tools/qa-door-gallery.mjs [параметры URL, напр. "only=int_dg&dead=1"] [--keep-server]
// (снимок — tools/qa/doors.png; сервер vite поднимается сам)
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PORT = 5231;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const out = fileURLToPath(new URL('./qa/', import.meta.url));
mkdirSync(out, { recursive: true });
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const keep = process.argv.includes('--keep-server');
const server = spawn(`npx vite --port ${PORT} --strictPort`, { cwd: ROOT, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
server.stdout.on('data', (d) => (log += d));
server.stderr.on('data', (d) => (log += d));
const stop = () => {
  if (keep) return;
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { shell: true });
    else server.kill('SIGTERM');
  } catch {}
};
for (let k = 0; k < 120 && !/ready in|Local:/.test(log); k++) await new Promise((r) => setTimeout(r, 500));
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1560, height: 900 } });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 300)));
  await page.goto(`http://localhost:${PORT}/tools/door-gallery.html${args[0] ? '?' + args[0] : ''}`, { timeout: 180000 });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
  const name = args[1] ?? 'doors';
  await page.screenshot({ path: out + name + '.png', fullPage: true });
  console.log('OK', out + name + '.png');
} catch (e) {
  errors.push(String(e));
} finally {
  await browser.close();
  stop();
}
if (errors.length) console.log(JSON.stringify(errors, null, 1));
