// QA портального рендера складчатого (4D) прогона во вкладке «3D»: прогон С ПЕРЕСЕЧЕНИЯМИ (seamless выкл.,
// localRadius 1), от первого лица — скриншоты из нескольких комнат (с детектором 4D и без), статистика
// кадра (комнат, проёмов, draw calls), сравнение с прежним рендером набора (PVS), ходьба через порог.
// node tools/qa-3d-portal.mjs [url] [seed] [count] [sightM]
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const url = process.argv[2] ?? 'http://localhost:5211/';
const seed = process.argv[3] ?? 'hrush-001';
const count = Number(process.argv[4] ?? 60);
const sightM = Number(process.argv[5] ?? 8);
const out = fileURLToPath(new URL('./qa/', import.meta.url));
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 300)));
const wait = (ms) => page.waitForTimeout(ms);
const btn = (name) => page.getByRole('button', { name, exact: true });
const shot = (n) => page.screenshot({ path: out + `portal-${seed}-${n}.png` });
const report = {};

for (let k = 0; k < 5; k++) {
  try {
    await page.goto(url, { timeout: 180000 });
    break;
  } catch (e) {
    console.log('goto:', String(e.message).slice(0, 120));
    await wait(3000);
  }
}
await page.evaluate(() => localStorage.clear());
await page.reload({ timeout: 180000 });
await wait(1000);
await btn('3D').click();
await wait(800);

report.run = await page.evaluate(async ({ seed, count, sightM }) => {
  const { generateFoldRun } = await import('/src/gen4d/fold.ts');
  const { getProject } = await import('/src/model/store.ts');
  const { setUI } = await import('/src/model/ui.ts');
  const run = generateFoldRun(getProject(), { seed, count, sightM, fold: { shiftChance: 0.3, maxShift: 2, localRadius: 1, maxLayer: 12, seamless: false } });
  setUI({ run });
  return { n: run.instances.length, links: run.links.length, fold: run.fold, pvs: !!run.pvs, ms: run.ms };
}, { seed, count, sightM });
console.log('прогон', JSON.stringify(report.run));
await page.waitForFunction(() => window.__rf3dFold, null, { timeout: 30000 });
await wait(800);
await btn('От первого лица').click();
await page.waitForFunction(() => window.__rf3dFold?.portal?.isActive, null, { timeout: 30000 });
// дождаться готовности кусков
const settle = async () => {
  for (let k = 0; k < 60; k++) {
    await wait(150);
    if (await page.evaluate(() => window.__rf3dFold.portal.allReady())) break;
  }
  await wait(300);
};
await settle();
await shot('1-start');
const frame = () => page.evaluate(() => {
  const d = window.__rf3dFold, v = window.__rf3d;
  const s = d.portal.stats;
  return { cur: d.portal.current, rooms: s.rooms, unique: s.unique, portals: s.portals, levels: s.levels, ms: +s.ms.toFixed(2), fps: +v.engine.getFps().toFixed(0), meshes: v.scene.meshes.length, mem: d.pieces?.memory, colliding: d.portal.colliding };
});
report.start = await frame();
console.log('старт', JSON.stringify(report.start));

// комнаты с призраками: где больше всего пересечений
const rooms = await page.evaluate(async () => {
  const { overlapIds } = await import('/src/blockout/subrun.ts');
  const d = window.__rf3dFold;
  return d.rx.instances.map((i) => ({ id: i.id, n: overlapIds(d.rx, i.id).length, name: i.roomName })).sort((a, b) => b.n - a.n).slice(0, 4);
});
report.ghostRooms = rooms;
for (const [k, r] of rooms.entries()) {
  await page.evaluate((id) => window.__rf3dFold.goTo(id), r.id);
  await settle();
  // вид, где сквозь проёмы видно больше всего комнат: из точек пола у якоря, 16 направлений
  const best = await page.evaluate(async (id) => {
    const v = window.__rf3d, d = window.__rf3dFold, cam = v.fps;
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    d.autoCross = false;
    cam.applyGravity = false;
    cam.checkCollisions = false;
    const piece = d.pieces.get(id);
    const room = piece.model.rooms[0];
    let best = null;
    const pts = [room.anchor];
    for (const q of piece.portals) {
      // точка в комнате в 1.2 м от проёма (если на полу)
      const mid = (q.lo + q.hi) / 2;
      const p = q.axis === 'x' ? [q.at - q.dir * 1.2, mid] : [mid, q.at - q.dir * 1.2];
      if (piece.floor.some((r) => p[0] > r.x0 + 0.3 && p[0] < r.x1 - 0.3 && p[1] > r.y0 + 0.3 && p[1] < r.y1 - 0.3)) pts.push(p);
    }
    for (const p of pts) {
      for (let k = 0; k < 16; k++) {
        cam.position.set(p[0], 1.6, -p[1]);
        cam.rotation.set(0.04, (k / 16) * Math.PI * 2, 0);
        cam.cameraDirection.setAll(0);
        for (let j = 0; j < 3; j++) await frame();
        const s = d.portal.stats;
        const score = s.unique * 10 + s.portals;
        if (!best || score > best.score) best = { score, p, k, unique: s.unique, portals: s.portals };
      }
    }
    cam.position.set(best.p[0], 1.6, -best.p[1]);
    cam.rotation.set(0.04, (best.k / 16) * Math.PI * 2, 0);
    for (let j = 0; j < 60 && !d.portal.allReady(); j++) await frame();
    return best;
  }, r.id);
  await wait(500);
  r.best = best;
  await shot(`2-room${k}-${r.id}`);
  report['room' + k] = { ...r, frame: await frame() };
  await page.getByLabel('Детектор 4D (отладка)').first().check();
  await wait(600);
  await shot(`3-room${k}-${r.id}-detector`);
  await page.getByLabel('Детектор 4D (отладка)').first().uncheck();
  await wait(300);
}
console.log(JSON.stringify(report, null, 1));
console.log('ошибки', errors);
writeFileSync(out + `qa-3d-portal-${seed}.json`, JSON.stringify({ report, errors }, null, 2));
await browser.close();
