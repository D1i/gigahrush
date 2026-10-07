// Отладка экспорта GLB во вкладке 3D: вызывает viewer.exportGLB() и разбирает заголовок/JSON-чанк.
import { chromium } from 'playwright-core';
const url = process.argv[2] ?? 'http://localhost:5190/';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const logs = [];
page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message));
page.on('console', (m) => logs.push(m.type() + ' ' + m.text().slice(0, 300)));
await page.goto(url);
await page.waitForTimeout(1000);
for (let k = 0; k < 4; k++) {
  await page.getByRole('button', { name: '3D', exact: true }).click();
  const g = page.getByRole('button', { name: 'Сгенерировать', exact: true });
  if (await g.count()) await g.first().click();
  if (await page.waitForFunction(() => !!window.__rf3d?.bo, null, { timeout: 15000 }).then(() => true, () => false)) break;
}
const res = await page.evaluate(async () => {
  const t0 = performance.now();
  try {
    const blob = await Promise.race([window.__rf3d.exportGLB('blockout'), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout 40s')), 40000))]);
    const buf = new Uint8Array(await blob.arrayBuffer());
    const dv = new DataView(buf.buffer);
    const magic = String.fromCharCode(...buf.slice(0, 4));
    const len = dv.getUint32(8, true);
    const jlen = dv.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(buf.slice(20, 20 + jlen)));
    return { ms: Math.round(performance.now() - t0), size: buf.length, magic, version: dv.getUint32(4, true), len, meshes: json.meshes?.length, nodes: json.nodes?.length, materials: json.materials?.length, textures: json.textures?.length, images: json.images?.length, extrasSample: json.nodes?.filter((n) => n.extras).slice(0, 3).map((n) => ({ name: n.name, extras: n.extras })), prims: json.meshes?.reduce((s, m) => s + m.primitives.length, 0) };
  } catch (e) {
    return { error: String(e?.stack ?? e), ms: Math.round(performance.now() - t0) };
  }
});
console.log(JSON.stringify(res, null, 2));
console.log(logs.filter((l) => !l.startsWith('debug') && !l.startsWith('info')).slice(-20).join('\n'));
await browser.close();
