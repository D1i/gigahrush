// Скриншоты превью лута: node tools/loot-preview-shots.mjs [запрос …] → tmp/loot-wip/shots/<запрос>.png
// Запрос — параметры tools/loot-preview.html (`view=3`, `view=10&dark=1`, `cell=12&az=90`). Особый запрос `cells[&…]` —
// все 23 клетки крупно (480 × 360), сложенные по 6 в листы cells[_…]_<n>.png (3 × 2). По умолчанию — обзор (view=8),
// глазами игрока (view=10, светло и темно), листы клеток спереди и сзади (az=200).
// Свой порт (5199, PORT=…) и свой кэш vite (в дереве работают и другие dev-серверы: общий кэш даёт «504 Outdated
// Optimize Dep»).
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const PORT = Number(process.env.PORT || 5199);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = fileURLToPath(new URL('../tmp/loot-wip/shots/', import.meta.url));
mkdirSync(OUT, { recursive: true });
const CELLS = 23, TW = 480, TH = 360;
const T0 = Date.now();
const server = await createServer({
  configFile: fileURLToPath(new URL('./vite.qa.config.ts', import.meta.url)),
  root: ROOT,
  cacheDir: 'node_modules/.vite-loot-preview',
  server: { port: PORT, strictPort: true },
  logLevel: 'warn',
});
await server.listen();
const shots = process.argv.length > 2 ? process.argv.slice(2) : ['view=8', 'view=10', 'view=10&dark=1', 'cells', 'cells&az=200'];
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('console', m.text().slice(0, 300)));
const name = (s) => s.replace(/[^a-z0-9.]+/gi, '_');
async function shoot(s, path) {
  await page.goto(`http://localhost:${PORT}/tools/loot-preview.html?${s}`, { timeout: 180000 });
  await page.waitForFunction(() => !!window.__loot, null, { timeout: 180000 });
  const info = await page.evaluate(() => window.__loot);
  const buf = await page.screenshot(path ? { path } : {});
  return { info, buf };
}
try {
  for (const s of shots) {
    if (s.startsWith('cells')) {
      // одна загрузка (раскладка в swiftshader строится долго), дальше — только камера: window.__lootView
      await page.setViewportSize({ width: TW, height: TH });
      const extra = s.slice(5);
      await shoot(`cell=0${extra}`);
      const tiles = [];
      for (let k = 0; k < CELLS; k++) {
        await page.evaluate((v) => window.__lootView(v), `cell=${k}${extra}`);
        tiles.push(await page.screenshot());
      }
      for (let n = 0; n * 6 < CELLS; n++) {
        const part = tiles.slice(n * 6, n * 6 + 6);
        const file = `${OUT}${name(s)}_${n}.png`;
        await sharp({ create: { width: TW * 3 + 8, height: TH * 2 + 4, channels: 3, background: '#000' } })
          .composite(part.map((t, i) => ({ input: t, left: (i % 3) * (TW + 4), top: Math.floor(i / 3) * (TH + 4) })))
          .png()
          .toFile(file);
        console.log(s, file, `${((Date.now() - T0) / 1000).toFixed(0)} с`);
      }
      await page.setViewportSize({ width: 960, height: 600 });
      continue;
    }
    const file = `${OUT}${name(s)}.png`;
    const { info } = await shoot(s, file);
    console.log(s, file, JSON.stringify({ models: info.models, error: info.error, glass: info.glass }));
  }
} finally {
  await browser.close();
  await server.close();
}
