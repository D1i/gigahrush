// Скриншоты превью предмета в руке: node tools/held-preview-shots.mjs [запрос …] → tmp/loot-wip/held/<запрос>.png
// Запрос — параметры tools/held-preview.html (`held=it_zippo`, `floor=1&lit=0.03&held=it_flashlight`). Особый запрос
// `all[&…]` — все предметы в руке по очереди, листы all[_…]_<n>.png (3 × 2). По умолчанию — все в руке (тускло и в темноте),
// спичка, жесты, левая рука, пол (сверху и глазами игрока, с фонарём в темноте).
// Свой порт (5197, PORT=…) и свой кэш vite (в дереве работают и другие dev-серверы: общий кэш даёт «504 Outdated
// Optimize Dep»).
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const PORT = Number(process.env.PORT || 5197);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = fileURLToPath(new URL('../tmp/loot-wip/held/', import.meta.url));
mkdirSync(OUT, { recursive: true });
const ITEMS = [
  'it_kopeyki', 'it_radiolamp', 'it_cards', 'it_wick', 'it_kerosene', 'it_sticker', 'it_matches', 'it_hunt_matches', 'it_backpack',
  'it_bread', 'it_flashlight', 'it_tube_ext', 'it_bulb', 'it_bug_flash', 'it_batteries', 'it_zippo', 'it_kerolamp', 'it_preserves',
  'it_bubble', 'it_yuzgram', 'it_unknown_thing',
];
const TW = 640, TH = 400;
const T0 = Date.now();
const server = await createServer({
  configFile: fileURLToPath(new URL('./vite.qa.config.ts', import.meta.url)),
  root: ROOT,
  cacheDir: 'node_modules/.vite-held-preview',
  server: { port: PORT, strictPort: true },
  logLevel: 'warn',
});
await server.listen();
const shots =
  process.argv.length > 2
    ? process.argv.slice(2)
    : ['all', 'all&lit=0.03', 'held=it_matches&match=it_matches&lit=0.03', 'held=it_hunt_matches&match=it_hunt_matches&lit=0.03', 'held=it_bread&gest=eat', 'held=it_bubble&gest=drink', 'held=it_flashlight&side=-1&lit=0.03', 'held=it_kerolamp&walk=1&lit=0.03', 'floor=1&lit=0.5', 'floor=1&lit=0.03&held=it_flashlight', 'floor=1&eye=1&lit=0.03&held=it_flashlight'];
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('console', m.text().slice(0, 300)));
const name = (s) => s.replace(/[^a-z0-9.-]+/gi, '_');
let loaded = false;
async function load(first) {
  // первая загрузка: vite может пересобрать зависимости и перезагрузить страницу (ERR_ABORTED) — ещё раз
  for (let k = 0; ; k++) {
    try {
      await page.goto(`http://localhost:${PORT}/tools/held-preview.html?${first}`, { timeout: 180000 });
      await page.waitForFunction(() => !!window.__held, null, { timeout: 180000 });
      break;
    } catch (e) {
      if (k >= 2) throw e;
      console.log('  повтор загрузки:', String(e.message).split(/\r?\n/)[0]);
    }
  }
  loaded = true;
}
try {
  for (const s of shots) {
    if (s.startsWith('all')) {
      const extra = s.slice(3);
      await page.setViewportSize({ width: TW, height: TH });
      if (!loaded) await load(`held=${ITEMS[0]}${extra}`);
      const tiles = [];
      for (const id of ITEMS) {
        const info = await page.evaluate((v) => window.__show(v), `held=${id}${extra}`);
        if (!info.visible) console.log('  не видно:', id, JSON.stringify(info));
        tiles.push(await page.screenshot());
      }
      for (let n = 0; n * 6 < tiles.length; n++) {
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
    if (!loaded) await load(s);
    const info = await page.evaluate((v) => window.__show(v), s);
    const file = `${OUT}${name(s)}.png`;
    await page.screenshot({ path: file });
    console.log(s, file, JSON.stringify(info), `${((Date.now() - T0) / 1000).toFixed(0)} с`);
  }
} finally {
  await browser.close();
  await server.close();
}
