// QA отделки на настоящем ядре: фикстура прогона + синтетические отделки по тегам комнат (текстуры
// рисуются в браузере), загрузка через «Файл» во вкладке 3D. Скриншоты: облёт, жилая (обои),
// санузел (кафель + побелка), подъезд (двухтонная краска).
// node tools/qa-3d-finish-run.mjs [url] [fixture]
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const url = process.argv[2] ?? 'http://localhost:5205/';
const fx = process.argv[3] ?? 'run-gap1-30';
const out = fileURLToPath(new URL('./qa/', import.meta.url));
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message + ' @ ' + String(e.stack ?? '').split(/\n/).slice(1, 4).join(' | ')));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)));
await page.goto(url);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForTimeout(800);

// текстуры: обои-дамаск (~20 см раппорт в повторе 0.53 м), кафель 15 см, паркет, линолеум
const tex = await page.evaluate(() => {
  const mk = (size, draw) => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    draw(cv.getContext('2d'), size);
    return cv.toDataURL('image/png');
  };
  const damask = mk(256, (c, s) => {
    c.fillStyle = '#2f5a3c';
    c.fillRect(0, 0, s, s);
    c.fillStyle = '#4c7a55';
    for (const [x, y] of [[0.25, 0.25], [0.75, 0.75], [0.25, 0.75], [0.75, 0.25]]) {
      c.save();
      c.translate(x * s, y * s);
      c.beginPath();
      c.ellipse(0, 0, s * 0.09, s * 0.17, 0, 0, Math.PI * 2);
      c.fill();
      c.restore();
    }
  });
  const kafel = mk(128, (c, s) => {
    c.fillStyle = '#9aa3a6';
    c.fillRect(0, 0, s, s);
    c.fillStyle = '#e9eef0';
    c.fillRect(3, 3, s - 6, s - 6);
  });
  const parquet = mk(256, (c, s) => {
    for (let k = 0; k < 5; k++) {
      c.fillStyle = k % 2 ? '#9a6a3c' : '#a8774a';
      c.fillRect((k * s) / 5, 0, s / 5, s);
      c.fillStyle = '#5a3a1e';
      c.fillRect((k * s) / 5, 0, 2, s);
      c.fillRect((k * s) / 5, ((k * 0.37) % 1) * s, s / 5, 2);
    }
  });
  const lino = mk(256, (c, s) => {
    c.fillStyle = '#8a6f52';
    c.fillRect(0, 0, s, s);
    c.strokeStyle = '#6f573f';
    c.lineWidth = 3;
    for (let k = 0; k < 4; k++) c.strokeRect((k % 2) * s * 0.5 + 6, Math.floor(k / 2) * s * 0.5 + 6, s * 0.5 - 12, s * 0.5 - 12);
  });
  return { damask, kafel, parquet, lino };
});

const run = JSON.parse(readFileSync(fileURLToPath(new URL(`../src/blockout/fixtures/${fx}.json`, import.meta.url)), 'utf8'));
const F = (id, name, surface, color, t, tileW, tileH, dado = null) => ({ id, name, surface, color, tex: t, hasTex: !!t, tileW, tileH, dado });
run.finishes = [
  F('wp_damask', 'Обои «Дамаск зелёный»', 'wall', '#3b6646', tex.damask, 0.53, 0.53),
  F('wash', 'Побелка', 'wall', '#e6e3da', null, 1, 1),
  F('bath', 'Побелка + кафель до 1.5 м', 'wall', '#e6e3da', null, 1, 1, { finishId: 'kafel', heightM: 1.5 }),
  F('kafel', 'Кафель белый 15×15', 'wall', '#e9eef0', tex.kafel, 0.15, 0.15),
  F('hall', 'Подъезд: побелка + краска до 1.5 м', 'wall', '#e6e3da', null, 1, 1, { finishId: 'paint_green', heightM: 1.5 }),
  F('paint_green', 'Краска подъездная зелёная', 'wall', '#4f7f6c', null, 1, 1),
  F('parquet', 'Паркет', 'floor', '#a07040', tex.parquet, 0.5, 0.5),
  F('lino', 'Линолеум', 'floor', '#8a6f52', tex.lino, 1, 1),
  F('floor_tile', 'Плитка пола', 'floor', '#b5a48f', tex.kafel, 0.3, 0.3),
];
const pick = (tags) => {
  if (tags.includes('санузел')) return { wall: 'bath', floor: 'floor_tile' };
  if (tags.includes('кухня')) return { wall: 'bath', floor: 'lino' };
  if (tags.some((t) => ['подъезд', 'коридор', 'лестница', 'лифт'].includes(t))) return { wall: 'hall', floor: 'floor_tile' };
  if (tags.includes('жилая') || tags.includes('общежитие')) return { wall: 'wp_damask', floor: 'parquet' };
  if (tags.includes('прихожая')) return { wall: 'wp_damask', floor: 'lino' };
  return { wall: 'wash', floor: 'lino' };
};
for (const i of run.instances) i.finish = pick(i.roomTags);

