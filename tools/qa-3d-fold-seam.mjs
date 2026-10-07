// Объективная проверка бесшовности порогов складчатого прогона во вкладке «3D».
// Камера неподвижна у порога A→B; холст читается (engine.readPixels) в последнем кадре с набором A и в
// ПЕРВОМ кадре после подмены набором B; пиксели сравниваются. HUD (HTML поверх холста) не участвует —
// он меняется намеренно (имя комнаты, W, вспышка).
// node tools/qa-3d-fold-seam.mjs [url] [seed] [count] [localRadius]
// Если генератор не дал run.pvs — синтетический PVS: visibleSet глубины ⌊localRadius/2⌋.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const url = process.argv[2] ?? 'http://localhost:5209/';
const seed = process.argv[3] ?? 'hrush-001';
const count = Number(process.argv[4] ?? 40);
const radius = Number(process.argv[5] ?? 4);
const nPairs = Number(process.argv[6] ?? 6);
const out = fileURLToPath(new URL('./qa/', import.meta.url));
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 300)));
const wait = (ms) => page.waitForTimeout(ms);

await page.goto(url);
await page.evaluate(() => localStorage.clear());
await page.reload();
await wait(800);
await page.getByRole('button', { name: '3D', exact: true }).click();
await wait(600);

const gen = await page.evaluate(
  async ({ seed, count, radius }) => {
    const { generateFoldRun, visibleSet } = await import('/src/gen4d/fold.ts');
    const { getProject } = await import('/src/model/store.ts');
    const { setUI } = await import('/src/model/ui.ts');
    const p = getProject();
    const run = generateFoldRun(p, { seed, count, fold: { ...(p.generator.fold ?? {}), shiftChance: 0.3, maxShift: 2, localRadius: radius, maxLayer: 12 } });
    let synthetic = false;
    if (!run.pvs) {
      synthetic = true;
      const d = Math.floor(radius / 2);
      run.pvs = Object.fromEntries(run.instances.map((i) => [i.id, [...visibleSet(run, i.id, d)]]));
    }
    setUI({ run });
    const sizes = Object.values(run.pvs).map((l) => l.length);
    return { n: run.instances.length, fold: run.fold, synthetic, sightM: run.settings.sightM, pvsAvg: +(sizes.reduce((a, b) => a + b, 0) / sizes.length).toFixed(1), pvsMax: Math.max(...sizes) };
  },
  { seed, count, radius },
);
console.log('прогон', JSON.stringify(gen));
await page.waitForFunction(() => window.__rf3dFold?.pvs, null, { timeout: 30000 });
await page.getByRole('button', { name: 'От первого лица', exact: true }).click();
await page.waitForFunction(() => window.__rf3dFold?.shown, null, { timeout: 30000 });
await wait(800);

// переходы: связи от старта по BFS, со сдвигом и без
const pairs = await page.evaluate((nPairs) => {
  const d = window.__rf3dFold;
  const rx = d.rx;
  const adj = new Map(rx.instances.map((i) => [i.id, []]));
  for (const l of rx.links) (adj.get(l.a.inst).push(l), adj.get(l.b.inst).push(l));
  const seen = new Set([d.start]);
  const order = [d.start];
  for (let k = 0; k < order.length; k++) for (const l of adj.get(order[k])) for (const x of [l.a.inst, l.b.inst]) if (!seen.has(x)) (seen.add(x), order.push(x));
  const used = new Set();
  const out = [];
  const want = (shift) => {
    for (const a of order) for (const l of adj.get(a)) {
      if (used.has(l) || !!l.dw !== shift) continue;
      used.add(l);
      return { a, b: l.a.inst === a ? l.b.inst : l.a.inst, link: l };
    }
    return null;
  };
  for (let k = 0; k < nPairs; k++) {
    const s = k % 2 === 0;
    const p = want(s);
    if (p) out.push(p);
  }
  return out;
}, nPairs);

