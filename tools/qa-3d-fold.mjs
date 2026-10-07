// QA вкладки «3D» для складчатого (4D) прогона: башня слоёв, слой, видимое множество, от первого лица
// до и после порога со сдвигом W (HUD + вспышка), детектор 4D, утечки при пересборках, евклидов прогон.
// Прогон генерируется в странице модулями приложения (dev-сервер Vite отдаёт /src/... те же экземпляры).
// node tools/qa-3d-fold.mjs [url]
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const url = process.argv[2] ?? 'http://localhost:5209/';
const seed = process.argv[3] ?? 'hrush-001';
const only = process.argv[4] ?? 'all'; // app | demo | all
const count = Number(process.argv[5] ?? 40);
const tag = count === 40 ? '' : '-' + count;
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
const shot = (n) => page.screenshot({ path: out + 'fold' + tag + '-' + n + '.png' });
const wait = (ms) => page.waitForTimeout(ms);
const btn = (name) => page.getByRole('button', { name, exact: true });
const report = {};

if (only !== 'demo') {
await page.goto(url);
await page.evaluate(() => localStorage.clear());
await page.reload();
await wait(1000);
await btn('3D').click();
await wait(800);

// складчатый прогон → ui.run
report.run = await page.evaluate(async ({ seed, count }) => {
  const { generateFoldRun } = await import('/src/gen4d/fold.ts');
  const { getProject } = await import('/src/model/store.ts');
  const { setUI } = await import('/src/model/ui.ts');
  const run = generateFoldRun(getProject(), { seed, count, fold: { shiftChance: 0.3, maxShift: 2, localRadius: 2, maxLayer: 12 } });
  setUI({ run });
  return { n: run.instances.length, links: run.links.length, fold: run.fold, ms: run.ms };
}, { seed, count });
const ok = await page.waitForFunction(() => window.__rf3dFold && window.__rf3d?.parts?.length > 1, null, { timeout: 30000 }).then(() => true, () => false);
if (!ok) {
  await shot('0-fail');
  const st = await page.evaluate(() => ({ fold: !!window.__rf3dFold, rf: !!window.__rf3d, parts: window.__rf3d?.parts?.length, msg: document.querySelector('.v3-msg')?.textContent, src: document.querySelector('.v3-src')?.textContent }));
  console.log(JSON.stringify({ errors, report, st }, null, 2));
  await browser.close();
  process.exit(1);
}
await wait(1500);
await shot('1-tower');
report.tower = await page.evaluate(() => {
  const d = window.__rf3dFold;
  const s = d.current;
  return { label: s.label, parts: window.__rf3d.parts.length, msModel: Math.round(s.msModel), msScene: Math.round(s.msScene), meshes: window.__rf3d.scene.meshes.length };
});
report.sideTower = await page.locator('.side.right').innerText();

// башня крупнее: сбоку на несколько слоёв
await page.evaluate(() => {
  const v = window.__rf3d;
  v.orbit.beta = 1.25;
  v.orbit.radius *= 0.6;
});
await wait(900);
await shot('2-tower-close');

// один слой
await btn('Слой').first().click();
await wait(1500);
await shot('3-layer');
report.layer = await page.evaluate(() => window.__rf3dFold.current.label);

// видимое множество стартовой комнаты (облёт)
await btn('Видимое').first().click();
await wait(1500);
await shot('4-vis-orbit');
report.visOrbit = await page.evaluate(() => window.__rf3dFold.current.label);

// ── от первого лица: порог со сдвигом W ──
// комната A и сосед B через порог dw ≠ 0; в A — точка у проёма, взгляд в B
const cross = await page.evaluate(async () => {
  const d = window.__rf3dFold;
  const rx = d.rx;
  const { visibleIds } = await import('/src/blockout/subrun.ts');
  // ближайший к старту порог со сдвигом (BFS по графу)
  const order = [...visibleIds(rx, d.start, 99)];
  for (const a of order) {
    const l = rx.links.find((l) => l.dw && (l.a.inst === a || l.b.inst === a));
    if (l) return { a, b: l.a.inst === a ? l.b.inst : l.a.inst, link: l };
  }
  return null;
});
report.cross = cross;
await btn('От первого лица').click();
await wait(800);
await page.evaluate((a) => window.__rf3dFold.goTo(a), cross.a);
await wait(800);
const setup = await page.evaluate(({ a, b, link }) => {
  const v = window.__rf3d;
  const m = v.model;
  const op = m.openings.find((o) => (o.a.inst === link.a.inst && o.a.connector === link.a.connector) || (o.b.inst === link.a.inst && o.b.connector === link.a.connector));
  const r = op.rect;
  const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
  const inA = (x, y) => m.floors.some((f) => f.inst === a && f.rects.some((q) => x > q.x0 && x < q.x1 && y > q.y0 && y < q.y1));
  // направление из A в B: по оси прохода
  let dir = op.axis === 'y' ? [0, 1] : [1, 0];
  const probe = 0.25 + (op.axis === 'y' ? (r.y1 - r.y0) / 2 : (r.x1 - r.x0) / 2);
  if (inA(cx + dir[0] * probe, cy + dir[1] * probe)) dir = [-dir[0], -dir[1]];
  const sx = cx - dir[0] * 1.1, sy = cy - dir[1] * 1.1;
  v.fps.position.set(sx, 1.65, -sy);
  v.fps.setTarget(new v.fps.position.constructor(cx + dir[0] * 3, 1.5, -(cy + dir[1] * 3)));
  v.fps.cameraDirection.setAll(0);
  return { op: op.rect, axis: op.axis, start: [sx, sy], dir, wA: window.__rf3dFold.current.w };
}, cross);
report.setup = setup;
await wait(1500);
await shot('5-fps-before');
report.hudBefore = await page.locator('.v3-here').innerText().catch(() => '');
const meshesBefore = await page.evaluate(() => window.__rf3d.scene.meshes.length);

// идти вперёд, пока центр не сменится
await page.locator('.v3-stage canvas').focus();
await page.keyboard.down('KeyW');
const crossed = await page
  .waitForFunction((b) => window.__rf3dFold.current.center === b, cross.b, { timeout: 8000, polling: 16 })
  .then(() => true, () => false);
await page.keyboard.up('KeyW');
await wait(250);
await shot('6-fps-after');
report.crossed = crossed;
report.hudAfter = await page.locator('.v3-here').innerText().catch(() => '');
report.flash = await page.locator('.v3-flash').innerText().catch(() => '');
report.afterCross = await page.evaluate(() => {
  const d = window.__rf3dFold;
  const s = d.current;
  const p = window.__rf3d.fps.position;
  return { center: s.center, w: s.w, cross: s.cross, msModel: +s.msModel.toFixed(1), msScene: +s.msScene.toFixed(1), pos: [p.x.toFixed(2), p.y.toFixed(2), p.z.toFixed(2)], meshes: window.__rf3d.scene.meshes.length };
});
report.meshesBefore = meshesBefore;
await wait(1200);
report.posLater = await page.evaluate(() => {
  const p = window.__rf3d.fps.position;
  return [p.x.toFixed(2), p.y.toFixed(2), p.z.toFixed(2)];
});
// развернуться: за спиной — комната A (через дверь)
await page.evaluate(() => {
  const c = window.__rf3d.fps;
  c.rotation.y += Math.PI;
});
await wait(900);
await shot('7-fps-back');

// ── скорость пересборки и утечки: 12 переходов туда-обратно (телепортом через полы) ──
report.roundTrips = await page.evaluate(async ({ a, b }) => {
  const v = window.__rf3d;
  const d = window.__rf3dFold;
  const sc = v.scene;
  const count = () => ({ meshes: sc.meshes.length, materials: sc.materials.length, textures: sc.textures.length, geometries: sc.geometries.length });
  const centerOf = (m, id) => {
    const r = m.rooms.find((x) => x.inst === id);
    return r.anchor;
  };
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const before = count();
  const times = [];
  for (let k = 0; k < 12; k++) {
    const to = k % 2 === 0 ? a : b;
    const [x, y] = centerOf(v.model, to);
    v.fps.position.set(x, 1.65, -y);
    await frame();
    await frame();
    const s = d.current;
    times.push([+s.msModel.toFixed(1), +s.msScene.toFixed(1)]);
  }
  await frame();
  return { before, after: count(), times, notReady: sc.textures.filter((t) => !t.isReady()).length };
}, cross);

// ── детектор: комната, на месте которой в 3D стоят комнаты других слоёв ──
const ghostRoom = await page.evaluate(async () => {
  const d = window.__rf3dFold;
  const { overlapIds } = await import('/src/blockout/subrun.ts');
  let best = null;
  for (const i of d.rx.instances) {
    const o = overlapIds(d.rx, i.id);
    if (!best || o.length > best.o.length) best = { id: i.id, o };
  }
  return best;
});
report.ghostRoom = ghostRoom;
await page.evaluate((id) => window.__rf3dFold.goTo(id), ghostRoom.id);
await wait(600);
await page.locator('.v3-det input').check();
await wait(600);
// встать в угол комнаты и смотреть на центр
await page.evaluate(() => {
  const v = window.__rf3d;
  const d = window.__rf3dFold;
  const r = v.model.rooms.find((x) => x.inst === d.current.center);
  const b = r.bbox;
  const x = b.x0 + 0.5, y = b.y0 + 0.5;
  v.fps.position.set(x, 1.65, -y);
  v.fps.setTarget(new v.fps.position.constructor(r.anchor[0] + 1, 1.0, -(r.anchor[1] + 1)));
  v.fps.cameraDirection.setAll(0);
});
await wait(1500);
await shot('8-detector');
report.detector = await page.evaluate(() => window.__rf3dFold.current.ghosts);
report.hudDetector = await page.locator('.v3-here').innerText().catch(() => '');
await page.locator('.v3-det input').uncheck();
await wait(300);

// ── облёт обратно — башня на месте; затем евклидов прогон работает как раньше ──
await btn('Облёт').click();
await btn('Башня').first().click();
await wait(1200);
report.backToTower = await page.evaluate(() => window.__rf3dFold?.current.label);
await btn('Сгенерировать заново').click();
await page.waitForFunction(() => !window.__rf3dFold && window.__rf3d?.parts?.length === 1, null, { timeout: 30000 }).catch(() => errors.push('евклидов прогон не построился'));
await wait(1500);
await shot('9-euclid');
report.euclid = await page.locator('.side.right').innerText();
}

