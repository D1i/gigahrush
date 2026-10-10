// Скриншоты превью погреба: node tools/cellar-preview-shots.mjs [запрос …] → tmp/cellar/shots/<запрос>.png
// Запрос — параметры tools/cellar-preview.html (`view=3`, `view=0&lit=1`); по умолчанию — кадры 0…9. Свой порт и свой
// кэш vite (в дереве работают и другие dev-серверы: общий кэш даёт «504 Outdated Optimize Dep»).
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const PORT = Number(process.env.PORT || 5291);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = fileURLToPath(new URL('../tmp/cellar/shots/', import.meta.url));
mkdirSync(OUT, { recursive: true });
const server = await createServer({
  configFile: fileURLToPath(new URL('./vite.qa.config.ts', import.meta.url)),
  root: ROOT,
  cacheDir: 'node_modules/.vite-cellar-preview',
  server: { port: PORT, strictPort: true },
  logLevel: 'warn',
});
await server.listen();
const shots = process.argv.length > 2 ? process.argv.slice(2) : Array.from({ length: 10 }, (_, k) => `view=${k}`);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('console', m.text().slice(0, 300)));
try {
  for (const s of shots) {
    await page.goto(`http://localhost:${PORT}/tools/cellar-preview.html?${s}`, { timeout: 180000 });
    await page.waitForFunction(() => !!window.__cellar, null, { timeout: 180000 });
    const info = await page.evaluate(() => window.__cellar);
    const file = `${OUT}${s.replace(/[^a-z0-9.]+/gi, '_')}.png`;
    await page.screenshot({ path: file });
    console.log(s, file, JSON.stringify(info));
  }
} finally {
  await browser.close();
  await server.close();
}
