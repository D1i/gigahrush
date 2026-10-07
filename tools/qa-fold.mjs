// Проверка складчатого (4D) генератора в UI: режим генератора, «все слои», «слой W», «глазами игрока»,
// инфо экземпляра, инспектор метки с порогом 4D. Скриншоты — tools/qa/fold-*.png.
// Запуск: node tools/qa-fold.mjs [url]   (по умолчанию http://localhost:5208/)
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const url = process.argv[2] ?? 'http://localhost:5208/';
const count = +(process.argv[3] ?? 120);
const out = fileURLToPath(new URL('./qa/', import.meta.url));
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const shot = (n) => page.screenshot({ path: out + 'fold-' + n + '.png' });
const btn = (name) => page.getByRole('button', { name, exact: true });
const info = {};

await page.goto(url);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForTimeout(1500);

await btn('Генератор').click();
await page.waitForTimeout(1200);
await page.getByRole('button', { name: /Складчатый \(4D\)/ }).click();
await page.waitForTimeout(800);
const cnt = page.locator('.field', { has: page.locator('label', { hasText: /^Комнат$/ }) }).locator('input');
await cnt.fill(String(count));
await cnt.press('Enter');
await page.waitForTimeout(2500);
await shot('1-all');
// сводка складок в левой колонке
const fsec = page.locator('.section', { hasText: 'Складки (4D)' }).first();
if (await fsec.count()) {
  await fsec.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await shot('1b-summary');
  await page.locator('aside.side').first().evaluate((el) => (el.scrollTop = 0));
} else errors.push('нет секции «Складки (4D)»');

// выделить экземпляр, у которого есть наложения
const picked = await page.evaluate(async () => {
  const ui = await import('/src/model/ui.ts');
  const run = ui.getUI().run;
  const fold = await import('/src/gen4d/fold.ts');
  const st = await import('/src/model/store.ts');
  const pairs = fold.overlapPairs(st.getProject(), run);
  const id = pairs.length ? pairs[0][0] : run.instances[5]?.id;
  ui.setUI({ runInst: id });
  return { id, pairs: pairs.length, n: run.instances.length, fold: run.fold, errs: fold.validateFoldRun(st.getProject(), run).length };
});
info.picked = picked;
await page.waitForTimeout(800);
await shot('2-all-selected');

await btn('Слой W').click();
await page.waitForTimeout(800);
await shot('3-layer');
await page.getByRole('button', { name: '▶', exact: true }).click();
await page.waitForTimeout(500);
await shot('4-layer-next');

await btn('Глазами игрока').click();
await page.waitForTimeout(1000);
await shot('5-player');
// клик по соседу: центр соседа по связи
const moved = await page.evaluate(async () => {
  const ui = await import('/src/model/ui.ts');
  const run = ui.getUI().run;
  const cur = ui.getUI().runInst;
  const l = run.links.find((x) => x.a.inst === cur || x.b.inst === cur);
  const to = l ? (l.a.inst === cur ? l.b.inst : l.a.inst) : null;
  return { cur, to };
});
if (moved.to) {
  await page.evaluate(async (to) => {
    const ui = await import('/src/model/ui.ts');
    ui.setUI({ runInst: to });
  }, moved.to);
  await page.waitForTimeout(1000);
  await shot('6-player-moved');
}
info.moved = moved;

// клик мышью по холсту в режиме игрока (центр холста — обычно текущая комната)
const stage = page.locator('.stage canvas');
const box = await stage.boundingBox();
if (box) {
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(600);
}

// опасность в режиме «все слои»
await btn('Все слои').click();
await btn('Опасность').click();
await page.waitForTimeout(800);
await shot('7-all-heat');
await btn('Обычный').click();

// инспектор метки: пороги always/never на первой комнате с ≥2 метками
await page.evaluate(async () => {
  const ui = await import('/src/model/ui.ts');
  const st = await import('/src/model/store.ts');
  const p = st.getProject();
  const r = p.rooms.find((x) => x.connectors.length >= 3) ?? p.rooms.find((x) => x.connectors.length >= 1);
  st.mutate((pp) => {
    const rr = pp.rooms.find((x) => x.id === r.id);
    rr.connectors[0].shift = 'always';
    if (rr.connectors[1]) rr.connectors[1].shift = 'never';
  });
  ui.setUI({ page: 'editor', roomId: r.id, selection: { kind: 'connector', id: r.connectors[0].id } });
});
await page.waitForTimeout(1200);
await shot('8-editor-connector');

console.log(JSON.stringify({ errors, info }, null, 2));
await browser.close();
