// Производительность портального рендера против прежнего рендера набора (PVS) от первого лица.
// Один и тот же прогон С PVS (seamless, чтобы прежний рендер был корректен), одни и те же точки и взгляды:
// draw calls (SceneInstrumentation), время кадра (среднее по 30 кадрам; swiftshader — программный
// рендер, абсолютные числа не показательны, важно соотношение), время обхода порталов на CPU, сколько
// комнат и проёмов в кадре; память кусков. Плюс прогон БЕЗ PVS (seamless выкл., пересечения) — только порталы.
// node tools/qa-3d-portal-perf.mjs [url] [seed] [count] [sightM]
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
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
const wait = (ms) => page.waitForTimeout(ms);
for (let k = 0; k < 5; k++) {
  try {
    await page.goto(url, { timeout: 180000 });
    break;
  } catch {
    await wait(3000);
  }
}
await page.evaluate(() => localStorage.clear());
await page.reload({ timeout: 180000 });
await wait(1000);
await page.getByRole('button', { name: '3D', exact: true }).click();
await wait(600);

const result = {};
for (const seamless of [true, false]) {
  const gen = await page.evaluate(async ({ seed, count, sightM, seamless }) => {
    const { generateFoldRun } = await import('/src/gen4d/fold.ts');
    const { getProject } = await import('/src/model/store.ts');
    const { setUI } = await import('/src/model/ui.ts');
    const run = generateFoldRun(getProject(), { seed, count, sightM, fold: { shiftChance: 0.3, maxShift: 2, localRadius: seamless ? 2 : 1, maxLayer: 12, seamless } });
    setUI({ run });
    return { n: run.instances.length, overlaps: run.fold.overlaps, pvs: !!run.pvs };
  }, { seed, count, sightM, seamless });
  await wait(1500);
  if (!(await page.evaluate(() => window.__rf3d.mode === 'fps'))) await page.getByRole('button', { name: 'От первого лица', exact: true }).click();
  await page.waitForFunction(() => window.__rf3dFold, null, { timeout: 60000 });
  const modes = seamless ? ['portal', 'pvs'] : ['portal'];
  for (const mode of modes) {
    const r = await page.evaluate(async ({ mode }) => {
      const v = window.__rf3d, d = window.__rf3dFold, cam = v.fps;
      const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
      d.setRender(mode);
      for (let k = 0; k < 10; k++) await frame();
      d.autoCross = false;
      // комнаты: старт и первые по обходу в ширину
      const rx = d.rx;
      const adj = new Map(rx.instances.map((i) => [i.id, []]));
      for (const l of rx.links) (adj.get(l.a.inst).push(l.b.inst), adj.get(l.b.inst).push(l.a.inst));
      const order = [d.start];
      for (let k = 0; k < order.length && order.length < 8; k++) for (const x of adj.get(order[k])) if (!order.includes(x)) order.push(x);
      const rows = [];
      for (const id of order.slice(0, 8)) {
        d.goTo(id);
        for (let k = 0; k < 6; k++) await frame();
        const room = (d.portal?.isActive ? d.pieces.get(id).model : v.model).rooms.find((x) => x.inst === id);
        for (const ang of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
          cam.applyGravity = false;
          cam.checkCollisions = false;
          cam.position.set(room.anchor[0], 1.6, -room.anchor[1]);
          cam.rotation.set(0.05, ang, 0);
          cam.cameraDirection.setAll(0);
          for (let k = 0; k < 8; k++) await frame();
          // готовность (порталы)
          for (let k = 0; k < 60 && d.portal?.isActive && !d.portal.allReady(); k++) await frame();
          const t0 = performance.now();
          let dc = 0, cpu = 0, rooms = 0, portals = 0;
          for (let k = 0; k < 30; k++) {
            await frame();
            dc += v.instr.drawCallsCounter.current;
            if (d.portal?.isActive) {
              cpu += d.portal.stats.ms;
              rooms += d.portal.stats.rooms;
              portals += d.portal.stats.portals;
            }
          }
          rows.push({ id, ang: +ang.toFixed(2), ms: (performance.now() - t0) / 30, dc: dc / 30, cpu: cpu / 30, rooms: rooms / 30, portals: portals / 30 });
        }
      }
      const avg = (f) => rows.reduce((s, r) => s + f(r), 0) / rows.length;
      const max = (f) => Math.max(...rows.map(f));
      return {
        views: rows.length,
        msFrame: +avg((r) => r.ms).toFixed(1),
        drawCalls: +avg((r) => r.dc).toFixed(1),
        drawCallsMax: +max((r) => r.dc).toFixed(0),
        cpuPortalMs: +avg((r) => r.cpu).toFixed(2),
        rooms: +avg((r) => r.rooms).toFixed(1),
        roomsMax: +max((r) => r.rooms).toFixed(0),
        portals: +avg((r) => r.portals).toFixed(1),
        meshes: v.scene.meshes.length,
        pieces: d.pieces?.memory ?? null,
      };
    }, { mode });
    result[`${seamless ? 'pvs-run' : 'overlap-run'}:${mode}`] = { gen, ...r };
    console.log(seamless ? 'прогон с PVS' : 'прогон с пересечениями', mode, JSON.stringify(gen), JSON.stringify(r));
  }
}
writeFileSync(out + `qa-3d-portal-perf-${seed}-${count}-s${sightM}.json`, JSON.stringify({ result, errors }, null, 2));
console.log('ошибки', errors);
await browser.close();