const tab = (name) => page.getByRole('button', { name, exact: true }).click();
await tab('3D');
await tab('Файл');
await page.locator('.v3-file input').setInputFiles({ name: `${fx}-finishes.json`, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(run)) });
await page.waitForFunction(() => !!window.__rf3d?.bo, null, { timeout: 30000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: out + 'finrun-1-orbit.png' });
const report = {
  side: await page.locator('.side.right').innerText(),
  facings: await page.evaluate(() => window.__rf3d.bo.facings.map((m) => `${m.name}:${m.getTotalVertices() / 4}`)),
  faces: await page.evaluate(() => window.__rf3d.model.faces.length),
};

/** Встать в комнату по тегу: глаза 1.6 м у anchor, смотреть на дальний угол пола. */
async function standIn(tag, name) {
  if ((await page.locator('.v3-tools .btn.on').innerText()) !== 'От первого лица') await tab('От первого лица');
  await page.waitForTimeout(400);
  const ok = await page.evaluate(
    ([tag, runJson]) => {
      const v = window.__rf3d;
      const inst = runJson.find((i) => i.roomTags.includes(tag))?.id;
      const r = v.model.rooms.find((x) => x.inst === inst);
      if (!r) return null;
      v.spawnInst = r.inst;
      v.spawn();
      return r.name;
    },
    [tag, run.instances.map((i) => ({ id: i.id, roomTags: i.roomTags }))],
  );
  await page.waitForTimeout(1800);
  await page.screenshot({ path: out + name + '.png' });
  return ok;
}
report.living = await standIn('жилая', 'finrun-2-living');
report.livingHere = await page.locator('.v3-here').innerText().catch(() => '');
report.bath = await standIn('санузел', 'finrun-3-bath');
// что под светлой вертикальной линией в стене за дверью (x ≈ 805 страницы = 555 холста)
report.bathPick = await page.evaluate(() => {
  const v = window.__rf3d;
  const out = [];
  for (const x of [548, 552, 555, 558, 562])
    for (const y of [300, 450]) {
      const h = v.scene.pick(x, y, (m) => m.isVisible);
      const pt = h?.pickedPoint;
      out.push(`${x},${y}: ${h?.pickedMesh?.name ?? '-'} ${pt ? [pt.x, pt.y, pt.z].map((c) => c.toFixed(3)).join(',') : ''}`);
    }
  // квады облицовки в этой плоскости (Z ≈ −1.2015): X-диапазоны и высоты
  const m = v.bo.facings.find((x) => x.name === 'facing:wp_damask');
  const p = m.getVerticesData('position');
  const quads = [];
  for (let k = 0; k < p.length / 3; k += 4) {
    const vs = [0, 1, 2, 3].map((i) => [p[(k + i) * 3], p[(k + i) * 3 + 1], p[(k + i) * 3 + 2]]);
    if (vs.every((q) => Math.abs(q[2] + 1.2015) < 1e-3)) quads.push([Math.min(...vs.map((q) => q[0])), Math.max(...vs.map((q) => q[0])), Math.min(...vs.map((q) => q[1])), Math.max(...vs.map((q) => q[1]))].map((c) => +c.toFixed(4)));
  }
  out.push('quads@Z-1.2015: ' + JSON.stringify(quads));
  out.push('faces@y1.2: ' + JSON.stringify(v.model.faces.filter((f) => Math.abs(f.line[1] - 1.2) < 1e-3 && f.line[1] === f.line[3]).map((f) => [f.inst, f.line, f.normal, f.z0, f.z1, f.part])));
  return out;
});
// анизотропия: та же точка с anisotropicFilteringLevel 8 и 1 (крупный фрагмент вокруг линии)
for (const lvl of [8, 1]) {
  await page.evaluate((lvl) => {
    const t = window.__rf3d.bo.finishMaterials.wp_damask.diffuseTexture;
    t.anisotropicFilteringLevel = lvl;
  }, lvl);
  await page.waitForTimeout(800);
  await page.screenshot({ path: out + `finrun-3-bath-aniso${lvl}.png`, clip: { x: 700, y: 100, width: 220, height: 400 } });
}
await page.evaluate(() => (window.__rf3d.bo.finishMaterials.wp_damask.diffuseTexture.anisotropicFilteringLevel = 8));
report.hall = await standIn('подъезд', 'finrun-4-hall');
report.hallHere = await page.locator('.v3-here').innerText().catch(() => '');
report.kitchen = await standIn('кухня', 'finrun-5-kitchen');

// крупный план стыка у двери: облёт к первому проёму
await tab('Облёт');
await page.evaluate(() => {
  const v = window.__rf3d;
  const o = v.model.openings[0].rect;
  v.orbit.setTarget(new v.orbit.target.constructor((o.x0 + o.x1) / 2, 1.2, -(o.y0 + o.y1) / 2));
  v.orbit.radius = 3.2;
  v.orbit.beta = 1.1;
  v.orbit.alpha = -Math.PI / 2 - 0.7;
});
await page.waitForTimeout(1500);
await page.screenshot({ path: out + 'finrun-6-door.png' });

console.log(JSON.stringify({ errors, report }, null, 1));
await browser.close();
