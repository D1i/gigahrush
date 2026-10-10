// Значки хотбара лута: src/view3d/assets/loot_icons/<id предмета>.webp (96 × 96, прозрачный фон, мягкая тень снизу-
// справа) — рендер того же loot_props.glb, что в игре (tools/loot-preview.html?icon=1: PropModels + applyLootGlass,
// ортокамера 3/4 спереди-справа, свет — небо + ключевой спереди-слева-сверху; вид по предмету — ICON_VIEW там же).
// Рисуется 384 × 384 и сжимается в 96 (сглаживание), тень — размытая альфа (55 %, сдвиг 1, 2 px).
// Лист для проверки: tmp/loot-wip/shots/icons.png (×2 на тёмном и на светлом фоне).
// Свой порт (5198, PORT=…) и кэш vite — не мешать чужим dev-серверам и превью (5199).
//   node tools/make-loot-props.mjs && node tools/make-loot-icons.mjs
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const PORT = Number(process.env.PORT || 5198);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = fileURLToPath(new URL('../src/view3d/assets/loot_icons/', import.meta.url));
const SHOTS = fileURLToPath(new URL('../tmp/loot-wip/shots/', import.meta.url));
mkdirSync(OUT, { recursive: true });
mkdirSync(SHOTS, { recursive: true });
/** сторона значка, px */
const S = 96;

const server = await createServer({
  configFile: fileURLToPath(new URL('./vite.qa.config.ts', import.meta.url)),
  root: ROOT,
  cacheDir: 'node_modules/.vite-loot-icons',
  server: { port: PORT, strictPort: true },
  logLevel: 'warn',
});
await server.listen();
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 384, height: 384 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('console', m.text().slice(0, 300)));

/** PNG 384 → значок S × S с тенью (WebP) и PNG того же (для листа). */
async function finish(png) {
  const icon = await sharp(png).resize(S, S, { kernel: 'lanczos3' }).png().toBuffer();
  const a = await sharp(icon).extractChannel(3).blur(1.4).linear(0.55, 0).png().toBuffer();
  const shadow = await sharp({ create: { width: S, height: S, channels: 3, background: '#000000' } }).joinChannel(a).png().toBuffer();
  const shifted = await sharp(shadow)
    .extend({ top: 2, left: 1, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extract({ left: 0, top: 0, width: S, height: S })
    .png()
    .toBuffer();
  const flat = await sharp(shifted).composite([{ input: icon }]).png().toBuffer();
  const webp = await sharp(flat).webp({ quality: 90, alphaQuality: 100, effort: 6 }).toBuffer();
  return { webp, flat };
}

const made = [];
try {
  await page.goto(`http://localhost:${PORT}/tools/loot-preview.html?icon=1`, { timeout: 180000 });
  await page.waitForFunction(() => !!window.__lootIcon, null, { timeout: 180000 });
  const info = await page.evaluate(() => window.__loot);
  if (info.error) throw new Error(`PropModels: ${info.error}`);
  const ids = await page.evaluate(() => window.__lootItems);
  for (const id of ids) {
    const url = await page.evaluate((x) => window.__lootIcon(x), id);
    const { webp, flat } = await finish(Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
    writeFileSync(`${OUT}${id}.webp`, webp);
    made.push({ id, flat, bytes: webp.byteLength });
  }
} finally {
  await browser.close();
  await server.close();
}

// лист проверки: ×2 на тёмном и светлом
const T = S * 2, COLS = 6, rows = Math.ceil(made.length / COLS);
const tiles = [];
for (const [k, m] of made.entries()) {
  const big = await sharp(m.flat).resize(T, T, { kernel: 'nearest' }).png().toBuffer();
  const x = (k % COLS) * (T + 8), y = Math.floor(k / COLS) * (T + 8);
  tiles.push({ input: big, left: x, top: y }, { input: big, left: x, top: y + rows * (T + 8) + 16 });
}
const W = COLS * (T + 8), H = 2 * rows * (T + 8) + 16;
await sharp({ create: { width: W, height: H, channels: 4, background: '#1c1d1c' } })
  .composite([
    { input: await sharp({ create: { width: W, height: rows * (T + 8), channels: 4, background: '#a29f96' } }).png().toBuffer(), left: 0, top: rows * (T + 8) + 16 },
    ...tiles,
  ])
  .png()
  .toFile(`${SHOTS}icons.png`);
const total = made.reduce((s, m) => s + m.bytes, 0);
console.log(made.map((m) => `${m.id} ${(m.bytes / 1024).toFixed(1)} КБ`).join('\n'));
console.log(`→ ${OUT}: значков ${made.length}, ${(total / 1024).toFixed(1)} КБ; лист — ${SHOTS}icons.png`);
