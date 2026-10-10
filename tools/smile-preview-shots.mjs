// Скриншоты превью «Улыбки»: node tools/smile-preview-shots.mjs [запрос …] → tmp/smile-wip/shots/<имя>.png
// Запрос — параметры tools/smile-preview.html (`scene=peek&lean=0.3`), можно с именем: `peek_03:scene=peek&lean=0.3`;
// по умолчанию — набор SHOTS ниже. Свой порт и свой кэш vite (в дереве работают и другие dev-серверы: общий кэш даёт
// «504 Outdated Optimize Dep»); конфиг без слежения за файлами (tools/vite.qa.config.ts).
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const PORT = Number(process.env.PORT || 5296);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = fileURLToPath(new URL('../tmp/smile-wip/shots/', import.meta.url));
mkdirSync(OUT, { recursive: true });
const SHOTS = [
  'peek_lean03:scene=peek&lean=0.3&dist=3',
  'peek_lean1:scene=peek&lean=1',
  'peek_torn1:scene=peek&lean=1&torn=1&dist=4',
  'peek_side-1:scene=peek&lean=1&side=-1&dist=9',
  'peek_lean0:scene=peek&lean=0&dist=4',
  'stand:scene=stand',
  'stand_far:scene=stand&dist=13',
  'stand_10:scene=stand&dist=10',
  'peek_far:scene=peek&lean=1&dist=10',
  'stand_torn:scene=stand&torn=1&dist=3.5',
  'window:scene=window',
  'pounce06:scene=pounce&pounce=0.6',
  'pounce1:scene=pounce&pounce=1',
  'eat:scene=eat',
  'eyes_dark:scene=eyes',
  'spurt:scene=spurt&t=2.55',
  'face:scene=face',
  'face_torn:scene=face&torn=1',
  'face_lit:scene=face&lit=1&flash=0',
];
const server = await createServer({
  configFile: fileURLToPath(new URL('./vite.qa.config.ts', import.meta.url)),
  root: ROOT,
  cacheDir: 'node_modules/.vite-smile-preview',
  server: { port: PORT, strictPort: true },
  logLevel: 'warn',
});
await server.listen();
const shots = process.argv.length > 2 ? process.argv.slice(2) : SHOTS;
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
// HD=1 — кадр 1920×1080 (как в игре: читается ли лицо и улыбка на 8–12 м)
const page = await browser.newPage({ viewport: process.env.HD ? { width: 1920, height: 1080 } : { width: 960, height: 600 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('console', m.text().slice(0, 300)));
try {
  for (const s of shots) {
    const eq = s.indexOf(':'), named = eq > 0;
    const name = named ? s.slice(0, eq) : s.replace(/[^a-z0-9.]+/gi, '_');
    const qs = named ? s.slice(eq + 1) : s;
    // первый заход: vite дособирает зависимости и перезагружает страницу (ERR_ABORTED) — повторить
    for (let k = 0; ; k++) {
      try {
        await page.goto(`http://localhost:${PORT}/tools/smile-preview.html?ui=0&${qs}`, { timeout: 180000 });
        await page.waitForFunction(() => !!window.__smile, null, { timeout: 180000 });
        break;
      } catch (e) {
        if (k >= 3) throw e;
        console.log('retry', name, String(e.message).split('\n')[0]);
      }
    }
    const info = await page.evaluate(() => window.__smile);
    const file = `${OUT}${name}.png`;
    await page.screenshot({ path: file });
    console.log(name, JSON.stringify(info));
  }
} finally {
  await browser.close();
  await server.close();
}