const results = [];
for (const [pi, pr] of pairs.entries()) {
  const views = ['passage→B', 'floorB→B', 'floorB→A', 'floorB↗', 'floorB↖'];
  for (const view of views) {
    const r = await page.evaluate(
      async ({ pr, view, pi }) => {
        const v = window.__rf3d;
        const d = window.__rf3dFold;
        const eng = v.engine;
        const sc = v.scene;
        const cam = v.fps;
        d.autoCross = false;
        // в A (как будто игрок там стоит), камера — вручную, без гравитации и коллизий
        if (d.shown !== pr.a) {
          d.goTo(pr.a);
          await new Promise((r) => requestAnimationFrame(() => r()));
        }
        cam.applyGravity = false;
        cam.checkCollisions = false;
        const m = v.model;
        const L = pr.link;
        const op = m.openings.find((o) => o.a.inst === L.a.inst && o.a.connector === L.a.connector && o.b.inst === L.b.inst);
        if (!op) return { error: 'нет проёма в модели A' };
        const R = op.rect;
        const cx = (R.x0 + R.x1) / 2, cy = (R.y0 + R.y1) / 2;
        const onFloor = (id, x, y) => m.floors.some((f) => f.inst === id && f.rects.some((q) => x > q.x0 && x < q.x1 && y > q.y0 && y < q.y1));
        let dir = op.axis === 'y' ? [0, 1] : [1, 0];
        const half = op.axis === 'y' ? (R.y1 - R.y0) / 2 : (R.x1 - R.x0) / 2;
        if (!onFloor(pr.b, cx + dir[0] * (half + 0.05), cy + dir[1] * (half + 0.05))) dir = [-dir[0], -dir[1]];
        let px = cx, py = cy;
        if (view !== 'passage→B') (px = cx + dir[0] * (half + 0.04)), (py = cy + dir[1] * (half + 0.04));
        const ang = { 'passage→B': 0, 'floorB→B': 0, 'floorB→A': Math.PI, 'floorB↗': 1.0, 'floorB↖': -1.0 }[view];
        const c = Math.cos(ang), s = Math.sin(ang);
        const lx = dir[0] * c - dir[1] * s, ly = dir[0] * s + dir[1] * c;
        cam.position.set(px, 1.6, -py);
        cam.setTarget(new cam.position.constructor(px + lx * 4, 1.35, -(py + ly * 4)));
        cam.cameraDirection.setAll(0);
        cam.cameraRotation.setAll(0);
        const W = eng.getRenderWidth(), H = eng.getRenderHeight();
        const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
        const grab = () => new Promise((res) => sc.onAfterRenderObservable.addOnce(() => eng.readPixels(0, 0, W, H).then((px) => res(new Uint8Array(px.buffer.slice(0)))))) ;
        for (let k = 0; k < 4; k++) await frame();
        const pSet = [px, -py];
        const pBefore = [cam.position.x, cam.position.z];
        const before = await grab();
        const t0 = performance.now();
        await d.crossTo(pr.b); // набор B подменяет A (скрытая сборка → готовность → подмена)
        const tCommit = performance.now() - t0;
        const after = await grab(); // первый кадр с набором B
        const pAfter = [cam.position.x, cam.position.z];
        // камера не сдвинулась между двумя снимками (это и проверяется); отклонение от заданной точки — для справки
        const posOk = pAfter[0] === pBefore[0] && pAfter[1] === pBefore[1];
        const drift = +Math.hypot(pBefore[0] - pSet[0], pBefore[1] - pSet[1]).toFixed(4);
        // сравнение
        let n3 = 0, n40 = 0, max = 0, bx0 = W, by0 = H, bx1 = -1, by1 = -1;
        const diff = new Uint8ClampedArray(W * H * 4);
        for (let i = 0, p = 0; i < before.length; i += 4, p++) {
          const dd = Math.max(Math.abs(before[i] - after[i]), Math.abs(before[i + 1] - after[i + 1]), Math.abs(before[i + 2] - after[i + 2]));
          if (dd > max) max = dd;
          const x = p % W, y = H - 1 - Math.floor(p / W);
          const o = (y * W + x) * 4;
          const g = (before[i] + before[i + 1] + before[i + 2]) / 9;
          diff[o] = dd > 3 ? 255 : g; diff[o + 1] = dd > 3 ? 40 : g; diff[o + 2] = dd > 3 ? 40 : g; diff[o + 3] = 255;
          if (dd > 3) {
            n3++;
            if (dd > 40) n40++;
            if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
          }
        }
        const png = (buf, isDiff) => {
          const cv = document.createElement('canvas');
          cv.width = W; cv.height = H;
          const g = cv.getContext('2d');
          let data = buf;
          if (!isDiff) {
            data = new Uint8ClampedArray(W * H * 4);
            for (let y = 0; y < H; y++) data.set(buf.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
          }
          g.putImageData(new ImageData(data, W, H), 0, 0);
          return cv.toDataURL('image/png');
        };
        const keep = n3 > 0 || (pi === 0 && view === 'floorB→B');
        const imgs = keep ? { before: png(before, false), after: png(after, false), diff: png(diff, true) } : null;
        const sa = d.setOf(pr.a), sb = d.setOf(pr.b);
        const res = {
          a: pr.a, b: pr.b, dw: L.dw ?? 0, view, W, H, n3, n40, max, posOk, drift,
          bbox: n3 ? [bx0, by0, bx1, by1] : null,
          tCommit: +tCommit.toFixed(1),
          setA: sa.size, setB: sb.size, common: [...sa].filter((x) => sb.has(x)).length,
          label: d.current.label,
          imgs,
        };
        // обратно в A — для следующего вида
        await d.crossTo(pr.a);
        return res;
      },
      { pr, view, pi },
    );
    if (r.imgs) {
      for (const k of ['before', 'after', 'diff']) writeFileSync(out + `seam-${seed}-${count}-${pi}-${r.view.replace(/[^a-zA-Z]/g, '')}-${k}.png`, Buffer.from(r.imgs[k].split(',')[1], 'base64'));
    }
    delete r.imgs;
    results.push(r);
    console.log(`${r.a}→${r.b} dw ${r.dw} ${r.view}: ${r.error ?? `разных пикселей ${r.n3} (сильно ${r.n40}), max Δ ${r.max}, наборы ${r.setA}/${r.setB} (общих ${r.common}), подмена ${r.tCommit} мс, камера неподвижна ${r.posOk}, сдвиг от заданной ${r.drift} м`}`);
  }
}

const total = results.reduce((s, r) => s + (r.n3 ?? 0), 0);
const summary = { gen, cases: results.length, withDiff: results.filter((r) => r.n3 > 0).length, totalDiffPx: total, errors };
writeFileSync(out + `qa-3d-fold-seam-${seed}-${count}-r${radius}.json`, JSON.stringify({ summary, results }, null, 2));
console.log(JSON.stringify(summary, null, 2));
await browser.close();
