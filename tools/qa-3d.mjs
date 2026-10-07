// QA вкладки «3D» и демо Babylon: скриншоты облёта, от первого лица, вплотную (gap 0), GLB-экспорт.
// node tools/qa-3d.mjs [url]
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const url = process.argv[2] ?? 'http://localhost:5190/';
const only = process.argv[3] ?? 'all';
const out = fileURLToPath(new URL('./qa/', import.meta.url));
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 300)));
const shot = (n) => page.screenshot({ path: out + n + '.png' });
const tab = (name) => page.getByRole('button', { name, exact: true }).click();
const wait = (ms) => page.waitForTimeout(ms);
const report = {};

/** Вкладка 3D со сценой; dev-сервер может перезагрузить страницу (HMR при правках ядра) — тогда заново. */
async function go3D(src = 'Прогон') {
  for (let k = 0; k < 4; k++) {
    const on = await page.locator('.tab.on').innerText().catch(() => '');
    if (on !== '3D') await tab('3D');
    await page.getByRole('button', { name: src, exact: true }).click();
    const gen = page.getByRole('button', { name: 'Сгенерировать', exact: true });
    if (src === 'Прогон' && (await gen.count())) await gen.first().click();
    const ok = await page.waitForFunction(() => !!window.__rf3d?.bo, null, { timeout: 15000 }).then(() => true, () => false);
    if (ok) return wait(1200);
  }
  errors.push('нет сцены (' + src + ')');
}
/** Камера облёта/FPS через window.__rf3d (только dev). План (x, y) → Babylon (x, −y). */
async function cam(fn, arg) {
  await page.waitForFunction(() => !!window.__rf3d?.bo, null, { timeout: 15000 }).catch(() => {});
  await page.evaluate(fn, arg);
  await wait(900);
}

if (only === 'all' || only === 'app') {
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await wait(1200);
  await go3D();
  await shot('3d-1-orbit');
  report.side = await page.locator('.side.right').innerText();

  // крупнее: облёт ближе к стартовой комнате
  await cam(() => {
    const v = window.__rf3d;
    const r = v.model.rooms[0];
    v.orbit.setTarget(new v.orbit.target.constructor(r.anchor[0], 0, -r.anchor[1]));
    v.orbit.radius = 9;
    v.orbit.beta = 0.95;
    v.orbit.alpha = -Math.PI / 2 - 0.6;
  });
  await shot('3d-2-orbit-close');

  // клик по полу → подпись комнаты (вид почти сверху, самая большая комната)
  await cam(() => {
    const v = window.__rf3d;
    v.fit();
    v.orbit.beta = 0.35;
  });
  const box = await page.locator('.v3-stage canvas').boundingBox();
  const at = await page.evaluate(() => {
    const v = window.__rf3d;
    const r = [...v.model.rooms].sort((a, b) => b.floorAreaM2 - a.floorAreaM2)[0];
    return v.projectPlan(r.anchor[0], r.anchor[1], 0);
  });
  await page.mouse.click(box.x + at[0], box.y + at[1]);
  await wait(800);
  await shot('3d-3-pick');
  report.label = await page.locator('.v3-label').innerText().catch(() => '');

  // от первого лица
  await page.getByRole('button', { name: 'От первого лица', exact: true }).click();
  await wait(2000);
  await shot('3d-4-fps');
  report.here = await page.locator('.v3-here').innerText().catch(() => '');
  // пройти вперёд (W) — коллизии/гравитация не должны уронить камеру
  await page.locator('.v3-stage canvas').focus();
  await page.keyboard.down('KeyW');
  await wait(1500);
  await page.keyboard.up('KeyW');
  await wait(600);
  report.fpsPos = await page.evaluate(() => {
    const p = window.__rf3d.fps.position;
    return [p.x.toFixed(2), p.y.toFixed(2), p.z.toFixed(2)];
  });
  await shot('3d-5-fps-walk');
  // повернуться на 180°
  await cam(() => {
    const c = window.__rf3d.fps;
    c.rotation.y += Math.PI;
  });
  await shot('3d-6-fps-back');

  // GLB
  await page.getByRole('button', { name: 'Облёт', exact: true }).click();
  await wait(500);
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.getByRole('button', { name: /Скачать \.glb/ }).click()]);
  const glbPath = out + 'blockout.glb';
  await dl.saveAs(glbPath);
  report.glb = glbPath;

  // вплотную: gap 0 через файл фикстуры
  await page.getByRole('button', { name: 'Файл', exact: true }).click();
  await page.locator('.v3-file input').setInputFiles(fileURLToPath(new URL('../src/blockout/fixtures/run-gap0-30.json', import.meta.url)));
  await wait(2500);
  await shot('3d-7-gap0-orbit');
  await cam(() => {
    const v = window.__rf3d;
    const r = v.model.rooms[0];
    v.orbit.setTarget(new v.orbit.target.constructor(r.anchor[0], 0.5, -r.anchor[1]));
    v.orbit.radius = 7;
    v.orbit.beta = 1.0;
    v.orbit.alpha = -Math.PI / 2 + 0.7;
  });
  await shot('3d-8-gap0-close');
  await page.getByRole('button', { name: 'От первого лица', exact: true }).click();
  await wait(2000);
  await shot('3d-9-gap0-fps');

  // 150 комнат: время построения, fps и draw calls в облёте и от первого лица
  await page.getByRole('button', { name: 'Облёт', exact: true }).click();
  await page.locator('.v3-file input').setInputFiles(fileURLToPath(new URL('../src/blockout/fixtures/run-gap1-150.json', import.meta.url)));
  await wait(4000);
  await shot('3d-11-big-orbit');
  report.big = await page.locator('.side.right').innerText();
  report.bigPerf = await page.locator('.v3-perf').innerText();
  await page.getByRole('button', { name: 'От первого лица', exact: true }).click();
  await wait(3000);
  await shot('3d-12-big-fps');
  report.bigPerfFps = await page.locator('.v3-perf').innerText();

  // одна комната
  await page.getByRole('button', { name: 'Комната', exact: true }).click();
  await page.getByRole('button', { name: 'Облёт', exact: true }).click();
  await wait(2500);
  await shot('3d-10-room');
  report.sideRoom = await page.locator('.side.right').innerText();
}

if (only === 'all' || only === 'demo') {
  const d = await ctx.newPage();
  d.on('pageerror', (e) => errors.push('DEMO PAGEERROR ' + e.message));
  d.on('console', (m) => m.type() === 'error' && errors.push('DEMO ' + m.text().slice(0, 300)));
  await d.goto(new URL('examples/babylon-demo/', url).href);
  await d.waitForTimeout(5000);
  await d.screenshot({ path: out + 'demo-1.png' });
  report.demoInfo = await d.locator('#info').innerText();
  await d.selectOption('#fixture', 'run-gap0-30.json');
  await d.waitForTimeout(4000);
  await d.screenshot({ path: out + 'demo-2-gap0.png' });
  report.demoInfo2 = await d.locator('#info').innerText();
}

writeFileSync(out + 'qa-3d.json', JSON.stringify({ errors, report }, null, 2));
console.log(JSON.stringify({ errors, report }, null, 2));
await browser.close();
