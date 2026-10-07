// Объективная проверка портального рендера складчатого прогона С ПЕРЕСЕЧЕНИЯМИ (seamless выкл., localRadius 1):
//  1) Бесшовность порогов. Камера неподвижна у плоскости проёма A→B (там меняется текущая комната) —
//     глаз РОВНО на плоскости проёма (игрок меняет комнату, когда глаз её пересекает: за кадр до — со
//     стороны A, кадр после — со стороны B), в середине проёма и у косяка; взгляд в B, назад в A, вбок
//     ±57° и ±80°, вверх-вбок, вниз на порог. Холст читается (engine.readPixels) в последнем кадре с текущей A и в ПЕРВОМ
//     кадре с текущей B; пиксели сравниваются.
//  2) «Комнаты-призраки». Стоя в комнате, комнаты, пересекающиеся с ней в 3D (другие слои), НЕ видны:
//     кадр портального рендера P сравнивается с кадром Q «только текущая комната» (проёмы не открываются —
//     в них цвет фона): все отличия P от Q — только в проёмах (в Q там фон, ± 2 px сглаживания). Для
//     контроля — кадр G: текущая комната + призраки обычным рендером (без стенсила): там призраки видны.
// node tools/qa-3d-portal-seam.mjs [url] [seed] [count] [sightM] [pairs]
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const url = process.argv[2] ?? 'http://localhost:5211/';
const seed = process.argv[3] ?? 'hrush-001';
const count = Number(process.argv[4] ?? 60);
const sightM = Number(process.argv[5] ?? 8);
const nPairs = Number(process.argv[6] ?? 12);
const mode = process.argv[7] ?? 'all'; // all | seam | ghost
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
const tag = `${seed}-${count}-s${sightM}`;

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
await page.getByRole('button', { name: '3D', exact: true }).click();
await wait(600);

const gen = await page.evaluate(async ({ seed, count, sightM }) => {
  const { generateFoldRun } = await import('/src/gen4d/fold.ts');
  const { getProject } = await import('/src/model/store.ts');
  const { setUI } = await import('/src/model/ui.ts');
  const run = generateFoldRun(getProject(), { seed, count, sightM, fold: { shiftChance: 0.3, maxShift: 2, localRadius: 1, maxLayer: 12, seamless: false } });
  setUI({ run });
  return { n: run.instances.length, links: run.links.length, fold: run.fold, pvs: !!run.pvs, sightM: run.settings.sightM };
}, { seed, count, sightM });
console.log('прогон', JSON.stringify(gen));
await page.waitForFunction(() => window.__rf3dFold, null, { timeout: 60000 });
await page.getByRole('button', { name: 'От первого лица', exact: true }).click();
await page.waitForFunction(() => window.__rf3dFold?.portal?.isActive, null, { timeout: 60000 });
await wait(800);

// общие помощники в странице
await page.evaluate(() => {
  const v = window.__rf3d, d = window.__rf3dFold, eng = v.engine, sc = v.scene, cam = v.fps;
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const grab = () => new Promise((res) => sc.onAfterRenderObservable.addOnce(() => eng.readPixels(0, 0, eng.getRenderWidth(), eng.getRenderHeight()).then((px) => res(new Uint8Array(px.buffer.slice(0))))));
  const ready = async () => {
    for (let k = 0; k < 120; k++) {
      await frame();
      if (d.portal.allReady()) break;
    }
    for (let k = 0; k < 3; k++) await frame();
  };
  const place = (px, py, ang, dir, pitch = 0) => {
    const c = Math.cos(ang), s = Math.sin(ang);
    const lx = dir[0] * c - dir[1] * s, ly = dir[0] * s + dir[1] * c;
    cam.position.set(px, 1.6, -py);
    cam.setTarget(new cam.position.constructor(px + lx * 4, 1.6 - 0.25 * 4 + pitch * 4, -(py + ly * 4)));
    cam.cameraDirection.setAll(0);
    cam.cameraRotation.setAll(0);
  };
  const png = (buf, W, H, diffMask) => {
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const g = cv.getContext('2d');
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = ((H - 1 - y) * W + x) * 4, o = (y * W + x) * 4;
        if (diffMask && diffMask[(H - 1 - y) * W + x]) (data[o] = 255), (data[o + 1] = 30), (data[o + 2] = 30);
        else if (diffMask) {
          const gr = (buf[i] + buf[i + 1] + buf[i + 2]) / 9;
          data[o] = data[o + 1] = data[o + 2] = gr;
        } else (data[o] = buf[i]), (data[o + 1] = buf[i + 1]), (data[o + 2] = buf[i + 2]);
        data[o + 3] = 255;
      }
    }
    g.putImageData(new ImageData(data, W, H), 0, 0);
    return cv.toDataURL('image/png');
  };
  window.__qa = { v, d, eng, sc, cam, frame, grab, ready, place, png };
});

