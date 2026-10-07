// QA отделки на настоящих пресетах: «Прогон» во вкладке 3D (JSON с текстурами), облёт, от первого лица
// в жилой комнате, санузле, подъезде; размеры повторов отделок; «Комната»; GLB с облицовкой.
// node tools/qa-3d-finish-app.mjs [url]
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';

const url = process.argv[2] ?? 'http://localhost:5205/';
const out = fileURLToPath(new URL('./qa/', import.meta.url));
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message + ' @ ' + String(e.stack ?? '').split(/\n/).slice(1, 3).join(' | ')));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)));
const tab = (name) => page.getByRole('button', { name, exact: true }).click();
const shot = (n) => page.screenshot({ path: out + n + '.png' });
const report = {};

await page.goto(url);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForTimeout(1200);
for (let k = 0; k < 4; k++) {
  if ((await page.locator('.tab.on').innerText().catch(() => '')) !== '3D') await tab('3D');
  await tab('Прогон');
  const g = page.getByRole('button', { name: 'Сгенерировать', exact: true });
  if (await g.count()) await g.first().click();
  if (await page.waitForFunction(() => !!window.__rf3d?.bo, null, { timeout: 20000 }).then(() => true, () => false)) break;
}
await page.waitForTimeout(2500);
await shot('finapp-1-orbit');
report.finishes = await page.evaluate(() =>
  window.__rf3d.model.finishes.map((f) => `${f.id} «${f.name}» ${f.surface} ${f.tileW}×${f.tileH} м${f.tex ? ' tex' : ''}${f.dado ? ` dado→${f.dado.finishId}@${f.dado.heightM}` : ''}`),
);
report.facings = await page.evaluate(() => window.__rf3d.bo.facings.map((m) => `${m.name}:${m.getTotalVertices() / 4}`));
report.faces = await page.evaluate(() => window.__rf3d.model.faces.length);
report.panel = await page.locator('.v3-fins').innerText().catch(() => '(нет списка)');

/** От первого лица в комнате с тегом: спавн у anchor, подпись «под ногами». */
async function standIn(test, name) {
  if ((await page.locator('.v3-tools .btn.on').innerText()) !== 'От первого лица') await tab('От первого лица');
  await page.waitForTimeout(300);
  const r = await page.evaluate((src) => {
    const v = window.__rf3d;
    const fn = new Function('r', 'return ' + src);
    const room = v.model.rooms.find((r) => fn(r));
    if (!room) return null;
    v.spawnInst = room.inst;
    v.spawn();
    return `${room.name} [${room.tags.join(',')}] стены=${room.finish?.wall} пол=${room.finish?.floor}`;
  }, test);
  await page.waitForTimeout(1800);
  await shot(name);
  return { room: r, here: await page.locator('.v3-here').innerText().catch(() => '') };
}
report.living = await standIn("r.tags.includes('жилая') && r.finish && r.finish.wall", 'finapp-2-living');
report.bath = await standIn("r.tags.includes('санузел') && r.finish && r.finish.wall", 'finapp-3-bath');
report.hall = await standIn("(r.tags.includes('подъезд') || r.tags.includes('коридор') || r.tags.includes('лестница')) && r.finish && r.finish.wall", 'finapp-4-hall');
// чей пол перед камерой на площадке (по экрану ниже центра)
report.hallFloorPick = await page.evaluate(() => {
  const v = window.__rf3d;
  const out = [];
  for (const [x, y] of [[550, 750], [700, 800], [300, 820], [450, 600]]) {
    const h = v.scene.pick(x, y, (m) => m.isVisible);
    const md = h?.pickedMesh?.metadata;
    out.push(`${x},${y}: ${h?.pickedMesh?.name} fin=${md?.finishId ?? '-'} mat=${h?.pickedMesh?.material?.name}`);
  }
  const fl = v.model.floors.filter((f) => f.inst === 'i0').map((f) => f.finish);
  out.push('model i0 floor finish: ' + JSON.stringify(fl) + ' room: ' + JSON.stringify(v.model.rooms.find((r) => r.inst === 'i0')?.finish));
  return out;
});
report.kitchen = await standIn("r.tags.includes('кухня') && r.finish && r.finish.wall", 'finapp-5-kitchen');

report.bathTile = await standIn("r.finish && r.finish.wall === 'f_two_bath'", 'finapp-8-bath-tile');
report.damask = await standIn("r.finish && r.finish.wall === 'f_wp_damask'", 'finapp-9-damask');
// повернуться к стене с обоями и снять вплотную (масштаб раппорта; 1 м сетки = 100 клеток плана)
for (const [k, turn] of [[1, Math.PI / 2], [2, Math.PI], [3, -Math.PI / 2]]) {
  await page.evaluate((t) => {
    const c = window.__rf3d.fps;
    c.rotation.y += t;
    c.rotation.x = 0;
  }, turn);
  await page.waitForTimeout(900);
  await shot('finapp-9-damask-' + k);
  await page.evaluate((t) => (window.__rf3d.fps.rotation.y -= t), turn);
}

// GLB: облицовка в экспорте
await tab('Облёт');
await page.waitForTimeout(500);
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 90000 }), page.getByRole('button', { name: /Скачать \.glb/ }).click()]);
const p = out + 'finapp.glb';
await dl.saveAs(p);
const { readFileSync } = await import('node:fs');
const buf = readFileSync(p);
const json = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8'));
report.glb = { bytes: buf.length, magic: buf.subarray(0, 4).toString(), facingNodes: json.nodes.filter((n) => n.extras?.kind === 'facing').length, images: json.images?.length ?? 0 };

// отделка выкл — сетка
await page.getByText('отделка (обои, кафель, полы)', { exact: true }).click();
await page.waitForTimeout(1500);
report.offFacings = await page.evaluate(() => window.__rf3d.bo.facings.length);
await shot('finapp-6-off');
await page.getByText('отделка (обои, кафель, полы)', { exact: true }).click();
await page.waitForTimeout(800);

// одна комната (самая вероятная отделка)
await tab('Комната');
await page.waitForTimeout(2500);
report.room = await page.evaluate(() => ({ faces: window.__rf3d.model.faces.length, finish: window.__rf3d.model.rooms[0]?.finish, facings: window.__rf3d.bo.facings.map((m) => m.name) }));
await shot('finapp-7-room');

console.log(JSON.stringify({ errors, report }, null, 1));
await browser.close();