// ── демо для движка: складчатый JSON, переход через порог со сдвигом ──
if (only !== 'app') {
  const d = await ctx.newPage();
  d.on('pageerror', (e) => errors.push('DEMO PAGEERROR ' + e.message));
  d.on('console', (m) => m.type() === 'error' && errors.push('DEMO ' + m.text().slice(0, 300)));
  await d.goto(new URL('examples/babylon-demo/', url).href);
  await d.waitForTimeout(3000);
  await d.selectOption('#fixture', './run-fold-40.json');
  await d.waitForFunction(() => !!window.demo?.fold?.model, null, { timeout: 20000 });
  await d.waitForTimeout(1500);
  report.demoInfo = await d.locator('#info').innerText();
  // ближайший к старту порог со сдвигом; встать перед ним в A и смотреть в B
  report.demoSetup = await d.evaluate(() => {
    const { fold, player } = window.demo;
    const run = fold.run;
    const adj = new Map(run.instances.map((i) => [i.id, []]));
    for (const l of run.links) (adj.get(l.a.inst).push(l.b.inst), adj.get(l.b.inst).push(l.a.inst));
    const seen = [fold.center];
    for (let k = 0; k < seen.length; k++) for (const n of adj.get(seen[k])) if (!seen.includes(n)) seen.push(n);
    let pick = null;
    for (const a of seen) {
      const l = run.links.find((l) => l.dw && (l.a.inst === a || l.b.inst === a));
      if (l) { pick = { a, b: l.a.inst === a ? l.b.inst : l.a.inst, l }; break; }
    }
    window.__pick = pick;
    return pick;
  });
  // в комнату A (по пути от старта — телепортами по полам соседей), затем к проёму
  const okA = await d.evaluate(async () => {
    const { player } = window.demo;
    const p = window.__pick;
    const frame = () => new Promise((r) => requestAnimationFrame(r));
    // идём по пути от старта к A телепортами по полам (каждый шаг — сосед текущего центра)
    const run = window.demo.fold.run;
    const adj = new Map(run.instances.map((i) => [i.id, []]));
    for (const l of run.links) (adj.get(l.a.inst).push(l.b.inst), adj.get(l.b.inst).push(l.a.inst));
    const prev = new Map([[window.demo.fold.center, null]]);
    const q = [window.demo.fold.center];
    while (q.length) { const x = q.shift(); for (const n of adj.get(x)) if (!prev.has(n)) (prev.set(n, x), q.push(n)); }
    const path = [];
    for (let x = p.a; x; x = prev.get(x)) path.unshift(x);
    for (const id of path.slice(1)) {
      const r = window.demo.fold.model.rooms.find((r) => r.inst === id);
      player.position.set(r.anchor[0], 1.65, -r.anchor[1]);
      await frame(); await frame();
    }
    return window.demo.fold.center === p.a;
  });
  report.demoAtA = okA;
  await d.evaluate(() => {
    const { fold, player } = window.demo;
    const p = window.__pick;
    const m = fold.model;
    const op = m.openings.find((o) => (o.a.inst === p.l.a.inst && o.a.connector === p.l.a.connector));
    const r = op.rect;
    const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
    const inA = (x, y) => m.floors.some((f) => f.inst === p.a && f.rects.some((q) => x > q.x0 && x < q.x1 && y > q.y0 && y < q.y1));
    let dir = op.axis === 'y' ? [0, 1] : [1, 0];
    const probe = 0.25 + (op.axis === 'y' ? (r.y1 - r.y0) / 2 : (r.x1 - r.x0) / 2);
    if (inA(cx + dir[0] * probe, cy + dir[1] * probe)) dir = [-dir[0], -dir[1]];
    player.position.set(cx - dir[0] * 1.1, 1.65, -(cy - dir[1] * 1.1));
    player.setTarget(new player.position.constructor(cx + dir[0] * 3, 1.5, -(cy + dir[1] * 3)));
    player.cameraDirection.setAll(0);
  });
  await d.waitForTimeout(1200);
  await d.screenshot({ path: out + 'fold-demo-1-before.png' });
  await d.locator('#c').focus();
  await d.keyboard.down('KeyW');
  report.demoCrossed = await d
    .waitForFunction(() => window.demo.fold.center === window.__pick.b, null, { timeout: 8000, polling: 16 })
    .then(() => true, () => false);
  await d.keyboard.up('KeyW');
  await d.waitForTimeout(400);
  await d.screenshot({ path: out + 'fold-demo-2-after.png' });
  report.demoInfoAfter = await d.locator('#info').innerText();
  report.demoPos = await d.evaluate(() => window.demo.player.position.y.toFixed(2));
}

writeFileSync(out + 'qa-3d-fold' + tag + '.json', JSON.stringify({ errors, report }, null, 2));
console.log(JSON.stringify({ errors, report }, null, 2));
await browser.close();