// ───────────────── 1) пороги ─────────────────
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
      return { a, b: l.a.inst === a ? l.b.inst : l.a.inst, ca: l.a.inst === a ? l.a.connector : l.b.connector, dw: l.dw ?? 0 };
    }
    return null;
  };
  for (let k = 0; k < nPairs; k++) {
    const p = want(k % 2 === 0) ?? want(k % 2 !== 0);
    if (p) out.push(p);
  }
  return out;
}, nPairs);

const VIEWS_ALL = [
  // [имя, смещение глаза от плоскости в сторону B (м), смещение поперёк (доля полуширины), угол, наклон]
  ['A→B', 0, 0, 0, 0],
  ['A→B косяк', 0, 0.45, 0.35, 0],
  ['B→A', 0, 0, Math.PI, 0],
  ['B→A косяк', 0, -0.45, Math.PI - 0.35, 0],
  ['вправо 57', 0, 0, 1.0, 0],
  ['влево 57', 0, 0, -1.0, 0],
  ['вправо 80', 0, 0.2, 1.4, 0],
  ['влево 100', 0, -0.2, -1.75, 0],
  ['вверх-вбок', 0, -0.3, 0.6, 0.5],
  ['вниз на порог', 0, 0.1, 0.2, -0.9],
];
// выбор видов: 8-й аргумент — подстрока имени
const VIEWS = VIEWS_ALL.filter((v) => !process.argv[8] || v[0].includes(process.argv[8]));
const seam = [];
for (const [pi, pr] of (mode === 'ghost' ? [] : pairs).entries()) {
  for (const [vname, side, lat, ang, pitch] of VIEWS) {
    const r = await page.evaluate(async ({ pr, vname, side, lat, ang, pitch, keepImg }) => {
      const { d, cam, eng, ready, grab, place, png } = window.__qa;
      d.autoCross = false;
      d.portal.autoTrack = false;
      cam.applyGravity = false;
      cam.checkCollisions = false;
      if (d.shown !== pr.a) {
        d.goTo(pr.a);
        await ready();
      }
      const P = d.pieces.get(pr.a).portals.find((q) => q.to === pr.b && (q.a.connector === pr.ca || q.b.connector === pr.ca));
      if (!P) return { error: 'нет портала' };
      // в плане: ось прохода (dirX, dirY) из A в B, поперёк — (tX, tY)
      const dir = P.axis === 'x' ? [P.dir, 0] : [0, P.dir];
      const mid = (P.lo + P.hi) / 2, half = (P.hi - P.lo) / 2;
      const t = mid + lat * half;
      const n = P.at + side * P.dir; // side — смещение от плоскости в сторону B, м (0 — на плоскости)
      const px = P.axis === 'x' ? n : t, py = P.axis === 'x' ? t : n;
      place(px, py, ang, dir, pitch);
      await ready();
      const before = await grab();
      const pos0 = cam.position.clone();
      await d.crossTo(pr.b);
      await ready();
      const after = await grab();
      const W = eng.getRenderWidth(), H = eng.getRenderHeight();
      const posOk = cam.position.equals(pos0);
      let n3 = 0, n40 = 0, max = 0;
      const mask = new Uint8Array(W * H);
      for (let i = 0, p = 0; i < before.length; i += 4, p++) {
        const dd = Math.max(Math.abs(before[i] - after[i]), Math.abs(before[i + 1] - after[i + 1]), Math.abs(before[i + 2] - after[i + 2]));
        if (dd > max) max = dd;
        if (dd > 3) {
          n3++;
          mask[p] = 1;
          if (dd > 40) n40++;
        }
      }
      const st = d.portal.stats;
      // образцы отличий (x, y сверху; до / после) — для разбора
      const samples = [];
      for (let p = 0; p < W * H && samples.length < 8; p += 97) {
        const q = mask.indexOf(1, p);
        if (q < 0) break;
        const i = q * 4;
        samples.push([q % W, H - 1 - Math.floor(q / W), [before[i], before[i + 1], before[i + 2]], [after[i], after[i + 1], after[i + 2]]]);
        p = q + 97 * 40;
      }
      const res = { a: pr.a, b: pr.b, dw: pr.dw, view: vname, n3, n40, max, posOk, rooms: st.rooms, portals: st.portals, samples };
      if (n3 > 0 || keepImg) {
        // для разбора: «правда» — куски A и B обычным рендером вместе (без стенсила; верно, пока лучи не уходят дальше A ∪ B)
        d.portal.openPortals = false;
        const pa = d.pieces.get(pr.a);
        for (const m of pa.meshes) m.layerMask = 0x0fffffff;
        await ready();
        const truth = await grab();
        for (const m of pa.meshes) m.layerMask = 0x10000000;
        d.portal.openPortals = true;
        res.imgs = { before: png(before, W, H), after: png(after, W, H), diff: png(before, W, H, mask), truth: png(truth, W, H) };
      }
      await d.crossTo(pr.a);
      await ready();
      return res;
    }, { pr, vname, side, lat, ang, pitch, keepImg: pi === 0 && vname === 'A→B' });
    if (r.imgs) {
      const base = `portal-seam-${tag}-${pi}-${vname.replace(/[^a-zA-Zа-яА-Я0-9]/g, '')}`;
      for (const k of Object.keys(r.imgs)) writeFileSync(out + `${base}-${k}.png`, Buffer.from(r.imgs[k].split(',')[1], 'base64'));
      delete r.imgs;
    }
    seam.push(r);
    console.log(`${r.a}→${r.b} dw ${r.dw} ${r.view}: ${r.error ?? `разных пикселей ${r.n3} (сильно ${r.n40}), max Δ ${r.max}, камера неподвижна ${r.posOk}, комнат ${r.rooms}, проёмов ${r.portals}`}`);
  }
}

// ───────────────── 2) призраки ─────────────────
const ghostRooms = await page.evaluate(async () => {
  const { overlapIds } = await import('/src/blockout/subrun.ts');
  const d = window.__rf3dFold;
  return d.rx.instances.map((i) => ({ id: i.id, ghosts: overlapIds(d.rx, i.id) })).filter((r) => r.ghosts.length).sort((a, b) => b.ghosts.length - a.ghosts.length).slice(0, 6);
});
const ghost = [];
for (const [gi, gr] of (mode === 'seam' ? [] : ghostRooms).entries()) {
  for (const ang of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const r = await page.evaluate(async ({ gr, ang, keepImg }) => {
      const { d, v, cam, eng, sc, ready, grab, place, png } = window.__qa;
      d.autoCross = false;
      d.portal.autoTrack = false;
      cam.applyGravity = false;
      cam.checkCollisions = false;
      d.goTo(gr.id);
      await ready();
      const piece = d.pieces.get(gr.id);
      const room = piece.model.rooms[0];
      // точка пола у якоря, взгляд по направлению ang (в плане)
      place(room.anchor[0], room.anchor[1], ang, [1, 0], 0.1);
      await ready();
      const P = await grab(); // портальный рендер
      d.portal.openPortals = false;
      await ready();
      const Q = await grab(); // только текущая комната
      // контроль: призраки обычным рендером вместе с текущей комнатой (без стенсила)
      const ghosts = gr.ghosts.map((id) => d.pieces.get(id)).filter(Boolean);
      for (const g of ghosts) for (const m of g.meshes) m.layerMask = 0x0fffffff;
      await ready();
      const G = await grab();
      for (const g of ghosts) for (const m of g.meshes) m.layerMask = 0x10000000;
      d.portal.openPortals = true;
      await ready();
      const W = eng.getRenderWidth(), H = eng.getRenderHeight();
      const c = sc.clearColor;
      const bg = [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)];
      const isBg = (buf, i) => Math.abs(buf[i] - bg[0]) <= 2 && Math.abs(buf[i + 1] - bg[1]) <= 2 && Math.abs(buf[i + 2] - bg[2]) <= 2;
      // маска проёмов: фон в Q, расширенная на 2 px
      const hole = new Uint8Array(W * H);
      for (let p = 0; p < W * H; p++) if (isBg(Q, p * 4)) hole[p] = 1;
      const near = new Uint8Array(W * H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (!hole[y * W + x]) continue;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < W && yy < H) near[yy * W + xx] = 1;
        }
      }
      let diffPQ = 0, outside = 0, ghostPx = 0, holePx = 0;
      const mask = new Uint8Array(W * H);
      for (let p = 0, i = 0; p < W * H; p++, i += 4) {
        if (hole[p]) holePx++;
        const dPQ = Math.max(Math.abs(P[i] - Q[i]), Math.abs(P[i + 1] - Q[i + 1]), Math.abs(P[i + 2] - Q[i + 2]));
        if (dPQ > 3) {
          diffPQ++;
          if (!near[p]) {
            outside++;
            mask[p] = 1;
          }
        }
        const dGQ = Math.max(Math.abs(G[i] - Q[i]), Math.abs(G[i + 1] - Q[i + 1]), Math.abs(G[i + 2] - Q[i + 2]));
        if (dGQ > 3 && !hole[p]) ghostPx++;
      }
      const res = { room: gr.id, ghosts: gr.ghosts.length, ang: +ang.toFixed(2), diffPQ, outside, ghostPx, holePx };
      if (keepImg || outside > 0) res.imgs = { P: png(P, W, H), Q: png(Q, W, H), G: png(G, W, H), diff: png(P, W, H, mask) };
      return res;
    }, { gr, ang, keepImg: gi < 2 && ang === 0 });
    if (r.imgs) {
      const base = `portal-ghost-${tag}-${gi}-${r.room}-a${r.ang}`;
      for (const k of Object.keys(r.imgs)) writeFileSync(out + `${base}-${k}.png`, Buffer.from(r.imgs[k].split(',')[1], 'base64'));
      delete r.imgs;
    }
    ghost.push(r);
    console.log(`призраки ${r.room} (${r.ghosts}) угол ${r.ang}: отличий порталы/комната ${r.diffPQ}, из них вне проёмов ${r.outside}; призраки обычным рендером видны в ${r.ghostPx} px вне проёмов`);
  }
}

const summary = {
  gen,
  seam: { cases: seam.length, clean: seam.filter((r) => r.n3 === 0).length, maxDiffPx: Math.max(0, ...seam.map((r) => r.n3 ?? 0)), strong: seam.reduce((s, r) => s + (r.n40 ?? 0), 0), errors: seam.filter((r) => r.error).length },
  ghost: { cases: ghost.length, outside: ghost.reduce((s, r) => s + r.outside, 0), ghostPxNaive: ghost.reduce((s, r) => s + r.ghostPx, 0) },
  errors,
};
writeFileSync(out + `qa-3d-portal-seam-${tag}.json`, JSON.stringify({ summary, seam, ghost }, null, 2));
console.log(JSON.stringify(summary, null, 2));
await browser.close();
